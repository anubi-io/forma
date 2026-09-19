import { test, expect } from "@playwright/test";
import type * as Harness from "./harness";
import fixture from "../fixtures/thread-m5.forma.json" with { type: "json" };
declare global {
  interface Window {
    gpuHarness: typeof Harness;
  }
}

test("compressed thread index preserves every GPU cut through long runs, gaps and rewinds", async ({
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
  const r = await page.evaluate(() => window.gpuHarness.threadRangeChecks());
  expect(failures).toEqual([]);
  expect(r.maxError).toBe(0);
  expect(r.volumeError).toBe(0);
  expect(r.compressedBytes).toBeLessThan(r.explicitBytes / 100);
  expect(r.storageAfterDispose).toBe(0);
});

for (const direct of [true, false])
  test(`thread volume (${direct ? "direct" : "hashed"} pages) matches a swept tooth, rewinds and renders`, async ({
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
    const r = await page.evaluate(
      (direct) => window.gpuHarness.threadChecks(direct),
      direct,
    );
    expect(failures).toEqual([]);
    expect(r.checked).toBeGreaterThan(100);
    expect(r.mismatches).toBe(0);
    expect(r.atlasError).toBeLessThan(0.00001);
    expect(r.volumes[0]).toBeGreaterThan(0);
    expect(r.volumes[1]).toBe(0);
    expect(r.volumes[2]).toBeLessThan(r.volumes[0]);
    expect(r.volumes[4]).toBeCloseTo(r.volumes[0], 5);
    expect(r.renderedPixels).toBeGreaterThan(500);
    expect(r.storageAfterDispose).toBe(0);
  });

test("thread project imports, renders its cutter, persists and falls back without CPU carving", async ({
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
    name: "thread-m5.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-loading")).not.toBeVisible();
  const threads = page.getByRole("button", {
    name: "Model threads",
    exact: true,
  });
  const quality = page.getByLabel("Simulation quality");
  const threadSpacing = page.getByText(/· thread .* mm/);
  await expect(threads).toHaveAttribute("aria-pressed", "false");
  await expect(threadSpacing).toHaveCount(0);
  await quality.selectOption("2400");
  await threads.click();
  await expect(threads).toHaveAttribute("aria-pressed", "true");
  await expect(quality).toHaveValue("600");
  await expect(quality.locator('option[value="2400"]')).toBeDisabled();
  await expect(threadSpacing).toBeVisible();
  await quality.selectOption("320");
  await expect(threadSpacing).toBeVisible();
  await threads.click();
  await expect(page.locator(".preview-loading")).not.toBeVisible();
  await expect(threadSpacing).toHaveCount(0);
  await expect(quality.locator('option[value="2400"]')).toBeEnabled();
  await threads.click();
  await expect(quality).toHaveValue("320");
  await expect(threadSpacing).toBeVisible();
  await page.screenshot({ path: "test-results/thread-m5-workspace.png" });
  await page.getByRole("button", { name: "Show cutter", exact: true }).click();
  await page.screenshot({ path: "test-results/thread-m5-cutter.png" });
  await page.reload();
  await expect(threads).toHaveAttribute("aria-pressed", "false");
  await expect(threadSpacing).toHaveCount(0);
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-loading")).not.toBeVisible();
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.reload();
  await expect(
    page.getByText("CPU · Web Worker", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-loading")).not.toBeVisible();
  await page.getByRole("button", { name: /notes? to review/ }).click();
  await expect(threads).toBeDisabled();
  await expect(
    page.getByText(/thread material removal requires WebGPU/),
  ).toBeVisible();
  expect(failures).toEqual([]);
});

test("helical threads change hole walls, survive both flips and count overlap once", async ({
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
  const r = await page.evaluate(() => window.gpuHarness.threadHelixChecks());
  console.log(
    "Thread render ms/frame (single face, then four flips):",
    r.renderMs,
  );
  expect(failures).toEqual([]);
  expect(r.changedPixels).toBeGreaterThan(100);
  expect(r.addedVolume).toBeGreaterThan(1);
  expect(
    Math.max(...r.flippedVolumes) - Math.min(...r.flippedVolumes),
  ).toBeLessThan(0.02);
  expect(r.overlapError).toBeLessThan(0.001);
  expect(r.storageAfterDispose).toBe(0);
});
