/** Export a self-contained SVG with real vector layers, readable requirements and recoverable draft metadata. */
import { MAX_IMAGE_BYTES, MAX_PIXELS, kindNames, parseProject, projectAssets, type Item, type Project } from "./model";
import { iconLibrary } from "./editor/library";

/** Escape user text once at the XML boundary, including characters illegal in XML 1.0. */
export function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "�").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Wrap without truncation; conservative character widths keep mixed CJK and Latin notes readable. */
function lines(text: string, width: number, size: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "", used = 0;
    for (const char of Array.from(paragraph)) {
      const advance = /[\x20-\x7e]/.test(char) ? size * .65 : size;
      if (line && used + advance > width) { result.push(line); line = ""; used = 0; }
      line += char; used += advance;
    }
    result.push(line);
  }
  return result;
}

/** Serialize editable primitives rather than flattening the modified layer to a bitmap. */
function shape(item: Item, assets: string[]): string {
  const { x, y, width: w, height: h, color } = item;
  const rect = `x="${x}" y="${y}" width="${w}" height="${h}"`;
  switch (item.kind) {
    case "cover": return `<rect ${rect} fill="${color}"/>`;
    case "outline": return `<rect ${rect} fill="none" stroke="${color}" stroke-width="2"/>`;
    case "note": return `<rect ${rect} fill="${color}" fill-opacity="0.035" stroke="${color}" stroke-width="2"/>`;
    case "comment": return "";
    case "image":
    case "crop": {
      const rotation = item.rotation ?? 0;
      const drawW = rotation % 180 ? h : w, drawH = rotation % 180 ? w : h;
      const assetId = item.asset && assets.includes(item.asset) ? `${item.kind === "crop" ? "raster" : "asset"}-${assets.indexOf(item.asset)}` : "source-image";
      const source = item.source;
      const content = source
        ? `<svg x="${-drawW / 2}" y="${-drawH / 2}" width="${drawW}" height="${drawH}" viewBox="${source.x} ${source.y} ${source.width} ${source.height}" preserveAspectRatio="none" overflow="hidden"><use href="#${assetId}"/></svg>`
        : `<use href="#${assetId}" x="${-drawW / 2}" y="${-drawH / 2}" width="${drawW}" height="${drawH}"/>`;
      return `<g transform="translate(${x + w / 2} ${y + h / 2}) rotate(${rotation}) scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1})">${content}</g>`;
    }
    case "arrow": {
      const length = Math.hypot(w, h), ux = length ? w / length : 1, uy = length ? h / length : 0;
      const endX = x + w, endY = y + h;
      return `<path d="M${x} ${y}L${endX} ${endY}" stroke="${color}" stroke-width="3" fill="none"/><path d="M${endX} ${endY}L${endX - 12 * ux + 6 * uy} ${endY - 12 * uy - 6 * ux}L${endX - 12 * ux - 6 * uy} ${endY - 12 * uy + 6 * ux}Z" fill="${color}"/>`;
    }
    case "stamp": {
      if (item.text === "placeholder") {
        const sketch = (item.strokes ?? []).map(stroke => `<polyline points="${stroke.map((p, i) => p * (i % 2 ? h : w)).join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
        return `<g transform="translate(${x} ${y})"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="#d1d5db"/>${sketch}</g>`;
      }
      const icon = iconLibrary.find(entry => `icon:${entry.id}` === item.text);
      if (icon) {
        const scale = Math.min(w, h) / 28;
        return `<path d="${icon.path}" transform="translate(${x + (w - 24 * scale) / 2} ${y + (h - 24 * scale) / 2}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(w, h) * .82}" fill="${color}">${xml(item.text)}</text>`;
    }
    case "text": {
      const size = item.fontSize ?? 22, textLines = lines(item.text || "文字", w, size);
      const first = y + h / 2 - (textLines.length - 1) * size * 1.3 / 2;
      return `<text fill="${color}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${textLines.map((line, i) => `<tspan x="${x + w / 2}" y="${first + i * size * 1.3}">${xml(line)}</tspan>`).join("")}</text>`;
    }
  }
}

/** Build exactly three named layers, embedding the source only once and keeping comments as SVG text. */
export function exportSvg(input: Project, source: string, width: number, height: number, images: Record<string, { data: string; width: number; height: number }> = {}): string {
  const project = parseProject(input);
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error("原圖尺寸無效。");
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error("原圖必須為內嵌 PNG、JPEG 或 WebP。");
  if (project.items.some(item => ["note", "comment"].includes(item.kind) && !item.comment.trim())) throw new Error("請先填寫所有註解。");
  const assets = projectAssets(project).filter(name => name !== project.image);
  for (const name of assets) {
    const asset = images[name];
    if (!asset || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.data) || asset.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
      || ![asset.width, asset.height].every(Number.isSafeInteger) || asset.width < 1 || asset.height < 1 || asset.width * asset.height > MAX_PIXELS) throw new Error("圖片元件資料無效。");
  }
  let left = 0, top = 0, right = width, bottom = height;
  for (const item of project.items) {
    if (item.kind === "comment") continue;
    const padding = item.kind === "arrow" ? 14 : 3;
    left = Math.min(left, item.x - padding, item.x + item.width - padding);
    top = Math.min(top, item.y - padding, item.y + item.height - padding);
    right = Math.max(right, item.x + 28, item.x + padding, item.x + item.width + padding);
    bottom = Math.max(bottom, item.y + 24, item.y + padding, item.y + item.height + padding);
    if (item.kind === "text") {
      const textHeight = lines(item.text || "文字", item.width, item.fontSize ?? 22).length * (item.fontSize ?? 22) * 1.3;
      top = Math.min(top, item.y + (item.height - textHeight) / 2 - 3);
      bottom = Math.max(bottom, item.y + (item.height + textHeight) / 2 + 3);
    }
  }
  left = Math.floor(left); top = Math.floor(top); right = Math.ceil(right); bottom = Math.ceil(bottom);
  const panelX = right + 24, panelWidth = 480;
  let cursor = top + 30;
  const notes: string[] = [];
  for (const [index, item] of project.items.entries()) {
    const label = item.component ? `元件註解 · ${item.component}` : kindNames[item.kind];
    notes.push(`<g id="annotation-${item.id}"${item.kind === "comment" ? "" : ` data-target="item-${item.id}"`}><title>${xml(item.comment)}</title>`);
    const content = [`${index + 1}. ${label}`, item.kind === "comment" ? "無指定位置" : `x=${Math.round(item.x)}, y=${Math.round(item.y)}, w=${Math.round(item.width)}, h=${Math.round(item.height)}`];
    if (item.text && item.text !== "placeholder") content.push(`文字／圖示：${item.text}`);
    if (item.fontSize) content.push(`字級：${item.fontSize} px`);
    if (item.source) content.push(`複製來源：x=${item.source.x}, y=${item.source.y}, w=${item.source.width}, h=${item.source.height}`);
    content.push(item.comment || "未附文字需求；請參考畫面。" );
    for (const line of lines(content.join("\n"), panelWidth - 40, 18)) {
      notes.push(`<text x="${panelX + 20}" y="${cursor}" font-size="18" fill="#202734">${xml(line)}</text>`); cursor += 27;
    }
    notes.push("</g>"); cursor += 22;
  }
  const outputRight = project.items.length ? panelX + panelWidth : right;
  const outputBottom = Math.max(bottom, project.items.length ? cursor : bottom);
  if ((outputRight - left) * (outputBottom - top) > MAX_PIXELS) throw new Error("匯出範圍超過 1600 萬像素，請縮小物件間距或分成多份稿件；註解不會被截斷。");
  const modified = project.items.filter(item => !["note", "comment"].includes(item.kind)).map(item => `<g id="item-${item.id}">${shape(item, assets)}</g>`).join("\n");
  const markers = project.items.map((item, i) => item.kind === "comment" ? "" : `${item.kind === "note" ? `<g id="item-${item.id}">${shape(item, assets)}</g>` : ""}<g><rect x="${item.x}" y="${item.y}" width="28" height="24" rx="3" fill="${item.color}"/><text x="${item.x + 14}" y="${item.y + 17}" font-size="14" fill="white" text-anchor="middle">${i + 1}</text></g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${outputRight - left}" height="${outputBottom - top}" viewBox="${left} ${top} ${outputRight - left} ${outputBottom - top}" font-family="sans-serif">
<title>redpen</title><desc>original 是原圖；modified 是可編輯的修改物件，疊於 original 上；annotations 包含編號、元件種類與完整文字需求。座標以原圖左上角為原點。</desc>
<metadata id="ui-feedback-draft">${xml(JSON.stringify({ project, width, height }))}</metadata>
<defs><image id="source-image" width="${width}" height="${height}" href="${source}"/>${assets.map((name, i) => `<symbol id="asset-${i}" viewBox="0 0 ${images[name].width} ${images[name].height}" preserveAspectRatio="none"><image id="raster-${i}" data-asset="${xml(name)}" width="${images[name].width}" height="${images[name].height}" href="${images[name].data}"/></symbol>`).join("")}</defs>
<g id="original" inkscape:groupmode="layer" inkscape:label="original"><use href="#source-image"/></g>
<g id="modified" inkscape:groupmode="layer" inkscape:label="modified">${modified}</g>
<g id="annotations" inkscape:groupmode="layer" inkscape:label="註解">${markers}${project.items.length ? `<rect x="${panelX}" y="${top}" width="${panelWidth}" height="${outputBottom - top}" fill="#ffffff"/>` : ""}${notes.join("\n")}</g>
</svg>`;
}

/** Recover only our data envelope; imported SVG markup is never executed or rendered. */
export function readFeedbackSvg(svg: string): { project: Project; source: string; images?: Record<string, { data: string; width: number; height: number }> } {
  if (svg.length > 75_000_000) throw new Error("SVG 稿件過大。");
  const metadata = /<metadata id="ui-feedback-draft">([^<]*)<\/metadata>/.exec(svg)?.[1];
  const source = /<image id="source-image"[^>]* href="(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})"\s*\/>/.exec(svg)?.[1];
  if (!metadata || !source) throw new Error("請選擇由 redpen 匯出的 SVG 稿件。");
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const data = JSON.parse(metadata.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name]));
  const images: Record<string, { data: string; width: number; height: number }> = {};
  for (const match of svg.matchAll(/<image id="raster-\d+" data-asset="([^"]+)" width="(\d+)" height="(\d+)" href="(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})"\s*\/>/g)) {
    const name = match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => entities[key]);
    images[name] = { data: match[4], width: Number(match[2]), height: Number(match[3]) };
  }
  const project = parseProject(data.project);
  for (const name of projectAssets(project)) if (name !== project.image && !images[name]) throw new Error("SVG 缺少圖片元件。");
  return { project, source, ...(Object.keys(images).length ? { images } : {}) };
}
