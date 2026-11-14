/* P4 批次二原型 · 真实浏览器交互验证与截图
   ① 保存失败回滚 + 换项目守卫口径  ② 依赖卡内就地编辑  ③ 版本状态标签与清除项图标
   用法：node tools/e2e/p4-batch2-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到 docs/audit/prototypes/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/p4-batch2-2026-11-14.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-p4-b2-";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p4-b2-proto-"));
const port = 9234;
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
  const change = async (sel, val) => {
    await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(String(val))}; el.dispatchEvent(new Event('change', { bubbles:true })); return true; })()`);
    await sleep(160);
  };
  const pressKey = async (key) => {
    const map = { Enter:{key:"Enter",code:"Enter",windowsVirtualKeyCode:13}, Escape:{key:"Escape",code:"Escape",windowsVirtualKeyCode:27},
      ArrowDown:{key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40}, ArrowUp:{key:"ArrowUp",code:"ArrowUp",windowsVirtualKeyCode:38} };
    const k = map[key];
    await call("Input.dispatchKeyEvent", { type:"keyDown", ...k });
    await call("Input.dispatchKeyEvent", { type:"keyUp", ...k });
    await sleep(100);
  };
  const clearToasts = () => ev("(() => { document.getElementById('toastWrap').innerHTML=''; return true; })()");
  const lastToast = () => ev("(() => { const t = document.querySelectorAll('#toastWrap .toast'); return t.length ? { text:t[t.length-1].textContent, cls:t[t.length-1].className } : null; })()");

  console.log("P4 批次二原型验证\n  " + FILE);
  await setVP(1440, 1000, false);
  await call("Page.navigate", { url:FILE });
  await wait("!!window.PROTO && document.querySelectorAll('#assocList dt').length > 0", "原型初始化");

  /* ---------- 1. 默认关联卡 ---------- */
  const init = await ev(`(() => ({
    rows: document.querySelectorAll('#assocList dt').length,
    edits: document.querySelectorAll('#assocList .assoc-edit').length,
    kinds: Array.prototype.map.call(document.querySelectorAll('#assocList .assoc-edit'), b => b.dataset.edit),
    depVal: document.querySelector('#assocList [data-edit="deps"].ev-link').textContent,
    depExpanded: document.querySelector('#assocList [data-edit="deps"].assoc-edit').getAttribute('aria-expanded'),
    cardHidden: document.getElementById('depCard').hidden
  }))()`);
  ok(init.rows === 9, "关联卡 9 行（实际 " + init.rows + "）");
  ok(init.edits === 5 && init.kinds.join(",") === "project,version,demand,branch,deps", "五个就地编辑铅笔：项目/版本/需求/分支/依赖");
  ok(init.depVal === "前置 2 · 后置 1", "依赖值给出前置/后置计数（实际 " + init.depVal + "）");
  ok(init.cardHidden && init.depExpanded === "false", "默认收起，铅笔 aria-expanded=false");
  await shot("desktop-card");

  /* ---------- 2. ② 点依赖值就在关联卡内展开（不跳页签） ---------- */
  await click('#assocList [data-edit="deps"].ev-link');
  await wait("!document.getElementById('depCard').hidden", "卡内依赖编辑器展开");
  const depOpenState = await ev(`(() => {
    const card = document.getElementById('depCard');
    return {
      insideAssoc: !!card.closest('#assocCard'),
      inline: card.classList.contains('dep-card-inline'),
      pred: document.querySelectorAll('#depPredList .dep-row').length,
      succ: document.querySelectorAll('#depSuccList .dep-row').length,
      count: document.getElementById('depCount').textContent,
      alert: !document.getElementById('depAlert').hidden,
      alertText: document.getElementById('depAlertText').textContent,
      lockedSel: document.querySelectorAll('#depSuccList [data-dep-locked]').length,
      lockedDel: document.querySelectorAll('#depSuccList .dep-del').length,
      lockedChip: (document.querySelector('#depSuccList .dep-opt-state')||{}).textContent,
      bad: document.querySelectorAll('#depPredList .dep-bad').length,
      expanded: document.querySelector('#assocList [data-edit="deps"].assoc-edit').getAttribute('aria-expanded'),
      closeBtn: !!document.getElementById('depClose'),
      foot: document.getElementById('depFoot').textContent
    };
  })()`);
  ok(depOpenState.insideAssoc && depOpenState.inline, "依赖编辑器就地嵌在关联卡内（无跳转、无弹框）");
  ok(depOpenState.pred === 2 && depOpenState.succ === 1 && depOpenState.count === "3 条", "前置 2 / 后置 1 分组渲染 + 计数");
  ok(depOpenState.alert && /排期冲突/.test(depOpenState.alertText) && depOpenState.bad === 1, "冲突提示条 + 行内冲突徽标");
  ok(depOpenState.lockedSel === 2 && depOpenState.lockedDel === 0 && depOpenState.lockedChip === "只读", "只读对端：类型/滞后禁用、不给删除、标注只读");
  ok(depOpenState.expanded === "true" && depOpenState.closeBtn, "铅笔 aria-expanded=true + 收起按钮");
  ok(/不会自动改日期/.test(depOpenState.foot), "页脚说明只连线不改日期");
  await shot("desktop-deps", true);

  /* ---------- 3. ② 类型 / 滞后即时生效 ---------- */
  await clearToasts();
  await change('#depPredList [data-dep-type="e1"]', "SS");
  const afterType = await ev(`(() => ({
    type: PROTO.state.deps.filter(d => d.id === 'e1')[0].type,
    sel: document.querySelector('#depPredList [data-dep-type="e1"]').value,
    open: !document.getElementById('depCard').hidden
  }))()`);
  const typeToast = await lastToast();
  ok(afterType.type === "SS" && afterType.sel === "SS" && afterType.open, "改依赖类型即时生效、卡片不关");
  ok(typeToast && /已更新依赖/.test(typeToast.text) && typeToast.cls.indexOf("ok") >= 0, "类型改动成功提示");
  await change('#depPredList [data-dep-lag="e1"]', "3");
  const afterLag = await ev(`(() => ({
    lag: PROTO.state.deps.filter(d => d.id === 'e1')[0].lag,
    meta: document.querySelector('#depPredList [data-dep-id="e1"] .dep-meta').textContent
  }))()`);
  ok(afterLag.lag === 3 && /滞后 3 天/.test(afterLag.meta), "改滞后天数即时生效并刷新副标题");
  await shot("desktop-deps-edited");

  /* ---------- 4. ② 卡内新增：候选搜索 + 已关联/只读禁选 ---------- */
  await clearToasts();
  await click('[data-dep-add="pred"]');
  await wait("!document.getElementById('depPicker').hidden", "卡内候选面板");
  const picker = await ev(`(() => ({
    title: document.getElementById('depPickerTitle').textContent,
    opts: document.querySelectorAll('#depPickerList .dep-opt').length,
    disabled: document.querySelectorAll('#depPickerList .dep-opt[disabled]').length,
    states: Array.prototype.map.call(document.querySelectorAll('#depPickerList .dep-opt-state'), s => s.textContent),
    bad: document.querySelectorAll('#depPickerList .dep-opt-state.bad').length,
    inside: !!document.getElementById('depPicker').closest('#depCard')
  }))()`);
  ok(picker.inside && picker.title === "添加前置任务", "候选面板嵌在同一张卡内");
  ok(picker.opts === 6 && picker.disabled === 4, "6 候选：3 已关联 + 1 只读项目禁选");
  ok(picker.states.join(",") === "已关联,已关联,添加,添加,已关联,只读项目", "候选状态标注正确（实际 " + picker.states.join(",") + "）");
  ok(picker.bad === 1, "只读项目状态用告警色标出");
  await shot("desktop-deps-picker");
  await type('#depSearch', "回归");
  ok(await ev("document.querySelectorAll('#depPickerList .dep-opt').length === 1"), "搜索「回归」过滤到 1 条");
  await type('#depSearch', "不存在的工作项");
  ok(await ev("!!document.querySelector('#depPickerList .dep-picker-empty')"), "无匹配给出空态");
  await type('#depSearch', "");
  await click('#depPickerList [data-dep-opt="t3"]');
  await sleep(200);
  const added = await ev(`(() => ({
    total: PROTO.state.deps.length,
    pred: document.querySelectorAll('#depPredList .dep-row').length,
    pickerHidden: document.getElementById('depPicker').hidden,
    depVal: document.querySelector('#assocList [data-edit="deps"].ev-link').textContent
  }))()`);
  ok(added.total === 4 && added.pred === 3 && added.pickerHidden, "添加成功：行数 +1、候选面板自动收起");
  ok(added.depVal === "前置 3 · 后置 1", "关联卡依赖计数同步刷新");

  /* ---------- 5. ② 删除 + 撤销 ---------- */
  await clearToasts();
  const delId = await ev("PROTO.state.deps[PROTO.state.deps.length-1].id");
  await click(`#depPredList [data-dep-del="${delId}"]`);
  await sleep(160);
  const delToast = await lastToast();
  ok(await ev("PROTO.state.deps.length === 3"), "删除依赖即时生效");
  ok(delToast && /已删除与/.test(delToast.text) && /撤销/.test(delToast.text), "删除提示带撤销入口");
  await click('#toastWrap .toast .ta');
  await sleep(160);
  ok(await ev("PROTO.state.deps.length === 4 && document.querySelectorAll('#depPredList .dep-row').length === 3"), "撤销把连线放回来");

  /* ---------- 6. ② 收起 + 铅笔再点一次收起 ---------- */
  await click('#depClose');
  await sleep(140);
  ok(await ev("document.getElementById('depCard').hidden && document.querySelector('#assocList [data-edit=\"deps\"].assoc-edit').getAttribute('aria-expanded') === 'false'"), "收起后卡片隐藏、铅笔状态复位");
  ok(await ev("document.activeElement && document.activeElement.dataset.edit === 'deps'"), "收起后焦点回到依赖铅笔");
  await click('#assocList [data-edit="deps"].assoc-edit');
  await wait("!document.getElementById('depCard').hidden", "铅笔展开");
  await click('#assocList [data-edit="deps"].assoc-edit');
  await sleep(140);
  ok(await ev("document.getElementById('depCard').hidden"), "铅笔二次点击收起（toggle）");

  /* ---------- 7. ① 失败回滚：依赖类型 / 滞后 ---------- */
  await click('#failToggle');
  await clearToasts();
  await click('#openDeps');
  await wait("!document.getElementById('depCard').hidden", "失败模式下展开");
  const before = await ev("(() => { const d = PROTO.state.deps.filter(x => x.id === 'e1')[0]; return { type:d.type, lag:d.lag }; })()");
  await change('#depPredList [data-dep-type="e1"]', "FF");
  const failPatch = await ev(`(() => {
    const d = PROTO.state.deps.filter(x => x.id === 'e1')[0];
    return { type:d.type, lag:d.lag, sel:document.querySelector('#depPredList [data-dep-type="e1"]').value };
  })()`);
  const failToast = await lastToast();
  ok(failPatch.type === before.type && failPatch.sel === before.type, "类型保存失败：状态与控件都回滚到原值");
  ok(failToast && failToast.cls.indexOf("bad") >= 0 && /更新依赖失败.*已还原/.test(failToast.text), "失败提示说清已还原");
  await shot("desktop-deps-fail");

  /* ---------- 8. ① 失败回滚：关联需求（乐观更新→还原） ---------- */
  await clearToasts();
  const demandBefore = await ev("PROTO.state.demandId");
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "需求浮层");
  await click('.search-picker-option[data-pick="d3"]');
  await sleep(120);
  const optimistic = await ev("PROTO.state.demandId");
  ok(optimistic === "d3", "先乐观更新到 d3");
  await wait(`PROTO.state.demandId === ${JSON.stringify(demandBefore)}`, "失败后还原", 3000);
  const rollback = await ev(`(() => ({
    val: document.querySelector('#assocList [data-edit="demand"]').closest('dd').querySelector('.ev-link').textContent,
    state: PROTO.state.demandId
  }))()`);
  ok(rollback.val === "阶梯水价核算规则", "读态卡片回到服务器上的值，不停在没落库的新值");
  const rbToast = await lastToast();
  ok(rbToast && rbToast.cls.indexOf("bad") >= 0 && /保存失败.*已还原为服务器上的值/.test(rbToast.text), "失败提示：已还原为服务器上的值");
  ok(await ev(`(() => { const c = document.getElementById("depCard"), p = document.querySelector('#assocList [data-edit="deps"].assoc-edit');
    return !c.hidden && p && p.getAttribute("aria-expanded") === "true"; })()`),
    "关联保存失败回滚后依赖卡仍展开在关联卡内（重填不收起）");
  await shot("desktop-fail-rollback");
  await click('#failToggle');
  await clearToasts();

  /* ---------- 8b. ① 成功保存同样不收起用户正在看的依赖卡 ---------- */
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "需求浮层（恢复网络后）");
  await click('.search-picker-option[data-pick="d3"]');
  await sleep(160);
  const okSave = await ev(`(() => ({
    state: PROTO.state.demandId,
    val: document.querySelector('#assocList [data-edit="demand"]').closest('dd').querySelector('.ev-link').textContent,
    cardOpen: !document.getElementById("depCard").hidden,
    expanded: document.querySelector('#assocList [data-edit="deps"].assoc-edit').getAttribute("aria-expanded")
  }))()`);
  ok(okSave.state === "d3" && okSave.val === "线上缴费渠道接入", "恢复后同一入口保存成功并即时更新读态值");
  ok(okSave.cardOpen && okSave.expanded === "true", "成功保存后依赖卡仍展开（成功与失败两条路径都不收起）");
  const okToast = await lastToast();
  ok(okToast && okToast.cls.indexOf("ok") >= 0 && /已更新关联需求/.test(okToast.text), "成功提示正常给出");
  await clearToasts();
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "需求浮层（复位）");
  await click('.search-picker-option[data-pick="d1"]');
  await sleep(160);
  ok(await ev(`PROTO.state.demandId === "d1" && !document.getElementById("depCard").hidden`), "复位原需求，连续两次成功保存都不收起依赖卡");
  await clearToasts();

  /* ---------- 9. ① 换项目守卫：任意发布记录都拦 ---------- */
  await click('#assocList [data-edit="project"].assoc-edit');
  await sleep(160);
  const guard = await lastToast();
  ok(!await ev("!!document.querySelector('.menu.search-picker')"), "有发布记录时不打开项目选择浮层");
  ok(guard && /正式发布记录.*不能改变项目/.test(guard.text) && /执行状态仍可独立调整/.test(guard.text), "守卫文案与后端一致");
  await ev("(() => { PROTO.state.releaseRecords = 0; document.getElementById('toastWrap').innerHTML=''; return true; })()");
  await click('#assocList [data-edit="project"].assoc-edit');
  await sleep(160);
  const guardOff = await lastToast();
  ok(guardOff && /换项目走二次确认/.test(guardOff.text), "无发布记录时放行（原型演示二次确认）");
  await ev("(() => { PROTO.state.releaseRecords = 1; document.getElementById('toastWrap').innerHTML=''; return true; })()");

  /* ---------- 10. ③ 版本候选：状态标签 + 锁定行 + 多选保存 ---------- */
  await click('#openVersion');
  await wait("!!document.querySelector('.menu.search-picker.ver-picker')", "版本浮层");
  const vpop = await ev(`(() => {
    const opts = Array.prototype.slice.call(document.querySelectorAll('.ver-picker .search-picker-option'));
    return {
      opts: opts.length,
      tags: opts.map(o => (o.querySelector('.sp-tag')||{}).textContent),
      tagCls: opts.map(o => (o.querySelector('.sp-tag')||{}).className),
      boxes: document.querySelectorAll('.ver-picker .pp-box').length,
      locked: document.querySelectorAll('.ver-picker .search-picker-option.is-locked').length,
      lockedDisabled: !!document.querySelector('.ver-picker .is-locked').disabled,
      lockedTag: !!document.querySelector('.ver-picker .is-locked .sp-tag'),
      lockIcon: !!document.querySelector('.ver-picker .is-locked .pp-lock svg'),
      selected: document.querySelectorAll('.ver-picker .search-picker-option.selected').length,
      count: document.querySelector('.ver-picker .pp-count').textContent,
      actions: !!document.querySelector('.pp-foot-actions [data-ver-save]') && !!document.querySelector('.pp-foot-actions [data-ver-cancel]'),
      foot: document.querySelector('.ver-picker .search-picker-foot').textContent
    };
  })()`);
  ok(vpop.opts === 6 && vpop.boxes === 6, "版本浮层 6 候选，每行带勾选框");
  ok(vpop.tags.join(",") === "已发布,开发中,待规划,待规划,已关闭,已发布", "每行状态标签文字（实际 " + vpop.tags.join(",") + "）");
  ok(vpop.tagCls.join("|") === "sp-tag released|sp-tag active|sp-tag planned|sp-tag planned|sp-tag closed|sp-tag released", "状态标签配色类按状态映射");
  const tagColors = await ev(`(() => {
    const pick = s => { const el = document.querySelector('.ver-picker .sp-tag.' + s); if(!el) return null;
      const cs = getComputedStyle(el); return cs.backgroundColor + '/' + cs.color; };
    return { released:pick('released'), active:pick('active'), planned:pick('planned'), closed:pick('closed') };
  })()`);
  ok(tagColors.released !== tagColors.active && tagColors.active !== tagColors.planned && tagColors.planned !== tagColors.closed,
    "四种状态标签底色/字色互不相同（非纯文字）");
  ok(vpop.locked === 1 && vpop.lockedDisabled && vpop.lockedTag && vpop.lockIcon, "只读版本：锁定禁用 + 仍显示状态标签 + 锁图标");
  ok(vpop.selected === 2 && vpop.actions && /版本调整理由/.test(vpop.foot), "已选 2（含锁定）+ 保存/取消 + 理由口径");
  await shot("desktop-version");
  await click('.ver-picker [data-ver-pick="v3"]');
  await sleep(120);
  ok(await ev("document.querySelectorAll('.ver-picker .search-picker-option.selected').length === 3"), "多选：勾上 v2.4 后已选 3");
  await click('.ver-picker [data-ver-cancel]');
  await sleep(140);
  ok(await ev("!document.querySelector('.menu.search-picker') && PROTO.state.versionIds.join(',') === 'v2'"), "取消不落库");
  await click('#openVersion');
  await wait("!!document.querySelector('.ver-picker')", "版本浮层再开");
  await click('.ver-picker [data-ver-pick="v3"]');
  await click('.ver-picker [data-ver-save]');
  await sleep(200);
  const verSaved = await ev(`(() => ({
    ids: PROTO.state.versionIds.join(','),
    vals: Array.prototype.map.call(document.querySelectorAll('#assocList [data-edit="version"]').length ? document.querySelector('#assocList [data-edit="version"]').closest('dd').querySelectorAll('.ev-link.ver') : [], a => a.textContent),
    popGone: !document.querySelector('.menu.search-picker')
  }))()`);
  ok(verSaved.ids === "v2,v3" && verSaved.popGone, "保存后多选落库、浮层关闭");
  ok(verSaved.vals.join("、") === "v2.3 迭代二、v2.4 迭代三", "读态版本值刷新为两个可跳转链接");
  await shot("desktop-version-saved");

  /* ---------- 11. ③ 清除项 ⊘ 图标 ---------- */
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker')", "需求浮层（清除项）");
  const clearRow = await ev(`(() => {
    const el = document.querySelector('.search-picker-clear');
    return { text:el.textContent, icon:!!el.querySelector('.ci svg'), ci:!!el.querySelector('.ci') };
  })()`);
  ok(clearRow.ci && clearRow.icon && /不关联/.test(clearRow.text), "需求清除项带 ⊘ 图标 + 「不关联」");
  await shot("desktop-demand-clear");
  await clearToasts();
  await click('.search-picker-clear');
  await sleep(200);
  ok(await ev("PROTO.state.demandId === '' && !!document.querySelector('#assocList [data-edit=\"demand\"]').closest('dd').querySelector('.ev-empty')"), "清除需求 → 未关联占位");
  await click('#openBranch');
  await wait("!!document.querySelector('.menu.search-picker')", "分支浮层（清除项）");
  const bClear = await ev(`(() => {
    const el = document.querySelector('.search-picker-clear');
    return { text:el.textContent, icon:!!el.querySelector('.ci svg'),
      tags:document.querySelectorAll('.search-picker-option .sp-tag').length,
      target:!!document.querySelector('.search-picker-option .sp-target') };
  })()`);
  ok(bClear.icon && /未设置/.test(bClear.text), "分支清除项带 ⊘ 图标 + 「未设置」");
  ok(bClear.tags === 5 && bClear.target, "分支候选状态标签 + 目标分支仍在");
  await shot("desktop-branch-clear");
  await pressKey("Escape");
  ok(await ev("!document.querySelector('.menu.search-picker')"), "Esc 关闭浮层");
  await click('#resetBtn');
  await sleep(160);
  await clearToasts();

  /* ---------- 12. 只读项目 ---------- */
  await click('#openDeps');
  await wait("!document.getElementById('depCard').hidden", "只读前展开依赖");
  await click('#roToggle');
  await sleep(180);
  const ro = await ev(`(() => ({
    edits: document.querySelectorAll('#assocList .assoc-edit').length,
    jumps: document.querySelectorAll('#assocList .ev-link').length,
    note: getComputedStyle(document.querySelector('.ro-note')).display,
    cardHidden: document.getElementById('depCard').hidden,
    locked: document.querySelectorAll('#depCard [data-dep-locked]').length,
    dels: document.querySelectorAll('#depCard .dep-del').length,
    foot: document.getElementById('depFoot').textContent,
    adds: Array.prototype.filter.call(document.querySelectorAll('#depCard .dep-add'), b => !b.hidden).length
  }))()`);
  ok(ro.edits === 0 && ro.jumps >= 6, "只读：铅笔全消失、跳转保留");
  ok(ro.note === "flex", "只读提示条出现");
  ok(!ro.cardHidden && /只读/.test(ro.foot) && ro.adds === 0 && ro.dels === 0 && ro.locked === 6,
    "只读：依赖仍可就地查看，控件全锁、无增删入口");
  await shot("desktop-readonly", true);
  await click('#depClose');
  await click('#assocList [data-edit="deps"].ev-link');
  await sleep(160);
  ok(await ev("!document.getElementById('depCard').hidden"), "只读点依赖值仍能展开查看（不是死路）");
  await click('#depClose');
  await click('#roToggle');
  await sleep(150);

  /* ---------- 13. 深色 ---------- */
  await click('#themeToggle');
  ok(await ev("document.documentElement.dataset.theme === 'dark'"), "深色主题切换");
  await click('#openDeps');
  await wait("!document.getElementById('depCard').hidden", "深色依赖卡");
  await shot("desktop-dark-deps", true);
  await click('#openVersion');
  await wait("!!document.querySelector('.ver-picker')", "深色版本浮层");
  await shot("desktop-dark-version");
  const darkTag = await ev("(() => { const cs = getComputedStyle(document.querySelector('.ver-picker .sp-tag.active')); return cs.backgroundColor + '/' + cs.color; })()");
  ok(darkTag !== tagColors.active, "深色下状态标签用深色令牌（实际 " + darkTag + "）");
  await pressKey("Escape");
  await click('#themeToggle');
  await click('#depClose');
  await clearToasts();

  /* ---------- 14. 移动端 390 ---------- */
  await click('#vpMobile');
  await setVP(390, 844, true);
  await sleep(300);
  await click('#openDeps');
  await wait("!document.getElementById('depCard').hidden", "移动依赖卡");
  const mob = await ev(`(() => {
    const card = document.getElementById('depCard');
    const rows = Array.prototype.map.call(card.querySelectorAll('.dep-row'), r => { const b = r.getBoundingClientRect(); return { w:Math.round(b.width), right:Math.round(b.right) }; });
    return { overflow:document.documentElement.scrollWidth, isMobile:document.getElementById('stage').classList.contains('is-mobile'),
      rows, edits:document.querySelectorAll('#assocList .assoc-edit').length };
  })()`);
  ok(mob.overflow <= 390, "移动端无横向溢出（scrollWidth " + mob.overflow + "）");
  ok(mob.isMobile && mob.edits === 5, "移动布局生效、五个铅笔仍在");
  ok(mob.rows.length === 3 && mob.rows.every(r => r.right <= 390), "依赖行不越界");
  await shot("mobile-deps", true);
  await click('[data-dep-add="succ"]');
  await wait("!document.getElementById('depPicker').hidden", "移动候选面板");
  ok(await ev("document.getElementById('depPickerTitle').textContent === '添加后置任务'"), "后置候选标题正确");
  await shot("mobile-deps-picker", true);
  await click('#depPickerClose');
  await click('#openVersion');
  await wait("!!document.querySelector('.menu.search-picker.as-sheet')", "移动版本底部浮层");
  const sheet = await ev(`(() => { const el = document.querySelector('.menu.search-picker'); const r = el.getBoundingClientRect();
    return { bottom:Math.round(r.bottom), left:Math.round(r.left), right:Math.round(window.innerWidth - r.right),
      tags:document.querySelectorAll('.sp-tag').length, actions:!!document.querySelector('.pp-foot-actions') }; })()`);
  ok(sheet.bottom <= 844 && sheet.left >= 10 && sheet.right >= 10, "底部浮层贴底、左右留白");
  ok(sheet.tags === 6 && sheet.actions, "移动端状态标签与保存/取消都在");
  await shot("mobile-version");
  await pressKey("Escape");
  await click('#openDemand');
  await wait("!!document.querySelector('.menu.search-picker.as-sheet')", "移动需求底部浮层");
  await shot("mobile-demand");
  await pressKey("Escape");
  await click('#depClose');
  await clearToasts();
  await shot("mobile-card", true);

  /* ---------- 15. 重复交互稳定性 + 控制台 ---------- */
  for(let i = 0; i < 3; i++){
    await click('#openDeps'); await sleep(90);
    await click('#depClose'); await sleep(90);
  }
  const stable = await ev(`(() => ({
    cards: document.querySelectorAll('#depCard').length,
    lists: document.querySelectorAll('#depPredList').length,
    rows: document.querySelectorAll('#depPredList .dep-row').length,
    toasts: document.querySelectorAll('#toastWrap .toast').length
  }))()`);
  ok(stable.cards === 1 && stable.lists === 1 && stable.rows === 2, "反复展开/收起不重复渲染（行数仍为 2）");
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