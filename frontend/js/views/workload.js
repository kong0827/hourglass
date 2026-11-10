/* views/workload · 成员跨项目负载 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtMinutesShort, typeBadgeHTML } from "../lib/format.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours, loadBarHTML, taskStatusName } from "./manager-shared.js";

var cache = null, seq = 0, mode = "week";
var WEEK_DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function enterWorkloadView(){ loadWorkload(); }
function loadWorkload(opts){
  opts = opts || {};
  var body = $("workloadBody"); if(!body) return;
  var current = ++seq; if(!opts.silent) body.innerHTML = UI.skeletonRows(5);
  API.get("/api/manager/workload").then(function(data){ if(current===seq){cache=data;renderWorkload();} })
    .catch(function(ex){if(current===seq)body.innerHTML=UI.errorState(ex.message);});
}
/* —— 成员抽屉：成员 → 项目 → 工作项 / 计时明细 逐层穿透 —— */
function memberByKey(key){
  return (cache && cache.members || []).filter(function(m){ return m.key === key; })[0];
}
function memberStatusTag(m){
  return m.overloaded ? '<span class="mini-tag over">超载</span>'
    : (m.loadPct >= 85 ? '<span class="mini-tag warn">接近满载</span>' : '<span class="mini-tag ok">正常</span>');
}
function memberTaskCount(m){ return (m.tasks || []).length; }
function memberProject(m, reqId){
  return (m.projects || []).filter(function(p){ return (p.reqId || "") === (reqId || ""); })[0];
}
function memberKpisHTML(m){
  return '<div class="member-sheet-kpis">'
    + '<div class="member-sheet-kpi"><i>未完成工作项</i><b>' + memberTaskCount(m) + ' 项</b></div>'
    + '<div class="member-sheet-kpi"><i>剩余预估</i><b>' + fmtHours(m.remainingMinutes) + '</b><span>剩余 ' + (m.workdays || 0) + ' 个工作日</span></div>'
    + '<div class="member-sheet-kpi"><i>本周已计</i><b>' + fmtHours(m.weekMinutes) + '</b><span>上周 ' + fmtHours(m.lastWeekMinutes) + '</span></div>'
    + '<div class="member-sheet-kpi"><i>负载</i><b>' + (Number(m.loadPct) || 0) + '%</b><span>容量 ' + fmtHours(m.capacityMinutes) + '</span></div>'
    + '</div>';
}
function memberProjectsHTML(m){
  var projects = (m.projects || []).slice().sort(function(a, b){ return (Number(b.remainingMinutes) || 0) - (Number(a.remainingMinutes) || 0); });
  if(!projects.length) return '<div class="manager-empty-cell">该成员暂无未完成工作项</div>';
  var total = Number(m.remainingMinutes) || 0;
  var rows = projects.map(function(p){
    var pct = total ? Math.round((Number(p.remainingMinutes) || 0) / total * 100) : 0;
    return '<tr data-member-project="' + esc(p.reqId || "") + '" tabindex="0" title="查看该项目下的工作项">'
      + '<td><b class="manager-drill-title">' + esc(p.name || "未归类") + '</b></td>'
      + '<td class="num">' + (p.taskCount || 0) + '</td>'
      + '<td class="num">' + fmtHours(p.remainingMinutes) + '</td>'
      + '<td><div class="member-share"><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></div></td>'
      + '</tr>';
  }).join("");
  return '<div class="member-layer-head"><b>项目分布</b>'
    + '<button class="member-link" type="button" data-member-all="1">查看全部工作项 →</button></div>'
    + '<div class="tbl-wrap"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th>项目</th><th class="num">未完成工作项</th><th class="num">剩余预估</th><th>剩余占比</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function memberWeekHTML(m){
  var days = m.dayMinutes || [];
  var hasLogs = (m.weekLogs || []).length > 0;
  var diff = (m.weekMinutes || 0) - (m.lastWeekMinutes || 0);
  var diffCls = diff > 0 ? "tag-warning" : (diff < 0 ? "tag-success" : "tag-ghost");
  var diffText = diff === 0 ? "持平" : ((diff > 0 ? "+" : "−") + fmtHours(Math.abs(diff)));
  var cells = WEEK_DAY_NAMES.map(function(name, i){
    var n = Number(days[i]) || 0;
    return '<button class="member-day" type="button"' + (n ? ' data-member-day="' + i + '" title="查看该日计时明细"' : ' disabled') + '>'
      + '<span>' + name + '</span><b>' + (n ? fmtHours(n) : "—") + '</b></button>';
  }).join("");
  var lastHTML = (m.lastWeekLogs || []).length
    ? '<button class="member-link" type="button" data-member-logs="last" title="查看上周计时明细">上周 ' + fmtHours(m.lastWeekMinutes) + ' <span class="tag ' + diffCls + '">' + diffText + '</span></button>'
    : '<span class="member-week-note">上周 ' + fmtHours(m.lastWeekMinutes) + ' · <span class="tag ' + diffCls + '">' + diffText + '</span></span>';
  var weekLink = hasLogs ? '<button class="member-link" type="button" data-member-logs="week">查看明细 →</button>' : '';
  return '<div class="member-layer-head"><b>本周工时</b>' + lastHTML + '</div>'
    + '<div class="member-days">' + cells + '</div>'
    + '<div class="member-week-foot">本周合计 <b>' + fmtHours(m.weekMinutes) + '</b>' + weekLink + '</div>';
}
function memberTasksHTML(m, layer){
  var tasks = (m.tasks || []).filter(function(t){ return layer.all || (t.reqId || "") === (layer.reqId || ""); });
  var rows = tasks.map(function(t){
    return '<tr data-open-task="' + esc(t.id) + '" tabindex="0" title="打开工作项详情">'
      + '<td><div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</div></td>'
      + '<td>' + esc(t.reqName || "未归类") + '</td>'
      + '<td>' + esc(taskStatusName(t)) + '</td>'
      + '<td class="num">' + esc(fmtDate(t.dueDate)) + '</td>'
      + '<td class="num">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
      + '<td class="num">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td></tr>';
  }).join("") || '<tr><td colspan="6" class="manager-empty-cell">该口径下暂无工作项</td></tr>';
  return '<button class="member-back" type="button" data-member-back>← 返回项目分布</button>'
    + '<div class="tbl-wrap"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th>工作项</th><th>项目</th><th>状态</th><th class="num">截止</th><th class="num">预估</th><th class="num">实际</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function memberLogsData(m, scope, dayIdx){
  var isLast = scope === "last";
  var all = (isLast ? m.lastWeekLogs : m.weekLogs) || [];
  var weekStart = isLast ? (cache && cache.lastWeekStart) : (cache && cache.weekStart);
  var hasDay = dayIdx !== undefined && dayIdx !== null && dayIdx !== "";
  var date = hasDay ? addDaysISO(weekStart, Number(dayIdx)) : "";
  var rows = hasDay ? all.filter(function(l){ return l.date === date; }) : all;
  var total = 0;
  rows.forEach(function(l){ total += Number(l.minutes) || 0; });
  var desc;
  if(hasDay){
    desc = WEEK_DAY_NAMES[Number(dayIdx)] + " " + fmtDate(date) + " 合计 " + fmtHours(total)
      + " · " + (isLast ? "上周" : "本周") + "合计 " + fmtHours(isLast ? m.lastWeekMinutes : m.weekMinutes);
  } else if(isLast){
    var d = (m.weekMinutes || 0) - (m.lastWeekMinutes || 0);
    desc = "上周合计 " + fmtHours(m.lastWeekMinutes) + " · 本周合计 " + fmtHours(m.weekMinutes)
      + "（差异 " + (d === 0 ? "持平" : (d > 0 ? "+" : "−") + fmtHours(Math.abs(d))) + "）";
  } else {
    desc = "本周合计 " + fmtHours(m.weekMinutes);
  }
  return { rows: rows, total: total, desc: desc };
}
function memberLogsHTML(m, scope, dayIdx){
  var data = memberLogsData(m, scope, dayIdx);
  var rows = data.rows.map(function(l){
    var attrs = l.taskId ? ' data-open-task="' + esc(l.taskId) + '" tabindex="0" title="打开工作项详情"' : "";
    var origin = l.origin === "manual" ? ' <span class="tag tag-ghost">补记</span>' : "";
    return '<tr' + attrs + '><td class="num">' + esc(fmtDate(l.date)) + '</td>'
      + '<td><div class="manager-task-title">' + esc(l.title) + origin + '</div></td>'
      + '<td>' + esc(l.reqName || "未归类") + '</td><td class="num">' + fmtHours(l.minutes) + '</td></tr>';
  }).join("") || '<tr><td colspan="4" class="manager-empty-cell">该时段暂无计时记录</td></tr>';
  return '<button class="member-back" type="button" data-member-back>← 返回项目分布</button>'
    + '<div class="member-layer-head"><b>' + (scope === "last" ? "上周计时" : "本周计时") + '</b>'
    + '<span>共 ' + data.rows.length + ' 条 · 点击记录行打开工作项</span></div>'
    + '<div class="tbl-wrap"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th class="num">日期</th><th>工作项</th><th>项目</th><th class="num">耗时</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function memberDesc(m, layer){
  if(layer.kind === "tasks"){
    var p = memberProject(m, layer.reqId);
    var tasks = (m.tasks || []).filter(function(t){ return layer.all || (t.reqId || "") === (layer.reqId || ""); });
    var remain = layer.all ? (Number(m.remainingMinutes) || 0) : (Number(p && p.remainingMinutes) || 0);
    return (layer.all ? "全部项目" : (p ? p.name : "未归类")) + " · " + tasks.length + " 项未完成 · 剩余 " + fmtHours(remain);
  }
  if(layer.kind === "logs") return memberLogsData(m, layer.logScope, layer.dayIdx).desc;
  return "剩余 " + fmtHours(m.remainingMinutes) + " · " + memberTaskCount(m) + " 个未完成工作项 · 本周已计 " + fmtHours(m.weekMinutes);
}
function openMemberSheet(member, opts){
  opts = opts || {};
  var state = {
    kind: opts.kind === "tasks" || opts.kind === "logs" ? opts.kind : "projects",
    reqId: opts.reqId || "",
    all: !!opts.all,
    logScope: opts.logScope === "last" ? "last" : "week",
    dayIdx: opts.dayIdx === undefined || opts.dayIdx === null || opts.dayIdx === "" ? undefined : opts.dayIdx
  };
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "成员负载：" + member.name);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  function bodyHTML(){
    if(state.kind === "tasks") return memberTasksHTML(member, state);
    if(state.kind === "logs") return memberLogsHTML(member, state.logScope, state.dayIdx);
    return memberProjectsHTML(member) + memberWeekHTML(member);
  }
  function render(focusBack){
    layer.innerHTML = '<div class="sheet manager-drill-sheet member-sheet">'
      + '<div class="sheet-head"><div class="member-sheet-id">' + avatarHTML(member.name, "lg")
      + '<div style="min-width:0"><h2>' + esc(member.name) + ' ' + memberStatusTag(member) + '</h2>'
      + '<div class="desc">' + esc(memberDesc(member, state)) + '</div></div></div>'
      + '<button class="icon-btn sm" type="button" data-manager-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body">' + memberKpisHTML(member) + bodyHTML() + '</div></div>';
    if(focusBack){
      var target = layer.querySelector("[data-member-back]") || layer.querySelector("[data-manager-close]");
      if(target) target.focus();
    }
  }
  function toProjects(){
    state.kind = "projects"; state.reqId = ""; state.all = false; state.dayIdx = undefined;
    render(true);
  }
  render();
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-manager-close]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-member-back]")){ toProjects(); return; }
    if(e.target.closest("[data-member-all]")){ state.kind = "tasks"; state.all = true; state.reqId = ""; render(true); return; }
    var proj = e.target.closest("[data-member-project]");
    if(proj){ state.kind = "tasks"; state.all = false; state.reqId = proj.dataset.memberProject || ""; render(true); return; }
    var day = e.target.closest("[data-member-day]");
    if(day){ state.kind = "logs"; state.dayIdx = Number(day.dataset.memberDay); render(true); return; }
    var logs = e.target.closest("[data-member-logs]");
    if(logs){ state.kind = "logs"; state.dayIdx = undefined; state.logScope = logs.dataset.memberLogs === "last" ? "last" : "week"; render(true); return; }
    var task = e.target.closest("[data-open-task]");
    if(task){ UI.closeModal(layer); openTaskById(task.dataset.openTask); }
  });
  layer.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest("[data-member-project],[data-open-task]");
    if(!row || e.target !== row) return;
    e.preventDefault();
    row.click();
  });
  UI.openModal(layer, state.kind === "projects" ? "" : "[data-member-back]");
}

function matrix(){
  var projects = (cache.projects || []).slice();
  var hasNone = (cache.members || []).some(function(m){return (m.projects||[]).some(function(p){return !p.reqId && p.remainingMinutes>0;});});
  if(hasNone) projects.push({id:"",name:"未归类"});
  var head = '<tr><th>成员</th>' + projects.map(function(p){return '<th class="num">'+esc(p.name)+'</th>';}).join("") + '<th class="num">合计剩余</th><th>总负载</th><th>状态</th></tr>';
  var rows = (cache.members || []).map(function(m){
    var cells = projects.map(function(p){
      var group=(m.projects||[]).filter(function(x){return (x.reqId||"")===(p.id||"");})[0];
      return '<td class="num">'+(group&&group.remainingMinutes?'<button class="manager-cell-link" type="button" data-member-open="'+esc(m.key)+'" data-member-layer="tasks" data-member-req="'+esc(p.id||"")+'" title="查看该项目下的工作项">'+fmtHours(group.remainingMinutes)+'</button>':'—')+'</td>';
    }).join("");
    var status=m.overloaded?'<span class="mini-tag over">超载</span>':(m.loadPct>=85?'<span class="mini-tag warn">接近满载</span>':'<span class="mini-tag ok">可承接 '+fmtHours(Math.max(0,m.capacityMinutes-m.remainingMinutes))+'</span>');
    return '<tr><td><button class="manager-person manager-cell-link" type="button" data-member-open="'+esc(m.key)+'" title="查看成员负载">'+avatarHTML(m.name,"sm")+'<b>'+esc(m.name)+'</b></button></td>'+cells+'<td class="num"><b>'+fmtHours(m.remainingMinutes)+'</b></td><td>'+loadBarHTML(m.loadPct)+'</td><td>'+status+'</td></tr>';
  }).join("") || '<tr><td colspan="20" class="manager-empty-cell">暂无成员负载数据</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>成员 × 项目负载矩阵</b><span>点击成员打开负载抽屉 · 点击工时穿透到项目工作项</span></div><div class="tbl-wrap"><table class="manager-tbl manager-matrix"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div></section>';
}
function weekTable(){
  var rows=(cache.members||[]).map(function(m){
    var hasLogs=(m.weekLogs||[]).length>0;
    var nameHTML='<button class="manager-person manager-cell-link" type="button" data-member-open="'+esc(m.key)+'"'+(hasLogs?' data-member-layer="logs"':'')+' title="查看成员负载">'+avatarHTML(m.name,"sm")+'<b>'+esc(m.name)+'</b></button>';
    var cells=(m.dayMinutes||[]).map(function(n,i){
      if(!n) return '<td class="num">—</td>';
      if(!hasLogs) return '<td class="num">'+fmtHours(n)+'</td>';
      return '<td class="num"><button class="manager-cell-link" type="button" data-member-open="'+esc(m.key)+'" data-member-layer="logs" data-member-day="'+i+'" title="查看该日计时明细">'+fmtHours(n)+'</button></td>';
    }).join("");
    var diff=(m.weekMinutes||0)-(m.lastWeekMinutes||0),cls=diff>0?"tag-warning":(diff<0?"tag-success":"tag-ghost");
    var diffHTML='<span class="tag '+cls+'">'+(diff===0?'持平':((diff>0?'+':'−')+fmtHours(Math.abs(diff))))+'</span>';
    if((m.lastWeekLogs||[]).length){
      diffHTML='<button class="manager-cell-link" type="button" data-member-open="'+esc(m.key)+'" data-member-layer="logs" data-member-scope="last" title="查看上周计时明细">'+diffHTML+'</button>';
    }
    var totalHTML=hasLogs?'<button class="manager-cell-link" type="button" data-member-open="'+esc(m.key)+'" data-member-layer="logs" title="查看本周计时明细"><b>'+fmtHours(m.weekMinutes)+'</b></button>':'<b>'+fmtHours(m.weekMinutes)+'</b>';
    return '<tr><td>'+nameHTML+'</td>'+cells+'<td class="num">'+totalHTML+'</td><td>'+diffHTML+'</td></tr>';
  }).join("")||'<tr><td colspan="10" class="manager-empty-cell">本周暂无计时记录</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>本周工时沉淀</b><span>与上周同口径对比 · 点击成员打开抽屉，点击格子看当日明细</span></div><div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>成员</th>'+WEEK_DAY_NAMES.map(function(d){return '<th class="num">'+d+'</th>';}).join("")+'<th class="num">本周合计</th><th>上周对比</th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}
function addDaysISO(iso, days){
  var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||"");
  if(!m) return "";
  var d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function exportMonthHours(){
  var now = new Date();
  var ym = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2);
  var today = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
  API.get("/api/mobile/workload", { from: ym + "-01", to: today }).then(function(data){
    var members = (data && data.members) || [];
    if(!members.length){ toast("本月还没有计时记录", "warn"); return; }
    var rows = [["成员", "计划工时(h)", "实际工时(h)", "投入率", "统计区间"]];
    members.forEach(function(m){
      rows.push([
        m.name || m.userId,
        (Number(m.plannedMinutes) || 0) / 60,
        (Number(m.actualMinutes) || 0) / 60,
        (Math.round((Number(m.percent) || 0) * 1000) / 10) + "%",
        (data.rangeFrom || (ym + "-01")) + " → " + (data.rangeTo || today)
      ]);
    });
    downloadCsv("本月工时-" + ym + ".csv", rows);
    toast("已导出 " + members.length + " 位成员的月度工时", "fs");
  }).catch(function(ex){
    toast(ex && ex.message ? ex.message : "月度工时导出失败", "bad");
  });
}
/* 每日容量以后端 capacityMinutesPerDay 为准（当前 480 分钟），避免口径文案与计算不一致 */
function capacityHoursLabel(data){
  var perDay = Number(data && data.capacityMinutesPerDay) || 480;
  return (Math.round(perDay / 6) / 10) + "h";
}
function renderWorkload(){
  $("workloadBody").innerHTML='<div class="manager-toolbar"><div><b>成员负载 · 横切</b><span>同一成员跨项目工作项合并计算</span></div><div class="seg mini"><button type="button" data-load-mode="person" aria-pressed="'+(mode==='person')+'">按人</button><button type="button" data-load-mode="week" aria-pressed="'+(mode==='week')+'">按周</button></div><button class="btn sm ghost" type="button" data-load-export title="导出当前自然月各成员的实际工时">导出本月工时</button>'+fullscreenButtonHTML()+'</div>'
    +caliberHTML('负载 = 剩余预估工时 ÷（剩余工作日 × '+capacityHoursLabel(cache)+'）；无截止日默认 5 个剩余工作日，容量上限按 20 天计算。')
    +(mode==='person'?matrix():weekTable());
}
if($("workloadBody"))$("workloadBody").addEventListener("click",function(e){
  var modeBtn=e.target.closest("[data-load-mode]");if(modeBtn){mode=modeBtn.dataset.loadMode;renderWorkload();return;}
  if(e.target.closest("[data-load-export]")){exportMonthHours();return;}
  if(e.target.closest("[data-empty-action]")){loadWorkload();return;}
  var opener=e.target.closest("[data-member-open]");
  if(opener&&cache){
    var member=memberByKey(opener.dataset.memberOpen);
    if(member){
      openMemberSheet(member,{
        kind: opener.dataset.memberLayer || "projects",
        reqId: opener.dataset.memberReq || "",
        logScope: opener.dataset.memberScope || "week",
        dayIdx: opener.dataset.memberDay
      });
    }
  }
});

export { enterWorkloadView, loadWorkload };
