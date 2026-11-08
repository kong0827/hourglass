/* views/workload · 成员跨项目负载 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { saveViewState } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { reqNameById, state } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, colName, priName, typeName } from "../lib/format.js";
import { loadBoard } from "./board.js";
import { applyListSavedView } from "./list.js";
import { caliberHTML, fmtHours, loadBarHTML, openTaskTable } from "./manager-shared.js";

var cache = null, seq = 0, mode = "week";
var pivotState = null;   /* 当前透视的格子数据，行/列/合计点击时取任务 */
var LOAD_PIVOT_KEY = "ds.workloadPivot";
var loadPivot = (function(){
  try{
    var p = JSON.parse(localStorage.getItem(LOAD_PIVOT_KEY) || "null");
    if(p && p.row && p.col && p.metric && p.row !== p.col) return p;
  }catch(e){ /* 受限环境忽略 */ }
  return {row:"member", col:"boardColumn", metric:"count"};
})();
var LOAD_PIVOT_DIMS = [["member", "成员"], ["project", "项目"], ["boardColumn", "状态"],
  ["priority", "优先级"], ["itemType", "类型"]];
var LOAD_PIVOT_METRICS = [["count", "任务数"], ["estimate", "预估工时"], ["actual", "已用工时"]];
function enterWorkloadView(){ loadWorkload(); }
function loadWorkload(opts){
  opts = opts || {};
  var body = $("workloadBody"); if(!body) return;
  var current = ++seq; if(!opts.silent) body.innerHTML = UI.skeletonRows(5);
  API.get("/api/manager/workload").then(function(data){ if(current===seq){cache=data;renderWorkload();} })
    .catch(function(ex){if(current===seq)body.innerHTML=UI.errorState(ex.message);});
}
function loadPivotDimLabel(dim){
  for(var i = 0; i < LOAD_PIVOT_DIMS.length; i++) if(LOAD_PIVOT_DIMS[i][0] === dim) return LOAD_PIVOT_DIMS[i][1];
  return dim;
}
function loadPivotValue(task, memberName, dim){
  if(dim === "member") return memberName || "未分配";
  if(dim === "project") return task.reqName || "未归类";
  if(dim === "boardColumn") return colName(task.boardColumn) || "未设置";
  if(dim === "priority") return task.priority ? priName(task.priority) : "未设置";
  if(dim === "itemType") return typeName(task.itemType) || "任务";
  return "—";
}
function loadPivotOrder(dim){
  if(dim === "priority"){
    var order = ["P0", "P1", "P2", "P3"];
    return function(a, b){ return (order.indexOf(a) < 0 ? 9 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 9 : order.indexOf(b)); };
  }
  return function(a, b){ return String(a).localeCompare(String(b), "zh-CN"); };
}
function loadPivotCell(metric, tasks){
  var n = 0;
  tasks.forEach(function(t){
    if(metric === "estimate") n += Number(t.estimateMinutes) || 0;
    else if(metric === "actual") n += Number(t.totalMinutes) || 0;
    else n += 1;
  });
  return n;
}
function loadPivotFmt(metric, v){
  return metric === "count" ? String(v) : fmtHours(v);
}
function pivotTable(){
  var rows = [], cols = [], buckets = {}, rowMap = {}, colMap = {}, all = [];
  (cache.members || []).forEach(function(m){
    (m.tasks || []).forEach(function(t){
      var r = loadPivotValue(t, m.name, loadPivot.row);
      var c = loadPivotValue(t, m.name, loadPivot.col);
      if(rows.indexOf(r) < 0) rows.push(r);
      if(cols.indexOf(c) < 0) cols.push(c);
      var key = r + "\u0000" + c;
      if(!buckets[key]) buckets[key] = [];
      buckets[key].push(t);
      (rowMap[r] = rowMap[r] || []).push(t);
      (colMap[c] = colMap[c] || []).push(t);
      all.push(t);
    });
  });
  rows.sort(loadPivotOrder(loadPivot.row));
  cols.sort(loadPivotOrder(loadPivot.col));
  pivotState = { cells: buckets, rows: rowMap, cols: colMap, all: all,
    rowDim: loadPivotDimLabel(loadPivot.row), colDim: loadPivotDimLabel(loadPivot.col) };
  if(!rows.length){
    return '<section class="manager-panel"><div class="manager-panel-head"><b>负载透视</b></div><div class="manager-empty-cell">暂无可透视的未完成任务</div></section>';
  }
  var metric = loadPivot.metric;
  function link(html, enabled, attrs){
    return enabled ? '<button class="manager-cell-link" type="button" ' + attrs + '>' + html + '</button>' : "—";
  }
  var head = '<tr><th>' + esc(loadPivotDimLabel(loadPivot.row)) + ' \\ ' + esc(loadPivotDimLabel(loadPivot.col)) + '</th>' +
    cols.map(function(c){
      var list = colMap[c] || [];
      return '<th class="num">' + link(esc(c), list.length, 'data-pv-col="' + esc(c) + '"') + '</th>';
    }).join("") + '<th class="num">合计</th></tr>';
  var body = rows.map(function(r){
    var cells = cols.map(function(c){
      var list = buckets[r + "\u0000" + c] || [];
      return '<td class="num">' + link(loadPivotFmt(metric, loadPivotCell(metric, list)), list.length,
        'data-pv-row="' + esc(r) + '" data-pv-col="' + esc(c) + '"') + '</td>';
    }).join("");
    var rowList = rowMap[r] || [];
    return '<tr><td>' + link(esc(r), rowList.length, 'data-pv-row="' + esc(r) + '"') + '</td>' + cells +
      '<td class="num">' + link('<b>' + loadPivotFmt(metric, loadPivotCell(metric, rowList)) + '</b>', rowList.length,
        'data-pv-row="' + esc(r) + '"') + '</td></tr>';
  }).join("");
  var foot = '<tr><td><b>合计</b></td>' +
    cols.map(function(c){
      var list = colMap[c] || [];
      return '<td class="num">' + link('<b>' + loadPivotFmt(metric, loadPivotCell(metric, list)) + '</b>', list.length,
        'data-pv-col="' + esc(c) + '"') + '</td>';
    }).join("") +
    '<td class="num">' + link('<b>' + loadPivotFmt(metric, loadPivotCell(metric, all)) + '</b>', all.length,
      'data-pv-all="1"') + '</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>负载透视</b><span>按两个维度交叉查看未完成任务 · 点击数字看任务</span></div>' +
    '<div class="tbl-wrap"><table class="manager-tbl pivot-tbl"><thead>' + head + '</thead><tbody>' + body + foot + '</tbody></table></div></section>';
}
function pivotPanel(){
  var dims = LOAD_PIVOT_DIMS.map(function(d){
    return '<option value="' + d[0] + '"' + (loadPivot.row === d[0] ? " selected" : "") + '>' + esc(d[1]) + '</option>';
  }).join("");
  var dims2 = LOAD_PIVOT_DIMS.map(function(d){
    return '<option value="' + d[0] + '"' + (loadPivot.col === d[0] ? " selected" : "") + '>' + esc(d[1]) + '</option>';
  }).join("");
  var metrics = LOAD_PIVOT_METRICS.map(function(m){
    return '<option value="' + m[0] + '"' + (loadPivot.metric === m[0] ? " selected" : "") + '>' + esc(m[1]) + '</option>';
  }).join("");
  return '<div class="manager-toolbar"><div><b>负载透视</b><span>行 × 列交叉统计</span></div>' +
    '<div class="row row-gap" style="gap:6px">' +
      '<select class="mini-select" data-load-pivot="row" aria-label="透视行维度">' + dims + '</select>' +
      '<span class="pivot-x">×</span>' +
      '<select class="mini-select" data-load-pivot="col" aria-label="透视列维度">' + dims2 + '</select>' +
      '<select class="mini-select" data-load-pivot="metric" aria-label="透视指标">' + metrics + '</select>' +
    '</div></div>' + pivotTable();
}

function matrix(){
  var projects = (cache.projects || []).slice();
  var hasNone = (cache.members || []).some(function(m){return (m.projects||[]).some(function(p){return !p.reqId && p.remainingMinutes>0;});});
  if(hasNone) projects.push({id:"",name:"未归类"});
  var head = '<tr><th>成员</th>' + projects.map(function(p){return '<th class="num">'+esc(p.name)+'</th>';}).join("") + '<th class="num">合计剩余</th><th>总负载</th><th>状态</th></tr>';
  var rows = (cache.members || []).map(function(m){
    var cells = projects.map(function(p){
      var group=(m.projects||[]).filter(function(x){return (x.reqId||"")===(p.id||"");})[0];
      return '<td class="num">'+(group&&group.remainingMinutes?'<button class="manager-cell-link" type="button" data-load-member="'+esc(m.key)+'" data-load-req="'+esc(p.id||"")+'">'+fmtHours(group.remainingMinutes)+'</button>':'—')+'</td>';
    }).join("");
    var status=m.overloaded?'<span class="mini-tag over">超载</span>':(m.loadPct>=85?'<span class="mini-tag warn">接近满载</span>':'<span class="mini-tag ok">可承接 '+fmtHours(Math.max(0,m.capacityMinutes-m.remainingMinutes))+'</span>');
    return '<tr><td><button class="manager-person manager-cell-link" type="button" data-load-member="'+esc(m.key)+'" data-load-all="1">'+avatarHTML(m.name,"sm")+'<b>'+esc(m.name)+'</b></button></td>'+cells+'<td class="num"><b>'+fmtHours(m.remainingMinutes)+'</b></td><td>'+loadBarHTML(m.loadPct)+'</td><td>'+status+'</td></tr>';
  }).join("") || '<tr><td colspan="20" class="manager-empty-cell">暂无成员负载数据</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>成员 × 项目负载矩阵</b><span>点击成员或项目工时进入任务列表</span></div><div class="tbl-wrap"><table class="manager-tbl manager-matrix"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div></section>';
}
function weekTable(){
  var days=["周一","周二","周三","周四","周五","周六","周日"];
  var rows=(cache.members||[]).map(function(m){
    var cells=(m.dayMinutes||[]).map(function(n){return '<td class="num">'+(n?fmtHours(n):'—')+'</td>';}).join("");
    var diff=(m.weekMinutes||0)-(m.lastWeekMinutes||0),cls=diff>0?"tag-warning":(diff<0?"tag-success":"tag-ghost");
    return '<tr><td><span class="manager-person">'+avatarHTML(m.name,"sm")+'<b>'+esc(m.name)+'</b></span></td>'+cells+'<td class="num"><b>'+fmtHours(m.weekMinutes)+'</b></td><td><span class="tag '+cls+'">'+(diff===0?'持平':((diff>0?'+':'−')+fmtHours(Math.abs(diff))))+'</span></td></tr>';
  }).join("")||'<tr><td colspan="10" class="manager-empty-cell">本周暂无计时记录</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>本周工时沉淀</b><span>与上周同口径对比</span></div><div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>成员</th>'+days.map(function(d){return '<th class="num">'+d+'</th>';}).join("")+'<th class="num">本周合计</th><th>上周对比</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}
function renderWorkload(){
  $("workloadBody").innerHTML='<div class="manager-toolbar"><div><b>成员负载 · 横切</b><span>同一成员跨项目任务合并计算</span></div><div class="seg mini"><button type="button" data-load-mode="person" aria-pressed="'+(mode==='person')+'">按人</button><button type="button" data-load-mode="week" aria-pressed="'+(mode==='week')+'">按周</button><button type="button" data-load-mode="pivot" aria-pressed="'+(mode==='pivot')+'">透视</button></div></div>'
    +caliberHTML('负载 = 剩余预估工时 ÷（剩余工作日 × 6h）；无截止日默认 5 个剩余工作日，容量上限按 20 天计算。')
    +(mode==='person'?matrix():(mode==='pivot'?pivotPanel():weekTable()));
}
if($("workloadBody"))$("workloadBody").addEventListener("click",function(e){
  var modeBtn=e.target.closest("[data-load-mode]");if(modeBtn){mode=modeBtn.dataset.loadMode;renderWorkload();return;}
  if(e.target.closest("[data-empty-action]")){loadWorkload();return;}
  var pv=e.target.closest("[data-pv-row],[data-pv-col],[data-pv-all]");
  if(pv&&pivotState){
    var pr=pv.dataset.pvRow||"", pc=pv.dataset.pvCol||"", tasks, title;
    if(pv.hasAttribute("data-pv-all")){ tasks=pivotState.all; title="全部"; }
    else if(pr&&pc){ tasks=pivotState.cells[pr+"\u0000"+pc]||[]; title=pr+" × "+pc; }
    else if(pr){ tasks=pivotState.rows[pr]||[]; title=pr; }
    else { tasks=pivotState.cols[pc]||[]; title=pc; }
    openTaskTable("负载透视 · "+title,tasks,
      pivotState.rowDim+" × "+pivotState.colDim+" · 共 "+(tasks||[]).length+" 项 · 点击任务行打开详情");
    return;
  }
  var btn=e.target.closest("[data-load-member]");if(!btn||!cache)return;
  var member=(cache.members||[]).filter(function(m){return m.key===btn.dataset.loadMember;})[0];if(!member)return;
  var req=btn.dataset.loadReq||"",all=btn.dataset.loadAll==="1";
  /* 进入任务列表页查看该成员任务（替代弹框）：负责人筛选 + 项目筛选叠加，其余条件清空避免误导 */
  state.q="";state.pris=[];state.cats=[];state.tags=[];state.types=[];state.due=null;state.focus=false;state.blocked=false;
  searchInput.value="";searchWrap.classList.remove("has");
  state.owners=[member.name];
  state.reqs=(!all&&req)?[req]:[];
  saveViewState();
  applyListSavedView("all",{preset:"all",group:"none",sort:"default"});
  showView("list");
  loadBoard({animate:false});
  toast("已在任务列表筛选：" + member.name + (state.reqs.length ? " · " + reqNameById(state.reqs[0]) : " · 全部项目"), "fs");
});
if($("workloadBody"))$("workloadBody").addEventListener("change", function(e){
  var sel = e.target.closest("[data-load-pivot]");
  if(!sel) return;
  var key = sel.dataset.loadPivot;
  if(key !== "row" && key !== "col" && key !== "metric") return;
  loadPivot[key] = sel.value;
  if(loadPivot.row === loadPivot.col){
    for(var i = 0; i < LOAD_PIVOT_DIMS.length; i++){
      if(LOAD_PIVOT_DIMS[i][0] !== sel.value){
        if(key === "row") loadPivot.col = LOAD_PIVOT_DIMS[i][0];
        else loadPivot.row = LOAD_PIVOT_DIMS[i][0];
        break;
      }
    }
  }
  try{ localStorage.setItem(LOAD_PIVOT_KEY, JSON.stringify(loadPivot)); }catch(err){ /* 忽略 */ }
  renderWorkload();
});

export { enterWorkloadView, loadWorkload };
