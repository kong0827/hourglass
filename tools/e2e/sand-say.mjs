/* 沙漏说 E2E：真实 index.html markup + 真实 CSS + 真实 ESM，冻结本地时间
   运行：node tools/e2e/sand-say.mjs
   说明：本机后端常不可用，登录链路不稳定；这里启动静态预览（仅托管 frontend/），
        在 frontend/ 临时放一个同源 harness 页，克隆真实侧栏与「我的工作/个人设置」片段，
        加载全部真实样式并 import 真实模块，跑完删除 harness。
   输出：PASS/FAIL 行；截图落 E2E_SHOT_DIR（默认 /tmp）。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FRONT = path.join(ROOT, "frontend");
const PORT = Number(process.env.E2E_FRONT_PORT || 8097);
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9479);
const SHOT_DIR = process.env.E2E_SHOT_DIR || "/tmp";
const HARNESS = path.join(FRONT, "_ss-harness.html");
const BASE = "http://127.0.0.1:" + PORT + "/hourglass";

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (cond, msg) => { console.log((cond ? "  PASS " : "  FAIL ") + msg); if (!cond) failed++; };

const harness = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>沙漏说 harness</title></head>
<body data-view="mine">
<script type="module">
(async function(){
  var res = await fetch("index.html", { cache:"no-store" });
  var text = await res.text();
  var doc = new DOMParser().parseFromString(text, "text/html");
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = l.getAttribute("href");
    document.head.appendChild(link);
  });
  var app = doc.querySelector(".app");
  app.querySelectorAll("script").forEach(function(s){ s.remove(); });
  document.body.appendChild(document.importNode(app, true));

  var main = document.querySelector(".main");
  document.getElementById("viewTitle").textContent = "我的工作";
  document.getElementById("brandSub").textContent = "运营研发中心";
  document.getElementById("pageTitleText").textContent = "我的工作";
  document.getElementById("pageSub").textContent = "今天 3 项到期，其中 1 项被阻塞。";
  document.querySelector("#pageHead .ph-acts").style.display = "none";

  document.getElementById("view-mine").classList.add("on");
  document.getElementById("mineBrief").innerHTML =
    '<span class="mw-txt">今天 <strong>3</strong> 项到期，其中 <strong>1</strong> 项被阻塞；本周完成 11 / 21。</span>' +
    '<span class="mw-brief-meta"><span class="dot"></span>11-23 周一</span>';
  var tb = document.getElementById("mineToolbar");
  tb.hidden = false;
  document.getElementById("mineChips").innerHTML =
    '<button class="mw-chip" aria-pressed="true">分派给我 <b>9</b></button>' +
    '<button class="mw-chip" aria-pressed="false">全部 <b>21</b></button>';
  document.getElementById("mineBody").innerHTML =
    '<div class="card"><div style="padding:14px 16px;color:var(--text-3);font-size:12px">（harness 占位内容）</div></div>';

  var RealDate = Date;
  var frozen = null;
  class FakeDate extends RealDate {
    constructor(){
      if(arguments.length === 0 && frozen !== null) super(frozen);
      else super(...arguments);
    }
    static now(){ return frozen !== null ? frozen : RealDate.now(); }
  }
  window.Date = FakeDate;
  window.__setNow = function(y, m, d, h, mi){ frozen = new RealDate(y, m - 1, d, h, mi, 0, 0).getTime(); };
  window.__setNow(2026, 11, 23, 15, 20);
  window.__switch = function(which){
    document.querySelectorAll(".view.on").forEach(function(v){ v.classList.remove("on"); });
    document.getElementById("view-" + which).classList.add("on");
    var title = which === "profile" ? "个人设置" : "我的工作";
    document.getElementById("pageTitleText").textContent = title;
    document.getElementById("viewTitle").textContent = title;
    if(which === "profile"){
      if(window.__ss) window.__ss.mountSandSaySettings();
      if(window.__ornMount) window.__ornMount();
      document.getElementById("me-appearance").scrollIntoView({ block:"start" });
    }
  };
  window.__switch("mine");

  var ss = await import("./js/core/sand-say.js");
  var orn = await import("./js/core/side-ornament.js");
  orn.initSideOrnament();
  orn.mountOrnamentSettings();
  ss.initSandSay();
  window.__ornMount = orn.mountOrnamentSettings;
  window.__ss = ss;
  window.__ssReady = true;
})();
</script>
</body>
</html>
`;

fs.writeFileSync(HARNESS, harness);

const server = spawn(process.execPath, [path.join(ROOT, "deploy/local/preview-server.js")], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { FRONTEND_PORT:String(PORT), BACKEND_PORT:"59999" }),
  stdio: "ignore"
});
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=" + CDP_PORT,
   "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "ss-e2e-")),
   "--no-first-run", "--window-size=1440,1000", "--disable-dev-shm-usage"], { stdio:"ignore" });

let ws;
try{
  let up = false;
  for(let i = 0; i < 60 && !up; i++){
    try{
      const r = await fetch(BASE + "/index.html");
      up = r.ok;
    }catch(e){ await sleep(200); }
  }
  if(!up) throw new Error("静态预览未就绪：" + BASE);

  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version")).json(); }catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if(msg.id && pending.has(msg.id)){
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      return;
    }
    if(msg.method === "Runtime.exceptionThrown") errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    const payload = { id:i, method, params };
    if(sessionId) payload.sessionId = sessionId;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
  const target = await send("Target.createTarget", { url:"about:blank" });
  const attached = await send("Target.attachToTarget", { targetId:target.targetId, flatten:true });
  const sessionId = attached.sessionId;
  const call = (m, p) => send(m, p, sessionId);
  for(const d of ["Page", "Runtime", "Network"]) await call(`${d}.enable`);
  try{ await call("Network.setBypassServiceWorker", { bypass:true }); }catch(e){}
  try{ await call("Network.setCacheDisabled", { cacheDisabled:true }); }catch(e){}
  await call("Emulation.setDeviceMetricsOverride", { width:1440, height:1000, deviceScaleFactor:1, mobile:false, screenWidth:1440, screenHeight:1000 });
  try{ await call("Page.bringToFront"); }catch(e){}

  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true, userGesture:true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 20000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(120);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  const snap = () => evaluate(`(function(){
    var line=document.getElementById("mineSays"), slot=document.getElementById("sideOrnament"), bub=document.getElementById("sandBubble");
    var chip=document.getElementById("sandBubbleChip"), txt=document.getElementById("sandBubbleText");
    return {
      lineHidden:line.hidden,
      lineText:line.textContent.replace(/\\s+/g," ").trim(),
      lineChips:[].map.call(line.querySelectorAll(".ss-chip"),function(c){return c.textContent.trim();}),
      bubbleHidden:bub.hidden, bubbleShow:bub.classList.contains("show"),
      bubbleText:txt.textContent, bubbleChip:chip.hidden?"":chip.textContent,
      ssOn:document.body.classList.contains("ss-on"),
      mood:["ss-slow","ss-pause","ss-dim","ss-sleep","ss-flip"].filter(function(c){return slot.classList.contains(c);}).join(","),
      pref:localStorage.getItem("ds.sandSay.v1")||"",
      pe:getComputedStyle(slot).pointerEvents,
      lineOpacity:+getComputedStyle(line).opacity,
      pileState:(function(){var p=slot.querySelector(".hg-pile");return p?getComputedStyle(p).animationPlayState:"";})(),
      ornCls:slot.querySelector("svg")?slot.querySelector("svg").getAttribute("class"):"",
      slotHidden:slot.hidden
    };
  })()`);
  const setNow = async (y, m, d, h, mi) => {
    await evaluate(`window.__setNow(${y},${m},${d},${h},${mi}); window.__ss.render(); true`);
    await sleep(80);
  };
  const shot = async (name, clip) => {
    const r = await call("Page.captureScreenshot", { format:"png", clip: Object.assign({ scale:1 }, clip), captureBeyondViewport:false });
    const file = path.join(SHOT_DIR, name);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log("  截图 " + file);
  };

  console.log("沙漏说 E2E\n  地址：" + BASE + "/_ss-harness.html");
  await call("Page.navigate", { url: BASE + "/_ss-harness.html" });
  await waitFor("document.readyState==='complete' && window.__ssReady===true", "harness 初始化");
  await evaluate(`localStorage.clear(); true`);
  await call("Page.reload");
  await waitFor("document.readyState==='complete' && window.__ssReady===true", "清偏好后初始化");

  /* 摆件默认关闭；沙漏说的悬停气泡挂在摆件上，这里显式打开后再验气泡与情绪 */
  await evaluate(`localStorage.setItem("ds.ornament.v1", '{"on":true,"pick":"classic"}'); true`);
  await call("Page.reload");
  await waitFor("document.readyState==='complete' && window.__ssReady===true", "打开摆件后初始化");

  /* ---------- 默认 15:20 ---------- */
  let s = await snap();
  check(s.slotHidden === false, "打开摆件后侧栏摆件可见（默认 1440×1000）");
  check(s.ornCls === "hg", "摆件仍是经典沙漏");
  check(s.ssOn === true, "默认开启沙漏说（body.ss-on）");
  check(s.lineHidden === false, "页头一行默认显示");
  check(s.lineText.indexOf("15:20") >= 0, "页头显示当前时间 15:20");
  check(s.lineText.indexOf("下午的沙，流得最慢") >= 0, "页头文案：下午的沙，流得最慢");
  check(s.lineChips.join("|") === "距元旦 39 天", "页头 chip：距元旦 39 天（实际 " + s.lineChips.join("|") + "）");
  check(s.mood === "ss-slow", "下午时段摆件流速变慢（ss-slow）");
  check(s.pe === "auto", "开启后摆件可悬停（pointer-events:auto）");
  check(s.bubbleHidden === false && s.bubbleShow === false, "气泡默认存在但收起");
  check(s.bubbleText === "下午的沙，流得最慢。", "气泡文案带句号");
  check(s.bubbleChip === "距元旦 39 天", "气泡 chip 与页头一致");

  await shot("ss-line.png", { x:0, y:0, width:1100, height:250 });

  /* ---------- 悬停 / 点击 ---------- */
  await evaluate(`document.getElementById("sideOrnament").dispatchEvent(new MouseEvent("mouseenter")); true`);
  await sleep(60);
  s = await snap();
  check(s.bubbleShow === true, "悬停摆件气泡出现");
  await shot("ss-bubble.png", { x:0, y:800, width:560, height:200 });

  await evaluate(`document.getElementById("sideOrnament").dispatchEvent(new MouseEvent("mouseleave")); true`);
  await sleep(60);
  s = await snap();
  check(s.bubbleShow === false, "移开鼠标气泡收起");

  await evaluate(`document.getElementById("sideOrnament").click(); true`);
  await evaluate(`document.getElementById("sideOrnament").dispatchEvent(new MouseEvent("mouseleave")); true`);
  await sleep(60);
  s = await snap();
  check(s.bubbleShow === true, "点击后气泡固定，移开不消失");
  await evaluate(`document.getElementById("sideOrnament").click(); true`);
  await sleep(60);
  s = await snap();
  check(s.bubbleShow === false, "再点一次取消固定");

  /* ---------- 下班窗口 ---------- */
  await setNow(2026, 11, 23, 17, 42);
  s = await snap();
  check(s.lineText.indexOf("沙漏快漏完了") >= 0, "17:42 文案：沙漏快漏完了");
  check(s.lineChips[0] === "距离下班 18 分钟", "17:42 倒计时 18 分钟（实际 " + s.lineChips[0] + "）");
  check(s.mood === "", "下班前摆件回到常规");

  await setNow(2026, 11, 23, 18, 5);
  s = await snap();
  check(s.lineText.indexOf("到点了，沙漏翻转") >= 0, "18:05 文案：到点了，沙漏翻转");
  check(s.mood === "ss-flip", "18:05 摆件翻转一次");
  await sleep(2600);
  s = await snap();
  check(s.mood === "", "2.4s 后翻转结束");
  await setNow(2026, 11, 23, 18, 6);
  s = await snap();
  check(s.mood === "", "同一天再渲染不重复翻转（一天一次）");

  /* ---------- 深夜 / 周末 ---------- */
  await setNow(2026, 11, 23, 18, 31);
  s = await snap();
  check(s.lineText.indexOf("下班了，还在？") >= 0, "18:31 文案：下班了，还在？");
  await evaluate(`document.getElementById("sideOrnament").dispatchEvent(new MouseEvent("mouseenter")); true`);
  await sleep(60);
  s = await snap();
  check(s.bubbleText === "下班了，还在？", "问句气泡不重复加句号（实际 " + s.bubbleText + "）");
  await evaluate(`document.getElementById("sideOrnament").dispatchEvent(new MouseEvent("mouseleave")); true`);

  await setNow(2026, 11, 23, 21, 36);
  s = await snap();
  check(s.lineText.indexOf("这么晚了，还在工作") >= 0, "21:36 文案：这么晚了，还在工作");
  check(s.mood === "ss-dim", "21:36 摆件变暗");
  await setNow(2026, 11, 23, 23, 48);
  s = await snap();
  check(s.lineText.indexOf("夜里的沙漏转得慢，先睡吧") >= 0, "23:48 文案：先睡吧");
  check(s.mood === "ss-sleep", "23:48 摆件打瞌睡");
  check(Math.abs(s.lineOpacity - 0.78) < 0.01, "23:48 页头一行降透明度（实际 " + s.lineOpacity + "）");

  await setNow(2026, 11, 28, 10, 24);
  s = await snap();
  check(s.lineText.indexOf("周六 10:24") >= 0, "周末显示「周六 10:24」");
  check(s.lineText.indexOf("周末也来了，辛苦了") >= 0, "周六文案：周末也来了");
  check(s.mood === "ss-pause", "周末摆件暂停");
  check(s.pileState === "paused", "周末整个沙漏停住（animation-play-state:paused，实际 " + s.pileState + "）");

  /* ---------- 节前 / 节日 / 无数据 ---------- */
  await setNow(2026, 12, 31, 17, 20);
  s = await snap();
  check(s.lineText.indexOf("再坚持一天，就是元旦") >= 0, "12-31 文案：再坚持一天");
  check(s.lineChips.join("|") === "明天元旦", "12-31 chip：明天元旦（实际 " + s.lineChips.join("|") + "）");
  check(await evaluate(`!!document.querySelector("#mineSays .ss-chip.hot")`), "明天元旦 chip 使用强调色");

  await setNow(2027, 1, 1, 10, 5);
  s = await snap();
  check(s.lineText.indexOf("元旦快乐，沙漏也放假") >= 0, "01-01 文案：元旦快乐");
  check(s.lineChips.join("|") === "今天元旦", "01-01 chip：今天元旦");
  check(await evaluate(`!!document.querySelector("#mineSays .ss-chip.fest")`), "今天元旦 chip 使用节日色");

  await setNow(2028, 6, 1, 15, 20);
  s = await snap();
  check(s.lineChips.join("|") === "距周末 2 天", "无当年数据回退到「距周末 2 天」（实际 " + s.lineChips.join("|") + "）");

  /* ---------- 个人设置 ---------- */
  await setNow(2026, 11, 23, 15, 20);
  await evaluate(`window.__switch("profile"); true`);
  await sleep(250);
  check(await evaluate(`document.getElementById("meSsOn").checked`), "设置：开关默认开");
  check(await evaluate(`document.getElementById("meSsOff").value`) === "18:00", "设置：下班时间默认 18:00");
  check(await evaluate(`document.querySelector('#meSsMode [data-ssmode="always"]').getAttribute("aria-pressed")`) === "true", "设置：默认常驻显示");
  check((await evaluate(`document.getElementById("meSsPreview").textContent`)).indexOf("下午的沙，流得最慢") >= 0, "设置：预览显示当前时段文案");

  await evaluate(`document.querySelector('#meSsMode [data-ssmode="hover"]').click(); true`);
  await sleep(200);
  s = await snap();
  check(await evaluate(`document.querySelector('#meSsMode [data-ssmode="hover"]').getAttribute("aria-pressed")`) === "true", "切到「只在悬停」");
  check(s.lineHidden === true, "只在悬停：页头一行隐藏");
  check(s.ssOn === true && s.bubbleHidden === false, "只在悬停：气泡仍可用");
  check(s.pref === '{"on":true,"offWork":"18:00","mode":"hover"}', "偏好写入本机：" + s.pref);

  await evaluate(`document.querySelector('#meSsMode [data-ssmode="always"]').click(); true`);
  await sleep(200);
  check((await snap()).lineHidden === false, "切回常驻显示");

  await evaluate(`(function(){
    var el=document.getElementById("meSsOff");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"16:00");
    el.dispatchEvent(new Event("change",{bubbles:true})); return true;
  })()`);
  await sleep(200);
  const pv = await evaluate(`document.getElementById("meSsPreview").textContent`);
  check(pv.indexOf("距离下班 40 分钟") >= 0, "改成 16:00 后预览出现「距离下班 40 分钟」（实际 " + pv + "）");

  await evaluate(`(function(){
    var el=document.getElementById("meSsOff");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"");
    el.dispatchEvent(new Event("change",{bubbles:true})); return true;
  })()`);
  await sleep(200);
  check((await snap()).lineChips.join("|") === "距元旦 39 天", "清空下班时间后不再显示倒计时");

  await evaluate(`document.getElementById("meSsOn").click(); true`);
  await sleep(200);
  s = await snap();
  check(s.ssOn === false, "关闭后 body.ss-on 移除");
  check(s.lineHidden === true, "关闭后页头一行隐藏");
  check(s.bubbleHidden === true, "关闭后气泡隐藏");
  check(s.mood === "", "关闭后不再施加摆件情绪");
  check(s.pe === "none", "关闭后摆件不再拦截鼠标（pointer-events:none）");

  await evaluate(`document.getElementById("meSsOn").click(); { var r=document.getElementById("meSsReset"); if(r) r.click(); } true`);
  await sleep(250);
  s = await snap();
  check(s.ssOn === true && s.lineHidden === false, "恢复默认后重新显示");
  check(s.pref === '{"on":true,"offWork":"18:00","mode":"always"}', "恢复默认偏好：" + s.pref);

  await shot("ss-settings.png", { x:216, y:0, width:1224, height:1000 });
  await evaluate(`document.getElementById("me-sandsay").scrollIntoView({ block:"start" }); true`);
  await sleep(200);
  await shot("ss-settings-say.png", { x:216, y:0, width:1224, height:1000 });

  /* ---------- 刷新持久化 ---------- */
  await call("Page.reload");
  await waitFor("document.readyState==='complete' && window.__ssReady===true", "刷新后 harness 初始化");
  s = await snap();
  check(s.ssOn === true && s.lineHidden === false, "刷新后仍开启并显示");
  check(await evaluate(`document.getElementById("meSsOn").checked`), "刷新后设置开关保持开启");

  check(errors.length === 0, "页面无未捕获异常" + (errors.length ? "：" + errors.join(" | ") : ""));

  await evaluate(`window.__switch("mine"); true`);
  await sleep(150);
  await evaluate(`window.__setNow(2026,11,23,15,20); window.__ss.render(); true`);
  await sleep(80);
  await shot("ss-line.png", { x:0, y:0, width:1100, height:250 });

  /* ---------- 390 移动端 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:1, mobile:true, screenWidth:390, screenHeight:844 });
  await evaluate(`document.body.setAttribute("data-layout","mobile"); window.__ss.render(); true`);
  await sleep(250);
  const mob = await evaluate(`(function(){
    var line=document.getElementById("mineSays"), bub=document.getElementById("sandBubble");
    return { display:getComputedStyle(bub).display, ovf:line.scrollWidth-line.clientWidth, hidden:line.hidden, text:line.textContent.replace(/\\s+/g," ").trim() };
  })()`);
  check(mob.display === "none", "390 下气泡隐藏（display:none）");
  check(mob.ovf <= 1, "390 下页头一行不横向溢出（溢出 " + mob.ovf + "px）");
  check(mob.hidden === false && mob.text.length > 0, "390 下页头一行仍显示");
  await shot("ss-mobile.png", { x:0, y:0, width:390, height:844 });
}finally{
  try{ ws && ws.close(); }catch(e){}
  try{ chrome.kill("SIGKILL"); }catch(e){}
  try{ server.kill("SIGKILL"); }catch(e){}
  try{ fs.unlinkSync(HARNESS); }catch(e){}
}

console.log("\nsand-say E2E: " + (failed ? failed + " 项失败" : "全部通过"));
if(failed) process.exit(1);
