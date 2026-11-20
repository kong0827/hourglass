/* 角色视角走查：管理员 / 成员 / 查看者 三角色对比
   用途：uiux-review「角色走查」取证；只读访问，不修改业务数据。
   环境：本机预览 127.0.0.1:8081/hourglass + 后端 8080，空间 SXk01。
   输出：docs/audit/role-perspective-2026-11-20/shots/*.png + JSON 摘要。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const WS = process.env.E2E_WS || "SXk01";
const OUT = process.env.OUT_DIR || "docs/audit/role-perspective-2026-11-20";
const SHOTS = path.join(OUT, "shots");

const ROLES = [
  { key: "admin", label: "空间管理员", user: "admin", pass: ["123456", "Hourglass@2026"], mode: "real" },
  { key: "member", label: "成员", role: "member", mode: "simulated" },
  { key: "viewer", label: "查看者", role: "viewer", mode: "simulated" }
];

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw) {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

fs.mkdirSync(SHOTS, { recursive: true });
const chrome = findChrome();
const port = Number(process.env.E2E_PORT || 9466);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "role-audit-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,980", "--disable-dev-shm-usage", "--force-device-scale-factor=1"
], { stdio: "ignore" });

const result = { base: BASE, ws: WS, roles: {} };

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch (e) { await sleep(200); }
  }
  if (!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sid = attached.sessionId;
  for (const d of ["Page", "Runtime", "Network"]) await cdp.send(`${d}.enable`, {}, sid);
  try { await cdp.send("Network.setBypassServiceWorker", { bypass: true }, sid); } catch (e) {}
  const call = (m, p) => cdp.send(m, p, sid);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while (Date.now() < deadline) {
      try { last = await evaluate(expr); if (last) return last; } catch (e) { last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const shot = async name => {
    const s = await call("Page.captureScreenshot", { format: "png" });
    const out = path.join(SHOTS, name + ".png");
    fs.writeFileSync(out, Buffer.from(s.data, "base64"));
    return out;
  };
  const view = async key => {
    await evaluate(`import("./js/core/router.js").then(m => (m.showView ? m.showView(${JSON.stringify(key)}) : m.default(${JSON.stringify(key)})))`);
    await sleep(800);
  };
  const tryLogin = async (user, pass) => {
    await call("Network.clearBrowserCookies");
    await call("Page.navigate", { url: BASE + "/login.html" });
    await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
    await evaluate(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("uName", ${JSON.stringify(user)}); set("uPass", ${JSON.stringify(pass)});
      document.getElementById("btnLogin").click(); return true;
    })()`);
    try {
      await waitFor("location.pathname.indexOf('/login') === -1 && document.body.dataset.view", "登录完成", 12000);
      return "";
    } catch (e) {
      return await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无提示)"`);
    }
  };
  const login = async (user, passes) => {
    let err = "";
    for (const pass of passes) {
      err = await tryLogin(user, pass);
      if (!err) break;
    }
    if (err) throw new Error(user + " 登录失败：" + err);
    await evaluate(`import("./js/core/api.js").then(m => m.API.post("/api/workspaces/${WS}/select", {})).catch(() => null)`);
    await call("Page.navigate", { url: BASE + "/" });
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 25000);
  };

  const collect = async role => {
    const info = await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
      const text = el => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : "");
      const nav = [...document.querySelectorAll("#sideNav .nav-item")].filter(visible).map(b => text(b.querySelector(".nl")));
      const subs = [...document.querySelectorAll("#sideNav .nav-sub-item")].filter(visible).map(text);
      const tabs = [...document.querySelectorAll("#mineTabs .mw-tab")].filter(visible).map(text);
      const sections = [...document.querySelectorAll("#mineBody .mw-sec .mw-stitle")].filter(visible).map(text);
      const setTabs = [...document.querySelectorAll("#setTabs .set-tab")].filter(visible).map(text);
      const projects = [...document.querySelectorAll(".req-item[data-req-id]")];
      const projRows = projects.slice(0, 40).map(r => ({
        name: text(r.querySelector(".req-name")),
        tags: [...r.querySelectorAll(".tag")].map(text),
        hasNew: !!r.querySelector('[data-req-open]'),
        owner: text(r.querySelector(".pf-meta-line span:last-child"))
      }));
      const newBtn = document.getElementById("btnNew");
      return {
        wsName: text(document.getElementById("wsName")),
        wsKind: text(document.getElementById("wsKind")),
        role: rt.currentWs && rt.currentWs.myRole,
        user: rt.currentUser && rt.currentUser.username,
        nav, subs, tabs, sections, setTabs,
        viewTitle: text(document.getElementById("viewTitle")),
        brandSub: text(document.getElementById("brandSub")),
        mineBrief: text(document.getElementById("mineBrief")),
        newBtnVisible: visible(newBtn),
        newBtnText: text(newBtn),
        readOnlyMarks: (document.body.innerText.match(/只读/g) || []).length,
        bodyRole: document.body.dataset.wsRole || "",
        projCount: projects.length,
        projRows
      };
    })()`);
    return info;
  };

  for (const r of ROLES) {
    console.log("\n== " + r.label + " (" + (r.user || ("模拟 " + r.role)) + ") ==");
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
    if (r.mode === "real") {
      await login(r.user, r.pass);
    } else {
      /* 仅切换前端角色态：同一 admin 会话，用于验证角色相关的 UI 呈现；
         数据范围受服务端过滤的差异以代码/接口口径为准，报告里标注为模拟。 */
      await evaluate(`(async () => {
        const { rt } = await import("./js/core/state.js");
        rt.currentWs.myRole = ${JSON.stringify(r.role)};
        document.body.dataset.wsRole = ${JSON.stringify(r.role)};
        const kind = document.getElementById("wsKind");
        if (kind) kind.textContent = "共享 · " + (rt.currentWs.memberCount || 1) + " 人" + (${JSON.stringify(r.role)} === "viewer" ? " · 查看者（只读）" : "");
        return true;
      })()`);
    }
    await view("mine");
    await sleep(1200);
    const data = await collect(r);
    data.shots = [];
    data.shots.push(await shot(`1440-${r.key}-mine`));

    /* 项目页 */
    await view("projects");
    await sleep(1000);
    const proj = await evaluate(`(async () => {
      const { rt } = await import("./js/core/state.js");
      const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
      const rows = [...document.querySelectorAll(".req-item[data-req-id], .project-table-row[data-req-id]")];
      return {
        total: rows.length,
        rows: rows.slice(0, 30).map(x => ({
          name: (x.querySelector(".req-name, .project-cell")||{}).textContent,
          tags: [...x.querySelectorAll(".tag")].map(t => t.textContent.trim()),
          hasNew: !!x.querySelector("[data-req-open]"),
          more: !!x.querySelector("[data-project-more]")
        })),
        empty: (document.body.innerText.match(/暂无可见项目|还没有项目|你还没有被分配/)||[])[0] || "",
        primaryBtns: [...document.querySelectorAll(".page-head .btn.primary, .view-head .btn.primary, .pf-head .btn.primary")].filter(visible).map(b => b.textContent.trim())
      };
    })()`);
    data.projects = proj;
    data.shots.push(await shot(`1440-${r.key}-projects`));

    /* 设置页 */
    await view("settings");
    await sleep(1000);
    const settings = await evaluate(`(async () => {
      const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
      const text = el => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : "");
      const tabs = [...document.querySelectorAll("#setTabs .set-tab")].filter(visible).map(text);
      const disabled = [...document.querySelectorAll("#setPanel input, #setPanel textarea, #setPanel select, #setPanel button")].filter(x => x.disabled).length;
      const hint = text(document.querySelector(".set-hint"));
      return { tabs, disabledCount: disabled, hint, roleGuide: !!document.querySelector("[data-role-guide]") };
    })()`);
    data.settings = settings;
    data.shots.push(await shot(`1440-${r.key}-settings`));

    /* 查看者：记录可见写入口；全局新建若被隐藏就不再用脚本强点，避免把不可达路径当证据 */
    if (r.key === "viewer") {
      await view("board");
      await sleep(800);
      const attempt = await evaluate(`(async () => {
        const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
        const btn = document.getElementById("btnNew");
        const out = {
          newVisible: visible(btn),
          newDisplay: btn ? getComputedStyle(btn).display : "",
          colAddVisible: [...document.querySelectorAll("[data-col-add]")].filter(visible).length,
          cardAddVisible: [...document.querySelectorAll("[data-add]")].filter(visible).length,
          inlineInputVisible: !!document.querySelector(".inline-add input, .card-add-input"),
          toast: ""
        };
        if (out.newVisible) {
          btn.click(); await new Promise(x => setTimeout(x, 250));
          out.menuItems = [...document.querySelectorAll("#newMenu .menu-item")].filter(visible).map(b => (b.textContent||"").replace(/\\s+/g," ").trim());
        }
        return out;
      })()`);
      data.viewerAttempt = attempt;
      data.shots.push(await shot(`1440-${r.key}-board`));

      /* 查看者：测试页的页头写入口（先切到计划页签，计划按钮不依赖可写项目判断） */
      await view("testcases");
      await sleep(1200);
      await evaluate(`(() => { const b = document.querySelector('[data-tc-mode="plans"]'); if (b) b.click(); return true; })()`);
      await sleep(900);
      const tc = await evaluate(`(() => {
        const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
        const pick = sel => [...document.querySelectorAll(sel)].filter(visible).map(b => (b.textContent || "").replace(/\\s+/g, " ").trim());
        return {
          caseNew: pick('[data-tc-head="case-new"]'),
          defNew: pick('[data-tc-head="def-new"]'),
          planNew: pick('[data-tc-head="plan-new"]')
        };
      })()`);
      data.viewerTest = tc;
      data.shots.push(await shot(`1440-${r.key}-test`));
    }

    /* 390 手机档：我的工作 */
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await view("mine");
    await sleep(1000);
    const mobile = await evaluate(`(async () => {
      const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
      const text = el => (el ? (el.textContent || "").replace(/\\s+/g, " ").trim() : "");
      return {
        tabs: [...document.querySelectorAll("#mineTabs .mw-tab")].filter(visible).map(text),
        fab: visible(document.getElementById("btnNew")) ? text(document.getElementById("btnNew")) : "",
        bodyWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    })()`);
    data.mobile = mobile;
    data.shots.push(await shot(`390-${r.key}-mine`));

    data.mode = r.mode;
    result.roles[r.key] = data;
    console.log("  菜单：" + data.nav.join(" / "));
    console.log("  我的工作页签：" + data.tabs.join(" / "));
    console.log("  分区：" + data.sections.join(" / "));
    console.log("  项目数：" + data.projects.total + "，空态：" + (data.projects.empty || "无"));
    console.log("  设置页签：" + settings.tabs.join(" / "));
    console.log("  390 页签：" + mobile.tabs.join(" / ") + "，横向：" + mobile.bodyWidth + "/" + mobile.innerWidth);
    if (data.viewerAttempt) console.log("  查看者新建：", JSON.stringify(data.viewerAttempt));
  }

  fs.writeFileSync(path.join(OUT, "role-audit.json"), JSON.stringify(result, null, 2));
  console.log("\n完成，截图与 JSON 在 " + OUT);
} finally {
  try { proc.kill("SIGKILL"); } catch (e) {}
}
