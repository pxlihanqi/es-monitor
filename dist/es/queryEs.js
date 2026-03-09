import { getEsClient } from "./client.js";
import { buildSearchBody } from "./buildSearchBody.js";
export async function queryEs(monitor) {
    const client = getEsClient(monitor);
    const body = buildSearchBody(monitor);
    const response = await client.search({
        index: monitor.es.index,
        body
    });
    return response;
}
