/* 筛选项一致性审计 · 批次 2 验证（真 Chrome + 本地栈）
   用法：node tools/e2e/filter-batch2.mjs
   覆盖：项目范围控件位置、清空筛选保留项目、缺陷 / 分支保存视图、
        测试计划搜索与状态筛选、分支负责人计数、用例移动端筛选角标；
        并产出 1440 / 390 截图。 */
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
const port = 9227;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "filter-e2e2-"));
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
  const setSelect = (id, value) => evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  /* 弹窗保存：填入名称并提交；返回视图名 */
  const saveViewThroughPrompt = async name => {
    await waitFor(`!!document.querySelector(".modal-layer.open input")`, "保存视图输入框");
    await evaluate(`(() => {
      const input = document.querySelector(".modal-layer.open input");
      input.value = ${JSON.stringify(name)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".modal-layer.open form").requestSubmit();
      return true;
    })()`);
    await sleep(900);
  };
  const deleteViewThroughConfirm = async (attr, name) => {
    const found = await evaluate(`(() => {
      const items = [...document.querySelectorAll(${JSON.stringify("[data-" + attr + "]")})];
      const hit = items.find(b => b.textContent.trim() === ${JSON.stringify(name)});
      if(!hit) return false;
      return true;
    })()`);
    if(!found) return false;
    const clickedDel = await evaluate(`(() => {
      const items = [...document.querySelectorAll(${JSON.stringify("[data-" + attr + "]")})];
      const row = items.find(b => b.textContent.trim() === ${JSON.stringify(name)}).closest(".menu-row");
      const d = row.querySelector(${JSON.stringify("[data-" + attr + "-del]")});
      if(!d) return false;
      d.click();
      return true;
    })()`);
    if(!clickedDel) return false;
    await waitFor(`document.getElementById("dlgConfirm").classList.contains("open")`, "删除确认");
    await click("#dlgConfirmOk");
    await sleep(900);
    return true;
  };
  /* 中断的运行可能留下同名视图，先按名字清掉，避免「删除后消失」断言误判 */
  const purgeViews = async name => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const list = await API.get("/api/views");
    let deleted = 0;
    for(const v of (list || [])){
      if(v.name === ${JSON.stringify(name)}){ await API.del("/api/views/" + encodeURIComponent(v.id)); deleted++; }
    }
    return deleted;
  })()`);

  console.log("筛选项批次 2 验证\n  地址：" + BASE);
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

  /* ---------------- 项目范围控件位置 ---------------- */
  await openView("testcases");
  await waitFor(`document.querySelectorAll("#tcList .tc-row").length > 0 || !!document.querySelector("#tcList .empty-state")`, "用例列表");
  const reqPos = await evaluate(`(() => {
    const req = document.getElementById("tcReq");
    return {
      parent: req.parentElement.className,
      next: (req.nextElementSibling || {}).id,
      display: getComputedStyle(req).display,
      order: [...req.parentElement.children].findIndex(x => x.id === "tcReq"),
      filterIndex: [...req.parentElement.children].findIndex(x => x.id === "tcFilterBar")
    };
  })()`);
  assert(reqPos.parent.indexOf("toolbar-right") !== -1, "项目范围控件位于工具栏右侧（" + reqPos.parent + "）");
  assert(reqPos.next === "tcFilterBar", "项目范围紧邻筛选区之前，成为筛选第一位（next=" + reqPos.next + "）");
  assert(reqPos.order === 1 && reqPos.filterIndex === 2, "DOM 顺序：说明图标 → 项目 → 筛选区（" + reqPos.order + "/" + reqPos.filterIndex + "）");
  await shot("audit-batch2-cases-1440.png");

  /* 全局「清空筛选」保留项目范围 */
  await setSelect("tcReq", "__all__");
  await sleep(700);
  await evaluate(`(() => {
    const q = document.getElementById("tcSearch");
    q.value = "checkout";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    const st = document.querySelector('[data-tc-status="passed"]');
    st.click();
    return true;
  })()`);
  await sleep(800);
  await click("#tcClearFilter");
  await sleep(900);
  const caseClear = await evaluate(`(() => ({
    req: document.getElementById("tcReq").value,
    q: document.getElementById("tcSearch").value,
    status: document.querySelector('#tcStatusSeg [aria-pressed="true"]').dataset.tcStatus,
    badge: document.getElementById("tcFilterCount").hidden
  }))()`);
  assert(caseClear.req === "__all__" && caseClear.q === "" && caseClear.status === "all",
    "用例清空筛选：搜索与执行结果复位，项目范围保留（" + caseClear.req + "）");
  assert(caseClear.badge === true, "清空后移动端筛选角标隐藏");

  /* ---------------- 测试计划：搜索 + 状态筛选 ---------------- */
  await click('[data-tc-mode="plans"]');
  await waitFor(`!document.getElementById("tcPlanBar").hidden`, "计划筛选栏");
  await waitFor(`!!document.querySelector("#tcPlans .tc-row") || !!document.querySelector("#tcPlans .empty-state")`, "计划列表");
  const planBar = await evaluate(`(() => {
    const req = document.getElementById("tcReq");
    return {
      reqVisible: getComputedStyle(req).display !== "none",
      barVisible: !document.getElementById("tcPlanBar").hidden,
      ph: document.getElementById("tcPlanSearch").placeholder,
      searchVisible: getComputedStyle(document.getElementById("tcPlanSearch")).display !== "none",
      clearHidden: document.getElementById("tcPlanClearFilter").hidden
    };
  })()`);
  assert(planBar.reqVisible, "计划页共用项目范围控件，位置与用例一致");
  assert(planBar.barVisible && planBar.searchVisible, "计划页显示搜索与状态筛选栏");
  assert(planBar.ph === "搜索全部项目计划…", "全部项目下计划搜索占位符正确（" + planBar.ph + "）");
  await shot("audit-batch2-plans-1440.png");

  const planRows = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("#tcPlans .tc-row")];
    return {
      total: rows.length,
      first: rows.length ? rows[0].querySelector(".tc-title").textContent.trim() : "",
      status: rows.length ? (rows[0].querySelector(".mini-tag") || {}).textContent || "" : ""
    };
  })()`);
  if(planRows.total){
    const q = planRows.first.slice(0, Math.max(2, Math.min(4, planRows.first.length)));
    await evaluate(`(() => {
      const q = document.getElementById("tcPlanSearch");
      q.value = ${JSON.stringify(q)};
      q.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(900);
    const planSearch = await evaluate(`(() => {
      const names = [...document.querySelectorAll("#tcPlans .tc-row .tc-title")].map(x => x.textContent.trim());
      return {
        count: names.length,
        matched: names.every(n => n.indexOf(${JSON.stringify(q)}) !== -1),
        clearHidden: document.getElementById("tcPlanClearFilter").hidden,
        empty: !!document.querySelector("#tcPlans .empty-state")
      };
    })()`);
    assert(planSearch.count > 0 && planSearch.matched, "计划搜索按名称 / 版本过滤（" + q + " → " + planSearch.count + " 条）");
    assert(planSearch.clearHidden === false, "计划有条件时显示「清空筛选」");

    await click("#tcPlanClearFilter");
    await sleep(500);
    const planReset = await evaluate(`(() => ({
      q: document.getElementById("tcPlanSearch").value,
      count: document.querySelectorAll("#tcPlans .tc-row").length,
      clearHidden: document.getElementById("tcPlanClearFilter").hidden
    }))()`);
    assert(planReset.q === "" && planReset.count === planRows.total, "清空计划筛选恢复全部计划（" + planReset.count + " 条）");
    assert(planReset.clearHidden, "清空后计划按钮收起");

    const statusCode = planRows.status.indexOf("草稿") !== -1 ? "draft"
      : (planRows.status.indexOf("执行中") !== -1 ? "running" : "done");
    await setSelect("tcPlanStatus", statusCode);
    await sleep(500);
    const planStatus = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#tcPlans .tc-row")];
      return {
        count: rows.length,
        labels: [...new Set(rows.map(r => (r.querySelector(".mini-tag") || {}).textContent || ""))],
        groups: document.querySelectorAll("#tcPlans .tc-group").length,
        clearHidden: document.getElementById("tcPlanClearFilter").hidden
      };
    })()`);
    const expectLabel = { draft: "草稿", running: "执行中", done: "已完成" }[statusCode];
    assert(planStatus.count > 0 && planStatus.labels.every(l => l === expectLabel),
      "计划按状态筛选生效（" + expectLabel + "，" + planStatus.count + " 条）");
    assert(planStatus.groups <= 1, "全部项目下无匹配计划的项目分组不再占位（" + planStatus.groups + " 组）");
    await click("#tcPlanClearFilter");
    await sleep(400);
  }else{
    skip("演示数据没有测试计划，跳过搜索 / 状态筛选结果断言");
  }

  /* 切回具体项目：计划搜索占位符跟随 */
  await evaluate(`(() => {
    const sel = document.getElementById("tcReq");
    const opt = [...sel.options].find(o => o.value && o.value !== "__all__");
    if(!opt) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const planOne = await evaluate(`document.getElementById("tcPlanSearch").placeholder`);
  assert(planOne === "搜索本项目计划…", "计划单项目搜索占位符正确（" + planOne + "）");
  await setSelect("tcReq", "__all__");
  await sleep(700);

  /* ---------------- 缺陷保存视图 ---------------- */
  await click('[data-tc-mode="defects"]');
  await waitFor(`!document.getElementById("tcDefectBar").hidden`, "缺陷筛选栏");
  const reqHidden = await evaluate(`getComputedStyle(document.getElementById("tcReq")).display`);
  assert(reqHidden === "none", "缺陷页隐藏公共项目控件，避免同页两个范围（" + reqHidden + "）");
  await waitFor(`!!document.querySelector("#tcDefRows .tc-def-row") || !!document.querySelector("#tcDefRows .empty-state")`, "缺陷列表");
  await click("#tcDefReset");
  await sleep(800);
  await setSelect("tcDefStatus", "all");
  const priOpt = await evaluate(`(() => {
    const sel = document.getElementById("tcDefPriority");
    const opt = [...sel.options].find(o => o.value !== "all" && o.value !== "__none");
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, text: opt.textContent.trim() };
  })()`);
  await sleep(500);
  const defViewName = "E2E 缺陷视图";
  await purgeViews(defViewName);
  await click("#tcDefViewsBtn");
  await waitFor(`document.getElementById("tcDefViewsMenu").innerHTML.indexOf("保存当前为视图") !== -1`, "缺陷视图菜单");
  await click("#tcDefViewsMenu [data-tc-def-view-save]");
  await saveViewThroughPrompt(defViewName);
  await sleep(600);
  const defSaved = await evaluate(`(() => ({
    names: [...document.querySelectorAll("#tcDefViewsMenu [data-tc-def-view]")].map(x => x.textContent.trim())
  }))()`);
  assert(defSaved.names.indexOf(defViewName) !== -1, "缺陷视图保存成功并出现在菜单（" + defSaved.names.join(" / ") + "）");
  await shot("audit-batch2-defects-1440.png");

  /* 改掉当前条件，应用视图后应还原 */
  await setSelect("tcDefStatus", "open");
  await setSelect("tcDefPriority", "all");
  await sleep(500);
  await click("#tcDefViewsBtn");
  await waitFor(`!!document.querySelector("#tcDefViewsMenu [data-tc-def-view]")`, "缺陷视图菜单项");
  await evaluate(`(() => {
    const hit = [...document.querySelectorAll("#tcDefViewsMenu [data-tc-def-view]")]
      .find(x => x.textContent.trim() === ${JSON.stringify(defViewName)});
    if(!hit) return false;
    hit.click();
    return true;
  })()`);
  await sleep(1000);
  const defApplied = await evaluate(`(() => ({
    status: document.getElementById("tcDefStatus").value,
    pri: document.getElementById("tcDefPriority").value,
    q: document.getElementById("tcDefSearch").value
  }))()`);
  assert(defApplied.status === "all" && defApplied.pri === (priOpt && priOpt.value),
    "缺陷视图应用后还原状态与优先级（" + defApplied.status + " / " + defApplied.pri + "）");

  await click("#tcDefViewsBtn");
  await waitFor(`!!document.querySelector("#tcDefViewsMenu [data-tc-def-view]")`, "缺陷视图菜单项");
  const delDef = await deleteViewThroughConfirm("tc-def-view", defViewName);
  await sleep(500);
  const defGone = await evaluate(`[...document.querySelectorAll("#tcDefViewsMenu [data-tc-def-view]")].every(x => x.textContent.trim() !== ${JSON.stringify(defViewName)})`);
  assert(delDef && defGone, "缺陷视图删除后从菜单消失");
  await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.closeAllPops(); return true; })`);
  await sleep(300);

  /* ---------------- 分支：负责人计数 + 保存视图 ---------------- */
  await openView("branches");
  await waitFor(`!!document.querySelector("#branchGroups .br-card") || !!document.querySelector("#branchGroups .br-empty-full")`, "分支列表");
  await sleep(1400);
  const ownerInfo = await evaluate(`(() => {
    const sel = document.getElementById("branchOwnerFilter");
    const opts = [...sel.options].map(o => o.textContent.trim()).filter(x => x && x !== "全部负责人");
    return {
      count: opts.length,
      allCounted: opts.every(t => /（\\d+）$/.test(t)),
      zero: opts.filter(t => /（0）$/.test(t)),
      sample: opts.slice(0, 4)
    };
  })()`);
  assert(ownerInfo.count > 0 && ownerInfo.allCounted, "分支负责人下拉带分支数（" + ownerInfo.sample.join(" / ") + "）");
  assert(ownerInfo.zero.length === 0, "零结果成员不出现在负责人候选（" + ownerInfo.count + " 人）");

  const ownerPick = await evaluate(`(() => {
    const sel = document.getElementById("branchOwnerFilter");
    const opt = [...sel.options].find(o => o.value);
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, label: opt.textContent.trim() };
  })()`);
  if(ownerPick){
    await sleep(1200);
    const ownerMeta = await evaluate(`document.getElementById("branchMeta").textContent`);
    assert(ownerMeta.indexOf("负责人「") !== -1 && ownerMeta.indexOf("（") === -1,
      "选中负责人后页脚显示姓名而非计数（" + ownerMeta.slice(0, 60) + "…）");
    await evaluate(`(() => {
      const sel = document.getElementById("branchOwnerFilter");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, "");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(1000);
  }

  await evaluate(`(() => {
    const pr = document.getElementById("branchProjectFilter");
    const opt = [...pr.options].find(o => o.value);
    if(opt){
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pr), "value").set.call(pr, opt.value);
      pr.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const st = document.getElementById("branchStatusFilter");
    if([...st.options].some(o => o.value === "dev")){
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(st), "value").set.call(st, "dev");
      st.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  await sleep(1200);
  const branchContext = await evaluate(`(() => ({
    project: document.getElementById("branchProjectFilter").value,
    status: document.getElementById("branchStatusFilter").value
  }))()`);
  const branchViewName = "E2E 分支视图";
  await purgeViews(branchViewName);
  await click("#branchViewsBtn");
  await waitFor(`document.getElementById("branchViewsMenu").innerHTML.indexOf("保存当前为视图") !== -1`, "分支视图菜单");
  await click("#branchViewsMenu [data-tc-branch-view-save]");
  await saveViewThroughPrompt(branchViewName);
  await sleep(600);
  const branchSaved = await evaluate(`[...document.querySelectorAll("#branchViewsMenu [data-tc-branch-view]")].map(x => x.textContent.trim())`);
  assert(branchSaved.indexOf(branchViewName) !== -1, "分支视图保存成功并出现在菜单（" + branchSaved.join(" / ") + "）");
  await shot("audit-batch2-branches-1440.png");

  await click("#branchClearFilter");
  await sleep(1200);
  const branchCleared = await evaluate(`(() => ({
    project: document.getElementById("branchProjectFilter").value,
    status: document.getElementById("branchStatusFilter").value,
    meta: document.getElementById("branchMeta").textContent
  }))()`);
  assert(branchCleared.project === branchContext.project && branchCleared.status === "",
    "分支清空筛选保留项目、清掉状态（" + branchCleared.project + " / " + branchCleared.status + "）");

  await click("#branchViewsBtn");
  await waitFor(`!!document.querySelector("#branchViewsMenu [data-tc-branch-view]")`, "分支视图菜单项");
  await evaluate(`(() => {
    const hit = [...document.querySelectorAll("#branchViewsMenu [data-tc-branch-view]")]
      .find(x => x.textContent.trim() === ${JSON.stringify(branchViewName)});
    if(!hit) return false;
    hit.click();
    return true;
  })()`);
  await sleep(1400);
  const branchApplied = await evaluate(`(() => ({
    project: document.getElementById("branchProjectFilter").value,
    status: document.getElementById("branchStatusFilter").value
  }))()`);
  assert(branchApplied.project === branchContext.project && branchApplied.status === branchContext.status,
    "分支视图应用后还原项目与状态（" + branchApplied.project + " / " + branchApplied.status + "）");

  await click("#branchViewsBtn");
  await waitFor(`!!document.querySelector("#branchViewsMenu [data-tc-branch-view]")`, "分支视图菜单项");
  const delBranch = await deleteViewThroughConfirm("tc-branch-view", branchViewName);
  await sleep(500);
  const branchGone = await evaluate(`[...document.querySelectorAll("#branchViewsMenu [data-tc-branch-view]")].every(x => x.textContent.trim() !== ${JSON.stringify(branchViewName)})`);
  assert(delBranch && branchGone, "分支视图删除后从菜单消失");
  await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.closeAllPops(); return true; })`);

  /* ---------------- 移动端 390：筛选角标与布局 ---------------- */
  await setViewport(390, 844, true);
  await openView("testcases");
  await click('[data-tc-mode="cases"]');
  await sleep(1200);
  await evaluate(`(() => {
    const q = document.getElementById("tcSearch");
    q.value = "checkout";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(1000);
  const mobileBadge = await evaluate(`(() => {
    const badge = document.getElementById("tcFilterCount");
    const btn = document.getElementById("tcFilterBtn");
    return {
      hidden: badge.hidden,
      text: badge.textContent.trim(),
      btnVisible: getComputedStyle(btn).display !== "none",
      barOpen: document.getElementById("tcFilterBar").classList.contains("is-open")
    };
  })()`);
  assert(mobileBadge.btnVisible, "移动端显示「筛选」入口");
  assert(mobileBadge.hidden === false && mobileBadge.text === "1", "筛选面板收起时按钮显示已筛条件数（" + mobileBadge.text + "）");
  assert(mobileBadge.barOpen === false, "移动端筛选面板默认收起");
  await shot("audit-batch2-cases-390.png");
  await click("#tcFilterBtn");
  await sleep(300);
  await shot("audit-batch2-cases-filter-390.png");
  await click("#tcClearFilter");
  await sleep(900);
  const mobileReset = await evaluate(`(() => ({
    hidden: document.getElementById("tcFilterCount").hidden,
    q: document.getElementById("tcSearch").value
  }))()`);
  assert(mobileReset.hidden && mobileReset.q === "", "清空后角标与搜索同时复位");

  await click('[data-tc-mode="plans"]');
  await sleep(1200);
  await shot("audit-batch2-plans-390.png");
  await click('[data-tc-mode="defects"]');
  await sleep(1000);
  await shot("audit-batch2-defects-390.png");

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
