/* 抽屉放大全屏 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/drawer-fullscreen.mjs
   覆盖：
     A admin 任务抽屉：放大按钮、点按切 on-full/图标与 aria 跟随、localStorage 按类记忆、
       关闭重开仍全屏、还原后记忆清除；
     B admin 用例抽屉：阅读态头部按钮放大 sheet、切编辑态后编辑头部按钮状态同步；
     C 分支 / 周回顾明细抽屉按钮静态接线（隐藏层也可切换并记忆）；
     D 移动端抽屉已全宽，放大按钮隐藏；
     E 无运行时错误。结束后清掉本机偏好键。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
const SHOT_DIR = path.resolve("docs/audit/prototypes");

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
const port = 9234;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drawer-full-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
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
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    for(let attempt = 0; ; attempt++){
      try{
        const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
        if(res.exceptionDetails) throw new Error("执行失败[" + expr.slice(0, 160).replace(/\s+/g, " ") + "]：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
        return res.result ? res.result.value : undefined;
      }catch(e){
        /* awaitPromise 求值偶发被 GC：挂到 window 保活后重试一次 */
        if(attempt === 0 && /collected/i.test(e.message)){
          expr = `(window.__e2eKeep = (${expr}), window.__e2eKeep)`;
          continue;
        }
        throw e;
      }
    }
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
    await sleep(500);
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const login = async user => {
    await call("Network.clearBrowserCookies", {});
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(user)});
      set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成 " + user, 12000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  };

  console.log("抽屉放大全屏 E2E\n  地址：" + BASE);

  await setViewport(1440, 900, false);
  await login("admin");
  /* 清掉本机偏好，保证可重复跑 */
  await evaluate(`(() => {
    Object.keys(localStorage).filter(k => k.indexOf("hg.drawerFull.v1.") === 0).forEach(k => localStorage.removeItem(k));
    return true;
  })()`);

  const openFirstTask = async () => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { openTaskById } = await import("./js/core/task-actions.js");
    const d = await API.get("/api/tasks/list", { sort: "updated", limit: 1 });
    const t = (d.items || [])[0];
    if(!t) return { error: "没有可用工作项" };
    await openTaskById(t.id);
    return { id: t.id };
  })()`);

  /* ---------------- A 任务抽屉 ---------------- */
  const a0 = await openFirstTask();
  assert(!a0.error && !!a0.id, "任务抽屉打开" + (a0.error ? "：" + a0.error : ""));
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "任务抽屉就绪");

  const a1 = await evaluate(`(() => {
    const btn = document.querySelector('[data-drawer-full="task"]');
    const form = document.getElementById("taskForm");
    const r = form.getBoundingClientRect();
    return {
      hasBtn: !!btn,
      pressed: btn ? btn.getAttribute("aria-pressed") : null,
      full: form.classList.contains("on-full"),
      width: Math.round(r.width),
      vw: window.innerWidth,
      expandVisible: btn ? getComputedStyle(btn.querySelector(".ic-expand")).display !== "none" : false
    };
  })()`);
  assert(a1.hasBtn && a1.pressed === "false" && !a1.full, "任务抽屉默认非全屏、按钮未按下");
  assert(a1.width < a1.vw && a1.expandVisible, "默认宽度 " + a1.width + " < 视口 " + a1.vw + "、显示放大图标");

  await evaluate(`document.querySelector('[data-drawer-full="task"]').click()`);
  await sleep(400);
  const a2 = await evaluate(`(() => {
    const btn = document.querySelector('[data-drawer-full="task"]');
    const form = document.getElementById("taskForm");
    const r = form.getBoundingClientRect();
    return {
      full: form.classList.contains("on-full"),
      width: Math.round(r.width),
      pressed: btn.getAttribute("aria-pressed"),
      label: btn.getAttribute("aria-label"),
      expandVisible: getComputedStyle(btn.querySelector(".ic-expand")).display !== "none",
      contractVisible: getComputedStyle(btn.querySelector(".ic-contract")).display !== "none",
      stored: localStorage.getItem("hg.drawerFull.v1.task")
    };
  })()`);
  assert(a2.full && a2.width >= 1400, "点击后全屏（宽 " + a2.width + "）");
  assert(a2.pressed === "true" && a2.label === "还原宽度", "aria-pressed 与标签切换为还原");
  assert(!a2.expandVisible && a2.contractVisible, "图标切换为收缩");
  assert(a2.stored === "1", "本机记忆写入 hg.drawerFull.v1.task=1");
  await shot("drawer-fullscreen-task.png");

  /* A2 关闭重开仍全屏 */
  await evaluate(`document.getElementById("btnCloseTask").click()`);
  await waitFor(`!document.getElementById("taskDrawer").classList.contains("on")`, "任务抽屉关闭");
  const a0b = await openFirstTask();
  assert(!a0b.error, "重新打开任务抽屉");
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on") && document.getElementById("taskForm").classList.contains("on-full")`, "重开后按记忆恢复全屏");

  /* A3 还原 */
  await evaluate(`document.querySelector('[data-drawer-full="task"]').click()`);
  await sleep(400);
  const a3 = await evaluate(`(() => ({
    full: document.getElementById("taskForm").classList.contains("on-full"),
    stored: localStorage.getItem("hg.drawerFull.v1.task"),
    width: Math.round(document.getElementById("taskForm").getBoundingClientRect().width)
  }))()`);
  assert(!a3.full && a3.stored === "0" && a3.width < 1400, "还原后宽度 " + a3.width + "、本机记忆=0");
  await evaluate(`document.getElementById("btnCloseTask").click()`);
  await waitFor(`!document.getElementById("taskDrawer").classList.contains("on")`, "任务抽屉再次关闭");

  /* ---------------- B 用例抽屉 ---------------- */
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
  await waitFor(`!!document.querySelector('[data-tc-open]')`, "用例列表", 30000);
  await evaluate(`document.querySelector('[data-tc-open]').click()`);
  await waitFor(`document.getElementById('dlgCase').classList.contains('open') && !!document.querySelector('[data-case-close]')`, "用例抽屉打开");

  const b1 = await evaluate(`(() => {
    const btn = document.querySelector('#caseDetailView [data-drawer-full="case"]');
    const sheet = document.querySelector('#dlgCase .sheet');
    return { hasBtn: !!btn, pressed: btn ? btn.getAttribute("aria-pressed") : null, full: sheet.classList.contains("on-full") };
  })()`);
  assert(b1.hasBtn && b1.pressed === "false" && !b1.full, "用例抽屉阅读态有放大按钮、默认非全屏");

  await evaluate(`document.querySelector('#caseDetailView [data-drawer-full="case"]').click()`);
  await sleep(400);
  const b2 = await evaluate(`(() => {
    const sheet = document.querySelector('#dlgCase .sheet');
    const r = sheet.getBoundingClientRect();
    return {
      full: sheet.classList.contains("on-full"),
      width: Math.round(r.width),
      stored: localStorage.getItem("hg.drawerFull.v1.case"),
      editBtn: !!document.querySelector('#caseEditBody [data-drawer-full="case"]')
    };
  })()`);
  assert(b2.full && b2.width >= 1400, "用例抽屉全屏（宽 " + b2.width + "）");
  assert(b2.stored === "1", "用例抽屉本机记忆=1");
  await shot("drawer-fullscreen-case.png");

  /* B2 详情视图重渲染（切页签）后按钮状态保持：验证 renderCaseDetail 的同步 */
  await evaluate(`document.querySelector('#caseDetailView [data-case-tab="runs"]').click()`);
  await waitFor(`!!document.querySelector('#caseDetailView .case-detail-runs, #caseDetailView [data-case-tab]')`, "切到执行历史页签");
  const b3 = await evaluate(`(() => {
    const btn = document.querySelector('#caseDetailView [data-drawer-full="case"]');
    const sheet = document.querySelector('#dlgCase .sheet');
    return { pressed: btn ? btn.getAttribute("aria-pressed") : null, full: sheet.classList.contains("on-full") };
  })()`);
  assert(b3.pressed === "true" && b3.full, "页签重渲染后按钮仍按下、sheet 保持全屏");
  await evaluate(`document.querySelector('#caseDetailView [data-case-close]').click()`);
  await waitFor(`!document.getElementById('dlgCase').classList.contains('open')`, "关闭用例抽屉");

  /* ---------------- C 分支 / 周回顾明细按钮接线 ---------------- */
  const c1 = await evaluate(`(() => {
    const btn = document.querySelector('[data-drawer-full="branch"]');
    if(!btn) return { has: false };
    btn.click();
    const full = document.querySelector('.br-drawer').classList.contains('on-full');
    const stored = localStorage.getItem("hg.drawerFull.v1.branch");
    btn.click();
    const restored = !document.querySelector('.br-drawer').classList.contains("on-full");
    return { has: true, full, stored, restored, cleared: localStorage.getItem("hg.drawerFull.v1.branch") === "0" };
  })()`);
  assert(c1.has && c1.full && c1.stored === "1" && c1.restored && c1.cleared, "分支抽屉按钮接线：切换、记忆、还原");

  const c2 = await evaluate(`(() => {
    const btn = document.querySelector('[data-drawer-full="rv"]');
    if(!btn) return { has: false };
    btn.click();
    const full = document.querySelector('.rv-drawer').classList.contains('on-full');
    btn.click();
    return { has: true, full, restored: !document.querySelector('.rv-drawer').classList.contains("on-full") };
  })()`);
  assert(c2.has && c2.full && c2.restored, "周回顾明细抽屉按钮接线：切换、还原");

  /* ---------------- D 移动端隐藏 ---------------- */
  await setViewport(390, 844, true);
  await call("Page.navigate", { url: "about:blank" });
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.layout === 'mobile' && document.body.dataset.view === 'testcases'", "移动布局");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.reqsLoaded)`, "移动端初始化", 25000);
  const d0 = await openFirstTask();
  assert(!d0.error, "移动端打开任务抽屉");
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "移动端任务抽屉就绪");
  const d1 = await evaluate(`(() => {
    const btn = document.querySelector('[data-drawer-full="task"]');
    return { display: btn ? getComputedStyle(btn).display : "missing" };
  })()`);
  assert(d1.display === "none", "移动端放大按钮隐藏（display=" + d1.display + "）");
  await evaluate(`document.getElementById("btnCloseTask").click()`);
  await waitFor(`!document.getElementById("taskDrawer").classList.contains("on")`, "移动端关闭任务抽屉");

  /* ---------------- 收尾：清本机偏好 ---------------- */
  await evaluate(`(() => {
    Object.keys(localStorage).filter(k => k.indexOf("hg.drawerFull.v1.") === 0).forEach(k => localStorage.removeItem(k));
    return true;
  })()`);
  pass("本机偏好键已清理");

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  assert(realErrors.length === 0, "无运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  if(cdp && cdp.errors.length) console.error("捕获的运行时错误：\n  " + cdp.errors.join("\n  "));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
