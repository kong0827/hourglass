/* 「我的工作」多角色页签走查（真 Chrome + 本地栈）
   用法：node tools/e2e/my-work-tabs.mjs
   覆盖：三页签 + 移动端团队页签、结论条、工具条、空/筛选空态、390 溢出与触控尺寸。
   产物：docs/audit/my-work-redesign-2026-11-20/e2e-*.png */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/my-work-redesign-2026-11-20");
fs.mkdirSync(OUT, { recursive: true });

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mine-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage",
  "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
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
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
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
  const login = async () => {
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
    try{
      await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);
    }catch(e){
      const info = await evaluate(`({ view: document.body && document.body.dataset.view, url: location.href, ws: !!window.CURRENT_WORKSPACE, err: document.querySelector(".app-error") ? document.querySelector(".app-error").textContent : "" })`);
      console.log("  DEBUG " + JSON.stringify(info));
      console.log("  DEBUG errors: " + cdp.errors.slice(0, 6).join(" || "));
      throw e;
    }
  };
  const mineSnapshot = () => evaluate(`(() => {
    const q = s => document.querySelector(s);
    const tabs = [...document.querySelectorAll("#mineTabs .mw-tab")].map(b => ({
      key: b.dataset.tab, text: b.textContent.trim(), selected: b.getAttribute("aria-selected") === "true",
      w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height)
    }));
    const secs = [...document.querySelectorAll("#mineBody .mw-sec")].map(s => ({
      title: (s.querySelector(".mw-stitle") || {}).textContent || "",
      count: (s.querySelector(".mw-scount") || {}).textContent || "",
      rows: s.querySelectorAll(".mw-row").length
    }));
    const big = q("#mineBody .mw-bigstate");
    return {
      view: document.body.dataset.view,
      tabs, secs,
      brief: (q("#mineBrief") || {}).textContent || "",
      briefHidden: !q("#mineBrief") || q("#mineBrief").hidden,
      toolbarHidden: !q("#mineToolbar") || q("#mineToolbar").hidden,
      chips: [...document.querySelectorAll("#mineChips .mw-chip")].map(b => b.textContent.trim()),
      rows: document.querySelectorAll("#mineBody .mw-row").length,
      big: big ? { cls: big.className, title: (big.querySelector("h3") || {}).textContent || "" } : null,
      sub: (document.getElementById("pageSub") || {}).textContent || "",
      noteHidden: !q("#mineNote") || q("#mineNote").hidden,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  })()`);

  console.log("「我的工作」页签走查\n  地址：" + BASE);
  await setViewport(1440, 900, false);
  await login();

  /* ---------- 1440 ---------- */
  await openView("mine");
  await waitFor(`document.querySelectorAll("#mineTabs .mw-tab").length >= 3`, "页签渲染");
  await waitFor(`!document.querySelector("#mineBody .mw-sk") || !!document.querySelector("#mineBody .mw-bigstate") || document.querySelectorAll("#mineBody .mw-sec").length > 0`, "列表或状态", 25000);
  await sleep(500);
  let snap = await mineSnapshot();
  assert(snap.tabs.length === 3, "桌面只有三个个人页签（实际 " + snap.tabs.length + "）");
  assert(snap.tabs.every(t => /\d/.test(t.text) || t.text.indexOf("—") >= 0), "页签带服务端计数：" + snap.tabs.map(t => t.text).join(" / "));
  assert(snap.tabs.filter(t => t.selected).length === 1, "同一时刻只有一个选中页签");
  assert(!snap.briefHidden || !!snap.big, "结论条在数据态可见");
  assert(snap.toolbarHidden === (!!snap.big), "数据态显示工具条，整页空/错时隐藏");
  assert(snap.sub.indexOf(" · ") > 0, "页头副标题含身份与结论：" + snap.sub);
  console.log("  默认页签：" + (snap.tabs.filter(t => t.selected)[0] || {}).text);
  console.log("  分区：" + snap.secs.map(s => s.title + "(" + s.rows + ")").join(" / "));
  console.log("  结论：" + snap.brief.replace(/\\s+/g, " ").trim().slice(0, 120));
  await shot("e2e-pending-1440-v1.png");
  if(process.env.PROBE){
    const probe = await evaluate(`(async () => {
      const c = await (await fetch("./api/my-work/counts", {credentials:"same-origin"})).json();
      const t = await (await fetch("./api/my-tasks?view=pending&scope=open&offset=0&limit=100", {credentials:"same-origin"})).json();
      const d = await (await fetch("./api/my-demands?view=review&offset=0&limit=100", {credentials:"same-origin"})).json();
      return { counts: c.data, tasks: {total: t.data.total, n: t.data.items.length, sample: t.data.items.slice(0,3).map(x=>({id:x.id,owner:x.owner,ownerUserId:x.ownerUserId,testOwnerUserId:x.testOwnerUserId,col:x.boardColumn}))}, review: {total: d.data.total, n: d.data.items.length} };
    })()`);
    console.log("  PROBE " + JSON.stringify(probe, null, 1).slice(0, 2000));
  }

  /* 关注：真实写入两条关注 → 行内取消 → 撤销恢复 */
  const ids = await evaluate(`(async () => {
    const t = await (await fetch("./api/my-tasks?view=pending&scope=open&offset=0&limit=20", {credentials:"same-origin"})).json();
    const d = await (await fetch("./api/my-demands?view=review&offset=0&limit=20", {credentials:"same-origin"})).json();
    const task = (t.data.items || [])[0];
    const demand = (d.data.items || [])[0];
    const tok = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const post = (url) => fetch(url, {method:"POST", credentials:"same-origin", headers:{"X-XSRF-TOKEN": decodeURIComponent(tok), "Content-Type":"application/json"}, body:"{}"});
    if(task) await post("./api/tasks/" + encodeURIComponent(task.id) + "/watch?workspace=" + encodeURIComponent(task.workspaceId));
    if(demand) await post("./api/demands/" + encodeURIComponent(demand.id) + "/watch");
    return { task: task ? task.id : "", ws: task ? task.workspaceId : "", demand: demand ? demand.id : "" };
  })()`);
  assert(!!ids.task && !!ids.demand, "已写入一条工作项与一条需求关注");
  await evaluate(`document.querySelector('#mineTabs [data-tab="watched"]').click()`);
  await waitFor(`document.querySelector('#mineTabs [data-tab="watched"]').getAttribute("aria-selected") === "true"`, "切到我关注的");
  await waitFor(`document.querySelectorAll("#mineBody .mw-row.mw-g-watch").length >= 2`, "关注列表行", 15000);
  snap = await mineSnapshot();
  assert(snap.rows >= 2, "关注列表合并工作项与需求（" + snap.rows + " 行）");
  const watchRows = await evaluate(`[...document.querySelectorAll("#mineBody .mw-row.mw-g-watch")].map(r => ({
    tags: [...r.querySelectorAll(".vtag")].map(v => v.textContent.trim()),
    title: (r.querySelector(".mw-ttl") || {}).textContent || "",
    unwatch: !!r.querySelector("[data-unwatch]"),
    cols: r.children.length
  }))`);
  assert(watchRows.every(r => r.unwatch), "每条关注行都有行内「取消关注」");
  assert(watchRows.length >= 2 && watchRows[0].cols === 5, "关注行五列（事项/状态/所属项目/版本/更新时间）");
  console.log("  关注行：" + watchRows.slice(0, 3).map(r => r.tags.join("+") + " " + r.title).join(" / "));
  await shot("e2e-watched-1440-v1.png");

  const before = watchRows.length;
  await evaluate(`document.querySelector("#mineBody [data-unwatch]").click()`);
  await waitFor(`document.querySelectorAll("#mineBody .mw-row.mw-g-watch").length === ${before - 1}`, "取消关注后少一行", 12000);
  const undo = await evaluate(`(() => { const b = document.querySelector("#toastWrap .toast .tact"); if(b){ const t = b.textContent; b.click(); return t; } return ""; })()`);
  assert(undo === "撤销", "取消关注给 8 秒「撤销」");
  await waitFor(`document.querySelectorAll("#mineBody .mw-row.mw-g-watch").length === ${before}`, "撤销后恢复一行", 15000);
  pass("撤销后关注恢复");

  /* 我发起的 */
  await evaluate(`document.querySelector('#mineTabs [data-tab="created"]').click()`);
  await waitFor(`document.querySelector('#mineTabs [data-tab="created"]').getAttribute("aria-selected") === "true"`, "切到我发起的");
  await sleep(900);
  snap = await mineSnapshot();
  assert(!snap.toolbarHidden || !!snap.big, "我发起的：工具条随状态显示");
  assert(snap.chips.length >= 4, "我发起的：状态 chips（" + snap.chips.join(" / ") + "）");
  console.log("  我发起的：rows=" + snap.rows + " big=" + (snap.big ? snap.big.title : "无"));
  await shot("e2e-created-1440-v1.png");

  /* 我关注的：列头（行内取消已在上一步验证） */
  await evaluate(`document.querySelector('#mineTabs [data-tab="watched"]').click()`);
  await waitFor(`document.querySelector('#mineTabs [data-tab="watched"]').getAttribute("aria-selected") === "true"`, "切到我关注的");
  await sleep(600);
  const watchCols = await evaluate(`[...document.querySelectorAll("#mineBody .mw-thead span")].map(s => s.textContent)`);
  if(watchCols.length) assert(watchCols.join("/") === "事项/状态/所属项目/版本/更新时间", "关注列头：" + watchCols.join("/"));

  /* 搜索无结果 → 筛选空态 → 清除 */
  await evaluate(`(() => {
    const i = document.getElementById("mineSearch");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), "value").set.call(i, "__e2e_no_match__");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const filtered = await mineSnapshot();
  if(filtered.rows === 0 && !filtered.big){
    assert(filtered.big && filtered.big.title.indexOf("没有事项") >= 0, "搜索无结果显示筛选空态");
  }else{
    assert(filtered.rows === 0, "搜索无结果时列表为空");
    assert(!!filtered.big, "搜索无结果时给出空态：" + (filtered.big || {}).title);
  }
  await evaluate(`document.querySelector("[data-clear-filter]") && document.querySelector("[data-clear-filter]").click()`);
  await sleep(400);

  /* ---------- 390 ---------- */
  await setViewport(390, 844, true);
  await call("Page.reload", { ignoreCache: true });
  await waitFor(`document.body && document.body.dataset.layout === "mobile"`, "移动端布局", 25000);
  await waitFor(`document.querySelectorAll("#mineTabs .mw-tab").length >= 4`, "移动端页签", 25000);
  await evaluate(`document.querySelector('#mineTabs [data-tab="pending"]').click()`);
  await waitFor(`document.querySelector('#mineTabs [data-tab="pending"]').getAttribute("aria-selected") === "true"`, "移动端默认待我处理");
  await sleep(800);
  snap = await mineSnapshot();
  assert(snap.tabs.length === 4 && snap.tabs.some(t => t.key === "team"), "移动端负责人/管理员看到「团队」页签");
  assert(snap.overflow <= 1, "390 默认页签无横向溢出（" + snap.overflow + "px）");
  const touch = await evaluate(`(() => {
    const b = document.querySelector("#mineTabs .mw-tab");
    const c = document.querySelector("#mineChips .mw-chip") || document.querySelector("#btnMineRefresh");
    return { tab: b ? Math.round(b.getBoundingClientRect().height) : 0, chip: c ? Math.round(c.getBoundingClientRect().height) : 0 };
  })()`);
  assert(touch.tab >= 44, "页签触控高度 ≥44（" + touch.tab + "）");
  assert(touch.chip >= 44, "chips / 刷新触控高度 ≥44（" + touch.chip + "）");
  await shot("e2e-pending-390-v1.png");

  await evaluate(`document.querySelector('#mineTabs [data-tab="team"]').click()`);
  await waitFor(`document.querySelector('#mineTabs [data-tab="team"]').getAttribute("aria-selected") === "true"`, "切到团队");
  await waitFor(`!!document.querySelector("#mineBody .team-panel") || !!document.querySelector("#mineBody .mw-bigstate")`, "团队内容", 25000);
  await sleep(500);
  const team = await evaluate(`(() => {
    const panel = document.querySelector("#mineBody .team-panel");
    const range = panel && panel.querySelector(".rangebar");
    const btns = range ? [...range.querySelectorAll(".tr-btn")] : [];
    const rects = btns.map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: b.textContent.trim() }; });
    return {
      panel: !!panel,
      big: (document.querySelector("#mineBody .mw-bigstate h3") || {}).textContent || "",
      bits: [...document.querySelectorAll("#mineBody .team-card h3")].map(h => h.textContent.trim()),
      range: rects,
      dates: range ? (range.querySelector(".range-dates") || {}).textContent || "" : "",
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      note: (document.querySelector("#mineBody .mw-note") || {}).textContent || ""
    };
  })()`);
  assert(team.panel || team.big, "团队页签有内容或可读空/错态");
  if(team.panel){
    assert(team.range.length === 3 && team.range.every(r => r.h >= 44), "范围条三档按钮高度 ≥44（" + team.range.map(r => r.h).join("/") + "）");
    assert(team.range.every(r => r.w > r.h), "范围条按钮横排，无竖排文字（" + team.range.map(r => r.w + "x" + r.h).join(" / ") + "）");
    assert(!!team.dates, "范围条单独一行显示日期：" + team.dates);
    assert(team.bits.length >= 3, "团队分区：" + team.bits.join(" / "));
  }
  assert(team.overflow <= 1, "390 团队页无横向溢出（" + team.overflow + "px）");
  await shot("e2e-team-390-v1.png");

  /* 清理本次写入的关注，保持演示库原状 */
  try{
    await evaluate(`(async () => {
      const tok = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
      const h = {"X-XSRF-TOKEN": decodeURIComponent(tok)};
      if(${JSON.stringify(ids.task)} && ${JSON.stringify(ids.ws)}){
        await fetch("./api/tasks/" + encodeURIComponent(${JSON.stringify(ids.task)}) + "/watch?workspace=" + encodeURIComponent(${JSON.stringify(ids.ws)}), {method:"DELETE", credentials:"same-origin", headers:h});
      }
      if(${JSON.stringify(ids.demand)}){
        await fetch("./api/demands/" + encodeURIComponent(${JSON.stringify(ids.demand)}) + "/watch", {method:"DELETE", credentials:"same-origin", headers:h});
      }
      return true;
    })()`);
    console.log("  已清理测试关注");
  }catch(e){ console.log("  WARN 清理关注失败：" + e.message); }

  if(cdp.errors.length){
    failed++;
    console.log("  FAIL 控制台错误 " + cdp.errors.length + " 条");
    cdp.errors.slice(0, 8).forEach(e => console.log("    " + e.slice(0, 220)));
  }else pass("无控制台错误");
}catch(err){
  failed++;
  console.log("  ERROR " + (err && err.stack || err));
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){ /* noop */ }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){ /* noop */ }
}
console.log(failed ? ("\n失败 " + failed + " 项") : "\n全部通过");
process.exit(failed ? 1 : 0);
