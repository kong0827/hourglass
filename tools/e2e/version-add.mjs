/* B5 版本页「添加工作项 / 添加需求」抽屉走查：
   工作项三选一（① 需求拆解交接到需求详情 / ② 新建表单预选版本 / ③ 跨版本带入真实保存），
   需求抽屉创建后进入待评审（不进版本需求列表），最后还原测试数据。
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
         E2E_VERSION=Vmwkdzu9q7a4dlyka E2E_REQ=Xkp01 node tools/e2e/version-add.mjs
   收尾：本版本关联会走 API 还原；临时版本/需求删除仅空间主可做，admin 被拒时脚本会打印 SQL 收尾语句。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const VERSION = process.env.E2E_VERSION || "Vmwkdzu9q7a4dlyka";
const REQ = process.env.E2E_REQ || "Xkp01";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-vadd-"));
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

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
    }catch(e){ /* waiting */ }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-vadd-chrome-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });
  let cdp, evaluate, waitFor, shot;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    for(const domain of ["Page", "Runtime", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);
    const call = (method, params) => cdp.send(method, params, sessionId);
    evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    waitFor = async (expression, label, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expression); if(last) return last; }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "加载 " + url, 25000);
    };
    shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };

    console.log("B5 添加工作项/需求抽屉 走查\n  地址：" + BASE + "\n  截图：" + SHOTS);

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
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);
    pass("登录 " + USER);

    /* ---------- (a) 向导选版默认隐藏已发布/已关闭 ---------- */
    await navigate(BASE + "/index.html#/plan-wizard?from=plans&anchor=" + encodeURIComponent(VERSION)
      + "&reqId=" + encodeURIComponent(REQ) + "&ids=" + encodeURIComponent(VERSION));
    await waitFor(`document.body.dataset.view === "plan-wizard" && !!document.querySelector(".pw-vgroup, .pw-vmore")`, "向导选版列表", 20000);
    await sleep(500);
    const wiz = await evaluate(`(() => {
      const more = document.querySelector(".pw-vmore");
      const text = more ? more.textContent.replace(/\\s+/g, " ").trim() : "";
      const shown = [...document.querySelectorAll(".pw-vrow")];
      const hiddenN = Number((text.match(/已隐藏 (\\d+) 个/) || [])[1] || 0);
      return {
        more: text,
        hasShow: !!document.querySelector("[data-pw-showoff]"),
        visible: shown.length,
        releasedVisible: shown.filter(r => /已发布|已关闭|已取消/.test(r.textContent)).length,
        hiddenN
      };
    })()`);
    assert(wiz.hiddenN > 0 && wiz.hasShow && /不可选，默认不展示/.test(wiz.more), "向导默认隐藏 " + wiz.hiddenN + " 个已发布/已关闭版本：" + wiz.more);
    assert(wiz.releasedVisible === 0, "折叠时列表里没有已发布/已关闭版本");
    await evaluate(`(() => { const m = document.querySelector(".pw-vmore"); if(m) m.scrollIntoView({ block: "center" }); return true; })()`);
    await sleep(250);
    await shot("b5-wizard-hidden-1440");
    await evaluate(`(() => { const b = document.querySelector("[data-pw-showoff]"); if(b) b.click(); return true; })()`);
    await sleep(400);
    const wiz2 = await evaluate(`(() => {
      const rows = [...document.querySelectorAll(".pw-vrow")].filter(r => /已发布不可选|已关闭不可选|已取消不可选/.test(r.textContent));
      return {
        released: rows.length,
        allDisabled: rows.every(r => { const c = r.querySelector("input[type=checkbox]"); return c && c.disabled; })
      };
    })()`);
    assert(wiz2.released > 0 && wiz2.allDisabled, "展开后 " + wiz2.released + " 个终态版本仍为不可选");
    await evaluate(`(() => { const r = [...document.querySelectorAll(".pw-vrow")].filter(x => /已发布不可选/.test(x.textContent))[0]; if(r) r.scrollIntoView({ block: "center" }); return true; })()`);
    await sleep(250);
    await shot("b5-wizard-showoff-1440");


    /* ---------- 准备：临时源版本 + 两个未完成工作项关联 ---------- */
    const prep = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const options = await API.get("/api/versions/task-options", { reqId: ${JSON.stringify(REQ)} });
      const mine = id => (t => Array.isArray(t.versionIds) ? t.versionIds : []).bind(null);
      const targetIds = (options || []).filter(t => (t.versionIds || []).indexOf(${JSON.stringify(VERSION)}) !== -1).map(t => t.id);
      const free = (options || []).filter(t => t.boardColumn !== "done" && (t.versionIds || []).length === 0).slice(0, 2);
      const src = await API.post("/api/versions", {
        reqId: ${JSON.stringify(REQ)}, name: "E2E-带入源-${STAMP}", description: null,
        startDate: null, targetDate: null, status: "planned", revision: null
      });
      await API.put("/api/versions/" + encodeURIComponent(src.id), {
        reqId: ${JSON.stringify(REQ)}, name: src.name || "E2E-带入源-${STAMP}", description: null,
        startDate: null, targetDate: null, status: "planned", revision: src.revision,
        taskIds: free.map(t => t.id), taskChangeReason: "E2E 准备：挂两个未完成工作项"
      });
      return { srcId: src.id, srcName: src.name || "E2E-带入源-${STAMP}", targetIds, free: free.map(t => ({ id: t.id, title: t.title })) };
    })()`);
    assert(!!prep.srcId && prep.free.length === 2, "准备源版本 " + prep.srcName + "，挂上 " + prep.free.length + " 个未完成工作项");
    const crossIds = prep.free.map(t => t.id);

    /* ---------- 工作项页：打开三选一抽屉 ---------- */
    await navigate(BASE + "/index.html#/version?id=" + encodeURIComponent(VERSION) + "&tab=scope");
    await waitFor(`document.body.dataset.view === "version" && !!document.querySelector("#view-version .vd-tabs")`, "版本详情", 25000);
    await waitFor(`!!document.querySelector("[data-vd-add-items]")`, "工作项页主操作");
    await waitFor(`+(( document.querySelector('[data-vd-tab="demands"] b') || {}).textContent || 0) >= 1`, "需求侧数据加载", 15000);
    const opened = await evaluate(`(() => { const b = document.querySelector("[data-vd-add-items]"); if(!b) return false; b.click(); return true; })()`);
    assert(opened, "点得到「添加工作项」");
    await waitFor(`!!document.querySelector(".modal-layer .vd-add-sheet")`, "添加工作项抽屉", 8000);
    await sleep(500);

    const ui = await evaluate(`(() => {
      const sheet = document.querySelector(".modal-layer .vd-add-sheet");
      const ways = [...sheet.querySelectorAll("[data-add-way]")].map(w => ({
        n: w.getAttribute("data-add-way"), on: w.classList.contains("is-on"),
        t: (w.querySelector(".vd-way-t") || {}).textContent || "", d: (w.querySelector(".vd-way-d") || {}).textContent || ""
      }));
      const p1 = sheet.querySelector('[data-add-pane="1"]');
      const sel = p1.querySelector("select[data-add-demand]");
      return {
        title: (sheet.querySelector(".sheet-head h2") || {}).textContent || "",
        desc: (sheet.querySelector(".sheet-head .desc") || {}).textContent || "",
        width: Math.round(sheet.getBoundingClientRect().width),
        ways,
        go: (sheet.querySelector("[data-add-go]") || {}).textContent || "",
        goDisabled: !!(sheet.querySelector("[data-add-go]") || {}).disabled,
        demandOptions: sel ? [...sel.options].map(o => o.textContent.trim()) : [],
        hiddenPanes: [2, 3].filter(n => sheet.querySelector('[data-add-pane="' + n + '"]').hidden).length
      };
    })()`);
    assert(ui.title === "添加工作项" && ui.desc.indexOf("V1.2") >= 0, "抽屉标题与目标版本：" + ui.title + " / " + ui.desc);
    assert(ui.ways.length === 3 && ui.ways[0].on && ui.ways.every(w => w.t && w.d), "三选一：① 默认选中，每条都有标题与说明");
    assert(ui.ways[0].t.indexOf("推荐") >= 0, "① 从需求拆解带「推荐」");
    assert(ui.demandOptions.length >= 1 && ui.demandOptions.some(t => /未拆解|已挂/.test(t)), "需求下拉 " + ui.demandOptions.length + " 条，标注拆解状态");
    assert(ui.go === "生成工作项" && !ui.goDisabled, "主按钮「生成工作项」可用");
    assert(ui.hiddenPanes === 2, "未选中的两个面板隐藏");
    assert(ui.width <= 600, "侧滑抽屉宽度 " + ui.width + "px");
    await shot("b5-add-items-way1-1440");

    /* ② 直接新建：预填本版本 */
    await evaluate(`(() => { document.querySelector('[data-add-way="2"]').click(); return true; })()`);
    await sleep(200);
    const p2 = await evaluate(`(() => {
      const s = document.querySelector(".modal-layer .vd-add-sheet");
      return {
        on: s.querySelector('[data-add-way="2"]').classList.contains("is-on"),
        text: (s.querySelector('[data-add-pane="2"]') || {}).textContent || "",
        go: (s.querySelector("[data-add-go]") || {}).textContent || ""
      };
    })()`);
    assert(p2.on && p2.go === "打开新建表单", "切到 ② 后主按钮变「打开新建表单」");
    assert(/将新建到/.test(p2.text) && /V1\.2/.test(p2.text), "② 预填「将新建到 项目 · V1.2」");
    await shot("b5-add-items-way2-1440");

    /* ③ 从其他版本带入：真实保存 */
    await evaluate(`(() => { document.querySelector('[data-add-way="3"]').click(); return true; })()`);
    await waitFor(`(() => { const s = document.querySelector(".modal-layer .vd-add-sheet [data-add-pane='3'] select[data-add-source]"); return !!(s && s.options.length); })()`, "源版本下拉", 10000);
    const p3 = await evaluate(`(() => {
      const s = document.querySelector(".modal-layer .vd-add-sheet");
      const sel = s.querySelector('[data-add-pane="3"] select[data-add-source]');
      const pick = s.querySelector('[data-add-pane="3"]');
      return {
        options: [...sel.options].map(o => o.textContent.trim()),
        rows: pick.querySelectorAll("[data-add-task]").length,
        go: (s.querySelector("[data-add-go]") || {}).textContent || "",
        goDisabled: !!(s.querySelector("[data-add-go]") || {}).disabled,
        hasAll: !!pick.querySelector("[data-add-all]")
      };
    })()`);
    assert(p3.options.some(t => t.indexOf("E2E-带入源-" + STAMP) >= 0 && /未完成 2 项/.test(t)), "③ 源版本下拉列出临时版本：" + p3.options.join(" | "));
    assert(p3.rows === 2 && p3.hasAll, "③ 勾选列表 " + p3.rows + " 行，含全选");
    assert(p3.goDisabled, "未选时主按钮禁用");
    await evaluate(`(() => { const s = document.querySelector('.modal-layer .vd-add-sheet [data-add-pane="3"]'); s.querySelector("[data-add-all]").click(); return true; })()`);
    await sleep(150);
    const p3b = await evaluate(`(() => {
      const s = document.querySelector(".modal-layer .vd-add-sheet");
      return {
        checked: s.querySelectorAll('[data-add-pane="3"] [data-add-task]:checked').length,
        go: (s.querySelector("[data-add-go]") || {}).textContent || "",
        goDisabled: !!(s.querySelector("[data-add-go]") || {}).disabled
      };
    })()`);
    assert(p3b.checked === 2 && p3b.go === "带入 2 个工作项" && !p3b.goDisabled, "全选后主按钮「带入 2 个工作项」");
    await shot("b5-add-items-way3-1440");
    await evaluate(`(() => { document.querySelector(".modal-layer .vd-add-sheet [data-add-go]").click(); return true; })()`);
    await waitFor(`!/带入失败|保存失败/.test(document.querySelector(".toast") ? document.querySelector(".toast").textContent : "") && !document.querySelector(".modal-layer .vd-add-sheet")`, "带入保存完成", 12000);
    await sleep(800);
    const bound = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/task-options", { reqId: ${JSON.stringify(REQ)} });
      const hit = ${JSON.stringify(crossIds)}.filter(id => (rows || []).some(t => t.id === id && (t.versionIds || []).indexOf(${JSON.stringify(VERSION)}) !== -1));
      return hit.length;
    })()`);
    assert(bound === 2, "保存后两个工作项都关联到本版本（" + bound + "/2）");

    /* ---------- ① 需求拆解交接到需求详情 ---------- */
    const reopened = await evaluate(`(() => { const b = document.querySelector("[data-vd-add-items]"); if(!b) return false; b.click(); return true; })()`);
    assert(reopened, "重新打开「添加工作项」");
    await waitFor(`!!document.querySelector(".modal-layer .vd-add-sheet")`, "抽屉再次打开", 8000);
    await evaluate(`(() => { document.querySelector(".modal-layer .vd-add-sheet [data-add-go]").click(); return true; })()`);
    await waitFor(`!!document.querySelector(".modal-layer.demand-detail")`, "交接到需求详情", 15000);
    await sleep(400);
    const split = await evaluate(`(() => {
      const dlg = document.querySelector(".modal-layer.demand-detail");
      const text = dlg ? dlg.textContent : "";
      return { layers: dlg ? 1 : 0, hasDetail: /验收标准/.test(text) || /优先级/.test(text) };
    })()`);
    assert(split.layers >= 1 && split.hasDetail, "弹出需求详情，交由同一条拆解流程");
    const splitNote = await evaluate(`(() => { const s = document.querySelector(".toast"); return s ? s.textContent.trim() : ""; })()`);
    if(splitNote) console.log("  提示：" + splitNote);
    await sleep(600);
    await shot("b5-split-handoff-1440");
    await evaluate(`(() => {
      document.querySelectorAll(".modal-layer").forEach(x => x.remove());
      document.body.style.overflow = "";
      return true;
    })()`);
    await sleep(400);

    /* ---------- 需求页：添加需求抽屉 ---------- */
    await evaluate(`(() => { const t = document.querySelector('#view-version [data-vd-tab="demands"]'); if(t) t.click(); return true; })()`);
    await waitFor(`!!document.querySelector("[data-vd-add-demand]")`, "需求页主操作");
    await evaluate(`(() => { document.querySelector("[data-vd-add-demand]").click(); return true; })()`);
    await waitFor(`!!document.querySelector(".modal-layer .vd-add-sheet")`, "添加需求抽屉", 8000);
    await sleep(450);
    const dr = await evaluate(`(() => {
      const s = document.querySelector(".modal-layer .vd-add-sheet");
      return {
        title: (s.querySelector(".sheet-head h2") || {}).textContent || "",
        intro: (s.querySelector(".vd-add-intro") || {}).textContent || "",
        pri: [...s.querySelectorAll("[data-add-pri]")].map(b => ({ t: b.textContent.trim(), on: b.classList.contains("on") })),
        cols: (() => { const g = s.querySelector(".radio-cards.vd-pri4"); return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0; })(),
        fields: s.querySelectorAll(".field").length,
        hints: [...s.querySelectorAll(".field .hint")].map(x => x.textContent).join(" | ")
      };
    })()`);
    assert(dr.title === "添加需求" && /待评审/.test(dr.intro), "需求抽屉写明「创建后进入待评审」");
    assert(dr.fields >= 5, "字段 " + dr.fields + " 组（标题/描述/验收/优先级/提出人）");
    assert(dr.pri.length === 4 && dr.pri[1].on && dr.cols === 4, "优先级四档单行，默认「高」");
    assert(/能力清单/.test(dr.hints), "验收标准帮助写清来源");
    await shot("b5-add-demand-1440");

    const demTitle = "E2E 添加需求 " + STAMP;
    await evaluate(`(() => {
      const s = document.querySelector(".modal-layer .vd-add-sheet");
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(s.querySelector("[data-add-title]"), ${JSON.stringify(demTitle)});
      set(s.querySelector("[data-add-desc]"), "E2E：从版本需求页直接添加，验证进入待评审。");
      set(s.querySelector("[data-add-accept]"), "E2E：创建后出现在待评审，评审通过并排期后才进版本需求列表。");
      s.querySelector("[data-add-create]").click();
      return true;
    })()`);
    await waitFor(`(() => { const t = document.querySelector(".toast"); return !!(t && /已提交评审/.test(t.textContent)); })()`, "创建提示", 12000);
    pass("创建后提示进入待评审");
    await sleep(600);

    const created = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.getAllPages("/api/demands", { reqId: ${JSON.stringify(REQ)} });
      const hit = (rows || []).filter(d => String(d.title || "").indexOf("E2E 添加需求 ${STAMP}") === 0)[0];
      return hit ? { id: hit.id, status: hit.status, versionId: hit.versionId || "" } : null;
    })()`);
    assert(!!created, "需求库能查到新建需求");
    if(created){
      assert(created.status === "review", "新建需求状态为 review（待评审）：" + created.status);
      assert(!created.versionId, "新建需求未直接排期到版本（需评审通过后排期）");
      const inTab = await evaluate(`(() => { const t = document.querySelector("#view-version"); return t ? t.textContent.indexOf(${JSON.stringify(demTitle)}) !== -1 : false; })()`);
      assert(!inTab, "版本需求列表暂不显示待评审需求");
    }

    const bad = cdp.takeExceptions();
    assert(bad.length === 0, "无前端异常" + (bad.length ? "：" + JSON.stringify(bad.slice(0, 2)) : ""));

    /* ---------- 还原 ---------- */
    const clean = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const out = { restored: false, srcCleared: false, srcDeleted: false, demandDeleted: false };
      const versions = await API.get("/api/versions", { reqId: ${JSON.stringify(REQ)} });
      const v = (versions || []).filter(x => x.id === ${JSON.stringify(VERSION)})[0];
      if(v){
        await API.put("/api/versions/" + encodeURIComponent(${JSON.stringify(VERSION)}), {
          reqId: ${JSON.stringify(REQ)}, name: v.name, description: v.description || null,
          startDate: v.startDate || null, targetDate: v.targetDate || null,
          status: v.status === "active" ? "active" : "planned", revision: v.revision,
          taskIds: ${JSON.stringify(prep.targetIds)}, taskChangeReason: "E2E 还原：移除带入的两个工作项"
        });
        out.restored = true;
      }
      try{
        const src = (versions || []).filter(x => x.name === "E2E-带入源-${STAMP}")[0];
        if(src){
          await API.put("/api/versions/" + encodeURIComponent(src.id), {
            reqId: ${JSON.stringify(REQ)}, name: src.name, description: null, startDate: null, targetDate: null,
            status: "planned", revision: src.revision, taskIds: [], taskChangeReason: "E2E 清理：清空关联"
          });
          out.srcCleared = true;
          await API.del("/api/versions/" + encodeURIComponent(src.id));
          out.srcDeleted = true;
        }
      }catch(e){ out.srcError = e.message; }
      if(${JSON.stringify(created && created.id || "")}){
        try{ await API.del("/api/demands/" + encodeURIComponent(${JSON.stringify(created && created.id || "")})); out.demandDeleted = true; }
        catch(e){ out.demandError = e.message; }
      }
      return out;
    })()`);
    assert(clean.restored, "还原本版本工作项关联");
    /* 删除仅空间主可执行：admin 在演示空间只是管理员，策略拒绝属预期；未删掉的用 SQL 收尾 */
    const denied = e => /空间主/.test(e || "");
    assert(clean.srcCleared && (clean.srcDeleted || denied(clean.srcError)), "清理临时源版本"
      + (clean.srcDeleted ? "" : "（API 拒绝，留 SQL 收尾：" + clean.srcError + "）"));
    assert(clean.demandDeleted || denied(clean.demandError), "清理临时需求"
      + (clean.demandDeleted ? "" : "（API 拒绝，留 SQL 收尾：" + clean.demandError + "）"));
    if(!clean.srcDeleted || !clean.demandDeleted){
      console.log("  SQL 收尾：delete from version_commitment_task where version_id='" + prep.srcId + "';"
        + " delete from project_version where id='" + prep.srcId + "';"
        + " delete from demand_watch where demand_id='" + (created && created.id || "") + "';"
        + " delete from demand_log where demand_id='" + (created && created.id || "") + "';"
        + " delete from demand where id='" + (created && created.id || "") + "';");
    }
    console.log("  还原结果：" + JSON.stringify(clean));

    console.log(`\n通过 ${passed}，失败 ${failed}`);
    if(failed) process.exitCode = 1;
  } finally{
    try{ await cdp.send("Browser.close"); }catch(e){ /* noop */ }
    child.kill("SIGKILL");
  }
}

main().catch(ex => { console.error(ex.stack || ex.message); process.exit(1); });
