/* 一次性下载脚本：拉取 Univer UMD 依赖到 vendor/（跑完可删） */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "vendor");
fs.mkdirSync(OUT, { recursive: true });

const V = "1.5.2";
const U = (pkg, file) => `https://unpkg.com/@univerjs/${pkg}@${V}/lib/umd/${file}`;
const UROOT = (pkg, file) => `https://unpkg.com/@univerjs/${pkg}@${V}/lib/${file}`;

const FILES = [
  ["react.production.min.js", "https://unpkg.com/react@18.3.1/umd/react.production.min.js"],
  ["react-dom.production.min.js", "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"],
  ["rxjs.umd.min.js", "https://unpkg.com/rxjs@7.8.1/dist/bundles/rxjs.umd.min.js"],
  ["echarts.min.js", "https://unpkg.com/echarts@5.6.0/dist/echarts.min.js"],
  ["redi.js", "https://unpkg.com/@wendellhu/redi@1.1.2/dist/umd/index.js"],
  ["redi-react-bindings.js", "https://unpkg.com/@wendellhu/redi@1.1.2/dist/umd/react-bindings/index.js"],

  ["themes.js", U("themes", "index.js")],
  ["protocol.js", U("protocol", "index.js")],
  ["core.js", U("core", "index.js")],
  ["core-facade.js", U("core", "facade.js")],
  ["rpc.js", U("rpc", "index.js")],
  ["design.js", U("design", "index.js")],
  ["design.css", UROOT("design", "index.css")],
  ["engine-render.js", U("engine-render", "index.js")],
  ["engine-formula.js", U("engine-formula", "index.js")],
  ["engine-formula-facade.js", U("engine-formula", "facade.js")],
  ["drawing.js", U("drawing", "index.js")],
  ["ui.js", U("ui", "index.js")],
  ["ui-facade.js", U("ui", "facade.js")],
  ["ui.css", UROOT("ui", "index.css")],
  ["docs.js", U("docs", "index.js")],
  ["docs-ui.js", U("docs-ui", "index.js")],
  ["docs-ui-facade.js", U("docs-ui", "facade.js")],
  ["docs-ui.css", UROOT("docs-ui", "index.css")],

  ["locale-design-zh-CN.js", U("design", "locale/zh-CN.js")],
  ["locale-ui-zh-CN.js", U("ui", "locale/zh-CN.js")],
  ["locale-docs-ui-zh-CN.js", U("docs-ui", "locale/zh-CN.js")],
  ["locale-design-en-US.js", U("design", "locale/en-US.js")],
  ["locale-ui-en-US.js", U("ui", "locale/en-US.js")],
  ["locale-docs-ui-en-US.js", U("docs-ui", "locale/en-US.js")],
];

(async () => {
  let ok = 0, fail = 0;
  for (const [name, url] of FILES) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(OUT, name), buf);
      console.log("OK  ", name, (buf.length / 1024).toFixed(0) + "KB");
      ok++;
    } catch (e) {
      console.log("MISS", name, url, "-", e.message);
      fail++;
    }
  }
  console.log(`done: ${ok} ok, ${fail} miss`);
})();
