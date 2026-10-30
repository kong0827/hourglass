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

/* 2) 脚本内联，并在第一个脚本前注入演示数据 */
const MOCK = fs.readFileSync(path.join(__dirname, "preview-mock.js"), "utf8");
let injected = false;
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
  const p = path.join(STATIC, src.replace(/^\//, ""));
  if (!fs.existsSync(p)) return m;
  const code = fs.readFileSync(p, "utf8");
  const pre = injected ? "" : ("<script>\n" + MOCK + "\n</" + "script>\n");
  injected = true;
  return pre + "<script>\n" + code + "\n</" + "script>";
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
