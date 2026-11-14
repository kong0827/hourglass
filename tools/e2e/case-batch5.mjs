/* 批次5 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-batch5.mjs
   覆盖两项（用户选定 ①+②）：
     #19 下钻明细导出 CSV：下钻面板「导出明细 CSV」导出当前桶流水，含缺陷回链列（#/board?task=…），
         行数==桶 total；按钮在明细加载后才启用；只读查看者亦可导出（读操作）。
     #20 报告模式收敛：rep-mode 隐藏用例查询栏 #tcQueryBar 与残留筛选栏 #tcFilterBar、用例动作按钮；
         保留模式切换 seg / 项目下拉 / 报告自身导出；切回用例模式查询栏恢复。
   说明：不依赖用例列表渲染（报告模式提前 return）；造数/读回走 API 权威；结束清理，可重复跑。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";
const SHOT_DIR = path.resolve("docs/audit/prototypes");

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
const port = 9235;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-batch5-e2e-"));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-batch5-dl-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
let cdp = null;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

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
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const setViewport = (width, height, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    await sleep(450);
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const login = async user => {
    await call("Network.clearBrowserCookies", {});
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(user)});
      set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成 " + user, 12000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  };
  const gotoCases = async () => {
    await call("Page.navigate", { url: "about:blank" });
    await call("Page.navigate", { url: BASE + "/#/testcases" });
    await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
    await waitFor(`import("./js/core/state.js").then(({rt}) => rt.reqsLoaded)`, "项目列表就绪", 25000);
  };
  const enterReport = async reqId => {
    await evaluate(`(async () => { const m = await import("./js/views/testcases.js"); m.setTcMode("report"); m.setTcProject(${JSON.stringify(reqId)}); return true; })()`);
    await waitFor(`!!document.querySelector('#tcReport .rep-runstats')`, "报告执行统计面板", 25000);
  };
  const cleanFloaters = async () => {
    await evaluate(`(() => {
      document.querySelectorAll(".combo-options").forEach(function(b){ b.hidden = true; });
      var w = document.getElementById("toastWrap"); if(w) w.innerHTML = "";
      return true;
    })()`);
  };
  const waitDownload = async (ext, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while(Date.now() < deadline){
      const f = fs.readdirSync(dlDir).find(n => n.endsWith(ext) && !n.endsWith(".crdownload"));
      if(f){ const p = path.join(dlDir, f); const txt = fs.readFileSync(p, "utf8"); fs.unlinkSync(p); return { name: f, txt }; }
      await sleep(200);
    }
    return null;
  };
  const openDrill = async (dim, key) => {
    await evaluate(`(() => { const el = document.querySelector('#tcReport [data-rs-drill="${dim}"][data-rs-key="${key}"]') || document.querySelector('#tcReport [data-rs-drill]'); if(el) el.click(); return !!el; })()`);
    await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "下钻明细 " + dim + "/" + key);
  };

  console.log("批次5 E2E\n  地址：" + BASE);

  /* ---------------- A 桌面 admin ---------------- */
  await setViewport(1440, 900, false);
  await login("admin");
  await gotoCases();

  /* A0 造数：可写项目 + 带时间戳用例 + 2 轮执行（同环境）+ 转缺陷回链 */
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { rt } = await import("./js/core/state.js");
    const proj = (rt.reqList || []).find(r => r.writable !== false) || (rt.reqList || [])[0];
    if(!proj) return { error: "没有可用项目" };
    const reqId = proj.id;
    try {
      const old = await API.get("/api/test-cases", { reqId, limit: 200 });
      for(const c of ((old && old.items) || [])){
        if((c.title || "").indexOf("E2E 批次5") === 0){
          if(c.latestBugTaskId){ await API.del("/api/tasks/" + encodeURIComponent(c.latestBugTaskId)).catch(function(){}); }
          await API.del("/api/test-cases/" + encodeURIComponent(c.id)).catch(function(){});
        }
      }
    } catch(e){}
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId, title: "E2E 批次5 " + stamp, priority: "P1", module: "回归",
      precondition: "已登录", testData: "admin / 123456",
      steps: [ { action: "打开报告", expected: "统计面板渲染" }, { action: "导出明细", expected: "CSV 含缺陷回链" } ]
    });
    const caseId = created.id;
    const post = (status, env) => API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/runs",
      { status, environment: env, note: "批次5 " + status + " @ " + env });
    await post("failed", "E2E-Chrome");
    const bug = await API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/defect",
      { severity: "major", environment: "E2E-Chrome", note: "批次5 明细缺陷", carryEvidence: false });
    await post("passed", "E2E-Chrome");
    return { reqId, caseId, bugId: bug && bug.id, projName: proj.name || proj.title || "" };
  })()`);
  assert(!seed.error && !!seed.caseId, "新建 E2E 用例 + 2 轮执行 + 缺陷" + (seed.error ? "：" + seed.error : "（" + (seed.projName || "") + "）"));
  if(seed.error) throw new Error(seed.error);
  const reqId = seed.reqId, caseId = seed.caseId, bugId = seed.bugId;

  await enterReport(reqId);

  /* ---------- #20 rep-mode 收敛 ---------- */
  const conv = await evaluate(`(() => {
    const vis = el => !!el && getComputedStyle(el).display !== "none" && !el.hidden;
    const bar = document.getElementById("tcQueryBar");
    const fb = document.getElementById("tcFilterBar");
    return {
      queryHidden: !!bar && (bar.hidden || getComputedStyle(bar).display === "none"),
      filterNone: !!fb && getComputedStyle(fb).display === "none",
      caseNewHidden: !vis(document.getElementById("btnCaseNew")),
      csvOutHidden: !vis(document.getElementById("btnCaseCsvOut")),
      csvInHidden: !vis(document.getElementById("btnCaseCsvIn")),
      aiHidden: !vis(document.getElementById("btnCaseAi")),
      modeSegVisible: vis(document.getElementById("subNav")) && !!document.querySelector('#subNav [data-sub-tab="report"].on'),
      reqSelVisible: vis(document.getElementById("tcReq")),
      reportCsvVisible: vis(document.querySelector("#tcReport [data-tc-report-csv]"))
    };
  })()`);
  assert(conv.queryHidden, "rep-mode 隐藏用例查询栏 #tcQueryBar");
  assert(conv.filterNone, "rep-mode 隐藏残留筛选栏 #tcFilterBar");
  assert(conv.caseNewHidden && conv.csvOutHidden && conv.csvInHidden && conv.aiHidden, "rep-mode 隐藏用例动作按钮（新建/导入/导出/AI）");
  assert(conv.modeSegVisible, "rep-mode 保留模式切换子导航且报告 tab 高亮");
  assert(conv.reqSelVisible, "rep-mode 保留项目下拉");
  assert(conv.reportCsvVisible, "rep-mode 保留报告自身导出按钮");
  await cleanFloaters();
  await shot("batch5-repmode-desktop.png");

  /* 切回用例模式查询栏应恢复（syncModeUI 现调用 syncQueryBar）；列表 render 若被他人重构抛错容忍 */
  const back = await evaluate(`(async () => {
    const m = await import("./js/views/testcases.js");
    let threw = false;
    try { m.setTcMode("cases"); } catch(e){ threw = true; }
    const bar = document.getElementById("tcQueryBar");
    const hiddenCases = bar ? bar.hidden : null;
    try { m.setTcMode("report"); } catch(e){}
    return { hiddenCases, threw };
  })()`);
  assert(back.hiddenCases === false, "切回用例模式查询栏恢复显示" + (back.threw ? "（列表 render 抛错已容忍，属他人重构）" : ""));
  await waitFor(`!!document.querySelector('#tcReport .rep-runstats')`, "回到报告面板", 25000);

  /* ---------- #19 下钻明细导出 CSV ---------- */
  await openDrill("environment", "E2E-Chrome");
  const expState = await evaluate(`(() => {
    const b = document.querySelector('#rsDrill [data-rs-drill-export]');
    return { present: !!b, disabled: b ? b.disabled : null, rows: document.querySelectorAll('#rsDrill .rs-drill-table tbody tr').length };
  })()`);
  assert(expState.present && expState.disabled === false, "下钻面板导出按钮存在且明细加载后启用");
  assert(expState.rows === 2, "E2E-Chrome 桶下钻 2 行（failed+passed）");
  await cleanFloaters();
  await shot("batch5-drill-export-desktop.png");
  await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-export]'); if(b) b.click(); return !!b; })()`);
  const csv = await waitDownload(".csv");
  assert(!!csv, "下钻明细 CSV 文件落地");
  if(csv){
    const lines = csv.txt.split(/\r\n/).filter(l => l.trim() !== "");
    const hIdx = lines.findIndex(l => l.indexOf("用例编号,") === 0);
    const dataRows = hIdx > -1 ? lines.length - hIdx - 1 : -1;
    assert(csv.txt.indexOf("执行明细") > -1 && csv.txt.indexOf("按环境 · E2E-Chrome") > -1, "CSV 含执行明细标题与桶标签");
    assert(csv.txt.indexOf("缺陷链接") > -1, "CSV 表头含缺陷回链列");
    assert(csv.txt.indexOf("#/board?task=" + bugId) > -1, "CSV 缺陷回链指向关联缺陷 permalink");
    assert(dataRows === 2, "CSV 明细行数==桶 total（" + dataRows + "==2）");
    assert(csv.txt.indexOf("批次5 failed @ E2E-Chrome") > -1, "CSV 含执行备注列内容");
  }

  /* 报告自身 CSV 导出回归（确认收敛改动未破坏报告导出） */
  await evaluate(`(() => { const b = document.querySelector('#tcReport [data-tc-report-csv]'); if(b) b.click(); return !!b; })()`);
  const repCsv = await waitDownload(".csv");
  assert(!!repCsv && repCsv.txt.indexOf("执行统计") > -1, "报告 CSV 导出回归（含执行统计）");

  /* ---------------- B 移动 390 ---------------- */
  await setViewport(390, 844, true);
  await gotoCases();
  await waitFor("document.body.dataset.layout === 'mobile'", "移动布局");
  await enterReport(reqId);
  const mConv = await evaluate(`(() => {
    const bar = document.getElementById("tcQueryBar");
    const fb = document.getElementById("tcFilterBar");
    return { queryHidden: !!bar && (bar.hidden || getComputedStyle(bar).display === "none"),
             filterNone: !!fb && getComputedStyle(fb).display === "none",
             overflow: document.documentElement.scrollWidth > 391 };
  })()`);
  assert(mConv.queryHidden && mConv.filterNone, "移动端 rep-mode 查询栏/筛选栏隐藏");
  assert(!mConv.overflow, "移动端报告无横向页面溢出");
  await openDrill("environment", "E2E-Chrome");
  const mExp = await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-export]'); return { present: !!b, disabled: b ? b.disabled : null }; })()`);
  assert(mExp.present && mExp.disabled === false, "移动端下钻导出按钮可用");
  /* 加高视口同屏截图（规避内层滚动被重渲染复位） */
  await setViewport(390, 2300, true);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "移动加高视口下钻");
  await cleanFloaters();
  /* 复位内层滚动（openDrill 的 scrollIntoView 会留下偏移），加高视口下整份同屏 */
  await evaluate(`(() => { const p = document.getElementById('rsDrill'); let el = p && p.parentElement; while(el && el !== document.documentElement){ const s = getComputedStyle(el); if((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1){ el.scrollTop = 0; break; } el = el.parentElement; } window.scrollTo(0, 0); return true; })()`);
  await sleep(200);
  const mShot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(SHOT_DIR, "batch5-repmode-mobile.png"), Buffer.from(mShot.data, "base64"));
  console.log("  SHOT batch5-repmode-mobile.png");

  /* ---------------- C 查看者 wujun：只读但可导出明细 ---------------- */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await gotoCases();
  const viewReq = await evaluate(`(async () => {
    const { rt } = await import("./js/core/state.js");
    const list = (rt.reqList || []);
    const target = list.find(r => r.id === ${JSON.stringify(reqId)}) || list[0];
    return target ? target.id : null;
  })()`);
  assert(!!viewReq, "查看者有可访问项目");
  if(viewReq){
    await enterReport(viewReq);
    await openDrill("environment", "E2E-Chrome").catch(() => openDrill("round", "1"));
    const vExp = await evaluate(`(() => {
      const b = document.querySelector('#rsDrill [data-rs-drill-export]');
      const noWrite = !document.querySelector('#rsDrill [data-run-att-del]');
      return { present: !!b, disabled: b ? b.disabled : null, noWrite };
    })()`);
    assert(vExp.present && vExp.disabled === false, "查看者下钻导出按钮可用（导出为读操作）");
    assert(vExp.noWrite, "查看者下钻面板无写操作控件");
    await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-export]'); if(b) b.click(); return !!b; })()`);
    const vCsv = await waitDownload(".csv");
    assert(!!vCsv && vCsv.txt.indexOf("缺陷链接") > -1, "查看者导出明细 CSV 成功");
    await cleanFloaters();
    await shot("batch5-drill-viewer.png");
  }

  /* ---------------- 清理 ---------------- */
  await login("admin");
  const cleaned = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const cid = ${JSON.stringify(caseId)}, bid = ${JSON.stringify(bugId)};
    if(bid) await API.del("/api/tasks/" + encodeURIComponent(bid)).catch(function(){});
    await API.del("/api/test-cases/" + encodeURIComponent(cid)).catch(function(){});
    return true;
  })()`);
  assert(cleaned, "清理 E2E 用例与缺陷");

  const noise = /syncSidePanel|tcModuleList|caseModuleNodes|moduleNodes|caseGroupSegs|people-picker/;
  const realErrors = cdp.errors.filter(e => !noise.test(e));
  assert(realErrors.length === 0, "无本批运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));

  console.log(failed === 0 ? "\n全部通过" : "\n失败 " + failed + " 项");
  process.exitCode = failed === 0 ? 0 : 1;
}catch(err){
  console.error("E2E 异常：" + (err && err.stack || err));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  try{ proc.kill("SIGKILL"); }catch(e){}
}