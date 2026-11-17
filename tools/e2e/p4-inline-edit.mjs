/* P4 关联就地编辑 E2E（仿 tools/e2e/assoc-jumps-p2p3.mjs，Node 18+ 原生 CDP）
   范围：阅读态「关联」页签 需求 / 分支 / 计划版本 / 所属项目 / 依赖 的就地编辑入口。
   覆盖：
     A 结构：五行铅笔（demand/branch/project/version/deps）；dd.ev-assoc 非 role=button；铅笔为原生 button。
     B 分支：搜索过滤 → 选 core → 服务端持久化 → 清除(null) → 复位 ui；候选彩色状态标签 + 目标分支。
     C 需求：rej 需求排除（5 候选）→ 搜索 → 选 review → 持久化 → 查看按钮联动 → 清除 → 复位 PDF；候选状态标签。
     D 版本：锁定行不可改选 → 加选 v3.2 → 版本调整理由必填 → 持久化 → 取消不改 → 移除复位。
     E 跳转保留：点「值」仍穿透（分支抽屉 / 需求详情），且不会误开选择浮层。
     F 键盘：铅笔 Enter 开浮层 → ArrowDown 导航 → Enter 选中保存 → Escape 关闭。
     L 候选标签：版本行彩色状态标签（含锁定行、颜色互不相同）；需求/分支清除项 ⊘ 图标。
     N 深色：状态标签深底亮字、清除项图标与依赖卡随令牌翻转（对照原型深色稿）。
     H 移动端：窄屏底部浮层 as-sheet + pop-scrim（分支单选 / 版本多选）。
     G 只读：viewer(wujun) 无铅笔、值仍可跳转、编辑按钮与来源卡「移除关联」隐藏。
     I 项目：已发布工作项早退拦截（不发起必失败的保存）；只有测试 / 回滚记录的工作项同样拦（宽口径）；干净工作项换项目 → 确认 → 持久化 → 复位。
     K 待规划：干净工作项全部取消版本 → 待规划 → 复位。
     J 依赖：卡内就地展开（不再跳执行页）→ 类型/滞后即时落库 → 卡内浮层加前置 → 汇总同步 → 收起/切页签归位 → 删除复位。
     M 保存失败：注入 PUT 失败 → 读态卡片回滚到服务器值 + 诚实报错 + 回到原页签与原滚动位置，依赖卡保持展开，服务端未被改动。
     O 跨项目只读端点：本项目可写 / 对端只读的成员看到行内锁定 + 候选禁选，绕过界面直接写也被服务端拒绝。
   段序 A B C D E F L N H G I K J M O：L/N 放在窄屏 emulation 之前，headless 在 emulation 往返后
   会把 deviceScaleFactor 与原始按键路由留在窄屏状态（截图变 2880 宽、Escape 送不到页面），键盘断言必须先跑。
   全程控制台零报错 + 无 4xx/5xx + 无红色错误 toast（O 段登记的越权探针单独归桶）。数据：支付业务部演示库；运行前需 8082 预览 + 8090 后端在线。
   收尾会把 SNAP_TASK 的 branch/demand/version 复位；I/K 用自建的 E2E P4-ABC 工作项，跑完删除（含历史残留清扫）；
   O 的跨项目连线与 zhoumin 的项目授权都是临时样本，finally 里删连线并把授权还原为原值。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8082/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";   // 空间 viewer，全项目只读

const WS = "Smw9zcftmwwnrwuon";                 // 支付业务部
const PROJ = "R4ohfd6ha97zjtedr3ogg";           // 清结算与对账平台
const SNAP_TASK = "Kr9vof65na3g5h4130i38";      // 差错工单自动分派（done，绑定 PROJ，阅读态）
const BR_UI = "Bdn6h49ebc98lt1ynl5o8";          // feature/settle-v3.2-ui（原始）
const BR_CORE = "Bqyo06uxui8dn24w8swes";        // feature/settle-v3.2-core
const BR_REL = "Bv9d72gbu22mxiv8nalg1";         // release/settle-v3.1
const DM_PDF = "D4b6yvznsd0u1qrtuoxeo";         // 结算单 PDF 模板改版（pass，原始）
const DM_REVIEW = "Df03r64ywwq8xqn9sdg67";      // 对账差异智能匹配（review）
const DM_REJ = "D4901c03ij1ch418gwrge";         // 结算周期支持 T+0（rej，应被排除）
const V_OPEN = "Vpcw313tay8b1dn82deu7";         // 清结算 v3.2（可改选）
const V_LOCKED = "Voqh4tnoq3262hmplci2e";       // 清结算 v3.0（正式发布后只读，锁定保留在 SNAP_TASK 上）
const PROJ_ALT = "R4wejtfugwrudffx8x4x9";       // 统一支付网关（admin 可写，用于换项目）
const DEP_PEER = "Kjgkgqjlnuwadubt6jdow";       // 报表导出异步化（同项目，作为前置任务）
const FIXTURE_PREFIX = "E2E P4-ABC";            // I/K 自建工作项前缀，跑完删除
/* 残留3：守卫宽口径用现成演示样本（有发布记录但从未生产发布，窄口径 everPublished 拦不住） */
const GUARD_TEST = "Ksen0d0fadger2ogymtix";     // 对账单自动下载与推送（PROJ，只有测试环境部署记录）
const GUARD_ROLLBACK = "Kjyanulr3sxe1as2ey68t"; // 结算单 PDF 模板改版（PROJ，只有生产回滚记录）
/* 残留3：跨项目只读依赖端点。zhoumin 原为 PROJ=read / 风控=read，本批临时给 PROJ write 造样本，跑完还原 */
const HALF_USER = "zhoumin";
const HALF_UID = "Umw9zcfmah9inhkgm";
const PROJ_RISK = "Rvlauh8rxq7fihkg126sq";      // 风控规则引擎（zhoumin 只读）
const PEER_RISK = "K4g93x5qqhcej4kgf1ain";      // 规则版本灰度发布（风控，作为跨项目前置）
const PEER_RISK2 = "Knepi7vjt9gikfrq7nwwg";     // 决策流可视化编排（风控，未连线，用于候选禁选断言）

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

/* 预览直供的前端比运行中的 jar 新：文档分类/测试模块接口在源码里已有、jar 里还没打进去。
   这类 404 属环境差异，单独归桶并如实报出，不与本次改动的报错混在一起。 */
const KNOWN_GAP_APIS = ["/api/doc-categories", "/api/test-modules"];
const isKnownGap = url => KNOWN_GAP_APIS.some(p => String(url).indexOf(p) !== -1);
/* 故意越权探针（O 段：只读成员直接 PUT 依赖，预期被服务端 403 拒绝）。
   按样本依赖 id 精确登记，只放过这一条 URL，其余 4xx 仍照常判失败。 */
const EXPECT_DENIALS = [];
let denialBudget = 0;
const isExpectedDenial = url => EXPECT_DENIALS.some(re => re.test(String(url)));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.netErrors = [];
    this.knownGaps = []; this.resourceErrors = []; this.denials = []; this.denialResources = [];
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
        const line = r.status + " " + r.url;
        if(isKnownGap(r.url)) this.knownGaps.push(line);
        else if(isExpectedDenial(r.url)) this.denials.push(line);
        else this.netErrors.push(line);
      }
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(/Failed to load resource/.test(text)) (isExpectedDenial(text) ? this.denialResources : this.resourceErrors).push("console.error: " + text);
      else this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      const e = msg.params.entry;
      if(/Failed to load resource/.test(e.text || "")){
        (isExpectedDenial(e.url || "") ? this.denialResources : this.resourceErrors).push("resource: " + (e.url || "") + " " + e.text);
      }else this.errors.push("log: " + e.text);
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
const port = Number(process.env.E2E_PORT || 9446);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "assoc-p4-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
const SHOTS = [];
const BAD_TOASTS = [];   // 红色错误 toast（控制台/网络断言抓不到的用户可见报错）
const shot = async name => {
  /* 截图前清掉累积 toast，避免遮挡浮层/卡片（与原型驱动一致） */
  try{ await evaluate(`(() => { const w = document.getElementById("toastWrap"); if(w) w.innerHTML = ""; return true; })()`); }catch(e){}
  const s = await call("Page.captureScreenshot", { format: "png" });
  const out = "/tmp/hg-p4-" + name + ".png";
  fs.writeFileSync(out, Buffer.from(s.data, "base64"));
  SHOTS.push(out);
};

let call, evaluate, waitFor;
try{
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
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const pressKey = async (key, code, vk, text) => {
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };
  const pressEnter = () => pressKey("Enter", "Enter", 13, "\r");
  const pressEscape = () => pressKey("Escape", "Escape", 27);
  const pressArrowDown = () => pressKey("ArrowDown", "ArrowDown", 40);
  const popGone = async (ms) => {
    try{ await waitFor(`!document.querySelector(".assoc-picker")`, "浮层关闭", ms); return true; }
    catch(e){ return false; }
  };
  /* 窄屏 emulation 往返后 headless 的原始按键偶发送不到本页：在抽屉空白处点一下真实鼠标事件复位输入路由。
     落点取 drawerBody 左上内边距，不落在任何控件上；此时没有浮层打开，不会误关东西。 */
  const nudgeInput = async () => {
    const p = await evaluate(`(() => { const b = document.getElementById("drawerBody"); if(!b) return null;
      const r = b.getBoundingClientRect(); return { x:Math.round(r.left + 4), y:Math.round(r.top + 4) }; })()`);
    if(!p) return;
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(150);
  };
  /* 直接 clearDeviceMetricsOverride 会把窄屏的 deviceScaleFactor=2 与输入路由留在原地
     （截图变 2880 宽、原始按键送不到页面）。先显式回桌面参数再清，才能真正复位。 */
  const restoreDesktop = async () => {
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call("Emulation.setTouchEmulationEnabled", { enabled: false });
    await sleep(250);
    await call("Emulation.clearDeviceMetricsOverride", {});
    await sleep(250);
  };

  const section = async (name, fn) => {
    console.log("\n" + name);
    try{ await fn(); }
    catch(e){ failed++; console.log("  ERROR " + name + "：" + e.message); }
  };

  /* ---------- 错误 toast 监视（用户可见报错，控制台/网络断言抓不到） ---------- */
  const watchToasts = () => evaluate(`(() => {
    window.__badToasts = [];
    const w = document.getElementById("toastWrap"); if(!w) return false;
    new MutationObserver(muts => muts.forEach(mu => mu.addedNodes.forEach(n => {
      if(n.nodeType === 1 && /(^|\\s)bad(\\s|$)/.test(n.className)) window.__badToasts.push((n.textContent||"").trim().slice(0,80));
    }))).observe(w, { childList:true });
    return true;
  })()`);
  const drainBad = async () => {
    try{ const b = await evaluate(`(() => { const x = window.__badToasts||[]; window.__badToasts=[]; return x; })()`); BAD_TOASTS.push(...b); }catch(e){}
  };

  /* ---------- 登录 / 空间 ---------- */
  const login = async (user, pw) => {
    await drainBad();   // 导航会重置 window，先收走上一窗口的错误 toast
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
    let curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    if(curWs !== WS){
      await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {}))`);
      await call("Page.navigate", { url: BASE + "/" });
      await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentWs && rt.reqsLoaded)`, "切换空间后初始化", 20000);
      curWs = await evaluate(`import("./js/core/state.js").then(s => s.rt.currentWs && s.rt.currentWs.id)`);
    }
    await watchToasts();
    return curWs;
  };

  /* ---------- 抽屉 / 关联页签 ---------- */
  const openDrawerRel = async (id) => {
    await evaluate(`import("./js/core/task-actions.js").then(m => m.openTaskById(${JSON.stringify(id)})); true`);
    await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(id)} && document.getElementById("taskDrawer").classList.contains("on"))`, "抽屉打开", 12000);
    await evaluate(`(() => { const b = document.querySelector('[data-drawer-tab="rel"]'); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("paneRel"); const c = document.getElementById("readAssocCard");
      return p && !p.hidden && c && !c.hidden && document.querySelectorAll("#readAssoc dt").length > 0; })()`, "关联页签渲染", 10000);
    await sleep(250);
  };
  const closeOverlays = async () => {
    await evaluate(`import("./js/core/ui.js").then(m => {
      document.querySelectorAll(".modal-layer.open").forEach(l => m.UI.closeModal(l));
      const br = document.getElementById("branchDrawer"); if(br) br.classList.remove("on");
      return true;
    })`);
    await sleep(220);
  };
  const closeDrawer = async () => {
    await evaluate(`(() => { const b = document.getElementById("btnCloseTask"); if(b) b.click(); return true; })()`);
    await sleep(220);
    await evaluate(`(() => { const d = document.getElementById("dlgConfirm"); if(d && d.classList.contains("open")){ const c = document.getElementById("dlgConfirmCancel"); if(c) c.click(); } return true; })()`);
    await sleep(120);
  };

  /* ---------- 服务端持久化校验（绕过本地缓存：API.get 走 ETag，回读必须带随机串） ---------- */
  const apiTask = id => evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/task/" + ${JSON.stringify(id)} + "?probe=" + Date.now())).then(t => t ? { branchId:t.branchId||null, demandId:t.demandId||null, reqId:t.reqId||null, epicId:t.epicId||null, versionIds:(t.versionIds||[]).slice().sort() } : null)`);
  const waitPersist = async (id, field, expected, label) => {
    const deadline = Date.now() + 12000; let last, err = "";
    while(Date.now() < deadline){
      /* 保存瞬间会有并发请求，偶发 fetch 失败只重试，不能把整节判成 ERROR */
      try{ last = await apiTask(id); err = ""; }catch(e){ err = e.message; }
      const got = last ? last[field] : undefined;
      const ok = Array.isArray(expected) ? JSON.stringify(got) === JSON.stringify(expected) : got === expected;
      if(ok) return last;
      await sleep(250);
    }
    throw new Error("持久化超时：" + label + "（期望 " + field + "=" + JSON.stringify(expected) + "，最后 " + JSON.stringify(last) + (err ? "，末次错误 " + err : "") + "）");
  };
  /* 版本调整理由：保存成功后表单里的理由框按既有规则收起，理由只在审计时间线留痕 */
  const versionReasonLogged = (id, keyword) => evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/" + ${JSON.stringify(id)} + "/logs?limit=30&probe=" + Date.now()))
    .then(r => (r.items||[]).filter(l => l.action === "version_change").slice(0,3).map(l => {
      let reason = ""; try{ reason = (JSON.parse(l.changeData||"{}").reason) || ""; }catch(e){}
      return reason;
    }).some(x => x.indexOf(${JSON.stringify(keyword)}) !== -1))`);

  /* ---------- 选择浮层 ---------- */
  const pickerOpen = () => evaluate(`!!document.querySelector(".assoc-picker")`);
  const openPicker = async (kind) => {
    const clicked = await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="${kind}"]'); if(b){ b.click(); return true; } return false; })()`);
    if(!clicked) throw new Error("未找到 " + kind + " 铅笔");
    await waitFor(`!!document.querySelector(".assoc-picker")`, kind + " 浮层打开", 8000);
    await waitFor(`(() => { const r = document.querySelector(".assoc-picker .search-picker-results");
      return r && (r.querySelector(".search-picker-option") || r.querySelector(".search-picker-clear")); })()`, kind + " 候选就绪", 12000);
    await sleep(400);   // 等 ds-pop-in 入场动画结束，截图不透底
  };
  const pickerOptions = () => evaluate(`[...document.querySelectorAll(".assoc-picker .search-picker-results .search-picker-option")].map(b => ({ id:b.dataset.pick, text:b.textContent.trim(), selected:b.classList.contains("selected") }))`);
  const pickerCount = () => evaluate(`(document.querySelector(".assoc-picker .pp-count")||{}).textContent || ""`);
  const searchPicker = async q => {
    await evaluate(`(() => { const i = document.querySelector(".assoc-picker input");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(q)});
      i.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await sleep(160);
  };
  const pickOption = async id => {
    const ok = await evaluate(`(() => { const b = document.querySelector('.assoc-picker .search-picker-results [data-pick="${id}"]'); if(b){ b.click(); return true; } return false; })()`);
    if(!ok) throw new Error("未找到候选 data-pick=" + JSON.stringify(id));
    await waitFor(`!document.querySelector(".assoc-picker")`, "浮层关闭", 6000);
    await sleep(450);   // 正常操作节奏：让整单保存的后台加载收尾，避免突发请求瞬时连接失败
  };
  const rowInfo = kind => evaluate(`(() => {
    const anchor = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="${kind}"]')
      || document.querySelector('#readAssoc .ev-link[data-ev-${kind}]');
    const c = anchor ? anchor.closest("dd") : null;
    if(!c) return null;
    const link = c.querySelector('.ev-link[data-ev-${kind}]');
    const empty = c.querySelector(".ev-empty");
    return { isAssoc:c.classList.contains("ev-assoc"), role:c.getAttribute("role")||"",
      jumpId:link?link.getAttribute("data-ev-${kind}"):null, jumpText:link?link.textContent.trim():null,
      emptyText:empty?empty.textContent.trim():null, hasPencil:!!c.querySelector(".assoc-edit") };
  })()`);

  /* ---------- 计划版本多选浮层 ---------- */
  const openVerPicker = async () => {
    const clicked = await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="version"]'); if(b){ b.click(); return true; } return false; })()`);
    if(!clicked) throw new Error("未找到版本铅笔");
    await waitFor(`!!document.querySelector(".ver-picker")`, "版本浮层打开", 8000);
    await waitFor(`(() => { const r = document.querySelector(".ver-picker .search-picker-results");
      return r && (r.querySelector(".search-picker-option") || r.querySelector(".search-picker-empty")); })()`, "版本候选就绪", 12000);
    await sleep(400);
  };
  const verOptions = () => evaluate(`[...document.querySelectorAll(".ver-picker .search-picker-option")].map(b => ({
    id:b.getAttribute("data-ver-pick") || "", text:b.textContent.trim(),
    locked:b.classList.contains("is-locked"), disabled:b.disabled,
    selected:b.classList.contains("selected"), aria:b.getAttribute("aria-selected"),
    hasLock:!!b.querySelector(".pp-lock"), hasBox:!!b.querySelector(".pp-box") }))`);
  const verCount = () => evaluate(`(document.querySelector(".ver-picker .pp-count")||{}).textContent || ""`);
  const verToggle = async id => {
    const ok = await evaluate(`(() => { const b = document.querySelector('.ver-picker [data-ver-pick="${id}"]'); if(b){ b.click(); return true; } return false; })()`);
    if(!ok) throw new Error("未找到可改选版本 " + id);
    await sleep(180);
  };
  const verSave = async () => {
    await evaluate(`(() => { const b = document.querySelector(".ver-picker [data-ver-save]"); if(b) b.click(); return true; })()`);
    await waitFor(`!document.querySelector(".ver-picker")`, "版本浮层关闭", 6000);
    await sleep(300);
  };
  const verCancel = async () => {
    await evaluate(`(() => { const b = document.querySelector(".ver-picker [data-ver-cancel]"); if(b) b.click(); return true; })()`);
    await waitFor(`!document.querySelector(".ver-picker")`, "版本浮层取消关闭", 6000);
    await sleep(250);
  };
  /* 版本调整理由：整单提交流程弹出的必填 prompt */
  const promptOpen = () => evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /版本调整理由/.test(x.textContent||""));
    return !!(l && l.querySelector(".sheet-body input")); })()`);
  const fillPrompt = async text => {
    await waitFor(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /版本调整理由/.test(x.textContent||""));
      return !!(l && l.querySelector(".sheet-body input")); })()`, "版本调整理由弹窗", 8000);
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /版本调整理由/.test(x.textContent||""));
      const i = l.querySelector(".sheet-body input");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)});
      i.dispatchEvent(new Event("input", { bubbles:true }));
      l.querySelector('form .btn.primary[type="submit"]').click(); return true; })()`);
    await sleep(500);
  };
  /* 换项目会连带清空计划版本，可能触发理由弹窗；有就填，没有就继续 */
  const fillPromptIfAsked = async text => {
    const deadline = Date.now() + 4000;
    while(Date.now() < deadline){
      if(await promptOpen()){ await fillPrompt(text); return true; }
      await sleep(200);
    }
    return false;
  };
  const toastText = () => evaluate(`(document.getElementById("toastWrap")||{}).textContent || ""`);
  const confirmOk = async () => {
    await waitFor(`(() => { const d = document.getElementById("dlgConfirm"); return !!(d && d.classList.contains("open")); })()`, "确认弹窗", 8000);
    const msg = await evaluate(`(document.getElementById("dlgConfirmMsg")||{}).textContent || ""`);
    await evaluate(`(() => { const b = document.getElementById("dlgConfirmOk"); if(b) b.click(); return true; })()`);
    await sleep(400);
    return msg;
  };
  /* ---------- 关联卡：依赖行 / 页签 / 候选标签 ---------- */
  const relTab = async () => {
    await evaluate(`(() => { const b = document.querySelector('[data-drawer-tab="rel"]'); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("paneRel"); return !!(p && !p.hidden && document.querySelectorAll("#readAssoc dt").length); })()`, "回到关联页签", 8000);
    await sleep(300);
  };
  const depRowInfo = () => evaluate(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]');
    if(!b) return null; const dd = b.closest("dd");
    return { text:b.textContent.trim(), isAssoc:dd.classList.contains("ev-assoc"), role:dd.getAttribute("role")||"",
      hasPencil:!!dd.querySelector('.assoc-edit[data-assoc-edit="deps"]') }; })()`);
  const chipInfo = () => evaluate(`[...document.querySelectorAll(".assoc-picker .search-picker-results .search-picker-option")].map(b => ({
    id:b.getAttribute("data-pick") || "",
    title:(b.querySelector(".sp-title")||{}).textContent || "",
    ico:(b.querySelector(".sp-ico")||{}).className || "",
    tags:[...b.querySelectorAll(".sp-tag")].map(t => ({ text:t.textContent.trim(), cls:t.className.replace("sp-tag","").trim(), bg:getComputedStyle(t).backgroundColor, fg:getComputedStyle(t).color })),
    target:(b.querySelector(".sp-target")||{}).textContent || ""
  }))`);
  /* ---------- 卡内依赖编辑器（②：同一份 DOM 搬进关联卡，不跳执行页） ---------- */
  const depInlineInfo = () => evaluate(`(() => {
    const card = document.getElementById("fDeps"), host = document.getElementById("readAssocCard");
    const exec = document.getElementById("paneExec"), stack = exec ? exec.querySelector(".stack") : null;
    const rel = document.getElementById("paneRel"), relBtn = document.querySelector('[data-drawer-tab="rel"]');
    const closeBtn = document.getElementById("btnDepInlineClose"), picker = document.getElementById("depPicker");
    const pencil = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="deps"]');
    const r = card ? card.getBoundingClientRect() : null;
    return { inAssoc:!!(card && host && host.contains(card)), inlineCls:!!(card && card.classList.contains("dep-card-inline")),
      visible:!!(card && card.offsetParent !== null), inExec:!!(card && stack && stack.contains(card)),
      execLast:!!(card && stack && stack.lastElementChild === card),
      relTab:relBtn?relBtn.getAttribute("aria-selected"):"", relPane:!!(rel && !rel.hidden), execPane:!!(exec && !exec.hidden),
      closeBtn:!!(closeBtn && !closeBtn.hidden), expanded:pencil?pencil.getAttribute("aria-expanded"):null,
      pickerOpen:!!(picker && !picker.hidden), pickerInAssoc:!!(picker && host && host.contains(picker)),
      foot:(document.getElementById("depFoot")||{}).textContent || "",
      overflow:r ? r.right > window.innerWidth + 1 : false };
  })()`);
  const apiDeps = () => evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/${SNAP_TASK}/dependencies?probe=" + Date.now()))
    .then(a => (a||[]).map(e => ({ id:e.id, from:e.from&&e.from.id, to:e.to&&e.to.id,
      depType:e.depType, lagDays:Number(e.lagDays)||0, editable:!!e.editable })))`);
  const waitDeps = async (n, label) => {
    const deadline = Date.now() + 12000; let last;
    while(Date.now() < deadline){
      last = await apiDeps();
      if(last.length === n) return last;
      await sleep(200);
    }
    throw new Error("依赖条数超时：" + label + "（期望 " + n + "，最后 " + JSON.stringify(last) + "）");
  };
  const waitDepField = async (field, expected, label) => {
    const deadline = Date.now() + 12000; let last;
    while(Date.now() < deadline){
      last = await apiDeps();
      if(last.length === 1 && last[0][field] === expected) return last[0];
      await sleep(200);
    }
    throw new Error("依赖字段持久化超时：" + label + "（期望 " + field + "=" + expected + "，最后 " + JSON.stringify(last) + "）");
  };
  const setDepType = async v => {
    await evaluate(`(() => { const s = document.querySelector("#depPredList .dep-type");
      s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    await sleep(250);
  };
  const setDepLag = async v => {
    await evaluate(`(() => { const i = document.querySelector("#depPredList .dep-lag input");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(String(v))});
      i.dispatchEvent(new Event("change", { bubbles:true })); return true; })()`);
    await sleep(250);
  };
  const depRowState = () => evaluate(`(() => { const row = document.querySelector("#depPredList .dep-row");
    const type = row ? row.querySelector(".dep-type") : null, lag = row ? row.querySelector(".dep-lag input") : null;
    return { n:document.querySelectorAll("#depPredList .dep-row").length,
      title:row ? (row.querySelector(".dep-title")||{}).textContent.trim() : "",
      meta:row ? (row.querySelector(".dep-meta")||{}).textContent.trim() : "",
      type:type?type.value:"", typeLocked:type?type.disabled:null, lag:lag?lag.value:"", lagLocked:lag?lag.disabled:null,
      del:!!(row && row.querySelector("[data-dep-del]")), bad:!!(row && row.querySelector(".dep-bad")),
      alert:(() => { const a = document.getElementById("depAlert"); return !!(a && !a.hidden); })(),
      badRows:document.querySelectorAll("#fDeps .dep-bad").length }; })()`);
  /* ---------- 清除项图标 / 版本候选标签（③） ---------- */
  const clearRowInfo = () => evaluate(`(() => { const b = document.querySelector(".assoc-picker .search-picker-clear");
    if(!b) return null; const ci = b.querySelector(".ci"), svg = ci ? ci.querySelector("svg") : null;
    const r = ci ? ci.getBoundingClientRect() : null, opt = document.querySelector(".assoc-picker .sp-ico");
    const or = opt ? opt.getBoundingClientRect() : null;
    return { text:b.textContent.trim(), label:b.getAttribute("data-pick"), hasCi:!!ci, hasSvg:!!svg,
      w:r?Math.round(r.width):0, h:r?Math.round(r.height):0, optW:or?Math.round(or.width):0,
      bg:ci?getComputedStyle(ci).backgroundColor:"", radius:ci?getComputedStyle(ci).borderTopLeftRadius:"" }; })()`);
  const verChipInfo = () => evaluate(`[...document.querySelectorAll(".ver-picker .search-picker-option")].map(b => {
    const t = b.querySelector(".sp-tag");
    return { id:b.getAttribute("data-ver-pick") || "", title:(b.querySelector(".search-picker-option-title")||{}).textContent.trim(),
      locked:b.classList.contains("is-locked"), selected:b.classList.contains("selected"),
      n:b.querySelectorAll(".sp-tag").length, text:t?t.textContent.trim():"", cls:t?t.className.replace("sp-tag","").trim():"",
      bg:t?getComputedStyle(t).backgroundColor:"", fg:t?getComputedStyle(t).color:"",
      hasBox:!!b.querySelector(".pp-box"), hasLock:!!b.querySelector(".pp-lock") };
  })`);
  /* ---------- 注入保存失败（①）：api.js 调全局 fetch，TypeError → 「网络异常…」 ---------- */
  const failTaskPuts = () => evaluate(`(() => {
    if(window.__origFetch) return false;
    window.__origFetch = window.fetch; window.__failedPuts = 0;
    window.fetch = function(input, init){
      const url = typeof input === "string" ? input : ((input && input.url) || "");
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if(method === "PUT" && url.indexOf("/api/tasks/") !== -1){
        window.__failedPuts++;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return window.__origFetch.apply(this, arguments);
    };
    return true;
  })()`);
  const restoreFetch = () => evaluate(`(() => { const n = window.__failedPuts || 0;
    if(window.__origFetch){ window.fetch = window.__origFetch; delete window.__origFetch; }
    delete window.__failedPuts; return n; })()`);
  /* 取走并清空错误 toast，但不计入全局断言：本节故意制造一次失败 */
  const takeBad = () => evaluate(`(() => { const x = window.__badToasts || []; window.__badToasts = []; return x; })()`);
  /* 只数整单保存的 PUT（不含 /dependencies 等子资源）：守卫早退必须一个保存请求都不发 */
  const watchTaskPuts = () => evaluate(`(() => {
    if(window.__putWatch) return false;
    window.__putWatch = window.fetch; window.__putCount = 0;
    window.fetch = function(input, init){
      const url = typeof input === "string" ? input : ((input && input.url) || "");
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if(method === "PUT" && /\\/api\\/tasks\\/[^/?]+(\\?|$)/.test(url)) window.__putCount++;
      return window.__putWatch.apply(this, arguments);
    };
    return true;
  })()`);
  const unwatchTaskPuts = () => evaluate(`(() => { const n = window.__putCount || 0;
    if(window.__putWatch){ window.fetch = window.__putWatch; delete window.__putWatch; }
    delete window.__putCount; return n; })()`);
  /* 跨项目只读端点：行内锁标记 / 只读徽标 / 删除入口 / 跳转入口 */
  const depLockInfo = () => evaluate(`(() => {
    const row = document.querySelector("#depPredList .dep-row");
    if(!row) return null;
    const type = row.querySelector(".dep-type"), lag = row.querySelector(".dep-lag input");
    const open = row.querySelector("[data-dep-open]");
    return { chip:(row.querySelector(".dep-opt-state")||{}).textContent || "",
      typeLocked:type ? type.disabled : null, lagLocked:lag ? lag.disabled : null,
      typeMark:type ? type.getAttribute("data-dep-locked") : null,
      lagMark:lag ? lag.getAttribute("data-dep-locked") : null,
      del:!!row.querySelector("[data-dep-del]"),
      openId:open ? open.getAttribute("data-dep-open") : null,
      title:(row.querySelector(".dep-title")||{}).textContent || "",
      meta:(row.querySelector(".dep-meta")||{}).textContent || "" };
  })()`);
  /* ===================== 启动 ===================== */
  console.log("P4 关联就地编辑 E2E\n  地址：" + BASE);
  const curWs = await login(USER, PASS);
  assert(curWs === WS, "登录 " + USER + "，当前空间为支付业务部（" + curWs + "）");
  pass("登录 " + USER);
  const servedHasEdit = await evaluate(`fetch("./js/core/task-drawer.js?probe=" + Date.now()).then(r => r.text()).then(t => t.indexOf("data-assoc-edit") !== -1 && t.indexOf("openAssocFact") !== -1 && t.indexOf("openVersionAssocPicker") !== -1 && t.indexOf("depAssocCounts") !== -1 && t.indexOf('data-ev-goto="deps"') !== -1 && t.indexOf("openVersionFact") === -1)`);
  assert(servedHasEdit, "预览直供的 task-drawer.js 含本次改动（就地编辑 + 版本多选 + 依赖汇总，且无重复版本选择器）");
  const servedBatch2 = await evaluate(`fetch("./js/core/task-drawer.js?probe=" + Date.now()).then(r => r.text()).then(t => ({
    revert:t.indexOf("revertFailedFactSave") !== -1, inline:t.indexOf("function closeDepInline") !== -1 && t.indexOf("depInlineOpen") !== -1,
    noJump:/if\\(goto === "deps"\\)\\{\\s*openDepSection\\(\\);/.test(t),
    ban:t.indexOf('icon("ban", 14)') !== -1, verTag:t.indexOf("STATUS_TEXT[o.status]") !== -1 }))`);
  assert(servedBatch2.revert && servedBatch2.inline && servedBatch2.noJump && servedBatch2.ban && servedBatch2.verTag,
    "预览直供的 task-drawer.js 含第二批改动（失败回滚 + 依赖卡内编辑 + 清除项 ⊘ + 版本状态标签）" + JSON.stringify(servedBatch2));
  /* 残留收尾：失败回滚与成功保存两条路径都要保住展开的依赖卡；守卫按已读到的发布记录数拦 */
  const servedBatch3 = await evaluate(`fetch("./js/core/task-drawer.js?probe=" + Date.now()).then(r => r.text()).then(t => ({
    failKeep:/if\\(restoreView\\.depInline\\) openDepSection\\(true\\)/.test(t),
    okKeep:/if\\(backView\\.depInline\\) openDepSection\\(true\\)/.test(t),
    scrollRetry:t.indexOf("function restoreDrawerScroll") !== -1,
    guardWide:t.indexOf("releaseRecordGuard") !== -1 && /releaseRecordGuard\\.count > 0/.test(t) }))`);
  assert(servedBatch3.failKeep && servedBatch3.okKeep && servedBatch3.scrollRetry && servedBatch3.guardWide,
    "预览直供的 task-drawer.js 含残留收尾改动（两条保存路径都保持依赖卡展开 + 滚动重试 + 守卫宽口径）" + JSON.stringify(servedBatch3));
  const servedCss = await evaluate(`fetch("./css/components.css?probe=" + Date.now()).then(r => r.text()).then(t => t.indexOf(".assoc-picker") !== -1 && t.indexOf("dd.ev-assoc") !== -1 && t.indexOf(".sp-tag") !== -1 && t.indexOf(".ver-picker") !== -1)`);
  assert(servedCss, "预览直供的 components.css 含 .assoc-picker + dd.ev-assoc + .sp-tag + .ver-picker 样式");
  const servedCss2 = await evaluate(`fetch("./css/components.css?probe=" + Date.now()).then(r => r.text()).then(t => ({
    inline:t.indexOf(".read-card > .dep-card-inline") !== -1, clear:t.indexOf(".search-picker-clear .ci") !== -1,
    planned:t.indexOf(".sp-tag.planned") !== -1, active:t.indexOf(".sp-tag.active") !== -1, closed:t.indexOf(".sp-tag.closed") !== -1 }))`);
  assert(servedCss2.inline && servedCss2.clear && servedCss2.planned && servedCss2.active && servedCss2.closed,
    "预览直供的 components.css 含卡内依赖卡 + 清除项图标 + 版本状态配色" + JSON.stringify(servedCss2));
  const servedIcon = await evaluate(`fetch("./js/core/icons.js?probe=" + Date.now()).then(r => r.text()).then(t => t.indexOf("ban: function") !== -1)`);
  assert(servedIcon, "icons.js 提供 ban（⊘）图标，清除项不再是纯文字行");
  const servedOpts = await evaluate(`Promise.all([fetch("./js/views/demands.js?probe=" + Date.now()).then(r => r.text()), fetch("./js/views/branches.js?probe=" + Date.now()).then(r => r.text())]).then(a => a[0].indexOf("data-status") !== -1 && a[1].indexOf("data-status") !== -1 && a[1].indexOf("data-target") !== -1)`);
  assert(servedOpts, "需求/分支下拉选项带 data-status / data-target（候选标签的唯一数据源）");

  /* 记录原始关联，收尾复位 */
  const orig = await apiTask(SNAP_TASK);
  console.log("  原始关联：" + JSON.stringify(orig));

  /* ===================== A 结构 ===================== */
  await section("[A] 阅读态关联页签结构", async () => {
    await evaluate(`import("./js/core/router.js").then(r => r.showView("list")); true`);
    await sleep(400);
    await openDrawerRel(SNAP_TASK);
    const ro = await evaluate(`import("./js/core/state.js").then(s => ({ ro:s.rt.drawerReadOnly, mode:s.rt.editingId }))`);
    assert(ro.ro === false && ro.mode === SNAP_TASK, "admin 阅读态可编辑（drawerReadOnly=false）");
    const d = await rowInfo("demand"), b = await rowInfo("branch");
    assert(d && d.isAssoc && d.hasPencil && d.jumpId === DM_PDF, "关联需求行：跳转值(PDF) + 铅笔，dd.ev-assoc");
    assert(b && b.isAssoc && b.hasPencil && b.jumpId === BR_UI, "所属分支行：跳转值(ui) + 铅笔，dd.ev-assoc");
    assert(d.role === "" && b.role === "", "dd.ev-assoc 非 role=button（值与铅笔为兄弟原生按钮，无嵌套交互）");
    const pencilCount = await evaluate(`document.querySelectorAll("#readAssoc .assoc-edit").length`);
    assert(pencilCount === 5, "需求/分支/项目/版本/依赖五行有铅笔（共 " + pencilCount + " 个）");
    const kinds = await evaluate(`[...document.querySelectorAll("#readAssoc .assoc-edit")].map(x => x.getAttribute("data-assoc-edit")).sort()`);
    assert(JSON.stringify(kinds) === JSON.stringify(["branch","demand","deps","project","version"]), "铅笔种类齐全且无重复（" + kinds.join(",") + "）");
    const tagOk = await evaluate(`[...document.querySelectorAll("#readAssoc .assoc-edit")].every(x => x.tagName === "BUTTON" && x.type === "button")`);
    assert(tagOk, "铅笔均为原生 <button type=button>");
    const ariaOk = await evaluate(`[...document.querySelectorAll("#readAssoc .assoc-edit")].every(x => /就地编辑|编辑依赖/.test(x.getAttribute("aria-label")||""))`);
    assert(ariaOk, "铅笔带 aria-label（就地编辑… / 编辑依赖关系）");
    /* A2 项目行：值走全局 assoc-link 跳转，铅笔独立 */
    const proj = await evaluate(`(() => { const dd = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]').closest("dd");
      const link = dd.querySelector(".assoc-link");
      return { isAssoc:dd.classList.contains("ev-assoc"), role:dd.getAttribute("role")||"",
        jump:link?link.getAttribute("data-jump-project"):null, text:link?link.textContent.trim():"",
        tag:link?link.tagName:"", nested:!!dd.querySelector("button button") }; })()`);
    assert(proj.isAssoc && proj.role === "" && !proj.nested, "所属项目行 dd.ev-assoc 非 role=button、无按钮嵌套");
    assert(proj.jump === PROJ && /清结算/.test(proj.text) && proj.tag === "BUTTON", "所属项目值为可跳转 assoc-link（data-jump-project=" + proj.jump + "）");
    /* A3 版本行：多选值容器 ev-vers，值仍可跳转 */
    const ver = await evaluate(`(() => { const dd = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="version"]').closest("dd");
      return { isVers:dd.classList.contains("ev-vers"), links:dd.querySelectorAll("[data-jump-version]").length,
        text:dd.textContent.trim(), wrap:getComputedStyle(dd).flexWrap }; })()`);
    assert(ver.isVers && ver.links >= 1, "计划版本行 dd.ev-vers，版本值可跳转（" + ver.links + " 个）");
    assert(ver.wrap === "wrap", "计划版本行允许换行，多版本 + 铅笔不挤压");
    /* A4 依赖行：汇总文案 + 跳转按钮 + 铅笔 */
    const dep = await depRowInfo();
    assert(dep && dep.isAssoc && dep.role === "" && dep.hasPencil, "依赖行 dd.ev-assoc（非 role=button）+ 铅笔");
    assert(dep.text === "暂无依赖", "SNAP_TASK 无依赖时汇总显示「暂无依赖」（实际 " + dep.text + "）");
    /* B 批：可编辑时来源卡「移除关联」正常可用（来源卡就在关联页签，不切页签） */
    const srcAdmin = await evaluate(`(() => { const box = document.getElementById("drawerSource"), rm = document.getElementById("drawerSourceRemove");
      return { box:!!(box && !box.hidden && box.offsetParent !== null), rm:!!(rm && !rm.hidden && rm.offsetParent !== null),
        title:(document.getElementById("drawerSourceTitle")||{}).textContent || "" }; })()`);
    assert(srcAdmin.box && srcAdmin.rm, "可编辑态：来源卡与「移除关联」按钮均可见（" + srcAdmin.title + "）");
    await shot("a-source-card-editable");
    await shot("a-desktop-assoc-card");
  });

  /* ===================== B 分支就地编辑 ===================== */
  await section("[B] 所属分支：搜索 → 选中保存 → 清除 → 复位", async () => {
    await openPicker("branch");
    let opts = await pickerOptions();
    assert(opts.length === 3, "分支候选 3 条（实际 " + opts.length + "）");
    assert(opts.some(o => o.id === BR_UI && o.selected), "当前分支 ui 标记 selected + 当前");
    const cnt = await pickerCount();
    assert(/3 条候选/.test(cnt), "计数显示「3 条候选」（" + cnt + "）");
    const hasClear = await evaluate(`!!document.querySelector('.assoc-picker .search-picker-clear[data-pick=""]')`);
    assert(hasClear, "提供清除项「未设置」");
    await shot("b-branch-picker");
    /* C 批：候选行彩色状态标签 + 图标块 + 目标分支（对照原型 p4-inline-edit） */
    let chips = await chipInfo();
    assert(chips.length === 3 && chips.every(c => /sp-ico branch/.test(c.ico)), "分支候选均有分支图标块 sp-ico.branch");
    const brTag = id => (chips.find(c => c.id === id) || { tags:[] }).tags[0] || {};
    assert(brTag(BR_CORE).text === "开发中" && brTag(BR_CORE).cls === "dev", "core 候选标签「开发中」（dev）");
    assert(brTag(BR_UI).text === "待合并" && brTag(BR_UI).cls === "merging", "ui 候选标签「待合并」（merging）");
    assert(brTag(BR_REL).text === "已发布" && brTag(BR_REL).cls === "released", "release 候选标签「已发布」（released）");
    const brBgs = [brTag(BR_CORE).bg, brTag(BR_UI).bg, brTag(BR_REL).bg];
    assert(new Set(brBgs).size === 3, "三种分支状态标签底色互不相同（" + brBgs.join(" / ") + "）");
    assert(chips.every(c => /→\s*release\/settle-v3\.2/.test(c.target)), "候选行显示目标分支「→ release/settle-v3.2」");
    assert(chips.every(c => c.title && c.title.indexOf("→") === -1 && !/（/.test(c.title)), "候选标题剥离状态与目标后缀，只留分支名");
    const chipFits = await evaluate(`[...document.querySelectorAll(".assoc-picker .search-picker-option")].every(b => b.scrollWidth <= b.clientWidth + 1)`);
    assert(chipFits, "候选行加标签后无横向溢出");
    await shot("b-branch-picker-chips");
    await searchPicker("core");
    opts = await pickerOptions();
    assert(opts.length === 1 && opts[0].id === BR_CORE, "搜索 core → 仅匹配 feature/settle-v3.2-core");
    assert(/匹配 1 条/.test(await pickerCount()), "搜索计数「匹配 1 条」");
    await searchPicker("");
    await pickOption(BR_CORE);
    await waitPersist(SNAP_TASK, "branchId", BR_CORE, "分支→core");
    pass("选中 core → 服务端 branchId 持久化为 core");
    let b = await rowInfo("branch");
    assert(b.jumpId === BR_CORE && /core/.test(b.jumpText||""), "行内跳转值乐观更新为 core");
    const selVal = await evaluate(`document.getElementById("iBranch").value`);
    assert(selVal === BR_CORE, "隐藏表单 iBranch.value 同步为 core");
    await shot("b-branch-after-pick");
    /* 清除 */
    await openPicker("branch");
    await pickOption("");
    await waitPersist(SNAP_TASK, "branchId", null, "分支清除");
    pass("清除分支 → 服务端 branchId=null");
    b = await rowInfo("branch");
    assert(!b.jumpId && b.emptyText === "未设置" && b.hasPencil, "清除后行显示占位「未设置」，铅笔仍在");
    await shot("b-branch-cleared");
    /* 复位 ui */
    await openPicker("branch");
    await pickOption(BR_UI);
    await waitPersist(SNAP_TASK, "branchId", BR_UI, "分支复位 ui");
    pass("分支复位为 ui");
  });

  /* ===================== C 需求就地编辑 ===================== */
  await section("[C] 关联需求：rej 排除 → 搜索 → 选中保存 → 查看联动 → 清除 → 复位", async () => {
    await openPicker("demand");
    let opts = await pickerOptions();
    assert(opts.length === 5, "需求候选 5 条（6 需求剔除 1 个 rej，实际 " + opts.length + "）");
    assert(!opts.some(o => o.id === DM_REJ), "已拒绝需求 T+0 不进入候选");
    assert(opts.some(o => o.id === DM_PDF && o.selected), "当前需求 PDF 标记 selected + 当前");
    assert(/5 条候选/.test(await pickerCount()), "计数显示「5 条候选」");
    await shot("c-demand-picker");
    /* C 批：需求候选状态标签（待评审 / 已通过 / 已排期），口径与需求池 COLS 一致 */
    const dchips = await chipInfo();
    assert(dchips.length === 5 && dchips.every(c => /sp-ico demand/.test(c.ico)), "需求候选均有需求图标块 sp-ico.demand");
    const dmTag = id => (dchips.find(c => c.id === id) || { tags:[] }).tags[0] || {};
    assert(dmTag(DM_PDF).text === "已通过" && dmTag(DM_PDF).cls === "pass", "PDF 需求标签「已通过」（pass）");
    assert(dmTag(DM_REVIEW).text === "待评审" && dmTag(DM_REVIEW).cls === "review", "对账差异需求标签「待评审」（review）");
    const planTags = dchips.filter(c => c.tags[0] && c.tags[0].cls === "plan");
    assert(planTags.length === 2 && planTags.every(c => c.tags[0].text === "已排期"), "两条已排期需求标签「已排期」（plan）");
    const dmBgs = [dmTag(DM_PDF).bg, dmTag(DM_REVIEW).bg, planTags[0].tags[0].bg];
    assert(new Set(dmBgs).size === 3, "三种需求状态标签底色互不相同（" + dmBgs.join(" / ") + "）");
    assert(dchips.every(c => c.title && !/（/.test(c.title)), "需求候选标题剥离状态后缀");
    await shot("c-demand-picker-chips");
    await searchPicker("对账差异");
    opts = await pickerOptions();
    assert(opts.length === 1 && opts[0].id === DM_REVIEW, "搜索「对账差异」→ 仅匹配 review 需求");
    await searchPicker("");
    await pickOption(DM_REVIEW);
    await waitPersist(SNAP_TASK, "demandId", DM_REVIEW, "需求→review");
    pass("选中 review → 服务端 demandId 持久化");
    let d = await rowInfo("demand");
    assert(d.jumpId === DM_REVIEW, "行内跳转值乐观更新为 review 需求");
    const demandSync = await evaluate(`import("./js/core/state.js").then(s => ({ form:s.rt.formDemandId, sel:document.getElementById("iDemand").value, viewBtn:(document.getElementById("iDemandView")||{}).hidden }))`);
    assert(demandSync.form === DM_REVIEW && demandSync.sel === DM_REVIEW, "rt.formDemandId + iDemand.value 同步");
    assert(demandSync.viewBtn === false, "「查看需求」按钮联动出现（syncAssocViewBtns）");
    await shot("c-demand-after-pick");
    /* 清除 */
    await openPicker("demand");
    await pickOption("");
    await waitPersist(SNAP_TASK, "demandId", null, "需求清除");
    pass("清除需求 → 服务端 demandId=null");
    d = await rowInfo("demand");
    assert(!d.jumpId && d.emptyText === "未关联" && d.hasPencil, "清除后行显示占位「未关联」，铅笔仍在");
    await shot("c-demand-cleared");
    /* 复位 PDF */
    await openPicker("demand");
    await pickOption(DM_PDF);
    await waitPersist(SNAP_TASK, "demandId", DM_PDF, "需求复位 PDF");
    pass("需求复位为 PDF 模板改版");
  });

  /* ===================== D 计划版本就地编辑 ===================== */
  await section("[D] 计划版本：锁定行 → 加选 → 理由必填 → 持久化 → 取消不改 → 移除复位", async () => {
    const both = [V_LOCKED, V_OPEN].slice().sort();
    await openVerPicker();
    let vopts = await verOptions();
    assert(vopts.length === 2, "版本候选 2 条（含锁定保留项，实际 " + vopts.length + "）");
    const locked = vopts.find(o => o.locked), open = vopts.find(o => o.id === V_OPEN);
    assert(locked && locked.disabled && locked.selected && locked.aria === "true" && locked.hasLock,
      "已发布版本 v3.0 列为锁定行：disabled + 勾选 + aria-selected + 锁图标");
    assert(locked.hasBox && open && open.hasBox && !open.selected, "候选用勾选框表达多选，v3.2 初始未勾选");
    assert(/已选 1 项/.test(await verCount()), "计数「已选 1 项」（锁定项计入）");
    const multi = await evaluate(`(document.querySelector(".ver-picker .search-picker-results")||{}).getAttribute("aria-multiselectable")`);
    assert(multi === "true", "版本候选列表 aria-multiselectable=true");
    await shot("d-version-picker");
    /* 锁定行点不动 */
    await evaluate(`(() => { const b = document.querySelector(".ver-picker .search-picker-option.is-locked"); if(b) b.click(); return true; })()`);
    await sleep(200);
    assert(/已选 1 项/.test(await verCount()), "点锁定行不改选（仍已选 1 项）");
    /* 搜索 */
    await searchPicker("v3.2");
    vopts = await verOptions();
    assert(vopts.length === 1 && vopts[0].id === V_OPEN, "搜索 v3.2 → 仅匹配可改选的 v3.2");
    await searchPicker("");
    /* 勾选只改本地态，未保存前不落库 */
    await verToggle(V_OPEN);
    assert(/已选 2 项/.test(await verCount()), "勾选 v3.2 → 计数「已选 2 项」");
    const beforeSave = await apiTask(SNAP_TASK);
    assert(JSON.stringify(beforeSave.versionIds) === JSON.stringify([V_LOCKED]), "勾选阶段不写库（服务端仍只有 v3.0）");
    /* 取消不写回 */
    await verCancel();
    await openVerPicker();
    assert(/已选 1 项/.test(await verCount()), "取消后重开回到已保存状态（已选 1 项）");
    /* 加选 + 保存 → 理由必填 */
    await verToggle(V_OPEN);
    await verSave();
    assert(await promptOpen(), "版本变化触发「版本调整理由」必填弹窗");
    await shot("d-version-reason-prompt");
    /* 空理由不放行 */
    await evaluate(`(() => { const l = [...document.querySelectorAll(".modal-layer.open")].find(x => /版本调整理由/.test(x.textContent||""));
      l.querySelector('form .btn.primary[type="submit"]').click(); return true; })()`);
    await sleep(300);
    assert(await promptOpen(), "空理由不放行，弹窗保持打开");
    const stillOne = await apiTask(SNAP_TASK);
    assert(JSON.stringify(stillOne.versionIds) === JSON.stringify([V_LOCKED]), "空理由未提交（服务端仍只有 v3.0）");
    await fillPrompt("E2E：计划版本就地编辑加选 v3.2");
    await waitPersist(SNAP_TASK, "versionIds", both, "版本加选 v3.2");
    pass("保存后服务端 versionIds = [v3.0(锁定), v3.2]");
    const afterAdd = await evaluate(`(() => { const dd = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="version"]').closest("dd");
      const p = document.getElementById("paneRel"), t = document.querySelector('[data-drawer-tab="rel"]');
      return { links:dd.querySelectorAll("[data-jump-version]").length, text:dd.textContent.trim(),
        relPane:!!(p && !p.hidden), relTab:t?t.getAttribute("aria-selected"):"",
        sel:[...document.getElementById("iVersion").options].filter(o => o.selected && o.value).map(o => o.value).sort() }; })()`);
    assert(afterAdd.links === 2 && /v3\.2/.test(afterAdd.text), "关联卡版本值乐观更新为两条，仍可跳转");
    assert(afterAdd.relPane && afterAdd.relTab === "true", "保存后停留在阅读态关联页签（不跳页签）");
    assert(JSON.stringify(afterAdd.sel) === JSON.stringify(both), "隐藏表单 iVersion 选中项与服务端一致");
    assert(await versionReasonLogged(SNAP_TASK, "加选 v3.2"), "版本调整理由随单提交并落到审计时间线（version_change.reason）");
    await shot("d-version-after-add");
    /* 移除 v3.2，锁定项必须保留 */
    await openVerPicker();
    await verToggle(V_OPEN);
    assert(/已选 1 项/.test(await verCount()), "取消 v3.2 → 已选 1 项（锁定项不可取消）");
    await verSave();
    await fillPrompt("E2E：计划版本就地编辑移除 v3.2");
    await waitPersist(SNAP_TASK, "versionIds", [V_LOCKED], "版本移除 v3.2");
    pass("移除后服务端只剩锁定的 v3.0，保留关联未被丢弃");
    const backOne = await evaluate(`document.querySelectorAll('#readAssoc [data-jump-version]').length`);
    assert(backOne === 1, "关联卡版本值回到一条");
  });

  /* ===================== E 跳转保留 ===================== */
  await section("[E] 点「值」仍穿透跳转，且不误开选择浮层", async () => {
    /* 分支值 → 分支抽屉 */
    await evaluate(`(() => { const l = document.querySelector('#readAssoc .ev-link[data-ev-branch]'); if(l) l.click(); return true; })()`);
    let landed = false;
    try{ await waitFor(`!!(document.getElementById("branchDrawer") && document.getElementById("branchDrawer").classList.contains("on"))`, "分支抽屉", 10000); landed = true; }catch(e){}
    assert(landed, "点分支值 → 打开分支抽屉（evDrill 保留）");
    assert(!(await pickerOpen()), "点分支值未误开就地编辑浮层");
    await shot("e-branch-jump");
    await closeOverlays();
    /* 需求值 → 需求详情 */
    await evaluate(`(() => { const l = document.querySelector('#readAssoc .ev-link[data-ev-demand]'); if(l) l.click(); return true; })()`);
    landed = false;
    try{ await waitFor(`(() => { const l = document.querySelector(".demand-detail[data-ai-demand=" + ${JSON.stringify(DM_PDF)} + "]"); return !!(l && l.offsetWidth > 0); })()`, "需求详情", 10000); landed = true; }catch(e){}
    assert(landed, "点需求值 → 打开需求详情（evDrill 保留）");
    assert(!(await pickerOpen()), "点需求值未误开就地编辑浮层");
    await shot("e-demand-jump");
    await closeOverlays();
    /* 跳转后抽屉仍在关联页签，铅笔仍可用 */
    const still = await evaluate(`(() => { const p = document.getElementById("paneRel"); return !!(p && !p.hidden && document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="branch"]')); })()`);
    assert(still, "跳转返回后关联页签与铅笔仍在");
  });

  /* ===================== F 键盘 ===================== */
  await section("[F] 键盘：Enter 开浮层 → ArrowDown 导航 → Enter 保存 → Escape 关闭", async () => {
    await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="branch"]'); if(b) b.focus(); return true; })()`);
    await pressEnter();
    await waitFor(`!!document.querySelector(".assoc-picker")`, "Enter 开浮层", 6000);
    await waitFor(`!!document.querySelector(".assoc-picker .search-picker-option")`, "键盘浮层候选就绪", 10000);
    pass("铅笔 Enter → 打开选择浮层");
    await sleep(120);
    /* 显式聚焦搜索框后逐步 ArrowDown，焦点应沿真实 DOM 序逐项推进（清除项在首，随后按候选顺序），不跳项。
       期望序列从 pickerOptions() 实测推导，不预设 ui/core 先后；首键若仍在输入框则跳过。 */
    await evaluate(`(() => { const i = document.querySelector(".assoc-picker input"); if(i) i.focus(); return true; })()`);
    await sleep(60);
    const domOrder = (await pickerOptions()).map(o => o.id);
    const btnsOrder = [""].concat(domOrder);   // 清除项 data-pick="" 居首
    const seq = [];
    let reachedCore = false;
    for(let i = 0; i < btnsOrder.length + 2 && !reachedCore; i++){
      await pressArrowDown(); await sleep(120);
      const f = await evaluate(`(() => { const a = document.activeElement; if(!a) return "(null)";
        if(a.tagName === "INPUT") return "(input)"; const v = a.getAttribute("data-pick"); return v === null ? "(none)" : v; })()`);
      seq.push(f);
      if(f === BR_CORE) reachedCore = true;
    }
    assert(reachedCore, "ArrowDown 导航可到达 core 候选（焦点序列 " + JSON.stringify(seq) + "）");
    const start = seq[0] === "(input)" ? 1 : 0;
    const walk = seq.slice(start), expected = btnsOrder.slice(0, walk.length);
    assert(JSON.stringify(walk) === JSON.stringify(expected),
      "ArrowDown 沿候选 DOM 序逐项推进、不跳项（期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(walk) + "）");
    await pressEnter();
    await waitFor(`!document.querySelector(".assoc-picker")`, "Enter 选中后浮层关闭", 6000);
    await waitPersist(SNAP_TASK, "branchId", BR_CORE, "键盘选 core");
    pass("键盘 Enter 选中 core → 服务端持久化");
    /* Escape 关闭 */
    await openPicker("branch");
    await pressEscape();
    await waitFor(`!document.querySelector(".assoc-picker")`, "Escape 关闭", 6000);
    pass("Escape 关闭浮层（不保存）");
    const afterEsc = await apiTask(SNAP_TASK);
    assert(afterEsc.branchId === BR_CORE, "Escape 未改动关联（仍为 core）");
    /* 复位 ui */
    await openPicker("branch");
    await pickOption(BR_UI);
    await waitPersist(SNAP_TASK, "branchId", BR_UI, "键盘批后复位 ui");
    pass("分支复位为 ui");
  });

  /* ===================== L 候选状态标签与清除项图标 ===================== */
  await section("[L] 版本候选彩色状态标签（含锁定行）+ 需求/分支清除项 ⊘ 图标", async () => {
    await relTab();
    await openVerPicker();
    const chips = await verChipInfo();
    assert(chips.length >= 2, "版本候选至少两条（实际 " + chips.length + "）");
    const noTag = chips.filter(c => c.n !== 1 || !c.text);
    assert(noTag.length === 0, "每条版本候选都带且只带一个状态标签（缺失 " + JSON.stringify(noTag.map(c => c.title)) + "）");
    const ST = { planned:"计划中", active:"进行中", released:"已发布", closed:"已关闭", canceled:"已取消" };
    const badText = chips.filter(c => !ST[c.cls] || ST[c.cls] !== c.text);
    assert(badText.length === 0, "标签文案与状态口径一致（planned/active/released/closed/canceled）" +
      (badText.length ? "：" + JSON.stringify(badText) : ""));
    const locked = chips.filter(c => c.locked);
    assert(locked.length >= 1 && locked.every(c => c.n === 1 && !!c.text && c.hasLock && c.hasBox && c.selected),
      "锁定行同样列出状态标签 + 锁图标 + 勾选框（只读不等于隐藏信息）");
    const byCls = {};
    chips.forEach(c => { const k = c.bg + "|" + c.fg; (byCls[c.cls] = byCls[c.cls] || new Set()).add(k); });
    const palettes = Object.keys(byCls).map(k => [...byCls[k]][0]);
    assert(Object.keys(byCls).every(k => byCls[k].size === 1) && new Set(palettes).size === palettes.length,
      "同状态配色一致、不同状态底色/字色互不相同（" + Object.keys(byCls).join("/") + " → " + palettes.join(" ") + "）");
    const neutral = chips.filter(c => ["closed","canceled"].includes(c.cls));
    const lively = chips.filter(c => ["planned","active","released"].includes(c.cls));
    if(neutral.length && lively.length){
      assert(neutral.every(n => lively.every(l => n.bg !== l.bg)), "已关闭/已取消用中性灰，与在途状态明显区分");
    }
    await shot("l-version-status-chips");
    await verCancel();
    const afterChips = await apiTask(SNAP_TASK);
    assert(JSON.stringify(afterChips.versionIds) === JSON.stringify(orig.versionIds), "只看标签不改版本（取消后服务端不变）");
    /* 清除项：⊘ 图标块与候选行图标同尺寸 */
    for(const kind of ["demand", "branch"]){
      await openPicker(kind);
      const ci = await clearRowInfo();
      const label = kind === "demand" ? "不关联" : "未设置";
      assert(ci && ci.label === "" && ci.text.indexOf(label) === 0, kind + " 清除项文案「" + label + "」（实际 " + (ci && ci.text) + "）");
      assert(ci && ci.hasCi && ci.hasSvg, kind + " 清除项带 ⊘ 图标（不再是纯文字行）");
      assert(ci && ci.w === 20 && ci.h === 20 && ci.optW === 26,
        kind + " 清除项图标块 20×20，与候选行 26×26 图标块同族（实际 " + (ci && ci.w + "×" + ci.h + " / " + ci.optW) + "）");
      await shot("l-" + kind + "-clear-icon");
      /* 关闭浮层：优先真实 Escape。窄屏 emulation 往返后 CDP 偶发不把原始按键送到本页，
         先 bringToFront 复位输入焦点重试，仍不行才退到产品的「点浮层外关闭」路径，并如实记录用了哪条。 */
      await evaluate(`(() => { window.__keys = [];
        if(!window.__keyProbe){ window.__keyProbe = e => window.__keys.push(e.key); document.addEventListener("keydown", window.__keyProbe, true); }
        return true; })()`);
      await pressEscape();
      let closed = await popGone(3000), how = "Escape";
      if(!closed){
        console.log("  DIAG Escape 未关闭 " + JSON.stringify(await evaluate(`(() => { const a = document.activeElement;
          return { pops:document.querySelectorAll(".assoc-picker").length, hasFocus:document.hasFocus(), keys:window.__keys || [],
            ae:a ? (a.tagName + "." + a.className + "#" + a.id) : "(null)", frames:window.frames.length,
            open:[...document.querySelectorAll(".assoc-picker")].map(p => ({ cls:p.className, pop:!!p.__popOpen, hidden:p.hidden })) }; })()`)));
        await call("Page.bringToFront", {});
        await sleep(250);
        await pressEscape();
        closed = await popGone(3000); how = "Escape(bringToFront)";
        console.log("  DIAG bringToFront 后 keys=" + JSON.stringify(await evaluate(`window.__keys || []`)) + " 关闭=" + closed);
      }
      if(!closed){
        await evaluate(`document.dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, clientX:2, clientY:2 })); true`);
        closed = await popGone(3000); how = "浮层外点击";
        console.log("  DIAG 改走浮层外点击 关闭=" + closed);
      }
      if(!closed){
        await evaluate(`import("./js/core/ui.js").then(m => { m.UI.closeAllPops(); return true; })`);
        await sleep(300);
      }
      assert(closed, kind + " 浮层可关闭（不保存，路径：" + how + "）");
      if(how !== "Escape") console.log("  WARN " + kind + " 浮层 Escape 原始按键未送达，改用 " + how + "（Escape 覆盖见 [F]）");
    }
    const afterClear = await apiTask(SNAP_TASK);
    assert(afterClear.branchId === (orig.branchId||null) && afterClear.demandId === (orig.demandId||null),
      "只看清除项不改关联（关闭浮层后服务端不变）");
  });

  /* ===================== N 深色主题 ===================== */
  await section("[N] 深色主题：状态标签与清除项图标随令牌翻转（对照原型深色稿）", async () => {
    const theme0 = await evaluate(`document.documentElement.getAttribute("data-theme") || ""`);
    const setTheme = v => evaluate(v
      ? `document.documentElement.setAttribute("data-theme", ${JSON.stringify(v)}); true`
      : `document.documentElement.removeAttribute("data-theme"); true`);
    await setTheme("dark");
    await sleep(250);
    await relTab();
    await openVerPicker();
    const dark = await verChipInfo();
    const lum = s => { const m = String(s).match(/\d+(\.\d+)?/g) || ["0","0","0"]; const c = m.slice(0,3).map(Number);
      return (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]) / 255; };
    assert(dark.length >= 2 && dark.every(c => c.n === 1 && c.text), "深色下每条版本候选仍带状态标签");
    assert(new Set(dark.map(c => c.bg)).size === dark.length, "深色下不同状态底色仍互不相同");
    assert(dark.every(c => lum(c.bg) < 0.35 && lum(c.fg) > 0.55),
      "深色下标签深底亮字（走深色令牌，不是写死浅色）" + JSON.stringify(dark.map(c => [c.cls, c.bg, c.fg])));
    await shot("n-dark-version-chips");
    await verCancel();
    await openPicker("demand");
    const ci = await clearRowInfo();
    assert(ci && ci.hasCi && ci.hasSvg && ci.w === 20, "深色下清除项 ⊘ 图标仍在且尺寸不变");
    await shot("n-dark-demand-clear");
    await pressEscape();
    assert(await popGone(3000), "深色下浮层 Escape 仍可关闭");
    await evaluate(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]'); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const c = document.getElementById("fDeps"), h = document.getElementById("readAssocCard");
      return !!(c && h && h.contains(c) && c.offsetParent !== null); })()`, "深色下依赖卡就地展开", 6000);
    await sleep(300);
    await shot("n-dark-deps-inline");
    await evaluate(`(() => { const b = document.getElementById("btnDepInlineClose"); if(b) b.click(); return true; })()`);
    await sleep(250);
    await setTheme(theme0);
    await sleep(200);
    assert((await evaluate(`document.documentElement.getAttribute("data-theme") || ""`)) === theme0, "主题已复位（不影响后续批次）");
  });


  /* ===================== H 移动端底部浮层 ===================== */
  await section("[H] 移动端：窄屏底部浮层 as-sheet + 遮罩", async () => {
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    await evaluate(`document.getElementById("toastWrap") && (document.getElementById("toastWrap").innerHTML = ""); true`);
    await openDrawerRel(SNAP_TASK);
    await shot("h-mobile-assoc-card");
    await openPicker("branch");
    const sheet = await evaluate(`(() => { const p = document.querySelector(".assoc-picker");
      return { asSheet:!!(p && p.classList.contains("as-sheet")), scrim:!!document.querySelector(".pop-scrim"),
        bottom:p?p.style.bottom:"", width:p?p.style.width:"" }; })()`);
    assert(sheet.asSheet, "窄屏浮层贴底 as-sheet");
    assert(sheet.scrim, "窄屏出现 pop-scrim 遮罩");
    await shot("h-mobile-branch-sheet");
    await pickOption(BR_CORE);
    await waitPersist(SNAP_TASK, "branchId", BR_CORE, "移动端选 core");
    pass("移动端底部浮层选中 core → 持久化");
    await openPicker("branch");
    await pickOption(BR_UI);
    await waitPersist(SNAP_TASK, "branchId", BR_UI, "移动端复位 ui");
    /* A/C 批：版本多选浮层在窄屏同样贴底，勾选框与锁定行不被裁切 */
    await openVerPicker();
    const vSheet = await evaluate(`(() => { const p = document.querySelector(".ver-picker");
      const r = p.getBoundingClientRect(), foot = p.querySelector(".pp-foot-actions").getBoundingClientRect();
      const rows = [...p.querySelectorAll(".search-picker-option")];
      return { asSheet:p.classList.contains("as-sheet"), scrim:!!document.querySelector(".pop-scrim"),
        inView:r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        footInView:foot.bottom <= window.innerHeight + 1 && foot.height > 0,
        rowsFit:rows.every(b => b.scrollWidth <= b.clientWidth + 1), rows:rows.length }; })()`);
    assert(vSheet.asSheet && vSheet.scrim, "窄屏版本浮层贴底 as-sheet + 遮罩");
    assert(vSheet.inView && vSheet.footInView, "版本浮层与取消/保存底栏都在视口内（可点保存）");
    assert(vSheet.rows === 2 && vSheet.rowsFit, "窄屏版本候选完整显示且不横向溢出");
    await shot("h-mobile-version-sheet");
    await verCancel();
    await restoreDesktop();
    await nudgeInput();
    pass("移动端分支复位为 ui，恢复桌面视口");
  });

  /* ===================== G 只读（viewer） ===================== */
  await section("[G] 只读 viewer：无铅笔、值仍可跳转、编辑入口隐藏", async () => {
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/auth/logout", {})); true`);
    await sleep(300);
    const vWs = await login(VIEWER, PASS);
    assert(vWs === WS, "登录只读账号 " + VIEWER + "，空间支付业务部");
    await evaluate(`import("./js/core/router.js").then(r => r.showView("list")); true`);
    await sleep(400);
    await openDrawerRel(SNAP_TASK);
    const ro = await evaluate(`import("./js/core/state.js").then(s => s.rt.drawerReadOnly)`);
    assert(ro === true, "viewer 阅读态 drawerReadOnly=true");
    const pencils = await evaluate(`document.querySelectorAll("#readAssoc .assoc-edit").length`);
    assert(pencils === 0, "只读态关联行无铅笔（共 " + pencils + " 个）");
    const d = await rowInfo("demand"), b = await rowInfo("branch");
    assert(d && d.jumpId === DM_PDF && !d.hasPencil, "只读态需求值仍可跳转(PDF)，无铅笔");
    assert(b && b.jumpId === BR_UI && !b.hasPencil, "只读态分支值仍可跳转(ui)，无铅笔");
    const editHidden = await evaluate(`(document.getElementById("btnDrawerEdit")||{}).hidden`);
    assert(editHidden === true, "只读态「编辑」按钮隐藏");
    /* A 批：版本 / 项目 / 依赖行同样无铅笔，值仍可读可跳 */
    const roRows = await evaluate(`(() => { const q = s => document.querySelector("#readAssoc " + s);
      const verDD = q('[data-jump-version]') ? q('[data-jump-version]').closest("dd") : null;
      const projLink = q(".assoc-link[data-jump-project]");
      const dep = q('[data-ev-goto="deps"]');
      return { verLinks:document.querySelectorAll("#readAssoc [data-jump-version]").length,
        verPencil:verDD ? !!verDD.querySelector(".assoc-edit") : null,
        projJump:projLink?projLink.getAttribute("data-jump-project"):null,
        projPencil:projLink?!!projLink.closest("dd").querySelector(".assoc-edit"):null,
        depText:dep?dep.textContent.trim():null,
        depPencil:dep?!!dep.closest("dd").querySelector(".assoc-edit"):null }; })()`);
    assert(roRows.verLinks >= 1 && roRows.verPencil === false, "只读态版本值仍显示可跳转，无版本铅笔");
    assert(roRows.projJump === PROJ && roRows.projPencil === false, "只读态项目值仍可跳转，无项目铅笔");
    assert(roRows.depText === "暂无依赖" && roRows.depPencil === false, "只读态依赖汇总仍可读，无依赖铅笔");
    await shot("g-readonly-assoc-card");
    /* B 批：只读态来源卡保留信息、隐藏「移除关联」（来源卡就在关联页签） */
    const srcRo = await evaluate(`(() => { const box = document.getElementById("drawerSource"), rm = document.getElementById("drawerSourceRemove");
      return { box:!!(box && !box.hidden && box.offsetParent !== null), rmHidden:rm?rm.hidden:null,
        rmVisible:!!(rm && rm.offsetParent !== null),
        title:(document.getElementById("drawerSourceTitle")||{}).textContent || "" }; })()`);
    assert(srcRo.box && /PDF/.test(srcRo.title), "只读态来源卡仍展示需求来源信息（" + srcRo.title + "）");
    assert(srcRo.rmHidden === true && !srcRo.rmVisible, "只读态「移除关联」按钮已隐藏（不再是按不动的按钮）");
    await shot("g-readonly-source-card");
    /* 只读态点值仍能跳转 */
    await evaluate(`(() => { const l = document.querySelector('#readAssoc .ev-link[data-ev-branch]'); if(l) l.click(); return true; })()`);
    let landed = false;
    try{ await waitFor(`!!(document.getElementById("branchDrawer") && document.getElementById("branchDrawer").classList.contains("on"))`, "只读分支抽屉", 10000); landed = true; }catch(e){}
    assert(landed, "只读态点分支值仍打开分支抽屉");
    await closeOverlays();
  });

  /* ===================== I 所属项目就地编辑 ===================== */
  let fixtureId = "";
  await section("[I] 所属项目：已发布早退拦截 + 干净工作项换项目并复位", async () => {
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/auth/logout", {})); true`);
    await sleep(300);
    await login(USER, PASS);
    await evaluate(`import("./js/core/router.js").then(r => r.showView("list")); true`);
    await sleep(400);
    /* I1 已生产发布的工作项：点铅笔即给出原因，不打开菜单、不发起必失败的保存 */
    await openDrawerRel(SNAP_TASK);
    await evaluate(`document.getElementById("toastWrap") && (document.getElementById("toastWrap").innerHTML = ""); true`);
    await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]'); if(b) b.click(); return true; })()`);
    await sleep(450);
    const guardToast = await toastText();
    assert(/正式发布记录.*不能改变项目/.test(guardToast), "已发布工作项点项目铅笔 → 提示「已有正式发布记录，不能改变项目」（" + guardToast.trim().slice(0, 40) + "）");
    const noMenu = await evaluate(`!document.querySelector(".menu-item[data-fact-req]") && !document.querySelector(".assoc-picker")`);
    assert(noMenu, "早退拦截不打开项目菜单，也不进入保存流程");
    const guardRo = await evaluate(`import("./js/core/state.js").then(s => ({ dirty:s.rt.formDirty, req:document.getElementById("iReq").value }))`);
    assert(guardRo.req === PROJ && guardRo.dirty === false, "拦截后表单项目未改、未置脏（不会留下假未保存态）");
    const guardSrv = await apiTask(SNAP_TASK);
    assert(guardSrv.reqId === PROJ, "拦截后服务端项目不变");
    await shot("i-project-guard-toast");
    await closeDrawer();
    /* I1b 宽口径：只有测试 / 回滚记录、从未生产发布的工作项，后端一样拒绝换项目（selectTaskRecordIdsForScope 口径），
       前端要提前拦住。这两个是演示库现成样本，不新建数据；读态没有任何生产徽标，窄口径 everPublished 拦不住。 */
    for(const g of [{ id:GUARD_TEST, name:"测试环境部署", re:/测试 · 部署/, shot:"i-guard-test-record" },
                    { id:GUARD_ROLLBACK, name:"生产回滚", re:/生产 · 回滚/, shot:"i-guard-rollback-record" }]){
      await openDrawerRel(g.id);
      const recText = await waitFor(`(() => { const b = document.getElementById("taskReleaseRecords");
        return b && /正式发布历史/.test(b.textContent) ? b.textContent.replace(/\\s+/g, " ").slice(0, 120) : null; })()`,
        "交付记录就绪（" + g.name + "）", 12000);
      assert(g.re.test(recText), "样本确有「" + g.name + "」发布记录（" + recText.slice(0, 44) + "…）");
      const badge = await evaluate(`((document.getElementById("taskPublishedBadge")||{}).textContent || "").trim()`);
      assert(badge === "", "读态没有任何生产发布徽标（everPublished 窄口径拦不住，正是宽口径要覆盖的情形）");
      await evaluate(`document.getElementById("toastWrap") && (document.getElementById("toastWrap").innerHTML = ""); true`);
      await watchTaskPuts();
      await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]'); if(b) b.click(); return true; })()`);
      await sleep(450);
      const gToast = await toastText();
      assert(/正式发布记录.*不能改变项目/.test(gToast), "只有" + g.name + "记录也提前拦截，文案与后端一致（" + gToast.trim().slice(0, 32) + "）");
      const gNoMenu = await evaluate(`!document.querySelector(".menu-item[data-fact-req]") && !document.querySelector(".assoc-picker")`);
      assert(gNoMenu, "拦截不打开项目菜单（" + g.name + "）");
      const gPuts = await unwatchTaskPuts();
      assert(gPuts === 0, "一个必失败的保存请求都没发（整单 PUT 次数 " + gPuts + "）");
      const gForm = await evaluate(`import("./js/core/state.js").then(s => ({ dirty:s.rt.formDirty, req:document.getElementById("iReq").value }))`);
      assert(gForm.req === PROJ && gForm.dirty === false, "拦截后表单项目未改、未置脏（" + g.name + "）");
      const gSrv = await apiTask(g.id);
      assert(gSrv.reqId === PROJ, "服务端项目未被改动（" + g.name + "）");
      await shot(g.shot);
      await closeDrawer();
    }
    /* I2 自建干净工作项（跑完删除，含历史残留清扫） */
    const seed = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      try{
        const old = await API.get("/api/tasks/list", { reqId:${JSON.stringify(PROJ)}, limit:200, sort:"updated" });
        for(const t of ((old && old.items) || [])){
          if((t.title || "").indexOf(${JSON.stringify(FIXTURE_PREFIX)}) === 0) await API.del("/api/tasks/" + encodeURIComponent(t.id)).catch(() => {});
        }
      }catch(e){}
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const t = await API.post("/api/tasks", { reqId:${JSON.stringify(PROJ)}, title:${JSON.stringify(FIXTURE_PREFIX + " ")} + stamp,
        priority:"P2", itemType:"task", versionIds:[${JSON.stringify(V_OPEN)}] });
      return { id:t.id, title:t.title };
    })()`);
    fixtureId = seed && seed.id;
    assert(!!fixtureId, "自建 E2E 工作项成功（" + (seed && seed.title) + "）");
    const fxOrig = await apiTask(fixtureId);
    assert(fxOrig.reqId === PROJ && JSON.stringify(fxOrig.versionIds) === JSON.stringify([V_OPEN]) && !fxOrig.demandId && !fxOrig.branchId && !fxOrig.epicId,
      "自建工作项初始：本项目 + v3.2，无需求/分支/史诗（换项目无连带解绑）");
    await openDrawerRel(fixtureId);
    /* I3 换项目：菜单 → 确认 → 版本重载 → 保存 */
    await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".menu-item[data-fact-req]")`, "项目菜单打开", 8000);
    await sleep(350);
    const menu = await evaluate(`[...document.querySelectorAll(".menu-item[data-fact-req]")].map(b => ({ id:b.getAttribute("data-fact-req"), text:b.textContent.trim(), cur:!!b.querySelector(".k") }))`);
    assert(menu.length >= 3 && menu.some(m => m.id === PROJ && m.cur), "项目菜单列出可写项目并标注「当前」");
    assert(menu.some(m => m.id === PROJ_ALT), "菜单包含目标项目「统一支付网关」");
    await shot("i-project-menu");
    await evaluate(`(() => { const b = document.querySelector('.menu-item[data-fact-req="${PROJ_ALT}"]'); if(b) b.click(); return true; })()`);
    const cmsg = await confirmOk();
    assert(/重载分类、计划版本与负责人候选/.test(cmsg), "换项目前二次确认并说明连带重载（" + cmsg.slice(0, 30) + "…）");
    await fillPromptIfAsked("E2E：换项目导致计划版本清空");
    await waitPersist(fixtureId, "reqId", PROJ_ALT, "换项目 → 统一支付网关");
    pass("换项目后服务端 reqId 持久化为目标项目");
    const afterMove = await evaluate(`(() => { const link = document.querySelector("#readAssoc .assoc-link[data-jump-project]");
      const dd = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="version"]').closest("dd");
      return { jump:link?link.getAttribute("data-jump-project"):null, text:link?link.textContent.trim():"",
        verText:dd.textContent.trim(), verEmpty:!!dd.querySelector(".ev-empty"),
        hasPencil:!!document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]') }; })()`);
    assert(afterMove.jump === PROJ_ALT && /统一支付网关/.test(afterMove.text), "关联卡项目值即时更新为目标项目，仍可跳转");
    assert(afterMove.verEmpty && /待规划/.test(afterMove.verText), "原项目版本随换项目解除，版本行回落「待规划」");
    assert(afterMove.hasPencil, "换项目后铅笔仍在，可继续改");
    await shot("i-project-after-move");
    /* I4 复位回原项目 */
    await evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="project"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".menu-item[data-fact-req]")`, "项目菜单再次打开", 8000);
    await evaluate(`(() => { const b = document.querySelector('.menu-item[data-fact-req="${PROJ}"]'); if(b) b.click(); return true; })()`);
    await confirmOk();
    await fillPromptIfAsked("E2E：换回原项目");
    await waitPersist(fixtureId, "reqId", PROJ, "换项目复位");
    pass("项目复位为清结算与对账平台");
  });

  /* ===================== K 计划版本全部取消 → 待规划 ===================== */
  await section("[K] 计划版本：重新加选 → 全部取消 → 待规划 → 复位", async () => {
    if(!fixtureId) throw new Error("缺少自建工作项，跳过");
    await openDrawerRel(fixtureId);
    const addBack = async label => {
      await openVerPicker();
      assert(/已选 0 项/.test(await verCount()), label + "：打开时已选 0 项");
      await verToggle(V_OPEN);
      await verSave();
      await fillPromptIfAsked("E2E：" + label);
      await waitPersist(fixtureId, "versionIds", [V_OPEN], label);
    };
    await addBack("换项目后重新加选 v3.2");
    pass("换回原项目后可重新加选 v3.2 并持久化");
    const one = await evaluate(`document.querySelectorAll('#readAssoc [data-jump-version]').length`);
    assert(one === 1, "关联卡显示一条可跳转版本");
    /* 全部取消 → 待规划 */
    await openVerPicker();
    await verToggle(V_OPEN);
    assert(/已选 0 项/.test(await verCount()), "取消唯一版本 → 已选 0 项");
    await shot("k-version-all-cleared");
    await verSave();
    await fillPromptIfAsked("E2E：计划版本全部取消，回到待规划");
    await waitPersist(fixtureId, "versionIds", [], "版本全部取消");
    pass("全部取消后服务端 versionIds=[]");
    const planned = await evaluate(`(() => { const dd = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="version"]').closest("dd");
      return { empty:!!dd.querySelector(".ev-empty"), text:dd.textContent.trim(),
        links:dd.querySelectorAll("[data-jump-version]").length,
        hasPencil:!!dd.querySelector('.assoc-edit[data-assoc-edit="version"]') }; })()`);
    assert(planned.empty && planned.text === "待规划" && planned.links === 0, "版本行回落占位「待规划」，无死链");
    assert(planned.hasPencil, "待规划状态下铅笔仍在，可直接规划版本");
    await shot("k-version-planned-empty");
    await addBack("待规划后重新规划 v3.2");
    pass("版本复位为 v3.2");
  });

  /* ===================== J 依赖卡内就地编辑 ===================== */
  await section("[J] 依赖：卡内展开 → 类型/滞后即时生效 → 卡内浮层加前置 → 汇总同步 → 收起归位 → 删除复位", async () => {
    await closeDrawer();
    await openDrawerRel(SNAP_TASK);
    /* 依赖汇总走独立请求，先等它落到终态再断言，避免读到加载中的占位 */
    try{
      await waitFor(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]');
        return b && /暂无依赖|前置 \\d/.test(b.textContent) ? b.textContent.trim() : null; })()`, "依赖汇总就绪", 8000);
    }catch(e){}
    let dep = await depRowInfo();
    assert(dep && dep.text === "暂无依赖", "起始汇总「暂无依赖」");
    let st = await depInlineInfo();
    assert(st.inExec && st.execLast && !st.inAssoc && !st.inlineCls && st.expanded === "false",
      "未展开时依赖卡在执行页最后一张，铅笔 aria-expanded=false");
    const clickDepVal = () => evaluate(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]'); if(b) b.click(); return true; })()`);
    const clickDepPencil = () => evaluate(`(() => { const b = document.querySelector('#readAssoc .assoc-edit[data-assoc-edit="deps"]'); if(b) b.click(); return true; })()`);
    const waitInline = async () => {
      await waitFor(`(() => { const c = document.getElementById("fDeps"), h = document.getElementById("readAssocCard");
        return !!(c && h && h.contains(c) && c.offsetParent !== null); })()`, "依赖卡搬进关联卡", 6000);
      await sleep(320);
    };
    /* J1 点「值」= 就地展开（不再跳执行页） */
    await clickDepVal();
    await waitInline();
    st = await depInlineInfo();
    assert(st.inAssoc && st.inlineCls && st.visible, "点依赖值 → 依赖卡就地展开在关联卡内（搬同一份 DOM，不复刻）");
    assert(st.relTab === "true" && st.relPane && !st.execPane, "仍停在关联页签，没有跳执行页");
    assert(st.closeBtn && st.expanded === "true", "卡头出现「收起」按钮，铅笔 aria-expanded=true");
    assert(!st.pickerOpen, "点值只展开，不自动弹添加浮层");
    assert(/修改立即生效并同步甘特图/.test(st.foot), "卡内页脚说明即时生效并同步甘特（" + st.foot.slice(0, 22) + "…）");
    await shot("j-deps-inline-card");
    /* J2 添加浮层就在卡内 */
    await evaluate(`(() => { const b = document.getElementById("btnDepAddPred"); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("depPicker"); return !!(p && !p.hidden); })()`, "卡内添加浮层打开", 6000);
    await sleep(300);
    st = await depInlineInfo();
    assert(st.pickerOpen && st.pickerInAssoc && st.inAssoc && st.relTab === "true", "添加浮层就在关联卡内，页签与卡片都不动");
    const pickTitle = await evaluate(`(document.getElementById("depPickerTitle")||{}).textContent || ""`);
    assert(pickTitle === "添加前置任务", "浮层标题「添加前置任务」（实际 " + pickTitle + "）");
    /* 浮层要整体落在抽屉可视区：卡内展开时靠 alignOnce 对齐一次 */
    const rectExpr = `(() => { const p = document.getElementById("depPicker"), body = document.getElementById("drawerBody");
      if(!p || !body) return null; const r = p.getBoundingClientRect(), b = body.getBoundingClientRect();
      return { top:Math.round(r.top), bottom:Math.round(r.bottom), bodyTop:Math.round(b.top), bodyBottom:Math.round(b.bottom),
        fits:r.top >= b.top - 1 && r.bottom <= b.bottom + 1 }; })()`;
    let pickRect = null;
    try{ pickRect = await waitFor(`(() => { const r = ${rectExpr}; return r && r.fits ? r : null; })()`, "浮层滚入可视区", 4000); }
    catch(e){ pickRect = await evaluate(rectExpr); }
    assert(pickRect && pickRect.fits, "卡内添加浮层完整落在抽屉可视区（无需手动滚动）" + JSON.stringify(pickRect));
    await shot("j-deps-inline-picker");
    /* J3 选前置 → 即时生效，汇总在同一页签内联动 */
    await evaluate(`(() => { const i = document.getElementById("iDepSearch");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, "报表导出异步化");
      i.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await waitFor(`(() => { const b = document.querySelector('#depPickerList .dep-opt[data-dep-opt="${DEP_PEER}"]');
      return !!(b && !b.disabled && b.offsetParent !== null); })()`, "前置候选就绪且可见", 10000);
    await sleep(250);
    await evaluate(`(() => { const b = document.querySelector('#depPickerList .dep-opt[data-dep-opt="${DEP_PEER}"]'); if(b) b.click(); return true; })()`);
    await waitDeps(1, "新增前置");
    pass("卡内选中前置 → 依赖即时落库（不走整单保存）");
    st = await depInlineInfo();
    assert(st.inAssoc && st.relTab === "true" && !st.pickerOpen, "新增后仍留在关联卡内，浮层自动收起");
    dep = await depRowInfo();
    assert(dep.text === "前置 1 · 后置 0", "同页签内汇总即时联动为「前置 1 · 后置 0」（实际 " + dep.text + "）");
    let row = await depRowState();
    assert(row.n === 1 && /报表导出异步化/.test(row.title) && row.del, "卡内前置列表出现该依赖并可删除");
    assert(row.type === "FS" && row.lag === "0" && row.typeLocked === false && row.lagLocked === false,
      "新依赖默认 FS / 滞后 0，类型与滞后都可就地改");
    await shot("j-deps-summary-linked");
    /* J4 类型 / 滞后：即时落库，且不置脏主表单 */
    await setDepType("SS");
    const e1 = await waitDepField("depType", "SS", "类型改 SS");
    pass("卡内改依赖类型 → 即时落库（FS → SS）");
    await setDepLag(2);
    const e2 = await waitDepField("lagDays", 2, "滞后改 2");
    pass("卡内改滞后天数 → 即时落库（0 → 2 天）");
    assert(e1.id === e2.id, "改类型与改滞后作用于同一条依赖，没有多建连线");
    row = await depRowState();
    assert(row.type === "SS" && row.lag === "2" && /滞后 2 天/.test(row.meta),
      "卡内控件与行摘要同步为 SS / 滞后 2 天（实际 " + row.type + " / " + row.meta + "）");
    const dirtyAfterDep = await evaluate(`import("./js/core/state.js").then(s => s.rt.formDirty)`);
    assert(dirtyAfterDep === false, "类型/滞后属即时保存，不置脏主表单（不会误弹「放弃改动」）");
    await shot("j-deps-type-lag");
    /* 排期冲突：口径与甘特主页面一致（GS.depConflict）——前驱已完成不算冲突 */
    const depDates = await evaluate(`import("./js/core/api.js").then(m => Promise.all([
      m.API.get("/api/task/${SNAP_TASK}?probe=" + Date.now()), m.API.get("/api/task/${DEP_PEER}?probe=" + Date.now())
    ])).then(a => ({ cur:{ s:a[0].startDate||"", e:a[0].dueDate||"" }, peer:{ s:a[1].startDate||"", e:a[1].dueDate||"" },
      peerDone:a[1].boardColumn === "done",
      both:!!((a[0].startDate||a[0].dueDate) && (a[1].startDate||a[1].dueDate)) }))`);
    if(!depDates.both){
      console.log("  SKIP 排期冲突断言：依赖两端缺日期 " + JSON.stringify(depDates));
    }else{
      await setDepLag(365);
      await waitDepField("lagDays", 365, "滞后推至 365");
      row = await depRowState();
      if(depDates.peerDone){
        assert(!row.bad && !row.alert && row.badRows === 0,
          "前驱已完成 → 按甘特主页面口径不计排期冲突（滞后 365 天也不误报）");
      }else{
        assert(row.bad && row.alert && row.badRows === 1, "滞后推到 365 天 → 行内「排期冲突」+ 卡内冲突提示条即时出现");
        await shot("j-deps-conflict");
      }
      await setDepLag(2);
      await waitDepField("lagDays", 2, "滞后复位 2");
      row = await depRowState();
      assert(row.alert === (row.badRows > 0), "滞后复位后冲突提示条与行内标记一致（重算，不残留旧提示）");
    }
    /* J5 收起：搬回执行页原位 + 焦点回铅笔 */
    await evaluate(`(() => { const b = document.getElementById("btnDepInlineClose"); if(b) b.click(); return true; })()`);
    await sleep(350);
    st = await depInlineInfo();
    assert(st.inExec && st.execLast && !st.inAssoc && !st.inlineCls && !st.closeBtn,
      "「收起」把依赖卡搬回执行页原位（仍是最后一张，外框样式还原）");
    assert(st.expanded === "false" && !st.pickerOpen, "收起后铅笔 aria-expanded=false，添加浮层一并关闭");
    const focusBack = await evaluate(`(() => { const a = document.activeElement;
      return !!(a && a.matches && a.matches('#readAssoc .assoc-edit[data-assoc-edit="deps"]')); })()`);
    assert(focusBack, "收起后焦点回到依赖铅笔（键盘不丢焦点）");
    /* J6 铅笔是同一个开合入口 */
    await clickDepPencil();
    await waitInline();
    st = await depInlineInfo();
    assert(st.inAssoc && st.expanded === "true", "点铅笔展开卡内依赖编辑");
    await clickDepPencil();
    await sleep(320);
    st = await depInlineInfo();
    assert(!st.inAssoc && st.inExec && st.expanded === "false", "再点铅笔收起（同一入口开合，不重复搬卡）");
    /* J7 切页签自动归位 */
    await clickDepPencil();
    await waitInline();
    await evaluate(`(() => { const b = document.querySelector('[data-drawer-tab="exec"]'); if(b) b.click(); return true; })()`);
    await sleep(400);
    st = await depInlineInfo();
    assert(st.inExec && st.execLast && !st.inlineCls && st.execPane && st.visible,
      "切到执行页 → 依赖卡自动归位并可见（不会留在关联卡里）");
    await relTab();
    st = await depInlineInfo();
    assert(!st.inAssoc && st.expanded === "false", "回到关联页铅笔为收起态，ARIA 与 DOM 一致");
    /* J8 卡内删除 + 撤销提示 + 汇总复位 */
    await clickDepVal();
    await waitInline();
    await evaluate(`(() => { const b = document.querySelector("#depPredList [data-dep-del]"); if(b) b.click(); return true; })()`);
    await waitDeps(0, "删除前置");
    pass("卡内删除依赖即时落库");
    dep = await depRowInfo();
    assert(dep.text === "暂无依赖", "删除后同页汇总回到「暂无依赖」（实际 " + dep.text + "）");
    const undo = await toastText();
    assert(/已删除与/.test(undo) && /撤销/.test(undo), "删除给出可撤销提示（" + undo.trim().slice(0, 30) + "…）");
    await shot("j-deps-summary-reset");
    /* J9 窄屏：卡内编辑与浮层都不溢出 */
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(400);
    st = await depInlineInfo();
    assert(st.inAssoc && !st.overflow, "390 窄屏下卡内依赖编辑不横向溢出");
    await evaluate(`(() => { const b = document.getElementById("btnDepAddPred"); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("depPicker"); return !!(p && !p.hidden); })()`, "窄屏卡内浮层打开", 6000);
    await sleep(400);
    const mRect = await evaluate(rectExpr);
    assert(mRect && mRect.fits, "窄屏卡内添加浮层仍完整落在抽屉可视区 " + JSON.stringify(mRect));
    await shot("j-deps-mobile-inline");
    await evaluate(`(() => { const b = document.getElementById("depPickerClose"); if(b) b.click(); return true; })()`);
    await sleep(200);
    await restoreDesktop();
    await nudgeInput();
    await evaluate(`(() => { const b = document.getElementById("btnDepInlineClose"); if(b) b.click(); return true; })()`);
    await sleep(300);
    st = await depInlineInfo();
    assert(st.inExec && st.execLast && !st.inlineCls, "窄屏往返后依赖卡仍归位执行页，DOM 没有重复");
    const cardCount = await evaluate(`document.querySelectorAll("#fDeps").length + "/" + document.querySelectorAll("#depPredList").length`);
    assert(cardCount === "1/1", "全程只有一张依赖卡与一份前置列表（搬移而非克隆）：" + cardCount);
  });

  /* ===================== M 就地保存失败回滚 ===================== */
  await section("[M] 保存失败：读态卡片回滚到服务器值 + 诚实报错 + 回到原页签", async () => {
    await relTab();
    const before = await apiTask(SNAP_TASK);
    assert(before.branchId === BR_UI, "前置：分支为原始 ui（实际 " + before.branchId + "）");
    /* 依赖卡展开 + 有一条连线时再失败：回滚不该把用户正在看的卡收掉（对照原型 desktop-fail-rollback） */
    await evaluate(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]'); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const c = document.getElementById("fDeps"), h = document.getElementById("readAssocCard");
      return !!(c && h && h.contains(c) && c.offsetParent !== null); })()`, "M 前置：依赖卡展开", 6000);
    await evaluate(`(() => { const b = document.getElementById("btnDepAddPred"); if(b) b.click(); return true; })()`);
    await waitFor(`(() => { const p = document.getElementById("depPicker"); return !!(p && !p.hidden); })()`, "M 前置：添加浮层打开", 6000);
    /* 候选默认只取最近更新的 12 条，跑到这里目标任务已不在窗口内，按真实操作先搜再选 */
    await evaluate(`(() => { const i = document.getElementById("iDepSearch");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, "报表导出异步化");
      i.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
    await waitFor(`(() => { const b = document.querySelector('#depPickerList .dep-opt[data-dep-opt="${DEP_PEER}"]');
      return !!(b && !b.disabled && b.offsetParent !== null); })()`, "M 前置：前置候选就绪", 10000);
    await evaluate(`(() => { const b = document.querySelector('#depPickerList .dep-opt[data-dep-opt="${DEP_PEER}"]'); if(b) b.click(); return true; })()`);
    await waitDeps(1, "M 前置：加一条前置");
    await evaluate(`(() => { const b = document.getElementById("drawerBody"); if(b) b.scrollTop = 120; return true; })()`);
    await sleep(150);
    const patched = await failTaskPuts();
    assert(patched, "注入 PUT /api/tasks 失败（模拟断网，只影响保存请求）");
    await openPicker("branch");
    await pickOption(BR_CORE);
    await waitFor(`window.__failedPuts >= 1`, "保存请求已被拦下", 8000);
    /* 读态卡片必须回到服务器上的值，而不是停在没落库的新值 */
    let back = null;
    try{
      back = await waitFor(`(() => { const l = document.querySelector('#readAssoc .ev-link[data-ev-branch]');
        return l && l.getAttribute("data-ev-branch") === ${JSON.stringify(BR_UI)} ? l.textContent.trim() : null; })()`,
        "关联卡回滚为服务器分支", 12000);
    }catch(e){ back = await evaluate(`(() => { const l = document.querySelector('#readAssoc .ev-link[data-ev-branch]'); return l ? l.textContent.trim() : "(无)"; })()`); }
    assert(/settle-v3\.2-ui/.test(back || ""), "保存失败后关联卡显示服务器上的 ui 分支，没停在未落库的 core（实际 " + back + "）");
    const errToast = (await takeBad()).join(" | ");
    assert(/网络异常/.test(errToast), "给出诚实的网络失败提示（" + errToast.slice(0, 40) + "）");
    assert(!/已更新所属分支/.test(await toastText()), "失败时不再弹「已更新」成功提示");
    /* 回填走 openTaskDrawer：先回读态（页签先归概览），60ms 后恢复原页签，滚动位置随异步内容撑开重试到位 */
    const viewExpr = `(() => { const t = document.querySelector('[data-drawer-tab="rel"]'), p = document.getElementById("paneRel");
      const b = document.getElementById("drawerBody");
      return { tab:t?t.getAttribute("aria-selected"):"", pane:!!(p && !p.hidden), scroll:b?Math.round(b.scrollTop):-1 }; })()`;
    let viewBack = null;
    try{
      viewBack = await waitFor(`(() => { const v = ${viewExpr}; return v.tab === "true" && v.pane && v.scroll > 0 ? v : null; })()`,
        "回滚后回到关联页签与原滚动位置", 8000);
    }catch(e){ viewBack = await evaluate(viewExpr); }
    assert(viewBack.tab === "true" && viewBack.pane, "失败回滚后仍回到「关联」页签，不把用户甩回概览");
    assert(viewBack.scroll > 0, "回滚后恢复到原滚动位置附近（scrollTop=" + viewBack.scroll + "）");
    const depBack = await depInlineInfo();
    assert(depBack.inAssoc && depBack.visible && depBack.expanded === "true" && depBack.closeBtn,
      "失败回滚后依赖卡仍展开在关联卡内（重填不收起，铅笔 ARIA 一致）");
    const rowBack = await depRowState();
    assert(rowBack.n === 1, "回滚后卡内前置连线仍在（不丢用户正在看的内容，实际 " + rowBack.n + " 条）");
    await shot("m-fail-rollback-deps-open");
    const formBack = await evaluate(`import("./js/core/state.js").then(s => ({ dirty:s.rt.formDirty,
      branch:document.getElementById("iBranch").value, saving:document.getElementById("btnSaveTaskContinue").disabled }))`);
    assert(formBack.branch === BR_UI, "隐藏表单同步回填为 ui（下次保存不会带上没落库的 core）");
    assert(formBack.dirty === false, "回滚后不留假未保存态（formDirty=false）");
    assert(formBack.saving === false, "保存按钮解除 loading，可继续操作");
    const attempts = await restoreFetch();
    assert(attempts === 1, "失败只尝试一次，没有重试风暴（PUT 次数 " + attempts + "）");
    const srv = await apiTask(SNAP_TASK);
    assert(srv.branchId === BR_UI, "服务端分支从未被改动（仍为 ui）");
    await shot("m-fail-rollback");
    /* 恢复网络后同一入口仍可正常保存 */
    await openPicker("branch");
    await pickOption(BR_CORE);
    await waitPersist(SNAP_TASK, "branchId", BR_CORE, "恢复后选 core");
    pass("恢复网络后同一铅笔仍可正常保存（失败没有卡死入口）");
    await openPicker("branch");
    await pickOption(BR_UI);
    await waitPersist(SNAP_TASK, "branchId", BR_UI, "失败批后复位 ui");
    pass("分支复位为 ui");
    const depAfterOk = await depInlineInfo();
    assert(depAfterOk.inAssoc && depAfterOk.expanded === "true", "成功保存的重填同样保持依赖卡展开");
    await evaluate(`(() => { const b = document.querySelector("#depPredList [data-dep-del]"); if(b) b.click(); return true; })()`);
    await waitDeps(0, "M 收尾删除前置");
    await evaluate(`(() => { const b = document.getElementById("btnDepInlineClose"); if(b) b.click(); return true; })()`);
    await sleep(250);
    const depReset = await depInlineInfo();
    assert(depReset.inExec && depReset.execLast && depReset.expanded === "false", "M 收尾依赖卡归位执行页（不影响收尾复位断言）");
    await drainBad();
  });

  /* ===================== O 跨项目只读依赖端点（可逆样本） ===================== */
  await section("[O] 跨项目只读端点：行内锁定 + 候选禁选 + 服务端同样拒绝（样本跑完还原）", async () => {
    await closeDrawer();
    const sample = { depId:null, prevAccess:null, granted:false };
    try{
      /* 演示库里没有「本项目可写 + 对端只读」的成员，造一个可逆样本：
         admin 建一条 风控 → 清结算 的连线，再把 zhoumin 对清结算的 read 临时改成 write。
         他对当前任务可写（抽屉可编辑）、对对端只读，正好落在 editable=false 这条路径上；跑完两步都还原。 */
      sample.prevAccess = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/workspaces/${WS}/project-access?probe=" + Date.now()))
        .then(pa => { const g = (pa.grants||[]).filter(x => x.userId === ${JSON.stringify(HALF_UID)} && x.projectId === ${JSON.stringify(PROJ)})[0];
          return g ? g.access : null; })`);
      assert(sample.prevAccess === "read", "前置：zhoumin 对清结算项目原本只读（实际 " + sample.prevAccess + "），跑完按此值还原");
      const dep = await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/gantt/deps",
        { fromTaskId:${JSON.stringify(PEER_RISK)}, toTaskId:${JSON.stringify(SNAP_TASK)}, depType:"FS", lagDays:0 }))
        .then(d => ({ id:d.id, from:d.fromTaskId, to:d.toTaskId })).catch(e => ({ err:e.message||String(e) }))`);
      sample.depId = (dep && dep.id) || null;
      assert(!!sample.depId, "admin 建跨项目前置连线成功（风控 → 清结算）" + JSON.stringify(dep));
      await evaluate(`import("./js/core/api.js").then(m => m.API.put("/api/workspaces/${WS}/project-access",
        { userId:${JSON.stringify(HALF_UID)}, projectId:${JSON.stringify(PROJ)}, access:"write" }))`);
      sample.granted = true;
      pass("临时把 zhoumin 对清结算项目改为可写（只改这一格，跑完还原）");

      await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/auth/logout", {})); true`);
      await sleep(300);
      const hWs = await login(HALF_USER, PASS);
      assert(hWs === WS, "登录半权限账号 " + HALF_USER + "（清结算可写 / 风控只读）");
      await evaluate(`import("./js/core/router.js").then(r => r.showView("list")); true`);
      await sleep(400);
      await openDrawerRel(SNAP_TASK);
      const hRo = await evaluate(`import("./js/core/state.js").then(s => s.rt.drawerReadOnly)`);
      assert(hRo === false, "当前任务可写：抽屉不是整体只读（锁定来自依赖端点，不是整单只读）");
      const hPencils = await evaluate(`document.querySelectorAll("#readAssoc .assoc-edit").length`);
      assert(hPencils > 0, "本项目可写：关联行铅笔仍在（共 " + hPencils + " 个）");
      const hDep = await depRowInfo();
      assert(hDep && /前置 1/.test(hDep.text), "依赖汇总读得到跨项目前置（实际 " + (hDep && hDep.text) + "）");
      await evaluate(`(() => { const b = document.querySelector('#readAssoc [data-ev-goto="deps"]'); if(b) b.click(); return true; })()`);
      await waitFor(`(() => { const c = document.getElementById("fDeps"), h = document.getElementById("readAssocCard");
        return !!(c && h && h.contains(c) && c.offsetParent !== null); })()`, "O 依赖卡展开", 6000);
      await sleep(350);
      const lock = await depLockInfo();
      assert(lock && lock.chip === "只读", "只读端点在行内标「只读」（实际 " + (lock && lock.chip) + "）");
      assert(lock && lock.typeLocked === true && lock.lagLocked === true, "类型与滞后都禁用，改不动只读项目的连线");
      assert(lock && lock.typeMark === "1" && lock.lagMark === "1", "带 data-dep-locked=1（恢复可编辑时不会误放开这一行）");
      assert(lock && lock.del === false, "只读端点不给删除入口");
      assert(lock && lock.openId === PEER_RISK && /规则版本灰度发布/.test(lock.title), "对端标题仍是可跳转按钮（只读不是死路）");
      assert(lock && /风控规则引擎/.test(lock.meta), "行副标题标出对端所在项目（实际 " + (lock && lock.meta) + "）");
      await shot("o-cross-project-readonly-dep");

      /* 端点契约 + 绕过界面直接写：服务端按两端项目权限同样拒绝 */
      const edge = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/${SNAP_TASK}/dependencies?probe=" + Date.now()))
        .then(a => (a||[]).map(e => ({ id:e.id, editable:!!e.editable, depType:e.depType, from:e.from&&e.from.id, to:e.to&&e.to.id })))`);
      assert(edge.length === 1 && edge[0].editable === false, "端点按两端项目权限给出 editable=false（" + JSON.stringify(edge) + "）");
      EXPECT_DENIALS.push(new RegExp("/api/gantt/deps/" + sample.depId + "(\\?|$)"));
      denialBudget++;
      const denied = await evaluate(`import("./js/core/api.js").then(m => m.API.put("/api/gantt/deps/" + ${JSON.stringify(sample.depId)}, { depType:"SS" }))
        .then(() => ({ ok:true })).catch(e => ({ ok:false, code:e.code||null, msg:e.message||String(e) }))`);
      assert(!denied.ok && denied.code === 403 && /只有查看权限/.test(denied.msg || ""), "绕过界面直接 PUT 也被服务端拒绝（" + JSON.stringify(denied) + "）");
      const stillFS = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/${SNAP_TASK}/dependencies?probe=" + Date.now()))
        .then(a => (a||[]).map(e => e.depType)[0])`);
      assert(stillFS === "FS", "被拒后服务端依赖类型未变（仍 FS）");

      /* 候选浮层：只读项目禁选并告警色标注，本项目候选照常可选 */
      await evaluate(`(() => { const b = document.getElementById("btnDepAddPred"); if(b) b.click(); return true; })()`);
      await waitFor(`(() => { const p = document.getElementById("depPicker"); return !!(p && !p.hidden); })()`, "O 添加浮层打开", 6000);
      const searchDep = async q => {
        await evaluate(`(() => { const i = document.getElementById("iDepSearch");
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(q)});
          i.dispatchEvent(new Event("input", { bubbles:true })); return true; })()`);
        await sleep(450);
      };
      const optOf = id => `(() => { const b = document.querySelector('#depPickerList .dep-opt[data-dep-opt="${id}"]');
        return b ? { disabled:b.disabled, state:(b.querySelector(".dep-opt-state")||{}).textContent||"", bad:!!b.querySelector(".dep-opt-state.bad") } : null; })()`;
      await searchDep("决策流可视化编排");
      const roOpt = await waitFor(optOf(PEER_RISK2), "O 只读项目候选就绪", 10000);
      assert(roOpt.disabled === true && roOpt.state === "只读项目" && roOpt.bad, "只读项目候选禁选 + 告警色标注（" + JSON.stringify(roOpt) + "）");
      await shot("o-cross-project-readonly-picker");
      await searchDep("报表导出异步化");
      const okOpt = await waitFor(optOf(DEP_PEER), "O 本项目候选就绪", 10000);
      assert(okOpt.disabled === false && okOpt.state === "添加", "本项目候选仍可选（锁定按项目生效，不是整张卡锁死）" + JSON.stringify(okOpt));
      await evaluate(`(() => { const b = document.getElementById("depPickerClose"); if(b) b.click(); return true; })()`);
      await sleep(250);

      /* 只读对端仍能打开详情，按只读态呈现 */
      await evaluate(`(() => { const b = document.querySelector("#depPredList [data-dep-open]"); if(b) b.click(); return true; })()`);
      await waitFor(`import("./js/core/state.js").then(s => s.rt.editingId === ${JSON.stringify(PEER_RISK)})`, "跳到只读对端详情", 10000);
      const peerRo = await evaluate(`import("./js/core/state.js").then(s => s.rt.drawerReadOnly)`);
      assert(peerRo === true, "对端详情按只读打开（风控项目只读）");
      await shot("o-cross-project-peer-readonly");
      await closeDrawer();
    } finally {
      /* 样本必须还原：删连线 + 授权改回原值；断言抛错也要跑完 */
      try{
        await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/auth/logout", {})); true`);
        await sleep(300);
        await login(USER, PASS);
        if(sample.depId){
          const del = await evaluate(`import("./js/core/api.js").then(m => m.API.del("/api/gantt/deps/" + ${JSON.stringify(sample.depId)}))
            .then(() => ({ ok:true })).catch(e => ({ ok:false, msg:e.message||String(e) }))`);
          assert(del.ok, "样本连线已删除（" + JSON.stringify(del) + "）");
        }
        if(sample.granted){
          const back = await evaluate(`(async () => {
            const { API } = await import("./js/core/api.js");
            try{
              await API.put("/api/workspaces/${WS}/project-access",
                { userId:${JSON.stringify(HALF_UID)}, projectId:${JSON.stringify(PROJ)}, access:${JSON.stringify(sample.prevAccess || "default")} });
              const pa = await API.get("/api/workspaces/${WS}/project-access?probe=" + Date.now());
              const g = (pa.grants||[]).filter(x => x.userId === ${JSON.stringify(HALF_UID)} && x.projectId === ${JSON.stringify(PROJ)})[0];
              return g ? g.access : null;
            }catch(e){ return "还原失败:" + (e.message||String(e)); }
          })()`);
          assert(back === sample.prevAccess, "zhoumin 对清结算项目的授权已还原为 " + sample.prevAccess + "（实际 " + back + "）");
        }
        const finDeps = await apiDeps();
        assert(finDeps.length === 0, "SNAP_TASK 依赖回到 0 条（不影响收尾复位断言）");
      }catch(e){ console.log("  WARN 样本还原异常：" + e.message + "（需手工核对 zhoumin 授权与 SNAP_TASK 依赖）"); }
      await drainBad();
    }
  });

  /* ===================== 收尾 ===================== */
  console.log("\n[收尾] 控制台 / 网络 / 复位");
  await sleep(400);
  assert(cdp.errors.length === 0, "控制台零报错" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 6).join(" | ") : ""));
  assert(cdp.netErrors.length === 0, "无 4xx/5xx 网络错误（已知环境缺口与登记的越权探针除外）" + (cdp.netErrors.length ? "：" + cdp.netErrors.slice(0, 6).join(" | ") : ""));
  /* 越权探针：只允许发生在登记过的样本 URL 上，且次数与登记数一致（O 段故意被拒一次） */
  assert(cdp.denials.length === denialBudget, "越权探针按预期被服务端拒绝（记录 " + cdp.denials.length + " 次 / 登记 " + denialBudget + " 次）" +
    (cdp.denials.length ? "：" + cdp.denials.join(" | ") : ""));
  /* 资源级报错逐条归因：带 URL 的必须是已知缺口或登记探针，不带 URL 的条数不能超过两者次数 */
  const resWithUrl = cdp.resourceErrors.filter(t => /https?:\/\//.test(t));
  const resUnknown = resWithUrl.filter(t => !isKnownGap(t));
  const resNoUrl = cdp.resourceErrors.length - resWithUrl.length;
  assert(resUnknown.length === 0 && resNoUrl <= cdp.knownGaps.length + cdp.denials.length,
    "资源加载报错全部归因到已知环境缺口或登记探针（未知 " + resUnknown.length + "，无 URL " + resNoUrl + " / 缺口 " + cdp.knownGaps.length + " + 探针 " + cdp.denials.length + "）" +
    (resUnknown.length ? "：" + resUnknown.slice(0, 4).join(" | ") : ""));
  if(cdp.knownGaps.length) console.log("  环境缺口（非本次改动）：预览前端调用了运行 jar 里尚未打包的接口 → " +
    [...new Set(cdp.knownGaps.map(s => s.split(" ")[1].replace(/^https?:\/\/[^/]+/, "")))].join("、") + "（共 " + cdp.knownGaps.length + " 次）");
  /* 复位 SNAP_TASK 到原始关联（脚本内已复位，这里再确认一次） */
  try{
    await login(USER, PASS);
    const fin = await apiTask(SNAP_TASK);
    assert(fin.branchId === (orig.branchId||null) && fin.demandId === (orig.demandId||null),
      "SNAP_TASK 关联已复位原始（branch=" + fin.branchId + ", demand=" + fin.demandId + "）");
    assert(JSON.stringify(fin.versionIds) === JSON.stringify(orig.versionIds),
      "SNAP_TASK 计划版本已复位原始（" + JSON.stringify(fin.versionIds) + "）");
    assert(fin.reqId === orig.reqId, "SNAP_TASK 所属项目未被改动");
    const finDeps = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/tasks/${SNAP_TASK}/dependencies")).then(a => (a||[]).length)`);
    assert(finDeps === 0, "SNAP_TASK 依赖已清空复位（" + finDeps + " 条）");
    if(fixtureId){
      const delRes = await evaluate(`import("./js/core/api.js").then(m => m.API.del("/api/tasks/" + encodeURIComponent(${JSON.stringify(fixtureId)})))
        .then(() => ({ ok:true })).catch(e => ({ ok:false, err:e.message||String(e), code:e.code||null }))`);
      const gone = await evaluate(`import("./js/core/api.js").then(m => m.API.get("/api/task/" + ${JSON.stringify(fixtureId)} + "?probe=" + Date.now()))
        .then(t => ({ deletedAt:(t&&t.deletedAt)||null, title:(t&&t.title)||"" })).catch(e => ({ err:e.message||String(e), code:e.code||null }))`);
      assert(delRes.ok && !!(gone.deletedAt || gone.code === 404),
        "自建 E2E 工作项已删除（不留残留）del=" + JSON.stringify(delRes) + " read=" + JSON.stringify(gone));
    }
  }catch(e){ console.log("  WARN 复位确认失败：" + e.message + "（运行后可 DB 兜底复位）"); }
  await drainBad();
  assert(BAD_TOASTS.length === 0, "无红色错误 toast（用户可见报错）" + (BAD_TOASTS.length ? "：" + BAD_TOASTS.slice(0, 6).join(" | ") : ""));

  console.log("\n截图：" + SHOTS.length + " 张");
  SHOTS.forEach(s => console.log("  " + s));
  console.log("\n结果：" + (failed === 0 ? "全部通过" : failed + " 项失败"));
  await call("Browser.close").catch(() => {});
  ws.close();
  proc.kill();
  process.exit(failed === 0 ? 0 : 1);
}catch(err){
  console.error("E2E 运行异常：" + (err && err.stack || err));
  try{ proc.kill(); }catch(e){}
  process.exit(2);
}