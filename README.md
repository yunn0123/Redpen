[English](README.md) | [繁體中文](README.zh-TW.md)

<img src="docs/images/redpen-logo.png" width="96" alt="redpen logo">

# redpen

**Mark up your AI's UI with a red pen.**

Paste screenshots, sketch changes, and export an SVG for your coding agent.
Lightweight, offline, and local. No account, API key, folder, or manual save required to start.

## Quick start

1. Install [redpen from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yunn030123.redpen-ui-markup).
2. Press **Shift+Command+P** (macOS) or **Ctrl+Shift+P** (Windows/Linux), type `redpen`, and choose **redpen: Open Canvas**.
3. Paste or drop a screenshot, choose **Annotate**, draw a region, and type your request.
4. Click **Export**, save the SVG, and use **Copy handoff prompt** to pass it to your agent. Attach the SVG if the agent cannot access its path.

![Paste a screenshot, annotate it, and hand it to an agent](docs/images/workflow.gif)

*The demo uses the real editor; the final agent handoff is illustrated.*

## VS Code commands & shortcuts

Open the Command Palette with **⇧⌘P / Ctrl+Shift+P** and search for `redpen`.

| Command | Action |
|---|---|
| **redpen: Open Canvas** | Start a new canvas. Also available when right-clicking an image in Explorer. |
| **redpen: Open Recent Canvas** | Browse all local cached drafts, newest saved first; preview a background with the row’s preview button. |
| **redpen: Delete Saved Canvases** | Select drafts to permanently delete after closing canvas tabs and confirming. Exported SVGs are kept. |
| **redpen: Show Getting Started** | Open this guide inside VS Code. |

| Shortcut | Action |
|---|---|
| **V / H / N** | Select / Pan / Annotate |
| **M / C / A / T / I / R** | Cover / Copy region / Arrow / Text / Icon / Outline |
| **Space+drag / ⌘ or Ctrl+scroll / 0** | Pan / Zoom / Fit to view |
| **⌘ or Ctrl+Z / ⌘ or Ctrl+Shift+Z** | Undo / Redo |
| **Enter / Shift+Enter** | Finish input / New line; Chinese IME confirmation stays in the field. |
| **Delete / Backspace** | Delete selected objects. |

## Features

| Feature | What it does |
|---|---|
| **Annotate & Requests** | Add region or general requests. Drag comment popups out of the way while typing. |
| **Create & adjust** | New objects are selected for moving/resizing; draw on empty canvas to repeat the tool. Choose Select explicitly for normal selection and multi-select. |
| **Cover & Copy region** | Mask an area or copy part of a screenshot to sketch a new layout. |
| **Arrow, Text & Outline** | Point out changes, add adjustable text, or highlight regions. |
| **Icons** | Choose from 82 offline Lucide icons or sketch your own. |
| **Components & motions** | Attach component-type notes and 18 motion recipes with interactive previews and readable agent instructions. |
| **Multiple screenshots** | Paste/drop fixed backgrounds side by side with gaps. Notes can span images; Select+double-click replaces/deletes a background without removing notes. The last background is kept. |
| **New image** | Add movable image objects with their own requests; resize, rotate, or flip them. |
| **Reference images** | Paste into a request or use its image icon to paste/drop attachments. Up to 8 images per request, linked with `[img1]` markers. |
| **Toolbars** | Drag buttons to reorder, or use Alt+Arrow keys. Collapse drawing tools; preferences are remembered. |
| **SVG export & import** | One file contains original, modified, annotations, reference images, and editable draft data. Import it to continue editing. |
| **Local drafts** | Autosave to shared local storage across workspaces; remember open canvases for update recovery. Closed drafts stay closed, and unsaved tabs are not forcibly replaced. |
| **Handoff & Git** | Copy the handoff prompt from export notifications or Settings. Exporting into a Git repo can add the SVG to `.gitignore` with your approval. |

## Update — 0.2.15

- Recent Canvas lists global and legacy workspace drafts together, sorted by last saved time. New canvases use shared global storage, whether a folder is open or not.
- Preview a draft’s first background from the list without changing its saved time. Legacy drafts keep their original paths and autosave support; image cleanup stays scoped to each storage directory.

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
