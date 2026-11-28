/* 测试域改版实施截图：对照原型逐页留证（工作台 / 空态 / 横幅 / 向导 / 计划详情 / 报告零数据）
   用法：node tools/e2e/testdomain-shots.mjs [输出目录] */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const OUT = path.resolve(process.argv[2] || "docs/audit/prototypes/testdomain-impl-2026-11-28");
fs.mkdirSync(OUT, { recursive: true });

function findChrome(){
  for(const bin of [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome", "chromium"
  ].filter(Boolean)){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-shots-"));
  const child = spawn(chrome, ["--headless=new","--remote-debugging-port=0","--user-data-dir=" + profile,
    "--no-first-run","--no-default-browser-check","--disable-gpu","--disable-extensions","--window-size=1440,900","about:blank"], { stdio: "ignore" });
  let cdp, sessionId, created = null;
  try{
    let port = null;
    const pf = path.join(profile, "DevToolsActivePort");
    for(let i = 0; i < 100 && !port; i++){ try{ port = Number(fs.readFileSync(pf, "utf8").split("\n")[0]); }catch(e){ await sleep(100); } }
    cdp = await (async () => {
      let version;
      const deadline = Date.now() + 15000;
      while(Date.now() < deadline){
        try{ const res = await fetch(`http://127.0.0.1:${port}/json/version`); if(res.ok){ version = await res.json(); break; } }catch(e){}
        await sleep(200);
      }
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
      return new Cdp(ws);
    })();
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    const call = (m, p) => cdp.send(m, p, sessionId);
    await call("Page.enable");
    const evaluate = async ex => {
      const res = await call("Runtime.evaluate", { expression: ex, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails) throw new Error((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text);
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (ex, label, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while(Date.now() < deadline){
        try{ if(await evaluate(ex)) return; }catch(e){}
        await sleep(150);
      }
      throw new Error("等待超时：" + label);
    };
    const shot = async name => {
      const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.data, "base64"));
      console.log("  " + name + ".png");
    };

    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete'", "登录页", 20000);
    await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));}; set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return 1; })()`);
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body.dataset.view`, "登录", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "初始化", 20000);

    const projectName = "截图 测试域 " + Date.now();
    created = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const p = await API.post("/api/reqs", { name: ${JSON.stringify(projectName)}, description: "截图", objective: "截图", status: "active", template: "blank" });
      return { id: p.id, name: p.name };
    })()`);
    const RID = created.id;

    /* 工作台（新用户视角：清空本机横幅记忆） */
    await evaluate(`(() => { localStorage.removeItem("ds.tcBenchWelcome"); localStorage.removeItem("ds.tcBenchTips"); location.hash = "#/testcases"; return 1; })()`);
    await waitFor(`document.body.dataset.view === "testcases"`, "测试域");
    await waitFor(`import("./js/views/testcases.js").then(m => m.currentTcMode() === "bench") && document.querySelectorAll("#tcBench .tb-flow-step").length === 4`, "工作台渲染");
    await sleep(400);
    await shot("home-1440-impl");

    /* 零用例空态 + 教育卡 */
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcProject(${JSON.stringify(RID)}))`);
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("cases"))`);
    await waitFor(`!!document.querySelector("#tcList .tc-empty-entries")`, "三入口空态");
    await sleep(300);
    await shot("cases-empty-1440-impl");

    /* 载入示例包 → 横幅 + 列表 */
    await evaluate(`(async () => { const { API } = await import("./js/core/api.js"); await API.post("/api/test-cases/sample-pack", { reqId: ${JSON.stringify(RID)} }); return 1; })()`);
    await call("Page.navigate", { url: BASE + "/index.html#/testcases" });
    await waitFor(`document.readyState === 'complete' && document.body.dataset.view`, "重载", 20000);
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(RID)}); return 1; })`);
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("cases"))`);
    await waitFor(`!document.getElementById("tcPackBanner").hidden`, "包横幅");
    await waitFor(`document.querySelectorAll("#tcList tbody tr, #tcList .tc-row").length >= 10 || document.getElementById("tcList").innerText.indexOf("示例") >= 0`, "用例列表");
    await sleep(300);
    await shot("cases-pack-1440-impl");

    /* 向导第 2 步 */
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("plans"))`);
    await waitFor(`!document.getElementById("tcPlans").hidden`, "计划列表");
    await evaluate(`document.getElementById("btnPlanNew").click()`);
    await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "向导");
    await evaluate(`(() => { const el=document.getElementById("pwName");Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,"v1.2 上线前回归");el.dispatchEvent(new Event("input",{bubbles:true})); return 1; })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane2").hidden`, "向导第 2 步");
    await sleep(300);
    await shot("plan-wizard-1440-impl");

    /* 整个项目模式创建 → 计划详情（下一步提示条） */
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane3").hidden`, "向导第 3 步");
    await evaluate(`document.getElementById("pwCreate").click()`);
    await waitFor(`!!document.querySelector("#tcPlans .plan-next")`, "计划详情提示条");
    await sleep(400);
    await shot("plan-detail-1440-impl");

    /* 报告零数据 */
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("report"))`);
    await waitFor(`!!document.querySelector("#tcReport .rep-guide")`, "报告零数据");
    await sleep(300);
    await shot("report-zero-1440-impl");

    /* 390 工作台 */
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("bench"))`);
    await waitFor(`!document.getElementById("tcBench").hidden && document.querySelectorAll("#tcBench .tb-flow-step").length === 4`, "移动工作台");
    await sleep(400);
    await shot("home-390-impl");
    await call("Emulation.clearDeviceMetricsOverride");

    console.log("截图完成 → " + OUT);
  }finally{
    try{
      if(cdp && sessionId && created && created.id){
        await cdp.send("Runtime.evaluate", { expression: `(async () => { const { API } = await import("./js/core/api.js"); await API.del("/api/reqs/" + encodeURIComponent(${JSON.stringify(created.id)}) + "?confirm=" + encodeURIComponent(${JSON.stringify(created.name)})); return 1; })()`, awaitPromise: true, returnByValue: true }, sessionId);
      }
    }catch(e){ console.log("  清理失败，请手工删除 " + (created && created.name)); }
    try{ cdp && cdp.ws.close(); }catch(e){}
    try{ child.kill("SIGKILL"); }catch(e){}
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
  }
}
main().catch(e => { console.error("FAIL：" + e.message); process.exitCode = 1; });
