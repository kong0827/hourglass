import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = "D:/project/hourglass-univer";
const PORT = 8129;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

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
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push("console: " + msg.text());
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/docs/poc/univer/umd-docs-test.html`, { waitUntil: "load", timeout: 60000 });
  const deadline = Date.now() + 30000;
  let probe = null;
  while (Date.now() < deadline) {
    probe = await page.evaluate(() => window.__probe || null);
    if (probe && (probe.ready || probe.error)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), "shot-umd-docs.png") });
  console.log(JSON.stringify({ probe, errors }, null, 2));
} finally {
  await browser.close();
  server.close();
}
