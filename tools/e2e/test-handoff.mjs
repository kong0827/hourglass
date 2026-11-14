/* 测试交接（待测试 → 测试中 → 通过）E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8082/hourglass E2E_PASS=123456 node tools/e2e/test-handoff.mjs
   覆盖：提测时间落库、看板待领取条、我的工作「待我测试」认领、抽屉通过并完成、
        测试负责人筛选（含待领取）、390 宽移动端卡片。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zcftmwwnrwuon";
/* 样本每次动态挑一个「进行中且尚未认领测试」的工作项：固定 ID 在重复运行时无法回到待领取。 */
let TASK_ID = process.env.E2E_TASK || "";
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const API_MODULE = new URL(BASE).pathname + "/js/core/api.js";

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

const chrome = findChrome();
const port = 9229;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-handoff-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage",
  "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
let cdp = null;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  cdp = new Cdp(ws);
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
  const setViewport = (width, height, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const BODY_VIEW = { workitems:"board" };
  const reloadApp = async () => {
    await call("Page.reload", {});
    await waitFor("document.readyState === 'complete' && document.body && !!document.body.dataset.view", "页面重载", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "重载后初始化", 25000);
  };
  const openView = async view => {
    const ok = await evaluate(`(() => {
      const n = document.querySelector('.nav-item[data-view=${JSON.stringify(view)}]');
      if(!n) return false;
      n.click();
      return true;
    })()`);
    if(!ok) throw new Error("找不到侧栏入口：" + view);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(BODY_VIEW[view] || view)}`, "切换到 " + view);
  };
  const api = async body => evaluate(`(async () => {
    const { API } = await import(${JSON.stringify(API_MODULE)});
    ${body}
  })()`);
  const taskNow = () => api(`const r = await API.getWs(${JSON.stringify(WS)}, "/api/task/${TASK_ID}");
    return r && r.task ? r.task : r;`);
  const moveTask = (column, extra) => api(`const r = await API.postWs(${JSON.stringify(WS)}, "/api/tasks/${TASK_ID}/move",
    Object.assign({ column: ${JSON.stringify(column)} }, ${JSON.stringify(extra || {})}));
    return r;`);

  console.log("测试交接 E2E\n  地址：" + BASE);
  await setViewport(1440, 900, false);
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
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  pass("登录 " + USER);

  /* ---------------- 准备：挑一个「进行中 + 未认领测试」的样本 ---------------- */
  if(!TASK_ID){
    TASK_ID = await api(`const r = await API.getWs(${JSON.stringify(WS)}, "/api/board");
      const col = (r.columns || {}).doing;
      const items = (col && col.items) || [];
      const pick = items.find(t => !t.testOwnerUserId);
      return pick ? pick.id : "";`);
  }
  if(!TASK_ID) throw new Error("「进行中」列里找不到未认领测试的样本工作项");
  const before = await taskNow();
  assert(!!before && before.title, "样本工作项可读：" + (before && before.title) + "（" + TASK_ID + "）");
  if(before.boardColumn !== "doing"){
    await moveTask("doing", { reason: "E2E 重置样本" }).catch(() => null);
  }
  const reset = await taskNow();
  assert(reset.boardColumn === "doing", "样本已就绪在「进行中」（当前：" + reset.boardColumn + "）");
  assert(!reset.testOwnerUserId, "样本进入测试前没有测试负责人");

  await moveTask("test", { autoClaim: false });
  const handedOff = await taskNow();
  assert(handedOff.boardColumn === "test", "移入「待测试」成功");
  assert(!!handedOff.testRequestedAt, "提测时间已记录：" + handedOff.testRequestedAt);
  assert(!handedOff.testOwnerUserId && !handedOff.testOwner, "单人移入不自动认领，保持待领取");

  /* 样本是脚本直接调 API 移动的，看板不会自己刷新：重载后按最新状态渲染 */
  await reloadApp();

  /* ---------------- 看板：待测试卡片显示待领取与等待时长 ---------------- */
  await openView("workitems");
  await waitFor(`!!document.querySelector('.card[data-id="${TASK_ID}"]')`, "看板卡片");
  const strip = await evaluate(`(() => {
    const card = document.querySelector('.card[data-id="${TASK_ID}"]');
    const test = card && card.querySelector('.card-test');
    return {
      text: test ? test.textContent.replace(/\\s+/g, " ").trim() : "",
      claim: !!(card && card.querySelector('[data-test-claim="${TASK_ID}"]'))
    };
  })()`);
  assert(strip.text.indexOf("待领取") !== -1, "看板卡片显示「待领取」并带等待时长（" + strip.text + "）");
  assert(strip.claim, "看板卡片提供「开始测试」入口");
  await shot("test-handoff-e2e-board-2026-11-14.png");

  /* ---------------- 我的工作 · 待我测试：待领取分组 ---------------- */
  await openView("mine");
  await evaluate(`document.querySelector('[data-mine-mode="test"]').click()`);
  await waitFor(`!!document.querySelector('#view-mine [data-mine-id="${TASK_ID}"]')`, "待我测试行", 25000);
  const mineBefore = await evaluate(`(() => {
    const view = document.getElementById("view-mine");
    const row = view.querySelector('[data-mine-id="${TASK_ID}"]');
    const grp = row.closest("[data-mine-group]");
    return {
      isTest: view.classList.contains("is-test"),
      group: grp ? grp.dataset.mineGroup : "",
      groupLabel: grp ? grp.querySelector(".mine-grp-name").textContent.trim() : "",
      claim: row.querySelector("[data-test-claim]") ? row.querySelector("[data-test-claim]").textContent.trim() : "",
      cols: [...view.querySelectorAll(".list-head span")].map(s => s.textContent.trim()),
      foldHidden: (document.getElementById("btnMineFold") || {}).hidden,
      toolbarHidden: (function(){ const l = document.querySelector("#view-mine .mine-hide-test"); return l ? getComputedStyle(l).display === "none" : null; })()
    };
  })()`);
  assert(mineBefore.isTest, "「待我测试」进入独立模式");
  assert(mineBefore.group === "unclaimed" && mineBefore.groupLabel.indexOf("待领取") === 0,
    "未认领工作项落在「" + mineBefore.groupLabel + "」分组");
  assert(mineBefore.claim.indexOf("开始测试") === 0, "行内提供认领入口（" + mineBefore.claim + "）");
  assert(mineBefore.cols.join("|") === "工作项|状态|提测时间|等待 / 已测|开发负责人|操作",
    "列头为测试视角：" + mineBefore.cols.join(" / "));
  assert(mineBefore.foldHidden === true && mineBefore.toolbarHidden === true, "分组/字段/折叠控件在测试模式隐藏");
  await shot("test-handoff-e2e-mine-unclaimed-2026-11-14.png");

  /* ---------------- 测试负责人筛选：待领取 ---------------- */
  await openView("workitems");
  await waitFor(`!!document.querySelector('[data-dim-open="testOwners"]')`, "测试负责人筛选入口");
  await evaluate(`document.querySelector('[data-dim-open="testOwners"]').click()`);
  await waitFor(`!!document.querySelector('#fbDimMenu [data-testowner]')`, "测试负责人菜单");
  const filterMenu = await evaluate(`(() => {
    const menu = document.getElementById("fbDimMenu");
    return {
      title: (menu.querySelector(".menu-title") || {}).textContent || "",
      opts: [...menu.querySelectorAll(".dim-opt")].map(b => b.textContent.replace(/\\s+/g, " ").trim())
    };
  })()`);
  assert(filterMenu.title === "测试负责人", "筛选栏有「测试负责人」维度");
  assert(filterMenu.opts.some(t => t.indexOf("待领取") !== -1), "该维度含「待领取」空值档（" + filterMenu.opts.join(" / ") + "）");
  await evaluate(`document.querySelector('#fbDimMenu [data-testowner="__none"]').click()`);
  await sleep(600);
  const filterApplied = await evaluate(`(() => {
    const btn = document.querySelector('[data-dim-open="testOwners"]');
    const rows = [...document.querySelectorAll('#board .card')].map(c => c.dataset.id);
    return {
      pressed: btn.getAttribute("aria-pressed"),
      label: btn.querySelector(".fb-dim-label").textContent,
      hasTask: rows.indexOf("${TASK_ID}") !== -1
    };
  })()`);
  assert(filterApplied.pressed === "true" && filterApplied.label.indexOf("待领取") !== -1,
    "选中后按钮回显「" + filterApplied.label + "」");
  assert(filterApplied.hasTask, "待领取筛选下样本仍可见");
  await evaluate(`document.querySelector('[data-dim-open="testOwners"]').click()`);
  await evaluate(`document.querySelector('#fbDimMenu [data-testowner="__none"]').click()`);
  await sleep(500);

  /* ---------------- 我的工作认领：待领取 → 测试中 ---------------- */
  await openView("mine");
  await evaluate(`document.querySelector('[data-mine-mode="test"]').click()`);
  await waitFor(`!!document.querySelector('#view-mine [data-mine-id="${TASK_ID}"]')`, "待我测试行");
  await evaluate(`document.querySelector('#view-mine [data-mine-id="${TASK_ID}"] [data-test-claim]').click()`);
  await waitFor(`import("./js/core/api.js").then(({API}) => API.getWs(${JSON.stringify(WS)}, "/api/task/${TASK_ID}")).then(t => t.boardColumn === "testing")`, "认领后进入测试中", 25000);
  const claimed = await taskNow();
  assert(claimed.testOwnerUserId === "Umw9ukb1heumvotrd", "认领写入测试负责人账号：" + claimed.testOwnerUserId);
  assert(!!claimed.testOwner, "同时落库测试负责人显示名快照（" + claimed.testOwner + "）");
  assert(!!claimed.testStartedAt, "开始测试时间已记录：" + claimed.testStartedAt);
  await sleep(800);
  const mineClaimed = await evaluate(`(() => {
    const row = document.querySelector('#view-mine [data-mine-id="${TASK_ID}"]');
    const grp = row && row.closest("[data-mine-group]");
    return {
      group: grp ? grp.dataset.mineGroup : "",
      label: grp ? grp.querySelector(".mine-grp-name").textContent.trim() : "",
      acts: row ? [...row.querySelectorAll("[data-test-reject],[data-test-pass]")].map(b => b.textContent.trim()) : []
    };
  })()`);
  assert(mineClaimed.group === "claimed" && mineClaimed.label.indexOf("测试中") === 0,
    "认领后移入「" + mineClaimed.label + "」分组");
  assert(mineClaimed.acts.join("|") === "退回…|通过", "测试中行提供退回 / 通过（" + mineClaimed.acts.join(" / ") + "）");
  await shot("test-handoff-e2e-mine-claimed-2026-11-14.png");

  /* ---------------- 抽屉：测试卡读数 + 通过并完成 ---------------- */
  await openView("workitems");
  await waitFor(`!!document.querySelector('.card[data-id="${TASK_ID}"]')`, "看板卡片");
  await evaluate(`document.querySelector('.card[data-id="${TASK_ID}"]').click()`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "抽屉打开");
  await waitFor(`!document.getElementById("readTestCard").hidden`, "测试卡可见");
  const drawer = await evaluate(`(() => ({
    phase: document.getElementById("readTestPhase").textContent,
    owner: document.getElementById("readTestOwner").textContent.replace(/\\s+/g, " ").trim(),
    requested: document.getElementById("readTestRequested").textContent,
    start: document.getElementById("readTestStart").textContent,
    end: document.getElementById("readTestEnd").textContent,
    passVisible: !document.getElementById("readTestPass").hidden,
    rejectVisible: !document.getElementById("readTestReject").hidden
  }))()`);
  assert(drawer.phase === "测试中", "抽屉测试阶段：测试中");
  assert(drawer.owner && drawer.owner !== "未指派", "测试负责人已显示（" + drawer.owner + "）");
  assert(drawer.requested !== "—" && drawer.start !== "—", "提测 / 开始测试时间可读");
  assert(drawer.end === "—" && drawer.passVisible && drawer.rejectVisible, "结束时间尚未记录，操作区可用");
  await shot("test-handoff-e2e-drawer-testing-2026-11-14.png");
  await evaluate(`document.getElementById("readTestPass").click()`);
  await waitFor(`import("./js/core/api.js").then(({API}) => API.getWs(${JSON.stringify(WS)}, "/api/task/${TASK_ID}")).then(t => t.boardColumn === "done")`, "通过并完成", 25000);
  const passed = await taskNow();
  assert(!!passed.testFinishedAt, "通过后记录结束测试时间：" + passed.testFinishedAt);
  assert(passed.testOwnerUserId === "Umw9ukb1heumvotrd", "测试负责人保留在完成项上");
  await evaluate(`document.getElementById("taskScrim").click()`);
  await sleep(400);

  /* ---------------- 移动端：待我测试卡片 ---------------- */
  await setViewport(390, 844, true);
  await sleep(500);
  await openView("mine");
  await evaluate(`document.querySelector('[data-mine-mode="test"]').click()`);
  await sleep(1200);
  const mobile = await evaluate(`(() => {
    const view = document.getElementById("view-mine");
    return {
      layout: document.body.dataset.layout,
      isTest: view.classList.contains("is-test"),
      cards: view.querySelectorAll(".mob-task-card").length,
      empty: !!view.querySelector(".empty-state"),
      foot: (document.querySelector(".mine-stat-hint") || {}).textContent || ""
    };
  })()`);
  assert(mobile.layout === "mobile" && mobile.isTest, "移动端切到待我测试视图");
  assert(mobile.cards > 0 || mobile.empty, "移动端渲染卡片或空态（卡片 " + mobile.cards + "）");
  await shot("test-handoff-e2e-mine-mobile-2026-11-14.png");

  if(cdp.errors.length){
    console.log("  浏览器错误：\n    " + cdp.errors.slice(0, 6).join("\n    "));
    failed += cdp.errors.length;
  }
  console.log(failed ? `\nFAILED ${failed}` : "\nALL PASS");
}catch(err){
  if(cdp && cdp.errors.length) console.log("浏览器错误：\n  " + cdp.errors.slice(0, 8).join("\n  "));
  throw err;
}finally{
  proc.kill();
}
process.exit(failed ? 1 : 0);
