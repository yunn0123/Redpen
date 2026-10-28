/** Discover private drafts across workspaces without moving files that existing editor tabs still use. */
import * as vscode from "vscode";
const decoder = new TextDecoder();

/** Desktop VS Code can expose the same storage through file: and vscode-userdata: URIs. */
export function storageUri(uri: vscode.Uri): vscode.Uri {
  return uri.scheme === "vscode-userdata" ? vscode.Uri.file(uri.fsPath) : uri;
}

export async function canvasDirectories(globalStorage: vscode.Uri, workspaceStorage?: vscode.Uri): Promise<vscode.Uri[]> {
  globalStorage = storageUri(globalStorage);
  if (workspaceStorage) workspaceStorage = storageUri(workspaceStorage);
  const extensionId = globalStorage.path.split("/").pop()!;
  const directories = new Map<string, vscode.Uri>();
  const add = (uri: vscode.Uri) => directories.set(uri.toString(), uri);
  add(vscode.Uri.joinPath(globalStorage, "canvases"));
  if (workspaceStorage) add(vscode.Uri.joinPath(workspaceStorage, "canvases"));
  const roots = [vscode.Uri.joinPath(globalStorage, "..", "..", "workspaceStorage")];
  if (workspaceStorage) roots.push(vscode.Uri.joinPath(workspaceStorage, "..", ".."));
  // Profiles have their own globalStorage, but VS Code's workspaceStorage is under User.
  if (/\/profiles\/[^/]+\/globalStorage\/[^/]+$/.test(globalStorage.path)) roots.push(vscode.Uri.joinPath(globalStorage, "..", "..", "..", "..", "workspaceStorage"));
  for (const root of new Map(roots.map(uri => [uri.toString(), uri])).values()) {
    let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(root); }
    catch (error) { if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") continue; throw error; }
    for (const [name, type] of entries) if (type === vscode.FileType.Directory) add(vscode.Uri.joinPath(root, name, extensionId, "canvases"));
  }
  return [...directories.values()];
}

export async function readCanvas(uri: vscode.Uri): Promise<unknown> {
  if ((await vscode.workspace.fs.stat(uri)).size > 3_000_000) throw new Error("The draft is too large.");
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.length > 3_000_000) throw new Error("The draft is too large.");
  return JSON.parse(decoder.decode(bytes));
}
