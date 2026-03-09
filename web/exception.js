const state = {
  monitors: [],
  selectedId: ""
};
const API_BASE = "/api/exception-monitors";

const countBadgeEl = document.getElementById("countBadge");
const monitorListEl = document.getElementById("monitorList");
const editorTitleEl = document.getElementById("editorTitle");
const statusEl = document.getElementById("status");
const monitorYamlEl = document.getElementById("monitorYaml");
const refreshBtnEl = document.getElementById("refreshBtn");
const reloadBtnEl = document.getElementById("reloadBtn");
const createBtnEl = document.getElementById("createBtn");
const saveAndReloadBtnEl = document.getElementById("saveAndReloadBtn");
const saveRawBtnEl = document.getElementById("saveRawBtn");
const syncToYamlBtnEl = document.getElementById("syncToYamlBtn");
const previewBtnEl = document.getElementById("previewBtn");
const refreshLogsBtnEl = document.getElementById("refreshLogsBtn");
const toggleLogsBtnEl = document.getElementById("toggleLogsBtn");
const runtimeLogsEl = document.getElementById("runtimeLogs");
const previewImageEl = document.getElementById("previewImage");
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
  timeLastValue: document.getElementById("f_time_last_value"),
  timeLastUnit: document.getElementById("f_time_last_unit"),
  timeTimezone: document.getElementById("f_time_timezone"),
  alertEnabled: document.getElementById("f_alert_enabled"),
  alertThreshold: document.getElementById("f_alert_threshold"),
  alertTitle: document.getElementById("f_alert_title"),
  alertConsecutiveCount: document.getElementById("f_alert_consecutive_count"),
  alertCooldownMinutes: document.getElementById("f_alert_cooldown_minutes"),
  alertMarkdownTemplate: document.getElementById("f_alert_markdown_template"),
  wecomWebhook: document.getElementById("f_wecom_webhook")
};

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

function parseRelativeLast(lastRaw) {
  const raw = String(lastRaw ?? "").trim().toLowerCase();
  const matched = raw.replace(/\s+/g, "").match(/^(\d+)([a-z\u4e00-\u9fa5]+)?$/);
  if (!matched) {
    return { value: "5", unit: "m" };
  }
  const unitRaw = matched[2] || "m";
  const value = matched[1];
  if (["h", "hr", "hrs", "hour", "hours", "时", "小时"].includes(unitRaw)) {
    return { value, unit: "h" };
  }
  if (["d", "day", "days", "天"].includes(unitRaw)) {
    return { value, unit: "d" };
  }
  return { value, unit: "m" };
}

function composeRelativeLast() {
  const value = intOrDefault(formEls.timeLastValue.value, 5);
  const unit = formEls.timeLastUnit.value || "m";
  if (value <= 0) {
    throw new Error("time.lastValue 必须大于 0");
  }
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

function buildExceptionMonitorConfig() {
  const threshold = Number(formEls.alertThreshold.value);
  if (formEls.alertEnabled.value === "true" && !Number.isFinite(threshold)) {
    throw new Error("alert.threshold 不能为空");
  }

  return {
    kind: "exception",
    name: formEls.name.value.trim(),
    enabled: formEls.enabled.value === "true",
    schedule: formEls.schedule.value.trim(),
    es: {
      node: formEls.esNode.value.trim(),
      username: formEls.esUsername.value.trim(),
      password: formEls.esPassword.value.trim(),
      index: formEls.esIndex.value.trim(),
      kql: optionalText(formEls.esKql.value),
      fuzzyConditions: []
    },
    time: {
      field: "@timestamp",
      mode: "relative",
      last: composeRelativeLast(),
      timezone: "Asia/Shanghai"
    },
    metrics: [{ name: "error_count", type: "count" }],
    groupBy: {
      type: "none",
      size: 20
    },
    chart: {
      type: "bar",
      title: `${formEls.name.value.trim() || "异常日志"} 统计`,
      width: 1200,
      height: 600,
      backgroundColor: "#ffffff",
      colors: ["#dc2626", "#f97316"]
    },
    alert: {
      enabled: formEls.alertEnabled.value === "true",
      threshold: formEls.alertEnabled.value === "true" ? threshold : undefined,
      title: optionalText(formEls.alertTitle.value),
      consecutiveCount: intOrDefault(formEls.alertConsecutiveCount.value, 1),
      cooldownMinutes: intOrDefault(formEls.alertCooldownMinutes.value, 0),
      markdownTemplate: optionalText(formEls.alertMarkdownTemplate.value)
    },
    wecom: {
      webhook: formEls.wecomWebhook.value.trim()
    }
  };
}

function fillForm(config) {
  formEls.name.value = config.name || "";
  formEls.enabled.value = String(Boolean(config.enabled));
  formEls.schedule.value = config.schedule || "*/1 * * * *";
  formEls.esNode.value = config.es?.node || "";
  formEls.esUsername.value = config.es?.username || "";
  formEls.esPassword.value = config.es?.password || "";
  formEls.esIndex.value = config.es?.index || "";
  formEls.esKql.value = config.es?.kql || "";
  const last = parseRelativeLast(config.time?.last || "5m");
  formEls.timeLastValue.value = last.value;
  formEls.timeLastUnit.value = last.unit;
  formEls.timeTimezone.value = "Asia/Shanghai";
  formEls.alertEnabled.value = String(Boolean(config.alert?.enabled));
  formEls.alertThreshold.value =
    typeof config.alert?.threshold === "number" ? String(config.alert.threshold) : "";
  formEls.alertTitle.value = config.alert?.title || "";
  formEls.alertConsecutiveCount.value = String(config.alert?.consecutiveCount ?? 1);
  formEls.alertCooldownMinutes.value = String(config.alert?.cooldownMinutes ?? 0);
  formEls.alertMarkdownTemplate.value = config.alert?.markdownTemplate || "";
  formEls.wecomWebhook.value = config.wecom?.webhook || "";
}

function renderMonitorList() {
  monitorListEl.innerHTML = "";
  countBadgeEl.textContent = String(state.monitors.length);
  for (const monitor of state.monitors) {
    const item = document.createElement("li");
    item.className = `monitor-item${state.selectedId === monitor.id ? " selected" : ""}`;

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "monitor-open-btn";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = monitor.name || monitor.id;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${monitor.enabled ? "enabled" : "disabled"} · ${monitor.schedule}`;
    openBtn.append(name, meta);
    openBtn.addEventListener("click", () => loadMonitorDetail(monitor.id));

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
  const confirmed = window.confirm(`确认删除异常监控 ${monitorId} 吗？`);
  if (!confirmed) {
    return;
  }

  setStatus("loading", `Deleting ${monitorId}`);
  try {
    await request(`${API_BASE}/${encodeURIComponent(monitorId)}`, {
      method: "DELETE"
    });
    if (state.selectedId === monitorId) {
      state.selectedId = "";
      editorTitleEl.textContent = "未选择监控";
      monitorYamlEl.value = "";
    }
    await loadMonitorList(true);
    if (state.selectedId) {
      await loadMonitorDetail(state.selectedId);
    }
    setStatus("ok", `Deleted ${monitorId}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function reloadMonitorConfig() {
  setStatus("loading", "Reloading monitors");
  try {
  const result = await request(`${API_BASE}/reload`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await loadMonitorList(false);
    if (state.selectedId) {
      await loadMonitorDetail(state.selectedId);
    }
    const names = (result.data?.scheduledNames || []).join(", ");
    setStatus("ok", names ? `Reloaded: ${names}` : "Reloaded");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function loadMonitorList(selectFirst = false) {
  const result = await request(API_BASE);
  state.monitors = result.data || [];
  if (selectFirst && state.monitors.length > 0) {
    state.selectedId = state.monitors[0].id;
  }
  renderMonitorList();
}

async function loadMonitorDetail(monitorId) {
  setStatus("loading", `Loading ${monitorId}`);
  try {
    const result = await request(`${API_BASE}/${encodeURIComponent(monitorId)}`);
    const detail = result.data;
    state.selectedId = detail.id;
    editorTitleEl.textContent = `编辑: ${detail.id}`;
    monitorYamlEl.value = detail.monitorYaml || "";
    if (detail.monitorConfig) {
      fillForm(detail.monitorConfig);
    }
    renderMonitorList();
    setStatus("ok", `Loaded ${detail.id}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function saveForm(reloadAfterSave) {
  if (!state.selectedId) {
    setStatus("error", "请先选择一个监控");
    return;
  }
  setStatus("loading", `Saving ${state.selectedId}`);
  try {
    const monitorConfig = buildExceptionMonitorConfig();
    const result = await request(`${API_BASE}/${encodeURIComponent(state.selectedId)}/form`, {
      method: "PUT",
      body: JSON.stringify({
        monitorConfig,
        queryJson: "{}\n",
        chartJson: "{}\n"
      })
    });
    monitorYamlEl.value = result.data.monitorYaml || monitorYamlEl.value;
    if (reloadAfterSave) {
      await request(`${API_BASE}/reload`, {
        method: "POST",
        body: JSON.stringify({})
      });
    }
    await loadMonitorList(false);
    setStatus("ok", reloadAfterSave ? `Saved and reloaded ${state.selectedId}` : `Saved ${state.selectedId}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function saveRaw() {
  if (!state.selectedId) {
    setStatus("error", "请先选择一个监控");
    return;
  }
  setStatus("loading", `Saving ${state.selectedId} raw`);
  try {
    const result = await request(`${API_BASE}/${encodeURIComponent(state.selectedId)}`, {
      method: "PUT",
      body: JSON.stringify({
        monitorYaml: monitorYamlEl.value,
        queryJson: "{}\n",
        chartJson: "{}\n"
      })
    });
    if (result.data.monitorConfig) {
      fillForm(result.data.monitorConfig);
    }
    await request(`${API_BASE}/reload`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await loadMonitorList(false);
    setStatus("ok", `Saved raw ${state.selectedId}`);
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function createMonitor() {
  const raw = window.prompt("请输入异常监控 ID：", "exception-log-alert");
  if (!raw) {
    return;
  }
  const id = raw.trim();
  if (!id) {
    return;
  }

  const monitorConfig = {
    kind: "exception",
    name: id,
    enabled: true,
    schedule: "*/1 * * * *",
    es: {
      node: "http://127.0.0.1:9200",
      username: "elastic",
      password: "replace_me",
      index: "app-log-*",
      kql: 'level:ERROR and message:*Exception*'
    },
    time: {
      field: "@timestamp",
      mode: "relative",
      last: "5m",
      timezone: "Asia/Shanghai"
    },
    metrics: [{ name: "error_count", type: "count" }],
    groupBy: {
      type: "none",
      size: 20
    },
    chart: {
      type: "bar",
      title: `${id} 统计`,
      width: 1200,
      height: 600,
      backgroundColor: "#ffffff",
      colors: ["#dc2626", "#f97316"]
    },
    alert: {
      enabled: true,
      threshold: 50,
      title: `${id} 异常日志告警`,
      consecutiveCount: 3,
      cooldownMinutes: 30,
      markdownTemplate: [
        "# {{title}}",
        "> 监控名称: {{name}}",
        "> 当前数量: {{totalCount}}",
        "> 告警阈值: {{threshold}}",
        "> 索引: {{index}}",
        "> 条件: {{query}}",
        "> 时间窗口: {{timeWindow}}"
      ].join("\n")
    },
    wecom: {
      webhook: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=replace_me"
    }
  };

  const yamlResponse = await request("/api/helpers/monitor/stringify", {
    method: "POST",
    body: JSON.stringify({ monitorConfig })
  });
  await request(API_BASE, {
    method: "POST",
    body: JSON.stringify({
      id,
      monitorYaml: yamlResponse.data.monitorYaml,
      queryJson: "{}\n",
      chartJson: "{}\n"
    })
  });

  await reloadMonitorConfig();
  await loadMonitorList(false);
  await loadMonitorDetail(id);
}

function formatRuntimeLog(log) {
  const parsed = new Date(log?.timestamp);
  const displayTs = Number.isNaN(parsed.getTime())
    ? String(log?.timestamp ?? "-")
    : `${beijingTimeFormatter.format(parsed)} 北京时间`;
  return `[${displayTs}] [${log.level}] ${log.message}`;
}

function renderRuntimeLogs(logs) {
  runtimeLogsEl.innerHTML = "";
  for (const log of [...(logs || [])].reverse()) {
    const item = document.createElement("div");
    item.className = `runtime-log-item ${(log.level || "INFO").toLowerCase()}`;
    item.textContent = formatRuntimeLog(log);
    runtimeLogsEl.appendChild(item);
  }
}

async function loadRuntimeLogs() {
  const result = await request("/api/runtime-logs?limit=200");
  renderRuntimeLogs(result.data || []);
}

async function syncToYaml() {
  try {
    const result = await request("/api/helpers/monitor/stringify", {
      method: "POST",
      body: JSON.stringify({ monitorConfig: buildExceptionMonitorConfig() })
    });
    monitorYamlEl.value = result.data.monitorYaml;
    setStatus("ok", "表单已同步到 YAML");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

async function previewChart() {
  try {
    setStatus("loading", "生成图表预览中");
    const result = await request("/api/helpers/chart/preview", {
      method: "POST",
      body: JSON.stringify({
        monitorConfig: buildExceptionMonitorConfig(),
        queryJson: "{}\n",
        chartJson: "{}\n"
      })
    });
    previewImageEl.src = result.data.dataUrl;
    setStatus("ok", "图表预览已更新");
  } catch (error) {
    setStatus("error", sanitizeMessage(error));
  }
}

function setupFloatingLogPanel() {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  floatingLogHeaderEl.addEventListener("mousedown", (event) => {
    dragging = true;
    const rect = floatingLogPanelEl.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }
    floatingLogPanelEl.style.left = `${event.clientX - offsetX}px`;
    floatingLogPanelEl.style.top = `${event.clientY - offsetY}px`;
    floatingLogPanelEl.style.right = "auto";
    floatingLogPanelEl.style.bottom = "auto";
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });

  toggleLogsBtnEl.addEventListener("click", () => {
    floatingLogPanelEl.classList.toggle("minimized");
    toggleLogsBtnEl.textContent = floatingLogPanelEl.classList.contains("minimized") ? "展开" : "收起";
  });
}

refreshBtnEl.addEventListener("click", async () => {
  await loadMonitorList(false);
  if (state.selectedId) {
    await loadMonitorDetail(state.selectedId);
  }
});
reloadBtnEl.addEventListener("click", reloadMonitorConfig);
createBtnEl.addEventListener("click", createMonitor);
saveAndReloadBtnEl.addEventListener("click", () => saveForm(true));
saveRawBtnEl.addEventListener("click", saveRaw);
syncToYamlBtnEl.addEventListener("click", syncToYaml);
previewBtnEl.addEventListener("click", previewChart);
refreshLogsBtnEl.addEventListener("click", loadRuntimeLogs);

async function bootstrap() {
  await loadMonitorList(true);
  if (state.selectedId) {
    await loadMonitorDetail(state.selectedId);
  }
  await loadRuntimeLogs();
  setupFloatingLogPanel();
  window.setInterval(loadRuntimeLogs, 3000);
}

bootstrap().catch((error) => {
  setStatus("error", sanitizeMessage(error));
});
