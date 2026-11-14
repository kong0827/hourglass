/* P0+P1 关联跳转 E2E 验证（仿 tools/e2e/tree-view.mjs，Node 18+ 原生 CDP）
   覆盖：
     P0-1 交付说明证据跳转按钮（data-dl-act=goto）真的跳转、不再污染 evidence 选项 / 误标脏
     P0-2 层级状态 chip 点开是列菜单（不是抽屉）、键盘 Enter 可达、改列后层级实时刷新
     P1-A 发布快照工作项 / 需求可点跳转（真实版本 + 真实需求；含单工作项模式与空需求的结构断言）
     P1-B 工作项抽屉依赖行对端标题可点跳转
     P1-C 甘特依赖线 → 菜单 → 两端工作项可点跳转
   数据：支付业务部（Smw9zcftmwwnrwuon）演示库。运行前需 8082 预览 + 8090 后端在线。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";

/* 演示数据所在空间与已核实的真实记录 */
const WS = "Smw9zcftmwwnrwuon";                 // 支付业务部
const PROJ = "R4ohfd6ha97zjtedr3ogg";           // 清结算与对账平台
const VER = "Voqh4tnoq3262hmplci2e";            // 清结算 v3.0
const REL = "RL79ih44mruend4iagle03";           // 生产成功发布记录
const SNAP_TASK = "Kr9vof65na3g5h4130i38";      // 差错工单自动分派（快照首项）
const DEMAND = "D4b6yvznsd0u1qrtuoxeo";         // 结算单 PDF 模板改版（真实需求）
const DEMAND_TITLE = "结算单 PDF 模板改版";
const DEP_TASK = "Kyvn879tzfenbyy4iqxf7";       // SFTP 连接超时无重试（依赖后置）
const DEP_OTHER = "Kufyicaf2kpsmtvm7i7bv";      // 结算单模板渲染（依赖前置）
const DEP_OTHER_TITLE = "结算单模板渲染";

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

/* 预览直供的前端比运行中的 jar 新：文档分类/测试模块接口源码里已有、jar 里还没打进去。
   这类 404 属环境差异，单独归桶如实报出，不算本次改动的回归。 */
const KNOWN_GAP_APIS = ["/api/doc-categories", "/api/test-modules"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
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
      if(r.status >= 400 && isKnownGap(r.url)) this.knownGaps.push(r.status + " " + r.url);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      (/Failed to load resource/.test(text) ? this.resourceErrors : this.errors).push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")) this.resourceErrors.push("resource: " + (e.url || "") + " " + e.text);
      else this.errors.push("log: " + e.text);
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
const port = Number(process.env.E2E_PORT || 9444);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "assoc-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];

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
  /* 预览静态文件 no-cache，但 SW 可能回旧版；整段会话绕过 Service Worker 保证拿到当前源码 */
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    const s = await call("Page.captureScreenshot", { format: "png" });
    const out = "/tmp/hg-assoc-" + name + ".png";
    fs.writeFileSync(out, Buffer.from(s.data, "base64"));
    SHOTS.push(out);
  };
  const apiGet = async url => evaluate(`import("./js/core/api.js").then(m => m.API.get(${JSON.stringify(url)}))`);
  const closeDrawer = async () => {
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
    await sleep(250);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm"); if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(150);
  };
  const closeDemand = async () => {
    await evaluate(`(() => { const b = document.querySelector(".demand-detail [data-dem-x]"); if(b) b.click(); return true; })()`);
    await sleep(250);
  };
  const drawerTask = () => evaluate(`import("./js/core/state.js").then(s => s.rt.editingId)`);
  const activeView = () => evaluate(`import("./js/core/router.js").then(s => s.activeView)`);
  /* 真实按键（原生 button 的 Enter/Space 激活靠真实键事件，合成 KeyboardEvent 不触发 click） */
  const pressEnter = async () => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  };
  /* 改列可能触发「强制移动」确认或「填写原因」弹窗，统一替用户确认，保证流程走完 */
  const settleMoveDialogs = async () => {
    await evaluate(`(() => {
      const d = document.getElementById("dlgConfirm");
      if(d && d.classList.contains("open")){ const ok = document.getElementById("dlgConfirmOk"); if(ok) ok.click(); return "confirm"; }
      const layer = [...document.querySelectorAll(".modal-layer")].find(l => l.querySelector("form input, form textarea") && l.offsetWidth > 0);
      if(layer){ const inp = layer.querySelector("input,textarea"); inp.value = "E2E 验证改列联动"; const ok = layer.querySelector('button[type="submit"]'); if(ok) ok.click(); return "prompt"; }
      return "";
    })()`);
  };

  console.log("P0+P1 关联跳转 E2E\n  地址：" + BASE);
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
  try{
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  pass("登录 " + USER);

  /* 确保落在演示数据空间（支付业务部）；若不在则 select + reload */
  let curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
  if(curWs !== WS){
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
    curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
  }
  assert(curWs === WS, "当前空间为支付业务部（" + curWs + "）");
  /* 确认拿到的是含本次改动的源码（绕过 SW 后由预览直供） */
  const servedHasSnap = await evaluate(`fetch("./js/lib/format.js?probe=" + Date.now()).then(r => r.text()).then(t => t.indexOf("data-snap-task") !== -1)`);
  assert(servedHasSnap, "预览直供的 format.js 含 data-snap-task（本次改动已生效）");

  /* ===================== P0-2 层级状态 chip =====================
     在手机端层级验证：卡片行恒带状态 chip（taskCell column），与桌面共用同一点击/键盘 handler；
     桌面 chip 取决于「看板列」显示字段是否开启（当前管理员偏好未开启），故选用恒渲染的手机端。 */
  console.log("\n[P0-2] 层级状态 chip 联动（手机端卡片行）");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`location.hash = "#/tree"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "tree" && document.querySelectorAll("#view-tree .tree-mob-row[data-tree-id]").length > 0`, "手机端层级渲染", 20000);
  const chipInfo = await evaluate(`(() => {
    const b = document.querySelector("#view-tree button.row-status[data-row-status]");
    if(!b) return null;
    return { id: b.dataset.rowStatus, label: b.textContent.trim() };
  })()`);
  assert(!!chipInfo, "层级存在可写状态 chip（" + (chipInfo ? chipInfo.id + " / " + chipInfo.label : "无") + "）");
  if(chipInfo){
    /* 点击 chip → 列菜单弹出，且不是打开抽屉 */
    await evaluate(`document.querySelector("#view-tree button.row-status[data-row-status]").click(); true`);
    await waitFor(`!!document.querySelector(".menu.status-menu")`, "状态列菜单弹出", 6000);
    const menuOk = await evaluate(`(() => {
      const m = document.querySelector(".menu.status-menu");
      const drawerOn = document.getElementById("taskDrawer").classList.contains("on");
      return { menu: !!m, items: m ? m.querySelectorAll("[data-status-to]").length : 0, drawerOn, role: m && m.getAttribute("role") };
    })()`);
    assert(menuOk.menu && menuOk.items > 0 && menuOk.role === "menu", `chip 点开是列菜单（${menuOk.items} 个目标列，role=menu）`);
    assert(!menuOk.drawerOn, "chip 点击没有误开工作项抽屉");
    await shot("p0-2-tree-status-menu");
    await evaluate(`import("./js/core/ui.js").then(m => m.UI.closeAllPops()); true`);
    await sleep(200);

    /* 键盘：聚焦 chip 后真实 Enter → 同样弹列菜单（原生 button 激活） */
    await evaluate(`(() => { const b = document.querySelector("#view-tree button.row-status[data-row-status]"); b.focus(); return document.activeElement === b; })()`);
    await pressEnter();
    await waitFor(`!!document.querySelector(".menu.status-menu")`, "键盘 Enter 弹出列菜单", 6000);
    const kbMenu = await evaluate(`!!document.querySelector(".menu.status-menu") && !document.getElementById("taskDrawer").classList.contains("on")`);
    assert(kbMenu, "键盘 Enter 激活 chip 弹列菜单（且未开抽屉）");
    await evaluate(`import("./js/core/ui.js").then(m => m.UI.closeAllPops()); true`);
    await sleep(200);

    /* 改列联动：从菜单选一个可去列 → 移动成功后层级实时刷新（chip 列名变化），再移回还原 */
    const before = await evaluate(`import("./js/core/state.js").then(s => { const t = s.rt.listCache[${JSON.stringify(chipInfo.id)}]; return t ? t.boardColumn : null; })`);
    await evaluate(`document.querySelector("#view-tree button.row-status[data-row-status]").click(); true`);
    await waitFor(`!!document.querySelector(".menu.status-menu")`, "改列菜单弹出", 6000);
    const target = await evaluate(`(() => {
      const m = document.querySelector(".menu.status-menu");
      const b = [...m.querySelectorAll("[data-status-to]")].find(x => !x.disabled);
      return b ? b.dataset.statusTo : null;
    })()`);
    if(target && before){
      await evaluate(`(() => { const m = document.querySelector(".menu.status-menu"); const b = [...m.querySelectorAll("[data-status-to]")].find(x => x.dataset.statusTo === ${JSON.stringify(target)}); b.click(); return true; })()`);
      /* 移动可能弹强制/原因框，循环替用户确认直到列缓存落地 */
      let landed = null;
      for(let i = 0; i < 40; i++){
        await settleMoveDialogs();
        landed = await evaluate(`import("./js/core/state.js").then(s => { const t = s.rt.listCache[${JSON.stringify(chipInfo.id)}]; return t ? t.boardColumn : null; })`);
        if(landed === target) break;
        await sleep(200);
      }
      assert(landed === target, `改列落地（${before} → ${landed}）`);
      /* 层级 chip 应随 refreshTreeIfOpen 重绘为新列名 */
      let chipLabel = "";
      for(let i = 0; i < 30; i++){
        chipLabel = await evaluate(`(() => { const b = document.querySelector("#view-tree button.row-status[data-row-status=" + ${JSON.stringify(chipInfo.id)} + "]"); return b ? b.textContent.trim() : ""; })()`);
        const colName = await evaluate(`import("./js/lib/format.js").then(m => m.colName(${JSON.stringify(target)}))`);
        if(chipLabel === colName) break;
        await sleep(200);
      }
      const expectName = await evaluate(`import("./js/lib/format.js").then(m => m.colName(${JSON.stringify(target)}))`);
      assert(chipLabel === expectName, `改列后层级 chip 实时刷新为「${chipLabel}」（refreshTreeIfOpen 生效）`);
      await shot("p0-2-tree-after-move");
      /* 还原：移回原列 */
      await evaluate(`(() => { const b = document.querySelector("#view-tree button.row-status[data-row-status=" + ${JSON.stringify(chipInfo.id)} + "]"); if(b) b.click(); return true; })()`);
      await waitFor(`!!document.querySelector(".menu.status-menu")`, "还原菜单弹出", 6000);
      await evaluate(`(() => { const m = document.querySelector(".menu.status-menu"); const b = [...m.querySelectorAll("[data-status-to]")].find(x => x.dataset.statusTo === ${JSON.stringify(before)}); if(b) b.click(); return true; })()`);
      let restored = null;
      for(let i = 0; i < 40; i++){
        await settleMoveDialogs();
        restored = await evaluate(`import("./js/core/state.js").then(s => { const t = s.rt.listCache[${JSON.stringify(chipInfo.id)}]; return t ? t.boardColumn : null; })`);
        if(restored === before) break;
        await sleep(200);
      }
      assert(restored === before, `已还原到原列（${restored}）`);
    }else{
      assert(false, "改列联动：菜单无可去目标列（target=" + target + ", before=" + before + "）");
    }
  }
  await call("Emulation.clearDeviceMetricsOverride", {});
  await sleep(200);

  /* ===================== P1-A 发布快照跳转 ===================== */
  console.log("\n[P1-A] 发布快照工作项 / 需求跳转");
  /* 结构断言：共享渲染器三种形态 */
  const struct = await evaluate(`import("./js/lib/format.js").then(m => {
    const rec = { id:"t1", result:"success", environment:"production", operation:"deploy", occurredAt:"2026-09-19T10:00:00", versionName:"清结算 v3.0",
      items:[{ taskId:${JSON.stringify(SNAP_TASK)}, title:"差错工单自动分派", demandId:${JSON.stringify(DEMAND)}, demandTitle:${JSON.stringify(DEMAND_TITLE)}, demandNo:"D-1" }] };
    const recNoDemand = { ...rec, items:[{ taskId:${JSON.stringify(SNAP_TASK)}, title:"差错工单自动分派", demandId:null, demandTitle:null }] };
    const both = m.releaseSnapshotHTML(rec);
    const single = m.releaseSnapshotHTML(rec, ${JSON.stringify(SNAP_TASK)});
    const noDem = m.releaseSnapshotHTML(recNoDemand);
    const has = (h, sel) => { const d = document.createElement("div"); d.innerHTML = h; return !!d.querySelector(sel); };
    return {
      bothTask: has(both, "[data-snap-task]"), bothDemand: has(both, "[data-snap-demand]"),
      singleTask: has(single, "[data-snap-task]"), singleDemand: has(single, "[data-snap-demand]"),
      noDemTask: has(noDem, "[data-snap-task]"), noDemDemand: has(noDem, "[data-snap-demand]")
    };
  })`);
  assert(struct.bothTask && struct.bothDemand, "快照（列表模式）工作项与需求都渲染为可点按钮");
  assert(!struct.singleTask && struct.singleDemand, "单工作项模式跳过工作项按钮、保留需求按钮（抽屉内不自跳）");
  assert(struct.noDemTask && !struct.noDemDemand, "需求为空时不渲染需求按钮（无死链）");

  /* 真实版本详情：展开快照 → 点工作项 → 抽屉打开该工作项 */
  await evaluate(`import("./js/views/version.js").then(m => m.openVersionDetail(${JSON.stringify(PROJ)}, ${JSON.stringify(VER)}, "releases")); true`);
  await waitFor(`document.body.dataset.view === "version" && document.querySelectorAll("#versionBody .release-record").length > 0`, "版本发布记录渲染", 20000);
  await evaluate(`(() => { const d = document.querySelector("#versionBody .release-record"); if(d) d.open = true; return true; })()`);
  await sleep(200);
  const snapTaskBtn = await evaluate(`(() => { const b = document.querySelector("#versionBody .release-record .snap-link[data-snap-task]"); return b ? b.dataset.snapTask : null; })()`);
  assert(!!snapTaskBtn, "真实发布快照含可点工作项（" + snapTaskBtn + "）");
  await shot("p1-a-version-snapshot");
  if(snapTaskBtn){
    await evaluate(`document.querySelector("#versionBody .release-record .snap-link[data-snap-task]").click(); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(snapTaskBtn)} && document.getElementById("taskDrawer").classList.contains("on"))`, "快照工作项抽屉打开", 10000);
    pass("点快照工作项 → 打开对应工作项抽屉（" + snapTaskBtn + "）");
    await shot("p1-a-task-drawer");
    await closeDrawer();
  }

  /* 真实需求跳转：现网快照 demandId 均为空，用共享渲染器 + 真实需求 id 端到端验证渲染→全局handler→需求详情 */
  await evaluate(`(() => {
    let s = document.getElementById("e2e-snap-scratch");
    if(!s){ s = document.createElement("div"); s.id = "e2e-snap-scratch"; s.style.cssText = "position:fixed;left:-99999px;top:0;width:800px"; document.body.appendChild(s); }
    return import("./js/lib/format.js").then(m => {
      const rec = { id:"e2e", result:"success", environment:"production", operation:"deploy", occurredAt:"2026-09-19T10:00:00", versionName:"清结算 v3.0",
        items:[{ taskId:${JSON.stringify(SNAP_TASK)}, title:"差错工单自动分派", demandId:${JSON.stringify(DEMAND)}, demandTitle:${JSON.stringify(DEMAND_TITLE)}, demandNo:"D-1" }] };
      s.innerHTML = m.releaseSnapshotHTML(rec);
      const d = s.querySelector(".release-record"); if(d) d.open = true;
      return true;
    });
  })()`);
  await sleep(200);
  const demBtn = await evaluate(`(() => { const b = document.querySelector("#e2e-snap-scratch .snap-link[data-snap-demand]"); return b ? b.dataset.snapDemand : null; })()`);
  assert(demBtn === DEMAND, "快照需求按钮指向真实需求（" + demBtn + "）");
  if(demBtn){
    await evaluate(`document.querySelector("#e2e-snap-scratch .snap-link[data-snap-demand]").click(); true`);
    await waitFor(`(() => { const l = document.querySelector(".demand-detail[data-ai-demand=" + ${JSON.stringify(DEMAND)} + "]"); return l && l.offsetWidth > 0; })()`, "需求详情打开", 10000);
    const demTitle = await evaluate(`(document.getElementById("demandDetailTitle") || {}).textContent || ""`);
    assert(demTitle === DEMAND_TITLE, `点快照需求 → 打开真实需求详情「${demTitle}」`);
    await shot("p1-a-demand-detail");
    await closeDemand();
  }
  await evaluate(`(() => { const s = document.getElementById("e2e-snap-scratch"); if(s) s.remove(); return true; })()`);

  /* ===================== P1-B 抽屉依赖行跳转 ===================== */
  console.log("\n[P1-B] 工作项抽屉依赖行对端跳转");
  await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(DEP_TASK)})); true`);
  await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(DEP_TASK)} && document.getElementById("taskDrawer").classList.contains("on"))`, "依赖工作项抽屉打开", 10000);
  await evaluate(`(() => { const b = document.querySelector("#taskForm [data-drawer-tab='exec']"); if(b) b.click(); return true; })()`);
  await waitFor(`!!document.querySelector("#fDeps [data-dep-open]")`, "依赖行渲染", 10000);
  const depBtn = await evaluate(`(() => { const b = document.querySelector("#fDeps [data-dep-open]"); return b ? { id: b.dataset.depOpen, text: b.textContent.trim(), tag: b.tagName } : null; })()`);
  assert(!!depBtn && depBtn.tag === "BUTTON", "依赖对端标题渲染为按钮（" + (depBtn ? depBtn.text : "无") + "）");
  assert(depBtn && depBtn.id === DEP_OTHER, `依赖按钮指向对端工作项（${depBtn ? depBtn.id : ""}）`);
  await shot("p1-b-drawer-deps");
  if(depBtn){
    await evaluate(`document.querySelector("#fDeps [data-dep-open]").click(); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(DEP_OTHER)})`, "跳转到对端工作项", 10000);
    pass("点依赖对端标题 → 抽屉切换到「" + DEP_OTHER_TITLE + "」（" + DEP_OTHER + "）");
    await shot("p1-b-dep-jumped");
    await closeDrawer();
  }

  /* ===================== P1-C 甘特依赖菜单跳转 =====================
     默认 showDone=false 会隐藏已完成工作项，而当前可渲染的依赖前驱多为已完成（9–10 月），
     依赖线两端都需有条才会画出。故先勾选「显示已完成」再等依赖线，测后复原。 */
  console.log("\n[P1-C] 甘特依赖线 → 菜单 → 工作项跳转");
  await evaluate(`import("./js/core/state.js").then(s => { s.state.reqs = []; }); true`);
  await evaluate(`location.hash = "#/gantt"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "gantt"`, "切换到甘特视图", 15000);
  await waitFor(`document.querySelectorAll(".gantt-bar").length > 0`, "甘特条渲染", 25000);
  await evaluate(`(() => { const cb = document.getElementById("ganttShowDone"); if(cb){ cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  await waitFor(`document.querySelectorAll(".gantt-dep[data-gantt-dep]").length > 0`, "甘特依赖线渲染（含已完成）", 25000);
  const depLine = await evaluate(`(() => { const p = document.querySelector(".gantt-dep[data-gantt-dep]"); return p ? { id: p.dataset.ganttDep, from: p.dataset.depFrom, to: p.dataset.depTo } : null; })()`);
  assert(!!depLine, "甘特存在可点依赖线（" + (depLine ? depLine.id : "无") + "）");
  await shot("p1-c-gantt-deps");
  if(depLine){
    await evaluate(`(() => { const p = document.querySelector(".gantt-dep[data-gantt-dep]"); p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); return true; })()`);
    await waitFor(`!!document.querySelector("#ganttDepMenu [data-gantt-dep-open]")`, "依赖菜单弹出", 8000);
    const menuBtns = await evaluate(`[...document.querySelectorAll("#ganttDepMenu [data-gantt-dep-open]")].map(b => b.dataset.ganttDepOpen)`);
    assert(menuBtns.length === 2, `依赖菜单两端都可点（${menuBtns.join(" → ")}）`);
    assert(menuBtns.includes(depLine.from) && menuBtns.includes(depLine.to), "菜单两端与依赖线 from/to 一致");
    await shot("p1-c-gantt-dep-menu");
    const jumpTo = menuBtns[0];
    await evaluate(`document.querySelector("#ganttDepMenu [data-gantt-dep-open]").click(); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(jumpTo)} && document.getElementById("taskDrawer").classList.contains("on"))`, "甘特依赖跳转开抽屉", 10000);
    pass("点依赖菜单端点 → 打开工作项抽屉（" + jumpTo + "）");
    await closeDrawer();
  }
  await evaluate(`(() => { const cb = document.getElementById("ganttShowDone"); if(cb){ cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
  await evaluate(`import("./js/core/state.js").then(s => { s.state.reqs = []; }); true`);

  /* ===================== P0-1 交付说明证据跳转 ===================== */
  console.log("\n[P0-1] 交付说明证据跳转（不污染 evidence / 不误标脏）");
  const evBefore = await apiGet(`/api/versions/${VER}/delivery-note`).then(d => d && d.options ? d.options.evidence : "n/a");
  assert(evBefore === 1 || evBefore === 0 || evBefore === 2, `跳转前 evidence 选项为合法数字（${evBefore}）`);
  await evaluate(`import("./js/views/delivery.js").then(m => m.openDeliveryNote(${JSON.stringify(VER)}, ${JSON.stringify(REL)})); true`);
  await waitFor(`document.body.dataset.view === "delivery" && document.querySelectorAll("#deliveryBody [data-dl-act='goto']").length > 0`, "交付说明证据跳转按钮渲染", 20000);
  const gotoBtn = await evaluate(`(() => {
    const b = [...document.querySelectorAll("#deliveryBody [data-dl-act='goto']")].find(x => x.dataset.dlView === "phase") || document.querySelector("#deliveryBody [data-dl-act='goto']");
    return b ? { act: b.dataset.dlAct, view: b.dataset.dlView, ref: b.dataset.dlRef, hasVal: b.hasAttribute("data-dl-val") } : null;
  })()`);
  assert(!!gotoBtn && gotoBtn.act === "goto" && !!gotoBtn.view, `证据按钮路由为 goto（view=${gotoBtn ? gotoBtn.view : ""}）`);
  assert(gotoBtn && !gotoBtn.hasVal, "证据跳转按钮不带 data-dl-val（不会误入 applyOption 把 evidence 写成 NaN）");
  const viewBeforeClick = await activeView();
  assert(viewBeforeClick === "delivery", "点击前停留在交付说明视图");
  await shot("p0-1-delivery-evidence");
  if(gotoBtn){
    await evaluate(`(() => { const b = [...document.querySelectorAll("#deliveryBody [data-dl-act='goto']")].find(x => x.dataset.dlView === ${JSON.stringify(gotoBtn.view)}) || document.querySelector("#deliveryBody [data-dl-act='goto']"); b.click(); return true; })()`);
    await waitFor(`import("./js/core/router.js").then(s => s.activeView === ${JSON.stringify(gotoBtn.view)})`, "证据跳转到原始记录视图", 15000);
    pass(`点证据跳转 → 落到「${gotoBtn.view}」视图（死按钮已修复）`);
    await shot("p0-1-after-goto");
    /* 跳转后重取交付说明：evidence 仍为合法数字，证明没有被写成 NaN 并误存 */
    const evAfter = await apiGet(`/api/versions/${VER}/delivery-note`).then(d => d && d.options ? d.options.evidence : "n/a");
    assert(evAfter === evBefore, `跳转后 evidence 选项未被污染（仍为 ${evAfter}，非 NaN/null）`);
  }

  /* ===================== 手机端截图 + 横向裁切 ===================== */
  console.log("\n[手机端] 关键界面截图与横向裁切");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(`location.hash = "#/tree"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "tree" && document.querySelectorAll("#view-tree .tree-mob-row, #view-tree .tree-row").length > 0`, "手机端层级渲染", 12000);
  const mobTree = await evaluate(`({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth })`);
  assert(mobTree.docW <= mobTree.innerW + 1, `手机端层级无横向裁切（${mobTree.docW}/${mobTree.innerW}）`);
  await shot("mobile-tree");
  await evaluate(`import("./js/views/version.js").then(m => m.openVersionDetail(${JSON.stringify(PROJ)}, ${JSON.stringify(VER)}, "releases")); true`);
  await waitFor(`document.body.dataset.view === "version" && document.querySelectorAll("#versionBody .release-record").length > 0`, "手机端版本发布渲染", 15000);
  await evaluate(`(() => { const d = document.querySelector("#versionBody .release-record"); if(d) d.open = true; return true; })()`);
  await sleep(200);
  const mobVer = await evaluate(`({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth })`);
  assert(mobVer.docW <= mobVer.innerW + 1, `手机端版本详情无横向裁切（${mobVer.docW}/${mobVer.innerW}）`);
  await shot("mobile-version-snapshot");
  await call("Emulation.clearDeviceMetricsOverride", {});

  /* ===================== 控制台报错 ===================== */
  console.log("");
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 400) + "）" : ""));
  const resWithUrl = cdp.resourceErrors.filter(t => /https?:\/\//.test(t));
  const resUnknown = resWithUrl.filter(t => !isKnownGap(t));
  const resNoUrl = cdp.resourceErrors.length - resWithUrl.length;
  assert(resUnknown.length === 0 && resNoUrl <= cdp.knownGaps.length,
    "资源加载报错全部归因到已知环境缺口（未知 " + resUnknown.length + "，无 URL " + resNoUrl + " / 缺口 " + cdp.knownGaps.length + "）" +
    (resUnknown.length ? "：" + resUnknown.slice(0, 4).join(" | ") : ""));
  if(cdp.knownGaps.length) console.log("  环境缺口（非本次改动）：预览前端调用了运行 jar 里尚未打包的接口 → " +
    [...new Set(cdp.knownGaps.map(s => s.split(" ")[1].replace(/^https?:\/\/[^/]+/, "").split("?")[0]))].join("、") +
    "（共 " + cdp.knownGaps.length + " 次）");
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log("\n截图：" + (SHOTS.join(", ") || "无"));
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);