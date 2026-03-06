import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createMonitor,
  deleteMonitor,
  getMonitorDetail,
  HttpError,
  listMonitorSummaries,
  parseMonitorYamlToConfig,
  stringifyMonitorConfig,
  updateMonitor,
  updateMonitorByConfig
} from "../config/manageMonitors.js";
import { loadMonitors } from "../config/loadMonitors.js";
import type { SchedulerController } from "../runner/scheduler.js";
import { getRuntimeLogs, logInfo } from "../utils/logger.js";

interface StartWebServerOptions {
  monitorsRoot: string;
  port: number;
  scheduler?: SchedulerController;
}

interface MonitorBody {
  id?: string;
  monitorYaml?: string;
  queryJson?: string;
  chartJson?: string;
  monitorConfig?: unknown;
}

const WEB_ROOT = path.resolve(process.cwd(), "web");

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
}

function getFileContentType(filePath: string): string {
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

function getPathname(req: IncomingMessage): string {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  return decodeURIComponent(url.pathname);
}

function getRequestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? "127.0.0.1";
  return new URL(req.url ?? "/", `http://${host}`);
}

async function readBody(req: IncomingMessage): Promise<MonitorBody> {
  const chunks: Buffer[] = [];
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
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as MonitorBody;
  } catch (error) {
    throw new HttpError(400, `invalid json body: ${(error as Error).message}`);
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
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
  } catch {
    return false;
  }
}

function resolveMonitorId(pathname: string): string | null {
  const prefix = "/api/monitors/";
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const id = pathname.slice(prefix.length).trim();
  return id || null;
}

export async function startWebServer(options: StartWebServerOptions): Promise<void> {
  const { monitorsRoot, port, scheduler } = options;

  await fs.mkdir(monitorsRoot, { recursive: true });

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const requestUrl = getRequestUrl(req);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (method === "GET" && pathname === "/api/monitors") {
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

      if (method === "POST" && pathname === "/api/monitors") {
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

      if (method === "POST" && pathname === "/api/monitors/reload") {
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

      const monitorId = resolveMonitorId(pathname);
      if (monitorId) {
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
          let scheduledNames: string[] = [];
          try {
            const detail = await getMonitorDetail(monitorsRoot, monitorId);
            if (detail.monitorConfig?.name) {
              scheduledNames.push(detail.monitorConfig.name);
            }
          } catch {
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
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      sendJson(res, 500, { error: (error as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  logInfo(`web config ui started at http://127.0.0.1:${port}`);
}
