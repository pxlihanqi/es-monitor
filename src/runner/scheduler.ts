import cron from "node-cron";
import type { LoadedMonitor, RunContext } from "../types.js";
import { logError, logInfo } from "../utils/logger.js";
import { runMonitor } from "./runMonitor.js";

interface ScheduledTaskLike {
  stop?: () => void;
  destroy?: () => void;
}

export interface SchedulerController {
  replace(monitors: LoadedMonitor[]): void;
  removeByNames(names: string[]): void;
  listNames(): string[];
}

class MonitorSchedulerController implements SchedulerController {
  private readonly context: RunContext;
  private readonly tasks = new Map<string, ScheduledTaskLike>();

  constructor(context: RunContext) {
    this.context = context;
  }

  replace(monitors: LoadedMonitor[]): void {
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

  removeByNames(names: string[]): void {
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

  listNames(): string[] {
    return Array.from(this.tasks.keys()).sort((a, b) => a.localeCompare(b));
  }

  private stopAll(): void {
    for (const [name, task] of this.tasks.entries()) {
      task.stop?.();
      task.destroy?.();
      logInfo(`monitor=${name} unscheduled`);
    }
    this.tasks.clear();
  }

  private scheduleOne(monitor: LoadedMonitor): void {
    if (!cron.validate(monitor.schedule)) {
      logError(`monitor=${monitor.name} has invalid cron: ${monitor.schedule}`);
      return;
    }

    const task = cron.schedule(monitor.schedule, async () => {
      try {
        await runMonitor(monitor, this.context);
      } catch (error) {
        logError(`monitor=${monitor.name} failed`, error);
      }
    }) as unknown as ScheduledTaskLike;

    this.tasks.set(monitor.name, task);
    logInfo(`monitor=${monitor.name} scheduled with cron=${monitor.schedule}`);
  }
}

export function startScheduler(monitors: LoadedMonitor[], context: RunContext): SchedulerController {
  const controller = new MonitorSchedulerController(context);
  controller.replace(monitors);
  return controller;
}

export async function runOnce(monitors: LoadedMonitor[], context: RunContext): Promise<void> {
  const enabled = monitors.filter((monitor) => monitor.enabled);

  if (enabled.length === 0) {
    logInfo("no enabled monitors to run once");
    return;
  }

  for (const monitor of enabled) {
    try {
      await runMonitor(monitor, context);
    } catch (error) {
      logError(`monitor=${monitor.name} failed`, error);
    }
  }
}
