/* B4 交付说明阅读态走查：横幅（N 处待确认 + 全部确认/逐项查看）、左目录 ✓/!、正文逐段确认与撤回。
   只读 + 一次确认/撤回往返（不改文字），截图落 E2E_SHOT_DIR。
   用法：E2E_BASE=http://127.0.0.1:8081/hourglass E2E_USER=admin E2E_PASS=admin123 \
         E2E_VERSION=Vmwkdzu9q7a4dlyka node tools/e2e/delivery-read.mjs */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const VERSION = process.env.E2E_VERSION || "";
const SHOTS = process.env.E2E_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-delivery-"));

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
    }catch(e){ /* waiting */ }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hourglass-dl-"));
  const child = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions",
    "--window-size=1440,900", "about:blank"
  ], { stdio: "ignore" });
  try{
    const portFile = path.join(profile, "DevToolsActivePort");
    let port = null;
    for(let i = 0; i < 100 && !port; i++){
      try{ port = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]); }
      catch(e){ await sleep(100); }
    }
    const cdp = await connect(port);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const sessionId = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
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
    const waitFor = async (expression, label, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      let last;
      while(Date.now() < deadline){
        try{ last = await evaluate(expression); if(last) return last; }catch(e){ last = e.message; }
        await sleep(150);
      }
      throw new Error(`等待超时：${label}（最后：${JSON.stringify(last)}）`);
    };
    const navigate = async url => {
      await call("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'", "加载 " + url, 25000);
    };
    const shot = async name => {
      const res = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(res.data, "base64"));
    };

    console.log("B4 交付说明阅读态 走查\n  地址：" + BASE + "\n  截图：" + SHOTS);

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

    let vid = VERSION;
    if(!vid){
      vid = await evaluate(`(async () => {
        const { API } = await import("./js/core/api.js");
        const rows = await API.get("/api/versions/cross-project");
        for(const v of rows || []){
          try{
            const note = await API.get("/api/versions/" + encodeURIComponent(v.versionId) + "/delivery-note");
            if(note && (note.sections || note.counts)) return v.versionId;
          }catch(e){ /* 没有说明就换下一个 */ }
        }
        return "";
      })()`);
    }
    assert(!!vid, "找到有交付说明的版本：" + vid);
    if(!vid) throw new Error("没有可验证的交付说明");

    await navigate(BASE + "/index.html#/version?id=" + encodeURIComponent(vid) + "&tab=home");
    await waitFor(`document.body.dataset.view === "version" && !!document.querySelector("#view-version .vd-tabs")`, "版本详情", 25000);
    const opened = await evaluate(`(() => { const b = document.querySelector("#view-version [data-vd-delivery]"); if(!b) return false; b.click(); return true; })()`);
    assert(opened, "点得到「交付说明」页签");
    await waitFor(`document.body.dataset.view === "delivery" && !!document.getElementById("dlBanner")`, "交付说明页", 25000);
    await sleep(1200);

    const ui = await evaluate(`(() => {
      const banner = document.getElementById("dlBanner");
      const nav = document.getElementById("dlSecnav");
      const sheet = document.querySelector("#dlSheetHost .dl-sheet");
      return {
        hash: location.hash,
        banner: banner ? banner.textContent.replace(/\\s+/g, " ").trim().slice(0, 180) : "",
        bannerActs: [...document.querySelectorAll("#dlBanner [data-dl-act]")].map(b => b.textContent.trim()),
        navHead: (document.getElementById("dlNavHead") || {}).textContent || "",
        nav: [...(nav ? nav.querySelectorAll("button") : [])].map(b => ({
          t: b.textContent.trim(),
          mark: (b.querySelector(".sv-mark") || {}).className || "",
          pending: b.hasAttribute("data-pending")
        })),
        foot: (document.querySelector(".dl-sidenav-foot") || {}).textContent || "",
        sections: sheet ? sheet.querySelectorAll(".dl-sec").length : 0,
        confirmBtns: [...document.querySelectorAll('#dlSheetHost [data-dl-act="accept"]')].map(b => b.dataset.dlKey),
        unconfirmBtns: [...document.querySelectorAll('#dlSheetHost [data-dl-act="unconfirm"]')].map(b => b.dataset.dlKey),
        pending: Number((document.getElementById("dlMeterPending") || {}).textContent || 0),
        highlight: document.querySelectorAll("#dlSheetHost .dl-narr-wrap.pending").length,
        editBtns: document.querySelectorAll('#dlSheetHost [data-dl-act="edit-one"]').length,
        paper: !!sheet,
        measureActs: document.querySelectorAll("#dlMeasure [data-dl-act]").length,
        measureInert: !!(document.getElementById("dlMeasure") || {}).inert
      };
    })()`);
    assert(ui.hash.indexOf("/delivery?") >= 0 && ui.hash.indexOf(vid) >= 0, "深链落到该版本交付说明：" + ui.hash);
    assert(ui.banner.length > 0, "横幅有文案：" + ui.banner);
    assert(ui.bannerActs.indexOf("逐项查看") >= 0 && ui.bannerActs.indexOf("全部确认") > ui.bannerActs.indexOf("逐项查看"), "横幅动作：逐项查看 → 全部确认");
    assert(ui.nav.length >= 3, "左侧目录 " + ui.nav.length + " 节");
    assert(ui.nav.every(n => /sv-mark (ok|warn|neutral)/.test(n.mark)), "每节目录都有 ✓/!/· 状态标记");
    assert(/章节 · \d+ 节/.test(ui.navHead), "目录头按原型写「章节 · N 节」：" + ui.navHead);
    assert(/内容已定稿/.test(ui.foot) && /含待确认对外表述/.test(ui.foot) && /正文改动不影响发布记录/.test(ui.foot), "目录脚注图例齐全");
    assert(ui.paper && ui.sections >= 3, "正文纸张 " + ui.sections + " 节");
    assert(ui.pending === ui.confirmBtns.length, "待确认数 " + ui.pending + " = 确认按钮 " + ui.confirmBtns.length);
    assert(ui.pending === ui.highlight, "待确认段落高亮 " + ui.highlight + " 处");
    assert(ui.measureActs === 0 && ui.measureInert, "离屏量页副本不暴露可操作控件");
    await shot("b4-delivery-default-1440");

    const pendingNow = () => evaluate(`Number((document.getElementById("dlMeterPending") || {}).textContent || 0)`);
    const waitPending = (n, label) => waitFor(`Number((document.getElementById("dlMeterPending") || {}).textContent || 0) === ${n}`, label, 8000);

    /* 逐段确认 → 撤回往返；只动确认状态，不改文字 */
    if(ui.confirmBtns.length){
      const key = ui.confirmBtns[0];
      await evaluate(`(() => { const b = document.querySelector('#dlSheetHost [data-dl-act="accept"][data-dl-key="${key}"]'); if(b) b.click(); return true; })()`);
      await waitPending(ui.pending - 1, "确认后待确认数减一");
      const afterAccept = await evaluate(`(() => ({
        pending: Number((document.getElementById("dlMeterPending") || {}).textContent || 0),
        hasUnconfirm: !!document.querySelector('#dlSheetHost [data-dl-act="unconfirm"][data-dl-key="${key}"]'),
        navHead: (document.getElementById("dlNavHead") || {}).textContent || ""
      }))()`);
      assert(afterAccept.pending === ui.pending - 1, "确认后待确认数 " + ui.pending + " → " + afterAccept.pending);
      assert(afterAccept.hasUnconfirm, "确认后可撤回");
      const navAfterAccept = await evaluate(`(() => {
        const map = { summary: "summary", change: "changes", issue: "defects", acceptance: "acceptance" };
        const b = document.querySelector('#dlSecnav [data-dl-jump="' + map["${key}"] + '"]');
        return b && b.querySelector(".sv-mark") ? b.querySelector(".sv-mark").className : "";
      })()`);
      assert(/ok/.test(navAfterAccept), "确认后目录该节显示 ✓");
      await shot("b4-delivery-confirmed-1440");
      await evaluate(`(() => { const b = document.querySelector('#dlSheetHost [data-dl-act="unconfirm"][data-dl-key="${key}"]'); if(b) b.click(); return true; })()`);
      await waitPending(ui.pending, "撤回后待确认数恢复");
      const afterWithdraw = await pendingNow();
      assert(afterWithdraw === ui.pending, "撤回后待确认数恢复为 " + afterWithdraw);
      const navAfterWithdraw = await evaluate(`(() => {
        const map = { summary: "summary", change: "changes", issue: "defects", acceptance: "acceptance" };
        const b = document.querySelector('#dlSecnav [data-dl-jump="' + map["${key}"] + '"]');
        return b && b.querySelector(".sv-mark") ? b.querySelector(".sv-mark").className : "";
      })()`);
      assert(/warn/.test(navAfterWithdraw), "撤回后目录该节回到 !");
    }

    /* 逐项查看：跳到第一个待确认区块 */
    if(ui.pending > 0){
      await evaluate(`(() => { const b = document.querySelector('#dlBanner [data-dl-act="goto-pending"]'); if(b) b.click(); return true; })()`);
      await sleep(700);
      const jumped = await evaluate(`(() => {
        const cur = document.querySelector("#dlSecnav button.on, #dlSecnav button[aria-current]");
        return { cur: cur ? cur.textContent.trim() : "", y: window.scrollY };
      })()`);
      assert(!!jumped.cur || jumped.y > 0, "「逐项查看」定位到待确认区块：" + (jumped.cur || ("scroll " + jumped.y)));
    }

    /* 全部确认后横幅转绿；再逐段撤回到走查前的数量 */
    const before = await pendingNow();
    if(before > 0){
      await evaluate(`(() => { const b = document.querySelector('#dlBanner [data-dl-act="accept-all"]'); if(b) b.click(); return true; })()`);
      await waitPending(0, "全部确认后待确认归零");
      const allDone = await evaluate(`(() => ({
        pending: Number((document.getElementById("dlMeterPending") || {}).textContent || 0),
        banner: document.getElementById("dlBanner").textContent.replace(/\\s+/g, " ").trim(),
        cls: document.querySelector("#dlBanner .dl-banner") ? document.querySelector("#dlBanner .dl-banner").className : ""
      }))()`);
      assert(allDone.pending === 0, "全部确认后待确认归零");
      assert(/就绪|已确认/.test(allDone.banner), "横幅转绿文案：" + allDone.banner.slice(0, 80));
      await waitFor(`!document.querySelector('#dlSecnav [data-pending]') && !document.querySelector('#dlSecnav .sv-mark.warn')`, "目录待确认标记清零", 8000);
      pass("全部确认后目录不再有 ! 标记");
      await waitFor(`(() => { const el = document.getElementById("dlSaveState"); return !!el && /已保存/.test(el.textContent); })()`, "全部确认保存完成", 12000);
      await evaluate(`(() => { const s = document.getElementById("view-delivery"); if(s) s.scrollTo(0, 0); else window.scrollTo(0, 0); return true; })()`);
      await sleep(400);
      await shot("b4-delivery-all-confirmed-1440");
      /* 还原到走查前状态：逐段撤回，等 URL 里的确认数真的变化再点下一个，避免并发保存互相覆盖 */
      for(let i = 1; i <= before; i++){
        const clicked = await evaluate(`(() => { const b = document.querySelector('#dlSheetHost [data-dl-act="unconfirm"]'); if(!b) return false; b.click(); return true; })()`);
        if(!clicked) break;
        await waitPending(i, "撤回第 " + i + " 段");
      }
      await sleep(600);
      const restored = await pendingNow();
      assert(restored === before, "撤回后恢复走查前待确认数 " + before + "（现 " + restored + "）");

      /* 等这一版真的落库再刷新核对：既验持久化，也验修订号不会因响应被丢弃而 409 */
      await waitFor(`(() => { const el = document.getElementById("dlSaveState"); return !!el && /已保存/.test(el.textContent); })()`, "保存完成", 12000);
      pass("确认与撤回已保存");
      const hash = await evaluate("location.hash");
      await navigate(BASE + "/index.html" + hash);
      await waitFor(`document.body.dataset.view === "delivery" && !!document.getElementById("dlMeterPending")`, "刷新后交付说明", 25000);
      await sleep(600);
      const persisted = await pendingNow();
      assert(persisted === before, "刷新后待确认数仍为 " + before + "（现 " + persisted + "）");
    }

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
