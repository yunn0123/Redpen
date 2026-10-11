/** Bundle the extension and canvas independently so VS Code never loads a second application runtime. */
import { build } from "esbuild";
await Promise.all([
  build({ entryPoints: ["src/extension.ts"], bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], outfile: "dist/extension.js", sourcemap: true }),
  build({ entryPoints: ["src/editor/editor.ts"], bundle: true, platform: "browser", target: "es2022", outfile: "dist/editor.js", minify: true, sourcemap: true }),
]);
