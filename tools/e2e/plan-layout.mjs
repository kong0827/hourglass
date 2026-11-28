/* 测试计划列表 / 计划内用例行的栅格回归（纯前端，无 SQL）
   用法：node tools/e2e/plan-layout.mjs
   环境变量：E2E_BASE（默认本地 8081）、E2E_USER / E2E_PASS（默认 admin / admin123）
   背景：用例表的九列栅格曾覆盖计划行（主体被压到 50px）和计划内用例行（主体 96px），
   标题逐字换行把整行撑成竖条。这里断言两类行各自只有四格 / 五格且主体有正常宽度。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } }
  send(method, params = {}, sessionId){ const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  for(const bin of candidates){
    if(fs.existsSync(bin)) return bin;
  }
  throw new Error("找不到 Chrome");
}

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

const chrome = findChrome();
const port = 9361;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-layout-e2e-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1600,1100", "--disable-dev-shm-usage", "--hide-scrollbars"], { stdio: "ignore" });

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
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
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
  const enterPlans = async () => {
    await evaluate(`(() => { const b = document.querySelector('[data-tc-mode="plans"]'); b && b.click(); return true; })()`);
    await waitFor("!!document.getElementById('tcReq')", "计划页签");
  };

  await call("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete'", "登录页");

  const login = await evaluate(`(async () => {
    await fetch("api/health", { credentials: "same-origin" });
    const m = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
    const body = "username=" + encodeURIComponent(${JSON.stringify(USER)}) + "&password=" + encodeURIComponent(${JSON.stringify(PASS)});
    const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": m ? decodeURIComponent(m[1]) : "" };
    let r = await fetch("api/auth/login", { method: "POST", credentials: "same-origin", headers, body });
    if(r.status === 401){
      /* 本地栈用 AUTH_USER / AUTH_PASSWORD 配了基础认证兜底，密码漂移时仍能进 */
      r = await fetch("api/auth/login", { method: "POST", credentials: "same-origin",
        headers: Object.assign({}, headers, { Authorization: "Basic " + btoa(${JSON.stringify(USER)} + ":" + ${JSON.stringify(PASS)}) }), body });
    }
    return r.status + " " + (await r.text());
  })()`);
  assert(/^200/.test(login), "登录成功：" + login);

  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 30000);
  await enterPlans();

  /* 当前空间逐个项目找测试计划 */
  const scanProjects = async () => {
    const opts = await evaluate(`(() => {
      const sel = document.getElementById('tcReq');
      return sel ? [...sel.options].filter(o => o.value && o.value !== '__all__').map(o => ({ v: o.value, t: o.textContent.trim() })) : [];
    })()`);
    for(const opt of opts){
      await evaluate(`(() => {
        const sel = document.getElementById('tcReq');
        sel.value = ${JSON.stringify(opt.v)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      for(let i = 0; i < 20; i++){
        if(await evaluate("!!document.querySelector('[data-plan-open]')")) return opt.t;
        await sleep(200);
      }
    }
    return null;
  };

  /* 换空间：点开侧栏空间菜单 → 点第 idx 个非当前空间 → 确认 → 等重载 → 回计划页 */
  const switchWorkspace = async idx => {
    const items = await evaluate(`(async () => {
      const sw = document.getElementById('wsSwitch');
      if(!sw) return [];
      sw.click();
      await new Promise(r => setTimeout(r, 400));
      return [...document.querySelectorAll('#wsList .ws-item')]
        .filter(x => x.offsetParent !== null)
        .map(x => ({ text: (x.getAttribute('data-ws-name') || x.textContent).trim(), cur: x.classList.contains('on') }));
    })()`);
    const next = items.filter(x => !x.cur)[idx];
    if(!next) return null;
    const opened = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#wsList .ws-item')]
        .filter(x => x.offsetParent !== null && !x.classList.contains('on'))[${idx}];
      if(!b) return false;
      b.click();
      return true;
    })()`);
    if(!opened) return null;
    await sleep(500);
    try{
      await evaluate(`(() => { const go = [...document.querySelectorAll('button')].find(x => /^切\\s*换$/.test(x.textContent.trim())); if(go) go.click(); return true; })()`);
    }catch(e){ /* 确认后整页重载，执行上下文会被销毁 */ }
    await sleep(3500);
    await enterPlans();
    return scanProjects();
  };

  let found = await scanProjects();
  for(let i = 0; !found && i < 8; i++) found = await switchWorkspace(i);
  assert(!!found, "找到有测试计划的项目：" + found);
  if(!found) throw new Error("没有可验证的测试计划");

  const planRow = await evaluate(`(() => {
    const r = document.querySelector('#tcPlans .tc-row.plan-row');
    if(!r) return null;
    const main = r.querySelector('.tc-main');
    return { cols: getComputedStyle(r).gridTemplateColumns.split(" ").length,
      h: Math.round(r.getBoundingClientRect().height),
      mainW: Math.round(main.getBoundingClientRect().width) };
  })()`);
  console.log("  计划行：" + JSON.stringify(planRow));
  assert(planRow && planRow.cols === 4, "计划行是四格栅格（状态 / 主体 / 计数 / 操作）");
  assert(planRow && planRow.mainW >= 240, "计划行主体宽度正常（" + (planRow && planRow.mainW) + "px >= 240px）");
  assert(planRow && planRow.h <= 90, "计划行没有被逐字换行撑高（" + (planRow && planRow.h) + "px <= 90px）");

  await evaluate(`(() => { const r = document.querySelector('#tcPlans [data-plan-open]'); r && r.click(); return true; })()`);
  await waitFor("!!document.querySelector('#tcPlans .plan-case')", "计划详情", 25000);
  const caseRow = await evaluate(`(() => {
    const r = document.querySelector('#tcPlans .plan-case');
    const main = r.querySelector('.tc-main');
    return { children: r.children.length,
      cols: getComputedStyle(r).gridTemplateColumns.split(" ").length,
      h: Math.round(r.getBoundingClientRect().height),
      mainW: Math.round(main.getBoundingClientRect().width) };
  })()`);
  console.log("  计划内用例行：" + JSON.stringify(caseRow));
  assert(caseRow && caseRow.children >= 4 && caseRow.cols === 5, "计划内用例行是五格栅格（勾选 / 编号 / 结果 / 主体 / 操作）");
  assert(caseRow && caseRow.mainW >= 240, "计划内用例主体宽度正常（" + (caseRow && caseRow.mainW) + "px >= 240px）");
  assert(caseRow && caseRow.h <= 90, "计划内用例行没有被逐字换行撑高（" + (caseRow && caseRow.h) + "px <= 90px）");

  if(failed) throw new Error(failed + " 项断言失败");
  console.log("\n全部通过");
} catch(e){
  console.error("FAIL: " + e.message);
  process.exitCode = 1;
} finally {
  proc.kill("SIGKILL");
}
