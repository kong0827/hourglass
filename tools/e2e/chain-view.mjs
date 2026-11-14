/* 依赖影响链视图 E2E 验证（仿 tools/e2e/tree-view.mjs，Node 18+ 原生 CDP）
   覆盖：入口子导航、链渲染、建依赖后双向展开、方向切换、节点重新居中、中心卡开抽屉、
   删除依赖后恢复、控制台报错。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";

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

const chrome = findChrome();
const port = 9224;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chain-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

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
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };

  console.log("依赖影响链视图 E2E\n  地址：" + BASE);
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
  try{
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  pass("登录 " + USER);

  /* 1. 入口：子导航出现「影响链」并可切换 */
  await evaluate(`location.hash = "#/chain"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "chain"`, "切换到影响链视图");
  const subLabels = await evaluate(`[...document.querySelectorAll("#subNav .subnav-item")].map(b => b.textContent.trim()).join(",")`);
  assert(subLabels.includes("影响链"), "子导航含「影响链」入口（" + subLabels + "）");
  const subOn = await evaluate(`(document.querySelector("#subNav .subnav-item.on") || {}).textContent || ""`);
  assert(subOn.trim() === "影响链", "当前子导航高亮为「影响链」");

  /* 2. 渲染：中心卡 + 元信息 */
  await waitFor(`!!document.querySelector("#view-chain.on .ch-center-card")`, "中心卡渲染", 20000);
  const meta = await evaluate(`document.getElementById("chainMeta").textContent`);
  assert(/已加载 \d+ 项 · 依赖 \d+ 条/.test(meta), "计数行（" + meta + "）");
  const pickText = await evaluate(`document.getElementById("btnChainPickText").textContent`);
  assert(!!pickText && pickText !== "选择中心工作项", "默认选中中心工作项（" + String(pickText).slice(0, 24) + "…）");

  /* 3. 造一条依赖 A→B（FS+2天），验证双向展开 */
  const depInfo = await evaluate(`(async () => {
    const d = await (await fetch("api/tasks/list?sort=updated&limit=50")).json();
    const items = d.data && d.data.items || [];
    if(items.length < 2) return { error: "可用工作项不足：" + items.length };
    const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const r = await fetch("api/gantt/deps", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": decodeURIComponent(csrf), "X-Client-Id": window.DS_CLIENT_ID || "" },
      body: JSON.stringify({ fromTaskId: items[0].id, toTaskId: items[1].id, depType: "FS", lagDays: 2 })
    });
    if(!r.ok) return { error: "建依赖失败 " + r.status };
    const body = await r.json();
    const dep = body.data || body;
    return { id: dep.id, fromId: items[0].id, fromTitle: items[0].title, toId: items[1].id, toTitle: items[1].title };
  })()`);
  if(depInfo.error) throw new Error(depInfo.error);
  pass("建立依赖：" + depInfo.fromTitle.slice(0, 16) + "… → " + depInfo.toTitle.slice(0, 16) + "…");

  /* 以 B（后继端）为中心：上游应出现 A */
  await evaluate(`(() => {
    /* 通过选择器把中心切到后继任务 */
    window.__chainTo = ${JSON.stringify(depInfo.toId)};
    return true;
  })()`);
  await evaluate(`location.hash = "#/board"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await sleep(400);
  await evaluate(`location.hash = "#/chain"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "chain"`, "切回影响链");
  await waitFor(`!!document.querySelector("#view-chain.on .ch-center-card")`, "重新渲染", 20000);
  await evaluate(`(async () => {
    /* 点选择器选目标工作项 */
    document.getElementById("btnChainPick").click();
    await new Promise(r => setTimeout(r, 200));
    const item = document.querySelector('[data-chain-pick="' + CSS.escape(window.__chainTo) + '"]');
    if(item) item.click();
    return true;
  })()`);
  await sleep(400);
  const upTitles = await evaluate(`[...document.querySelectorAll("#view-chain .ch-center-card")].length
    ? [...document.querySelectorAll("#view-chain .ch-sec:first-child .ch-node-title")].map(n => n.textContent).join("|")
    : ""`);
  assert(upTitles.indexOf(depInfo.fromTitle) !== -1, "上游段出现前驱「" + depInfo.fromTitle.slice(0, 20) + "」");
  const lagTag = await evaluate(`[...document.querySelectorAll("#view-chain .ch-dep-tag.lag")].map(n => n.textContent).join(",")`);
  assert(lagTag.indexOf("+2天") !== -1, "边标注滞后天数（" + lagTag + "）");
  const typeTag = await evaluate(`[...document.querySelectorAll("#view-chain .ch-dep-tag:not(.lag)")].map(n => n.textContent).join(",")`);
  assert(typeTag.indexOf("FS") !== -1, "边标注依赖类型（" + typeTag + "）");

  /* 4. 方向切换：只看下游 */
  await evaluate(`document.querySelector('#chainDir [data-dir="down"]').click(); true`);
  await sleep(300);
  const upSecGone = await evaluate(`!document.querySelector("#view-chain .ch-sec-label").textContent.includes("上游")`);
  const downSecThere = await evaluate(`[...document.querySelectorAll("#view-chain .ch-sec-label")].some(l => l.textContent.includes("下游"))`);
  assert(upSecGone && downSecThere, "切到「下游」后只显示下游段");
  await evaluate(`document.querySelector('#chainDir [data-dir="both"]').click(); true`);
  await sleep(300);

  /* 5. 点击上游节点重新居中：原前驱成为中心 */
  await evaluate(`(() => {
    const n = [...document.querySelectorAll("#view-chain [data-chain-center]")].find(el =>
      el.querySelector(".ch-node-title").textContent === ${JSON.stringify(depInfo.fromTitle)});
    if(n) n.click();
    return true;
  })()`);
  await sleep(400);
  const newCenter = await evaluate(`document.getElementById("btnChainPickText").textContent`);
  assert(newCenter === depInfo.fromTitle, "点击节点后重新居中（" + newCenter.slice(0, 20) + "）");
  const downHasTo = await evaluate(`[...document.querySelectorAll("#view-chain .ch-sec")].some(sec =>
    sec.textContent.includes("下游") && sec.textContent.includes(${JSON.stringify(depInfo.toTitle)}))`);
  assert(downHasTo, "新中心的下游段出现后继");

  /* 6. 中心卡点击打开详情抽屉 */
  await evaluate(`document.querySelector("#view-chain .ch-center-card").click(); true`);
  await waitFor(`(() => { const d = document.getElementById("taskForm"); return d && d.offsetWidth > 0; })()`, "详情抽屉打开", 8000);
  pass("中心卡打开抽屉");
  await evaluate(`(document.getElementById("drawerClose") || document.querySelector("#taskForm .drawer-x") || {click(){}}).click(); true`);
  await sleep(300);

  /* 7. 删除依赖，链恢复为空态 */
  await evaluate(`(async () => {
    const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const r = await fetch("api/gantt/deps/" + encodeURIComponent(${JSON.stringify(depInfo.id)}), {
      method: "DELETE",
      headers: { "X-XSRF-TOKEN": decodeURIComponent(csrf), "X-Client-Id": window.DS_CLIENT_ID || "" }
    });
    return r.ok;
  })()`).then(ok => assert(ok, "删除测试依赖"));
  await sleep(600);
  await evaluate(`location.hash = "#/board"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await sleep(400);
  await evaluate(`location.hash = "#/chain"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "chain" && !!document.querySelector("#view-chain.on .ch-center-card")`, "删依赖后重渲染", 20000);
  const stillThere = await evaluate(`[...document.querySelectorAll("#view-chain .ch-node:not(.ch-center-card) .ch-node-title")].some(n => n.textContent === ${JSON.stringify(depInfo.fromTitle)})`);
  assert(!stillThere, "删除依赖后链上不再出现前驱");

  /* 8. 截图 + 控制台报错 */
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const out = "/tmp/chain-view-e2e.png";
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("  截图：" + out);
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 300) + "）" : ""));
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);
