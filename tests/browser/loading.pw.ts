import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import { strToU8, zipSync } from "fflate";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };

test("playback and scrubbing keep loading indicators stable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "slot.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".statusbar")).toContainText("Local engine");
  await page.evaluate(() => {
    const flashes: string[] = [];
    Object.assign(window, { loadingFlashes: flashes });
    const check = () => {
      const status = document.querySelector(".statusbar")!;
      const viewport = document.querySelector(".viewport")!;
      if (
        !status.textContent?.includes("Local engine") ||
        viewport.getAttribute("aria-busy") === "true"
      ) {
        flashes.push(status.textContent ?? "");
      }
    };
    new MutationObserver(check).observe(
      document.querySelector("main")!.parentElement!,
      {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      },
    );
  });
  const slider = page.getByRole("slider");
  await slider.focus();
  await slider.press("Home");
  await page.getByLabel("Playback speed").selectOption("1");
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (const key of [
    "End",
    "Home",
    "ArrowRight",
    "ArrowRight",
    "End",
    "Home",
  ]) {
    await slider.press(key);
  }
  await expect(page.locator(".viewport-label")).toContainText(
    "Partial simulation",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { loadingFlashes: string[] }).loadingFlashes,
    ),
  ).toEqual([]);
});

test("imports show contextual loading, recover from errors and ignore cancelled reads", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name.startsWith("slow-"))
        await new Promise<void>((resolve) => {
          Object.assign(window, { releaseImport: resolve });
        });
      return read.call(this);
    };
  });
  const release = () =>
    page.evaluate(() =>
      (window as unknown as { releaseImport: () => void }).releaseImport(),
    );
  await page.goto("/");
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "slow-top.nc",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture.code),
  });
  await expect(page.locator(".preview-loading")).toContainText(
    "Reading TOP G-code",
  );
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeDisabled();
  await release();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("Upload matching Makera Studio project").setInputFiles({
    name: "slow-invalid.mks",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid archive"),
  });
  await expect(dialog.getByRole("status")).toContainText(
    "Reading Makera Studio project",
  );
  await expect(
    dialog.getByRole("button", { name: "Importing .mks…" }),
  ).toBeDisabled();
  await release();
  await expect(dialog.getByRole("alert")).toContainText(
    "Cannot read Makera project",
  );
  await expect(dialog.getByRole("status")).toHaveCount(0);

  const mks = zipSync({
    "makera.prj": strToU8(
      JSON.stringify({
        project: {
          emUnit: 0,
          stStockInfo: { StockShape: 1, length: 100, width: 70, height: 12 },
          lstCoordinate: {
            "0": {
              path: [
                {
                  tools: [
                    {
                      toolNumber: 7,
                      toolName: "Flat",
                      toolType: 1,
                      diameter: 4,
                      fluteLength: 12,
                      handleDiameter: 4,
                      cornerRadius: 0,
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    ),
  });
  await page.getByLabel("Upload matching Makera Studio project").setInputFiles({
    name: "slow-setup.mks",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(mks),
  });
  await expect(dialog.getByRole("status")).toContainText("slow-setup.mks");
  await release();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".preview-loading")).toHaveCount(0);

  await page.getByLabel("Upload BOTTOM G-code").setInputFiles({
    name: "slow-bottom.nc",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture.code),
  });
  await expect(page.locator(".preview-loading")).toContainText(
    "Reading BOTTOM G-code",
  );
  await expect(
    page.getByRole("button", { name: "Loading BOTTOM…" }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/loading-bottom.png" });
  await release();
  await expect(page.locator(".operation-lane")).toHaveCount(2);
  await expect(page.locator(".preview-loading")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeEnabled();

  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page
    .getByRole("button", { name: "Import stock & tools from .mks" })
    .click();
  await page.getByLabel("Upload matching Makera Studio project").setInputFiles({
    name: "slow-cancelled.mks",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid archive"),
  });
  await expect(dialog.getByRole("status")).toBeVisible();
  await dialog.getByRole("button", { name: "Set up manually" }).click();
  await release();
  await expect(page.locator(".preview-loading")).toHaveCount(0);
  await expect(page.locator(".error-banner")).toHaveCount(0);
  expect(errors).toEqual([]);
});
