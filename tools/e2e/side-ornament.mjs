/* 侧栏沙漏摆件 E2E：开关、7 个形态、持久化、关闭态禁用、恢复默认
   运行：node tools/e2e/side-ornament.mjs
   前置：预览前端在线（E2E_BASE，默认 http://127.0.0.1:8082/hourglass）与后端在线，
        账号有个人设置权限（E2E_USER / E2E_PASS，默认 admin / 123456）。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const PICK_KEY = "ds.ornament.v1";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = Number(process.env.E2E_PORT || 9478);
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "orn-e2e-")),
   "--no-first-run", "--window-size=1440,1000", "--disable-dev-shm-usage"], { stdio: "ignore" });

let failed = 0;
const check = (cond, msg) => { console.log((cond ? "  PASS " : "  FAIL ") + msg); if (!cond) failed++; };

try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if(msg.id && pending.has(msg.id)){ const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); return; }
    if(msg.method === "Runtime.exceptionThrown") errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    const payload = { id:i, method, params };
    if(sessionId) payload.sessionId = sessionId;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
  const target = await send("Target.createTarget", { url:"about:blank" });
  const attached = await send("Target.attachToTarget", { targetId:target.targetId, flatten:true });
  const sessionId = attached.sessionId;
  const call = (m, p) => send(m, p, sessionId);
  for(const d of ["Page", "Runtime", "Network"]) await call(`${d}.enable`);
  try{ await call("Network.setBypassServiceWorker", { bypass:true }); }catch(e){}
  await call("Emulation.setDeviceMetricsOverride", { width:1440, height:1000, deviceScaleFactor:1, mobile:false, screenWidth:1440, screenHeight:1000 });

  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true, userGesture:true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const snapshot = () => evaluate(`(function(){
    var slot=document.getElementById("sideOrnament"), svg=slot&&slot.querySelector("svg");
    var cols=document.querySelectorAll("#meOrnGrid [data-orn]");
    return {
      slot:!!slot, hidden:slot?slot.hidden:null, cls:svg?svg.getAttribute("class"):null,
      tiles:cols.length,
      checked:[].filter.call(cols,function(b){return b.getAttribute("aria-checked")==="true";}).map(function(b){return b.getAttribute("data-orn");}).join(),
      disabled:cols.length?cols[0].disabled:null,
      on:document.getElementById("meOrnOn").checked,
      reason:!document.getElementById("meOrnReason").hidden,
      pref:localStorage.getItem(${JSON.stringify(PICK_KEY)})
    };
  })()`);

  console.log("侧栏沙漏摆件 E2E\n  地址：" + BASE);
  await call("Page.navigate", { url:BASE + "/login.html" });
  await waitFor("document.readyState==='complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(function(){
    var set=function(id,v){var el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
    set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click(); return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login')===-1 && !!document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(function(s){return !!s.rt.currentUser && !!s.rt.reqsLoaded;})`, "应用初始化", 25000);
  await evaluate(`localStorage.removeItem(${JSON.stringify(PICK_KEY)}); true`);
  await call("Page.reload");
  await waitFor(`import("./js/core/state.js").then(function(s){return !!s.rt.currentUser && !!s.rt.reqsLoaded;})`, "清偏好后初始化", 25000);

  let s = await snapshot();
  check(s.slot && s.hidden === false, "侧栏摆件默认显示");
  check(s.cls === "hg", "默认渲染经典沙漏");

  await evaluate(`import("./js/core/router.js").then(function(m){ m.showView("profile"); })`);
  await waitFor("document.querySelectorAll('#meOrnGrid [data-orn]').length===7", "外观面板");
  check(true, "个人设置出现「外观」7 个形态");

  await evaluate(`document.querySelector('#meOrnGrid [data-orn=jelly]').click(); true`);
  await sleep(350);
  s = await snapshot();
  check(s.cls === "art a2", "切到水母立即生效");
  check(s.pref === '{"on":true,"pick":"jelly"}', "偏好写入本机 " + s.pref);

  await evaluate(`document.getElementById('meOrnOn').click(); true`);
  await sleep(350);
  s = await snapshot();
  check(s.hidden === true && s.disabled === true && s.reason === true, "关闭后隐藏、禁用形态并说明原因");

  await evaluate(`document.getElementById('meOrnOn').click(); true`);
  await sleep(250);
  await call("Page.reload");
  await waitFor(`import("./js/core/state.js").then(function(s){return !!s.rt.currentUser && !!s.rt.reqsLoaded;})`, "刷新后初始化", 25000);
  s = await snapshot();
  check(s.cls === "art a2" && s.on === true, "刷新后保持水母且开启");

  await evaluate(`import("./js/core/router.js").then(function(m){ m.showView("profile"); })`);
  await waitFor("document.querySelectorAll('#meOrnGrid [data-orn]').length===7", "刷新后外观面板");
  await evaluate(`document.getElementById('meOrnReset').click(); true`);
  await sleep(350);
  s = await snapshot();
  check(s.cls === "hg" && s.pref === '{"on":true,"pick":"classic"}', "恢复默认回到经典");

  const runtimeErrors = errors.filter(e => !/Failed to load resource/.test(e));
  check(runtimeErrors.length === 0, "无脚本异常" + (runtimeErrors.length ? "：" + runtimeErrors[0] : ""));

  ws.close();
}catch(e){
  failed++;
  console.log("  FAIL " + (e && e.message || e));
}finally{
  chrome.kill("SIGTERM");
}
console.log(failed ? "FAILED " + failed : "ALL PASS");
process.exit(failed ? 1 : 0);
