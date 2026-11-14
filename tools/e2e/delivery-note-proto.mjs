/* 一页式交付说明原型 v2 · 真实浏览器交互验证与截图
   用法：node tools/e2e/delivery-note-proto.mjs
   只读原型文件，不改应用代码；产出 1440 / 390 截图到 docs/audit/prototypes/。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILE = pathToFileURL(path.resolve("docs/audit/prototypes/delivery-note-v2-2026-11-13.html")).href;
const SHOT_DIR = path.resolve("docs/audit/prototypes");
const PREFIX = "proto-delivery-v2-";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-proto-"));
const dlDir = path.join(tmp, "dl");
fs.mkdirSync(dlDir, { recursive:true });
const port = 9231;
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
  await cdp.send("Browser.setDownloadBehavior", { behavior:"allow", downloadPath:dlDir, eventsEnabled:true });
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
  const viewport = (w, h, mobile) => call("Emulation.setDeviceMetricsOverride",
    { width:w, height:h, deviceScaleFactor:mobile ? 2 : 1, mobile:!!mobile });
  const shot = async (name, full) => {
    // 截图前结束入场动画并临时隐藏瞬时 toast，避免拍到半透明中间态
    await ev(`(() => { document.getAnimations().forEach(a => { try{ a.finish(); }catch(e){} });
      const t = document.querySelector('.toast'); if(t) t.style.visibility = 'hidden'; return true; })()`);
    if(full){
      const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
      await viewport(lastW, Math.min(h + 20, 12000), lastMobile);
      await sleep(220);
    }
    const r = await call("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:!!full });
    fs.writeFileSync(path.join(SHOT_DIR, PREFIX + name + ".png"), Buffer.from(r.data, "base64"));
    console.log("  SHOT " + PREFIX + name + ".png");
    if(full){ await viewport(lastW, lastH, lastMobile); await sleep(180); }
    await ev(`(() => { const t = document.querySelector('.toast'); if(t) t.style.visibility = ''; return true; })()`);
  };
  let lastW = 1440, lastH = 1000, lastMobile = false;
  const setVP = async (w, h, m) => { lastW = w; lastH = h; lastMobile = !!m; await viewport(w, h, m); await sleep(200); };
  const wmHits = () => ev(`(() => {
    const el0 = document.querySelector('.doc-watermark'); if(!el0) return ['NO_WATERMARK'];
    const w = el0.getBoundingClientRect();
    const box = el => {
      if(el.classList.contains('doc-title') || el.classList.contains('doc-sub')){
        const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect();
      }
      return el.getBoundingClientRect();
    };
    const sel = '.doc-no, .doc-title, .doc-sub, .doc-letter .lt, .doc-letter .ls, .doc-meta > div, .doc-flags .chip, .doc-tools .btn, .doc-tools .hint';
    return [...document.querySelectorAll(sel)].filter(el => {
      const r = box(el);
      return r.width > 0 && w.left < r.right && w.right > r.left && w.top < r.bottom && w.bottom > r.top;
    }).map(el => el.textContent.trim().slice(0, 14));
  })()`);
  const click = sel => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  const setCtl = (sel, val) => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false;
    const proto = Object.getPrototypeOf(el);
    if(el.type === 'checkbox'){ el.checked = ${JSON.stringify(!!val)}; }
    else { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))}); }
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return true;
  })()`);

  console.log("一页式交付说明原型 v2 验证\n  " + FILE);
  await setVP(1440, 1000, false);
  await call("Page.navigate", { url:FILE });
  await wait("!!window.PROTO && !!document.querySelector('.rail')", "原型初始化");

  /* ---------- 1. 工作台默认态 ---------- */
  const init = await ev(`(() => ({
    tone: PROTO.state.tone,
    rel: PROTO.state.releaseId,
    sections: document.querySelectorAll('.sec').length,
    metrics: document.querySelectorAll('.metric').length,
    controls: document.querySelectorAll('.rail [data-ctl]').length + document.querySelectorAll('.rail .seg button').length,
    pending: document.querySelectorAll('.narr-wrap.pending').length,
    required: document.querySelectorAll('.rail [required]').length,
    exportDisabled: document.querySelector('.page-actions .btn.primary').disabled,
    effort: !!document.querySelector('#sec-effort'),
    internal: !!document.querySelector('#sec-internal'),
    autoRate: document.querySelector('.rail-meter b').textContent
  }))()`);
  ok(init.tone === "customer" && init.rel === "rel-1112", "默认客户版 + 最近一次成功生产发布");
  ok(init.controls >= 7, "常驻控制区控件 " + init.controls + " 项（≥7）");
  ok(init.required === 0, "0 个必填字段");
  ok(init.pending === 2, "默认只有 2 处待确认");
  ok(init.exportDisabled === true, "待确认时导出禁用");
  ok(!init.effort && !init.internal, "客户版默认隐藏工时与内部备注");
  ok(init.sections >= 6, "自动生成 " + init.sections + " 个区块");
  await shot("work-1440");
  await shot("work-full-1440", true);

  /* ---------- 2. 控件实时生效 ---------- */
  await click('[data-act="gran"][data-gran="items"]');
  const rowsItems = await ev("document.querySelectorAll('#sec-scope .row.body').length");
  ok(rowsItems === 18, "明细粒度「逐条」列出 18 项（实际 " + rowsItems + "）");
  await setCtl('[data-ctl="includeUnreleased"]', false);
  const rowsReleased = await ev("document.querySelectorAll('#sec-scope .row.body').length");
  ok(rowsReleased === 15, "关闭「包含未发布项」后只剩 15 项已发布（实际 " + rowsReleased + "）");
  await setCtl('[data-ctl="includeUnreleased"]', true);
  await click('[data-act="gran"][data-gran="brief"]');
  const brief = await ev("document.querySelectorAll('#sec-scope .row.body').length");
  ok(brief > 0 && brief < 15, "「摘要」粒度按模块聚合为 " + brief + " 行");
  await click('[data-act="gran"][data-gran="module"]');

  await setCtl('[data-ctl="verbosity"]', 2);
  const longText = await ev("document.querySelector('.sec .narr').textContent.length");
  await setCtl('[data-ctl="verbosity"]', 0);
  const shortText = await ev("document.querySelector('.sec .narr').textContent.length");
  ok(longText > shortText * 2, "叙述长度实时改变正文（详尽 " + longText + " 字 / 精简 " + shortText + " 字）");
  await setCtl('[data-ctl="verbosity"]', 1);

  await click('[data-act="density"][data-density="compact"]');
  ok(await ev("document.querySelector('.sheet').classList.contains('compact')"), "排版密度「紧凑」立即生效");
  await click('[data-act="density"][data-density="cozy"]');

  await setCtl('[data-ctl="watermark"]', true);
  ok(await ev("!!document.querySelector('.doc-watermark')"), "草稿水印开关生效");
  await setCtl('[data-ctl="watermark"]', false);
  await setCtl('[data-ctl="brand"]', false);
  ok(await ev("!document.querySelector('.doc-letter')"), "抬头开关生效");
  await setCtl('[data-ctl="brand"]', true);

  await setCtl('[data-ctl="audience"]', "华东水务集团 · 验收组");
  ok(await ev("document.querySelector('.doc-meta strong').textContent.indexOf('验收组') >= 0"), "交付对象输入即时写入抬头");
  await setCtl('[data-ctl="note"]', "现场验收会定于 11-20 上午，请提前确认参会人。");
  ok(await ev("!!document.querySelector('#sec-note')"), "补充说明非空时新增区块");
  await setCtl('[data-ctl="note"]', "");
  ok(await ev("!document.querySelector('#sec-note')"), "补充说明清空后区块消失");

  await setCtl('[data-ctl="showEffort"]', true);
  ok(await ev("!!document.querySelector('#sec-effort') && document.querySelectorAll('#sec-effort .hb').length === 4"), "工时开关生效并按模块 4 条");
  await setCtl('[data-ctl="effortDim"]', "member");
  ok(await ev("document.querySelector('#sec-effort .hb .hn').textContent === '林舟'"), "工时维度切到按成员");
  await setCtl('[data-ctl="effortDim"]', "module");
  await setCtl('[data-ctl="showEffort"]', false);

  await click('[data-act="evidence"][data-lv="2"]');
  const evFull = await ev("document.querySelectorAll('.ev').length");
  ok(evFull === 5, "客户版证据密度拉满仍不含内部证据（" + evFull + " 项）");
  await click('[data-act="evidence"][data-lv="1"]');
  await setCtl('[data-ctl="showChanges"]', false);
  ok(await ev("!document.querySelector('#sec-changes')"), "变更台账开关生效");
  await setCtl('[data-ctl="showChanges"]', true);

  /* ---------- 3. 语气投影 ---------- */
  await click('[data-act="tone"][data-tone="internal"]');
  const internal = await ev(`(() => ({
    internal: !!document.querySelector('#sec-internal'),
    effort: !!document.querySelector('#sec-effort'),
    ev: document.querySelectorAll('.ev').length,
    shareDisabled: [...document.querySelectorAll('.page-actions .btn')].find(b => b.textContent.includes('分享')).disabled
  }))()`);
  ok(internal.internal && internal.effort, "内部版出现内部备注与工时");
  ok(internal.ev === 7, "内部版证据含工时明细与制品校验值（7 项）");
  ok(internal.shareDisabled, "内部版禁止分享");
  await shot("internal-1440");
  await click('[data-act="tone"][data-tone="manager"]');
  ok(await ev("!document.querySelector('#sec-internal') && !!document.querySelector('#sec-effort')"), "管理版：有工时、无内部备注");
  await click('[data-act="tone"][data-tone="customer"]');
  ok(await ev("!document.querySelector('#sec-effort')"), "切回客户版自动收起工时");

  /* ---------- 4. 数字溯源 ---------- */
  await click('.metric[data-src="passRate"]');
  await wait("!!document.querySelector('.drawer .caliber')", "来源抽屉");
  const src = await ev(`(() => ({
    caliber: document.querySelector('.drawer .caliber').textContent,
    recs: document.querySelectorAll('.drawer .srcrec').length
  }))()`);
  ok(src.caliber.indexOf("通过") >= 0 && src.recs >= 2, "通过率可点回口径与 " + src.recs + " 条原始记录");
  await shot("source-1440");
  await click('.drawer .x-btn');
  ok(await ev("!document.querySelector('.drawer')"), "抽屉可关闭");

  /* ---------- 5. 待确认 → 确认 → 导出锁定 ---------- */
  await click('[data-act="accept-all"]');
  ok(await ev("document.querySelectorAll('.narr-wrap.pending').length === 0 && !document.querySelector('.page-actions .btn.primary').disabled"),
    "一键确认后待确认清零、导出可用");
  await click('.page-actions [data-act="open-export"]');
  await wait("!!document.querySelector('#paperPreview')", "导出弹窗 PDF 预览");
  ok(await ev("document.querySelector('#paperPreview').textContent.indexOf('交付摘要') >= 0"), "PDF 预览渲染真实文档内容");
  await shot("export-1440");
  await click('[data-act="fmt"][data-fmt="md"]');
  const md = await ev("document.querySelector('#mdPre').textContent");
  ok(md.indexOf("# 交付说明") === 0 && md.indexOf("## 二、交付范围") > 0, "Markdown 导出含标题与分节");
  await click('[data-act="do-export"]');
  await sleep(600);
  const afterExport = await ev(`(() => ({
    locked: PROTO.state.locked, snaps: PROTO.snapshots.length,
    railLocked: document.querySelector('.rail').classList.contains('locked'),
    banner: document.querySelector('.banner').className
  }))()`);
  ok(afterExport.locked && afterExport.snaps === 1 && afterExport.railLocked, "导出后生成快照并锁定控件");
  ok(afterExport.banner.indexOf("lock") >= 0, "锁定态提示条出现");
  const mdFile = fs.readdirSync(dlDir).find(f => f.endsWith(".md"));
  ok(!!mdFile, "Markdown 文件真实下载：" + (mdFile || "无"));
  await shot("locked-1440");

  await click('.page-actions [data-act="open-snapshots"]');
  await wait("!!document.querySelector('.drawer .snap')", "快照抽屉");
  ok(await ev("document.querySelectorAll('.drawer .snap').length === 1"), "快照列表记录 1 条");
  await click('.drawer .x-btn');
  await click('.banner [data-act="regen"]');
  ok(await ev("!PROTO.state.locked && PROTO.snapshots.length === 1"), "重新生成解锁但保留历史快照");

  /* ---------- 6. 分享 ---------- */
  await click('[data-act="accept-all"]');
  await click('.page-actions [data-act="open-share"]');
  await wait("!!document.querySelector('#shareUrl')", "分享弹窗");
  await click('[data-act="gen-share"]');
  await sleep(200);
  const sh = await ev("PROTO.share && PROTO.share.url");
  ok(typeof sh === "string" && sh.indexOf("kind=delivery&token=") > 0, "生成只读分享链接");
  ok(await ev("!document.querySelector('[data-act=\"copy-share\"]').disabled"), "生成后复制按钮可用");
  await shot("share-modal-1440");
  await click('[data-act="preview-share"]');
  await wait("document.body.dataset.screen === 'share'", "接收人视图");
  const recipient = await ev(`(() => ({
    sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
    rail: !!document.querySelector('.rail'),
    internal: !!document.querySelector('#sec-internal'),
    editable: document.querySelectorAll('[contenteditable]').length,
    foot: document.querySelector('.share-foot').textContent
  }))()`);
  ok(recipient.sidebar === "none" && !recipient.rail, "接收人页无应用外壳与控制区");
  ok(!recipient.internal && recipient.editable === 0, "接收人页无内部备注、不可编辑");
  ok(recipient.foot.indexOf("不可变快照") >= 0, "页脚固定口径与有效期声明");
  await shot("recipient-1440");
  await shot("recipient-full-1440", true);
  await click('.share-top [data-act="screen"][data-screen="work"]');
  await wait("document.body.dataset.screen === 'work'", "返回工作台");
  await click('.page-actions [data-act="open-share"]');
  await wait("!!document.querySelector('[data-act=\"revoke-share\"]')", "分享弹窗（已生成）");
  await click('[data-act="revoke-share"]');
  ok(await ev("PROTO.share === null"), "撤销后链接失效");
  await click('.modal .x-btn');

  /* ---------- 7. 阻断态 ---------- */
  await setCtl('#relSel', "none");
  const blk = await ev(`(() => ({
    banner: document.querySelector('.banner').className,
    exportDisabled: document.querySelector('.page-actions .btn.primary').disabled,
    shareDisabled: [...document.querySelectorAll('.page-actions .btn')].find(b => b.textContent.includes('分享')).disabled,
    watermark: !!document.querySelector('.doc-watermark'),
    warning: !!document.querySelector('.doc-warning')
  }))()`);
  ok(blk.banner.indexOf("bad") >= 0 && blk.exportDisabled && blk.shareDisabled, "无成功发布：客户版导出与分享均阻断");
  ok(blk.watermark && blk.warning, "无成功发布：强制草稿水印与口径警示");
  const wmHit = await wmHits();
  ok(wmHit.length === 0, "草稿水印不遮挡编号/标题/事实卡（命中 " + JSON.stringify(wmHit) + "）");
  await shot("blocked-1440");
  await click('.banner [data-act="tone"][data-tone="internal"]');
  ok(await ev("!document.querySelector('.page-actions .btn.primary').disabled || PROTO.pending"), "切内部版后可导出内部草稿");
  await click('[data-act="accept-all"]');
  ok(await ev("!document.querySelector('.page-actions .btn.primary').disabled"), "内部版草稿确认后可导出");
  await click('[data-act="reset"]');
  ok(await ev("PROTO.state.tone === 'customer' && PROTO.state.releaseId === 'rel-1112'"), "重置默认恢复客户版 + 生产记录");

  /* ---------- 8. 缺失即标注 ---------- */
  await click('[data-act="scene"]');
  await sleep(200);
  const sparse = await ev(`(() => ({
    scene: PROTO.state.scene,
    missing: document.querySelectorAll('.missing').length,
    quality: document.querySelector('#sec-quality').textContent,
    changes: document.querySelector('#sec-changes').textContent,
    passTile: document.querySelectorAll('.metric')[1].textContent
  }))()`);
  ok(sparse.scene === "sparse", "切换到记录不完整的版本");
  ok(sparse.quality.indexOf("未创建测试计划") >= 0, "无测试计划：标注未执行回归，不给通过率");
  ok(sparse.changes.indexOf("基线") >= 0 && sparse.changes.indexOf("不反推") >= 0, "无变更留痕：说明基线建立时间，不反推");
  ok(sparse.passTile.indexOf("—") >= 0, "通过率指标显示缺失占位");
  await setCtl('[data-ctl="showEffort"]', true);
  ok(await ev("document.querySelector('#sec-effort').textContent.indexOf('没有计时与补记记录') >= 0"), "无工时：标注未记录，不用预估反推");
  await shot("missing-1440");
  await click('[data-act="scene"]');
  await sleep(200);

  /* ---------- 9. 入口页 ---------- */
  await click('#protoTabs [data-screen="entry"]');
  await wait("document.body.dataset.screen === 'entry'", "版本页入口");
  ok(await ev("!!document.querySelector('.vc-acts [data-screen=\"work\"]')"), "版本卡右上角有「交付说明」入口");
  ok(await ev("document.querySelectorAll('[data-act=\"entry-generate\"]').length === 2"), "每条发布记录都有「生成说明」");
  await shot("entry-1440");
  await click('[data-act="entry-generate"][data-rel="rel-1110"]');
  await wait("document.body.dataset.screen === 'work'", "从预发记录进入");
  ok(await ev("PROTO.state.releaseId === 'rel-1110' && document.querySelector('.banner').className.indexOf('warn') >= 0"),
    "预发记录进入：提示不能作为对外交付依据");
  await click('[data-act="use-production"]');
  ok(await ev("PROTO.state.releaseId === 'rel-1112'"), "一键改用生产记录");

  /* ---------- 10. 深色 ---------- */
  await click('#themeBtn');
  ok(await ev("document.documentElement.dataset.theme === 'dark'"), "深色主题切换");
  await shot("dark-1440");
  await shot("dark-full-1440", true);
  await click('#themeBtn');

  /* ---------- 11. 移动端 390 ---------- */
  await setVP(390, 844, true);
  await sleep(300);
  const mob = await ev(`(() => ({
    overflow: document.documentElement.scrollWidth,
    railVisible: !!document.querySelector('.rail') && getComputedStyle(document.querySelector('.rail')).display !== 'none',
    railTop: document.querySelector('.rail').getBoundingClientRect().top,
    sheetTop: document.querySelector('.sheet').getBoundingClientRect().top,
    tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
    sidebar: getComputedStyle(document.querySelector('.sidebar')).display
  }))()`);
  ok(mob.overflow <= 390, "390 无横向溢出（scrollWidth " + mob.overflow + "）");
  ok(mob.railVisible && mob.railTop < mob.sheetTop, "移动端控制区常驻在文档上方，未折叠");
  ok(mob.tabbar === "flex" && mob.sidebar === "none", "移动端底部标签栏 + 隐藏侧栏");
  await shot("mobile-390");
  await shot("mobile-full-390", true);
  await ev(`PROTO.set({ watermark:true })`);
  await sleep(180);
  const mWm = await wmHits();
  ok(mWm.length === 0, "移动端草稿水印不遮挡抬头（命中 " + JSON.stringify(mWm) + "）");
  await ev(`PROTO.set({ watermark:false })`);
  await click('[data-act="tone"][data-tone="manager"]');
  await sleep(200);
  ok(await ev("document.documentElement.scrollWidth <= 390"), "移动端切换语气后仍无横向溢出");
  await click('[data-act="tone"][data-tone="customer"]');
  await click('[data-act="accept-all"]');
  await sleep(150);
  await click('.page-actions [data-act="open-export"]');
  await sleep(300);
  const mobModal = await ev("!!document.querySelector('.modal')");
  ok(mobModal, "移动端确认后导出弹窗可打开");
  if(mobModal){
    ok(await ev("document.querySelector('.modal').getBoundingClientRect().width <= 390"), "移动端导出弹窗不超屏");
    await shot("mobile-export-390");
    await click('.modal .x-btn');
  }
  await ev(`PROTO.set({ screen:'share' })`);
  await sleep(250);
  ok(await ev("document.documentElement.scrollWidth <= 390"), "移动端接收人页无横向溢出");
  ok(await ev("getComputedStyle(document.querySelector('.tabbar')).display === 'none'"), "移动端接收人页不显示应用底部标签栏");
  await shot("mobile-recipient-390");
  await ev(`PROTO.set({ screen:'work' })`);
  await setVP(1440, 1000, false);

  /* ---------- 12. 反复交互稳定性 ---------- */
  for(let i = 0; i < 6; i++){
    await click('[data-act="tone"][data-tone="internal"]');
    await click('[data-act="tone"][data-tone="customer"]');
    await click('.metric[data-src="released"]');
    await click('.drawer .x-btn');
  }
  ok(await ev("document.querySelectorAll('.rail').length === 1 && document.querySelectorAll('.sheet').length === 1"),
    "反复切换语气与抽屉后 DOM 不重复堆积");
  ok(await ev("!!document.querySelector('.rail-meter b')"), "反复交互后控制区读数仍在");

  ok(cdp.errors.length === 0, "无控制台错误 / 未捕获异常" + (cdp.errors.length ? "：" + cdp.errors.slice(0, 4).join(" | ") : ""));

  console.log("\n结果：" + passed + " 通过 / " + failed + " 失败");
  ws.close();
}catch(err){
  failed++;
  console.error("\n运行异常：" + err.message);
}finally{
  try{ proc.kill(); }catch(e){}
}
process.exit(failed ? 1 : 0);