/* views/analysis · 分析（趋势 / 完成记录 / 流程体检） */

import { API } from "../core/api.js";
import { $, hoursNote, segWorkScope, statsHoursEl, workScopeTag } from "../core/dom.js";
import { catTag, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { setPageError } from "../core/utils.js";
import { triggerDownload } from "../lib/download.js";
import { avatarColor, fmtMinutesShort, pad2, priColor, priName, priTagHTML } from "../lib/format.js";
import { ganttCsvCell } from "./gantt.js";
import { openReqDocAndJump, reqDocList, reqDocNameById } from "./requirements.js";
import { distHTML } from "./review.js";

var compSeq = 0, compRowsCache = [];
function enterCompletionsView(){ loadCompletions(); }
function currentCompMonth(){
  if(!state.compMonth){
    var d = new Date();
    state.compMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  return state.compMonth;
}
function shiftCompMonth(delta){
  var p = currentCompMonth().split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
  state.compMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  loadCompletions();
}
function loadCompletions(opts){
  opts = opts || {};
  var month = currentCompMonth();
  var seq = ++compSeq;
  $("compMonth").textContent = month.replace("-", " 年 ") + " 月";
  if(!opts.silent){
    $("compCount").textContent = "";
    $("compWrap").innerHTML = UI.skeletonRows(4);
    $("compStats").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
      '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  }
  API.get("/api/completions", {month: month}).then(function(rows){
    if(seq !== compSeq) return;
    compRowsCache = rows || [];
    renderCompletions(compRowsCache, month);
  }).catch(function(ex){
    if(seq !== compSeq) return;
    compRowsCache = [];
    setPageError(ex, ["compStats","compWrap"], function(){ loadCompletions(); });
  });
}
function renderCompletions(rows, month){
  var n = rows.length;
  var totalMin = rows.reduce(function(a, r){ return a + (Number(r.totalMinutes) || 0); }, 0);
  var ownerCount = {};
  rows.forEach(function(r){
    var o = r.owner || "未指派";
    ownerCount[o] = (ownerCount[o] || 0) + 1;
  });
  var ownerKeys = Object.keys(ownerCount);
  var topOwner = ownerKeys.slice().sort(function(a, b){ return ownerCount[b] - ownerCount[a]; })[0];

  $("compCount").textContent = n ? ("共 " + n + " 条") : "";
  $("compStats").innerHTML = [
    { k: "完成工作项", v: n + " 项" },
    { k: "总耗时", v: fmtMinutesShort(totalMin) || "—" },
    { k: "平均每项", v: n ? (fmtMinutesShort(Math.round(totalMin / n)) || "—") : "—" },
    { k: "参与成员", v: ownerKeys.length ? (ownerKeys.length + " 人") : "—",
      s: topOwner ? ("最多：" + topOwner + " " + ownerCount[topOwner] + " 项") : "" }
  ].map(function(x){
    return '<div class="stat"><div class="k">' + esc(x.k) + '</div><div class="v">' + esc(x.v) + '</div>' +
      (x.s ? '<div class="comp-stat-s">' + esc(x.s) + '</div>' : '') + '</div>';
  }).join("");

  if(!n){
    $("compWrap").innerHTML = UI.colEmpty(month + " 还没有完成记录。把工作项拖进「已完成」列就会自动归档到这里。");
    return;
  }
  /* 列只留统计用得上的：「开始时间 / 结束时间」成对（结束时间 = 任务完成日期），
     计时的首次/最后时间属于内部数据，不展示 */
  var head = "<tr><th>工作项</th><th>项目</th><th>文档</th><th>负责人</th><th>分类</th>" +
    "<th>优先级</th><th>开始时间</th><th>结束时间</th><th>总耗时</th></tr>";
  var body = rows.map(function(r){
    return "<tr>" +
      "<td>" + (r.taskId
        ? '<button class="comp-t comp-link" type="button" data-open-task="' + esc(r.taskId) + '" title="打开工作项详情">' + esc(r.title) + "</button>"
        : '<span class="comp-t">' + esc(r.title) + "</span>") +
        (r.description ? '<span class="comp-d">' + esc(r.description) + "</span>" : "") + "</td>" +
      "<td>" + (r.reqName ? esc(r.reqName) : '<span class="comp-dim">—</span>') + "</td>" +
      "<td>" + compDocCell(r) + "</td>" +
      "<td>" + esc(r.owner || "—") + "</td>" +
      "<td>" + (r.category ? catTag(r.category) : '<span class="comp-dim">—</span>') + "</td>" +
      '<td>' + priTagHTML(r.priority) + '</td>' +
      '<td class="nowrap" title="工作项开始日期">' + esc(r.startDate || "—") + "</td>" +
      '<td class="nowrap" title="工作项完成日期">' + esc(r.completedAt || "—") + "</td>" +
      '<td class="nowrap"><b>' + (fmtMinutesShort(r.totalMinutes) || "—") + "</b></td>" +
    "</tr>";
  }).join("");
  $("compWrap").innerHTML = '<div class="comp-scroll"><table class="comp-table"><thead>' + head +
    "</thead><tbody>" + body + "</tbody></table></div>";
}
function compDocCell(r){
  if(!r.reqDocTitle) return '<span class="comp-dim">—</span>';
  /* 文档列表还没加载完（reqDocList 为空）时不要急着判定"已删除"，否则点了没反应 */
  var loaded = reqDocList.length > 0;
  var alive = r.reqDocId && (!loaded || reqDocNameById(r.reqDocId));
  if(alive){
    return '<button type="button" class="link-cell" data-open-reqdoc="' + esc(r.reqDocId) + '"' +
      ' title="打开文档：' + esc(r.reqDocTitle) + '">' + esc(r.reqDocTitle) + '</button>';
  }
  return '<span class="comp-dim" title="该文档已被删除">' + esc(r.reqDocTitle) + '</span>';
}
function exportCompCSV(){
  var rows = compRowsCache || [];
  if(!rows.length){ toast("这个月还没有完成记录", "warn"); return; }
  var month = currentCompMonth();
  var lines = [["工作项名称","详情","归属项目","关联文档","负责人","分类","优先级",
    "开始时间","结束时间","总耗时(分钟)","总耗时"]];
  rows.forEach(function(r){
    lines.push([r.title, r.description, r.reqName, r.reqDocTitle, r.owner, r.category, r.priority,
      r.startDate, r.completedAt, r.totalMinutes || 0, fmtMinutesShort(r.totalMinutes)]);
  });
  var csv = "\uFEFF" + lines.map(function(cols){
    return cols.map(ganttCsvCell).join(",");
  }).join("\r\n");
  triggerDownload("工作项清单-" + month + ".csv", csv, "text/csv;charset=utf-8;");
  toast("已导出 " + rows.length + " 条记录", "fs");
}
if($("compWrap")) $("compWrap").addEventListener("click", function(e){
  var t = e.target.closest("[data-open-task]");
  if(t){ openTaskById(t.dataset.openTask); return; }
  var b = e.target.closest("[data-open-reqdoc]");
  if(b) openReqDocAndJump(b.dataset.openReqdoc);
});
$("compPrev").addEventListener("click", function(){ shiftCompMonth(-1); });
$("compNext").addEventListener("click", function(){ shiftCompMonth(1); });
$("btnCompExport").addEventListener("click", exportCompCSV);
function initAnalysisTabs(){
  var box = $("analysisTabs");
  if(box && !box.__wired){
    box.__wired = true;
    box.addEventListener("click", function(e){
      var b = e.target.closest("[data-analysis-tab]");
      if(b) setAnalysisTab(b.dataset.analysisTab);
    });
  }
  var period = $("analysisPeriod");
  if(period && !period.__wired){
    period.__wired = true;
    period.addEventListener("change", function(){ applyAnalysisPeriod(period.value); });
  }
}
function setAnalysisTab(tab, opts){
  if(tab !== "completions" && tab !== "flow") tab = "stats";
  rt.analysisTab = tab;
  document.querySelectorAll("#analysisTabs [data-analysis-tab]").forEach(function(b){
    var on = b.dataset.analysisTab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  /* 全局子导航与页内页签同源：从旧 hash 或周期切换回来时保持高亮一致 */
  document.querySelectorAll("#subNav [data-sub-tab]").forEach(function(b){
    var on = b.dataset.subTab === tab;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.querySelectorAll("#view-analysis [data-analysis-pane]").forEach(function(p){
    p.hidden = p.dataset.analysisPane !== tab;
  });
  if(!opts || !opts.noLoad) refreshAnalysisTab(!!(opts && opts.silent));
}
function refreshAnalysisTab(silent){
  if(rt.analysisTab === "stats") loadStats({silent:!!silent});
  else if(rt.analysisTab === "completions") loadCompletions({silent:!!silent});
  else loadFlowHealth({silent:!!silent});
}
function enterAnalysisView(){
  initAnalysisTabs();
  setAnalysisTab(rt.analysisTab, {silent:false});
}
function applyAnalysisPeriod(v){
  if(v === "week"){ state.statsWeeks = 4; state.flowDays = 7; }
  else if(v === "month"){ state.statsWeeks = 4; state.flowDays = 30; }
  else if(v === "days90"){ state.statsWeeks = 26; state.flowDays = 90; }
  else { state.statsWeeks = 8; state.flowDays = 90; }
  if($("statsWeeks")) $("statsWeeks").value = String(state.statsWeeks);
  if($("flowDays")) $("flowDays").value = String(state.flowDays);
  refreshAnalysisTab(false);
}
function enterStatsView(){ loadStats(); }
var statsSeq = 0, flowSeq = 0;
function loadStats(opts){
  opts = opts || {};
  var weeks = Number(state.statsWeeks) || 8;
  var current = ++statsSeq;
  if(!opts.silent){
    $("chartWeeks").innerHTML = '<div class="skel skel-chart"></div>';
    if(statsHoursEl) statsHoursEl.innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
    $("statsCat").innerHTML = UI.skeletonRows(3);
    $("statsOwner").innerHTML = UI.skeletonRows(3);
  }
  $("statsRange1").textContent = "近 " + weeks + " 周 · 全空间";
  $("statsRange2").textContent = "近 " + weeks + " 周 · 全空间";
  API.get("/api/stats", {weeks: weeks}).then(function(d){
    if(current === statsSeq) renderStats(d);
  }).catch(function(ex){
    if(current !== statsSeq) return;
    setPageError(ex, ["chartWeeks","statsHours","statsCat","statsOwner"], function(){ loadStats(); });
  });
}
function renderStatsHours(c){
  if(!statsHoursEl) return;
  var scope = state.workScope;
  var mine = Number(c.workMinutes) || 0;
  var mineWeek = Number(c.workMinutesWeek) || 0;
  var all = (c.workMinutesAll === undefined || c.workMinutesAll === null) ? null : Number(c.workMinutesAll);
  var allWeek = (c.workMinutesWeekAll === undefined || c.workMinutesWeekAll === null) ? null : Number(c.workMinutesWeekAll);
  var base = (scope === "all") ? (all === null ? mine : all) : mine;
  var week = (scope === "all") ? (allWeek === null ? mineWeek : allWeek) : mineWeek;
  var doneCount = c.done || 0;
  var cards = [
    {k:"累计工时", v:fmtMinutesShort(base)},
    {k:"本周工时", v:fmtMinutesShort(week)},
    {k:"平均每项", v:fmtMinutesShort(doneCount ? Math.round(base / doneCount) : 0)}
  ];
  statsHoursEl.innerHTML = cards.map(function(x){
    return '<div class="stat"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div></div>';
  }).join("");
  if(workScopeTag) workScopeTag.textContent = (scope === "all") ? "全空间" : "仅我";
  if(hoursNote){
    if(scope === "all" && all === null){
      hoursNote.textContent = "服务端暂未返回全空间工时，当前回退显示我的工时（需后端支持）。";
    }else{
      hoursNote.textContent = (scope === "all")
        ? "「全空间」= 空间内全部成员的计时合计，用于评估协作总投入。"
        : "「仅我」= 我在本空间的计时记录；切到「全空间」可看协作总投入。";
    }
  }
}
function syncWorkScopeSeg(){
  if(!segWorkScope) return;
  segWorkScope.querySelectorAll("[data-wscope]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.wscope === state.workScope ? "true" : "false");
  });
}
if(segWorkScope){
  segWorkScope.addEventListener("click", function(e){
    var b = e.target.closest("[data-wscope]");
    if(!b) return;
    state.workScope = b.dataset.wscope;
    syncWorkScopeSeg();
    if(state.lastStats) renderStatsHours(state.lastStats.current || {});
  });
}
function renderStats(d){
  state.lastStats = d;
  var maxV = 1;
  (d.weeks || []).forEach(function(w){
    if(w.created > maxV) maxV = w.created;
    if(w.completed > maxV) maxV = w.completed;
  });
  var chart;
  if(!d.weeks || !d.weeks.length){
    chart = UI.colEmpty("暂无统计数据");
  }else{
    chart = '<div class="chart">' + d.weeks.map(function(w){
      var parts = w.start.split("-");
      return '<div class="c" title="' + w.start + ' ~ ' + w.end + '：新增 ' + w.created + ' / 完成 ' + w.completed + '">' +
        '<div class="bars">' +
          '<i class="b-new" style="height:' + Math.round(w.created/maxV*100) + '%"></i>' +
          '<i class="b-done" style="height:' + Math.round(w.completed/maxV*100) + '%"></i>' +
        '</div>' +
        '<span class="cl">' + parts[1] + "-" + parts[2] + '</span>' +
      '</div>';
    }).join("") + '</div>' +
    '<div class="chart-legend"><span><i class="b-new"></i>新增</span><span><i class="b-done"></i>完成</span></div>';
  }
  $("chartWeeks").innerHTML = chart;

  var c = d.current || {};
  var overN = c.overdue || 0;
  var cards = [
    {k:"待处理", v:c.backlog || 0, cls:""},
    {k:"进行中", v:c.doing || 0, cls:"info"},
    {k:"已完成", v:c.done || 0, cls:"good"}
  ];
  if(c.other > 0) cards.push({k:"其他列", v:c.other, cls:""});
  cards.push({k:"逾期", v:overN, cls:(overN > 0 ? "bad" : "")});
  var currentBox = $("statsCurrent");
  if(currentBox){
    currentBox.innerHTML = cards.map(function(x){
      return '<div class="stat ' + x.cls + '"><div class="k">' + x.k + '</div><div class="v">' + x.v +
        '<small>项</small></div></div>';
    }).join("");
  }

  var wm = c.workMinutes || 0;
  renderStatsHours(c);
  syncWorkScopeSeg();

  $("statsCat").innerHTML = distHTML(d.byCategory,
    function(){ return "var(--primary)"; },
    function(x){ return x.count; });
  $("statsOwner").innerHTML = distHTML(d.byOwner,
    function(x){ return avatarColor(x.name); },
    function(x){ return x.count; });
}
$("statsWeeks").addEventListener("change", function(){
  state.statsWeeks = $("statsWeeks").value;
  loadStats();
});
function enterFlowView(){ loadFlowHealth(); }
function spanParts(sec){
  var s = Number(sec) || 0;
  if(s <= 0) return {n:"—", u:""};
  if(s < 3600) return {n:String(Math.max(1, Math.round(s/60))), u:"分钟"};
  if(s < 86400) return {n:(s/3600).toFixed(1), u:"小时"};
  return {n:(s/86400).toFixed(1), u:"天"};
}
function fmtSpan(sec){
  var p = spanParts(sec);
  return p.n === "—" ? "—" : p.n + " " + p.u;
}
function fmtPct(v){
  return Math.round((Number(v) || 0) * 100) + "%";
}
function flowCard(k, html, cls){
  return '<div class="stat ' + (cls || "") + '"><div class="k">' + k + '</div><div class="v">' + html + '</div></div>';
}
function flowRow(label, value, widthPct, color){
  var w = Math.max(0, Math.min(100, Math.round(Number(widthPct) || 0)));
  return '<div class="dist-row">' +
    '<span class="lb">' + esc(label) + '</span>' +
    '<span class="bar"><i style="width:' + w + '%;--c:' + color + '"></i></span>' +
    '<span class="vl">' + value + '</span></div>';
}
function loadFlowHealth(opts){
  opts = opts || {};
  var days = Number(state.flowDays) || 90;
  var current = ++flowSeq;
  if($("flowDays")) $("flowDays").value = String(days);
  if(!opts.silent){
    $("flowInsights").innerHTML = UI.skeletonRows(3);
    $("flowKpi").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
      '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
    $("flowBars").innerHTML = UI.skeletonRows(3);
    $("flowRework").innerHTML = UI.skeletonRows(2);
    $("flowPriority").innerHTML = UI.skeletonRows(2);
  }
  $("flowReqs").innerHTML = UI.skeletonRows(2);
  $("flowRange").textContent = "近 " + days + " 天 · 全空间";
  /* 估时区块单独取：口径和流程瓶颈无关，各算各的，一个失败不影响另一个 */
  if($("flowEstTop")){
    $("flowEstTop").innerHTML = UI.skeletonRows(1);
    API.get("/api/estimate/stats", {}).then(function(d){
      if(current === flowSeq) renderFlowEstimate(d);
    }).catch(function(ex){
      if(current === flowSeq) $("flowEstTop").innerHTML = UI.errorState(ex.message);
    });
  }
  API.get("/api/flow-health", {days: days}).then(function(d){
    if(current === flowSeq) renderFlowHealth(d);
  }).catch(function(ex){
    if(current !== flowSeq) return;
    setPageError(ex, ["flowInsights","flowKpi","flowBars","flowRework","flowPriority","flowReqs"],
      function(){ loadFlowHealth(); });
  });
}
function renderFlowHealth(d){
  var cov = d.coverage || {}, rw = d.rework || {}, rs = d.reqDocs || {};
  var cols = d.columns || [], ins = d.insights || [];

  /* ---- 结论：这是整个页面的重点，放最上面 ---- */
  $("flowInsights").innerHTML = ins.length ? ins.map(function(x){
    return '<div class="flow-ins ' + (x.level || "info") + '">' +
      '<span class="fi-dot" aria-hidden="true"></span>' +
      '<div class="fi-main"><div class="fi-t">' + esc(x.title) + '</div>' +
      '<div class="fi-x">' + esc(x.text) + '</div></div></div>';
  }).join("") : UI.colEmpty("暂无结论");
  $("flowCoverage").textContent = cov.note || "";

  /* ---- KPI ---- */
  var leadP = spanParts(rs.avgLeadHours == null ? 0 : rs.avgLeadHours * 3600);
  var passCls = !rw.completedTasks ? "" : (rw.firstPassRate >= 0.8 ? "good" : (rw.firstPassRate < 0.6 ? "bad" : ""));
  var backCls = !rw.totalMoves ? "" : (rw.backRate >= 0.2 ? "bad" : "");
  $("flowKpi").innerHTML =
    flowCard("瓶颈列", d.bottleneckName ? esc(d.bottleneckName) : "—",
      d.bottleneckName ? "warn" : "") +
    flowCard("一次通过率", rw.completedTasks ? fmtPct(rw.firstPassRate) +
      '<small> · ' + rw.firstPassTasks + "/" + rw.completedTasks + ' 项</small>' : "—",
      passCls) +
    flowCard("回退率", rw.totalMoves ? fmtPct(rw.backRate) +
      '<small> · ' + rw.backMoves + "/" + rw.totalMoves + ' 次</small>' : "—", backCls) +
    flowCard("文档开工延迟", leadP.n === "—" ? "—" :
      leadP.n + '<small> ' + leadP.u + '</small>', "");
  if($("flowKpi").children[0] && d.bottleneckName){
    $("flowKpi").children[0].querySelector(".v").insertAdjacentHTML("beforeend",
      '<small> · 占 ' + fmtPct(d.bottleneckShare) + '</small>');
  }

  /* ---- 各列停留 ---- */
  if(!cols.length){
    $("flowBars").innerHTML = UI.colEmpty("当前空间还没有看板列");
  }else{
    var maxShare = 0;
    cols.forEach(function(c){ if((c.share || 0) > maxShare) maxShare = c.share; });
    $("flowBars").innerHTML = cols.map(function(c){
      var w = maxShare > 0 ? Math.max(1, Math.round((c.share || 0) / maxShare * 100)) : 0;
      var ongoing = c.ongoingCount
        ? '现 ' + c.ongoingCount + ' 个在制 · 最久 ' + fmtSpan(c.ongoingMaxSeconds)
        : '当前无在制';
      return '<div class="flow-bar' + (c.bottleneck ? " is-bn" : "") + '">' +
        '<div class="fb-row">' +
          '<span class="fb-name">' + esc(c.name) +
            (c.bottleneck ? '<i class="fb-tag">瓶颈</i>' : '') + '</span>' +
          '<span class="fb-v">平均 ' + fmtSpan(c.avgSeconds) + '</span>' +
          '<span class="fb-share">' + fmtPct(c.share) + '</span>' +
        '</div>' +
        '<div class="bar"><i style="width:' + w + '%;--c:' + (c.color || "var(--primary)") + '"></i></div>' +
        '<div class="fb-meta"><span>' + (c.segments || 0) + ' 段已离开 · 中位 ' +
          fmtSpan(c.medianSeconds) + ' · P90 ' + fmtSpan(c.p90Seconds) + '</span>' +
          '<span class="' + (c.ongoingCount ? '' : 'muted') + '">' + ongoing + '</span></div>' +
      '</div>';
    }).join("");
  }

  /* ---- 返工 ---- */
  if(!rw.totalMoves){
    $("flowRework").innerHTML = UI.colEmpty("这段时间没有跨列移动");
  }else{
    $("flowRework").innerHTML = '<div class="dist">' +
      flowRow("跨列移动", rw.totalMoves + " 次", 100, "var(--info)") +
      flowRow("其中回退", rw.backMoves + " 次 · " + fmtPct(rw.backRate), rw.backRate * 100, "var(--warning)") +
      flowRow("一次通过", rw.firstPassTasks + "/" + rw.completedTasks + " 项",
        rw.completedTasks ? rw.firstPassRate * 100 : 0, "var(--success)") +
      '</div>' +
      '<p class="flow-note">回退 = 目标列在列顺序里比来源列更靠前。退回多半说明"进入下一列的门槛"没写清楚。</p>';
  }

  /* ---- 优先级 ---- */
  var prio = d.priority || [];
  if(!prio.length){
    $("flowPriority").innerHTML = UI.colEmpty("还没有工作项");
  }else{
    var maxMv = 0;
    prio.forEach(function(p){ if(p.avgMoves > maxMv) maxMv = p.avgMoves; });
    $("flowPriority").innerHTML = '<div class="dist">' + prio.map(function(p){
      return flowRow(priName(p.priority) + " · " + p.tasks + " 项", p.avgMoves + " 次",
        maxMv > 0 ? p.avgMoves / maxMv * 100 : 0, priColor(p.priority));
    }).join("") + '</div>' +
      '<p class="flow-note">数字是每个工作项平均被移动多少次列。优先级立得住的话，' + esc(priName("P0")) + ' 应该<b>更少</b>被来回拖。</p>';
  }

  /* ---- 文档 → 开工 ---- */
  if(!rs.total){
    $("flowReqMeta").textContent = "—";
    $("flowReqs").innerHTML = UI.colEmpty("当前空间还没有文档");
  }else{
    $("flowReqMeta").textContent = rs.withTasks + " / " + rs.total + " 份已开工";
    var html = '<div class="stat-grid" style="margin-bottom:14px">' +
      flowCard("文档总数", rs.total + '<small>份</small>', "") +
      flowCard("已拆出工作项", rs.withTasks + '<small>份</small>', "") +
      flowCard("还没拆工作项", rs.noTask + '<small>份</small>', rs.noTask ? "warn" : "good") +
      flowCard("平均开工延迟", leadP.n === "—" ? "—" : leadP.n + '<small>' + leadP.u + '</small>', "") +
      '</div>';
    if(rs.noTaskList && rs.noTaskList.length){
      html += '<div class="flow-orphans">' + rs.noTaskList.map(function(x){
        return '<div class="done-item">' +
          '<div class="di-main"><button class="link-cell" type="button" data-open-reqdoc="' + esc(x.id) + '">' +
            esc(x.title) + '</button>' +
          '<div class="di-m"><span>已挂 ' + x.ageDays + ' 天，还没有工作项</span></div></div></div>';
      }).join("") + '</div>';
    }
    $("flowReqs").innerHTML = html;
  }
}
function renderFlowEstimate(d){
  if($("flowEstMeta")){
    $("flowEstMeta").textContent = d.tasksWithEstimate + " / " + d.tasksTotal + " 个工作项填了预估";
  }
  var top = $("flowEstTop");
  if(!top) return;

  if(!d.sampleCount){
    top.innerHTML = '<div class="fe-main"><div class="fe-sug">'
      + esc(d.suggestion || "还没有可对比的样本") + '</div></div>';
    if($("flowEstRisk")) $("flowEstRisk").innerHTML = "";
    if($("flowEstNote")) $("flowEstNote").textContent = d.note || "";
    return;
  }

  var f = d.overallFactor || 0;
  /* 偏乐观（实际超预估）和偏保守都值得提醒，只有落在中间才算"准" */
  var cls = (f >= 1.15 || f <= 0.87) ? "warn" : "good";
  var n = d.sampleCount;
  var wu = Math.round(d.underCount / n * 100);
  var wa = Math.round(d.accurateCount / n * 100);
  var wo = Math.max(0, 100 - wu - wa);
  top.innerHTML =
    '<div class="fe-factor ' + cls + '">' +
      '<div class="big">' + f.toFixed(2) + '<small>×</small></div>' +
      '<div class="lbl">实际 / 预估</div>' +
    '</div>' +
    '<div class="fe-main">' +
      '<div class="fe-bar" title="按工作项数分布">' +
        '<i class="under" style="width:' + wu + '%"></i>' +
        '<i class="ok" style="width:' + wa + '%"></i>' +
        '<i class="over" style="width:' + wo + '%"></i>' +
      '</div>' +
      '<div class="fe-dist">' +
        '<span>高估 <b>' + d.underCount + '</b></span>' +
        '<span>准确 <b>' + d.accurateCount + '</b></span>' +
        '<span>低估 <b>' + d.overCount + '</b></span>' +
        '<span>样本 <b>' + n + '</b> 项已完成</span>' +
        (d.noTimeCount ? '<span title="没开过计时的工作项没有实际耗时，不参与系数">未计时 <b>' + d.noTimeCount + '</b> 项</span>' : '') +
      '</div>' +
      '<div class="fe-sug">' + esc(d.suggestion || "") + '</div>' +
    '</div>';

  var html = "";
  /* 进行中且已消耗 80% 以上：唯一还来得及处理的清单 */
  if(d.atRisk && d.atRisk.length){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">'
      + d.atRisk.length + ' 个进行中的工作项已用掉预估的 80% 以上</div>';
    for(var i = 0; i < d.atRisk.length && i < 8; i++){
      var t = d.atRisk[i];
      var hi = t.level === "danger";
      html += '<div class="done-item"><div class="di-main">' +
        '<div class="di-t">' + esc(t.title) + '</div>' +
        '<div class="di-m">' +
          '<span class="ai-tag ' + (hi ? "risk-hi" : "risk-lo") + '">' + (hi ? "已超预估" : "接近预估") + '</span>' +
          '<span>实际 ' + fmtMinutesShort(t.actualMinutes) + ' / 预估 ' + fmtMinutesShort(t.estimateMinutes)
            + '（' + Math.round(t.ratio * 100) + '%）</span>' +
        '</div></div></div>';
    }
    html += '</div>';
  }
  /* 已完成但超预估：复盘用，别和"还能救"的混一起 */
  if(d.overrun && d.overrun.length){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">已完成但超出预估（复盘）</div>';
    for(var j = 0; j < d.overrun.length; j++){
      var o = d.overrun[j];
      html += '<div class="done-item"><div class="di-main">' +
        '<div class="di-t">' + esc(o.title) + '</div>' +
        '<div class="di-m"><span>实际 ' + fmtMinutesShort(o.actualMinutes) + ' / 预估 '
          + fmtMinutesShort(o.estimateMinutes) + '（' + Math.round(o.ratio * 100) + '%）</span></div>' +
      '</div></div>';
    }
    html += '</div>';
  }
  /* 分类系数：只有一个分类时没有对比意义 */
  if(d.byCategory && d.byCategory.length > 1){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">按分类看系数</div>';
    d.byCategory.forEach(function(c){
      var cf = c.factor || 0;
      html += flowRow(c.category + " · " + c.sampleCount + " 项", cf.toFixed(2) + "×",
        Math.min(100, cf * 50),
        cf >= 1.15 ? "var(--danger)" : (cf >= 0.87 ? "var(--info)" : "var(--success)"));
    });
    html += '</div>';
  }
  if($("flowEstRisk")) $("flowEstRisk").innerHTML = html;
  if($("flowEstNote")) $("flowEstNote").textContent = d.note || "";
}
if($("flowDays")){
  $("flowDays").addEventListener("change", function(){
    state.flowDays = Number(this.value) || 90;
    loadFlowHealth();
  });
}
if($("view-analysis")){
  $("view-analysis").addEventListener("click", function(e){
    var b = e.target.closest("[data-open-reqdoc]");
    if(b) openReqDocAndJump(b.dataset.openReqdoc);
  });
}

export { enterAnalysisView, refreshAnalysisTab, setAnalysisTab };
