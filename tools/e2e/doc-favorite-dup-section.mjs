/* 文档批次：我的（最近访问+收藏）/ 复制文档 / 章节级搜索直达 E2E
   覆盖：
     A 收藏：接口收藏/取消回显 favored；阅读器星标按钮切换；收藏列表口径与可见范围一致。
     B 我的 tab：最近访问（localStorage top10）与收藏两段；行内取消收藏即时移除。
     C 复制：接口复制出草稿副本（标题+副本、负责人=操作者、名单随档复制、收藏不复制）；
        阅读器更多菜单与右键菜单两个 UI 入口。
     D 章节直达：全局搜索返回 section+head；openReqDocSection 深链 ?h=N 滚动并高亮标题。
   数据：支付业务部演示库，所有文档由脚本创建、收尾按 doc_id 精确清理（含收藏/名单/分享/历史/活动行），
   不改动既有文档。运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh）。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "hourglassdemo";
const OWNER = "e2eowner";      // E2E 专用空间管理员
const LISTED = "e2elisted";    // 名单内成员
const OUTSIDER = "e2eout";     // 名单外成员

/* 2026-11-24 重灌演示库后旧 E2E 账号失效（见项目记忆「生产演示数据」）；
   本脚本使用自建专用空间 E2Ews01 + 三个专用账号（密码 hourglassdemo），与演示数据零交叉。 */
const WS = "E2Ews01";                                   // E2E文档批次
const UID = {
  owner: "E2Eu01",
  listed: "E2Eu02",
  outsider: "E2Eu03"
};
const T_PREFIX = "E2E收藏复制章节";

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

/* 本地库尚未执行他人未提交批次的 sql/98（project_repo / dev_branch.outcome），
   分支/仓库接口在应用初始化时 500；与本批无关，单独归桶、如实登记。 */
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
      /* 收藏不可见文档故意吃到 404，由断言单独核对，不归入网络错误桶 */
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
const port = Number(process.env.E2E_PORT || 9469);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-fav-"));
/* 表单登录的「保存密码」气泡会抢占 headless 浏览器级输入焦点，一次性 profile 里关掉密码管理器 */
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
let call, evaluate, waitFor, apiTry;
const shot = async (name, keepToast) => {
  if(!keepToast){
    try{ await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`); }catch(e){}
  }
  try{ await evaluate(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`); }catch(e){}
  const s = await Promise.race([call("Page.captureScreenshot", { format: "png" }), sleep(9000).then(() => null)]);
  if(!s){ console.log("  WARN 截图超时，跳过 " + name); return; }
  const out = "/tmp/hg-docfds-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
  console.log("  SHOT " + out);
};

const created = { md: null, team: null, members: null, dupApi: null, dupUi: null };
let wiped = false;
const testDocIds = () => {
  const rows = sqlRaw(`SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`);
  return (rows.stdout || "").trim().split("\n").filter(Boolean);
};
/* 文档按 doc_id 精确清理：收藏 / 名单 / 分享 / 历史 / 活动行都不留 residue（动态流不残留测试记录） */
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
  /* 上次中断可能已删文档、留下收藏行：按 workspace 兜底清掉指向测试文档的收藏 */
  sql(`DELETE f FROM doc_favorite f JOIN requirement_doc d ON d.id=f.doc_id
       WHERE d.workspace_id='${WS}' AND d.title LIKE '${T_PREFIX}%'`);
  sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND detail LIKE '%${T_PREFIX}%'`);
  wiped = true;
};

try{
  wipeDocs();
  const preDocs = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`);
  const preFavs = sql(`SELECT COUNT(*) FROM doc_favorite WHERE workspace_id='${WS}'`);
  const preActs = sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'`);

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
  /* 故意失败/404 的调用走这里：返回 {ok, code, message}，不发 console.error */
  apiTry = async expr => evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    try { return { ok: true, data: (${expr}) }; }
    catch(e){ return { ok: false, code: e.code || 0, message: e.message || "" }; }
  })()`);
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
  const clickSel = async sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){
      failed++;
      let where = "";
      try{ where = " @" + String(await evaluate("location.href")).replace(BASE, ""); }catch(_){ where = " @页面状态不可读"; }
      console.log("  ERROR " + name + "：" + e.message + where);
    }
  };
  const docIds = () => Object.entries(created).filter(([, v]) => v).map(([, v]) => v);
  /* 打开阅读器并等正文就绪（openReqDocAndJump 开的是编辑页；阅读模式走 openReqDocSection 的 -1 分支） */
  const openReader = async id => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.loadReqDocs(true))`);
    await showRequirements();
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocSection(${JSON.stringify(id)}, -1))`);
    await waitFor(`!!document.querySelector('#reqDocReader [data-rrd-fav]')`, "阅读器打开", 15000);
  };

  /* 建样本：markdown 章节文档（team）+ 指定成员文档（members 含李娜） */
  await login(OWNER, PASS);
  await section("[准备] 创建样本文档", async () => {
    const res = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const mdContent = "# 背景\\n\\n本节介绍结算背景与术语。\\n\\n## 结算流程\\n\\n第一步对账，第二步结算，第三步打款。\\n\\n## 退款规则\\n\\n退款原路返回，七个工作日内到账。";
      const md = await API.post("/api/req-docs", { title: "${T_PREFIX}-章节样本",
        content: mdContent, format: "markdown", docType: "requirement", status: "draft", visibility: "team" });
      const team = await API.post("/api/req-docs", { title: "${T_PREFIX}-团队共享",
        content: "<p>E2E 收藏复制样本</p>", format: "html", docType: "requirement", status: "draft", visibility: "team" });
      const mem = await API.post("/api/req-docs", { title: "${T_PREFIX}-指定成员",
        content: "<p>E2E 收藏复制样本</p>", format: "html", docType: "requirement", status: "draft",
        visibility: "members", memberIds: [${JSON.stringify(UID.listed)}] });
      for (const d of [md, team, mem]) await API.put("/api/req-docs/" + encodeURIComponent(d.id) + "/publish", { published: true });
      return { md: md.id, team: team.id, members: mem.id };
    })()`);
    created.md = res.md; created.team = res.team; created.members = res.members;
    assert(created.md && created.team && created.members, "三篇样本文档创建并发布");
    assert(sql(`SELECT COUNT(*) FROM requirement_doc WHERE id='${created.md}' AND format='markdown' AND published_at IS NOT NULL`) === "1",
      "库：markdown 样本已发布");
  });

  await section("[A] 收藏：接口与星标 UI", async () => {
    /* 接口三连：收藏 → 详情回显 → 列表含 → 取消 → 列表空 */
    const fav = await apiTry(`await API.put("/api/req-docs/${created.team}/favorite", {})`);
    assert(fav.ok && fav.data && fav.data.favored === true, "PUT favorite 回显 favored=true");
    const detail = await apiTry(`await API.get("/api/req-docs/${created.team}")`);
    assert(detail.ok && detail.data.favored === true, "详情接口回显 favored=true");
    const list = await apiTry(`await API.getAllPages("/api/req-docs/favorites", { probe: Date.now() })`);
    assert(list.ok && list.data.some(r => r.id === created.team), "收藏列表含该文档");
    const again = await apiTry(`await API.put("/api/req-docs/${created.team}/favorite", {})`);
    assert(again.ok && sql(`SELECT COUNT(*) FROM doc_favorite WHERE doc_id='${created.team}' AND user_id='${UID.owner}'`) === "1",
      "重复收藏幂等（库中仅一行）");
    const unfav = await apiTry(`await API.del("/api/req-docs/${created.team}/favorite")`);
    assert(unfav.ok && unfav.data && unfav.data.favored === false, "DELETE favorite 回显 favored=false");
    const list2 = await apiTry(`await API.getAllPages("/api/req-docs/favorites", { probe: Date.now() + 1 })`);
    assert(list2.ok && !list2.data.some(r => r.id === created.team), "取消后收藏列表不含该文档");
    /* 名单外成员收藏指定成员文档：可见性校验 404 */
    await login(OUTSIDER, PASS);
    const blocked = await apiTry(`await API.put("/api/req-docs/${created.members}/favorite", {})`);
    assert(!blocked.ok && blocked.code === 404, "名单外成员收藏被 404 拒绝");
    await login(OWNER, PASS);
    /* 星标 UI */
    await openReader(created.team);
    const star = await evaluate(`(() => { const b = document.querySelector('#reqDocReader [data-rrd-fav]');
      return { pressed: b.getAttribute("aria-pressed"), cls: b.className }; })()`);
    assert(star.pressed === "false" && star.cls.indexOf("is-fav") < 0, "阅读器星标初始未收藏态");
    await clickSel("#reqDocReader [data-rrd-fav]");
    await waitFor(`document.querySelector('#reqDocReader [data-rrd-fav]').getAttribute("aria-pressed") === "true"`, "星标切换为已收藏", 8000);
    assert(sql(`SELECT COUNT(*) FROM doc_favorite WHERE doc_id='${created.team}' AND user_id='${UID.owner}'`) === "1", "库：星标点击落收藏");
    await clickSel("#reqDocReader [data-rrd-fav]");
    await waitFor(`document.querySelector('#reqDocReader [data-rrd-fav]').getAttribute("aria-pressed") === "false"`, "星标切换回未收藏", 8000);
    assert(sql(`SELECT COUNT(*) FROM doc_favorite WHERE doc_id='${created.team}' AND user_id='${UID.owner}'`) === "0", "库：再点取消收藏");
    await shot("reader-star");
  });

  await section("[B] 收藏列表跟随可见范围", async () => {
    /* 李娜收藏指定成员文档（她在名单内）→ 列表有；负责人收窄为仅自己 → 李娜列表消失 */
    await login(LISTED, PASS);
    const fav = await apiTry(`await API.put("/api/req-docs/${created.members}/favorite", {})`);
    assert(fav.ok && fav.data.favored === true, "名单内成员可收藏指定成员文档");
    const before = await apiTry(`await API.getAllPages("/api/req-docs/favorites", { probe: Date.now() })`);
    assert(before.ok && before.data.some(r => r.id === created.members), "收窄前名单内成员收藏列表含该文档");
    await login(OWNER, PASS);
    const narrow = await apiTry(`await API.put("/api/req-docs/${created.members}/visibility", { visibility: "personal", memberIds: [] })`);
    assert(narrow.ok && narrow.data.visibility === "personal", "负责人收窄为仅自己");
    await login(LISTED, PASS);
    const after = await apiTry(`await API.getAllPages("/api/req-docs/favorites", { probe: Date.now() + 1 })`);
    assert(after.ok && !after.data.some(r => r.id === created.members), "收窄后名单内成员收藏列表不再含该文档（口径与可见范围一致）");
    const detail = await apiTry(`await API.get("/api/req-docs/${created.members}")`);
    assert(!detail.ok && detail.code === 404, "收窄后李娜直读 404");
    /* 还原 team 档，便于后续复制名单断言 */
    await login(OWNER, PASS);
    const restore = await apiTry(`await API.put("/api/req-docs/${created.members}/visibility",
      { visibility: "members", memberIds: [${JSON.stringify(UID.listed)}] })`);
    assert(restore.ok && restore.data.visibility === "members", "收窄样本还原为指定成员档");
  });

  await section("[C] 复制文档", async () => {
    /* 接口复制：草稿副本 + 负责人=操作者 + 名单随档 + 收藏不复制 */
    await apiTry(`await API.put("/api/req-docs/${created.team}/favorite", {})`);
    const dup = await apiTry(`await API.post("/api/req-docs/${created.team}/duplicate", {})`);
    assert(dup.ok && dup.data, "POST duplicate 成功");
    created.dupApi = dup.data.id;
    assert(dup.data.title === T_PREFIX + "-团队共享 副本", "副本标题为「原标题 副本」（实际：" + dup.data.title + "）");
    assert(dup.data.status === "draft" && !dup.data.publishedAt, "副本为草稿未发布");
    assert(dup.data.ownerUserId === UID.owner, "副本负责人=操作者（实际：" + dup.data.ownerUserId + "）");
    assert(!dup.data.favored, "副本不带收藏标记");
    const memDup = await apiTry(`await API.post("/api/req-docs/${created.members}/duplicate", {})`);
    assert(memDup.ok && (memDup.data.memberIds || []).indexOf(UID.listed) >= 0,
      "指定成员档副本复制名单（实际：" + JSON.stringify(memDup.data && memDup.data.memberIds) + "）");
    created.dupUi = memDup.data.id;
    assert(sql(`SELECT COUNT(*) FROM requirement_doc WHERE id='${created.dupApi}' AND status='draft'`) === "1", "库：副本落库为草稿");
    assert(sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'
      AND entity_id='${created.dupApi}' AND detail LIKE '%复制文档%'`) === "1", "库：复制活动留痕");
    /* UI 入口：阅读器更多菜单 */
    await openReader(created.team);
    await clickSel("#reqDocReader [data-rrd-more]");
    await waitFor(`!document.getElementById("rrdMoreMenu").hidden`, "更多菜单展开", 5000);
    const hasDupItem = await evaluate(`!!document.querySelector('#rrdMoreMenu [data-rrd-act="duplicate"]')`);
    assert(hasDupItem, "阅读器更多菜单含「复制文档」");
    await clickSel('#rrdMoreMenu [data-rrd-act="duplicate"]');
    /* duplicateTitle 对已带「副本」后缀的标题不叠加（再复制仍叫「… 副本」，列表出现第二篇同名草稿） */
    try{
      await waitFor(`import("./js/views/requirements.js").then(m =>
        m.reqDocList.filter(d => d.title === "${T_PREFIX}-团队共享 副本").length >= 2)`,
        "菜单复制出第二篇副本", 12000);
    }catch(e){
      const diag = await evaluate(`(async () => {
        const m = await import("./js/views/requirements.js");
        return { toasts: [...document.querySelectorAll("#toastWrap > *")].map(t => (t.textContent||"").trim()).slice(-3),
                 titles: m.reqDocList.map(d => d.title).filter(t => t.indexOf("${T_PREFIX}") >= 0) };
      })()`);
      throw new Error(e.message + "（toast=" + JSON.stringify(diag.toasts) + " 列表=" + JSON.stringify(diag.titles) + "）");
    }
    assert(sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}' AND title='${T_PREFIX}-团队共享 副本' AND status='draft'`) === "2",
      "库：UI 复制副本落库");
    await drainBad();
    await shot("reader-dup");
  });

  await section("[D] 我的 tab：最近访问 + 收藏", async () => {
    /* 打开过章节样本（上一节 openReader 记录的是团队共享），先打开样本再切到我的 */
    await openReader(created.md);
    await clickSel('[data-rdmode="mine"]');
    await waitFor(`!document.getElementById("reqDocMine").hidden`, "我的 tab 展示", 10000);
    const mine = await evaluate(`(() => {
      const box = document.getElementById("reqDocMine");
      return { text: box.textContent,
        recentRows: box.querySelectorAll('[data-rdm-open]').length,
        unfavs: box.querySelectorAll('[data-rdm-unfav]').length };
    })()`);
    assert(/最近访问/.test(mine.text) && /收藏/.test(mine.text), "我的 tab 分「最近访问/收藏」两段");
    assert(mine.recentRows >= 1 && mine.text.indexOf("章节样本") >= 0, "最近访问含刚打开的章节样本");
    const recentStore = await evaluate(`localStorage.getItem("ds.reqRecent.v1") || ""`);
    assert(recentStore.indexOf(created.md) >= 0, "localStorage 记录最近访问");
    /* 收藏一段：收藏团队共享后出现在我的 tab，行内取消即移除 */
    await apiTry(`await API.put("/api/req-docs/${created.team}/favorite", {})`);
    await clickSel('[data-rdmode="mine"]');
    await waitFor(`document.getElementById("reqDocMine").textContent.indexOf("团队共享") >= 0
      && document.querySelectorAll('#reqDocMine [data-rdm-unfav]').length > 0`, "收藏段出现且含取消按钮", 10000);
    await clickSel('#reqDocMine [data-rdm-unfav="' + created.team + '"]');
    try{
      await waitFor(`document.querySelectorAll('#reqDocMine [data-rdm-unfav]').length === 0`, "行内取消后收藏段清空", 8000);
    }catch(e){
      const diag = await evaluate(`(() => ({ toasts: [...document.querySelectorAll("#toastWrap > *")].map(t => (t.textContent||"").trim()).slice(-3),
        favRows: document.querySelectorAll('#reqDocMine [data-rdm-unfav]').length,
        mineText: document.getElementById("reqDocMine").textContent.replace(/\\s+/g, " ").slice(0, 200) }))()`);
      throw new Error(e.message + "（" + JSON.stringify(diag) + "）");
    }
    assert(sql(`SELECT COUNT(*) FROM doc_favorite WHERE doc_id='${created.team}' AND user_id='${UID.owner}'`) === "0",
      "库：行内取消收藏已删行");
    /* 行内点击直达阅读器 */
    await clickSel('#reqDocMine [data-rdm-open]');
    await waitFor(`!!document.querySelector('#reqDocReader [data-rrd-fav]')`, "我的 tab 点击直达阅读器", 10000);
    await drainBad();
    await shot("mine-tab");
  });

  await section("[E] 章节级搜索直达", async () => {
    /* API：关键词命中章节，head 为全文标题序（md 样本：0=背景 1=结算流程 2=退款规则） */
    const hits = await apiTry(`await API.get("/api/search", { q: "结算", limit: 10 })`);
    assert(hits.ok && Array.isArray(hits.data), "全局搜索返回结果集");
    const sec = (hits.data || []).filter(h => h.type === "doc" && h.id === created.md);
    assert(sec.length > 0, "搜索「结算」命中章节样本文档");
    const hit = sec.find(h => h.section) || {};
    assert(/结算流程/.test(hit.section || ""), "命中回显章节标题「结算流程」（实际：" + JSON.stringify(sec) + "）");
    assert(hit.head === 1, "head=1（第二个标题，与阅读大纲序号一致）");
    const titleHit = (hits.data || []).find(h => h.type === "doc" && h.id === created.md && !h.section);
    assert(!titleHit || !titleHit.section, "同一文档的普通命中不带 section");
    /* UI：openReqDocSection 直达阅读位置（SPA 内导航不写 ?h 深链，hash 只有 #/requirements） */
    await showRequirements();
    await evaluate(`import("./js/views/requirements.js").then(m => m.openReqDocSection("${created.md}", 1))`);
    const flashed = await waitFor(`!!document.querySelector('#reqDocReaderBody .rrd-flash')`, "目标章节滚动并高亮", 8000);
    assert(flashed, "深链打开后滚动到第 1 个标题并高亮");
    await drainBad();
    await shot("section-deeplink", true);
    /* 大纲序号一致性：阅读大纲当前高亮项与 head=1 对齐 */
    const tocActive = await evaluate(`(() => {
      const items = [...document.querySelectorAll('#reqDocReader [data-rtoc]')];
      const i = items.findIndex(el => el.className.indexOf('rrd-flash') >= 0);
      return { count: items.length, flashedIndex: i };
    })()`);
    assert(tocActive.count === 3 && tocActive.flashedIndex === 1, "正文三处标题，高亮第 2 个（序号 1）");
  });

  await section("[F] 收尾：删除样本并核对级联", async () => {
    await login(OWNER, PASS);
    const del = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const ids = ${JSON.stringify(docIds())};
      const out = [];
      for(const id of ids){ try{ await API.del("/api/req-docs/" + encodeURIComponent(id)); out.push([id, "ok"]); } catch(e){ out.push([id, e.message]); } }
      return out;
    })()`);
    assert(del.every(([, s]) => s === "ok"), "负责人删除（移入回收站）全部样本文档");
    /* 彻底删除（回收站清空）验证 purge 级联清收藏 */
    const purge = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const trash = await API.getAllPages("/api/req-docs/trash", {});
      const mine = trash.filter(t => ${JSON.stringify(docIds())}.indexOf(t.id) >= 0);
      for(const t of mine){ await API.del("/api/req-docs/" + encodeURIComponent(t.id) + "/trash"); }
      return mine.length;
    })()`);
    assert(purge >= docIds().length, "回收站彻底删除全部样本（" + purge + " 篇）");
    cleanupArtifacts(docIds());
    wipeDocs();
    const left = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`);
    assert(left === "0", "库：样本文档已删净");
    const favLeft = sql(`SELECT COUNT(*) FROM doc_favorite f JOIN requirement_doc d ON d.id=f.doc_id
      WHERE d.workspace_id='${WS}' AND d.title LIKE '${T_PREFIX}%'`);
    assert(favLeft === "0", "库：样本收藏行已清净");
    const postDocs = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`);
    assert(postDocs === preDocs, "库：文档总数回到运行前（" + preDocs + "）");
    const postFavs = sql(`SELECT COUNT(*) FROM doc_favorite WHERE workspace_id='${WS}'`);
    assert(postFavs === preFavs, "库：收藏总数回到运行前（" + preFavs + " → " + postFavs + "）");
    const postActs = sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'`);
    assert(postActs === preActs, "库：文档动态回到运行前（" + preActs + " → " + postActs + "）");
  });

  await drainBad();
  if(BAD_TOASTS.length){ failed++; console.log("\n  FAIL 红色 toast：" + BAD_TOASTS.join(" | ")); }
  else pass("全程无红色 toast");
  /* 收藏不可见文档刻意的 404 由断言核对；其余按 /api/req-docs/ 归桶 */
  const errs = cdp.errors.concat(cdp.resourceErrors).filter(l => !/\/api\/req-docs\//.test(l));
  if(errs.length){ failed++; console.log("\n  FAIL 控制台错误：" + errs.slice(0, 6).join(" | ")); }
  else pass("控制台零报错（不含刻意 404 的资源提示）");
  const unexpected = cdp.netErrors.filter(u => !/\/api\/req-docs\//.test(u));
  if(unexpected.length){ failed++; console.log("\n  FAIL 非预期失败请求：" + unexpected.slice(0, 6).join(" | ")); }
  else pass("除刻意 404 外无失败请求");
  if(cdp.knownGaps.length) console.log("  KNOWN-GAP 他人未迁移批次（sql/98 未执行）：" + [...new Set(cdp.knownGaps)].join(" | "));
  console.log("\n截图：" + SHOTS.join(" "));
  console.log(failed ? "\n结果：" + failed + " 项失败" : "\n结果：全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  failed++;
  console.log("\nERROR " + e.message);
  process.exitCode = 1;
}finally{
  try{
    if(!wiped && Object.values(created).some(Boolean)) wipeDocs();
    if(!wiped && sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`) !== "0") wipeDocs();
  }catch(e){ console.log("  WARN 收尾清理失败：" + e.message); }
  try{ proc.kill("SIGKILL"); }catch(e){}
}
