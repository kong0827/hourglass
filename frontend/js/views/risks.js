/* views/risks · 逾期、阻塞与停滞 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, priTagHTML } from "../lib/format.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { daysBetween, fmtDate } from "./manager-shared.js";

var cache=null,seq=0,sending=false;
function enterRisksView(){loadRisks();}
function loadRisks(opts){
  opts=opts||{};var body=$("risksBody");if(!body)return;var current=++seq;if(!opts.silent)body.innerHTML=UI.skeletonCards(3);
  API.get("/api/manager/risks").then(function(data){if(current===seq){cache=data;renderRisks();}})
    .catch(function(ex){if(current===seq)body.innerHTML=UI.errorState(ex.message);});
}
function riskText(t,kind,today){
  if(kind==="overdue")return "逾期 "+Math.max(1,daysBetween(t.dueDate,today))+" 天";
  if(kind==="stagnant")return "停滞 "+daysBetween(t.updatedAt,today)+" 天";
  return t.blockedReason||"等待解除阻塞";
}
function canManage(){ return !!(rt.currentWs && (rt.currentWs.myRole === "owner" || rt.currentWs.myRole === "admin")); }
function riskCard(t,kind,today){
  return '<article class="manager-risk-card '+kind+'"><button class="manager-risk-title" type="button" data-risk-open="'+esc(t.id)+'">'+esc(t.title)+'</button>'
    +'<div class="manager-risk-meta"><span>'+esc(t.reqName||"未归类")+'</span><span>'+priTagHTML(t.priority)+'</span><span>截止 '+esc(fmtDate(t.dueDate))+'</span></div>'
    +'<div class="manager-risk-foot"><span class="manager-person">'+avatarHTML(t.owner||"未","sm")+esc(t.owner||"未指派")+'</span><span title="'+esc(riskText(t,kind,today))+'">'+esc(riskText(t,kind,today))+'</span>'+(canManage()?'<button class="btn sm" type="button" data-nudge="'+esc(t.id)+'">催办</button>':'')+'</div></article>';
}
function riskColumn(kind,title,rows,today){
  return '<section class="manager-risk-col"><div class="manager-risk-head"><b>'+title+'</b><span>'+rows.length+'</span></div>'
    +(rows.length?rows.map(function(t){return riskCard(t,kind,today);}).join(""):'<div class="manager-risk-empty">暂无'+title+'工作项</div>')+'</section>';
}
function uniqueRiskTasks(){
  var map={};["overdue","blocked","stagnant"].forEach(function(k){((cache&&cache[k])||[]).forEach(function(t){map[t.id]=t;});});
  return Object.keys(map).map(function(id){return map[id];});
}
function renderRisks(){
  var today=cache.today,all=uniqueRiskTasks(),over=cache.overloaded||[];
  $("risksBody").innerHTML='<div class="manager-toolbar"><div><b>逾期与阻塞</b><span>逾期 / 阻塞 / 7 天未动 · 站内催办</span></div>'+(canManage()?'<button class="btn sm primary" type="button" data-nudge-all '+(all.length?'':'disabled')+'>全部催办（'+all.length+'）</button>':'')+fullscreenButtonHTML()+'</div>'
    +(over.length?'<button type="button" class="manager-overload-note" data-risk-overload title="查看成员负载"><b>'+over.length+' 位成员超载</b><span>'+over.map(function(m){return esc(m.name)+' '+m.loadPct+'%（剩余 '+Math.round(m.remainingMinutes/60*10)/10+'h）';}).join(' · ')+'</span></button>':'')
    +'<div class="manager-risk-grid">'+riskColumn("overdue","逾期",cache.overdue||[],today)+riskColumn("blocked","被阻塞",cache.blocked||[],today)+riskColumn("stagnant","7 天未动",cache.stagnant||[],today)+'</div>';
}
function postBatches(ids){
  var batches=[];for(var i=0;i<ids.length;i+=100)batches.push(ids.slice(i,i+100));
  var sent=0,skipped=0;
  return batches.reduce(function(p,batch){return p.then(function(){return API.post("/api/manager/nudges",{taskIds:batch}).then(function(r){sent+=r.sent||0;skipped+=r.skipped||0;});});},Promise.resolve())
    .then(function(){return {sent:sent,skipped:skipped};});
}
function nudge(ids){
  if(!canManage()){toast("仅空间主或管理员可发起催办","warn");return;}
  if(sending||!ids.length)return;sending=true;
  postBatches(ids).then(function(r){toast("已催办 "+r.sent+" 项"+(r.skipped?"，"+r.skipped+" 项未匹配负责人":""),r.sent?"fs":"warn");})
    .catch(function(ex){toast(ex.message||"催办失败","bad");}).then(function(){sending=false;});
}
if($("risksBody"))$("risksBody").addEventListener("click",function(e){
  if(e.target.closest("[data-empty-action]")){loadRisks();return;}
  if(e.target.closest("[data-risk-overload]")){showView("workload");return;}
  var single=e.target.closest("[data-nudge]");if(single){nudge([single.dataset.nudge]);return;}
  if(e.target.closest("[data-nudge-all]")){
    var ids=uniqueRiskTasks().map(function(t){return t.id;});
    UI.showConfirm({title:"全部催办",msg:"将向这些工作项的负责人发送站内通知，共 <b>"+ids.length+"</b> 项。是否继续？",okText:"发送催办",danger:false}).then(function(ok){if(ok)nudge(ids);});return;
  }
  var open=e.target.closest("[data-risk-open]");if(open)openTaskById(open.dataset.riskOpen);
});

export { enterRisksView, loadRisks };
