/* 静态资源清单检查（CODE-5 / F-LOAD-3 配套）
   1) sw.js 的 SHELL 里每个路径是否真实存在；
   2) 页面引用的 js/css 是否都在预缓存清单里（漏一个，离线就会白屏）；
   3) CACHE_NAME 是否带版本号。
   用法：node tools/check-assets.js */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATIC = path.join(ROOT, "src/main/resources/static");
const sw = fs.readFileSync(path.join(STATIC, "sw.js"), "utf8");

const cacheMatch = sw.match(/var CACHE_NAME\s*=\s*"([^"]+)"/);
if (!cacheMatch) fail("sw.js 里找不到 CACHE_NAME");
const cacheName = cacheMatch[1];
if (!/-v\d+$/.test(cacheName)) fail("CACHE_NAME 缺少版本后缀：" + cacheName);

const shellMatch = sw.match(/var SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) fail("sw.js 里找不到 SHELL 清单");
const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

const missing = [];
for (const url of shell) {
  if (url === "/" || url.endsWith("/")) continue;
  if (!fs.existsSync(path.join(STATIC, url.replace(/^\//, "")))) missing.push(url);
}

const pages = ["index.html", "share.html", "login.html", "join.html"];
const referenced = new Set();
for (const page of pages) {
  const file = path.join(STATIC, page);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  for (const m of html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)) {
    const ref = m[1].split("?")[0];
    if (!/\.(js|css)$/.test(ref)) continue;
    if (/^https?:|^\/?vendor\//.test(ref)) continue;   // 第三方 vendor 运行时缓存
    referenced.add("/" + ref.replace(/^\.?\//, ""));
  }
}

const notPrecached = [...referenced].filter(ref => !shell.includes(ref));

console.log("CACHE_NAME: " + cacheName);
console.log("SHELL entries: " + shell.length + ", 页面引用: " + referenced.size);
if (missing.length) fail("SHELL 里这些文件不存在：\n  " + missing.join("\n  "));
if (notPrecached.length) fail("页面引用但未预缓存（离线会白屏）：\n  " + notPrecached.join("\n  "));
console.log("OK：静态资源清单完整");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}
