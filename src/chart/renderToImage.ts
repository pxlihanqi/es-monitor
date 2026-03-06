import { createRequire } from "node:module";
import sharp from "sharp";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const echarts = require("echarts") as {
  init: (
    dom: unknown,
    theme?: string | object,
    opts?: { renderer?: string; ssr?: boolean; width?: number; height?: number }
  ) => {
    setOption: (option: Record<string, unknown>) => void;
    renderToSVGString: () => string;
    dispose: () => void;
  };
};

export async function renderChartToImage(
  option: Record<string, unknown>,
  width: number,
  height: number
): Promise<{ buffer: Buffer; base64: string; md5: string }> {
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
