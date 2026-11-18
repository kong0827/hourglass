/* 项目页表头/项目集行「优化后」原型：运行时注入建议 CSS 后截图，不改产品代码。
   优化思路：建立三级层次——表头(中性灰 chrome) / 项目集组带(浅蓝 tint + 左侧主色强调条) / 项目行(白)。
   同时修复项目集行 hover 与静止同色（无反馈）的问题。
   用法：node tools/shots/shot-projects-header-after.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/项目页表头配色";

/* 建议的优化 CSS（原型注入用；若批准再落到 views-projects-settings.css） */
const OPT_CSS = `
/* 项目集组带：浅蓝 tint + 左侧主色强调条，与中性灰表头明确区分 */
.project-table-row.project-set-row{
  background:#F4F8FE;
  box-shadow: inset 3px 0 0 0 var(--primary);
}
.project-table-row.project-set-row:hover{ background:#E9F1FE; }
.project-table-row.project-set-row.is-ungrouped{ background:#F6F7F9; box-shadow: inset 3px 0 0 0 var(--border); }
/* 表头保持中性灰 chrome，但加强底部分隔线，明确「这是表头」 */
.project-table-head{ border-bottom:1px solid #D7DCE4; }
`;

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of candidates){ const r = spawnSync(bin, ["--version"], { encoding: "utf8" }); if(!r.error && r.status === 0) return bin; }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){ const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } }
  send(method, params = {}, sessionId){ const id = ++this.id; const payload = { id, method, params }; if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload)); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}
const chrome = findChrome();
const port = Number(process.env.E2E_CDP_PORT || 9412);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proj-head-after-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,1000", "--disable-dev-shm-usage"],
  { stdio: "ignore", detached: true });
fs.mkdirSync(OUT, { recursive: true });

let evaluate = null, call = null, waitFor = null;
async function main(){
  let version = null;
  for(let i=0;i<60 && !version;i++){ try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }catch(e){ await sleep(200); } }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.addEventListener("open",res); ws.addEventListener("error",rej); });
  const cdp = new Cdp(ws);
  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  for(const d of ["Page","Runtime","Log"]) await cdp.send(`${d}.enable`, {}, sid);
  call = (m,p) => cdp.send(m,p,sid);
  evaluate = async expr => { const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception||{}).description||res.exceptionDetails.text));
    return res.result ? res.result.value : undefined; };
  waitFor = async (expr,label,timeout=20000) => { const dl = Date.now()+timeout; let last;
    while(Date.now()<dl){ try{ last = await evaluate(expr); if(last) return last; }catch(e){ last=e.message; } await sleep(150); }
    throw new Error("等待超时："+label+"（最后："+JSON.stringify(last)+"）"); };
  const metrics = (w,h,mobile) => call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:2, mobile:!!mobile });
  const nav = async (hash,waitExpr,timeout=18000) => { await evaluate(`(() => { location.hash=${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); return true; })()`);
    try{ await waitFor(waitExpr,"导航 "+hash,timeout); }catch(e){ console.log("  WARN 导航未确认 "+hash+" => "+e.message); } await sleep(500); };
  const shot = async (file, {clip} = {}) => { const r = await call("Page.captureScreenshot", { format:"png", captureBeyondViewport:false, ...(clip?{clip}:{}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data,"base64")); console.log("  截图 " + file); };

  console.log("项目页表头配色·优化后原型\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
    set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");
  await metrics(1440, 1000, false);

  await nav("#/projects", `document.body.dataset.view === "projects"`);
  await waitFor(`!!document.querySelector('[data-project-mode="table"]')`, "视图切换按钮", 10000);
  await evaluate(`(() => { const b = document.querySelector('[data-project-mode="table"]'); if(b) b.click(); return true; })()`);
  await waitFor(`!!document.querySelector(".project-table-head")`, "项目表头", 12000);
  await waitFor(`!!document.querySelector(".project-set-row")`, "项目集行", 12000);
  await sleep(300);

  /* 注入优化 CSS */
  await evaluate(`(() => { const s = document.createElement("style"); s.id = "proto-opt"; s.textContent = ${JSON.stringify(OPT_CSS)}; document.head.appendChild(s); return true; })()`);
  await sleep(300);
  const probe = await evaluate(`(() => { const cs = el => getComputedStyle(el).backgroundColor;
    return { head: cs(document.querySelector(".project-table-head")), setRow: cs(document.querySelector(".project-set-row")),
             same: cs(document.querySelector(".project-table-head")) === cs(document.querySelector(".project-set-row")) }; })()`);
  console.log("  优化后 表头 bg：" + probe.head + " / 项目集行 bg：" + probe.setRow + " / 同色？" + probe.same);

  await shot("03-项目页-优化后配色.png");
  const clip = await evaluate(`(() => { const w = document.querySelector(".project-table-wrap"); const r = w.getBoundingClientRect();
    return { x: Math.max(0,Math.round(r.left)), y: Math.max(0,Math.round(r.top)), width: Math.round(Math.min(r.width, 1400)), height: Math.round(Math.min(r.height, 560)), scale: 2 }; })()`);
  await shot("04-项目表格-优化后局部.png", { clip });
  try{ cdp.ws.close(); }catch(e){}
}
main().then(()=>console.log("完成")).catch(e=>console.error("SCRIPT ERROR:", e.message)).finally(()=>{
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
  process.exit(0);
});
