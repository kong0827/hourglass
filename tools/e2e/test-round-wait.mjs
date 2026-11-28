/* 本轮提测时间批次 E2E：看板等待与 3 天预警读本轮起点（test_round_requested_at）
   覆盖：
     1 进入「待测试」写本轮起点，与提测时间一致；
     2 进入「测试中」不改本轮起点；
     3 退回队列（测试中 → 待测试）不重置本轮起点；
     4 存量行没有本轮字段时看板回退首次提测时间（4 天前 → 3 天预警）；
     5 补上本轮字段后看板改读本轮（2 小时前 → 预警消失），抽屉「已等待」同步。
   数据：SXk01 演示空间内自建一条 E2E 工作项，按 id 精确清理。
   运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh），本地库已执行 sql/137。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const WS = process.env.E2E_WS || "SXk01";
const PREFIX = "E2E本轮提测";

const MYSQL = ["/usr/local/mysql/bin/mysql", "-h", "127.0.0.1", "-P", "3307", "-u", "hourglass", "-phourglass123",
  "--default-character-set=utf8mb4", "hourglass", "-N", "-e"];
const sql = q => {
  const r = spawnSync(MYSQL[0], MYSQL.slice(1).concat(q), { encoding: "utf8" });
  if(r.status !== 0) throw new Error("SQL 失败：" + (r.stderr || "").trim());
  return (r.stdout || "").trim();
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
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      this.errors.push("console.error: " + msg.params.args.map(a => a.value || a.description || "").join(" "));
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
const port = Number(process.env.E2E_PORT || 9474);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-round-wait-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
let cdp = null;
let evaluate = null;
let waitFor = null;
let call = null;
let TASK_ID = "";
let TITLE = "";
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

function cleanup(){
  if(!TASK_ID) return;
  const q = `SELECT id, deleted_at FROM task WHERE id='${TASK_ID}'`;
  let row = "";
  try{ row = sql(q); }catch(e){ return; }
  if(!row) return;
  try{
    sql(`DELETE FROM task_watch WHERE task_id='${TASK_ID}'`);
    sql(`DELETE FROM task_log WHERE task_id='${TASK_ID}'`);
    sql(`DELETE FROM time_log WHERE task_id='${TASK_ID}'`);
    sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type IN ('task','workitem') AND entity_id='${TASK_ID}'`);
    sql(`DELETE FROM task WHERE id='${TASK_ID}'`);
    console.log("  CLEAN 已删除样本工作项 " + TASK_ID);
  }catch(e){ console.log("  WARN 清理失败：" + e.message); }
}

try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  /* 脚本直改库不会推高空间 version，/api/board 的 ETag 不变会被浏览器复用旧 JSON */
  try{ await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId); }catch(e){}
  call = (m, p) => cdp.send(m, p, sessionId);
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
  const api = async body => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    ${body}
  })()`);
  const taskNow = () => api(`const r = await API.getWs(${JSON.stringify(WS)}, "/api/task/${TASK_ID}");
    return r && r.task ? r.task : r;`);
  const move = (column, extra) => api(`return await API.postWs(${JSON.stringify(WS)}, "/api/tasks/${TASK_ID}/move",
    Object.assign({ column: ${JSON.stringify(column)} }, ${JSON.stringify(extra || {})}));`);
  const openBoard = async () => {
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor("document.readyState === 'complete' && document.body && !!document.body.dataset.view", "应用重载", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
    const ok = await evaluate(`(() => {
      const n = document.querySelector('.nav-item[data-view="workitems"]');
      if(!n) return false;
      n.click();
      return true;
    })()`);
    if(!ok) throw new Error("找不到工作项入口");
    await waitFor(`document.body.dataset.view === "board"`, "看板视图");
  };
  const searchTitle = async () => {
    await evaluate(`(() => {
      const i = document.getElementById("searchInput");
      if(!i) return false;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), "value").set.call(i, ${JSON.stringify(TITLE)});
      i.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await waitFor(`!!document.querySelector('.card[data-id="${TASK_ID}"]')`, "看板卡片", 25000);
  };
  const testStrip = () => evaluate(`(() => {
    const card = document.querySelector('.card[data-id="${TASK_ID}"]');
    const test = card && card.querySelector('.card-test');
    const wait = test && test.querySelector('.ct-wait');
    return {
      text: test ? test.textContent.replace(/\\s+/g, " ").trim() : "",
      hot: !!(wait && wait.classList.contains("hot"))
    };
  })()`);

  console.log("本轮提测时间 E2E\n  地址：" + BASE);
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
  try{
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
  await call("Page.navigate", { url: BASE + "/" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录 " + USER + " 并切到空间 " + WS);

  /* ---------------- 准备：自建一条「进行中」工作项 ---------------- */
  const proj = await api(`const r = await API.getWs(${JSON.stringify(WS)}, "/api/board");
    const col = (r.columns || {}).doing;
    const items = (col && col.items) || [];
    return items.length && items[0].reqId ? items[0].reqId : "";`);
  if(!proj) throw new Error("「进行中」列没有可借用项目的样本工作项，无法确定 reqId");
  TITLE = PREFIX + " " + Date.now();
  TASK_ID = await api(`const t = await API.post("/api/tasks", { title: ${JSON.stringify(TITLE)},
    reqId: ${JSON.stringify(proj)}, boardColumn: "doing" });
    return (t && t.id) || (t && t.task && t.task.id) || "";`);
  if(!TASK_ID) throw new Error("样本工作项创建失败");
  console.log("  样本：" + TITLE + "（" + TASK_ID + "）");

  /* ---------------- 1. 进入「待测试」写本轮起点 ---------------- */
  await move("test", { reason: "E2E 提测" });
  const handed = await taskNow();
  assert(handed.boardColumn === "test", "移入「待测试」成功");
  assert(!!handed.testRoundRequestedAt, "本轮提测时间已写入：" + handed.testRoundRequestedAt);
  assert(handed.testRoundRequestedAt === handed.testRequestedAt, "同一次移入时本轮起点与提测时间一致");

  /* ---------------- 2. 进入「测试中」不改本轮起点 ---------------- */
  await move("testing", { autoClaim: false });
  const testing = await taskNow();
  assert(testing.boardColumn === "testing" && testing.testRoundRequestedAt === handed.testRoundRequestedAt,
    "进入「测试中」不改本轮起点");

  /* ---------------- 3. 退回队列不重置本轮起点 ---------------- */
  await move("test", { reason: "E2E 退回队列" });
  const requeued = await taskNow();
  assert(requeued.boardColumn === "test" && requeued.testRoundRequestedAt === handed.testRoundRequestedAt,
    "退回队列不重置本轮起点（等待延续本轮）");
  assert(!!requeued.testFinishedAt, "退回同时记录本轮结束时间：" + requeued.testFinishedAt);

  /* ---------------- 4. 存量回退：没有本轮字段时看板按首次提测计算 ---------------- */
  sql(`UPDATE task SET test_round_requested_at=NULL, test_requested_at=DATE_SUB(NOW(), INTERVAL 4 DAY) WHERE id='${TASK_ID}'`);
  await openBoard();
  await searchTitle();
  const legacy = await testStrip();
  assert(legacy.hot === true, "存量行（4 天前）命中 3 天预警");
  assert(legacy.text.indexOf("已等待") !== -1 && legacy.text.indexOf("4 天") !== -1,
    "回退首次提测时间显示等待时长（" + legacy.text + "）");

  /* ---------------- 5. 有本轮字段时看板改读本轮 ---------------- */
  sql(`UPDATE task SET test_round_requested_at=DATE_SUB(NOW(), INTERVAL 2 HOUR), test_started_at=NULL, test_finished_at=NULL WHERE id='${TASK_ID}'`);
  await openBoard();
  await searchTitle();
  const current = await testStrip();
  assert(current.hot === false, "本轮起点 2 小时前：3 天预警消失");
  assert(current.text.indexOf("2 小时") !== -1, "等待时长改读本轮起点（" + current.text + "）");

  /* ---------------- 抽屉「已等待」同口径，提测时间仍展示原值 ---------------- */
  await evaluate(`document.querySelector('.card[data-id="${TASK_ID}"]').click()`);
  await waitFor(`document.getElementById("taskDrawer").classList.contains("on")`, "抽屉打开");
  await waitFor(`!document.getElementById("readTestCard").hidden`, "测试卡可见");
  const drawer = await evaluate(`(() => ({
    dur: document.getElementById("readTestDur").textContent,
    requested: document.getElementById("readTestRequested").textContent
  }))()`);
  assert(drawer.dur.indexOf("已等待") !== -1 && drawer.dur.indexOf("2 小时") !== -1,
    "抽屉「已等待」读本轮起点（" + drawer.dur + "）");
  assert(drawer.requested !== "—" && drawer.requested.indexOf("4 天") === -1 && /\d{2}-\d{2}/.test(drawer.requested),
    "抽屉提测时间仍展示首次提测日期（" + drawer.requested + "）");

  if(cdp.errors.length){
    console.log("  浏览器错误：\n    " + cdp.errors.slice(0, 6).join("\n    "));
    failed += cdp.errors.length;
  }
  console.log(failed ? `\nFAILED ${failed}` : "\nALL PASS");
}catch(err){
  if(cdp && cdp.errors.length) console.log("浏览器错误：\n  " + cdp.errors.slice(0, 8).join("\n  "));
  console.log("  ERROR " + err.message);
  failed++;
}finally{
  cleanup();
  proc.kill();
}
process.exit(failed ? 1 : 0);