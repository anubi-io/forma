import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };

const clean =
  "G21 G90\nT7 M6\nS12000 M3\nG0 X20 Y20 Z5\nG1 Z-1 F120\nG1 X70 F600\nG0 Z5\nM30";
const repeated =
  "G21 G90\nT7 M6\nS12000 M3\nG0 X20 Y20 Z5\nG1 Z-1 F120\nG1 X70 F600\nG0 Z5\nG0 X20\nG1 Z-1 F120\nG1 X70 F600\nG0 Z5\nG0 X30 Y40\nG1 Z-13 F120\nG1 X102 F600\nG0 Z5\nM30";
async function load(page: Page, code: string, overrides = {}) {
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "analysis.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...fixture, code, ...overrides })),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".optimization-sr-status")).toHaveText(
    /\d+ warnings?|\d+ optimizations?|Looking good|^Optimizations$/,
  );
}
test.beforeEach(async ({ page }) => {
  // These are UI/worker lifecycle checks, independent of the WebGPU test suite.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
});

test("closed floating insights, savings, source seek, material reanalysis and happy state", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await load(page, repeated);
  const trigger = page.getByRole("button", { name: /^Open optimizations:/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toContainText("warnings");
  await expect(trigger).toContainText("~5s");
  await expect(
    page.getByRole("complementary", { name: "Optimizations", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/analysis-closed.png" });
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "Optimizations",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".optimization-potential")).toContainText("~5s");
  await expect(panel).toContainText("Cut below stock bottom");
  await expect(
    panel.getByRole("button", { name: "Close optimizations" }),
  ).toBeFocused();
  await page.screenshot({ path: "test-results/analysis-panel.png" });
  await panel.getByRole("button", { name: /^Warnings/ }).click();
  await expect(panel).toContainText("Cut below stock bottom");
  await panel.getByRole("button", { name: /^Optimize/ }).click();
  const repeat = panel.locator("article").filter({ hasText: "Repeated paths" });
  await expect(repeat.locator("details")).not.toHaveAttribute("open", "");
  await repeat
    .getByRole("button", { name: "Show Repeated paths, occurrence 1 of 1" })
    .click();
  await expect(page.locator(".playback-line")).toContainText("Line 10");
  await expect(page.getByLabel("Show cutter")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
  await panel.getByLabel("Analysis material").selectOption("walnut");
  await expect(panel.getByLabel("Analysis material")).toHaveValue("walnut");
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close optimizations" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await load(page, clean);
  await expect(trigger).toContainText("Looking good");
  await expect(trigger.locator("svg").first()).toBeVisible();
  await trigger.click();
  await expect(panel).toContainText("No issues found.");
  await page.screenshot({ path: "test-results/analysis-happy.png" });
  await panel.getByRole("button", { name: "Close optimizations" }).click();
  await page.reload();
  await expect(trigger).toContainText("Looking good");
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("partial setup, changing input during analysis, both faces and narrow-screen access", async ({
  page,
}) => {
  await page.goto("/");
  await load(page, repeated);
  const trigger = page.getByRole("button", { name: /^Open optimizations:/ });
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "Optimizations",
    exact: true,
  });
  await load(page, clean, {
    assignments: { 7: { ...fixture.assignments[7], kind: "unsupported" } },
  });
  await expect(panel).toContainText("No suggestions.");
  await expect(panel).not.toContainText(
    /checks? limited|analysis grid|Counts refer|Entry checks|Overlapping segments/,
  );
  await expect(page.locator(".optimization-sr-status")).toHaveText("Optimizations");
  await expect(panel.locator(".optimization-happy")).toHaveCount(0);
  await expect(panel).not.toContainText("No issues found.");
  await load(page, repeated);
  await load(page, clean);
  await expect(panel).toContainText("No issues found.");
  await expect(panel.locator(".optimization-potential")).toHaveCount(0);
  await load(page, clean, {
    bottom: {
      code: repeated,
      filename: "bottom.nc",
      flipAxis: "y",
      firstSide: "bottom",
    },
  });
  await expect(panel).toContainText("BOTTOM · T7");
  await panel.getByRole("button", { name: /^Optimize/ }).click();
  await panel
    .getByRole("button", { name: "Show Repeated paths, occurrence 1 of 1" })
    .click();
  await expect(page.locator(".playback-line")).toContainText(
    "BOTTOM · Line 10",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/analysis-mobile.png" });
  await panel.getByRole("button", { name: "Close optimizations" }).click();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(panel).toBeVisible();
});

test("shows all 16 occurrences and navigates directly to the last one", async ({
  page,
}) => {
  await page.goto("/");
  const paths = Array.from(
    { length: 16 },
    (_, i) =>
      `G0 Z5\nG0 X20 Y${10 + i * 4}\nG1 Z-1 F120\nG1 X70 F600\nG1 X20 F600\nG0 Z5`,
  ).join("\n");
  await load(page, `G21 G90\nT7 M6\nS12000 M3\n${paths}\nM30`, {
    stock: { ...fixture.stock, y: 90 },
  });
  const trigger = page.getByRole("button", {
    name: "Open optimizations: 16 optimizations",
  });
  await expect(trigger).toContainText("~1m 20s");
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "Optimizations",
    exact: true,
  });
  await expect(
    panel.getByRole("button", { name: /^Optimize\s*16$/ }),
  ).toBeVisible();
  await expect(panel.locator("article .optimization-count")).toHaveText("16×");
  const occurrence = panel.getByLabel("Occurrence of Repeated paths");
  await expect(occurrence.locator("option")).toHaveCount(16);
  await occurrence.selectOption("15");
  await expect(page.locator(".playback-line")).toContainText("Line 98");
  await expect(
    panel.getByRole("button", { name: "Next Repeated paths" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Previous Repeated paths" }).click();
  await expect(occurrence).toHaveValue("14");
  await expect(page.locator(".playback-line")).toContainText("Line 92");
  await expect(panel.locator(".optimization-footer")).toContainText("Finished");
  await page.screenshot({ path: "test-results/analysis-sixteen.png" });
});

test("fine cutters do not expose internal grid diagnostics or hide real findings", async ({
  page,
}) => {
  await page.goto("/");
  const setup = {
    assignments: { 7: { ...fixture.assignments[7], diameter: 0.01 } },
  };
  await load(page, clean, setup);
  const trigger = page.getByRole("button", { name: /^Open optimizations:/ });
  await expect(trigger).toHaveText("Optimizations");
  await expect(trigger).not.toHaveClass(/clear/);
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "Optimizations",
    exact: true,
  });
  await expect(panel).toContainText("No suggestions.");
  await expect(panel).not.toContainText(
    /checks? limited|analysis grid|Counts refer|Entry checks|Overlapping segments|No issues found/,
  );
  await load(page, repeated, setup);
  await expect(panel).toContainText("Cut below stock bottom");
  await expect(panel).not.toContainText(
    /checks? limited|analysis grid|Counts refer|Entry checks|Overlapping segments/,
  );
  await page.screenshot({
    path: "test-results/analysis-without-diagnostics.png",
  });
});

test("includes inefficient re-entry in the potential total and optimization tab", async ({
  page,
}) => {
  await page.goto("/");
  const cycling =
    "G21 G90\nT7 M6\nS12000 M3\nG0 X20 Y20 Z5\nG1 Z0 F100\n" +
    Array.from(
      { length: 20 },
      () => "G1 X24 Z-1 F60\nG1 X20 Z-1\nG1 X24 Z-1\nG1 X20 Z0",
    ).join("\n") +
    "\nG0 Z5\nM30";
  await load(page, cycling);
  const trigger = page.getByRole("button", { name: /^Open optimizations:/ });
  await expect(trigger).toContainText("~5m 27s");
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "Optimizations",
    exact: true,
  });
  await expect(panel.locator(".optimization-potential")).toContainText(
    "Potentially optimizable time",
  );
  await expect(panel.locator(".optimization-potential")).toContainText(
    "~5m 27s",
  );
  await panel.getByRole("button", { name: /^Optimize/ }).click();
  const diagnostic = panel
    .locator("article")
    .filter({ hasText: "Repeated Z returns" });
  await expect(diagnostic.locator(".optimization-time")).toHaveText("~5m 27s");
  await diagnostic
    .getByRole("button", { name: "Show Repeated Z returns, occurrence 1 of 1" })
    .click();
  await expect(page.locator(".playback-line")).toContainText("Line 9");
  await diagnostic.locator("summary").click();
  await expect(diagnostic).toContainText("20 feed returns");
  await expect(diagnostic).toContainText("Overlapping findings count once");
  await page.screenshot({ path: "test-results/analysis-time-spent.png" });
});
