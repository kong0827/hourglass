/* 文档可见范围 E2E（照用例分组三档 · 仅约束已发布）
   覆盖：
     A 契约：创建三档文档（team/members/personal）与发布，接口回显 visibility / memberIds / memberCount。
     B 负责人 UI：阅读树三档徽标（团队共享无徽标、指定 N 人、仅自己）、权限说明面板回显人数与名单。
     C 分享限制：非团队共享档生成分享链接被 400 拒绝；团队共享档可生成。
     D 收窄流程：负责人把团队共享文档收窄为指定成员（确认弹窗 + 选人），收窄后旧分享链接被撤销。
     E 五身份矩阵：负责人 / 名单内成员 / 名单外可写成员 / 空间管理员（不在名单）/ 项目不可见成员，
       列表、直链详情、评论、历史四个入口按同一口径；草稿仍只对负责人 + 空间管理员可见。
     F 收窄守卫：非负责人（空间管理员）在 UI 上选择被禁用、API 被 400 拒绝。
     G 新建弹窗：三档单选、指定成员名单加载与搜索、提交 payload 生效。
     H 视觉对照：新建弹窗 / 权限说明 / 调整弹窗 / 管理员受限态四张截图，与原型对照。
   数据：支付业务部演示库，所有文档由脚本创建、收尾按 doc_id 精确清理（含名单 / 分享 / 历史 / 活动行），
   不改动既有文档。运行前需 8081 预览 + 8080 后端在线（deploy/local/stack.sh）。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
const OWNER = "zhangwei";      // 文档负责人（统一支付网关项目可写）
const LISTED = "lina";         // 名单内成员（项目可写）
const OUTSIDER = "chenhao";    // 名单外可写成员
const ADMIN = "sunqi";         // 空间管理员（项目只读，不在名单）
const BLIND = "zhoumin";       // 项目不可见成员（access=none）

const WS = "Smw9zcftmwwnrwuon";                         // 支付业务部
const PROJ = "Rfgp99z09lmjz0dn94hzv";                   // 统一支付网关（对应 2026-11-15 重灌的演示库）
const UID = {
  owner: "Umw9zcexjho9z9jjc",
  listed: "Umw9zcf2k1pcmhb0y",
  outsider: "Umw9zcf6depi11xfo",
  admin: "Umw9zcfic97y91qjs",
  blind: "Umw9zcfmah9inhkgm"
};
const T_PREFIX = "E2E可见范围";
const CAT_PREFIX = "E2E分类默认";

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
   分支/仓库接口在应用初始化时 500；与本批文档可见范围无关，单独归桶、如实登记。 */
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
      /* 身份矩阵故意请求不可见文档（404）与分享拒绝（400），由断言单独核对，不归入网络错误桶 */
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
const port = Number(process.env.E2E_PORT || 9467);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-vis-"));
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
  const out = "/tmp/hg-docvis-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
  console.log("  SHOT " + out);
};
/* 侧边弹窗内容高于 900px 视口时会被截断：临时调高视口再拍，拍完还原 */
const tallShot = async (name, keepToast) => {
  try{ await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false }); }
  catch(e){ return shot(name, keepToast); }
  await sleep(250);
  await shot(name, keepToast);
  try{ await call("Emulation.clearDeviceMetricsOverride"); }catch(e){}
  await sleep(150);
};

const created = { team: null, members: null, personal: null, narrow: null, draft: null,
  seedUi: null, seedApi: null, seedForced: null };
let seedCatId = null;
let wiped = false;
const testDocIds = () => {
  const rows = sqlRaw(`SELECT id FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`);
  return (rows.stdout || "").trim().split("\n").filter(Boolean);
};
/* 文档按 doc_id 精确清理：名单 / 分享 / 历史 / 活动行都不留 residue（动态流不残留测试记录） */
const cleanupArtifacts = ids => {
  if(!ids.length) return;
  const inList = ids.map(i => "'" + i + "'").join(",");
  sql(`DELETE FROM doc_visibility_member WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM req_doc_share WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM requirement_doc_history WHERE doc_id IN (${inList})`);
  sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND entity_id IN (${inList})`);
};
const wipeDocs = () => {
  const ids = testDocIds();
  cleanupArtifacts(ids);
  if(ids.length) sql(`DELETE FROM requirement_doc WHERE id IN (${ids.map(i => "'" + i + "'").join(",")})`);
  /* 上次中断可能留下分类默认样本分类：样本文档已按标题删净，再删分类，避免同级重名挡住重建 */
  sql(`DELETE FROM doc_category WHERE workspace_id='${WS}' AND name LIKE '${CAT_PREFIX}%'`);
  /* 上次中断的运行可能已删文档、留下活动行：按标题前缀兜底清掉，动态流不残留测试记录 */
  sql(`DELETE FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc' AND detail LIKE '%${T_PREFIX}%'`);
  wiped = true;
};

try{
  wipeDocs();
  const preDocs = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`);
  const preMembers = sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE workspace_id='${WS}'`);
  const preActs = sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'`);
  const preCats = sql(`SELECT COUNT(*) FROM doc_category WHERE workspace_id='${WS}'`);

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
  const rect = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
    try{ el.scrollIntoView({ block:"center" }); }catch(e){}
    const r = el.getBoundingClientRect(); return { x:r.left + r.width/2, y:r.top + r.height/2, w:r.width, h:r.height }; })()`);
  const clickSel = async sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); }
  };
  const docIds = () => Object.entries(created).filter(([, v]) => v).map(([, v]) => v);

  await login(OWNER, PASS);

  await section("[A] 创建三档文档并发布", async () => {
    const res = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const base = { reqId: ${JSON.stringify(PROJ)}, content: "<p>E2E 可见范围样本</p>", format: "html",
                     docType: "requirement", status: "draft" };
      const team = await API.post("/api/req-docs", Object.assign({}, base, { title: "${T_PREFIX}-团队共享", visibility: "team" }));
      const mem = await API.post("/api/req-docs", Object.assign({}, base, { title: "${T_PREFIX}-指定成员", visibility: "members", memberIds: [${JSON.stringify(UID.listed)}] }));
      const per = await API.post("/api/req-docs", Object.assign({}, base, { title: "${T_PREFIX}-仅自己", visibility: "personal" }));
      for (const d of [team, mem, per]) await API.put("/api/req-docs/" + encodeURIComponent(d.id) + "/publish", { published: true });
      const ids = [team.id, mem.id, per.id];
      const fresh = {};
      for (const id of ids) fresh[id] = await API.get("/api/req-docs/" + encodeURIComponent(id));
      const list = await API.getAllPages("/api/req-docs", { keyword: "${T_PREFIX}", probe: Date.now() });
      return {
        team: { id: team.id, vis: fresh[team.id].visibility, owner: fresh[team.id].ownerUserId, pub: !!fresh[team.id].publishedAt },
        mem: { id: mem.id, vis: fresh[mem.id].visibility, members: fresh[mem.id].memberIds, owner: fresh[mem.id].ownerUserId, pub: !!fresh[mem.id].publishedAt },
        per: { id: per.id, vis: fresh[per.id].visibility, owner: fresh[per.id].ownerUserId, pub: !!fresh[per.id].publishedAt },
        rows: list.filter(r => ids.indexOf(r.id) >= 0).map(r => ({ id:r.id, vis:r.visibility, mc:r.memberCount, pub:!!r.publishedAt }))
      };
    })()`);
    created.team = res.team.id; created.members = res.mem.id; created.personal = res.per.id;
    assert(res.team.vis === "team" && res.mem.vis === "members" && res.per.vis === "personal", "创建回显三档可见范围");
    assert((res.mem.members || []).indexOf(UID.listed) >= 0 && res.mem.members.length === 1, "指定成员创建回显名单（李娜）");
    assert(res.team.owner === UID.owner && res.mem.owner === UID.owner && res.per.owner === UID.owner, "三档文档负责人均为当前用户");
    assert(res.team.pub && res.mem.pub && res.per.pub, "三档文档均已发布");
    const byId = id => res.rows.filter(r => r.id === id)[0] || {};
    assert(byId(created.team).vis === "team" && byId(created.team).mc === 0, "列表：团队共享 visibility=team、memberCount=0");
    assert(byId(created.members).vis === "members" && byId(created.members).mc === 1, "列表：指定成员 memberCount=1");
    assert(byId(created.personal).vis === "personal", "列表：仅自己 visibility=personal");
    assert(sql(`SELECT visibility FROM requirement_doc WHERE id='${created.members}'`) === "members", "库：visibility 落库");
    assert(sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE doc_id='${created.members}' AND user_id='${UID.listed}'`) === "1", "库：名单落 doc_visibility_member");
  });

  await section("[B] 负责人阅读树徽标与权限说明", async () => {
    await evaluate(`import("./js/views/requirements.js").then(m => m.loadReqDocs(true))`);
    await showRequirements();
    await waitFor(`!!document.querySelector('.rs-node[data-rs-doc="${created.team}"]')`, "阅读树出现样本文档", 15000);
    const chips = await evaluate(`(() => {
      const node = id => document.querySelector('.rs-node[data-rs-doc="' + id + '"]');
      const chip = id => { const n = node(id); const c = n && n.querySelector(".doc-vis-chip"); return c ? { text: c.textContent.trim(), cls: c.className, title: c.title } : null; };
      return { team: chip(${JSON.stringify(created.team)}), mem: chip(${JSON.stringify(created.members)}), per: chip(${JSON.stringify(created.personal)}) };
    })()`);
    assert(chips.team === null, "团队共享档无徽标（默认不打扰）");
    assert(chips.mem && chips.mem.text === "指定 1 人" && /members/.test(chips.mem.cls), "指定成员徽标「指定 1 人」");
    assert(chips.per && chips.per.text === "仅自己" && /personal/.test(chips.per.cls), "仅自己徽标「仅自己」");
    assert(await evaluate(`/已发布/.test(document.querySelector('.rs-node[data-rs-doc="${created.members}"]').textContent)`), "已发布徽标仍在");
    /* 看板卡片同一套徽标 */
    await clickSel('[data-rdmode="kanban"]');
    await waitFor(`!document.getElementById("reqDocKanban").hidden`, "看板视图", 10000);
    const kanbanChips = await evaluate(`[...document.querySelectorAll("#reqDocKanban .doc-vis-chip")].map(c => c.textContent.trim())`);
    assert(kanbanChips.indexOf("指定 1 人") >= 0 && kanbanChips.indexOf("仅自己") >= 0, "看板卡片显示三档徽标");
    await shot("kanban");
    await clickSel('[data-rdmode="read"]');
    await waitFor(`!document.getElementById("reqDocSplit").hidden`, "回到阅读视图", 10000);
    await sleep(200);
    await clickSel(`.rs-node[data-rs-doc="${created.members}"]`);
    await waitFor(`!!document.querySelector('#reqDocReader [data-rrd-perm]')`, "阅读器打开成员文档", 15000);
    await clickSel("#reqDocReader [data-rrd-perm]");
    await waitFor(`!document.getElementById("rrdPanePerm").hidden && /可见范围/.test(document.getElementById("rrdPanePerm").textContent)`, "权限说明面板", 10000);
    const perm = await evaluate(`(() => { const p = document.getElementById("rrdPanePerm");
      return { text: p.textContent.replace(/\\s+/g, " "), edit: !!p.querySelector("[data-doc-vis-edit]") }; })()`);
    assert(/指定成员（1 人）/.test(perm.text) && /李娜/.test(perm.text), "权限说明回显「指定成员（1 人）：李娜」");
    assert(perm.edit, "已发布 + 可改删时出现「调整」入口");
    await shot("owner-perm");
  });

  await section("[C] 分享链接仅团队共享档可用", async () => {
    const blockedMem = await apiTry(`await API.post("/api/req-docs/${created.members}/share", {})`);
    const blockedPer = await apiTry(`await API.post("/api/req-docs/${created.personal}/share", {})`);
    assert(!blockedMem.ok && blockedMem.code === 400 && /仅团队共享/.test(blockedMem.message), "指定成员档分享被 400 拒绝");
    assert(!blockedPer.ok && blockedPer.code === 400, "仅自己档分享被 400 拒绝");
    const teamShare = await apiTry(`await API.post("/api/req-docs/${created.team}/share", {})`);
    assert(teamShare.ok && teamShare.data && !!teamShare.data.token, "团队共享档可生成分享链接");
    const detail = await apiTry(`await API.get("/api/req-docs/${created.members}")`);
    assert(detail.ok && (detail.data.memberIds || []).length === 1, "详情接口回显名单供面板使用");
  });

  await section("[D] 收窄：确认弹窗 + 撤销分享", async () => {
    /* 另建一篇团队共享文档做收窄样本，并先生成分享链接，验证收窄后自动撤销 */
    const made = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const d = await API.post("/api/req-docs", { reqId: ${JSON.stringify(PROJ)}, title: "${T_PREFIX}-收窄样本",
        content: "<p>narrow</p>", format: "html", docType: "requirement", status: "draft", visibility: "team" });
      await API.put("/api/req-docs/" + encodeURIComponent(d.id) + "/publish", { published: true });
      const s = await API.post("/api/req-docs/" + encodeURIComponent(d.id) + "/share", {});
      return { id: d.id, token: s && s.token };
    })()`);
    created.narrow = made.id;
    assert(!!made.token, "收窄样本先生成分享链接");
    await evaluate(`import("./js/views/requirements.js").then(m => m.loadReqDocs(true))`);
    await waitFor(`!!document.querySelector('.rs-node[data-rs-doc="${created.narrow}"]')`, "收窄样本出现在阅读树", 15000);
    await clickSel(`.rs-node[data-rs-doc="${created.narrow}"]`);
    await waitFor(`!!document.querySelector('#reqDocReader [data-rrd-perm]')`, "打开收窄样本", 15000);
    await clickSel("#reqDocReader [data-rrd-perm]");
    await waitFor(`!!document.querySelector('#rrdPanePerm [data-doc-vis-edit]')`, "调整入口", 10000);
    await clickSel('#rrdPanePerm [data-doc-vis-edit]');
    await waitFor(`!![...document.querySelectorAll(".modal-layer.open")].find(l => /调整可见范围/.test(l.textContent))`, "调整弹窗", 10000);
    assert(await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /调整可见范围/.test(x.textContent));
      const radios = [...l.querySelectorAll('#docVisDlgOpts input[type=radio]')];
      return radios.length === 3 && radios.every(r => !r.disabled) && radios.find(r => r.checked).value === "team"; })()`),
      "负责人调整弹窗：三档可选、当前团队共享");
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /调整可见范围/.test(x.textContent));
      l.querySelector('#docVisDlgOpts input[value="members"]').click(); return true; })()`);
    await waitFor(`!document.getElementById("docVisDlgWho").hidden && document.querySelectorAll('#docVisDlgWho [data-vis-uid]').length > 0`, "成员名单加载", 10000);
    await shot("adjust-dialog");
    await evaluate(`(() => { const box = [...document.querySelectorAll('#docVisDlgWho [data-vis-uid]')].find(b => b.dataset.visUid === ${JSON.stringify(UID.listed)});
      box.checked = true; box.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    assert(await evaluate(`/已选 1 \\/ 50 人/.test(document.querySelector('#docVisDlgWho [data-vis-count]').textContent)`), "名单计数「已选 1 / 50」");
    await shot("adjust-selected");
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /调整可见范围/.test(x.textContent));
      l.querySelector("[data-vis-ok]").click(); return true; })()`);
    await waitFor(`!!document.getElementById("dlgConfirm") && document.getElementById("dlgConfirm").classList.contains("open")`, "收窄确认弹窗", 8000);
    const confirmText = await evaluate(`document.getElementById("dlgConfirm").textContent.replace(/\\s+/g, " ")`);
    assert(/收窄/.test(confirmText) && /公开分享链接/.test(confirmText), "确认弹窗说明收窄影响与链接撤销");
    await shot("narrow-confirm", true);
    await evaluate(`document.getElementById("dlgConfirmOk").click(); true`);
    await waitFor(`![...document.querySelectorAll(".modal-layer.open")].some(l => /调整可见范围/.test(l.textContent))`, "调整弹窗关闭", 10000);
    await waitFor(`(() => { const n = document.querySelector('.rs-node[data-rs-doc="${created.narrow}"] .doc-vis-chip'); return n && n.textContent.trim() === "指定 1 人"; })()`, "阅读树徽标更新", 10000);
    assert(sql(`SELECT visibility FROM requirement_doc WHERE id='${created.narrow}'`) === "members", "库：收窄为 members");
    assert(sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE doc_id='${created.narrow}'`) === "1", "库：名单 1 人");
    assert(sql(`SELECT COUNT(*) FROM req_doc_share WHERE doc_id='${created.narrow}'`) === "0", "库：旧分享链接已撤销");
    const noShare = await apiTry(`await API.get("/api/req-docs/${created.narrow}/share")`);
    assert(!noShare.ok || !noShare.data || !noShare.data.token, "接口：收窄后无有效分享链接");
  });

  await section("[E] 新建弹窗：三档 + 指定成员名单", async () => {
    await evaluate(`document.getElementById("reqDocNew").click(); true`);
    await waitFor(`document.getElementById("dlgNewReqDoc").classList.contains("open") && !!document.getElementById("newReqDocVis")`, "新建弹窗", 10000);
    /* 归属项目决定成员候选与文档可见范围：显式选「统一支付网关」 */
    await waitFor(`!!document.querySelector('#newReqDocProject option[value="${PROJ}"]')`, "项目候选", 10000);
    await evaluate(`(() => { const s = document.getElementById("newReqDocProject");
      s.value = ${JSON.stringify(PROJ)}; s.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    await sleep(200);
    const base = await evaluate(`(() => {
      const box = document.getElementById("newReqDocVis");
      const radios = [...box.querySelectorAll("input[type=radio]")];
      return { n: radios.length, checked: (radios.find(r => r.checked) || {}).value || "",
        labels: [...box.querySelectorAll(".cs-vis-item")].map(x => x.textContent.replace(/\\s+/g," ").trim()),
        whoHidden: document.getElementById("newReqDocWhoField").hidden,
        rangeSelect: document.getElementById("newReqDocProject").value };
    })()`);
    assert(base.n === 3 && base.checked === "team", "新建弹窗默认三档单选、当前团队共享");
    assert(base.labels.length === 3 && /团队共享/.test(base.labels[0]) && /指定成员/.test(base.labels[1]) && /仅自己/.test(base.labels[2]), "三档文案齐全");
    assert(base.whoHidden, "团队共享时不显示成员名单");
    assert(base.rangeSelect === PROJ, "新建文档归属统一支付网关");
    assert(/草稿始终仅负责人与空间管理员可见/.test(await evaluate(`document.getElementById("newReqDocWhoField").textContent`) || ""), "名单区说明草稿口径");
    await evaluate(`document.querySelector('#newReqDocVis input[value="members"]').click(); true`);
    await waitFor(`!document.getElementById("newReqDocWhoField").hidden && document.querySelectorAll('#newReqDocWho [data-vis-uid]').length > 0`, "成员候选加载", 12000);
    const opts = await evaluate(`[...document.querySelectorAll('#newReqDocWho [data-vis-uid]')].map(b => b.dataset.visUid)`);
    assert(opts.indexOf(UID.listed) >= 0, "候选包含名单成员李娜");
    assert(await evaluate(`(() => { const q = document.querySelector('#newReqDocWho [data-vis-q]');
      q.value = "李娜"; q.dispatchEvent(new Event("input", { bubbles:true }));
      return new Promise(r => setTimeout(() => r(document.querySelectorAll('#newReqDocWho [data-vis-uid]').length), 250)); })()`) >= 1, "成员搜索可用");
    assert(await evaluate(`(() => { const q = document.querySelector('#newReqDocWho [data-vis-q]');
      q.value = "不存在的人"; q.dispatchEvent(new Event("input", { bubbles:true }));
      return new Promise(r => setTimeout(() => r(/没有匹配的成员/.test(document.getElementById("newReqDocWho").textContent)), 250)); })()`), "无匹配时给空态提示");
    await evaluate(`(() => { const q = document.querySelector('#newReqDocWho [data-vis-q]');
      q.value = ""; q.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await sleep(200);
    await evaluate(`(() => { const box = [...document.querySelectorAll('#newReqDocWho [data-vis-uid]')].find(b => b.dataset.visUid === ${JSON.stringify(UID.listed)});
      box.checked = true; box.dispatchEvent(new Event("change", { bubbles:true }));
      const layer = document.getElementById("dlgNewReqDoc"); layer.scrollTop = layer.scrollHeight;
      return true; })()`);
    await sleep(250);
    const boxLook = await evaluate(`(() => { const boxes = [...document.querySelectorAll('#newReqDocWho [data-vis-uid]')];
      const sel = boxes.find(x => x.dataset.visUid === ${JSON.stringify(UID.listed)});
      const other = boxes.find(x => x.dataset.visUid !== ${JSON.stringify(UID.listed)});
      const r = sel.getBoundingClientRect();
      return { checked: sel.checked, w: Math.round(r.width), h: Math.round(r.height),
        selBg: getComputedStyle(sel).backgroundColor, otherBg: other ? getComputedStyle(other).backgroundColor : "" }; })()`);
    assert(boxLook.checked && boxLook.w >= 12 && boxLook.h >= 12, "新建弹窗成员复选框可见（不小于 12px）");
    assert(boxLook.otherBg && boxLook.selBg !== boxLook.otherBg, "新建弹窗已选成员复选框有选中填充");
    await shot("newdoc-members");
    await evaluate(`(() => { const t = document.getElementById("newReqDocTitle");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), "value").set.call(t, "${T_PREFIX}-新建弹窗指定成员");
      t.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await evaluate(`document.getElementById("dlgNewReqDocOk").click(); true`);
    await waitFor(`!document.getElementById("dlgNewReqDoc").classList.contains("open")`, "新建提交完成", 15000);
    await waitFor(`import("./js/views/requirements.js").then(m => m.reqDocsLoaded)`, "列表刷新", 15000);
    const row = await evaluate(`import("./js/views/requirements.js").then(m => m.reqDocList).then(l => {
      const d = l.find(x => x.title === "${T_PREFIX}-新建弹窗指定成员"); return d ? { id: d.id, vis: d.visibility, mc: d.memberCount, pub: d.publishedAt } : null; })`);
    assert(row && row.vis === "members" && row.mc === 1, "新建文档按弹窗选择落为「指定成员 1 人」");
    assert(row && row.pub == null, "新建文档仍是草稿");
    if(row) created.draft = row.id;
    assert(sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE doc_id='${created.draft}' AND user_id='${UID.listed}'`) === "1", "库：新建文档名单落库");
    const editorOpen = await evaluate(`!document.getElementById("reqDocEditPage").hidden`);
    if(editorOpen){
      assert(await evaluate(`/需先发布/.test(document.getElementById("reqDocShare").title)`), "草稿态分享按钮提示「需先发布」");
    }
  });

  await section("[F] 五身份可见矩阵（API + 列表）", async () => {
    const ids = { team: created.team, members: created.members, personal: created.personal, narrow: created.narrow, draft: created.draft };
    const expect = {
      [OWNER]:   { team: "team", members: "members", personal: "personal", narrow: "members", draft: "members" },
      [LISTED]:  { team: "team", members: "members", narrow: "members" },
      [OUTSIDER]:{ team: "team" },
      [ADMIN]:   { team: "team", draft: "members" },
      [BLIND]:   {}
    };
    for(const user of [OWNER, LISTED, OUTSIDER, ADMIN, BLIND]){
      await login(user, PASS);
      const matrix = await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        const ids = ${JSON.stringify(ids)};
        const out = {};
        for(const k of Object.keys(ids)){
          const row = {};
          try{ const d = await API.get("/api/req-docs/" + encodeURIComponent(ids[k])); row.get = d.visibility; }
          catch(e){ row.get = e.code || 0; }
          try{ await API.get("/api/req-docs/" + encodeURIComponent(ids[k]) + "/comments", { limit: 10 }); row.comments = "ok"; }
          catch(e){ row.comments = e.code || 0; }
          try{ await API.get("/api/req-docs/" + encodeURIComponent(ids[k]) + "/history", { limit: 10 }); row.history = "ok"; }
          catch(e){ row.history = e.code || 0; }
          try{ await API.get("/api/req-docs/" + encodeURIComponent(ids[k]) + "/tasks", { limit: 10 }); row.tasks = "ok"; }
          catch(e){ row.tasks = e.code || 0; }
          out[k] = row;
        }
        const list = await API.getAllPages("/api/req-docs", { keyword: "${T_PREFIX}", probe: Date.now() });
        out.list = list.filter(r => Object.keys(ids).some(k => ids[k] === r.id)).map(r => r.id);
        return out;
      })()`);
      const exp = expect[user];
      for(const k of Object.keys(ids)){
        const got = matrix[k];
        if(exp[k]){
          assert(got.get === exp[k], user + " 可读 " + k + "（详情 " + got.get + "）");
          assert(got.comments === "ok" && got.history === "ok" && got.tasks === "ok", user + " 评论/历史/工作项入口同口径放行 " + k);
          assert(matrix.list.indexOf(ids[k]) >= 0, user + " 列表包含 " + k);
        }else{
          assert(got.get === 404 && got.comments === 404 && got.history === 404 && got.tasks === 404, user + " 直链四入口均按不存在处理 " + k);
          assert(matrix.list.indexOf(ids[k]) < 0, user + " 列表不出现 " + k);
          assert(!ids[k] || sql(`SELECT COUNT(*) FROM requirement_doc WHERE id='${ids[k]}'`) === "1", user + " 拒绝的是视图而非数据（" + k + " 仍在库）");
        }
      }
      if(user === LISTED){
        assert(matrix.list.indexOf(ids.draft) < 0, "草稿即使名单内成员也不可见（只约束已发布）");
        assert(matrix.draft.get === 404, "草稿直链对名单内成员 404");
      }
      if(user === ADMIN){
        assert(matrix.list.indexOf(ids.members) < 0 && matrix.members.get === 404, "空间管理员不在名单时同样不可见（与用例分组口径一致）");
      }
    }
    /* 项目不可见成员（最后登录的身份）UI 列表同样不含样本 */
    await evaluate(`import("./js/views/requirements.js").then(m => m.loadReqDocs(true))`);
    await showRequirements();
    await waitFor(`import("./js/views/requirements.js").then(m => m.reqDocsLoaded)`, "项目不可见成员文档列表", 15000);
    const blindTitles = await evaluate(`[...document.querySelectorAll("#reqDocSplitTree .rs-node .rs-title")].map(x => x.textContent)`);
    assert(!blindTitles.some(t => t.indexOf("${T_PREFIX}") >= 0), "项目不可见成员 UI 列表不含任何样本");
    /* 管理员身份下再确认 UI 列表：只有团队共享与草稿 */
    await login(ADMIN, PASS);
    await showRequirements();
    await waitFor(`import("./js/views/requirements.js").then(m => m.reqDocsLoaded)`, "管理员文档列表", 15000);
    const titles = await evaluate(`[...document.querySelectorAll("#reqDocSplitTree .rs-node .rs-title")].map(x => x.textContent)`);
    assert(titles.some(t => t.indexOf("团队共享") >= 0), "管理员 UI 列表可见团队共享档");
    assert(titles.some(t => t.indexOf("新建弹窗指定成员") >= 0), "管理员可见他人草稿（草稿口径：负责人 + 空间管理员）" + (titles.some(t => t.indexOf("新建弹窗指定成员") >= 0) ? "" : " · 实际标题：" + JSON.stringify(titles)));
    assert(!titles.some(t => t.indexOf("指定成员") >= 0 && t.indexOf("新建弹窗") < 0 || t.indexOf("仅自己") >= 0 || t.indexOf("收窄样本") >= 0), "管理员 UI 列表不含受限档（含收窄样本）");
    await shot("admin-list");
  });

  await section("[G] 收窄守卫：非负责人不可收窄", async () => {
    await login(ADMIN, PASS);
    const denied = await apiTry(`await API.put("/api/req-docs/${created.team}/visibility", { visibility: "members", memberIds: [${JSON.stringify(UID.listed)}] })`);
    assert(!denied.ok && denied.code === 400, "空间管理员收窄团队共享文档被 400 拒绝");
    assert(!denied.ok && /负责人/.test(denied.message), "拒绝文案指向文档负责人：" + (denied.message || ""));
    assert(sql(`SELECT visibility FROM requirement_doc WHERE id='${created.team}'`) === "team", "库：被拒后可见范围未变");
    /* UI 同口径：管理员打开团队共享文档 → 调整 → 收窄选项禁用 */
    await showRequirements();
    await waitFor(`!!document.querySelector('.rs-node[data-rs-doc="${created.team}"]')`, "管理员可见团队共享文档", 15000);
    await clickSel(`.rs-node[data-rs-doc="${created.team}"]`);
    await waitFor(`!!document.querySelector('#reqDocReader [data-rrd-perm]')`, "打开团队共享文档", 15000);
    await clickSel("#reqDocReader [data-rrd-perm]");
    await waitFor(`!!document.querySelector('#rrdPanePerm [data-doc-vis-edit]')`, "管理员可见调整入口", 10000);
    await clickSel('#rrdPanePerm [data-doc-vis-edit]');
    await waitFor(`!![...document.querySelectorAll(".modal-layer.open")].find(l => /调整可见范围/.test(l.textContent))`, "管理员调整弹窗", 10000);
    const locked = await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /调整可见范围/.test(x.textContent));
      const rs = [...l.querySelectorAll('#docVisDlgOpts input[type=radio]')];
      return { locked: rs.filter(r => r.disabled).map(r => r.value), note: /需由文档负责人操作/.test(l.textContent) }; })()`);
    assert(locked.locked.length === 2 && locked.locked.indexOf("members") >= 0 && locked.locked.indexOf("personal") >= 0, "管理员 UI：收窄两档禁用");
    assert(locked.note, "管理员 UI：说明需负责人操作");
    await shot("admin-locked");
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /调整可见范围/.test(x.textContent));
      l.querySelector("[data-vis-x]").click(); return true; })()`);
  });

  await section("[I] 分类默认可见范围：新建预填，不改已有文档", async () => {
    await login(OWNER, PASS);
    const cat = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const c = await API.post("/api/doc-categories", { name: "${CAT_PREFIX}", reqId: ${JSON.stringify(PROJ)} });
      const saved = await API.put("/api/doc-categories/" + encodeURIComponent(c.id) + "/visibility",
        { visibility: "members", memberIds: [${JSON.stringify(UID.listed)}] });
      const tree = await API.get("/api/doc-categories", { reqId: ${JSON.stringify(PROJ)} });
      const node = (tree || []).filter(x => x.id === c.id)[0];
      return { id: c.id,
        saved: { vis: saved.visibility, mc: saved.memberCount, members: saved.memberIds },
        node: node ? { vis: node.visibility, mc: node.memberCount, members: node.memberIds } : null };
    })()`);
    seedCatId = cat.id;
    assert(cat.saved.vis === "members" && cat.saved.mc === 1, "接口：分类默认档保存为「指定成员 1 人」");
    assert(cat.node && cat.node.vis === "members" && (cat.node.members || []).indexOf(UID.listed) >= 0,
      "树接口回显默认档与名单（可写成员可见名单）");
    assert(sql(`SELECT CONCAT(visibility, '|', member_ids) FROM doc_category WHERE id='${cat.id}'`)
      === "members|" + UID.listed, "库：默认档与名单落 doc_category");

    await showRequirements();
    await waitFor(`!!document.querySelector('.rs-cat[data-rs-cat="${cat.id}"]')`, "分类出现在阅读树", 15000);
    const chip = await evaluate(`(() => { const n = document.querySelector('.rs-cat[data-rs-cat="${cat.id}"]');
      const c = n && n.querySelector('.doc-vis-chip');
      return c ? { text: c.textContent.trim(), title: c.title } : null; })()`);
    assert(chip && chip.text === "默认 1 人" && /只影响之后新建的文档/.test(chip.title || ""), "分类行显示「默认 1 人」徽标");
    await shot("cat-default-chip");

    await evaluate(`(() => { const el = document.querySelector('.rs-cat[data-rs-cat="${cat.id}"]');
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles:true, cancelable:true, clientX: 260, clientY: 240 }));
      return true; })()`);
    await waitFor(`!!document.querySelector('#reqDocCtxMenu.open [data-ctx-act="catvis"]')`, "分类右键出现默认可见范围入口", 8000);
    await clickSel('#reqDocCtxMenu [data-ctx-act="catvis"]');
    await waitFor(`!![...document.querySelectorAll(".modal-layer.open")].find(l => /分类默认可见范围/.test(l.textContent))`, "分类默认弹窗", 8000);
    await waitFor(`!!(document.querySelector('#docCatVisWho [data-vis-uid="${UID.listed}"]')||{}).checked`, "默认名单预勾选李娜", 12000);
    const dlg = await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /分类默认可见范围/.test(x.textContent));
      const r = l.querySelector('#docCatVisOpts input:checked');
      return { vis: r && r.value, note: /只是新建时的默认值/.test(l.textContent),
        listed: !!(l.querySelector('#docCatVisWho [data-vis-uid="${UID.listed}"]')||{}).checked }; })()`);
    assert(dlg.vis === "members" && dlg.listed, "弹窗回显指定成员档并勾选默认名单");
    assert(dlg.note, "弹窗说明「只是新建时的默认值」");
    await tallShot("cat-default-dialog");
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /分类默认可见范围/.test(x.textContent));
      l.querySelector("[data-catvis-x]").click(); return true; })()`);
    await waitFor(`![...document.querySelectorAll(".modal-layer.open")].some(l => /分类默认可见范围/.test(l.textContent))`, "关闭分类默认弹窗", 8000);

    await evaluate(`document.getElementById("reqDocNew").click(); true`);
    await waitFor(`document.getElementById("dlgNewReqDoc").classList.contains("open")`, "新建文档弹窗", 10000);
    await waitFor(`!!document.querySelector('#newReqDocCategory option[value="${cat.id}"]')`, "分类候选包含样本分类", 12000);
    await evaluate(`(() => { const s = document.getElementById("newReqDocCategory");
      s.value = ${JSON.stringify(cat.id)}; s.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    await waitFor(`!!(document.querySelector('#newReqDocWho [data-vis-uid="${UID.listed}"]')||{}).checked`, "新建弹窗预选默认名单李娜", 12000);
    const seeded = await evaluate(`(() => { const r = document.querySelector('#newReqDocVis input:checked');
      const h = document.getElementById("newDocVisHint");
      return { vis: r && r.value, hint: h ? h.textContent : "", hidden: h ? h.hidden : true,
        proj: document.getElementById("newReqDocProject").value }; })()`);
    assert(seeded.vis === "members", "选中分类后新建弹窗预选「指定成员」");
    assert(!seeded.hidden && seeded.hint.indexOf("按分类「" + CAT_PREFIX + "」默认：指定成员 1 人") === 0,
      "预填提示说明来源与带入人数（hidden=" + seeded.hidden + " · " + JSON.stringify(seeded.hint) + "）");
    assert(seeded.proj === PROJ, "分类带出归属项目");
    await evaluate(`(() => { const l = document.getElementById("dlgNewReqDoc");
      l.scrollTop = l.scrollHeight;
      const body = l.querySelector(".sheet-body"); if(body) body.scrollTop = body.scrollHeight;
      const sheet = l.querySelector(".sheet"); if(sheet) sheet.scrollTop = sheet.scrollHeight;
      const hint = document.getElementById("newDocVisHint");
      if(hint) hint.scrollIntoView({ block: "center", behavior: "instant" });
      return true; })()`);
    await sleep(350);
    await tallShot("newdoc-seeded");
    await evaluate(`(() => { const t = document.getElementById("newReqDocTitle");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(t), "value").set.call(t, "${T_PREFIX}-分类默认带入");
      t.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await evaluate(`document.getElementById("dlgNewReqDocOk").click(); true`);
    await waitFor(`!document.getElementById("dlgNewReqDoc").classList.contains("open")`, "分类默认样本创建完成", 15000);
    await waitFor(`import("./js/views/requirements.js").then(m => m.reqDocList.some(x => x.title === "${T_PREFIX}-分类默认带入"))`, "列表出现分类默认样本", 15000);
    const uiRow = await evaluate(`import("./js/views/requirements.js").then(m => m.reqDocList).then(l => {
      const d = l.find(x => x.title === "${T_PREFIX}-分类默认带入");
      return d ? { id: d.id, vis: d.visibility, mc: d.memberCount, cat: d.categoryId } : null; })`);
    assert(uiRow && uiRow.vis === "members" && uiRow.mc === 1 && uiRow.cat === cat.id, "界面新建：按分类默认落为指定成员 1 人");
    if(uiRow){ created.seedUi = uiRow.id; }
    assert(uiRow && sql(`SELECT visibility FROM requirement_doc WHERE id='${uiRow.id}'`) === "members", "库：界面新建文档 visibility=members");
    await evaluate(`import("./js/views/requirements.js").then(m => m.tryCloseReqDocEditor())`);

    /* 接口口径：不带 visibility 复制默认（后端兜底）；显式 team 覆盖；已有文档换分类不改可见范围 */
    const api = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const base = { reqId: ${JSON.stringify(PROJ)}, categoryId: ${JSON.stringify(cat.id)},
        content: "<p>E2E 分类默认样本</p>", format: "html", docType: "requirement", status: "draft" };
      const seeded = await API.post("/api/req-docs", Object.assign({}, base, { title: "${T_PREFIX}-接口不带档位" }));
      const forced = await API.post("/api/req-docs", Object.assign({}, base,
        { title: "${T_PREFIX}-接口显式团队", visibility: "team" }));
      const teamDoc = await API.get("/api/req-docs/${created.team}");
      await API.put("/api/req-docs/${created.team}", { reqId: ${JSON.stringify(PROJ)}, title: teamDoc.title,
        content: teamDoc.content, format: teamDoc.format, docType: teamDoc.docType, status: teamDoc.status,
        categoryId: ${JSON.stringify(cat.id)} });
      const kept = await API.get("/api/req-docs/${created.team}");
      const seededFresh = await API.get("/api/req-docs/" + seeded.id);
      return { seeded: { id: seeded.id, vis: seededFresh.visibility, members: seededFresh.memberIds },
        forced: { id: forced.id, vis: forced.visibility, members: forced.memberIds || [] },
        kept: { vis: kept.visibility, cat: kept.categoryId } };
    })()`);
    created.seedApi = api.seeded.id;
    created.seedForced = api.forced.id;
    assert(api.seeded.vis === "members" && (api.seeded.members || []).indexOf(UID.listed) >= 0,
      "接口新建不带档位：复制分类默认档与名单");
    assert(api.forced.vis === "team" && !(api.forced.members || []).length, "接口新建显式 team：覆盖分类默认");
    assert(api.kept.vis === "team" && api.kept.cat === cat.id, "已有文档换分类不改可见范围（仍团队共享）");
  });

  await section("[H] 收尾：删除样本并核对级联", async () => {
    await login(OWNER, PASS);
    const del = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const ids = ${JSON.stringify(docIds())};
      const out = [];
      for(const id of ids){ try{ await API.del("/api/req-docs/" + encodeURIComponent(id)); out.push([id, "ok"]); } catch(e){ out.push([id, e.message]); } }
      return out;
    })()`);
    assert(del.every(([, s]) => s === "ok"), "负责人删除全部样本文档");
    const left = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}' AND title LIKE '${T_PREFIX}%'`);
    assert(left === "0", "库：样本文档已删净");
    const orphan = sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE workspace_id='${WS}' AND doc_id NOT IN (SELECT id FROM requirement_doc)`);
    assert(orphan === "0", "库：删除文档级联清理名单（无孤儿）");
    cleanupArtifacts(docIds());
    wipeDocs();
    const postDocs = sql(`SELECT COUNT(*) FROM requirement_doc WHERE workspace_id='${WS}'`);
    assert(postDocs === preDocs, "库：文档总数回到运行前（" + preDocs + "）");
    const postMembers = sql(`SELECT COUNT(*) FROM doc_visibility_member WHERE workspace_id='${WS}'`);
    assert(postMembers === preMembers, "库：名单总数回到运行前（" + preMembers + "）");
    const postActs = sql(`SELECT COUNT(*) FROM work_activity WHERE workspace_id='${WS}' AND entity_type='requirement_doc'`);
    assert(postActs === preActs, "库：文档动态回到运行前（无测试残留：" + preActs + " → " + postActs + "）");
    if(seedCatId) assert(sql(`SELECT COUNT(*) FROM doc_category WHERE id='${seedCatId}'`) === "0", "库：分类默认样本分类已清理");
    const postCats = sql(`SELECT COUNT(*) FROM doc_category WHERE workspace_id='${WS}'`);
    assert(postCats === preCats, "库：分类总数回到运行前（" + preCats + " → " + postCats + "）");
  });

  await drainBad();
  if(BAD_TOASTS.length){ failed++; console.log("\n  FAIL 红色 toast：" + BAD_TOASTS.join(" | ")); }
  else pass("全程无红色 toast");
  const expectPath = line => /\/api\/req-docs\//.test(line);
  const errs = cdp.errors.concat(cdp.resourceErrors).filter(l => !expectPath(l));
  if(errs.length){ failed++; console.log("\n  FAIL 控制台错误：" + errs.slice(0, 6).join(" | ")); }
  else pass("控制台零报错（不含身份矩阵刻意的 404/400 资源提示）");
  /* 身份矩阵刻意请求 404/400：只报非预期资源失败（静态资源 / 脚本） */
  const unexpected = cdp.netErrors.filter(u => !/\/api\/req-docs\//.test(u));
  if(unexpected.length){ failed++; console.log("\n  FAIL 非预期失败请求：" + unexpected.slice(0, 6).join(" | ")); }
  else pass("除刻意 404/400 外无失败请求");
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
