/* 发布检查交互 E2E（Native CDP，前置：本地栈 + 演示数据，SQL 84–89 已应用）
   覆盖：项目编辑里的策略配置与即时保存（含项目活动轨迹 / 审计留痕）、计划页「本版本已覆盖工作项 x/y」、
   发布检查两行计数与覆盖口径、阻断时的内联「未按计划发布的原因」（高级区不再重复展开）、
   「去处理」直达用例、冻结证据标题与控制台报错。
   夹具自备：登录后从 GET /api/release-plans 挑一个就绪计划（默认空间 SXk01 运营研发中心），
   临时创建 1 条合成用例 + 1 个关联该版本的非草稿测试计划，标记发布必测并记 1 条失败执行，
   让 /api/versions/{id}/release-check 稳定返回 block；断言里的计数从检查接口读取，不写死演示数据。
   结束前删除临时用例与计划（执行流水随用例删除）、策略恢复 standard。
   环境变量：E2E_BASE / E2E_USER / E2E_PASS / E2E_WS（默认 SXk01）；
            E2E_REQ + E2E_VERSION + E2E_PLAN 可指定目标项目 / 版本 / 发布计划，缺省自动发现。
   用法：node tools/e2e/release-check.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const WS = process.env.E2E_WS || "SXk01";
let REQ = process.env.E2E_REQ || "";
let VERSION = process.env.E2E_VERSION || "";
let PLAN = process.env.E2E_PLAN || "";
let FIXTURE = null;

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
      this.errors.push("log: " + (msg.params.entry.url || "") + " " + (msg.params.entry.text || ""));
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
const port = 9225;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
let cleanupFn = null;
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
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  /* 走应用同源 fetch：带 CSRF 头与已登录会话，返回 ApiResult.data */
  const pageApi = async (method, url, body) => evaluate(`(async () => {
    const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const headers = { "X-XSRF-TOKEN": decodeURIComponent(csrf) };
    ${body ? 'headers["Content-Type"] = "application/json";' : ""}
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)}, credentials: "same-origin", headers${body ? `, body: JSON.stringify(${JSON.stringify(body)})` : ""}
    });
    const text = await r.text();
    let data = null; try{ data = JSON.parse(text); }catch(e){}
    if(!r.ok) throw new Error("HTTP " + r.status + " " + (text || "").slice(0, 200));
    return data && data.data !== undefined ? data.data : data;
  })()`);

  console.log("发布检查 E2E\n  地址：" + BASE);
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
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  await evaluate(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${WS}/select", {})).then(() => true)`);
  await call("Page.navigate", { url: BASE + "/" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录并切到空间 " + WS);

  /* 0. 夹具自备：挑就绪计划 → 临时用例 + 关联版本的非草稿测试计划 → 失败必测 → 结束清理 */
  if(!(REQ && VERSION && PLAN)){
    const rows = await pageApi("GET", `api/release-plans?status=all&workspace=${WS}`);
    if(!Array.isArray(rows) || !rows.length) throw new Error("空间 " + WS + " 没有发布计划，先准备演示数据或指定 E2E_REQ/E2E_VERSION/E2E_PLAN");
    const pick = rows.find(r => r.status === "ready" && r.versionId && r.reqId)
      || rows.find(r => r.versionId && r.reqId)
      || null;
    if(!pick) throw new Error("没有带版本与项目的发布计划可用于夹具");
    REQ = pick.reqId; VERSION = pick.versionId; PLAN = pick.id;
  }
  FIXTURE = { CASE: "", TP: "", TITLE: "" };
  cleanupFn = async () => {
    try{ if(FIXTURE.TP) await pageApi("DELETE", `api/test-plans/${FIXTURE.TP}?workspace=${WS}`); }catch(e){}
    try{ if(FIXTURE.CASE) await pageApi("DELETE", `api/test-cases/${FIXTURE.CASE}?workspace=${WS}`); }catch(e){}
    try{ await pageApi("PUT", `api/projects/${REQ}/release-policy?policy=standard&workspace=${WS}`); }catch(e){}
  };
  /* 策略先归一为 standard：第一步要验证「默认 standard 且可编辑」，并确保 strict→standard 轨迹可写 */
  await pageApi("PUT", `api/projects/${REQ}/release-policy?policy=standard&workspace=${WS}`);
  const stamp = String(Date.now()).slice(-6);
  const createdCase = await pageApi("POST", `api/test-cases?workspace=${WS}`, {
    reqId: REQ, title: "E2E 发布检查临时用例 " + stamp, priority: "P2", precondition: "合成夹具：脚本创建，结束即删"
  });
  FIXTURE.CASE = createdCase.id;
  FIXTURE.TITLE = createdCase.title;
  const createdPlan = await pageApi("POST", `api/test-plans?workspace=${WS}`, {
    reqId: REQ, name: "E2E 发布检查临时计划 " + stamp, versionId: VERSION
  });
  FIXTURE.TP = createdPlan.id;
  await pageApi("POST", `api/test-plans/${FIXTURE.TP}/cases?workspace=${WS}`, { caseIds: [FIXTURE.CASE], required: true });
  await pageApi("PUT", `api/test-plans/${FIXTURE.TP}/status?status=running&workspace=${WS}`);
  await pageApi("POST", `api/test-plans/${FIXTURE.TP}/runs?workspace=${WS}`, { status: "failed", caseIds: [FIXTURE.CASE], note: "E2E 阻断夹具" });
  const fixtureCheck = await pageApi("GET", `api/versions/${VERSION}/release-check?planId=${PLAN}&workspace=${WS}`);
  if(!fixtureCheck || fixtureCheck.verdict !== "block") throw new Error("夹具未形成阻断：verdict=" + (fixtureCheck && fixtureCheck.verdict));
  pass("夹具：临时用例与测试计划在版本 " + VERSION + " 上形成阻断（" + PLAN + "）");

  /* 1. 项目编辑：策略字段可见、可即时保存 */
  await evaluate(`import("./js/views/projects.js").then(m => { m.openProjectDialog(${JSON.stringify(REQ)}); return true; })`);
  await waitFor(`(() => { const b = document.getElementById("dlgProject"); const s = document.getElementById("rReleasePolicy"); return b && b.classList.contains("open") && !document.getElementById("projReleasePolicy").hidden && !s.disabled && !!s.dataset.saved; })()`, "项目编辑弹窗与策略字段", 10000);
  const policyInit = await evaluate(`({ value: document.getElementById("rReleasePolicy").value, disabled: document.getElementById("rReleasePolicy").disabled,
    hint: document.getElementById("projReleasePolicy").textContent })`);
  assert(policyInit.value === "standard" && !policyInit.disabled, "策略默认 standard 且可编辑");
  assert(/发布检查策略/.test(policyInit.hint) && /标准＝发布必测失败/.test(policyInit.hint) && /必测未执行只提醒/.test(policyInit.hint), "策略字段带口径说明");

  const setPolicy = async v => {
    await evaluate(`(() => {
      const el = document.getElementById("rReleasePolicy");
      el.value = ${JSON.stringify(v)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitFor(`document.getElementById("rReleasePolicy").dataset.saved === ${JSON.stringify(v)} && !document.getElementById("rReleasePolicy").disabled`, "策略保存 " + v, 10000);
  };
  await setPolicy("strict");
  pass("策略改为 strict 并保存");
  const policyTrail = await evaluate(`(async () => {
    const acts = await (await fetch("api/projects/${REQ}/activities?workspace=${WS}&limit=20", { credentials: "same-origin" })).json();
    const rows = (acts.data && acts.data.items) || [];
    return rows.some(a => a.action === "release_policy_update" && /标准 → 严格/.test(a.detail || ""));
  })()`);
  assert(policyTrail === true, "策略变更出现在项目活动轨迹");
  const auditTrail = await evaluate(`(async () => {
    const rs = await (await fetch("api/admin/audit/logs?action=project_release_policy&workspace=${WS}&size=5", { credentials: "same-origin" })).json();
    const rows = (rs.data && rs.data.items) || [];
    return rows.some(a => a.targetId === ${JSON.stringify(REQ)} && /发布检查策略/.test(a.detail || ""));
  })()`);
  assert(auditTrail === true, "策略变更进入平台审计日志（可筛选）");
  await setPolicy("standard");
  pass("策略改回 standard 并保存");
  await evaluate(`(document.getElementById("dlgProjectX") || {click(){}}).click(); true`);
  await sleep(300);

  /* 2. 打开版本发布工作区，关联计划后看「本版本已覆盖工作项 x/y」 */
  await evaluate(`import("./js/core/router.js").then(m => { m.showView("phase"); return true; })`);
  await evaluate(`import("./js/views/phase.js").then(m => { m.setPhaseProject(${JSON.stringify(REQ)}, "version"); return true; })`);
  await waitFor(`(() => { const b = document.querySelector('#phaseModeSeg [data-pmode="version"]'); return b && b.getAttribute("aria-pressed") === "true"; })()`, "切到按版本", 15000);
  /* 进行中的主版本渲染成焦点卡（.ver-focus），「计划与历史」收在更多菜单；其他版本行才有直按钮 */
  await waitFor(`!!document.querySelector('[data-ver-detail="${VERSION}"], [data-ver-menu="${VERSION}"]')`, "版本卡渲染", 25000);
  const hasDetailBtn = await evaluate(`!!document.querySelector('[data-ver-detail="${VERSION}"]')`);
  if(hasDetailBtn){
    await evaluate(`document.querySelector('[data-ver-detail="${VERSION}"]').click(); true`);
  }else{
    await evaluate(`document.querySelector('[data-ver-menu="${VERSION}"]').click(); true`);
    await waitFor(`!!document.querySelector('[data-ver-menu-act="plan"][data-ver-id="${VERSION}"]')`, "版本操作菜单", 8000);
    await evaluate(`document.querySelector('[data-ver-menu-act="plan"][data-ver-id="${VERSION}"]').click(); true`);
  }
  await waitFor(`document.body.dataset.view === "release" && !!document.querySelector("#view-release [data-release-step='plan']")`, "发布工作台子页打开", 15000);
  const route0 = await evaluate(`({ hash: location.hash, back: !!document.querySelector("#view-release [data-release-back]"), modal: !!document.querySelector(".modal-layer.open") })`);
  assert(route0.hash.indexOf("#/release?id=" + VERSION) === 0 && route0.hash.indexOf("reqId=" + REQ) > 0, "入口落到 #/release 并带版本与项目（" + route0.hash + "）");
  assert(route0.back && !route0.modal, "工作台在页面里，不再是居中弹框，且有「返回版本」");
  const layout0 = await evaluate(`(() => {
    const page = document.querySelector("#view-release .release-page").getBoundingClientRect();
    const view = document.getElementById("view-release");
    return { w: Math.round(page.width), left: Math.round(page.left), viewW: Math.round(view.clientWidth),
      overflow: view.scrollWidth > view.clientWidth + 1, scrollable: view.scrollHeight > view.clientHeight + 1 };
  })()`);
  assert(layout0.w > 0 && layout0.w <= layout0.viewW && layout0.left >= 0 && !layout0.overflow, "1440 宽下工作台在内容区内铺开且无横向溢出（实际 " + layout0.w + "）");
  const shot1440 = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/release-page-1440.png", Buffer.from(shot1440.data, "base64"));
  await sleep(600);
  const planIdNow = await evaluate(`(document.querySelector("[data-release-planId]") || {}).value || ""`);
  if(planIdNow !== PLAN){
    await evaluate(`(() => {
      const el = document.querySelector("[data-release-planId]");
      el.value = ${JSON.stringify(PLAN)};
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(800);
  }

  /* 3. 实际页：发布检查两行计数、覆盖口径、内联原因与「去处理」 */
  await evaluate(`document.querySelector("[data-release-step='actual']").click(); true`);
  await waitFor(`!!document.querySelector("[data-release-check-host] .release-check.is-block")`, "阻断结论渲染", 15000);
  await waitFor(`location.hash.indexOf("tab=actual") > 0`, "页签写入 URL", 8000);
  pass("切到「实际」后地址栏带 tab=actual（可刷新、可分享）");
  const checkApi = await pageApi("GET", `api/versions/${VERSION}/release-check?planId=${PLAN}&workspace=${WS}`);
  const caseLine = "测试计划用例 " + checkApi.caseTotal + " 条：通过 " + checkApi.casePassed;
  const requiredLine = "发布必测 " + checkApi.requiredTotal + " 条：通过 " + checkApi.requiredPassed;
  const checkText = await evaluate(`document.querySelector("[data-release-check-host]").textContent`);
  assert(/发布检查/.test(checkText) && /有阻断项/.test(checkText), "标题为「发布检查」并标明阻断");
  assert(checkText.indexOf(caseLine) > -1 && checkText.indexOf(requiredLine) > -1, "计数拆成用例 / 发布必测两行（" + caseLine + "；" + requiredLine + "）");
  assert(checkText.indexOf("未关联计划，覆盖分母取版本范围") === -1, "关联计划时不显示未关联提示");
  assert(/本版本范围：需求级覆盖 \d+\/\d+（需求下至少 1 条用例，已驳回 \/ 取消的需求不计）/.test(checkText), "需求级覆盖口径就地说明");
  assert(/工作项级覆盖 \d+\/\d+（用例已关联到工作项）/.test(checkText), "工作项级覆盖口径就地说明");
  assert(/策略：标准/.test(checkText), "面板显示当前策略");
  const riskLabel = await evaluate(`(document.querySelector(".release-risk") || {}).textContent || ""`);
  assert(/未按计划发布的原因/.test(riskLabel), "阻断时内联原因字段命名统一");
  const advancedOpen = await evaluate(`(() => { const d = document.querySelector("[data-release-advanced]"); return !d || d.open; })()`);
  assert(advancedOpen === false, "阻断时高级区不再自动展开（原因只在内联区填一次）");
  const caseButtons = await evaluate(`[...document.querySelectorAll("[data-release-case]")].map(b => ({ id: b.getAttribute("data-release-case"), text: b.textContent.trim() }))`);
  assert(caseButtons.length > 0 && caseButtons.every(b => b.text === "去处理"), "阻断用例带「去处理」按钮（" + caseButtons.length + " 条）");

  /* 4. 计划页：检查加载后标题显示「本版本已覆盖工作项 x/y」 */
  await evaluate(`document.querySelector("[data-release-step='plan']").click(); true`);
  /* 计划面与实际面的关联计划是两个下拉：标题覆盖进度只在两边选中同一计划时显示 */
  const planPicked = await evaluate(`(() => {
    const el = document.querySelector("[data-plan-select]");
    if(!el) return false;
    el.value = ${JSON.stringify(PLAN)};
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if(planPicked) await sleep(500);
  const planHeading = await waitFor(`(() => {
    const h = [...document.querySelectorAll(".release-section .label-row h4")].find(el => el.textContent.indexOf("这次计划发布哪些工作项") > -1);
    return h && h.textContent.indexOf("本版本已覆盖工作项") > -1 ? h.textContent : "";
  })()`, "计划覆盖标签", 12000);
  assert(/本版本已覆盖工作项 \d+\/\d+/.test(planHeading), "计划标题显示本版本覆盖进度（" + planHeading + "）");
  await evaluate(`document.querySelector("[data-release-step='actual']").click(); true`);
  await waitFor(`!!document.querySelector("[data-release-check-host] .release-check.is-block")`, "返回检查面板", 12000);
  const panelShot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/release-check-panel.png", Buffer.from(panelShot.data, "base64"));

  /* 5. 去处理：跳到用例视图并打开该用例 */
  await evaluate(`document.querySelector("[data-release-step='actual']").click(); true`);
  await waitFor(`!!document.querySelector('[data-release-case="${FIXTURE.CASE}"]')`, "阻断用例按钮", 12000);
  await evaluate(`document.querySelector('[data-release-case="${FIXTURE.CASE}"]').click(); true`);
  await waitFor(`document.body.dataset.view === "testcases"`, "跳转用例视图", 15000);
  await waitFor(`(() => {
    const d = document.getElementById("dlgCase"), v = document.getElementById("caseDetailView");
    return !!d && d.classList.contains("open") && !!v && !v.hidden && !!v.querySelector("h2");
  })()`, "用例详情抽屉", 15000);
  const openedCase = await evaluate(`((document.querySelector("#caseDetailView h2") || {}).textContent || "").trim()`);
  assert(openedCase === FIXTURE.TITLE, "去处理打开「" + FIXTURE.TITLE + "」（实际：" + openedCase + "）");

  /* 6. 冻结证据渲染：标题与范围前缀（不写库，直接渲染函数输出） */
  const frozen = await evaluate(`import("./js/lib/format.js").then(m => m.releaseSnapshotHTML({
    id: "R-demo", environment: "production", result: "success", occurredAt: "2026-11-14T08:00:00Z",
    artifactRef: "hourglass-server.jar#demo", targetKeys: ["prod-a"],
    planSnapshot: { testEvidence: { policy: "standard", verdict: "block", checkedAt: "2026-11-14T08:00:00",
      evidenceScope: "version", planLinked: false,
      requiredTotal: 1, requiredPassed: 0, requiredFailed: 1, requiredUntested: 0,
      caseTotal: 4, caseExecuted: 4, casePassed: 2, caseFailed: 1, caseBlocked: 1, caseSkipped: 0, caseUntested: 0,
      demandsTotal: 4, demandsCovered: 1, workItemsTotal: 17, workItemsCovered: 3,
      blockers: ["发布必测用例失败或阻塞 1 条"], reminders: [], requiredCases: [] } }
  }))`).catch(e => "ERR:" + e.message);
  if(String(frozen).startsWith("ERR:")) throw new Error("冻结证据渲染失败：" + frozen);
  assert(/发布检查（已冻结）/.test(frozen), "冻结证据标题统一");
  assert(/本版本范围：需求级覆盖 1\/4 · 工作项级覆盖 3\/17/.test(frozen), "冻结证据带本版本范围口径");
  assert(/未关联发布计划，按本版本全部测试计划核对/.test(frozen), "冻结证据说明未关联计划时的证据范围");

  /* 6b. 版本卡「记录实际发布」落到独立记录页，取消后仍回版本详情 */
  await evaluate(`import("./js/core/router.js").then(m => { m.showView("phase"); return true; })`);
  await evaluate(`import("./js/views/phase.js").then(m => { m.setPhaseProject(${JSON.stringify(REQ)}, "version"); return true; })`);
  const hasPublish = await evaluate(`!!document.querySelector('[data-ver-release="${VERSION}"]')`);
  if(hasPublish){
    await evaluate(`document.querySelector('[data-ver-release="${VERSION}"]').click(); true`);
    await waitFor(`document.body.dataset.view === "record" && location.hash.indexOf("#/record?versionId=${VERSION}") === 0 && !!document.querySelector("#view-record [data-rec-save]")`, "记录发布页入口", 25000);
    pass("「记录实际发布」入口落到独立记录页");
    await evaluate(`document.querySelector("#view-record [data-rec-back]").click(); true`);
    await waitFor(`document.body.dataset.view === "version" && location.hash.indexOf("#/version?id=") === 0`, "记录页返回版本详情", 12000);
  }else{
    pass("当前版本无「记录实际发布」入口（权限），跳过记录页入口检查");
  }

  /* 7. 直链 / 页签后退 / 返回版本：页面级子页的三个基本动作 */
  /* 走 index.html 而不是裸 hash：同文档改 hash 不会重新加载，测不到「直链进页面」 */
  await call("Page.navigate", { url: BASE + "/index.html#/release?id=" + VERSION + "&reqId=" + REQ + "&tab=history" });
  try{
    await waitFor(`document.body.dataset.view === "release" && !!document.querySelector("#view-release [data-release-step='history'].is-active")`, "直链打开历史页签", 45000);
  }catch(err){
    console.log("    直链诊断 " + JSON.stringify(await evaluate(`({
      href: location.href, ready: document.readyState, view: document.body.dataset.view,
      app: !!document.querySelector(".app"), modal: [...document.querySelectorAll(".modal-layer.open")].map(m => (m.querySelector("h2") || {}).textContent || ""),
      tabs: [...document.querySelectorAll("#view-release [data-release-step]")].map(b => b.dataset.releaseStep),
      body: (document.getElementById("releaseBody") || {}).textContent ? document.getElementById("releaseBody").textContent.trim().slice(0, 120) : ""
    })`).catch(e => "EVAL:" + e.message)));
    const diagShot = await call("Page.captureScreenshot", { format: "png" }).catch(() => null);
    if(diagShot) fs.writeFileSync("/tmp/release-direct-fail.png", Buffer.from(diagShot.data, "base64"));
    throw err;
  }
  pass("直接打开链接进入工作台，并停在 URL 指定的页签");
  await evaluate(`document.querySelector("#view-release [data-release-step='plan']").click(); true`);
  await waitFor(`location.hash.indexOf("tab=history") === -1 && location.hash.indexOf("#/release?id=") === 0`, "计划页签写入 URL", 8000);
  await evaluate(`history.back(); true`);
  await waitFor(`!!document.querySelector("#view-release [data-release-step='history'].is-active")`, "后退回到历史页签", 10000);
  pass("浏览器后退按 URL 对齐页签，不重进整页");
  await evaluate(`document.querySelector("#view-release [data-release-back]").click(); true`);
  await waitFor(`document.body.dataset.view === "phase" && location.hash.indexOf("#/phase") === 0`, "返回版本页", 12000);
  pass("「返回版本」离开工作台回到版本页");

  /* 8. 390 宽：工作台铺满、无横向溢出，返回与页签仍可用 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE + "/index.html#/release?id=" + VERSION + "&reqId=" + REQ + "&tab=plan" });
  await waitFor(`document.body.dataset.layout === "mobile" && document.body.dataset.view === "release" && !!document.querySelector("#view-release [data-release-step='plan'].is-active")`, "手机直链进入工作台", 45000);
  const mob = await evaluate(`(() => {
    const page = document.querySelector("#view-release .release-page");
    const back = document.querySelector("#view-release [data-release-back]").getBoundingClientRect();
    const tab = document.querySelector("#view-release [data-release-step='plan']").getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      pageW: Math.round(page.getBoundingClientRect().width), innerW: innerWidth,
      backH: Math.round(back.height), backRight: Math.round(back.right), tabH: Math.round(tab.height),
      tabs: document.querySelectorAll("#view-release [data-release-step]").length };
  })()`);
  assert(!mob.overflow && mob.pageW <= mob.innerW, "390 宽无横向溢出");
  assert(mob.tabs === 3 && mob.backH >= 44 && mob.tabH >= 44, "手机端返回与三步条保留并满足 44px 触控高度");
  const shot390 = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/release-page-390.png", Buffer.from(shot390.data, "base64"));
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 9. 截图 + 控制台 */
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const out = "/tmp/release-check-e2e.png";
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("  截图：" + out);
  /* 演示库缺 project_repo / 分支看板数据导致的 500（2026-11-15 08:39 前已存在，与本页无关），单独跟踪；
     无头 Chrome 取 PWA 清单图标时偶发中止（静态服务器 200 image/png，收尾杀进程时超时），同样不计页面报错 */
  const KNOWN_BASELINE = [/api\/branches\/options/, /api\/branches\/board/, /api\/repos/, /icons\/icon-1024\.png/];
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1 && !KNOWN_BASELINE.some(r => r.test(e)));
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 300) + "）" : ""));

}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ if(cleanupFn) await cleanupFn(); }catch(e){}
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);
