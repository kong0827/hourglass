/* 浏览器冒烟测试（可移植：Node 18+ 内置 WebSocket / fetch，无需 puppeteer）
   覆盖：登录、12 个侧栏入口、项目驾驶舱交付卡片跳转、通知中心「查看全部消息」、
   导航使用记录本机写入与设置页导出入口。
   自建数据：脚本用 API 创建唯一项目，结束时按名称确认删除；不改动其他数据。

   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
       node tools/e2e/smoke.mjs
   需要本机安装 Chrome / Chromium；也可用 CHROME_BIN 指定可执行文件。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"
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
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if(msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }else if(msg.method){
      this.events.push(msg);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
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

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-e2e-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--window-size=1440,900",
    "about:blank"
  ], { stdio: "ignore" });

  let cdp, sessionId, created = null;
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
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    for(const domain of ["Page", "Runtime", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 12000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{
          last = await evaluate(expression);
          if(last) return last;
        }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "页面加载 " + url, 20000);
    };
    const pass = msg => console.log("  PASS " + msg);

    console.log("沙漏浏览器冒烟测试\n  浏览器：" + chrome + "\n  地址：" + BASE);

    /* 1. 登录 */
    await navigate(BASE + "/login.html");
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(USER)});
      set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body && document.body.dataset.view`, "登录完成", 20000);
    const auth = await evaluate(`fetch(${JSON.stringify(BASE)} + "/api/auth/me", { credentials: "same-origin" }).then(r => r.status)`);
    assert(auth === 200, "登录后 /api/auth/me 返回 " + auth);
    pass("登录 " + USER);

    /* 2. 12 个侧栏入口 */
    const navs = [
      ["mine", "mine"], ["review", "review"], ["demands", "demands"], ["projects", "projects"],
      ["phase", "phase"], ["workitems", "board"], ["requirements", "requirements"],
      ["testcases", "testcases"], ["branches", "branches"], ["insight", "analysis"],
      ["workload", "workload"], ["risks", "risks"]
    ];
    const navCount = await evaluate(`document.querySelectorAll('#sideNav .nav-item[data-view]').length`);
    assert(navCount === navs.length, `侧栏入口应为 ${navs.length} 个，实际 ${navCount}`);
    for(const [entry, expected] of navs){
      await evaluate(`(() => { const b = document.querySelector('#sideNav [data-view="${entry}"]'); b && b.click(); return !!b; })()`);
      await waitFor(`document.body.dataset.view === ${JSON.stringify(expected)}`, "入口 " + entry);
      const visible = await evaluate(`(() => {
        const v = document.getElementById("view-" + document.body.dataset.view);
        return !!(v && v.classList.contains("on") && v.offsetParent !== null);
      })()`);
      assert(visible, `入口 ${entry} 对应的视图没有显示`);
      pass(`入口 ${entry} → ${expected}`);
    }

    /* 3. 建一个临时项目，验证驾驶舱交付卡片 */
    const projectName = "E2E 冒烟 " + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    created = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const p = await API.post("/api/reqs", {
        name: ${JSON.stringify(projectName)},
        description: "浏览器冒烟测试自动创建",
        objective: "验证项目驾驶舱交付卡片",
        status: "active",
        template: "blank"
      });
      return { id: p.id, name: p.name };
    })()`);
    assert(created && created.id, "创建临时项目失败");
    pass("创建临时项目 " + created.name);

    /* 整页重载：rt.reqList 是首屏缓存，不重载的话驾驶舱选不到刚建的项目 */
    await navigate(BASE + "/index.html#/portfolio");
    await waitFor(`document.body.dataset.view === "portfolio"`, "项目列表");
    await waitFor(`!!document.querySelector('[data-open-project="${created.id}"]')`, "临时项目行");
    await evaluate(`document.querySelector('[data-open-project="${created.id}"]').click()`);
    await waitFor(`document.body.dataset.view === "project"`, "项目驾驶舱");
    await waitFor(`document.querySelectorAll(".project-delivery-card").length === 3`, "交付卡片");
    await waitFor(`[...document.querySelectorAll(".project-delivery-card b")].every(b => b.textContent !== "—")`, "交付卡片数据", 15000);
    const cards = await evaluate(`[...document.querySelectorAll(".project-delivery-card")].map(b => b.textContent.replace(/\\s+/g, " ").trim())`);
    assert(cards.length === 3, "交付卡片应为 3 张");
    pass("驾驶舱交付卡片：" + cards.join(" / "));

    for(const [kind, expected] of [["docs", "requirements"], ["tests", "testcases"], ["versions", "phase"]]){
      const view = await evaluate("document.body.dataset.view");
      if(view !== "project"){
        await evaluate("location.hash = '#/portfolio'");
        await waitFor(`document.body.dataset.view === "portfolio"`, "回到项目列表");
        await evaluate(`document.querySelector('[data-open-project="${created.id}"]').click()`);
        await waitFor(`document.body.dataset.view === "project"`, "再进驾驶舱");
      }
      await waitFor(`!!document.querySelector('[data-project-open="${kind}"]')`, kind + " 卡片");
      await evaluate(`document.querySelector('[data-project-open="${kind}"]').click()`);
      await waitFor(`document.body.dataset.view === ${JSON.stringify(expected)}`, kind + " 跳转");
      pass(`交付卡片 ${kind} → ${expected}`);
    }

    /* 4. 通知中心 → 全部消息 */
    await waitFor(`!!document.getElementById("btnAlert")`, "顶栏通知按钮");
    await evaluate(`document.getElementById("btnAlert").click()`);
    await waitFor(`!!document.querySelector("#alertPanel [data-ap-all]")`, "通知面板出口");
    await evaluate(`document.querySelector("#alertPanel [data-ap-all]").click()`);
    await waitFor(`document.body.dataset.view === "messages"`, "消息页");
    const footerGone = await evaluate(`!document.querySelector("#alertPanel [data-ap-all]")`);
    assert(footerGone, "消息页不应再显示「查看全部消息」");
    pass("通知中心 → 消息页");

    /* 5. 导航使用记录：只写本机 localStorage，设置页提供导出入口 */
    await navigate(BASE + "/index.html#/settings");
    await waitFor(`!!document.getElementById("btnNavTelemetryCsv")`, "导航使用记录导出按钮");
    await sleep(1300);
    /* 段落在切换视图时才落盘，模拟用户离开设置页 */
    await evaluate(`location.hash = "#/messages"`);
    await waitFor(`document.body.dataset.view === "messages"`, "切回消息页");
    await sleep(300);
    const telemetry = await evaluate(`localStorage.getItem("ds.navTelemetry.v1")`);
    assert(telemetry && telemetry.length > 2, "导航使用记录未写入 localStorage");
    pass("导航使用记录：本机写入 + 设置页导出入口");

    const exceptions = cdp.takeExceptions();
    assert(!exceptions.length, "页面出现脚本异常：" + JSON.stringify(exceptions.slice(0, 3)));
    pass("无页面脚本异常");

    console.log("\n结果：全部通过");
  }finally{
    try{
      if(cdp && sessionId && created && created.id){
        const res = await cdp.send("Runtime.evaluate", {
          expression: `(async () => {
            const { API } = await import("./js/core/api.js");
            await API.del("/api/reqs/" + encodeURIComponent(${JSON.stringify(created.id)}) + "?confirm=" + encodeURIComponent(${JSON.stringify(created.name)}));
            return true;
          })()`,
          awaitPromise: true, returnByValue: true
        }, sessionId);
        const ok = res && res.result && res.result.value === true;
        console.log(ok ? "  清理：临时项目已删除" : "  清理：临时项目删除失败，请手工删除 " + created.name);
      }
    }catch(e){
      console.log("  清理失败：" + e.message + "，请手工删除 " + (created && created.name));
    }
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    try{ child.kill("SIGKILL"); }catch(e){ /* 忽略 */ }
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){ /* 忽略 */ }
  }
}

main().catch(err => {
  console.error("\nFAIL：" + err.message);
  process.exitCode = 1;
});
