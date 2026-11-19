/* 全站改版对照：登录后逐视图截图（PC 1440），记录 console 错误。
   用法：node tools/shots/site-audit.mjs [输出目录] */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = process.argv[2] || "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/实施对照/2026-11-19-当前";
fs.mkdirSync(OUT, { recursive: true });

function findChrome(){
  const c = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of c){ const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin; }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let m; try{ m = JSON.parse(raw); }catch(e){ return; }
    if(m.id && this.pending.has(m.id)){ const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }
  send(method, params = {}, sid){ const id = ++this.id; const p = { id, method, params }; if(sid) p.sessionId = sid;
    this.ws.send(JSON.stringify(p)); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}

const STEPS = [
  { k:"mine", go:"#/mine" },
  { k:"review", go:"#/review" },
  { k:"demands-board", go:"#/demands", click:'[data-dem-mode="board"]' },
  { k:"demands-table", go:"#/demands", click:'[data-dem-mode="table"]' },
  { k:"demands-gantt", go:"#/demands", click:'[data-dem-mode="gantt"]' },
  { k:"demands-display", go:"#/demands", click:'[data-dem-mode="board"]', click2:'#demBoardDisplay summary' },
  { k:"projects", go:"#/projects" },
  { k:"projects-cards", go:"#/projects", click:'[data-project-mode="card"]' },
  { k:"projects-table", go:"#/projects", click:'[data-project-mode="table"]' },
  { k:"portfolio", go:"#/portfolio", click:'[data-pf-mode="card"]' },
  { k:"portfolio-set", go:"#/portfolio", click:'[data-pf-mode="card"]',
    eval:'const sel=document.querySelector("[data-pf-set]"); if(sel){ sel.value=sel.options[1].value; sel.dispatchEvent(new Event("change",{bubbles:true})); }' },
  { k:"portfolio-set-full", go:"#/portfolio", click:'[data-pf-mode="card"]',
    eval:'const { rt } = await import("./js/core/state.js"); const counts={}; (rt.reqList||[]).forEach(r=>{ if(r.setId) counts[r.setId]=(counts[r.setId]||0)+1; }); const best=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]; const sel=document.querySelector("[data-pf-set]"); if(sel&&best){ sel.value=best; sel.dispatchEvent(new Event("change",{bubbles:true})); }' },
  { k:"phase", go:"#/phase" },
  { k:"versions-version", go:"#/phase", click:'[data-pmode="version"]' },
  { k:"versions-detail", go:"#/phase", click:'[data-pmode="version"]', click2:'[data-ver-open]' },
  { k:"branches", go:"#/branches" },
  { k:"delivery", go:"#/delivery" },
  { k:"board", go:"#/board" },
  { k:"list", go:"#/list" },
  { k:"tree", go:"#/tree" },
  { k:"chain", go:"#/chain" },
  { k:"calendar", go:"#/calendar" },
  { k:"gantt", go:"#/gantt" },
  { k:"workcolumn", go:"#/workcolumn?col=doing" },
  { k:"canceled", go:"#/canceled" },
  { k:"docs-read", go:"#/requirements" },
  { k:"docs-open", go:"#/requirements", click:'.rs-node[data-rs-doc]' },
  { k:"docs-list", go:"#/requirements", click:'[data-rdmode="tree"]' },
  { k:"docs-mine", go:"#/requirements", click:'[data-rdmode="tree"]', click2:'[data-rdscope="mine"]' },
  { k:"docs-draft", go:"#/requirements", click:'[data-rdmode="tree"]', click2:'[data-rdscope="draft"]' },
  { k:"docs-kanban", go:"#/requirements", click:'[data-rdmode="kanban"]' },
  { k:"docs-feed", go:"#/requirements", click:'[data-rdmode="feed"]' },
  { k:"testcases-cases", go:"#/testcases" },
  { k:"testcases-project", go:"#/testcases",
    eval:'const sel=document.querySelector("#tcReq"); if(sel){ const opt=Array.from(sel.options).filter(o=>o.value && /消息中心/.test(o.textContent))[0]; if(opt){ sel.value=opt.value; sel.dispatchEvent(new Event("change",{bubbles:true})); } }' },
  { k:"testcases-defects", go:"#/testcases", click:'#subNav [data-sub-tab="defects"]' },
  { k:"testcases-plans", go:"#/testcases", click:'#subNav [data-sub-tab="plans"]' },
  { k:"testcases-coverage", go:"#/testcases", click:'#subNav [data-sub-tab="coverage"]' },
  { k:"testcases-report", go:"#/testcases", click:'#subNav [data-sub-tab="report"]' },
  { k:"analysis-stats", go:"#/analysis" },
  { k:"analysis-completions", go:"#/analysis", click:'#subNav [data-sub-tab="completions"]' },
  { k:"analysis-flow", go:"#/analysis", click:'#subNav [data-sub-tab="flow"]' },
  { k:"report", go:"#/report" },
  { k:"investment", go:"#/investment" },
  { k:"workload", go:"#/workload" },
  { k:"risks", go:"#/risks" },
  { k:"messages", go:"#/messages" },
  { k:"settings", go:"#/settings" },
  { k:"settings-members", go:"#/settings", click:'[data-set-tab="members"]' },
  { k:"settings-visibility", go:"#/settings", click:'[data-set-tab="visibility"]' },
  { k:"settings-workflow", go:"#/settings", click:'[data-set-tab="workflow"]' },
  { k:"settings-integration", go:"#/settings", click:'[data-set-tab="integration"]' },
  { k:"settings-data", go:"#/settings", click:'[data-set-tab="data"]' },
  { k:"profile", go:"#/profile" }
];
const ONLY = (process.env.STEPS || "").split(",").map(s => s.trim()).filter(Boolean);
const steps = ONLY.length ? STEPS.filter(s => ONLY.includes(s.k)) : STEPS;

const chrome = findChrome();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-audit-"));
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "about:blank"], { stdio:["ignore","ignore","pipe"] });
let wsUrl = "";
const wsP = new Promise((resolve, reject) => {
  let buf = "";
  proc.stderr.on("data", d => { buf += d.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if(m) resolve(m[1]); });
  setTimeout(() => reject(new Error("DevTools 未就绪")), 15000);
});
wsP.then(u => { wsUrl = u; });
await wsP;
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
const cdp = new Cdp(ws);
const t = await cdp.send("Target.createTarget", { url:"about:blank" });
const a = await cdp.send("Target.attachToTarget", { targetId:t.targetId, flatten:true });
const sid = a.sessionId;
for(const d of ["Page","Runtime","Log"]) await cdp.send(`${d}.enable`, {}, sid);
const errors = [];
cdp.ws.addEventListener("message", ev => { let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
  if(m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error" && m.params.sessionId === sid)
    errors.push((m.params.args || []).map(x => x.value || x.description || "").join(" "));
  if(m.method === "Log.entryAdded" && m.params && m.params.entry && m.params.entry.level === "error")
    errors.push(m.params.entry.text || ""); });
const call = (m,p) => cdp.send(m,p,sid);
const evaluate = async expr => { const r = await call("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true, userGesture:true });
  if(r.exceptionDetails) throw new Error("执行失败：" + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
  return r.result ? r.result.value : undefined; };
const waitFor = async (expr,label,timeout=20000) => { const dl = Date.now() + timeout; let last;
  while(Date.now() < dl){ try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; } await sleep(150); }
  throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）"); };
const shot = async file => { const r = await call("Page.captureScreenshot", { format:"png" });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, "base64")); };

await call("Emulation.setDeviceMetricsOverride", { width:1440, height:1000, deviceScaleFactor:1.5, mobile:false });
await call("Page.navigate", { url: BASE + "/login.html" });
await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
  set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 20000);
await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");

const report = [];
for(const s of steps){
  errors.length = 0;
  const name = s.go.replace(/^#\//, "").split("?")[0];
  try{
    await evaluate(`(() => { location.hash = ${JSON.stringify(s.go)}; window.dispatchEvent(new HashChangeEvent("hashchange")); return true; })()`);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(name)}`, "视图 " + name, 15000);
    await sleep(1400);
    const clickWhen = async sel => evaluate(`new Promise(res => { const dl = Date.now() + 8000;
      (function tick(){ const el = document.querySelector(${JSON.stringify(sel)});
        if(el){ el.click(); res(true); return; } if(Date.now() > dl){ res(false); return; } setTimeout(tick, 200); })(); })`);
    if(s.click){
      const ok = await clickWhen(s.click);
      if(!ok) throw new Error("找不到点击目标 " + s.click);
      await sleep(1200);
    }
    if(s.click2){
      const ok2 = await clickWhen(s.click2);
      if(!ok2) throw new Error("找不到点击目标 " + s.click2);
      await sleep(600);
    }
    if(s.eval){ const v = await evaluate(`(async () => { ${s.eval} })()`); if(v !== undefined) console.log("eval " + s.k + " :: " + JSON.stringify(v)); await sleep(900); }
    await shot("current-" + s.k + ".png");
    report.push({ k:s.k, ok:true, errors:[...errors] });
    console.log("ok  " + s.k);
  }catch(e){
    report.push({ k:s.k, ok:false, err:e.message, errors:[...errors] });
    console.log("ERR " + s.k + " :: " + e.message);
    try{ await shot("current-" + s.k + "-error.png"); }catch(e2){ /* noop */ }
  }
}
fs.writeFileSync(path.join(OUT, "audit.json"), JSON.stringify(report, null, 2));
console.log("\n错误汇总：");
report.forEach(r => { if(!r.ok || r.errors.length) console.log(" - " + r.k + (r.err ? (" | " + r.err) : "") + (r.errors.length ? (" | console: " + r.errors.slice(0,3).join(" ;; ")) : "")); });
proc.kill("SIGTERM");
try{ fs.rmSync(profile, { recursive:true, force:true }); }catch(e){ /* noop */ }
