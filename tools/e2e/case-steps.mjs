/* 用例步骤编辑器（插行 / 上移 / 下移 / 删除）E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-steps.mjs
   覆盖：桌面行内插行/排序/删除/边界禁用/Ctrl+Enter、390 宽移动端布局、查看者只读态隐藏操作。
   只读态用本地演示数据自带的 viewer 账号 wujun，不改动任何权限数据。 */
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
  };
  /* 点行先进阅读态抽屉，步骤编辑器点「编辑」才出现 */
  const openFirstCase = async (edit = true) => {
    await evaluate("document.querySelector('[data-tc-open]').click()");
    await waitFor(`(() => {
      const d = document.getElementById('dlgCase'), v = document.getElementById('caseDetailView');
      return !!d && d.classList.contains('open') && !!v && !v.hidden && !!v.querySelector('h2');
    })()`, "用例抽屉阅读态");
    if(edit){
      await evaluate("document.querySelector('#caseDetailView [data-case-edit]').click()");
      await waitFor("!document.getElementById('caseEditBody').hidden && document.querySelectorAll('#tcSteps .tc-step-row').length > 0", "用例编辑态");
    }
    await sleep(450); /* 等开框过渡结束再截图，避免半透明叠影 */
  };
  const closeCase = async () => {
    await evaluate(`(() => {
      const edit = document.getElementById('caseEditBody');
      if(edit && !edit.hidden) document.getElementById('dlgCaseX').click();
      else {
        const b = document.querySelector('#caseDetailView [data-case-close]');
        if(b) b.click();
      }
      return true;
    })()`);
    await waitFor("getComputedStyle(document.getElementById('dlgCase')).display === 'none'", "关闭用例抽屉");
  };

  console.log("用例步骤交互 E2E\n  地址：" + BASE);

  /* ---------------- A 桌面：插行 / 排序 / 删除 ---------------- */
  await setViewport(1440, 900, false);
  await login("admin");
  await openCases();
  await openFirstCase();
  const a = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const $ = s => document.querySelector(s);
    const rows = () => [...document.querySelectorAll('#tcSteps .tc-step-row')];
    const texts = () => rows().map(r => r.querySelectorAll('textarea')[0].value);
    const orig = texts();
    const out = { btns: rows()[0].querySelectorAll('.tc-step-acts button').length };
    $('#tcSteps [data-step-add="0"]').click(); await wait(40);
    out.insert = rows().length === orig.length + 1 && texts()[1] === ''
      && document.activeElement === rows()[1].querySelectorAll('textarea')[0];
    rows()[1].querySelectorAll('textarea')[0].value = '中间插入';
    $('#tcSteps [data-step-down="1"]').click(); await wait(40);
    out.down = texts()[2] === '中间插入';
    $('#tcSteps [data-step-up="2"]').click(); await wait(40);
    out.up = texts()[1] === '中间插入';
    out.boundary = rows()[0].querySelector('[data-step-up]').disabled
      && rows()[rows().length - 1].querySelector('[data-step-down]').disabled;
    $('#tcSteps [data-step-del="1"]').click(); await wait(40);
    out.del = JSON.stringify(texts()) === JSON.stringify(orig);
    const ta = rows()[0].querySelectorAll('textarea')[0]; ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); await wait(40);
    out.ctrlEnter = rows().length === orig.length + 1 && texts()[1] === '';
    out.staysOpen = getComputedStyle(document.getElementById('dlgCase')).display !== 'none';
    $('#tcSteps [data-step-del="1"]').click(); await wait(40);
    out.numbers = rows().map(r => r.querySelector('.tc-step-no').textContent).join(',') === orig.map((_, i) => i + 1).join(',');
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
  await openFirstCase();
  const b = await evaluate(`(() => {
    const row = document.querySelector('#tcSteps .tc-step-row');
    const acts = row.querySelector('.tc-step-acts');
    const ar = acts.getBoundingClientRect();
    const ta = row.querySelectorAll('textarea')[0].getBoundingClientRect();
    return { layout: document.body.dataset.layout, actsRight: ar.right, actsVisible: ar.width > 0 && getComputedStyle(acts).display !== 'none', taWidth: ta.width, overflow: document.getElementById('tcSteps').scrollWidth > document.getElementById('tcSteps').clientWidth + 1 };
  })()`);
  assert(b.layout === "mobile", "移动端布局生效");
  assert(b.actsVisible && b.actsRight <= 390, "操作按钮组在 390 宽内完整可见");
  assert(b.taWidth > 200 && !b.overflow, "步骤输入整行宽、无横向溢出");
  await shot("case-steps-mobile.png");
  await closeCase();

  /* ---------------- C 查看者：只读态隐藏全部行操作 ---------------- */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await openCases();
  await openFirstCase(false);
  const c = await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const view = document.getElementById('caseDetailView');
    const out = {
      read: !view.hidden && document.getElementById('caseEditBody').hidden,
      title: (view.querySelector('.case-detail-head h2') || {}).textContent || "",
      canEdit: !!view.querySelector('[data-case-edit]'),
      canRun: !!view.querySelector('[data-case-run]'),
      titleEditable: !!view.querySelector('[data-case-title-edit]')
    };
    const stepsTab = view.querySelector('[data-case-tab="steps"]');
    if(stepsTab){ stepsTab.click(); await wait(80); }
    out.stepCount = view.querySelectorAll('.case-steps-read li').length;
    out.stepActs = view.querySelectorAll('.tc-step-acts').length;
    out.stepInputs = view.querySelectorAll('textarea').length;
    return out;
  })()`);
  assert(c.read && c.title.trim().length > 0, "查看者打开为阅读态（" + c.title.trim() + "）");
  assert(!c.canEdit && !c.canRun && !c.titleEditable, "只读态不给编辑 / 记录执行 / 改标题入口");
  assert(c.stepCount > 0 && c.stepActs === 0 && c.stepInputs === 0, "步骤页签是只读列表，没有插行/排序/删除");
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