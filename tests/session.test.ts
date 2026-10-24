import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
const bundle = build({ entryPoints: ["src/session.ts"], bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false });

async function session(previous?: any) {
  class Uri { constructor(readonly path: string) {} toString() { return this.path; } static parse(path: string) { return new Uri(path); } }
  class TabInputCustom { constructor(readonly uri: Uri, readonly viewType = "redpen.editor") {} }
  const tab = (uri: string, dirty = false) => ({ input: new TabInputCustom(new Uri(uri)), isDirty: dirty, isActive: true, isPreview: false });
  const group = { tabs: [] as ReturnType<typeof tab>[], viewColumn: 2, isActive: true };
  const commands: any[][] = [], closes: string[] = [], updates: any[] = [];
  let change: Function = () => {}, timer: Function = () => {};
  const missing = new Set<string>();
  const mock = {
    Uri, TabInputCustom,
    workspace: { textDocuments: [] as any[], fs: { stat: async (uri: Uri) => { if (missing.has(uri.path)) throw new Error("Missing"); return {}; } } },
    commands: { executeCommand: async (...args: any[]) => { commands.push(args); group.tabs.push(tab(args[1].toString())); } },
    window: { tabGroups: {
      all: [group],
      close: async (item: ReturnType<typeof tab>) => { closes.push(item.input.uri.toString()); group.tabs = group.tabs.filter(t => t !== item); return true; },
      onDidChangeTabs: (fn: Function) => { change = fn; return { dispose() {} }; }, onDidChangeTabGroups: () => ({ dispose() {} }),
    } },
  };
  const module: any = { exports: {} };
  runInNewContext((await bundle).outputFiles[0].text, { module, exports: module.exports, require: () => mock, console, setTimeout: (fn: Function) => { timer = fn; }, clearTimeout() {} });
  const subscriptions: any[] = [];
  const context = { extension: { packageJSON: { version: "new" } }, subscriptions, workspaceState: { get: () => previous, update: async (_: string, value: any) => { updates.push(value); } } };
  return { ...module.exports, mock, group, tab, commands, closes, missing, context, updates, change: (event: any) => change(event), tick: async () => { timer(); await new Promise(resolve => setImmediate(resolve)); } };
}
const saved = (uri = "/draft.redpen.json") => ({ uri, column: 2, active: true, preview: false });

test("orphan canvas tabs reconnect to the same file and editor group", async () => {
  const h = await session(); h.group.tabs.push(h.tab(saved().uri));
  await h.restoreCanvasTabs([saved()], new Set(), new Set());
  assert.deepEqual(h.closes, [saved().uri]);
  assert.equal(h.commands[0][0], "vscode.openWith"); assert.equal(String(h.commands[0][1]), saved().uri);
  assert.equal(h.commands[0][3].viewColumn, 2);
});
test("healthy, dirty, deliberately closed, and missing canvases are never replaced", async () => {
  const h = await session(); h.group.tabs.push(h.tab("/dirty.redpen.json", true)); h.missing.add("/missing.redpen.json");
  await h.restoreCanvasTabs([saved("/healthy.redpen.json"), saved("/dirty.redpen.json"), saved("/closed.redpen.json"), saved("/missing.redpen.json")], new Set(["/healthy.redpen.json"]), new Set(["/closed.redpen.json"]));
  assert.equal(h.commands.length, 0); assert.equal(h.closes.length, 0);
});
test("a version update silently restores missing session tabs and remembers the restored session", async () => {
  const h = await session({ version: "old", tabs: [saved()] });
  h.trackCanvasSession(h.context, new Set()); await h.tick();
  assert.equal(h.commands.length, 1); assert.equal(String(h.commands[0][1]), saved().uri);
  assert.equal(h.updates.at(-1).tabs[0].uri, saved().uri); assert.equal(h.updates.at(-1).version, "new");
});
test("ordinary startup does not resurrect tabs from an older session with the same version", async () => {
  const h = await session({ version: "new", tabs: [saved()] });
  h.trackCanvasSession(h.context, new Set()); await h.tick();
  assert.equal(h.commands.length, 0); assert.equal(h.updates.at(-1).tabs.length, 0);
});
test("closing a tab while startup restoration is pending prevents it reopening", async () => {
  const h = await session({ version: "old", tabs: [saved()] }); h.group.tabs.push(h.tab(saved().uri));
  h.trackCanvasSession(h.context, new Set());
  const closed = h.group.tabs.splice(0); h.change({ closed }); await h.tick();
  assert.equal(h.commands.length, 0);
});
