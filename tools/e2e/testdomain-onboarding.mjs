/* 测试域新手友好改版 E2E（工作台落地页 + 空态三入口 + 示例包 + 三步向导 + 报告引导）
   覆盖：
     1. 测试域子导航五入口（工作台/用例/测试计划/报告/缺陷），默认落工作台
     2. 工作台：四步引导（进度由数据派生）、常驻帮助弹层、待我执行/测试计划两卡
     3. 示例包：API 载入 20 条 → 清单派生完成 → 用例页包横幅 → 整包删除（含二次确认）
     4. 零用例空态三入口（AI / 导入 Excel / 载入示例包）+ 教育卡
     5. 新建计划三步向导：整个项目模式自动圈选；检查并创建后落计划详情
     6. 计划详情「下一步」提示条按状态推导；计划周期显示
     7. 报告零数据引导卡（去用例页 / 去计划页）
   自建数据：唯一命名临时项目，结束按名称确认删除；不改动其他数据。

   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
       node tools/e2e/testdomain-onboarding.mjs */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"
  ].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome / Chromium，请用 CHROME_BIN 指定路径");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if(msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }else if(msg.method){
      this.events.push(msg);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  takeExceptions(){
    const bad = this.events.filter(e =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
    this.events = [];
    return bad;
  }
}

async function connect(port){
  const deadline = Date.now() + 15000;
  let version;
  while(Date.now() < deadline){
    try{
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if(res.ok){ version = await res.json(); break; }
    }catch(e){ /* Chrome 还没起来 */ }
    await sleep(200);
  }
  if(!version) throw new Error("Chrome DevTools 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new Cdp(ws);
}

function assert(cond, msg){
  if(!cond) throw new Error(msg);
}

async function main(){
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-e2e-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--window-size=1440,900",
    "about:blank"
  ], { stdio: "ignore" });

  let cdp, sessionId, created = null;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    assert(port, "读取 DevToolsActivePort 失败");

    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    for(const domain of ["Page", "Runtime", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 12000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{
          last = await evaluate(expression);
          if(last) return last;
        }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "页面加载 " + url, 20000);
    };
    const pass = msg => console.log("  PASS " + msg);

    console.log("测试域新手友好改版 E2E\n  浏览器：" + chrome + "\n  地址：" + BASE);

    /* 1. 登录 */
    await navigate(BASE + "/login.html");
    await waitFor("!!document.getElementById('loginForm')", "登录表单");
    await evaluate(`(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("uName", ${JSON.stringify(USER)});
      set("uPass", ${JSON.stringify(PASS)});
      document.getElementById("btnLogin").click();
      return true;
    })()`);
    await waitFor(`location.pathname.indexOf("/login") === -1 && document.body && document.body.dataset.view`, "登录完成", 20000);
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
    pass("登录 " + USER);

    /* 2. 临时项目 */
    const projectName = "E2E 测试域引导 " + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    created = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const p = await API.post("/api/reqs", {
        name: ${JSON.stringify(projectName)},
        description: "测试域引导 E2E 自动创建",
        objective: "验证工作台 / 示例包 / 向导",
        status: "active",
        template: "blank"
      });
      return { id: p.id, name: p.name };
    })()`);
    assert(created && created.id, "创建临时项目失败");
    pass("创建临时项目 " + created.name);
    const RID = created.id;

    /* 3. 测试域子导航五入口 + 默认落工作台 */
    await evaluate(`location.hash = "#/testcases"`);
    await waitFor(`document.body.dataset.view === "testcases"`, "测试域视图");
    const subnav = await waitFor(`(() => {
      const items = [...document.querySelectorAll("#subNav .subnav-item")].map(b => b.textContent.trim());
      return items.length === 5 && items.slice(0, 4).join("|") === "工作台|用例|测试计划|报告" && items[4].indexOf("缺陷") === 0 ? items.join("|") : false;
    })()`, "子导航五入口");
    pass("子导航：" + subnav);
    await waitFor(`import("./js/views/testcases.js").then(m => m.currentTcMode() === "bench")`, "默认工作台模式");
    await waitFor(`!!document.getElementById("tcBench") && !document.getElementById("tcBench").hidden`, "工作台容器可见");
    await waitFor(`document.querySelectorAll("#tcBench .tb-guide .tb-flow-step").length === 4`, "四步引导");
    await waitFor(`!document.querySelector("#tcBench .tb-banner") && !document.querySelector("#tcBench .tb-check")`, "旧横幅与五项清单已移除");
    const benchGuide = await waitFor(`(() => {
      const t = (document.querySelector("#tcBench .tb-guide-t") || {}).textContent || "";
      const pill = ((document.querySelector("#tcBench .tb-guide-pill") || {}).textContent || "").trim();
      return t === "测试四步" && /^(进行中|已完成)/.test(pill) ? { t, pill } : false;
    })()`, "引导头与进度");
    const cards = await evaluate(`[...document.querySelectorAll("#tcBench .tb-cols .tb-card-title h3")].map(e => e.textContent.trim()).join("|")`);
    assert(cards === "待我执行|测试计划", "计划卡应为待我执行+测试计划：" + cards);
    pass("工作台：四步引导（" + benchGuide.pill + "）+ 待我执行/测试计划两卡");

    /* 常驻帮助：弹层可开，重载后入口仍在（不再靠可关闭横幅） */
    await evaluate(`document.querySelector("#tcBench [data-bench-help]").click()`);
    await waitFor(`!!document.querySelector(".menu.tc-help-pop") && /测试工作台怎么用/.test(document.querySelector(".menu.tc-help-pop").textContent)`, "帮助弹层");
    const helpText = await evaluate(`document.querySelector(".menu.tc-help-pop").textContent.replace(/\\s+/g, " ")`);
    assert(helpText.indexOf("发布检查") >= 0 && helpText.indexOf("键盘") >= 0, "帮助内容缺报告口径或键盘说明：" + helpText.slice(0, 80));
    await evaluate(`(() => { location.reload(); return true; })()`);
    await waitFor(`document.readyState === 'complete'`, "重载完成", 20000);
    await waitFor(`document.body.dataset.view === "testcases"`, "回到测试域", 20000);
    await waitFor(`!!document.querySelector("#tcBench .tb-guide [data-bench-help]") && document.querySelectorAll("#tcBench .tb-flow-step").length === 4`, "帮助入口重载后仍在");
    pass("帮助入口常驻：弹层含报告口径/键盘说明，重载后仍可用");

    /* 4. 示例包：载入 → 清单派生 → 用例页横幅 → 整包删除 */
    const pack = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const r = await API.post("/api/test-cases/sample-pack", { reqId: ${JSON.stringify(RID)} });
      const page = await API.get("/api/test-cases", { reqId: ${JSON.stringify(RID)}, limit: 1 });
      return { groupId: r.groupId, total: page.total };
    })()`);
    assert(pack && pack.total === 20, "示例包应载入 20 条，实际 " + (pack && pack.total));
    pass("示例包载入：20 条用例 + 分组 " + pack.groupId);

    await evaluate(`import("./js/views/testcases.js").then(m => { m.setTcMode("cases"); m.setTcMode("bench"); })`);
    await waitFor(`(() => {
      const el = document.querySelector("#tcBench .tb-flow-step.done .tb-flow-body");
      return !!el && el.textContent.indexOf("备好用例") >= 0 && /\\d+ 条 · 已就绪/.test(el.textContent);
    })()`, "「备好用例」按用例数派生完成");
    pass("引导派生：备好用例完成，描述显示用例数");

    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcProject(${JSON.stringify(RID)}))`);
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("cases"))`);
    await waitFor(`!!document.getElementById("tcPackBanner") && !document.getElementById("tcPackBanner").hidden`, "示例包横幅");
    pass("用例页示例包横幅可见");

    await evaluate(`document.querySelector("#tcPackBanner [data-pack-del]").click()`);
    await waitFor(`!!document.querySelector(".modal-confirm, .modal-layer.open")`, "删除确认弹窗");
    await evaluate(`(() => {
      const btns = [...document.querySelectorAll(".modal-layer.open button, .modal-confirm button")];
      const ok = btns.find(b => /删除/.test(b.textContent) && !b.disabled);
      if(ok) ok.click();
      return !!ok;
    })()`);
    await waitFor(`(async () => {
      const { API } = await import("./js/core/api.js");
      const page = await API.get("/api/test-cases", { reqId: ${JSON.stringify(RID)}, limit: 1 });
      return page.total === 0;
    })()`, "示例包删除后用例清零", 15000);
    pass("整包删除：20 条合成用例一并清除");

    /* 5. 零用例空态三入口 + 教育卡（重新载入示例包前先看空态） */
    await waitFor(`!!document.querySelector("#tcList .tc-empty-entries")`, "三入口空态");
    await waitFor(`document.querySelectorAll("#tcList .tc-empty-card").length === 3`, "三个入口卡");
    await waitFor(`!!document.querySelector("#tcList .tc-empty-edu")`, "教育卡");
    const entryLabels = await evaluate(`[...document.querySelectorAll("#tcList .tc-empty-card strong")].map(e => e.textContent.trim()).join("|")`);
    assert(entryLabels === "AI 生成|导入 Excel|载入示例用例包", "入口标签异常：" + entryLabels);
    pass("空态三入口 + 教育卡：" + entryLabels);

    /* 6. 重新载入示例包，走三步向导（整个项目模式） */
    await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      await API.post("/api/test-cases/sample-pack", { reqId: ${JSON.stringify(RID)} });
      return true;
    })()`);
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("plans"))`);
    await waitFor(`!document.getElementById("tcPlans").hidden`, "计划列表容器");
    await evaluate(`document.getElementById("btnPlanNew").click()`);
    await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "向导弹层打开");
    await waitFor(`!!document.getElementById("pwPane1") && !document.getElementById("pwPane1").hidden`, "第 1 步可见");
    pass("向导打开于第 1 步（名称与范围）");

    await evaluate(`(() => {
      const el = document.getElementById("pwName");
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "E2E 示例包全量回归");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane2").hidden`, "第 2 步可见");
    await waitFor(`(document.querySelector('input[name="pwMode"][value="project"]').checked)`, "默认整个项目");
    const meta = await waitFor(`(() => {
      const t = document.getElementById("pwMetaProject").textContent;
      return t.indexOf("20 条") >= 0 ? t : false;
    })()`, "项目用例数预读 20 条");
    pass("第 2 步圈选方式，整个项目：" + meta);
    await evaluate(`document.getElementById("pwNext").click()`);
    await waitFor(`!document.getElementById("pwPane3").hidden`, "第 3 步可见");
    await waitFor(`document.querySelectorAll("#pwReview li").length === 7`, "检查清单 7 行");
    await evaluate(`document.getElementById("pwCreate").click()`);
    await waitFor(`!document.getElementById("dlgPlanWizard").classList.contains("open")`, "向导关闭");
    await waitFor(`!!document.querySelector("#tcPlans .plan-head")`, "落到计划详情");
    await waitFor(`(() => {
      const stats = [...document.querySelectorAll("#tcPlans .plan-stats .tc-stat")].map(e => e.textContent.replace(/\\s+/g, ""));
      return stats.some(t => t === "20圈选");
    })()`, "计划自动圈选 20 条");
    pass("向导创建：整个项目自动圈选 20 条并落详情");

    /* 7. 计划详情「下一步」提示条 + 计划周期 */
    await waitFor(`!!document.querySelector("#tcPlans .plan-next")`, "下一步提示条");
    const nextText = await evaluate(`document.querySelector("#tcPlans .plan-next").textContent.replace(/\\s+/g, " ").trim()`);
    assert(nextText.indexOf("开始执行") >= 0, "草稿计划应提示开始执行：" + nextText);
    pass("下一步提示条（草稿 → 开始执行）");

    /* 8. 报告零数据引导卡 */
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("report"))`);
    await waitFor(`!!document.querySelector("#tcReport .rep-guide")`, "报告零数据引导卡");
    const guide = await evaluate(`[...document.querySelectorAll("#tcReport .rep-guide li")].map(e => e.textContent.trim()).join("|")`);
    assert(guide.split("|").length === 3, "引导卡应三步：" + guide);
    pass("报告零数据引导卡：" + guide.slice(0, 40) + "…");
    /* 引导卡跳转：去计划页 */
    await evaluate(`document.querySelector("#tcReport [data-rep-guide-go='plans']").click()`);
    await waitFor(`import("./js/views/testcases.js").then(m => m.currentTcMode() === "plans")`, "引导跳计划页");
    pass("引导卡跳转计划页");

    /* 8.5 报告口径：执行后出现发布证据 / 跳过 KPI / 按计划出报告 */
    const evPlan = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.getAllPages("/api/test-plans", { reqId: ${JSON.stringify(RID)} });
      const p = rows.filter(r => r.status !== "done" && r.caseCount > 0)[0];
      if(!p) return null;
      const page = await API.get("/api/test-plans/" + p.id + "/cases", { limit: 5 });
      const ids = (page.items || []).slice(0, 2).map(c => c.caseId);
      if(ids.length < 2) return null;
      await API.put("/api/test-plans/" + p.id + "/cases/" + ids[0] + "/required?required=true", {});
      await API.put("/api/test-plans/" + p.id + "/cases/" + ids[1] + "/required?required=true", {});
      await API.post("/api/test-plans/" + p.id + "/runs", { caseIds: [ids[0]], status: "passed", note: "E2E 报告口径" });
      await API.post("/api/test-plans/" + p.id + "/runs", { caseIds: [ids[1]], status: "skipped", note: "E2E 报告口径" });
      await API.put("/api/test-plans/" + p.id + "/status?status=done", {});
      return { id: p.id, name: p.name };
    })()`);
    assert(!!evPlan, "找不到可执行计划的用例");
    await evaluate(`import("./js/views/testcases.js").then(m => m.setTcMode("report"))`);
    await waitFor(`document.querySelectorAll("#tcReport .rep-kpi").length === 5`, "报告 5 格 KPI", 20000);
    const rep = await evaluate(`(() => {
      const kpis = [...document.querySelectorAll("#tcReport .rep-kpi")].map(e => e.textContent.replace(/\\s+/g, ""));
      return {
        kpis,
        sub: (document.getElementById("pageSub") || {}).textContent || "",
        banner: (document.querySelector("#tcReport .rep-banner") || {}).textContent || "",
        note: (document.querySelector("#tcReport .rep-scope-note") || {}).textContent || "",
        evidence: (document.querySelector("#tcReport .rep-evidence") || {}).textContent.replace(/\\s+/g, "") || "",
        planBtn: !!document.querySelector("#tcReport [data-tc-report-plan]")
      };
    })()`);
    assert(rep.kpis.some(t => t.indexOf("跳过") >= 0), "缺少跳过 KPI：" + rep.kpis.join("|"));
    assert(/非发布证据/.test(rep.sub) && /非发布证据/.test(rep.note), "报告未标注非发布证据：sub=" + JSON.stringify(rep.sub) + " note=" + JSON.stringify(rep.note));
    assert(rep.planBtn && /按计划出报告/.test(rep.banner), "缺少「按计划出报告」入口");
    assert(rep.evidence.indexOf("发布必测通过1/2") >= 0, "发布必测证据异常：" + rep.evidence);
    assert(rep.evidence.indexOf("未执行/跳过1") >= 0, "发布必测跳过未按未执行计：" + rep.evidence);
    pass("报告口径：跳过 KPI + 非发布证据 + 发布必测证据");
    await evaluate(`document.querySelector("#tcReport [data-tc-report-plan]").click()`);
    await waitFor(`!!document.querySelector(".menu [data-rep-pick-plan]")`, "按计划出报告菜单");
    await evaluate(`document.querySelector(".menu [data-rep-pick-plan]").click()`);
    await waitFor(`!!document.querySelector("#tcPlans .plan-head") && document.querySelector("#tcPlans .plan-head .toolbar-title").textContent === ${JSON.stringify(evPlan.name)}`, "按计划出报告落详情", 15000);
    pass("按计划出报告：落到已完成计划详情");

    /* 9. 手动圈选模式：创建后空计划提示圈选 */
    await evaluate(`document.getElementById("btnPlanNew").click()`);
    await waitFor(`document.getElementById("dlgPlanWizard").classList.contains("open")`, "向导再次打开");
    await evaluate(`(() => {
      const el = document.getElementById("pwName");
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, "E2E 手动抽查计划");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await evaluate(`(() => {
      const r = document.querySelector('input[name="pwMode"][value="manual"]');
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await evaluate(`document.getElementById("pwNext").click()`);
    await evaluate(`document.getElementById("pwCreate").click()`);
    await waitFor(`!!document.querySelector("#tcPlans .plan-next")`, "手动计划详情提示条");
    const nextText2 = await evaluate(`document.querySelector("#tcPlans .plan-next").textContent.replace(/\\s+/g, " ").trim()`);
    assert(nextText2.indexOf("圈选") >= 0, "空计划应提示圈选用例：" + nextText2);
    pass("手动模式：空计划提示「圈选用例」");

    const exceptions = cdp.takeExceptions();
    assert(!exceptions.length, "页面出现脚本异常：" + JSON.stringify(exceptions.slice(0, 3)));
    pass("无页面脚本异常");

    console.log("\n结果：全部通过");
  }finally{
    try{
      if(cdp && sessionId && created && created.id){
        const res = await cdp.send("Runtime.evaluate", {
          expression: `(async () => {
            const { API } = await import("./js/core/api.js");
            await API.del("/api/reqs/" + encodeURIComponent(${JSON.stringify(created.id)}) + "?confirm=" + encodeURIComponent(${JSON.stringify(created.name)}));
            return true;
          })()`,
          awaitPromise: true, returnByValue: true
        }, sessionId);
        const ok = res && res.result && res.result.value === true;
        console.log(ok ? "  清理：临时项目已删除" : "  清理：临时项目删除失败，请手工删除 " + created.name);
      }
    }catch(e){
      console.log("  清理失败：" + e.message + "，请手工删除 " + (created && created.name));
      if(created && created.id){
        console.log("  SQL 兜底（本地 3307）：DELETE FROM requirement WHERE id='" + created.id + "';");
      }
    }
    try{ cdp && cdp.ws.close(); }catch(e){ /* 忽略 */ }
    try{ child.kill("SIGKILL"); }catch(e){ /* 忽略 */ }
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){ /* 忽略 */ }
  }
}

main().catch(err => {
  console.error("\nFAIL：" + err.message);
  process.exitCode = 1;
});
