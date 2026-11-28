/* 全局搜索「最近访问」E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/search-recent-visits.mjs
   覆盖：
     A 打开工作项后，本机写入最近访问（按账号+空间隔离）；
     B 打开全局搜索，空态出现「最近访问」分组与刚打开的工作项；
     C 点按最近项能重新打开该工作项；
     D 「清除」后分组消失、本机记录清空；
     E 无运行时错误。不写任何业务数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const PORT = Number(process.env.CDP_PORT || 9341);
const SHOT_DIR = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-recent-"));

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-recent-profile-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败[" + expr.slice(0, 140).replace(/\s+/g, " ") + "]：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
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
  const shot = async name => {
    await sleep(350);
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };

  console.log("全局搜索「最近访问」E2E\n  地址：" + BASE);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Network.clearBrowserCookies", {});
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
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化");

  /* 先清空本机最近访问，保证断言从零开始 */
  await evaluate(`import("./js/core/recent-visits.js").then(m => { m.clearRecentVisits(); return true; })`);

  /* ---------------- A 打开工作项 → 写入最近访问 ---------------- */
  const task = await waitFor(`(async () => {
    const { API } = await import("./js/core/api.js");
    const page = await API.get("/api/tasks/list", { limit: 1, sort: "updated" });
    const rows = (page && (page.items || page.rows)) || [];
    const t = rows[0];
    return t ? { id: t.id, title: t.title || "未命名工作项" } : null;
  })()`, "取一条工作项");
  assert(!!task && !!task.id, "取到工作项 " + (task && task.title));
  await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(task.id)}))`);
  await waitFor("document.getElementById('taskDrawer').classList.contains('on')", "工作项抽屉打开");
  const visit = await waitFor(`import("./js/core/recent-visits.js").then(m => {
    const rows = m.recentVisits();
    const hit = rows.filter(r => r.type === "task" && r.id === ${JSON.stringify(task.id)})[0];
    return hit ? { title: hit.title, count: rows.length } : null;
  })`, "最近访问已写入");
  assert(visit.title === task.title, "最近访问标题一致：" + visit.title);
  await evaluate(`import("./js/core/task-drawer.js").then(m => { m.tryCloseTaskDrawer(); return true; })`);
  await sleep(250);

  /* ---------------- B 打开搜索 → 空态出现最近访问 ---------------- */
  await evaluate(`import("./js/core/search-palette.js").then(m => { m.openSearchPalette(); return true; })`);
  await waitFor("document.getElementById('dlgSearch').classList.contains('open')", "搜索面板打开");
  const group = await waitFor(`(() => {
    const box = document.getElementById("paletteResults");
    const head = [...box.querySelectorAll(".palette-recent-head span")].map(s => s.textContent.trim());
    const items = [...box.querySelectorAll("[data-visit]")].map(b => b.textContent.trim());
    return head.indexOf("最近访问") >= 0 ? { items } : null;
  })()`, "最近访问分组");
  assert(group.items.some(t => t.indexOf(task.title) >= 0), "分组内出现刚打开的工作项");
  await shot("a-recent-visits.png");

  /* ---------------- C 点按最近项 → 重新打开 ---------------- */
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll("#paletteResults [data-visit]")];
    const hit = btns.filter(b => b.textContent.indexOf(${JSON.stringify(task.title)}) >= 0)[0] || btns[0];
    if(hit) hit.click();
    return true;
  })()`);
  await waitFor("document.getElementById('taskDrawer').classList.contains('on')", "点按后抽屉重新打开");
  pass("点按最近访问可重新打开工作项");
  await evaluate(`import("./js/core/task-drawer.js").then(m => { m.tryCloseTaskDrawer(); return true; })`);
  await sleep(250);

  /* ---------------- D 清除最近访问 ---------------- */
  await evaluate(`import("./js/core/search-palette.js").then(m => { m.openSearchPalette(); return true; })`);
  await waitFor("document.getElementById('dlgSearch').classList.contains('open')", "搜索面板再次打开");
  await evaluate(`document.querySelector("#paletteResults [data-visit-clear]").click()`);
  await waitFor(`(() => {
    const box = document.getElementById("paletteResults");
    const head = [...box.querySelectorAll(".palette-recent-head span")].map(s => s.textContent.trim());
    return !box.querySelector("[data-visit]") && head.indexOf("最近访问") < 0;
  })()`, "最近访问分组已清除");
  const left = await evaluate(`import("./js/core/recent-visits.js").then(m => m.recentVisits().length)`);
  assert(left === 0, "本机最近访问已清空");
  await shot("b-cleared.png");

  assert(cdp.errors.length === 0, "无运行时错误" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 3).join(" | ") : ""));
}catch(e){
  failed++;
  console.log("  FAIL " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){ /* noop */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}