import cron from "node-cron";
import { logError, logInfo } from "../utils/logger.js";
import { runMonitor } from "./runMonitor.js";
class MonitorSchedulerController {
    context;
    tasks = new Map();
    constructor(context) {
        this.context = context;
    }
    replace(monitors) {
        this.stopAll();
        const enabled = monitors.filter((monitor) => monitor.enabled);
        if (enabled.length === 0) {
            logInfo("no enabled monitors, scheduler is idle");
            return;
        }
        for (const monitor of enabled) {
            this.scheduleOne(monitor);
        }
    }
    removeByNames(names) {
        for (const name of names) {
            const task = this.tasks.get(name);
            if (!task) {
                continue;
            }
            task.stop?.();
            task.destroy?.();
            this.tasks.delete(name);
            logInfo(`monitor=${name} unscheduled`);
        }
    }
    listNames() {
        return Array.from(this.tasks.keys()).sort((a, b) => a.localeCompare(b));
    }
    stopAll() {
        for (const [name, task] of this.tasks.entries()) {
            task.stop?.();
            task.destroy?.();
            logInfo(`monitor=${name} unscheduled`);
        }
        this.tasks.clear();
    }
    scheduleOne(monitor) {
        if (!cron.validate(monitor.schedule)) {
            logError(`monitor=${monitor.name} has invalid cron: ${monitor.schedule}`);
            return;
        }
        const task = cron.schedule(monitor.schedule, async () => {
            try {
                await runMonitor(monitor, this.context);
            }
            catch (error) {
                logError(`monitor=${monitor.name} failed`, error);
            }
        });
        this.tasks.set(monitor.name, task);
        logInfo(`monitor=${monitor.name} scheduled with cron=${monitor.schedule}`);
    }
}
export function startScheduler(monitors, context) {
    const controller = new MonitorSchedulerController(context);
    controller.replace(monitors);
    return controller;
}
export async function runOnce(monitors, context) {
    const enabled = monitors.filter((monitor) => monitor.enabled);
    if (enabled.length === 0) {
        logInfo("no enabled monitors to run once");
        return;
    }
    for (const monitor of enabled) {
        try {
            await runMonitor(monitor, context);
        }
        catch (error) {
            logError(`monitor=${monitor.name} failed`, error);
        }
    }
}
