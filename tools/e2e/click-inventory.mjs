/* 只读盘点：逐视图列出可见可点控件（不点击任何东西）。
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=123456 \
          node tools/e2e/click-inventory.mjs > /tmp/click-inventory.json */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";

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
async function connect(port){
  const deadline = Date.now() + 15000;
  let version;
  while(Date.now() < deadline){
    try{ const res = await fetch(`http://127.0.0.1:${port}/json/version`); if(res.ok){ version = await res.json(); break; } }
    catch(e){ /* 等 Chrome */ }
    await sleep(200);
  }
  if(!version) throw new Error("Chrome DevTools 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once:true }); ws.addEventListener("error", rej, { once:true }); });
  return new Cdp(ws);
}

const ROUTES = [
  "mine", "review", "demands", "projects", "portfolio", "phase", "branches", "delivery",
  "board", "list", "tree", "chain", "calendar", "gantt", "workcolumn?col=doing", "canceled",
  "requirements", "testcases", "analysis", "report", "investment", "workload", "risks",
  "messages", "settings", "profile"
];

const COLLECT = `(() => {
  const root = document.getElementById("view-" + document.body.dataset.view);
  if(!root) return [];
  const sel = "button, a[href], summary, [role=button], [role=tab], select, input:not([type=hidden])";
  const vis = el => {
    const r = el.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
      && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 1.2;
  };
  const pathOf = el => {
    if(el.id) return "#" + el.id;
    const parts = [];
    let n = el;
    while(n && n.nodeType === 1 && n !== root && parts.length < 5){
      let s = n.tagName.toLowerCase();
      if(n.dataset){
        for(const k of Object.keys(n.dataset).slice(0,2)) s += "[" + k + "]";
      }
      if(n.className && typeof n.className === "string"){
        const c = n.className.trim().split(/\\s+/).filter(Boolean).slice(0,2).join(".");
        if(c) s += "." + c;
      }
      const p = n.parentElement;
      if(p){ const idx = Array.from(p.children).indexOf(n); s += ":nth-child(" + (idx + 1) + ")"; }
      parts.unshift(s);
      n = p;
    }
    return parts.join(">");
  };
  return Array.from(root.querySelectorAll(sel)).filter(vis).map(el => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    text: (el.innerText || el.getAttribute("aria-label") || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 48),
    id: el.id || "",
    cls: (typeof el.className === "string" ? el.className : "").trim().slice(0, 80),
    data: Object.assign({}, el.dataset),
    href: el.getAttribute("href") || "",
    sel: pathOf(el)
  }));
})()`;

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-inv-"));
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,1000", "about:blank"], { stdio:"ignore" });
  let cdp, sessionId;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }catch(e){ await sleep(100); }
    }
    cdp = await connect(port);
    const t = await cdp.send("Target.createTarget", { url: "about:blank" });
    sessionId = (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
    for(const d of ["Page", "Runtime", "Log"]) await cdp.send(d + ".enable", {}, sessionId);
    const call = (m, p) => cdp.send(m, p, sessionId);
    const ev = async expr => {
      const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if(r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ""));
      return r.result && r.result.value;
    };
    const waitFor = async (expr, label, timeout = 15000) => {
      const end = Date.now() + timeout; let last;
      while(Date.now() < end){ try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; } await sleep(150); }
      throw new Error("超时：" + label + " " + JSON.stringify(last));
    };
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
    await ev(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles:true })); };
      set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    await waitFor(`location.pathname.indexOf("/login") === -1 && !!document.body.dataset.view`, "登录", 25000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "初始化", 25000);

    const out = {};
    for(const route of ROUTES){
      await ev(`location.hash = ${JSON.stringify("#/" + route)}`);
      const view = route.split("?")[0].split("/")[0];
      await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, "视图 " + route);
      await sleep(900);
      out[route] = await ev(COLLECT);
    }
    console.log(JSON.stringify(out, null, 1));
  }finally{
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    try{ process.kill(-child.pid, "SIGKILL"); }catch(e){ try{ child.kill("SIGKILL"); }catch(e2){} }
    try{ fs.rmSync(profile, { recursive:true, force:true }); }catch(e){ /* 忽略 */ }
  }
}
main().catch(e => { console.error("失败：" + e.message); process.exit(1); });
