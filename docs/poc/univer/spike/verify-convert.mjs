import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = Number(process.env.SPIKE_PORT || 8127);
const target = process.env.SPIKE_URL || `http://127.0.0.1:${port}/spike/enter-convert`;
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

async function poll(evaluate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await page.evaluate(evaluate);
      if (value) return value;
    } catch (error) {
      // 页面刷新或执行上下文切换时重试
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("timeout waiting for " + label);
}

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });

  const passA = await poll(
    () => (window.__spike && window.__spike.passA ? window.__spike.passA : null),
    90000,
    "passA"
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.screenshot({ path: path.join(here, "shot-convert-a.png") });
  await page.evaluate(() => {
    window.__spike.goOn = true;
  });

  const done = await poll(
    () => (window.__spike && window.__spike.done ? window.__spike.done : null),
    180000,
    "convert result"
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.screenshot({ path: path.join(here, "shot-convert-e.png") });

  const { a, b, c, d, e } = done.stages || {};
  const checks = {
    phaseConvert: done.phase === "convert",
    noPageErrors: (done.errors || []).length === 0,
    fixtureImportNotDegraded: a.initial?.degradedToPlainText === false,
    fixtureImportRich:
      (a.importedFeatures?.boldChars || 0) > 0 &&
      (a.importedFeatures?.links || 0) === 1 &&
      (a.importedFeatures?.tables || 0) === 1,
    imageRenderedEveryPass: [a, b, c, d, e].every((stage) => (stage.redPixels || 0) > 0),
    exportAHasHeadings: (a.htmlSummary?.headingLevels || []).length === 3,
    rawExportNoControlChars:
      (a.htmlSummary?.controlChars || 0) === 0 &&
      (b.htmlSummary?.controlChars || 0) === 0 &&
      (c.htmlSummary?.controlChars || 0) === 0,
    preparedExportNoControlChars:
      (d.htmlSummary?.controlChars || 0) === 0 && (e.htmlSummary?.controlChars || 0) === 0,
    preparedRestoresText: done.plainTextADEqual === true,
    preparedKeepsText: done.plainTextDEEqual === true,
    convergedSnapshotDE: done.projectDE?.count === 0,
    convergedProfileDE: (done.profileDE?.diffs || []).length === 0,
    preparedHtmlStableDE: done.htmlPreparedDEEqual === true,
  };

  console.log(
    JSON.stringify(
      {
        target,
        checks,
        passA,
        officialPath: {
          htmlABEqual: done.htmlABEqual,
          htmlBCEqual: done.htmlBCEqual,
          textABEqual: done.textABEqual,
          textBCEqual: done.textBCEqual,
          projectAB: done.projectAB,
          projectBC: done.projectBC,
          profileAB: done.profileAB,
          profileBC: done.profileBC,
          exportLengths: { a: done.exportHashes?.a, b: done.exportHashes?.b, c: done.exportHashes?.c },
        },
        preparedPath: {
          prepare: done.prepare,
          plainTextADEqual: done.plainTextADEqual,
          plainTextDEEqual: done.plainTextDEEqual,
          projectDE: done.projectDE,
          profileDE: done.profileDE,
          htmlPreparedDEEqual: done.htmlPreparedDEEqual,
          exportLengths: { a: done.exportHashes?.preparedA, d: done.exportHashes?.preparedD },
        },
        findings: {
          headingLevels: {
            exportedA: a.htmlSummary?.headingLevels || [],
            exportedB: b.htmlSummary?.headingLevels || [],
            snapshotA: a.snapshotFeatures?.headings || {},
            snapshotD: d.snapshotFeatures?.headings || {},
          },
          features: {
            importedA: a.importedFeatures,
            snapshotA: a.snapshotFeatures,
            snapshotB: b.snapshotFeatures,
            snapshotC: c.snapshotFeatures,
            snapshotD: d.snapshotFeatures,
            snapshotE: e.snapshotFeatures,
          },
          htmlSummary: { a: a.htmlSummary, b: b.htmlSummary, c: c.htmlSummary, d: d.htmlSummary },
          paragraphsA: a.paragraphs,
          paragraphsD: d.paragraphs,
        },
        html: done.html,
        errors: done.errors,
        consoleErrors,
        badResponses,
      },
      null,
      2
    )
  );
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
