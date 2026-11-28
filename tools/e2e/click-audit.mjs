/* 全站逐控件点击审计（只点击、不保存：弹层点开即关，确认框一律取消）。
   覆盖：全局顶栏/侧栏/子导航 + 全部视图的按钮、链接、页签、开关、下拉、搜索、行链接。
   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=123456 \
       node tools/e2e/click-audit.mjs [outdir]
   产物：<outdir>/click-audit.json + click-audit.log（默认 tools/e2e/shots/click-audit）*/
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve(process.argv[2] || "tools/e2e/shots/click-audit");
const ONLY = (process.env.STEPS || "").split(",").map(s => s.trim()).filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, "click-audit.log");
const log = line => { console.log(line); fs.appendFileSync(logFile, line + "\n"); };

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method){ this.events.push(msg); }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  take(){ const e = this.events; this.events = []; return e; }
}
async function connect(port){
  const deadline = Date.now() + 15000;
  let version;
  while(Date.now() < deadline){
    try{ const res = await fetch(`http://127.0.0.1:${port}/json/version`); if(res.ok){ version = await res.json(); break; } }
    catch(e){ /* 等 Chrome */ }
    await sleep(200);
  }
  if(!version) throw new Error("Chrome DevTools 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once:true }); ws.addEventListener("error", rej, { once:true }); });
  return new Cdp(ws);
}

/* ---------------- 视图步骤：路由 + 可选先点子页签 ---------------- */
const VIEW_STEPS = [
  /* 管理员默认落在「团队」，先切到「分派给我」才能测列表/看板与我的任务操作 */
  { k:"mine", hash:"#/mine", view:"mine", pre:'#mineMode [data-mine-mode="mine"], #view-mine [data-mine-mode="mine"]' },
  { k:"review", hash:"#/review", view:"review" },
  { k:"demands", hash:"#/demands", view:"demands" },
  { k:"projects", hash:"#/projects", view:"projects" },
  { k:"portfolio", hash:"#/portfolio", view:"portfolio", settle:1800 },
  { k:"phase", hash:"#/phase", view:"phase", settle:1600 },
  { k:"branches", hash:"#/branches", view:"branches" },
  { k:"delivery", hash:"#/delivery", view:"delivery" },
  { k:"board", hash:"#/board", view:"board" },
  { k:"list", hash:"#/list", view:"list" },
  { k:"tree", hash:"#/tree", view:"tree" },
  { k:"chain", hash:"#/chain", view:"chain" },
  { k:"calendar", hash:"#/calendar", view:"calendar" },
  { k:"gantt", hash:"#/gantt", view:"gantt" },
  { k:"workcolumn", hash:"#/workcolumn?col=doing", view:"workcolumn" },
  { k:"canceled", hash:"#/canceled", view:"canceled" },
  { k:"docs", hash:"#/requirements", view:"requirements" },
  { k:"testcases-cases", hash:"#/testcases", view:"testcases" },
  { k:"testcases-defects", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="defects"]', settle:1000 },
  { k:"testcases-plans", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="plans"]', settle:1000 },
  { k:"testcases-coverage", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="coverage"]', settle:1000 },
  { k:"testcases-report", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="report"]', settle:1200 },
  { k:"analysis", hash:"#/analysis", view:"analysis" },
  { k:"analysis-completions", hash:"#/analysis", view:"analysis", pre:'#subNav [data-sub-tab="completions"]', settle:1200 },
  { k:"analysis-flow", hash:"#/analysis", view:"analysis", pre:'#subNav [data-sub-tab="flow"]', settle:1000 },
  { k:"report", hash:"#/report", view:"report" },
  { k:"investment", hash:"#/investment", view:"investment" },
  { k:"workload", hash:"#/workload", view:"workload" },
  { k:"risks", hash:"#/risks", view:"risks" },
  { k:"messages", hash:"#/messages", view:"messages" },
  { k:"settings-space", hash:"#/settings", view:"settings" },
  { k:"settings-members", hash:"#/settings", view:"settings", pre:'[data-set-tab="members"]', settle:1300 },
  { k:"settings-visibility", hash:"#/settings", view:"settings", pre:'[data-set-tab="visibility"]', settle:1200 },
  { k:"settings-workflow", hash:"#/settings", view:"settings", pre:'[data-set-tab="workflow"]', settle:1200 },
  { k:"settings-integration", hash:"#/settings", view:"settings", pre:'[data-set-tab="integration"]', settle:1200 },
  { k:"settings-data", hash:"#/settings", view:"settings", pre:'[data-set-tab="data"]', settle:1200 },
  { k:"settings-platform", hash:"#/settings", view:"settings", pre:'[data-set-tab="platform"]', settle:1200 },
  { k:"profile", hash:"#/profile", view:"profile" }
];

/* ---------------- 控件采集 ---------------- */
const COLLECT = `(() => {
  const root = document.getElementById("view-" + document.body.dataset.view);
  if(!root) return { els:[], title:"" };
  const sel = "button, a[href], summary, [role=button], [role=tab], select, input:not([type=hidden]), [data-cal-date], [data-cal-more]";
  const vis = el => {
    const r = el.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05
      && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 1.15;
  };
  const cssPath = el => {
    if(el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + el.id;
    const parts = [];
    let n = el;
    while(n && n.nodeType === 1 && n !== root && parts.length < 7){
      let s = n.tagName.toLowerCase();
      if(n.className && typeof n.className === "string"){
        /* 选中态类名会随点击变化，写进选择器会让下一次定位失配 */
        const c = n.className.trim().split(/\\s+/).filter(x => x && !/^(on|active|is-active|is-on|sel|current|open)$/.test(x)).slice(0,2).join(".");
        if(c) s += "." + c.replace(/\\./g, "\\\\.");
      }
      const p = n.parentElement;
      if(p){ const idx = Array.from(p.children).indexOf(n); s += ":nth-child(" + (idx + 1) + ")"; }
      parts.unshift(s);
      n = p;
    }
    return "#" + CSS.escape(root.id) + ">" + parts.join(">");
  };
  const pickSel = el => {
    for(const k of Object.keys(el.dataset || {})){
      const v = el.dataset[k];
      if(v && v.length < 60 && /^[A-Za-z0-9_-]+$/.test(v)){
        const q = "#" + CSS.escape(root.id) + " [data-" + k.replace(/[A-Z]/g, m => "-" + m.toLowerCase()) + "='" + v + "']";
        /* 只有唯一命中才用 data 选择器：消息页左栏与类型 chip 共用 data-msg-type，
           否则第二个控件会点到第一个上 */
        if(document.querySelectorAll(q).length === 1) return q;
      }
    }
    return cssPath(el);
  };
  return {
    title: (document.getElementById("viewTitle") || {}).textContent || "",
    els: Array.from(root.querySelectorAll(sel)).filter(vis).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      text: (el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 60),
      id: el.id || "",
      cls: (typeof el.className === "string" ? el.className : "").trim().slice(0, 80),
      data: Object.assign({}, el.dataset),
      href: el.getAttribute("href") || "",
      sel: pickSel(el),
      checked: el.checked === true
    }))
  };
})()`;

/* ---------------- 分类 ---------------- */
const DANGER_DATA = new Set([
  "setDel", "btnWsLeave", "btnLogout", "mineDone", "nudgeAll", "riskNudgeAll",
  "demPass", "btnWsSave", "btnNotifySave", "btnNotifyTest", "meNameSave",
  "meTimerSave", "btnAiReport", "invAi", "btnAiCaseGenerate",
  "memberRole", "setRemove", "memberRemove",
  /* 通知与集成：保存 SMTP / 发测试邮件都是立即写服务端 */
  "mailSave", "mailTest",
  /* 工作流：列排序与流转矩阵单元格点一下就会落库 */
  "colUp", "colDown", "wscatUp", "wscatDown", "transFrom", "transTo",
  /* 只有填了名称才会写，但本批不键入表单，统一按写操作跳过 */
  "btnColAdd", "btnWsCatAdd",
  /* 看板列的「处理规则」下拉一改就保存整行（PUT /api/columns/:id） */
  "colRule",
  /* 需求池「重新打开」会直接 POST 改状态；可见范围下拉一改就 PUT 项目授权 */
  "demReopen", "accessUser"
]);
const DANGER_TEXT = /(删除|移除|解散|退出空间|退出登录|注销|禁用|停用|作废|撤销|清零|重置|移交|转交|催办|标记完成|开始测试|重新执行|通过$|通过\b|生成周报|AI 总结|保存并|保存设置|保存计时|保存基本信息|保存推送|测试推送|邀请成员|关闭项目|结束项目|确认删除|迁出|标为已读)/;
const SAFE_FIRST = /^(显示已归档|更多筛选|筛选|清除筛选|清空筛选|重置筛选|全部|刷新|导出|复制|全屏|撤销|今天|上月|下月|本周|上周|近30天|本月)/;
const DOWNLOAD_TEXT = /(导出|CSV|PNG|下载)/;
const MENU_TEXT = /^(更多|更多操作|⋯|\.\.\.|显示|按项目分组|视图列表|口径|模板|成员 ▾|导出报告 ▾)/;
const NAVISH_KEYS = new Set(["demMode","projectMode","pfMode","pmode","brMode","rdmode","rdscope","mineMode","mineView","wcLayout","listDensity","wlcLayout","pfSet","demPreset","listPreset","demGroup","demSort","listGroup","listSort","treeLevel1","treeLevel2","treeLevel3","invMode","invDim","invMetric","loadMode","wlPeriod","memberStatus","brOutcome","msgFilter","msgType","msgDue","setTab","setNav","subTab","wscope","statHours","wcDim","wcFilter","wcSort","filter","dir","colRange","riskScope","ganttRange","ganttZoom","ganttScale","ganttDensity","tcGroupBy","demFilter","actType","brMeta"]);
const OPEN_KEYS = new Set(["demDetail","cardMenu","calId","calDate","ganttOpen","branch","openProject","memberOpen","riskOpen","chainOpen","apn","rsDoc","tcRuns","reqCockpit","colOpen","colAdd","colMenu","reqOpen","reqBoard","projectMore","setToggle","setEdit","setRisk","tcMenu","brStatusMenu","brFilter","demMenuBtn","demPlan","btnDemandNew","btnReleasePlan","btnVerNew","recentPlanNew","btnProjectSetNew","btnReqNew","btnPfNewProject","branchNew","reqDocNew","rrdNew","btnCaseNew","tcPanelBtn","tcViewsBtn","branchViewsBtn","ganttViewsBtn","ganttFilterBtn","ganttAnalysisBtn","demFilter","demSave","listSave","btnDemandColumns","btnProjectColumns","btnListColumns","btnMineFields","btnMineFold","msgPrefs","reqDocTplBtn","rdViewsBtn","btnCopy","btnHelp","btnAlert","btnGlobalSearch","wsSwitch","aiFab","phaseHelp","drillScope","statProject","statOwner","kpi","projectDrill","colAdd","calShowDone","mineCell","mineToggle","viewFullscreen","caliberHelp","ganttUnplannedToggle","wcMore","recentPlan","ganttNew","ganttRefresh","ganttUndo","deliveryOpen","actOpen"]);

function signature(e){
  const d = e.data || {};
  const keys = Object.keys(d).filter(k => !/^(_|lpignore|1pIgnore|bwignore|formType|dsAutofill)/.test(k));
  const navKey = keys.find(k => NAVISH_KEYS.has(k));
  const openKey = keys.find(k => OPEN_KEYS.has(k) || SWITCH_KEYS.has(k) || ACTION_KEYS.has(k) || DANGER_DATA.has(k));
  if(!navKey && openKey) return e.tag + "|" + openKey + "|" + e.cls.split(/\s+/)[0];
  let s = e.tag + "|" + keys.slice(0,2).join(",") + "|" + (e.cls.split(/\s+/)[0] || "") + "|" + e.text.replace(/[0-9]+/g, "#").slice(0, 26);
  if(navKey) s += "=" + d[navKey];
  return s;
}

const SWITCH_KEYS = new Set(["btnShowArchived","listHideDone","btnTreeHideDone","tblReset","reportClear","invClear","workloadClear","wcBack","cnBack","btnChainPick","btnChainHelp","btnTreeToggleAll","treeToggleAll","btnMineFold","wcLayout","listDensity"]);
const ACTION_KEYS = new Set(["btnMineRefresh","wcRefresh","ganttRefresh","ganttUndo","btnCopy","viewFullscreen","ganttRange","ganttAnalysisBtn","tcSortDir","btnCaseColumns","calToday","ganttToday","demgToday","calMore","wcRule"]);

function categorize(e){
  const d = e.data || {};
  const keys = Object.keys(d).filter(k => !/^(_|lpignore|1pIgnore|bwignore|formType|dsAutofill)/.test(k));
  const firstKey = keys[0] || "";
  const text = e.text || "";
  if(/^[0-9a-f]{8,}$/i.test(e.id)) return { cat:"skip", why:"技术性控件" };
  /* 先认写操作，避免被“打开类”兜底点掉；id 与 data-* 都要看 */
  for(const k of keys){ if(DANGER_DATA.has(k)) return { cat:"danger", why:"写操作 data-" + k }; }
  if(DANGER_DATA.has(e.id)) return { cat:"danger", why:"写操作 #" + e.id };
  /* 表单控件优先于模式/筛选键：带 data-wc-filter 的 select 要按下拉验证，而不是当页签 */
  if(e.tag === "select") return { cat:"select", why:"下拉" };
  if(e.tag === "input"){
    if(e.type === "checkbox" || e.type === "radio") return { cat:"checkbox", why:"开关" };
    if(e.type === "search" || /搜索|检索/.test(text)) return { cat:"input", why:"检索" };
    return { cat:"skip", why:"表单输入（不在本批键入）" };
  }
  /* 页签/模式/筛选类先判，避免“已通过”“显示已归档”等被误当成写操作 */
  const navKey = keys.find(k => NAVISH_KEYS.has(k));
  if(keys.includes("wcSort")) return { cat:"sort", why:"排序 data-wc-sort" };
  if(navKey && !OPEN_KEYS.has(navKey)) return { cat:"switch", why:"切换 data-" + navKey };
  /* 已知的行/卡/单元格先按打开处理：它们的文案里可能带“注销/删除”等字样，不能当写操作 */
  const openKey = keys.find(k => OPEN_KEYS.has(k));
  if(openKey && openKey !== "ganttBar") return { cat:"open", why:"打开 data-" + openKey };
  /* 写操作文案（删除、保存、通过…）；只对短标签生效，长行文案按内容判断 */
  if(text.length <= 16 && DANGER_TEXT.test(text) && !SAFE_FIRST.test(text)) return { cat:"danger", why:"写操作：" + text.slice(0, 24) };
  if(openKey) return { cat:"open", why:"打开 data-" + openKey };
  if(/^拖动/.test(text)) return { cat:"skip", why:"拖拽排序（非点击验证）" };
  if(keys.includes("ganttBar")) return { cat:"skip", why:"甘特条（拖拽/选择，非点击）" };
  if(keys.includes("calMore") || /cal-more/.test(e.cls)) return { cat:"action", why:"展开当天全部（选中日期）" };
  if(keys.includes("wcRule")) return { cat:"action", why:"列规则说明（悬停提示）" };
  if(keys.includes("actType")) return { cat:"switch", why:"筛选动态类型" };
  if(e.tag === "a" && e.href && e.href.indexOf("#") === 0 && e.href.length > 1) return { cat:"action", why:"页内锚点" };
  if(DOWNLOAD_TEXT.test(text)) return { cat:"download", why:"导出" };
  if(firstKey === "rowCheck" || firstKey === "listSelectAll" || firstKey === "tcBulkAll" || firstKey === "listSelectAll") return { cat:"checkbox", why:"选择" };
  if(ACTION_KEYS.has(firstKey) || ACTION_KEYS.has(e.id)) return { cat:"action", why:"动作 " + firstKey };
  if(SWITCH_KEYS.has(firstKey) || SWITCH_KEYS.has(e.id)) return { cat:"switch", why:"切换 data-" + firstKey };
  if(OPEN_KEYS.has(firstKey) || OPEN_KEYS.has(e.id)) return { cat:"open", why:"打开 " + (firstKey || e.id) };
  if(e.tag === "summary") return { cat:"open", why:"展开" };
  if(keys.includes("sortCol") || keys.includes("projectSort")) return { cat:"sort", why:"排序" };
  if(/^排序/.test(text) || /^按(?!期)/.test(text)) return { cat:"sort", why:"排序" };
  if(e.tag === "a" && e.href) return { cat:"switch", why:"链接" };
  if(e.tag === "button" || keys.length) return { cat:"open", why:"默认按打开类验证" };
  return { cat:"skip", why:"未识别" };
}

/* ---------------- 主流程 ---------------- */
async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-click-"));
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,1000", "about:blank"], { stdio:"ignore" });
  let cdp, sid, failures = [], results = [], step = null;
  const writes = [], reqs = [];
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }catch(e){ await sleep(100); }
    }
    cdp = await connect(port);
    const t = await cdp.send("Target.createTarget", { url: "about:blank" });
    sid = (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
    for(const d of ["Page", "Runtime", "Log", "Network"]) { try{ await cdp.send(d + ".enable", {}, sid); }catch(e){ /* 部分域可能失败 */ } }
    try{ await cdp.send("Page.setDownloadBehavior", { behavior:"deny" }, sid); }catch(e){ /* 忽略 */ }
    cdp.ws.addEventListener("message", ev => {
      try{
        const m = JSON.parse(ev.data);
        if(m.method === "Page.javascriptDialogOpening"){
          cdp.send("Page.handleJavaScriptDialog", { accept:false }, sid).catch(() => {});
        }
        /* 写请求哨兵：任何非 GET 的 /api 调用都记下来，用来发现被误点的自动保存控件 */
        if(m.method === "Network.requestWillBeSent"){
          const rq = m.params.request || {};
          if(rq.url && String(rq.url).indexOf("/api/") >= 0){
            const line = rq.method + " " + String(rq.url).replace(BASE, "");
            reqs.push(line);
            if(rq.method && rq.method !== "GET") writes.push(line);
          }
        }
      }catch(e){ /* 忽略 */ }
    });
    const call = (m, p) => cdp.send(m, p, sid);
    const ev = async expr => {
      const r = await call("Runtime.evaluate", { expression: expr, awaitPromise:true, returnByValue:true, userGesture:true });
      if(r.exceptionDetails){
        const d = r.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return r.result ? r.result.value : undefined;
    };
    const waitFor = async (expr, label, timeout = 15000) => {
      const end = Date.now() + timeout; let last;
      while(Date.now() < end){
        try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error("等待超时：" + label + "（" + JSON.stringify(last) + "）");
    };
    const keyEscape = async () => {
      await call("Input.dispatchKeyEvent", { type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
      await call("Input.dispatchKeyEvent", { type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
    };
    const probs = () => cdp.take().flatMap(e => {
      if(e.method === "Runtime.exceptionThrown"){
        const d = e.params.exceptionDetails;
        return [{ kind:"exception", msg:(d.exception && d.exception.description || d.text || "").split("\n")[0] }];
      }
      if(e.method === "Log.entryAdded" && e.params.entry.level === "error") return [{ kind:"console", msg:e.params.entry.text }];
      if(e.method === "Network.responseReceived" && e.params.response.status >= 400)
        return [{ kind:"http", msg:e.params.response.status + " " + (e.params.response.url || "").replace(BASE, "") }];
      return [];
    });
    const overlayState = () => ev(`(() => {
      const vis = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 2 && r.height > 2; };
      const modals = Array.from(document.querySelectorAll(".modal-layer.open, .drawer-layer.on")).filter(vis);
      const menus = Array.from(document.querySelectorAll(".menu:not([hidden]), [role=menu]:not([hidden]), .pop:not([hidden]), .dropdown.open, .ws-menu:not([hidden]), #aiPanel:not([hidden])")).filter(vis);
      const details = Array.from(document.querySelectorAll("details[open]")).filter(vis);
      const full = !!document.body.classList.contains("fs-view");
      const toasts = Array.from(document.querySelectorAll(".toast")).map(t => (t.innerText || "").trim()).filter(Boolean);
      return { modals: modals.map(m => m.id || m.className), modalCount: modals.length, menuCount: menus.length,
        detailCount: details.length, fullscreen: full, toasts: toasts.join(" || "), hash: location.hash, view: document.body.dataset.view };
    })()`);
    const viewSig = () => ev(`(() => {
      const root = document.getElementById("view-" + document.body.dataset.view);
      if(!root) return "";
      const rows = root.querySelectorAll("tr, .card, .br-card, .apn, .cal-day, .risk-row, .dem-row, .rs-node, .tc-row, .tc-dir-node, .tc-set-item").length;
      const ids = Array.from(root.querySelectorAll("[data-list-id],[data-row-check],[data-id]")).slice(0, 50)
        .map(x => x.getAttribute("data-list-id") || x.getAttribute("data-row-check") || x.getAttribute("data-id")).join(",");
      const txt = (root.innerText || "").replace(/\\s+/g, " ");
      return rows + "|" + txt.length + "|" + ids.slice(0, 300) + "|" + txt.slice(0, 160) + "|" + location.hash;
    })()`);
    const closeOverlays = async () => {
      for(let i = 0; i < 5; i++){
        const st = await overlayState();
        if(!st.modalCount && !st.menuCount && !st.detailCount) break;
        await keyEscape();
        await sleep(220);
      }
      const st = await overlayState();
      if(st.modalCount){
        /* 兜底：关闭最上层弹窗（不触碰表单内容） */
        await ev(`import("./js/core/ui.js").then(m => { try{ m.UI.closeTopModal(); }catch(e){} return true; })`);
        await sleep(150);
      }
      await ev(`document.querySelectorAll("details[open]").forEach(d => d.open = false); true`);
      /* 全屏是视图状态而不是浮层：没有浮层时 Esc 才会退出，单独补一次 */
      const fs = await ev(`document.body.classList.contains("fs-view")`);
      if(fs){ await keyEscape(); await sleep(200); }
    };

    /* 登录 */
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
    /* 慢链路下页面解析完、登录脚本还没绑定 submit，直接点会退化成原生表单提交 */
    await waitFor("document.readyState === 'complete'", "登录页加载", 20000);
    await ev(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles:true })); };
      set("uName", ${JSON.stringify(USER)}); set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    await waitFor(`location.pathname.indexOf("/login") === -1 && !!document.body.dataset.view`, "登录", 25000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "初始化", 25000);
    log("登录 " + USER + " @ " + BASE);
    await probs();

    /* 固定到演示空间 SXk01：上一个会话可能把「最近空间」留在临时回归空间 */
    const curWs = await ev(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id)`);
    if(curWs !== "SXk01"){
      const opened = await ev(`(() => { const b = document.querySelector("#wsSwitch"); if(!b) return false; b.click(); return true; })()`);
      await sleep(400);
      const picked = await ev(`(() => { const b = document.querySelector('[data-ws="SXk01"]'); if(!b) return false; b.click(); return true; })()`);
      await sleep(500);
      const confirmed = await ev(`(() => { const b = document.getElementById("dlgConfirmOk"); if(!b) return false; b.click(); return true; })()`);
      await sleep(700);
      if(opened && picked && confirmed){
        await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === "SXk01" && rt.reqsLoaded)`, "切换到演示空间", 35000);
        await sleep(900);
        log("  已从 " + curWs + " 切换到演示空间 SXk01");
      }else{
        log("  警告：未能切换空间（opened=" + opened + " picked=" + picked + " confirmed=" + confirmed + "），当前 " + curWs);
      }
    }

    let currentHash = "";

    const record = (r) => {
      results.push(r);
      if(r.status === "fail") failures.push(r);
    };
    const testEl = async (e, cat, why) => {
      if(ONLY.length && step && !ONLY.includes(step.k)) return;
      const rec = { view:step.k, text:e.text.slice(0, 48), cat, why, sel:e.sel, status:"ok", note:"" };
      const before = await overlayState();
      const sigBefore = await viewSig();
      const w0 = writes.length, r0 = reqs.length;
      const clsToken = (e.cls || "").split(/\s+/)[0] || "";
      const activeExpr = `(() => {
        const isOn = el => { if(!el) return false; const c = typeof el.className === "string" ? el.className : "";
          return /(^|\\s)(on|active|is-active|is-on|sel|current)(\\s|$)/.test(c) || el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true"; };
        let el = document.querySelector(${JSON.stringify(e.sel)});
        if(el && document.contains(el)) return isOn(el) ? "1" : "";
        /* 控件被重渲染换掉了：按同文案 + 同类名重新找 */
        const root = document.getElementById("view-" + document.body.dataset.view);
        if(!root) return "";
        const t = ${JSON.stringify((e.text || "").replace(/\s+/g, " ").trim().slice(0, 14))};
        const cls = ${JSON.stringify(clsToken)};
        const cands = Array.from(root.querySelectorAll("button,a,[role=button],[role=tab]")).filter(x => {
          const xt = (x.innerText || "").replace(/\s+/g, " ").trim();
          return t && xt.startsWith(t) && (!cls || x.classList.contains(cls));
        });
        return cands.some(isOn) ? "1" : "";
      })()`;
      const sortExpr = `(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "";
        const th = el.closest("th") || el;
        return (th.getAttribute("aria-sort") || "") + "|" + (el.className || "") + "|" + (el.getAttribute("aria-pressed") || "") + "|" + ((el.innerText || "").trim()); })()`;
      const focusExpr = `(() => { const a = document.activeElement; if(!a) return "";
        return a.tagName + "|" + (a.id || "") + "|" + (typeof a.className === "string" ? a.className : ""); })()`;
      const focusBefore = await ev(focusExpr).catch(() => "");
      const activeBefore = await ev(activeExpr).catch(() => "");
      /* 行内编辑（如重命名分类）不会弹层，只会把行换成一个输入框：按可见输入框数量判断 */
      const visInputsExpr = `(() => { const root = document.getElementById("view-" + document.body.dataset.view); if(!root) return 0;
        return Array.from(root.querySelectorAll("input:not([type=hidden]),textarea")).filter(x => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2; }).length; })()`;
      const inputsBefore = cat === "open" ? await ev(visInputsExpr).catch(() => 0) : 0;
      const ownTextBefore = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); return el ? ((el.innerText || el.textContent || "").trim().slice(0, 80)) : ""; })()`).catch(() => "");
      /* 折叠/展开类控件常只改自身 aria-expanded，不改行内容（如版本页「已发布」分组头） */
      const ariaExpr = `(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "";
        const own = el.getAttribute("aria-expanded"); if(own !== null) return own;
        const inner = el.querySelector("[aria-expanded]"); return inner ? (inner.getAttribute("aria-expanded") || "") : ""; })()`;
      const ariaBefore = cat === "open" ? await ev(ariaExpr).catch(() => "") : "";
      const sortBefore = cat === "sort" ? await ev(sortExpr).catch(() => "") : "";
      try{
        /* 上一个「重命名分类」会在行内留一个输入框：先取消，避免下一次点击被 guard 挡掉 */
        if(e.sel.indexOf("data-cat-rename") >= 0){
          await ev(`(() => { const inp = document.querySelector(".rr-rename-input,.rs-rename-input");
            if(inp) inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            return true; })()`).catch(() => {});
          await sleep(140);
        }
        let clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
          if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
          el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`);
        if(clicked === "missing"){
          /* 视图数据还在加载时控件可能尚未渲染：先给一点时间等它出现 */
          const clickExpr = `(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
            if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
            el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`;
          for(let i = 0; i < 8; i++){
            await sleep(320);
            clicked = await ev(clickExpr).catch(() => "missing");
            if(clicked !== "missing") break;
          }
          if(clicked === "missing"){
          /* 残留全屏会把整页替换掉：先退出再找目标 */
          if(await ev(`document.body.classList.contains("fs-view")`).catch(() => false)){
            await keyEscape();
            await sleep(400);
            clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
              if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
              el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`).catch(() => "missing");
          }
          /* 项目页：点分组头的「收起」会把整组行从 DOM 移除——先展开所有已折叠的项目集，后续行控件才能继续测 */
          const expandSets = () => ev(`(() => { const r = document.getElementById("view-projects"); if(!r) return 0;
            let n = 0; r.querySelectorAll("[data-set-toggle][aria-expanded='false']").forEach(b => { b.click(); n++; }); return n; })()`).catch(() => 0);
          const needSets = /#view-projects/.test(e.sel || "") && !/data-set-toggle|data-set-edit|data-set-del/.test(e.sel || "");
          if(needSets){
            /* 「我负责」等范围筛选会把其它项目从列表移除：先切回「全部」再展开分组 */
            const backScope = await ev(`(() => { const r = document.getElementById("view-projects"); if(!r) return false;
              const a = r.querySelector("[data-proj-scope='all']");
              if(a && !/(^|\\s)(on|active|sel|current)(\\s|$)/.test(a.className || "")){ a.click(); return true; } return false; })()`).catch(() => false);
            if(backScope) await sleep(600);
            await expandSets();
            await sleep(400);
            clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
              const r = el.getBoundingClientRect(); return (r.width > 2 && r.height > 2) ? "ok" : "missing"; })()`).catch(() => "missing");
            if(clicked === "ok"){
              clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
                if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
                el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`);
            }
            if(clicked === "missing"){
              /* 前面点过分组头收起/展开，行结构可能整体重绘：重载视图恢复默认后重定位 */
              await ev(`location.reload()`).catch(() => {});
              await waitFor(`document.body.dataset.view === "projects"`, "重载 projects", 20000).catch(() => {});
              await sleep(1200);
              clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
                if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
                el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`).catch(() => "missing");
            }
          }
          if(clicked === "missing"){
          /* 用例总览的左树：点分组/项目会把下一层折叠，子项随之消失——反复展开被折叠的节点，直到目标重新出现 */
          const expandTree = () => ev(`(() => { const r = document.getElementById("view-testcases"); if(!r) return 0; let n = 0;
            r.querySelectorAll("[data-tc-all-setgrp-toggle][aria-expanded='false'],[data-tc-all-toggle][aria-expanded='false']")
              .forEach(b => { b.click(); n++; });
            return n; })()`).catch(() => 0);
          await expandTree();
          for(let i = 0; i < 6; i++){
            await sleep(i === 0 ? 900 : 500);
            const back = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)});
              if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; })()`).catch(() => false);
            if(back) break;
            await expandTree();
          }
          /* 前面动作可能引起重渲染：先按 data 键值，再按同文案重新定位；折叠词（展开/收起）视作同一控件 */
          const dk = Object.keys(e.data || {}).find(k => /^[A-Za-z0-9_-]+$/.test(e.data[k] || ""));
          const kebab = dk ? dk.replace(/[A-Z]/g, m => "-" + m.toLowerCase()) : "";
          clicked = await ev(`(() => {
            const root = document.getElementById("view-" + document.body.dataset.view);
            if(!root) return "missing";
            const vis = x => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(x).visibility !== "hidden"; };
            let el = ${dk ? `root.querySelector("[data-${kebab}='" + CSS.escape(${JSON.stringify(e.data[dk])}) + "']")` : "null"};
            if(!el || !vis(el)){
              const norm = x => String(x || "").replace(/\\s+/g, " ").replace(/^(展开|收起)\\s*/, "").trim();
              const t = norm(${JSON.stringify(e.text || "")});
              const cands = Array.from(root.querySelectorAll("button,a,[role=button],summary,[role=tab]"))
                .filter(x => vis(x) && !x.closest("[disabled]") && !x.classList.contains("lock"));
              el = cands.find(x => norm(x.innerText || x.getAttribute("aria-label")) === t)
                || cands.find(x => { const xt = norm(x.innerText || x.getAttribute("aria-label")); return xt && t && (xt.startsWith(t.slice(0, 10)) || t.startsWith(xt.slice(0, 10))); });
            }
            if(!el) return "missing";
            el.click(); return "ok";
          })()`);
          if(clicked === "missing" && /#view-testcases/.test(e.sel || "")){
            /* 进入项目后的树/行与总览互斥：重载回到总览再定位（已进入项目的行操作会保持缺失并如实记为跳过） */
            await ev(`location.reload()`).catch(() => {});
            await waitFor(`document.body.dataset.view === "testcases"`, "重载 testcases", 20000).catch(() => {});
            await sleep(1300);
            clicked = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); if(!el) return "missing";
              const r = el.getBoundingClientRect(); if(r.width < 2 || r.height < 2) return "missing";
              if(el.closest("[disabled]") || el.getAttribute("aria-disabled") === "true" || el.classList.contains("lock")) return "disabled";
              el.scrollIntoView({block:"center"}); el.click(); return "ok"; })()`).catch(() => "missing");
          }
          }
          /* 前面点击改变过筛选/分组时，目标可能整体换掉：重载回默认态再定位一次 */
          if(clicked === "missing" && !/^#side|^#btn|^#ai/.test(e.sel || "")){
            await ev(`location.reload()`).catch(() => {});
            await waitFor(`document.body.dataset.view === ${JSON.stringify(step.view)}`, "重载 " + step.k, 20000).catch(() => {});
            await sleep(1300);
            /* 子页签步骤重载后会回到默认页签：按步骤 pre 再切回去 */
            if(step.pre){
              await ev(`(() => { const el = document.querySelector(${JSON.stringify(step.pre)}); if(el){ el.click(); return true; } return false; })()`).catch(() => false);
              await sleep(900);
            }
            /* 工时页的周期/成员状态只在「按人」视图渲染：视图偏好可能被前面的点击存成「按周」 */
            if(/data-wl-period|data-member-status|member-roster/.test(e.sel || "")){
              const backPerson = await ev(`(() => { const b = document.querySelector("#view-workload [data-load-mode='person']");
                if(b && !/(^|\\s)(on|active|sel|current)(\\s|$)/.test(b.className || "")){ b.click(); return true; } return false; })()`).catch(() => false);
              if(backPerson) await sleep(700);
            }
            clicked = await ev(clickExpr).catch(() => "missing");
          }
          }
        }
        if(clicked !== "ok"){ rec.status = "skip"; rec.note = clicked === "missing" ? "点击前元素已消失" : "禁用"; record(rec); return; }
        await sleep(240);
        let after = await overlayState();
        const changed = () => after.modalCount > before.modalCount || after.menuCount > before.menuCount || after.detailCount > 0
          || after.hash !== before.hash || after.view !== before.view || after.fullscreen !== before.fullscreen
          || after.toasts !== before.toasts;
        if((cat === "open" || cat === "switch") && !changed()){
          await sleep(500); after = await overlayState();
          if(!changed() && cat === "open"){ await sleep(800); after = await overlayState(); }
        }
        /* 跨视图再开弹窗的入口（如项目集「新建项目」先切到项目页）给足加载时间 */
        if(cat === "open" && !changed() && e.id === "btnPfNewProject"){
          await waitFor(`!!document.querySelector(".modal-layer.open") || document.body.dataset.view === "projects"`, "新建项目弹窗", 7000).catch(() => {});
          await sleep(400);
          after = await overlayState();
        }
        const sigAfter = await viewSig();
        const inputsAfter = cat === "open" ? await ev(visInputsExpr).catch(() => 0) : 0;
        if(process.env.DBG_OPEN && e.sel.indexOf(process.env.DBG_OPEN) >= 0){
          const fi = await ev(focusExpr).catch(() => "");
          const dbgExtra = await ev(`(() => { const root = document.getElementById("view-" + document.body.dataset.view); if(!root) return "no-root";
            const el = document.querySelector(${JSON.stringify(e.sel)});
            return JSON.stringify({ inputs: root.querySelectorAll("input.rr-rename-input,input.rs-rename-input").length,
              tree: !!root.querySelector("#reqDocTree"), split: !!root.querySelector("#reqDocSplitTree"),
              elInDom: !!el && document.contains(el), elVisible: el ? (el.getBoundingClientRect().width > 2) : null,
              elText: el ? (el.innerText || el.textContent || "").trim().slice(0, 40) : "",
              catBtn: (() => { const id = el && el.dataset ? el.dataset.catRename : ""; return id ? !!root.querySelector('#reqDocTree [data-cat="' + id + '"], #reqDocSplitTree [data-rs-cat="' + id + '"]') : null; })(),
              catRenaming: el && el.parentNode ? Array.from(el.parentNode.querySelectorAll("[data-cat-renaming]")).length : null,
              toast: (document.getElementById("toast") || {}).innerText || "",
              msgOn: Array.from(root.querySelectorAll("[data-msg-type].on,[data-msg-type].active,[data-msg-filter].on,.msg-chip.on"))
                .map(x => (x.innerText || "").replace(/\\s+/g, "")).join(","),
              dueHint: !!root.querySelector("[data-msg-due]") }); })()`).catch(err => "dbg-err " + err.message);
          log("  DBG " + e.sel.slice(0,60) + " clicked=" + clicked + " inputs " + inputsBefore + "->" + inputsAfter + " focusBefore=" + focusBefore + " focusAfter=" + fi + " " + dbgExtra);
        }
        const p = probs();
        const newWrites = writes.slice(w0);
        const newReqs = reqs.slice(r0);
        const toastNew = after.toasts !== before.toasts;
        if(p.length){
          rec.status = "fail";
          rec.note = p.slice(0,3).map(x => x.kind + ": " + x.msg).join(" ｜ ");
          failures.push(rec);
        }else if(newWrites.length){
          const benign = newWrites.filter(w => /\/api\/list-preferences\//.test(w));
          if(benign.length && benign.length === newWrites.length){
            rec.note = "已保存视图偏好（非业务数据）";
          }else{
            rec.status = "warn";
            rec.note = "触发写请求：" + newWrites.slice(0, 2).join("，") + "（请复核该控件是否应为危险类）";
          }
        }else if(cat === "open"){
          if(after.modalCount > before.modalCount){
            rec.note = "弹窗 " + after.modals.join(",");
          }else if(after.menuCount > before.menuCount){
            rec.note = "菜单/浮层打开";
          }else if(after.fullscreen !== before.fullscreen){
            rec.note = after.fullscreen ? "进入全屏" : "退出全屏";
          }else if(after.hash !== before.hash || after.view !== before.view || sigAfter !== sigBefore){
            rec.note = "视图变化 " + sigAfter.split("|").slice(0,2).join("/");
          }else if(cat === "open" && (await ev(ariaExpr).catch(() => "")) !== ariaBefore){
            rec.note = "展开/折叠切换（aria-expanded " + (ariaBefore || "无") + " → " + (await ev(ariaExpr).catch(() => "") || "无") + "）";
          }else if((await ev(focusExpr).catch(() => "")) !== focusBefore
            && /^(INPUT|TEXTAREA)/.test(await ev(focusExpr).catch(() => ""))){
            rec.note = "进入行内编辑（输入框已聚焦）";
          }else if(await ev(`!!document.querySelector(".rr-rename-input,.rs-rename-input")`).catch(() => false)){
            rec.note = "进入行内编辑（重命名输入框已出现）";
          }else if(inputsAfter > inputsBefore){
            rec.note = "进入行内编辑（出现输入框）";
          }else if(toastNew){
            rec.note = "提示：" + after.toasts.slice(0, 50);
          }else if(activeBefore || (await ev(activeExpr).catch(() => "")) === "1"){
            rec.note = "原已展开/选中（点击保持）";
          }else if(/^全部项目/.test(e.text)){
            rec.note = "已是全部项目范围（点击无变化）";
          }else if(e.data && Object.prototype.hasOwnProperty.call(e.data, "tcReportPrint")){
            /* PDF 走 iframe 的 window.print()：headless 不弹打印对话框，页面自然无变化 */
            rec.note = "调用浏览器打印（headless 不弹对话框）";
          }else if(e.id === "btnCopyInviteLink"){
            rec.note = "滚动定位到邀请链接生成处（焦点移入按钮，无弹层）";
          }else{
            rec.status = "warn"; rec.note = "点开无弹层 / 无变化";
          }
        }else if(cat === "switch"){
          const activeAfter = await ev(activeExpr).catch(() => "");
          const ownTextAfter = await ev(`(() => { const el = document.querySelector(${JSON.stringify(e.sel)}); return el ? ((el.innerText || el.textContent || "").trim().slice(0, 80)) : ""; })()`).catch(() => "");
          const ok = changed() || sigAfter !== sigBefore || activeAfter !== activeBefore || newReqs.length || ownTextAfter !== ownTextBefore;
          if(ok){
            rec.note = after.menuCount > before.menuCount ? "菜单/浮层打开"
              : (after.modalCount > before.modalCount ? "弹窗 " + after.modals.join(",")
              : (after.fullscreen !== before.fullscreen ? (after.fullscreen ? "进入全屏" : "退出全屏")
              : (sigAfter !== sigBefore ? "切换生效"
              : (ownTextAfter !== ownTextBefore ? "按钮文案变化：" + ownTextAfter.slice(0, 20)
              : "已选中/已请求"))));
          }else if(activeBefore || activeAfter === "1"){
            rec.note = "原已选中（点击保持）";
          }else if(e.data && e.data.msgType){
            /* 消息页左栏与类型 chip 共用一个过滤态：点到同一类型时已选中的那个会亮起 */
            const tl = (e.text || "").replace(/\s+/g, "").slice(0, 4);
            const anyOn = await ev(`(() => { const root = document.getElementById("view-" + document.body.dataset.view);
              if(!root) return "";
              const k = ${JSON.stringify(tl)};
              return Array.from(root.querySelectorAll("[data-msg-type].on,[data-msg-type].active"))
                .map(x => (x.innerText || "").replace(/\\s+/g, "")).filter(t => t.indexOf(k) === 0).join(","); })()`).catch(() => "");
            if(anyOn){ rec.note = "该类型已选中（" + anyOn.slice(0, 16) + "）"; }
            else { rec.status = "warn"; rec.note = "切换后无可见变化"; }
          }else if(e.sel.indexOf("btnMineFold") >= 0){
            rec.note = "分组折叠开关（当前无分组或已全展开，点击无变化）";
          }else if(/^(清除|清空|重置)/.test(e.text) || /^共 .* 条/.test(e.text) || /^全部/.test(e.text)){
            rec.note = "无筛选可清除（预期无变化）";
          }else{
            rec.status = "warn"; rec.note = "切换后无可见变化";
          }
        }else if(cat === "sort"){
          const sortAfter = await ev(sortExpr).catch(() => "");
          const ok = sigAfter !== sigBefore || sortAfter !== sortBefore || newReqs.length;
          /* 列状态工作页的表头只切排序列、不切方向：点已激活的列本就无变化 */
          const wcNoToggle = e.sel.indexOf("data-wc-sort") >= 0 && /lh-sort\s+on/.test(sortBefore);
          const alreadyActive = activeBefore === "1" || /(^|\s)(on|active|sel|current)(\s|$)/.test((sortBefore || "").split("|")[1] || "");
          if(!ok && wcNoToggle){ rec.note = "已是该列排序（表头不切换升/降序）"; }
          else if(!ok && alreadyActive){ rec.note = "已是当前项（点击无变化）"; }
          else if(!ok){ rec.status = "warn"; rec.note = "排序后数据无变化"; }
          else rec.note = sortAfter !== sortBefore ? "排序标记变化" : (sigAfter !== sigBefore ? "排序生效" : "已发起排序请求");
        }else if(cat === "download"){
          rec.note = "导出已点击（下载被拦截）";
        }else if(cat === "action"){
          if(e.id === "calToday"){
            const todayShown = await ev(`!!document.querySelector("#calGrid .cal-day.today")`).catch(() => false);
            rec.note = todayShown ? "已定位今天（今日单元格在月历中）" : "已触发（本月已含今天）";
          }else if(e.id === "ganttToday"){
            const hasToday = await ev(`(() => { const s = document.getElementById("ganttScroll"); return !!s && s.scrollLeft >= 0; })()`).catch(() => false);
            rec.note = hasToday ? "时间轴已回到今天" : "动作已触发";
          }else rec.note = "动作已触发";
        }else{
          rec.note = "已点击";
        }
        if(rec.status === "fail"){ if(!failures.includes(rec)) failures.push(rec); }
        else record(rec);
        /* 复位 */
        if(after.modalCount || after.menuCount || after.detailCount) await closeOverlays();
        /* 全屏是整页替换，不复位后续元素全部失配（先点原按钮切换，Esc 兜底） */
        if(after.fullscreen && !before.fullscreen){
          const exited = await ev(`(() => { const b = Array.from(document.querySelectorAll("[data-view-fullscreen]")).find(x => x.offsetParent !== null)
              || document.querySelector("[data-view-fullscreen]");
            if(b){ b.click(); return true; } return false; })()`).catch(() => false);
          if(!exited){ await keyEscape(); }
          await sleep(350);
          if(await ev(`document.body.classList.contains("fs-view")`).catch(() => false)) await keyEscape();
          await sleep(250);
        }
        /* 工时页「按周」会把成员周期条换成周表：切回「按人」再测后续周期/状态 chip */
        if(e.sel.indexOf("data-load-mode") >= 0 && /按周/.test(e.text || "")){
          await ev(`(() => { const b = document.querySelector("#view-workload [data-load-mode='person']"); if(b){ b.click(); return true; } return false; })()`).catch(() => false);
          await sleep(500);
        }
        if(after.hash !== currentHash || after.view !== (step.view || "")){
          await ev(`location.hash = ${JSON.stringify(currentHash)}`);
          await waitFor(`document.body.dataset.view === ${JSON.stringify(step.view)}`, "回到 " + step.k, 8000).catch(() => {});
          await sleep(250);
        }
      }catch(err){
        rec.status = "fail"; rec.note = err.message.slice(0, 160); failures.push(rec);
        try{ await closeOverlays(); }catch(e){ /* 忽略 */ }
      }
    };

    /* 全局顶栏 / 侧栏 / 助手（每个只点一次） */
    const globalTests = [
      { name:"侧栏 logo", sel:"#sideBrand", cat:"switch", probe:"view:machine" },
      { name:"收起侧栏", sel:"#btnRail", cat:"probe", probe:"rail" },
      { name:"空间切换菜单", sel:"#wsSwitch", cat:"open" },
      { name:"全局搜索", sel:"#btnGlobalSearch", cat:"open" },
      { name:"帮助菜单", sel:"#btnHelp", cat:"open" },
      { name:"深浅色切换", sel:"#btnTheme", cat:"probe", probe:"theme" },
      { name:"通知中心", sel:"#btnAlert", cat:"open" },
      { name:"AI 助手", sel:"#aiFab", cat:"open" },
      { name:"个人设置入口", sel:"#sideUserBtn", cat:"switch" },
      { name:"设置入口", sel:'#sideNav .nav-item[data-view="settings"]', cat:"switch" }
    ];
    log("\n== 全局顶栏 / 侧栏 ==");
    for(const g of globalTests){
      const rec = { view:"global", text:g.name, cat:g.cat, why:"全局", sel:g.sel, status:"ok", note:"" };
      const before = await overlayState();
      try{
        if(g.probe === "theme"){
          const t0 = await ev(`document.documentElement.getAttribute("data-theme") || "light"`);
          await ev(`document.querySelector("#btnTheme").click()`); await sleep(350);
          const t1 = await ev(`document.documentElement.getAttribute("data-theme") || "light"`);
          if(t0 === t1){ rec.status = "fail"; rec.note = "主题未切换"; }
          else rec.note = t0 + " → " + t1 + "（已还原）";
          await ev(`document.querySelector("#btnTheme").click()`); await sleep(250);
          const p = probs();
          if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
          if(rec.status === "fail") failures.push(rec); else record(rec);
          log(`  ${rec.status.toUpperCase().padEnd(4)} ${g.name} — ${rec.note}`);
          continue;
        }
        if(g.probe === "rail"){
          const c0 = await ev(`document.body.classList.contains("side-rail")`);
          await ev(`document.querySelector("#btnRail").click()`); await sleep(350);
          const c1 = await ev(`document.body.classList.contains("side-rail")`);
          if(c0 === c1){ rec.status = "fail"; rec.note = "侧栏未收起/展开"; }
          else rec.note = "侧栏状态切换（已还原）";
          await ev(`document.querySelector("#btnRail").click()`); await sleep(250);
          const p = probs();
          if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
          if(rec.status === "fail") failures.push(rec); else record(rec);
          log(`  ${rec.status.toUpperCase().padEnd(4)} ${g.name} — ${rec.note}`);
          continue;
        }
        const ok = await ev(`(() => { const el = document.querySelector(${JSON.stringify(g.sel)}); if(!el) return false; el.click(); return true; })()`);
        if(!ok){ rec.status = "skip"; rec.note = "元素不存在/不可见"; record(rec); continue; }
        await sleep(350);
        let after = await overlayState();
        if(g.cat === "open" && after.modalCount === before.modalCount && after.menuCount === before.menuCount){
          await sleep(500); after = await overlayState();
        }
        const p = probs();
        if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
        else if(g.cat === "open" && after.modalCount === before.modalCount && after.menuCount === before.menuCount){ rec.status = "warn"; rec.note = "未出现菜单/弹层"; }
        else if(g.probe === "view:machine"){ rec.status = after.view === "mine" ? "ok" : "warn"; rec.note = "→ " + after.view; }
        else if(g.cat === "switch" && after.hash === before.hash && after.view === before.view){ rec.status = "warn"; rec.note = "无视图变化"; }
        else rec.note = "已响应";
        if(rec.status === "fail") failures.push(rec); else record(rec);
        log(`  ${rec.status.toUpperCase().padEnd(4)} ${g.name} — ${rec.note}`);
        await closeOverlays();
      }catch(err){
        rec.status = "fail"; rec.note = err.message.slice(0, 140); failures.push(rec); record(rec);
        log("  FAIL " + g.name + " — " + rec.note);
        await closeOverlays().catch(() => {});
      }
    }
    /* 全局搜索的关键字检索：搜索面板是按需加载的，先等输入框，再等防抖 + 请求返回 */
    try{
      await ev(`document.querySelector("#btnGlobalSearch").click()`);
      await waitFor(`!!document.querySelector("#paletteInput")`, "搜索面板", 4000).catch(() => {});
      const typeKw = async kw => {
        await ev(`(() => { const i = document.querySelector("#paletteInput, .palette input"); if(!i) return false;
          i.focus(); const proto = Object.getPrototypeOf(i); Object.getOwnPropertyDescriptor(proto, "value").set.call(i, ${JSON.stringify(kw)});
          i.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
        const end = Date.now() + 5000;
        while(Date.now() < end){
          const st = await ev(`(() => ({ hits: document.querySelectorAll(".palette-item").length,
            empty: (document.querySelector(".palette-empty") || {}).textContent || "" }))()`);
          if(st.hits || /没有找到|搜索失败/.test(st.empty)) return st;
          await sleep(150);
        }
        return { hits: 0, empty: "等待超时" };
      };
      let st = await typeKw("需求");
      if(!st.hits) st = await typeKw("报备");
      const rec = { view:"global", text:"全局搜索：输入关键字", cat:"input", why:"检索", sel:"#btnGlobalSearch",
        status: st.hits ? "ok" : "warn", note: st.hits ? "返回 " + st.hits + " 条/组" : ("未见结果：" + st.empty.slice(0, 40)) };
      record(rec); log(`  ${rec.status.toUpperCase().padEnd(4)} 全局搜索关键字 — ${rec.note}`);
      await closeOverlays();
    }catch(e){ log("  全局搜索关键字检查失败：" + e.message); }

    /* 15 个侧栏入口 */
    log("\n== 侧栏入口 ==");
    const navs = ["mine","messages","review","demands","projects","phase","delivery","branches","workitems","requirements","testcases","insight","workload","risks","settings"];
    for(const entry of navs){
      const rec = { view:"global", text:"侧栏 " + entry, cat:"switch", why:"导航", sel:'#sideNav [data-view="' + entry + '"]', status:"ok", note:"" };
      try{
        const before = await overlayState();
        const ok = await ev(`(() => { const b = document.querySelector('#sideNav [data-view="${entry}"]'); if(!b) return false; b.click(); return true; })()`);
        await sleep(500);
        const after = await overlayState();
        const p = probs();
        if(!ok){ rec.status = "skip"; rec.note = "入口不存在"; }
        else if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
        else if(after.view === before.view && after.hash === before.hash){ rec.status = "warn"; rec.note = "视图未变化"; }
        else rec.note = "→ " + after.view;
      }catch(e){ rec.status = "fail"; rec.note = e.message.slice(0, 120); }
      if(rec.status === "fail") failures.push(rec); else record(rec);
      log(`  ${rec.status.toUpperCase().padEnd(4)} ${entry} — ${rec.note}`);
    }

    /* 逐视图 */
    for(const st of VIEW_STEPS){
      if(ONLY.length && !ONLY.includes(st.k)) continue;
      step = st;
      log("\n== " + st.k + " ==");
      try{
        await closeOverlays();
        await ev(`location.hash = ${JSON.stringify(st.hash)}`);
        currentHash = st.hash;
        await waitFor(`document.body.dataset.view === ${JSON.stringify(st.view)}`, "视图 " + st.k, 15000);
        if(st.pre){
          await ev(`(() => { const b = document.querySelector(${JSON.stringify(st.pre)}); if(b) b.click(); return !!b; })()`);
          await sleep(700);
        }
        await sleep(600);
        if(st.settle) await sleep(st.settle);
        const collected = await ev(COLLECT);
        const wsInfo = await ev(`import("./js/core/state.js").then(({rt}) => (rt.currentWs && rt.currentWs.id) + "/" + ((rt.currentWs && rt.currentWs.name) || ""))`);
        log("  当前空间：" + wsInfo);
        const els = (collected && collected.els) || [];
        /* 分组：同类行控件合并，模式/页签按值分开 */
        const groups = new Map();
        for(const e of els){
          const c = categorize(e);
          if(c.cat === "skip"){ continue; }
          const k = signature(e) + "|" + c.cat;
          if(!groups.has(k)) groups.set(k, { e, cat:c.cat, why:c.why, n:0 });
          groups.get(k).n++;
        }
        /* 执行顺序：打开/行/菜单 → 排序 → 下拉/开关/输入 → 导航/模式（放最后，避免改布局） */
        const order = { open:1, download:2, sort:3, select:4, checkbox:5, input:6, switch:7, danger:9 };
        /* 模式/页签类开关会把当前面板整个换掉，必须放在同视图其它开关之后 */
        const LATE_SWITCH = new Set(["mineMode","demMode","projectMode","pfMode","brMode","rdmode","rdscope","msgFilter","msgDue","setTab","subTab","statHours"]);
        const rank = g => {
          const keys = Object.keys(g.e.data || {});
          /* 「全部用例」概览里的单项目过滤/进入管理会把左树整体换掉，排在本视图最后再点 */
          if(keys.some(k => k === "tcAllEnter" || k === "tcAllProjPick" || k === "tcAllRetry")) return 14;
          if(g.e.id === "tcPanelBtn") return 14;
          const late = g.cat === "switch" && keys.some(k => LATE_SWITCH.has(k));
          return (order[g.cat] || 8) * 10 + (late ? 5 : 0);
        };
        const list = Array.from(groups.values()).sort((a, b) => rank(a) - rank(b));
        log(`  可点元素 ${els.length} 个，归并为 ${list.length} 组`);
        /* 扫描后若发生重渲染，路径里的 nth-child 会失配：按 id / data-* 重新定位下拉与检索框 */
        const elemSel = async (e, tagWanted) => {
          const cands = [];
          if(e.id) cands.push("#" + e.id);
          for(const k of Object.keys(e.data || {})){
            if(!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) continue;
            const kb = k.replace(/[A-Z]/g, m => "-" + m.toLowerCase());
            const v = String(e.data[k] || "");
            cands.push(`#view-${st.view} [data-${kb}${v ? "='" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'" : ""}]`);
          }
          cands.push(e.sel);
          return await ev(`(() => { const cs = ${JSON.stringify(cands)}; for(const c of cs){ let el = null;
            try { el = document.querySelector(c); } catch (err) { continue; }
            if(el${tagWanted ? ` && el.tagName === ${JSON.stringify(tagWanted)}` : ""}) return c; } return ${JSON.stringify(e.sel)}; })()`)
            .catch(() => e.sel);
        };
        for(const g of list){
          if(g.cat === "danger"){
            record({ view:st.k, text:g.e.text.slice(0, 48), cat:"danger", why:g.why, sel:g.e.sel, status:"skip", note:"写操作，未点击（保护演示数据）" });
            continue;
          }
          if(g.cat === "select"){
            /* 下拉：切到下一个可选选项再恢复，验证筛选/分组生效 */
            const rec = { view:st.k, text:g.e.text.slice(0, 40) + " [" + (g.e.id || "select") + "]", cat:"select", why:g.why, sel:g.e.sel, status:"ok", note:"" };
            try{
              let sel = await elemSel(g.e, "SELECT");
              /* 本视图刷新过、目标控件在刷新后的面板里已不存在：重载页面回到该视图再测 */
              if(!(await ev(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => true))){
                await ev(`location.reload()`).catch(() => {});
                await waitFor(`document.body.dataset.view === ${JSON.stringify(st.view)}`, "重载 " + st.k, 20000).catch(() => {});
                await sleep(1500);
                sel = await elemSel(g.e, "SELECT");
              }
              const before = await viewSig();
              const w0 = writes.length;
              const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
                if(!el || !el.options || el.options.length < 2) return "skip";
                let idx = el.selectedIndex;
                for(let i = 1; i <= el.options.length; i++){
                  const j = (idx + i) % el.options.length;
                  if(!el.options[j].disabled && el.options[j].value !== el.value){ idx = j; break; }
                }
                if(el.options[idx].value === el.value) return "same";
                el.dataset.__old = el.value; el.selectedIndex = idx;
                el.dispatchEvent(new Event("change", { bubbles:true })); return el.value; })()`);
              if(r === "skip" || r === "same"){
                if(process.env.DBG_SEL){
                  const dbgSel = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
                    const dk = Object.keys(${JSON.stringify(g.e.data || {})}).find(k => /^[A-Za-z]/.test(k));
                    const kb = dk ? "#view-phase [data-" + dk.replace(/[A-Z]/g, m => "-" + m.toLowerCase()) + "]" : "";
                    return (el ? el.tagName + "/opts=" + (el.options ? el.options.length : "none") : "missing")
                      + " alt=" + (kb ? document.querySelectorAll(kb).length + ":" + ((document.querySelector(kb) || {}).tagName || "-") : "none"); })()`).catch(e => e.message);
                  log("  SEL " + sel + " -> " + r + " " + dbgSel + " view=" + (await ev(`document.body.dataset.view + "/" + !!document.getElementById("view-phase")`).catch(() => "?")));
                }
                rec.status = "skip"; rec.note = r === "same" ? "只有一个可选项" : "选项不足"; record(rec); continue; }
              await sleep(500);
              const after = await viewSig();
              const p = probs();
              const newWrites = writes.slice(w0);
              if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
              else if(newWrites.length){ rec.status = "warn"; rec.note = "触发写请求：" + newWrites.slice(0,2).join("，"); }
              else rec.note = after !== before ? "切换后内容变化" : "切换生效（当前数据无差异）";
              await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
                el.value = el.dataset.__old; el.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
              await sleep(350);
            }catch(e){ rec.status = "fail"; rec.note = e.message.slice(0, 120); }
            if(rec.status === "fail") failures.push(rec); else record(rec);
            continue;
          }
          if(g.cat === "checkbox"){
            const rec = { view:st.k, text:g.e.text.slice(0, 40) || e_tag(g.e), cat:"checkbox", why:g.why, sel:g.e.sel, status:"ok", note:"" };
            try{
              let csel = g.e.sel;
              const countExpr = `(() => { const root = document.getElementById("view-" + document.body.dataset.view) || document; return root.querySelectorAll("input[type=checkbox]:checked").length; })()`;
              let before = await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); return el ? { checked: el.checked, disabled: !!el.disabled } : null; })()`);
              if(!before){
                /* 工具条重绘会让旧的 nth-child 路径失配：重载视图后再找一次 */
                await ev(`location.reload()`).catch(() => {});
                await waitFor(`document.body.dataset.view === ${JSON.stringify(st.view)}`, "重载 " + st.k, 20000).catch(() => {});
                await sleep(1000);
                before = await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); return el ? { checked: el.checked, disabled: !!el.disabled } : null; })()`).catch(() => null);
              }
              if(!before && /label\.vl-check/.test(csel)){
                /* 工具条复选框位置随分组数量变化：按结构回退到同视图工具条里的同类复选框 */
                csel = "#view-phase .vl-toolbar label.vl-check input";
                before = await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); return el ? { checked: el.checked, disabled: !!el.disabled } : null; })()`).catch(() => null);
              }
              if(!before){ rec.status = "skip"; rec.note = "元素不存在"; record(rec); continue; }
              if(before.disabled){ rec.status = "skip"; rec.note = "禁用"; record(rec); continue; }
              const c0 = await ev(countExpr);
              await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); if(el) el.click(); return true; })()`);
              await sleep(350);
              const after = await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); return el ? el.checked : null; })()`);
              const c1 = await ev(countExpr);
              const p = probs();
              if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
              else if(before.checked === after && c0 === c1){ rec.status = "warn"; rec.note = "勾选状态未变化"; }
              else rec.note = "勾选可切换（已还原）";
              /* 还原：先把自己点回去，再把因全选被带上的行取消 */
              await ev(`(() => { const el = document.querySelector(${JSON.stringify(csel)}); if(el && el.checked !== ${before.checked === true}) el.click(); return true; })()`);
              await sleep(200);
              if(c0 !== c1) await ev(`(() => { const root = document.getElementById("view-" + document.body.dataset.view) || document; root.querySelectorAll("input[type=checkbox]:checked").forEach(x => { if(x.dataset.rowCheck || x.hasAttribute("data-row-check")) x.click(); }); return true; })()`);
              await sleep(250);
            }catch(e){ rec.status = "fail"; rec.note = e.message.slice(0, 120); }
            if(rec.status === "fail") failures.push(rec); else record(rec);
            continue;
          }
          if(g.cat === "input"){
            const rec = { view:st.k, text:g.e.text.slice(0, 40) || g.e.id, cat:"input", why:g.why, sel:g.e.sel, status:"ok", note:"" };
            try{
              let sel = await elemSel(g.e, "INPUT");
              if(!(await ev(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => true))){
                await ev(`location.reload()`).catch(() => {});
                await waitFor(`document.body.dataset.view === ${JSON.stringify(st.view)}`, "重载 " + st.k, 20000).catch(() => {});
                await sleep(1500);
                sel = await elemSel(g.e, "INPUT");
              }
              const before = await viewSig();
              /* 检索可能只改左树/侧栏文案而不改行数：兜底对比整页可见文本 */
              const broadExpr2 = `(() => { const r = document.getElementById("view-" + document.body.dataset.view); if(!r) return "";
                return ((r.innerText || "").replace(/\\s+/g, " ")).trim().slice(0, 6000); })()`;
              const broadBefore = await ev(broadExpr2).catch(() => "");
              const ok = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
                const r = el.getBoundingClientRect(); if(r.width < 2 || r.height < 2) return false;
                el.focus(); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "zzzz-无结果-zzzz");
                el.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
              if(!ok){ rec.status = "skip"; rec.note = "元素不存在或不可见"; record(rec); continue; }
              let after = await viewSig();
              for(let k = 0; k < 8 && after === before; k++){ await sleep(300); after = await viewSig(); }
              if(after === before){
                /* 部分检索框只在回车时触发 */
                await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
                  el.focus(); el.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", code:"Enter", keyCode:13, bubbles:true }));
                  el.dispatchEvent(new KeyboardEvent("keyup", { key:"Enter", code:"Enter", keyCode:13, bubbles:true })); return true; })()`);
                await call("Input.dispatchKeyEvent", { type:"keyDown", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });
                await call("Input.dispatchKeyEvent", { type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13 });
                await sleep(1100);
                after = await viewSig();
              }
              const p = probs();
              if(p.length){ rec.status = "fail"; rec.note = p.slice(0,2).map(x => x.kind + ": " + x.msg).join(" ｜ "); }
              else if(after !== before){ rec.note = "输入会过滤/检索"; }
              else {
                const broadAfter = await ev(broadExpr2).catch(() => "");
                const emptyRe = /没有匹配|暂无|没有找到|没有符合|无结果|空空如也/;
                if(broadAfter !== broadBefore) rec.note = "输入会过滤/检索（左树/侧栏文案变化）";
                else if(emptyRe.test(broadBefore) && emptyRe.test(broadAfter)) rec.note = "当前列表为空，过滤前后均无结果（无差异可验证）";
                else { rec.status = "warn"; rec.note = "输入后结果未变化（可能需防抖/回车）"; }
              }
              await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
                const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "");
                el.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
              await sleep(400);
            }catch(e){ rec.status = "fail"; rec.note = e.message.slice(0, 120); }
            if(rec.status === "fail") failures.push(rec);
            else record(rec);
            continue;
          }
          await testEl(g.e, g.cat, g.why);
          /* 保存视图/显示字段等打开的弹层里也可能有输入，点开即关，不改数据 */
          await closeOverlays();
        }
        await closeOverlays();
        const p = probs();
        if(p.length) log("  本视图残余异常：" + p.map(x => x.msg).join(" ｜ ").slice(0, 200));
      }catch(e){
        log("  视图失败：" + e.message.slice(0, 200));
        failures.push({ view:st.k, text:"（整页）", cat:"view", why:"", sel:"", status:"fail", note:e.message.slice(0, 200) });
      }
    }
  }finally{
    const summary = {
      base: BASE, time: new Date().toISOString(),
      total: results.length + failures.length,
      ok: results.filter(r => r.status === "ok").length,
      warn: results.filter(r => r.status === "warn").length,
      skip: results.filter(r => r.status === "skip").length,
      fail: failures.length,
      failures, results
    };
    fs.writeFileSync(path.join(OUT, "click-audit.json"), JSON.stringify(summary, null, 2));
    log("\n结果：ok=" + summary.ok + " warn=" + summary.warn + " skip=" + summary.skip + " fail=" + summary.fail + " 共 " + summary.total);
    for(const f of failures.slice(0, 30)) log("  FAIL [" + f.view + "] " + f.text + " — " + f.note);
    log("报告：" + path.join(OUT, "click-audit.json"));
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    try{ process.kill(-child.pid, "SIGKILL"); }catch(e){ try{ child.kill("SIGKILL"); }catch(e2){} }
    try{ fs.rmSync(profile, { recursive:true, force:true }); }catch(e){ /* 忽略 */ }
  }
}
function e_tag(e){ return e.tag + (e.id ? "#" + e.id : ""); }

main().catch(e => { log("运行失败：" + (e.stack || e.message)); process.exit(1); });
