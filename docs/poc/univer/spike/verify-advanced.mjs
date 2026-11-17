import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = Number(process.env.SPIKE_PORT || 8125);
const target = process.env.SPIKE_URL || `http://127.0.0.1:${port}/spike/enter`;
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

try {
  await page.goto(target, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__spike && window.__spike.ready, { timeout: 60000 });
  const result = await page.evaluate(() => window.__spike.ready);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await page.screenshot({ path: path.join(here, "shot-advanced.png") });

  const sameOriginRequests = result.image.serverRequests.filter(
    (entry) => entry.host.startsWith("127.0.0.1") && entry.cookie === true
  );
  const crossOriginRequests = result.image.serverRequests.filter(
    (entry) => entry.host.startsWith("localhost") && entry.cookie === false
  );

  const cssOnlyWidthDiff = Math.abs(
    result.fonts.mainCssOnlyProbe.width - result.fonts.workerCssOnlyProbe.width
  );

  const checks = {
    imageInserted: result.inserted === true,
    imageRendered: result.image.redPixels > 0,
    sameOriginWithCookie: sameOriginRequests.length > 0,
    crossOriginWithoutCookie401: result.image.crossOrigin === "error" && crossOriginRequests.length > 0,
    customFontWorkerLoaded: result.fonts.workerCustomLoaded === true,
    cssOnlyFontAbsentInWorker: cssOnlyWidthDiff > 1,
    customMetricsMatch: result.fonts.metricsDiff.custom.width <= 1 && result.fonts.metricsDiff.custom.ascent <= 1,
    systemMetricsMatch: result.fonts.metricsDiff.system.width <= 1 && result.fonts.metricsDiff.system.ascent <= 1,
    noPageErrors: (result.errors || []).length === 0,
  };

  console.log(JSON.stringify({ target, result, checks, consoleErrors, badResponses }, null, 2));
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
