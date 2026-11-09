/* ============================================================================
   生成自包含的静态预览稿：docs/preview/ui-preview.html
   把真实的 index.html + CSS + JS 内联成一个单文件，并注入 tools/preview/preview-mock.js
   的演示数据（不连后端也能看全套界面）。

   用法：node tools/preview/gen-preview.js
   ————————————————————————————————————————————————————————————————
   注意：
     · 预览稿只是"某一时刻的快照"，改完前端要重新跑一次命令才会同步；
     · 演示数据在 tools/preview/preview-mock.js 里改，比如让某一列塞满卡片来验证滚动；
     · 产物 docs/preview/ui-preview.html 体积较大（~450KB），不要手工编辑。
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STATIC = path.join(ROOT, "frontend");
const OUT = path.join(ROOT, "docs/preview/ui-preview.html");

/** 递归展开 @import，把多个 CSS 合成一份 */
function inlineCss(file) {
  let css = fs.readFileSync(file, "utf8");
  return css.replace(/@import\s+(?:url\()?\s*["']?([^"')]+)["']?\s*\)?\s*;/g, function (m, rel) {
    const p = path.join(path.dirname(file), rel.trim());
    return fs.existsSync(p) ? inlineCss(p) : m;
  });
}

let html = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");

/* 运行时配置内联：预览稿是单文件，不能依赖同目录的 config.js */
const configSrc = fs.readFileSync(path.join(STATIC, "config.js"), "utf8");
html = html.replace(/<script src="config\.js"><\/script>/,
  function () { return "<script>\n" + configSrc + "\n</script>"; });

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
  /* 用一条正则按源码顺序收集：具名导入与副作用导入（import "x";）交叉出现时，
     分两条正则遍历会把副作用导入全部排到后面，拼接顺序就不再等于真实 ESM 求值顺序
     （templates/index.js 必须早于 core/dom.js 就是靠这一点）。 */
  const re = /^\s*import\s+(?:[^;]*?from\s+)?"([^"]+)";/gm;
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
/* 低频视图也要先访问依赖再入队，否则 manager-shared / list-preferences 可能晚于使用方执行 */
/* main.js 必须最先访问：它才对应真实 ESM 的求值顺序。若按目录序先走别的模块，
   format↔state 循环依赖会让 state.js（顶层就调 startOfDay）排到 lib/gantt-shared
   的 const GS 之前，整包直接 TDZ 报错 */
visit("main.js");
for (const m of modules) visit(m);

/* 真实 ESM 每个文件一个作用域；平铺拼接会把各模块顶层的 const cache / render /
   statusName 等同名声明挤进同一作用域（const 重名直接 SyntaxError，函数重名则互相覆盖）。
   因此：被 import 引用的共享模块与低频视图各自包一层 IIFE，导出放进 __NS[路径]，
   依赖方从 __NS 解构取用；其余模块保持平铺（导出仍以原标识符对外可见）。 */
const LAZY_VIEWS = ["gantt", "projects", "requirements", "review", "analysis", "settings", "profile",
  "phase", "demands", "portfolio", "project", "workload", "risks", "report", "testcases", "messages"];
const WRAPPED = new Set(LAZY_VIEWS.map(function (n) { return "views/" + n + ".js"; })
  .concat(["core/list-preferences.js", "core/activity-ui.js", "views/manager-shared.js",
    /* view-loader 的 const cache 与 transitions.js 的 var cache 同名：
       平铺拼接会在同一作用域重复声明，真实 ESM 各自独立作用域 */
    "core/view-loader.js",
    /* fullscreen 的 init/enter/exit 与 search-palette 的 init 同名：平铺会让后者覆盖前者，
       预览稿里全屏按钮就成了死按钮（真实 ESM 各文件独立作用域，没有这个问题） */
    "core/fullscreen.js"]));

/** 收集模块的导出表：外部名 → 本地标识符（export { open as openSearchPalette }） */
function collectExports(code) {
  const exported = {};
  code.replace(/^\s*export\s*\{([\s\S]*?)\};\s*$/gm, function (m, inner) {
    inner.split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (part) {
      const alias = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) exported[alias[2]] = alias[1];
      else exported[part] = part;
    });
    return m;
  });
  code.replace(/^export\s+(function|const|var|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    function (m, kind, id) { exported[id] = id; return m; });
  return exported;
}
const exportsCache = new Map();
function exportsOf(name) {
  if (!exportsCache.has(name)) exportsCache.set(name, collectExports(codeOf.get(name) || ""));
  return exportsCache.get(name);
}

/** 剥掉 import/export 并记录导出名；依赖被包装模块时改为从 __NS 取 */
function transformModule(name, code) {
  const exported = collectExports(code);
  code = code.replace(/^\s*export\s*\{([\s\S]*?)\};\s*$/gm, "");
  code = code.replace(/^export\s+(function|const|var|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    function (m, kind, id) { return kind + " " + id; });
  /* 副作用导入（import "x";）没有 from，必须单独剥掉，否则平铺后就是语法错误 */
  code = code.replace(/^\s*import\s+"([^"]+)";\s*$/gm, "");
  code = code.replace(/^\s*import\s+([^;]*?)\s+from\s+"([^"]+)";\s*$/gm, function (m, clause, spec) {
    const target = resolve(name, spec);
    clause = clause.trim();
    if (!WRAPPED.has(target)) {
      /* 平铺模块的声明本来就在外层作用域，跳过即可；但外部名与本地名不一致时
         （export { open as openSearchPalette }、import { init as x }）必须补别名，
         否则原文件里用的新名字未定义 */
      const braces = clause.match(/^\{([\s\S]*)\}$/);
      if (!braces) return "";
      const targetExports = exportsOf(target);
      return braces[1].split(",").map(function (x) { return x.trim(); }).filter(Boolean)
        .map(function (part) {
          const alias = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          const external = alias ? alias[1] : part;
          const binding = alias ? alias[2] : part;
          const local = targetExports[external] || external;
          return binding === local ? "" : "var " + binding + " = " + local + ";";
        }).filter(Boolean).join(" ");
    }
    const ns = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (ns) return "var " + ns[1] + " = __NS[" + JSON.stringify(target) + "];";
    const names = clause.replace(/^\{|\}$/g, "").split(",").map(function (x) { return x.trim(); })
      .filter(Boolean).map(function (part) {
        const alias = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        return alias ? (alias[2] + ": " + alias[1]) : part;
      });
    /* 用 var 而不是 const：多个平铺模块可能 import 同一个被包装模块的同一批名字，
       平铺到同一作用域后 const 会重复声明报错；var 重复声明只是再次赋值。 */
    return "var { " + names.join(", ") + " } = __NS[" + JSON.stringify(target) + "];";
  });
  /* 动态 import 在单文件预览里没有可加载路径，改成直接取已注册的命名空间 */
  code = code.replace(/import\(\s*"([^"]+)"\s*\)/g, function (m, spec) {
    const target = resolve(name, spec);
    return WRAPPED.has(target) ? "Promise.resolve(__NS[" + JSON.stringify(target) + "])" : m;
  });
  return { code: code, exported: exported };
}

const chunks = order.map(function (m) {
  const t = transformModule(m, codeOf.get(m) || "");
  /* gantt-shared 内部也有 startOfDay / addDays / iso 等同名函数：单独包一层作用域，
     否则拼接后与 lib/format 的同名函数互相覆盖（真实 ESM 各自有独立作用域，没有这个问题）。 */
  if (m === "lib/gantt-shared.js") {
    return "/* ---- " + m + " ---- */\nconst GS = (function(){\n" + t.code + "\nreturn GS;\n})();";
  }
  if (WRAPPED.has(m)) {
    const props = Object.keys(t.exported).map(function (k) { return k + ": " + t.exported[k]; });
    return "/* ---- " + m + " ---- */\n__NS[" + JSON.stringify(m) + "] = (function(){\n" + t.code +
      "\nreturn {" + props.join(", ") + "};\n})();";
  }
  return "/* ---- " + m + " ---- */\n" + t.code;
}).join("\n");

/* 低频视图在预览稿里没有可 import 的文件路径：把它们的导出注册到 window.__HG_MODULES__，
   core/view-loader 会优先从这里同步取模块（真实部署仍然走原生 dynamic import）。
   注册必须在模块代码之后执行，否则拿不到 IIFE 的返回值。 */
const registry = LAZY_VIEWS.map(function (name) {
  return "window.__HG_MODULES__[" + JSON.stringify(name) + "] = __NS[" +
    JSON.stringify("views/" + name + ".js") + "];";
}).join("\n");

const bundle = "window.__HG_MODULES__ = window.__HG_MODULES__ || {};\nvar __NS = {};\n" +
  chunks + "\n" + registry;

const MOCK = fs.readFileSync(path.join(__dirname, "preview-mock.js"), "utf8");
/* 阅读视图 / Markdown 预览按需加载 vendor/markdown/*（相对路径）：单文件预览下
   404，这里直接内联，loadMarkdownLib 见 window.marked 已存在会立即返回 */
const mdLibs = ["marked.min.js", "purify.min.js"].map(function (f) {
  return "<script>\n" + fs.readFileSync(path.join(STATIC, "vendor", "markdown", f), "utf8") + "\n</" + "script>";
}).join("\n");
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "");
/* ⚠️ 替换内容必须走函数形式：minified 代码里有 $& / $' 之类的串，字符串替换会当成
  特殊模式展开，把内联脚本炸掉 */
html = html.replace(/<script[^>]*type="module"[^>]*src="js\/main\.js"[^>]*><\/script>/,
  function () {
    return "<script>\n" + MOCK + "\n</" + "script>\n" + mdLibs +
      "\n<script>\n(function(){\"use strict\";\n" + bundle + "\n})();\n</" + "script>";
  });

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
