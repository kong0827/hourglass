/* 筛选项一致性审计 · 批次 3 验证（真 Chrome + 本地栈）
   用法：node tools/e2e/filter-batch3.mjs
   覆盖：缺陷模块 / 标签筛选、分支版本筛选与未指派计数、用例 facets 计数与执行人空值、
        归档项目规则、领域页维度顺序、分支移动端筛选面板、覆盖 / 报告子页筛选收口；
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
const port = 9228;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "filter-e2e3-"));
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
      return items.some(b => b.textContent.trim() === ${JSON.stringify(name)});
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
  /* 中断的运行会留下同名视图：开跑先按名字清掉，收尾再确认没有残留 */
  const testViewNames = ["E2E 分支版本视图", "E2E 零组合视图"];
  const purgeViews = async names => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const wanted = ${JSON.stringify(names)};
    let deleted = 0;
    for(const v of (await API.get("/api/views")) || []){
      if(wanted.indexOf(v.name) !== -1){ await API.del("/api/views/" + encodeURIComponent(v.id)); deleted++; }
    }
    return deleted;
  })()`).catch(() => -1);

  console.log("筛选项批次 3 验证\n  地址：" + BASE);
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
  await purgeViews(testViewNames);

  /* ---------------- 分支：版本筛选 / 未指派 / 归档项目 ---------------- */
  await openView("branches");
  await waitFor(`!!document.querySelector("#branchGroups .br-card, #branchGroups .br-empty-full, #branchGroups .br-list-wrap")`, "分支内容");
  await sleep(1600);
  await click("#branchClearFilter").catch(() => {});
  await sleep(600);

  const archivedInfo = await evaluate(`(async () => {
    const { rt } = await import("./js/core/state.js");
    const sel = document.getElementById("branchProjectFilter");
    const archived = (rt.reqList || []).filter(r => r.archivedAt).map(r => r.name || r.id);
    const shown = [...sel.options].map(o => o.textContent.trim());
    return { archived, shown };
  })()`);
  const archivedShown = archivedInfo.archived.filter(n => archivedInfo.shown.some(t => t.indexOf(n) !== -1));
  assert(archivedShown.length === 0, "分支项目候选默认排除归档项目（归档 " + archivedInfo.archived.length + " 个）");

  const verInfo = await evaluate(`(() => {
    const sel = document.getElementById("branchVersionFilter");
    const opts = [...sel.options].slice(1).map(o => ({ value: o.value, text: o.textContent.trim() }));
    return { count: opts.length, allCounted: opts.every(o => /（\\d+）$/.test(o.text)), sample: opts.slice(0, 4) };
  })()`);
  assert(verInfo.count > 0, "分支版本下拉列出有分支的版本（" + verInfo.count + " 个）");
  assert(verInfo.allCounted, "版本候选带分支数（" + verInfo.sample.map(x => x.text).join(" / ") + "）");
  await shot("audit-batch3-branches-1440.png");

  const verPick = await evaluate(`(() => {
    const sel = document.getElementById("branchVersionFilter");
    const opt = [...sel.options].find(o => o.value && /（[1-9]\\d*）$/.test(o.textContent));
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, text: opt.textContent.trim() };
  })()`);
  if(verPick){
    await sleep(1400);
    const verState = await evaluate(`(() => ({
      meta: document.getElementById("branchMeta").textContent,
      clearHidden: document.getElementById("branchClearFilter").hidden,
      cards: document.querySelectorAll("#branchGroups .br-card").length,
      empty: !!document.querySelector("#branchGroups .empty-state")
    }))()`);
    assert(verState.meta.indexOf("版本「") !== -1, "选中版本后页脚标注版本条件（" + verPick.text + "）");
    assert(verState.cards > 0 || verState.empty, "版本筛选返回分支或明确空态（" + verState.cards + " 条）");
    assert(verState.clearHidden === false, "版本筛选生效时显示「清空筛选」");

    /* 版本进保存视图 */
    const viewName = "E2E 分支版本视图";
    await click("#branchViewsBtn");
    await waitFor(`document.getElementById("branchViewsMenu").innerHTML.indexOf("保存当前为视图") !== -1`, "分支视图菜单");
    await click("#branchViewsMenu [data-tc-branch-view-save]");
    await saveViewThroughPrompt(viewName);
    await sleep(600);
    await setSelect("branchVersionFilter", "");
    await sleep(1400);
    await click("#branchViewsBtn");
    await waitFor(`!!document.querySelector("#branchViewsMenu [data-tc-branch-view]")`, "分支视图菜单项");
    await evaluate(`(() => {
      const hit = [...document.querySelectorAll("#branchViewsMenu [data-tc-branch-view]")]
        .find(x => x.textContent.trim() === ${JSON.stringify(viewName)});
      if(!hit) return false;
      hit.click();
      return true;
    })()`);
    await sleep(1600);
    const viewApplied = await evaluate(`document.getElementById("branchVersionFilter").value`);
    assert(viewApplied === verPick.value, "分支视图恢复版本筛选（" + viewApplied + "）");
    await click("#branchViewsBtn");
    await waitFor(`!!document.querySelector("#branchViewsMenu [data-tc-branch-view]")`, "分支视图菜单项");
    const delView = await deleteViewThroughConfirm("tc-branch-view", viewName);
    await sleep(400);
    assert(delView, "分支版本视图清理完成");
    await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.closeAllPops(); return true; })`);

    await click("#branchClearFilter");
    await sleep(1200);
    const cleared = await evaluate(`(() => ({
      version: document.getElementById("branchVersionFilter").value,
      project: document.getElementById("branchProjectFilter").value
    }))()`);
    assert(cleared.version === "", "清空筛选复位版本条件（项目保留 " + (cleared.project || "全部") + "）");
  }else{
    skip("演示数据没有带分支的版本，跳过版本筛选结果断言");
  }

  const ownerNone = await evaluate(`(() => {
    const sel = document.getElementById("branchOwnerFilter");
    const opt = [...sel.options].find(o => o.value === "__none__");
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.textContent.trim();
  })()`);
  if(ownerNone){
    await sleep(1400);
    const noneState = await evaluate(`(() => ({
      meta: document.getElementById("branchMeta").textContent,
      owners: document.querySelectorAll("#branchGroups .br-owner").length,
      cards: document.querySelectorAll("#branchGroups .br-card").length
    }))()`);
    assert(noneState.meta.indexOf("负责人「未指派」") !== -1, "分支支持「未指派」负责人筛选（" + ownerNone + "）");
    assert(noneState.owners === 0, "未指派筛选下卡片不显示负责人（" + noneState.cards + " 条）");
    await click("#branchClearFilter");
    await sleep(1000);
  }else{
    skip("演示数据没有未指派分支，跳过「未指派」结果断言");
  }

  /* ---------------- 缺陷：模块 / 标签 ---------------- */
  await openView("testcases");
  await click('[data-tc-mode="defects"]');
  await waitFor(`!document.getElementById("tcDefectBar").hidden`, "缺陷筛选栏");
  await waitFor(`!!document.querySelector("#tcDefRows .tc-def-row, #tcDefRows .empty-state")`, "缺陷列表");
  await click("#tcDefReset");
  await sleep(800);
  await setSelect("tcDefStatus", "all");
  await sleep(900);

  const defBar = await evaluate(`(() => {
    const ids = ["tcDefReq","tcDefStatus","tcDefOwner","tcDefPriority","tcDefSeverity","tcDefVersion","tcDefCat","tcDefTag","tcDefSearch"];
    const bar = document.getElementById("tcDefectBar");
    return ids.map(id => [...bar.children].findIndex(x => x.id === id));
  })()`);
  assert(defBar.every((v, i) => v >= 0 && (i === 0 || v > defBar[i - 1])),
    "缺陷筛选顺序：项目 → 状态 → 负责人 → 优先级 → 严重度 → 版本 → 模块 → 标签 → 搜索");

  const baseCount = await evaluate(`document.querySelectorAll("#tcDefRows .tc-def-row").length`);
  const catInfo = await evaluate(`(() => {
    const sel = document.getElementById("tcDefCat");
    const opts = [...sel.options].slice(1).map(o => ({ value: o.value, text: o.textContent.trim() }));
    return { count: opts.length, zero: opts.filter(o => /（0）$/.test(o.text)), sample: opts.slice(0, 4) };
  })()`);
  assert(catInfo.count > 0, "缺陷模块下拉有候选（" + catInfo.sample.map(x => x.text).join(" / ") + "）");
  assert(catInfo.zero.length === 0, "缺陷模块零结果不出现");

  const catPick = await evaluate(`(() => {
    const sel = document.getElementById("tcDefCat");
    const opt = [...sel.options].find(o => o.value !== "all" && /（[1-9]\\d*）$/.test(o.textContent));
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, text: opt.textContent.trim() };
  })()`);
  if(catPick){
    await sleep(500);
    const catState = await evaluate(`(() => ({
      rows: document.querySelectorAll("#tcDefRows .tc-def-row").length,
      meta: document.getElementById("tcDefMeta") ? document.getElementById("tcDefMeta").textContent : "",
      foot: document.getElementById("tcDefFoot").textContent,
      marked: document.getElementById("tcDefCat").classList.contains("is-filtered")
    }))()`);
    assert(catState.rows > 0 || catState.foot.indexOf("共 0 条") === 0, "缺陷按模块筛选生效（" + baseCount + " → " + catState.rows + " 条）");
    assert(catState.marked, "缺陷模块筛选生效态高亮");
    assert(catState.foot.indexOf("模块 ") !== -1, "缺陷页脚反映模块条件（" + catState.foot.slice(0, 60) + "…）");
  }else{
    skip("缺陷没有带模块的数据，跳过模块结果断言");
  }

  await click("#tcDefReset");
  await sleep(700);
  await setSelect("tcDefStatus", "all");
  await sleep(700);
  const tagInfo = await evaluate(`(() => {
    const sel = document.getElementById("tcDefTag");
    const opts = [...sel.options].slice(1).map(o => ({ value: o.value, text: o.textContent.trim() }));
    return { count: opts.length, zero: opts.filter(o => /（0）$/.test(o)), sample: opts.slice(0, 5) };
  })()`);
  assert(tagInfo.count > 0, "缺陷标签下拉有候选（" + tagInfo.sample.map(x => x.text).join(" / ") + "）");
  assert(tagInfo.zero.length === 0, "缺陷标签零结果不出现");
  const tagPick = await evaluate(`(() => {
    const sel = document.getElementById("tcDefTag");
    const opt = [...sel.options].find(o => o.value !== "all" && /（[1-9]\\d*）$/.test(o.textContent));
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: opt.value, text: opt.textContent.trim() };
  })()`);
  if(tagPick){
    await sleep(500);
    const tagState = await evaluate(`(() => ({
      rows: document.querySelectorAll("#tcDefRows .tc-def-row").length,
      marked: document.getElementById("tcDefTag").classList.contains("is-filtered")
    }))()`);
    assert(tagState.rows > 0, "缺陷按标签筛选生效（" + tagPick.text + " → " + tagState.rows + " 条）");
    assert(tagState.marked, "缺陷标签筛选生效态高亮");
    await shot("audit-batch3-defects-1440.png");
  }else{
    skip("缺陷没有带标签的数据，跳过标签结果断言");
  }
  /* 零组合视图：模块 + 该模块内没有缺陷的负责人；应用后两个条件都要保住，不能被静默重置。
     交互上凑不出这个组合（零计数候选本就不展示），按真实路径造一个已保存视图再应用。 */
  await click("#tcDefReset");
  await sleep(700);
  await setSelect("tcDefStatus", "all");
  await sleep(700);
  const zeroCombo = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { rt } = await import("./js/core/state.js");
    const reqs = (rt.reqList || []).filter(r => !r.archivedAt).map(r => r.id);
    const rows = await API.getAllPages("/api/tasks/list", { types: ["bug"], reqs: reqs, sort: "updated" });
    const bugs = (rows || []).filter(t => t && (!t.itemType || t.itemType === "bug"));
    const owners = [...new Set(bugs.map(t => t.owner).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const cats = [...new Set(bugs.map(t => t.categoryId).filter(Boolean))];
    for(const cat of cats){
      for(const owner of owners){
        if(!bugs.some(t => t.categoryId === cat && t.owner === owner)){
          return { cat: cat, owner: owner, bugs: bugs.length };
        }
      }
    }
    return null;
  })()`);
  const zeroViewName = "E2E 零组合视图";
  let zeroCreated = false;
  if(zeroCombo){
    zeroCreated = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      /* 先清掉同名残留，避免旧视图的参数被误当成这一次的结果 */
      const list = await API.get("/api/views");
      for(const v of (list || [])){
        if(v.name === ${JSON.stringify(zeroViewName)}) await API.del("/api/views/" + encodeURIComponent(v.id));
      }
      const p = { scope: "defect", reqId: "", severity: "all", priority: "all", status: "all",
        owner: ${JSON.stringify(zeroCombo.owner)}, version: "all",
        cat: ${JSON.stringify(zeroCombo.cat)}, tag: "all", q: "" };
      await API.post("/api/views", { name: ${JSON.stringify(zeroViewName)}, params: JSON.stringify(p) });
      return true;
    })()`).catch(() => false);
  }
  if(zeroCreated){
    await click("#tcDefViewsBtn");
    await waitFor(`document.getElementById("tcDefViewsMenu").innerHTML.indexOf(${JSON.stringify(zeroViewName)}) !== -1`, "零组合视图项");
    await evaluate(`(() => {
      const hit = [...document.querySelectorAll("#tcDefViewsMenu [data-tc-def-view]")]
        .find(x => x.textContent.trim() === ${JSON.stringify(zeroViewName)});
      if(!hit) return false;
      hit.click();
      return true;
    })()`);
    await sleep(1200);
    const zeroApplied = await evaluate(`(() => ({
      cat: document.getElementById("tcDefCat").value,
      owner: document.getElementById("tcDefOwner").value,
      ownerOpt: ((document.getElementById("tcDefOwner").selectedOptions || [])[0] || {}).textContent || "",
      rows: document.querySelectorAll("#tcDefRows .tc-def-row").length,
      foot: document.getElementById("tcDefFoot").textContent
    }))()`);
    assert(zeroApplied.cat === zeroCombo.cat && zeroApplied.owner === zeroCombo.owner,
      "应用零组合视图后模块与负责人均保留（" + zeroApplied.cat + " / " + zeroApplied.owner + "）");
    assert(/（0）$/.test(zeroApplied.ownerOpt.trim()),
      "应用零组合视图后负责人显示（0）而不是回落全部（" + zeroApplied.ownerOpt.trim() + "）");
    assert(zeroApplied.rows === 0 || zeroApplied.foot.indexOf("共 0 条") !== -1,
      "零组合给出明确空结果（" + zeroApplied.foot.slice(0, 40) + "…）");
    await click("#tcDefViewsBtn");
    await waitFor(`!!document.querySelector("#tcDefViewsMenu [data-tc-def-view]")`, "缺陷视图项");
    const delZero = await deleteViewThroughConfirm("tc-def-view", zeroViewName);
    assert(delZero, "零组合视图清理完成");
    await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.closeAllPops(); return true; })`);
  }else{
    if(zeroCombo){
      await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        const list = await API.get("/api/views");
        const hit = (list || []).find(v => v.name === ${JSON.stringify(zeroViewName)});
        if(hit) await API.del("/api/views/" + encodeURIComponent(hit.id));
        return true;
      })()`).catch(() => {});
    }
    skip("演示数据凑不出「模块 + 零缺陷负责人」组合，跳过零组合视图断言");
  }

  await click("#tcDefReset");
  await sleep(800);

  /* ---------------- 用例：facets 计数 / 维度顺序 / 执行人空值 ---------------- */
  await click('[data-tc-mode="cases"]');
  await waitFor(`!document.getElementById("tcFilterBar").hidden`, "用例筛选栏");
  await sleep(1000);
  const caseOrder = await evaluate(`(() => {
    const bar = document.getElementById("tcFilterBar");
    const ids = ["tcStatusSeg","tcOwner","tcPri","tcModule","tcSearch"];
    return ids.map(id => [...bar.querySelectorAll("*")].findIndex(x => x.id === id));
  })()`);
  assert(caseOrder.slice(0, 4).every((v, i) => v >= 0 && (i === 0 || v > caseOrder[i - 1])),
    "用例筛选顺序：状态 → 执行人 → 优先级 → 模块 → 搜索");

  const caseFacets = await evaluate(`(() => {
    const grab = id => [...document.getElementById(id).options].slice(1).map(o => o.textContent.trim());
    const chips = [...document.querySelectorAll("#tcStatusSeg [data-tc-status]")].map(b => b.textContent.trim());
    const owner = [...document.getElementById("tcOwner").options].map(o => o.textContent.trim());
    return {
      pri: grab("tcPri"), mod: grab("tcModule"), owner,
      chips,
      ownerNone: owner.find(t => t.indexOf("未指定执行人") === 0) || "",
      zero: grab("tcPri").concat(grab("tcModule")).filter(t => /（0）$/.test(t))
    };
  })()`);
  assert(caseFacets.pri.length && caseFacets.pri.every(t => /（\d+）$/.test(t)), "用例优先级候选带计数（" + caseFacets.pri.join(" / ") + "）");
  assert(caseFacets.mod.length && caseFacets.mod.every(t => /（\d+）$/.test(t)), "用例模块候选带计数（" + caseFacets.mod.join(" / ") + "）");
  assert(caseFacets.chips.every(t => /\d+$/.test(t)), "执行结果 chips 带计数（" + caseFacets.chips.join(" / ") + "）");
  assert(caseFacets.zero.length === 0, "用例零结果选项不出现");
  if(caseFacets.ownerNone){
    assert(true, "用例执行人提供空值项（" + caseFacets.ownerNone + "）");
  }else{
    skip("当前项目没有未指定执行人的用例，空值项按零计数隐藏");
  }
  await shot("audit-batch3-cases-1440.png");

  const caseCount = await evaluate(`document.querySelectorAll("#tcList .tc-row").length`);
  const casePri = await evaluate(`(() => {
    const sel = document.getElementById("tcPri");
    const opt = [...sel.options].find(o => o.value !== "all" && o.value !== "__none" && /（[1-9]\\d*）$/.test(o.textContent));
    if(!opt) return null;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.textContent.trim();
  })()`);
  if(casePri){
    await sleep(900);
    const filtered = await evaluate(`document.querySelectorAll("#tcList .tc-row").length`);
    assert(filtered > 0 && filtered <= caseCount, "用例按优先级筛选生效（" + caseCount + " → " + filtered + " 条）");
    await click("#tcClearFilter");
    await sleep(900);
  }

  /* ---------------- 子页：覆盖矩阵 / 报告 / 计划 ---------------- */
  await click('[data-tc-mode="coverage"]');
  await sleep(1200);
  const coverHidden = `(() => {
    const hid = id => { const el = document.getElementById(id); return !el || getComputedStyle(el).display === "none" || el.hidden; };
    return {
      search: hid("tcSearch"), chips: hid("tcStatusSeg"), owner: hid("tcOwner"),
      module: hid("tcModule"), clear: hid("tcClearFilter"),
      req: getComputedStyle(document.getElementById("tcReq")).display
    };
  })()`;
  const coverageBar = await evaluate(coverHidden);
  assert(coverageBar.search && coverageBar.chips && coverageBar.owner && coverageBar.module && coverageBar.clear,
    "覆盖矩阵隐藏用例筛选维度，避免维度混用");
  assert(coverageBar.req !== "none", "覆盖矩阵保留项目范围控件");

  await click('[data-tc-mode="report"]');
  await sleep(1200);
  const reportBar = await evaluate(`(() => ({
    hidden: (${coverHidden}).search && (${coverHidden}).chips,
    req: (${coverHidden}).req,
    plans: document.getElementById("tcPlanBar").hidden
  }))()`);
  assert(reportBar.hidden && reportBar.req !== "none", "测试报告沿用项目范围、不显示用例筛选");
  assert(reportBar.plans === true, "测试报告不显示计划筛选栏");

  await click('[data-tc-mode="plans"]');
  await sleep(1200);
  const planBar = await evaluate(`(() => ({
    bar: !document.getElementById("tcPlanBar").hidden,
    caseSearch: getComputedStyle(document.getElementById("tcSearch")).display,
    caseChips: getComputedStyle(document.getElementById("tcStatusSeg")).display,
    search: !!document.getElementById("tcPlanSearch")
  }))()`);
  assert(planBar.bar && planBar.search, "测试计划保留自有搜索与状态筛选");
  assert(planBar.caseSearch === "none" && planBar.caseChips === "none", "测试计划不同时显示用例筛选");

  /* ---------------- 移动端 390：分支筛选面板 ---------------- */
  await setViewport(390, 844, true);
  await openView("branches");
  await waitFor(`!!document.querySelector("#branchGroups .br-card, #branchGroups .br-empty-full, #branchGroups .br-list-wrap")`, "分支内容");
  await sleep(1400);
  await setSelect("branchStatusFilter", "dev");
  await sleep(1000);
  const mobileCollapsed = await evaluate(`(() => {
    const bar = document.getElementById("branchFilterBar");
    const btn = document.getElementById("branchFilterBtn");
    const badge = document.getElementById("branchFilterCount");
    return {
      barDisplay: getComputedStyle(bar).display,
      btnVisible: getComputedStyle(btn).display !== "none",
      open: bar.classList.contains("is-open"),
      badge: badge.hidden ? "" : badge.textContent.trim()
    };
  })()`);
  assert(mobileCollapsed.barDisplay === "none" && mobileCollapsed.open === false, "移动端分支筛选默认收进面板");
  assert(mobileCollapsed.btnVisible, "移动端显示分支「筛选」入口");
  assert(mobileCollapsed.badge === "1", "收起时筛选按钮显示已筛条件数（" + mobileCollapsed.badge + "）");
  await shot("audit-batch3-branches-390.png");

  await click("#branchFilterBtn");
  await sleep(400);
  const mobileOpen = await evaluate(`(() => {
    const bar = document.getElementById("branchFilterBar");
    return {
      open: bar.classList.contains("is-open"),
      display: getComputedStyle(bar).display,
      versionVisible: getComputedStyle(document.getElementById("branchVersionFilter")).display !== "none",
      expanded: document.getElementById("branchFilterBtn").getAttribute("aria-expanded")
    };
  })()`);
  assert(mobileOpen.open && mobileOpen.display !== "none", "点击「筛选」展开分支筛选面板");
  assert(mobileOpen.versionVisible && mobileOpen.expanded === "true", "展开后版本筛选可见、按钮标记展开");
  await shot("audit-batch3-branches-filter-390.png");
  await click("#branchClearFilter");
  await sleep(1000);

  await purgeViews(testViewNames);
  const viewResidue = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    return (await API.get("/api/views")).map(v => v.name).filter(n => n.indexOf("E2E ") === 0);
  })()`);
  assert(viewResidue.length === 0, "收尾后视图列表没有测试残留" + (viewResidue.length ? "：" + viewResidue.join(" / ") : ""));

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
