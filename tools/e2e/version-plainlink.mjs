/* 纯文本版本引用 → 跳转入口 落地走查：七处界面点版本名都落到 #/version 详情，
   日程多版本 pill 逐枚接线（后端未重建时用 Fetch 注入同序 ids 验证前端契约），旧后端降级纯文本；
   导出纸张 / 筛选 select 保持纯文本。只读走查 + 一次网络层注入，不写业务数据。

   用法：
     E2E_BASE=http://127.0.0.1:8086/hourglass E2E_USER=admin E2E_PASS=admin123 \
       node tools/e2e/version-plainlink.mjs
   需要本机 Chrome / Chromium，也可用 CHROME_BIN 指定。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8086/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-plainlink-"));

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
    this.events = this.events.filter(e => !bad.includes(e));
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

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(cond) pass(msg); else { failed++; console.log("  FAIL " + msg); } };

async function main(){
  fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-pl-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });

  let cdp, sessionId;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    assert(port, "DevToolsActivePort 就绪");

    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    for(const domain of ["Page", "Runtime", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 15000) => {
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
    const click = async selector => {
      const hit = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) return false; el.click(); return true; })()`);
      assert(hit, "点得到 " + selector);
      await sleep(250);
    };
    const shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    const noExceptions = label => {
      const bad = cdp.takeExceptions();
      assert(!bad.length, label + " 无脚本异常" + (bad.length ? "：" + JSON.stringify(bad.slice(0, 2)) : ""));
    };
    /* 点版本名后应落到版本详情子页，且 hash 带上该版本 id */
    const expectLanding = async (id, label) => {
      await waitFor(`document.body.dataset.view === "version" && location.hash.indexOf(${JSON.stringify(id)}) >= 0`, label + " 落地版本详情", 15000);
      const t = await evaluate(`(() => { const h = document.querySelector("#view-version .vd-title"); return h ? h.textContent.trim() : ""; })()`);
      assert(!!t, label + " 详情页标题渲染：" + t);
      return t;
    };
    const backTo = async hash => {
      await evaluate(`location.hash = ${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
      await sleep(350);
    };
    /* 日程是跨项目只读汇总：等视图渲染完再切模式（委托在 renderPhaseView 里绑定），并放宽到全部时间拿足样本 */
    const enterSchedule = async () => {
      if(await evaluate(`document.body.dataset.view`) !== "phase"){
        await navigate(BASE + "/index.html#/phase");
        await waitFor(`document.body.dataset.view === "phase"`, "版本页");
      }
      await waitFor(`!!document.querySelector("#phaseBody .panel, #phaseBody .phase-card, #phaseBody .empty-state")`, "版本页首屏渲染");
      await click('[data-pmode="schedule"]');
      await waitFor(`document.querySelector('[data-pmode="schedule"]').getAttribute("aria-pressed") === "true"`, "日程模式生效");
      await evaluate(`(() => { const s = document.querySelector('[data-schedule-filter="range"]'); if(!s) return false;
        s.value = "all"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      await waitFor(`document.querySelectorAll("#phaseBody tr[data-schedule-open]").length > 0`, "日程行");
    };

    console.log("纯文本版本引用→跳转入口 走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

    /* 1. 登录 */
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

    /* 2. 选主用例：工作项最多的版本 + 同项目已发布版本 + 带版本绑定工作项的需求 */
    const pick = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/cross-project");
      const sorted = (rows || []).slice().sort((a, b) => (b.taskCount || 0) - (a.taskCount || 0));
      const main = sorted[0];
      const released = sorted.find(r => r.reqId === main.reqId && r.latestReleaseDate) || sorted.find(r => r.latestReleaseDate) || main;
      const demands = await API.getAllPages("/api/demands", { reqId: main.reqId }).catch(() => []);
      const list = Array.isArray(demands) ? demands : [];
      let withTasks = null;
      for(const d of list.slice(0, 40)){
        if(!d.versionId) continue;
        const ts = await API.getAllPages("/api/demands/" + encodeURIComponent(d.id) + "/tasks").catch(() => []);
        if((ts || []).some(t => (t.versionIds || []).length)){ withTasks = { id: d.id, title: d.title }; break; }
      }
      return { main, released, withTasks, reqId: main.reqId,
        pool: sorted.filter((r, i, a) => a.findIndex(x => x.versionId === r.versionId) === i).slice(0, 3)
          .map(r => ({ id: r.versionId, req: r.reqId, name: r.versionName })) };
    })()`);
    assert(pick && pick.main && pick.main.versionId, "跨项目版本清单为空，无法走查");
    const main = pick.main, released = pick.released;
    pass(`选定 ${main.projectName} / ${main.versionName}；已发布 ${released.versionName}；带版本工作项的需求 ${pick.withTasks ? pick.withTasks.title : "无"}`);

    /* 3. 日程：旧后端不返回 ids → 降级纯文本 pill（不渲染死链） */
    console.log("\n[1] 发布日程：旧后端降级纯文本");
    await enterSchedule();
    const fallback = await evaluate(`(() => ({
      rows: document.querySelectorAll("#phaseBody tr[data-schedule-open]").length,
      chips: document.querySelectorAll("#phaseBody tr[data-schedule-open] .release-chip").length,
      jumps: document.querySelectorAll("#phaseBody tr[data-schedule-open] [data-jump-version]").length
    }))()`);
    assert(fallback.rows > 0 && fallback.chips > 0 && fallback.jumps === 0,
      `旧后端日程保持纯文本 pill（行 ${fallback.rows} / pill ${fallback.chips} / 跳转 ${fallback.jumps}）`);
    await shot("01-schedule-fallback");
    noExceptions("日程降级");

    /* 4. 日程：网络层注入同序 ids（后端重建前的前端契约验证），多版本逐枚接线 + _N 保持纯文本 */
    console.log("\n[2] 发布日程：注入同序 ids 后逐枚接线");
    const injected = { ids: [], reqs: [], names: [] };
    await call("Fetch.enable", { patterns: [{ urlPattern: "*\\/api\\/release-plans*", requestStage: "Response" }] });
    const pump = async () => {
      const paused = cdp.events.filter(e => e.method === "Fetch.requestPaused");
      cdp.events = cdp.events.filter(e => e.method !== "Fetch.requestPaused");
      for(const ev of paused){
        const requestId = ev.params.requestId;
        try{
          const body = await call("Fetch.getResponseBody", { requestId });
          const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
          const json = JSON.parse(text);
          const rows = Array.isArray(json.data) ? json.data : [];
          rows.forEach(r => {
            if(r.versionId){ r.versionNames = r.versionName; r.versionIds = r.versionId; r.versionReqIds = r.reqId; }
          });
          /* 当前空间计划数可能不足 3：用同空间真实版本拼一条三版本计划，验证逐枚对齐与 +N */
          if(rows.length && pick.pool.length >= 3){
            rows[0].versionNames = pick.pool.map(r => r.name).join(" / ");
            rows[0].versionIds = pick.pool.map(r => r.id).join(",");
            rows[0].versionReqIds = pick.pool.map(r => r.req).join(",");
            rows[0].versionCount = 3;
            injected.ids = pick.pool.map(r => r.id);
            injected.reqs = pick.pool.map(r => r.req);
            injected.names = pick.pool.map(r => r.name);
          }
          await call("Fetch.fulfillRequest", {
            requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(json)).toString("base64")
          });
        }catch(e){
          try{ await call("Fetch.continueRequest", { requestId }); }catch(e2){ /* 请求已结束 */ }
        }
      }
    };
    const pumpTimer = setInterval(() => { pump().catch(() => {}); }, 60);
    await evaluate(`import("./js/views/phase.js").then(m => { m.reloadView(); return true; })`);
    await waitFor(`document.querySelectorAll("#phaseBody tr[data-schedule-open] [data-jump-version]").length > 0`, "注入后日程跳转入口");
    await sleep(400);
    const linked = await evaluate(`(() => {
      const row = document.querySelector("#phaseBody tr[data-schedule-open]");
      const links = [...row.querySelectorAll("[data-jump-version]")].map(b => ({ id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim(), chip: b.classList.contains("release-chip") }));
      const more = row.querySelector(".release-chip.is-more");
      const single = [...document.querySelectorAll("#phaseBody tr[data-schedule-open]")].slice(1).map(tr => {
        const b = tr.querySelector("[data-jump-version]");
        return b ? { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req") } : null;
      });
      return { links, more: more ? more.textContent.trim() : null, moreIsLink: more ? more.hasAttribute("data-jump-version") : null, single };
    })()`);
    assert(linked.links.length === 2 && linked.links.every(l => l.chip), "多版本行展示两枚可点 pill：" + JSON.stringify(linked.links.map(l => l.text)));
    assert(linked.links[0].id === injected.ids[0] && linked.links[0].req === injected.reqs[0]
      && linked.links[1].id === injected.ids[1] && linked.links[1].req === injected.reqs[1], "pill 与注入 ids/reqIds 逐枚对齐（含跨项目 req）");
    assert(linked.more === "+1" && linked.moreIsLink === false, "+N 聚合计数保持纯文本：" + linked.more);
    assert(linked.single.every(s => s && s.id && s.req), "单版本行每行一枚带项目上下文的跳转入口");
    await shot("02-schedule-linked");
    await click("#phaseBody tr[data-schedule-open] [data-jump-version]");
    await expectLanding(injected.ids[0], "日程多版本 pill");
    await backTo("#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "回到版本页");
    await enterSchedule();
    /* 行内非链接区域仍打开计划工作区：跳转委托不抢整行点击 */
    await click("#phaseBody tr[data-schedule-open] td:first-child");
    const planOpened = await waitFor(`document.querySelectorAll(".modal-layer").length > 0`, "整行点击仍打开发布工作区", 15000).then(() => true).catch(() => false);
    assert(planOpened, "点非链接单元格仍打开发布计划工作区（跳转不抢整行点击）");
    await evaluate(`import("./js/core/ui.js").then(m => { document.querySelectorAll(".modal-layer").forEach(l => m.UI.closeModal(l)); return true; })`);
    await sleep(300);
    clearInterval(pumpTimer);
    await call("Fetch.disable");
    noExceptions("日程接线");

    /* 5. 交付说明选择器：版本名可点 */
    console.log("\n[3] 交付说明选择器");
    await evaluate(`import("./js/core/router.js").then(m => { m.showView("delivery"); return true; })`);
    await waitFor(`document.body.dataset.view === "delivery"`, "交付说明视图");
    await waitFor(`document.querySelectorAll(".dl-row .tt b [data-jump-version]").length > 0`, "选择器版本跳转入口");
    const picker = await evaluate(`(() => { const b = document.querySelector(".dl-row .tt b [data-jump-version]");
      return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim() }; })()`);
    assert(!!picker.id && !!picker.req, "选择器版本名带项目上下文：" + picker.text);
    await shot("03-delivery-picker");
    await click(".dl-row .tt b [data-jump-version]");
    await expectLanding(picker.id, "交付选择器");
    noExceptions("交付选择器");

    /* 6. 交付说明页头 chip：项目纯文本 + 版本可点；导出纸张不含跳转按钮 */
    console.log("\n[4] 交付说明页头 chip 与导出纸张边界");
    await evaluate(`import("./js/views/delivery.js").then(m => m.openDeliveryNote(${JSON.stringify(released.versionId)}, null))`);
    await waitFor(`document.querySelectorAll(".dl-head .dl-chip [data-jump-version]").length > 0`, "页头 chip 版本跳转入口");
    const head = await evaluate(`(() => { const chip = [...document.querySelectorAll(".dl-head .dl-chip")].find(c => c.querySelector("[data-jump-version]"));
      const b = chip.querySelector("[data-jump-version]");
      return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim(),
        chipText: chip.textContent.trim(), paperJumps: document.querySelectorAll("#dlPaper [data-jump-version]").length }; })()`);
    assert(head.id === released.versionId && head.req === released.reqId, "页头 chip 版本部分跳转到该版本：" + head.text);
    assert(head.chipText.indexOf(head.text) >= 0 && head.chipText !== head.text, "chip 内项目名仍为纯文本前缀：" + head.chipText);
    assert(head.paperJumps === 0, "导出纸张（#dlPaper）不含跳转按钮，保持纯文本");
    await shot("04-delivery-head");
    await click(".dl-head .dl-chip [data-jump-version]");
    await expectLanding(head.id, "交付页头 chip");
    noExceptions("交付页头");

    /* 7. 需求看板版本 tag */
    console.log("\n[5] 需求看板版本 tag");
    await evaluate(`Promise.all([import("./js/views/demands.js"), import("./js/core/router.js")]).then(([d, r]) => { d.openDemandsForReq(${JSON.stringify(pick.reqId)}); r.showView("demands"); return true; })`);
    await waitFor(`document.body.dataset.view === "demands"`, "需求池");
    await click('[data-dem-mode="board"]');
    await waitFor(`document.querySelectorAll(".bkl-card [data-jump-version]").length > 0`, "看板版本 tag 跳转入口");
    const board = await evaluate(`(() => { const b = document.querySelector(".bkl-card [data-jump-version]");
      return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim(), ghost: b.classList.contains("ghost") }; })()`);
    assert(!!board.id && board.req === pick.reqId && board.ghost, "看板版本 tag 保持 ghost 外观且可点：" + board.text);
    await shot("05-demands-board");
    await click(".bkl-card [data-jump-version]");
    await expectLanding(board.id, "看板版本 tag");
    noExceptions("看板");

    /* 8. 需求工作页列表·目标版本列：路由 status=plan 进入；列表形态是 .dem-work-list（非 table）；
       按版本分组时泳道标题即版本名、行内不重复该列，需切「按项目分组」。
       查询全部限定 #demandBody，避免命中隐藏的日程表格造成假阳性 */
    console.log("\n[6] 需求列表目标版本列");
    await backTo("#/demands?status=plan");
    await waitFor(`!!document.querySelector('#demandBody [data-dem-work-layout="list"]')`, "工作页列表形态切换（status=plan）");
    await click('#demandBody [data-dem-work-layout="list"]');
    await evaluate(`(() => { const s = document.querySelector('#demandBody [data-dem-work-filter="group"]'); if(!s) return false;
      s.value = "project"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    const listSel = "#demandBody .dem-work-list .dwl-version [data-jump-version]";
    let listFound = await waitFor(`document.querySelectorAll(${JSON.stringify(listSel)}).length > 0`, "列表版本列跳转入口", 8000).then(() => true).catch(() => false);
    if(!listFound){
      /* 当前项目已排期需求没有带版本的，放宽到全空间再找样本 */
      await evaluate(`(() => { const s = document.querySelector('#demandBody [data-dem-work-filter="reqId"]'); if(!s) return false;
        s.value = "all"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
      listFound = await waitFor(`document.querySelectorAll(${JSON.stringify(listSel)}).length > 0`, "列表版本列跳转入口（全空间）").then(() => true).catch(() => false);
    }
    assert(listFound, "列表目标版本列存在可点版本名");
    if(listFound){
      const cell = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(listSel)});
        return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim() }; })()`);
      assert(!!cell.id && !!cell.req, "列表目标版本列可点：" + cell.text);
      const selectPlain = await evaluate(`(() => { const s = document.querySelector('#demandBody [data-dem-work-filter="versionId"]');
        return s ? { options: s.querySelectorAll("option").length, jumps: s.querySelectorAll("[data-jump-version]").length } : null; })()`);
      assert(selectPlain && selectPlain.options > 0 && selectPlain.jumps === 0, "目标版本筛选 select 选项保持纯文本");
      await shot("06-demands-table");
      await click(listSel);
      await expectLanding(cell.id, "列表版本列");
    }
    noExceptions("列表版本列");

    /* 9. 需求交付证据表·工作项版本 */
    console.log("\n[7] 需求交付证据表版本");
    if(pick.withTasks){
      await evaluate(`import("./js/views/demands.js").then(m => m.openDemandDetailById(${JSON.stringify(pick.withTasks.id)}))`);
      await waitFor(`document.querySelectorAll("[data-dem-tab='delivery']").length > 0`, "需求抽屉页签");
      await click('[data-dem-tab="delivery"]');
      await waitFor(`document.querySelectorAll(".dem-evidence-tbl .t-sub [data-jump-version]").length > 0`, "证据表版本跳转入口");
      const ev = await evaluate(`(() => { const b = document.querySelector(".dem-evidence-tbl .t-sub [data-jump-version]");
        return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim() }; })()`);
      assert(!!ev.id && !!ev.req, "证据表工作项版本可点：" + ev.text);
      await shot("07-demand-evidence");
      await click(".dem-evidence-tbl .t-sub [data-jump-version]");
      await expectLanding(ev.id, "证据表版本");
    }else{
      failed++; console.log("  FAIL 演示数据中没有带版本绑定工作项的需求，证据表走查缺样本");
    }
    noExceptions("证据表");

    /* 10. 驾驶舱里程碑表·版本 sub */
    console.log("\n[8] 驾驶舱里程碑版本 sub");
    await navigate(BASE + "/index.html#/project");
    await waitFor(`document.body.dataset.view === "projects" || document.body.dataset.view === "project"`, "驾驶舱");
    const msFound = await waitFor(`document.querySelectorAll(".ms-sub [data-jump-version]").length > 0`, "里程碑版本跳转入口", 15000).then(() => true).catch(() => false);
    if(msFound){
      const ms = await evaluate(`(() => { const b = document.querySelector(".ms-sub [data-jump-version]");
        return { id: b.getAttribute("data-jump-version"), req: b.getAttribute("data-jump-req"), text: b.textContent.trim() }; })()`);
      assert(!!ms.id && !!ms.req, "里程碑版本 sub 可点：" + ms.text);
      await shot("08-milestone");
      await click(".ms-sub [data-jump-version]");
      await expectLanding(ms.id, "里程碑版本 sub");
    }else{
      failed++; console.log("  FAIL 当前项目里程碑没有带版本的达成方式，换项目后仍未找到样本");
    }
    noExceptions("里程碑");

    console.log("\n通过 " + passed + " 项，失败 " + failed + " 项");
    console.log("截图：" + SHOTS);
    process.exitCode = failed ? 1 : 0;
  }catch(err){
    console.error("\n运行失败：" + (err && err.stack || err));
    process.exitCode = 1;
  }finally{
    try{ child.kill(); }catch(e){}
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){}
    process.exit(process.exitCode || 0);
  }
}

main();