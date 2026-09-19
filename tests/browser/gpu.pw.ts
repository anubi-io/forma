import { test, expect } from "@playwright/test";
import type * as Harness from "./harness";
declare global {
  interface Window {
    gpuHarness: typeof Harness;
  }
}

test("real WebGPU agrees with the CPU on profiles, origins, clipping and rewind", async ({
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
  const report = await page.evaluate(async () => {
    const results = [];
    for (const kind of ["flat", "ball", "v"] as const)
      for (const origin of ["corner", "center"] as const) {
        const s = { x: 40, y: 30, z: 10, origin, zOrigin: "top" as const };
        const ox = origin === "center" ? 20 : 0,
          oy = origin === "center" ? 15 : 0;
        const code = `T1 M6\nG0 X${5.031 - ox} Y${6.027 - oy} Z3\nG1 Z-2.3\nG1 X${34.019 - ox} Y${24.033 - oy} Z-5.8\nG1 X${34.22 - ox} Z-1.4\nG1 X${8.07 - ox} Y${10.051 - oy} Z-12\nG0 X80 Y90 Z-4\nG1 X100`;
        results.push(
          await window.gpuHarness.compare(
            code,
            s,
            {
              1: {
                id: kind,
                name: kind,
                kind,
                diameter: 3.175,
                angle: 35,
                tip: 0.2,
              },
            },
            192,
          ),
        );
      }
    results.push(
      await window.gpuHarness.compare(
        "T1 M6\nG0 X20 Y15 Z12\nG1 Z8\nG1 X35 Z5",
        { x: 40, y: 30, z: 10, origin: "corner", zOrigin: "bottom" },
        {
          1: { id: "v", name: "v", kind: "v", diameter: 4, angle: 120, tip: 1 },
        },
        160,
      ),
    );
    return results;
  });
  for (const r of report)
    for (const s of r.results) {
      expect(s.maxError).toBeLessThan(0.003);
      expect(s.volumeError).toBeLessThan(0.05);
    }
  expect(failures).toEqual([]);
});

test("demo agrees with the CPU at its maximum resolution and restores checkpoints", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => !!window.gpuHarness);
  const result = await page.evaluate(() => window.gpuHarness.demo(2400));
  expect(result.samples).toBe(2401 * 1801);
  for (const r of result.results) {
    expect(r.maxError).toBeLessThan(0.003);
    expect(r.volumeError).toBeLessThan(0.05);
  }
  console.log("2,400-cell GPU/CPU:", JSON.stringify(result));
});

test("GPU automatically adapts an oversized index and preserves cuts through rewind", async ({
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
  const report = await page.evaluate(() => window.gpuHarness.maximumGrid(true));
  expect(report.resolution).toBeLessThan(3200);
  expect(report.references).toBeLessThanOrEqual(16_000_000);
  const expectedHeights = [6, 10, 8, 8, 6];
  for (const [i, result] of report.results.entries()) {
    expect(result.heights).toEqual(Array(5).fill(expectedHeights[i]));
    expect(result.removed).toBeCloseTo((10 - expectedHeights[i]) * 40 * 40, 1);
    expect(result.count).toBe(603);
  }
  expect(report.results[0].processed).toBe(603);
  expect(report.results[1].processed).toBe(0);
  expect(report.results[4].processed).toBe(603);
  expect(failures).toEqual([]);
});

test("GPU Ultra handles 31 million samples and more than 65,535 workgroups", async ({
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
  const report = await page.evaluate(() => window.gpuHarness.maximumGrid());
  expect(report.samples).toBe(5601 ** 2);
  expect(report.workgroups).toBeGreaterThan(65_535);
  for (const [i, r] of report.results.entries()) {
    expect(r.removed).toBeCloseTo(i === 1 ? 0 : 3200, 1);
    expect(r.heights).toEqual(Array(5).fill(i === 1 ? 10 : 8));
  }
  expect(failures).toEqual([]);
  console.log("Maximum square grid:", JSON.stringify(report));
});

test("workspace survives quality changes, seeking and camera controls", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404"))
      failures.push(m.text());
  });
  await page.goto("/");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(
    page.getByRole("combobox", { name: "Simulation quality" }),
  ).toHaveValue("600");
  await expect(
    page.locator(".metrics > div").filter({ hasText: "Grid spacing" }),
  ).toContainText("0.038");
  await page
    .getByRole("combobox", { name: "Simulation quality" })
    .selectOption("2400");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await expect(
    page.locator(".metrics > div").filter({ hasText: "Grid spacing" }),
  ).toContainText("0.021");
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page
    .getByRole("button", { name: "Isometric view", exact: true })
    .click();
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to start", exact: true })
    .click();
  await expect(page.locator(".viewport-label")).toContainText(
    "Partial simulation",
  );
  const progress = page.getByRole("slider", { name: "Machining progress" });
  await progress.fill(
    String(Math.round(Number(await progress.getAttribute("max")) / 2)),
  );
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.screenshot({ path: "test-results/ultra-workspace.png" });
  await page
    .getByRole("combobox", { name: "Simulation quality" })
    .selectOption("160");
  await page
    .getByRole("combobox", { name: "Simulation quality" })
    .selectOption("600");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  expect(failures).toEqual([]);
});

test("hierarchical ray casting matches solid and through-hole mesh visibility", async ({
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
  for (const fallback of [false, true])
    for (const samples of [0, 4]) {
      const report = await page.evaluate(
        ([f, s]) => window.gpuHarness.renderChecks(f as boolean, s as number),
        [fallback, samples],
      );
      for (const r of report) {
        expect(r.covered).toBeGreaterThan(5000);
        expect(r.missing, JSON.stringify(r)).toBeLessThanOrEqual(
          samples ? 2 : 0,
        );
        expect(r.extra, JSON.stringify(r)).toBe(0);
        expect(r.depthMismatch, JSON.stringify(r)).toBeLessThanOrEqual(2);
      }
    }
  expect(failures).toEqual([]);
});

test("cancellation, partial dispatch resume and disposal release compute buffers", async ({
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
  const result = await page.evaluate(() => window.gpuHarness.lifecycle());
  expect(result.cancelled).toBe(true);
  for (const error of result.errors) expect(error).toBeLessThan(0.003);
  expect(result.storageAfterDispose).toBe(0);
  expect(result.disposedResult).toBe(true);
  expect(result.storageAfterPending).toBe(0);
  expect(failures).toEqual([]);
});

test("far-away moves are clipped before float32 conversion", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness.html");
  await page.waitForFunction(() => !!window.gpuHarness);
  const reports = await page.evaluate(async () => {
    const results = [];
    for (const kind of ["flat", "ball", "v"] as const) {
      results.push(
        await window.gpuHarness.compare(
          "T1 M6\nG0 X-1000000 Y15.17 Z-2.15\nG1 X1000000 Z-6.27",
          { x: 40, y: 30, z: 10, origin: "corner", zOrigin: "top" },
          {
            1: {
              id: kind,
              name: kind,
              kind,
              diameter: 3.175,
              tip: 0.2,
              angle: 60,
            },
          },
          160,
        ),
      );
    }
    return results;
  });
  for (const r of reports)
    for (const s of r.results) {
      expect(s.maxError).toBeLessThan(0.003);
      expect(s.volumeError).toBeLessThan(0.05);
    }
});

test("a lost GPU device recovers on the CPU without reloading the workspace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args);
      // Three ignores intentional destruction. Convert this real device loss
      // to the unexpected-loss notification emitted by a driver reset.
      Object.defineProperty(device, "lost", {
        value: device.lost.then((info) => ({
          reason: "unknown",
          message: info.message,
        })),
      });
      Object.assign(window, { loseDevice: () => device.destroy() });
      return device;
    };
  });
  await page.goto("/");
  await expect(
    page.getByText("WebGPU · GPU accelerated", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { loseDevice(): void }).loseDevice();
  });
  await expect(
    page.getByText("CPU · Web Worker", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Simulation quality" }),
  ).toHaveValue("600");
  await expect(
    page.locator(".metrics > div").filter({ hasText: "Grid spacing" }),
  ).toContainText("0.2");
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page
    .getByRole("button", { name: "Back to start", exact: true })
    .click();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
});

test("CPU and WebGL fallback renders when WebGPU is absent", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404"))
      failures.push(m.text());
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined }),
  );
  await page.goto("/");
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page.screenshot({ path: "test-results/cpu-workspace.png" });
  await expect(
    page.getByText("CPU · Web Worker", { exact: true }),
  ).toBeVisible();
  expect(failures).toEqual([]);
});

test("a compute pipeline failure keeps the workspace usable on the CPU", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.addInitScript(() => {
    GPUDevice.prototype.createComputePipelineAsync = async () => {
      throw new Error("Regression: compute unavailable");
    };
  });
  await page.goto("/");
  await expect(
    page.getByText("CPU · Web Worker", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect(page.locator(".viewport-label")).toContainText(
    "Machining complete",
  );
  await page
    .getByRole("button", { name: "Back to start", exact: true })
    .click();
  await expect(page.getByText("0%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});

for (const demo of [true, false]) {
  test(`saved ${demo ? "retired demo is refreshed" : "imported project is preserved"} and reload example restores Detailed`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/harness.html");
    await page.evaluate(async (isDemo) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("forma-workspace", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            {
              version: 1,
              demo: isDemo,
              filename: "desk-tray.nc",
              code: "T1 M6\nG0 X5 Y5 Z5\nG1 Z-2",
              stock: { x: 40, y: 30, z: 10, origin: "corner", zOrigin: "top" },
              material: "aluminum",
              assignments: {
                1: { id: "flat", name: "Flat", kind: "flat", diameter: 3 },
              },
            },
            "project",
          );
          tx.objectStore("workspace").put(
            { resolution: 320, fraction: 1 },
            "view",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      });
    }, demo);
    await page.goto("/");
    await expect(page.locator(".viewport-label")).toContainText(
      "Machining complete",
    );
    const quality = page.getByRole("combobox", { name: "Simulation quality" });
    await expect(quality).toHaveValue(demo ? "600" : "320");
    await expect(page.locator(".file-label")).toContainText(
      demo ? "tidal-relief.nc" : "desk-tray.nc",
    );
    // An explicitly selected preset survives refresh; loading the example resets it.
    await quality.selectOption("160");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open("forma-workspace", 1);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => {
                const db = request.result;
                const read = db
                  .transaction("workspace", "readonly")
                  .objectStore("workspace")
                  .get("view");
                read.onsuccess = () => {
                  db.close();
                  resolve(read.result?.resolution);
                };
                read.onerror = () => reject(read.error);
              };
            }),
        ),
      )
      .toBe(160);
    await page.reload();
    await expect(quality).toHaveValue("160");
    await page.getByRole("button", { name: "Reload example" }).click();
    await expect(quality).toHaveValue("600");
    await expect(page.locator(".file-label")).toContainText("tidal-relief.nc");
    await expect(page.locator(".viewport-label")).toContainText(
      "Machining complete",
    );
  });
}
