/* 探针：视图内 setTcMode 切换后全局子导航高亮必须跟随。
   覆盖 工作台→计划→报告→用例 切换与 no-op 重复切换。 */

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if(msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
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

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-subnav-"));
  const child = spawn(chrome, ["--headless=new","--remote-debugging-port=0","--user-data-dir=" + profile,
    "--no-first-run","--no-default-browser-check","--disable-gpu","--disable-extensions","--window-size=1440,900","about:blank"], { stdio: "ignore" });
  let cdp, sessionId;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }catch(e){ await sleep(100); }
    }
    const deadline = Date.now() + 15000;
    let version;
    while(Date.now() < deadline){
      try{
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if(res.ok){ version = await res.json(); break; }
      }catch(e){}
      await sleep(200);
    }
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    cdp = new Cdp(ws);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    for(const d of ["Page","Runtime"]) await cdp.send(`${d}.enable`, {}, sessionId);
    const call = (m, p) => cdp.send(m, p, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails) throw new Error((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text);
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 12000) => {
      const dl = Date.now() + timeout;
      while(Date.now() < dl){
        const v = await evaluate(expression);
        if(v) return v;
        await sleep(150);
      }
      throw new Error("等待超时：" + label);
    };

    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete'", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(process.env.E2E_USER || "admin")});
      set("uPass", ${JSON.stringify(process.env.E2E_PASS || "admin123")});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "初始化", 20000);
    await evaluate(`import('./js/core/router.js').then(m => m.showView("testcases"))`);
    await waitFor(`document.body.dataset.view === "testcases"`, "测试视图");

    const seq = process.env.E2E_WS || "SXk01";
    const activeTab = `(() => {
      const on = document.querySelector('#subNav .subnav-item.on');
      return on ? on.textContent.replace(/\\s+/g, '') : '';
    })()`;
    const checks = [["bench","工作台"],["plans","测试计划"],["report","报告"],["cases","用例"],["defects","缺陷"]];
    for(const [mode, expect] of checks){
      await evaluate(`import('./js/views/testcases.js').then(m => { m.setTcMode(${JSON.stringify(mode)}); return 1; })`);
      await sleep(250);
      const got = await evaluate(activeTab);
      if(!got.startsWith(expect)) throw new Error(`模式 ${mode}：子导航高亮「${got}」应为「${expect}」开头`);
      console.log("  PASS setTcMode(" + mode + ") → 高亮「" + got + "」");
    }
    /* 重复切换同模式（no-op 分支）不应破坏高亮 */
    await evaluate(`import('./js/views/testcases.js').then(m => { m.setTcMode("report"); return 1; })`);
    await sleep(200);
    const got = await evaluate(activeTab);
    if(!got.startsWith("报告")) throw new Error("no-op 切换后高亮丢失：" + got);
    console.log("  PASS no-op 切换保持高亮");
    console.log("\n结果：全部通过");
  }finally{
    try{ cdp && cdp.ws.close(); }catch(e){}
    try{ child.kill("SIGKILL"); }catch(e){}
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
  }
}
main().catch(err => { console.error("\nFAIL：" + err.message); process.exitCode = 1; });
