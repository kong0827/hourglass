/* 版本详情页（#/version）浏览器走查：入口跳转、五个页签、深链、后退、弹窗复用与三尺寸布局。
   只读走查：不写业务数据，弹窗打开即关；截图落到 E2E_SHOT_DIR（默认临时目录）。

   用法：
     E2E_BASE=http://127.0.0.1:8082/hourglass E2E_USER=admin E2E_PASS=... \
       node tools/e2e/version-detail.mjs
   需要本机 Chrome / Chromium，也可用 CHROME_BIN 指定。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-version-"));

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-vd-"));
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
    /* 只改 hash 的 Page.navigate 是同文档跳转，不会重跑 main.js；
       分享出去的链接是在新标签页冷启动的，必须真整页重载才算验过 */
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
    const size = async (width, height, mobile) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
      await sleep(450);
    };
    /* 演示库缺 project_repo / 分支看板数据导致的 500（2026-11-15 08:39 前已存在），与本页无关 */
    const BASELINE_FAIL = /\/api\/(branches\/options|branches\/board|repos)/;
    const noExceptions = label => {
      const bad = cdp.takeExceptions().filter(e => !BASELINE_FAIL.test(JSON.stringify(e)));
      assert(!bad.length, label + " 出现脚本异常：" + JSON.stringify(bad.slice(0, 2)));
    };
    /* 横向溢出、不可达控件与指标格孤行：子页最常见的三类布局缺陷 */
    const layout = async label => {
      const r = await evaluate(`(() => {
        const view = document.getElementById("view-version");
        const doc = document.documentElement;
        const wide = [...view.querySelectorAll("*")].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && (b.right > doc.clientWidth + 1 || b.left < -1);
        }).slice(0, 4).map(el => el.className || el.tagName);
        const tabs = [...view.querySelectorAll(".vd-tabs [data-vd-tab]")].map(b => {
          const r = b.getBoundingClientRect();
          return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const rows = new Map();
        let kpiWrapped = 0;
        [...view.querySelectorAll(".vd-kpis .pcell")].forEach(c => {
          const top = Math.round(c.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) || 0) + 1);
          const label = c.querySelector("span");
          const lh = parseFloat(getComputedStyle(label).lineHeight) || 16;
          if(label.offsetHeight > lh * 1.6) kpiWrapped++;
        });
        const acts = [...view.querySelectorAll(".vd-acts .btn")].map(b => {
          const r = b.getBoundingClientRect();
          return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
        });
        return { scrollW: view.scrollWidth, clientW: view.clientWidth, wide, tabs, kpiRows: [...rows.values()], kpiWrapped, acts };
      })()`);
      assert(r.scrollW <= r.clientW + 1, `${label} 详情页横向溢出：${r.scrollW} > ${r.clientW}（${r.wide.join(" | ")}）`);
      assert(r.tabs.length === 5 && r.tabs.every(t => t.w > 0 && t.h >= 28), `${label} 页签尺寸异常：${JSON.stringify(r.tabs)}`);
      assert(r.kpiRows.every(n => n === r.kpiRows[0]), `${label} 指标格排布不齐（末行孤格）：${JSON.stringify(r.kpiRows)}`);
      assert(!r.kpiWrapped, `${label} 指标格标签折行：${r.kpiWrapped} 个`);
      assert(r.acts.every(b => b.w > 0 && b.h >= 28), `${label} 操作按钮尺寸异常：${JSON.stringify(r.acts)}`);
      return r;
    };
    const pass = msg => console.log("  PASS " + msg);

    console.log("版本详情页走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

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

    /* 2. 挑一个内容最全的版本作为主用例，另挑一个已发布版本验证交付事实 */
    const pick = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/cross-project");
      const sorted = (rows || []).slice().sort((a, b) => (b.taskCount || 0) - (a.taskCount || 0));
      return {
        main: sorted[0],
        released: sorted.find(r => r.reqId === sorted[0].reqId && r.latestReleaseDate) || sorted.find(r => r.latestReleaseDate) || null,
        total: sorted.length
      };
    })()`);
    assert(pick && pick.main && pick.main.versionId, "跨项目版本清单为空，无法走查");
    const main = pick.main;
    pass(`选定版本 ${main.projectName} / ${main.versionName}（工作项 ${main.taskCount} 项，共 ${pick.total} 个版本）`);

    /* 3. 版本卡：版本名与「版本详情」按钮都能跳转 */
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "版本页");
    await evaluate(`(async () => {
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(main.reqId)}, "version");
      return true;
    })()`);
    await waitFor(`document.querySelectorAll("#phaseBody .vl-row").length > 0`, "版本列表");
    const cardEntry = await evaluate(`(() => {
      const row = document.querySelector('#phaseBody .vl-row[data-ver-row="${main.versionId}"]');
      const nameBtn = row && row.querySelector('.vl-name-link[data-ver-open="${main.versionId}"]');
      const actBtn = row && [...row.querySelectorAll('.vl-acts button')]
        .find(b => b.hasAttribute("data-ver-open") || b.hasAttribute("data-ver-open-tab")
          || b.hasAttribute("data-ver-release") || b.hasAttribute("data-ver-menu"));
      return { name: !!nameBtn, nameText: nameBtn && nameBtn.textContent.trim(), act: !!actBtn, actText: actBtn && actBtn.textContent.trim() };
    })()`);
    assert(cardEntry.name && cardEntry.act, "版本行缺少详情页入口：" + JSON.stringify(cardEntry));
    await shot("01-版本列表入口");

    /* 3.1 列表对齐原型：需关注筛选 / 风险副标题 / 阻塞进度段 / 状态命名 */
    const listModel = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const { parseDate, dayDiff } = await import("./js/lib/format.js");
      const { rt } = await import("./js/core/state.js");
      const [stats, tasks] = await Promise.all([
        API.get("/api/versions/stats", { reqId: ${JSON.stringify(main.reqId)} }),
        API.get("/api/versions/task-options", { reqId: ${JSON.stringify(main.reqId)} })
      ]);
      const ended = v => v.status === "closed" || v.status === "canceled";
      const ids = t => Array.isArray(t.versionIds) ? t.versionIds : [];
      const rows = (stats.versions || []).map(v => {
        const bound = (tasks || []).filter(t => ids(t).indexOf(v.id) >= 0);
        const total = v.taskCount || 0, done = v.doneCount || 0;
        const blocked = bound.filter(t => t.blocked && t.boardColumn !== "done").length;
        const doing = bound.filter(t => t.boardColumn !== "done" && !t.blocked && Number(t.totalMinutes) > 0).length;
        let overdue = 0;
        if(v.status !== "released" && !ended(v) && v.targetDate){
          const d = dayDiff(parseDate(v.targetDate), rt.TODAY);
          if(d !== null && d < 0) overdue = -d;
        }
        const pct = total ? Math.round(done * 100 / total) : 0;
        const doingPct = total ? Math.max(0, Math.min(100 - pct, Math.round(doing * 100 / total))) : 0;
        return {
          id:v.id, status:v.status, total:total, branches:(v.branches || []).length,
          blocked:blocked, overdue:overdue, risk:blocked > 0 || overdue > 0,
          blockedPct:total ? Math.max(0, Math.min(100 - pct - doingPct, Math.round(blocked * 100 / total))) : 0
        };
      });
      return { rows: rows };
    })()`);
    const listUi = await evaluate(`(() => {
      const box = document.getElementById("verList");
      const chips = [...box.querySelectorAll("[data-ver-chips] .vl-chip")].map(c => ({
        text: c.textContent.replace(/\\s+/g, " ").trim(),
        status: c.getAttribute("data-ver-status"),
        risk: c.hasAttribute("data-ver-risk-chip"),
        on: c.classList.contains("on")
      }));
      const rows = [...box.querySelectorAll(".vl-row")].map(r => {
        const sub = r.querySelector(".vl-sub");
        const bar = r.querySelector(".vl-bar");
        return {
          id: r.getAttribute("data-ver-row"),
          sub: sub ? sub.textContent.replace(/\\s+/g, " ").trim() : "",
          risk: !!(sub && sub.querySelector(".vl-risk-inline")),
          blockedSeg: !!(bar && bar.querySelector("i.blocked")),
          statusText: (r.querySelector(".vl-status .tag") || { textContent: "" }).textContent.trim()
        };
      });
      const cb = box.querySelector("[data-ver-risk]");
      return { chips: chips, rows: rows, checkbox: !!cb, checked: !!(cb && cb.checked) };
    })()`);
    const LABELS = { active:"进行中", planned:"计划中", released:"已发布", closed:"已关闭", canceled:"已取消" };
    const chipName = text => text.replace(/\s*\d+$/, "");
    const chipCount = text => Number((text.match(/(\d+)$/) || [])[1] || 0);
    const wantedChips = ["全部", "进行中", "计划中", "已发布", "已关闭"]
      .concat(listModel.rows.some(r => r.status === "canceled") ? ["已取消"] : []);
    assert(listUi.chips.filter(c => !c.risk).map(c => chipName(c.text)).join(",") === wantedChips.join(","),
      "状态筛选命名未对齐原型：" + JSON.stringify(listUi.chips.map(c => c.text)));
    const expectedRisk = listModel.rows.filter(r => r.risk).length;
    const riskChip = listUi.chips.find(c => c.risk);
    assert(riskChip && chipCount(riskChip.text) === expectedRisk, `需关注计数应为 ${expectedRisk}，实际 ${riskChip && riskChip.text}`);
    const byId = {};
    listModel.rows.forEach(r => { byId[r.id] = r; });
    assert(listUi.rows.length === listModel.rows.length,
      `列表行数 ${listUi.rows.length} ≠ 版本数 ${listModel.rows.length}`);
    const badStatus = listUi.rows.filter(r => r.statusText !== LABELS[byId[r.id].status]);
    assert(!badStatus.length, "状态标签未对齐（进行中/计划中/已发布/已关闭/已取消）：" + JSON.stringify(badStatus.map(r => [r.id, r.statusText])));
    const badSub = listUi.rows.filter(r => {
      const e = byId[r.id];
      const base = e.total ? e.total + " 个工作项" : "未规划工作项";
      const branch = e.branches ? e.branches + " 个分支" : "";
      return r.sub.indexOf(base) === -1 || (branch && r.sub.indexOf(branch) === -1)
        || (e.blocked > 0 && r.sub.indexOf(e.blocked + " 个阻塞") === -1)
        || (e.overdue > 0 && r.sub.indexOf("已逾期 " + e.overdue + " 天") === -1);
    });
    assert(!badSub.length, "行副标题未按「工作项 / 分支 / 阻塞」展示：" + JSON.stringify(badSub.map(r => [r.id, r.sub])));
    const badRisk = listUi.rows.filter(r => r.risk !== byId[r.id].risk
      || r.blockedSeg !== (byId[r.id].blockedPct > 0));
    assert(!badRisk.length, "风险提示或阻塞进度段与数据不符：" + JSON.stringify(badRisk.map(r => [r.id, r.risk, r.blockedSeg])));
    pass(`列表状态命名 / 风险副标题 / 阻塞段（需关注 ${expectedRisk} 个，可筛 ${listUi.rows.length} 行）`);
    await evaluate(`document.querySelector("#verList [data-ver-risk-chip]").click()`);
    await sleep(200);
    const riskUi = await evaluate(`(() => {
      const box = document.getElementById("verList");
      const chip = box.querySelector("[data-ver-risk-chip]");
      return {
        rows: [...box.querySelectorAll(".vl-row")].map(r => !!r.querySelector(".vl-sub .vl-risk-inline")),
        on: !!chip && chip.classList.contains("on"),
        checked: !!box.querySelector("[data-ver-risk]").checked,
        empty: !!box.querySelector(".vl-empty")
      };
    })()`);
    assert(riskUi.rows.length === expectedRisk && riskUi.rows.every(Boolean), "需关注筛选结果不符（应为仅风险版本 " + expectedRisk + " 行）");
    assert(riskUi.on && riskUi.checked, "需关注 chip 与「只看需关注」勾选状态不同步");
    await shot("02-版本列表需关注");
    await evaluate(`document.querySelector("#verList [data-ver-risk]").click()`);
    await sleep(200);
    const riskReset = await evaluate(`(() => {
      const box = document.getElementById("verList");
      return { rows: box.querySelectorAll(".vl-row").length, checked: !!box.querySelector("[data-ver-risk]").checked };
    })()`);
    assert(riskReset.rows === listModel.rows.length && !riskReset.checked, "关闭只看需关注后未恢复全部版本");
    pass("需关注筛选与勾选联动，关闭后恢复全部");
    /* 演示库没有阻塞/逾期版本，风险分支用内存探针补验（不写库）：给主版本挂一条阻塞工作项 */
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const orig = API.get;
      window.__e2eOrigApiGet = orig;
      API.get = function(url, params){
        if(String(url).indexOf("/api/versions/task-options") === 0){
          return orig.call(API, url, params).then(function(list){
            return Array.isArray(list) ? list.concat([{
              id:"E2E-BLOCK-PROBE", title:"E2E 阻塞探针", reqId:${JSON.stringify(main.reqId)},
              boardColumn:"doing", totalMinutes:60, blocked:true,
              versionIds:[${JSON.stringify(main.versionId)}]
            }]) : list;
          });
        }
        return orig.call(API, url, params);
      };
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(main.reqId)}, "version");
      return true;
    })()`);
    await sleep(600);
    const probeUi = await evaluate(`(() => {
      const box = document.getElementById("verList");
      const row = box.querySelector('.vl-row[data-ver-row="${main.versionId}"]');
      const chip = box.querySelector("[data-ver-risk-chip]");
      return {
        riskChip: chip ? chip.textContent.replace(/\\s+/g, " ").trim() : "",
        risk: !!(row && row.querySelector(".vl-sub .vl-risk-inline")),
        riskText: row && row.querySelector(".vl-sub .vl-risk-inline") ? row.querySelector(".vl-sub .vl-risk-inline").textContent.trim() : "",
        blockedSeg: !!(row && row.querySelector(".vl-bar i.blocked"))
      };
    })()`);
    assert(probeUi.risk && probeUi.riskText.indexOf("1 个阻塞") === 0 && probeUi.blockedSeg,
      "模拟阻塞任务未渲染风险提示或阻塞进度段：" + JSON.stringify(probeUi));
    assert(chipCount(probeUi.riskChip) === expectedRisk + 1, "需关注计数未包含阻塞探针：" + probeUi.riskChip);
    await evaluate(`document.querySelector("#verList [data-ver-risk-chip]").click()`);
    await sleep(200);
    const probeRows = await evaluate(`document.querySelectorAll("#verList .vl-row").length`);
    assert(probeRows === expectedRisk + 1, `需关注筛选未包含阻塞探针（${probeRows} 行）`);
    await shot("03-版本列表阻塞探针");
    pass("阻塞工作项 → 风险副标题 + 红色进度段 + 需关注计数（内存探针）");
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      if(window.__e2eOrigApiGet){ API.get = window.__e2eOrigApiGet; delete window.__e2eOrigApiGet; }
      document.querySelector("#verList [data-ver-risk]").click();
      const m = await import("./js/views/phase.js");
      m.setPhaseProject(${JSON.stringify(main.reqId)}, "version");
      return true;
    })()`);
    await sleep(500);
    await waitFor(`!document.querySelector('#verList .vl-row[data-ver-row="${main.versionId}"] .vl-sub .vl-risk-inline')`, "探针撤下");
    pass("撤下探针后列表恢复（不改数据库）");

    /* 3.2 窄屏：筛选条与新增勾选不撑破页面 */
    await size(390, 844, true);
    await sleep(300);
    const listNarrow = await evaluate(`(() => {
      const doc = document.documentElement;
      const box = document.getElementById("verList");
      const cb = box.querySelector("[data-ver-risk]");
      const chips = box.querySelector("[data-ver-chips]");
      return {
        sw: doc.scrollWidth, cw: doc.clientWidth,
        cb: !!cb && cb.getBoundingClientRect().width > 0,
        chipScroll: !!chips && getComputedStyle(chips).overflowX === "auto"
      };
    })()`);
    assert(listNarrow.sw <= listNarrow.cw + 1, `窄屏版本列表横向溢出：${listNarrow.sw} > ${listNarrow.cw}`);
    assert(listNarrow.cb && listNarrow.chipScroll, "窄屏需关注勾选不可见或筛选条不可横向滚动：" + JSON.stringify(listNarrow));
    await shot("04-版本列表窄屏");
    await size(1440, 900, false);
    await sleep(300);
    pass("窄屏 390：列表无横向溢出，勾选与筛选条可用");
    await evaluate(`document.querySelector('#phaseBody .vl-row .vl-name-link[data-ver-open="${main.versionId}"]').click()`);
    await waitFor(`document.body.dataset.view === "version"`, "版本名跳转");
    await waitFor(`location.hash.indexOf("#/version?id=${main.versionId}") === 0`, "详情页 hash");
    await waitFor(`(() => {
      const h = document.querySelector("#versionBody .vd-title");
      return !!h && h.textContent.trim() === ${JSON.stringify(main.versionName)};
    })()`, "详情页标题落到版本名");
    await waitFor(`document.querySelectorAll("#versionBody .vd-kpis .pcell").length === 6`, "概览指标格");
    const head = await evaluate(`(() => ({
      title: document.querySelector("#versionBody .vd-title").textContent.trim(),
      barTitle: document.getElementById("viewTitle").textContent.trim(),
      docTitle: document.title,
      crumb: document.getElementById("brandSub").textContent.replace(/\\s+/g, " ").trim(),
      hash: location.hash,
      kpis: [...document.querySelectorAll("#versionBody .vd-kpis .pcell")].map(c => c.textContent.replace(/\\s+/g, " ").trim()),
      panels: [...document.querySelectorAll("#versionBody .vd-panel .panel-head h3")].map(h => h.textContent.trim())
    }))()`);
    assert(head.title === main.versionName, `标题应为版本名，实际「${head.title}」`);
    assert(head.barTitle === "版本详情", `顶栏不该重复版本名，实际「${head.barTitle}」`);
    assert(head.docTitle.indexOf(main.versionName) === 0, "浏览器标题未带版本名：" + head.docTitle);
    assert(head.crumb.indexOf("版本") === 0 && head.crumb.indexOf("详情") > 0, "面包屑不对：" + head.crumb);
    assert(head.kpis.length === 6, "概览指标格应为 6 个，实际 " + head.kpis.length);
    /* 工作项均耗时挪进工时卡：口径、下钻都必须在实际一侧 */
    const avg = await evaluate(`(() => {
      const side = [...document.querySelectorAll("#versionBody .vd-hours-card .vd-hour-side")]
        .find(w => w.textContent.indexOf("已完成项均耗时") >= 0);
      if(!side) return null;
      const btn = side.querySelector(".vd-hour-avg");
      return {
        value: btn ? btn.textContent.trim() : "",
        drill: btn ? btn.getAttribute("data-vd-drill") : "",
        help: !!side.querySelector('.caliber-mark[data-caliber-help="version.avgTask"]')
      };
    })()`);
    assert(avg && avg.drill === "avg" && avg.help, "工时卡缺少可下钻、可看口径的「工作项均耗时」：" + JSON.stringify(avg));
    await evaluate(`document.querySelector('#versionBody .caliber-mark[data-caliber-help="version.avgTask"]').click()`);
    await waitFor(`!!document.querySelector(".caliber-pop")`, "均耗时口径弹层");
    const avgHelp = await evaluate(`document.querySelector(".caliber-pop").textContent.replace(/\\s+/g, " ").trim()`);
    assert(avgHelp.indexOf("已完成") >= 0 && avgHelp.indexOf("没有完成项") >= 0, "均耗时口径文案不对：" + avgHelp);
    await evaluate(`document.querySelector("#versionBody .vd-title").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    await waitFor(`!document.querySelector(".caliber-pop")`, "均耗时口径弹层关闭");
    const doneCount = await evaluate(`(() => {
      const c = [...document.querySelectorAll("#versionBody .vd-kpis .pcell")].find(x => {
        const s = x.querySelector("span");
        return s && s.textContent.trim() === "已完成";
      });
      return c ? Number(c.querySelector("b").textContent.trim()) : NaN;
    })()`);
    await evaluate(`document.querySelector('#versionBody .vd-hour-avg[data-vd-drill="avg"]').click()`);
    await waitFor(`(() => {
      const st = document.querySelector('#versionBody [data-vd-filter="status"]');
      const so = document.querySelector('#versionBody [data-vd-filter="sort"]');
      return !!st && st.value === "done" && !!so && so.value === "actual";
    })()`, "均耗时下钻", 25000);
    const avgRows = await evaluate(`document.querySelectorAll("#versionBody tbody tr[data-open-task]").length`);
    assert(avgRows === doneCount, "均耗时下钻应只含已完成项：" + avgRows + " 行 vs 已完成 " + doneCount);
    await evaluate(`document.querySelector('#versionBody [data-vd-filter-reset]').click()`);
    await evaluate(`document.querySelector('#versionBody [data-vd-tab="overview"]').click()`);
    await waitFor(`document.querySelector('#versionBody [data-vd-tab="overview"]').classList.contains("on")`, "回到概览");
    pass("工作项均耗时：口径可读、下钻已完成且按实际工时排序（" + avg.value + "，" + avgRows + " 行）");
    const descNow = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const data = await API.get("/api/versions/stats", { reqId: ${JSON.stringify(main.reqId)} });
      const row = ((data && data.versions) || []).find(v => v.id === ${JSON.stringify(main.versionId)});
      const p = document.querySelector("#versionBody [data-vd-desc]");
      const btn = document.querySelector("#versionBody [data-vd-desc-toggle]");
      return {
        api: (row && row.description) || "",
        dom: p ? p.textContent.trim() : "",
        toggle: btn ? !btn.hidden : false,
        clamp: p ? getComputedStyle(p).webkitLineClamp : ""
      };
    })()`);
    assert(descNow.api, "主用例版本没有说明，无法验证说明区");
    assert(descNow.dom === descNow.api.trim(), "版本说明未按数据渲染：" + JSON.stringify({ api: descNow.api, dom: descNow.dom }));
    assert(descNow.clamp === "2", "版本说明默认不是两行折叠：" + descNow.clamp);
    if(descNow.toggle){
      const before = await evaluate(`document.querySelector("#versionBody [data-vd-desc]").getBoundingClientRect().height`);
      await evaluate(`document.querySelector("#versionBody [data-vd-desc-toggle]").click()`);
      await sleep(120);
      const opened = await evaluate(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        const b = document.querySelector("#versionBody [data-vd-desc-toggle]");
        return { open: p.classList.contains("open"), text: b.textContent.trim(), h: p.getBoundingClientRect().height };
      })()`);
      assert(opened.open && opened.text === "收起说明" && opened.h > before + 2, "版本说明展开失败：" + JSON.stringify(opened));
      await evaluate(`document.querySelector("#versionBody [data-vd-desc-toggle]").click()`);
      await sleep(120);
      pass("版本说明两行折叠，可展开 / 收起（" + descNow.dom.length + " 字）");
    } else {
      pass("版本说明按数据渲染，未超出两行不显示展开入口（" + descNow.dom.length + " 字）");
    }
    /* 偏差色调用 -text 后缀：裸 vd-warn 是错误横幅的类，会把数字渲染成带边框的小方块。
       当前版本偏差不一定落在 warn 档，所以直接造探针量计算样式，与数据无关。 */
    const toneProbe = await evaluate(`(() => {
      const grid = document.querySelector("#versionBody .vd-kpis");
      const out = {};
      ["", "vd-ok", "vd-warn-text", "vd-bad-text"].forEach(cls => {
        const cell = document.createElement("div");
        cell.className = "pcell";
        cell.innerHTML = '<b' + (cls ? ' class="' + cls + '"' : '') + '>+21%</b><span>探针</span>';
        grid.appendChild(cell);
        const b = cell.querySelector("b"), cs = getComputedStyle(b);
        out[cls || "base"] = { display:cs.display, border:cs.borderTopWidth, bg:cs.backgroundColor,
          pad:cs.paddingTop, size:cs.fontSize, weight:cs.fontWeight, color:cs.color };
        cell.remove();
      });
      out.stray = [...grid.querySelectorAll(".pcell b")].filter(b => /^(vd-warn|vd-bad)$/.test(b.className)).length;
      return out;
    })()`);
    const base = toneProbe.base;
    for(const cls of ["vd-ok", "vd-warn-text", "vd-bad-text"]){
      const p = toneProbe[cls];
      assert(p.display === base.display && p.border === base.border && p.bg === base.bg
        && p.pad === base.pad && p.size === base.size && p.weight === base.weight,
        "偏差指标 " + cls + " 的盒模型偏离无色调基准（疑被错误横幅样式污染）：" + JSON.stringify(p) + " vs " + JSON.stringify(base));
      assert(p.color !== base.color, "偏差指标 " + cls + " 没有自己的语义色：" + p.color);
    }
    assert(toneProbe.stray === 0, "仍有指标数字用裸 vd-warn / vd-bad 类：" + toneProbe.stray);
    pass("偏差指标三档色调只改颜色，盒模型与无色调数字一致（未继承错误横幅的边框 / 底色 / 小字号）");
    assert(head.panels.length >= 7, "概览面板不足：" + head.panels.join(","));
    await layout("桌面概览");
    await shot("02-详情概览");
    const progress = await evaluate(`(() => {
      const pct = document.querySelector("#versionBody .vd-pct");
      const segs = [...document.querySelectorAll("#versionBody .vd-bar > i")].map(i => Math.round(parseFloat(i.style.width)));
      const bar = document.querySelector("#versionBody .vd-bar");
      return {
        cap: pct && pct.querySelector("small").textContent.trim(),
        value: pct && pct.querySelector("b").textContent.trim(),
        barCap: (document.querySelector("#versionBody .vd-bar-cap") || {}).textContent,
        sum: segs.reduce((a, b) => a + b, 0),
        aria: bar && bar.getAttribute("aria-label")
      };
    })()`);
    assert(progress.cap === "完成率" && progress.barCap === "范围构成",
      "完成率与范围构成口径未分别标注：" + JSON.stringify(progress));
    assert(Math.abs(progress.sum - 100) <= 1, "范围构成色条不等于 100%：" + progress.sum);
    assert(progress.aria && progress.aria.indexOf("范围构成") === 0, "色条缺少可读说明：" + progress.aria);
    await size(1440, 2600, false);
    await shot("02d-概览全页");
    await size(1440, 900, false);
    pass("版本卡 → 详情页：" + head.title + " · " + head.panels.join(" / "));
    noExceptions("概览");

    /* 4. 五个页签逐个渲染 */
    const tabExpect = { scope: "版本工作项", demands: "已排需求", releases: "发布计划", log: "版本操作记录" };
    for(const key of ["scope", "demands", "releases", "log", "overview"]){
      await evaluate(`document.querySelector('#versionBody [data-vd-tab="${key}"]').click()`);
      await waitFor(`document.querySelector('#versionBody [data-vd-tab="${key}"]').classList.contains("on")`, "页签 " + key);
      await waitFor(`(() => {
        const body = document.querySelector("#versionBody .vd-body");
        return !!body && !body.querySelector(".skeleton, .sk-row, .skeleton-rows") && body.textContent.trim().length > 20;
      })()`, "页签内容 " + key);
      if(tabExpect[key]){
        const has = await evaluate(`[...document.querySelectorAll("#versionBody .vd-panel .panel-head h3")].some(h => h.textContent.trim() === ${JSON.stringify(tabExpect[key])})`);
        assert(has, `页签 ${key} 缺少「${tabExpect[key]}」面板`);
      }
      const hashTab = await evaluate(`new URLSearchParams(location.hash.split("?")[1] || "").get("tab") || "overview"`);
      assert(hashTab === key, `页签 ${key} 未写进 hash，实际 ${hashTab}`);
      if(key === "scope"){
        /* 接口没返回的字段不该在表里留一列破折号：任务行只渲染真实拿得到的内容 */
        const cells = await evaluate(`(() => {
          const rows = [...document.querySelectorAll("#versionBody tbody tr[data-open-task]")];
          return {
            rows: rows.length,
            deadNo: rows.filter(r => r.querySelector(".vd-no")).length,
            emptyTitle: rows.filter(r => !(r.querySelector(".vd-tname") || {}).textContent?.trim()).length,
            placeholder: (document.querySelector('#versionBody [data-vd-filter="q"]') || {}).placeholder
          };
        })()`);
        assert(cells.rows > 0 && !cells.deadNo && !cells.emptyTitle, "工作项行有空标题或占位编号：" + JSON.stringify(cells));
        assert(cells.placeholder.indexOf("编号") === -1, "搜索提示承诺了接口不返回的编号：" + cells.placeholder);
      }
      await layout("页签 " + key);
      await shot("03-页签-" + key);
      pass("页签 " + key + " 渲染并写入 hash");
      noExceptions("页签 " + key);
    }

    /* 5. 概览指标格下钻 → 工作项页带上筛选，行数必须与指标口径一致 */
    await evaluate(`document.querySelector('#versionBody [data-vd-tab="overview"]').click()`);
    await waitFor(`!!document.querySelector('#versionBody [data-vd-drill="done"]')`, "已完成指标格");
    const doneKpi = await evaluate(`Number(document.querySelector('#versionBody [data-vd-drill="done"] b').textContent.trim()) || 0`);
    await evaluate(`document.querySelector('#versionBody [data-vd-drill="done"]').click()`);
    await waitFor(`(() => {
      const p = new URLSearchParams(location.hash.split("?")[1] || "");
      return p.get("tab") === "scope" && p.get("st") === "done";
    })()`, "指标下钻写筛选");
    const drilled = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#versionBody tbody tr[data-open-task]")];
      const sel = document.querySelector('#versionBody [data-vd-filter="status"]');
      return { rows: rows.length, status: sel && sel.value, allDone: rows.every(r => r.textContent.indexOf("已完成") >= 0) };
    })()`);
    assert(drilled.status === "done" && drilled.allDone, "下钻后筛选与行内容不一致：" + JSON.stringify(drilled));
    assert(drilled.rows === doneKpi, `下钻行数 ${drilled.rows} 与概览「已完成 ${doneKpi}」不一致`);
    pass(`指标下钻 → 工作项页（已完成 ${drilled.rows} 行，与概览指标一致）`);

    /* 6. 搜索输入：逐字重画不能打断焦点与光标 */
    await evaluate(`(() => {
      const sel = document.querySelector('#versionBody [data-vd-filter="status"]');
      sel.value = ""; sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const kw = await evaluate(`(() => {
      const row = document.querySelector("#versionBody tbody tr[data-open-task] .vd-tname");
      return row ? row.textContent.trim().slice(0, 3) : "";
    })()`);
    assert(kw, "工作项页没有可搜索的行");
    await evaluate(`(() => {
      const el = document.querySelector('#versionBody [data-vd-filter="q"]');
      el.focus();
      return true;
    })()`);
    for(const ch of kw){
      await evaluate(`(() => {
        const el = document.querySelector('#versionBody [data-vd-filter="q"]');
        el.value = el.value + ${JSON.stringify(ch)};
        el.setSelectionRange(el.value.length, el.value.length);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await sleep(120);
    }
    const searched = await evaluate(`(() => {
      const el = document.querySelector('#versionBody [data-vd-filter="q"]');
      return {
        focused: document.activeElement === el, value: el.value,
        caret: el.selectionStart, rows: document.querySelectorAll("#versionBody tbody tr[data-open-task]").length,
        q: new URLSearchParams(location.hash.split("?")[1] || "").get("q")
      };
    })()`);
    assert(searched.focused, "搜索框在重画后丢了焦点");
    assert(searched.value === kw && searched.caret === kw.length, "搜索框内容或光标被重画打断：" + JSON.stringify(searched));
    assert(searched.rows > 0 && searched.q === kw, "搜索未生效或未写进 hash：" + JSON.stringify(searched));
    await shot("04-工作项搜索");
    pass(`搜索「${kw}」命中 ${searched.rows} 行，焦点与光标保持`);

    /* 7. 深链冷启动整页重载：位置与筛选都要还原（分享出去的链接就是这条路径） */
    const deep = await evaluate(`location.href`);
    await coldLoad(deep);
    await waitFor(`document.body.dataset.view === "version"`, "深链进入详情页", 25000);
    await waitFor(`(() => {
      const el = document.querySelector('#versionBody [data-vd-filter="q"]');
      return !!el && el.value.length > 0;
    })()`, "深链还原筛选", 25000);
    const restored = await evaluate(`(() => ({
      title: document.querySelector("#versionBody .vd-title").textContent.trim(),
      tab: document.querySelector("#versionBody .vd-tab.on").dataset.vdTab,
      q: document.querySelector('#versionBody [data-vd-filter="q"]').value,
      rows: document.querySelectorAll("#versionBody tbody tr[data-open-task]").length
    }))()`);
    assert(restored.title === main.versionName && restored.tab === "scope" && restored.q === kw, "深链未还原位置：" + JSON.stringify(restored));
    pass("深链冷启动重载还原：" + restored.title + " / " + restored.tab + " / q=" + restored.q);
    noExceptions("深链重载");

    /* 8. 只给版本 id 的深链：冷启动后反查所属项目 */
    await coldLoad(BASE + "/index.html#/version?id=" + main.versionId);
    await waitFor(`document.body.dataset.view === "version"`, "无 reqId 深链", 25000);
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "反查项目后渲染", 25000);
    const resolved = await evaluate(`new URLSearchParams(location.hash.split("?")[1] || "").get("reqId")`);
    assert(resolved === main.reqId, "反查项目失败，reqId=" + resolved);
    pass("只给版本 id 的深链反查项目成功");

    /* 9. 浏览器后退：回到版本列表 */
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "回到版本页");
    await evaluate(`(async () => { const m = await import("./js/views/phase.js"); m.setPhaseProject(${JSON.stringify(main.reqId)}, "version"); return true; })()`);
    await waitFor(`!!document.querySelector('#phaseBody .vl-row .vl-name-link[data-ver-open="${main.versionId}"]')`, "版本行入口");
    await evaluate(`document.querySelector('#phaseBody .vl-row .vl-name-link[data-ver-open="${main.versionId}"]').click()`);
    await waitFor(`document.body.dataset.view === "version"`, "再次进入详情");
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "详情渲染");
    await evaluate(`history.back()`);
    await waitFor(`document.body.dataset.view === "phase"`, "后退回版本页");
    pass("浏览器后退回版本列表");
    await evaluate(`history.forward()`);
    await waitFor(`document.body.dataset.view === "version"`, "前进回详情");
    pass("浏览器前进回详情页");

    /* 10. 同项目版本切换 */
    const switched = await evaluate(`(() => {
      const sel = document.querySelector("#versionBody [data-vd-switch]");
      if(!sel || sel.options.length < 2) return null;
      const next = [...sel.options].find(o => !o.selected);
      sel.value = next.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { id: next.value, name: next.textContent.trim() };
    })()`);
    if(switched){
      await waitFor(`new URLSearchParams(location.hash.split("?")[1] || "").get("id") === ${JSON.stringify(switched.id)}`, "切换版本写 hash");
      await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(switched.name.split("（")[0])}`, "切换后渲染");
      pass("同项目版本切换 → " + switched.name);
      await evaluate(`history.back()`);
      await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "后退回原版本");
    }else{
      pass("同项目只有一个版本，切换器按设计隐藏");
    }

    /* 10b. 承诺基线与已发布版本的交付事实必须落到真实数字，而不是占位；
       未开始开发 / 尚未冻结基线的版本只允许出现明确的空态说明 */
    const commitment = await evaluate(`(() => {
      const panel = [...document.querySelectorAll("#versionBody .vd-panel")].find(p => p.querySelector("h3") && p.querySelector("h3").textContent.trim() === "承诺基线");
      if(!panel) return null;
      return {
        cells: [...panel.querySelectorAll(".vd-cmp-cell")].map(c => c.textContent.replace(/\\s+/g, " ").trim()),
        hint: (panel.querySelector(".hint") || {}).textContent || ""
      };
    })()`);
    assert(commitment, "承诺基线面板缺失");
    assert(commitment.cells.length === 4 || /还没有基线/.test(commitment.hint),
      "承诺基线既没有四格、也没有空态说明：" + JSON.stringify(commitment));
    pass(commitment.cells.length
      ? "承诺基线：" + commitment.cells.join(" / ")
      : "承诺基线：尚未冻结（空态说明已展示）");
    if(pick.released){
      await navigate(BASE + "/index.html#/version?id=" + pick.released.versionId + "&reqId=" + pick.released.reqId + "&tab=releases");
      await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(pick.released.versionName)}`, "已发布版本详情", 25000);
      await waitFor(`document.querySelectorAll("#versionBody .vd-records .release-record").length > 0`, "发布记录快照", 25000);
      const facts = await evaluate(`(() => {
        const rows = [...document.querySelectorAll("#versionBody .vd-records .release-record")];
        const exp = document.querySelector('#versionBody [data-release-export]');
        return { records: rows.length, chars: rows[0].textContent.replace(/\\s+/g, " ").trim().length, hasExport: !!exp };
      })()`);
      assert(facts.records > 0 && facts.chars > 80, "发布快照内容过少：" + JSON.stringify(facts));
      await shot("02b-已发布版本快照");
      /* 快照里的工作项 / 需求由 lib/format 渲染，点击必须真能打开对应实体 */
      await evaluate(`document.querySelector("#versionBody .vd-records .release-record").open = true`);
      const snap = await evaluate(`(() => {
        const t = document.querySelector("#versionBody .vd-records [data-snap-task]");
        const d = document.querySelector("#versionBody .vd-records [data-snap-demand]");
        return { task: t && t.getAttribute("data-snap-task"), taskText: t && t.textContent.replace(/\\s+/g, " ").trim(),
          demand: d && d.getAttribute("data-snap-demand"), demandText: d && d.textContent.replace(/\\s+/g, " ").trim() };
      })()`);
      if(snap.task){
        await evaluate(`document.querySelector("#versionBody .vd-records [data-snap-task]").click()`);
        await waitFor(`!!document.querySelector("#taskDrawer.on")`, "快照工作项抽屉", 25000);
        const snapTaskTitle = await evaluate(`document.getElementById("taskDrawerTitle").textContent.trim()`);
        assert(snapTaskTitle && snapTaskTitle !== "新建工作项", "快照工作项点开的是空白抽屉：" + snapTaskTitle);
        await shot("02e-快照工作项");
        await evaluate(`document.getElementById("btnCloseTask").click()`);
        await waitFor(`!document.querySelector("#taskDrawer.on")`, "快照工作项抽屉关闭");
        pass("发布快照工作项 → 工作项详情：" + snapTaskTitle);
      }
      if(snap.demand){
        await evaluate(`document.querySelector("#versionBody .vd-records [data-snap-demand]").click()`);
        await waitFor(`!!document.querySelector(".modal-layer.demand-detail.open")`, "快照需求详情", 25000);
        const snapDemandTitle = await evaluate(`document.getElementById("demandDetailTitle").textContent.trim()`);
        assert(!!snapDemandTitle, "快照需求详情标题为空");
        await shot("02f-快照需求");
        await evaluate(`document.querySelector(".modal-layer.demand-detail.open [data-dem-x]").click()`);
        await waitFor(`!document.querySelector(".modal-layer.demand-detail.open")`, "快照需求详情关闭");
        pass("发布快照需求 → 需求详情：" + snapDemandTitle);
      }
      assert(snap.task || snap.demand, "发布快照里没有任何可点的关联实体：" + JSON.stringify(snap));
      /* 快照的「实际记录版本」也是实体引用：必须能跳回该版本详情，而不是只留一行名字 */
      const snapVer = await evaluate(`(() => {
        const cells = [...document.querySelectorAll("#versionBody .vd-records .release-record")]
          .map(d => [...d.querySelectorAll("tbody tr")].map(tr => tr.children[3]).filter(Boolean))
          .flat();
        return cells.slice(0, 6).map(td => {
          const a = td.querySelector("[data-jump-version]");
          return { text: td.textContent.trim(), id: a && a.getAttribute("data-jump-version"), req: a && a.getAttribute("data-jump-req") };
        });
      })()`);
      assert(snapVer.length > 0, "发布快照没有版本列");
      assert(snapVer.every(c => c.id === pick.released.versionId),
        "快照版本列不是指向该版本的跳转链接：" + JSON.stringify(snapVer));
      assert(snapVer.every(c => c.text === pick.released.versionName),
        "快照版本列名字与记录版本不符：" + JSON.stringify(snapVer));
      assert(snapVer.every(c => c.req === pick.released.reqId),
        "快照版本链接缺少项目上下文，跨项目分享会反查失败：" + JSON.stringify(snapVer));
      await evaluate(`document.querySelector("#versionBody .vd-records [data-jump-version]").click()`);
      await waitFor(`new URLSearchParams(location.hash.split("?")[1] || "").get("id") === ${JSON.stringify(pick.released.versionId)}`, "快照版本跳转写 hash", 20000);
      await waitFor(`(document.querySelector("#versionBody .vd-title") || {}).textContent === ${JSON.stringify(pick.released.versionName)}`, "快照版本跳转落地", 25000);
      assert(!(await evaluate(`!!document.querySelector("#taskDrawer.on, .modal-layer.open")`)), "点快照版本名误开了抽屉 / 弹层");
      pass(`发布快照版本 → 版本详情：${snapVer[0].text}（${snapVer.length} 行快照全部可跳）`);
      noExceptions("快照关联");
      await evaluate(`document.querySelector('#versionBody [data-vd-tab="overview"]').click()`);
      await waitFor(`(() => {
        const p = [...document.querySelectorAll("#versionBody .vd-panel")].find(x => x.querySelector("h3") && x.querySelector("h3").textContent.trim() === "实际交付事实");
        return !!p && p.querySelectorAll(".vd-cmp-cell").length === 4;
      })()`, "实际交付事实四格");
      const releasedAvg = await evaluate(`(() => {
        const btn = document.querySelector('#versionBody .vd-hour-avg[data-vd-drill="avg"]');
        return btn ? btn.textContent.trim() : "";
      })()`);
      assert(releasedAvg && releasedAvg !== "—" && /[0-9]/.test(releasedAvg), "已发布版本的工作项均耗时没有数值：" + releasedAvg);
      await shot("02c-实际交付事实");
      pass(`已发布版本 ${pick.released.versionName}：${facts.records} 条不可变快照 + 交付事实四格（均耗时 ${releasedAvg}）`);
      noExceptions("已发布版本");
    }

    /* 10c. 里程碑详情里的「达成方式 · 版本」同样是实体引用，点它回到该版本详情 */
    const msVer = pick.released || main;
    await navigate(BASE + "/index.html#/version?id=" + msVer.versionId + "&reqId=" + msVer.reqId);
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(msVer.versionName)}`, "里程碑用例版本", 25000);
    const msRow = await evaluate(`(() => {
      const tr = document.querySelector("#versionBody tr[data-vd-milestone]");
      return tr ? { id: tr.getAttribute("data-vd-milestone"), name: tr.children[0].textContent.trim() } : null;
    })()`);
    if(msRow){
      await evaluate(`document.querySelector("#versionBody tr[data-vd-milestone]").click()`);
      await waitFor(`!!document.querySelector('.modal-layer.open[aria-label="里程碑详情"]')`, "里程碑详情弹层", 20000);
      const msLink = await evaluate(`(() => {
        const l = document.querySelector('.modal-layer.open[aria-label="里程碑详情"]');
        const dd = [...l.querySelectorAll(".ms-detail-meta div")].find(d => d.querySelector("dt") && d.querySelector("dt").textContent.trim() === "达成方式");
        const a = dd && dd.querySelector("[data-jump-version]");
        return { text: dd && dd.textContent.replace(/\\s+/g, " ").trim(), id: a && a.getAttribute("data-jump-version"), req: a && a.getAttribute("data-jump-req") };
      })()`);
      assert(msLink.id === msVer.versionId, "里程碑「达成方式」的版本不可跳转或指错版本：" + JSON.stringify(msLink));
      assert(msLink.req === msVer.reqId, "里程碑版本链接缺少项目上下文：" + JSON.stringify(msLink));
      await shot("02g-里程碑详情");
      await evaluate(`document.querySelector('.modal-layer.open[aria-label="里程碑详情"] [data-jump-version]').click()`);
      await waitFor(`!document.querySelector('.modal-layer.open[aria-label="里程碑详情"]')`, "跳转后里程碑弹层关闭", 20000);
      await waitFor(`(document.querySelector("#versionBody .vd-title") || {}).textContent === ${JSON.stringify(msVer.versionName)}`, "里程碑版本跳转落地", 25000);
      pass(`里程碑「${msRow.name}」达成方式 → 版本详情：${msLink.text}`);
      noExceptions("里程碑关联");
    }else{
      pass("该版本没有关联里程碑，里程碑跳转按设计不出现");
    }

    /* 11. 写操作复用版本页弹窗（打开即关，不落数据） */
    await navigate(BASE + "/index.html#/version?id=" + main.versionId + "&reqId=" + main.reqId);
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "回到主用例版本", 25000);
    for(const [tool, selector, label] of [
      ["edit", "#dlgVersion.open", "编辑版本"],
      ["plan", "#view-release .release-body", "计划与历史"],
      ["note", ".modal-layer.open .release-sheet", "发布说明"]
    ]){
      const exists = await evaluate(`!!document.querySelector('#versionBody [data-vd-tool="${tool}"]')`);
      if(!exists){ pass(`当前版本无「${label}」入口（权限/终态），跳过`); continue; }
      await evaluate(`document.querySelector('#versionBody [data-vd-tool="${tool}"]').click()`);
      await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, label + " 打开", 20000);
      if(tool === "edit"){
        /* 编辑弹窗是静态表单：标题是动作名，版本名在输入框里，项目名在绑定行 */
        await waitFor(`document.getElementById("vName").value === ${JSON.stringify(main.versionName)}`, "编辑弹窗回填版本名", 20000);
        const form = await evaluate(`(() => ({
          title: document.getElementById("verFormTitle").textContent.trim(),
          name: document.getElementById("vName").value,
          project: document.getElementById("vProjectName").textContent.trim(),
          start: document.getElementById("vStart").value
        }))()`);
        assert(form.title === "编辑版本", "编辑弹窗标题不对：" + form.title);
        assert(form.project === main.projectName, `编辑弹窗项目上下文串了：「${form.project}」应为「${main.projectName}」`);
        await shot("05-弹窗-edit");
        await evaluate(`document.getElementById("dlgVersionX").click()`);
        await waitFor(`!document.querySelector("#dlgVersion.open")`, "编辑弹窗关闭");
        pass(`写操作「编辑版本」复用版本页弹窗并回填：${form.name} / ${form.project} / 开始 ${form.start || "未设"}`);
      }else if(tool === "plan"){
        /* 发布工作台已迁到 #/release 子页：从详情下钻，返回要回到这一页而不是版本列表 */
        await waitFor(`document.body.dataset.view === "release" && document.querySelector("#view-release .release-body").textContent.trim().length > 40`, label + " 页面内容", 25000);
        const pageTitle = await evaluate(`(document.querySelector("#view-release .release-page-bar b") || {}).textContent || ""`);
        assert(pageTitle === main.versionName, `工作台页头版本名不对：「${pageTitle}」应为「${main.versionName}」`);
        await shot("05-页面-plan");
        await evaluate(`document.querySelector("#view-release [data-release-back]").click()`);
        await waitFor(`document.body.dataset.view === "version" && document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, label + " 回到版本详情", 20000);
        pass(`「${label}」进入发布工作台子页，返回落在版本详情：${pageTitle}`);
      }else{
        await waitFor(`(() => {
          const h = document.querySelector(".modal-layer.open .release-sheet h2");
          return !!h && h.textContent.indexOf(${JSON.stringify(main.versionName)}) === 0;
        })()`, label + " 弹窗标题", 20000);
        await waitFor(`(() => {
          const b = document.querySelector(".modal-layer.open .release-body");
          return !!b && !b.querySelector(".skeleton-rows, .sk-row") && b.textContent.trim().length > 40;
        })()`, label + " 弹窗内容", 25000);
        const modalTitle = await evaluate(`document.querySelector(".modal-layer.open .release-sheet h2").textContent.replace(/\\s+/g, " ").trim()`);
        await shot("05-弹窗-" + tool);
        await evaluate(`document.querySelector(".modal-layer.open [data-release-close]").click()`);
        await waitFor(`!document.querySelector(".modal-layer.open")`, label + " 弹窗关闭");
        pass(`写操作「${label}」复用版本页弹窗：${modalTitle}`);
      }
      noExceptions("弹窗 " + tool);
    }

    /* 12. 跨项目「全部版本」表的版本名跳转 */
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "版本页");
    await evaluate(`document.querySelector('#phaseModeSeg [data-pmode="allversions"]').click()`);
    await waitFor(`document.querySelectorAll("#phaseBody .allv-tbl tbody button.allv-vname").length > 0`, "全部版本表");
    const allv = await evaluate(`(() => {
      const btn = [...document.querySelectorAll("#phaseBody .allv-tbl tbody button.allv-vname")]
        .find(b => b.getAttribute("data-ver-open") === ${JSON.stringify(main.versionId)});
      if(!btn) return null;
      return { req: btn.getAttribute("data-ver-req"), text: btn.textContent.trim() };
    })()`);
    assert(allv && allv.req === main.reqId, "全部版本表缺少版本名入口或项目 id：" + JSON.stringify(allv));
    await shot("06-全部版本入口");
    await evaluate(`[...document.querySelectorAll("#phaseBody .allv-tbl tbody button.allv-vname")].find(b => b.getAttribute("data-ver-open") === ${JSON.stringify(main.versionId)}).click()`);
    await waitFor(`document.body.dataset.view === "version"`, "全部版本表跳转");
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "跨项目入口渲染");
    const crossReq = await evaluate(`new URLSearchParams(location.hash.split("?")[1] || "").get("reqId")`);
    assert(crossReq === main.reqId, "跨项目入口带错项目：" + crossReq);
    pass("跨项目「全部版本」表版本名 → 详情页");

    /* 13. 无 id 时给版本选择器，不给死路 */
    await navigate(BASE + "/index.html#/version");
    await waitFor(`document.body.dataset.view === "version"`, "无 id 进入");
    await waitFor(`document.querySelectorAll("#vdPicker .vd-pick").length > 0`, "版本选择器", 25000);
    const picker = await evaluate(`(() => ({
      count: document.querySelectorAll("#vdPicker .vd-pick").length,
      groups: document.querySelectorAll("#vdPicker .vd-panel").length
    }))()`);
    await shot("07-版本选择器");
    await evaluate(`(() => {
      const el = document.getElementById("vdPickerQuery");
      el.focus(); el.value = ${JSON.stringify(main.projectName.slice(0, 4))};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    const filtered = await evaluate(`(() => ({
      focused: document.activeElement === document.getElementById("vdPickerQuery"),
      count: document.querySelectorAll("#vdPicker .vd-pick").length
    }))()`);
    assert(filtered.focused && filtered.count > 0, "选择器搜索异常：" + JSON.stringify(filtered));
    await evaluate(`document.querySelector("#vdPicker .vd-pick").click()`);
    await waitFor(`!!new URLSearchParams(location.hash.split("?")[1] || "").get("id")`, "选择器落 hash");
    await waitFor(`document.querySelectorAll("#versionBody .vd-panel").length > 0`, "选择器进详情");
    pass(`无 id → 选择器（${picker.count} 个版本 / ${picker.groups} 个项目）→ 详情`);

    /* 13b. 关联项联动与下钻：点名字开实体详情，点漏斗把本页明细收窄到该实体 */
    const hashOf = () => evaluate(`(() => {
      const p = new URLSearchParams(location.hash.split("?")[1] || "");
      return { tab: p.get("tab") || "overview", cat: p.get("cat") || "", br: p.get("br") || "",
        dm: p.get("dm") || "", sg: p.get("sg") || "", ow: p.get("ow") || "", sort: p.get("sort") || "default" };
    })()`);
    const scopeState = () => evaluate(`(() => {
      const rows = [...document.querySelectorAll("#versionBody tbody tr[data-open-task]")];
      const bar = document.querySelector("#versionBody .vd-linked");
      const attr = (r, sel, name) => { const el = r.querySelector(sel); return el ? el.getAttribute(name) : ""; };
      const val = sel => { const el = document.querySelector(sel); return el ? el.value : null; };
      return {
        rows: rows.length,
        chips: bar ? [...bar.querySelectorAll(".vd-link-chip")].map(c => c.textContent.replace(/\\s+/g, " ").trim()) : [],
        demands: rows.map(r => attr(r, ".vd-rel[data-vd-demand]", "data-vd-demand")),
        branches: rows.map(r => attr(r, ".vd-rel[data-vd-branch]", "data-vd-branch")),
        owners: rows.map(r => r.children[2].textContent.trim()),
        sort: val('#versionBody [data-vd-filter="sort"]'),
        cat: val('#versionBody [data-vd-filter="cat"]'),
        owner: val('#versionBody [data-vd-filter="owner"]')
      };
    })()`);
    const clearFilters = async () => {
      await evaluate(`(() => {
        const b = document.querySelector("#versionBody [data-vd-filter-reset]");
        if(b) b.click();
        return true;
      })()`);
      await sleep(200);
    };
    await navigate(BASE + "/index.html#/version?id=" + main.versionId + "&reqId=" + main.reqId);
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "联动用例版本", 25000);
    await waitFor(`document.querySelectorAll("#versionBody .vd-hours-card .vd-hour-side").length === 2`, "工时卡", 25000);

    /* 13b-1 工时卡：预估 / 实际都能打开构成；比例、剩余预估与口径入口必须落到真实数字 */
    const card = await evaluate(`(() => {
      const card = document.querySelector("#versionBody .vd-hours-card");
      const sides = [...card.querySelectorAll(".vd-hour-side")];
      const txt = el => el ? el.textContent.replace(/\\s+/g, " ").trim() : "";
      return {
        estimate: txt(sides[0]), actual: txt(sides[1]),
        estOpen: !!sides[0].querySelector('.vd-hour-main[data-vd-hours="estimate"]'),
        actOpen: !!sides[1].querySelector('.vd-hour-main[data-vd-hours="actual"]'),
        burn: txt(card.querySelector(".vd-burn-head b")),
        remaining: txt(card.querySelector(".vd-burn-foot .mid")),
        width: card.querySelector(".vd-burn-track i").style.width,
        helps: ["version.estimate", "version.actual", "version.remaining"]
          .every(k => !!card.querySelector('.caliber-mark[data-caliber-help="' + k + '"]'))
      };
    })()`);
    assert(card.estOpen && card.actOpen, "工时卡两侧不是「查看构成」入口：" + JSON.stringify(card));
    assert(/预估\s*[0-9]/.test(card.estimate) && /实际\s*[0-9]/.test(card.actual),
      "工时卡预估 / 实际没有数值：" + JSON.stringify(card));
    assert(card.remaining.indexOf("剩余预估") >= 0 && card.helps, "剩余预估或口径入口缺失：" + JSON.stringify(card));
    assert(card.width && parseFloat(card.width) >= 0 && parseFloat(card.width) <= 100, "实际 / 预估比例条越界：" + card.width);
    await shot("10-工时卡");
    pass(`工时卡：${card.estimate.split("查看构成")[0]} ｜ ${card.actual.split("查看构成")[0]} ｜ 实际 / 预估 ${card.burn}`);

    /* 13b-2 预估构成：五个维度，类型页用于近似阶段，分类行点击必须收窄到该组的工作项 */
    await evaluate(`document.querySelector('#versionBody [data-vd-hours="estimate"]').click()`);
    await waitFor(`!!document.querySelector(".vd-h-layer.open .vd-h-sheet")`, "预估构成弹层");
    const estSheet = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      return {
        title: layer.querySelector("[data-vd-htitle]").textContent.replace(/\\s+/g, " ").trim(),
        sub: layer.querySelector("[data-vd-hsub]").textContent.replace(/\\s+/g, " ").trim(),
        tabs: [...layer.querySelectorAll("[data-vd-htab]")].map(t => t.textContent.trim()),
        proxy: layer.querySelectorAll(".vd-h-proxy-card").length,
        stack: layer.querySelectorAll(".vd-h-stack i").length,
        legend: layer.querySelectorAll(".vd-h-legend button").length,
        rows: [...layer.querySelectorAll("tr[data-vd-hfilter]")].map(r => ({
          kind: r.getAttribute("data-vd-hfilter"), value: r.getAttribute("data-vd-hvalue"),
          name: r.children[0].textContent.trim(),
          items: Number((r.children[3].textContent.match(/(\\d+)/) || [])[0]) || 0
        })),
        total: layer.querySelector(".vd-h-total").textContent.replace(/\\s+/g, " ").trim(),
        z: getComputedStyle(layer).zIndex
      };
    })()`);
    assert(estSheet.tabs.join("/") === "类型/模块/负责人/需求/工作项", "预估构成页签不对：" + estSheet.tabs.join("/"));
    assert(/^预估\s/.test(estSheet.title) && estSheet.sub.indexOf("平均") >= 0, "预估构成标题 / 摘要不对：" + JSON.stringify(estSheet));
    assert(estSheet.proxy >= 4, "类型页缺少阶段近似卡：" + estSheet.proxy);
    assert(estSheet.rows.length >= 2 && estSheet.legend === estSheet.rows.length,
      "构成图例与分组行不一致：" + JSON.stringify({ rows: estSheet.rows.length, legend: estSheet.legend }));
    assert(estSheet.stack > 0, "构成条没有分段：" + estSheet.stack);
    assert(Number(estSheet.z) > 0, "构成弹层没有进叠放层级：" + estSheet.z);
    const firstGroup = estSheet.rows[0];
    /* 未预估 / 超支提示只在不筛选时出现，先看全量工作项 */
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-htab="items"]').click()`);
    await waitFor(`!!document.querySelector('.vd-h-layer.open [data-vd-htab="items"][aria-selected="true"]')`, "预估工作项页");
    const allEst = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      return {
        rows: layer.querySelectorAll("tr[data-vd-htask]").length,
        callout: (layer.querySelector(".vd-h-callout") || {}).textContent || "",
        total: layer.querySelector(".vd-h-total").textContent.replace(/\\s+/g, " ").trim()
      };
    })()`);
    assert(allEst.callout.indexOf("还没有预估") >= 0 || allEst.callout.indexOf("超出预估") >= 0,
      "全量工作项页缺少未估 / 超支提示：" + JSON.stringify(allEst));
    assert(allEst.total.indexOf("当前列表") === 0, "工作项页合计行不对：" + allEst.total);
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-htab="type"]').click()`);
    await waitFor(`!!document.querySelector('.vd-h-layer.open [data-vd-htab="type"][aria-selected="true"]')`, "回到类型页");
    await evaluate(`(() => {
      const row = document.querySelector('.vd-h-layer.open tr[data-vd-hfilter="${firstGroup.kind}"][data-vd-hvalue="${firstGroup.value}"]');
      row.click(); return true;
    })()`);
    await waitFor(`!!document.querySelector('.vd-h-layer.open [data-vd-htab="items"]')`, "分组下钻切到工作项");
    const itemsState = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      return {
        tab: (layer.querySelector('[data-vd-htab][aria-selected="true"]') || {}).textContent || "",
        chip: (layer.querySelector(".vd-h-chip") || {}).textContent || "",
        rows: layer.querySelectorAll("tr[data-vd-htask]").length,
        total: layer.querySelector(".vd-h-total").textContent.replace(/\\s+/g, " ").trim(),
        callout: (layer.querySelector(".vd-h-callout") || {}).textContent || ""
      };
    })()`);
    assert(itemsState.tab === "工作项" && itemsState.chip.indexOf(firstGroup.name) >= 0,
      "分类行没有带出筛选：" + JSON.stringify(itemsState));
    assert(itemsState.rows === firstGroup.items,
      `分类「${firstGroup.name}」下钻行数 ${itemsState.rows} 与分组 ${firstGroup.items} 项不一致`);
    assert(itemsState.callout === "", "筛选后不该再堆全量提示：" + itemsState.callout);
    await shot("10b-预估构成-下钻");
    pass(`预估构成「${firstGroup.name}」分组 → ${itemsState.rows} 项（${itemsState.total}）`);

    /* 未预估提示：筛选态下按设计隐藏，清除筛选后回到全量才出现；点后列表必须只剩未估项 */
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-hclear]').click()`);
    await waitFor(`!document.querySelector('.vd-h-layer.open .vd-h-chip')`, "清除分类筛选");
    const cleared = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      const btn = layer.querySelector("[data-vd-hunest]");
      const side = document.querySelector("#versionBody .vd-hours-card .vd-hour-side");
      const m = side.textContent.match(/(\\d+) 项未估/);
      return {
        has: !!btn,
        count: m ? Number(m[1]) : 0,
        rows: layer.querySelectorAll("tr[data-vd-htask]").length,
        callout: (layer.querySelector(".vd-h-callout") || {}).textContent || ""
      };
    })()`);
    assert(cleared.rows > firstGroup.items, "清除筛选后没有回到全部工作项：" + cleared.rows);
    if(cleared.has){
      assert(cleared.callout.indexOf("还没有预估") >= 0, "未估提示没有随全量列表出现：" + cleared.callout);
      assert(cleared.count > 0, "卡片有未估提示却没标出项数：" + cleared.count);
      await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-hunest]').click()`);
      await waitFor(`(document.querySelector('.vd-h-layer.open .vd-h-chip') || {}).textContent === "未估工作项"`, "未估筛选");
      const unestRows = await evaluate(`document.querySelectorAll('.vd-h-layer.open tr[data-vd-htask]').length`);
      assert(unestRows === cleared.count, `未估筛选 ${unestRows} 行与卡片「${cleared.count} 项未估」不一致`);
      pass(`未预估提示 → 只留 ${unestRows} 项未估工作项`);
      await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-hclear]').click()`);
      await waitFor(`!document.querySelector('.vd-h-layer.open .vd-h-chip')`, "清除未估筛选");
    }else{
      assert(cleared.count === 0, "卡片有未估项但提示按钮缺失：" + cleared.count);
      pass("该版本没有未预估工作项，未估提示按设计不出现");
    }
    const totalItems = await evaluate(`document.querySelectorAll('#versionBody .vd-hour-main[data-vd-hours]').length`);
    assert(totalItems === 2, "工时卡入口数量异常：" + totalItems);

    /* 13b-3 实际构成：成员归集、计时窗口拆分；点工作项开详情，关掉详情回到构成 */
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-hclose]').click()`);
    await waitFor(`!document.querySelector(".vd-h-layer.open")`, "预估构成关闭");
    await evaluate(`document.querySelector('#versionBody [data-vd-hours="actual"]').click()`);
    await waitFor(`!!document.querySelector(".vd-h-layer.open [data-vd-htab]")`, "实际构成弹层");
    const actSheet = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      return {
        tabs: [...layer.querySelectorAll("[data-vd-htab]")].map(t => t.textContent.trim()),
        title: layer.querySelector("[data-vd-htitle]").textContent.replace(/\\s+/g, " ").trim(),
        rows: [...layer.querySelectorAll("tr[data-vd-hfilter]")].map(r => ({
          name: r.children[0].textContent.trim(),
          items: Number((r.children[3].textContent.match(/(\\d+)/) || [])[0]) || 0
        }))
      };
    })()`);
    assert(actSheet.tabs.join("/") === "成员/类型/模块/工作项/计时窗口", "实际构成页签不对：" + actSheet.tabs.join("/"));
    assert(/^实际\s/.test(actSheet.title) && actSheet.rows.length > 0, "实际构成没有成员分组：" + JSON.stringify(actSheet));
    const actGroup = actSheet.rows[0];
    await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      const row = [...layer.querySelectorAll("tr[data-vd-hfilter]")][0];
      row.click(); return true;
    })()`);
    await waitFor(`document.querySelectorAll('.vd-h-layer.open tr[data-vd-htask]').length === ${actGroup.items}`, "成员下钻行数");
    const actItems = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      const rows = [...layer.querySelectorAll("tr[data-vd-htask]")];
      return {
        chip: (layer.querySelector(".vd-h-chip") || {}).textContent || "",
        owners: rows.map(r => r.children[2].textContent.trim()),
        deltas: layer.querySelectorAll(".vd-h-delta").length,
        title: (layer.querySelector("[data-vd-htitle]") || {}).textContent || ""
      };
    })()`);
    assert(actItems.chip.indexOf(actGroup.name) >= 0 && actItems.owners.every(o => o === actGroup.name),
      "成员下钻后混入其他成员：" + JSON.stringify(actItems));
    assert(actItems.title.indexOf("实际") >= 0, "实际构成标题被改坏：" + actItems.title);
    await evaluate(`document.querySelector('.vd-h-layer.open tr[data-vd-htask]').click()`);
    await waitFor(`!!document.querySelector("#taskDrawer.on")`, "构成里的工作项详情", 20000);
    const fromSheet = await evaluate(`(() => ({
      open: !!document.querySelector(".vd-h-layer.open"),
      title: document.getElementById("taskDrawerTitle").textContent.trim()
    }))()`);
    assert(fromSheet.open, "打开工作项详情后构成弹层被顶掉了");
    await evaluate(`document.getElementById("btnCloseTask").click()`);
    await waitFor(`!document.querySelector("#taskDrawer.on") && !!document.querySelector(".vd-h-layer.open")`, "关详情回到构成");
    pass(`实际构成「${actGroup.name}」→ ${actGroup.items} 项；工作项详情可开可回（${fromSheet.title}）`);

    /* 计时窗口：窗口内 + 窗口外必须等于实际合计，并说明缺时间时的退化口径 */
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-htab="window"]').click()`);
    await waitFor(`!!document.querySelector(".vd-h-layer.open .vd-h-stage")`, "计时窗口页");
    const win = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      const stages = [...layer.querySelectorAll(".vd-h-stage")];
      const num = t => { const m = t.replace(/\\s+/g, " ").match(/([0-9]+(?:\\.[0-9]+)?h(?:[0-9]+m)?)/); return m ? m[1] : ""; };
      return {
        out: num(stages[0].textContent), inn: num(stages[1].textContent),
        notice: (layer.querySelector(".vd-h-notice") || {}).textContent || "",
        flow: !!layer.querySelector(".vd-h-flow"),
        rows: layer.querySelectorAll("tr[data-vd-htask]").length,
        total: layer.querySelector(".vd-h-total").textContent.replace(/\\s+/g, " ").trim()
      };
    })()`);
    assert(win.flow && win.rows > 0, "计时窗口页缺少口径说明或明细：" + JSON.stringify(win));
    assert(win.out || win.inn, "计时窗口两侧都没有数值：" + JSON.stringify(win));
    assert(win.notice.indexOf("窗口外") >= 0 && win.notice.indexOf("不能当作开发工时") >= 0,
      "计时窗口缺少边界说明：" + win.notice);
    await shot("10c-实际构成-计时窗口");
    const cardAct = (card.actual.match(/实际\s*([0-9]+h(?:[0-9]+m)?)/) || [])[1];
    assert(!cardAct || win.total.indexOf(cardAct) >= 0, `计时窗口合计 ${win.total} 与工时卡实际 ${cardAct} 不一致`);
    pass(`计时窗口：窗口外 ${win.out} ＋ 窗口内 ${win.inn}，${win.rows} 项有计时`);

    /* Esc 关弹层，页面仍停在概览 */
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await waitFor(`!document.querySelector(".vd-h-layer.open")`, "Esc 关闭构成弹层");
    assert(await evaluate(`document.querySelector('#versionBody [data-vd-tab="overview"]').classList.contains("on")`),
      "关闭构成弹层后离开了概览页");
    pass("Esc 关闭构成弹层，返回概览");

    /* 13b-4 分支：漏斗联动本版本工作项，名字开分支抽屉 */
    const brInfo = await evaluate(`(() => {
      const wrap = document.querySelector("#versionBody .vd-branch-wrap");
      if(!wrap) return null;
      const name = wrap.querySelector(".vd-branch");
      const funnel = wrap.querySelector(".vd-funnel");
      return { id: name.getAttribute("data-vd-branch"), name: name.querySelector("span").textContent.trim(),
        count: Number((name.querySelector("b").textContent.match(/\\d+/) || [])[0]) || 0,
        link: funnel && funnel.getAttribute("data-vd-link") };
    })()`);
    if(brInfo){
      assert(brInfo.link === "branch:" + brInfo.id, "分支漏斗与分支名指向不同实体：" + JSON.stringify(brInfo));
      await evaluate(`document.querySelector("#versionBody .vd-branch-wrap .vd-funnel").click()`);
      await waitFor(`new URLSearchParams(location.hash.split("?")[1] || "").get("br") === ${JSON.stringify(brInfo.id)}`, "分支联动写 hash");
      const brState = await scopeState();
      assert(brState.rows === brInfo.count, `分支联动行数 ${brState.rows} 与分支卡「${brInfo.count} 项」不一致`);
      assert(brState.branches.every(b => b === brInfo.id), "分支联动后仍混入其他分支的工作项：" + JSON.stringify(brState.branches));
      assert(brState.chips.length === 1 && brState.chips[0].indexOf(brInfo.name) > 0, "分支联动条未标出分支名：" + JSON.stringify(brState.chips));
      await shot("11-联动-分支");
      pass(`分支「${brInfo.name}」漏斗联动 → ${brState.rows} 行，全部挂该分支`);
      /* 联动条上的分支名本身也是详情入口 */
      await evaluate(`document.querySelector("#versionBody .vd-linked button.vd-link-v").click()`);
      await waitFor(`!!document.querySelector("#branchDrawer.on")`, "分支抽屉", 20000);
      const brTitle = await evaluate(`document.getElementById("brDrawerTitle").textContent.trim()`);
      assert(brTitle === brInfo.name, `分支抽屉开错实体：「${brTitle}」应为「${brInfo.name}」`);
      await shot("11b-分支抽屉");
      await evaluate(`document.getElementById("brDrawerClose").click()`);
      await waitFor(`!document.querySelector("#branchDrawer.on")`, "分支抽屉关闭");
      pass("联动条分支名 → 分支详情抽屉：" + brTitle);
      noExceptions("分支联动");
      await clearFilters();
    }else{
      pass("该版本工作项未挂分支，分支联动按设计不出现");
    }

    /* 13b-5 需求页：本版本工作项数列的漏斗联动，行名开需求详情 */
    await evaluate(`document.querySelector('#versionBody [data-vd-tab="demands"]').click()`);
    await waitFor(`document.querySelectorAll("#versionBody tr[data-vd-demand]").length > 0`, "已排需求行", 25000);
    const dmInfo = await evaluate(`(() => {
      const row = [...document.querySelectorAll("#versionBody tr[data-vd-demand]")].find(r => r.querySelector(".vd-rel-cell .vd-funnel"));
      if(!row) return null;
      const f = row.querySelector(".vd-rel-cell .vd-funnel");
      return { id: row.getAttribute("data-vd-demand"), title: row.querySelector(".vd-tname").textContent.trim(),
        count: Number((row.querySelector(".vd-rel-cell span").textContent.match(/\\d+/) || [])[0]) || 0,
        link: f.getAttribute("data-vd-link"),
        headers: [...row.closest("table").querySelectorAll("thead th")].map(t => t.textContent.trim()) };
    })()`);
    if(dmInfo){
      assert(dmInfo.headers.indexOf("本版本工作项") >= 0, "需求表缺少本版本工作项列：" + dmInfo.headers.join(","));
      assert(dmInfo.link === "demand:" + dmInfo.id, "需求漏斗指向错实体：" + JSON.stringify(dmInfo));
      await shot("12-需求页联动入口");
      await evaluate(`(() => {
        const row = [...document.querySelectorAll("#versionBody tr[data-vd-demand]")].find(r => r.querySelector(".vd-rel-cell .vd-funnel"));
        row.querySelector(".vd-rel-cell .vd-funnel").click();
        return true;
      })()`);
      await waitFor(`new URLSearchParams(location.hash.split("?")[1] || "").get("dm") === ${JSON.stringify(dmInfo.id)}`, "需求联动写 hash");
      const dmState = await scopeState();
      assert(dmState.rows === dmInfo.count, `需求联动行数 ${dmState.rows} 与需求行「${dmInfo.count} 项」不一致`);
      assert(dmState.demands.every(d => d === dmInfo.id), "需求联动后混入其他需求的工作项：" + JSON.stringify(dmState.demands));
      assert(dmState.chips.length === 1 && dmState.chips[0].indexOf("需求") === 0, "需求联动条缺失：" + JSON.stringify(dmState.chips));
      await shot("12b-联动-需求");
      pass(`需求「${dmInfo.title}」漏斗联动 → ${dmState.rows} 行，全部挂该需求`);
      await evaluate(`document.querySelector("#versionBody .vd-linked button.vd-link-v").click()`);
      await waitFor(`!!document.querySelector(".modal-layer.demand-detail.open")`, "需求详情", 25000);
      const dmTitle = await evaluate(`document.getElementById("demandDetailTitle").textContent.trim()`);
      assert(dmTitle === dmInfo.title, `需求详情开错实体：「${dmTitle}」应为「${dmInfo.title}」`);
      await shot("12c-需求详情");
      await evaluate(`document.querySelector(".modal-layer.demand-detail.open [data-dem-x]").click()`);
      await waitFor(`!document.querySelector(".modal-layer.demand-detail.open")`, "需求详情关闭");
      pass("联动条需求名 → 需求详情：" + dmTitle);
      noExceptions("需求联动");
    }else{
      pass("该版本没有已挂工作项的排期需求，需求联动按设计不出现");
    }

    /* 13b-6 工作项行内关联 chip：需求 / 分支都是详情入口，且不误触发行本身 */
    await clearFilters();
    const relChip = await evaluate(`(() => {
      const d = document.querySelector("#versionBody tbody tr[data-open-task] .vd-rel[data-vd-demand]");
      const b = document.querySelector("#versionBody tbody tr[data-open-task] .vd-rel[data-vd-branch]");
      return { demand: d && d.getAttribute("data-vd-demand"), branch: b && b.getAttribute("data-vd-branch"),
        demandText: d && d.textContent.trim(), branchText: b && b.textContent.trim() };
    })()`);
    assert(relChip.demand || relChip.branch, "工作项行内没有任何关联入口：" + JSON.stringify(relChip));
    if(relChip.demand){
      await evaluate(`document.querySelector("#versionBody tbody tr[data-open-task] .vd-rel[data-vd-demand]").click()`);
      await waitFor(`!!document.querySelector(".modal-layer.demand-detail.open")`, "行内需求 chip 开详情", 25000);
      const opened = await evaluate(`!!document.querySelector("#taskDrawer.on")`);
      assert(!opened, "点需求 chip 同时误开了工作项抽屉");
      await evaluate(`document.querySelector(".modal-layer.demand-detail.open [data-dem-x]").click()`);
      await waitFor(`!document.querySelector(".modal-layer.demand-detail.open")`, "行内需求详情关闭");
      pass("工作项行内需求 chip → 需求详情：" + relChip.demandText);
    }
    if(relChip.branch){
      await evaluate(`document.querySelector("#versionBody tbody tr[data-open-task] .vd-rel[data-vd-branch]").click()`);
      await waitFor(`!!document.querySelector("#branchDrawer.on")`, "行内分支 chip 开详情", 20000);
      await evaluate(`document.getElementById("brDrawerClose").click()`);
      await waitFor(`!document.querySelector("#branchDrawer.on")`, "行内分支详情关闭");
      pass("工作项行内分支 chip → 分支详情：" + relChip.branchText);
    }
    /* 行本身仍然开工作项抽屉，联动入口没有抢走主点击 */
    const rowTitle = await evaluate(`document.querySelector("#versionBody tbody tr[data-open-task] .vd-tname").textContent.trim()`);
    await evaluate(`document.querySelector("#versionBody tbody tr[data-open-task] .vd-tname").click()`);
    await waitFor(`!!document.querySelector("#taskDrawer.on")`, "工作项抽屉", 25000);
    const taskTitle = await evaluate(`document.getElementById("taskDrawerTitle").textContent.trim()`);
    assert(taskTitle === rowTitle, `工作项抽屉开错实体：「${taskTitle}」应为「${rowTitle}」`);
    await evaluate(`document.getElementById("btnCloseTask").click()`);
    await waitFor(`!document.querySelector("#taskDrawer.on")`, "工作项抽屉关闭");
    pass("工作项行主点击仍开工作项详情：" + taskTitle);
    noExceptions("行内关联");

    /* 13b-7 四种联动一起写进 hash：整页重载后明细与联动条都要还原 */
    const combo = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#versionBody tbody tr[data-open-task]")];
      const r = rows.find(x => x.querySelector(".vd-rel[data-vd-demand]")) || rows[0];
      const d = r.querySelector(".vd-rel[data-vd-demand]");
      return { dm: d ? d.getAttribute("data-vd-demand") : "" };
    })()`);
    const comboHash = "#/version?id=" + main.versionId + "&reqId=" + main.reqId + "&tab=scope&sg=dev&sort=actual"
      + (combo.dm ? "&dm=" + combo.dm : "");
    await coldLoad(BASE + "/index.html" + comboHash);
    await waitFor(`document.body.dataset.view === "version"`, "联动深链进入", 25000);
    await waitFor(`(() => {
      const el = document.querySelector('#versionBody [data-vd-filter="sort"]');
      return !!el && el.value === "actual";
    })()`, "联动深链还原筛选", 25000);
    const comboState = await scopeState();
    const comboHashNow = await hashOf();
    assert(comboHashNow.sg === "dev" && comboHashNow.sort === "actual", "联动深链参数丢失：" + JSON.stringify(comboHashNow));
    assert(comboState.chips.some(c => c.indexOf("计时窗口") === 0), "联动深链未还原计时窗口 chip：" + JSON.stringify(comboState.chips));
    if(combo.dm){
      assert(comboHashNow.dm === combo.dm && comboState.demands.every(d => d === combo.dm),
        "联动深链未还原需求约束：" + JSON.stringify(comboState.demands));
      /* 需求清单是异步侧数据：冷启动先渲染明细，名字到位后必须补上，不能永远停在占位 */
      await waitFor(`(() => {
        const v = document.querySelector("#versionBody .vd-linked .vd-link-v");
        return !!v && v.textContent.trim() !== "关联需求";
      })()`, "联动条需求名解析", 25000);
    }
    const comboNamed = await scopeState();
    await shot("13-联动深链还原");
    pass("联动深链冷启动还原：" + comboNamed.chips.join(" / ") + "（" + comboNamed.rows + " 行）");
    /* 清除全部筛选：一次回到全量，hash 里不留残参数 */
    await clearFilters();
    const resetHash = await hashOf();
    assert(!resetHash.cat && !resetHash.br && !resetHash.dm && !resetHash.sg && !resetHash.ow && resetHash.sort === "default",
      "清除全部筛选后 hash 仍有残留：" + JSON.stringify(resetHash));
    const resetState = await scopeState();
    assert(!resetState.chips.length, "清除全部筛选后联动条仍在：" + JSON.stringify(resetState.chips));
    pass("清除全部筛选 → 联动条清空、hash 无残留");
    /* 看板带得走的带走，带不走的如实说明 */
    await navigate(BASE + "/index.html#/version?id=" + main.versionId + "&reqId=" + main.reqId + "&tab=scope&sg=dev");
    await waitFor(`!!document.querySelector("#versionBody [data-vd-board]")`, "看板按钮", 25000);
    await evaluate(`document.querySelector("#versionBody [data-vd-board]").click()`);
    await waitFor(`document.body.dataset.view === "board"`, "跳看板", 25000);
    const boardToast = await evaluate(`[...document.querySelectorAll(".toast, #toast, .toast-item")].map(t => t.textContent.replace(/\\s+/g, " ").trim()).join(" | ")`);
    assert(boardToast.indexOf("计时窗口") >= 0, "看板无法承载计时窗口筛选却没有如实提示：" + boardToast);
    pass("在看板中查看：带不走的筛选如实提示（" + boardToast.slice(0, 60) + "）");
    noExceptions("联动收尾");

    /* 14. 平板与手机布局 */
    await navigate(BASE + "/index.html#/version?id=" + main.versionId + "&reqId=" + main.reqId);
    await waitFor(`document.querySelector("#versionBody .vd-title").textContent.trim() === ${JSON.stringify(main.versionName)}`, "主用例版本", 25000);
    for(const [w, h, mobile, label] of [[1440, 900, false, "桌面"], [1280, 900, false, "窄桌面"], [820, 1180, true, "平板"], [390, 844, true, "手机"]]){
      await size(w, h, mobile);
      for(const key of ["overview", "scope", "releases"]){
        await evaluate(`document.querySelector('#versionBody [data-vd-tab="${key}"]').click()`);
        await waitFor(`document.querySelector('#versionBody [data-vd-tab="${key}"]').classList.contains("on")`, label + " 页签 " + key);
        await sleep(250);
        await layout(label + " " + key);
        await shot(`08-${label}-${key}`);
      }
      const reach = await evaluate(`(() => {
        const back = document.querySelector("#versionBody [data-vd-back]");
        const b = back.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) };
      })()`);
      assert(reach.w > 0 && reach.h >= 28, label + " 返回按钮不可达：" + JSON.stringify(reach));
      pass(`${label} ${w}×${h}：概览 / 工作项 / 发布无横向溢出，返回按钮可点`);
      noExceptions(label + " 布局");
    }
    /* 14b. 手机上带着联动条与行内关联 chip 也不能挤破布局 */
    await size(390, 844, true);
    await navigate(BASE + "/index.html#/version?id=" + main.versionId + "&reqId=" + main.reqId + "&tab=scope&sg=dev"
      + (combo.dm ? "&dm=" + combo.dm : ""));
    await waitFor(`!!document.querySelector("#versionBody .vd-linked")`, "手机联动条", 25000);
    await layout("手机 联动");
    const relReach = await evaluate(`(() => {
      const els = [...document.querySelectorAll("#versionBody .vd-linked .vd-link-x, #versionBody .vd-linked .vd-link-v, #versionBody .vd-linked .btn, #versionBody tbody .vd-rel, #versionBody .vd-funnel")];
      return els.map(el => { const r = el.getBoundingClientRect(); return { c: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(x => x.w > 0 && (x.h < 28 || x.w < 28));
    })()`);
    assert(!relReach.length, "手机上联动控件小到点不中：" + JSON.stringify(relReach.slice(0, 5)));
    await shot("08-手机-联动");
    await evaluate(`document.querySelector('#versionBody [data-vd-tab="overview"]').click()`);
    await waitFor(`document.querySelectorAll("#versionBody .vd-hours-card .vd-hour-side").length === 2`, "手机工时卡");
    await layout("手机 工时卡");
    const hourReach = await evaluate(`(() => {
      const els = [...document.querySelectorAll("#versionBody .vd-hour-main, #versionBody .vd-hour-avg, #versionBody .vd-branch")];
      return els.map(el => { const r = el.getBoundingClientRect(); return { c: el.className, w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(x => x.w > 0 && (x.h < 28 || x.w < 28));
    })()`);
    assert(!hourReach.length, "手机上工时卡控件小到点不中：" + JSON.stringify(hourReach.slice(0, 5)));
    await shot("08-手机-工时卡");
    /* 窄屏构成改为整屏：宽度必须贴合视口，表格不能把页面撑出横向滚动 */
    await evaluate(`document.querySelector('#versionBody [data-vd-hours="estimate"]').click()`);
    await waitFor(`!!document.querySelector(".vd-h-layer.open")`, "手机构成弹层");
    /* 等弹层入场动画结束后再量尺寸，否则量到缩放中的中间帧 */
    await sleep(450);
    const mobileSheet = await evaluate(`(() => {
      const layer = document.querySelector(".vd-h-layer.open");
      const sheet = layer.querySelector(".vd-h-sheet");
      const r = sheet.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), layerW: layer.clientWidth,
        overflow: sheet.scrollWidth - sheet.clientWidth,
        tabs: layer.querySelectorAll("[data-vd-htab]").length };
    })()`);
    assert(Math.abs(mobileSheet.w - mobileSheet.layerW) <= 1, "手机构成弹层没有占满宽度：" + JSON.stringify(mobileSheet));
    assert(mobileSheet.overflow <= 1, "手机构成弹层出现横向滚动：" + mobileSheet.overflow);
    assert(mobileSheet.tabs === 5, "手机构成弹层页签缺失：" + mobileSheet.tabs);
    await shot("08-手机-构成");
    await evaluate(`document.querySelector('.vd-h-layer.open [data-vd-hclose]').click()`);
    await waitFor(`!document.querySelector(".vd-h-layer.open")`, "手机构成关闭");
    pass("手机 390×844：工时卡可点、构成整屏无横向溢出");
    noExceptions("手机联动");
    await call("Emulation.clearDeviceMetricsOverride");

    /* 14c. 长版本说明：超过两行才出展开入口，展开后不被截断 */
    const longDesc = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/cross-project");
      const reqIds = [...new Set((rows || []).map(r => r.reqId))].slice(0, 8);
      for(const reqId of reqIds){
        const data = await API.get("/api/versions/stats", { reqId: reqId });
        const hit = ((data && data.versions) || []).find(v => (v.description || "").length > 120 && v.name);
        if(hit) return { id: hit.id, reqId: reqId, name: hit.name, len: hit.description.length };
      }
      return null;
    })()`);
    if(longDesc){
      await navigate(BASE + "/index.html#/version?id=" + longDesc.id + "&reqId=" + longDesc.reqId);
      await waitFor(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        const b = document.querySelector("#versionBody [data-vd-desc-toggle]");
        return !!p && !!b && !b.hidden;
      })()`, "长说明展开入口", 25000);
      const descBefore = await evaluate(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        return { h: p.getBoundingClientRect().height, clamp: getComputedStyle(p).webkitLineClamp };
      })()`);
      await evaluate(`document.querySelector("#versionBody [data-vd-desc-toggle]").click()`);
      await sleep(150);
      const descAfter = await evaluate(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        const b = document.querySelector("#versionBody [data-vd-desc-toggle]");
        return { open: p.classList.contains("open"), text: b.textContent.trim(), h: p.getBoundingClientRect().height };
      })()`);
      assert(descBefore.clamp === "2", "长说明默认不是两行折叠：" + descBefore.clamp);
      assert(descAfter.open && descAfter.text === "收起说明" && descAfter.h > descBefore.h + 2,
        "长说明展开失败：" + JSON.stringify({ descBefore, descAfter }));
      await shot("10-长说明展开");
      await evaluate(`document.querySelector("#versionBody [data-vd-desc-toggle]").click()`);
      await sleep(150);
      const descClosed = await evaluate(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        const b = document.querySelector("#versionBody [data-vd-desc-toggle]");
        return { open: p.classList.contains("open"), text: b.textContent.trim(), h: p.getBoundingClientRect().height };
      })()`);
      assert(!descClosed.open && descClosed.text === "展开说明" && descClosed.h <= descBefore.h + 1,
        "长说明收起失败：" + JSON.stringify(descClosed));
      pass("长版本说明两行折叠，可展开 / 收起：" + longDesc.name + "（" + longDesc.len + " 字）");
    } else {
      /* 演示库没有超长说明：注入探针，验证折叠态下展开 / 收起的代码路径 */
      const descProbe = await evaluate(`(() => {
        const p = document.querySelector("#versionBody [data-vd-desc]");
        const btn = document.querySelector("#versionBody [data-vd-desc-toggle]");
        if(!p || !btn) return null;
        p.textContent = "超长说明探针：" + "支付网关退款与对账链路收口，涉及回调幂等、差错处理与按渠道汇总。".repeat(20);
        p.style.maxWidth = "300px";
        const before = { h: p.getBoundingClientRect().height, clamp: getComputedStyle(p).webkitLineClamp };
        btn.click();
        const after = { h: p.getBoundingClientRect().height, open: p.classList.contains("open"), text: btn.textContent.trim() };
        btn.click();
        const closed = { h: p.getBoundingClientRect().height, open: p.classList.contains("open"), text: btn.textContent.trim() };
        return { before, after, closed };
      })()`);
      assert(descProbe, "版本说明区或展开按钮缺失");
      assert(descProbe.before.clamp === "2", "说明默认不是两行折叠：" + descProbe.before.clamp);
      assert(descProbe.after.open && descProbe.after.text === "收起说明" && descProbe.after.h > descProbe.before.h + 2,
        "说明展开失败：" + JSON.stringify(descProbe));
      assert(!descProbe.closed.open && descProbe.closed.text === "展开说明" && descProbe.closed.h <= descProbe.before.h + 1,
        "说明收起失败：" + JSON.stringify(descProbe));
      pass("演示库没有超长版本说明，注入探针验证展开 / 收起（" + descProbe.before.h + "px → " + descProbe.after.h + "px）");
    }

    /* 15. 不存在的版本：给可解释的空态而不是白屏 */
    await navigate(BASE + "/index.html#/version?id=__not_exist__&reqId=" + main.reqId);
    await waitFor(`document.body.dataset.view === "version"`, "坏 id 进入");
    await waitFor(`(() => {
      const b = document.querySelector("#versionBody .vd-body");
      return !!b && b.textContent.indexOf("版本不可用") >= 0;
    })()`, "坏 id 空态", 25000);
    await shot("09-坏id空态");
    await evaluate(`document.querySelector("#versionBody [data-empty-action]").click()`);
    await waitFor(`document.body.dataset.view === "phase"`, "空态返回版本列表");
    pass("不存在的版本 → 可解释空态 + 返回版本列表");

    noExceptions("收尾");
    console.log("\n结果：全部通过\n截图目录：" + SHOTS);
  }finally{
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    child.kill();
  }
}

main().catch(err => { console.error("\n失败：" + err.message); process.exit(1); });