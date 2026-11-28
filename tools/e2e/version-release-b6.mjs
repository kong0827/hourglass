/* B6 首进欢迎卡 + 9 步 tour + 发布计划列表 P0 对齐 + 390 适配：
   ① 首次打开自动欢迎卡（sl-tour-v1 只出现一次）、?tour=1 强制欢迎、?tour=2 直接分步指引；
   ② 9 步指引逐步骤高亮真实元素，←/→/Esc/跳过可用，完成写标记，右下 ? 可重播；
   ③ 发布计划列表：默认时间窗未来 90 天、导出排期 CSV、环境/状态 pill、已完成行成功时间；
   ④ 390：计划表格卡片化、向导吸底按钮让开 tabbar、AI 悬浮球不与吸底按钮重叠。
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/version-release-b6.mjs */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-b6-"));
const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-b6-dl-"));

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-b6-chrome-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });
  let cdp, evaluate, waitFor, shot, shotView, navigate;
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
    try{ await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS, eventsEnabled: true }); }
    catch(e){ await call("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS }); }
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
    navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "加载 " + url, 25000);
    };
    shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    shotView = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };

    console.log("B6 欢迎卡/tour/P0/390 走查\n  地址：" + BASE + "\n  截图：" + SHOTS);

    /* ---------- 登录（全新 profile：localStorage 为空） ---------- */
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

    /* ---------- ① 引导只在版本域自动出现 ---------- */
    await sleep(1200);
    assert(await evaluate(`document.querySelector("#welcomeMask").hidden`), "登录后落在非版本视图不自动弹欢迎卡");
    assert(await evaluate(`getComputedStyle(document.querySelector("#tourReplay")).display === "none"`), "非版本视图不显示重播入口");
    pass("非版本视图不弹版本引导");
    await navigate(BASE + "/index.html#/testcases");
    await waitFor(`document.body.dataset.view === "testcases"`, "进入测试域", 15000);
    await sleep(1200);
    assert(await evaluate(`document.querySelector("#welcomeMask").hidden`), "测试域不自动弹版本欢迎卡");
    assert(await evaluate(`getComputedStyle(document.querySelector("#tourReplay")).display === "none"`), "测试域不显示版本重播入口");
    pass("测试域不弹版本引导");
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "进入版本域", 15000);
    await waitFor(`!!document.querySelector("#welcomeMask") && !document.querySelector("#welcomeMask").hidden`, "版本域自动欢迎卡", 8000);
    const wc = await evaluate(`(() => {
      const m = document.querySelector("#welcomeMask");
      const steps = [...m.querySelectorAll(".wc-steps .ws")].map(s => ({
        t: (s.querySelector(".t") || {}).textContent || "",
        n: (s.querySelector(".n") || {}).textContent || ""
      }));
      return {
        title: (m.querySelector(".wc-title") || {}).textContent || "",
        sum: (m.querySelector(".wc-sub") || {}).textContent || "",
        steps,
        tips: m.querySelectorAll(".wc-tips > div").length,
        start: (m.querySelector("[data-wc-start]") || {}).textContent || "",
        skip: (m.querySelector("[data-wc-skip]") || {}).textContent || "",
        seen: localStorage.getItem("sl-tour-v1"),
        locked: document.body.classList.contains("tour-lock")
      };
    })()`);
    assert(/欢迎来到/.test(wc.title) && wc.steps.length === 4, "欢迎卡含 4 步闭环：" + wc.steps.map(s => s.n + s.t).join(" → "));
    assert(wc.steps.map(s => s.t).join(",") === "建版本,做发布计划,记录发布,生成交付说明", "四步文案与原型一致");
    assert(wc.tips === 3 && /跳过/.test(wc.skip) && /开始/.test(wc.start), "3 条提示 + 跳过/开始按钮");
    assert(wc.seen === "1", "自动欢迎后写入 sl-tour-v1（只出现一次）");
    assert(wc.locked, "欢迎卡打开时锁定页面滚动");
    await shotView("b6-welcome-1440");

    await evaluate(`(() => { document.querySelector("[data-wc-skip]").click(); return true; })()`);
    await waitFor(`document.querySelector("#welcomeMask").hidden`, "欢迎卡关闭");
    assert(await evaluate(`!document.body.classList.contains("tour-lock")`), "跳过欢迎后解除滚动锁");
    assert(await evaluate(`getComputedStyle(document.querySelector("#tourReplay")).display !== "none"`), "版本域显示重播入口");
    pass("版本域显示重播入口");
    await navigate(BASE + "/index.html#/phase");
    await waitFor(`document.body.dataset.view && !document.querySelector("#welcomeMask").hidden === false`, "再次进入应用", 20000);
    await sleep(1200);
    assert(await evaluate(`document.querySelector("#welcomeMask").hidden`), "刷新后不再自动弹欢迎卡");

    /* ---------- ② ?tour=1 强制欢迎 → Esc 关闭 ---------- */
    await navigate(BASE + "/index.html?tour=1#/phase");
    await waitFor(`!document.querySelector("#welcomeMask").hidden`, "强制欢迎卡", 8000);
    pass("?tour=1 强制弹出欢迎卡");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
    await waitFor(`document.querySelector("#welcomeMask").hidden`, "Esc 关闭欢迎卡");
    pass("Esc 可关闭欢迎卡");

    /* ---------- ③ 右下 ? 重播 → 开始 9 步指引 ---------- */
    const replay = await evaluate(`(() => {
      const b = document.querySelector("#tourReplay");
      if(!b) return null;
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), visible: r.width > 0 && r.height > 0 };
    })()`);
    assert(!!replay && replay.visible && replay.text === "?", "右下角常驻 ? 重播入口");
    await evaluate(`(() => { document.querySelector("#tourReplay").click(); return true; })()`);
    await waitFor(`!document.querySelector("#welcomeMask").hidden`, "重播欢迎卡");
    pass("? 重播打开欢迎卡");

    const EXPECT = [
      ["发布计划有独立入口", true],
      ["计划列表 —— 跨项目统一排期", true],
      ["范围可切「全部项目 / 项目集 / 单项目」", true],
      ["下一步清单 —— 照做即可", true],
      ["工作项与需求", true],
      ["发布计划（日程存计划）", true],
      ["发布记录（记录存事实）", true],
      ["交付说明", true],
      ["轮到你了", false]
    ];
    await evaluate(`(() => { document.querySelector("[data-wc-start]").click(); return true; })()`);
    await waitFor(`!document.querySelector("#tourMask").hidden && document.querySelector("#tourTitle").textContent.length > 0`, "分步指引打开", 8000);
    pass("从欢迎卡进入分步指引");
    assert(await evaluate(`!!document.activeElement.closest("#tourCard")`), "打开指引后焦点进入指引卡");
    for(const type of ["keyDown", "keyUp"]){
      await call("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    }
    await sleep(150);
    assert(await evaluate(`!!document.activeElement.closest("#tourCard")`), "Tab 焦点限制在指引卡内");
    await sleep(1000);
    await shotView("b6-tour-step1-1440");

    for(let i = 0; i < EXPECT.length; i++){
      const [title, hasTarget] = EXPECT[i];
      await waitFor(`document.querySelector("#tourTitle").textContent === ${JSON.stringify(title)}`, "步骤 " + (i + 1) + "_标题", 15000);
      /* 换步会先收起旧描边；等到本步描边真正画出再测量，避免量到上一步的框 */
      if(hasTarget){
        await waitFor(`(() => { const b = document.querySelector("#tourBox"); if(b.hidden) return false; const r = b.getBoundingClientRect(); return r.width > 20 && r.height > 12; })()`, "步骤 " + (i + 1) + "_描边", 15000);
      }
      const st = await evaluate(`(() => {
        const mask = document.querySelector("#tourMask"), box = document.querySelector("#tourBox");
        const card = document.querySelector("#tourCard");
        const cr = card.getBoundingClientRect();
        return {
          counter: (document.querySelector("#tourStep") || {}).textContent || "",
          boxHidden: box.hidden,
          boxW: Math.round(box.getBoundingClientRect().width),
          boxH: Math.round(box.getBoundingClientRect().height),
          cardInView: cr.left >= 0 && cr.top >= 0 && cr.right <= innerWidth + 1 && cr.bottom <= innerHeight + 1,
          next: (document.querySelector("#tourNext") || {}).textContent || "",
          dots: document.querySelectorAll("#tourDots i").length,
          onDot: document.querySelectorAll("#tourDots i.on").length,
          view: document.body.dataset.view,
          hash: location.hash,
          nextPanel: document.querySelectorAll(".vd-next-panel").length,
          guide: document.querySelectorAll(".vd-empty-guide").length,
          vdTabs: document.querySelectorAll(".vd-tabs").length,
          vbHead: (document.querySelector("#versionBody") || {}).textContent ? document.querySelector("#versionBody").textContent.replace(/\\s+/g, " ").trim().slice(0, 80) : ""
        };
      })()`);
      if(i === 3 && (st.boxHidden || st.boxW === 0)) console.log("  步骤4诊断：" + JSON.stringify(st));
      if(i === 7) console.log("  步骤8诊断：" + JSON.stringify(await evaluate(`(() => {
        const pick = s => { const el = document.querySelector(s); if(!el) return null; const r = el.getBoundingClientRect(); return { w:Math.round(r.width), h:Math.round(r.height), top:Math.round(r.top) }; };
        const box = document.querySelector("#tourBox").getBoundingClientRect();
        return { hash: location.hash, view: document.body.dataset.view, dlHead: pick("#deliveryBody .dl-head"), dlBody: pick("#deliveryBody"), box: { w:Math.round(box.width), h:Math.round(box.height) } };
      })()`)));
      assert(st.counter === "步骤 " + (i + 1) + " / 9" && st.dots === 9 && st.onDot === 1,
        "步骤 " + (i + 1) + " 计数/圆点：" + st.counter);
      if(hasTarget) assert(!st.boxHidden && st.boxW > 20 && st.boxH > 12, "步骤 " + (i + 1) + " 高亮描边 " + st.boxW + "×" + st.boxH);
      else assert(st.boxHidden, "步骤 9 无高亮，居中收尾卡");
      assert(st.cardInView, "步骤 " + (i + 1) + " 说明卡在视口内");
      if(i === 2) await shotView("b6-tour-step3-1440");
      if(i === 3) await shotView("b6-tour-step4-1440");
      if(i === 4) await shotView("b6-tour-step5-1440");
      if(i === 5) await shotView("b6-tour-step6-1440");
      if(i === 6) await shotView("b6-tour-step7-1440");
      if(i === 7) await shotView("b6-tour-step8-1440");
      if(i === 8){
        await waitFor(`document.querySelector("#tourBox").hidden`, "收尾卡隐藏描边", 6000);
        assert(/完成/.test(st.next), "末步主按钮「完成，开始操作」");
        await shotView("b6-tour-step9-1440");
      }
      if(i < EXPECT.length - 1){
        await evaluate(`(() => { document.querySelector("[data-tour-next]").click(); return true; })()`);
        await sleep(250);
      }
    }

    await evaluate(`(() => { document.querySelector("[data-tour-next]").click(); return true; })()`);
    await waitFor(`document.querySelector("#tourMask").hidden`, "指引结束");
    assert(await evaluate(`localStorage.getItem("sl-tour-v1") === "1"`), "走完 9 步写入 sl-tour-v1");

    /* ---------- ④ 键盘：→ / ← / Esc ---------- */
    await evaluate(`(() => { document.querySelector("#tourReplay").click(); return true; })()`);
    await waitFor(`!document.querySelector("#welcomeMask").hidden`, "再次重播");
    await evaluate(`(() => { document.querySelector("[data-wc-start]").click(); return true; })()`);
    await waitFor(`document.querySelector("#tourStep").textContent === "步骤 1 / 9"`, "键盘用例起点", 8000);
    await sleep(300);
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
    await waitFor(`document.querySelector("#tourStep").textContent === "步骤 2 / 9"`, "→ 下一步", 8000);
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`);
    await waitFor(`document.querySelector("#tourStep").textContent === "步骤 3 / 9"`, "→ 再下一步", 8000);
    pass("键盘 → 可前进");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); true`);
    await waitFor(`document.querySelector("#tourStep").textContent === "步骤 2 / 9" && document.querySelector("#tourTitle").textContent === "计划列表 —— 跨项目统一排期"`, "← 上一步", 8000);
    pass("键盘 ← 可后退，标题同步");
    await evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`);
    await waitFor(`document.querySelector("#tourMask").hidden`, "Esc 结束指引");
    pass("Esc 可结束指引");

    /* ---------- ⑤ 发布计划列表：默认时间窗 / pill / 导出 / 收口时间 ---------- */
    await navigate(BASE + "/index.html#/release");
    await waitFor(`document.body.dataset.view === "release" && !!document.querySelector(".pl-table tbody tr[data-plan-row]")`, "发布计划列表", 25000);
    await sleep(600);
    const list = await evaluate(`(() => {
      const time = document.querySelector("[data-rel-list-time]");
      const rows = [...document.querySelectorAll(".pl-table tbody tr[data-plan-row]")];
      const now = Date.now(), day = 86400000;
      const overshoot = rows.filter(tr => {
        const txt = tr.textContent;
        if(/已完成|已取消/.test(txt)) return false;
        const win = tr.querySelector(".pl-win");
        const t = win ? new Date(win.textContent.trim().replace(" ", "T") + ":00").getTime() : NaN;
        return !isNaN(t) && t > now + 90 * day;
      }).length;
      const done = rows.filter(tr => tr.querySelector(".pl-pill") && /已完成/.test(tr.querySelector(".pl-pill").textContent))[0];
      return {
        time: time ? time.value : "",
        timeLabel: time ? time.options[time.selectedIndex].textContent : "",
        rows: rows.length,
        statusPills: rows.filter(tr => tr.querySelector(".pl-pill .dot")).length,
        envPills: document.querySelectorAll(".pl-table .rel-env.is-production, .pl-table .rel-env.is-staging, .pl-table .rel-env.is-test").length,
        doneRow: done ? {
          actual: (done.querySelector(".pl-actual") || {}).textContent || "",
          win: (done.querySelector(".pl-win") || {}).textContent || ""
        } : null,
        empty: !!document.querySelector(".allv-empty"),
        exportBtn: !!document.querySelector("#pageActions [data-rel-list-export]"),
        headCols: document.querySelectorAll(".pl-table thead th").length,
        overshoot
      };
    })()`);
    assert(list.time === "next90" && /未来 90 天/.test(list.timeLabel), "默认时间窗为未来 90 天");
    assert(list.rows > 0 && !list.empty, "列表渲染 " + list.rows + " 份计划");
    assert(list.overshoot === 0, "默认时间窗下没有超出 90 天的未收口计划");
    assert(list.statusPills === list.rows, "每行状态都是带圆点的 pill（" + list.statusPills + "/" + list.rows + "）");
    assert(list.envPills === list.rows, "环境列渲染为带底色的 pill（" + list.envPills + "/" + list.rows + "）");
    assert(list.exportBtn && list.headCols === 8, "页头「导出排期」按钮 + 8 列表格");
    await shot("b6-plan-list-1440");

    /* 演示库当前没有生产成功记录，用同形状 API 夹具验证「已完成 + 收口时间」渲染与筛选 */
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const { showView } = await import("./js/core/router.js");
      window.__b6origGet = API.get;
      API.get = function(path, params){
        return window.__b6origGet.call(API, path, params).then(function(rows){
          if(path === "/api/release-plans" && Array.isArray(rows)){
            return rows.map(function(r, i){
              if(i !== 0) return r;
              return Object.assign({}, r, { status:"completed", statusName:"已完成", completedAt:"2026-11-28T07:37:00" });
            });
          }
          return rows;
        });
      };
      await showView("phase");
      await showView("release");
      return true;
    })()`);
    await waitFor(`(() => {
      const tr = [...document.querySelectorAll(".pl-table tbody tr[data-plan-row]")].filter(x => x.querySelector(".pl-pill") && /已完成/.test(x.querySelector(".pl-pill").textContent))[0];
      return !!(tr && tr.querySelector(".pl-actual"));
    })()`, "收口时间渲染", 15000);
    const fixtured = await evaluate(`(() => {
      const tr = [...document.querySelectorAll(".pl-table tbody tr[data-plan-row]")].filter(x => x.querySelector(".pl-pill") && /已完成/.test(x.querySelector(".pl-pill").textContent))[0];
      return (tr.querySelector(".pl-actual") || {}).textContent || "";
    })()`);
    assert(/^\d{2}-\d{2} \d{2}:\d{2} 成功$/.test(fixtured), "已完成行渲染生产成功收口时间（API 夹具）：" + fixtured);
    await evaluate(`(() => { document.querySelector('[data-rel-list-status="completed"]').click(); return true; })()`);
    await sleep(300);
    const completedView = await evaluate(`(() => {
      const rows = [...document.querySelectorAll(".pl-table tbody tr[data-plan-row]")];
      return { n: rows.length, allDone: rows.length > 0 && rows.every(tr => /已完成/.test(tr.textContent)) };
    })()`);
    assert(completedView.n >= 1 && completedView.allDone, "状态筛选「已完成」只列已收口计划（" + completedView.n + "）");
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const { showView } = await import("./js/core/router.js");
      if(window.__b6origGet){ API.get = window.__b6origGet; delete window.__b6origGet; }
      await showView("phase");
      await showView("release");
      return true;
    })()`);
    await waitFor(`!!document.querySelector(".pl-table tbody tr[data-plan-row]") || !!document.querySelector(".allv-empty")`, "还原列表", 15000);
    await evaluate(`(() => { const b = document.querySelector('[data-rel-list-status="all"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".pl-table tbody tr[data-plan-row]") && document.querySelector('[data-rel-list-status="all"]').getAttribute("aria-pressed") === "true"`, "还原全部计划", 15000);
    await sleep(300);

    /* 导出当前列表 */
    await evaluate(`(() => { document.querySelector("#pageActions [data-rel-list-export]").click(); return true; })()`);
    await waitFor(`(() => { const t = document.querySelector(".toast"); return !!(t && /已导出 \\d+ 份计划排期/.test(t.textContent)); })()`, "导出提示", 8000);
    const toastText = await evaluate(`document.querySelector(".toast").textContent.trim()`);
    pass("导出提示：" + toastText);
    let csvFile = null;
    for(let i = 0; i < 40 && !csvFile; i++){
      const files = fs.readdirSync(DOWNLOADS).filter(f => /^发布计划排期-\d{8}\.csv$/.test(f));
      if(files.length) csvFile = path.join(DOWNLOADS, files[0]);
      else await sleep(150);
    }
    assert(!!csvFile, "下载到 CSV：" + (csvFile ? path.basename(csvFile) : "无"));
    if(csvFile){
      const csv = fs.readFileSync(csvFile, "utf8");
      const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      assert(/^计划,计划编号,覆盖版本,项目,环境,计划窗口,就绪检查,执行人,状态,收口时间,更新时间$/.test(lines[0]), "CSV 表头含收口时间：" + lines[0]);
      assert(lines.length - 1 === list.rows, "CSV 行数与列表一致（" + (lines.length - 1) + "/" + list.rows + "）");
    }

    /* ---------- ⑥ 390：计划表格卡片化 + 向导吸底 ---------- */
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await call("Emulation.setTouchEmulationEnabled", { enabled: true });
    await navigate(BASE + "/index.html#/release");
    await waitFor(`document.body.dataset.layout === "mobile" && !!document.querySelector(".pl-table tbody tr[data-plan-row]")`, "390 计划列表", 25000);
    await sleep(500);
    const mob = await evaluate(`(() => {
      const table = document.querySelector(".pl-table");
      const tr = table.querySelector("tbody tr[data-plan-row]");
      const tds = [...tr.querySelectorAll("td")];
      return {
        thead: getComputedStyle(table.querySelector("thead")).display,
        trDisplay: getComputedStyle(tr).display,
        cols: getComputedStyle(tr).gridTemplateColumns.split(" ").length,
        labels: tds.map(td => td.getAttribute("data-l")).join("|"),
        labelsShown: tds.every(td => getComputedStyle(td, "::before").content.indexOf(td.getAttribute("data-l")) !== -1 || getComputedStyle(td, "::before").content !== "none"),
        overflow: document.documentElement.scrollWidth - innerWidth,
        tabbar: (() => { const t = document.querySelector("#tabBar"); return t ? getComputedStyle(t).display : "无"; })()
      };
    })()`);
    assert(mob.thead === "none" && mob.trDisplay === "grid" && mob.cols === 2,
      "390 表格卡片化：表头隐藏、行变 2 列栅格（" + mob.trDisplay + " / " + mob.cols + " 列）");
    assert(mob.labels === "计划|覆盖版本|环境|计划窗口|就绪检查|执行人|状态|操作", "卡片保留 8 个字段标签：" + mob.labels);
    assert(mob.overflow <= 1, "390 无横向溢出（scrollWidth - innerWidth = " + mob.overflow + "）");
    assert(mob.tabbar !== "none", "移动端底部 tabbar 可见");
    const mobHead = await evaluate(`(() => {
      const top = document.querySelector(".topbar").getBoundingClientRect();
      const acts = document.querySelector("#pageActions").getBoundingClientRect();
      const kpis = document.querySelector(".pl-kpis").getBoundingClientRect();
      return {
        topBottom: Math.round(top.bottom), actTop: Math.round(acts.top), actBottom: Math.round(acts.bottom), kpiTop: Math.round(kpis.top),
        labels: [...document.querySelectorAll("#pageActions .btn")].map(b => b.textContent.trim()).join("|")
      };
    })()`);
    assert(mobHead.actTop >= mobHead.topBottom && mobHead.actBottom <= mobHead.kpiTop,
      "390 页头操作行落在顶栏与 KPI 之间（" + mobHead.actTop + "–" + mobHead.actBottom + " / 顶栏到 " + mobHead.topBottom + "，KPI 起 " + mobHead.kpiTop + "）");
    assert(/导出排期/.test(mobHead.labels) && /新建发布计划/.test(mobHead.labels), "390 保留导出/新建两个页级操作：" + mobHead.labels);
    await waitFor(`!document.querySelector("#toastWrap .toast")`, "导出提示消失", 8000).catch(() => null);
    await shot("b6-plan-list-390");

    await navigate(BASE + "/index.html#/plan-wizard?from=plans");
    await waitFor(`document.body.dataset.view === "plan-wizard" && !!document.querySelector(".pw-foot")`, "390 向导", 25000);
    await sleep(700);
    const wizMob = await evaluate(`(() => {
      const foot = document.querySelector(".pw-foot");
      const fab = document.querySelector(".ai-fab");
      const fr = foot.getBoundingClientRect();
      const fabCs = fab ? getComputedStyle(fab) : null;
      const footCs = getComputedStyle(foot);
      return {
        bottom: footCs.bottom,
        footTop: Math.round(fr.top), footBottom: Math.round(fr.bottom),
        innerH: innerHeight,
        fabDisplay: fabCs ? fabCs.display : "无",
        fabBottom: fab ? Math.round(fab.getBoundingClientRect().bottom) : null,
        overlapping: !!(fab && fabCs.display !== "none" && fab.getBoundingClientRect().top < fr.bottom && fab.getBoundingClientRect().bottom > fr.top)
      };
    })()`);
    assert(parseFloat(wizMob.bottom) >= 40, "390 向导吸底按钮抬到 tabbar 之上（bottom=" + wizMob.bottom + "）");
    assert(wizMob.footBottom <= wizMob.innerH - 40, "吸底按钮完整可见且让开底部 tabbar（" + wizMob.footTop + "–" + wizMob.footBottom + " / " + wizMob.innerH + "）");
    assert(wizMob.fabDisplay === "none" && !wizMob.overlapping, "向导页隐藏 AI 悬浮球，不与吸底按钮重叠");
    await shot("b6-wizard-390");

    /* 计划列表 390 下 FAB 与列表底部不重叠由布局决定；这里只确认 FAB 不在移动端出现 */
    await navigate(BASE + "/index.html#/release");
    await waitFor(`document.body.dataset.layout === "mobile" && !!document.querySelector(".pl-table")`, "回到 390 计划列表", 20000);
    await sleep(400);
    const fabMob = await evaluate(`(() => {
      const fab = document.querySelector(".ai-fab");
      if(!fab) return "无";
      const cs = getComputedStyle(fab);
      return cs.display + "/" + Math.round(fab.getBoundingClientRect().width);
    })()`);
    console.log("  390 计划列表 AI 悬浮球：" + fabMob);

    const bad = cdp.takeExceptions();
    assert(bad.length === 0, "无前端异常" + (bad.length ? "：" + JSON.stringify(bad.slice(0, 2)) : ""));

    console.log(`\n通过 ${passed}，失败 ${failed}\n截图：${SHOTS}\n下载：${DOWNLOADS}`);
    if(failed) process.exitCode = 1;
  } finally{
    try{ await cdp.send("Browser.close"); }catch(e){ /* noop */ }
    child.kill("SIGKILL");
  }
}

main().catch(ex => { console.error(ex.stack || ex.message); process.exit(1); });
