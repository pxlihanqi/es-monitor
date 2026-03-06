const state = {
  monitors: [],
  selectedId: ""
};

const monitorListEl = document.getElementById("monitorList");
const countBadgeEl = document.getElementById("countBadge");
const statusEl = document.getElementById("status");
const editorTitleEl = document.getElementById("editorTitle");
const editorPanelEl = document.getElementById("editorPanel");

const monitorYamlEl = document.getElementById("monitorYaml");
const queryJsonEl = document.getElementById("queryJson");
const chartJsonEl = document.getElementById("chartJson");

const saveRawBtnEl = document.getElementById("saveRawBtn");
const saveAndReloadBtnEl = document.getElementById("saveAndReloadBtn");
const refreshBtnEl = document.getElementById("refreshBtn");
const createBtnEl = document.getElementById("createBtn");
const addMetricBtnEl = document.getElementById("addMetricBtn");
const addChartColorBtnEl = document.getElementById("addChartColorBtn");
const metricsRowsEl = document.getElementById("metricsRows");
const chartColorRowsEl = document.getElementById("chartColorRows");
const syncFromYamlBtnEl = document.getElementById("syncFromYamlBtn");
const syncToYamlBtnEl = document.getElementById("syncToYamlBtn");
const refreshLogsBtnEl = document.getElementById("refreshLogsBtn");
const toggleLogsBtnEl = document.getElementById("toggleLogsBtn");
const runtimeLogsEl = document.getElementById("runtimeLogs");
const floatingLogPanelEl = document.getElementById("floatingLogPanel");
const floatingLogHeaderEl = document.getElementById("floatingLogHeader");

const formEls = {
  name: document.getElementById("f_name"),
  enabled: document.getElementById("f_enabled"),
  schedule: document.getElementById("f_schedule"),
  esNode: document.getElementById("f_es_node"),
  esUsername: document.getElementById("f_es_username"),
  esPassword: document.getElementById("f_es_password"),
  esIndex: document.getElementById("f_es_index"),
  esKql: document.getElementById("f_es_kql"),
  esQueryFile: document.getElementById("f_es_query_file"),
  esFuzzyConditions: document.getElementById("f_es_fuzzy_conditions"),
  timeField: document.getElementById("f_time_field"),
  timeMode: document.getElementById("f_time_mode"),
  timeLastValue: document.getElementById("f_time_last_value"),
  timeLastUnit: document.getElementById("f_time_last_unit"),
  timeStart: document.getElementById("f_time_start"),
  timeEnd: document.getElementById("f_time_end"),
  timeTimezone: document.getElementById("f_time_timezone"),
  groupType: document.getElementById("f_group_type"),
  groupField: document.getElementById("f_group_field"),
  groupInterval: document.getElementById("f_group_interval"),
  groupSize: document.getElementById("f_group_size"),
  groupSort: document.getElementById("f_group_sort"),
  chartType: document.getElementById("f_chart_type"),
  chartTitle: document.getElementById("f_chart_title"),
  chartWidth: document.getElementById("f_chart_width"),
  chartHeight: document.getElementById("f_chart_height"),
  chartBg: document.getElementById("f_chart_bg"),
  chartPatchFile: document.getElementById("f_chart_patch_file"),
  wecomWebhook: document.getElementById("f_wecom_webhook")
};
let runtimeLogTimer = null;
let isLogsMinimized = false;
const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function setStatus(type, text) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = text;
}

function sanitizeMessage(error) {
  if (!error) {
    return "unknown error";
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function intOrDefault(raw, defaultValue) {
  if (raw === "" || raw === null || raw === undefined) {
    return defaultValue;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`数值无效: ${raw}`);
  }
  return Math.trunc(n);
}

function optionalText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHexColor(input) {
  const value = String(input ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const c1 = value[1];
    const c2 = value[2];
    const c3 = value[3];
    return `#${c1}${c1}${c2}${c2}${c3}${c3}`.toLowerCase();
  }
  return "#0ea5e9";
}

function appendChartColorRow(color = "#0ea5e9") {
  const row = document.createElement("div");
  row.className = "color-row";
  row.innerHTML = `
    <input data-role="chart-color-picker" type="color" value="${normalizeHexColor(color)}" />
    <input data-role="chart-color-text" type="text" value="${normalizeHexColor(color)}" />
    <button data-role="chart-color-remove" type="button" class="danger-light">删除</button>
  `;

  const pickerEl = row.querySelector('[data-role="chart-color-picker"]');
  const textEl = row.querySelector('[data-role="chart-color-text"]');
  const removeEl = row.querySelector('[data-role="chart-color-remove"]');

  pickerEl.addEventListener("input", () => {
    textEl.value = pickerEl.value;
  });
  textEl.addEventListener("change", () => {
    const normalized = normalizeHexColor(textEl.value);
    textEl.value = normalized;
    pickerEl.value = normalized;
  });
  removeEl.addEventListener("click", () => {
    row.remove();
    if (chartColorRowsEl.children.length === 0) {
      appendChartColorRow("#0ea5e9");
    }
  });

  chartColorRowsEl.appendChild(row);
}

function renderChartColors(colors = []) {
  chartColorRowsEl.innerHTML = "";
  if (!Array.isArray(colors) || colors.length === 0) {
    appendChartColorRow("#0ea5e9");
    appendChartColorRow("#f97316");
    return;
  }
  for (const color of colors) {
    appendChartColorRow(String(color));
  }
}

function collectChartColors() {
  const rows = chartColorRowsEl.querySelectorAll(".color-row");
  const list = [];
  rows.forEach((row) => {
    const textEl = row.querySelector('[data-role="chart-color-text"]');
    list.push(normalizeHexColor(textEl.value));
  });
  return list.length > 0 ? list : undefined;
}

function parseFuzzyConditionsText(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const conditions = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx === line.length - 1) {
      throw new Error(`模糊条件格式错误: ${line}，应为 field:value`);
    }
    const field = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!field || !value) {
      throw new Error(`模糊条件格式错误: ${line}`);
    }
    conditions.push({ field, value });
  }
  return conditions;
}

function parseGroupFields(input) {
  return String(input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFuzzyConditionsText(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return "";
  }
  return conditions
    .map((item) => `${item.field ?? ""}:${item.value ?? ""}`)
    .filter((line) => line !== ":")
    .join("\n");
}

function parseRelativeLast(lastRaw) {
  const raw = String(lastRaw ?? "").trim().toLowerCase();
  const matched = raw.replace(/\s+/g, "").match(/^(\d+)([a-z\u4e00-\u9fa5]+)?$/);
  if (!matched) {
    return { value: "30", unit: "m" };
  }

  const value = matched[1];
  const unitRaw = matched[2] || "m";

  if (["m", "min", "mins", "minute", "minutes", "分", "分钟"].includes(unitRaw)) {
    return { value, unit: "m" };
  }
  if (["h", "hr", "hrs", "hour", "hours", "时", "小时"].includes(unitRaw)) {
    return { value, unit: "h" };
  }
  if (["d", "day", "days", "天"].includes(unitRaw)) {
    return { value, unit: "d" };
  }

  return { value: "30", unit: "m" };
}

function composeRelativeLast() {
  const value = intOrDefault(formEls.timeLastValue.value, 30);
  if (value <= 0) {
    throw new Error("time.lastValue 必须大于 0");
  }
  const unit = formEls.timeLastUnit.value || "m";
  return `${value}${unit}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `request failed: ${response.status}`);
  }

  return body;
}

function renderMonitorList() {
  monitorListEl.innerHTML = "";
  countBadgeEl.textContent = String(state.monitors.length);

  for (const monitor of state.monitors) {
    const item = document.createElement("li");
    item.className = `monitor-item${state.selectedId === monitor.id ? " selected" : ""}${
      monitor.valid ? "" : " invalid"
    }`;

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "monitor-open-btn";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = monitor.id;

    const meta = document.createElement("span");
    meta.className = "meta";
    const status = monitor.enabled ? "enabled" : "disabled";
    const validTag = monitor.valid ? "" : " · invalid";
    meta.textContent = `${status} · ${monitor.schedule}${validTag}`;

    openBtn.append(name, meta);
    openBtn.addEventListener("click", () => {
      loadMonitorDetail(monitor.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "danger-light monitor-delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteMonitor(monitor.id);
    });

    item.append(openBtn, deleteBtn);
    monitorListEl.appendChild(item);
  }
}

async function deleteMonitor(monitorId) {
  const confirmed = window.confirm(`确认删除监控 ${monitorId} 吗？会删除对应配置目录。`);
  if (!confirmed) {
    return;
  }

  setStatus("loading", `Deleting ${monitorId}`);
  try {
    await request(`/api/monitors/${encodeURIComponent(monitorId)}`, {
      method: "DELETE"
    });

    if (state.selectedId === monitorId) {
      state.selectedId = "";
      monitorYamlEl.value = "";
      queryJsonEl.value = "";
      chartJsonEl.value = "";
      renderMetrics([]);
      editorTitleEl.textContent = "未选择监控";
    }

    await loadMonitorList(false);
    setStatus("ok", `Deleted ${monitorId}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function reloadMonitorConfig() {
  setStatus("loading", "Reloading config");
  try {
    const result = await request("/api/monitors/reload", {
      method: "POST",
      body: JSON.stringify({})
    });
    await loadMonitorList(false);
    await loadRuntimeLogs();
    const names = (result.data?.scheduledNames || []).join(", ");
    setStatus("ok", names ? `Reloaded: ${names}` : "Reloaded");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

function formatRuntimeLog(log) {
  const rawTs = log?.timestamp;
  const parsed = new Date(rawTs);
  const displayTs = Number.isNaN(parsed.getTime())
    ? String(rawTs ?? "-")
    : `${beijingTimeFormatter.format(parsed)}.${String(parsed.getMilliseconds()).padStart(3, "0")} 北京时间`;
  return `[${displayTs}] [${log.level}] ${log.message}`;
}

function renderRuntimeLogs(logs) {
  runtimeLogsEl.innerHTML = "";
  if (!Array.isArray(logs) || logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "runtime-log-empty";
    empty.textContent = "暂无运行日志";
    runtimeLogsEl.appendChild(empty);
    return;
  }

  const recent = [...logs].reverse();
  for (const log of recent) {
    const item = document.createElement("div");
    item.className = `runtime-log-item ${(log.level || "INFO").toLowerCase()}`;
    item.textContent = formatRuntimeLog(log);
    runtimeLogsEl.appendChild(item);
  }
}

async function loadRuntimeLogs() {
  try {
    const result = await request("/api/runtime-logs?limit=200");
    renderRuntimeLogs(result.data || []);
  } catch (error) {
    const msg = sanitizeMessage(error);
    runtimeLogsEl.innerHTML = "";
    const item = document.createElement("div");
    item.className = "runtime-log-empty";
    item.textContent = `日志加载失败: ${msg}`;
    runtimeLogsEl.appendChild(item);
  }
}

function setEditorDisabled(disabled) {
  const controls = editorPanelEl.querySelectorAll("input, select, textarea, button");
  for (const control of controls) {
    control.disabled = disabled;
  }
}

function toggleTimeFields() {
  const mode = formEls.timeMode.value;
  if (mode === "relative") {
    formEls.timeLastValue.disabled = false;
    formEls.timeLastUnit.disabled = false;
    formEls.timeStart.disabled = true;
    formEls.timeEnd.disabled = true;
  } else {
    formEls.timeLastValue.disabled = true;
    formEls.timeLastUnit.disabled = true;
    formEls.timeStart.disabled = false;
    formEls.timeEnd.disabled = false;
  }
}

function toggleGroupFields() {
  const type = formEls.groupType.value;
  if (type === "none") {
    formEls.groupField.disabled = true;
    formEls.groupInterval.disabled = true;
    formEls.groupSize.disabled = true;
    return;
  }

  formEls.groupField.disabled = false;
  formEls.groupSize.disabled = false;
  formEls.groupInterval.disabled = type !== "date_histogram";
}

function setMetricRowFieldState(rowEl) {
  const typeEl = rowEl.querySelector('[data-role="metric-type"]');
  const fieldEl = rowEl.querySelector('[data-role="metric-field"]');
  if (!typeEl || !fieldEl) {
    return;
  }
  if (typeEl.value === "count") {
    fieldEl.disabled = true;
    fieldEl.value = "";
  } else {
    fieldEl.disabled = false;
  }
}

function appendMetricRow(metric = { name: "", type: "count", field: "", minAvg: undefined }) {
  const row = document.createElement("div");
  row.className = "metric-row";
  row.innerHTML = `
    <input data-role="metric-name" type="text" placeholder="name" value="${metric.name || ""}" />
    <select data-role="metric-type">
      <option value="count" ${metric.type === "count" ? "selected" : ""}>count</option>
      <option value="avg" ${metric.type === "avg" ? "selected" : ""}>avg</option>
      <option value="sum" ${metric.type === "sum" ? "selected" : ""}>sum</option>
      <option value="min" ${metric.type === "min" ? "selected" : ""}>min</option>
      <option value="max" ${metric.type === "max" ? "selected" : ""}>max</option>
    </select>
    <input data-role="metric-field" type="text" placeholder="field" value="${metric.field || ""}" />
    <input data-role="metric-minavg" type="number" placeholder="minAvg (可选)" value="${metric.minAvg !== undefined ? metric.minAvg : ""}" step="0.01" />
    <button data-role="metric-remove" type="button" class="danger-light">删除</button>
  `;

  const typeEl = row.querySelector('[data-role="metric-type"]');
  const removeEl = row.querySelector('[data-role="metric-remove"]');

  typeEl.addEventListener("change", () => {
    setMetricRowFieldState(row);
  });

  removeEl.addEventListener("click", () => {
    row.remove();
    if (metricsRowsEl.children.length === 0) {
      appendMetricRow({ name: "total_count", type: "count" });
    }
  });

  metricsRowsEl.appendChild(row);
  setMetricRowFieldState(row);
}

function renderMetrics(metrics = []) {
  metricsRowsEl.innerHTML = "";
  if (!Array.isArray(metrics) || metrics.length === 0) {
    appendMetricRow({ name: "total_count", type: "count" });
    return;
  }
  for (const metric of metrics) {
    appendMetricRow(metric);
  }
}

function fillFormFromConfig(config) {
  formEls.name.value = config.name || "";
  formEls.enabled.value = String(Boolean(config.enabled));
  formEls.schedule.value = config.schedule || "*/5 * * * *";

  formEls.esNode.value = config.es?.node || "";
  formEls.esUsername.value = config.es?.username || "";
  formEls.esPassword.value = config.es?.password || "";
  formEls.esIndex.value = config.es?.index || "";
  formEls.esKql.value = config.es?.kql || "";
  formEls.esQueryFile.value = config.es?.queryFile || "./query.json";
  formEls.esFuzzyConditions.value = formatFuzzyConditionsText(config.es?.fuzzyConditions || []);

  formEls.timeField.value = config.time?.field || "@timestamp";
  formEls.timeMode.value = config.time?.mode || "relative";
  const lastParsed = parseRelativeLast(config.time?.last || "30m");
  formEls.timeLastValue.value = lastParsed.value;
  formEls.timeLastUnit.value = lastParsed.unit;
  formEls.timeStart.value = config.time?.start || "";
  formEls.timeEnd.value = config.time?.end || "";
  formEls.timeTimezone.value = "Asia/Shanghai";

  formEls.groupType.value = config.groupBy?.type || "none";
  const groupFields =
    Array.isArray(config.groupBy?.fields) && config.groupBy.fields.length > 0
      ? config.groupBy.fields
      : config.groupBy?.field
        ? [config.groupBy.field]
        : [];
  formEls.groupField.value = groupFields.join(",");
  formEls.groupInterval.value = config.groupBy?.interval || "";
  formEls.groupSize.value = String(config.groupBy?.size ?? 20);
  formEls.groupSort.checked = config.groupBy?.sort ?? false;

  formEls.chartType.value = config.chart?.type || "line";
  formEls.chartTitle.value = config.chart?.title || "ES Monitor";
  formEls.chartWidth.value = String(config.chart?.width ?? 1200);
  formEls.chartHeight.value = String(config.chart?.height ?? 600);
  formEls.chartBg.value = config.chart?.backgroundColor || "#ffffff";
  renderChartColors(config.chart?.colors || []);
  formEls.chartPatchFile.value = config.chart?.optionPatchFile || "./chart.json";

  formEls.wecomWebhook.value = config.wecom?.webhook || "";

  renderMetrics(config.metrics || []);
  toggleTimeFields();
  toggleGroupFields();
}

function collectMetricsFromForm() {
  const rows = metricsRowsEl.querySelectorAll(".metric-row");
  const metrics = [];

  rows.forEach((row, index) => {
    const name = row.querySelector('[data-role="metric-name"]').value.trim();
    const type = row.querySelector('[data-role="metric-type"]').value;
    const field = row.querySelector('[data-role="metric-field"]').value.trim();
    const minAvgRaw = row.querySelector('[data-role="metric-minavg"]').value.trim();

    if (!name) {
      throw new Error(`第 ${index + 1} 个 metric 缺少 name`);
    }

    if (type !== "count" && !field) {
      throw new Error(`第 ${index + 1} 个 metric(${name}) 缺少 field`);
    }

    const metric = {
      name,
      type,
      field: type === "count" ? undefined : field
    };

    if (minAvgRaw) {
      const minAvg = Number(minAvgRaw);
      if (Number.isFinite(minAvg)) {
        metric.minAvg = minAvg;
      }
    }

    metrics.push(metric);
  });

  if (metrics.length === 0) {
    throw new Error("至少需要一个 metric");
  }

  return metrics;
}

function collectMonitorConfigFromForm() {
  const parsedGroupFields = parseGroupFields(formEls.groupField.value);
  const monitorConfig = {
    name: formEls.name.value.trim(),
    enabled: formEls.enabled.value === "true",
    schedule: formEls.schedule.value.trim(),
    es: {
      node: formEls.esNode.value.trim(),
      username: formEls.esUsername.value.trim(),
      password: formEls.esPassword.value.trim(),
      index: formEls.esIndex.value.trim(),
      kql: optionalText(formEls.esKql.value),
      queryFile: optionalText(formEls.esQueryFile.value),
      fuzzyConditions: parseFuzzyConditionsText(formEls.esFuzzyConditions.value)
    },
    time: {
      field: formEls.timeField.value.trim(),
      mode: formEls.timeMode.value,
      last: composeRelativeLast(),
      start: optionalText(formEls.timeStart.value),
      end: optionalText(formEls.timeEnd.value),
      timezone: "Asia/Shanghai"
    },
    metrics: collectMetricsFromForm(),
    groupBy: {
      type: formEls.groupType.value,
      field: parsedGroupFields[0],
      fields: parsedGroupFields.length > 1 ? parsedGroupFields : undefined,
      interval: optionalText(formEls.groupInterval.value),
      size: intOrDefault(formEls.groupSize.value, 20),
      sort: formEls.groupSort.checked || undefined
    },
    chart: {
      type: formEls.chartType.value,
      title: formEls.chartTitle.value.trim(),
      width: intOrDefault(formEls.chartWidth.value, 1200),
      height: intOrDefault(formEls.chartHeight.value, 600),
      backgroundColor: formEls.chartBg.value.trim(),
      colors: collectChartColors(),
      optionPatchFile: optionalText(formEls.chartPatchFile.value)
    },
    wecom: {
      webhook: formEls.wecomWebhook.value.trim()
    }
  };

  if (!monitorConfig.name) {
    throw new Error("name 不能为空");
  }

  if (
    !monitorConfig.es.node ||
    !monitorConfig.es.index ||
    !monitorConfig.es.username ||
    !monitorConfig.es.password
  ) {
    throw new Error("es.node / es.index / es.username / es.password 不能为空");
  }

  if (!monitorConfig.schedule) {
    throw new Error("schedule 不能为空");
  }

  if (!monitorConfig.time.field || !monitorConfig.time.timezone) {
    throw new Error("time.field 和 time.timezone 不能为空");
  }

  if (!monitorConfig.chart.title || !monitorConfig.chart.backgroundColor) {
    throw new Error("chart.title 和 chart.backgroundColor 不能为空");
  }

  if (!monitorConfig.wecom.webhook) {
    throw new Error("wecom.webhook 不能为空");
  }

  return monitorConfig;
}

async function loadMonitorList(selectFirst = false) {
  setStatus("loading", "Loading");
  const result = await request("/api/monitors");
  state.monitors = result.data || [];

  if (selectFirst && state.monitors.length > 0) {
    state.selectedId = state.monitors[0].id;
  }

  renderMonitorList();
  setStatus("ok", "Ready");
}

async function loadMonitorDetail(monitorId) {
  setStatus("loading", `Loading ${monitorId}`);
  setEditorDisabled(true);

  try {
    const result = await request(`/api/monitors/${encodeURIComponent(monitorId)}`);
    const detail = result.data;

    state.selectedId = detail.id;
    editorTitleEl.textContent = `编辑: ${detail.id}`;
    monitorYamlEl.value = detail.monitorYaml || "";
    queryJsonEl.value = detail.queryJson || "{}\n";
    chartJsonEl.value = detail.chartJson || "{}\n";

    if (detail.monitorConfig) {
      fillFormFromConfig(detail.monitorConfig);
      setStatus("ok", `Loaded ${detail.id}`);
    } else {
      renderMetrics([]);
      setStatus("error", detail.monitorConfigError || "monitor.yaml 无法解析为表单");
    }

    renderMonitorList();
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  } finally {
    setEditorDisabled(false);
    toggleTimeFields();
    toggleGroupFields();
  }
}

async function saveRawConfig() {
  if (!state.selectedId) {
    setStatus("error", "请先选择一个监控");
    return;
  }

  setStatus("loading", `Saving ${state.selectedId} (raw)`);
  setEditorDisabled(true);

  try {
    const result = await request(`/api/monitors/${encodeURIComponent(state.selectedId)}`, {
      method: "PUT",
      body: JSON.stringify({
        monitorYaml: monitorYamlEl.value,
        queryJson: queryJsonEl.value,
        chartJson: chartJsonEl.value
      })
    });

    const detail = result.data;
    if (detail.monitorConfig) {
      fillFormFromConfig(detail.monitorConfig);
    }

    setStatus("ok", `Saved ${detail.id} (raw)`);
    await loadMonitorList(false);
    renderMonitorList();
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  } finally {
    setEditorDisabled(false);
    toggleTimeFields();
    toggleGroupFields();
  }
}

async function saveFormConfig() {
  if (!state.selectedId) {
    setStatus("error", "请先选择一个监控");
    return;
  }

  setStatus("loading", `Saving ${state.selectedId} (form)`);
  setEditorDisabled(true);

  try {
    const monitorConfig = collectMonitorConfigFromForm();
    const result = await request(`/api/monitors/${encodeURIComponent(state.selectedId)}/form`, {
      method: "PUT",
      body: JSON.stringify({
        monitorConfig,
        queryJson: queryJsonEl.value,
        chartJson: chartJsonEl.value
      })
    });

    const detail = result.data;
    monitorYamlEl.value = detail.monitorYaml || monitorYamlEl.value;
    queryJsonEl.value = detail.queryJson || queryJsonEl.value;
    chartJsonEl.value = detail.chartJson || chartJsonEl.value;

    if (detail.monitorConfig) {
      fillFormFromConfig(detail.monitorConfig);
    }

    setStatus("ok", `Saved ${detail.id} (form)`);
    await loadMonitorList(false);
    renderMonitorList();
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  } finally {
    setEditorDisabled(false);
    toggleTimeFields();
    toggleGroupFields();
  }
}

async function saveFormAndReload() {
  if (!state.selectedId) {
    setStatus("error", "请先选择一个监控");
    return;
  }

  setStatus("loading", `Saving and reloading ${state.selectedId}`);
  setEditorDisabled(true);

  try {
    // 先保存表单配置
    const monitorConfig = collectMonitorConfigFromForm();
    const saveResult = await request(`/api/monitors/${encodeURIComponent(state.selectedId)}/form`, {
      method: "PUT",
      body: JSON.stringify({
        monitorConfig,
        queryJson: queryJsonEl.value,
        chartJson: chartJsonEl.value
      })
    });

    const detail = saveResult.data;
    monitorYamlEl.value = detail.monitorYaml || monitorYamlEl.value;
    queryJsonEl.value = detail.queryJson || queryJsonEl.value;
    chartJsonEl.value = detail.chartJson || chartJsonEl.value;

    if (detail.monitorConfig) {
      fillFormFromConfig(detail.monitorConfig);
    }

    // 再重新加载配置
    const reloadResult = await request("/api/monitors/reload", {
      method: "POST",
      body: JSON.stringify({})
    });

    await loadMonitorList(false);
    await loadRuntimeLogs();
    renderMonitorList();

    const names = (reloadResult.data?.scheduledNames || []).join(", ");
    setStatus("ok", names ? `Saved and reloaded: ${names}` : "Saved and reloaded");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  } finally {
    setEditorDisabled(false);
    toggleTimeFields();
    toggleGroupFields();
  }
}

async function syncFormFromYaml() {
  setStatus("loading", "Parsing YAML to form");

  try {
    const result = await request("/api/helpers/monitor/parse", {
      method: "POST",
      body: JSON.stringify({
        monitorYaml: monitorYamlEl.value
      })
    });

    fillFormFromConfig(result.data.monitorConfig);
    setStatus("ok", "YAML -> 表单 完成");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function syncYamlFromForm() {
  setStatus("loading", "Rendering form to YAML");

  try {
    const monitorConfig = collectMonitorConfigFromForm();
    const result = await request("/api/helpers/monitor/stringify", {
      method: "POST",
      body: JSON.stringify({ monitorConfig })
    });

    monitorYamlEl.value = result.data.monitorYaml;
    setStatus("ok", "表单 -> YAML 完成");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function createMonitor() {
  const raw = window.prompt("请输入新监控 ID（支持中文、字母、数字、._-）：", "new-monitor");
  if (!raw) {
    return;
  }

  const id = raw.trim();
  if (!id) {
    return;
  }

  setStatus("loading", `Creating ${id}`);

  try {
    await request("/api/monitors", {
      method: "POST",
      body: JSON.stringify({ id })
    });

    await loadMonitorList(false);
    await loadMonitorDetail(id);
    setStatus("ok", `Created ${id}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

function setupFloatingLogPanel() {
  function applyLogPanelState() {
    floatingLogPanelEl.classList.toggle("minimized", isLogsMinimized);
    toggleLogsBtnEl.textContent = isLogsMinimized ? "展开" : "最小化";
  }

  // 默认最小化
  isLogsMinimized = true;
  applyLogPanelState();

  toggleLogsBtnEl.addEventListener("click", () => {
    isLogsMinimized = !isLogsMinimized;
    applyLogPanelState();
  });
}

refreshBtnEl.addEventListener("click", async () => {
  try {
    await loadMonitorList(false);
    if (state.selectedId) {
      await loadMonitorDetail(state.selectedId);
    }
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
});

createBtnEl.addEventListener("click", createMonitor);
saveAndReloadBtnEl.addEventListener("click", saveFormAndReload);
saveRawBtnEl.addEventListener("click", saveRawConfig);
addMetricBtnEl.addEventListener("click", () => {
  appendMetricRow({ name: "new_metric", type: "count", field: "" });
});
addChartColorBtnEl.addEventListener("click", () => {
  appendChartColorRow("#0ea5e9");
});
syncFromYamlBtnEl.addEventListener("click", syncFormFromYaml);
syncToYamlBtnEl.addEventListener("click", syncYamlFromForm);
refreshLogsBtnEl.addEventListener("click", loadRuntimeLogs);
formEls.timeMode.addEventListener("change", toggleTimeFields);
formEls.groupType.addEventListener("change", toggleGroupFields);

async function bootstrap() {
  try {
    await loadMonitorList(true);
    if (state.selectedId) {
      await loadMonitorDetail(state.selectedId);
    } else {
      editorTitleEl.textContent = "暂无监控，请先新建";
      setEditorDisabled(true);
      setStatus("idle", "No monitor selected");
    }
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

bootstrap();
loadRuntimeLogs();
runtimeLogTimer = window.setInterval(loadRuntimeLogs, 3000);
setupFloatingLogPanel();
