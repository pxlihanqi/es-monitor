import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { monitorSchema } from "../types.js";
async function readYamlFile(filePath) {
    const content = await fs.readFile(filePath, "utf8");
    return YAML.parse(content);
}
async function readJsonFile(filePath) {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
}
async function resolveConfigFile(monitorDir) {
    const ymlPath = path.join(monitorDir, "monitor.yml");
    const yamlPath = path.join(monitorDir, "monitor.yaml");
    try {
        await fs.access(ymlPath);
        return ymlPath;
    }
    catch {
        // ignore
    }
    try {
        await fs.access(yamlPath);
        return yamlPath;
    }
    catch {
        return null;
    }
}
export async function loadMonitors(monitorsRoot) {
    await fs.mkdir(monitorsRoot, { recursive: true });
    const entries = await fs.readdir(monitorsRoot, { withFileTypes: true });
    const monitors = [];
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
        let queryBody;
        if (parsed.es.queryFile) {
            queryBody = await readJsonFile(path.resolve(monitorDir, parsed.es.queryFile));
        }
        else if (parsed.es.query && typeof parsed.es.query === "object") {
            queryBody = parsed.es.query;
        }
        let optionPatch;
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
