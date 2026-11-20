/* 报表 / 成员负载 × 2026-11-19 原型：逐页面截图与计算样式取证
   用法：node tools/e2e/reports-workload-proto-audit.mjs
   产物：docs/audit/reports-workload-prototype-alignment-2026-11-20/
     - shots/{report,stats,completions,flow,investment,workload}-1440.png
     - shots/{report,stats,flow,investment,workload}-390.png
     - metrics.json（页头、工具条、KPI、卡片、图表、表格）
   只读：不导出、不推进、不改任何数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/reports-workload-prototype-alignment-2026-11-20");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      this.errors.push("console.error: " + msg.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      this.errors.push("log: " + msg.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const port = 9234;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rpt-audit-"));
const proc = spawn(findChrome(), [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

const results = {};
let ws = null;
try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
  };
  const click = async sel => {
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
    if(!ok) throw new Error("找不到可点击元素：" + sel);
  };

  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 登录 */
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("uName", ${JSON.stringify(USER)});
    set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click();
    return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);

  const HELPERS = `
    const px = v => Math.round(parseFloat(v || "0") * 10) / 10;
    const vis = el => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const first = sel => [...document.querySelectorAll(sel)].find(vis) || null;
    const style = el => {
      if(!el) return null;
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width),
        fs: px(s.fontSize), fw: s.fontWeight, lh: s.lineHeight, r: s.borderRadius, pad: s.padding,
        bg: s.backgroundColor, bd: s.borderColor, c: s.color, gap: s.gap,
        shadow: s.boxShadow === "none" ? "" : s.boxShadow };
    };
    const txt = el => el ? el.textContent.trim().replace(/\\s+/g, " ") : "";
    const pagehead = () => {
      const h1 = document.getElementById("pageTitle");
      const sub = document.getElementById("pageSub");
      const pill = document.getElementById("pagePill");
      const pa = document.getElementById("pageActions");
      const nw = document.getElementById("newWrap");
      const sn = document.getElementById("subNav");
      return {
        h1: style(h1), h1text: txt(h1),
        sub: style(sub), subtext: txt(sub),
        pill: style(pill), pillText: pill && !pill.hidden ? txt(pill) : "(hidden)",
        actions: pa && !pa.hidden ? [...pa.querySelectorAll(".btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
        newWrapHidden: nw ? nw.hidden : null,
        subnav: sn && !sn.hidden ? [...sn.querySelectorAll(".subnav-item")].filter(vis).map(b => ({ t: txt(b), on: b.classList.contains("on"), ...style(b) })) : []
      };
    };
    const overflow = () => {
      const doc = document.documentElement;
      const v = document.getElementById("view-" + document.body.dataset.view);
      return { doc: doc.scrollWidth - window.innerWidth, view: v ? v.scrollWidth - v.clientWidth : 0 };
    };
  `;

  const goto = async (hash, view, readyExpr, label) => {
    await call("Page.navigate", { url: BASE + "/" + hash });
    await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, label, 15000);
    if(readyExpr) await waitFor(readyExpr, label + "内容", 20000);
    await evaluate("(() => { const v = document.getElementById('view-' + document.body.dataset.view); if(v) v.scrollTop = 0; window.scrollTo(0,0); return true; })()");
    await sleep(900);
  };

  /* ---------- 报表 · 交付图表 ---------- */
  await goto("#/report", "report", "!!document.querySelector('#reportBody .manager-chart-panel')", "交付图表");
  await shot("report-1440.png");
  results.report = await evaluate(`(() => {
    ${HELPERS}
    const tb = first("#reportBody .manager-toolbar");
    const filters = first("#reportBody .manager-label-filters");
    const grid = first("#reportBody .manager-chart-grid");
    const panel = first("#reportBody .manager-chart-panel");
    const head = first("#reportBody .manager-panel-head");
    const headB = first("#reportBody .manager-panel-head b");
    const headSpan = first("#reportBody .manager-panel-head span");
    const svg = first("#reportBody .manager-chart");
    const legend = first("#reportBody .manager-chart-legend");
    const chips = first("#reportBody .report-scope-chips");
    const cal = first("#reportBody .caliber-note, #reportBody .caliber");
    const chartNames = [...document.querySelectorAll("#reportBody .manager-panel-head b")].map(txt);
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      toolbar: style(tb),
      toolbarTitle: txt(tb && tb.querySelector("b")),
      actions: tb ? [...tb.querySelectorAll(".manager-actions .btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
      filters: style(filters),
      filterSelects: document.querySelectorAll("#reportBody .manager-label-filters select").length,
      chips: chips ? { ...style(chips), t: txt(chips) } : null,
      caliber: cal ? { ...style(cal), t: txt(cal).slice(0, 60) } : null,
      grid: grid ? { ...style(grid), cols: getComputedStyle(grid).gridTemplateColumns } : null,
      panels: document.querySelectorAll("#reportBody .manager-chart-panel").length,
      chartNames,
      panel: style(panel), head: style(head), headB: style(headB), headSpan: style(headSpan),
      svg: style(svg), legend: style(legend)
    };
  })()`);

  /* ---------- 报表 · 趋势与分布 ---------- */
  await goto("#/stats", "analysis", "!!document.querySelector('#chartWeeks .chart')", "趋势与分布");
  await shot("stats-1440.png");
  results.stats = await evaluate(`(() => {
    ${HELPERS}
    const bar = first("#view-analysis .analysis-bar");
    const tabs = first("#analysisTabs");
    const tab = first("#analysisTabs .set-tab");
    const tabOn = first("#analysisTabs .set-tab.on");
    const panels = [...document.querySelectorAll('#view-analysis [data-analysis-pane="stats"] .panel')].filter(vis);
    const panel = panels[0];
    const ph = first('#view-analysis [data-analysis-pane="stats"] .panel-head');
    const h3 = first('#view-analysis [data-analysis-pane="stats"] .panel-head h3');
    const chart = first("#chartWeeks .chart");
    const col = first("#chartWeeks .chart .c");
    const bars = first("#chartWeeks .chart .c .bars");
    const stat = first("#statsHours .stat");
    const statK = stat && stat.querySelector(".k");
    const statV = stat && stat.querySelector(".v");
    const dist = first("#statsCat .dist-row, #statsCat .dist-item, #statsCat > *");
    const period = document.getElementById("analysisPeriod");
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      bar: style(bar), tabs: style(tabs), tab: style(tab), tabOn: style(tabOn),
      period: period ? { ...style(period), v: period.value } : null,
      panels: panels.length, panel: style(panel), ph: style(ph), h3: style(h3), h3text: txt(h3),
      chart: style(chart), col: style(col), bars: style(bars),
      stat: style(stat), statK: style(statK), statV: style(statV),
      dist: dist ? { ...style(dist), t: txt(dist).slice(0, 40) } : null,
      distRows: document.querySelectorAll("#statsCat > *").length
    };
  })()`);

  /* ---------- 报表 · 完成记录 ---------- */
  await goto("#/completions", "analysis", "!!document.querySelector('#compWrap .comp-table, #compWrap .col-empty, #compWrap .skel')", "完成记录");
  await waitFor("!document.querySelector('#compWrap .skel')", "完成记录加载", 15000);
  await shot("completions-1440.png");
  results.completions = await evaluate(`(() => {
    ${HELPERS}
    const bar = first('#view-analysis [data-analysis-pane="completions"] .page-toolbar');
    const title = first('#view-analysis [data-analysis-pane="completions"] .toolbar-title');
    const stat = first("#compStats .stat");
    const panel = first('#view-analysis [data-analysis-pane="completions"] .panel');
    const ph = first('#view-analysis [data-analysis-pane="completions"] .panel-head');
    const h3 = first('#view-analysis [data-analysis-pane="completions"] .panel-head h3');
    const th = first("#compWrap .comp-table th");
    const tr = first("#compWrap .comp-table tbody tr");
    const td = tr && tr.querySelector("td");
    const table = first("#compWrap .comp-table");
    const scroll = first("#compWrap .comp-scroll");
    const hint = first('#view-analysis [data-analysis-pane="completions"] .set-hint');
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      bar: style(bar), title: style(title), titleText: txt(title),
      stat: style(stat), statCount: document.querySelectorAll("#compStats .stat").length,
      panel: style(panel), ph: style(ph), h3: style(h3),
      th: style(th), thText: txt(th), tr: style(tr), td: style(td),
      table: style(table), scroll: scroll ? { ...style(scroll), sw: scroll.scrollWidth, cw: scroll.clientWidth } : null,
      hint: style(hint)
    };
  })()`);

  /* ---------- 报表 · 流程体检 ---------- */
  await goto("#/flow", "analysis", "!!document.querySelector('#flowKpi .stat')", "流程体检");
  await shot("flow-1440.png");
  results.flow = await evaluate(`(() => {
    ${HELPERS}
    const ins = first("#flowInsights .flow-ins");
    const insT = first("#flowInsights .flow-ins .fi-t");
    const insX = first("#flowInsights .flow-ins .fi-x");
    const kpis = [...document.querySelectorAll("#flowKpi .stat")].filter(vis);
    const kpi = kpis[0];
    const kpiK = kpi && kpi.querySelector(".k");
    const kpiV = kpi && kpi.querySelector(".v");
    const bar = first("#flowBars .flow-bar");
    const fbRow = first("#flowBars .flow-bar .fb-row");
    const fbName = first("#flowBars .flow-bar .fb-name");
    const fbMeta = first("#flowBars .flow-bar .fb-meta");
    const duo = first('#view-analysis [data-analysis-pane="flow"] .duo');
    const panel = first('#view-analysis [data-analysis-pane="flow"] .panel');
    const ph = first('#view-analysis [data-analysis-pane="flow"] .panel-head');
    const h3 = first('#view-analysis [data-analysis-pane="flow"] .panel-head h3');
    const range = document.getElementById("flowRange");
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      ins: style(ins), insT: style(insT), insText: txt(insT), insX: style(insX),
      kpis: kpis.length, kpi: style(kpi), kpiK: style(kpiK), kpiV: style(kpiV), kpiText: txt(kpi),
      bar: style(bar), fbRow: style(fbRow), fbName: style(fbName), fbMeta: style(fbMeta),
      duo: duo ? { ...style(duo), cols: getComputedStyle(duo).gridTemplateColumns } : null,
      panel: style(panel), ph: style(ph), h3: style(h3), range: txt(range)
    };
  })()`);

  /* ---------- 报表 · 投入结构 ---------- */
  await goto("#/investment", "investment", "!!document.querySelector('#investmentBody .inv-card')", "投入结构");
  await shot("investment-1440.png");
  results.investment = await evaluate(`(() => {
    ${HELPERS}
    const tb = first("#investmentBody .manager-toolbar");
    const controls = first("#investmentBody .inv-controls");
    const card = first("#investmentBody .inv-card");
    const cardHead = first("#investmentBody .inv-card-head");
    const cardTitle = first("#investmentBody .inv-card-head h2");
    const kpis = [...document.querySelectorAll("#investmentBody .inv-kpi")].filter(vis);
    const kpi = kpis[0];
    const kl = kpi && kpi.querySelector(".inv-kl");
    const kv = kpi && kpi.querySelector(".inv-kv");
    const kd = kpi && kpi.querySelector(".inv-kd");
    const trendCol = first("#investmentBody .inv-col");
    const th = first("#investmentBody .inv-tbl th");
    const tr = first("#investmentBody .inv-tbl tbody tr");
    const dimBtns = [...document.querySelectorAll("#investmentBody [data-inv-dim]")].filter(vis).map(b => ({ t: txt(b), on: b.classList.contains("on"), ...style(b) }));
    const segs = [...document.querySelectorAll("#investmentBody .inv-seg")].filter(vis).map(style);
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      toolbar: style(tb),
      toolbarTitle: txt(tb && tb.querySelector("b")),
      actions: tb ? [...tb.querySelectorAll(".btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
      controls: style(controls),
      card: style(card), cardHead: style(cardHead), cardTitle: style(cardTitle), cardTitleText: txt(cardTitle),
      kpis: kpis.length, kpi: style(kpi), kl: style(kl), kv: style(kv), kd: style(kd),
      segs, dimBtns,
      trendCol: trendCol ? { ...style(trendCol), t: txt(trendCol).slice(0, 30) } : null,
      th: style(th), thText: txt(th), tr: style(tr)
    };
  })()`);

  /* ---------- 成员负载 ---------- */
  await goto("#/workload", "workload", "!!document.querySelector('#workloadBody .wl-summary, #workloadBody .wl-empty')", "成员负载");
  await shot("workload-1440.png");
  results.workload = await evaluate(`(() => {
    ${HELPERS}
    const tb = first("#workloadBody .manager-toolbar");
    const filters = first("#workloadBody .manager-label-filters");
    const summary = first("#workloadBody .wl-summary");
    const item = first("#workloadBody .wl-summary-item");
    const itemL = item && item.querySelector("span");
    const itemB = item && item.querySelector("b");
    const itemS = item && item.querySelector("small");
    const chips = first("#workloadBody .wl-chips");
    const chip = first("#workloadBody .wl-chip");
    const table = first("#workloadBody .wl-tbl");
    const th = first("#workloadBody .wl-tbl th");
    const tr = first("#workloadBody .wl-tbl tbody tr");
    const td = tr && tr.querySelector("td");
    const prog = first("#workloadBody .wl-tbl .prog");
    const who = first("#workloadBody .wl-tbl .wl-week-who b");
    const company = first("#workloadBody .wl-tbl .wl-week-company");
    const mode = first("#workloadBody .wl-mode");
    const period = first("#workloadBody .wl-period");
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      toolbar: style(tb),
      actions: tb ? [...tb.querySelectorAll(".manager-actions .btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
      filters: style(filters),
      summary: summary ? { ...style(summary), cols: getComputedStyle(summary).gridTemplateColumns } : null,
      item: style(item), itemL: style(itemL), itemB: style(itemB), itemS: style(itemS),
      chips: style(chips), chip: style(chip),
      table: style(table), th: style(th), thText: txt(th), tr: style(tr), td: style(td),
      prog: style(prog), who: style(who), whoText: txt(who), company: style(company),
      mode: mode ? { ...style(mode), t: txt(mode) } : null,
      period: period ? { ...style(period), t: txt(period) } : null,
      rows: document.querySelectorAll("#workloadBody .wl-tbl tbody tr").length
    };
  })()`);

  /* ---------- 390 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await goto("#/report", "report", "!!document.querySelector('#reportBody .manager-chart-panel')", "移动交付图表");
  await shot("report-390.png");
  results.reportMobile = await evaluate(`(() => { ${HELPERS} return { overflow: overflow(), pagehead: pagehead(), gridCols: (first("#reportBody .manager-chart-grid") ? getComputedStyle(first("#reportBody .manager-chart-grid")).gridTemplateColumns : "") }; })()`);

  await goto("#/stats", "analysis", "!!document.querySelector('#chartWeeks .chart')", "移动趋势");
  await shot("stats-390.png");
  results.statsMobile = await evaluate(`(() => { ${HELPERS} return { overflow: overflow(), pagehead: pagehead(), tabs: (first("#analysisTabs") ? { ...style(first("#analysisTabs")), sw: first("#analysisTabs").scrollWidth, cw: first("#analysisTabs").clientWidth } : null) }; })()`);

  await goto("#/flow", "analysis", "!!document.querySelector('#flowKpi .stat')", "移动流程体检");
  await shot("flow-390.png");
  results.flowMobile = await evaluate(`(() => { ${HELPERS} return { overflow: overflow(), pagehead: pagehead(), duoCols: (first('#view-analysis [data-analysis-pane="flow"] .duo') ? getComputedStyle(first('#view-analysis [data-analysis-pane="flow"] .duo')).gridTemplateColumns : "") }; })()`);

  await goto("#/investment", "investment", "!!document.querySelector('#investmentBody .inv-card')", "移动投入结构");
  await shot("investment-390.png");
  results.investmentMobile = await evaluate(`(() => { ${HELPERS} return { overflow: overflow(), pagehead: pagehead(), kpiCols: (first("#investmentBody .inv-kpis") ? getComputedStyle(first("#investmentBody .inv-kpis")).gridTemplateColumns : "") }; })()`);

  await goto("#/workload", "workload", "!!document.querySelector('#workloadBody .wl-summary, #workloadBody .wl-empty')", "移动成员负载");
  await shot("workload-390.png");
  results.workloadMobile = await evaluate(`(() => {
    ${HELPERS}
    const tbl = first("#workloadBody .wl-tbl");
    return { overflow: overflow(), pagehead: pagehead(),
      summaryCols: (first("#workloadBody .wl-summary") ? getComputedStyle(first("#workloadBody .wl-summary")).gridTemplateColumns : ""),
      table: tbl ? { ...style(tbl), sw: tbl.scrollWidth, cw: tbl.clientWidth } : null };
  })()`);

  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  results.errors = cdp.errors.slice(0, 10);
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}catch(e){
  console.error("失败：" + e.message);
  process.exitCode = 1;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  proc.kill();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
