/* 全站页面与 2026-11-19 全站改版原型的样式一致性走查
   用法：node tools/e2e/site-consistency-audit.mjs [视图...]
   产物：docs/audit/site-prototype-alignment-2026-11-20/
     - shots/<view>-1440.png（每页截图）
     - metrics.json（壳层、页头、工具条、按钮、卡片、表格的计算样式）
   说明：只做度量与截图，不改数据；页面缺数据时记录空/错态样式。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/site-prototype-alignment-2026-11-20");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const ALL = [
  "mine", "board", "list", "tree", "chain", "calendar", "gantt",
  "projects", "portfolio", "phase", "release", "delivery", "demands",
  "requirements", "testcases", "branches", "review", "analysis", "report",
  "investment", "workload", "risks", "messages", "settings", "profile",
  "testcases@cases", "testcases@defects", "testcases@plans", "testcases@coverage", "testcases@report",
  "analysis@stats", "analysis@completions", "analysis@flow",
  "settings@space", "settings@members", "settings@workflow", "settings@integration",
  "settings@data", "settings@platform", "settings@visibility",
  "mine@pending", "mine@created", "mine@watched"
];
const views = process.argv.slice(2).filter(a => !a.startsWith("-"));
const list = views.length ? views : ALL;

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

const port = 9228;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-audit-"));
const proc = spawn(findChrome(), [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

const results = [];
let ws = null;
let failed = false;
try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
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
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
  };
  const login = async () => {
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
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);
  };

  const measure = () => evaluate(`(() => {
    const view = document.querySelector(".view.on");
    if(!view) return { error: "no active view" };
    const cs = el => el ? getComputedStyle(el) : null;
    const px = v => Math.round(parseFloat(v || "0") * 10) / 10;
    const rect = el => el ? el.getBoundingClientRect() : null;
    const num = el => el ? Math.round(el.getBoundingClientRect().height) : null;
    const visible = el => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const first = (sel, root) => [...(root || view).querySelectorAll(sel)].find(visible) || null;
    const all = (sel, root) => [...(root || view).querySelectorAll(sel)].filter(visible);
    const style = el => {
      if(!el) return null;
      const s = cs(el);
      return { h: Math.round(el.getBoundingClientRect().height), fs: px(s.fontSize), fw: s.fontWeight, r: s.borderRadius,
        bg: s.backgroundColor, bd: s.borderColor, c: s.color };
    };
    const ph = document.getElementById("pageHead") || document.querySelector(".pagehead");
    const h1 = document.getElementById("pageTitle") || (ph && ph.querySelector("h1"));
    const sub = document.getElementById("pageSub") || (ph && ph.querySelector(".sub"));
    const primaries = all(".btn.primary", document);
    /* 表格取「可见、有列头、行最多」的一张，避开隐藏的筛选/布局表格 */
    const tables = [...view.querySelectorAll("table")].filter(t => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && t.querySelectorAll("tbody tr").length > 0;
    }).sort((a,b) => b.querySelectorAll("tbody tr").length - a.querySelectorAll("tbody tr").length);
    const table = tables[0] || null;
    const th = table && [...table.querySelectorAll("thead th")].find(visible);
    const tds = table ? [...table.querySelectorAll("tbody tr:not(.grp) td")].filter(visible) : [];
    const td = tds[0] || null;
    const cards = all(".card, .mw-sec, .panel, .kpi, .dsec");
    const card = cards[0] || null;
    /* 工具条可能挂在 .view 之外（如全局 #filterbar 按 body[data-view] 显示），按文档级取可见项 */
    const toolbars = all(".page-toolbar, .filterbar, .mw-toolbar, .analysis-bar, .project-toolbar, .manager-toolbar", document);
    const sels = all(".sel, .mw-pop > summary, .mw-search, .kw, .btn.sm");
    const onSelectors = [".mw-chip[aria-pressed='true']", ".sel.on", ".seg button.on", ".qchip.on", ".mw-tab[aria-selected='true']", ".wc-tab.on", ".vd-tab.on", ".subnav-item.on"];
   let selsOn = [], selOnPick = "";
    for(const s of onSelectors){
      const hits = all(s);
      if(hits.length){ selsOn = hits; selOnPick = s; break; }
    }
    const chip = all(".mw-chip").find(el => el.getAttribute("aria-pressed") !== "true") || null;
    const tab = first(".mw-tab, .wc-tab, .vd-tab");
    const tabOn = first(".mw-tab[aria-selected='true'], .wc-tab.on, .vd-tab.on");
    const side = document.querySelector(".sidebar, aside.sidebar, .side");
    const nav = document.querySelector(".side-nav, .nav");
    const navItem = nav && nav.querySelector(".nav-item");
    const navOn = nav && nav.querySelector(".nav-item.on");
    const navSec = nav && nav.querySelector(".nav-sec, .navg");
    const navSub = nav && nav.querySelector(".nav-sub-item");
    const top = document.querySelector(".topbar, .top");
    const solid = [...document.querySelectorAll("body button, body .btn, body .chip, body .badge, body .mw-chip")]
      .filter(el => visible(el) && cs(el).backgroundColor === "rgb(37, 99, 235)").length;
    return {
      view: document.body.dataset.view,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      title: (h1 || {}).textContent || "",
      sub: (sub || {}).textContent || "",
      h1: style(h1), subStyle: style(sub),
      primary: style(primaries[0]),
      primaryCount: primaries.length,
      toolbar: style(toolbars[0]), toolbarCount: toolbars.length,
      card: style(card),
      th: style(th), td: style(td), tableRows: table ? table.querySelectorAll("tbody tr").length : 0,
      sel: style(sels[0]), selOn: style(selsOn[0]), selCount: sels.length,
      selOnPick, chip: style(chip), tab: style(tab), tabOn: style(tabOn),
      sideW: side ? Math.round(rect(side).width) : null,
      topH: num(top),
      navItem: style(navItem), navOn: style(navOn), navSec: style(navSec), navSub: style(navSub),
      solidBlue: solid,
      emptyOrError: !!(first(".mw-bigstate") || first(".empty") || first(".empty-state") || first(".error-state")),
      h: view.scrollHeight
    };
  })()`);

  console.log("全站样式一致性走查\n  地址：" + BASE);
  await login();
  /* 页签状态：view@tab。页签都用 DOM 点击切换，避免深链参数分叉 */
  const tabSelector = (view, tab) => {
    if(view === "mine") return `#mineTabs .mw-tab[data-tab="${tab}"]`;
    if(view === "settings") return `.nav-sub-item[data-view="settings"][data-set-nav="${tab}"]`;
    return `#subNav .subnav-item[data-sub-view="${view}"][data-sub-tab="${tab}"]`;
  };
  for(const entry of list){
    const [view, tab] = entry.split("@");
    try{
      await call("Page.navigate", { url: BASE + "/#/" + view });
      await waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, "进入 " + view, 15000);
      await sleep(900);
      if(tab){
        await evaluate(`(() => {
          const b = document.querySelector(${JSON.stringify(tabSelector(view, tab))});
          if(!b) return false;
          b.click();
          return true;
        })()`).then(ok => { if(!ok) throw new Error("找不到页签 " + tab); });
        await sleep(900);
      }
      const m = await measure();
      m.route = entry;
      if(tab) m.tabKey = tab;
      results.push(m);
      await shot(entry.replace("@", "-") + "-1440.png");
      console.log("  " + entry.padEnd(20) + " h1=" + (m.h1 ? m.h1.fs + "/" + m.h1.fw : "-") +
        " sub=" + (m.subStyle ? m.subStyle.fs : "-") +
        " tb=" + (m.toolbar ? m.toolbar.h + "@" + m.toolbar.r : "-") +
        " th=" + (m.th ? m.th.h + "/" + m.th.fs : "-") +
        " td=" + (m.td ? m.td.h + "/" + m.td.fs : "-") +
        " pri=" + (m.primary ? m.primary.h + "/" + m.primary.fs : "-") +
        " tab=" + (m.tabOn ? m.tabOn.r + "/" + m.tabOn.c : "-") +
        " chip=" + (m.selOn ? m.selOn.h + "/" + m.selOn.r + "/" + m.selOn.bg + "[" + (m.selOnPick || "") + "]" : "-") +
        " solid=" + m.solidBlue + " empty=" + (m.emptyOrError ? 1 : 0));
    }catch(e){
      console.log("  FAIL " + entry + "：" + e.message);
      results.push({ route: entry, error: e.message });
    }
  }
  /* 支持只跑部分视图：按 route 合并进已有 metrics，避免部分运行把全量基线覆盖成几条 */
  const metricsPath = path.join(OUT, "metrics.json");
  let merged = results;
  try{
    const prev = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    if(Array.isArray(prev)){
      const byRoute = new Map(prev.map(r => [r.route, r]));
      results.forEach(r => byRoute.set(r.route, r));
      merged = [...byRoute.values()];
    }
  }catch(e){}
  fs.writeFileSync(metricsPath, JSON.stringify(merged, null, 2));
  console.log("\n已写入 " + metricsPath);
  if(cdp.errors.length){
    console.log("控制台错误：\n  " + cdp.errors.slice(0, 10).join("\n  "));
  }
}catch(e){
  failed = true;
  console.error("走查中断：" + e.message);
  process.exitCode = 1;
}finally{
  try{ proc.kill("SIGTERM"); }catch(e){}
  try{ if(ws) ws.close(); }catch(e){}
  /* CDP WebSocket 会把事件循环挂住；清理后显式退出 */
  setTimeout(() => process.exit(failed ? 1 : 0), 150);
}
