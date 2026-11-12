/* views/review · 周回顾与 AI 周报 */

import { API } from "../core/api.js";
import { $, doneCountEl, pendingCount, pendingList, progCountEl, reviewHoursEl, reviewPendingBox } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { catColor, catNameById, catTag, progressOf, reqNameById, rt, state, tagChip } from "../core/state.js";
import { activeView, showView } from "../core/router.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, copyToClipboard, esc, toast } from "../core/ui.js";
import { setPageError } from "../core/utils.js";
import { avatarHTML, COLUMNS, PRIORITIES, colName, dayDiff, fmtMD, fmtMinutesShort, fmtShortMD, parseDate, priName, priTagHTML, weekdayCN } from "../lib/format.js";
import { loadReqs, pending } from "./board.js";
import { openLogTable, openTaskTable } from "./manager-shared.js";
import { aiBtnBusy, aiErrMsg, aiUsageText } from "./requirements.js";

function reviewTitle(off){
  return off === -1 ? "上周回顾" : (off === 0 ? "本周回顾" : "回顾");
}
/* 项目维度回顾：选择单个项目时，统计、列表、工时与 AI 周报都只取该项目 */
var REVIEW_REQ_KEY = "ds.reviewReq";
var reviewReqId = (function(){
  try{ return localStorage.getItem(REVIEW_REQ_KEY) || ""; }catch(e){ return ""; }
})();
function reviewParams(off){
  var p = {};
  if(off !== undefined && off !== null) p.weekOffset = off;
  if(reviewReqId) p.reqId = reviewReqId;
  return p;
}
function renderReviewReqOptions(){
  var sel = $("reviewReq");
  if(!sel) return;
  var list = rt.reqList || [];
  /* 项目列表还没加载完时不能把已保存的项目清掉，否则刷新后会退回「全部项目」 */
  var exists = list.some(function(r){ return String(r.id) === reviewReqId; });
  if(reviewReqId && rt.reqsLoaded && !exists) reviewReqId = "";
  sel.innerHTML = '<option value="">全部项目</option>' + list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  if(reviewReqId && !exists){
    /* 列表里暂时没有（尚未加载完）：补一个占位项，保持选中态与请求范围一致 */
    var opt = document.createElement("option");
    opt.value = reviewReqId;
    opt.textContent = "已选项目";
    sel.appendChild(opt);
  }
  sel.value = reviewReqId;
}
function setReviewLoading(){
  $("summaryText").innerHTML = "加载中…";
  $("statGrid").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
    '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  if(reviewHoursEl) reviewHoursEl.innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  if(reviewPendingBox) reviewPendingBox.hidden = true;
  $("peopleBox").innerHTML = '<span class="skel skel-line" style="width:120px"></span>';
  $("catDist").innerHTML = UI.skeletonRows(3);
  $("progList").innerHTML = UI.skeletonRows(3);
  $("reqDist").innerHTML = UI.skeletonRows(3);
  $("doneList").innerHTML = UI.skeletonRows(4);
}
function fetchReview(weekOffset){
  setReviewLoading();
  var seq = ++rt.reviewSeq;
  rt.reviewTarget = weekOffset === undefined ? null : weekOffset;
  API.get("/api/review", reviewParams(weekOffset)).then(function(d){
    if(seq !== rt.reviewSeq) return;
    state.reviewData = d;
    rt.reviewTarget = d.weekOffset;
    renderReview(d);
  }).catch(function(ex){
    if(seq !== rt.reviewSeq) return;
    rt.reviewTarget = null;
    setPageError(ex, ["summaryText","progList","reqDist","doneList"], function(){ enterReviewView(); });
  });
}
function enterReviewView(){
  renderReviewReqOptions();
  loadReqs().then(function(){
    if(activeView !== "review") return;
    var before = reviewReqId;
    renderReviewReqOptions();
    /* 本地记住的项目已被删除/不可见：第一次请求可能 404，列表到位后回到全部项目 */
    if(before !== reviewReqId) fetchReview(null);
  });
  fetchReview(null);
}
function navWeek(delta){
  var base = rt.reviewTarget !== null ? rt.reviewTarget : (state.reviewData ? state.reviewData.weekOffset : -1);
  var off = base + delta;
  /* 先记下目标周：响应回来前连点，以目标周为基准继续翻，不会两次都落在同一周 */
  rt.reviewTarget = off;
  setReviewLoading();
  var seq = ++rt.reviewSeq;
  API.get("/api/review", reviewParams(off)).then(function(d){
    if(seq !== rt.reviewSeq) return;
    state.reviewData = d;
    rt.reviewTarget = d.weekOffset;
    renderReview(d);
  }).catch(function(ex){
    if(seq !== rt.reviewSeq) return;
    rt.reviewTarget = state.reviewData ? state.reviewData.weekOffset : null;
    /* 骨架屏已覆盖内容：有上一周数据就恢复，否则给可重试的错误态 */
    if(state.reviewData) renderReview(state.reviewData);
    else setPageError(ex, ["summaryText","progList","reqDist","doneList"], function(){ enterReviewView(); });
    toast("加载失败：" + (ex.message || "网络异常"), "bad");
  });
}
function changeReviewReq(){
  var sel = $("reviewReq");
  reviewReqId = sel ? (sel.value || "") : "";
  try{ localStorage.setItem(REVIEW_REQ_KEY, reviewReqId); }catch(e){ /* 受限环境忽略 */ }
  /* 切项目后重新自动定位该项目最近有记录的周，避免停在一个空周 */
  fetchReview(null);
}
function buildSummary(d){
  var list = d.completed || [];
  var n = list.length;
  var label = esc(d.label || "该周期");
  var scope = d.reqName ? ("项目「<b>" + esc(d.reqName) + "</b>」 · ") : "";
  var rangeTxt = fmtMD(parseDate(d.weekStart)) + " — " + fmtMD(parseDate(d.weekEnd));
  var progTasks = d.progressTasks || [];
  if(!n && !progTasks.length && !d.doing && !d.backlog && !d.ended){
    return scope + label + "（" + rangeTxt + "）暂无工作记录。把卡片拖入「已完成」列会自动记录完成时间；在工作项里填上进度，回顾里就能看到这一周你做了什么。";
  }
  var parts = [];
  if(n){
    var rate = d.stats.onTimeRate;
    var withDue = d.stats.withDue || 0;
    var p0 = list.filter(function(t){ return t.priority === "P0"; }).length;
    var rateTxt = (withDue === 0)
      ? "，完成项均未设置截止日期"
      : "，按期完成率 <b>" + rate + "%</b>" + (rate < 100 ? "（延期 " + d.stats.late + " 项）" : "，全部按期完成");
    parts.push(scope + "<b>" + label + "（" + rangeTxt + "）</b>共完成 <b>" + n + "</b> 项工作项" + rateTxt +
      (p0 ? "，其中" + esc(priName("P0")) + " <b>" + p0 + "</b> 项。" : "。"));
  }else{
    parts.push(scope + "<b>" + label + "（" + rangeTxt + "）</b>没有已完成的工作项记录。");
  }
  if(n){
    var items = list.slice(0, 12).map(function(t){
      var late = t.completedAt && t.dueDate && t.completedAt > t.dueDate;
      var dt = t.completedAt ? (fmtMD(parseDate(t.completedAt)) + " " + weekdayCN(parseDate(t.completedAt))) : "";
      return "· " + esc(t.title) + "（" + esc(catNameById(t.categoryId)) + " · " + esc(t.owner) +
        (dt ? " · " + dt : "") + (late ? " · <span class='up'>延期</span>" : "") + "）";
    });
    parts.push("完成的工作：" + (list.length > 1 ? "<br>" : "") + items.join("<br>") +
      (list.length > 12 ? "<br>…等共 " + n + " 项" : ""));
  }
  if(progTasks.length){
    var pl = progTasks.slice(0, 8).map(function(t){
      return "· " + esc(t.title) + "（" + progressOf(t) + "%" +
        (t.boardColumn === "done" ? " · 已完成" : " · " + esc(colName(t.boardColumn))) +
        (t.note ? " · " + esc(t.note) : "") + "）";
    });
    parts.push("进行中的工作（" + progTasks.length + " 项）：" + (progTasks.length > 1 ? "<br>" : "") +
      pl.join("<br>") + (progTasks.length > 8 ? "<br>…等" : ""));
  }
  if(d.doing || d.backlog || d.ended){
    parts.push("当前看板：进行中 <b>" + d.doing + "</b> 项、待处理 <b>" + d.backlog + "</b> 项" +
      (d.ended ? "、执行结束 <b>" + d.ended + "</b> 项" : "") +
      (progTasks.length ? "，详细进度见下方「进行中」。" : "。"));
  }
  var c = d.counts || {over:0, today:0};
  if(d.openP0 || c.over){
    parts.push("需关注：" + (d.openP0 ? "<b>" + d.openP0 + "</b> 项 " + esc(priName("P0")) + " 未关闭" : "") +
      (c.over ? (d.openP0 ? "，" : "") + "<b>" + c.over + "</b> 项已逾期" : "") +
      (c.today ? "、<b>" + c.today + "</b> 项今日到期" : "") + "，建议优先处理。");
  }
  return parts.join("<br><br>");
}
function summaryPlain(d){
  var el = document.createElement("div");
  el.innerHTML = buildSummary(d).replace(/<br\s*\/?>/gi, "\n");
  return el.textContent || "";
}
/* ==================== 完成透视 ==================== */
var REVIEW_PIVOT_KEY = "ds.reviewPivot";
var reviewPivot = (function(){
  try{
    var p = JSON.parse(localStorage.getItem(REVIEW_PIVOT_KEY) || "null");
    if(p && p.row && p.col && p.row !== p.col) return {row:p.row, col:p.col};
  }catch(e){ /* 受限环境忽略 */ }
  return {row:"owner", col:"reqId"};
})();
var PIVOT_DIMS = [["owner", "成员"], ["reqId", "项目"], ["priority", "优先级"], ["category", "模块"], ["column", "状态"]];
var reviewPivotState = null;
function pivotDimLabel(dim){
  for(var i = 0; i < PIVOT_DIMS.length; i++) if(PIVOT_DIMS[i][0] === dim) return PIVOT_DIMS[i][1];
  return dim;
}
function pivotValue(t, dim){
  if(dim === "owner") return t.owner || "未分配";
  if(dim === "reqId") return t.reqId ? (reqNameById(t.reqId) || "未归类") : "未归类";
  if(dim === "priority") return t.priority ? priName(t.priority) : "未设置";
  if(dim === "category") return catNameById(t.categoryId) || "未指定模块";
  if(dim === "column") return colName(t.boardColumn) || "未设置";
  return "—";
}
function pivotOrder(dim){
  if(dim === "priority"){
    return function(a, b){
      var ai = PRIORITIES.indexOf(a), bi = PRIORITIES.indexOf(b);
      return (ai < 0 ? 9 : ai) - (bi < 0 ? 9 : bi);
    };
  }
  if(dim === "column"){
    return function(a, b){
      var ai = -1, bi = -1;
      COLUMNS.forEach(function(c, i){ if(c.name === a) ai = i; if(c.name === b) bi = i; });
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    };
  }
  return function(a, b){ return String(a).localeCompare(String(b), "zh-CN"); };
}
function fillPivotOptions(sel, value){
  if(!sel) return;
  if(!sel.options.length){
    sel.innerHTML = PIVOT_DIMS.map(function(d){ return '<option value="' + d[0] + '">' + esc(d[1]) + '</option>'; }).join("");
  }
  sel.value = value;
}
function renderReviewPivot(d){
  var box = $("reviewPivot"), rowSel = $("reviewPivotRow"), colSel = $("reviewPivotCol");
  if(!box || !rowSel || !colSel) return;
  fillPivotOptions(rowSel, reviewPivot.row);
  fillPivotOptions(colSel, reviewPivot.col);
  var list = (d && d.completed) || [];
  if(!list.length){
    box.innerHTML = UI.colEmpty("该周期没有已完成的工作项，暂无可透视数据");
    return;
  }
  var rows = [], cols = [], cells = {}, rowMap = {}, colMap = {};
  list.forEach(function(t){
    var r = pivotValue(t, reviewPivot.row), c = pivotValue(t, reviewPivot.col);
    if(rows.indexOf(r) < 0) rows.push(r);
    if(cols.indexOf(c) < 0) cols.push(c);
    var key = r + "\u0000" + c;
    (cells[key] = cells[key] || []).push(t);
    (rowMap[r] = rowMap[r] || []).push(t);
    (colMap[c] = colMap[c] || []).push(t);
  });
  rows.sort(pivotOrder(reviewPivot.row));
  cols.sort(pivotOrder(reviewPivot.col));
  reviewPivotState = { cells: cells, rows: rowMap, cols: colMap, all: list,
    rowDim: pivotDimLabel(reviewPivot.row), colDim: pivotDimLabel(reviewPivot.col) };
  function link(html, enabled, attrs){
    return enabled ? '<button class="manager-cell-link" type="button" ' + attrs + '>' + html + '</button>'
      : '<span title="该口径下暂无工作项">—</span>';
  }
  var head = '<tr><th>' + esc(pivotDimLabel(reviewPivot.row)) + ' \\ ' + esc(pivotDimLabel(reviewPivot.col)) + '</th>' +
    cols.map(function(c){
      var n = (colMap[c] || []).length;
      return '<th class="num">' + link(esc(c), n, 'data-rvp-col="' + esc(c) + '"') + '</th>';
    }).join("") +
    '<th class="num">合计</th></tr>';
  var body = rows.map(function(r){
    var rowList = rowMap[r] || [];
    var cellsHTML = cols.map(function(c){
      var n = (cells[r + "\u0000" + c] || []).length;
      return '<td class="num">' + link(String(n), n, 'data-rvp-row="' + esc(r) + '" data-rvp-col="' + esc(c) + '"') + '</td>';
    }).join("");
    return '<tr><td>' + link('<b>' + esc(r) + '</b>', rowList.length, 'data-rvp-row="' + esc(r) + '"') + '</td>' + cellsHTML +
      '<td class="num">' + link('<b>' + rowList.length + '</b>', rowList.length, 'data-rvp-row="' + esc(r) + '"') + '</td></tr>';
  }).join("");
  var foot = '<tr><td><b>合计</b></td>' +
    cols.map(function(c){
      var n = (colMap[c] || []).length;
      return '<td class="num">' + link('<b>' + n + '</b>', n, 'data-rvp-col="' + esc(c) + '"') + '</td>';
    }).join("") +
    '<td class="num">' + link('<b>' + list.length + '</b>', list.length, 'data-rvp-all="1"') + '</td></tr>';
  box.innerHTML = '<table class="manager-tbl pivot-tbl"><thead>' + head + '</thead><tbody>' + body + foot + '</tbody></table>';
}
function onReviewPivotChange(which){
  var rowSel = $("reviewPivotRow"), colSel = $("reviewPivotCol");
  if(!rowSel || !colSel) return;
  if(rowSel.value === colSel.value){
    var pick = null;
    for(var i = 0; i < PIVOT_DIMS.length; i++){
      if(PIVOT_DIMS[i][0] !== rowSel.value){ pick = PIVOT_DIMS[i][0]; break; }
    }
    if(pick){ if(which === "row") colSel.value = pick; else rowSel.value = pick; }
  }
  reviewPivot.row = rowSel.value;
  reviewPivot.col = colSel.value;
  try{ localStorage.setItem(REVIEW_PIVOT_KEY, JSON.stringify(reviewPivot)); }catch(e){ /* 忽略 */ }
  renderReviewPivot(state.reviewData);
}
if($("reviewPivotRow")) $("reviewPivotRow").addEventListener("change", function(){ onReviewPivotChange("row"); });
if($("reviewPivotCol")) $("reviewPivotCol").addEventListener("change", function(){ onReviewPivotChange("col"); });
if($("reviewPivot")) $("reviewPivot").addEventListener("click", function(e){
  var b = e.target.closest("[data-rvp-row],[data-rvp-col],[data-rvp-all]");
  if(!b || !reviewPivotState) return;
  var r = b.dataset.rvpRow || "", c = b.dataset.rvpCol || "", tasks, title;
  if(b.hasAttribute("data-rvp-all")){ tasks = reviewPivotState.all; title = "全部"; }
  else if(r && c){ tasks = reviewPivotState.cells[r + "\u0000" + c] || []; title = r + " × " + c; }
  else if(r){ tasks = reviewPivotState.rows[r] || []; title = r; }
  else { tasks = reviewPivotState.cols[c] || []; title = c; }
  if(!tasks.length){ toast("该口径下暂无工作项", "warn"); return; }
  openTaskTable("周回顾透视 · " + title, tasks,
    reviewPivotState.rowDim + " × " + reviewPivotState.colDim + " · 共 " + tasks.length + " 项 · 点击工作项行打开详情");
});

/* 下钻：统计卡 / 成员 / 模块 / 项目都打开同一份明细表，行再进详情 */
function reviewWeekText(d){
  return fmtMD(parseDate(d.weekStart)) + " — " + fmtMD(parseDate(d.weekEnd));
}
function reviewCompleted(d){
  return (d && d.completed) || [];
}
/* 模块聚合行的口径：未指定模块显示固定文案，已删除模块回退原始 ID，与后端下发一致 */
function reviewCatLabel(t){
  return catNameById(t.categoryId) || t.categoryId || "未指定模块";
}
function reviewLate(t){
  return !!(t.completedAt && t.dueDate && t.completedAt > t.dueDate);
}
function openReviewTasks(title, tasks, note){
  var d = state.reviewData || {};
  if(!tasks || !tasks.length){ toast("该口径下暂无工作项", "warn"); return; }
  openTaskTable(title, tasks,
    (d.label || "该周期") + "（" + reviewWeekText(d) + "）" + (note ? " · " + note : "") + " · 共 " + tasks.length + " 项");
}
function onReviewTaskRow(e){
  var row = e.target.closest("[data-review-task]");
  if(row) openTaskById(row.dataset.reviewTask);
}
/* 工时卡下钻：走 /api/review/hour-logs，与卡片同口径，支持任意历史周 */
function openReviewHours(kind){
  var d = state.reviewData;
  if(!d) return;
  var mine = kind === "mine";
  var params = { weekOffset:d.weekOffset, reqId:d.reqId || null, mine:mine ? 1 : null, limit:100 };
  API.get("/api/review/hour-logs", params).then(function(page){
    var rows = (page && page.items) || [];
    if(!rows.length){ toast(mine ? "该周期你没有任何计时记录" : "该周期暂无计时记录", "warn"); return; }
    var scopeText = (d.reqName ? "项目「" + d.reqName + "」" : "全空间") + (mine ? " · 我的" : "");
    var pager = {
      total: page.total,
      hasMore: page.hasMore,
      fetch: function(offset){
        return API.get("/api/review/hour-logs",
          Object.assign({}, params, { offset: offset }));
      }
    };
    openLogTable(mine ? "周回顾 · 计时明细 · 我的" : "周回顾 · 计时明细", rows,
      (d.label || "该周期") + "（" + reviewWeekText(d) + "）· " + scopeText
        + " · 共 " + page.total + " 条 · 合计 " + fmtMinutesShort(page.totalMinutes) + " · 点击记录行打开工作项",
      { showMember: !mine, pager: pager });
  }).catch(function(ex){ toast(ex.message || "计时明细加载失败", "bad"); });
}
if(reviewHoursEl) reviewHoursEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-review-hours]");
  if(b) openReviewHours(b.dataset.reviewHours);
});
if($("doneList")) $("doneList").addEventListener("click", onReviewTaskRow);
if($("progList")) $("progList").addEventListener("click", onReviewTaskRow);
if($("pendingList")) $("pendingList").addEventListener("click", onReviewTaskRow);
if($("peopleBox")) $("peopleBox").addEventListener("click", function(e){
  var b = e.target.closest("[data-review-member]");
  if(!b) return;
  var name = b.dataset.reviewMember;
  openReviewTasks("周回顾 · 成员 · " + name,
    reviewCompleted(state.reviewData).filter(function(t){ return (t.owner || "未分配") === name; }),
    "完成项");
});
if($("catDist")) $("catDist").addEventListener("click", function(e){
  var row = e.target.closest("[data-review-cat]");
  if(!row) return;
  var name = row.dataset.reviewCat;
  openReviewTasks("周回顾 · 模块 · " + name,
    reviewCompleted(state.reviewData).filter(function(t){ return reviewCatLabel(t) === name; }),
    "完成项");
});
if($("reqDist")) $("reqDist").addEventListener("click", function(e){
  var row = e.target.closest("[data-review-req]");
  if(!row) return;
  rt.managerProjectId = row.dataset.reviewReq;
  showView("project");
});
if($("statGrid")) $("statGrid").addEventListener("click", function(e){
  var b = e.target.closest("[data-review-stat]");
  if(!b) return;
  var d = state.reviewData;
  if(!d) return;
  var list = reviewCompleted(d);
  var kind = b.dataset.reviewStat;
  if(kind === "over"){ showView("risks"); return; }
  if(kind === "doing"){ openReviewTasks("周回顾 · 进行中", d.progressTasks || [], "本周期内已开工未完成"); return; }
  if(kind === "late"){ openReviewTasks("周回顾 · 延期完成", list.filter(reviewLate), "完成时间晚于截止日期"); return; }
  if(kind === "rate"){
    openReviewTasks("周回顾 · 按期率", list.filter(function(t){ return !!t.dueDate; }),
      "分母为设置截止日期的完成项");
    return;
  }
  if(kind === "members"){
    openReviewTasks("周回顾 · 参与成员完成项", list,
      "本周有完成记录的成员 " + ((d.members || []).filter(function(m){ return m.count > 0; }).length) + " 人");
    return;
  }
  openReviewTasks("周回顾 · 完成", list);
});
function distHTML(list, colorOf, valueOf, attrsOf){
  if(!list || !list.length) return UI.colEmpty("暂无数据");
  var max = 1;
  list.forEach(function(x){ if(x.count > max) max = x.count; });
  return list.map(function(x){
    var attrs = attrsOf ? attrsOf(x) : "";
    var tag = attrs ? "button" : "div";
    return "<" + tag + (tag === "button" ? ' type="button"' : "") + ' class="dist-row' + (attrs ? " clickable" : "") + '"' +
      (attrs ? " " + attrs : "") + ">" +
      '<span class="lb">' + esc(x.name) + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(x.count/max*100) + '%;background:' + colorOf(x) + '"></i></span>' +
      '<span class="vl">' + valueOf(x) + '</span></' + tag + '>';
  }).join("");
}
function renderReview(d){
  $("reviewTitle").textContent = reviewTitle(d.weekOffset) + (d.reqName ? " · " + d.reqName : "");
  $("weekLabel").textContent = fmtMD(parseDate(d.weekStart)) + " — " + fmtMD(parseDate(d.weekEnd));
  $("weekNext").disabled = d.weekOffset >= 0;
  $("summaryText").innerHTML = buildSummary(d);

  var s = d.stats;
  var overN = (d.counts && d.counts.over) || 0;
  var stats = [
    {k:"完成", v:s.done, u:"项", cls:"", drill:"done"},
    {k:"按期率", v:s.onTimeRate, u:"%", cls:(s.onTimeRate < 60 ? "warn" : "good"), drill:"rate"},
    {k:"延期", v:s.late, u:"项", cls:(s.late > 0 ? "warn" : ""), drill:"late"},
    {k:"参与成员", v:s.members, u:"人", cls:"", drill:"members"},
    {k:"逾期", v:overN, u:"项", cls:(overN > 0 ? "bad" : ""), drill:"over"},
    {k:"进行中", v:(d.progressTasks || []).length, u:"项", cls:"info", drill:"doing"}
  ];
  $("statGrid").innerHTML = stats.map(function(x){
    var inner = '<div class="k">' + x.k + '</div><div class="v">' + x.v + '<small>' + x.u + '</small></div>';
    return x.drill
      ? '<button class="stat clickable ' + x.cls + '" type="button" data-review-stat="' + x.drill + '" title="查看明细" aria-label="' + x.k + '：查看明细">' + inner + '</button>'
      : '<div class="stat ' + x.cls + '">' + inner + '</div>';
  }).join("");

  renderReviewPivot(d);

  /* N-5：工时区（全空间 / 我的） */
  if(reviewHoursEl){
    var w = d.workMinutes || {};
    var weekWord = d.weekOffset === 0 ? "本周" : (d.weekOffset === -1 ? "上周" : "该周期");
    /* IA-7：只保留本周期两个口径；累计工时挪到分析页 */
    var hcards = [
      {k:weekWord + "·我的", v:fmtMinutesShort(w.mineWeek || 0), min:(w.mineWeek || 0), scope:"mine"},
      {k:weekWord + (d.reqName ? "·项目" : "·全空间"), v:fmtMinutesShort(w.spaceWeek || 0), min:(w.spaceWeek || 0), scope:"space"}
    ];
    if($("reviewHoursScope")) $("reviewHoursScope").textContent = weekWord + " · " + (d.reqName ? ("项目「" + d.reqName + "」/ 我的") : "我的 / 全空间");
    reviewHoursEl.innerHTML = hcards.map(function(x){
      var inner = '<div class="k">' + x.k + '</div><div class="v">' + x.v + '</div>';
      /* 该周期没有计时时点开必然是空表，不做入口 */
      if(!x.min) return '<div class="stat" title="' + weekWord + '暂无计时记录">' + inner + '</div>';
      return '<button class="stat clickable" type="button" data-review-hours="' + x.scope + '" title="查看' + weekWord + '计时明细">' + inner + '</button>';
    }).join("");
  }
  /* O-10：进度 100% 但未入已完成列的任务单独成组，不静默漏统计 */
  var pending = d.pendingDone || [];
  if(reviewPendingBox){
    reviewPendingBox.hidden = pending.length === 0;
    if(pendingCount) pendingCount.textContent = pending.length ? ("共 " + pending.length + " 项") : "";
    if(pendingList){
      pendingList.innerHTML = pending.map(function(t){
        return '<div class="done-item clickable" data-review-task="' + esc(t.id) + '" title="打开工作项详情">' + avatarHTML(t.owner) +
          '<span class="di-main">' +
            '<span class="di-t">' + esc(t.title) + '</span>' +
            '<span class="di-m">' + priTagHTML(t.priority) + '' +
              catTag(t.categoryId) + '<span>' + esc(t.owner) + '</span></span>' +
          '</span>' +
          '<span class="di-d">' + esc(colName(t.boardColumn)) + ' · 进度 ' + progressOf(t) + '%</span>' +
        '</div>';
      }).join("");
    }
  }

  /* 未指定模块在聚合里是空名：补成列表页同一文案，否则标签空白且点击命中不到工作项 */
  var catDist = (d.catDist || []).map(function(c){
    return { name: c.name || "未指定模块", count: c.count };
  });
  $("catDist").innerHTML = distHTML(catDist,
    function(c){ return catColor(c.name); },
    function(c){ return c.count; },
    function(c){ return c.count > 0 ? 'data-review-cat="' + esc(c.name) + '"' : ""; });

  var members = d.members || [];
  $("peopleBox").innerHTML = members.length ? members.map(function(m){
    var inner = avatarHTML(m.name) + '<span class="pn">' + esc(m.name) + '</span>' +
      '<span class="pc">' + m.count + ' 项' + (m.minutes ? (' · ' + fmtMinutesShort(m.minutes)) : '') + '</span>';
    /* 只有完成过工作项的成员才有明细可看；已离开成员只有工时，不做入口 */
    return m.count > 0
      ? '<button class="person clickable" type="button" data-review-member="' + esc(m.name) + '" title="查看该成员本周期完成的工作项">' + inner + '</button>'
      : '<span class="person" title="该成员本周期没有完成记录，无明细可看">' + inner + '</span>';
  }).join("") : '<span class="foot-note">该周期暂无成员完成记录</span>';

  var list = d.completed || [];
  $("doneList").innerHTML = list.length ? list.map(function(t){
    /* completedAt 可能为空（历史数据 / 异常恢复）：那就显示「完成时间未记录」，不能让渲染崩掉 */
    var doneAt = t.completedAt ? parseDate(t.completedAt) : null;
    var due = t.dueDate ? parseDate(t.dueDate) : null;
    var late = !!(doneAt && due && t.completedAt > t.dueDate);
    var n = late ? dayDiff(doneAt, due) : 0;
    var badge = late ? ("延期 " + n + " 天") : ((doneAt && due) ? "按期" : "—");
    var badgeKind = late ? "warning" : ((doneAt && due) ? "success" : "ghost");
    return '<div class="done-item clickable" data-review-task="' + esc(t.id) + '" title="打开工作项详情">' +
      '<span class="meta full">' + icon("check", 15) + '</span>' +
      '<span class="di-main">' +
        '<span class="di-t">' + esc(t.title) + '</span>' +
        '<span class="di-m">' + priTagHTML(t.priority) + '' +
          catTag(t.categoryId) + '<span>' + esc(t.owner) + '</span></span>' +
      '</span>' +
      '<span class="di-d">' + (doneAt ? (esc(fmtShortMD(doneAt)) + " " + weekdayCN(doneAt)) : "完成时间未记录") + '</span>' +
      '<span class="tag tag-' + badgeKind + '">' + badge + '</span>' +
    '</div>';
  }).join("") : UI.colEmpty("该周期没有已完成的工作项");
  if(doneCountEl) doneCountEl.textContent = list.length ? ("共 " + list.length + " 项") : "";

  var progTasks = d.progressTasks || [];
  $("progList").innerHTML = progTasks.length ? progTasks.map(function(t){
    return '<div class="done-item clickable" data-review-task="' + esc(t.id) + '" title="打开工作项详情">' + avatarHTML(t.owner) +
      '<span class="di-main">' +
        '<span class="di-t">' + esc(t.title) + '</span>' +
        '<span class="di-m">' + priTagHTML(t.priority) + '' +
          catTag(t.categoryId) + (t.reqId ? tagChip(reqNameById(t.reqId)) : '') +
          '<span>进度 ' + progressOf(t) + '%</span></span>' +
        (t.note ? '<span class="di-note">备注：' + esc(t.note) + '</span>' : '') +
      '</span>' +
      '<span class="di-d">' + esc(colName(t.boardColumn)) + '</span>' +
    '</div>';
  }).join("") : UI.colEmpty("当前没有进行中的工作项（把工作项拖到「进行中」列即可）");
  if(progCountEl) progCountEl.textContent = progTasks.length ? ("共 " + progTasks.length + " 项") : "";

  var reqDist = d.reqDist || [];
  $("reqDist").innerHTML = reqDist.length
    ? distHTML(reqDist.map(function(r){ return {name:r.name, count:r.progressPct, extra:r}; }),
        function(r){ return r.extra.status === "done" ? "var(--success)" : "var(--primary)"; },
        function(r){ return r.count + "% · " + r.extra.doneCount + "/" + r.extra.taskCount; },
        function(r){ return r.extra.id ? 'data-review-req="' + esc(r.extra.id) + '"' : ""; })
    : UI.colEmpty("暂无项目");

  /* AI 周报跟着「当前这一周」走：有缓存还原，没有则空态（函数定义在下方，靠声明提升） */
  syncAiReport(d);
}
$("weekPrev").addEventListener("click", function(){ navWeek(-1); });
$("weekNext").addEventListener("click", function(){
  if(state.reviewData && state.reviewData.weekOffset >= 0) return;
  navWeek(1);
});
if($("reviewReq")) $("reviewReq").addEventListener("change", changeReviewReq);
function copyReviewPlain(){
  var d = state.reviewData;
  if(!d){ toast("回顾还没加载完成", "warn"); return; }
  var progTasks = d.progressTasks || [];
  var doneTasks = d.completed || [];
  /* 复制口径与页面一致：先「进行中」（已开工未完成），再「本周完成」。
     不再叫「完成明细」—— 页面上的区块也叫「本周完成」。 */
  var text = "沙漏 · " + (d.reqName ? "项目「" + d.reqName + "」· " : "") + (d.label || "") + "工作回顾（" + d.weekStart + " — " + d.weekEnd + "）\n\n"
    + summaryPlain(d) + "\n\n"
    + "进行中（" + progTasks.length + " 项）：\n"
    + (progTasks.length ? progTasks.map(function(t){
        var rn = t.reqId ? reqNameById(t.reqId) : null;
        return "· " + colName(t.boardColumn) + "　" + t.title + "　" + progressOf(t) + "%"
          + (rn ? "（" + rn + "）" : "") + (t.note ? "　备注：" + t.note : "");
      }).join("\n") : "（当前没有进行中的工作项）")
    + "\n\n本周完成（" + doneTasks.length + " 项）：\n"
    + (doneTasks.length ? doneTasks.map(function(t){
        return "· [" + t.priority + "][" + catNameById(t.categoryId) + "] " + t.title + " — " + t.owner
          + (t.completedAt ? "（" + t.completedAt + "）" : "（完成时间未记录）");
      }).join("\n") : "（本周没有完成的工作项）");
  copyToClipboard(text, "已复制本周总结", "复制失败，请手动选择文本");
}
function copyReviewAi(){
  var d = state.reviewData;
  var hit = d ? aiReportCache[aiKey(d.weekOffset, d.reqId)] : null;
  if(!hit || !hit.report){ toast("先点「生成周报」", "warn"); return; }
  copyToClipboard(hit.report, "已复制周报", "复制失败，请手动选择文本");
}
(function wireCopyMenu(){
  var btn = $("btnCopy"), menu = $("copyMenu");
  if(!btn || !menu) return;
  btn.addEventListener("click", function(){
    if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
    UI.openPop(menu, btn, {align:"right"});
  });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-copy]");
    if(!b || b.disabled) return;
    UI.closeAllPops();
    if(b.dataset.copy === "ai") copyReviewAi(); else copyReviewPlain();
  });
})();
(function wireSummaryToggle(){
  var panel = $("summaryPanel"), head = $("summaryToggle"), hint = $("summaryToggleHint");
  if(!panel || !head) return;
  function toggle(){
    var collapsed = panel.classList.toggle("collapsed");
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if(hint) hint.textContent = collapsed ? "展开" : "收起";
  }
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
  });
})();
var aiReportCache = {};
var aiReportBusy = false;
var aiReportTimer = null;
function aiKey(off, reqId){
  return String(window.CURRENT_WORKSPACE || "") + "#" + (reqId || "") + "#" + off;
}
function aiReportIdle(){
  var body = $("reviewAiBody");
  if(!body) return;
  body.hidden = true;
  body.innerHTML = "";
  $("reviewAiUsage").textContent = "";
  $("btnAiReportCopy").hidden = true;
  var aiItem0 = $("copyAiItem");
  if(aiItem0){ aiItem0.disabled = true; aiItem0.textContent = "复制 AI 周报（尚未生成）"; }
  $("reviewAiHint").hidden = false;
  $("reviewAiMeta").textContent = "用你自己的模型额度";
}
function syncAiReport(d){
  if(!d || !$("reviewAiBody")) return;
  var hit = aiReportCache[aiKey(d.weekOffset, d.reqId)];
  if(hit) renderAiReport(hit); else aiReportIdle();
}
function reportHTML(text){
  return String(text || "").split("\n").map(function(line){
    var m = /^#{1,3}\s+(.*)$/.exec(line);
    return m ? ('<span class="rp-h">' + esc(m[1]) + '</span>') : esc(line);
  }).join("\n");
}
function renderAiReport(r){
  var body = $("reviewAiBody");
  body.hidden = false;
  body.innerHTML = reportHTML(r.report);
  $("reviewAiHint").hidden = true;
  $("btnAiReportCopy").hidden = false;
  var aiItem = $("copyAiItem");
  if(aiItem){ aiItem.disabled = false; aiItem.textContent = "复制 AI 周报（纯文本）"; }
  $("reviewAiMeta").textContent = (r.label || "该周期") + "（" + (r.weekStart || "") + " — " + (r.weekEnd || "") + "）";
  var s = r.source || {};
  var based = "基于 " + (s.completed || 0) + " 项完成 / " + (s.progress || 0) + " 项进行中";
  if(s.pendingDone) based += " / " + s.pendingDone + " 项待确认完成";
  if(s.truncated) based += "（工作项太多，只取了前若干条）";
  $("reviewAiUsage").textContent = based + " · " + aiUsageText(r.usage);
}
function runAiReport(){
  var d = state.reviewData;
  if(!d || aiReportBusy) return;
  var btn = $("btnAiReport");
  var noteEl = $("reviewAiNote");
  var body = $("reviewAiBody");
  var week = d.weekOffset;
  var req = d.reqId || "";
  aiReportBusy = true;
  aiBtnBusy(btn, true, "生成中…");
  var startedAt = Date.now();
  var setMeta = function(){
    var sec = Math.floor((Date.now() - startedAt) / 1000);
    $("reviewAiMeta").textContent = sec < 1
      ? "正在写…（通常需要 10–30 秒）"
      : "正在写…已等待 " + sec + " 秒，通常需要 10–30 秒";
  };
  setMeta();
  if(aiReportTimer) clearInterval(aiReportTimer);
  aiReportTimer = setInterval(setMeta, 1000);
  $("reviewAiHint").hidden = true;
  $("btnAiReportCopy").hidden = true;
  body.hidden = false;
  body.innerHTML = '<div class="rp-loading">' + UI.skeletonRows(4) + '</div>';
  $("reviewAiUsage").textContent = "";
  API.post("/api/ai/review/polish", {
    weekOffset: week,
    reqId: req || null,
    note: noteEl ? String(noteEl.value || "").trim() : ""
  }).then(function(r){
    aiReportCache[aiKey(r.weekOffset == null ? week : r.weekOffset, req)] = r;
    /* 生成过程中可能已经翻到别的周/别的项目：存进缓存就好，不要覆盖当前界面 */
    if(state.reviewData && state.reviewData.weekOffset === week && (state.reviewData.reqId || "") === req) renderAiReport(r);
  }).catch(function(ex){
    if(state.reviewData && state.reviewData.weekOffset === week && (state.reviewData.reqId || "") === req){
      body.hidden = true;
      $("reviewAiHint").hidden = false;
      $("reviewAiMeta").textContent = "生成失败";
    }
    toast(aiErrMsg(ex && ex.message), "bad");
  }).then(function(){
    if(aiReportTimer){ clearInterval(aiReportTimer); aiReportTimer = null; }
    aiReportBusy = false;
    aiBtnBusy(btn, false);
  });
}
if($("btnAiReport")) $("btnAiReport").addEventListener("click", runAiReport);
if($("btnAiReportCopy")) $("btnAiReportCopy").addEventListener("click", function(){
  var d = state.reviewData;
  var hit = d ? aiReportCache[aiKey(d.weekOffset, d.reqId)] : null;
  if(!hit || !hit.report){ toast("先点「生成周报」", "warn"); return; }
  copyToClipboard(hit.report, "已复制周报", "复制失败，请手动选择文本");
});

export { distHTML, enterReviewView };
