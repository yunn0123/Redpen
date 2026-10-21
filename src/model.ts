import { motionInstructions, motionLibrary } from "./motion";

/** Shared document format and validation keep saved drafts and agent exports consistent. */
export const MAX_ITEMS = 300;
export const MAX_REFERENCES = 8;
export const MAX_PIXELS = 16_000_000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const DEFAULT_HANDOFF_PROMPT = "Read {svgPath} and update the current project using its original, modified, and annotations layers. Annotations contain readable text. Preserve functionality unless a change is requested, and ask for clarification when requirements are unclear.";
export const kinds = ["note", "cover", "crop", "arrow", "text", "stamp", "outline", "image", "comment"] as const;
export type Kind = typeof kinds[number];
export type Rect = { x: number; y: number; width: number; height: number };
export type Item = Rect & {
  id: string; kind: Kind; color: string; text: string; comment: string;
  references?: { id: number; asset: string }[];
  source?: Rect;
  fontSize?: number;
  component?: string;
  motion?: string;
  strokes?: number[][];
  asset?: string;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
};
export type Background = Rect & { id: string; asset: string };
export type Project = { version: 1; image: string; items: Item[]; backgrounds?: Background[] };
export const BACKGROUND_GAP = 64;
export const kindNames: Record<Kind, string> = {
  note: "Region note", cover: "Cover", crop: "Copy region", arrow: "Arrow", text: "Text", stamp: "Icon", outline: "Outline", image: "Image", comment: "General request",
};

/** Allow only sibling raster assets so a draft cannot request arbitrary local files. */
export function validAsset(value: unknown): value is string {
  return typeof value === "string" && value.length <= 240 && !/[/\\\u0000-\u001f]/.test(value) && /\.(png|jpe?g|webp)$/i.test(value);
}

/** Collect immutable assets once, including crop sources retained when the background is replaced. */
export function projectAssets(project: Project): string[] {
  return [...new Set([project.image, ...(project.backgrounds ?? []).map(background => background.asset), ...project.items.flatMap(item => [item.asset, ...(item.references ?? []).map(reference => reference.asset)])].filter((name): name is string => Boolean(name)))];
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
  let backgrounds: Background[] | undefined;
  if (project.backgrounds !== undefined) {
    if (!Array.isArray(project.backgrounds) || !project.backgrounds.length || project.backgrounds.length > MAX_ITEMS) throw new Error("Keep at least one background image; the background limit is 300.");
    const ids = new Set<string>();
    backgrounds = project.backgrounds.map(background => {
      if (!background || !validRect(background) || !validAsset(background.asset) || typeof background.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(background.id) || ids.has(background.id)
        || !Number.isSafeInteger(background.width) || !Number.isSafeInteger(background.height) || background.width * background.height > MAX_PIXELS) throw new Error("The background image is invalid.");
      ids.add(background.id);
      return { id: background.id, asset: background.asset, x: background.x, y: background.y, width: background.width, height: background.height };
    });
    if (backgrounds[0].asset !== project.image) throw new Error("The primary screenshot must match the first background.");
  }
  const ids = new Set<string>();
  const items = project.items.map((item): Item => {
    if (!item || !kinds.includes(item.kind) || !validRect(item, item.kind === "arrow")) throw new Error("The draft contains invalid objects or coordinates.");
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error("Object IDs are invalid or duplicated.");
    ids.add(item.id);
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error("The object color format is invalid.");
    if (typeof item.text !== "string" || item.text.length > 2000 || typeof item.comment !== "string" || item.comment.length > 8000) throw new Error("Object text is too long or has an invalid format.");
    if (item.fontSize !== undefined && (item.kind !== "text" || !Number.isInteger(item.fontSize) || item.fontSize < 8 || item.fontSize > 200)) throw new Error("Font size must be a whole number from 8 to 200.");
    if (item.component !== undefined && (item.kind !== "note" || typeof item.component !== "string" || !/^[A-Za-z][A-Za-z0-9 ]{0,79}$/.test(item.component))) throw new Error("The UI component name is invalid.");
    if (item.motion !== undefined && !motionLibrary.some(motion => motion.id === item.motion)) throw new Error("The motion preset is invalid.");
    if (item.strokes !== undefined && (item.kind !== "stamp" || !Array.isArray(item.strokes) || item.strokes.length > 100
      || item.strokes.some(stroke => !Array.isArray(stroke) || stroke.length < 4 || stroke.length > 2000 || stroke.length % 2 !== 0
        || stroke.some(point => typeof point !== "number" || !Number.isFinite(point) || point < 0 || point > 1)))) throw new Error("Icon strokes are invalid or exceed the limit.");
    if (item.kind === "crop" && (!validRect(item.source) || item.source.x < 0 || item.source.y < 0)) throw new Error("The copied region has invalid source bounds.");
    if (item.references !== undefined && (!Array.isArray(item.references) || item.references.length > MAX_REFERENCES
      || item.references.some(reference => !reference || !Number.isSafeInteger(reference.id) || reference.id < 1 || reference.id > 9999 || !validAsset(reference.asset))
      || new Set(item.references.map(reference => reference.id)).size !== item.references.length)) throw new Error(`Each request supports up to ${MAX_REFERENCES} reference images with unique IDs and valid sources.`);
    const raster = item.kind === "image" || item.kind === "crop";
    if (item.kind === "image" && !validAsset(item.asset) || item.asset !== undefined && (!raster || !validAsset(item.asset))) throw new Error("The image object has an invalid source.");
    if (item.rotation !== undefined && (!raster || ![0, 90, 180, 270].includes(item.rotation))) throw new Error("The image rotation angle is invalid.");
    if ([item.flipX, item.flipY].some(value => value !== undefined && (!raster || typeof value !== "boolean"))) throw new Error("The image flip settings are invalid.");
    return {
      id: item.id, kind: item.kind, x: item.x, y: item.y, width: item.width, height: item.height,
      color: item.color, text: item.text, comment: item.comment,
      ...(item.fontSize !== undefined ? { fontSize: item.fontSize } : {}),
      ...(item.motion !== undefined ? { motion: item.motion } : {}),
      ...(item.component !== undefined ? { component: item.component } : {}),
      ...(item.strokes !== undefined ? { strokes: item.strokes.map(stroke => [...stroke]) } : {}),
      ...(item.references !== undefined ? { references: item.references.map(reference => ({ id: reference.id, asset: reference.asset })) } : {}),
      ...(item.asset !== undefined ? { asset: item.asset } : {}),
      ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
      ...(item.flipX !== undefined ? { flipX: item.flipX } : {}),
      ...(item.flipY !== undefined ? { flipY: item.flipY } : {}),
      ...(item.kind === "crop" ? { source: { ...item.source! } } : {}),
    };
  });
  return { version: 1, image: project.image, items, ...(backgrounds ? { backgrounds } : {}) };
}

/** Old single-screenshot drafts remain readable without rewriting their metadata. */
export function projectBackgrounds(project: Project, width: number, height: number): Background[] {
  return project.backgrounds ?? (project.image ? [{ id: "background", asset: project.image, x: 0, y: 0, width, height }] : []);
}

/** Keep the canvas coordinate system and annotations unchanged when a background disappears. */
export function setBackgrounds(project: Project, backgrounds: Background[]): Project {
  if (!backgrounds.length) throw new Error("At least one background image must remain.");
  return parseProject({ ...project, image: backgrounds[0].asset, backgrounds,
    items: project.items.map(item => item.kind === "crop" && !item.asset ? { ...item, asset: project.image } : item),
  });
}

export function addBackground(project: Project, asset: string, width: number, height: number, sourceWidth: number, sourceHeight: number, id: string): Project {
  const backgrounds = projectBackgrounds(project, sourceWidth, sourceHeight);
  const x = backgrounds.length ? Math.max(...backgrounds.map(background => background.x + background.width)) + BACKGROUND_GAP : 0;
  return setBackgrounds(project, [...backgrounds, { id, asset, x, y: 0, width, height }]);
}

export function replaceBackground(project: Project, id: string, asset: string, width: number, height: number, sourceWidth: number, sourceHeight: number): Project {
  const backgrounds = projectBackgrounds(project, sourceWidth, sourceHeight);
  if (!backgrounds.some(background => background.id === id)) throw new Error("Select a background image first.");
  return setBackgrounds(project, backgrounds.map(background => background.id === id ? { ...background, asset, width, height } : background));
}

/** Attach a reference at the text selection without renumbering existing image markers. */
export function attachReference(project: Project, itemId: unknown, asset: string, start: unknown, end: unknown): Project {
  const next = parseProject(project);
  const item = next.items.find(item => item.id === itemId);
  if (!item) throw new Error("The request no longer exists.");
  if ((item.references?.length ?? 0) >= MAX_REFERENCES) throw new Error(`Each request supports up to ${MAX_REFERENCES} reference images.`);
  if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > item.comment.length) throw new Error("The reference insertion position is invalid.");
  const id = Math.max(0, ...(item.references ?? []).map(reference => reference.id), ...Array.from(item.comment.matchAll(/\[img(\d{1,4})\]/g), match => Number(match[1]))) + 1;
  item.comment = item.comment.slice(0, start) + `[img${id}]` + item.comment.slice(end);
  item.references = [...(item.references ?? []), { id, asset }];
  return parseProject(next);
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
    `Screenshot size: ${dimensions.sourceWidth ?? dimensions.width} × ${dimensions.sourceHeight ?? dimensions.height} px. All coordinates use the shared canvas origin; background positions are preserved after deletion.`,
    `Export size: ${dimensions.width} × ${dimensions.height} px. The shared canvas origin starts in modified.png at x=${-(dimensions.originX ?? 0)}, y=${-(dimensions.originY ?? 0)}. Space outside the backgrounds is transparent. Add this offset to annotation coordinates to locate them in the exported image.`,
    `Original screenshot: [${project.image.replace(/[\[\]]/g, "")}](${encodeURIComponent(project.image).replace(/\(/g, "%28").replace(/\)/g, "%29")})`, "",
  ];
  for (const background of project.backgrounds ?? []) lines.push(`Background ${background.id}: ${background.asset}; ${describeRect(background)}.`, "");
  project.items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${kindNames[item.kind]}`, "", `Position: ${describeRect(item)}.`);
    if (item.motion) lines.push("", motionInstructions(item.motion));
    if (item.component) lines.push(`UI component: ${item.component}.`);
    if (item.kind === "text") lines.push(`Font size: ${item.fontSize ?? 22} px; text is centered horizontally and vertically.`);
    if (item.source) lines.push(`Copy source: ${describeRect(item.source)}.`);
    if (item.kind === "arrow") lines.push(`Arrow endpoint: x=${Math.round(item.x + item.width)}, y=${Math.round(item.y + item.height)}.`);
    if (item.kind === "cover") lines.push(`Cover fill: ${item.color}.`);
    if (item.text) lines.push("", "Display text:", "", item.text);
    if (item.comment.trim()) lines.push("", "User request:", "", item.comment.trim());
    else lines.push("", "No written request; refer to the position and appearance in the mockup.");
    for (const reference of item.references ?? []) lines.push("", `Reference [img${reference.id}]: ${reference.asset}`);
    lines.push("");
  });
  return lines.join("\n");
}
