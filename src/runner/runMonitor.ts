import { promises as fs } from "node:fs";
import path from "node:path";
import { buildChartOption } from "../chart/buildOption.js";
import { renderChartToImage } from "../chart/renderToImage.js";
import { queryEs } from "../es/queryEs.js";
import { transformResponse } from "../metrics/transform.js";
import { sendWecomImage } from "../notifier/wecom.js";
import type { LoadedMonitor, RunContext } from "../types.js";
import { logInfo } from "../utils/logger.js";

export async function runMonitor(monitor: LoadedMonitor, context: RunContext): Promise<void> {
  logInfo(`monitor=${monitor.name} start`);

  const response = await queryEs(monitor);

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

  await sendWecomImage(monitor.wecom.webhook, image.base64, image.md5);
  logInfo(`monitor=${monitor.name} done, image=${historyFile}, latest=${latestFile}`);
}
