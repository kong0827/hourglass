/* views/project · 项目管理总览：单项目看板 + 全部项目透视表 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import * as listPrefs from "../core/list-preferences.js";
import { openTaskById } from "../core/task-actions.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtMinutesShort, typeBadgeHTML } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours, loadBarHTML, openTaskTable, taskStatusName } from "./manager-shared.js";

var VIEW_KEY = "project-view";
var TAB_KEY = "ds.projectTab";
var cache = null, seq = 0;
var pfCache = null, expanded = {};
var effectiveMode = null, drillSort = "default", drillOnlyRisk = false, drillInitialized = false;
var projectTab = (function(){
  try{ return localStorage.getItem(TAB_KEY) || "overview"; }catch(e){ return "overview"; }
})();
function setProjectTab(tab){
  if(["overview","epics","members"].indexOf(tab) === -1) return;
  projectTab = tab;
  try{ localStorage.setItem(TAB_KEY, tab); }catch(e){ /* 受限环境忽略 */ }
  if(cache && currentMode() === "board") renderProject();
}
function projectTabBar(){
  var tabs = [["overview","概览"],["epics","史诗"],["members","成员负载"]];
  return '<div class="seg mini project-tabs" role="tablist" aria-label="项目详情分区">' + tabs.map(function(t){
    var on = projectTab === t[0];
    return '<button type="button" role="tab" data-project-tab="' + t[0] + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + t[1] + '</button>';
  }).join("") + '</div>';
}
function enterProjectView(){
  effectiveMode = null;
  listPrefs.load(VIEW_KEY).then(function(){
    if(rt.reqsLoaded) loadProject();
    else loadReqs().then(loadProject);
  });
}
/* 临时覆盖只影响本次浏览：点项目名跳看板不改写用户持久化偏好 */
function currentMode(){ return effectiveMode || listPrefs.viewMode(VIEW_KEY); }
function selectableReqs(){
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === rt.managerProjectId; });
  return list.length ? list : rt.reqList;
}
function selectedProject(){
  var list = selectableReqs();
  if(!list.length) return null;
  var hit = list.filter(function(r){ return r.id === rt.managerProjectId; })[0];
  if(!hit){ hit = list[0]; rt.managerProjectId = hit.id; }
  return hit;
}
function loadProject(opts){
  opts = opts || {};
  var body = $("projectBody");
  if(!body) return;
  if(currentMode() === "drill"){ loadDrill(opts); return; }
  var selected = selectedProject();
  if(!selected){
    body.innerHTML = UI.emptyState({icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目。"});
    return;
  }
  var current = ++seq;
  if(!opts.silent) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/projects/" + encodeURIComponent(selected.id)).then(function(data){
    if(current !== seq) return;
    cache = data; renderProject();
  }).catch(function(ex){ if(current === seq) body.innerHTML = UI.errorState(ex.message); });
}
function metric(label, value, foot, kind){
  return '<button class="manager-kpi" type="button" data-project-metric="' + kind + '"><span>' + esc(label) + '</span><b>' + value + '</b><small>' + esc(foot) + '</small></button>';
}
function distRow(label, value, total, kind, cls){
  var pct = total ? Math.round(value / total * 100) : 0;
  return '<button class="manager-dist-row" type="button" data-project-metric="' + kind + '"><span><i class="manager-dot ' + (cls || "") + '"></i>' + label + '</span><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + value + '</b></button>';
}
function weeklyChart(weeks){
  var max = 1;
  weeks.forEach(function(w){ max = Math.max(max, w.created, w.completed); });
  return '<div class="manager-week-chart">' + weeks.map(function(w){
    return '<div class="manager-week" title="' + esc(w.start) + '：新增 ' + w.created + ' / 完成 ' + w.completed + '">'
      + '<span class="manager-week-bars"><i class="created" style="height:' + Math.round(w.created / max * 100) + '%"></i><i class="completed" style="height:' + Math.round(w.completed / max * 100) + '%"></i></span>'
      + '<small>' + esc(fmtDate(w.start)) + '</small></div>';
  }).join("") + '</div><div class="manager-chart-legend"><span><i class="created"></i>新增</span><span><i class="completed"></i>完成</span></div>';
}
function memberRows(members){
  if(!members.length) return '<tr><td colspan="6" class="manager-empty-cell">暂无未完成工作项</td></tr>';
  return members.map(function(m){
    return '<tr data-member-key="' + esc(m.key) + '" title="查看该成员的项目工作项"><td><span class="manager-person">' + avatarHTML(m.name, "sm") + '<b>' + esc(m.name) + '</b></span></td>'
      + '<td class="num">' + m.taskCount + '</td><td class="num">' + fmtHours(m.remainingMinutes) + '</td>'
      + '<td class="num">' + fmtHours(m.actualWeekMinutes) + '</td><td>' + loadBarHTML(m.loadPct) + '</td>'
      + '<td>' + (m.overloaded ? '<span class="mini-tag over">超载</span>' : (m.loadPct >= 85 ? '<span class="mini-tag warn">接近满载</span>' : '<span class="mini-tag ok">正常</span>')) + '</td></tr>';
  }).join("");
}
function modeSeg(){
  var mode = currentMode();
  return '<div class="seg mini">'
    + '<button type="button" data-pv-mode="board" aria-pressed="' + (mode === "board") + '">单项目</button>'
    + '<button type="button" data-pv-mode="drill" aria-pressed="' + (mode === "drill") + '">全部项目透视</button>'
    + '</div>';
}
function dayDiff(from, to){
  function utc(s){ var a = String(s).slice(0, 10).split("-"); return Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2])); }
  return Math.round((utc(to) - utc(from)) / 86400000);
}
function projectBrief(p, m, c, members){
  var facts = [];
  facts.push('<span><i>负责人</i><b>' + esc(p.ownerName || "未指定") + '</b></span>');
  facts.push('<span><i>计划周期</i><b>' + (p.plannedStart || p.plannedEnd
    ? esc(fmtDate(p.plannedStart) + " → " + fmtDate(p.plannedEnd))
    : "未设置") + '</b></span>');
  var daysLeft = p.plannedEnd && cache.today ? dayDiff(cache.today, p.plannedEnd) : null;
  if(daysLeft !== null){
    facts.push('<span><i>计划' + (daysLeft < 0 ? "超期" : "剩余") + '</i><b' + (daysLeft < 0 ? ' style="color:var(--danger-fg)"' : "") + '>'
      + Math.abs(daysLeft) + ' 天</b></span>');
  }
  facts.push('<span><i>首版上线</i><b>' + (p.firstReleasedAt ? esc(fmtDate(p.firstReleasedAt)) : "未标记") + '</b></span>');

  var risks = [];
  if(!p.ownerName) risks.push('<span class="mini-tag warn">未指定负责人</span>');
  if(c.overdue) risks.push('<span class="mini-tag over">逾期 ' + c.overdue + ' 项</span>');
  if(c.blocked) risks.push('<span class="mini-tag warn">阻塞 ' + c.blocked + ' 项</span>');
  var overloaded = (members || []).filter(function(x){ return x.overloaded; }).length;
  if(overloaded) risks.push('<span class="mini-tag over">' + overloaded + ' 人超载</span>');
  if(daysLeft !== null && daysLeft < 0 && (m.progressPct || 0) < 100) risks.push('<span class="mini-tag over">已超计划结束 ' + Math.abs(daysLeft) + ' 天</span>');
  if(!risks.length) risks.push('<span class="mini-tag ok">暂无风险信号</span>');

  return (p.archivedAt ? '<div class="project-brief-archived">该项目已归档：默认列表不再展示，数据完整保留。</div>' : '')
    + '<section class="manager-panel project-brief"><div class="project-brief-main">'
    + '<span class="project-brief-label">项目目标</span>'
    + '<p class="project-brief-goal' + (p.objective ? "" : " muted") + '">' + esc(p.objective || p.description || "未填写项目目标，可在「编辑项目」中补充") + '</p>'
    + '<div class="project-brief-facts">' + facts.join("") + '</div></div>'
    + '<div class="project-brief-risk"><span class="project-brief-label">风险信号</span><div>' + risks.join("") + '</div></div>'
    + '</section>';
}
function renderProject(){
  var p = cache.project || {}, m = cache.metrics || {}, c = cache.counts || {}, tasks = cache.tasks || [];
  var total = tasks.length, done = c.done || 0, progress = m.progressPct || 0;
  var options = selectableReqs().map(function(r){ return '<option value="' + esc(r.id) + '"' + (r.id === p.reqId ? ' selected' : '') + '>' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>'; }).join("");
  var deviation = m.deviationPct === null || m.deviationPct === undefined ? "—" : ((m.deviationPct > 0 ? "+" : "") + m.deviationPct + "%");
  var epics = cache.epics || [];
  var toolbar = '<div class="manager-toolbar"><div class="manager-project-picker">'
    + '<button class="btn sm ghost" type="button" id="btnProjectBack" title="返回项目列表">← 项目列表</button>'
    + '<b>' + esc(p.name || "项目驾驶舱") + '</b><select id="managerProjectSelect" aria-label="切换项目">' + options + '</select></div>'
    + '<div class="toolbar-right">' + modeSeg() + '<span class="tag tag-primary">整体完成 ' + progress + '%</span>' + fullscreenButtonHTML() + '</div></div>';
  var overview = caliberHTML('整体进度 = Σ工作项完成度 ÷ 工作项数；指标由工作项流转、预估与自动计时汇总，不提供手填项目进度。')
    + projectBrief(p, m, c, cache.members)
    + '<div class="manager-kpis">'
    + metric("计划周期", '<span class="manager-date-value">' + fmtDate(m.startDate) + ' → ' + fmtDate(m.dueDate) + '</span>', total + " 个工作项", "all")
    + metric("预估工时合计", fmtHours(m.estimateMinutes), "剩余 " + fmtHours(m.remainingMinutes), "estimate")
    + metric("实际投入", fmtHours(m.actualMinutes), "含进行中工作项", "actual")
    + metric("工时偏差（已完成工作项口径）", deviation, "（实际−预估）÷预估", "variance") + '</div>'
    + '<div class="manager-two-col"><section class="manager-panel"><div class="manager-panel-head"><b>工作项分布</b><span>' + total + ' 个工作项</span></div>'
    + distRow("待处理", c.backlog || 0, total, "backlog") + distRow("进行中", c.doing || 0, total, "doing", "info")
    + distRow("已完成", done, total, "done", "success") + distRow("逾期", c.overdue || 0, total, "overdue", "danger")
    + distRow("被阻塞", c.blocked || 0, total, "blocked", "warning") + '</section>'
    + '<section class="manager-panel"><div class="manager-panel-head"><b>近 8 周新增 / 完成</b><span>按周汇总</span></div>' + weeklyChart(cache.weekly || []) + '</section></div>';
  var epicsPanel = '<section class="manager-panel"><div class="manager-panel-head"><b>史诗汇总</b><span>点击史诗查看子项</span></div>'
    + (epics.length ? epics.map(function(ep){
      return '<button class="manager-epic" type="button" data-epic="' + esc(ep.id) + '"><span><i class="tag tag-plum">史诗</i>' + esc(ep.title) + '</span><span class="progress"><i style="width:' + ep.progressPct + '%"></i></span><b>' + ep.done + ' / ' + ep.total + ' 子项 · ' + ep.progressPct + '%</b></button>';
    }).join("") : '<div class="manager-empty-cell">该项目还没有史诗</div>') + '</section>';
  var membersPanel = '<section class="manager-panel"><div class="manager-panel-head"><b>成员负载</b><span>剩余预估 ÷（剩余工作日 × 6h）</span></div><div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>成员</th><th class="num">未完成工作项</th><th class="num">剩余预估</th><th class="num">本周已计</th><th>负载</th><th>状态</th></tr></thead><tbody>'
    + memberRows(cache.members || []) + '</tbody></table></div></section>';
  var panel = projectTab === "epics" ? epicsPanel : (projectTab === "members" ? membersPanel : overview);
  $("projectBody").innerHTML = toolbar + projectTabBar() + '<div class="project-tab-panel" role="tabpanel">' + panel + '</div>';
}
/* —— 全部项目透视：项目 → Epic → 任务 逐层展开 —— */
function loadDrill(opts){
  opts = opts || {};
  var body = $("projectBody");
  if(!body) return;
  var current = ++seq;
  if(!opts.silent && !pfCache) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/portfolio").then(function(data){
    if(current !== seq) return;
    pfCache = data; renderDrill();
  }).catch(function(ex){
    if(current === seq) body.innerHTML = UI.errorState(ex.message);
  });
}
function statusName(st){
  return { active:"进行中", done:"已交付", hold:"已搁置" }[st] || st || "—";
}
function miniBar(pct){
  var n = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return '<span class="progress mini"><span class="bar"><i style="width:' + n + '%"></i></span><span class="pv">' + n + '%</span></span>';
}
function drillTasks(){ return (pfCache && pfCache.tasks) || []; }
function plainTasks(reqId){
  return drillTasks().filter(function(t){ return t.reqId === reqId && t.itemType !== "epic"; });
}
function epicTasks(reqId){
  return drillTasks().filter(function(t){ return t.reqId === reqId && t.itemType === "epic"; });
}
function childrenOf(epicId){
  return drillTasks().filter(function(t){ return t.epicId === epicId && t.itemType !== "epic"; });
}
function ungroupedOf(reqId){
  return plainTasks(reqId).filter(function(t){ return !t.epicId; });
}
function isDone(t){ return t.boardColumn === "done"; }
/* 与后端 TaskCalc.progressOf 同口径：已完成记 100，其余取记录进度 */
function taskPct(t){
  return isDone(t) ? 100 : Math.max(0, Math.min(100, Number(t.progress) || 0));
}
function avgPct(tasks){
  if(!tasks.length) return 0;
  var sum = 0;
  tasks.forEach(function(t){ sum += taskPct(t); });
  return Math.round(sum / tasks.length);
}
function countCols(tasks){
  var today = pfCache.today, c = { backlog:0, doing:0, done:0, overdue:0 };
  tasks.forEach(function(t){
    if(t.boardColumn === "doing") c.doing++;
    else if(isDone(t)) c.done++;
    else c.backlog++;
    if(!isDone(t) && t.dueDate && t.dueDate < today) c.overdue++;
  });
  return c;
}
function maxDue(tasks){
  var best = null;
  tasks.forEach(function(t){
    if(t.dueDate && (!best || String(t.dueDate) > String(best))) best = t.dueDate;
  });
  return best;
}
function sumMinutes(tasks, key){
  var n = 0;
  tasks.forEach(function(t){ n += Number(t[key]) || 0; });
  return n;
}
function nums4(c){
  return '<td class="num">' + c.backlog + '</td><td class="num">' + c.doing + '</td><td class="num">' + c.done + '</td>'
    + '<td class="num"' + (c.overdue ? ' style="color:var(--danger-fg)"' : "") + '>' + c.overdue + '</td>';
}
function caretBtn(key, open, label){
  return '<button class="manager-drill-caret' + (open ? " open" : "") + '" type="button" data-drill-toggle="' + esc(key)
    + '" aria-label="' + esc(label) + '" aria-expanded="' + open + '">' + icon("chevronRight", 12) + '</button>';
}
function caretPlaceholder(){
  return '<span class="manager-drill-caret" style="visibility:hidden" aria-hidden="true">' + icon("chevronRight", 12) + '</span>';
}
function drillName(level, inner){
  return '<td class="drill-name"><span class="manager-drill-indent" style="width:' + (level * 20) + 'px"></span>' + inner + '</td>';
}
function emptyCols(n){
  var s = "";
  for(var i = 0; i < n; i++) s += '<td></td>';
  return s;
}
function drillTaskRow(t){
  return '<tr data-open-task="' + esc(t.id) + '" tabindex="0" title="打开工作项详情">'
    + drillName(2, '<div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</div>')
    + '<td>' + esc(taskStatusName(t)) + '</td>'
    + '<td class="num">' + taskPct(t) + '%</td>'
    + emptyCols(4)
    + '<td><span class="manager-person">' + avatarHTML(t.owner || "未", "sm") + esc(t.owner || "未指派") + '</span></td>'
    + '<td class="num">' + esc(fmtDate(t.dueDate)) + '</td>'
    + '<td class="num drill-cost">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
    + '<td class="num drill-cost">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td></tr>';
}
function drillGroupRow(level, key, open, badge, title, kids, openAttr){
  var c = countCols(kids);
  var head = (kids.length ? caretBtn(key, open, "展开") : caretPlaceholder())
    + (badge || "")
    + (openAttr
      ? '<button class="manager-drill-link" type="button" data-drill-open="' + esc(openAttr) + '" title="查看工作项明细">' + esc(title) + '</button>'
      : '<span class="manager-drill-title">' + esc(title) + '</span>')
    + '<span class="manager-drill-count">' + c.done + ' / ' + kids.length + ' 完成</span>';
  return '<tr class="drill-group">'
    + drillName(level, head)
    + '<td><span class="tag ghost">' + (!kids.length ? "—" : (c.done === kids.length ? "已完成" : "进行中")) + '</span></td>'
    + '<td class="num">' + miniBar(avgPct(kids)) + '</td>'
    + nums4(c)
    + '<td></td>'
    + '<td class="num">' + esc(fmtDate(maxDue(kids))) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(sumMinutes(kids, "estimateMinutes")) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(sumMinutes(kids, "totalMinutes")) + '</td></tr>'
    + (open ? kids.map(drillTaskRow).join("") : "");
}
function drillProjectRow(p){
  var key = "p:" + p.reqId, open = !!expanded[key];
  var epics = epicTasks(p.reqId), un = ungroupedOf(p.reqId);
  var healthName = p.health === "green" ? "正常" : "需关注";
  var name = caretBtn(key, open, "展开项目")
    + '<i class="manager-light ' + esc(p.health) + '" title="' + healthName + '" aria-label="' + healthName + '"></i>'
    + '<button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button>';
  var rows = '<tr class="drill-project">'
    + drillName(0, name)
    + '<td><span class="tag ghost">' + esc(statusName(p.status)) + '</span></td>'
    + '<td class="num">' + miniBar(p.progressPct) + '</td>'
    + '<td class="num">' + (p.backlog || 0) + '</td><td class="num">' + (p.doing || 0) + '</td><td class="num">' + (p.done || 0) + '</td>'
    + '<td class="num"' + (p.overdue ? ' style="color:var(--danger-fg)"' : "") + '>' + (p.overdue || 0) + '</td>'
    + '<td><span class="manager-avatars">' + (p.members || []).slice(0, 4).map(function(n){ return avatarHTML(n, "sm"); }).join("") + '</span></td>'
    + '<td class="num">' + esc(fmtDate(maxDue(plainTasks(p.reqId)))) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(p.estimateMinutes) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(p.actualMinutes) + '</td></tr>';
  if(open){
    if(epics.length || un.length){
      rows += epics.map(function(ep){
        var ek = "e:" + ep.id;
        return drillGroupRow(1, ek, !!expanded[ek], '<i class="tag tag-plum">史诗</i>', ep.title, childrenOf(ep.id), ek);
      }).join("");
      if(un.length) rows += drillGroupRow(1, "g:" + p.reqId, !!expanded["g:" + p.reqId], "", "未归入史诗", un, "g:" + p.reqId);
    }else{
      rows += '<tr class="drill-empty"><td colspan="11" class="manager-empty-cell">该项目还没有工作项</td></tr>';
    }
  }
  return rows;
}
function sortedProjects(){
  var list = ((pfCache && pfCache.projects) || []).slice();
  if(drillOnlyRisk) list = list.filter(function(p){ return p.health !== "green"; });
  if(drillSort === "overdue") list.sort(function(a, b){
    return (b.overdue || 0) - (a.overdue || 0) || (a.progressPct || 0) - (b.progressPct || 0);
  });
  if(drillSort === "progress") list.sort(function(a, b){ return (a.progressPct || 0) - (b.progressPct || 0); });
  return list;
}
function drillControls(){
  function opt(v, label){
    return '<option value="' + v + '"' + (drillSort === v ? " selected" : "") + '>' + label + '</option>';
  }
  return '<select id="drillSort" class="mini-select" aria-label="项目排序">'
    + opt("default", "默认排序") + opt("overdue", "逾期优先") + opt("progress", "进度最低") + '</select>'
    + '<button class="btn sm" type="button" data-drill-risk aria-pressed="' + drillOnlyRisk + '">只看需关注</button>'
    + '<button class="btn sm" type="button" data-drill-expand>全部展开</button>'
    + '<button class="btn sm" type="button" data-drill-collapse>全部收起</button>'
    + '<button class="btn sm" type="button" data-drill-export>导出</button>';
}
function renderDrill(){
  var projects = sortedProjects();
  if(!drillInitialized && projects.length){
    drillInitialized = true;
    var first = projects[0];
    if(epicTasks(first.reqId).length || ungroupedOf(first.reqId).length) expanded["p:" + first.reqId] = true;
  }
  var head = '<tr><th>名称</th><th>状态</th><th class="num">进度</th><th class="num">待处理</th><th class="num">进行中</th>'
    + '<th class="num">已完成</th><th class="num">逾期</th><th>负责人</th><th class="num">截止</th>'
    + '<th class="num drill-cost">预估</th><th class="num drill-cost">实际</th></tr>';
  var body;
  if(projects.length){
    body = '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl manager-drill-tbl"><thead>' + head + '</thead><tbody>'
      + projects.map(drillProjectRow).join("") + '</tbody></table></div></section>';
  }else if(pfCache && (pfCache.projects || []).length){
    body = '<section class="manager-panel"><div class="manager-empty-cell">没有需要关注的项目</div></section>';
  }else{
    body = UI.emptyState({icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目。"});
  }
  $("projectBody").innerHTML = '<div class="manager-toolbar"><div><b>项目全局透视</b><span>逐层展开史诗与工作项</span></div>'
    + '<div class="toolbar-right">' + drillControls() + modeSeg() + fullscreenButtonHTML() + '</div></div>'
    + caliberHTML('进度 = Σ工作项完成度 ÷ 工作项数（与单项目驾驶舱同口径）；项目行统计该项目全部工作项（含史诗本身），史诗行只统计其子工作项，因此子行数字相加不等于项目行。项目名进入项目驾驶舱，史诗名称查看子工作项明细，工作项行打开详情。')
    + body;
}
function expandAllDrill(){
  ((pfCache && pfCache.projects) || []).forEach(function(p){
    var epics = epicTasks(p.reqId), un = ungroupedOf(p.reqId);
    if(epics.length || un.length) expanded["p:" + p.reqId] = true;
    epics.forEach(function(ep){ expanded["e:" + ep.id] = true; });
    if(un.length) expanded["g:" + p.reqId] = true;
  });
  renderDrill();
}
function collapseAllDrill(){
  expanded = {};
  renderDrill();
}
function hoursNum(minutes){
  return (Math.round((Number(minutes) || 0) / 60 * 10) / 10).toFixed(1);
}
function exportDrill(){
  if(!pfCache) return;
  var rows = [["项目透视", pfCache.today], [],
    ["层级","名称","所属项目","状态","健康度","进度","待处理","进行中","已完成","逾期","负责人","截止","预估(小时)","实际(小时)"]];
  function taskRow(p, t){
    rows.push(["工作项", t.title, p.name, taskStatusName(t), "", taskPct(t) + "%", "", "", "", "",
      t.owner || "未指派", fmtDate(t.dueDate), hoursNum(t.estimateMinutes), hoursNum(t.totalMinutes)]);
  }
  function groupRow(p, name, kids){
    var c = countCols(kids);
    rows.push(["史诗", name, p.name, "", "", avgPct(kids) + "%", c.backlog, c.doing, c.done, c.overdue, "",
      fmtDate(maxDue(kids)), hoursNum(sumMinutes(kids, "estimateMinutes")), hoursNum(sumMinutes(kids, "totalMinutes"))]);
    kids.forEach(function(t){ taskRow(p, t); });
  }
  (pfCache.projects || []).forEach(function(p){
    rows.push(["项目", p.name, p.name, statusName(p.status), p.health === "green" ? "正常" : "需关注",
      (p.progressPct || 0) + "%", p.backlog || 0, p.doing || 0, p.done || 0, p.overdue || 0,
      (p.members || []).join("、"), fmtDate(maxDue(plainTasks(p.reqId))),
      hoursNum(p.estimateMinutes), hoursNum(p.actualMinutes)]);
    epicTasks(p.reqId).forEach(function(ep){ groupRow(p, ep.title, childrenOf(ep.id)); });
    var un = ungroupedOf(p.reqId);
    if(un.length) groupRow(p, "未归入史诗", un);
  });
  downloadCsv("项目透视-" + pfCache.today + ".csv", rows);
  toast("已导出项目透视", "fs");
}
function metricTasks(kind){
  var rows = cache.tasks || [];
  if(kind === "backlog") return rows.filter(function(t){ return t.boardColumn !== "done" && t.boardColumn !== "doing"; });
  if(kind === "doing") return rows.filter(function(t){ return t.boardColumn === "doing"; });
  if(kind === "done") return rows.filter(function(t){ return t.boardColumn === "done"; });
  if(kind === "overdue") return rows.filter(function(t){ return t.boardColumn !== "done" && t.dueDate && t.dueDate < cache.today; });
  if(kind === "blocked") return rows.filter(function(t){ return t.boardColumn !== "done" && t.blocked; });
  if(kind === "estimate") return rows.filter(function(t){ return t.estimateMinutes > 0; });
  if(kind === "actual") return rows.filter(function(t){ return t.totalMinutes > 0; });
  if(kind === "variance") return rows.filter(function(t){ return t.boardColumn === "done" && t.estimateMinutes > 0; });
  return rows;
}
function onClick(e){
  if(e.target.closest("#btnProjectBack")){
    window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"projects" } }));
    return;
  }
  if(e.target.closest("[data-empty-action]")){ loadProject(); return; }
  var tabBtn = e.target.closest("[data-project-tab]");
  if(tabBtn){ setProjectTab(tabBtn.dataset.projectTab); return; }
  var pvMode = e.target.closest("[data-pv-mode]");
  if(pvMode){
    var m = pvMode.dataset.pvMode;
    if(m === currentMode()) return;
    effectiveMode = m;
    renderAfterModeSwitch();
    listPrefs.setViewMode(VIEW_KEY, m).catch(function(ex){ toast(ex.message || "偏好保存失败", "bad"); });
    return;
  }
  if(pfCache){
    var toggle = e.target.closest("[data-drill-toggle]");
    if(toggle){
      var key = toggle.dataset.drillToggle;
      expanded[key] = !expanded[key];
      renderDrill();
      return;
    }
    if(e.target.closest("[data-drill-risk]")){
      drillOnlyRisk = !drillOnlyRisk;
      renderDrill();
      return;
    }
    if(e.target.closest("[data-drill-expand]")){ expandAllDrill(); return; }
    if(e.target.closest("[data-drill-collapse]")){ collapseAllDrill(); return; }
    if(e.target.closest("[data-drill-export]")){ exportDrill(); return; }
    var epicOpen = e.target.closest("[data-drill-open]");
    if(epicOpen){
      var ok = epicOpen.dataset.drillOpen, reqId = ok.substring(2);
      var proj = ((pfCache.projects) || []).filter(function(x){ return x.reqId === reqId; })[0];
      var prefix = proj ? proj.name + " · " : "";
      if(ok.charAt(0) === "e"){
        var ep = drillTasks().filter(function(t){ return t.id === reqId; })[0];
        openTaskTable(prefix + (ep ? ep.title : "史诗") + " · 子项", childrenOf(reqId));
      }else{
        openTaskTable(prefix + "未归入史诗", ungroupedOf(reqId));
      }
      return;
    }
    var open = e.target.closest("[data-open-project]");
    if(open){
      effectiveMode = "board";
      rt.managerProjectId = open.dataset.openProject;
      loadProject();
      return;
    }
    var task = e.target.closest("[data-open-task]");
    if(task){ openTaskById(task.dataset.openTask); return; }
  }
  var metricBtn = e.target.closest("[data-project-metric]");
  if(metricBtn){
    var kind = metricBtn.dataset.projectMetric;
    var names = {all:"全部工作项",backlog:"待处理",doing:"进行中",done:"已完成",overdue:"逾期",blocked:"被阻塞",estimate:"有预估的工作项",actual:"有实际工时的工作项",variance:"已完成工作项工时偏差"};
    openTaskTable((cache.project.name || "项目") + " · " + names[kind], metricTasks(kind)); return;
  }
  var epic = e.target.closest("[data-epic]");
  if(epic){
    var id = epic.dataset.epic;
    var ep = (cache.epics || []).filter(function(x){ return x.id === id; })[0];
    openTaskTable((ep ? ep.title : "史诗") + " · 子项", (cache.tasks || []).filter(function(t){ return t.epicId === id; })); return;
  }
  var member = e.target.closest("[data-member-key]");
  if(member){
    var key = member.dataset.memberKey;
    var rows = (cache.tasks || []).filter(function(t){ return t.boardColumn !== "done" && (t.ownerUserId || t.owner || "unassigned") === key; });
    openTaskTable("成员项目工作项", rows);
  }
}
function renderAfterModeSwitch(){
  if(currentMode() === "drill") loadDrill();
  else loadProject();
}
function onChange(e){
  if(e.target.id === "managerProjectSelect"){ rt.managerProjectId = e.target.value; loadProject(); }
  if(e.target.id === "drillSort"){ drillSort = e.target.value; renderDrill(); }
}
/* 透视树行键盘可达：聚焦任务行后 Enter/空格打开详情 */
function onKeydown(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var row = e.target.closest ? e.target.closest("tr[data-open-task]") : null;
  if(row && row === e.target){ e.preventDefault(); openTaskById(row.dataset.openTask); }
}
if($("projectBody")){
  $("projectBody").addEventListener("click", onClick);
  $("projectBody").addEventListener("change", onChange);
  $("projectBody").addEventListener("keydown", onKeydown);
}

export { enterProjectView, loadProject };
