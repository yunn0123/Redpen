/** A screenshot-first canvas keeps editing gestures local and sends only small document changes to VS Code. */
import Konva from "konva";
import { DEFAULT_HANDOFF_PROMPT, MAX_IMAGE_BYTES, MAX_ITEMS, MAX_PIXELS, kindNames, parseProject, selectionRect, type Item, type Kind, type Project, type Rect } from "../model";
import { iconLibrary, componentLibrary } from "./library";
import "./editor.css";

declare global { interface Window { acquireVsCodeApi: () => { postMessage: (message: unknown) => void } } }
type Tool = "select" | "pan" | Kind;
type Point = { x: number; y: number };
const host = window.acquireVsCodeApi();
const icons: Record<string, string> = {
  image: '<rect x="2" y="3" width="20" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m2 18 6-6 4 4 4-6 6 8"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  settings: '<path d="m9 3 1-2h4l1 2 3 2 3 1 1 4-2 2v3l1 3-3 3-3-1h-3l-2 2-4-1-1-3-2-3-2-1v-4l2-1 2-3 1-3Z"/><circle cx="12" cy="12" r="4"/>',
  outline: '<rect x="3" y="3" width="18" height="18"/>',
  select: '<path d="m5 3 13 9-6 1-3 6Z"/>', pan: '<path d="M8 11V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 2Z"/>',
  note: '<rect x="3" y="3" width="18" height="14" rx="3"/><path d="m7 17-1 4 6-4M7 8h10M7 12h6"/>',
  cover: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m4 17 13-12M10 20 10-10"/>',
  crop: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  arrow: '<path d="m4 20 16-16M9 4h11v11"/>', text: '<path d="M4 6V3h16v3M12 3v18M8 21h8"/>',
  stamp: '<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".5"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  export: '<path d="M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4"/>',
  undo: '<path d="M4 9h10a6 6 0 1 1 0 12M9 4 4 9l5 5"/>', redo: '<path d="M20 9H10a6 6 0 1 0 0 12m5-17 5 5-5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};

/** Icons are fixed markup; user-supplied content is always assigned through textContent or value. */
function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ""}</svg>`;
}

const tools: [Tool, string, string][] = [
  ["select", "選取", "V"], ["pan", "移動畫布", "H"], ["note", "框選註解", "N"], ["cover", "遮蓋", "M"],
  ["crop", "複製區塊", "C"], ["arrow", "箭頭", "A"], ["text", "文字", "T"], ["stamp", "圖示", "I"], ["outline", "外框", "R"],
];
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="toolbar" role="toolbar" aria-label="畫布工具">${tools.map(([id, label, key]) => `<button data-tool="${id}" title="${label} (${key})" aria-label="${label}" aria-pressed="false">${icon(id)}<span>${label}</span></button>`).join("")}
    <button id="components" aria-label="UI 元件">${icon("crop")}<span>UI 元件</span></button><button id="new-image" aria-label="新圖片">${icon("image")}<span>新圖片</span></button><button id="settings-open" aria-label="設定">${icon("settings")}<span>設定</span></button><span class="toolbar-spacer"></span><button id="undo" title="復原 (⌘/Ctrl Z)" aria-label="復原">${icon("undo")}</button><button id="redo" title="重做 (⌘/Ctrl Shift Z)" aria-label="重做">${icon("redo")}</button><button id="import" aria-label="匯入截圖">${icon("upload")}<span>匯入截圖</span></button><button id="export" class="primary" aria-label="匯出給 Agent">${icon("export")}<span>匯出給 Agent</span></button><button id="toggle-sidebar" aria-label="收起需求欄" aria-expanded="true">${icon("sidebar")}</button></div>
  <main><section class="workspace" aria-label="截圖畫布"><div id="canvas" tabindex="0" role="application" aria-label="截圖編輯畫布，使用工具框選；方向鍵移動所選物件，Delete 刪除"></div>
    <div id="empty"><span class="empty-icon">${icon("crop")}</span><h2>直接貼上你的截圖</h2><p>點一下畫布，按 ⌘ V / Ctrl V 貼上圖片。<br>不用先儲存，編輯完成後再匯出。</p><button id="empty-import">或選擇圖片檔案</button></div>
    <div class="canvas-hint" id="hint">框選區域，寫下你想改的地方</div>
    <div class="zoom-controls"><button id="zoom-out" aria-label="縮小">−</button><span id="zoom" aria-live="polite">100%</span><button id="zoom-in" aria-label="放大">＋</button><span class="divider"></span><button id="fit" title="符合畫面 (0)" aria-label="符合畫面">${icon("fit")}</button></div>
  </section><aside id="sidebar" aria-label="修改需求"><div class="aside-heading"><h2>修改需求</h2><div><button id="add-comment" aria-label="新增整體需求" title="新增無位置的文字需求">＋</button><span id="count">0</span></div></div><p id="selection-summary" hidden></p><button id="delete-many" hidden>刪除所選物件</button><p id="background-hint" hidden>已選取底圖，貼上圖片可替換底圖；現有元件的位置與大小不變。</p>
    <p class="aside-description">選取畫面上的區域，補充外觀或互動行為。</p>
    <section id="inspector" hidden><div class="inspector-heading"><strong id="selection-title"></strong><button id="delete" class="danger" title="刪除物件" aria-label="刪除物件">${icon("trash")}</button></div>
      <div id="image-actions" hidden><button id="rotate-image">旋轉 90°</button><button id="flip-image-x">水平鏡像</button><button id="flip-image-y">垂直鏡像</button></div>
      <label id="text-label" hidden>顯示文字<input id="display-text" maxlength="2000"></label>
      <label id="font-label" hidden>字級 · ⌘/Ctrl ＋／－<input id="font-size" type="number" min="8" max="200" step="2" value="22"></label>
      <label id="stamp-label" hidden>圖示<select id="stamp"><option value="placeholder">灰色圓圈 · Icon 佔位符</option><option value="+">＋ 新增</option><option value="✓">✓ 完成</option><option value="×">× 關閉</option><option value="!">! 提醒</option><option value="?">? 說明</option><option value="★">★ 星號</option>${iconLibrary.map(entry => `<option value="icon:${entry.id}">${entry.name}</option>`).join("")}</select></label>
      <section id="sketch-panel" hidden><label>簡易鋼筆繪製<canvas id="sketch" width="200" height="160" aria-label="圖示手繪區"></canvas></label><button id="sketch-clear">清除筆畫</button><small>也可直接在下方文字描述需要的 icon。</small></section>
      <label id="color-label">顏色<input id="color" type="color" value="#f35e5e"></label>
      <label for="comment">補充需求<textarea id="comment" maxlength="8000" rows="5" placeholder="例如：hover 此區域時顯示＋，點擊後直接新增可輸入的 todo。"></textarea></label>
      <span class="field-hint" id="save-hint">離開欄位即套用 · 自動暫存</span>
    </section><div id="item-list"></div><div id="notes-empty"><span>01</span><p>讓每個修改都有位置</p><small>使用「框選註解」，或選取一個拼貼物件。</small></div>
    <div class="aside-footer"><span id="filename">原圖保留 · 完成後再匯出</span></div></aside></main>
  <dialog id="image-dialog" aria-labelledby="image-dialog-title"><div class="library-heading"><h2 id="image-dialog-title">新增圖片元件</h2><button id="image-dialog-close" aria-label="關閉新增圖片">×</button></div><p>選擇圖片，或直接按 ⌘ V／Ctrl V 貼上。圖片會成為可移動、旋轉與鏡像的元件。</p><button id="image-file-open" class="primary">選擇圖片檔案</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></dialog>
  <dialog id="library" aria-labelledby="library-title"><div class="library-heading"><h2 id="library-title"></h2><button id="library-close" aria-label="關閉素材庫">×</button></div><input id="library-search" type="search" aria-label="搜尋素材" placeholder="搜尋名稱或用途"><div id="library-results"></div></dialog>
  <dialog id="settings" aria-labelledby="settings-title"><div class="library-heading"><h2 id="settings-title">設定</h2><button id="settings-close" aria-label="關閉設定">×</button></div><label>複製交接 prompt<textarea id="handoff-prompt" maxlength="4000" rows="7"></textarea></label><p>使用 {svgPath} 代表匯出的 SVG 路徑；未填寫此變數時會自動附上路徑。</p><div class="settings-actions"><button id="settings-reset">還原預設</button><button id="settings-save" class="primary">儲存設定</button><button id="copy-prompt" disabled>複製交接 prompt</button></div><p>匯出為單一 SVG：original 原圖、modified 修改物件、annotations 註解文字。可透過「匯入截圖」重新開啟本工具匯出的 SVG。</p></dialog>
  <div id="toast" role="status" aria-live="polite" hidden></div>`;

/** Resolve a fixed editor element once its template has been mounted. */
function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }

const canvas = el<HTMLDivElement>("canvas");
Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
Konva.dragButtons = [0];
const stage = new Konva.Stage({ container: canvas, width: 1, height: 1 });
const layer = new Konva.Layer();
const scene = new Konva.Group();
const overlay = new Konva.Group();
const arrowHandles = new Konva.Group();
const transformer = new Konva.Transformer({ rotateEnabled: false, flipEnabled: false, keepRatio: false, borderStroke: "#5fd6bd", anchorStroke: "#5fd6bd", anchorSize: 8, enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"], boundBoxFunc: (old, next) => Math.abs(next.width) < 8 || Math.abs(next.height) < 8 ? old : next });
overlay.add(transformer, arrowHandles);
layer.add(scene, overlay);
stage.add(layer);
let project: Project | undefined;
let screenshot: HTMLImageElement | undefined;
let imageUri = "";
let loadGeneration = 0;
let selectedId: string | undefined;
let selectedIds = new Set<string>();
let backgroundSelected = false;
let assets = new Map<string, HTMLImageElement>();
let marquee: { start: Point; current: Point; preview: Konva.Rect; additive: boolean } | undefined;
let moving: { anchor: string; start: Point; positions: Map<string, Point> } | undefined;
let tool: Tool = "note";
let revision = 0;
let pendingComponent: string | undefined;
let handoffPrompt = DEFAULT_HANDOFF_PROMPT;
let stroke: { id: string; pointerId: number; points: number[] } | undefined;
let gesture: { start: Point; current: Point; preview: Konva.Shape; kind: Kind } | undefined;
let pan: { start: Point; origin: Point } | undefined;
let space = false;
let toastTimer: ReturnType<typeof setTimeout>;
let exporting = false;
let fatal = false;

/** Keep transient feedback readable without interrupting a canvas gesture. */
function toast(message: string): void {
  el("toast").textContent = message;
  el("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el("toast").hidden = true; }, 6000);
}

/** Read the selected object from the current draft rather than retaining stale references. */
function selected(): Item | undefined { return project?.items.find(item => item.id === selectedId); }

/** Keep single-item editing and multi-selection consistent without retaining stale item references. */
function selectItems(ids: Iterable<string>): void {
  selectedIds = new Set(ids);
  selectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
  backgroundSelected = false;
}

/** Image transforms preserve the center and store the resulting axis-aligned footprint. */
function transformImage(action: "rotate" | "flipX" | "flipY"): void {
  flushFields();
  const item = selected();
  if (!item || !["image", "crop"].includes(item.kind) || fatal) return;
  if (action === "rotate") {
    const width = item.width, height = item.height;
    item.x += (width - height) / 2; item.y += (height - width) / 2;
    item.width = height; item.height = width; item.rotation = ((item.rotation ?? 0) + 90) % 360;
  } else item[action] = !item[action];
  commit();
}

/** Preview normalized icon strokes so resizing the canvas icon also scales the drawing. */
function drawSketch(): void {
  const surface = el<HTMLCanvasElement>("sketch"), ctx = surface.getContext("2d")!;
  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = "#d1d5db"; ctx.beginPath(); ctx.arc(100, 80, 72, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = selected()?.color ?? "#f35e5e"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const points of [...(selected()?.strokes ?? []), ...(stroke ? [stroke.points] : [])]) {
    ctx.beginPath();
    points.forEach((point, i) => { if (i % 2 === 0) { if (i === 0) ctx.moveTo(point * 200, points[i + 1] * 160); else ctx.lineTo(point * 200, points[i + 1] * 160); } });
    ctx.stroke();
  }
}

/** Commit a complete pen gesture as one undo step; cancellation discards only the unfinished stroke. */
function endStroke(save: boolean): void {
  if (!stroke) return;
  const pending = stroke; stroke = undefined;
  const item = selected();
  if (save && item?.id === pending.id && !fatal) {
    item.strokes = [...(item.strokes ?? []), pending.points]; item.text = "placeholder";
    commit();
  } else drawSketch();
}

/** Keep font changes in document history while preserving the active text field's caret. */
function changeFontSize(size: number): void {
  const item = selected();
  if (!item || item.kind !== "text" || fatal) return;
  if (!Number.isFinite(size)) { toast("請輸入 8 至 200 的字級。"); return; }
  item.fontSize = Math.max(8, Math.min(200, Math.round(size)));
  commit();
}

/** Open one searchable catalog; choosing a result arms the next canvas gesture. */
function openLibrary(): void {
  flushFields();
  el("library-title").textContent = "UI 元件";
  el<HTMLInputElement>("library-search").value = "";
  renderLibrary();
  el<HTMLDialogElement>("library").showModal();
  el("library-search").focus();
}

/** Render trusted local vector previews and search both English names and Chinese descriptions. */
function renderLibrary(): void {
  const query = el<HTMLInputElement>("library-search").value.trim().toLowerCase();
  const results = el("library-results"); results.replaceChildren();
  const entries = componentLibrary.map(entry => ({ name: `${entry.name} · ${entry.label}`, description: entry.description, preview: entry.skeleton, value: entry.name }));
  for (const entry of entries.filter(entry => `${entry.name} ${entry.description}`.toLowerCase().includes(query))) {
    const button = document.createElement("button");
    button.className = "library-card";
    button.innerHTML = `<svg viewBox="0 0 160 72" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${entry.preview}</svg>`;
    const name = document.createElement("strong"); name.textContent = entry.name;
    const description = document.createElement("small"); description.textContent = entry.description;
    button.append(name, description);
    button.addEventListener("click", () => {
      el<HTMLDialogElement>("library").close();
      setTool("note");
      pendingComponent = entry.value; el("hint").textContent = `${entry.name}：框選需要此元件的區域，再補充互動需求`;
      canvas.focus();
    });
    results.append(button);
  }
  if (!results.childElementCount) results.textContent = "找不到符合的項目，請換個關鍵字。";
}

/** Commit complete gestures as one native undo step; pointer motion stays out of document history. */
function commit(): void {
  if (!project || fatal) return;
  host.postMessage({ type: "edit", project: structuredClone(project), revision: ++revision });
  render();
}

/** Save edited fields before selection, export, or keyboard commands read the current draft. */
function flushFields(): void {
  const item = selected();
  if (!item || fatal) return;
  const comment = el<HTMLTextAreaElement>("comment").value;
  const text = item.kind === "text" ? el<HTMLInputElement>("display-text").value : item.text;
  if (item.comment !== comment || item.text !== text) { item.comment = comment; item.text = text; commit(); }
}

/** The inspector and list expose all annotations to keyboard and assistive technology users. */
function renderInspector(): void {
  const item = selected();
  el("count").textContent = String(project?.items.length ?? 0);
  el("notes-empty").hidden = Boolean(project?.items.length);
  el("inspector").hidden = !item;
  el("selection-summary").hidden = selectedIds.size < 2;
  el("selection-summary").textContent = `已選取 ${selectedIds.size} 個物件 · 拖曳移動，⌘/Ctrl 點擊取消選取`;
  el("delete-many").hidden = selectedIds.size < 2;
  el("background-hint").hidden = !backgroundSelected;
  el<HTMLButtonElement>("add-comment").disabled = !screenshot;
  el("image-actions").hidden = !item || !["image", "crop"].includes(item.kind);
  if (item) {
    const index = project!.items.indexOf(item) + 1;
    el("selection-title").textContent = `${String(index).padStart(2, "0")} · ${item.component ? `元件註解 · ${item.component}` : kindNames[item.kind]}`;
    el<HTMLTextAreaElement>("comment").value = item.comment;
    el<HTMLInputElement>("display-text").value = item.text;
    el<HTMLInputElement>("color").value = item.color;
    el<HTMLSelectElement>("stamp").value = item.text;
    el("text-label").hidden = item.kind !== "text";
    el("font-label").hidden = item.kind !== "text";
    el<HTMLInputElement>("font-size").value = String(item.fontSize ?? 22);
    el("stamp-label").hidden = item.kind !== "stamp";
    el("sketch-panel").hidden = item.kind !== "stamp";
    if (item.kind === "stamp") drawSketch();
    el("color-label").hidden = ["crop", "image", "comment"].includes(item.kind);
  }
  const list = el("item-list");
  list.replaceChildren();
  project?.items.forEach((entry, index) => {
    const button = document.createElement("button");
    button.className = `item-card${selectedIds.has(entry.id) ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(selectedIds.has(entry.id)));
    const number = document.createElement("span");
    number.className = "item-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const content = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = entry.component ? `元件註解 · ${entry.component}` : kindNames[entry.kind];
    const summary = document.createElement("small");
    summary.textContent = entry.comment || iconLibrary.find(icon => `icon:${icon.id}` === entry.text)?.name || entry.text || "點選補充需求";
    content.append(title, summary);
    button.append(number, content);
    button.addEventListener("click", () => { setTool("select"); selectItems([entry.id]); render(); el("comment").focus(); el("inspector").scrollIntoView({ block: "nearest" }); });
    list.append(button);
  });
}

/** Build screenshot-space nodes; only copied regions share the original decoded image. */
function makeNode(item: Item, index: number): Konva.Group | Konva.Shape {
  const base = { x: item.x, y: item.y, width: item.width, height: item.height, id: item.id };
  switch (item.kind) {
    case "outline": return new Konva.Rect({ ...base, stroke: item.color, strokeWidth: 2 });
    case "cover": return new Konva.Rect({ ...base, fill: item.color });
    case "comment": return new Konva.Group(base);
    case "image":
    case "crop": {
      const group = new Konva.Group(base);
      const rotation = item.rotation ?? 0;
      const width = rotation % 180 ? item.height : item.width, height = rotation % 180 ? item.width : item.height;
      group.add(new Konva.Image({ image: item.asset ? assets.get(item.asset)! : screenshot!, x: item.width / 2, y: item.height / 2,
        offsetX: width / 2, offsetY: height / 2, width, height, rotation, scaleX: item.flipX ? -1 : 1, scaleY: item.flipY ? -1 : 1,
        ...(item.kind === "crop" ? { crop: item.source! } : {}) }));
      return group;
    }
    case "arrow": return new Konva.Arrow({ x: item.x, y: item.y, id: item.id, points: [0, 0, item.width, item.height], stroke: item.color, fill: item.color, strokeWidth: 3, pointerLength: 12, pointerWidth: 12, hitStrokeWidth: 18 });
    case "text": return new Konva.Text({ ...base, text: item.text || "文字", fill: item.color, fontSize: item.fontSize ?? 22, align: "center", verticalAlign: "middle", fontFamily: "sans-serif", lineHeight: 1.3, wrap: "word" });
    case "stamp": {
      if (item.text === "placeholder") {
        const group = new Konva.Group(base);
        group.add(new Konva.Circle({ x: item.width / 2, y: item.height / 2, radius: Math.min(item.width, item.height) / 2, fill: "#d1d5db" }));
        for (const points of item.strokes ?? []) group.add(new Konva.Line({ points: points.map((p, i) => p * (i % 2 ? item.height : item.width)), stroke: item.color, strokeWidth: 2, lineCap: "round", lineJoin: "round" }));
        return group;
      }
      const entry = iconLibrary.find(entry => `icon:${entry.id}` === item.text);
      if (entry) {
        const group = new Konva.Group(base);
        const scale = Math.min(item.width, item.height) / 28;
        group.add(new Konva.Path({ data: entry.path, x: (item.width - 24 * scale) / 2, y: (item.height - 24 * scale) / 2, scaleX: scale, scaleY: scale, stroke: item.color, strokeWidth: 2, lineCap: "round", lineJoin: "round" }));
        return group;
      }
      return new Konva.Text({ ...base, text: item.text, fill: item.color, fontSize: Math.min(item.width, item.height) * .82, align: "center", verticalAlign: "middle", fontFamily: "sans-serif" });
    }
    case "note": {
      const group = new Konva.Group(base);
      group.add(new Konva.Rect({ width: item.width, height: item.height, stroke: item.color, strokeWidth: 2, fill: "rgba(243,94,94,0.035)" }));
      group.add(new Konva.Rect({ x: 0, y: 0, width: 28, height: 24, fill: item.color, cornerRadius: [0, 0, 5, 0] }));
      group.add(new Konva.Text({ x: 0, y: 5, width: 28, text: String(index + 1), fill: "#ffffff", fontSize: 14, align: "center", fontFamily: "sans-serif" }));
      return group;
    }
  }
}

/** Give arrows independent endpoints; signed deltas allow reversing direction without changing the draft format. */
function showSelection(node?: Konva.Group | Konva.Shape): void {
  transformer.nodes([]);
  arrowHandles.destroyChildren();
  transformer.enabledAnchors(selectedIds.size > 1 ? [] : ["top-left", "top-right", "bottom-left", "bottom-right"]);
  if (tool !== "select" || space || fatal) return;
  if (selectedIds.size > 1) { transformer.nodes(scene.getChildren().filter(child => selectedIds.has(child.id()))); return; }
  if (!node) return;
  if (!(node instanceof Konva.Arrow)) { transformer.nodes([node]); return; }
  const points = node.points();
  for (const endpoint of [0, 2]) {
    const handle = new Konva.Circle({ x: node.x() + points[endpoint], y: node.y() + points[endpoint + 1], radius: 6 / scene.scaleX(), fill: "#ffffff", stroke: "#5fd6bd", strokeWidth: 2 / scene.scaleX(), draggable: true });
    handle.on("mousedown touchstart", event => { event.cancelBubble = true; canvas.focus(); });
    handle.on("dragmove", () => {
      const next = node.points().slice();
      next[endpoint] = handle.x() - node.x(); next[endpoint + 1] = handle.y() - node.y();
      node.points(next);
    });
    handle.on("dragend", () => {
      const item = selected();
      if (!item || item.id !== node.id() || fatal) { render(); return; }
      const [x1, y1, x2, y2] = node.points();
      if (Math.hypot(x2 - x1, y2 - y1) < 8) { render(); return; }
      item.x = node.x() + x1; item.y = node.y() + y1;
      item.width = x2 - x1; item.height = y2 - y1;
      commit();
    });
    arrowHandles.add(handle);
  }
}

/** Render document objects; multi-drag updates only node positions until one final undoable commit. */
function render(): void {
  if (!project || !screenshot) return;
  transformer.nodes([]); arrowHandles.destroyChildren();
  scene.destroyChildren();
  const background = new Konva.Image({ name: "background", image: screenshot, width: screenshot.naturalWidth, height: screenshot.naturalHeight });
  background.on("dblclick dbltap", () => {
    if (tool !== "select" || fatal) return;
    flushFields(); cancelGesture(); selectItems([]); backgroundSelected = true; render(); canvas.focus();
  });
  scene.add(background);
  if (backgroundSelected) arrowHandles.add(new Konva.Rect({ width: screenshot.naturalWidth, height: screenshot.naturalHeight, stroke: "#5fd6bd", strokeWidth: 2 / scene.scaleX(), listening: false }));
  project.items.forEach((item, index) => {
    if (item.kind === "comment") return;
    const node = makeNode(item, index);
    node.draggable(tool === "select" && !space && !fatal);
    (node as Konva.Node).on("mousedown touchstart", event => {
      if (tool !== "select" || space || fatal) return;
      const mouse = event.evt as MouseEvent;
      if (mouse.button === 1) return;
      flushFields(); backgroundSelected = false;
      if (mouse.metaKey || mouse.ctrlKey) {
        const ids = new Set(selectedIds);
        if (ids.has(item.id)) ids.delete(item.id); else ids.add(item.id);
        selectItems(ids); node.draggable(selectedIds.has(item.id));
      } else if (!selectedIds.has(item.id)) selectItems([item.id]);
      event.cancelBubble = true; canvas.focus(); renderInspector();
      showSelection(selectedId ? scene.getChildren().find(child => child.id() === selectedId) as Konva.Shape : undefined);
    });
    (node as Konva.Node).on("dragstart", () => {
      moving = { anchor: item.id, start: { x: item.x, y: item.y }, positions: new Map(project!.items.filter(entry => selectedIds.has(entry.id)).map(entry => [entry.id, { x: entry.x, y: entry.y }])) };
    });
    (node as Konva.Node).on("dragmove", () => {
      if (moving?.anchor !== item.id) return;
      const dx = node.x() - moving.start.x, dy = node.y() - moving.start.y;
      for (const child of scene.getChildren()) {
        const origin = moving.positions.get(child.id());
        if (origin && child !== node) child.position({ x: origin.x + dx, y: origin.y + dy });
      }
      showSelection(selectedIds.size === 1 ? node : undefined);
    });
    (node as Konva.Node).on("dragend transformend", () => {
      if (fatal) return;
      for (const current of project!.items.filter(entry => selectedIds.has(entry.id))) {
        const child = scene.getChildren().find(child => child.id() === current.id);
        if (!child) continue;
        current.x = Math.round(child.x()); current.y = Math.round(child.y());
        if (current.kind !== "arrow") {
          current.width = Math.max(8, Math.round(current.width * child.scaleX()));
          current.height = Math.max(8, Math.round(current.height * child.scaleY()));
        }
      }
      moving = undefined; commit();
    });
    scene.add(node);
  });
  if (!backgroundSelected) showSelection(selectedId ? scene.getChildren().find(child => child.id() === selectedId) as Konva.Shape : undefined);
  renderInspector(); layer.draw();
}

/** Switch interaction modes while preserving the selected object's requirements. */
function setTool(next: Tool): void {
  flushFields();
  cancelGesture();
  tool = next;
  pendingComponent = undefined;
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.tool === tool)));
  canvas.style.cursor = tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  const hints: Record<Tool, string> = {
    select: "框選多個物件 · ⌘/Ctrl 點擊切換選取 · Delete 刪除 · 雙擊底圖可替換", pan: "拖曳移動畫布 · ⌘/Ctrl＋滾輪縮放",
    note: "框選區域，寫下你想改的地方", cover: "框選遮蓋區域，再調整填色", crop: "框選原圖中的元件，複製後拖曳到新位置",
    image: "加入圖片元件", comment: "無位置的整體需求",
    arrow: "拖曳畫箭頭，指出位置或移動方向", text: "點一下加入文字", stamp: "點一下加入灰色圓圈，在右側描述或手繪 icon", outline: "拖曳框出重點，不需要填寫註解",
  };
  el("hint").textContent = hints[tool];
  render();
}

/** Share the same viewport transform between content and selection handles. */
function viewport(scale: number, position: Point): void {
  scene.scale({ x: scale, y: scale }).position(position);
  overlay.scale({ x: scale, y: scale }).position(position);
  arrowHandles.getChildren().forEach(handle => {
    if (handle instanceof Konva.Circle) handle.radius(6 / scale);
    (handle as Konva.Shape).strokeWidth(2 / scale);
  });
  el("zoom").textContent = `${Math.round(scale * 100)}%`;
  layer.batchDraw();
}

/** Fit the entire screenshot with breathing room without upscaling small images. */
function fit(): void {
  if (!screenshot) return;
  const scale = Math.max(.02, Math.min(1, (stage.width() - 64) / screenshot.naturalWidth, (stage.height() - 96) / screenshot.naturalHeight));
  viewport(scale, { x: (stage.width() - screenshot.naturalWidth * scale) / 2, y: (stage.height() - screenshot.naturalHeight * scale) / 2 });
}

/** Zoom around the cursor so the region being inspected stays under the pointer. */
function zoomBy(factor: number, anchor = { x: stage.width() / 2, y: stage.height() / 2 }): void {
  const old = scene.scaleX();
  const scale = Math.max(.02, Math.min(5, old * factor));
  viewport(scale, { x: anchor.x - (anchor.x - scene.x()) * scale / old, y: anchor.y - (anchor.y - scene.y()) * scale / old });
}

/** Convert screen coordinates back to original screenshot pixels before creating geometry. */
function pointer(): Point {
  const point = stage.getPointerPosition() ?? { x: 0, y: 0 };
  return { x: (point.x - scene.x()) / scene.scaleX(), y: (point.y - scene.y()) / scene.scaleY() };
}

/** Keep unfinished drawing previews out of saved drafts and exports. */
function cancelGesture(): void {
  gesture?.preview.destroy(); gesture = undefined; pan = undefined;
  marquee?.preview.destroy(); marquee = undefined; moving = undefined; layer.batchDraw();
}

/** Sample a nearby background pixel as a useful initial cover color. */
function backgroundColor(rect: Rect): string {
  try {
    const sample = document.createElement("canvas"); sample.width = sample.height = 1;
    const context = sample.getContext("2d")!;
    context.drawImage(screenshot!, Math.max(0, rect.x - 1), Math.max(0, rect.y - 1), 1, 1, 0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return `#${Array.from(data.slice(0, 3)).map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
  } catch { return "#ffffff"; }
}

/** New elements retain source geometry so a copied component can be traced in agent notes. */
function addItem(kind: Kind, rect: Rect): void {
  if (!project || fatal) return;
  if (project.items.length >= MAX_ITEMS) { toast(`每份稿件最多 ${MAX_ITEMS} 個物件。`); return; }
  const item: Item = {
    ...rect, id: crypto.randomUUID(), kind, color: kind === "cover" ? backgroundColor(rect) : "#f35e5e",
    text: kind === "text" ? "文字" : kind === "stamp" ? "placeholder" : "", comment: "",
    ...(kind === "text" ? { fontSize: 22 } : {}),
    ...(kind === "note" && pendingComponent ? { component: pendingComponent } : {}),
    ...(kind === "crop" ? { source: { ...rect }, x: rect.x + 16, y: rect.y + 16 } : {}),
  };
  project.items.push(item); selectItems([item.id]); tool = "select"; commit(); setTool("select");
  if (kind === "note" || kind === "stamp" || kind === "comment") el<HTMLTextAreaElement>("comment").focus();
  else if (kind === "text") { el<HTMLInputElement>("display-text").focus(); el<HTMLInputElement>("display-text").select(); }
}

/** Start one creation or panning gesture; selection remains handled by object nodes. */
stage.on("mousedown touchstart", event => {
  canvas.focus();
  if (!screenshot || !project || fatal) return;
  const mouse = event.evt as MouseEvent;
  if (mouse.button === 2) return;
  const point = pointer();
  if (tool === "pan" || space || mouse.button === 1) {
    event.evt.preventDefault(); pan = { start: stage.getPointerPosition()!, origin: scene.position() }; canvas.style.cursor = "grabbing"; return;
  }
  if (tool === "select") {
    if (event.target === stage || event.target.hasName("background")) {
      flushFields(); backgroundSelected = false;
      const additive = mouse.metaKey || mouse.ctrlKey;
      if (!additive) selectItems([]);
      const preview = new Konva.Rect({ ...point, width: 0, height: 0, stroke: "#5fd6bd", strokeWidth: 1 / scene.scaleX(), fill: "rgba(95,214,189,.1)", listening: false });
      overlay.add(preview); marquee = { start: point, current: point, preview, additive };
      renderInspector(); showSelection();
    }
    return;
  }
  flushFields();
  if (tool === "crop" && (point.x < 0 || point.y < 0 || point.x > screenshot.naturalWidth || point.y > screenshot.naturalHeight)) return;
  if (tool === "text" || tool === "stamp") {
    addItem(tool, { ...point, width: tool === "text" ? 220 : 40, height: tool === "text" ? 70 : 40 }); return;
  }
  const preview = tool === "arrow"
    ? new Konva.Arrow({ points: [point.x, point.y, point.x, point.y], stroke: "#5fd6bd", fill: "#5fd6bd", strokeWidth: 2, listening: false })
    : new Konva.Rect({ ...point, width: 0, height: 0, stroke: "#5fd6bd", strokeWidth: 1.5 / scene.scaleX(), fill: "rgba(95,214,189,0.12)", dash: [5 / scene.scaleX(), 4 / scene.scaleX()], listening: false });
  overlay.add(preview); gesture = { start: point, current: point, preview, kind: tool };
});

/** Motion updates visual transforms only, avoiding repeated JSON serialization and image decoding. */
stage.on("mousemove touchmove", event => {
  if (pan) {
    event.evt.preventDefault(); const point = stage.getPointerPosition()!;
    viewport(scene.scaleX(), { x: pan.origin.x + point.x - pan.start.x, y: pan.origin.y + point.y - pan.start.y }); return;
  }
  if (marquee) {
    marquee.current = pointer(); marquee.preview.setAttrs(selectionRect(marquee.start, marquee.current)); layer.batchDraw(); return;
  }
  if (!gesture || !screenshot) return;
  const point = pointer();
  gesture.current = gesture.kind === "crop" ? { x: Math.max(0, Math.min(screenshot.naturalWidth, point.x)), y: Math.max(0, Math.min(screenshot.naturalHeight, point.y)) } : point;
  if (gesture.kind === "arrow") (gesture.preview as Konva.Arrow).points([gesture.start.x, gesture.start.y, gesture.current.x, gesture.current.y]);
  else gesture.preview.setAttrs(selectionRect(gesture.start, gesture.current, gesture.kind === "crop" ? { width: screenshot.naturalWidth, height: screenshot.naturalHeight } : undefined));
  layer.batchDraw();
});

/** Finish once even if the pointer is released outside the canvas. */
function endGesture(): void {
  if (marquee) {
    const rect = selectionRect(marquee.start, marquee.current);
    const ids = marquee.additive ? new Set(selectedIds) : new Set<string>();
    if (rect.width > 3 || rect.height > 3) for (const node of scene.getChildren()) {
      if (!node.id()) continue;
      const bounds = node.getClientRect({ relativeTo: scene });
      if (bounds.x <= rect.x + rect.width && bounds.x + bounds.width >= rect.x && bounds.y <= rect.y + rect.height && bounds.y + bounds.height >= rect.y) ids.add(node.id());
    }
    marquee.preview.destroy(); marquee = undefined; selectItems(ids);
    // Keep the background node alive so consecutive clicks can become a double-click.
    showSelection(selectedId ? scene.getChildren().find(child => child.id() === selectedId) as Konva.Shape : undefined);
    renderInspector(); layer.batchDraw();
  }
  if (pan) { pan = undefined; canvas.style.cursor = tool === "pan" ? "grab" : "default"; }
  if (!gesture || !screenshot) return;
  const { start, current, kind } = gesture;
  cancelGesture();
  const rect = kind === "arrow" ? { ...start, width: current.x - start.x, height: current.y - start.y }
    : selectionRect(start, current, kind === "crop" ? { width: screenshot.naturalWidth, height: screenshot.naturalHeight } : undefined);
  if (kind === "arrow" ? Math.hypot(rect.width, rect.height) < 8 : rect.width < 4 || rect.height < 4) return;
  addItem(kind, rect);
}
window.addEventListener("mouseup", endGesture);
window.addEventListener("touchend", endGesture);
window.addEventListener("blur", () => { flushFields(); space = false; cancelGesture(); render(); });
canvas.addEventListener("contextmenu", event => event.preventDefault());
canvas.addEventListener("wheel", event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const bounds = canvas.getBoundingClientRect(); zoomBy(Math.exp(-event.deltaY * .01), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  } else viewport(scene.scaleX(), { x: scene.x() - event.deltaX, y: scene.y() - event.deltaY });
}, { passive: false });

/** Delete through one shared action used by the toolbar and keyboard. */
function removeSelected(): void {
  if (!project || !selectedIds.size || fatal) return;
  project.items = project.items.filter(item => !selectedIds.has(item.id)); selectItems([]); commit();
}

/** Decode new images before asking the host to store them, preserving the draft on invalid input. */
async function insertImage(file: File, mode: "new" | "asset" | "replace"): Promise<void> {
  let url: string | undefined;
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("請選擇 PNG、JPEG 或 WebP 圖片。");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("單張圖片上限為 12 MB。");
    url = URL.createObjectURL(file);
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("單張圖片上限為 1600 萬像素。");
    const retained = [...assets.values()].reduce((sum, asset) => sum + asset.naturalWidth * asset.naturalHeight, 0);
    if (retained + image.naturalWidth * image.naturalHeight > 64_000_000) throw new Error("圖片總像素上限為 6400 萬，請縮小圖片後重試。");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("無法讀取圖片。")); reader.readAsDataURL(file);
    });
    flushFields();
    const x = (stage.width() / 2 - scene.x()) / scene.scaleX(), y = (stage.height() / 2 - scene.y()) / scene.scaleY();
    host.postMessage({ type: "paste", image: data, mode, width: image.naturalWidth, height: image.naturalHeight, x, y });
    el<HTMLDialogElement>("image-dialog").close();
  } catch (error) { toast(`貼上失敗：${error instanceof Error ? error.message : String(error)}`); }
  finally { if (url) URL.revokeObjectURL(url); }
}

/** Text fields retain native paste; selecting the background explicitly opts into replacement. */
window.addEventListener("paste", event => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable) return;
  const file = Array.from(event.clipboardData?.items ?? []).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
  if (!file) return;
  event.preventDefault();
  void insertImage(file, !screenshot ? "new" : backgroundSelected && !el<HTMLDialogElement>("image-dialog").open ? "replace" : "asset");
});

/** Export all content at original pixel scale, with transparent space and an explicit origin offset. */
async function exportImage(): Promise<void> {
  if (!project || !screenshot || exporting || fatal) return;
  flushFields();
  const empty = project.items.find(item => ["note", "comment"].includes(item.kind) && !item.comment.trim());
  if (empty) { selectItems([empty.id]); render(); el("comment").focus(); toast("請先補上區域註解，再匯出給 agent。"); return; }
  exporting = true; el<HTMLButtonElement>("export").disabled = true;
  host.postMessage({ type: "export", sourceWidth: screenshot.naturalWidth, sourceHeight: screenshot.naturalHeight, assetSizes: Object.fromEntries([...assets].map(([name, image]) => [name, { width: image.naturalWidth, height: image.naturalHeight }])) });
}

/** Load immutable screenshot assets once and ignore stale loads after a document replacement. */
window.addEventListener("message", async event => {
  const message = event.data;
  if (message?.type === "settings") {
    handoffPrompt = message.prompt;
    el<HTMLTextAreaElement>("handoff-prompt").value = handoffPrompt;
    if (message.saved) toast("設定已儲存。");
  } else if (message?.type === "promptCopied") {
    toast("已複製交接 prompt 與 SVG 路徑。");
  } else if (message?.type === "selectItem") {
    setTool("select"); selectItems([message.id]); render();
  } else if (message?.type === "state") {
    if (typeof message.ack === "number" && message.ack < revision) return;
    const generation = ++loadGeneration;
    try {
      const next = parseProject(message.project);
      el("save-hint").textContent = message.scratch ? "離開欄位即套用 · 自動暫存" : "離開欄位即套用 · ⌘/Ctrl S 儲存稿件";
      if (!next.image) {
        assets.clear(); project = next; screenshot = undefined; imageUri = ""; selectItems([]); fatal = false;
        cancelGesture(); showSelection(); scene.destroyChildren(); renderInspector(); layer.batchDraw();
        el("empty").hidden = false; el("filename").textContent = "貼上圖片，立即開始編輯";
        el<HTMLButtonElement>("export").disabled = true;
        return;
      }
      const same = screenshot && imageUri === message.imageUri;
      if (!same) {
        const image = new Image(); image.crossOrigin = "anonymous"; image.src = message.imageUri;
        await image.decode();
        if (generation !== loadGeneration) return;
        if (image.naturalWidth * image.naturalHeight > MAX_PIXELS || !image.naturalWidth) throw new Error("截圖上限為 1600 萬像素，請先縮小圖片。");
        screenshot = image; imageUri = message.imageUri;
      }
      const loaded = new Map<string, HTMLImageElement>();
      loaded.set(next.image, screenshot!);
      let pixels = screenshot!.naturalWidth * screenshot!.naturalHeight;
      for (const [name, uri] of Object.entries(message.assetUris ?? {}) as [string, string][]) {
        if (name === next.image) continue;
        let image = assets.get(name);
        if (!image || image.src !== uri) { image = new Image(); image.crossOrigin = "anonymous"; image.src = uri; await image.decode(); }
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("圖片元件尺寸無效或超過 1600 萬像素。");
        pixels += image.naturalWidth * image.naturalHeight;
        if (pixels > 64_000_000) throw new Error("此稿件圖片總像素超過 6400 萬，請減少圖片。");
        loaded.set(name, image);
      }
      if (generation !== loadGeneration) return;
      assets = loaded; project = next; fatal = false;
      selectedIds = new Set([...selectedIds].filter(id => project!.items.some(item => item.id === id)));
      selectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
      el("empty").hidden = true; el("filename").textContent = `${screenshot!.naturalWidth} × ${screenshot!.naturalHeight} · ${message.scratch ? "自動暫存" : "本機稿件"}`;
      el<HTMLButtonElement>("export").disabled = exporting;
      // An acknowledgement confirms the optimistic edit; rebuilding here could interrupt the next gesture.
      if (message.ack === undefined) render();
      if (!same) fit();
    } catch (error) { fatal = true; toast(`無法載入截圖：${error instanceof Error ? error.message : String(error)}`); el<HTMLButtonElement>("export").disabled = true; }
  } else if (message?.type === "error") {
    fatal = Boolean(message.fatal); exporting = false;
    el<HTMLButtonElement>("export").disabled = fatal || !screenshot;
    toast(String(message.message));
  } else if (message?.type === "exported") {
    exporting = false; el<HTMLButtonElement>("export").disabled = false; el<HTMLButtonElement>("copy-prompt").disabled = false; toast("已匯出單一 SVG，包含 original／modified／註解三層。");
  } else if (message?.type === "exportCanceled") {
    exporting = false; el<HTMLButtonElement>("export").disabled = !screenshot;
  }
});

/** Bind accessible controls to the same actions as their keyboard equivalents. */
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool as Tool)));
document.querySelectorAll<HTMLButtonElement>(".toolbar button").forEach(button => {
  button.title ||= button.getAttribute("aria-label") ?? button.textContent ?? "";
  button.dataset.tooltip = button.title;
});
el("toggle-sidebar").addEventListener("click", () => {
  flushFields(); const sidebar = el("sidebar"), button = el("toggle-sidebar");
  sidebar.hidden = !sidebar.hidden;
  button.setAttribute("aria-expanded", String(!sidebar.hidden));
  button.setAttribute("aria-label", sidebar.hidden ? "展開需求欄" : "收起需求欄");
  button.title = button.dataset.tooltip = sidebar.hidden ? "展開需求欄" : "收起需求欄";
});
el("add-comment").addEventListener("click", () => { flushFields(); addItem("comment", { x: 0, y: 0, width: 1, height: 1 }); });
el("delete-many").addEventListener("click", removeSelected);
el("rotate-image").addEventListener("click", () => transformImage("rotate"));
el("flip-image-x").addEventListener("click", () => transformImage("flipX"));
el("flip-image-y").addEventListener("click", () => transformImage("flipY"));
el("new-image").addEventListener("click", () => { flushFields(); el<HTMLDialogElement>("image-dialog").showModal(); });
el("image-dialog-close").addEventListener("click", () => el<HTMLDialogElement>("image-dialog").close());
el("image-file-open").addEventListener("click", () => el<HTMLInputElement>("image-file").click());
el("image-file").addEventListener("change", () => {
  const input = el<HTMLInputElement>("image-file"), file = input.files?.[0];
  if (file) void insertImage(file, screenshot ? "asset" : "new"); input.value = "";
});
el("settings-open").addEventListener("click", () => { flushFields(); el<HTMLTextAreaElement>("handoff-prompt").value = handoffPrompt; el<HTMLDialogElement>("settings").showModal(); });
el("settings-close").addEventListener("click", () => el<HTMLDialogElement>("settings").close());
el("settings-reset").addEventListener("click", () => { el<HTMLTextAreaElement>("handoff-prompt").value = DEFAULT_HANDOFF_PROMPT; });
el("settings-save").addEventListener("click", () => {
  const prompt = el<HTMLTextAreaElement>("handoff-prompt").value;
  if (!prompt.trim()) { toast("交接 prompt 不能為空白。"); return; }
  host.postMessage({ type: "settings", prompt });
});
el("copy-prompt").addEventListener("click", () => host.postMessage({ type: "copyPrompt" }));
/** Pointer capture keeps a pen gesture intact when the cursor leaves the small drawing pad. */
el("sketch").addEventListener("pointerdown", event => {
  const item = selected();
  if (!item || item.kind !== "stamp" || fatal || event.button !== 0 || stroke) return;
  if ((item.strokes?.length ?? 0) >= 100) { toast("圖示最多 100 筆，請清除部分筆畫或復原後再畫。"); return; }
  flushFields();
  const box = el("sketch").getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - box.x) / box.width)), y = Math.max(0, Math.min(1, (event.clientY - box.y) / box.height));
  stroke = { id: item.id, pointerId: event.pointerId, points: [x, y, x, y] };
  el("sketch").setPointerCapture(event.pointerId); event.preventDefault(); drawSketch();
});
el("sketch").addEventListener("pointermove", event => {
  if (!stroke || stroke.pointerId !== event.pointerId || stroke.points.length >= 2000) return;
  const box = el("sketch").getBoundingClientRect();
  stroke.points.push(Math.max(0, Math.min(1, (event.clientX - box.x) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.y) / box.height)));
  drawSketch();
});
el("sketch").addEventListener("pointerup", () => endStroke(true));
el("sketch").addEventListener("pointercancel", () => endStroke(false));
el("sketch").addEventListener("lostpointercapture", () => endStroke(false));
el("sketch-clear").addEventListener("click", () => { const item = selected(); if (item?.kind === "stamp") { item.strokes = []; commit(); } });
el("components").addEventListener("click", openLibrary);
el("library-close").addEventListener("click", () => el<HTMLDialogElement>("library").close());
el("library-search").addEventListener("input", renderLibrary);
el("font-size").addEventListener("change", () => changeFontSize(el<HTMLInputElement>("font-size").valueAsNumber));
el("import").addEventListener("click", () => { flushFields(); host.postMessage({ type: "import" }); });
el("empty-import").addEventListener("click", () => host.postMessage({ type: "import" }));
el("export").addEventListener("click", () => void exportImage());
el("delete").addEventListener("click", removeSelected);
el("fit").addEventListener("click", fit);
el("zoom-in").addEventListener("click", () => zoomBy(1.2));
el("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
el("undo").addEventListener("click", () => { flushFields(); host.postMessage({ type: "undo" }); });
el("redo").addEventListener("click", () => { flushFields(); host.postMessage({ type: "redo" }); });
el("comment").addEventListener("change", flushFields);
el("display-text").addEventListener("change", flushFields);
el("color").addEventListener("change", () => { const item = selected(); if (item) { item.color = el<HTMLInputElement>("color").value; commit(); } });
el("stamp").addEventListener("change", () => { const item = selected(); if (item) { item.text = el<HTMLSelectElement>("stamp").value; commit(); } });

/** Preserve native text-field shortcuts while supporting object movement and document history. */
window.addEventListener("keydown", event => {
  if (event.isComposing || el<HTMLDialogElement>("library").open || el<HTMLDialogElement>("settings").open || el<HTMLDialogElement>("image-dialog").open) return;
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && selected()?.kind === "text" && ["+", "=", "-", "_"].includes(event.key)) {
    event.preventDefault(); flushFields(); changeFontSize((selected()!.fontSize ?? 22) + (["-", "_"].includes(event.key) ? -2 : 2)); return;
  }
  if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); flushFields(); host.postMessage({ type: "save" }); return; }
  if (typing) return;
  if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); flushFields(); host.postMessage({ type: event.shiftKey ? "redo" : "undo" }); return; }
  if (modifier) return;
  if (event.code === "Space") {
    event.preventDefault(); space = true; showSelection();
    scene.getChildren().forEach(node => node.draggable(false)); canvas.style.cursor = "grab"; return;
  }
  if (event.key === "Escape") { cancelGesture(); selectItems([]); setTool("select"); return; }
  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); return; }
  if (selectedIds.size && event.key.startsWith("Arrow")) {
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    for (const item of project!.items.filter(item => selectedIds.has(item.id) && item.kind !== "comment")) {
      if (event.key === "ArrowLeft") item.x -= step; if (event.key === "ArrowRight") item.x += step;
      if (event.key === "ArrowUp") item.y -= step; if (event.key === "ArrowDown") item.y += step;
    }
    commit(); return;
  }
  if (event.key === "0") fit();
  const next = tools.find(([, , key]) => key.toLowerCase() === event.key.toLowerCase());
  if (next) { event.preventDefault(); setTool(next[0]); }
});
window.addEventListener("keyup", event => {
  // Only release a canvas pan that actually started; typing spaces must never reload uncommitted fields.
  if (event.code === "Space" && space) { space = false; canvas.style.cursor = tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair"; render(); }
});

/** Resize the viewport without reallocating screenshot-sized canvases or resetting the user's zoom. */
new ResizeObserver(() => {
  const { width, height } = canvas.getBoundingClientRect();
  const first = stage.width() === 1;
  stage.size({ width: Math.max(1, width), height: Math.max(1, height) });
  if (first && screenshot) fit();
}).observe(canvas);
setTool("note");
el<HTMLButtonElement>("export").disabled = true;
host.postMessage({ type: "ready" });
