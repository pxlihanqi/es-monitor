import { promises as fs } from "node:fs";
import path from "node:path";
import ms from "ms";
import { buildChartOption } from "../chart/buildOption.js";
import { renderChartToImage } from "../chart/renderToImage.js";
import { queryEs } from "../es/queryEs.js";
import { transformResponse } from "../metrics/transform.js";
import { sendWecomImage, sendWecomMarkdown } from "../notifier/wecom.js";
import type { ChartDataset, LoadedMonitor, RunContext } from "../types.js";
import { logInfo } from "../utils/logger.js";

interface AlertState {
  consecutiveHits: number;
  lastAlertAt?: string;
}

async function readAlertState(monitorDir: string): Promise<AlertState> {
  const stateFile = path.join(monitorDir, ".alert-state.json");
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as AlertState;
    return {
      consecutiveHits: typeof parsed.consecutiveHits === "number" ? parsed.consecutiveHits : 0,
      lastAlertAt: parsed.lastAlertAt
    };
  } catch {
    return { consecutiveHits: 0 };
  }
}

async function writeAlertState(monitorDir: string, state: AlertState): Promise<void> {
  const stateFile = path.join(monitorDir, ".alert-state.json");
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readTotalCount(response: Awaited<ReturnType<typeof queryEs>>): number {
  const total = response.hits.total as { value?: number } | undefined;
  return typeof total?.value === "number" ? total.value : 0;
}

function buildExceptionAlertMessage(monitor: LoadedMonitor, totalCount: number): string {
  const threshold = monitor.alert.threshold ?? 0;
  const title = monitor.alert.title?.trim() || `${monitor.name} 异常日志告警`;
  const queryHint = monitor.es.kql?.trim() || "queryFile/fuzzyConditions";
  const timeWindow = monitor.time.last ?? `${monitor.time.start} ~ ${monitor.time.end}`;
  const template = monitor.alert.markdownTemplate?.trim();

  if (template) {
    const values: Record<string, string> = {
      title,
      name: monitor.name,
      totalCount: String(totalCount),
      threshold: String(threshold),
      index: monitor.es.index,
      query: queryHint,
      timeWindow
    };
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
  }

  return [
    `# ${title}`,
    `> 监控名称: ${monitor.name}`,
    `> 当前数量: ${totalCount}`,
    `> 告警阈值: ${threshold}`,
    `> 索引: ${monitor.es.index}`,
    `> 条件: ${queryHint}`,
    `> 时间窗口: ${timeWindow}`
  ].join("\n");
}

function resolveExceptionTrendInterval(monitor: LoadedMonitor): string {
  let durationMs = 10 * 60 * 1000;

  if (monitor.time.mode === "relative" && monitor.time.last) {
    const parsed = ms(monitor.time.last);
    if (typeof parsed === "number" && parsed > 0) {
      durationMs = parsed;
    }
  } else if (monitor.time.mode === "absolute" && monitor.time.start && monitor.time.end) {
    const start = new Date(monitor.time.start).getTime();
    const end = new Date(monitor.time.end).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      durationMs = end - start;
    }
  }

  const targetBucketMs = Math.max(Math.floor(durationMs / 10), 60 * 1000);
  const candidates: Array<[string, number]> = [
    ["1m", 60 * 1000],
    ["5m", 5 * 60 * 1000],
    ["10m", 10 * 60 * 1000],
    ["15m", 15 * 60 * 1000],
    ["30m", 30 * 60 * 1000],
    ["1h", 60 * 60 * 1000],
    ["2h", 2 * 60 * 60 * 1000],
    ["6h", 6 * 60 * 60 * 1000],
    ["12h", 12 * 60 * 60 * 1000],
    ["1d", 24 * 60 * 60 * 1000]
  ];

  for (const [label, size] of candidates) {
    if (size >= targetBucketMs) {
      return label;
    }
  }

  return "1d";
}

function takeLastTenBuckets(dataset: ChartDataset): ChartDataset {
  const categories = dataset.categories.slice(-10);
  const series = dataset.series.map((item) => ({
    ...item,
    data: item.data.slice(-10)
  }));
  const rows = dataset.table.rows.slice(-10);

  return {
    categories,
    series,
    table: {
      columns: dataset.table.columns,
      rows
    }
  };
}

async function buildExceptionTrendImage(
  monitor: LoadedMonitor
): Promise<{ buffer: Buffer; base64: string; md5: string }> {
  const trendMonitor: LoadedMonitor = {
    ...monitor,
    metrics: [{ name: "error_count", type: "count" }],
    groupBy: {
      type: "date_histogram",
      field: monitor.time.field,
      interval: resolveExceptionTrendInterval(monitor),
      size: 10
    },
    chart: {
      ...monitor.chart,
      type: "bar",
      title: `${monitor.alert.title?.trim() || monitor.name} 最近10次异常统计`
    }
  };

  const trendResponse = await queryEs(trendMonitor);
  const trendDataset = takeLastTenBuckets(transformResponse(trendMonitor, trendResponse));
  const trendOption = buildChartOption(trendMonitor, trendDataset);

  return renderChartToImage(trendOption, trendMonitor.chart.width, trendMonitor.chart.height);
}

export async function runMonitor(monitor: LoadedMonitor, context: RunContext): Promise<void> {
  logInfo(`monitor=${monitor.name} start`);

  const response = await queryEs(monitor);
  const totalCount = readTotalCount(response);

  // 打印 ES 返回的数据
  logInfo(`monitor=${monitor.name} ES response: hits.total=${JSON.stringify(response.hits.total)}, hits.count=${response.hits.hits.length}`);
  if (response.aggregations) {
    logInfo(`monitor=${monitor.name} ES aggregations: ${JSON.stringify(response.aggregations, null, 2)}`);
  }

  const dataset = transformResponse(monitor, response);
  const option = buildChartOption(monitor, dataset);
  const image = await renderChartToImage(option, monitor.chart.width, monitor.chart.height);

  // Save chart files inside each monitor's own folder.
  const outputDir = path.join(monitor.monitorDir, "output");
  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const historyFile = path.join(outputDir, `${timestamp}-${monitor.chart.type}.png`);
  const latestFile = path.join(outputDir, `latest-${monitor.chart.type}.png`);

  await fs.writeFile(historyFile, image.buffer);
  await fs.writeFile(latestFile, image.buffer);

  if (context.dryRun) {
    logInfo(
      `monitor=${monitor.name} dry-run complete, image=${historyFile}, latest=${latestFile}`
    );
    return;
  }

  if (monitor.kind === "exception" && monitor.alert.enabled) {
    const threshold = monitor.alert.threshold ?? 0;
    const consecutiveCount = monitor.alert.consecutiveCount ?? 1;
    const cooldownMinutes = monitor.alert.cooldownMinutes ?? 0;
    const state = await readAlertState(monitor.monitorDir);
    if (totalCount > threshold) {
      state.consecutiveHits += 1;
      const lastAlertAtMs = state.lastAlertAt ? new Date(state.lastAlertAt).getTime() : 0;
      const cooldownActive =
        cooldownMinutes > 0 &&
        Number.isFinite(lastAlertAtMs) &&
        Date.now() - lastAlertAtMs < cooldownMinutes * 60 * 1000;

      if (state.consecutiveHits < consecutiveCount) {
        await writeAlertState(monitor.monitorDir, state);
        logInfo(
          `monitor=${monitor.name} alert pending, total=${totalCount}, threshold=${threshold}, consecutive=${state.consecutiveHits}/${consecutiveCount}`
        );
        return;
      }

      if (cooldownActive) {
        await writeAlertState(monitor.monitorDir, state);
        logInfo(
          `monitor=${monitor.name} alert cooled down, total=${totalCount}, threshold=${threshold}, cooldownMinutes=${cooldownMinutes}`
        );
        return;
      }

      await sendWecomMarkdown(monitor.wecom.webhook, buildExceptionAlertMessage(monitor, totalCount));
      const trendImage = await buildExceptionTrendImage(monitor);
      const trendHistoryFile = path.join(outputDir, `${timestamp}-exception-trend.png`);
      const trendLatestFile = path.join(outputDir, "latest-exception-trend.png");
      await fs.writeFile(trendHistoryFile, trendImage.buffer);
      await fs.writeFile(trendLatestFile, trendImage.buffer);
      await sendWecomImage(monitor.wecom.webhook, trendImage.base64, trendImage.md5);
      state.consecutiveHits = 0;
      state.lastAlertAt = new Date().toISOString();
      await writeAlertState(monitor.monitorDir, state);
      logInfo(
        `monitor=${monitor.name} alert sent, total=${totalCount}, threshold=${threshold}, image=${trendLatestFile}`
      );
    } else {
      state.consecutiveHits = 0;
      await writeAlertState(monitor.monitorDir, state);
      logInfo(`monitor=${monitor.name} alert skipped, total=${totalCount}, threshold=${threshold}`);
    }
    return;
  }

  await sendWecomImage(monitor.wecom.webhook, image.base64, image.md5);
  logInfo(`monitor=${monitor.name} done, image=${historyFile}, latest=${latestFile}`);
}
