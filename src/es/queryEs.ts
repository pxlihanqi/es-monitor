import type { estypes } from "@elastic/elasticsearch";
import type { LoadedMonitor } from "../types.js";
import { getEsClient } from "./client.js";
import { buildSearchBody } from "./buildSearchBody.js";

export async function queryEs(
  monitor: LoadedMonitor
): Promise<estypes.SearchResponse<Record<string, unknown>>> {
  const client = getEsClient(monitor);
  const body = buildSearchBody(monitor);

  const response = await client.search<Record<string, unknown>>({
    index: monitor.es.index,
    body
  });

  return response;
}
