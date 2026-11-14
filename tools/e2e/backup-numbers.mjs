/* 备份往返与人类可读编号 E2E（真实 ESM 应用，原生 CDP 骨架同 item-no.mjs）
   覆盖：导出 JSON 带 WI/DM/TC 编号（含回收站工作项）、导入后编号不变、
   恢复之后新建接着最大号走且不回收已删号；跑完删除临时空间，不碰演示空间。

   前置：本地栈已起（bash deploy/local/stack.sh start），SQL 82–87 已应用。
   用法：node tools/e2e/backup-numbers.mjs */
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
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      this.errors.push("log: " + msg.params.entry.text);
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
const port = Number(process.env.E2E_CDP_PORT || 9246);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backup-numbers-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const wi = n => "WI-" + String(n).padStart(3, "0");
const dm = n => "DM-" + String(n).padStart(3, "0");
const tc = n => "TC-" + String(n).padStart(3, "0");

let createdWs = null;
let previousWs = null;
let evaluate = null;

try{
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
  const call = (m, p) => cdp.send(m, p, sid);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, labelText, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + labelText + "（最后：" + JSON.stringify(last) + "）");
  };
  const api = (method, url, body) => evaluate(
    `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);

  console.log("备份往返与编号 E2E\n  地址：" + BASE);

  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("uName", ${JSON.stringify(USER)});
    set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click();
    return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");
  previousWs = await evaluate(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id)`);

  /* 一次性空间：演示空间带发布历史，导入会被拒绝，也不该被覆盖 */
  const stamp = Date.now();
  const wsRow = await api("post", "/api/workspaces", { name: "编号恢复验证" + stamp });
  createdWs = wsRow.id;
  await api("post", `/api/workspaces/${createdWs}/select`, {});
  /* 选择接口只记住偏好：整页重载让应用按新空间初始化（同 URL 只改 hash 不会重载） */
  await call("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await call("Page.navigate", { url: BASE + "/#/board" });
  await waitFor(`document.readyState === "complete" && import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(createdWs)} && rt.reqsLoaded)`, "切到临时空间");
  pass("创建并切入临时空间 " + wsRow.name);

  const project = await api("post", "/api/reqs", { name: "恢复验证项目" + stamp, status: "active", template: "blank" });
  pass("创建项目 " + project.name);

  const t1 = await api("post", "/api/tasks", { title: "恢复任务1" + stamp, reqId: project.id, boardColumn: "backlog" });
  const t2 = await api("post", "/api/tasks", { title: "恢复任务2" + stamp, reqId: project.id, boardColumn: "backlog" });
  const t3 = await api("post", "/api/tasks", { title: "恢复任务3" + stamp, reqId: project.id, boardColumn: "backlog" });
  const t4 = await api("post", "/api/tasks", { title: "恢复任务4" + stamp, reqId: project.id, boardColumn: "backlog" });
  await api("delete", `/api/tasks/${t4.id}`);
  assert(t1.itemNo === 1 && t2.itemNo === 2 && t3.itemNo === 3 && t4.itemNo === 4, "准备：四个工作项取到 1–4 号（含一个回收站任务）");

  const d1 = await api("post", "/api/demands", { reqId: project.id, title: "恢复需求1" + stamp, priority: "P2" });
  const d2 = await api("post", "/api/demands", { reqId: project.id, title: "恢复需求2" + stamp, priority: "P2" });
  const d3 = await api("post", "/api/demands", { reqId: project.id, title: "恢复需求3" + stamp, priority: "P2" });
  await api("delete", `/api/demands/${d3.id}`);
  assert(d1.demandNo === 1 && d2.demandNo === 2 && d3.demandNo === 3, "准备：三个需求取到 1–3 号，删掉 3 号");

  const c1 = await api("post", "/api/test-cases", { reqId: project.id, title: "恢复用例1" + stamp, priority: "P2" });
  const c2 = await api("post", "/api/test-cases", { reqId: project.id, title: "恢复用例2" + stamp, priority: "P2" });
  const c3 = await api("post", "/api/test-cases", { reqId: project.id, title: "恢复用例3" + stamp, priority: "P2" });
  await api("delete", `/api/test-cases/${c3.id}`);
  assert(c1.caseNo === 1 && c2.caseNo === 2 && c3.caseNo === 3, "准备：三个用例取到 1–3 号，删掉 3 号");

  /* 导出：编号必须随备份出去（回收站任务也要在） */
  const dump = await api("get", "/api/export");
  const dumpTask = id => (dump.tasks || []).find(x => x.id === id);
  assert(dumpTask(t1.id) && dumpTask(t1.id).itemNo === 1 && dumpTask(t4.id) && dumpTask(t4.id).itemNo === 4,
    "导出 JSON 带工作项编号（含回收站的 WI-004）");
  const dumpDemand = id => (dump.demands || []).find(x => x.id === id);
  const dumpCase = id => (dump.testCases || []).find(x => x.id === id);
  assert(dumpDemand(d1.id) && dumpDemand(d1.id).demandNo === 1 && dumpDemand(d2.id).demandNo === 2,
    "导出 JSON 带需求编号");
  assert(dumpCase(c1.id) && dumpCase(c1.id).caseNo === 1 && dumpCase(c2.id).caseNo === 2,
    "导出 JSON 带用例编号");

  /* 导入：覆盖同一空间，编号沿用而不是重排 */
  const result = await api("post", "/api/import", dump);
  assert(result && result.tasks >= 4 && result.demands === 2 && result.testCases === 2,
    "导入完成（任务 " + result.tasks + " / 需求 " + result.demands + " / 用例 " + result.testCases + "）");

  const rowsOf = r => (r && (r.items || r.rows || r.list)) || [];
  const tasks = rowsOf(await api("get", `/api/tasks/list?reqs=${encodeURIComponent(project.id)}&limit=500`));
  const byId = id => tasks.find(x => x.id === id);
  assert(byId(t1.id) && byId(t1.id).itemNo === 1 && byId(t2.id).itemNo === 2 && byId(t3.id).itemNo === 3,
    "恢复后工作项编号不变（" + [1,2,3].map(wi).join(" / ") + "）");
  const trash = rowsOf(await api("get", "/api/trash?limit=500"));
  const trashed = trash.find(x => x.id === t4.id);
  assert(trashed && trashed.itemNo === 4, "回收站任务的编号也随备份恢复（WI-004）");

  const demands = rowsOf(await api("get", "/api/demands?limit=200")).filter(x => x.reqId === project.id);
  const dById = id => demands.find(x => x.id === id);
  assert(dById(d1.id) && dById(d1.id).demandNo === 1 && dById(d2.id) && dById(d2.id).demandNo === 2,
    "恢复后需求编号不变（DM-001 / DM-002）");

  const cases = rowsOf(await api("get", `/api/test-cases?reqId=${encodeURIComponent(project.id)}&limit=100`));
  const cById = id => cases.find(x => x.id === id);
  assert(cById(c1.id) && cById(c1.id).caseNo === 1 && cById(c2.id) && cById(c2.id).caseNo === 2,
    "恢复后用例编号不变（TC-001 / TC-002）");

  /* 恢复之后新建：接着恢复出的最大号走，已删的号也不回收 */
  const t5 = await api("post", "/api/tasks", { title: "恢复后新任务" + stamp, reqId: project.id, boardColumn: "backlog" });
  const d4 = await api("post", "/api/demands", { reqId: project.id, title: "恢复后新需求" + stamp, priority: "P2" });
  const c4 = await api("post", "/api/test-cases", { reqId: project.id, title: "恢复后新用例" + stamp, priority: "P2" });
  assert(t5.itemNo === 5, "恢复后新建工作项接着 WI-004 取号（" + wi(t5.itemNo) + "）");
  assert(d4.demandNo === 4, "恢复后新建需求不回收已删的 DM-003（取 " + dm(d4.demandNo) + "）");
  assert(c4.caseNo === 4, "恢复后新建用例不回收已删的 TC-003（取 " + tc(c4.caseNo) + "）");

  const errors = cdp.errors;
  assert(!errors.length, "控制台无异常" + (errors.length ? "：" + errors.join(" | ") : ""));
}catch(e){
  failed++;
  console.log("  FAIL 运行异常：" + e.message);
}finally{
  if(createdWs){
    try{
      /* 先把空间偏好切回原空间：否则删掉后偏好指向已删空间，下一套 E2E 首屏会落到个人空间 */
      if(previousWs){
        await evaluate(`import("./js/core/api.js").then(({API}) => API.post(${JSON.stringify("/api/workspaces/" + previousWs + "/select")}, {}))`);
      }
      await evaluate(`import("./js/core/api.js").then(({API}) => API.del(${JSON.stringify("/api/workspaces/" + createdWs)}))`);
      console.log("  清理：已删除临时空间 " + createdWs);
    }catch(e){ console.log("  清理失败：" + e.message); }
  }
  proc.kill();
  console.log(failed ? "\n" + failed + " 项失败" : "\n全部通过");
  process.exit(failed ? 1 : 0);
}
