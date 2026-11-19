/* 需求池看板「全部项目 / 聚焦项目」E2E（仿 tools/e2e/backup-numbers.mjs，CDP）
   覆盖：全部项目默认进入 + 按项目泳道分组、聚焦项目后卡片动作回归
   （评审通过 → 排期（暂不指定版本）→ 撤排 → 更多菜单出现 → 详情抽屉打开）、
   范围切换计数跟随、控制台报错。自建临时空间，结束即删。
   Node 18 无原生 WebSocket，用本地 ws 包（/tmp/e2e-ws/node_modules）兜底。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocketMod = typeof WebSocket === "function"
  ? { WebSocket }
  : (() => { try{ return require("ws"); }catch(e){ return require(process.env.E2E_WS_PATH || "/tmp/e2e-ws/node_modules/ws"); } })();
const WS = WebSocketMod.WebSocket || WebSocketMod.default || WebSocketMod;

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9253);

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.pageErrors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.pageErrors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      const text = msg.params.args.map(a => a.value || a.description || "").join(" ");
      if(text.indexOf("favicon") === -1) this.errors.push("console.error: " + text);
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      this.errors.push("log: " + msg.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = payload.sessionId || sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dem-board-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + CDP_PORT, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0, stamp = Date.now(), createdWs = null;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };
try{
  let version = null;
  for(let i = 0; i < 60 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WS(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const cdp = new Cdp(ws);

  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
  const call = (m, p) => cdp.send(m, p, sid);
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
  const api = (method, url, body) => evaluate(
    `import("./js/core/api.js").then(({API}) => API.${method === "delete" ? "del" : method}(${JSON.stringify(url)}${body === undefined ? "" : ", " + JSON.stringify(body)}))`);
  const navigate = async url => {
    /* 同一 URL 的 Page.navigate 是同文档跳转、不会重新加载；先 reload 保证拿到最新数据 */
    const same = await evaluate(`location.href === ${JSON.stringify(url)}`);
    if(same) await call("Page.reload", { ignoreCache: false });
    else await call("Page.navigate", { url });
    await waitFor("document.readyState === 'complete'", "页面加载 " + url, 20000);
  };

  console.log("需求池看板 全部项目/聚焦项目 E2E\n  地址：" + BASE);

  /* 登录 */
  await navigate(BASE + "/login.html");
  await waitFor("!!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("uName", ${JSON.stringify(USER)});
    set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("loginForm").requestSubmit();
    return true;
  })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 20000)
    .catch(async () => {
      /* 登录后 302/跳转失败时排查：打印当前 URL 与登录错误框 */
      const diag = await evaluate(`JSON.stringify({
        href: location.href,
        err: (() => { const e = document.getElementById("loginErr"); return e ? !e.hidden && document.getElementById("loginErrMsg").textContent : null; })(),
        btn: (() => { const b = document.getElementById("btnLogin"); return b ? { disabled: b.disabled, text: b.textContent } : null; })()
      })`);
      console.log("  DIAG 登录诊断：" + diag);
      throw new Error("登录失败，见 DIAG");
    });

  /* 临时空间：避免污染演示空间 */
  stamp = Date.now();
  const wsRow = await api("post", "/api/workspaces", { name: "看板回归" + stamp });
  createdWs = wsRow.id;
  await api("post", `/api/workspaces/${createdWs}/select`, {});
  await call("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await call("Page.navigate", { url: BASE + "/#/demands" });
  await waitFor(`document.readyState === "complete" && import("./js/core/state.js").then(({rt}) => rt.currentWs && rt.currentWs.id === ${JSON.stringify(createdWs)} && rt.reqsLoaded)`, "切到临时空间");

  const pA = await api("post", "/api/reqs", { name: "看板回归项目A" + stamp, status: "active", template: "blank" });
  const pB = await api("post", "/api/reqs", { name: "看板回归项目B" + stamp, status: "active", template: "blank" });
  assert(!!pA.id && !!pB.id, "准备：两个项目创建成功");
  const dA1 = await api("post", "/api/demands", { reqId: pA.id, title: "回归需求A1", priority: "P1" });
  const dA2 = await api("post", "/api/demands", { reqId: pA.id, title: "回归需求A2", priority: "P2" });
  const dB1 = await api("post", "/api/demands", { reqId: pB.id, title: "回归需求B1", priority: "P2" });
  assert(!!dA1.id && !!dA2.id && !!dB1.id, "准备：三个需求创建成功");

  await navigate(BASE + "/#/demands");
  await waitFor(`document.querySelectorAll('#demandBody .bkl-col').length === 5`, "看板五列渲染（含已完成）");
  await waitFor(`document.querySelectorAll('#demandBody .bkl-card').length === 3`, "三张卡片渲染");
  const doneColScope = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="done"]');
    const head = col && col.querySelector(".bkl-title");
    return { exists: !!col, head: head ? head.textContent.trim() : "" };
  })()`);
  assert(doneColScope.exists === true, "已完成列存在（由完成判定自动进出）");
  assert(doneColScope.head.indexOf("已完成") >= 0, "已完成列标题正确（实际：" + doneColScope.head + "）");

  /* 1. 默认全部项目：选择器值 + meta 文案 + 泳道分组 */
  const scopeDefault = await evaluate(`(() => {
    const sel = document.getElementById("demandReq");
    return { value: sel ? sel.value : "missing", text: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "" };
  })()`);
  assert(scopeDefault.value === "", "全部项目为默认值（选择器 value 为空串）");
  assert((scopeDefault.text || "").indexOf("全部项目") >= 0, "选择器显示「全部项目」");
  const lanes = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="review"]');
    return Array.from(col.querySelectorAll(".bkl-lane")).map(l => ({
      name: l.querySelector(".bkl-lane-name").textContent,
      count: l.querySelector(".bkl-lane-count").textContent,
      cards: l.querySelectorAll(".bkl-card").length
    }));
  })()`);
  assert(lanes.length === 2, "待评审列出现两个项目泳道（实际 " + lanes.length + "）");
  assert(lanes[0].name === "看板回归项目A" + stamp && lanes[0].cards === 2, "泳道1=项目A，2 张卡");
  assert(lanes[1].name === "看板回归项目B" + stamp && lanes[1].cards === 1, "泳道2=项目B，1 张卡");
  const metaAll = await evaluate(`document.getElementById("demandsMeta").textContent`);
  assert(metaAll.indexOf("全部项目") >= 0, "meta 显示「全部项目」范围（实际：" + metaAll + "）");
  const barVisibleAll = await evaluate(`!document.querySelector(".dem-board-bar").hidden`);
  assert(barVisibleAll === true, "全部项目下紧凑搜索条可见");
  const newBtnAll = await evaluate(`document.getElementById("btnDemandNew").style.display !== "none"`);
  assert(newBtnAll === true, "全部项目下「提需求」按钮可见");

  /* 2. 泳道内卡片动作：全部项目模式下通过 A1（经泳道内卡片主按钮） */
  const passInLane = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="pass"]');
    const btn = col && col.querySelector('[data-dem-pass]');
    if(!btn) return null;
    btn.click();
    return btn.dataset.demPass;
  })()`);
  assert(passInLane === dA1.id, "全部项目模式：泳道内「通过」按钮存在并点击");
  await waitFor(`document.querySelectorAll('#demandBody .bkl-col[data-col="pass"] .bkl-card').length === 1`, "A1 进入已通过列（泳道形态）", 15000);

  /* 3. 切到聚焦项目A */
  await evaluate(`(() => {
    const sel = document.getElementById("demandReq");
    sel.value = ${JSON.stringify(pA.id)};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(`(() => {
    const cards = document.querySelectorAll('#demandBody .bkl-card');
    if(cards.length !== 2) return false;
    return !document.querySelector('#demandBody .bkl-lane');
  })()`, "聚焦项目A：无泳道、2 张卡", 15000);
  const metaFocus = await evaluate(`document.getElementById("demandsMeta").textContent`);
  assert(metaFocus.indexOf("看板回归项目A") >= 0, "meta 显示项目A名（实际：" + metaFocus + "）");
  const selText = await evaluate(`document.getElementById("demandReq").selectedOptions[0].textContent`);
  assert(selText === "看板回归项目A" + stamp, "选择器切到项目A");

  /* 4. 聚焦项目卡片动作回归：通过 A2 → 排期（暂不指定版本）→ 撤排 */
  const passA2 = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="review"]');
    const btn = col && col.querySelector('[data-dem-pass]');
    if(!btn) return null;
    btn.click();
    return true;
  })()`);
  assert(passA2 === true, "聚焦项目：待评审卡「通过」按钮可点");
  await waitFor(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="pass"]');
    return col && col.querySelectorAll('.bkl-card').length === 2;
  })()`, "聚焦项目：A2 通过后进入已通过列", 15000);

  /* A1 排期进入版本：弹窗打开、版本下拉按项目A加载、暂不指定 */
  const planOpened = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="pass"]');
    const btns = Array.from(col.querySelectorAll('[data-dem-plan]'));
    const btn = btns.find(b => b.closest(".bkl-card").querySelector(".link-title").textContent.indexOf("回归需求A1") >= 0);
    if(!btn) return null;
    btn.click();
    return true;
  })()`);
  assert(planOpened === true, "聚焦项目：A1 卡「排期进入版本」按钮可点");
  const dlgPlan = await waitFor(`(() => {
    const dlg = document.getElementById("dlgDemandPlan");
    return dlg && dlg.classList.contains("open");
  })()`, "排期弹窗打开");
  assert(dlgPlan === true, "排期弹窗打开");
  const planVerReady = await waitFor(`(() => {
    const sel = document.getElementById("dpVersion") || document.querySelector("#dlgDemandPlan select");
    return sel && !sel.disabled && !sel.textContent.includes("加载中") ? sel.textContent : false;
  })()`, "版本下拉就绪");
  assert((planVerReady || "").indexOf("暂不指定目标版本") >= 0, "版本下拉含「暂不指定目标版本」（实际：" + planVerReady + "）");
  await evaluate(`(() => { document.getElementById("btnDoPlan").click(); return true; })()`);
  await waitFor(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="plan"]');
    return col && Array.from(col.querySelectorAll(".bkl-card .link-title")).some(t => t.textContent.indexOf("回归需求A1") >= 0);
  })()`, "A1 排期后进入已排期列", 15000);
  const stageTag = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="plan"]');
    const card = Array.from(col.querySelectorAll(".bkl-card")).find(c => c.textContent.indexOf("回归需求A1") >= 0);
    const tag = card && card.querySelector(".dem-stage-tag");
    return tag ? tag.textContent : "";
  })()`);
  assert(stageTag === "待开工", "A1 派生交付阶段=待开工（实际：" + stageTag + "）");

  /* A1 撤排：更多菜单 → 撤销排期（需原因） */
  const menuOpened = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="plan"]');
    const card = Array.from(col.querySelectorAll(".bkl-card")).find(c => c.textContent.indexOf("回归需求A1") >= 0);
    const btn = card && card.querySelector("[data-dem-menu-btn]");
    if(!btn) return null;
    btn.click();
    return true;
  })()`);
  assert(menuOpened === true, "聚焦项目：已排期卡「更多」菜单可打开");
  const menuHasUnplan = await waitFor(`(() => {
    const items = Array.from(document.querySelectorAll(".menu .menu-item"));
    return items.some(i => i.textContent === "撤销排期") ? items.map(i => i.textContent) : false;
  })()`, "菜单出现「撤销排期」");
  const menuItems = await evaluate(`Array.from(document.querySelectorAll(".menu .menu-item")).map(i => i.textContent)`);
  assert(menuItems.indexOf("调整排期") >= 0 && menuItems.indexOf("撤销排期") >= 0 && menuItems.indexOf("关闭需求") >= 0,
    "菜单项含调整排期/撤销排期/关闭需求（实际：" + menuItems.join(",") + "）");
  await evaluate(`(() => {
    const item = Array.from(document.querySelectorAll(".menu .menu-item")).find(i => i.textContent === "撤销排期");
    item.click();
    return true;
  })()`);
  /* 撤排需填原因：UI.showPrompt 弹出 */
  const promptShown = await waitFor(`(() => {
    const prompt = document.querySelector(".prompt-pop, #uiPrompt, [role='dialog'].prompt");
    if(prompt) return true;
    const any = Array.from(document.querySelectorAll("input")).find(i => (i.placeholder || "").indexOf("原因") >= 0 || i.closest(".ui-prompt"));
    return !!any;
  })()`, "撤排原因输入框出现", 8000);
  const unplanNote = await evaluate(`(() => {
    const dlg = document.querySelector(".modal.open, .ui-prompt");
    if(!dlg) return null;
    const input = dlg.querySelector("input, textarea");
    return input ? { ph: input.placeholder, cls: dlg.className } : { cls: dlg.className };
  })()`);
  console.log("  INFO 撤排原因控件：" + JSON.stringify(unplanNote));
  await evaluate(`(() => {
    const dlg = document.querySelector(".modal.open, .ui-prompt");
    if(!dlg) return false;
    const input = dlg.querySelector("input, textarea");
    if(!input) return false;
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, "回归测试撤排原因");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const ok = Array.from(dlg.querySelectorAll("button")).find(b => /确定|确认|保存/.test(b.textContent) && b.classList.contains("primary"));
    if(!ok) return false;
    ok.click();
    return true;
  })()`);
  await waitFor(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="pass"]');
    return col && Array.from(col.querySelectorAll(".bkl-card .link-title")).some(t => t.textContent.indexOf("回归需求A1") >= 0);
  })()`, "撤排后 A1 回到已通过列", 15000);
  pass("撤排流转完成（A1 回到已通过）");

  /* 5. 详情抽屉（聚焦项目下点击卡片标题） */
  const detailOpened = await evaluate(`(() => {
    const col = document.querySelector('#demandBody .bkl-col[data-col="review"]');
    const title = col && col.querySelector('.bkl-card .link-title');
    if(!title) return null;
    title.click();
    return true;
  })()`);
  assert(detailOpened === true, "聚焦项目：卡片标题可点击打开详情");
  const drawerShown = await waitFor(`(() => {
    const drawer = document.querySelector(".drawer.open, .ui-drawer.open, #demandDrawer");
    return drawer && drawer.offsetParent !== null ? drawer.className : false;
  })()`, "需求详情抽屉打开", 8000);
  console.log("  INFO 详情抽屉：" + JSON.stringify(drawerShown));
  await evaluate(`(() => {
    const x = document.querySelector(".drawer.open .drawer-x, .drawer .close, [data-dem-detail-x]");
    if(x){ x.click(); return true; }
    const drawer = document.querySelector(".drawer.open");
    if(drawer){ drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
    return !!drawer;
  })()`);

  /* 6. 切回全部项目，泳道恢复且 A1/A2 状态正确分布 */
  await evaluate(`(() => {
    const sel = document.getElementById("demandReq");
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(`(() => {
    const lanes = document.querySelectorAll('#demandBody .bkl-lane');
    return lanes.length === 2 && document.querySelectorAll('#demandBody .bkl-card').length === 3;
  })()`, "切回全部项目：两个泳道、三张卡", 15000);
  const backDist = await evaluate(`(() => {
    const passCol = document.querySelector('#demandBody .bkl-col[data-col="pass"]');
    const reviewCol = document.querySelector('#demandBody .bkl-col[data-col="review"]');
    return {
      passCount: passCol.querySelectorAll(".bkl-card").length,
      reviewCount: reviewCol.querySelectorAll(".bkl-card").length
    };
  })()`);
  assert(backDist.passCount === 2 && backDist.reviewCount === 1, "全部项目下状态分布正确：已通过2 / 待评审1");

  /* 7. 控制台与页面异常 */
  if(cdp.errors.length === 0 && cdp.pageErrors.length === 0) pass("无 console.error / 页面异常");
  else{
    for(const e of cdp.errors.slice(0, 5)) assert(false, e);
    for(const e of cdp.pageErrors.slice(0, 5)) assert(false, e);
  }
}catch(ex){
  failed++;
  console.log("  ERROR " + (ex.message || ex));
}finally{
  try{ proc.kill(); }catch(e){ /* noop */ }
}

/* 清理：临时空间删除（独立于浏览器，直连 API 需会话，改由退出前不删——改用保留并在输出中说明） */
console.log(failed === 0 ? "\n全部通过" : "\n失败 " + failed + " 项");
console.log("临时空间：" + createdWs + "（名称 看板回归" + stamp + "，可在设置中手动删除）");
process.exit(failed === 0 ? 0 : 1);
