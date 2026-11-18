/* 全部项目「项目 → 分组」两级目录：真实前端 ESM + headless Chrome/CDP 验证。
   本地演示库登录凭据不可用时，用 fetch 拦截注入一份最小数据集；页面、样式与交互全部真实，
   只有 /api/** 的响应是 mock。不写任何业务数据。
   用法：node tools/e2e/case-all-projects.mjs
   静态文件由脚本内临时服务提供；设置 E2E_BASE 可复用已有站点。
   截图：docs/audit/prototypes/testcase-allprojects-2026-11-18/impl */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("C:/Users/F2041/AppData/Local/Temp/e2e-ws/node_modules/ws");
const CHROME = process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9337);
const SHOT_DIR = path.resolve("docs/audit/prototypes/testcase-allprojects-2026-11-18/impl");
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 临时静态服务：只读 frontend/，映射到 /hourglass，与部署路径一致 */
const WEB_ROOT = path.resolve("frontend");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json"
};
function startStatic(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try{
        const u = new URL(req.url, "http://local");
        const prefix = "/hourglass";
        if(u.pathname === "/" || u.pathname === prefix){ res.writeHead(302, { location: prefix + "/index.html" }); res.end(); return; }
        if(u.pathname.indexOf(prefix + "/") !== 0){ res.writeHead(404); res.end("not found"); return; }
        let rel = decodeURIComponent(u.pathname.slice(prefix.length + 1)) || "index.html";
        const file = path.resolve(WEB_ROOT, rel);
        if(file !== WEB_ROOT && file.indexOf(WEB_ROOT + path.sep) !== 0){ res.writeHead(403); res.end("forbidden"); return; }
        fs.readFile(file, (err, buf) => {
          if(err){ res.writeHead(404); res.end("not found"); return; }
          res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
          res.end(buf);
        });
      }catch(e){ res.writeHead(500); res.end("server error"); }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const staticServer = process.env.E2E_BASE ? null : await startStatic();
const BASE = (process.env.E2E_BASE || ("http://127.0.0.1:" + staticServer.address().port + "/hourglass")).replace(/\/+$/, "");

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const group = name => console.log("\n[" + name + "]");

const MOCK = {
  user: { id: "U1", username: "admin", displayName: "管理员", role: "admin", lastWorkspaceId: "ws1" },
  workspace: { id: "ws1", name: "演示空间", type: "shared", myRole: "owner", memberCount: 3 },
  projectSets: [{ id: "ps1", name: "星网数字化", sortOrder: 1 }, { id: "ps2", name: "运营平台", sortOrder: 2 }],
  projects: [
    { id: "p1", name: "客户门户重构", setId: "ps1", setName: "星网数字化", ownerUserId: "U1", access: "write" },
    { id: "p2", name: "移动端 App 2.0", setId: "ps1", setName: "星网数字化", ownerUserId: "U1", access: "write" },
    { id: "p3", name: "数据看板", setId: "ps2", setName: "运营平台", ownerUserId: "U1", access: "write" },
    { id: "p4", name: "消息中心", setId: "ps2", setName: "运营平台", ownerUserId: "U1", access: "write" },
    { id: "p5", name: "内部知识库", setId: "", setName: "", ownerUserId: "U9", access: "read" }
  ],
  sets: [
    { id: "s1", reqId: "p1", parentId: "", level: 1, name: "冒烟测试", visibility: "team", kind: "normal", caseCount: 1, subtreeCount: 2, editable: true },
    { id: "s1a", reqId: "p1", parentId: "s1", level: 2, name: "支付", visibility: "team", kind: "normal", caseCount: 1, subtreeCount: 1, editable: true },
    { id: "s2", reqId: "p1", parentId: "", level: 1, name: "回归测试", visibility: "members", kind: "normal", caseCount: 1, subtreeCount: 1, editable: true },
    { id: "s3", reqId: "p2", parentId: "", level: 1, name: "登录注册", visibility: "team", kind: "normal", caseCount: 2, subtreeCount: 2, editable: true },
    { id: "s4", reqId: "p4", parentId: "", level: 1, name: "消息列表", visibility: "personal", kind: "dynamic", caseCount: 1, subtreeCount: 1, editable: true }
  ],
  cases: [
    { id: "c1", reqId: "p1", setId: "s1", caseNo: 1, title: "登录页账号密码校验通过", priority: "P0", module: "账号 / 登录", latestStatus: "passed", latestBy: "王浩", latestAt: "2026-11-17 10:20", steps: [1, 2, 3], demandTitle: "门户统一登录" },
    { id: "c2", reqId: "p1", setId: "s1a", caseNo: 2, title: "支付回调超时后订单状态回滚", priority: "P1", module: "支付 / 回调", latestStatus: "blocked", latestBy: "李娜", latestAt: "2026-11-17 14:05", steps: [1, 2], latestNote: "第三方沙箱不可用" },
    { id: "c3", reqId: "p1", setId: "s2", caseNo: 3, title: "退货申请重复提交只生成一笔", priority: "P2", module: "售后 / 退货", latestStatus: "failed", latestBy: "赵磊", latestAt: "2026-11-16 17:40", steps: [1, 2, 3, 4] },
    { id: "c4", reqId: "p1", caseNo: 4, title: "首页 Banner 轮播切换", priority: "P3", module: "首页", steps: [], latestStatus: "" },
    { id: "c5", reqId: "p2", setId: "s3", caseNo: 1, title: "手机号验证码登录", priority: "P0", module: "登录", latestStatus: "passed", latestBy: "张伟", latestAt: "2026-11-18 09:10", steps: [1, 2] },
    { id: "c6", reqId: "p2", setId: "s3", caseNo: 2, title: "微信授权静默登录", priority: "P1", module: "登录", steps: [1] },
    { id: "c7", reqId: "p3", caseNo: 1, title: "看板日期区间联动指标卡", priority: "P1", module: "总览", latestStatus: "passed", latestBy: "王浩", latestAt: "2026-11-15 11:00", steps: [1, 2] },
    { id: "c8", reqId: "p3", caseNo: 2, title: "导出 CSV 含表头", priority: "P2", module: "导出", steps: [1] },
    { id: "c9", reqId: "p4", setId: "s4", caseNo: 1, title: "未读消息角标随已读清零", priority: "P1", module: "消息中心", latestStatus: "passed", latestBy: "周涛", latestAt: "2026-11-14 16:20", steps: [1, 2] },
    { id: "c10", reqId: "p4", caseNo: 2, title: "消息列表按类型筛选", priority: "P2", module: "消息中心", steps: [1] },
    { id: "c11", reqId: "p4", caseNo: 3, title: "批量已读二次确认", priority: "P3", module: "消息中心", steps: [1] }
  ],
  modules: [
    { id: "m1", reqId: "p1", parentId: "", level: 1, name: "账号", caseCount: 1, subtreeCount: 2 },
    { id: "m2", reqId: "p1", parentId: "m1", level: 2, name: "登录", caseCount: 1, subtreeCount: 1 },
    { id: "m3", reqId: "p1", parentId: "", level: 1, name: "支付", caseCount: 1, subtreeCount: 1 }
  ]
};

/* 在页面脚本之前注入 mock fetch / EventSource */
const BOOT = `(() => {
  const M = ${JSON.stringify(MOCK)};
  window.__MOCK__ = M;
  window.__mockUnknown = [];
  /* 故障注入：设成项目 id 后，该项目的用例列表返回业务错误，用来验证段内重试 */
  window.__mockFail = "";
  const json = data => new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  const failJson = msg => new Response(JSON.stringify({ code: 500, message: msg }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  const paged = (arr, sp) => {
    const offset = Number(sp.get("offset") || 0), limit = Number(sp.get("limit") || 100);
    const rows = arr.slice(offset, offset + limit);
    return { items: rows, total: arr.length, hasMore: offset + rows.length < arr.length };
  };
  const ancestors = id => { const out = []; let cur = M.sets.find(s => s.id === id); let guard = 0; while(cur && guard++ < 20){ out.push(cur.id); cur = cur.parentId ? M.sets.find(s => s.id === cur.parentId) : null; } return out; };
  const casesFor = (reqId, sp) => M.cases.filter(c => {
    if(reqId && c.reqId !== reqId) return false;
    const setId = sp.get("setId");
    if(setId === "__none" && c.setId) return false;
    if(setId && setId !== "__none"){
      if(c.setId === setId) return true;
      if(!sp.get("setSub")) return false;
      return !!c.setId && ancestors(c.setId).indexOf(setId) >= 0;
    }
    const st = sp.get("status");
    if(st === "__untested" && c.latestStatus) return false;
    if(st && st !== "__untested" && c.latestStatus !== st) return false;
    const pri = sp.get("pri"); if(pri && c.priority !== pri) return false;
    const owner = sp.get("owner"); if(owner && c.latestBy !== owner) return false;
    const q = (sp.get("q") || "").toLowerCase();
    if(q && (c.title || "").toLowerCase().indexOf(q) < 0 && ("tc-" + c.caseNo).indexOf(q) < 0) return false;
    return true;
  });
  const handle = (method, path, sp) => {
    if(method !== "GET") return undefined;
    if(path === "/hourglass/api/auth/me") return M.user;
    if(path === "/hourglass/api/workspaces") return [M.workspace];
    if(path === "/hourglass/api/project-sets") return M.projectSets;
    if(path === "/hourglass/api/reqs") return paged(M.projects, sp);
    if(path === "/hourglass/api/tasks/list") return { items: [], total: 0, hasMore: false };
    if(path === "/hourglass/api/categories") return [];
    if(path === "/hourglass/api/case-sets") return M.sets.filter(s => !sp.get("reqId") || s.reqId === sp.get("reqId"));
    if(path === "/hourglass/api/test-modules") return M.modules.filter(m => !sp.get("reqId") || m.reqId === sp.get("reqId"));
    if(path === "/hourglass/api/test-cases"){
      const arr = casesFor(sp.get("reqId"), sp);
      if(sp.get("sort") === "no") arr.sort((a, b) => a.caseNo - b.caseNo);
      return paged(arr, sp);
    }
    if(path === "/hourglass/api/test-cases/stats"){
      const arr = casesFor(sp.get("reqId"), sp);
      const count = k => arr.filter(c => (c.latestStatus || "untested") === k).length;
      return { total: arr.length, passed: count("passed"), failed: count("failed"), blocked: count("blocked"), skipped: count("skipped"), untested: count("untested"),
        modules: [...new Set(arr.map(c => c.module).filter(Boolean))], owners: [...new Set(arr.map(c => c.latestBy).filter(Boolean))],
        moduleCounts: {}, ownerCounts: {}, priorityCounts: {}, moduleNodes: [], moduleIdCounts: {} };
    }
    if(/\\/api\\/notifications/.test(path)) return { items: [], unread: 0 };
    return undefined;
  };
  window.fetch = function(input, init){
    const url = typeof input === "string" ? input : input.url;
    const u = new URL(url, location.href);
    if(u.pathname.indexOf("/api/") < 0) return window.__realFetch(url, init);
    const method = String((init && init.method) || "GET").toUpperCase();
    if(window.__mockFail && u.pathname === "/hourglass/api/test-cases" && u.searchParams.get("reqId") === window.__mockFail)
      return Promise.resolve(failJson("模拟：服务暂时不可用"));
    const out = handle(method, u.pathname, u.searchParams);
    if(out === undefined){ window.__mockUnknown.push(method + " " + u.pathname + u.search); return Promise.resolve(json(null)); }
    return Promise.resolve(json(out));
  };
  window.EventSource = class { constructor(){} addEventListener(){} removeEventListener(){} close(){} };
})();`;

fs.mkdirSync(SHOT_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-all-proj-"));
const proc = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--hide-scrollbars",
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding", "--remote-allow-origins=*"
], { stdio: "ignore" });

class Cdp {
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.on("message", raw => this.onMessage(String(raw)));
  }
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

let cdp, call, evaluate, waitFor, shot;
try{
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); }
    catch(e){ await sleep(250); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  call = (m, p) => cdp.send(m, p, sessionId);
  evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  waitFor = async (expr, label, timeout = 25000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(200);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const setInput = (sel, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if(!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);

  console.log("全部项目两级目录端到端验证（mock API，真实页面与交互）\n  地址：" + BASE);
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__realFetch = window.fetch.bind(window); ${BOOT}`
  });
  await call("Page.navigate", { url: BASE + "/index.html#/testcases" });
  await waitFor(`document.body && document.body.dataset.view === "testcases"`, "进入用例页", 30000);
  await waitFor(`!!document.querySelector("#tcList .tc-row")`, "首屏用例加载", 30000);

  /* 切到全部项目 */
  await evaluate(`(() => {
    const el = document.getElementById("tcReq");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "__all__");
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(`!document.getElementById("tcSidePanel").hidden && document.querySelectorAll("#tcSideBody .tc-all-proj").length === ${MOCK.projects.length}`, "全部项目树", 30000);
  await waitFor(`document.querySelectorAll("#tcSideBody .tc-all-loading").length === 0`, "分组加载完成", 30000);
  await waitFor(`document.querySelectorAll("#tcList .tc-group-head").length > 0`, "项目分段");

  group("概览");
  const overview = await evaluate(`(() => {
    const body = document.getElementById("tcSideBody");
    const heads = [...document.querySelectorAll("#tcList .tc-group-head")];
    const rows = [...document.querySelectorAll("#tcList .tc-row")];
    return {
      title: (body.querySelector(".tc-side-title") || {}).textContent || "",
      count: (body.querySelector(".tc-side-count") || {}).textContent || "",
      projects: body.querySelectorAll(".tc-all-proj").length,
      setRows: body.querySelectorAll(".tc-all-proj .tc-set-item").length,
      errors: body.querySelectorAll(".tc-all-error").length,
      heads: heads.length,
      chips: document.querySelectorAll("#tcList .tc-gchip").length,
      projPills: document.querySelectorAll("#tcList .tc-proj-pill").length,
      rows: rows.length,
      picks: document.querySelectorAll("#tcList .tc-row .tc-pick").length,
      sticky: heads.length ? getComputedStyle(heads[0]).position : "",
      headNames: heads.map(h => (h.querySelector(".tc-group-name") || {}).textContent || ""),
      scopeHidden: document.getElementById("tcScopeBar").hidden,
      meta: document.getElementById("tcMeta").textContent,
      bulk: (document.getElementById("tcBulkCount") || {}).textContent || "",
      bulkHint: (document.getElementById("tcBulkHint") || {}).textContent || "",
      clearHidden: document.getElementById("tcClearFilter").hidden,
      statsHidden: document.getElementById("tcStats").hidden,
      exportShown: document.getElementById("btnCaseCsvOut").getClientRects().length > 0,
      importShown: document.getElementById("tcImportWrap").getClientRects().length > 0,
      enterBtns: document.querySelectorAll("#tcList [data-tc-all-enter]").length,
      overviewHints: document.querySelectorAll("#tcSideBody .tc-all-hint").length
    };
  })()`);
  assert(/项目 \/ 分组/.test(overview.title), "侧栏标题显示「项目 / 分组」：" + overview.title.trim());
  assert(overview.projects === MOCK.projects.length, "树里项目数与可见项目一致（" + overview.projects + "/" + MOCK.projects.length + "）");
  assert(overview.errors === 0, "无分组加载失败");
  assert(overview.heads === 4, "有内容的项目各成一段，空项目不占版面（" + overview.heads + " 段：" + overview.headNames.join("、") + "）");
  assert(overview.projPills > 0 && overview.projPills <= overview.rows, "行内项目 pill 已标注（" + overview.projPills + "/" + overview.rows + " 行）");
  assert(overview.picks === 0, "概览不提供跨项目勾选");
  assert(overview.sticky === "sticky", "段头吸顶生效（position:" + overview.sticky + "）");
  assert(overview.scopeHidden === true, "概览不显示范围条");
  assert(overview.chips >= 3, "段头出现分组 chip（" + overview.chips + " 个）");
  assert(overview.enterBtns === overview.heads, "每段都有「进入项目」入口（" + overview.enterBtns + "/" + overview.heads + "）");
  assert(/只读/.test(overview.bulk) && !/可编辑/.test(overview.bulk), "概览的批量条是只读状态而不是可编辑条数：" + overview.bulk.trim());
  assert(overview.bulkHint.indexOf("只读") >= 0, "只读批量条给出原因与下一步：" + overview.bulkHint.trim());
  assert(overview.statsHidden === true, "概览隐藏执行结果计数（各项目不可相加）");
  assert(overview.clearHidden === true, "概览没有筛选时不显示「清空筛选」");
  assert(overview.exportShown === false && overview.importShown === false, "概览收起导入导出（没有唯一项目）");
  assert(/全部项目/.test(overview.meta), "列表标题交代全部项目：" + overview.meta);
  await shot("01-overview-1440.png");

  group("树搜索");
  await setInput("#tcAllSetSearch", "zzz不存在的名字");
  const noHit = await evaluate(`({
    projects: document.querySelectorAll("#tcSideBody .tc-all-proj").length,
    empty: (document.querySelector("#tcSideBody .tc-side-empty") || {}).textContent || ""
  })`);
  assert(noHit.projects === 0 && /没有匹配/.test(noHit.empty), "搜索无命中时给出空态：" + noHit.empty.trim());
  await setInput("#tcAllSetSearch", "");
  await waitFor(`document.querySelectorAll("#tcSideBody .tc-all-proj").length === ${MOCK.projects.length}`, "搜索清空恢复");

  group("收窄到项目");
  await click('[data-tc-all-proj-pick="p1"]');
  await waitFor(`!document.getElementById("tcScopeBar").hidden`, "范围条出现");
  await waitFor(`document.querySelectorAll("#tcList .tc-group-head").length === 1`, "列表只剩该项目");
  const narrowed = await evaluate(`(() => ({
    chip: (document.querySelector("[data-tc-scope-proj]") || {}).textContent || "",
    hasSetChip: !!document.querySelector("[data-tc-scope-set]"),
    meta: document.getElementById("tcMeta").textContent,
    heads: document.querySelectorAll("#tcList .tc-group-head").length,
    pills: document.querySelectorAll("#tcList .tc-proj-pill").length,
    picks: document.querySelectorAll("#tcList .tc-row .tc-pick").length,
    chips: document.querySelectorAll("#tcList .tc-gchip").length,
    statChips: document.querySelectorAll("#tcStats [data-tc-status]").length,
    statsHidden: document.getElementById("tcStats").hidden,
    bulk: (document.getElementById("tcBulkCount") || {}).textContent || "",
    enterBtns: document.querySelectorAll("#tcList [data-tc-all-enter]").length,
    exportShown: document.getElementById("btnCaseCsvOut").getClientRects().length > 0,
    importShown: document.getElementById("tcImportWrap").getClientRects().length > 0,
    aiShown: document.getElementById("btnCaseAi").getClientRects().length > 0,
    selFilteredHidden: document.getElementById("tcSelFiltered").hidden,
    batchAllDisabled: document.getElementById("tcBulkAll").disabled
  }))()`);
  assert(/项目/.test(narrowed.chip) && narrowed.chip.indexOf("客户门户重构") >= 0, "范围条显示项目 chip：" + narrowed.chip.trim());
  assert(narrowed.hasSetChip === false, "未选分组时不显示分组 chip");
  assert(narrowed.heads === 1, "列表只剩一个项目段");
  assert(narrowed.pills === 0, "收窄后行内不再重复项目 pill");
  assert(/共/.test(narrowed.meta) && narrowed.meta.indexOf("客户门户重构") >= 0, "标题写明项目与条数：" + narrowed.meta);
  assert(narrowed.chips >= 3, "段头出现分组 chip（" + narrowed.chips + " 个）");
  assert(narrowed.statsHidden === false && narrowed.statChips === 6, "收窄后显示执行结果计数（" + narrowed.statChips + " 个 chip）");
  assert(narrowed.enterBtns === 0, "已在项目内，段头不再重复「进入项目」");
  assert(!/只读/.test(narrowed.bulk), "收窄后可编辑，批量条不再写只读：" + narrowed.bulk.trim());
  assert(narrowed.exportShown === true && narrowed.importShown === true, "收窄到项目后导入导出与批量修改同口径可用");
  assert(narrowed.aiShown === false, "AI 生成仍在进入项目后开放");
  assert(narrowed.picks > 0, "收窄后可勾选（" + narrowed.picks + " 行）");
  assert(narrowed.batchAllDisabled === false, "收窄后全选可用");
  await shot("02-narrowed-project-1440.png");

  group("收窄到分组");
  await click('[data-tc-all-set-pick="s1"]');
  await waitFor(`!!document.querySelector("[data-tc-scope-set]")`, "分组 chip");
  await sleep(500);
  const inSet = await evaluate(`({
    chip: (document.querySelector("[data-tc-scope-set]") || {}).textContent || "",
    meta: document.getElementById("tcMeta").textContent,
    rows: document.querySelectorAll("#tcList .tc-row").length,
    clearHidden: document.getElementById("tcClearFilter").hidden,
    countBadge: (document.getElementById("tcFilterCount") || {}).textContent || "",
    countBadgeHidden: (document.getElementById("tcFilterCount") || {}).hidden,
    on: ((document.querySelector('[data-tc-all-set-pick="s1"]') || {}).parentNode || {}).className || "",
    headChipOn: (document.querySelector('[data-tc-all-set-chip="s1"]') || {}).className || ""
  })`);
  assert(inSet.chip.indexOf("冒烟测试") >= 0, "范围条显示分组 chip：" + inSet.chip.trim());
  assert(inSet.meta.indexOf("分组「冒烟测试」") >= 0, "标题写明分组范围：" + inSet.meta);
  assert(inSet.on.indexOf("on") >= 0, "侧栏该分组保持选中态");
  assert(inSet.headChipOn.indexOf("on") >= 0, "段头对应 chip 保持选中态");
  assert(inSet.rows === 2, "父分组含子分组用例（子树 2 条，实际 " + inSet.rows + " 条）");
  assert(inSet.clearHidden === true, "分组是浏览范围不是筛选条件：「清空筛选」保持隐藏，清范围走范围条");
  assert(inSet.countBadgeHidden === true, "筛选条件计数不把分组算进去（角标隐藏）");
  await shot("03-narrowed-group-1440.png");

  group("段头 chip 切换 / 清除分组");
  await click('[data-tc-all-set-chip="s2"]');
  await waitFor(`(document.querySelector("[data-tc-scope-set]") || {}).textContent.indexOf("回归测试") >= 0`, "切到回归分组");
  const sub = await evaluate(`({ rows: document.querySelectorAll("#tcList .tc-row").length, meta: document.getElementById("tcMeta").textContent })`);
  assert(sub.rows === 1, "另一个分组收窄到 1 条（实际 " + sub.rows + "）");
  await click("[data-tc-scope-set]");
  await waitFor(`!document.querySelector("[data-tc-scope-set]")`, "取消分组");
  await click("[data-tc-scope-reset]");
  await waitFor(`document.getElementById("tcScopeBar").hidden`, "清空范围回到概览");
  const back = await evaluate(`({
    heads: document.querySelectorAll("#tcList .tc-group-head").length,
    picks: document.querySelectorAll("#tcList .tc-row .tc-pick").length
  })`);
  assert(back.heads === 4 && back.picks === 0, "回到概览：多段且不可勾选（" + back.heads + " 段）");

  group("进入项目");
  await click('[data-tc-all-proj-pick="p1"]');
  await waitFor(`!document.getElementById("tcScopeBar").hidden`, "范围条再现");
  await click("#tcScopeBar [data-tc-all-enter]");
  await waitFor(`document.getElementById("tcReq").value === "p1"`, "项目下拉切到该项目");
  await waitFor(`document.getElementById("tcScopeBar").hidden`, "范围条收起");
  const single = await evaluate(`({
    allRows: document.querySelectorAll("#tcSideBody .tc-all-proj").length,
    sideTitle: (document.querySelector("#tcSideBody .tc-side-title") || {}).textContent || "",
    meta: document.getElementById("tcMeta").textContent,
    groups: [...document.querySelectorAll("#tcSideBody .tc-set-item")].map(e => e.textContent.trim())
  })`);
  assert(single.allRows === 0, "进入项目后左栏回到单项目分组树");
  assert(single.meta.indexOf("全部项目") < 0, "标题不再写全部项目：" + single.meta);
  assert(single.groups.length >= 2, "单项目分组树正常（" + single.groups.length + " 个分组）");
  await shot("04-entered-project-1440.png");

  group("返回全部项目");
  await evaluate(`(() => {
    const el = document.getElementById("tcReq");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "__all__");
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll("#tcSideBody .tc-all-proj").length === ${MOCK.projects.length}`, "回到全部项目");

  group("单项目加载失败与重试");
  await evaluate(`(window.__mockFail = "p3", true)`);
  await click('[data-tc-all-proj-pick="p2"]');
  await waitFor(`!document.getElementById("tcScopeBar").hidden`, "窄化到 p2 触发重取");
  await click("[data-tc-scope-reset]");
  await waitFor(`!!document.querySelector('#tcList [data-tc-group-retry="p3"]')`, "失败段出现重试入口", 30000);
  const failState = await evaluate(`(() => {
    const btn = document.querySelector('#tcList [data-tc-group-retry="p3"]');
    const row = document.querySelector('[data-tc-all-proj-pick="p3"]');
    return {
      text: (btn.closest(".tc-group-empty") || {}).textContent || "",
      heads: document.querySelectorAll("#tcList .tc-group-head").length,
      rows: document.querySelectorAll("#tcList .tc-row").length,
      meta: document.getElementById("tcMeta").textContent,
      grand: (document.querySelector("[data-tc-all-root] .tc-dir-n") || {}).textContent || "",
      projTotal: row ? ((row.querySelector(".tc-dir-n") || {}).textContent || "") : "missing",
      headCount: (document.querySelector('[data-tc-group="p3"] .tc-group-count') || {}).textContent || ""
    };
  })()`);
  assert(/加载失败/.test(failState.text), "失败项目就地提示并可重试：" + failState.text.trim());
  assert(failState.heads === 4, "其余项目照常展示（" + failState.heads + " 段）");
  assert(failState.rows === 9, "失败项目不占行数，其余用例照常列出（" + failState.rows + " 行）");
  assert(/加载失败/.test(failState.meta), "标题点明有项目没取到：" + failState.meta);
  assert(failState.headCount === "", "失败段不写「0 条用例」，避免把故障当成空项目");
  assert(failState.grand === "11", "侧栏总数保留已知值，不被失败清零（" + failState.grand + "）");
  assert(failState.projTotal === "2", "失败项目保留已知条数（" + failState.projTotal + "）");
  await evaluate(`(() => {
    const btn = document.querySelector('#tcList [data-tc-group-retry="p3"]');
    const sec = btn && btn.closest(".tc-group");
    if(sec) sec.scrollIntoView({ block: "center" });
    return true;
  })()`);
  await sleep(400);
  await shot("06-project-error-1440.png");
  await evaluate(`(window.__mockFail = "", true)`);
  await click('#tcList [data-tc-group-retry="p3"]');
  await waitFor(`!document.querySelector('#tcList [data-tc-group-retry="p3"]')`, "重试后恢复");
  await waitFor(`document.querySelectorAll("#tcList .tc-row").length === 11`, "重试后用例补齐", 15000);

  group("深色");
  /* 深色截图拍概览首屏：先把刚才为看失败段滚下去的列表回到顶部 */
  await evaluate(`(() => {
    const v = document.getElementById("view-testcases");
    if(v) v.scrollTop = 0;
    window.scrollTo(0, 0);
    return true;
  })()`);
  await sleep(300);
  await click("#btnTheme");
  await sleep(600);
  await shot("05-overview-dark-1440.png");
  await click("#btnTheme");
  await sleep(400);

  group("控制台");
  const errors = cdp.errors.filter(e => !/favicon|EventSource|net::ERR/i.test(e));
  assert(errors.length === 0, "无页面脚本错误" + (errors.length ? "：" + errors.join(" | ") : ""));

  console.log("\n结果：" + passed + " 通过，" + failed + " 失败");
  console.log("截图目录：" + SHOT_DIR);
}catch(e){
  console.error("\nERROR " + e.message);
  if(cdp && cdp.errors.length) console.error("页面错误：" + cdp.errors.join(" | "));
  failed++;
}finally{
  try{ proc.kill(); }catch(e){}
  if(staticServer){ try{ staticServer.close(); }catch(e){} }
  await sleep(300);
  process.exit(failed ? 1 : 0);
}
