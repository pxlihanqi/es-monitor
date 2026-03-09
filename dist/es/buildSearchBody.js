import ms from "ms";
import { kqlToEsQuery } from "./kqlToQuery.js";
function toBeijingOffsetISOString(date) {
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
function parseAbsoluteTimeAsBeijing(value) {
    const raw = value.trim();
    if (!raw) {
        throw new Error("invalid empty absolute time value");
    }
    const hasOffset = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw);
    const normalized = hasOffset ? raw : `${raw}+08:00`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`invalid time value: ${value}`);
    }
    return toBeijingOffsetISOString(date);
}
function normalizeRelativeDuration(last) {
    const raw = String(last ?? "").trim().toLowerCase();
    if (!raw) {
        return raw;
    }
    const compact = raw.replace(/\s+/g, "");
    const matched = compact.match(/^(\d+)([a-z\u4e00-\u9fa5]+)?$/i);
    if (!matched) {
        return compact;
    }
    const amount = matched[1];
    const unit = matched[2] ?? "m";
    const minuteUnits = new Set(["m", "min", "mins", "minute", "minutes", "分", "分钟"]);
    const hourUnits = new Set(["h", "hr", "hrs", "hour", "hours", "小时", "时"]);
    const dayUnits = new Set(["d", "day", "days", "天"]);
    if (minuteUnits.has(unit)) {
        return `${amount}m`;
    }
    if (hourUnits.has(unit)) {
        return `${amount}h`;
    }
    if (dayUnits.has(unit)) {
        return `${amount}d`;
    }
    return compact;
}
function resolveTimeRange(config) {
    const now = new Date();
    if (config.time.mode === "relative") {
        const normalizedLast = normalizeRelativeDuration(config.time.last ?? "");
        const duration = ms(normalizedLast);
        if (typeof duration !== "number" || duration <= 0) {
            throw new Error(`invalid time.last value: ${config.time.last}`);
        }
        const start = new Date(now.getTime() - duration);
        return {
            gte: toBeijingOffsetISOString(start),
            lte: toBeijingOffsetISOString(now)
        };
    }
    return {
        gte: parseAbsoluteTimeAsBeijing(config.time.start ?? ""),
        lte: parseAbsoluteTimeAsBeijing(config.time.end ?? "")
    };
}
function buildMetricAgg(metric) {
    if (metric.type === "count") {
        return {};
    }
    return {
        [metric.type]: {
            field: metric.field
        }
    };
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isEmptyObject(value) {
    return isPlainObject(value) && Object.keys(value).length === 0;
}
function resolveBaseQuery(queryBody) {
    if (!queryBody) {
        return { match_all: {} };
    }
    if (typeof queryBody.query === "object" && queryBody.query !== null) {
        const query = queryBody.query;
        return isEmptyObject(query) ? { match_all: {} } : query;
    }
    return isEmptyObject(queryBody) ? { match_all: {} } : queryBody;
}
function resolveFuzzyConditions(monitor) {
    const fromConfig = monitor.es.fuzzyConditions ?? [];
    const fromQueryBody = Array.isArray(monitor.queryBody?.fuzzyConditions)
        ? (monitor.queryBody?.fuzzyConditions)
            .map((item) => ({
            field: String(item.field ?? "").trim(),
            value: String(item.value ?? "").trim()
        }))
            .filter((item) => item.field && item.value)
        : [];
    return [...fromConfig, ...fromQueryBody];
}
function resolveTermsFields(monitor) {
    const fields = monitor.groupBy.fields?.map((item) => item.trim()).filter(Boolean) ?? [];
    if (fields.length > 0) {
        return fields;
    }
    const single = monitor.groupBy.field?.trim();
    return single ? [single] : [];
}
function resolveQuery(monitor) {
    // 优先使用 KQL
    if (monitor.es.kql?.trim()) {
        return kqlToEsQuery(monitor.es.kql, monitor.es.index);
    }
    // 回退到现有逻辑
    const baseQuery = resolveBaseQuery(monitor.queryBody);
    const fuzzyClauses = resolveFuzzyConditions(monitor).map((item) => ({
        wildcard: {
            [item.field]: {
                value: `*${item.value}*`,
                case_insensitive: true
            }
        }
    }));
    if (fuzzyClauses.length === 0) {
        return baseQuery;
    }
    return {
        bool: {
            must: [baseQuery, ...fuzzyClauses]
        }
    };
}
export function buildSearchBody(monitor) {
    const timeRange = resolveTimeRange(monitor);
    const query = resolveQuery(monitor);
    const boolFilter = [
        {
            range: {
                [monitor.time.field]: {
                    gte: timeRange.gte,
                    lte: timeRange.lte,
                    time_zone: monitor.time.timezone
                }
            }
        }
    ];
    const finalQuery = {
        bool: {
            filter: boolFilter,
            must: [query]
        }
    };
    const body = {
        size: 0,
        track_total_hits: true,
        query: finalQuery
    };
    if (monitor.groupBy.type === "none") {
        const aggs = {};
        for (const metric of monitor.metrics) {
            if (metric.type === "count") {
                continue;
            }
            aggs[metric.name] = buildMetricAgg(metric);
        }
        if (Object.keys(aggs).length > 0) {
            body.aggs = aggs;
        }
        return body;
    }
    const subAggs = {};
    for (const metric of monitor.metrics) {
        if (metric.type === "count") {
            continue;
        }
        subAggs[metric.name] = buildMetricAgg(metric);
    }
    if (monitor.groupBy.type === "date_histogram") {
        const dateHistogramConfig = {
            field: monitor.groupBy.field,
            fixed_interval: monitor.groupBy.interval,
            time_zone: monitor.time.timezone,
            min_doc_count: 0
        };
        if (monitor.groupBy.sort) {
            const sortKey = monitor.metrics.length > 0 && monitor.metrics[0].type !== "count"
                ? monitor.metrics[0].name
                : "_count";
            dateHistogramConfig.order = { [sortKey]: "desc" };
        }
        body.aggs = {
            group_by: {
                date_histogram: dateHistogramConfig,
                aggs: subAggs
            }
        };
        return body;
    }
    const termsFields = resolveTermsFields(monitor);
    if (termsFields.length > 1) {
        body.aggs = {
            group_by: {
                composite: {
                    size: monitor.groupBy.size,
                    sources: termsFields.map((field) => ({
                        [field.replace(/\./g, "_")]: {
                            terms: { field }
                        }
                    }))
                },
                aggs: subAggs
            }
        };
        return body;
    }
    const termsConfig = {
        field: termsFields[0] ?? monitor.groupBy.field,
        size: monitor.groupBy.size
    };
    if (monitor.groupBy.sort) {
        const sortKey = monitor.metrics.length > 0 && monitor.metrics[0].type !== "count"
            ? monitor.metrics[0].name
            : "_count";
        termsConfig.order = { [sortKey]: "desc" };
    }
    body.aggs = {
        group_by: {
            terms: termsConfig,
            aggs: subAggs
        }
    };
    return body;
}
