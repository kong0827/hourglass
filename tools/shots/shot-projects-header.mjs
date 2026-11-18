/* 项目页表头/项目集行配色核查 + 截图
   核查 .project-table-head（列标题）与 .project-set-row（项目集行）是否同色，
   并读出相关 CSS 变量的解析值。只读演示空间，不写数据。
   用法：node tools/shots/shot-projects-header.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/项目页表头配色";

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
const port = Number(process.env.E2E_CDP_PORT || 9411);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proj-head-"));
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

  console.log("项目页表头配色核查\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
    set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");
  await metrics(1440, 1000, false);

  await nav("#/projects", `document.body.dataset.view === "projects"`);
  /* 项目页默认卡片视图；切到「表格」视图才会渲染 .project-table-head */
  await waitFor(`!!document.querySelector('[data-project-mode="table"]')`, "视图切换按钮", 10000);
  await evaluate(`(() => { const b = document.querySelector('[data-project-mode="table"]'); if(b) b.click(); return true; })()`);
  await waitFor(`!!document.querySelector(".project-table-head")`, "项目表头", 12000);
  await waitFor(`!!document.querySelector(".project-set-row")`, "项目集行", 12000);
  await sleep(400);

  const probe = await evaluate(`(() => {
    const cs = el => el ? getComputedStyle(el).backgroundColor : null;
    const root = getComputedStyle(document.documentElement);
    const varOf = n => root.getPropertyValue(n).trim();
    const head = document.querySelector(".project-table-head");
    const setRow = document.querySelector(".project-set-row");
    const projRow = document.querySelector(".project-table-row:not(.project-set-row)");
    const wrap = document.querySelector(".project-table-wrap");
    return {
      vars: { surface: varOf("--surface"), surfaceSunken: varOf("--surface-sunken"), surfaceHover: varOf("--surface-hover"),
              primarySoft: varOf("--primary-soft"), border: varOf("--border"), text2: varOf("--text-2"), primary: varOf("--primary") },
      head: cs(head), setRow: cs(setRow), projRow: cs(projRow), wrap: cs(wrap),
      sameColor: cs(head) === cs(setRow),
      counts: { sets: document.querySelectorAll(".project-set-row").length, projects: document.querySelectorAll(".project-table-row:not(.project-set-row)").length }
    };
  })()`);
  console.log("  CSS 变量：" + JSON.stringify(probe.vars));
  console.log("  表头 bg：" + probe.head);
  console.log("  项目集行 bg：" + probe.setRow);
  console.log("  项目行 bg：" + probe.projRow);
  console.log("  容器 bg：" + probe.wrap);
  console.log("  表头与项目集行同色？ " + probe.sameColor);
  console.log("  集数/项目数：" + probe.counts.sets + " / " + probe.counts.projects);

  await shot("01-项目页-当前配色.png");
  /* 局部：表头 + 项目集行 + 头几条项目行 */
  const clip = await evaluate(`(() => { const w = document.querySelector(".project-table-wrap"); const r = w.getBoundingClientRect();
    return { x: Math.max(0,Math.round(r.left)), y: Math.max(0,Math.round(r.top)), width: Math.round(Math.min(r.width, 1400)), height: Math.round(Math.min(r.height, 560)), scale: 2 }; })()`);
  await shot("02-项目表格-局部.png", { clip });
  try{ cdp.ws.close(); }catch(e){}
}
main().then(()=>console.log("完成")).catch(e=>console.error("SCRIPT ERROR:", e.message)).finally(()=>{
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
  process.exit(0);
});
