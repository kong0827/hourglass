/* 只读分享页：独立渲染，不依赖主程序，也不发任何写请求（ES Module 入口） */
import { GS } from "./lib/gantt-shared.js";
import { API } from "./core/api.js";
import { DD } from "./lib/delivery-doc.js";
import { printDeliveryPaper, registerDeliveryPrintSource } from "./lib/download.js";

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
  function renderDoc(d) {
    $("view-gantt").classList.remove("on");
    $("view-doc").classList.add("on");
    $("docShareTitle").textContent = d.title || "文档";
    document.title = (d.title || "文档") + " · 只读分享";
    var meta = [];
    if (d.workspaceName) meta.push(d.workspaceName);
    if (d.owner) meta.push(d.owner);
    meta.push(d.updatedAt ? ("更新于 " + String(d.updatedAt).replace("T", " ").substring(0, 16)) : "更新时间未知");
    $("docShareMeta").textContent = meta.join(" · ");
    $("docShareFoot").textContent = "生成时间 " + (d.generatedAt ? String(d.generatedAt).replace("T", " ").substring(0, 16) : "—") +
      " · 只读链接，仅含文档正文";
    var body = $("docShareBody");
    body.innerHTML = '<div class="share-empty">加载正文…</div>';
    loadMdLib().then(function () {
      var html;
      if (d.format === "markdown") {
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
    }).catch(function (ex) {
      body.innerHTML = '<div class="share-error">' + esc(ex.message || "正文渲染失败") + '</div>';
    });
  }

  /* 交付说明分享：kind=delivery。只渲染冻结快照，没有任何写入口；
     数字仍可点开看口径与来源记录，但不给跳原始记录的入口——接收人没有账号。 */
  var dlNote = null, dlShare = null, dlLayer = null;
  function bootDelivery(token) {
    fetch(API.base + "/api/share/delivery?token=" + encodeURIComponent(token), { credentials: "omit" })
      .then(function (r) { return r.text(); })
      .then(function (txt) { return JSON.parse(txt); })
      .then(function (j) {
        if (!j || j.code !== 0) throw new Error((j && j.message) || "链接无效或已过期");
        renderDelivery(j.data);
      })
      .catch(function (ex) {
        showShareError({
          detail: ex.message || "网络异常",
          hint: "链接可能已过期或被分享者停止分享；可稍后重试，或向分享者重新获取链接。",
          retry: true
        });
      });
  }
  function renderDelivery(d) {
    dlShare = d;
    dlNote = d.note || {};
    /* 接收人直接 Ctrl+P 也要印出同一份纸张；甘特分享页 dlNote 为空，不接管打印 */
    registerDeliveryPrintSource(function () {
      return dlNote ? DD.sheetMarkup(dlNote, { readonly: true, clean: true, a4: true }) : null;
    });
    $("view-gantt").classList.remove("on");
    $("view-delivery-share").classList.add("on");
    var title = (dlNote.projectName || "交付说明") + " · " + (dlNote.versionName || "");
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
      + "</div>";
    $("dlShareSources").addEventListener("click", function () { openDeliverySources(); });
    var pdf = $("dlSharePdf");
    if (pdf) pdf.addEventListener("click", function () {
      printDeliveryPaper(DD.sheetMarkup(dlNote, { readonly: true, clean: true, a4: true }));
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

  boot();
