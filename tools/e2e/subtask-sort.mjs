/* 检查项（子任务）排序持久化 E2E（仿 tools/e2e/p4-inline-edit.mjs，Node 18+ 原生 CDP）
   范围：工作项详情「执行」页检查清单的拖拽把手 / 键盘 ↑↓ 重排，sort_order 跨后端持久化。
   覆盖：
     A 结构：每行一个原生 button 把手 + aria-label 带位置语义 + aria-live 播报区 + 清单上方可见排序提示（只读改文案）；概览读态清单同序。
     B 拖拽：乐观重排 → 服务端 sort_order 落库 → 概览读态同序 → 整页刷新后仍在。
     C 键盘：聚焦把手 ↑/↓ 移动、重渲染后焦点回到同一把手、首尾边界不动也不发请求。
     D 失败：注入 reorder 500 → 只还原顺序（当前勾选不被复活）+ 诚实报错 + 服务端未被改动。
     E 新增：回车追加到末尾（sort_order = max+1）、计数同步、删除后复位。
     F 只读：viewer(wujun) 与项目只读成员(zhoumin) 无把手/无删除/勾选禁用；绕过界面直接写被服务端拒（403 / 400 全排列校验）。
     G 移动端：390 触摸拖拽同样重排，把手命中区 ≥24px、touch-action:none、中心无遮挡。
       窄屏用页面内合成 PointerEvent(pointerType=touch) 驱动产品真实监听：headless 在 mobile emulation
       下不把原始输入送到页面（Input.dispatchTouchEvent 还会卡住不回 ack），这一点如实登记为验证方式差异。
   段序 A B C D E F G：键盘断言必须在窄屏 emulation 之前（headless 往返后原始按键路由会留在窄屏状态）。
   全程控制台零报错 + 无 4xx/5xx + 无红色错误 toast（D 段注入的失败提示与 F 段登记的拒绝探针单独归桶）。
   数据：支付业务部演示库 SNAP_TASK（3 条检查项）；运行前需 8082 预览 + 8090 后端在线。
   收尾把 SNAP_TASK 的检查项顺序、勾选态复位为运行前的原值，并确认工作项本身未被改动。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";   // 空间 viewer，全项目只读
const HALF = process.env.E2E_HALF || "zhoumin";     // 清结算项目只读成员

const WS = "Smw9zcftmwwnrwuon";                 // 支付业务部
const SNAP_TASK = "Kr9vof65na3g5h4130i38";      // 差错工单自动分派（done，3 条检查项）
const NEW_TITLE = "E2E 排序补充项";

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

/* 预览直供的前端比运行中的 jar 新：文档分类/测试模块接口在源码里已有、jar 里还没打进去。
   这类 404 属环境差异，单独归桶并如实报出，不与本次改动的报错混在一起。 */
const KNOWN_GAP_APIS = ["/api/doc-categories", "/api/test-modules"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);
/* F 段故意被拒的探针：只读成员直接 POST reorder（403）+ 三种非法排列（400）。
   按 reorder 路径精确登记，次数必须与预算一致，其余 4xx 仍照常判失败。 */
const EXPECT_DENIALS = [new RegExp("/api/tasks/" + SNAP_TASK + "/subtasks/reorder")];
let denialBudget = 0;
const isExpectedDenial = url => EXPECT_DENIALS.some(re => re.test(String(url)));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.knownGaps = []; this.resourceErrors = []; this.denials = []; this.denialResources = [];
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
        if(isKnownGap(r.url)) this.knownGaps.push(line);
        else if(isExpectedDenial(r.url)) this.denials.push(line);
        else this.netErrors.push(line);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(/Failed to load resource/.test(text)) (isExpectedDenial(text) ? this.denialResources : this.resourceErrors).push("console.error: " + text);
      else this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")){
        (isExpectedDenial(e.url || "") ? this.denialResources : this.resourceErrors).push("resource: " + (e.url || "") + " " + e.text);
      }else this.errors.push("log: " + e.text);
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

const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9452);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "subtask-sort-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];
const BAD_TOASTS = [];        // 非预期的红色错误 toast
const EXPECT_TOASTS = [];     // D 段注入失败时应当出现的提示
const shot = async (name, keepToast) => {
  /* 截图前清掉累积 toast，避免遮挡卡片；失败态截图要保留提示，与原型稿一致 */
  if(!keepToast){
    try{ await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`); }catch(e){}
  }
  try{ await evaluate(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
  const s = await Promise.race([call("Page.captureScreenshot", { format: "png" }), sleep(9000).then(() => null)]);
  if(!s){ console.log("  WARN 截图超时（手势进行中），跳过 " + name); return; }
  const out = "/tmp/hg-subtask-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
};

let call, evaluate, waitFor;
try{
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
  const pressArrow = dir => pressKey(dir, dir, dir === "ArrowUp" ? 38 : 40);
  /* 输入事件加超时：headless 偶发不回 ack，不能让整条套件卡死在一个 dispatch 上 */
  const inputCall = (method, params) => Promise.race([
    call(method, params),
    sleep(6000).then(() => { throw new Error("输入事件超时：" + method); })
  ]);
  const mouse = (type, x, y) => inputCall("Input.dispatchMouseEvent",
    { type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });

  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }
    catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); }
  };

  /* ---------- toast 监视 ---------- */
  const watchToasts = () => evaluate(`(() => {
    window.__badToasts = [];
    const w = document.getElementById("toastWrap"); if(!w) return false;
    new MutationObserver(muts => muts.forEach(mu => mu.addedNodes.forEach(n => {
      if(n.nodeType === 1 && /(^|\\s)bad(\\s|$)/.test(n.className)) window.__badToasts.push((n.textContent||"").trim().slice(0,120));
    }))).observe(w, { childList:true });
    return true;
  })()`);
  const drainInto = async arr => {
    try{ const b = await evaluate(`(() => { const x = window.__badToasts||[]; window.__badToasts=[]; return x; })()`); arr.push(...b); }catch(e){}
  };
  const drainBad = () => drainInto(BAD_TOASTS);

  /* ---------- 登录 / 空间 ---------- */
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
      curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    }
    await watchToasts();
    return curWs;
  };

  /* ---------- 抽屉 / 执行页 ---------- */
  const closeDrawer = async () => {
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
    await sleep(220);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm"); if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(120);
  };
  const openExec = async (id) => {
    await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(id)})); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(id)} && document.getElementById("taskDrawer").classList.contains("on"))`, "抽屉打开", 12000);
    await evaluate(`(() => { const b = document.querySelector('[data-drawer-tab="exec"]'); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("paneExec"), s = document.getElementById("fSubtasks");
      return p && !p.hidden && s && !s.hidden && !s.classList.contains("collapsed")
        && document.querySelectorAll("#subList .sub-item").length > 0; })()`, "执行页检查清单就绪", 12000);
    await sleep(280);
  };
  const gotoTab = async name => {
    await evaluate(`(() => { const b = document.querySelector('[data-drawer-tab="${name}"]'); if(b) b.click(); return true; })()`);
    await sleep(280);
  };

  /* ---------- 顺序读取（DOM / 缓存 / 服务端） ---------- */
  const domOrder = () => evaluate(`[...document.querySelectorAll("#subList .sub-item")].map(el => Number(el.dataset.sub))`);
  const cacheOrder = () => evaluate(`import("./js/core/state.js").then(s => (s.rt.subtasksCache||[]).map(x => x.id))`);
  const rows = () => evaluate(`[...document.querySelectorAll("#subList .sub-item")].map(el => ({
    id:Number(el.dataset.sub), title:(el.querySelector(".sub-txt")||{}).textContent||"",
    done:!!(el.querySelector("[data-sub-toggle]")||{}).checked, grip:!!el.querySelector("[data-sub-grip]") }))`);
  const readOrder = () => evaluate(`[...document.querySelectorAll("#readChecklist [data-read-sub-toggle]")].map(el => Number(el.dataset.readSubToggle))`);
  const liveText = () => evaluate(`(document.getElementById("subLive")||{}).textContent || ""`);
  /* 服务端回读必须带随机串：API.get 走 ETag 缓存 */
  const serverSubs = () => evaluate(`import("./js/core/api.js").then(m => m.API.getAllPages("/api/tasks/${SNAP_TASK}/subtasks", { probe:Date.now() }))
    .then(a => (a||[]).map(s => ({ id:s.id, title:s.title, done:!!s.done, order:s.sortOrder })))`);
  const serverOrder = async () => (await serverSubs()).map(s => s.id);
  const waitServerOrder = async (expected, label) => {
    const deadline = Date.now() + 12000; let last, err = "";
    while(Date.now() < deadline){
      try{ last = await serverOrder(); err = ""; }catch(e){ err = e.message; }
      if(JSON.stringify(last) === JSON.stringify(expected)) return last;
      await sleep(220);
    }
    throw new Error("持久化超时：" + label + "（期望 " + JSON.stringify(expected) + "，最后 " + JSON.stringify(last) + (err ? "，末次错误 " + err : "") + "）");
  };
  const reorderApi = ids => evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/tasks/${SNAP_TASK}/subtasks/reorder", { ids:${JSON.stringify(ids)} }))
    .then(a => ({ ok:true, ids:(a||[]).map(s => s.id) })).catch(e => ({ ok:false, code:e.code||null, msg:e.message||String(e) }))`);
  const putSub = (id, done) => evaluate(`import("./js/core/api.js").then(m => m.API.put("/api/subtasks/" + ${JSON.stringify(id)}, { done:${done ? "true" : "false"} }))
    .then(() => true).catch(e => ({ err:e.message||String(e) }))`);
  const apiTask = () => evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/task/${SNAP_TASK}?probe=" + Date.now()))
    .then(t => t ? { boardColumn:t.boardColumn||null, progress:t.progress, title:t.title, reqId:t.reqId||null } : null)`);

  /* ---------- 拖拽 ---------- */
  const gripRect = id => evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${id}"]'); if(!g) return null;
    try{ g.scrollIntoView({ block:"center" }); }catch(e){}
    const r = g.getBoundingClientRect(); return { x:r.left + r.width/2, y:r.top + r.height/2, w:r.width, h:r.height }; })()`);
  const rowRect = id => evaluate(`(() => { const el = document.querySelector('#subList .sub-item[data-sub="${id}"]'); if(!el) return null;
    const r = el.getBoundingClientRect(); return { x:r.left + r.width/2, y:r.top + r.height/2, top:r.top, h:r.height }; })()`);
  const dragState = () => evaluate(`(() => ({
    dragging:!!document.querySelector("#subList .sub-item.dragging"),
    before:[...document.querySelectorAll("#subList .sub-item.drop-before")].map(e => Number(e.dataset.sub)),
    after:[...document.querySelectorAll("#subList .sub-item.drop-after")].map(e => Number(e.dataset.sub)),
    order:[...document.querySelectorAll("#subList .sub-item")].map(e => Number(e.dataset.sub))
  }))()`);
  /* 把手按下 → 分段移动 → 落在目标行上沿；dispatch 用真实输入事件，走产品的 pointer 监听 */
  const dragGrip = async (fromId, toId, dispatch, mid) => {
    const a = await gripRect(fromId);
    if(!a) throw new Error("找不到把手 " + fromId);
    await sleep(180);
    const b = await rowRect(toId);
    if(!b) throw new Error("找不到目标行 " + toId);
    await dispatch("start", a.x, a.y);
    await sleep(70);
    for(let i = 1; i <= 6; i++){
      await dispatch("move", a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6);
      await sleep(45);
      if(i === 4 && mid) await mid("moving");
    }
    await dispatch("move", b.x, b.top + 2);
    await sleep(70);
    if(mid) await mid("dropping");
    await dispatch("end", b.x, b.top + 2);
    await sleep(340);
  };
  const mouseDispatch = (kind, x, y) => mouse(kind === "start" ? "mousePressed" : kind === "move" ? "mouseMoved" : "mouseReleased", x, y);
  /* 窄屏：headless 在 mobile emulation 下不把原始鼠标/触摸事件送到页面（dispatchTouchEvent 还会卡住不回 ack）。
     改为在页面内合成 PointerEvent(pointerType=touch) 打到真实把手节点上，走的仍是产品自己的 pointer 监听；
     下面用捕获到的 pointerType 与 computed touch-action 证明走的是触摸分支。 */
  const synthDispatch = id => (kind, x, y) => evaluate(`(() => {
    const g = document.querySelector('[data-sub-grip="${id}"]'); if(!g) return false;
    const type = ${JSON.stringify(kind)} === "start" ? "pointerdown" : (${JSON.stringify(kind)} === "move" ? "pointermove" : "pointerup");
    g.dispatchEvent(new PointerEvent(type, { bubbles:true, cancelable:true, pointerId:1, pointerType:"touch",
      isPrimary:true, button:0, buttons:${kind === "end" ? 0 : 1}, clientX:${Math.round(x)}, clientY:${Math.round(y)} }));
    return true;
  })()`);

  const setVP = async (w, h, mobile) => {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
    await call("Emulation.setTouchEmulationEnabled", { enabled: !!mobile, maxTouchPoints: 1 });
    await sleep(260);
  };
  const restoreDesktop = async () => {
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call("Emulation.setTouchEmulationEnabled", { enabled: false });
    await sleep(250);
    await call("Emulation.clearDeviceMetricsOverride", {});
    await sleep(250);
  };

  /* ---------- 运行前基线（收尾按它复位） ---------- */
  await login(USER, PASS);
  const origSubs = await serverSubs();
  const origTask = await apiTask();
  const origIds = origSubs.map(s => s.id);
  console.log("基线：检查项 " + JSON.stringify(origSubs) + "；工作项 " + JSON.stringify(origTask));
  assert(origIds.length === 3, "样本工作项有 3 条检查项（实际 " + origIds.length + "）");

  /* ===================== A 结构与无障碍 ===================== */
  await section("[A] 结构：把手 / aria / 读态同序", async () => {
    await openExec(SNAP_TASK);
    const rs = await rows();
    assert(rs.length === 3 && rs.every(r => r.grip), "每行一个拖拽把手（3 行 3 把手）");
    const gripInfo = await evaluate(`[...document.querySelectorAll("#subList .sub-grip")].map(g => ({
      tag:g.tagName, type:g.getAttribute("type"), label:g.getAttribute("aria-label")||"", title:g.getAttribute("title")||"",
      svg:!!g.querySelector("svg"), w:g.getBoundingClientRect().width, h:g.getBoundingClientRect().height }))`);
    assert(gripInfo.every(g => g.tag === "BUTTON" && g.type === "button" && g.svg), "把手是原生 button + 图标（可聚焦、可键盘操作）");
    assert(gripInfo.every((g, i) => g.label.indexOf("第 " + (i + 1) + " 项，共 3 项") >= 0 && /上下方向键/.test(g.label)),
      "aria-label 带位置与操作语义：" + gripInfo[0].label);
    assert(gripInfo.every(g => /拖拽调整顺序/.test(g.title)), "把手 title 提示拖拽与 ↑/↓");
    assert(gripInfo.every(g => g.w >= 22 && g.h >= 22), "桌面把手命中区 ≥22px（实际 " + gripInfo[0].w + "×" + gripInfo[0].h + "）");
    const live = await evaluate(`(() => { const el = document.getElementById("subLive");
      return el ? { live:el.getAttribute("aria-live"), hidden:el.closest("[hidden]") !== null } : null; })()`);
    assert(live && live.live === "polite", "排序播报区 aria-live=polite");
    assert(await evaluate(`(document.getElementById("subCount")||{}).textContent`) === "3/3", "完成计数 3/3");
    const hint = await evaluate(`(() => { const el = document.getElementById("subHint");
      return el ? { hidden:el.hidden, text:el.textContent || "" } : null; })()`);
    assert(hint && !hint.hidden && /拖把手或聚焦后按 ↑\/↓ 调整顺序/.test(hint.text), "清单上方可见排序提示（对照原型）：" + (hint && hint.text));
    assert(JSON.stringify(await domOrder()) === JSON.stringify(origIds), "初始顺序为服务端 sort_order 序");
    assert(JSON.stringify(await readOrder()) === JSON.stringify(origIds), "概览读态清单与执行页同序");
    const cbx = await evaluate(`[...document.querySelectorAll("#subList [data-sub-toggle]")].every(c => !c.disabled)`);
    assert(cbx === true, "可写项目勾选框未被把手影响（仍可勾）");
    await shot("a-desktop-card");
    /* 编辑态同样给把手（读态/编辑态共用一份清单渲染） */
    await evaluate(`(() => { const b = document.getElementById("btnDrawerEdit"); if(b && !b.hidden) b.click(); return true; })()`);
    await sleep(320);
    await gotoTab("exec");
    assert((await rows()).every(r => r.grip), "编辑态同样有把手");
    assert(await evaluate(`!document.getElementById("iSubNew").disabled`) === true, "编辑态可添加检查项");
    await shot("a-desktop-edit");
    await evaluate(`(() => { const b = document.getElementById("btnCancelTask"); if(b) b.click(); return true; })()`);
    await sleep(260);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm");
      if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(200);
    await gotoTab("exec");
  });

  /* ===================== B 拖拽重排 ===================== */
  let dragged = null;
  await section("[B] 拖拽：乐观重排 → 落库 → 读态同序 → 刷新仍在", async () => {
    const from = origIds[2], to = origIds[0];
    const expect = [from, origIds[0], origIds[1]];
    const midStates = [];
    await dragGrip(from, to, mouseDispatch, async phase => {
      const st = await dragState();
      midStates.push({ phase, ...st });
      if(phase === "moving") await shot("b-desktop-dragging");
    });
    dragged = expect;
    const moving = midStates.filter(s => s.phase === "moving")[0];
    assert(moving && moving.dragging, "拖拽中被拖行有 dragging 态");
    assert(moving && (moving.before.length + moving.after.length) > 0, "拖拽中目标行有落点指示线（drop-before/after）");
    assert(JSON.stringify(await domOrder()) === JSON.stringify(expect), "松手后 DOM 立即按新顺序排列（乐观更新）");
    assert(JSON.stringify(await cacheOrder()) === JSON.stringify(expect), "本地缓存同步为新顺序");
    const st = await dragState();
    assert(!st.dragging && st.before.length === 0 && st.after.length === 0, "拖拽结束清理 dragging 与落点指示");
    assert(/第 1 项，共 3 项/.test(await liveText()), "aria-live 播报移动结果：" + (await liveText()));
    await waitServerOrder(expect, "拖拽落库");
    const sv = await serverSubs();
    assert(JSON.stringify(sv.map(s => s.order)) === JSON.stringify([0, 1, 2]), "服务端 sort_order 重编号为 0/1/2（实际 " + JSON.stringify(sv.map(s => s.order)) + "）");
    assert(JSON.stringify(sv.map(s => s.done)) === JSON.stringify(origSubs.map(s => s.done)), "重排不改勾选态");
    await gotoTab("overview");
    assert(JSON.stringify(await readOrder()) === JSON.stringify(expect), "概览读态清单跟随新顺序");
    const readTitles = await evaluate(`[...document.querySelectorAll("#readChecklist li span")].map(e => e.textContent)`);
    const execTitles = (await serverSubs()).map(s => s.title);
    assert(JSON.stringify(readTitles) === JSON.stringify(execTitles), "概览读态标题顺序与服务端一致");
    await shot("b-desktop-read-sync");
    /* 整页刷新后仍在：证明不是只改了前端缓存 */
    await call("Page.navigate", { url: BASE + "/?probe=" + Date.now() });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "刷新后初始化", 20000);
    await watchToasts();
    await openExec(SNAP_TASK);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(expect), "整页刷新后顺序仍为拖拽后的顺序");
    await shot("b-desktop-after-reload");
  });

  /* ===================== C 键盘 ===================== */
  await section("[C] 键盘：↑/↓ 移动 + 焦点保持 + 边界不动", async () => {
    const base = dragged || origIds;
    const focusId = base[1];
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${focusId}"]'); if(g) g.focus(); return true; })()`);
    assert(await evaluate(`document.activeElement && document.activeElement.dataset.subGrip`) === String(focusId), "把手可聚焦");
    await pressArrow("ArrowUp");
    await sleep(420);
    const up = [base[1], base[0], base[2]];
    assert(JSON.stringify(await domOrder()) === JSON.stringify(up), "按 ↑ 上移一位");
    assert(await evaluate(`document.activeElement && document.activeElement.dataset.subGrip`) === String(focusId), "重渲染后焦点回到同一把手");
    assert(/第 1 项，共 3 项/.test(await liveText()), "键盘移动同样播报：" + (await liveText()));
    await waitServerOrder(up, "键盘上移落库");
    await shot("c-desktop-keyboard");
    await pressArrow("ArrowDown");
    await sleep(420);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(base), "按 ↓ 移回原位");
    await waitServerOrder(base, "键盘下移落库");
    /* 边界：首行按 ↑ 不动，也不该发排序请求 */
    const before = await serverSubs();
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[0]}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowUp");
    await sleep(420);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(base), "首行按 ↑ 不动（无越界）");
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[2]}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowDown");
    await sleep(420);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(base), "末行按 ↓ 不动（无越界）");
    const after = await serverSubs();
    assert(JSON.stringify(after) === JSON.stringify(before), "边界按键未改动服务端");
    assert(BAD_TOASTS.length === 0 && (await evaluate(`(window.__badToasts||[]).length`)) === 0, "键盘操作全程无错误 toast");
  });

  /* ===================== D 失败回滚 ===================== */
  await section("[D] 失败：只还原顺序 + 保留当前勾选 + 诚实报错", async () => {
    const base = dragged || origIds;
    /* 先改一个勾选态：回滚只还原顺序，不能把旧勾选态复活 */
    const toggleId = base[1];
    const beforeToggle = (await serverSubs()).filter(s => s.id === toggleId)[0].done;
    await evaluate(`(() => { const c = document.querySelector('[data-sub-toggle="${toggleId}"]'); if(c) c.click(); return true; })()`);
    await waitFor(`import("./js/core/api.js").then(m => m.API.getAllPages("/api/tasks/${SNAP_TASK}/subtasks", { probe:Date.now() }))
      .then(a => a.filter(s => s.id === ${toggleId})[0].done === ${!beforeToggle})`, "勾选态落库", 10000);
    const before = await serverSubs();
    const expectDone = before.map(s => s.done);
    /* 注入 reorder 失败：只拦排序接口，其余请求照常。
       延迟 600ms 再回失败，留出可观察的乐观重排窗口（真实网络也有往返时间）。 */
    await evaluate(`(() => {
      window.__origFetch = window.fetch; window.__failHits = 0;
      window.fetch = function(url, opts){
        if(String(url).indexOf("/subtasks/reorder") !== -1){
          window.__failHits++;
          return new Promise(res => setTimeout(() => res(new Response(
            JSON.stringify({ code:500, message:"模拟排序失败（E2E 注入）" }),
            { status:500, headers:{ "Content-Type":"application/json" } })), 600));
        }
        return window.__origFetch.apply(this, arguments);
      };
      return true;
    })()`);
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[0]}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowDown");
    await sleep(120);
    const optimistic = await domOrder();
    assert(JSON.stringify(optimistic) !== JSON.stringify(base), "失败前先乐观重排（用户立刻看到移动）");
    await waitFor(`JSON.stringify([...document.querySelectorAll("#subList .sub-item")].map(e => Number(e.dataset.sub))) === JSON.stringify(${JSON.stringify(base)})`, "失败后回滚到原顺序", 8000);
    await sleep(250);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(base), "失败后还原为手势前顺序");
    assert(JSON.stringify(await cacheOrder()) === JSON.stringify(base), "本地缓存一并还原");
    const nowRows = await rows();
    assert(JSON.stringify(nowRows.map(r => r.done)) === JSON.stringify(expectDone), "只还原顺序：当前勾选态未被旧快照复活");
    await drainInto(EXPECT_TOASTS);
    assert(EXPECT_TOASTS.length === 1 && /排序失败，已还原为原顺序/.test(EXPECT_TOASTS[0]) && /模拟排序失败/.test(EXPECT_TOASTS[0]),
      "诚实报错并说明已还原：" + JSON.stringify(EXPECT_TOASTS));
    assert((await liveText()) === "", "失败后清空播报（不谎报成功）");
    assert(await evaluate(`document.activeElement && document.activeElement.dataset.subGrip`) === String(base[0]), "失败后焦点仍在原把手");
    await shot("d-desktop-fail", true);
    const after = await serverSubs();
    assert(JSON.stringify(after.map(s => s.id)) === JSON.stringify(base) && JSON.stringify(after.map(s => s.done)) === JSON.stringify(expectDone),
      "服务端未被失败的手势改动");
    /* 撤注入 + 恢复勾选态 */
    await evaluate(`(() => { if(window.__origFetch){ window.fetch = window.__origFetch; delete window.__origFetch; } return true; })()`);
    await evaluate(`(() => { const c = document.querySelector('[data-sub-toggle="${toggleId}"]'); if(c) c.click(); return true; })()`);
    await waitFor(`import("./js/core/api.js").then(m => m.API.getAllPages("/api/tasks/${SNAP_TASK}/subtasks", { probe:Date.now() }))
      .then(a => a.filter(s => s.id === ${toggleId})[0].done === ${beforeToggle})`, "勾选态复位", 10000);
    await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`);
    await drainInto(EXPECT_TOASTS);
    /* 撤注入后排序恢复可用 */
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[2]}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowUp");
    await sleep(420);
    const recovered = [base[0], base[2], base[1]];
    await waitServerOrder(recovered, "撤注入后排序恢复");
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[2]}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowDown");
    await sleep(420);
    await waitServerOrder(base, "恢复后移回原位");
    assert(EXPECT_TOASTS.length === 1, "撤注入后不再出现失败提示");
  });

  /* ===================== E 新增追加末尾 ===================== */
  await section("[E] 新增追加末尾 + 计数 + 删除复位", async () => {
    const base = dragged || origIds;
    await evaluate(`(() => { const i = document.getElementById("iSubNew");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(NEW_TITLE)});
      i.dispatchEvent(new Event("input", { bubbles:true })); i.focus(); return true; })()`);
    await pressEnter();
    await waitFor(`document.querySelectorAll("#subList .sub-item").length === 4`, "新检查项出现", 10000);
    await sleep(320);
    const sv = await serverSubs();
    assert(sv.length === 4 && sv[3].title === NEW_TITLE, "新检查项追加在末尾（服务端第 4 位）");
    assert(sv[3].order === 3 && JSON.stringify(sv.map(s => s.order)) === JSON.stringify([0, 1, 2, 3]),
      "新项 sort_order = 现有最大值 + 1（实际 " + JSON.stringify(sv.map(s => s.order)) + "）");
    assert(JSON.stringify(await domOrder()) === JSON.stringify(sv.map(s => s.id)), "界面顺序与服务端一致");
    assert(await evaluate(`(document.getElementById("subCount")||{}).textContent`) === "3/4", "计数同步 3/4");
    assert(await evaluate(`(document.getElementById("iSubNew")||{}).value`) === "", "添加后输入框清空");
    const newGrip = await evaluate(`(() => { const g = document.querySelector('#subList .sub-item:last-child .sub-grip');
      return g ? g.getAttribute("aria-label") : ""; })()`);
    assert(/第 4 项，共 4 项/.test(newGrip), "新项把手 aria-label 位置正确：" + newGrip);
    await shot("e-desktop-appended");
    /* 新增后仍可拖拽：把新项拖到首位再拖回末尾 */
    const newId = sv[3].id;
    await dragGrip(newId, sv[0].id, mouseDispatch, null);
    const moved = [newId, sv[0].id, sv[1].id, sv[2].id];
    await waitServerOrder(moved, "新项拖到首位");
    await dragGrip(newId, sv[2].id, mouseDispatch, null);
    /* 落到末行下半区 → 排在最后 */
    const tail = await rowRect(sv[2].id);
    await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${newId}"]'); if(g) g.focus(); return true; })()`);
    await pressArrow("ArrowDown");
    await sleep(420);
    await waitServerOrder([sv[0].id, sv[1].id, sv[2].id, newId], "新项回到末尾");
    assert(tail && tail.h > 0, "末行可定位（拖回末尾用）");
    /* 删除新项复位 */
    await evaluate(`(() => { const b = document.querySelector('[data-sub-del="${newId}"]'); if(b) b.click(); return true; })()`);
    await waitFor(`document.querySelectorAll("#subList .sub-item").length === 3`, "新检查项已删除", 10000);
    await sleep(300);
    assert(JSON.stringify(await serverOrder()) === JSON.stringify(base), "删除后回到原 3 条与原顺序");
    assert(await evaluate(`(document.getElementById("subCount")||{}).textContent`) === "3/3", "计数复位 3/3");
  });

  /* ===================== F 只读与服务端拒绝 ===================== */
  await section("[F] 只读态无把手 + 服务端拒绝非法排序", async () => {
    const base = dragged || origIds;
    /* 空间 viewer：全项目只读 */
    await login(VIEWER, PASS);
    await openExec(SNAP_TASK);
    assert(await evaluate(`import("./js/core/state.js").then(s => s.rt.drawerReadOnly)`) === true, "viewer 打开为只读");
    const ro = await evaluate(`(() => ({
      grips:document.querySelectorAll("#subList .sub-grip").length,
      dels:document.querySelectorAll("#subList .sub-del").length,
      disabled:[...document.querySelectorAll("#subList [data-sub-toggle]")].every(c => c.disabled),
      newDisabled:document.getElementById("iSubNew").disabled,
      placeholder:document.getElementById("iSubNew").placeholder,
      items:document.querySelectorAll("#subList .sub-item").length
    }))()`);
    assert(ro.items === 3 && ro.grips === 0 && ro.dels === 0, "只读不给把手也不给删除（清单仍可看）");
    assert(ro.disabled && ro.newDisabled && /只读项目不可添加检查项/.test(ro.placeholder), "只读勾选禁用 + 添加框禁用并改文案");
    const roHint = await evaluate(`(() => { const el = document.getElementById("subHint");
      return el ? { hidden:el.hidden, text:el.textContent || "" } : null; })()`);
    assert(roHint && !roHint.hidden && /只读项目：可查看清单，不能排序/.test(roHint.text), "只读提示改为不可排序（对照原型）：" + (roHint && roHint.text));
    assert(JSON.stringify(await domOrder()) === JSON.stringify(base), "只读看到的顺序与可写成员一致");
    await gotoTab("overview");
    assert(await evaluate(`[...document.querySelectorAll("#readChecklist [data-read-sub-toggle]")].every(c => c.disabled)`) === true, "只读概览清单勾选禁用");
    await shot("f-desktop-readonly-viewer");
    await closeDrawer();

    /* 项目只读成员（空间可写、该项目 read）：同样无把手，且绕过界面直接写被拒 */
    await login(HALF, PASS);
    await openExec(SNAP_TASK);
    assert(await evaluate(`import("./js/core/state.js").then(s => s.rt.drawerReadOnly)`) === true, "项目只读成员打开为只读");
    assert(await evaluate(`document.querySelectorAll("#subList .sub-grip").length`) === 0, "项目只读成员无把手");
    await shot("f-desktop-readonly-half");
    denialBudget++;
    const denied = await reorderApi([base[2], base[1], base[0]]);
    assert(denied.ok === false && denied.code === 403 && /查看权限/.test(denied.msg || ""),
      "只读成员绕过界面直接 POST reorder 被服务端拒（403）：" + JSON.stringify(denied));
    assert(JSON.stringify(await serverOrder()) === JSON.stringify(base), "被拒的排序未改动服务端");
    await closeDrawer();

    /* 可写成员提交非法排列：漏项 / 重复 / 跨任务 id 一律 400，且不落库 */
    await login(USER, PASS);
    const probes = [
      { label: "漏项", ids: [base[0], base[1]] },
      { label: "重复", ids: [base[0], base[0], base[1]] },
      { label: "跨任务 id", ids: [base[0], base[1], 999999999] }
    ];
    for(const p of probes){
      denialBudget++;
      const r = await reorderApi(p.ids);
      assert(r.ok === false && r.code === 400 && /排序清单与当前检查项不一致/.test(r.msg || ""),
        "非法排列被拒（" + p.label + "，400）：" + JSON.stringify(r));
    }
    assert(JSON.stringify(await serverOrder()) === JSON.stringify(base), "三次非法排列均未改动服务端顺序");
    const sv = await serverSubs();
    assert(JSON.stringify(sv.map(s => s.order)) === JSON.stringify([0, 1, 2]), "非法排列未污染 sort_order");
    /* 审计留痕：合法重排写一条「调整检查项顺序」 */
    const logged = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/${SNAP_TASK}/logs?limit=50&probe=" + Date.now()))
      .then(r => (r.items||[]).filter(l => (l.detail||"").indexOf("调整检查项顺序") >= 0).length)`);
    assert(logged >= 1, "合法重排在动态里留痕「调整检查项顺序」（" + logged + " 条）");
  });

  /* ===================== G 移动端 ===================== */
  await section("[G] 移动端 390：触摸拖拽 + 命中区", async () => {
    const base = dragged || origIds;
    await setVP(390, 844, true);
    await openExec(SNAP_TASK);
    await evaluate(`(() => { window.__ptrTypes = []; const l = document.getElementById("subList");
      if(l) l.addEventListener("pointerdown", e => window.__ptrTypes.push(e.pointerType), true); return true; })()`);
    const mHint = await evaluate(`(() => { const el = document.getElementById("subHint");
      return el ? getComputedStyle(el).display : null; })()`);
    assert(mHint === "none", "窄屏隐藏排序提示省纵向空间（对照原型窄屏隐藏）");
    await shot("g-mobile-card");
    const size = await gripRect(base[0]);
    assert(size && size.w >= 24 && size.h >= 24, "移动端把手命中区 ≥24px（实际 " + (size ? size.w + "×" + size.h : "无") + "）");
    const touchCss = await evaluate(`(() => { const g = document.querySelector('[data-sub-grip="${base[0]}"]');
      if(!g) return null; const cs = getComputedStyle(g); const r = g.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
      return { action:cs.touchAction, cursor:cs.cursor, hitIsGrip:!!(hit && hit.closest && hit.closest("[data-sub-grip]")) }; })()`);
    assert(touchCss && touchCss.action === "none", "把手 touch-action:none（触摸拖拽不被页面滚动抢走）");
    assert(touchCss && touchCss.hitIsGrip, "窄屏把手中心命中的就是把手（无遮挡/裁切）");
    const expect = [base[2], base[0], base[1]];
    const midStates = [];
    await dragGrip(base[2], base[0], synthDispatch(base[2]), async phase => {
      const st = await dragState();
      midStates.push({ phase, ...st });
      if(phase === "moving") await shot("g-mobile-dragging");
    });
    assert(midStates.some(s => s.dragging), "触摸拖拽同样进入 dragging 态");
    const ptrTypes = await evaluate(`window.__ptrTypes || []`);
    assert(ptrTypes.indexOf("touch") >= 0, "窄屏走的是触摸指针（pointerType=touch，实际 " + JSON.stringify(ptrTypes) + "）");
    assert(JSON.stringify(await domOrder()) === JSON.stringify(expect), "移动端触摸拖拽重排生效");
    await waitServerOrder(expect, "移动端拖拽落库");
    assert(/第 1 项，共 3 项/.test(await liveText()), "移动端同样播报移动结果");
    await shot("g-mobile-saved");
    await gotoTab("overview");
    assert(JSON.stringify(await readOrder()) === JSON.stringify(expect), "移动端概览清单同序");
    await closeDrawer();
    await restoreDesktop();
  });

  /* ===================== 收尾 ===================== */
  console.log("\n[收尾] 控制台 / 网络 / 复位");
  await sleep(400);
  assert(cdp.errors.length === 0, "控制台零报错" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 6).join(" | ") : ""));
  assert(cdp.netErrors.length === 0, "无 4xx/5xx 网络错误（已知环境缺口与登记的拒绝探针除外）" + (cdp.netErrors.length ? "：" + cdp.netErrors.slice(0, 6).join(" | ") : ""));
  assert(cdp.denials.length === denialBudget, "拒绝探针按预期被服务端拒（记录 " + cdp.denials.length + " 次 / 登记 " + denialBudget + " 次）" +
    (cdp.denials.length ? "：" + cdp.denials.join(" | ") : ""));
  const resWithUrl = cdp.resourceErrors.filter(t => /https?:\/\//.test(t));
  const resUnknown = resWithUrl.filter(t => !isKnownGap(t));
  const resNoUrl = cdp.resourceErrors.length - resWithUrl.length;
  assert(resUnknown.length === 0 && resNoUrl <= cdp.knownGaps.length + cdp.denials.length,
    "资源加载报错全部归因到已知环境缺口或登记探针（未知 " + resUnknown.length + "，无 URL " + resNoUrl + " / 缺口 " + cdp.knownGaps.length + " + 探针 " + cdp.denials.length + "）" +
    (resUnknown.length ? "：" + resUnknown.slice(0, 4).join(" | ") : ""));
  if(cdp.knownGaps.length) console.log("  环境缺口（非本次改动）：预览前端调用了运行 jar 里尚未打包的接口 → " +
    [...new Set(cdp.knownGaps.map(s => s.split(" ")[1].replace(/^https?:\/\/[^/]+/, "")))].join("、") + "（共 " + cdp.knownGaps.length + " 次）");

  /* 复位：顺序 + 勾选态回到运行前原值，工作项本身未被改动 */
  try{
    await login(USER, PASS);
    const back = await reorderApi(origIds);
    assert(back.ok === true, "收尾复位排序调用成功：" + JSON.stringify(back));
    for(const s of origSubs){
      const cur = (await serverSubs()).filter(x => x.id === s.id)[0];
      if(cur && cur.done !== s.done) await putSub(s.id, s.done);
    }
    const fin = await serverSubs();
    assert(JSON.stringify(fin.map(s => s.id)) === JSON.stringify(origIds), "检查项顺序已复位原始（" + JSON.stringify(fin.map(s => s.id)) + "）");
    assert(JSON.stringify(fin.map(s => s.done)) === JSON.stringify(origSubs.map(s => s.done)), "检查项勾选态已复位原始");
    assert(JSON.stringify(fin.map(s => s.order)) === JSON.stringify([0, 1, 2]), "sort_order 复位为 0/1/2");
    assert(fin.every(s => s.title !== NEW_TITLE), "E2E 自建检查项已删除（不留残留）");
    const finTask = await apiTask();
    assert(JSON.stringify(finTask) === JSON.stringify(origTask), "工作项本身未被改动（列/进度/标题/所属项目）：" + JSON.stringify(finTask));
    await openExec(SNAP_TASK);
    assert(JSON.stringify(await domOrder()) === JSON.stringify(origIds), "界面复位后回到原始顺序");
    await shot("z-desktop-reset");
    await closeDrawer();
  }catch(e){ console.log("  WARN 复位确认失败：" + e.message + "（运行后可 DB 兜底复位 subtask.sort_order）"); }
  await drainBad();
  assert(BAD_TOASTS.length === 0, "无非预期红色错误 toast" + (BAD_TOASTS.length ? "：" + BAD_TOASTS.slice(0, 6).join(" | ") : ""));

  console.log("\n截图：" + SHOTS.length + " 张");
  SHOTS.forEach(s => console.log("  " + s));
  console.log("\n结果：" + (failed === 0 ? "全部通过" : failed + " 项失败"));
  await call("Browser.close").catch(() => {});
  ws.close();
  proc.kill();
  process.exit(failed === 0 ? 0 : 1);
}catch(err){
  console.error("E2E 运行异常：" + (err && err.stack || err));
  try{ proc.kill(); }catch(e){}
  process.exit(2);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
