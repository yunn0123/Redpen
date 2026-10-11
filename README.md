<!-- Purpose: explain the local VS Code extension, its workflow, and reproducible validation. -->
# UI Feedback

在 VS Code 的編輯分頁中標註實機截圖、拼貼 UI 修改稿，再將圖片與文字需求交給 coding agent。

## 使用

1. 安裝 `.vsix`：VS Code Extensions → `…` → **Install from VSIX…**。
2. 在命令面板執行 **UI Feedback: Open Canvas**，直接開啟空白畫布。
3. 點一下畫布，按 **⌘ V／Ctrl V** 貼上剪貼簿中的圖片，即可開始編輯。也可以按「匯入截圖」選擇 PNG／JPEG／WebP；兩種方式都不會要求先儲存稿件。
4. 框選註解、遮蓋舊設計，或複製原圖中的區塊並拖曳到新位置。選取物件後可補充需求、調整顏色；文字與圖示也可在右側修改。
5. 按 **匯出給 Agent**，選擇檔名並儲存單一 `.svg`。從通知或設定頁按「複製交接 prompt」，再貼給可讀取本機檔案的 agent。

編輯內容自動存放在 VS Code 的插件儲存空間，原圖只保存一份；不必先命名或選擇稿件位置。文字欄位離開時套用，編輯中按 ⌘/Ctrl S 也會套用並暫存。關閉的分頁可用 VS Code 的 **Reopen Closed Editor** 重新開啟。貼上第二張圖片時會新增可移動的圖片元件，也可按「新圖片」選檔。使用選取工具雙擊底圖後貼上，可只替換底圖；既有物件的位置、大小與裁切內容維持不變。在文字欄位內貼上仍是一般文字輸入。

SVG 內含三個獨立群組，並標記為支援圖層的 SVG 編輯器可辨識的圖層：

- **original**：內嵌原始截圖，只存一份。
- **modified**：遮蓋、拼貼、文字、箭頭、圖示與外框等向量物件，疊在原圖上。
- **annotations**：框選、編號、元件名稱與完整註解，文字可直接讀取；預覽時排在修改畫面旁。

不需要附帶 PNG、JSON 或 Markdown。隱藏 `annotations` 可查看修改畫面，再隱藏 `modified` 可查看原圖。SVG 內保留原始座標，截圖外空白為透明；註解文字區使用白底以保持可讀性。取消匯出不會清除畫布。

「設定」可自訂交接 prompt，`{svgPath}` 會替換成最近匯出的檔案路徑，未使用變數時也會附上路徑。設定儲存在 VS Code 插件的使用者儲存空間。

按「匯入截圖」選擇本工具匯出的 SVG，會在新畫布還原原圖、物件與註解。此功能讀取 SVG 內的稿件 metadata，不執行 SVG 內容；若用其他編輯器改動 SVG 的形狀，這些外部變更不會同步回 metadata。一般第三方 SVG 不支援還原為稿件。

若稿件被開成 JSON 文字，在命令面板執行 **View: Reopen Editor With... → UI Feedback**。可以把編輯分頁與 agent 聊天並排，並視需要收起檔案總管以增加畫布空間。

「圖示」直接放置灰色圓圈作為 icon 佔位符，可在側欄描述需求或用簡易鋼筆繪製；每筆可復原，支援清除筆畫。側欄仍保留內建圖示選項與舊稿件相容性。「外框」只畫方形邊線，不強制填寫註解。所有工具按鈕都有 hover 名稱。「UI 元件」提供 Tooltip、Button、Input 等 12 種常見元件的名稱、用途和骨架預覽；選擇後框選目標區域，補充互動需求，匯出會保留元件名稱。點擊右側註解清單會回到該項的需求輸入框。

文字水平與垂直置中，選取文字物件後可用 ⌘/Ctrl ＋／－調整字級，也可在右側輸入 8–200 的字級。截圖外同樣能加入註解、文字、圖示與箭頭，或放置複製的區塊；需要更多空間時可縮小或平移畫布。

需求側欄可用右上角按鈕收合；側欄標題的「＋」新增無指定位置的整體需求，只在 SVG 旁的註解區顯示。選取工具可拖出選取框多選，⌘/Ctrl 點擊切換選取，再一起移動或刪除。獨立圖片與複製區塊可在右側旋轉 90°、水平或垂直鏡像。

## 操作

| 操作 | 快捷鍵 |
| --- | --- |
| 貼上截圖 | 在畫布按 ⌘/Ctrl V |
| 選取／移動畫布 | V／H，或按住 Space 拖曳 |
| 框選註解／遮蓋／複製區塊 | N／M／C |
| 箭頭／文字／圖示／外框 | A／T／I／R |
| 縮放／符合畫面 | ⌘/Ctrl + 滾輪／0 |
| 所選文字的字級 | ⌘/Ctrl ＋／－ |
| 移動所選物件 | 方向鍵；Shift 加速 |
| 刪除／取消操作 | Delete／Escape |
| 復原／重做／儲存 | ⌘/Ctrl Z／⌘/Ctrl Shift Z／⌘/Ctrl S |

遮蓋使用純色填滿並預先取附近背景色，可再自行改色。複製區塊保留裁切來源與目的位置。使用選取工具點擊箭頭，拖曳兩端的圓點調整長度與方向，拖曳箭身移動整支箭頭；按 Delete／Backspace 刪除，復原可還原。匯出維持原始像素比例，範圍自動擴大以容納全部內容，截圖外的空白為透明底。SVG viewBox 會包含截圖外內容，原稿座標不變。複製區塊的來源仍限於原圖內。每張圖片上限 12 MB／1600 萬像素，稿件圖片總量上限 48 MB／6400 萬像素，包含註解文字區的匯出也以 1600 萬像素為上限，超出會提示調整而不截斷註解，每份稿件最多 300 個物件。

## 開發與驗證

```sh
npm install
npm run build
npm run typecheck
npm test
npm run test:e2e
npm run test:vscode
npm run package
```

開發使用 Node.js 24 或更新版本。在 VS Code 開啟此資料夾按 F5，可啟動 Extension Development Host。`npm run dev` 提供 http://127.0.0.1:4173 的瀏覽器測試畫面；此畫面使用生成的測試截圖及模擬 host，匯出僅供自動測試檢查。瀏覽器測試使用本機 Chrome。

頻繁試用修改時，請在 F5 開啟的 Extension Development Host 使用畫布。每次程式修改後執行 `npm run build`，再於該視窗執行 **Developer: Reload Window**，即可載入新程式，不必重新安裝。

`npm run package` 固定輸出 `ui-feedback.vsix`。一般 VS Code 視窗使用的是已安裝副本，需再次 **Install from VSIX…** 並重新載入；覆寫專案中的 VSIX 檔案不會自動更新已安裝的插件。

`npm run test:vscode` 使用本機 VS Code、暫存使用者設定和生成的 PNG，驗證真正的 Webview、空白畫布、圖片貼上事件、儲存、復原／重做及匯出；結束後刪除暫存設定。測試模擬檔案選擇結果並攔截剪貼簿寫入，驗證 SVG 匯出、還原與 prompt 路徑替換，不更改使用者的剪貼簿。預設執行檔為 macOS 的 `/Applications/Visual Studio Code.app/Contents/MacOS/Code`，其他位置可透過 `VSCODE_EXECUTABLE` 指定。

技術：TypeScript、Konva、VS Code Custom Text Editor、esbuild。沒有服務端、帳號、外部 AI 呼叫或雲端上傳。截圖取得由使用者原本的工具負責；第一版不包含 AI 去背、DOM 元件辨識、自動注入 agent 聊天或多人協作。
