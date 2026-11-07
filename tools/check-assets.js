/* 静态资源清单检查（CODE-5 / F-LOAD-3 配套）
   1) sw.js 的 SHELL 里每个路径是否真实存在；
   2) 页面引用的 js/css 是否都在预缓存清单里（漏一个，离线就会白屏）；
   3) ES Module 的静态 import 图是否完整（新拆的模块忘记进 SHELL 会离线报错）；
   4) CACHE_NAME 是否带版本号；
   5) 每个 ES Module 的语法是否可通过（CI 冒烟，不需要浏览器环境）。
   用法：node tools/check-assets.js */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STATIC = path.join(ROOT, "frontend");
const sw = fs.readFileSync(path.join(STATIC, "sw.js"), "utf8");

const cacheMatch = sw.match(/var CACHE_NAME\s*=\s*"([^"]+)"/);
if (!cacheMatch) fail("sw.js 里找不到 CACHE_NAME");
const cacheName = cacheMatch[1];
if (!/-v\d+$/.test(cacheName)) fail("CACHE_NAME 缺少版本后缀：" + cacheName);

const shellMatch = sw.match(/var SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) fail("sw.js 里找不到 SHELL 清单");
const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
/* SHELL 使用相对路径（相对 sw.js 所在目录），统一成以 / 开头的逻辑路径做比对 */
const shellSet = new Set(shell.map(url => "/" + url.replace(/^\.\//, "").replace(/^\//, "")));

const missing = [];
for (const url of shell) {
  const rel = url.replace(/^\.\//, "");
  if (!rel) continue;
  if (!fs.existsSync(path.join(STATIC, rel))) missing.push(url);
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

/* ES Module 静态 import 递归（相对路径按文件所在目录解析） */
const moduleFiles = [];
const jsRoot = path.join(STATIC, "js");
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name !== "vendor") walk(p);
    } else if (name.endsWith(".js")) {
      moduleFiles.push(path.relative(STATIC, p).replace(/\\/g, "/"));
    }
  }
})(jsRoot);

const moduleUrl = rel => "/" + rel;
const importQueue = [...moduleFiles];
const seenModules = new Set();
while (importQueue.length) {
  const rel = importQueue.pop();
  if (seenModules.has(rel)) continue;
  seenModules.add(rel);
  const file = path.join(STATIC, rel);
  if (!fs.existsSync(file)) continue;
  referenced.add(moduleUrl(rel));
  const code = fs.readFileSync(file, "utf8");
  for (const m of code.matchAll(/^\s*import\s+[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith(".")) continue;   // 远程 / bare specifier 不处理
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    if (!seenModules.has(target)) importQueue.push(target);
  }
}

const notPrecached = [...referenced].filter(ref => !shellSet.has(ref));

const syntaxErrors = [];
for (const rel of moduleFiles) {
  const code = fs.readFileSync(path.join(STATIC, rel), "utf8");
  const res = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: code });
  if (res.status !== 0) {
    const detail = String(res.stderr || "").trim().split("\n").slice(0, 4).join("\n");
    syntaxErrors.push(rel + "\n" + detail);
  }
}

console.log("CACHE_NAME: " + cacheName);
console.log("SHELL entries: " + shell.length + ", 页面/模块引用: " + referenced.size + ", 模块文件: " + moduleFiles.length);
if (missing.length) fail("SHELL 里这些文件不存在：\n  " + missing.join("\n  "));
if (notPrecached.length) fail("被引用但未预缓存（离线会白屏）：\n  " + notPrecached.join("\n  "));
if (shellSet.has("/js/app.js")) fail("SHELL 仍引用已拆分的 /js/app.js");
if (syntaxErrors.length) fail("以下模块语法错误：\n" + syntaxErrors.join("\n\n"));
console.log("OK：静态资源清单完整（含 ES Module import 图与语法）");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}
