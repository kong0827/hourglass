/* 阶段工时走查：项目驾驶舱 / 版本列表 / 版本详情 / 跨版本 / 明细抽屉，1440 + 390。
   只读：不写业务数据；抽屉与弹层打开即关。

   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=... \
       node tools/e2e/stage-hours.mjs
   需要本机 Chrome / Chromium，也可用 CHROME_BIN 指定路径。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-stage-"));

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

function assert(cond, msg){ if(!cond) throw new Error(msg); }

async function main(){
  fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-stage-"));
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
    assert(port, "读取 DevToolsActivePort 失败");

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
    const shot = async (name, viewportOnly) => {
      /* captureBeyondViewport 会把 fixed 弹层按文档坐标重绘；390 下钻抽屉要用视口截图 */
      const params = { format: "png" };
      if(!viewportOnly) params.captureBeyondViewport = true;
      const res = await call("Page.captureScreenshot", params);
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    const size = async (width, height, mobile) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
      await sleep(450);
    };
    /* 基线：本地库/未跟踪的发布准备 mapper 与本轮无关，接口在本地 404/500 不算回归 */
const BASELINE_FAIL = /\/api\/(branches\/options|branches\/board|repos|my-work\/counts)/;
    const noExceptions = label => {
      const bad = cdp.takeExceptions().filter(e => !BASELINE_FAIL.test(JSON.stringify(e)));
      assert(!bad.length, label + " 出现脚本异常：" + JSON.stringify(bad.slice(0, 2)));
    };
    const overflow = async (selector, label) => {
      const r = await evaluate(`(() => {
        const view = document.querySelector(${JSON.stringify(selector)});
        if(!view) return null;
        const doc = document.documentElement;
        const wide = [...view.querySelectorAll("*")].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && (b.right > doc.clientWidth + 1 || b.left < -1);
        }).slice(0, 4).map(el => el.className || el.tagName);
        return { scrollW: view.scrollWidth, clientW: view.clientWidth, wide };
      })()`);
      assert(r, label + " 找不到容器 " + selector);
      assert(r.scrollW <= r.clientW + 1, `${label} 横向溢出：${r.scrollW} > ${r.clientW}（${r.wide.join(" | ")}）`);
      return r;
    };
    const closeDrill = async () => {
      await evaluate(`document.querySelector(".stage-drill.open [data-drill-close]").click()`);
      await waitFor(`!document.querySelector(".stage-drill.open")`, "抽屉关闭");
    };
    /* 截图只截视口：先把目标滚进中间，避免拍到页面顶部 */
    /* 把元素顶端落到视口某一行：滚动的是 .view 容器，不是 window；用于避开吸顶页签 */
    const scrollTopAt = async (selector, y) => {
      const ok = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if(!el) return false;
        let p = el.parentElement, sc = null;
        while(p){
          const s = getComputedStyle(p);
          if(/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 2){ sc = p; break; }
          p = p.parentElement;
        }
        const target = sc || document.scrollingElement;
        const top = el.getBoundingClientRect().top - target.getBoundingClientRect().top + target.scrollTop - ${Number(y) || 0};
        target.scrollTop = Math.max(0, top);
        return true;
      })()`);
      assert(ok, "截图定位找不到：" + selector);
      await sleep(400);
    };
    const scrollToSel = async (selector, shift) => {
      const ok = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if(!el) return false;
        el.scrollIntoView({ block:"center" });
        if(${Number(shift) || 0}) window.scrollBy(0, ${Number(shift) || 0});
        return true;
      })()`);
      assert(ok, "截图滚动找不到：" + selector);
      await sleep(400);
    };
    const verdict = (() => {
      const map = { good: "PASS", warn: "WARN", bad: "FAIL" };
      return msg => console.log("  PASS " + msg);
    })();
    /* 390 阶段表必须收进容器：固定列宽后不能再靠横向滚动看占比 */
    const stageTblFit = async (scope, label) => {
      const list = await evaluate(`[...document.querySelectorAll(${JSON.stringify(scope)} + " .stage-tbl")].map(t => {
        const wrap = t.closest(".tbl-wrap") || t.parentElement;
        return { w: Math.round(t.getBoundingClientRect().width), scrollW: t.scrollWidth, wrapW: wrap.clientWidth };
      })`);
      assert(list.length, label + " 找不到阶段表");
      list.forEach(x => assert(x.w <= x.wrapW + 1 && x.scrollW <= x.wrapW + 1, label + " 阶段表溢出：" + JSON.stringify(x)));
      return list[0];
    };

    console.log("阶段工时走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

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
    verdict("登录 " + USER);

    /* 2. 选一个工作项最多的项目，打开驾驶舱；版本相关再挑一个真有版本的项目 */
    await size(1440, 1000, false);
    const picked = await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      const { API } = await import("./js/core/api.js");
      let best = null, withVer = null;
      for(const p of (rt.reqList || []).slice(0, 12)){
        try{
          const d = await API.get("/api/manager/projects/" + encodeURIComponent(p.id));
          const n = (d.tasks || []).length;
          if(!best || n > best.n) best = { id:p.id, name:p.name, n:n };
          if(n){
            let vs = [];
            try{ vs = await API.get("/api/versions", { reqId:p.id }); }catch(e){ vs = []; }
            if((vs || []).length){
              const v = { id:p.id, name:p.name, n:n, versions:vs.length };
              if(!withVer || n > withVer.n) withVer = v;
            }
          }
        }catch(e){ /* 无权限或已归档 */ }
      }
      if(!best || !best.n) return null;
      rt.managerProjectId = best.id;
      return { project:best, versionProject:withVer || best };
    })()`);
    assert(picked, "没有带工作项的项目，无法走查项目驾驶舱");
    const project = picked.project, versionProject = picked.versionProject;
    await evaluate(`(() => { location.hash = "#/project"; return true; })()`);
    await waitFor(`document.body.dataset.view === "project" && !!document.getElementById("projectBody")`, "项目页");
    await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      rt.managerProjectId = ${JSON.stringify(project.id)};
      const m = await import("./js/views/project.js");
      m.loadProject();
      return true;
    })()`);
    await waitFor(`document.body.dataset.view === "project" && !!document.querySelector("#projectStagePanel [data-stage-panel]")`, "项目阶段面板", 25000);
    await waitFor(`document.querySelectorAll("#projectStagePanel .stage-card").length === 3`, "三张阶段卡", 15000);
    verdict(`项目 ${project.name}（${project.n} 个工作项）`);

    const projProbe = await evaluate(`(() => {
      const box = document.querySelector("#projectStagePanel");
      const cards = [...box.querySelectorAll(".stage-card")].map(c => ({
        key: c.getAttribute("data-stage-drill"),
        v: (c.querySelector(".stage-v") || { textContent: "" }).textContent.trim(),
        meta: (c.querySelector(".stage-meta") || { textContent: "" }).textContent.trim(),
        items: (c.querySelector(".stage-items") || { textContent: "" }).textContent.trim()
      }));
      const bar = box.querySelector(".stage-bar");
      const segs = bar ? [...bar.querySelectorAll("i")].map(i => i.style.width) : [];
      const legend = [...box.querySelectorAll(".stage-legend button")].map(b => b.textContent.replace(/\\s+/g, " ").trim());
      const rows = [...box.querySelectorAll(".stage-tbl tbody tr")].map(tr => ({
        drill: tr.getAttribute("data-stage-drill"),
        cells: [...tr.querySelectorAll("td")].map(td => td.textContent.replace(/\\s+/g, " ").trim())
      }));
      const head = [...box.querySelectorAll(".stage-tbl thead th")].map(th => th.textContent.trim());
      return {
        cards, segs, legend, rows, head,
        sub: (box.querySelector(".stage-head-l span") || { textContent: "" }).textContent.trim(),
        toggle: [...box.querySelectorAll("[data-stage-mode]")].map(b => ({
          m: b.getAttribute("data-stage-mode"), on: b.getAttribute("aria-pressed") === "true"
        })),
        zeroNote: !!(box.querySelector(".stage-empty")),
        foot: (box.querySelector(".stage-foot") || { textContent: "" }).textContent.replace(/\\s+/g, " ").trim()
      };
    })()`);
    assert(projProbe.cards.length === 3, "阶段卡不是 3 张：" + JSON.stringify(projProbe.cards));
    assert(projProbe.segs.length >= 1 && projProbe.segs.length <= 3, "阶段条段数异常：" + JSON.stringify(projProbe.segs));
    assert(projProbe.legend.length === 3, "图例不是三段：" + JSON.stringify(projProbe.legend));
    assert(projProbe.head.join("|") === "阶段|条目|预估|实际|实际占比|偏差|明细", "表头与规格不一致：" + projProbe.head.join("|"));
    assert(projProbe.rows.length === 4, "表应为三阶段 + 合计：" + projProbe.rows.length);
    assert(projProbe.rows[3].cells[0].indexOf("合计") >= 0, "合计行缺失：" + JSON.stringify(projProbe.rows[3]));
    assert(projProbe.toggle.length === 2 && projProbe.toggle[0].on, "实际 / 预估切换缺失或默认不是实际");
    assert(projProbe.sub.indexOf("项有计时") > 0, "副标题缺少计时项数：" + projProbe.sub);
    verdict(`阶段卡 ${projProbe.cards.map(c => c.key + "=" + c.v).join("，")}；条 ${projProbe.segs.join("/")}`);

    /* 2.1 预估口径切换：语义、数值都跟手 */
    await evaluate(`document.querySelector('#projectStagePanel [data-stage-mode="estimate"]').click()`);
    await waitFor(`document.querySelector('#projectStagePanel [data-stage-mode="estimate"]').getAttribute("aria-pressed") === "true"`, "切到预估");
    const estProbe = await evaluate(`(() => {
      const box = document.querySelector("#projectStagePanel");
      return {
        cards: [...box.querySelectorAll(".stage-card")].map(c => (c.querySelector(".stage-meta") || {}).textContent.trim()),
        legend: [...box.querySelectorAll(".stage-legend button")].map(b => b.textContent.replace(/\\s+/g, " ").trim())
      };
    })()`);
    assert(estProbe.cards.every(t => t.indexOf("实际 ") === 0), "预估卡应显示对应实际值：" + JSON.stringify(estProbe.cards));
    verdict("预估口径切换正常");
    await evaluate(`document.querySelector('#projectStagePanel [data-stage-mode="actual"]').click()`);
    await waitFor(`document.querySelector('#projectStagePanel [data-stage-mode="actual"]').getAttribute("aria-pressed") === "true"`, "切回实际");
    await scrollToSel("#projectStagePanel .stage-grid");
    await shot("01-项目阶段-1440");

    /* 2.2 卡片下钻：900px 抽屉、阶段筛选、搜索、空态 */
    const drillKey = projProbe.cards.find(c => c.v !== "—" && c.v !== "0h").key;
    await evaluate(`document.querySelector('#projectStagePanel .stage-card[data-stage-drill="${drillKey}"]').click()`);
    await waitFor(`!!document.querySelector(".stage-drill.open")`, "项目下钻抽屉", 15000);
    const drawer = await evaluate(`(() => {
      const layer = document.querySelector(".stage-drill.open");
      const sheet = layer.querySelector(".sheet").getBoundingClientRect();
      return {
        width: Math.round(sheet.width),
        title: layer.querySelector("h2").textContent.trim(),
        sub: layer.querySelector("[data-drill-sub]").textContent.trim(),
        stageChip: !!layer.querySelector("[data-drill-clear-stage]"),
        search: !!layer.querySelector("[data-drill-search]"),
        rows: layer.querySelectorAll("tr[data-drill-task]").length,
        head: [...layer.querySelectorAll(".drill-tbl thead th")].map(th => th.textContent.trim()),
        foot: layer.querySelector("[data-drill-foot]").textContent.replace(/\\s+/g, " ").trim()
      };
    })()`);
    assert(drawer.width > 700 && drawer.width <= 901, "桌面抽屉宽度应为 900px：" + drawer.width);
    assert(drawer.stageChip, "抽屉缺少当前阶段筛选 chip");
    assert(drawer.search, "抽屉缺少搜索框");
    assert(drawer.rows > 0, "抽屉没有明细行");
    assert(drawer.head.join("|") === "工作项|类型|分类|负责人|阶段工时|总实际", "抽屉表头不一致：" + drawer.head.join("|"));
    const drawerWide = await evaluate(`(() => {
      const w = document.querySelector(".stage-drill.open .drill-table-wrap");
      return w ? { scrollW: w.scrollWidth, clientW: w.clientWidth } : null;
    })()`);
    assert(drawerWide && drawerWide.scrollW <= drawerWide.clientW + 1, "抽屉表格横向溢出：" + JSON.stringify(drawerWide));
    verdict(`下钻 ${drillKey}：${drawer.rows} 行，宽 ${drawer.width}px`);
    await shot("01b-阶段下钻-1440");

    /* 搜索：用第一行标题里的两字片段，命中数应减少且不报错 */
    const q = await evaluate(`(() => {
      const title = document.querySelector(".stage-drill.open tr[data-drill-task] .drill-title b").textContent.trim();
      return title.slice(0, 2);
    })()`);
    await evaluate(`(() => {
      const el = document.querySelector(".stage-drill.open [data-drill-search]");
      el.value = ${JSON.stringify(q)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    const searched = await evaluate(`(() => {
      const layer = document.querySelector(".stage-drill.open");
      return layer.querySelectorAll("tr[data-drill-task]").length + layer.querySelectorAll(".drill-card").length;
    })()`);
    assert(searched > 0, "搜索「" + q + "」没有命中任何明细");
    await evaluate(`document.querySelector(".stage-drill.open [data-drill-clear]").click()`);
    await sleep(200);
    verdict("抽屉搜索 / 清除正常");
    await closeDrill();
    await overflow("#view-project", "项目驾驶舱");

    /* 3. 版本列表：页头汇总 + 行内阶段构成 */
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "版本页");
    await evaluate(`(async () => {
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(versionProject.id)}, "version");
      return true;
    })()`);
    await waitFor(`document.querySelectorAll("#verList .vl-row[data-ver-row]").length > 0`, "版本列表", 25000);
    const listProbe = await evaluate(`(() => {
      const box = document.getElementById("verList");
      const sum = box.querySelector("[data-ver-stage] [data-stage-panel]");
      const rows = [...box.querySelectorAll(".vl-row[data-ver-row]")];
      const withSeg = rows.filter(r => r.querySelector(".vstage-seg")).length;
      const empty = rows.filter(r => r.querySelector(".vstage-bar.empty")).length;
      const head = box.querySelector(".vl-stage-head");
      return {
        sum: !!sum,
        sumCards: sum ? sum.querySelectorAll(".stage-card").length : 0,
        sumTable: sum ? !!sum.querySelector(".stage-tbl") : false,
        sumToggle: sum ? !!sum.querySelector("[data-stage-mode]") : false,
        sumSub: sum ? sum.querySelector(".stage-head-l span").textContent.trim() : "",
        rows: rows.length, withSeg, empty,
        headText: head ? head.textContent.trim() : "",
        headVisible: !!(head && head.offsetParent)
      };
    })()`);
    assert(listProbe.sum, "版本列表缺少阶段汇总");
    assert(listProbe.sumCards === 3, "汇总不是三张卡：" + listProbe.sumCards);
    assert(!listProbe.sumTable && !listProbe.sumToggle, "列表汇总不应带表与口径切换");
    assert(listProbe.withSeg > 0, "没有一行有阶段构成色块");
    assert(listProbe.headText.indexOf("阶段构成") >= 0 && listProbe.headVisible, "阶段构成列头缺失：" + listProbe.headText);
    verdict(`版本列表 ${listProbe.rows} 行，${listProbe.withSeg} 行有色块，${listProbe.empty} 行未计时`);
    await scrollToSel("#verList [data-ver-stage]");
    await shot("02-版本列表-1440");

    /* 行内色块下钻：带版本范围，只含该版本工作项 */
    const segVer = await evaluate(`(() => {
      const row = [...document.querySelectorAll("#verList .vl-row[data-ver-row]")].find(r => r.querySelector(".vstage-seg"));
      const id = row.getAttribute("data-ver-row");
      row.querySelector(".vstage-seg").click();
      return id;
    })()`);
    await waitFor(`!!document.querySelector(".stage-drill.open")`, "版本行下钻", 15000);
    const rowDrawer = await evaluate(`(() => {
      const l = document.querySelector(".stage-drill.open");
      return {
        sub: l.querySelector("[data-drill-sub]").textContent.trim(),
        rows: l.querySelectorAll("tr[data-drill-task]").length
      };
    })()`);
    assert(rowDrawer.sub.indexOf("版本 · ") === 0, "行下钻范围不是版本：" + rowDrawer.sub);
    assert(rowDrawer.rows > 0, "版本行下钻没有明细");
    verdict(`行下钻 ${segVer}：${rowDrawer.rows} 行`);
    await closeDrill();
    await overflow("#view-phase", "版本列表");

    /* 3.1 390：行内换成 44px chip，色条与文字隐藏 */
    await size(390, 844, true);
    const list390 = await evaluate(`(() => {
      const row = [...document.querySelectorAll("#verList .vl-row[data-ver-row]")].find(r => r.querySelector(".vstage-chips"));
      if(!row) return null;
      const chips = [...row.querySelectorAll(".vchip")].map(c => {
        const b = c.getBoundingClientRect();
        return { text: c.textContent.replace(/\\s+/g, " ").trim(), h: Math.round(b.height), w: Math.round(b.width), visible: !!c.offsetParent };
      });
      const bar = row.querySelector(".vstage-bar");
      const txt = row.querySelector(".vstage-txt");
      return {
        chips,
        barVisible: !!(bar && bar.offsetParent),
        txtVisible: !!(txt && txt.offsetParent)
      };
    })()`);
    assert(list390 && list390.chips.length === 3, "390 行内应有三个阶段 chip");
    assert(list390.chips.every(c => c.visible && c.h >= 44), "390 chip 触控高度不足：" + JSON.stringify(list390.chips));
    assert(!list390.barVisible && !list390.txtVisible, "390 仍显示色条或文字：" + JSON.stringify(list390));
    verdict("390 版本行：三段 chip，44px");
    await scrollToSel("#verList [data-ver-stage]", -120);
    await shot("03a-版本列表-汇总-390");
    await scrollToSel("#verList .vl-row[data-ver-row]");
    await shot("03-版本列表-390");
    await overflow("#view-phase", "版本列表 390");
    await size(1440, 1000, false);

    /* 4. 版本详情：内联面板在工时卡之后；工时弹层不再重复阶段卡 */
    const main = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/cross-project");
      const mine = (rows || []).filter(r => r.reqId === ${JSON.stringify(project.id)});
      const sorted = (mine.length ? mine : rows || []).slice().sort((a, b) => (b.taskCount || 0) - (a.taskCount || 0));
      return sorted[0] || null;
    })()`);
    assert(main && main.versionId, "找不到可走查的版本");
    await navigate(BASE + "/index.html#/version?id=" + encodeURIComponent(main.versionId) + "&reqId=" + encodeURIComponent(main.reqId) + "&tab=overview");
    await waitFor(`document.body.dataset.view === "version"`, "版本详情");
    await waitFor(`!!document.querySelector("#versionBody [data-vd-stage-wrap] [data-stage-panel]")`, "内联阶段面板", 25000);
    const detailProbe = await evaluate(`(() => {
      const card = document.querySelector("#versionBody .vd-hours-card");
      const wrap = document.querySelector("#versionBody [data-vd-stage-wrap]");
      const panel = wrap.querySelector("[data-stage-panel]");
      const after = card && card.nextElementSibling === wrap;
      return {
        afterHours: after,
        cards: panel.querySelectorAll(".stage-card").length,
        table: !!panel.querySelector(".stage-tbl"),
        badge: (panel.querySelector(".tag") || { textContent: "" }).textContent.trim(),
        sub: panel.querySelector(".stage-head-l span").textContent.trim(),
        order: [...document.querySelector(".vd-body").children].map(el => el.className || el.id)
      };
    })()`);
    assert(detailProbe.afterHours, "阶段面板没有紧跟工时卡：" + JSON.stringify(detailProbe.order.slice(0, 5)));
    assert(detailProbe.cards === 3 && detailProbe.table, "详情内联面板结构不完整");
    assert(detailProbe.badge === "本版本", "详情面板范围标记不是「本版本」：" + detailProbe.badge);
    verdict(`版本 ${main.versionName}：内联面板 ${detailProbe.sub}`);
    await scrollToSel("#versionBody [data-vd-stage-wrap] .stage-grid");
    await shot("04-版本详情-1440");

    /* 4.1 工时弹层：类型页只保留一行跳转，不再自带阶段卡 */
    await evaluate(`document.querySelector('#versionBody [data-vd-hours="actual"]').click()`);
    await waitFor(`!!document.querySelector(".vd-h-layer.open")`, "工时构成弹层", 15000);
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-htab="type"]').click()`);
    await waitFor(`!!document.querySelector('.vd-h-layer.open [data-vd-hbody] .vd-h-stage-jump')`, "类型页跳转行", 10000);
    const modalProbe = await evaluate(`(() => {
      const l = document.querySelector(".vd-h-layer.open");
      return {
        proxyCards: l.querySelectorAll(".vd-h-proxy-card").length,
        jump: !!l.querySelector("[data-vd-goto-stage]"),
        notice: (l.querySelector(".vd-h-notice") || { textContent: "" }).textContent.replace(/\\s+/g, " ").trim()
      };
    })()`);
    assert(modalProbe.proxyCards === 0, "工时弹层仍重复渲染阶段卡：" + modalProbe.proxyCards);
    assert(modalProbe.jump, "工时弹层缺少「去阶段投入」");
    assert(modalProbe.notice.indexOf("不是阶段") >= 0, "类型页说明未区分类型与阶段：" + modalProbe.notice);
    await evaluate(`document.querySelector(".vd-h-layer.open [data-vd-goto-stage]").click()`);
    await waitFor(`!document.querySelector(".vd-h-layer.open")`, "弹层关闭");
    const focusProbe = await evaluate(`(() => {
      const a = document.activeElement;
      return { inPanel: !!(a && a.closest("[data-vd-stage-wrap]")), tag: a && a.tagName };
    })()`);
    assert(focusProbe.inPanel, "跳转后焦点没有落在阶段面板：" + JSON.stringify(focusProbe));
    verdict("工时弹层收敛为跳转，焦点回面板");
    await overflow("#view-version", "版本详情");

    /* 5. 跨版本：三段列替换窗口内外（首版 / 迭代分析里的阶段汇总，切到「全部版本」） */
    await navigate(BASE + "/index.html#/phase?pmode=phase");
    await waitFor(`document.body.dataset.view === "phase"`, "首版 / 迭代分析");
    await evaluate(`(async () => {
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(versionProject.id)}, "phase");
      return true;
    })()`);
    await waitFor(`!!document.querySelector("#view-phase [data-rollup] [data-rollup-ver]")`, "阶段工时汇总", 25000);
    await evaluate(`(() => {
      const s = document.querySelector("#view-phase [data-rollup] [data-rollup-ver]");
      s.value = "__all";
      s.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitFor(`!!document.querySelector("#view-phase .cross-table")`, "跨版本表", 25000);
    const crossProbe = await evaluate(`(() => {
      const table = document.querySelector("#view-phase .cross-table");
      const head = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
      const rows = table.querySelectorAll("tbody tr").length;
      const drill = [...table.querySelectorAll(".cell-drill")].filter(b => b.textContent.trim() !== "—").length;
      const zero = [...table.querySelectorAll(".cell-drill.zero")].length;
      return { head, rows, drill, zero };
    })()`);
    assert(crossProbe.head.join("|") === "版本|状态|工作项|预估|实际|产品 / 设计|开发|测试|偏差", "跨版本表头不一致：" + crossProbe.head.join("|"));
    assert(crossProbe.head.indexOf("窗口外") === -1 && crossProbe.head.indexOf("窗口内") === -1, "跨版本仍显示窗口内外列");
    assert(crossProbe.rows > 0, "跨版本没有行");
    verdict(`跨版本 ${crossProbe.rows} 行，${crossProbe.drill} 个可下钻单元格`);
    if(crossProbe.drill){
      await evaluate(`([...document.querySelectorAll("#view-phase .cross-table .cell-drill")].find(b => b.textContent.trim() !== "—")).click()`);
      await waitFor(`!!document.querySelector(".stage-drill.open")`, "跨版本下钻", 15000);
      const crossDrawer = await evaluate(`(() => {
        const l = document.querySelector(".stage-drill.open");
        return { sub: l.querySelector("[data-drill-sub]").textContent.trim(), rows: l.querySelectorAll("tr[data-drill-task]").length };
      })()`);
      assert(crossDrawer.rows > 0, "跨版本下钻没有明细");
      verdict(`跨版本下钻：${crossDrawer.sub}`);
      await closeDrill();
    }
    await scrollToSel("#view-phase .cross-table");
    await shot("05-跨版本-1440");
    await overflow("#view-phase", "跨版本");

    /* 5.1 390：表收起、卡片出现、抽屉全屏 */
    await size(390, 844, true);
    const cross390 = await evaluate(`(() => {
      const table = document.querySelector("#view-phase .cross-table");
      const cards = document.querySelector("#view-phase .cross-cards");
      const card = cards && cards.querySelector(".cross-card");
      return {
        tableVisible: !!(table && table.offsetParent),
        cardsVisible: !!(cards && cards.offsetParent),
        stages: card ? card.querySelectorAll(".cc-stage").length : 0,
        cardW: card ? Math.round(card.getBoundingClientRect().width) : 0
      };
    })()`);
    assert(!cross390.tableVisible && cross390.cardsVisible, "390 跨版本没有切换成卡片：" + JSON.stringify(cross390));
    assert(cross390.stages === 3, "390 卡片阶段按钮不是 3 个");
    await scrollToSel("#view-phase .cross-cards .cross-card");
    await shot("06-跨版本-390");
    const tapped = await evaluate(`(() => {
      const b = [...document.querySelectorAll("#view-phase .cross-card .cc-stage")].find(x => !x.disabled);
      if(!b) return false;
      b.click();
      return true;
    })()`);
    if(tapped){
      await waitFor(`!!document.querySelector(".stage-drill.open")`, "390 下钻", 15000);
      const w = await evaluate(`Math.round(document.querySelector(".stage-drill.open .sheet").getBoundingClientRect().width)`);
      assert(w >= 389, "390 抽屉没有全屏：" + w);
      await sleep(500); /* 等滑入动画结束 */
      await shot("07-下钻-390", true);
      verdict("390 抽屉全屏");
      await closeDrill();
    }
    await overflow("#view-phase", "跨版本 390");

    /* 5.2 390 项目与详情 */
    await navigate(BASE + "/index.html#/project");
    await waitFor(`document.body.dataset.view === "project"`, "项目页");
    await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      rt.managerProjectId = ${JSON.stringify(project.id)};
      const m = await import("./js/views/project.js");
      m.loadProject();
      return true;
    })()`);
    await waitFor(`!!document.querySelector("#projectStagePanel [data-stage-panel]")`, "390 项目面板", 25000);
    const proj390 = await evaluate(`(() => {
      const grid = document.querySelector("#projectStagePanel .stage-grid");
      const cards = [...grid.querySelectorAll(".stage-card")];
      const rows = new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)));
      return { cols: getComputedStyle(grid).gridTemplateColumns, cardRows: rows.size, cards: cards.length };
    })()`);
    assert(proj390.cards === 3 && proj390.cardRows === 3, "390 阶段卡没有单列堆叠：" + JSON.stringify(proj390));
    await scrollToSel("#projectStagePanel .stage-grid");
    await shot("08-项目阶段-390");
    await scrollToSel("#projectStagePanel .stage-tbl");
    await shot("08b-项目阶段-表格-390");
    await stageTblFit("#view-project", "项目 390");
    await overflow("#view-project", "项目 390");

    await navigate(BASE + "/index.html#/version?id=" + encodeURIComponent(main.versionId) + "&reqId=" + encodeURIComponent(main.reqId) + "&tab=overview");
    await waitFor(`document.body.dataset.view === "version"`, "版本详情 390");
    await waitFor(`!!document.querySelector("#versionBody [data-vd-stage-wrap] [data-stage-panel]")`, "390 详情面板", 25000);
    /* 详情页 .vd-head 整块吸顶约 390px，截图目标要落在吸顶之下 */
    await scrollTopAt("#versionBody [data-vd-stage-wrap]", 415);
    await shot("09-版本详情-390");
    await scrollTopAt("#versionBody [data-vd-stage-wrap] .stage-tbl", 415);
    await shot("09b-版本详情-表格-390");
    await stageTblFit("#view-version", "版本详情 390");
    await overflow("#view-version", "版本详情 390");

    noExceptions("收尾");
    console.log("\n结果：全部通过\n截图目录：" + SHOTS);
  }finally{
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    child.kill();
  }
}

main().catch(err => { console.error("\n失败：" + err.message); process.exit(1); });
