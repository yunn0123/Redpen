/** Test a real VS Code webview, document save/undo, and exported files with a disposable profile. */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readRedpenSvg } from "../src/svg";
import { deflateSync, crc32 } from "node:zlib";

/** Generate a plain PNG fixture without shipping user screenshots or adding an imaging dependency. */
function screenshot(width = 800, height = 600): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1), 240);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  /** PNG chunks include CRCs so the browser exercises a valid raster resource. */
  const chunk = (name: string, data: Buffer): Buffer => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(name, 4); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

test("VS Code opens a draft, saves comments, undoes changes, and writes an agent export", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "redpen-vscode-"));
  const workspace = join(temporary, "workspace"); await mkdir(workspace);
  const file = join(workspace, "legacy.uifeedback.json");
  await writeFile(join(workspace, "screen.png"), screenshot());
  await writeFile(file, JSON.stringify({ version: 1, image: "screen.png", items: [{ id: "native-note", kind: "note", x: 100, y: 100, width: 220, height: 120, color: "#f35e5e", text: "", comment: "原始需求" }] }, null, 2));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
  const app = await electron.launch({
    executablePath: process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    args: ["--no-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${join(temporary, "profile")}`, `--extensions-dir=${join(temporary, "extensions")}`, `--extensionDevelopmentPath=${resolve(".")}`, workspace, file],
    env, timeout: 30_000,
  });
  try {
    const window = await app.firstWindow();
    await window.locator(".monaco-editor").first().waitFor({ timeout: 20_000 });
    await window.locator(".monaco-editor").first().click();
    await window.keyboard.press("F1");
    const quickInput = window.locator(".quick-input-widget input");
    await quickInput.fill(">View: Reopen Editor With...", { timeout: 10_000 });
    await window.keyboard.press("Enter");
    await window.getByText("redpen Canvas", { exact: true }).first().click({ timeout: 10_000 });
    let frame = window.frames()[0];
    // The inner frame containing the bundled app can be identified independently of VS Code's wrapper URL.
    await expect.poll(async () => {
      for (const candidate of window.frames()) if (await candidate.locator("#filename").count()) { frame = candidate; return true; }
      return false;
    }, { timeout: 30_000 }).toBeTruthy();
    await expect(frame!.locator("#filename")).toContainText("800 × 600");
    await expect(window.locator(".tab").filter({ hasText: "redpen Canvas 1" }).first()).toBeVisible();
    await expect(window.getByText("redpen: Paste a screenshot, annotate changes, then export an SVG for your agent.", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Open guide", exact: true }).click();
    await expect.poll(async () => {
      for (const candidate of window.frames()) if (await candidate.getByRole("heading", { name: "Quick start", exact: true }).count()) return true;
      return false;
    }).toBeTruthy();
    await window.locator(".tab").filter({ hasText: "redpen Canvas 1" }).first().click();
    await expect.poll(async () => {
      for (const candidate of window.frames()) if (await candidate.locator("#filename").count()) { frame = candidate; return true; }
      return false;
    }).toBeTruthy();
    await expect(window.getByText("redpen: Paste a screenshot, annotate changes, then export an SVG for your agent.", { exact: true })).toHaveCount(0);
    await frame!.getByRole("button", { name: "Show requests", exact: true }).click();
    await frame!.getByRole("button", { name: "Fit to view", exact: true }).click();
    await frame!.locator(".item-card").click();
    await frame!.locator("#comment").fill("");
    await frame!.locator("#comment").pressSequentially("點擊後新增輸入框，顯示 tooltip。", { delay: 20 });
    await expect(frame!.locator("#comment")).toHaveValue("點擊後新增輸入框，顯示 tooltip。");
    await frame!.getByRole("button", { name: "Select", exact: true }).click();
    await frame!.locator("#canvas").focus();
    await window.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    // Retry while VS Code is writing; the file can briefly contain incomplete JSON.
    await expect(async () => {
      expect(JSON.parse(await readFile(file, "utf8")).items[0].comment).toContain("tooltip");
    }).toPass({ timeout: 5000 });
    await frame!.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("原始需求");
    await frame!.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("點擊後新增輸入框，顯示 tooltip。");
    // Stub dialogs and clipboard writes; exercise the real host without replacing the user clipboard.
    const target = join(workspace, "handoff.svg");
    await app.evaluate(({ dialog, clipboard }, target) => {
      (globalThis as any).redpenDialogRequests = [];
      clipboard.writeText = (text: string) => { (globalThis as any).redpenPrompt = text; };
      dialog.showSaveDialog = async () => { (globalThis as any).redpenDialogRequests.push("save"); return { canceled: false, filePath: target }; };
      dialog.showOpenDialog = async () => { (globalThis as any).redpenDialogRequests.push("open"); return { canceled: true, filePaths: [] }; };
    }, target);
    await frame!.getByRole("button", { name: "Settings", exact: true }).click();
    await frame!.locator("#handoff-prompt").fill("請依三層修改：{svgPath}");
    await frame!.getByRole("button", { name: "Save", exact: true }).click();
    await expect(frame!.getByRole("status")).toHaveText("redpen: Settings saved.");
    await frame!.getByRole("button", { name: "Close settings", exact: true }).click();
    await frame!.getByRole("button", { name: "Export for Agent", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("Exported one SVG");
    await expect(window.getByText("redpen: SVG saved. Copy the handoff prompt and paste it into your agent chat.", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Copy handoff prompt", exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).redpenPrompt)).toBe(`請依三層修改：${target}`);
    const svg = await readFile(target, "utf8");
    expect(svg).toContain("tooltip"); expect(svg).toContain('id="original"');
    const restored = readRedpenSvg(svg);
    expect(restored.project.items[0].comment).toContain("tooltip");
    expect(Buffer.from(restored.source.split(",")[1], "base64")).toEqual(screenshot());
    expect((await readdir(workspace)).sort()).toEqual(["handoff.svg", "legacy.uifeedback.json", "screen.png"]);
    await frame!.getByRole("button", { name: "Settings", exact: true }).click();
    await frame!.getByRole("button", { name: "Copy handoff prompt", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("Handoff prompt and SVG path copied");
    expect(await app.evaluate(() => (globalThis as any).redpenPrompt)).toBe(`請依三層修改：${target}`);
    await frame!.getByRole("button", { name: "Close settings", exact: true }).click();

    // The new entry point must reach a blank canvas without an import or save dialog.
    await window.keyboard.press("F1");
    await quickInput.fill(">redpen: Open Canvas"); await window.keyboard.press("Enter");
    await expect.poll(async () => {
      for (const candidate of window.frames()) {
        // VS Code disposes the previous editor frame while opening the new canvas.
        try {
          if (await candidate.getByText("Paste your screenshot", { exact: true }).isVisible()) { frame = candidate; return true; }
        } catch (error) { if (!candidate.isDetached()) throw error; }
      }
      return false;
    }).toBeTruthy();
    expect(await app.evaluate(() => (globalThis as any).redpenDialogRequests)).toEqual(["save"]);
    await expect(window.locator(".tab").filter({ hasText: "redpen Canvas 2" }).first()).toBeVisible();
    await frame!.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
      document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, screenshot().toString("base64"));
    await expect(frame!.locator("#filename")).toContainText("800 × 600 · Autosaved");
    expect(await app.evaluate(() => (globalThis as any).redpenDialogRequests)).toEqual(["save"]);
    await frame!.getByRole("button", { name: "Show requests", exact: true }).click();
    await frame!.getByRole("button", { name: "Fit to view", exact: true }).click();
    const bounds = (await frame!.locator("#canvas").boundingBox())!;
    const scale = Math.max(.02, Math.min(1, (bounds.width - 64) / 800, (bounds.height - 96) / 600));
    const origin = { x: bounds.x + (bounds.width - 800 * scale) / 2, y: bounds.y + (bounds.height - 600 * scale) / 2 };
    await frame!.locator("#components").click();
    await frame!.getByRole("searchbox").fill("Tooltip");
    await frame!.locator(".library-card").click();
    await window.mouse.move(origin.x + 100 * scale, origin.y + 100 * scale); await window.mouse.down();
    await window.mouse.move(origin.x + 300 * scale, origin.y + 250 * scale, { steps: 6 }); await window.mouse.up();
    await frame!.locator("#comment").fill("直接貼圖後新增 tooltip。");
    await frame!.getByRole("button", { name: "Select", exact: true }).click();
    await frame!.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("");
    await frame!.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("直接貼圖後新增 tooltip。");
    await frame!.getByRole("button", { name: "Text", exact: true }).click();
    await window.mouse.click(origin.x - 20 * scale, origin.y + 300 * scale);
    await frame!.locator("#display-text").fill("截圖外說明");
    await window.keyboard.press(process.platform === "darwin" ? "Meta+=" : "Control+=");
    await expect(frame!.locator("#font-size")).toHaveValue("24");
    await frame!.getByRole("button", { name: "New image", exact: true }).click();
    await frame!.locator("#image-file").setInputFiles({ name: "part.png", mimeType: "image/png", buffer: screenshot(120, 80) });
    await expect(frame!.locator("#count")).toHaveText("3");
    await expect(frame!.locator("#image-actions")).toBeVisible();
    await frame!.getByRole("button", { name: "Rotate 90°", exact: true }).click();
    await frame!.getByRole("button", { name: "Flip horizontal", exact: true }).click();
    await window.mouse.dblclick(origin.x + 100 * scale, origin.y + 500 * scale);
    await expect(frame!.locator("#background-hint")).toBeVisible();
    await frame!.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "replacement.png", { type: "image/png" }));
      document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, screenshot(640, 480).toString("base64"));
    await expect(frame!.locator("#filename")).toContainText("640 × 480");
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined }); });
    await frame!.getByRole("button", { name: "Export for Agent", exact: true }).click();
    await expect(frame!.getByRole("button", { name: "Export for Agent", exact: true })).toBeEnabled();
    expect((await readdir(workspace)).filter(name => name.endsWith(".svg"))).toHaveLength(1);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error("Test save unavailable"); }; });
    await frame!.getByRole("button", { name: "Export for Agent", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("redpen:");
    await expect(window.locator(".notifications-toasts")).toContainText("Test save unavailable");
    await expect(frame!.getByRole("button", { name: "Export for Agent", exact: true })).toBeEnabled();
    const pastedTarget = join(workspace, "pasted.svg");
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, pastedTarget);
    await frame!.getByRole("button", { name: "Export for Agent", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("Exported one SVG");
    const handoff = await readFile(pastedTarget, "utf8");
    expect(handoff).toContain("Component note · Tooltip"); expect(handoff).toContain("Font size: 24 px");
    const imported = readRedpenSvg(handoff);
    expect(imported.project.items.some(item => item.x < 0)).toBe(true);
    expect(imported.project.items[2]).toMatchObject({ kind: "image", width: 80, height: 120, rotation: 90, flipX: true });
    expect(Buffer.from(imported.images![imported.project.items[2].asset!].data.split(",")[1], "base64")).toEqual(screenshot(120, 80));
    expect(Buffer.from(imported.source.split(",")[1], "base64")).toEqual(screenshot(640, 480));
    await frame!.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(frame!.locator("#handoff-prompt")).toHaveValue("請依三層修改：{svgPath}");
    await frame!.getByRole("button", { name: "Close settings", exact: true }).click();
    // Reimport the single SVG through the production file picker and recover editable items.
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, pastedTarget);
    await frame!.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(async () => {
      for (const candidate of window.frames()) {
        try {
          if (candidate !== frame && await candidate.locator("#count").textContent({ timeout: 200 }).catch(() => "") === "3") { frame = candidate; return true; }
        } catch (error) { if (!candidate.isDetached()) throw error; }
      }
      return false;
    }).toBeTruthy();
    await frame!.getByRole("button", { name: "Show requests", exact: true }).click();
    await frame!.locator(".item-card").first().click();
    await expect(frame!.locator("#selection-title")).toContainText("Component note · Tooltip");
    await expect(frame!.locator("#comment")).toHaveValue("直接貼圖後新增 tooltip。");
    await window.screenshot({ path: "test-results-native/vscode-preview.png" });
    await frame!.getByRole("button", { name: "Collapse drawing tools", exact: true }).click();
    await window.mouse.move(700, 700);
    await expect(frame!.locator(".toolbar-left button:visible")).toHaveCount(1);
    await window.keyboard.press("F1");
    await quickInput.fill(">redpen: Open Canvas"); await window.keyboard.press("Enter");
    await expect.poll(async () => {
      for (const candidate of window.frames()) {
        try {
          if (await candidate.getByText("Paste your screenshot", { exact: true }).isVisible()) { frame = candidate; return true; }
        } catch (error) { if (!candidate.isDetached()) throw error; }
      }
      return false;
    }).toBeTruthy();
    await expect(frame!.locator("#drawing-tools")).toHaveClass(/is-collapsed/);
    await expect(window.locator(".tab").filter({ hasText: "redpen Canvas 4" }).first()).toBeVisible();
  } catch (error) {
    const window = await app.firstWindow();
    await window.screenshot({ path: "test-results-native/vscode-failure.png" });
    console.log("VS Code frames:", window.frames().map(frame => frame.url()));
    console.log((await window.locator("body").innerText()).slice(0, 6000));
    const logs = join(temporary, "profile", "logs");
    for (const name of await readdir(logs, { recursive: true })) {
      if (name.endsWith("exthost.log") || name.endsWith("window.log")) console.log(name, (await readFile(join(logs, name), "utf8")).slice(-7000));
    }
    throw error;
  } finally { await app.close(); await rm(temporary, { recursive: true, force: true }); }
});

test("open canvas reconnects after extension host restart without reopening a draft manually", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "redpen-restart-"));
  const workspace = join(temporary, "workspace"); await mkdir(workspace);
  const file = join(workspace, "restore.redpen.json");
  await writeFile(join(workspace, "screen.png"), screenshot());
  await writeFile(file, JSON.stringify({ version: 1, image: "screen.png", items: [{ id: "restore-note", kind: "note", x: 100, y: 100, width: 220, height: 120, color: "#f35e5e", text: "", comment: "更新前的需求" }] }));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
  const app = await electron.launch({ executablePath: process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code", args: ["--no-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${join(temporary, "profile")}`, `--extensions-dir=${join(temporary, "extensions")}`, `--extensionDevelopmentPath=${resolve(".")}`, workspace, file], env, timeout: 30_000 });
  try {
    const window = await app.firstWindow();
    const command = async (name: string) => { await window.keyboard.press("F1"); await window.locator(".quick-input-widget input").fill(`>${name}`); await window.keyboard.press("Enter"); };
    const findFrame = async () => {
      for (const frame of window.frames()) { try { if (await frame.locator("#filename").count()) return frame; } catch {} }
    };
    await window.locator(".monaco-editor").first().click();
    await command("View: Reopen Editor With...");
    await window.getByText("redpen Canvas", { exact: true }).first().click();
    await expect.poll(async () => Boolean(await findFrame()), { timeout: 25_000 }).toBe(true);
    let frame = (await findFrame())!;
    await expect(frame.locator("#filename")).toContainText("800 × 600");
    await command("Developer: Restart Extension Host");
    // Re-render the webview after host restart, just as switching back to an open tab does.
    await command("File: New Untitled Text File");
    await window.locator(".tab").filter({ hasText: "redpen Canvas" }).first().click();
    await expect(async () => {
      frame = (await findFrame())!; expect(frame).toBeTruthy();
      await expect(frame.locator("#filename")).toContainText("800 × 600");
    }).toPass({ timeout: 20_000 });
    await frame.locator("#toggle-sidebar").click(); await frame.locator(".item-card").first().click();
    await expect(frame.locator("#comment")).toHaveValue("更新前的需求");
    await frame.locator("#comment").fill("重啟後仍可繼續編輯"); await frame.locator("#comment").press("Enter");
    await frame.locator("#canvas").focus(); await window.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect(async () => { expect(JSON.parse(await readFile(file, "utf8")).items[0].comment).toBe("重啟後仍可繼續編輯"); }).toPass({ timeout: 5000 });
  } catch (error) {
    const window = await app.firstWindow(); await window.screenshot({ path: "test-results-native/restart-failure.png" });
    throw error;
  } finally { await app.close(); await rm(temporary, { recursive: true, force: true }); }
});


test("Recent lists drafts across workspace caches and previews without changing saved times", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "redpen-recent-"));
  const workspace = join(temporary, "workspace"); await mkdir(workspace);
  const profile = join(temporary, "profile");
  const global = join(profile, "User", "globalStorage", "yunn030123.redpen-ui-markup", "canvases");
  const legacy = join(profile, "User", "workspaceStorage", "old-workspace", "yunn030123.redpen-ui-markup", "canvases");
  for (const [directory, name] of [[global, "canvas-global.redpen.json"], [legacy, "canvas-legacy.redpen.json"]]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "screen.png"), screenshot());
    await writeFile(join(directory, name), JSON.stringify({ version: 1, image: "screen.png", items: [] }));
  }
  await utimes(join(global, "canvas-global.redpen.json"), new Date(1000), new Date(1000));
  const legacySavedTime = (await stat(join(legacy, "canvas-legacy.redpen.json"))).mtimeMs;
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE"));
  const app = await electron.launch({ executablePath: process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code", args: ["--no-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, "extensions")}`, `--extensionDevelopmentPath=${resolve(".")}`, workspace], env, timeout: 30_000 });
  try {
    const window = await app.firstWindow();
    await window.locator(".monaco-workbench").waitFor();
    await window.keyboard.press("F1"); await window.locator(".quick-input-widget input").fill(">redpen: Open Recent Canvas"); await window.keyboard.press("Enter");
    const rows = window.locator(".quick-input-list .monaco-list-row:visible");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("canvas-legacy.redpen.json");
    await expect(rows.nth(1)).toContainText("canvas-global.redpen.json");
    await rows.first().hover();
    await rows.first().locator(".codicon-open-preview").click();
    await expect(window.locator(".tab").filter({ hasText: "screen.png" })).toBeVisible();
    await expect.poll(async () => {
      for (const frame of window.frames()) {
        try { if (await frame.evaluate(() => [...document.images].some(image => image.naturalWidth === 800 && image.naturalHeight === 600))) return true; } catch {}
      }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    await expect(rows).toHaveCount(2);
    expect((await stat(join(legacy, "canvas-legacy.redpen.json"))).mtimeMs).toBe(legacySavedTime);
    await window.screenshot({ path: "test-results-native/recent-canvases-preview.png" });
    await window.keyboard.press("Enter");
    let frame = window.frames()[0];
    await expect.poll(async () => {
      for (const candidate of window.frames()) { try { if (await candidate.locator("#filename").count()) { frame = candidate; return true; } } catch {} }
      return false;
    }, { timeout: 20_000 }).toBe(true);
    await expect(frame.locator("#filename")).toContainText("800 × 600 · Autosaved");
    expect(JSON.parse(await readFile(join(legacy, "canvas-legacy.redpen.json"), "utf8")).image).toBe("screen.png");
    await frame.locator("#toggle-sidebar").click(); await frame.locator("#add-comment").click();
    await frame.locator("#comment").fill("從另一個工作區繼續編輯"); await frame.locator("#comment").press("Enter");
    await expect(async () => { expect(JSON.parse(await readFile(join(legacy, "canvas-legacy.redpen.json"), "utf8")).items[0].comment).toBe("從另一個工作區繼續編輯"); }).toPass({ timeout: 5000 });
  } catch (error) {
    const window = await app.firstWindow(); await window.screenshot({ path: "test-results-native/recent-failure.png" });
    throw error;
  }
  finally { await app.close(); await rm(temporary, { recursive: true, force: true }); }
});
