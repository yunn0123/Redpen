/** Shared document format and validation keep saved drafts and agent exports consistent. */
export const MAX_ITEMS = 300;
export const MAX_PIXELS = 16_000_000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_HANDOFF_PROMPT = "請讀取 {svgPath}，依照 original／modified／annotations 三層資訊修改目前專案。註解是可讀文字；保留未要求變更的功能，需求不明確時先詢問。";
export const kinds = ["note", "cover", "crop", "arrow", "text", "stamp", "outline", "image", "comment"] as const;
export type Kind = typeof kinds[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Item = Rect & {
  id: string; kind: Kind; color: string; text: string; comment: string;
  source?: Rect;
  fontSize?: number;
  component?: string;
  strokes?: number[][];
  asset?: string;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
};
export type Project = { version: 1; image: string; items: Item[] };
export const kindNames: Record<Kind, string> = {
  note: "區域註解", cover: "遮蓋", crop: "複製區塊", arrow: "箭頭", text: "文字", stamp: "圖示", outline: "外框", image: "圖片", comment: "整體需求",
};

/** Allow only sibling raster assets so a draft cannot request arbitrary local files. */
export function validAsset(value: unknown): value is string {
  return typeof value === "string" && value.length <= 240 && !/[/\\\u0000-\u001f]/.test(value) && /\.(png|jpe?g|webp)$/i.test(value);
}

/** Collect immutable assets once, including crop sources retained when the background is replaced. */
export function projectAssets(project: Project): string[] {
  return [...new Set([project.image, ...project.items.map(item => item.asset)].filter((name): name is string => Boolean(name)))];
}

/** Reject malformed or excessive geometry before it reaches the renderer. */
function validRect(value: unknown, signed = false): value is Rect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Rect;
  return [rect.x, rect.y, rect.width, rect.height].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000)
    && (signed || (rect.width >= 1 && rect.height >= 1));
}

/** A draft may reference only a sibling raster image, never an arbitrary filesystem path. */
export function parseProject(value: unknown): Project {
  if (!value || typeof value !== "object") throw new Error("稿件內容不是有效物件。");
  const project = value as Project;
  if (project.version !== 1) throw new Error("不支援此稿件版本。");
  if (typeof project.image !== "string" || project.image.length > 240 || /[/\\\u0000-\u001f]/.test(project.image)
    || (project.image !== "" && !/\.(png|jpe?g|webp)$/i.test(project.image))) throw new Error("截圖必須是稿件旁的 PNG、JPEG 或 WebP 檔案。");
  if (!Array.isArray(project.items) || project.items.length > MAX_ITEMS) throw new Error(`每份稿件最多 ${MAX_ITEMS} 個物件。`);
  if (!project.image && project.items.length) throw new Error("請先貼上圖片，再加入標註。");
  const ids = new Set<string>();
  const items = project.items.map((item): Item => {
    if (!item || !kinds.includes(item.kind) || !validRect(item, item.kind === "arrow")) throw new Error("稿件含有無效的物件或座標。");
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error("物件識別碼無效或重複。");
    ids.add(item.id);
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error("物件顏色格式錯誤。");
    if (typeof item.text !== "string" || item.text.length > 2000 || typeof item.comment !== "string" || item.comment.length > 8000) throw new Error("物件文字過長或格式錯誤。");
    if (item.fontSize !== undefined && (item.kind !== "text" || !Number.isInteger(item.fontSize) || item.fontSize < 8 || item.fontSize > 200)) throw new Error("文字字級必須為 8 至 200 的整數。");
    if (item.component !== undefined && (item.kind !== "note" || typeof item.component !== "string" || !/^[A-Za-z][A-Za-z0-9 ]{0,79}$/.test(item.component))) throw new Error("UI 元件名稱格式無效。");
    if (item.strokes !== undefined && (item.kind !== "stamp" || !Array.isArray(item.strokes) || item.strokes.length > 100
      || item.strokes.some(stroke => !Array.isArray(stroke) || stroke.length < 4 || stroke.length > 2000 || stroke.length % 2 !== 0
        || stroke.some(point => typeof point !== "number" || !Number.isFinite(point) || point < 0 || point > 1)))) throw new Error("圖示筆畫格式無效或超過上限。");
    if (item.kind === "crop" && (!validRect(item.source) || item.source.x < 0 || item.source.y < 0)) throw new Error("複製區塊的來源範圍無效。");
    const raster = item.kind === "image" || item.kind === "crop";
    if (item.kind === "image" && !validAsset(item.asset) || item.asset !== undefined && (!raster || !validAsset(item.asset))) throw new Error("圖片元件來源無效。");
    if (item.rotation !== undefined && (!raster || ![0, 90, 180, 270].includes(item.rotation))) throw new Error("圖片旋轉角度無效。");
    if ([item.flipX, item.flipY].some(value => value !== undefined && (!raster || typeof value !== "boolean"))) throw new Error("圖片鏡像格式無效。");
    return {
      id: item.id, kind: item.kind, x: item.x, y: item.y, width: item.width, height: item.height,
      color: item.color, text: item.text, comment: item.comment,
      ...(item.fontSize !== undefined ? { fontSize: item.fontSize } : {}),
      ...(item.component !== undefined ? { component: item.component } : {}),
      ...(item.strokes !== undefined ? { strokes: item.strokes.map(stroke => [...stroke]) } : {}),
      ...(item.asset !== undefined ? { asset: item.asset } : {}),
      ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
      ...(item.flipX !== undefined ? { flipX: item.flipX } : {}),
      ...(item.flipY !== undefined ? { flipY: item.flipY } : {}),
      ...(item.kind === "crop" ? { source: { ...item.source! } } : {}),
    };
  });
  return { version: 1, image: project.image, items };
}

/** Normalize screenshot-space gestures; only crop sources need image bounds. */
export function selectionRect(start: { x: number; y: number }, end: { x: number; y: number }, bounds?: { width: number; height: number }): Rect {
  if (!bounds) return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  const x1 = Math.max(0, Math.min(bounds.width, start.x));
  const y1 = Math.max(0, Math.min(bounds.height, start.y));
  const x2 = Math.max(0, Math.min(bounds.width, end.x));
  const y2 = Math.max(0, Math.min(bounds.height, end.y));
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** Describe locations in screenshot pixels so agent instructions survive canvas zoom changes. */
function describeRect(rect: Rect): string {
  return `x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}`;
}

/** Export user intent verbatim without guessing behavior from visual decorations. */
export function agentMarkdown(project: Project, dimensions: { width: number; height: number; sourceWidth?: number; sourceHeight?: number; originX?: number; originY?: number }): string {
  const lines = [
    "# UI 修改需求", "", "請一併閱讀 modified.png 與以下需求，再修改目前專案。",
    "圖中的遮蓋、箭頭與拼貼用來表達修改意圖；未註明的細節請先釐清，不要推測互動邏輯。", "",
    `截圖尺寸：${dimensions.sourceWidth ?? dimensions.width} × ${dimensions.sourceHeight ?? dimensions.height} px。所有座標皆以原始截圖左上角為原點。`,
    `匯出尺寸：${dimensions.width} × ${dimensions.height} px。原圖左上角在 modified.png 的位置：x=${-(dimensions.originX ?? 0)}, y=${-(dimensions.originY ?? 0)}。截圖外空白為透明；註解座標加上此位移即為匯出圖座標。`,
    `原始截圖：[${project.image.replace(/[\[\]]/g, "")}](${encodeURIComponent(project.image).replace(/\(/g, "%28").replace(/\)/g, "%29")})`, "",
  ];
  project.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${kindNames[item.kind]}`, "", `位置：${describeRect(item)}。`);
    if (item.component) lines.push(`UI 元件：${item.component}。`);
    if (item.kind === "text") lines.push(`字級：${item.fontSize ?? 22} px；文字水平與垂直置中。`);
    if (item.source) lines.push(`複製來源：${describeRect(item.source)}。`);
    if (item.kind === "arrow") lines.push(`箭頭終點：x=${Math.round(item.x + item.width)}, y=${Math.round(item.y + item.height)}。`);
    if (item.kind === "cover") lines.push(`遮蓋填色：${item.color}。`);
    if (item.text) lines.push("", "顯示文字：", "", item.text);
    if (item.comment.trim()) lines.push("", "使用者需求：", "", item.comment.trim());
    else lines.push("", "未附文字需求；請參考修改稿中的位置與外觀。");
    lines.push("");
  });
  return lines.join("\n");
}
