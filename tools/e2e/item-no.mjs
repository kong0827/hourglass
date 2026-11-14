/* 工作项 / 发布记录 / 需求 / 发布计划 / 用例人类可读编号 E2E（真实 ESM 应用，原生 CDP 骨架同 delivery-note.mjs）
   覆盖：项目内取号、改类型不换号、换项目重取号、软删除后编号不回收、
   按编号搜索（看板 + 全局）、抽屉编号胶囊与复制、发布记录编号与快照定格、
   交付纸张与接收人页不出现原始长 ID、快照 CSV 编号列、需求 / 计划 / 用例编号、移动端与控制台。

   前置：本地栈已起（bash deploy/local/stack.sh start），SQL 82–87 已应用。
   用法：node tools/e2e/item-no.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zctt2grh4x4j1";
const RICH = process.env.E2E_RICH_VERSION || "Vt6s11v3u8x2wiaaqigey";
const SHOTS = process.env.E2E_SHOTS || "/tmp/item-no-e2e";

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
      this.errors.push("log: " + msg.params.entry.text + (msg.params.entry.url ? " @" + msg.params.entry.url : ""));
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
const port = Number(process.env.E2E_CDP_PORT || 9234);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "item-no-e2e-"));
fs.mkdirSync(SHOTS, { recursive: true });
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const label = n => "WI-" + String(n).padStart(3, "0");
const relLabel = n => "REL-" + String(n).padStart(3, "0");
const dmLabel = n => "DM-" + String(n).padStart(3, "0");
const plLabel = n => "PL-" + String(n).padStart(3, "0");
const tcLabel = n => "TC-" + String(n).padStart(3, "0");

try{
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);

  async function newTab(){
    const t = await cdp.send("Target.createTarget", { url: "about:blank" });
    const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
    const call = (m, p) => cdp.send(m, p, sid);
    const evaluate = async expr => {
      const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expr, labelText, timeout = 15000) => {
      const deadline = Date.now() + timeout; let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error("等待超时：" + labelText + "（最后：" + JSON.stringify(last) + "）");
    };
    const shot = async name => {
      const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const out = path.join(SHOTS, name + ".png");
      fs.writeFileSync(out, Buffer.from(r.data, "base64"));
      return out;
    };
    /* 应用自己的 API 客户端：带 CSRF 与当前空间头，避免手搓 fetch 漏掉鉴权口径 */
    const api = (method, url, body) => evaluate(
      `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);
    return { targetId: t.targetId, sid, call, evaluate, waitFor, shot, api };
  }

  async function hardOpen(url){
    /* 首次直接导航，加载不到才退回 about:blank 重来。
       一上来就 about:blank 会掐断上一页仍在进行的懒加载（视图模块、编辑器脚本），
       在控制台留下「Failed to fetch dynamically imported module」这类假报错。 */
    for(let attempt = 0; ; attempt++){
      if(attempt > 0){
        await call("Page.navigate", { url: "about:blank" });
        await sleep(200);
      }
      await call("Page.navigate", { url });
      try{
        await waitFor(`document.readyState === "complete" && !!document.body`, "页面加载 " + url, 20000);
        return;
      }catch(e){ if(attempt >= 1) throw e; }
    }
  }

  const app = await newTab();
  const { call, evaluate, waitFor, shot, api } = app;
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: SHOTS, eventsEnabled: true });

  console.log("工作项 / 发布记录编号 E2E\n  地址：" + BASE + "\n  截图：" + SHOTS);

  /* ---------- 登录并落到被测空间 ---------- */
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await api("post", `/api/workspaces/${WS}/select`, {});
  /* 先回 about:blank：登录跳转已停在同一个 #/board，直接导航只改 hash 不会重载，空间偏好不生效 */
  await call("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await hardOpen(BASE + "/#/board");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录 " + USER + " 并切到空间 " + WS);

  /* ---------- 1. 项目内取号 ---------- */
  const reqs = await api("get", "/api/reqs").then(r => (r.items || r || []).map(x => ({ id: x.id, name: x.name })));
  assert(reqs.length >= 2, "空间内至少两个项目可用于换项目取号（实际 " + reqs.length + "）");
  const P1 = reqs[0].id, P2 = reqs[1].id;
  const stamp = Date.now();
  const created = [];

  const a = await api("post", "/api/tasks", { title: "编号验证A" + stamp, reqId: P1, boardColumn: "backlog" });
  created.push(a.id);
  assert(Number.isInteger(a.itemNo) && a.itemNo > 0, "新建工作项即取到项目内编号（" + label(a.itemNo) + "）");

  const b = await api("post", "/api/tasks", { title: "编号验证B" + stamp, reqId: P1, boardColumn: "backlog" });
  created.push(b.id);
  assert(b.itemNo === a.itemNo + 1, "同项目第二个工作项顺延取号（" + label(a.itemNo) + " → " + label(b.itemNo) + "）");

  const c = await api("post", "/api/tasks", { title: "编号验证C" + stamp, reqId: P2, boardColumn: "backlog" });
  created.push(c.id);
  /* 取号含软删除行，所以项目当前最大号要把回收站一起算进来 */
  const rows = r => (r && (r.items || r.rows || r.list)) || [];
  const p2Live = await api("get", `/api/tasks/list?reqs=${P2}&limit=500`).then(rows);
  const p2Trash = await api("get", "/api/trash?limit=500").then(rows);
  const p2Max = p2Live.concat(p2Trash).filter(t => t.reqId === P2 && t.id !== c.id)
    .reduce((m, t) => Math.max(m, t.itemNo || 0), 0);
  assert(c.itemNo === p2Max + 1, "另一个项目按自己的最大号独立取号（" + label(c.itemNo) + "，该项目原最大 " + p2Max + "）");
  const c2 = await api("post", "/api/tasks", { title: "编号验证C2" + stamp, reqId: P2, boardColumn: "backlog" });
  created.push(c2.id);
  assert(c2.itemNo === c.itemNo + 1, "第二个项目内部继续顺延（" + label(c.itemNo) + " → " + label(c2.itemNo) + "）");

  /* ---------- 2. 改类型不换号 ---------- */
  const aBug = await api("put", `/api/tasks/${a.id}`, { title: a.title, reqId: P1, itemType: "bug", severity: "major", boardColumn: "backlog", oldUpdatedAt: a.updatedAt });
  assert(aBug.itemNo === a.itemNo, "任务改缺陷沿用原编号（" + label(a.itemNo) + "，类型由徽标表达）");

  /* ---------- 3. 换项目重取号 ---------- */
  const aMoved = await api("put", `/api/tasks/${a.id}`, { title: a.title, reqId: P2, itemType: "bug", severity: "major", boardColumn: "backlog", oldUpdatedAt: aBug.updatedAt });
  /* 两个项目的序列可能恰好对到同一个值，编号相同也算重新取号；关键是不能重复占用目标项目已有编号 */
  assert(aMoved.itemNo > c2.itemNo, "换项目后接着目标项目当前最大号重新取号（" + label(c2.itemNo) + " → " + label(aMoved.itemNo) + "）");
  assert(aMoved.itemNo > 0, "换项目后编号有效（" + label(aMoved.itemNo) + "）");

  /* ---------- 4. 软删除后编号不回收 ---------- */
  await api("delete", `/api/tasks/${b.id}`);
  created.splice(created.indexOf(b.id), 1);   /* 已软删除，收尾不再重复删（重复删会 404 并污染控制台断言） */
  const d = await api("post", "/api/tasks", { title: "编号验证D" + stamp, reqId: P1, boardColumn: "backlog" });
  created.push(d.id);
  assert(d.itemNo > b.itemNo, "回收站里的编号不发给新工作项（已删 " + label(b.itemNo) + "，新建 " + label(d.itemNo) + "）");
  /* 再换回原项目：此时两边的序列已经错开，能验证「编号变化」的留痕文案 */
  const aBack = await api("put", `/api/tasks/${a.id}`, { title: a.title, reqId: P1, itemType: "bug", severity: "major", boardColumn: "backlog", oldUpdatedAt: aMoved.updatedAt });
  assert(aBack.itemNo > d.itemNo, "换回原项目仍按原项目序列取号（" + label(d.itemNo) + " → " + label(aBack.itemNo) + "）");
  const movedLogs = await api("get", `/api/tasks/${a.id}/logs`);
  const movedText = JSON.stringify(movedLogs);
  assert(movedText.indexOf("编号") >= 0 && movedText.indexOf(label(aBack.itemNo)) >= 0, "换项目留痕写明编号变化");

  /* ---------- 5. 按编号搜索 ---------- */
  for(const q of [label(d.itemNo), "wi" + d.itemNo, String(d.itemNo)]){
    const hit = await api("get", `/api/tasks/list?q=${encodeURIComponent(q)}&limit=50`)
      .then(r => rows(r).some(t => t.id === d.id));
    assert(hit, "看板搜索认编号形态「" + q + "」");
  }
  const textHit = await api("get", `/api/tasks/list?q=${encodeURIComponent("编号验证D" + stamp)}&limit=50`)
    .then(r => rows(r).some(t => t.id === d.id));
  assert(textHit, "普通文本搜索未被编号分支破坏");
  const globalHit = await api("get", `/api/search?q=${encodeURIComponent(label(d.itemNo))}`)
    .then(r => (r.hits || r || []).find(h => h.id === d.id || h.taskId === d.id));
  assert(!!globalHit, "全局搜索按编号命中工作项");
  assert(globalHit && String(globalHit.extra || "").indexOf(label(d.itemNo)) >= 0,
    "全局搜索命中理由显示编号（" + (globalHit ? globalHit.extra : "无") + "）");
  /* 我的工作：筛选条搜索框与看板共用口径，同样认编号 */
  const meId = await evaluate(`import("./js/core/state.js").then(({rt}) => rt.currentUser.id)`);
  const mine = await api("post", "/api/tasks", { title: "编号验证M" + stamp, reqId: P1, boardColumn: "backlog", ownerUserId: meId });
  created.push(mine.id);
  const myHit = await api("get", `/api/my-tasks?scope=all&q=${encodeURIComponent(label(mine.itemNo))}&limit=50`)
    .then(r => (r.items || []).some(t => t.id === mine.id));
  assert(myHit, "「我的工作」搜索认编号（" + label(mine.itemNo) + "）");

  /* ---------- 6. 抽屉编号胶囊 ---------- */
  await hardOpen(BASE + "/#/board?task=" + encodeURIComponent(d.id));
  await waitFor(`document.getElementById("drawerItemNo") && !document.getElementById("drawerItemNo").hidden`, "抽屉编号胶囊", 20000);
  const chip = await evaluate(`(() => {
    const el = document.getElementById("drawerItemNo");
    const r = el.getBoundingClientRect();
    return JSON.stringify({ text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0, tag: el.tagName });
  })()`).then(JSON.parse);
  assert(chip.text === label(d.itemNo), "抽屉胶囊显示 " + label(d.itemNo) + "（实际 " + chip.text + "）");
  assert(chip.visible && chip.tag === "BUTTON", "胶囊是可点击按钮且在版面内（" + chip.w + "×" + chip.h + "）");
  await shot("drawer-no-1440");
  await evaluate(`(() => { document.getElementById("drawerItemNo").click(); return true; })()`);
  await waitFor(`Array.from(document.querySelectorAll(".toast, .toast-item, [class*=toast]")).some(t => t.textContent.indexOf("编号") >= 0)`, "复制编号吐司", 8000);
  pass("点击胶囊提示编号已复制");
  /* 新建抽屉尚未取号：不显示胶囊，也不编造 WI-000 */
  await evaluate(`(() => { const b = document.getElementById("btnTaskNew"); if(b) b.click(); return true; })()`);
  await sleep(700);
  /* 描述编辑器是本地 2.5MB vendor 脚本：等它落地再关抽屉跳页，否则导航会掐断加载并触发 onerror */
  await waitFor(`!document.getElementById("iDesc") || typeof window.SUNEDITOR !== "undefined"`, "描述编辑器就绪", 20000);
  const blankChip = await evaluate(`(() => {
    const el = document.getElementById("drawerItemNo");
    return JSON.stringify({ hidden: !el || el.hidden, text: el ? el.textContent.trim() : "" });
  })()`).then(JSON.parse);
  assert(blankChip.hidden && !blankChip.text, "新建抽屉不显示编号胶囊（尚未取号）");
  await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
  await sleep(300);
  await hardOpen(BASE + "/#/board");
  await waitFor(`document.body.dataset.view === "board"`, "回到看板", 20000);

  /* ---------- 7. 发布记录编号与快照定格 ---------- */
  const cross = await api("get", "/api/versions/cross-project");
  const versions = Array.isArray(cross) ? cross : [];
  assert(versions.length > 0, "跨项目版本清单可用（" + versions.length + " 个版本）");
  /* 与服务端 latestSuccess 同口径：成功 + 生产 + 非回滚，按实际发生时间再按记录时间取最新 */
  const isSnapshot = r => r.result === "success" && r.environment === "production" && r.operation !== "rollback";
  const snapKey = r => String(r.occurredAt || "") + "|" + String(r.recordedAt || "");
  const allRecords = [];
  let snapVersion = null, snapRecord = null, rollbackRecord = null;
  for(const v of versions){
    const rs = (await api("get", `/api/versions/${v.versionId}/release-records`).catch(() => [])) || [];
    rs.forEach(r => { r.projectId = v.reqId; allRecords.push(r); });
    const latest = rs.filter(isSnapshot).sort((x, y) => snapKey(y).localeCompare(snapKey(x)))[0];
    if(!snapRecord && latest && (latest.items || []).some(i => i.taskItemNo)){ snapRecord = latest; snapVersion = v; }
    if(!rollbackRecord) rollbackRecord = rs.find(r => r.relatedReleaseId) || null;
  }
  assert(allRecords.length > 0, "空间内有发布记录（" + allRecords.length + " 条）");
  const numbered = allRecords.filter(r => Number.isInteger(r.releaseNo) && r.releaseNo > 0);
  assert(numbered.length === allRecords.length, "每条发布记录都有项目内编号（" + numbered.length + "/" + allRecords.length + "）");
  /* 编号是项目内序列：唯一性按项目判定，跨项目允许重号 */
  const seen = new Set(), dup = [];
  numbered.forEach(r => {
    const k = r.projectId + "#" + r.releaseNo;
    if(seen.has(k)) dup.push(k); else seen.add(k);
  });
  assert(dup.length === 0, "同项目内发布记录编号不重复" + (dup.length ? "（重复 " + dup.join("、") + "）" : ""));
  const withItems = allRecords.filter(r => (r.items || []).length);
  const unnumbered = withItems.reduce((n, r) => n + r.items.filter(i => !(Number.isInteger(i.taskItemNo) && i.taskItemNo > 0)).length, 0);
  assert(withItems.length > 0 && unnumbered === 0,
    "发布快照明细定格工作项编号（" + withItems.length + " 条有明细，未取号 " + unnumbered + " 行）");
  if(rollbackRecord){
    assert(Number.isInteger(rollbackRecord.relatedReleaseNo) && rollbackRecord.relatedReleaseNo > 0,
      "回滚记录透出关联事件编号（" + relLabel(rollbackRecord.relatedReleaseNo) + "）");
  }else{
    pass("空间内无回滚记录，跳过关联编号断言");
  }

  /* ---------- 8. 交付纸张不出现原始长 ID ---------- */
  await hardOpen(BASE + "/#/delivery");
  await waitFor(`document.body.dataset.view === "delivery"`, "进入交付说明视图", 20000);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(RICH)}, ""); return true; })`);
  await waitFor(`!!document.querySelector(".dl-sheet")`, "交付纸张渲染", 25000);
  const note = await api("get", `/api/versions/${RICH}/delivery-note`);
  const rawIds = []
    .concat((note.scope || []).map(x => x.id))
    .concat(((note.defects || {}).open || []).map(x => x.id))
    .concat(((note.defects || {}).fixed || []).map(x => x.id))
    .concat((note.demands || []).map(x => x.id))
    .concat(note.plan ? [note.plan.id] : [])
    .concat(allRecords.map(r => r.id))
    .filter(Boolean);
  const paper = await evaluate(`(() => {
    const s = document.querySelector(".dl-sheet");
    /* data-* 是导航与行为钩子：data-dl-ref 必须带原 ID 才能打开原始记录，不属于展示面。
       title / aria-label 这类会被读出来的属性仍然留在扫描范围内。 */
    const clone = s.cloneNode(true);
    [clone].concat(Array.from(clone.querySelectorAll("*"))).forEach(el => {
      Array.from(el.attributes).forEach(a => { if(a.name.indexOf("data-") === 0) el.removeAttribute(a.name); });
    });
    return JSON.stringify({ text: s.textContent, html: clone.innerHTML });
  })()`).then(JSON.parse);
  const leaked = rawIds.filter(id => paper.text.indexOf(id) >= 0 || paper.html.indexOf(id) >= 0).map(id => {
    const inText = paper.text.indexOf(id) >= 0;
    const src = inText ? paper.text : paper.html;
    const at = src.indexOf(id);
    return { id, inText, ctx: src.substring(Math.max(0, at - 70), at + id.length + 40) };
  });
  if(leaked.length) console.log("  泄漏明细：" + JSON.stringify(leaked, null, 1));
  const leakedText = leaked.filter(x => x.inText);
  assert(leakedText.length === 0, "纸张可见正文不含工作项 / 需求 / 计划 / 发布记录原始 ID（泄漏 " + leakedText.length + " 个）");
  assert(leaked.length === 0, "纸张属性（除 data-* 导航钩子）也不含原始 ID（泄漏 " + (leaked.length - leakedText.length) + " 个）");
  /* 编号只换展示面，导航仍按原 ID 走，否则「打开原始记录」会断链 */
  const refOk = await evaluate(`(() => {
    const b = document.querySelector('.dl-sheet [data-dl-act="evidence"][data-dl-view="phase"]');
    return !!b && !!b.dataset.dlRef;
  })()`);
  assert(refOk, "证据行仍带原 ID 导航钩子，可打开原始发布记录");
  assert(/WI-\d{3}/.test(paper.text), "纸张用 WI-001 形态引用工作项");
  assert(/REL-\d{3}/.test(paper.text), "纸张用 REL-001 形态引用发布记录");
  if((note.demands || []).some(x => Number.isInteger(x.demandNo) && x.demandNo > 0)){
    assert(/DM-\d{3}/.test(paper.text), "纸张用 DM-001 形态引用需求");
  }else{
    pass("该交付说明没有已取号的目标需求，跳过 DM 断言");
  }
  if(note.plan && Number.isInteger(note.plan.planNo) && note.plan.planNo > 0){
    assert(/PL-\d{3}/.test(paper.text), "纸张用 PL-001 形态引用发布计划");
  }else{
    pass("该交付说明没有发布计划，跳过 PL 断言");
  }
  await shot("delivery-paper-1440");

  /* ---------- 9. 快照 CSV 编号列（走版本卡「查看实际记录」真实入口） ---------- */
  assert(!!snapRecord, "找到带已取号工作项的成功生产快照"
    + (snapRecord ? "（" + snapVersion.versionName + " · " + relLabel(snapRecord.releaseNo) + "）" : ""));
  await hardOpen(BASE + "/#/phase");
  await waitFor(`document.body.dataset.view === "phase"`, "进入版本视图", 20000);
  /* 版本缓存按当前项目加载，先切到快照所属项目，否则弹窗取不到版本 */
  await evaluate(`import("./js/views/phase.js").then(m => { m.setPhaseProject(${JSON.stringify(snapVersion.reqId)}, "version"); return true; })`);
  const noteBtn = `[data-ver-note="${snapVersion.versionId}"]`;
  await waitFor(`!!document.querySelector(${JSON.stringify(noteBtn)})`, "版本卡「查看实际记录」入口", 25000);
  await evaluate(`(() => { document.querySelector(${JSON.stringify(noteBtn)}).click(); return true; })()`);
  await waitFor(`!!document.querySelector("[data-release-export]")`, "发布快照导出按钮", 25000);
  const csvId = await evaluate(`document.querySelector("[data-release-export]").dataset.releaseExport`);
  assert(csvId === snapRecord.id, "导出按钮指向最新成功生产记录（" + relLabel(snapRecord.releaseNo) + "）");
  const snapText = await evaluate(`(() => {
    const d = document.querySelector("details.release-record");
    return d ? d.textContent : "";
  })()`);
  assert(snapText.indexOf(relLabel(snapRecord.releaseNo)) >= 0,
    "快照抬头显示 " + relLabel(snapRecord.releaseNo) + " 而非长 ID");
  assert(snapText.indexOf(snapRecord.id) < 0, "快照抬头不再出现发布记录原始 ID");
  const snapItem = (snapRecord.items || []).find(i => i.taskItemNo) || null;
  if(snapItem){
    assert(snapText.indexOf(label(snapItem.taskItemNo)) >= 0 && snapText.indexOf(snapItem.taskId) < 0,
      "快照工作项列显示 " + label(snapItem.taskItemNo) + " 而非长 ID");
  }else{
    pass("该快照无已取号工作项，跳过工作项列断言");
  }
  await shot("release-snapshot-1440");
  await evaluate(`(() => { document.querySelector("[data-release-export]").click(); return true; })()`);
  await sleep(1500);
  const files = fs.readdirSync(SHOTS).filter(f => f.endsWith(".csv"));
  assert(files.length > 0, "快照 CSV 已下载（" + files.length + " 个）");
  if(files.length){
    const name = files[files.length - 1];
    const text = fs.readFileSync(path.join(SHOTS, name), "utf8");
    assert(text.indexOf("发布记录编号") >= 0 && text.indexOf("工作项编号") >= 0, "CSV 同时给出编号列与原 ID 列");
    assert(text.indexOf(relLabel(snapRecord.releaseNo)) >= 0, "CSV 含本记录编号 " + relLabel(snapRecord.releaseNo));
    assert(text.indexOf(snapRecord.id) >= 0, "CSV 保留发布记录原 ID 供对账");
    if(snapItem){
      assert(text.indexOf(label(snapItem.taskItemNo)) >= 0 && text.indexOf(snapItem.taskId) >= 0,
        "CSV 工作项编号与原 ID 并存（" + label(snapItem.taskItemNo) + "）");
    }
    assert(name.indexOf(relLabel(snapRecord.releaseNo)) >= 0, "CSV 文件名用编号而非长 ID（" + name + "）");
  }

  /* ---------- 10. 需求编号（DM-001） ---------- */
  const dem = await api("post", "/api/demands", { reqId: P1, title: "编号验证需求" + stamp, priority: "P2" });
  const dem2 = await api("post", "/api/demands", { reqId: P1, title: "编号验证需求2" + stamp, priority: "P2" });
  const demIds = [dem.id, dem2.id];
  assert(Number.isInteger(dem.demandNo) && dem.demandNo > 0, "新建需求即取到项目内编号（" + dmLabel(dem.demandNo) + "）");
  assert(dem2.demandNo === dem.demandNo + 1, "同项目第二个需求顺延取号（" + dmLabel(dem.demandNo) + " → " + dmLabel(dem2.demandNo) + "）");
  const demPage = q => api("get", `/api/demands?q=${encodeURIComponent(q)}&limit=100`).then(p => (p.items || []));  for(const q of [dmLabel(dem.demandNo), "dm" + dem.demandNo, String(dem.demandNo)]){
    const hit = await demPage(q).then(items => items.some(x => x.id === dem.id));
    assert(hit, "需求池搜索认编号形态「" + q + "」");
  }
  const demTextHit = await demPage("编号验证需求" + stamp).then(items => items.some(x => x.id === dem.id));
  assert(demTextHit, "需求普通文本搜索未被编号分支破坏");
  /* 删掉当前最大号再提一条：序列只增不减，不能把 DM-008 发给新需求 */
  await api("delete", `/api/demands/${dem2.id}`);
  demIds.splice(demIds.indexOf(dem2.id), 1);   /* 已删，收尾不再重复删（重复删会 404 并污染控制台断言） */
  const dem3 = await api("post", "/api/demands", { reqId: P1, title: "编号验证需求3" + stamp, priority: "P2" });
  demIds.push(dem3.id);
  assert(dem3.demandNo === dem2.demandNo + 1,
    "删除当前最大号后编号不回收（" + dmLabel(dem2.demandNo) + " → " + dmLabel(dem3.demandNo) + "）");
  /* 需求编号在项目内唯一，跨项目允许重号；这里只校验本项目的两条 */
  await hardOpen(BASE + "/#/demands");
  await waitFor(`document.body.dataset.view === "demands"`, "进入需求池", 20000);
  await evaluate(`import("./js/views/demands.js").then(m => m.openDemandDetailById(${JSON.stringify(dem.id)}))`);
  await waitFor(`!!document.querySelector(".demand-sheet [data-dem-copy-no]")`, "需求抽屉编号胶囊", 20000);
  const demChip = await evaluate(`document.querySelector(".demand-sheet [data-dem-copy-no]").textContent.trim()`);
  assert(demChip === dmLabel(dem.demandNo), "需求抽屉胶囊显示 " + dmLabel(dem.demandNo) + "（实际 " + demChip + "）");
  await evaluate(`(() => { document.querySelector(".demand-sheet [data-dem-copy-no]").click(); return true; })()`);
  await waitFor(`Array.from(document.querySelectorAll(".toast, .toast-item, [class*=toast]")).some(t => t.textContent.indexOf("需求编号") >= 0)`, "复制需求编号吐司", 8000);
  pass("点击需求胶囊提示编号已复制");
  await evaluate(`(() => { const x = document.querySelector(".demand-sheet [data-dem-x]"); if(x) x.click(); return true; })()`);
  await sleep(300);

  /* ---------- 11. 发布计划编号（PL-001，空间内） ----------
     发布计划没有删除接口，E2E 不能建了再删，否则演示库会永久留下脏计划；
     取号逻辑由 VersionReleaseServiceTest 兜底，这里只读现有计划验证展示面。 */
  const allPlans = [], planSeen = new Set();
  for(const v of versions){
    const rows = (await api("get", `/api/versions/${v.versionId}/release-plans`).catch(() => [])) || [];
    rows.forEach(p => {
      if(planSeen.has(p.id)) return;
      planSeen.add(p.id);
      p.versionId = v.versionId; p.versionName = v.versionName; p.reqId = v.reqId;
      allPlans.push(p);
    });
  }
  assert(allPlans.length > 0, "空间内有发布计划（" + allPlans.length + " 条）");
  const planUnnumbered = allPlans.filter(p => !(Number.isInteger(p.planNo) && p.planNo > 0));
  assert(planUnnumbered.length === 0, "每条发布计划都有空间内编号（未取号 " + planUnnumbered.length + " 条）");
  /* 计划可跨版本、跨项目，编号是空间内序列，因此去重按空间而不是按项目 */
  const planNoSeen = new Set(), planNoDup = [];
  allPlans.forEach(p => { if(planNoSeen.has(p.planNo)) planNoDup.push(plLabel(p.planNo)); else planNoSeen.add(p.planNo); });
  assert(planNoDup.length === 0, "空间内发布计划编号不重复" + (planNoDup.length ? "（重复 " + planNoDup.join("、") + "）" : ""));
  const plan = allPlans.find(p => Number.isInteger(p.planNo) && p.planNo > 0) || null;
  if(plan){
    await hardOpen(BASE + "/#/phase");
    await waitFor(`document.body.dataset.view === "phase"`, "进入版本视图", 20000);
    await evaluate(`import("./js/views/phase.js").then(m => { m.setPhaseProject(${JSON.stringify(plan.reqId)}, "version"); return true; })`);
    const detailBtn = `[data-ver-detail="${plan.versionId}"]`;
    await waitFor(`!!document.querySelector(${JSON.stringify(detailBtn)})`, "版本卡「计划与历史」入口", 25000);
    await evaluate(`(() => { document.querySelector(${JSON.stringify(detailBtn)}).click(); return true; })()`);
    await waitFor(`!!document.querySelector("[data-plan-select]")`, "发布计划选择框", 25000);
    await evaluate(`(() => {
      const sel = document.querySelector("[data-plan-select]");
      sel.value = ${JSON.stringify(plan.id)};
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitFor(`!!document.querySelector("[data-plan-select]") && document.querySelector(".release-section .hint")`, "计划摘要", 15000);
    const planHint = await evaluate(`document.querySelector(".release-section .hint").textContent`);
    assert(planHint.indexOf(plLabel(plan.planNo)) >= 0, "计划摘要显示 " + plLabel(plan.planNo) + "（实际：" + planHint.slice(0, 40) + "…）");
    assert(planHint.indexOf(plan.id) < 0, "计划摘要不再出现计划原始 ID");
    await shot("release-plan-no-1440");
  }else{
    pass("空间内没有已取号的发布计划，跳过摘要断言");
  }

  /* ---------- 12. 用例编号（TC-001） ---------- */
  const tc = await api("post", "/api/test-cases", { reqId: P1, title: "编号验证用例" + stamp, priority: "P2" });
  assert(Number.isInteger(tc.caseNo) && tc.caseNo > 0, "新建用例即取到项目内编号（" + tcLabel(tc.caseNo) + "）");
  const tcPage = q => api("get", `/api/test-cases?reqId=${encodeURIComponent(P1)}&q=${encodeURIComponent(q)}&limit=100`).then(p => (p.items || []));
  for(const q of [tcLabel(tc.caseNo), "tc" + tc.caseNo, String(tc.caseNo)]){
    const hit = await tcPage(q).then(items => items.some(x => x.id === tc.id));
    assert(hit, "用例列表搜索认编号形态「" + q + "」");
  }
  const tcTextHit = await tcPage("编号验证用例" + stamp).then(items => items.some(x => x.id === tc.id));
  assert(tcTextHit, "用例普通文本搜索未被编号分支破坏");
  const globalCase = await api("get", `/api/search?q=${encodeURIComponent(tcLabel(tc.caseNo))}&limit=10`);
  const caseHit = (Array.isArray(globalCase) ? globalCase : []).find(h => h.type === "case" && h.id === tc.id);
  assert(!!caseHit, "全局搜索按 " + tcLabel(tc.caseNo) + " 命中用例");
  assert(!!caseHit && String(caseHit.extra || "").indexOf(tcLabel(tc.caseNo)) >= 0,
    "全局搜索用例结果带编号（实际：" + (caseHit && caseHit.extra) + "）");
  await hardOpen(BASE + "/#/testcases");
  await waitFor(`document.body.dataset.view === "testcases"`, "进入测试用例页", 20000);
  const tcRow = `[data-tc-open="${tc.id}"]`;
  await evaluate(`(() => {
    const sel = document.getElementById("tcReq");
    if(sel){ sel.value = ${JSON.stringify(P1)}; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    return true;
  })()`);
  await waitFor(`!!document.querySelector(${JSON.stringify(tcRow)})`, "用例行出现", 25000);
  const chipText = await evaluate(`(document.querySelector(${JSON.stringify(tcRow)} + " .tc-no") || {}).textContent`);
  assert(String(chipText || "").trim() === tcLabel(tc.caseNo), "列表行编号胶囊显示 " + tcLabel(tc.caseNo) + "（实际 " + chipText + "）");
  /* 删除当前最大号再建一条：序列只增不减，TC 编号不能回收 */
  await api("delete", `/api/test-cases/${tc.id}`);
  const tc2 = await api("post", "/api/test-cases", { reqId: P1, title: "编号验证用例2" + stamp, priority: "P2" });
  assert(tc2.caseNo === tc.caseNo + 1,
    "删除用例后编号不回收（" + tcLabel(tc.caseNo) + " → " + tcLabel(tc2.caseNo) + "）");

  /* ---------- 13. 移动端 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await hardOpen(BASE + "/#/board?task=" + encodeURIComponent(d.id));
  await waitFor(`document.getElementById("drawerItemNo") && !document.getElementById("drawerItemNo").hidden`, "移动端编号胶囊", 20000);
  const mob = await evaluate(`(() => {
    const el = document.getElementById("drawerItemNo");
    const r = el.getBoundingClientRect();
    const line = el.closest(".head-title-line").getBoundingClientRect();
    return JSON.stringify({ text: el.textContent.trim(), right: Math.round(r.right),
      lineRight: Math.round(line.right), overflow: document.documentElement.scrollWidth > window.innerWidth });
  })()`).then(JSON.parse);
  assert(mob.text === label(d.itemNo), "移动端胶囊编号正确（" + mob.text + "）");
  assert(mob.right <= mob.lineRight + 1, "移动端胶囊未溢出标题行（" + mob.right + " ≤ " + mob.lineRight + "）");
  assert(!mob.overflow, "移动端无横向溢出");
  await shot("drawer-no-390");
  await call("Emulation.clearDeviceMetricsOverride");

  /* ---------- 14. 清理与控制台 ---------- */
  for(const id of created){ await api("delete", `/api/tasks/${id}`).catch(() => {}); }
  pass("清理本次新建的 " + created.length + " 个工作项（软删除，编号不回收）");
  for(const id of demIds){ await api("delete", `/api/demands/${id}`).catch(() => {}); }
  pass("清理本次新建的 " + demIds.length + " 条需求（需求删除是硬删除）");
  await api("delete", `/api/test-cases/${tc2.id}`).catch(() => {});
  pass("清理本次新建的用例（用例删除是硬删除）");
  const errors = cdp.errors.filter(e => e.indexOf("favicon") < 0);
  assert(errors.length === 0, "控制台无报错" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));

  console.log(failed ? "\n结果：" + failed + " 项失败" : "\n结果：全部通过");
}catch(e){
  failed++;
  console.log("  FAIL 异常中断：" + (e && e.message));
  console.log(e && e.stack);
}finally{
  try{ proc.kill(); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
process.exit(failed ? 1 : 0);