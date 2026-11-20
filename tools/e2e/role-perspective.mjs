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
      const reviewRows = [...document.querySelectorAll("#mineBody .mw-row.mw-g-review")].filter(visible);
      const reviewClaimBtns = [...document.querySelectorAll("#mineBody [data-claim-review]")].filter(visible);
      const planRows = [...document.querySelectorAll("#mineBody .mw-row.mw-g-plan")].filter(visible);
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
        reviewRows: reviewRows.length,
        reviewClaimBtns: reviewClaimBtns.length,
        reviewClaimText: reviewClaimBtns.length ? text(reviewClaimBtns[0]) : "",
        planRows: planRows.length,
        banner: (() => { const b = document.getElementById("readonlyBanner"); return b && visible(b) ? text(b) : ""; })(),
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
        /* 前端角色门（layout.css 的 body[data-ws-role] 与只读横幅）不会因改 rt 自动重跑，这里手动同步 */
        const banner = document.getElementById("readonlyBanner");
        if (banner) banner.hidden = ${JSON.stringify(r.role)} !== "viewer";
        return true;
      })()`);
    }
    await view("mine");
    await sleep(1200);
    const data = await collect(r);
    data.shots = [];
    data.shots.push(await shot(`1440-${r.key}-mine`));

    /* 团队页签：桌面端也应存在（负责人 / 管理员） */
    if (r.key === "admin") {
      await evaluate(`(() => {
        const b = [...document.querySelectorAll("#mineTabs .mw-tab")].find(x => x.textContent.indexOf("团队") >= 0);
        if (b) b.click(); return !!b;
      })()`);
      await sleep(1600);
      data.teamView = await evaluate(`(() => {
        const panel = document.querySelector("#mineBody .team-panel");
        const vis = el => !!(el && !el.hidden && el.offsetParent !== null);
        return {
          exists: !!panel,
          visible: vis(panel),
          cards: [...document.querySelectorAll("#mineBody .team-card")].filter(vis).length,
          text: panel ? (panel.innerText || "").replace(/\\s+/g, " ").slice(0, 300) : ""
        };
      })()`);
      data.shots.push(await shot(`1440-${r.key}-team`));

      /* 需求详情：未指派评审的需求应就地出现「认领评审」 */
      await view("mine");
      await sleep(600);
      await evaluate(`(() => {
        const b = [...document.querySelectorAll("#mineTabs .mw-tab")].find(x => x.textContent.indexOf("待我处理") >= 0);
        if (b) b.click(); return !!b;
      })()`);
      await sleep(1200);
      const opened = await evaluate(`(() => {
        const row = [...document.querySelectorAll("#mineBody .mw-row.mw-g-review[data-open]")].find(x => x.offsetParent !== null);
        if (!row) return false;
        row.click(); return true;
      })()`);
      if (opened) {
        await sleep(1300);
        /* 桌面详情不放底栏，认领评审在「更多」菜单里；显式打开菜单再断言 */
        const moreOpened = await evaluate(`(() => {
          const more = document.querySelector(".demand-detail [data-dem-detail-more-btn]");
          if (more) more.click();
          return !!more;
        })()`);
        await sleep(400);
        data.adminDemandClaim = await evaluate(`(() => {
          const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
          const layer = document.querySelector(".demand-detail");
          const item = document.querySelector("[data-dem-detail-more='claim']");
          const facts = document.getElementById("demandFacts");
          const reviewer = facts ? (facts.innerText.match(/评审人[\\s\\S]{0,40}/) || [""])[0] : "";
          return {
            open: !!layer,
            moreBtn: !!document.querySelector(".demand-detail [data-dem-detail-more-btn]"),
            moreOpened: !!item,
            claimVisible: visible(item),
            claimText: item ? (item.textContent || "").trim() : "",
            reviewer: reviewer.replace(/\\s+/g, " ").trim()
          };
        })()`);
        data.adminDemandClaim.moreClicked = moreOpened;
        data.shots.push(await shot(`1440-${r.key}-demand-detail-claim`));
        await evaluate(`(() => {
          const menu = document.querySelector("[data-dem-detail-more='claim']");
          if (menu && menu.closest(".menu")) menu.closest(".menu").remove();
          const x = document.querySelector("[data-dem-x]"); if (x) x.click();
          return true;
        })()`);
        await sleep(500);
      }
    }

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
        primaryBtns: [...document.querySelectorAll("#pageActions .btn, #btnNew")].filter(visible).map(b => b.textContent.trim())
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
      const acts = document.getElementById("pageActions");
      return { tabs, disabledCount: disabled, hint, footer: text(acts), footerHidden: !!(acts && acts.hidden), roleGuide: !!document.querySelector("[data-role-guide]") };
    })()`);
    data.settings = settings;
    data.shots.push(await shot(`1440-${r.key}-settings`));

    /* 角色权限说明：菜单数应从导航配置生成，避免说明漂移 */
    const guideOpened = await evaluate(`(() => {
      const b = document.getElementById("btnRoleGuide");
      if (!b) return false;
      b.click(); return true;
    })()`);
    if (guideOpened) {
      await sleep(500);
      data.roleGuide = await evaluate(`(() => {
        const layer = document.querySelector('.modal-layer[aria-label="角色权限说明"]');
        if (!layer) return null;
        const note = [...layer.querySelectorAll(".perm-note")].map(x => (x.textContent || "").replace(/\\s+/g, " ").trim());
        const rows = layer.querySelectorAll(".perm-matrix tbody tr").length;
        return { note, rows };
      })()`);
      data.shots.push(await shot(`1440-${r.key}-role-guide`));
      await evaluate(`(() => { const c = document.querySelector("[data-role-guide-close]"); if (c) c.click(); return true; })()`);
      await sleep(300);
    }

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

      /* 查看者：测试页的页头写入口（先切到计划页签，三个新建按钮都应隐身） */
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

    /* 新成员（无可见项目）：任务抽屉的项目归属说明 */
    if (r.key === "member") {
      await view("board");
      await sleep(800);
      await evaluate(`(async () => {
        const { rt } = await import("./js/core/state.js");
        window.__origReqList = rt.reqList;
        rt.reqList = [];
        rt.reqsLoaded = true;
        const b = document.getElementById("btnNew");
        if (b) b.click();
        return true;
      })()`);
      await sleep(300);
      await evaluate(`(() => {
        const item = document.querySelector('#newMenu [data-new="task"]');
        if (item) item.click();
        return !!item;
      })()`);
      await sleep(900);
      data.memberNoProject = await evaluate(`(async () => {
        const visible = el => !!(el && !el.hidden && el.offsetParent !== null);
        const { rt } = await import("./js/core/state.js");
        const sel = document.getElementById("iReq");
        const hint = document.getElementById("iReqHint");
        return {
          optionText: sel && sel.options[0] ? sel.options[0].textContent : "",
          hasHint: !!hint,
          reqLen: (rt.reqList || []).length,
          reqsLoaded: rt.reqsLoaded,
          drawerOn: !!(document.getElementById("taskDrawer") && document.getElementById("taskDrawer").classList.contains("on")),
          hint: hint ? (hint.textContent || "").replace(/\\s+/g, " ").trim() : "",
          hintVisible: visible(hint)
        };
      })()`);
      data.shots.push(await shot(`1440-${r.key}-noproject-drawer`));
      await evaluate(`(async () => {
        const close = document.getElementById("btnCloseTask");
        if (close) close.click();
        const { rt } = await import("./js/core/state.js");
        if (window.__origReqList) rt.reqList = window.__origReqList;
        rt.reqsLoaded = true;
        return true;
      })()`);
      await sleep(600);
    }

    /* 390 手机档：我的工作 */
    await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await view("mine");
    await sleep(400);
    /* 上一步可能停在团队页签：手机档截图统一回到「待我处理」 */
    await evaluate(`(() => {
      const b = [...document.querySelectorAll("#mineTabs .mw-tab")].find(x => x.textContent.indexOf("待我处理") >= 0);
      if (b) b.click(); return !!b;
    })()`);
    await sleep(800);
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
    console.log("  待我评审：" + data.reviewRows + " 行，认领按钮 " + data.reviewClaimBtns + " 个；待我执行：" + data.planRows + " 行");
    if (data.adminDemandClaim) console.log("  需求详情认领：", JSON.stringify(data.adminDemandClaim));
    if (data.viewerAttempt) console.log("  查看者新建：", JSON.stringify(data.viewerAttempt));
    if (data.memberNoProject) console.log("  无项目抽屉：", JSON.stringify(data.memberNoProject));
  }

  fs.writeFileSync(path.join(OUT, "role-audit.json"), JSON.stringify(result, null, 2));
  console.log("\n完成，截图与 JSON 在 " + OUT);
} finally {
  try { proc.kill("SIGKILL"); } catch (e) {}
}
