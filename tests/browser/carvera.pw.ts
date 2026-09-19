import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import fixture from "../fixtures/slot.forma.json" with { type: "json" };

test("imports and plays the reported Carvera header and split tool-change return", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
  const code = await readFile("tests/fixtures/carvera-tool-change.nc", "utf8");
  const project = {
    ...fixture,
    filename: "carvera-tool-change.nc",
    code,
    stock: { x: 30, y: 40, z: 10, origin: "center", zOrigin: "top" },
    assignments: {
      1: { ...fixture.assignments[7], id: "carvera-flat", diameter: 1.5875 },
      2: {
        ...fixture.assignments[7],
        id: "carvera-ball",
        kind: "ball",
        diameter: 1.5875,
      },
    },
  };
  await page.goto("/");
  await page.getByLabel("Upload G-code or project").setInputFiles({
    name: "carvera.forma.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(
    page.getByText("Cannot simulate this program", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".timeline-change")).toHaveCount(2);
  await page.getByRole("button", { name: /^Jump to tool change: T2/ }).click();
  await expect(page.locator(".viewport-label")).toContainText(
    "Partial simulation",
  );
  const slider = page.getByRole("slider", { name: "Machining progress" });
  await slider.focus();
  await slider.press("End");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.reload();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(page.locator(".timeline-change")).toHaveCount(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/carvera-tool-change.png" });
});
