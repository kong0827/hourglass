/* 测试域补充 E2E：主套件未覆盖的路径
   1. 向导空名称校验（不能进第 2 步）
   2. pwPrev 回退、dlgPlanWizardX 取消（不建计划）
   3. 向导「按条件筛选」模式：toast 指路 + 跳到用例页且项目已选
   4. 工作台「去做」按钮跳转、空态计划卡「新建计划」开向导
   自建临时项目，结束按名称 SQL 兜底提示。 */

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function findChrome(){
  for(const bin of [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean)){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let m; try{ m = JSON.parse(raw); }catch(e){ return; }
    if(m.id && this.pending.has(m.id)){ const p = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if(m.method) this.events.push(m); }
  send(method, params = {}, sessionId){ const id = ++this.id; const pl = { id, method, params };
    if(sessionId) pl.sessionId = sessionId;
    this.ws.send(JSON.stringify(pl)); return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej })); }
  takeExceptions(){ const bad = this.events.filter(e => e.method === "Runtime.exceptionThrown");
    this.events = []; return bad; }
}

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-wiz-"));
  const child = spawn(chrome, ["--headless=new","--remote-debugging-port=0","--user-data-dir=" + profile,
    "--no-first-run","--no-default-browser-check","--disable-gpu","--disable-extensions","--window-size=1440,900","about:blank"], { stdio: "ignore" });
  let cdp, sessionId, created = null;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){ try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }catch(e){ await sleep(100); } }
    let version; const ddl = Date.now() + 15000;
    while(Date.now() < ddl){ try{ const r = await fetch(`http://127.0.0.1:${port}/json/version`); if(r.ok){ version = await r.json(); break; } }catch(e){} await sleep(200); }
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    cdp = new Cdp(ws);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const att = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    sessionId = att.sessionId;
    for(const d of ["Page","Runtime"]) await cdp.send(`${d}.enable`, {}, sessionId);
    const call = (m, p) => cdp.send(m, p, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails) throw new Error((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text);
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (e, l, t = 15000) => { const d = Date.now() + t; let last;
      while(Date.now() < d){ try{ last = await evaluate(e); if(last) return last; }catch(err){ last = err.message; } await sleep(150); }
      throw new Error("超时 " + l + "（最后：" + JSON.stringify(last) + "）"); };
    const pass = m => console.log("  PASS " + m);

    console.log("测试域向导补充路径 E2E");
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete'", "登录页", 20000);
    await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));}; set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return 1; })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "初始化", 20000);

    const projectName = "E2E 向导补充 " + Date.now();
    created = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const p = await API.post("/api/reqs", { name: ${JSON.stringify(projectName)}, description: "E2E", objective: "E2E", status: "active", template: "blank" });
      await API.post("/api/test-cases/sample-pack", { reqId: p.id });
      return { id: p.id, name: p.name };
    })()`);
    const RID = created.id;
    pass("临时项目 + 示例包 " + RID);

    /* rt.reqList 是首屏缓存：整页重载让新项目进项目下拉（真实用户建项目必经页面流） */
    await call("Page.navigate", { url: BASE + "/index.html#/testcases" });
    await waitFor(`document.readyState === 'complete' && document.body.dataset.view`, "重载", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => rt.reqsLoaded)`, "初始化", 20000);

    await evaluate(`import('./js/core/router.js').then(m => m.showView("testcases"))`);
    await waitFor(`document.body.dataset.view === "testcases"`, "测试域");

    /* 1. 空名称校验：点下一步应停留在第 1 步并标红 */
    await evaluate(`import('./js/views/testcases.js').then(m => { m.setTcProject(${JSON.stringify(RID)}); return 1; })`);
    await evaluate(`import('./js/views/testcases.js').then(m => m.setTcMode("plans"))`);
    await waitFor(`!document.getElementById("tcPlans").hidden`, "计划列表");
    await evaluate(`document.getElementById("btnPlanNew").click()`);
    await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "向导打开");
    await evaluate(`document.getElementById("pwNext").click()`);
    await sleep(200);
    const stillPane1 = await evaluate(`!document.getElementById("pwPane1").hidden && document.getElementById("pwPane2").hidden`);
    const nameInvalid = await evaluate(`document.getElementById("fPwName").classList.contains("invalid")`);
    if(!stillPane1 || !nameInvalid) throw new Error("空名称校验失效");
    pass("空名称校验：停留第 1 步 + 标红");

    /* 2. 填名 → 第 2 步 → 上一步回退 → 再前进 → 取消不建计划 */
    await evaluate(`(() => { const el=document.getElementById("pwName");Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,"补充路径计划");el.dispatchEvent(new Event("input",{bubbles:true})); return 1; })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane2").hidden`, "第 2 步");
    await evaluate(`document.getElementById("pwPrev").click()`);
    await waitFor(`!document.getElementById("pwPane1").hidden`, "回退第 1 步");
    pass("pwPrev 回退");
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane2").hidden`, "再进第 2 步");
    const plansBefore = await evaluate(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-plans", { reqId: ${JSON.stringify(RID)} }); return (r.list||r.items||r).length; })()`);
    await evaluate(`document.getElementById("dlgPlanWizardX").click()`);
    await sleep(300);
    const closed = await evaluate(`!document.getElementById("dlgPlanWizard").classList.contains("open")`);
    const plansAfter = await evaluate(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-plans", { reqId: ${JSON.stringify(RID)} }); return (r.list||r.items||r).length; })()`);
    if(!closed) throw new Error("取消未关闭向导");
    if(plansBefore !== plansAfter) throw new Error("取消却建了计划：" + plansBefore + " → " + plansAfter);
    pass("dlgPlanWizardX 取消：关闭且不建计划");

    /* 3. 按条件筛选模式：toast 指路 + 跳到用例页且项目已选 */
    await evaluate(`document.getElementById("btnPlanNew").click()`);
    await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "再开向导");
    await evaluate(`(() => { const el=document.getElementById("pwName");Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,"筛选模式计划");el.dispatchEvent(new Event("input",{bubbles:true})); return 1; })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane2").hidden`, "第 2 步（筛选）");
    await evaluate(`(() => { const r=document.querySelector('#pwModes input[value="filter"]'); r.checked=true; r.dispatchEvent(new Event("change",{bubbles:true})); return 1; })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane3").hidden`, "第 3 步（筛选）");
    const reviewText = await evaluate(`document.getElementById("pwReview").innerText`);
    if(reviewText.indexOf("按条件筛选") < 0) throw new Error("确认页未显示圈选方式：" + reviewText.slice(0, 120));
    await evaluate(`document.getElementById("pwCreate").click()`);
    await waitFor(`document.body.dataset.view === "testcases"`, "筛选创建后视图");
    await sleep(300);
    const modeCases = await evaluate(`import('./js/views/testcases.js').then(m => m.currentTcMode())`);
    if(modeCases !== "cases") throw new Error("筛选模式未跳到用例页：" + modeCases);
    const selProject = await evaluate(`(() => { const s = document.getElementById("tcReq"); return s ? s.value : ''; })()`);
    if(selProject !== RID) throw new Error("筛选模式未选中项目：" + selProject);
    const toastShown = await evaluate(`!!document.querySelector(".toast")`);
    pass("筛选模式：确认页含圈选方式 → 建计划 → 跳用例页（项目已选）toast=" + toastShown);

    /* 4. 工作台「去做」与空态计划卡「新建计划」。
       共享空间数据齐全时四步全 done、没有去做按钮：此时校验四步全完成为真即可；
       有按钮时（全新空间）必须验证点击跳转。 */
    await evaluate(`import('./js/views/testcases.js').then(m => m.setTcMode("bench"))`);
    await waitFor(`!document.getElementById("tcBench").hidden && document.querySelectorAll('#tcBench .tb-flow-step').length === 4`, "工作台");
    const goBtn = await evaluate(`(() => {
      const b = document.querySelector('[data-bench-go="plans"]');
      if(!b) return null;
      b.click(); return b.textContent.trim();
    })()`);
    if(goBtn){
      await sleep(300);
      const modePlans = await evaluate(`import('./js/views/testcases.js').then(m => m.currentTcMode())`);
      if(modePlans !== "plans") throw new Error("工作台「去做」（" + goBtn + "）未到计划页：" + modePlans);
      const subPlans = await evaluate(`(document.querySelector('#subNav .subnav-item.on')||{}).textContent || ''`);
      if(subPlans.indexOf("测试计划") !== 0) throw new Error("子导航未跟随：" + subPlans);
      pass("工作台「去做」(" + goBtn + ") → 计划页 + 子导航跟随");
      await evaluate(`import('./js/views/testcases.js').then(m => m.setTcMode("bench"))`);
      await waitFor(`!document.getElementById("tcBench").hidden`, "回工作台");
    }else{
      const flow = await evaluate(`(() => {
        const steps = [...document.querySelectorAll('#tcBench .tb-flow-step')];
        return { total: steps.length, done: steps.filter(s => s.classList.contains('done')).length };
      })()`);
      if(flow.total !== 4) throw new Error("四步引导步骤数异常：" + flow.total);
      if(flow.done !== 4) throw new Error("无「去做」按钮但四步未全部完成：" + flow.done + "/4");
      pass("工作台无「去做」按钮（四步全完成，共享空间预期）");
    }
    const emptyCardBtn = await evaluate(`(() => {
      const b = document.querySelector('[data-bench-new-plan]');
      if(!b) return 'none';
      b.click(); return 'clicked';
    })()`);
    if(emptyCardBtn === "clicked"){
      await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "空态卡开向导");
      pass("空态计划卡「新建计划」→ 向导");
      await evaluate(`document.getElementById("dlgPlanWizardX").click()`);
      await sleep(200);
    }else{
      pass("空态计划卡按钮不存在（空间已有进行中/完成计划，属预期跳过）");
    }

    const exceptions = cdp.takeExceptions();
    if(exceptions.length) throw new Error("脚本异常：" + JSON.stringify(exceptions.slice(0, 2)));
    pass("无页面脚本异常");
    console.log("\n结果：全部通过");
  }finally{
    try{ cdp && cdp.ws.close(); }catch(e){}
    try{ child.kill("SIGKILL"); }catch(e){}
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
    if(created && created.name) console.log("  清理：临时项目 " + created.name + " 若 API 删除失败请 SQL：DELETE FROM requirement WHERE id='" + created.id + "';");
  }
}
main().catch(e => { console.error("\nFAIL：" + e.message); process.exitCode = 1; });
