/* 项目目录多级 + 嵌套分组 + 拖拽归类 + 手动排序 + 权限 E2E（真 Chrome / CDP）
   用法：E2E_BASE=http://127.0.0.1:8133/hourglass node tools/e2e/case-directory.mjs
   数据：演示空间里选用例最多的项目，只新建「E2E目录…」「E2E分组…」前缀的目录 / 分组 / 用例，
        finally 全部清理并断言无残留；不移动项目里已有用例与目录。
   覆盖：
     A 面板：侧栏两个页签（项目目录 / 分组）、目录树与项目目录同源、可写成员有拖拽与维护入口。
     B 嵌套分组：新建父组（仅自己可见）→ 在父组下新建子组，子组继承可见范围；父组计数按子树去重；
        用例拖到子组＝加入（原目录保留）；「显示子分组用例」开关按子树口径过滤。
     C 手动排序：排序=手动时用例行可拖，落库后刷新仍在；有其它筛选时不给排序入口。
     D 用例拖到目录：移动归属（带确认），编号与执行流水不变。
     E 目录 / 分组拖拽：拖到中间＝改父级（分组继承可见范围），上下边缘＝同级排序；成环直接被拒。
     F 权限：只读成员没有新建 / 改名 / 删除 / 拖拽入口，绕过界面直接写被服务端拒（403）。
   全程要求控制台零报错，除登记的三次拒绝探针外无 4xx/5xx。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8133/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";
const WS = process.env.E2E_WS || "Smw9zcftmwwnrwuon";
const PORT = Number(process.env.CDP_PORT || 9346);
const SHOT_DIR = path.resolve(process.env.E2E_SHOT_DIR
  || "docs/audit/prototypes/case-directory-2026-11-15/shots");
const PREFIX = "E2E目录";
const SET_PREFIX = "E2E分组";

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
    this.netErrors = []; this.denials = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.responseReceived"){
      const r = msg.params.response || {};
      if(r.status >= 400 && String(r.url).indexOf("favicon") === -1){
        const line = r.status + " " + r.url;
        if(r.status === 403) this.denials.push(line);
        else this.netErrors.push(line);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(!/Failed to load resource/.test(text)) this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      if(!/Failed to load resource/.test(msg.params.entry.text || "")) this.errors.push("log: " + msg.params.entry.text);
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
const section = async (name, fn) => {
  console.log("\n" + name);
  try{ await fn(); }
  catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); }
};

fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-directory-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let evaluate = null, api = null, apiTry = null, waitFor = null, call = null, cdp = null, ws = null;
let reqId = "", reqName = "";
const created = { nodes: [], sets: [], cases: [] };

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
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
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
  apiTry = body => evaluate(`(async () => { try { const { API } = await import("./js/core/api.js");
    ${body}
    return { ok:true }; }
    catch(e){ return { ok:false, code:e.code || null, msg:e.message || String(e) }; } })()`);
  const waitApi = async (body, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last, err = "";
    while(Date.now() < deadline){
      try{ last = await api(body); err = ""; }catch(e){ last = null; err = e.message; }
      if(last) return last;
      await sleep(250);
    }
    throw new Error("接口等待超时：" + label + "（最后 " + JSON.stringify(last) + (err ? "，末次错误 " + err : "") + "）");
  };
  const setViewport = (width, height, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    try{ await evaluate(`(() => { document.getElementById("toastWrap") && (document.getElementById("toastWrap").innerHTML = ""); document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
    const s = await Promise.race([call("Page.captureScreenshot", { format: "png", fromSurface: true }),
      sleep(9000).then(() => null)]);
    if(!s){ console.log("  WARN 截图超时，跳过 " + name); return; }
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, "base64"));
    console.log("  SHOT " + name);
  };
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const setInput = (sel, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true })); return true;
  })()`);
  const setSelect = (id, value) => evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)}); if(!el) return false;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true })); return true;
  })()`);
  const toastText = () => evaluate(`[...document.querySelectorAll("#toastWrap .toast")].map(e => (e.textContent||"").trim()).join(" | ")`);
  const clearToasts = () => evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`);
  const submitPrompt = async value => {
    await waitFor(`!!document.querySelector(".modal-layer.open form input")`, "提示框输入");
    await evaluate(`(() => {
      const layers = [...document.querySelectorAll(".modal-layer.open")];
      const form = layers[layers.length - 1].querySelector("form");
      const input = form.querySelector("input,textarea");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit(); return true;
    })()`);
    await sleep(700);
  };

  const login = async (user) => {
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("uName", ${JSON.stringify(user)}); set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && !!document.body.dataset.view", "登录完成 " + user, 15000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
    await api(`await API.post("/api/workspaces/" + ${JSON.stringify(WS)} + "/select", {}); return true;`);
    await call("Page.navigate", { url: BASE + "/#/testcases" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "进入测试视图", 25000);
    await waitFor(`document.body.dataset.view === "testcases" && !!document.getElementById("tcReq")`, "用例页就绪", 15000);
  };

  const dirMenuOpen = () => evaluate(`!document.getElementById("tcDirMenu").hidden`);
  const openDirSide = async () => {
    if(!(await dirMenuOpen())) await click("#tcDirBtn");
    await waitFor(`!document.getElementById("tcDirMenu").hidden && !!document.querySelector("#tcDirList [data-tc-dir]")`, "目录弹层");
    await sleep(250);
  };
  const openSetSide = async () => {
    if(await dirMenuOpen()){ await click("#tcDirBtn"); await sleep(250); }
    if(await evaluate(`document.getElementById("tcSidePanel").hidden`)) await click("#tcPanelBtn");
    await waitFor(`!!document.querySelector("#tcSideBody .tc-side-tools")`, "分组面板");
    await sleep(300);
  };
  const pickDir = async id => {
    const on = await evaluate(`(() => { const b = document.querySelector('[data-tc-dir-pick="${id}"]');
      return !!(b && b.getAttribute("aria-pressed") === "true"); })()`);
    if(!on) await click(`[data-tc-dir-pick="${id}"]`);
  };
  const modules = () => api(`const r = await API.get("/api/test-modules", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
    return ((r && (r.items || r)) || []);`);
  const sets = () => api(`const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
    return ((r && (r.items || r)) || []);`);
  const cases = () => api(`const r = await API.get("/api/test-cases", { reqId:${JSON.stringify(reqId)}, limit:200, probe:Date.now() });
    return ((r && (r.items || r)) || []);`);
  const orderIds = mid => api(`const r = await API.get("/api/test-cases/order", { reqId:${JSON.stringify(reqId)},
    moduleId:${JSON.stringify(mid)}, probe:Date.now() }); return (r && (r.items || r)) || [];`);
  const nodeByName = async name => (await modules()).find(n => n.name === name) || null;
  const setByName = async name => (await sets()).find(s => s.name === name) || null;
  const caseByTitle = async title => (await cases()).find(c => c.title === title) || null;
  const rowTitles = () => evaluate(`[...document.querySelectorAll("#tcList .tc-row")].map(r => {
    const t = r.querySelector(".tc-title"); return t ? t.textContent.trim() : ""; })`);
  const rowIds = () => evaluate(`[...document.querySelectorAll("#tcList .tc-row")].map(r => r.dataset.tcOpen)`);

  const drag = (fromSel, toSel, zone) => evaluate(`(() => {
    const from = document.querySelector(${JSON.stringify(fromSel)});
    const to = document.querySelector(${JSON.stringify(toSel)});
    if(!from || !to) return { error:"missing", from:!!from, to:!!to };
    try{ from.scrollIntoView({ block:"center" }); }catch(e){}
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles:true, cancelable:true, dataTransfer:dt }));
    const r = to.getBoundingClientRect();
    const y = ${zone === "into" ? "r.top + r.height/2" : zone === "before" ? "r.top + r.height*0.2" : "r.top + r.height*0.8"};
    to.dispatchEvent(new DragEvent("dragover", { bubbles:true, cancelable:true, dataTransfer:dt, clientX:r.left+r.width/2, clientY:y }));
    const cls = to.className;
    const banner = (document.getElementById("tcDropBanner")||{}).textContent || "";
    to.dispatchEvent(new DragEvent("drop", { bubbles:true, cancelable:true, dataTransfer:dt, clientX:r.left+r.width/2, clientY:y }));
    from.dispatchEvent(new DragEvent("dragend", { bubbles:true, cancelable:true, dataTransfer:dt }));
    return { cls, banner };
  })()`);

  console.log("项目目录多级 + 嵌套分组 E2E\n  地址：" + BASE);
  await setViewport(1440, 900, false);
  await login(USER);

  const picked = await api(`
    const reqs = await API.get("/api/reqs", { limit:200 });
    const list = (reqs && (reqs.items || reqs)) || [];
    let best = null;
    for(const r of list){
      if(r.archivedAt) continue;
      const st = await API.get("/api/test-cases/stats", { reqId:r.id });
      const total = (st && st.total) || 0;
      if(total > 0 && (!best || total > best.total)) best = { id:r.id, name:r.name, total };
    }
    return best;
  `);
  if(!picked) throw new Error("演示空间里没有带用例的项目");
  reqId = picked.id; reqName = picked.name;
  console.log("  项目：" + reqName + "（" + picked.total + " 条用例）");
  await setSelect("tcReq", reqId);
  await sleep(900);

  /* ---------- 数据准备（API，前缀隔离） ---------- */
  /* 固定前缀 + 失败不清理会留残留：开跑前先按同一前缀清一遍，保证重复运行幂等 */
  const preClean = await api(`
    const reqId = ${JSON.stringify(reqId)};
    const arr = x => (x && (x.items || x)) || [];
    const out = { cases:0, sets:0, nodes:0 };
    for(const c of arr(await API.get("/api/test-cases", { reqId, limit:200 })))
      if(c.title && c.title.indexOf(${JSON.stringify(PREFIX)}) === 0){ await API.del("/api/test-cases/" + c.id); out.cases++; }
    for(const s of arr(await API.get("/api/case-sets", { reqId })).filter(x => x.name && x.name.indexOf(${JSON.stringify(SET_PREFIX)}) === 0).sort((a,b) => b.level - a.level))
      { await API.del("/api/case-sets/" + s.id); out.sets++; }
    for(const n of arr(await API.get("/api/test-modules", { reqId })).filter(x => x.name && x.name.indexOf(${JSON.stringify(PREFIX)}) === 0).sort((a,b) => b.level - a.level))
      { await API.del("/api/test-modules/" + n.id); out.nodes++; }
    return out;
  `);
  if(preClean.cases || preClean.sets || preClean.nodes){
    console.log("  清理上轮残留：用例 " + preClean.cases + " / 分组 " + preClean.sets + " / 目录 " + preClean.nodes);
  }
  const setup = await api(`
    const out = { nodes:[], cases:[] };
    const reqId = ${JSON.stringify(reqId)};
    const root = await API.post("/api/test-modules", { reqId, name: "${PREFIX}-容器" });
    out.nodes.push(root);
    for(const n of ["甲","乙","丙"]){
      const node = await API.post("/api/test-modules", { reqId, name: "${PREFIX}-" + n, parentId: root.id });
      out.nodes.push(node);
    }
    for(let i = 1; i <= 4; i++){
      const c = await API.post("/api/test-cases", { reqId, title: "${PREFIX}用例-" + i, moduleId: out.nodes[1].id, priority: "P1" });
      out.cases.push(c);
    }
    return out;
  `);
  setup.nodes.forEach(n => created.nodes.push(n.id));
  setup.cases.forEach(c => created.cases.push(c.id));
  const nodeA = setup.nodes[1], nodeB = setup.nodes[2], nodeC = setup.nodes[3];
  const originalOrder = await orderIds(nodeA.id);
  assert(originalOrder.length === 4, "准备 4 条用例挂在「" + PREFIX + "-甲」（实际 " + originalOrder.length + "）");

  /* ===================== A 面板结构 ===================== */
  await section("[A] 目录入口在筛选条 + 弹层内维护", async () => {
    await setSelect("tcReq", reqId);
    await waitFor(`document.querySelectorAll("#tcList .tc-row").length > 0`, "用例行");
    const entry = await evaluate(`(() => ({
      visible: !document.getElementById("tcDirFilter").hidden,
      label: document.getElementById("tcDirBtnLabel").textContent,
      panel: !document.getElementById("tcSidePanel").hidden,
      tabs: document.querySelectorAll("#tcSidePanel .tc-side-tabs").length
    }))()`);
    assert(entry.visible && entry.label === "目录：全部", "目录筛选入口在筛选条，默认「全部」");
    assert(entry.panel && entry.tabs === 0, "左栏只剩分组，默认展开");
    await openDirSide();
    const rows = await evaluate(`[...document.querySelectorAll("#tcDirList [data-tc-dir]")].map(el => ({
      id:el.dataset.tcDir, name:(el.querySelector(".tc-dir-name")||{}).textContent||"",
      drag:el.getAttribute("draggable"), acts:el.querySelectorAll(".tc-dir-acts button").length,
      indent:el.style.marginLeft }))`);
    const root = rows.find(r => r.name === PREFIX + "-容器");
    const child = rows.find(r => r.name === PREFIX + "-甲");
    assert(root && child, "项目里已有目录直接出现在筛选弹层（同一个项目目录）");
    assert(root && root.drag === "true" && root.acts >= 3, "可写成员有拖拽与新建子目录 / 改名 / 删除入口");
    assert(child && child.indent === "14px", "子目录按层级缩进（" + (child && child.indent) + "）");
    const foot = await evaluate(`(document.getElementById("tcDirFoot")||{}).textContent || ""`);
    assert(/显示子目录用例/.test(foot), "弹层底部有「显示子目录用例」开关");
    await pickDir(nodeA.id);
    await waitFor(`JSON.stringify([...document.querySelectorAll("#tcList .tc-row")].map(r => r.dataset.tcOpen).sort())
      === JSON.stringify(${JSON.stringify(originalOrder.slice().sort())})`, "按目录筛选");
    const picked = await evaluate(`(() => ({
      open: !document.getElementById("tcDirMenu").hidden,
      label: document.getElementById("tcDirBtnLabel").textContent }))()`);
    assert(!picked.open && picked.label.indexOf(PREFIX + "-甲") !== -1, "选中目录后弹层收起，入口显示目录名（" + picked.label + "）");
    const label = await evaluate(`(document.querySelector("#tcList .tc-row .tc-mod")||{}).textContent || ""`);
    assert(label.indexOf(PREFIX + "-容器 / " + PREFIX + "-甲") >= 0, "用例行显示完整目录路径：" + label);
    await shot("a-dir-filter.png");
  });

  /* ===================== B 嵌套分组 ===================== */
  let parentSet = null, childSet = null, soloSet = null;
  await section("[B] 新建父组 → 子组继承可见范围 → 计数去重 → 开关过滤", async () => {
    await openSetSide();
    await click("[data-tc-set-new]");
    await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建分组弹窗");
    await setInput("#csName", SET_PREFIX + "-父组");
    await click('input[name="csVis"][value="personal"]');
    await click("#btnSaveCaseSet");
    await waitFor(`!document.getElementById("dlgCaseSet").classList.contains("open")`, "父组保存", 12000);
    parentSet = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(SET_PREFIX + "-父组")}) || null; })()`, "父组可见");
    created.sets.push(parentSet.id);
    assert(parentSet.visibility === "personal" && parentSet.level === 1, "父组创建成功（仅自己可见 · 顶级）");
    try{
      await waitFor(`!!document.querySelector('[data-tc-set-add="${parentSet.id}"]')`, "父组子分组按钮", 30000);
    }catch(e){
      /* 面板没刷出来时把现场打出来：是停在骨架、报错，还是渲染了旧列表 */
      const diag = await evaluate(`(() => ({
        panel: !document.getElementById("tcSidePanel").hidden,
        skeleton: !!document.querySelector("#tcSideBody .skel-row"),
        err: (document.querySelector("#tcSideBody .tc-side-empty")||{}).textContent || "",
        rows: [...document.querySelectorAll("#tcSideBody [data-tc-set]")].map(el => el.dataset.tcSet)
      }))()`);
      throw new Error(e.message + "；面板现场 " + JSON.stringify(diag));
    }

    await click(`[data-tc-set-add="${parentSet.id}"]`);
    await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建子分组弹窗");
    const dlg = await evaluate(`({
      title:(document.getElementById("caseSetTitle")||{}).textContent||"",
      hint:(document.getElementById("csParentHint")||{}).textContent||"",
      hintHidden:document.getElementById("csParentHint").hidden,
      visDisabled:[...document.querySelectorAll('input[name="csVis"]')].every(r => r.disabled),
      checked:[...document.querySelectorAll('input[name="csVis"]')].filter(r => r.checked).map(r => r.value)
    })`);
    assert(/新建子分组 · E2E分组-父组/.test(dlg.title), "弹窗标题标出父组：" + dlg.title);
    assert(!dlg.hintHidden && /继承/.test(dlg.hint), "提示可见范围随父组继承：" + dlg.hint);
    assert(dlg.visDisabled && dlg.checked[0] === "personal", "子组可见范围只读且预选父组范围（personal）");
    await setInput("#csName", SET_PREFIX + "-子组");
    await click("#btnSaveCaseSet");
    await waitFor(`!document.getElementById("dlgCaseSet").classList.contains("open")`, "子组保存", 12000);
    childSet = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(SET_PREFIX + "-子组")}) || null; })()`, "子组可见");
    created.sets.push(childSet.id);
    assert(childSet.parentId === parentSet.id && childSet.level === 2 && childSet.visibility === "personal",
      "子组落在父组下并继承可见范围（level=2 / personal）");
    const indent = await evaluate(`(() => { const el = document.querySelector('[data-tc-set="${childSet.id}"]');
      return el ? el.style.marginLeft : ""; })()`);
    assert(indent === "14px", "子组在面板里缩进显示（" + indent + "）");

    /* 用例拖到子组 = 加入（原目录保留，多归属） */
    const firstCase = await caseByTitle(PREFIX + "用例-1");
    await drag(`.tc-row[data-tc-open="${firstCase.id}"]`, `[data-tc-set="${childSet.id}"]`, "into");
    await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      const s = ((r && (r.items || r)) || []).find(x => x.id === ${JSON.stringify(childSet.id)});
      return s && s.caseCount === 1; })()`, "用例加入子组");
    const stillInDir = await caseByTitle(PREFIX + "用例-1");
    assert(stillInDir && stillInDir.moduleId === nodeA.id, "加入分组不改变目录归属（原目录保留）");
    assert(/已加入分组/.test(await toastText()), "加入分组有明确反馈：" + (await toastText()));

    /* 父组计数按子树去重 + 开关过滤 */
    parentSet = await setByName(SET_PREFIX + "-父组");
    childSet = await setByName(SET_PREFIX + "-子组");
    assert(parentSet.caseCount === 0 && parentSet.subtreeCount === 1,
      "父组直接成员 0 / 子树去重 1（实际 " + parentSet.caseCount + " / " + parentSet.subtreeCount + "）");
    await click(`[data-tc-set-pick="${parentSet.id}"]`);
    await waitFor(`!!document.getElementById("tcSetSub")`, "父组子分组开关");
    const sw = await evaluate(`(() => { const b = document.getElementById("tcSetSub");
      return { checked:b.getAttribute("aria-checked"), text:b.textContent.trim() }; })()`);
    assert(/显示子分组用例/.test(sw.text), "选中父组后出现「显示子分组用例」开关");
    await waitFor(`document.querySelectorAll("#tcList .tc-row").length === 1`, "父组默认含子组用例");
    assert(await evaluate(`document.querySelectorAll("#tcList .tc-row").length`) >= 1, "默认含子组：父组视图能看到子组用例");
    await click("#tcSetSub");
    await waitFor(`document.getElementById("tcSetSub").getAttribute("aria-checked") === "false"`, "关闭子组用例");
    await sleep(700);
    assert((await evaluate(`document.querySelectorAll("#tcList .tc-row").length`)) === 0, "关闭后父组只统计直接成员（0 条）");
    await click("#tcSetSub");
    await sleep(700);
    await shot("b-nested-groups.png");

    await click("[data-tc-set-new]");
    await waitFor(`document.getElementById("dlgCaseSet").classList.contains("open")`, "新建独立组");
    await setInput("#csName", SET_PREFIX + "-独立组");
    await click("#btnSaveCaseSet");
    await waitFor(`!document.getElementById("dlgCaseSet").classList.contains("open")`, "独立组保存", 12000);
    soloSet = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      return ((r && (r.items || r)) || []).find(s => s.name === ${JSON.stringify(SET_PREFIX + "-独立组")}) || null; })()`, "独立组可见");
    created.sets.push(soloSet.id);
    assert(soloSet.visibility === "team" && soloSet.level === 1, "独立组默认团队共享、顶级");

    /* 分组拖到另一个分组中间 = 改父级（继承可见范围） */
    const d1 = await drag(`[data-tc-set-drag="${soloSet.id}"]`, `[data-tc-set="${parentSet.id}"]`, "into");
    assert(/成为子分组（继承可见范围）/.test(d1.banner || ""), "拖拽中横幅说明「成为子分组（继承可见范围）」：" + d1.banner);
    soloSet = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      const s = ((r && (r.items || r)) || []).find(x => x.id === ${JSON.stringify(soloSet.id)});
      return s && s.parentId ? s : null; })()`, "独立组改父级");
    assert(soloSet.parentId === parentSet.id && soloSet.visibility === "personal",
      "独立组挂到父组下并继承可见范围（team → personal）");
    assert(/可见范围随父组/.test(await toastText()), "改父级有反馈并说明可见范围：" + (await toastText()));
    /* 等面板按新结构重渲染后再拖，避免拿旧父子关系做落点判断 */
    await waitFor(`(() => { const el = document.querySelector('[data-tc-set="${soloSet.id}"]');
      return !!el && el.style.marginLeft === "14px"; })()`, "面板刷新新层级");

    /* 同级分组上下拖 = 排序：把子组拖到独立组之后 */
    const d2 = await drag(`[data-tc-set-drag="${childSet.id}"]`, `[data-tc-set="${soloSet.id}"]`, "after");
    assert(/排到它后面/.test(d2.banner || ""), "拖到下半区提示「排到它后面」：" + d2.banner);
    const siblingOrder = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/case-sets", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      const kids = ((r && (r.items || r)) || []).filter(s => s.parentId === ${JSON.stringify(parentSet.id)})
        .sort((a,b) => a.sortOrder - b.sortOrder).map(s => s.name);
      return (kids.length === 2 && kids[1] === ${JSON.stringify(SET_PREFIX + "-子组")}) ? kids : null; })()`, "分组同级排序");
    assert(siblingOrder[0] === SET_PREFIX + "-独立组", "同级顺序更新为 " + JSON.stringify(siblingOrder));
    /* 等面板按新顺序重渲染再测成环，避免在刷新途中用空的树做落点判断 */
    await waitFor(`(() => { const items = [...document.querySelectorAll("#tcSideBody [data-tc-set]")];
      const solo = document.querySelector('[data-tc-set="${soloSet.id}"]');
      const child = document.querySelector('[data-tc-set="${childSet.id}"]');
      return !!solo && !!child && items.indexOf(solo) < items.indexOf(child); })()`, "面板刷新同级顺序");
    await sleep(400);

    /* 成环：把父组拖到自己的子组上，落点直接不成立 */
    const d3 = await drag(`[data-tc-set-drag="${parentSet.id}"]`, `[data-tc-set="${soloSet.id}"]`, "into");
    /* 无落点时横幅回落到通用说明文案（里面也有「成为子分组」字样），
       所以判「有没有落到具体目标」：目标组名不能出现在横幅里 */
    assert(!/drop-into/.test(d3.cls || "") && (d3.banner || "").indexOf(soloSet.name) === -1,
      "父组拖到自己的子组上不出现落点（禁止成环）：" + JSON.stringify(d3));
    parentSet = await setByName(SET_PREFIX + "-父组");
    assert(parentSet.parentId === "" && parentSet.level === 1, "成环拖拽后父组仍在顶级");
    await shot("b-drag-feedback.png");
  });

  /* ===================== C 手动排序 ===================== */
  await section("[C] 手动排序：拖动用例行 → 落库 → 刷新仍在；有筛选不给入口", async () => {
    /* 清掉 B 段选中的分组筛选，回到「目录 甲」的单一口径 */
    await openSetSide();
    if(await evaluate(`!!document.querySelector('[data-tc-set-pick="${parentSet.id}"][aria-pressed="true"]')`)){
      await click(`[data-tc-set-pick="${parentSet.id}"]`);
      await sleep(600);
    }
    await openDirSide();
    await pickDir(nodeA.id);
    await waitFor(`document.querySelectorAll("#tcList .tc-row").length === 4`, "目录 甲 的 4 条用例");
    await setSelect("tcSort", "manual");
    await waitFor(`!document.getElementById("tcList").hidden`, "手动排序列表");
    await sleep(900);
    const withFilter = await evaluate(`(() => {
      const s = document.getElementById("tcSort");
      return { value:s.value, title:s.title, rows:document.querySelectorAll("#tcList [data-tc-order-row]").length }; })()`);
    assert(withFilter.value === "manual" && /手动排序/.test(withFilter.title || ""), "排序选「手动排序」并说明适用范围");
    assert(withFilter.rows === 4, "当前目录下 4 行都带排序入口（实际 " + withFilter.rows + "）");
    const before = await rowIds();
    const [a, , , d] = before;
    const dr = await drag(`.tc-row[data-tc-order-row="${d}"]`, `#tcList .tc-row[data-tc-order-row="${a}"]`, "before");
    assert(/排到它前面/.test(dr.banner || ""), "拖动中提示「排到它前面」：" + dr.banner);
    const expect = [d, before[0], before[1], before[2]];
    const afterApi = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-cases/order", { reqId:${JSON.stringify(reqId)}, moduleId:${JSON.stringify(nodeA.id)}, probe:Date.now() });
      const ids = (r && (r.items || r)) || [];
      return JSON.stringify(ids) === JSON.stringify(${JSON.stringify(expect)}) ? ids : null; })()`, "手动排序落库");
    assert(JSON.stringify(afterApi) === JSON.stringify(expect), "服务端顺序按拖拽结果重写");
    await waitFor(`JSON.stringify([...document.querySelectorAll("#tcList .tc-row")].map(r => r.dataset.tcOpen))
      === JSON.stringify(${JSON.stringify(expect)})`, "界面刷新新顺序");
    await shot("c-manual-order.png");

    await call("Page.navigate", { url: BASE + "/#/testcases?probe=" + Date.now() });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.currentWs && rt.reqsLoaded)`, "刷新后初始化", 25000);
    await waitFor(`document.body.dataset.view === "testcases" && !!document.getElementById("tcReq")`, "用例页");
    await setSelect("tcReq", reqId);
    await sleep(900);
    await openDirSide();
    await pickDir(nodeA.id);
    await waitFor(`document.querySelectorAll("#tcList .tc-row").length === 4`, "刷新后目录筛选");
    await setSelect("tcSort", "manual");
    await sleep(900);
    const reloadIds = await rowIds();
    assert(JSON.stringify(reloadIds) === JSON.stringify(expect), "整页刷新后仍为拖拽后的手动顺序");
    assert((await evaluate(`document.querySelectorAll("#tcList [data-tc-order-row]").length`)) === 4,
      "刷新后手动排序入口仍在（口径一致）");

    /* 有其它筛选时不给排序入口：搜索一个词 */
    await setInput("#tcSearch", "E2E");
    await sleep(900);
    const screened = await evaluate(`document.querySelectorAll("#tcList [data-tc-order-row]").length`);
    assert(screened === 0, "带搜索条件时不给排序入口（避免范围不一致）");
    const orderUntouched = await orderIds(nodeA.id);
    assert(JSON.stringify(orderUntouched) === JSON.stringify(expect), "筛选不影响已保存顺序");
    await setInput("#tcSearch", "");
    await sleep(700);
  });

  /* ===================== D 批量改目录 ===================== */
  await section("[D] 批量改目录 = 移动归属（单归属，编号不变）", async () => {
    const moving = await caseByTitle(PREFIX + "用例-4");
    await openDirSide();
    await pickDir(nodeA.id);
    await waitFor(`document.querySelectorAll("#tcList .tc-row").length === 4`, "目录 甲 的 4 条用例");
    await setSelect("tcSort", "no");
    await sleep(600);
    await evaluate(`(() => { const b = document.querySelector('.tc-row[data-tc-open="${moving.id}"] [data-tc-pick]'); if(b) b.click(); return !!b; })()`);
    await sleep(500);
    assert(await evaluate(`!document.getElementById("btnTcBatchEdit").disabled`), "勾选后「改模块」可用");
    await click("#btnTcBatchEdit");
    await waitFor(`document.getElementById("dlgCaseBatch").classList.contains("open")`, "批量改模块弹框");
    const opt = await evaluate(`(() => {
      const o = [...document.getElementById("bModule").options].find(x => x.value === ${JSON.stringify(nodeB.id)});
      return o ? { text:o.textContent, path:o.dataset.path || "" } : null; })()`);
    assert(opt && opt.path === PREFIX + "-容器 / " + PREFIX + "-乙", "目录下拉给出完整路径：" + JSON.stringify(opt));
    await setSelect("bModule", nodeB.id);
    await click("#btnBatchSave");
    await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-cases", { reqId:${JSON.stringify(reqId)}, limit:200, probe:Date.now() });
      const c = ((r && (r.items || r)) || []).find(x => x.id === ${JSON.stringify(moving.id)});
      return c && c.moduleId === ${JSON.stringify(nodeB.id)}; })()`, "用例移动落库");
    const movedCase = await caseByTitle(PREFIX + "用例-4");
    assert(movedCase.id === moving.id && movedCase.caseNo === moving.caseNo, "只改目录归属，编号不变");
    await click("#btnTcBatchClear");
    await sleep(400);
    await openDirSide();
    await pickDir(nodeB.id);
    await waitFor(`!!document.querySelector('.tc-row[data-tc-open="${moving.id}"]')`, "目录 乙 下能看到移动后的用例");
    await shot("d-moved-to-directory.png");
  });

  /* ===================== E 目录拖拽 ===================== */
  await section("[E] 目录拖到中间＝改父级 / 上下＝同级排序 / 删除守卫", async () => {
    await openDirSide();
    const d = await drag(`[data-tc-dir-drag="${nodeC.id}"]`, `[data-tc-dir="${nodeB.id}"]`, "into");
    assert(/成为子目录/.test(d.banner || ""), "拖拽中提示「成为子目录」：" + d.banner);
    const nested = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-modules", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      const n = ((r && (r.items || r)) || []).find(x => x.id === ${JSON.stringify(nodeC.id)});
      return n && n.parentId === ${JSON.stringify(nodeB.id)} ? n : null; })()`, "目录改父级");
    assert(nested.level === 3, "目录挂到「乙」下成为第 3 级（level=" + nested.level + "）");
    const indent = await waitFor(`(() => { const el = document.querySelector('[data-tc-dir="${nodeC.id}"]');
      return el && el.style.marginLeft === "28px" ? el.style.marginLeft : null; })()`, "目录新层级缩进");
    assert(indent === "28px", "新层级缩进同步（" + indent + "）");

    /* 同级排序：甲拖到乙之后（乙现在带一个子目录） */
    await sleep(500);
    const d2 = await drag(`[data-tc-dir-drag="${nodeA.id}"]`, `[data-tc-dir="${nodeB.id}"]`, "after");
    assert(/排到它后面/.test(d2.banner || ""), "目录拖到下半区提示「排到它后面」：" + d2.banner);
    const kids = await waitFor(`(async () => { const { API } = await import("./js/core/api.js");
      const r = await API.get("/api/test-modules", { reqId:${JSON.stringify(reqId)}, probe:Date.now() });
      const list = ((r && (r.items || r)) || []).filter(n => n.parentId === ${JSON.stringify(created.nodes[0])})
        .sort((a,b) => a.sortOrder - b.sortOrder).map(n => n.name);
      return (list[0] === ${JSON.stringify(PREFIX + "-乙")} && list[1] === ${JSON.stringify(PREFIX + "-甲")}) ? list : null; })()`, "目录同级排序");
    assert(JSON.stringify(kids) === JSON.stringify([PREFIX + "-乙", PREFIX + "-甲"]),
      "同级目录顺序更新为 " + JSON.stringify(kids));

    /* 删除守卫：乙下还有子目录 */
    await click(`[data-tc-dir-del="${nodeB.id}"]`);
    await sleep(600);
    assert(/下还有 子目录/.test(await toastText()), "有子目录的目录删除被拦下并说明原因：" + (await toastText()));
    assert(!!(await nodeByName(PREFIX + "-乙")), "被拦下的目录仍在");
    await shot("e-directory-drag.png");
  });

  /* ===================== F 权限 ===================== */
  await section("[F] 只读成员：无维护入口 + 服务端拒绝", async () => {
    await clearToasts();
    await login(VIEWER);
    await setSelect("tcReq", reqId);
    await sleep(900);
    await openDirSide();
    const roDir = await evaluate(`(() => ({
      nodes:document.querySelectorAll("#tcDirList [data-tc-dir]").length,
      drags:document.querySelectorAll("#tcDirList [draggable='true']").length,
      acts:document.querySelectorAll("#tcDirList .tc-dir-acts").length,
      add:document.querySelectorAll("#tcDirMenu [data-tc-dir-new]").length }))()`);
    assert(roDir.nodes > 0 && roDir.drags === 0 && roDir.acts === 0, "只读成员能看到目录但不能拖拽 / 维护");
    await openSetSide();
    const roSet = await evaluate(`(() => ({
      items:document.querySelectorAll("#tcSideBody [data-tc-set]").length,
      news:document.querySelectorAll("[data-tc-set-new]").length,
      drags:document.querySelectorAll("#tcSideBody [draggable='true']").length }))()`);
    assert(roSet.items > 0 && roSet.news === 0 && roSet.drags === 0, "只读成员能看到分组但没有新建 / 拖拽入口");
    await shot("f-readonly.png");

    const denied = [
      await apiTry(`await API.post("/api/case-sets", { reqId:${JSON.stringify(reqId)}, name:"E2E分组-越权", visibility:"team", kind:"manual" });`),
      await apiTry(`await API.put("/api/test-cases/order", { reqId:${JSON.stringify(reqId)},
        moduleId:${JSON.stringify(nodeA.id)}, moduleSub:false, ids:${JSON.stringify(originalOrder)} });`),
      await apiTry(`await API.del("/api/test-modules/" + ${JSON.stringify(nodeB.id)});`)
    ];
    denied.forEach((r, i) => assert(r.ok === false && r.code === 403,
      "越权写被服务端拒绝（" + ["新建分组", "用例排序", "删除目录"][i] + " 403）：" + JSON.stringify(r)));
    assert(!!(await nodeByName(PREFIX + "-乙")), "被拒的删除未生效");
  });

  /* ===================== 收尾 ===================== */
  console.log("\n[收尾] 清理 / 控制台 / 网络");
  await clearToasts();
  await login(USER);
  const cleanup = await api(`
    const reqId = ${JSON.stringify(reqId)};
    const arr = x => (x && (x.items || x)) || [];
    const out = { cases:0, sets:0, nodes:0, left:[] };
    const cs = await API.get("/api/test-cases", { reqId, limit:200 });
    for(const c of arr(cs)) if(c.title && c.title.indexOf(${JSON.stringify(PREFIX)}) === 0){ await API.del("/api/test-cases/" + c.id); out.cases++; }
    const ss = await API.get("/api/case-sets", { reqId });
    for(const s of arr(ss).filter(x => x.name && x.name.indexOf(${JSON.stringify(SET_PREFIX)}) === 0).sort((a,b) => b.level - a.level)){
      await API.del("/api/case-sets/" + s.id); out.sets++;
    }
    const ns = await API.get("/api/test-modules", { reqId });
    for(const n of arr(ns).filter(x => x.name && x.name.indexOf(${JSON.stringify(PREFIX)}) === 0).sort((a,b) => b.level - a.level)){
      await API.del("/api/test-modules/" + n.id); out.nodes++;
    }
    const cs2 = arr(await API.get("/api/test-cases", { reqId, limit:200 }));
    const ss2 = arr(await API.get("/api/case-sets", { reqId }));
    const ns2 = arr(await API.get("/api/test-modules", { reqId }));
    out.left = cs2.filter(c => c.title && c.title.indexOf(${JSON.stringify(PREFIX)}) === 0).map(c => c.title)
      .concat(ss2.filter(s => s.name && s.name.indexOf(${JSON.stringify(SET_PREFIX)}) === 0).map(s => s.name))
      .concat(ns2.filter(n => n.name && n.name.indexOf(${JSON.stringify(PREFIX)}) === 0).map(n => n.name));
    return out;
  `);
  assert(cleanup.cases === 4 && cleanup.nodes === 4, "临时用例与目录全部删除（用例 " + cleanup.cases + " / 目录 " + cleanup.nodes + "）");
  assert(cleanup.sets >= 3, "临时分组全部删除（" + cleanup.sets + " 个）");
  assert(cleanup.left.length === 0, "无 E2E 前缀残留" + (cleanup.left.length ? "：" + cleanup.left.join("、") : ""));

  await sleep(400);
  assert(cdp.errors.length === 0, "控制台零报错" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 5).join(" | ") : ""));
  assert(cdp.netErrors.length === 0, "全程无未登记 4xx/5xx" + (cdp.netErrors.length ? "：" + cdp.netErrors.slice(0, 5).join(" | ") : ""));
  assert(cdp.denials.length === 3, "只读越权探针恰好 3 次 403（记录 " + cdp.denials.length + "）" +
    (cdp.denials.length ? "：" + cdp.denials.join(" | ") : ""));

  console.log("\n结果：" + (failed === 0 ? "全部通过（" + passed + " 项）" : failed + " 项失败 / " + passed + " 项通过"));
  console.log("截图目录：" + SHOT_DIR);
  await call("Browser.close").catch(() => {});
  ws.close();
  proc.kill();
  process.exit(failed === 0 ? 0 : 1);
}catch(err){
  console.error("E2E 运行异常：" + (err && err.stack || err));
  try{ proc.kill(); }catch(e){}
  process.exit(2);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
