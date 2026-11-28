/* B3 走查：版本「发布」页左右分区（发布计划卡 + 发布记录时间线）+ 独立「记录发布」页，
   真写一条发布事实（演示库可重建），验证时间线与计划状态回写。

   用法：
     E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
       node tools/e2e/record-flow.mjs
   截图默认落系统临时目录，可用 E2E_SHOT_DIR 指定。 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-record-"));

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"
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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
  onMessage(raw){
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if(msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }else if(msg.method) this.events.push(msg);
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  takeExceptions(){
    const bad = this.events.filter(e =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
    this.events = this.events.filter(e => !bad.includes(e));
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
    }catch(e){ /* not ready */ }
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

let failed = 0, passed = 0;
const pass = m => { passed++; console.log("  PASS " + m); };
const assert = (cond, msg) => { if(cond) pass(msg); else { failed++; console.log("  FAIL " + msg); } };

async function main(){
  fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-rec-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });

  let cdp, sessionId;
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    assert(port, "DevToolsActivePort 就绪");
    cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    for(const domain of ["Page", "Runtime", "Log"]) await cdp.send(`${domain}.enable`, {}, sessionId);

    const call = (method, params) => cdp.send(method, params, sessionId);
    const evaluate = async expression => {
      const res = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if(res.exceptionDetails){
        const d = res.exceptionDetails;
        throw new Error("执行失败：" + ((d.exception && d.exception.description) || d.text));
      }
      return res.result ? res.result.value : undefined;
    };
    const waitFor = async (expression, label, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expression); if(last) return last; }
        catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "页面加载 " + url, 25000);
    };
    const shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };

    console.log("B3 发布页分区 + 记录发布 走查\n  浏览器：" + chrome + "\n  地址：" + BASE + "\n  截图：" + SHOTS);

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
    await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);
    pass("登录 " + USER);

    /* 2. 选一个有计划的版本 */
    const picked = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/cross-project");
      const list = Array.isArray(rows) ? rows : (rows.items || []);
      let fallback = null;
      for(const v of list.slice().sort((a, b) => (b.taskCount || 0) - (a.taskCount || 0))){
        const plans = await API.get("/api/versions/" + encodeURIComponent(v.versionId) + "/release-plans");
        if(!Array.isArray(plans) || !plans.length) continue;
        const recs = await API.get("/api/versions/" + encodeURIComponent(v.versionId) + "/release-records");
        const prod = (recs || []).filter(r => r.environment === "production" && r.result === "success" && r.operation !== "rollback").length;
        const hit = { id: v.versionId, name: v.versionName, taskCount: v.taskCount || 0, prod, plans: plans.map(p => ({ id:p.id, status:p.status, env:p.environment })) };
        if(hit.taskCount && !prod) return hit;
        if(!fallback) fallback = hit;
      }
      return fallback;
    })()`);
    assert(picked && picked.id, "找到带发布计划的版本：" + (picked ? picked.name : "无"));
    if(!picked) throw new Error("没有可验证的版本计划");

    /* 3. 发布页左右分区 */
    await navigate(BASE + "/index.html#/version?id=" + encodeURIComponent(picked.id) + "&tab=releases");
    await waitFor(`document.body.dataset.view === "version" && !!document.querySelector("#view-version .vd-rel-split")`, "发布页左右分区", 25000);
    await sleep(800);
    const split = await evaluate(`(() => {
      const root = document.querySelector("#view-version .vd-rel-split");
      const cs = getComputedStyle(root);
      const planCard = root.querySelector(".vd-plan-card");
      const tl = root.querySelector(".vd-timeline");
      return {
        cols: cs.gridTemplateColumns,
        planHead: !!root.querySelector(".vd-plan-cards") && root.querySelectorAll(".vd-plan-card").length,
        headTexts: [...root.querySelectorAll(".panel-head h3")].map(e => e.textContent.trim()),
        recordBtn: root.querySelectorAll("[data-vd-record-plan]").length,
        manageBtn: root.querySelectorAll("[data-vd-tool=plan]").length,
        chips: [...root.querySelectorAll("[data-vd-rel-chip]")].map(e => e.textContent.trim()),
        items: root.querySelectorAll(".vd-tl-item").length,
        timelinePresent: !!tl || !!root.querySelector(".vd-rel-empty"),
        hint: (root.querySelector(".vd-rel-hint") || {}).textContent || ""
      };
    })()`);
    assert(split.cols.split(" ").length === 2, "左右两列：" + split.cols);
    assert(split.planHead > 0, "计划卡 " + split.planHead + " 张");
    assert(split.headTexts.includes("发布计划") && split.headTexts.includes("发布记录"), "两栏标题：" + split.headTexts.join(" / "));
    assert(split.recordBtn > 0 && split.manageBtn > 0, "计划卡带 记录发布 " + split.recordBtn + " 个 / 管理计划 " + split.manageBtn + " 个");
    assert(split.chips.join(",") === "全部,成功,失败,回滚", "记录筛选 chips：" + split.chips.join(","));
    assert(split.timelinePresent, "时间线容器存在");
    console.log("  INFO 该版本已有发布记录 " + split.items + " 条");
    await shot("b3-vrelease-split-1440");

    /* 3.1 计划状态筛选 */
    await evaluate(`(() => { const b = document.querySelector('#view-version [data-vd-plan-chip=ready]'); if(b) b.click(); return true; })()`);
    await sleep(400);
    const readyOnly = await evaluate(`(() => {
      const cards = [...document.querySelectorAll("#view-version .vd-plan-card")];
      return { n: cards.length, allReady: cards.every(c => {
        const tag = c.querySelector(".vd-plan-top .tag");
        return !!tag && tag.textContent.trim() === "就绪";
      }) };
    })()`);
    assert(readyOnly.allReady, "「就绪」筛选只剩就绪计划（" + readyOnly.n + " 张）");
    await evaluate(`(() => { const b = document.querySelector('#view-version [data-vd-plan-chip=all]'); if(b) b.click(); return true; })()`);
    await sleep(300);
    const allBack = await evaluate(`document.querySelectorAll("#view-version .vd-plan-card").length`);
    assert(allBack === split.planHead, "切回「全部」恢复 " + allBack + " 张");

    /* 4. 记录筛选生效 */
    const beforeCount = split.items;
    const chipCheck = await evaluate(`(() => {
      const root = document.querySelector("#view-version .vd-rel-split");
      const btn = [...root.querySelectorAll("[data-vd-rel-chip]")].find(b => b.getAttribute("data-vd-rel-chip") === "rollback");
      if(!btn) return false;
      btn.click();
      return true;
    })()`);
    assert(chipCheck, "点得到「回滚」筛选");
    await sleep(400);
    const afterRollback = await evaluate(`document.querySelectorAll("#view-version .vd-tl-item").length`);
    assert(afterRollback <= beforeCount, "回滚筛选后条数 " + afterRollback + " ≤ " + beforeCount);
    await evaluate(`(() => { const b = document.querySelector('[data-vd-rel-chip=all]'); if(b) b.click(); return true; })()`);
    await sleep(300);

    /* 5. 进入记录发布页 */
    await evaluate(`(() => { const b = document.querySelector("#view-version [data-vd-record-plan]"); if(!b) return false; b.click(); return true; })()`);
    await waitFor(`document.body.dataset.view === "record" && !!document.querySelector(".record-page")`, "记录发布页", 20000);
    await sleep(1200);
    const rec = await evaluate(`(() => {
      const page = document.querySelector(".record-page");
      return {
        hash: location.hash,
        secs: [...page.querySelectorAll(".record-sec-h b")].map(e => e.textContent.trim()),
        planOpts: [...page.querySelectorAll("[data-rec-plan] option")].map(o => o.textContent.trim()),
        envCards: [...page.querySelectorAll("[data-rec-env-val]")].map(b => b.textContent.trim()),
        resCards: [...page.querySelectorAll("[data-rec-result-val]")].map(b => b.textContent.trim()),
        time: (page.querySelector("[data-rec-time]") || {}).value || "",
        artifact: (page.querySelector("[data-rec-artifact]") || {}).value || "",
        compare: [...page.querySelectorAll(".record-chk")].map(e => e.textContent.trim().replace(/\\s+/g, " ")),
        side: [...page.querySelectorAll(".record-side .panel-head h3")].map(e => e.textContent.trim()),
        affects: (page.querySelector("#recAffects") || {}).textContent.replace(/\\s+/g, " ").trim().slice(0, 160),
        lock: !!page.querySelector(".record-lock"),
        saveDisabled: (page.querySelector("[data-rec-save]") || {}).disabled
      };
    })()`);
    assert(rec.hash.indexOf("/record?") >= 0 && rec.hash.indexOf("planId=") >= 0, "落地记录页且带计划：" + rec.hash);
    assert(rec.secs.length === 3, "三段引导：" + rec.secs.join(" / "));
    assert(rec.envCards.length === 3 && rec.envCards.every(Boolean), "环境三选一：" + rec.envCards.join("/"));
    assert(rec.resCards.length === 3, "结果三选一：" + rec.resCards.join("/"));
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rec.time), "默认时间已填：" + rec.time);
    assert(rec.artifact === "manual", "默认制品 manual");
    assert(rec.compare.length === 4, "计划比对四行：" + rec.compare.length);
    assert(rec.side.join(",") === "填写说明,本次发布将计入", "右栏说明：" + rec.side.join(","));
    assert(rec.affects.length > 0, "右栏计入预览：" + rec.affects);
    assert(!rec.saveDisabled, "保存按钮可用");
    await shot("b3-record-default-1440");

    /* 6. 有偏差时校验理由 */
    const planStatus = picked.plans[0].status;
    if(planStatus !== "ready"){
      console.log("  INFO 首个计划状态 " + planStatus + "，跳过偏差必填交互");
    }else{
      await evaluate(`(() => {
        const b = document.querySelector("[data-rec-result-val=failed]"); if(b) b.click(); return true;
      })()`);
      await sleep(200);
      const failVisible = await evaluate(`!document.getElementById("recFailWrap").hidden`);
      assert(failVisible, "选失败显示失败原因");
      await evaluate(`(() => {
        const t = document.querySelector("[data-rec-failure]");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "回归发现接口 500");
        t.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await evaluate(`(() => { const b = document.querySelector("[data-rec-result-val=success]"); if(b) b.click(); return true; })()`);
      await sleep(200);
      const failHidden = await evaluate(`document.getElementById("recFailWrap").hidden`);
      assert(failHidden, "切回成功隐藏失败原因");
    }

    /* 7. 找一条可引用成功记录，验证回滚联动 */
    const rollbackInfo = await evaluate(`(() => {
      const b = document.querySelector("[data-rec-result-val=rollback]");
      if(!b) return null;
      b.click();
      return true;
    })()`);
    await sleep(400);
    const related = await evaluate(`(() => {
      const wrap = document.getElementById("recRelatedWrap");
      const sel = document.querySelector("[data-rec-related]");
      return { visible: wrap && !wrap.hidden, opts: sel ? [...sel.options].map(o => o.textContent.trim()) : [] };
    })()`);
    assert(rollbackInfo && related.visible, "选回滚显示引用记录");
    console.log("  INFO 回滚可引用记录：" + (related.opts.length ? related.opts.join(" | ") : "无"));
    await evaluate(`(() => { const b = document.querySelector("[data-rec-result-val=success]"); if(b) b.click(); return true; })()`);
    await sleep(200);

    /* 8. 真写一条生产成功记录 */
    const beforeRel = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/" + encodeURIComponent(${JSON.stringify(picked.id)}) + "/release-records");
      return (Array.isArray(rows) ? rows : (rows.items || [])).length;
    })()`);
    /* 计划没就绪 / 计划外都会要求偏差理由，按页面提示补填 */
    const devInfo = await evaluate(`(() => {
      const warns = document.querySelectorAll(".record-chk.is-warn").length;
      const sel = document.querySelector("[data-rec-plan]");
      return { warns, planId: sel ? sel.value : "", label: sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : "" };
    })()`);
    if(devInfo.warns){
      console.log("  INFO 比对有 " + devInfo.warns + " 项偏差（计划：" + (devInfo.label || "无") + "），补填偏差理由");
      await evaluate(`(() => {
        const t = document.querySelector("[data-rec-deviation]");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "B3 走查：按计划同日发布，执行晚于计划窗口");
        t.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await sleep(200);
    }
    /* 制品用唯一值：避免与上一轮走查的相同成功事件被后端防重规则拦下 */
    await evaluate(`(() => {
      const el = document.querySelector("[data-rec-artifact]");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "b3-${Date.now()}");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    await evaluate(`(() => { const b = document.querySelector("[data-rec-save]"); if(b) b.click(); return true; })()`);
    let saveOutcome = await waitFor(`(() => {
      if(document.body.dataset.view === "version") return "left";
      const err = document.getElementById("recError");
      if(err && !err.hidden && err.textContent.trim()) return "err:" + err.textContent.trim();
      return false;
    })()`, "保存结果", 25000);
    /* 页面比对无偏差、但预览仍要求理由时（后端校验更严），补理由再提交一次 */
    if(saveOutcome !== "left" && /偏差理由/.test(saveOutcome)){
      console.log("  INFO 预览要求偏差理由，补填后重试：" + saveOutcome);
      await shot("b3-preview-need-reason-1440");
      await evaluate(`(() => {
        const t = document.querySelector("[data-rec-deviation]");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "B3 走查：预览提示存在异常项，按实际情况说明后提交");
        t.dispatchEvent(new Event("input", { bubbles: true }));
        const b = document.querySelector("[data-rec-save]");
        if(b) b.click();
        return true;
      })()`);
      saveOutcome = await waitFor(`(() => {
        if(document.body.dataset.view === "version") return "left";
        const err = document.getElementById("recError");
        if(err && !err.hidden && err.textContent.trim()) return "err:" + err.textContent.trim();
        return false;
      })()`, "保存重试结果", 25000);
    }
    if(saveOutcome !== "left"){
      console.log("  INFO 保存返回：" + saveOutcome);
      await shot("b3-save-error-1440");
    }
    assert(saveOutcome === "left", "保存后回到版本页");
    if(saveOutcome !== "left") throw new Error("保存未通过：" + saveOutcome);
    await waitFor(`document.body.dataset.view === "version"`, "回到版本页", 20000);
    await sleep(1000);
    const afterState = await evaluate(`(async () => {
      const { API } = await import("./js/core/api.js");
      const rows = await API.get("/api/versions/" + encodeURIComponent(${JSON.stringify(picked.id)}) + "/release-records");
      const items = Array.isArray(rows) ? rows : (rows.items || []);
      return {
        hash: location.hash,
        count: items.length,
        latest: items[0] ? { result: items[0].result, env: items[0].environment, op: items[0].operation } : null,
        tlItems: document.querySelectorAll("#view-version .vd-tl-item").length
      };
    })()`);
    assert(afterState.count === beforeRel + 1, "发布记录 +1：" + beforeRel + " → " + afterState.count);
    assert(afterState.latest && afterState.latest.result === "success" && afterState.latest.env === "production", "最新记录=" + JSON.stringify(afterState.latest));
    const firstTitle = await evaluate(`(() => {
      const el = document.querySelector("#view-version .vd-tl-item b");
      return el ? el.textContent.trim() : "";
    })()`);
    assert(/生产发布成功/.test(firstTitle), "时间线首条标题：" + firstTitle);
    await shot("b3-after-record-1440");

    /* 9. 全部计划 / 计划工作台入口仍然可用 */
    const allPlans = await evaluate(`(() => {
      const b = document.querySelector("#view-version [data-vd-all-plans]");
      if(!b) return false;
      b.click();
      return true;
    })()`);
    assert(allPlans, "点得到「全部发布计划」");
    await waitFor(`document.body.dataset.view === "release"`, "跳到发布计划列表", 15000);
    pass("发布计划列表可进入");

    /* 10. 无脚本异常 */
    const bad = cdp.takeExceptions();
    assert(!bad.length, "无脚本异常" + (bad.length ? "：" + JSON.stringify(bad.slice(0, 2)) : ""));

    console.log("\n结果：PASS " + passed + " / FAIL " + failed + "\n截图目录：" + SHOTS);
    if(failed) process.exitCode = 1;
  } finally {
    try{ child.kill("SIGKILL"); }catch(e){ /* noop */ }
    await sleep(300);
    try{ fs.rmSync(profile, { recursive: true, force: true }); }catch(e){ /* noop */ }
  }
}

main().catch(err => { console.error("走查中断：" + (err && err.stack || err)); process.exitCode = 1; });
