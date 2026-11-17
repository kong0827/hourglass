let canvas;
let context;

function measure(text, family) {
  context.font = `16px ${family}`;
  const metrics = context.measureText(text);
  return {
    width: metrics.width,
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
  };
}

self.onmessage = async (event) => {
  const { fontBytes, texts } = event.data;
  if (!canvas) {
    canvas = new OffscreenCanvas(600, 100);
    context = canvas.getContext("2d");
  }

  const face = new FontFace("SpikeArial", fontBytes);
  await face.load();
  self.fonts.add(face);

  const customLoaded = face.status === "loaded";
  const cssOnlyProbe = measure("mmmmmmmmmm", "CssOnlyFont");
  const fallbackProbe = measure("mmmmmmmmmm", "serif");

  const metrics = {};
  for (const { key, value, family } of texts) {
    metrics[key] = { custom: measure(value, "SpikeArial"), system: measure(value, family) };
  }

  self.postMessage({
    customLoaded,
    cssOnlyProbe,
    fallbackProbe,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    metrics,
  });
};

self.postMessage({ ready: true });
