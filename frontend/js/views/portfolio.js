/* views/portfolio · 项目总览（跨项目汇总，点项目名下钻项目看板） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import * as listPrefs from "../core/list-preferences.js";
import { showView } from "../core/router.js";
import { dueState, roleReadOnly, rt, setNameById, setSortOf, statusBucket } from "../core/state.js";
import { loadView } from "../core/view-loader.js";
import { updateBrand } from "../core/filters.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtShortMD, parseDate } from "../lib/format.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { downloadCsv, fmtHours, openTaskTable } from "./manager-shared.js";
var cache = null, seq = 0;
var pfSetId = "";   /* ""=全部项目；否则只看一个项目集，作为项目集详情页 */
function enterPortfolioView(){ pfSetId = ""; syncPortfolioPageHead(0, 0); listPrefs.load("portfolio").then(function(){ loadPortfolio(); }); }
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
function reqById(reqId){
  for(var i = 0; i < (rt.reqList || []).length; i++) if(rt.reqList[i].id === reqId) return rt.reqList[i];
  return null;
}
/* 旧构建的 portfolio 接口不带 setId，项目列表已带；缺字段时用列表补齐 */
function pfProjects(){
  return ((cache && cache.projects) || []).map(function(p){
    if(p.setId !== undefined) return p;
    var r = reqById(p.reqId);
    return r ? Object.assign({}, p, { setId: r.setId || null }) : p;
  });
}
function pfSetProjects(){
  var all = pfProjects();
  return pfSetId ? all.filter(function(p){ return p.setId === pfSetId; }) : all;
}
function pfProjectIds(){
  var map = {};
  pfSetProjects().forEach(function(p){ map[p.reqId] = 1; });
  return map;
}
function tasksFor(reqId, metric){
  var ids = pfSetId ? pfProjectIds() : null;
  var rows = (cache.tasks || []).filter(function(t){
    if(reqId) return t.reqId === reqId;
    return !ids || ids[t.reqId];
  });
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
  var n = 0, ids = pfSetId ? pfProjectIds() : null;
  (cache.tasks || []).forEach(function(t){
    if(ids && !ids[t.reqId]) return;
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
  /* 箭头已表方向，不再叠加正负号；补「项」避免 5 与 36 被读成同一个数 */
  return '<span class="manager-kpi-delta ' + (up ? "up" : "down") + '" title="上周完成 ' + prev + ' 项">'
    + (up ? "↑ " : "↓ ") + Math.abs(diff) + ' 项</span>';
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
/* 项目负责人取项目列表里的负责人；portfolio 接口不带该字段，列表未加载时先留空 */
function pfOwnerName(p){
  var r = reqById(p.reqId);
  if(!r || !r.ownerUserId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === r.ownerUserId; })[0];
  return hit ? (hit.displayName || hit.username || "") : (r.ownerName || "");
}
/* 页头口径：逾期与停滞叠加算风险；无工作项的项目不画 0% 环 */
function projectCard(p, grouped){
  var owner = pfOwnerName(p);
  var empty = !Number(p.total);
  var displayName = p.status === "done" ? "已交付" : (p.status === "hold" ? "已搁置" : (empty ? "未开始" : ""));
  var healthName = empty ? (displayName || "未开始") : (p.health === "green" ? "正常" : (p.health === "red" ? "风险" : "需关注"));
  var tagCls = empty ? "ghost" : (p.health === "green" ? "tag-success" : (p.health === "red" ? "tag-danger" : "tag-warning"));
  var alerts = p.status === "done"
    ? '<div class="pf-card-alerts"><span>已交付</span><span>负载 0</span></div>'
    : '<div class="pf-card-alerts">'
      + (p.overdue ? '<b class="over">' + p.overdue + ' 逾期</b>' : '<span>无逾期</span>')
      + (p.overloadedMembers ? '<span>' + p.overloadedMembers + ' 人超载</span>'
        : (p.stagnantDays >= 7 && p.health !== "green" ? '<span>停滞 ' + p.stagnantDays + ' 天</span>' : '<span>负载正常</span>'))
      + '</div>';
  /* 环色按原型：常规与「需关注」都用主色，健康度转红（逾期与停滞叠加）才转橙，已交付用绿色 */
  var ringTone = (p.status === "done" || Number(p.progressPct) >= 100) ? "done"
    : (p.health === "red" ? "warn" : "normal");
  var main = empty
    ? '<div class="manager-project-main pf-card-main is-empty"><span class="pf-empty-ring" aria-hidden="true">' + icon("plus", 16) + '</span>'
      + '<div class="pf-card-cap"><b>暂无工作项</b><span>建工作项后显示完成度</span></div></div>'
    : '<div class="manager-project-main pf-card-main">'
      + '<button type="button" class="manager-ring ' + ringTone + '" style="--p:' + p.progressPct + '" data-project-drill="' + esc(p.reqId) + '" data-metric="all" title="查看该项目全部工作项" aria-label="' + esc(p.name) + ' 完成率 ' + p.progressPct + '%，查看工作项明细"></button>'
      + '<div class="pf-card-cap"><b>' + p.progressPct + '%</b><span>整体完成</span></div>'
      + alerts + '</div>';
  var stats = empty ? ""
    : '<div class="pf-card-stats">'
      + [["doing","进行中",p.doing],["backlog","待处理",p.backlog],["blocked","阻塞",p.blocked],["done","完成",p.done]].map(function(x){
        return '<button type="button" data-project-drill="' + esc(p.reqId) + '" data-metric="' + x[0] + '" title="查看' + x[1] + '工作项">' + esc(x[1]) + ' ' + (Number(x[2]) || 0) + '</button>';
      }).join("") + '</div>';
  return '<article class="manager-project-card pf-card' + (empty ? " is-empty" : "") + '">'
    + '<div class="manager-project-head">'
    + '<button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '">' + esc(p.name) + '</button>'
    + '<span class="tag ' + tagCls + '">' + esc(healthName) + '</span>'
    + (!grouped && p.setId ? '<span class="tag ghost" title="所属项目集">' + esc(setNameById(p.setId) || "项目集") + '</span>' : '')
    + (owner ? '<span class="pf-card-owner" title="项目负责人">' + esc(owner) + '</span>' : '') + '</div>'
    + main + stats + '</article>';
}
function statusName(st){
  return { active:"进行中", done:"已交付", hold:"已搁置" }[st] || st || "—";
}
/* 健康度徽标：0 工作项不算「正常」，已搁置不与健康度混排，避免把无人推进的项目当健康 */
function projectHealthMeta(p){
  if(!Number(p.total)){
    return { name: p.status === "hold" ? "已搁置" : (p.status === "done" ? "已交付" : "无工作项"), cls: "ghost" };
  }
  if(p.status === "hold") return { name: "已搁置", cls: "ghost" };
  if(p.health === "green") return { name: "正常", cls: "tag-success" };
  if(p.health === "red") return { name: "风险", cls: "tag-danger" };
  return { name: "需关注", cls: "tag-warning" };
}
function pfCell(p, key){
  if(key === "name"){
    return '<td><button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button></td>';
  }
  if(key === "status") return '<td><span class="tag ghost">' + esc(statusName(p.status)) + '</span></td>';
  if(key === "health"){
    var hMeta = projectHealthMeta(p);
    return '<td><span class="tag ' + hMeta.cls + '">' + esc(hMeta.name) + '</span></td>';
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
  var groups = pfSetId ? null : groupedBySet(projects);
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
/* 页头范围：默认看全部项目集；选中某个集后按集重算 KPI 与项目列表，等同于集详情页 */
function pfSetOptions(){
  var opts = '<option value="">全部项目集</option>';
  (rt.projectSets || []).slice().sort(function(a, b){ return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); }).forEach(function(s){
    opts += '<option value="' + esc(s.id) + '"' + (s.id === pfSetId ? " selected" : "") + '>' + esc(s.name) + '</option>';
  });
  return opts;
}
function scopedTasks(){
  if(!pfSetId) return (cache.tasks || []);
  var ids = pfProjectIds();
  return (cache.tasks || []).filter(function(t){ return ids[t.reqId]; });
}
/* 页头与项目列表同一套位置：标题 + pill、范围副标题、右侧三个动作；
   选中集时标题就是集名，未选时为「项目集」总览 */
function syncPortfolioPageHead(projectCount, attention){
  var setName = pfSetId ? (setNameById(pfSetId) || "项目集") : "项目集";
  /* 面包屑第三段跟着当前集走；未选集时回到「全部项目集」 */
  rt.portfolioSetName = pfSetId ? setName : "";
  var t = $("pageTitleText");
  if(t) t.textContent = setName;
  var pill = $("pagePill");
  if(pill){
    pill.hidden = false;
    pill.textContent = pfSetId ? "项目集" : ((rt.projectSets || []).length + " 个集");
  }
  updateBrand();
  var sub = $("pageSub");
  if(sub && cache){
    sub.textContent = (projectCount ? projectCount + " 个项目 · " + (attention ? attention + " 处风险" : "全部正常") : "还没有项目")
      + " · 数据截至 " + fmtShortMD(parseDate(cache.today));
  }
  var acts = $("pageActions");
  if(acts){
    var html = (pfSetId ? '<button class="btn" type="button" data-pf-all>查看全部项目</button>' : "")
      + '<button class="btn" type="button" data-portfolio-export>导出周报</button>'
      + (roleReadOnly() ? '' : '<button class="btn primary" type="button" data-pf-new>新建项目</button>');
    if(acts.dataset.pfActs !== html){
      acts.dataset.pfActs = html;
      acts.innerHTML = html;
    }
    acts.hidden = false;
  }
  var nw = $("newWrap");
  if(nw) nw.hidden = true;
}
function renderPortfolio(){
  var projects = pfSetProjects();
  var tasks = scopedTasks();
  var active = projects.filter(function(p){ return p.status === "active"; }).length;
  var overdueN = tasks.filter(function(t){ return dueState(t).kind === "over"; }).length;
  var undone = tasks.filter(function(t){ return t.boardColumn !== "done" && t.boardColumn !== "canceled"; }).length;
  var weekDone = tasks.filter(function(t){
    return t.boardColumn === "done" && t.completedAt && String(t.completedAt).substring(0, 10) >= mondayIso(cache.today);
  }).length;
  var byTask = cache.weekWorkByTask || {}, weekMinutes = 0;
  tasks.forEach(function(t){ weekMinutes += Number(byTask[t.id]) || 0; });
  /* 上周完成：快照里带全部在册工作项的完成时间，前端按同一个自然周口径回算即可 */
  var weekStart = mondayIso(cache.today);
  var lastWeekDone = completedBetween(shiftDays(weekStart, -7), weekStart);
  var attention = projects.filter(function(p){ return p.health && p.health !== "green"; }).length;
  var mode = listPrefs.viewMode("portfolio");
  syncPortfolioPageHead(projects.length, attention);
  var seg = '<div class="seg mini">'
    + '<button type="button" data-pf-mode="card" aria-pressed="' + (mode === "card") + '">卡片</button>'
    + '<button type="button" data-pf-mode="table" aria-pressed="' + (mode === "table") + '">列表</button>'
    + '</div>'
    + '<button class="btn sm" type="button" id="btnPortfolioColumns"' + (mode === "table" ? "" : " hidden") + '>显示字段</button>';
  $("portfolioBody").innerHTML = '<div class="manager-kpis pf-kpis">'
    + kpi("进行中项目", active + '<small> / ' + projects.length + '</small>', !projects.length ? "还没有项目" : (projects.length - active ? "其余 " + (projects.length - active) + " 个未开始或已完成" : "全部进行中"), "projects")
    + kpi("逾期任务", overdueN, undone ? "未完成任务共 " + undone + " 项" + (undone === overdueN ? "，全部逾期" : "") : "没有未完成任务", "overdue", overdueN ? "danger" : "")
    + kpi("本周完成", weekDone, fmtShortMD(parseDate(weekStart)) + " → " + fmtShortMD(parseDate(shiftDays(weekStart, 6))), "weekDone", "", kpiDelta(weekDone, lastWeekDone))
    + kpi("团队工时", fmtHours(weekMinutes), "本周窗口内计时汇总", "hours") + '</div>'
    + '<div class="pf-viewbar"><select class="sel sm pf-scope" data-pf-set aria-label="选择项目集范围">' + pfSetOptions() + '</select>' + seg
    + (mode === "table" ? "" : '<div class="manager-legend"><span><i class="manager-light green"></i>正常</span><span><i class="manager-light orange"></i>有逾期或超载</span><span><i class="manager-light red"></i>逾期与停滞叠加</span></div>')
    + '<span class="pf-spacer" aria-hidden="true"></span>'
    + '<span class="pf-note">' + (mode === "table" ? "" : "风险按「逾期 / 停滞 / 超载」三项判定，文字与颜色同时给出") + '</span>'
    + fullscreenButtonHTML() + '</div>'
    + (mode === "table"
      ? (projects.length ? projectTable(projects) : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"}))
      : (projects.length ? cardAreaHTML(projects) : UI.emptyState({icon:"folder", title:"还没有项目", text:"先在空间里创建项目并归入工作项。"})));
}
/* 卡片视图按项目集分块：集头汇总 + 集内项目网格；选中单个集后不再套集头 */
function cardAreaHTML(projects){
  var groups = pfSetId ? null : groupedBySet(projects);
  if(!groups) return '<div class="manager-project-grid" id="portfolioProjects">' + projects.map(function(p){ return projectCard(p, !!pfSetId); }).join("") + '</div>';
  return '<div class="pf-set-groups">' + groups.map(function(g){
    return '<section class="pf-set-block">' + setGroupHeadHTML(g)
      + '<div class="manager-project-grid">' + g.rows.map(function(p){ return projectCard(p, true); }).join("") + '</div></section>';
  }).join("") + '</div>';
}
function exportPortfolio(){
  if(!cache) return;
  var projects = pfSetProjects();
  var setName = pfSetId ? (setNameById(pfSetId) || "项目集") : "全部项目";
  var rows = [["项目周报 · " + setName, cache.today], [], ["项目","状态","健康度","总工作项","待处理","进行中","执行结束","已完成","逾期","阻塞","完成率","本周完成","本周工时(分钟)","预估(分钟)","实际(分钟)","超载人数","连续无完成天数"]];
  projects.forEach(function(p){
    rows.push([p.name,p.status,p.health,p.total,p.backlog,p.doing,p.ended || 0,p.done,p.overdue,p.blocked,p.progressPct + "%",p.weekCompleted,p.weekWorkMinutes,p.estimateMinutes,p.actualMinutes,p.overloadedMembers,p.stagnantDays]);
  });
  downloadCsv("项目周报-" + setName + "-" + cache.today + ".csv", rows);
  toast("已导出项目周报", "fs");
}
/* KPI「进行中项目」下钻：列出进行中项目的进度与负载，点项目名进项目看板 */
function openActiveProjects(){
  var projects = pfSetProjects().filter(function(p){ return p.status === "active"; });
  var rows = projects.map(function(p){
    var hMeta = projectHealthMeta(p);
    return '<tr>'
      + '<td><button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button></td>'
      + '<td><span class="tag ' + hMeta.cls + '">' + esc(hMeta.name) + '</span></td>'
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
  if(e.target.closest("#btnPfNewProject")){
    /* 新建项目对话框挂在项目视图里：必须先切视图，只预加载模块会让弹窗留在隐藏容器内 */
    showView("projects").then(function(){ return loadView("projects"); }).then(function(m){ m.openProjectDialog(null); });
    return;
  }
  if(e.target.closest("[data-portfolio-export]")){ exportPortfolio(); return; }
  if(e.target.closest("[data-empty-action]")){ loadPortfolio(); return; }
  var open = e.target.closest("[data-open-project]");
  if(open){ rt.managerProjectId = open.dataset.openProject; showView("project"); return; }
  var drill = e.target.closest("[data-project-drill]");
  if(drill){
    var p = pfSetProjects().filter(function(x){ return x.reqId === drill.dataset.projectDrill; })[0];
    var metric = drill.dataset.metric;
    var names = {all:"全部工作项",backlog:"待处理",doing:"进行中",ended:"执行结束",done:"已完成",blocked:"被阻塞",overdue:"逾期"};
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
    var rows = scopedTasks().filter(function(t){ return byTask[t.id] > 0; }).map(function(t){
      var copy = Object.assign({}, t); copy.totalMinutes = byTask[t.id]; return copy;
    });
    var sumMin = rows.reduce(function(s, t){ return s + (Number(t.totalMinutes) || 0); }, 0);
    openTaskTable("本周团队工时", rows, "实际列显示本周计时 · 合计 " + fmtHours(sumMin));
  }else{
    openTaskTable(kind === "overdue" ? "全部逾期工作项" : "本周完成工作项", tasksFor(null, kind));
  }
}
if($("portfolioBody")) $("portfolioBody").addEventListener("click", onClick);
/* 页头动作在 router 的公共容器里，切页会清空内容，监听留在容器上 */
if($("pageActions")) $("pageActions").addEventListener("click", function(e){
  if(e.target.closest("[data-pf-new]")){
    showView("projects").then(function(){ return loadView("projects"); }).then(function(m){ m.openProjectDialog(null); });
    return;
  }
  if(e.target.closest("[data-pf-all]")){
    pfSetId = "";
    if(cache) renderPortfolio();
    else loadPortfolio();
    return;
  }
  if(e.target.closest("[data-portfolio-export]")){ exportPortfolio(); }
});
if($("portfolioBody")) $("portfolioBody").addEventListener("change", function(e){
  var sel = e.target.closest("[data-pf-set]");
  if(!sel) return;
  pfSetId = sel.value || "";
  if(cache) renderPortfolio();
});
/* 项目集与项目列表并行加载：若本页先渲染，集名 / 身份色取不到，等列表落地后再补一次 */
window.addEventListener("ds:reqs-loaded", function(){
  if(document.body.dataset.view !== "portfolio" || !cache) return;
  renderPortfolio();
});

export { enterPortfolioView, loadPortfolio };
