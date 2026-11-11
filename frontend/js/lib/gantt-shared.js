/* ==========================================================================
   gantt-shared.js · 甘特图纯函数（日期 / 刻度表头 / 依赖线几何）
   主页面（app.js）与只读分享页（share.js）共用。
   约定：只做计算与字符串拼接，不读写 DOM，也不读写全局状态；
   所有需要「今天」「当前刻度」的地方都由调用方以参数传入。
   ========================================================================== */

  /* ==================== 日期 ==================== */
  function pad2(n) { return n < 10 ? ("0" + n) : String(n); }
  function startOfDay(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function iso(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  /* 接受 "YYYY-M-D" 与 "YYYY-MM-DDTHH:mm…"；非法值返回 null */
  function parseDate(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
  /* 周一 / 周日：getDay() 周日为 0，统一折算成「周一开头的一周」 */
  function mondayOf(d) { var x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
  function sundayOf(d) { var x = startOfDay(d); return addDays(x, 6 - ((x.getDay() + 6) % 7)); }
  function isoWeek(d) {
    var x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    return String(Math.ceil((((x - yearStart) / 86400000) + 1) / 7));
  }

  /* ==================== 格式化 ==================== */
  /* 主页面口径：M月D日；分享页口径：MM-DD。两种都保留，由调用方选，避免两边显示串味 */
  function fmtMonthDay(d) { return d ? ((d.getMonth() + 1) + "月" + d.getDate() + "日") : "—"; }
  function fmtShortMonthDay(d) { return d ? (pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())) : "—"; }
  function fmtFullDate(d) { return d ? (d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日") : "—"; }
  function fmtDashMD(d) { return d ? (pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())) : "—"; }

  /* ==================== 刻度 / 区间 ==================== */
  /* day / week / month 三种刻度下每天占的像素；日刻度用调用方给的缩放档位 */
  function scaleDayW(scale, zoomDayW) {
    if (scale === "week") return 12;
    if (scale === "month") return 5;
    return zoomDayW;
  }
  /* 周刻度对齐到周一，月刻度对齐到自然月边界；返回新对象，不改入参 */
  function adjustRange(range, scale) {
    var start = range.start, end = range.end;
    if (scale === "week") {
      start = mondayOf(start);
      end = sundayOf(end);
    } else if (scale === "month") {
      start = new Date(start.getFullYear(), start.getMonth(), 1);
      end = new Date(end.getFullYear(), end.getMonth() + 1, 0);
    }
    return { start: start, end: end, days: dayDiff(end, start) + 1 };
  }

  /* ==================== 表头 HTML ==================== */
  /* 轴末尾常常只落几天，月格只有 20–30px：按可用宽度退成「1月」/「1」，
     避免 "2027年1月" 被 overflow:hidden 从中间裁断。 */
  function estTextW(s){
    var w = 0;
    for(var i = 0; i < s.length; i++){
      w += s.charCodeAt(i) > 255 ? 11 : 6.2;
    }
    return w;
  }
  function fitMonthLabel(width, full, shortLabel){
    if(estTextW(full) <= width - 16) return { text: full, cls: "" };
    if(estTextW(shortLabel) <= width - 16) return { text: shortLabel, cls: "" };
    if(estTextW(shortLabel) <= width - 4) return { text: shortLabel, cls: " is-compact" };
    var num = String(parseInt(shortLabel, 10));
    if(estTextW(num) <= width - 4) return { text: num, cls: " is-compact" };
    return { text: "", cls: " is-compact" };
  }
  function monthsHTML(range, dayW) {
    var out = "";
    var cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    var first = true;
    while (cur <= range.end) {
      var from = cur < range.start ? range.start : cur;
      var next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      var to = addDays(next, -1);
      if (to > range.end) to = range.end;
      var w = (dayDiff(to, from) + 1) * dayW;
      /* 同年只在首段和 1 月标年份，避免每个月都重复 "2026年" */
      var label = (first || cur.getMonth() === 0)
        ? (cur.getFullYear() + "年" + (cur.getMonth() + 1) + "月")
        : ((cur.getMonth() + 1) + "月");
      var fit = fitMonthLabel(w, label, (cur.getMonth() + 1) + "月");
      out += '<span class="gantt-month' + fit.cls + '" style="width:' + w + 'px" title="' + label + '">' + fit.text + '</span>';
      first = false;
      cur = next;
    }
    return out;
  }
  function daysHTML(range, dayW, todayIso) {
    var out = "";
    for (var i = 0; i < range.days; i++) {
      var d = addDays(range.start, i);
      var cls = "gantt-day";
      if (d.getDay() === 0 || d.getDay() === 6) cls += " weekend";
      if (todayIso && iso(d) === todayIso) cls += " today";
      out += '<span class="' + cls + '" style="width:' + dayW + 'px">' + d.getDate() + '</span>';
    }
    return out;
  }
  function weeksHTML(range, dayW, todayIso) {
    var out = "";
    for (var i = 0; i < range.days; i += 7) {
      var d = addDays(range.start, i);
      var end = addDays(d, 6);
      if (end > range.end) end = range.end;
      var w = (dayDiff(end, d) + 1) * dayW;
      var isToday = !!todayIso && iso(d) <= todayIso && todayIso <= iso(end);
      out += '<span class="gantt-week' + (isToday ? " today" : "") + '" style="width:' + w + 'px">W' + isoWeek(d) + '</span>';
    }
    return out;
  }
  function yearsHTML(range, dayW) {
    var out = "", cur = new Date(range.start.getFullYear(), 0, 1);
    while (cur <= range.end) {
      var y = cur.getFullYear();
      var from = cur < range.start ? range.start : cur;
      var yEnd = new Date(y, 11, 31);
      var to = yEnd > range.end ? range.end : yEnd;
      var w = (dayDiff(to, from) + 1) * dayW;
      out += '<span class="gantt-year" style="width:' + w + 'px">' + y + ' 年</span>';
      cur = new Date(y + 1, 0, 1);
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
      var w = (dayDiff(to, from) + 1) * dayW;
      var shortLabel = (cur.getMonth() + 1) + "月";
      var fit = fitMonthLabel(w, (cur.getMonth() + 1) + " 月", shortLabel);
      out += '<span class="gantt-month' + fit.cls + '" style="width:' + w + 'px" title="' + shortLabel + '">' + fit.text + '</span>';
      cur = next;
    }
    return out;
  }
  function headHTML(range, dayW, scale, todayIso) {
    if (scale === "week") {
      return '<div class="gantt-months">' + monthsHTML(range, dayW) + '</div>' +
        '<div class="gantt-weeks">' + weeksHTML(range, dayW, todayIso) + '</div>';
    }
    if (scale === "month") {
      return '<div class="gantt-years">' + yearsHTML(range, dayW) + '</div>' +
        '<div class="gantt-months is-scale-month">' + monthCellsHTML(range, dayW) + '</div>';
    }
    return '<div class="gantt-months">' + monthsHTML(range, dayW) + '</div>' +
      '<div class="gantt-days">' + daysHTML(range, dayW, todayIso) + '</div>';
  }

  /* ==================== 依赖线 ==================== */
  function depTypeOf(type) {
    return (type === "SS" || type === "FF" || type === "SF") ? type : "FS";
  }
  /* 依赖端点：
     typed（分享页）：FS 前驱尾→后继头、SS 头→头、FF 尾→尾、SF 头→尾；
       FS/FF 从前驱尾日之后起画（startPad 1），FF/SF 画到后继尾日右侧（endPad 1）。
     fsLike（主页面现状）：所有类型都按 FS 样式连在前驱尾日之后、后继头日左侧，
       视觉保持不变。 */
  function depAnchors(type, pred, succ, fsLike) {
    if (fsLike) return { fromDay: pred.e, toDay: succ.s, startPad: 1, endPad: 0 };
    var t = depTypeOf(type);
    return {
      fromDay: (t === "SS" || t === "SF") ? pred.s : pred.e,
      toDay: (t === "FF" || t === "SF") ? succ.e : succ.s,
      startPad: (t === "FS" || t === "FF") ? 1 : 0,
      endPad: (t === "FF" || t === "SF") ? 1 : 0
    };
  }
  /* opts: {dayW, labelW, rangeStart, rowH, headH, predTop, succTop, fsLike}
     分享页 geom 的 top 已含表头 → headH 传 0；主页面 geom 的 top 从 body 起算 → headH 传 54 */
  function depGeometry(type, pred, succ, opts) {
    opts = opts || {};
    var a = depAnchors(type, pred, succ, !!opts.fsLike);
    var dayW = opts.dayW || 1, labelW = opts.labelW || 0;
    var rowH = opts.rowH || 0, headH = opts.headH || 0;
    return {
      x1: labelW + (dayDiff(a.fromDay, opts.rangeStart) + a.startPad) * dayW,
      y1: headH + (pred.top || 0) + rowH / 2,
      x2: labelW + dayDiff(a.toDay, opts.rangeStart) * dayW + a.endPad * dayW,
      y2: headH + (succ.top || 0) + rowH / 2
    };
  }
  /* 正向（后继在前驱右侧 ≥24px）画折线；
     首尾相接或后继更靠左时，从后继条无遮挡的一侧绕到开始日左侧，再向右指入（不能穿过任务条） */
  function depPath(x1, y1, x2, y2) {
    var end = x2 - 2;
    if (x2 >= x1 + 24) {
      return "M" + x1 + "," + y1 + " H" + Math.round((x1 + x2) / 2) + " V" + y2 + " H" + end;
    }
    var wrapY = y2 > y1 ? y2 - 16 : y2 + 16;
    return "M" + x1 + "," + y1 + " H" + (x1 + 10) + " V" + wrapY +
      " H" + (x2 - 10) + " V" + y2 + " H" + end;
  }
  /* 冲突口径（主页面为准）：前驱已完成不算冲突；
     SS: 后继开始 < 前驱开始 + lag；FF: 后继结束 < 前驱结束 + lag；
     SF: 后继结束 < 前驱开始 + lag；FS: 后继开始 < 前驱结束 + 1 + lag。
     pred / succ 可带 as/ae（月视图里未裁剪的真实日期），缺省用 s/e。 */
  function depConflict(pred, succ, type, lag) {
    if (pred.done) return false;
    var l = Number(lag) || 0;
    var ps = pred.as || pred.s, pe = pred.ae || pred.e;
    var ss = succ.as || succ.s, se = succ.ae || succ.e;
    var t = depTypeOf(type);
    if (t === "SS") return ss < addDays(ps, l);
    if (t === "FF") return se < addDays(pe, l);
    if (t === "SF") return se < addDays(ps, l);
    return ss < addDays(pe, 1 + l);
  }

  const GS = {
    /* 日期 */
    pad2: pad2,
    startOfDay: startOfDay,
    addDays: addDays,
    iso: iso,
    parseDate: parseDate,
    dayDiff: dayDiff,
    mondayOf: mondayOf,
    sundayOf: sundayOf,
    isoWeek: isoWeek,
    /* 格式化 */
    fmtMonthDay: fmtMonthDay,
    fmtShortMonthDay: fmtShortMonthDay,
    fmtFullDate: fmtFullDate,
    fmtDashMD: fmtDashMD,
    /* 刻度 / 区间 */
    scaleDayW: scaleDayW,
    adjustRange: adjustRange,
    /* 表头 */
    monthsHTML: monthsHTML,
    daysHTML: daysHTML,
    weeksHTML: weeksHTML,
    yearsHTML: yearsHTML,
    monthCellsHTML: monthCellsHTML,
    headHTML: headHTML,
    /* 依赖线 */
    depTypeOf: depTypeOf,
    depAnchors: depAnchors,
    depGeometry: depGeometry,
    depPath: depPath,
    depConflict: depConflict
};

export { GS };
