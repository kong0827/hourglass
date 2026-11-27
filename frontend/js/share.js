/* 只读分享页：独立渲染，不依赖主程序，也不发任何写请求（ES Module 入口） */
import { GS } from "./lib/gantt-shared.js";
import { API } from "./core/api.js";
import { DD } from "./lib/delivery-doc.js";
import { printDeliveryPaper, registerDeliveryPrintSource } from "./lib/download.js";
import { ensureVendor } from "./core/doc-editor.js";
import { parseSnapshot, snapshotToHtml } from "./core/univer-doc-io.js";
import { openSheetView } from "./core/sheet-editor.js";

  var LABEL_W = 260, ROW_H = 50, GROUP_H = 0, HEAD_H = 54;
  var state = {
    data: null, scale: "day", zoom: 28, showDone: true,
    range: null, dayW: 28
  };
  var scroll = document.getElementById("shareScroll");

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var iso = GS.iso, parseDate = GS.parseDate, addDays = GS.addDays, dayDiff = GS.dayDiff;
  /* 分享页沿用 MM-DD 口径（主页面的 fmtMD 是 M月D日，两者不要混用） */
  var fmtMD = GS.fmtDashMD;
  function today() { return GS.startOfDay(new Date()); }
  function priorityDef(p) {
    var defs = state.data && state.data.priorities || [];
    for (var i = 0; i < defs.length; i++) if (defs[i].code === (p || "P2")) return defs[i];
    return null;
  }
  function priorityName(p) {
    var def = priorityDef(p);
    return def && def.name || { P0: "紧急", P1: "高", P2: "中", P3: "低" }[p || "P2"] || "中";
  }
  function priorityColor(p) {
    var def = priorityDef(p);
    return def && def.color || { P0: "var(--p0)", P1: "var(--p1)", P2: "var(--p2)", P3: "var(--p3)" }[p] || "var(--p2)";
  }
  function prioritySoft(p) {
    var color = priorityColor(p);
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      return "rgba(" + parseInt(color.slice(1, 3), 16) + "," + parseInt(color.slice(3, 5), 16) + "," + parseInt(color.slice(5, 7), 16) + ",0.12)";
    }
    return { P0: "var(--p0-soft)", P1: "var(--p1-soft)", P2: "var(--p2-soft)", P3: "var(--p3-soft)" }[p] || "var(--p2-soft)";
  }

  function statusOf(t) {
    var done = t.boardColumn === "done";
    var ended = !done && t.processingRule === "ended";
    var days = 0;
    if (!done && !ended && t.dueDate && t.dueDate < iso(today())) {
      days = Math.abs(dayDiff(parseDate(t.dueDate), today()));
    }
    if (done) return { key: "done", c: "var(--success)", soft: "var(--success-soft)", bd: "var(--success-border)", label: "已完成" };
    if (ended) return { key: "ended", c: "var(--text-3)", soft: "var(--surface-3)", bd: "var(--border-strong)", label: "执行结束" };
    if (t.blocked) return { key: "blocked", c: "var(--warning)", soft: "var(--warning-soft)", bd: "var(--warning-border)", label: "阻塞" + (days ? " · 逾期 " + days + " 天" : "") };
    if (days > 0) return { key: "overdue", c: "var(--danger)", soft: "var(--danger-soft)", bd: "var(--danger-border)", label: "逾期 " + days + " 天" };
    return { key: "doing", c: priorityColor(t.priority), soft: prioritySoft(t.priority), bd: "var(--border-strong)", label: "" };
  }

  function effectiveDayW() { return GS.scaleDayW(state.scale, state.zoom); }
  function adjustRange(range) { return GS.adjustRange(range, state.scale); }
  function headHTML(range, dayW) {
    return GS.headHTML(range, dayW, state.scale, iso(today()));
  }

  function labelWidthPx() {
    /* 900px 以下 CSS 会把 --gantt-label-w 压到 170px（!important），
       依赖线和今日竖线必须跟着实际宽度走，否则整体偏移 90px */
    return (window.innerWidth <= 900) ? 170 : LABEL_W;
  }

  function render() {
    var data = state.data;
    if (!data) return;
    var tasks = (data.tasks || []).slice();
    var visible = state.showDone ? tasks : tasks.filter(function (t) { return t.boardColumn !== "done"; });
    var dated = [], undated = [];
    visible.forEach(function (t) {
      var s = parseDate(t.startDate), e = parseDate(t.dueDate);
      if (!s && !e) { undated.push(t); return; }
      if (!s) s = e;
      if (!e) e = s;
      if (s > e) { var tmp = s; s = e; e = tmp; }
      dated.push({ t: t, s: s, e: e });
    });
    if (!dated.length) {
      scroll.innerHTML = '<div class="share-empty">当前没有可展示的排期工作项。</div>';
      return;
    }
    dated.sort(function (a, b) { return (a.s - b.s) || (a.e - b.e) || String(a.t.id).localeCompare(String(b.t.id)); });
    state.dayW = effectiveDayW();
    var min = dated[0].s, max = dated[0].e;
    dated.forEach(function (x) { if (x.s < min) min = x.s; if (x.e > max) max = x.e; });
    var t0 = today();
    if (t0 < min) min = t0;
    if (t0 > max) max = t0;
    var range = adjustRange({ start: addDays(min, -3), end: addDays(max, 4), days: 0 });
    state.range = range;
    var dayW = state.dayW;
    var lw = labelWidthPx();
    var avail = (scroll.clientWidth || 0) - lw;
    if(avail > 0 && range.days * dayW < avail){
      range.end = addDays(range.end, Math.ceil((avail - range.days * dayW) / dayW));
      range.days = dayDiff(range.end, range.start) + 1;
    }
    var totalW = range.days * dayW;
    var todayOff = dayDiff(t0, range.start), todayIn = todayOff >= 0 && todayOff < range.days;
    var geom = {}, rows = "", top = HEAD_H;

    dated.forEach(function (x) {
      var t = x.t, st = statusOf(t), done = t.boardColumn === "done";
      var off = dayDiff(x.s, range.start), span = Math.max(1, dayDiff(x.e, x.s) + 1);
      var left = off * dayW, width = span * dayW;
      var meta = '<span class="pdot ' + esc(t.priority) + '" style="--p-c:' + esc(priorityColor(t.priority)) + '"><i></i>' + esc(priorityName(t.priority)) + '</span>';
      if (t.owner) meta += '<span class="ellipsis shrink">' + esc(t.owner) + '</span>';
      meta += '<span>' + fmtMD(x.s) + '→' + fmtMD(x.e) + '</span>';
      var p = done ? 100 : (Number(t.progress) || 0);
      var bar;
      if (t.isMilestone) {
        var mw = Math.max(dayW, 18);
        bar = '<div class="gantt-milestone-wrap" style="left:' + (off * dayW + (dayW - mw) / 2) + 'px;width:' + mw + 'px">' +
          '<span class="gantt-milestone' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
          '" style="--bc:' + st.c + ';--bc-soft:' + st.soft + '"></span></div>';
      } else {
        bar = '<div class="gantt-bar' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
          '" style="left:' + left + 'px;width:' + width + 'px;--bc:' + st.c + ';--bc-soft:' + st.soft +
          ';--bc-bd:' + st.bd + '" title="' + esc(t.title + " · " + fmtMD(x.s) + "→" + fmtMD(x.e) + " · 进度 " + p + "%") + '">' +
          '<span class="gantt-bar-inner">' + (width >= 90 ? '<span class="gantt-bar-label">' + esc(t.title) + '</span>' : "") +
          (width >= 60 ? '<span class="gantt-bar-stat">' + esc(st.label || (p + "%")) + '</span>' : "") + '</span>' +
          '<span class="gantt-bar-fill" style="width:' + p + '%"></span></div>';
      }
      var baseline = "";
      var b = data.baseline && data.baseline[t.id];
      if (b) {
        var bs = parseDate(b.startDate) || parseDate(b.dueDate);
        var be = parseDate(b.dueDate) || bs;
        if (bs && be && !(be < range.start || bs > range.end)) {
          var s2 = bs < range.start ? range.start : bs, e2 = be > range.end ? range.end : be;
          baseline = '<span class="gantt-baseline" style="left:' + (dayDiff(s2, range.start) * dayW) +
            'px;width:' + ((dayDiff(e2, s2) + 1) * dayW) + 'px"></span>';
        }
      }
      rows += '<div class="gantt-row">' +
        '<div class="gantt-label">' +
          '<span class="gantt-title">' + esc(t.title) + '</span>' +
          '<span class="gantt-meta">' + meta + '</span>' +
          (t.estimateMinutes || t.totalMinutes
            ? '<span class="gantt-info"><span class="wk">' +
              (t.estimateMinutes ? "估 " + Math.round(t.estimateMinutes / 6) / 10 + "h" : "") +
              (t.estimateMinutes && t.totalMinutes ? " · " : "") +
              (t.totalMinutes ? "实 " + Math.round(t.totalMinutes / 6) / 10 + "h" : "") + '</span></span>'
            : "") +
        '</div>' +
        '<div class="gantt-track" style="width:' + totalW + 'px">' + baseline + bar + '</div>' +
      '</div>';
      geom[t.id] = { top: top, s: x.s, e: x.e, t: t };
      top += ROW_H;
    });
    scroll.innerHTML = '<div class="gantt-grid" style="--gantt-label-w:' + LABEL_W + 'px;--gantt-day-w:' + dayW +
        'px;--gantt-row-h:' + ROW_H + 'px;">' +
      '<div class="gantt-head"><div class="gantt-corner">工作项 <span class="gantt-corner-meta">' + dated.length + '</span></div>' +
        '<div class="gantt-axis" style="width:' + totalW + 'px">' + headHTML(range, dayW) + '</div></div>' +
      '<div class="gantt-body">' + rows + '</div>' +
      depsSVG(geom, range, dayW, totalW, HEAD_H + dated.length * ROW_H, lw) +
      (todayIn ? '<div class="gantt-today-col" style="left:calc(' + lw + 'px + ' + (todayOff * dayW) + 'px);width:' + dayW + 'px"></div>' +
        '<div class="gantt-today" style="left:calc(' + lw + 'px + ' + (todayOff * dayW) + 'px)"></div>' : '') +
    '</div>';
    var t = today();
    scroll.scrollLeft = Math.max(0, dayDiff(t, range.start) * dayW - 160);
    $("shareFoot").textContent = "生成时间 " + (data.generatedAt ? String(data.generatedAt).replace("T", " ").substring(0, 16) : "—") +
      " · 只读链接，不包含描述、备注与附件";
    $("shareMeta").textContent = dated.length + " 项已排期" + (undated.length ? " · 未排期 " + undated.length + " 项" : "");
  }

  function depsSVG(geom, range, dayW, totalW, bodyH, lw) {
    var deps = state.data.deps || [], out = [];
    deps.forEach(function (d) {
      var a = geom[d.fromTaskId], b = geom[d.toTaskId];
      if (!a || !b) return;
      var dep = d.depType || "FS";
      var lag = Number(d.lagDays) || 0;
      /* geom.top 已含表头高度，所以 headH 传 0 */
      var g = GS.depGeometry(dep, a, b, {
        dayW: dayW, labelW: lw, rangeStart: range.start, rowH: ROW_H, headH: 0
      });
      var path = GS.depPath(g.x1, g.y1, g.x2, g.y2);
      var conflict = GS.depConflict(
        { s: a.s, e: a.e, done: !!(a.t && a.t.boardColumn === "done") },
        { s: b.s, e: b.e },
        dep, lag
      );
      out.push('<path class="gantt-dep' + (conflict ? " is-conflict" : "") + '" d="' + path + '" marker-end="url(#shareArrow)"></path>');
    });
    if (!out.length) return "";
    return '<svg class="gantt-deps" width="' + (lw + totalW) + '" height="' + bodyH +
      '" viewBox="0 0 ' + (lw + totalW) + ' ' + bodyH + '" style="height:auto">' +
      '<defs><marker id="shareArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)"></path></marker></defs>' + out.join("") + '</svg>';
  }

  /* 链接缺失 / 失效 / 过期：整页切到独立错误页，避免留下空白甘特让人误以为仍在加载 */
  function showShareError(opts) {
    opts = opts || {};
    var page = $("shareErrorPage");
    if (!page) return;
    document.body.classList.add("share-error-mode");
    $("shareErrorTitle").textContent = opts.title || "无法打开分享";
    $("shareErrorDetail").textContent = opts.detail || "链接无效或已过期。";
    $("shareErrorHint").textContent = opts.hint || "请向分享者重新获取完整链接。";
    $("shareErrorRetry").hidden = !opts.retry;
    page.hidden = false;
    document.title = "无法打开分享 · 沙漏";
  }

  function boot() {
    var token = "";
    var kind = "";
    try {
      var q = new URLSearchParams(location.search);
      token = q.get("token") || "";
      kind = q.get("kind") || "";
    } catch (e) { token = ""; }
    if (!token) {
      showShareError({
        detail: "链接缺少 token 参数，无法查看。",
        hint: "分享链接不完整，可能被聊天工具截断；请向分享者重新获取。"
      });
      return;
    }
    if (kind === "doc") { bootDoc(token); return; }
    if (kind === "delivery") { bootDelivery(token); return; }
    fetch(API.base + "/api/share/gantt?token=" + encodeURIComponent(token), { credentials: "omit" })
      .then(function (r) { return r.text(); })
      .then(function (txt) { return JSON.parse(txt); })
      .then(function (j) {
        if (!j || j.code !== 0) throw new Error((j && j.message) || "链接无效或已过期");
        state.data = j.data;
        $("shareWsName").textContent = j.data.workspaceName || "甘特图";
        document.title = (j.data.workspaceName || "甘特图") + " · 只读分享";
        render();
      })
      .catch(function (ex) {
        showShareError({
          detail: ex.message || "网络异常",
          hint: "链接可能已失效，或网络暂时不可用；可稍后重试或向分享者重新获取链接。",
          retry: true
        });
      });
  }

  /* 文档分享：kind=doc，只渲染正文（markdown 在本地渲染，仍走 DOMPurify 消毒） */
  var mdLibPromise = null;
  function loadMdLib() {
    if (typeof window.marked !== "undefined" && window.DOMPurify) return Promise.resolve();
    if (mdLibPromise) return mdLibPromise;
    var loadScript = function (src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("Markdown 渲染组件加载失败")); };
        document.head.appendChild(s);
      });
    };
    mdLibPromise = loadScript("vendor/markdown/marked.min.js")
      .then(function () { return loadScript("vendor/markdown/purify.min.js"); })
      .catch(function (ex) { mdLibPromise = null; throw ex; });
    return mdLibPromise;
  }
  function bootDoc(token) {
    fetch(API.base + "/api/share/docs?token=" + encodeURIComponent(token), { credentials: "omit" })
      .then(function (r) { return r.text(); })
      .then(function (txt) { return JSON.parse(txt); })
      .then(function (j) {
        if (!j || j.code !== 0) throw new Error((j && j.message) || "链接无效或已过期");
        renderDoc(j.data);
      })
      .catch(function (ex) {
        showShareError({
          detail: ex.message || "网络异常",
          hint: "链接可能已失效，或网络暂时不可用；可稍后重试或向分享者重新获取链接。",
          retry: true
        });
      });
  }
  /* 分享页大纲与查找：只读正文，不引入主程序的组件；表格分享不启用 */
  var docTocItems = [], docFindHits = [], docFindIdx = -1, docFindQuery = "";
  var docAllowCopy = true;
  function docHeadingEls(root){
    if(!root) return [];
    var nodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p.UniverHeading[aria-level]");
    var out = [];
    for(var i = 0; i < nodes.length; i++){
      var el = nodes[i];
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if(!text) continue;
      var tag = el.tagName.toLowerCase();
      var level = tag.charAt(0) === "h" ? parseInt(tag.charAt(1), 10) : parseInt(el.getAttribute("aria-level"), 10);
      if(!(level >= 1 && level <= 6)) level = 1;
      var id = "share-h" + (out.length + 1);
      el.id = id;
      out.push({ id: id, level: level, text: text });
    }
    return out;
  }
  function syncShareTocBtn(){
    var btn = $("docShareTocBtn"), toc = $("docShareToc");
    if(!btn || !toc) return;
    btn.setAttribute("aria-pressed", toc.hidden ? "false" : "true");
    btn.textContent = toc.hidden ? "目录" : "收起目录";
  }
  function buildShareToc(body){
    var toc = $("docShareToc"), list = $("docShareTocBody"), btn = $("docShareTocBtn");
    docTocItems = docHeadingEls(body);
    if(!docTocItems.length){
      if(toc) toc.hidden = true;
      if(btn) btn.hidden = true;
      return;
    }
    if(btn) btn.hidden = false;
    if(list){
      list.innerHTML = docTocItems.map(function(t){
        return '<button type="button" data-share-toc="' + esc(t.id) + '" style="padding-left:' + (6 + (t.level - 1) * 12) + 'px" title="' + esc(t.text) + '">' + esc(t.text) + '</button>';
      }).join("");
    }
    if(toc) toc.hidden = window.innerWidth < 1080;
    syncShareTocBtn();
  }
  function clearShareFindMarks(){
    var body = $("docShareBody");
    docFindHits = [];
    if(!body) return;
    var marks = body.querySelectorAll("mark.share-hit");
    for(var i = 0; i < marks.length; i++){
      var m = marks[i];
      if(m.parentNode) m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    }
    if(marks.length) body.normalize();
  }
  function updateShareFindCount(){
    var cnt = $("docShareFindCount");
    if(!cnt) return;
    cnt.textContent = !docFindQuery ? ""
      : (docFindHits.length ? ((docFindIdx + 1) + " / " + docFindHits.length) : "无匹配");
    var prev = document.querySelector('[data-share-find="prev"]');
    var next = document.querySelector('[data-share-find="next"]');
    if(prev) prev.disabled = !docFindHits.length;
    if(next) next.disabled = !docFindHits.length;
  }
  function focusShareFindHit(){
    docFindHits.forEach(function(m, i){ m.classList.toggle("on", i === docFindIdx); });
    var hit = docFindHits[docFindIdx];
    if(hit && hit.scrollIntoView) hit.scrollIntoView({ block: "center", behavior: "smooth" });
    updateShareFindCount();
  }
  function runShareFind(query){
    var body = $("docShareBody");
    clearShareFindMarks();
    docFindQuery = String(query || "").trim();
    if(!body || !docFindQuery){ docFindIdx = -1; updateShareFindCount(); return; }
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        if(!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if(n.parentNode && n.parentNode.nodeType === 1 && n.parentNode.closest("script,style,textarea,mark.share-hit")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while((n = walker.nextNode())) nodes.push(n);
    var q = docFindQuery.toLowerCase();
    nodes.forEach(function(node){
      var text = node.nodeValue, idx = text.toLowerCase().indexOf(q);
      if(idx < 0) return;
      var frag = document.createDocumentFragment(), last = 0;
      while(idx >= 0){
        if(idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        var mark = document.createElement("mark");
        mark.className = "share-hit";
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        docFindHits.push(mark);
        last = idx + q.length;
        idx = text.toLowerCase().indexOf(q, last);
      }
      if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    docFindIdx = docFindHits.length ? 0 : -1;
    focusShareFindHit();
  }
  function stepShareFind(delta){
    if(!docFindHits.length) return;
    docFindIdx = (docFindIdx + delta + docFindHits.length) % docFindHits.length;
    focusShareFindHit();
  }
  function openShareFind(){
    var bar = $("docShareFindBar");
    if(!bar) return;
    bar.hidden = false;
    var input = $("docShareFindInput");
    var sel = "", body = $("docShareBody");
    try{
      var s = window.getSelection();
      if(s && s.rangeCount && body && body.contains(s.anchorNode)) sel = String(s).trim();
    }catch(e){ sel = ""; }
    if(sel && sel.length <= 60 && input){
      input.value = sel;
      runShareFind(sel);
    }
    if(input){ input.focus(); input.select(); }
  }
  function closeShareFind(){
    var bar = $("docShareFindBar");
    if(bar) bar.hidden = true;
    clearShareFindMarks();
    docFindQuery = "";
    docFindIdx = -1;
    updateShareFindCount();
  }
  /* 代码块装饰：语言标签常驻；复制按钮只在分享者允许复制时出现 */
  var SHARE_CODE_LANG_LABEL = {
    sql: "SQL", java: "Java", properties: "Properties", js: "JavaScript", ts: "TypeScript",
    python: "Python", json: "JSON", xml: "XML", yaml: "YAML", shell: "Shell",
    html: "HTML", css: "CSS", go: "Go", cpp: "C++"
  };
  function decorateShareCodeBlocks(body){
    if(!body) return;
    var pres = body.querySelectorAll("pre");
    for(var i = 0; i < pres.length; i++){
      var pre = pres[i];
      if(pre.parentElement && pre.parentElement.classList.contains("share-code")) continue;
      var wrap = document.createElement("div");
      wrap.className = "share-code";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var code = pre.querySelector("code");
      var m = String(pre.className || "").match(/(?:^|\s)language-([A-Za-z0-9_+#.-]+)/)
        || (code && String(code.className || "").match(/(?:^|\s)language-([A-Za-z0-9_+#.-]+)/));
      if(m){
        var lang = m[1].toLowerCase();
        wrap.setAttribute("data-lang", lang);
        var tag = document.createElement("span");
        tag.className = "share-code-lang";
        tag.textContent = SHARE_CODE_LANG_LABEL[lang] || lang;
        wrap.appendChild(tag);
      }
      if(!docAllowCopy) continue;
      var tools = document.createElement("div");
      tools.className = "share-code-tools";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "share-code-btn";
      btn.setAttribute("data-share-code-copy", "1");
      btn.setAttribute("aria-label", "复制代码");
      btn.textContent = "复制";
      tools.appendChild(btn);
      wrap.appendChild(tools);
    }
  }
  function copyShareCode(btn){
    if(!docAllowCopy) return;
    var wrap = btn.closest(".share-code");
    var pre = wrap && wrap.querySelector("pre");
    if(!pre) return;
    var text = pre.textContent || "";
    var done = function(ok){
      btn.classList.toggle("is-copied", !!ok);
      btn.textContent = ok ? "已复制" : "复制失败";
      setTimeout(function(){ btn.classList.remove("is-copied"); btn.textContent = "复制"; }, 1600);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ done(true); }).catch(function(){ done(false); });
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try{ ok = document.execCommand("copy"); }catch(e){ ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }
  function renderDoc(d){
    $("view-gantt").classList.remove("on");
    $("view-doc").classList.add("on");
    $("docShareTitle").textContent = d.title || "文档";
    document.title = (d.title || "文档") + " · 只读分享";
    var meta = [];
    if (d.workspaceName) meta.push(d.workspaceName);
    if (d.owner) meta.push(d.owner);
    meta.push(d.updatedAt ? ("更新于 " + String(d.updatedAt).replace("T", " ").substring(0, 16)) : "更新时间未知");
    $("docShareMeta").textContent = meta.join(" · ");
    var noCopy = d.allowCopy === false;
    docAllowCopy = !noCopy;
    $("docShareFoot").textContent = "生成时间 " + (d.generatedAt ? String(d.generatedAt).replace("T", " ").substring(0, 16) : "—") +
      " · 只读链接，仅含文档正文" + (noCopy ? " · 分享者已关闭复制与打印" : "");
    document.body.classList.toggle("share-no-copy", noCopy);
    var isSheet = d.format === "sheet";
    var findBtn = $("docShareFindBtn"), tocBtn = $("docShareTocBtn"), toc = $("docShareToc");
    if(findBtn) findBtn.hidden = isSheet;
    if(isSheet){
      if(tocBtn) tocBtn.hidden = true;
      if(toc) toc.hidden = true;
      closeShareFind();
    }
    if (noCopy) {
      var printBlock = document.createElement("div");
      printBlock.className = "share-print-block";
      printBlock.textContent = "分享者已关闭复制与打印，本页不提供打印内容。";
      document.body.appendChild(printBlock);
      document.addEventListener("copy", function (e) { e.preventDefault(); });
      document.addEventListener("cut", function (e) { e.preventDefault(); });
      document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }
    var body = $("docShareBody");
    body.innerHTML = '<div class="share-empty">加载正文…</div>';
    if (d.format === "sheet") {
      /* 表格分享：只读挂载 Univer 工作簿（不再是纯 HTML 表格，保留合并与样式） */
      var wb = null;
      try { wb = JSON.parse(d.content || ""); } catch (e) { wb = null; }
      if (!wb || !wb.sheets) {
        body.innerHTML = '<div class="share-error">表格正文为空或无法解析</div>';
        return;
      }
      body.classList.add("share-sheet");
      openSheetView({ container: body, snapshot: wb, readOnly: true }).catch(function (ex) {
        body.innerHTML = '<div class="share-error">' + esc(ex.message || "表格渲染失败") + '</div>';
      });
      return;
    }
    var prep = d.format === "univer"
      ? Promise.all([loadMdLib(), ensureVendor()])
      : loadMdLib();
    prep.then(function () {
      var html;
      if (d.format === "univer") {
        var snap = parseSnapshot(d.content);
        html = snap ? snapshotToHtml(snap) : "";
      } else if (d.format === "markdown") {
        try { html = window.marked.parse(d.content || "", { gfm: true, breaks: false }); } catch (e) { html = ""; }
      } else {
        html = d.content || "";
      }
      body.innerHTML = window.DOMPurify.sanitize(html);
      var links = body.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        links[i].setAttribute("target", "_blank");
        links[i].setAttribute("rel", "noopener noreferrer");
      }
      decorateShareCodeBlocks(body);
      buildShareToc(body);
      if(docFindQuery) runShareFind(docFindQuery);
    }).catch(function (ex) {
      body.innerHTML = '<div class="share-error">' + esc(ex.message || "正文渲染失败") + '</div>';
    });
  }

  /* 交付报告分享：kind=delivery。只渲染冻结快照，没有任何写入口；
     数字仍可点开看口径与来源记录，但不给跳原始记录的入口——接收人没有账号。 */
  var dlNote = null, dlShare = null, dlLayer = null, dlToken = "", dlUnlockPwd = "";
  function bootDelivery(token) {
    dlToken = token;
    dlUnlockPwd = "";
    fetch(API.base + "/api/share/delivery?token=" + encodeURIComponent(token)
      + (document.referrer ? "&from=" + encodeURIComponent(document.referrer) : ""), { credentials: "omit" })
      .then(function (r) { return r.text(); })
      .then(function (txt) { return JSON.parse(txt); })
      .then(function (j) {
        if (!j || j.code !== 0) throw new Error((j && j.message) || "链接无效或已过期");
        if (j.data && j.data.passwordRequired) renderDeliveryGate(j.data);
        else renderDelivery(j.data);
      })
      .catch(function (ex) {
        showShareError({
          detail: ex.message || "网络异常",
          hint: "链接可能已过期或被分享者停止分享；可稍后重试，或向分享者重新获取链接。",
          retry: true
        });
      });
  }
  /* 设置了访问密码：先给一张只含编号与说明的壳，校验通过后才取正文 */
  function renderDeliveryGate(shell) {
    dlShare = shell;
    dlNote = null;
    $("view-gantt").classList.remove("on");
    $("view-delivery-share").classList.add("on");
    document.title = "需要访问密码 · 沙漏";
    $("deliveryShareBody").innerHTML =
      '<div class="dl-share-gate"><div class="dl-share-gate-card">'
      + '<span class="dl-mark">' + DD.mark + "</span>"
      + '<h1>这份交付报告受密码保护</h1>'
      + '<p>' + esc([shell.workspaceName, shell.docNo, shell.title].filter(Boolean).join(" · ")) + "</p>"
      + '<form id="dlGateForm"><input class="input" type="password" id="dlGatePwd" maxlength="32" autocomplete="current-password"'
      + ' placeholder="请输入访问密码" aria-label="访问密码">'
      + '<button class="btn primary" type="submit">打开说明</button></form>'
      + '<div class="dl-share-gate-msg" id="dlGateMsg" role="alert"></div>'
      + '<p class="dl-share-gate-foot">密码由分享者单独告知；连续失败可向分享者确认。</p>'
      + "</div></div>"
      + watermarkHTML(shell.watermarkText);
    var form = $("dlGateForm");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pwd = $("dlGatePwd").value || "";
      var msg = $("dlGateMsg");
      var btn = form.querySelector("button");
      msg.textContent = "";
      if (!pwd.trim()) { msg.textContent = "请输入访问密码"; return; }
      btn.disabled = true;
      btn.textContent = "校验中…";
      fetch(API.base + "/api/share/delivery/unlock", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: dlToken, password: pwd, from: document.referrer || "" })
      }).then(function (r) { return r.text(); }).then(function (txt) {
        var j = JSON.parse(txt);
        if (!j || j.code !== 0) throw new Error((j && j.message) || "访问密码不正确");
        dlUnlockPwd = pwd;
        renderDelivery(j.data);
      }).catch(function (ex) {
        btn.disabled = false;
        btn.textContent = "打开说明";
        msg.textContent = ex.message || "访问密码不正确";
        var input = $("dlGatePwd");
        if (input) { input.focus(); input.select(); }
      });
    });
    var input = $("dlGatePwd");
    if (input) input.focus();
  }
  function watermarkHTML(text) {
    var t = String(text || "").trim().slice(0, 60);
    if (!t) return "";
    var spans = "";
    for (var i = 0; i < 30; i++) spans += "<span>" + esc(t) + "</span>";
    return '<div class="dl-share-wm" aria-hidden="true">' + spans + "</div>";
  }
  /* 下载留痕：只记录，失败不打扰接收人；密码保护的分享要带上解锁密码，否则后端拒记 */
  function logShareDownload() {
    if (!dlToken) return;
    try {
      fetch(API.base + "/api/share/delivery/visit", {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: dlToken,
          action: "download",
          password: dlUnlockPwd,
          from: document.referrer || ""
        })
      }).catch(function () { /* 留痕失败不影响文件 */ });
    } catch (e) { /* 老浏览器忽略 */ }
  }
  function renderDelivery(d) {
    dlShare = d;
    dlNote = d.note || {};
    /* 接收人直接 Ctrl+P 也要印出同一份纸张；甘特分享页 dlNote 为空，不接管打印 */
    registerDeliveryPrintSource(function () {
      return dlNote ? watermarkHTML(dlShare && dlShare.watermarkText)
        + DD.sheetMarkup(dlNote, { readonly: true, clean: true, a4: true }) : null;
    });
    $("view-gantt").classList.remove("on");
    $("view-delivery-share").classList.add("on");
    var title = (dlNote.projectName || "交付报告") + " · " + (dlNote.versionName || "");
    document.title = title + " · 只读分享";
    var sub = [d.workspaceName, DD.toneName(dlNote.options && dlNote.options.tone), d.docNo,
      "生成于 " + DD.timeText(d.createdAt), "有效至 " + DD.timeText(d.expiresAt)].filter(Boolean).join(" · ");
    $("deliveryShareBody").innerHTML =
      '<div class="dl-share-top"><span class="dl-mark">' + DD.mark + "</span>"
      + '<div><div class="st-t">' + esc(title) + '</div><div class="st-s">' + esc(sub) + "</div></div>"
      + '<span class="grow"></span>'
      + '<button class="btn sm" type="button" id="dlShareSources">数字口径</button>'
      + (d.allowDownload ? '<button class="btn sm primary" type="button" id="dlSharePdf">下载 PDF</button>' : "")
      + "</div>"
      + DD.sheetMarkup(dlNote, { readonly: true, clean: true })
      + '<div class="dl-share-foot">这是一份不可变快照：分享者导出时的内容已冻结，之后系统里的变化不会改动本页。'
      + "数字全部来自系统记录，点任意数字可看它的统计口径与原始记录；标注「未记录 / 未验证」的部分表示系统内确实没有记录，未做推断。<br>"
      + "<b>" + esc(d.docNo || "未编号") + "</b>"
      + (d.contentHash ? " · 内容校验值 " + esc(String(d.contentHash).slice(0, 16)) : "")
      + " · 只读链接，不含内部备注"
      + (d.allowDownload ? " · 可在浏览器打印对话框里选「存为 PDF」" : " · 分享者未开放下载")
      + "</div>"
      + watermarkHTML(d.watermarkText);
    $("dlShareSources").addEventListener("click", function () { openDeliverySources(); });
    var pdf = $("dlSharePdf");
    if (pdf) pdf.addEventListener("click", function () {
      logShareDownload();
      printDeliveryPaper(watermarkHTML(d.watermarkText)
        + DD.sheetMarkup(dlNote, { readonly: true, clean: true, a4: true }));
    });
    $("deliveryShareBody").addEventListener("click", function (e) {
      var m = e.target.closest('[data-dl-act="source"]');
      if (m) openDeliverySource(m.dataset.dlSrc);
    });
  }
  function deliveryLayer(title, desc, body) {
    closeDeliveryLayer();
    dlLayer = document.createElement("div");
    dlLayer.className = "modal-layer open";
    dlLayer.setAttribute("role", "dialog");
    dlLayer.setAttribute("aria-modal", "true");
    dlLayer.innerHTML = '<div class="sheet md">'
      + '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0"><h2>' + esc(title) + "</h2>"
      + '<div class="desc">' + esc(desc) + "</div></div>"
      + '<button class="btn sm" type="button" data-dl-share-close>关闭</button></div>'
      + '<div class="sheet-body">' + body + "</div></div>";
    document.body.appendChild(dlLayer);
    document.body.style.overflow = "hidden";
    dlLayer.addEventListener("click", function (e) {
      if (e.target === dlLayer || e.target.closest("[data-dl-share-close]")) closeDeliveryLayer();
    });
    var btn = dlLayer.querySelector("[data-dl-share-close]");
    if (btn) btn.focus();
  }
  function closeDeliveryLayer() {
    if (!dlLayer) return;
    if (dlLayer.parentNode) dlLayer.parentNode.removeChild(dlLayer);
    dlLayer = null;
    document.body.style.overflow = "";
  }
  function sourceRecords(rows) {
    if (!rows.length) return '<div class="dl-missing">该数字没有可列出的明细记录。</div>';
    return rows.map(function (x) {
      return '<div class="dl-srcrec"><span class="si">' + esc(x.id) + '</span><div class="sc"><b>'
        + esc(x.m) + "</b><span>" + esc(x.s) + "</span></div></div>";
    }).join("");
  }
  function openDeliverySource(key) {
    if (!dlNote) return;
    var s = DD.sourceInfo(dlNote, key);
    deliveryLayer(s.title, "数字只读。下面是它的统计口径与原始记录。",
      '<div class="dl-caliber">' + esc(s.caliber) + "</div>" + sourceRecords(s.rows));
  }
  function openDeliverySources() {
    if (!dlNote) return;
    var rows = DD.sourcesOverview(dlNote).map(function (x) {
      return { id: "·", m: x.name + " ← " + x.from, s: x.table };
    });
    deliveryLayer("数据来源总览", (dlShare.docNo || "") + " · 全部为只读聚合，接收人看不到内部备注",
      '<div class="dl-caliber">生成过程只读：一次取回版本、发布、测试、工时与变更记录后冻结成快照，本页不再实时计算。</div>'
      + sourceRecords(rows));
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && dlLayer) closeDeliveryLayer();
  });

  $("shareScale").addEventListener("change", function () {
    state.scale = this.value === "week" || this.value === "month" ? this.value : "day";
    render();
  });
  $("shareShowDone").addEventListener("change", function () { state.showDone = this.checked; render(); });
  /* 宽度变化会改标签列宽（900px 断点），依赖线/今日线需要重新定位 */
  window.addEventListener("resize", function () { if (state.data) render(); });
  $("shareToday").addEventListener("click", function () {
    if (!state.range) return;
    scroll.scrollLeft = Math.max(0, dayDiff(today(), state.range.start) * state.dayW - 160);
  });
  $("shareErrorRetry").addEventListener("click", function () { location.reload(); });

  /* 文档分享：目录开合、目录跳转、查找条与 Ctrl+F */
  var docTocBtn = $("docShareTocBtn");
  if(docTocBtn) docTocBtn.addEventListener("click", function () {
    var toc = $("docShareToc");
    if(!toc) return;
    toc.hidden = !toc.hidden;
    syncShareTocBtn();
  });
  var docFindBtn = $("docShareFindBtn");
  if(docFindBtn) docFindBtn.addEventListener("click", openShareFind);
  var docFindInput = $("docShareFindInput");
  if(docFindInput){
    docFindInput.addEventListener("input", function () { runShareFind(this.value); });
    docFindInput.addEventListener("keydown", function (e) {
      if(e.key === "Enter"){ e.preventDefault(); stepShareFind(e.shiftKey ? -1 : 1); }
      else if(e.key === "Escape"){ e.preventDefault(); closeShareFind(); }
    });
  }
  var docView = $("view-doc");
  if(docView) docView.addEventListener("click", function (e) {
    var cc = e.target.closest("[data-share-code-copy]");
    if(cc){ copyShareCode(cc); return; }
    var t = e.target.closest("[data-share-toc]");
    if(t){
      e.preventDefault();
      var el = document.getElementById(t.dataset.shareToc);
      if(el) el.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    var f = e.target.closest("[data-share-find]");
    if(!f) return;
    var act = f.dataset.shareFind;
    if(act === "prev") stepShareFind(-1);
    else if(act === "next") stepShareFind(1);
    else closeShareFind();
  });
  document.addEventListener("keydown", function (e) {
    if(e.key === "Escape" && $("docShareFindBar") && !$("docShareFindBar").hidden) closeShareFind();
  });
  document.addEventListener("keydown", function (e) {
    if(!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if(String(e.key).toLowerCase() !== "f") return;
    var view = $("view-doc");
    if(!view || !view.classList.contains("on")) return;
    var t = e.target;
    if(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var findBtn = $("docShareFindBtn");
    if(!findBtn || findBtn.hidden) return;
    e.preventDefault();
    openShareFind();
  });

  boot();
