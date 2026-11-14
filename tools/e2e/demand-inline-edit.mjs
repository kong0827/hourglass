/* 需求池列表行内编辑 E2E（仿 tools/e2e/tree-view.mjs，Node 18+ 原生 CDP）
   覆盖：模块 / 来源新增行内编辑、期望交付同值不重复保存、行内刷新不闪骨架且不塌回第一页、
   只读行不出控件、控制台报错。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dem-inline-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0, skipped = 0;
const pass = m => console.log("  PASS " + m);
const skip = m => { skipped++; console.log("  SKIP " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  let port = null;
  for(let i = 0; i < 60 && !port; i++){
    try{ port = parseInt(fs.readFileSync(path.join(tmp, "DevToolsActivePort"), "utf8").split("\n")[0], 10); }
    catch(e){ await sleep(200); }
  }
  if(!port) throw new Error("Chrome CDP 未就绪");
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
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png" });
    const out = path.join("tools", "shots", name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(r.data, "base64"));
    return out;
  };
  /* 演示数据要能被反复跑：改过的字段在全部断言后统一还原。
     不能边改边还原——还原会抬 revision，和用例自身的保存撞出 409。 */
  const pendingRestores = [];
  const restoreDemand = (id, patch) => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const d = await API.get("/api/demands/" + ${JSON.stringify(id)});
    const body = {
      reqId: d.reqId, title: d.title, description: d.description, acceptText: d.acceptText,
      source: d.source, itemKind: d.itemKind, categoryId: d.categoryId, priority: d.priority,
      expectDate: d.expectDate, plannedStart: d.plannedStart, plannedEnd: d.plannedEnd,
      revision: d.revision, wsjfBusiness: d.wsjfBusiness, wsjfUrgency: d.wsjfUrgency,
      wsjfRisk: d.wsjfRisk, wsjfEffort: d.wsjfEffort
    };
    Object.assign(body, ${JSON.stringify(patch)});
    await API.put("/api/demands/" + ${JSON.stringify(id)}, body);
    return true;
  })()`);

  console.log("需求池列表行内编辑 E2E\n  地址：" + BASE);
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
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  }catch(e){
    const st = await evaluate(`import("./js/core/state.js").then(({rt}) => ({ user: rt.currentUser && rt.currentUser.username, ws: rt.currentWs && rt.currentWs.id, reqsLoaded: rt.reqsLoaded, reqs: rt.reqList.length, view: document.body.dataset.view, hash: location.hash })).catch(err => ({ err: String(err) }))`);
    throw new Error("应用初始化未完成：" + JSON.stringify(st));
  }
  pass("登录 " + USER);

  /* 1. 进入需求池列表形态 */
  await evaluate(`location.hash = "#/demands"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "demands"`, "切换到需求池");
  await evaluate(`(() => { const b = document.querySelector('#demandsPage [data-dem-mode="table"]'); if(b) b.click(); return !!b; })()`);
  await waitFor(`!!document.querySelector("#demandBody table.manager-tbl")`, "列表表格渲染", 20000);

  /* 模块与来源不在默认显示列里，走真实「显示字段」弹层勾选，顺带验证入口可达 */
  await evaluate(`(() => { const b = document.getElementById("btnDemandColumns"); if(b) b.click(); return !!b; })()`);
  await waitFor(`!!document.querySelector(".column-pref-modal")`, "显示字段弹层");
  await evaluate(`(() => {
    ["category", "source"].forEach(k => {
      const cb = document.querySelector('.column-pref-modal [data-pref-key="' + k + '"] [data-pref-toggle]');
      if(cb && !cb.checked) cb.click();
    });
    document.querySelector(".column-pref-modal [data-pref-save]").click();
    return true;
  })()`);
  await waitFor(`!document.querySelector(".column-pref-modal")`, "显示字段保存");
  await waitFor(`[...document.querySelectorAll("#demandBody thead th")].some(t => t.textContent.trim() === "模块")`, "模块列出现", 20000);
  const heads = await evaluate(`[...document.querySelectorAll("#demandBody thead th")].map(t => t.textContent.trim())`);
  assert(heads.includes("模块") && heads.includes("来源"), "表头含模块与来源（" + heads.join("/") + "）");

  /* 记录写请求与骨架插入，用于验证「同值不保存」「不闪骨架」 */
  await evaluate(`(() => {
    window.__writes = [];
    window.__skel = 0;
    if(!window.__fetchHooked){
      window.__fetchHooked = true;
      const orig = window.fetch;
      window.fetch = function(url, opts){
        const m = (opts && opts.method || "GET").toUpperCase();
        if(m !== "GET") window.__writes.push({ url: String(url), method: m, body: opts && opts.body ? String(opts.body) : null });
        return orig.apply(this, arguments);
      };
    }
    new MutationObserver(muts => {
      for(const m of muts) for(const n of m.addedNodes)
        if(n.nodeType === 1 && (n.classList.contains("skel-row") || n.querySelector && n.querySelector(".skel-row"))) window.__skel++;
    }).observe(document.getElementById("demandBody"), { childList: true, subtree: true });
    return true;
  })()`);

  /* 2. 控件覆盖与外观：可写行出「点开才有选项」的文本触发器，不能是常显下拉；已关闭行只读 */
  const ctl = await evaluate(`(async () => {
    const { columns } = await import("./js/core/list-preferences.js");
    const { rt } = await import("./js/core/state.js");
    const cols = columns("demand-pool");
    const si = cols.indexOf("status");
    const t = document.querySelector("#demandBody table");
    const count = sel => t.querySelectorAll(sel).length;
    const rows = [...t.querySelectorAll("tbody tr")].filter(r => r.querySelector("[data-dem-detail]"));
    /* 状态列渲染成 span.tag 才是真关闭；菜单里的「关闭需求…」是动作文案，不能当状态 */
    const closed = rows.filter(r => {
      const td = r.children[si];
      if(!td || td.querySelector("[data-dem-inline-menu]")) return false;
      return [...td.querySelectorAll("span.tag")].some(s => s.textContent.trim() === "已关闭");
    });
    const pri = t.querySelector('[data-dem-inline-menu="priority"]');
    const priSvg = pri && pri.querySelector("svg");
    return {
      rows: rows.length,
      cats: (rt.categoriesCache || []).length,
      category: count('[data-dem-inline-menu="category"]'),
      source: count("[data-dem-source-btn]"),
      priority: count('[data-dem-inline-menu="priority"]'),
      expect: count('[data-dem-inline-menu="expectDate"]'),
      nativeSelects: count("tbody select"),
      nativeDates: count("tbody input[type=date]"),
      priBorder: pri ? getComputedStyle(pri).borderTopColor : null,
      priArrow: priSvg ? getComputedStyle(priSvg).opacity : null,
      closed: closed.length,
      closedWithCtl: closed.filter(r => r.querySelector("[data-dem-inline-menu],[data-dem-source-btn]")).length
    };
  })()`);
  assert(ctl.rows > 0, `列表有 ${ctl.rows} 行需求`);
  assert(ctl.cats > 0, `模块字典已加载（${ctl.cats} 个模块，直接进需求池也要有候选）`);
  assert(ctl.category > 0, `模块触发器 ${ctl.category} 个`);
  assert(ctl.source > 0, `来源行内按钮 ${ctl.source} 个`);
  assert(ctl.nativeSelects === 0 && ctl.nativeDates === 0,
    `列表里不再有常显的原生下拉/日期框（select ${ctl.nativeSelects}，date ${ctl.nativeDates}）`);
  assert(ctl.priBorder === "rgba(0, 0, 0, 0)" && ctl.priArrow === "0",
    `读态像普通文本：无边框、箭头隐藏（border ${ctl.priBorder}，箭头透明度 ${ctl.priArrow}）`);
  if(!ctl.closed) skip("当前筛选下没有已关闭需求，无法验证只读行");
  else assert(ctl.closedWithCtl === 0, `已关闭需求不出行内控件（${ctl.closed} 行）`);
  await shot("dem-inline-01-table.png");

  /* 2b. 悬停才露箭头与底色；点开才出现选项；Esc 关闭回到读态 */
  const hoverPt = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="priority"]');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverPt.x, y: hoverPt.y, button: "none", clickCount: 0 });
  await sleep(250);
  const hovered = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="priority"]');
    return { border: getComputedStyle(b).borderTopColor, arrow: getComputedStyle(b.querySelector("svg")).opacity };
  })()`);
  assert(hovered.border !== "rgba(0, 0, 0, 0)" && Number(hovered.arrow) > 0.5,
    `悬停才显出底色与箭头（border ${hovered.border}，箭头透明度 ${hovered.arrow}）`);
  await shot("dem-inline-00-hover.png");
  const menuOpen = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="priority"]');
    b.click();
    const m = document.querySelector(".menu [data-dem-inline-pick]");
    return { expanded: b.getAttribute("aria-expanded"), menu: !!m,
             items: m ? m.parentNode.querySelectorAll("[data-dem-inline-pick]").length : 0 };
  })()`);
  assert(menuOpen.menu, "点击优先级后才弹出选项菜单");
  assert(menuOpen.expanded === "true", "触发器展开时 aria-expanded 为 true");
  await sleep(200);
  await shot("dem-inline-00-menu.png");
  await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
  await sleep(300);
  const menuClosed = await evaluate(`({
    menu: !!document.querySelector(".menu [data-dem-inline-pick]"),
    expanded: document.querySelector('#demandBody [data-dem-inline-menu="priority"]').getAttribute("aria-expanded")
  })`);
  assert(!menuClosed.menu && menuClosed.expanded === "false", "Esc 关闭菜单并恢复读态");
  const stMenu = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="status"]');
    if(!b) return null;
    b.click();
    return { count: document.querySelectorAll(".menu [data-dem-status-act]").length,
             expanded: b.getAttribute("aria-expanded") };
  })()`);
  if(!stMenu) skip("当前筛选下没有可写状态的行");
  else{
    assert(stMenu.count > 1, `状态点开列出合法动作（${stMenu.count} 项）`);
    assert(stMenu.expanded === "true", "状态触发器展开时 aria-expanded 为 true");
    await sleep(200);
    await shot("dem-inline-00-status-menu.png");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
    await sleep(200);
  }

  /* 2c. 目标版本 / 所属项目同样点开才出菜单；换版本先要原因，取消不写库 */
  const verInfo = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="version"]');
    if(!b) return null;
    b.click();
    return { id: b.dataset.demId };
  })()`);
  if(!verInfo) skip("当前筛选下没有可改目标版本的行");
  else{
    const verMenu = await waitFor(`(() => {
      const items = [...document.querySelectorAll(".menu [data-dem-ver]")];
      if(!items.length) return null;
      return { items: items.map(i => ({ v: i.dataset.demVer || "", cur: !!i.querySelector(".k") })) };
    })()`, "目标版本菜单");
    assert(verMenu.items.length >= 1, `目标版本菜单点开后加载候选（${verMenu.items.length} 项）`);
    assert(verMenu.items.some(i => i.cur), "目标版本菜单标出当前值");
    const other = verMenu.items.find(i => i.v && !i.cur);
    if(!other){
      skip("没有可切换的目标版本候选");
      await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
      await sleep(200);
    }else{
      await evaluate(`(() => { window.__writes = []; return true; })()`);
      await evaluate(`(() => {
        const btn = [...document.querySelectorAll(".menu [data-dem-ver]")].find(i => i.dataset.demVer === ${JSON.stringify(other.v)});
        if(btn) btn.click();
        return !!btn;
      })()`);
      await waitFor(`!!document.querySelector("[data-prompt-cancel]")`, "调期原因弹层");
      const promptText = await evaluate(`(document.querySelector("[data-prompt-cancel]").closest(".modal-layer") || document.body).textContent.replace(/\\s+/g, " ")`);
      assert(/调整目标版本/.test(promptText) && /调期原因/.test(promptText), "换版本先要求填写调期原因");
      assert(await evaluate(`!window.__writes.some(w => /\\/version$/.test(w.url))`), "取消前没有发出换版本请求");
      await evaluate(`document.querySelector("[data-prompt-cancel]").click(); true`);
      await waitFor(`!document.querySelector("[data-prompt-cancel]")`, "关闭调期原因弹层");
    }
  }
  const projOpen = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="project"]');
    if(!b) return null;
    b.click();
    return { id: b.dataset.demId };
  })()`);
  if(!projOpen) skip("当前筛选下没有可换所属项目的行");
  else{
    const projMenu = await waitFor(`(() => {
      const items = [...document.querySelectorAll(".menu [data-dem-inline-pick]")];
      return items.length ? { n: items.length, cur: items.some(i => !!i.querySelector(".k")) } : null;
    })()`, "所属项目菜单");
    assert(projMenu.n >= 2, `所属项目菜单点开后列出候选（${projMenu.n} 项）`);
    assert(projMenu.cur, "所属项目菜单标出当前值");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
    await sleep(200);
    assert(await evaluate(`!document.querySelector(".menu [data-dem-inline-pick]")`), "Esc 关闭所属项目菜单");
  }

  /* 3. 改模块：菜单选择后落库 + 不闪骨架 */
  const catOpen = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="category"]');
    if(!b) return null;
    b.click();
    return { id: b.dataset.demId, text: b.textContent.trim() };
  })()`);
  let catPick = null;
  if(catOpen){
    await waitFor(`!!document.querySelector(".menu [data-dem-inline-pick]")`, "模块菜单");
    catPick = await evaluate(`(async () => {
      const id = ${JSON.stringify(catOpen.id)};
      const r = await fetch("api/demands/" + id); const j = await r.json(); const d = j.data || j;
      const items = [...document.querySelectorAll(".menu [data-dem-inline-pick]")];
      const next = items.find(i => i.dataset.demInlinePick && i.dataset.demInlinePick !== (d.categoryId || ""));
      return next ? { id, from: d.categoryId || null, to: next.dataset.demInlinePick,
                      toName: next.textContent.replace(/当前$/, "").trim() } : null;
    })()`);
  }
  if(!catPick){
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
    skip("没有可切换的模块候选（项目模块字典为空或只有当前值）");
  }else{
    await evaluate(`(() => { window.__writes = []; window.__skel = 0; return true; })()`);
    await evaluate(`document.querySelector('.menu [data-dem-inline-pick="${catPick.to}"]').click(); true`);
    await waitFor(`window.__writes.some(w => w.method === "PUT" && /\\/api\\/demands\\//.test(w.url))`, "模块 PUT 发出");
    await sleep(1200);
    const catAfter = await evaluate(`(async () => {
      const r = await fetch("api/demands/${catPick.id}", { headers: { "Accept": "application/json" } });
      const j = await r.json();
      const d = j.data || j;
      const cell = document.querySelector('#demandBody [data-dem-inline-menu="category"][data-dem-id="${catPick.id}"]');
      return { server: d.categoryId, cell: cell ? cell.textContent.trim() : null, skel: window.__skel,
               body: window.__writes.map(w => w.method + " " + w.url) };
    })()`);
    assert(catAfter.server === catPick.to, `模块已落库（${catPick.from || "未指定"} → ${catAfter.server}）`);
    assert(catAfter.cell === catPick.toName, "刷新后单元格停在新模块");
    assert(catAfter.skel === 0, "模块保存后没有插入骨架");
    const putBody = await evaluate(`(window.__writes.find(w => w.method === "PUT") || {}).body || ""`);
    const kept = await evaluate(`(async () => {
      const r = await fetch("api/demands/${catPick.id}"); const j = await r.json(); const d = j.data || j;
      return { title: d.title, desc: d.description, accept: d.acceptText,
               wb: d.wsjfBusiness, wu: d.wsjfUrgency, wr: d.wsjfRisk, we: d.wsjfEffort };
    })()`);
    assert(!!kept.title, "整单 PUT 后标题未被清空");
    assert(/"wsjfBusiness"/.test(putBody) && /"acceptText"/.test(putBody), "PUT 回填了 acceptText 与 WSJF 字段（不会误清内容）");
    pendingRestores.push({ id: catPick.id, patch: { categoryId: catPick.from || null } });
  }

  /* 4. 改来源：单元格内就地编辑（不起弹层）；Esc 取消、回车保存、超长截断 */
  const srcPick = await evaluate(`(() => {
    const b = document.querySelector("#demandBody [data-dem-source-btn]");
    return b ? { id: b.dataset.demSourceBtn, text: b.textContent.trim() } : null;
  })()`);
  if(!srcPick){
    skip("当前筛选下没有可写来源的行");
  }else{
    const srcBtn = `#demandBody [data-dem-source-btn="${srcPick.id}"]`;
    const nextSrc = "E2E来源" + Date.now().toString().slice(-5);
    await evaluate(`(() => { window.__writes = []; window.__skel = 0; document.querySelector('${srcBtn}').click(); return true; })()`);
    const opened = await evaluate(`({
      inline: !!document.querySelector("#demandBody .dem-inline-text.inline-edit-field[contenteditable='true']"),
      focused: (document.activeElement || {}).isContentEditable === true,
      dialogs: document.querySelectorAll(".modal-layer.open").length
    })`);
    assert(opened.inline, "来源点开即单元格内编辑");
    assert(opened.dialogs === 0, "来源编辑不弹对话框（当前打开 " + opened.dialogs + " 个）");
    await sleep(300);
    await shot("dem-inline-02-source-inline.png");
    /* Esc 取消：不写库，单元格回到原值 */
    await evaluate(`(() => {
      const el = document.querySelector("#demandBody .dem-inline-text.inline-edit-field");
      el.textContent = "不该保存";
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    const cancelled = await evaluate(`({
      writes: window.__writes.filter(w => w.method === "PUT").length,
      text: (document.querySelector('${srcBtn}') || {}).textContent
    })`);
    assert(cancelled.writes === 0, "来源 Esc 取消不发请求");
    assert((cancelled.text || "").trim() === srcPick.text, "来源 Esc 后单元格回到原值");
    /* 回车保存 */
    await evaluate(`(() => { window.__writes = []; window.__skel = 0;
      document.querySelector('${srcBtn}').click(); return true; })()`);
    await evaluate(`(() => {
      const el = document.querySelector("#demandBody .dem-inline-text.inline-edit-field");
      el.textContent = ${JSON.stringify(nextSrc)};
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    })()`);
    await waitFor(`window.__writes.some(w => w.method === "PUT")`, "来源回车后发出 PUT", 8000);
    await sleep(1200);
    const srcAfter = await evaluate(`(async () => {
      const r = await fetch("api/demands/${srcPick.id}"); const j = await r.json(); const d = j.data || j;
      const b = document.querySelector('${srcBtn}');
      return { server: d.source, cell: b ? b.textContent.trim() : null, skel: window.__skel };
    })()`);
    assert(srcAfter.server === nextSrc, `来源回车保存已落库（${srcAfter.server}）`);
    assert(srcAfter.cell === nextSrc, "刷新后单元格停在新来源");
    assert(srcAfter.skel === 0, "来源保存后没有插入骨架");
    /* 同一字段在详情抽屉里保持一致：概览行就地编辑，不弹输入框；点值与键盘进入都要能编辑 */
    const drawerSrc = "E2E详情" + Date.now().toString().slice(-5);
    await evaluate(`(() => { window.__writes = [];
      document.querySelector('#demandBody [data-dem-detail="${srcPick.id}"]').click(); return true; })()`);
    await waitFor(`!!document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']")`, "详情抽屉打开且来源可编辑");
    const drawerOpened = await evaluate(`({
      value: document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']").textContent.trim(),
      prompt: document.querySelectorAll(".modal-layer.open form.sheet.xs").length
    })`);
    assert(drawerOpened.value === nextSrc, "抽屉来源显示列表刚保存的值");
    assert(drawerOpened.prompt === 0, "抽屉来源不再是输入弹层");
    await evaluate(`(() => {
      document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']").click();
      return true;
    })()`);
    const drawerEditing = await evaluate(`({
      inline: !!document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field[contenteditable='true']"),
      focused: (document.activeElement || {}).isContentEditable === true,
      prompt: document.querySelectorAll(".modal-layer.open form.sheet.xs").length
    })`);
    assert(drawerEditing.inline, "抽屉来源点开即就地编辑");
    assert(drawerEditing.focused, "抽屉来源编辑时焦点落在值上");
    assert(drawerEditing.prompt === 0, "抽屉来源点开不弹输入框");
    await sleep(300);
    await shot("dem-inline-04-detail-source.png");
    /* Esc 取消 → 回到原值且不写库 */
    await evaluate(`(() => {
      const el = document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field");
      el.textContent = "不该保存";
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    const drawerCancelled = await evaluate(`({
      writes: window.__writes.filter(w => w.method === "PUT").length,
      text: document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']").textContent.trim()
    })`);
    assert(drawerCancelled.writes === 0, "抽屉来源 Esc 取消不发请求");
    assert(drawerCancelled.text === nextSrc, "抽屉来源 Esc 后回到原值");
    /* 键盘进入：焦点在概览行上按回车，应直接进入值编辑而不是弹层 */
    const keyboardIn = await evaluate(`(() => {
      const row = document.querySelector(".modal-layer.open.demand-detail [data-dem-fact='source']");
      if(!row) return { row: false };
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return { row: true,
               inline: !!document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field[contenteditable='true']"),
               prompt: document.querySelectorAll(".modal-layer.open form.sheet.xs").length };
    })()`);
    assert(keyboardIn.row && keyboardIn.inline, "抽屉来源可用键盘进入就地编辑");
    assert(keyboardIn.prompt === 0, "键盘进入也不弹输入框");
    /* 回车保存 */
    await evaluate(`(() => {
      const el = document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field");
      el.textContent = ${JSON.stringify(drawerSrc)};
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    })()`);
    await waitFor(`window.__writes.some(w => w.method === "PUT")`, "抽屉来源回车后发出 PUT", 8000);
    await sleep(1200);
    const drawerAfter = await evaluate(`(async () => {
      const r = await fetch("api/demands/${srcPick.id}"); const j = await r.json(); const d = j.data || j;
      const v = document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']");
      return { server: d.source, view: v ? v.textContent.trim() : null,
               editing: !!document.querySelector(".modal-layer.open.demand-detail #demandFacts .inline-edit-field") };
    })()`);
    assert(drawerAfter.server === drawerSrc, `抽屉来源回车保存已落库（${drawerAfter.server}）`);
    assert(drawerAfter.view === drawerSrc, "抽屉保存后概览回到只读并显示新值");
    assert(drawerAfter.editing === false, "抽屉保存后退出编辑态");
    await shot("dem-inline-05-detail-source-saved.png");
    await evaluate(`(() => { const x = document.querySelector(".modal-layer.open.demand-detail [data-dem-x]"); if(x) x.click(); return true; })()`);
    await waitFor(`!document.querySelector(".modal-layer.open.demand-detail")`, "详情抽屉关闭");
    /* 超长：46 字按 40 字截断（对齐服务端 @Size(40)） */
    const longSrc = "长".repeat(46);
    await evaluate(`(() => { window.__writes = []; document.querySelector('${srcBtn}').click(); return true; })()`);
    await evaluate(`(() => {
      const el = document.querySelector("#demandBody .dem-inline-text.inline-edit-field");
      el.textContent = ${JSON.stringify(longSrc)};
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    })()`);
    await waitFor(`window.__writes.some(w => w.method === "PUT")`, "超长来源也发出 PUT", 8000);
    await sleep(1200);
    const capped = await evaluate(`(async () => {
      const r = await fetch("api/demands/${srcPick.id}"); const j = await r.json(); const d = j.data || j;
      return String(d.source || "");
    })()`);
    assert(capped.length === 40 && capped === "长".repeat(40), "来源超 40 字按 40 字截断保存（实际 " + capped.length + " 字）");
    await shot("dem-inline-03-source-saved.png");
    pendingRestores.push({ id: srcPick.id, patch: { source: srcPick.text === "未填写" ? null : srcPick.text } });
  }

  /* 5. 期望交付：点文本才弹日期面板；点同一天不重复保存，换一天正常落库 */
  const expPick = await evaluate(`(() => {
    const b = document.querySelector('#demandBody [data-dem-inline-menu="expectDate"]');
    return b ? { id: b.dataset.demId,
                 text: (b.querySelector(".dem-inline-date-t") || {}).textContent || "" } : null;
  })()`);
  if(!expPick){
    skip("当前筛选下没有可写期望交付的行");
  }else{
    const curDate = await evaluate(`(async () => {
      const r = await fetch("api/demands/${expPick.id}"); const j = await r.json(); const d = j.data || j;
      return String(d.expectDate || "").slice(0, 10);
    })()`);
    assert(expPick.text === (curDate || "待评估"), "期望交付读态显示日期文本（" + expPick.text + "）");
    await evaluate(`(() => { window.__writes = [];
      document.querySelector('#demandBody [data-dem-inline-menu="expectDate"][data-dem-id="${expPick.id}"]').click();
      return true; })()`);
    await waitFor(`!!document.querySelector(".date-pop [data-dp-day]")`, "日期面板打开");
    const dateNative = await evaluate(`document.querySelectorAll("#demandBody input[type=date]").length`);
    assert(dateNative === 0, "列表里没有常显的原生日期框");
    if(curDate){
      await evaluate(`document.querySelector('.date-pop [data-dp-day="${curDate}"]').click(); true`);
      await sleep(900);
      const noop = await evaluate(`window.__writes.filter(w => /expect-date/.test(w.url)).length`);
      assert(noop === 0, "日期面板点同一天不发请求（实际 " + noop + " 次）");
      await evaluate(`(() => {
        document.querySelector('#demandBody [data-dem-inline-menu="expectDate"][data-dem-id="${expPick.id}"]').click();
        return true; })()`);
      await waitFor(`!!document.querySelector(".date-pop [data-dp-day]")`, "日期面板再次打开");
    }
    /* 换一个不同的日期：避开当前值，否则会被同值守卫拦掉 */
    if(!curDate){
      await evaluate(`(() => {
        document.querySelector('#demandBody [data-dem-inline-menu="expectDate"][data-dem-id="${expPick.id}"]').click();
        return true; })()`);
      await waitFor(`!!document.querySelector(".date-pop [data-dp-day]")`, "日期面板打开");
    }
    const nextDate = await evaluate(`(() => {
      const cells = [...document.querySelectorAll(".date-pop [data-dp-day]")];
      const hit = cells.find(c => c.dataset.dpDay !== ${JSON.stringify(curDate)} && !c.disabled && !c.classList.contains("is-out"));
      if(!hit) return null;
      hit.click();
      return hit.dataset.dpDay;
    })()`);
    if(!nextDate){
      skip("日期面板里没有可点的其他日期");
    }else{
      await waitFor(`window.__writes.some(w => /expect-date/.test(w.url))`, "期望交付改值后发请求");
      await sleep(1200);
      const expAfter = await evaluate(`(async () => {
        const r = await fetch("api/demands/${expPick.id}"); const j = await r.json(); const d = j.data || j;
        return String(d.expectDate || "").slice(0, 10);
      })()`);
      assert(expAfter === nextDate, "期望交付改值正常落库（" + expAfter + "）");
      pendingRestores.push({ id: expPick.id, expectDate: curDate || null });
    }
  }

  /* 6. 已加载深度：翻到第二页后改一个字段，列表不塌回第一页。
        演示数据每个空间都不足一页，这里临时补种到超过一页，验证完立即硬删除还原。 */
  let seedIds = [];
  try{
    let moreBtn = await evaluate(`!!document.querySelector("#demandBody [data-dem-more]")`);
    if(!moreBtn){
      const seed = await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        const { rt } = await import("./js/core/state.js");
        const req = rt.reqList.find(r => !r.archivedAt);
        if(!req) return { err: "没有可写项目" };
        const page = await API.get("/api/demands/page", { offset: 0, limit: 1 });
        const need = Math.max(0, 101 - (page.total || 0));
        const ids = [];
        for(let i = 0; i < need; i++){
          const d = await API.post("/api/demands", { reqId: req.id, title: "E2E深度验证-" + (i + 1), itemKind: "其他", priority: "P2" });
          ids.push(d.id);
        }
        return { ids, need, total: page.total };
      })()`);
      if(seed.err || !seed.ids || !seed.ids.length){
        skip("无法补种跨页数据：" + (seed.err || "补种 0 条"));
      }else{
        seedIds = seed.ids;
        console.log(`  （临时补种 ${seed.need} 条需求用于跨页验证，结束后删除）`);
        await evaluate(`import("./js/views/demands.js").then(m => m.loadDemands()).then(() => true)`);
        await waitFor(`!!document.querySelector("#demandBody [data-dem-more]")`, "补种后出现加载更多", 25000);
        moreBtn = true;
      }
    }
    if(moreBtn){
      const before = await evaluate(`document.querySelectorAll("#demandBody tbody tr [data-dem-detail]").length`);
      await evaluate(`document.querySelector("#demandBody [data-dem-more]").click(); true`);
      await waitFor(`document.querySelectorAll("#demandBody tbody tr [data-dem-detail]").length > ${before}`, "加载更多");
      const loaded = await evaluate(`document.querySelectorAll("#demandBody tbody tr [data-dem-detail]").length`);
      const priOpen = await evaluate(`(() => {
        const b = [...document.querySelectorAll('#demandBody [data-dem-inline-menu="priority"]')].pop();
        if(!b) return null;
        b.click();
        return { id: b.dataset.demId };
      })()`);
      let priPick = null;
      if(priOpen){
        await waitFor(`!!document.querySelector(".menu [data-dem-inline-pick]")`, "优先级菜单");
        priPick = await evaluate(`(() => {
          const items = [...document.querySelectorAll(".menu [data-dem-inline-pick]")];
          const next = items.find(i => !/当前/.test(i.textContent));
          return next ? { id: ${JSON.stringify(priOpen.id)}, to: next.dataset.demInlinePick } : null;
        })()`);
      }
      if(!priPick){
        await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
        skip("末页没有可改优先级的行");
      }else{
        await evaluate(`(() => { window.__skel = 0; window.__writes = [];
          document.querySelector('.menu [data-dem-inline-pick="${priPick.to}"]').click();
          return true; })()`);
        await waitFor(`window.__writes.some(w => /priority/.test(w.url))`, "跨页优先级保存发出");
        await sleep(2500);
        const after = await evaluate(`document.querySelectorAll("#demandBody tbody tr [data-dem-detail]").length`);
        const skel = await evaluate(`window.__skel`);
        assert(after >= loaded, `跨页行内编辑保留已加载深度（${loaded} → ${after} 行）`);
        assert(skel === 0, "跨页行内编辑没有插入骨架");
      }
    }
  }finally{
    if(seedIds.length){
      const cleaned = await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        let ok = 0;
        for(const id of ${JSON.stringify(seedIds)}){ try{ await API.del("/api/demands/" + encodeURIComponent(id)); ok++; }catch(e){ /* 继续删剩下的 */ } }
        return ok;
      })()`);
      assert(cleaned === seedIds.length, `补种数据已清理（${cleaned}/${seedIds.length}）`);
    }
  }

  /* 7. 390px 窄屏：概览两列网格里来源编辑态不撑出横向滚动 */
  if(srcPick){
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    await evaluate(`(() => { window.__writes = [];
      const b = document.querySelector('[data-dem-detail="${srcPick.id}"]');
      if(b) b.click();
      return !!b; })()`);
    const mobileOpen = await waitFor(`!!document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']")`, "窄屏抽屉打开").catch(() => null);
    if(!mobileOpen){ skip("390px 下没找到该需求的详情入口"); }
    else{
      await evaluate(`(() => {
        document.querySelector(".modal-layer.open.demand-detail #demandFacts [data-dem-text='source']").click();
        return true;
      })()`);
      await sleep(400);
      const m390 = await evaluate(`(() => {
        const el = document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field");
        if(!el) return { el: false };
        const r = el.getBoundingClientRect();
        const doc = document.querySelector(".demand-detail .demand-sheet") || document.documentElement;
        return { el: true, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
                 vw: innerWidth, sheetScroll: doc.scrollWidth, sheetClient: doc.clientWidth };
      })()`);
      assert(m390.el, "390px 下来源可进入编辑");
      assert(m390.right <= m390.vw && m390.width > 40,
        `390px 下来源编辑框不出屏（宽 ${m390.width}，右 ${m390.right} / 视口 ${m390.vw}）`);
      assert(m390.sheetScroll <= m390.sheetClient + 1,
        `390px 下抽屉不出现横向滚动（${m390.sheetScroll} / ${m390.sheetClient}）`);
      await shot("dem-inline-06-detail-source-390.png");
      await evaluate(`(() => {
        const el = document.querySelector(".modal-layer.open.demand-detail #demandFacts .rf-v.inline-edit-field");
        if(el) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const x = document.querySelector(".modal-layer.open.demand-detail [data-dem-x]");
        if(x) x.click();
        return true;
      })()`);
    }
    await call("Emulation.clearDeviceMetricsOverride", {});
    await sleep(400);
  }

  /* 8. 控制台无报错 */
  const errs = cdp.errors.filter(e => !/favicon|net::ERR|404/i.test(e));
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));

  /* 9. 还原演示数据：等用例自身的刷新落定，再按最新 revision 逐条写回 */
  if(pendingRestores.length){
    await sleep(1500);
    let restored = 0;
    for(const r of pendingRestores){
      try{
        if(r.expectDate !== undefined){
          await evaluate(`(async () => {
            const { API } = await import("./js/core/api.js");
            const id = ${JSON.stringify(r.id)};
            const d = await API.get("/api/demands/" + id);
            await API.post("/api/demands/" + id + "/expect-date", { expectDate: ${JSON.stringify(r.expectDate)}, revision: d.revision });
            return true;
          })()`);
        }else{
          await restoreDemand(r.id, r.patch);
        }
        restored++;
      }catch(e){ console.log("  WARN 还原失败 " + r.id + "：" + e.message); }
    }
    assert(restored === pendingRestores.length, `演示数据已还原（${restored}/${pendingRestores.length}）`);
  }

  console.log(`\n结果：${failed ? "FAIL " + failed : "全部通过"}${skipped ? "，跳过 " + skipped : ""}`);
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + e.message);
  process.exitCode = 1;
}finally{
  try{ proc.kill(); }catch(e){ /* noop */ }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){ /* noop */ }
}