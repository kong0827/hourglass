/* 需求池 × 2026-11-19 原型：逐视图截图与计算样式取证
   用法：node tools/e2e/demands-proto-audit.mjs
   产物：docs/audit/demands-prototype-alignment-2026-11-20/
     - shots/demands-{board,table,gantt,detail,new,work}-1440.png
     - metrics.json（页头、工具条、列头、卡片、标题、标签、按钮）
   只读：不改数据，不进编辑保存。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/demands-prototype-alignment-2026-11-20");
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

const port = 9229;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dem-audit-"));
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

  const measure = () => evaluate(`(() => {
    const px = v => Math.round(parseFloat(v || "0") * 10) / 10;
    const vis = el => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const first = sel => [...document.querySelectorAll(sel)].find(vis) || null;
    const style = el => {
      if(!el) return null;
      const s = getComputedStyle(el);
      return { h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width),
        fs: px(s.fontSize), fw: s.fontWeight, lh: s.lineHeight, r: s.borderRadius, pad: s.padding,
        bg: s.backgroundColor, bd: s.borderColor, c: s.color, shadow: s.boxShadow === "none" ? "" : s.boxShadow };
    };
    const board = document.querySelector(".bkl");
    const card = first(".bkl-card");
    const colTitle = first(".bkl-title");
    const kcardTitle = first(".bkl-card .link-title");
    const tag = first(".bkl-card .tag");
    const pageToolbar = first("#view-demands .page-toolbar");
    const boardBar = first("#view-demands .dem-board-bar");
    const seg = first("#demandModeSeg");
    const segBtn = first("#demandModeSeg button");
    const buttons = [...document.querySelectorAll("#view-demands .btn")].filter(vis).map(b => ({ t: b.textContent.trim(), ...style(b) }));
    const tbl = first("#view-demands table");
    const th = tbl && [...tbl.querySelectorAll("thead th")].find(vis);
    const td = tbl && [...tbl.querySelectorAll("tbody td")].find(vis);
    const tabs = [...document.querySelectorAll("#view-demands .smart-view-tab")].filter(vis).map(b => ({ t: b.textContent.trim(), on: b.classList.contains("on"), ...style(b) }));
    const pageHead = document.getElementById("pageHead");
    const h1 = document.getElementById("pageTitle");
    const sub = document.getElementById("pageSub");
    const pill = document.getElementById("pagePill");
    const pa = document.getElementById("pageActions");
    return {
      view: document.body.dataset.view,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: style(h1), h1text: h1 ? h1.textContent.trim() : "",
      pill: style(pill), pillText: pill && !pill.hidden ? pill.textContent.trim() : "(hidden)",
      sub: style(sub), subtext: sub ? sub.textContent.trim() : "",
      pageActions: pa && !pa.hidden ? [...pa.querySelectorAll(".btn")].filter(vis).map(b => ({ t: b.textContent.trim(), ...style(b) })) : [],
      newWrapHidden: document.getElementById("newWrap") ? document.getElementById("newWrap").hidden : null,
      dembSearch: style(first("#view-demands .demb-search")),
      dembChip: style(first("#view-demands [data-demb-filter]")),
      dembStage: style(first("#view-demands [data-demb-stage]")),
      dembDisplay: style(first("#view-demands .demb-display>summary")),
      deSearch: style(first("#view-demands .dem-search")),
      pageHeadPrimary: style(document.querySelector("#pageHead .btn.primary")),
      board: board ? { ...style(board), cols: document.querySelectorAll(".bkl-col").length, cards: document.querySelectorAll(".bkl-card").length } : null,
      colTitle: style(colTitle), colTitleText: colTitle ? colTitle.textContent.trim() : "",
      colCount: style(first(".bkl-count")),
      card: style(card), cardTitle: style(kcardTitle), tag: style(tag),
      pageToolbar: style(pageToolbar), boardBar: style(boardBar),
      seg: style(seg), segBtn: style(segBtn),
      buttons,
      th: style(th), td: style(td),
      tabs,
      workbar: style(first("#view-demands .dem-work-bar")),
      ganttBar: style(first("#view-demands .demg-tools")),
      flowHelp: style(document.getElementById("demandFlowHelp") ? document.getElementById("demandFlowHelp").querySelector("button") : null),
      ganttSegs: document.querySelectorAll(".demg-seg").length,
      ganttScroll: (() => { const s = document.querySelector(".demg-scroll"); return s ? { sl: s.scrollLeft, sw: s.scrollWidth, cw: s.clientWidth } : null; })(),
      detail: style(first(".demand-detail .sheet")),
      dialog: style(first("#dlgDemand .sheet")),
      deep: style(first(".bkl-card .bkl-desc"))
    };
  })()`);

  const gotoDemands = async () => {
    await call("Page.navigate", { url: BASE + "/#/demands" });
    await waitFor("document.body.dataset.view === 'demands'", "进入需求池", 15000);
    await waitFor("!!document.querySelector('[data-dem-mode]') && !!document.querySelector('#demandBody')", "需求池工具条", 15000);
    await sleep(1000);
  };

  /* 看板 */
  await gotoDemands();
  await click('[data-dem-mode="board"]');
  await waitFor("!!document.querySelector('.bkl-card') || !!document.querySelector('#demandBody .empty')", "看板卡片", 15000);
  await sleep(700);
  await shot("demands-board-1440.png");
  results.board = await measure();

  /* 看板显示菜单 */
  const opened = await evaluate(`(() => {
    const d = document.querySelector('#demBoardDisplay');
    if(!d) return false;
    d.open = true;
    return true;
  })()`);
  if(opened){ await sleep(300); await shot("demands-board-display-1440.png"); }
  await evaluate(`(() => { const d = document.querySelector('#demBoardDisplay'); if(d) d.open = false; return true; })()`);

  /* 列表 */
  await click('[data-dem-mode="table"]');
  await waitFor("!!document.querySelector('#view-demands table')", "列表表格", 15000);
  await sleep(800);
  await shot("demands-table-1440.png");
  results.table = await measure();

  /* 甘特 */
  await click('[data-dem-mode="gantt"]');
  /* 容器类名在切换瞬间就会挂上，必须等到行真正画出来（或空态），否则会截到空白 */
  await waitFor("!!document.querySelector('#view-demands .demg-seg') || !!document.querySelector('#view-demands .empty')", "甘特行", 15000).catch(() => null);
  await sleep(900);
  await shot("demands-gantt-1440.png");
  results.gantt = await measure();

  /* 详情抽屉 */
  await click('[data-dem-mode="board"]');
  await waitFor("!!document.querySelector('.bkl-card')", "回到看板", 15000);
  await sleep(500);
  await click('.bkl-card [data-dem-detail]');
  await waitFor("!!document.querySelector('.demand-detail')", "需求详情", 15000);
  await sleep(700);
  await shot("demands-detail-1440.png");
  results.detail = await measure();

  /* 新建需求 */
  await evaluate(`(() => { const x = document.querySelector('.demand-detail .icon-btn'); if(x) x.click(); return true; })()`);
  await sleep(500);
  await click('#btnDemandNew');
  await waitFor("document.getElementById('dlgDemand').classList.contains('open')", "提需求弹层", 15000);
  await sleep(600);
  await shot("demands-new-1440.png");
  results.new = await measure();
  await evaluate(`(() => { const x = document.getElementById('dlgDemandX'); if(x) x.click(); return true; })()`);
  await sleep(400);

  /* 主状态工作页（看板列头进入） */
  await gotoDemands();
  await click('[data-dem-mode="board"]');
  await waitFor("!!document.querySelector('[data-dem-open=\"review\"]')", "列头", 15000);
  await sleep(500);
  await click('[data-dem-open="review"]');
  await waitFor("!!document.querySelector('#view-demands .dem-work-grid') || !!document.querySelector('#view-demands .dem-work')", "需求工作页", 15000).catch(() => null);
  await sleep(900);
  await shot("demands-work-1440.png");
  results.work = await measure();

  /* 390 移动端：看板横向滚动、列表与工作页堆叠 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await gotoDemands();
  await click('[data-dem-mode="board"]');
  await waitFor("!!document.querySelector('.bkl-card')", "移动看板", 15000);
  await sleep(700);
  await shot("demands-board-390.png");
  results.mobileBoard = await measure();
  await click('[data-dem-mode="table"]');
  await waitFor("!!document.querySelector('#view-demands .dem-mob-cards, #view-demands table')", "移动列表", 15000);
  await sleep(700);
  await shot("demands-table-390.png");
  results.mobileTable = await measure();
  await click('[data-dem-mode="board"]');
  await waitFor("!!document.querySelector('[data-dem-open=\"review\"]')", "移动列头", 15000);
  await sleep(500);
  await click('[data-dem-open="review"]');
  await sleep(900);
  await shot("demands-work-390.png");
  results.mobileWork = await measure();
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
