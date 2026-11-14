/* 筛选项一致性审计 · 批次 1 验证（真 Chrome + 本地栈）
   用法：node tools/e2e/filter-batch1.mjs
   覆盖：缺陷优先级筛选、用例优先级显示名、搜索占位符随范围切换、
        分支清空筛选（含深链来源）、缺陷恢复默认；并产出 1440 / 390 截图。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
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
const port = 9226;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "filter-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage",
  "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const skip = m => console.log("  SKIP " + m);
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
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
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
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  /* 应用内切视图走侧栏（hashchange 只处理需求池路由），避免只改地址不换页 */
  const openView = async view => {
    const ok = await evaluate(`(() => {
      const n = document.querySelector('.nav-item[data-view=${JSON.stringify(view)}]');
      if(!n) return false;
      n.click();
      return true;
    })()`);
    if(!ok) throw new Error("找不到侧栏入口：" + view);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, "切换到 " + view);
  };

  console.log("筛选项批次 1 验证\n  地址：" + BASE);
  await setViewport(1440, 900, false);
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
  pass("登录 " + USER);

  /* ---------------- 用例：优先级显示名 + 搜索范围 ---------------- */
  await openView("testcases");
  await waitFor(`document.querySelectorAll("#tcList .tc-row").length > 0 || !!document.querySelector("#tcList .empty-state")`, "用例列表");
  const caseInit = await evaluate(`(() => {
    const opts = [...document.querySelectorAll("#tcPri option")].map(o => o.textContent.trim());
    return {
      opts,
      labelsOk: opts.slice(1, 5).every(t => t.indexOf(" · ") === 2 && t.length > 5),
      ph: (document.getElementById("tcSearch") || {}).placeholder || "",
      clearHidden: (document.getElementById("tcClearFilter") || {}).hidden
    };
  })()`);
  assert(caseInit.opts.length >= 2 && caseInit.opts.slice(1).every(t => /（[1-9]\d*）$/.test(t)),
    "用例优先级下拉只列有结果的档位（含计数，" + caseInit.opts.length + " 项）");
  assert(caseInit.labelsOk, "用例优先级选项带自定义名称（" + caseInit.opts.slice(1, 5).join(" / ") + "）");
  assert(caseInit.ph === "搜索本项目用例…", "用例默认单项目：占位符为「搜索本项目用例…」（" + caseInit.ph + "）");

  await evaluate(`(() => {
    const sel = document.getElementById("tcReq");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, "__all__");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const caseAll = await evaluate(`(() => ({
    ph: (document.getElementById("tcSearch") || {}).placeholder || "",
    title: (document.getElementById("tcSearch") || {}).title || "",
    scope: (document.getElementById("tcReq") || {}).value
  }))()`);
  assert(caseAll.scope === "__all__" && caseAll.ph === "搜索全部项目用例…", "切到全部项目：占位符同步为「搜索全部项目用例…」（" + caseAll.ph + "）");
  assert(caseAll.title.indexOf("全部项目") !== -1, "搜索提示同步为全部项目（" + caseAll.title + "）");
  await shot("audit-batch1-cases-1440.png");

  /* 回到具体项目，确认占位符能切回 */
  await evaluate(`(() => {
    const sel = document.getElementById("tcReq");
    const opt = [...sel.options].find(o => o.value && o.value !== "__all__");
    if(!opt) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const caseOne = await evaluate(`(document.getElementById("tcSearch") || {}).placeholder || ""`);
  assert(caseOne === "搜索本项目用例…", "切回具体项目：占位符回到「搜索本项目用例…」（" + caseOne + "）");

  /* ---------------- 缺陷：优先级筛选 + 恢复默认 ---------------- */
  await evaluate(`document.querySelector('[data-tc-mode="defects"]').click()`);
  await waitFor(`!document.getElementById("tcDefectBar").hidden`, "缺陷筛选栏");
  await waitFor(`!!document.querySelector("#tcDefRows .tc-def-row") || !!document.querySelector("#tcDefRows .empty-state")`, "缺陷列表");
  const defInit = await evaluate(`(() => {
    const sel = document.getElementById("tcDefPriority");
    const opts = [...sel.options].map(o => o.textContent.trim());
    return {
      opts,
      labelsOk: opts.slice(1, 5).every(t => t.indexOf(" · ") === 2 && t.length > 5),
      ph: (document.getElementById("tcDefSearch") || {}).placeholder || "",
      resetText: (document.getElementById("tcDefReset") || {}).textContent.replace(/\\s+/g, ""),
      rows: document.querySelectorAll("#tcDefRows .tc-def-row").length
    };
  })()`);
  assert(defInit.opts.length >= 2 && defInit.opts.slice(1).every(t => /（[1-9]\d*）$/.test(t)),
    "缺陷优先级下拉只列有结果的档位（含计数，" + defInit.opts.length + " 项）");
  assert(defInit.labelsOk, "缺陷优先级选项带显示名（" + defInit.opts.slice(1, 5).join(" / ") + "）");
  assert(defInit.ph === "搜索全部项目缺陷…", "缺陷默认全部项目：占位符为「搜索全部项目缺陷…」（" + defInit.ph + "）");
  assert(defInit.resetText.indexOf("恢复默认") !== -1, "重置按钮改名为「恢复默认」（" + defInit.resetText + "）");

  const picked = await evaluate(`(() => {
    const cell = document.querySelector("#tcDefRows .tc-def-pri");
    if(!cell) return null;
    const name = (cell.title || "").replace(/^优先级：/, "");
    const sel = document.getElementById("tcDefPriority");
    const opt = [...sel.options].find(o => o.value !== "all" && o.value !== "__none" && o.textContent.trim().endsWith(" · " + name));
    if(!opt) return null;
    const before = document.querySelectorAll("#tcDefRows .tc-def-row").length;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { code: opt.value, name, before };
  })()`);
  if(picked){
    await sleep(500);
    const defFilt = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#tcDefRows .tc-def-row")];
      return {
        rows: rows.length,
        names: rows.map(r => (r.querySelector(".tc-def-pri") || {}).textContent || "").map(s => s.trim()),
        foot: document.getElementById("tcDefFoot").textContent,
        clearMark: document.getElementById("tcDefPriority").classList.contains("is-filtered"),
        val: document.getElementById("tcDefPriority").value
      };
    })()`);
    assert(defFilt.val === picked.code, "缺陷按优先级筛选生效（" + picked.code + " · " + picked.name + "，" + picked.before + " → " + defFilt.rows + " 条）");
    assert(defFilt.names.length > 0 && defFilt.names.every(c => c === picked.name), "筛选后每行优先级一致（" + [...new Set(defFilt.names)].join("/") + "）");
    assert(defFilt.foot.indexOf("优先级 " + picked.name) !== -1, "页脚标注当前优先级（" + defFilt.foot + "）");
    assert(defFilt.clearMark === true, "优先级下拉高亮为已筛选");
  }else{
    skip("演示数据没有带优先级的缺陷，跳过筛选结果断言");
  }
  await shot("audit-batch1-defects-1440.png");

  /* 搜索范围随项目切换 */
  const defScope = await evaluate(`(() => {
    const req = document.getElementById("tcDefReq");
    const opt = [...req.options].find(o => o.value);
    if(!opt) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(req), "value").set.call(req, opt.value);
    req.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if(defScope){
    await sleep(1000);
    const defPh = await evaluate(`(document.getElementById("tcDefSearch") || {}).placeholder || ""`);
    assert(defPh === "搜索本项目缺陷…", "缺陷选具体项目后占位符切为「搜索本项目缺陷…」（" + defPh + "）");
  }else{
    skip("没有可用项目，跳过缺陷项目范围断言");
  }

  /* 恢复默认：范围回到全部项目、状态未关闭、其他条件清空 */
  await evaluate(`(() => {
    const q = document.getElementById("tcDefSearch");
    q.value = "zzz-no-hit";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("tcDefReset").click();
    return true;
  })()`);
  await sleep(1200);
  const defReset = await evaluate(`(() => ({
    req: document.getElementById("tcDefReq").value,
    status: document.getElementById("tcDefStatus").value,
    sev: document.getElementById("tcDefSeverity").value,
    pri: document.getElementById("tcDefPriority").value,
    owner: document.getElementById("tcDefOwner").value,
    ver: document.getElementById("tcDefVersion").value,
    q: document.getElementById("tcDefSearch").value,
    ph: document.getElementById("tcDefSearch").placeholder,
    foot: document.getElementById("tcDefFoot").textContent
  }))()`);
  assert(defReset.req === "" && defReset.status === "open", "恢复默认：范围回到全部项目、状态回到未关闭（" + defReset.req + " / " + defReset.status + "）");
  assert(defReset.sev === "all" && defReset.pri === "all" && defReset.owner === "all" && defReset.ver === "all" && defReset.q === "",
    "恢复默认：严重度/优先级/负责人/版本/搜索全部清空");
  assert(defReset.ph === "搜索全部项目缺陷…", "恢复默认后占位符回到全部项目（" + defReset.ph + "）");
  assert(defReset.foot.indexOf("默认不含已关闭") !== -1, "恢复默认后页脚标注默认口径（" + defReset.foot + "）");

  /* ---------------- 分支：清空筛选 + 搜索范围 + 深链来源 ---------------- */
  await openView("branches");
  await waitFor(`!!document.querySelector("#branchGroups .br-card") || !!document.querySelector("#branchGroups .br-empty-full")`, "分支列表");
  await sleep(500);
  const brInit = await evaluate(`(() => ({
    clearHidden: document.getElementById("branchClearFilter").hidden,
    ph: document.getElementById("branchSearch").placeholder
  }))()`);
  assert(brInit.clearHidden === true, "分支初始无筛选：不显示「清空筛选」");
  assert(brInit.ph === "搜索全部分支…", "分支默认占位符为「搜索全部分支…」（" + brInit.ph + "）");

  await evaluate(`(() => {
    const st = document.getElementById("branchStatusFilter");
    const opt = [...st.options].find(o => o.value);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(st), "value").set.call(st, opt.value);
    st.dispatchEvent(new Event("change", { bubbles: true }));
    const pr = document.getElementById("branchProjectFilter");
    const popt = [...pr.options].find(o => o.value);
    if(popt){
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pr), "value").set.call(pr, popt.value);
      pr.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const q = document.getElementById("branchSearch");
    q.value = "release";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(1400);
  const brFilt = await evaluate(`(() => ({
    st: document.getElementById("branchStatusFilter").value,
    pr: document.getElementById("branchProjectFilter").value,
    q: document.getElementById("branchSearch").value,
    ph: document.getElementById("branchSearch").placeholder,
    clearHidden: document.getElementById("branchClearFilter").hidden,
    meta: (document.getElementById("branchMeta") || {}).textContent || ""
  }))()`);
  assert(!brFilt.clearHidden, "有条件时显示「清空筛选」");
  assert(brFilt.ph === "搜索所选项目分支…", "选了项目后搜索占位符切为「搜索所选项目分支…」（" + brFilt.ph + "）");
  assert(brFilt.meta.indexOf("项目「") !== -1, "页脚标注项目筛选（" + brFilt.meta.slice(0, 80) + "…）");
  await shot("audit-batch1-branches-1440.png");

  await evaluate(`document.getElementById("branchClearFilter").click()`);
  await sleep(1400);
  const brClear = await evaluate(`(() => ({
    st: document.getElementById("branchStatusFilter").value,
    pr: document.getElementById("branchProjectFilter").value,
    ow: document.getElementById("branchOwnerFilter").value,
    q: document.getElementById("branchSearch").value,
    ph: document.getElementById("branchSearch").placeholder,
    clearHidden: document.getElementById("branchClearFilter").hidden,
    source: !!document.getElementById("branchSource")
  }))()`);
  assert(brClear.st === "" && brClear.ow === "" && brClear.q === "",
    "清空筛选：状态 / 负责人 / 关键词复位，项目范围保留（" + brClear.pr + "）");
  assert(brClear.pr !== "" && brClear.ph === "搜索所选项目分支…", "清空后仍停留在所选项目，占位符跟随项目（" + brClear.ph + "）");
  assert(brClear.clearHidden, "清空后没有可清条件：按钮收起");

  /* 深链来源条也应被一键撤掉：整页带 hash 进入，走真实深链路径 */
  await call("Page.navigate", { url: BASE + "/?e2e=1#/branches?status=dev" });
  await waitFor(`document.body && document.body.dataset.view === "branches"`, "深链分支视图", 30000);
  await waitFor(`!!document.getElementById("branchSource")`, "深链来源条");
  await evaluate(`document.getElementById("branchClearFilter").click()`);
  await sleep(1400);
  const brDeep = await evaluate(`(() => ({
    source: !!document.getElementById("branchSource"),
    hash: location.hash,
    st: document.getElementById("branchStatusFilter").value
  }))()`);
  assert(!brDeep.source && brDeep.hash === "#/branches" && brDeep.st === "",
    "清空筛选同时撤掉深链来源条并还原地址（" + brDeep.hash + " / " + brDeep.st + "）");

  /* ---------------- 移动端 390 ---------------- */
  await setViewport(390, 844, true);
  await openView("testcases");
  await sleep(1200);
  await shot("audit-batch1-cases-390.png");
  await evaluate(`document.querySelector('[data-tc-mode="defects"]').click()`);
  await sleep(1200);
  await shot("audit-batch1-defects-390.png");
  await openView("branches");
  await sleep(1500);
  await shot("audit-batch1-branches-390.png");
  /* 移动端有条件时：确认「清空筛选」不会挤坏工具栏 */
  await evaluate(`(() => {
    const st = document.getElementById("branchStatusFilter");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(st), "value").set.call(st, "dev");
    st.dispatchEvent(new Event("change", { bubbles: true }));
    const q = document.getElementById("branchSearch");
    q.value = "feature";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(1000);
  await shot("audit-batch1-branches-filtered-390.png");

  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));

  console.log("\n结果：" + (failed ? failed + " 项失败" : "全部通过") + "，截图在 " + SHOT_DIR);
  if(failed) process.exitCode = 1;
}catch(e){
  console.error("\n中断：" + e.stack || e);
  process.exitCode = 1;
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){ /* noop */ }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){ /* noop */ }
}
