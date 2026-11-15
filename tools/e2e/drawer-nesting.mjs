/* 浮层层数 E2E（Native CDP）：版本「管理工作项」→ 新建工作项抽屉 → 补记工时
   目标（审计场景 3）：一次只留一层浮层；补记工时在任务抽屉内联展开；
   从弹框里新建工作项时先收起弹框，抽屉关闭后回到弹框并还原勾选。
   演示数据：移动端团队 / App 首页改版 / App 首页 v3.2（Voc6wlnlawn6ekywshfsi）。
   全程只读：勾选不保存、新建不保存、补记只展开不提交，结束前取消所有浮层。
   用法：node tools/e2e/drawer-nesting.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zdcxjt60yqxxh";
const REQ = process.env.E2E_REQ || "Rph94sl9psffcezue1t04";
const VERSION = process.env.E2E_VERSION || "Voc6wlnlawn6ekywshfsi";

/* 环境缺口单独归桶：演示库缺 project_repo / dev_branch.outcome 的 500，
   以及运行中的 jar 早于源码、还没有 /api/branches/pending 的 404（2026-11-15 前已存在） */
const BASELINE_API = /\/api\/(mobile\/team-overview|repos(\b|\/)|branches\/(options|board|pending)\b)/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
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

class Cdp{
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.errors = []; this.baseline = [];
    ws.addEventListener("message", e => this.on(JSON.parse(e.data)));
  }
  on(msg){
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      this.errors.push("console.error: " + msg.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(BASELINE_API.test(e.url || "")) this.baseline.push(e.url);
      else this.errors.push("log: " + (e.url || e.text));
    }
  }
  send(m, p = {}, sid){
    const id = ++this.id; const payload = { id, method: m, params: p };
    if(sid) payload.sessionId = sid;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
}

const chrome = findChrome();
const port = 9231;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drawer-nesting-e2e-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"], { stdio: "ignore" });

let failed = 0;
const assert = (c, m) => { if(!c){ failed++; console.log("  FAIL " + m); } else console.log("  PASS " + m); };

try{
  let ver = null;
  for(let i = 0; i < 60 && !ver; i++){
    try{ ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!ver) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const ev = async expr => {
    const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(r.exceptionDetails) throw new Error("执行失败：" + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const end = Date.now() + timeout; let last;
    while(Date.now() < end){
      try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync("/tmp/hg-nest-" + name + ".png", Buffer.from(r.data, "base64"));
    console.log("  SHOT /tmp/hg-nest-" + name + ".png");
  };
  const openBinding = async () => {
    await waitFor(`!!document.querySelector('.modal-layer.open .version-task-sheet')`, "管理工作项弹框", 20000);
  };

  console.log("浮层层数 E2E\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await ev(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles:true })); };
    set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click(); return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await ev(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${WS}/select", {})).then(() => true)`);
  await call("Page.navigate", { url: BASE + "/" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);

  /* 1. 桌面：版本卡 → 管理工作项（第一层） */
  await ev(`import("./js/core/router.js").then(m => { m.showView("phase"); return true; })`);
  await ev(`import("./js/views/phase.js").then(m => { m.setPhaseProject(${JSON.stringify(REQ)}, "version"); return true; })`);
  await waitFor(`!!document.querySelector('[data-ver-tasks="${VERSION}"]')`, "版本卡管理工作项入口", 25000);
  await ev(`document.querySelector('[data-ver-tasks="${VERSION}"]').click(); true`);
  await openBinding();
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 1`), "管理工作项是唯一浮层");

  const toggled = await ev(`(() => {
    const c = [...document.querySelectorAll(".version-task-sheet [data-version-task-check]")].find(x => !x.checked && !x.disabled);
    if(!c) return null;
    const id = c.getAttribute("data-version-task-check");
    c.click();
    return id;
  })()`);
  assert(!!toggled, "找到可勾选工作项用于还原校验（" + (toggled || "无") + "）");
  await shot("binding-1440");

  /* 2. 新建工作项：先收弹框，只留抽屉（第二层不再叠在弹框上） */
  await ev(`document.querySelector(".version-task-sheet [data-version-task-new]").click(); true`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "任务抽屉打开", 15000);
  const afterNew = await ev(`({
    modals: document.querySelectorAll(".modal-layer.open").length,
    drawer: document.getElementById("taskDrawer").classList.contains("on"),
    timeHidden: document.getElementById("dlgTimeAdd").hidden,
    versionPreset: (document.getElementById("iVersion") ? [...document.getElementById("iVersion").selectedOptions].map(o => o.value) : [])
  })`);
  assert(afterNew.modals === 0 && afterNew.drawer, "新建工作项先收起弹框，只留任务抽屉（浮层 " + afterNew.modals + " 层）");
  assert(JSON.stringify(afterNew.versionPreset) === JSON.stringify([VERSION]), "新建抽屉预设计划版本：" + JSON.stringify(afterNew.versionPreset));
  assert(afterNew.timeHidden === true, "补记面板默认收起");
  await shot("new-task-drawer-1440");

  /* 3. 关闭抽屉：回到管理工作项弹框，勾选原样还原 */
  await ev(`import("./js/core/task-drawer.js").then(m => { m.tryCloseTaskDrawer(); return true; })`);
  await openBinding();
  await sleep(500);
  const back = await ev(`({
    modals: document.querySelectorAll(".modal-layer.open").length,
    drawer: document.getElementById("taskDrawer").classList.contains("on"),
    toggled: (() => { const c = document.querySelector('.version-task-sheet [data-version-task-check="${toggled || ""}"]'); return c ? c.checked : null; })()
  })`);
  assert(back.modals === 1 && !back.drawer, "关闭抽屉后回到管理工作项弹框（浮层 " + back.modals + " 层）");
  if(toggled) assert(back.toggled === true, "新建前的勾选被还原（" + toggled + "）");
  await shot("binding-return-1440");
  await ev(`document.querySelector(".version-task-sheet [data-version-task-cancel]").click(); true`);
  await sleep(400);
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 0`), "取消关闭管理工作项，无残留浮层");

  /* 4. 补记工时内联：既有工作项打开抽屉后，补记在工时区内展开 */
  await ev(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(process.env.E2E_TASK || "Kz6uxi30xx7iygo07dgbk")})); true`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "工作项抽屉", 15000);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById("rfHoursAdd") || document.getElementById("btnActualAdd"); if(b) b.click(); return true; })()`);
  await waitFor(`!document.getElementById("dlgTimeAdd").hidden`, "补记面板展开", 10000);
  const inline = await ev(`({
    modals: document.querySelectorAll(".modal-layer.open").length,
    inside: !!document.getElementById("dlgTimeAdd").closest(".drawer"),
    fields: document.querySelectorAll("#dlgTimeAdd input, #dlgTimeAdd select").length,
    area: (() => { const r = document.getElementById("dlgTimeAdd").getBoundingClientRect(); return r.width > 0 && r.height > 0; })()
  })`);
  assert(inline.modals === 0 && inline.inside && inline.fields >= 4 && inline.area, "补记在任务抽屉内展开（浮层 " + inline.modals + " 层，字段 " + inline.fields + "）");
  await shot("inline-time-1440");
  await ev(`document.getElementById("dlgTimeAddCancel").click(); true`);
  await ev(`import("./js/core/task-drawer.js").then(m => { m.tryCloseTaskDrawer(); return true; })`);
  await sleep(400);

  /* 5. 手机 390：同一路径仍只有一层 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await ev(`document.querySelector('[data-ver-tasks="${VERSION}"]').click(); true`);
  await openBinding();
  assert(await ev(`(() => { const s = document.querySelector(".version-task-sheet"); const r = s.getBoundingClientRect(); return r.width <= 390 && r.left >= 0; })()`), "390 管理工作项不超视口");
  await ev(`document.querySelector(".version-task-sheet [data-version-task-new]").click(); true`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "390 任务抽屉", 15000);
  await sleep(600); /* 抽屉有 150ms 淡入，等动画结束再截图 */
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 0`), "390 新建工作项仍只留抽屉一层");
  await shot("new-task-drawer-390");
  await call("Emulation.clearDeviceMetricsOverride", {});
  await sleep(300);

  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(!errs.length, "控制台零报错" + (errs.length ? "：" + errs.slice(0, 5).join(" | ") : ""));
  if(cdp.baseline.length) console.log("  INFO 已知环境缺口（库结构与运行 jar 不一致）：" + cdp.baseline.length + " 次 " + [...new Set(cdp.baseline)].join(" | "));
  console.log(failed ? "\n结果：" + failed + " 项失败" : "\n结果：全部通过");
}catch(e){
  failed++;
  console.log("  ERROR " + (e && e.message || e));
}finally{
  try{ proc.kill(); }catch(e){}
  process.exit(failed ? 1 : 0);
}
