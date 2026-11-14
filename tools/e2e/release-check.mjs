/* 发布检查交互 E2E（Native CDP，前置：本地栈 + 演示数据，SQL 84–89 已应用）
   覆盖：项目编辑里的策略配置与即时保存（含项目活动轨迹 / 审计留痕）、计划页「本版本已覆盖工作项 x/y」、
   发布检查两行计数与覆盖口径、阻断时的内联「未按计划发布的原因」（高级区不再重复展开）、
   「去处理」直达用例、冻结证据标题与控制台报错。
   演示数据：版本 Voc6wlnlawn6ekywshfsi（App 首页 v3.2）的测试计划 TP0xj23p9vxpedvi5mc9fa
   中 C2ozmwlniqizjf99s37b5 会被本脚本临时标记为发布必测，结束前还原（required=false、策略 standard）。
   用法：node tools/e2e/release-check.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zdcxjt60yqxxh";
const REQ = process.env.E2E_REQ || "Rph94sl9psffcezue1t04";
const VERSION = process.env.E2E_VERSION || "Voc6wlnlawn6ekywshfsi";
const PLAN = process.env.E2E_PLAN || "RP5ay41ni0c9qsi8re7lbm";
const CASE = process.env.E2E_CASE || "C2ozmwlniqizjf99s37b5";
const CASE_TITLE = process.env.E2E_CASE_TITLE || "启动性能";

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
const port = 9225;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
let evaluateRef = null;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const setRequiredExpr = flag => `(async () => {
  const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
  const r = await fetch("api/test-plans/${process.env.E2E_TP || "TP0xj23p9vxpedvi5mc9fa"}/cases/${CASE}/required?required=${flag ? "true" : "false"}&workspace=${WS}", {
    method: "PUT", headers: { "X-XSRF-TOKEN": decodeURIComponent(csrf) }
  });
  return r.ok;
})()`;
const cleanupExpr = `(async () => {
  const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
  const headers = { "X-XSRF-TOKEN": decodeURIComponent(csrf) };
  await fetch("api/test-plans/${process.env.E2E_TP || "TP0xj23p9vxpedvi5mc9fa"}/cases/${CASE}/required?required=false&workspace=${WS}", { method: "PUT", headers });
  await fetch("api/projects/${REQ}/release-policy?policy=standard&workspace=${WS}", { method: "PUT", headers });
  return true;
})()`;

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
  evaluateRef = evaluate;
  assert(await evaluate(setRequiredExpr(true)), "准备：把失败用例标记为发布必测");

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
  await waitFor(`!!document.querySelector('[data-ver-detail="${VERSION}"]')`, "版本卡渲染", 25000);
  await evaluate(`document.querySelector('[data-ver-detail="${VERSION}"]').click(); true`);
  await waitFor(`!!document.querySelector(".release-sheet [data-release-tab='plan']")`, "发布工作区打开", 15000);
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
  await evaluate(`document.querySelector("[data-release-tab='actual']").click(); true`);
  await waitFor(`!!document.querySelector("[data-release-check-host] .release-check.is-block")`, "阻断结论渲染", 15000);
  const checkText = await evaluate(`document.querySelector("[data-release-check-host]").textContent`);
  assert(/发布检查/.test(checkText) && /有阻断项/.test(checkText), "标题为「发布检查」并标明阻断");
  assert(/测试计划用例 4 条：通过 2/.test(checkText) && /发布必测 1 条：通过 0/.test(checkText), "计数拆成用例 / 发布必测两行");
  assert(checkText.indexOf("未关联计划，覆盖分母取版本范围") === -1, "关联计划时不显示未关联提示");
  assert(/本版本范围：需求级覆盖 \d+\/\d+（需求下至少 1 条用例，已驳回 \/ 取消的需求不计）/.test(checkText), "需求级覆盖口径就地说明");
  assert(/工作项级覆盖 \d+\/\d+（用例已关联到工作项）/.test(checkText), "工作项级覆盖口径就地说明");
  assert(/策略：标准/.test(checkText), "面板显示当前策略");
  const riskLabel = await evaluate(`(document.querySelector(".release-risk label") || {}).textContent || ""`);
  assert(/未按计划发布的原因/.test(riskLabel), "阻断时内联原因字段命名统一");
  const advancedOpen = await evaluate(`(() => { const d = document.querySelector("[data-release-advanced]"); return !d || d.open; })()`);
  assert(advancedOpen === false, "阻断时高级区不再自动展开（原因只在内联区填一次）");
  const caseButtons = await evaluate(`[...document.querySelectorAll("[data-release-case]")].map(b => ({ id: b.getAttribute("data-release-case"), text: b.textContent.trim() }))`);
  assert(caseButtons.length > 0 && caseButtons.every(b => b.text === "去处理"), "阻断用例带「去处理」按钮（" + caseButtons.length + " 条）");

  /* 4. 计划页：检查加载后标题显示「本版本已覆盖工作项 x/y」 */
  await evaluate(`document.querySelector("[data-release-tab='plan']").click(); true`);
  const planHeading = await waitFor(`(() => {
    const h = [...document.querySelectorAll(".release-section .label-row h4")].find(el => el.textContent.indexOf("这次计划发布哪些工作项") > -1);
    return h && h.textContent.indexOf("本版本已覆盖工作项") > -1 ? h.textContent : "";
  })()`, "计划覆盖标签", 12000);
  assert(/本版本已覆盖工作项 \d+\/\d+/.test(planHeading), "计划标题显示本版本覆盖进度（" + planHeading + "）");
  await evaluate(`document.querySelector("[data-release-tab='actual']").click(); true`);
  await waitFor(`!!document.querySelector("[data-release-check-host] .release-check.is-block")`, "返回检查面板", 12000);
  const panelShot = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/release-check-panel.png", Buffer.from(panelShot.data, "base64"));

  /* 5. 去处理：跳到用例视图并打开该用例 */
  await evaluate(`document.querySelector("[data-release-tab='actual']").click(); true`);
  await waitFor(`!!document.querySelector('[data-release-case="${CASE}"]')`, "阻断用例按钮", 12000);
  await evaluate(`document.querySelector('[data-release-case="${CASE}"]').click(); true`);
  await waitFor(`document.body.dataset.view === "testcases"`, "跳转用例视图", 15000);
  await waitFor(`(() => { const d = document.getElementById("dlgCase"); return d && d.classList.contains("open"); })()`, "用例编辑弹窗", 15000);
  const openedCase = await evaluate(`document.getElementById("cTitle").value`);
  assert(openedCase === CASE_TITLE, "去处理打开「" + CASE_TITLE + "」（实际：" + openedCase + "）");

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

  /* 6. 截图 + 控制台 */
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const out = "/tmp/release-check-e2e.png";
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("  截图：" + out);
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 300) + "）" : ""));

  /* 7. 还原演示数据 */
  evaluateRef = evaluate;
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ if(evaluateRef) await evaluateRef(cleanupExpr); }catch(e){}
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);
