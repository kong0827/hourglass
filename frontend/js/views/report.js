/* views/report · 交付图表 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { loadReqs } from "./board.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours, openTaskTable } from "./manager-shared.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { fmtMinutesShort } from "../lib/format.js";
import { labelFilterText } from "../lib/member-labels.js";

var cache = null, seq = 0, reqId = "", roleTitle = "", companyName = "", loading = false, filterWorkspace = "", reportOptions = {};
function reportWorkspace(){ return rt.currentWs && rt.currentWs.id || ""; }
["ds:project-roles-changed","ds:member-company-changed","ds:member-job-title-changed","ds:member-label-options-changed","ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(e){
    var d = e && e.detail || {};
    if(d.workspaceId && d.workspaceId !== reportWorkspace()) return;
    cache = null; reportOptions = {}; seq++; hideReportTip();
    if(document.body.dataset.view === "report") loadReport({ silent:true });
  });
});
function reportThemeColors(){
  var dark = document.documentElement.getAttribute("data-theme") === "dark";
  var s = getComputedStyle(document.documentElement);
  function v(name, fallback){ return (s.getPropertyValue(name).trim() || fallback); }
  return {
    dark: dark,
    bg: v('--bg-app', dark ? '#0D1219' : '#F7F8FA'),
    surface: v('--surface', dark ? '#151B24' : '#FFFFFF'),
    text: v('--text', dark ? '#E7ECF3' : '#101828'),
    text3: v('--text-3', dark ? '#7B8798' : '#667085'),
    border: v('--border', dark ? '#25303D' : '#E4E7EC'),
    primary: v('--primary', dark ? '#4C8DFF' : '#3370ff'),
    success: v('--success', dark ? '#32D583' : '#12B76A'),
    info: v('--info', dark ? '#53B1FD' : '#2E90FA'),
    warning: v('--warning', dark ? '#FDB022' : '#F79009')
  };
}
var reportTooltip = null;
function ensureReportTooltip(){
  if(reportTooltip) return reportTooltip;
  reportTooltip = document.createElement("div");
  reportTooltip.id = "reportTooltip";
  document.body.appendChild(reportTooltip);
  return reportTooltip;
}
function showReportTip(text, x, y){
  var tip = ensureReportTooltip();
  tip.textContent = text;
  tip.classList.add("on");
  var r = tip.getBoundingClientRect();
  var left = x - r.width / 2, top = y - r.height - 10;
  if(left < 6) left = 6; else if(left + r.width > window.innerWidth - 6) left = window.innerWidth - r.width - 6;
  if(top < 6) top = y + 18;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function hideReportTip(){
  if(reportTooltip) reportTooltip.classList.remove("on");
}
function wireReportTooltip(el){
  if(!el || el.__reportTipWired) return;
  el.__reportTipWired = true;
  el.addEventListener("mouseover", function(e){
    var node = e.target.closest ? e.target.closest("[data-chart-tip]") : null;
    if(!node) return;
    showReportTip(node.dataset.chartTip, e.clientX, e.clientY);
  });
  el.addEventListener("mousemove", function(e){
    var node = e.target.closest ? e.target.closest("[data-chart-tip]") : null;
    if(!node){ hideReportTip(); return; }
    showReportTip(node.dataset.chartTip, e.clientX, e.clientY);
  });
  el.addEventListener("mouseout", function(e){
    if(!e.relatedTarget || !e.relatedTarget.closest("[data-chart-tip]")) hideReportTip();
  });
}
function enterReportView(){
  if(rt.reqsLoaded) loadReport();
  else loadReqs().then(loadReport);
}
function loadReport(opts){
  opts = opts || {};
  var body = $("reportBody");
  if(!body) return Promise.resolve(null);
  var ws = reportWorkspace();
  if(filterWorkspace !== ws){ reqId = ""; roleTitle = ""; companyName = ""; cache = null; reportOptions = {}; filterWorkspace = ws; }
  var current = ++seq, scope;
  /* 项目删除或隐藏后退回全部；异步响应必须仍属于原空间与最新请求。 */
  if(reqId && rt.reqsLoaded && !rt.reqList.some(function(r){ return r.id === reqId && (!r.workspaceId || r.workspaceId === ws); })) reqId = "";
  scope = { reqId:reqId || null, roleTitle:roleTitle || null, companyName:companyName || null };
  loading = true; hideReportTip();
  body.innerHTML = reportToolbar() + UI.skeletonCards(4); body.setAttribute("aria-busy","true");
  return API.get("/api/manager/reports", scope).then(function(data){
    if(current !== seq || ws !== reportWorkspace()) return null;
    cache = Object.assign({}, data, { scope:data.scope || scope }); reportOptions = data.filterOptions || {}; loading = false;
    body.setAttribute("aria-busy","false"); renderReport(); return cache;
  }).catch(function(ex){
    if(current !== seq || ws !== reportWorkspace()) return null;
    var status = ex && ex.code;
    if(scope.reqId && (status === 403 || status === 404)){
      reqId = "";
      toast("所选项目已不可访问，已切换为全部项目", "warn");
      return loadReport(opts);
    }
    cache = null; loading = false; body.setAttribute("aria-busy","false");
    body.innerHTML = reportToolbar() + UI.errorState(ex.message || "加载失败，请重试"); return null;
  });
}
function svgLine(points, max, cls, dashed){
  if(!points.length) return "";
  var coords = points.map(function(p, i){
    var x = 36 + (points.length === 1 ? 0 : i * 488 / (points.length - 1));
    var y = 184 - (max ? p / max * 148 : 0);
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  return '<polyline points="' + coords + '" fill="none" class="' + cls + '"' + (dashed ? ' stroke-dasharray="5 4"' : '') + ' />';
}
/* 纵轴取整齐上界：刻度、网格与柱 / 面共用同一标尺 */
function axisOf(maxValue){
  var v = Math.max(1, Math.ceil(Number(maxValue) || 0));
  var mag = 1, steps = [1, 2, 5];
  while(true){
    for(var i = 0; i < steps.length; i++){
      var step = steps[i] * mag;
      if(step * 4 >= v) return { max: step * 4, step: step };
    }
    mag *= 10;
  }
}
function yGrid(max, format){
  var out = "";
  for(var i = 0; i <= 4; i++){
    var y = 184 - i * 148 / 4;
    out += '<line x1="36" y1="' + y + '" x2="524" y2="' + y + '" class="grid' + (i === 0 ? ' base' : '') + '"/>';
    out += '<text x="32" y="' + (y + 3.5) + '" text-anchor="end">' + format(i * max / 4) + '</text>';
  }
  return out;
}
/* 分钟轴：0 显示 0，其余交给精简时长格式，避免出现 0.2h 这种刻度 */
function axisMinutes(v){ return v ? fmtMinutesShort(v) : "0"; }
function burnChart(d){
  var points = d.points || [], axis = axisOf(d.totalEstimateMinutes || 0), max = axis.max;
  var actual = points.map(function(p){ return p.remainingMinutes; });
  var ideal = points.map(function(p){ return p.idealMinutes; });
  function dots(series, cls, labelKey){
    if(!points.length) return "";
    return points.map(function(p, i){
      var x = 36 + (points.length === 1 ? 0 : i * 488 / (points.length - 1));
      var y = 184 - (max ? p[labelKey] / max * 148 : 0);
      var tip = esc(fmtDate(p.date)) + ' · ' + (cls === 'ideal' ? '理想' : '实际') + ' ' + fmtHours(p[labelKey]);
      var drill = cls === 'actual' ? ' data-report-drill="burn" data-burn-date="' + esc(String(p.date || "").substring(0, 10)) + '"' : '';
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" class="burn-point ' + cls + '"' + drill + ' data-chart-tip="' + tip + '" />';
    }).join("");
  }
  var lastLabel = "";
  if(points.length){
    var last = points[points.length - 1];
    var ly = 184 - (max ? last.remainingMinutes / max * 148 : 0);
    lastLabel = '<text x="516" y="' + (ly - 8) + '" text-anchor="end" class="bar-value">' + esc(fmtHours(last.remainingMinutes)) + '</text>';
  }
  return '<section class="manager-chart-panel" data-chart="burn"><div class="manager-panel-head"><b>燃尽图</b><span>剩余 ' + fmtHours(d.remainingMinutes) + ' / ' + fmtHours(d.totalEstimateMinutes) + '</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近14天燃尽图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/><line x1="36" y1="36" x2="36" y2="184" class="axis"/>'
    + yGrid(max, axisMinutes)
    + svgLine(ideal, max, "ideal", true) + svgLine(actual, max, "actual", false)
    + dots(points, "ideal", "idealMinutes") + dots(points, "actual", "remainingMinutes") + lastLabel
    + '<text x="36" y="208">' + esc(points.length ? fmtDate(points[0].date) : "—") + '</text><text x="524" y="208" text-anchor="end">' + esc(points.length ? fmtDate(points[points.length - 1].date) : "—") + '</text></svg>'
    + '<div class="manager-chart-legend"><span><i class="actual-line"></i>实际剩余</span><span><i class="ideal-line"></i>理想燃尽</span></div></section>';
}
function velocityChart(d){
  var weeks = d.weeks || [], raw = Math.max(1, d.averageMinutes || 0);
  weeks.forEach(function(w){ raw = Math.max(raw, w.completedMinutes); });
  var max = axisOf(raw).max;
  var bars = weeks.map(function(w, i){
    var h = Math.round(w.completedMinutes / max * 148), x = 64 + i * 120;
    var tip = esc(w.start) + '：' + fmtHours(w.completedMinutes) + '，' + w.completedCount + ' 项';
    return '<rect x="' + x + '" y="' + (184 - h) + '" width="56" height="' + h + '" rx="5" class="velocity-bar" data-report-drill="velocity" data-week-start="' + esc(w.start) + '" data-chart-tip="' + tip + '" />'
      + '<text x="' + (x + 28) + '" y="' + (184 - h - 6) + '" text-anchor="middle" class="bar-value">' + esc(fmtHours(w.completedMinutes)) + '</text>'
      + '<text x="' + (x + 28) + '" y="208" text-anchor="middle">' + esc(fmtDate(w.start)) + '</text>';
  }).join("");
  var avgY = 184 - Math.round((d.averageMinutes || 0) / max * 148);
  return '<section class="manager-chart-panel" data-chart="velocity"><div class="manager-panel-head"><b>速度图</b><span>近 4 周均值 ' + fmtHours(d.averageMinutes) + '</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近4周速度图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/>'
    + yGrid(max, axisMinutes) + bars
    + '<line x1="36" y1="' + avgY + '" x2="524" y2="' + avgY + '" class="average" stroke-dasharray="5 4"/></svg>'
    + '<div class="manager-chart-legend"><span><i class="velocity-block"></i>周完成工时</span><span><i class="average-line"></i>均值</span></div></section>';
}
function flowPolygon(weeks, lower, upper, max, cls){
  if(!weeks.length) return "";
  var top = weeks.map(function(w, i){
    var x = 36 + (weeks.length === 1 ? 0 : i * 488 / (weeks.length - 1));
    var y = 184 - ((lower(w) + upper(w)) / max * 148);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  var bottom = weeks.slice().reverse().map(function(w, reverseIndex){
    var i = weeks.length - 1 - reverseIndex;
    var x = 36 + (weeks.length === 1 ? 0 : i * 488 / (weeks.length - 1));
    var y = 184 - (lower(w) / max * 148);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  return '<polygon points="' + top.concat(bottom).join(" ") + '" class="' + cls + '" />';
}
function flowChart(d){
  var weeks = d.weeks || [], raw = 1;
  var endedOf = function(w){ return Number(w.ended) || 0; };
  weeks.forEach(function(w){ raw = Math.max(raw, w.backlog + w.doing + endedOf(w) + w.done); });
  var max = axisOf(raw).max;
  var hasEnded = weeks.some(function(w){ return endedOf(w) > 0; });
  var zero = function(){ return 0; }, done = function(w){ return w.done; };
  var ended = function(w){ return w.done + endedOf(w); }, doing = function(w){ return w.done + endedOf(w) + w.doing; };
  var hoverRects = "";
  if(weeks.length > 1){
    var step = 488 / (weeks.length - 1), band = step * 0.75;
    var bands = [["done", "已完成"], ["ended", "执行结束"], ["doing", "进行中"], ["backlog", "待处理"]];
    hoverRects = weeks.map(function(w, i){
      var x = 36 + i * step - band / 2;
      var tip = esc(w.start) + '：已完成 ' + w.done + (endedOf(w) ? ' / 执行结束 ' + endedOf(w) : '') + ' / 进行中 ' + w.doing + ' / 待处理 ' + w.backlog;
      var lower = 0;
      return bands.map(function(s){
        var value = s[0] === "done" ? Number(w.done) || 0
          : (s[0] === "ended" ? endedOf(w)
          : (s[0] === "doing" ? Number(w.doing) || 0 : Number(w.backlog) || 0));
        if(value <= 0) return "";
        var height = value / max * 148;
        var top = 184 - (lower + value) / max * 148;
        lower += value;
        return '<rect x="' + x + '" y="' + top.toFixed(1) + '" width="' + band + '" height="' + height.toFixed(1)
          + '" rx="3" class="flow-hover" data-report-drill="flow" data-week-start="' + esc(w.start)
          + '" data-flow-state="' + s[0] + '" data-chart-tip="' + tip + '" />';
      }).join("");
    }).join("");
  }
  return '<section class="manager-chart-panel" data-chart="flow"><div class="manager-panel-head"><b>累积流图</b><span>近 8 周 · 按列处理规则归类</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近8周累积流图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/>'
    + yGrid(max, function(v){ return Math.round(v); })
    + flowPolygon(weeks, zero, done, max, "flow-done") + (hasEnded ? flowPolygon(weeks, done, endedOf, max, "flow-ended") : "")
    + flowPolygon(weeks, ended, function(w){ return w.doing; }, max, "flow-doing")
    + flowPolygon(weeks, doing, function(w){ return w.backlog; }, max, "flow-backlog") + hoverRects + '</svg>'
    + '<div class="manager-chart-legend"><span><i class="done-block"></i>已完成</span>' + (hasEnded ? '<span><i class="ended-block"></i>执行结束</span>' : '') + '<span><i class="doing-block"></i>进行中</span><span><i class="backlog-block"></i>待处理</span></div></section>';
}
function deliveryChart(d){
  return '<section class="manager-chart-panel" data-chart="delivery"><div class="manager-panel-head"><b>交付周期分布</b><span>P50 ' + (d.p50Days === null ? "—" : d.p50Days + " 天") + ' · P85 ' + (d.p85Days === null ? "—" : d.p85Days + " 天") + '</span></div>'
    + '<div class="manager-delivery">' + (d.buckets || []).map(function(b){
      var tip = esc(b.label) + '：' + b.count + ' 项 · ' + b.pct + '%';
      return '<div data-chart-tip="' + tip + '" data-report-drill="delivery" data-delivery-bucket="' + esc(b.label) + '"><span>' + esc(b.label) + '</span><span class="progress"><i style="width:' + Math.min(100, b.pct) + '%"></i></span><b>' + b.count + ' 项 · ' + b.pct + '%</b></div>';
    }).join("") + '</div><p class="manager-note">从开始日期（空则创建日期）到完成日期；平均 ' + (d.averageDays === null ? "—" : d.averageDays + " 天") + '。</p></section>';
}
function defectChart(d){
  var weeks = d.weeks || [], raw = 1;
  weeks.forEach(function(w){ raw = Math.max(raw, w.opened, w.closed, w.open); });
  var max = axisOf(raw).max;
  var step = weeks.length > 1 ? 488 / (weeks.length - 1) : 0;
  var bars = weeks.map(function(w, i){
    var x = 36 + i * step;
    var openedH = Math.round(w.opened / max * 148), closedH = Math.round(w.closed / max * 148);
    var tip = esc(w.start) + '：新增 ' + w.opened + ' / 关闭 ' + w.closed + ' / 存量 ' + w.open;
    return '<g data-chart-tip="' + tip + '">'
      + '<rect x="' + (x - 12) + '" y="' + (184 - openedH) + '" width="11" height="' + openedH + '" rx="2" class="defect-opened" data-report-drill="defects" data-week-start="' + esc(w.start) + '" data-defect-state="opened" />'
      + '<rect x="' + (x + 1) + '" y="' + (184 - closedH) + '" width="11" height="' + closedH + '" rx="2" class="defect-closed" data-report-drill="defects" data-week-start="' + esc(w.start) + '" data-defect-state="closed" />'
      + (i % 2 === 0 ? '<text x="' + x.toFixed(1) + '" y="208" text-anchor="middle">' + esc(fmtDate(w.start)) + '</text>' : '')
      + '</g>';
  }).join("");
  var openPoints = weeks.map(function(w, i){
    return (36 + i * step).toFixed(1) + ',' + (184 - (w.open / max * 148)).toFixed(1);
  }).join(" ");
  var openHits = weeks.map(function(w, i){
    return '<circle cx="' + (36 + i * step).toFixed(1) + '" cy="' + (184 - (w.open / max * 148)).toFixed(1)
      + '" r="7" class="defect-open-hit" data-report-drill="defects" data-week-start="' + esc(w.start)
      + '" data-defect-state="open" data-chart-tip="' + esc(w.start) + '：周末存量 ' + w.open + ' 个" />';
  }).join("");
  return '<section class="manager-chart-panel" data-chart="defects"><div class="manager-panel-head"><b>缺陷趋势</b><span>当前存量 ' + (d.openCount || 0) + ' 个</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近8周缺陷趋势图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/><line x1="36" y1="36" x2="36" y2="184" class="axis"/>'
    + yGrid(max, function(v){ return Math.round(v); })
    + bars + '<polyline points="' + openPoints + '" fill="none" class="defect-open-line" />' + openHits + '</svg>'
    + '<div class="manager-chart-legend"><span><i class="defect-opened-block"></i>新增</span><span><i class="defect-closed-block"></i>关闭</span><span><i class="defect-open-line"></i>存量</span></div></section>';
}
function projectOptions(){
  var list = rt.reqList.filter(function(r){ return (!r.workspaceId || r.workspaceId === reportWorkspace()) && (!r.archivedAt || r.id === reqId); });
  return '<option value="">全部项目</option>' + list.map(function(r){ return '<option value="' + esc(r.id) + '"' + (r.id === reqId ? ' selected' : '') + '>' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>'; }).join("");
}
function reportLabelOptions(values, selected, all, unset){
  var list = Array.from(new Set((values || []).filter(function(v){ return v && v !== "__unset__"; }).concat(selected && selected !== "__unset__" ? [selected] : [])));
  return '<option value="">' + all + '</option><option value="__unset__"' + (selected === "__unset__" ? ' selected' : '') + '>' + unset + '</option>'
    + list.map(function(v){ return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(labelFilterText(v)) + '</option>'; }).join("");
}
function reportScopeText(data){
  var scope = data.scope || {}, project = (rt.reqList || []).filter(function(p){ return p.id === scope.reqId; })[0];
  return '项目：' + (scope.reqId ? (project ? project.name : scope.reqId) : '全部项目')
    + ' · 公司：' + (scope.companyName === '__unset__' ? '未设公司' : labelFilterText(scope.companyName) || '全部公司')
    + ' · 角色：' + (scope.roleTitle === '__unset__' ? '未设角色' : labelFilterText(scope.roleTitle) || '全部角色');
}
function reportToolbar(){
  var disabled = loading || !cache ? ' disabled' : '';
  return '<div class="manager-toolbar"><div><b>交付图表</b></div><div class="manager-actions"><button class="btn sm" type="button" data-report-csv' + disabled + '>导出 CSV</button><button class="btn sm" type="button" data-report-png' + disabled + '>导出 PNG</button>' + fullscreenButtonHTML() + '</div></div>'
    + '<div class="manager-label-filters"><label>项目 <select id="reportProjectSelect" class="mini-select">' + projectOptions() + '</select></label>'
    + '<label>公司 <select id="reportCompanySelect" class="mini-select">' + reportLabelOptions(reportOptions.companyNames, companyName, '全部公司', '未设公司') + '</select></label>'
    + '<label>角色 <select id="reportRoleSelect" class="mini-select">' + reportLabelOptions(reportOptions.roleTitles, roleTitle, '全部角色', '未设角色') + '</select></label>'
    + '<button class="btn sm soft" type="button" data-report-clear>' + icon("close", 13) + '清除筛选</button></div><p class="roster-note">按工作项所属项目的有效主角色或兼岗筛选；所有图表与导出由后台按同一范围重算。</p>';
}
function renderReport(){
  if(!cache || loading || filterWorkspace !== reportWorkspace()) return;
  var focused = document.activeElement && document.activeElement.id;
  $("reportBody").innerHTML = reportToolbar() + '<p class="roster-note">' + esc(reportScopeText(cache)) + '</p>'
    + caliberHTML('燃尽：近 14 天，剩余 = 范围内全部工作项的总预估 − 截至当日已完成工作项的实际工时（不是剩余预估）；理想线从总预估线性降到 0，窗口之前完成的工作项也会扣减，因此首日剩余可能低于理想线。范围 =「全部项目」时含已归档项目，选中单个项目时只含该项目。速度：近 4 个自然周，按完成时间归周；缺陷按创建/完成时间归周，只统计类型为「缺陷」的工作项；所有图表与工作项、计时数据同源。')
    + '<div class="manager-chart-grid">' + burnChart(cache.burndown || {}) + velocityChart(cache.velocity || {}) + flowChart(cache.flow || {}) + deliveryChart(cache.delivery || {}) + defectChart(cache.defects || {}) + '</div>';
  wireReportTooltip($("reportBody"));
  if(["reportProjectSelect","reportCompanySelect","reportRoleSelect"].indexOf(focused) !== -1){ var field = $(focused); if(field) field.focus(); }
}
function exportCsv(){
  if(!cache || loading || filterWorkspace !== reportWorkspace()) return;
  var rows = [["交付图表", reportScopeText(cache)], [],
    ["燃尽日期","剩余分钟","理想分钟"]];
  ((cache.burndown || {}).points || []).forEach(function(p){ rows.push([p.date,p.remainingMinutes,p.idealMinutes]); });
  rows.push([],["速度周开始","完成分钟","完成工作项数"]);
  ((cache.velocity || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.completedMinutes,w.completedCount]); });
  rows.push([],["累积流周开始","待处理","进行中","执行结束","已完成"]);
  ((cache.flow || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.backlog,w.doing,Number(w.ended) || 0,w.done]); });
  rows.push([],["交付周期","工作项数","占比"]);
  ((cache.delivery || {}).buckets || []).forEach(function(b){ rows.push([b.label,b.count,b.pct + "%"]); });
  rows.push([],["缺陷周开始","新增","关闭","周末存量"]);
  ((cache.defects || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.opened,w.closed,w.open]); });
  downloadCsv("管理报表.csv", rows); toast("已导出报表 CSV", "fs");
}
function exportPng(){
  if(!cache || loading || filterWorkspace !== reportWorkspace()) return;
  var c = reportThemeColors();
  var canvas = document.createElement("canvas"); canvas.width = 1400; canvas.height = 1400;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = c.bg; ctx.fillRect(0,0,1400,1400);
  ctx.fillStyle = c.text; ctx.font = "bold 28px sans-serif"; ctx.fillText("沙漏 管理报表", 40, 52);
  ctx.font = "15px sans-serif"; ctx.fillStyle = c.text3;
  /* 范围来自本次已返回的 scope，不读取可能刚被用户修改的筛选值。 */
  ctx.fillText(reportScopeText(cache), 40, 80, 1320);
  ctx.font = "12px sans-serif"; ctx.fillText("生成于 " + new Date().toLocaleString(), 40, 100);
  function panel(x,y,title){ ctx.fillStyle=c.surface;ctx.fillRect(x,y,640,390);ctx.fillStyle=c.text;ctx.font="bold 20px sans-serif";ctx.fillText(title,x+24,y+36); }
  function axes(x,y){ctx.strokeStyle=c.border;ctx.beginPath();ctx.moveTo(x+40,y+300);ctx.lineTo(x+600,y+300);ctx.moveTo(x+40,y+70);ctx.lineTo(x+40,y+300);ctx.stroke();}
  panel(40,110,"燃尽图 · 近 14 天"); axes(40,110);
  var burn=cache.burndown||{}, pts=burn.points||[], max=Math.max(1,burn.totalEstimateMinutes||0);
  [["idealMinutes",c.text3],["remainingMinutes",c.primary]].forEach(function(series){ctx.strokeStyle=series[1];ctx.lineWidth=3;ctx.beginPath();pts.forEach(function(p,i){var x=80+i*560/Math.max(1,pts.length-1),y=410-p[series[0]]/max*230;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();});
  panel(720,110,"速度图 · 近 4 周"); axes(720,110);
  var velocity=cache.velocity||{}, weeks=velocity.weeks||[], vmax=Math.max(1,velocity.averageMinutes||0);weeks.forEach(function(w){vmax=Math.max(vmax,w.completedMinutes);});
  ctx.fillStyle=c.primary;weeks.forEach(function(w,i){var h=w.completedMinutes/vmax*230;ctx.fillRect(790+i*140,410-h,70,h);});
  panel(40,550,"累积流图 · 近 8 周"); axes(40,550);
  var flow=(cache.flow||{}).weeks||[], fmax=1;flow=flow.map(function(w){return Object.assign({},w,{ended:Number(w.ended)||0});});flow.forEach(function(w){fmax=Math.max(fmax,w.backlog+w.doing+w.ended+w.done);});
  [["done",c.success,0],["ended",c.warning,1],["doing",c.info,2],["backlog",c.text3,3]].forEach(function(s){ctx.fillStyle=s[1];flow.forEach(function(w,i){var lower=s[2]===0?0:(s[2]===1?w.done:(s[2]===2?w.done+w.ended:w.done+w.ended+w.doing)),h=w[s[0]]/fmax*210,x=80+i*560/Math.max(1,flow.length-1),base=850-lower/fmax*210;ctx.fillRect(x,base-h,Math.max(8,560/Math.max(1,flow.length-1)),h);});});
  panel(720,550,"交付周期分布"); var buckets=(cache.delivery||{}).buckets||[];
  buckets.forEach(function(b,i){var y=640+i*65;ctx.fillStyle=c.text3;ctx.font="16px sans-serif";ctx.fillText(b.label,750,y);ctx.fillStyle=c.border;ctx.fillRect(850,y-18,350,20);ctx.fillStyle=c.primary;ctx.fillRect(850,y-18,350*Math.min(100,b.pct)/100,20);ctx.fillStyle=c.text;ctx.fillText(b.count+" 项 · "+b.pct+"%",1210,y);});
  panel(40,990,"缺陷趋势 · 近 8 周"); axes(40,990);
  var defect=(cache.defects||{}), dweeks=defect.weeks||[], dmax=1; dweeks.forEach(function(w){dmax=Math.max(dmax,w.opened,w.closed,w.open);});
  dweeks.forEach(function(w,i){
    var x=80+i*560/Math.max(1,dweeks.length-1);
    var oh=w.opened/dmax*230; ctx.fillStyle=c.warning; ctx.fillRect(x-12,1290-oh,9,oh);
    var ch=w.closed/dmax*230; ctx.fillStyle=c.success; ctx.fillRect(x+1,1290-ch,9,ch);
  });
  ctx.strokeStyle=c.text3;ctx.lineWidth=2;ctx.beginPath();dweeks.forEach(function(w,i){var x=80+i*560/Math.max(1,dweeks.length-1),y=1290-w.open/dmax*230;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
  ctx.fillStyle=c.text3;ctx.font="14px sans-serif";ctx.fillText("当前存量 " + (defect.openCount||0) + " 个（橙=新增 / 绿=关闭 / 灰线=存量）",80,1330);
  canvas.toBlob(function(blob){
    if(!blob){ toast("PNG 生成失败", "bad"); return; }
    var url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="管理报表.png";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1500);toast("已导出报表 PNG","fs");
  },"image/png");
}
/* ---------- 穿透：图表元素 → 与 /api/manager/reports 同范围的工作项明细分页 ---------- */
var flowStateLabels = {done: "已完成", ended: "执行结束", doing: "进行中", backlog: "待处理"};
var defectStateLabels = {opened: "新增", closed: "关闭", open: "存量"};
function openReportTasks(title, params){
  if(!cache || loading || filterWorkspace !== reportWorkspace()) return;
  var base = Object.assign({}, cache.scope || {}, params, {limit: 100});
  API.get("/api/manager/reports/tasks", Object.assign({}, base, {offset: 0})).then(function(page){
    var rows = (page && page.items) || [];
    if(!rows.length){ toast("该口径下暂无工作项", "warn"); return; }
    openTaskTable(title, rows, reportScopeText(cache) + " · 共 " + page.total + " 项 · 点击工作项行打开详情", {
      total: page.total,
      hasMore: page.hasMore,
      fetch: function(offset){
        return API.get("/api/manager/reports/tasks", Object.assign({}, base, {offset: offset}));
      }
    });
  }).catch(function(ex){ toast(ex && ex.message ? ex.message : "明细加载失败", "bad"); });
}
function onReportDrill(el){
  var chart = el.dataset.reportDrill;
  if(chart === "burn"){
    var date = el.dataset.burnDate;
    openReportTasks("燃尽 · 截至 " + fmtDate(date) + " 已完成", {chart: "burn", date: date});
  }else if(chart === "velocity"){
    var week = el.dataset.weekStart;
    openReportTasks("速度 · " + fmtDate(week) + " 当周完成", {chart: "velocity", weekStart: week});
  }else if(chart === "flow"){
    var start = el.dataset.weekStart, state = el.dataset.flowState;
    openReportTasks("累积流 · " + fmtDate(start) + " 周末「" + (flowStateLabels[state] || state) + "」",
      {chart: "flow", weekStart: start, state: state});
  }else if(chart === "delivery"){
    var bucket = el.dataset.deliveryBucket;
    openReportTasks("交付周期 · " + bucket, {chart: "delivery", bucket: bucket});
  }else if(chart === "defects"){
    var weekStart = el.dataset.weekStart, defectState = el.dataset.defectState;
    openReportTasks("缺陷 · " + fmtDate(weekStart) + " 周「" + (defectStateLabels[defectState] || defectState) + "」",
      {chart: "defects", weekStart: weekStart, state: defectState});
  }
}
if($("reportBody")){
  $("reportBody").addEventListener("click",function(e){
    var drill = e.target.closest("[data-report-drill]");
    if(drill){ onReportDrill(drill); return; }
    if(e.target.closest("[data-report-csv]")) exportCsv();
    else if(e.target.closest("[data-report-png]")) exportPng();
    else if(e.target.closest("[data-report-clear]")){ reqId = ""; companyName = ""; roleTitle = ""; loadReport(); }
    else if(e.target.closest("[data-empty-action]")) loadReport();
  });
  $("reportBody").addEventListener("change",function(e){
    var id = e.target.id;
    if(id === "reportProjectSelect") reqId = e.target.value;
    else if(id === "reportCompanySelect") companyName = e.target.value;
    else if(id === "reportRoleSelect") roleTitle = e.target.value;
    else return;
    loadReport(); var next = $(id); if(next) next.focus();
  });
}

export { enterReportView, loadReport };
