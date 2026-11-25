/* 「开发 / 测试」正名为「测试窗口外 / 测试窗口内」后的三处界面截图核对：
   项目驾驶舱模块表、版本页阶段工时汇总、版本详情工时分布。
   用法：E2E_BASE=http://127.0.0.1:8094/hourglass node tools/e2e/investment-rename-surfaces.mjs
   断言：三处都不再出现「开发 / 测试」两列旧名，脚注/口径说明含窗口内外的解释；产出 1440 截图。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zcftmwwnrwuon";
const PORT = Number(process.env.CDP_PORT || 9252);
const SHOT_DIR = path.resolve("docs/audit/prototypes/investment-drill-2026-11-15/impl");

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
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.badResponses = [];
    this.reqs = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.requestWillBeSent"){
      this.reqs.set(msg.params.requestId, { method: msg.params.request.method, url: msg.params.request.url });
    }else if(msg.method === "Network.responseReceived"){
      const req = this.reqs.get(msg.params.requestId) || {};
      if(msg.params.response.status >= 400 && (req.url || "").indexOf("/api/") !== -1){
        this.badResponses.push((req.method || "?") + " " + msg.params.response.status + " " + (req.url || msg.params.response.url));
      }
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

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const group = name => console.log("\n[" + name + "]");

fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inv-rename-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let evaluate, waitFor, call, cdp, ws;

try{
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const api = body => evaluate(`(async () => { const { API } = await import("./js/core/api.js"); ${body} })()`);
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const scrollTo = expr => evaluate(`(() => { const el = ${expr}; if(!el) return false; el.scrollIntoView({ block:"start" }); window.scrollBy(0, -110); return true; })()`);
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);

  group("登录");
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && !!document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await api(`await API.post("/api/workspaces/" + ${JSON.stringify(WS)} + "/select", {}); return true;`);
  pass("登录 " + USER + " 并选定空间");

  group("项目驾驶舱模块表");
  await call("Page.navigate", { url: BASE + "/#/projects" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded && document.body.dataset.view === "projects")`, "项目列表", 25000);
  await waitFor(`!!document.querySelector("[data-req-cockpit]")`, "项目行渲染");
  await click("[data-req-cockpit]");
  await waitFor(`document.body.dataset.view === "project" && !!document.querySelector("#projectBody table")`, "项目驾驶舱", 25000);
  const cockpit = await waitFor(`(() => {
    const ths = [...document.querySelectorAll("#projectBody thead th")].map(th => th.textContent.trim());
    const has = ths.indexOf("窗口外") !== -1 && ths.indexOf("窗口内") !== -1;
    if(!has) return false;
    return { ths, caliber: (document.querySelector("#projectBody .project-modules-caliber") || {}).textContent || "" };
  })()`, "模块表窗口内外列", 15000);
  assert(cockpit.ths.join("|").indexOf("窗口外") !== -1 && cockpit.ths.join("|").indexOf("窗口内") !== -1,
    "模块表表头为「窗口外 / 窗口内」：" + cockpit.ths.join(" / "));
  assert(!cockpit.ths.some(t => t === "开发" || t === "测试"), "模块表不再有「开发 / 测试」旧表头");
  assert(/窗口外含评审、设计、开发、运维等/.test(cockpit.caliber), "模块表口径说明写明窗口外包含非测试时间");
  const kpiActual = await evaluate(`(() => {
    const t = document.body.innerText;
    return /窗口外 [\\d.]+h? · 窗口内/.test(t);
  })()`);
  assert(!!kpiActual, "驾驶舱「实际投入」的副标题改为窗口外 / 窗口内");
  await scrollTo(`[...document.querySelectorAll("#projectBody .panel-head h3")].map(h => h.closest(".panel")).filter(p => p && /模块/.test(p.querySelector("h3").textContent))[0]`);
  await sleep(400);
  await shot("cockpit-modules-1440.png");

  group("版本页阶段工时汇总");
  await call("Page.navigate", { url: BASE + "/#/phase" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.reqsLoaded && document.body.dataset.view === "phase")`, "版本页", 25000);
  /* 阶段工时汇总只出现在「按版本」模式；懒加载模块绑定事件前点按钮会没反应，等版本数据渲染完再点 */
  await waitFor(`(() => {
    const body = document.getElementById("phaseBody");
    return !!body && !body.querySelector(".skeleton") && body.textContent.trim().length > 0;
  })()`, "阶段视图渲染", 25000);
  await click('[data-pmode="phase"]');
  await waitFor(`!!document.querySelector('[data-pmode="phase"][aria-pressed="true"]')`, "切到首版 / 迭代分析", 15000);
  /* 阶段表只在选定单个版本时出现（默认是全部版本对比）；挑第一个具体版本 */
  const pickedVer = await waitFor(`(() => {
    const sel = document.querySelector("[data-rollup] select[data-rollup-ver]");
    if(!sel) return false;
    const opt = [...sel.options].filter(o => o.value && o.value !== "__all")[0];
    if(!opt) return false;
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, label: opt.textContent.trim() };
  })()`, "选定汇总版本", 15000);
  const rollup = await waitFor(`(() => {
    const sec = document.querySelector("[data-rollup]");
    if(!sec || !sec.querySelector("tbody tr[data-rollup-group]")) return false;
    const ths = [...sec.querySelectorAll("thead th")].map(th => th.textContent.trim());
    if(ths.indexOf("阶段") !== 0) return false;
    return { ths, text: sec.textContent };
  })()`, "阶段工时汇总", 20000);
  pass("阶段工时汇总选中版本：" + pickedVer.label);
  /* 阶段分组时三行本身就是产品 / 设计、开发、测试，表头不再重复这三列；切到「模块」维度才出现窗口拆分列 */
  assert(rollup.ths.indexOf("阶段") === 0, "阶段分组表头首列为「阶段」：" + rollup.ths.join(" / "));
  assert(rollup.text.indexOf("产品 / 设计") !== -1 && rollup.text.indexOf("开发") !== -1 && rollup.text.indexOf("测试") !== -1,
    "阶段行命名为产品 / 设计、开发、测试");
  assert(/测试窗口（提测 → 测试结束）/.test(rollup.text), "汇总口径说明测试取窗口内");
  await click('[data-rollup-dim="module"]');
  const modHead = await waitFor(`(() => {
    const sec = document.querySelector("[data-rollup]");
    if(!sec) return false;
    const ths = [...sec.querySelectorAll("thead th")].map(th => th.textContent.trim());
    return ths.indexOf("窗口外") !== -1 ? ths : false;
  })()`, "模块维度拆分列", 15000);
  assert(modHead.indexOf("窗口外") !== -1 && modHead.indexOf("窗口内") !== -1, "模块维度表头含窗口外 / 窗口内：" + modHead.join(" / "));
  const oldNames = await evaluate(`[...document.querySelectorAll("[data-rollup] thead th")].map(th => th.textContent.trim()).filter(t => t === "开发" || t === "测试")`);
  assert(oldNames.length === 0, "汇总表不再有「开发 / 测试」旧列");
  await click('[data-rollup-dim="stage"]');
  const split = await evaluate(`(() => {
    const sec = document.querySelector("[data-rollup]");
    const aria = (sec.querySelector(".roll-split") || {}).getAttribute ? sec.querySelector(".roll-split").getAttribute("aria-label") : "";
    return { aria: aria || "", legend: (sec.querySelector(".roll-split-legend") || {}).textContent || "" };
  })()`);
  assert(/实际工时中产品 \/ 设计/.test(split.aria) && split.aria.indexOf("开发") !== -1 && split.aria.indexOf("测试") !== -1,
    "拆分条读屏文案为产品 / 设计、开发、测试：" + split.aria);
  await scrollTo(`document.querySelector("[data-rollup]")`);
  await sleep(400);
  await shot("phase-rollup-1440.png");

  group("版本详情工时分布");
  /* 版本卡只在「按版本」列表；先切回再取第一张卡 */
  await click('[data-pmode="version"]');
  await waitFor(`!!document.querySelector('[data-ver-open]')`, "版本卡渲染", 15000);
  const verPick = await evaluate(`(() => {
    const btn = [...document.querySelectorAll("[data-ver-open]")].filter(b => b.getAttribute("data-ver-open"))[0];
    return btn ? { id: btn.getAttribute("data-ver-open"), req: btn.getAttribute("data-ver-req") || "" } : null;
  })()`);
  assert(!!verPick, "找到一个可打开的版本（" + (verPick ? verPick.id : "无") + "）");
  /* 版本卡上的「版本详情」按钮可能不带 data-ver-req，从版本行或当前项目补 */
  const projId = verPick && verPick.req ? verPick.req : await evaluate(`(() => {
    const row = document.querySelector('[data-ver-row="${verPick.id}"]');
    return (row && row.getAttribute("data-ver-req")) || import("./js/core/state.js").then(({rt}) => rt.phaseReqId || "");
  })()`);
  console.log("  version req = " + JSON.stringify(projId));
  await evaluate(`import("./js/views/version.js").then(m => m.openVersionDetail(${JSON.stringify(projId)}, ${JSON.stringify(verPick.id)}, "overview"))`);
  await sleep(800);
  const hoursCard = await waitFor(`(() => {
    const p = document.querySelector(".vd-panel.vd-hours-card");
    return p ? { text: p.textContent } : false;
  })()`, "工时卡", 20000);
  assert(/工时/.test(hoursCard.text), "版本详情概览出现工时卡");
  /* 工时构成收进弹层：实际 → 类型 Tab 里看阶段卡 */
  await click('[data-vd-hours="actual"]');
  await waitFor(`!!document.querySelector(".vd-h-sheet")`, "工时构成弹层", 15000);
  await click('[data-vd-htab="type"]');
  const stageCards = await waitFor(`(() => {
    const cards = [...document.querySelectorAll(".vd-h-sheet .vd-h-proxy-card")];
    if(cards.length < 3) return false;
    return { n: cards.length, text: document.querySelector(".vd-h-sheet").textContent };
  })()`, "阶段卡", 15000);
  assert(stageCards.n === 3, "实际工时构成按类型 Tab 出现三张阶段卡：" + stageCards.n);
  assert(/按阶段看投入/.test(stageCards.text) && /产品 \/ 设计/.test(stageCards.text) && /开发/.test(stageCards.text) && /测试/.test(stageCards.text),
    "阶段卡命名为产品 / 设计、开发、测试");
  assert(/类型是工作项分类，不是阶段/.test(stageCards.text), "类型 Tab 说明类型不是阶段");
  await click('[data-vd-htab="window"]');
  const stageRows = await waitFor(`(() => {
    const stages = [...document.querySelectorAll(".vd-h-sheet .vd-h-stage")].map(s => s.textContent.trim());
    return stages.length ? stages : false;
  })()`, "计时窗口分组", 15000);
  assert(stageRows.some(t => t.indexOf("测试窗口外") === 0) && stageRows.some(t => t.indexOf("测试窗口内") === 0),
    "计时窗口分组出现测试窗口外 / 测试窗口内：" + stageRows.map(t => t.substring(0, 20)).join(" | "));
  await sleep(400);
  await shot("version-hours-1440.png");

  group("收尾");
  assert(cdp.badResponses.length === 0, "无 4xx/5xx 接口（" + (cdp.badResponses.join(" | ") || "0") + "）");
  assert(cdp.errors.length === 0, "无控制台错误（" + (cdp.errors.join(" | ") || "0") + "）");
  console.log("\n结果：PASS " + passed + " / FAIL " + failed);
  if(failed) process.exitCode = 1;
}catch(e){
  console.error("\n执行失败：" + e.message);
  process.exitCode = 1;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
