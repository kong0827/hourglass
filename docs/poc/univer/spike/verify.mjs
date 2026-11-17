import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const target = process.env.SPIKE_URL || "http://127.0.0.1:8124/bundle/index.html";
const here = path.dirname(fileURLToPath(import.meta.url));

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
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));

try {
  await page.goto(target, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__spike && window.__spike.doc, { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const geometry = await page.evaluate(() => ({
    canvases: [...document.querySelectorAll("#app canvas")].map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    })),
    status: document.getElementById("spike-status")?.textContent,
    bodyLength: window.__spike.bodyText().length,
    mountErrors: window.__spike.errors,
  }));

  const selfTest = await page.evaluate(() => window.__spike.selfTest());

  await page.mouse.click(700, 185);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const beforeTyping = await page.evaluate(() => window.__spike.bodyText());
  await page.keyboard.type("键盘输入验证", { delay: 40 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const afterTyping = await page.evaluate(() => window.__spike.bodyText());

  const typing = {
    beforeLength: beforeTyping.length,
    afterLength: afterTyping.length,
    typed: afterTyping.includes("键盘输入验证"),
  };

  await page.screenshot({ path: path.join(here, "shot-bundle-typing.png") });

  const result = { target, geometry, selfTest, typing, consoleErrors };
  console.log(JSON.stringify(result, null, 2));

  const ok =
    geometry.canvases.some((canvas) => canvas.width > 0 && canvas.height > 0) &&
    selfTest.ok &&
    typing.typed;
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
