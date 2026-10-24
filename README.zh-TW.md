<!-- Purpose: provide the Traditional Chinese introduction and installation guide for redpen. -->
[English](README.md) | [繁體中文](README.zh-TW.md)

<img src="docs/images/redpen-logo.png" width="96" alt="redpen 紅筆 logo">

# redpen

**拿紅筆批改 AI 的 UI 答卷。**

把截圖貼進 VS Code 畫布，圈出問題、寫下需求，再交給 coding agent。
輕量、本機執行，不需要帳號或 AI API key，貼上就能開始。

## 快速開始

1. 在 VS Code 按 **Shift+Command+P**（macOS）或 **Shift+Ctrl+P**（Windows/Linux），開啟命令面板。
2. 輸入 **`redpen`**，選擇 **redpen: Open Canvas**，按 **Enter**。
3. 按 **Command+V / Ctrl+V** 貼上截圖，開始標註。

![貼上截圖、框選區域、輸入需求，再交給 agent](docs/images/workflow.gif)

*影片統一以英文呈現，使用實際畫布錄製；最後的 agent 交接畫面為示意。*

## 更新內容

### 0.2.13

- 新增物件後立即選取，可直接移動、縮放；在空白畫布拖曳可繼續使用同一新增工具，手動點 Select 則回到一般選取模式。Enter 完成輸入，保留中文組字操作。
- 註解操作整合為帶有 tooltip 的圖示按鈕，可在既有需求加入、更換或移除元件類型與動效規格；參考圖可直接貼入需求欄位，或在附件面板貼上／拖入。
- 圖片檔可拖入畫布作為固定底圖，或拖入 New image 作為可移動圖片元件；繪圖經過註解小標時不再中斷。
- 保存狀態移到 Requests 標題列，通知改為底部置中，畫布操作說明放在圖片後方；Settings 加入分隔線與複製圖示，複製成功顯示勾號。

### 0.2.12

- 指令面板新增 **redpen: Open Recent Canvas**，可重開本機舊稿；**redpen: Delete Saved Canvases** 可勾選並確認永久刪除稿件，保留其他稿件使用中的圖片，已匯出的 SVG 不受影響。
- 大型 SVG 匯出改為縮小預設顯示尺寸，完整內容、原始圖片、座標與可編輯資料都保留；刪除底圖後，不再包含到畫布原點的多餘空白。
- 直接更新插件並保留本機儲存資料，即可保留舊稿；請回到同一工作區／視窗重新開啟。

### 0.2.11

- 畫布註解浮窗可拖曳標題移位，方便邊輸入邊查看圖片，保留文字焦點、游標與中文組字狀態。
- 浮窗限制在畫布範圍內，同一次開啟期間保留位置，關閉再開啟回到預設位置；也可聚焦標題後以方向鍵移動。

### 0.2.10

- 同一畫布可連續貼上多張固定底圖，依序排在右側並留 64px 間隔，註解與箭頭可跨圖。使用 Select 雙擊底圖可替換或刪除；註解及其餘底圖維持原位，最後一張不可刪除。New image 保留為可移動圖片元件。
- 註解輸入框支援貼上或選檔新增參考圖片，以 `[img1]` 標記對應縮圖；參考圖會嵌入 SVG，重新匯入後可繼續編輯。
- 加入 18 種離線 Motion 動效需求，包含輪播、水平視差、固定水平圖庫、卡片堆疊、跑馬燈與共享佈局互動，提供可操作預覽及 agent 可讀的文字規格。
- 工具列按鈕可在各自群組內拖曳排序，顯示插入線並保存偏好；也支援 Alt+方向鍵與重設順序。

### 0.2.9

- 窄視窗工具自動換行，所有繪圖工具保持可操作。
- 匯出按鈕加入 Export 文字，整理 Requests 面板間距與閱讀層級。
- 更新 Enter／Shift+Enter 輸入提示，選取狀態與按鈕配色跟隨 VS Code 主題。

### 0.2.8

- 新增物件後自動聚焦註解輸入框；文字物件直接編輯文字。Enter 完成輸入、Shift+Enter 換行，中文組字／選字不會提前結束編輯。
- 修正新增文字或圖示時畫布搶走鍵盤焦點的問題，完成輸入後仍保留目前繪圖工具。
- 匯出 SVG 到本機 Git 專案後，可同意將該檔案加入 `.gitignore`；已忽略或已追蹤的檔案不再詢問。
- 在操作示範上方加入命令面板快速啟動步驟。

### 0.2.7

- 使用後保留目前繪圖工具，可連續新增註解或圖形；需要移動物件時再切換 Select。
- 離線 Lucide 圖示由 20 個擴充至 82 個，新增導覽、檔案、通訊、購物與裝置等圖示，可繼續編輯並匯出 SVG。

## 在 VS Code 安裝

前往 [redpen 的 VS Code Marketplace 頁面](https://marketplace.visualstudio.com/items?itemName=yunn030123.redpen-ui-markup)，點擊 **Install**，依提示在 VS Code 中安裝。
也可以在 VS Code 開啟擴充功能頁（**⌘⇧X / Ctrl+Shift+X**），搜尋 `yunn030123.redpen-ui-markup` 安裝。

## 在 VS Code 開啟畫布

**不需要開啟任何資料夾或專案，在空白的 VS Code 視窗就能編輯。** 不用設定 Node.js、執行建置指令，也不需手動安裝 VSIX。

1. **開啟畫布**：在 VS Code 按 **⌘⇧P**（macOS）或 **Ctrl+Shift+P**（Windows/Linux）開啟命令面板，搜尋 **redpen: Open Canvas**，按 Enter。出現 **redpen Canvas** 分頁後就能開始，不用先命名或儲存稿件。
2. **貼上截圖**：點一下畫布，再按 **⌘V / Ctrl+V**；或按 **Import** 選取 PNG、JPEG、WebP。也能在檔案總管對圖片按右鍵 → **redpen: Open Canvas**。
3. **描述修改**：選 **Annotate**，框選要改的區域，在註解浮窗輸入需求。也能用遮蓋、箭頭、文字、圖示和複製區塊畫出修改結果。
4. **匯出**：按 **Export for Agent**，選擇位置，儲存成一個 SVG。
5. **交給 agent**：在 VS Code 匯出成功通知按 **Copy handoff prompt**，再貼進 agent 對話。Prompt 會包含 SVG 路徑；若 agent 無法讀取該路徑，請一併附上 SVG。

首次使用會跳出引導通知，按 **Open guide** 開啟指南。之後可執行 **redpen: Show Getting Started** 再次查看。

## 一個檔案，三個圖層

SVG 包含 **original 原圖、modified 修改物件、annotations 註解** 三層，編號需求直接排在畫面旁。
匯入 redpen 就能繼續編輯；匯出範圍會自動涵蓋所有物件，截圖外的空白維持透明。

![修改畫面與右側編號需求](docs/images/example.png)

## 小技巧

- **新增後調整**：新增物件會自動選取，可直接移動、縮放，並聚焦需求欄位；在空白畫布拖曳會繼續使用同一新增工具，手動點 Select 則回到一般選取模式。Enter 完成輸入、Shift+Enter 換行，中文組字確認不會直接結束輸入；圖片檔也可直接拖入畫布作為底圖。

- **動效需求**：開啟 **Components & motions → Motion** 預覽效果，加入已選物件或框選新區域。內建 18 種離線動效，分為互動元件（輪播、滑動卡片、跑馬燈、分頁指示器與展開卡片）、捲動效果（水平視差、固定水平圖庫、卡片堆疊、圖片揭露與 Hero 縮放）及基礎效果。預覽可切換、拖曳或用進度滑桿模擬捲動；匯出包含觸發、邊界、時間、循環與減少動態效果的文字指引，交接不依賴 GIF 或特定動畫庫。
- **工具排序**：在左右工具列各自的群組內拖曳按鈕，插入線會提示放置位置；也可聚焦按鈕後按 **Alt+方向鍵** 調整。順序會保存，可到 Settings 重設。
- **參考圖片**：在註解輸入框直接貼圖，或按下方 **Add reference image** 圖示開啟貼上／拖入區，也保留選檔入口。文字會插入 `[img1]` 標記，縮圖可放大預覽或移除。每則需求最多 8 張；匯出 SVG 時圖片嵌入對應需求下方，重新匯入後可繼續編輯。
- **懸浮工具列**：繪圖工具放在左上；復原、匯入、匯出和 Requests 開關放在右上。Requests 預設收起，展開後與右上工具列相連，浮在畫布上。
- **收合工具**：按 **Collapse drawing tools**，收起時只顯示目前工具；懸停或鍵盤聚焦時展開，偏好會記住。縮放控制改放左下直排。
- **手繪圖示**：畫下筆畫後灰色佔位底消失，匯出的 SVG 也只保留筆畫；清除筆畫後恢復佔位底。
- **畫布註解**：懸停在編號註解圖示上查看需求，點文字框即可編輯。打字時浮窗會保持開啟，按 Escape 或離開欄位套用變更；**More options** 可開啟側欄。

- **多頁截圖**：直接貼圖會新增固定底圖，依序排在右側並留 64px 間隔，註解與箭頭可跨圖。使用 Select 雙擊底圖後可替換或刪除；註解與其餘底圖維持原位，最後一張底圖不可刪除。**New image** 保留為可移動、帶有自己註解的圖片元件。
- **選取與編輯**：使用 Select 拖曳多選，⌘/Ctrl 點擊切換選取；拖曳箭頭端點調整長度與方向，Delete 刪除物件。
- **側欄工具**：旋轉、鏡像圖片；Requests 旁的 **＋** 可新增整體需求。
- **復原／重做**：⌘/Ctrl Z／⌘/Ctrl Shift Z。新畫布會自動暫存在本機。

## 通知與稿件

- 指令面板的 **redpen: Open Recent Canvas** 可重新開啟目前工作區／視窗的本機舊稿；**redpen: Delete Saved Canvases** 可勾選刪除稿件。關閉畫布分頁並確認後才永久刪除，同時清理未使用圖片；已匯出的 SVG 不受影響。


- 匯出到本機 Git 專案後，可選擇 **Add to .gitignore**，只忽略該 SVG；同意後才寫入，已忽略或已追蹤的檔案不再詢問。
- 通知統一以 **redpen:** 開頭。匯出成功可按 **Copy handoff prompt**；錯誤會提示需要修正的問題。取消儲存視窗不會匯出檔案。
- 錯過匯出通知？按畫布 Settings 標題列的 **Copy handoff prompt** 圖示複製，也能在這裡修改 prompt；`{svgPath}` 會填入匯出檔案路徑。
- 新畫布自動暫存在本機。內部 `.redpen.json` 是編輯稿件，交給 agent 時使用匯出的 SVG。
- 按 **Import** 匯入 redpen SVG，即可繼續編輯。若舊稿件顯示成 JSON，選 **Reopen Editor With… → redpen Canvas**。

## License

[MIT](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)
