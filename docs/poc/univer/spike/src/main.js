import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import { UniverDocsLayoutWorkerPlugin } from "@univerjs/docs";
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

const { univerAPI } = createUniver({
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
});

const documentData = {
  id: "spike-doc-1",
  title: "Spike 正文渲染",
  body: {
    dataStream:
      "Univer 文档底座 Spike\r\n这是正文第二段，用于验证布局 worker 是否把文字排出来。\r\n",
  },
};

const doc = univerAPI.createDocument(documentData);

function bodyText() {
  const active = univerAPI.getActiveDocument();
  if (!active) return "";
  const body = active.getBody();
  return body ? body.dataStream : "";
}

window.__spike = {
  univerAPI,
  doc,
  errors,
  bodyText,
  snapshot() {
    const active = univerAPI.getActiveDocument();
    return active ? active.getDocumentDataModel().getSnapshot() : null;
  },
  append(text) {
    const active = univerAPI.getActiveDocument();
    if (!active) return false;
    const length = (active.getBody().dataStream || "").length - 2;
    return active.insertText(length, text);
  },
  async selfTest() {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const before = bodyText();
    const active = univerAPI.getActiveDocument();
    if (!active) return { ok: false, reason: "no-active-document" };

    const inserted = active.insertText(0, "【自检】");
    await delay(700);
    const afterInsert = bodyText();
    const snapshot = active.getDocumentDataModel().getSnapshot();
    const snapshotHasText = JSON.stringify(snapshot).includes("【自检】");
    const undone = await univerAPI.undo();
    await delay(700);
    const afterUndo = bodyText();

    return {
      ok:
        inserted === true &&
        afterInsert.startsWith("【自检】") &&
        snapshotHasText &&
        undone === true &&
        afterUndo === before,
      inserted,
      snapshotHasText,
      undone,
      restored: afterUndo === before,
      beforeLength: before.length,
      afterInsertLength: afterInsert.length,
    };
  },
  canvasCount() {
    return document.querySelectorAll("#app canvas").length;
  },
};

setStatus("已创建文档，等待正文渲染…");

setTimeout(() => {
  setStatus(
    "文档已就绪\n正文长度：" +
      bodyText().length +
      "\ncanvas：" +
      window.__spike.canvasCount() +
      (errors.length ? "\n错误：" + errors.join(" | ") : "")
  );
}, 1500);
