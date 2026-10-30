/* 只读分享页：独立渲染，不依赖 app.js，也不发任何写请求 */
(function () {
  "use strict";

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
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseDate(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function dayDiff(a, b) { return Math.round((a - b) / 86400000); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fmtMD(d) { return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function fmtFull(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function priorityColor(p) {
    return { P0: "var(--p0)", P1: "var(--p1)", P2: "var(--p2)", P3: "var(--p3)" }[p] || "var(--p2)";
  }
  function prioritySoft(p) {
    return { P0: "var(--p0-soft)", P1: "var(--p1-soft)", P2: "var(--p2-soft)", P3: "var(--p3-soft)" }[p] || "var(--p2-soft)";
  }

  function statusOf(t) {
    var done = t.boardColumn === "done";
    var days = 0;
    if (!done && t.dueDate && t.dueDate < iso(today())) {
      days = Math.abs(dayDiff(parseDate(t.dueDate), today()));
    }
    if (done) return { key: "done", c: "var(--success)", soft: "var(--success-soft)", bd: "var(--success-border)", label: "已完成" };
    if (t.blocked) return { key: "blocked", c: "var(--warning)", soft: "var(--warning-soft)", bd: "var(--warning-border)", label: "阻塞" + (days ? " · 逾期 " + days + " 天" : "") };
    if (days > 0) return { key: "overdue", c: "var(--danger)", soft: "var(--danger-soft)", bd: "var(--danger-border)", label: "逾期 " + days + " 天" };
    return { key: "doing", c: priorityColor(t.priority), soft: prioritySoft(t.priority), bd: "var(--border-strong)", label: "" };
  }

  function effectiveDayW() {
    if (state.scale === "week") return 12;
    if (state.scale === "month") return 5;
    return state.zoom;
  }
  function adjustRange(range) {
    if (state.scale === "week") {
      var s = addDays(range.start, -((range.start.getDay() + 6) % 7));
      var e = addDays(range.end, 6 - ((range.end.getDay() + 6) % 7));
      range.start = s; range.end = e;
    } else if (state.scale === "month") {
      range.start = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      range.end = new Date(range.end.getFullYear(), range.end.getMonth() + 1, 0);
    }
    range.days = dayDiff(range.end, range.start) + 1;
    return range;
  }
  function isoWeek(d) {
    var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    return Math.ceil((((x - y0) / 86400000) + 1) / 7);
  }
  function monthsHTML(range, dayW) {
    var out = "", cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1), first = true;
    while (cur <= range.end) {
      var from = cur < range.start ? range.start : cur;
      var next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      var to = addDays(next, -1);
      if (to > range.end) to = range.end;
      var label = (first || cur.getMonth() === 0) ? (cur.getFullYear() + "年" + (cur.getMonth() + 1) + "月") : ((cur.getMonth() + 1) + "月");
      out += '<span class="gantt-month" style="width:' + ((dayDiff(to, from) + 1) * dayW) + 'px">' + label + '</span>';
      first = false; cur = next;
    }
    return out;
  }
  function daysHTML(range, dayW) {
    var out = "", t = today();
    for (var i = 0; i < range.days; i++) {
      var d = addDays(range.start, i);
      var cls = "gantt-day" + ((d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "") + (iso(d) === iso(t) ? " today" : "");
      out += '<span class="' + cls + '" style="width:' + dayW + 'px">' + d.getDate() + '</span>';
    }
    return out;
  }
  function weeksHTML(range, dayW) {
    var out = "", t = iso(today());
    for (var i = 0; i < range.days; i += 7) {
      var d = addDays(range.start, i), e = addDays(d, 6);
      if (e > range.end) e = range.end;
      var cls = "gantt-week" + (iso(d) <= t && t <= iso(e) ? " today" : "");
      out += '<span class="' + cls + '" style="width:' + ((dayDiff(e, d) + 1) * dayW) + 'px">W' + isoWeek(d) + '</span>';
    }
    return out;
  }
  function monthCellsHTML(range, dayW) {
    var out = "", cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    while (cur <= range.end) {
      var next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      var from = cur < range.start ? range.start : cur;
      var to = addDays(next, -1);
      if (to > range.end) to = range.end;
      out += '<span class="gantt-month" style="width:' + ((dayDiff(to, from) + 1) * dayW) + 'px">' + (cur.getMonth() + 1) + ' 月</span>';
      cur = next;
    }
    return out;
  }
  function headHTML(range, dayW) {
    if (state.scale === "week") {
      return '<div class="gantt-months">' + monthsHTML(range, dayW) + '</div><div class="gantt-weeks">' + weeksHTML(range, dayW) + '</div>';
    }
    if (state.scale === "month") {
      var years = "", cur = new Date(range.start.getFullYear(), 0, 1);
      while (cur <= range.end) {
        var y = cur.getFullYear();
        var ys = cur < range.start ? range.start : cur;
        var ye = new Date(y, 11, 31);
        if (ye > range.end) ye = range.end;
        years += '<span class="gantt-year" style="width:' + ((dayDiff(ye, ys) + 1) * dayW) + 'px">' + y + ' 年</span>';
        cur = new Date(y + 1, 0, 1);
      }
      return '<div class="gantt-years">' + years + '</div><div class="gantt-months is-scale-month">' + monthCellsHTML(range, dayW) + '</div>';
    }
    return '<div class="gantt-months">' + monthsHTML(range, dayW) + '</div><div class="gantt-days">' + daysHTML(range, dayW) + '</div>';
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
      scroll.innerHTML = '<div class="share-empty">当前没有可展示的排期任务。</div>';
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
      var meta = '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>';
      if (t.owner) meta += '<span class="ellipsis">' + esc(t.owner) + '</span>';
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
      geom[t.id] = { top: top, s: x.s, e: x.e };
      top += ROW_H;
    });
    scroll.innerHTML = '<div class="gantt-grid" style="--gantt-label-w:' + LABEL_W + 'px;--gantt-day-w:' + dayW +
        'px;--gantt-row-h:' + ROW_H + 'px;">' +
      '<div class="gantt-head"><div class="gantt-corner">任务 <span class="gantt-corner-meta">' + dated.length + '</span></div>' +
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
      /* 连接点按依赖类型取：FS 前驱尾部→后继头部，SS 头部→头部，FF 尾部→尾部，SF 头部→尾部 */
      var fromDay = (dep === "SS" || dep === "SF") ? a.s : a.e;
      var toDay = (dep === "FF" || dep === "SF") ? b.e : b.s;
      var x1 = lw + (dayDiff(fromDay, range.start) + ((dep === "FS" || dep === "FF") ? 1 : 0)) * dayW;
      var x2 = lw + dayDiff(toDay, range.start) * dayW + ((dep === "FF" || dep === "SF") ? dayW : 0);
      var y1 = a.top + ROW_H / 2, y2 = b.top + ROW_H / 2;
      var path = x2 >= x1 + 24
        ? "M" + x1 + "," + y1 + " H" + Math.round((x1 + x2) / 2) + " V" + y2 + " H" + (x2 - 5)
        : "M" + x1 + "," + y1 + " H" + (x1 + 10) + " V" + (y2 + 16) + " H" + (x2 - 2);
      /* 冲突判定与前台一致：后继端点早于「前驱端点 + 滞后」，含尾日 */
      var minDay = addDays(fromDay, lag + ((dep === "FS" || dep === "FF") ? 1 : 0));
      var conflict = toDay < minDay;
      out.push('<path class="gantt-dep' + (conflict ? " is-conflict" : "") + '" d="' + path + '" marker-end="url(#shareArrow)"></path>');
    });
    if (!out.length) return "";
    return '<svg class="gantt-deps" width="' + (lw + totalW) + '" height="' + bodyH +
      '" viewBox="0 0 ' + (lw + totalW) + ' ' + bodyH + '" style="height:auto">' +
      '<defs><marker id="shareArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)"></path></marker></defs>' + out.join("") + '</svg>';
  }

  function boot() {
    var token = "";
    try { token = new URLSearchParams(location.search).get("token") || ""; } catch (e) { token = ""; }
    if (!token) {
      scroll.innerHTML = '<div class="share-empty">链接缺少 token 参数，无法查看。</div>';
      return;
    }
    fetch("/api/share/gantt?token=" + encodeURIComponent(token), { credentials: "omit" })
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
        scroll.innerHTML = '<div class="share-error">无法打开分享：' + esc(ex.message || "网络异常") + '</div>';
      });
  }

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

  boot();
})();
