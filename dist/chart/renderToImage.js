import { createRequire } from "node:module";
import sharp from "sharp";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const echarts = require("echarts");
export async function renderChartToImage(option, width, height) {
    const chart = echarts.init(null, undefined, {
        renderer: "svg",
        ssr: true,
        width,
        height
    });
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    chart.dispose();
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const base64 = buffer.toString("base64");
    const md5 = createHash("md5").update(buffer).digest("hex");
    return { buffer, base64, md5 };
}
