/* 只采集「18-看板首屏引导卡」：看板引导卡仅在工作项数为 1–2 时出现
   （board.js syncBoardGuide: if(!n || n>2 || filterOn()) return）。
   建一次性临时空间 + 1 条工作项（不建版本，避免触发空间删除守卫），
   截完删工作项、删空间、切回演示空间 SXk01。纯 API 可逆，不碰演示数据。
   用法：node tools/shots/shot-board-guide.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/调整后原型图";
const DEMO_WS = "SXk01";
const FILE = "18-看板首屏引导卡.png";

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of candidates){ const r = spawnSync(bin, ["--version"], { encoding: "utf8" }); if(!r.error && r.status === 0) return bin; }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){ const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    else if(msg.method === "Runtime.exceptionThrown"){ this.errors.push("exception: " + ((msg.params.exceptionDetails.exception||{}).description||msg.params.exceptionDetails.text)); }
    else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){ this.errors.push("console.error: " + msg.params.args.map(a=>a.value||a.description||"").join(" ")); } }
  send(method, params = {}, sessionId){ const id = ++this.id; const payload = { id, method, params }; if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload)); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}
const chrome = findChrome();
const port = Number(process.env.E2E_CDP_PORT || 9399);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "board-guide-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,1000", "--disable-dev-shm-usage"],
  { stdio: "ignore", detached: true });
fs.mkdirSync(OUT, { recursive: true });

let evaluate = null, call = null, waitFor = null, createdWs = null, createdTask = null;
const log = (cond, name, extra="") => console.log((cond?"  PASS ":"  FAIL ")+name+(extra?"  => "+extra:""));

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
  const api = (method,url,body) => evaluate(`import("./js/core/api.js").then(({API}) => API.${method==="delete"?"del":method}(${JSON.stringify(url)}${body===undefined?"":", "+JSON.stringify(body)}))`);
  const metrics = (w,h,mobile) => call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:2, mobile:!!mobile });
  const nav = async (hash,waitExpr,timeout=18000) => { await evaluate(`(() => { location.hash=${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); return true; })()`);
    try{ await waitFor(waitExpr,"导航 "+hash,timeout); }catch(e){ console.log("  WARN 导航未确认 "+hash+" => "+e.message); } await sleep(400); };

  console.log("采集看板首屏引导卡\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
    set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");

  const tag = String(Date.now()).slice(-6);
  try{
    const wsRow = await api("post", "/api/workspaces", { name: "原型临时" + tag });
    createdWs = wsRow && wsRow.id;
    if(!createdWs) throw new Error("临时空间创建失败");
    await api("post", `/api/workspaces/${createdWs}/select`, {});
    await call("Page.reload");
    await waitFor("document.readyState === 'complete' && document.body && document.body.dataset.view", "临时空间重载", 15000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(createdWs)})`, "切到临时空间", 12000);
    await metrics(1440, 1000, false);
    /* 建 1 条工作项，使看板 n=1，触发首屏引导卡 */
    const tk = await api("post", "/api/tasks", { title: "欢迎使用沙漏看板", priority: "P2", boardColumn: "backlog", dueDate: null, reqId: null, progress: 0, owner: null, ownerUserId: null, tags: [], recurType: "" });
    createdTask = tk && tk.id;
    await sleep(300);
    await nav("#/board", `document.body.dataset.view === "board"`);
    await waitFor(`!!document.querySelector(".guide-card")`, "看板引导卡", 12000);
    const info = await evaluate(`(() => { const g=document.querySelector(".guide-card");
      const btns=g?[...g.querySelectorAll("[data-guide]")].map(b=>b.getAttribute("data-guide")):[];
      return { has:!!g, btns }; })()`);
    if(!info.has) throw new Error("引导卡未出现");
    console.log("  引导卡按钮：" + (info.btns.join(",") || "(无)"));
    await sleep(220);
    const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, FILE), Buffer.from(r.data, "base64"));
    log(true, FILE);
  }catch(e){ log(false, FILE, e.message); }

  /* 清理：删工作项 → 删空间 → 切回演示空间（纯任务，不触发删除守卫） */
  console.log("  [清理] 删除临时空间并切回演示空间…");
  try{
    if(createdWs){
      await api("post", `/api/workspaces/${createdWs}/select`, {});
      await evaluate(`window.CURRENT_WORKSPACE = ${JSON.stringify(createdWs)}`);
      if(createdTask) await api("delete", "/api/tasks/" + encodeURIComponent(createdTask)).catch(()=>{});
    }
    await api("post", `/api/workspaces/${DEMO_WS}/select`, {});
    await sleep(300);
    if(createdWs) await api("delete", "/api/workspaces/" + encodeURIComponent(createdWs));
    createdWs = null;
    log(true, "临时空间已删除、已切回 " + DEMO_WS);
  }catch(e){ log(false, "临时空间清理", e.message); }

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load|marked|DOMPurify|404/i.test(e||""));
  log(realErrors.length === 0, "无应用源控制台错误", realErrors.slice(0,3).join(" | ") || "(仅资源/探针类提示)");
  try{ cdp.ws.close(); }catch(e){}
}
main().then(()=>console.log("完成")).catch(e=>{ console.error("SCRIPT ERROR:", e.message); }).finally(()=>{
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
  process.exit(0);
});
