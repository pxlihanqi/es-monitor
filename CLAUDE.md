# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Compile TypeScript (src/ → dist/)
npm run build

# Development: run without compiling
npm run dev -- [options]

# Start scheduler (requires build first)
npm run start -- [options]

# Start web config UI (builds then runs)
npm run start:web
# Opens at http://127.0.0.1:3100
```

**CLI options:**
```bash
--once                  # Run all monitors once and exit
--dry-run               # Generate chart image but skip WeCom notification
--monitor <name>        # Restrict to a single monitor by name
--monitors-dir <dir>    # Override monitors directory (default: ./monitors)
--web                   # Start browser config UI
--port <port>           # Web server port (default: 3100)
```

**Example (one-shot, no notification):**
```bash
npm run start -- --once --dry-run --monitor Nginx-seed
```

There are no tests configured in this project.

## Architecture

This tool queries Elasticsearch, builds aggregations, renders ECharts charts to PNG images, and sends them to WeCom (企业微信) robot webhooks via cron-scheduled tasks.

**Data flow for each monitor run:**

```
loadMonitors()         reads monitors/<name>/monitor.yaml + query.json + chart.json
    ↓
buildSearchBody()      converts MonitorConfig → Elasticsearch query DSL
    ↓
queryEs()              executes search against ES cluster
    ↓
transformResponse()    maps ES aggregation buckets → ChartDataset {categories, series, table}
    ↓
buildChartOption()     maps ChartDataset → ECharts option object (with optional patch from chart.json)
    ↓
renderChartToImage()   renders ECharts server-side via canvas + sharp → PNG buffer/base64/md5
    ↓
sendWecomImage()       POSTs base64 image to WeCom webhook
```

**Key source files:**

| Path | Purpose |
|------|---------|
| `src/types.ts` | All Zod schemas and TypeScript types (`monitorSchema`, `MonitorConfig`, `LoadedMonitor`, `ChartDataset`) |
| `src/index.ts` | Entry point; parses CLI args, selects run mode (once / scheduler / web) |
| `src/config/loadMonitors.ts` | Scans `monitors/` subdirectories, parses YAML+JSON, validates with Zod |
| `src/config/manageMonitors.ts` | CRUD operations on monitor directories (used by web API) |
| `src/es/buildSearchBody.ts` | Builds ES query DSL: time range, fuzzy conditions, `none`/`date_histogram`/`terms`/`composite` aggregations |
| `src/metrics/transform.ts` | Transforms ES response into `ChartDataset` for all groupBy modes |
| `src/chart/buildOption.ts` | Builds ECharts option; merges `optionPatch` from `chart.json` using deep merge |
| `src/chart/renderToImage.ts` | Server-side ECharts rendering to PNG |
| `src/runner/scheduler.ts` | `node-cron` scheduler with a `SchedulerController` (replace/remove/listNames) |
| `src/runner/runMonitor.ts` | Orchestrates one full monitor execution; saves `output/<timestamp>.png` and `output/latest-<type>.png` |
| `src/web/server.ts` | Vanilla Node.js HTTP server; serves `web/` static files and REST API at `/api/monitors` |
| `web/` | Frontend SPA (vanilla HTML/CSS/JS, no framework) |

**Module system:** ESM (`"type": "module"` in package.json). All imports must use `.js` extensions. TypeScript compiles with `NodeNext` module resolution.

## Monitor Configuration

Each monitor lives in `monitors/<name>/` with:
- `monitor.yaml` — required; validated by `monitorSchema` in `src/types.ts`
- `query.json` — optional; ES query DSL body (referenced by `es.queryFile`). May include top-level `fuzzyConditions` array.
- `chart.json` — optional; deep-merged onto the generated ECharts option (referenced by `chart.optionPatchFile`)
- `output/` — generated PNG files written here at runtime

**Key `monitor.yaml` fields:**
- `es.node`, `es.username`, `es.password`, `es.index` — ES connection (credentials required)
- `es.fuzzyConditions` — array of `{field, value}` wildcard filters merged with query
- `es.kql` — optional; KQL (Kibana Query Language) query string. When present, replaces `fuzzyConditions`, `queryFile`, and `query`. Example: `"status:200 and method:GET and not path:*/health"`
- `time.mode: relative | absolute` — relative uses `time.last` (e.g. `30m`, `2h`, `1d`); timezone locked to `Asia/Shanghai`
- `groupBy.type: none | date_histogram | terms` — `terms` supports multi-field composite agg via `groupBy.fields[]`
- `metrics[].type: count | avg | sum | min | max` — non-count types require `field`
- `chart.type: line | bar | table`
- `enabled: false` — skips scheduling without removing the monitor

**KQL Query Support:**
- When `es.kql` is configured, it takes precedence over `fuzzyConditions`, `queryFile`, and `query`
- Supports full KQL syntax: field matching, boolean operators (and/or/not), wildcards, range queries, nested fields
- Uses kql-to-elastic library for parsing, ensuring compatibility with Kibana Discover
- Example: `kql: "status:200 and method:GET and not path:*/health"`
