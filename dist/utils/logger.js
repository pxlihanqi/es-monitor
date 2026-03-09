const MAX_RUNTIME_LOGS = 1000;
const runtimeLogs = [];
let nextLogId = 1;
function toBeijingTimeString(date) {
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
function pushRuntimeLog(level, message) {
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
export function logInfo(message) {
    pushRuntimeLog("INFO", message);
    console.log(`[${toBeijingTimeString(new Date())}] [INFO] ${message}`);
}
export function logError(message, error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : error ? String(error) : "";
    pushRuntimeLog("ERROR", detail ? `${message} | ${detail}` : message);
    console.error(`[${toBeijingTimeString(new Date())}] [ERROR] ${message}`);
    if (error) {
        console.error(error);
    }
}
export function getRuntimeLogs(limit = 200) {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 1000)) : 200;
    return runtimeLogs.slice(-safeLimit);
}
