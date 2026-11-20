/* 文档 × 2026-11-19 原型：逐页面截图与计算样式取证
   用法：node tools/e2e/docs-proto-audit.mjs
   产物：docs/audit/docs-prototype-alignment-2026-11-20/
     - shots/docs-{read,reader,list,kanban,feed,edit,history,new,tpl}-1440.png
     - shots/docs-{read,list,edit}-390.png
     - metrics.json（页头、工具条、树/列表/看板/动态、阅读页、编辑页、历史页、弹窗）
   只读：不保存、不发布、不改任何文档。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = path.resolve("docs/audit/docs-prototype-alignment-2026-11-20");
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

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
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      this.errors.push("console.error: " + msg.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      this.errors.push("log: " + msg.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const port = 9233;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doc-audit-"));
const proc = spawn(findChrome(), [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage", "--hide-scrollbars"
], { stdio: "ignore" });

const results = {};
let ws = null;
try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
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
  const shot = async name => {
    const r = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
  };
  const click = async sel => {
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
    if(!ok) throw new Error("找不到可点击元素：" + sel);
  };

  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* 登录 */
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
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
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs)`, "应用初始化", 25000);

  /* 公共测量片段 */
  const HELPERS = `
    const px = v => Math.round(parseFloat(v || "0") * 10) / 10;
    const vis = el => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const first = sel => [...document.querySelectorAll(sel)].find(vis) || null;
    const style = el => {
      if(!el) return null;
      const s = getComputedStyle(el);
      return { h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width),
        fs: px(s.fontSize), fw: s.fontWeight, lh: s.lineHeight, r: s.borderRadius, pad: s.padding,
        bg: s.backgroundColor, bd: s.borderColor, c: s.color, shadow: s.boxShadow === "none" ? "" : s.boxShadow };
    };
    const txt = el => el ? el.textContent.trim().replace(/\\s+/g, " ") : "";
    const pagehead = () => {
      const h1 = document.getElementById("pageTitle");
      const sub = document.getElementById("pageSub");
      const pill = document.getElementById("pagePill");
      const pa = document.getElementById("pageActions");
      const nw = document.getElementById("newWrap");
      return {
        h1: style(h1), h1text: txt(h1),
        sub: style(sub), subtext: txt(sub),
        pill: style(pill), pillText: pill && !pill.hidden ? txt(pill) : "(hidden)",
        actions: pa && !pa.hidden ? [...pa.querySelectorAll(".btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) })) : [],
        newWrapHidden: nw ? nw.hidden : null
      };
    };
  `;

  const measureList = () => evaluate(`(() => {
    ${HELPERS}
    const tb = first("#view-requirements .page-toolbar");
    const segs = [...document.querySelectorAll("#view-requirements .reqdoc-modes")].filter(vis).map(s => style(s));
    const segBtns = [...document.querySelectorAll("#view-requirements .rm-btn")].filter(vis).map(b => ({ t: txt(b), on: b.getAttribute("aria-selected") === "true", ...style(b) }));
    const tree = first("#reqDocSplitTree");
    const projHead = first("#reqDocSplitTree .rs-proj-head");
    const node = first("#reqDocSplitTree .rs-node");
    const nodeActive = first("#reqDocSplitTree .rs-node.active");
    const cat = first("#reqDocSplitTree .rs-cat");
    const pub = first("#reqDocSplitTree .rr-published");
    const draft = first("#reqDocSplitTree .rr-draft");
    const visChip = first("#reqDocSplitTree .doc-vis-chip");
    const row = first("#reqDocTree .reqdoc-row");
    const rowTitle = first("#reqDocTree .rr-title");
    const rowMeta = first("#reqDocTree .rr-meta");
    const rowExcerpt = first("#reqDocTree .rr-excerpt");
    const listCat = first("#reqDocTree .reqdoc-cat");
    const listProj = first("#reqDocTree .reqdoc-proj-head");
    const rkCol = first("#reqDocKanban .rk-col");
    const rkHead = first("#reqDocKanban .rk-col-head");
    const rkCard = first("#reqDocKanban .rk-card");
    const rkTitle = first("#reqDocKanban .rk-title, #reqDocKanban .rk-card b, #reqDocKanban .rk-card strong");
    const rfItem = first("#reqDocFeed .rf-item");
    const rfDoc = first("#reqDocFeed .rf-doc");
    return {
      view: document.body.dataset.view,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      pagehead: pagehead(),
      toolbar: style(tb),
      segs, segBtns,
      search: style(first("#view-requirements .reqdoc-search input")),
      tpl: style(document.getElementById("reqDocTplBtn")),
      views: style(document.getElementById("rdViewsBtn")),
      newBtn: style(document.getElementById("reqDocNew")),
      fullscreen: style(first("#view-requirements [data-view-fullscreen]")),
      split: (() => { const s = first("#reqDocSplit"); return s ? { ...style(s), cols: getComputedStyle(s).gridTemplateColumns, gap: getComputedStyle(s).gap } : null; })(),
      tree: tree ? { ...style(tree), scrollH: tree.scrollHeight, clientH: tree.clientHeight } : null,
      projHead: projHead ? { ...style(projHead), t: txt(first(".rp-name")) } : null,
      node: node ? { ...style(node), t: txt(first(".rs-title")), count: document.querySelectorAll("#reqDocSplitTree .rs-node").length } : null,
      nodeActive: nodeActive ? style(nodeActive) : null,
      cat: cat ? { ...style(cat), t: txt(first(".rs-title")), kids: txt(first(".rs-kids")) } : null,
      pub: pub ? { ...style(pub), t: txt(pub) } : null,
      draft: draft ? { ...style(draft), t: txt(draft) } : null,
      visChip: visChip ? { ...style(visChip), t: txt(visChip) } : null,
      list: {
        rows: document.querySelectorAll("#reqDocTree .reqdoc-row").length,
        cats: document.querySelectorAll("#reqDocTree .reqdoc-cat").length,
        projs: document.querySelectorAll("#reqDocTree .reqdoc-proj").length,
        row: style(row), title: style(rowTitle), titleText: txt(rowTitle),
        meta: style(rowMeta), metaText: txt(rowMeta),
        excerpt: style(rowExcerpt), cat: style(listCat), proj: style(listProj)
      },
      kanban: {
        cols: document.querySelectorAll("#reqDocKanban .rk-col").length,
        cards: document.querySelectorAll("#reqDocKanban .rk-card").length,
        col: style(rkCol), head: style(rkHead), headText: txt(rkHead),
        card: style(rkCard), title: style(rkTitle), titleText: txt(rkTitle)
      },
      feed: {
        items: document.querySelectorAll("#reqDocFeed .rf-item").length,
        item: style(rfItem), doc: style(rfDoc), docText: txt(rfDoc),
        first: txt(rfItem)
      },
      readerEmpty: style(first(".rrd-empty"))
    };
  })()`);

  const measureReader = () => evaluate(`(() => {
    ${HELPERS}
    const reader = first("#reqDocReader");
    const crumb = first("#reqDocReader .rrd-crumb");
    const h3 = first("#reqDocReader .rrd-title-row h3");
    const meta = first("#reqDocReader .rrd-meta");
    const body = first("#reqDocReader .rrd-body");
    const edit = first("#reqDocReader [data-rrd-edit]");
    const ibtns = [...document.querySelectorAll("#reqDocReader .rrd-acts .ibtn")].filter(vis).map(b => style(b));
    const h2 = first("#reqDocReader .rrd-body h2");
    const h3b = first("#reqDocReader .rrd-body h3");
    const p = first("#reqDocReader .rrd-body p");
    return {
      pagehead: pagehead(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      reader: style(reader),
      crumb: style(crumb),
      h3: style(h3), h3text: txt(h3),
      meta: style(meta), metaText: txt(meta),
      body: style(body),
      bodyH2: style(h2), bodyH3: style(h3b), bodyP: style(p),
      edit: edit ? { ...style(edit), t: txt(edit) } : null,
      ibtns
    };
  })()`);

  const measureEditor = () => evaluate(`(() => {
    ${HELPERS}
    const page = first("#reqDocEditPage");
    const bar = first(".reqdoc-editbar");
    const crumb = first(".reqdoc-crumb");
    const sel = first(".reqdoc-parent select");
    const saved = first(".reqdoc-saved");
    const count = first(".reqdoc-count");
    const zoom = first(".reqdoc-editbar .doc-zoom");
    const acts = [...document.querySelectorAll(".reqdoc-actions .btn, .reqdoc-actions .icon-btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) }));
    const pubChip = first(".reqdoc-pub-chip");
    const save = first("#reqDocSave");
    const pub = first("#reqDocPublish");
    const aiSplit = first("#reqDocAiSplit");
    const aiAudit = first("#reqDocAiAudit");
    const toc = first("#reqDocToc");
    const tocTitle = first("#reqDocToc .rt-title");
    const body = first("#reqDocRichBody .sun-editor, #reqDocRichBody .se-container, #reqDocMdBody");
    const md = first("#reqDocMdPreview p, #reqDocMdPreview h2");
    return {
      pagehead: pagehead(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      page: style(page),
      bar: bar ? { ...style(bar), btns: bar.querySelectorAll("button,select").length } : null,
      crumb: style(crumb), crumbText: txt(crumb),
      select: style(sel),
      saved: saved ? { ...style(saved), t: txt(saved) } : null,
      count: count ? { ...style(count), t: txt(count) } : null,
      zoom: style(zoom),
      acts,
      aiSplit: aiSplit ? { ...style(aiSplit), t: txt(aiSplit) } : null,
      aiAudit: aiAudit ? { ...style(aiAudit), t: txt(aiAudit) } : null,
      pubChip: pubChip ? { ...style(pubChip), t: txt(pubChip) } : null,
      save: save ? { ...style(save), t: txt(save) } : null,
      pub: pub ? { ...style(pub), t: txt(pub) } : null,
      toc: toc ? { ...style(toc), w: Math.round(toc.getBoundingClientRect().width) } : null,
      tocTitle: style(tocTitle),
      body: style(body),
      bodyP: style(md)
    };
  })()`);

  const measureHistory = () => evaluate(`(() => {
    ${HELPERS}
    const dh = first("#dlgReqDocHistory");
    const head = first(".dh-head");
    const h1 = first(".dh-head h1");
    const sub = first(".dh-sub");
    const kicker = first(".dh-kicker");
    const vlist = first(".rh-vlist");
    const vhead = first(".rh-vlist-head");
    const vitem = first(".rh-vrow");
    const pane = first(".rh-pane");
    const paneHead = first(".rh-pane-head");
    const cmp = first(".rh-cmp-bar");
    const stats = first(".rh-stats");
    const diffline = first(".rh-diff-wrap .rh-drow, .rh-diff-wrap .diffline");
    const foot = first(".rh-diff-foot");
    const restore = first("#reqDocHistoryRestore");
    const back = first("#docHistoryBack");
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      page: style(dh), head: style(head), h1: style(h1), h1text: txt(h1),
      sub: style(sub), subText: txt(sub), kicker: style(kicker),
      back: back ? { ...style(back), t: txt(back) } : null,
      vlist: style(vlist), vhead: style(vhead), vitem: vitem ? { ...style(vitem), t: txt(vitem) } : null,
      vcount: document.querySelectorAll(".rh-vscroll > .rh-vrow").length,
      pane: style(pane), paneHead: style(paneHead), paneMeta: txt(first(".rh-pane-meta")),
      cmp: style(cmp), stats: stats ? { ...style(stats), t: txt(stats) } : null,
      diffHead: txt(first(".rh-dhead")), diffline: style(diffline), foot: style(foot), footText: txt(foot),
      restore: restore ? { ...style(restore), t: txt(restore) } : null
    };
  })()`);

  const gotoDocs = async () => {
    await call("Page.navigate", { url: BASE + "/#/requirements" });
    await waitFor("document.body.dataset.view === 'requirements'", "进入文档", 15000);
    await waitFor("!!document.querySelector('#view-requirements .page-toolbar')", "文档工具条", 15000);
    await sleep(1200);
  };
  const closeEditor = async () => {
    const open = await evaluate("!!document.getElementById('reqDocEditPage') && !document.getElementById('reqDocEditPage').hidden");
    if(!open) return;
    await evaluate("(() => { const b = document.getElementById('reqDocBack'); if(b) b.click(); return true; })()");
    await sleep(600);
    const dirty = await evaluate("!!document.getElementById('dlgReqDocClose') && document.getElementById('dlgReqDocClose').classList.contains('open')");
    if(dirty){
      await evaluate("(() => { const b = document.getElementById('dlgReqDocCloseDiscard'); if(b) b.click(); return true; })()");
      await sleep(600);
    }
    await waitFor("document.getElementById('reqDocEditPage').hidden", "退出编辑页", 10000).catch(() => null);
  };

  /* ---------- 阅读（默认）：左树 + 右空态 ---------- */
  await gotoDocs();
  await evaluate(`(() => { const b = document.querySelector('[data-rdmode="read"]'); if(b) b.click(); return true; })()`);
  await waitFor("!!document.querySelector('#reqDocSplitTree .rs-node') || !!document.querySelector('#reqDocSplit .empty, #reqDocSplit .reqdoc-empty2')", "阅读树", 15000);
  await sleep(600);
  await shot("docs-read-1440.png");
  results.read = await measureList();

  /* ---------- 阅读选中一篇 ---------- */
  const docId = await evaluate(`(() => { const n = document.querySelector('#reqDocSplitTree .rs-node'); if(!n) return ""; const id = n.dataset.rsDoc; n.click(); return id; })()`);
  if(docId){
    await waitFor("!!document.querySelector('#reqDocReader .rrd-main')", "阅读正文", 15000);
    await waitFor("!document.querySelector('#reqDocReader .rrd-empty')", "正文渲染", 15000).catch(() => null);
    await sleep(800);
    await shot("docs-reader-1440.png");
    results.reader = await measureReader();
  }else{
    results.reader = { skipped: "无文档可选" };
  }

  /* 历史页需要至少两个版本才有对比头；在树上找版本最多的那篇 */
  const histDocId = await evaluate(`(async () => {
    const ids = [...document.querySelectorAll('#reqDocSplitTree .rs-node')].map(n => n.dataset.rsDoc).filter(Boolean);
    let best = "", bestN = 0;
    for(const id of ids){
      try{
        const r = await fetch("api/req-docs/" + encodeURIComponent(id) + "/history", { headers: { Accept: "application/json" } });
        const j = await r.json();
        const n = j && j.data ? Number(j.data.total || 0) : 0;
        if(n > bestN){ bestN = n; best = id; }
      }catch(e){ /* 忽略单篇失败 */ }
    }
    return best || ids[0] || "";
  })()`);
  results.histDocId = histDocId;

  /* ---------- 列表 ---------- */
  await click('[data-rdmode="tree"]');
  await waitFor("!!document.querySelector('#reqDocTree .reqdoc-row, #reqDocTree .reqdoc-cat')", "文档列表", 15000);
  await sleep(700);
  await shot("docs-list-1440.png");
  results.list = await measureList();

  /* ---------- 看板 ---------- */
  await click('[data-rdmode="kanban"]');
  await waitFor("!!document.querySelector('#reqDocKanban .rk-card') || !!document.querySelector('#reqDocKanban .empty')", "文档看板", 15000);
  await sleep(700);
  await shot("docs-kanban-1440.png");
  results.kanban = await measureList();

  /* ---------- 动态 ---------- */
  await click('[data-rdmode="feed"]');
  await waitFor("!!document.querySelector('#reqDocFeed .rf-item') || !!document.querySelector('#reqDocFeed .empty')", "文档动态", 15000);
  await sleep(700);
  await shot("docs-feed-1440.png");
  results.feed = await measureList();

  /* ---------- 编辑页 ---------- */
  await click('[data-rdmode="read"]');
  await waitFor("!!document.querySelector('#reqDocSplitTree .rs-node')", "回到阅读树", 15000);
  await sleep(500);
  await evaluate(`(() => { const n = document.querySelector('#reqDocSplitTree .rs-node'); if(n) n.click(); return true; })()`);
  await waitFor("!!document.querySelector('#reqDocReader [data-rrd-edit]')", "阅读编辑入口", 15000).catch(() => null);
  const canEdit = await evaluate(`(() => { const b = document.querySelector('#reqDocReader [data-rrd-edit]'); if(!b || b.disabled) return false; b.click(); return true; })()`);
  if(canEdit){
    await waitFor("!document.getElementById('reqDocEditPage').hidden && !!document.querySelector('.reqdoc-editbar')", "文档编辑页", 20000);
    await waitFor("!!document.querySelector('#reqDocRichBody .sun-editor, #reqDocRichBody .se-container, #reqDocMdBody:not([hidden])')", "编辑正文", 20000).catch(() => null);
    await sleep(1200);
    await shot("docs-edit-1440.png");
    results.edit = await measureEditor();
  }else{
    results.edit = { skipped: "无可编辑文档" };
  }

  /* ---------- 新建文档弹窗 ---------- */
  await closeEditor();
  await gotoDocs();
  await click("#reqDocNew");
  await waitFor("document.getElementById('dlgNewReqDoc').classList.contains('open')", "新建文档弹窗", 15000);
  await sleep(600);
  await shot("docs-new-1440.png");
  results.newDoc = await evaluate(`(() => {
    ${HELPERS}
    const sheet = first("#dlgNewReqDoc .sheet");
    const head = first("#dlgNewReqDoc .panel-head h3, #dlgNewReqDoc h3");
    const foot = first("#dlgNewReqDoc .modal-foot, #dlgNewReqDoc .sheet-foot");
    const btns = [...document.querySelectorAll("#dlgNewReqDoc .btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) }));
    const sel = first("#dlgNewReqDoc select");
    const inp = first("#dlgNewReqDoc input[type=text], #dlgNewReqDoc input:not([type])");
    return { sheet: style(sheet), head: style(head), headText: txt(head), foot: style(foot), btns, select: style(sel), input: style(inp) };
  })()`);
  await evaluate(`(() => { const x = document.querySelector('#dlgNewReqDoc .panel-head .icon-btn, #dlgNewReqDoc [aria-label="关闭"]'); if(x) x.click(); return true; })()`);
  await sleep(400);

  /* ---------- 模板弹窗 ---------- */
  await click("#reqDocTplBtn");
  await waitFor("document.getElementById('dlgDocTpl').classList.contains('open')", "模板弹窗", 15000);
  await waitFor("!document.querySelector('#docTplList .skeleton, #docTplList .reqdoc-skel')", "模板加载", 15000).catch(() => null);
  await sleep(800);
  await shot("docs-tpl-1440.png");
  results.tpl = await evaluate(`(() => {
    ${HELPERS}
    const sheet = first("#dlgDocTpl .sheet");
    const head = first("#dlgDocTpl .panel-head h3");
    const item = first("#docTplList > *");
    const btns = [...document.querySelectorAll("#dlgDocTpl .btn")].filter(vis).map(b => ({ t: txt(b), ...style(b) }));
    return { sheet: style(sheet), head: style(head), headText: txt(head), item: item ? { ...style(item), t: txt(item) } : null, btns };
  })()`);
  await click("#dlgDocTplX");
  await sleep(400);

  /* ---------- 历史与对比（独立路由） ---------- */
  if(histDocId){
    await call("Page.navigate", { url: BASE + "/#/dochistory?doc=" + encodeURIComponent(histDocId) });
    await waitFor("document.body.dataset.view === 'dochistory'", "文档历史页", 15000);
    await waitFor("!!document.querySelector('.rh-vscroll > *') || !!document.getElementById('reqDocHistoryEmpty') && !document.getElementById('reqDocHistoryEmpty').hidden", "历史列表", 20000).catch(() => null);
    await sleep(1000);
    await shot("docs-history-1440.png");
    results.history = await measureHistory();
  }

  /* ---------- 390 ---------- */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await gotoDocs();
  await evaluate(`(() => { const b = document.querySelector('[data-rdmode="read"]'); if(b) b.click(); return true; })()`);
  await waitFor("!!document.querySelector('#reqDocSplitTree .rs-node') || !!document.querySelector('#reqDocSplit .empty')", "移动阅读", 15000);
  await sleep(700);
  await shot("docs-read-390.png");
  results.mobileRead = await measureList();
  await click('[data-rdmode="tree"]');
  await waitFor("!!document.querySelector('#reqDocTree .reqdoc-row, #reqDocTree .reqdoc-cat')", "移动列表", 15000);
  await sleep(700);
  await shot("docs-list-390.png");
  results.mobileList = await measureList();
  /* 移动编辑页 */
  await click('[data-rdmode="read"]');
  await waitFor("!!document.querySelector('#reqDocSplitTree .rs-node')", "移动阅读树", 15000);
  await sleep(400);
  await evaluate(`(() => { const n = document.querySelector('#reqDocSplitTree .rs-node'); if(n) n.click(); return true; })()`);
  await waitFor("!!document.querySelector('#reqDocReader [data-rrd-edit]')", "移动编辑入口", 15000).catch(() => null);
  const mobEdit = await evaluate(`(() => { const b = document.querySelector('#reqDocReader [data-rrd-edit]'); if(!b || b.disabled) return false; b.click(); return true; })()`);
  if(mobEdit){
    await waitFor("!document.getElementById('reqDocEditPage').hidden", "移动编辑页", 20000);
    await sleep(1400);
    await shot("docs-edit-390.png");
    results.mobileEdit = await measureEditor();
  }
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  results.docId = docId;
  results.errors = cdp.errors.slice(0, 10);
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}catch(e){
  console.error("失败：" + e.message);
  process.exitCode = 1;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  proc.kill();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
