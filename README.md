<!-- Purpose: introduce redpen with a short workflow and real editor examples. -->
<img src="https://raw.githubusercontent.com/yunn0123/Redpen/main/docs/images/redpen-logo.png" width="96" alt="redpen logo">

# redpen

**Mark up your AI's UI with a red pen.**

Paste a screenshot into VS Code, mark what needs to change, and hand it to your coding agent.
Lightweight and local. No account or AI API key required. Just paste and start editing.

## How it works

1. Run **redpen: Open Canvas** and paste a screenshot with **⌘/Ctrl V**.
2. Draw regions and add requests. Use covers, arrows, text, icons, and copied regions to sketch changes.
3. Click **Export for Agent** to save one SVG. Open **Settings → Copy handoff prompt** and give the prompt to your agent.

![Paste a screenshot, annotate it, copy and move a region, then export](https://raw.githubusercontent.com/yunn0123/Redpen/main/docs/images/workflow.gif)

*Recorded in the editor's browser preview using a generated sample screenshot.*

## One file, three layers

Each SVG contains **original**, **modified**, and **annotations** layers, with numbered requests beside the image.
Import it back into redpen to keep editing. The export expands to fit your objects, with transparent space outside the screenshot.

![An exported mockup with numbered requests beside the image](https://raw.githubusercontent.com/yunn0123/Redpen/main/docs/images/example.png)

## Quick tips

- **Paste another image:** adds a movable object. Double-click the background before pasting to replace it while keeping existing objects in place.
- **Select and edit:** drag with Select to select multiple objects; ⌘/Ctrl-click to toggle selection. Drag arrow endpoints to change direction or length. Press Delete to remove objects.
- **Use the sidebar:** rotate or flip images, or click **＋** beside Requests to add a general request.
- **Undo / redo:** ⌘/Ctrl Z / ⌘/Ctrl Shift Z. New canvases autosave locally.

## Install and develop

Run `npm install` and `npm run package`. In VS Code, choose **Extensions → Install from VSIX…** and select `redpen.vsix`.
After updating, run **Developer: Reload Window**.

Extension ID: `yunn030123.redpen-ui-markup`. Moving from an older extension ID? Export important drafts as SVG, disable the old extension, then install this one and import them. Legacy `.uifeedback.json` drafts and SVG exports remain readable.

Requires Node.js 24+. Run `npm run build`, then press F5 to test the extension; use `npm run dev` for the browser preview.
Checks: `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run test:vscode` (requires a local VS Code installation).

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
