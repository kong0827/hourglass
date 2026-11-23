/* 周回顾（团队/我）实施验证：真实登录 + 本地 8081 预览 + 8080 后端。
   覆盖：团队默认视图、统计矩阵与就地明细、角色筛选、切到「我」、翻周、390 布局、控制台报错。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.resourceErrors = [];
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
  }
  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") {
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      this.errors.push("console.error: " + msg.params.args.map((a) => a.value || a.description || "").join(" "));
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const e = msg.params.entry;
      if (/Failed to load resource/.test(e.text || "")) this.resourceErrors.push("resource: " + (e.url || "") + " " + e.text);
      else this.errors.push("log: " + e.text);
    }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9451);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-team-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = (m) => console.log("  PASS " + m);
const assert = (cond, msg) => { if (!cond) { failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];

try {
  let version = null;
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch (e) { await sleep(200); }
  }
  if (!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for (const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try { await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); } catch (e) { /* 忽略 */ }
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async (expr) => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await evaluate(expr); if (last) return last; } catch (e) { last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async (name, full) => {
    const s = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full });
    const out = "/tmp/hg-review-" + name + ".png";
    fs.writeFileSync(out, Buffer.from(s.data, "base64"));
    SHOTS.push(out);
  };

  console.log("周回顾实施验证\n  地址：" + BASE);
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
  await waitFor("import('./js/core/state.js').then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)", "应用初始化", 25000);
  pass("登录并初始化");

  await evaluate("location.hash = '#/review'; window.dispatchEvent(new HashChangeEvent('hashchange')); true");
  await waitFor("document.body.dataset.view === 'review' && document.querySelectorAll('#reviewTeamView .rv-stat-tbl tbody tr').length === 4", "团队统计矩阵", 25000);
  await waitFor("document.querySelectorAll('#reviewTeamView .rv-member-tbl tbody tr[data-load]').length > 0", "成员表", 15000);
  const team = await evaluate(`(() => {
    const txt = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : ""; };
    return {
      scopeHidden: document.getElementById("reviewScopeSeg").hidden,
      teamHidden: document.getElementById("reviewTeamView").hidden,
      personalHidden: document.getElementById("reviewPersonalView").hidden,
      roleHidden: document.getElementById("reviewRoleWrap").hidden,
      title: txt("#reviewTitle"),
      week: txt("#weekLabel"),
      brief: txt("#rvBrief"),
      rows: [...document.querySelectorAll("#reviewTeamView .rv-stat-tbl tbody td.rv-obj b")].map(e => e.textContent.trim()),
      members: document.querySelectorAll("#reviewTeamView .rv-member-tbl tbody tr[data-load]").length,
      projects: document.querySelectorAll("#reviewTeamView .rv-proj-name").length,
      cards: [...document.querySelectorAll("#reviewTeamView .rv-card-head h2")].map(e => e.textContent.trim()),
      detailTotal: document.querySelectorAll("#reviewTeamView [data-rvd]").length,
      copyHidden: document.getElementById("btnCopy").parentNode.hidden,
      copyLabel: (document.querySelector('#copyMenu [data-copy="plain"]') || {}).textContent || "",
      aiHidden: (document.getElementById("copyAiItem") || {}).hidden,
      due: (document.querySelector("#reviewTeamView .rv-due") || {}).textContent || "",
      dueBtns: document.querySelectorAll('#reviewTeamView [data-rvd="due-late"], #reviewTeamView [data-rvd="due-open"]').length,
      trendRows: document.querySelectorAll("#reviewTeamView .rv-trend-row").length,
      sparks: document.querySelectorAll("#reviewTeamView .rv-spark polyline").length,
      trendHead: (document.querySelector("#reviewTeamView .rv-trend-head") || {}).textContent || "",
      idleCard: [...document.querySelectorAll("#reviewTeamView .rv-risk .rl")].map(e => e.textContent.trim()),
      idleTags: document.querySelectorAll("#reviewTeamView .rv-idle-tag").length,
      nextHead: (document.querySelector("#reviewTeamView .rv-next-list-head") || {}).textContent || "",
      nextItems: document.querySelectorAll("#reviewTeamView .rv-next-item").length
    };
  })()`);
  assert(team.scopeHidden === false, "团队/我 范围切换可见");
  assert(team.teamHidden === false && team.personalHidden === true, "默认展示团队视图，个人视图隐藏");
  assert(team.roleHidden === false, "团队口径显示角色筛选");
  assert(team.rows.join("|") === "需求|工作项|测试|文档", "统计矩阵四行对象：需求 / 工作项 / 测试 / 文档");
  assert(team.brief.indexOf("团队新增") >= 0, "结论条显示团队汇总：" + team.brief.slice(0, 40) + "…");
  assert(team.members > 0, "成员表有数据（" + team.members + " 人）");
  assert(team.projects > 0, "项目推进表有数据（" + team.projects + " 个项目）");
  assert(team.cards.indexOf("本周完成") >= 0 && team.cards.indexOf("本周发布") >= 0 && team.cards.indexOf("测试与质量") >= 0 && team.cards.indexOf("文档与知识") >= 0 && team.cards.indexOf("成员工作量") >= 0, "关键卡片齐全：" + team.cards.join(" / "));
  assert(team.copyHidden === false && team.copyLabel.indexOf("复制团队周报") === 0, "团队视图提供「复制团队周报」主操作");
  assert(team.aiHidden === true, "团队视图不显示个人 AI 周报入口");
  assert(/到期兑现\s*\d+\s*\/\s*\d+/.test(team.due) && team.dueBtns === 2, "统计脚注显示到期兑现：" + team.due.replace(/\s+/g, " ").slice(0, 40));
  assert(team.trendRows === 3 && team.sparks === 3 && team.trendHead.indexOf("近 4 周") >= 0, "近四周趋势三行带迷你折线：" + team.trendHead.slice(0, 30));
  assert(team.idleCard.indexOf("本周无记录") >= 0, "需要关注含「本周无记录」卡片");
  assert(team.nextHead.indexOf("到期") > 0 && team.nextItems > 0, "需要关注列出" + team.nextHead.slice(0, 12) + "：" + team.nextItems + " 项");
  const report = await evaluate(`import('./js/views/review-team.js').then(m => m.currentTeamReportText())`);
  assert(typeof report === "string" && report.indexOf("团队周回顾") >= 0 && report.indexOf("近 4 周") >= 0 && report.indexOf("口径") >= 0,
    "团队周报可直接复制纯文本（" + String(report || "").length + " 字）");

  /* 接口口径闭合：到期三分类相加、趋势最后一周等于矩阵、无记录数与成员标记一致、下周条目与计数一致 */
  const api = await evaluate(`fetch('./api/review?scope=team&weekOffset=-1').then(r => r.json()).then(j => {
    const d = j.data || j, p = d.pace || {}, tr = d.trend || {}, ri = d.risks || {}, w = (d.stats || {}).workItems || {};
    return { offset: d.weekOffset, dueTotal: p.dueTotal, dueOnTime: p.dueOnTime, dueLate: p.dueLate, dueOpen: p.dueOpen,
             labels: tr.labels || [], created: tr.created || [], completed: tr.completed || [], transitions: tr.transitions || [],
             matrixCompleted: w.completed, idle: ri.idle, idleMembers: (d.members || []).filter(m => m.idle).length,
             nextDue: ri.nextDue, nextItems: (ri.nextItems || []).length };
  })`);
  assert(api.dueTotal === api.dueOnTime + api.dueLate + api.dueOpen,
    "到期三分类闭合：" + api.dueOnTime + " + " + api.dueLate + " + " + api.dueOpen + " = " + api.dueTotal);
  assert(api.labels.length === 4 && new Set(api.labels).size === 4 &&
    api.created.length === 4 && api.completed.length === 4 && api.transitions.length === 4, "近 4 周四个不重复周点");
  assert(api.completed.slice(-1)[0] === api.matrixCompleted, "趋势最后一周完成数等于矩阵：" + api.matrixCompleted);
  assert(api.idle === api.idleMembers, "无记录人数与成员标记一致：" + api.idle);
  assert(api.nextItems === Math.min(5, api.nextDue), "下周到期条目与计数一致：" + api.nextItems + "/" + api.nextDue);

  /* 最早可选周：趋势不得因周界钳位重复同一周 */
  const far = await evaluate(`fetch('./api/review?scope=team&weekOffset=-52').then(r => r.json()).then(j => {
    const d = j.data || j, tr = d.trend || {};
    return { offset: d.weekOffset, labels: tr.labels || [], created: tr.created || [], completed: tr.completed || [], transitions: tr.transitions || [] };
  })`);
  assert(far.offset === -52 && far.labels.length === new Set(far.labels).size &&
    far.created.length === far.labels.length && far.completed.length === far.labels.length && far.transitions.length === far.labels.length,
    "最早可选周趋势周点不重复（" + far.labels.length + " 周）");

  await shot("team-1440");
  await shot("team-full-1440", true);
  await evaluate("(() => { const el = document.querySelector('#reviewTeamView .rv-trend'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()");
  await sleep(350);
  await shot("team-trend-1440");
  await evaluate("(() => { const el = document.getElementById('rvRiskTitle'); if (el) el.scrollIntoView({ block: 'start' }); return true; })()");
  await sleep(350);
  await shot("team-risk-1440");

  /* 到期兑现可下钻 */
  await evaluate(`(() => { document.querySelector('#reviewTeamView [data-rvd="due-late"]').click(); return true; })()`);
  await waitFor("document.querySelector('#reviewTeamView .rv-detail .rv-sd-list, #reviewTeamView .rv-detail .rv-sd-note')", "到期明细", 12000);
  const dueDetail = await evaluate(`(() => {
    const d = document.querySelector("#reviewTeamView .rv-detail");
    return { text: d ? d.textContent.trim().slice(0, 90) : "", on: !!document.querySelector('#reviewTeamView [data-rvd="due-late"][aria-expanded="true"]'),
      controls: !!document.querySelector('#reviewTeamView [data-rvd="due-late"][aria-controls="rvDetailRow"]') && !!document.getElementById("rvDetailRow") };
  })()`);
  assert(dueDetail.on, "到期兑现「延期」可展开明细：" + dueDetail.text);
  assert(dueDetail.controls, "明细按钮 aria-controls 指向展开行");
  await evaluate(`(() => { const b = document.querySelector("#reviewTeamView [data-rvd-close]"); if (b) b.click(); return true; })()`);
  await waitFor("!document.querySelector('#reviewTeamView .rv-detail')", "到期明细收起", 8000);

  if (api.dueOnTime > 0) {
    await evaluate(`(() => { document.querySelector('#reviewTeamView [data-rvd="due-ontime"]').click(); return true; })()`);
    await waitFor("document.querySelectorAll('#reviewTeamView .rv-detail .rv-sd-list li').length > 0", "按期明细", 12000);
    const onTimeDetail = await evaluate(`(() => ({
      items: document.querySelectorAll("#reviewTeamView .rv-detail .rv-sd-list li").length
    }))()`);
    assert(onTimeDetail.items === Math.min(20, api.dueOnTime), "按期明细条数与兑现计数一致：" + onTimeDetail.items + "/" + api.dueOnTime);
    await evaluate(`(() => { const b = document.querySelector("#reviewTeamView [data-rvd-close]"); if (b) b.click(); return true; })()`);
    await waitFor("!document.querySelector('#reviewTeamView .rv-detail')", "按期明细收起", 8000);
  }

  /* 下周到期列表点开真实工作项 */
  const nextOpen = await evaluate(`(() => {
    const b = document.querySelector("#reviewTeamView .rv-next-item");
    if (!b) return false;
    b.click();
    return true;
  })()`);
  assert(nextOpen, "下单周到期条目");
  if (nextOpen) {
    const drawerOn = await waitFor("(() => { const d = document.getElementById('taskDrawer'); return d && d.classList.contains('on') && d.offsetWidth > 0; })()", "下周到期打开抽屉", 15000).catch(() => false);
    assert(drawerOn === true, "下周到期条目打开工作项抽屉");
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if (b) b.click(); return true; })()`);
    await waitFor("(() => { const d = document.getElementById('taskDrawer'); return !d || !d.classList.contains('on'); })()", "关闭抽屉", 8000);
  }

  /* 统计矩阵子项就地展开明细 */
  const bigOpen = await evaluate(`(() => {
    const b = document.querySelector('#reviewTeamView [data-rvd="wi-created"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  assert(bigOpen, "工作项「本周新增」可点击");
  await waitFor("document.querySelector('#reviewTeamView .rv-detail .rv-sd-list, #reviewTeamView .rv-detail .rv-sd-note')", "明细展开", 15000);
  const detail = await evaluate(`(() => {
    const d = document.querySelector("#reviewTeamView .rv-detail");
    return { text: d ? d.textContent.trim().slice(0, 140) : "", items: d ? d.querySelectorAll(".rv-sd-list li").length : 0,
             expanded: document.querySelector('#reviewTeamView [data-rvd="wi-created"]').getAttribute("aria-expanded") };
  })()`);
  assert(detail.items > 0 && detail.expanded === "true", "明细就地展开：" + detail.items + " 条 · " + detail.text.slice(0, 50) + "…");
  await shot("team-detail-1440");
  /* 明细项点开真实工作项抽屉 */
  const opened = await evaluate(`(() => {
    const li = document.querySelector("#reviewTeamView .rv-sd-list li.clickable");
    if (!li) return false;
    li.click();
    return true;
  })()`);
  assert(opened, "明细项可点击");
  if (opened) {
    await waitFor("(() => { const d = document.getElementById('taskDrawer'); return d && (d.classList.contains('on')) && d.offsetWidth > 0; })()", "工作项抽屉", 15000);
    pass("明细项打开工作项抽屉");
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if (b) b.click(); return true; })()`);
    await waitFor("(() => { const d = document.getElementById('taskDrawer'); return !d || !d.classList.contains('on'); })()", "关闭抽屉", 8000);
  }
  await evaluate(`(() => { const b = document.querySelector("#reviewTeamView [data-rvd-close]"); if (b) b.click(); return true; })()`);
  await waitFor("!document.querySelector('#reviewTeamView .rv-detail')", "明细收起", 8000);
  pass("明细可收起");

  /* 角色筛选：开发 */
  await evaluate(`(() => {
    const s = document.getElementById("reviewRole");
    s.value = "dev";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor("document.querySelectorAll('#reviewTeamView .rv-wn').length > 0 && document.getElementById('reviewRole').value === 'dev'", "角色筛选刷新", 20000);
  await sleep(300);
  const roleState = await evaluate(`(() => ({
    sel: document.getElementById("reviewRole").value,
    hint: (document.getElementById("rvMemberHint") || {}).textContent || "",
    names: [...document.querySelectorAll("#reviewTeamView .rv-wn")].map(e => e.textContent.trim())
  }))()`);
  assert(roleState.sel === "dev", "角色筛选选中「开发」");
  assert(roleState.names.length > 0, "开发角色成员仍可见：" + roleState.names.join("、"));
  const roleFoot = await evaluate(`(() => {
    const f = document.querySelector("#reviewTeamView .rv-member-tbl tfoot");
    return { load: f ? f.textContent.includes("按角色过滤") : false,
             pct: f ? f.textContent.includes("%") : false };
  })()`);
  assert(roleFoot.load && !roleFoot.pct, "角色筛选时成员表脚注不冒充全团队负载");
  await shot("team-role-1440");

  /* 切到「我」 */
  await evaluate(`(() => { document.querySelector('#reviewScopeSeg [data-review-scope="me"]').click(); return true; })()`);
  await waitFor("document.getElementById('reviewPersonalView').hidden === false && document.getElementById('reviewTeamView').hidden === true", "切到我的回顾", 15000);
  await waitFor("document.querySelectorAll('#statGrid .stat').length >= 4", "个人统计卡", 20000);
  const me = await evaluate(`(() => ({
    aria: document.querySelector('#reviewScopeSeg [data-review-scope="me"]').getAttribute("aria-pressed"),
    teamAria: document.querySelector('#reviewScopeSeg [data-review-scope="team"]').getAttribute("aria-pressed"),
    roleHidden: document.getElementById("reviewRoleWrap").hidden,
    title: document.getElementById("reviewTitle").textContent.trim(),
    summary: (document.getElementById("summaryText") || {}).textContent || "",
    copyHidden: document.getElementById("btnCopy").parentNode.hidden
  }))()`);
  assert(me.aria === "true" && me.teamAria === "false", "范围切换状态正确");
  assert(me.roleHidden === true, "个人口径隐藏角色筛选");
  assert(me.summary.length > 0, "个人自动总结有内容");
  assert(me.copyHidden === false, "个人视图恢复「复制」菜单");
  await shot("me-1440");

  /* 回到团队并翻到上一周 */
  await evaluate(`(() => { document.querySelector('#reviewScopeSeg [data-review-scope="team"]').click(); return true; })()`);
  await waitFor("document.getElementById('reviewTeamView').hidden === false && document.querySelector('#reviewTeamView .rv-stat-tbl')", "回到团队", 20000);
  const before = await evaluate("document.getElementById('weekLabel').textContent");
  await evaluate(`(() => { document.getElementById("weekPrev").click(); return true; })()`);
  await waitFor(`document.getElementById('weekLabel').textContent !== ${JSON.stringify(before)} && !!document.querySelector('#reviewTeamView .rv-stat-tbl')`, "上一周切换", 20000);
  const after = await evaluate("document.getElementById('weekLabel').textContent");
  assert(before !== after, "翻周更新周界：" + before + " → " + after);

  /* 切换团队 / 我 不得把周次重置回默认周 */
  await evaluate(`(() => { document.querySelector('#reviewScopeSeg [data-review-scope="me"]').click(); return true; })()`);
  await waitFor(`document.getElementById('reviewPersonalView').hidden === false && document.getElementById('weekLabel').textContent === ${JSON.stringify(after)}`, "个人范围保留周", 20000);
  assert(true, "切到「我」保留当前周：" + after);
  await evaluate(`(() => { document.querySelector('#reviewScopeSeg [data-review-scope="team"]').click(); return true; })()`);
  await waitFor(`document.getElementById('reviewTeamView').hidden === false && document.getElementById('weekLabel').textContent === ${JSON.stringify(after)} && !!document.querySelector('#reviewTeamView .rv-stat-tbl')`, "团队范围保留周", 20000);
  assert(true, "切回「团队」保留当前周：" + after);

  /* 空态：切到本周没有事件的项目，再翻到空周 */
  const picked = await evaluate(`(() => {
    const s = document.getElementById("reviewReq");
    const opts = [...s.options];
    const opt = opts.find(o => o.value === "Xkp10") || opts.find(o => o.textContent.indexOf("技术平台") === 0);
    if (!opt) return { value: "", count: opts.length, labels: opts.slice(0, 8).map(o => o.textContent) };
    s.value = opt.value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, count: opts.length };
  })()`);
  assert(!!picked && !!picked.value, "项目筛选可选择「技术平台」" + (picked && picked.value ? "" : "（选项 " + JSON.stringify(picked) + "）"));
  await waitFor("document.getElementById('reviewTitle').textContent.indexOf('技术平台') >= 0", "项目回顾加载", 20000);
  for (let i = 0; i < 6; i++) {
    const isEmpty = await evaluate("!!document.querySelector('#reviewTeamView .rv-bigstate')");
    if (isEmpty) break;
    await evaluate(`(() => { document.getElementById("weekPrev").click(); return true; })()`);
    await sleep(900);
  }
  await waitFor("document.querySelector('#reviewTeamView .rv-bigstate')", "空周空态", 15000);
  const empty = await evaluate(`(() => {
    const el = document.querySelector("#reviewTeamView .rv-bigstate");
    return { text: el ? el.textContent.trim() : "", btn: el ? el.querySelectorAll("button").length : 0,
             statsTable: !!document.querySelector("#reviewTeamView .rv-stat-tbl"),
             copyDisabled: document.getElementById("btnCopy").disabled,
             copyTitle: document.getElementById("btnCopy").title };
  })()`);
  assert(empty.text.indexOf("没有可汇总") >= 0 && empty.btn >= 1 && !empty.statsTable, "空周显示原因 + 操作，不显示 0 值矩阵");
  assert(empty.copyDisabled && empty.copyTitle.length > 0, "空周禁用复制并说明原因：" + empty.copyTitle);
  await shot("team-empty-1440");

  /* 错误态：拦截 /api/review 后刷新，失败不得伪装成空态 */
  await evaluate(`(() => {
    const s = document.getElementById("reviewReq");
    s.value = "";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor("!!document.querySelector('#reviewTeamView .rv-stat-tbl')", "回到全部项目", 20000);
  await call("Network.setBlockedURLs", { urls: ["*api/review?*"] });
  await evaluate("window.dispatchEvent(new CustomEvent('ds:review-refresh')); true");
  await waitFor("document.querySelector('#reviewTeamView .rv-bigstate.err')", "错误态", 15000);
  const errState = await evaluate(`(() => {
    const el = document.querySelector("#reviewTeamView .rv-bigstate.err");
    return { text: el ? el.textContent.trim() : "", retry: !!(el && el.querySelector("[data-rv-retry]")),
             copyDisabled: document.getElementById("btnCopy").disabled,
             copyTitle: document.getElementById("btnCopy").title };
  })()`);
  assert(errState.text.indexOf("加载失败") >= 0 && errState.retry, "接口失败显示错误态与重试，不显示空/健康态");
  assert(errState.copyDisabled && errState.copyTitle.indexOf("失败") >= 0, "错误态禁用复制并说明原因：" + errState.copyTitle);
  await shot("team-error-1440");
  await call("Network.setBlockedURLs", { urls: [] });
  await evaluate(`(() => { const b = document.querySelector("#reviewTeamView [data-rv-retry]"); if (b) b.click(); return true; })()`);
  await waitFor("!!document.querySelector('#reviewTeamView .rv-stat-tbl')", "重试恢复", 20000);
  assert(!(await evaluate("document.getElementById('btnCopy').disabled")), "重试成功恢复复制");
  pass("重试后恢复团队统计");

  const desk = await evaluate(`(() => ({
    docW: document.documentElement.scrollWidth,
    innerW: window.innerWidth
  }))()`);
  assert(desk.docW <= desk.innerW + 1, `1440 页面无横向溢出（${desk.docW}/${desk.innerW}）`);

  /* 390 布局 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate("window.dispatchEvent(new Event('resize')); true");
  await sleep(500);
  const mob = await evaluate(`(() => ({
    docW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    statScrollW: (() => { const el = document.querySelector("#reviewTeamView .rv-scroll"); return el ? el.scrollWidth : 0; })(),
    statClientW: (() => { const el = document.querySelector("#reviewTeamView .rv-scroll"); return el ? el.clientWidth : 0; })(),
    scopeVisible: !document.getElementById("reviewScopeSeg").hidden
  }))()`);
  assert(mob.docW <= mob.innerW + 1, `390 页面无横向溢出（${mob.docW}/${mob.innerW}）`);
  assert(mob.statScrollW > 0, "390 统计矩阵在滚动容器内（" + mob.statScrollW + "px）");
  await shot("team-390");
  await shot("team-390-full", true);
  await evaluate("(() => { const el = document.querySelector('#reviewTeamView .rv-trend'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()");
  await sleep(350);
  await shot("team-390-trend");
  await evaluate("(() => { const el = document.getElementById('rvRiskTitle'); if (el) el.scrollIntoView({ block: 'start' }); return true; })()");
  await sleep(350);
  await shot("team-390-risk");
  await call("Emulation.clearDeviceMetricsOverride", {});

  console.log("");
  const errs = cdp.errors.filter((e) => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（" + errs.join(" | ").slice(0, 500) + "）" : ""));
  const resUnknown = cdp.resourceErrors.filter((t) => /https?:\/\//.test(t));
  assert(resUnknown.length === 0, "无资源加载失败" + (resUnknown.length ? "（" + resUnknown.slice(0, 3).join(" | ") + "）" : ""));
} catch (e) {
  failed++;
  console.log("  ERROR " + e.message);
} finally {
  try { proc.kill("SIGKILL"); } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}
console.log("\n截图：" + (SHOTS.join(", ") || "无"));
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);
