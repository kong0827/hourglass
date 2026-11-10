/* views/portfolio · 项目总览（跨项目汇总，点项目名下钻项目看板） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import * as listPrefs from "../core/list-preferences.js";
import { showView } from "../core/router.js";
import { dueState, rt, statusBucket } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML } from "../lib/format.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { caliberHTML, downloadCsv, fmtHours, openTaskTable } from "./manager-shared.js";

var cache = null, seq = 0;
function enterPortfolioView(){ listPrefs.load("portfolio").then(function(){ loadPortfolio(); }); }
function loadPortfolio(opts){
  opts = opts || {};
  var body = $("portfolioBody");
  if(!body) return;
  var current = ++seq;
  if(!opts.silent) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/portfolio").then(function(data){
    if(current !== seq) return;
    cache = data;
    renderPortfolio();
  }).catch(function(ex){
    if(current !== seq) return;
    body.innerHTML = UI.errorState(ex.message);
  });
}
function mondayIso(today){
  var parts = String(today || "").substring(0, 10).split("-").map(Number);
  var d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
  var day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  function pad(n){ return n < 10 ? "0" + n : String(n); }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function tasksFor(reqId, metric){
  var rows = (cache.tasks || []).filter(function(t){ return !reqId || t.reqId === reqId; });
  if(metric === "backlog" || metric === "doing" || metric === "ended" || metric === "done") return rows.filter(function(t){ return statusBucket(t) === metric; });
  if(metric === "overdue") return rows.filter(function(t){ return dueState(t).kind === "over"; });
  if(metric === "blocked") return rows.filter(function(t){ return t.boardColumn !== "done" && t.blocked; });
  if(metric === "weekDone"){
    var monday = mondayIso(cache.today);
    return rows.filter(function(t){ return t.boardColumn === "done" && t.completedAt && String(t.completedAt).substring(0, 10) >= monday; });
  }
  return rows;
}
function kpi(label, value, foot, kind, cls){
  return '<button class="manager-kpi ' + (cls || "") + '" type="button" data-kpi="' + kind + '">'
    + '<span>' + esc(label) + '</span><b>' + value + '</b><small>' + esc(foot) + '</small></button>';
}
function projectCard(p){
  var healthName = p.health === "green" ? "正常" : "需关注";
  var tagCls = p.health === "green" ? "tag-success" : (p.health === "red" ? "tag-danger" : "tag-warning");
  var people = (p.members || []).slice(0, 4).map(function(name){ return avatarHTML(name, "sm"); }).join("");
  var foot = p.overloadedMembers ? '<span class="tag tag-warning">' + p.overloadedMembers + ' 人超载</span>'
    : (p.stagnantDays >= 7 ? '<span class="manager-stale">连续 ' + p.stagnantDays + ' 天无完成</span>'
      : '<span class="manager-stale">本周完成 ' + p.weekCompleted + ' 项 · 工时 ' + fmtHours(p.weekWorkMinutes) + '</span>');
  return '<article class="manager-project-card">'
    + '<div class="manager-project-head"><i class="manager-light ' + esc(p.health) + '"></i>'
    + '<button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '">' + esc(p.name) + '</button>'
    + '<span class="tag ' + tagCls + '">' + healthName + '</span></div>'
    + '<div class="manager-project-main"><span class="manager-ring ' + esc(p.health) + '" style="--p:' + p.progressPct + '"><b>' + p.progressPct + '%</b></span>'
    + '<div class="manager-project-stats">'
    + [["backlog","待处理",p.backlog],["doing","进行中",p.doing]].concat(p.ended ? [["ended","执行结束",p.ended]] : [], [["done","已完成",p.done],["overdue","逾期",p.overdue]]).map(function(x){
      return '<button type="button" class="' + (x[0] === "overdue" && x[2] ? "over" : "") + '" data-project-drill="' + esc(p.reqId) + '" data-metric="' + x[0] + '"><span>' + x[1] + '</span><b>' + x[2] + '</b></button>';
    }).join("") + '</div></div>'
    + '<div class="manager-project-foot"><span class="manager-avatars">' + people + '</span>' + foot + '</div></article>';
}
function statusName(st){
  return { active:"进行中", done:"已交付", hold:"已搁置" }[st] || st || "—";
}
function pfCell(p, key){
  if(key === "name"){
    return '<td><button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button></td>';
  }
  if(key === "status") return '<td><span class="tag ghost">' + esc(statusName(p.status)) + '</span></td>';
  if(key === "health"){
    var healthName = p.health === "green" ? "正常" : "需关注";
    var tagCls = p.health === "green" ? "tag-success" : (p.health === "red" ? "tag-danger" : "tag-warning");
    return '<td><span class="tag ' + tagCls + '">' + healthName + '</span></td>';
  }
  if(key === "progress"){
    return '<td class="num"><span class="progress mini" style="min-width:70px"><span class="bar"><i style="width:' +
      Math.max(0, Math.min(100, p.progressPct || 0)) + '%"></i></span><span class="pv">' + (p.progressPct || 0) + '%</span></span></td>';
  }
  if(key === "weekWorkMinutes") return '<td class="num">' + fmtHours(p.weekWorkMinutes) + '</td>';
  if(key === "members"){
    return '<td><span class="manager-avatars">' + (p.members || []).slice(0, 4).map(function(name){ return avatarHTML(name, "sm"); }).join("") + '</span></td>';
  }
  if(key === "backlog" || key === "doing" || key === "done" || key === "overdue"){
    var v = p[key] || 0;
    var cls = (key === "overdue" && v) ? "over" : "";
    return '<td class="num"><button type="button" class="' + cls + '" style="font:inherit;color:inherit" data-project-drill="' + esc(p.reqId) + '" data-metric="' + key + '" title="查看工作项明细"><b>' + v + '</b></button></td>';
  }
  return '<td class="num">' + (p[key] === null || p[key] === undefined ? "—" : p[key]) + '</td>';
}
function projectTable(projects){
  var cols = listPrefs.columns("portfolio"), labels = listPrefs.labels("portfolio");
  return '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + cols.map(function(key){ return '<th' + (["total","backlog","doing","done","overdue","blocked","progress","weekCompleted","weekWorkMinutes"].indexOf(key) !== -1 ? ' class="num"' : "") + '>' + esc(labels[key]) + '</th>'; }).join("")
    + '</tr></thead><tbody>'
    + projects.map(function(p){
        return '<tr>' + cols.map(function(key){ return pfCell(p, key); }).join("") + '</tr>';
      }).join("")
    + '</tbody></table></div></section>';
}
function renderPortfolio(){
  var k = cache.kpis || {}, projects = cache.projects || [];
  var active = projects.filter(function(p){ return p.status === "active"; }).length;
  var mode = listPrefs.viewMode("portfolio");
  var seg = '<div class="seg mini">'
    + '<button type="button" data-pf-mode="card" aria-pressed="' + (mode === "card") + '">卡片</button>'
    + '<button type="button" data-pf-mode="table" aria-pressed="' + (mode === "table") + '">列表</button>'
    + '</div>'
    + '<button class="btn sm" type="button" id="btnPortfolioColumns"' + (mode === "table" ? "" : " hidden") + '>显示字段</button>';
  $("portfolioBody").innerHTML = '<div class="manager-toolbar"><div><b>全局健康度</b><span>全部项目 · 点击指标查看明细，点项目名进入项目驾驶舱</span></div>'
    + '<div class="toolbar-right">' + seg + fullscreenButtonHTML()
    + '<button class="btn sm" type="button" data-portfolio-export>导出周报</button></div></div>'
    + caliberHTML('进度 = Σ工作项完成度 ÷ 工作项数；红灯 = 逾期占比 &gt;10% 且连续 7 天无完成，橙灯 = 有逾期或成员超载。分布按看板列的处理规则归类：待处理含「等待接续」列，进行中含「正常处理」的自定义列，「执行结束」列单独计数、不计未完成。统计范围含已归档项目（归档只是收起，数据与统计保留），不含你无权查看的项目；「本周」按自然周（周一起）计算。')
    + '<div class="manager-kpis">'
    + kpi("进行中项目", active + '<small> / ' + projects.length + '</small>', "共 " + projects.length + " 个项目", "projects")
    + kpi("逾期工作项", k.overdueTasks || 0, "未完成工作项", "overdue", k.overdueTasks ? "danger" : "")
    + kpi("本周完成", k.weekCompleted || 0, "按完成时间归周", "weekDone")
    + kpi("本周团队工时", fmtHours(k.weekWorkMinutes), "自动计时汇总", "hours") + '</div>'
    + (mode === "table"
      ? (projects.length ? projectTable(projects) : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"}))
      : '<div class="manager-legend"><span><i class="manager-light green"></i>正常</span><span><i class="manager-light orange"></i>有逾期或超载</span><span><i class="manager-light red"></i>逾期与停滞叠加</span></div>'
        + (projects.length ? '<div class="manager-project-grid" id="portfolioProjects">' + projects.map(projectCard).join("") + '</div>'
          : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"})));
}
function exportPortfolio(){
  if(!cache) return;
  var rows = [["项目周报", cache.today], [], ["项目","状态","健康度","总工作项","待处理","进行中","执行结束","已完成","逾期","阻塞","完成率","本周完成","本周工时(分钟)","预估(分钟)","实际(分钟)","超载人数","连续无完成天数"]];
  (cache.projects || []).forEach(function(p){
    rows.push([p.name,p.status,p.health,p.total,p.backlog,p.doing,p.ended || 0,p.done,p.overdue,p.blocked,p.progressPct + "%",p.weekCompleted,p.weekWorkMinutes,p.estimateMinutes,p.actualMinutes,p.overloadedMembers,p.stagnantDays]);
  });
  downloadCsv("项目周报-" + cache.today + ".csv", rows);
  toast("已导出项目周报", "fs");
}
/* KPI「进行中项目」下钻：列出进行中项目的进度与负载，点项目名进项目看板 */
function openActiveProjects(){
  var projects = (cache.projects || []).filter(function(p){ return p.status === "active"; });
  var rows = projects.map(function(p){
    var healthName = p.health === "green" ? "正常" : "需关注";
    var tagCls = p.health === "green" ? "tag-success" : (p.health === "red" ? "tag-danger" : "tag-warning");
    return '<tr>'
      + '<td><button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button></td>'
      + '<td><span class="tag ' + tagCls + '">' + healthName + '</span></td>'
      + '<td class="num">' + (p.progressPct || 0) + '%</td>'
      + '<td class="num">' + (p.backlog || 0) + '</td><td class="num">' + (p.doing || 0) + '</td><td class="num">' + (p.done || 0)
      + (p.ended ? ' <span class="muted" title="另有 ' + p.ended + ' 项在「执行结束」列">+' + p.ended + '</span>' : "") + '</td>'
      + '<td class="num"' + (p.overdue ? ' style="color:var(--danger-fg)"' : "") + '>' + (p.overdue || 0) + '</td>'
      + '<td><span class="manager-avatars">' + (p.members || []).slice(0, 4).map(function(n){ return avatarHTML(n, "sm"); }).join("") + '</span></td></tr>';
  }).join("") || '<tr><td colspan="8" class="manager-empty-cell">当前没有进行中的项目</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet manager-drill-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>进行中项目 · ' + projects.length + '</h2><div class="desc">点击项目名进入项目驾驶舱，卡片下钻可见工作项明细</div></div>'
    + '<button class="icon-btn sm" type="button" data-kpi-projects-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + '<th>项目</th><th>健康度</th><th class="num">进度</th><th class="num">待处理</th><th class="num">进行中</th><th class="num">已完成</th><th class="num">逾期</th><th>成员</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-kpi-projects-close]")){ UI.closeModal(layer); return; }
    var open = e.target.closest("[data-open-project]");
    if(open){ UI.closeModal(layer); rt.managerProjectId = open.dataset.openProject; showView("project"); }
  });
  UI.openModal(layer);
}
function onClick(e){
  var pfMode = e.target.closest("[data-pf-mode]");
  if(pfMode){
    var m = pfMode.dataset.pfMode;
    if(m === listPrefs.viewMode("portfolio")) return;
    listPrefs.setViewMode("portfolio", m).then(function(){ renderPortfolio(); })
      .catch(function(ex){ toast(ex.message || "切换失败", "bad"); });
    return;
  }
  if(e.target.closest("#btnPortfolioColumns")){
    listPrefs.openColumnSettings("portfolio", renderPortfolio);
    return;
  }
  if(e.target.closest("[data-portfolio-export]")){ exportPortfolio(); return; }
  if(e.target.closest("[data-empty-action]")){ loadPortfolio(); return; }
  var open = e.target.closest("[data-open-project]");
  if(open){ rt.managerProjectId = open.dataset.openProject; showView("project"); return; }
  var drill = e.target.closest("[data-project-drill]");
  if(drill){
    var p = (cache.projects || []).filter(function(x){ return x.reqId === drill.dataset.projectDrill; })[0];
    var metric = drill.dataset.metric;
    var names = {backlog:"待处理",doing:"进行中",ended:"执行结束",done:"已完成",overdue:"逾期"};
    openTaskTable((p ? p.name : "项目") + " · " + names[metric], tasksFor(drill.dataset.projectDrill, metric));
    return;
  }
  var k = e.target.closest("[data-kpi]");
  if(!k || !cache) return;
  var kind = k.dataset.kpi;
  if(kind === "projects"){
    openActiveProjects();
  }else if(kind === "hours"){
    var byTask = cache.weekWorkByTask || {};
    var rows = (cache.tasks || []).filter(function(t){ return byTask[t.id] > 0; }).map(function(t){
      var copy = Object.assign({}, t); copy.totalMinutes = byTask[t.id]; return copy;
    });
    openTaskTable("本周团队工时", rows, "实际列显示本周计时 · 合计 " + fmtHours((cache.kpis || {}).weekWorkMinutes));
  }else{
    openTaskTable(kind === "overdue" ? "全部逾期工作项" : "本周完成工作项", tasksFor(null, kind));
  }
}
if($("portfolioBody")) $("portfolioBody").addEventListener("click", onClick);

export { enterPortfolioView, loadPortfolio };
