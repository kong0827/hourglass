/* 工作项抽屉：跨项目选关联文档先确认
   覆盖：
     A 同项目文档：直接选中，不弹确认；
     B 跨项目文档 + 取消：不改所属项目、不改已选文档；
     C 跨项目文档 + 确认：所属项目切成文档项目，文档落到新项目文档上，提示 toast。
   数据：E2Ews01 + e2eowner，标题统一前缀，按前缀清理，不动演示数据。
   运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh）。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "hourglassdemo";
const WS = "E2Ews01";
const LOGIN_USER = "e2eowner";
const PREFIX = "E2E抽屉文档确认";

const MYSQL = ["/usr/local/mysql/bin/mysql", "-h", "127.0.0.1", "-P", "3307", "-u", "hourglass", "-phourglass123",
  "--default-character-set=utf8mb4", "hourglass", "-N", "-e"];
const sql = q => {
  const r = spawnSync(MYSQL[0], MYSQL.slice(1).concat(q), { encoding: "utf8" });
  if(r.status !== 0) throw new Error("SQL 失败：" + (r.stderr || "").trim());
  return (r.stdout || "").trim();
};
const wipe = () => {
  const like = `'${PREFIX}%'`;
  sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_id IN (SELECT id FROM task WHERE workspace_id='${WS}' AND title LIKE ${like})`);
  sql(`DELETE FROM requirement_doc_history WHERE workspace_id='${WS}' AND doc_id IN (SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE ${like})`);
  sql(`DELETE FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE ${like}`);
  sql(`DELETE FROM task WHERE workspace_id='${WS}' AND title LIKE ${like}`);
  sql(`DELETE FROM requirement WHERE workspace_id='${WS}' AND name LIKE ${like}`);
};

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
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
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id; const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9473);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drawer-doc-confirm-"));
fs.mkdirSync(path.join(tmp, "Default"), { recursive: true });
fs.writeFileSync(path.join(tmp, "Default", "Preferences"), JSON.stringify({
  profile: { password_manager_enabled: false, password_manager_leak_detection: false },
  credentials_enable_service: false, credentials_enable_autosignin: false
}));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

const SHOTS = [];
let evaluate, waitFor, call;
const shot = async name => {
  try{ await evaluate(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
  const s = await Promise.race([call("Page.captureScreenshot", { format: "png" }), sleep(9000).then(() => null)]);
  if(!s){ console.log("  WARN 截图超时，跳过 " + name); return; }
  const out = "/tmp/hg-drawer-doc-confirm-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
  console.log("  SHOT " + out);
};

try{
  wipe();

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
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(120);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };

  const login = async () => {
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("uName", ${JSON.stringify(LOGIN_USER)}); set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    try{ await waitFor("location.pathname.indexOf('/login') === -1 && !!document.body.dataset.view", "登录完成", 12000); }
    catch(e){ const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`); throw new Error("登录未完成：" + errMsg); }
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
    const curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    if(curWs !== WS){
      await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
      await call("Page.navigate", { url: BASE + "/" });
      await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.currentWs.id === "${WS}" && rt.reqsLoaded)`, "切换空间后初始化", 20000);
    }
  };

  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){
      failed++;
      console.log("  ERROR " + name + "：" + e.message);
    }
  };

  await login();

  const data = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const pa = await API.post("/api/projects", { name: "${PREFIX}-项目A", template: "blank" });
    const pb = await API.post("/api/projects", { name: "${PREFIX}-项目B", template: "blank" });
    const mkDoc = async (title, reqId) => {
      const d = await API.post("/api/req-docs", { title: title, reqId: reqId, content: "<p>" + title + "</p>",
        format: "html", docType: "other", status: "active", visibility: "team" });
      await API.put("/api/req-docs/" + encodeURIComponent(d.id) + "/publish", { published: true });
      return d.id;
    };
    const da = await mkDoc("${PREFIX}-文档A", pa.id);
    const db = await mkDoc("${PREFIX}-文档B", pb.id);
    const t = await API.post("/api/tasks", { title: "${PREFIX}-任务", reqId: pa.id, boardColumn: "backlog" });
    return { pa: pa.id, pb: pb.id, da: da, db: db, task: t.id };
  })()`);
  assert(!!data && data.pa && data.pb && data.task, "准备数据：两个项目、两篇文档、一个工作项");

  /* 重新加载，让项目/文档进入前端状态 */
  await call("Page.navigate", { url: BASE + "/" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.currentWs && rt.currentWs.id === "${WS}" && rt.reqsLoaded)`, "重载后初始化", 20000);

  const taskObj = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const rows = await API.getAllPages("/api/tasks/list");
    return rows.find(t => t.id === ${JSON.stringify(data.task)}) || null;
  })()`);
  assert(!!taskObj, "取到工作项详情数据");
  await evaluate(`import("./js/core/task-drawer.js").then(m => m.openTaskDrawer(null, ${JSON.stringify(taskObj)}, {}))`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on") && !!document.getElementById("iReqDoc")`, "抽屉打开", 15000);
  await waitFor(`document.getElementById("iReq").value === ${JSON.stringify(data.pa)}`, "所属项目回填 A", 10000);

  const closePops = () => evaluate(`import("./js/core/ui.js").then(m => { m.UI.closeAllPops(); return true; })`);
  const openPicker = async () => {
    await closePops();
    await evaluate(`document.getElementById("iReqDocPicker").click(); true`);
    await waitFor(`!!document.querySelector("[data-req-doc-id]")`, "文档候选加载", 20000);
  };
  const clickDoc = id => evaluate(`(() => {
    const b = [...document.querySelectorAll("[data-req-doc-id]")].find(x => x.dataset.reqDocId === ${JSON.stringify(id)});
    if(!b) return false; b.click(); return true;
  })()`);
  const dialogOpen = () => `(document.getElementById("dlgConfirm") || {}).classList && document.getElementById("dlgConfirm").classList.contains("open")`;
  const reqValue = () => evaluate(`document.getElementById("iReq").value`);
  const docValue = () => evaluate(`document.getElementById("iReqDoc").value`);

  await section("[A] 同项目文档：直接选中不弹确认", async () => {
    await openPicker();
    const ok = await clickDoc(data.da);
    assert(ok, "候选里找到项目 A 的文档");
    await waitFor(`document.getElementById("iReqDoc").value === ${JSON.stringify(data.da)}`, "文档 A 已选中", 8000);
    assert(!(await evaluate(dialogOpen())), "同项目不弹确认框");
    assert((await reqValue()) === data.pa, "所属项目仍为 A");
  });

  await section("[B] 跨项目文档：取消后什么都不改", async () => {
    await openPicker();
    const ok = await clickDoc(data.db);
    assert(ok, "候选里找到项目 B 的文档");
    await waitFor(dialogOpen(), "确认框打开", 8000);
    const title = await evaluate(`document.getElementById("dlgConfirmTitle").textContent`);
    const msg = await evaluate(`document.getElementById("dlgConfirmMsg").textContent`);
    assert(title.indexOf("切换所属项目") !== -1, "标题说明要切换所属项目");
    assert(msg.indexOf(PREFIX + "-文档B") !== -1 && msg.indexOf(PREFIX + "-项目B") !== -1, "正文点名文档与目标项目");
    assert(msg.indexOf("计划版本") !== -1 && msg.indexOf("发现版本") !== -1 && msg.indexOf("史诗") !== -1 && msg.indexOf("关联需求") !== -1, "正文说明会清空计划/发现版本、史诗与关联需求");
    await shot("confirm-dialog");
    await evaluate(`document.getElementById("dlgConfirmCancel").click(); true`);
    await waitFor(`!document.getElementById("dlgConfirm").classList.contains("open")`, "确认框关闭", 8000);
    assert((await reqValue()) === data.pa, "取消后所属项目保持 A");
    assert((await docValue()) === data.da, "取消后已选文档保持 A 的文档");
  });

  await section("[C] 跨项目文档：确认后才切换", async () => {
    await openPicker();
    const ok = await clickDoc(data.db);
    assert(ok, "再次找到项目 B 的文档");
    await waitFor(dialogOpen(), "确认框再次打开", 8000);
    await evaluate(`document.getElementById("dlgConfirmOk").click(); true`);
    await waitFor(`!document.getElementById("dlgConfirm").classList.contains("open")`, "确认框关闭", 8000);
    await waitFor(`document.getElementById("iReq").value === ${JSON.stringify(data.pb)}`, "所属项目切到 B", 8000);
    await waitFor(`document.getElementById("iReqDoc").value === ${JSON.stringify(data.db)}`, "关联文档落到 B 的文档", 8000);
    const toastText = await evaluate(`(document.getElementById("toastWrap") || {}).textContent || ""`);
    assert(toastText.indexOf("已关联文档") !== -1 && toastText.indexOf(PREFIX + "-项目B") !== -1, "提示已同步所属项目");
    await shot("after-confirm");
  });

  if(cdp.errors.length){
    failed++;
    console.log("\n  FAIL 运行期异常：\n" + cdp.errors.join("\n"));
  }
}catch(e){
  failed++;
  console.log("\n  ERROR " + e.message);
}finally{
  try{ wipe(); }catch(e){ console.log("  WARN 清理失败：" + e.message); }
  try{ proc.kill("SIGKILL"); }catch(e){}
}

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
