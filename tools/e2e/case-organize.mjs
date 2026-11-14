/* 用例查询批次A + 目录归类 + 自定义分组 + 按筛选圈选 + 批次C（动态分组 / 指定成员可见 / 统计 chips 即筛选）：真 Chrome 端到端验证。
   用法：E2E_BASE=http://127.0.0.1:8096/hourglass node tools/e2e/case-organize.mjs
   在演示空间里选用例最多的项目，只新建带「E2E归类」前缀的目录/分组/计划，finally 全部清理，
   并把被拖动改过的归属与优先级还原回基线，收尾断言无残留。
   产出 1440 / 900 / 390 截图到 docs/audit/prototypes/testcase-query-2026-11-14/impl。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const SHOT_DIR = path.resolve("docs/audit/prototypes/testcase-query-2026-11-14/impl");
const PREFIX = "E2E归类";
const WS = process.env.E2E_WS || "Smw9zcftmwwnrwuon";
const PORT = Number(process.env.CDP_PORT || 9241);

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
    this.reqs = new Map(); this.calls = []; this.badResponses = [];
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
      if(msg.params.request.url.indexOf("/api/") !== -1) this.calls.push(msg.params.request.method + " " + msg.params.request.url);
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-organize-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let reqId = "", baseline = null;
const created = { sets: [], nodes: [], plans: [] };
let evaluate = null, api = null, waitFor = null, call = null, cdp = null, ws = null;

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
  api = body => evaluate(`(async () => { const { API } = await import("./js/core/api.js"); ${body} })()`);
  const setViewport = (width, height, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const setSelect = (id, value) => evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if(!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  const setInput = (sel, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if(!el) return false;
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const openView = async view => {
    const ok = await evaluate(`(() => {
      const n = document.querySelector('.nav-item[data-view=${JSON.stringify(view)}]');
      if(!n) return false; n.click(); return true;
    })()`);
    if(!ok) throw new Error("找不到侧栏入口：" + view);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, "切换到 " + view);
  };
  /* 提示框是运行时 append 的 form：取最后一个打开的弹层提交 */
  const submitPrompt = async value => {
    await waitFor(`!!document.querySelector(".modal-layer.open form input")`, "提示框输入");
    await evaluate(`(() => {
      const layers = [...document.querySelectorAll(".modal-layer.open")];
      const form = layers[layers.length - 1].querySelector("form");
      const input = form.querySelector("input,textarea");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    })()`);
    await sleep(1000);
  };
  const confirmInfo = () => evaluate(`(() => {
    const m = document.getElementById("dlgConfirm");
    return {
      title: (m.querySelector("#dlgConfirmTitle")||{}).textContent || "",
      msg: (m.querySelector("#dlgConfirmMsg")||{}).textContent || "",
      arrow: !!m.querySelector(".tc-move-arrow"),
      from: (m.querySelector(".tc-move-arrow .from")||{}).textContent || "",
      to: (m.querySelector(".tc-move-arrow .to")||{}).textContent || "",
      notes: [...m.querySelectorAll(".tc-move-notes li")].map(li => li.textContent.trim()),
      preview: (m.querySelector(".tc-move-preview")||{}).textContent || "",
      ok: (m.querySelector("#dlgConfirmOk")||{}).textContent || ""
    };
  })()`);
  const confirmOk = async () => {
    await waitFor(`document.getElementById("dlgConfirm").classList.contains("open")`, "确认框");
    const info = await confirmInfo();
    await click("#dlgConfirmOk");
    await sleep(1400);
    return info;
  };
  const dragTo = (rowSel, targetSel) => evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(rowSel)});
    const tgt = document.querySelector(${JSON.stringify(targetSel)});
    if(!row || !tgt) return { error: "missing", row: !!row, tgt: !!tgt };
    const dt = new DataTransfer();
    /* Chrome 对合成 DataTransfer 的 dropEffect 写入一律丢弃（读回恒为 none），
       所以挂一个自有访问器把产品代码写入的值录下来，断言的是落点语义而非浏览器回执 */
    let effect = "";
    Object.defineProperty(dt, "dropEffect", { configurable: true, get: () => effect, set: v => { effect = v; } });
    row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const dragging = row.classList.contains("is-dragging");
    tgt.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const marked = tgt.classList.contains("drop-on");
    const banner = (document.getElementById("tcDropBanner")||{}).textContent || "";
    tgt.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { dragging, marked, banner, effect };
  })()`);
  const toastText = () => evaluate(`[...document.querySelectorAll("#toastWrap .toast .tmsg")].map(e => e.textContent.trim()).join(" | ")`);
  const clickToastAction = async label => {
    const ok = await evaluate(`(() => {
      const b = [...document.querySelectorAll("#toastWrap .toast button.tact")].find(x => x.textContent.trim() === ${JSON.stringify(label)});
      if(!b) return false; b.click(); return true;
    })()`);
    await sleep(1500);
    return ok;
  };
  const segInfo = () => evaluate(`[...document.querySelectorAll("#tcList .tc-seg")].map(s => ({
    key: s.dataset.tcSegDrop,
    name: (s.querySelector(".tc-seg-name")||{}).textContent || "",
    count: (s.querySelector(".tc-seg-count")||{}).textContent || "",
    empty: s.classList.contains("is-empty"),
    bar: !!s.querySelector(".tc-seg-bar"),
    legend: (s.querySelector(".tc-seg-legend")||{}).textContent || "",
    hint: (s.querySelector(".tc-seg-hint")||{}).textContent || "",
    rows: s.querySelectorAll(".tc-row").length,
    more: !!s.querySelector("[data-tc-seg-more]"),
    expanded: (s.querySelector(".tc-seg-toggle")||{}).getAttribute("aria-expanded")
  }))`);
  const caseOf = id => api(`const r = await API.get("/api/test-cases", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
    return ((r && r.items) || []).find(c => c.id === ${JSON.stringify(id)}) || null;`);
  const setOf = id => api(`const r = await API.get("/api/case-sets", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(s => s.id === ${JSON.stringify(id)}) || null;`);

  console.log("用例归类端到端验证\n  地址：" + BASE);
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && !!document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  /* 空间选择按账号持久化：别的套件切走后这里会落在错误空间，先固定回演示空间 */
  await api(`await API.post("/api/workspaces/" + ${JSON.stringify(WS)} + "/select", {}); return true;`);
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切到演示空间", 25000);
  pass("登录 " + USER);

  const picked = await api(`
    const reqs = await API.get("/api/reqs", { limit: 200 });
    const list = (reqs && (reqs.items || reqs)) || [];
    let best = null;
    for(const r of list){
      if(r.archivedAt) continue;
      const st = await API.get("/api/test-cases/stats", { reqId: r.id });
      const total = (st && st.total) || 0;
      if(total > 0 && (!best || total > best.total)) best = { id: r.id, name: r.name, total };
    }
    return best;
  `);
  if(!picked) throw new Error("演示空间里没有带用例的项目");
  reqId = picked.id;
  console.log("  项目：" + picked.name + "（" + picked.total + " 条用例）");

  await openView("testcases");
  await waitFor(`!!document.getElementById("tcReq")`, "用例页");
  await setSelect("tcReq", reqId);
  await waitFor(`document.querySelectorAll("#tcList .tc-row").length > 0`, "用例行");
  await sleep(900);

  baseline = await api(`
    const reqId = ${JSON.stringify(reqId)};
    const arr = x => (x && (x.items || x)) || [];
    const mods = await API.get("/api/test-modules", { reqId });
    const sets = await API.get("/api/case-sets", { reqId });
    const plans = await API.get("/api/test-plans", { reqId, limit: 200 });
    const cases = await API.get("/api/test-cases", { reqId, limit: 200 });
    return {
      nodes: arr(mods).map(n => ({ id: n.id, name: n.name, parentId: n.parentId || null, level: n.level, caseCount: n.caseCount || 0 })),
      sets: arr(sets).map(s => ({ id: s.id, name: s.name, caseCount: s.caseCount || 0 })),
      plans: arr(plans).map(p => ({ id: p.id, name: p.name })),
      cases: arr(cases).map(c => ({ id: c.id, moduleId: c.moduleId || null, priority: c.priority || null })),
      total: (cases && cases.total) || arr(cases).length
    };
  `);
  pass("基线快照：目录 " + baseline.nodes.length + " / 分组 " + baseline.sets.length
    + " / 计划 " + baseline.plans.length + " / 用例 " + baseline.cases.length);

  /* ---------------- A 查询条 ---------------- */
  group("A 查询条：排序 / 分组 / 每页 / 全选筛选结果");
  const bar = await evaluate(`(() => {
    const b = document.getElementById("tcQueryBar");
    return {
      hidden: b.hidden,
      ids: [...b.querySelectorAll("[id]")].map(e => e.id),
      sorts: [...document.getElementById("tcSort").options].map(o => o.value),
      dims: [...document.getElementById("tcGroupBy").options].map(o => o.textContent),
      pages: [...document.getElementById("tcPageSize").options].map(o => o.value),
      selTitle: document.getElementById("tcSelFiltered").title
    };
  })()`);
  assert(!bar.hidden, "查询条在用例页可见");
  assert(bar.ids[0] === "tcPanelBtn", "查询条首个控件是「目录 / 分组」入口");
  assert(JSON.stringify(bar.sorts) === JSON.stringify(["created","updated","executed","no","pri","module","status"]), "排序字段 7 项且顺序固定");
  assert(bar.dims.length === 7 && bar.dims[0] === "不分组" && bar.dims[6] === "自定义分组", "分组维度 7 项（含不分组与自定义分组）");
  assert(JSON.stringify(bar.pages) === JSON.stringify(["50","100","200"]), "每页 50 / 100 / 200");
  assert(bar.selTitle.indexOf("2000") !== -1, "全选筛选结果标注单次事务上限 2000");

  cdp.calls.length = 0;
  await setSelect("tcSort", "no");
  await sleep(1000);
  assert(cdp.calls.some(u => u.indexOf("/api/test-cases?") !== -1 && u.indexOf("sort=no") !== -1), "排序落到请求参数 sort=no");
  await click("#tcSortDir");
  await sleep(1000);
  assert(cdp.calls.some(u => u.indexOf("sortDir=asc") !== -1), "升降序落到请求参数 sortDir=asc");
  cdp.calls.length = 0;
  await setSelect("tcPageSize", "50");
  await sleep(1000);
  assert(cdp.calls.some(u => u.indexOf("limit=50") !== -1), "每页条数落到请求参数 limit=50");
  await setSelect("tcPageSize", "100");
  await setSelect("tcSort", "created");
  await click("#tcSortDir");
  await sleep(1000);

  /* ---------------- B 模块目录面板 ---------------- */
  group("B 模块目录：面板 / 搜索 / 含子目录 / 增删改 / 层级不限");
  await click("#tcPanelBtn");
  await waitFor(`!document.getElementById("tcSidePanel").hidden`, "目录面板展开");
  await sleep(600);
  const side = await evaluate(`(() => ({
    expanded: document.getElementById("tcPanelBtn").getAttribute("aria-expanded"),
    hasSide: document.getElementById("tcCasesWrap").classList.contains("has-side"),
    dirSelected: document.getElementById("tcSideTabDir").getAttribute("aria-selected"),
    labelledby: document.getElementById("tcSideBody").getAttribute("aria-labelledby"),
    rows: [...document.querySelectorAll("#tcDirList .tc-dir-node")].map(n => ({
      id: n.dataset.tcDir || null,
      name: (n.querySelector(".tc-dir-name")||{}).textContent,
      n: (n.querySelector(".tc-dir-n")||{}).textContent,
      lv: [...n.classList].filter(c => c.indexOf("lv") === 0)[0],
      special: n.classList.contains("special")
    })),
    note: (document.querySelector("#tcSideFoot .tc-side-note")||{}).textContent || ""
  }))()`);
  assert(side.expanded === "true" && side.hasSide, "面板按钮 aria-expanded 与 has-side 同步");
  assert(side.dirSelected === "true" && side.labelledby === "tcSideTabDir", "目录页签选中且 tabpanel labelledby 正确");
  assert(side.rows[0].name === "全部用例" && side.rows[side.rows.length - 1].name === "未归类", "目录首行「全部用例」、末行「未归类」");
  assert(side.rows[0].id === null, "「全部用例」不是放置目标（无 data-tc-dir）");
  assert(side.rows[side.rows.length - 1].id === "__none", "「未归类」是放置目标");
  assert(side.note.indexOf("单归属") !== -1 && side.note.indexOf("目录层级不限") !== -1, "脚注交代单归属与层级不限");
  const noneCount = Number(side.rows[side.rows.length - 1].n);
  const directSum = baseline.nodes.reduce((s, n) => s + n.caseCount, 0);
  assert(noneCount === baseline.total - directSum, "未归类计数 = 项目总数 − 各节点直属计数（" + noneCount + "）");

  const nodeName = (baseline.nodes[0] || {}).name || "";
  if(nodeName){
    const frag = nodeName.slice(0, 2);
    await setInput("#tcDirSearch", frag);
    await sleep(600);
    const searched = await evaluate(`(() => ({
      names: [...document.querySelectorAll("#tcDirList .tc-dir-node:not(.special) .tc-dir-name")].map(e => e.textContent),
      focused: document.activeElement && document.activeElement.id === "tcDirSearch",
      specials: [...document.querySelectorAll("#tcDirList .tc-dir-node.special .tc-dir-name")].map(e => e.textContent)
    }))()`);
    assert(searched.names.length > 0, "目录搜索有结果（保留祖先链）");
    assert(searched.names.some(n => n.indexOf(frag) !== -1), "搜索结果包含匹配节点");
    assert(searched.focused, "搜索输入后焦点仍在搜索框（重渲染不抢焦点）");
    assert(searched.specials.length === 2, "搜索时「全部用例 / 未归类」两行仍在");
    /* 列表刷新会整体重建面板：焦点与光标都要保住，否则输入到一半就被打断 */
    await evaluate(`(() => { const el = document.getElementById("tcDirSearch"); el.focus(); el.setSelectionRange(1, 1); return true; })()`);
    await setSelect("tcSort", "updated");
    await sleep(1500);
    const kept = await evaluate(`(() => {
      const el = document.getElementById("tcDirSearch");
      return { focused: document.activeElement === el, value: el.value, caret: el.selectionStart };
    })()`);
    assert(kept.focused && kept.value === frag && kept.caret === 1, "面板重渲染后搜索框焦点与光标保留");
    await setSelect("tcSort", "created");
    await sleep(1200);
    await setInput("#tcDirSearch", "不存在的目录xyz");
    await sleep(500);
    assert(await evaluate(`!!document.querySelector("#tcDirList .tc-side-empty")`), "无匹配时给出空态提示");
    await setInput("#tcDirSearch", "");
    await sleep(500);
  }
  await click("#tcDirSub");
  await sleep(1000);
  assert(await evaluate(`document.getElementById("tcDirSub").getAttribute("aria-checked") === "true"`), "含子目录开关切到开");
  await click("#tcDirSub");
  await sleep(1000);
  assert(await evaluate(`document.getElementById("tcDirSub").getAttribute("aria-checked") === "false"`), "含子目录开关切回关");

  await click("[data-tc-dir-new]");
  await submitPrompt(PREFIX + "目录");
  await waitFor(`[...document.querySelectorAll("#tcDirList .tc-dir-name")].some(n => n.textContent === ${JSON.stringify(PREFIX + "目录")})`, "新目录出现");
  const newNode = await api(`const r = await API.get("/api/test-modules", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(n => n.name === ${JSON.stringify(PREFIX + "目录")}) || null;`);
  assert(!!newNode, "新建顶级目录成功");
  if(newNode) created.nodes.push(newNode.id);

  await evaluate(`(() => { const b = document.querySelector('[data-tc-dir-add="' + ${JSON.stringify(newNode ? newNode.id : "")} + '"]'); if(b) b.click(); return !!b; })()`);
  await submitPrompt(PREFIX + "子目录");
  const childNode = await api(`const r = await API.get("/api/test-modules", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(n => n.name === ${JSON.stringify(PREFIX + "子目录")}) || null;`);
  assert(!!childNode && childNode.parentId === (newNode || {}).id, "新建子目录挂在指定父节点下");
  if(childNode) created.nodes.push(childNode.id);

  await evaluate(`(() => { const b = document.querySelector('[data-tc-dir-edit="' + ${JSON.stringify(childNode ? childNode.id : "")} + '"]'); if(b) b.click(); return !!b; })()`);
  await submitPrompt(PREFIX + "子目录改");
  const renamed = await api(`const r = await API.get("/api/test-modules", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(n => n.id === ${JSON.stringify(childNode ? childNode.id : "")}) || null;`);
  assert(renamed && renamed.name === PREFIX + "子目录改", "重命名目录生效");

  /* 层级不限：第 2 级下还能继续建到第 4 级，且第 4 级仍有「＋子目录」 */
  const modsNow = async () => await api(`const r = await API.get("/api/test-modules", { reqId: ${JSON.stringify(reqId)} });
    return (r && (r.items || r)) || [];`);
  await evaluate(`(() => { const b = document.querySelector('[data-tc-dir-add="' + ${JSON.stringify(childNode ? childNode.id : "")} + '"]'); if(b) b.click(); return !!b; })()`);
  await submitPrompt(PREFIX + "三级");
  const lv3Node = (await modsNow()).find(n => n.name === PREFIX + "三级") || null;
  assert(!!lv3Node && lv3Node.level === 3, "第 3 级目录可创建");
  if(lv3Node) created.nodes.push(lv3Node.id);
  await evaluate(`(() => { const b = document.querySelector('[data-tc-dir-add="' + ${JSON.stringify(lv3Node ? lv3Node.id : "")} + '"]'); if(b) b.click(); return !!b; })()`);
  await submitPrompt(PREFIX + "四级");
  const lv4Node = (await modsNow()).find(n => n.name === PREFIX + "四级") || null;
  assert(!!lv4Node && lv4Node.level === 4, "第 4 级目录可创建（不再限 3 级）");
  if(lv4Node) created.nodes.push(lv4Node.id);
  const lv4UI = await evaluate(`(() => {
    const el = document.querySelector('#tcDirList .tc-dir-node[data-tc-dir="' + ${JSON.stringify(lv4Node ? lv4Node.id : "")} + '"]');
    if(!el) return null;
    const pick = el.querySelector(".tc-dir-pick");
    return {
      cls: el.className,
      margin: el.style.marginLeft,
      hasAdd: !!el.querySelector("[data-tc-dir-add]"),
      title: pick ? pick.getAttribute("title") : ""
    };
  })()`);
  assert(!!lv4UI && lv4UI.cls.indexOf("lv4") !== -1, "第 4 级节点在列表里按层级渲染");
  assert(!!lv4UI && lv4UI.margin === "42px", "第 4 级缩进按 level 计算（3×14px）");
  assert(!!lv4UI && lv4UI.hasAdd, "第 4 级仍提供「＋子目录」（层级不限）");
  assert(!!lv4UI && lv4UI.title.split(" / ").length >= 4, "第 4 级节点 title 给出完整路径", lv4UI.title);
  await shot("panel-dir-1440.png");

  /* ---------------- C 自定义分组面板 ---------------- */
  group("C 自定义分组：团队 / 个人 / 计数 / 编辑 / 删除保留用例");
  await click("#tcSideTabSet");
  await waitFor(`document.getElementById("tcSideTabSet").getAttribute("aria-selected") === "true"`, "切到分组页签");
  await sleep(1200);
  const setPanel = await evaluate(`(() => ({
    labels: [...document.querySelectorAll("#tcSideBody .tc-set-label")].map(e => e.textContent),
    note: (document.querySelector("#tcSideFoot .tc-side-note")||{}).textContent || "",
    noneRow: [...document.querySelectorAll("#tcSideBody .tc-set-item.special .tc-set-name")].map(e => e.textContent)
  }))()`);
  assert(setPanel.labels.length === 3 && setPanel.labels[0].indexOf("团队共享") === 0 && setPanel.labels[1].indexOf("指定成员可见") === 0 && setPanel.labels[2].indexOf("仅自己可见") === 0, "分组按团队 / 指定成员 / 个人三档分段");
  assert(setPanel.labels[0].indexOf("进交付说明与发布证据") !== -1 && setPanel.labels[1].indexOf("不进证据") !== -1 && setPanel.labels[2].indexOf("不进证据") !== -1, "分段标题交代可见范围与是否进证据");
  assert(setPanel.note.indexOf("多归属") !== -1 && setPanel.note.indexOf("删除分组不删用例") !== -1, "脚注交代多归属与删除语义");
  assert(setPanel.note.indexOf("只有团队共享分组进交付说明与发布证据") !== -1 && setPanel.note.indexOf("需创建人操作") !== -1, "脚注交代只有团队共享进证据、转团队需创建人");
  assert(setPanel.noneRow[0] === "未加入任何分组", "提供「未加入任何分组」入口");

  const makeSet = async (name, visibility, withInit) => {
    await click("[data-tc-set-new]");
    await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建分组弹框");
    await setInput("#csName", name);
    await setInput("#csNote", "端到端验证用，跑完即删");
    await evaluate(`(() => { document.querySelector('#csVis input[value="' + ${JSON.stringify(visibility)} + '"]').click(); return true; })()`);
    const initInfo = await evaluate(`(() => ({ hidden: document.getElementById("csInitWrap").hidden, n: document.getElementById("csInitN").textContent }))()`);
    if(withInit){
      assert(!initInfo.hidden && Number(initInfo.n) > 0, "新建时可勾选「按当前筛选加入」并显示条数");
      await click("#csInit");
    } else {
      assert(!initInfo.hidden, "新建弹框展示初始成员选项");
    }
    await shot("set-dialog-" + visibility + ".png");
    await click("#btnSaveCaseSet");
    await sleep(1800);
    return api(`const r = await API.get("/api/case-sets", { reqId: ${JSON.stringify(reqId)} });
      return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(name)}) || null;`);
  };
  const teamSet = await makeSet(PREFIX + "回归集", "team", true);
  assert(!!teamSet && teamSet.visibility === "team", "新建团队分组成功");
  if(teamSet) created.sets.push(teamSet.id);
  assert(teamSet && teamSet.caseCount === baseline.total, "勾选「按当前筛选加入」后成员数 = 当前范围（" + (teamSet || {}).caseCount + "）");
  const personalSet = await makeSet(PREFIX + "个人整理", "personal", false);
  assert(!!personalSet && personalSet.visibility === "personal", "新建个人分组成功");
  if(personalSet) created.sets.push(personalSet.id);
  assert(personalSet && personalSet.caseCount === 0, "未勾选初始成员时个人分组为空");

  await click("#tcSideTabSet");
  await sleep(1200);
  const setRows = await evaluate(`[...document.querySelectorAll("#tcSideBody .tc-set-item:not(.special)")].map(e => ({
    id: e.dataset.tcSet,
    tag: (e.querySelector(".tc-vis-tag")||{}).textContent,
    personal: !!e.querySelector(".tc-vis-tag.personal"),
    n: (e.querySelector(".tc-set-n")||{}).textContent,
    acts: !!e.querySelector(".tc-set-acts")
  }))`);
  const teamRow = setRows.find(r => r.id === (teamSet || {}).id);
  const mineRow = setRows.find(r => r.id === (personalSet || {}).id);
  assert(teamRow && teamRow.tag === "团队" && !teamRow.personal, "团队分组带「团队」标记");
  assert(mineRow && mineRow.tag === "仅自己" && mineRow.personal, "个人分组带「仅自己」标记");
  assert(teamRow && teamRow.acts && mineRow && mineRow.acts, "可编辑分组显示维护按钮");
  assert(teamRow && Number(teamRow.n) === baseline.total, "面板计数与后端成员数一致");
  await shot("panel-sets-1440.png");

  /* ---------------- D 分组显示 ---------------- */
  group("D 分组显示：段头计数 / 分布 / 折叠 / 段内翻页 / 全选本组");
  await setSelect("tcGroupBy", "module");
  await waitFor(`document.querySelectorAll("#tcList .tc-seg").length > 0`, "按目录分段");
  await sleep(1200);
  let segs = await segInfo();
  assert(segs.length > 0, "按模块目录分段渲染");
  assert(segs.every(s => s.name.length > 0 && s.count.indexOf("条") !== -1), "每段带段名与条数");
  assert(segs.filter(s => !s.empty).every(s => s.bar && s.legend), "非空段带结果分布条与读数");
  assert(segs.some(s => s.empty), "零用例的段仍保留（暴露覆盖缺口）");
  const bannerText = await evaluate(`(() => { const b = document.getElementById("tcDropBanner"); return { hidden: b.hidden, text: b.textContent }; })()`);
  assert(!bannerText.hidden && bannerText.text.indexOf("移动归属") !== -1, "按目录分组时提示条写明「移动归属」");
  await shot("grouped-module-1440.png");

  const bigSeg = segs.find(s => s.more);
  if(bigSeg){
    const before = bigSeg.rows;
    await evaluate(`(() => { document.querySelector('[data-tc-seg-more="' + ${JSON.stringify(bigSeg.key)} + '"]').click(); return true; })()`);
    await sleep(1500);
    const after = (await segInfo()).find(s => s.key === bigSeg.key);
    assert(after.rows > before, "段内加载更多后行数增加（" + before + " → " + after.rows + "）");
  } else {
    console.log("  SKIP 段内加载更多（当前数据没有超过首屏的段）");
  }
  await click("#tcGrpCollapseAll");
  await sleep(800);
  assert((await segInfo()).every(s => s.expanded === "false" && s.rows === 0), "全部折叠后段内不渲染行");
  await click("#tcGrpExpandAll");
  await sleep(1500);
  assert((await segInfo()).every(s => s.expanded === "true"), "全部展开后段头 aria-expanded 为真");

  const selSeg = (await segInfo()).find(s => !s.empty);
  const segTotal = Number((selSeg.count.match(/(\d+)/) || [])[1] || 0);
  await evaluate(`(() => { document.querySelector('[data-tc-seg-sel="' + ${JSON.stringify(selSeg.key)} + '"]').click(); return true; })()`);
  await sleep(900);
  const bulk = await evaluate(`(() => ({
    hidden: document.getElementById("tcBulkBar").hidden,
    count: document.getElementById("tcBulkCount").textContent,
    hint: document.getElementById("tcBulkHint").textContent,
    label: document.getElementById("tcBulkAllLabel").textContent
  }))()`);
  assert(!bulk.hidden && bulk.count.indexOf(String(segTotal)) !== -1, "全选本组后批量条显示该组条数（" + segTotal + "）");
  assert(bulk.hint.indexOf("组内全部") !== -1, "批量条说明范围是该组全部（含未加载的行）");
  assert(bulk.label.indexOf("按条件生效") !== -1, "全选态下「全选已加载」标注按条件生效");
  await shot("segment-selected-1440.png");
  await click("#btnTcBatchClear");
  await sleep(700);

  await setSelect("tcGroupBy", "set");
  await waitFor(`document.querySelectorAll("#tcList .tc-seg").length > 0`, "按分组分段");
  await sleep(1200);
  segs = await segInfo();
  assert(segs.some(s => s.key === (personalSet || {}).id && s.empty), "零成员的个人分组也成段（可作放置目标）");
  assert(await evaluate(`document.getElementById("tcDropBanner").textContent.indexOf("加入分组") !== -1`), "按分组分组时提示条写明「加入分组」");
  await setSelect("tcGroupBy", "priority");
  await sleep(1200);
  assert(await evaluate(`document.getElementById("tcDropBanner").textContent.indexOf("改优先级") !== -1`), "按优先级分组时提示条写明「改优先级」");
  await setSelect("tcGroupBy", "owner");
  await sleep(1200);
  assert(await evaluate(`document.getElementById("tcDropBanner").hidden`), "按执行人分组不提供拖拽动作，提示条收起");
  await setSelect("tcGroupBy", "");
  await sleep(1000);

  /* ---------------- E 拖拽归类 ---------------- */
  group("E 拖拽：目录＝移动（可撤销）/ 分组＝加入（撤销只退本次）/ 优先级段＝改优先级");
  await click("#tcSideTabDir");
  await sleep(900);
  const firstRow = await evaluate(`(() => {
    const r = document.querySelector("#tcList .tc-row[data-tc-drag]");
    return r ? { id: r.dataset.tcDrag, no: (r.querySelector(".tc-no")||{}).textContent } : null;
  })()`);
  assert(!!firstRow, "用例行可拖动（draggable + data-tc-drag）");
  const targetNode = (newNode || baseline.nodes[0] || {}).id;
  const beforeMove = baseline.cases.find(c => c.id === firstRow.id);
  const dragInfo = await dragTo('#tcList .tc-row[data-tc-drag="' + firstRow.id + '"]', '#tcDirList .tc-dir-node[data-tc-dir="' + targetNode + '"]');
  assert(dragInfo.dragging, "拖动源行标记 is-dragging");
  assert(dragInfo.marked, "放置目标标记 drop-on");
  assert(dragInfo.banner.indexOf("移动归属") !== -1, "拖动中提示条实时写出落点语义");
  assert(dragInfo.effect === "move", "目录落点 dropEffect=move");
  await waitFor(`document.getElementById("dlgConfirm").classList.contains("open")`, "移动确认框");
  await shot("move-confirm-1440.png");
  const moveConfirm = await confirmOk();
  assert(moveConfirm.arrow && moveConfirm.to.length > 0, "移动确认框展示「从 → 到」");
  assert(moveConfirm.notes.length === 4, "移动确认框列出 4 条影响说明");
  assert(moveConfirm.notes.join("|").indexOf("编号") !== -1 && moveConfirm.notes.join("|").indexOf("计划范围不变") !== -1, "说明覆盖编号不变与计划范围不变");
  assert(moveConfirm.preview.length > 0, "确认框列出被移动的用例");
  const movedCase = await caseOf(firstRow.id);
  assert(movedCase && movedCase.moduleId === targetNode, "拖到目录节点后归属已改");
  assert(await clickToastAction("撤销"), "移动成功 toast 带「撤销」");
  const restoredCase = await caseOf(firstRow.id);
  assert(restoredCase && (restoredCase.moduleId || null) === (beforeMove.moduleId || null), "撤销后回到原目录归属");

  await click("#tcSideTabSet");
  await sleep(1200);
  const joinInfo = await dragTo('#tcList .tc-row[data-tc-drag="' + firstRow.id + '"]', '#tcSideBody .tc-set-item[data-tc-set="' + (personalSet || {}).id + '"]');
  assert(joinInfo.effect === "copy", "分组落点 dropEffect=copy（加入而非移动）");
  assert(joinInfo.banner.indexOf("加入分组") !== -1, "分组落点提示「加入分组（原分组保留）」");
  await sleep(1800);
  const afterJoin = await setOf((personalSet || {}).id);
  assert(afterJoin && afterJoin.caseCount === 1, "拖入个人分组后成员 +1");
  const stillTeam = await setOf((teamSet || {}).id);
  assert(stillTeam && stillTeam.caseCount === baseline.total, "加入新分组不影响原分组（多归属）");
  assert(await clickToastAction("撤销"), "加入分组 toast 带「撤销」");
  const afterUndo = await setOf((personalSet || {}).id);
  assert(afterUndo && afterUndo.caseCount === 0, "撤销只移出本次新增的成员");

  await setSelect("tcGroupBy", "priority");
  await waitFor(`document.querySelectorAll("#tcList .tc-seg").length > 0`, "按优先级分段");
  await sleep(1200);
  const hasP0 = await evaluate(`!!document.querySelector('#tcList .tc-seg[data-tc-seg-drop="P0"]')`);
  if(hasP0){
    const priDrag = await dragTo('#tcList .tc-row[data-tc-drag="' + firstRow.id + '"]', '#tcList .tc-seg[data-tc-seg-drop="P0"]');
    assert(priDrag.effect === "move", "优先级段头 dropEffect=move");
    const priConfirm = await confirmOk();
    assert(priConfirm.title.indexOf("P0") !== -1, "优先级确认框写明目标优先级");
    const priCase = await caseOf(firstRow.id);
    assert(priCase && priCase.priority === "P0", "拖到优先级段头后优先级已改");
  } else {
    console.log("  SKIP 优先级拖拽（没有 P0 段）");
  }
  await setSelect("tcGroupBy", "");
  await sleep(1000);

  /* ---------------- F 按筛选圈选入计划 ---------------- */
  group("F 按筛选入计划：范围 chips / 预览 / 试算去重 / 新建计划 / 发布必测");
  const priFilter = (baseline.cases.find(c => c.priority) || {}).priority || "";
  if(priFilter){
    await setSelect("tcPri", priFilter);
    await sleep(1400);
  }
  await click("#tcSelFiltered");
  await sleep(900);
  await click("#btnTcBatchPlan");
  await waitFor(`document.getElementById("dlgPlanByFilter").classList.contains("open")`, "按筛选入计划弹框");
  await sleep(1800);
  const pbf = await evaluate(`(() => ({
    tags: [...document.querySelectorAll("#pbfTags .pbf-tag")].map(e => e.textContent),
    preview: document.querySelectorAll("#pbfPreview .pbf-row-case").length,
    foot: document.getElementById("pbfPreviewFoot").textContent,
    plans: [...document.getElementById("pbfPlan").options].map(o => o.textContent),
    newHidden: document.getElementById("pbfNewWrap").hidden,
    btn: document.getElementById("btnPbfAdd").textContent
  }))()`);
  assert(pbf.tags[0] === "全选筛选结果", "范围 chips 首项交代口径（" + pbf.tags[0] + "）");
  assert(pbf.tags.some(t => t.indexOf(picked.name) !== -1), "chips 带上项目名");
  if(priFilter) assert(pbf.tags.some(t => t.indexOf("优先级：" + priFilter) !== -1), "chips 带上当前筛选条件");
  assert(pbf.preview > 0 && pbf.preview <= 8, "预览最多 8 条（实际 " + pbf.preview + "）");
  assert(pbf.foot.indexOf("实际范围") !== -1 && pbf.foot.indexOf("含未加载的行") !== -1, "预览脚注区分预览条数与实际范围");
  assert(pbf.plans[pbf.plans.length - 1].indexOf("新建计划") !== -1, "目标计划下拉末项是「＋ 新建计划…」");
  await shot("plan-by-filter-1440.png");

  const existingPlan = await evaluate(`(() => { const o = document.getElementById("pbfPlan").options; return o.length > 1 ? o[0].value : ""; })()`);
  if(existingPlan){
    await setSelect("pbfPlan", existingPlan);
    await sleep(1800);
    const sum = await evaluate(`[...document.querySelectorAll("#pbfSum .pbf-row")].map(e => ({
      k: e.querySelector("span").textContent, n: e.querySelector(".n").textContent
    }))`);
    assert(sum.length === 3, "试算给出三行：范围命中 / 已在计划中 / 本次新增");
    const matched = Number(sum[0].n), already = Number(String(sum[1].n).replace("-", "")), added = Number(sum[2].n);
    assert(matched === already + added, "试算口径自洽：命中 = 已在计划 + 本次新增（" + matched + "=" + already + "+" + added + "）");
    await shot("plan-by-filter-sum-1440.png");
  } else {
    console.log("  SKIP 已有计划试算（该项目没有计划）");
  }
  await setSelect("pbfPlan", "__new");
  await sleep(800);
  assert(await evaluate(`!document.getElementById("pbfNewWrap").hidden`), "选「新建计划」后出现名称输入");
  assert(await evaluate(`document.getElementById("btnPbfAdd").disabled`), "新计划名为空时加入按钮禁用");
  await setInput("#pbfNewName", PREFIX + "计划");
  await sleep(500);
  await click("#pbfRequired");
  assert(await evaluate(`!document.getElementById("btnPbfAdd").disabled`), "填好名称后加入按钮可用");
  const addLabel = await evaluate(`document.getElementById("btnPbfAdd").textContent`);
  assert(/加入 \d+ 条用例/.test(addLabel), "加入按钮写出本次条数（" + addLabel + "）");
  await click("#btnPbfAdd");
  await sleep(2500);
  const newPlan = await api(`const r = await API.get("/api/test-plans", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
    return ((r && (r.items || r)) || []).find(p => p.name === ${JSON.stringify(PREFIX + "计划")}) || null;`);
  assert(!!newPlan, "新建计划并加入用例成功");
  if(newPlan) created.plans.push(newPlan.id);
  if(newPlan){
    const detail = await api(`const r = await API.get("/api/test-plans/" + ${JSON.stringify(newPlan.id)});
      const page = await API.get("/api/test-plans/" + ${JSON.stringify(newPlan.id)} + "/cases", { limit: 200 });
      const cases = (page && page.items) || [];
      return { n: cases.length, required: cases.filter(c => c.required).length, status: r && r.plan && r.plan.status };`);
    assert(detail.n > 0 && detail.n === detail.required, "整批标记「发布必测」生效（" + detail.required + "/" + detail.n + "）");
    assert(detail.status === "draft", "新建计划落在草稿状态");
  }
  assert(await evaluate(`[...document.querySelectorAll("#toastWrap .toast button.tact")].some(b => b.textContent.trim() === "查看计划")`), "加入成功 toast 带「查看计划」");

  /* 勾选模式：只带已勾选的行，不走筛选试算 */
  await click("#btnTcBatchClear").catch(() => {});
  await sleep(800);
  await evaluate(`(() => {
    const boxes = [...document.querySelectorAll("#tcList [data-tc-pick]")].slice(0, 2);
    boxes.forEach(b => b.click());
    return boxes.length;
  })()`);
  await sleep(800);
  await click("#btnTcBatchPlan");
  await waitFor(`document.getElementById("dlgPlanByFilter").classList.contains("open")`, "勾选模式弹框");
  await sleep(1500);
  const idsMode = await evaluate(`(() => ({
    tag: (document.querySelector("#pbfTags .pbf-tag")||{}).textContent,
    preview: document.querySelectorAll("#pbfPreview .pbf-row-case").length,
    sum: document.getElementById("pbfSum").textContent,
    rows: document.querySelectorAll("#pbfSum .pbf-row").length
  }))()`);
  assert(idsMode.tag === "已勾选 2 条", "勾选模式首项 chip 写明已勾选条数");
  assert(idsMode.preview === 2, "勾选模式预览只列已勾选的行");
  assert(idsMode.rows === 0 && idsMode.sum.indexOf("条已勾选") !== -1, "勾选模式不做筛选试算");
  await click("#dlgPlanByFilterX");
  await sleep(800);
  await click("#btnTcBatchClear").catch(() => {});
  await click("#tcClearFilter").catch(() => {});
  await sleep(1400);

  /* ---------------- G 批量加入分组 / 移出分组 ---------------- */
  group("G 批量加入分组与移出分组");
  await click("#tcSelFiltered");
  await sleep(900);
  await click("#btnTcBatchSet");
  await waitFor(`document.getElementById("dlgSetPick").classList.contains("open")`, "加入分组弹框");
  await sleep(1500);
  const pick = await evaluate(`(() => ({
    sub: document.getElementById("setPickSub").textContent,
    items: [...document.querySelectorAll("#setPickList .set-pick-item")].map(e => ({
      id: e.dataset.setPick, name: (e.querySelector("b")||{}).textContent,
      sub: (e.querySelector("small")||{}).textContent, n: (e.querySelector(".set-pick-n")||{}).textContent
    })),
    okDisabled: document.getElementById("btnSetPickOk").disabled
  }))()`);
  assert(pick.sub.indexOf("引用不复制") !== -1, "弹框说明加入是引用不复制");
  assert(pick.items.length >= 2, "列出可见分组供选择");
  assert(pick.okDisabled, "未选目标分组时确认按钮禁用");
  const personalPick = pick.items.find(i => i.id === (personalSet || {}).id);
  assert(personalPick && personalPick.sub.indexOf("只有自己能看") !== -1, "个人分组在选择列表里标注可见范围");
  await evaluate(`(() => { document.querySelector('#setPickList .set-pick-item[data-set-pick="' + ${JSON.stringify((personalSet || {}).id)} + '"]').click(); return true; })()`);
  await sleep(500);
  assert(await evaluate(`!document.getElementById("btnSetPickOk").disabled`), "选中分组后确认按钮可用");
  await shot("set-pick-1440.png");
  await click("#btnSetPickOk");
  await sleep(2000);
  const bulkJoined = await setOf((personalSet || {}).id);
  assert(bulkJoined && bulkJoined.caseCount === baseline.total, "按筛选批量加入分组成员数 = 范围条数");
  await click("#tcSideTabSet");
  await sleep(1200);
  await evaluate(`(() => { document.querySelector('#tcSideBody .tc-set-item[data-tc-set="' + ${JSON.stringify((personalSet || {}).id)} + '"] .tc-set-pick').click(); return true; })()`);
  await sleep(1500);
  await click("#tcSelFiltered");
  await sleep(900);
  assert(await evaluate(`!document.getElementById("btnTcBatchUnset").hidden`), "按分组筛选且有勾选时出现「移出分组」");
  await click("#btnTcBatchUnset");
  const leaveConfirm = await confirmOk();
  assert(leaveConfirm.title === "移出分组" && leaveConfirm.msg.indexOf("用例本体保留") !== -1, "移出分组前确认并强调用例本体保留");
  await sleep(1200);
  const bulkLeft = await setOf((personalSet || {}).id);
  assert(bulkLeft && bulkLeft.caseCount === 0, "移出分组后成员清零");
  const stillThere = await api(`const r = await API.get("/api/test-cases/stats", { reqId: ${JSON.stringify(reqId)} }); return r && r.total;`);
  assert(stillThere === baseline.total, "移出分组不删用例（总数仍为 " + baseline.total + "）");

  /* 删除分组：用例本体保留 */
  await evaluate(`(() => { document.querySelector('#tcSideBody .tc-set-item[data-tc-set="' + ${JSON.stringify((personalSet || {}).id)} + '"] [data-tc-set-del]').click(); return true; })()`);
  const delConfirm = await confirmOk();
  assert(delConfirm.msg.indexOf("用例") !== -1, "删除分组确认提到用例保留");
  await sleep(1200);
  const goneSet = await setOf((personalSet || {}).id);
  assert(!goneSet, "分组已删除");
  created.sets = created.sets.filter(id => id !== (personalSet || {}).id);
  const totalAfterDel = await api(`const r = await API.get("/api/test-cases/stats", { reqId: ${JSON.stringify(reqId)} }); return r && r.total;`);
  assert(totalAfterDel === baseline.total, "删除分组后用例总数不变");

  /* ---------------- H 批次C：动态分组 / 指定成员可见 / 统计 chips 即筛选 ---------------- */
  group("H 批次C：动态分组 / 指定成员可见 / 统计 chips 即筛选");
  await click("#tcClearFilter");
  await sleep(1200);
  const radio = (name, value) => evaluate(`(() => {
    const el = document.querySelector('input[name="' + ${JSON.stringify(name)} + '"][value="' + ${JSON.stringify(value)} + '"]');
    if(!el) return false; el.click(); return true;
  })()`);

  /* 统计与执行结果筛选合并：点计数即筛选 */
  const strip0 = await evaluate(`(() => {
    const el = document.getElementById("tcStats"), bar = document.getElementById("tcFilterBar");
    const center = x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; };
    const kids = [...bar.children].filter(x => getComputedStyle(x).display !== "none");
    return {
      segGone: !document.getElementById("tcStatusSeg"),
      chips: [...el.querySelectorAll("[data-tc-status]")].map(x => x.tagName + ":" + x.dataset.tcStatus),
      hint: (el.querySelector(".tc-stat-hint")||{}).textContent || "",
      oneLine: kids.every(x => Math.abs(center(x) - center(bar)) <= 4),
      beforeBar: !!(el.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  })()`);
  assert(strip0.segGone && strip0.chips.length === 6 && strip0.chips.every(c => c.indexOf("BUTTON:") === 0),
    "执行结果分段并入统计条：6 个可点计数按钮（" + strip0.chips.join("/") + "）");
  assert(/点计数即筛选/.test(strip0.hint) && strip0.beforeBar && strip0.oneLine, "统计条位于筛选条之前、单行，并带口径提示");
  const counts0 = await evaluate(`[...document.querySelectorAll("#tcStats [data-tc-status]")].map(x => x.textContent.trim()).join("|")`);
  await click('#tcStats [data-tc-status="failed"]');
  await sleep(1200);
  const strip1 = await evaluate(`(() => ({
    on: [...document.querySelectorAll("#tcStats .tc-stat.on")].map(x => x.dataset.tcStatus),
    counts: [...document.querySelectorAll("#tcStats [data-tc-status]")].map(x => x.textContent.trim()).join("|"),
    meta: (document.getElementById("tcMeta")||{}).textContent || ""
  }))()`);
  assert(JSON.stringify(strip1.on) === JSON.stringify(["failed"]), "点计数即筛选并呈选中态");
  assert(strip1.counts === counts0 && /筛选出/.test(strip1.meta), "计数不受当前筛选影响，meta 交代筛选口径");
  await shot("stats-chips-filtered-1440.png");
  await click("#tcClearFilter");
  await sleep(1000);

  /* 动态分组：规则构建器 + 一键回归集 + 试算 */
  await click("[data-tc-set-new]");
  await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建分组弹框");
  await setInput("#csName", PREFIX + "动态回归");
  await radio("csKind", "dynamic");
  await sleep(500);
  const dynDlg = await evaluate(`(() => ({
    ruleHidden: document.getElementById("csRuleWrap").hidden,
    initHidden: document.getElementById("csInitWrap").hidden,
    fields: ["csRuleStatus","csRulePri","csRuleModule","csRuleDemand","csRuleOwner"].every(id => !!document.getElementById(id))
  }))()`);
  assert(!dynDlg.ruleHidden && dynDlg.initHidden && dynDlg.fields, "动态类型展示规则构建器并收起初始成员");
  await click("#csRuleRegressionBtn");
  await sleep(1000);
  const regHit = await evaluate(`(() => ({
    on: document.getElementById("csRuleRegression").checked,
    status: document.getElementById("csRuleStatus").value,
    hit: (document.getElementById("csRuleHit")||{}).textContent || ""
  }))()`);
  assert(regHit.on && regHit.status === "all" && /命中 \d+ 条/.test(regHit.hit), "一键回归集勾回归口径、清结果条件并试算（" + regHit.hit + "）");
  await shot("set-dialog-dynamic-1440.png");
  await click("#btnSaveCaseSet");
  await sleep(1800);
  const dynSet = await api(`const r = await API.get("/api/case-sets", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(PREFIX + "动态回归")}) || null;`);
  assert(!!dynSet && dynSet.kind === "dynamic" && dynSet.visibility === "team", "动态分组落库为团队共享");
  if(dynSet) created.sets.push(dynSet.id);
  assert(dynSet && /"regression":true/.test(dynSet.ruleJson || ""), "规则 JSON 持久化回归口径");
  const dynCount = (dynSet || {}).caseCount || 0;
  await click("#tcSideTabSet");
  await sleep(1200);
  const dynRow = await evaluate(`(() => {
    const e = document.querySelector('#tcSideBody .tc-set-item[data-tc-set="' + ${JSON.stringify((dynSet || {}).id)} + '"]');
    return e ? { dyn: e.classList.contains("is-dyn"), tags: [...e.querySelectorAll(".tc-vis-tag")].map(x => x.textContent) } : null;
  })()`);
  assert(dynRow && dynRow.dyn && dynRow.tags.indexOf("动态") !== -1, "侧栏动态分组带动态标记");
  await evaluate(`(() => { const b = document.querySelector('#tcSideBody .tc-set-item[data-tc-set="' + ${JSON.stringify((dynSet || {}).id)} + '"] .tc-set-pick'); if(b) b.click(); return !!b; })()`);
  await sleep(1400);
  const dynDetail = await evaluate(`(() => {
    const d = document.getElementById("tcSetDetail");
    return { hidden: d.hidden, rules: [...d.querySelectorAll(".rule-chip")].map(x => x.textContent.trim()),
      foot: (d.querySelector(".tc-setd-foot")||{}).textContent || "" };
  })()`);
  assert(!dynDetail.hidden && dynDetail.rules.length >= 1 && /创建人/.test(dynDetail.foot), "口径条展示收录规则与按创建人可见范围");
  const dynDrop = await dragTo("#tcList .tc-row", '#tcSideBody .tc-set-item[data-tc-set="' + (dynSet || {}).id + '"]');
  assert(dynDrop.marked === false, "动态分组不成为拖拽落点");
  await sleep(900);
  const dynAfterDrop = await setOf((dynSet || {}).id);
  assert(dynAfterDrop && dynAfterDrop.caseCount === dynCount, "拖到动态分组不改变成员（" + dynCount + "）");

  /* 指定成员可见：名单挑选 + 口径条 + 不进证据 */
  await click("[data-tc-set-new]");
  await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建分组弹框");
  await setInput("#csName", PREFIX + "联调名单");
  await radio("csVis", "members");
  await sleep(700);
  const whoDlg = await evaluate(`(() => ({
    whoHidden: document.getElementById("csWhoWrap").hidden,
    rows: document.querySelectorAll("#csWhoList .cs-who-row").length,
    count: (document.getElementById("csWhoCount")||{}).textContent || ""
  }))()`);
  assert(!whoDlg.whoHidden && whoDlg.rows > 0 && /创建人始终可见，不占名额/.test(whoDlg.count), "指定成员展示花名册候选与名额口径（" + whoDlg.rows + " 行）");
  await evaluate(`(() => { const el = document.querySelector("#csWhoList .cs-who-row input"); el.focus(); el.click(); return true; })()`);
  await sleep(500);
  const whoOn = await evaluate(`(() => ({
    on: document.querySelectorAll("#csWhoList .cs-who-row input:checked").length,
    count: (document.getElementById("csWhoCount")||{}).textContent || ""
  }))()`);
  assert(whoOn.on === 1 && /已选 1 \/ 50 人/.test(whoOn.count), "勾选名单后就地计数（" + whoOn.count + "）");
  await shot("set-dialog-members-1440.png");
  await click("#btnSaveCaseSet");
  await sleep(1800);
  const memSet = await api(`const r = await API.get("/api/case-sets", { reqId: ${JSON.stringify(reqId)} });
    return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(PREFIX + "联调名单")}) || null;`);
  assert(!!memSet && memSet.visibility === "members" && (memSet.memberIds || []).length === 1, "指定成员分组落库含 1 名名单成员");
  if(memSet) created.sets.push(memSet.id);
  await click("#tcSideTabSet");
  await sleep(1200);
  await evaluate(`(() => { const b = document.querySelector('#tcSideBody .tc-set-item[data-tc-set="' + ${JSON.stringify((memSet || {}).id)} + '"] .tc-set-pick'); if(b) b.click(); return !!b; })()`);
  await sleep(1600);
  const memDetail = await evaluate(`(() => {
    const d = document.getElementById("tcSetDetail");
    return { who: [...d.querySelectorAll(".who-chip")].map(x => x.textContent.trim()),
      foot: (d.querySelector(".tc-setd-foot")||{}).textContent || "" };
  })()`);
  assert(memDetail.who.length === 1 && /不进交付说明与发布证据/.test(memDetail.foot), "口径条展示可见名单并写明不进证据");
  await shot("set-detail-members-1440.png");

  /* 圈选入计划顺手存动态分组：先清掉上一步点开的分组筛选，否则圈选范围会被空分组吃掉 */
  await click("#tcClearFilter");
  await sleep(1200);
  const somePri = await api(`const r = await API.get("/api/test-cases", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
    const c = ((r && r.items) || []).find(x => x.priority); return c ? c.priority : null;`);
  if(somePri){
    await setSelect("tcPri", somePri);
    await sleep(1400);
    await click("#tcSelFiltered");
    await sleep(700);
    await click("#btnTcBatchPlan");
    await waitFor(`document.getElementById("dlgPlanByFilter").classList.contains("open")`, "圈选入计划");
    await sleep(1200);
    const pbfDyn = await evaluate(`(() => ({
      wrapHidden: document.getElementById("pbfDynWrap").hidden,
      disabled: document.getElementById("pbfDynamic").disabled
    }))()`);
    assert(!pbfDyn.wrapHidden && !pbfDyn.disabled, "圈选弹框提供「存成动态分组」入口");
    await setSelect("pbfPlan", "__new");
    await sleep(700);
    await setInput("#pbfNewName", PREFIX + "动态计划");
    await sleep(400);
    await evaluate(`(() => { const el = document.getElementById("pbfDynamic"); el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(400);
    await setInput("#pbfDynName", PREFIX + "计划动态");
    await sleep(400);
    assert(await evaluate(`!document.getElementById("btnPbfAdd").disabled`), "填齐动态分组名称后可提交");
    await click("#btnPbfAdd");
    await waitFor(`!document.getElementById("dlgPlanByFilter").classList.contains("open")`, "加入计划", 25000);
    await sleep(1600);
    const pbfToast = await toastText();
    assert(/已新建计划/.test(pbfToast) && /同时创建团队共享动态分组/.test(pbfToast), "计划与动态分组一起创建（" + pbfToast + "）");
    const planSet = await api(`const r = await API.get("/api/case-sets", { reqId: ${JSON.stringify(reqId)} });
      return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(PREFIX + "计划动态")}) || null;`);
    assert(planSet && planSet.kind === "dynamic" && planSet.visibility === "team" && (planSet.ruleJson || "").indexOf('"pri":"' + somePri + '"') !== -1,
      "圈选存的动态分组规则含当前优先级且团队共享");
    if(planSet) created.sets.push(planSet.id);
    const dynPlan = await api(`const r = await API.get("/api/test-plans", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
      return ((r && (r.items || r)) || []).find(p => p.name === ${JSON.stringify(PREFIX + "动态计划")}) || null;`);
    assert(!!dynPlan, "圈选同时新建计划落库");
    const newPlans = await api(`const r = await API.get("/api/test-plans", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
      return ((r && (r.items || r)) || []).filter(p => p.name.indexOf(${JSON.stringify(PREFIX)}) === 0).map(p => p.id);`);
    newPlans.forEach(id => { if(created.plans.indexOf(id) === -1) created.plans.push(id); });
    await click("#tcClearFilter");
    await sleep(1000);
  } else {
    console.log("  SKIP 圈选存动态分组（当前项目没有带优先级的用例）");
  }

  /* ---------------- I 窄屏 ---------------- */
  group("I 900 / 390 窄屏");
  /* G 结束时筛选还停在已删除的分组上：先清空筛选，窄屏截图与分段才有真实用例 */
  await click("#tcClearFilter");
  await sleep(1400);
  await setViewport(900, 900, false);
  await sleep(1200);
  const tablet = await evaluate(`(() => {
    const w = document.getElementById("tcCasesWrap"), s = document.getElementById("tcSidePanel");
    return { dir: getComputedStyle(w).flexDirection, sideW: Math.round(s.getBoundingClientRect().width),
      mainW: Math.round(document.querySelector(".tc-cases-main").getBoundingClientRect().width),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  })()`);
  assert(tablet.dir === "row" && tablet.sideW > 0 && tablet.mainW > 300, "900px 下面板与列表并排且列表不被挤扁（" + tablet.sideW + "/" + tablet.mainW + "）");
  assert(!tablet.overflow, "900px 无横向溢出");
  await shot("tablet-900.png");

  await setViewport(390, 844, true);
  await sleep(1500);
  const mobile = await evaluate(`(() => {
    const w = document.getElementById("tcCasesWrap"), s = document.getElementById("tcSidePanel");
    const sr = s.getBoundingClientRect(), mr = document.querySelector(".tc-cases-main").getBoundingClientRect();
    const acts = document.querySelector("#tcSideBody .tc-set-acts, #tcDirList .tc-dir-acts");
    return {
      layout: document.body.dataset.layout,
      dir: getComputedStyle(w).flexDirection,
      stacked: sr.bottom <= mr.top + 1,
      sticky: getComputedStyle(s).position,
      banner: getComputedStyle(document.getElementById("tcDropBanner")).display,
      actsOpacity: acts ? getComputedStyle(acts).opacity : "1",
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  })()`);
  assert(mobile.layout === "mobile", "390px 落在移动档位");
  assert(mobile.dir === "column" && mobile.stacked, "手机上面板叠在列表上方");
  assert(mobile.sticky === "static", "手机上面板不吸顶");
  assert(mobile.banner === "none", "手机上隐藏只讲拖拽语义的提示条");
  assert(mobile.actsOpacity === "1", "手机上维护按钮常显（触屏没有 hover）");
  assert(!mobile.overflow, "390px 无横向溢出");
  await shot("mobile-390-panel.png");
  await click("#tcSideTabDir");
  await sleep(1000);
  await shot("mobile-390-dir.png");
  await setSelect("tcGroupBy", "module");
  await waitFor(`document.querySelectorAll("#tcList .tc-seg").length > 0`, "手机上按目录分段");
  await sleep(1200);
  const segHint = await evaluate(`(() => {
    const h = document.querySelector("#tcList .tc-seg-hint");
    return { segs: document.querySelectorAll("#tcList .tc-seg").length, hint: !!h,
      display: h ? getComputedStyle(h).display : "", groupBy: document.getElementById("tcGroupBy").value };
  })()`);
  assert(segHint.segs > 0 && segHint.hint && segHint.display === "none",
    "手机上段头拖拽提示隐藏（段数 " + segHint.segs + "，提示 " + segHint.hint + "/" + segHint.display + "）");
  await shot("mobile-390-grouped.png");
  await setSelect("tcGroupBy", "");
  await sleep(1000);
  await setViewport(1440, 900, false);
  await sleep(1200);
  await shot("cases-1440.png");

  /* ---------------- J 控制台与网络 ---------------- */
  group("J 控制台与网络");
  const realErrors = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(realErrors.length === 0, "无控制台错误" + (realErrors.length ? "：" + realErrors.slice(0, 3).join(" / ") : ""));
  assert(cdp.badResponses.length === 0, "无 4xx/5xx 接口响应" + (cdp.badResponses.length ? "：" + cdp.badResponses.slice(0, 3).join(" / ") : ""));

}catch(e){
  failed++;
  console.log("  FAIL 运行中断：" + e.message);
}finally{
  if(api && reqId && baseline){
    group("清理与残留核对");
    try{
      for(const id of created.plans){ await api(`await API.del("/api/test-plans/" + ${JSON.stringify(id)}); return true;`).catch(() => {}); }
      for(const id of created.sets){ await api(`await API.del("/api/case-sets/" + ${JSON.stringify(id)}); return true;`).catch(() => {}); }
      /* 目录先删子节点再删父节点 */
      const nodes = await api(`const r = await API.get("/api/test-modules", { reqId: ${JSON.stringify(reqId)} });
        return ((r && (r.items || r)) || []).filter(n => n.name.indexOf(${JSON.stringify(PREFIX)}) === 0)
          .sort((a, b) => (b.level || 0) - (a.level || 0)).map(n => n.id);`);
      for(const id of nodes || []){ await api(`await API.del("/api/test-modules/" + ${JSON.stringify(id)}); return true;`).catch(() => {}); }
      /* 还原被拖拽改过的归属与优先级 */
      const now = await api(`const r = await API.get("/api/test-cases", { reqId: ${JSON.stringify(reqId)}, limit: 200 });
        return ((r && r.items) || []).map(c => ({ id: c.id, moduleId: c.moduleId || null, priority: c.priority || null }));`);
      const byModule = {};
      const priChanged = [];
      for(const c of now || []){
        const b = baseline.cases.find(x => x.id === c.id);
        if(!b) continue;
        if((c.moduleId || null) !== (b.moduleId || null)){
          const key = b.moduleId || "__none";
          (byModule[key] = byModule[key] || []).push(c.id);
        }
        if((c.priority || null) !== (b.priority || null)) priChanged.push({ id: c.id, priority: b.priority });
      }
      for(const key of Object.keys(byModule)){
        await api(`await API.post("/api/test-cases/move-module", { selection: { ids: ${JSON.stringify(byModule[key])} },
          moduleId: ${JSON.stringify(key === "__none" ? null : key)} }); return true;`).catch(() => {});
      }
      for(const p of priChanged){
        await api(`await API.put("/api/test-cases/batch", { ids: [${JSON.stringify(p.id)}],
          priorityAction: ${JSON.stringify(p.priority ? "set" : "clear")}, priority: ${JSON.stringify(p.priority || "")} }); return true;`).catch(() => {});
      }
      const after = await api(`
        const reqId = ${JSON.stringify(reqId)};
        const arr = x => (x && (x.items || x)) || [];
        const mods = await API.get("/api/test-modules", { reqId });
        const sets = await API.get("/api/case-sets", { reqId });
        const plans = await API.get("/api/test-plans", { reqId, limit: 200 });
        const cases = await API.get("/api/test-cases", { reqId, limit: 200 });
        return {
          nodes: arr(mods).map(n => n.id).sort(),
          sets: arr(sets).map(s => s.id + ":" + (s.caseCount || 0)).sort(),
          plans: arr(plans).map(p => p.id).sort(),
          cases: arr(cases).map(c => c.id + ":" + (c.moduleId || "-") + ":" + (c.priority || "-")).sort(),
          total: (cases && cases.total) || 0
        };
      `);
      const want = {
        nodes: baseline.nodes.map(n => n.id).sort(),
        sets: baseline.sets.map(s => s.id + ":" + s.caseCount).sort(),
        plans: baseline.plans.map(p => p.id).sort(),
        cases: baseline.cases.map(c => c.id + ":" + (c.moduleId || "-") + ":" + (c.priority || "-")).sort(),
        total: baseline.total
      };
      assert(JSON.stringify(after.nodes) === JSON.stringify(want.nodes), "目录无残留");
      assert(JSON.stringify(after.sets) === JSON.stringify(want.sets), "分组与成员数无残留");
      assert(JSON.stringify(after.plans) === JSON.stringify(want.plans), "计划无残留");
      assert(JSON.stringify(after.cases) === JSON.stringify(want.cases), "用例归属与优先级已还原");
      assert(after.total === want.total, "用例总数无变化");
    }catch(e){
      failed++;
      console.log("  FAIL 清理失败：" + e.message);
    }
  }
  try{ await call("Browser.close", {}); }catch(e){}
  try{ proc.kill(); }catch(e){}
  try{ ws.close(); }catch(e){}
}

console.log("\n结果：PASS " + passed + " / FAIL " + failed + "（截图：" + SHOT_DIR + "）");
process.exit(failed ? 1 : 0);