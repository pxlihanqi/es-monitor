import path from "node:path";
import minimist from "minimist";
import { loadMonitors } from "./config/loadMonitors.js";
import { runOnce, startScheduler } from "./runner/scheduler.js";
import { logError, logInfo } from "./utils/logger.js";
import { startWebServer } from "./web/server.js";
function printHelp() {
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
async function main() {
    const argv = minimist(process.argv.slice(2));
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
        const chartMonitorsRoot = path.resolve(monitorsRoot, "chart");
        const exceptionMonitorsRoot = path.resolve(monitorsRoot, "exception");
        const chartMonitors = await loadMonitors(chartMonitorsRoot);
        const exceptionMonitors = await loadMonitors(exceptionMonitorsRoot);
        const filteredChart = argv.monitor
            ? chartMonitors.filter((monitor) => monitor.name === argv.monitor)
            : chartMonitors;
        const filteredException = argv.monitor
            ? exceptionMonitors.filter((monitor) => monitor.name === argv.monitor)
            : exceptionMonitors;
        const context = {
            dryRun: Boolean(argv["dry-run"])
        };
        logInfo(`web mode loaded chart monitors: ${filteredChart.length > 0 ? filteredChart.map((item) => item.name).join(", ") : "none"}`);
        logInfo(`web mode loaded exception monitors: ${filteredException.length > 0 ? filteredException.map((item) => item.name).join(", ") : "none"}`);
        const chartScheduler = startScheduler(filteredChart, context);
        const exceptionScheduler = startScheduler(filteredException, context);
        await startWebServer({
            chartMonitorsRoot,
            exceptionMonitorsRoot,
            port,
            schedulers: {
                chart: chartScheduler,
                exception: exceptionScheduler
            }
        });
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
