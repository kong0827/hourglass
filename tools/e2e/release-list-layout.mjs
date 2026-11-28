/* 发布计划列表窄屏回归 + 需求池编号不折行（纯前端，无 SQL）
   用法：node tools/e2e/release-list-layout.mjs
   环境变量：E2E_BASE（默认本地 8081）、E2E_USER / E2E_PASS（默认 admin / admin123）
   背景：.phase-tbl 全列 nowrap + 操作列 flex-wrap 曾让末列在 1280px 以下被压到 66px、
   四个按钮竖排把计划行撑到 153–217px；需求池「DM-004」在 47px 列里按连字符折成两行。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } }
  send(method, params = {}, sessionId){ const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  for(const bin of candidates){
    if(fs.existsSync(bin)) return bin;
  }
  throw new Error("找不到 Chrome");
}

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

const chrome = findChrome();
const port = 9362;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-list-e2e-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1600,1100", "--disable-dev-shm-usage", "--hide-scrollbars"], { stdio: "ignore" });

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
  for(const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 25000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const resize = async width => {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
  };

  await resize(1600);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete'", "登录页");

  const login = await evaluate(`(async () => {
    await fetch("api/health", { credentials: "same-origin" });
    const m = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
    const body = "username=" + encodeURIComponent(${JSON.stringify(USER)}) + "&password=" + encodeURIComponent(${JSON.stringify(PASS)});
    const headers = { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": m ? decodeURIComponent(m[1]) : "" };
    let r = await fetch("api/auth/login", { method: "POST", credentials: "same-origin", headers, body });
    if(r.status === 401){
      /* 本地栈用 AUTH_USER / AUTH_PASSWORD 配了基础认证兜底，密码漂移时仍能进 */
      r = await fetch("api/auth/login", { method: "POST", credentials: "same-origin",
        headers: Object.assign({}, headers, { Authorization: "Basic " + btoa(${JSON.stringify(USER)} + ":" + ${JSON.stringify(PASS)}) }), body });
    }
    return r.status + " " + (await r.text());
  })()`);
  assert(/^200/.test(login), "登录成功：" + login);

  await call("Page.navigate", { url: BASE + "/#/release" });
  await waitFor("document.body.dataset.view === 'release'", "发布计划视图");
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 30000);
  await waitFor("!!document.querySelector('.pl-table tbody tr')", "计划表行", 25000);

  const measureRows = () => evaluate(`(() => {
    const rows = [...document.querySelectorAll('.pl-table tbody tr')].slice(0, 3).map(tr => {
      const acts = tr.querySelector('.rel-empty-acts');
      const btns = acts ? [...acts.querySelectorAll('.btn')] : [];
      const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
      const last = tr.lastElementChild;
      return { h: Math.round(tr.getBoundingClientRect().height),
        btns: btns.length, actLines: tops.size,
        actW: last ? Math.round(last.getBoundingClientRect().width) : 0 };
    });
    const wrap = document.querySelector('.pl-table-wrap');
    const tbl = document.querySelector('.pl-table');
    return { layout: document.body.dataset.layout, rows,
      tableW: tbl ? Math.round(tbl.getBoundingClientRect().width) : 0,
      wrapW: wrap ? wrap.clientWidth : 0,
      scrolls: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : false };
  })()`);

  for(const width of [1600, 1280, 1200, 1100, 900, 600]){
    await resize(width);
    await waitFor("!!document.querySelector('.pl-table tbody tr')", "计划表行 @" + width, 15000);
    const m = await measureRows();
    console.log("  @" + width + "：" + JSON.stringify(m));
    assert(m.rows.length > 0, width + "px 有计划行");
    if(m.layout === "mobile"){
      /* 手机档位整表转卡片（每行一卡），行高由卡片内容决定，只校验按钮仍单行且不溢出 */
      assert(m.rows.every(r => r.actLines === 1 && r.actW <= m.wrapW + 1),
        width + "px 手机卡片内按钮单行且不溢出（实测 " + m.rows.map(r => r.actLines + "行/" + r.actW + "px").join(" ") + "，容器 " + m.wrapW + "px）");
      continue;
    }
    assert(m.rows.every(r => r.h <= 70), width + "px 行高 ≤ 70px（实测 " + m.rows.map(r => r.h).join("/") + "）");
    assert(m.rows.every(r => r.actLines === 1), width + "px 操作按钮单行（实测 " + m.rows.map(r => r.actLines).join("/") + " 行）");
    assert(m.rows.every(r => r.btns < 2 || r.actW >= 140), width + "px 操作列宽度够放按钮（实测 " + m.rows.map(r => r.actW).join("/") + "px）");
    assert(width >= 1280 ? (m.tableW <= m.wrapW + 1) : true, width + "px 宽屏表格不出现横向滚动");
  }

  /* 横向滚动时操作列应吸在容器右侧，滚到最右操作按钮仍立即可点 */
  await resize(1100);
  await waitFor("!!document.querySelector('.pl-table tbody tr')", "计划表行 @1100", 15000);
  const sticky = await evaluate(`(() => {
    const wrap = document.querySelector('.pl-table-wrap');
    wrap.scrollLeft = wrap.scrollWidth;
    const tr = document.querySelector('.pl-table tbody tr');
    const cell = tr.lastElementChild;
    const wr = wrap.getBoundingClientRect(), cr = cell.getBoundingClientRect();
    return { pos: getComputedStyle(cell).position,
      gap: Math.round(wr.left + wrap.clientWidth - cr.right),
      rowH: Math.round(tr.getBoundingClientRect().height) };
  })()`);
  console.log("  @1100 右滚：" + JSON.stringify(sticky));
  assert(sticky.pos === "sticky", "操作列 position:sticky");
  assert(Math.abs(sticky.gap) <= 2, "滚到最右操作列仍贴容器右缘（偏差 " + sticky.gap + "px）");
  assert(sticky.rowH <= 70, "右滚后行高不变（" + sticky.rowH + "px）");

  await resize(1600);
  await call("Page.navigate", { url: BASE + "/#/demands" });
  await waitFor("document.body.dataset.view === 'demands'", "需求池视图");
  await waitFor("!!document.querySelector('.manager-tbl .dem-no')", "需求编号单元格", 25000);
  for(const width of [1600, 1100, 600]){
    await resize(width);
    await waitFor("!!document.querySelector('.manager-tbl .dem-no')", "需求编号单元格 @" + width, 15000);
    const no = await evaluate(`(() => {
      const spans = [...document.querySelectorAll('.manager-tbl .dem-no')].slice(0, 5);
      return spans.map(s => {
        const td = s.closest('td');
        const sr = s.getBoundingClientRect(), tr = td.getBoundingClientRect();
        return { text: s.textContent.trim(),
          lines: s.getClientRects().length,
          h: Math.round(sr.height),
          fits: sr.right <= tr.right - 8 && sr.left >= tr.left + 8 };
      });
    })()`);
    console.log("  @" + width + " 编号：" + JSON.stringify(no));
    assert(no.length > 0, width + "px 有需求编号");
    assert(no.every(s => s.lines === 1 && s.h <= 22), width + "px 编号单行不折行（实测 " + no.map(s => s.text + ":" + s.h + "px/" + s.lines + "行").join(" ") + "）");
    assert(no.every(s => s.fits), width + "px 编号列宽足够容纳编号（不溢出单元格）");
  }

  if(failed) throw new Error(failed + " 项断言失败");
  console.log("\n全部通过");
} catch(e){
  console.error("FAIL: " + e.message);
  process.exitCode = 1;
} finally {
  proc.kill("SIGKILL");
}
