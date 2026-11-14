/* 版本详情 · 关联项联动与下钻原型 · 真实浏览器交互验证与截图
   用法：node tools/e2e/version-detail-proto.mjs
   只读原型文件，不改应用代码；截图落到 docs/audit/prototypes/proto-version-link-*.png。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/version-detail-linkage-proto-2026-11-14.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-version-link-";

function findChrome(){
  const list = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of list){
    const r = spawnSync(bin, ["--version"], { encoding:"utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp{
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let m; try{ m = JSON.parse(raw); }catch(e){ return; }
    if(m.id && this.pending.has(m.id)){
      const { resolve, reject } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }else if(m.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    }else if(m.method === "Runtime.consoleAPICalled" && m.params.type === "error"){
      this.errors.push("console.error: " + m.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(m.method === "Log.entryAdded" && m.params.entry.level === "error"){
      this.errors.push("log: " + m.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const p = { id, method, params };
    if(sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "version-proto-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,1000", "--disable-dev-shm-usage", "--hide-scrollbars",
  "--allow-file-access-from-files"
], { stdio:"ignore" });

let failed = 0, passed = 0;
const ok = (cond, msg) => { if(cond){ passed++; console.log("  PASS " + msg); } else { failed++; console.log("  FAIL " + msg); } };

try{
  let port = null;
  for(let i = 0; i < 100 && !port; i++){
    try{ port = fs.readFileSync(path.join(tmp, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); }
    catch(e){ await sleep(150); }
  }
  if(!port) throw new Error("Chrome CDP 未就绪");
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url:"about:blank" });
  const att = await cdp.send("Target.attachToTarget", { targetId:target.targetId, flatten:true });
  const sid = att.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
  const call = (m, p) => cdp.send(m, p, sid);
  const ev = async expr => {
    const r = await call("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true, userGesture:true });
    if(r.exceptionDetails) throw new Error("执行失败：" + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  };
  const wait = async (expr, label, timeout = 10000) => {
    const end = Date.now() + timeout; let last;
    while(Date.now() < end){
      try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(100);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const click = async sel => {
    const hit = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if(!el) return false; el.click(); return true; })()`);
    if(!hit) throw new Error("点不到元素：" + sel);
    await sleep(140);
  };
  const setSel = async (sel, value) => {
    const done = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if(!el) return false; el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    if(!done) throw new Error("找不到下拉：" + sel);
    await sleep(140);
  };
  let lastW = 1440, lastH = 1000, lastMobile = false;
  const viewport = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width:w, height:h, deviceScaleFactor:mobile ? 2 : 1, mobile:!!mobile });
  const setVP = async (w, h, m) => { lastW = w; lastH = h; lastMobile = !!m; await viewport(w, h, m); await sleep(200); };
  const shot = async (name, full) => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
      const t = document.getElementById('toast'); if(t) t.style.visibility = 'hidden'; return true; })()`);
    if(full){
      await ev("document.body.classList.add('flat')");
      await sleep(160);
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await viewport(lastW, Math.min(h + 16, 14000), lastMobile);
      await sleep(240);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
    if(full){
      await ev("document.body.classList.remove('flat')");
      await viewport(lastW, lastH, lastMobile);
      await sleep(180);
    }
    await ev(`(() => { const t = document.getElementById('toast'); if(t) t.style.visibility = ''; return true; })()`);
  };
  const load = async query => {
    await call("Page.navigate", { url:FILE + (query ? "?" + query : "") });
    await wait("!!document.querySelector('#view-version .vd-head')", "原型首屏");
    await sleep(220);
  };
  const noErrors = label => {
    if(cdp.errors.length){ failed++; console.log("  FAIL " + label + " 控制台报错：" + cdp.errors.join(" | ")); cdp.errors = []; }
    else { passed++; console.log("  PASS " + label + "：无脚本异常"); }
  };
  /* 页面状态快照：页签 / 行数 / 联动条 / 分享 hash / 下拉同步 */
  const state = () => ev(`(() => {
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    return {
      tab: (q(".vd-tab.on") || {}).dataset ? q(".vd-tab.on").dataset.tab : "",
      rows: qa("#view-version tbody tr[data-open]").length,
      empty: !!q("#view-version .tbl-empty"),
      chips: qa(".vd-linked .vd-link-chip").map(c => ({
        k: (c.querySelector(".vd-link-k") || {}).textContent || "",
        v: (c.querySelector(".vd-link-v") || {}).textContent || "",
        open: !!c.querySelector("button.vd-link-v"),
        x: !!c.querySelector(".vd-link-x")
      })),
      hash: (q("#urlOut b") || {}).textContent || "",
      sel: qa("#view-version [data-filter]").reduce((a, el) => { a[el.dataset.filter] = el.value; return a; }, {}),
      panels: qa("#view-version .vd-panel .panel-head h3").map(h => h.textContent),
      kpis: qa("#view-version .vd-kpis .pcell").length,
      layer: !!q("#detailLayer.open"),
      layerTitle: (q("#dtTitle") || {}).textContent || "",
      layerTag: (q("#dtTag") || {}).textContent || "",
      layerFacts: qa("#detailLayer.open .dt-facts .vd-cmp-cell").length,
      toast: q("#toast.on") ? q("#toast").textContent : "",
      annots: qa("#view-version .annot-point").length,
      annotBox: !!q(".annot-box") && getComputedStyle(q(".annot-box")).display !== "none"
    };
  })()`);
  const overflow = label => ev(`(() => {
    const de = document.documentElement;
    const wide = Array.from(document.querySelectorAll("#view-version .panel, #view-version .vd-filters, #view-version .vd-linked, #view-version .vd-head"))
      .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map(el => el.className);
    return { doc: de.scrollWidth - de.clientWidth, wide };
  })()`).then(r => {
    ok(r.doc <= 1 && r.wide.length === 0, label + "：无横向溢出（doc=" + r.doc + "，越界=" + JSON.stringify(r.wide) + "）");
    return r;
  });

  /* ---------- 1. 首屏 ---------- */
  console.log("\n[1] 原型首屏与样式复用");
  await setVP(1440, 1000, false);
  await load("shot=1");
  let s = await state();
  ok(s.tab === "overview" && s.kpis === 9, "概览首屏：9 个指标格，页签停在概览");
  ok(s.panels.length >= 6, "概览面板齐备：" + s.panels.join(" / "));
  const cssOk = await ev(`(() => {
    const chip = document.querySelector(".vd-branch"), head = document.querySelector(".vd-head");
    const cs = getComputedStyle(head);
    return { loaded:Array.from(document.styleSheets).filter(x => x.href).length,
      sticky:cs.position, border:cs.borderBottomWidth, chip:!!chip,
      token:getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() };
  })()`);
  ok(cssOk.loaded === 9 && cssOk.sticky === "sticky" && cssOk.border === "1px" && !!cssOk.token,
    "真实 CSS 生效：9 份样式表、页头 sticky、设计令牌 --primary=" + cssOk.token);
  await overflow("桌面 1440 概览");
  const hues = await ev(`(() => {
    const track = getComputedStyle(document.querySelector(".vd-dist-bar")).backgroundColor;
    return { track, rows:Array.from(document.querySelectorAll(".vd-dist-row")).map(r => ({
      name:r.querySelector(".vd-dist-open span").textContent.trim(),
      bar:getComputedStyle(r.querySelector(".vd-dist-bar > i")).backgroundColor,
      dot:getComputedStyle(r.querySelector(".vd-dist-name > i")).backgroundColor })) };
  })()`);
  const seenHue = {}, hueBad = [];
  hues.rows.forEach(r => {
    if(r.bar !== r.dot) hueBad.push(r.name + " 条色与图例色不一致");
    if(r.bar === hues.track) hueBad.push(r.name + " 条色与空槽底色相同");
    if(seenHue[r.bar]) hueBad.push(r.name + " 与 " + seenHue[r.bar] + " 撞色");
    seenHue[r.bar] = r.name;
  });
  ok(hueBad.length === 0, "分布图 " + hues.rows.length + " 个模块配色互不相同、图例与条一致、均区别于空槽底色" + (hueBad.length ? "：" + hueBad.join("；") : ""));
  const restChevron = await ev(`parseFloat(getComputedStyle(document.querySelector(".vd-dist-open > svg")).opacity)`);
  ok(restChevron > 0.2 && restChevron < 1, "分布行名的箭头静息可见（opacity=" + restChevron + "），名字读起来是个入口");
  await shot("overview-1440", true);
  noErrors("首屏");

  /* ---------- 2. 标注层 ---------- */
  console.log("\n[2] 标注层");
  await load("shot=1&annot=1");
  s = await state();
  ok(s.annotBox && s.annots === 2, "概览标注可见：说明卡 + " + s.annots + " 个标注点（分布双入口 / 分支双入口）");
  const annotCount = await ev("document.querySelectorAll('.annot-box li').length");
  ok(annotCount === 6, "标注条目 6 条（双入口 / 分支 / 需求列 / 行内 chip / 联动条 / 快照）");
  await shot("overview-annot-1440", true);
  const annotTabs = {};
  for(const t of ["demands", "releases", "log"]){
    await click('[data-tab="' + t + '"]');
    annotTabs[t] = (await state()).annots;
  }
  ok(annotTabs.demands === 1 && annotTabs.releases >= 1,
    "其余标注落在对应页签：需求列 " + annotTabs.demands + " / 快照 " + annotTabs.releases);
  await click('[data-tab="overview"]');
  await click(".vd-dist-row .vd-funnel");
  const scopeAnnots = (await state()).annots;
  ok(scopeAnnots === 2, "工作项页标注：行内 chip + 联动条（" + scopeAnnots + " 个）");
  await shot("scope-annot-1440", true);

  /* ---------- 3. 工时分布双入口 ---------- */
  console.log("\n[3] 工时分布：点名字与点漏斗都联动，行数与聚合一致");
  await load("shot=1");
  const dist = await ev(`(() => {
    const row = document.querySelector(".vd-dist-row");
    return { name:(row.querySelector(".vd-dist-open span") || {}).textContent,
      openLink:row.querySelector(".vd-dist-open").dataset.link,
      funnel:row.querySelector(".vd-funnel").dataset.link,
      items:Number((row.querySelector(".vd-dist-share").textContent.match(/(\\d+) 项/) || [])[1]) };
  })()`);
  ok(dist.openLink === dist.funnel, "两个入口指向同一条件：" + dist.openLink);
  await click(".vd-dist-row .vd-funnel");
  s = await state();
  ok(s.tab === "scope" && s.rows === dist.items && !s.empty,
    "漏斗联动：工作项页 " + s.rows + " 行 = 分布行「" + dist.items + " 项」");
  ok(s.chips.length === 1 && s.chips[0].k === "模块" && s.chips[0].v === dist.name && s.chips[0].x,
    "联动条出现可单独摘掉的模块条件：" + s.chips[0].v);
  ok(/cat=/.test(s.hash) && /sort=actual/.test(s.hash) && /tab=scope/.test(s.hash),
    "分享链接带筛选：" + s.hash);
  ok(s.sel.cat === dist.openLink.split(":")[1] && s.sel.sort === "actual", "下拉与联动条同步（模块 / 实际工时）");
  await shot("drill-cat-1440", true);
  await click(".vd-linked .vd-link-x");
  s = await state();
  ok(s.chips.length === 0 && s.rows === 17 && !/cat=/.test(s.hash), "摘掉单条联动回到全量 17 行，hash 不残留 cat");
  /* 维度切换 */
  await click('[data-tab="overview"]');
  await click('[data-roll="owner"]');
  const ownerRows = await ev("document.querySelectorAll('.vd-dist-row').length");
  await click('[data-roll="stage"]');
  const stageRows = await ev(`(() => Array.from(document.querySelectorAll('.vd-dist-row')).map(r => ({
    name:r.querySelector('.vd-dist-open span').textContent,
    link:r.querySelector('.vd-funnel').dataset.link,
    items:Number((r.querySelector('.vd-dist-share').textContent.match(/(\\d+) 项/) || [])[1]) })))()`);
  ok(ownerRows >= 3 && stageRows.length === 2, "维度可切换：负责人 " + ownerRows + " 组 / 阶段 2 组");
  const testRow = stageRows.filter(r => r.link === "stage:test")[0];
  await click('.vd-dist-row .vd-funnel[data-link="stage:test"]');
  s = await state();
  ok(s.rows === testRow.items && s.chips.length === 1 && s.chips[0].k === "阶段" && s.chips[0].v === "测试计时",
    "测试阶段联动：" + s.rows + " 行 = 「" + testRow.items + " 项」，联动条写「阶段 / 测试计时」");
  ok(/sg=test/.test(s.hash), "阶段进 hash：sg=test");
  await shot("drill-stage-1440", true);
  noErrors("工时分布联动");

  /* ---------- 4. 分支双入口 ---------- */
  console.log("\n[4] 分支：点名字开分支详情，点漏斗联动本版本工作项");
  await load("shot=1");
  const br = await ev(`(() => {
    const w = document.querySelector(".vd-branch-wrap");
    return { name:w.querySelector(".vd-branch span").textContent,
      id:w.querySelector(".vd-branch").dataset.open.split(":")[1],
      link:w.querySelector(".vd-funnel").dataset.link,
      count:Number((w.querySelector(".vd-branch b").textContent.match(/(\\d+)/) || [])[1]) };
  })()`);
  await click(".vd-branch-wrap .vd-funnel");
  s = await state();
  const brRows = await ev(`(() => Array.from(document.querySelectorAll("#view-version tbody tr[data-open]")).map(tr => tr.dataset.open))()`);
  ok(s.tab === "scope" && s.rows === br.count && s.chips.length === 1 && s.chips[0].k === "分支" && s.chips[0].v === br.name,
    "分支漏斗：" + s.rows + " 行 = chip「" + br.count + " 项」，联动条命名 " + br.name);
  ok(s.chips[0].open === true, "分支联动条的名字本身可点（开分支详情）");
  ok(/br=/.test(s.hash), "分支进 hash：br=" + br.id);
  await shot("drill-branch-1440", true);
  await click(".vd-linked button.vd-link-v");
  s = await state();
  ok(s.layer && s.layerTitle === br.name && s.layerFacts === 4, "联动条名字打开分支详情：" + s.layerTitle + "（" + s.layerTag + "）");
  await shot("detail-branch-1440", false);
  await click("#dtClose");
  ok(!(await state()).layer, "分支详情可关闭");
  /* 每条分支 chip 的「N 项」都要和联动后的行数对得上 */
  const brAll = await ev(`(() => { document.querySelector('[data-tab="overview"]').click();
    return Array.from(document.querySelectorAll(".vd-branch-wrap")).map(w => ({
      name:w.querySelector(".vd-branch span").textContent,
      link:w.querySelector(".vd-funnel").dataset.link,
      n:Number((w.querySelector(".vd-branch b").textContent.match(/(\\d+)/) || [])[1]) })); })()`);
  let brBad = [];
  for(const b of brAll){
    await ev(`(() => { document.querySelector('[data-tab="overview"]').click(); return true; })()`);
    await sleep(80);
    await click('.vd-branch-wrap .vd-funnel[data-link="' + b.link + '"]');
    const t = await state();
    const allMatch = await ev(`(() => Array.from(document.querySelectorAll("#view-version tbody tr[data-open] .vd-rel[data-open^='branch:']"))
      .every(c => c.dataset.open === ${JSON.stringify("branch:" + b.link.split(":")[1])}))()`);
    if(t.rows !== b.n || !allMatch) brBad.push(b.name + " chip=" + b.n + " 行=" + t.rows + " 全匹配=" + allMatch);
  }
  ok(brBad.length === 0, "全部 " + brAll.length + " 条分支：chip 项数 = 联动行数，且行行都挂它" + (brBad.length ? "：" + brBad.join("；") : ""));
  /* 行内 chip 也能开同一个分支 */
  const rowBr = await ev(`(() => { const c = document.querySelector("#view-version tbody tr .vd-rel[data-open^='branch:']");
    return { id:c.dataset.open, label:c.querySelector("span").textContent }; })()`);
  await click('#view-version tbody tr .vd-rel[data-open^="branch:"]');
  s = await state();
  ok(s.layer && s.layerTitle === rowBr.label, "工作项行内分支 chip 打开同一个分支详情：" + s.layerTitle);
  await click("#dtClose");
  noErrors("分支联动");

  /* ---------- 5. 需求页：本版本工作项列 ---------- */
  console.log("\n[5] 需求页：本版本工作项数 + 漏斗联动");
  await load("shot=1&s=demand");
  const dm = await ev(`(() => {
    const tr = Array.from(document.querySelectorAll("#view-version tbody tr[data-open]"))
      .filter(r => r.querySelector(".vd-rel-cell .vd-funnel"))[0];
    const cellEl = tr.querySelector(".vd-rel-cell");
    return { id:tr.dataset.open.split(":")[1], title:tr.querySelector(".vd-tname").textContent,
      link:cellEl.querySelector(".vd-funnel").dataset.link,
      n:Number((cellEl.textContent.match(/(\\d+) 项/) || [])[1]) };
  })()`);
  ok(/本版本工作项/.test(await ev(`document.querySelector("#view-version thead tr").textContent`)), "需求表有「本版本工作项」列");
  await shot("demands-1440", true);
  await click("#view-version tbody .vd-rel-cell .vd-funnel");
  s = await state();
  ok(s.tab === "scope" && s.rows === dm.n && s.chips.length === 1 && s.chips[0].k === "需求",
    "需求漏斗：" + s.rows + " 行 = 需求页「" + dm.n + " 项」");
  ok(s.chips[0].v.indexOf(dm.title) >= 0, "联动条写出需求编号与标题：" + s.chips[0].v);
  ok(/dm=/.test(s.hash), "需求进 hash：dm=" + dm.id);
  await click(".vd-linked button.vd-link-v");
  s = await state();
  ok(s.layer && s.layerTitle === dm.title && s.layerFacts === 4, "联动条名字打开需求详情：" + s.layerTitle);
  await shot("detail-demand-1440", false);
  await click("#dtClose");
  /* 行本身开需求详情，行内需求 chip 也是 */
  await click('[data-tab="demands"]');
  await click("#view-version tbody tr[data-open]");
  s = await state();
  ok(s.layer && s.layerTitle.length > 0, "点需求行打开需求详情：" + s.layerTitle);
  await click("#dtClose");
  /* 每条需求的「N 项」都要和联动后的行数对得上 */
  const dmAll = await ev(`(() => Array.from(document.querySelectorAll("#view-version tbody tr[data-open]")).map(tr => {
    const c = tr.querySelector(".vd-rel-cell"), f = c.querySelector(".vd-funnel");
    return { title:tr.querySelector(".vd-tname").textContent,
      link:f ? f.dataset.link : "", muted:!!c.querySelector(".vd-muted"),
      n:f ? Number((c.textContent.match(/(\\d+) 项/) || [])[1]) : 0 }; }))()`);
  let dmBad = [];
  for(const d of dmAll){
    if(!d.link){ if(!d.muted) dmBad.push(d.title + " 既无漏斗也无「未挂工作项」说明"); continue; }
    await ev(`(() => { document.querySelector('[data-tab="demands"]').click(); return true; })()`);
    await sleep(80);
    await click('#view-version tbody .vd-rel-cell .vd-funnel[data-link="' + d.link + '"]');
    const t = await state();
    const allMatch = await ev(`(() => Array.from(document.querySelectorAll("#view-version tbody tr[data-open] .vd-rel[data-open^='demand:']"))
      .every(c => c.dataset.open === ${JSON.stringify("demand:" + d.link.split(":")[1])}))()`);
    if(t.rows !== d.n || !allMatch) dmBad.push(d.title + " 列=" + d.n + " 行=" + t.rows + " 全匹配=" + allMatch);
  }
  ok(dmBad.length === 0, "全部 " + dmAll.length + " 条需求：列内项数 = 联动行数，且行行都挂它" + (dmBad.length ? "：" + dmBad.join("；") : ""));
  noErrors("需求联动");

  /* ---------- 6. 工作项行：行开工作项，chip 开关联实体 ---------- */
  console.log("\n[6] 工作项行：行与行内 chip 各开各的详情");
  await load("shot=1");
  await click('[data-tab="scope"]');
  const rowInfo = await ev(`(() => {
    const tr = document.querySelector("#view-version tbody tr[data-open]");
    return { task:tr.dataset.open, title:tr.querySelector(".vd-tname").textContent,
      dm:(tr.querySelector('.vd-rel[data-open^="demand:"]') || {}).dataset,
      br:(tr.querySelector('.vd-rel[data-open^="branch:"]') || {}).dataset };
  })()`);
  await click('#view-version tbody tr[data-open] .vd-rel[data-open^="demand:"]');
  s = await state();
  ok(s.layer && s.layerTitle !== rowInfo.title, "点行内需求 chip 开的是需求详情，不是工作项：" + s.layerTitle);
  await shot("detail-demand-from-row-1440", false);
  await click("#dtClose");
  await click("#view-version tbody tr[data-open] .vd-tname");
  s = await state();
  ok(s.layer && s.layerTitle === rowInfo.title && s.layerFacts === 4, "点标题仍开工作项详情：" + s.layerTitle);
  const taskRels = await ev("document.querySelectorAll('#detailLayer.open .dt-rel .vd-rel').length");
  ok(taskRels >= 2, "工作项详情里继续挂需求 / 分支 chip，可再跳一层（" + taskRels + " 个）");
  await shot("detail-task-1440", false);
  await click("#dtClose");
  /* 键盘可达 */
  const kb = await ev(`(() => { const tr = document.querySelector("#view-version tbody tr[data-open]");
    tr.focus(); tr.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true }));
    return !!document.querySelector("#detailLayer.open"); })()`);
  ok(kb, "键盘 Enter 能打开工作项详情（行 tabindex=0）");
  await ev("document.getElementById('dtClose').click()");
  noErrors("行内下钻");

  /* ---------- 7. 组合联动 + 清空 + 看板诚实提示 ---------- */
  console.log("\n[7] 组合联动、清空、看板跳转口径");
  await load("shot=1&s=combo");
  s = await state();
  ok(s.tab === "scope" && s.chips.length === 2, "组合场景：需求 + 阶段两条联动同时生效");
  ok(/dm=/.test(s.hash) && /sg=dev/.test(s.hash) && /sort=actual/.test(s.hash), "组合 hash：" + s.hash);
  const comboRows = s.rows;
  ok(comboRows > 0 && comboRows < 17, "组合后确实收窄：" + comboRows + " / 17 行");
  await shot("drill-combo-1440", true);
  await click('[data-act="board"]');
  s = await state();
  ok(/阶段/.test(s.toast) && /未带过去/.test(s.toast), "看板提示如实说明未带过去的筛选：" + s.toast);
  await click('.vd-linked [data-act="reset"]');
  s = await state();
  ok(s.chips.length === 0 && s.rows === 17 && !/[?&](cat|br|dm|sg|sort)=/.test(s.hash), "清除全部筛选：回到 17 行且 hash 无残留");
  /* 空态 */
  await ev(`(() => { const el = document.querySelector('[data-filter="q"]');
    el.value = "不存在的关键词zzz"; el.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
  await sleep(160);
  s = await state();
  ok(s.rows === 0 && s.empty, "零结果给可操作空态，不是白表");
  await click('#view-version [data-act="reset"]');
  /* 搜索光标 */
  const caret = await ev(`(() => { const el = document.querySelector('[data-filter="q"]');
    el.focus(); el.value = "首页"; el.setSelectionRange(1, 1);
    el.dispatchEvent(new Event("input", { bubbles:true }));
    const now = document.querySelector('[data-filter="q"]');
    return { focused:document.activeElement === now, caret:now.selectionStart, rows:document.querySelectorAll('#view-version tbody tr[data-open]').length }; })()`);
  ok(caret.focused && caret.rows > 0, "搜索重渲染后仍聚焦、有结果（" + caret.rows + " 行）");
  await shot("scope-search-1440", true);
  noErrors("组合与筛选");

  /* ---------- 8. 指标格下钻 + 其余页签 ---------- */
  console.log("\n[8] 指标格下钻与其余页签");
  await load("shot=1");
  const drills = await ev(`(() => Array.from(document.querySelectorAll(".vd-kpis [data-drill]")).map(b => ({
    k:b.dataset.drill, label:b.querySelector("span").textContent })))()`);
  ok(drills.length >= 5, "可下钻指标 " + drills.length + " 个：" + drills.map(d => d.label).join(" / "));
  for(const d of drills){
    await ev(`(() => { document.querySelector('[data-tab="overview"]').click(); return true; })()`);
    await sleep(90);
    await click('.vd-kpis [data-drill="' + d.k + '"]');
    const t = await state();
    if(t.tab !== "scope" || (t.rows === 0 && !t.empty)){ failed++; console.log("  FAIL 指标下钻 " + d.label); }
  }
  passed++; console.log("  PASS 每个可下钻指标都落到工作项页且有行或有空态");
  await load("shot=1");
  for(const tab of ["scope", "demands", "releases", "log"]){
    await click('[data-tab="' + tab + '"]');
    const t = await state();
    const nonEmpty = await ev(`(() => { const b = document.querySelector("#view-version .vd-body");
      return !!b && b.textContent.trim().length > 80; })()`);
    ok(t.tab === tab && nonEmpty, "页签 " + tab + " 有真实内容");
    if(tab === "releases"){
      const snaps = await ev(`(() => { document.querySelectorAll("#view-version details.release-record").forEach(d => d.open = true);
        return { task:document.querySelectorAll('#view-version .snap-link[data-open^="task:"]').length,
          demand:document.querySelectorAll('#view-version .snap-link[data-open^="demand:"]').length }; })()`);
      ok(snaps.task > 0 && snaps.demand > 0, "发布快照里工作项 " + snaps.task + " 个 / 需求 " + snaps.demand + " 个都是可点链接");
      await shot("releases-1440", true);
      await ev(`(() => { document.querySelectorAll("#view-version details.release-record").forEach(d => d.open = true); return true; })()`);
      await click('#view-version .snap-link[data-open^="task:"]');
      let sn = await state();
      ok(sn.layer && sn.layerFacts === 4, "点快照里的工作项打开工作项详情：" + sn.layerTitle);
      await click("#dtClose");
      await ev(`(() => { document.querySelectorAll("#view-version details.release-record").forEach(d => d.open = true); return true; })()`);
      await click('#view-version .snap-link[data-open^="demand:"]');
      sn = await state();
      ok(sn.layer && sn.layerFacts === 4, "点快照里的需求打开需求详情：" + sn.layerTitle);
      await shot("releases-snap-detail-1440", false);
      await click("#dtClose");
      /* 快照「实际记录版本」也是实体引用：点它跳转到该版本详情（原型只建模一个版本，用提示如实说明），不叠浮层 */
      const verCells = await ev(`(() => { document.querySelectorAll("#view-version details.release-record").forEach(d => d.open = true);
        return Array.from(document.querySelectorAll("#view-version .vd-records tbody tr")).map(tr => {
          const td = tr.children[3], a = td && td.querySelector(".assoc-link[data-open^='version:']");
          return { text:td ? td.textContent.trim() : "", id:a ? a.dataset.open.split(":")[1] : "" };
        }); })()`);
      ok(verCells.length > 0 && verCells.every(c => c.id === "Voc6wln" && c.text === "App 首页 v3.2"),
        "快照版本列 " + verCells.length + " 行都是指向本版本 v3.2 的跳转链接（不再是纯文本）");
      await click('#view-version .vd-records .assoc-link[data-open^="version:"]');
      const vn = await state();
      ok(!vn.layer && /跳转/.test(vn.toast) && /App 首页 v3\.2/.test(vn.toast),
        "点快照版本名给跳转提示而不是叠浮层：" + vn.toast);
    }
    if(tab === "scope") await shot("scope-1440", true);
    if(tab === "log") await shot("log-1440", true);
  }
  noErrors("页签与指标下钻");

  /* ---------- 9. 控制条 ---------- */
  console.log("\n[9] 原型控制条：场景 / 布局 / 标注 / 重置");
  await load("");
  for(const sc of ["init", "cat", "branch", "demand", "stage", "combo"]){
    await click('#segScene button[data-s="' + sc + '"]');
    const t = await state();
    const on = await ev(`document.querySelector('#segScene button[data-s="${sc}"]').classList.contains("on")`);
    ok(on && !!t.hash, "场景 " + sc + " 可用，hash=" + t.hash);
  }
  await click('#segLayout button[data-l="mobile"]');
  ok(await ev(`document.documentElement.dataset.layout === "mobile" && getComputedStyle(document.querySelector(".pb-side")).display === "none"`),
    "布局切到手机：侧栏收起");
  await click('#segLayout button[data-l="desktop"]');
  await click("#btnAnnot");
  ok((await state()).annotBox, "标注开关生效");
  await click("#btnReset");
  s = await state();
  ok(s.tab === "overview" && s.chips.length === 0, "重置回到概览全量");
  const barHidden = await ev(`(() => { document.body.classList.add("shot");
    const h = getComputedStyle(document.querySelector(".proto-bar")).display === "none";
    document.body.classList.remove("shot"); return h; })()`);
  ok(barHidden, "?shot=1 隐藏控制条，截图只剩产品界面");
  noErrors("控制条");

  /* ---------- 10. 手机 390 ---------- */
  console.log("\n[10] 手机 390×844：联动控件可点、无溢出");
  await setVP(390, 844, true);
  await load("shot=1&layout=mobile");
  await overflow("手机 390 概览");
  const distReach = await ev(`(() => Array.from(document.querySelectorAll(".vd-dist-open, .vd-funnel, .vd-branch"))
    .map(el => { const r = el.getBoundingClientRect(); return { c:el.className, w:Math.round(r.width), h:Math.round(r.height) }; })
    .filter(x => x.h < 28 || x.w < 28))()`);
  ok(distReach.length === 0, "概览联动控件都 ≥28px：" + JSON.stringify(distReach));
  await shot("overview-390", true);
  await load("shot=1&layout=mobile&s=combo");
  await overflow("手机 390 联动");
  const relReach = await ev(`(() => Array.from(document.querySelectorAll(".vd-link-x, .vd-link-v, .vd-linked .btn, #view-version tbody .vd-rel, #view-version tbody .vd-funnel"))
    .map(el => { const r = el.getBoundingClientRect(); return { c:el.className, w:Math.round(r.width), h:Math.round(r.height) }; })
    .filter(x => x.h < 28 || x.w < 28))()`);
  ok(relReach.length === 0, "联动条 / 行内 chip / 漏斗都 ≥28px：" + JSON.stringify(relReach));
  await shot("link-390", true);
  await click(".vd-linked button.vd-link-v");
  s = await state();
  const sheet = await ev(`(() => { const el = document.querySelector("#detailLayer .sheet");
    const r = el.getBoundingClientRect(); return { w:Math.round(r.width), right:Math.round(r.right), vw:window.innerWidth }; })()`);
  ok(s.layer && sheet.right <= sheet.vw + 1, "手机上实体详情不超屏（" + sheet.w + "px / " + sheet.vw + "px）");
  await shot("detail-390", false);
  await click("#dtClose");
  await load("shot=1&layout=mobile&s=demand");
  await overflow("手机 390 需求页");
  await shot("demands-390", true);
  noErrors("手机会话");

  /* ---------- 11. 平板 ---------- */
  console.log("\n[11] 平板 834×1112");
  await setVP(834, 1112, false);
  await load("shot=1");
  await overflow("平板 834 概览");
  const kpiCols = await ev(`getComputedStyle(document.querySelector(".vd-kpis")).gridTemplateColumns.split(" ").length`);
  ok(kpiCols === 3, "平板指标格退到 3 列（九宫格排满，不留孤格）");
  await shot("overview-834", true);
  noErrors("平板会话");

  console.log("\n通过 " + passed + " 项，失败 " + failed + " 项");
  console.log("截图目录：" + SHOT_DIR + "（前缀 " + PREFIX + "）");
  if(cdp.errors.length) console.log("残留控制台报错：" + cdp.errors.join(" | "));
  process.exitCode = failed || cdp.errors.length ? 1 : 0;
}catch(err){
  console.error("\n运行失败：" + (err && err.stack || err));
  process.exitCode = 1;
}finally{
  try{ proc.kill(); }catch(e){ /* 已退出 */ }
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){ /* 临时目录留给系统清理 */ }
}