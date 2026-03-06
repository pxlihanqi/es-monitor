import { Client } from "@elastic/elasticsearch";
import type { LoadedMonitor } from "../types.js";

const clientCache = new Map<string, Client>();

export function getEsClient(monitor: LoadedMonitor): Client {
  const cacheKey = [
    monitor.es.node,
    monitor.es.username ?? "",
    monitor.es.password ?? ""
  ].join("|");

  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const client = new Client({
      node: monitor.es.node,
      auth: monitor.es.username
        ? {
            username: monitor.es.username,
            password: monitor.es.password ?? ""
          }
        : undefined
    });

    clientCache.set(cacheKey, client);
    return client;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid URL")) {
      throw new Error(`Invalid URL: ${monitor.es.node}`);
    }
    throw error;
  }
}
