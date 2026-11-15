/* 侧板表单 E2E（Native CDP）：编辑项目、新建文档
   目标（审计场景 4）：8–11 字段的业务表单从居中弹框改为右侧侧板，列表保持可见、
   字段按段分组；手机端不超视口、不出横向滚动。
   全程只读：只打开与关闭表单，不改字段、不保存。
   用法：node tools/e2e/side-forms.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zdcxjt60yqxxh";

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
const port = 9232;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "side-forms-e2e-"));
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
    fs.writeFileSync("/tmp/hg-side-" + name + ".png", Buffer.from(r.data, "base64"));
    console.log("  SHOT /tmp/hg-side-" + name + ".png");
  };
  const openProjectEdit = async () => {
    await waitFor(`!!document.querySelector("#reqList [data-edit-req]")`, "项目编辑入口", 25000);
    await ev(`document.querySelector("#reqList [data-edit-req]").click(); true`);
    await waitFor(`!!document.querySelector("#dlgProject.open")`, "编辑项目侧板", 15000);
    await sleep(400); /* 侧滑动画 150ms */
  };

  console.log("侧板表单 E2E\n  地址：" + BASE);
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

  /* 1. 桌面：编辑项目 → 右侧 560 侧板，列表仍在左侧 */
  await ev(`import("./js/core/router.js").then(m => { m.showView("projects"); return true; })`);
  await openProjectEdit();
  const proj = await ev(`(() => {
    const m = document.getElementById("dlgProject");
    const sheet = m.querySelector(".sheet");
    const r = sheet.getBoundingClientRect();
    const list = document.getElementById("reqList");
    const lr = list ? list.getBoundingClientRect() : { width:0, right:0 };
    const secs = [...m.querySelectorAll(".proj-form-grid > .form-sec")].map(s => s.textContent.trim());
    const desc = m.querySelector("#rDesc").closest(".field").getBoundingClientRect();
    const obj = m.querySelector("#rObjective").closest(".field").getBoundingClientRect();
    return {
      side: m.classList.contains("side"),
      width: Math.round(r.width), right: Math.round(r.right), left: Math.round(r.left), vw: innerWidth, vh: innerHeight,
      listWidth: Math.round(lr.width),
      secs, stacked: Math.abs(desc.top - obj.top) > 80,
      fields: m.querySelectorAll("input, select, textarea").length
    };
  })()`);
  assert(proj.side, "编辑项目走右侧侧板（.modal-layer.side）");
  assert(proj.width >= 520 && proj.width <= 600, "侧板宽度 560（实测 " + proj.width + "）");
  assert(proj.right >= proj.vw - 2, "侧板贴右，列表留在左侧（面板右缘 " + proj.right + "/" + proj.vw + "）");
  assert(proj.listWidth > 200 && proj.left >= 400, "项目列表仍可见（宽 " + proj.listWidth + "，面板左缘 " + proj.left + "）");
  assert(proj.secs.join("|") === "基本信息|计划与负责人|高级设置", "字段分组：" + proj.secs.join(" / "));
  assert(proj.stacked, "侧板内长文本字段改为单列堆叠");
  assert(proj.fields >= 9, "表单字段完整（" + proj.fields + "）");
  await shot("project-1440");
  await ev(`document.getElementById("dlgProjectX").click(); true`);
  await sleep(400);
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 0`), "关闭侧板后无残留浮层");

  /* 1b. 关闭守卫：改过字段先确认，「继续编辑」留在侧板，还原后才能直接关 */
  await openProjectEdit();
  const originName = await ev(`document.getElementById("rName").value`);
  await ev(`(() => { const el = document.getElementById("rName");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, el.value + "X");
    el.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
  await ev(`document.getElementById("dlgProjectX").click(); true`);
  await waitFor(`document.getElementById("dlgConfirm").classList.contains("open")`, "放弃修改确认框", 10000);
  await ev(`document.getElementById("dlgConfirmCancel").click(); true`);
  await sleep(300);
  const guard = await ev(`({ project: document.getElementById("dlgProject").classList.contains("open"),
    confirm: document.getElementById("dlgConfirm").classList.contains("open") })`);
  assert(guard.project && !guard.confirm, "未保存时先确认；点「继续编辑」仍留在侧板");
  await ev(`(() => { const el = document.getElementById("rName");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(originName)});
    el.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
  await ev(`document.getElementById("dlgProjectX").click(); true`);
  await sleep(400);
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 0`), "还原字段后侧板直接关闭（守卫不误拦）");

  /* 2. 桌面：新建文档 → 同一套侧板形制 */
  await ev(`import("./js/core/router.js").then(m => { m.showView("requirements"); return true; })`);
  await waitFor(`document.body.dataset.view === "requirements"`, "文档视图", 20000);
  await sleep(400);
  await ev(`import("./js/views/requirements.js").then(m => m.openNewReqDocDialog()).then(() => true)`);
  await waitFor(`!!document.querySelector("#dlgNewReqDoc.open")`, "新建文档侧板", 15000);
  await sleep(400);
  const doc = await ev(`(() => {
    const m = document.getElementById("dlgNewReqDoc");
    const r = m.querySelector(".sheet").getBoundingClientRect();
    return {
      side: m.classList.contains("side"),
      width: Math.round(r.width), right: Math.round(r.right), vw: innerWidth,
      hasHead: !!m.querySelector(".panel-head h3#dlgNewReqDocTitle"),
      hasX: !!document.getElementById("dlgNewReqDocX"),
      fields: m.querySelectorAll(".reqdoc-dlg-field").length,
      visInside: !!m.querySelector(".reqdoc-dlg-form #newReqDocVisField")
    };
  })()`);
  assert(doc.side, "新建文档走右侧侧板");
  assert(doc.width >= 520 && doc.width <= 600 && doc.right >= doc.vw - 2, "文档侧板同样 560 且贴右（实测 " + doc.width + "）");
  assert(doc.hasHead && doc.hasX, "文档侧板有标题栏与关闭按钮");
  assert(doc.fields >= 6 && doc.visInside, "文档字段完整，可见范围注入仍在表单内（" + doc.fields + " 项）");
  await shot("new-doc-1440");
  await ev(`document.getElementById("dlgNewReqDocX").click(); true`);
  await sleep(400);
  assert(await ev(`document.querySelectorAll(".modal-layer.open").length === 0`), "关闭文档侧板后无残留浮层");

  /* 3. 手机 390：侧板占满宽度，不出横向滚动 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await ev(`import("./js/core/router.js").then(m => { m.showView("projects"); return true; })`);
  await waitFor(`document.body.dataset.view === "projects"`, "390 项目视图", 20000);
  await openProjectEdit();
  const mob = await ev(`(() => {
    const m = document.getElementById("dlgProject");
    const s = m.querySelector(".sheet");
    const r = s.getBoundingClientRect();
    return { width: Math.round(r.width), left: Math.round(r.left),
      overflowX: s.scrollWidth - s.clientWidth,
      stack: getComputedStyle(m.querySelector(".proj-form-grid")).gridTemplateColumns.split(" ").length };
  })()`);
  assert(mob.width <= 390 && mob.left >= 0, "390 侧板不超视口（宽 " + mob.width + "）");
  assert(mob.overflowX <= 1, "390 侧板无横向滚动（溢出 " + mob.overflowX + "px）");
  assert(mob.stack === 1, "390 表单单列");
  await shot("project-390");
  await ev(`document.getElementById("dlgProjectX").click(); true`);
  await sleep(300);
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
