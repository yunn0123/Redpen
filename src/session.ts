/** Restore open draft files after an update without making new canvases or touching their contents. */
import * as vscode from "vscode";
const viewType = "redpen.editor";
type CanvasTab = { uri: string; column: number; active: boolean; preview: boolean };

export function canvasTabs(): CanvasTab[] {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === viewType
    ? [{ uri: tab.input.uri.toString(), column: group.viewColumn, active: tab.isActive && group.isActive, preview: tab.isPreview }] : []));
}

export async function restoreCanvasTabs(saved: CanvasTab[], resolved: Set<string>, closed: Set<string>): Promise<void> {
  const focused = vscode.window.tabGroups.all.find(group => group.isActive)?.tabs.find(tab => tab.isActive);
  const focusedInput = focused?.input;
  const preserveOtherEditor = focused && !(focusedInput instanceof vscode.TabInputCustom && saved.some(entry => entry.uri === focusedInput.uri.toString()));
  // Restore background tabs first, then the previously active editor without stealing focus from other tabs.
  for (const entry of [...saved].sort((a, b) => Number(a.active) - Number(b.active))) {
    if (closed.has(entry.uri) || resolved.has(entry.uri)) continue;
    const uri = vscode.Uri.parse(entry.uri);
    if (!/\.(redpen|uifeedback)\.json$/i.test(uri.path)) continue;
    const existing = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === viewType && tab.input.uri.toString() === entry.uri);
    if (existing?.isDirty || vscode.workspace.textDocuments.some(document => document.uri.toString() === entry.uri && document.isDirty)) continue;
    try { await vscode.workspace.fs.stat(uri); } catch { continue; }
    if (closed.has(entry.uri) || resolved.has(entry.uri)) continue;
    if (existing && !await vscode.window.tabGroups.close(existing, true)) continue;
    await vscode.commands.executeCommand("vscode.openWith", uri, viewType, { viewColumn: entry.column, preserveFocus: !entry.active || Boolean(preserveOtherEditor), preview: entry.preview });
  }
}

export function trackCanvasSession(context: vscode.ExtensionContext, resolved: Set<string>): void {
  const version = context.extension.packageJSON.version as string;
  const previous = context.workspaceState.get<{ version: string; tabs: CanvasTab[] }>("canvasSession");
  const current = canvasTabs();
  const saved = new Map(current.map(tab => [tab.uri, tab]));
  if (previous && previous.version !== version && Array.isArray(previous.tabs)) {
    for (const tab of previous.tabs) if (typeof tab.uri === "string" && Number.isInteger(tab.column) && !saved.has(tab.uri)) saved.set(tab.uri, tab);
  }
  let restoring = true, stopped = false;
  const closed = new Set<string>();
  let queue = Promise.resolve();
  const persist = () => {
    if (stopped || restoring) return;
    const snapshot = { version, tabs: canvasTabs() };
    queue = queue.then(() => context.workspaceState.update("canvasSession", snapshot)).catch(error => console.error("redpen: Could not remember open canvases", error));
  };
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
    if (restoring) for (const tab of event.closed) if (tab.input instanceof vscode.TabInputCustom && tab.input.viewType === viewType) closed.add(tab.input.uri.toString());
    persist();
  }), vscode.window.tabGroups.onDidChangeTabGroups(persist));
  const timer = setTimeout(() => {
    void restoreCanvasTabs([...saved.values()], resolved, closed).catch(error => console.error("redpen: Could not restore open canvases", error)).finally(() => { restoring = false; persist(); });
  }, 1000);
  context.subscriptions.push({ dispose: () => { stopped = true; clearTimeout(timer); } });
}
