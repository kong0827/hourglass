/* P4 关联就地编辑原型 · 真实浏览器交互验证与截图
   用法：node tools/e2e/p4-inline-edit-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到 docs/audit/prototypes/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/p4-inline-edit-2026-11-14.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-p4-inline-";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p4-inline-proto-"));
const port = 9232;
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
  const wait = async (expr, label, timeout = 10000) => {
    const end = Date.now() + timeout; let last;
    while(Date.now() < end){
      try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(100);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  let lastW = 1440, lastH = 1000, lastMobile = false;
  const viewport = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width:w, height:h, deviceScaleFactor:mobile ? 2 : 1, mobile:!!mobile });
  const setVP = async (w, h, m) => { lastW = w; lastH = h; lastMobile = !!m; await viewport(w, h, m); await sleep(200); };
  const shot = async (name, full) => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} }); return true; })()`);
    if(full){
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await viewport(lastW, Math.min(h + 20, 12000), lastMobile); await sleep(200);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
    if(full){ await viewport(lastW, lastH, lastMobile); await sleep(160); }
  };
  const click = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const type = async (sel, text) => {
    await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles:true })); return true; })()`);
    await sleep(120);
  };
  const pressKey = async (key) => {
    const map = { Enter:{key:"Enter",code:"Enter",windowsVirtualKeyCode:13}, Escape:{key:"Escape",code:"Escape",windowsVirtualKeyCode:27},
      ArrowDown:{key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40}, ArrowUp:{key:"ArrowUp",code:"ArrowUp",windowsVirtualKeyCode:38} };
    const k = map[key];
    await call("Input.dispatchKeyEvent", { type:"keyDown", ...k });
    await call("Input.dispatchKeyEvent", { type:"keyUp", ...k });
    await sleep(100);
  };

  console.log("P4 关联就地编辑原型验证\n  " + FILE);
  await setVP(1440, 1000, false);
  await call("Page.navigate", { url:FILE });
  await wait("!!window.PROTO && !!document.querySelector('#assocList')", "原型初始化");

  /* ---------- 1. 默认关联卡 ---------- */
  const init = await ev(`(() => ({
    rows: document.querySelectorAll('#assocList dt').length,
    edits: document.querySelectorAll('#assocList .assoc-edit').length,
    demandEdit: !!document.querySelector('#assocList [data-edit="demand"]'),
    branchEdit: !!document.querySelector('#assocList [data-edit="branch"]'),
    demandJump: !!document.querySelector('#assocList [data-edit="demand"]').closest('dd').querySelector('.ev-link'),
    branchVal: document.querySelector('#assocList [data-edit="branch"]').closest('dd').querySelector('.ev-link').textContent,
    demandVal: document.querySelector('#assocList [data-edit="demand"]').closest('dd').querySelector('.ev-link').textContent
  }))()`);
  ok(init.rows === 8, "关联卡 8 行（实际 " + init.rows + "）");
  ok(init.edits === 2 && init.demandEdit && init.branchEdit, "仅需求/分支两行有就地编辑铅笔");
  ok(init.demandJump, "需求值仍是跳转链接（铅笔与跳转并存）");
  ok(init.branchVal === "feature/tiered-pricing" && init.demandVal === "阶梯水价核算规则", "默认值正确");
  await shot("desktop-card");

  /* ---------- 2. 需求选择浮层 ---------- */
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "需求浮层");
  const dpop = await ev(`(() => ({
    opts: document.querySelectorAll('.search-picker-option').length,
    clear: !!document.querySelector('.search-picker-clear'),
    selected: document.querySelectorAll('.search-picker-option.selected').length,
    selTitle: (document.querySelector('.search-picker-option.selected .sp-title')||{}).textContent,
    count: document.querySelector('.pp-count').textContent,
    foot: document.querySelector('.search-picker-foot').textContent,
    hasSearch: !!document.querySelector('.search-picker-search input')
  }))()`);
  ok(dpop.opts === 6 && dpop.clear, "需求浮层 6 候选 + 不关联清除项");
  ok(dpop.selected === 1 && dpop.selTitle === "阶梯水价核算规则", "当前关联高亮 ✓当前");
  ok(dpop.hasSearch && dpop.count.indexOf("6 条候选") >= 0, "搜索框 + 候选计数");
  ok(dpop.foot.indexOf("已拒绝") >= 0, "页脚口径提示");
  await shot("desktop-demand");

  /* 搜索过滤 */
  await type('.search-picker-search input', "缴费");
  const filtered = await ev("document.querySelectorAll('.search-picker-option').length");
  ok(filtered === 1, "搜索「缴费」过滤到 1 条（实际 " + filtered + "）");
  await shot("desktop-search");
  await type('.search-picker-search input', "");

  /* 键盘导航 + 选中保存 */
  await ev("document.querySelector('.search-picker-search input').focus()");
  await pressKey("ArrowDown");
  const kbActive = await ev("document.activeElement.className.indexOf('search-picker-option') >= 0 || document.activeElement.className.indexOf('search-picker-clear') >= 0");
  ok(kbActive, "ArrowDown 把焦点移到候选项");
  await click('.search-picker-option[data-pick="d3"]');
  await sleep(200);
  const afterPick = await ev(`(() => ({
    popGone: !document.querySelector('.menu.search-picker'),
    demandVal: document.querySelector('#assocList [data-edit="demand"]').closest('dd').querySelector('.ev-link').textContent,
    stateId: PROTO.state.demandId,
    toast: (document.querySelector('.toast')||{}).textContent
  }))()`);
  ok(afterPick.popGone && afterPick.stateId === "d3", "选中后浮层关闭、乐观更新到 d3");
  ok(afterPick.demandVal === "线上缴费渠道接入", "关联卡需求值即时刷新");
  ok(afterPick.toast && afterPick.toast.indexOf("已更新关联需求") >= 0, "自动保存 toast");
  await shot("desktop-saved");

  /* ---------- 3. 分支选择浮层 + 清除 ---------- */
  await click('#openBranch');
  await wait("!!document.querySelector('.menu.search-picker')", "分支浮层");
  const bpop = await ev(`(() => ({
    opts: document.querySelectorAll('.search-picker-option').length,
    arch: !!document.querySelector('.search-picker-option .sp-tag.arch'),
    target: (document.querySelector('.search-picker-option .sp-meta')||{}).textContent
  }))()`);
  ok(bpop.opts === 6, "分支浮层 6 候选");
  ok(bpop.arch && bpop.target.indexOf("→") >= 0, "归档分支标注 + 目标分支副标题");
  await shot("desktop-branch");
  await click('.search-picker-clear');
  await sleep(200);
  const cleared = await ev(`(() => ({
    stateId: PROTO.state.branchId,
    val: (document.querySelector('#assocList [data-edit="branch"]').closest('dd').querySelector('.muted-val')||{}).textContent
  }))()`);
  ok(cleared.stateId === "" && cleared.val === "未设置", "清除分支 → 未设置占位");
  await click('#resetBtn');
  await sleep(150);

  /* ---------- 4. Esc 关闭 + 只读 ---------- */
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "浮层再开");
  await pressKey("Escape");
  ok(await ev("!document.querySelector('.menu.search-picker')"), "Esc 关闭浮层");
  await click('#roToggle');
  const ro = await ev(`(() => ({
    edits: document.querySelectorAll('#assocList .assoc-edit').length,
    jumps: document.querySelectorAll('#assocList .ev-link').length,
    note: getComputedStyle(document.querySelector('.ro-note')).display
  }))()`);
  ok(ro.edits === 0 && ro.jumps >= 5, "只读：铅笔消失，跳转保留");
  ok(ro.note === "flex", "只读提示条出现");
  await shot("desktop-readonly");
  await click('#roToggle');

  /* ---------- 5. 深色 ---------- */
  await click('#themeToggle');
  ok(await ev("document.documentElement.dataset.theme === 'dark'"), "深色主题切换");
  await shot("desktop-dark");
  await click('#openBranch');
  await wait("!!document.querySelector('.menu.search-picker')", "深色分支浮层");
  await shot("desktop-dark-branch");
  await pressKey("Escape");
  await click('#themeToggle');

  /* ---------- 6. 移动端 390 ---------- */
  await ev("document.getElementById('toastWrap').innerHTML=''");
  await click('#vpMobile');
  await setVP(390, 844, true);
  await sleep(300);
  const mob = await ev(`(() => ({
    overflow: document.documentElement.scrollWidth,
    isMobile: document.querySelector('#stage').classList.contains('is-mobile'),
    edits: document.querySelectorAll('#assocList .assoc-edit').length
  }))()`);
  ok(mob.overflow <= 390, "移动端无横向溢出（scrollWidth " + mob.overflow + "）");
  ok(mob.isMobile && mob.edits === 2, "移动布局生效、铅笔仍在");
  await shot("mobile-card", true);
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker.as-sheet')", "移动底部浮层");
  const sheet = await ev(`(() => {
    const el = document.querySelector('.menu.search-picker'); const r = el.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), isSheet: el.classList.contains('as-sheet') };
  })()`);
  ok(sheet.isSheet && sheet.bottom <= 844 && sheet.left >= 10, "底部浮层贴底、左右留白");
  await shot("mobile-demand");
  await click('.search-picker-option[data-pick="d2"]');
  await sleep(200);
  ok(await ev("PROTO.state.demandId === 'd2' && !document.querySelector('.menu.search-picker')"), "移动选中保存并关闭");
  await ev("document.getElementById('toastWrap').innerHTML=''");
  await click('#openBranch');
  await wait("!!document.querySelector('.menu.search-picker.as-sheet')", "移动分支底部浮层");
  await shot("mobile-branch");
  await pressKey("Escape");

  /* ---------- 7. 控制台 / 网络 ---------- */
  ok(cdp.errors.length === 0, "控制台无报错" + (cdp.errors.length ? ("：" + JSON.stringify(cdp.errors.slice(0,3))) : ""));

  console.log("\n结果：" + passed + " PASS / " + failed + " FAIL");
  await ws.close();
  proc.kill();
  process.exit(failed ? 1 : 0);
}catch(err){
  console.error("驱动异常：" + (err && err.stack || err));
  try{ proc.kill(); }catch(e){}
  process.exit(2);
}