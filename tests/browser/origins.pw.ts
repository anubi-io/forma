import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };
import type * as Harness from "./harness";

async function loadProject(page: Page, project = fixture) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
  await page.goto("/");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
    { timeout: 20_000 },
  );
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "origin.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  // Wait for the imported project: the completed demo can still be visible
  // while the file is being read asynchronously.
  await expect(page.locator(".file-label")).toContainText(project.filename);
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
    { timeout: 20_000 },
  );
}

test("custom origin fields are conditional, retain values, and survive save/reload/import", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadProject(page, { ...fixture, code: "G55\n" + fixture.code });
  await expect(page.locator(".origin-note")).toContainText("G55");
  await expect(
    page.getByRole("spinbutton", { name: /X from left edge/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: /Z above stock bottom/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Work coordinate setup")).not.toBeVisible();
  await page.getByLabel("XY plane", { exact: true }).selectOption("center");
  await page.getByLabel("XY plane", { exact: true }).selectOption("custom");
  const x = page.getByRole("spinbutton", { name: /X from left edge/ });
  const y = page.getByRole("spinbutton", { name: /Y from front edge/ });
  await expect(x).toHaveValue("50");
  await expect(y).toHaveValue("35");
  await x.fill("-2.5");
  await y.fill("4");
  await page.getByLabel("Z zero", { exact: true }).selectOption("custom");
  const z = page.getByRole("spinbutton", { name: /Z above stock bottom/ });
  await expect(z).toHaveValue("12");
  await z.fill("13.5");
  await page.getByLabel("XY plane", { exact: true }).selectOption("corner");
  await page.getByLabel("Z zero", { exact: true }).selectOption("top");
  await expect(x).toHaveCount(0);
  await expect(z).toHaveCount(0);
  await page.getByLabel("XY plane", { exact: true }).selectOption("custom");
  await page.getByLabel("Z zero", { exact: true }).selectOption("custom");
  await expect(x).toHaveValue("-2.5");
  await expect(z).toHaveValue("13.5");
  await z.fill("");
  await z.press("Tab");
  await expect(z).toHaveValue("13.5");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await downloading;
  const saved = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(saved.stock).toMatchObject({
    origin: "custom",
    originX: -2.5,
    originY: 4,
    zOrigin: "custom",
    originZ: 13.5,
  });
  await page.reload();
  await expect(x).toHaveValue("-2.5");
  await expect(y).toHaveValue("4");
  await expect(z).toHaveValue("13.5");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "restored.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await z.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/custom-origins.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await z.scrollIntoViewIfNeeded();
  await expect(z).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/custom-origins-mobile.png" });
  expect(errors).toEqual([]);
});

test("supplies and updates missing G55 offsets without reimporting the program", async ({
  page,
}) => {
  await loadProject(page);
  const code =
    "T7 M6\nM3 S12000\nG54\nG0 X10 Y10 Z5\nG1 Z-2 F600\nX20\nG28\nT7 M6\nG55\nG0 X10 Y30\nZ5\nG1 Z-2\nX20";
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "two-zeros.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...fixture, code })),
  });
  await expect(
    page.getByText("Cannot simulate this program", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".error-banner")).toContainText("Work offsets");
  await page.locator(".work-offsets summary").click();
  await page.getByLabel("Work coordinate setup").selectOption("separate");
  await expect(page.getByText(/G55 needs an XYZ offset/)).toBeVisible();
  await page.getByRole("button", { name: "Add offset", exact: true }).click();
  await page.getByRole("spinbutton", { name: /G55 X/ }).fill("30");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(
    page.getByText("Cannot simulate this program", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("spinbutton", { name: /G55 X/ }).fill("40");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.reload();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.locator(".work-offsets summary").click();
  await expect(page.getByLabel("Work coordinate setup")).toHaveValue(
    "separate",
  );
  await expect(page.getByRole("spinbutton", { name: /G55 X/ })).toHaveValue(
    "40",
  );
  await page
    .getByRole("spinbutton", { name: /G55 Z/ })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/work-offsets.png" });
  await page.getByRole("button", { name: "Remove G55 offset" }).click();
  await expect(page.getByText(/G55 needs an XYZ offset/)).toBeVisible();
});

test("custom origins and separate G55 offsets agree on CPU and WebGPU through rewind", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(
    () => !!(window as unknown as { gpuHarness: typeof Harness }).gpuHarness,
  );
  const report = await page.evaluate(async () => {
    const harness = (window as unknown as { gpuHarness: typeof Harness })
      .gpuHarness;
    return harness.compare(
      "T1 M6\nG54 G0 X8 Y6 Z3\nG1 Z-3 F600\nX15\nG28\nT1 M6\nG55 G0 X5 Y4\nZ3\nG1 Z-4\nX15",
      {
        x: 50,
        y: 40,
        z: 10,
        origin: "custom",
        originX: -3,
        originY: 5,
        zOrigin: "custom",
        originZ: 11,
        workOffsets: { 55: [20, 5, 0] },
      },
      { 1: { id: "ball", name: "Ball", kind: "ball", diameter: 3 } },
      160,
    );
  });
  for (const sample of report.results) {
    expect(sample.maxError).toBeLessThan(0.003);
    expect(sample.volumeError).toBeLessThan(0.05);
  }
});
