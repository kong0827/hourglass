/* 按前端内容生成 Service Worker 缓存版本号（发布专用）
   背景：前端文件名不带哈希，SW 又是缓存优先。若发布时忘记升 CACHE_NAME，
   浏览器按字节比较 sw.js 会认为"没变"，用户就一直拿旧 JS。
   做法：对 SHELL 里每个文件取内容哈希，写回 CACHE_NAME；前端一改，版本号必然变。
   用法：
     node tools/stamp-sw.js --inplace [前端目录]   就地改写该目录下的 sw.js（打包副本）
     node tools/stamp-sw.js --check   [前端目录]   只打印会生成什么，不写文件
   默认前端目录为 frontend。改的是"要发布的那份"，不是源码，所以源码里的 -vNNN 仍可保留。 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const argv = process.argv.slice(2);
const inplace = argv.includes("--inplace");
const args = argv.filter(a => !a.startsWith("--"));
const root = path.resolve(args[0] || path.join(__dirname, "..", "frontend"));
const swPath = path.join(root, "sw.js");

function fail(msg) {
  console.error("FAIL: " + msg);
  process.exit(1);
}

if (!fs.existsSync(swPath)) fail("找不到 " + swPath);
const source = fs.readFileSync(swPath, "utf8");
if (!/var CACHE_NAME = "hourglass-shell-[^"]*";/.test(source)) fail("sw.js 里没有 CACHE_NAME 行");

const shellMatch = source.match(/var SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) fail("sw.js 里没有 SHELL 清单");
const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

const hash = crypto.createHash("sha256");
const missing = [];
let counted = 0;
for (const url of shell) {
  const rel = url.replace(/^\.\//, "");
  /* "./" 指目录入口，内容已由 index.html 覆盖 */
  if (!rel || rel.endsWith("/")) continue;
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { missing.push(url); continue; }
  hash.update(rel + "\0");
  hash.update(fs.readFileSync(file));
  counted++;
}
if (missing.length) fail("SHELL 里这些文件不存在，发布包不完整：\n  " + missing.join("\n  "));

const name = "hourglass-shell-" + hash.digest("hex").slice(0, 12);
if (inplace) {
  const next = source.replace(/var CACHE_NAME = "hourglass-shell-[^"]*";/, 'var CACHE_NAME = "' + name + '";');
  if (next === source && !source.includes('"' + name + '"')) fail("改写 CACHE_NAME 失败");
  if (next !== source) fs.writeFileSync(swPath, next);
}
console.log(name);
console.error("SHELL 文件 " + counted + " 个；" + (inplace ? "已写入 " : "未写入（--check）") + swPath);
