/* 一次性清理：删除原型采集遗留的「原型临时*」空间（含其内项目/版本/工作项），
   跑完切回演示空间 SXk01。只动名字以「原型临时」开头的空间，绝不碰演示数据。
   用法：node tools/shots/cleanup-temp-ws.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const DEMO_WS = "SXk01";
const PREFIX = "原型临时";

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
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
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const port = Number(process.env.E2E_CDP_PORT || 9388);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-ws-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=1200,800", "--disable-dev-shm-usage"
], { stdio: "ignore", detached: true });

let evaluate = null, call = null, waitFor = null;

async function main(){
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
  call = (m, p) => cdp.send(m, p, sid);
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
  const api = (method, url, body) => evaluate(
    `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);

  console.log("清理遗留临时空间\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click(); return true; })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");

  const all = await api("get", "/api/workspaces");
  const orphans = (Array.isArray(all) ? all : []).filter(w => w && typeof w.name === "string" && w.name.indexOf(PREFIX) === 0);
  console.log("  发现遗留临时空间：" + orphans.length + (orphans.length ? "（" + orphans.map(w => w.name + "/" + w.id).join(", ") + "）" : ""));

  for(const w of orphans){
    try{
      await api("post", `/api/workspaces/${w.id}/select`, {});
      /* 关键：API 按 window.CURRENT_WORKSPACE 附加 ?workspace=，select 只改服务端，
         必须同步前端当前空间，后续 GET/DELETE 才会落到这个临时空间 */
      await evaluate(`window.CURRENT_WORKSPACE = ${JSON.stringify(w.id)}`);
      await sleep(200);
      /* 删版本（交付计划）→ 删工作项 → 删项目，逐层清空再删空间 */
      const reqs = await api("get", "/api/reqs").catch(() => []);
      console.log("    项目数：" + (Array.isArray(reqs) ? reqs.length : "?"));
      for(const r of (Array.isArray(reqs) ? reqs : [])){
        const vers = await api("get", "/api/versions?reqId=" + encodeURIComponent(r.id)).catch(() => []);
        console.log("    项目 " + (r.name || r.id) + " 版本数：" + (Array.isArray(vers) ? vers.length : "?"));
        for(const v of (Array.isArray(vers) ? vers : [])){
          try{ await api("delete", "/api/versions/" + encodeURIComponent(v.id)); console.log("      已删版本 " + (v.name || v.id)); }
          catch(e){ console.log("      版本删除失败 " + (v.name || v.id) + "：" + e.message); }
        }
      }
      const tasks = await api("get", "/api/tasks").catch(() => []);
      console.log("    工作项数：" + (Array.isArray(tasks) ? tasks.length : "?"));
      for(const tk of (Array.isArray(tasks) ? tasks : [])){
        await api("delete", "/api/tasks/" + encodeURIComponent(tk.id)).catch(() => {});
      }
      for(const r of (Array.isArray(reqs) ? reqs : [])){
        try{ await api("delete", "/api/reqs/" + encodeURIComponent(r.id) + "?confirm=" + encodeURIComponent(r.name || "")); console.log("      已删项目 " + (r.name || r.id)); }
        catch(e){ console.log("      项目删除失败 " + (r.name || r.id) + "：" + e.message); }
      }
      await sleep(200);
      await api("delete", "/api/workspaces/" + encodeURIComponent(w.id));
      console.log("  已删除空间：" + w.name + "（" + w.id + "）");
    }catch(e){
      console.log("  删除失败 " + w.name + "（" + w.id + "）：" + e.message);
    }
  }

  /* 切回演示空间 */
  try{ await api("post", `/api/workspaces/${DEMO_WS}/select`, {}); console.log("  已切回演示空间 " + DEMO_WS); }
  catch(e){ console.log("  切回演示空间失败：" + e.message); }

  const after = await api("get", "/api/workspaces");
  const left = (Array.isArray(after) ? after : []).filter(w => w && typeof w.name === "string" && w.name.indexOf(PREFIX) === 0);
  console.log("  清理后剩余临时空间：" + left.length);
  try{ cdp.ws.close(); }catch(e){}
}

main().then(() => console.log("清理完成")).catch(e => console.error("SCRIPT ERROR:", e.message)).finally(() => {
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
  process.exit(0);
});
