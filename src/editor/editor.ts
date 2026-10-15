/** A screenshot-first canvas keeps editing gestures local and sends only small document changes to VS Code. */
import Konva from "konva";
import { DEFAULT_HANDOFF_PROMPT, MAX_IMAGE_BYTES, MAX_ITEMS, MAX_PIXELS, kindNames, parseProject, selectionRect, type Item, type Kind, type Project, type Rect } from "../model";
import { iconLibrary, componentLibrary, toolbarIcons } from "./library";
import "./editor.css";

declare global { interface Window { acquireVsCodeApi: () => { postMessage: (message: unknown) => void } } }
type Tool = "select" | "pan" | Kind;
type Point = { x: number; y: number };
const host = window.acquireVsCodeApi();
/** Icons are fixed markup; user-supplied content is always assigned through textContent or value. */
function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${toolbarIcons[name] ?? ""}"/></svg>`;
}

const tools: [Tool, string, string][] = [
  ["select", "Select", "V"], ["pan", "Pan", "H"], ["note", "Annotate", "N"], ["cover", "Cover", "M"],
  ["crop", "Copy region", "C"], ["arrow", "Arrow", "A"], ["text", "Text", "T"], ["stamp", "Icon", "I"], ["outline", "Outline", "R"],
];
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="floating-toolbars"><div id="drawing-tools" class="toolbar toolbar-left" role="toolbar" aria-label="Canvas tools">${tools.map(([id, label, key]) => `<button data-tool="${id}" title="${label} (${key})" aria-label="${label}" aria-pressed="false">${icon(id)}<span>${label}</span></button>`).join("")}
    <button id="components" aria-label="Components">${icon("components")}<span>Components</span></button><button id="new-image" aria-label="New image">${icon("image")}<span>New image</span></button><button id="settings-open" aria-label="Settings">${icon("settings")}<span>Settings</span></button><button id="collapse-tools" aria-label="Collapse drawing tools" aria-pressed="false" title="Collapse drawing tools">${icon("collapse")}</button></div><div id="right-panel"><div class="toolbar toolbar-right" role="toolbar" aria-label="Canvas actions"><button id="undo" title="Undo (⌘/Ctrl Z)" aria-label="Undo">${icon("undo")}</button><button id="redo" title="Redo (⌘/Ctrl Shift Z)" aria-label="Redo">${icon("redo")}</button><button id="import" aria-label="Import">${icon("upload")}<span>Import</span></button><button id="export" class="primary" aria-label="Export for Agent">${icon("export")}<span>Export for Agent</span></button><button id="toggle-sidebar" aria-label="Show requests" aria-expanded="false">${icon("sidebar")}</button></div></div></div>
  <main><section class="workspace" aria-label="Screenshot canvas"><div id="canvas" tabindex="0" role="application" aria-label="Screenshot editor. Use tools to select regions, arrow keys to move selected objects, and Delete to remove them."></div>
    <div id="empty"><span class="empty-icon">${icon("crop")}</span><h2>Paste your screenshot</h2><p>Click the canvas and press ⌘ V / Ctrl V to paste.<br>Start editing right away. Export when you are ready.</p><button id="empty-import">Or choose an image file</button></div>
    <div class="canvas-hint" id="hint">Draw a region and describe what you want to change</div>
    <div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">${icon("minus")}</button><span id="zoom" aria-live="polite">100%</span><button id="zoom-in" aria-label="Zoom in">${icon("plus")}</button><span class="divider"></span><button id="fit" title="Fit to view (0)" aria-label="Fit to view">${icon("fit")}</button></div>
  <div id="comment-markers" aria-label="Canvas comments"></div>
    <section id="comment-popover" role="dialog" aria-modal="false" aria-labelledby="popover-title" hidden>
      <div class="popover-heading"><strong id="popover-title"></strong><button id="popover-close" aria-label="Close comment">${icon("close")}</button></div>
      <label for="popover-comment">Request<textarea id="popover-comment" maxlength="8000" rows="2" placeholder="Describe what should change…"></textarea></label>
      <div class="popover-footer"><small>Leave field to apply</small><button id="popover-details">More options</button></div>
    </section>
  </section><aside id="sidebar" aria-label="Requests" hidden><div class="aside-heading"><h2>Requests</h2><div><button id="add-comment" aria-label="Add general request" title="Add a request without a specific location">${icon("plus")}</button><span id="count">0</span></div></div><p id="selection-summary" hidden></p><button id="delete-many" hidden>Delete selected objects</button><p id="background-hint" hidden>Background selected. Paste to replace it. Existing objects keep their positions and sizes.</p>
    <p class="aside-description">Select a region and describe its appearance or behavior.</p>
    <section id="inspector" hidden><div class="inspector-heading"><strong id="selection-title"></strong><button id="delete" class="danger" title="Delete object" aria-label="Delete object">${icon("trash")}</button></div>
      <div id="image-actions" hidden><button id="rotate-image">Rotate 90°</button><button id="flip-image-x">Flip horizontal</button><button id="flip-image-y">Flip vertical</button></div>
      <label id="text-label" hidden>Display text<input id="display-text" maxlength="2000"></label>
      <label id="font-label" hidden>Font size · ⌘/Ctrl + / −<input id="font-size" type="number" min="8" max="200" step="2" value="22"></label>
      <label id="stamp-label" hidden>Icon<select id="stamp"><option value="placeholder">Gray circle · Icon placeholder</option><option value="+">＋ Add</option><option value="✓">✓ Done</option><option value="×">× Close</option><option value="!">! Alert</option><option value="?">? Help</option><option value="★">★ Star</option>${iconLibrary.map(entry => `<option value="icon:${entry.id}">${entry.name}</option>`).join("")}</select></label>
      <section id="sketch-panel" hidden><label>Sketch an icon<canvas id="sketch" width="200" height="160" aria-label="Icon sketch area"></canvas></label><button id="sketch-clear">Clear strokes</button><small>You can also describe the icon in the request below.</small></section>
      <label id="color-label">Color<input id="color" type="color" value="#f35e5e"></label>
      <label for="comment">Request<textarea id="comment" maxlength="8000" rows="5" placeholder="For example: Show a + button on hover. Clicking it adds an editable item."></textarea></label>
      <span class="field-hint" id="save-hint">Leave field to apply · Autosaved</span>
    </section><div id="item-list"></div><div id="notes-empty"><span>01</span><p>Give every change a place</p><small>Use Annotate, or select an object on the canvas.</small></div>
    <div class="aside-footer"><span id="filename">Original preserved · Export when ready</span></div></aside></main>
  <dialog id="image-dialog" aria-labelledby="image-dialog-title"><div class="library-heading"><h2 id="image-dialog-title">Add an image</h2><button id="image-dialog-close" aria-label="Close image dialog">${icon("close")}</button></div><p>Choose an image or paste with ⌘ V / Ctrl V. You can move, rotate, and flip it on the canvas.</p><button id="image-file-open" class="primary">Choose an image file</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></dialog>
  <dialog id="library" aria-labelledby="library-title"><div class="library-heading"><h2 id="library-title"></h2><button id="library-close" aria-label="Close library">${icon("close")}</button></div><input id="library-search" type="search" aria-label="Search components" placeholder="Search by name or purpose"><div id="library-results"></div></dialog>
  <dialog id="settings" aria-labelledby="settings-title"><div class="library-heading"><h2 id="settings-title">Settings</h2><button id="settings-close" aria-label="Close settings">${icon("close")}</button></div><label>Copy handoff prompt<textarea id="handoff-prompt" maxlength="4000" rows="7"></textarea></label><p>Use {svgPath} for the exported SVG path. If omitted, the path is appended automatically.</p><div class="settings-actions"><button id="settings-reset">Reset to default</button><button id="settings-save" class="primary">Save settings</button><button id="copy-prompt" disabled>Copy handoff prompt</button></div><p>Export a single SVG with original, modified, and annotations layers. Use Import to reopen an SVG exported by redpen.</p></dialog>
  <div id="toast" role="status" aria-live="polite" hidden></div>`;

/** Resolve a fixed editor element once its template has been mounted. */
function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }

// Keep Requests attached to its action bar without taking space from the canvas.
el("right-panel").append(el("sidebar"));

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
let popoverId: string | undefined;
let popoverTimer: ReturnType<typeof setTimeout> | undefined;
const commentMarkers = new Map<string, HTMLButtonElement>();

/** Keep transient feedback readable without interrupting a canvas gesture. */
function toast(message: string): void {
  el("toast").textContent = `redpen: ${message}`;
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
  if (!(selected()?.strokes?.length || stroke)) {
    ctx.fillStyle = "#d1d5db"; ctx.beginPath(); ctx.arc(100, 80, 72, 0, Math.PI * 2); ctx.fill();
  }
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
  if (!Number.isFinite(size)) { toast("Enter a font size from 8 to 200."); return; }
  item.fontSize = Math.max(8, Math.min(200, Math.round(size)));
  commit();
}

/** Open one searchable catalog; choosing a result arms the next canvas gesture. */
function openLibrary(): void {
  flushFields();
  el("library-title").textContent = "Components";
  el<HTMLInputElement>("library-search").value = "";
  renderLibrary();
  el<HTMLDialogElement>("library").showModal();
  el("library-search").focus();
}

/** Render trusted local vector previews and search component names and descriptions. */
function renderLibrary(): void {
  const query = el<HTMLInputElement>("library-search").value.trim().toLowerCase();
  const results = el("library-results"); results.replaceChildren();
  const entries = componentLibrary.map(entry => ({ name: entry.name, description: entry.description, preview: entry.skeleton, value: entry.name }));
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
      pendingComponent = entry.value; el("hint").textContent = `${entry.name}: Draw a region for this component, then describe its behavior`;
      canvas.focus();
    });
    results.append(button);
  }
  if (!results.childElementCount) results.textContent = "No matches. Try another keyword.";
}

/** Commit complete gestures as one native undo step; pointer motion stays out of document history. */
function commit(): void {
  if (!project || fatal) return;
  host.postMessage({ type: "edit", project: structuredClone(project), revision: ++revision });
  render();
}

/** Save edited fields before selection, export, or keyboard commands read the current draft. */
function flushFields(): void {
  savePopover();
  const item = selected();
  if (!item || fatal) return;
  const comment = el<HTMLTextAreaElement>("comment").value;
  const text = item.kind === "text" ? el<HTMLInputElement>("display-text").value : item.text;
  if (item.comment !== comment || item.text !== text) { item.comment = comment; item.text = text; commit(); }
}

/** Keep sidebar visibility explicit; closing it never discards pending requests. */
function showSidebar(visible: boolean): void {
  el("sidebar").hidden = !visible;
  el("right-panel").classList.toggle("requests-open", visible);
  const button = el("toggle-sidebar");
  button.setAttribute("aria-expanded", String(visible));
  button.setAttribute("aria-label", visible ? "Hide requests" : "Show requests");
  button.title = button.dataset.tooltip = visible ? "Hide requests" : "Show requests";
}

/** Collapse is a remembered preference; hover and keyboard focus temporarily reveal every tool. */
function collapseTools(collapsed: boolean): void {
  el("drawing-tools").classList.toggle("is-collapsed", collapsed);
  const button = el("collapse-tools");
  button.setAttribute("aria-pressed", String(collapsed));
  button.setAttribute("aria-label", collapsed ? "Keep drawing tools expanded" : "Collapse drawing tools");
  button.title = button.dataset.tooltip = collapsed ? "Keep drawing tools expanded" : "Collapse drawing tools";
}

/** Save a floating request through the same document history as the sidebar. */
function savePopover(): void {
  const item = project?.items.find(entry => entry.id === popoverId);
  if (!item || fatal) return;
  const value = el<HTMLTextAreaElement>("popover-comment").value;
  if (item.comment === value) return;
  item.comment = value;
  if (selectedId === item.id) el<HTMLTextAreaElement>("comment").value = value;
  commit();
}

/** Close without losing text; Escape and the close button share this path. */
function closePopover(): void {
  clearTimeout(popoverTimer);
  savePopover();
  popoverId = undefined;
  el("comment-popover").hidden = true;
  commentMarkers.forEach(button => button.setAttribute("aria-expanded", "false"));
}

/** Delay dismissal so the pointer can cross from a marker into its editable card. */
function deferPopoverClose(): void {
  clearTimeout(popoverTimer);
  popoverTimer = setTimeout(() => {
    if (!el("comment-popover").contains(document.activeElement)) closePopover();
  }, 250);
}

/** Hover previews never steal keyboard focus or replace text being actively composed. */
function openPopover(id: string, focus = false): void {
  if (fatal || gesture || pan || moving || marquee || space) return;
  const field = el<HTMLTextAreaElement>("popover-comment");
  if (!focus && document.activeElement?.matches("input, textarea, select")) return;
  if (!focus && popoverId !== id && el("comment-popover").contains(document.activeElement)) return;
  clearTimeout(popoverTimer);
  if (popoverId !== id) {
    flushFields();
    popoverId = id;
    const item = project?.items.find(entry => entry.id === id);
    if (!item) { closePopover(); return; }
    field.value = item.comment;
  }
  el("comment-popover").hidden = false;
  renderComments();
  if (focus) field.focus();
}

/** Anchor HTML comments to screenshot coordinates while keeping controls at a readable screen size. */
function positionComments(): void {
  const scale = scene.scaleX();
  const nodes = new Map(scene.getChildren().map(node => [node.id(), node]));
  for (const item of project?.items ?? []) {
    const button = commentMarkers.get(item.id);
    if (!button) continue;
    const node = nodes.get(item.id);
    const x = scene.x() + ((node?.x() ?? item.x) + Math.max(0, item.width)) * scale;
    const y = scene.y() + ((node?.y() ?? item.y) + Math.min(0, item.height)) * scale - 32;
    button.style.left = `${x}px`; button.style.top = `${y}px`;
    button.hidden = x < 0 || y < 0 || x > stage.width() - 42 || y > stage.height() - 28;
    button.setAttribute("aria-expanded", String(popoverId === item.id));
    if (popoverId !== item.id) continue;
    const popup = el("comment-popover");
    const width = popup.offsetWidth, height = popup.offsetHeight;
    const left = x + 48 + width <= stage.width() - 8 ? x + 48 : x - width - 8;
    popup.style.left = `${Math.max(8, Math.min(stage.width() - width - 8, left))}px`;
    popup.style.top = `${Math.max(72, Math.min(stage.height() - height - 8, y))}px`;
  }
}

/** Reuse marker buttons across edits to preserve pointer and keyboard focus. */
function renderComments(): void {
  const items = project?.items ?? [];
  for (const [id, button] of commentMarkers) {
    if (!items.some(item => item.id === id && item.kind !== "comment")) { button.remove(); commentMarkers.delete(id); }
  }
  items.forEach((item, index) => {
    if (item.kind === "comment") return;
    let button = commentMarkers.get(item.id);
    if (!button) {
      button = document.createElement("button");
      button.className = "comment-marker"; button.dataset.itemId = item.id;
      button.innerHTML = `${icon("note")}<span></span>`;
      button.setAttribute("aria-controls", "comment-popover");
      button.addEventListener("mouseenter", () => openPopover(item.id));
      button.addEventListener("mouseleave", deferPopoverClose);
      button.addEventListener("focus", () => openPopover(item.id));
      button.addEventListener("click", () => openPopover(item.id, true));
      commentMarkers.set(item.id, button); el("comment-markers").append(button);
    }
    button.querySelector("span")!.textContent = String(index + 1);
    button.setAttribute("aria-label", `Comment ${index + 1}: ${item.component ?? kindNames[item.kind]}`);
  });
  const item = items.find(entry => entry.id === popoverId);
  if (!item) { popoverId = undefined; el("comment-popover").hidden = true; }
  else {
    el("popover-title").textContent = `${items.indexOf(item) + 1} · ${item.component ?? kindNames[item.kind]}`;
    if (document.activeElement !== el("popover-comment")) el<HTMLTextAreaElement>("popover-comment").value = item.comment;
  }
  positionComments();
}

/** The inspector and list expose all annotations to keyboard and assistive technology users. */
function renderInspector(): void {
  const item = selected();
  el("count").textContent = String(project?.items.length ?? 0);
  el("notes-empty").hidden = Boolean(project?.items.length);
  el("inspector").hidden = !item;
  el("selection-summary").hidden = selectedIds.size < 2;
  el("selection-summary").textContent = `${selectedIds.size} objects selected · Drag to move, ⌘/Ctrl-click to deselect`;
  el("delete-many").hidden = selectedIds.size < 2;
  el("background-hint").hidden = !backgroundSelected;
  el<HTMLButtonElement>("add-comment").disabled = !screenshot;
  el("image-actions").hidden = !item || !["image", "crop"].includes(item.kind);
  if (item) {
    const index = project!.items.indexOf(item) + 1;
    el("selection-title").textContent = `${String(index).padStart(2, "0")} · ${item.component ? `Component note · ${item.component}` : kindNames[item.kind]}`;
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
    title.textContent = entry.component ? `Component note · ${entry.component}` : kindNames[entry.kind];
    const summary = document.createElement("small");
    summary.textContent = entry.comment || iconLibrary.find(icon => `icon:${icon.id}` === entry.text)?.name || entry.text || "Click to add a request";
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
    case "text": return new Konva.Text({ ...base, text: item.text || "Text", fill: item.color, fontSize: item.fontSize ?? 22, align: "center", verticalAlign: "middle", fontFamily: "sans-serif", lineHeight: 1.3, wrap: "word" });
    case "stamp": {
      if (item.text === "placeholder") {
        const group = new Konva.Group(base);
        if (!item.strokes?.length) group.add(new Konva.Circle({ x: item.width / 2, y: item.height / 2, radius: Math.min(item.width, item.height) / 2, fill: "#d1d5db" }));
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
      closePopover();
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
      positionComments();
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
  renderInspector(); renderComments(); layer.draw();
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
    select: "Drag to select · ⌘/Ctrl-click to toggle · Delete to remove · Double-click the background to replace it", pan: "Drag to pan · ⌘/Ctrl + scroll to zoom",
    note: "Draw a region and describe what you want to change", cover: "Draw a cover, then choose its fill color", crop: "Select a region of the original, then drag the copy to a new position",
    image: "Add an image object", comment: "A general request without a specific location",
    arrow: "Drag an arrow to point to a location or show movement", text: "Click to add text", stamp: "Click to add a placeholder, then describe or sketch the icon in the sidebar", outline: "Draw an outline to highlight an area; no annotation needed",
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
  positionComments();
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

/** Retain the active creation tool for repeated drawing and source geometry for agent notes. */
function addItem(kind: Kind, rect: Rect): void {
  if (!project || fatal) return;
  if (project.items.length >= MAX_ITEMS) { toast(`Each draft supports up to ${MAX_ITEMS} objects.`); return; }
  const item: Item = {
    ...rect, id: crypto.randomUUID(), kind, color: kind === "cover" ? backgroundColor(rect) : "#f35e5e",
    text: kind === "text" ? "Text" : kind === "stamp" ? "placeholder" : "", comment: "",
    ...(kind === "text" ? { fontSize: 22 } : {}),
    ...(kind === "note" && pendingComponent ? { component: pendingComponent } : {}),
    ...(kind === "crop" ? { source: { ...rect }, x: rect.x + 16, y: rect.y + 16 } : {}),
  };
  project.items.push(item); selectItems([item.id]); commit();
  if (kind === "note" && el("sidebar").hidden) openPopover(item.id, true);
  else {
    showSidebar(true);
    if (kind === "note" || kind === "stamp" || kind === "comment") el<HTMLTextAreaElement>("comment").focus();
  }
  if (kind === "text") { el<HTMLInputElement>("display-text").focus(); el<HTMLInputElement>("display-text").select(); }
}

/** Start one creation or panning gesture; selection remains handled by object nodes. */
stage.on("mousedown touchstart", event => {
  closePopover();
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
  if (pan) { pan = undefined; canvas.style.cursor = tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair"; }
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
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Each image must be 12 MB or smaller.");
    url = URL.createObjectURL(file);
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("Each image must be 16 million pixels or smaller.");
    const retained = [...assets.values()].reduce((sum, asset) => sum + asset.naturalWidth * asset.naturalHeight, 0);
    if (retained + image.naturalWidth * image.naturalHeight > 64_000_000) throw new Error("Images exceed the 64 million pixel total limit. Resize them and try again.");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the image.")); reader.readAsDataURL(file);
    });
    flushFields();
    const x = (stage.width() / 2 - scene.x()) / scene.scaleX(), y = (stage.height() / 2 - scene.y()) / scene.scaleY();
    host.postMessage({ type: "paste", image: data, mode, width: image.naturalWidth, height: image.naturalHeight, x, y });
    el<HTMLDialogElement>("image-dialog").close();
  } catch (error) { toast(`Paste failed: ${error instanceof Error ? error.message : String(error)}`); }
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
  if (empty) { selectItems([empty.id]); render(); if (empty.kind === "comment") { showSidebar(true); el("comment").focus(); } else openPopover(empty.id, true); toast("Fill in the region annotations before exporting for your agent."); return; }
  exporting = true; el<HTMLButtonElement>("export").disabled = true;
  host.postMessage({ type: "export", sourceWidth: screenshot.naturalWidth, sourceHeight: screenshot.naturalHeight, assetSizes: Object.fromEntries([...assets].map(([name, image]) => [name, { width: image.naturalWidth, height: image.naturalHeight }])) });
}

/** Load immutable screenshot assets once and ignore stale loads after a document replacement. */
window.addEventListener("message", async event => {
  const message = event.data;
  if (message?.type === "settings") {
    if (typeof message.toolbarCollapsed === "boolean") collapseTools(message.toolbarCollapsed);
    handoffPrompt = message.prompt;
    el<HTMLTextAreaElement>("handoff-prompt").value = handoffPrompt;
    if (message.saved) toast("Settings saved.");
  } else if (message?.type === "promptCopied") {
    toast("Handoff prompt and SVG path copied.");
  } else if (message?.type === "selectItem") {
    setTool("select"); selectItems([message.id]); render(); showSidebar(true);
  } else if (message?.type === "state") {
    if (typeof message.ack === "number" && message.ack < revision) return;
    const generation = ++loadGeneration;
    try {
      const next = parseProject(message.project);
      el("save-hint").textContent = message.scratch ? "Leave field to apply · Autosaved" : "Leave field to apply · ⌘/Ctrl S to save";
      if (!next.image) {
        assets.clear(); project = next; screenshot = undefined; imageUri = ""; selectItems([]); fatal = false;
        cancelGesture(); showSelection(); scene.destroyChildren(); renderInspector(); renderComments(); layer.batchDraw();
        el("empty").hidden = false; el("filename").textContent = "Paste an image to start editing";
        el<HTMLButtonElement>("export").disabled = true;
        return;
      }
      const same = screenshot && imageUri === message.imageUri;
      if (!same) {
        const image = new Image(); image.crossOrigin = "anonymous"; image.src = message.imageUri;
        await image.decode();
        if (generation !== loadGeneration) return;
        if (image.naturalWidth * image.naturalHeight > MAX_PIXELS || !image.naturalWidth) throw new Error("The screenshot exceeds 16 million pixels. Resize it first.");
        screenshot = image; imageUri = message.imageUri;
      }
      const loaded = new Map<string, HTMLImageElement>();
      loaded.set(next.image, screenshot!);
      let pixels = screenshot!.naturalWidth * screenshot!.naturalHeight;
      for (const [name, uri] of Object.entries(message.assetUris ?? {}) as [string, string][]) {
        if (name === next.image) continue;
        let image = assets.get(name);
        if (!image || image.src !== uri) { image = new Image(); image.crossOrigin = "anonymous"; image.src = uri; await image.decode(); }
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error("The image dimensions are invalid or exceed 16 million pixels.");
        pixels += image.naturalWidth * image.naturalHeight;
        if (pixels > 64_000_000) throw new Error("Images in this draft exceed 64 million pixels in total. Remove some images.");
        loaded.set(name, image);
      }
      if (generation !== loadGeneration) return;
      assets = loaded; project = next; fatal = false;
      selectedIds = new Set([...selectedIds].filter(id => project!.items.some(item => item.id === id)));
      selectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
      el("empty").hidden = true; el("filename").textContent = `${screenshot!.naturalWidth} × ${screenshot!.naturalHeight} · ${message.scratch ? "Autosaved" : "Local draft"}`;
      el<HTMLButtonElement>("export").disabled = exporting;
      // An acknowledgement confirms the optimistic edit; rebuilding here could interrupt the next gesture.
      if (message.ack === undefined) render();
      if (!same) fit();
    } catch (error) { fatal = true; toast(`Could not load the screenshot: ${error instanceof Error ? error.message : String(error)}`); el<HTMLButtonElement>("export").disabled = true; }
  } else if (message?.type === "error") {
    fatal = Boolean(message.fatal); exporting = false;
    el<HTMLButtonElement>("export").disabled = fatal || !screenshot;
    toast(String(message.message));
  } else if (message?.type === "exported") {
    exporting = false; el<HTMLButtonElement>("export").disabled = false; el<HTMLButtonElement>("copy-prompt").disabled = false; toast("Exported one SVG with original, modified, and annotations layers.");
  } else if (message?.type === "exportCanceled") {
    exporting = false; el<HTMLButtonElement>("export").disabled = !screenshot;
  }
});

/** Bind accessible controls to the same actions as their keyboard equivalents. */
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach(button => button.addEventListener("click", () => { setTool(button.dataset.tool as Tool); canvas.focus(); }));
document.querySelectorAll<HTMLButtonElement>(".toolbar button").forEach(button => {
  button.title ||= button.getAttribute("aria-label") ?? button.textContent ?? "";
  button.dataset.tooltip = button.title;
});
el("collapse-tools").addEventListener("click", () => {
  const collapsed = !el("drawing-tools").classList.contains("is-collapsed");
  collapseTools(collapsed); canvas.focus();
  host.postMessage({ type: "toolbarPreference", collapsed });
});
el("toggle-sidebar").addEventListener("click", () => { flushFields(); showSidebar(Boolean(el("sidebar").hidden)); });
/** A focused popup stays open while typing, including IME composition and pointer travel. */
el("comment-popover").addEventListener("mouseenter", () => clearTimeout(popoverTimer));
el("comment-popover").addEventListener("mouseleave", deferPopoverClose);
el("popover-comment").addEventListener("change", savePopover);
el("popover-comment").addEventListener("blur", savePopover);
el("popover-close").addEventListener("click", () => { closePopover(); canvas.focus(); });
el("comment-popover").addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.isComposing) { event.stopPropagation(); closePopover(); canvas.focus(); }
});
el("popover-details").addEventListener("click", () => {
  const id = popoverId; closePopover();
  if (id) { setTool("select"); selectItems([id]); showSidebar(true); render(); el("comment").focus(); }
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
  if (!prompt.trim()) { toast("The handoff prompt cannot be empty."); return; }
  host.postMessage({ type: "settings", prompt });
});
el("copy-prompt").addEventListener("click", () => host.postMessage({ type: "copyPrompt" }));
/** Pointer capture keeps a pen gesture intact when the cursor leaves the small drawing pad. */
el("sketch").addEventListener("pointerdown", event => {
  const item = selected();
  if (!item || item.kind !== "stamp" || fatal || event.button !== 0 || stroke) return;
  if ((item.strokes?.length ?? 0) >= 100) { toast("Icons support up to 100 strokes. Clear strokes or undo before drawing more."); return; }
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
  positionComments();
}).observe(canvas);
setTool("note");
el<HTMLButtonElement>("export").disabled = true;
host.postMessage({ type: "ready" });
