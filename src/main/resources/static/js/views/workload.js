/* views/workload · 成员跨项目负载 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { saveViewState } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { reqNameById, state } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML } from "../lib/format.js";
import { loadBoard } from "./board.js";
import { applyListSavedView } from "./list.js";
import { caliberHTML, fmtHours, loadBarHTML } from "./manager-shared.js";

var cache = null, seq = 0, mode = "week";
function enterWorkloadView(){ loadWorkload(); }
function loadWorkload(opts){
  opts = opts || {};
  var body = $("workloadBody"); if(!body) return;
  var current = ++seq; if(!opts.silent) body.innerHTML = UI.skeletonRows(5);
  API.get("/api/manager/workload").then(function(data){ if(current===seq){cache=data;renderWorkload();} })
    .catch(function(ex){if(current===seq)body.innerHTML=UI.errorState(ex.message);});
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
  $("workloadBody").innerHTML='<div class="manager-toolbar"><div><b>成员负载 · 横切</b><span>同一成员跨项目任务合并计算</span></div><div class="seg mini"><button type="button" data-load-mode="person" aria-pressed="'+(mode==='person')+'">按人</button><button type="button" data-load-mode="week" aria-pressed="'+(mode==='week')+'">按周</button></div></div>'
    +caliberHTML('负载 = 剩余预估工时 ÷（剩余工作日 × 6h）；无截止日默认 5 个剩余工作日，容量上限按 20 天计算。')
    +(mode==='person'?matrix():weekTable());
}
if($("workloadBody"))$("workloadBody").addEventListener("click",function(e){
  var modeBtn=e.target.closest("[data-load-mode]");if(modeBtn){mode=modeBtn.dataset.loadMode;renderWorkload();return;}
  if(e.target.closest("[data-empty-action]")){loadWorkload();return;}
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

export { enterWorkloadView, loadWorkload };
