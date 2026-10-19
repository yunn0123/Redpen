/** Ask Git about exported local files, including repositories outside the open workspace. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

const exec = promisify(execFile);

export async function exportedIgnoreTarget(file: string): Promise<{ root: string; path: string } | undefined> {
  let root: string;
  try {
    root = (await exec("git", ["-C", dirname(file), "rev-parse", "--show-toplevel"])).stdout.trimEnd();
  } catch { return; } // Export still works when Git is unavailable or the folder is not a repository.
  const path = relative(root, join(await realpath(dirname(file)), basename(file))).split(sep).join("/");
  if (/[\r\n]/.test(path)) return; // Gitignore cannot represent literal newlines in a filename.
  const tracked = await exec("git", ["-C", root, "ls-files", "-z", "--", `:(literal)${path}`]);
  if (tracked.stdout) return;
  try {
    await exec("git", ["-C", root, "check-ignore", "--quiet", "--", path]);
    return;
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
  }
  return { root, path };
}

/** Anchor one literal filename at the repository root, preserving existing rules and line endings. */
export function appendIgnoreRule(text: string, path: string): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const rule = "/" + path.replace(/[\\*?\[\]#! ]/g, "\\$&");
  return (text && !text.endsWith("\n") ? newline : "") + rule + newline;
}
