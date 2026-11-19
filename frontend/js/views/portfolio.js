/* views/portfolio · 项目总览（跨项目汇总，点项目名下钻项目看板） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import * as listPrefs from "../core/list-preferences.js";
import { showView } from "../core/router.js";
import { dueState, dueText, rt, setNameById, setSortOf, statusBucket } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtShortMD, parseDate } from "../lib/format.js";
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
function shiftDays(iso, days){
  var parts = String(iso || "").substring(0, 10).split("-").map(Number);
  var d = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
  d.setDate(d.getDate() + days);
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
function kpi(label, value, foot, kind, cls, delta){
  return '<button class="manager-kpi ' + (cls || "") + '" type="button" data-kpi="' + kind + '">'
    + '<span>' + esc(label) + '</span>'
    + '<span class="manager-kpi-main"><b>' + value + '</b>' + (delta || "") + '</span>'
    + '<small>' + esc(foot) + '</small></button>';
}
/* 借卡片式报表的写法：数字旁边给一个「较上周」的方向，避免只看孤立数字看不出变好还是变差 */
function completedBetween(fromIso, beforeIso){
  var n = 0;
  (cache.tasks || []).forEach(function(t){
    if(t.boardColumn !== "done" || !t.completedAt) return;
    var day = String(t.completedAt).substring(0, 10);
    if(day >= fromIso && day < beforeIso) n++;
  });
  return n;
}
function kpiDelta(cur, prev){
  var diff = cur - prev;
  if(!diff) return '<span class="manager-kpi-delta flat">与上周持平</span>';
  var up = diff > 0;
  return '<span class="manager-kpi-delta ' + (up ? "up" : "down") + '" title="上周完成 ' + prev + ' 项">'
    + (up ? "↑ +" : "↓ −") + Math.abs(diff) + '</span>';
}
/* 跨项目汇总按项目集归组：与项目列表同一层级，未分组固定最后 */
function groupedBySet(projects){
  if(!projects.some(function(p){ return p.setId; })) return null;
  var buckets = {}, keys = [];
  projects.forEach(function(p){
    var k = p.setId || "";
    if(!buckets[k]){ buckets[k] = []; keys.push(k); }
    buckets[k].push(p);
  });
  keys.sort(function(a, b){
    if(!a) return 1;
    if(!b) return -1;
    return setSortOf(a) - setSortOf(b) || String(setNameById(a)).localeCompare(String(setNameById(b)), "zh-CN");
  });
  return keys.map(function(k){ return { key:k, name:k ? (setNameById(k) || "项目集") : "未分组", rows:buckets[k] }; });
}
function setObjById(id){
  if(!id) return null;
  var sets = rt.projectSets || [];
  for(var i = 0; i < sets.length; i++) if(sets[i].id === id) return sets[i];
  return null;
}
function setGroupSummary(rows){
  var total = 0, done = 0, overdue = 0, weighted = 0, attention = 0;
  rows.forEach(function(p){
    var t = Number(p.total) || 0;
    total += t;
    done += Number(p.done) || 0;
    overdue += Number(p.overdue) || 0;
    weighted += (Number(p.progressPct) || 0) * t;
    if(p.health && p.health !== "green") attention++;
  });
  return { total:total, done:done, overdue:overdue, attention:attention, pct: total ? Math.round(weighted / total) : 0 };
}
/* 卡片视图的集分组头：与项目列表同款集头，身份色只投到文件夹图标；
   汇总按工作项数加权，逾期 / 需关注一眼可见，不用逐张卡去数 */
function setGroupHeadHTML(group){
  var set = setObjById(group.key);
  var agg = setGroupSummary(group.rows);
  var color = set && /^#[0-9a-f]{6}$/i.test(String(set.color || "")) ? String(set.color) : "";
  return '<div class="req-set-head proj-set-head pf-set-group' + (group.key ? "" : " is-ungrouped") + '"' + (color ? ' style="--set:' + color + '"' : "") + '>'
    + '<span class="req-set-title"><span class="req-set-ico" aria-hidden="true">' + icon("folder", 14) + '</span><b>' + esc(group.name) + '</b></span>'
    + '<span class="req-set-meta">' + group.rows.length + ' 个项目 · ' + agg.total + ' 工作项 · ' + agg.done + ' 完成</span>'
    + (agg.overdue ? '<span class="risk-chip overdue">逾期 ' + agg.overdue + '</span>' : "")
    + (agg.attention ? '<span class="tag tag-warning">' + agg.attention + ' 需关注</span>' : "")
    + '<span class="progress mini req-set-progress" title="集内项目按工作项数加权的完成度"><span class="bar"><i style="width:' + agg.pct + '%"></i></span><span class="pv">' + agg.pct + '%</span></span>'
    + '</div>';
}
/* 项目卡固定一行「下一步」：谁、做什么、何时到期。
   借用卡片式报表的固定槽位——每张卡都直接回答同一个问题，不用逐个项目点进去找。 */
function nextStepFor(reqId){
  var best = null, bestDue = "";
  (cache.tasks || []).forEach(function(t){
    if(t.reqId !== reqId || t.boardColumn === "done" || t.boardColumn === "canceled") return;
    var due = t.dueDate ? String(t.dueDate).substring(0, 10) : "";
    if(!best){ best = t; bestDue = due; return; }
    if(due && (!bestDue || due < bestDue)){ best = t; bestDue = due; return; }
    if(!due && !bestDue && t.boardColumn === "doing" && best.boardColumn !== "doing"){ best = t; bestDue = due; }
  });
  return best;
}
function nextStepHTML(p){
  var t = nextStepFor(p.reqId);
  if(!t){
    return '<div class="manager-project-next"><span class="next-lab">下一步</span>'
      + '<span class="next-empty">暂无未完成工作项</span></div>';
  }
  var s = dueState(t);
  var dueCls = s.kind === "over" ? "over" : (s.kind === "today" || s.kind === "soon" ? "warn" : "mute");
  var dueHTML = t.dueDate
    ? '<span class="mini-tag ' + dueCls + '" title="' + esc(dueText(t)) + '">' + esc(fmtShortMD(parseDate(t.dueDate))) + '</span>'
    : '<span class="mini-tag mute">未排期</span>';
  return '<div class="manager-project-next">'
    + '<span class="next-lab">下一步</span>'
    + '<button class="next-title" type="button" data-open-task="' + esc(t.id) + '" title="打开工作项：' + esc(t.title) + '">' + esc(t.title) + '</button>'
    + (t.blocked ? '<span class="mini-tag warn" title="' + esc(t.blockedReason || "被阻塞") + '">阻塞</span>' : "")
    + '<span class="next-owner" title="负责人：' + esc(t.owner || "未指派") + '">' + avatarHTML(t.owner || "—", "sm") + dueHTML + '</span></div>';
}
function projectCard(p, grouped){
  var healthName = p.health === "green" ? "正常" : "需关注";
  var tagCls = p.health === "green" ? "tag-success" : (p.health === "red" ? "tag-danger" : "tag-warning");
  var people = (p.members || []).slice(0, 4).map(function(name){ return avatarHTML(name, "sm"); }).join("");
  var foot = p.overloadedMembers ? '<span class="tag tag-warning">' + p.overloadedMembers + ' 人超载</span>'
    : (p.stagnantDays >= 7 ? '<span class="manager-stale">连续 ' + p.stagnantDays + ' 天无完成</span>'
      : '<span class="manager-stale">本周完成 ' + p.weekCompleted + ' 项 · 工时 ' + fmtHours(p.weekWorkMinutes) + '</span>');
  return '<article class="manager-project-card">'
    + '<div class="manager-project-head"><i class="manager-light ' + esc(p.health) + '"></i>'
    + '<button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '">' + esc(p.name) + '</button>'
    + (!grouped && p.setId ? '<span class="tag tag-ghost" title="所属项目集">' + esc(setNameById(p.setId) || "项目集") + '</span>' : '')
    + '<span class="tag ' + tagCls + '">' + healthName + '</span></div>'
    + '<div class="manager-project-main"><button type="button" class="manager-ring ' + esc(p.health) + '" style="--p:' + p.progressPct + '" data-project-drill="' + esc(p.reqId) + '" data-metric="all" title="查看该项目全部工作项" aria-label="' + esc(p.name) + ' 完成率 ' + p.progressPct + '%，查看工作项明细"><b>' + p.progressPct + '%</b></button>'
    + '<div class="manager-project-stats">'
    + [["backlog","待处理",p.backlog],["doing","进行中",p.doing]].concat(p.ended ? [["ended","执行结束",p.ended]] : [], [["done","已完成",p.done],["overdue","逾期",p.overdue]]).map(function(x){
      return '<button type="button" class="' + (x[0] === "overdue" && x[2] ? "over" : "") + '" data-project-drill="' + esc(p.reqId) + '" data-metric="' + x[0] + '"><span>' + x[1] + '</span><b>' + x[2] + '</b></button>';
    }).join("") + '</div></div>'
    + nextStepHTML(p)
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
  var groups = groupedBySet(projects);
  var body = groups
    ? groups.map(function(g){
        return '<tr class="pf-set-row"><td colspan="' + cols.length + '">' + esc(g.name) + ' · ' + g.rows.length + ' 个项目</td></tr>'
          + g.rows.map(function(p){ return '<tr>' + cols.map(function(key){ return pfCell(p, key); }).join("") + '</tr>'; }).join("");
      }).join("")
    : projects.map(function(p){
        return '<tr>' + cols.map(function(key){ return pfCell(p, key); }).join("") + '</tr>';
      }).join("");
  return '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + cols.map(function(key){ return '<th' + (["total","backlog","doing","done","overdue","blocked","progress","weekCompleted","weekWorkMinutes"].indexOf(key) !== -1 ? ' class="num"' : "") + '>' + esc(labels[key]) + '</th>'; }).join("")
    + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
}
function renderPortfolio(){
  var k = cache.kpis || {}, projects = cache.projects || [];
  var active = projects.filter(function(p){ return p.status === "active"; }).length;
  /* 上周完成：快照里带全部在册工作项的完成时间，前端按同一个自然周口径回算即可 */
  var weekStart = mondayIso(cache.today);
  var lastWeekDone = completedBetween(shiftDays(weekStart, -7), weekStart);
  var mode = listPrefs.viewMode("portfolio");
  var seg = '<div class="seg mini">'
    + '<button type="button" data-pf-mode="card" aria-pressed="' + (mode === "card") + '">卡片</button>'
    + '<button type="button" data-pf-mode="table" aria-pressed="' + (mode === "table") + '">列表</button>'
    + '</div>'
    + '<button class="btn sm" type="button" id="btnPortfolioColumns"' + (mode === "table" ? "" : " hidden") + '>显示字段</button>';
  $("portfolioBody").innerHTML = '<div class="manager-toolbar"><div><b>全局健康度</b></div>'
    + '<div class="toolbar-right">' + seg + fullscreenButtonHTML()
    + '<button class="btn sm" type="button" data-portfolio-export>导出周报</button></div></div>'
    + caliberHTML('进度 = Σ工作项完成度 ÷ 工作项数；红灯 = 逾期占比 &gt;10% 且连续 7 天无完成，橙灯 = 有逾期或成员超载。分布按看板列的处理规则归类：待处理含「等待接续」列，进行中含「正常处理」的自定义列，「执行结束」列单独计数、不计未完成。统计范围含已归档项目（归档只是收起，数据与统计保留），不含你无权查看的项目；「本周」按自然周（周一起）计算。')
    + '<div class="manager-kpis">'
    + kpi("进行中项目", active + '<small> / ' + projects.length + '</small>', "共 " + projects.length + " 个项目", "projects")
    + kpi("逾期工作项", k.overdueTasks || 0, "未完成工作项", "overdue", k.overdueTasks ? "danger" : "")
    + kpi("本周完成", k.weekCompleted || 0, "按完成时间归周", "weekDone", "", kpiDelta(k.weekCompleted || 0, lastWeekDone))
    + kpi("本周团队工时", fmtHours(k.weekWorkMinutes), "自动计时汇总", "hours") + '</div>'
    + (mode === "table"
      ? (projects.length ? projectTable(projects) : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"}))
      : '<div class="manager-legend"><span><i class="manager-light green"></i>正常</span><span><i class="manager-light orange"></i>有逾期或超载</span><span><i class="manager-light red"></i>逾期与停滞叠加</span></div>'
        + (projects.length ? cardAreaHTML(projects) : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"})));
}
/* 卡片视图按项目集分块：集头汇总 + 集内项目网格；没有项目集时保持原来的平铺 */
function cardAreaHTML(projects){
  var groups = groupedBySet(projects);
  if(!groups) return '<div class="manager-project-grid" id="portfolioProjects">' + projects.map(function(p){ return projectCard(p, false); }).join("") + '</div>';
  return '<div class="pf-set-groups">' + groups.map(function(g){
    return '<section class="pf-set-block">' + setGroupHeadHTML(g)
      + '<div class="manager-project-grid">' + g.rows.map(function(p){ return projectCard(p, true); }).join("") + '</div></section>';
  }).join("") + '</div>';
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
    + '<h2>进行中项目 · ' + projects.length + '</h2></div>'
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
  var step = e.target.closest("[data-open-task]");
  if(step){ openTaskById(step.dataset.openTask); return; }
  var open = e.target.closest("[data-open-project]");
  if(open){ rt.managerProjectId = open.dataset.openProject; showView("project"); return; }
  var drill = e.target.closest("[data-project-drill]");
  if(drill){
    var p = (cache.projects || []).filter(function(x){ return x.reqId === drill.dataset.projectDrill; })[0];
    var metric = drill.dataset.metric;
    var names = {all:"全部工作项",backlog:"待处理",doing:"进行中",ended:"执行结束",done:"已完成",overdue:"逾期"};
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
/* 项目集与项目列表并行加载：若本页先渲染，集名 / 身份色取不到，等列表落地后再补一次 */
window.addEventListener("ds:reqs-loaded", function(){
  if(document.body.dataset.view !== "portfolio" || !cache) return;
  renderPortfolio();
});

export { enterPortfolioView, loadPortfolio };
