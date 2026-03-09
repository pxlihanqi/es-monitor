import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createMonitor, deleteMonitor, getMonitorDetail, HttpError, listMonitorSummaries, parseMonitorYamlToConfig, stringifyMonitorConfig, updateMonitor, updateMonitorByConfig } from "../config/manageMonitors.js";
import { buildChartOption } from "../chart/buildOption.js";
import { loadMonitors } from "../config/loadMonitors.js";
import { renderChartToImage } from "../chart/renderToImage.js";
import { queryEs } from "../es/queryEs.js";
import { transformResponse } from "../metrics/transform.js";
import { monitorSchema } from "../types.js";
import { getRuntimeLogs, logInfo } from "../utils/logger.js";
function parseJsonText(raw, fallback) {
    if (!raw || !raw.trim()) {
        return fallback;
    }
    return JSON.parse(raw);
}
function buildPreviewMonitor(body) {
    const parsed = monitorSchema.safeParse(body.monitorConfig);
    if (!parsed.success) {
        throw new HttpError(400, `monitor config validate failed: ${parsed.error.message}`);
    }
    return {
        ...parsed.data,
        monitorDir: process.cwd(),
        queryBody: parseJsonText(body.queryJson, {}),
        optionPatch: parseJsonText(body.chartJson, {})
    };
}
const WEB_ROOT = path.resolve(process.cwd(), "web");
function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
}
function sendText(res, statusCode, text) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(text);
}
function getFileContentType(filePath) {
    if (filePath.endsWith(".html")) {
        return "text/html; charset=utf-8";
    }
    if (filePath.endsWith(".css")) {
        return "text/css; charset=utf-8";
    }
    if (filePath.endsWith(".js")) {
        return "application/javascript; charset=utf-8";
    }
    return "application/octet-stream";
}
function getPathname(req) {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    return decodeURIComponent(url.pathname);
}
function getRequestUrl(req) {
    const host = req.headers.host ?? "127.0.0.1";
    return new URL(req.url ?? "/", `http://${host}`);
}
async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(data);
        total += data.length;
        if (total > 1_000_000) {
            throw new HttpError(413, "request body too large");
        }
    }
    if (chunks.length === 0) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch (error) {
        throw new HttpError(400, `invalid json body: ${error.message}`);
    }
}
async function serveStatic(req, res) {
    const pathname = getPathname(req);
    const target = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(WEB_ROOT, `.${target}`);
    if (!filePath.startsWith(`${WEB_ROOT}${path.sep}`) && filePath !== path.join(WEB_ROOT, "index.html")) {
        sendText(res, 403, "forbidden");
        return true;
    }
    try {
        const data = await fs.readFile(filePath);
        res.statusCode = 200;
        res.setHeader("content-type", getFileContentType(filePath));
        res.end(data);
        return true;
    }
    catch {
        return false;
    }
}
function getScopeConfig(scope, options) {
    if (scope === "exception") {
        return {
            monitorsRoot: options.exceptionMonitorsRoot,
            scheduler: options.schedulers?.exception,
            apiBase: "/api/exception-monitors"
        };
    }
    return {
        monitorsRoot: options.chartMonitorsRoot,
        scheduler: options.schedulers?.chart,
        apiBase: "/api/chart-monitors"
    };
}
function resolveApiScope(pathname) {
    if (pathname === "/api/chart-monitors" || pathname.startsWith("/api/chart-monitors/")) {
        return "chart";
    }
    if (pathname === "/api/exception-monitors" || pathname.startsWith("/api/exception-monitors/")) {
        return "exception";
    }
    return null;
}
function resolveMonitorId(pathname, apiBase) {
    const prefix = `${apiBase}/`;
    if (!pathname.startsWith(prefix)) {
        return null;
    }
    const id = pathname.slice(prefix.length).trim();
    return id || null;
}
export async function startWebServer(options) {
    const { chartMonitorsRoot, exceptionMonitorsRoot, port } = options;
    await fs.mkdir(chartMonitorsRoot, { recursive: true });
    await fs.mkdir(exceptionMonitorsRoot, { recursive: true });
    const server = createServer(async (req, res) => {
        try {
            const method = req.method ?? "GET";
            const requestUrl = getRequestUrl(req);
            const pathname = decodeURIComponent(requestUrl.pathname);
            const apiScope = resolveApiScope(pathname);
            if (apiScope && method === "GET" && pathname === getScopeConfig(apiScope, options).apiBase) {
                const { monitorsRoot } = getScopeConfig(apiScope, options);
                const list = await listMonitorSummaries(monitorsRoot);
                sendJson(res, 200, { data: list });
                return;
            }
            if (method === "GET" && pathname === "/api/runtime-logs") {
                const limitRaw = requestUrl.searchParams.get("limit");
                const limit = limitRaw ? Number(limitRaw) : 200;
                const logs = getRuntimeLogs(limit);
                sendJson(res, 200, { data: logs });
                return;
            }
            if (apiScope && method === "POST" && pathname === getScopeConfig(apiScope, options).apiBase) {
                const { monitorsRoot } = getScopeConfig(apiScope, options);
                const body = await readBody(req);
                if (!body.id) {
                    throw new HttpError(400, "field 'id' is required");
                }
                const detail = await createMonitor(monitorsRoot, {
                    id: body.id,
                    monitorYaml: body.monitorYaml,
                    queryJson: body.queryJson,
                    chartJson: body.chartJson
                });
                sendJson(res, 201, { data: detail });
                return;
            }
            if (apiScope && method === "POST" && pathname === `${getScopeConfig(apiScope, options).apiBase}/reload`) {
                const { monitorsRoot, scheduler } = getScopeConfig(apiScope, options);
                if (!scheduler) {
                    throw new HttpError(400, "scheduler is not enabled");
                }
                const monitors = await loadMonitors(monitorsRoot);
                scheduler.replace(monitors);
                sendJson(res, 200, {
                    data: {
                        scheduledNames: scheduler.listNames()
                    }
                });
                return;
            }
            if (method === "POST" && pathname === "/api/helpers/monitor/parse") {
                const body = await readBody(req);
                if (typeof body.monitorYaml !== "string") {
                    throw new HttpError(400, "field 'monitorYaml' is required");
                }
                const monitorConfig = parseMonitorYamlToConfig(body.monitorYaml);
                sendJson(res, 200, { data: { monitorConfig } });
                return;
            }
            if (method === "POST" && pathname === "/api/helpers/monitor/stringify") {
                const body = await readBody(req);
                const monitorYaml = stringifyMonitorConfig(body.monitorConfig);
                sendJson(res, 200, { data: { monitorYaml } });
                return;
            }
            if (method === "POST" && pathname === "/api/helpers/chart/preview") {
                const body = await readBody(req);
                const monitor = buildPreviewMonitor(body);
                const response = await queryEs(monitor);
                const dataset = transformResponse(monitor, response);
                const option = buildChartOption(monitor, dataset);
                const image = await renderChartToImage(option, monitor.chart.width, monitor.chart.height);
                sendJson(res, 200, { data: { dataUrl: `data:image/png;base64,${image.base64}` } });
                return;
            }
            const monitorId = apiScope
                ? resolveMonitorId(pathname, getScopeConfig(apiScope, options).apiBase)
                : null;
            if (monitorId) {
                const { monitorsRoot, scheduler } = getScopeConfig(apiScope, options);
                if (method === "GET") {
                    const detail = await getMonitorDetail(monitorsRoot, monitorId);
                    sendJson(res, 200, { data: detail });
                    return;
                }
                if (method === "PUT" && pathname.endsWith("/form")) {
                    const pureId = monitorId.replace(/\/form$/, "");
                    const body = await readBody(req);
                    const detail = await updateMonitorByConfig(monitorsRoot, pureId, {
                        monitorConfig: body.monitorConfig,
                        queryJson: body.queryJson ?? "",
                        chartJson: body.chartJson ?? ""
                    });
                    sendJson(res, 200, { data: detail });
                    return;
                }
                if (method === "PUT") {
                    const body = await readBody(req);
                    const detail = await updateMonitor(monitorsRoot, monitorId, {
                        monitorYaml: body.monitorYaml ?? "",
                        queryJson: body.queryJson ?? "",
                        chartJson: body.chartJson ?? ""
                    });
                    sendJson(res, 200, { data: detail });
                    return;
                }
                if (method === "DELETE") {
                    let scheduledNames = [];
                    try {
                        const detail = await getMonitorDetail(monitorsRoot, monitorId);
                        if (detail.monitorConfig?.name) {
                            scheduledNames.push(detail.monitorConfig.name);
                        }
                    }
                    catch {
                        // ignore, fallback to monitor id.
                    }
                    scheduledNames.push(monitorId);
                    const deleted = await deleteMonitor(monitorsRoot, monitorId);
                    if (scheduler) {
                        scheduler.removeByNames(scheduledNames);
                    }
                    sendJson(res, 200, { data: deleted });
                    return;
                }
            }
            const isStaticServed = await serveStatic(req, res);
            if (isStaticServed) {
                return;
            }
            sendJson(res, 404, { error: "not found" });
        }
        catch (error) {
            if (error instanceof HttpError) {
                sendJson(res, error.statusCode, { error: error.message });
                return;
            }
            sendJson(res, 500, { error: error.message });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
            server.off("error", reject);
            resolve();
        });
    });
    logInfo(`web config ui started at http://127.0.0.1:${port}`);
}
