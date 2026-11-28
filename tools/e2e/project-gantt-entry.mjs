/* 项目驾驶舱「排期」入口 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/project-gantt-entry.mjs
   覆盖：
     A 驾驶舱工具栏出现「排期」按钮；
     B 点按后进入工作项甘特，且只保留当前项目的筛选（其余工作项域筛选全部清空）；
     C 请求参数带 reqs=<项目>，URL 落到 #/gantt；
     D 左下角出现「返回 项目 …」，点按回到原项目驾驶舱；
     E 无运行时错误。不写任何业务数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const PORT = Number(process.env.CDP_PORT || 9339);
const SHOT_DIR = path.resolve("docs/audit/prototypes/project-gantt-entry-2026-11-28");

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.requests = [];
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
    }else if(msg.method === "Network.requestWillBeSent"){
      this.requests.push(msg.params.request.url);
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-gantt-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0, passed = 0;
let cdp = null;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
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
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败[" + expr.slice(0, 160).replace(/\s+/g, " ") + "]：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 25000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    await sleep(400);
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
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化");
  };

  console.log("项目驾驶舱「排期」入口 E2E\n  地址：" + BASE);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await login(USER);

  /* ---------------- A 驾驶舱入口 ---------------- */
  await call("Page.navigate", { url: BASE + "/#/project" });
  await waitFor("document.body.dataset.view === 'project'", "进入项目驾驶舱");
  await waitFor("[...document.querySelectorAll('#projectBody [data-project-gantt]')].length === 1", "排期入口");
  const ctx = await evaluate(`(async () => {
    const { rt, state } = await import("./js/core/state.js");
    /* 预置一批工作项域筛选：按钮应把它们全部清掉，只留当前项目 */
    state.q = "zzz"; state.owners = ["__E2E__"]; state.pris = ["P0"]; state.cats = ["__E2E__"];
    state.tags = ["__E2E__"]; state.types = ["bug"]; state.versions = ["__E2E__"];
    state.completion = "done"; state.pubState = "published"; state.due = "over";
    state.noDue = true; state.focus = true; state.blocked = true;
    state.dueFrom = "2000-01-01"; state.startTo = "2000-01-31";
    return {
      pid: rt.managerProjectId,
      name: (document.getElementById("pageTitleText") || {}).textContent || "",
      btnText: document.querySelector("[data-project-gantt]").textContent.trim()
    };
  })()`);
  assert(!!ctx.pid, "驾驶舱已选中项目 " + ctx.pid);
  assert(ctx.btnText.indexOf("排期") >= 0, "排期按钮文案为「" + ctx.btnText + "」");
  await shot("a-cockpit.png");

  /* ---------------- B 跳转与筛选 ---------------- */
  const before = cdp.requests.length;
  await evaluate(`document.querySelector("[data-project-gantt]").click()`);
  await waitFor("document.body.dataset.view === 'gantt'", "切到工作项甘特");
  await waitFor(`import("./js/core/router.js").then(({activeView}) => activeView === "gantt")`, "路由落在甘特");
  await waitFor("!!document.getElementById('view-gantt') && document.getElementById('view-gantt').classList.contains('on')", "甘特视图可见");

  const after = await evaluate(`(async () => {
    const { state } = await import("./js/core/state.js");
    return {
      reqs: state.reqs.slice(),
      q: state.q, owners: state.owners.slice(), pris: state.pris.slice(), cats: state.cats.slice(),
      tags: state.tags.slice(), types: state.types.slice(), versions: state.versions.slice(),
      completion: state.completion, pubState: state.pubState, due: state.due, noDue: state.noDue,
      focus: state.focus, blocked: state.blocked, dueFrom: state.dueFrom, startTo: state.startTo,
      hash: location.hash
    };
  })()`);
  assert(after.reqs.length === 1 && after.reqs[0] === ctx.pid, "筛选只保留当前项目（" + after.reqs.join(",") + "）");
  const leftovers = ["q","owners","pris","cats","tags","types","versions","completion","pubState","due","noDue","focus","blocked","dueFrom","startTo"]
    .filter(k => {
      const v = after[k];
      if(Array.isArray(v)) return v.length > 0;
      if(typeof v === "boolean") return v;
      return v !== null && v !== "" && v !== "week";
    });
  assert(leftovers.length === 0, "其余工作项筛选已清空" + (leftovers.length ? "：" + leftovers.join(",") : ""));
  assert(/^#\/gantt/.test(after.hash), "URL 落到 " + after.hash);

  const ganttUrl = cdp.requests.slice(before).filter(u => u.indexOf("/api/gantt?") >= 0 || /\/api\/gantt$/.test(u)).pop() || "";
  assert(ganttUrl.indexOf("reqs=" + encodeURIComponent(ctx.pid)) >= 0, "甘特请求带项目筛选");

  /* 数据加载完成：有排期任务则出现行，否则显示空态 */
  const loaded = await waitFor(`(() => {
    const s = document.getElementById("ganttScroll");
    if(!s) return false;
    return s.querySelectorAll("[data-gantt-row-id]").length > 0 || s.querySelector(".gantt-grid") || s.querySelector(".empty-state, .ui-empty");
  })()`, "甘特正文渲染");
  assert(!!loaded, "甘特正文已渲染");
  const rowCount = await evaluate(`document.querySelectorAll("#ganttScroll [data-gantt-row-id]").length`);
  console.log("  INFO 可见甘特行 " + rowCount + " 条");

  /* ---------------- C 返回胶囊 ---------------- */
  const pill = await evaluate(`(() => {
    const el = document.getElementById("returnOrigin");
    if(!el) return { absent:true };
    return { hidden:el.hidden, label:(el.querySelector("[data-return-label]") || {}).textContent || "" };
  })()`);
  assert(!pill.absent && !pill.hidden, "出现返回入口");
  assert(ctx.name && pill.label.indexOf(ctx.name) >= 0, "返回文案指向原项目（" + pill.label + "）");
  await shot("b-gantt.png");

  await evaluate(`document.querySelector("#returnOrigin .return-origin-go").click()`);
  await waitFor("document.body.dataset.view === 'project'", "返回项目驾驶舱");
  const back = await evaluate(`(async () => {
    const { rt } = await import("./js/core/state.js");
    await new Promise(r => setTimeout(r, 300));
    return { pid: rt.managerProjectId, title: (document.getElementById("pageTitleText") || {}).textContent || "",
      pillHidden: (document.getElementById("returnOrigin") || {}).hidden === true };
  })()`);
  assert(back.pid === ctx.pid && back.title === ctx.name, "回到原项目驾驶舱（" + back.title + "）");
  assert(back.pillHidden, "返回后胶囊收起");

  /* ---------------- D 运行时错误 ---------------- */
  await sleep(600);
  const errs = cdp.errors.filter(e => !/favicon|ResizeObserver|net::ERR_ABORTED/i.test(e));
  assert(errs.length === 0, "无运行时错误" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));
}catch(ex){
  failed++;
  console.log("  FAIL 运行中断：" + (ex && ex.message || ex));
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){ /* noop */ }
  proc.kill("SIGTERM");
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){ /* noop */ }
  console.log("\n结果：" + passed + " 通过 / " + failed + " 失败");
  process.exit(failed ? 1 : 0);
}
