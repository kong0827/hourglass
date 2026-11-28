/* 文档编辑体验批次：粘贴纯文本开关 + 打印剥离划线高亮 + 标签页标题/图片懒加载/md 快捷键 E2E
   覆盖：
     A 粘贴纯文本：开关切换并持久化；开启后富文本粘贴只留纯文本（换行转 <br>、HTML 转义）；
        关闭后恢复富文本粘贴；截图（剪贴板文件）不受影响的路径不拦默认行为。
     B 打印：正文里的划线评论高亮（mark.rrd-hl）不进入打印件；打印样式含标题避孤儿/换行保护/外链补 URL。
     C 标签页标题跟随文档（阅读/编辑/关闭三态还原）、阅读图片 loading="lazy"、
        Markdown 编辑 Ctrl+B/Ctrl+I 包裹记号。
   数据：E2Ews01 + E2Eu01（本批自建账号体系，见 doc-favorite-dup-section.mjs），按 doc_id 精确清理。
   运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh）。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "hourglassdemo";
const WS = "E2Ews01";
const LOGIN_USER = "e2eowner";   // app_user.username；E2Eu01 是 id
const T_PREFIX = "E2E编辑舒适";

const MYSQL = ["/usr/local/mysql/bin/mysql", "-h", "127.0.0.1", "-P", "3307", "-u", "hourglass", "-phourglass123",
  "--default-character-set=utf8mb4", "hourglass", "-N", "-e"];
const sql = q => {
  const r = spawnSync(MYSQL[0], MYSQL.slice(1).concat(q), { encoding: "utf8" });
  if(r.status !== 0) throw new Error("SQL 失败：" + (r.stderr || "").trim());
  return (r.stdout || "").trim();
};
const sqlRaw = q => spawnSync(MYSQL[0], MYSQL.slice(1).concat(q), { encoding: "utf8" });

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KNOWN_GAP_APIS = ["/api/branches/options", "/api/branches/board", "/api/repos"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.resourceErrors = []; this.knownGaps = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Network.responseReceived"){
      const r = msg.params.response || {};
      if(r.status >= 400 && String(r.url).indexOf("favicon") === -1){
        if(isKnownGap(r.url)) this.knownGaps.push(r.status + " " + r.url);
        else this.netErrors.push(r.status + " " + r.url);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(/Failed to load resource/.test(text)){
        if(!isKnownGap(text)) this.resourceErrors.push("console.error: " + text);
      }
      else this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")){
        if(!isKnownGap(e.url || e.text)) this.resourceErrors.push("resource: " + (e.url || "") + " " + e.text);
      }
      else this.errors.push("log: " + e.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id; const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9471);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-comfort-"));
fs.mkdirSync(path.join(tmp, "Default"), { recursive: true });
fs.writeFileSync(path.join(tmp, "Default", "Preferences"), JSON.stringify({
  profile: { password_manager_enabled: false, password_manager_leak_detection: false },
  credentials_enable_service: false, credentials_enable_autosignin: false
}));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];
const BAD_TOASTS = [];
let call, evaluate, waitFor;
const shot = async name => {
  try{ await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`); }catch(e){}
  try{ await evaluate(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
  const s = await Promise.race([call("Page.captureScreenshot", { format: "png" }), sleep(9000).then(() => null)]);
  if(!s){ console.log("  WARN 截图超时，跳过 " + name); return; }
  const out = "/tmp/hg-doccomfort-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
  console.log("  SHOT " + out);
};

const created = { html: null, md: null };
const testDocIds = () => {
  const rows = sqlRaw(`SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`);
  return (rows.stdout || "").trim().split("\n").filter(Boolean);
};
const cleanupArtifacts = ids => {
  if(!ids.length) return;
  const inList = ids.map(i => "'" + i + "'").join(",");
  sql(`DELETE FROM doc_favorite WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM doc_visibility_member WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM req_doc_share WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM requirement_doc_history WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND entity_id IN (${inList})`);
};
const wipeDocs = () => {
  const ids = testDocIds();
  cleanupArtifacts(ids);
  if(ids.length) sql(`DELETE FROM requirement_doc WHERE id IN (${ids.map(i => "'" + i + "'").join(",")})`);
};

try{
  wipeDocs();
  const preDocs = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`);

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
  for(const d of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  try{ await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId); }catch(e){}
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(120);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const watchToasts = () => evaluate(`(() => {
    window.__badToasts = [];
    const w = document.getElementById("toastWrap"); if(!w) return false;
    new MutationObserver(muts => muts.forEach(mu => mu.addedNodes.forEach(n => {
      if(n.nodeType === 1 && /(^|\\s)bad(\\s|$)/.test(n.className)) window.__badToasts.push((n.textContent||"").trim().slice(0,140));
    }))).observe(w, { childList:true });
    return true;
  })()`);
  const drainBad = async () => {
    try{ const b = await evaluate(`(() => { const x = window.__badToasts||[]; window.__badToasts=[]; return x; })()`); BAD_TOASTS.push(...b); }catch(e){}
  };
  const selectWs = async () => {
    const curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    if(curWs === WS) return;
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
  };
  const login = async (user, pw) => {
    await drainBad();
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("uName", ${JSON.stringify(user)}); set("uPass", ${JSON.stringify(pw)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    try{ await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成 " + user, 12000); }
    catch(e){ const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`); throw new Error("登录未完成：" + errMsg); }
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
    await selectWs();
    await watchToasts();
  };
  const showRequirements = async () => {
    await evaluate(`import("./js/core/router.js").then(m => m.showView("requirements")); true`);
    await waitFor(`document.body.dataset.view === "requirements"`, "文档视图", 12000);
    await sleep(350);
  };
  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){
      failed++;
      let where = "";
      try{ where = " @" + String(await evaluate("location.href")).replace(BASE, ""); }catch(_){ where = " @页面状态不可读"; }
      console.log("  ERROR " + name + "：" + e.message + where);
    }
  };

  await login(LOGIN_USER, PASS);
  await section("[准备] 创建样本文档", async () => {
    const ids = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const h = await API.post("/api/req-docs", { title: "${T_PREFIX}-粘贴样本",
        content: "<p>E2E 粘贴样本正文</p>", format: "html", docType: "other", status: "draft", visibility: "team" });
      /* data URI 图片不走网络（避免 404 干扰网络断言），懒加载断言只关心 img 属性 */
      const m = await API.post("/api/req-docs", { title: "${T_PREFIX}-快捷键样本",
        content: "# 标题\\n\\n快捷键样本正文\\n\\n![示意图](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\\n",
        format: "markdown", docType: "other", status: "draft", visibility: "team" });
      return { html: h.id, md: m.id };
    })()`);
    created.html = ids.html;
    created.md = ids.md;
    assert(!!created.html && !!created.md, "两篇样本文档已创建");
  });

  const openEditor = async () => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.html)}))`);
    await waitFor(`!!document.querySelector("#reqDocEditPage .sun-editor-editable") && !document.getElementById("reqDocEditPage").hidden`, "富文本编辑器就绪", 25000);
  };

  await section("[A] 粘贴纯文本开关", async () => {
    await showRequirements();
    await openEditor();
    const chipOk = await evaluate(`(() => {
      const b = document.getElementById("reqDocPastePlain");
      if(!b || b.offsetParent === null) return "missing";
      return b.getAttribute("aria-pressed");
    })()`);
    assert(chipOk === "false", "开关默认关闭（aria-pressed=false）");

    /* 开启开关 */
    await evaluate(`document.getElementById("reqDocPastePlain").click(); true`);
    await sleep(200);
    assert(await evaluate(`document.getElementById("reqDocPastePlain").getAttribute("aria-pressed")`) === "true", "点击后开启");
    assert(await evaluate(`localStorage.getItem("ds.reqDocPastePlain")`) === "1", "偏好写入 localStorage");

    /* 富文本粘贴：text/html 有样式，开启后应只剩纯文本 */
    await evaluate(`(() => {
      const ed = document.querySelector("#reqDocEditPage .sun-editor-editable");
      ed.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", "第一行\\n第二行 <b>不应保留</b>");
      dt.setData("text/html", "<b style=\\"color:red\\">第一行</b><p>第二行 &lt;b&gt;不应保留&lt;/b&gt;</p>");
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(400);
    const onHtml = await evaluate(`document.querySelector("#reqDocEditPage .sun-editor-editable").innerHTML`);
    assert(onHtml.indexOf("第一行") !== -1 && onHtml.indexOf("第二行") !== -1, "开启后纯文本内容进入正文");
    assert(onHtml.indexOf("<br") !== -1, "换行转成 <br>");
    assert(!/<b[ >]/.test(onHtml) && onHtml.indexOf("color:red") === -1, "富文本标签与样式被剥掉");
    assert(onHtml.indexOf("不应保留") !== -1 && onHtml.indexOf("<b>不应保留</b>") === -1, "粘贴内容里的 HTML 字面量按文本处理");
    await shot("paste-plain-on");

    /* 关闭开关：富文本粘贴恢复 */
    await evaluate(`document.getElementById("reqDocPastePlain").click(); true`);
    await sleep(200);
    await evaluate(`(() => {
      const ed = document.querySelector("#reqDocEditPage .sun-editor-editable");
      ed.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", "富文本恢复");
      dt.setData("text/html", "<b>富文本恢复</b>");
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(400);
    const offHtml = await evaluate(`document.querySelector("#reqDocEditPage .sun-editor-editable").innerHTML`);
    /* SunEditor 会把 <b> 规范化为 <strong>，两者都算富文本保留 */
    assert(/<(b|strong)[ >]/.test(offHtml), "关闭后 <b>/<strong> 保留（恢复富文本粘贴）");
    await shot("paste-plain-off");

    /* 偏好持久化：刷新后仍是关（刚才关掉的） */
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "刷新后初始化", 20000);
    assert(await evaluate(`localStorage.getItem("ds.reqDocPastePlain")`) === "0", "刷新后偏好保持关闭");

    /* 收尾：清空正文，避免脏关闭弹窗影响后续 */
    await showRequirements();
    await openEditor();
    await evaluate(`(() => {
      const ed = document.querySelector("#reqDocEditPage .sun-editor-editable");
      ed.innerHTML = "<p>E2E 粘贴样本正文</p>";
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
  });

  await section("[B] 打印剥离划线高亮与版式", async () => {
    /* 在阅读正文里塞一个划线高亮 mark，验证打印剥离；同时拦 window.open 抓打印 HTML */
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocSection(${JSON.stringify(created.html)}, -1)); true`);
    await waitFor(`!!document.querySelector("#reqDocReaderBody") && (document.getElementById("reqDocReaderBody").textContent||"").indexOf("E2E 粘贴样本正文") !== -1`, "阅读器正文就绪", 15000);
    await evaluate(`(() => {
      const body = document.getElementById("reqDocReaderBody");
      const p = body.querySelector("p");
      const mark = document.createElement("mark");
      mark.className = "rrd-hl";
      mark.textContent = "粘贴样本";
      p.firstChild ? p.insertBefore(mark, p.firstChild.nextSibling) : p.appendChild(mark);
      window.__printHtml = null;
      const origOpen = window.open;
      window.open = function(){
        return { document: { write: h => { window.__printHtml = String(h); }, close(){} }, print(){}, closed: false };
      };
      window.__restoreOpen = () => { window.open = origOpen; };
      return true;
    })()`);
    /* 走阅读器「更多 → 打印」真实入口 */
    await evaluate(`(() => { const b = document.querySelector("#reqDocReader [data-rrd-more]"); if(b) b.click(); return true; })()`);
    await sleep(200);
    await evaluate(`(() => { const b = document.querySelector('#reqDocReader [data-rrd-act="print"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!window.__printHtml`, "打印 HTML 已生成", 10000);
    const html = await evaluate(`(() => { const h = window.__printHtml; window.__restoreOpen(); return h; })()`);
    assert(html.indexOf("rrd-hl") === -1, "划线评论高亮不进入打印件");
    assert(html.indexOf("粘贴样本") !== -1, "高亮包裹的文字保留");
    assert(html.indexOf("break-after:avoid") !== -1, "打印样式含标题避孤儿");
    assert(html.indexOf("break-inside:avoid") !== -1, "打印样式含 pre/tr 换行保护");
    assert(html.indexOf('a[href^="http"]::after') !== -1, "打印样式含外链补 URL");
    assert(html.indexOf("E2E 粘贴样本正文") !== -1, "正文进入打印件");
  });

  await section("[C] 标签页标题 / 图片懒加载 / md 快捷键", async () => {
    const titleNow = () => evaluate(`document.title.replace(/^\\(\\d+\\+?\\)\\s*/, "")`);
    /* 阅读态：标题跟随文档名 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocSection(${JSON.stringify(created.md)}, -1)); true`);
    await waitFor(`!!document.querySelector("#reqDocReaderBody img")`, "阅读器正文（含图）就绪", 15000);
    assert((await titleNow()).indexOf("快捷键样本 · 沙漏") !== -1, "阅读态标题跟随文档名");
    /* 懒加载：正文图片带 loading="lazy" */
    const lazy = await evaluate(`(() => {
      const imgs = document.querySelectorAll("#reqDocReaderBody img");
      return { total: imgs.length, lazy: document.querySelectorAll('#reqDocReaderBody img[loading="lazy"]').length };
    })()`);
    assert(lazy.total >= 1 && lazy.lazy === lazy.total, "阅读正文图片全部 loading=lazy（" + lazy.lazy + "/" + lazy.total + "）");

    /* 切回目录态：标题还原为视图标题 */
    await evaluate(`(() => { const b = document.querySelector('#reqDocListPage [data-rdmode="tree"]'); if(b) b.click(); return true; })()`);
    await sleep(400);
    assert((await titleNow()) === "文档 · 沙漏", "离开阅读态标题还原视图标题");

    /* 编辑态：标题跟随 + 快捷键包裹记号 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.md)}))`);
    await waitFor(`!document.getElementById("reqDocEditPage").hidden && (document.getElementById("reqDocMdCanvas") || {}).value
      && document.getElementById("reqDocMdCanvas").value.indexOf("快捷键样本正文") !== -1`, "markdown 编辑器就绪", 20000);
    assert((await titleNow()).indexOf("快捷键样本 · 沙漏") !== -1, "编辑态标题跟随文档名");
    const wrapB = await evaluate(`(() => {
      const ta = document.getElementById("reqDocMdCanvas");
      ta.focus();
      const s = ta.value.indexOf("快捷键");
      ta.setSelectionRange(s, s + 3);
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
      return { value: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd };
    })()`);
    assert(wrapB.value.indexOf("**快捷键**样本正文") !== -1, "Ctrl+B 选中文字包裹 ** 记号");
    assert(wrapB.selEnd - wrapB.selStart === 3 && wrapB.value.slice(wrapB.selStart, wrapB.selEnd) === "快捷键",
      "加粗后选区落在记号内侧的文字上");
    const wrapI = await evaluate(`(() => {
      const ta = document.getElementById("reqDocMdCanvas");
      const s = ta.value.indexOf("样本正文");
      ta.setSelectionRange(s, s + 2);
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "i", metaKey: true, bubbles: true, cancelable: true }));
      return ta.value;
    })()`);
    assert(wrapI.indexOf("*样本*正文") !== -1, "⌘+I 选中文字包裹 * 记号");
    await shot("md-shortcut");

    /* 关闭编辑页（有未保存修改 → 丢弃）后标题还原 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.tryCloseReqDocEditor()); true`);
    await sleep(400);
    await evaluate(`(() => { const b = document.getElementById("dlgReqDocCloseDiscard"); if(b && !b.hidden) b.click(); return true; })()`);
    await waitFor(`document.getElementById("reqDocEditPage").hidden`, "编辑页已关闭", 10000);
    assert((await titleNow()) === "文档 · 沙漏", "关闭编辑页后标题还原视图标题");
  });

  await section("[D] 编辑页查找替换（富文本 + Markdown）", async () => {
    const closeEditorDiscard = async () => {
      await evaluate(`import("./js/views/requirements.js").then(m => m.tryCloseReqDocEditor()); true`);
      await sleep(400);
      await evaluate(`(() => { const b = document.getElementById("dlgReqDocCloseDiscard"); if(b && !b.hidden) b.click(); return true; })()`);
      await waitFor(`document.getElementById("reqDocEditPage").hidden`, "编辑页已关闭", 10000);
    };
    /* Markdown 路径：查找 → 替换当前 → 全部替换 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.md)}))`);
    await waitFor(`!document.getElementById("reqDocEditPage").hidden && (document.getElementById("reqDocMdCanvas") || {}).value
      && document.getElementById("reqDocMdCanvas").value.indexOf("快捷键样本正文") !== -1`, "markdown 编辑器就绪", 20000);
    await evaluate(`(() => {
      const ta = document.getElementById("reqDocMdCanvas");
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(300);
    assert(await evaluate(`!document.getElementById("reqFindBar").hidden`), "Ctrl+F 打开查找条（md）");
    const mdFind = await evaluate(`(() => {
      const fi = document.getElementById("reqFindInput");
      fi.value = "正文";
      fi.dispatchEvent(new Event("input", { bubbles: true }));
      const ta = document.getElementById("reqDocMdCanvas");
      return { cnt: document.getElementById("reqFindCount").textContent,
        selStart: ta.selectionStart, selEnd: ta.selectionEnd,
        selText: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
    })()`);
    assert(mdFind.cnt === "1 / 1" && mdFind.selText === "正文", "md 查找命中 1 处并选中（" + JSON.stringify(mdFind) + "）");
    const mdRepl = await evaluate(`(() => {
      const fr = document.getElementById("reqFindRepl");
      fr.value = "文字";
      fr.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return document.getElementById("reqDocMdCanvas").value;
    })()`);
    assert(mdRepl.indexOf("快捷键样本文字") !== -1, "替换当前（Enter）生效");
    const mdAll = await evaluate(`(() => {
      const fi = document.getElementById("reqFindInput");
      fi.value = "标题";
      fi.dispatchEvent(new Event("input", { bubbles: true }));
      /* 全部替换读的是「替换为」输入框：上一段填过「文字」，这里显式改成「主题」 */
      document.getElementById("reqFindRepl").value = "主题";
      document.querySelector('[data-req-find="replall"]').click();
      return { v: document.getElementById("reqDocMdCanvas").value,
        cnt: document.getElementById("reqFindCount").textContent };
    })()`);
    assert(mdAll.v.indexOf("# 主题") !== -1, "全部替换生效（# 主题）");
    assert(mdAll.cnt.indexOf("已替换 1 处") !== -1, "全部替换计数提示");
    await evaluate(`document.querySelector('[data-req-find="close"]').click(); true`);
    await sleep(200);
    assert(await evaluate(`document.getElementById("reqFindBar").hidden`), "关闭查找条（md）");
    await closeEditorDiscard();

    /* 富文本路径：查找 mark 高亮 → 全部替换 → 高亮不残留 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.html)}))`);
    await waitFor(`!!document.querySelector("#reqDocEditPage .sun-editor-editable") && !document.getElementById("reqDocEditPage").hidden`, "富文本编辑器就绪", 25000);
    await evaluate(`(() => {
      const ed = document.querySelector("#reqDocEditPage .sun-editor-editable");
      ed.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(300);
    assert(await evaluate(`!document.getElementById("reqFindBar").hidden`), "⌘+F 打开查找条（富文本）");
    const richFind = await evaluate(`(() => {
      const fi = document.getElementById("reqFindInput");
      fi.value = "样本";
      fi.dispatchEvent(new Event("input", { bubbles: true }));
      return { hits: document.querySelectorAll("#reqDocEditPage .sun-editor-editable mark.req-hit").length,
        cnt: document.getElementById("reqFindCount").textContent };
    })()`);
    assert(richFind.hits === 1 && richFind.cnt === "1 / 1", "富文本查找 mark 高亮 1 处（" + JSON.stringify(richFind) + "）");
    const richAll = await evaluate(`(() => {
      const fr = document.getElementById("reqFindRepl");
      fr.value = "示例";
      document.querySelector('[data-req-find="replall"]').click();
      const ed = document.querySelector("#reqDocEditPage .sun-editor-editable");
      return { text: ed.textContent, marks: ed.querySelectorAll("mark.req-hit").length,
        cnt: document.getElementById("reqFindCount").textContent };
    })()`);
    assert(richAll.text.indexOf("E2E 粘贴示例正文") !== -1, "富文本全部替换生效");
    assert(richAll.marks === 0, "替换后高亮 mark 不残留");
    assert(richAll.cnt.indexOf("已替换 1 处") !== -1, "富文本替换计数提示");
    await shot("find-replace");
    await closeEditorDiscard();
    assert(await evaluate(`document.getElementById("reqFindBar").hidden`), "关闭编辑页后查找条一并关闭");
  });

  /* 收尾：删样本文档并回读基线 */
  await section("[收尾] 清理与基线", async () => {
    const ids = testDocIds();
    cleanupArtifacts(ids);
    if(ids.length) sql(`DELETE FROM requirement_doc WHERE id IN (${ids.map(i => "'" + i + "'").join(",")})`);
    assert(sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`) === preDocs, "requirement_doc 计数回基线");
    assert(sql(`SELECT COUNT(*) FROM requirement_doc_history h JOIN requirement_doc d ON d.id=h.doc_id WHERE d.workspace_id='${WS}' AND d.title LIKE '${T_PREFIX}%'`) === "0", "历史行无残留");
    assert(sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND detail LIKE '%${T_PREFIX}%'`) === "0", "活动行无残留");
  });

  await drainBad();
  console.log("\n========== 汇总 ==========");
  if(BAD_TOASTS.length){ failed += BAD_TOASTS.length; console.log("红色 toast："); BAD_TOASTS.forEach(t => console.log("  " + t)); }
  if(cdp.errors.length){ failed += cdp.errors.length; console.log("页面错误："); cdp.errors.forEach(t => console.log("  " + t)); }
  if(cdp.netErrors.length){ failed += cdp.netErrors.length; console.log("HTTP 错误："); cdp.netErrors.forEach(t => console.log("  " + t)); }
  if(cdp.resourceErrors.length){ failed += cdp.resourceErrors.length; console.log("资源错误："); cdp.resourceErrors.forEach(t => console.log("  " + t)); }
  if(cdp.knownGaps.length) console.log("已知缺口接口（不计失败）：\n  " + cdp.knownGaps.join("\n  "));
  console.log(failed ? `共 ${failed} 项失败` : "全部通过");
  console.log("截图：\n  " + SHOTS.join("\n  "));
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message));
  process.exitCode = 1;
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
