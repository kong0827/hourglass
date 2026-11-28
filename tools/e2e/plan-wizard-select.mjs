/* 发布计划向导 · 发布内容表：全选 / 半选 / 下钻 / 统一输入组件
   前置：本地栈 + 演示数据（E2E_BASE 默认 http://127.0.0.1:8081/hourglass）。
   覆盖：
   ① 表头全选框：未选 → 半选（勾 1 条）→ 全选（勾全部）→ 再点清空；计数提示同步；
   ② 行点击与 Enter 打开需求详情（下钻），关闭后回到向导且已选状态不丢；
   ③ 计划名称 / 计划窗口 / 执行人 / 文本框使用全局 .input/.select/.textarea：圆角 7px、
      高度 32px、下拉带统一 chevron，不再是浏览器原生深色直角边框；
   截图写到 E2E_SHOT_DIR（默认临时目录），便于人工核对。
   用法：node tools/e2e/plan-wizard-select.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const WS = process.env.E2E_WS || "SXk01";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-pw-"));

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
      this.errors.push("log: " + (msg.params.entry.url || "") + " " + (msg.params.entry.text || ""));
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

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

const chrome = findChrome();
const port = 9231;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-wizard-select-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });
fs.mkdirSync(SHOTS, { recursive: true });

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
  const sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text) + "\n表达式：" + expr.slice(0, 300));
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
    const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
  };
  const pageApi = async (method, url, body) => evaluate(`(async () => {
    const csrf = (document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/) || [])[1] || "";
    const headers = { "X-XSRF-TOKEN": decodeURIComponent(csrf) };
    ${body ? 'headers["Content-Type"] = "application/json";' : ""}
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)}, credentials: "same-origin", headers${body ? `, body: JSON.stringify(${JSON.stringify(body)})` : ""}
    });
    const text = await r.text();
    let data = null; try{ data = JSON.parse(text); }catch(e){}
    if(!r.ok) throw new Error("HTTP " + r.status + " " + (text || "").slice(0, 200));
    return data && data.data !== undefined ? data.data : data;
  })()`);

  console.log("发布计划向导 · 全选/下钻/输入组件 E2E\n  地址：" + BASE + "\n  截图：" + SHOTS);

  /* ---------- 登录 + 切空间 ---------- */
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
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  await evaluate(`import("./js/core/api.js").then(({API}) => API.post("/api/workspaces/${WS}/select", {})).then(() => true)`);
  await call("Page.navigate", { url: BASE + "/" });
  await waitFor(`import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(WS)} && rt.reqsLoaded)`, "切换空间", 25000);
  pass("登录并切到空间 " + WS);

  /* 新档案首次进版本域会弹欢迎卡，先跳过，避免遮挡截图与点击 */
  await evaluate(`(() => { const b = document.querySelector("[data-wc-skip]"); if(b) b.click(); return true; })()`);
  await sleep(300);

  /* ---------- 挑一个「有需求」的可管理版本 ---------- */
  const rows = await pageApi("GET", "api/versions/cross-project");
  const off = st => st === "released" || st === "closed" || st === "canceled";
  const candidates = (rows || []).filter(r => r.canManage === true && !off(r.versionStatus) && Number(r.demandCount) > 1);
  if(!candidates.length) throw new Error("空间 " + WS + " 没有需求数 >1 的可管理版本，先准备演示数据");
  let picked = null;
  for(const c of candidates){
    const demands = await pageApi("GET", `api/demands?reqId=${encodeURIComponent(c.reqId)}&versionId=${encodeURIComponent(c.versionId)}&limit=100`);
    const list = (demands && demands.items) || [];
    const hit = list.filter(d => d.versionId === c.versionId && ["closed", "rej", "canceled", "cancelled"].indexOf(d.status) === -1);
    if(hit.length > 1){ picked = { row: c, demands: hit }; break; }
  }
  if(!picked) throw new Error("没有找到含 2 条以上在途需求的版本");
  console.log("  夹具：" + picked.row.projectName + " · " + picked.row.versionName + "（" + picked.demands.length + " 条需求）");

  /* ---------- 打开向导（锚定该版本） ---------- */
  await evaluate(`import("./js/views/plan-wizard.js").then(m => {
    m.openPlanWizard({ from: "plans", anchor: ${JSON.stringify(picked.row.versionId)}, reqId: ${JSON.stringify(picked.row.reqId)}, ids: [${JSON.stringify(picked.row.versionId)}] });
    return true;
  })`);
  await waitFor(`(() => { const v = document.getElementById("planWizardBody"); return v && v.querySelector('[data-pw-field="name"]'); })()`, "向导第一步", 15000);

  /* ③ 输入组件：名称 / 计划窗口 / 分段 / 覆盖版本列表 */
  const inputStyle = await evaluate(`(() => {
    const name = document.querySelector('[data-pw-field="name"]');
    const time = document.querySelector('[data-pw-field="plannedAt"]');
    const cs = getComputedStyle(name), ts = getComputedStyle(time);
    return {
      nameClass: name.className, timeClass: time.className,
      radius: cs.borderRadius, height: cs.height, fontSize: cs.fontSize,
      timeRadius: ts.borderRadius, timeHeight: ts.height,
      nativeBorder: cs.borderTopColor
    };
  })()`);
  assert(/\binput\b/.test(inputStyle.nameClass), "计划名称使用全局 .input 组件");
  assert(inputStyle.radius === "7px" && inputStyle.height === "32px", "输入框圆角 7px / 高度 32px（统一组件）");
  assert(inputStyle.timeRadius === "7px" && inputStyle.timeHeight === "32px", "计划窗口 datetime-local 同样走统一组件");
  await shot("pw-1-basic-1440");

  /* 点标题不应误触：分段按钮/版本清单是复合控件，标题只做说明，不能转发点击 */
  const labelSafety = await evaluate(`(() => {
    const fieldOf = t => Array.from(document.querySelectorAll(".pw-field")).find(f => ((f.querySelector(".pw-label") || {}).textContent || "").indexOf(t) === 0);
    const envOn = () => ((document.querySelector(".pw-seg-b.is-on") || {}).textContent || "");
    const rowsOn = () => Array.from(document.querySelectorAll("[data-pw-version]:checked")).map(i => i.getAttribute("data-pw-version")).join(",");
    const out = { envBefore: envOn(), rowsBefore: rowsOn(), countBefore: document.querySelectorAll("[data-pw-version]:checked").length };
    fieldOf("目标环境").querySelector(".pw-label").click();
    out.envAfter = envOn();
    fieldOf("覆盖版本").querySelector(".pw-label").click();
    const g = document.querySelector(".pw-vgroup-h"); if(g) g.click();
    const s = document.querySelector(".pw-sum"); if(s) s.click();
    out.rowsAfter = rowsOn();
    out.countAfter = document.querySelectorAll("[data-pw-version]:checked").length;
    return out;
  })()`);
  assert(labelSafety.envBefore === labelSafety.envAfter, "点「目标环境」标题不切换环境（保持 " + labelSafety.envBefore + "）");
  assert(labelSafety.countBefore > 0 && labelSafety.rowsBefore === labelSafety.rowsAfter && labelSafety.countBefore === labelSafety.countAfter,
    "点「覆盖版本」标题 / 项目分组头 / 汇总条不改动版本勾选（" + labelSafety.countBefore + " 个）");

  const labelFocus = await evaluate(`(() => {
    const f = Array.from(document.querySelectorAll(".pw-field")).find(x => ((x.querySelector(".pw-label") || {}).textContent || "").indexOf("计划名称") === 0);
    f.querySelector(".pw-label").click();
    return document.activeElement ? document.activeElement.id : "";
  })()`);
  assert(labelFocus === "pwfName", "点「计划名称」标题把焦点交给输入框（label for 正常生效）");

  /* 填必填两项后进入第 2 步 */
  await evaluate(`(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set('[data-pw-field="name"]', "E2E 全选与下钻");
    set('[data-pw-field="plannedAt"]', "2026-12-01T20:00");
    document.querySelector("[data-pw-next]").click();
    return true;
  })()`);
  await waitFor(`(() => { const t = document.querySelector(".pw-table"); return t && t.querySelectorAll("tbody tr[data-pw-demand-open]").length > 1; })()`, "第 2 步需求表", 20000);
  pass("进入第 2 步「发布内容」，需求表已加载");

  const rowCount = await evaluate(`document.querySelectorAll(".pw-table tbody tr[data-pw-demand-open]").length`);
  const hintOf = () => evaluate(`(document.querySelector(".pw-card-h .pw-hint") || {}).textContent || ""`);

  /* ① 全选 / 半选 */
  const initial = await evaluate(`(() => {
    const all = document.querySelector("[data-pw-selectall]");
    return {
      exists: !!all, checked: all && all.checked, indeterminate: all && all.indeterminate,
      rows: document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length,
      hint: (document.querySelector(".pw-card-h .pw-hint") || {}).textContent || ""
    };
  })()`);
  assert(initial.exists, "表头出现全选框");
  assert(await evaluate(`document.querySelector("th.pw-col-ck").textContent.trim() === ""`), "表头全选列没有多余文字");
  assert(!initial.checked && !initial.indeterminate && initial.rows === 0, "初始未选：全选框未勾、非半选");
  assert(/已选 0 个需求/.test(initial.hint), "初始计数提示「已选 0 个需求」");

  await evaluate(`document.querySelector(".pw-table tbody input[data-pw-demand]").click()`);
  await waitFor(`document.querySelector("[data-pw-selectall]").indeterminate === true`, "半选态", 5000);
  let hint = await hintOf();
  assert(/已选 1 个需求/.test(hint), "勾 1 条：全选框转半选，计数提示同步为 1");
  assert(await evaluate(`(() => { const a = document.activeElement; return !!a && a.hasAttribute && a.hasAttribute("data-pw-demand"); })()`),
    "重画后焦点留在刚勾的需求复选框");
  await shot("pw-2-partial-1440");

  await evaluate(`document.querySelector("[data-pw-selectall]").click()`);
  await waitFor(`(() => {
    const all = document.querySelector("[data-pw-selectall]");
    const n = document.querySelectorAll(".pw-table tbody tr[data-pw-demand-open]").length;
    const on = document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length;
    return all.checked && !all.indeterminate && on === n;
  })()`, "全选态", 5000);
  hint = await hintOf();
  assert(new RegExp("已选 " + rowCount + " 个需求").test(hint), "全选：" + rowCount + " 条全部勾上，计数同步");
  assert(await evaluate(`document.activeElement === document.querySelector("[data-pw-selectall]")`), "点全选后焦点留在表头全选框");
  await shot("pw-2-all-1440");

  await evaluate(`document.querySelector("[data-pw-selectall]").click()`);
  await waitFor(`(() => {
    const all = document.querySelector("[data-pw-selectall]");
    return !all.checked && !all.indeterminate && document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length === 0;
  })()`, "清空态", 5000);
  pass("再点全选框：全部取消，半选态复位");

  /* 保留 2 条已选，用于下钻后状态不丢（每次勾选都会重画，必须重新取节点） */
  await evaluate(`document.querySelectorAll(".pw-table tbody input[data-pw-demand]")[0].click()`);
  await waitFor(`document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length === 1`, "选中第 1 条", 5000);
  await evaluate(`document.querySelectorAll(".pw-table tbody input[data-pw-demand]")[1].click()`);
  await waitFor(`document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length === 2`, "选中 2 条", 5000);

  /* ② 下钻：点行打开需求详情 */
  const firstTitle = await evaluate(`document.querySelector(".pw-table tbody tr[data-pw-demand-open] .pw-dt").textContent`);
  const firstId = await evaluate(`document.querySelector(".pw-table tbody tr[data-pw-demand-open]").getAttribute("data-pw-demand-open")`);
  await evaluate(`document.querySelector(".pw-table tbody tr[data-pw-demand-open] .pw-dt").click()`);
  await waitFor(`(() => {
    const l = document.querySelector(".modal-layer.demand-detail.open");
    const t = l && l.querySelector("#demandDetailTitle");
    return l && t && t.textContent.trim() === ${JSON.stringify(firstTitle)};
  })()`, "需求详情抽屉", 15000);
  pass("点行下钻：需求详情打开且标题一致（" + firstTitle + "）");
  await shot("pw-2-drill-1440");
  await evaluate(`(document.querySelector(".modal-layer.demand-detail.open [data-dem-x]") || {}).click ? document.querySelector(".modal-layer.demand-detail.open [data-dem-x]").click() : document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await waitFor(`!document.querySelector(".modal-layer.demand-detail.open")`, "关闭需求详情", 10000);
  assert(await evaluate(`document.querySelectorAll(".pw-table tbody input[data-pw-demand]:checked").length === 2`), "关闭详情后回到向导，已选 2 条不丢");

  /* 勾选列空白处只用于选择，不触发下钻 */
  await evaluate(`document.querySelector(".pw-table tbody td.pw-col-ck").click()`);
  await sleep(500);
  assert(await evaluate(`!document.querySelector(".modal-layer.demand-detail.open")`), "点勾选列空白处不打开需求详情");

  /* 键盘 Enter 也能下钻 */
  await evaluate(`(() => {
    const row = document.querySelector(".pw-table tbody tr[data-pw-demand-open]");
    row.focus();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  })()`);
  await waitFor(`!!document.querySelector(".modal-layer.demand-detail.open")`, "键盘 Enter 下钻", 10000);
  pass("键盘 Enter 打开需求详情");
  await evaluate(`document.querySelector(".modal-layer.demand-detail.open [data-dem-x]").click()`);
  await waitFor(`!document.querySelector(".modal-layer.demand-detail.open")`, "再次关闭详情", 10000);

  /* ③ 第 3 步：执行人下拉 + 文本框统一组件 */
  await evaluate(`document.querySelector("[data-pw-next]").click()`);
  await waitFor(`!!document.querySelector('[data-pw-field="targets"]')`, "第 3 步", 10000);
  const form3 = await evaluate(`(() => {
    const sel = document.querySelector('[data-pw-field="owner"]');
    const ta = document.querySelector('[data-pw-field="targets"]');
    const cs = getComputedStyle(sel), ts = getComputedStyle(ta);
    return {
      selClass: sel.className, taClass: ta.className,
      selRadius: cs.borderRadius, selHeight: cs.height,
      chevron: cs.backgroundImage.indexOf("svg") !== -1,
      taRadius: ts.borderRadius, taMin: ts.minHeight
    };
  })()`);
  assert(/\bselect\b/.test(form3.selClass), "执行人使用全局 .select 组件");
  assert(form3.selRadius === "7px" && form3.selHeight === "32px" && form3.chevron, "下拉圆角/高度统一且带统一 chevron");
  assert(/\btextarea\b/.test(form3.taClass) && form3.taRadius === "7px", "目标键/备注/风险使用全局 .textarea 组件");
  await shot("pw-3-notify-1440");

  const errs = cdp.errors.filter(e => !/favicon|net::ERR_ABORTED|icon-1024/.test(e));
  assert(errs.length === 0, "无控制台报错" + (errs.length ? "：" + errs.slice(0, 3).join(" | ") : ""));

  console.log("\n截图目录：" + SHOTS);
  if(failed){ console.log("\n结果：FAIL " + failed + " 项"); process.exitCode = 1; }
  else console.log("\n结果：全部通过");
}catch(e){
  console.error("\n中断：" + (e && e.message || e));
  process.exitCode = 1;
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}