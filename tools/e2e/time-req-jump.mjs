/* 计时明细项目归属跳转 E2E（候选2 · 派生口径，Node 18+ 原生 CDP）
   范围：周回顾/投入分析计时明细（openLogTable）、成员负载计时下钻（memberLogsHTML）的「项目」列
   与补记弹窗「计入项目」行：有归属渲染可点跳转 chip，未归类回落纯文本；跳转关浮层落项目视图。
   覆盖：
     A 契约：/api/review/hour-logs、/api/stats/hour-logs、/api/manager/workload 三端点行带 reqId，
       与 reqName 同源（未归类双空），并与空间项目列表对账。
     B 周回顾下钻：chip 结构/aria/悬停态；未归类纯文本；点 chip 关浮层落项目视图。
     C 行点击仍开工作项抽屉（不误跳）；chip 键盘 Enter 跳转 + 焦点环。
     D 成员负载计时层：chip + 未归类纯文本；返回项目分布后 chip 仍可跳。
     E 补记弹窗：计入项目=工作项所属项目（只展示+跳转，非编辑控件）；未归类工作项纯文本；保存入口不被破坏（取消退出，不写库）。
     F 只读成员(zhoumin)：chip 仍可跳转；补记入口被既有守卫拦（提示查看权限）。
     G 移动端 390：浮层不超视口、表格横滚、合成触摸点 chip 跳转（headless 移动仿真不送原始输入，如实登记）。
   数据：支付业务部演示库。未归类样本为可逆改动：运行前把 SAMPLE_TASK.req_id 置 NULL（直接 SQL，不产生应用日志），
   收尾 finally 还原并回读确认；其余全程只读 + 跳转，不写库。
   运行前需 8082 预览 + 8090 后端在线。全程控制台零报错 + 无 4xx/5xx（环境缺口单独归桶）。
   环境：临时 profile 关闭密码管理器——「保存密码」气泡会吞掉整页原始输入，F 段先断言 hover 可达再点。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const HALF = process.env.E2E_HALF || "zhoumin";     // 清结算项目只读成员

const WS = "Smw9zcftmwwnrwuon";                    // 支付业务部
const PROJ = "R4ohfd6ha97zjtedr3ogg";              // 清结算与对账平台
const SNAP_TASK = "Kr9vof65na3g5h4130i38";         // 差错工单自动分派（属 PROJ，补记弹窗样本）
const WEEK_TASK = "Kxy52tz1ko0vl358vsrvs";         // 日终批量任务拆分（属 PROJ，本周 5 条已结束计时）
const SAMPLE_TASK = "K1t5o6ox2djh9ltzla4k2";       // 名单同步延迟超过 5 分钟（本周有 2 条已结束计时）
const SAMPLE_REQ = "Rvlauh8rxq7fihkg126sq";        // 风控规则引擎（样本原归属，收尾还原）
const SAMPLE_TITLE = "名单同步延迟超过 5 分钟";

const MYSQL = ["/usr/local/mysql/bin/mysql", "-h", "127.0.0.1", "-P", "3307", "-u", "hourglass", "-phourglass123",
  "--default-character-set=utf8mb4", "hourglass", "-N", "-e"];
const sql = q => {
  const r = spawnSync(MYSQL[0], MYSQL.slice(1).concat(q), { encoding: "utf8" });
  if(r.status !== 0) throw new Error("SQL 失败：" + (r.stderr || "").trim());
  return (r.stdout || "").trim();
};

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 预览直供前端比运行 jar 新时的已知环境缺口，单独归桶 */
const KNOWN_GAP_APIS = ["/api/doc-categories", "/api/test-modules"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.knownGaps = []; this.resourceErrors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.responseReceived"){
      const r = msg.params.response || {};
      if(r.status >= 400 && String(r.url).indexOf("favicon") === -1){
        const line = r.status + " " + r.url;
        if(isKnownGap(r.url)) this.knownGaps.push(line); else this.netErrors.push(line);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(/Failed to load resource/.test(text)) this.resourceErrors.push("console.error: " + text);
      else this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")) this.resourceErrors.push("resource: " + (e.url || "") + " + e.text");
      else this.errors.push("log: " + e.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id; const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9453);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "time-req-jump-"));
/* 表单登录会触发 Chrome「保存密码」气泡，headless 下它抢占浏览器级输入焦点，
   之后整页收不到任何原始鼠标/键盘事件（el.click() 仍可用，极易误判成产品缺陷）。
   一次性临时 profile 里关掉密码管理器，保留真实登录表单路径。 */
fs.mkdirSync(path.join(tmp, "Default"), { recursive: true });
fs.writeFileSync(path.join(tmp, "Default", "Preferences"), JSON.stringify({
  profile: { password_manager_enabled: false, password_manager_leak_detection: false },
  credentials_enable_service: false, credentials_enable_autosignin: false
}));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];
const BAD_TOASTS = [];
const shot = async (name, keepToast) => {
  if(!keepToast){
    try{ await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`); }catch(e){}
  }
  try{ await evaluate(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
  const s = await Promise.race([call("Page.captureScreenshot", { format: "png" }), sleep(9000).then(() => null)]);
  if(!s){ console.log("  WARN 截图超时，跳过 " + name); return; }
  const out = "/tmp/hg-timereq-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
  console.log("  SHOT " + out);
};

let call, evaluate, waitFor;
let sampleSet = false;
try{
  /* 可逆样本：未归类计时（演示库原本全部有归属）。直接 SQL，不产生应用日志；finally 还原。 */
  const origReq = sql(`SELECT req_id FROM task WHERE id='${SAMPLE_TASK}'`);
  if(origReq !== SAMPLE_REQ) throw new Error("样本任务归属与预期不符：" + origReq);
  sql(`UPDATE task SET req_id=NULL WHERE id='${SAMPLE_TASK}'`);
  sampleSet = true;
  console.log("样本：SAMPLE_TASK.req_id 置 NULL（收尾还原为 " + SAMPLE_REQ + "）");

  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(120);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const pressKey = async (key, code, vk, text) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const pressEnter = () => pressKey("Enter", "Enter", 13, "\r");
  const keyboardModality = () => pressKey("Shift", "ShiftLeft", 16);
  const inputCall = (method, params) => Promise.race([
    call(method, params), sleep(6000).then(() => { throw new Error("输入事件超时：" + method); })
  ]);
  const mouse = (type, x, y) => inputCall("Input.dispatchMouseEvent",
    { type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const rect = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
    try{ el.scrollIntoView({ block:"center" }); }catch(e){}
    const r = el.getBoundingClientRect(); return { x:r.left + r.width/2, y:r.top + r.height/2, w:r.width, h:r.height }; })()`);
  const clickAt = async sel => { const r = await rect(sel); if(!r) throw new Error("找不到节点 " + sel);
    await mouse("mousePressed", r.x, r.y); await mouse("mouseReleased", r.x, r.y); await sleep(260); };
  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); }
  };
  const watchToasts = () => evaluate(`(() => {
    window.__badToasts = [];
    const w = document.getElementById("toastWrap"); if(!w) return false;
    new MutationObserver(muts => muts.forEach(mu => mu.addedNodes.forEach(n => {
      if(n.nodeType === 1 && /(^|\\s)bad(\\s|$)/.test(n.className)) window.__badToasts.push((n.textContent||"").trim().slice(0,120));
    }))).observe(w, { childList:true });
    return true;
  })()`);
  const drainBad = async () => {
    try{ const b = await evaluate(`(() => { const x = window.__badToasts||[]; window.__badToasts=[]; return x; })()`); BAD_TOASTS.push(...b); }catch(e){}
  };
  const login = async (user, pw) => {
    await drainBad();
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("uName", ${JSON.stringify(user)}); set("uPass", ${JSON.stringify(pw)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    try{ await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成 " + user, 12000); }
    catch(e){ const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`); throw new Error("登录未完成：" + errMsg); }
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
    let curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    if(curWs !== WS){
      await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
      await call("Page.navigate", { url: BASE + "/" });
      await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
    }
    await watchToasts();
  };
  const showView = async name => {
    await evaluate(`import("./js/core/router.js").then(m => m.showView(${JSON.stringify(name)})); true`);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(name)}`, "视图 " + name, 12000);
    await sleep(400);
  };
  const closeDrawer = async () => {
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
    await sleep(240);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm"); if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(120);
  };
  const openDrawer = async id => {
    await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(id)})); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(id)}) && document.getElementById("taskDrawer").classList.contains("on")`, "抽屉打开 " + id, 12000);
    await sleep(300);
  };
  const closeLayers = () => evaluate(`(() => { document.querySelectorAll(".modal-layer.open").forEach(l => { const b = l.querySelector("[data-manager-close],[data-close]"); if(b) b.click(); }); return true; })()`);
  const openReviewDrill = async () => {
    await showView("review");
    await waitFor(`!!document.querySelector('#reviewHours [data-review-hours="space"]')`, "周回顾工时入口", 12000);
    await evaluate(`(() => { document.querySelector('#reviewHours [data-review-hours="space"]').click(); return true; })()`);
    await waitFor(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].pop(); return l && l.querySelectorAll(".manager-tbl tbody tr").length > 0; })()`, "计时明细浮层", 12000);
    await sleep(250);
  };
  const drillLayer = () => evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].pop(); return l ? l.className : null; })()`);
  const landedProject = () => evaluate(`import("./js/core/state.js").then(s => ({ view:document.body.dataset.view, pid:s.rt.managerProjectId || null }))`);

  await login(USER, PASS);
  await evaluate(`import("./js/core/state.js").then(s => s.rt.reqList.map(r => ({ id:r.id, name:r.name })))`).then(rs => { global.__reqs = rs; });

  await section("[A] 三端点 reqId 契约", async () => {
    const review = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/review/hour-logs", { weekOffset:0, limit:100, probe:Date.now() }))`);
    const stats = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/stats/hour-logs", { scope:"all", period:"week", limit:100, probe:Date.now() }))`);
    const wl = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/manager/workload", { probe:Date.now() }))`);
    const rowsOf = p => (p && p.items) || [];
    const wlRows = [];
    ((wl && wl.members) || []).forEach(m => (m.weekLogs || []).concat(m.lastWeekLogs || []).forEach(l => wlRows.push(l)));
    for(const [label, rows] of [["review", rowsOf(review)], ["stats", rowsOf(stats)], ["workload", wlRows]]){
      assert(rows.length > 0, label + " 有计时行（" + rows.length + "）");
      assert(rows.every(l => "reqId" in l), label + " 每行带 reqId 字段");
      assert(rows.every(l => (l.reqId == null) === (!l.reqName || l.reqName === "未归类")), label + " reqId 与 reqName 同源（未归类双空）");
      const bad = rows.filter(l => l.reqId && !(global.__reqs || []).some(r => r.id === l.reqId && r.name === l.reqName));
      assert(bad.length === 0, label + " 有归属行的 reqId/reqName 与空间项目列表对账一致");
    }
    const sampleRows = rowsOf(review).filter(l => l.taskId === SAMPLE_TASK);
    assert(sampleRows.length >= 1 && sampleRows.every(l => l.reqId == null && !l.reqName), "样本任务计时行 reqId/reqName 双空");
    const snapRows = rowsOf(stats).filter(l => l.taskId === WEEK_TASK);
    assert(snapRows.length >= 1 && snapRows.every(l => l.reqId === PROJ), "本周 PROJ 任务计时行 reqId=清结算项目");
  });

  await section("[B] 周回顾下钻：chip 与跳转", async () => {
    await openReviewDrill();
    const chips = await evaluate(`document.querySelectorAll(".modal-layer.open .manager-tbl [data-jump-project]").length`);
    assert(chips > 0, "明细表渲染项目 chip（" + chips + " 个）");
    assert(await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].pop();
      const tr = [...l.querySelectorAll("tbody tr")].find(t => t.textContent.indexOf(${JSON.stringify(SAMPLE_TITLE)}) >= 0);
      return tr && !tr.querySelector("[data-jump-project]") && /未归类/.test(tr.textContent); })()`), "样本行未归类回落纯文本");
    assert(await evaluate(`document.querySelector(".modal-layer.open [data-jump-project]").getAttribute("aria-label").indexOf("打开项目：") === 0`), "chip aria-label 带跳转语义");
    const chipSel = `.modal-layer.open tr[data-open-task="${WEEK_TASK}"] [data-jump-project]`;
    const hasSnapChip = await evaluate(`!!document.querySelector(${JSON.stringify(chipSel)})`);
    assert(hasSnapChip, "本周 PROJ 行项目列为 chip");
    const r = await rect(chipSel);
    await mouse("mouseMoved", r.x, r.y); await sleep(150);
    assert(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(chipSel)})).textDecorationStyle`) === "solid", "chip 悬停下划线变实线");
    await shot("desktop-drill");
    await clickAt(chipSel);
    await waitFor(`!document.querySelector(".modal-layer.open")`, "跳转关浮层", 8000);
    const landed = await landedProject();
    assert(landed.view === "project" && landed.pid === PROJ, "点 chip 落项目视图（清结算）");
    assert(await evaluate(`document.getElementById("viewTitle").textContent.indexOf("清结算与对账平台") >= 0 || document.body.textContent.indexOf("清结算与对账平台") >= 0`), "项目视图显示目标项目名");
    await shot("desktop-landed");
  });

  await section("[C] 行点击不误跳 + 键盘 Enter", async () => {
    await openReviewDrill();
    const before = (await landedProject()).pid;
    await clickAt(`.modal-layer.open tr[data-open-task="${WEEK_TASK}"] .manager-task-title`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === "${WEEK_TASK}")`, "行点击开抽屉", 8000);
    assert(await evaluate(`!!document.querySelector(".modal-layer.open")`), "开抽屉后明细浮层仍在");
    assert((await landedProject()).pid === before && (await landedProject()).view !== "project", "行点击不触发项目跳转");
    await closeDrawer();
    await keyboardModality();
    const chipSel = `.modal-layer.open tr[data-open-task="${WEEK_TASK}"] [data-jump-project]`;
    await evaluate(`document.querySelector(${JSON.stringify(chipSel)}).focus()`);
    assert(await evaluate(`getComputedStyle(document.activeElement).boxShadow.indexOf("rgba(37, 99, 235") >= 0`), "chip 聚焦有焦点环");
    await shot("desktop-chip-focus");
    await pressEnter();
    await waitFor(`!document.querySelector(".modal-layer.open")`, "Enter 跳转关浮层", 8000);
    assert((await landedProject()).pid === PROJ, "Enter 触发跳转");
  });

  await section("[D] 成员负载计时层", async () => {
    await showView("workload");
    await waitFor(`!!document.querySelector("[data-member-open]")`, "成员矩阵行", 12000);
    const memberSel = await evaluate(`(() => { const rows = [...document.querySelectorAll("[data-member-open]")];
      const hit = rows.find(r => r.textContent.indexOf("赵磊") >= 0) || rows[0];
      if(!hit) return null;
      hit.setAttribute("data-e2e-member", "1"); return "[data-e2e-member='1']"; })()`);
    assert(!!memberSel, "找到成员行");
    await evaluate(`(() => { document.querySelector(${JSON.stringify(memberSel)}).click(); return true; })()`);
    await waitFor(`!!document.querySelector(".modal-layer.open [data-member-logs='week'], .modal-layer.open [data-member-back]")`, "成员抽屉", 12000);
    const hasWeekLink = await evaluate(`!!document.querySelector(".modal-layer.open [data-member-logs='week']")`);
    if(hasWeekLink){
      await evaluate(`(() => { document.querySelector(".modal-layer.open [data-member-logs='week']").click(); return true; })()`);
      await sleep(300);
    }
    const chips = await evaluate(`document.querySelectorAll(".modal-layer.open [data-jump-project]").length`);
    assert(chips > 0, "成员计时层渲染 chip（" + chips + "）");
    await shot("desktop-member-logs");
    await evaluate(`(() => { const b = document.querySelector(".modal-layer.open [data-member-back]"); if(b) b.click(); return true; })()`);
    await sleep(300);
    assert(await evaluate(`document.querySelectorAll(".modal-layer.open [data-member-project]").length > 0`), "返回项目分布");
    assert(await evaluate(`document.querySelectorAll(".modal-layer.open [data-member-project] [data-jump-project]").length`) === 0, "项目分布行是下钻入口，不放跳转 chip");
    await evaluate(`(() => { const r = document.querySelector(".modal-layer.open [data-member-project]"); if(r) r.click(); return true; })()`);
    await sleep(300);
    const tchip = `.modal-layer.open tr[data-open-task] [data-jump-project]`;
    assert(await evaluate(`!!document.querySelector(${JSON.stringify(tchip)})`), "下钻工作项层项目列为 chip");
    await clickAt(tchip);
    await waitFor(`!document.querySelector(".modal-layer.open")`, "工作项层 chip 跳转关浮层", 8000);
    assert((await landedProject()).view === "project", "工作项层 chip 落项目视图");
  });

  await section("[E] 补记弹窗计入项目（派生口径）", async () => {
    await openDrawer(SNAP_TASK);
    await evaluate(`(() => { const b = document.getElementById("rfHoursAdd") || document.getElementById("btnActualAdd"); if(b) b.click(); return true; })()`);
    await waitFor(`document.getElementById("dlgTimeAdd").classList.contains("open")`, "补记弹窗", 8000);
    assert(await evaluate(`(document.querySelector("#iTimeProject [data-jump-project]")||{}).getAttribute && document.querySelector("#iTimeProject [data-jump-project]").getAttribute("data-jump-project") === "${PROJ}"`), "计入项目=工作项所属项目");
    assert(await evaluate(`document.querySelector("#iTimeProject [data-jump-project]").textContent`) === "清结算与对账平台", "计入项目名称正确");
    assert(await evaluate(`!document.querySelector("#iTimeProject select, #iTimeProject input")`), "计入项目非编辑控件");
    assert(await evaluate(`document.querySelector("#iTimeProject .time-attr-note").textContent.indexOf("跟随工作项所属项目") >= 0`), "归属说明文案");
    await shot("desktop-time-add");
    await clickAt("#iTimeProject [data-jump-project]");
    await waitFor(`!document.getElementById("dlgTimeAdd").classList.contains("open")`, "chip 跳转关弹窗", 8000);
    assert((await landedProject()).pid === PROJ, "补记弹窗 chip 落项目视图");
    await closeDrawer();
    await openDrawer(SAMPLE_TASK);
    await evaluate(`(() => { const b = document.getElementById("rfHoursAdd") || document.getElementById("btnActualAdd"); if(b) b.click(); return true; })()`);
    await waitFor(`document.getElementById("dlgTimeAdd").classList.contains("open")`, "未归类补记弹窗", 8000);
    assert(await evaluate(`!document.querySelector("#iTimeProject [data-jump-project]") && document.getElementById("iTimeProject").textContent.indexOf("未归类") >= 0`), "未归类工作项纯文本回落");
    await shot("desktop-time-add-plain");
    await evaluate(`(() => { document.getElementById("dlgTimeAddCancel").click(); return true; })()`);
    await sleep(200);
    assert(await evaluate(`!document.getElementById("dlgTimeAdd").classList.contains("open")`), "取消关闭弹窗（不写库）");
    await closeDrawer();
  });

  await section("[F] 只读成员：可跳不可补记", async () => {
    await login(HALF, PASS);
    await openReviewDrill();
    const chipSel = `.modal-layer.open [data-jump-project="${PROJ}"]`;
    assert(await evaluate(`!!document.querySelector(${JSON.stringify(chipSel)})`), "只读成员明细仍有本项目 chip");
    /* 先证明原始输入真的送到页面：浏览器级气泡抢焦点时 hover 不会生效，避免误判成产品缺陷 */
    const cr = await rect(chipSel);
    await mouse("mouseMoved", cr.x, cr.y); await sleep(160);
    assert(await evaluate(`document.querySelector(${JSON.stringify(chipSel)}).matches(":hover")`), "只读会话原始鼠标输入可达（hover 生效）");
    await clickAt(chipSel);
    await waitFor(`!document.querySelector(".modal-layer.open")`, "只读跳转关浮层", 8000);
    assert((await landedProject()).view === "project", "只读成员 chip 可跳转");
    await openDrawer(SNAP_TASK);
    await evaluate(`(() => { const b = document.getElementById("rfHoursAdd") || document.getElementById("btnActualAdd"); if(b) b.click(); return true; })()`);
    await sleep(400);
    assert(await evaluate(`!document.getElementById("dlgTimeAdd").classList.contains("open")`), "只读不给开补记弹窗");
    assert(await evaluate(`(document.getElementById("toastWrap")||{}).textContent.indexOf("只有查看权限") >= 0`), "只读补记提示查看权限");
    await shot("desktop-readonly", true);
    await closeDrawer();
  });

  await section("[G] 移动端 390", async () => {
    await login(USER, PASS);
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    await openReviewDrill();
    assert(await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].pop(); const s = l && l.querySelector(".sheet"); return s && s.getBoundingClientRect().width <= 390; })()`), "明细浮层不超 390 视口");
    assert(await evaluate(`(() => { const w = document.querySelector(".modal-layer.open .tbl-wrap"); return w && w.scrollWidth > w.clientWidth; })()`), "窄屏表格横向滚动");
    await shot("mobile-drill");
    await evaluate(`(() => { const w = document.querySelector(".modal-layer.open .tbl-wrap"); w.scrollLeft = w.scrollWidth; return true; })()`);
    const tapped = await evaluate(`(() => {
      const el = document.querySelector(".modal-layer.open [data-jump-project]"); if(!el) return false;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
      if(!hit || (hit !== el && !el.contains(hit))) return false;
      const opts = { bubbles:true, cancelable:true, pointerType:"touch", isPrimary:true, clientX:r.x + r.width/2, clientY:r.y + r.height/2 };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true }));
      return true;
    })()`);
    assert(tapped, "触摸命中 chip（合成 pointerType=touch）");
    await waitFor(`!document.querySelector(".modal-layer.open")`, "触摸跳转关浮层", 8000);
    assert((await landedProject()).view === "project", "移动端触摸跳转落项目视图");
    await shot("mobile-landed");
    await openDrawer(SNAP_TASK);
    await evaluate(`(() => { const b = document.getElementById("rfHoursAdd") || document.getElementById("btnActualAdd"); if(b) b.click(); return true; })()`);
    await waitFor(`document.getElementById("dlgTimeAdd").classList.contains("open")`, "390 补记弹窗", 8000);
    assert(await evaluate(`(() => { const s = document.querySelector("#dlgTimeAdd .sheet"); const r = s.getBoundingClientRect(); return r.width <= 390 && r.left >= 0; })()`), "补记弹窗适配 390");
    await shot("mobile-time-add");
    await evaluate(`(() => { document.getElementById("dlgTimeAddCancel").click(); return true; })()`);
    await closeDrawer();
    await call("Emulation.clearDeviceMetricsOverride", {});
  });

  await drainBad();
  console.log("\n[收尾] 错误归桶与样本还原");
  assert(BAD_TOASTS.length === 0, "无红色错误 toast" + (BAD_TOASTS.length ? "：" + BAD_TOASTS.join(" | ") : ""));
  assert(cdp.errors.length === 0, "控制台零报错" + (cdp.errors.length ? "：" + cdp.errors.join(" | ") : ""));
  assert(cdp.netErrors.length === 0, "无 4xx/5xx" + (cdp.netErrors.length ? "：" + cdp.netErrors.join(" | ") : ""));
  assert(cdp.resourceErrors.length === 0, "无资源加载报错" + (cdp.resourceErrors.length ? "：" + cdp.resourceErrors.join(" | ") : ""));
  if(cdp.knownGaps.length) console.log("  INFO 环境缺口（预览前端新于运行 jar）：" + cdp.knownGaps.length + " 次 " + [...new Set(cdp.knownGaps)].join(" | "));
  console.log("  截图 " + SHOTS.length + " 张：" + SHOTS.join(", "));
}catch(e){
  failed++;
  console.log("  ERROR " + (e && e.message || e));
}finally{
  if(sampleSet){
    try{
      sql(`UPDATE task SET req_id='${SAMPLE_REQ}' WHERE id='${SAMPLE_TASK}'`);
      const back = sql(`SELECT req_id FROM task WHERE id='${SAMPLE_TASK}'`);
      if(back === SAMPLE_REQ) console.log("  PASS 样本归属已还原为 " + SAMPLE_REQ);
      else { failed++; console.log("  FAIL 样本还原回读不符：" + back); }
    }catch(e){ failed++; console.log("  FAIL 样本还原失败：" + e.message); }
  }
  try{ proc.kill("SIGKILL"); }catch(e){}
}
console.log("\n结果：" + (failed ? failed + " FAIL" : "0 FAIL") + "（PASS 见上）");
process.exit(failed ? 1 : 0);