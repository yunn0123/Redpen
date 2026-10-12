/** Serve a localhost-only browser harness for canvas development and end-to-end verification. */
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
await build({ entryPoints: ["src/dev.ts"], bundle: true, format: "esm", platform: "browser", outfile: "dist/dev.js", sourcemap: true });
const files = { "/dev.js": ["dist/dev.js", "text/javascript"], "/dev.css": ["dist/dev.css", "text/css"] };
createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>redpen · Preview</title><link rel="stylesheet" href="/dev.css"></head><body><div id="app"></div><script type="module" src="/dev.js"></script></body></html>'); return;
  }
  if (!files[path]) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { "content-type": files[path][1] }); response.end(await readFile(files[path][0])); }
  catch { response.writeHead(500).end("Build output unavailable"); }
}).listen(4173, "127.0.0.1", () => console.log("redpen preview: http://127.0.0.1:4173"));
