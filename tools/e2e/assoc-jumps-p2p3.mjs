/* P2+P3 关联跳转 E2E 验证（仿 tools/e2e/assoc-jumps.mjs，Node 18+ 原生 CDP）
   覆盖：
     P2 高频视图纯文本接线（复用现成 open* 助手，捕获阶段全局委托）：
       项目名 list/mine/workcolumn/analysis/workload/requirements 面包屑/branches 项目 chips/抽屉阅读态
       版本列 list/phase 任务表/branches 版本 chips/抽屉阅读态/计划详情 meta
       分支 chips board 卡片
       用例 meta testcases 用例行（需求 + 工作项）
       计划详情 testcases 版本 / 需求范围 / 用例标题
       覆盖度 testcases 工作项标题
     P3 半跳转修正 + 键盘收尾：
       delivery 证据 testcases → 带 planId 的计划详情（openPlanInProject pending 钩子）
       phase 汇总 需求名 / 版本名 → 实体详情；行体下钻保留
       chain 节点标题 → 工作项详情；节点体「以此为中心」保留
       project 史诗名 → 工作项详情；子项数按钮 → 子项表保留
       branches 分组头 Enter/Space 键盘激活
     手机端关键界面截图 + 横向裁切；全程控制台零报错。
   数据：支付业务部（Smw9zcftmwwnrwuon）演示库。运行前需 8082 预览 + 8090 后端在线。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";

const WS = "Smw9zcftmwwnrwuon";                 // 支付业务部
const PROJ = "R4ohfd6ha97zjtedr3ogg";           // 清结算与对账平台
const VER = "Voqh4tnoq3262hmplci2e";            // 清结算 v3.0
const REL = "RL79ih44mruend4iagle03";           // 生产成功发布记录
const SNAP_TASK = "Kr9vof65na3g5h4130i38";      // 差错工单自动分派（绑定 VER + PROJ，抽屉阅读态用）
const DEMAND = "D4b6yvznsd0u1qrtuoxeo";         // 结算单 PDF 模板改版（真实需求）

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

/* 预览直供的前端比运行中的 jar 新：文档分类/测试模块接口源码里已有、jar 里还没打进去。
   这类 404 属环境差异，单独归桶如实报出，不算本次改动的回归。 */
const KNOWN_GAP_APIS = ["/api/doc-categories", "/api/test-modules"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.knownGaps = []; this.resourceErrors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.responseReceived"){
      const r = msg.params.response || {};
      if(r.status >= 400 && String(r.url).indexOf("favicon") === -1){
        (isKnownGap(r.url) ? this.knownGaps : this.netErrors).push(r.status + " " + r.url);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      (/Failed to load resource/.test(text) ? this.resourceErrors : this.errors).push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")) this.resourceErrors.push("resource: " + (e.url || "") + " " + e.text);
      else this.errors.push("log: " + e.text);
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
const port = Number(process.env.E2E_PORT || 9445);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "assoc-p2p3-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];
const SKIPS = [];
const skip = m => { SKIPS.push(m); console.log("  SKIP " + m); };

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
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    const s = await call("Page.captureScreenshot", { format: "png" });
    const out = "/tmp/hg-p2p3-" + name + ".png";
    fs.writeFileSync(out, Buffer.from(s.data, "base64"));
    SHOTS.push(out);
  };
  const activeView = () => evaluate(`import("./js/core/router.js").then(s => s.activeView)`);
  const pressKey = async (key, code, vk, text) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const pressEnter = () => pressKey("Enter", "Enter", 13, "\r");
  const pressSpace = () => pressKey(" ", "Space", 32, " ");

  const closeDrawer = async () => {
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
    await sleep(220);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm"); if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(120);
  };
  const closeAll = async () => {
    await evaluate(`import("./js/core/ui.js").then(m => {
      document.querySelectorAll(".modal-layer.open").forEach(l => m.UI.closeModal(l));
      const br = document.getElementById("branchDrawer"); if(br) br.classList.remove("on");
      return true;
    })`);
    await closeDrawer();
    await sleep(150);
  };
  const gotoHash = async (hash, view) => {
    await evaluate(`location.hash = ${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, "切换到 " + view, 15000);
    await sleep(300);
  };
  const setProject = async (reqId) => {
    await evaluate(`import("./js/core/state.js").then(s => { s.rt.phaseReqId = ${JSON.stringify(reqId)}; s.rt.managerProjectId = ${JSON.stringify(reqId)}; return true; })`);
  };

  /* 每种 kind 的落地信号 + 清理 */
  const destExpr = (kind, id) => ({
    project: `import("./js/core/router.js").then(r => import("./js/core/state.js").then(s => r.activeView === "project" && s.rt.managerProjectId === ${JSON.stringify(id)}))`,
    version: `import("./js/core/router.js").then(r => r.activeView === "version" && location.hash.indexOf(${JSON.stringify("id=" + id)}) !== -1)`,
    branch: `!!(document.getElementById("branchDrawer") && document.getElementById("branchDrawer").classList.contains("on"))`,
    demand: `(() => { const l = document.querySelector(".demand-detail[data-ai-demand=" + ${JSON.stringify(id)} + "]"); return !!(l && l.offsetWidth > 0); })()`,
    task: `import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(id)} && document.getElementById("taskDrawer").classList.contains("on"))`,
    case: `import("./js/core/router.js").then(r => r.activeView === "testcases" && document.getElementById("dlgCase").classList.contains("open"))`
  }[kind]);
  const destDesc = { project:"项目视图", version:"版本详情", branch:"分支抽屉", demand:"需求详情", task:"工作项抽屉", case:"用例编辑弹窗" };
  const cleanupDest = async kind => {
    if(kind === "task") await closeDrawer();
    else if(kind === "branch" || kind === "demand" || kind === "case") await closeAll();
    await sleep(120);
  };

  /* 通用跳转测试：btnSel 定位按钮 → 结构断言 → 点击 → 落地断言 → 防误触 → 截图 → 清理。
     opts.guardModal：点击后不应打开的弹窗选择器（行内链接防止误开行级弹窗）。 */
  const jumpTest = async (label, kind, btnSel, opts = {}) => {
    const info = await evaluate(`(() => {
      const b = document.querySelector(${JSON.stringify(btnSel)});
      if(!b) return null;
      return { id: b.getAttribute("data-jump-" + ${JSON.stringify(kind)}), req: b.getAttribute("data-jump-req") || "", text: b.textContent.trim().slice(0, 40), tag: b.tagName };
    })()`);
    if(!info || !info.id){ skip(label + "：未找到 " + kind + " 关联按钮（" + btnSel + "）"); return null; }
    assert(info.tag === "BUTTON", label + "：" + kind + " 关联渲染为原生 button「" + info.text + "」");
    await evaluate(`document.querySelector(${JSON.stringify(btnSel)}).click(); true`);
    let ok = false;
    try{ await waitFor(destExpr(kind, info.id), label + " 落地", 12000); ok = true; }catch(e){ ok = false; }
    assert(ok, label + "：点 " + kind + " → 落到" + destDesc[kind] + "（id=" + info.id + "）");
    if(ok && kind !== "task"){
      const stray = await evaluate(`document.getElementById("taskDrawer").classList.contains("on")`);
      assert(!stray, label + "：跳转未误开工作项抽屉（捕获 stopPropagation 生效）");
    }
    if(ok && opts.guardModal){
      const g = await evaluate(`(() => { const m = document.querySelector(${JSON.stringify(opts.guardModal)}); return !!(m && m.classList.contains("open")); })()`);
      assert(!g, label + "：跳转未误开行级弹窗（" + opts.guardModal + "）");
    }
    if(ok) await shot(opts.shot || ("p2-" + kind + "-" + label.replace(/[^a-z0-9]+/gi, "-")));
    await cleanupDest(kind);
    return info;
  };

  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }
    catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); await closeAll(); }
  };

  console.log("P2+P3 关联跳转 E2E\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click(); return true;
  })()`);
  try{ await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000); }
  catch(e){ const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`); throw new Error("登录未完成：" + errMsg); }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  pass("登录 " + USER);

  let curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
  if(curWs !== WS){
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
    curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
  }
  assert(curWs === WS, "当前空间为支付业务部（" + curWs + "）");
  const servedHasJump = await evaluate(`fetch("./js/core/task-actions.js?probe=" + Date.now()).then(r => r.text()).then(t => t.indexOf("data-jump-project") !== -1)`);
  assert(servedHasJump, "预览直供的 task-actions.js 含 data-jump-project（本次改动已生效）");

  /* ===================== P2 项目名 ===================== */
  await section("[P2-1] 列表视图 项目名 + 版本列", async () => {
    await gotoHash("#/list", "list");
    await waitFor(`document.querySelectorAll("#view-list .assoc-link[data-jump-project]").length > 0`, "列表项目列渲染", 15000);
    await jumpTest("list-project", "project", "#view-list .assoc-link[data-jump-project]", { shot:"p2-list-project" });
    await gotoHash("#/list", "list");
    await waitFor(`document.querySelectorAll("#view-list .assoc-link[data-jump-version]").length > 0`, "列表版本列渲染", 15000);
    await jumpTest("list-version", "version", "#view-list .assoc-link[data-jump-version]", { shot:"p2-list-version" });
  });

  await section("[P2-2] 我的工作 项目 chip", async () => {
    await gotoHash("#/mine", "mine");
    await waitFor(`document.querySelectorAll("#view-mine .assoc-link[data-jump-project]").length > 0`, "我的工作项目 chip 渲染", 15000);
    await jumpTest("mine-project", "project", "#view-mine .assoc-link[data-jump-project]", { shot:"p2-mine-project" });
  });

  await section("[P2-3] 工作列视图 项目名", async () => {
    await gotoHash("#/workcolumn", "workcolumn");
    await waitFor(`document.querySelectorAll("#view-workcolumn .assoc-link[data-jump-project]").length > 0`, "工作列项目名渲染", 15000);
    await jumpTest("workcolumn-project", "project", "#view-workcolumn .assoc-link[data-jump-project]", { shot:"p2-workcolumn-project" });
  });

  await section("[P2-4] 看板 分支 chip", async () => {
    await gotoHash("#/board", "board");
    await waitFor(`document.querySelectorAll("#view-board .board-card, #view-board .card").length > 0`, "看板卡片渲染", 20000);
    await sleep(500);
    await jumpTest("board-branch", "branch", "#view-board .assoc-link[data-jump-branch]", { shot:"p2-board-branch" });
  });

  await section("[P2-5] 分支视图 版本 chip + 项目 chip", async () => {
    await gotoHash("#/branches", "branches");
    await waitFor(`document.querySelectorAll("#view-branches .assoc-link").length > 0`, "分支卡片 chips 渲染", 20000);
    await jumpTest("branches-version", "version", "#view-branches .assoc-link[data-jump-version]", { shot:"p2-branches-version" });
    await gotoHash("#/branches", "branches");
    await waitFor(`document.querySelectorAll("#view-branches .assoc-link[data-jump-project]").length > 0`, "分支项目 chip 渲染", 15000);
    await jumpTest("branches-project", "project", "#view-branches .assoc-link[data-jump-project]", { shot:"p2-branches-project" });
  });

  await section("[P2-6] 工作项抽屉阅读态 所属项目 + 计划版本", async () => {
    /* 从中性视图起步：上一节停在 project 视图，同视图跳转会短路路由守卫导致抽屉不关 */
    await gotoHash("#/list", "list");
    await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(SNAP_TASK)})); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(SNAP_TASK)} && document.getElementById("taskDrawer").classList.contains("on"))`, "抽屉打开", 12000);
    await waitFor(`document.querySelectorAll("#readAssoc .assoc-link[data-jump-project]").length > 0`, "阅读态所属项目渲染", 10000);
    await shot("p2-drawer-readassoc");
    await jumpTest("drawer-project", "project", "#readAssoc .assoc-link[data-jump-project]", { shot:"p2-drawer-project" });
    /* 项目跳转会离开抽屉，重新打开测版本 */
    await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(SNAP_TASK)})); true`);
    await waitFor(`document.querySelectorAll("#readAssoc .assoc-link[data-jump-version]").length > 0`, "阅读态计划版本渲染", 12000);
    await jumpTest("drawer-version", "version", "#readAssoc .assoc-link[data-jump-version]", { shot:"p2-drawer-version" });
  });

  await section("[P2-7] 投入分析 完成明细 项目名", async () => {
    await gotoHash("#/analysis", "analysis");
    await evaluate(`import("./js/views/analysis.js").then(m => m.setAnalysisTab("completions")); true`);
    await waitFor(`document.querySelectorAll("#view-analysis .assoc-link[data-jump-project]").length > 0`, "完成明细项目名渲染", 15000);
    await jumpTest("analysis-project", "project", "#view-analysis .assoc-link[data-jump-project]", { shot:"p2-analysis-project" });
  });

  await section("[P2-8] 成员负载 下钻工作项 项目名", async () => {
    await gotoHash("#/workload", "workload");
    await waitFor(`document.querySelectorAll("#view-workload [data-member-open]").length > 0`, "成员负载渲染", 20000);
    /* 切到「按人」名册：点成员卡片打开成员工作台子页面 */
    await evaluate(`(() => { const b = document.querySelector("#view-workload [data-load-mode='person']"); if(b && !b.disabled) b.click(); return true; })()`);
    await sleep(300);
    const keys = await evaluate(`[...document.querySelectorAll("#view-workload .member-card[data-member-open]")].map(b => b.dataset.memberOpen)`);
    let opened = false;
    for(const k of keys){
      await evaluate(`(() => { const b = document.querySelector("#view-workload .member-card[data-member-open=" + ${JSON.stringify(k)} + "]"); if(b) b.click(); return true; })()`);
      try{
        await waitFor(`!!document.querySelector("#view-workload .member-page")`, "成员工作台打开", 4000);
        opened = await evaluate(`document.querySelectorAll("#view-workload [data-member-tasks-panel] [data-open-task]").length > 0`);
      }catch(e){ opened = false; }
      if(opened) break;
      await gotoHash("#/workload", "workload");
      await sleep(300);
    }
    if(!opened){ skip("workload-project：当前范围无可下钻工作项的成员"); return; }
    await waitFor(`document.querySelectorAll("#view-workload [data-member-tasks-panel] [data-open-task] .assoc-link[data-jump-project]").length > 0`, "成员工作项项目名渲染", 12000);
    await jumpTest("workload-project", "project", "#view-workload [data-member-tasks-panel] [data-open-task] .assoc-link[data-jump-project]", { shot:"p2-workload-project" });
  });

  await section("[P2-9] 需求文档 阅读态面包屑 项目名", async () => {
    await gotoHash("#/requirements", "requirements");
    await waitFor(`!!document.querySelector("#reqDocListPage [data-rdmode='read']")`, "文档页就绪", 20000);
    /* 列表行点击进的是编辑器；面包屑项目名在阅读态，先切「阅读」再选一篇归属项目的文档 */
    await evaluate(`document.querySelector("#reqDocListPage [data-rdmode='read']").click(); true`);
    await waitFor(`document.querySelectorAll("#reqDocSplit .rs-node[data-rs-doc]").length > 0`, "阅读态文档树渲染", 15000);
    const picked = await evaluate(`(() => {
      const n = document.querySelector("#reqDocSplit .rs-node[data-rs-doc][data-rs-reqid]:not([data-rs-reqid=''])") || document.querySelector("#reqDocSplit .rs-node[data-rs-doc]");
      if(!n) return false; n.click(); return true;
    })()`);
    if(!picked){ skip("reqdoc-crumb-project：阅读态无可选文档"); return; }
    await waitFor(`document.querySelectorAll("#view-requirements .rrd-crumb-proj[data-jump-project]").length > 0`, "文档面包屑项目名渲染", 12000);
    await jumpTest("reqdoc-crumb-project", "project", "#view-requirements .rrd-crumb-proj[data-jump-project]", { shot:"p2-reqdoc-crumb" });
  });

  /* ===================== P2 用例 / 计划 / 覆盖度 ===================== */
  await section("[P2-10] 用例列表 meta 需求 + 工作项", async () => {
    await gotoHash("#/testcases", "testcases");
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.setTcMode("cases"); return true; })`);
    await waitFor(`document.querySelectorAll("#view-testcases .tc-row[data-tc-open]").length > 0`, "用例行渲染", 20000);
    await jumpTest("case-meta-demand", "demand", "#view-testcases .tc-row[data-tc-open] .assoc-link[data-jump-demand]", { shot:"p2-case-meta-demand", guardModal:"#dlgCase" });
    await gotoHash("#/testcases", "testcases");
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.setTcMode("cases"); return true; })`);
    let hasCaseTask = false;
    try{ await waitFor(`document.querySelectorAll("#view-testcases .tc-row[data-tc-open] .assoc-link[data-jump-task]").length > 0`, "用例 meta 工作项渲染", 12000); hasCaseTask = true; }catch(e){ hasCaseTask = false; }
    if(!hasCaseTask){ skip("case-meta-task：当前项目用例无关联工作项（test_case_task 为空，接线同 demand 已验证）"); return; }
    await jumpTest("case-meta-task", "task", "#view-testcases .tc-row[data-tc-open] .assoc-link[data-jump-task]", { shot:"p2-case-meta-task", guardModal:"#dlgCase" });
  });

  await section("[P2-11] 计划详情 版本 / 需求范围 / 用例标题", async () => {
    /* 回到 testcases 会触发 enterTestCasesView 异步 loadPlans；必须先等计划列表落定再
       openPlanDetail，否则两者竞争 #tcPlans 渲染，详情会被列表覆盖 */
    const openPlan = async (pid) => {
      await gotoHash("#/testcases", "testcases");
      await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.setTcMode("plans"); return true; })`);
      await waitFor(`document.querySelectorAll("#view-testcases .tc-row[data-plan-open]").length > 0`, "计划列表就绪", 20000);
      await evaluate(`import("./js/views/testcases.js").then(m => m.openPlanDetail(${JSON.stringify(pid)})); true`);
      await waitFor(`!!document.querySelector("#tcPlans .plan-head [data-plan-back]")`, "计划详情就绪", 15000);
    };
    await gotoHash("#/testcases", "testcases");
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.setTcMode("plans"); return true; })`);
    await waitFor(`document.querySelectorAll("#view-testcases .tc-row[data-plan-open]").length > 0`, "计划列表渲染", 20000);
    const planId = await evaluate(`(() => { const b = document.querySelector("#view-testcases .tc-row[data-plan-open]"); return b ? b.dataset.planOpen : null; })()`);
    await openPlan(planId);
    await shot("p2-plan-detail");
    await jumpTest("plan-version", "version", "#tcPlans .plan-head .assoc-link[data-jump-version]", { shot:"p2-plan-version" });
    await openPlan(planId);
    await jumpTest("plan-scope-demand", "demand", "#tcPlans .assoc-link[data-jump-demand]", { shot:"p2-plan-scope-demand" });
    await openPlan(planId);
    await waitFor(`document.querySelectorAll("#tcPlans .plan-case .assoc-link[data-jump-case]").length > 0`, "计划用例标题渲染", 15000);
    await jumpTest("plan-case-title", "case", "#tcPlans .plan-case .assoc-link[data-jump-case]", { shot:"p2-plan-case-title" });
  });

  await section("[P2-12] 需求覆盖度 工作项标题", async () => {
    await gotoHash("#/testcases", "testcases");
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.openDemandCoverage(${JSON.stringify(PROJ)}, ${JSON.stringify(DEMAND)}); return true; })`);
    let has = false;
    try{ await waitFor(`document.querySelectorAll("#view-testcases .cov-wi-title .assoc-link[data-jump-task]").length > 0`, "覆盖度工作项标题渲染", 15000); has = true; }catch(e){ has = false; }
    if(!has){
      /* 该需求无工作项时，展开任意有工作项的覆盖度行 */
      await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("coverage")); true`);
      await waitFor(`document.querySelectorAll("#view-testcases .cov-row[data-cov-demand]").length > 0`, "覆盖度行渲染", 15000);
      await evaluate(`document.querySelector("#view-testcases .cov-row[data-cov-demand]").click(); true`);
      try{ await waitFor(`document.querySelectorAll("#view-testcases .cov-wi-title .assoc-link[data-jump-task]").length > 0`, "覆盖度展开工作项", 10000); has = true; }catch(e){ has = false; }
    }
    if(!has){ skip("coverage-wi-task：覆盖度下无可点工作项标题"); return; }
    await jumpTest("coverage-wi-task", "task", "#view-testcases .cov-wi-title .assoc-link[data-jump-task]", { shot:"p2-coverage-wi-task" });
  });

  await section("[P2-13] 版本视图 任务表 版本列", async () => {
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`document.querySelectorAll("#view-phase .assoc-link[data-jump-version]").length > 0`, "版本任务表版本列渲染", 20000);
    await jumpTest("phase-task-version", "version", "#view-phase .phase-tbl .assoc-link[data-jump-version]", { shot:"p2-phase-task-version" });
  });

  /* ===================== P3 半跳转修正 + 保留行为 ===================== */
  await section("[P3-A] 交付说明证据 testcases → 计划详情（带 planId）", async () => {
    /* 在已登录浏览器内发现一个带 testcases 证据（refId=planId）的版本：v3.0 无测试计划，需找有的版本 */
    const found = await evaluate(`(async () => {
      const API = (await import("./js/core/api.js")).API;
      const rows = await API.get("/api/versions/cross-project");
      const vers = (rows || []).filter(r => r.reqId === ${JSON.stringify(PROJ)});
      for(const v of vers){
        try{
          const note = await API.get("/api/versions/" + encodeURIComponent(v.versionId) + "/delivery-note");
          const ev = ((note && note.evidence) || []).find(e => e.view === "testcases" && e.refId && !e.missing);
          if(ev) return { vid: v.versionId, planId: ev.refId, releaseId: (note.options || {}).releaseId || "" };
        }catch(e){}
      }
      return null;
    })()`);
    if(!found){ skip("delivery→plan：PROJ 各版本交付说明均无带 planId 的 testcases 证据"); return; }
    assert(!!found.planId, "发现带 testcases 证据的版本（planId=" + found.planId + "）");
    await evaluate(`import("./js/views/delivery.js").then(m => m.openDeliveryNote(${JSON.stringify(found.vid)}, ${JSON.stringify(found.releaseId)})); true`);
    await waitFor(`document.body.dataset.view === "delivery" && document.querySelectorAll("#deliveryBody [data-dl-act='goto']").length > 0`, "交付说明证据按钮渲染", 20000);
    const findBtn = `(() => { const b = [...document.querySelectorAll("#deliveryBody [data-dl-act='goto']")].find(x => x.dataset.dlView === "testcases" && x.dataset.dlRef); return b ? { ref: b.dataset.dlRef, view: b.dataset.dlView } : null; })()`;
    let tcBtn = await evaluate(findBtn);
    if(!tcBtn){
      /* 证据详细度不足时展开到「含制品校验值」 */
      await evaluate(`(() => { const b = document.querySelector("#deliveryBody [data-dl-act='evidence-level'][data-dl-lv='2']"); if(b) b.click(); return true; })()`);
      await sleep(400);
      tcBtn = await evaluate(findBtn);
    }
    if(!tcBtn){ skip("delivery→plan：证据区未渲染 testcases 跳转按钮"); return; }
    assert(tcBtn.ref === found.planId, "交付说明 testcases 证据按钮带真实 planId（" + tcBtn.ref + "）");
    await shot("p3-delivery-evidence");
    await evaluate(`(() => { const b = [...document.querySelectorAll("#deliveryBody [data-dl-act='goto']")].find(x => x.dataset.dlView === "testcases" && x.dataset.dlRef); b.click(); return true; })()`);
    let ok = false;
    try{ await waitFor(`import("./js/core/router.js").then(r => r.activeView === "testcases" && !!document.querySelector("#tcPlans .plan-head [data-plan-back]"))`, "落到计划详情", 15000); ok = true; }catch(e){ ok = false; }
    assert(ok, "点 testcases 证据 → 落到带 planId 的计划详情（openPlanInProject pending 钩子生效，非仅切视图）");
    if(ok) await shot("p3-delivery-plan-landed");
    await closeAll();
  });

  await section("[P3-B] 版本汇总 需求名/版本名跳转 + 行体下钻保留", async () => {
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector("#view-phase [data-rollup]")`, "汇总面板渲染", 20000);
    /* 跨版本对比：版本名链接 */
    await evaluate(`(() => { const s = document.querySelector("#view-phase [data-rollup-ver]"); if(s){ s.value = "__all"; s.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
    await waitFor(`document.querySelectorAll("#view-phase .roll-row[data-rollup-group='version'] .assoc-link[data-jump-version]").length > 0`, "汇总版本名渲染", 15000);
    await jumpTest("rollup-version-name", "version", "#view-phase .roll-row[data-rollup-group='version'] .assoc-link[data-jump-version]", { shot:"p3-rollup-version-name" });
    /* 行体下钻保留：点版本行体（非名称链接）→ 下钻弹窗，仍留在 phase */
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector("#view-phase [data-rollup]")`, "汇总面板重渲染", 20000);
    await evaluate(`(() => { const s = document.querySelector("#view-phase [data-rollup-ver]"); if(s){ s.value = "__all"; s.dispatchEvent(new Event("change", { bubbles: true })); } return true; })()`);
    await waitFor(`document.querySelectorAll("#view-phase .roll-row[data-rollup-group='version']").length > 0`, "汇总版本行渲染", 15000);
    await evaluate(`(() => { const r = document.querySelector("#view-phase .roll-row[data-rollup-group='version']"); r.click(); return true; })()`);
    let drill = false;
    try{ await waitFor(`!!document.querySelector(".modal-layer.open [data-drill-x]")`, "版本行下钻弹窗", 8000); drill = true; }catch(e){ drill = false; }
    const stillPhase = (await activeView()) === "phase";
    assert(drill && stillPhase, "点版本汇总行体 → 下钻弹窗且仍在版本视图（行级下钻保留，未被名称跳转劫持）");
    await shot("p3-rollup-version-drill");
    await closeAll();
    /* 单版本 需求维度：需求名链接 + 行体下钻 */
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector("#view-phase [data-rollup]")`, "汇总面板三渲染", 20000);
    await evaluate(`(() => { const s = document.querySelector("#view-phase [data-rollup-ver]"); if(s && s.value === "__all"){ const opt = [...s.options].find(o => o.value && o.value !== "__all"); if(opt){ s.value = opt.value; s.dispatchEvent(new Event("change", { bubbles: true })); } } return true; })()`);
    await sleep(400);
    await evaluate(`(() => { const b = document.querySelector("#view-phase [data-rollup-dim='demand']"); if(b) b.click(); return true; })()`);
    let hasDemand = false;
    try{ await waitFor(`document.querySelectorAll("#view-phase .roll-row[data-rollup-group='demand'] .roll-name .assoc-link[data-jump-demand]").length > 0`, "汇总需求名渲染", 12000); hasDemand = true; }catch(e){ hasDemand = false; }
    if(!hasDemand){ skip("rollup-demand-name：当前版本需求维度无可点需求名（可能无绑定需求）"); return; }
    await jumpTest("rollup-demand-name", "demand", "#view-phase .roll-row[data-rollup-group='demand'] .roll-name .assoc-link[data-jump-demand]", { shot:"p3-rollup-demand-name" });
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector("#view-phase [data-rollup]")`, "汇总面板四渲染", 20000);
    await evaluate(`(() => { const s = document.querySelector("#view-phase [data-rollup-ver]"); if(s && s.value === "__all"){ const opt = [...s.options].find(o => o.value && o.value !== "__all"); if(opt){ s.value = opt.value; s.dispatchEvent(new Event("change", { bubbles: true })); } } return true; })()`);
    await sleep(400);
    await evaluate(`(() => { const b = document.querySelector("#view-phase [data-rollup-dim='demand']"); if(b) b.click(); return true; })()`);
    await waitFor(`document.querySelectorAll("#view-phase .roll-row[data-rollup-group='demand']").length > 0`, "汇总需求行渲染", 12000);
    await evaluate(`(() => { const r = document.querySelector("#view-phase .roll-row[data-rollup-group='demand']"); r.click(); return true; })()`);
    let drill2 = false;
    try{ await waitFor(`!!document.querySelector(".modal-layer.open [data-drill-x]")`, "需求行下钻弹窗", 8000); drill2 = true; }catch(e){ drill2 = false; }
    assert(drill2 && (await activeView()) === "phase", "点需求汇总行体 → 下钻弹窗且仍在版本视图（行级下钻保留）");
    await closeAll();
  });

  await section("[P3-C] 影响链 节点标题跳转 + 以此为中心保留", async () => {
    await gotoHash("#/chain", "chain");
    await waitFor(`document.querySelectorAll("#view-chain .ch-node .ch-node-title[data-jump-task]").length > 0`, "影响链节点标题渲染", 20000);
    await shot("p3-chain-nodes");
    const nodeId = await evaluate(`(() => { const n = document.querySelector("#view-chain .ch-node[data-chain-center]"); return n ? n.dataset.chainCenter : null; })()`);
    await jumpTest("chain-node-title", "task", "#view-chain .ch-node .ch-node-title[data-jump-task]", { shot:"p3-chain-title-jump" });
    /* 以此为中心保留：点节点体（非标题）→ 中心卡切换为该节点 */
    await gotoHash("#/chain", "chain");
    await waitFor(`document.querySelectorAll("#view-chain .ch-node[data-chain-center]").length > 0`, "影响链重渲染", 15000);
    const target = await evaluate(`(() => {
      const center = document.querySelector("#view-chain .ch-center-card");
      const cur = center ? center.dataset.chainOpen : null;
      const n = [...document.querySelectorAll("#view-chain .ch-node[data-chain-center]")].find(x => x.dataset.chainCenter !== cur);
      return n ? n.dataset.chainCenter : null;
    })()`);
    if(!target){ skip("chain-recenter：无可切换的非中心节点"); return; }
    await evaluate(`(() => { const n = document.querySelector("#view-chain .ch-node[data-chain-center=" + ${JSON.stringify(target)} + "]"); n.click(); return true; })()`);
    let centered = false;
    try{ await waitFor(`(() => { const c = document.querySelector("#view-chain .ch-center-card"); return c && c.dataset.chainOpen === ${JSON.stringify(target)}; })()`, "以此为中心生效", 8000); centered = true; }catch(e){ centered = false; }
    const drawerOn = await evaluate(`document.getElementById("taskDrawer").classList.contains("on")`);
    assert(centered && !drawerOn, "点节点体 → 以此工作项为中心重绘（未误开抽屉，re-center 保留）");
    await shot("p3-chain-recentered");
    /* ARIA 微调后：节点外层 role=group（内含独立标题按钮，无 button 嵌套），tabindex+keydown 保留 */
    const aria = await evaluate(`(() => { const n = document.querySelector("#view-chain .ch-node[data-chain-center]"); return n ? { role: n.getAttribute("role"), tabindex: n.getAttribute("tabindex"), hasTitleBtn: !!n.querySelector(".ch-node-title[data-jump-task]") } : null; })()`);
    assert(aria && aria.role === "group" && aria.tabindex === "0" && aria.hasTitleBtn, "节点 role=group + tabindex=0，内含独立标题按钮（ARIA 无 button 嵌套）");
    /* 键盘回车聚焦节点(group) → 仍以此为中心重绘，未误开抽屉 */
    await gotoHash("#/chain", "chain");
    await waitFor(`document.querySelectorAll("#view-chain .ch-node[data-chain-center]").length > 0`, "影响链重渲染（键盘）", 15000);
    const kbTarget = await evaluate(`(() => { const c = document.querySelector("#view-chain .ch-center-card"); const cur = c ? c.dataset.chainOpen : null; const n = [...document.querySelectorAll("#view-chain .ch-node[data-chain-center]")].find(x => x.dataset.chainCenter !== cur); if(!n) return null; n.focus(); return { id: n.dataset.chainCenter, focused: document.activeElement === n }; })()`);
    if(kbTarget && kbTarget.focused){
      await pressEnter();
      let kbCentered = false;
      try{ await waitFor(`(() => { const c = document.querySelector("#view-chain .ch-center-card"); return c && c.dataset.chainOpen === ${JSON.stringify(kbTarget.id)}; })()`, "键盘回车以此为中心", 8000); kbCentered = true; }catch(e){ kbCentered = false; }
      const kbDrawer = await evaluate(`document.getElementById("taskDrawer").classList.contains("on")`);
      assert(kbCentered && !kbDrawer, "键盘 Enter 聚焦节点(group) → 以此为中心重绘（tabindex+keydown 保留，未误开抽屉）");
      await shot("p3-chain-kb-recenter");
    } else { skip("chain-kb-recenter：无可聚焦的非中心节点"); }
  });

  await section("[P3-D] 项目史诗 名称跳转 + 子项数按钮保留", async () => {
    await setProject(PROJ);
    await evaluate(`import("./js/core/router.js").then(m => m.showView("project")); true`);
    await waitFor(`document.body.dataset.view === "project"`, "项目视图", 15000);
    let hasEpic = false;
    try{ await waitFor(`document.querySelectorAll("#view-project .manager-epic-name[data-jump-task]").length > 0`, "史诗汇总渲染", 15000); hasEpic = true; }catch(e){ hasEpic = false; }
    if(!hasEpic){ skip("project-epic：该项目无史诗"); return; }
    await shot("p3-project-epics");
    await jumpTest("epic-name", "task", "#view-project .manager-epic-name[data-jump-task]", { shot:"p3-epic-name-jump" });
    /* 子项数按钮保留：点 .manager-epic-sub → 子项表弹窗，未开工作项抽屉 */
    await setProject(PROJ);
    await evaluate(`import("./js/core/router.js").then(m => m.showView("project")); true`);
    /* 原子化「等待并点击」：project 视图重渲染会替换 DOM，分离的 wait 后 click 会命中已失效的 null */
    let clickedSub = false;
    try{
      clickedSub = await waitFor(`(() => { const el = document.querySelector("#view-project .manager-epic-sub[data-epic]"); if(el){ el.click(); return true; } return false; })()`, "点击史诗子项数按钮", 12000);
    }catch(e){ clickedSub = false; }
    if(!clickedSub){ skip("project-epic-children：无史诗子项数按钮"); return; }
    let kids = false;
    try{ await waitFor(`!!document.querySelector(".modal-layer.open .manager-drill-sheet [data-manager-close]")`, "史诗子项表弹窗", 8000); kids = true; }catch(e){ kids = false; }
    const drawerOn = await evaluate(`document.getElementById("taskDrawer").classList.contains("on")`);
    assert(kids && !drawerOn, "点史诗子项数 → 子项表弹窗（未误开工作项抽屉，openTaskTable 保留）");
    await shot("p3-epic-children");
    await closeAll();
  });

  await section("[P3-E] 分支分组头 键盘 Enter/Space 激活", async () => {
    await gotoHash("#/branches", "branches");
    await waitFor(`document.querySelectorAll("#view-branches .br-group-head[data-br-filter]").length > 0`, "分支状态分组头渲染", 20000);
    const head = await evaluate(`(() => {
      const h = [...document.querySelectorAll("#view-branches .br-group-head[data-br-filter]")].find(x => x.getAttribute("aria-pressed") === "false") || document.querySelector("#view-branches .br-group-head[data-br-filter]");
      if(!h) return null;
      return { filter: h.dataset.brFilter, pressed: h.getAttribute("aria-pressed"), tabindex: h.getAttribute("tabindex") };
    })()`);
    assert(head && head.tabindex === "0", "分支分组头可聚焦（tabindex=0）");
    if(!head) return;
    /* Enter 激活 → 筛选切换（aria-pressed 翻转） */
    await evaluate(`(() => { const h = document.querySelector("#view-branches .br-group-head[data-br-filter=" + ${JSON.stringify(head.filter)} + "]"); h.focus(); return document.activeElement === h; })()`);
    await pressEnter();
    let toggled = false;
    try{ await waitFor(`(() => { const h = document.querySelector("#view-branches .br-group-head[data-br-filter=" + ${JSON.stringify(head.filter)} + "]"); return h && h.getAttribute("aria-pressed") !== ${JSON.stringify(head.pressed)}; })()`, "Enter 切换分组筛选", 8000); toggled = true; }catch(e){ toggled = false; }
    assert(toggled, "键盘 Enter 激活分支分组头 → 筛选状态翻转（keydown 委托生效）");
    await shot("p3-branches-head-enter");
    /* 还原 + Space 激活 */
    await evaluate(`(() => { const h = document.querySelector("#view-branches .br-group-head[data-br-filter=" + ${JSON.stringify(head.filter)} + "]"); h.focus(); return true; })()`);
    await pressSpace();
    let toggled2 = false;
    try{ await waitFor(`(() => { const h = document.querySelector("#view-branches .br-group-head[data-br-filter=" + ${JSON.stringify(head.filter)} + "]"); return h && h.getAttribute("aria-pressed") === ${JSON.stringify(head.pressed)}; })()`, "Space 还原分组筛选", 8000); toggled2 = true; }catch(e){ toggled2 = false; }
    assert(toggled2, "键盘 Space 激活分支分组头 → 筛选状态还原（空格可达）");
  });

  /* ===================== 手机端截图 + 横向裁切 ===================== */
  await section("[手机端] 关键界面截图与横向裁切", async () => {
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const checkClip = async (label) => {
      const m = await evaluate(`({ docW: document.documentElement.scrollWidth, innerW: window.innerWidth })`);
      assert(m.docW <= m.innerW + 1, label + "无横向裁切（" + m.docW + "/" + m.innerW + "）");
    };
    await gotoHash("#/list", "list");
    await waitFor(`document.querySelectorAll("#view-list .assoc-link[data-jump-project]").length > 0`, "手机端列表项目名", 15000);
    await checkClip("手机端列表"); await shot("mobile-list");
    await setProject(PROJ);
    await gotoHash("#/phase", "phase");
    await evaluate(`(() => { const b = document.querySelector("#phaseModeSeg [data-pmode='version']"); if(b) b.click(); return true; })()`);
    await waitFor(`document.querySelectorAll("#view-phase .assoc-link[data-jump-version]").length > 0`, "手机端版本表", 20000);
    await checkClip("手机端版本视图"); await shot("mobile-phase");
    await gotoHash("#/testcases", "testcases");
    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcProject(${JSON.stringify(PROJ)}); m.setTcMode("cases"); return true; })`);
    await waitFor(`document.querySelectorAll("#view-testcases .tc-row[data-tc-open]").length > 0`, "手机端用例", 20000);
    await checkClip("手机端用例"); await shot("mobile-testcases");
    await gotoHash("#/branches", "branches");
    await waitFor(`document.querySelectorAll("#view-branches .assoc-link").length > 0`, "手机端分支", 20000);
    await checkClip("手机端分支"); await shot("mobile-branches");
    await call("Emulation.clearDeviceMetricsOverride", {});
  });

  /* ===================== 控制台报错 ===================== */
  console.log("");
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 500) + "）" : ""));
  const resWithUrl = cdp.resourceErrors.filter(t => /https?:\/\//.test(t));
  const resUnknown = resWithUrl.filter(t => !isKnownGap(t));
  const resNoUrl = cdp.resourceErrors.length - resWithUrl.length;
  assert(resUnknown.length === 0 && resNoUrl <= cdp.knownGaps.length,
    "资源加载报错全部归因到已知环境缺口（未知 " + resUnknown.length + "，无 URL " + resNoUrl + " / 缺口 " + cdp.knownGaps.length + "）" +
    (resUnknown.length ? "：" + resUnknown.slice(0, 4).join(" | ") : ""));
  const netUnique = [...new Set(cdp.netErrors)];
  if(netUnique.length) console.log("  网络 4xx/5xx（诊断用）：\n    " + netUnique.join("\n    "));
  else console.log("  网络无 4xx/5xx（favicon 与已知环境缺口除外）");
  if(cdp.knownGaps.length) console.log("  环境缺口（非本次改动）：预览前端调用了运行 jar 里尚未打包的接口 → " +
    [...new Set(cdp.knownGaps.map(s => s.split(" ")[1].replace(/^https?:\/\/[^/]+/, "").split("?")[0]))].join("、") +
    "（共 " + cdp.knownGaps.length + " 次）");
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log("\n截图：" + (SHOTS.join(", ") || "无"));
if(SKIPS.length) console.log("\n跳过（数据缺失，如实记录）：\n  - " + SKIPS.join("\n  - "));
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);