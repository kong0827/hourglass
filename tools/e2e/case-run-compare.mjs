/* 执行历史步骤对比 + 执行弹框草稿保护 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/case-run-compare.mjs
   覆盖：
     A admin：种 3 步用例 + 3 轮带逐步结果的执行 + 1 轮无逐步结果；
       执行历史弹框顶部出现「步骤对比」区块：默认最近两轮、计数 chip、退步红/好转绿高亮、
       无逐步结果的轮次不进下拉、切换对比轮后计数与高亮重算；
     B admin：执行弹框脏检查——改动后 X 弹确认、取消保留内容、放弃可关、干净关闭不弹、保存后不弹。
   结束后删除种子用例（执行记录随用例级联清理），可重复跑。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const PASS = process.env.E2E_PASS || "123456";
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
const port = 9233;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-run-cmp-e2e-"));
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

  console.log("执行历史步骤对比 + 执行弹框草稿保护 E2E\n  地址：" + BASE);

  await setViewport(1440, 900, false);
  await login("admin");
  await openCases();

  /* ---------- A 种子数据：3 步用例 + 3 轮带逐步结果 + 1 轮纯结果 ---------- */
  const seed = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const sel = document.getElementById('tcReq');
    let reqId = sel ? sel.value : "";
    if(sel && (!reqId || /^__/.test(reqId))){
      const opt = [...sel.options].find(o => !/^__/.test(o.value));
      reqId = opt ? opt.value : "";
    }
    if(!reqId) return { error: "没有可用项目" };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const created = await API.post("/api/test-cases", {
      reqId, title: "E2E 步骤对比 " + stamp, priority: "P2", module: "回归",
      steps: [
        { action: "打开登录页", expected: "页面正常渲染" },
        { action: "输入错误密码提交", expected: "提示密码错误且不跳转" },
        { action: "输入正确密码提交", expected: "跳转工作台" }
      ]
    });
    const caseId = created.id;
    const post = body => API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/runs", body);
    const r1 = await post({ status: "passed", note: null, environment: "Chrome 131 / macOS 15",
      stepResults: [
        { idx: 1, status: "passed", note: null },
        { idx: 2, status: "passed", note: null },
        { idx: 3, status: "passed", note: null }
      ], executedByUserId: null });
    const r2 = await post({ status: "blocked", note: "第 3 步阻塞：依赖账号未就绪", environment: "Chrome 131 / macOS 15",
      stepResults: [
        { idx: 1, status: "passed", note: null },
        { idx: 2, status: "passed", note: null },
        { idx: 3, status: "blocked", note: "依赖账号未就绪" }
      ], executedByUserId: null });
    const r3 = await post({ status: "failed", note: "第 2 步：提示文案更新了", environment: "Chrome 131 / macOS 15",
      stepResults: [
        { idx: 1, status: "passed", note: null },
        { idx: 2, status: "failed", note: "提示文案更新了" },
        { idx: 3, status: "passed", note: null }
      ], executedByUserId: null });
    /* 第 4 轮：无逐步结果（整例手选失败），不应出现在对比下拉里 */
    const r4 = await post({ status: "failed", note: "整例冒烟崩溃", environment: null,
      stepResults: null, executedByUserId: null });
    sel.value = reqId; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { reqId, caseId, runIds: [r1.id, r2.id, r3.id, r4.id] };
  })()`);
  assert(!seed.error && !!seed.caseId, "种子用例与 4 轮执行创建成功" + (seed.error ? "：" + seed.error : ""));
  await waitFor(`!!document.querySelector('[data-tc-runs="${seed.caseId}"]')`, "种子用例行渲染");

  /* ---------- A 步骤对比区块 ---------- */
  await evaluate(`document.querySelector('[data-tc-runs="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRuns"), "执行历史弹框");
  await waitFor(`!!document.querySelector('#runsList .run-item') && !!document.querySelector('#runsList .cmp')`, "对比区块渲染");

  const a1 = await evaluate(`(() => {
    const cmp = document.querySelector('#runsList .cmp');
    const sels = [...cmp.querySelectorAll('select[data-cmp-sel]')];
    const chips = [...cmp.querySelectorAll('.cmp-chips .chip')].map(c => c.textContent.trim());
    const rows = [...cmp.querySelectorAll('.cmp-tbl tbody tr')];
    return {
      selCount: sels.length,
      selA: sels[0].value, selB: sels[1].value,
      optA: [...sels[0].options].map(o => o.value),
      optB: [...sels[1].options].map(o => o.value),
      chips,
      rowCount: rows.length,
      rowCls: rows.map(r => r.className),
      headA: cmp.querySelectorAll('.cmp-tbl thead th')[1].textContent,
      headB: cmp.querySelectorAll('.cmp-tbl thead th')[2].textContent,
      step2markA: (rows[1].querySelectorAll('td')[1].querySelector('.mark') || {}).className || "",
      step2note: (rows[1].querySelectorAll('td')[1].querySelector('.note-tag') || {}).textContent || "",
      step3markB: (rows[2].querySelectorAll('td')[2].querySelector('.mark') || {}).className || ""
    };
  })()`);
  const [id1, id2, id3, id4] = seed.runIds.map(String);
  /* 最近在前：第4轮(r4) 无逐步结果，默认取最近两轮带逐步结果的 = r3 对比 r2 */
  assert(a1.selCount === 2, "对比区块含本轮/对比轮两个下拉");
  assert(a1.selA === id3 && a1.selB === id2, "默认选中最近两轮（r3 对比 r2）");
  assert(a1.optA.indexOf(id4) === -1 && a1.optB.indexOf(id4) === -1, "无逐步结果的轮次不进对比下拉");
  assert(a1.optB.indexOf(id3) === -1, "本轮已选轮次不在对比轮下拉里");
  assert(a1.chips.join("/") === ["退步 1", "好转 1", "一致 1"].join("/"), "计数 chip = 退步1/好转1/一致1（实际 " + a1.chips.join("/") + "）");
  assert(a1.rowCount === 3, "对比表 3 行步骤");
  assert(a1.rowCls[0] === "" && a1.rowCls[1] === "diff-down" && a1.rowCls[2] === "diff-up", "第2步退步红、第3步好转绿、第1步无高亮（实际 " + a1.rowCls.join(",") + "）");
  assert(a1.headA.indexOf("（本轮）") >= 0 && a1.headB.indexOf("（本轮）") === -1, "本轮列头标注（本轮）");
  assert(a1.step2markA.indexOf("mark f") >= 0 && a1.step2note.indexOf("提示文案更新了") >= 0, "退步行展示失败标记与步骤备注");
  assert(a1.step3markB.indexOf("mark b") >= 0, "对比轮阻塞步骤标记正确");
  await shot("case-run-compare.png");

  /* A2 切换对比轮：对比 r3 vs r1（全部通过的基准轮） */
  const a2 = await evaluate(`(() => {
    const sels = [...document.querySelectorAll('#runsList .cmp select[data-cmp-sel]')];
    sels[1].value = ${JSON.stringify(id1)};
    sels[1].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert(a2 === true, "切换对比轮下拉");
  await waitFor(`(() => {
    const cmp = document.querySelector('#runsList .cmp');
    if(!cmp) return false;
    const chips = [...cmp.querySelectorAll('.cmp-chips .chip')].map(c => c.textContent.trim());
    const rows = [...cmp.querySelectorAll('.cmp-tbl tbody tr')];
    return chips.join('/') === '退步 1/好转 0/一致 2'
      && rows[1].className === 'diff-down' && rows[0].className === '' && rows[2].className === '';
  })()`, "切换后计数与高亮重算（r3 vs r1：退步1/一致2）", 10000);

  /* A3 交换：先切对比轮回 r2，再切本轮到 r1，方向反过来 → 第3步应为好转 */
  const a3 = await evaluate(`(() => {
    const sels = [...document.querySelectorAll('#runsList .cmp select[data-cmp-sel]')];
    sels[1].value = ${JSON.stringify(id2)};
    sels[1].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert(a3 === true, "先把对比轮切回 r2");
  await waitFor(`(() => {
    const sels = [...document.querySelectorAll('#runsList .cmp select[data-cmp-sel]')];
    return sels.length === 2 && sels[1].value === ${JSON.stringify(id2)};
  })()`, "对比轮已切回 r2", 10000);
  await evaluate(`(() => {
    const sels = [...document.querySelectorAll('#runsList .cmp select[data-cmp-sel]')];
    sels[0].value = ${JSON.stringify(id1)};
    sels[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`(() => {
    const rows = [...document.querySelectorAll('#runsList .cmp-tbl tbody tr')];
    const sels = [...document.querySelectorAll('#runsList .cmp select[data-cmp-sel]')];
    return sels[0].value === ${JSON.stringify(id1)}
      && rows.length === 3 && rows[2].className === 'diff-up' && rows[1].className === '';
  })()`, "反向对比方向正确（r1 vs r2：第3步阻塞→通过为好转）", 10000);

  await evaluate(`document.getElementById('dlgCaseRunsX').click()`);
  await waitFor(`!document.getElementById('dlgCaseRuns').classList.contains('open')`, "关闭执行历史");

  /* ---------- B 执行弹框草稿保护 ---------- */
  await waitFor(`!!document.querySelector('[data-tc-run="${seed.caseId}"]')`, "执行按钮就绪");
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "执行弹框打开");
  /* 基线是上一轮执行查询返回后建立的，等 rc-round 显示轮次即基线就绪 */
  await waitFor(`/本次为第 [0-9]+ 轮执行/.test((document.querySelector('#runContext .rc-round') || {}).textContent || "")`, "执行弹框就绪（基线已建）");

  /* B1 改备注 → 脏；X → 确认框；取消 → 弹框保留内容 */
  await evaluate(`(() => {
    const el = document.getElementById('runNote');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, '草稿备注：尚未提交');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('dlgCaseRunX').click();
    return true;
  })()`);
  await waitFor(`document.getElementById('dlgConfirm').classList.contains('open')`, "脏关闭弹「放弃本次执行记录」确认");
  const b1 = await evaluate(`(() => ({
    title: document.getElementById('dlgConfirmTitle').textContent,
    stillOpen: document.getElementById('dlgCaseRun').classList.contains('open')
  }))()`);
  assert(b1.title.indexOf("放弃") >= 0, "确认框标题提示放弃执行记录");
  assert(b1.stillOpen, "确认框弹出时执行弹框仍在");
  await shot("case-run-dirty-confirm.png");
  await evaluate(`document.getElementById('dlgConfirmCancel').click()`);
  await waitFor(`!document.getElementById('dlgConfirm').classList.contains('open')`, "取消确认");
  const b1b = await evaluate(`(() => ({
    stillOpen: document.getElementById('dlgCaseRun').classList.contains('open'),
    note: document.getElementById('runNote').value
  }))()`);
  assert(b1b.stillOpen && b1b.note.indexOf("草稿备注") >= 0, "取消放弃后弹框保留已填备注");

  /* B2 步骤标记也置脏：再点 X → 确认 → 放弃后弹框关闭 */
  await evaluate(`(() => {
    const btn = document.querySelector('[data-run-step="1"][data-run-step-st="failed"]');
    if(btn) btn.click();
    return true;
  })()`);
  await evaluate(`document.getElementById('dlgCaseRunX').click()`);
  await waitFor(`document.getElementById('dlgConfirm').classList.contains('open')`, "步骤置脏后 X 同样弹确认");
  await evaluate(`document.getElementById('dlgConfirmOk').click()`);
  await waitFor(`!document.getElementById('dlgCaseRun').classList.contains('open')`, "放弃后执行弹框关闭");

  /* B3 干净关闭：打开即 X，不弹确认 */
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "重新打开执行弹框");
  await waitFor(`/本次为第 [0-9]+ 轮执行/.test((document.querySelector('#runContext .rc-round') || {}).textContent || "")`, "执行弹框就绪（基线已建）");
  await evaluate(`document.getElementById('dlgCaseRunX').click()`);
  await sleep(600);
  const b3 = await evaluate(`(() => ({
    runOpen: document.getElementById('dlgCaseRun').classList.contains('open'),
    confirmOpen: document.getElementById('dlgConfirm').classList.contains('open')
  }))()`);
  assert(!b3.runOpen && !b3.confirmOpen, "无改动时 X 直接关闭、不弹确认");

  /* B4 提交保存后基线复位：再打开直接 X 不弹确认 */
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "再次打开执行弹框");
  await evaluate(`(() => {
    const el = document.getElementById('runNote');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, 'E2E 提交验证');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#segCaseRun [data-run-status="passed"]').click();
    document.getElementById('btnDoRun').click();
    return true;
  })()`);
  await waitFor(`!document.getElementById('dlgCaseRun').classList.contains('open')`, "提交后弹框自动关闭", 25000);
  await evaluate(`document.querySelector('[data-tc-run="${seed.caseId}"]').click()`);
  await waitFor(visible("dlgCaseRun"), "保存后重新打开执行弹框");
  /* 基线是上一轮执行查询返回后建立的，等 rc-round 显示轮次即基线就绪 */
  await waitFor(`/本次为第 [0-9]+ 轮执行/.test((document.querySelector('#runContext .rc-round') || {}).textContent || "")`, "执行弹框就绪（基线已建）");
  await evaluate(`document.getElementById('dlgCaseRunX').click()`);
  await sleep(600);
  const b4 = await evaluate(`(() => ({
    runOpen: document.getElementById('dlgCaseRun').classList.contains('open'),
    confirmOpen: document.getElementById('dlgConfirm').classList.contains('open')
  }))()`);
  assert(!b4.runOpen && !b4.confirmOpen, "提交保存后 X 直接关闭、不弹确认（基线已复位）");

  /* ---------- 清理种子数据 ---------- */
  const cleaned = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    await API.del("/api/test-cases/" + encodeURIComponent(${JSON.stringify(seed.caseId)}));
    return true;
  })()`);
  assert(cleaned === true, "种子用例已删除（执行记录随级联清理）");

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
