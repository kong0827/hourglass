/* 周五补记浏览器走查：我的工作入口 → 跳过/继续 → 五步补记 → 跨周承接 → 提交与撤销 → 移动端。
   会自建本周夹具（3 条工作项 + 计时 + 上周承接）并清理回滚本地演示库，只用于验证栈（8120 + 8137）。
   用法：
     E2E_BASE=http://127.0.0.1:8137/hourglass E2E_USER=admin E2E_PASS=admin123 \
       node tools/e2e/catchup.mjs
   截图落到 E2E_SHOT_DIR（默认临时目录）。
   数据库默认本地演示库（127.0.0.1:3307 / hourglass），可用 E2E_MYSQL / E2E_WS / E2E_UID 覆盖。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8137/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-catchup-"));
const MYSQL = process.env.E2E_MYSQL || "/usr/local/mysql/bin/mysql";
const DB_ARGS = ["--default-character-set=utf8mb4", "-h127.0.0.1", "-P3307",
  "-uhourglass", "-phourglass123", "hourglass", "-N", "-B", "-e"];
const WS = process.env.E2E_WS || "SXk01";
const UID = process.env.E2E_UID || "Xku00";
const REQ = process.env.E2E_REQ || "Rmwe9xdrroxtb4ns3";

/* 夹具有固定前缀，跑前跑后都按前缀清理，避免污染演示库 */
function dbq(sql) {
  const r = spawnSync(MYSQL, [...DB_ARGS, sql], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error("mysql 查询失败：" + ((r.stderr || r.error && r.error.message || "").trim()));
  }
  return r.stdout.trim();
}
function cleanupFixtures(sessionId) {
  /* 会话 ID 直接拼字面量：用户变量会带 0900 collation，和表里的 unicode_ci 比较会报错 */
  const ids = sessionId ? `'E2EcuCarrySess','E2EcuStaleSess','${sessionId}'` : `'E2EcuCarrySess','E2EcuStaleSess'`;
  dbq(`DELETE FROM catchup_decision WHERE session_id IN (${ids});
    DELETE FROM catchup_time_alloc WHERE session_id IN (${ids});
    DELETE FROM catchup_write WHERE session_id IN (${ids});
    DELETE FROM catchup_carry WHERE from_session_id IN (${ids}) OR task_id LIKE 'E2Ecu%';
    DELETE FROM catchup_session WHERE id IN (${ids});
    DELETE FROM task_log WHERE task_id LIKE 'E2Ecu%';
    DELETE FROM time_log WHERE task_id LIKE 'E2Ecu%';
    DELETE FROM task WHERE id LIKE 'E2Ecu%';`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome / Chromium，请用 CHROME_BIN 指定路径");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function assert(ok, msg) { if (!ok) throw new Error(msg); }

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    this.sessionId = null;
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method === "Page.javascriptDialogOpening") {
      this.send("Page.handleJavaScriptDialog", { accept: true }, this.sessionId).catch(() => {});
    }
    if (msg.method) this.events.push(msg);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  takeExceptions() {
    const bad = this.events.filter(e =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
    this.events = [];
    return bad;
  }
}

async function connect(port) {
  const deadline = Date.now() + 15000;
  let version;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { version = await res.json(); break; }
    } catch (e) { /* Chrome 还没起来 */ }
    await sleep(200);
  }
  if (!version) throw new Error("Chrome DevTools 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new Cdp(ws);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  let currentSessionId = null;
  /* 跑前重置：清掉上次残留、造本周三条痕迹与「上周未处理」承接 */
  cleanupFixtures(null);
  dbq(`SET @mon = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY);
    DELETE d FROM catchup_decision d JOIN catchup_session s ON s.id=d.session_id
      WHERE s.user_id='${UID}' AND s.week_start=@mon AND s.id NOT LIKE 'E2Ecu%';
    DELETE a FROM catchup_time_alloc a JOIN catchup_session s ON s.id=a.session_id
      WHERE s.user_id='${UID}' AND s.week_start=@mon AND s.id NOT LIKE 'E2Ecu%';
    DELETE w FROM catchup_write w JOIN catchup_session s ON s.id=w.session_id
      WHERE s.user_id='${UID}' AND s.week_start=@mon AND s.id NOT LIKE 'E2Ecu%';
    DELETE c FROM catchup_carry c JOIN catchup_session s ON s.id=c.from_session_id
      WHERE s.user_id='${UID}' AND s.week_start=@mon AND s.id NOT LIKE 'E2Ecu%';
    DELETE FROM catchup_session WHERE user_id='${UID}'
      AND week_start=@mon AND id NOT LIKE 'E2Ecu%';
    INSERT INTO task (id, workspace_id, title, item_type, item_no, owner, owner_user_id, req_id,
                      category_id, board_column, completed_at, created_at, updated_at)
    VALUES
     ('E2Ecu01','${WS}','周五补记走查-完成项','task',901,'${USER}','${UID}','${REQ}','','doing',
      NOW(), NOW() - INTERVAL 5 DAY, NOW()),
     ('E2Ecu02','${WS}','周五补记走查-更新项','task',902,'${USER}','${UID}','${REQ}','','doing',
      NULL, NOW() - INTERVAL 5 DAY, NOW()),
     ('E2Ecu03','${WS}','周五补记走查-新建项','task',903,'${USER}','${UID}','${REQ}','','backlog',
      NULL, NOW(), NOW());
    INSERT INTO time_log (task_id, workspace_id, user_id, started_at, ended_at, minutes, origin, note)
    VALUES ('E2Ecu01','${WS}','${UID}', NOW() - INTERVAL 90 MINUTE, NOW(), 90, 'manual', '周五补记走查夹具');
    INSERT INTO catchup_session (id, workspace_id, user_id, week_start, status, started_at, submitted_at,
                                 elapsed_seconds, no_other_risk)
    VALUES ('E2EcuCarrySess','${WS}','${UID}', @mon - INTERVAL 7 DAY, 'submitted',
            NOW() - INTERVAL 7 DAY, NOW() - INTERVAL 7 DAY, 600, 0);
    INSERT INTO catchup_carry (from_session_id, to_week_start, task_id, item_no, title, project_name,
                               type_label, status_label, minutes, reason)
    SELECT 'E2EcuCarrySess', @mon, 'E2Ecu02', 902, '周五补记走查-更新项', r.name, '任务', '进行中', 0, 'pending'
    FROM requirement r WHERE r.id='${REQ}';
    /* 更早周的承接：提交时应被清理 */
    INSERT INTO catchup_session (id, workspace_id, user_id, week_start, status, started_at, submitted_at,
                                 elapsed_seconds, no_other_risk)
    VALUES ('E2EcuStaleSess','${WS}','${UID}', @mon - INTERVAL 21 DAY, 'submitted',
            NOW() - INTERVAL 21 DAY, NOW() - INTERVAL 21 DAY, 600, 0);
    INSERT INTO catchup_carry (from_session_id, to_week_start, task_id, item_no, title, project_name,
                               type_label, status_label, minutes, reason)
    SELECT 'E2EcuStaleSess', @mon - INTERVAL 14 DAY, 'E2Ecu03', 903, '周五补记走查-新建项', r.name, '任务', '待办', 0, 'pending'
    FROM requirement r WHERE r.id='${REQ}';`);
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-catchup-profile-"));
  const proc = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--hide-scrollbars", "--window-size=1440,960", "about:blank"
  ], { stdio: "ignore" });
  let cdp;
  try {
    const active = path.join(profile, "DevToolsActivePort");
    let port;
    for (let i = 0; i < 150; i++) {
      try { port = fs.readFileSync(active, "utf8").split("\n")[0].trim(); if (port) break; } catch (e) { /* 等文件 */ }
      await sleep(100);
    }
    assert(port, "读取 DevToolsActivePort 失败");

    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    cdp.sessionId = sessionId;
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${domain}.enable`, {}, sessionId);
    await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      let last;
      while (Date.now() < deadline) {
        try { last = await evaluate(expression); if (last) return last; }
        catch (e) { last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "页面加载 " + url, 25000);
    };
    const shot = async name => {
      /* 连续操作时提示条会叠在页面上，截图前清掉，避免遮住正在核对的内容 */
      await evaluate(`(() => { document.querySelectorAll("#toastWrap .toast").forEach(n => n.remove()); return true; })()`).catch(() => {});
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };
    const size = async (width, height, mobile) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
      await sleep(500);
    };
    const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
    const text = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : ""; })()`);
    const BASELINE_FAIL = /\/api\/(branches\/options|branches\/board|repos|favicon)/;
    const noExceptions = label => {
      const bad = cdp.takeExceptions().filter(e => !BASELINE_FAIL.test(JSON.stringify(e)));
      assert(!bad.length, label + " 出现脚本异常：" + JSON.stringify(bad.slice(0, 2)));
    };
    const noOverflow = async (label, sel) => {
      const r = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        const doc = document.documentElement;
        const wide = [...el.querySelectorAll("*")].filter(n => {
          const b = n.getBoundingClientRect();
          return b.width > 0 && (b.right > doc.clientWidth + 1 || b.left < -1);
        }).slice(0, 4).map(n => n.className || n.tagName);
        return { scrollW: el.scrollWidth, clientW: el.clientWidth, wide };
      })()`);
      assert(r, label + " 找不到容器 " + sel);
      assert(r.scrollW <= r.clientW + 1, `${label} 横向溢出：${r.scrollW} > ${r.clientW}（${r.wide.join(" | ")}）`);
      return r;
    };
    const pass = msg => console.log("  PASS " + msg);

    console.log("周五补记走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

    /* 1. 登录 */
    await navigate(BASE + "/login.html");
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
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
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body && document.body.dataset.view`, "登录完成", 25000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs).catch(() => false)`, "应用初始化", 25000);
    pass("登录 " + USER);

    /* 2. 我的工作入口卡片 */
    await evaluate(`(() => { window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: "mine" } })); return true; })()`);
    await waitFor(`document.body.dataset.view === "mine"`, "进入我的工作");
    await waitFor(`(() => { const c = document.getElementById("mineCatchup"); return c && !c.hidden && /周五补记/.test(c.textContent); })()`, "补记入口卡片");
    const cardText = await text("#mineCatchup");
    assert(/今天不补/.test(cardText), "入口卡片缺少「今天不补」");
    assert(/开始补记/.test(cardText), "入口卡片缺少「开始补记」");
    await noOverflow("我的工作（桌面）", "#view-mine .mw-page");
    await shot("01-mine-entry");
    pass("入口卡片：周五补记 / 开始补记 / 今天不补");

    /* 3. 今天不补 → 仍要补记 */
    await click('#mineCatchup [data-cu-entry="skip"]');
    await waitFor(`/已跳过/.test(document.getElementById("mineCatchup").textContent)`, "跳过后的卡片状态");
    await shot("02-mine-skipped");
    pass("今天不补：卡片切换为已跳过，仍保留「仍要补记」");
    await click('#mineCatchup [data-cu-entry="open"]');
    await waitFor(`document.body.dataset.view === "catchup"`, "进入补记页");
    await waitFor(`!!document.querySelector("#view-catchup .cu-steps")`, "补记步骤条");
    await waitFor(`/本周概览/.test(document.querySelector("#view-catchup .cu-head").textContent) || !!document.querySelector("#view-catchup .cu-kpis")`, "概览渲染");
    assert((await evaluate(`document.querySelectorAll("#view-catchup .cu-step").length`)) === 5, "步骤条不是 5 步");
    await noOverflow("补记概览（桌面）", "#catchupBody");
    await shot("03-overview");
    pass("五步补记：概览渲染，步骤条 5 步");

    /* 4. 工作项：接受高置信 + 跳过低置信；承接上周的排最前并带证据 */
    await click('#view-catchup .cu-step[data-step="2"]');
    await waitFor(`document.querySelectorAll("#view-catchup .cu-draft").length >= 2`, "工作项草稿");
    const carriedUi = await evaluate(`(() => {
      const cards = [...document.querySelectorAll("#view-catchup .cu-draft")];
      const first = cards[0];
      return {
        count: cards.length,
        firstCarried: !!first && /承上周/.test(first.textContent) && /上周补记/.test(first.textContent)
      };
    })()`);
    assert(carriedUi.firstCarried, "承接上周的工作项没有排在最前或缺少承接标记");
    await click('#view-catchup .cu-draft .cu-draft-main');
    await waitFor(`!!document.querySelector("#view-catchup .cu-draft.sel .cu-evidence")`, "承接证据展开");
    const carryEvidenceText = await text("#view-catchup .cu-draft.sel .cu-evidence");
    assert(/上周未处理/.test(carryEvidenceText), "承接工作项证据里没有「上周未处理」");
    await shot("04-drafts");
    pass("工作项：" + carriedUi.count + " 条草稿，承接上周项排最前并带证据");
    const acceptHigh = await evaluate(`(() => {
      const cards = [...document.querySelectorAll("#view-catchup .cu-draft")];
      const high = cards.find(c => /高置信/.test(c.textContent) && c.querySelector('[data-cu-action="accept"]'));
      if (!high) return false;
      high.querySelector('[data-cu-action="accept"]').click();
      return true;
    })()`);
    assert(acceptHigh, "本周没有可接受的高置信工作项，请先准备测试数据");
    await waitFor(`document.querySelectorAll("#view-catchup .cu-draft.accepted, #view-catchup .cu-draft.merged").length >= 1`, "高置信接受");
    const lowSkip = await evaluate(`(() => {
      const cards = [...document.querySelectorAll("#view-catchup .cu-draft")];
      const target = cards.find(c => !/accepted|merged/.test(c.className) && c.querySelector('[data-cu-action="skip"]'));
      if (!target) return false;
      target.querySelector('[data-cu-action="skip"]').click();
      return true;
    })()`);
    assert(lowSkip, "找不到可跳过的低置信工作项");
    await waitFor(`document.querySelectorAll("#view-catchup .cu-draft.skipped").length >= 1`, "跳过状态");
    await shot("05-drafts-decided");
    pass("工作项：高置信接受、低置信跳过");

    /* 5. 工时：改一格并保存 */
    await click('#view-catchup .cu-step[data-step="3"]');
    await waitFor(`!!document.querySelector("#view-catchup .cu-timegrid")`, "工时网格");
    const cells = await evaluate(`document.querySelectorAll("#view-catchup .cu-cell").length`);
    assert(cells === 7, "工时网格应显示完整 7 天（含周末），实际 " + cells);
    await shot("06-time");
    const cellChanged = await evaluate(`(() => {
      const el = document.querySelector('#view-catchup .cu-cell[data-row="0"][data-day="3"]');
      if (!el) return false;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, "1.5");
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    assert(cellChanged, "找不到周四工时格");
    await waitFor(`(() => { const b = document.querySelector('#view-catchup [data-cu-action="save-time"]'); return b && !b.disabled; })()`, "保存工时按钮可用");
    await click('#view-catchup [data-cu-action="save-time"]');
    await waitFor(`/已保存/.test(document.querySelector("#view-catchup .cu-timefoot").textContent)`, "工时保存完成");
    await shot("07-time-saved");
    pass("工时：完整 7 天，改周四为 1.5h 并保存");

    /* 6. 风险与变化 */
    await click('#view-catchup .cu-step[data-step="4"]');
    await waitFor(`!!document.querySelector("#view-catchup .cu-noother")`, "无其他风险卡");
    await shot("08-risks");
    await click('#view-catchup [data-cu-action="no-risk"]');
    await waitFor(`/已确认/.test(document.querySelector("#view-catchup .cu-noother").textContent)`, "无其他风险确认");
    pass("风险与变化：无风险也可确认");

    /* 7. 确认与提交 */
    await click('#view-catchup .cu-step[data-step="5"]');
    await waitFor(`!!document.querySelector("#view-catchup .cu-sums")`, "确认页");
    await noOverflow("确认页（桌面）", "#catchupBody");
    await shot("09-confirm");
    await click('#view-catchup [data-cu-action="submit"]');
    await waitFor(`!!document.querySelector("#dlgConfirm.open")`, "提交确认对话框");
    await shot("09b-submit-dialog");
    await click("#dlgConfirmOk");
    await waitFor(`!!document.querySelector("#view-catchup .cu-done")`, "补记完成页", 20000);
    await waitFor(`!!document.getElementById("cuUndo") && !document.getElementById("cuUndo").hidden`, "撤销入口");
    await shot("10-done");
    const doneText = await text("#view-catchup .cu-done");
    assert(/补记完成/.test(doneText), "完成页缺少标题");
    pass("提交：写入完成页，出现 5 分钟内撤销");

    /* 7b. 承接：提交时未处理/跳过的项快照到下周（未来周不进视图，直接查承接表） */
    currentSessionId = await evaluate(`fetch("/hourglass/api/catchup").then(r => r.json())
      .then(j => j && j.data && j.data.session && j.data.session.id)`);
    assert(currentSessionId, "取不到本周补记会话 ID");
    const carryRows = dbq(`SELECT CONCAT(task_id, ':', reason) FROM catchup_carry
      WHERE from_session_id='${currentSessionId}' ORDER BY task_id`).split("\n").filter(Boolean);
    assert(carryRows.some(r => r === "E2Ecu02:skipped"), "跳过的项没有承接下周：" + JSON.stringify(carryRows));
    assert(carryRows.some(r => r === "E2Ecu03:pending"), "未处理的项没有承接下周：" + JSON.stringify(carryRows));
    const carriedFirst = dbq(`SELECT COUNT(*) FROM catchup_carry c
      WHERE c.from_session_id='${currentSessionId}' AND c.to_week_start =
        DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) + INTERVAL 7 DAY`).trim();
    assert(Number(carriedFirst) === carryRows.length, "承接到的周不是下周：" + carriedFirst + "/" + carryRows.length);
    pass("承接：跳过与未处理共 " + carryRows.length + " 项快照到下周 " + carriedFirst + " 条");

    /* 7c. 清理：提交时删掉更早周的承接，本周承接保留 */
    const staleLeft = dbq(`SELECT COUNT(*) FROM catchup_carry WHERE from_session_id='E2EcuStaleSess'`).trim();
    assert(staleLeft === "0", "历史承接没有清理，仍剩 " + staleLeft + " 条");
    const incomingLeft = dbq(`SELECT COUNT(*) FROM catchup_carry WHERE from_session_id='E2EcuCarrySess'`).trim();
    assert(incomingLeft === "1", "本周承接应保留，实际 " + incomingLeft + " 条");
    pass("承接清理：更早周的承接已删除，本周承接保留");

    /* 8. 撤销提交 */
    await click("#cuUndo");
    await waitFor(`!!document.querySelector("#dlgConfirm.open")`, "撤销确认对话框");
    await click("#dlgConfirmOk");
    await waitFor(`!!document.querySelector("#view-catchup .cu-steps")`, "撤销回到补记", 15000);
    const statusAfterUndo = await evaluate(`fetch("/hourglass/api/catchup").then(r => r.json()).then(j => j && j.data && j.data.session && j.data.session.status).catch(() => "")`);
    assert(statusAfterUndo === "" || statusAfterUndo === "draft", "撤销后会话状态应为 draft，实际 " + statusAfterUndo);
    /* 撤销要连承接一起回滚 */
    const carryAfterUndo = dbq(`SELECT COUNT(*) FROM catchup_carry WHERE from_session_id='${currentSessionId}'`).trim();
    assert(carryAfterUndo === "0", "撤销后承接没有回滚，仍有 " + carryAfterUndo + " 条");
    await shot("11-undone");
    pass("撤销提交：回到补记页，会话回到草稿，承接已回滚");

    /* 9. 我的工作：已进入过的草稿状态 */
    await evaluate(`(() => { window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: "mine" } })); return true; })()`);
    await waitFor(`document.body.dataset.view === "mine"`, "回到我的工作");
    await waitFor(`/草稿进行中/.test(document.getElementById("mineCatchup").textContent)`, "入口卡片刷新为草稿", 10000);
    await shot("12-mine-draft");
    pass("回到我的工作：入口卡片显示草稿进度");

    /* 10. 移动端 */
    await size(390, 844, true);
    await navigate(BASE + "/#/mine");
    await waitFor(`document.body.dataset.view === "mine"`, "移动端进入我的工作", 25000);
    await waitFor(`(() => { const c = document.getElementById("mineCatchup"); return c && !c.hidden; })()`, "移动端入口卡片");
    await noOverflow("我的工作（移动）", "#view-mine .mw-page");
    await shot("13-mine-mobile");
    await click('#mineCatchup [data-cu-entry="open"]');
    await waitFor(`document.body.dataset.view === "catchup" && !!document.querySelector("#view-catchup .cu-head")`, "移动端补记页", 25000);
    await noOverflow("补记概览（移动）", "#catchupBody");
    const sideHidden = await evaluate(`(() => { const s = document.querySelector("#view-catchup .cu-side"); return !s || getComputedStyle(s).display === "none"; })()`);
    assert(sideHidden, "移动端侧栏未隐藏");
    await shot("14-overview-mobile");
    await click('#view-catchup .cu-step[data-step="2"]');
    await waitFor(`document.querySelectorAll("#view-catchup .cu-draft").length >= 2`, "移动端工作项");
    await noOverflow("工作项（移动）", "#catchupBody");
    await shot("15-drafts-mobile");
    await click('#view-catchup .cu-step[data-step="3"]');
    await waitFor(`!!document.querySelector("#view-catchup .cu-timegrid")`, "移动端工时网格");
    await noOverflow("工时（移动）", "#catchupBody");
    await shot("16-time-mobile");
    pass("移动端：入口、概览、工作项、工时无横向溢出");

    noExceptions("走查结束");
    pass("无脚本异常");
    console.log("\n全部通过。截图：" + SHOTS);
  } catch (err) {
    console.error("\nFAIL " + (err && err.message ? err.message : err));
    const shots = fs.readdirSync(SHOTS).filter(f => f.endsWith(".png"));
    if (shots.length) console.error("已落截图：" + shots.join(", "));
    process.exitCode = 1;
  } finally {
    try { if (currentSessionId) cleanupFixtures(currentSessionId); } catch (e) { /* 清理失败不覆盖原始断言 */ }
    try { cdp && cdp.ws.close(); } catch (e) { /* noop */ }
    proc.kill("SIGTERM");
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }
})();
