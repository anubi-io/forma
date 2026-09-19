import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Source: the supplied "The Cloner · Radial · 6.svg", preserved in public/logo.svg.
// Rasterize the vector without changing its paths, colors, or proportions.
const publicDir = new URL("../public/", import.meta.url);
const svg = await readFile(new URL("logo.svg", publicDir), "utf8");
const background = "#f8f8f8";
const exports = [
  { name: "og-image.png", width: 1200, height: 630, logo: 380 },
  { name: "og-image-square.png", width: 1200, height: 1200, logo: 660 },
  { name: "apple-touch-icon.png", width: 180, height: 180, logo: 160 },
  { name: "favicon-32.png", width: 32, height: 32, logo: 32 },
];

await writeFile(
  new URL("favicon.svg", publicDir),
  svg.replace(
    /(<svg\b[^>]*>)/,
    `$1\n<rect width="1800" height="1800" rx="240" fill="${background}"/>`,
  ),
);

const browser = await chromium.launch({ channel: "chromium" });
try {
  for (const asset of exports) {
    const page = await browser.newPage({
      viewport: { width: asset.width, height: asset.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:100vw;height:100vh;display:grid;place-items:center;background:${background}"><img alt="Forma logo" width="${asset.logo}" height="${asset.logo}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({
      path: fileURLToPath(new URL(asset.name, publicDir)),
    });
    await page.close();
    console.log(`${asset.name}: ${asset.width} × ${asset.height}`);
  }
} finally {
  await browser.close();
}

// PNG-backed ICO for clients that request /favicon.ico automatically.
const png = await readFile(new URL("favicon-32.png", publicDir));
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
await writeFile(
  new URL("favicon.ico", publicDir),
  Buffer.concat([header, png]),
);
