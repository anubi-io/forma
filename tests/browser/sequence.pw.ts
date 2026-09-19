import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };
import type * as Harness from "./harness";
declare global {
  interface Window {
    gpuHarness: typeof Harness;
  }
}

test("two-sided ray casting renders both boundaries and through cuts on WebGPU and WebGL", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404"))
      failures.push(m.text());
  });
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => !!window.gpuHarness);
  for (const fallback of [false, true]) {
    const report = await page.evaluate(
      (f) => window.gpuHarness.renderChecks(f, 0, true),
      fallback,
    );
    for (const r of report) {
      expect(r.covered).toBeGreaterThan(1000);
      expect(r.missing, JSON.stringify(r)).toBeLessThanOrEqual(2);
      expect(r.extra, JSON.stringify(r)).toBeLessThanOrEqual(2);
      expect(r.depthMismatch, JSON.stringify(r)).toBeLessThanOrEqual(2);
    }
  }
  expect(failures).toEqual([]);
});

test("TOP and BOTTOM share one scrubber and survive order, axis, rewind, export and refresh", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404"))
      failures.push(m.text());
  });
  await page.goto("/");
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "two-side.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...fixture, filename: "top.nc" })),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.getByLabel("Upload BOTTOM G-code").setInputFiles({
    name: "bottom.nc",
    mimeType: "text/plain",
    buffer: Buffer.from("T7 M6\nG0 X10 Y10 Z5\nG1 Z-2\nG1 X30"),
  });
  await expect(page.locator(".operation-lane")).toHaveCount(2);
  await expect(page.getByLabel("Stock flip axis")).toHaveValue("y");
  await expect(
    page.locator(".project-bar").getByRole("button", { name: /BOTTOM/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Flip through the stock centre.", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(1);
  await expect(page.locator(".playback-line")).toContainText("TOP");
  await expect(
    page.locator('.sequence-timeline input[type="range"]'),
  ).toHaveCount(0);
  const slider = page.getByRole("slider");
  // Imports now keep playback disabled until the first surface is ready.
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  const max = Number(await slider.getAttribute("aria-valuemax"));
  for (const [side, start, end] of [
    ["top", 0.2, 0.7],
    ["bottom", 0.8, 0.3],
  ] as const) {
    const lane = await page.locator(`.operation-lane.${side}`).boundingBox();
    if (!lane) throw new Error(`Missing ${side} lane`);
    await page.mouse.move(
      lane.x + lane.width * start,
      lane.y + lane.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(lane.x + lane.width * end, lane.y + lane.height / 2, {
      steps: 5,
    });
    await expect
      .poll(
        async () => Number(await slider.getAttribute("aria-valuenow")) / max,
      )
      .toBeCloseTo(Math.round(end * max) / max, 2);
    await page.mouse.up();
    await expect
      .poll(
        async () => Number(await slider.getAttribute("aria-valuenow")) / max,
      )
      .toBeCloseTo(Math.round(end * max) / max, 2);
  }
  const lanes = await page.locator(".sequence-lanes").boundingBox();
  if (!lanes) throw new Error("Missing sequence lanes");
  await page.mouse.move(lanes.x + lanes.width / 2, lanes.y + 15);
  await page.mouse.down();
  await page.mouse.move(lanes.x - 20, lanes.y - 20);
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".playback-line")).toContainText("BOTTOM");
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/two-sided-workspace.png" });
  const canvas = await page.locator(".viewport canvas").boundingBox();
  if (!canvas) throw new Error("Missing viewport");
  // Top face of the visible navigation cube in the initial isometric view.
  await page.mouse.click(canvas.x + 88, canvas.y + canvas.height - 115);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("forma-workspace", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const view = await new Promise<any>((resolve, reject) => {
          const request = db
            .transaction("workspace")
            .objectStore("workspace")
            .get("view");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        const camera = view?.camera;
        return (
          !!camera &&
          Math.abs(camera.position[0] - camera.target[0]) < 5 &&
          Math.abs(camera.position[2] - camera.target[2]) < 5 &&
          camera.position[1] > camera.target[1]
        );
      }),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Isometric view", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide setup panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show setup panel", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Simulation quality" })
    .selectOption("2400");
  await expect(
    page.locator(".metrics > div").filter({ hasText: "Grid spacing" }),
  ).toContainText("0.018");
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Simulation quality" })
    .selectOption("600");
  await page.getByLabel("Operation order").selectOption("bottom");
  await expect(page.locator(".operation-lane").first()).toContainText("BOTTOM");
  await expect(page.locator(".playback-line")).toContainText("BOTTOM");
  await page.getByLabel("Stock flip axis").selectOption("y");
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.locator(".playback-line")).toContainText("TOP");
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.getByRole("slider").press("Home");
  await expect(page.locator(".playback-line")).toContainText("BOTTOM");
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const saved = JSON.parse(Buffer.concat(chunks).toString());
  expect(saved.bottom).toMatchObject({
    filename: "bottom.nc",
    firstSide: "bottom",
    flipAxis: "y",
  });
  await page.reload();
  await expect(page.getByLabel("Operation order")).toHaveValue("bottom");
  await expect(page.getByLabel("Stock flip axis")).toHaveValue("y");
  await expect(page.locator(".operation-lane")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove BOTTOM operation" }).click();
  await expect(page.locator(".operation-lane")).toHaveCount(0);
  await expect(page.getByRole("slider")).toHaveCount(1);
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "restored.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".operation-lane")).toHaveCount(2);
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  expect(failures).toEqual([]);
});

test("WebGPU two-sided cuts match CPU for both flip axes, orders, profiles, cancellation and rewind", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404"))
      failures.push(m.text());
  });
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => !!window.gpuHarness);
  const report = await page
    .evaluate(() => window.gpuHarness.sequenceChecks())
    .catch((error) => {
      throw new Error(`${error.message}\n${failures.join("\n")}`);
    });
  for (const result of report.results) {
    expect(result.maxError, JSON.stringify(result)).toBeLessThan(0.003);
    expect(result.volumeError, JSON.stringify(result)).toBeLessThan(0.05);
  }
  expect(report.storageAfterDispose).toBe(0);
  expect(failures).toEqual([]);
});
