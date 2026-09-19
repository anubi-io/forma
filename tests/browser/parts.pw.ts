import { test, expect } from "@playwright/test";
for (const backend of [
  "gpu",
  "cpu",
  "gpu&dual",
  "cpu&dual",
  "gpu&threads",
  "gpu&dual&threads",
])
  test(`isolated material stays idle during unchanged hover (${backend})`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/parts.html?${backend}`);
    if (backend.includes("threads"))
      await page.waitForFunction(() => window.partsReady);
    const canvas = page.locator("canvas");
    await page.mouse.move(280, 300);
    await expect
      .poll(
        async () => {
          await page.mouse.move(281, 300);
          await page.mouse.move(280, 300);
          return canvas.evaluate((e) => getComputedStyle(e).cursor);
        },
        { timeout: 15000 },
      )
      .toBe("pointer");
    const material = await page.evaluate(() => window.partsMaterial());
    expect(material).toBeDefined();
    await page.mouse.click(280, 300);
    await page.mouse.move(520, 300);
    await expect(canvas).not.toHaveCSS("cursor", "pointer");
    await page.mouse.move(280, 300);
    await expect(canvas).toHaveCSS("cursor", "pointer");
    expect(await page.evaluate(() => window.partsMaterial())).toBe(material);
    await page.waitForTimeout(500);
    const frames = await page.evaluate(
      () => window.partsRenderer.info.render.calls,
    );
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => window.partsRenderer.info.render.calls),
    ).toBe(frames);
    for (let x = 281; x < 301; x++) {
      await page.mouse.move(x, 300);
      await page.waitForTimeout(20);
    }
    expect(
      await page.evaluate(() => window.partsRenderer.info.render.calls),
    ).toBe(frames);
    await page.mouse.click(280, 300);
    await page.mouse.move(520, 300);
    await expect(canvas).toHaveCSS("cursor", "pointer");
    expect(await page.evaluate(() => window.partsMaterial())).toBe(material);
  });
for (const backend of [
  "gpu",
  "cpu",
  "gpu&dual",
  "cpu&dual",
  "gpu&threads",
  "gpu&dual&threads",
])
  test(`hover and click detached material (${backend})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404"))
        errors.push(m.text());
    });
    await page.goto(`/tests/browser/parts.html?${backend}`);
    if (backend.includes("threads"))
      await page.waitForFunction(() => window.partsReady);
    const canvas = page.locator("canvas");
    await page.mouse.move(280, 300);
    await expect
      .poll(
        async () => {
          await page.mouse.move(281, 300);
          await page.mouse.move(280, 300);
          return canvas.evaluate((e) => getComputedStyle(e).cursor);
        },
        { timeout: 15000 },
      )
      .toBe("pointer");
    await page.mouse.move(20, 20);
    const whole = await canvas.screenshot();
    const partClip = { x: 180, y: 200, width: 180, height: 200 };
    const threadedPart = backend.includes("threads")
      ? await page.screenshot({ clip: partClip })
      : undefined;
    await page.mouse.move(280, 300);
    expect((await canvas.screenshot()).equals(whole)).toBe(false);
    await page.mouse.click(280, 300);
    await page.mouse.move(520, 300);
    await expect(canvas).not.toHaveCSS("cursor", "pointer");
    await page.mouse.move(20, 20);
    expect((await canvas.screenshot()).equals(whole)).toBe(false);
    if (threadedPart)
      expect(
        (await page.screenshot({ clip: partClip })).equals(threadedPart),
      ).toBe(true);
    await page.mouse.click(280, 300);
    await page.mouse.move(520, 300);
    await expect(canvas).toHaveCSS("cursor", "pointer");
    await page.mouse.move(20, 20);
    expect((await canvas.screenshot()).equals(whole)).toBe(true);
    await page.mouse.move(400, 300);
    await expect(canvas).not.toHaveCSS("cursor", "pointer");
    // Playback invalidates selection immediately, then detection runs automatically again.
    await page.mouse.click(280, 300);
    await page.getByRole("button").click();
    await page.mouse.move(520, 300);
    await expect(canvas).not.toHaveCSS("cursor", "pointer");
    await page.getByRole("button").click();
    await page.mouse.move(520, 300);
    await expect(canvas).toHaveCSS("cursor", "pointer");
    await page.mouse.move(280, 300);
    await page.mouse.down();
    await page.mouse.move(300, 300, { steps: 5 });
    await page.mouse.up();
    await page.mouse.move(520, 300);
    await expect(canvas).toHaveCSS("cursor", "pointer");
    expect(errors).toEqual([]);
    if (threadedPart) {
      // The unchanged isolated crop must actually contain thread geometry.
      await page.goto(
        `/tests/browser/parts.html?${backend.replace("&threads", "")}`,
      );
      await page.waitForFunction(() => window.partsReady);
      await page.mouse.move(20, 20);
      expect(
        (await page.screenshot({ clip: partClip })).equals(threadedPart),
      ).toBe(false);
    }
  });
