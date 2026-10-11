/** Run the installed VS Code in an isolated profile to verify actual webview and document integration. */
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests", testMatch: "vscode.spec.ts", outputDir: "test-results-native", timeout: 60_000, workers: 1 });
