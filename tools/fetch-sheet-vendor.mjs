/* 一次性脚本：拉取表格扩展 UMD 与 ExcelJS 浏览器包到 frontend/vendor（版本必须与本仓 Univer 核心一致） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const V = "1.3.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "vendor");
const UNIVER = path.join(ROOT, "univer");
const U = (pkg, file) => `https://unpkg.com/@univerjs/${pkg}@${V}/lib/umd/${file}`;
const UROOT = (pkg, file) => `https://unpkg.com/@univerjs/${pkg}@${V}/lib/${file}`;

const PLUGINS = [
  ["sheets-filter", true],
  ["sheets-sort", true],
  ["sheets-conditional-formatting", true],
  ["sheets-data-validation", true],
  ["sheets-hyper-link", true]
];

const FILES = [
  ["data-validation.js", U("data-validation", "index.js")],
  ["locale/data-validation.js", U("data-validation", "locale/zh-CN.js")],
  ["find-replace.js", U("find-replace", "index.js")],
  ["locale/find-replace.js", U("find-replace", "locale/zh-CN.js")]
];
/* sheets-sort 自 1.3.0 起没有独立语言包（文案在 sheets-sort-ui 里） */
const NO_LOCALE = new Set(["sheets-sort"]);
for (const [pkg, hasUi] of PLUGINS) {
  FILES.push([`${pkg}.js`, U(pkg, "index.js")]);
  if (!NO_LOCALE.has(pkg)) {
    FILES.push([`locale/${pkg}.js`, U(pkg, "locale/zh-CN.js")]);
  }
  if (hasUi) {
    const ui = `${pkg}-ui`;
    FILES.push([`${ui}.js`, U(ui, "index.js")]);
    FILES.push([`locale/${ui}.js`, U(ui, "locale/zh-CN.js")]);
    FILES.push([`css/${ui}.css`, UROOT(ui, "index.css")]);
  }
}
FILES.push(["sheets-find-replace.js", U("sheets-find-replace", "index.js")]);
FILES.push(["../exceljs/exceljs.min.js", "https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js"]);

let ok = 0;
const failed = [];
for (const [name, url] of FILES) {
  const out = path.resolve(UNIVER, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, buf);
    console.log("OK  ", name, `${(buf.length / 1024).toFixed(0)}KB`);
    ok++;
  } catch (e) {
    console.log("MISS", name, url, "-", e.message);
    failed.push(name);
  }
}
console.log(`done: ${ok}/${FILES.length}${failed.length ? " failed=" + failed.join(",") : ""}`);
if (failed.length) process.exit(1);
