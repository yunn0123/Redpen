/** Export a self-contained SVG with real vector layers, readable requirements and recoverable draft metadata. */
import { MAX_IMAGE_BYTES, MAX_PIXELS, kindNames, parseProject, projectAssets, projectBackgrounds, type Item, type Project } from "./model";
import { motionInstructions } from "./motion";
import { iconLibrary, iconLicense } from "./editor/library";

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
      if (line && used + advance > width) {
        // Prefer word boundaries for English; long words and CJK still wrap by character.
        const space = line.lastIndexOf(" ");
        if (space > 0 && char !== " ") {
          result.push(line.slice(0, space)); line = line.slice(space + 1);
          used = Array.from(line).reduce((total, char) => total + (/[\x20-\x7e]/.test(char) ? size * .65 : size), 0);
        } else { result.push(line); line = ""; used = 0; }
      }
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
        return `<g transform="translate(${x} ${y})">${sketch || `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}" fill="#d1d5db"/>`}</g>`;
      }
      const icon = iconLibrary.find(entry => `icon:${entry.id}` === item.text);
      if (icon) {
        const scale = Math.min(w, h) / 28;
        return `<path d="${icon.path}" transform="translate(${x + (w - 24 * scale) / 2} ${y + (h - 24 * scale) / 2}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-size="${Math.min(w, h) * .82}" fill="${color}">${xml(item.text)}</text>`;
    }
    case "text": {
      const size = item.fontSize ?? 22, textLines = lines(item.text || "Text", w, size);
      const first = y + h / 2 - (textLines.length - 1) * size * 1.3 / 2;
      return `<text fill="${color}" font-size="${size}" text-anchor="middle" dominant-baseline="central">${textLines.map((line, i) => `<tspan x="${x + w / 2}" y="${first + i * size * 1.3}">${xml(line)}</tspan>`).join("")}</text>`;
    }
  }
}

/** Build exactly three named layers, embedding the source only once and keeping comments as SVG text. */
export function exportSvg(input: Project, source: string, width: number, height: number, images: Record<string, { data: string; width: number; height: number }> = {}): string {
  const project = parseProject(input);
  if (![width, height].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error("The original image dimensions are invalid.");
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error("The original image must be an embedded PNG, JPEG, or WebP.");
  if (project.items.some(item => ["note", "comment"].includes(item.kind) && !item.comment.trim())) throw new Error("Fill in all annotations first.");
  const assets = projectAssets(project).filter(name => name !== project.image);
  for (const name of assets) {
    const asset = images[name];
    if (!asset || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.data) || asset.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64
      || ![asset.width, asset.height].every(Number.isSafeInteger) || asset.width < 1 || asset.height < 1 || asset.width * asset.height > MAX_PIXELS) throw new Error("The image object data is invalid.");
  }
  const backgrounds = projectBackgrounds(project, width, height);
  let left = Math.min(0, ...backgrounds.map(background => background.x)), top = Math.min(0, ...backgrounds.map(background => background.y));
  let right = Math.max(...backgrounds.map(background => background.x + background.width)), bottom = Math.max(...backgrounds.map(background => background.y + background.height));
  const originals = backgrounds.map(background => background.asset === project.image
    ? `<g data-background="${xml(background.id)}" transform="translate(${background.x} ${background.y}) scale(${background.width / width} ${background.height / height})"><use href="#source-image"/></g>`
    : `<use data-background="${xml(background.id)}" href="#asset-${assets.indexOf(background.asset)}" x="${background.x}" y="${background.y}" width="${background.width}" height="${background.height}"/>`).join("\n");
  for (const item of project.items) {
    if (item.kind === "comment") continue;
    const padding = item.kind === "arrow" ? 14 : 3;
    left = Math.min(left, item.x - padding, item.x + item.width - padding);
    top = Math.min(top, item.y - padding, item.y + item.height - padding);
    right = Math.max(right, item.x + 28, item.x + padding, item.x + item.width + padding);
    bottom = Math.max(bottom, item.y + 24, item.y + padding, item.y + item.height + padding);
    if (item.kind === "text") {
      const textHeight = lines(item.text || "Text", item.width, item.fontSize ?? 22).length * (item.fontSize ?? 22) * 1.3;
      top = Math.min(top, item.y + (item.height - textHeight) / 2 - 3);
      bottom = Math.max(bottom, item.y + (item.height + textHeight) / 2 + 3);
    }
  }
  left = Math.floor(left); top = Math.floor(top); right = Math.ceil(right); bottom = Math.ceil(bottom);
  const panelX = right + 24, panelWidth = 480;
  let cursor = top + 30;
  const notes: string[] = [];
  for (const [index, item] of project.items.entries()) {
    const label = item.component ? `Component note · ${item.component}` : kindNames[item.kind];
    notes.push(`<g id="annotation-${item.id}"${item.kind === "comment" ? "" : ` data-target="item-${item.id}"`}><title>${xml(item.comment)}</title>`);
    const content = [`${index + 1}. ${label}`, item.kind === "comment" ? "No specific location" : `x=${Math.round(item.x)}, y=${Math.round(item.y)}, w=${Math.round(item.width)}, h=${Math.round(item.height)}`];
    if (item.text && item.text !== "placeholder") content.push(`Text / icon: ${item.text}`);
    if (item.fontSize) content.push(`Font size: ${item.fontSize} px`);
    if (item.source) content.push(`Copy source: x=${item.source.x}, y=${item.source.y}, w=${item.source.width}, h=${item.source.height}`);
    if (item.motion) content.push(motionInstructions(item.motion));
    content.push(item.comment || "No written request; refer to the image." );
    for (const line of lines(content.join("\n"), panelWidth - 40, 18)) {
      notes.push(`<text x="${panelX + 20}" y="${cursor}" font-size="18" fill="#202734">${xml(line)}</text>`); cursor += 27;
    }
    for (const reference of item.references ?? []) {
      const image = reference.asset === project.image ? { width, height } : images[reference.asset];
      const scale = Math.min(1, (panelWidth - 40) / image.width, 240 / image.height);
      notes.push(`<text x="${panelX + 20}" y="${cursor}" font-size="16" fill="#202734">Reference [img${reference.id}]</text>`);
      cursor += 12;
      notes.push(reference.asset === project.image
        ? `<svg x="${panelX + 20}" y="${cursor}" width="${image.width * scale}" height="${image.height * scale}" viewBox="0 0 ${width} ${height}"><use href="#source-image"/></svg>`
        : `<use href="#asset-${assets.indexOf(reference.asset)}" x="${panelX + 20}" y="${cursor}" width="${image.width * scale}" height="${image.height * scale}"/>`);
      cursor += image.height * scale + 28;
    }
    notes.push("</g>"); cursor += 22;
  }
  const outputRight = project.items.length ? panelX + panelWidth : right;
  const outputBottom = Math.max(bottom, project.items.length ? cursor : bottom);
  if ((outputRight - left) * (outputBottom - top) > MAX_PIXELS) throw new Error("The export exceeds 16 million pixels. Move objects closer together or split the draft. Annotations will not be truncated.");
  const modified = project.items.filter(item => !["note", "comment"].includes(item.kind)).map(item => `<g id="item-${item.id}">${shape(item, assets)}</g>`).join("\n");
  const markers = project.items.map((item, i) => item.kind === "comment" ? "" : `${item.kind === "note" ? `<g id="item-${item.id}">${shape(item, assets)}</g>` : ""}<g><rect x="${item.x}" y="${item.y}" width="28" height="24" rx="3" fill="${item.color}"/><text x="${item.x + 14}" y="${item.y + 17}" font-size="14" fill="white" text-anchor="middle">${i + 1}</text></g>`).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${outputRight - left}" height="${outputBottom - top}" viewBox="${left} ${top} ${outputRight - left} ${outputBottom - top}" font-family="sans-serif">
<title>redpen</title><desc>original contains all fixed background screenshots; modified contains editable changes over the original; annotations contains numbered markers, object types, and full requests. Coordinates use a shared canvas origin; annotations may span multiple backgrounds.</desc>
${project.items.some(item => item.kind === "stamp" && iconLibrary.some(icon => item.text === `icon:${icon.id}`)) ? `<metadata id="redpen-icon-license">${xml(iconLicense)}</metadata>` : ""}
<metadata id="redpen-draft">${xml(JSON.stringify({ project, width, height }))}</metadata>
<defs><image id="source-image" width="${width}" height="${height}" href="${source}"/>${assets.map((name, i) => `<symbol id="asset-${i}" viewBox="0 0 ${images[name].width} ${images[name].height}" preserveAspectRatio="none"><image id="raster-${i}" data-asset="${xml(name)}" width="${images[name].width}" height="${images[name].height}" href="${images[name].data}"/></symbol>`).join("")}</defs>
<g id="original" inkscape:groupmode="layer" inkscape:label="original">${originals}</g>
<g id="modified" inkscape:groupmode="layer" inkscape:label="modified">${modified}</g>
<g id="annotations" inkscape:groupmode="layer" inkscape:label="annotations">${markers}${project.items.length ? `<rect x="${panelX}" y="${top}" width="${panelWidth}" height="${outputBottom - top}" fill="#ffffff"/>` : ""}${notes.join("\n")}</g>
</svg>`;
}

/** Recover only our data envelope; imported SVG markup is never executed or rendered. */
export function readRedpenSvg(svg: string): { project: Project; source: string; images?: Record<string, { data: string; width: number; height: number }> } {
  if (svg.length > 75_000_000) throw new Error("The SVG draft is too large.");
  // Accept the original marker when reopening exports made before the rename.
  const metadata = /<metadata id="(?:redpen|ui-feedback)-draft">([^<]*)<\/metadata>/.exec(svg)?.[1];
  const source = /<image id="source-image"[^>]* href="(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})"\s*\/>/.exec(svg)?.[1];
  if (!metadata || !source) throw new Error("Choose an SVG draft exported by redpen.");
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const data = JSON.parse(metadata.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name]));
  const images: Record<string, { data: string; width: number; height: number }> = {};
  for (const match of svg.matchAll(/<image id="raster-\d+" data-asset="([^"]+)" width="(\d+)" height="(\d+)" href="(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})"\s*\/>/g)) {
    const name = match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => entities[key]);
    images[name] = { data: match[4], width: Number(match[2]), height: Number(match[3]) };
  }
  const project = parseProject(data.project);
  for (const name of projectAssets(project)) if (name !== project.image && !images[name]) throw new Error("The SVG is missing an image object.");
  return { project, source, ...(Object.keys(images).length ? { images } : {}) };
}
