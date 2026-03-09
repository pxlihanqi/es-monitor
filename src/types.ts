import { z } from "zod";

const metricTypeSchema = z.enum(["count", "avg", "sum", "min", "max"]);

const metricSchema = z
  .object({
    name: z.string().min(1),
    type: metricTypeSchema,
    field: z.string().optional(),
    minAvg: z.number().optional()
  })
  .superRefine((metric, ctx) => {
    if (metric.type !== "count" && !metric.field) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `metric '${metric.name}' must provide field when type is ${metric.type}`
      });
    }
  });

const groupBySchema = z
  .object({
    type: z.enum(["none", "date_histogram", "terms"]).default("none"),
    field: z.string().optional(),
    fields: z.array(z.string().min(1)).optional(),
    interval: z.string().optional(),
    size: z.number().int().positive().max(1000).default(20),
    sort: z.boolean().optional()
  })
  .superRefine((groupBy, ctx) => {
    if (groupBy.type === "date_histogram") {
      if (!groupBy.field) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "groupBy.field is required when type is date_histogram"
        });
      }
      if (!groupBy.interval) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "groupBy.interval is required when type is date_histogram"
        });
      }
    }

    if (groupBy.type === "terms") {
      const fields = groupBy.fields?.filter((item) => item.trim()) ?? [];
      const hasField = Boolean(groupBy.field?.trim());
      if (!hasField && fields.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "groupBy.field or groupBy.fields is required when type is terms"
        });
      }
    }
  })
  .default({ type: "none", size: 20 });

const timeSchema = z
  .object({
    field: z.string().default("@timestamp"),
    mode: z.enum(["relative", "absolute"]).default("relative"),
    last: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    timezone: z.string().default("Asia/Shanghai")
  })
  .superRefine((time, ctx) => {
    if (time.mode === "relative" && !time.last) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "time.last is required when mode is relative"
      });
    }
    if (time.mode === "absolute" && (!time.start || !time.end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "time.start and time.end are required when mode is absolute"
      });
    }
    if (time.timezone !== "Asia/Shanghai") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "time.timezone must be Asia/Shanghai (北京时间)"
      });
    }
  });

const chartSchema = z.object({
  type: z.enum(["line", "bar", "table"]).default("line"),
  title: z.string().default("ES Monitor"),
  width: z.number().int().positive().default(1200),
  height: z.number().int().positive().default(600),
  backgroundColor: z.string().default("#ffffff"),
  colors: z.array(z.string()).optional(),
  optionPatchFile: z.string().optional()
});

const wecomSchema = z.object({
  webhook: z.string().min(1)
});

const alertSchema = z
  .object({
    enabled: z.boolean().default(false),
    threshold: z.number().nonnegative().optional(),
    title: z.string().optional(),
    markdownTemplate: z.string().optional(),
    consecutiveCount: z.number().int().positive().default(1),
    cooldownMinutes: z.number().int().nonnegative().default(0)
  })
  .superRefine((alert, ctx) => {
    if (alert.enabled && typeof alert.threshold !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "alert.threshold is required when alert.enabled is true"
      });
    }
  });

const esSchema = z
  .object({
    node: z.string().min(1),
    username: z.string().optional(),
    password: z.string().optional(),
    index: z.string().min(1),
    queryFile: z.string().optional(),
    query: z.unknown().optional(),
    fuzzyConditions: z
      .array(
        z.object({
          field: z.string().min(1),
          value: z.string().min(1)
        })
      )
      .default([]),
    kql: z.string().optional()
  })
  .superRefine((es, ctx) => {
    if (!es.username || !es.username.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "es.username is required"
      });
    }
    if (!es.password || !es.password.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "es.password is required"
      });
    }
  });

export const monitorSchema = z.object({
  kind: z.enum(["chart", "exception"]).default("chart"),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  schedule: z.string().default("*/5 * * * *"),
  es: esSchema,
  time: timeSchema,
  metrics: z.array(metricSchema).min(1),
  groupBy: groupBySchema,
  chart: chartSchema,
  alert: alertSchema.default({ enabled: false }),
  wecom: wecomSchema
});

export type MonitorConfig = z.infer<typeof monitorSchema>;
export type MetricType = z.infer<typeof metricTypeSchema>;

export interface LoadedMonitor extends MonitorConfig {
  monitorDir: string;
  queryBody?: Record<string, unknown>;
  optionPatch?: Record<string, unknown>;
}

export interface SeriesData {
  name: string;
  data: number[];
}

export interface ChartDataset {
  categories: string[];
  series: SeriesData[];
  table: {
    columns: string[];
    rows: Array<Array<string | number>>;
  };
}

export interface RunContext {
  dryRun: boolean;
}
