import { kqlToElastic } from "kql-to-elastic";

/**
 * 将 KQL 查询字符串转换为 Elasticsearch query DSL
 * @param kql KQL 查询字符串，例如: "status:200 and method:GET"
 * @param indexPattern ES 索引模式，例如: "ngx-log-*"
 * @returns Elasticsearch query DSL object
 * @throws Error 当 KQL 语法错误时抛出异常
 */
export function kqlToEsQuery(kql: string, indexPattern: string): Record<string, unknown> {
  try {
    const queryJson = kqlToElastic(kql);
    const query = JSON.parse(queryJson);
    return query;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`KQL syntax error: ${message}`);
  }
}
