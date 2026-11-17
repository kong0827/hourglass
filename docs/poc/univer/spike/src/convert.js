import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import { UniverDocsLayoutWorkerPlugin } from "@univerjs/docs";
import {
  convertBodyToHtml,
  convertClipboardHtmlToDocumentData,
} from "@univerjs/docs-ui";
import { BooleanNumber, CustomRangeType, PresetListType } from "@univerjs/core";
import "@univerjs/preset-docs-core/lib/index.css";

const statusEl = document.getElementById("spike-status");
const errors = [];
const setStatus = (text) => {
  statusEl.textContent = text;
};

window.addEventListener("error", (event) => {
  errors.push("error: " + (event.message || event.error));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  errors.push("rejection: " + ((reason && reason.message) || reason));
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ORIGIN = location.origin;

/**
 * 覆盖 12 类结构：h1-h3 / 粗斜下删 / 行内 code / 等宽 / 颜色底色字号 /
 * 链接 / 两级无序 / 有序 / 引用 / 代码块 / 分隔线 / 图片 / 表头表格。
 */
const FIXTURE_HTML = [
  "<h1>一级标题</h1>",
  "<h2>二级标题</h2>",
  "<h3>三级标题</h3>",
  "<p>普通正文段落。</p>",
  "<p><strong>粗体文字</strong> / <em>em 文字</em> / <i>斜体文字</i> / <u>下划线文字</u> / <s>删除线文字</s></p>",
  "<p>行内 <code>inline_code()</code> 与 <span style=\"font-family:'Courier New'\">等宽字体</span>。</p>",
  "<p><span style=\"color:#d92d20\">红色文字</span> / <span style=\"background-color:#fff3b0\">黄色底纹</span> / <span style=\"font-size:20px\">小四号</span> / <span style=\"font-weight:700\">权重七百</span></p>",
  "<p>链接：<a href=\"https://docs.univer.ai/zh-CN\">Univer 文档站</a></p>",
  "<ul><li>无序一</li><li>无序二<ul><li>无序二·子项</li></ul></li></ul>",
  "<ol><li>有序一</li><li>有序二</li></ol>",
  "<blockquote><p>引用块内容</p></blockquote>",
  "<pre><code>const answer = 42;</code></pre>",
  "<hr>",
  `<p><img src="${ORIGIN}/protected/dot.png" width="64" height="64" alt="dot"></p>`,
  "<table><thead><tr><th>列A</th><th>列B</th><th>列C</th></tr></thead><tbody><tr><td>a1</td><td>b1</td><td>c1</td></tr><tr><td>a2</td><td>b2</td><td>c2</td></tr></tbody></table>",
  "<p>末尾段落。</p>",
].join("");

const ID_KEYS = new Set([
  "id",
  "unitId",
  "subUnitId",
  "paragraphId",
  "sectionId",
  "tableId",
  "rowId",
  "colId",
  "columnId",
  "columnGroupId",
  "blockId",
  "rangeId",
  "drawingId",
  "listId",
  "headingId",
  "segmentId",
]);

/** 递归剔除各类随机 id，并对键排序，得到跨轮可比较的投影 */
function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (ID_KEYS.has(key)) continue;
      out[key] = stripIds(value[key]);
    }
    return out;
  }
  return value;
}

function visibleText(stream) {
  return String(stream || "").replace(/[\u0000-\u001f]/g, "");
}

function byJson(a, b) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

/** 快照投影：只保留语义字段（不含随机 id 与 rev） */
function project(data) {
  const body = data.body || {};
  return {
    dataStream: body.dataStream || "",
    textRuns: (body.textRuns || []).map((run) => ({
      st: run.st,
      ed: run.ed,
      ts: stripIds(run.ts || {}),
    })),
    paragraphs: (body.paragraphs || []).map((paragraph) => ({
      startIndex: paragraph.startIndex,
      paragraphStyle: stripIds(paragraph.paragraphStyle || {}),
      bullet: paragraph.bullet
        ? {
            listType: String(paragraph.bullet.listType),
            nestingLevel: paragraph.bullet.nestingLevel,
          }
        : null,
    })),
    sectionBreaks: (body.sectionBreaks || []).map((section) => ({
      startIndex: section.startIndex,
    })),
    customRanges: (body.customRanges || []).map((range) => ({
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      rangeType: range.rangeType,
      properties: stripIds(range.properties || {}),
    })),
    blockRanges: (body.blockRanges || []).map((block) => ({
      blockType: block.blockType,
      startIndex: block.startIndex,
      endIndex: block.endIndex,
    })),
    customBlocks: (body.customBlocks || []).map((block) => ({
      startIndex: block.startIndex,
      blockType: block.blockType ?? null,
    })),
    tables: (body.tables || []).map((table) => ({
      startIndex: table.startIndex,
      endIndex: table.endIndex,
    })),
    tableSource: stripIds(Object.values(data.tableSource || {})),
    drawings: Object.values(data.drawings || {})
      .map((drawing) =>
        stripIds({
          source: drawing.source,
          imageSourceType: drawing.imageSourceType,
          drawingType: drawing.drawingType,
          layoutType: drawing.layoutType,
          size: drawing.docTransform?.size ?? null,
          transform: drawing.transform ?? null,
        })
      )
      .sort(byJson),
    lists: Object.values(data.lists || {})
      .map((list) => stripIds({ listType: list.listType, style: list.style ?? null }))
      .sort(byJson),
    documentStyle: stripIds(data.documentStyle || {}),
  };
}

/** 深度 diff：返回前 N 条字段级差异，跳过 rev */
function diffSnapshots(expected, actual, limit = 20) {
  const skip = new Set(["rev"]);
  const diffs = [];
  const walk = (a, b, path) => {
    if (diffs.length >= limit) return;
    if (a === b) return;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
      diffs.push({ path, expected: a, actual: b });
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (skip.has(key)) continue;
      walk(a[key], b[key], path ? `${path}.${key}` : key);
      if (diffs.length >= limit) return;
    }
  };
  walk(expected, actual, "");
  return diffs;
}

function styleSignature(ts = {}) {
  const parts = [];
  if (ts.bl === BooleanNumber.TRUE) parts.push("bl");
  if (ts.it === BooleanNumber.TRUE) parts.push("it");
  if (ts.ul?.s === BooleanNumber.TRUE) parts.push("ul");
  if (ts.st?.s === BooleanNumber.TRUE) parts.push("st");
  if (ts.ol?.s === BooleanNumber.TRUE) parts.push("ol");
  if (ts.cl?.rgb) parts.push("cl:" + ts.cl.rgb);
  if (ts.bg?.rgb) parts.push("bg:" + ts.bg.rgb);
  if (ts.fs) parts.push("fs:" + ts.fs);
  if (ts.ff) parts.push("ff:" + ts.ff);
  if (ts.va != null) parts.push("va:" + ts.va);
  return parts.join("|");
}

/** 段落索引与文本对位，用于定位导出丢字 */
function paragraphSlices(data) {
  const stream = data.body?.dataStream || "";
  const paragraphs = data.body?.paragraphs || [];
  return paragraphs.map((paragraph, index) => {
    const from = index === 0 ? 0 : paragraphs[index - 1].startIndex + 1;
    return {
      startIndex: paragraph.startIndex,
      text: visibleText(stream.slice(from, paragraph.startIndex)).slice(0, 24),
      namedStyleType: paragraph.paragraphStyle?.namedStyleType ?? null,
      bullet: paragraph.bullet
        ? { listType: String(paragraph.bullet.listType), level: paragraph.bullet.nestingLevel }
        : null,
    };
  });
}

/** 逐字符样式指纹，合并为连续同样式片段，消除 textRun 切分差异 */
function profileRuns(data) {
  const stream = data.body?.dataStream || "";
  const styles = new Array(stream.length).fill("");
  for (const run of data.body?.textRuns || []) {
    const signature = styleSignature(run.ts || {});
    const end = Math.min(run.ed, stream.length);
    for (let index = run.st; index < end; index += 1) styles[index] = signature;
  }
  const out = [];
  let current = null;
  for (let index = 0; index < stream.length; index += 1) {
    const code = stream.charCodeAt(index);
    if (code < 32) continue;
    const signature = styles[index];
    if (!current || current.sig !== signature) {
      if (current) out.push(current);
      current = { sig: signature, text: "" };
    }
    current.text += stream[index];
  }
  if (current) out.push(current);
  return out;
}

function diffProfiles(expected, actual, limit = 10) {
  const out = [];
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length && out.length < limit; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (!left || !right || left.sig !== right.sig || left.text !== right.text) {
      out.push({
        index,
        expected: left ?? null,
        actual: right ?? null,
      });
    }
  }
  return {
    expectedRuns: expected.length,
    actualRuns: actual.length,
    diffs: out,
  };
}

function countChars(data, predicate) {
  const stream = data.body?.dataStream || "";
  let count = 0;
  for (const run of data.body?.textRuns || []) {
    const text = visibleText(stream.slice(run.st, run.ed));
    if (predicate(run.ts || {})) count += Array.from(text).length;
  }
  return count;
}

/** 结构特征矩阵，用于「保留 / 降级 / 丢失」判定 */
function features(data) {
  const body = data.body || {};
  const stream = body.dataStream || "";
  const paragraphs = body.paragraphs || [];
  const headings = {};
  for (const paragraph of paragraphs) {
    const type = paragraph.paragraphStyle?.namedStyleType;
    if (type != null) headings[type] = (headings[type] || 0) + 1;
  }
  const listItems = paragraphs
    .filter((paragraph) => paragraph.bullet)
    .map((paragraph) => ({
      listType: String(paragraph.bullet.listType),
      level: paragraph.bullet.nestingLevel,
    }));
  const table = Object.values(data.tableSource || {})[0];
  const rows = table?.tableRows || [];
  const tableCells = rows.reduce((sum, row) => sum + (row.tableCells || []).length, 0);
  const customRanges = body.customRanges || [];
  return {
    plainChars: Array.from(visibleText(stream)).length,
    paragraphCount: paragraphs.length,
    textRuns: (body.textRuns || []).length,
    boldChars: countChars(data, (ts) => ts.bl === BooleanNumber.TRUE),
    italicChars: countChars(data, (ts) => ts.it === BooleanNumber.TRUE),
    underlineChars: countChars(data, (ts) => ts.ul?.s === BooleanNumber.TRUE),
    strikeChars: countChars(data, (ts) => ts.st?.s === BooleanNumber.TRUE),
    colorChars: countChars(data, (ts) => Boolean(ts.cl?.rgb)),
    backgroundChars: countChars(data, (ts) => Boolean(ts.bg?.rgb)),
    fontSizeChars: countChars(data, (ts) => Boolean(ts.fs)),
    fontFamilyChars: countChars(data, (ts) => Boolean(ts.ff)),
    monoChars: countChars(data, (ts) => /mono|consolas|courier|menlo/i.test(ts.ff || "")),
    links: customRanges.filter((range) => range.rangeType === CustomRangeType.HYPERLINK).length,
    customRanges: customRanges.length,
    listItems: listItems.length,
    listLevels: [...new Set(listItems.map((item) => item.level))].sort(),
    orderedItems: listItems.filter((item) => item.listType === PresetListType.ORDER_LIST).length,
    blockTypes: (body.blockRanges || []).map((block) => block.blockType),
    images: Object.keys(data.drawings || {}).length,
    tables: (body.tables || []).length,
    tableRows: rows.length,
    tableCells,
    tableColumns: (table?.tableColumns || []).length,
    headings,
  };
}

function summarizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const count = (selector) => doc.querySelectorAll(selector).length;
  const styledSpans = Array.from(doc.querySelectorAll("span[style]"));
  return {
    length: html.length,
    headingLevels: Array.from(doc.querySelectorAll("[data-heading-level]")).map((el) =>
      el.getAttribute("data-heading-level")
    ),
    headingTags: Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => el.tagName),
    strong: count("strong"),
    em: count("em"),
    i: count("i"),
    u: count("u"),
    s: count("s"),
    code: count("code"),
    colorSpans: styledSpans.filter((el) => /(^|;)\s*color:/.test(el.getAttribute("style"))).length,
    bgSpans: styledSpans.filter((el) => /background/.test(el.getAttribute("style"))).length,
    fontSizeSpans: styledSpans.filter((el) => /font-size/.test(el.getAttribute("style"))).length,
    fontFamilySpans: styledSpans.filter((el) => /font-family/.test(el.getAttribute("style"))).length,
    linkTags: count("a[href]"),
    ul: count("ul"),
    ol: count("ol"),
    li: count("li"),
    blockquote: count("blockquote"),
    pre: count("pre"),
    hr: count("hr"),
    img: count("img"),
    tables: count("table"),
    rows: count("tr"),
    cells: count("td, th"),
    th: count("th"),
    docTypeAttrs: count("[data-doc-type]"),
    hasUniverNormal: /UniverNormal/.test(html),
    hasUniverHeading: /UniverHeading/.test(html),
    hasUniverTable: /UniverTable/.test(html),
    controlChars: (html.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length,
  };
}

function countRedPixels() {
  let count = 0;
  for (const canvas of document.querySelectorAll("#app canvas")) {
    const context = canvas.getContext("2d");
    if (!context) continue;
    try {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4 * 5) {
        if (
          data[index] > 180 &&
          data[index + 1] < 80 &&
          data[index + 2] < 80 &&
          data[index + 3] > 0
        ) {
          count += 1;
        }
      }
    } catch (error) {
      errors.push("pixel: " + error.message);
    }
  }
  return count;
}

function mountUniver() {
  return createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: UniverPresetDocsCoreEnUS },
    presets: [UniverDocsCorePreset({ container: "app" })],
    plugins: [
      [
        UniverDocsLayoutWorkerPlugin,
        {
          workerFactory: () =>
            new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
        },
      ],
    ],
  }).univerAPI;
}

let templateDocumentStyle = null;

function defaultDocumentStyle(univerAPI) {
  if (!templateDocumentStyle) {
    templateDocumentStyle = univerAPI.newRichText().text("x").getData().documentStyle;
  }
  return structuredClone(templateDocumentStyle);
}

/** 在 index 处插入一个空段落，并把其后所有索引右移一位 */
function insertSpacerParagraph(body, atIndex) {
  body.dataStream = body.dataStream.slice(0, atIndex) + "\r" + body.dataStream.slice(atIndex);
  const shift = (value) => (value >= atIndex ? value + 1 : value);

  for (const run of body.textRuns || []) {
    run.st = shift(run.st);
    if (run.ed > atIndex) run.ed += 1;
  }
  for (const paragraph of body.paragraphs || []) {
    paragraph.startIndex = shift(paragraph.startIndex);
  }
  for (const section of body.sectionBreaks || []) {
    section.startIndex = shift(section.startIndex);
  }
  for (const range of body.customRanges || []) {
    range.startIndex = shift(range.startIndex);
    range.endIndex = shift(range.endIndex);
  }
  for (const block of body.blockRanges || []) {
    block.startIndex = shift(block.startIndex);
    block.endIndex = shift(block.endIndex);
  }
  for (const block of body.customBlocks || []) {
    block.startIndex = shift(block.startIndex);
  }
  for (const table of body.tables || []) {
    table.startIndex = shift(table.startIndex);
    table.endIndex = shift(table.endIndex);
  }

  body.paragraphs = body.paragraphs || [];
  body.paragraphs.push({
    startIndex: atIndex,
    paragraphId: "spacer-" + atIndex + "-" + Math.random().toString(36).slice(2, 8),
    paragraphStyle: {},
  });
  body.paragraphs.sort((left, right) => left.startIndex - right.startIndex);
}

/**
 * 官方 convertBodyToHtml 的两处丢字需要导出前修补：
 * 1) 表格后紧跟的段落会被并入表格节点，段落文字被丢弃 → 补一个空段落占位；
 * 2) 没有任何 textRun 相交的段落会整段丢字 → 用空样式 run 补齐覆盖区间。
 */
function prepareForExport(snapshot) {
  const doc = structuredClone(snapshot);
  const body = doc.body;
  if (!body || typeof body.dataStream !== "string") {
    return { doc, spacers: 0, gapRuns: 0 };
  }
  const tables = [...(body.tables || [])].sort((left, right) => right.endIndex - left.endIndex);
  let spacers = 0;
  for (const table of tables) {
    // tables[].endIndex 是表格结束符之后的位置（不含）
    const atIndex = table.endIndex;
    const nextParagraph = (body.paragraphs || []).find(
      (paragraph) => paragraph.startIndex >= atIndex
    );
    if (nextParagraph && nextParagraph.startIndex === atIndex) continue;
    insertSpacerParagraph(body, atIndex);
    spacers += 1;
  }

  const stream = body.dataStream;
  const sorted = [...(body.textRuns || [])].sort((left, right) => left.st - right.st);
  const filled = [];
  let cursor = 0;
  let gapRuns = 0;
  for (const run of sorted) {
    if (run.st > cursor) {
      filled.push({ st: cursor, ed: run.st, ts: {} });
      gapRuns += 1;
    }
    filled.push(run);
    cursor = Math.max(cursor, run.ed);
  }
  if (cursor < stream.length) {
    filled.push({ st: cursor, ed: stream.length, ts: {} });
    gapRuns += 1;
  }
  body.textRuns = filled;
  return { doc, spacers, gapRuns };
}

function exportPrepared(snapshot) {
  const prepared = prepareForExport(snapshot);
  return {
    html: convertBodyToHtml(prepared.doc),
    spacers: prepared.spacers,
    gapRuns: prepared.gapRuns,
  };
}

async function waitForImage() {
  const deadline = Date.now() + 10000;
  let redPixels = 0;
  while (Date.now() < deadline) {
    redPixels = countRedPixels();
    if (redPixels > 0) break;
    await delay(400);
  }
  return redPixels;
}

/** 单轮：HTML → UDM → 编辑器 → 快照 → HTML */
async function importStage(univerAPI, html, unitId) {
  const imported = convertClipboardHtmlToDocumentData(html, unitId);
  const importedStream = imported.body?.dataStream || "";
  const importedText = visibleText(importedStream);
  const degraded = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/i.test(importedText);

  const initial = {
    streamEndsWithSectionBreak: importedStream.endsWith("\r\n"),
    paragraphs: (imported.body?.paragraphs || []).length,
    textRuns: (imported.body?.textRuns || []).length,
    degradedToPlainText: degraded,
    leakedHtmlText: degraded ? importedText.slice(0, 120) : "",
  };

  univerAPI.createDocument({
    ...imported,
    id: unitId,
    title: unitId,
    documentStyle: imported.documentStyle || defaultDocumentStyle(univerAPI),
  });
  await delay(700);

  const active = univerAPI.getDocument(unitId) || univerAPI.getActiveDocument();
  if (!active) throw new Error("no-document:" + unitId);

  const redPixels = await waitForImage();

  const model = active.getDocumentDataModel();
  const snapshot = typeof active.save === "function" ? active.save() : model.getSnapshot();

  let htmlOut = "";
  let htmlError = "";
  try {
    htmlOut = convertBodyToHtml(structuredClone(snapshot));
  } catch (error) {
    htmlError = String((error && error.message) || error);
    errors.push("export:" + unitId + ":" + htmlError);
  }

  return {
    unitId,
    initial,
    importedFeatures: features(imported),
    snapshot,
    snapshotJson: JSON.stringify(snapshot),
    snapshotFeatures: features(snapshot),
    paragraphs: paragraphSlices(snapshot),
    project: project(snapshot),
    profile: profileRuns(snapshot),
    dataStream: snapshot.body?.dataStream || "",
    plainText: visibleText(snapshot.body?.dataStream || ""),
    redPixels,
    html: htmlOut,
    htmlError,
    htmlSummary: summarizeHtml(htmlOut),
  };
}

async function run() {
  const univerAPI = mountUniver();

  setStatus("A 轮：导入原始 HTML…");
  const stageA = await importStage(univerAPI, FIXTURE_HTML, "spike-convert-a");

  window.__spike.passA = {
    redPixels: stageA.redPixels,
    initial: stageA.initial,
    snapshotFeatures: stageA.snapshotFeatures,
    htmlSummary: stageA.htmlSummary,
  };
  setStatus("A 轮已渲染，等待截图…");
  const waitDeadline = Date.now() + 8000;
  while (!window.__spike.goOn && Date.now() < waitDeadline) {
    await delay(100);
  }

  setStatus("B 轮：导入 A 轮导出的 HTML…");
  const stageB = await importStage(univerAPI, stageA.html, "spike-convert-b");

  setStatus("C 轮：导入 B 轮导出的 HTML…");
  const stageC = await importStage(univerAPI, stageB.html, "spike-convert-c");

  setStatus("D 轮：使用导出预处理再往返…");
  const preparedA = exportPrepared(stageA.snapshot);
  const stageD = await importStage(univerAPI, preparedA.html, "spike-convert-d");
  const preparedD = exportPrepared(stageD.snapshot);
  setStatus("E 轮：验证预处理后的收敛…");
  const stageE = await importStage(univerAPI, preparedD.html, "spike-convert-e");

  const projectAB = diffSnapshots(stageA.project, stageB.project);
  const projectBC = diffSnapshots(stageB.project, stageC.project);
  const profileAB = diffProfiles(stageA.profile, stageB.profile);
  const profileBC = diffProfiles(stageB.profile, stageC.profile);
  const projectDE = diffSnapshots(stageD.project, stageE.project);
  const profileDE = diffProfiles(stageD.profile, stageE.profile);

  const stage = (value) => ({
    unitId: value.unitId,
    initial: value.initial,
    importedFeatures: value.importedFeatures,
    snapshotFeatures: value.snapshotFeatures,
    paragraphs: value.paragraphs,
    redPixels: value.redPixels,
    htmlError: value.htmlError,
    htmlSummary: value.htmlSummary,
    plainText: value.plainText,
    textRuns: (value.project.textRuns || []).length,
  });

  return {
    phase: "convert",
    fixture: { length: FIXTURE_HTML.length, html: FIXTURE_HTML },
    stages: {
      a: stage(stageA),
      b: stage(stageB),
      c: stage(stageC),
      d: stage(stageD),
      e: stage(stageE),
    },
    exportHashes: {
      a: stageA.html.length,
      b: stageB.html.length,
      c: stageC.html.length,
      preparedA: preparedA.html.length,
      preparedD: preparedD.html.length,
    },
    prepare: {
      a: { spacers: preparedA.spacers, gapRuns: preparedA.gapRuns },
      d: { spacers: preparedD.spacers, gapRuns: preparedD.gapRuns },
    },
    htmlABEqual: stageA.html === stageB.html,
    htmlBCEqual: stageB.html === stageC.html,
    htmlPreparedDEEqual: preparedD.html === exportPrepared(stageE.snapshot).html,
    textABEqual: stageA.dataStream === stageB.dataStream,
    textBCEqual: stageB.dataStream === stageC.dataStream,
    plainTextADEqual: stageA.plainText === stageD.plainText,
    plainTextDEEqual: stageD.plainText === stageE.plainText,
    projectAB: { count: projectAB.length, diffs: projectAB },
    projectBC: { count: projectBC.length, diffs: projectBC },
    profileAB,
    profileBC,
    projectDE: { count: projectDE.length, diffs: projectDE },
    profileDE,
    snapshots: {
      a: stageA.project,
      b: stageB.project,
      c: stageC.project,
      d: stageD.project,
      e: stageE.project,
    },
    html: { a: stageA.html, b: stageB.html, c: stageC.html, preparedA: preparedA.html },
  };
}

window.__spike = { ready: null, errors, done: null, passA: null, goOn: false };

const ready = run().catch((error) => {
  errors.push("run: " + (error && error.message ? error.message : error));
  setStatus("实测失败：" + (error && error.message ? error.message : error));
  return { phase: "error", errors };
});
window.__spike.ready = ready;

ready.then((result) => {
  window.__spike.done = result;
  if (result && result.phase === "convert") {
    setStatus(
      "五轮转换完成\n原样导出 A→B：" +
        result.projectAB.count +
        " 处差异\n预处理导出 D→E：" +
        result.projectDE.count +
        " 处差异\n文本保持：" +
        (result.plainTextDEEqual && result.plainTextADEqual ? "是" : "否")
    );
  }
});
