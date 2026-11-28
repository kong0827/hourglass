/* 需求/工作项列表「编号」列回归（真实 ESM 应用，CDP 骨架同 item-no.mjs）
   覆盖：列定义含 no、表头「编号」、行内 WI-/DM- 文本、按编号表头排序、
   导出 CSV 首含编号列且值带前缀、服务端按编号搜索。
   前置：bash deploy/local/stack.sh start
   用法：node tools/e2e/list-no-column.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zctt2grh4x4j1";
const SHOTS = process.env.E2E_SHOTS || "/tmp/list-no-column-e2e";
const DL = path.join(SHOTS, "dl");

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
      this.errors.push("log: " + msg.params.entry.text + (msg.params.entry.url ? " @" + msg.params.entry.url : ""));
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
const port = Number(process.env.E2E_CDP_PORT || 9237);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "list-no-col-"));
fs.mkdirSync(DL, { recursive: true });

const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

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
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const out = path.join(SHOTS, name + ".png");
    fs.writeFileSync(out, Buffer.from(r.data, "base64"));
    return out;
  };
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, labelText, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + labelText + "（最后：" + JSON.stringify(last) + "）");
  };
  const api = (method, url, body) => evaluate(
    `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true });

  console.log("列表编号列 E2E\n  地址：" + BASE);

  /* ---------- 登录并落到被测空间 ---------- */
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
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await api("post", `/api/workspaces/${WS}/select`, {});
  await call("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await call("Page.navigate", { url: BASE + "/#/board" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录 " + USER + " 并切到空间 " + WS);

  /* ---------- 1. 列定义 ---------- */
  const defs = await evaluate(`import("./js/core/list-preferences.js").then(m => ({
    taskCols: m.columns("task-list"), taskLabels: m.labels("task-list"),
    demCols: m.columns("demand-pool"), demLabels: m.labels("demand-pool")
  }))`);
  assert(defs.taskLabels.no === "编号" && defs.taskCols.indexOf("no") === 1, "task-list 列定义含「编号」且紧随标题（" + defs.taskCols.slice(0, 3).join("/") + "）");
  assert(defs.demLabels.no === "编号" && defs.demCols.indexOf("no") === 1, "demand-pool 列定义含「编号」且紧随标题（" + defs.demCols.slice(0, 3).join("/") + "）");

  /* ---------- 2. 工作项列表 ---------- */
  await evaluate(`location.hash = "#/list"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "list" && !!document.querySelector("#listHead .lh-sort")`, "工作项列表渲染", 20000);
  await waitFor(`[...document.querySelectorAll("#listHead span")].some(s => s.textContent.trim() === "编号")`, "工作项表头含编号", 20000);
  const wiSample = await waitFor(`(() => {
    const head = [...document.querySelectorAll("#listHead > span")].map(s => s.textContent.replace(/[↓↑]/g, "").trim());
    const idx = head.indexOf("编号");
    if(idx < 0) return false;
    for(const row of document.querySelectorAll(".list-row")){
      const cell = row.children[idx];
      const m = cell && cell.textContent.trim().match(/^WI-\\d{3}$/);
      if(m) return m[0];
    }
    return false;
  })()`, "工作项行内编号单元格 WI-xxx", 20000);
  pass("工作项编号单元格 " + wiSample);
  /* 按编号表头排序 */
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll("#listHead [data-sort-col]")];
    const b = btns.find(x => x.textContent.trim().startsWith("编号"));
    if(b) b.click();
    return !!b;
  })()`);
  await waitFor(`document.querySelector('#listHead [data-sort-col="no"]').classList.contains("on")`, "点编号表头进入排序", 10000);
  pass("编号列表头可排序");
  /* 导出 CSV */
  fs.readdirSync(DL).forEach(f => fs.unlinkSync(path.join(DL, f)));
  await evaluate(`(() => { const b = document.querySelector("[data-list-export]"); if(b) b.click(); return !!b; })()`);
  await sleep(1500);
  const wiCsv = fs.readdirSync(DL).find(f => f.endsWith(".csv"));
  assert(!!wiCsv, "工作项导出 CSV 已下载（" + wiCsv + "）");
  if(wiCsv){
    const txt = fs.readFileSync(path.join(DL, wiCsv), "utf8");
    const head = txt.split(/\r?\n/)[0];
    assert(head.indexOf("编号") !== -1, "工作项 CSV 表头含编号（" + head + "）");
    const wiLine = txt.split(/\r?\n/).slice(1).find(l => l.indexOf(wiSample) !== -1);
    assert(!!wiLine, "工作项 CSV 含编号值 " + wiSample);
  }
  /* 服务端按编号搜索 */
  const qRows = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const r = await API.get("/api/tasks/list", { q: ${JSON.stringify(wiSample)}, limit: 10 });
    const rows = r.items || r.rows || r.list || [];
    return rows.filter(x => x.itemNo != null).length;
  })()`);
  assert(qRows >= 1, "按编号 " + wiSample + " 搜索命中 " + qRows + " 条（服务端 item_no 匹配）");
  await shot("task-list-no-column");

  /* ---------- 3. 需求池列表 ---------- */
  await evaluate(`location.hash = "#/demands"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "demands"`, "需求池");
  await evaluate(`(() => { const b = document.querySelector('#demandsPage [data-dem-mode="table"]'); if(b) b.click(); return !!b; })()`);
  await waitFor(`!!document.querySelector("#demandBody table.manager-tbl")`, "需求表格渲染", 20000);
  const dmHead = await waitFor(`[...document.querySelectorAll("#demandBody thead th")].map(x => x.textContent.trim())`, "需求表头");
  assert(dmHead.indexOf("编号") === 1, "需求表头第 2 列为编号（" + dmHead.slice(0, 3).join("/") + "）");
  const dmSample = await waitFor(`(() => {
    const head = [...document.querySelectorAll("#demandBody thead th")].map(x => x.textContent.trim());
    const idx = head.indexOf("编号");
    if(idx < 1) return false;
    for(const row of document.querySelectorAll("#demandBody tbody tr")){
      if(row.querySelector(".dem-group-toggle")) continue;
      const cell = row.children[idx];
      const m = cell && cell.textContent.trim().match(/^DM-\\d{3}$/);
      if(m) return m[0];
    }
    return false;
  })()`, "需求行内编号单元格 DM-xxx", 20000);
  pass("需求编号单元格 " + dmSample);
  /* 需求导出 CSV */
  fs.readdirSync(DL).forEach(f => fs.unlinkSync(path.join(DL, f)));
  await evaluate(`(() => { const b = document.querySelector("[data-dem-head-export]") || document.querySelector("[data-dem-export]"); if(b) b.click(); return !!b; })()`);
  await sleep(1500);
  const dmCsv = fs.readdirSync(DL).find(f => f.endsWith(".csv"));
  assert(!!dmCsv, "需求导出 CSV 已下载（" + dmCsv + "）");
  if(dmCsv){
    const txt = fs.readFileSync(path.join(DL, dmCsv), "utf8");
    const head = txt.split(/\r?\n/)[0];
    assert(head.indexOf("编号") !== -1, "需求 CSV 表头含编号（" + head + "）");
    const dmLine = txt.split(/\r?\n/).slice(1).find(l => l.indexOf(dmSample) !== -1);
    assert(!!dmLine, "需求 CSV 含编号值 " + dmSample);
  }
  /* 服务端按编号搜索需求 */
  const dqRows = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const r = await API.get("/api/demands/page", { q: ${JSON.stringify(dmSample)}, limit: 10 });
    const rows = r.items || r.rows || r.list || [];
    return rows.filter(x => x.demandNo != null).length;
  })()`);
  assert(dqRows >= 1, "按编号 " + dmSample + " 搜索需求命中 " + dqRows + " 条（服务端 demand_no 匹配）");
  await shot("demand-table-no-column");

  /* ---------- 控制台错误 ---------- */
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（" + errs.slice(0, 3).join(" | ") + "）" : ""));
}catch(e){
  failed++;
  console.log("  FAIL 异常：" + (e && e.message || e));
}finally{
  try{ proc.kill(); }catch(e){}
}
console.log(failed ? "\n结果：" + failed + " 项失败" : "\n全部通过");
process.exit(failed ? 1 : 0);
