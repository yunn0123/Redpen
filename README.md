<!-- Purpose: introduce redpen with a short workflow and real editor examples. -->
[English](README.md) | [繁體中文](README.zh-TW.md)

<img src="docs/images/redpen-logo.png" width="96" alt="redpen logo">

# redpen

**Mark up your AI's UI with a red pen.**

Paste a screenshot into VS Code, mark what needs to change, and hand it to your coding agent.
Lightweight and local. No account or AI API key required. Just paste and start editing.

## Install in VS Code

Open [redpen on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yunn030123.redpen-ui-markup), click **Install**, and open it in VS Code.
You can also open Extensions (**⌘⇧X / Ctrl+Shift+X**) in VS Code and search for `yunn030123.redpen-ui-markup`.

## Open a canvas in VS Code

**You can edit in an empty VS Code window — no folder or project needs to be open.** No Node.js setup, build commands, or manual VSIX installation is required.

1. **Open a canvas:** in VS Code, press **⌘⇧P** (macOS) or **Ctrl+Shift+P** (Windows/Linux) to open the Command Palette. Search for **redpen: Open Canvas** and press Enter. A **redpen Canvas** tab opens, ready to edit; no need to name or save a draft first.
2. **Paste a screenshot:** click the canvas and press **⌘V / Ctrl+V**, or click **Import** to choose a PNG, JPEG, or WebP. You can also right-click an image in Explorer → **redpen: Open Canvas**.
3. **Describe a change:** select **Annotate**, drag a box around the area, and type your request in the floating comment. Use covers, arrows, text, icons, and copied regions to sketch the result.
4. **Export:** click **Export for Agent**, choose a location, and save one SVG.
5. **Hand it to your agent:** click **Copy handoff prompt** in the VS Code success notification, then paste into your agent chat. The prompt includes the saved SVG path. If your agent cannot access that path, attach the SVG too.

On first use, a notification offers **Open guide**. Reopen this guide anytime with **redpen: Show Getting Started**.

![Paste a screenshot, select a region, type a request, and hand it to an agent](docs/images/workflow.gif)

*English demo with the real canvas; the final agent handoff is illustrated.*

## One file, three layers

Each SVG contains **original**, **modified**, and **annotations** layers, with numbered requests beside the image.
Import it back into redpen to keep editing. The export expands to fit your objects, with transparent space outside the screenshot.

![An exported mockup with numbered requests beside the image](docs/images/example.png)

## Quick tips

- **Floating controls:** drawing tools sit at the top left; undo, import, export, and the Requests toggle sit at the top right. Requests starts collapsed and opens as a floating panel attached to the right toolbar.
- **Compact tools:** toggle **Collapse drawing tools** to keep only the active tool visible; hover or focus the toolbar to expand it. This preference is remembered. Zoom controls sit vertically at the bottom left.
- **Sketch an icon:** the gray placeholder disappears after the first stroke, including in exported SVGs. Clear strokes to restore it.
- **Comments on the canvas:** hover a numbered comment icon to read a request; click the text field to edit. While typing, the comment stays open. Press Escape or leave the field to apply changes; **More options** opens the sidebar.

- **Paste another image:** adds a movable object. Double-click the background before pasting to replace it while keeping existing objects in place.
- **Select and edit:** drag with Select to select multiple objects; ⌘/Ctrl-click to toggle selection. Drag arrow endpoints to change direction or length. Press Delete to remove objects.
- **Use the sidebar:** rotate or flip images, or click **＋** beside Requests to add a general request.
- **Undo / redo:** ⌘/Ctrl Z / ⌘/Ctrl Shift Z. New canvases autosave locally.

## Notifications & saved work

- Notifications start with **redpen:**. Export success offers **Copy handoff prompt**; errors explain what to fix. Canceling the save dialog does not export a file.
- Missed the export notification? Open the canvas **Settings → Copy handoff prompt**. You can also edit the prompt there; `{svgPath}` inserts the exported file path.
- New canvases autosave locally. The internal `.redpen.json` file is a draft; share the exported SVG with your agent.
- Use **Import** to reopen a redpen SVG and continue editing. If an older draft opens as JSON, use **Reopen Editor With… → redpen Canvas**.

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
