import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  timeout: 60_000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ["--enable-unsafe-webgpu"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
  },
});
