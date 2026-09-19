import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };

test.beforeEach(async ({ page }) => {
  // Exercise the workspace composition independently of GPU availability.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
});

async function openProject(page: Page) {
  await page.goto("/");
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "slot.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
    { timeout: 15_000 },
  );
}

test("panel edits, view settings, dialogs and downloads survive workspace restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openProject(page);
  await page.getByRole("spinbutton", { name: /Width X/ }).fill("110");
  await page.getByRole("button", { name: "Walnut", exact: true }).click();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.locator(".assigned-tool").filter({ hasText: "T7" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Custom", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Workspace cutter");
  await dialog.getByRole("spinbutton", { name: /Diameter/ }).fill("5");
  await dialog
    .getByRole("button", { name: "Assign to T7", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".assigned-tool")).toContainText(
    "Workspace cutter",
  );
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );

  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "From G-code to finished part" }),
  ).toBeVisible();
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.locator(".statusbar button").click();
  await expect(
    dialog.getByRole("heading", { name: "Program diagnostics" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("tab", { name: "G-code", exact: true }).click();
  const codeDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download G-code", exact: true })
    .click();
  const codeFile = await codeDownload;
  expect(codeFile.suggestedFilename()).toBe(fixture.filename);
  expect(await readFile((await codeFile.path())!, "utf8")).toBe(fixture.code);

  await page.getByLabel("Show toolpath", { exact: true }).click();
  await page.getByLabel("Show cutter", { exact: true }).click();
  await page.getByLabel("Simulation quality").selectOption("160");
  await page.getByLabel("Playback speed").selectOption("5");
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page
    .getByRole("button", { name: "Back to start", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide setup panel", exact: true })
    .click();

  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectFile = await projectDownload;
  const saved = JSON.parse(await readFile((await projectFile.path())!, "utf8"));
  expect(saved).toMatchObject({
    version: 1,
    filename: fixture.filename,
    code: fixture.code,
    material: "walnut",
    stock: { ...fixture.stock, x: 110 },
    assignments: { 7: { name: "Workspace cutter", diameter: 5 } },
  });
  expect(saved).not.toHaveProperty("demo");
  expect(saved).not.toHaveProperty("view");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Show setup panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Show toolpath", { exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Show cutter", { exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByLabel("Simulation quality")).toHaveValue("160");
  await expect(page.getByLabel("Playback speed")).toHaveValue("5");
  await expect(
    page.getByRole("button", { name: "Top view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("slider")).toHaveValue("0");
  await page
    .getByRole("button", { name: "Show setup panel", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "G-code", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".file-detail")).toContainText(fixture.filename);
  await page.getByRole("tab", { name: "Stock", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: /Width X/ })).toHaveValue(
    "110",
  );
  await expect(
    page.getByRole("button", { name: "Walnut", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".assigned-tool")).toContainText(
    "Workspace cutter",
  );
  expect(errors).toEqual([]);
});

test("dropping new TOP code clears assignments and manual setup reconnects tool configuration", async ({
  page,
}) => {
  await openProject(page);
  const transfer = await page.evaluateHandle((code) => {
    const data = new DataTransfer();
    data.items.add(new File([code], "dropped.nc", { type: "text/plain" }));
    return data;
  }, fixture.code);
  await page
    .locator(".app")
    .dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.locator(".drop-overlay")).toBeVisible();
  await page.locator(".app").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("dropped.nc");
  await dialog
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await expect(page.locator(".drop-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Stock", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Configure T7", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Assign tool · T7", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Custom", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Assign to T7", exact: true })
    .click();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".file-label")).toContainText("dropped.nc");
  await expect(page.locator(".assigned-tool")).toContainText("Custom tool");
  await expect(page.locator(".error-banner")).toHaveCount(0);
});
