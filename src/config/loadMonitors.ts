import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { monitorSchema, type LoadedMonitor } from "../types.js";

async function readYamlFile(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, "utf8");
  return YAML.parse(content);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

async function resolveConfigFile(monitorDir: string): Promise<string | null> {
  const ymlPath = path.join(monitorDir, "monitor.yml");
  const yamlPath = path.join(monitorDir, "monitor.yaml");

  try {
    await fs.access(ymlPath);
    return ymlPath;
  } catch {
    // ignore
  }

  try {
    await fs.access(yamlPath);
    return yamlPath;
  } catch {
    return null;
  }
}

export async function loadMonitors(monitorsRoot: string): Promise<LoadedMonitor[]> {
  await fs.mkdir(monitorsRoot, { recursive: true });
  const entries = await fs.readdir(monitorsRoot, { withFileTypes: true });
  const monitors: LoadedMonitor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const monitorDir = path.join(monitorsRoot, entry.name);
    const monitorConfigPath = await resolveConfigFile(monitorDir);
    if (!monitorConfigPath) {
      continue;
    }

    const rawConfig = await readYamlFile(monitorConfigPath);
    const parsed = monitorSchema.parse(rawConfig);

    let queryBody: Record<string, unknown> | undefined;
    if (parsed.es.queryFile) {
      queryBody = await readJsonFile(path.resolve(monitorDir, parsed.es.queryFile));
    } else if (parsed.es.query && typeof parsed.es.query === "object") {
      queryBody = parsed.es.query as Record<string, unknown>;
    }

    let optionPatch: Record<string, unknown> | undefined;
    if (parsed.chart.optionPatchFile) {
      optionPatch = await readJsonFile(path.resolve(monitorDir, parsed.chart.optionPatchFile));
    }

    monitors.push({
      ...parsed,
      monitorDir,
      queryBody,
      optionPatch
    });
  }

  return monitors;
}
