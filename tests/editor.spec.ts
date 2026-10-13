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
  await page.getByRole("button", { name: "Components", exact: true }).click();
  await page.getByRole("searchbox").fill("tooltip");
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.locator(".library-card").click();
  await drag(page, await position(page, 250, 150), await position(page, 460, 250));
  await expect(page.locator("#comment")).toBeFocused();
  await page.locator("#comment").fill("hover 時顯示欄位說明");
  await page.getByRole("button", { name: "Icon", exact: true }).click();
  const point = await position(page, 500, 300); await page.mouse.click(point.x, point.y);
  await expect(page.locator("#stamp")).toHaveValue("placeholder");
  await page.locator(".item-card").first().click();
  await expect(page.locator("#comment")).toBeFocused();
  await expect(page.locator("#comment")).toHaveValue("hover 時顯示欄位說明");
  await page.getByRole("button", { name: "Export for Agent", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.redpenTest.exports.length)).toBe(1);
  expect(await page.evaluate(() => window.redpenTest.exports[0].markdown)).toContain("UI component: Tooltip");
  await page.reload();
  await page.getByRole("button", { name: "Show requests", exact: true }).click();
  await expect(page.locator("#count")).toHaveText("2");
  await page.locator(".item-card").last().click();
  await expect(page.locator("#stamp")).toHaveValue("placeholder");
  await page.getByRole("button", { name: "Components", exact: true }).click();
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
  expect(output.markdown).toContain("The original screenshot starts in modified.png at x=");
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await pasteRaster(page, 640, 480);
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
  await drag(page, point, { x: point.x + 40, y: point.y + 20 });
  await expect.poll(() => page.evaluate(() => window.redpenTest.project.items[0].x)).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Comment 1: Region note", exact: true }).hover();
  await expect(page.locator("#popover-comment")).toHaveValue("Small movable item");
  expect((await page.locator("#comment-popover").boundingBox())!.width).toBeLessThanOrEqual(240);
  await page.screenshot({ path: "test-results/compact-controls.png" });
});
