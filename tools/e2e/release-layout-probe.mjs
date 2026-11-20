/* 发布工作台横向布局探针（真 Chrome + 本地栈，只读）
   用法：node tools/e2e/release-layout-probe.mjs
   目的：量 #/release 子页在 1440 / 1920 下的左右留白与内容宽度，判断是否被 max-width 收窄；
        同时统计工作项在页面里有没有可点的链接入口。
   产物：docs/audit/release-prep-2026-11-20/shots/release-layout-*.png */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/release-prep-2026-11-20/shots");
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
const port = 9229;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-layout-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

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
  const waitFor = async (expr, label, timeout = 25000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const setViewport = (width, height) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile: false });
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };

  await setViewport(1440, 900);
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化");

  /* 最近发布计划可能都已完成：直接取当前空间的第一个版本，落到它自己的发布工作台 */
  const pickedTarget = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const reqs = await API.get("/api/reqs");
    for(const r of ((reqs && (reqs.items || reqs.list)) || [])){
      const vs = await API.get("/api/versions", { reqId: r.id });
      if(vs && vs.length) return { reqId: r.id, versionId: vs[0].id, versionName: vs[0].name };
    }
    return null;
  })()`);
  if(!pickedTarget) throw new Error("当前空间没有可用版本，无法打开发布工作台");
  console.log("  目标版本：" + pickedTarget.versionName + "（" + pickedTarget.versionId + "）");
  await evaluate(`location.hash = "#/release?id=" + encodeURIComponent(${JSON.stringify(pickedTarget.versionId)}) + "&reqId=" + encodeURIComponent(${JSON.stringify(pickedTarget.reqId)}); true`);
  await waitFor(`document.body.dataset.view === "release"`, "发布页");
  await waitFor(`!!document.querySelector(".release-page-bar")`, "工作台页面", 20000);
  await sleep(1200);

  const measure = () => evaluate(`(() => {
    const box = el => {
      if(!el) return null;
      const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return {
        x: Math.round(b.x), w: Math.round(b.width),
        padL: cs.paddingLeft, padR: cs.paddingRight,
        maxW: cs.maxWidth, margin: cs.margin
      };
    };
    const actual = document.querySelector(".release-actual");
    return {
      vw: window.innerWidth,
      view: box(document.getElementById("view-release")),
      page: box(document.querySelector(".release-page")),
      body: box(document.querySelector(".release-page-body")),
      bar: box(document.querySelector(".release-page-bar")),
      actualGrid: actual ? { cols: getComputedStyle(actual).gridTemplateColumns, w: Math.round(actual.getBoundingClientRect().width) } : null,
      sections: [...document.querySelectorAll(".release-section")].slice(0, 4).map(el => ({
        w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height)
      })),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      picker: (() => {
        const p = document.querySelector(".release-version-picker");
        if(!p) return null;
        return {
          w: Math.round(p.getBoundingClientRect().width),
          cols: getComputedStyle(p).gridTemplateColumns,
          groups: p.querySelectorAll(".release-version-group").length
        };
      })()
    };
  })()`);

  console.log("\n== 1440 ==");
  console.log(JSON.stringify(await measure(), null, 1));
  await shot("release-layout-1440.png");

  /* 工作项链接：标题是真实 <a>；普通左键留在页面开抽屉，不改 hash */
  const linkCheck = await evaluate(`(async () => {
    const anchors = [...document.querySelectorAll("a[data-task-link]")];
    const pick = document.querySelector(".release-task-picker a[data-task-link]");
    if(!pick) return { anchors: anchors.length, clicked: false };
    const before = location.hash;
    pick.click();
    const started = Date.now();
    let open = false;
    while(Date.now() - started < 6000){
      if(document.getElementById("taskDrawer") && document.getElementById("taskDrawer").classList.contains("on")){ open = true; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    const afterOpen = location.hash;
    let closed = false;
    if(open){
      const closeBtn = document.querySelector("#taskDrawer [aria-label='关闭'], #taskDrawer [data-close]");
      if(closeBtn){ closeBtn.click(); closed = true; await new Promise(r => setTimeout(r, 400)); }
    }
    return { anchors: anchors.length, clicked: true, drawerOpen: open, closed, hashBefore: before, hashAfter: afterOpen, hashStayed: before === afterOpen, title: pick.textContent.trim().slice(0, 40) };
  })()`);
  console.log("\n== 工作项链接 ==");
  console.log(JSON.stringify(linkCheck, null, 1));

  await setViewport(1920, 1080);
  await sleep(600);
  console.log("\n== 1920 ==");
  console.log(JSON.stringify(await measure(), null, 1));
  await shot("release-layout-1920.png");

  /* 历史与内容步骤：版本内容列表是否可点 */
  await evaluate(`(() => { const steps = [...document.querySelectorAll(".rel-step")]; if(steps[2]) steps[2].click(); return true; })()`);
  await sleep(1200);
  const contentLinks = await evaluate(`(() => {
    const items = [...document.querySelectorAll(".release-page .release-scope li")];
    return {
      liTotal: items.length,
      withLink: items.filter(li => li.querySelector("a[data-task-link]")).length,
      sampleHref: (items.find(li => li.querySelector("a[data-task-link]")) || { querySelector: () => null }).querySelector ? null : null
    };
  })()`);
  const sampleHref = await evaluate(`(() => { const a = document.querySelector(".release-page .release-scope a[data-task-link]"); return a ? { text: a.textContent.trim().slice(0, 40), href: a.getAttribute("href") } : null; })()`);
  console.log("\n== 版本内容链接 ==");
  console.log(JSON.stringify({ ...contentLinks, sampleHref }, null, 1));
  const contentClick = await evaluate(`(async () => {
    const a = document.querySelector(".release-page .release-scope a[data-task-link]");
    if(!a) return { clicked: false };
    const before = location.hash;
    a.click();
    const started = Date.now();
    let open = false;
    while(Date.now() - started < 6000){
      const d = document.getElementById("taskDrawer");
      if(d && d.classList.contains("on")){ open = true; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    const stayed = location.hash === before;
    if(open){
      const c = document.querySelector("#taskDrawer [aria-label='关闭'], #taskDrawer [data-close]");
      if(c){ c.click(); await new Promise(r => setTimeout(r, 400)); }
    }
    return { clicked: true, drawerOpen: open, hashStayed: stayed };
  })()`);
  console.log("内容链接点击：" + JSON.stringify(contentClick));
  await shot("release-layout-history-1920.png");

  /* 实际发布步骤：两栏是否吃掉宽度 */
  await evaluate(`(() => { const steps = [...document.querySelectorAll(".rel-step")]; if(steps[1]) steps[1].click(); return true; })()`);
  await sleep(1200);
  const actualSnap = await evaluate(`(() => {
    const g = document.querySelector(".release-actual");
    const main = document.querySelector(".release-actual-main");
    return g ? {
      gridW: Math.round(g.getBoundingClientRect().width),
      cols: getComputedStyle(g).gridTemplateColumns,
      mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
      readyW: (() => { const r = document.querySelector(".rel-ready"); return r ? Math.round(r.getBoundingClientRect().width) : null; })()
    } : null;
  })()`);
  console.log("\n== 实际发布两栏 ==");
  console.log(JSON.stringify(actualSnap, null, 1));
  await shot("release-layout-actual-1920.png");

  /* 回到计划步骤复核版本多选列数 */
  await evaluate(`(() => { const steps = [...document.querySelectorAll(".rel-step")]; if(steps[0]) steps[0].click(); return true; })()`);
  await sleep(800);
  const toggleCheck = await evaluate(`(async () => {
    const row = document.querySelector(".release-task-picker [data-task-row]");
    if(!row) return null;
    const cb = row.querySelector("input[type=checkbox]");
    if(!cb || cb.disabled) return { skipped: true };
    const before = cb.checked;
    const title = row.querySelector("a[data-task-link]");
    if(title){ title.click(); await new Promise(r => setTimeout(r, 600)); }
    const afterTitle = cb.checked;
    const d = document.getElementById("taskDrawer");
    if(d && d.classList.contains("on")){
      const c = document.querySelector("#taskDrawer [aria-label='关闭'], #taskDrawer [data-close]");
      if(c){ c.click(); await new Promise(r => setTimeout(r, 400)); }
    }
    const meta = row.querySelector("small");
    if(meta) meta.click();
    await new Promise(r => setTimeout(r, 200));
    return { before, afterTitle, afterMeta: cb.checked, titleKeepsCheckbox: before === afterTitle, metaToggles: before !== cb.checked };
  })()`);
  console.log("勾选与链接互不干扰：" + JSON.stringify(toggleCheck));
  const pickerNow = await evaluate(`(() => {
    const p = document.querySelector(".release-version-picker");
    return p ? { w: Math.round(p.getBoundingClientRect().width), cols: getComputedStyle(p).gridTemplateColumns, groups: p.querySelectorAll(".release-version-group").length } : null;
  })()`);
  console.log("\n== 版本多选列 ==");
  console.log(JSON.stringify(pickerNow, null, 1));
  await shot("release-layout-plan-1920.png");

  await setViewport(390, 844);
  await sleep(600);
  console.log("\n== 390 ==");
  console.log(JSON.stringify(await measure(), null, 1));
  await shot("release-layout-390.png");
  await setViewport(1920, 1080);
  await sleep(400);

  const entries = await evaluate(`(() => {
    const scopeRows = [...document.querySelectorAll(".release-scope li")].slice(0, 6).map(li => ({
      text: li.textContent.replace(/\\s+/g, " ").trim().slice(0, 80),
      clickable: !!li.querySelector("a,button,[data-open-task],[data-snap-task]")
    }));
    const count = sel => document.querySelectorAll(sel).length;
    return {
      scopeTotal: count(".release-scope li"),
      scopeRows,
      openTaskRows: count("[data-open-task]"),
      snapTaskButtons: count("[data-snap-task]"),
      pickerRows: count("[data-task-row]"),
      scopeAnchors: count(".release-scope a")
    };
  })()`);
  console.log("\n== 工作项可点入口 ==");
  console.log(JSON.stringify(entries, null, 1));
  if(cdp.errors.length) console.log("\n控制台错误：" + cdp.errors.slice(0, 5).join(" | "));
  else console.log("\n控制台错误：0");
}finally{
  proc.kill("SIGKILL");
}
