import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { monitorSchema, type MonitorConfig } from "../types.js";

const DEFAULT_MONITOR_FILE = "monitor.yaml";
const MONITOR_FILE_CANDIDATES = ["monitor.yaml", "monitor.yml"] as const;
const SAFE_ID = /^(?=.{1,64}$)[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

export interface MonitorSummary {
  id: string;
  kind: "chart" | "exception";
  name: string;
  enabled: boolean;
  schedule: string;
  valid: boolean;
  error?: string;
}

export interface MonitorDetail {
  id: string;
  monitorYaml: string;
  queryJson: string;
  chartJson: string;
  monitorConfig?: MonitorConfig;
  monitorConfigError?: string;
}

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ensureMonitorId(id: string): string {
  const normalized = id.trim();
  if (!SAFE_ID.test(normalized)) {
    throw new HttpError(
      400,
      "invalid monitor id, only unicode letters/numbers/._- are allowed and max length is 64"
    );
  }
  return normalized;
}

function ensureInsideRoot(root: string, target: string): string {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new HttpError(400, "invalid path, out of monitors root");
  }
  return normalizedTarget;
}

function resolveMonitorDir(monitorsRoot: string, monitorId: string): string {
  return ensureInsideRoot(monitorsRoot, path.resolve(monitorsRoot, monitorId));
}

function resolveRelativeFile(monitorDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new HttpError(400, `absolute path is not allowed: ${relativePath}`);
  }
  return ensureInsideRoot(monitorDir, path.resolve(monitorDir, relativePath));
}

async function ensureDirExists(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function resolveMonitorFile(monitorDir: string): Promise<string | null> {
  for (const fileName of MONITOR_FILE_CANDIDATES) {
    const candidate = path.join(monitorDir, fileName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function prettyJson(text: string): string {
  if (!text.trim()) {
    return "{}\n";
  }
  const parsed = JSON.parse(text) as unknown;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function buildDefaultYaml(monitorId: string): string {
  const payload = {
    kind: "chart",
    name: monitorId,
    enabled: false,
    schedule: "*/5 * * * *",
    es: {
      node: "http://127.0.0.1:9200",
      username: "elastic",
      password: "replace_me",
      index: "demo-*",
      queryFile: "./query.json"
    },
    time: {
      field: "@timestamp",
      mode: "relative",
      last: "30m",
      timezone: "Asia/Shanghai"
    },
    metrics: [
      { name: "total_count", type: "count" },
      { name: "avg_latency", type: "avg", field: "latency" }
    ],
    groupBy: {
      type: "date_histogram",
      field: "@timestamp",
      interval: "5m",
      size: 20
    },
    chart: {
      type: "line",
      title: `${monitorId} dashboard`,
      width: 1200,
      height: 600,
      backgroundColor: "#ffffff",
      colors: ["#0ea5e9", "#f97316"],
      optionPatchFile: "./chart.json"
    },
    alert: {
      enabled: false
    },
    wecom: {
      webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=replace_me"
    }
  };

  return YAML.stringify(payload);
}

async function readTextOrDefault(filePath: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function parseMonitorYaml(monitorYaml: string): MonitorConfig {
  let raw: unknown;
  try {
    raw = YAML.parse(monitorYaml);
  } catch (error) {
    throw new HttpError(400, `monitor yaml parse failed: ${(error as Error).message}`);
  }

  const parsed = monitorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, `monitor yaml validate failed: ${parsed.error.message}`);
  }

  return parsed.data;
}

function resolveConfigRefs(monitorDir: string, monitorYamlObj: MonitorConfig): {
  queryPath?: string;
  chartPath?: string;
} {
  const queryPath = monitorYamlObj.es.queryFile
    ? resolveRelativeFile(monitorDir, monitorYamlObj.es.queryFile)
    : undefined;

  const chartPath = monitorYamlObj.chart.optionPatchFile
    ? resolveRelativeFile(monitorDir, monitorYamlObj.chart.optionPatchFile)
    : undefined;

  return { queryPath, chartPath };
}

async function writeMonitorFiles(
  monitorDir: string,
  monitorYaml: string,
  queryJson: string,
  chartJson: string
): Promise<void> {
  const configObj = parseMonitorYaml(monitorYaml);
  const refs = resolveConfigRefs(monitorDir, configObj);

  const normalizedMonitorYaml = monitorYaml.endsWith("\n") ? monitorYaml : `${monitorYaml}\n`;
  const normalizedQueryJson = prettyJson(queryJson);
  const normalizedChartJson = prettyJson(chartJson);

  await ensureDirExists(monitorDir);
  await fs.writeFile(path.join(monitorDir, DEFAULT_MONITOR_FILE), normalizedMonitorYaml, "utf8");

  if (refs.queryPath) {
    await ensureDirExists(path.dirname(refs.queryPath));
    await fs.writeFile(refs.queryPath, normalizedQueryJson, "utf8");
  }

  if (refs.chartPath) {
    await ensureDirExists(path.dirname(refs.chartPath));
    await fs.writeFile(refs.chartPath, normalizedChartJson, "utf8");
  }
}

export function parseMonitorYamlToConfig(monitorYaml: string): MonitorConfig {
  return parseMonitorYaml(monitorYaml);
}

export function stringifyMonitorConfig(input: unknown): string {
  const parsed = monitorSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, `monitor config validate failed: ${parsed.error.message}`);
  }
  return YAML.stringify(parsed.data);
}

export async function listMonitorSummaries(monitorsRoot: string): Promise<MonitorSummary[]> {
  await ensureDirExists(monitorsRoot);

  const entries = await fs.readdir(monitorsRoot, { withFileTypes: true });
  const summaries: MonitorSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const monitorId = entry.name;
    const monitorDir = resolveMonitorDir(monitorsRoot, monitorId);
    const monitorFile = await resolveMonitorFile(monitorDir);
    if (!monitorFile) {
      continue;
    }

    try {
      const monitorYaml = await fs.readFile(monitorFile, "utf8");
      const raw = YAML.parse(monitorYaml);
      const parsed = monitorSchema.parse(raw);

      summaries.push({
        id: monitorId,
        kind: parsed.kind,
        name: parsed.name,
        enabled: parsed.enabled,
        schedule: parsed.schedule,
        valid: true
      });
    } catch (error) {
      summaries.push({
        id: monitorId,
        kind: "chart",
        name: monitorId,
        enabled: false,
        schedule: "-",
        valid: false,
        error: (error as Error).message
      });
    }
  }

  summaries.sort((a, b) => a.id.localeCompare(b.id));
  return summaries;
}

export async function getMonitorDetail(
  monitorsRoot: string,
  monitorIdInput: string
): Promise<MonitorDetail> {
  const monitorId = ensureMonitorId(monitorIdInput);
  const monitorDir = resolveMonitorDir(monitorsRoot, monitorId);
  const monitorFile = await resolveMonitorFile(monitorDir);

  if (!monitorFile) {
    throw new HttpError(404, `monitor '${monitorId}' not found`);
  }

  const monitorYaml = await fs.readFile(monitorFile, "utf8");

  let queryJson = "{}\n";
  let chartJson = "{}\n";
  let monitorConfig: MonitorConfig | undefined;
  let monitorConfigError: string | undefined;

  try {
    const configObj = parseMonitorYaml(monitorYaml);
    monitorConfig = configObj;
    const refs = resolveConfigRefs(monitorDir, configObj);

    if (refs.queryPath) {
      queryJson = await readTextOrDefault(refs.queryPath, "{}\n");
    }

    if (refs.chartPath) {
      chartJson = await readTextOrDefault(refs.chartPath, "{}\n");
    }
  } catch (error) {
    monitorConfigError = (error as Error).message;
  }

  return {
    id: monitorId,
    monitorYaml,
    queryJson,
    chartJson,
    monitorConfig,
    monitorConfigError
  };
}

export async function createMonitor(
  monitorsRoot: string,
  payload: {
    id: string;
    monitorYaml?: string;
    queryJson?: string;
    chartJson?: string;
  }
): Promise<MonitorDetail> {
  const monitorId = ensureMonitorId(payload.id);
  const monitorDir = resolveMonitorDir(monitorsRoot, monitorId);

  try {
    await fs.access(monitorDir);
    throw new HttpError(409, `monitor '${monitorId}' already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const monitorYaml = payload.monitorYaml ?? buildDefaultYaml(monitorId);
  const queryJson = payload.queryJson ?? "{}\n";
  const chartJson = payload.chartJson ?? "{}\n";

  await writeMonitorFiles(monitorDir, monitorYaml, queryJson, chartJson);
  return getMonitorDetail(monitorsRoot, monitorId);
}

export async function updateMonitor(
  monitorsRoot: string,
  monitorIdInput: string,
  payload: {
    monitorYaml: string;
    queryJson: string;
    chartJson: string;
  }
): Promise<MonitorDetail> {
  const monitorId = ensureMonitorId(monitorIdInput);
  const monitorDir = resolveMonitorDir(monitorsRoot, monitorId);
  const monitorFile = await resolveMonitorFile(monitorDir);

  if (!monitorFile) {
    throw new HttpError(404, `monitor '${monitorId}' not found`);
  }

  await writeMonitorFiles(monitorDir, payload.monitorYaml, payload.queryJson, payload.chartJson);
  return getMonitorDetail(monitorsRoot, monitorId);
}

export async function updateMonitorByConfig(
  monitorsRoot: string,
  monitorIdInput: string,
  payload: {
    monitorConfig: unknown;
    queryJson: string;
    chartJson: string;
  }
): Promise<MonitorDetail> {
  const monitorYaml = stringifyMonitorConfig(payload.monitorConfig);
  return updateMonitor(monitorsRoot, monitorIdInput, {
    monitorYaml,
    queryJson: payload.queryJson,
    chartJson: payload.chartJson
  });
}

export async function deleteMonitor(
  monitorsRoot: string,
  monitorIdInput: string
): Promise<{ id: string }> {
  const monitorId = ensureMonitorId(monitorIdInput);
  const monitorDir = resolveMonitorDir(monitorsRoot, monitorId);
  const monitorFile = await resolveMonitorFile(monitorDir);
  if (!monitorFile) {
    throw new HttpError(404, `monitor '${monitorId}' not found`);
  }

  await fs.rm(monitorDir, { recursive: true, force: false });
  return { id: monitorId };
}
