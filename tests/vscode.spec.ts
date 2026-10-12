/** Test a real VS Code webview, document save/undo, and exported files with a disposable profile. */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
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
    await window.getByText("redpen", { exact: true }).first().click({ timeout: 10_000 });
    let frame = window.frames()[0];
    // The inner frame containing the bundled app can be identified independently of VS Code's wrapper URL.
    await expect.poll(async () => {
      for (const candidate of window.frames()) if (await candidate.locator("#filename").count()) { frame = candidate; return true; }
      return false;
    }, { timeout: 30_000 }).toBeTruthy();
    await expect(frame!.locator("#filename")).toContainText("800 × 600");
    await frame!.locator(".item-card").click();
    await frame!.locator("#comment").fill("");
    await frame!.locator("#comment").pressSequentially("點擊後新增輸入框，顯示 tooltip。", { delay: 20 });
    await expect(frame!.locator("#comment")).toHaveValue("點擊後新增輸入框，顯示 tooltip。");
    await frame!.getByRole("button", { name: "選取", exact: true }).click();
    await frame!.locator("#canvas").focus();
    await window.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect.poll(async () => JSON.parse(await readFile(file, "utf8")).items[0].comment).toContain("tooltip");
    await frame!.getByRole("button", { name: "復原", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("原始需求");
    await frame!.getByRole("button", { name: "重做", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("點擊後新增輸入框，顯示 tooltip。");
    // Stub dialogs and clipboard writes; exercise the real host without replacing the user clipboard.
    const target = join(workspace, "handoff.svg");
    await app.evaluate(({ dialog, clipboard }, target) => {
      (globalThis as any).redpenDialogRequests = [];
      clipboard.writeText = (text: string) => { (globalThis as any).redpenPrompt = text; };
      dialog.showSaveDialog = async () => { (globalThis as any).redpenDialogRequests.push("save"); return { canceled: false, filePath: target }; };
      dialog.showOpenDialog = async () => { (globalThis as any).redpenDialogRequests.push("open"); return { canceled: true, filePaths: [] }; };
    }, target);
    await frame!.getByRole("button", { name: "設定", exact: true }).click();
    await frame!.locator("#handoff-prompt").fill("請依三層修改：{svgPath}");
    await frame!.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(frame!.getByRole("status")).toHaveText("設定已儲存。");
    await frame!.getByRole("button", { name: "關閉設定", exact: true }).click();
    await frame!.getByRole("button", { name: "匯出給 Agent", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("已匯出單一 SVG");
    const svg = await readFile(target, "utf8");
    expect(svg).toContain("tooltip"); expect(svg).toContain('id="original"');
    const restored = readRedpenSvg(svg);
    expect(restored.project.items[0].comment).toContain("tooltip");
    expect(Buffer.from(restored.source.split(",")[1], "base64")).toEqual(screenshot());
    expect((await readdir(workspace)).sort()).toEqual(["handoff.svg", "legacy.uifeedback.json", "screen.png"]);
    await frame!.getByRole("button", { name: "設定", exact: true }).click();
    await frame!.getByRole("button", { name: "複製交接 prompt", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("已複製交接 prompt");
    expect(await app.evaluate(() => (globalThis as any).redpenPrompt)).toBe(`請依三層修改：${target}`);
    await frame!.getByRole("button", { name: "關閉設定", exact: true }).click();

    // The new entry point must reach a blank canvas without an import or save dialog.
    await window.keyboard.press("F1");
    await quickInput.fill(">redpen: Open Canvas"); await window.keyboard.press("Enter");
    await expect.poll(async () => {
      for (const candidate of window.frames()) {
        // VS Code disposes the previous editor frame while opening the new canvas.
        try {
          if (await candidate.getByText("直接貼上你的截圖", { exact: true }).isVisible()) { frame = candidate; return true; }
        } catch (error) { if (!candidate.isDetached()) throw error; }
      }
      return false;
    }).toBeTruthy();
    expect(await app.evaluate(() => (globalThis as any).redpenDialogRequests)).toEqual(["save"]);
    await expect(window.locator(".tab").filter({ hasText: /canvas-.*\.redpen\.json/ }).first()).toBeVisible();
    await frame!.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
      document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, screenshot().toString("base64"));
    await expect(frame!.locator("#filename")).toContainText("800 × 600 · 自動暫存");
    expect(await app.evaluate(() => (globalThis as any).redpenDialogRequests)).toEqual(["save"]);
    const bounds = (await frame!.locator("#canvas").boundingBox())!;
    const scale = Math.max(.02, Math.min(1, (bounds.width - 64) / 800, (bounds.height - 96) / 600));
    const origin = { x: bounds.x + (bounds.width - 800 * scale) / 2, y: bounds.y + (bounds.height - 600 * scale) / 2 };
    await frame!.getByRole("button", { name: "UI 元件", exact: true }).click();
    await frame!.getByRole("searchbox").fill("Tooltip");
    await frame!.locator(".library-card").click();
    await window.mouse.move(origin.x + 100 * scale, origin.y + 100 * scale); await window.mouse.down();
    await window.mouse.move(origin.x + 300 * scale, origin.y + 250 * scale, { steps: 6 }); await window.mouse.up();
    await frame!.locator("#comment").fill("直接貼圖後新增 tooltip。");
    await frame!.getByRole("button", { name: "選取", exact: true }).click();
    await frame!.getByRole("button", { name: "復原", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("");
    await frame!.getByRole("button", { name: "重做", exact: true }).click();
    await expect(frame!.locator("#comment")).toHaveValue("直接貼圖後新增 tooltip。");
    await frame!.getByRole("button", { name: "文字", exact: true }).click();
    await window.mouse.click(origin.x - 20 * scale, origin.y + 300 * scale);
    await frame!.locator("#display-text").fill("截圖外說明");
    await window.keyboard.press(process.platform === "darwin" ? "Meta+=" : "Control+=");
    await expect(frame!.locator("#font-size")).toHaveValue("24");
    await frame!.getByRole("button", { name: "新圖片", exact: true }).click();
    await frame!.locator("#image-file").setInputFiles({ name: "part.png", mimeType: "image/png", buffer: screenshot(120, 80) });
    await expect(frame!.locator("#count")).toHaveText("3");
    await expect(frame!.locator("#image-actions")).toBeVisible();
    await frame!.getByRole("button", { name: "旋轉 90°", exact: true }).click();
    await frame!.getByRole("button", { name: "水平鏡像", exact: true }).click();
    await window.mouse.dblclick(origin.x + 100 * scale, origin.y + 500 * scale);
    await expect(frame!.locator("#background-hint")).toBeVisible();
    await frame!.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "replacement.png", { type: "image/png" }));
      document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    }, screenshot(640, 480).toString("base64"));
    await expect(frame!.locator("#filename")).toContainText("640 × 480");
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined }); });
    await frame!.getByRole("button", { name: "匯出給 Agent", exact: true }).click();
    await expect(frame!.getByRole("button", { name: "匯出給 Agent", exact: true })).toBeEnabled();
    expect((await readdir(workspace)).filter(name => name.endsWith(".svg"))).toHaveLength(1);
    const pastedTarget = join(workspace, "pasted.svg");
    await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, pastedTarget);
    await frame!.getByRole("button", { name: "匯出給 Agent", exact: true }).click();
    await expect(frame!.getByRole("status")).toContainText("已匯出單一 SVG");
    const handoff = await readFile(pastedTarget, "utf8");
    expect(handoff).toContain("元件註解 · Tooltip"); expect(handoff).toContain("字級：24 px");
    const imported = readRedpenSvg(handoff);
    expect(imported.project.items.some(item => item.x < 0)).toBe(true);
    expect(imported.project.items[2]).toMatchObject({ kind: "image", width: 80, height: 120, rotation: 90, flipX: true });
    expect(Buffer.from(imported.images![imported.project.items[2].asset!].data.split(",")[1], "base64")).toEqual(screenshot(120, 80));
    expect(Buffer.from(imported.source.split(",")[1], "base64")).toEqual(screenshot(640, 480));
    await frame!.getByRole("button", { name: "設定", exact: true }).click();
    await expect(frame!.locator("#handoff-prompt")).toHaveValue("請依三層修改：{svgPath}");
    await frame!.getByRole("button", { name: "關閉設定", exact: true }).click();
    // Reimport the single SVG through the production file picker and recover editable items.
    await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, pastedTarget);
    await frame!.getByRole("button", { name: "匯入截圖", exact: true }).click();
    await expect.poll(async () => {
      for (const candidate of window.frames()) {
        try {
          if (candidate !== frame && await candidate.locator("#count").textContent({ timeout: 200 }).catch(() => "") === "3") { frame = candidate; return true; }
        } catch (error) { if (!candidate.isDetached()) throw error; }
      }
      return false;
    }).toBeTruthy();
    await frame!.locator(".item-card").first().click();
    await expect(frame!.locator("#selection-title")).toContainText("元件註解 · Tooltip");
    await expect(frame!.locator("#comment")).toHaveValue("直接貼圖後新增 tooltip。");
    await window.screenshot({ path: "test-results-native/vscode-preview.png" });
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
