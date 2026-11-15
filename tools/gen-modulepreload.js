/* 生成首屏 modulepreload 清单（index.html 里两个标记之间）
   浏览器解析到 `import` 才知道下一个模块地址，零构建下会形成「请求 → 解析 → 再请求」的瀑布。
   这里按 main.js 的静态 import 图一次列全，把发现时机提前到 <head> 解析时。
   低频视图（requirements / branches / report 等）不在此图里，仍由 view-loader 按需加载。

   用法：
     node tools/gen-modulepreload.js          写入 index.html
     node tools/gen-modulepreload.js --check  只校验（check-assets 调用）
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATIC = path.join(ROOT, "frontend");
const INDEX = path.join(STATIC, "index.html");
const ENTRY = "js/main.js";
const START = "<!-- modulepreload:start（由 tools/gen-modulepreload.js 生成，勿手改） -->";
const END = "<!-- modulepreload:end -->";

/* ES Module 静态 import 递归；动态 import() 与 bare specifier 不计入首屏 */
function collect(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const file = path.join(STATIC, rel);
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(/^\s*import\s+[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith(".")) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (path.posix.extname(target) !== ".js") continue;
      if (!seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

function render(files) {
  const lines = files.map(function (rel) {
    return '<link rel="modulepreload" href="' + rel + '" />';
  });
  return START + "\n" + lines.join("\n") + "\n" + END;
}

const block = render(collect(ENTRY));
const html = fs.readFileSync(INDEX, "utf8");
const startAt = html.indexOf(START);
const endAt = html.indexOf(END, startAt);
if (startAt < 0 || endAt < 0) {
  console.error("FAIL: index.html 缺少 modulepreload 标记，请先补上：\n" + START + "\n" + END);
  process.exit(1);
}
const current = html.slice(startAt, endAt + END.length);

if (process.argv.includes("--check")) {
  if (current !== block) {
    console.error("FAIL: index.html 的 modulepreload 清单与 main.js 静态 import 图不一致");
    console.error("      运行 node tools/gen-modulepreload.js 重新生成");
    process.exit(1);
  }
  console.log("OK：modulepreload 清单与首屏 import 图一致（" + collect(ENTRY).length + " 个模块）");
  process.exit(0);
}

fs.writeFileSync(INDEX, html.slice(0, startAt) + block + html.slice(endAt + END.length));
console.log("OK：已写入 " + collect(ENTRY).length + " 条 modulepreload（index.html <head>）");
