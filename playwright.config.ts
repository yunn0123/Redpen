/** Exercise the same canvas bundle through the lightweight browser host simulator. */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "editor.spec.ts", fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4173", viewport: { width: 1360, height: 900 }, channel: "chrome", screenshot: "only-on-failure" },
  webServer: { command: "node scripts/dev.mjs", url: "http://127.0.0.1:4173", reuseExistingServer: !process.env.CI },
});
