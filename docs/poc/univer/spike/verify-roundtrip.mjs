import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = Number(process.env.SPIKE_PORT || 8126);
const target = process.env.SPIKE_URL || `http://127.0.0.1:${port}/spike/enter-roundtrip`;
const here = path.dirname(fileURLToPath(import.meta.url));

const server = await startServer(port);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--window-size=1440,900",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const consoleErrors = [];
const badResponses = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
});
page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));

async function waitForDone(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const done = await page.evaluate(() => (window.__spike ? window.__spike.done : null));
      if (done) return done;
    } catch (error) {
      // 页面刷新会销毁执行上下文，重试即可
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("timeout waiting for roundtrip result");
}

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  const done = await waitForDone(120000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: path.join(here, "shot-roundtrip.png") });

  const result = done.result || {};
  const gen2 = result.gen2 || {};
  const checks = {
    phaseVerify2: done.phase === "verify2",
    textMatch: result.textMatch === true,
    snapshotDeepEqual: result.diffCount === 0,
    imageRerenderedFromSnapshot: result.redPixelsAfter > 0,
    listPreserved: result.listItems === 2,
    linkPreserved: (result.links || []).some((link) => link.url === "https://docs.univer.ai"),
    editableAfterReload: result.editAfterReload === true,
    undoAfterReload: result.undoAfterReload === true,
    gen2Saved: gen2.markerCount === 1,
    gen2TextMatch: gen2.textMatch === true,
    gen2DeepEqual: gen2.diffCount === 0,
    gen2ParagraphsStable: gen2.paragraphDelta === 0,
    gen2ImageRerendered: gen2.redPixels > 0,
    noPageErrors: (done.errors || []).length === 0,
  };

  console.log(
    JSON.stringify({ target, result, checks, consoleErrors, badResponses }, null, 2)
  );
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
