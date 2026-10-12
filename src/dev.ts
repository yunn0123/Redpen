/** Browser-only host simulator exercises the shipped editor without requiring a running extension host. */
import { exportSvg } from "./svg";
import { DEFAULT_HANDOFF_PROMPT, agentMarkdown, parseProject, projectAssets, type Project } from "./model";

declare global {
  interface Window {
    redpenTest: { project: Project; deliveredProject?: Project; exports: { svg: string; png: string; markdown: string; width: number; height: number }[]; pastedImages: string[]; copiedPrompt?: string };
  }
}

/** Generate a deterministic raster fixture with a movable colored card and plain background. */
function fixture(): string {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f6f7f9"; ctx.fillRect(0, 0, 1200, 800);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 220, 800); ctx.fillRect(250, 100, 920, 660);
  ctx.fillStyle = "#283442"; ctx.font = "600 24px sans-serif"; ctx.fillText("Planner", 32, 60); ctx.fillText("This week", 280, 65);
  ctx.fillStyle = "#98a3b0"; ctx.font = "16px sans-serif";
  ["Inbox", "Work", "Personal"].forEach((text, index) => ctx.fillText(text, 38, 140 + index * 54));
  ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((text, index) => ctx.fillText(text, 280 + index * 180, 142));
  ctx.fillStyle = "#c8e9df"; ctx.fillRect(280, 180, 160, 54);
  ctx.fillStyle = "#245d4d"; ctx.font = "16px sans-serif"; ctx.fillText("Design review", 296, 212);
  ctx.fillStyle = "#dce7fa"; ctx.fillRect(460, 260, 160, 54);
  ctx.fillStyle = "#3d557e"; ctx.fillText("Weekly planning", 472, 292);
  ctx.fillStyle = "#ebd7ed"; ctx.fillRect(820, 180, 160, 54);
  ctx.fillStyle = "#69516c"; ctx.fillText("Team sync", 836, 212);
  return canvas.toDataURL("image/png");
}

const imageFiles: Record<string, string> = JSON.parse(localStorage.getItem("redpen-demo-assets") ?? localStorage.getItem("ui-feedback-demo-assets") ?? "{}");
imageFiles["sample.png"] ??= fixture();
let project: Project = { version: 1, image: new URLSearchParams(location.search).has("fixture") ? "sample.png" : "", items: [] };
try {
  const saved = localStorage.getItem("redpen-demo") ?? localStorage.getItem("ui-feedback-demo");
  if (saved) project = parseProject(JSON.parse(saved));
} catch { localStorage.removeItem("redpen-demo"); }
let history: Project[] = [structuredClone(project)];
let cursor = 0;
window.redpenTest = { project, exports: [], pastedImages: [] };

/** Simulate asynchronous host acknowledgements so tests can expose optimistic-update races. */
function state(ack?: number): void {
  window.redpenTest.project = structuredClone(project);
  window.postMessage({ type: "state", project: structuredClone(project), imageUri: imageFiles[project.image], assetUris: Object.fromEntries(projectAssets(project).map(name => [name, imageFiles[name]])), scratch: true, ack }, window.location.origin);
}

window.acquireVsCodeApi = () => ({
  async postMessage(message: any) {
    switch (message.type) {
      case "ready":
        window.postMessage({ type: "settings", prompt: localStorage.getItem("handoff-prompt") ?? DEFAULT_HANDOFF_PROMPT }, location.origin);
        state(); break;
      case "settings":
        localStorage.setItem("handoff-prompt", message.prompt);
        window.postMessage({ type: "settings", prompt: message.prompt, saved: true }, location.origin); break;
      case "copyPrompt":
        window.redpenTest.copiedPrompt = (localStorage.getItem("handoff-prompt") ?? DEFAULT_HANDOFF_PROMPT).replaceAll("{svgPath}", "/demo/redpen.svg");
        window.postMessage({ type: "promptCopied" }, location.origin); break;
      case "paste": {
        window.redpenTest.pastedImages.push(message.image);
        const name = `clipboard-${crypto.randomUUID()}.png`; imageFiles[name] = message.image;
        let id: string | undefined;
        if (project.image && message.mode === "asset") {
          id = crypto.randomUUID(); const scale = Math.min(1, 480 / Math.max(message.width, message.height));
          project = { ...project, items: [...project.items, { id, kind: "image", asset: name, x: message.x, y: message.y, width: message.width * scale, height: message.height * scale, color: "#f35e5e", text: "", comment: "" }] };
        } else {
          project = { ...project, image: name, items: project.items.map(item => item.kind === "crop" && !item.asset ? { ...item, asset: project.image } : item) };
        }
        history = history.slice(0, cursor + 1); history.push(structuredClone(project)); cursor++;
        localStorage.setItem("redpen-demo-assets", JSON.stringify(imageFiles));
        localStorage.setItem("redpen-demo", JSON.stringify(project)); state();
        if (id) window.postMessage({ type: "selectItem", id }, location.origin);
        break;
      }
      case "edit":
        project = parseProject(message.project); history = history.slice(0, cursor + 1); history.push(structuredClone(project)); cursor++;
        localStorage.setItem("redpen-demo", JSON.stringify(project)); state(message.revision); break;
      case "undo": if (cursor > 0) { project = structuredClone(history[--cursor]); state(); } break;
      case "redo": if (cursor < history.length - 1) { project = structuredClone(history[++cursor]); state(); } break;
      case "save": localStorage.setItem("redpen-demo", JSON.stringify(project)); break;
      case "import": project = { version: 1, image: "sample.png", items: [] }; history = [structuredClone(project)]; cursor = 0; state(); break;
      case "export": {
        try {
          const images = Object.fromEntries(Object.entries(message.assetSizes ?? {}).map(([name, size]) => [name, { ...(size as { width: number; height: number }), data: imageFiles[name] }]));
          const svg = exportSvg(project, imageFiles[project.image], message.sourceWidth, message.sourceHeight, images);
          const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d")!.drawImage(image, 0, 0);
          window.redpenTest.exports.push({ svg, png: canvas.toDataURL(), width: image.width, height: image.height, markdown: agentMarkdown(project, { ...message, width: image.width, height: image.height }) });
          window.postMessage({ type: "exported" }, window.location.origin);
        } catch (error) { window.postMessage({ type: "error", message: String(error) }, location.origin); }
        break;
      }
    }
  },
});
await import("./editor/editor");

/** Observe delivered state so tests cannot click future coordinates before the editor receives undo/redo. */
window.addEventListener("message", event => {
  if (event.data?.type === "state") window.redpenTest.deliveredProject = structuredClone(event.data.project);
});
