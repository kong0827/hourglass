/* 项目集 / 分类模型批次走查：项目层级缩进、项目下拉分组、分组维度去模块、版本阶段口径与报表口径。
   只读走查：不写业务数据。

   用法：
     E2E_BASE=http://127.0.0.1:8075/hourglass E2E_USER=admin E2E_PASS=123456 \
       E2E_SHOT_DIR=/tmp/hourglass-projectset node tools/e2e/project-set-hierarchy.mjs
   需要本机 Chrome / Chromium，也可用 CHROME_BIN 指定。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-projectset-"));

function assert(cond, msg){ if(!cond) throw new Error(msg); }
function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"
  ].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome / Chromium，请用 CHROME_BIN 指定路径");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if(msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }else if(msg.method) this.events.push(msg);
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  takeExceptions(){
    const bad = this.events.filter(e =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
    this.events = [];
    return bad;
  }
}
async function connect(port){
  const deadline = Date.now() + 15000;
  let version;
  while(Date.now() < deadline){
    try{
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if(res.ok){ version = await res.json(); break; }
    }catch(e){ /* Chrome 还没起来 */ }
    await sleep(200);
  }
  if(!version) throw new Error("Chrome DevTools 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new Cdp(ws);
}

async function main(){
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-ps-"));
  const child = spawn(findChrome(), [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });

  let cdp;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    assert(port, "读取 DevToolsActivePort 失败");
    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    for(const domain of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${domain}.enable`, {}, sessionId);
    await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId).catch(() => {});
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId).catch(() => {});

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expression); if(last) return last; }
        catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "页面加载 " + url, 25000);
    };
    const coldLoad = async url => {
      await call("Page.navigate", { url: "about:blank" });
      await waitFor("document.readyState === 'complete'", "清空页面");
      await navigate(url);
      await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs).catch(() => false)`, "冷启动鉴权", 25000);
    };
    const shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    const noExceptions = label => {
      const bad = cdp.takeExceptions();
      assert(!bad.length, label + " 出现脚本异常：" + JSON.stringify(bad.slice(0, 2)));
    };
    const pass = msg => console.log("  PASS " + msg);

    console.log("项目集 / 分类模型走查\n  浏览器：" + findChrome() + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

    /* 1. 登录并固定到含项目集的演示空间 */
    await navigate(BASE + "/login.html");
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
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
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body && document.body.dataset.view`, "登录完成", 25000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
    pass("登录 " + USER);

    const wsPick = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const list = await API.get("/api/workspaces");
      let best = null;
      for(const w of (list || [])){
        await API.post("/api/workspaces/" + encodeURIComponent(w.id) + "/select", {});
        const reqs = await API.getAllPages("/api/reqs");
        const sets = await API.get("/api/project-sets").catch(() => []);
        const bound = (reqs || []).filter(r => r.setId).length;
        const cur = { id:w.id, name:w.name, bound, sets:(sets || []).length };
        if(w.id === "SXk01"){ best = cur; break; }
        if(!best || bound > best.bound) best = cur;
      }
      if(!best) throw new Error("没有可用空间");
      await API.post("/api/workspaces/" + encodeURIComponent(best.id) + "/select", {});
      return best;
    })()`);
    assert(wsPick && wsPick.bound > 0, "没有找到带项目集的空间：" + JSON.stringify(wsPick));
    pass(`空间 ${wsPick.name}（${wsPick.id}）：${wsPick.sets} 个项目集 / ${wsPick.bound} 个项目已归集`);

    /* 2. 项目页：项目集表头、层级缩进、容器标识 */
    await coldLoad(BASE + "/index.html#/projects");
    await waitFor(`document.body.dataset.view === "projects" && document.querySelectorAll("#reqList .req-item").length > 0`, "项目列表");
    await waitFor(`import("./js/core/state.js").then(m => m.rt.projectSets.length > 0)`, "项目集列表");
    const proj = await evaluate(`(() => {
      const heads = [...document.querySelectorAll("#reqList .req-set-head")].map(h => h.textContent.trim());
      const items = [...document.querySelectorAll("#reqList .req-item")];
      const inSet = items.filter(el => el.classList.contains("req-item-in-set"));
      const first = inSet[0];
      const ml = first ? getComputedStyle(first).marginLeft : "";
      const containers = items.filter(el => el.classList.contains("req-item-container"))
        .map(el => ({ name:(el.querySelector(".req-name") || {}).textContent || "", tags:[...el.querySelectorAll(".tag")].map(t => t.textContent.trim()) }));
      const loose = items.filter(el => !el.classList.contains("req-item-in-set")).map(el => (el.querySelector(".req-name") || {}).textContent || "");
      const summ = [...document.querySelectorAll("#reqSumm .stat")].map(s => ({ k:(s.querySelector(".stat-k") || {}).textContent || "", v:(s.querySelector(".stat-v") || {}).textContent || "" }));
      const phaseBars = document.querySelectorAll("#reqList .req-phase-bar").length;
      const badges = [...document.querySelectorAll("#reqList .req-top .tag")].map(t => t.textContent.trim());
      const target = items.find(el => ((el.querySelector(".req-name") || {}).textContent || "") === "程序化报备");
      const targetPhase = target ? (target.querySelector(".req-phase") || {}).textContent || "" : "";
      return {
        heads, items:items.length, inSet:inSet.length, ml, containers, loose, summ, phaseBars, badges, targetPhase,
        setHandles: document.querySelectorAll("#reqList [data-set-drag]").length,
        setHeadKeys: [...document.querySelectorAll("#reqList .req-set-head")].map(h => h.dataset.setKey || ""),
        rowSetIds: items.map(el => el.dataset.setId || ""),
        dropZone: !!document.querySelector("#reqList [data-set-drop-ungrouped]"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    assert(proj.heads.length >= 2, "项目列表没有按项目集分组：" + JSON.stringify(proj.heads));
    assert(proj.inSet > 0, "没有任何项目带集内缩进");
    assert(proj.ml === "26px", "集内项目缩进不是 26px：" + proj.ml);
    assert(proj.setHeadKeys.length === proj.heads.length && proj.setHeadKeys.every(k => !!k),
      "项目集表头缺少 data-set-key：" + JSON.stringify(proj.setHeadKeys));
    assert(proj.setHandles >= 1, "项目集表头没有拖动把手（空间主 / 管理员应可排序）");
    assert(proj.rowSetIds.every(v => v === "" || proj.setHeadKeys.indexOf(v) !== -1), "项目行缺少所属项目集标识：" + JSON.stringify(proj.rowSetIds));
    assert(proj.dropZone, "项目列表缺少「移出项目集」落点");
    assert(proj.containers.length > 0, "没有识别到公共容器项目");
    assert(proj.containers.every(c => c.tags.indexOf("公共") !== -1), "容器项目缺「公共」标识：" + JSON.stringify(proj.containers));
    assert(proj.overflow <= 1, "项目页横向溢出：" + proj.overflow);
    assert(proj.summ.length === 6 && ["项目","分组","首版投入","迭代投入","准时完成率","未标记首版"].every(k => proj.summ.some(s => s.k === k)),
      "顶部汇总不完整：" + JSON.stringify(proj.summ));
    assert(proj.summ.every(s => s.v), "顶部汇总有空值：" + JSON.stringify(proj.summ));
    assert(proj.phaseBars > 0, "项目卡没有首版 / 迭代投入条");
    assert(proj.badges.indexOf("未标记首版") !== -1 || proj.badges.some(t => t.indexOf("首版 ") === 0), "项目卡缺少首版上线标记");
    assert(proj.targetPhase.indexOf("首版") !== -1 && /首版\s*99h15m/.test(proj.targetPhase.replace(/\s+/g, " ")),
      "程序化报备首版投入不是 99h15m：" + JSON.stringify(proj.targetPhase));
    await shot("01-项目列表层级");
    pass(`项目列表：${proj.heads.length} 个项目集表头 / ${proj.inSet} 个项目有缩进 / 容器 ${proj.containers.map(c => c.name).join("、")}`);

    /* 2.1 项目集可折叠：收起后组内项目不再渲染，展开恢复 */
    const collapsed = await evaluate(`(async () => {
      const btn = document.querySelector("#reqList [data-set-toggle]");
      const before = document.querySelectorAll("#reqList .req-item-in-set").length;
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const after = document.querySelectorAll("#reqList .req-item-in-set").length;
      document.querySelector("#reqList [data-set-toggle]").click();
      await new Promise(r => setTimeout(r, 120));
      const restored = document.querySelectorAll("#reqList .req-item-in-set").length;
      return { before, after, restored };
    })()`);
    assert(collapsed.before > 0 && collapsed.after < collapsed.before && collapsed.restored === collapsed.before,
      "项目集折叠 / 展开不正确：" + JSON.stringify(collapsed));
    pass("项目集折叠：收起 " + collapsed.before + " → " + collapsed.after + "，展开恢复 " + collapsed.restored);

    /* 2.2 全局健康度：项目卡带项目集标签，列表按项目集分组 */
    await coldLoad(BASE + "/index.html#/portfolio");
    await waitFor(`document.body.dataset.view === "portfolio" && document.querySelectorAll(".manager-project-card").length > 0`, "全局健康度");
    const pf = await evaluate(`(async () => {
      const tags = [...document.querySelectorAll(".manager-project-card .manager-project-head .tag-ghost")].map(t => t.textContent.trim());
      const btn = document.querySelector("[data-pf-mode='table']");
      if(btn) btn.click();
      await new Promise(r => setTimeout(r, 250));
      const out = {
        tags,
        setRows: [...document.querySelectorAll(".manager-tbl .pf-set-row")].map(r => r.textContent.replace(/\\s+/g, " ").trim()),
        rows: document.querySelectorAll(".manager-tbl tbody tr").length
      };
      const back = document.querySelector("[data-pf-mode='card']");
      if(back) back.click();
      await new Promise(r => setTimeout(r, 150));
      return out;
    })()`);
    assert(pf.tags.length > 0, "项目卡没有项目集标签");
    assert(pf.setRows.length >= 2 && pf.rows > pf.setRows.length, "全局健康度列表未按项目集分组：" + JSON.stringify(pf));
    pass("全局健康度：项目卡带项目集标签，列表分组 " + pf.setRows.join(" | "));
    noExceptions("项目列表");

    /* 3. 项目下拉：按项目集分组 + 二级缩进 */
    await coldLoad(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase" && document.getElementById("phaseReq") && document.getElementById("phaseReq").options.length > 1`, "版本页项目下拉");
    const phaseSel = await evaluate(`(() => {
      const sel = document.getElementById("phaseReq");
      const groups = [...sel.querySelectorAll("optgroup")].map(g => g.label);
      const lv2 = [...sel.querySelectorAll('option[data-level="2"]')].slice(0, 3).map(o => o.textContent);
      return { groups, lv2, total: sel.options.length, selected: (sel.options[sel.selectedIndex] || {}).textContent || "" };
    })()`);
    assert(phaseSel.groups.length >= 2, "版本页项目下拉没有项目集分组：" + JSON.stringify(phaseSel.groups));
    assert(phaseSel.lv2.length > 0 && phaseSel.lv2.every(t => t.startsWith("　")), "项目选项缺少二级缩进：" + JSON.stringify(phaseSel.lv2));
    pass(`版本页项目下拉：${phaseSel.groups.join(" / ")}，当前「${phaseSel.selected.trim()}」`);

    /* 3.1 工作项抽屉的项目下拉走同一套分组 */
    await evaluate(`import("./js/core/task-drawer.js").then(m => { m.openTaskDrawer(); return true; })`);
    await waitFor(`(() => { const d = document.getElementById("taskDrawer"); const s = document.getElementById("iReq"); return d && !d.hidden && s && s.options.length > 1; })()`, "工作项抽屉项目下拉");
    const drawerSel = await evaluate(`(() => {
      const sel = document.getElementById("iReq");
      return {
        groups: [...sel.querySelectorAll("optgroup")].map(g => g.label),
        lv2: sel.querySelectorAll('option[data-level="2"]').length,
        blank: (sel.options[0] || {}).textContent || ""
      };
    })()`);
    assert(drawerSel.groups.length >= 2 && drawerSel.lv2 > 0, "工作项抽屉项目下拉没有层级分组：" + JSON.stringify(drawerSel));
    pass(`工作项抽屉项目下拉：${drawerSel.groups.join(" / ")}，首项「${drawerSel.blank.trim()}」`);
    await evaluate(`import("./js/core/task-drawer.js").then(m => { m.tryCloseTaskDrawer(); return true; })`);
    await sleep(300);

    /* 4. 分组维度：模块换成项目集 */
    const gd = await evaluate(`import("./js/core/group-dims.js").then(m => m.GROUP_IDS)`);
    assert(gd.indexOf("set") !== -1 && gd.indexOf("category") === -1, "分组维度仍是模块或缺少项目集：" + JSON.stringify(gd));
    const mineOpts = await evaluate(`[...document.getElementById("mineGroup").options].map(o => o.value)`);
    const ganttOpts = await evaluate(`[...document.getElementById("ganttGroup").options].map(o => o.value)`);
    assert(mineOpts.indexOf("set") !== -1 && mineOpts.indexOf("category") === -1, "我的工作分组未改为项目集：" + JSON.stringify(mineOpts));
    assert(ganttOpts.indexOf("set") !== -1 && ganttOpts.indexOf("category") === -1, "甘特分组未改为项目集：" + JSON.stringify(ganttOpts));
    await coldLoad(BASE + "/index.html#/list");
    await waitFor(`document.body.dataset.view === "list" && document.querySelector("[data-list-group]")`, "工作项列表分组下拉");
    const listOpts = await evaluate(`[...document.querySelector("[data-list-group]").options].map(o => o.value)`);
    assert(listOpts.indexOf("set") !== -1 && listOpts.indexOf("category") === -1, "列表分组未改为项目集：" + JSON.stringify(listOpts));
    await coldLoad(BASE + "/index.html#/board");
    await waitFor(`document.getElementById("boardGroupSelect") && document.getElementById("boardGroupSelect").options.length > 1`, "看板分组下拉");
    const boardOpts = await evaluate(`[...document.getElementById("boardGroupSelect").options].map(o => o.value)`);
    assert(boardOpts.indexOf("set") !== -1 && boardOpts.indexOf("category") === -1, "看板分组未改为项目集：" + JSON.stringify(boardOpts));
    await coldLoad(BASE + "/index.html#/tree");
    await waitFor(`document.body.dataset.view === "tree" && [...document.querySelectorAll("#view-tree select")].some(s => s.options.length > 0)`, "层级视图维度下拉");
    const treeOpts = await evaluate(`[...document.querySelectorAll("#view-tree select")].map(s => [...s.options].map(o => o.value))`);
    assert(treeOpts.length > 0 && treeOpts.every(list => list.indexOf("category") === -1) && treeOpts.some(list => list.indexOf("set") !== -1),
      "层级视图仍以模块作为层级：" + JSON.stringify(treeOpts));
    pass("分组维度：列表 / 我的工作 / 甘特 / 看板 / 层级视图均已改为项目集，模块不再单列");
    noExceptions("分组维度");

    /* 5. 版本页：程序化报备的阶段口径与下钻归属 */
    await coldLoad(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase" && import("./js/core/state.js").then(m => m.rt.reqsLoaded).catch(() => false)`, "版本页与项目缓存");
    const phaseTarget = await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      const hit = (rt.reqList || []).find(r => r.name === "程序化报备");
      return hit ? { id:hit.id, name:hit.name, setId:hit.setId, container:hit.containerKind || "" } : null;
    })()`);
    assert(phaseTarget && phaseTarget.id, "找不到「程序化报备」项目");
    await evaluate(`(async () => {
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(phaseTarget.id)}, "phase");
      return document.body.dataset.view;
    })()`);
    await waitFor(`(document.getElementById("phaseMeta") || {}).textContent.indexOf("程序化报备") !== -1 && document.querySelectorAll("#phaseBody .phase-card").length > 0`, "阶段卡", 25000);
    const phaseCard = await evaluate(`(() => {
      const body = document.getElementById("phaseBody");
      const cards = [...body.querySelectorAll(".phase-card")];
      const cell = (card, label) => {
        const hit = [...card.querySelectorAll(".pcell")].find(c => (c.querySelector("span") || {}).textContent === label);
        return hit ? ((hit.querySelector("b") || {}).textContent || "") : "";
      };
      const mvp = cards[0];
      return {
        meta: (document.getElementById("phaseMeta") || {}).textContent || "",
        tags: cards.map(c => ((c.querySelector(".tag") || {}).textContent || "").trim()),
        done: mvp ? cell(mvp, "完成工作项") : "",
        hours: mvp ? cell(mvp, "投入工时") : "",
        pend: !!body.querySelector(".phase-card.pend")
      };
    })()`);
    assert(phaseCard.meta.indexOf("程序化报备") !== -1, "阶段卡不是程序化报备：" + phaseCard.meta);
    assert(phaseCard.tags[0] && phaseCard.tags[0].indexOf("首版开发") !== -1, "首张阶段卡不是首版开发：" + JSON.stringify(phaseCard.tags));
    assert(Number(phaseCard.done) >= 1, "首版开发没有完成工作项：" + JSON.stringify(phaseCard));
    assert(phaseCard.hours && phaseCard.hours !== "0m", "首版开发没有投入工时：" + JSON.stringify(phaseCard));
    assert(phaseCard.pend, "未标记首版的项目应显示「迭代维护 · 未开启」：" + JSON.stringify(phaseCard.tags));
    const phaseSelVal = await evaluate(`document.getElementById("phaseReq").value`);
    assert(phaseSelVal === phaseTarget.id, "版本页项目下拉未跟随当前项目：" + phaseSelVal + " ≠ " + phaseTarget.id);
    await shot("02-程序化报备阶段卡");

    const drill = await evaluate(`(() => {
      const b = document.querySelector('#phaseBody [data-drill-scope="phase"][data-drill-val="mvp"]');
      if(!b) return null;
      b.click();
      return true;
    })()`);
    assert(drill, "首版开发卡没有下钻入口");
    await waitFor(`document.querySelector(".modal-layer .sheet.wide [data-open-task]") || document.body.textContent.indexOf("该口径下暂无工作项") !== -1`, "阶段下钻弹窗");
    const drillRows = await evaluate(`(() => {
      const sheet = [...document.querySelectorAll(".modal-layer .sheet.wide")].pop();
      return {
        title: (sheet.querySelector("h2") || {}).textContent || "",
        ids: [...sheet.querySelectorAll("[data-open-task]")].map(r => r.getAttribute("data-open-task"))
      };
    })()`);
    assert(drillRows.ids.length > 0, "首版开发下钻没有工作项：" + JSON.stringify(drillRows));
    for(const id of drillRows.ids){
      const t = await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        const row = await API.get("/api/task/" + encodeURIComponent(${JSON.stringify(id)}));
        return { id: row.id, reqId: row.reqId || "", title: row.title };
      })()`);
      assert(t.reqId === phaseTarget.id, `下钻混入其他项目工作项：${t.id} ${t.title} reqId=${t.reqId}`);
    }
    pass(`程序化报备：首版开发 ${drillRows.ids.length} 项，下钻全部属于本项目，迭代维护未开启`);
    await evaluate(`(() => { const x = document.querySelector(".modal-layer .sheet.wide [data-drill-x]"); if(x) x.click(); return true; })()`);
    await sleep(300);
    noExceptions("版本页");

    /* 6. 报表与周回顾：模块口径已改为项目 */
    await coldLoad(BASE + "/index.html#/analysis");
    await waitFor(`document.body.dataset.view === "analysis" && document.querySelectorAll("#statsCat .dist-row").length > 0`, "报表完成分布", 30000);
    const analysis = await evaluate(`(() => ({
      title: [...document.querySelectorAll("#view-analysis h3")].map(h => h.textContent.trim()),
      rows: [...document.querySelectorAll("#statsCat .dist-row")].map(r => r.textContent.replace(/\\s+/g, " ").trim()).slice(0, 5),
      hasModuleText: document.getElementById("view-analysis").textContent.indexOf("按模块") !== -1
    }))()`);
    assert(analysis.title.indexOf("完成分布 · 按项目") !== -1, "报表未改为按项目：" + JSON.stringify(analysis.title));
    assert(analysis.rows.length > 0, "按项目完成分布为空");
    assert(!analysis.hasModuleText, "报表仍出现「按模块」口径");
    await shot("03-报表按项目");
    pass("报表：完成分布按项目 " + analysis.rows.slice(0, 3).join(" | "));

    await coldLoad(BASE + "/index.html#/review");
    await waitFor(`document.body.dataset.view === "review"`, "周回顾");
    const review = await evaluate(`(() => {
      const txt = document.getElementById("view-review").textContent;
      return {
        hasModule: txt.indexOf("模块分布") !== -1,
        hasProject: txt.indexOf("项目进展") !== -1,
        titles: [...document.querySelectorAll("#view-review h3")].map(h => h.textContent.trim())
      };
    })()`);
    assert(!review.hasModule, "周回顾仍有模块分布：" + JSON.stringify(review.titles));
    assert(review.hasProject, "周回顾缺少项目进展：" + JSON.stringify(review.titles));
    pass("周回顾：模块分布已移除，保留项目进展");
    noExceptions("报表与周回顾");

    console.log("\n全部通过。截图目录：" + SHOTS);
  } finally {
    try{ child.kill("SIGKILL"); }catch(e){ /* noop */ }
    if(cdp) try{ cdp.ws.close(); }catch(e){ /* noop */ }
  }
}

main().catch(err => { console.error("\nFAIL: " + err.message); process.exit(1); });
