/* 用例详情抽屉 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-detail-drawer.mjs
   覆盖：点行进阅读态 → 四页签与计数 → 标题就地修改（保存并还原）→ 编辑后保存回阅读态 →
        记录执行叠层后返回 → Esc 关闭 → 390 宽铺满 → 查看者无写入口。
   视为浏览器验收：写操作只改标题并在结束时还原。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
const VIEWER = process.env.E2E_VIEWER || "wujun";
const OUT_DIR = path.resolve("docs/audit/prototypes/case-drawer-2026-11-15");

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

fs.mkdirSync(OUT_DIR, { recursive: true });
const chrome = findChrome();
const port = 9236;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-drawer-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
let cdp = null;
let restoreOriginal = null; /* 中途失败也要把用例标题还原，避免演示数据漂移 */
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
  /* 截图前清掉与画面无关的浮层（toast 常驻 0 秒、候选浮层），保证与原型对照干净 */
  const cleanFloaters = async () => {
    await evaluate(`(() => {
      /* 实时推送随时会插入新 toast，截图期间整块隐藏比逐个清更稳 */
      const w = document.getElementById("toastWrap"); if(w){ w.innerHTML = ""; w.style.display = "none"; }
      /* 未读通知气泡 6 秒自动出现/消失，截图时一并收起 */
      const b = document.getElementById("unreadBubble"); if(b) b.hidden = true;
      document.querySelectorAll(".combo-options").forEach(function(b){ b.hidden = true; });
      return true;
    })()`);
    await sleep(120);
  };
  const shot = async name => {
    await cleanFloaters();
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + path.join(OUT_DIR, name));
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
  /* 优先进有执行记录的用例：执行历史页签与「最近一次执行」才有内容可验 */
  const openFirstCase = async () => {
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-tc-open]')];
      /* 自建种子用例优先：步骤数与执行记录都确定，不赌演示数据 */
      const seedRow = window.__e2eSeedId ? rows.find(r => r.dataset.tcOpen === window.__e2eSeedId) : null;
      const withRun = rows.find(r => {
        const m = r.querySelector('.tc-meta-2');
        return m && m.textContent.indexOf('执行') >= 0;
      });
      const row = seedRow || withRun || rows[0];
      row.click();
      window.__e2eCaseId = row.dataset.tcOpen;
      return true;
    })()`);
    await waitFor(`(() => {
      const d = document.getElementById('dlgCase'), v = document.getElementById('caseDetailView');
      return !!d && d.classList.contains('open') && !!v && !v.hidden && !!v.querySelector('h2');
    })()`, "用例抽屉阅读态");
    await sleep(450); /* 等抽屉滑入结束再截图 */
  };
  const openReadCaseWithClose = async () => {
    await openFirstCase();
    await waitFor(`document.querySelector('#caseDetailView [data-count="runs"]').textContent.trim() !== '…'`, "页签计数落定", 15000);
  };
  const clickTab = async tab => {
    await evaluate(`document.querySelector('#caseDetailView [data-case-tab="${tab}"]').click()`);
    await sleep(120);
  };
  const closeDrawer = async () => {
    await evaluate(`document.querySelector('#caseDetailView [data-case-close]').click()`);
    await waitFor("getComputedStyle(document.getElementById('dlgCase')).display === 'none'", "关闭用例抽屉");
  };

  console.log("用例详情抽屉 E2E\n  地址：" + BASE + "\n  截图：" + OUT_DIR);

  /* ---------------- A 桌面：阅读态与页签 ---------------- */
  await setViewport(1440, 900, false);
  await login("admin");
  await openCases();
  /* A0 自建带 2 步 + 1 次执行的用例：步骤表格、计数与执行历史都要有确定内容 */
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const sel = document.getElementById('tcReq');
    const opt = sel ? [...sel.options].find(o => !/^__/.test(o.value)) : null;
    if (!opt) return { error: "没有可用项目" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId: opt.value, title: "E2E 抽屉 " + stamp, priority: "P2",
      steps: [ { action: "第一步", expected: "结果一" }, { action: "第二步", expected: "结果二" } ]
    });
    await API.post("/api/test-cases/" + encodeURIComponent(created.id) + "/runs", { status: "passed", note: "E2E 种子执行", stepResults: null, environment: null, executedByUserId: null });
    window.__e2eSeedId = created.id;
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { caseId: created.id };
  })()`);
  assert(!seed.error && !!seed.caseId, "新建抽屉 E2E 用例成功" + (seed.error ? "：" + seed.error : ""));
  await waitFor(`!!document.querySelector('[data-tc-open="${seed.caseId}"]')`, "新用例行渲染");
  await openReadCaseWithClose();
  const a = await evaluate(`(() => {
    const d = document.getElementById('dlgCase');
    const sheet = d.querySelector('.sheet').getBoundingClientRect();
    const view = document.getElementById('caseDetailView');
    const tabs = [...view.querySelectorAll('.case-detail-tabs [data-case-tab]')].map(t => ({
      key: t.dataset.caseTab,
      label: t.textContent.trim(),
      on: t.classList.contains('on')
    }));
    return {
      open: d.classList.contains('open'),
      editHidden: document.getElementById('caseEditBody').hidden,
      right: Math.round(sheet.right),
      vw: innerWidth,
      title: (view.querySelector('h2') || {}).textContent || '',
      meta: (view.querySelector('.case-detail-meta') || {}).textContent || '',
      tabs,
      keys: view.querySelectorAll('.case-keyrow .case-kcard').length,
      keysText: (view.querySelector('.case-keyrow') || {}).textContent || '',
      counts: ['runs','defects'].map(k => { const el = view.querySelector('[data-count="' + k + '"]'); return el ? el.textContent.trim() : null; }),
      hasEdit: !!view.querySelector('[data-case-edit]'),
      hasRun: !!view.querySelector('[data-case-run]'),
      canTitle: !!view.querySelector('[data-case-title-edit]'),
      backHidden: document.getElementById('caseEditBack').hidden
    };
  })()`);
  assert(a.open && a.editHidden, "点行打开阅读态抽屉，编辑表单不出现");
  assert(a.right === a.vw, "抽屉贴右缘（右边界 " + a.right + " = 视口 " + a.vw + "）");
  assert(a.title.trim().length > 0 && a.meta.indexOf(" · ") > 0, "标题与元信息就位");
  assert(a.tabs.length === 3 && a.tabs[0].on, "三个页签（概览/执行历史/缺陷）、默认打开概览");
  const tabLabels = a.tabs.map(t => t.label.replace(/\s+/g, " "));
  assert(tabLabels[0] === "概览" && /^执行历史 \d+$/.test(tabLabels[1]) && /^缺陷 \d+$/.test(tabLabels[2]),
    "页签带计数（" + tabLabels.join(" / ") + "）");
  assert(a.keys === 3 && /优先级/.test(a.keysText), "概览三张关键卡（含优先级）");
  assert(a.hasEdit && a.hasRun && a.canTitle && a.backHidden, "有权限时给编辑 / 记录执行 / 标题就地修改；阅读态不显示「取消」");
  await shot("read-1440.png");

  /* B 页签：概览内嵌步骤只读表格 / 执行历史 / 缺陷 */
  /* 抽屉会在执行记录到达后重渲染：等步骤表格落定再读，别读到重渲染前的空块 */
  await waitFor(`(() => { const v = document.getElementById('caseDetailView');
    const m = ((v.querySelector('.case-steps-block .cnt') || {}).textContent || '').match(/([0-9]+)/);
    return m && Number(m[1]) > 0; })()`, "概览步骤表格就绪", 15000);
  const b1 = await evaluate(`(() => {
    const view = document.getElementById('caseDetailView');
    const cnt = ((view.querySelector('.case-steps-block .cnt') || {}).textContent || '').match(/([0-9]+)/);
    return {
      count: cnt ? Number(cnt[1]) : 0,
      cells: view.querySelectorAll('.case-steps-grid .case-step-cell').length,
      inputs: view.querySelectorAll('.case-step-input, textarea').length,
      editable: view.querySelectorAll('.case-step-cell.editable').length
    };
  })()`);
  assert(b1.count > 0 && b1.cells === b1.count * 2, "概览步骤表格条数与计数一致（" + b1.count + " 步）");
  assert(b1.inputs === 0 && b1.editable === b1.count * 2, "概览步骤未进入行内编辑：无输入框，单元格可点就改");
  await shot("steps-1440.png");
  await clickTab("runs");
  await waitFor(`(() => {
    const v = document.getElementById('caseDetailView');
    return !!v.querySelector('.run-item') || !!v.querySelector('.case-empty');
  })()`, "执行历史内容", 15000);
  const b2 = await evaluate(`(() => {
    const view = document.getElementById('caseDetailView');
    return { items: view.querySelectorAll('.run-item').length, empty: !!view.querySelector('.case-empty') };
  })()`);
  assert(b2.items > 0 || b2.empty, "执行历史有记录或明确空态（" + (b2.items || "空") + "）");
  await shot("runs-1440.png");
  await clickTab("defects");
  await waitFor(`(() => {
    const v = document.getElementById('caseDetailView');
    return !!v.querySelector('.case-assoc .chip') || !!v.querySelector('.case-empty');
  })()`, "缺陷页签内容", 15000);
  const b3 = await evaluate(`(() => {
    const view = document.getElementById('caseDetailView');
    return { chips: view.querySelectorAll('.case-assoc .chip').length, empty: !!view.querySelector('.case-empty') };
  })()`);
  assert(b3.chips > 0 || b3.empty, "缺陷页签列出关联缺陷或明确空态");
  await clickTab("overview");

  /* C 标题就地修改：保存 → 还原 */
  const original = await evaluate(`document.querySelector('#caseDetailView h2').textContent.trim()`);
  const originalCaseId = await evaluate("window.__e2eCaseId");
  restoreOriginal = async () => {
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const { rt } = await import("./js/core/state.js");
      const id = ${JSON.stringify(originalCaseId)}, title = ${JSON.stringify(original)};
      for(const r of rt.reqList){
        const page = await API.get("/api/test-cases", { reqId: r.id, limit: 200 });
        const c = ((page && page.items) || []).find(x => x.id === id);
        if(!c || c.title === title) continue;
        await API.put("/api/test-cases/" + encodeURIComponent(c.id), {
          reqId: c.reqId, title,
          precondition: c.precondition || null, testData: c.testData || null,
          moduleId: c.moduleId || null, module: c.module || null, priority: c.priority || null,
          demandId: c.demandId || null, taskIds: (c.tasks || []).map(t => t.taskId),
          steps: (c.steps || []).map(s => ({ action: s.action || "", expected: s.expected || "" }))
        });
      }
      return true;
    })()`);
    console.log("  CLEAN 标题已还原为「" + original + "」");
  };
  const tempTitle = "E2E 抽屉标题 " + Date.now().toString().slice(-5);
  await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const h = document.querySelector('#caseDetailView h2');
    window.__e2eH2 = h;
    h.click();
    await wait(60);
    if (!h.isContentEditable) throw new Error('标题未进入编辑态');
    h.textContent = ${JSON.stringify(tempTitle)};
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  /* 标题保存成功后会整块重渲染：等 h2 换成新节点，避免只看即时文本就当成已落库 */
  await waitFor(`document.querySelector('#caseDetailView h2').textContent.trim() === ${JSON.stringify(tempTitle)} && document.querySelector('#caseDetailView h2') !== window.__e2eH2`, "标题保存后回显", 15000);
  await waitFor("document.getElementById('caseEditBody').hidden && document.getElementById('dlgCase').classList.contains('open')", "仍在阅读态", 5000);
  const c1 = await evaluate(`(() => ({
    title: document.querySelector('#caseDetailView h2').textContent.trim(),
    open: document.getElementById('dlgCase').classList.contains('open')
  }))()`);
  assert(c1.title === tempTitle && c1.open, "标题就地保存后仍在阅读态（" + c1.title + "）");
  /* 还原原标题，避免演示数据被 E2E 改掉 */
  await evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const h = document.querySelector('#caseDetailView h2');
    window.__e2eH2 = h;
    h.click();
    await wait(60);
    h.textContent = ${JSON.stringify(original)};
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  /* 同样等重渲染：只看输入后的文本会放过还在飞的 PUT，后面的编辑态会读到旧标题 */
  await waitFor(`document.querySelector('#caseDetailView h2').textContent.trim() === ${JSON.stringify(original)} && document.querySelector('#caseDetailView h2') !== window.__e2eH2`, "标题已还原", 15000);
  pass("标题已还原为「" + original + "」");

  /* D0 编辑态「取消」回到阅读态：有改动先确认，放弃后标题不变 */
  await evaluate(`document.querySelector('#caseDetailView [data-case-edit]').click()`);
  await waitFor("document.querySelectorAll('#caseDetailView [data-case-draft-step]').length > 0", "切到编辑态", 8000);
  const d0back = await evaluate(`!!document.querySelector('#caseDetailView [data-case-edit-cancel]')`);
  assert(d0back, "编辑态提供「取消」，不用关掉整个抽屉才能回到详情");
  await evaluate(`(() => {
    const el = document.getElementById('caseEditTitle');
    el.value = el.value + ' 未保存';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#caseDetailView [data-case-edit-cancel]').click();
    return true;
  })()`);
  await waitFor(`document.getElementById('dlgConfirm').classList.contains('open')`, "放弃修改确认框", 8000);
  await evaluate(`document.getElementById('dlgConfirmOk').click()`);
  await waitFor("document.getElementById('caseEditBody').hidden && !document.getElementById('caseDetailView').hidden && document.getElementById('dlgCase').classList.contains('open')", "取消后回阅读态", 8000);
  const d0title = await evaluate(`document.querySelector('#caseDetailView h2').textContent.trim()`);
  assert(d0title === original, "取消编辑回到阅读态，未保存的改动被丢弃");

  /* D 编辑 → 保存 → 回阅读态（不关抽屉） */
  await evaluate(`document.querySelector('#caseDetailView [data-case-edit]').click()`);
  await waitFor("document.querySelectorAll('#caseDetailView [data-case-draft-step]').length > 0", "再次切到编辑态", 8000);
  const d1 = await evaluate(`(() => ({
    input: document.getElementById('caseEditTitle').value,
    steps: document.querySelectorAll('#caseDetailView [data-case-draft-step][data-k="action"]').length
  }))()`);
  assert(d1.input === original, "编辑态回填当前标题（" + d1.input + "）");
  assert(d1.steps === b1.count, "编辑态回填步骤（" + d1.steps + " 行）");
  await sleep(150);
  await shot("edit-1440.png");
  await evaluate(`document.querySelector('#caseDetailView [data-case-edit-save]').click()`);
  await waitFor("!document.getElementById('caseDetailView').hidden && document.getElementById('dlgCase').classList.contains('open') && document.querySelectorAll('#caseDetailView [data-case-draft-step]').length === 0", "保存后回阅读态", 20000);
  const d2 = await evaluate(`document.querySelector('#caseDetailView h2').textContent.trim()`);
  assert(d2 === original, "保存后抽屉留在阅读态并显示最新标题");
  pass("保存后未关抽屉，可继续看步骤 / 执行历史");

  /* E 记录执行叠层：打开后关闭应回到抽屉 */
  await evaluate(`document.querySelector('#caseDetailView [data-case-run]').click()`);
  await waitFor(`document.getElementById('dlgCaseRun').classList.contains('open')`, "记录执行弹框", 8000);
  const e1 = await evaluate(`document.getElementById('dlgCase').classList.contains('open')`);
  assert(e1, "记录执行叠在抽屉之上，抽屉不关闭");
  await evaluate(`document.getElementById('dlgCaseRunX').click()`);
  await waitFor(`!document.getElementById('dlgCaseRun').classList.contains('open')`, "关闭执行弹框", 8000);
  const e2 = await evaluate(`document.getElementById('dlgCase').classList.contains('open')`);
  assert(e2, "关闭执行弹框后回到抽屉");
  await closeDrawer();

  /* F 390 宽：抽屉铺满且无横向溢出 */
  await setViewport(390, 844, true);
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.layout === 'mobile' && document.body.dataset.view === 'testcases'", "移动布局");
  await openCases();
  await openReadCaseWithClose();
  const f = await evaluate(`(() => {
    const sheet = document.querySelector('#dlgCase .sheet').getBoundingClientRect();
    const tabs = document.querySelector('#caseDetailView .case-detail-tabs');
    return {
      left: Math.round(sheet.left), right: Math.round(sheet.right),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      tabsScroll: tabs.scrollWidth > tabs.clientWidth,
      bodyOverflow: (() => { const b = document.querySelector('.case-detail-body'); return b.scrollWidth > b.clientWidth + 1; })()
    };
  })()`);
  assert(f.left === 0 && f.right === 390, "移动端抽屉铺满 390 宽");
  assert(!f.overflow && !f.bodyOverflow, "移动端无横向溢出");
  await shot("read-390.png");
  await closeDrawer();

  /* G 查看者：阅读态没有写入口 */
  await setViewport(1440, 900, false);
  await login(VIEWER);
  await openCases();
  await openReadCaseWithClose();
  const g = await evaluate(`(() => {
    const view = document.getElementById('caseDetailView');
    return {
      read: !view.hidden && document.getElementById('caseEditBody').hidden,
      edit: !!view.querySelector('[data-case-edit]'),
      run: !!view.querySelector('[data-case-run]'),
      title: !!view.querySelector('[data-case-title-edit]')
    };
  })()`);
  assert(g.read && !g.edit && !g.run && !g.title, "查看者阅读态无编辑 / 记录执行 / 改标题");
  const g2 = await evaluate(`(() => {
    const view = document.getElementById('caseDetailView');
    return {
      ro: !!view.querySelector('.case-steps-grid.is-ro'),
      cells: view.querySelectorAll('.case-steps-grid .case-step-cell').length,
      acts: view.querySelectorAll('.case-step-acts').length,
      inputs: view.querySelectorAll('.case-step-input, textarea').length
    };
  })()`);
  assert(g2.ro && g2.cells > 0 && g2.acts === 0 && g2.inputs === 0, "查看者概览步骤是只读表格");
  await shot("viewer-1440.png");

  const realErrors = cdp.errors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  assert(realErrors.length === 0, "无运行时错误" + (realErrors.length ? "：" + realErrors.join(" | ") : ""));
  console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
  process.exitCode = failed ? 1 : 0;
}catch(e){
  console.error("E2E 异常：" + (e && e.message || e));
  process.exitCode = 1;
}finally{
  if(restoreOriginal){
    try{ await restoreOriginal(); }catch(e){ console.error("  清理失败：" + (e.message || e)); }
  }
  try{ if(cdp) cdp.ws.close(); }catch(e){}
  proc.kill("SIGKILL");
}
