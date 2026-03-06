import path from "node:path";
import minimist from "minimist";
import { loadMonitors } from "./config/loadMonitors.js";
import { runOnce, startScheduler } from "./runner/scheduler.js";
import { logError, logInfo } from "./utils/logger.js";
import { startWebServer } from "./web/server.js";

interface CliArgs {
  once?: boolean;
  "dry-run"?: boolean;
  monitor?: string;
  "monitors-dir"?: string;
  web?: boolean;
  port?: string | number;
  help?: boolean;
}

function printHelp(): void {
  console.log(`
Usage: npm run dev -- [options]

Options:
  --once               Run monitors once and exit
  --dry-run            Generate image but do not send to WeCom
  --monitor <name>     Run/schedule only one monitor by name
  --monitors-dir <dir> Monitors directory (default: ./monitors)
  --web                Start browser config studio
  --port <port>        Web server port (default: 3100)
  --help               Print this help
`);
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2)) as CliArgs;

  if (argv.help) {
    printHelp();
    return;
  }

  const monitorsRoot = path.resolve(process.cwd(), argv["monitors-dir"] ?? "monitors");

  if (argv.web) {
    const port = Number(argv.port ?? 3100);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`invalid port: ${argv.port}`);
    }
    const monitors = await loadMonitors(monitorsRoot);
    const filtered = argv.monitor
      ? monitors.filter((monitor) => monitor.name === argv.monitor)
      : monitors;
    const context = {
      dryRun: Boolean(argv["dry-run"])
    };

    if (filtered.length === 0) {
      logInfo("web mode: no monitors found, scheduler is idle");
    } else {
      logInfo(`web mode loaded monitors: ${filtered.map((item) => item.name).join(", ")}`);
    }

    const scheduler = startScheduler(filtered, context);
    await startWebServer({ monitorsRoot, port, scheduler });
    return;
  }

  const monitors = await loadMonitors(monitorsRoot);

  const filtered = argv.monitor
    ? monitors.filter((monitor) => monitor.name === argv.monitor)
    : monitors;

  if (filtered.length === 0) {
    throw new Error("no monitors found (or monitor name not matched)");
  }

  const context = {
    dryRun: Boolean(argv["dry-run"])
  };

  logInfo(`loaded monitors: ${filtered.map((item) => item.name).join(", ")}`);

  if (argv.once) {
    await runOnce(filtered, context);
    return;
  }

  startScheduler(filtered, context);
  logInfo("scheduler started");
}

main().catch((error) => {
  logError("startup failed", error);
  process.exitCode = 1;
});
