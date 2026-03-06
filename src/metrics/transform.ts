import type { estypes } from "@elastic/elasticsearch";
import type { ChartDataset, LoadedMonitor } from "../types.js";

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function readMetricValue(metricName: string, bucketOrAgg: Record<string, unknown>): number {
  const metric = bucketOrAgg[metricName] as { value?: number } | undefined;
  return toNumber(metric?.value);
}

function toCategoryLabel(bucket: Record<string, unknown>): string {
  const keyAsString = bucket.key_as_string;
  if (typeof keyAsString === "string") {
    return keyAsString;
  }

  const key = bucket.key;
  if (typeof key === "string" || typeof key === "number" || typeof key === "boolean") {
    return String(key);
  }

  if (key && typeof key === "object" && !Array.isArray(key)) {
    const entries = Object.entries(key as Record<string, unknown>).map(
      ([k, v]) => `${k}:${String(v)}`
    );
    return entries.join(" | ");
  }

  return "unknown";
}

export function transformResponse(
  monitor: LoadedMonitor,
  response: estypes.SearchResponse<Record<string, unknown>>
): ChartDataset {
  if (monitor.groupBy.type === "none") {
    const categories: string[] = [];
    const values: number[] = [];

    const totalCount = toNumber((response.hits.total as { value?: number } | undefined)?.value);
    const aggs = (response.aggregations ?? {}) as Record<string, unknown>;

    for (const metric of monitor.metrics) {
      categories.push(metric.name);
      if (metric.type === "count") {
        values.push(totalCount);
      } else {
        values.push(readMetricValue(metric.name, aggs));
      }
    }

    return {
      categories,
      series: [{ name: "value", data: values }],
      table: {
        columns: ["metric", "value"],
        rows: categories.map((name, index) => [name, values[index]])
      }
    };
  }

  const aggs = (response.aggregations ?? {}) as {
    group_by?: {
      buckets?: Array<Record<string, unknown>>;
    };
  };

  const buckets = aggs.group_by?.buckets ?? [];

  // Filter buckets based on minAvg threshold
  const filteredBuckets = buckets.filter((bucket) => {
    for (const metric of monitor.metrics) {
      if (metric.minAvg !== undefined) {
        const value = metric.type === "count"
          ? toNumber(bucket.doc_count)
          : readMetricValue(metric.name, bucket);
        if (value < metric.minAvg) {
          return false;
        }
      }
    }
    return true;
  });

  const categories = filteredBuckets.map((bucket) => toCategoryLabel(bucket));

  const series = monitor.metrics.map((metric) => {
    const data = filteredBuckets.map((bucket) => {
      if (metric.type === "count") {
        return toNumber(bucket.doc_count);
      }
      return readMetricValue(metric.name, bucket);
    });

    return {
      name: metric.name,
      data
    };
  });

  const rows = filteredBuckets.map((bucket, rowIndex) => {
    const row: Array<string | number> = [categories[rowIndex]];
    for (const metric of monitor.metrics) {
      if (metric.type === "count") {
        row.push(toNumber(bucket.doc_count));
      } else {
        row.push(readMetricValue(metric.name, bucket));
      }
    }
    return row;
  });

  return {
    categories,
    series,
    table: {
      columns: [
        monitor.groupBy.fields?.length ? monitor.groupBy.fields.join(",") : monitor.groupBy.field ?? "group",
        ...monitor.metrics.map((m) => m.name)
      ],
      rows
    }
  };
}
