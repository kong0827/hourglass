/* 「我的工作」空空间首个动作（新建项目）走查（真 Chrome + 本地栈）
   用法：E2E_BASE=http://127.0.0.1:8097/hourglass node tools/e2e/mine-no-project.mjs
   覆盖：全新共享空间、空间主首次进入 → 空态首要动作是「新建项目」并能直接拉起新建弹窗；
   建出第一个项目后空态文案回退；个人空间不出现该分支。
   运行前会新建一个临时账号与空间，结束时删除，不改动演示数据。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const ADMIN = process.env.E2E_USER || "admin";
const ADMIN_PASS = process.env.E2E_PASS || "admin123";
const STAMP = Date.now().toString().slice(-6);
const USERNAME = "e2emine" + STAMP;
const USER_PASS = "e2ePass123";
const WS_NAME = "E2E空空间" + STAMP;
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(os.tmpdir(), "mine-no-project-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.expectNoise = false;
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(this.expectNoise){
      return;
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
const port = 9477;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mine-empty-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage",
  "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const fail = m => { failed++; console.log("  FAIL " + m); };
const assert = (cond, msg) => cond ? pass(msg) : fail(msg);

let createdWs = "", createdUser = "", version = null;

try{
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
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  /* 页面内带 CSRF 的写请求；登录是 formLogin，必须 form-encoded */
  const apiCall = `(async (method, url, body, form) => {
    const tok = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const opt = { method, credentials: "same-origin", headers: { "X-XSRF-TOKEN": decodeURIComponent(tok) } };
    if(form){ opt.headers["Content-Type"] = "application/x-www-form-urlencoded"; opt.body = body; }
    else if(body !== undefined){ opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    let j = null; try{ j = await r.json(); }catch(e){ j = null; }
    return j;
  })`;
  const loginAs = async (user, pass) => {
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(user)});
      set("uPass", ${JSON.stringify(pass)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    try{
      await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
    }catch(e){
      const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
      throw new Error("登录未完成（" + user + "），页面提示：" + errMsg);
    }
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化");
  };
  const logout = async () => {
    await evaluate(`${apiCall}("POST", "./api/auth/logout", undefined)`);
    await sleep(300);
  };
  const mineState = () => evaluate(`(() => {
    const big = document.querySelector("#mineBody .mw-bigstate");
    const btns = big ? [...big.querySelectorAll(".mw-bigact .btn")].map(b => ({ text: b.textContent.trim(), primary: b.classList.contains("primary"), act: b.dataset.emptyNew || b.dataset.go || "" })) : [];
    return {
      view: document.body.dataset.view,
      title: (big && big.querySelector("h3") ? big.querySelector("h3").textContent : "").trim(),
      desc: (big && big.querySelector("p") ? big.querySelector("p").textContent : "").trim(),
      sub: ((document.getElementById("pageSub") || {}).textContent || "").trim(),
      brief: ((document.querySelector("#mineBrief .mw-txt") || {}).textContent || "").replace(/\\s+/g, " ").trim(),
      btns
    };
  })()`);

  console.log("「我的工作」空空间首个动作走查\n  地址：" + BASE + "\n  临时账号：" + USERNAME);

  /* ---------- 准备：管理员建临时账号 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await loginAs(ADMIN, ADMIN_PASS);
  const u = await evaluate(`${apiCall}("POST", "./api/admin/users", { username: ${JSON.stringify(USERNAME)}, password: ${JSON.stringify(USER_PASS)}, displayName: "E2E空空间主" })`);
  if(!u || u.code !== 0) throw new Error("建临时账号失败：" + JSON.stringify(u));
  createdUser = u.data.id;
  pass("已建临时账号（无任何工作项）");
  /* 退出到换号之间，旧会话的 SSE / 轮询会用已注销的 cookie 打几枪 401，属预期噪音 */
  cdp.expectNoise = true;
  await logout();

  /* ---------- 新账号建全新共享空间，首次进入「我的工作」 ---------- */
  await loginAs(USERNAME, USER_PASS);
  await sleep(800);
  cdp.expectNoise = false;
  const w = await evaluate(`${apiCall}("POST", "./api/workspaces", { name: ${JSON.stringify(WS_NAME)} })`);
  if(!w || w.code !== 0) throw new Error("建临时空间失败：" + JSON.stringify(w));
  createdWs = w.data.id;
  await evaluate(`${apiCall}("POST", "./api/workspaces/" + encodeURIComponent(${JSON.stringify(createdWs)}) + "/select", {})`);
  await call("Page.reload", { ignoreCache: true });
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.currentWs.id === ${JSON.stringify(createdWs)})`, "切到临时空间", 30000);
  await waitFor(`document.body.dataset.view === "mine"`, "落在我的工作");
  await waitFor(`!!document.querySelector("#mineBody .mw-bigstate h3")`, "空态渲染", 25000);
  await sleep(400);

  const counts = await evaluate(`fetch("./api/my-work/counts", { credentials: "same-origin" }).then(r => r.json()).then(j => j.data)`);
  assert(counts && counts.projectCount === 0, "counts 返回 projectCount=0（实际 " + (counts && counts.projectCount) + "）");

  let st = await mineState();
  assert(st.title === "这个空间还没有项目", "空态标题指向缺项目：" + st.title);
  assert(st.btns.length === 1 && st.btns[0].text === "新建项目" && st.btns[0].primary, "空态只保留「新建项目」一个主操作：" + st.btns.map(b => b.text).join(" / "));
  assert(!st.btns.some(b => b.text === "新建工作项"), "空空间不再把「新建工作项」作为首要动作");
  assert(!st.btns.some(b => b.text === "提一个需求" || b.text === "去需求池看看"), "不提供走不通的次操作（需求必选项目、需求池为空）");
  assert(st.desc.indexOf("项目") >= 0, "空态说明为什么会空：" + st.desc);
  assert(st.sub.indexOf("还没有项目") >= 0, "页头副标题同步指向缺项目：" + st.sub);
  assert(st.brief.indexOf("这个空间还没有项目") >= 0, "结论条同步指向缺项目：" + st.brief);
  await shot("mine-empty-1440.png");

  /* ---------- 点首要动作：进入项目页并拉起新建弹窗 ---------- */
  await evaluate(`(() => { const b = document.querySelector("#mineBody .mw-bigact .btn.primary"); b.click(); return true; })()`);
  await waitFor(`document.body.dataset.view === "projects"`, "切到项目页");
  await waitFor(`document.getElementById("dlgProject") && document.getElementById("dlgProject").classList.contains("open")`, "新建项目弹窗打开", 20000);
  const dlgTitle = await evaluate(`(document.getElementById("reqFormTitle") || {}).textContent || ""`);
  assert(dlgTitle === "新建项目", "打开的是新建项目弹窗：" + dlgTitle);
  await shot("mine-empty-to-project-dialog.png");
  await evaluate(`(() => { const x = document.getElementById("dlgProjectX"); if(x) x.click(); return true; })()`);
  await sleep(300);

  /* ---------- 建出第一个项目后，空态文案回退 ---------- */
  const p = await evaluate(`${apiCall}("POST", "./api/reqs", { name: "E2E第一个项目" })`);
  if(!p || p.code !== 0) throw new Error("建项目失败：" + JSON.stringify(p));
  await evaluate(`(() => { const n = document.querySelector('#sideNav [data-view="mine"]'); n.click(); return true; })()`);
  await waitFor(`document.body.dataset.view === "mine"`, "回到我的工作");
  await waitFor(`fetch("./api/my-work/counts", { credentials: "same-origin" }).then(r => r.json()).then(j => j.data.projectCount === 1)`, "计数刷新到 1 个项目", 20000);
  await waitFor(`(() => { const h = document.querySelector("#mineBody .mw-bigstate h3"); return h && h.textContent.trim() === "本周还没有待处理事项"; })()`, "空态回退到常规文案", 20000);
  st = await mineState();
  assert(st.title !== "这个空间还没有项目", "有项目后不再显示缺项目空态：" + st.title);
  assert(st.sub.indexOf("还没有项目") === -1, "页头副标题回到常规口径：" + st.sub);
  assert(st.brief.indexOf("这个空间还没有项目") === -1, "结论条回到常规口径：" + st.brief);
  assert(st.btns.some(b => b.text === "新建工作项") || st.btns.some(b => b.text === "去需求池看看"), "恢复常规空态动作：" + st.btns.map(b => b.text).join(" / "));

  /* ---------- 个人空间不触发该分支 ---------- */
  const myWs = await evaluate(`import("./js/core/state.js").then(({rt}) => rt.allWorkspaces.filter(w => w.type === "personal")[0] || null)`);
  if(myWs){
    await evaluate(`${apiCall}("POST", "./api/workspaces/" + encodeURIComponent(${JSON.stringify(myWs.id)}) + "/select", {})`);
    await call("Page.reload", { ignoreCache: true });
    await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.type === "personal")`, "切到个人空间", 30000);
    await waitFor(`document.body.dataset.view === "mine" && (() => { const h = document.querySelector("#mineBody .mw-bigstate h3"); return !!(h && h.textContent.trim()); })()`, "个人空间空态", 25000);
    await sleep(300);
    const pst = await mineState();
    assert(!!pst.title && pst.title !== "这个空间还没有项目", "个人空间不显示缺项目空态：" + pst.title);
  }else{
    console.log("  SKIP 当前账号没有个人空间");
  }

  if(cdp.errors.length){
    failed++;
    console.log("  FAIL 控制台错误 " + cdp.errors.length + " 条");
    cdp.errors.slice(0, 8).forEach(e => console.log("    " + e.slice(0, 220)));
  }else pass("无控制台错误");
}catch(err){
  failed++;
  console.log("  ERROR " + (err && err.stack || err));
}finally{
  /* ---------- 清理：删空间 → 删账号（失败只登记，不掩盖断言结果） ---------- */
  try{
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const cdp = new Cdp(ws);
    const target = await cdp.send("Target.createTarget", { url: BASE + "/index.html" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sid = attached.sessionId;
    for(const d of ["Page", "Runtime"]) await cdp.send(`${d}.enable`, {}, sid);
    const evaluate = async expr => {
      const res = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      return res.result ? res.result.value : undefined;
    };
    const apiCall = `(async (method, url, body) => {
      const tok = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
      const opt = { method, credentials: "same-origin", headers: { "X-XSRF-TOKEN": decodeURIComponent(tok), "Content-Type": "application/json" } };
      if(body !== undefined) opt.body = JSON.stringify(body);
      const r = await fetch(url, opt);
      let j = null; try{ j = await r.json(); }catch(e){ j = null; }
      return j;
    })`;
    const loginForm = (user, pass) => `fetch("./api/auth/login", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded",
        "X-XSRF-TOKEN": decodeURIComponent((document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "") },
      body: new URLSearchParams({ username: ${JSON.stringify(user)}, password: ${JSON.stringify(pass)} }) }).then(r => r.json())`;
    const waitInit = async (cond, label) => {
      for(let i = 0; i < 150; i++){
        try{ if(await evaluate(cond)) return true; }catch(e){ /* 页面切换中 */ }
        await sleep(150);
      }
      throw new Error("清理等待超时：" + label);
    };
    if(createdWs){
      await cdp.send("Page.navigate", { url: BASE + "/index.html" }, sid);
      await waitInit(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "清理页初始化");
      const r = await evaluate(`${apiCall}("DELETE", "./api/workspaces/" + encodeURIComponent(${JSON.stringify(createdWs)}))`);
      console.log(r && r.code === 0 ? "  已删除临时空间" : "  WARN 删除临时空间失败：" + JSON.stringify(r));
    }
    if(createdUser){
      await evaluate(`fetch("./api/auth/logout", { method: "POST", credentials: "same-origin",
        headers: { "X-XSRF-TOKEN": decodeURIComponent((document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "") } })`);
      await cdp.send("Page.navigate", { url: BASE + "/login.html" }, sid);
      await waitInit(`!!document.getElementById("loginForm")`, "登录页");
      /* 登录页是静态文件，不会发 CSRF Cookie；先打一次鉴权接口再提交表单 */
      await evaluate(`fetch("./api/auth/me", { credentials: "same-origin" }).catch(() => null)`);
      await sleep(200);
      const li = await evaluate(loginForm(ADMIN, ADMIN_PASS));
      if(li && li.code === 0){
        await cdp.send("Page.navigate", { url: BASE + "/index.html" }, sid);
        await waitInit(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "管理员会话");
        const r = await evaluate(`${apiCall}("DELETE", "./api/admin/users/" + encodeURIComponent(${JSON.stringify(createdUser)}))`);
        console.log(r && r.code === 0 ? "  已删除临时账号" : "  WARN 删除临时账号失败：" + JSON.stringify(r));
      }else{
        console.log("  WARN 清理登录管理员失败：" + JSON.stringify(li));
      }
    }
    try{ ws.close(); }catch(e){ /* noop */ }
  }catch(e){ console.log("  WARN 清理异常：" + e.message); }
  try{ proc.kill("SIGKILL"); }catch(e){ /* noop */ }
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){ /* noop */ }
}
console.log(failed ? ("\n失败 " + failed + " 项") : "\n全部通过");
process.exit(failed ? 1 : 0);