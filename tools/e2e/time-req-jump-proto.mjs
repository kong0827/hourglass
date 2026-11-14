/* 计时明细项目归属跳转原型 · 真实浏览器交互验证与截图
   明细表项目 chip 跳转 / 行点击不误跳 / 键盘 Enter/Space / 成员负载计时层 / 补记弹窗计入项目 / 只读可跳 / 390 窄屏
   用法：node tools/e2e/time-req-jump-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到 docs/audit/prototypes/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/time-req-jump-proto-2026-11-15.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-time-req-jump-";

function findChrome(){
  const list = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of list){
    const r = spawnSync(bin, ["--version"], { encoding:"utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp{
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let m; try{ m = JSON.parse(raw); }catch(e){ return; }
    if(m.id && this.pending.has(m.id)){
      const { resolve, reject } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }else if(m.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
    }else if(m.method === "Runtime.consoleAPICalled" && m.params.type === "error"){
      this.errors.push("console.error: " + m.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(m.method === "Log.entryAdded" && m.params.entry.level === "error"){
      this.errors.push("log: " + m.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id; const p = { id, method, params };
    if(sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "time-req-jump-proto-"));
const port = 9237;
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,1000", "--disable-dev-shm-usage", "--hide-scrollbars",
  "--allow-file-access-from-files"
], { stdio:"ignore" });

let failed = 0, passed = 0;
const ok = (cond, msg) => { if(cond){ passed++; console.log("  PASS " + msg); } else { failed++; console.log("  FAIL " + msg); } };

try{
  let ver = null;
  for(let i = 0; i < 60 && !ver; i++){
    try{ ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!ver) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url:"about:blank" });
  const att = await cdp.send("Target.attachToTarget", { targetId:target.targetId, flatten:true });
  const sid = att.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sid);
  const call = (m, p) => cdp.send(m, p, sid);
  const ev = async expr => {
    const r = await call("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true, userGesture:true });
    if(r.exceptionDetails) throw new Error("执行失败：" + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  };
  const wait = async (expr, label, timeout = 8000) => {
    const end = Date.now() + timeout; let last;
    while(Date.now() < end){
      try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(80);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  let lastW = 1440, lastH = 1000, lastMobile = false;
  const setVP = async (w, h, m) => {
    lastW = w; lastH = h; lastMobile = !!m;
    await call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:m ? 2 : 1, mobile:!!m });
    await sleep(200);
  };
  const shot = async name => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`);
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
  };
  const click = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const mouse = (type, x, y) => call("Input.dispatchMouseEvent", { type, x, y, button:"left", clickCount:type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
  const rect = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    const r = el.getBoundingClientRect(); return { x:r.x + r.width/2, y:r.y + r.height/2, w:r.width, h:r.height }; })()`);
  const clickAt = async sel => { const r = await rect(sel); await mouse("mousePressed", r.x, r.y); await mouse("mouseReleased", r.x, r.y); await sleep(160); };
  const keyEnter = async () => {
    await call("Input.dispatchKeyEvent", { type:"keyDown", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, text:"\r", unmodifiedText:"\r" });
    await call("Input.dispatchKeyEvent", { type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13 });
    await sleep(160);
  };
  /* 先按一次 Shift 切换键盘 modality，程序化 focus 才会命中 :focus-visible */
  const keyboardModality = async () => {
    await call("Input.dispatchKeyEvent", { type:"rawKeyDown", key:"Shift", code:"ShiftLeft", windowsVirtualKeyCode:16 });
    await call("Input.dispatchKeyEvent", { type:"keyUp", key:"Shift", code:"ShiftLeft", windowsVirtualKeyCode:16 });
  };
  const keySpace = async () => {
    await call("Input.dispatchKeyEvent", { type:"keyDown", key:" ", code:"Space", windowsVirtualKeyCode:32 });
    await call("Input.dispatchKeyEvent", { type:"keyUp", key:" ", code:"Space", windowsVirtualKeyCode:32 });
    await sleep(160);
  };
  /* headless 移动仿真不派发原始触摸输入：在真实节点上合成 pointerType=touch 的 PointerEvent + click */
  const touchTap = sel => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
    if(!hit || (hit !== el && !el.contains(hit))) return false;
    const opts = { bubbles:true, cancelable:true, pointerType:"touch", isPrimary:true, clientX:r.x + r.width/2, clientY:r.y + r.height/2 };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true }));
    return true;
  })()`);

  await call("Page.navigate", { url:FILE });
  await wait("!!window.PROTO", "原型就绪");
  await setVP(1440, 1000, false);

  console.log("[A] 桌面 · 计时明细浮层");
  await click("#openLog");
  await wait("document.getElementById('logLayer').classList.contains('open')", "明细浮层打开");
  ok(await ev("document.querySelectorAll('#logBody [data-jump-project]').length") === 4, "4 条有归属记录渲染项目 chip");
  ok(await ev(`Array.prototype.filter.call(document.querySelectorAll('#logBody tr'), tr => !tr.querySelector('[data-jump-project]') && /未归类/.test(tr.textContent)).length`) === 2, "2 条未归类回落纯文本");
  ok(await ev(`document.querySelector('#logBody [data-jump-project]').getAttribute('aria-label')`) === "打开项目：清结算与对账平台", "chip aria-label 带跳转语义");
  ok(await ev(`!!document.querySelector('#logBody tr[data-open-task="Kr9vof65na3g5h4130i38"] .tag-ghost')`), "补记记录带「补记」标签");
  ok(await ev(`!document.querySelector('#logBody tr:last-child').hasAttribute('data-open-task')`), "无工作项记录行不可点");
  const chipR = await rect("#logBody tr:nth-child(3) [data-jump-project]");
  await mouse("mouseMoved", chipR.x, chipR.y);
  await sleep(120);
  ok(await ev(`getComputedStyle(document.querySelector('#logBody tr:nth-child(3) [data-jump-project]')).textDecorationStyle`) === "solid", "chip hover 下划线变实线");
  await shot("desktop-log-table");

  console.log("[B] chip 跳转：关浮层 + 落项目视图");
  await clickAt("#logBody tr:nth-child(3) [data-jump-project]");
  ok(await ev("!document.getElementById('logLayer').classList.contains('open')"), "跳转后明细浮层关闭");
  ok(await ev("PROTO.lastJump") === "R4wejtfugwrudffx8x4x9", "跳转到统一支付网关");
  ok(await ev(`document.getElementById('baseView').textContent.indexOf("统一支付网关") >= 0`), "底层落到项目视图");
  await shot("desktop-jumped");

  console.log("[C] 行点击不误跳 + 键盘 Enter/Space");
  await click("#openLog");
  const jumpsBefore = await ev("PROTO.jumps.length");
  await clickAt("#logBody tr:first-child .manager-task-title");
  ok(await ev("PROTO.lastOpenTask") === "t1", "点记录行打开工作项");
  ok(await ev("PROTO.jumps.length") === jumpsBefore, "点记录行不触发项目跳转");
  ok(await ev("document.getElementById('logLayer').classList.contains('open')"), "打开工作项后明细浮层仍在");
  await keyboardModality();
  await ev(`document.querySelector('#logBody tr:nth-child(4) [data-jump-project]').focus()`);
  ok(await ev(`getComputedStyle(document.activeElement).boxShadow.indexOf("rgba(37, 99, 235") >= 0`), "chip 聚焦有焦点环");
  await shot("desktop-log-chip-focus");
  await keyEnter();
  ok(await ev("PROTO.lastJump") === "Rvlauh8rxq7fihkg126sq", "Enter 触发跳转到风控规则引擎");
  await click("#openLog");
  await ev(`document.querySelector('#logBody tr:first-child [data-jump-project]').focus()`);
  await keySpace();
  ok(await ev("PROTO.lastJump") === "R4ohfd6ha97zjtedr3ogg", "Space 触发跳转到清结算与对账平台");

  console.log("[D] 成员负载 · 计时层");
  await click("#openMember");
  await wait("document.getElementById('memberLayer').classList.contains('open')", "成员浮层打开");
  ok(await ev("document.querySelectorAll('#memberBody [data-jump-project]').length") === 3, "赵磊 4 条计时中 3 条有归属 chip");
  ok(await ev(`!!document.querySelector('#memberBody [data-member-back]')`), "有返回项目分布入口");
  await shot("desktop-member-logs");
  await click("#memberBody [data-member-back]");
  ok(await ev(`document.querySelectorAll('#memberBody [data-member-project]').length`) === 2, "返回后显示项目分布");
  ok(await ev(`document.querySelectorAll('#memberBody [data-member-project] [data-jump-project]').length`) === 0, "项目分布行是下钻入口，不放跳转 chip（与产品一致）");
  await click("#memberBody [data-member-project='p1']");
  ok(await ev(`document.querySelectorAll('#memberBody [data-open-task] [data-jump-project]').length`) === 2, "下钻工作项层项目列为 chip");
  await shot("desktop-member-tasks");
  await click("#memberBody [data-open-task] [data-jump-project]");
  ok(await ev("PROTO.lastJump") === "R4ohfd6ha97zjtedr3ogg" && await ev("!document.getElementById('memberLayer').classList.contains('open')"), "工作项层 chip 跳转并关浮层");

  console.log("[E] 补记弹窗 · 计入项目（派生口径）");
  await click("#openTimeAdd");
  await wait("document.getElementById('timeAddLayer').classList.contains('open')", "补记弹窗打开");
  ok(await ev(`document.querySelector('#timeAttr [data-jump-project]').getAttribute('data-jump-project')`) === "R4ohfd6ha97zjtedr3ogg", "计入项目=当前工作项所属项目");
  ok(await ev(`document.querySelector('#timeAttr [data-jump-project]').textContent`) === "清结算与对账平台", "计入项目名称正确");
  ok(await ev(`document.querySelector('#timeAttr [data-jump-project]').tagName`) === "BUTTON" && await ev("!document.querySelector('#timeAttr select, #timeAttr input')"), "计入项目是跳转 chip，不是可编辑控件");
  ok(await ev(`document.querySelector('#timeAttr .time-attr-note').textContent.indexOf("跟随工作项所属项目") >= 0`), "归属说明：跟随工作项");
  await shot("desktop-time-add");
  await click("#timeAttr [data-jump-project]");
  ok(await ev("!document.getElementById('timeAddLayer').classList.contains('open')") && await ev("PROTO.lastJump") === "R4ohfd6ha97zjtedr3ogg", "补记弹窗 chip 可跳转并关闭弹窗");
  await click("#openTimeAddPlain");
  ok(await ev("!document.querySelector('#timeAttr [data-jump-project]')") && await ev(`document.getElementById('timeAttr').textContent.indexOf("未归类") >= 0`), "未归类工作项：纯文本回落，无死链");
  await shot("desktop-time-add-plain");
  await click("#timeAddLayer [data-close]");
  await click("#openTimeAdd");
  await ev(`(() => { document.getElementById('iTimeHours').value = "1.5"; return true; })()`);
  await click("#timeAddOk");
  ok(await ev("!document.getElementById('timeAddLayer').classList.contains('open')"), "保存补记成功关闭弹窗");
  ok(await ev(`document.getElementById('toast').textContent.indexOf("已保存补记") >= 0`), "保存成功提示");

  console.log("[F] 只读项目：可跳转、不可补记");
  await click("#roToggle");
  await click("#openLog");
  await clickAt("#logBody tr:nth-child(2) [data-jump-project]");
  ok(await ev("PROTO.lastJump") === "R4ohfd6ha97zjtedr3ogg", "只读项目 chip 仍可跳转");
  await click("#openLog");
  await shot("desktop-readonly");
  await click("#logLayer [data-close]");
  await click("#openTimeAdd");
  ok(await ev("!document.getElementById('timeAddLayer').classList.contains('open')"), "只读不给打开补记弹窗");
  ok(await ev(`document.getElementById('toast').textContent.indexOf("只有查看权限") >= 0`), "只读补记提示查看权限");
  await click("#resetBtn");

  console.log("[G] 移动端 390");
  await setVP(390, 844, true);
  await click("#openLog");
  ok(await ev(`(() => { const s = document.querySelector('#logLayer .sheet'); return s.getBoundingClientRect().width <= 390; })()`), "明细浮层不超出 390 视口");
  ok(await ev(`(() => { const w = document.querySelector('#logLayer .tbl-wrap'); return w.scrollWidth > w.clientWidth; })()`), "窄屏表格横向滚动");
  await shot("mobile-log-table");
  await ev(`(() => { const w = document.querySelector('#logLayer .tbl-wrap'); w.scrollLeft = w.scrollWidth; return true; })()`);
  ok(await touchTap("#logBody tr:nth-child(3) [data-jump-project]"), "触摸命中 chip（合成 pointerType=touch）");
  ok(await ev("PROTO.lastJump") === "R4wejtfugwrudffx8x4x9", "移动端触摸跳转成功");
  await shot("mobile-jumped");
  await click("#openTimeAdd");
  ok(await ev(`(() => { const s = document.querySelector('#timeAddLayer .sheet'); const r = s.getBoundingClientRect(); return r.width <= 390 && r.left >= 0; })()`), "补记弹窗适配 390");
  await shot("mobile-time-add");

  ok(cdp.errors.length === 0, "控制台零报错" + (cdp.errors.length ? "：" + cdp.errors.join(" | ") : ""));
  console.log("\n结果：" + passed + " PASS / " + failed + " FAIL");
}catch(e){
  failed++;
  console.log("  ERROR " + (e && e.message || e));
  console.log("\n结果：" + passed + " PASS / " + failed + " FAIL");
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
}
process.exit(failed ? 1 : 0);