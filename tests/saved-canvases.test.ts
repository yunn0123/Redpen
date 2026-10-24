import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bundle = build({ entryPoints: ["src/extension.ts"], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false });

async function host(files: Record<string, string>, confirm = true, tabs: unknown[] = []) {
  class Uri {
    constructor(readonly path: string) {}
    toString() { return this.path; }
    static joinPath(base: Uri, ...parts: string[]) { return new Uri(require("node:path").posix.join(base.path, ...parts)); }
  }
  class TabInputCustom { constructor(readonly uri: Uri) {} }
  const commands = new Map<string, Function>();
  const executed: unknown[][] = [];
  const deleted: string[] = [];
  const notices: string[] = [];
  const data = new Map(Object.entries(files));
  const mock = {
    Uri, TabInputCustom, TabInputText: class {}, FileType: { File: 1 },
    commands: {
      registerCommand: (name: string, fn: Function) => commands.set(name, fn),
      executeCommand: async (...args: unknown[]) => { executed.push(args); },
    },
    workspace: { fs: {
      createDirectory: async () => {},
      readDirectory: async () => [...data.keys()].map(name => [name, 1]),
      stat: async (uri: Uri) => ({ mtime: uri.path.includes("new") ? 2 : 1, size: data.get(uri.path.split("/").pop()!)!.length }),
      readFile: async (uri: Uri) => Buffer.from(data.get(uri.path.split("/").pop()!)!),
      delete: async (uri: Uri) => { const name = uri.path.split("/").pop()!; deleted.push(name); data.delete(name); },
    } },
    window: {
      tabGroups: { all: [{ tabs }], onDidChangeTabs: () => ({}), onDidChangeTabGroups: () => ({}) }, registerCustomEditorProvider: () => ({}),
      showQuickPick: async (items: any[], options: any) => options.canPickMany ? items.filter(item => item.label.includes("new")) : items[0],
      showWarningMessage: async () => confirm ? "Delete permanently" : undefined,
      showInformationMessage: (message: string) => notices.push(message),
      showErrorMessage: (message: string) => { throw new Error(message); },
    },
  };
  const module: { exports: any } = { exports: {} };
  runInNewContext((await bundle).outputFiles[0].text, { module, exports: module.exports, require: (name: string) => name === "vscode" ? mock : require(name), TextEncoder, TextDecoder, Buffer, setTimeout, clearTimeout });
  const subscriptions: any[] = [];
  module.exports.activate({ extension: { packageJSON: { version: "test" } }, workspaceState: { get: () => undefined, update: async () => {} }, extensionUri: new Uri("/extension"), globalStorageUri: new Uri("/storage"), globalState: {}, subscriptions });
  subscriptions.forEach(item => item.dispose?.());
  return { commands, executed, deleted, notices, TabInputCustom, Uri };
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
  assert.equal(String(h.executed[0][1]), "/storage/canvases/canvas-new.redpen.json");
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
  tabs.push({ input: new h.TabInputCustom(new h.Uri("/storage/canvases/canvas-old.redpen.json")) });
  await h.commands.get("redpen.deleteCanvases")!();
  assert.deepEqual(h.deleted, []);
});
