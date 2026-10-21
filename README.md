<!-- Purpose: introduce redpen with a short workflow and real editor examples. -->
[English](README.md) | [繁體中文](README.zh-TW.md)

<img src="docs/images/redpen-logo.png" width="96" alt="redpen logo">

# redpen

**Mark up your AI's UI with a red pen.**

Paste a screenshot into VS Code, mark what needs to change, and hand it to your coding agent.
Lightweight and local. No account or AI API key required. Just paste and start editing.

## Quick start

1. In VS Code, press **Shift+Command+P** (macOS) or **Shift+Ctrl+P** (Windows/Linux).
2. Type **`redpen`**, select **redpen: Open Canvas**, and press **Enter**.
3. Paste a screenshot with **Command+V / Ctrl+V** and start marking it up.

![Paste a screenshot, select a region, type a request, and hand it to an agent](docs/images/workflow.gif)

*English demo with the real canvas; the final agent handoff is illustrated.*

## Updates

### 0.2.10

- Paste multiple fixed background screenshots into one canvas, arranged to the right with 64px gaps. Notes and arrows can span screens. Use Select and double-click a background to replace or delete it; annotations and other backgrounds stay in place, and the last background cannot be deleted. New image still creates movable image objects.
- Add reference images to requests by pasting into the text field or choosing a file. Stable `[img1]` markers link to previews; references are embedded in the exported SVG and retained on reimport.
- Added 18 offline motion recipes, including carousels, horizontal parallax, pinned galleries, card stacks, marquees and shared-layout interactions. Interactive previews accompany readable specifications for agents.
- Drag toolbar buttons within their groups to reorder them, with an insertion indicator and saved preferences. Alt+Arrow keys and a reset option are also available.

### 0.2.9

- Tools wrap in narrow editor splits so every drawing tool remains reachable.
- Added a visible Export label and clearer Requests panel spacing.
- Updated editing hints for Enter and Shift+Enter; selection and button colors follow the VS Code theme.

### 0.2.8

- New objects focus their request field automatically; text objects focus their text field. Enter finishes editing, Shift+Enter adds a line, and Chinese IME confirmation keeps editing active.
- Fixed the canvas stealing keyboard focus after adding text or icons. Drawing tools remain active for repeated use.
- Exporting an SVG into a local Git repository offers to add only that file to `.gitignore`, with your approval. Already ignored or tracked files are skipped.
- Added Command Palette quick-start steps above the workflow demo.

### 0.2.7

- Drawing tools stay active after use, so you can add consecutive annotations or shapes. Switch to Select to move objects.
- Expanded the offline Lucide icon catalog from 20 to 82 icons, including navigation, files, communication, shopping, and devices. Icons remain editable and export to SVG.

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

## One file, three layers

Each SVG contains **original**, **modified**, and **annotations** layers, with numbered requests beside the image.
Import it back into redpen to keep editing. The export expands to fit your objects, with transparent space outside the screenshot.

![An exported mockup with numbered requests beside the image](docs/images/example.png)

## Quick tips

- **Motion recipes:** open **Components → Motion**, play a preview, then add the effect to the selected object or draw a new region. 18 offline presets cover interactive components (carousels, swipe stacks, marquees, tabs and expanding cards), scroll-linked effects (horizontal parallax, pinned galleries, card stacks, image reveals and hero zoom), and basic effects. Previews support navigation, dragging or a scroll-progress slider. Exports describe triggers, bounds, timing, loop behavior and reduced-motion fallbacks; no GIF or animation library is required for the handoff.
- **Your tool order:** drag buttons within either toolbar group; an insertion line follows the drop position. You can also focus a button and use **Alt+Arrow** keys. The order is remembered; reset it in Settings.
- **Reference images:** paste an image into a request field or click **Add reference image** below it. The text gets an `[img1]` marker, with a thumbnail you can preview or remove. Up to 8 images per request; references are embedded beside their request in the exported SVG and retained when reimported.
- **Floating controls:** drawing tools sit at the top left; undo, import, export, and the Requests toggle sit at the top right. Requests starts collapsed and opens as a floating panel attached to the right toolbar.
- **Compact tools:** toggle **Collapse drawing tools** to keep only the active tool visible; hover or focus the toolbar to expand it. This preference is remembered. Zoom controls sit vertically at the bottom left.
- **Sketch an icon:** the gray placeholder disappears after the first stroke, including in exported SVGs. Clear strokes to restore it.
- **Comments on the canvas:** hover a numbered comment icon to read a request; click the text field to edit. While typing, the comment stays open. Press Escape or leave the field to apply changes; **More options** opens the sidebar.

- **Multiple screens:** paste screenshots onto the canvas to add fixed backgrounds, arranged to the right with a 64px gap. Notes and arrows may span screens. Use Select and double-click a background to replace or delete it; annotations and other backgrounds stay in place. The final background cannot be deleted. **New image** still adds a movable image object with its own request.
- **Select and edit:** drag with Select to select multiple objects; ⌘/Ctrl-click to toggle selection. Drag arrow endpoints to change direction or length. Press Delete to remove objects.
- **Use the sidebar:** rotate or flip images, or click **＋** beside Requests to add a general request.
- **Undo / redo:** ⌘/Ctrl Z / ⌘/Ctrl Shift Z. New canvases autosave locally.

## Notifications & saved work

- Exporting into a local Git repository offers to add that SVG to `.gitignore`. The file changes only if you choose **Add to .gitignore**; already ignored or tracked SVGs are skipped.
- Notifications start with **redpen:**. Export success offers **Copy handoff prompt**; errors explain what to fix. Canceling the save dialog does not export a file.
- Missed the export notification? Open the canvas **Settings → Copy handoff prompt**. You can also edit the prompt there; `{svgPath}` inserts the exported file path.
- New canvases autosave locally. The internal `.redpen.json` file is a draft; share the exported SVG with your agent.
- Use **Import** to reopen a redpen SVG and continue editing. If an older draft opens as JSON, use **Reopen Editor With… → redpen Canvas**.

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
