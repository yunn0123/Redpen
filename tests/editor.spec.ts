/** Verify real pointer gestures and exported pixels rather than mirroring canvas implementation. */
import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/** Map source fixture coordinates into the initially fitted canvas. */
async function position(page: Page, x: number, y: number, zoom = 1): Promise<{ x: number; y: number }> {
  const bounds = (await page.locator("#canvas").boundingBox())!;
  const scale = Math.max(.02, Math.min(1, (bounds.width - 64) / 1200, (bounds.height - 96) / 800)) * zoom;
  return { x: bounds.x + (bounds.width - 1200 * scale) / 2 + x * scale, y: bounds.y + (bounds.height - 800 * scale) / 2 + y * scale };
}

/** Complete a drag as a user would, including intermediate mouse movement. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
}

/** Paste a two-color raster so transform and source preservation can be checked in exported pixels. */
async function pasteRaster(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, width / 2, height);
    ctx.fillStyle = "#0000ff"; ctx.fillRect(width / 2, 0, width / 2, height);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], "test.png", { type: "image/png" }));
    document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, { width, height });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?fixture"); await expect(page.locator("#filename")).toContainText("1200 × 800");
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.getByRole("button", { name: "Fit to view", exact: true }).click();
});

/** Each completed creation selects its object; explicitly choosing a tool starts another. */
test("newly created objects are selected and preserve edited requests", async ({ page }) => {
  for (const kind of ["note", "cover", "crop", "arrow", "outline", "text", "stamp"]) {
    const button = page.locator(`[data-tool="${kind}"]`);
    for (let index = 0; index < 2; index++) {
      await button.click();
      const start = await position(page, 280 + index * 240, 300);
      if (kind === "text" || kind === "stamp") await page.mouse.click(start.x, start.y);
      else await drag(page, start, await position(page, 410 + index * 240, 380));
      await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
      await page.locator("#comment").fill(`${kind} ${index}`);
    }
  }
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const items = await page.evaluate(() => window.redpenTest.project.items);
  expect(items).toHaveLength(14);
  for (const item of items) expect(item.comment).toMatch(new RegExp(`^${item.kind} [01]$`));
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
});

test("notes, masks, crop movement, history and original-size export survive viewport changes", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await expect(page.locator("#count")).toHaveText("1");
  await page.locator("#comment").fill("hover 此區域顯示＋；點擊後直接新增可輸入的 todo。");
  await page.getByRole("button", { name: "Cover", exact: true }).click();
  await drag(page, await position(page, 450, 250), await position(page, 635, 325));
  await expect(page.locator("#count")).toHaveText("2");
  await expect(page.locator("#color")).toHaveValue("#ffffff");
  await page.getByRole("button", { name: "Copy region", exact: true }).click();
  await drag(page, await position(page, 280, 180), await position(page, 440, 234));
  await expect(page.locator("#count")).toHaveText("3");
  const source = await page.evaluate(() => window.redpenTest.project.items[2].source);
  // Browser pointer events round screen pixels; a fitted image can differ by up to two source pixels.
  expect(Math.abs(source!.x - 280)).toBeLessThan(2); expect(Math.abs(source!.width - 160)).toBeLessThan(2);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await drag(page, await position(page, 360, 220), await position(page, 560, 420));
  const moved = await page.evaluate(() => window.redpenTest.project.items[2]);
  expect(moved.x).toBeGreaterThan(450); expect(moved.source).toEqual(source);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[2].x)).toBeLessThan(400);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[2].x)).toBe(moved.x);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const output = await page.evaluate(() => window.redpenTest.exports[0]);
  expect(output.width).toBeGreaterThan(1200); expect(output.height).toBe(800); expect(output.markdown).toContain("hover 此區域顯示＋");
  expect(output.markdown).toContain("Copy source");
  const pixels = await page.evaluate(async png => {
    const image = new Image(); image.src = png; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, cover: Array.from(ctx.getImageData(500, 275, 1, 1).data), copy: Array.from(ctx.getImageData(550, 440, 1, 1).data) };
  }, output.png);
  expect(pixels).toEqual({ width: output.width, height: 800, cover: [255, 255, 255, 255], copy: [200, 233, 223, 255] });
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/editor-preview.png" });
});

test("empty notes block export; text, arrows and stamps remain editable and drafts reopen", async ({ page }) => {
  await drag(page, await position(page, 50, 110), await position(page, 180, 200));
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Fill in the region annotations");
  expect(await page.evaluate(() => window.redpenTest.exports.length)).toBe(0);
  await page.locator("#comment").fill("移除側欄的顏色標記。");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(...Object.values(await position(page, 680, 400)) as [number, number]);
  await page.locator("#display-text").fill("新增 tooltip");
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await drag(page, await position(page, 700, 350), await position(page, 460, 200));
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  const point = await position(page, 700, 250); await page.mouse.click(point.x, point.y);
  await page.locator("#stamp").selectOption("?");
  await expect(page.locator("#count")).toHaveText("4");
  await page.locator("#canvas").focus(); await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Delete object", exact: true }).click();
  await expect(page.locator("#count")).toHaveText("3");
  await page.reload(); await expect(page.locator("#count")).toHaveText("3");
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.locator(".item-card").nth(0).click();
  await expect(page.locator("#comment")).toHaveValue("移除側欄的顏色標記。");
  await page.locator(".item-card").nth(1).click();
  await expect(page.locator("#display-text")).toHaveValue("新增 tooltip");
  await page.locator(".item-card").nth(0).click();
  const items = await page.evaluate(() => window.redpenTest.project.items);
  expect(items[1].text).toBe("新增 tooltip"); expect(items[2].width).toBeLessThan(0);
  expect(items[0].comment).toBe("移除側欄的顏色標記。");
});

/** Exercise actual key events: filling a field alone misses canvas shortcut collisions. */
test("typing spaces and composing Chinese preserves text and the insertion point", async ({ page }) => {
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const point = await position(page, 400, 300); await page.mouse.click(point.x, point.y);
  for (const id of ["comment", "display-text"]) {
    const field = page.locator(`#${id}`);
    await field.fill("");
    await field.pressSequentially("add a tooltip", { delay: 20 });
    await expect(field).toHaveValue("add a tooltip");
    await field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await field.pressSequentially("new ", { delay: 20 });
    await expect(field).toHaveValue("add a new tooltip");
    expect(await field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => element.selectionStart)).toBe(10);
    // Synthetic composition covers the event boundary without depending on an installed OS input method.
    await field.dispatchEvent("compositionstart", { data: "" });
    await page.keyboard.insertText("提示");
    await field.dispatchEvent("keydown", { key: " ", code: "Space", isComposing: true });
    await field.dispatchEvent("keyup", { key: " ", code: "Space", isComposing: true });
    await expect(field).toHaveValue("add a new 提示tooltip");
    await field.dispatchEvent("compositionend", { data: "提示" });
    await field.press("Tab");
  }
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const item = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(item.comment).toBe("add a new 提示tooltip");
  expect(item.text).toBe("add a new 提示tooltip");
});

/** Endpoint edits must survive zoom, direction reversal, history, export and keyboard deletion. */
test("arrow endpoints change direction and length, with undo and Delete after selection", async ({ page }) => {
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await drag(page, await position(page, 300, 300), await position(page, 600, 300));
  const original = await page.evaluate(() => window.redpenTest.project.items[0]);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await drag(page, await position(page, original.x + original.width, original.y + original.height, 1.2), await position(page, 200, 450, 1.2));
  const reversed = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(reversed.width).toBeLessThan(-90); expect(reversed.height).toBeGreaterThan(140);
  expect(reversed.x).toBe(original.x); expect(reversed.y).toBe(original.y);
  await drag(page, await position(page, reversed.x, reversed.y, 1.2), await position(page, 450, 200, 1.2));
  const edited = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(Math.abs(edited.x - 450)).toBeLessThan(3);
  expect(Math.abs(edited.y - 200)).toBeLessThan(3);
  expect(edited.x + edited.width).toBe(reversed.x + reversed.width);
  expect(edited.y + edited.height).toBe(reversed.y + reversed.height);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0])).toEqual(reversed);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0])).toEqual(edited);
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  expect(await page.evaluate(() => window.redpenTest.exports[0].markdown)).toContain(`Arrow endpoint: x=${Math.round(edited.x + edited.width)}, y=${Math.round(edited.y + edited.height)}`);
  // Click the arrow after editing a field; Delete must act on the canvas without an explicit focus call.
  await page.locator("#comment").fill("調整指向");
  const middle = await position(page, edited.x + edited.width / 2, edited.y + edited.height / 2, 1.2);
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.press("Delete");
  await expect(page.locator("#count")).toHaveText("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#count")).toHaveText("1");
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].comment)).toBe("調整指向");
});

test("zoomed selections use source pixels and space-drag pans without moving the object", async ({ page }) => {
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await drag(page, await position(page, 300, 200, 1.2), await position(page, 500, 350, 1.2));
  await page.locator("#comment").fill("放大後的註解");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const original = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(Math.abs(original.x - 300)).toBeLessThan(2); expect(Math.abs(original.width - 200)).toBeLessThan(2);
  await page.locator("#canvas").focus();
  await page.keyboard.down("Space");
  const start = await position(page, 400, 280, 1.2);
  await drag(page, start, { x: start.x + 50, y: start.y + 40 });
  await page.keyboard.up("Space");
  expect(await page.evaluate(() => window.redpenTest.project.items[0])).toEqual(original);
});

test("a blank canvas accepts a pasted image without a save step and rejects invalid images without losing it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Paste your screenshot", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export for Agent", exact: true })).toBeDisabled();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#66aa88"; ctx.fillRect(0, 0, 600, 400);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], "pasted.png", { type: "image/png" }));
    document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("#filename")).toContainText("600 × 400");
  await expect(page.getByRole("button", { name: "Export for Agent", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const clipboard = new DataTransfer(); clipboard.items.add(new File(["not an image"], "broken.png", { type: "image/png" }));
    document.getElementById("canvas")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("status")).toContainText("Paste failed");
  await expect(page.locator("#filename")).toContainText("600 × 400");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Paste your screenshot", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("#filename")).toContainText("600 × 400");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  await page.screenshot({ path: "test-results/pasted-canvas.png" });
});

/** Verify library choices survive document reload and remain explicit in the agent handoff. */
test("searchable UI and icon libraries create editable annotations and focus existing comments", async ({ page }) => {
  await expect(page.locator(".header")).toHaveCount(0);
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Export for Agent", exact: true })).toBeVisible();
  await page.locator("#components").click();
  await page.getByRole("searchbox").fill("tooltip");
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.locator(".library-card").click();
  await drag(page, await position(page, 250, 150), await position(page, 460, 250));
  await expect(page.locator("#comment")).toBeFocused();
  await page.locator("#comment").fill("hover 時顯示欄位說明");
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  const point = await position(page, 500, 300); await page.mouse.click(point.x, point.y);
  await expect(page.locator("#stamp")).toHaveValue("placeholder");
  await page.locator("#stamp").selectOption("icon:shopping-cart");
  await page.locator(".item-card").first().click();
  await expect(page.locator("#comment")).toBeFocused();
  await expect(page.locator("#comment")).toHaveValue("hover 時顯示欄位說明");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  expect(await page.evaluate(() => window.redpenTest.exports[0].markdown)).toContain("UI component: Tooltip");
  expect(await page.evaluate(() => window.redpenTest.exports[0].svg)).toContain("icon:shopping-cart");
  await page.reload();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await expect(page.locator("#count")).toHaveText("2");
  await page.locator(".item-card").last().click();
  await expect(page.locator("#stamp")).toHaveValue("icon:shopping-cart");
  await page.locator("#components").click();
  await page.screenshot({ path: "test-results/component-library.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

/** Inspect PNG alpha and shifted coordinates, not just the editor's optimistic document state. */
test("outside text exports on transparent expanded bounds and font shortcuts persist", async ({ page }) => {
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const point = await position(page, -130, -70, 1 / 1.2 ** 2); await page.mouse.click(point.x, point.y);
  await page.locator("#display-text").fill("新增說明");
  await page.keyboard.press("Meta+=");
  await expect(page.locator("#font-size")).toHaveValue("24");
  await page.keyboard.press("Meta+-");
  await expect(page.locator("#font-size")).toHaveValue("22");
  await page.keyboard.press("Control+=");
  await expect(page.locator("#font-size")).toHaveValue("24");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const output = await page.evaluate(() => window.redpenTest.exports[0]);
  expect(output.width).toBeGreaterThan(1300); expect(output.height).toBeGreaterThan(850);
  expect(output.markdown).toContain("Font size: 24 px");
  expect(output.markdown).toContain("The shared canvas origin starts in modified.png at x=");
  const pixels = await page.evaluate(async svg => {
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    document.getElementById("annotations")!.setAttribute("display", "none");
    const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`; await image.decode();
    const canvas = window.document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    // Bottom-left lies outside the screenshot and text; centered glyphs leave padding on all four sides.
    const text = ctx.getImageData(0, 0, 220, 70).data;
    let minX = 220, maxX = 0, minY = 70, maxY = 0;
    for (let y = 0; y < 69; y++) for (let x = 0; x < 219; x++) if (text[(y * 220 + x) * 4 + 3]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { alpha: ctx.getImageData(0, image.height - 1, 1, 1).data[3], minX, maxX, minY, maxY };
  }, output.svg);
  expect(pixels.alpha).toBe(0);
  expect(pixels.minX).toBeGreaterThan(40); expect(pixels.maxX).toBeLessThan(180);
  expect(pixels.minY).toBeGreaterThan(10); expect(pixels.maxY).toBeLessThan(60);
  await page.reload();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.locator(".item-card").click();
  await expect(page.locator("#font-size")).toHaveValue("24");
  await page.screenshot({ path: "test-results/outside-text.png" });
});

/** Exercise the revised lightweight tools and inspect the resulting editable SVG structure. */
test("settings, outline and icon sketch export as three layers with readable comments", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).hover();
  expect(await page.locator("#settings-open").evaluate(button => getComputedStyle(button, "::after").display)).toBe("block");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#handoff-prompt").fill("請閱讀 {svgPath} 的三層資訊");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("redpen: Settings saved.");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#handoff-prompt")).toHaveValue("請閱讀 {svgPath} 的三層資訊");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await drag(page, await position(page, 260, 165), await position(page, 450, 240));
  await expect(page.locator("#comment")).toHaveValue("");
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  const point = await position(page, 700, 400); await page.mouse.click(point.x, point.y);
  await expect(page.locator("#stamp")).toHaveValue("placeholder");
  await page.locator("#comment").fill("這裡需要搜尋 icon <保留原文> & 支援點擊");
  const pad = (await page.locator("#sketch").boundingBox())!;
  await drag(page, { x: pad.x + 30, y: pad.y + 30 }, { x: pad.x + 110, y: pad.y + 90 });
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[1].strokes?.length)).toBe(1);
  expect(await page.locator("#sketch").evaluate((surface: HTMLCanvasElement) => surface.getContext("2d")!.getImageData(100, 140, 1, 1).data[3])).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[1].strokes?.length ?? 0)).toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[1].strokes?.length)).toBe(1);
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const svg = await page.evaluate(() => window.redpenTest.exports[0].svg);
  const structure = await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return {
      errors: doc.querySelectorAll("parsererror").length,
      layers: Array.from(doc.documentElement.children).filter(node => node.tagName === "g").map(node => node.id),
      vectors: doc.querySelectorAll("#modified polyline").length,
      notes: doc.getElementById("annotations")!.textContent,
      rectangle: doc.querySelector("#modified rect")!.getAttribute("fill"),
      rasterCount: doc.querySelectorAll("image").length,
    };
  }, svg);
  expect(structure.errors).toBe(0); expect(structure.layers).toEqual(["original", "modified", "annotations"]);
  expect(structure.vectors).toBe(1); expect(structure.rectangle).toBe("none"); expect(structure.rasterCount).toBe(1);
  expect(structure.notes).toContain("這裡需要搜尋 icon <保留原文> & 支援點擊");
  await writeFile("test-results/layered-example.svg", svg);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Copy handoff prompt", exact: true }).click();
  expect(await page.evaluate(() => window.redpenTest.copiedPrompt)).toBe("請閱讀 /demo/redpen.svg 的三層資訊");
  await page.screenshot({ path: "test-results/settings-preview.png" });
});

test("marquee selection moves and deletes a group, command-click removes one member", async ({ page }) => {
  for (const x of [300, 550]) {
    await page.getByRole("button", { name: "Cover", exact: true }).click();
    await drag(page, await position(page, x, 200), await position(page, x + 100, 300));
  }
  const before = await page.evaluate(() => window.redpenTest.project.items);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await drag(page, await position(page, 250, 150), await position(page, 700, 350));
  await expect(page.locator("#selection-summary")).toContainText("2 objects selected");
  await drag(page, await position(page, 350, 250), await position(page, 430, 310));
  const moved = await page.evaluate(() => window.redpenTest.project.items);
  expect(moved[0].x - before[0].x).toBeGreaterThan(70);
  expect(Math.abs((moved[0].x - before[0].x) - (moved[1].x - before[1].x))).toBeLessThan(1);
  expect(Math.abs((moved[0].y - before[0].y) - (moved[1].y - before[1].y))).toBeLessThan(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.deliveredProject?.items)).toEqual(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.deliveredProject?.items)).toEqual(moved);
  await expect(page.locator("#selection-summary")).toContainText("2 objects selected");
  await page.keyboard.down("Meta");
  const first = await position(page, moved[0].x + 50, moved[0].y + 50); await page.mouse.click(first.x, first.y);
  await page.keyboard.up("Meta");
  await expect(page.locator("#selection-summary")).toBeHidden();
  await expect(page.locator("#inspector")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => window.redpenTest.project.items[0].id)).toBe(before[0].id);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await drag(page, await position(page, 250, 150), await position(page, 800, 450));
  await page.getByRole("button", { name: "Delete selected objects", exact: true }).click();
  await expect(page.locator("#count")).toHaveText("0");
});

test("sidebar collapses and unpositioned requirements appear only in SVG annotations", async ({ page }) => {
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  await expect(page.locator("#sidebar")).not.toBeVisible();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.getByRole("button", { name: "Add general request", exact: true }).click();
  await expect(page.locator("#comment")).toBeFocused();
  await page.locator("#comment").fill("所有欄位都需要鍵盤操作。");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const svg = await page.evaluate(() => window.redpenTest.exports[0].svg);
  const content = await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return { shapes: doc.getElementById("modified")!.children.length, text: doc.getElementById("annotations")!.textContent, targets: doc.querySelectorAll("[data-target]").length };
  }, svg);
  expect(content.shapes).toBe(0); expect(content.targets).toBe(0);
  expect(content.text).toContain("No specific location"); expect(content.text).toContain("所有欄位都需要鍵盤操作。");
});

test("image elements rotate and mirror; replacing the background preserves objects and old crops", async ({ page }) => {
  await page.getByRole("button", { name: "Copy region", exact: true }).click();
  await drag(page, await position(page, 280, 180), await position(page, 440, 234));
  await page.getByRole("button", { name: "New image", exact: true }).click();
  await pasteRaster(page, 120, 80);
  await expect(page.locator("#image-actions")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("2");
  await page.getByRole("button", { name: "Rotate 90°", exact: true }).click();
  await page.getByRole("button", { name: "Flip horizontal", exact: true }).click();
  const before = await page.evaluate(() => window.redpenTest.project.items);
  expect(before[1].width).toBe(80); expect(before[1].height).toBe(120); expect(before[1].rotation).toBe(90); expect(before[1].flipX).toBe(true);
  const background = await position(page, 100, 500); await page.mouse.dblclick(background.x, background.y);
  await expect(page.locator("#background-hint")).toBeVisible();
  const replacement = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace background", exact: true }).click();
  const bytes = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480; return canvas.toDataURL("image/png").split(",")[1]; });
  await (await replacement).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: Buffer.from(bytes, "base64") });
  await expect(page.locator("#filename")).toContainText("640 × 480");
  const after = await page.evaluate(() => window.redpenTest.project.items);
  expect(after[1]).toEqual(before[1]); expect(after[0].asset).toBe("sample.png");
  expect({ ...after[0], asset: undefined }).toEqual({ ...before[0], asset: undefined });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#filename")).toContainText("1200 × 800");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("#filename")).toContainText("640 × 480");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const pixels = await page.evaluate(async () => {
    const doc = new DOMParser().parseFromString(window.redpenTest.exports[0].svg, "image/svg+xml");
    doc.getElementById("annotations")!.setAttribute("display", "none");
    const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const item = window.redpenTest.project.items[1], crop = window.redpenTest.project.items[0];
    return { top: [...ctx.getImageData(item.x + 40, item.y + 20, 1, 1).data], bottom: [...ctx.getImageData(item.x + 40, item.y + 100, 1, 1).data], crop: [...ctx.getImageData(crop.x + 10, crop.y + 40, 1, 1).data] };
  });
  expect(pixels.top).toEqual([0, 0, 255, 255]); expect(pixels.bottom).toEqual([255, 0, 0, 255]); expect(pixels.crop).toEqual([200, 233, 223, 255]);
  await page.reload(); await expect(page.locator("#count")).toHaveText("2");
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.locator(".item-card").last().click(); await expect(page.locator("#image-actions")).toBeVisible();
});

/** Floating comments must keep text editable with the sidebar closed and follow the viewport. */
test("floating toolbars and comments preserve typing, undo, and export with requests collapsed", async ({ page }) => {
  await page.reload();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "Show requests", exact: true })).toBeVisible();
  const left = (await page.locator(".toolbar-left").boundingBox())!;
  const right = (await page.locator(".toolbar-right").boundingBox())!;
  expect(left.y).toBe(right.y); expect(left.x + left.width).toBeLessThan(right.x);
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  const field = page.locator("#popover-comment");
  await expect(field).toBeFocused();
  await expect(page.locator("#sidebar")).toBeHidden();
  await field.pressSequentially("add a tooltip", { delay: 15 });
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
  await field.pressSequentially("new ", { delay: 15 });
  await field.dispatchEvent("compositionstart", { data: "" });
  await page.keyboard.insertText("提示");
  await field.dispatchEvent("keydown", { key: " ", code: "Space", isComposing: true });
  await field.dispatchEvent("keyup", { key: " ", code: "Space", isComposing: true });
  await field.dispatchEvent("compositionend", { data: "提示" });
  await page.mouse.move(20, 400);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("add a new 提示tooltip");
  await field.press("Escape");
  await expect(page.locator("#comment-popover")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].comment)).toBe("add a new 提示tooltip");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].comment)).toBe("");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const marker = page.getByRole("button", { name: "Comment 1: Region note", exact: true });
  await marker.hover();
  await expect(field).toHaveValue("add a new 提示tooltip");
  await field.click();
  await field.fill("Change this button");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const svg = await page.evaluate(() => window.redpenTest.exports[0].svg);
  expect(svg).toContain("Change this button"); expect(svg).not.toContain("comment-popover");
  await page.getByRole("button", { name: "Close comment", exact: true }).click();
  const before = (await marker.boundingBox())!;
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => (await marker.boundingBox())!.x).not.toBe(before.x);
  await marker.hover();
  await page.screenshot({ path: "test-results/floating-comments.png" });
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#comment")).toHaveValue("Change this button");
  await page.locator("#comment").fill("Still typing in the sidebar");
  await page.locator("#comment").evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(5, 5));
  await marker.hover();
  await expect(page.locator("#comment-popover")).toBeHidden();
  expect(await page.locator("#comment").evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe(5);
  await page.setViewportSize({ width: 520, height: 700 });
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export for Agent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#settings")).toBeVisible();
});

/** Compact controls must preserve canvas space and never obstruct object dragging on hover. */
test("tools collapse persistently, Requests floats below actions, and only comment icons open previews", async ({ page }) => {
  const canvas = (await page.locator("#canvas").boundingBox())!;
  const actions = (await page.locator(".toolbar-right").boundingBox())!;
  const sidebar = (await page.locator("#sidebar").boundingBox())!;
  expect(sidebar.width).toBe(actions.width);
  expect(sidebar.x).toBe(actions.x);
  expect(sidebar.y).toBe(actions.y + actions.height);
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  expect((await page.locator("#canvas").boundingBox())!.width).toBe(canvas.width);
  const zoom = (await page.locator(".zoom-controls").boundingBox())!;
  expect(zoom.x).toBeLessThan(40); expect(zoom.height).toBeGreaterThan(zoom.width);
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await page.getByRole("button", { name: "Collapse drawing tools", exact: true }).click();
  await page.mouse.move(700, 700);
  await expect(page.locator(".toolbar-left button:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Arrow", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Arrow", exact: true }).hover();
  await expect(page.getByRole("button", { name: "Annotate", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Annotate", exact: true }).click();
  await page.mouse.move(700, 700);
  await expect(page.locator(".toolbar-left button:visible")).toHaveCount(1);
  await page.reload();
  await page.mouse.move(700, 700);
  await expect(page.locator(".toolbar-left button:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Annotate", exact: true }).hover();
  await page.getByRole("button", { name: "Keep drawing tools expanded", exact: true }).click();
  await page.mouse.move(700, 700);
  await expect(page.getByRole("button", { name: "Arrow", exact: true })).toBeVisible();
  await drag(page, await position(page, 270, 170), await position(page, 320, 210));
  await page.locator("#popover-comment").fill("Small movable item");
  await page.getByRole("button", { name: "Close comment", exact: true }).click();
  const point = await position(page, 290, 190);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("#comment-popover")).toBeHidden();
  const before = await page.evaluate(() => window.redpenTest.project.items[0].x);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await drag(page, point, { x: point.x + 40, y: point.y + 20 });
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].x)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Comment 1: Region note", exact: true }).hover();
  await expect(page.locator("#popover-comment")).toHaveValue("Small movable item");
  expect((await page.locator("#comment-popover").boundingBox())!.width).toBeLessThanOrEqual(240);
  await page.screenshot({ path: "test-results/compact-controls.png" });
});

/** New objects accept typing immediately and IME confirmation must not finish the request. */
test("new objects focus editing and Enter finishes without interrupting Chinese composition", async ({ page }) => {
  for (const kind of ["note", "cover", "crop", "arrow", "outline", "stamp", "text"]) {
    await page.locator(`[data-tool="${kind}"]`).click();
    const start = await position(page, 300, 300);
    if (kind === "text" || kind === "stamp") await page.mouse.click(start.x, start.y);
    else await drag(page, start, await position(page, 430, 380));
    const field = page.locator(kind === "text" ? "#display-text" : "#comment");
    await expect(field, kind).toBeFocused();
    await field.pressSequentially("note arrow text ");
    await field.dispatchEvent("compositionstart", { data: "" });
    await page.keyboard.insertText("中文");
    await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(field).toBeFocused();
    await field.dispatchEvent("keydown", { key: "Enter" });
    await expect(field).toBeFocused();
    await field.dispatchEvent("compositionend", { data: "中文" });
    await field.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
    await expect(field).toBeFocused();
    await field.press("Enter");
    await expect(page.locator("#canvas")).toBeFocused();
    await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
    const item = await page.evaluate(() => window.redpenTest.project.items.at(-1)!);
    expect(kind === "text" ? item.text : item.comment).toContain("note arrow text 中文");
  }
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  await page.locator('[data-tool="note"]').click();
  await drag(page, await position(page, 600, 450), await position(page, 750, 550));
  const popup = page.locator("#popover-comment");
  await expect(popup).toBeFocused();
  await popup.pressSequentially("first"); await popup.press("Shift+Enter");
  await popup.pressSequentially("second"); await popup.press("Enter");
  await expect(page.locator("#comment-popover")).toBeHidden();
  expect(await page.evaluate(() => window.redpenTest.project.items.at(-1)!.comment)).toBe("first\nsecond");
});


test("narrow editor splits keep tools and export reachable while requests remain editable", async ({ page }) => {
  for (const width of [360, 480, 800]) {
    await page.setViewportSize({ width, height: 700 });
    for (const button of await page.locator("#drawing-tools > button, .toolbar-right > button").all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThan(200);
    }
    await expect(page.locator("#export span")).toBeVisible();
  }
  await page.setViewportSize({ width: 360, height: 700 });
  await page.getByRole("button", { name: "Add general request", exact: true }).click();
  await expect(page.locator("#comment")).toBeFocused();
  await page.keyboard.insertText("縮小視窗仍可輸入需求");
  await page.keyboard.press("Enter");
  await expect(page.locator("#canvas")).toBeFocused();
  expect(await page.evaluate(() => window.redpenTest.project.items.at(-1)!.comment)).toBe("縮小視窗仍可輸入需求");
});


test("requests accept pasted and uploaded reference images, export them, and retain them after reload", async ({ page }) => {
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  const field = page.locator("#popover-comment");
  await field.fill("這裡排版可以參考該圖，保留原本功能");
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(10, 10));
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext("2d")!; context.fillStyle = "#1234ff"; context.fillRect(0, 0, 120, 80);
    const data = canvas.toDataURL("image/png");
    const bytes = Uint8Array.from(atob(data.split(",")[1]), c => c.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "reference.png", { type: "image/png" }));
    document.getElementById("popover-comment")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    return data;
  });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("這裡排版可以參考該圖[img1]，保留原本功能");
  await expect(page.getByRole("button", { name: "Preview reference img1", exact: true })).toBeVisible();
  await expect(page.locator("#count")).toHaveText("1");
  await page.getByRole("button", { name: "Preview reference img1", exact: true }).click();
  await expect(page.locator("#reference-preview-image")).toHaveAttribute("src", data);
  await page.getByRole("button", { name: "Close reference preview", exact: true }).click();
  await field.focus(); await field.press("End");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#popover-add-reference").click();
  await expect(page.locator("#reference-dropzone")).toBeFocused();
  await page.locator("#reference-file-open").click();
  await (await chooser).setFiles({ name: "reference2.png", mimeType: "image/png", buffer: Buffer.from(data.split(",")[1], "base64") });
  await expect.poll(() => field.inputValue()).toContain("[img2]");
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].references?.length)).toBe(2);
  await field.press("Enter");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const exported = await page.evaluate(() => window.redpenTest.exports[0]);
  expect(exported.svg).toContain("Reference [img1]"); expect(exported.svg).toContain("Reference [img2]");
  expect(exported.svg).toContain(data);
  expect(exported.markdown).toContain("Reference [img1]");
  await page.reload();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.locator("#item-list .item-card").first().click();
  await expect(page.locator("#references .reference-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove reference img1", exact: true }).click();
  await expect(page.locator("#references .reference-row")).toHaveCount(1);
  await expect(page.locator("#comment")).not.toHaveValue(/\[img1\]/);
  await expect(page.locator("#comment")).toHaveValue(/\[img2\]/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#references .reference-row")).toHaveCount(2);
  await expect(page.locator("#comment")).toHaveValue(/\[img1\]/);
});


test("reference upload failures leave requests editable and image numbers are scoped to each request", async ({ page }) => {
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  const field = page.locator("#comment"); await field.fill("保留這段文字");
  const chooser = page.waitForEvent("filechooser"); await page.locator("#add-reference").click();
  await page.locator("#reference-file-open").click();
  await (await chooser).setFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken image") });
  await expect(page.locator("#toast")).toContainText("Paste failed");
  await expect(field).toBeFocused(); await expect(field).toHaveValue("保留這段文字");
  expect(await page.locator("#app").evaluate((element: HTMLElement) => element.inert)).toBe(false);
  const png = await page.evaluate(() => document.createElement("canvas").toDataURL("image/png").split(",")[1]);
  await field.fill("x".repeat(8000));
  const tooLong = page.waitForEvent("filechooser"); await page.locator("#add-reference").click();
  await page.locator("#reference-file-open").click();
  await (await tooLong).setFiles({ name: "valid.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator("#toast")).toContainText("Object text is too long");
  await expect(field).toBeFocused(); await expect(field).toHaveValue("x".repeat(8000));
  expect(await page.locator("#app").evaluate((element: HTMLElement) => element.inert)).toBe(false);
  await field.fill("保留這段文字");
  await page.locator('[data-tool="note"]').click();
  await drag(page, await position(page, 500, 300), await position(page, 650, 390));
  await field.fill("第二則需求");
  for (const index of [0, 1]) {
    await page.locator("#item-list .item-card").nth(index).click();
    await field.evaluate(element => {
      const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 24;
      const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), c => c.charCodeAt(0));
      const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "reference.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    await expect(field).toHaveValue(/\[img1\]/);
    await expect(field).toBeFocused();
  }
  const items = await page.evaluate(() => window.redpenTest.project.items);
  expect(items).toHaveLength(2);
  expect(items.map(item => item.references![0].id)).toEqual([1, 1]);
  expect(items[0].references![0].asset).not.toEqual(items[1].references![0].asset);
});


test("motion previews attach readable recipes to regions, persist, and can be removed", async ({ page }) => {
  await page.locator("#components").click();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.getByRole("button", { name: "Preview Slide up", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use Slide up", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use Slide up", exact: true }).click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await expect(page.locator("#motion-summary")).toContainText("Slide up");
  await page.locator("#comment").fill("這個區域出現時由下往上淡入");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const svg = await page.evaluate(() => window.redpenTest.exports[0].svg);
  expect(svg).toContain("Motion: Slide up"); expect(svg).toContain("Duration: 280ms");
  expect(svg).toContain("prefers-reduced-motion");
  await page.reload();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await page.locator("#item-list .item-card").first().click();
  await expect(page.locator("#motion-summary")).toContainText("Slide up");
  await page.getByRole("button", { name: "Change motion", exact: true }).click();
  await page.getByRole("button", { name: "Use Expand / collapse", exact: true }).click();
  await expect(page.locator("#motion-summary")).toContainText("Expand / collapse");
  await page.getByRole("button", { name: "Remove motion", exact: true }).click();
  await expect(page.locator("#motion-summary")).toContainText("No motion specified");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#motion-summary")).toContainText("Expand / collapse");
});

test("toolbar drag shows insertion position and remembers order without changing the active tool", async ({ page }) => {
  const text = page.locator('[data-tool="text"]'), select = page.locator('[data-tool="select"]');
  const data = await page.evaluateHandle(() => new DataTransfer());
  await text.dispatchEvent("dragstart", { dataTransfer: data });
  const target = (await select.boundingBox())!;
  await select.dispatchEvent("dragover", { dataTransfer: data, clientX: target.x + 2, clientY: target.y + 5 });
  await expect(page.locator("#drawing-tools .toolbar-drop-line")).toBeVisible();
  await select.dispatchEvent("drop", { dataTransfer: data });
  await text.dispatchEvent("dragend", { dataTransfer: data });
  await expect(page.locator("#drawing-tools > button").first()).toHaveAttribute("data-tool", "text");
  await expect(page.locator('[data-tool="note"]')).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#drawing-tools > button").first()).toHaveAttribute("data-tool", "text");
  await page.locator("#export").focus(); await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".toolbar-right > button").nth(2)).toHaveAttribute("id", "export");
  await page.reload();
  await expect(page.locator(".toolbar-right > button").nth(2)).toHaveAttribute("id", "export");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset toolbar order", exact: true }).click();
  await expect(page.locator("#drawing-tools > button").first()).toHaveAttribute("data-tool", "select");
});


test("motion catalog separates component patterns from basics and carousels respond to navigation and drag", async ({ page }) => {
  await page.locator("#components").click();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await expect(page.locator(".motion-card")).toHaveCount(18);
  await page.getByLabel("Motion category", { exact: true }).selectOption("Interactive");
  await expect(page.locator(".motion-card")).toHaveCount(7);
  for (const [id, name] of [["carousel", "Snap carousel"], ["carousel-parallax", "Parallax carousel"], ["coverflow", "Coverflow carousel"]]) {
    const card = page.locator(`[data-motion="${id}"]`);
    const widget = card.locator(".motion-widget");
    await card.getByRole("button", { name: `${name}: next`, exact: true }).click();
    await expect(widget).toHaveAttribute("data-index", "1");
    await card.getByRole("button", { name: `${name}: next`, exact: true }).click();
    await expect(card.getByRole("button", { name: `${name}: next`, exact: true })).toBeDisabled();
    await expect(widget).toHaveAttribute("data-index", "2");
    const stage = card.locator(".preview-stage"); await stage.scrollIntoViewIfNeeded();
    const bounds = (await stage.boundingBox())!;
    await drag(page, { x: bounds.x + bounds.width * .3, y: bounds.y + 55 }, { x: bounds.x + bounds.width * .8, y: bounds.y + 55 });
    await expect(widget).toHaveAttribute("data-index", "1");
  }
  await page.getByLabel("Motion category", { exact: true }).selectOption("Basic");
  await expect(page.locator(".motion-card")).toHaveCount(6);
  await page.getByLabel("Motion category", { exact: true }).selectOption("All");
  await page.getByRole("searchbox").fill("水平視差");
  await expect(page.locator(".motion-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Use Horizontal parallax", exact: true })).toBeVisible();
});

test("scroll motion previews scrub in both directions and export progress-linked specifications", async ({ page }) => {
  await page.locator("#components").click();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.getByLabel("Motion category", { exact: true }).selectOption("Scroll");
  await expect(page.locator(".motion-card")).toHaveCount(5);
  for (const card of await page.locator(".motion-card").all()) {
    const slider = card.getByRole("slider");
    await slider.fill("100");
    await expect(card.locator(".motion-widget")).toHaveAttribute("data-progress", "100");
    await slider.fill("0");
    await expect(card.locator(".motion-widget")).toHaveAttribute("data-progress", "0");
  }
  const parallax = page.locator('[data-motion="horizontal-parallax"]');
  await parallax.getByRole("slider").fill("100");
  await expect(parallax.locator(".preview-parallax-front")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -160, 0)");
  await expect(parallax.locator(".preview-parallax-back")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -56, 0)");
  await page.getByRole("button", { name: "Use Horizontal parallax", exact: true }).click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const svg = await page.evaluate(() => window.redpenTest.exports[0].svg);
  const readable = svg.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  expect(readable).toContain("no fixed playback duration"); expect(readable).toContain("foreground x=-160px");
  expect(svg).not.toContain("Duration: 0ms");
});

test("stateful component previews switch tabs, cycle cards, expand, and stop loops on close", async ({ page }) => {
  await page.locator("#components").click();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  const tabs = page.locator('[data-motion="sliding-tabs"]');
  await tabs.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(tabs.locator(".motion-widget")).toHaveAttribute("data-index", "1");
  await expect(tabs.getByRole("tabpanel")).toHaveText("Details panel");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
  const stack = page.locator('[data-motion="swipe-stack"]');
  await stack.getByRole("button", { name: "Next card", exact: true }).click();
  await expect(stack.locator(".motion-widget")).toHaveAttribute("data-index", "1");
  const expand = page.getByRole("button", { name: "Toggle expanding card", exact: true });
  await expand.click(); await expect(expand).toHaveAttribute("aria-expanded", "true");
  await expand.press("Escape"); await expect(expand).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Play marquee", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause marquee", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close library", exact: true }).click();
  await expect.poll(() => page.locator("#library-results").evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test("reduced motion keeps advanced previews static and narrow layouts keep controls reachable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 360, height: 700 });
  await page.locator("#components").click();
  await page.getByRole("tab", { name: "Motion", exact: true }).click();
  await page.getByLabel("Motion category", { exact: true }).selectOption("Scroll");
  for (const slider of await page.getByRole("slider").all()) await expect(slider).toBeDisabled();
  expect(await page.locator("#library").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByLabel("Motion category", { exact: true }).selectOption("Interactive");
  const marquee = page.locator('[data-motion="marquee"]');
  await expect(marquee.getByRole("button", { name: "Play marquee", exact: true })).toBeDisabled();
});


/** Convert shared canvas coordinates using the actual zoom and fit across all background screens. */
async function canvasPosition(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const backgrounds = await page.evaluate(() => window.redpenTest.project.backgrounds!);
  const bounds = (await page.locator("#canvas").boundingBox())!;
  const width = Math.max(...backgrounds.map(image => image.x + image.width));
  const height = Math.max(...backgrounds.map(image => image.y + image.height));
  const panelWidth = (backgrounds.length > 1 || backgrounds[0].x !== 0 || backgrounds[0].y !== 0) && await page.locator("#sidebar").isVisible() ? (await page.locator("#right-panel").boundingBox())!.width + 16 : 0;
  const visibleWidth = bounds.width - panelWidth;
  const scale = Math.max(.02, Math.min(1, (visibleWidth - 64) / width, (bounds.height - 96) / height));
  return { x: bounds.x + (visibleWidth - width * scale) / 2 + x * scale, y: bounds.y + (bounds.height - height * scale) / 2 + y * scale };
}

test("pasted backgrounds keep a gap and stay fixed; cross-screen notes survive deletion and the final image stays", async ({ page }) => {
  await pasteRaster(page, 390, 844);
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(2);
  await pasteRaster(page, 400, 900);
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(3);
  const original = await page.evaluate(() => window.redpenTest.project.backgrounds!);
  expect(original.map(image => [image.x, image.width, image.height])).toEqual([[0, 1200, 800], [1264, 390, 844], [1718, 400, 900]]);
  await expect(page.locator("#count")).toHaveText("0");
  await page.locator('[data-tool="arrow"]').click();
  await drag(page, await canvasPosition(page, 1100, 500), await canvasPosition(page, 1400, 500));
  await page.locator("#comment").fill("從第一頁前往第二頁");
  await page.locator('[data-tool="note"]').click();
  await drag(page, await canvasPosition(page, 1150, 600), await canvasPosition(page, 1400, 700));
  await page.locator("#comment").fill("跨圖片共用的排版需求");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const annotations = await page.evaluate(() => window.redpenTest.project.items);
  await drag(page, await canvasPosition(page, 1300, 200), await canvasPosition(page, 1400, 300));
  expect(await page.evaluate(() => window.redpenTest.project.backgrounds)).toEqual(original);
  const second = await canvasPosition(page, 1300, 100); await page.mouse.dblclick(second.x, second.y);
  await expect(page.locator("#background-actions")).toBeVisible();
  await page.getByRole("button", { name: "Delete background", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(2);
  await expect(page.locator("#toast")).toContainText("Annotations were kept");
  expect(await page.evaluate(() => window.redpenTest.project.items)).toEqual(annotations);
  expect(await page.evaluate(() => window.redpenTest.project.backgrounds)).toEqual([original[0], original[2]]);
  await page.getByRole("button", { name: "Fit to view", exact: true }).click();
  const first = await canvasPosition(page, 100, 100); await page.mouse.dblclick(first.x, first.y);
  await page.getByRole("button", { name: "Delete background", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(1);
  await expect(page.locator("#filename")).toContainText("400 × 900");
  await page.getByRole("button", { name: "Fit to view", exact: true }).click();
  const last = await canvasPosition(page, 1800, 100); await page.mouse.dblclick(last.x, last.y);
  await page.keyboard.press("Delete");
  await expect(page.locator("#toast")).toContainText("At least one background image must remain");
  expect(await page.evaluate(() => window.redpenTest.project.backgrounds)).toEqual([original[2]]);
  expect(await page.evaluate(() => window.redpenTest.project.items)).toEqual(annotations);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(2);
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  const exported = await page.evaluate(async () => {
    const result = window.redpenTest.exports[0]; const doc = new DOMParser().parseFromString(result.svg, "image/svg+xml");
    const image = new Image(); image.src = result.png; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    return { backgrounds: doc.querySelectorAll("#original [data-background]").length, gap: [...context.getImageData(1250, 50, 1, 1).data], third: [...context.getImageData(1750, 50, 1, 1).data] };
  });
  expect(exported.backgrounds).toBe(2); expect(exported.gap).toEqual([0, 0, 0, 0]); expect(exported.third).toEqual([255, 0, 0, 255]);
  await page.reload();
  expect(await page.evaluate(() => window.redpenTest.project.backgrounds)).toEqual([original[0], original[2]]);
});

test("copy regions use the selected background and replacing that background preserves notes and copied pixels", async ({ page }) => {
  await pasteRaster(page, 390, 844);
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(2);
  await page.getByRole("button", { name: "Copy region", exact: true }).click();
  await drag(page, await canvasPosition(page, 1300, 100), await canvasPosition(page, 1400, 200));
  const crop = await page.evaluate(() => window.redpenTest.project.items[0]);
  const background = await page.evaluate(() => window.redpenTest.project.backgrounds![1]);
  expect(crop.asset).toBe(background.asset);
  expect(Math.abs(crop.source!.x - 36)).toBeLessThan(2);
  await page.locator("#comment").fill("保留這個參考區塊");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const position = await canvasPosition(page, 1300, 400); await page.mouse.dblclick(position.x, position.y);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace background", exact: true }).click();
  const bytes = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 390; canvas.height = 700; return canvas.toDataURL("image/png").split(",")[1]; });
  await (await chooser).setFiles({ name: "new-screen.png", mimeType: "image/png", buffer: Buffer.from(bytes, "base64") });
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds![1].height)).toBe(700);
  const next = await page.evaluate(() => window.redpenTest.project);
  expect(next.backgrounds![1].x).toBe(background.x);
  expect(next.items[0].asset).toBe(crop.asset); expect(next.items[0].source).toEqual(crop.source);
  expect(next.items[0].comment).toBe("保留這個參考區塊");
});

test("comment popovers drag without losing text focus and reset when reopened", async ({ page }) => {
  await page.getByRole("button", { name: "Hide requests", exact: true }).click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  const popup = page.locator("#comment-popover"), field = page.locator("#popover-comment"), handle = page.getByRole("button", { name: "Move comment", exact: true });
  await field.fill("修改這個按鈕的排版");
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 3));
  const original = (await popup.boundingBox())!;
  const heading = (await handle.boundingBox())!;
  await field.dispatchEvent("compositionstart", { data: "" });
  await drag(page, { x: heading.x + 30, y: heading.y + 8 }, { x: heading.x - 130, y: heading.y + 108 });
  const moved = (await popup.boundingBox())!;
  expect(moved.x).toBeCloseTo(original.x - 160, 0); expect(moved.y).toBeCloseTo(original.y + 100, 0);
  await expect(field).toBeFocused(); await expect(field).toHaveValue("修改這個按鈕的排版");
  expect(await field.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(field).toBeFocused();
  await page.keyboard.insertText("中文"); await field.dispatchEvent("compositionend", { data: "中文" });
  await expect(field).toHaveValue("修改這中文個按鈕的排版");
  await field.press("Tab"); // Field save rerenders the canvas, but must not move the popup.
  expect((await popup.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  expect((await popup.boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await page.getByRole("button", { name: "Close comment", exact: true }).click();
  await page.getByRole("button", { name: "Comment 1: Region note", exact: true }).click();
  await expect(field).toBeFocused();
  const reopened = (await popup.boundingBox())!;
  expect(reopened.x).toBeCloseTo(original.x, 0); expect(reopened.y).toBeCloseTo(original.y, 0);
  await handle.focus(); await page.keyboard.press("ArrowLeft");
  expect((await popup.boundingBox())!.x).toBeCloseTo(original.x - 10, 0);
  const currentHeading = (await handle.boundingBox())!;
  await drag(page, { x: currentHeading.x + 20, y: currentHeading.y + 8 }, { x: -100, y: -100 });
  const bounded = (await popup.boundingBox())!;
  expect(bounded.x).toBe(8); expect(bounded.y).toBe(8);
});

/** Exercise browser image transfers without depending on OS clipboard permissions. */
async function transferImage(page: Page, selector: string, type: "paste" | "drop", width = 120, height = 80): Promise<void> {
  await page.locator(selector).evaluate((element, { type, width, height }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#3355ff"; ctx.fillRect(0, 0, width, height);
    const bytes = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    element.dispatchEvent(type === "drop" ? new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }) : new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { type, width, height });
}

test("files drop into an empty canvas, append backgrounds, and remain image objects in the image dialog", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#empty")).toBeVisible();
  await transferImage(page, "#empty", "drop", 240, 160);
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator("#filename")).toContainText("240 × 160");
  await transferImage(page, "#canvas", "drop");
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.backgrounds?.length)).toBe(2);
  const backgrounds = await page.evaluate(() => window.redpenTest.project.backgrounds!);
  expect(backgrounds[1].x - backgrounds[0].width).toBe(64);
  await page.locator("#new-image").click();
  await transferImage(page, "#image-dialog", "drop");
  await expect(page.locator("#image-dialog")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0]?.kind)).toBe("image");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
});

test("reference image controls open a paste area and keep the owning request and insertion point", async ({ page }) => {
  await page.locator("#toggle-sidebar").click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await page.locator("#popover-comment").fill("參考這裡排版");
  await page.locator("#popover-comment").evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 2));
  const actions = await page.locator("#comment-popover .request-actions button").evaluateAll(buttons => buttons.map(button => ({ y: button.getBoundingClientRect().y, text: button.textContent })));
  expect(new Set(actions.map(action => action.y)).size).toBe(1);
  expect(actions.every(action => action.text === "")).toBe(true);
  await page.locator("#popover-add-reference").click();
  await expect(page.locator("#reference-dropzone")).toBeFocused();
  await transferImage(page, "#reference-dropzone", "paste");
  await expect(page.locator("#reference-dialog")).toBeHidden();
  await expect(page.locator("#popover-comment")).toBeFocused();
  await expect(page.locator("#popover-comment")).toHaveValue("參考[img1]這裡排版");
  await page.locator("#popover-add-reference").click();
  await transferImage(page, "#reference-dialog", "drop");
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].references?.length)).toBe(2);
  await expect(page.locator("#count")).toHaveText("1");
  await page.screenshot({ path: "test-results/request-popup-refined.png" });
});

test("drawing across comment markers stays uninterrupted and new icons can be moved immediately", async ({ page }) => {
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await page.locator("#comment").fill("原本註解");
  const marker = (await page.locator(".comment-marker").boundingBox())!;
  await page.locator('[data-tool="cover"]').click();
  const from = { x: marker.x - 80, y: marker.y + marker.height / 2 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2, from.y, { steps: 8 });
  await expect(page.locator("#comment-popover")).toBeHidden();
  await page.mouse.move(marker.x + marker.width + 70, from.y + 50, { steps: 8 }); await page.mouse.up();
  await expect(page.locator("#count")).toHaveText("2");
  await page.locator('[data-tool="stamp"]').click();
  const start = await position(page, 600, 400); await page.mouse.click(start.x, start.y);
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => window.redpenTest.project.items[2].x);
  await drag(page, { x: start.x + 10, y: start.y + 10 }, { x: start.x + 60, y: start.y + 50 });
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[2].x)).toBeGreaterThan(before);
});

test("request tools attach components and motions, show saved state, and settings use icon copy feedback", async ({ page }) => {
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  const saving = await page.locator("#comment").evaluate((field: HTMLTextAreaElement) => {
    field.value = "調整這裡"; field.dispatchEvent(new Event("change", { bubbles: true }));
    return document.getElementById("save-status")!.getAttribute("data-state");
  });
  expect(saving).toBe("saving");
  await expect(page.locator("#save-status")).toHaveAttribute("aria-label", "Saved");
  await page.locator("#add-motion").click();
  await page.locator("#library-search").fill("tooltip"); await page.locator(".library-card").click();
  await expect(page.locator("#component-summary")).toHaveText("Tooltip");
  await expect(page.locator("#count")).toHaveText("1");
  await page.locator("#add-motion").click(); await page.locator("#tab-motion").click();
  await page.getByRole("button", { name: "Use Slide up", exact: true }).click();
  await expect(page.locator("#motion-summary")).toContainText("Slide up");
  const header = (await page.locator(".request-heading").boundingBox())!;
  const color = (await page.locator("#color").boundingBox())!;
  expect(color.x).toBeGreaterThan(header.x + header.width / 2);
  expect(color.y).toBeGreaterThanOrEqual(header.y);
  await expect(page.locator("#item-list .item-number svg")).toHaveCount(1);
  await page.screenshot({ path: "test-results/request-sidebar-refined.png" });
  await page.locator("#remove-component").click(); await expect(page.locator("#component-field")).toBeHidden();
  await page.locator("#remove-motion").click(); await expect(page.locator("#motion-field")).toBeHidden();
  await page.locator("#export").click(); await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-save")).toHaveText("Save");
  await expect(page.locator("#settings hr")).toHaveCount(2);
  await expect(page.locator(".settings-heading-actions #copy-prompt")).toBeVisible();
  await page.locator("#copy-prompt").click(); await expect(page.locator("#copy-prompt")).toHaveAttribute("aria-label", "Copied");
  expect(await page.evaluate(() => window.redpenTest.copiedPrompt)).toContain("/demo/redpen.svg");
  await page.screenshot({ path: "test-results/settings-refined.png" });
  await page.locator("#settings-close").click();
  const toast = (await page.locator("#toast").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(toast.x + toast.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(viewport.height - toast.y - toast.height).toBeCloseTo(24, 0);
});

test("popup library actions edit the hovered request without replacing its text with another selection", async ({ page }) => {
  await page.locator("#toggle-sidebar").click();
  await drag(page, await position(page, 270, 170), await position(page, 450, 245));
  await page.locator("#popover-comment").fill("第一個需求"); await page.locator("#popover-comment").press("Enter");
  await page.locator('[data-tool="note"]').click();
  await drag(page, await position(page, 600, 450), await position(page, 750, 550));
  await page.locator("#popover-comment").fill("第二個需求"); await page.locator("#popover-comment").press("Enter");
  await page.getByRole("button", { name: "Comment 1: Region note", exact: true }).click();
  await page.locator("#popover-add-library").click();
  await page.locator("#library-search").fill("tooltip"); await page.locator(".library-card").click();
  const items = await page.evaluate(() => window.redpenTest.project.items);
  expect(items.map(item => item.comment)).toEqual(["第一個需求", "第二個需求"]);
  expect(items[0].component).toBe("Tooltip"); expect(items[1].component).toBeUndefined();
});

test("refined request controls stay reachable in a narrow light themed editor", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await page.evaluate(() => {
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries({ "--vscode-editor-background": "#faf8f5", "--vscode-sideBar-background": "#f1ece6", "--vscode-foreground": "#29252b", "--vscode-descriptionForeground": "#625c65", "--vscode-panel-border": "#ccc3bb", "--vscode-input-background": "#fffdfa", "--vscode-textLink-foreground": "#8b3048" })) style.setProperty(name, value);
  });
  await page.locator("#add-comment").click(); await page.locator("#comment").fill("窄視窗的需求與顏色操作"); await page.locator("#comment").press("Enter");
  for (const id of ["add-motion", "add-reference", "save-status"]) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  await page.locator("#add-reference").click();
  await expect(page.locator("#reference-dropzone")).toBeFocused();
  await page.screenshot({ path: "test-results/reference-dialog-light-narrow.png" });
  await page.keyboard.press("Escape"); await expect(page.locator("#comment")).toBeFocused();
});

test("notes are immediately movable and resizable, then drawing on empty canvas repeats annotation", async ({ page }) => {
  await drag(page, await position(page, 280, 180), await position(page, 440, 260));
  await page.locator("#comment").fill("先移動並調整大小");
  await page.locator("#comment").press("Enter");
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => window.redpenTest.project.items[0]);
  await drag(page, await position(page, before.x + 50, before.y + 40), await position(page, before.x + 110, before.y + 90));
  const moved = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(moved.x).toBeGreaterThan(before.x + 40);
  await drag(page, await position(page, moved.x + moved.width, moved.y + moved.height), await position(page, moved.x + moved.width + 60, moved.y + moved.height + 40));
  const resized = await page.evaluate(() => window.redpenTest.project.items[0]);
  expect(resized.width).toBeGreaterThan(moved.width + 40); expect(resized.height).toBeGreaterThan(moved.height + 20);
  await drag(page, await position(page, 650, 400), await position(page, 800, 500));
  await expect(page.locator("#count")).toHaveText("2");
  await expect(page.locator("#comment")).toBeFocused();
  await page.locator("#comment").fill("接著建立第二則"); await page.locator("#comment").press("Enter");
  await page.locator('[data-tool="select"]').click();
  await drag(page, await position(page, 100, 600), await position(page, 200, 650));
  await expect(page.locator("#count")).toHaveText("2");
  const items = await page.evaluate(() => window.redpenTest.project.items);
  expect(items.map(item => item.comment)).toEqual(["先移動並調整大小", "接著建立第二則"]);
});
