/** Shared document format and validation keep saved drafts and agent exports consistent. */
export const MAX_ITEMS = 300;
export const MAX_PIXELS = 16_000_000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_HANDOFF_PROMPT = "Read {svgPath} and update the current project using its original, modified, and annotations layers. Annotations contain readable text. Preserve functionality unless a change is requested, and ask for clarification when requirements are unclear.";
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
  note: "Region note", cover: "Cover", crop: "Copy region", arrow: "Arrow", text: "Text", stamp: "Icon", outline: "Outline", image: "Image", comment: "General request",
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
  if (!value || typeof value !== "object") throw new Error("The draft must contain a valid object.");
  const project = value as Project;
  if (project.version !== 1) throw new Error("This draft version is not supported.");
  if (typeof project.image !== "string" || project.image.length > 240 || /[/\\\u0000-\u001f]/.test(project.image)
    || (project.image !== "" && !/\.(png|jpe?g|webp)$/i.test(project.image))) throw new Error("The screenshot must be a PNG, JPEG, or WebP file in the same folder as the draft.");
  if (!Array.isArray(project.items) || project.items.length > MAX_ITEMS) throw new Error(`Each draft supports up to ${MAX_ITEMS} objects.`);
  if (!project.image && project.items.length) throw new Error("Paste an image before adding annotations.");
  const ids = new Set<string>();
  const items = project.items.map((item): Item => {
    if (!item || !kinds.includes(item.kind) || !validRect(item, item.kind === "arrow")) throw new Error("The draft contains invalid objects or coordinates.");
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error("Object IDs are invalid or duplicated.");
    ids.add(item.id);
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error("The object color format is invalid.");
    if (typeof item.text !== "string" || item.text.length > 2000 || typeof item.comment !== "string" || item.comment.length > 8000) throw new Error("Object text is too long or has an invalid format.");
    if (item.fontSize !== undefined && (item.kind !== "text" || !Number.isInteger(item.fontSize) || item.fontSize < 8 || item.fontSize > 200)) throw new Error("Font size must be a whole number from 8 to 200.");
    if (item.component !== undefined && (item.kind !== "note" || typeof item.component !== "string" || !/^[A-Za-z][A-Za-z0-9 ]{0,79}$/.test(item.component))) throw new Error("The UI component name is invalid.");
    if (item.strokes !== undefined && (item.kind !== "stamp" || !Array.isArray(item.strokes) || item.strokes.length > 100
      || item.strokes.some(stroke => !Array.isArray(stroke) || stroke.length < 4 || stroke.length > 2000 || stroke.length % 2 !== 0
        || stroke.some(point => typeof point !== "number" || !Number.isFinite(point) || point < 0 || point > 1)))) throw new Error("Icon strokes are invalid or exceed the limit.");
    if (item.kind === "crop" && (!validRect(item.source) || item.source.x < 0 || item.source.y < 0)) throw new Error("The copied region has invalid source bounds.");
    const raster = item.kind === "image" || item.kind === "crop";
    if (item.kind === "image" && !validAsset(item.asset) || item.asset !== undefined && (!raster || !validAsset(item.asset))) throw new Error("The image object has an invalid source.");
    if (item.rotation !== undefined && (!raster || ![0, 90, 180, 270].includes(item.rotation))) throw new Error("The image rotation angle is invalid.");
    if ([item.flipX, item.flipY].some(value => value !== undefined && (!raster || typeof value !== "boolean"))) throw new Error("The image flip settings are invalid.");
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
    "# UI change requests", "", "Read modified.png and the requests below, then update the current project.",
    "Covers, arrows, and copied regions illustrate the requested changes. Ask about unspecified details instead of guessing interaction behavior.", "",
    `Screenshot size: ${dimensions.sourceWidth ?? dimensions.width} × ${dimensions.sourceHeight ?? dimensions.height} px. All coordinates are relative to the top-left corner of the original screenshot.`,
    `Export size: ${dimensions.width} × ${dimensions.height} px. The original screenshot starts in modified.png at x=${-(dimensions.originX ?? 0)}, y=${-(dimensions.originY ?? 0)}. Space outside the screenshot is transparent. Add this offset to annotation coordinates to locate them in the exported image.`,
    `Original screenshot: [${project.image.replace(/[\[\]]/g, "")}](${encodeURIComponent(project.image).replace(/\(/g, "%28").replace(/\)/g, "%29")})`, "",
  ];
  project.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${kindNames[item.kind]}`, "", `Position: ${describeRect(item)}.`);
    if (item.component) lines.push(`UI component: ${item.component}.`);
    if (item.kind === "text") lines.push(`Font size: ${item.fontSize ?? 22} px; text is centered horizontally and vertically.`);
    if (item.source) lines.push(`Copy source: ${describeRect(item.source)}.`);
    if (item.kind === "arrow") lines.push(`Arrow endpoint: x=${Math.round(item.x + item.width)}, y=${Math.round(item.y + item.height)}.`);
    if (item.kind === "cover") lines.push(`Cover fill: ${item.color}.`);
    if (item.text) lines.push("", "Display text:", "", item.text);
    if (item.comment.trim()) lines.push("", "User request:", "", item.comment.trim());
    else lines.push("", "No written request; refer to the position and appearance in the mockup.");
    lines.push("");
  });
  return lines.join("\n");
}
