/* 检查项排序原型 · 真实浏览器交互验证与截图
   拖拽把手即时重排 / 方向键移动 / 失败还原 / 只读态 / 读态清单同序 / 新增追加末尾
   用法：node tools/e2e/subtask-sort-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到 docs/audit/prototypes/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/subtask-sort-proto-2026-11-14.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-subtask-sort-";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "subtask-sort-proto-"));
const port = 9236;
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
  const shot = async (name, full) => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`);
    if(full){
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await setVP(lastW, Math.min(h + 20, 12000), lastMobile);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
    if(full) await setVP(lastW, lastH, lastMobile);
  };
  const click = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const mouse = (type, x, y) => call("Input.dispatchMouseEvent", { type, x, y, button:"left", clickCount:type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
  const key = async (k, code) => {
    await call("Input.dispatchKeyEvent", { type:"keyDown", key:k, code, windowsVirtualKeyCode:code === "ArrowUp" ? 38 : 40 });
    await call("Input.dispatchKeyEvent", { type:"keyUp", key:k, code, windowsVirtualKeyCode:code === "ArrowUp" ? 38 : 40 });
  };
  const rect = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    const r = el.getBoundingClientRect(); return { x:r.x + r.width/2, y:r.y + r.height/2, top:r.top, h:r.height }; })()`);
  const dragTo = async (fromSel, toSel, midShot) => {
    const a = await rect(fromSel), b = await rect(toSel);
    await mouse("mousePressed", a.x, a.y);
    await sleep(60);
    const steps = 6;
    for(let i = 1; i <= steps; i++){
      await mouse("mouseMoved", a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
      await sleep(40);
      if(midShot && i === 3) await shot(midShot);
    }
    await mouse("mouseMoved", b.x, b.top + 2);
    await sleep(60);
    await mouse("mouseReleased", b.x, b.top + 2);
    await sleep(260);
  };

  await call("Page.navigate", { url:FILE });
  await wait("!!window.PROTO", "原型就绪");
  await setVP(1440, 1000, false);

  console.log("[A] 桌面读态与把手");
  ok(await ev("PROTO.order.join()") === "s1,s2,s3,s4", "初始顺序为创建序");
  ok(await ev("document.querySelectorAll('#list .sub-grip').length") === 4, "每行一个拖拽把手（4 个）");
  ok(await ev("document.getElementById('cnt').textContent") === "2/4", "完成计数 2/4");
  ok(await ev(`document.querySelector('[data-grip="s2"]').getAttribute("aria-label").indexOf("第 2 项，共 4 项") >= 0`), "把手 aria-label 带位置语义");
  await shot("desktop-card", true);

  console.log("[B] 拖拽重排（乐观 + 读态同序）");
  await dragTo('[data-grip="s4"]', '[data-sub="s1"]', "desktop-dragging");
  ok(await ev("PROTO.order.join()") === "s4,s1,s2,s3", "拖 s4 到首位后顺序立即更新");
  ok(await ev(`document.getElementById("live").textContent.indexOf("第 1 项，共 4 项") >= 0`), "aria-live 播报移动结果");
  ok(await ev(`Array.prototype.slice.call(document.querySelectorAll("#readList .read-row span:last-child")).map(e => e.textContent).join("|")`) ===
     await ev("PROTO.titles.join('|')"), "概览读态清单与编辑态同序");
  ok(await ev("!document.querySelector('.sub-item.dragging')"), "拖拽结束清理 dragging 态");

  console.log("[C] 键盘 ↑/↓ 移动");
  await ev(`document.querySelector('[data-grip="s2"]').focus()`);
  await key("ArrowUp", "ArrowUp");
  await sleep(260);
  ok(await ev("PROTO.order.join()") === "s4,s2,s1,s3", "聚焦把手按 ↑ 上移一位");
  ok(await ev(`document.activeElement && document.activeElement.dataset.grip === "s2"`), "重渲染后焦点回到同一把手");
  await shot("desktop-keyboard");
  await key("ArrowDown", "ArrowDown");
  await sleep(260);
  ok(await ev("PROTO.order.join()") === "s4,s1,s2,s3", "按 ↓ 移回原位");

  console.log("[D] 失败还原");
  const before = await ev("PROTO.order.join()");
  await click("#failToggle");
  await ev(`document.querySelector('[data-grip="s3"]').focus()`);
  await key("ArrowUp", "ArrowUp");
  await sleep(320);
  ok(await ev("PROTO.order.join()") === before, "排序失败后还原为手势前顺序");
  ok(await ev(`(() => { const t = document.getElementById("toast"); return t.className.indexOf("bad") >= 0 && /排序失败，已还原为原顺序/.test(t.textContent); })()`), "失败提示：已还原为原顺序");
  await shot("desktop-fail");
  await click("#failToggle");

  console.log("[E] 只读态");
  await click("#roToggle");
  ok(await ev("document.querySelectorAll('#list .sub-grip').length") === 0, "只读不给把手");
  ok(await ev("document.querySelectorAll('#list .sub-del').length") === 0, "只读不给删除");
  ok(await ev("Array.prototype.every.call(document.querySelectorAll('#list .cbx'), c => c.disabled)"), "只读勾选禁用");
  ok(await ev(`document.getElementById("hint").textContent.indexOf("只读项目") >= 0`), "只读提示文案");
  await shot("desktop-readonly", true);
  await click("#roToggle");

  console.log("[F] 新增追加末尾");
  await ev(`(() => { const i = document.getElementById("newSub"); i.value = "补充灰度开关说明"; i.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true })); return true; })()`);
  await sleep(120);
  ok(await ev("PROTO.order.length") === 5 && await ev("PROTO.order[4]") !== "s1", "新检查项追加在末尾");
  ok(await ev("document.getElementById('cnt').textContent") === "2/5", "计数同步 2/5");
  await click("#resetBtn");
  ok(await ev("PROTO.order.join()") === "s1,s2,s3,s4", "重置回初始顺序");

  console.log("[G] 移动端 390");
  await setVP(390, 844, true);
  await shot("mobile-card", true);
  await dragTo('[data-grip="s3"]', '[data-sub="s1"]', "mobile-dragging");
  ok(await ev("PROTO.order.join()") === "s3,s1,s2,s4", "移动端触摸拖拽同样重排");
  ok(await ev(`(() => { const g = document.querySelector('[data-grip="s1"]'); const r = g.getBoundingClientRect(); return r.width >= 24; })()`), "移动端把手命中区 ≥24px");
  await shot("mobile-saved", true);

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