/* views/risks · 逾期、阻塞与停滞：三组纵向清单 + 右侧「今天先做」 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML } from "../lib/format.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { icon } from "../core/icons.js";
import { daysBetween, downloadCsv, fmtDate } from "./manager-shared.js";

var cache = null, seq = 0, sending = false;
var filter = { scope:"all", owner:"", q:"", sort:"urgent" };
var KIND_META = {
  overdue: { title:"逾期", cls:"overdue" },
  blocked: { title:"被阻塞", cls:"blocked" },
  stagnant:{ title:"7 天未动", cls:"stagnant" }
};
function enterRisksView(){ loadRisks(); }
function loadRisks(opts){
  opts = opts || {};
  var body = $("risksBody");
  if(!body) return;
  var current = ++seq;
  if(!opts.silent) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/risks").then(function(data){
    if(current !== seq) return;
    cache = data;
    renderRisks();
  }).catch(function(ex){
    if(current === seq) body.innerHTML = UI.errorState(ex.message);
  });
}
function riskText(t, kind, today){
  if(kind === "overdue") return "逾期 " + Math.max(1, daysBetween(t.dueDate, today)) + " 天";
  if(kind === "stagnant") return "停滞 " + daysBetween(t.updatedAt, today) + " 天";
  return t.blockedReason || "等待解除阻塞";
}
function canManage(){ return !!(rt.currentWs && (rt.currentWs.myRole === "owner" || rt.currentWs.myRole === "admin")); }
function severity(t, kind, today){
  if(kind === "overdue") return Math.max(1, daysBetween(t.dueDate, today));
  if(kind === "stagnant") return daysBetween(t.updatedAt, today);
  return 1;
}
function uniqueRiskTasks(){
  var map = {};
  ["overdue","blocked","stagnant"].forEach(function(k){ ((cache && cache[k]) || []).forEach(function(t){ map[t.id] = t; }); });
  return Object.keys(map).map(function(id){ return map[id]; });
}
function riskOwners(){
  var seen = {}, out = [];
  uniqueRiskTasks().forEach(function(t){
    if(t.owner && !seen[t.owner]){ seen[t.owner] = 1; out.push(t.owner); }
  });
  return out.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
}
function meName(){
  var u = rt.currentUser || {};
  return u.displayName || u.name || u.username || "";
}
function rowsOf(kind){
  var today = cache.today;
  var mine = meName();
  return (cache[kind] || []).filter(function(t){
    if(filter.scope === "mine" && (!mine || t.owner !== mine)) return false;
    if(filter.owner && t.owner !== filter.owner) return false;
    if(filter.q && String(t.title || "").toLowerCase().indexOf(filter.q.toLowerCase()) === -1) return false;
    return true;
  }).sort(function(a, b){
    if(filter.sort === "due"){
      var da = a.dueDate ? String(a.dueDate).slice(0, 10) : "9999", db = b.dueDate ? String(b.dueDate).slice(0, 10) : "9999";
      if(da !== db) return da < db ? -1 : 1;
    }
    return severity(b, kind, today) - severity(a, kind, today);
  });
}
function groupMeta(kind, rows){
  if(!rows.length) return "";
  if(kind === "overdue"){
    var max = 0;
    rows.forEach(function(t){ max = Math.max(max, Math.max(1, daysBetween(t.dueDate, cache.today))); });
    return rows.length + " 项 · 最久 " + max + " 天";
  }
  if(kind === "blocked") return rows.length + " 项 · 等待外部";
  return rows.length + " 项";
}
function riskRowHTML(t, kind){
  var stateCls = kind === "overdue" ? " over" : (kind === "blocked" ? " warn" : " mute");
  return '<button class="risk-row" type="button" data-risk-open="' + esc(t.id) + '">' +
    '<span class="risk-row-title">' + esc(t.title) + '</span>' +
    '<span class="risk-row-proj">' + esc(t.reqName || "未归类") + '</span>' +
    '<span class="risk-row-owner">' + avatarHTML(t.owner || "未", "sm") + esc(t.owner || "未指派") + '</span>' +
    '<span class="risk-row-state' + stateCls + '" title="' + esc(riskText(t, kind, cache.today)) + '">' + esc(riskText(t, kind, cache.today)) + '</span>' +
    '<span class="risk-row-chev" aria-hidden="true">' + icon("chevronRight", 14) + '</span>' +
  '</button>';
}
function riskGroupHTML(kind){
  var rows = rowsOf(kind);
  var meta = KIND_META[kind];
  return '<section class="risk-group">' +
    '<header class="risk-group-head">' +
      '<span class="risk-dot ' + meta.cls + '"></span>' +
      '<b>' + meta.title + '</b>' +
      '<span class="risk-group-meta">' + esc(groupMeta(kind, rows)) + '</span>' +
    '</header>' +
    (rows.length ? '<div class="risk-rows">' + rows.map(function(t){ return riskRowHTML(t, kind); }).join("") + '</div>'
      : '<div class="risk-empty">暂无' + meta.title + '工作项</div>') +
  '</section>';
}
/* 右侧「今天先做」：逾期优先、越久越靠前，再补阻塞与停滞；只给阅读顺序，不改变任何状态 */
function todayTop(){
  var list = [];
  ["overdue","blocked","stagnant"].forEach(function(kind){
    rowsOf(kind).forEach(function(t){ list.push({ t:t, kind:kind, sev:severity(t, kind, cache.today) }); });
  });
  var seen = {};
  return list.filter(function(x){
    if(seen[x.t.id]) return false;
    seen[x.t.id] = 1;
    return true;
  }).sort(function(a, b){
    var rank = { overdue:0, blocked:1, stagnant:2 };
    return rank[a.kind] - rank[b.kind] || b.sev - a.sev;
  }).slice(0, 3);
}
function railHTML(){
  var top = todayTop();
  return '<aside class="risk-rail">' +
    '<section class="risk-rail-card">' +
      '<h4>今天先做这 ' + top.length + ' 件</h4>' +
      '<p class="risk-rail-sub">按逾期天数与下游影响排序</p>' +
      (top.length ? '<ol class="risk-todo">' + top.map(function(x, i){
        return '<li><span class="risk-todo-n">' + (i + 1) + '</span>' +
          '<span class="risk-todo-main"><button type="button" data-risk-open="' + esc(x.t.id) + '">' + esc(x.t.title) + '</button>' +
          '<span>' + esc(riskText(x.t, x.kind, cache.today)) + ' · ' + esc(x.t.reqName || "未归类") + ' · ' + esc(x.t.owner || "未指派") + '</span></span></li>';
      }).join("") + '</ol>' : '<p class="risk-rail-empty">当前没有需要优先处理的工作项。</p>') +
    '</section>' +
    '<div class="risk-rail-note">' + icon("clock", 13) + '<span>每天 18:30 自动刷新快照</span></div>' +
  '</aside>';
}
function renderRiskLists(){
  var main = $("riskMain");
  if(main) main.innerHTML = riskGroupHTML("overdue") + riskGroupHTML("blocked") + riskGroupHTML("stagnant");
  var rail = $("riskRail");
  if(rail) rail.innerHTML = railHTML();
  syncFilterUi();
}
function syncFilterUi(){
  var over = (cache.overdue || []).length, mine = 0, me = meName();
  (cache.overdue || []).forEach(function(t){ if(me && t.owner === me) mine++; });
  var allBtn = $("riskScopeAll"), mineBtn = $("riskScopeMine");
  if(allBtn){ allBtn.textContent = "全部项目 " + over; allBtn.setAttribute("aria-pressed", filter.scope === "all" ? "true" : "false"); }
  if(mineBtn){ mineBtn.textContent = "我负责 " + mine; mineBtn.setAttribute("aria-pressed", filter.scope === "mine" ? "true" : "false"); }
}
function renderRisks(){
  var today = cache.today, over = cache.overloaded || [];
  var overdueN = (cache.overdue || []).length;
  var nudgeAll = canManage()
    ? '<button class="btn primary sm" type="button" data-nudge-all ' + (overdueN ? '' : 'disabled') + '>' + icon("bell", 13) + '催办逾期 ' + overdueN + '</button>'
    : '';
  var owners = riskOwners();
  $("risksBody").innerHTML =
    '<div class="manager-toolbar risk-toolbar"><div><h2 class="risk-title">逾期与阻塞</h2>' +
      '<span class="risk-sub">当前快照 · 更新于 ' + esc(fmtDate(today)) + '</span></div>' +
      '<div class="manager-actions">' +
        '<button class="btn sm" type="button" data-risk-export>导出清单</button>' +
        nudgeAll + fullscreenButtonHTML() +
      '</div></div>' +
    '<div class="risk-banner">' + icon("info", 14) +
      '<span>催办会向负责人发送站内通知与已配置的外部推送，不生成新任务，也不改变状态。</span>' +
    '</div>' +
    (over.length ? '<button type="button" class="manager-overload-note" data-risk-overload title="查看成员负载"><b>' + over.length + ' 位成员超载</b><span>' + over.map(function(m){ return esc(m.name) + ' ' + m.loadPct + '%（剩余 ' + Math.round(m.remainingMinutes/60*10)/10 + 'h）'; }).join(' · ') + '</span></button>' : '') +
    '<div class="risk-filter">' +
      '<span class="seg mini" role="group" aria-label="范围">' +
        '<button type="button" id="riskScopeAll" data-risk-scope="all" aria-pressed="true">全部项目 ' + overdueN + '</button>' +
        '<button type="button" id="riskScopeMine" data-risk-scope="mine" aria-pressed="false">我负责 0</button>' +
      '</span>' +
      '<select class="mini-select" data-risk-owner aria-label="负责人">' +
        '<option value="">全部负责人</option>' +
        owners.map(function(n){ return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join("") +
      '</select>' +
      '<label class="risk-search">' + icon("search", 13) + '<input type="search" data-risk-q placeholder="搜索工作项标题" aria-label="搜索工作项标题"></label>' +
      '<select class="mini-select" data-risk-sort aria-label="排序">' +
        '<option value="urgent">按紧迫度排序</option>' +
        '<option value="due">按截止日期排序</option>' +
      '</select>' +
    '</div>' +
    '<div class="risk-layout"><div id="riskMain"></div><div id="riskRail"></div></div>';
  syncFilterUi();
  renderRiskLists();
}
function exportRisks(){
  if(!cache) return;
  var rows = [["逾期与阻塞", cache.today], [], ["类型","工作项","项目","负责人","状态","截止日期","优先级"]];
  ["overdue","blocked","stagnant"].forEach(function(kind){
    (cache[kind] || []).forEach(function(t){
      rows.push([KIND_META[kind].title, t.title, t.reqName || "", t.owner || "", riskText(t, kind, cache.today), t.dueDate || "", t.priority || ""]);
    });
  });
  downloadCsv("逾期与阻塞-" + cache.today + ".csv", rows);
  toast("已导出清单", "fs");
}
function postBatches(ids){
  var batches=[];for(var i=0;i<ids.length;i+=100)batches.push(ids.slice(i,i+100));
  var sent=0,skipped=0,deduped=0;
  return batches.reduce(function(p,batch){return p.then(function(){return API.post("/api/manager/nudges",{taskIds:batch}).then(function(r){sent+=r.sent||0;skipped+=r.skipped||0;deduped+=r.deduped||0;});});},Promise.resolve())
    .then(function(){return {sent:sent,skipped:skipped,deduped:deduped};});
}
function nudge(ids){
  if(!canManage()){toast("仅空间主或管理员可发起催办","warn");return;}
  if(sending||!ids.length)return;sending=true;
  postBatches(ids).then(function(r){toast("已催办 "+r.sent+" 项"+(r.deduped?"，"+r.deduped+" 项 6 小时内已催办过":"")+(r.skipped?"，"+r.skipped+" 项未匹配负责人":""),r.sent?"fs":"warn");})
    .catch(function(ex){toast(ex.message||"催办失败","bad");}).then(function(){sending=false;});
}
if($("risksBody"))$("risksBody").addEventListener("click",function(e){
  if(e.target.closest("[data-empty-action]")){loadRisks();return;}
  if(e.target.closest("[data-risk-overload]")){showView("workload");return;}
  if(e.target.closest("[data-risk-export]")){exportRisks();return;}
  var scope=e.target.closest("[data-risk-scope]");
  if(scope){filter.scope=scope.dataset.riskScope;renderRiskLists();return;}
  if(e.target.closest("[data-nudge-all]")){
    var ids=(cache.overdue||[]).map(function(t){return t.id;});
    UI.showConfirm({title:"催办逾期",msg:"将向这些逾期工作项的负责人发送站内通知，共 <b>"+ids.length+"</b> 项。是否继续？",okText:"发送催办",danger:false}).then(function(ok){if(ok)nudge(ids);});return;
  }
  var open=e.target.closest("[data-risk-open]");if(open)openTaskById(open.dataset.riskOpen);
});
if($("risksBody"))$("risksBody").addEventListener("change",function(e){
  var owner=e.target.closest("[data-risk-owner]");
  if(owner){filter.owner=owner.value;renderRiskLists();return;}
  var sort=e.target.closest("[data-risk-sort]");
  if(sort){filter.sort=sort.value;renderRiskLists();}
});
if($("risksBody"))$("risksBody").addEventListener("input",function(e){
  var q=e.target.closest("[data-risk-q]");
  if(q){filter.q=q.value.trim();renderRiskLists();}
});

export { enterRisksView, loadRisks };
