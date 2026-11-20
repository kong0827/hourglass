/* 周回顾 / 消息中心 × 2026-11-19 原型：逐页面截图与计算样式取证
   用法：node tools/e2e/review-messages-proto-audit.mjs
   产物：docs/audit/review-messages-prototype-alignment-2026-11-20/
     - shots/{review,messages,messages-due}-1440.png
     - shots/{review,messages}-390.png
     - metrics.json（页头、工具条、面板、统计卡、消息左栏/行/日分隔、390）
   只读：不点保存、不标已读、不改任何数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/review-messages-prototype-alignment-2026-11-20");
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

const port = 9235;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvw-audit-"));
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
      return {
        h1: style(h1), h1text: txt(h1),
        sub: style(sub), subtext: txt(sub),
        pill: style(pill), pillText: pill && !pill.hidden ? txt(pill) : "(hidden)",
        actions: pa && !pa.hidden ? [...pa.querySelectorAll(".btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
        newWrapHidden: nw ? nw.hidden : null
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
    await sleep(1000);
  };

  /* ---------- 周回顾 ---------- */
  await goto("#/review", "review", "!document.querySelector('#statGrid .skel') && !!document.querySelector('#summaryText') && document.querySelector('#summaryText').textContent.trim() !== '—'", "周回顾");
  await shot("review-1440.png");
  results.review = await evaluate(`(() => {
    ${HELPERS}
    const tb = first("#view-review .page-toolbar");
    const title = first("#view-review .toolbar-title");
    const sel = document.getElementById("reviewReq");
    const weekLabel = document.getElementById("weekLabel");
    const btns = tb ? [...tb.querySelectorAll(".btn, .icon-btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [];
    const summary = first("#view-review .summary-panel");
    const sh = first("#view-review .summary-panel .sh");
    const sp = first("#view-review .summary-panel p");
    const ai = first("#reviewAiBox");
    const aiHead = first("#reviewAiBox .panel-head h3");
    const aiHint = document.getElementById("reviewAiHint");
    const aiNote = document.getElementById("reviewAiNote");
    const stats = [...document.querySelectorAll("#statGrid .stat")].filter(vis);
    const stat = stats[0];
    const sk = stat && stat.querySelector(".k"), sv = stat && stat.querySelector(".v");
    const panel = first("#reviewPivotPanel");
    const ph = first("#reviewPivotPanel .panel-head h3");
    const th = first("#reviewPivotPanel th");
    const td = first("#reviewPivotPanel td");
    const hours = [...document.querySelectorAll("#reviewHours .stat")].filter(vis);
    const done = first("#doneList .done-item");
    const doneT = first("#doneList .done-item .di-t");
    const doneM = first("#doneList .done-item .di-m");
    const dist = first("#reqDist .dist-row");
    const distLb = first("#reqDist .dist-row .lb");
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      toolbar: style(tb), title: style(title), titleText: txt(title),
      select: style(sel), week: { ...style(weekLabel), t: txt(weekLabel) },
      buttons: btns,
      summary: summary ? { ...style(summary), t: txt(summary).slice(0, 50) } : null,
      sh: style(sh), sp: style(sp),
      ai: ai ? style(ai) : null, aiHead: style(aiHead), aiHeadText: txt(aiHead), aiHint: style(aiHint), aiNote: style(aiNote),
      statCount: stats.length, stat: style(stat), statK: style(sk), statV: style(sv), statText: txt(stat),
      pivotPanel: style(panel), pivotHead: style(ph), pivotHeadText: txt(ph),
      th: style(th), thText: txt(th), td: style(td),
      hoursCount: hours.length, hoursStat: style(hours[0]),
      doneRow: style(done), doneTitle: style(doneT), doneMeta: style(doneM),
      distRow: style(dist), distLb: style(distLb),
      panelBg: style(document.getElementById("view-review")),
      panels: document.querySelectorAll("#view-review .panel, #view-review .summary-panel").length
    };
  })()`);

  /* ---------- 消息中心 · 全部消息 ---------- */
  await goto("#/messages", "messages", "!!document.querySelector('#messagesBody .msg-layout')", "消息中心");
  await waitFor("!document.querySelector('#messagesBody .skel')", "消息列表", 15000);
  await shot("messages-1440.png");
  results.messages = await evaluate(`(() => {
    ${HELPERS}
    const head = first("#messagesBody .msg-page-head");
    const sub = first("#messagesBody .msg-page-sub");
    const unread = first("#messagesBody .msg-unread");
    const acts = head ? [...head.querySelectorAll(".btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [];
    const layout = first("#messagesBody .msg-layout");
    const rail = first("#messagesBody .msg-rail");
    const railCard = first("#messagesBody .msg-rail-card");
    const railTitle = first("#messagesBody .msg-rail-title");
    const railItem = first("#messagesBody .msg-rail-item");
    const railOn = first("#messagesBody .msg-rail-item.on");
    const railN = first("#messagesBody .msg-rail-item .n");
    const railNote = first("#messagesBody .msg-rail-note");
    const pane = first("#messagesBody .msg-pane");
    const mainHead = first("#messagesBody .msg-main-head");
    const mainB = first("#messagesBody .msg-main-head b");
    const chips = first("#messagesBody .msg-chips");
    const chip = first("#messagesBody .msg-chip");
    const chipOn = first("#messagesBody .msg-chip.on");
    const hint = first("#messagesBody .msg-hint");
    const day = first("#messagesBody .ap-day");
    const row = first("#messagesBody .apn");
    const rowUnread = first("#messagesBody .apn.unread");
    const ic = first("#messagesBody .apn-ic");
    const title = first("#messagesBody .apn-title");
    const body = first("#messagesBody .apn-body");
    const meta = first("#messagesBody .apn-meta");
    const time = first("#messagesBody .apn-time");
    const dot = first("#messagesBody .apn-dot");
    const foot = first("#messagesBody .msg-foot");
    return {
      overflow: overflow(),
      pagehead: pagehead(),
      head: style(head), sub: { ...style(sub), t: txt(sub) },
      unread: unread ? { ...style(unread), t: txt(unread) } : null,
      acts,
      layout: layout ? { ...style(layout), cols: getComputedStyle(layout).gridTemplateColumns } : null,
      rail: style(rail), railCards: document.querySelectorAll("#messagesBody .msg-rail-card").length,
      railCard: style(railCard), railTitle: { ...style(railTitle), t: txt(railTitle) },
      railItem: { ...style(railItem), t: txt(railItem) }, railOn: { ...style(railOn), t: txt(railOn) },
      railN: style(railN), railNote: style(railNote),
      pane: style(pane), mainHead: { ...style(mainHead), t: txt(mainHead) },
      mainB: { ...style(mainB), t: txt(mainB) },
      chips: style(chips), chip: { ...style(chip), t: txt(chip) }, chipOn: { ...style(chipOn), t: txt(chipOn) },
      chipCount: document.querySelectorAll("#messagesBody .msg-chip").length,
      hint: { ...style(hint), t: txt(hint) },
      day: { ...style(day), t: txt(day) },
      dayCount: document.querySelectorAll("#messagesBody .ap-day").length,
      row: style(row), rowUnread: rowUnread ? { ...style(rowUnread), bg: getComputedStyle(rowUnread).backgroundColor, bl: getComputedStyle(rowUnread).borderLeftColor } : null,
      rowCount: document.querySelectorAll("#messagesBody .apn").length,
      ic: { ...style(ic), t: txt(ic), shape: getComputedStyle(ic).borderRadius },
      title: style(title), body: style(body), meta: style(meta), time: style(time),
      dot: dot ? { ...style(dot), bg: getComputedStyle(dot).backgroundColor } : null,
      foot: { ...style(foot), t: txt(foot) }
    };
  })()`);

  /* ---------- 消息中心 · 截止提醒 ---------- */
  await evaluate("(() => { const el = document.querySelector('#messagesBody [data-msg-due]'); if(el) el.click(); return true; })()");
  await sleep(1200);
  await shot("messages-due-1440.png");
  results.messagesDue = await evaluate(`(() => {
    ${HELPERS}
    const b = first("#messagesBody .msg-main-head b");
    const item = first("#messagesBody .ap-item");
    const gl = first("#messagesBody .ap-glabel");
    return { mainText: txt(b), item: style(item), itemText: txt(item), glabel: { ...style(gl), t: txt(gl) },
      rail: document.querySelectorAll("#messagesBody .msg-rail-item").length };
  })()`);
  await evaluate("(() => { const el = document.querySelector('#messagesBody [data-msg-filter=\"all\"]'); if(el) el.click(); return true; })()");
  await sleep(800);

  /* ---------- 周回顾 · 本周（有数据时用来看透视表与完成行） ---------- */
  await goto("#/review", "review", "!document.querySelector('#statGrid .skel')", "周回顾复访");
  /* 演示账号未必在本周有完成项：往前翻最多 8 周，找到一周有数据的用来看透视表与完成行 */
  results.reviewWeekScan = [];
  for(let i = 0; i < 8; i++){
    await evaluate("(() => { const el = document.getElementById('weekPrev'); if(el) el.click(); return true; })()");
    await sleep(1100);
    const probe = await evaluate(`(() => ({ week: (document.getElementById('weekLabel') || {}).textContent || "",
      done: document.querySelectorAll("#doneList .done-item").length,
      loading: !!document.querySelector("#statGrid .skel"), err: !!document.querySelector("#statGrid .err, #statGrid .page-error") }))()`);
    results.reviewWeekScan.push(probe);
    if(probe.done > 0) break;
  }
  await shot("review-week-1440.png");
  results.reviewWeek = await evaluate(`(() => {
    ${HELPERS}
    const th = first("#reviewPivot table th");
    const td = first("#reviewPivot table td");
    const done = first("#doneList .done-item");
    const dist = first("#reqDist .dist-row");
    return { week: txt(document.getElementById("weekLabel")),
      statText: txt(first("#statGrid .stat")), doneRows: document.querySelectorAll("#doneList .done-item").length,
      th: { ...style(th), t: txt(th) }, td: style(td),
      doneRow: style(done), distRow: style(dist) };
  })()`);

  /* ---------- 消息 · 合成未读态（只改本地 DOM，用来核对未读圆点与字重） ---------- */
  await goto("#/messages", "messages", "!!document.querySelector('#messagesBody .msg-layout')", "消息中心复访");
  await waitFor("!document.querySelector('#messagesBody .skel')", "消息列表复访", 15000);
  await evaluate(`(() => {
    const row = document.querySelector("#messagesBody .apn");
    if(!row) return false;
    const clone = row.cloneNode(true);
    clone.classList.add("unread");
    if(!clone.querySelector(".apn-dot")){
      const dot = document.createElement("i");
      dot.className = "apn-dot";
      const time = clone.querySelector(".apn-time");
      if(time) clone.insertBefore(dot, time); else clone.appendChild(dot);
    }
    row.parentNode.insertBefore(clone, row);
    return true;
  })()`);
  await sleep(500);
  await shot("messages-unread-1440.png");
  results.messagesUnreadProbe = await evaluate(`(() => {
    ${HELPERS}
    const row = first("#messagesBody .apn.unread");
    const t = row && row.querySelector(".apn-title");
    const dot = row && row.querySelector(".apn-dot");
    const ic = row && row.querySelector(".apn-ic");
    return { synthetic: true, rowBg: row ? getComputedStyle(row).backgroundColor : null,
      rowBorderLeft: row ? getComputedStyle(row).borderLeftColor : null,
      title: t ? { fw: getComputedStyle(t).fontWeight, c: getComputedStyle(t).color } : null,
      dot: dot ? { w: Math.round(dot.getBoundingClientRect().width), h: Math.round(dot.getBoundingClientRect().height), bg: getComputedStyle(dot).backgroundColor } : null,
      ic: ic ? { bg: getComputedStyle(ic).backgroundColor, c: getComputedStyle(ic).color } : null };
  })()`);
  await evaluate("(() => { const r = document.querySelectorAll('#messagesBody .apn.unread'); if(r.length > 1) r[0].remove(); return true; })()");

  /* ---------- 390 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await goto("#/review", "review", "!document.querySelector('#statGrid .skel') && !!document.querySelector('#summaryText') && document.querySelector('#summaryText').textContent.trim() !== '—'", "移动周回顾");
  await shot("review-390.png");
  results.reviewMobile = await evaluate(`(() => {
    ${HELPERS}
    const tb = first("#view-review .page-toolbar");
    return { overflow: overflow(), pagehead: pagehead(), toolbar: tb ? { ...style(tb), sw: tb.scrollWidth, cw: tb.clientWidth } : null,
      title: style(first("#view-review .toolbar-title")) };
  })()`);

  await goto("#/messages", "messages", "!!document.querySelector('#messagesBody .msg-layout')", "移动消息中心");
  await waitFor("!document.querySelector('#messagesBody .skel')", "移动消息列表", 15000);
  await shot("messages-390.png");
  results.messagesMobile = await evaluate(`(() => {
    ${HELPERS}
    const rail = first("#messagesBody .msg-rail");
    const head = first("#messagesBody .msg-page-head");
    return { overflow: overflow(), pagehead: pagehead(),
      head: head ? { ...style(head), sw: head.scrollWidth, cw: head.clientWidth } : null,
      rail: rail ? { ...style(rail), cols: getComputedStyle(rail).flexDirection, sw: rail.scrollWidth, cw: rail.clientWidth } : null,
      row: style(first("#messagesBody .apn")) };
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
