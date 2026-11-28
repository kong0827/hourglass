/* 个人设置「访问令牌」走查：列表、校验、创建（一次性展示）、Bearer 只读/读写边界、撤销后 401、390 布局。
   会创建并撤销两个令牌，名称带时间戳；写接口只发必然被校验拒绝的空体请求，不写业务数据。

   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=... \
       node tools/e2e/token-page.mjs
   需要本机 Chrome / Chromium，也可用 CHROME_BIN 指定。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR
  || path.resolve("docs/audit/prototypes/token-page-2026-11-28");

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
const assert = (cond, msg) => { if(!cond) throw new Error(msg); };
const pass = msg => console.log("  PASS " + msg);

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
    }catch(e){ /* 还没起来 */ }
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

async function main(){
  fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-token-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,1000", "about:blank"
  ], { stdio: "ignore" });

  let cdp, sessionId, token = "", tokenName = "", writeToken = "", writeName = "";
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
    const shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    const size = async (width, height, mobile) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
      await sleep(450);
    };
    /* 走查故意触发：错误密码 400、撤销后旧令牌 401（读 /api/workspaces、写 /api/tasks）、只读/越权写 403、空体写 400；只滤这几类网络日志 */
    const EXPECTED = e => {
      const p = e.params && e.params.entry;
      if(!p || !p.url) return false;
      const text = String(p.text || "");
      return (p.url.indexOf("/api/auth/tokens") >= 0 && text.indexOf("400") >= 0)
        || (p.url.indexOf("/api/workspaces") >= 0 && text.indexOf("401") >= 0)
        || (p.url.indexOf("/api/tasks") >= 0 && (text.indexOf("400") >= 0 || text.indexOf("401") >= 0 || text.indexOf("403") >= 0))
        || (p.url.indexOf("/api/categories") >= 0 && text.indexOf("403") >= 0);
    };
    const noExceptions = label => {
      const bad = cdp.takeExceptions().filter(e => !EXPECTED(e));
      assert(!bad.length, label + " 出现脚本异常：" + JSON.stringify(bad.slice(0, 2)));
    };
    const setValue = (id, v) => evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    const layout = async label => {
      const r = await evaluate(`(() => {
        const view = document.getElementById("view-profile");
        const doc = document.documentElement;
        const wide = [...view.querySelectorAll("*")].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && (b.right > doc.clientWidth + 1 || b.left < -1);
        }).slice(0, 4).map(el => el.className || el.tagName);
        return { scrollW: view.scrollWidth, clientW: view.clientWidth, docW: doc.clientWidth, docScroll: doc.scrollWidth, wide };
      })()`);
      assert(r.scrollW <= r.clientW + 1 && r.docScroll <= r.docW + 1,
        `${label} 横向溢出：${JSON.stringify(r)}`);
    };

    console.log("访问令牌走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

    /* 1. 登录并进入个人设置 */
    await navigate(BASE + "/login.html");
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
    await setValue("uName", USER);
    await setValue("uPass", PASS);
    await evaluate("document.getElementById('btnLogin').click(); true");
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body && document.body.dataset.view`, "登录完成", 25000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);
    pass("登录 " + USER);

    await navigate(BASE + "/index.html#/profile");
    await waitFor(`document.body.dataset.view === "profile"`, "个人设置页");
    await waitFor(`(() => {
      const box = document.getElementById("meTokenList");
      return box && (box.querySelector(".token-row") || box.querySelector(".token-empty"));
    })()`, "令牌列表加载");
    assert(await evaluate(`!!document.querySelector('#meAnchor a[href="#me-token"]')`), "分区导航缺少「访问令牌」");
    assert(await evaluate(`document.getElementById("meTokenReveal").hidden === true`), "进入页面不应显示令牌明文");
    await layout("1440 个人设置");
    await evaluate(`document.getElementById("me-token").scrollIntoView({ block: "start" }); true`);
    await sleep(300);
    await shot("impl-1440-profile");
    pass("令牌列表与分区导航可用");
    noExceptions("进入个人设置");

    /* 2. 空表单校验 */
    await setValue("meTokenName", "");
    await setValue("meTokenPwd", "");
    await evaluate("document.getElementById('meTokenCreate').click(); true");
    assert(await evaluate(`document.getElementById("fMeTokenName").classList.contains("invalid")`), "空名称未提示");
    assert(await evaluate(`document.getElementById("fMeTokenPwd").classList.contains("invalid")`), "空密码未提示");
    pass("空名称 / 空密码就地提示");

    /* 3. 错误密码：不创建，提示后端错误 */
    tokenName = "E2E 令牌 " + Date.now().toString(36);
    await setValue("meTokenName", tokenName);
    await setValue("meTokenPwd", "definitely-wrong-pass");
    await evaluate("document.getElementById('meTokenCreate').click(); true");
    await waitFor(`(() => {
      const t = [...document.querySelectorAll(".toast")].map(el => el.textContent).join(" ");
      return t.indexOf("当前密码不正确") >= 0;
    })()`, "错误密码提示");
    assert(await evaluate(`document.getElementById("meTokenReveal").hidden === true`), "错误密码不应展示令牌");
    pass("错误密码被拒绝");

    /* 4. 正确密码创建：明文只显示一次，Bearer 可读 */
    await setValue("meTokenPwd", PASS);
    await evaluate("document.getElementById('meTokenCreate').click(); true");
    await waitFor(`!document.getElementById("meTokenReveal").hidden`, "令牌展示区");
    token = await evaluate(`document.getElementById("meTokenValue").textContent.trim()`);
    assert(/^hg_[A-Za-z0-9_-]{40,}$/.test(token), "令牌格式异常：" + token);
    await waitFor(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(tokenName)});
      return !!(row && row.querySelector(".t-scope") && row.querySelector(".t-state"));
    })()`, "新令牌入列");
    await sleep(150);
    const rowState = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(tokenName)});
      return { state: row.querySelector(".t-state").textContent, scope: row.querySelector(".t-scope").textContent, prefix: row.querySelector(".t-name small").textContent };
    })()`);
    assert(rowState.state === "有效", "新令牌状态异常：" + rowState.state);
    assert(rowState.scope === "只读", "默认权限异常：" + rowState.scope);
    assert(token.indexOf(rowState.prefix.replace("…", "")) === 0, "列表前缀与明文不一致");
    const okStatus = await evaluate(`fetch(${JSON.stringify(BASE + "/api/workspaces")}, { headers: { Authorization: "Bearer " + ${JSON.stringify(token)} } }).then(r => r.status)`);
    assert(okStatus === 200, "令牌读取 /api/workspaces 失败：" + okStatus);
    await shot("impl-1440-created");
    pass("创建成功，列表与明文前缀一致，Bearer 读取 200");

    /* 5. 离开再回来：明文不再展示（只显示一次） */
    await evaluate(`import("./js/core/router.js").then(({showView}) => { showView("mine"); return true; })`);
    await waitFor(`document.body.dataset.view === "mine"`, "离开个人设置");
    await evaluate(`import("./js/core/router.js").then(({showView}) => { showView("profile"); return true; })`);
    await waitFor(`document.body.dataset.view === "profile"`, "回到个人设置");
    await waitFor(`!!document.querySelector("#meTokenList .token-row")`, "列表重新渲染");
    assert(await evaluate(`document.getElementById("meTokenReveal").hidden === true && !document.getElementById("meTokenValue").textContent`), "再次进入仍显示明文");
    pass("再次进入不再展示明文");

    /* 5.5 读写令牌：写白名单内放行到参数校验，白名单外与只读令牌一律 403 */
    const postJson = (rawToken, path, body) => evaluate(`fetch(${JSON.stringify(BASE + path)}, {
      method: "POST", credentials: "omit",
      headers: { Authorization: "Bearer " + ${JSON.stringify(rawToken)}, "Content-Type": "application/json" },
      body: JSON.stringify(${JSON.stringify(body)})
    }).then(async r => ({ status: r.status, body: await r.text() }))`);
    const readPost = await postJson(token, "/api/tasks", {});
    assert(readPost.status === 403 && readPost.body.indexOf("只读令牌") >= 0,
      "只读令牌可写或提示不对：" + JSON.stringify(readPost));

    writeName = "E2E 读写令牌 " + Date.now().toString(36);
    await setValue("meTokenName", writeName);
    await setValue("meTokenScope", "write");
    await setValue("meTokenPwd", PASS);
    await evaluate("document.getElementById('meTokenCreate').click(); true");
    await waitFor(`!document.getElementById("meTokenReveal").hidden`, "读写令牌展示区");
    writeToken = await evaluate(`document.getElementById("meTokenValue").textContent.trim()`);
    assert(/^hg_[A-Za-z0-9_-]{40,}$/.test(writeToken), "读写令牌格式异常");
    await waitFor(`[...document.querySelectorAll("#meTokenList .t-name b")].some(el => el.textContent === ${JSON.stringify(writeName)})`, "读写令牌入列");
    const writeRow = await evaluate(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(writeName)});
      return row.querySelector(".t-scope").textContent;
    })()`);
    assert(writeRow === "读写", "读写令牌权限列异常：" + writeRow);

    const allowedWrite = await postJson(writeToken, "/api/tasks", {});
    assert(allowedWrite.status === 400 && allowedWrite.body.indexOf("请填写任务标题") >= 0,
      "白名单写未进入参数校验：" + JSON.stringify(allowedWrite));
    const blockedWrite = await postJson(writeToken, "/api/categories", {});
    assert(blockedWrite.status === 403 && blockedWrite.body.indexOf("无权执行该写操作") >= 0,
      "白名单外写未被拒绝：" + JSON.stringify(blockedWrite));
    pass("只读令牌写 403；读写令牌白名单内到校验、白名单外 403");

    /* 6. 撤销：确认框 → 行变已撤销 → 旧令牌 401 */
    const revokeRow = rawName => evaluate(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(rawName)});
      row.querySelector("[data-token-revoke]").click();
      return true;
    })()`);
    await revokeRow(tokenName);
    await waitFor(`!!document.querySelector("#dlgConfirm.open")`, "撤销确认框");
    await evaluate("document.getElementById('dlgConfirmOk').click(); true");
    await waitFor(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(tokenName)});
      return row && row.querySelector(".t-state").textContent === "已撤销";
    })()`, "令牌变为已撤销");
    await revokeRow(writeName);
    await waitFor(`!!document.querySelector("#dlgConfirm.open")`, "读写令牌撤销确认框");
    await evaluate("document.getElementById('dlgConfirmOk').click(); true");
    await waitFor(`(() => {
      const rows = [...document.querySelectorAll("#meTokenList .token-row")];
      const row = rows.find(r => r.querySelector(".t-name b").textContent === ${JSON.stringify(writeName)});
      return row && row.querySelector(".t-state").textContent === "已撤销";
    })()`, "读写令牌变为已撤销");
    const revokedStatus = await evaluate(`fetch(${JSON.stringify(BASE + "/api/workspaces")}, { headers: { Authorization: "Bearer " + ${JSON.stringify(token)} } }).then(r => r.status)`);
    assert(revokedStatus === 401, "撤销后仍可访问：" + revokedStatus);
    const revokedWrite = await postJson(writeToken, "/api/tasks", {});
    assert(revokedWrite.status === 401, "撤销后写令牌仍可访问：" + JSON.stringify(revokedWrite));
    pass("撤销后列表标记已撤销，只读与读写令牌均 401");

    /* 6.1 清理历史失败跑留下的同名令牌，避免演示库越积越多 */
    const leftovers = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const d = await API.get("/api/auth/tokens");
      const rest = ((d && d.tokens) || []).filter(t => !t.revokedAt && t.name.indexOf("E2E ") === 0);
      for(const t of rest) await API.del("/api/auth/tokens/" + encodeURIComponent(t.id));
      return rest.length;
    })()`);
    pass("清理历史 E2E 令牌 " + leftovers + " 个");

    /* 7. 390：表头收起、行竖排、无横向溢出 */
    await size(390, 900, true);
    await layout("390 个人设置");
    await evaluate(`document.getElementById("me-token").scrollIntoView({ block: "start" }); true`);
    await sleep(300);
    const mobile = await evaluate(`(() => {
      const head = document.querySelector("#meTokenList .token-head");
      const row = document.querySelector("#meTokenList .token-row");
      const state = row.querySelector(".t-state");
      const name = row.querySelector(".t-name");
      return {
        headHidden: !head || getComputedStyle(head).display === "none",
        belowName: state.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 2,
        scopePrefix: getComputedStyle(row.querySelector(".t-scope"), "::before").content,
        expPrefix: getComputedStyle(row.querySelector(".t-exp"), "::before").content
      };
    })()`);
    assert(mobile.headHidden, "390 仍显示表头");
    assert(mobile.belowName, "390 状态未排到名称下方");
    assert(mobile.scopePrefix.indexOf("权限") >= 0, "390 权限缺少文字标签");
    assert(mobile.expPrefix.indexOf("到期") >= 0, "390 到期缺少文字标签");
    await shot("impl-390-profile");
    pass("390 行卡片化、权限/到期有标签、无横向溢出");

    noExceptions("全程");
    console.log(`\n全部通过（只读令牌 ${tokenName}、读写令牌 ${writeName} 均已撤销）`);
  } finally {
    try{ child.kill("SIGKILL"); }catch(e){ /* ignore */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("\n失败：" + err.message);
  process.exit(1);
});