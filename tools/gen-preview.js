/* ============================================================================
   生成自包含的静态预览稿：docs/ui-preview.html
   把真实的 index.html + CSS + JS 内联成一个单文件，并注入 tools/preview-mock.js
   的演示数据（不连后端也能看全套界面）。

   用法：node tools/gen-preview.js
   ————————————————————————————————————————————————————————————————
   注意：
     · 预览稿只是"某一时刻的快照"，改完前端要重新跑一次命令才会同步；
     · 演示数据在 tools/preview-mock.js 里改，比如让某一列塞满卡片来验证滚动；
     · 产物 docs/ui-preview.html 体积较大（~450KB），不要手工编辑。
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATIC = path.join(ROOT, "src/main/resources/static");
const OUT = path.join(ROOT, "docs/ui-preview.html");

/** 递归展开 @import，把多个 CSS 合成一份 */
function inlineCss(file) {
  let css = fs.readFileSync(file, "utf8");
  return css.replace(/@import\s+(?:url\()?\s*["']?([^"')]+)["']?\s*\)?\s*;/g, function (m, rel) {
    const p = path.join(path.dirname(file), rel.trim());
    return fs.existsSync(p) ? inlineCss(p) : m;
  });
}

let html = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");

/* 1) 样式内联 */
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, function (m, href) {
  const p = path.join(STATIC, href.replace(/^\//, ""));
  return fs.existsSync(p) ? ("<style>\n" + inlineCss(p) + "\n</style>") : m;
});

/* 2) 原生 ES Module → 单文件预览包
   预览稿不能加载相对路径的模块（单文件、file:// 也能打开），因此按 import 图做一次
   "模块拼接"：静态 import/export 行剥掉，所有模块按依赖顺序放进同一个 IIFE。
   函数声明在同一作用域里会提升，循环引用与浏览器原生 ESM 表现一致。 */
const JS = path.join(STATIC, "js");

function listModules() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (name !== "vendor") walk(p);
      } else if (name.endsWith(".js") && name !== "share.js") {
        /* share.js 是独立的分享页入口，不参与主页面预览包 */
        out.push(path.relative(JS, p).replace(/\\/g, "/"));
      }
    }
  })(JS);
  return out;
}

const modules = listModules();
const codeOf = new Map(modules.map(m => [m, fs.readFileSync(path.join(JS, m), "utf8")]));

function importsOf(code) {
  const out = [];
  const re = /^\s*import\s+[^;]*?from\s+"([^"]+)";/gm;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}
function resolve(from, spec) {
  const dir = path.posix.dirname(from);
  const parts = dir === "." ? [] : dir.split("/");
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/* main.js 出发做 DFS；动态 import 的视图模块（没被静态引用）放到最后 */
const order = [];
const seen = new Set();
function visit(name) {
  if (seen.has(name) || !codeOf.has(name)) return;
  seen.add(name);
  for (const spec of importsOf(codeOf.get(name))) visit(resolve(name, spec));
  order.push(name);
}
visit("main.js");
for (const m of modules) if (!seen.has(m)) order.push(m);

function stripModule(code) {
  code = code.replace(/^\s*import\s+[^;]*?from\s+"[^"]+";\s*$/gm, "");
  code = code.replace(/^\s*import\s+"[^"]+";\s*$/gm, "");
  code = code.replace(/^export\s*\{([^}]*)\};\s*$/gm, function (m, inner) {
    const aliases = [];
    inner.split(",").map(x => x.trim()).filter(Boolean).forEach(function (part) {
      const mm = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (mm) aliases.push("var " + mm[2] + " = " + mm[1] + ";");
    });
    return aliases.join("\n");
  });
  return code.replace(/^export\s+/gm, "");
}

/* 低频视图在预览稿里没有可 import 的文件路径：把它们的导出注册到 window.__DS_MODULES__，
   core/view-loader 会优先从这里同步取模块（真实部署仍然走原生 dynamic import）。 */
const LAZY_VIEWS = ["gantt", "projects", "requirements", "review", "analysis", "settings", "profile"];
const registry = LAZY_VIEWS.map(function (name) {
  const code = codeOf.get("views/" + name + ".js") || "";
  const mm = code.match(/^export\s*\{([^}]*)\};/m);
  if (!mm) return "";
  const props = mm[1].split(",").map(x => x.trim()).filter(Boolean).map(function (part) {
    const alias = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    return alias ? (alias[2] + ": " + alias[1]) : (part + ": " + part);
  });
  return "window.__DS_MODULES__[" + JSON.stringify(name) + "] = {" + props.join(", ") + "};";
}).filter(Boolean).join("\n");

const bundle = "window.__DS_MODULES__ = window.__DS_MODULES__ || {};\n" + registry + "\n" + order.map(function (m) {
  const code = stripModule(codeOf.get(m));
  /* gantt-shared 内部也有 startOfDay / addDays / iso 等同名函数：单独包一层作用域，
     否则拼接后与 lib/format 的同名函数互相覆盖（真实 ESM 各自有独立作用域，没有这个问题）。 */
  if (m === "lib/gantt-shared.js") {
    return "/* ---- " + m + " ---- */\nconst GS = (function(){\n" + code + "\nreturn GS;\n})();";
  }
  return "/* ---- " + m + " ---- */\n" + code;
}).join("\n");

const MOCK = fs.readFileSync(path.join(__dirname, "preview-mock.js"), "utf8");
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "");
html = html.replace(/<script[^>]*type="module"[^>]*src="js\/main\.js"[^>]*><\/script>/,
  "<script>\n" + MOCK + "\n(function(){\"use strict\";\n" + bundle + "\n})();\n</" + "script>");

/* 3) 底部说明条
   ⚠️ 不能用 html.replace("</body>", …)：replace 只换第一个匹配，而 SunEditor 的
   代码视图模板里自带 "</body>\n</html>" 字符串（出现在真正的 </body> 之前），
   横幅会被注入进 JS 字符串中间，把编辑器脚本炸出 SyntaxError。
   必须拼接「最后一个 </body>」。 */
html = html.replace("<body", '<body data-preview="1"');
const banner = [
  '<div style="position:fixed;left:0;right:0;bottom:var(--app-foot-h,26px);z-index:99999;display:flex;align-items:center;gap:10px;',
  'padding:8px 14px;background:#1B2430;color:#E8EEF6;font:12.5px/1.5 -apple-system,BlinkMacSystemFont,',
  '\'Segoe UI\',\'Microsoft YaHei\',sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.18)">',
  '<strong style="font-weight:700">静态预览稿</strong>',
  '<span style="opacity:.82">真实 CSS/JS 快照 + 演示数据，不连后端。',
  '可看：①看板「待处理」列 8 张卡片（列内滚动、卡片不被压扁）；',
  '②「需求」编辑页的 SunEditor（表格/无边框整页书写）；',
  '③「周回顾」的「进行中」与「本周完成」。</span>',
  '<span style="margin-left:auto;opacity:.62">' + new Date().toISOString().slice(0, 16).replace("T", " ") + "</span>",
  "</div>"
].join("");
const bodyClose = html.lastIndexOf("</body>");
html = html.slice(0, bodyClose) + banner + "\n</body>" + html.slice(bodyClose + "</body>".length);

fs.writeFileSync(OUT, html, "utf8");
console.log("已生成 " + OUT + "  （" + Math.round(Buffer.byteLength(html, "utf8") / 1024) + " KB）");
