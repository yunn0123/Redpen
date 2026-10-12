/** Guard document trust boundaries, zoom-independent geometry, and exported user intent. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentMarkdown, parseProject, selectionRect, type Project } from "../src/model";
import { exportSvg, readRedpenSvg } from "../src/svg";

/** Supply one valid note so each test changes only the boundary it checks. */
function draft(): Project {
  return { version: 1, image: "screen.png", items: [{ id: "note-1", kind: "note", x: 15, y: 20, width: 100, height: 50, color: "#ff0000", text: "", comment: "hover 後顯示＋；點擊後新增輸入框。" }] };
}

test("rejects path traversal, malformed geometry, duplicate IDs and missing crop sources", () => {
  for (const path of ["../screen.png", "folder/screen.png", "..\\screen.png", "https://example.com/a.png", "screen.svg", "screen\u0000.png"]) {
    assert.throws(() => parseProject({ ...draft(), image: path }));
  }
  for (const width of [0, -5, Infinity, NaN, "15"]) {
    const project = draft(); (project.items[0] as any).width = width;
    assert.throws(() => parseProject(project));
  }
  const repeated = draft(); repeated.items.push({ ...repeated.items[0] });
  assert.throws(() => parseProject(repeated));
  const crop = draft(); crop.items[0].kind = "crop";
  assert.throws(() => parseProject(crop));
});

test("arrows may point left/up and crop geometry remains independent of its new location", () => {
  const project = draft();
  project.items[0] = { ...project.items[0], kind: "arrow", width: -50, height: -20 };
  assert.equal(parseProject(project).items[0].width, -50);
  project.items[0] = { ...project.items[0], kind: "crop", width: 200, height: 100, source: { x: 10, y: 20, width: 100, height: 50 } };
  assert.deepEqual(parseProject(project).items[0].source, { x: 10, y: 20, width: 100, height: 50 });
});

test("reverse selections clamp to image bounds", () => {
  assert.deepEqual(selectionRect({ x: 200, y: 180 }, { x: -20, y: -10 }, { width: 150, height: 100 }), { x: 0, y: 0, width: 150, height: 100 });
});

test("agent export preserves behavior and references the original screenshot", () => {
  const markdown = agentMarkdown(draft(), { width: 1200, height: 800 });
  assert.match(markdown, /1200 × 800/);
  assert.match(markdown, /x=15, y=20, w=100, h=50/);
  assert.match(markdown, /hover 後顯示＋；點擊後新增輸入框。/);
  assert.match(markdown, /modified\.png/);
  assert.match(markdown, /\]\(screen\.png\)/);
});

test("empty canvases are valid but cannot contain annotations without a screenshot", () => {
  assert.deepEqual(parseProject({ version: 1, image: "", items: [] }), { version: 1, image: "", items: [] });
  assert.throws(() => parseProject({ ...draft(), image: "" }));
});

test("new fields round-trip while legacy drafts remain valid and invalid metadata is rejected", () => {
  const project = draft(); project.items[0].component = "Tooltip";
  assert.equal(parseProject(project).items[0].component, "Tooltip");
  project.items[0] = { ...project.items[0], kind: "text", component: undefined, fontSize: 30 };
  assert.equal(parseProject(project).items[0].fontSize, 30);
  for (const size of [0, 201, NaN, 22.5]) {
    project.items[0].fontSize = size; assert.throws(() => parseProject(project));
  }
  assert.throws(() => parseProject({ ...draft(), items: [{ ...draft().items[0], component: "<script>" }] }));
  assert.deepEqual(selectionRect({ x: 10, y: 20 }, { x: -50, y: -40 }), { x: -50, y: -40, width: 60, height: 60 });
  const markdown = agentMarkdown(draft(), { width: 1400, height: 900, sourceWidth: 1200, sourceHeight: 800, originX: -200, originY: -100 });
  assert.match(markdown, /截圖尺寸：1200 × 800/);
  assert.match(markdown, /匯出尺寸：1400 × 900/);
  assert.match(markdown, /x=200, y=100/);
});

test("SVG carries independent layers, escaped text and a recoverable source without sibling files", () => {
  const project = draft(); project.items[0].component = "Tooltip";
  project.items[0].comment = '<script>alert("x")</script> & 完整需求';
  const source = "data:image/png;base64,aGVsbG8=";
  const svg = exportSvg(project, source, 800, 600);
  assert.equal((svg.match(/inkscape:groupmode="layer"/g) ?? []).length, 3);
  for (const name of ["original", "modified", "annotations"]) assert.ok(svg.includes(`id="${name}"`));
  assert.ok(svg.includes("元件註解 · Tooltip")); assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!svg.includes("<script>"));
  assert.deepEqual(readRedpenSvg(svg), { project, source });
  assert.match(svg, /<metadata id="redpen-draft">/);
  assert.deepEqual(readRedpenSvg(svg.replace('id="redpen-draft"', 'id="ui-feedback-draft"')), { project, source });
  assert.throws(() => readRedpenSvg('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => exportSvg(project, "https://example.com/image.png", 800, 600));
  project.items[0].x = 100_000;
  assert.throws(() => exportSvg(project, source, 800, 600), /1600/);
});

test("icon strokes are bounded normalized vectors and outline needs no comment", () => {
  const project = draft(); project.items[0] = { ...project.items[0], kind: "stamp", text: "placeholder", strokes: [[0, .5, 1, .5]] };
  assert.deepEqual(parseProject(project).items[0].strokes, [[0, .5, 1, .5]]);
  project.items[0].strokes = [[0, 1, NaN, 0]]; assert.throws(() => parseProject(project));
  project.items[0] = { ...project.items[0], kind: "outline", comment: "", strokes: undefined };
  const svg = exportSvg(project, "data:image/png;base64,aGVsbG8=", 800, 600);
  assert.ok(svg.includes('fill="none" stroke="#ff0000"'));
});

test("2940 by 1912 screenshots with six annotations export without the legacy PNG payload", () => {
  const project = draft();
  project.items = Array.from({ length: 6 }, (_, index) => ({
    ...project.items[0], id: `note-${index}`, x: 150 + index * 300, y: 300,
    comment: `第 ${index + 1} 項：這個區域 hover 時顯示 tooltip，點擊後新增輸入欄位。`,
  }));
  const svg = exportSvg(project, "data:image/png;base64,aGVsbG8=", 2940, 1912);
  assert.match(svg, /width="3444" height="1912"/);
  assert.equal(readRedpenSvg(svg).project.items.length, 6);
});

/** Multi-image documents must remain self-contained and reject unsafe asset references. */
test("image transforms and unpositioned comments survive SVG round-trip", () => {
  const project = draft();
  project.items.push({ ...project.items[0], id: "extra", kind: "image", asset: "part.png", rotation: 90, flipX: true });
  project.items.push({ ...project.items[0], id: "general", kind: "comment", comment: "整體需求" });
  const source = "data:image/png;base64,AAAA";
  const images = { "part.png": { data: source, width: 120, height: 80 } };
  const svg = exportSvg(project, source, 800, 600, images);
  assert.deepEqual(readRedpenSvg(svg), { project: parseProject(project), source, images });
  assert.match(svg, /無指定位置/);
  assert.doesNotMatch(svg, /data-target="item-general"/);
  assert.throws(() => exportSvg(project, source, 800, 600));
  assert.throws(() => readRedpenSvg(svg.replace('data-asset="part.png"', 'data-asset="missing.png"')));
  for (const asset of ["../part.png", "/part.png", "part.svg"]) {
    project.items[1].asset = asset; assert.throws(() => parseProject(project));
  }
  project.items[1].asset = "part.png"; project.items[1].rotation = 45;
  assert.throws(() => parseProject(project));
});
