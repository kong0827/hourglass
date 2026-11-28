/* 反链面板批次 E2E：正文引用文档 + 阅读页「引用 / 被引用」
   覆盖：
     A 编辑页「引用」按钮：picker 搜索并插入 Markdown 站内链接（hgdoc://），保存后落 doc_link；
     B 阅读页「被引用」：目标文档底部出现来源文档，点击跳转到来源（阅读态）；
     C 阅读页「引用」+ 正文链接点击：出链列表与正文 hgdoc:// 点击都走应用内跳转；
     D 权限占位：收窄可见范围后，无权查看的引用只显示计数与「不可见」文案，不泄露标题。
   数据：E2Ews01 + e2eowner / e2eout，按 doc_id 精确清理（含 doc_link）。
   运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh），且本地库已执行 sql/135_doc_link.sql。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "hourglassdemo";
const WS = "E2Ews01";
const LOGIN_USER = "e2eowner";
const VIEWER_USER = "e2eout";
const T_PREFIX = "E2E反链";

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
const port = Number(process.env.E2E_PORT || 9473);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-links-"));
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

let call, evaluate, waitFor;
try{
  const ids0 = (sqlRaw(`SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`).stdout || "")
    .trim().split("\n").filter(Boolean);
  if(ids0.length){
    const inList = ids0.map(i => "'" + i + "'").join(",");
    sql(`DELETE FROM doc_link WHERE from_doc_id IN (${inList}) OR to_doc_id IN (${inList})`);
    sql(`DELETE FROM doc_favorite WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM doc_visibility_member WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM req_doc_share WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM requirement_doc_history WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND entity_id IN (${inList})`);
    sql(`DELETE FROM requirement_doc WHERE id IN (${inList})`);
  }
  const preLinks = sql(`SELECT COUNT(*) FROM doc_link WHERE workspace_id='${WS}'`);

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
  const selectWs = async () => {
    const curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    if(curWs === WS) return;
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
  };
  const login = async (user, pw) => {
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
  };
  const showRequirements = async () => {
    await evaluate(`import("./js/core/router.js").then(m => m.showView("requirements")); true`);
    await waitFor(`document.body.dataset.view === "requirements"`, "文档视图", 12000);
    await sleep(350);
  };
  /* 阅读态打开文档（与 openReqDocSection 同路径但不滚动章节） */
  const openReader = async id => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocSection(${JSON.stringify(id)}, -1)); true`);
    await waitFor(`!!document.querySelector("#reqDocReader .rrd-head")`, "阅读页打开", 15000);
  };
  /* 触发懒加载的关联区取数（IntersectionObserver 需要元素入视口） */
  const loadRel = async () => {
    await evaluate(`(() => { const el = document.getElementById("rrdRel"); if(el) el.scrollIntoView({ block: "end" }); window.scrollBy(0, 160); return true; })()`);
    await sleep(700);
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

  const created = {};
  await login(LOGIN_USER, PASS);
  await section("[准备] 创建三篇样本文档", async () => {
    const ids = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const a = await API.post("/api/req-docs", { title: "${T_PREFIX}-A来源",
        content: "# A来源\\n\\n正文占位\\n", format: "markdown", docType: "other", status: "draft", visibility: "team" });
      const b = await API.post("/api/req-docs", { title: "${T_PREFIX}-B目标",
        content: "<p>B目标正文占位</p>", format: "html", docType: "other", status: "draft", visibility: "team" });
      const c = await API.post("/api/req-docs", { title: "${T_PREFIX}-C私密",
        content: "# C私密\\n\\n占位\\n", format: "markdown", docType: "other", status: "draft", visibility: "personal" });
      await API.put("/api/req-docs/" + encodeURIComponent(c.id) + "/publish", { published: true });
      return { a: a.id, b: b.id, c: c.id };
    })()`);
    Object.assign(created, ids);
    assert(!!created.a && !!created.b && !!created.c, "A/B/C 三篇样本文档已创建，C 已发布且仅负责人可见");
  });

  await section("[A] 引用按钮 + picker 插入（Markdown）", async () => {
    await showRequirements();
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.a)}))`);
    await waitFor(`!!document.getElementById("reqDocMdCanvas") && !document.getElementById("reqDocEditPage").hidden`, "Markdown 编辑器就绪", 20000);
    assert(await evaluate(`!!document.getElementById("reqDocRefBtn")`), "「引用」按钮已注入编辑页工具栏");
    await evaluate(`document.getElementById("reqDocRefBtn").click(); true`);
    await waitFor(`document.getElementById("dlgReqRefPick").classList.contains("open")`, "引用选择弹框打开", 8000);
    const input = "reqRefPickQuery";
    await evaluate(`(() => { const el = document.getElementById(${JSON.stringify(input)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "B目标");
      el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await waitFor(`!!document.querySelector('#reqRefPickList [data-ref-pick]')`, "搜索结果出现", 10000);
    await evaluate(`document.querySelector('#reqRefPickList [data-ref-pick]').click(); true`);
    await waitFor(`!document.getElementById("dlgReqRefPick").classList.contains("open")`, "选择后弹框关闭", 8000);
    const md = await evaluate(`document.getElementById("reqDocMdCanvas").value`);
    assert(md.includes("](hgdoc://" + created.b + ")") && md.includes("B目标"), "Markdown 正文插入 [标题](hgdoc://id) 站内链接");
    await evaluate(`document.getElementById("reqDocSave").click(); true`);
    let n = "0";
    for(let i = 0; i < 50 && n !== "1"; i++){
      await sleep(200);
      n = sql(`SELECT COUNT(*) FROM doc_link WHERE workspace_id='${WS}' AND from_doc_id='${created.a}' AND to_doc_id='${created.b}'`);
    }
    assert(n === "1", "保存后 doc_link 落库（A → B）");
  });

  await section("[B] 被引用面板（B 视角）", async () => {
    await openReader(created.b);
    await loadRel();
    await waitFor(`!!document.querySelector('#rrdRelBacklinks [data-doc-link]')`, "被引用列表出现来源文档", 10000);
    const row = await evaluate(`(() => { const r = document.querySelector('#rrdRelBacklinks [data-doc-link]');
      return { id: r.dataset.docLink, text: r.textContent }; })()`);
    assert(row.id === created.a && row.text.includes("A来源"), "被引用行指向 A 且标题可见");
    const cnt = await evaluate(`document.getElementById("rrdRelBacklinkCount").textContent`);
    assert(cnt.includes("1"), "被引用计数为 1（" + cnt + "）");
    await evaluate(`document.querySelector('#rrdRelBacklinks [data-doc-link]').click(); true`);
    await waitFor(`(() => { const h = document.querySelector("#reqDocReader .rrd-head"); return h && h.textContent.includes("A来源"); })()`, "点击被引用跳到 A 阅读页", 12000);
    await loadRel();
    await waitFor(`!!document.querySelector('#rrdRelLinks [data-doc-link="${created.b}"]')`, "A 阅读页「引用」列表出现 B", 10000);
    assert(true, "A 阅读页「引用」列表出现 B");
  });

  await section("[C] 正文 hgdoc:// 点击跳转", async () => {
    await waitFor(`!!document.querySelector('.rrd-body a[href^="hgdoc://"]')`, "正文渲染出站内链接", 10000);
    const href = await evaluate(`document.querySelector('.rrd-body a[href^="hgdoc://"]').getAttribute("href")`);
    assert(href === "hgdoc://" + created.b, "正文链接 href 为 hgdoc://" + created.b);
    await evaluate(`document.querySelector('.rrd-body a[href^="hgdoc://"]').click(); true`);
    await waitFor(`(() => { const t = document.querySelector(".rrd-head .rrd-title-row, .rrd-head"); return t && t.textContent.includes("B目标"); })()`, "点击正文链接跳到 B 阅读页", 12000);
  });

  await section("[D] 权限占位（viewer 视角）", async () => {
    /* owner 用 D 团队文档引用 C（个人已发布） */
    const dId = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const d = await API.post("/api/req-docs", { title: "${T_PREFIX}-D引用私密",
        content: "# D引用私密\\n\\n见 [C私密](hgdoc://${created.c})\\n", format: "markdown", docType: "other", status: "draft", visibility: "team" });
      await API.put("/api/req-docs/" + encodeURIComponent(d.id) + "/publish", { published: true });
      return d.id;
    })()`);
    created.d = dId;
    const n = sql(`SELECT COUNT(*) FROM doc_link WHERE workspace_id='${WS}' AND from_doc_id='${created.d}' AND to_doc_id='${created.c}'`);
    assert(n === "1", "API 建文档时服务端解析引用落库（D → C）");
    await login(VIEWER_USER, PASS);
    await showRequirements();
    await openReader(created.d);
    await loadRel();
    await waitFor(`(() => { const l = document.getElementById("rrdRelLinks"); return !!l && !l.innerHTML.includes("加载中"); })()`, "引用区取数完成", 10000);
    const links = await evaluate(`(() => { const l = document.getElementById("rrdRelLinks");
      return { visible: l.querySelectorAll("[data-doc-link]").length, html: l.innerHTML }; })()`);
    assert(links.visible === 0, "viewer 看不到 C 的引用行（visible=0）");
    assert(links.html.includes("另有 1 处引用不可见"), "viewer 看到「另有 1 处引用不可见」占位");
    assert(!links.html.includes("C私密"), "占位不泄露 C 的标题");
  });

  /* 计数以 owner 登录回一致口径 */
  await login(LOGIN_USER, PASS);
  const postLinks = sql(`SELECT COUNT(*) FROM doc_link WHERE workspace_id='${WS}'`);
  assert(postLinks - Number(preLinks) === 2, `doc_link 净增 2（实际 ${postLinks - Number(preLinks)}）`);

  const ids = (sqlRaw(`SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`).stdout || "")
    .trim().split("\n").filter(Boolean);
  if(ids.length){
    const inList = ids.map(i => "'" + i + "'").join(",");
    sql(`DELETE FROM doc_link WHERE from_doc_id IN (${inList}) OR to_doc_id IN (${inList})`);
    sql(`DELETE FROM doc_favorite WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM doc_visibility_member WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM req_doc_share WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM requirement_doc_history WHERE doc_id IN (${inList})`);
    sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND entity_id IN (${inList})`);
    sql(`DELETE FROM requirement_doc WHERE id IN (${inList})`);
  }
  console.log("\n  CLEANUP 样本文档与 doc_link 已清理：" + ids.length + " 篇");

  const errs = cdp.errors.concat(cdp.netErrors, cdp.resourceErrors);
  assert(errs.length === 0, "无 JS 异常 / 4xx+ / 资源错误" + (errs.length ? "：" + errs.slice(0, 5).join(" | ") : ""));
}catch(e){
  failed++;
  console.log("  FATAL " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
console.log(failed === 0 ? "\nALL PASS" : "\n" + failed + " FAILED");
process.exit(failed === 0 ? 0 : 1);
