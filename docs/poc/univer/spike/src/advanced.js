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

function measureMainThread(text, family) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `16px ${family}`;
  const metrics = context.measureText(text);
  return {
    width: metrics.width,
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
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

function probeImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve("timeout"), 5000);
    image.onload = () => {
      clearTimeout(timer);
      resolve("loaded");
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve("error");
    };
    image.src = url;
  });
}

async function run() {
  setStatus("加载字体…");
  const fontResponse = await fetch("/font/arial.ttf");
  const fontBytes = await fontResponse.arrayBuffer();

  const customFace = new FontFace("SpikeArial", fontBytes.slice(0));
  await customFace.load();
  document.fonts.add(customFace);

  const cssOnlyFace = new FontFace("CssOnlyFont", fontBytes.slice(0));
  await cssOnlyFace.load();
  document.fonts.add(cssOnlyFace);
  await document.fonts.ready;

  const texts = [
    { key: "custom", value: "WWWWWWWWWW 中文测量 0123456789", family: "SpikeArial" },
    { key: "system", value: "Univer 文档 Worker 0123456789", family: "Microsoft YaHei" },
  ];
  const mainMetrics = {};
  for (const { key, value, family } of texts) {
    mainMetrics[key] = measureMainThread(value, family);
  }
  const mainCssOnlyProbe = measureMainThread("mmmmmmmmmm", "CssOnlyFont");

  setStatus("启动字体探针 Worker…");
  const probeWorker = new Worker(new URL("./font-probe.worker.js", import.meta.url), {
    type: "module",
  });
  const probeReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("font probe timeout")), 15000);
    probeWorker.addEventListener("message", (event) => {
      if (event.data && event.data.ready) {
        clearTimeout(timer);
        resolve();
      }
    });
    probeWorker.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error(event.message || "font probe worker error"));
    });
  });
  await probeReady;
  const workerFontBytes = fontBytes.slice(0);
  const workerMetrics = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("font probe metrics timeout")), 15000);
    probeWorker.addEventListener("message", (event) => {
      if (event.data && event.data.metrics) {
        clearTimeout(timer);
        resolve(event.data);
      }
    });
    probeWorker.postMessage({ fontBytes: workerFontBytes, texts }, [workerFontBytes]);
  });

  setStatus("挂载文档…");
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
          fontFaces: [{ family: "SpikeArial", source: fontBytes.slice(0) }],
        },
      ],
      UniverDrawingPlugin,
      UniverDrawingUIPlugin,
      UniverDocsDrawingPlugin,
      UniverDocsDrawingUIPlugin,
    ],
  });

  const doc = univerAPI.createDocument({
    id: "spike-advanced-doc",
    title: "图片鉴权与字体度量",
    body: {
      dataStream:
        "图片鉴权与字体度量 Spike\r\n图片（ImageSourceType.URL，需 Cookie）插入在文末：\r\n",
    },
  });

  await delay(600);
  const active = univerAPI.getActiveDocument();
  const unitId = active.getDocumentDataModel().getUnitId();
  const length = active.getBody().dataStream.length;
  active.setSelection(length - 2, length - 2);

  const imageUrl = `${location.origin}/protected/dot.png`;
  const transform = buildDocTransform(160, 90);
  const inserted = await univerAPI.executeCommand(InsertDocDrawingCommand.id, {
    unitId,
    drawings: [
      {
        unitId,
        subUnitId: unitId,
        drawingId: "spike-protected-image",
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        imageSourceType: ImageSourceType.URL,
        source: imageUrl,
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

  const crossOrigin = await probeImage(`http://localhost:${location.port}/protected/dot.png`);
  const sameOrigin = await probeImage("/protected/dot.png");
  const resourceEntries = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.includes("/protected/dot.png"));

  const metricsDiff = {};
  for (const { key } of texts) {
    const main = mainMetrics[key];
    const worker = key === "custom" ? workerMetrics.metrics[key].custom : workerMetrics.metrics[key].system;
    metricsDiff[key] = {
      width: Math.abs(main.width - worker.width),
      ascent: Math.abs(main.ascent - worker.ascent),
      descent: Math.abs(main.descent - worker.descent),
    };
  }

  const serverLog = await (await fetch("/spike/log")).json();

  return {
    inserted,
    image: {
      redPixels,
      resourceEntries,
      sameOrigin,
      crossOrigin,
      serverRequests: serverLog.requests,
    },
    fonts: {
      mainMetrics,
      mainCssOnlyProbe,
      workerMetrics: workerMetrics.metrics,
      workerCssOnlyProbe: workerMetrics.cssOnlyProbe,
      workerFallbackProbe: workerMetrics.fallbackProbe,
      metricsDiff,
      workerCustomLoaded: workerMetrics.customLoaded,
      mainCssOnlyLoaded: document.fonts.check("16px CssOnlyFont"),
      mainCustomLoaded: document.fonts.check("16px SpikeArial"),
    },
    errors,
  };
}

const ready = run().catch((error) => {
  errors.push("run: " + (error && error.message ? error.message : error));
  setStatus("实测失败：" + (error && error.message ? error.message : error));
  return { errors };
});

ready.then((result) => {
  setStatus(
    "实测完成\n图片红像素：" +
      (result.image ? result.image.redPixels : "-") +
      "\n字体差异：" +
      (result.fonts ? JSON.stringify(result.fonts.metricsDiff) : "-") +
      (errors.length ? "\n错误：" + errors.join(" | ") : "")
  );
});

window.__spike = { ready, errors };
