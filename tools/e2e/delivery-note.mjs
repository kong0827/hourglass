/* 一页式交付说明 E2E（真实 ESM 应用，非预览稿；仿 tools/e2e/tree-view.mjs 的原生 CDP 骨架）
   覆盖：懒加载入口、纸张渲染、控制区实时生效、数字口径抽屉、逐段确认、
   导出冻结快照、只读分享与接收人页一致性、客户版闸门、打印口径（原生 Ctrl+P / 按钮 / 深色 / 甘特 A3 不被抢）、移动端与控制台。

   前置：本地栈已起（bash deploy/local/stack.sh start），SQL 81 已应用。
   数据：RICH=有成功生产发布+承诺基线的版本（当前演示数据没有测试计划，通过率断言自动核对「未创建计划」空态）；
        DRAFT=有回归但无生产发布的版本（有测试计划，通过率断言核对真实百分比）。
       页数估算按真实 PDF 校准，风险展开入口按数据是否超 6 项决定，演示数据换批不会让断言失效。
   用法：node tools/e2e/delivery-note.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/* 只看 MediaBox 会让空白页通过：这里把内容流解出来数文字绘制与字体，空白页两者都是 0 */
function pdfStats(buf){
  const latin = buf.toString("latin1");
  const sizes = [...latin.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)]
    .map(m => [Math.round(Number(m[1])), Math.round(Number(m[2]))]);
  const fonts = (latin.match(/\/Type\s*\/Font\b/g) || []).length;
  let textOps = 0;
  const re = /stream\r?\n/g; let m;
  while((m = re.exec(latin))){
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if(end < 0) continue;
    let out = null;
    try{ out = zlib.inflateSync(buf.subarray(start, end)); }catch(e){ continue; }
    textOps += (out.toString("latin1").match(/\bT[Jj]\b/g) || []).length;
  }
  return { sizes: [...new Set(sizes.map(s => s.join("x")))], pages: sizes.length, fonts, textOps, bytes: buf.length };
}

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const WS = process.env.E2E_WS || "Smw9zctt2grh4x4j1";
const RICH = process.env.E2E_RICH_VERSION || "Vt6s11v3u8x2wiaaqigey";
const DRAFT_WS = process.env.E2E_DRAFT_WS || "Smw9zcftmwwnrwuon";
const DRAFT = process.env.E2E_DRAFT_VERSION || "Vj7w80cq65lq98n2dg8b6";
const SHOTS = process.env.E2E_SHOTS || "/tmp/delivery-note-e2e";

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

const chrome = findChrome();
const port = Number(process.env.E2E_CDP_PORT || 9233);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dl-note-e2e-"));
fs.mkdirSync(SHOTS, { recursive: true });
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

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

  async function newTab(url){
    const t = await cdp.send("Target.createTarget", { url: url || "about:blank" });
    const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
    const call = (m, p) => cdp.send(m, p, sid);
    const evaluate = async expr => {
      const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expr, label, timeout = 15000) => {
      const deadline = Date.now() + timeout; let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
    };
    const shot = async (name, full) => {
      const r = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full });
      const out = path.join(SHOTS, name + ".png");
      fs.writeFileSync(out, Buffer.from(r.data, "base64"));
      return out;
    };
    const printPdf = async name => {
      const r = await call("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const buf = Buffer.from(r.data, "base64");
      fs.writeFileSync(path.join(SHOTS, name + ".pdf"), buf);
      return pdfStats(buf);
    };
    /* 打印期间宿主必须已挂好、且只含只读投影；afterprint 之后必须彻底还原 */
    const watchPrint = () => evaluate(`(() => {
      window.__dlPrintSeen = null;
      window.addEventListener("beforeprint", function(){
        const h = document.getElementById("dlPrintHost");
        window.__dlPrintSeen = {
          host: !!h, marker: document.documentElement.getAttribute("data-dl-print"),
          theme: document.documentElement.getAttribute("data-theme"),
          chars: h ? h.textContent.replace(/\\s+/g, " ").trim().length : 0,
          secs: h ? h.querySelectorAll(".dl-sec").length : 0,
          chrome: h ? h.querySelectorAll(".dl-narr-bar,.dl-doc-tools,.dl-more-row").length : 0,
          ink: h ? getComputedStyle(h.querySelector(".dl-sheet")).color : "",
          paper: h ? getComputedStyle(h.querySelector(".dl-sheet")).backgroundColor : ""
        };
      });
      return true;
    })()`);
    const printCleanup = () => evaluate(`JSON.stringify({
      host: !!document.getElementById("dlPrintHost"),
      marker: document.documentElement.getAttribute("data-dl-print"),
      theme: document.documentElement.getAttribute("data-theme")
    })`).then(s => JSON.parse(s));
    return { targetId: t.targetId, sid, call, evaluate, waitFor, shot, printPdf, watchPrint, printCleanup };
  }

  /* 切空间只改服务端 lastWorkspaceId，应用必须整页重载才会重新取当前空间（同 mine.js 的切换流程）。
     先走 about:blank 再落目标地址，避免只改 hash 变成同文档跳转、以及 navigate 与 reload 相互抢跑。 */
  async function hardOpen(url){
    await call("Page.navigate", { url: "about:blank" });
    await sleep(150);
    await call("Page.navigate", { url });
    await sleep(150);
  }

  const app = await newTab();
  const { call, evaluate, waitFor, shot, printPdf, watchPrint, printCleanup } = app;
  await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: SHOTS, eventsEnabled: true });

  console.log("一页式交付说明 E2E\n  地址：" + BASE + "\n  截图：" + SHOTS);

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
  try{
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  await evaluate(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${WS}/select", {})).then(() => true)`);
  await hardOpen(BASE + "/#/delivery");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录 " + USER + " 并切到空间 " + WS);

  /* ---------- 1. 懒加载与路由归属 ---------- */
  await waitFor(`document.body.dataset.view === "delivery"`, "进入交付说明视图", 20000);
  const navOwn = await evaluate(`(() => {
    const on = document.querySelector(".sidebar .nav-item.on, .sidebar a.on, .sidebar .on");
    return { view: document.body.dataset.view, nav: on ? on.textContent.trim() : "", title: document.title };
  })()`);
  assert(navOwn.view === "delivery", "路由落在 delivery（标题：" + navOwn.title + "）");

  /* ---------- 2. 选版器 ---------- */
  await waitFor(`document.querySelectorAll("#dlPickerList [data-dl-open]").length > 0`, "选版器渲染", 20000);
  const picker = await evaluate(`(() => ({
    rows: document.querySelectorAll("#dlPickerList [data-dl-open]").length,
    groups: document.querySelectorAll("#dlPickerList .dl-modgroup").length,
    search: !!document.getElementById("dlPickerQuery")
  }))()`);
  assert(picker.rows > 0 && picker.search, `选版器列出 ${picker.rows} 个版本 / ${picker.groups} 个项目，含搜索`);
  await evaluate(`(() => {
    const el = document.getElementById("dlPickerQuery");
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "商家结算");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const filtered = await evaluate(`document.querySelectorAll("#dlPickerList [data-dl-open]").length`);
  assert(filtered > 0 && filtered < picker.rows, `搜索过滤生效（${picker.rows} → ${filtered}）`);

  /* ---------- 3. 工作台：富路径纸张 ---------- */
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(RICH)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sheet .dl-sec").length > 3`, "纸张渲染", 25000);
  await waitFor(`!!document.querySelector(".dl-rail")`, "控制区渲染");
  const railLoaded = await waitFor(`performance.getEntriesByType("resource").filter(r => /lib\\/delivery-doc\\.js/.test(r.name)).length`, "渲染器加载记录", 10000);
  const inShell = await evaluate(`[...document.querySelectorAll("script[src]")].filter(s => /delivery/.test(s.src)).length`);
  assert(railLoaded > 0 && inShell === 0, `纸张渲染器按需加载（首屏 script 标签 ${inShell} 个，运行时拉取 ${railLoaded} 次）`);
  const sheet = await evaluate(`(() => {
    const secs = [...document.querySelectorAll("#dlSheetHost .dl-sec")].map(s => (s.querySelector("h2") || {}).textContent || "");
    const rail = document.querySelector(".dl-rail");
    return {
      secs, secCount: secs.length,
      controls: rail.querySelectorAll("select,input[type=range],input[type=checkbox],button[data-dl-val],input[type=text],textarea").length,
      railVisible: rail.getBoundingClientRect().width > 100,
      metrics: document.querySelectorAll("#dlSheetHost .dl-metric").length,
      navBtns: document.querySelectorAll("#dlSecnav button").length,
      pages: (document.getElementById("dlMeterPages") || {}).textContent,
      pending: (document.getElementById("dlMeterPending") || {}).textContent
    };
  })()`);
  assert(sheet.railVisible && sheet.controls >= 7, `控制区常驻且含 ${sheet.controls} 个可调控件`);
  assert(sheet.secCount >= 10 && sheet.navBtns === sheet.secCount, `纸张 ${sheet.secCount} 个区块，区块导航一一对应`);
  assert(sheet.metrics > 0, `摘要指标可点（${sheet.metrics} 个）`);
  for(const need of ["交付摘要", "交付范围", "变更说明", "质量与验证", "缺陷与已知问题", "发布与运行信息", "后续计划与风险", "验收与结论"]){
    assert(sheet.secs.some(s => s.indexOf(need) >= 0), "含区块「" + need + "」");
  }
  console.log("  区块：" + sheet.secs.join(" / "));

  /* 3a2. 区块导航溢出必须有可见线索：11 节在 1440 排不下，不能裁掉又不给滚动条。
     macOS 原生滚动条静止时不可见（占位 0px），所以这里验的是自绘轨道 + 滑块 + 翻页按钮。 */
  const navOver = await evaluate(`(() => {
    const nav = document.getElementById("dlSecnav"), bar = document.getElementById("dlSecbar");
    const rail = document.getElementById("dlSecrail"), thumb = rail.firstChild;
    const steps = [...bar.querySelectorAll("[data-dl-navstep]")];
    const rr = rail.getBoundingClientRect(), tr = thumb.getBoundingClientRect();
    return {
      over: nav.scrollWidth - nav.clientWidth,
      barOver: bar.dataset.overflow, moreL: bar.dataset.moreLeft, moreR: bar.dataset.moreRight,
      railShown: getComputedStyle(rail).display !== "none" && rr.height >= 4,
      thumbRatio: tr.width / rr.width, viewRatio: nav.clientWidth / nav.scrollWidth,
      thumbX: Math.round(tr.left - rr.left), thumbColor: getComputedStyle(thumb).backgroundColor,
      trackColor: getComputedStyle(rail).backgroundColor,
      stepsShown: steps.filter(s => s.getClientRects().length > 0).length,
      leftDisabled: steps[0].disabled, rightDisabled: steps[1].disabled,
      barSticky: getComputedStyle(bar).position
    };
  })()`);
  assert(navOver.over > 2 && navOver.barOver === "1", `区块导航溢出 ${navOver.over}px 被标记出来`);
  assert(navOver.railShown && Math.abs(navOver.thumbRatio - navOver.viewRatio) < 0.06,
    `自绘滚动条静止可见，滑块长度 ${navOver.thumbRatio.toFixed(2)} 与可视比例 ${navOver.viewRatio.toFixed(2)} 一致`);
  assert(navOver.thumbX <= 2 && navOver.thumbColor !== navOver.trackColor,
    "滑块停在轨道起点且与轨道底色可区分");
  assert(navOver.stepsShown === 2 && navOver.leftDisabled && !navOver.rightDisabled,
    "两端翻页按钮可见，起点处左箭头置灰、右箭头可用");
  assert(navOver.moreR === "1" && navOver.moreL === "0", "右侧渐隐提示后面还有区块");
  assert(navOver.barSticky === "sticky", "区块导航条吸顶");
  await evaluate(`document.querySelector('[data-dl-navstep="1"]').click(); true`);
  await waitFor(`document.getElementById("dlSecnav").scrollLeft > 20`, "导航右翻", 6000);
  const navPaged = await evaluate(`(() => {
    const bar = document.getElementById("dlSecbar"), steps = [...bar.querySelectorAll("[data-dl-navstep]")];
    const rail = document.getElementById("dlSecrail");
    return { left: document.getElementById("dlSecnav").scrollLeft, moreL: bar.dataset.moreLeft,
      leftDisabled: steps[0].disabled,
      thumbX: Math.round(rail.firstChild.getBoundingClientRect().left - rail.getBoundingClientRect().left) };
  })()`);
  assert(navPaged.left > 20 && navPaged.moreL === "1" && !navPaged.leftDisabled && navPaged.thumbX > 2,
    `右翻 ${Math.round(navPaged.left)}px 后左箭头启用、左侧渐隐出现、滑块右移 ${navPaged.thumbX}px`);
  await evaluate(`document.querySelector('[data-dl-navstep="-1"]').click(); true`);
  await waitFor(`document.getElementById("dlSecnav").scrollLeft < 3 && document.querySelector('[data-dl-navstep="-1"]').disabled`, "导航左翻复位", 6000);
  assert(await evaluate(`document.querySelector('[data-dl-navstep="-1"]').disabled`), "回到起点后左箭头重新置灰");
  /* 拖滑块到最右：真实指针事件，验 1:1 跟随与松手后监听器不残留 */
  const railBox = await evaluate(`(() => {
    const r = document.getElementById("dlSecrail"), t = r.firstChild;
    const rb = r.getBoundingClientRect(), tb = t.getBoundingClientRect();
    return { x: Math.round(tb.left + tb.width / 2), y: Math.round(tb.top + tb.height / 2),
      right: Math.round(rb.right), track: r.clientWidth };
  })()`);
  const mouse = (type, x, y, extra) => call("Input.dispatchMouseEvent",
    Object.assign({ type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }, extra || {}));
  await mouse("mousePressed", railBox.x, railBox.y);
  await mouse("mouseMoved", railBox.x + 60, railBox.y);
  await mouse("mouseMoved", railBox.right, railBox.y);
  const dragged = await evaluate(`(() => {
    const nav = document.getElementById("dlSecnav"), rail = document.getElementById("dlSecrail");
    return { left: Math.round(nav.scrollLeft), over: nav.scrollWidth - nav.clientWidth,
      dragging: rail.classList.contains("drag"), behavior: nav.style.scrollBehavior };
  })()`);
  await mouse("mouseReleased", railBox.right, railBox.y);
  assert(dragged.dragging && dragged.behavior === "auto" && dragged.left >= dragged.over - 3,
    `拖动滑块 1:1 跟随到末端（${dragged.left}/${dragged.over}px），拖动期间关闭平滑滚动`);
  const dropped = await evaluate(`(() => {
    const nav = document.getElementById("dlSecnav"), rail = document.getElementById("dlSecrail");
    return { dragging: rail.classList.contains("drag"), behavior: nav.style.scrollBehavior,
      moreR: document.getElementById("dlSecbar").dataset.moreRight,
      rightDisabled: document.querySelector('[data-dl-navstep="1"]').disabled };
  })()`);
  assert(!dropped.dragging && dropped.behavior === "" && dropped.moreR === "0" && dropped.rightDisabled,
    "松手后恢复平滑滚动、拖动态清除、右端箭头置灰");
  await mouse("mouseMoved", railBox.x, railBox.y, { buttons: 0 });
  assert(await evaluate(`Math.round(document.getElementById("dlSecnav").scrollLeft) >= ${dragged.over - 3}`),
    "松手后移动指针不再带动导航（监听器已解绑）");
  await evaluate(`document.getElementById("dlSecnav").scrollLeft = 0; true`);
  await sleep(500);
  /* 跳到最后一节：末节比视口短，滚到底也要高亮它，且 chip 自动进入横向视野 */
  await evaluate(`(() => { const b = [...document.querySelectorAll("#dlSecnav [data-dl-jump]")]; b[b.length-1].click(); return true; })()`);
  await waitFor(`(() => { const b = document.querySelector('#dlSecnav [aria-current="true"]'); return b && b === [...document.querySelectorAll("#dlSecnav [data-dl-jump]")].pop(); })()`,
    "末节高亮", 12000);
  await sleep(700);
  const navActive = await evaluate(`(() => {
    const nav = document.getElementById("dlSecnav"), b = nav.querySelector('[aria-current="true"]');
    const nr = nav.getBoundingClientRect(), br = b.getBoundingClientRect();
    const sc = document.getElementById("view-delivery");
    return { inside: br.left >= nr.left - 1 && br.right <= nr.right + 1, text: b.textContent.trim(),
      scrollLeft: nav.scrollLeft, atBottom: sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4 };
  })()`);
  assert(navActive.inside && navActive.scrollLeft > 20,
    `滚到「${navActive.text}」时高亮 chip 自动进入视野（scrollLeft=${Math.round(navActive.scrollLeft)}）`);
  assert(navActive.atBottom, "末节短于视口时滚到底仍高亮末节（滚动定位不谎报所在节）");
  const jumpTop = await evaluate(`(() => {
    const b = document.querySelector('#dlSecnav [aria-current="true"]');
    const sec = document.getElementById("dl-sec-" + b.dataset.dlJump);
    const bar = document.getElementById("dlSecbar");
    return { gap: sec.getBoundingClientRect().top - bar.getBoundingClientRect().bottom };
  })()`);
  assert(jumpTop.gap >= -2, `跳转后标题不被吸顶导航遮挡（间距 ${Math.round(jumpTop.gap)}px）`);
  await evaluate(`document.getElementById("view-delivery").scrollTop = 0; true`);
  await sleep(500);

  /* 3b. 本轮修复：变更台账不泄露动作码，标签非空 */
  const ledger = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("#dlSheetHost .dl-led")];
    return rows.map(r => ({
      title: (r.querySelector(".dl-led-t") || {}).textContent || "",
      tags: [...r.querySelectorAll(".dl-led-m .dl-chip")].map(c => c.textContent.trim()),
      who: (r.querySelector(".dl-led-w") || {}).textContent || ""
    }));
  })()`);
  const rawCodes = /^(create|update|release|release_plan|release_success|release_failed|release_rollback|version_[a-z_]+|scope|start|close|cancel)$/;
  assert(ledger.length > 0, `变更台账 ${ledger.length} 条`);
  assert(ledger.every(x => !rawCodes.test(x.title.trim())), "变更标题无原始动作码（" + ledger.map(x => x.title).join(" | ") + "）");
  assert(ledger.every(x => x.tags.length > 0), "每条变更都有标签");
  assert(ledger.every(x => /版本日志 · [\u4e00-\u9fa5]/.test(x.who)), "来源用中文动作名，不露码");

  /* 3c. 风险表：按严重度排序、限量、同名缺陷带记录号 */
  const risks = await evaluate(`(() => {
    const sec = [...document.querySelectorAll("#dlSheetHost .dl-sec")].find(s => ((s.querySelector("h2")||{}).textContent||"").indexOf("后续计划与风险") >= 0);
    const rows = [...sec.querySelectorAll(".dl-row.body")];
    return {
      count: rows.length,
      tones: rows.map(r => (r.querySelector(".dl-badge") || {}).className || ""),
      ids: rows.map(r => (r.querySelector(".tt span") || {}).textContent || ""),
      titles: rows.map(r => (r.querySelector(".tt b") || {}).textContent || "")
    };
  })()`);
  assert(risks.count > 0 && risks.count <= 6, `风险表限量 ${risks.count} 行（上限 6）`);
  assert(risks.tones[0].indexOf("bad") >= 0, "阻塞验收项排在最前");
  assert(risks.ids.filter(Boolean).length > 0, "风险行带原始记录号（同名缺陷可区分）");

  /* 3d. 新增内容：发布计划窗口 + 回滚约定 + 签认栏 */
  const extra = await evaluate(`(() => {
    const plan = document.querySelector("#dlSheetHost .dl-plan");
    const sign = document.querySelector("#dlSheetHost .dl-signoff");
    return {
      plan: !!plan,
      planText: plan ? plan.textContent : "",
      signs: sign ? sign.querySelectorAll(".dl-sign").length : 0,
      signLines: sign ? sign.querySelectorAll(".sl").length : 0,
      signText: sign ? sign.textContent : ""
    };
  })()`);
  assert(extra.plan, "含「发布计划与窗口」区块");
  assert(extra.planText.indexOf("风险与回滚约定") >= 0, "计划里写下回滚约定原文");
  assert(extra.planText.indexOf("计划窗口") >= 0, "计划窗口可见");
  assert(extra.signs === 2 && extra.signLines === 4, `签认栏双方各签字+日期（${extra.signs} 方 / ${extra.signLines} 条留白）`);
  assert(extra.signText.indexOf("系统不代替签字") >= 0, "签认栏明确系统不代签");

  /* 3e. 验收条件：单段 flowing 文本 + 加粗需求名，不再是换行墙 */
  const conds = await evaluate(`(() => {
    const lists = [...document.querySelectorAll("#dlSheetHost .dl-condlist")];
    const box = lists[lists.length - 1];
    const items = [...box.querySelectorAll("li")];
    return {
      n: items.length,
      leads: items.filter(li => li.querySelector(".ct b")).length,
      newlines: items.filter(li => /\\n/.test(li.textContent)).length
    };
  })()`);
  assert(conds.n > 0 && conds.leads === conds.n, `验收条件 ${conds.n} 条均有加粗需求名`);
  assert(conds.newlines === 0, "验收条件已压成单段，无换行墙");

  /* 3f. 事实数字与口径 */
  /* 通过率不写死数字：取接口当前口径去核对渲染，演示数据换过一批也不会把断言拖成假的 */
  const facts = await evaluate(`import("./js/core/api.js").then(({API}) => API.get("/api/versions/${RICH}/delivery-note")).then(d => {
    const t = document.getElementById("dlSheetHost").textContent, q = d.quality || {};
    const rate = q.passRatePct == null ? null : Math.round(q.passRatePct * 10) / 10;
    return { missing: !!q.missing, rate: rate,
      hasRate: rate != null && t.indexOf(rate + "%") >= 0,
      hasDelay: /晚 1 天/.test(t), hasSkipped: t.indexOf("跳过（本次不适用，出分母）") >= 0,
      saysNoPlan: t.indexOf("未创建测试计划") >= 0 };
  })`);
  if (facts.missing) {
    assert(facts.saysNoPlan, "未创建测试计划时明说不显示通过率，不推断质量");
  } else {
    assert(facts.hasRate, `通过率与接口口径一致（${facts.rate}%）`);
    assert(facts.hasSkipped, "跳过项显式出分母");
  }
  assert(facts.hasDelay, "发布延迟按目标日计算（晚 1 天）");
  /* 对照原型截图前把上面导航测试留下的滚动位置复位，截到的才是冷加载首屏 */
  await evaluate(`(() => {
    const nav = document.getElementById("dlSecnav");
    nav.style.scrollBehavior = "auto"; nav.scrollLeft = 0; nav.style.scrollBehavior = "";
    document.getElementById("view-delivery").scrollTop = 0;
    return true;
  })()`);
  await sleep(250);
  await shot("01-workbench-1440", true);

  /* ---------- 4. 控制区实时生效（不重新取数） ---------- */
  /* 只数 GET：控制区改动会触发防抖自动保存（PUT），那是人工层落库，不是重新聚合事实 */
  await evaluate(`(() => {
    window.__dlGets = 0;
    if(!window.__dlHooked){
      window.__dlHooked = true;
      const of = window.fetch;
      window.fetch = function(input, init){
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        if(method === "GET" && /delivery-note/.test(url)) window.__dlGets++;
        return of.apply(this, arguments);
      };
    }
    return true;
  })()`);
  const clickOpt = async (act, val) => {
    await evaluate(`(() => {
      const b = document.querySelector('.dl-rail [data-dl-act="${act}"][data-dl-val="${val}"]');
      if(!b) throw new Error("找不到控件 ${act}=${val}");
      b.click(); return true;
    })()`);
    await sleep(250);
  };
  await clickOpt("tone", "internal");
  const internalOn = await evaluate(`(() => {
    const secs = [...document.querySelectorAll("#dlSheetHost .dl-sec h2")].map(h => h.textContent);
    return { internal: secs.some(s => s.indexOf("内部备注") >= 0), chip: document.querySelector(".dl-head .dl-chip.pri").textContent };
  })()`);
  assert(internalOn.internal && internalOn.chip.indexOf("内部") >= 0, "切内部版：出现内部备注区块");
  await clickOpt("tone", "customer");
  const customerOn = await evaluate(`[...document.querySelectorAll("#dlSheetHost .dl-sec h2")].every(h => h.textContent.indexOf("内部备注") < 0)`);
  assert(customerOn, "切客户版：内部备注立即消失");

  await clickOpt("gran", "items");
  const granItems = await evaluate(`document.querySelectorAll("#dlSheetHost .dl-rows .dl-row.body").length`);
  await clickOpt("gran", "brief");
  const granBrief = await evaluate(`document.querySelectorAll("#dlSheetHost .dl-rows .dl-row.body").length`);
  assert(granItems > granBrief, `粒度实时生效（逐条 ${granItems} 行 → 概览 ${granBrief} 行）`);
  await clickOpt("gran", "module");

  const effOff = await evaluate(`[...document.querySelectorAll("#dlSheetHost .dl-sec h2")].some(h => /投入/.test(h.textContent))`);
  await evaluate(`(() => { const c = document.querySelector('.dl-rail input[data-dl-opt="showEffort"]'); c.click(); return true; })()`);
  await sleep(300);
  const effOn = await evaluate(`[...document.querySelectorAll("#dlSheetHost .dl-sec h2")].some(h => /投入/.test(h.textContent))`);
  assert(effOff !== effOn, `投入区块开关实时生效（${effOff} → ${effOn}）`);

  const vb = async v => {
    await evaluate(`(() => {
      const r = document.querySelector('.dl-rail input[type=range][data-dl-verbosity]');
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(r), "value").set.call(r, "${v}");
      r.dispatchEvent(new Event("input", { bubbles: true }));
      r.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    return evaluate(`(document.querySelector('#dlSheetHost [data-dl-field="summary"]') || {}).textContent.length || 0`);
  };
  const len0 = await vb(0), len2 = await vb(2);
  assert(len2 > len0, `详略滑杆实时改写叙述（精简 ${len0} 字 → 详细 ${len2} 字）`);
  await vb(1);

  await clickOpt("density", "compact");
  const dense = await evaluate(`document.querySelector("#dlSheetHost .dl-sheet").className`);
  assert(/compact/.test(dense), "排版密度实时生效（" + dense + "）");
  await clickOpt("density", "cozy");

  /* 证据详细度：客户版永不下发内部证据，所以先在管理版下比 0 → 2，再验证客户版收得更紧 */
  await clickOpt("tone", "manager");
  await clickOpt("evidence", "0");
  const evBefore = await evaluate(`document.querySelectorAll("#dlSheetHost .dl-ev").length`);
  await clickOpt("evidence", "2");
  const evAfter = await evaluate(`document.querySelectorAll("#dlSheetHost .dl-ev").length`);
  assert(evAfter > evBefore, `证据密度实时生效（管理版 关键 ${evBefore} → 校验值 ${evAfter} 条）`);
  const evDigest = await evaluate(`document.getElementById("dlSheetHost").textContent.indexOf("SHA256") >= 0`);
  assert(evDigest, "校验值档位列出厂制品 SHA256");
  /* 管理版看得到机房主机键与计划编号，证明客户版是语气投影而不是数据丢失 */
  const mgrPlan = await evaluate(`(() => {
    const p = document.querySelector("#dlSheetHost .dl-plan");
    const rel = document.getElementById("dl-sec-release");
    return { targets: p ? p.textContent.indexOf("部署目标") >= 0 : false,
      hostKey: p ? /prod-[a-z]+-[a-z0-9]+|test-[a-z]+-[a-z0-9]+/.test(p.textContent) : false,
      planNo: p ? /计划 PL-\\d{3}/.test(p.textContent) : false,
      relTargets: rel ? rel.textContent.indexOf("部署目标") >= 0 : false,
      rid: !!document.querySelector("#dlSheetHost .dl-doc-meta .rid") };
  })()`);
  assert(mgrPlan.targets && mgrPlan.hostKey && mgrPlan.planNo && mgrPlan.relTargets && mgrPlan.rid,
    `管理版保留部署目标、主机键、计划编号与发布记录号（${JSON.stringify(mgrPlan)}）`);
  await clickOpt("tone", "customer");
  const evCust = await evaluate(`(() => ({
    n: document.querySelectorAll("#dlSheetHost .dl-ev").length,
    internal: [...document.querySelectorAll("#dlSheetHost .dl-ev .dl-chip")].filter(c => c.textContent.indexOf("内部") >= 0).length,
    digest: document.getElementById("dlSheetHost").textContent.indexOf("SHA256") >= 0
  }))()`);
  assert(evCust.n < evAfter && evCust.internal === 0 && !evCust.digest,
    `客户版收掉内部证据与校验值（${evAfter} → ${evCust.n} 条，内部标记 ${evCust.internal}，SHA256 ${evCust.digest}）`);
  /* 制品坐标与机房主机键在发布记录与发布计划两处都要收掉，不能只剥一处 */
  const custLeak = await evaluate(`(() => {
    const root = document.getElementById("dlSheetHost");
    const t = root.textContent;
    const rel = document.getElementById("dl-sec-release");
    return {
      hostKey: /prod-[a-z]+-[a-z0-9]+|test-[a-z]+-[a-z0-9]+/.test(t),
      artifact: t.indexOf("制品标识") >= 0,
      relTargets: rel ? rel.textContent.indexOf("部署目标") >= 0 : false,
      executor: t.indexOf("实际执行人") >= 0,
      planRef: /计划 PL-\\d{3}/.test(t),
      releaseRef: !!root.querySelector(".dl-doc-meta .rid")
    };
  })()`);
  assert(!custLeak.hostKey && !custLeak.artifact && !custLeak.relTargets && !custLeak.executor,
    `客户版不含机房主机键 / 制品标识 / 部署目标 / 实际执行人（${JSON.stringify(custLeak)}）`);
  assert(custLeak.planRef && custLeak.releaseRef, "客户版保留计划号与发布记录号，便于回查原始记录");
  const reqAfter = await evaluate(`window.__dlGets`);
  assert(reqAfter === 0, `控制区调整不重新取数（期间 GET delivery-note ${reqAfter} 次）`);

  await evaluate(`document.querySelector('.dl-rail [data-dl-act="lean"]').click(); true`);
  await sleep(350);
  const lean = await evaluate(`({ pages: Number(document.getElementById("dlMeterPages").textContent), secs: Number(document.getElementById("dlMeterSecs").textContent) })`);
  assert(lean.pages >= 1, `压到一页生效（页数估算 ${lean.pages}，区块 ${lean.secs}）`);
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="reset"]').click(); true`);
  await sleep(400);
  const reset = await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="customer"]').getAttribute("aria-pressed")`);
  assert(reset === "true", "重置默认回到客户版");

  /* ---------- 5. 数字口径抽屉 ---------- */
  await evaluate(`document.querySelector('#dlSheetHost .dl-metric[data-dl-src]').click(); true`);
  await waitFor(`!!document.querySelector(".modal-layer.open .dl-caliber")`, "口径抽屉打开", 8000);
  const src = await evaluate(`(() => {
    const l = document.querySelector(".modal-layer.open");
    return { title: (l.querySelector("h2")||{}).textContent, caliber: (l.querySelector(".dl-caliber")||{}).textContent,
      recs: l.querySelectorAll(".dl-srcrec").length, jump: !!l.querySelector("[data-dl-src-goto]") };
  })()`);
  assert(src.caliber && src.caliber.length > 8, "口径抽屉给出统计口径（" + src.title + "）");
  assert(src.recs > 0, `列出 ${src.recs} 条原始记录`);
  assert(src.jump, "编制人可从口径抽屉跳到原始记录");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(300);
  assert(await evaluate(`!document.querySelector(".modal-layer.open")`), "Esc 关闭口径抽屉");

  await evaluate(`document.querySelector('#dlSheetHost [data-dl-act="sources"]').click(); true`);
  await waitFor(`!!document.querySelector(".modal-layer.open")`, "来源总览打开", 8000);
  const overview = await evaluate(`document.querySelector(".modal-layer.open").textContent`);
  assert(overview.indexOf("version_release_plan") >= 0, "来源总览含发布计划表");
  assert(overview.indexOf("version_release_item") >= 0, "来源总览含发布快照表");
  await evaluate(`document.querySelector(".modal-layer.open [data-dl-close]").click(); true`);
  await sleep(250);

  /* ---------- 6. 逐段确认 → 导出冻结 ---------- */
  /* 先让控制区改动触发的防抖自动保存落库，否则下面的重置会撞上 409 修订号冲突 */
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="save"]').click(); true`);
  await waitFor(`(document.getElementById("dlSaveState")||{}).textContent === " · 已保存"`, "草稿落库", 15000);
  /* 确认状态是持久化的人工层：上一轮跑完会留下「已确认」，这里先清空，保证导出闸门每次都被真实走到 */
  await evaluate(`import("./js/core/api.js").then(({API}) => {
    const url = "/api/versions/${RICH}/delivery-note";
    return API.get(url).then(d => API.put(url, {
      revision: d.revision == null ? 0 : d.revision,
      audience: d.audience || "", supportContact: d.supportContact || "", acceptanceNote: d.acceptanceNote || "",
      options: d.options, narratives: d.narratives || {}, confirmed: []
    }));
  }).then(() => true)`);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(RICH)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sec").length > 3 && Number(document.getElementById("dlMeterPending").textContent) > 0`, "回到待确认草稿", 25000);
  const pending0 = await evaluate(`Number(document.getElementById("dlMeterPending").textContent)`);
  assert(pending0 > 0, `初始有 ${pending0} 处对外表述待确认`);
  /* 四段对外表述都要进闸门：字段名（change/issue）与区块键（changes/defects）不同名，
     映射错了会让变更说明与缺陷两段挂着「待确认」章却算不进待确认数，客户版照样能导出。 */
  const gateMap = await evaluate(`(() => {
    const wraps = [...document.querySelectorAll("#dlSheetHost .dl-narr-wrap[data-dl-wrap]")];
    const pend = wraps.filter(w => w.classList.contains("pending")).map(w => w.dataset.dlWrap);
    const chips = wraps.filter(w => /待确认/.test((w.querySelector(".dl-narr-bar")||{}).textContent || "")).map(w => w.dataset.dlWrap);
    return { pend, chips, meter: Number(document.getElementById("dlMeterPending").textContent),
      banner: document.getElementById("dlBanner").textContent };
  })()`);
  assert(["summary", "change", "issue", "acceptance"].every(f => gateMap.pend.indexOf(f) >= 0),
    `四段对外表述均待确认（${gateMap.pend.join("/")}）`);
  assert(gateMap.meter === gateMap.pend.length && gateMap.chips.length === gateMap.pend.length,
    `待确认计数与纸面「待确认」章一致（计数 ${gateMap.meter} / 章 ${gateMap.chips.length}）`);
  assert(gateMap.banner.indexOf(gateMap.meter + " 处对外表述待确认") >= 0, "横幅报出同一待确认数");
  /* 区块关掉后该段不再出现在文档里，也就不该继续拦导出 */
  await evaluate(`(() => { const c = document.querySelector('[data-dl-opt="showChanges"]'); c.click(); return true; })()`);
  await sleep(400);
  const gateOff = await evaluate(`(() => ({
    meter: Number(document.getElementById("dlMeterPending").textContent),
    wrap: !!document.querySelector('#dlSheetHost .dl-narr-wrap[data-dl-wrap="change"]')
  }))()`);
  assert(!gateOff.wrap && gateOff.meter === gateMap.meter - 1,
    `关掉变更说明后该段退出闸门（${gateMap.meter} → ${gateOff.meter}）`);
  await evaluate(`(() => { const c = document.querySelector('[data-dl-opt="showChanges"]'); c.click(); return true; })()`);
  await sleep(400);
  assert(await evaluate(`Number(document.getElementById("dlMeterPending").textContent) === ${gateMap.meter}`),
    "重新打开变更说明后该段回到闸门");
  /* 逐项查看：确认摘要后，第一处待确认变成变更说明，按钮应把读者带到那一节 */
  await evaluate(`document.querySelector('[data-dl-act="accept"][data-dl-key="summary"]').click(); true`);
  await sleep(400);
  await evaluate(`document.querySelector('[data-dl-act="goto-pending"]').click(); true`);
  await sleep(900);
  const gotoPend = await evaluate(`(() => {
    const sc = document.getElementById("view-delivery");
    const sec = document.getElementById("dl-sec-changes");
    const cur = document.querySelector('#dlSecnav [aria-current="true"]');
    return { gap: Math.round(sec.getBoundingClientRect().top - sc.getBoundingClientRect().top),
      cur: cur ? cur.dataset.dlJump : "", first: document.querySelector("#dlSheetHost .dl-narr-wrap.pending").dataset.dlWrap };
  })()`);
  assert(gotoPend.first === "change" && gotoPend.cur === "changes" && gotoPend.gap >= -2 && gotoPend.gap <= 120,
    `逐项查看落到第一处待确认所在节（${gotoPend.cur}，距顶 ${gotoPend.gap}px）`);
  const preExport = await evaluate(`(() => {
    const btn = document.querySelector('.dl-acts [data-dl-act="export"]');
    btn.click();
    return true;
  })()`);
  await sleep(500);
  const pendingGate = await evaluate(`(() => ({
    dialog: !!document.getElementById("dlExportBody"),
    toast: [...document.querySelectorAll(".toast-layer .toast, .toast")].map(x => x.textContent).join(" | ")
  }))()`);
  assert(!pendingGate.dialog && /待确认/.test(pendingGate.toast), "未确认完文字时导出被拦住（" + pendingGate.toast.slice(0, 60) + "）");
  await evaluate(`document.querySelector('[data-dl-act="accept-all"]').click(); true`);
  await sleep(600);
  const pending1 = await evaluate(`Number(document.getElementById("dlMeterPending").textContent)`);
  assert(pending1 === 0, `全部确认后待确认归零（${pending0} → ${pending1}）`);
  assert(await evaluate(`document.getElementById("dlBanner").textContent.indexOf("事实与文字均已就绪") >= 0`), "横幅转为可导出状态");

  await evaluate(`document.querySelector('.dl-acts [data-dl-act="export"]').click(); true`);
  await waitFor(`!!document.getElementById("dlExportBody")`, "导出弹窗", 8000);
  await waitFor(`!!document.querySelector("#dlExportBody #dlPaper .dl-sheet")`, "PDF 预览纸张", 8000);
  await sleep(400);
  /* .sheet-body 是 gap 弹性列：再塞占位 div 会叠成 40px 空档，这里量真实相邻间距 */
  const dlgRhythm = await evaluate(`(() => {
    const body = document.querySelector(".dl-dlg .sheet-body");
    const kids = [...body.children].filter(k => k.getClientRects().length && k.getBoundingClientRect().height > 0);
    const gaps = [];
    for(let i = 1; i < kids.length; i++){
      gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i-1].getBoundingClientRect().bottom));
    }
    const inner = [...document.getElementById("dlExportBody").children].filter(k => k.getBoundingClientRect().height > 0);
    const ig = [];
    for(let i = 1; i < inner.length; i++){
      ig.push(Math.round(inner[i].getBoundingClientRect().top - inner[i-1].getBoundingClientRect().bottom));
    }
    return { gaps, inner: ig, spacers: kids.filter(d => !d.children.length && !d.textContent.trim()).length };
  })()`);
  assert(dlgRhythm.spacers === 0 && dlgRhythm.gaps.every(g => g >= 0 && g <= 20),
    `导出弹层行距 ${dlgRhythm.gaps.join("/")}px，无占位空 div（${dlgRhythm.spacers} 个）`);
  assert(dlgRhythm.inner.every(g => g >= 0 && g <= 20), `预览区内行距 ${dlgRhythm.inner.join("/")}px`);
  const pdfPrev = await evaluate(`(() => {
    const p = document.querySelector("#dlExportBody #dlPaper");
    return { secs: p.querySelectorAll(".dl-sec").length, tools: p.querySelectorAll(".dl-doc-tools").length,
      narrBar: p.querySelectorAll(".dl-narr-bar").length, sign: p.querySelectorAll(".dl-sign").length,
      transform: p.style.transform };
  })()`);
  assert(pdfPrev.secs > 5 && pdfPrev.tools === 0 && pdfPrev.narrBar === 0, "导出预览去掉工具条与确认条");
  assert(pdfPrev.sign === 2, "导出预览保留签认栏");
  assert(/scale/.test(pdfPrev.transform), "预览按纸张缩放（" + pdfPrev.transform + "）");
  /* 预览必须撑满预览框并居中：写死缩放上限会让宽屏上一半是空白、纸张偏左 */
  const paperFit = await evaluate(`(() => {
    const f = document.querySelector(".dl-paper-frame"), h = document.querySelector(".dl-paper-holder");
    const p = document.getElementById("dlPaper");
    const fr = f.getBoundingClientRect(), hr = h.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { fill: hr.width / (f.clientWidth - 32), scale: Number((p.style.transform.match(/[\\d.]+/) || [0])[0]),
      want: Math.min(1.5, (f.clientWidth - 34) / 703),
      leftGap: Math.round(hr.left - fr.left), rightGap: Math.round(fr.right - hr.right),
      clipped: pr.width > f.clientWidth + 1, frameH: Math.round(fr.height),
      hint: document.getElementById("dlExportHint").textContent,
      scrollable: f.scrollHeight > f.clientHeight + 2 };
  })()`);
  assert(paperFit.fill > 0.9 && !paperFit.clipped && Math.abs(paperFit.scale - paperFit.want) < 0.01,
    `预览纸张按框宽缩放 ${paperFit.scale}、占满 ${(paperFit.fill * 100).toFixed(0)}%，未横向溢出`);
  assert(Math.abs(paperFit.leftGap - paperFit.rightGap) <= 2,
    `预览纸张居中（左 ${paperFit.leftGap}px / 右 ${paperFit.rightGap}px）`);
  assert(paperFit.frameH >= 380 && paperFit.scrollable, `预览框高 ${paperFit.frameH}px 且可纵向滚动看后续内容`);
  assert(/约 \d+ 页 A4 · .+ · 预览缩放 \d+%/.test(paperFit.hint), "页脚给出页数、语气与缩放比例：" + paperFit.hint);
  /* 预览纸必须与打印纸同几何：A4 内容宽 703px 比 860px 断点还窄，
     按视口宽度排版会预览 4 列、印出来 2 列，页数也会少算三分之一。 */
  const a4Parity = await evaluate(`(() => {
    const p = document.querySelector("#dlPaper .dl-sheet");
    const scale = Number((document.getElementById("dlPaper").style.transform.match(/[\\d.]+/) || [1])[0]);
    const meta = p.querySelector(".dl-doc-meta");
    const dt = [...meta.querySelectorAll(".dt")];
    const lh = parseFloat(getComputedStyle(meta.querySelector("strong")).lineHeight);
    return { a4: p.classList.contains("dl-a4"),
      w: Math.round(p.getBoundingClientRect().width / scale),
      cols: getComputedStyle(meta).gridTemplateColumns.split(" ").length,
      pad: getComputedStyle(p.querySelector(".dl-sec")).paddingLeft,
      dtLines: dt.map(x => Math.round(x.getBoundingClientRect().height / lh)),
      dtText: dt.map(x => x.textContent),
      hint: Number((document.getElementById("dlExportHint").textContent.match(/约 (\\d+) 页/) || [0,0])[1]),
      meter: Number(document.getElementById("dlMeterPages").textContent) };
  })()`);
  assert(a4Parity.a4 && a4Parity.w === 703 && a4Parity.cols === 2 && a4Parity.pad === "16px",
    `预览纸按真实 A4 排版（${a4Parity.w}px / ${a4Parity.cols} 列 / 段距 ${a4Parity.pad}）`);
  assert(a4Parity.hint === a4Parity.meter, `页脚页数与控制区页数一致（${a4Parity.hint} / ${a4Parity.meter}）`);
  assert(a4Parity.dtText.length === 2 && a4Parity.dtLines.every(n => n === 1),
    `交付周期两个日期各自不折行（${a4Parity.dtText.join(" → ")}）`);
  /* 吐司层 z-index 300 盖在弹层之上，右下角正是主按钮位置：不能把「冻结并打开打印」压住 */
  await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.toast("对照吐司：检查它是否压住导出主按钮", "fs"); return true; })`);
  await sleep(500);
  const toastHit = await evaluate(`(() => {
    const go = document.getElementById("dlExportGo"), r = go.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
    return { covered: !go.contains(hit), hit: hit ? (hit.id || hit.className) : null,
      inView: r.top >= 0 && r.bottom <= window.innerHeight };
  })()`);
  assert(!toastHit.covered && toastHit.inView, `吐司不遮挡导出主按钮（命中 ${toastHit.hit}）`);
  globalThis.__a4Pages = a4Parity.hint;
  await shot("02-export-pdf-preview");
  /* 窗口变窄时预览要重新适配，不能保持旧缩放导致溢出 */
  await evaluate(`window.__rz = 0; window.addEventListener("resize", function(){ window.__rz++; }); true`);
  await call("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const paperNarrow = await evaluate(`(() => {
    const f = document.querySelector(".dl-paper-frame"), h = document.querySelector(".dl-paper-holder");
    const hr = h.getBoundingClientRect(), fr = f.getBoundingClientRect();
    return { fill: hr.width / (f.clientWidth - 32), over: hr.width > f.clientWidth + 1, rz: window.__rz,
      hint: document.getElementById("dlExportHint").textContent };
  })()`);
  assert(paperNarrow.rz > 0 && paperNarrow.fill > 0.9 && !paperNarrow.over,
    `窄窗口下 resize 触发 ${paperNarrow.rz} 次、预览重新适配（占宽 ${(paperNarrow.fill * 100).toFixed(0)}%，无溢出）：${paperNarrow.hint}`);
  await call("Emulation.clearDeviceMetricsOverride");
  await sleep(700);
  assert(await evaluate(`(() => {
    const f = document.querySelector(".dl-paper-frame"), h = document.querySelector(".dl-paper-holder");
    return h.getBoundingClientRect().width / (f.clientWidth - 32) > 0.9;
  })()`), "恢复宽窗口后预览再次撑满");

  await evaluate(`document.querySelector('[data-dl-fmt="md"]').click(); true`);
  await sleep(300);
  const md = await evaluate(`(document.querySelector(".dl-md-pre")||{}).textContent || ""`);
  assert(md.indexOf("## ") >= 0 && md.indexOf("交付摘要") >= 0, "Markdown 预览有结构");
  assert(md.indexOf("发布计划与窗口") >= 0 && md.indexOf("风险与回滚约定") >= 0, "Markdown 含发布计划与回滚约定");
  assert(md.indexOf("验收签认") >= 0 && md.indexOf("签字：____") >= 0, "Markdown 含签认留白");
  assert(/（WI-\d{3,}）/.test(md), "Markdown 遗留缺陷带项目内编号");
  assert(!/prod-[a-z]+-[a-z0-9]+|test-[a-z]+-[a-z0-9]+/.test(md) && md.indexOf("- 制品：") < 0
    && md.indexOf("- SHA256：") < 0 && md.indexOf("- 实际执行人：") < 0,
    "客户版 Markdown 同样不含机房主机键、制品坐标与实际执行人");

  await evaluate(`document.querySelector('[data-dl-fmt="html"]').click(); true`);
  await sleep(300);
  assert(await evaluate(`!!document.querySelector("#dlExportBody #dlPaper .dl-sheet")`), "独立 HTML 预览渲染");
  await evaluate(`document.querySelector('[data-dl-fmt="md"]').click(); true`);
  await sleep(250);
  await evaluate(`document.getElementById("dlExportGo").click(); true`);
  await waitFor(`import("./js/core/state.js").then(() => !!document.querySelector(".dl-rail.locked"))`, "导出后锁定", 20000);
  const locked = await evaluate(`(() => {
    const chips = [...document.querySelectorAll("#dlSheetHost .dl-doc-flags .dl-chip")].map(c => c.textContent);
    return { docNo: (document.querySelector(".dl-head .dl-chip.plum")||{}).textContent || "",
      chips, lockbar: !!document.querySelector(".dl-lockbar"),
      disabled: [...document.querySelectorAll(".dl-rail select,.dl-rail input")].every(el => el.disabled),
      hash: (document.querySelector("#dlSheetHost .dl-doc-foot")||{}).textContent || "" };
  })()`);
  assert(/DS-\d{8}-\d{2}/.test(locked.docNo), "冻结后分配对外编号（" + locked.docNo.trim() + "）");
  assert(locked.chips.some(c => c.indexOf("不可变快照") >= 0), "纸张标记不可变快照");
  assert(locked.lockbar && locked.disabled, "控制区整体锁定");
  assert(locked.hash.indexOf("内容校验值") >= 0, "页脚给出内容校验值");
  await shot("03-locked-snapshot", true);

  /* ---------- 7. 只读分享 → 接收人页 ---------- */
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="share"]').click(); true`);
  await waitFor(`!!document.getElementById("dlShareBody")`, "分享弹窗", 8000);
  await waitFor(`!!document.querySelector("[data-dl-share-gen]")`, "分享表单", 8000);
  const shareForm = await evaluate(`(() => {
    const sel = document.querySelector("[data-dl-share-days]");
    const sw = document.querySelector('[data-dl-opt="allowDownload"]');
    const body = document.getElementById("dlShareBody");
    return { opts: [...sel.options].map(o => o.value), days: sel.value,
      download: sw.checked, swLabel: sw.closest(".dl-switch").textContent.trim(),
      note: (body.querySelector(".dl-caliber")||{}).textContent || "",
      gen: (document.querySelector("[data-dl-share-gen]")||{}).textContent || "" };
  })()`);
  assert(shareForm.opts.join(",") === "7,30,90" && shareForm.days === "30",
    `分享有效期可选 ${shareForm.opts.join("/")} 天，默认 ${shareForm.days} 天`);
  assert(shareForm.download && /允许接收人下载 PDF/.test(shareForm.swLabel), "默认允许接收人下载 PDF，开关有说明");
  assert(shareForm.note.indexOf("将分享快照") >= 0 && /生成只读链接/.test(shareForm.gen), "已冻结快照时表单说明分享哪一份");
  await shot("03a-share-form");
  await evaluate(`document.querySelector("[data-dl-share-gen]").click(); true`);
  await waitFor(`!!document.querySelector(".dl-share-url input")`, "生成只读链接", 20000);
  const shareUrl = await evaluate(`document.querySelector(".dl-share-url input").value`);
  assert(/kind=delivery/.test(shareUrl) && /token=/.test(shareUrl), "链接指向 delivery 分享页");
  const shareRhythm = await evaluate(`(() => {
    const body = document.getElementById("dlShareBody");
    const kids = [...body.children].filter(k => k.getBoundingClientRect().height > 0);
    const gaps = [];
    for(let i = 1; i < kids.length; i++){
      gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i-1].getBoundingClientRect().bottom));
    }
    return { gaps, rows: kids.length,
      spacers: kids.filter(d => !d.children.length && !d.textContent.trim()).length,
      rawId: /将分享快照 [A-Za-z0-9]{16,}/.test(body.textContent) };
  })()`);
  assert(shareRhythm.rows >= 4 && shareRhythm.spacers === 0 && shareRhythm.gaps.every(g => g >= 0 && g <= 20),
    `分享弹层 ${shareRhythm.rows} 行、行距 ${shareRhythm.gaps.join("/")}px，无占位空 div`);
  assert(!shareRhythm.rawId, "分享弹层不向用户抛原始快照 ID");
  await shot("03b-share-dialog");
  const workbenchText = await evaluate(`document.querySelector("#dlSheetHost .dl-sheet").textContent.replace(/\\s+/g," ").trim()`);
  await evaluate(`document.querySelector(".modal-layer.open [data-dl-close]").click(); true`);
  await sleep(250);

  /* 7a. 工作台打印：原生 Ctrl+P 与「导出 PDF」按钮走同一份只读 A4 投影 */
  await watchPrint();
  const wbNative = await printPdf("workbench-native");
  const wbSeen = JSON.parse(await evaluate(`JSON.stringify(window.__dlPrintSeen)`));
  assert(wbNative.sizes.length === 1 && wbNative.sizes[0] === "595x842",
    `工作台原生打印 A4 纵向（${wbNative.sizes.join(",") || "未知"}）`);
  assert(wbNative.fonts > 0 && wbNative.textOps > 300,
    `原生打印不是空白页（${wbNative.fonts} 个字体 / ${wbNative.textOps} 处文字绘制 / ${wbNative.bytes} 字节）`);
  /* 估算页数是按屏幕上那张宽纸算的话会少报三分之一：这里拿真实 PDF 页数校准 */
  assert(globalThis.__a4Pages === wbNative.pages,
    `页数估算与真实 PDF 一致（估算 ${globalThis.__a4Pages} 页 / 实际 ${wbNative.pages} 页）`);
  assert(wbSeen && wbSeen.host && wbSeen.marker === "1" && wbSeen.secs > 5 && wbSeen.chrome === 0,
    `原生打印自动挂只读纸张（${wbSeen ? wbSeen.secs + " 区块 / " + wbSeen.chars + " 字 / " + wbSeen.chrome + " 个编辑控件" : "beforeprint 未触发"}）`);
  const wbClean = await printCleanup();
  assert(!wbClean.host && !wbClean.marker, "打印后宿主与标记清理干净，不留给下一次打印");

  await evaluate(`(() => {
    window.__dlBtnPrint = 0; window.__dlRealPrint = window.print; window.__dlBtnSeen = null;
    window.print = function(){
      window.__dlBtnPrint++;
      const h = document.getElementById("dlPrintHost");
      window.__dlBtnSeen = { host: !!h, marker: document.documentElement.getAttribute("data-dl-print"),
        chars: h ? h.textContent.replace(/\\s+/g, " ").trim().length : 0,
        secs: h ? h.querySelectorAll(".dl-sec").length : 0,
        chrome: h ? h.querySelectorAll(".dl-narr-bar,.dl-doc-tools,.dl-more-row").length : 0 };
    };
    return true;
  })()`);
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="export"]').click(); true`);
  await waitFor(`!!document.getElementById("dlExportBody")`, "导出弹窗（PDF）", 8000);
  await evaluate(`document.querySelector('.modal-layer.open [data-dl-fmt="pdf"]').click(); true`);
  await sleep(300);
  await evaluate(`document.getElementById("dlExportGo").click(); true`);
  await waitFor(`window.__dlBtnPrint > 0`, "按钮触发打印", 20000);
  const btnSeen = JSON.parse(await evaluate(`JSON.stringify(window.__dlBtnSeen)`));
  assert(btnSeen && btnSeen.host && btnSeen.marker === "1" && btnSeen.secs > 5 && btnSeen.chrome === 0,
    `按钮打印前已挂只读纸张（${btnSeen ? btnSeen.secs + " 区块 / " + btnSeen.chars + " 字" : "未挂"}）`);
  const wbButton = await printPdf("workbench-button");
  assert(wbButton.sizes[0] === "595x842" && wbButton.pages === wbNative.pages && wbButton.textOps > 300,
    `按钮与原生打印产出同一份纸张（${wbButton.pages} 页 / ${wbButton.textOps} 处文字，原生 ${wbNative.pages} 页 / ${wbNative.textOps} 处）`);
  await evaluate(`window.print = window.__dlRealPrint; window.dispatchEvent(new Event("afterprint")); true`);
  await sleep(200);
  const btnClean = await printCleanup();
  assert(!btnClean.host && !btnClean.marker, "按钮打印后同样清理干净");

  const guest = await newTab();
  await guest.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await guest.call("Page.navigate", { url: shareUrl });
  await guest.waitFor(`document.querySelectorAll("#deliveryShareBody .dl-sec").length > 3`, "接收人页渲染", 25000);
  const recv = await guest.evaluate(`(() => {
    const root = document.getElementById("deliveryShareBody");
    return {
      text: root.querySelector(".dl-sheet").textContent.replace(/\\s+/g," ").trim(),
      secs: root.querySelectorAll(".dl-sec").length,
      editables: root.querySelectorAll("[contenteditable]").length,
      actions: [...root.querySelectorAll("[data-dl-act]")].map(b => b.dataset.dlAct).filter(a => a !== "source"),
      pdf: !!document.getElementById("dlSharePdf"),
      sources: !!document.getElementById("dlShareSources"),
      foot: (root.querySelector(".dl-share-foot")||{}).textContent || "",
      internal: !!root.querySelector("#dl-sec-internal") || root.textContent.indexOf("仅内部版可见") >= 0,
      title: document.title
    };
  })()`);
  assert(recv.secs > 5, `接收人页渲染 ${recv.secs} 个区块（标题：${recv.title}）`);
  assert(recv.editables === 0 && recv.actions.length === 0, "接收人页无任何写入口（除数字口径）");
  assert(!recv.internal, "接收人页不含内部备注");
  assert(recv.pdf && recv.sources, "接收人页有下载 PDF 与数字口径入口");
  assert(recv.foot.indexOf("不可变快照") >= 0 && recv.foot.indexOf("内容校验值") >= 0, "页脚说明快照冻结与校验值");
  const sameText = recv.text === workbenchText;
  assert(sameText, sameText ? "接收人正文与工作台快照逐字一致"
    : "接收人正文与工作台不一致（工作台 " + workbenchText.length + " 字 / 接收人 " + recv.text.length + " 字）");
  await guest.shot("04-recipient-1440", true);

  await guest.evaluate(`document.querySelector('#deliveryShareBody .dl-metric[data-dl-src]').click(); true`);
  await guest.waitFor(`!!document.querySelector(".modal-layer.open .dl-caliber")`, "接收人口径抽屉", 8000);
  const guestSrc = await guest.evaluate(`(() => {
    const l = document.querySelector(".modal-layer.open");
    return { caliber: (l.querySelector(".dl-caliber")||{}).textContent, recs: l.querySelectorAll(".dl-srcrec").length,
      jump: l.querySelectorAll("[data-dl-src-goto]").length };
  })()`);
  assert(guestSrc.caliber.length > 8 && guestSrc.recs > 0, `接收人可看口径与 ${guestSrc.recs} 条原始记录`);
  assert(guestSrc.jump === 0, "接收人页不给跳原始记录的入口（无账号）");
  await guest.evaluate(`document.querySelector(".modal-layer.open [data-dl-share-close]").click(); true`);
  await sleep(250);
  assert(await guest.evaluate(`!document.querySelector(".modal-layer.open")`), "接收人抽屉可关闭");

  /* 7b. 接收人页打印：原生 Ctrl+P 与「下载 PDF」都要印出同一份非空白 A4，且与工作台同页数 */
  await guest.watchPrint();
  const rNative = await guest.printPdf("recipient-native");
  const rSeen = JSON.parse(await guest.evaluate(`JSON.stringify(window.__dlPrintSeen)`));
  assert(rNative.sizes.length === 1 && rNative.sizes[0] === "595x842",
    `接收人打印为 A4 纵向，不被甘特的 A3 横向抢走（实际 ${rNative.sizes.join(",") || "未知"}）`);
  assert(rNative.fonts > 0 && rNative.textOps > 300,
    `接收人原生打印不是空白页（${rNative.fonts} 个字体 / ${rNative.textOps} 处文字绘制 / ${rNative.bytes} 字节）`);
  assert(rSeen && rSeen.host && rSeen.secs > 5 && rSeen.chrome === 0,
    `接收人 Ctrl+P 自动挂只读纸张（${rSeen ? rSeen.secs + " 区块 / " + rSeen.chars + " 字" : "beforeprint 未触发"}）`);
  assert(rNative.pages === wbNative.pages,
    `接收人与工作台印同一份纸张（各 ${rNative.pages} 页；工作台 ${wbNative.pages} 页）`);
  assert(rNative.pages >= 2 && rNative.pages <= 12, `打印页数 ${rNative.pages}（内容驱动，不应无限展开）`);
  const rClean = await guest.printCleanup();
  assert(!rClean.host && !rClean.marker, "接收人打印后宿主与标记清理干净");

  await guest.evaluate(`(() => {
    window.__dlBtnPrint = 0; window.__dlRealPrint = window.print; window.__dlBtnSeen = null;
    window.print = function(){
      window.__dlBtnPrint++;
      const h = document.getElementById("dlPrintHost");
      window.__dlBtnSeen = { host: !!h, chars: h ? h.textContent.replace(/\\s+/g, " ").trim().length : 0,
        secs: h ? h.querySelectorAll(".dl-sec").length : 0,
        chrome: h ? h.querySelectorAll(".dl-narr-bar,.dl-doc-tools,.dl-more-row").length : 0 };
    };
    return true;
  })()`);
  await guest.evaluate(`document.getElementById("dlSharePdf").click(); true`);
  await guest.waitFor(`window.__dlBtnPrint > 0`, "接收人下载 PDF 触发打印", 8000);
  const rBtn = JSON.parse(await guest.evaluate(`JSON.stringify(window.__dlBtnSeen)`));
  assert(rBtn && rBtn.host && rBtn.secs > 5 && rBtn.chrome === 0 && rBtn.chars === rSeen.chars,
    `「下载 PDF」与 Ctrl+P 印同一份内容（各 ${rBtn ? rBtn.chars : "?"} 字）`);
  const rButtonPdf = await guest.printPdf("recipient-button");
  assert(rButtonPdf.pages === rNative.pages && rButtonPdf.textOps > 300,
    `接收人按钮路径同样非空白（${rButtonPdf.pages} 页 / ${rButtonPdf.textOps} 处文字）`);
  await guest.evaluate(`window.print = window.__dlRealPrint; window.dispatchEvent(new Event("afterprint")); true`);
  await sleep(200);
  assert(!(await guest.printCleanup()).host, "接收人按钮打印后清理干净");

  /* 7c. 移动端接收人页 */
  await guest.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await guest.call("Page.reload", {});
  await guest.waitFor(`document.querySelectorAll("#deliveryShareBody .dl-sec").length > 3`, "接收人手机端冷加载", 25000);
  await sleep(500);
  const gMob = await guest.evaluate(`(() => ({
    docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    bodyW: document.body.scrollWidth,
    clipped: [...document.querySelectorAll("#deliveryShareBody .dl-sec")].filter(s => s.scrollWidth > s.clientWidth + 2).length
  }))()`);
  assert(gMob.docW <= gMob.innerW + 1 && gMob.bodyW <= gMob.innerW + 1, `接收人手机端无横向溢出（页面 ${gMob.docW}/${gMob.innerW}）`);
  assert(gMob.clipped === 0, `接收人手机端区块无裁切（${gMob.clipped} 个溢出）`);
  /* 21 位发布记录号在窄屏两列盒子里不能折成两截，也不能被省略号吃掉 */
  const ridFit = await guest.evaluate(`(() => {
    const r = document.querySelector("#deliveryShareBody .dl-doc-meta .rid");
    if(!r) return null;
    const cs = getComputedStyle(r);
    return { text: r.textContent, w: r.scrollWidth, box: r.clientWidth,
      lines: Math.round(r.getBoundingClientRect().height / parseFloat(cs.lineHeight)),
      nowrap: cs.whiteSpace, mono: /mono/i.test(cs.fontFamily) };
  })()`);
  assert(ridFit && ridFit.nowrap === "nowrap" && ridFit.lines === 1 && ridFit.w <= ridFit.box + 1,
    `手机端发布记录号单行完整显示（${ridFit ? ridFit.text + " " + ridFit.w + "/" + ridFit.box + "px" : "缺失"}）`);
  await guest.shot("05-recipient-390", true);
  await guest.call("Emulation.clearDeviceMetricsOverride", {});

  /* ---------- 8. 停止分享后链接失效 ---------- */
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="share"]').click(); true`);
  await waitFor(`!!document.querySelector("[data-dl-share-revoke]")`, "分享管理态", 10000);
  await evaluate(`document.querySelector("[data-dl-share-revoke]").click(); true`);
  /* 统一确认框是 index.html 里的既有节点 #dlgConfirm，DOM 顺序在动态弹层之前，不能按「最后一层」找 */
  await waitFor(`!!document.getElementById("dlgConfirm").classList.contains("open")`, "停止分享确认", 8000);
  assert(await evaluate(`document.getElementById("dlgConfirmMsg").textContent.indexOf("立即失效") >= 0`), "停止分享前告知链接立即失效");
  await evaluate(`document.getElementById("dlgConfirmOk").click(); true`);
  await sleep(1500);
  const revoked = await evaluate(`(() => ({
    gone: !document.querySelector("[data-dl-share-revoke]"),
    confirmOpen: document.getElementById("dlgConfirm").classList.contains("open"),
    toast: [...document.querySelectorAll(".toast")].map(x => x.textContent).join(" | "),
    body: (document.getElementById("dlShareBody")||{}).textContent || ""
  }))()`);
  assert(revoked.gone, "停止分享后回到可重新生成的状态"
    + (revoked.gone ? "（提示：" + revoked.toast + "）" : "（确认框仍开=" + revoked.confirmOpen + "，提示：" + revoked.toast + "）"));
  await guest.call("Page.navigate", { url: shareUrl });
  await guest.call("Page.reload", { ignoreCache: true });
  await guest.waitFor(`!document.getElementById("shareErrorPage").hidden && /失效|过期|无效|停止/.test(document.getElementById("shareErrorPage").textContent)`, "失效提示", 20000);
  pass("停止分享后接收人页给出失效提示");
  await guest.shot("06-share-revoked");
  await evaluate(`(() => { [...document.querySelectorAll(".modal-layer.open [data-dl-close]")].forEach(b => b.click()); return true; })()`);
  await sleep(300);

  /* ---------- 8b. 有效期与「允许下载」真的生效：7 天 + 关掉下载 ---------- */
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="share"]').click(); true`);
  await waitFor(`!!document.querySelector("[data-dl-share-gen]")`, "停止分享后可重新生成", 10000);
  await evaluate(`(() => {
    const sel = document.querySelector("[data-dl-share-days]");
    sel.value = "7"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    const sw = document.querySelector('[data-dl-opt="allowDownload"]');
    sw.click();
    return true;
  })()`);
  await sleep(200);
  await evaluate(`document.querySelector("[data-dl-share-gen]").click(); true`);
  await waitFor(`!!document.querySelector(".dl-share-url input")`, "重新生成只读链接", 20000);
  const share7 = await evaluate(`(() => {
    const boxes = [...document.querySelectorAll("#dlShareBody .dl-kvbox")];
    const get = k => (boxes.find(b => b.querySelector("span").textContent === k)||{querySelector:()=>null}).querySelector("strong");
    const exp = get("有效至").textContent.trim();
    const t = new Date(exp.replace(/-/g, "/")).getTime();
    return { exp, days: (t - Date.now()) / 86400000, download: get("允许下载").textContent.trim(),
      url: document.querySelector(".dl-share-url input").value };
  })()`);
  assert(share7.days > 6.9 && share7.days < 7.1, `有效期选 7 天后到期时间就是 7 天（${share7.exp}，实算 ${share7.days.toFixed(2)} 天）`);
  assert(share7.download === "否", "关掉开关后分享记录标记不允许下载");
  await guest.call("Page.navigate", { url: share7.url });
  await guest.waitFor(`document.querySelectorAll("#deliveryShareBody .dl-sec").length > 3`, "不允许下载的接收人页", 25000);
  const noDl = await guest.evaluate(`(() => ({
    pdf: !!document.getElementById("dlSharePdf"),
    sources: !!document.getElementById("dlShareSources"),
    foot: (document.querySelector("#deliveryShareBody .dl-share-foot")||{}).textContent || "",
    secs: document.querySelectorAll("#deliveryShareBody .dl-sec").length
  }))()`);
  assert(!noDl.pdf && noDl.foot.indexOf("未开放下载") >= 0, "关掉下载后接收人页没有下载按钮，页脚说明原因");
  assert(noDl.sources && noDl.secs > 5, "关掉下载不影响在线正文与数字口径");
  await evaluate(`(() => { [...document.querySelectorAll(".modal-layer.open [data-dl-close]")].forEach(b => b.click()); return true; })()`);
  await sleep(250);

  /* ---------- 9. 草稿路径：未确认生产发布的闸门与水印 ---------- */
  await evaluate(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${DRAFT_WS}/select", {})).then(() => true)`);
  await hardOpen(BASE + "/#/delivery");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(DRAFT_WS)} && rt.reqsLoaded)`, "切到草稿空间", 25000);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(DRAFT)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sec").length > 3`, "草稿纸张渲染", 25000);
  /* 确认状态是持久化的人工层：上一轮手机端会把四段都确认掉，这里先清空，待确认闸门才每次真走到。
     必须赶在任何控制区改动之前，否则那次改动的防抖自动保存会把旧的确认列表又写回去。 */
  await evaluate(`import("./js/core/api.js").then(({API}) => {
    const url = "/api/versions/${DRAFT}/delivery-note";
    return API.get(url).then(d => API.put(url, {
      revision: d.revision == null ? 0 : d.revision,
      audience: d.audience || "", supportContact: d.supportContact || "", acceptanceNote: d.acceptanceNote || "",
      options: d.options, narratives: d.narratives || {}, confirmed: []
    }));
  }).then(() => true)`);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(DRAFT)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sec").length > 3 && Number(document.getElementById("dlMeterPending").textContent) > 0`, "草稿回到待确认", 25000);
  /* 草稿版本的人工层会记住上一轮的语气：归位到客户版，闸门断言才是确定的 */
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="customer"]').click(); true`);
  await waitFor(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="customer"]').getAttribute("aria-pressed") === "true"`, "草稿归位客户版", 8000);
  await sleep(500);
  /* 通过率渲染换个有测试计划的版本核对：RICH 若没有计划，这里仍能覆盖口径文案 */
  const draftQ = await evaluate(`import("./js/core/api.js").then(({API}) => API.get("/api/versions/${DRAFT}/delivery-note")).then(d => {
    const t = document.getElementById("dlSheetHost").textContent, q = d.quality || {};
    const rate = q.passRatePct == null ? null : Math.round(q.passRatePct * 10) / 10;
    return { missing: !!q.missing, rate: rate,
      hasRate: rate != null && t.indexOf(rate + "%") >= 0, hasSkipped: t.indexOf("跳过（本次不适用，出分母）") >= 0 };
  })`);
  if (draftQ.missing) {
    console.log("  NOTE 草稿版本也没有测试计划：本轮不覆盖通过率渲染");
  } else {
    assert(draftQ.hasRate, `草稿通过率与接口口径一致（${draftQ.rate}%）`);
    assert(draftQ.hasSkipped, "草稿质量区显式写出跳过出分母");
  }
  const draft = await evaluate(`(() => {
    const sheet = document.querySelector("#dlSheetHost .dl-sheet");
    return {
      warning: (sheet.querySelector(".dl-doc-warning")||{}).textContent || "",
      watermark: !!sheet.querySelector(".dl-watermark"),
      sheetCls: sheet.className,
      banner: (document.getElementById("dlBanner")||{}).textContent || "",
      risks: [...sheet.querySelectorAll(".dl-sec")].filter(s => /后续计划与风险/.test((s.querySelector("h2")||{}).textContent||""))
        .map(s => ({ rows: s.querySelectorAll(".dl-row.body").length, more: (s.querySelector(".dl-more-row")||{}).textContent || "",
          total: Number(((s.querySelector(".dl-sec-hint")||{}).textContent || "").match(/^(\\d+)/) ? ((s.querySelector(".dl-sec-hint")||{}).textContent || "").match(/^(\\d+)/)[1] : 0),
          btn: !!s.querySelector('[data-dl-act="risks"]') }))[0]
    };
  })()`);
  assert(draft.warning.indexOf("未确认生产发布") >= 0, "草稿顶部强制警示未确认发布");
  assert(draft.watermark, "草稿强制水印，不可关闭");
  assert(draft.banner.indexOf("管理版") >= 0 || draft.banner.indexOf("发布") >= 0, "横幅给出下一步（" + draft.banner.slice(0, 60) + "…）");
  /* 是否超 6 项由数据决定：演示数据换一批不该让断言失效，展开入口只在超量时出现 */
  const riskTotal = draft.risks ? draft.risks.total : 0;
  assert(draft.risks && draft.risks.rows === Math.min(6, riskTotal), `草稿风险表限量 ${draft.risks ? draft.risks.rows : "?"} 行（共 ${riskTotal} 项）`);
  if (riskTotal > 6) {
    assert(/展开其余 \d+ 项/.test(draft.risks.more) && draft.risks.btn, "超量风险给出展开入口（" + draft.risks.more.trim() + "）");
  } else {
    assert(!draft.risks.btn && !draft.risks.more.trim(), `风险 ${riskTotal} 项未超上限，不出展开入口`);
  }
  await shot("07-draft-1440", true);

  if (riskTotal > 6) {
    const risksExpanded = await evaluate(`(() => {
      const b = [...document.querySelectorAll('#dlSheetHost [data-dl-act="risks"]')][0];
      const before = b.closest(".dl-sec").querySelectorAll(".dl-row.body").length;
      b.click();
      return before;
    })()`);
    await sleep(350);
    const risksAfter = await evaluate(`(() => {
      const sec = [...document.querySelectorAll("#dlSheetHost .dl-sec")].find(s => /后续计划与风险/.test((s.querySelector("h2")||{}).textContent||""));
      return { rows: sec.querySelectorAll(".dl-row.body").length, collapse: /收起/.test(sec.textContent) };
    })()`);
    assert(risksAfter.rows === riskTotal && risksAfter.rows > risksExpanded && risksAfter.collapse,
      `展开风险 ${risksExpanded} → ${risksAfter.rows} 行，并可收起`);
    await evaluate(`document.querySelector('#dlSheetHost [data-dl-act="risks"]').click(); true`);
    await sleep(300);
  }

  /* 9b. 客户版未确认发布 → 不可导出；管理版可导出但带草稿水印 */
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="customer"]').click(); true`);
  await sleep(500);
  const custGate = await evaluate(`(() => {
    const sheet = document.querySelector("#dlSheetHost .dl-sheet");
    return { warning: (sheet.querySelector(".dl-doc-warning")||{}).textContent || "",
      banner: (document.getElementById("dlBanner")||{}).textContent || "" };
  })()`);
  assert(custGate.warning.indexOf("客户版不可导出") >= 0, "客户版明说不可导出");
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="export"]').click(); true`);
  await sleep(600);
  const blockedToast = await evaluate(`(() => {
    const t = [...document.querySelectorAll(".toast-layer .toast, .toast")].map(x => x.textContent).join(" | ");
    return { toast: t, dialog: !!document.getElementById("dlExportBody") };
  })()`);
  assert(!blockedToast.dialog && /客户版不可导出/.test(blockedToast.toast), "客户版导出被拦住并提示（" + blockedToast.toast.slice(0, 70) + "）");
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').click(); true`);
  await waitFor(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').getAttribute("aria-pressed") === "true"`, "草稿切管理版", 8000);
  await sleep(500);
  const mgr = await evaluate(`(() => {
    const sheet = document.querySelector("#dlSheetHost .dl-sheet");
    return { watermark: !!sheet.querySelector(".dl-watermark"), warning: !!sheet.querySelector(".dl-doc-warning"),
      tone: document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').getAttribute("aria-pressed") };
  })()`);
  assert(mgr.tone === "true" && mgr.watermark && mgr.warning, "管理版可导出但草稿水印与警示仍在");
  const mgrBanner = await evaluate(`(() => {
    const b = document.getElementById("dlBanner");
    return { text: b.textContent, accept: !!b.querySelector('[data-dl-act="accept-all"]'),
      goto: !!b.querySelector('[data-dl-act="goto-pending"]') };
  })()`);
  assert(mgrBanner.accept && mgrBanner.goto && /待确认/.test(mgrBanner.text),
    "管理版草稿横幅同时给出「未确认发布」与「文字待确认」两条下一步");
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="internal"]').click(); true`);
  await sleep(500);
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="share"]').click(); true`);
  await sleep(600);
  const noShare = await evaluate(`(() => ({
    dialog: !!document.getElementById("dlShareBody"),
    toast: [...document.querySelectorAll(".toast-layer .toast, .toast")].map(x => x.textContent).join(" | ")
  }))()`);
  assert(!noShare.dialog && /内部/.test(noShare.toast), "内部版不提供分享链接（" + noShare.toast.slice(0, 60) + "）");

  /* ---------- 10. 移动端工作台 ---------- */
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').click(); true`);
  await sleep(400);
  /* headless 多标签下 resize / matchMedia change 不派发，body[data-layout] 会停在 desktop。
     按真机路径验证：先设手机视口，再冷加载整页，让首屏的档位判定自己跑一遍。 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await hardOpen(BASE + "/#/delivery");
  await waitFor(`document.body.dataset.view === "delivery" && document.body.dataset.layout === "mobile"`, "手机档位冷加载", 25000);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(DRAFT)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sec").length > 3`, "手机端纸张渲染", 25000);
  /* 冷加载读的是落库的语气，上面那次点击可能还没防抖落库：这里显式切一次并等它生效 */
  await evaluate(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').click(); true`);
  await waitFor(`document.querySelector('.dl-rail [data-dl-act="tone"][data-dl-val="manager"]').getAttribute("aria-pressed") === "true"`, "手机端切到管理版", 8000);
  await sleep(500);
  const mob = await evaluate(`(() => {
    const rail = document.querySelector(".dl-rail");
    const r = rail.getBoundingClientRect();
    const work = document.querySelector(".dl-work");
    return { docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      mq: matchMedia("(max-width:860px)").matches, layout: document.body.dataset.layout,
      cols: getComputedStyle(work).gridTemplateColumns,
      railW: Math.round(r.width), railTop: Math.round(r.top),
      controls: rail.querySelectorAll("select,input,button[data-dl-val]").length,
      chain: (() => { const out = []; let el = rail.parentElement;
        while(el && el !== document.documentElement){ out.push(el.tagName + "." + el.className + "=" + Math.round(el.getBoundingClientRect().width)); el = el.parentElement; }
        return out.join(" < ") + " || body." + document.body.className; })(),
      side: (() => { const s = document.getElementById("sideNav") || document.querySelector(".sidebar");
        return s ? Math.round(s.getBoundingClientRect().width) + "/" + getComputedStyle(s).position + "/" + getComputedStyle(s).display : "none"; })(),
      clipped: [...document.querySelectorAll("#dlSheetHost .dl-sec")].filter(s => s.scrollWidth > s.clientWidth + 2).length };
  })()`);
  assert(mob.layout === "mobile", "手机档位生效（body[data-layout]=" + mob.layout + "）");
  assert(mob.docW <= mob.innerW + 1, `工作台手机端无横向溢出（${mob.docW}/${mob.innerW}）`);
  assert(mob.railW > 200 && mob.controls >= 7, `手机端控制区仍可达（宽 ${mob.railW}px，${mob.controls} 个控件，单列=${mob.cols}）`);
  assert(mob.clipped === 0, `手机端纸张区块无裁切（${mob.clipped} 个溢出）`);
  await shot("08-workbench-390", true);
  /* 手机端导出弹层：wide 尺寸套不到 .sheet.md 的头/脚固定，主按钮会被整层滚动推出屏幕 */
  await evaluate(`(() => { const b = document.querySelector('[data-dl-act="accept-all"]'); if (b) b.click(); return true; })()`);
  await sleep(500);
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="export"]').click(); true`);
  await sleep(900);
  const mobGate = await evaluate(`(() => ({
    dialog: !!document.getElementById("dlExportBody"),
    pending: Number(document.getElementById("dlMeterPending").textContent),
    accept: !!document.querySelector('[data-dl-act="accept-all"]'),
    toast: [...document.querySelectorAll(".toast")].map(x => x.textContent).join(" | ")
  }))()`);
  assert(mobGate.dialog, `手机端导出弹层可打开（待确认 ${mobGate.pending}，提示：${mobGate.toast.slice(0, 60) || "无"}）`);
  await waitFor(`!!document.querySelector("#dlExportBody #dlPaper .dl-sheet")`, "手机端导出预览", 12000);
  await evaluate(`import("./js/core/ui.js").then(({UI}) => { UI.toast("手机端对照吐司", "fs"); return true; })`);
  await sleep(700);
  const mobDlg = await evaluate(`(() => {
    const go = document.getElementById("dlExportGo"), r = go.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
    const body = document.querySelector(".dl-dlg .sheet-body");
    const p = document.querySelector("#dlPaper .dl-sheet");
    return { inView: r.top >= 0 && r.bottom <= window.innerHeight,
      covered: !go.contains(hit), hit: hit ? (hit.id || hit.className) : null,
      bodyScrolls: getComputedStyle(body).overflowY === "auto" && body.clientHeight > 0,
      footPinned: (() => { const f = document.querySelector(".dl-dlg .sheet-foot").getBoundingClientRect();
        return f.bottom <= window.innerHeight + 1 && f.top > 0; })(),
      docW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      a4: p.classList.contains("dl-a4"),
      cols: getComputedStyle(p.querySelector(".dl-doc-meta")).gridTemplateColumns.split(" ").length };
  })()`);
  assert(mobDlg.inView && !mobDlg.covered,
    `手机端导出主按钮在可视区内且未被吐司遮挡（命中 ${mobDlg.hit}）`);
  assert(mobDlg.bodyScrolls && mobDlg.footPinned && mobDlg.docW <= mobDlg.innerW + 1,
    `手机端导出弹层正文可独立滚动、页脚固定、无横向溢出（${mobDlg.docW}/${mobDlg.innerW}）`);
  assert(mobDlg.a4 && mobDlg.cols === 2, "手机端预览纸仍是 A4 排版");
  await shot("08b-mobile-export-390");
  await evaluate(`document.querySelector(".dl-dlg.open [data-dl-close]").click(); true`);
  await sleep(400);
  await call("Emulation.clearDeviceMetricsOverride", {});
  await sleep(400);

  /* ---------- 11. 快照记录与往返 ---------- */
  await evaluate(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${WS}/select", {})).then(() => true)`);
  await hardOpen(BASE + "/#/delivery");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "回到富路径空间", 25000);
  await evaluate(`import("./js/views/delivery.js").then(m => { m.openDeliveryNote(${JSON.stringify(RICH)}, ""); return true; })`);
  await waitFor(`document.querySelectorAll("#dlSheetHost .dl-sec").length > 3`, "回到工作台", 25000);
  await evaluate(`document.querySelector('.dl-acts [data-dl-act="snapshots"]').click(); true`);
  await waitFor(`document.querySelectorAll("#dlSnapBody .dl-snap").length > 0`, "快照记录列表", 15000);
  const snaps = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("#dlSnapBody .dl-snap")];
    return { n: rows.length, text: rows.map(r => r.textContent.replace(/\\s+/g," ").trim()).join(" || ") };
  })()`);
  assert(snaps.n >= 1, `快照记录 ${snaps.n} 份`);
  assert(/DS-\d{8}-\d{2}/.test(snaps.text), "快照记录带对外编号");
  await shot("09-snapshots");
  await evaluate(`document.querySelector("#dlSnapBody .dl-snap button").click(); true`);
  await waitFor(`!!document.querySelector(".dl-rail.locked")`, "打开历史快照", 15000);
  pass("从快照记录打开历史快照并锁定控制区");
  await evaluate(`document.querySelector('.dl-lockbar [data-dl-act="back-draft"]').click(); true`);
  await waitFor(`!document.querySelector(".dl-rail.locked")`, "回到当前草稿", 15000);
  pass("回到当前草稿可继续编辑");

  /* ---------- 12. 深色主题 ---------- */
  await evaluate(`document.documentElement.setAttribute("data-theme","dark"); true`);
  await sleep(500);
  const dark = await evaluate(`(() => {
    const sheet = document.querySelector("#dlSheetHost .dl-sheet");
    const cs = getComputedStyle(sheet);
    const band = getComputedStyle(document.querySelector("#dlSheetHost .dl-doc-head"));
    return { bg: cs.backgroundColor, color: cs.color, band: band.backgroundImage.slice(0, 40),
      stops: band.backgroundImage.split("rgb(").length - 1 };
  })()`);
  assert(dark.bg !== "rgba(0, 0, 0, 0)" && dark.band.indexOf("gradient") >= 0, `深色主题纸张与头图生效（${dark.bg}）`);
  /* 头图是蓝→紫→绿三段：末段停在成功绿上，褪成中性面就丢了原型里「已核验」的暗示 */
  assert(dark.stops === 3, `深色头图保留三段异色渐变（${dark.stops} 个色标）`);
  await shot("10-dark-1440", true);

  /* 12b. 深色下打印：临时切回浅色令牌，印完还原 */
  await watchPrint();
  const darkPdf = await printPdf("workbench-dark");
  const darkSeen = JSON.parse(await evaluate(`JSON.stringify(window.__dlPrintSeen)`));
  const rgb = s => (String(s || "").match(/\d+/g) || []).map(Number);
  const lum = c => c.length >= 3 ? c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 : -1;
  assert(darkSeen && darkSeen.theme === null && lum(rgb(darkSeen.ink)) >= 0 && lum(rgb(darkSeen.ink)) < 128
    && lum(rgb(darkSeen.paper)) > 200,
    `深色下打印临时切回浅色纸面（油墨 ${darkSeen ? darkSeen.ink : "?"} / 纸面 ${darkSeen ? darkSeen.paper : "?"}）`);
  assert(darkPdf.textOps > 300 && darkPdf.sizes[0] === "595x842", `深色下打印仍是非空白 A4（${darkPdf.pages} 页）`);
  const darkClean = await printCleanup();
  assert(!darkClean.host && darkClean.theme === "dark", "打印结束还原深色主题");
  await evaluate(`document.documentElement.removeAttribute("data-theme"); true`);
  await sleep(300);

  /* 12c. 甘特打印不被交付说明抢走：顶层 @page A3 横向 + 活 DOM 打印 */
  await evaluate(`location.hash = "#/gantt"; true`);
  await waitFor(`document.body.dataset.view === "gantt" && document.querySelectorAll(".gantt-bar").length > 0`, "甘特渲染", 25000);
  await sleep(700);
  const ganttPdf = await printPdf("gantt-after-delivery");
  assert(ganttPdf.sizes.length === 1 && ganttPdf.sizes[0] === "1191x842",
    `交付说明打印过后，甘特仍是 A3 横向（实际 ${ganttPdf.sizes.join(",") || "未知"}）`);
  assert(ganttPdf.textOps > 100, `甘特打印非空白（${ganttPdf.textOps} 处文字绘制）`);
  const ganttClean = await printCleanup();
  assert(!ganttClean.host && !ganttClean.marker, "甘特打印不挂交付纸张宿主");
  await shot("11-gantt-print-guard", true);

  /* ---------- 13. 控制台 ---------- */
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1 && !/Failed to load resource.*404/.test(e));
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 400) + "）" : ""));
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);