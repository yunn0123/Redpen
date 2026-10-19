/** VS Code owns file access and document history; the webview only edits validated draft data. */
import { exportSvg, readRedpenSvg } from "./svg";
import { appendIgnoreRule, exportedIgnoreTarget } from "./gitignore";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { DEFAULT_HANDOFF_PROMPT, MAX_IMAGE_BYTES, MAX_ITEMS, MAX_PIXELS, parseProject, projectAssets, type Project } from "./model";

const viewType = "redpen.editor";
const encoder = new TextEncoder();
type Screenshot = { bytes: Uint8Array; extension: string };

/** Bound clipboard payloads before decoding; browser-side image decoding checks the actual raster. */
function pastedScreenshot(value: unknown): Screenshot {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error("Screenshots must be 12 MB or smaller.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Paste a PNG, JPEG, or WebP image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("The image is invalid or exceeds 12 MB.");
  return { bytes, extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

/** Surface actionable errors without losing an open draft. */
function report(error: unknown): void {
  void vscode.window.showErrorMessage(`redpen: ${error instanceof Error ? error.message : String(error)}`);
}

/** Only change repository ignore rules after explicit consent; export success stays independent. */
async function offerGitIgnore(target: vscode.Uri): Promise<void> {
  if (target.scheme !== "file") return;
  const candidate = await exportedIgnoreTarget(target.fsPath);
  if (!candidate) return;
  const action = await vscode.window.showInformationMessage(
    `redpen: Add ${candidate.path} to this repository's .gitignore?`, "Add to .gitignore", "Not now",
  );
  if (action !== "Add to .gitignore") return;
  // Recheck after the prompt in case another export or Git operation changed the rules.
  if (!await exportedIgnoreTarget(target.fsPath)) return;
  const uri = vscode.Uri.file(candidate.root + "/.gitignore");
  let exists = true;
  try { await vscode.workspace.fs.stat(uri); }
  catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
    exists = false;
  }
  const edit = new vscode.WorkspaceEdit();
  if (exists) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) throw new Error("Save .gitignore first, then export again to add the SVG.");
    edit.insert(uri, document.positionAt(document.getText().length), appendIgnoreRule(document.getText(), candidate.path));
  } else {
    edit.createFile(uri, { overwrite: false });
    edit.insert(uri, new vscode.Position(0, 0), appendIgnoreRule("", candidate.path));
  }
  if (!await vscode.workspace.applyEdit(edit) || !await (await vscode.workspace.openTextDocument(uri)).save()) {
    throw new Error("Could not save .gitignore. The SVG was exported successfully.");
  }
  void vscode.window.showInformationMessage(`redpen: Added ${candidate.path} to .gitignore.`);
}

/** Register the screenshot entry point and the persisted JSON editor. */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new RedpenEditor(context.extensionUri, vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, "canvases"), context.globalState);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(viewType, provider, { supportsMultipleEditorsPerDocument: false }),
    vscode.commands.registerCommand("redpen.open", (uri?: vscode.Uri) => provider.create(uri).catch(report)),
    vscode.commands.registerCommand("redpen.showGuide", async () => {
      // VSIX packaging normalizes README.md to readme.md on case-sensitive filesystems.
      try {
        const entries = await vscode.workspace.fs.readDirectory(context.extensionUri);
        const filename = entries.find(([name]) => name.toLowerCase() === "readme.md")?.[0];
        if (!filename) throw new Error("The getting started guide is missing. Reinstall redpen and try again.");
        await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.joinPath(context.extensionUri, filename));
      } catch (error) { report(error); }
    }),
  );
}

/** Keep all filesystem operations in the extension host instead of granting the canvas broad access. */
class RedpenEditor implements vscode.CustomTextEditorProvider {
  private readonly canvasTitles = new Map<string, string>();

  /** Retain the extension directory for scoped script and stylesheet URLs. */
  constructor(private readonly extensionUri: vscode.Uri, private readonly cacheUri: vscode.Uri, private readonly settings: vscode.Memento) {}

  /** Read a selected file without asking the user to name or save a draft first. */
  private async readScreenshot(source: vscode.Uri): Promise<Screenshot> {
    if (!/\.(png|jpe?g|webp)$/i.test(source.path)) throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
    const stat = await vscode.workspace.fs.stat(source);
    if (stat.size > MAX_IMAGE_BYTES) throw new Error("The screenshot exceeds 12 MB. Resize it first.");
    const bytes = await vscode.workspace.fs.readFile(source);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Screenshots must be 12 MB or smaller.");
    return { bytes, extension: posix.extname(source.path).slice(1).toLowerCase() };
  }

  /** Store each image once so undo history contains geometry rather than repeated image data. */
  private async storeScreenshot(directory: vscode.Uri, screenshot: Screenshot): Promise<string> {
    const name = `screenshot-${randomUUID()}.${screenshot.extension}`;
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, name), screenshot.bytes);
    return name;
  }

  /** Open an immediately usable canvas backed by private storage, without any save dialog. */
  async create(source?: vscode.Uri, screenshot?: Screenshot): Promise<void> {
    let items: Project["items"] = [];
    await vscode.workspace.fs.createDirectory(this.cacheUri);
    let importedBase: string | undefined;
    const renamed: Record<string, string> = {};
    if (source && /\.svg$/i.test(source.path)) {
      if ((await vscode.workspace.fs.stat(source)).size > 75_000_000) throw new Error("The SVG draft is too large.");
      const imported = readRedpenSvg(new TextDecoder().decode(await vscode.workspace.fs.readFile(source)));
      screenshot = pastedScreenshot(imported.source); items = imported.project.items; importedBase = imported.project.image;
      for (const [name, asset] of Object.entries(imported.images ?? {})) renamed[name] = await this.storeScreenshot(this.cacheUri, pastedScreenshot(asset.data));
    } else if (source) screenshot = await this.readScreenshot(source);
    const target = vscode.Uri.joinPath(this.cacheUri, `canvas-${randomUUID().slice(0, 8)}.redpen.json`);
    const image = screenshot ? await this.storeScreenshot(this.cacheUri, screenshot) : "";
    if (importedBase) renamed[importedBase] = image;
    items = items.map(item => item.asset ? { ...item, asset: renamed[item.asset] } : item);
    const serialized = JSON.stringify({ version: 1, image, items }, null, 2);
    if (serialized.length > 3_000_000) throw new Error("The draft is too large. Remove some objects or text.");
    await vscode.workspace.fs.writeFile(target, encoder.encode(serialized));
    await vscode.commands.executeCommand("vscode.openWith", target, viewType);
  }

  /** Synchronize edits through TextDocument so VS Code handles saves, undo, and hot-exit backups. */
  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const webview = panel.webview;
    const key = document.uri.toString();
    if (!this.canvasTitles.has(key)) this.canvasTitles.set(key, `redpen Canvas ${this.canvasTitles.size + 1}`);
    panel.title = this.canvasTitles.get(key)!;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "docs", "images", "redpen-logo.png");
    const directory = vscode.Uri.joinPath(document.uri, "..");
    const scratch = directory.toString() === this.cacheUri.toString();
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), directory] };
    let lastExport: vscode.Uri | undefined;
    let applying = false;
    let disposed = false;
    let queue = Promise.resolve();
    const disposables: vscode.Disposable[] = [];

    /** Bound document parsing and reject broken drafts while leaving the original file intact. */
    const read = (): Project => {
      if (document.getText().length > 3_000_000) throw new Error("The draft is too large. Remove some objects or text.");
      return parseProject(JSON.parse(document.getText()));
    };
    /** Send only validated document data and scoped screenshot URLs to the canvas. */
    const sendState = async (ack?: number): Promise<void> => {
      if (disposed) return;
      try {
        const project = read();
        if (!project.image) { await webview.postMessage({ type: "state", project, scratch, ack }); return; }
        const uri = vscode.Uri.joinPath(directory, project.image);
        if ((await vscode.workspace.fs.stat(uri)).size > MAX_IMAGE_BYTES) throw new Error("Screenshots must be 12 MB or smaller.");
        const assetUris: Record<string, string> = {};
        let bytes = 0;
        for (const name of projectAssets(project)) {
          const assetUri = vscode.Uri.joinPath(directory, name);
          const size = (await vscode.workspace.fs.stat(assetUri)).size;
          if (size > MAX_IMAGE_BYTES) throw new Error("Each image must be 12 MB or smaller.");
          bytes += size;
          if (bytes > 48 * 1024 * 1024) throw new Error("Images in this draft exceed 48 MB in total.");
          assetUris[name] = webview.asWebviewUri(assetUri).toString();
        }
        await webview.postMessage({ type: "state", project, assetUris, imageUri: webview.asWebviewUri(uri).toString(), scratch, ack });
      } catch (error) {
        await webview.postMessage({ type: "error", fatal: true, message: `Could not load the draft: ${error instanceof Error ? error.message : String(error)}` });
      }
    };

    /** Use the document's native undo stack and silently save canvases in private storage. */
    const apply = async (project: Project, ack?: number): Promise<void> => {
      const serialized = JSON.stringify(project, null, 2);
      if (serialized.length > 3_000_000) throw new Error("The draft is too large. Remove some strokes or text and try again.");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), serialized);
      applying = true;
      try {
        if (!await vscode.workspace.applyEdit(edit)) throw new Error("Could not apply changes. Please try again.");
        if (scratch && !await document.save()) throw new Error("Autosave failed. Keep this tab open and try again.");
      } finally { applying = false; }
      await sendState(ack);
    };

    /** Add immutable image assets or replace only the background; retained files make undo lossless. */
    const insert = async (screenshot: Screenshot, mode: unknown = "new", geometry?: Record<string, unknown>): Promise<void> => {
      const current = read();
      if (current.image && mode === "new") { await this.create(undefined, screenshot); return; }
      if (mode !== "new" && mode !== "replace" && mode !== "asset") throw new Error("The image insertion mode is invalid.");
      let totalBytes = screenshot.bytes.byteLength;
      for (const name of projectAssets(current)) totalBytes += (await vscode.workspace.fs.stat(vscode.Uri.joinPath(directory, name))).size;
      if (totalBytes > 48 * 1024 * 1024) throw new Error("Images exceed the 48 MB total limit. Resize them and try again.");
      if (mode === "asset" && current.image) {
        const width = geometry?.width, height = geometry?.height, x = geometry?.x, y = geometry?.y;
        if (typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS
          || typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new Error("The image object dimensions or position are invalid.");
        if (current.items.length >= MAX_ITEMS) throw new Error("The object limit has been reached.");
        const asset = await this.storeScreenshot(directory, screenshot);
        const scale = Math.min(1, 480 / Math.max(width, height));
        const id = randomUUID();
        current.items.push({ id, kind: "image", asset, x, y, width: width * scale, height: height * scale, color: "#f35e5e", text: "", comment: "" });
        await apply(current); await webview.postMessage({ type: "selectItem", id }); return;
      }
      const image = await this.storeScreenshot(directory, screenshot);
      const items = current.items.map(item => item.kind === "crop" && !item.asset ? { ...item, asset: current.image } : item);
      await apply({ ...current, image, items });
    };

    disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length && !applying) {
        void sendState();
        if (scratch) void document.save().then(saved => { if (!saved) report(new Error("Autosave failed. Keep this tab open.")); }, report);
      }
    }));
    disposables.push(webview.onDidReceiveMessage(message => {
      // Serialize mutations so quick gestures cannot overwrite a newer document edit.
      queue = queue.then(async () => {
        if (disposed || !message || typeof message.type !== "string") return;
        switch (message.type) {
          case "ready":
            if (!this.settings.get("gettingStartedShown", false)) {
              await this.settings.update("gettingStartedShown", true);
              void vscode.window.showInformationMessage("redpen: Paste a screenshot, annotate changes, then export an SVG for your agent.", "Open guide").then(action => {
                if (action) return vscode.commands.executeCommand("redpen.showGuide");
              }).then(undefined, report);
            }
            await webview.postMessage({ type: "settings", prompt: this.settings.get("handoffPrompt", DEFAULT_HANDOFF_PROMPT), toolbarCollapsed: this.settings.get("toolbarCollapsed", false) });
            await sendState(); break;
          case "toolbarPreference":
            if (typeof message.collapsed !== "boolean") throw new Error("The toolbar preference must be on or off.");
            await this.settings.update("toolbarCollapsed", message.collapsed); break;
          case "settings":
            if (typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 4000) throw new Error("The handoff prompt must contain 1 to 4,000 characters.");
            await this.settings.update("handoffPrompt", message.prompt);
            await webview.postMessage({ type: "settings", prompt: message.prompt, saved: true }); break;
          case "copyPrompt":
            if (!lastExport) throw new Error("Export an SVG first, then copy the handoff prompt with its file path.");
            await vscode.env.clipboard.writeText(this.handoff(lastExport));
            await webview.postMessage({ type: "promptCopied" }); break;
          case "import": {
            const source = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Screenshots: ["png", "jpg", "jpeg", "webp", "svg"] }, title: "redpen: Import screenshot or SVG" }))?.[0];
            if (source) { if (/\.svg$/i.test(source.path)) await this.create(source); else await insert(await this.readScreenshot(source)); }
            break;
          }
          case "paste": await insert(pastedScreenshot(message.image), message.mode ?? "new", message); break;
          case "edit": {
            const project = parseProject(message.project);
            const allowed = new Set(projectAssets(read()));
            if (projectAssets(project).some(name => !allowed.has(name))) throw new Error("An edit cannot reference a new image source.");
            if (project.image !== read().image) throw new Error("An edit cannot replace the original screenshot.");
            if (!Number.isSafeInteger(message.revision) || message.revision < 1) throw new Error("The edit revision is invalid.");
            await apply(project, message.revision);
            break;
          }
          case "undo": await vscode.commands.executeCommand("undo"); break;
          case "redo": await vscode.commands.executeCommand("redo"); break;
          case "save": await document.save(); break;
          case "export": {
            const project = read();
            if (!project.image) throw new Error("Paste a screenshot first.");
            const source = await this.readScreenshot(vscode.Uri.joinPath(directory, project.image));
            const mime = source.extension === "jpg" || source.extension === "jpeg" ? "jpeg" : source.extension;
            const images: Record<string, { data: string; width: number; height: number }> = {};
            for (const name of projectAssets(project).filter(name => name !== project.image)) {
              const asset = await this.readScreenshot(vscode.Uri.joinPath(directory, name));
              const size = message.assetSizes?.[name];
              images[name] = { data: `data:image/${/jpe?g/.test(asset.extension) ? "jpeg" : asset.extension};base64,${Buffer.from(asset.bytes).toString("base64")}`, width: size?.width, height: size?.height };
            }
            const svg = exportSvg(project, `data:image/${mime};base64,${Buffer.from(source.bytes).toString("base64")}`, message.sourceWidth, message.sourceHeight, images);
            const target = await vscode.window.showSaveDialog({ filters: { "redpen SVG": ["svg"] }, defaultUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? directory, "redpen.svg"), title: "redpen: Export for Agent" });
            if (!target) { await webview.postMessage({ type: "exportCanceled" }); break; }
            if (target.toString() === document.uri.toString() || projectAssets(project).some(name => target.toString() === vscode.Uri.joinPath(directory, name).toString())) throw new Error("Use a different filename to avoid overwriting an image or draft.");
            await vscode.workspace.fs.writeFile(target, encoder.encode(svg));
            lastExport = target;
            void offerGitIgnore(target).catch(report);
            await webview.postMessage({ type: "exported" });
            void vscode.window.showInformationMessage("redpen: SVG saved. Copy the handoff prompt and paste it into your agent chat.", "Copy handoff prompt").then(async action => {
              if (action) {
                await vscode.env.clipboard.writeText(this.handoff(target));
                await webview.postMessage({ type: "promptCopied" });
              }
            }).then(undefined, report);
            break;
          }

        }
      }).catch(async error => {
        await webview.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        if (message?.type !== "edit") report(error);
        if (message?.type === "edit") await sendState();
      });
    }));
    panel.onDidDispose(() => { disposed = true; disposables.forEach(disposable => disposable.dispose()); });
    webview.html = this.html(webview);
  }

  /** Always include the saved path, even when a custom template omits the placeholder. */
  private handoff(target: vscode.Uri): string {
    const prompt = this.settings.get("handoffPrompt", DEFAULT_HANDOFF_PROMPT);
    return prompt.includes("{svgPath}") ? prompt.replaceAll("{svgPath}", target.fsPath) : `${prompt}\n\nSVG：${target.fsPath}`;
  }

  /** Restrict scripts to the bundled editor and images to local workspace resources. */
  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "editor.js"));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "editor.css"));
    const nonce = randomUUID();
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${css}"><title>redpen Canvas</title></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}
