import { test, expect } from "@playwright/test";

for (const backend of ["gpu", "cpu"]) {
  test(`stock finishes render without changing cut geometry (${backend})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404"))
        errors.push(m.text());
    });
    await page.goto(`/tests/browser/materials.html?${backend}`);
    await page.waitForFunction(() => window.materialsReady);
    const results = await page.evaluate(() => window.materialChecks());
    expect(results).toHaveLength(24);
    for (const result of results) {
      expect(result.coverage, `${result.id} ${result.view}`).toBeGreaterThan(
        3000,
      );
      expect(result.silhouetteMatches, `${result.id} ${result.view}`).toBe(
        true,
      );
      expect(
        result.mean.every((v) => Number.isFinite(v) && v > 0 && v < 255),
      ).toBe(true);
    }
    const top = results.filter((r) => r.view === "top");
    // Distinct finishes must not silently fall back to one uniform material.
    expect(new Set(top.map((r) => r.mean.map(Math.round).join(","))).size).toBe(
      8,
    );
    expect(errors).toEqual([]);
  });
}
