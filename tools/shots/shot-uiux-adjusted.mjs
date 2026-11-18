/* UIUX 体验分析报告「调整后原型图」采集
   真实前端 ESM + headless Chrome/CDP，跑本地 8081 演示库（admin/123456）。
   原生 CDP 骨架同 tools/e2e/backup-numbers.mjs：Node 内置 WebSocket，无外部依赖。

   只读演示空间 SXk01；「首屏引导卡 / 空版本引导卡」这类需要空数据的界面，
   用一次性临时空间（跑完删除并切回演示空间），不写、不碰演示数据。

   用法：node tools/shots/shot-uiux-adjusted.mjs
   产出：内部资料/uiux-review-20261118/调整后原型图/*.png */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/调整后原型图";
const DEMO_WS = "SXk01";                 /* 演示空间，跑完切回 */
const VER_WITH_TASKS = "Vmwkdzu9q7a4dlyka"; /* V1.2 · 资金通 · active · 16 工作项 */

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
const port = Number(process.env.E2E_CDP_PORT || 9377);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uiux-shot-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=1440,1000", "--disable-dev-shm-usage"
], { stdio: "ignore", detached: true });

fs.mkdirSync(OUT, { recursive: true });
let ok = 0, bad = 0;
const shots = [];
const log = (cond, name, extra = "") => { console.log((cond ? "  PASS " : "  FAIL ") + name + (extra ? "  => " + extra : "")); cond ? ok++ : bad++; };

let evaluate = null, call = null, waitFor = null, createdWs = null;

/* 截屏：fullPage 走 captureBeyondViewport，其余只截视口 */
async function shot(file, { fullPage = false } = {}){
  const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage });
  const p = path.join(OUT, file);
  fs.writeFileSync(p, Buffer.from(r.data, "base64"));
  shots.push(file);
  return p;
}
/* 每个界面独立兜底：单张失败不影响其余 */
async function capture(file, fn, { fullPage = false } = {}){
  try{ await fn(); await sleep(220); await shot(file, { fullPage }); log(true, file); }
  catch(e){ log(false, file, e.message); }
}
/* 哈希路由：改 hash 后手动补发 hashchange（与既有 e2e 同口径）
   导航确认失败只告警、不中断整轮采集（后续 capture 各自兜底） */
async function nav(hash, waitExpr, timeout = 18000){
  await evaluate(`(() => { location.hash = ${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); return true; })()`);
  try{ await waitFor(waitExpr, "导航 " + hash, timeout); }
  catch(e){ console.log("  WARN 导航未确认 " + hash + " => " + e.message); }
  await sleep(360);
}

async function main(){
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);

  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
  call = (m, p) => cdp.send(m, p, sid);
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
  const api = (method, url, body) => evaluate(
    `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);
  const metrics = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });

  console.log("UIUX 调整后原型图采集\n  地址：" + BASE + "\n  产出：" + OUT + "\n");

  /* ---------- 登录 ---------- */
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => { const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click(); return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!(rt.currentWs && rt.currentWs.id))`, "空间初始化", 12000).catch(()=>{});
  await metrics(1440, 1000, false);
  console.log("  已登录：" + USER + " @ " + (await evaluate(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.name)`)) + "\n");

  /* ================= P1-7 全局新建菜单（7 类对象 + 移动端 AI） ================= */
  await nav("#/phase", `document.body.dataset.view === "phase"`);
  await capture("01-新建菜单-全对象.png", async () => {
    await evaluate(`document.getElementById("btnNew").click()`);
    await waitFor(`!!document.querySelector("#newMenu:not([hidden]) [data-new='doc']")`, "新建菜单展开");
  });
  await evaluate(`(() => { const { UI } = window; return true; })()`).catch(()=>{});
  await evaluate(`document.body.click()`).catch(()=>{});

  /* ================= P1-5 面包屑 + P2-14 版本详情主按钮（active→记录实际发布） ================= */
  await nav("#/version?id=" + VER_WITH_TASKS, `document.body.dataset.view === "version"`);
  await waitFor(`!!document.querySelector("#view-version .vd-kpis, #view-version [data-vd-tool]")`, "版本详情渲染", 12000).catch(()=>{});
  await capture("02-版本详情-面包屑与主按钮.png", async () => {
    const info = await evaluate(`(() => {
      const sub = document.querySelector(".tb-sub");
      const prim = [...document.querySelectorAll("#view-version .btn.primary, #view-version [data-vd-tool].primary")].map(b=>b.textContent.trim());
      return { crumb: sub ? sub.textContent.replace(/\\s+/g," ").trim() : "", crumbClass: sub ? sub.className : "", prim };
    })()`);
    if(!/版本/.test(info.crumb)) throw new Error("面包屑未出现：" + info.crumb);
  }, { fullPage: false });

  /* ================= P1-6 phase 首屏「最近发布计划」卡 ================= */
  await nav("#/phase", `document.body.dataset.view === "phase"`);
  await capture("03-版本页-最近发布计划卡.png", async () => {
    /* 强制走「按阶段」重渲染：该口径首屏才带「最近发布计划」卡 */
    await evaluate(`(() => { const b = document.querySelector('#phaseModeSeg [data-pmode="phase"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".phase-recent-plans")`, "最近发布计划卡", 16000);
    await evaluate(`document.querySelector(".phase-recent-plans").scrollIntoView({block:"center"})`);
  }, { fullPage: false });

  /* ================= P1-6 #/release 无参数 → 最近计划列表（非死胡同） ================= */
  await nav("#/release", `document.body.dataset.view === "release"`);
  await capture("04-发布无参数-最近计划列表.png", async () => {
    await waitFor(`!!document.querySelector(".release-page .panel-head h3")`, "发布页面板", 10000);
    const h = await evaluate(`(document.querySelector(".release-page .panel-head h3")||{}).textContent||""`);
    if(!/最近发布计划/.test(h)) throw new Error("无参数发布页标题异常：" + h);
  }, { fullPage: true });

  /* ================= P1-8 分支工具栏：新建分支移到右上、分段右对齐 ================= */
  await nav("#/branches", `document.body.dataset.view === "branches"`);
  await capture("05-分支-工具栏新建右上.png", async () => {
    await waitFor(`!!document.getElementById("branchNew")`, "分支工具栏", 10000);
  }, { fullPage: false });

  /* ================= P1-8 文档工具栏：视图分段右对齐 + P2-13「视图列表」 ================= */
  await nav("#/requirements", `document.body.dataset.view === "requirements"`);
  await capture("06-文档-分段右对齐与视图列表.png", async () => {
    await waitFor(`!!document.querySelector(".reqdoc-modes [data-rdmode='read']")`, "文档分段", 10000);
  }, { fullPage: false });

  /* ================= P1-9 甘特工具栏降噪：视图偏好收进「更多」 ================= */
  await nav("#/gantt", `document.body.dataset.view === "gantt"`);
  await capture("07-甘特-更多菜单收纳偏好.png", async () => {
    await waitFor(`!!document.getElementById("ganttMore")`, "甘特工具栏", 12000);
    await evaluate(`(() => { const d = document.getElementById("ganttMore"); d.open = true; const s = d.querySelector("summary"); if(s) s.click(); return true; })()`);
    await sleep(200);
    await evaluate(`(() => { const d = document.getElementById("ganttMore"); if(!d.open){ d.open = true; } return true; })()`);
  }, { fullPage: false });

  /* ================= P1-9 我的工作降噪 + P2-13「标准/宽松」加密度标签 ================= */
  await nav("#/mine", `document.body.dataset.view === "mine"`);
  await capture("08-我的工作-显示设置收纳.png", async () => {
    await waitFor(`!!document.getElementById("mineMore")`, "我的工作工具栏", 12000);
    await evaluate(`(() => { const d = document.getElementById("mineMore"); d.open = true; const s = d.querySelector("summary"); if(s) s.click(); return true; })()`);
    await sleep(200);
    await evaluate(`(() => { const d = document.getElementById("mineMore"); if(!d.open){ d.open = true; } return true; })()`);
  }, { fullPage: false });

  /* ================= P2-16 报表-交付图表：复述行改为「仅非默认筛选时显示 chip」 ================= */
  await nav("#/report", `document.body.dataset.view === "report"`);
  await capture("09-报表-筛选生效chip.png", async () => {
    await waitFor(`!!document.getElementById("reportProjectSelect")`, "报表筛选", 12000);
    await evaluate(`(() => {
      const s = document.getElementById("reportProjectSelect");
      const opt = [...s.options].find(o => o.value);
      if(opt){ s.value = opt.value; s.dispatchEvent(new Event("change", { bubbles: true })); }
      return true;
    })()`);
    await waitFor(`!!document.querySelector(".report-scope-chips .report-scope-chip")`, "筛选 chip 行", 8000);
  }, { fullPage: false });

  /* ================= P1-10 状态徽标两态：抽屉头部可操作徽标（带 caret） ================= */
  await nav("#/board", `document.body.dataset.view === "board"`);
  await capture("10-状态徽标-抽屉可操作态.png", async () => {
    await waitFor(`!!document.querySelector("#view-board .card[data-id], .board .card[data-id]")`, "看板卡片", 12000);
    await evaluate(`(() => { const c = document.querySelector("#view-board .card[data-id], .board .card[data-id]"); if(c) c.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".drawer .ds-status, .ds-status")`, "任务抽屉状态徽标", 10000);
  }, { fullPage: false });
  await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`).catch(()=>{});
  await sleep(300);

  /* ================= P2-13 / P-UC-1 测试侧栏长段落折叠进「?」popover ================= */
  await nav("#/testcases", `document.body.dataset.view === "testcases"`);
  await capture("11-测试-分组规则popover.png", async () => {
    await waitFor(`!!document.getElementById("tcSetRuleBtn")`, "分组规则触发", 12000);
    await evaluate(`document.getElementById("tcSetRuleBtn").click()`);
    await waitFor(`!!document.querySelector(".tc-rule-line")`, "规则 popover", 8000);
  }, { fullPage: false });
  await evaluate(`(() => { const { UI } = window; return true; })()`).catch(()=>{});
  await evaluate(`document.body.click()`).catch(()=>{});

  /* ================= P0-3 标题说明句防截断（两行 + hover 全文） ================= */
  await nav("#/demands", `document.body.dataset.view === "demands"`);
  await capture("12-需求池-说明句两行.png", async () => {
    await waitFor(`!!document.querySelector(".tb-sub")`, "标题说明句", 10000);
    const info = await evaluate(`(() => {
      const s = document.querySelector(".tb-sub");
      const cs = getComputedStyle(s);
      return { clamp: cs.webkitLineClamp, title: s.title || "", text: s.textContent.replace(/\\s+/g," ").trim() };
    })()`);
    if(info.clamp !== "2") throw new Error("说明句未设为两行 clamp：" + info.clamp);
  }, { fullPage: false });

  /* ================= P2-15 头像降饱和到语义色同档 ================= */
  await nav("#/workload", `document.body.dataset.view === "workload"`);
  await capture("13-成员负载-降饱和头像.png", async () => {
    await waitFor(`!!document.querySelector("#view-workload .avatar, #view-workload [class*=avatar]")`, "成员头像", 12000);
  }, { fullPage: false });

  /* ================= P0-1 懒加载进度指示（强制点亮顶部 2px 进度条） ================= */
  await nav("#/phase", `document.body.dataset.view === "phase"`);
  await capture("14-懒加载-顶部进度条.png", async () => {
    await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.chunkBusy(true); return true; })`);
    await waitFor(`document.getElementById("syncBar") && document.getElementById("syncBar").classList.contains("on")`, "进度条点亮", 5000);
  }, { fullPage: false });
  await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.chunkBusy(false); return true; })`).catch(()=>{});

  /* ================= P2-12 表单失焦校验：新建项目排期日期非法即时标红 ================= */
  await nav("#/projects", `document.body.dataset.view === "projects"`);
  await capture("15-新建项目-日期失焦校验.png", async () => {
    await waitFor(`!!document.getElementById("btnNewReq") || !!document.querySelector("[data-new='req']") || true`, "项目页", 8000);
    await evaluate(`import("./js/views/projects.js").then(m => { if(m.openProjectDialog) m.openProjectDialog(null); return true; })`);
    await waitFor(`!!document.getElementById("rName") && !document.getElementById("rName").closest("[hidden]")`, "新建项目弹窗", 8000);
    await evaluate(`(() => {
      const setv = (id, v) => { const el = document.getElementById(id); if(!el) return;
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      setv("rName", "校验演示项目");
      setv("rPlanStart", "2026-12-10");
      setv("rPlanEnd", "2026-12-01");
      const e = document.getElementById("rPlanEnd"); if(e){ e.dispatchEvent(new Event("change", { bubbles: true })); e.dispatchEvent(new FocusEvent("blur", { bubbles: true })); e.blur && e.blur(); }
      return true;
    })()`);
    await sleep(260);
    await waitFor(`!!document.querySelector("#fReqPlanStart.invalid, #fReqPlanEnd.invalid")`, "日期字段标红", 5000);
  }, { fullPage: false });
  await evaluate(`(() => { const b = document.getElementById("btnCancelReq") || document.querySelector("#dlgReq [data-close]"); if(b) b.click(); return true; })()`).catch(()=>{});
  await sleep(250);

  /* ================= 移动端：P0-2 单 FAB（AI 收进新建菜单） + P-UC-4 蓝条文案 ================= */
  await metrics(390, 844, true);
  await call("Page.reload");
  await waitFor("document.readyState === 'complete' && document.body && document.body.dataset.view", "移动端重载", 15000);
  await sleep(600);
  await nav("#/board", `document.body.dataset.view === "board"`);
  await capture("16-移动端-看板单FAB与蓝条.png", async () => {
    await waitFor(`!!document.querySelector(".mob-stage-link")`, "移动端蓝条", 12000);
    const info = await evaluate(`(() => {
      const link = document.querySelector(".mob-stage-link");
      const aiFab = document.querySelector(".ai-fab");
      const aiVisible = aiFab ? getComputedStyle(aiFab).display !== "none" : false;
      const newFab = document.getElementById("btnNew");
      return { blue: link ? link.textContent.replace(/\\s+/g," ").trim() : "", aiVisible, newFab: !!newFab };
    })()`);
    if(!/项 →/.test(info.blue)) throw new Error("蓝条文案未改为「N 项 →」：" + info.blue);
    if(info.aiVisible) throw new Error("移动端 AI 悬浮钮仍可见（未收进新建菜单）");
  }, { fullPage: false });

  await capture("17-移动端-新建菜单含AI助手.png", async () => {
    await evaluate(`document.getElementById("btnNew").click()`);
    await waitFor(`!!document.querySelector("#newMenu:not([hidden]) [data-new='ai']")`, "移动端新建菜单含 AI", 6000);
    const vis = await evaluate(`(() => { const ai = document.getElementById("newMenuAi"); return ai ? !ai.hidden && getComputedStyle(ai).display !== "none" : false; })()`);
    if(!vis) throw new Error("移动端 AI 助手入口未显示");
  }, { fullPage: false });
  await evaluate(`document.body.click()`).catch(()=>{});
  await metrics(1440, 1000, false);

  /* ================= P0-4 首屏引导卡 + P2-14 空版本引导卡（一次性临时空间） ================= */
  console.log("\n  [临时空间] 采集空数据引导卡…");
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  try{
    const wsRow = await api("post", "/api/workspaces", { name: "原型临时" + tag });
    createdWs = wsRow && wsRow.id;
    if(!createdWs) throw new Error("临时空间创建失败");
    await api("post", `/api/workspaces/${createdWs}/select`, {});
    /* select 只改服务端当前空间；必须重载页面，应用才会以新空间初始化 */
    await call("Page.reload");
    await waitFor("document.readyState === 'complete' && document.body && document.body.dataset.view", "临时空间重载", 15000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(createdWs)})`, "切到临时空间", 12000);
    await metrics(1440, 1000, false);
    await sleep(500);

    /* 看板首屏引导卡（工作项 <3） */
    await nav("#/board", `document.body.dataset.view === "board"`);
    await capture("18-看板首屏引导卡.png", async () => {
      await waitFor(`!!document.querySelector(".guide-card")`, "看板引导卡", 12000);
    }, { fullPage: false });

    /* 我的工作首屏引导卡 */
    await nav("#/mine", `document.body.dataset.view === "mine"`);
    await capture("19-我的工作引导卡.png", async () => {
      await waitFor(`!!document.querySelector("#view-mine .guide-card, .guide-card")`, "我的工作引导卡", 12000);
    }, { fullPage: false });

    /* 空版本引导卡：临时项目 + 计划中版本（0 工作项） */
    const proj = await api("post", "/api/reqs", { name: "原型临时项目" + tag, template: "blank", status: "active", description: "", setId: "" });
    const projId = proj && proj.id;
    if(projId){
      const ver = await api("post", "/api/versions", { reqId: projId, name: "V0.1 计划中", status: "planned", description: null, startDate: null, targetDate: null, revision: null });
      const verId = ver && ver.id;
      if(verId){
        await nav("#/version?id=" + verId, `document.body.dataset.view === "version"`);
        await capture("20-空版本引导卡-计划中主按钮.png", async () => {
          await waitFor(`!!document.querySelector(".vd-empty-guide, .guide-card")`, "空版本引导卡", 12000);
          const info = await evaluate(`(() => {
            const g = document.querySelector(".vd-empty-guide");
            const prim = g ? [...g.querySelectorAll(".btn.primary")].map(b=>b.textContent.trim()) : [];
            return { hasGuide: !!g, prim };
          })()`);
          if(!info.hasGuide) throw new Error("空版本未折叠为引导卡");
        }, { fullPage: false });
      } else log(false, "20-空版本引导卡", "版本创建失败");
    } else log(false, "20-空版本引导卡", "临时项目创建失败");
  }catch(e){ log(false, "临时空间引导卡采集", e.message); }

  /* ---------- 清理：删临时空间、切回演示空间 ----------
     注意：捕获 20 建的「计划中版本」会写入 version_log 行，而后端空间删除守卫
     assertWorkspaceCanBeRebuilt 检查 version_log，版本删除本身又不清 version_log，
     故含版本的临时空间无法经 API 删除。纯工作项的临时空间（捕获 18）可正常 API 删除，
     见 tools/shots/shot-board-guide.mjs。若本段删空间失败，用 MySQL 按 workspace_id
     外科式删除该临时空间各行（仅名字以「原型临时」开头的空间），切勿碰演示空间。 */
  console.log("  [清理] 删除临时空间并切回演示空间…");
  try{
    await api("post", `/api/workspaces/${DEMO_WS}/select`, {});
    await sleep(400);
    if(createdWs) await api("delete", `/api/workspaces/${createdWs}`);
    createdWs = null;
    log(true, "临时空间已删除、已切回 " + DEMO_WS);
  }catch(e){ log(false, "临时空间清理（含版本的临时空间需按上方注释走 MySQL 清理）", e.message); }

  /* ---------- 控制台错误 ---------- */
  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load|marked|DOMPurify|404/i.test(e || ""));
  log(realErrors.length === 0, "无应用源控制台错误", realErrors.slice(0, 4).join(" | ") || "(仅资源/探针类提示)");

  cdp.errors.length = 0;
  try{ cdp.ws.close(); }catch(e){}
}

main().then(() => {
  console.log(`\n采集完成：${ok} 张成功 / ${bad} 张失败`);
  console.log("产出目录：" + OUT);
  shots.forEach(s => console.log("  - " + s));
}).catch(e => {
  console.error("SCRIPT ERROR:", e.message);
  bad++;
}).finally(() => {
  /* 兜底：若临时空间没删掉，这里再尝试一次（忽略失败） */
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
  process.exit(bad ? 1 : 0);
});
