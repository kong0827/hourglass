/* 周回顾原型 v3 · 真实浏览器走查与截图
   用法：node tools/e2e/weekly-review-proto.mjs
   只读原型文件，不改应用代码；截图输出到 docs/audit/weekly-review-2026-11-20/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/weekly-review-2026-11-20/prototype.html")).href;
const SHOT_DIR = path.resolve("docs/audit/weekly-review-2026-11-20");
const PREFIX = "proto-";

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
  constructor(ws){
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data));
  }
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
    const id = ++this.id;
    const p = { id, method, params };
    if(sessionId) p.sessionId = sessionId;
    this.ws.send(JSON.stringify(p));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-review-proto-"));
const port = 9237;
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1460,1000", "--disable-dev-shm-usage", "--hide-scrollbars",
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
  const viewport = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width:w, height:h, deviceScaleFactor:1, mobile:!!mobile });
  let CW = 1440, CH = 1000, CM = false;
  const setVP = async (w, h, m = false) => { CW = w; CH = h; CM = !!m; await viewport(w, h, m); await sleep(160); };
  const shot = async (name, full) => {
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
      const t = document.querySelector('.toast'); if(t) t.style.visibility = 'hidden'; return true; })()`);
    if(full){
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await viewport(CW, Math.min(h + 20, 12000), CM);
      await sleep(200);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
    if(full){ await viewport(CW, CH, CM); await sleep(150); }
    await ev(`(() => { const t = document.querySelector('.toast'); if(t) t.style.visibility = ''; return true; })()`);
  };
  const go = async hash => {
    await call("Page.navigate", { url:FILE + "?s=" + hash + "#" + hash });
    await wait("!!document.querySelector('.scopebar')", "原型加载 " + (hash || "team"));
    await sleep(260);
  };

  console.log("周回顾原型 v3 走查\n  " + FILE);
  await setVP(1440, 1000);

  /* ---------- 团队视图 ---------- */
  await go("team");
  const team = await ev(`(() => ({
    sw: document.documentElement.scrollWidth,
    tabs: document.querySelectorAll('.scopebar [role=tab]').length,
    tabSelected: (document.querySelector('.scopebar [role=tab][aria-selected=true]') || {}).textContent,
    statRows: [...document.querySelectorAll('#statCard .stat-tbl tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent.replace(/\\s+/g, ' ').trim())),
    statHead: [...document.querySelectorAll('#statCard .stat-tbl thead th')].map(n => n.textContent.trim()),
    compRows: document.querySelectorAll('#compCard .item').length,
    releases: document.querySelectorAll('details.rel').length,
    planKpis: [...document.querySelectorAll('.plan-kpis b')].map(n => n.textContent.trim()),
    memberRows: document.querySelectorAll('.member-tbl tbody tr').length,
    totals: [...document.querySelectorAll('.member-tbl tfoot td')].map(n => n.textContent.trim()),
    memberCols: [...document.querySelectorAll('.member-tbl thead th')].map(n => n.textContent.trim()),
    qualityKpis: document.querySelectorAll('#qualityCard .qkpis>div').length,
    qualityMembers: document.querySelectorAll('#qualityCard .qmem-row').length,
    qualityBars: [...document.querySelectorAll('#qualityCard .qbar i')].map(n => n.style.width),
    docKpis: [...document.querySelectorAll('#docCard .kpis b')].map(n => n.textContent.trim()),
    docMembers: document.querySelectorAll('#docMem .qmem-row').length,
    projectRows: document.querySelectorAll('.proj-tbl tbody tr').length,
    sameNameDup: (() => {
      const names = [...document.querySelectorAll('.member-tbl tbody tr td:first-child')].map(n => n.textContent.trim());
      return names.length !== new Set(names).size;
    })(),
    brief: document.querySelector('#briefTeam').textContent.replace(/\\s+/g, ' ').trim().slice(0, 100)
  }))()`);
  ok(team.sw === 1440, "团队视图无横向溢出（scrollWidth=" + team.sw + "）");
  ok(team.tabs === 2 && /团队/.test(team.tabSelected), "范围两档且默认团队");
  ok(team.statHead.join("/") === "对象/本周新增/本周流转/本周完成/本周退出 / 异常", "统计表四段式表头（" + team.statHead.join("/") + "）");
  const statWork = team.statRows[1].join(" | ");
  ok(/38/.test(statWork) && /41 次/.test(statWork) && /31 项/.test(statWork) && /23/.test(statWork) && /取消 3/.test(statWork), "工作项行 新增 38 / 流转 41 次 31 项 / 完成 23 / 取消 3");
  const statReq = team.statRows[0].join(" | ");
  ok(/12/.test(statReq) && /8 评审通过/.test(statReq) && /7 开始排期/.test(statReq) && /9 完成/.test(statReq) && /6 发布覆盖/.test(statReq) && /关闭 2/.test(statReq) && /取消 1/.test(statReq), "需求行 12/8/7/9/6 · 关闭 2 取消 1");
  const statTest = team.statRows[2].join(" | ");
  ok(/14/.test(statTest) && /128 条/.test(statTest) && /82%/.test(statTest) && /7 修复关闭/.test(statTest), "测试行 新增 14 / 执行 128 / 通过率 82% / 修复 7");
  const statDoc = team.statRows[3].join(" | ");
  ok(/7/.test(statDoc) && /12 次/.test(statDoc) && /5 篇/.test(statDoc) && /草稿积压 3/.test(statDoc), "文档行 7/12/5 · 草稿 3");
  ok(team.compRows === 6, "本周完成列出 6 项（实际 " + team.compRows + "）");
  ok(team.releases === 2, "本周发布 2 条（实际 " + team.releases + "）");
  ok(team.planKpis.join("/") === "3/2/1/0", "发布计划 3 个 / 完成 2 / 超期 1 / 回滚 0（实际 " + team.planKpis.join("/") + "）");
  ok(team.memberRows === 8, "成员工作量 8 行（实际 " + team.memberRows + "）");
  ok(team.projectRows === 4, "项目推进 4 行（实际 " + team.projectRows + "）");
  ok(!team.sameNameDup, "成员不重名");
  ok(/上周团队新增 38 个工作项/.test(team.brief), "页头结论句与数据一致");
  ok(team.memberCols.includes("测试") && team.memberCols.includes("新增") && team.memberCols.includes("推进"), "成员表有新增 / 推进 / 测试列");
  ok(team.totals.includes("128 / 9"), "测试合计 128 条用例 / 9 个缺陷（" + team.totals[9] + "）");
  ok(team.totals.includes("38") && team.totals.includes("19"), "成员合计 新增 38 / 文档 19");
  ok(team.qualityKpis === 6 && team.qualityMembers === 3, "测试与质量卡 6 个指标 / 3 位参与成员");
  ok(team.qualityBars.join("/") === "82%/11%/7%", "执行结果比例 82/11/7（" + team.qualityBars.join("/") + "）");
  ok(team.docKpis.join("/") === "7/12/5/3", "文档 新增 7 / 更新 12 / 发布 5 / 草稿 3（实际 " + team.docKpis.join("/") + "）");
  ok(team.docMembers === 6, "文档贡献成员 6 人（实际 " + team.docMembers + "）");
  await shot("team-1440-v3");
  await shot("team-full-1440-v3", true);
  await ev(`window.scrollTo(0, document.querySelector('#statCard').offsetTop - 56)`);
  await sleep(160);
  await shot("team-stats-1440-v3");
  await ev(`window.scrollTo(0, document.querySelector('#docCard').offsetTop - 56)`);
  await sleep(160);
  await shot("team-docs-1440-v3");
  await ev(`window.scrollTo(0,0)`);

  /* 统计矩阵子项就地展开 */
  await ev(`window.scrollTo(0, document.querySelector('#statCard').offsetTop - 56)`);
  await sleep(140);
  await ev(`document.querySelector('[data-detail="wi-doing"]').click()`);
  await sleep(120);
  const det1 = await ev(`(() => {
    const rows = document.querySelectorAll('#statCard tr.stat-detail');
    const r = rows[0], b = document.querySelector('[data-detail="wi-doing"]');
    return {
      rows: rows.length,
      title: r ? r.querySelector('.sd-title b').textContent.trim() : '',
      hint: r ? r.querySelector('.sd-title span').textContent.trim() : '',
      items: r ? r.querySelectorAll('.sd-list li').length : 0,
      first: r ? r.querySelector('.sd-list li .sd-main span').textContent.trim() : '',
      aria: b.getAttribute('aria-expanded'),
      controls: b.getAttribute('aria-controls'),
      id: r ? r.id : '',
      colspan: r ? r.querySelector('td').getAttribute('colspan') : '',
      note: r ? r.querySelector('.sd-note').textContent.trim() : '',
      more: !!(r && r.querySelector('[data-detail-more]')),
      sw: document.documentElement.scrollWidth
    };
  })()`);
  ok(det1.rows === 1 && det1.title === "进入处理中 · 22 个工作项" && det1.items === 8, "「22 进入处理中」展开 1 行明细 / 8 条示例（实际 " + det1.rows + " 行 / " + det1.items + " 条）");
  ok(det1.aria === "true" && det1.controls === det1.id && det1.id === "stat-detail-wi-doing" && det1.colspan === "5", "展开按钮 aria-expanded/aria-controls 指向明细行，跨 5 列");
  ok(/示例明细，显示前 8 项 \/ 共 22 个工作项/.test(det1.note) && det1.more, "明细标注示例与前 N 项，并提供查看全部");
  ok(/待处理 → 进行中/.test(det1.first), "明细条目给出流转前后状态（" + det1.first + "）");
  ok(det1.sw === 1440, "展开后 1440 无横向溢出（scrollWidth=" + det1.sw + "）");
  await shot("team-detail-doing-1440-v3");

  await ev(`document.querySelector('[data-detail="test-fixed"]').click()`);
  await sleep(120);
  const det2 = await ev(`(() => {
    const rows = document.querySelectorAll('#statCard tr.stat-detail');
    const r = rows[0];
    return {
      rows: rows.length,
      title: r ? r.querySelector('.sd-title b').textContent.trim() : '',
      items: r ? r.querySelectorAll('.sd-list li').length : 0,
      types: [...new Set([...document.querySelectorAll('#statCard tr.stat-detail .sd-ty')].map(n => n.textContent.trim()))],
      prevClosed: document.querySelector('[data-detail="wi-doing"]').getAttribute('aria-expanded'),
      curOpen: document.querySelector('[data-detail="test-fixed"]').getAttribute('aria-expanded'),
      note: r ? r.querySelector('.sd-note').textContent.trim() : ''
    };
  })()`);
  ok(det2.rows === 1 && det2.title === "修复关闭 · 7 个缺陷" && det2.items === 7, "切到「7 修复关闭」只保留 1 行明细 / 7 条（实际 " + det2.rows + " 行 / " + det2.items + " 条）");
  ok(det2.types.join("/") === "缺陷" && det2.prevClosed === "false" && det2.curOpen === "true", "同时只展开一项，类型标签为缺陷");
  ok(/共 7 个缺陷，已全部显示/.test(det2.note), "修复关闭 7 条全部显示并注明");
  await shot("team-detail-fixed-1440-v3");

  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  await sleep(100);
  const detEsc = await ev(`(() => ({
    rows: document.querySelectorAll('#statCard tr.stat-detail').length,
    open: [...document.querySelectorAll('.stat-sub[aria-expanded=true], .stat-big[aria-expanded=true]')].length
  }))()`);
  ok(detEsc.rows === 0 && detEsc.open === 0, "Esc 收起明细并复位 aria 状态");

  await ev(`document.querySelector('[data-detail="dem-created"]').click()`);
  await sleep(80);
  const detBig = await ev(`(() => {
    const r = document.querySelector('#statCard tr.stat-detail');
    return {
      title: r ? r.querySelector('.sd-title b').textContent.trim() : '',
      items: r ? r.querySelectorAll('.sd-list li').length : 0,
      open: document.querySelector('[data-detail="dem-created"]').getAttribute('aria-expanded')
    };
  })()`);
  ok(detBig.title === "本周新增 · 12 个需求" && detBig.items === 6 && detBig.open === "true", "大数字同样可展开（本周新增 12 个需求 / 6 条示例）");
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  await sleep(80);

  await ev(`document.querySelector('[data-detail="wi-doing"]').click()`);
  await sleep(80);
  await ev(`document.querySelector('.scopebar [data-scope="me"]').click()`);
  await sleep(120);
  const detScope = await ev(`document.querySelectorAll('#statCard tr.stat-detail').length`);
  await ev(`document.querySelector('.scopebar [data-scope="team"]').click()`);
  await sleep(160);
  const detBack = await ev(`document.querySelectorAll('#statCard tr.stat-detail').length`);
  ok(detScope === 0 && detBack === 0, "切换团队 / 我 自动收起明细（离开 " + detScope + " / 返回 " + detBack + "）");

  /* 成员筛选 */
  await ev(`document.querySelector('[data-mfilter="over"]').click()`);
  const over = await ev(`([...document.querySelectorAll('.member-tbl tbody tr')].filter(r => !r.hidden).length)`);
  ok(over === 2, "「超载」筛选出 2 人（实际 " + over + "）");
  await ev(`document.querySelector('[data-mfilter="none"]').click()`);
  const none = await ev(`([...document.querySelectorAll('.member-tbl tbody tr')].filter(r => !r.hidden).length)`);
  ok(none === 2, "「未登记」筛选出 2 人（实际 " + none + "）");
  await ev(`document.querySelector('[data-mfilter="all"]').click()`);

  /* 角色筛选 */
  const setRole = async v => {
    await ev(`(() => { const s = document.querySelector('#roleSel'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(80);
  };
  await setRole("test");
  const roleTest = await ev(`(() => ({
    shown: [...document.querySelectorAll('.member-tbl tbody tr')].filter(r => !r.hidden).map(r => r.dataset.member),
    hint: document.querySelector('#memberHint').textContent.trim(),
    total: document.querySelector('#tfTest').textContent.trim(),
    qmem: [...document.querySelectorAll('#qualityCard .qmem-row')].filter(r => !r.hidden).map(r => r.querySelector('b').textContent),
    qempty: !document.querySelector('#qmemEmpty').hidden,
    dmem: [...document.querySelectorAll('#docMem .qmem-row')].filter(r => !r.hidden).map(r => r.querySelector('b').textContent),
    dempty: !document.querySelector('#docEmpty').hidden
  }))()`);
  ok(roleTest.shown.join("/") === "周媛", "角色=测试只剩 1 人（" + roleTest.shown.join("/") + "）");
  ok(/1 人 · 新增 4 · 完成 2 · 登记 38h \/ 容量 40h/.test(roleTest.hint), "角色筛选重算人数、新增、完成与容量（" + roleTest.hint + "）");
  ok(roleTest.total === "86 / 6", "角色筛选重算测试列（" + roleTest.total + "）");
  ok(roleTest.qmem.join("/") === "周媛" && !roleTest.qempty, "测试卡成员按角色收敛");
  ok(roleTest.dmem.join("/") === "周媛" && !roleTest.dempty, "文档卡成员按角色收敛");
  await setRole("design");
  const roleDesign = await ev(`(() => ({
    total: document.querySelector('#tfTest').textContent.trim(),
    qempty: !document.querySelector('#qmemEmpty').hidden,
    dempty: !document.querySelector('#docEmpty').hidden,
    hours: document.querySelector('#tfHours').textContent.trim()
  }))()`);
  ok(roleDesign.total === "—" && roleDesign.qempty, "设计角色无测试参与时显示「—」与空说明");
  ok(roleDesign.dempty, "设计角色无文档动作时显示空说明");
  await shot("member-role-design-1440-v3");
  await setRole("all");

  /* 抽屉 */
  await ev(`document.querySelectorAll('.member-tbl tbody tr')[0].click()`);
  await wait("!document.querySelector('#overlay').hidden", "成员抽屉打开");
  const drawer = await ev(`(() => ({
    name: document.querySelector('#drawerName').textContent.trim(),
    role: document.querySelector('#drawerRole').textContent.trim(),
    kpis: document.querySelectorAll('.drawer .dkpis>div').length,
    testShown: !document.querySelector('#drawerTest').hidden,
    handShown: !document.querySelector('#drawerHand').hidden,
    hand: document.querySelector('#drawerHand').textContent.replace(/\\s+/g, ' ').trim(),
    bodyLocked: document.body.style.overflow === 'hidden'
  }))()`);
  ok(/王一帆/.test(drawer.name), "抽屉打开对应成员（" + drawer.name + "）");
  ok(drawer.kpis === 6, "抽屉 KPI 6 格（新增 / 完成 / 推进 / 在手 / 工时 / 负载）");
  ok(!drawer.testShown, "不参与测试的成员不显示测试块");
  ok(drawer.handShown && /文档 6 次/.test(drawer.hand), "抽屉显示本周经手（" + drawer.hand + "）");
  ok(drawer.bodyLocked, "抽屉打开时锁定背景滚动");
  await shot("member-1440-v3");
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  ok(await ev("document.querySelector('#overlay').hidden"), "Esc 关闭抽屉");

  await ev(`document.querySelectorAll('.member-tbl tbody tr')[2].click()`);
  await wait("!document.querySelector('#overlay').hidden", "测试成员抽屉打开");
  const drawerT = await ev(`(() => ({
    name: document.querySelector('#drawerName').textContent.trim(),
    testShown: !document.querySelector('#drawerTest').hidden,
    text: document.querySelector('#drawerTest').textContent.replace(/\\s+/g, ' ').trim()
  }))()`);
  ok(/周媛/.test(drawerT.name) && drawerT.testShown && /86 条用例/.test(drawerT.text), "测试成员抽屉显示执行量与缺陷");
  const drawerTHand = await ev(`document.querySelector('#drawerHand').textContent.replace(/\\s+/g, ' ').trim()`);
  ok(/新增用例 9 条/.test(drawerTHand), "测试成员经手含新增用例（" + drawerTHand + "）");
  await shot("member-test-1440-v3");
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);

  /* ---------- 个人视图 ---------- */
  await go("me");
  const me = await ev(`(() => ({
    sw: document.documentElement.scrollWidth,
    visible: !document.querySelector('#meView').hidden && document.querySelector('#teamView').hidden,
    kpis: document.querySelectorAll('#meView .me-kpis>div').length,
    doneRows: document.querySelectorAll('#meView .item').length,
    types: [...document.querySelectorAll('#meView .im .ty')].map(n => n.textContent.trim()),
    hand: document.querySelector('#meView .hand').textContent.replace(/\\s+/g, ' ').trim(),
    docRows: document.querySelectorAll('#meDocCard .demand').length,
    testCard: (() => {
      const c = [...document.querySelectorAll('#meView .card')].find(x => /我的角色/.test(x.textContent));
      return c ? { kpis: c.querySelectorAll('.qkpis>div').length, role: c.querySelector('.hint').textContent.trim(),
        rows: c.querySelectorAll('.item').length } : null;
    })(),
    brief: document.querySelector('#briefMe').textContent.replace(/\\s+/g, ' ').trim().slice(0, 140),
    tab: (document.querySelector('.scopebar [role=tab][aria-selected=true]') || {}).textContent,
    roleHidden: document.querySelector('#roleWrap').hidden
  }))()`);
  ok(me.visible && /我/.test(me.tab), "范围切到「我」且只显示个人视图");
  ok(me.roleHidden, "个人视图隐藏成员角色筛选");
  ok(me.sw === 1440, "个人视图无横向溢出（scrollWidth=" + me.sw + "）");
  ok(me.kpis >= 6, "个人 KPI " + me.kpis + " 格（≥6）");
  ok(me.types.join("/") === "任务/任务/故事/故事", "个人完成列表标注类型（" + me.types.join("/") + "）");
  ok(/复测 2 条/.test(me.hand) && /更新文档 3 次/.test(me.hand), "个人「本周经手」覆盖复测与文档（" + me.hand + "）");
  ok(me.docRows === 3, "个人文档卡 3 行（实际 " + me.docRows + "）");
  ok(/复测 2 条/.test(me.brief), "个人结论句与经手一致");
  ok(me.testCard && me.testCard.kpis === 4 && me.testCard.rows === 3, "个人测试卡 4 指标 / 3 条明细");
  ok(me.testCard && /负责人/.test(me.testCard.role), "个人测试卡标注角色（" + (me.testCard && me.testCard.role) + "）");
  await shot("me-1440-v3");
  await shot("me-full-1440-v3", true);
  await ev(`window.scrollTo(0, document.querySelector('#meDocCard').offsetTop - 56)`);
  await sleep(160);
  await shot("me-docs-1440-v3");
  await ev(`window.scrollTo(0,0)`);

  /* 切回团队 */
  await ev(`document.querySelector('.scopebar [role=tab][data-scope="team"]').click()`);
  ok(await ev("!document.querySelector('#teamView').hidden && document.querySelector('#meView').hidden"), "页签切回团队");
  ok(await ev("!document.querySelector('#roleWrap').hidden"), "团队视图恢复角色筛选");

  /* ---------- 空态 / 错误态 ---------- */
  await go("empty");
  const empty = await ev(`(() => ({
    shown: !document.querySelector('#stateEmpty').hidden,
    teamHidden: document.querySelector('#teamView').hidden && document.querySelector('#briefTeam').hidden,
    actions: document.querySelectorAll('#stateEmpty .btn').length,
    title: (document.querySelector('#stateEmpty h3') || {}).textContent
  }))()`);
  ok(empty.shown && empty.teamHidden, "空态替换团队正文与结论条");
  ok(empty.actions >= 2, "空态给出 " + empty.actions + " 个动作");
  ok(await ev("document.querySelector('.phead-act .primary').disabled"), "空态禁用「复制周报」");
  await shot("empty-1440-v3");

  await go("error");
  const err = await ev(`(() => ({
    shown: !document.querySelector('#stateError').hidden,
    actions: document.querySelectorAll('#stateError .btn').length,
    code: (document.querySelector('#stateError .err-meta') || {}).textContent
  }))()`);
  ok(err.shown, "错误态显示");
  ok(err.actions >= 2, "错误态给出重试与另一条路径");
  ok(await ev("document.querySelector('.phead-act .btn').disabled"), "错误态禁用导出");
  await shot("error-1440-v3");

  /* 错误态「看我的回顾」 */
  await ev(`document.querySelector('#stateError [data-scope="me"]').click()`);
  ok(await ev("!document.querySelector('#meView').hidden && document.querySelector('#stateError').hidden"), "错误态「看我的回顾」切到个人视图");

  /* ---------- 窄屏 390（降级） ---------- */
  await setVP(390, 844, true);
  await go("team");
  const m390 = await ev(`(() => ({
    sw: document.documentElement.scrollWidth,
    sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
    statBlock: getComputedStyle(document.querySelector('.stat-tbl tbody')).display,
    statCols: getComputedStyle(document.querySelector('.stat-tbl tbody tr')).gridTemplateColumns,
    kpis: getComputedStyle(document.querySelector('.kpis')).gridTemplateColumns,
    riskCols: getComputedStyle(document.querySelector('.risk-grid')).gridTemplateColumns,
    briefDir: getComputedStyle(document.querySelector('.brief')).flexDirection,
    scRight: getComputedStyle(document.querySelector('.scopebar-right')).display,
    qcols: getComputedStyle(document.querySelector('#qualityCard .qkpis')).gridTemplateColumns,
    pcols: getComputedStyle(document.querySelector('.plan-kpis')).gridTemplateColumns
  }))()`);
  ok(m390.sw === 390, "390 团队视图无横向溢出（scrollWidth=" + m390.sw + "）");
  ok(m390.sidebar === "none", "390 收起侧栏");
  ok(m390.statBlock === "block" && m390.statCols.split(" ").length === 2, "390 统计矩阵转块、两列展开");
  ok(m390.qcols.split(" ").length === 2, "390 质量 6 指标两列换行");
  ok(m390.pcols.split(" ").length === 2, "390 发布计划 4 指标两列换行");
  await ev(`document.querySelector('[data-detail="test-fixed"]').click()`);
  await sleep(100);
  await ev(`(() => { const r = document.querySelector('#statCard tr.stat-detail'); window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - 58); return true; })()`);
  await sleep(140);
  const mdet = await ev(`(() => {
    const r = document.querySelector('#statCard tr.stat-detail');
    return {
      sw: document.documentElement.scrollWidth,
      items: r ? r.querySelectorAll('.sd-list li').length : 0,
      rowDisplay: r ? getComputedStyle(r).display : '',
      cellDisplay: r ? getComputedStyle(r.querySelector('td')).display : '',
      liCols: r ? getComputedStyle(r.querySelector('.sd-list li')).gridTemplateColumns.split(" ").length : 0,
      wrap: r ? getComputedStyle(r.querySelector('.sd-main b')).whiteSpace : ''
    };
  })()`);
  ok(mdet.sw === 390 && mdet.items === 7, "390 展开明细无横向溢出（scrollWidth=" + mdet.sw + "）");
  ok(mdet.rowDisplay === "block" && mdet.cellDisplay === "block" && mdet.liCols === 2 && mdet.wrap === "normal", "390 明细行转块、条目两栏、标题换行");
  await shot("team-detail-390-v3");
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }))`);
  await sleep(80);
  await ev(`window.scrollTo(0,0)`);
  await sleep(80);
  await shot("team-390-v3");
  await shot("team-full-390-v3", true);
  await go("me");
  ok(await ev("document.documentElement.scrollWidth") === 390, "390 个人视图无横向溢出");
  await shot("me-390-v3");
  await shot("me-full-390-v3", true);
  await setVP(1440, 1000);

  ok(cdp.errors.length === 0, "无控制台错误" + (cdp.errors.length ? "：" + cdp.errors.join(" | ") : ""));

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if(failed) process.exitCode = 1;
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
}
