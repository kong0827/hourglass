/* views/report · 交付图表 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { loadReqs } from "./board.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours } from "./manager-shared.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";

var cache = null, seq = 0, reqId = "";
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
  if(!body) return;
  var current = ++seq;
  if(!opts.silent) body.innerHTML = UI.skeletonCards(4);
  API.get("/api/manager/reports", {reqId:reqId || null}).then(function(data){
    if(current !== seq) return;
    cache = data; renderReport();
  }).catch(function(ex){ if(current === seq) body.innerHTML = UI.errorState(ex.message); });
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
function burnChart(d){
  var points = d.points || [], max = Math.max(1, d.totalEstimateMinutes || 0);
  var actual = points.map(function(p){ return p.remainingMinutes; });
  var ideal = points.map(function(p){ return p.idealMinutes; });
  function dots(series, cls, labelKey){
    if(!points.length) return "";
    return points.map(function(p, i){
      var x = 36 + (points.length === 1 ? 0 : i * 488 / (points.length - 1));
      var y = 184 - (max ? p[labelKey] / max * 148 : 0);
      var tip = esc(fmtDate(p.date)) + ' · ' + (cls === 'ideal' ? '理想' : '实际') + ' ' + fmtHours(p[labelKey]);
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" class="burn-point ' + cls + '" data-chart-tip="' + tip + '" />';
    }).join("");
  }
  return '<section class="manager-chart-panel" data-chart="burn"><div class="manager-panel-head"><b>燃尽图</b><span>剩余 ' + fmtHours(d.remainingMinutes) + ' / ' + fmtHours(d.totalEstimateMinutes) + '</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近14天燃尽图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/><line x1="36" y1="36" x2="36" y2="184" class="axis"/>'
    + svgLine(ideal, max, "ideal", true) + svgLine(actual, max, "actual", false)
    + dots(points, "ideal", "idealMinutes") + dots(points, "actual", "remainingMinutes")
    + '<text x="36" y="208">' + esc(points.length ? fmtDate(points[0].date) : "—") + '</text><text x="524" y="208" text-anchor="end">' + esc(points.length ? fmtDate(points[points.length - 1].date) : "—") + '</text></svg>'
    + '<div class="manager-chart-legend"><span><i class="actual-line"></i>实际剩余</span><span><i class="ideal-line"></i>理想燃尽</span></div></section>';
}
function velocityChart(d){
  var weeks = d.weeks || [], max = Math.max(1, d.averageMinutes || 0);
  weeks.forEach(function(w){ max = Math.max(max, w.completedMinutes); });
  var bars = weeks.map(function(w, i){
    var h = Math.round(w.completedMinutes / max * 148), x = 64 + i * 120;
    var tip = esc(w.start) + '：' + fmtHours(w.completedMinutes) + '，' + w.completedCount + ' 项';
    return '<rect x="' + x + '" y="' + (184 - h) + '" width="56" height="' + h + '" rx="5" class="velocity-bar" data-chart-tip="' + tip + '" /><text x="' + (x + 28) + '" y="208" text-anchor="middle">' + esc(fmtDate(w.start)) + '</text>';
  }).join("");
  var avgY = 184 - Math.round((d.averageMinutes || 0) / max * 148);
  return '<section class="manager-chart-panel" data-chart="velocity"><div class="manager-panel-head"><b>速度图</b><span>近 4 周均值 ' + fmtHours(d.averageMinutes) + '</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近4周速度图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/>' + bars
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
  var weeks = d.weeks || [], max = 1;
  weeks.forEach(function(w){ max = Math.max(max, w.backlog + w.doing + w.done); });
  var zero = function(){ return 0; }, done = function(w){ return w.done; }, doing = function(w){ return w.done + w.doing; };
  var hoverRects = "";
  if(weeks.length > 1){
    var step = 488 / (weeks.length - 1), band = step * 0.75;
    hoverRects = weeks.map(function(w, i){
      var x = 36 + i * step - band / 2;
      var tip = esc(w.start) + '：已完成 ' + w.done + ' / 进行中 ' + w.doing + ' / 待处理 ' + w.backlog;
      return '<rect x="' + x + '" y="36" width="' + band + '" height="148" rx="3" class="flow-hover" data-chart-tip="' + tip + '" />';
    }).join("");
  }
  return '<section class="manager-chart-panel" data-chart="flow"><div class="manager-panel-head"><b>累积流图</b><span>近 8 周 · 三态快照</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近8周累积流图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/>'
    + flowPolygon(weeks, zero, done, max, "flow-done") + flowPolygon(weeks, done, function(w){ return w.doing; }, max, "flow-doing")
    + flowPolygon(weeks, doing, function(w){ return w.backlog; }, max, "flow-backlog") + hoverRects + '</svg>'
    + '<div class="manager-chart-legend"><span><i class="done-block"></i>已完成</span><span><i class="doing-block"></i>进行中</span><span><i class="backlog-block"></i>待处理</span></div></section>';
}
function deliveryChart(d){
  return '<section class="manager-chart-panel" data-chart="delivery"><div class="manager-panel-head"><b>交付周期分布</b><span>P50 ' + (d.p50Days === null ? "—" : d.p50Days + " 天") + ' · P85 ' + (d.p85Days === null ? "—" : d.p85Days + " 天") + '</span></div>'
    + '<div class="manager-delivery">' + (d.buckets || []).map(function(b){
      var tip = esc(b.label) + '：' + b.count + ' 项 · ' + b.pct + '%';
      return '<div data-chart-tip="' + tip + '"><span>' + esc(b.label) + '</span><span class="progress"><i style="width:' + Math.min(100, b.pct) + '%"></i></span><b>' + b.count + ' 项 · ' + b.pct + '%</b></div>';
    }).join("") + '</div><p class="manager-note">从开始日期（空则创建日期）到完成日期；平均 ' + (d.averageDays === null ? "—" : d.averageDays + " 天") + '。</p></section>';
}
function defectChart(d){
  var weeks = d.weeks || [], max = 1;
  weeks.forEach(function(w){ max = Math.max(max, w.opened, w.closed, w.open); });
  var step = weeks.length > 1 ? 488 / (weeks.length - 1) : 0;
  var bars = weeks.map(function(w, i){
    var x = 36 + i * step;
    var openedH = Math.round(w.opened / max * 148), closedH = Math.round(w.closed / max * 148);
    var tip = esc(w.start) + '：新增 ' + w.opened + ' / 关闭 ' + w.closed + ' / 存量 ' + w.open;
    return '<g data-chart-tip="' + tip + '">'
      + '<rect x="' + (x - 12) + '" y="' + (184 - openedH) + '" width="11" height="' + openedH + '" rx="2" class="defect-opened" />'
      + '<rect x="' + (x + 1) + '" y="' + (184 - closedH) + '" width="11" height="' + closedH + '" rx="2" class="defect-closed" />'
      + (i % 2 === 0 ? '<text x="' + x.toFixed(1) + '" y="208" text-anchor="middle">' + esc(fmtDate(w.start)) + '</text>' : '')
      + '</g>';
  }).join("");
  var openPoints = weeks.map(function(w, i){
    return (36 + i * step).toFixed(1) + ',' + (184 - (w.open / max * 148)).toFixed(1);
  }).join(" ");
  return '<section class="manager-chart-panel" data-chart="defects"><div class="manager-panel-head"><b>缺陷趋势</b><span>当前存量 ' + (d.openCount || 0) + ' 个</span></div>'
    + '<svg class="manager-chart" viewBox="0 0 560 220" role="img" aria-label="近8周缺陷趋势图"><line x1="36" y1="184" x2="524" y2="184" class="axis"/><line x1="36" y1="36" x2="36" y2="184" class="axis"/>'
    + bars + '<polyline points="' + openPoints + '" fill="none" class="defect-open-line" />' + '</svg>'
    + '<div class="manager-chart-legend"><span><i class="defect-opened-block"></i>新增</span><span><i class="defect-closed-block"></i>关闭</span><span><i class="defect-open-line"></i>存量</span></div></section>';
}
function projectOptions(){
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === reqId; });
  return '<option value="">全部项目</option>' + list.map(function(r){ return '<option value="' + esc(r.id) + '"' + (r.id === reqId ? ' selected' : '') + '>' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>'; }).join("");
}
function renderReport(){
  $("reportBody").innerHTML = '<div class="manager-toolbar"><div class="manager-project-picker"><b>交付图表</b><select id="reportProjectSelect" aria-label="报表项目范围">' + projectOptions() + '</select></div><div><button class="btn sm" type="button" data-report-csv>导出 CSV</button> <button class="btn sm" type="button" data-report-png>导出 PNG</button>' + fullscreenButtonHTML() + '</div></div>'
    + caliberHTML('燃尽 = 总预估 − 截至当日已完成工作项实际工时；速度按完成时间归周；缺陷按创建/完成时间归周，只统计类型为「缺陷」的工作项；所有图表与工作项、计时数据同源。')
    + '<div class="manager-chart-grid">' + burnChart(cache.burndown || {}) + velocityChart(cache.velocity || {}) + flowChart(cache.flow || {}) + deliveryChart(cache.delivery || {}) + defectChart(cache.defects || {}) + '</div>';
  wireReportTooltip($("reportBody"));
}
function exportCsv(){
  if(!cache) return;
  var rows = [["交付图表", reqId ? (rt.reqList.filter(function(r){ return r.id === reqId; })[0] || {}).name : "全部项目"], [],
    ["燃尽日期","剩余分钟","理想分钟"]];
  ((cache.burndown || {}).points || []).forEach(function(p){ rows.push([p.date,p.remainingMinutes,p.idealMinutes]); });
  rows.push([],["速度周开始","完成分钟","完成工作项数"]);
  ((cache.velocity || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.completedMinutes,w.completedCount]); });
  rows.push([],["累积流周开始","待处理","进行中","已完成"]);
  ((cache.flow || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.backlog,w.doing,w.done]); });
  rows.push([],["交付周期","工作项数","占比"]);
  ((cache.delivery || {}).buckets || []).forEach(function(b){ rows.push([b.label,b.count,b.pct + "%"]); });
  rows.push([],["缺陷周开始","新增","关闭","周末存量"]);
  ((cache.defects || {}).weeks || []).forEach(function(w){ rows.push([w.start,w.opened,w.closed,w.open]); });
  downloadCsv("管理报表.csv", rows); toast("已导出报表 CSV", "fs");
}
function exportPng(){
  if(!cache) return;
  var c = reportThemeColors();
  var canvas = document.createElement("canvas"); canvas.width = 1400; canvas.height = 1400;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = c.bg; ctx.fillRect(0,0,1400,1400);
  ctx.fillStyle = c.text; ctx.font = "bold 28px sans-serif"; ctx.fillText("沙漏 管理报表", 40, 52);
  ctx.font = "15px sans-serif"; ctx.fillStyle = c.text3; ctx.fillText("数据来自当前项目范围 · " + new Date().toLocaleString(), 40, 80);
  function panel(x,y,title){ ctx.fillStyle=c.surface;ctx.fillRect(x,y,640,390);ctx.fillStyle=c.text;ctx.font="bold 20px sans-serif";ctx.fillText(title,x+24,y+36); }
  function axes(x,y){ctx.strokeStyle=c.border;ctx.beginPath();ctx.moveTo(x+40,y+300);ctx.lineTo(x+600,y+300);ctx.moveTo(x+40,y+70);ctx.lineTo(x+40,y+300);ctx.stroke();}
  panel(40,110,"燃尽图 · 近 14 天"); axes(40,110);
  var burn=cache.burndown||{}, pts=burn.points||[], max=Math.max(1,burn.totalEstimateMinutes||0);
  [["idealMinutes",c.text3],["remainingMinutes",c.primary]].forEach(function(series){ctx.strokeStyle=series[1];ctx.lineWidth=3;ctx.beginPath();pts.forEach(function(p,i){var x=80+i*560/Math.max(1,pts.length-1),y=410-p[series[0]]/max*230;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();});
  panel(720,110,"速度图 · 近 4 周"); axes(720,110);
  var velocity=cache.velocity||{}, weeks=velocity.weeks||[], vmax=Math.max(1,velocity.averageMinutes||0);weeks.forEach(function(w){vmax=Math.max(vmax,w.completedMinutes);});
  ctx.fillStyle=c.primary;weeks.forEach(function(w,i){var h=w.completedMinutes/vmax*230;ctx.fillRect(790+i*140,410-h,70,h);});
  panel(40,550,"累积流图 · 近 8 周"); axes(40,550);
  var flow=(cache.flow||{}).weeks||[], fmax=1;flow.forEach(function(w){fmax=Math.max(fmax,w.backlog+w.doing+w.done);});
  [["done",c.success,0],["doing",c.info,1],["backlog",c.text3,2]].forEach(function(s){ctx.fillStyle=s[1];flow.forEach(function(w,i){var lower=s[2]===0?0:(s[2]===1?w.done:w.done+w.doing),h=w[s[0]]/fmax*210,x=80+i*560/Math.max(1,flow.length-1),base=850-lower/fmax*210;ctx.fillRect(x,base-h,Math.max(8,560/Math.max(1,flow.length-1)),h);});});
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
if($("reportBody")){
  $("reportBody").addEventListener("click",function(e){
    if(e.target.closest("[data-report-csv]")) exportCsv();
    else if(e.target.closest("[data-report-png]")) exportPng();
    else if(e.target.closest("[data-empty-action]")) loadReport();
  });
  $("reportBody").addEventListener("change",function(e){ if(e.target.id==="reportProjectSelect"){reqId=e.target.value;loadReport();} });
}

export { enterReportView, loadReport };
