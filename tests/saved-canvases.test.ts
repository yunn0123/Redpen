import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bundle = build({ entryPoints: ["src/extension.ts"], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false });

const globalStorage = "/User/globalStorage/yunn030123.redpen-ui-markup";
const cache = globalStorage + "/canvases";
async function host(files: Record<string, string>, confirm = true, tabs: unknown[] = [], options: { workspace?: string; preview?: boolean; cancel?: boolean } = {}) {
  class Uri {
    constructor(readonly path: string) {}
    toString() { return this.path; }
    static file(path: string) { return new Uri(path); }
    static joinPath(base: Uri, ...parts: string[]) { return new Uri(require("node:path").posix.join(base.path, ...parts)); }
  }
  class FileSystemError extends Error { code = "FileNotFound"; }
  class ThemeIcon { constructor(readonly id: string) {} }
  class TabInputCustom { readonly viewType = "redpen.editor"; constructor(readonly uri: Uri) {} }
  const commands = new Map<string, Function>();
  const executed: unknown[][] = [];
  const deleted: string[] = [];
  const notices: string[] = [];
  const data = new Map(Object.entries(files).map(([name, value]) => [name.startsWith("/") ? name : cache + "/" + name, value]));
  const directories = new Set([cache]);
  let items: any[] = [];
  const mock = {
    Uri, FileSystemError, ThemeIcon, ViewColumn: { Beside: -2 }, TabInputCustom, TabInputText: class {}, FileType: { File: 1, Directory: 2 },
    commands: {
      registerCommand: (name: string, fn: Function) => commands.set(name, fn),
      executeCommand: async (...args: unknown[]) => { executed.push(args); },
    },
    workspace: { fs: {
      writeFile: async (uri: Uri, bytes: Uint8Array) => { data.set(uri.path, new TextDecoder().decode(bytes)); },
      createDirectory: async (uri: Uri) => { directories.add(uri.path); },
      readDirectory: async (uri: Uri) => {
        const entries = new Map<string, number>();
        for (const path of data.keys()) {
          if (!path.startsWith(uri.path + "/")) continue;
          const parts = path.slice(uri.path.length + 1).split("/"); entries.set(parts[0], parts.length === 1 ? 1 : 2);
        }
        if (!entries.size && !directories.has(uri.path)) throw new FileSystemError("Missing");
        return [...entries];
      },
      stat: async (uri: Uri) => {
        if (!data.has(uri.path)) throw new FileSystemError("Missing");
        return { mtime: uri.path.includes("new") ? 2 : 1, size: data.get(uri.path)!.length };
      },
      readFile: async (uri: Uri) => { if (!data.has(uri.path)) throw new FileSystemError("Missing"); return Buffer.from(data.get(uri.path)!); },
      delete: async (uri: Uri) => { deleted.push(uri.path.startsWith(cache + "/") ? uri.path.slice(cache.length + 1) : uri.path); data.delete(uri.path); },
    } },
    window: {
      tabGroups: { all: [{ tabs }], onDidChangeTabs: () => ({}), onDidChangeTabGroups: () => ({}) }, registerCustomEditorProvider: () => ({}),
      createQuickPick: () => {
        let accept = () => {}, hide = () => {}, preview = (_: any) => {};
        const disposable = { dispose() {} };
        const picker: any = {
          items: [], selectedItems: [], dispose() {},
          onDidAccept: (fn: () => void) => { accept = fn; return disposable; },
          onDidHide: (fn: () => void) => { hide = fn; return disposable; },
          onDidTriggerItemButton: (fn: (_: any) => void) => { preview = fn; return disposable; },
          hide: () => hide(),
          show: () => { items = picker.items; picker.selectedItems = [items[0]]; if (options.preview) preview({ item: items[0] }); if (options.cancel) hide(); else accept(); },
        };
        return picker;
      },
      showQuickPick: async (choices: any[], _: any) => { items = choices; return choices.filter(item => item.label.includes("new")); },
      showWarningMessage: async () => confirm ? "Delete permanently" : undefined,
      showInformationMessage: (message: string) => notices.push(message),
      showErrorMessage: (message: string) => { throw new Error(message); },
    },
  };
  const module: { exports: any } = { exports: {} };
  runInNewContext((await bundle).outputFiles[0].text, { module, exports: module.exports, require: (name: string) => name === "vscode" ? mock : require(name), TextEncoder, TextDecoder, Buffer, setTimeout, clearTimeout });
  const subscriptions: any[] = [];
  module.exports.activate({ extension: { packageJSON: { version: "test" } }, workspaceState: { get: () => undefined, update: async () => {} }, extensionUri: new Uri("/extension"), globalStorageUri: new Uri(globalStorage), storageUri: options.workspace ? new Uri(options.workspace) : undefined, globalState: {}, subscriptions });
  subscriptions.forEach(item => item.dispose?.());
  return { commands, executed, deleted, notices, TabInputCustom, Uri, data, items: () => items };
}
const draft = (image: string) => JSON.stringify({ version: 1, image, items: [] });
const files = () => ({
  "canvas-new.redpen.json": draft("screenshot-abc.png"),
  "canvas-old.redpen.json": draft("screenshot-abc.png"),
  "screenshot-abc.png": "shared",
  "screenshot-def.png": "orphan",
  "unrelated.png": "keep",
});

test("recent canvases reopen the newest existing draft without creating a copy", async () => {
  const h = await host(files());
  await h.commands.get("redpen.openRecent")!();
  assert.equal(h.executed[0][0], "vscode.openWith");
  assert.equal(String(h.executed[0][1]), cache + "/canvas-new.redpen.json");
});
test("deletion preserves shared assets and unrelated files, removes unused generated images", async () => {
  const h = await host(files());
  await h.commands.get("redpen.deleteCanvases")!();
  assert.deepEqual(h.deleted, ["canvas-new.redpen.json", "screenshot-def.png"]);
});
test("canceling deletion changes no files", async () => {
  const h = await host(files(), false);
  await h.commands.get("redpen.deleteCanvases")!();
  assert.deepEqual(h.deleted, []);
});
test("an unreadable remaining draft prevents image cleanup", async () => {
  const h = await host({ ...files(), "canvas-old.redpen.json": "broken" });
  await h.commands.get("redpen.deleteCanvases")!();
  assert.deepEqual(h.deleted, ["canvas-new.redpen.json"]);
});
test("open canvas tabs block deletion", async () => {
  const tabs: unknown[] = [];
  const h = await host(files(), true, tabs);
  tabs.push({ input: new h.TabInputCustom(new h.Uri(cache + "/canvas-old.redpen.json")) });
  await h.commands.get("redpen.deleteCanvases")!();
  assert.deepEqual(h.deleted, []);
});


test("recent canvases include global and legacy workspaces sorted by save time, even with a folder open", async () => {
  const legacy = "/User/workspaceStorage/other/yunn030123.redpen-ui-markup/canvases";
  const h = await host({ ...files(), [legacy + "/canvas-newer.redpen.json"]: draft("legacy.png"), [legacy + "/legacy.png"]: "image" }, true, [], { workspace: "/User/workspaceStorage/current/yunn030123.redpen-ui-markup" });
  await h.commands.get("redpen.openRecent")!();
  assert.equal(h.items().length, 3);
  assert.ok(h.items().some(item => item.uri.path === legacy + "/canvas-newer.redpen.json"));
  assert.ok(h.items().some(item => item.uri.path === cache + "/canvas-old.redpen.json"));
  assert.equal(h.items().at(-1).mtime, 1);
  assert.equal(new Set(h.items().map(item => item.uri.toString())).size, 3);
});
test("empty windows can discover drafts saved in another workspace", async () => {
  const legacy = "/User/workspaceStorage/other/yunn030123.redpen-ui-markup/canvases";
  const h = await host({ [legacy + "/canvas-old.redpen.json"]: draft("image.png"), [legacy + "/image.png"]: "image" });
  await h.commands.get("redpen.openRecent")!();
  assert.equal(h.items().length, 1); assert.equal(String(h.executed[0][1]), legacy + "/canvas-old.redpen.json");
});
test("background preview uses the visible first background in the draft's own directory without opening a canvas", async () => {
  const project = { version: 1, image: "visible.png", items: [], backgrounds: [{ id: "visible", asset: "visible.png", x: 2000, y: 0, width: 800, height: 600 }] };
  const h = await host({ "canvas-new.redpen.json": JSON.stringify(project), "old.png": "old", "visible.png": "visible" }, true, [], { preview: true, cancel: true });
  const original = [...h.data.entries()];
  await h.commands.get("redpen.openRecent")!();
  assert.equal(h.executed.length, 1); assert.equal(h.executed[0][0], "vscode.open");
  assert.equal(String(h.executed[0][1]), cache + "/visible.png");
  assert.deepEqual([...h.data.entries()], original);
});
test("missing preview images and damaged drafts stay in Recent", async () => {
  const h = await host({ "canvas-old.redpen.json": "broken", "canvas-new.redpen.json": draft("missing.png") });
  await h.commands.get("redpen.openRecent")!(); assert.equal(h.items().length, 2);
  assert.ok(h.items().every(item => !item.preview));
});
test("cleanup is scoped to the deleted draft directory, preserving same-named assets elsewhere", async () => {
  const legacy = "/User/workspaceStorage/other/yunn030123.redpen-ui-markup/canvases";
  const h = await host({ ...files(), [legacy + "/canvas-old.redpen.json"]: draft("screenshot-def.png"), [legacy + "/screenshot-def.png"]: "legacy-shared" });
  await h.commands.get("redpen.deleteCanvases")!();
  assert.ok(h.data.has(legacy + "/screenshot-def.png")); assert.ok(!h.data.has(cache + "/screenshot-def.png"));
});


test("new canvases use shared global storage even when a workspace is open", async () => {
  const h = await host({}, true, [], { workspace: "/User/workspaceStorage/current/yunn030123.redpen-ui-markup" });
  await h.commands.get("redpen.open")!();
  const paths = [...h.data.keys()]; assert.equal(paths.length, 1);
  assert.ok(paths[0].startsWith(cache + "/canvas-"));
});
