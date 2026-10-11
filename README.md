<!-- Purpose: introduce redpen with a short workflow and real editor examples. -->
# redpen

**拿紅筆批改 AI 的 UI 答卷。**

把實機截圖貼進 VS Code 畫布，圈出問題、寫下需求、拼貼修改，再交給 agent。
輕量、本機執行，不必先存稿，也不需要帳號或 AI API。

## 怎麼用

1. 執行 **redpen: Open Canvas**，按 **⌘/Ctrl V** 貼上截圖。
2. 框選並寫註解，或用遮蓋、箭頭、文字與複製區塊畫出修改。
3. 按 **匯出給 Agent**，儲存 SVG；複製交接 prompt，將檔案路徑交給 agent。

![redpen 操作：貼上截圖、框選註解、複製移動元件，再匯出](https://raw.githubusercontent.com/yunn0123/Redpen/main/docs/images/workflow.gif)

*示範錄自同一套畫布的瀏覽器預覽，使用生成的測試截圖。*

## 匯出長這樣

一個 SVG 就包含 **原圖、修改物件、註解** 三層；需求直接排在畫面旁。
可重新匯入 redpen 繼續編輯，截圖外空白維持透明。

![redpen 匯出示例：修改畫面與右側編號需求](https://raw.githubusercontent.com/yunn0123/Redpen/main/docs/images/example.png)

## 小技巧

- **貼上新圖**：新增圖片元件；雙擊底圖再貼上，只替換底圖。
- **多選**：用選取工具拖曳框選；⌘/Ctrl 點擊切換選取，Delete 刪除。
- **調整圖片**：側欄可旋轉、鏡像；標題旁的 ＋ 可新增整體需求。
- **復原／重做**：⌘/Ctrl Z／⌘/Ctrl Shift Z。編輯內容自動暫存。

## 安裝與開發

目前使用 VSIX 安裝：執行 `npm install`、`npm run package`，再到 VS Code 的 Extensions → **Install from VSIX…** 選擇產出的 `.vsix`。
更新已安裝版本後執行 **Developer: Reload Window**。

開發環境：Node.js 24+。`npm run build` 後按 F5 測試插件；`npm run dev` 開啟瀏覽器預覽。
驗證：`npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run test:vscode`（需本機 VS Code）。

## License

[MIT](LICENSE) · [第三方授權](THIRD_PARTY_NOTICES.md)
