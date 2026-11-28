/* 用例列表键盘导航 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-kb-nav.mjs
   覆盖：↑↓ 高亮移动（is-kb 左蓝条，区别于勾选 is-selected）、边界钳制、Enter 开详情抽屉、
   行内控件（勾选/按钮）按键不拦截、重渲染后高亮保持。不写业务数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "admin123";
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
const port = 9233;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-kb-nav-"));
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
  const shot = async name => {
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
  const openCases = async () => {
    await call("Page.navigate", { url: BASE + "/#/testcases" });
    await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
    await waitFor(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++){ if (document.querySelector('[data-tc-open]')) return true; await wait(200); }
      const sel = document.getElementById('tcReq');
      if (sel){
        for (const opt of [...sel.options]){
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 20; i++){ if (document.querySelector('[data-tc-open]')) return true; await wait(150); }
        }
      }
      return !!document.querySelector('[data-tc-open]');
    })()`, "用例列表", 30000);
    await evaluate(`(() => {
      const sel = document.getElementById('tcReq');
      if (!sel || !/^__/.test(sel.value)) return true;
      const opt = [...sel.options].find(o => !/^__/.test(o.value));
      if (!opt) return true;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(`!!document.querySelector('[data-tc-open]')`, "具体项目用例列表", 30000);
  };
  /* 在 tcList 上派发按键；target 可选子元素（用于验证行内控件不拦截） */
  const key = (key, target) => evaluate(`(() => {
    const t = ${target ? target : 'document.getElementById("tcList")'};
    t.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const kbState = () => evaluate(`(() => {
    const rows = [...document.querySelectorAll("#tcList [data-tc-open]")];
    const kb = rows.find(r => r.classList.contains("is-kb"));
    const sel = rows.find(r => r.classList.contains("is-selected"));
    return { total: rows.length, kb: kb ? kb.dataset.tcOpen : null, kbCls: kb ? kb.className : "",
      sel: sel ? sel.dataset.tcOpen : null, distinct: !!(kb && sel) ? kb.dataset.tcOpen !== sel.dataset.tcOpen : true };
  })()`);

  console.log("用例列表键盘导航 E2E\n  地址：" + BASE);

  await login("admin");
  await openCases();
  await sleep(600);

  /* A ↑↓ 高亮移动与边界 */
  await key("ArrowDown");
  await sleep(150);
  let s = await kbState();
  assert(s.total > 0, "列表有可用例行（" + s.total + " 行）");
  assert(!!s.kb, "首次 ↓ 高亮第一行");
  const first = s.kb;
  await key("ArrowUp");
  await sleep(150);
  s = await kbState();
  assert(s.kb === first, "首行 ↑ 钳制不动（边界）");
  await key("ArrowDown"); await sleep(120);
  await key("ArrowDown"); await sleep(150);
  s = await kbState();
  const third = s.kb;
  assert(third && third !== first, "↓↓ 高亮移到第三行");
  await key("ArrowUp"); await sleep(150);
  s = await kbState();
  const rowIds = await evaluate(`[...document.querySelectorAll("#tcList [data-tc-open]")].map(r => r.dataset.tcOpen)`);
  assert(s.kb === rowIds[1], "↑ 回到第二行");

  /* B 高亮与勾选是两套视觉：勾选行不出现 is-kb，除非它就是高亮行 */
  await evaluate(`(() => {
    const row = document.querySelector('#tcList [data-tc-open]');
    const box = row.querySelector("input[type='checkbox']");
    if(box && !box.checked){ box.click(); }
    return true;
  })()`);
  await sleep(300);
  s = await kbState();
  assert(!!s.sel, "勾选后出现 is-selected");
  assert(!s.kbCls.includes("is-selected") || s.kb === s.sel, "is-kb 与 is-selected 是独立类名");
  await evaluate(`(() => {
    const box = document.querySelector('#tcList .tc-row.is-selected input[type="checkbox"]');
    if(box && box.checked) box.click();
    return true;
  })()`);
  await sleep(300);

  /* C Enter 开高亮行详情抽屉 */
  await key("Enter");
  await waitFor(`(() => {
    const d = document.getElementById('dlgCase'), v = document.getElementById('caseDetailView');
    return !!d && d.classList.contains('open') && !!v && !v.hidden && !!v.querySelector('h2');
  })()`, "Enter 打开详情抽屉");
  const opened = await evaluate(`(() => {
    const v = document.getElementById('caseDetailView');
    return { title: (v.querySelector('h2')||{}).textContent || "" };
  })()`);
  assert(opened.title.trim().length > 0, "Enter 打开的是高亮行详情（" + opened.title.trim().slice(0, 24) + "）");
  await shot("case-kb-nav.png");
  await evaluate(`(() => { const b = document.querySelector('#caseDetailView [data-case-close]'); if(b) b.click(); return true; })()`);
  await waitFor("getComputedStyle(document.getElementById('dlgCase')).display === 'none'", "关闭抽屉");
  await sleep(400);

  /* D 重渲染后高亮保持（caseRowHTML 随渲染恢复 is-kb） */
  s = await kbState();
  assert(!!s.kb, "关抽屉后高亮仍在（" + (s.kb || "").slice(0, 8) + "…）");

  /* E 行内控件按键不拦截：焦点在勾选框上按 ↓ 不移动高亮 */
  const before = (await kbState()).kb;
  await evaluate(`(() => {
    const row = document.querySelector('#tcList [data-tc-open]');
    const box = row.querySelector("input[type='checkbox']");
    box.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(200);
  s = await kbState();
  assert(s.kb === before, "勾选框内按 ↓ 不移动高亮（行内控件不拦截）");

  /* F 行内按钮按键不拦截 */
  const btnInfo = await evaluate(`(() => {
    const row = document.querySelector('#tcList [data-tc-open]');
    const btn = row.querySelector("button");
    if(!btn) return null;
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(200);
  s = await kbState();
  assert(btnInfo === true && s.kb === before, "行内按钮按 ↓ 不移动高亮");

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  assert(realErrors.length === 0, "无运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
