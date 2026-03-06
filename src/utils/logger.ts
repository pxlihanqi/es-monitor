export interface RuntimeLogItem {
  id: number;
  timestamp: string;
  level: "INFO" | "ERROR";
  message: string;
}

const MAX_RUNTIME_LOGS = 1000;
const runtimeLogs: RuntimeLogItem[] = [];
let nextLogId = 1;

function toBeijingTimeString(date: Date): string {
  const beijingMs = date.getTime() + 8 * 60 * 60 * 1000;
  const beijingDate = new Date(beijingMs);
  const yyyy = beijingDate.getUTCFullYear();
  const mm = String(beijingDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(beijingDate.getUTCDate()).padStart(2, "0");
  const hh = String(beijingDate.getUTCHours()).padStart(2, "0");
  const mi = String(beijingDate.getUTCMinutes()).padStart(2, "0");
  const ss = String(beijingDate.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`;
}

function pushRuntimeLog(level: RuntimeLogItem["level"], message: string): void {
  runtimeLogs.push({
    id: nextLogId++,
    timestamp: toBeijingTimeString(new Date()),
    level,
    message
  });

  if (runtimeLogs.length > MAX_RUNTIME_LOGS) {
    runtimeLogs.splice(0, runtimeLogs.length - MAX_RUNTIME_LOGS);
  }
}

export function logInfo(message: string): void {
  pushRuntimeLog("INFO", message);
  console.log(`[${toBeijingTimeString(new Date())}] [INFO] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : error ? String(error) : "";
  pushRuntimeLog("ERROR", detail ? `${message} | ${detail}` : message);
  console.error(`[${toBeijingTimeString(new Date())}] [ERROR] ${message}`);
  if (error) {
    console.error(error);
  }
}

export function getRuntimeLogs(limit = 200): RuntimeLogItem[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 1000)) : 200;
  return runtimeLogs.slice(-safeLimit);
}
