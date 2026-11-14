/* 用例查询与自定义分组原型 · 真实浏览器交互验证与截图
   用法：node tools/e2e/testcase-query-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到原型 shots/ 目录。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = path.resolve("docs/audit/prototypes/testcase-query-2026-11-14");
const FILE = pathToFileURL(path.join(DIR, "index.html")).href;
const SHOT_DIR = path.join(DIR, "shots");
fs.mkdirSync(SHOT_DIR, { recursive:true });

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-query-proto-"));
const port = 9247;
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
  const wait = async (expr, label, timeout = 12000) => {
    const end = Date.now() + timeout; let last;
    while(Date.now() < end){
      try{ last = await ev(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(120);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };
  let lastW = 1440, lastH = 1000, lastMobile = false;
  const viewport = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width:w, height:h, deviceScaleFactor:mobile ? 2 : 1, mobile:!!mobile });
  const setVP = async (w, h, m) => { lastW = w; lastH = h; lastMobile = !!m; await viewport(w, h, m); await sleep(180); };
  const shot = async (name, full, keepToast) => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
      ${keepToast ? "" : "const t = document.querySelector('.toast'); if(t) t.style.visibility = 'hidden';"} return true; })()`);
    if(full){
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await viewport(lastW, Math.min(h + 20, 9000), lastMobile);
      await sleep(220);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + name + ".png");
    if(full){ await viewport(lastW, lastH, lastMobile); await sleep(160); }
    await ev(`(() => { const t = document.querySelector('.toast'); if(t) t.style.visibility = ''; return true; })()`);
  };
  const go = async (params, w, h, mobile) => {
    await setVP(w || 1440, h || 1000, mobile);
    await call("Page.navigate", { url:FILE + (params ? "?" + params : "") });
    await wait("!!window.PROTO && document.querySelectorAll('.case-row,.set-item,.grp').length > 0", "原型初始化 " + params);
    await sleep(160);
  };
  const click = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const overflow = () => ev(`(() => ({ sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth }))()`);

  console.log("用例查询与自定义分组原型验证\n  " + FILE);

  /* ---------- 1. 批次 A：查询体验 ---------- */
  await go("view=list", 1440, 1000, false);
  const a = await ev(`(() => ({
    rows:document.querySelectorAll('.case-row').length,
    total:PROTO.data.CASES.length,
    sortCtl:!!document.querySelector('[data-ctl="sort"]'),
    sortOptions:[...document.querySelectorAll('[data-ctl="sort"] option')].map(o => o.value),
    pageOptions:[...document.querySelectorAll('[data-ctl="pageSize"] option')].map(o => o.value),
    groupCtl:!!document.querySelector('[data-ctl="group"]'),
    selAll:!!document.querySelector('[data-selall]'),
    selAllN:document.querySelector('[data-selall] .n').textContent,
    wide:!!document.querySelector('[data-wide]'),
    more:document.querySelector('.load-more') ? document.querySelector('.load-more').textContent.replace(/\\s+/g,'') : null,
    firstNo:document.querySelector('.cr-no').textContent,
    firstPri:document.querySelector('.cr-pri').textContent
  }))()`);
  ok(a.total === 328 && a.rows === 50, "默认每页 50 条 / 共 " + a.total + " 条，渲染 " + a.rows + " 行");
  ok(a.sortCtl && a.sortOptions.join(",") === "pri,executed,no,module,created", "排序字段 5 项：" + a.sortOptions.join("/"));
  ok(a.pageOptions.join(",") === "50,100,200", "每页条数 50/100/200");
  ok(a.groupCtl && a.selAll && a.selAllN === "328", "分组控件 + 全选筛选结果（328）");
  ok(a.wide, "搜索范围开关「含步骤与前置」存在");
  ok(a.firstPri === "P0", "默认按优先级升序，首行 " + a.firstNo + " 为 P0");
  ok(/已加载50\/共328条/.test(a.more || ""), "加载更多文案：" + a.more);
  await shot("a-list-1440", false);
  await shot("a-list-full-1440", true);

  /* 排序菜单 */
  await go("view=list&forced=sort", 1440, 1000, false);
  ok(await ev("document.querySelectorAll('.pop .pop-item').length") === 5, "排序浮层 5 个字段 + 升降序");
  await shot("a-list-sort-1440", false);

  /* 真实点击：改排序为编号降序 */
  await go("view=list", 1440, 1000, false);
  await click('[data-pop="sort"]');
  await click('[data-sort="no"]');
  await click('[data-sortdir="1"]');
  const sorted = await ev(`(() => ({ sort:PROTO.state.sort, dir:PROTO.state.sortDir,
    first:document.querySelector('.cr-no').textContent }))()`);
  ok(sorted.sort === "no" && sorted.dir === "desc" && sorted.first === "TC-328", "点击排序生效：编号降序，首行 " + sorted.first);

  /* 全选筛选结果 */
  await go("view=list&forced=selectall", 1440, 1000, false);
  const sel = await ev(`(() => ({
    n:document.querySelector('.bulk-count b').textContent,
    hint:document.querySelector('.bulk-hint').textContent,
    btns:[...document.querySelectorAll('.bulk-bar .btn')].map(b => b.textContent.trim()),
    rowsSel:document.querySelectorAll('.case-row.sel').length
  }))()`);
  ok(sel.n === "328", "全选筛选结果 = 328 条（含未加载）");
  ok(/未加载/.test(sel.hint), "批量条明示未加载行也生效：" + sel.hint);
  ok(sel.btns.includes("加入测试计划") && sel.btns.includes("加入分组"), "批量动作含加入计划 / 加入分组");
  ok(sel.rowsSel === 50, "当前页 50 行全部呈选中态");
  await shot("a-list-selectall-1440", false);

  /* 筛选后全选只覆盖匹配行 */
  await go("view=list&status=failed", 1440, 1000, false);
  await click('[data-selall="1"]');
  const fsel = await ev(`(() => ({ n:document.querySelector('.bulk-count b').textContent,
    matched:PROTO.filtered().length }))()`);
  ok(fsel.n === String(fsel.matched) && fsel.matched === 18, "筛选「失败」后全选 = " + fsel.n + " 条，不是全库 328");

  /* 导出菜单 */
  await go("view=list&forced=export", 1440, 1000, false);
  const exp = await ev(`(() => [...document.querySelectorAll('.pop .pop-item')].map(b => b.textContent.replace(/\\s+/g,' ').trim()))()`);
  ok(exp.some(t => /导出当前筛选结果/.test(t)) && exp.some(t => /导出项目全部（现状）/.test(t)), "导出区分筛选结果 / 所选 / 全部（现状）");
  await shot("a-list-export-1440", false);

  /* 搜索范围收敛 */
  await go("view=list", 1440, 1000, false);
  await ev(`(() => { const el = document.querySelector('[data-ctl="q"]');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,'回调');
    el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(420);
  const narrow = await ev("PROTO.filtered().length");
  await click('[data-wide]');
  const wide = await ev("PROTO.filtered().length");
  ok(narrow > 0 && wide > narrow, "搜索「回调」：默认范围 " + narrow + " 条，含步骤与前置 " + wide + " 条（步骤命中扩大范围）");

  /* 移动端 */
  await go("view=list&loaded=12", 390, 844, true);
  const m = await overflow();
  ok(m.sw <= m.cw + 1, "390px 无横向溢出（scrollWidth " + m.sw + " / client " + m.cw + "）");
  ok(await ev("getComputedStyle(document.querySelector('.sidebar')).display") === "none", "390px 侧边栏隐藏，与产品 mobile.css 一致");
  await shot("a-list-390", true);

  /* ---------- 2. 分组显示 ---------- */
  await go("view=group&group=module", 1440, 1000, false);
  const g = await ev(`(() => ({
    groups:document.querySelectorAll('.grp').length,
    heads:[...document.querySelectorAll('.grp-name')].map(h => h.textContent.replace(/\\s+/g,' ').trim()).slice(0,3),
    bars:document.querySelectorAll('.grp-bar').length,
    hint:document.querySelector('.drop-banner') ? document.querySelector('.drop-banner').textContent.replace(/\\s+/g,' ') : null,
    segBtns:document.querySelectorAll('[data-grpsel]').length,
    more:document.querySelectorAll('.grp-more').length
  }))()`);
  ok(g.groups === 9, "按模块分组 = 9 个叶子段（含零用例段）");
  ok(g.bars === 9 && g.segBtns === 9, "每段带结果分布条 + 全选本组");
  ok(/移动归属/.test(g.hint || ""), "模块维度拖拽语义明示：" + (g.hint || "").slice(0, 60));
  ok(g.more > 0, "段内加载更多 " + g.more + " 处");
  await shot("b-group-module-1440", true);

  await go("view=group&group=priority", 1440, 1000, false);
  ok(await ev("document.querySelectorAll('.grp').length") === 4, "按优先级分组 = 4 段");
  await shot("b-group-priority-1440", true);

  await go("view=group&group=set", 1440, 1000, false);
  const gs = await ev(`(() => ({ n:document.querySelectorAll('.grp').length,
    hint:document.querySelector('.drop-banner').textContent.replace(/\\s+/g,' ') }))()`);
  ok(gs.n === 6 && /加入分组/.test(gs.hint) && /原分组保留/.test(gs.hint), "按自定义分组 = 6 段，语义切换为「加入（多归属）」");
  await shot("b-group-set-1440", true);

  await go("view=group&group=module&forced=collapsed", 1440, 1000, false);
  const col = await ev(`(() => ({ bodies:document.querySelectorAll('.grp-body').length,
    heads:document.querySelectorAll('.grp-head').length }))()`);
  ok(col.heads === 9 && col.bodies === 5, "折叠 4 段后只剩 5 段展开（段头保留计数）");
  await shot("b-group-collapsed-1440", false);

  await go("view=group&group=module&loaded=12", 390, 844, true);
  const gm = await overflow();
  ok(gm.sw <= gm.cw + 1, "分组视图 390px 无横向溢出");
  await shot("b-group-390", true);
  await shot("b-group-390-top", false);

  /* ---------- 3. 拖拽归类 ---------- */
  await go("view=drag", 1440, 1000, false);
  const d = await ev(`(() => ({
    nodes:document.querySelectorAll('.dir-node').length,
    lv2:document.querySelectorAll('.dir-node.lv1').length,
    draggable:document.querySelectorAll('.case-row[draggable="true"]').length,
    sub:!!document.querySelector('[data-dirsub]'),
    foot:document.querySelector('.dir-foot').textContent.replace(/\\s+/g,' ').slice(0,40)
  }))()`);
  ok(d.nodes === 12 && d.lv2 === 6, "目录树 6 个一级 + 6 个二级，共 " + d.nodes + " 个可放置节点");
  ok(d.draggable === 12, "12 行用例可拖拽");
  ok(d.sub && /只属一个/.test(d.foot), "「显示子模块用例」开关 + 单归属口径说明");
  const dscope = await ev(`(() => ({
    chip:[...document.querySelectorAll('.tc-bar .tag')].map(t => t.textContent.trim()),
    mods:[...document.querySelectorAll('.case-row .cr-mod-cell .cr-mod')].map(m => m.textContent.trim()),
    selall:document.querySelector('[data-selall]').textContent.replace(/\\s+/g,' ')
  }))()`);
  ok(dscope.chip.some(t => t === "74 条") && dscope.mods.length === 12 && dscope.mods.every(t => /登录鉴权/.test(t)),
    "目录范围生效：当前目录 74 条，渲染行均属登录鉴权");
  ok(/全选本目录结果 74/.test(dscope.selall), "拖拽页全选口径 = 本目录结果：" + dscope.selall);
  await click('[data-dirsub]');
  ok(await ev("!!document.querySelector('.list-empty')"), "关闭「显示子模块用例」后父节点给出空态与指引");
  await shot("c-drag-empty-1440", false);
  await click('[data-dirsub]');
  await click('[data-dir="m31"]');
  ok(await ev(`[...document.querySelectorAll('.case-row .cr-mod')].every(m => m.textContent.trim() === '对账导出 / 批量导出')`),
    "点击叶子目录切换列表范围到批量导出");
  await click('[data-dir="m1"]');
  await shot("c-drag-1440", true);

  await go("view=drag&forced=over", 1440, 1000, false);
  const ov = await ev(`(() => ({
    ghost:!!document.querySelector('.drag-ghost'),
    ghostN:document.querySelector('.drag-ghost .n') ? document.querySelector('.drag-ghost .n').textContent : null,
    dropOn:document.querySelectorAll('.dir-node.drop-on').length,
    dropName:document.querySelector('.dir-node.drop-on .dir-name') ? document.querySelector('.dir-node.drop-on .dir-name').textContent : null,
    dragging:document.querySelectorAll('.case-row.dragging').length,
    banner:document.querySelector('.drop-banner').textContent.replace(/\\s+/g,' ')
  }))()`);
  ok(ov.ghost && ov.ghostN === "3", "拖拽浮标显示 3 条");
  ok(ov.dropOn === 1 && ov.dropName === "批量导出", "放置目标高亮：「" + ov.dropName + "」");
  ok(ov.dragging === 3, "被拖的 3 行呈半透明虚线态");
  ok(/移动归属/.test(ov.banner), "拖拽横幅明示移动语义");
  await shot("c-drag-over-1440", false);

  await go("view=drag&forced=confirm", 1440, 1000, false);
  const cf = await ev(`(() => ({
    title:document.querySelector('.modal-title').textContent,
    from:document.querySelector('.move-arrow .from').textContent,
    to:document.querySelector('.move-arrow .to').textContent,
    kv:[...document.querySelectorAll('.modal .kv')].map(k => k.textContent.replace(/\\s+/g,' ').trim()),
    preview:document.querySelectorAll('.modal .case-row').length
  }))()`);
  ok(/移动 3 条用例/.test(cf.title), "确认弹层标题：" + cf.title);
  ok(cf.from !== cf.to && /批量导出/.test(cf.to), "原模块 → 新模块：" + cf.from + " → " + cf.to);
  ok(cf.kv.some(t => /编号/.test(t) && /不变/.test(t)) && cf.kv.some(t => /执行流水/.test(t) && /保留/.test(t)), "明示编号不变、执行历史与证据保留");
  ok(cf.kv.some(t => /覆盖矩阵/.test(t)) && cf.kv.some(t => /测试计划/.test(t)), "明示覆盖矩阵变化与在途计划影响");
  ok(cf.preview === 3, "弹层内预览 3 条受影响用例");
  await shot("c-drag-confirm-1440", false);

  /* 真实确认 → 撤销 toast */
  await click('[data-modal="move-ok"]');
  await sleep(200);
  const un = await ev(`(() => ({ toast:document.querySelector('.toast').textContent.replace(/\\s+/g,' '),
    undo:!!document.querySelector('[data-undo]'), modal:!!document.querySelector('.modal') }))()`);
  ok(!un.modal && un.undo && /已移动 3 条/.test(un.toast), "确认后弹层关闭，toast 带撤销：" + un.toast);
  await shot("c-drag-undo-1440", false, true);

  await go("view=drag&loaded=8", 390, 844, true);
  const dm = await overflow();
  ok(dm.sw <= dm.cw + 1, "拖拽视图 390px 无横向溢出（目录树堆叠到列表上方）");
  await shot("c-drag-390", true);

  /* ---------- 4. 自定义分组 ---------- */
  await go("view=sets", 1440, 1000, false);
  const st = await ev(`(() => ({
    sets:document.querySelectorAll('.set-item').length,
    team:document.querySelectorAll('.vis-team').length,
    mine:document.querySelectorAll('.vis-mine').length,
    sem:document.querySelectorAll('.sem').length,
    semTitles:[...document.querySelectorAll('.sem h3')].map(h => h.textContent.replace(/\\s+/g,' ').trim()),
    rules:[...document.querySelectorAll('.rule-chip')].map(r => r.textContent.replace(/\\s+/g,' ').trim()),
    members:document.querySelectorAll('.card .case-row').length,
    dyn:PROTO.data.SETS.filter(s => s.dynamic).length
  }))()`);
  ok(st.sets === 6, "6 个分组（4 团队 + 1 指定成员 + 1 仅自己）");
  ok(st.sem === 2, "语义对比卡 2 张");
  ok(st.semTitles.some(t => /拖入 = 移动/.test(t)) && st.semTitles.some(t => /拖入 = 加入/.test(t)), "两种拖拽语义并列对比：" + st.semTitles.join(" | "));
  ok(st.rules.some(r => /动态/.test(r)) && st.rules.some(r => /收录规则/.test(r)), "分组详情显示收录规则与动态/静态");
  ok(st.members === 8 && st.dyn === 3, "成员预览 8 行；3 个动态分组");
  await shot("d-sets-1440", true);

  await go("view=sets&forced=newset", 1440, 1000, false);
  const ns = await ev(`(() => ({
    title:document.querySelector('.modal-title').textContent,
    radios:[...document.querySelectorAll('.radio-main b')].map(b => b.textContent.trim()),
    vis:[...document.querySelectorAll('.radio-main span')].map(s => s.textContent.slice(0,22))
  }))()`);
  ok(/新建分组/.test(ns.title), "新建分组弹层：" + ns.title);
  ok(ns.radios.includes("团队共享") && ns.radios.includes("指定成员可见") && ns.radios.includes("仅自己可见"),
    "可见范围三选一：团队共享 / 指定成员可见 / 仅自己可见");
  ok(ns.radios.includes("手工挑选") && ns.radios.some(t => /动态收录/.test(t)), "分组类型二选一：手工挑选 / 动态收录");
  ok(ns.radios.some(t => /按当前筛选加入/.test(t)) && ns.radios.includes("先建空分组"), "初始成员：按当前筛选加入 / 先建空分组");
  await shot("d-sets-new-1440", false);

  await go("view=sets&forced=dragset", 1440, 1000, false);
  const ds = await ev(`(() => ({ dropOn:document.querySelectorAll('.set-item.drop-on').length,
    name:document.querySelector('.set-item.drop-on .set-name') ? document.querySelector('.set-item.drop-on .set-name').textContent.replace(/\\s+/g,' ').trim() : null,
    ghost:!!document.querySelector('.drag-ghost') }))()`);
  ok(ds.dropOn === 1 && /兼容性矩阵/.test(ds.name || ""), "拖到分组高亮：「" + ds.name + "」（加入语义）");
  await shot("d-sets-drag-1440", false);

  /* 真实点击：切换分组 + 删除保护文案 */
  await go("view=sets", 1440, 1000, false);
  await click('[data-set="s3"]');
  const sw = await ev(`(() => ({ active:PROTO.state.activeSet,
    name:document.querySelector('.set-detail-head h2').textContent.replace(/\\s+/g,' ').trim(),
    n:document.querySelectorAll('.card .case-row').length }))()`);
  ok(sw.active === "s3" && /兼容性矩阵/.test(sw.name), "点击切换分组生效：" + sw.name);

  await go("view=sets&loaded=8", 390, 844, true);
  const sm = await overflow();
  ok(sm.sw <= sm.cw + 1, "自定义分组 390px 无横向溢出");
  await shot("d-sets-390", true);
  await shot("d-sets-390-top", false);

  /* ---------- 5. 按筛选圈选入计划 ---------- */
  await go("view=plan&module=m3", 1440, 1000, false);
  const p = await ev(`(() => ({
    vs:document.querySelectorAll('.vs').length,
    sum:document.querySelector('.pick-sum b').textContent,
    rows:[...document.querySelectorAll('.pick-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()),
    target:!!document.querySelector('#planTarget'),
    dyn:!!document.querySelector('[data-dynamic]'),
    btn:document.querySelector('[data-planconfirm]').textContent.replace(/\\s+/g,' ').trim()
  }))()`);
  ok(p.vs === 2, "现状 vs 建议对比 2 张");
  const pchip = await ev(`(() => ({ chips:[...document.querySelectorAll('.pick-layout .tc-bar .tag')].map(t => t.textContent.trim()),
    matched:PROTO.filtered().length,
    bar:document.querySelector('.pick-layout .tc-bar .muted').textContent.replace(/\\s+/g,''),
    sum:Number(document.querySelector('.pick-sum b').textContent) }))()`);
  ok(pchip.chips.some(t => t === "模块：对账导出") && pchip.bar === "匹配" + pchip.matched + "条" && pchip.sum === pchip.matched - 37,
    "圈选页筛选 chips / 匹配数 / 新增数同源：" + pchip.chips.join(" / ") + " → " + pchip.bar + "，新增 " + pchip.sum);
  ok(p.rows.some(r => /已在计划中/.test(r)) && p.rows.some(r => /本次新增/.test(r)), "圈选预览含去重与新增计数：" + p.rows.join(" / "));
  ok(p.target && p.dyn, "目标计划下拉 + 同时保存为动态分组选项");
  ok(/加入 \d+ 条用例/.test(p.btn), "主按钮：" + p.btn);
  await shot("e-plan-1440", true);

  await go("view=plan&module=m3&forced=planconfirm", 1440, 1000, false);
  const pc = await ev(`(() => ({ title:document.querySelector('.modal-title').textContent,
    kv:[...document.querySelectorAll('.modal .kv')].map(k => k.textContent.replace(/\\s+/g,' ').trim()) }))()`);
  ok(/确认加入测试计划/.test(pc.title), "圈选确认弹层：" + pc.title);
  ok(pc.kv.some(t => /发布必测/.test(t)) && pc.kv.some(t => /审计日志/.test(t)), "明示发布必测标记与审计留痕");
  await shot("e-plan-confirm-1440", false);
  await click('[data-modal="plan-ok"]');
  await sleep(200);
  ok(await ev("!!document.querySelector('.toast.show') && !document.querySelector('.modal')"), "确认后关闭弹层并给出结果 toast");

  await go("view=plan&module=m3&loaded=8", 390, 844, true);
  const pm = await overflow();
  ok(pm.sw <= pm.cw + 1, "圈选视图 390px 无横向溢出");
  await shot("e-plan-390", true);
  await shot("e-plan-390-top", false);

  /* ---------- 6. 批次 C：动态分组 / 指定成员可见 / 单行筛选条 ---------- */
  await go("view=sets&forced=newsetdynamic", 1440, 1000, false);
  const dy = await ev(`(() => ({
    kind:PROTO.state.setKind,
    fields:document.querySelectorAll('.rule-grid .field').length,
    selects:[...document.querySelectorAll('.rule-grid select')].map(s => s.dataset.ctl),
    kw:!!document.querySelector('[data-ctl="rule.q"]'),
    flags:[...document.querySelectorAll('.rule-flags [data-rule]')].map(f => f.dataset.rule),
    regression:!!document.querySelector('[data-rule="regression"].on'),
    hits:Number(document.querySelector('.rule-hit b').textContent),
    realHits:PROTO.ruleHits(PROTO.state.setRule),
    hitText:document.querySelector('.rule-hit').textContent.replace(/\\s+/g,' ').trim(),
    hint:document.querySelector('.rule-box .hint').textContent.replace(/\\s+/g,' ').trim(),
    who:!!document.querySelector('.who-pick'),
    init:!!document.querySelector('[data-init]')
  }))()`);
  ok(dy.kind === "dynamic" && dy.fields === 6 && dy.selects.length === 5 && dy.kw,
    "动态分组规则编辑器 6 个条件（5 下拉 + 关键词）：" + dy.selects.join("/") + "/rule.q");
  ok(dy.flags.join(",") === "moduleSub,searchWide,bug,regression", "规则开关 4 项：" + dy.flags.join("/"));
  ok(dy.regression && dy.hits === dy.realHits && dy.hits > 0, "一键回归集默认开启，命中 " + dy.hits + " 条与数据同源");
  ok(/2000/.test(dy.hitText) && /创建人/.test(dy.hint) && /不能手工增删/.test(dy.hint), "明示上限 2000 / 创建人口径 / 禁止手工增删");
  ok(!dy.who && !dy.init, "动态类型下不显示成员名单与初始成员（互斥）");
  await shot("f-dynamic-dialog-1440", false);

  /* 真实点击：回归 → 叠加 P0 → 命中数随之变化；切手工后规则区消失 */
  await ev(`(() => { const s = document.querySelector('[data-ctl="rule.pri"]'); s.value = 'P0';
    s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  const dy2 = await ev(`(() => ({ hits:Number(document.querySelector('.rule-hit b').textContent),
    realHits:PROTO.ruleHits(PROTO.state.setRule), pri:PROTO.state.setRule.pri }))()`);
  ok(dy2.pri === "P0" && dy2.hits === dy2.realHits && dy2.hits < dy.hits, "叠加 P0 后命中收窄：" + dy.hits + " → " + dy2.hits);
  await click('[data-kind="manual"]');
  ok(await ev("!document.querySelector('.rule-box') && !!document.querySelector('[data-init]')"), "切到手工挑选：规则区换成初始成员");
  await click('[data-kind="dynamic"]');
  ok(await ev("!!document.querySelector('.rule-box')"), "切回动态收录：规则区恢复");

  /* 空规则拦截提示 */
  await ev(`(() => { PROTO.state.setRule = { status:'all', pri:'all', module:'all', moduleSub:true, demand:'all',
    owner:'all', q:'', searchWide:false, bug:false, regression:false }; PROTO.render(); return true; })()`);
  ok(await ev("/至少要有一个条件/.test(document.querySelector('.rule-hit').textContent)"), "空规则给出「至少要有一个条件」提示");

  /* 指定成员可见 */
  await go("view=sets&forced=newsetmembers", 1440, 1000, false);
  const mm = await ev(`(() => ({
    vis:PROTO.state.setVis,
    rows:document.querySelectorAll('.who-row').length,
    on:document.querySelectorAll('.who-row.on').length,
    hint:document.querySelector('.who-pick .hint').textContent.replace(/\\s+/g,' ').trim(),
    names:[...document.querySelectorAll('.who-row.on .who-name')].map(n => n.textContent),
    roles:[...document.querySelectorAll('.who-role')].map(n => n.textContent).slice(0,2),
    rule:!!document.querySelector('.rule-box')
  }))()`);
  ok(mm.vis === "members" && mm.rows === 6 && mm.on === 3, "指定成员名单 6 位候选、已选 3 位：" + mm.names.join("/"));
  ok(/已选3\/50人/.test(mm.hint.replace(/\s/g,'')) && /创建人始终可见/.test(mm.hint), "名单上限与创建人口径：" + mm.hint);
  ok(mm.roles.length === 2 && mm.roles.every(r => r.length > 0), "候选带岗位，便于同名区分：" + mm.roles.join("/"));
  await shot("f-members-dialog-1440", false);
  await ev(`(() => { const el = document.querySelector('[data-ctl="memberQ"]');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,'测试');
    el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(400);
  const mq = await ev(`(() => ({ rows:document.querySelectorAll('.who-row').length,
    on:document.querySelectorAll('.who-row.on').length,
    picked:Object.keys(PROTO.state.setWho).filter(k => PROTO.state.setWho[k]).length }))()`);
  ok(mq.rows === 3 && mq.picked === 3, "搜索「测试」收敛到 3 位候选，已选 3 人不因过滤丢失（可见 " + mq.on + "）");
  await click('[data-who="u1"]');
  ok(await ev("PROTO.state.setWho.u1 === true && document.querySelectorAll('.who-row.on').length === 3"), "点击候选即加入名单");

  /* 编辑既有动态分组：预填名称 / 类型 / 规则 */
  await go("view=sets&set=s4&forced=editset", 1440, 1000, false);
  const ed = await ev(`(() => ({
    title:document.querySelector('.modal-title').textContent,
    name:document.querySelector('#setName').value,
    kind:PROTO.state.setKind, regression:PROTO.state.setRule.regression,
    foot:[...document.querySelectorAll('.modal-footer .btn')].map(b => b.textContent.trim())
  }))()`);
  ok(/编辑分组/.test(ed.title) && ed.name === "本轮必测", "编辑弹层预填分组名：" + ed.title);
  ok(ed.kind === "dynamic" && ed.regression && ed.foot.includes("保存分组"), "预填动态类型与回归规则，主按钮为保存分组");

  /* 分组详情：动态 vs 指定成员 */
  await go("view=sets&set=s4", 1440, 1000, false);
  const sd = await ev(`(() => ({
    chips:[...document.querySelectorAll('.rule-chip')].map(c => c.textContent.replace(/\\s+/g,' ').trim()),
    foot:document.querySelector('.rule-foot') ? document.querySelector('.rule-foot').textContent.replace(/\\s+/g,' ').trim() : null,
    edit:!!document.querySelector('[data-pop="editset"]'),
    draggable:document.querySelectorAll('.card .case-row[draggable="true"]').length,
    dynTag:!!document.querySelector('.set-detail-head .vis-dyn')
  }))()`);
  ok(sd.chips.some(c => /回归/.test(c)) && sd.chips.some(c => /自动收录/.test(c)), "详情显示回归规则与自愈语义：" + sd.chips.join(" | "));
  ok(sd.foot && /不能手工增删/.test(sd.foot) && /2000/.test(sd.foot), "动态分组给出禁止手工增删与上限提示");
  ok(sd.edit && sd.draggable === 0 && sd.dynTag, "动态分组：编辑规则入口 + 行不可拖入 + 动态标记");
  await shot("f-set-dynamic-1440", true);

  await go("view=sets&set=s6", 1440, 1000, false);
  const sn = await ev(`(() => ({
    tag:document.querySelector('.set-detail-head .vis-tag').textContent,
    who:[...document.querySelectorAll('.who-chip')].map(c => c.textContent.trim()),
    n:document.querySelector('.who-n').textContent.replace(/\\s+/g,' ').trim(),
    labels:[...document.querySelectorAll('.set-group-label')].map(l => l.textContent.trim()),
    draggable:document.querySelectorAll('.card .case-row[draggable="true"]').length
  }))()`);
  ok(sn.tag === "指定成员可见" && sn.who.length === 3 && /共4人/.test(sn.n.replace(/\s/g,'')), "指定成员分组显示名单与人数：" + sn.who.join("/"));
  ok(sn.labels.length === 3 && sn.labels.some(l => /指定成员/.test(l)) && sn.labels.some(l => /进交付说明与发布证据/.test(l)),
    "侧栏三档可见范围分段，并标明只有团队共享进证据");
  ok(sn.draggable > 0, "手工分组仍可行拖入加入");
  await shot("f-set-members-1440", true);

  /* 圈选入计划：同时保存为动态分组 */
  await go("view=plan&module=m3", 1440, 1000, false);
  const pd = await ev(`(() => ({
    on:!!document.querySelector('[data-dynamic].on'),
    name:document.querySelector('#planSetName') ? document.querySelector('#planSetName').value : null,
    hint:[...document.querySelectorAll('.pick-side .hint')].map(h => h.textContent.replace(/\\s+/g,' ').trim()),
    label:document.querySelector('[data-dynamic]').textContent.replace(/\\s+/g,' ').trim()
  }))()`);
  ok(pd.on && !!pd.name, "圈选页默认勾选「同时保存为动态分组」并给出名称输入：" + pd.name);
  ok(!/批次 C/.test(pd.label) && /自动进入/.test(pd.label), "选项文案去掉「批次 C 可先不做」：" + pd.label.slice(0, 46));
  ok(pd.hint.some(h => /规则 =/.test(h) && /团队共享/.test(h)), "明示规则来源与可见范围固定为团队共享");
  await shot("f-plan-dynamic-1440", true);
  await go("view=plan&module=m3&forced=planconfirm", 1440, 1000, false);
  ok(await ev(`[...document.querySelectorAll('.modal .kv')].some(k => /动态分组/.test(k.textContent) && /自动收录/.test(k.textContent))`),
    "确认弹层明示同时创建动态分组，且计划内已有用例不受规则影响");
  await shot("f-plan-confirm-dynamic-1440", false);

  /* 1440 单行筛选条 + 统计卡即筛选 chips */
  await go("view=list", 1440, 1000, false);
  const sr = await ev(`(() => ({
    wrap:getComputedStyle(document.querySelector('.tc-bar')).flexWrap,
    stripWrap:getComputedStyle(document.querySelector('.stat-strip')).flexWrap,
    chips:[...document.querySelectorAll('.stat-strip [data-status]')].map(b => b.tagName + ':' + b.dataset.status),
    hint:document.querySelector('.stat-strip .muted').textContent.trim(),
    seg:!!document.querySelector('#tcStatusSeg'),
    sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth,
    barH:Math.round(document.querySelector('.tc-bar').getBoundingClientRect().height)
  }))()`);
  ok(sr.wrap === "nowrap" && sr.stripWrap === "nowrap", "1440 筛选条与统计条单行不换行");
  ok(sr.chips.length === 6 && sr.chips.every(c => c.indexOf("BUTTON:") === 0), "统计卡即筛选按钮 6 个：" + sr.chips.join("/"));
  ok(/点计数即筛选/.test(sr.hint) && !sr.seg, "统计条带口径提示，且不再另设结果分段控件");
  ok(sr.sw <= sr.cw + 1 && sr.barH <= 48, "单行后无横向溢出，筛选条高度 " + sr.barH + "px");
  await shot("f-list-single-row-1440", false);
  await click('.stat-strip [data-status="failed"]');
  ok(await ev("PROTO.state.status === 'failed' && document.querySelector('.stat-strip [data-status=\"failed\"]').classList.contains('on')"),
    "点统计卡即筛选，并呈选中态");

  /* 窄屏：弹层与名单不溢出 */
  await go("view=sets&forced=newsetdynamic&loaded=8", 390, 844, true);
  const mdy = await overflow();
  ok(mdy.sw <= mdy.cw + 1, "动态分组弹层 390px 无横向溢出");
  ok(await ev("getComputedStyle(document.querySelector('.rule-grid')).gridTemplateColumns.split(' ').length === 1"),
    "390px 规则条件单列堆叠");
  await shot("f-dynamic-dialog-390", true);
  await go("view=sets&forced=newsetmembers&loaded=8", 390, 844, true);
  const mmm = await overflow();
  ok(mmm.sw <= mmm.cw + 1, "指定成员弹层 390px 无横向溢出");
  await shot("f-members-dialog-390", true);

  /* ---------- 控制台 ---------- */
  ok(cdp.errors.length === 0, "控制台无报错（" + cdp.errors.length + "）");
  if(cdp.errors.length) console.log(cdp.errors.slice(0,8).join("\n"));

  console.log("\n结果：PASS " + passed + " / FAIL " + failed + "；截图 " + fs.readdirSync(SHOT_DIR).filter(f => f.endsWith(".png")).length + " 张 → " + SHOT_DIR);
  process.exitCode = failed ? 1 : 0;
}catch(err){
  console.error("脚本异常：" + (err && err.stack || err));
  process.exitCode = 1;
}finally{
  try{ proc.kill(); }catch(e){}
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
}