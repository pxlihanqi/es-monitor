# ES Monitor

通过 Elasticsearch 查询数据，做聚合统计，生成 ECharts 图片并发送到企业微信机器人。

## 特性

- 支持每个监控任务一个独立文件夹（`monitors/<monitor-name>`）
- 支持自定义索引、查询条件（query DSL）
- 支持统计：`count / avg / sum / min / max`
- 支持自定义时间范围（相对时间或绝对时间）
- 相对时间支持最近 `n` 分钟/小时/天（`30m`、`2h`、`1d`，以及“30分钟/2小时/1天”等写法自动转换）
- 时间统一按北京时间（`Asia/Shanghai`）处理
- 支持 ECharts `line / bar / table` 图表
- 支持图表样式 patch（`chart.json`）
- 页面支持通过采色器配置 `chart.colors`
- 生成 PNG -> base64 + md5 -> 企业微信机器人发送

## 快速开始

```bash
npm install
npm run build
```

### 浏览器配置管理（推荐）

```bash
npm run start:web
```

启动后在浏览器打开：`http://127.0.0.1:3100`

- 支持查看监控列表
- 支持新建监控（每个监控自动创建独立文件夹）
- 支持表单编辑 `monitor.yaml`（基础字段 + metrics 动态增删）
- 支持 YAML 与表单互相转换
- 支持原始文本编辑并保存 `monitor.yaml / query.json / chart.json`
- 支持页面实时展示定时任务运行日志（自动刷新）
- ES 连接支持并校验 `username/password`
- ES 支持多个模糊查询条件（`fuzzyConditions`）
  - 可在 `monitor.yaml -> es.fuzzyConditions` 配置
  - 也可在 `query.json` 顶层配置 `fuzzyConditions`，例如：
```json
{
  "fuzzyConditions": [
    { "field": "message", "value": "timeout" },
    { "field": "service.keyword", "value": "nginx" }
  ],
  "query": {
    "match_all": {}
  }
}
```
- ES 支持类 Kibana 输入框查询：`es.kql`
```txt
status:500 and service.keyword:nginx*
message:"timeout error" or level:ERROR
```
- 支持在线“重新加载配置”
- 支持在页面删除定时任务（删除监控目录并取消调度）

### 运行一次（不发送企业微信）

```bash
npm run start -- --once --dry-run --monitor demo-monitor
```

### 启动定时任务

```bash
npm run start
```

## 目录结构

```txt
monitors/
  demo-monitor/
    monitor.yaml
    query.json
    chart.json
    output/
src/
  config/
  web/
  es/
  metrics/
  chart/
  notifier/
  runner/
web/
  index.html
  app.js
  styles.css
```

## monitor.yaml 关键字段

- `schedule`: cron 表达式
- `es.index`: ES 索引（支持通配符）
- `es.queryFile`: 查询条件 JSON 文件（也可直接使用 `es.query`）
- `time`: 时间条件
- `metrics`: 统计指标
- `groupBy`: 分组方式（`none | date_histogram | terms`）
- `chart.type`: `line | bar | table`
- `chart.optionPatchFile`: 自定义 ECharts option 覆盖
- `wecom.webhook`: 企业微信机器人 webhook

## 注意

- 示例 `demo-monitor` 默认 `enabled: false`，避免误发消息。
- 需要把 webhook 替换为你自己的机器人地址。
- `--dry-run` 模式下只生成图片，不发送企业微信。
