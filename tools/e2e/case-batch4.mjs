/* 批次4 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-batch4.mjs
   覆盖两项（提测时间拆字段已让位 feat/test-round-timestamps worktree，本批只做执行统计）：
     #16 执行统计下钻：报告页统计桶（执行人 / 环境 / 轮次）可点击展开该桶内执行流水明细。
         口径权威验证：drill 行数 == 聚合桶 total，且每行满足桶谓词（轮次键 / 环境文本 / 执行人名）；
         非法维度 400；__none 映射空串；明细行可跳执行历史与关联缺陷；键盘 Enter/Space 可达；再点同桶收起。
     #17 执行统计导出：CSV / Word 补三维统计表；PDF（打印）补 rs-* 打印样式并隐藏交互下钻面板。
   说明：用例列表 render() 正被另一会话目录树重构占用（syncSidePanel 未定义），
        本脚本不依赖列表渲染：报告页用 setTcMode("report")（提前 return，不走 render），
        造数 / 读回走 API 权威。每次运行新建带时间戳用例并造数，结束清理，可重复跑。 */
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
const port = 9234;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-batch4-e2e-"));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-batch4-dl-"));
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
  const forceCloseOverlays = async () => {
    await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      const { UI } = await import("./js/core/ui.js");
      const td = await import("./js/core/task-drawer.js");
      rt.formDirty = false;
      if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
      try { td.tryCloseTaskDrawer(); } catch(e){}
      ["dlgCaseRun","dlgCaseDefect","dlgCase","dlgCaseRuns"].forEach(function(id){
        var el = document.getElementById(id);
        if(el && el.classList.contains("open")) UI.closeModal(el);
      });
      document.querySelectorAll(".combo-options").forEach(function(b){ b.hidden = true; });
      var cf = document.getElementById("dlgConfirm");
      if(cf && cf.classList.contains("open")){ var c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); }
      return true;
    })()`);
    await sleep(250);
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

  console.log("批次4 E2E\n  地址：" + BASE);

  /* ---------------- A 桌面 admin ---------------- */
  await setViewport(1440, 900, false);
  await login("admin");
  await gotoCases();

  /* A0 造数：选可写项目，新建带时间戳用例 + 4 轮执行（2 环境、轮次 1~4）+ 转缺陷回链 */
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { rt } = await import("./js/core/state.js");
    const proj = (rt.reqList || []).find(r => r.writable !== false) || (rt.reqList || [])[0];
    if(!proj) return { error: "没有可用项目" };
    const reqId = proj.id;
    try {
      const old = await API.get("/api/test-cases", { reqId, limit: 200 });
      for(const c of ((old && old.items) || [])){
        if((c.title || "").indexOf("E2E 批次4") === 0){
          if(c.latestBugTaskId){ await API.del("/api/tasks/" + encodeURIComponent(c.latestBugTaskId)).catch(function(){}); }
          await API.del("/api/test-cases/" + encodeURIComponent(c.id)).catch(function(){});
        }
      }
    } catch(e){}
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId, title: "E2E 批次4 " + stamp, priority: "P1", module: "回归",
      precondition: "已登录", testData: "admin / 123456",
      steps: [ { action: "打开报告", expected: "统计面板渲染" }, { action: "点统计桶", expected: "展开流水明细" } ]
    });
    const caseId = created.id;
    const post = (status, env) => API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/runs",
      { status, environment: env, note: "批次4 " + status + " @ " + env });
    await post("failed", "E2E-Chrome");
    const bug = await API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/defect",
      { severity: "major", environment: "E2E-Chrome", note: "批次4 下钻缺陷", carryEvidence: false });
    await post("passed", "E2E-Chrome");
    await post("blocked", "E2E-Safari");
    await post("skipped", "E2E-Safari");
    window.__e2e4 = { reqId, caseId, stamp, bugId: bug && bug.id };
    return { reqId, caseId, bugId: bug && bug.id, adminUid: rt.currentUser.id, adminName: rt.currentUser.name || rt.currentUser.displayName || "", projName: proj.name || proj.title || "" };
  })()`);
  assert(!seed.error && !!seed.caseId, "新建 E2E 用例 + 4 轮执行 + 缺陷" + (seed.error ? "：" + seed.error : "（" + (seed.projName || "") + "）"));
  if(seed.error) throw new Error(seed.error);
  const reqId = seed.reqId, caseId = seed.caseId;

  /* ---------- #16 口径权威验证：drill 行数 == 桶 total，且每行满足桶谓词 ---------- */
  const caliber = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const reqId = ${JSON.stringify(reqId)};
    const cid = ${JSON.stringify(caseId)};
    const stats = await API.get("/api/test-cases/run-stats", { reqId });
    const dims = [["executor", stats.byExecutor], ["environment", stats.byEnvironment], ["round", stats.byRound]];
    const out = { totalRuns: stats.totalRuns, checks: [], seeded: null, badDim: null };
    for(const [dim, buckets] of dims){
      for(const b of (buckets || [])){
        const list = (await API.get("/api/test-cases/run-stats/drill", { reqId, dim, key: b.key })) || [];
        let predOk = true, predMsg = "";
        if(dim === "round"){ predOk = list.every(r => r.roundKey === b.key); predMsg = "roundKey==" + b.key; }
        else if(dim === "environment"){ const want = b.key === "__none" ? "" : b.key; predOk = list.every(r => (r.environment || "") === want); predMsg = "env==" + (want || "(空)"); }
        else if(b.key === "__none"){ predOk = list.every(r => !r.executedBy); predMsg = "执行人空"; }
        else { predOk = list.every(r => r.executedBy === b.label); predMsg = "执行人==" + b.label; }
        out.checks.push({ dim, key: b.key, label: b.label, total: b.total, count: list.length, countOk: list.length === b.total, predOk, predMsg });
      }
    }
    const r3 = (await API.get("/api/test-cases/run-stats/drill", { reqId, dim: "round", key: "3+" })) || [];
    const safari = (await API.get("/api/test-cases/run-stats/drill", { reqId, dim: "environment", key: "E2E-Safari" })) || [];
    const chrome = (await API.get("/api/test-cases/run-stats/drill", { reqId, dim: "environment", key: "E2E-Chrome" })) || [];
    const mine = safari.filter(r => r.caseId === cid);
    out.seeded = {
      in3plus: r3.some(r => r.caseId === cid && r.round >= 3),
      safariCount: mine.length,
      safariStatuses: mine.map(r => r.status).sort(),
      bugLinked: chrome.some(r => r.caseId === cid && !!r.bugTaskId)
    };
    try { await API.get("/api/test-cases/run-stats/drill", { reqId, dim: "bogus", key: "1" }); out.badDim = "no-error"; }
    catch(e){ out.badDim = (e && e.code) || (e && e.message) || "error"; }
    return out;
  })()`);
  assert(caliber.totalRuns > 0, "项目有执行流水（totalRuns=" + caliber.totalRuns + "）");
  for(const c of caliber.checks){
    assert(c.countOk, "下钻行数==桶总数 · " + c.dim + "/" + c.label + "（" + c.count + "==" + c.total + "）");
    assert(c.predOk, "下钻谓词一致 · " + c.dim + "/" + c.label + "（" + c.predMsg + "）");
  }
  assert(caliber.seeded.in3plus, "造数用例进入第 3 轮及以上桶（round>=3）");
  assert(caliber.seeded.safariCount === 2, "造数用例 E2E-Safari 环境 2 条流水");
  assert(JSON.stringify(caliber.seeded.safariStatuses) === JSON.stringify(["blocked","skipped"]), "E2E-Safari 流水结果=阻塞+跳过");
  assert(caliber.seeded.bugLinked, "造数缺陷回链到执行流水（bugTaskId 非空）");
  assert(String(caliber.badDim) === "400", "非法统计维度返回 400（实际：" + caliber.badDim + "）");

  /* ---------- #16 UI 下钻：点桶展开明细 ---------- */
  await enterReport(reqId);
  await cleanFloaters();
  await shot("batch4-report-stats-desktop.png");
  const bucketCount = await evaluate(`document.querySelectorAll('#tcReport .rs-row.is-drill').length`);
  assert(bucketCount === caliber.checks.length, "报告统计桶全部可点击（" + bucketCount + " 个 is-drill）");

  /* 点「第 3 轮及以上」桶 */
  await evaluate(`(() => { const el = document.querySelector('#tcReport [data-rs-drill="round"][data-rs-key="3+"]'); if(el) el.click(); return !!el; })()`);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "轮次下钻明细表");
  const roundDrill = await evaluate(`(() => {
    const p = document.getElementById('rsDrill');
    const head = p.querySelector('.rs-drill-head b').textContent;
    const rows = [...p.querySelectorAll('.rs-drill-table tbody tr')];
    const roundCells = rows.map(tr => tr.children[4].textContent.trim());
    const active = document.querySelector('#tcReport .rs-row.is-active');
    return { head, count: rows.length, allRound3plus: roundCells.every(t => { const mm = t.match(/第\\s*(\\d+)\\s*轮/); return mm ? Number(mm[1]) >= 3 : false; }), activeKey: active ? active.dataset.rsKey : null,
      hasCaseBtn: !!p.querySelector('[data-rs-drill-case]'), cols: p.querySelectorAll('.rs-drill-table thead th').length };
  })()`);
  assert(roundDrill.head.indexOf("按轮次") === 0 && roundDrill.head.indexOf("第 3 轮及以上") > -1, "下钻标题=按轮次 · 第 3 轮及以上");
  assert(roundDrill.count === (caliber.checks.find(c => c.dim === "round" && c.key === "3+") || {}).total, "轮次下钻行数==桶总数");
  assert(roundDrill.allRound3plus, "下钻每行轮次>=3");
  assert(roundDrill.activeKey === "3+", "被点桶高亮 is-active");
  assert(roundDrill.hasCaseBtn && roundDrill.cols === 8, "明细行含用例跳转按钮且 8 列");
  await cleanFloaters();
  await shot("batch4-drill-round-desktop.png");

  /* 明细行点用例 → 执行历史弹框 */
  await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-case]'); if(b) b.click(); return !!b; })()`);
  await waitFor(`(() => { const d = document.getElementById('dlgCaseRuns'); return d && d.classList.contains('open'); })()`, "执行历史弹框");
  assert(true, "下钻明细点用例打开执行历史弹框");
  await forceCloseOverlays();

  /* 切到环境桶（Chrome），验证切换 + 缺陷跳转 */
  await evaluate(`(() => { const el = document.querySelector('#tcReport [data-rs-drill="environment"][data-rs-key="Chrome 120 / macOS 14"]') || document.querySelector('#tcReport [data-rs-drill="environment"]'); if(el) el.click(); return !!el; })()`);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "环境下钻明细表");
  const envDrill = await evaluate(`(() => {
    const p = document.getElementById('rsDrill');
    const rows = [...p.querySelectorAll('.rs-drill-table tbody tr')];
    const bugBtn = p.querySelector('[data-rs-drill-bug]');
    const act = document.querySelector('#tcReport .rs-row.is-active');
    return { head: p.querySelector('.rs-drill-head b').textContent, count: rows.length, bugBtn: bugBtn ? bugBtn.dataset.rsDrillBug : null,
      activeKey: act ? act.dataset.rsKey : null };
  })()`);
  assert(envDrill.head.indexOf("按环境") === 0, "切换下钻标题=按环境");
  assert(envDrill.activeKey !== "3+", "切换桶后高亮随之转移");
  await cleanFloaters();
  await shot("batch4-drill-env-desktop.png");
  if(envDrill.bugBtn){
    await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-bug]'); if(b) b.click(); return !!b; })()`);
    const drawerOpened = await waitFor(`(() => { const d = document.getElementById('taskDrawer'); return d && (d.classList.contains('open') || d.classList.contains('on')); })()`, "缺陷抽屉", 8000).then(()=>true).catch(()=>false);
    assert(drawerOpened, "下钻明细点缺陷打开工作项抽屉");
    await forceCloseOverlays();
  } else { console.log("  NOTE 当前环境桶无关联缺陷行，缺陷跳转用造数缺陷验证"); }

  /* 返回统计 → 面板收起 */
  await evaluate(`(() => { const b = document.querySelector('#rsDrill [data-rs-drill-close]'); if(b) b.click(); return !!b; })()`);
  await sleep(200);
  const closed = await evaluate(`(() => { const p = document.getElementById('rsDrill'); return p && p.hidden && !document.querySelector('#tcReport .rs-row.is-active'); })()`);
  assert(closed, "返回统计收起下钻面板并清除高亮");

  /* 键盘可达：聚焦执行人桶按 Enter 展开 */
  const kb = await evaluate(`(() => {
    const el = document.querySelector('#tcReport [data-rs-drill="executor"]');
    if(!el) return false;
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelector('.rs-drill-table'); })()`, "键盘展开下钻", 8000);
  assert(kb, "统计桶键盘 Enter 可展开下钻（role=button tabindex=0）");
  /* 再点同桶收起（toggle） */
  await evaluate(`(() => { const el = document.querySelector('#tcReport .rs-row.is-active'); if(el) el.click(); return !!el; })()`);
  await sleep(200);
  const toggled = await evaluate(`(() => { const p = document.getElementById('rsDrill'); return p && p.hidden; })()`);
  assert(toggled, "再次点击同一桶收起下钻");

  /* ---------- #17 导出：CSV / Word 补统计表；PDF 补打印样式并隐藏下钻 ---------- */
  await evaluate(`(() => { const b = document.querySelector('[data-tc-report-csv]'); if(b) b.click(); return !!b; })()`);
  const csv = await waitDownload(".csv");
  assert(!!csv, "导出 CSV 文件落地");
  if(csv){
    const ok = csv.txt.indexOf("执行统计") > -1 && csv.txt.indexOf("按执行人") > -1 && csv.txt.indexOf("按环境") > -1 && csv.txt.indexOf("按轮次") > -1 && csv.txt.indexOf("通过率") > -1;
    assert(ok, "CSV 含执行统计三维表头与通过率");
    assert(csv.txt.indexOf("第 3 轮及以上") > -1 || csv.txt.indexOf("首次执行") > -1, "CSV 含轮次桶标签");
  }
  await evaluate(`(() => { const b = document.querySelector('[data-tc-report-doc]'); if(b) b.click(); return !!b; })()`);
  const doc = await waitDownload(".doc");
  assert(!!doc, "导出 Word 文件落地");
  if(doc){
    const ok = doc.txt.indexOf("执行统计 · 共") > -1 && doc.txt.indexOf("<th>分组</th>") > -1 && doc.txt.indexOf("按执行人") > -1 && doc.txt.indexOf("按环境") > -1 && doc.txt.indexOf("按轮次") > -1;
    assert(ok, "Word 含执行统计三维表（分组/次数/通过/失败/阻塞/跳过/通过率）");
  }
  /* PDF：读打印 iframe 的 HTML（print() 在 headless 静默），验证 rs-* 打印样式 + 隐藏下钻 */
  const pdfHtml = await evaluate(`(() => {
    const b = document.querySelector('[data-tc-report-print]'); if(b) b.click();
    const frames = [...document.querySelectorAll('iframe')];
    const f = frames.find(x => { try { return x.style.visibility === 'hidden' && x.contentDocument && x.contentDocument.documentElement.outerHTML.indexOf('测试报告') > -1; } catch(e){ return false; } });
    if(!f) return null;
    const d = f.contentDocument || f.contentWindow.document;
    return d.documentElement.outerHTML;
  })()`);
  assert(!!pdfHtml, "PDF 打印宿主 iframe 生成");
  if(pdfHtml){
    assert(pdfHtml.indexOf(".rs-drill{display:none") > -1, "PDF 打印样式隐藏交互下钻面板");
    assert(pdfHtml.indexOf(".rs-bar{") > -1 && pdfHtml.indexOf(".rs-dot.ok{") > -1, "PDF 补 rs-* 统计打印样式（进度条/分布点）");
    assert(pdfHtml.indexOf("执行统计") > -1 && pdfHtml.indexOf("rep-runstats") > -1, "PDF 含执行统计区块");
    assert(pdfHtml.indexOf("rs-drill-table") === -1, "PDF 不含下钻明细表（收起态打印）");
  }
  await sleep(1600);

  /* ---------------- B 移动 390：统计单列、下钻表横向滚动、无页面溢出 ---------------- */
  await setViewport(390, 844, true);
  await gotoCases();
  await waitFor("document.body.dataset.layout === 'mobile'", "移动布局");
  await enterReport(reqId);
  await evaluate(`(() => { const el = document.querySelector('#tcReport [data-rs-drill="round"][data-rs-key="3+"]') || document.querySelector('#tcReport [data-rs-drill]'); if(el) el.click(); return !!el; })()`);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "移动下钻明细");
  const m = await evaluate(`(() => {
    const sec = document.querySelector('#tcReport .rep-runstats');
    const grid = getComputedStyle(sec.querySelector('.rs-grid')).gridTemplateColumns.split(' ').length;
    const body = document.querySelector('#rsDrill .rs-drill-body');
    return { layout: document.body.dataset.layout, grid, tableScroll: body.scrollWidth > body.clientWidth, overflow: document.documentElement.scrollWidth > 391 };
  })()`);
  assert(m.layout === "mobile" && m.grid === 1, "移动端执行统计单列");
  assert(m.tableScroll, "移动端下钻明细表横向可滚动（不挤压页面）");
  assert(!m.overflow, "移动端报告无横向页面溢出");
  /* 移动审计截图：移动宽度 + 加高视口，让整份报告与下钻同屏、无需内层滚动，
     规避周期性重渲染复位 scrollTop 导致截图停在报告顶部的问题（功能断言已在 844 高完成） */
  await setViewport(390, 2300, true);
  await evaluate(`(() => { const p = document.getElementById('rsDrill'); if(p && !p.hidden && p.querySelector('.rs-drill-table tbody tr')) return true; const el = document.querySelector('#tcReport [data-rs-drill="round"][data-rs-key="3+"]') || document.querySelector('#tcReport [data-rs-drill]'); if(el) el.click(); return !!el; })()`);
  await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "移动下钻明细（加高视口截图）");
  await cleanFloaters();
  await sleep(200);
  const mFit = await evaluate(`(() => { const p = document.getElementById('rsDrill'); const r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, hidden: p.hidden }; })()`);
  console.log("  移动加高视口下钻位置：" + JSON.stringify(mFit));
  const mShot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(SHOT_DIR, "batch4-drill-mobile.png"), Buffer.from(mShot.data, "base64"));
  console.log("  SHOT batch4-drill-mobile.png");

  /* ---------------- C 查看者 wujun：报告 + 下钻只读可见 ---------------- */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await gotoCases();
  const viewReq = await evaluate(`(async () => {
    const { rt } = await import("./js/core/state.js");
    const { API } = await import("./js/core/api.js");
    const list = (rt.reqList || []);
    const target = list.find(r => r.id === ${JSON.stringify(reqId)}) || list[0];
    if(!target) return null;
    const st = await API.get("/api/test-cases/run-stats", { reqId: target.id }).catch(() => null);
    return { reqId: target.id, totalRuns: st ? st.totalRuns : 0 };
  })()`);
  assert(!!viewReq, "查看者有可访问项目");
  if(viewReq){
    await enterReport(viewReq.reqId);
    /* v4 改版后报告头为 rep-banner/rep-kpis，rep-head 已不存在；等异步渲染落盘再断言 */
    await waitFor(`!!document.querySelector('#tcReport .rep-banner') && !!document.querySelector('#tcReport .rep-kpis')`, "查看者报告渲染", 15000);
    const v = await evaluate(`(() => {
      const sec = document.querySelector('#tcReport .rep-runstats');
      return { hasReport: !!document.querySelector('#tcReport .rep-banner'), hasStats: !!sec, drills: sec ? sec.querySelectorAll('.rs-row.is-drill').length : 0 };
    })()`);
    assert(v.hasReport && v.hasStats, "查看者可看报告与执行统计");
    if(v.drills > 0){
      await evaluate(`(() => { const el = document.querySelector('#tcReport [data-rs-drill]'); if(el) el.click(); return !!el; })()`);
      const opened = await waitFor(`(() => { const p = document.getElementById('rsDrill'); return p && !p.hidden && p.querySelectorAll('.rs-drill-table tbody tr').length > 0; })()`, "查看者下钻", 10000).then(()=>true).catch(()=>false);
      assert(opened, "查看者点桶可下钻（只读，assertView 通过）");
      const noWrite = await evaluate(`!document.querySelector('#rsDrill [data-run-att-del], #rsDrill [data-rs-drill-case] + .icon-btn.danger')`);
      assert(noWrite, "下钻面板无写操作控件（只读）");
    }
    await cleanFloaters();
    await shot("batch4-drill-viewer.png");
  }

  /* ---------------- 清理：删除造数用例与缺陷（admin） ---------------- */
  await login("admin");
  const cleaned = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const out = { case: false, bug: false };
    try { await API.del("/api/test-cases/" + encodeURIComponent(${JSON.stringify(caseId)})); out.case = true; } catch(e){}
    try { if(window.__e2e4 && window.__e2e4.bugId){ await API.del("/api/tasks/" + encodeURIComponent(window.__e2e4.bugId)); out.bug = true; } } catch(e){}
    return out;
  })()`);
  assert(cleaned.case, "清理 E2E 用例");

  /* 运行时错误分类：目录树重构（syncSidePanel 等）属另一会话占用，单列；其余视为本批回归 */
  const refactorNoise = /syncSidePanel|syncQueryBar|tcModuleList|caseModuleNodes|moduleNodes|caseGroupSegs|people-picker/;
  const allErrs = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  const refactorErrs = allErrs.filter(e => refactorNoise.test(e));
  const realErrors = allErrs.filter(e => !refactorNoise.test(e));
  assert(realErrors.length === 0, "无本批运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  if(refactorErrs.length) console.log("  NOTE 另一会话重构残留错误（非本批）：" + refactorErrs.length + " 条");
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  if(cdp && cdp.errors.length) console.error("捕获的运行时错误：\n  " + cdp.errors.join("\n  "));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
  try{ fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dlDir, { recursive: true, force: true }); }catch(e){}
}