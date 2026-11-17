import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import {
  UniverDocsLayoutWorkerPlugin,
  buildDocTransform,
  docDrawingPositionToTransform,
} from "@univerjs/docs";
import {
  BooleanNumber,
  DrawingTypeEnum,
  ImageSourceType,
  PositionedObjectLayoutType,
  WrapTextType,
} from "@univerjs/core";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingUIPlugin } from "@univerjs/drawing-ui";
import { InsertDocDrawingCommand, UniverDocsDrawingPlugin } from "@univerjs/docs-drawing";
import { UniverDocsDrawingUIPlugin } from "@univerjs/docs-drawing-ui";
import "@univerjs/preset-docs-core/lib/index.css";

const STORAGE_KEY = "spike:roundtrip";
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

function countRedPixels() {
  let count = 0;
  for (const canvas of document.querySelectorAll("#app canvas")) {
    const context = canvas.getContext("2d");
    if (!context) continue;
    try {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.length; index += 4 * 5) {
        if (data[index] > 180 && data[index + 1] < 80 && data[index + 2] < 80 && data[index + 3] > 0) {
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
      UniverDrawingPlugin,
      UniverDrawingUIPlugin,
      UniverDocsDrawingPlugin,
      UniverDocsDrawingUIPlugin,
    ],
  }).univerAPI;
}

/** 富文本样本：标题/粗体/斜体/行内代码/链接/两级列表/彩色文本 */
function buildRichData(univerAPI) {
  const listType = univerAPI.Enum.PresetListType.BULLET_LIST;
  const richText = univerAPI
    .newRichText()
    .text("季度评审纪要")
    .paragraph()
    .text("正文：")
    .bold("重点结论")
    .text("，")
    .italic("补充说明")
    .text("，行内代码 ")
    .code("npm run build")
    .text("，链接 ")
    .link("Univer 文档", "https://docs.univer.ai")
    .text("。")
    .listItem("第一条要点", { type: listType, listId: "spike.list" })
    .listItem("第二条要点", { type: listType, listId: "spike.list", level: 1 })
    .paragraph(univerAPI.newParagraphStyle({ namedStyleType: univerAPI.Enum.NamedStyleType.HEADING_2 }))
    .text("二级标题")
    .paragraph()
    .span("红色加粗斜体", { bold: true, italic: true, color: "#d92d20" })
    .text(" 之后是图片：");
  return richText.getData();
}

/** 300 段中文正文，用于快照体积口径（渲染无关） */
function measureLargeDoc(univerAPI) {
  const richText = univerAPI.newRichText();
  for (let index = 0; index < 300; index += 1) {
    richText
      .paragraph()
      .text(`第 ${index + 1} 段：`)
      .bold("重点内容")
      .text(" 这是一段用于体积评估的中文正文，包含少量格式化文本与链接 ")
      .link("示例", `https://example.com/${index}`)
      .text("。");
  }
  const data = richText.getData();
  const json = JSON.stringify(data);
  const plain = data.body.dataStream || "";
  const encoder = new TextEncoder();
  return {
    paragraphs: 300,
    snapshotChars: json.length,
    snapshotBytes: encoder.encode(json).length,
    plainChars: plain.length,
    plainBytes: encoder.encode(plain).length,
  };
}

async function gzipBytes(text) {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return buffer.byteLength;
}

/** 深度 diff：返回前 N 条字段级差异，跳过易变字段 */
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

async function runBuildPhase(univerAPI) {
  setStatus("构建富文本样本…");
  const data = buildRichData(univerAPI);
  data.id = "spike-roundtrip-doc";
  data.title = "快照往返验证";

  const doc = univerAPI.createDocument(data);
  await delay(600);
  const active = univerAPI.getActiveDocument();
  if (!active) throw new Error("no-active-document");

  // 首段加一级标题（builder 对空文档调用 paragraph() 是 no-op，只能落到文档后补样式）
  const first = active.getParagraphs()[0];
  if (first) {
    first.setStyle({
      namedStyleType: univerAPI.Enum.NamedStyleType.HEADING_1,
      textStyle: { fs: 22, bl: BooleanNumber.TRUE },
    });
  }

  const unitId = active.getDocumentDataModel().getUnitId();
  const length = active.getBody().dataStream.length;
  active.setSelection(length - 2, length - 2);
  const transform = buildDocTransform(160, 90);
  await univerAPI.executeCommand(InsertDocDrawingCommand.id, {
    unitId,
    drawings: [
      {
        unitId,
        subUnitId: unitId,
        drawingId: "spike-roundtrip-image",
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: ImageSourceType.URL,
        source: `${location.origin}/protected/dot.png`,
        transform: docDrawingPositionToTransform(transform),
        docTransform: transform,
        behindDoc: BooleanNumber.FALSE,
        title: "",
        description: "",
        layoutType: PositionedObjectLayoutType.INLINE,
        wrapText: WrapTextType.BOTH_SIDES,
        distB: 0,
        distL: 0,
        distR: 0,
        distT: 0,
      },
    ],
  });

  setStatus("等待图片渲染…");
  let redPixels = 0;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await delay(400);
    redPixels = countRedPixels();
    if (redPixels > 0) break;
  }

  const model = active.getDocumentDataModel();
  const snapshot = typeof active.save === "function" ? active.save() : model.getSnapshot();
  const json = JSON.stringify(snapshot);
  const plainText = active.getBody().dataStream;

  const large = measureLargeDoc(univerAPI);

  const payload = {
    snapshotJson: json,
    plainText,
    redPixels,
    snapshotChars: json.length,
    snapshotBytes: new TextEncoder().encode(json).length,
    gzipBytes: await gzipBytes(json),
    textRuns: (snapshot.body?.textRuns || []).length,
    paragraphs: (snapshot.body?.paragraphs || []).length,
    customRanges: (snapshot.body?.customRanges || []).length,
    lists: Object.keys(snapshot.lists || {}).length,
    drawings: Object.keys(snapshot.drawings || {}).length,
    largeDoc: large,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

async function runReloadPhase(univerAPI, payload) {
  const expected = JSON.parse(payload.snapshotJson);
  setStatus("从快照重建文档…");
  univerAPI.createDocument(expected);
  await delay(800);

  let redPixels = 0;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await delay(400);
    redPixels = countRedPixels();
    if (redPixels > 0) break;
  }

  const active = univerAPI.getActiveDocument();
  if (!active) throw new Error("no-active-document-after-reload");
  const model = active.getDocumentDataModel();
  const actual = typeof active.save === "function" ? active.save() : model.getSnapshot();
  const diffs = diffSnapshots(expected, actual);

  const paragraphs = active.getParagraphs();
  const listItems = paragraphs.filter((paragraph) => paragraph.isListItem()).length;
  const richText = univerAPI.newRichTextFromDocumentData(actual);
  const links = richText.getLinks();

  const beforeEdit = active.getBody().dataStream;
  active.insertText(0, "·重载后可编辑·");
  await delay(300);
  const afterInsert = active.getBody().dataStream;
  const undone = await univerAPI.undo();
  await delay(300);
  const afterUndo = active.getBody().dataStream;

  return {
    textMatch: beforeEdit === payload.plainText,
    diffCount: diffs.length,
    diffs,
    redPixelsBefore: payload.redPixels,
    redPixelsAfter: redPixels,
    listItems,
    links: links.map((link) => ({ url: link.properties?.url, start: link.startIndex, end: link.endIndex })),
    editAfterReload: afterInsert.startsWith("·重载后可编辑·") && afterInsert.length === beforeEdit.length + 8,
    undoAfterReload: undone === true && afterUndo === beforeEdit,
    snapshotBytes: payload.snapshotBytes,
    gzipBytes: payload.gzipBytes,
    structure: {
      textRuns: payload.textRuns,
      paragraphs: payload.paragraphs,
      customRanges: payload.customRanges,
      lists: payload.lists,
      drawings: payload.drawings,
    },
    largeDoc: payload.largeDoc,
  };
}

/** 第二轮：像用户一样继续编辑并保存，产出第二代快照 */
async function runSecondEdit(univerAPI) {
  const active = univerAPI.getActiveDocument();
  if (!active) throw new Error("no-active-document-gen2");
  const target = active.getParagraphs()[1] || active.getParagraphs()[0];
  const edited = target ? target.appendText("（第二轮编辑）") : false;
  await delay(400);
  const model = active.getDocumentDataModel();
  const snapshot = typeof active.save === "function" ? active.save() : model.getSnapshot();
  return {
    edited,
    snapshotJson: JSON.stringify(snapshot),
    plainText: active.getBody().dataStream,
    paragraphs: (snapshot.body?.paragraphs || []).length,
  };
}

/** 第三代验证：载入第二代快照，确认重复保存后仍无漂移 */
async function runVerify2(univerAPI, payload) {
  const expected = JSON.parse(payload.gen2.snapshotJson);
  univerAPI.createDocument(expected);
  await delay(800);
  const active = univerAPI.getActiveDocument();
  if (!active) throw new Error("no-active-document-verify2");
  const model = active.getDocumentDataModel();
  const actual = typeof active.save === "function" ? active.save() : model.getSnapshot();
  const diffs = diffSnapshots(expected, actual);
  const text = active.getBody().dataStream;
  const markerCount = (text.match(/（第二轮编辑）/g) || []).length;
  const paragraphs = active.getParagraphs().length;
  let redPixels = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    redPixels = countRedPixels();
    if (redPixels > 0) break;
    await delay(400);
  }
  return {
    diffCount: diffs.length,
    diffs,
    textMatch: text === payload.gen2.plainText,
    markerCount,
    paragraphs,
    paragraphDelta: paragraphs - payload.gen2.paragraphs,
    redPixels,
    snapshotBytes: new TextEncoder().encode(payload.gen2.snapshotJson).length,
  };
}

async function run() {
  const univerAPI = mountUniver();
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    sessionStorage.removeItem(STORAGE_KEY);
    const storedValue = JSON.parse(stored);
    if (storedValue.stage === "reload") {
      setStatus("检测到已存快照，执行重载验证…");
      const result = await runReloadPhase(univerAPI, storedValue.payload);
      setStatus("第一轮通过，继续编辑并保存第二代快照…");
      const gen2 = await runSecondEdit(univerAPI);
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ stage: "verify2", payload: { ...storedValue.payload, gen2, first: result } })
      );
      await delay(300);
      location.reload();
      return new Promise(() => {});
    }
    setStatus("载入第二代快照…");
    const gen2 = await runVerify2(univerAPI, storedValue.payload);
    return { phase: "verify2", result: { ...storedValue.payload.first, gen2 }, errors };
  }
  setStatus("首次进入，构建快照并刷新页面…");
  const payload = await runBuildPhase(univerAPI);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ stage: "reload", payload }));
  setStatus("快照已存，刷新页面验证重载…");
  await delay(300);
  location.reload();
  return new Promise(() => {});
}

window.__spike = { ready: null, errors, done: null };

const ready = run().catch((error) => {
  errors.push("run: " + (error && error.message ? error.message : error));
  setStatus("实测失败：" + (error && error.message ? error.message : error));
  return { phase: "error", errors };
});
window.__spike.ready = ready;

ready.then((result) => {
  window.__spike.done = result;
  if (result && result.phase === "verify2") {
    const r = result.result;
    setStatus(
      "两轮往返完成\n第一轮差异：" +
        r.diffCount +
        "\n第二轮差异：" +
        r.gen2.diffCount +
        "\n图片红像素：" +
        r.redPixelsBefore +
        " → " +
        r.redPixelsAfter +
        " → " +
        r.gen2.redPixels
    );
  }
});
