import { deepMerge } from "../utils/deepMerge.js";
import type { ChartDataset, LoadedMonitor } from "../types.js";

function parseDateValue(raw: string): Date | null {
  // Plain numbers (e.g. status codes "200", "404") must not be treated as year values
  if (/^\d+$/.test(raw.trim())) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCategories(categories: string[]): string[] {
  if (categories.length === 0) {
    return categories;
  }

  const parsed = categories.map((item) => parseDateValue(item));
  if (parsed.some((item) => item === null)) {
    return categories;
  }

  const timezone = "Asia/Shanghai";
  const dayFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const uniqueDays = new Set(parsed.map((item) => dayFormatter.format(item as Date)));
  const isCrossDay = uniqueDays.size > 1;

  const labelFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: isCrossDay ? "2-digit" : undefined,
    day: isCrossDay ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return parsed.map((item) => {
    const text = labelFormatter.format(item as Date);
    return isCrossDay ? text.replace("/", "-").replace(" ", " ") : text;
  });
}

function buildLineOrBarOption(monitor: LoadedMonitor, data: ChartDataset): Record<string, unknown> {
  // Only format as dates when groupBy is date_histogram
  const displayCategories = monitor.groupBy.type === 'date_histogram'
    ? formatCategories(data.categories)
    : data.categories;

  // X轴显示分组字段值，Y轴显示指标值
  return {
    backgroundColor: monitor.chart.backgroundColor,
    color: monitor.chart.colors,
    title: {
      text: monitor.chart.title,
      left: "center"
    },
    tooltip: {
      trigger: "axis"
    },
    legend: {
      top: 35
    },
    grid: {
      left: 50,
      right: 30,
      top: 80,
      bottom: 60
    },
    xAxis: {
      type: "category",
      data: displayCategories,
      axisLabel: {
        rotate: displayCategories.length > 10 ? 35 : 0
      }
    },
    yAxis: {
      type: "value"
    },
    series: data.series.map((series) => ({
      name: series.name,
      type: monitor.chart.type,
      data: series.data,
      smooth: monitor.chart.type === "line"
    }))
  };
}

function buildTableOption(monitor: LoadedMonitor, data: ChartDataset): Record<string, unknown> {
  const columns = data.table.columns;
  const rows = data.table.rows;
  const padding = 24;
  const topOffset = 60;
  const rowHeight = 34;
  const colWidth = Math.floor((monitor.chart.width - padding * 2) / Math.max(columns.length, 1));

  const elements: Array<Record<string, unknown>> = [
    {
      type: "text",
      left: "center",
      top: 12,
      style: {
        text: monitor.chart.title,
        fontSize: 20,
        fontWeight: 600,
        fill: "#1f2937"
      }
    }
  ];

  columns.forEach((column, colIndex) => {
    const x = padding + colIndex * colWidth;

    elements.push({
      type: "rect",
      shape: {
        x,
        y: topOffset,
        width: colWidth,
        height: rowHeight
      },
      style: {
        fill: "#eef2ff",
        stroke: "#d1d5db",
        lineWidth: 1
      }
    });

    elements.push({
      type: "text",
      style: {
        text: String(column),
        x: x + 8,
        y: topOffset + 22,
        fill: "#111827",
        font: "bold 14px sans-serif"
      }
    });
  });

  rows.forEach((row, rowIndex) => {
    const y = topOffset + rowHeight * (rowIndex + 1);

    row.forEach((cell, colIndex) => {
      const x = padding + colIndex * colWidth;
      elements.push({
        type: "rect",
        shape: {
          x,
          y,
          width: colWidth,
          height: rowHeight
        },
        style: {
          fill: rowIndex % 2 === 0 ? "#ffffff" : "#f9fafb",
          stroke: "#e5e7eb",
          lineWidth: 1
        }
      });

      elements.push({
        type: "text",
        style: {
          text: String(cell),
          x: x + 8,
          y: y + 22,
          fill: "#111827",
          font: "13px sans-serif"
        }
      });
    });
  });

  return {
    backgroundColor: monitor.chart.backgroundColor,
    animation: false,
    graphic: {
      elements
    }
  };
}

export function buildChartOption(monitor: LoadedMonitor, data: ChartDataset): Record<string, unknown> {
  const base =
    monitor.chart.type === "table"
      ? buildTableOption(monitor, data)
      : buildLineOrBarOption(monitor, data);

  return deepMerge(base, monitor.optionPatch);
}
