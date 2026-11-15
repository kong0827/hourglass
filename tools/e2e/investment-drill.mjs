/* 投入结构：去重人力卡片与趋势柱两个下钻入口的真 Chrome 验证。
   用法：E2E_BASE=http://127.0.0.1:8094/hourglass node tools/e2e/investment-drill.mjs
   断言：卡片人数与弹层行数一致、成员工时与维度合计一致、成员下钻与月度下钻总额与来源一致、
   空月可点出提示、未来月不可点、键盘可达、无 4xx/控制台错误；产出 1440 与 390 截图。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zcftmwwnrwuon";
const PORT = Number(process.env.CDP_PORT || 9251);
const SHOT_DIR = path.resolve("docs/audit/prototypes/investment-drill-2026-11-15/impl");

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
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    this.reqs = new Map(); this.badResponses = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.requestWillBeSent"){
      this.reqs.set(msg.params.requestId, { method: msg.params.request.method, url: msg.params.request.url });
    }else if(msg.method === "Network.responseReceived"){
      const req = this.reqs.get(msg.params.requestId) || {};
      if(msg.params.response.status >= 400 && (req.url || "").indexOf("/api/") !== -1){
        this.badResponses.push((req.method || "?") + " " + msg.params.response.status + " " + (req.url || msg.params.response.url));
      }
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

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const group = name => console.log("\n[" + name + "]");

fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inv-drill-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let evaluate, waitFor, call, cdp, ws;

try{
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const api = body => evaluate(`(async () => { const { API } = await import("./js/core/api.js"); ${body} })()`);
  const setViewport = (width, height, mobile = false) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const openSheet = async () => {
    const sheet = await waitFor(`(() => {
      const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
      const last = layers[layers.length - 1];
      if(!last || !last.classList.contains("open")) return false;
      return { title: (last.querySelector("h2") || {}).textContent || "", desc: (last.querySelector(".desc") || {}).textContent || "" };
    })()`, "下钻弹层");
    /* 等入场动画结束再截图/量尺寸，否则截到半透明的中间帧 */
    await sleep(400);
    return sheet;
  };
  const clearToasts = async () => {
    await evaluate(`[...document.querySelectorAll(".toast .tclose")].forEach(b => b.click())`);
    await sleep(250);
  };
  const closeTop = async () => {
    await evaluate(`(() => {
      const layers = [...document.querySelectorAll(".modal-layer")];
      const last = layers[layers.length - 1];
      const btn = last && last.querySelector("[data-manager-close],[data-inv-member-close]");
      if(btn){ btn.click(); return true; }
      return false;
    })()`);
    await sleep(300);
  };

  group("登录与进入投入结构");
  await setViewport(1440, 900);
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && !!document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await api(`await API.post("/api/workspaces/" + ${JSON.stringify(WS)} + "/select", {}); return true;`);
  await call("Page.navigate", { url: BASE + "/#/investment" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded && document.body.dataset.view === "investment")`, "进入投入结构", 25000);
  await waitFor(`!!document.querySelector("[data-inv-kpi]") && !!document.querySelector("[data-inv-month]")`, "卡片与趋势柱渲染");
  await shot("overview-1440.png");
  pass("登录 " + USER + " 并进入投入结构");

  const kpiLabels = await evaluate(`[...document.querySelectorAll(".inv-kpi .inv-kl")].map(el => el.textContent.trim())`);
  assert(kpiLabels.some(t => t.indexOf("测试窗口外") === 0) && kpiLabels.some(t => t.indexOf("测试窗口内") === 0),
    "拆分指标按窗口命名，不冒充开发 / 测试：" + kpiLabels.join(" / "));
  assert(!kpiLabels.some(t => /^开发$/.test(t) || /^测试$/.test(t)), "KPI 中没有「开发」「测试」这类岗位含义的标签");
  const composeNote = await evaluate(`(document.querySelector(".inv-compose-note") || {}).textContent || ""`);
  assert(/不等于「开发」/.test(composeNote), "构成说明讲清窗口外包含评审、设计等，不等于开发");

  const parseHours = txt => {
    const s = String(txt || "").trim();
    if(!s || s === "—") return 0;
    const hm = /^(\d+(?:\.\d+)?)h(?:(\d+)m)?$/.exec(s);
    if(hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
    const mm = /^(\d+)m$/.exec(s);
    if(mm) return Number(mm[1]) / 60;
    const bare = parseFloat(s);
    return Number.isFinite(bare) ? bare : 0;
  };
  const sheetRowsInfo = () => evaluate(`(() => {
    const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
    const layer = layers[layers.length - 1];
    const rows = [...layer.querySelectorAll("tbody tr[data-open-task]")];
    return { count: rows.length, minutes: rows.map(tr => {
      const td = tr.querySelectorAll("td");
      return (td[td.length - 3] || {}).textContent || "";
    }) };
  })()`);

  group("去重人力卡片");
  const kpi = await evaluate(`(() => {
    const el = document.querySelector("[data-inv-kpi]");
    return {
      role: el.getAttribute("role"),
      tab: el.getAttribute("tabindex"),
      label: el.getAttribute("aria-label") || "",
      users: Number((el.querySelector(".inv-kv") || {}).textContent.replace(/[^0-9.]/g, "")),
      desc: (el.querySelector(".inv-kd") || {}).textContent || ""
    };
  })()`);
  assert(kpi.role === "button" && kpi.tab === "0", "去重人力卡片可聚焦、按按钮语义暴露");
  assert(/点击查看成员/.test(kpi.desc), "卡片文案给出可点提示");
  assert(kpi.users > 0, "演示数据下有人力可下钻（" + kpi.users + " 人）");
  await click("[data-inv-kpi]");
  let sheet = await openSheet();
  assert(/^去重人力 · /.test(sheet.title), "卡片点开成员弹层：" + sheet.title);
  const people = await evaluate(`(() => {
    const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
    const layer = layers[layers.length - 1];
    const heads = [...layer.querySelectorAll("thead th")].map(th => th.textContent.trim());
    const rows = [...layer.querySelectorAll("tbody tr")].map(tr => {
      const tds = [...tr.querySelectorAll("td")];
      return {
        key: tr.dataset.invMemberDrill,
        name: (tds[0].querySelector("b") || {}).textContent || "",
        meta: (tds[0].querySelector("small") || {}).textContent || "",
        projects: Number(tds[1].textContent),
        tasks: Number(tds[2].textContent),
        actual: parseFloat(tds[3].textContent) || 0
      };
    });
    const sumActual = rows.reduce((s, r) => s + r.actual, 0);
    return { heads, rows, sumActual, foot: (layer.querySelector(".inv-foot") || {}).textContent || "" };
  })()`);
  assert(people.heads.join("|") === "成员|项目|工作项|实际工时|测试窗口外|测试窗口内|预估工时|投入人天", "成员弹层列为 8 列：" + people.heads.join(" / "));
  assert(people.rows.length === kpi.users, "弹层行数与卡片人数一致（" + people.rows.length + "）");
  assert(people.rows.every(r => !!r.key && /u:/.test(r.key)), "成员行带成员键，可继续下钻");
  assert(people.rows.every(r => !!r.meta), "成员行显示公司 / 角色副标题");
  assert(/未指派/.test(people.foot), "弹层脚注说明未指派不计人数");
  const totalActual = await evaluate(`parseFloat(document.querySelectorAll(".inv-kpi .inv-kv")[1].textContent.replace(/[^0-9.]/g, ""))`);
  assert(Math.abs(people.sumActual - totalActual) <= 0.6,
    "成员实际工时之和与总览实际工时一致（" + people.sumActual + " vs " + totalActual + "）");
  await shot("people-sheet-1440.png");

  group("成员行二次下钻");
  const firstName = people.rows[0].name;
  const firstActual = people.rows[0].actual;
  await click("tr[data-inv-member-drill]");
  sheet = await waitFor(`(() => {
    const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
    const last = layers[layers.length - 1];
    if(!last || !/^成员 · /.test((last.querySelector("h2") || {}).textContent || "")) return false;
    return { title: last.querySelector("h2").textContent, desc: (last.querySelector(".desc") || {}).textContent || "" };
  })()`, "成员工作项下钻");
  assert(sheet.title === "成员 · " + firstName, "成员行下钻到工作项：" + sheet.title);
  const memberRaw = await sheetRowsInfo();
  const memberDrill = { count: memberRaw.count, sum: memberRaw.minutes.reduce((s, v) => s + parseHours(v), 0) };
  assert(memberDrill.count > 0, "成员下钻有工作项（" + memberDrill.count + " 项）");
  if(memberDrill.count < 100){
    assert(Math.abs(memberDrill.sum - firstActual) <= 0.6, "成员下钻实际合计与成员行一致（" + memberDrill.sum + " vs " + firstActual + "）");
  }else{
    pass("成员下钻超过单页 100 项，跳过合计断言");
  }
  await shot("member-drill-1440.png");
  await closeTop();

  group("趋势柱");
  const months = await evaluate(`(() => [...document.querySelectorAll("[data-inv-month]")].map(el => ({
    key: el.dataset.invMonth,
    name: (el.querySelector(".inv-lb") || {}).textContent || "",
    value: (el.querySelector(".inv-v") || {}).textContent || "",
    role: el.getAttribute("role"),
    tab: el.getAttribute("tabindex")
  })))()`);
  assert(months.length > 0, "趋势柱带月份键（" + months.length + " 列）");
  assert(months.every(m => m.role === "button" && m.tab === "0"), "趋势柱可聚焦、按按钮语义暴露");
  const future = await evaluate(`(() => [...document.querySelectorAll(".inv-col")].filter(el => !el.dataset.invMonth &&
    (el.querySelector(".inv-cap") || {}).textContent === "未开始").length)()`);
  assert(future > 0, "未来月份不可点（" + future + " 列）");
  const monthPick = months.filter(m => m.value !== "—")[0];
  await click(`[data-inv-month="${monthPick.key}"]`);
  sheet = await waitFor(`(() => {
    const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
    const last = layers[layers.length - 1];
    if(!last || !/投入明细$/.test((last.querySelector("h2") || {}).textContent || "")) return false;
    return { title: last.querySelector("h2").textContent, desc: (last.querySelector(".desc") || {}).textContent || "" };
  })()`, "月度下钻");
  assert(sheet.title === monthPick.name + " · 投入明细", "趋势柱点开该月：" + sheet.title);
  assert(/仅 /.test(sheet.desc) && sheet.desc.indexOf(monthPick.name) !== -1, "月度弹层描述限定到该月：" + sheet.desc);
  const monthRaw = await sheetRowsInfo();
  const monthDrill = { count: monthRaw.count, sum: monthRaw.minutes.reduce((s, v) => s + parseHours(v), 0) };
  assert(monthDrill.count > 0, "月度下钻有工作项（" + monthDrill.count + " 项）");
  if(monthDrill.count < 100){
    assert(Math.abs(monthDrill.sum - parseFloat(monthPick.value)) <= 0.6, "月度下钻实际合计与柱子一致（" + monthDrill.sum + " vs " + monthPick.value + "）");
  }else{
    pass("月度下钻超过单页 100 项，跳过合计断言");
  }
  await shot("month-drill-1440.png");
  await closeTop();

  group("职能维度");
  const dims = await evaluate(`[...document.querySelectorAll("[data-inv-dim]")].map(b => b.dataset.invDim)`);
  assert(dims.indexOf("position") !== -1, "维度切换出现「职能」：" + dims.join(" / "));
  await click('[data-inv-dim="position"]');
  await waitFor(`!!document.querySelector('[data-inv-dim="position"].on') && !!document.querySelector("tr[data-inv-row]")`, "职能维度渲染");
  const positions = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("tr[data-inv-row]")].map(tr => {
      const tds = [...tr.querySelectorAll("td")];
      return { name: (tds[0].querySelector("b") || {}).textContent || "",
        actual: parseFloat(tds[1].textContent) || 0 };
    });
    return {
      head: (document.querySelector(".inv-tbl thead th") || {}).textContent.trim(),
      rows,
      foot: (document.querySelector(".inv-foot") || {}).textContent || ""
    };
  })()`);
  assert(positions.head.indexOf("职能") === 0, "维度表首列表头为「职能」：" + positions.head);
  assert(positions.rows.length > 0, "职能维度有分组行（" + positions.rows.length + " 组）");
  assert(positions.rows.every(r => !/^开发$|^测试$/.test(r.name)), "职能分组按岗位命名，不把研发 / 测试当职能");
  const pmRow = positions.rows.filter(r => /产品|设计|运营|运维/.test(r.name))[0];
  assert(!!pmRow, "非研发岗位能出现在职能维度（" + positions.rows.map(r => r.name).join(" / ") + "）");
  await shot("position-1440.png");
  if(pmRow){
    await evaluate(`(() => {
      const tr = [...document.querySelectorAll("tr[data-inv-row]")].filter(x =>
        ((x.querySelector("td b") || {}).textContent || "") === ${JSON.stringify(pmRow.name)})[0];
      tr.click();
      return true;
    })()`);
    sheet = await waitFor(`(() => {
      const layers = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet"));
      const last = layers[layers.length - 1];
      if(!last || !last.classList.contains("open") || !/^职能 · /.test((last.querySelector("h2") || {}).textContent || "")) return false;
      return { title: last.querySelector("h2").textContent, desc: (last.querySelector(".desc") || {}).textContent || "" };
    })()`, "职能下钻");
    await sleep(400);
    assert(sheet.title === "职能 · " + pmRow.name, "职能行下钻到工作项：" + sheet.title);
    const posRaw = await sheetRowsInfo();
    const posSum = posRaw.minutes.reduce((s, v) => s + parseHours(v), 0);
    assert(posRaw.count > 0, "职能下钻有工作项（" + posRaw.count + " 项）");
    if(posRaw.count < 100){
      assert(Math.abs(posSum - pmRow.actual) <= 0.6, "职能下钻实际合计与分组行一致（" + posSum + " vs " + pmRow.actual + "）");
    }else{
      pass("职能下钻超过单页 100 项，跳过合计断言");
    }
    await shot("position-drill-1440.png");
    await closeTop();
  }
  await click('[data-inv-dim="project"]');
  await waitFor(`!!document.querySelector('[data-inv-dim="project"].on')`, "切回项目维度");

  group("空月与键盘");
  const emptyKey = await evaluate(`(() => {
    const el = [...document.querySelectorAll("[data-inv-month]")].filter(x =>
      (x.querySelector(".inv-cap") || {}).textContent === "无记录")[0];
    return el ? el.dataset.invMonth : "";
  })()`);
  if(emptyKey){
    await click(`[data-inv-month="${emptyKey}"]`);
    const toasted = await waitFor(`(() => {
      const t = [...document.querySelectorAll(".toast,.toast-item,.toast-wrap *")].map(n => n.textContent || "").join(" ");
      return /该月没有可下钻的投入记录/.test(t) ? t : false;
    })()`, "空月提示", 5000).catch(() => false);
    assert(!!toasted, "空月点击给出「没有可下钻记录」提示");
  }else{
    pass("季度内没有空月柱，切年度模式再验空月提示");
  }
  await click('[data-inv-mode="year"]');
  await waitFor(`(() => {
    const on = document.querySelector('[data-inv-mode="year"].on');
    const cols = document.querySelectorAll("[data-inv-month]");
    return !!on && cols.length >= 10;
  })()`, "年度模式渲染");
  const yearEmpty = await evaluate(`(() => {
    const el = [...document.querySelectorAll("[data-inv-month]")].filter(x =>
      (x.querySelector(".inv-cap") || {}).textContent === "无记录")[0];
    return el ? el.dataset.invMonth : "";
  })()`);
  assert(!!yearEmpty, "年度模式存在可点的空月柱（" + (yearEmpty || "无") + "）");
  if(yearEmpty){
    await click(`[data-inv-month="${yearEmpty}"]`);
    const toastText = await waitFor(`(() => {
      const t = [...document.querySelectorAll(".toast")].map(n => n.textContent || "").join(" ");
      return /该月没有可下钻的投入记录/.test(t) ? t : false;
    })()`, "空月提示", 6000).catch(() => false);
    assert(!!toastText, "空月点击给出「没有可下钻记录」提示，不打开空弹层");
    const leftover = await evaluate(`[...document.querySelectorAll(".modal-layer.open .sheet h2")].map(h => h.textContent)`);
    assert(leftover.length === 0, "空月点击未打开弹层（残留：" + JSON.stringify(leftover) + "）");
  }
  await click('[data-inv-mode="quarter"]');
  await waitFor(`!!document.querySelector('[data-inv-mode="quarter"].on') && !!document.querySelector("[data-inv-kpi]")`, "切回季度模式");
  const keyed = await evaluate(`(() => {
    const el = document.querySelector("[data-inv-kpi]");
    el.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return document.activeElement === el;
  })()`);
  assert(keyed, "去重人力卡片可获得键盘焦点");
  sheet = await openSheet();
  assert(/^去重人力 · /.test(sheet.title), "键盘回车打开成员弹层");
  await closeTop();

  group("移动端 390");
  /* 空月提示还在屏上会盖住卡片，等它消失或直接点掉再截移动端 */
  await clearToasts();
  await setViewport(390, 844, true);
  await sleep(500);
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  assert(overflow <= 1, "390 宽度无横向溢出（溢出 " + overflow + "px）");
  await shot("overview-390.png");
  await click("[data-inv-kpi]");
  sheet = await openSheet();
  assert(/^去重人力 · /.test(sheet.title), "移动端成员弹层可打开");
  const sheetOverflow = await evaluate(`(() => {
    const layer = [...document.querySelectorAll(".modal-layer")].filter(l => l.querySelector(".sheet")).pop();
    const wrap = layer.querySelector(".tbl-wrap");
    return { sheetW: layer.querySelector(".sheet").getBoundingClientRect().width,
      viewW: window.innerWidth,
      wrapW: wrap ? wrap.clientWidth : 0, tableW: wrap ? wrap.scrollWidth : 0,
      scrollable: wrap ? getComputedStyle(wrap).overflowX !== "visible" : false };
  })()`);
  assert(sheetOverflow.sheetW <= sheetOverflow.viewW, "移动端弹层不超出视口");
  assert(sheetOverflow.tableW <= sheetOverflow.wrapW || sheetOverflow.scrollable,
    "移动端宽表在弹层内横向滚动，不裁掉列（" + sheetOverflow.tableW + " vs " + sheetOverflow.wrapW + "）");
  await shot("people-sheet-390.png");
  await closeTop();

  group("收尾");
  assert(cdp.badResponses.length === 0, "无 4xx/5xx 接口（" + (cdp.badResponses.join(" | ") || "0") + "）");
  assert(cdp.errors.length === 0, "无控制台错误（" + (cdp.errors.join(" | ") || "0") + "）");
  console.log("\n结果：PASS " + passed + " / FAIL " + failed);
  if(failed) process.exitCode = 1;
}catch(e){
  console.error("\n执行失败：" + e.message);
  process.exitCode = 1;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
