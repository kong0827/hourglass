/* 文档编辑页就地改标题 E2E
   覆盖：
     A 编辑页头部标题输入框回填文档名、项目名单独展示、非只读时可编辑；
     B 改名 → 脏标记/页面标题/标签页标题同步 → 保存后落库、活动留痕，且只改标题不产生历史版本；
     C 清空标题失焦 → 还原原名并黄色提示；Esc → 还原且不置脏；
     D Markdown 文档标题+正文一起保存（标题与正文各落一份、正文变更留一版历史）；
     E 本地草稿带标题：恢复草稿时标题一并还原并置脏；
     F 切到另一篇文档时输入框重置为该文档标题。
   数据：E2Ews01 + e2eowner（同 doc-edit-comfort.mjs），按 doc_id 精确清理。
   运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh）。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "hourglassdemo";
const WS = "E2Ews01";
const LOGIN_USER = "e2eowner";
const T_PREFIX = "E2E标题编辑";

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

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.resourceErrors = [];
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
        this.netErrors.push(r.status + " " + r.url);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(/Failed to load resource/.test(text)) this.resourceErrors.push("console.error: " + text);
      else this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")) this.resourceErrors.push("resource: " + (e.url || "") + " " + e.text);
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
const port = Number(process.env.E2E_PORT || 9475);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-title-"));
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
  const out = "/tmp/hg-doctitle-" + name + ".png";
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
const docTitleOf = id => sql(`SELECT title FROM requirement_doc WHERE id='${id}'`);

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
  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){
      failed++;
      let where = "";
      try{ where = " @" + String(await evaluate("location.href")).replace(BASE, ""); }catch(_){ where = " @页面状态不可读"; }
      console.log("  ERROR " + name + "：" + e.message + where);
    }
  };
  const openEditor = async id => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(id)}))`);
    await waitFor(`!document.getElementById("reqDocEditPage").hidden && !!document.getElementById("reqDocTitle")
      && document.getElementById("reqDocTitle").value !== ""`, "编辑页与标题框就绪", 25000);
  };
  /* 关闭编辑页：有未保存修改点「不保存」；干净草稿点「留在草稿」 */
  const closeEditorDiscard = async () => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.tryCloseReqDocEditor()); true`);
    await sleep(400);
    await evaluate(`(() => {
      const discard = document.getElementById("dlgReqDocCloseDiscard");
      if(discard && !discard.hidden){ discard.click(); return "discard"; }
      const leave = document.getElementById("dlgReqDocCloseCancel");
      if(leave && leave.textContent === "留在草稿"){ leave.click(); return "leave"; }
      return "none";
    })()`);
    await waitFor(`document.getElementById("reqDocEditPage").hidden`, "编辑页已关闭", 10000);
  };
  const setTitleInput = async value => evaluate(`(() => {
    const el = document.getElementById("reqDocTitle");
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const blurTitleInput = async () => evaluate(`(() => { document.getElementById("reqDocTitle").blur(); return true; })()`);
  const savedText = () => evaluate(`(document.getElementById("reqDocSaved") || {}).textContent || ""`);
  const namedTitle = () => evaluate(`document.title.replace(/^\\(\\d+\\+?\\)\\s*/, "")`);

  await login(LOGIN_USER, PASS);
  await section("[准备] 创建样本文档", async () => {
    const ids = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const h = await API.post("/api/req-docs", { title: "${T_PREFIX}-富文本",
        content: "<p>标题编辑样本正文</p>", format: "html", docType: "other", status: "draft", visibility: "team" });
      const m = await API.post("/api/req-docs", { title: "${T_PREFIX}-第二篇",
        content: "# 第二篇\\n\\n第二篇正文\\n", format: "markdown", docType: "other", status: "draft", visibility: "team" });
      return { html: h.id, md: m.id };
    })()`);
    created.html = ids.html;
    created.md = ids.md;
    assert(!!created.html && !!created.md, "两篇样本文档已创建");
  });

  await section("[A] 编辑页标题框回填与可编辑", async () => {
    await evaluate(`import("./js/core/router.js").then(m => m.showView("requirements")); true`);
    await waitFor(`document.body.dataset.view === "requirements"`, "文档视图", 12000);
    await sleep(300);
    await openEditor(created.html);
    const head = await evaluate(`(() => ({
      title: document.getElementById("reqDocTitle").value,
      disabled: document.getElementById("reqDocTitle").disabled,
      proj: (document.getElementById("reqDocCrumbProj") || {}).textContent || "",
      crumbText: (document.getElementById("reqDocCrumb") || {}).textContent || ""
    }))()`);
    assert(head.title === T_PREFIX + "-富文本", "标题框回填文档名：" + head.title);
    assert(head.disabled === false, "可写用户可编辑标题");
    assert(!!head.proj && head.crumbText.trim().indexOf(head.proj) === 0, "项目名单独展示：" + head.proj);
    await shot("editor-title");
  });

  await section("[B] 改名 → 脏标记 → 保存落库", async () => {
    const newTitle = T_PREFIX + "-富文本（改名）";
    await setTitleInput(newTitle);
    await blurTitleInput();
    await sleep(250);
    assert((await savedText()).indexOf("未保存") !== -1, "标题提交后进入未保存状态");
    assert((await namedTitle()).indexOf("（改名）") !== -1, "标签页标题跟随新标题");
    assert(await evaluate(`(document.getElementById("pageTitleText") || {}).textContent`) === newTitle, "页头标题跟随新标题");
    await shot("title-dirty");

    await evaluate(`document.getElementById("reqDocSave").click(); true`);
    await waitFor(`(document.getElementById("reqDocSaved") || {}).textContent.indexOf("未保存") === -1`, "保存完成", 15000);
    assert(docTitleOf(created.html) === newTitle, "服务端标题已更新：" + docTitleOf(created.html));
    const act = sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'
      AND entity_id='${created.html}' AND detail LIKE '标题：%' AND detail LIKE '%改名%'`);
    assert(act === "1", "活动留痕记录标题变更（" + act + " 行）");
    assert(sql(`SELECT COUNT(*) FROM requirement_doc_history WHERE doc_id='${created.html}'`) === "0", "只改标题不产生历史版本");
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === newTitle, "保存后标题框保持新标题");
  });

  await section("[C] 空标题拦截与 Esc 还原", async () => {
    const kept = T_PREFIX + "-富文本（改名）";
    await setTitleInput("");
    await blurTitleInput();
    await sleep(250);
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === kept, "清空后失焦还原原名");
    const warn = await evaluate(`(() => { const n = document.querySelector("#toastWrap .toast.warn .tmsg"); return n ? n.textContent : ""; })()`);
    assert(warn.indexOf("文档标题不能为空") !== -1, "提示标题不能为空（" + warn + "）");
    assert((await savedText()).indexOf("未保存") === -1, "还原后不置脏");

    await setTitleInput(T_PREFIX + "-临时标题");
    await evaluate(`(() => {
      const el = document.getElementById("reqDocTitle");
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(200);
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === kept, "Esc 还原为已保存标题");
    assert((await savedText()).indexOf("未保存") === -1, "Esc 还原后不置脏");
    assert(docTitleOf(created.html) === kept, "未保存的临时标题没有落库");
  });

  await section("[D] Markdown：标题与正文一起保存", async () => {
    await closeEditorDiscard();
    await openEditor(created.md);
    const newTitle = T_PREFIX + "-第二篇（改）";
    await setTitleInput(newTitle);
    await evaluate(`(() => {
      const ta = document.getElementById("reqDocMdCanvas");
      ta.value = ta.value.replace("第二篇正文", "第二篇正文补一句");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await evaluate(`document.getElementById("reqDocSave").click(); true`);
    await waitFor(`(document.getElementById("reqDocSaved") || {}).textContent.indexOf("未保存") === -1`, "保存完成", 15000);
    assert(docTitleOf(created.md) === newTitle, "标题与正文一起落库");
    assert(sql(`SELECT content LIKE '%补一句%' FROM requirement_doc WHERE id='${created.md}'`) === "1", "正文同步落库");
    assert(sql(`SELECT COUNT(*) FROM requirement_doc_history WHERE doc_id='${created.md}'`) === "1", "正文变更留一版历史");
    await shot("md-title-saved");
  });

  await section("[E] 草稿恢复带标题", async () => {
    await closeEditorDiscard();
    const draftTitle = T_PREFIX + "-草稿标题";
    await evaluate(`(() => {
      localStorage.setItem("hg.docDraft:${created.html}", JSON.stringify({
        content: "<p>草稿正文</p>", title: ${JSON.stringify(draftTitle)}, ts: Date.now(), format: "html" }));
      return true;
    })()`);
    await openEditor(created.html);
    await waitFor(`!!document.getElementById("dlgConfirm") && document.getElementById("dlgConfirm").classList.contains("open")`, "草稿恢复弹窗", 10000);
    await evaluate(`document.getElementById("dlgConfirmOk").click(); true`);
    await sleep(600);
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === draftTitle, "恢复草稿时标题一并还原");
    assert((await savedText()).indexOf("未保存") !== -1, "恢复草稿后置脏");
    await closeEditorDiscard();
    assert(await evaluate(`localStorage.getItem("hg.docDraft:${created.html}")`) == null, "放弃后本地草稿已清理");
    assert(docTitleOf(created.html) === T_PREFIX + "-富文本（改名）", "放弃草稿不改服务端标题");
  });

  await section("[F] 切换文档时标题框重置", async () => {
    await openEditor(created.html);
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === T_PREFIX + "-富文本（改名）", "打开第一篇显示其标题");
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocAndJump(${JSON.stringify(created.md)}))`);
    await waitFor(`document.getElementById("reqDocTitle").value === ${JSON.stringify(T_PREFIX + "-第二篇（改）")}`, "切换后标题重置", 15000);
    assert(await evaluate(`document.getElementById("reqDocTitle").value`) === T_PREFIX + "-第二篇（改）", "切到第二篇显示第二篇标题");
    await evaluate(`document.getElementById("reqDocTitle").focus(); true`);
    await closeEditorDiscard();
  });

  await section("[收尾] 清理与基线", async () => {
    const ids = testDocIds();
    cleanupArtifacts(ids);
    if(ids.length) sql(`DELETE FROM requirement_doc WHERE id IN (${ids.map(i => "'" + i + "'").join(",")})`);
    assert(sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`) === preDocs, "requirement_doc 计数回基线");
    assert(sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND detail LIKE '%${T_PREFIX}%'`) === "0", "活动行无残留");
  });

  await drainBad();
  console.log("\n========== 汇总 ==========");
  if(BAD_TOASTS.length){ failed += BAD_TOASTS.length; console.log("红色 toast："); BAD_TOASTS.forEach(t => console.log("  " + t)); }
  if(cdp.errors.length){ failed += cdp.errors.length; console.log("页面错误："); cdp.errors.forEach(t => console.log("  " + t)); }
  if(cdp.netErrors.length){ failed += cdp.netErrors.length; console.log("HTTP 错误："); cdp.netErrors.forEach(t => console.log("  " + t)); }
  if(cdp.resourceErrors.length){ failed += cdp.resourceErrors.length; console.log("资源错误："); cdp.resourceErrors.forEach(t => console.log("  " + t)); }
  console.log(failed ? `共 ${failed} 项失败` : "全部通过");
  console.log("截图：\n  " + SHOTS.join("\n  "));
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message));
  process.exitCode = 1;
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
