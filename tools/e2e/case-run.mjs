/* 执行链路 E2E · 真 Chrome + 本地栈（批次2：创建人/执行人、全局附件组件、执行弹框扩容、转缺陷联动）
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-run.mjs
   覆盖：
     A 桌面 admin：新建用例→记录失败(环境/代录执行人/备注/拖入证据)→执行历史(环境chip/在线预览/下载/拖拽补传)
       →转缺陷(环境预填/补充说明/携带证据)→缺陷抽屉「来源用例」反查回跳→缺陷tab来源用例chip；
     B 移动 390：执行弹框单列、无横向溢出；
     C 查看者 wujun：执行/转缺陷被只读拦截，历史无补传/删除。
   每次运行新建一条带时间戳的用例，避免污染既有缺陷关联，可重复跑。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";
const SHOT_DIR = path.resolve("docs/audit/prototypes");

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
const port = 9232;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-run-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
let cdp = null;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  await cdp.send("Page.bringToFront", {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const setViewport = (width, height, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  const shot = async name => {
    await sleep(450);
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name);
  };
  const login = async user => {
    await call("Network.clearBrowserCookies", {});
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(user)});
      set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成 " + user, 12000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  };
  /* 进入用例视图并选到一个有用例的项目（admin 全部可写） */
  const openCases = async () => {
    await call("Page.navigate", { url: BASE + "/#/testcases" });
    await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
    await waitFor(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++){ if (document.querySelector('[data-tc-open]')) return true; await wait(200); }
      const sel = document.getElementById('tcReq');
      if (sel){
        for (const opt of [...sel.options]){
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 20; i++){ if (document.querySelector('[data-tc-open]')) return true; await wait(150); }
        }
      }
      return !!document.querySelector('[data-tc-open]');
    })()`, "用例列表", 30000);
  };
  const visible = id => `(() => { const el = document.getElementById(${JSON.stringify(id)}); return !!el && getComputedStyle(el).display !== 'none' && el.classList.contains('open'); })()`;

  console.log("执行链路 E2E\n  地址：" + BASE);

  /* ---------------- A 桌面 admin：完整执行→证据→缺陷链路 ---------------- */
  await setViewport(1440, 900, false);
  await login("admin");
  await openCases();

  /* A0 新建一条带时间戳的用例（含步骤/前置/数据），保证可重复跑且不污染既有缺陷关联 */
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { rt } = await import("./js/core/state.js");
    const sel = document.getElementById('tcReq');
    const reqId = sel ? sel.value : "";
    if(!reqId) return { error: "没有可用项目" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId, title: "E2E 执行链路 " + stamp, priority: "P1", module: "回归",
      precondition: "已登录且网络正常", testData: "账号 admin / 123456",
      steps: [ { action: "打开登录页", expected: "页面正常渲染" }, { action: "输入错误密码提交", expected: "提示密码错误且不跳转" } ]
    });
    window.__e2e = { reqId, caseId: created.id, stamp };
    /* 重新加载该项目用例列表，让新用例行出现 */
    sel.value = reqId; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { reqId, caseId: created.id, createdBy: created.createdBy || null, me: rt.currentUser.displayName };
  })()`);
  assert(!seed.error && !!seed.caseId, "新建 E2E 用例成功" + (seed.error ? "：" + seed.error : ""));
  await waitFor(`!!document.querySelector('[data-tc-open="${seed.caseId}"]')`, "新用例行渲染");

  /* A1 创建人 ≠ 执行人：行 meta 显示创建人；首次执行按钮文案为「执行」 */
  const a1 = await evaluate(`(() => {
    const row = document.querySelector('[data-tc-open="${seed.caseId}"]');
    const meta = row.querySelector('.tc-meta').textContent;
    const runBtn = row.querySelector('[data-tc-run]');
    return { metaHasCreator: meta.indexOf('创建：') >= 0, runLabel: runBtn ? runBtn.textContent.trim() : "", hasDefect: !!row.querySelector('[data-tc-defect]') };
  })()`);
  assert(a1.metaHasCreator, "用例行显示创建人（创建：…）");
  assert(a1.runLabel === "执行", "首次执行按钮文案为「执行」");
  assert(!a1.hasDefect, "未执行时不出现「转缺陷」");

  /* A2 打开执行弹框：双列布局、上下文步骤、轮次、执行人下拉、环境字段 */
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "执行弹框打开");
  await waitFor(`!!document.querySelector('#runContext .rc-steps li, #runContext .rc-empty')`, "上下文渲染");
  const a2 = await evaluate(`(() => {
    const sheet = document.querySelector('#dlgCaseRun .sheet');
    const grid = document.querySelector('#dlgCaseRun .run-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const ctx = document.getElementById('runContext');
    const exec = document.getElementById('runExecutor');
    return {
      sheetMd: sheet.classList.contains('md'),
      cols,
      steps: document.querySelectorAll('#runContext .rc-steps li').length,
      round: (document.querySelector('#runContext .rc-round') || {}).textContent || "",
      facts: (document.querySelector('#runContext .rc-facts') || {}).textContent || "",
      execOptions: exec.options.length,
      execValue: exec.value,
      hasEnv: !!document.getElementById('runEnvironment'),
      hasKit: !!document.querySelector('#runKitMount .att-drop'),
      title: document.getElementById('runFormTitle').textContent
    };
  })()`);
  assert(a2.sheetMd && a2.cols === 2, "执行弹框为 md 双列布局");
  assert(a2.steps === 2, "上下文展示 2 条执行步骤");
  assert(a2.round.indexOf("首次执行") >= 0, "首轮显示「首次执行」");
  assert(a2.facts.indexOf("创建人") >= 0, "上下文显示创建人");
  assert(a2.execOptions >= 1 && !!a2.execValue, "执行人下拉默认当前登录人");
  assert(a2.hasEnv && a2.hasKit, "含执行环境字段与全局附件拖拽区");
  await shot("case-run-dialog.png");

  /* A3 记录失败：环境 + 备注 + 拖入证据（注入 PNG 到 kit），提交后上传 */
  const a3 = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const setVal = (id, v) => { const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    document.querySelector('#segCaseRun [data-run-status="failed"]').click();
    setVal("runEnvironment", "Chrome 120 / macOS 14");
    setVal("runNote", "刷新后可复现，疑似缓存未清");
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d'); x.fillStyle = '#B42318'; x.fillRect(0, 0, 16, 16);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'e2e-失败截图.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const inp = document.querySelector('#runKitMount .att-drop-input');
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(120);
    const chipBefore = document.querySelectorAll('#runKitMount .att-chip.pending').length;
    document.getElementById('btnDoRun').click();
    return { chipBefore };
  })()`);
  assert(a3.chipBefore === 1, "拖入证据后待传清单出现 1 个 chip");
  await waitFor(`!document.getElementById('dlgCaseRun').classList.contains('open')`, "记录提交并关框", 25000);
  await waitFor(`(() => { const r = document.querySelector('[data-tc-open="${seed.caseId}"]'); return r && r.querySelector('.mini-tag.over'); })()`, "用例标记为失败");

  /* A4 失败后按钮变「重新执行」并出现「转缺陷」 */
  const a4 = await evaluate(`(() => {
    const row = document.querySelector('[data-tc-open="${seed.caseId}"]');
    return { runLabel: row.querySelector('[data-tc-run]').textContent.trim(), hasDefect: !!row.querySelector('[data-tc-defect]') };
  })()`);
  assert(a4.runLabel === "重新执行", "已有结果后按钮文案为「重新执行」");
  assert(a4.hasDefect, "失败后出现「转缺陷」入口");

  /* A5 执行历史：环境 chip、证据在线预览 + 下载按钮 */
  await evaluate(`document.querySelector('[data-tc-runs="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRuns"), "执行历史弹框");
  await waitFor(`!!document.querySelector('#runsList .run-item')`, "历史行渲染");
  const a5 = await evaluate(`(() => {
    const item = document.querySelector('#runsList .run-item');
    return {
      env: (item.querySelector('.run-env') || {}).textContent || "",
      canDrop: item.classList.contains('can-drop'),
      hasOpen: !!item.querySelector('[data-run-att-open]'),
      hasDownload: !!item.querySelector('[data-run-att-download]'),
      hasDelete: !!item.querySelector('[data-run-att-del]'),
      evCount: item.querySelectorAll('.run-ev').length
    };
  })()`);
  assert(a5.env.indexOf("Chrome 120") >= 0, "历史行展示执行环境 chip");
  assert(a5.canDrop, "可写历史行标记为可拖拽补传");
  assert(a5.evCount === 1 && a5.hasOpen && a5.hasDownload && a5.hasDelete, "证据含预览/下载/删除入口");
  await shot("case-run-history.png");

  /* A6 点证据缩略图 → 在线预览弹层打开且图片加载 */
  await evaluate(`document.querySelector('#runsList [data-run-att-open]').click()`);
  await waitFor(`(() => { const m = document.querySelector('.att-modal'); return m && !m.hidden; })()`, "预览弹层打开");
  const a6 = await evaluate(`(() => {
    const m = document.querySelector('.att-modal');
    const img = m.querySelector('img');
    return { name: (m.querySelector('.ap-name') || {}).textContent || "", imgSrc: img ? img.getAttribute('src') : "" };
  })()`);
  assert(!!a6.imgSrc && a6.imgSrc.indexOf("/api/attachments/") >= 0, "图片证据在线预览加载站内附件");
  await shot("case-run-preview.png");
  await evaluate(`(() => { const x = document.querySelector('.att-modal .ap-close'); if(x) x.click(); return true; })()`);
  await waitFor(`(() => { const m = document.querySelector('.att-modal'); return !m || m.hidden; })()`, "预览弹层关闭");

  /* A7 拖拽补传：把第二张图直接 drop 到历史行，附件数 +1 */
  const beforeCount = await evaluate(`document.querySelectorAll('#runsList .run-item .run-ev').length`);
  await evaluate(`(async () => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d'); x.fillStyle = '#175CD3'; x.fillRect(0, 0, 16, 16);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'e2e-补传日志.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const row = document.querySelector('#runsList .run-item.can-drop');
    row.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('#runsList .run-item .run-ev').length > ${beforeCount}`, "拖拽补传成功", 25000);
  const a7 = await evaluate(`document.querySelectorAll('#runsList .run-item .run-ev').length`);
  assert(a7 === beforeCount + 1, "拖入历史行后证据数 +1（" + beforeCount + "→" + a7 + "）");
  await evaluate(`document.getElementById('dlgCaseRunsX').click()`);
  await waitFor(`!document.getElementById('dlgCaseRuns').classList.contains('open')`, "关闭执行历史");

  /* A8 转缺陷：环境预填、证据清单、携带勾选、补充说明 */
  await waitFor(`!!document.querySelector('[data-tc-defect="${seed.caseId}"]')`, "转缺陷入口就绪（列表刷新后）");
  await evaluate(`document.querySelector('[data-tc-defect="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseDefect"), "转缺陷弹框");
  await waitFor(`document.getElementById('defectEvCount').textContent.length > 0`, "证据清单异步补齐");
  const a8 = await evaluate(`(() => {
    const setVal = (id, v) => { const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    const env = document.getElementById('defectEnvironment').value;
    const carry = document.getElementById('defectCarry');
    const chips = document.querySelectorAll('#defectEvidenceList .att-chip').length;
    document.getElementById('defectSeverity').value = 'critical';
    document.getElementById('defectSeverity').dispatchEvent(new Event('change', { bubbles: true }));
    setVal('defectNote', '补充：仅 macOS 复现，Windows 正常');
    return { env, carryChecked: carry.checked, carryDisabled: carry.disabled, chips };
  })()`);
  assert(a8.env.indexOf("Chrome 120") >= 0, "发现环境预填上一轮执行环境");
  assert(a8.chips >= 1 && a8.carryChecked && !a8.carryDisabled, "展示失败证据清单且默认携带");
  await shot("case-defect-dialog.png");
  await evaluate(`document.getElementById('btnDoDefect').click()`);
  await waitFor(`!document.getElementById('dlgCaseDefect').classList.contains('open')`, "缺陷创建并关框", 25000);

  /* A9 缺陷抽屉自动打开：描述含补充说明/环境，附件携带证据，「来源用例」反查行 */
  await waitFor(`(() => { const d = document.getElementById('taskDrawer'); return d && d.classList.contains('on'); })()`, "缺陷抽屉打开", 25000);
  await waitFor(`(() => { const dd = document.getElementById('readSourceCase'); return dd && dd.querySelectorAll('.ev-case-link').length > 0; })()`, "来源用例反查行", 25000);
  const a9 = await evaluate(`(async () => {
    const { rt } = await import("./js/core/state.js");
    const dd = document.getElementById('readSourceCase');
    const link = dd.querySelector('.ev-case-link');
    const desc = (document.getElementById('readDesc') || {}).textContent || "";
    window.__e2e.bugId = rt.editingId;
    window.__e2e.caseLinkReq = link.getAttribute('data-ev-case-req');
    window.__e2e.caseLinkId = link.getAttribute('data-ev-case');
    return {
      linkText: link.textContent,
      linkReq: link.getAttribute('data-ev-case-req'),
      linkId: link.getAttribute('data-ev-case'),
      descHasNote: desc.indexOf('仅 macOS 复现') >= 0,
      descHasEnv: desc.indexOf('Chrome 120') >= 0
    };
  })()`);
  assert(a9.linkId === seed.caseId, "来源用例反查指向本用例");
  assert(a9.linkText.indexOf("TC-") === 0, "来源用例 chip 带用例编号");
  assert(a9.descHasNote, "缺陷描述含转缺陷补充说明");
  assert(a9.descHasEnv, "缺陷描述含执行环境");
  await shot("case-defect-drawer.png");

  /* A10 缺陷附件携带了失败证据（物理复制，至少 1 个） */
  const a10 = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const list = await API.getAllPages("/api/tasks/" + encodeURIComponent(window.__e2e.bugId) + "/attachments");
    return { count: list.length, names: list.map(a => a.filename) };
  })()`);
  assert(a10.count >= 1, "缺陷附件携带失败证据（" + a10.count + " 个）");

  /* A11 点「来源用例」回跳用例视图并打开该用例 */
  await evaluate(`document.querySelector('#readSourceCase .ev-case-link').click()`);
  await waitFor(`document.body.dataset.view === 'testcases'`, "回跳用例视图", 25000);
  await waitFor(visible("dlgCase"), "来源用例编辑弹框打开", 25000);
  await waitFor(`(() => { const el = document.getElementById('cTitle'); return el && el.value.indexOf('E2E 执行链路') >= 0; })()`, "来源用例标题回填", 25000);
  const a11 = await evaluate(`(() => {
    return { header: document.getElementById('caseFormTitle').textContent, title: document.getElementById('cTitle').value };
  })()`);
  assert(a11.title.indexOf("E2E 执行链路") >= 0, "回跳打开的是来源用例（" + a11.header + "）");
  await evaluate(`document.getElementById('dlgCaseX').click()`);
  await waitFor(`!document.getElementById('dlgCase').classList.contains('open')`, "关闭用例弹框");

  /* A12 缺陷 tab：来源用例 chip 可点（data-tc-def-case） */
  await evaluate(`(async () => { const m = await import("./js/views/testcases.js"); m.setTcMode("defects"); return true; })()`);
  await waitFor(`!!document.querySelector('[data-tc-def-case]')`, "缺陷 tab 来源用例 chip", 25000);
  const a12 = await evaluate(`(() => {
    const chip = document.querySelector('[data-tc-def-case="${seed.caseId}"]') || document.querySelector('[data-tc-def-case]');
    return { exists: !!chip, req: chip ? chip.getAttribute('data-tc-def-case-req') : "" };
  })()`);
  assert(a12.exists && !!a12.req, "缺陷 tab 渲染可点来源用例 chip");

  /* ---------------- B 移动 390：执行弹框单列、无横向溢出 ---------------- */
  await setViewport(390, 844, true);
  /* 先 blank 再进用例视图，强制整页重载：A12 把视图切到了缺陷 tab，同 URL 导航不会重置 tcMode */
  await call("Page.navigate", { url: "about:blank" });
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.layout === 'mobile' && document.body.dataset.view === 'testcases'", "移动布局");
  /* 移动端 fresh 加载默认项目可能不是种子用例所在项目：等下拉就绪后显式切到该项目再等行渲染 */
  await waitFor(`(() => { const sel = document.getElementById('tcReq'); return sel && [...sel.options].some(o => o.value === ${JSON.stringify(seed.reqId)}); })()`, "移动端项目下拉就绪", 25000);
  await evaluate(`(() => { const sel = document.getElementById('tcReq'); sel.value = ${JSON.stringify(seed.reqId)}; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(`!!document.querySelector('[data-tc-run="${seed.caseId}"]')`, "移动端用例执行按钮", 25000);
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "移动端执行弹框");
  await waitFor(`!!document.querySelector('#runContext .rc-steps li, #runContext .rc-empty')`, "移动端上下文");
  const b = await evaluate(`(() => {
    const grid = document.querySelector('#dlgCaseRun .run-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const sheet = document.querySelector('#dlgCaseRun .sheet');
    const sr = sheet.getBoundingClientRect();
    const formRow = document.querySelector('#dlgCaseRun .run-form-row');
    const frCols = getComputedStyle(formRow).gridTemplateColumns.split(' ').length;
    return { layout: document.body.dataset.layout, cols, frCols, sheetRight: sr.right, overflow: document.documentElement.scrollWidth > 391 };
  })()`);
  assert(b.layout === "mobile", "移动端布局生效");
  assert(b.cols === 1 && b.frCols === 1, "执行弹框与表单行移动端单列");
  assert(b.sheetRight <= 391 && !b.overflow, "弹框在 390 宽内、无横向溢出");
  await shot("case-run-mobile.png");
  await evaluate(`document.getElementById('dlgCaseRunX').click()`);
  await waitFor(`!document.getElementById('dlgCaseRun').classList.contains('open')`, "移动端关框");

  /* ---------------- C 查看者 wujun：只读拦截 ---------------- */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await openCases();
  const c = await evaluate(`(() => {
    const row = document.querySelector('[data-tc-open]');
    return { hasRun: !!row.querySelector('[data-tc-run]'), hasDefect: !!row.querySelector('[data-tc-defect]'), hasRuns: !!row.querySelector('[data-tc-runs]') };
  })()`);
  assert(!c.hasRun && !c.hasDefect, "查看者用例行无执行/转缺陷按钮");
  assert(c.hasRuns, "查看者仍可看执行历史");
  await evaluate(`document.querySelector('[data-tc-runs]').click()`);
  await waitFor(visible("dlgCaseRuns"), "查看者执行历史");
  await waitFor(`!!document.querySelector('#runsList .run-item, #runsList .rep-empty')`, "查看者历史内容");
  const c2 = await evaluate(`(() => {
    const item = document.querySelector('#runsList .run-item');
    return {
      readonlyHint: !document.getElementById('runsReadonlyHint').hidden,
      canDrop: item ? item.classList.contains('can-drop') : false,
      hasDelete: item ? !!item.querySelector('[data-run-att-del]') : false,
      hasAdd: item ? !!item.querySelector('[data-run-file]') : false,
      hasDownload: item ? !!item.querySelector('[data-run-att-download]') : false
    };
  })()`);
  assert(c2.readonlyHint, "查看者历史显示只读提示");
  assert(!c2.canDrop && !c2.hasDelete && !c2.hasAdd, "查看者历史无拖拽补传/删除/上传");
  await shot("case-run-readonly.png");

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  assert(realErrors.length === 0, "无运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  if(cdp && cdp.errors.length) console.error("捕获的运行时错误：\n  " + cdp.errors.join("\n  "));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}