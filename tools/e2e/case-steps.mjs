/* 用例步骤编辑（插行 / 上移 / 下移 / 删除）E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass E2E_PASS=admin123 node tools/e2e/case-steps.mjs
   覆盖：桌面插行/排序/删除/边界禁用/Ctrl+Enter、390 宽移动端布局、查看者只读态隐藏操作。
   步骤编辑在详情抽屉的编辑态（草稿表格）进行；用例表单里的整表编辑器只服务新建。
   只读态用本地演示数据的 viewer 账号（E2E_VIEWER 覆盖，默认 wujun），不改动任何权限数据。 */
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
const port = 9231;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-steps-e2e-"));
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
  const openCases = async () => {
    await call("Page.navigate", { url: BASE + "/#/testcases" });
    await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
    /* 默认项目可能没有用例：逐个切换项目范围直到出现用例 */
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
    /* 全部项目概览只读（编辑/执行都不可用）：落到具体项目再测 */
    await evaluate(`(() => {
      const sel = document.getElementById('tcReq');
      if (!sel || !/^__/.test(sel.value)) return true;
      const opt = [...sel.options].find(o => !/^__/.test(o.value));
      if (!opt) return true;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(`!!document.querySelector('[data-tc-open]')`, "具体项目用例列表", 30000);
  };
  const closeCase = async () => {
    /* 编辑态先取消回阅读态，再关抽屉 */
    await evaluate(`(() => {
      const cancel = document.querySelector('#caseDetailView [data-case-edit-cancel]');
      if (cancel) cancel.click();
      return true;
    })()`);
    await sleep(200);
    await evaluate(`(() => {
      const x = document.getElementById('dlgCaseX');
      if (x) x.click();
      return true;
    })()`);
    await waitFor("getComputedStyle(document.getElementById('dlgCase')).display === 'none'", "关闭用例抽屉");
  };

  console.log("用例步骤交互 E2E\n  地址：" + BASE);

  /* A0 自建带 2 步的用例：列表首条不一定是可写项目带步骤的用例，步骤编辑必须基于确定数据 */
  await setViewport(1440, 900, false);
  await login("admin");
  await openCases();
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const sel = document.getElementById('tcReq');
    const opt = sel ? [...sel.options].find(o => !/^__/.test(o.value)) : null;
    if (!opt) return { error: "没有可用项目" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId: opt.value, title: "E2E 步骤交互 " + stamp, priority: "P2",
      steps: [ { action: "第一步", expected: "结果一" }, { action: "第二步", expected: "结果二" } ]
    });
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { caseId: created.id };
  })()`);
  assert(!seed.error && !!seed.caseId, "新建步骤 E2E 用例成功" + (seed.error ? "：" + seed.error : ""));
  await waitFor(`!!document.querySelector('[data-tc-open="${seed.caseId}"]')`, "新用例行渲染");
  /* 点行进阅读态抽屉，点「编辑」进草稿编辑态（抽屉内联编辑，非新建表单） */
  const openSeedCase = async () => {
    await evaluate(`document.querySelector('[data-tc-open="${seed.caseId}"]').click()`);
    await waitFor(`(() => {
      const d = document.getElementById('dlgCase'), v = document.getElementById('caseDetailView');
      return !!d && d.classList.contains('open') && !!v && !v.hidden && !!v.querySelector('h2');
    })()`, "用例抽屉阅读态");
    await evaluate("document.querySelector('#caseDetailView [data-case-edit]').click()");
    await waitFor("document.querySelectorAll('#caseDetailView [data-case-draft-step]').length > 0", "用例编辑态");
    await sleep(450); /* 等开框过渡结束再截图，避免半透明叠影 */
  };

  /* ---------------- A 桌面：插行 / 排序 / 删除 ---------------- */
  await openSeedCase();
  const a = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const box = () => document.getElementById('caseDetailView');
    const rows = () => [...box().querySelectorAll('.case-step-row')];
    const actTa = i => rows()[i].querySelector('[data-case-draft-step][data-k="action"]');
    const texts = () => rows().map(r => r.querySelector('[data-case-draft-step][data-k="action"]').value);
    const act = (name, i) => box().querySelector('[data-case-act="' + name + '"][data-i="' + i + '"]');
    const orig = texts();
    const out = { btns: rows()[0].querySelectorAll('.case-step-acts button').length };
    act('d-step-ins', 0).click(); await wait(60);
    out.insert = rows().length === orig.length + 1 && texts()[1] === ''
      && document.activeElement === actTa(1);
    actTa(1).value = '中间插入';
    actTa(1).dispatchEvent(new Event('input', { bubbles: true }));
    act('d-step-down', 1).click(); await wait(60);
    out.down = texts()[2] === '中间插入';
    act('d-step-up', 2).click(); await wait(60);
    out.up = texts()[1] === '中间插入';
    out.boundary = act('d-step-up', 0).disabled
      && act('d-step-down', rows().length - 1).disabled;
    act('d-step-del', 1).click(); await wait(60);
    out.del = JSON.stringify(texts()) === JSON.stringify(orig);
    const ta = actTa(0); ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); await wait(60);
    out.ctrlEnter = rows().length === orig.length + 1 && texts()[1] === '';
    out.staysOpen = getComputedStyle(document.getElementById('dlgCase')).display !== 'none';
    act('d-step-del', 1).click(); await wait(60);
    out.numbers = rows().map(r => r.querySelector('.case-step-no').textContent).join(',') === orig.map((_, i) => i + 1).join(',');
    return out;
  })()`);
  assert(a.btns === 4, "每行 4 个操作按钮（插入/上移/下移/删除）");
  assert(a.insert, "行内「+」在中间插行并聚焦新行");
  assert(a.down, "下移交换顺序");
  assert(a.up, "上移交换顺序");
  assert(a.boundary, "首行上移/末行下移禁用");
  assert(a.del, "删除中间行后内容复原");
  assert(a.ctrlEnter, "Ctrl+Enter 仍在下方插行");
  assert(a.staysOpen, "Ctrl+Enter 插行不触发全局保存关框");
  assert(a.numbers, "序号连续重排");
  await shot("case-steps-desktop.png");
  await closeCase();

  /* ---------------- B 移动端 390：布局不溢出、操作可达 ---------------- */
  await setViewport(390, 844, true);
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.layout === 'mobile' && document.body.dataset.view === 'testcases'", "移动布局");
  await openCases();
  await openSeedCase();
  const b = await evaluate(`(() => {
    const grid = document.querySelector('#caseDetailView .case-steps-grid');
    const row = grid.querySelector('.case-step-row');
    const acts = row.querySelector('.case-step-acts');
    const ar = acts.getBoundingClientRect();
    const ta = row.querySelector('[data-case-draft-step]').getBoundingClientRect();
    return { layout: document.body.dataset.layout, actsRight: ar.right, actsVisible: ar.width > 0 && getComputedStyle(acts).display !== 'none', taWidth: ta.width, overflow: grid.scrollWidth > grid.clientWidth + 1 };
  })()`);
  assert(b.layout === "mobile", "移动端布局生效");
  assert(b.actsVisible && b.actsRight <= 390, "操作按钮组在 390 宽内完整可见");
  assert(b.taWidth > 100 && !b.overflow, "步骤输入可用行宽（" + Math.round(b.taWidth) + "px）且无横向溢出");
  await shot("case-steps-mobile.png");
  await closeCase();

  /* ---------------- C 查看者：只读态隐藏全部行操作 ---------------- */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await openCases();
  await evaluate("document.querySelector('[data-tc-open]').click()");
  await waitFor(`(() => {
    const d = document.getElementById('dlgCase'), v = document.getElementById('caseDetailView');
    return !!d && d.classList.contains('open') && !!v && !v.hidden && !!v.querySelector('h2');
  })()`, "查看者用例抽屉");
  const c = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const view = document.getElementById('caseDetailView');
    const out = {
      read: !view.hidden,
      title: (view.querySelector('.case-detail-head h2') || {}).textContent || "",
      canEdit: !!view.querySelector('[data-case-edit]'),
      canRun: !!view.querySelector('[data-case-run]'),
      titleEditable: !!view.querySelector('[data-case-title-edit]')
    };
    const stepsTab = view.querySelector('[data-case-tab="steps"]');
    if(stepsTab){ stepsTab.click(); await wait(80); }
    out.stepActs = view.querySelectorAll('.case-step-acts').length;
    out.stepInputs = view.querySelectorAll('.case-step-input, textarea').length;
    out.roGrid = !!view.querySelector('.case-steps-grid.is-ro');
    return out;
  })()`);
  assert(c.read && c.title.trim().length > 0, "查看者打开为阅读态（" + c.title.trim() + "）");
  assert(!c.canEdit && !c.canRun && !c.titleEditable, "只读态不给编辑 / 记录执行 / 改标题入口");
  assert(c.roGrid && c.stepActs === 0 && c.stepInputs === 0, "步骤页签是只读表格，没有插行/排序/删除/输入框");
  await shot("case-steps-readonly.png");
  await closeCase();

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  assert(realErrors.length === 0, "无运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  process.exitCode = 1;
}finally{
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
