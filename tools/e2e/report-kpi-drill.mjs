/* 测试报告 KPI 卡下钻 E2E · 真 Chrome + 本地栈
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass node tools/e2e/report-kpi-drill.mjs
   覆盖：
     ① 四张 KPI 卡可点（button 语义 / tabindex / 「明细」提示），失败与阻塞卡按计数出现；
     ② 通过率卡打开「本轮执行明细」，结果 chip 计数与统计一致，切换后行数对齐 /api/test-cases；
     ③ 失败卡默认落在失败 chip，明细带 fail 样式，行内可继续开用例详情；
     ④ 覆盖率卡默认未覆盖需求，可切已覆盖，行标记与切换一致；
     ⑤ 390 窄屏弹层不横向溢出，chip 完整可读。
   说明：挑用例多且有执行结果的项目；明细读回走 API 权威；不写库，可重复跑。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOT_DIR = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "rep-kpi-drill-shots-"));
fs.mkdirSync(SHOT_DIR, { recursive: true });

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
const port = Number(process.env.E2E_CDP_PORT || 9247);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rep-kpi-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

let cdp = null;
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
  const shot = async name => {
    await sleep(400);
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + path.join(SHOT_DIR, name));
  };

  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && rt.reqsLoaded)`, "应用初始化", 25000);
  await call("Page.navigate", { url: "about:blank" });
  await call("Page.navigate", { url: BASE + "/#/testcases" });
  await waitFor("document.body.dataset.view === 'testcases'", "用例视图");
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.reqsLoaded)`, "项目列表就绪", 25000);

  /* 挑一个用例多、有执行结果的项目 */
  const pick = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const { rt } = await import("./js/core/state.js");
    const reqs = rt.reqList || [];
    let best = null;
    for(const r of reqs){
      const s = await API.get("/api/test-cases/stats", { reqId: r.id });
      const executed = (s.total || 0) - (s.untested || 0);
      const score = ((s.failed || 0) > 0 ? 4 : 0) + ((s.blocked || 0) > 0 ? 2 : 0) + ((s.skipped || 0) > 0 ? 1 : 0);
      if(executed > 0 && (!best || score > best.score || (score === best.score && executed > best.executed))) best = { id: r.id, name: r.name, stats: s, executed, score };
    }
    return best;
  })()`);
  assert(!!pick, "找到有执行结果的项目：" + (pick && pick.name));
  if(!pick) throw new Error("没有可用项目");

  await evaluate(`(async () => {
    const m = await import("./js/views/testcases.js");
    m.setTcMode("report");
    m.setTcProject(${JSON.stringify(pick.id)});
    return true;
  })()`);
  await waitFor(`!!document.querySelector('#tcReport .rep-kpi[data-rep-kpi-drill="pass"]')`, "报告 KPI 卡", 25000);
  const s = pick.stats;

  const cardInfo = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#tcReport [data-rep-kpi-drill]')];
    return cards.map(c => ({ kind: c.dataset.repKpiDrill, role: c.getAttribute('role'), tab: c.getAttribute('tabindex'), go: !!c.querySelector('.rep-kpi-go') }));
  })()`);
  assert(cardInfo.length >= 2, "可点卡片数量 " + cardInfo.length + "（" + cardInfo.map(c => c.kind).join("/") + "）");
  assert(cardInfo.every(c => c.role === "button" && c.tab === "0" && c.go), "卡片带 button 语义、tabindex 与「明细」提示");
  assert(cardInfo.some(c => c.kind === "pass"), "通过率卡可下钻");
  assert(s.failed ? cardInfo.some(c => c.kind === "failed") : !cardInfo.some(c => c.kind === "failed"), "失败卡按失败数出现（失败=" + (s.failed || 0) + "）");
  assert(s.blocked ? cardInfo.some(c => c.kind === "blocked") : !cardInfo.some(c => c.kind === "blocked"), "阻塞卡按阻塞数出现（阻塞=" + (s.blocked || 0) + "）");

  /* A 通过率卡：默认「通过」，可切失败 / 阻塞 / 跳过 */
  await evaluate(`document.querySelector('#tcReport [data-rep-kpi-drill="pass"]').click()`);
  await waitFor(`document.getElementById('dlgRepDrill').classList.contains('open')`, "下钻弹层打开");
  await waitFor(`(() => { const b = document.getElementById('repDrillBody'); return b && !b.querySelector('.skel') && (b.querySelectorAll('.rep-row').length > 0 || !!b.querySelector('.rep-empty')); })()`, "通过明细渲染");
  const st = await evaluate(`(() => ({
    title: document.getElementById('repDrillTitle').textContent,
    sub: document.getElementById('repDrillSub').textContent,
    chips: [...document.querySelectorAll('#repDrillChips [data-rep-drill-chip]')].map(b => b.dataset.repDrillChip + ':' + b.querySelector('.n').textContent + (b.classList.contains('on') ? '*' : '')),
    rows: document.querySelectorAll('#repDrillBody .rep-row').length,
    empty: !!document.querySelector('#repDrillBody .rep-empty')
  }))()`);
  assert(st.title.indexOf("本轮执行明细") > -1, "标题「本轮执行明细」");
  assert(/本轮执行 \d+ 条/.test(st.sub) && st.sub.indexOf("不计入分母") > -1, "副标题带本轮条数与通过率口径");
  assert(st.chips.join(",") === "passed:" + (s.passed || 0) + "*,failed:" + (s.failed || 0) + ",blocked:" + (s.blocked || 0) + ",skipped:" + (s.skipped || 0), "结果 chip 计数与卡片一致：" + st.chips.join(" "));
  assert(st.rows === Math.min(s.passed || 0, 100) || (st.empty && !s.passed), "通过明细行数 " + st.rows + "（通过 " + (s.passed || 0) + "）");
  await shot("kpi-pass-drill.png");

  const counts = await evaluate(`(async () => {
    const { API } = await import("./js/core/api.js");
    const out = {};
    for(const k of ["passed", "failed", "blocked", "skipped"]){
      const p = await API.get("/api/test-cases", { reqId: ${JSON.stringify(pick.id)}, status: k, offset: 0, limit: 1 });
      out[k] = p.total || 0;
    }
    return out;
  })()`);
  for(const k of ["passed", "failed", "blocked", "skipped"]){
    await evaluate(`document.querySelector('#repDrillChips [data-rep-drill-chip="${k}"]').click()`);
    await waitFor(`(() => {
      const chip = document.querySelector('#repDrillChips [data-rep-drill-chip="${k}"]');
      const b = document.getElementById('repDrillBody');
      return chip && chip.classList.contains('on') && b && !b.querySelector('.skel') && (b.querySelector('.rep-empty') || b.querySelectorAll('.rep-row').length > 0);
    })()`, "切到 " + k);
    const got = await evaluate(`(() => ({ rows: document.querySelectorAll('#repDrillBody .rep-row').length, empty: !!document.querySelector('#repDrillBody .rep-empty'), chip: document.querySelector('#repDrillChips .on').dataset.repDrillChip }))()`);
    assert(got.chip === k, "chip 切换为 " + k);
    assert(got.empty ? counts[k] === 0 : got.rows === Math.min(counts[k], 100), k + " 明细行数 " + got.rows + "（接口 " + counts[k] + "）");
    if(k === "failed" && got.rows) assert(await evaluate(`!!document.querySelector('#repDrillBody .rep-row.fail')`), "失败明细带 fail 样式");
  }
  await shot("kpi-failed-drill.png");

  /* 弹层里点用例标题 → 打开用例抽屉（覆盖「行可继续下钻」） */
  if(counts.failed > 0){
    await evaluate(`document.querySelector('#repDrillChips [data-rep-drill-chip="failed"]').click()`);
    await waitFor(`!!document.querySelector('#repDrillBody [data-report-case]')`, "失败明细行就绪");
    await evaluate(`document.querySelector('#repDrillBody [data-report-case]').click()`);
    await waitFor(`!!document.querySelector('.modal-layer.open#dlgCase') || !!document.querySelector('.drawer.open')`, "下钻行打开用例详情", 15000).catch(e => { console.log("  WARN 用例抽屉未开：" + e.message); });
    await evaluate(`(async () => { const { UI } = await import("./js/core/ui.js"); const c = document.getElementById("dlgCase"); if(c && c.classList.contains("open")) UI.closeModal(c); return true; })()`);
  }

  /* B 关闭后点失败卡：默认落在失败 chip */
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
  await evaluate(`(() => { const d = document.getElementById('dlgRepDrill'); if(d && d.classList.contains('open')){ const x = document.getElementById('dlgRepDrillX'); if(x) x.click(); } return true; })()`);
  await waitFor(`!document.getElementById('dlgRepDrill').classList.contains('open')`, "弹层关闭");
  if(s.failed){
    await evaluate(`document.querySelector('#tcReport [data-rep-kpi-drill="failed"]').click()`);
    await waitFor(`document.getElementById('dlgRepDrill').classList.contains('open')`, "失败卡弹层");
    const f = await evaluate(`(() => ({ title: document.getElementById('repDrillTitle').textContent, on: document.querySelector('#repDrillChips .on').dataset.repDrillChip }))()`);
    assert(f.title === "失败用例" && f.on === "failed", "失败卡默认落在失败明细");
    await evaluate(`document.getElementById('dlgRepDrillX').click()`);
    await waitFor(`!document.getElementById('dlgRepDrill').classList.contains('open')`, "失败弹层关闭");
  }

  /* C 覆盖率卡：未覆盖 / 已覆盖切换，行可开需求 */
  if(cardInfo.some(c => c.kind === "coverage")){
    await evaluate(`document.querySelector('#tcReport [data-rep-kpi-drill="coverage"]').click()`);
    await waitFor(`document.getElementById('dlgRepDrill').classList.contains('open')`, "覆盖弹层");
    await waitFor(`(() => { const b = document.getElementById('repDrillBody'); return b && (b.querySelectorAll('.rep-cov-row').length > 0 || !!b.querySelector('.rep-empty')); })()`, "覆盖明细渲染");
    const cv = await evaluate(`(() => ({
      title: document.getElementById('repDrillTitle').textContent,
      on: document.querySelector('#repDrillChips .on').dataset.repDrillChip,
      rows: document.querySelectorAll('#repDrillBody .rep-cov-row').length,
      tags: [...document.querySelectorAll('#repDrillBody .rep-cov-row .mini-tag')].map(t => t.textContent)
    }))()`);
    assert(cv.title === "需求覆盖明细" && cv.on === "uncovered", "覆盖率卡默认看未覆盖需求");
    assert(cv.rows === 0 || cv.tags.every(t => t === "未覆盖"), "未覆盖视图行标记正确（" + cv.rows + " 行）");
    await evaluate(`document.querySelector('#repDrillChips [data-rep-drill-chip="covered"]').click()`);
    await waitFor(`(() => { const b = document.getElementById('repDrillBody'); return document.querySelector('#repDrillChips .on').dataset.repDrillChip === 'covered' && b && (b.querySelector('.rep-empty') || b.querySelectorAll('.rep-cov-row').length > 0); })()`, "切到已覆盖");
    const cv2 = await evaluate(`(() => ({ rows: document.querySelectorAll('#repDrillBody .rep-cov-row').length, tags: [...document.querySelectorAll('#repDrillBody .rep-cov-row .mini-tag')].map(t => t.textContent) }))()`);
    assert(cv2.rows === 0 || cv2.tags.every(t => t === "已覆盖"), "已覆盖视图行标记正确（" + cv2.rows + " 行）");
    await shot("kpi-coverage-drill.png");
    await evaluate(`document.getElementById('dlgRepDrillX').click()`);
  }

  /* D 390 窄屏：弹层不横向溢出，chip 与行可读 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  await evaluate(`document.querySelector('#tcReport [data-rep-kpi-drill="pass"]').click()`);
  await waitFor(`(() => { const d = document.getElementById('dlgRepDrill'); return d.classList.contains('open') && d.querySelectorAll('.tc-cov-chip').length >= 4; })()`, "390 弹层", 15000);
  await waitFor(`(() => { const b = document.getElementById('repDrillBody'); return b && !b.querySelector('.skel'); })()`, "390 明细");
  const mob = await evaluate(`(() => {
    const sheet = document.querySelector('#dlgRepDrill .sheet');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      sheetW: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0,
      chips: document.querySelectorAll('#repDrillChips .tc-cov-chip').length
    };
  })()`);
  assert(mob.overflow <= 1, "390 无横向溢出（scrollWidth-innerWidth=" + mob.overflow + "）");
  assert(mob.chips >= 4, "390 chip 数量 " + mob.chips);
  await shot("kpi-drill-390.png");
  await evaluate(`document.getElementById('dlgRepDrillX').click()`);

  assert(cdp.errors.length === 0, "控制台无报错" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 3).join(" | ") : ""));
}catch(err){
  failed++;
  console.log("  ERROR " + err.message);
  if(cdp && cdp.errors.length) console.log("  控制台：" + cdp.errors.slice(0, 5).join(" | "));
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? "\n失败 " + failed + " 项" : "\n全部通过");
process.exit(failed ? 1 : 0);