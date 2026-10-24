[English](README.md) | [繁體中文](README.zh-TW.md)

<img src="docs/images/redpen-logo.png" width="96" alt="redpen 紅筆 logo">

# redpen

**拿紅筆批改 AI 的 UI 答卷。**

貼上截圖、畫出修改與註解，再匯出 SVG 交給 coding agent。
輕量、離線、本機執行，不需帳號、API key、開啟資料夾或先儲存稿件。

## 快速開始

1. 從 [VS Code Marketplace 安裝 redpen](https://marketplace.visualstudio.com/items?itemName=yunn030123.redpen-ui-markup)。
2. 按 **Shift+Command+P**（macOS）或 **Ctrl+Shift+P**（Windows/Linux），輸入 `redpen`，選擇 **redpen: Open Canvas**。
3. 貼上或拖入截圖，選 **Annotate** 框選區域，輸入修改需求。
4. 按 **Export** 儲存 SVG，再以 **Copy handoff prompt** 複製交接文字給 agent。若 agent 無法讀取路徑，請一併附上 SVG。

![貼上截圖、標註需求，再交給 agent](docs/images/workflow.gif)

*示範使用實際編輯器；最後的 agent 交接畫面為示意。*

## VS Code 指令與快捷鍵

按 **⇧⌘P / Ctrl+Shift+P** 開啟指令面板，搜尋 `redpen`。

| 指令 | 用途 |
|---|---|
| **redpen: Open Canvas** | 開啟新畫布；也可在檔案總管對圖片按右鍵使用。 |
| **redpen: Open Recent Canvas** | 繼續編輯目前工作區／視窗的本機舊稿。 |
| **redpen: Delete Saved Canvases** | 關閉畫布分頁後，勾選並確認永久刪除稿件；已匯出的 SVG 不受影響。 |
| **redpen: Show Getting Started** | 在 VS Code 開啟本說明。 |

| 快捷鍵 | 操作 |
|---|---|
| **V / H / N** | 選取／平移／註解 |
| **M / C / A / T / I / R** | 遮蓋／複製區域／箭頭／文字／圖示／外框 |
| **Space+拖曳 / ⌘ 或 Ctrl+滾輪 / 0** | 平移／縮放／符合視窗 |
| **⌘ 或 Ctrl+Z / ⌘ 或 Ctrl+Shift+Z** | 復原／重做 |
| **Enter / Shift+Enter** | 完成輸入／換行；中文組字確認不會提前結束輸入。 |
| **Delete / Backspace** | 刪除選取物件。 |

## 功能簡介

| 功能 | 說明 |
|---|---|
| **註解與 Requests** | 新增區域或整體需求；註解浮窗可拖曳移位，方便邊輸入邊查看。 |
| **新增後調整** | 新物件立即選取，可移動、縮放；在空白處繼續使用同一新增工具。手動點 Select 可一般選取與多選。 |
| **遮蓋與複製區域** | 遮住畫面內容，或複製截圖區塊重排版面。 |
| **箭頭、文字與外框** | 指出修改位置、加入可調整文字，或框選強調區域。 |
| **圖示** | 內建 82 個離線 Lucide 圖示，也可自行手繪。 |
| **Components & motions** | 加入元件類型註解與 18 種動效規格，提供互動預覽與 agent 可讀說明。 |
| **多張截圖** | 貼上／拖入固定底圖，自動向右排列並留間隔，註解可跨圖。Select 雙擊可替換／刪除底圖，保留註解；最後一張不可刪除。 |
| **New image** | 新增可移動且帶有自己註解的圖片物件，支援縮放、旋轉與鏡像。 |
| **參考圖片** | 直接貼進需求欄位，或按圖片圖示開啟貼上／拖入面板；每則最多 8 張，以 `[img1]` 標記對應。 |
| **工具列** | 拖曳或用 Alt+方向鍵調整排序，可收合繪圖工具並記住偏好。 |
| **SVG 匯出與匯入** | 單一檔案包含 original、modified、annotations、參考圖與可編輯稿件資料，匯入後可繼續編輯。 |
| **本機稿件** | 自動儲存，記住開啟中的畫布供更新後恢復；已關閉稿件不會自動重開，未儲存分頁不強制替換。 |
| **Agent 交接與 Git** | 從匯出通知或 Settings 複製交接文字；匯出到 Git 專案時，可同意將 SVG 加入 `.gitignore`。 |

## 最新更新 — 0.2.14

- 記住開啟中的稿件與編輯器分組，重新連線失效畫布，版本更新後補回遺失的已開啟稿件。
- 載入時顯示「Restoring canvas…」，避免看起來像空白新稿；保留正常關閉的稿件狀態，不強制替換未儲存分頁。

## License

[MIT](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)
