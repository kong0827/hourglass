/* views/workload · 成员负载名册与成员工作台 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { openTaskById } from "../core/task-actions.js";
import { dueState, projectOptionsHTML, reqSetId, rt, setNameById, statusBucket } from "../core/state.js";
import { loadReqs } from "./board.js";
import { companyChipHTML } from "../lib/company.js";
import { memberRoleTitles, labelFilterText } from "../lib/member-labels.js";
import { UI, esc, toast } from "../core/ui.js";
import { assocLinkHTML, avatarHTML, fmtMinutesShort, taskIsPublished, taskPublicationHTML, taskPublicationText, typeBadgeHTML } from "../lib/format.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours, loadBarHTML, taskStatusName } from "./manager-shared.js";

registerHelp({
  "workload.remaining": {
    title:"剩余预估",
    rows:[
      ["怎么算", "每个未完成工作项按 max(0, 预估 − 已计工时) 计算后求和；已超出预估的工作项按 0 计。", "ok"],
      ["只算未完成", "已完成工作项不参与；未填预估的未完成项按 0 计，可能低估实际剩余，成员工作台的「手里的工作项」会标出未填预估的项数。", "mute"],
      ["不含测试剩余", "这里只算开发负责人的剩余；测试负责人名下的测试剩余单列，并计入该成员的总负载。名册顶部的「合计剩余」沿用本口径，避免同一项工时被开发与测试重复累加。", "warn"],
      ["和版本页不同", "版本详情的「剩余预估」直接累加未完成项预估、不扣已投入；这里扣了已计工时，两处数字会不一样。", "warn"]
    ]
  },
  "workload.load": {
    title:"负载",
    rows:[
      ["怎么算", "（开发剩余 + 测试剩余）÷（容量窗口工作日 × 每日容量），四舍五入到整数百分比；每日容量取各成员自己的计时设置（每天最多计入几小时），未设置按 8h。", "ok"],
      ["测试剩余", "测试负责人名下的待测试 / 测试中工作项，按 max(0, 测试预估 − 测试窗口内已计工时) 计算；没填测试预估按 0 计。测试窗口从开始测试到测试结束，进行中的一轮暂不结算。", "info"],
      ["容量窗口", "从今天到该成员未完成工作项（含待测试 / 测试中）的最晚截止日，只数工作日；没有截止日按 5 天，至少 1 天、最多按一个月（默认 22 个工作日，可在配置文件调整）算。窗口只折算容量，不代表工作项必须在该截止日前做完。", "info"],
      ["状态阈值", "大于 100% 为超载；85%–100% 为接近满载；低于 85% 为正常；没有在手工作项时为空闲。", "warn"],
      ["已计工时", "按计时开始日期落在所选工时区间统计；本周口径换周即清零，和负载不是同一个窗口。", "mute"],
      ["工时区间", "顶部可选本周、上周、近30天、本月；区间只改变工时统计，负载与容量仍按剩余预估和截止日计算。", "info"]
    ]
  },
  "workload.status": {
    title:"成员当前状态",
    rows:[
      ["空闲 / 正常 / 接近满载 / 超载", "空闲表示当前没有未完成工作项；其余按负载阈值划分，负载按成员全部项目合并计算。", "ok"],
      ["逾期 / 阻塞", "逾期按截止日期早于今天、且未完成也未执行结束；阻塞取工作项当前的阻塞标记，是此刻快照。", "info"],
      ["今日已计 / 最近计时", "今日已计按计时开始日期落在今天统计；最近计时取本周或上周最后一条计时记录。", "mute"]
    ]
  },
  "workload.test": {
    title:"测试身份",
    rows:[
      ["怎么算", "按工作项的「测试负责人」统计处于待测试 / 测试中的项数；测试剩余 = max(0, 测试预估 − 测试窗口内已计工时)，并入该成员的总负载。", "ok"],
      ["已计测试", "测试窗口内（开始测试 → 测试结束）自己在这个工作项上的计时合计；窗口还开着的一轮暂不结算，所以测试剩余会保持到整轮结束。", "info"],
      ["本周测试", "他在本周对自己负责测试的工作项上的计时合计，含已完成的那部分工作项。", "info"],
      ["和手里的工作项不同", "「手里的工作项」与状态计数只含他负责开发的工作项；测试项只在测试行与测试剩余里另行统计，再并入总负载。", "warn"]
    ]
  }
});
initCaliberHelp();

/* ==================== 页面状态 ==================== */

var cache = null, seq = 0, loading = false, filterWorkspace = "";
var viewMode = "person";
var workloadFilter = { reqId:"", roleTitle:"", companyName:"" }, workloadOptions = {};
var ui = { q:"", status:"", group:"none", sort:"load", shown:24 };
var memberUi = { key:"", openedHere:false, taskFilter:"all", projectId:"", pub:"all", taskShown:20, logScope:"week", dayIdx:"", logShown:20, focus:"" };
var period = "week";
var PERIOD_OPTIONS = [["week","本周"],["last","上周"],["days30","近30天"],["month","本月"]];
var PREF_KEY = "hourglass.workload.prefs";
var LIST_PAGE = 24, TASK_PAGE = 20, LOG_PAGE = 20, GROUP_CAP = 100;
var WEEK_DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
var STATUS_ORDER = ["over", "hot", "ok", "idle"];
var STATUS_META = {
  over: { label:"超载", cls:"over" },
  hot:  { label:"接近满载", cls:"hot" },
  ok:   { label:"正常", cls:"ok" },
  idle: { label:"空闲", cls:"idle" }
};
var SORT_OPTIONS = [["load","负载从高到低"],["remaining","剩余工时从多到少"],["overdue","逾期工作项从多到少"],["name","姓名"]];
var GROUP_OPTIONS = [["none","不分组"],["company","按公司"],["role","按角色"],["project","按项目"],["status","按状态"]];

function loadPrefs(){
  try{
    var raw = localStorage.getItem(PREF_KEY);
    if(!raw) return;
    var pref = JSON.parse(raw) || {};
    if(pref.mode === "person" || pref.mode === "week") viewMode = pref.mode;
    if(GROUP_OPTIONS.some(function(o){ return o[0] === pref.group; })) ui.group = pref.group;
    if(SORT_OPTIONS.some(function(o){ return o[0] === pref.sort; })) ui.sort = pref.sort;
    if(PERIOD_OPTIONS.some(function(o){ return o[0] === pref.period; })) period = pref.period;
  }catch(e){ /* 本机偏好损坏时按默认展示 */ }
}
function savePrefs(){
  try{ localStorage.setItem(PREF_KEY, JSON.stringify({ mode:viewMode, group:ui.group, sort:ui.sort, period:period })); }catch(e){ /* 隐私模式忽略 */ }
}
loadPrefs();

function workloadWorkspace(){ return rt.currentWs && rt.currentWs.id || ""; }
function enterWorkloadView(){
  memberUi.key = routeMemberKey();
  memberUi.openedHere = false;
  if(rt.reqsLoaded) loadWorkload(); else loadReqs().then(loadWorkload);
}
["ds:project-roles-changed","ds:member-company-changed","ds:member-job-title-changed","ds:member-label-options-changed","ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name,function(e){
    var d = e && e.detail || {};
    if(d.workspaceId && d.workspaceId !== workloadWorkspace()) return;
    cache = null; workloadOptions = {}; seq++;
    if(document.body.dataset.view === "workload") loadWorkload({ silent:true });
  });
});
function workloadSelectOptions(values, selected, all, unset){
  var list = Array.from(new Set((values || []).filter(function(v){ return v && v !== "__unset__"; }).concat(selected && selected !== "__unset__" ? [selected] : [])));
  return '<option value="">' + all + '</option><option value="__unset__"' + (selected === "__unset__" ? ' selected' : '') + '>' + unset + '</option>'
    + list.map(function(v){ return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(labelFilterText(v)) + '</option>'; }).join("");
}
function workloadScopeText(data){
  var scope = data.scope || {}, project = (rt.reqList || []).filter(function(p){ return p.id === scope.reqId; })[0];
  var scopeName = scope.reqId ? (project ? project.name : scope.reqId) : '全部项目';
  if(scope.reqId && project){
    var setName = setNameById(reqSetId(scope.reqId));
    if(setName) scopeName = setName + " › " + scopeName;
  }
  return '项目：' + scopeName
    + ' · 公司：' + (scope.companyName === '__unset__' ? '未设公司' : labelFilterText(scope.companyName) || '全部公司')
    + ' · 角色：' + (scope.roleTitle === '__unset__' ? '未设角色' : labelFilterText(scope.roleTitle) || '全部角色');
}

/* ==================== 工具栏与筛选 ==================== */

function periodControlHTML(){
  var range = periodRange(period);
  return '<div class="wl-period" role="group" aria-label="工时区间">'
    + '<span class="wl-period-label">工时区间</span>'
    + '<div class="seg mini">' + PERIOD_OPTIONS.map(function(o){
        return '<button type="button" data-wl-period="' + o[0] + '" aria-pressed="' + (period === o[0]) + '">' + o[1] + '</button>';
      }).join("") + '</div>'
    + '<span class="wl-period-dates">' + esc(range.from) + ' ~ ' + esc(range.to) + '</span></div>';
}
function workloadFiltersHTML(){
  var projectList = rt.reqList.filter(function(p){ return (!p.workspaceId || p.workspaceId === workloadWorkspace()) && (!p.archivedAt || p.id === workloadFilter.reqId); });
  var html = '<div class="manager-label-filters">'
    + '<label>项目 <select class="mini-select' + (workloadFilter.reqId ? ' is-filtered' : '') + '" data-workload-filter="reqId"><option value="">全部项目</option>'
    + projectOptionsHTML(projectList, workloadFilter.reqId) + '</select></label>'
    + '<label>公司 <select class="mini-select' + (workloadFilter.companyName ? ' is-filtered' : '') + '" data-workload-filter="companyName">' + workloadSelectOptions(workloadOptions.companyNames, workloadFilter.companyName, '全部公司', '未设公司') + '</select></label>'
    + '<label>角色 <select class="mini-select' + (workloadFilter.roleTitle ? ' is-filtered' : '') + '" data-workload-filter="roleTitle">' + workloadSelectOptions(workloadOptions.roleTitles, workloadFilter.roleTitle, '全部角色', '未设角色') + '</select></label>'
    + '<button class="btn sm soft" type="button" data-workload-clear>' + icon("close", 13) + '清除筛选</button></div>';
  if(viewMode === "person"){
    html += '<div class="wl-filters">'
      + '<input type="search" class="wl-search" data-member-search value="' + esc(ui.q) + '" placeholder="搜索成员、公司、角色或项目…" aria-label="搜索成员">'
      + '<label>分组 <select class="mini-select' + (ui.group !== "none" ? ' is-filtered' : '') + '" data-wl-group>' + GROUP_OPTIONS.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === ui.group ? ' selected' : '') + '>' + o[1] + '</option>'; }).join("") + '</select></label>'
      + '<label>排序 <select class="mini-select' + (ui.sort !== "load" ? ' is-filtered' : '') + '" data-wl-sort>' + SORT_OPTIONS.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === ui.sort ? ' selected' : '') + '>' + o[1] + '</option>'; }).join("") + '</select></label>'
      + '</div>'
      + periodControlHTML();
  }
  return html;
}
function workloadToolbar(){
  return '<div class="manager-toolbar"><div><b>成员负载</b></div>'
    + '<div class="manager-actions"><div class="seg mini wl-mode">'
    + '<button type="button" data-load-mode="person" aria-pressed="' + (viewMode === 'person') + '"' + (loading || !cache ? ' disabled' : '') + '>按人</button>'
    + '<button type="button" data-load-mode="week" aria-pressed="' + (viewMode === 'week') + '"' + (loading || !cache ? ' disabled' : '') + '>按周</button>'
    + '</div><button class="btn sm" type="button" data-load-export' + (loading || !cache ? ' disabled' : '') + '>' + icon("download", 13) + ' 导出当前范围 CSV</button>'
    + fullscreenButtonHTML() + '</div></div>' + workloadFiltersHTML();
}
function loadWorkload(opts){
  opts = opts || {};
  var body = $("workloadBody"); if(!body) return Promise.resolve(null);
  var ws = workloadWorkspace();
  if(filterWorkspace !== ws){
    workloadFilter = { reqId:"", roleTitle:"", companyName:"" }; workloadOptions = {}; cache = null; filterWorkspace = ws;
    ui.shown = LIST_PAGE;
    if(memberUi.key){ memberUi.key = ""; syncMemberHash("", false); }
  }
  if(workloadFilter.reqId && rt.reqsLoaded && !rt.reqList.some(function(p){ return p.id === workloadFilter.reqId && (!p.workspaceId || p.workspaceId === ws); })) workloadFilter.reqId = "";
  var current = ++seq, scope = Object.assign({}, workloadFilter), range = periodRange(period);
  var params = { reqId:scope.reqId || null, roleTitle:scope.roleTitle || null, companyName:scope.companyName || null };
  if(period === "days30" || period === "month"){ params.from = range.from; params.to = range.to; }
  loading = true;
  body.innerHTML = workloadToolbar() + UI.skeletonRows(5);
  body.setAttribute("aria-busy","true");
  return API.get("/api/manager/workload", params).then(function(data){
    if(current !== seq || ws !== workloadWorkspace()) return null;
    cache = Object.assign({}, data, { scope:data.scope || scope }); workloadOptions = data.filterOptions || {}; loading = false;
    body.setAttribute("aria-busy","false");
    if(memberUi.key && !memberByKey(memberUi.key)){
      memberUi.key = ""; syncMemberHash("", false);
    }
    renderWorkload(); return cache;
  }).catch(function(ex){
    if(current !== seq || ws !== workloadWorkspace()) return null;
    if(scope.reqId && (ex.code === 403 || ex.code === 404)){
      workloadFilter.reqId = ""; toast("所选项目已不可访问，已切换为全部项目", "warn"); return loadWorkload(opts);
    }
    cache = null; loading = false; body.setAttribute("aria-busy","false");
    body.innerHTML = workloadToolbar() + UI.errorState(ex.message || "加载失败，请重试"); return null;
  });
}

/* ==================== 成员视图派生 ==================== */

function memberByKey(key){
  return (cache && cache.members || []).filter(function(m){ return m.key === key; })[0];
}
function todayIso(){
  if(rt && rt.TODAY_ISO) return rt.TODAY_ISO;
  var d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
}
function parseDay(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}
function addDaysISO(iso, days){
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if(!m) return "";
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekTodayIndex(weekStart){
  var today = todayIso();
  if(!weekStart || !today) return -1;
  var diff = Math.round((parseDay(today) - parseDay(weekStart)) / 86400000);
  return diff >= 0 && diff < 7 ? diff : -1;
}
/* 工时区间只影响“已计工时”类数字；负载仍按剩余预估 ÷ 工作日容量计算 */
function periodRange(key){
  var today = todayIso();
  var dow = new Date(parseDay(today)).getUTCDay();
  var monday = addDaysISO(today, -((dow + 6) % 7));
  if(key === "last") return { from:addDaysISO(monday, -7), to:addDaysISO(monday, -1), label:"上周" };
  if(key === "days30") return { from:addDaysISO(today, -29), to:today, label:"近30天" };
  if(key === "month") return { from:today.slice(0, 7) + "-01", to:today, label:"本月" };
  return { from:monday, to:addDaysISO(monday, 6), label:"本周" };
}
function periodLabel(){ return periodRange(period).label; }
function periodMinutes(m){
  if(period === "week") return Number(m.weekMinutes) || 0;
  if(period === "last") return Number(m.lastWeekMinutes) || 0;
  return Number(m.rangeMinutes) || 0;
}
function periodHint(m){
  if(period === "week") return '上周 ' + fmtHours(m.lastWeekMinutes);
  if(period === "last") return '本周 ' + fmtHours(m.weekMinutes);
  return '含 ' + (Number(cache && cache.rangeWorkdays) || 0) + ' 个工作日';
}
function todayMinutes(m){
  var idx = weekTodayIndex(cache && cache.weekStart);
  return idx < 0 ? 0 : (Number((m.dayMinutes || [])[idx]) || 0);
}
function lastLogDate(m){
  var logs = (m.weekLogs || []).concat(m.lastWeekLogs || []);
  var latest = "";
  logs.forEach(function(l){ if(l && l.date && l.date > latest) latest = l.date; });
  return latest;
}
function taskOverdue(t){ return dueState(t).kind === "over"; }
function taskCounts(tasks){
  var c = { open:0, doing:0, backlog:0, ended:0, overdue:0, blocked:0, unestimated:0, latestDue:"" };
  (tasks || []).forEach(function(t){
    var bucket = statusBucket(t);
    if(bucket === "done") return;
    c.open++;
    if(bucket === "doing") c.doing++;
    else if(bucket === "backlog") c.backlog++;
    else if(bucket === "ended") c.ended++;
    if(taskOverdue(t)) c.overdue++;
    if(t.blocked) c.blocked++;
    if(!t.estimateMinutes) c.unestimated++;
    if(t.dueDate && t.dueDate > c.latestDue) c.latestDue = t.dueDate;
  });
  return c;
}
/* 测试项只统计「测试负责人」身份下的待测试 / 测试中，不并入负责人口径 */
function testRefCounts(refs, reqId){
  var c = { waiting:0, doing:0, total:0 };
  (refs || []).forEach(function(t){
    if(reqId !== undefined && (t.reqId || "") !== (reqId || "")) return;
    c.total++;
    if(t.column === "test") c.waiting++;
    else if(t.column === "testing") c.doing++;
  });
  return c;
}
function memberStatus(m, counts){
  if(!(m.tasks || []).length && !(m.testTaskRefs || []).length) return "idle";
  var pct = Number(m.loadPct) || 0;
  if(pct > 100 || m.overloaded) return "over";
  if(pct >= 85) return "hot";
  return "ok";
}
function memberProjectList(m){
  var map = Object.create(null), order = [];
  function ensure(reqId, name){
    var key = reqId || "";
    if(!map[key]){
      map[key] = { reqId:reqId || "", name:name || "未归类", taskCount:0, testTaskCount:0, remainingMinutes:0, testRemainingMinutes:0, logMinutes:0, roleTitles:[] };
      order.push(key);
    }
    return map[key];
  }
  (m.projects || []).forEach(function(p){
    var item = ensure(p.reqId, p.name);
    item.taskCount = Number(p.taskCount) || 0;
    item.testTaskCount = Number(p.testTaskCount) || 0;
    item.remainingMinutes = Number(p.remainingMinutes) || 0;
    item.testRemainingMinutes = Number(p.testRemainingMinutes) || 0;
    item.roleTitles = (p.roleTitles || []).slice();
  });
  (m.weekLogs || []).concat(m.lastWeekLogs || []).forEach(function(l){
    var item = ensure(l.reqId, l.reqName);
    item.logMinutes += Number(l.minutes) || 0;
  });
  return order.map(function(key){ return map[key]; }).sort(function(a, b){
    return (b.remainingMinutes - a.remainingMinutes) || String(a.name).localeCompare(String(b.name), "zh");
  });
}
function memberView(m){
  var counts = taskCounts(m.tasks);
  return {
    m: m,
    key: m.key,
    status: memberStatus(m, counts),
    counts: counts,
    tests: testRefCounts(m.testTaskRefs),
    projects: memberProjectList(m),
    todayMinutes: todayMinutes(m),
    lastLog: lastLogDate(m)
  };
}
function allMemberViews(){
  return (cache && cache.members || []).map(memberView);
}
function memberSearchText(mv){
  var m = mv.m;
  return [
    m.name,
    m.companyName,
    m.jobTitle,
    (Array.isArray(m.roleTitles) ? m.roleTitles : memberRoleTitles(m)).join(" "),
    mv.projects.map(function(p){ return p.name; }).join(" ")
  ].join(" ").toLowerCase();
}
function memberMatchesSearch(mv, terms){
  if(!terms.length) return true;
  var hay = memberSearchText(mv);
  return terms.every(function(t){ return hay.indexOf(t) !== -1; });
}
function compareViews(a, b){
  if(ui.sort === "remaining") return (Number(b.m.loadRemainingMinutes) || 0) - (Number(a.m.loadRemainingMinutes) || 0) || String(a.m.name || "").localeCompare(String(b.m.name || ""), "zh");
  if(ui.sort === "overdue") return b.counts.overdue - a.counts.overdue || (Number(b.m.loadPct) || 0) - (Number(a.m.loadPct) || 0);
  if(ui.sort === "name") return String(a.m.name || "").localeCompare(String(b.m.name || ""), "zh");
  return (Number(b.m.loadPct) || 0) - (Number(a.m.loadPct) || 0) || String(a.m.name || "").localeCompare(String(b.m.name || ""), "zh");
}
function memberStatusTag(status){
  var meta = STATUS_META[status] || STATUS_META.ok;
  return '<span class="member-status ' + meta.cls + '">' + meta.label + '</span>';
}
/* 岗位与项目角色同名时不重复显示；两者不同才并列 */
function jobTitleSpan(jobTitle, roles){
  if(!jobTitle) return "";
  var same = (Array.isArray(roles) ? roles : []).some(function(r){ return r === jobTitle; });
  return same ? "" : '<span>' + esc(jobTitle) + '</span>';
}
function memberRoleTagsHtml(list, limit){
  var roles = Array.isArray(list) ? list : [];
  var shown = roles.slice(0, limit || 3);
  return shown.map(function(r){ return '<span class="tag tag-ghost">' + esc(r) + '</span>'; }).join("")
    + (roles.length > shown.length ? '<span class="roster-empty">+' + (roles.length - shown.length) + '</span>' : '')
    + (!roles.length ? '<span class="roster-empty">未设角色</span>' : '');
}

/* ==================== 名册渲染 ==================== */

function summaryHTML(){
  var views = allMemberViews();
  var over = 0, hot = 0, idle = 0, remaining = 0, worked = 0, overdue = 0, blocked = 0;
  views.forEach(function(mv){
    if(mv.status === "over") over++;
    else if(mv.status === "hot") hot++;
    else if(mv.status === "idle") idle++;
    remaining += Number(mv.m.remainingMinutes) || 0;
    worked += periodMinutes(mv.m);
    overdue += mv.counts.overdue;
    blocked += mv.counts.blocked;
  });
  return '<div class="wl-summary">'
    + '<div class="wl-summary-item"><span>成员</span><b>' + views.length + ' 人</b><small>空闲 ' + idle + ' 人</small></div>'
    + '<div class="wl-summary-item' + (over ? ' danger' : '') + '"><span>超载</span><b>' + over + ' 人</b><small>接近满载 ' + hot + ' 人</small></div>'
    + '<div class="wl-summary-item"><span class="caliber-label">合计剩余' + caliberMarkHTML("workload.remaining", false, "查看「剩余预估」口径") + '</span><b>' + fmtHours(remaining) + '</b><small>未完成工作项 ' + views.reduce(function(n, mv){ return n + mv.counts.open; }, 0) + ' 项</small></div>'
    + '<div class="wl-summary-item"><span>' + esc(periodLabel()) + '已计</span><b>' + fmtHours(worked) + '</b><small>逾期 ' + overdue + ' 项 · 阻塞 ' + blocked + ' 项</small></div>'
    + '</div>';
}
function statusChipsHTML(views){
  var counts = { "":views.length, over:0, hot:0, ok:0, idle:0 };
  views.forEach(function(mv){ counts[mv.status] = (counts[mv.status] || 0) + 1; });
  return '<div class="wl-chips" role="group" aria-label="按成员状态筛选">'
    + chipHTML("", "全部", counts[""])
    + STATUS_ORDER.map(function(key){ return chipHTML(key, STATUS_META[key].label, counts[key] || 0); }).join("")
    + '</div>';
}
function chipHTML(key, label, count){
  return '<button class="wl-chip" type="button" data-member-status="' + key + '" aria-pressed="' + (ui.status === key) + '">'
    + label + '<b>' + count + '</b></button>';
}
function groupNoteHTML(){
  if(ui.group === "role") return '<p class="roster-note">按成员在空间或项目中的有效主角色分组，兼岗不重复计入。</p>';
  return '';
}
function projectScopeCounts(m, reqId){
  return taskCounts((m.tasks || []).filter(function(t){ return (t.reqId || "") === (reqId || ""); }));
}
function memberCardHTML(mv, scope){
  var m = mv.m, counts = scope ? projectScopeCounts(m, scope.reqId) : mv.counts;
  var tests = scope ? testRefCounts(m.testTaskRefs, scope.reqId) : mv.tests;
  var testRemainingMinutes = scope
    ? Number((mv.projects.filter(function(p){ return (p.reqId || "") === (scope.reqId || ""); })[0] || {}).testRemainingMinutes) || 0
    : Number(m.testRemainingMinutes) || 0;
  var roles = Array.isArray(m.roleTitles) ? m.roleTitles : memberRoleTitles(m);
  var projects = mv.projects.slice(0, 3);
  /* 卡片脚注展示「上周 Yh」时，进工作台默认也停在上周明细，保持同一窗口 */
  var logScopeAttr = ' data-member-scope="' + (period === "last" ? "last" : "week") + '"';
  return '<article class="member-card" data-member-open="' + esc(m.key) + '"' + logScopeAttr + '>'
    + '<div class="member-card-head">' + avatarHTML(m.name, "lg")
    + '<div class="member-card-id"><b>' + esc(m.name) + '</b><div class="member-card-sub">' + companyChipHTML(m.companyName) + jobTitleSpan(m.jobTitle, roles) + '</div></div>'
    + memberStatusTag(mv.status) + '</div>'
    + '<div class="member-card-roles">' + memberRoleTagsHtml(roles, 3) + '</div>'
    + '<div class="member-loadline"><span class="caliber-label">总负载' + caliberMarkHTML("workload.load", false, "查看「负载」口径") + '</span>'
    + loadBarHTML(m.loadPct) + '<span' + (m.testRemainingMinutes ? ' title="' + esc('开发剩余 ' + fmtHours(m.remainingMinutes) + ' · 测试剩余 ' + fmtHours(m.testRemainingMinutes)) + '"' : '') + '>剩余 ' + fmtHours(m.loadRemainingMinutes) + ' / 容量 ' + fmtHours(m.capacityMinutes) + '</span></div>'
    + '<div class="member-card-stats">'
    + statHTML("进行中", counts.doing)
    + statHTML("待处理", counts.backlog)
    + statHTML("逾期", counts.overdue, counts.overdue ? "danger" : "mute")
    + statHTML("阻塞", counts.blocked, counts.blocked ? "warn" : "mute")
    + '</div>'
    + (tests.total
        ? '<div class="member-card-tests"><span class="member-test-label">测试' + caliberMarkHTML("workload.test", false, "查看「测试身份」口径") + '</span>'
          + '<span>待测试 <b>' + tests.waiting + '</b></span>'
          + '<span>测试中 <b>' + tests.doing + '</b></span>'
          + (testRemainingMinutes ? '<span>测试剩余 <b>' + fmtHours(testRemainingMinutes) + '</b></span>' : '')
          + (!scope && m.testWeekMinutes ? '<span>本周测试 <b>' + fmtHours(m.testWeekMinutes) + '</b></span>' : '')
          + '</div>'
        : '')
    + '<div class="member-card-projects">' + (projects.length
        ? projects.map(function(p){
            var setName = p.reqId ? setNameById(reqSetId(p.reqId)) : "";
            return '<span class="wl-proj-chip' + (scope && (scope.reqId || "") === (p.reqId || "") ? ' on' : '') + '"'
              + (setName ? ' title="' + esc("项目集 " + setName + " › " + p.name) + '"' : '')
              + '><b>' + esc(p.name) + '</b><i>' + fmtHours(p.remainingMinutes) + '</i></span>';
          }).join("")
          + (mv.projects.length > projects.length ? '<span class="wl-proj-more">+' + (mv.projects.length - projects.length) + ' 个项目</span>' : '')
        : '<span class="roster-empty">暂无参与项目</span>') + '</div>'
    + '<div class="member-card-foot"><span>' + esc(periodLabel()) + ' ' + fmtHours(periodMinutes(m)) + ' · 今日 ' + (mv.todayMinutes ? fmtHours(mv.todayMinutes) : "—") + '</span>'
    + (mv.lastLog ? '<span>最近计时 ' + esc(fmtDate(mv.lastLog)) + '</span>' : '')
    + '<button class="member-link" type="button" data-member-open="' + esc(m.key) + '"' + logScopeAttr + '>工作台 →</button></div>'
    + '</article>';
}
function statHTML(label, value, tone){
  return '<div class="member-stat' + (tone ? ' ' + tone : '') + '"><i>' + label + '</i><b>' + value + '</b></div>';
}
function memberGridHTML(pairs){
  return '<div class="wl-grid">' + pairs.map(function(pair){ return memberCardHTML(pair.mv, pair.scope); }).join("") + '</div>';
}
function groupMeta(entries){
  var over = 0, remaining = 0, tasks = 0;
  entries.forEach(function(pair){
    if(pair.mv.status === "over") over++;
    remaining += pair.scope ? (Number(pair.mv.projects.filter(function(p){ return (p.reqId || "") === (pair.scope.reqId || ""); })[0] || {}).remainingMinutes) || 0 : (Number(pair.mv.m.loadRemainingMinutes) || 0);
    tasks += pair.scope ? projectScopeCounts(pair.mv.m, pair.scope.reqId).open : pair.mv.counts.open;
  });
  return { over:over, remaining:remaining, tasks:tasks };
}
function groupedHTML(views){
  var groups = [], byKey = Object.create(null);
  function addGroup(key, label, order){
    if(!byKey[key]){ byKey[key] = { key:key, label:label, order:order || 0, entries:[] }; groups.push(byKey[key]); }
    return byKey[key];
  }
  views.forEach(function(mv){
    if(ui.group === "project"){
      var list = mv.projects.length ? mv.projects : [{ reqId:"", name:"未归类" }];
      list.forEach(function(p){
        var label = p.name || "未归类";
        var setName = p.reqId ? setNameById(reqSetId(p.reqId)) : "";
        if(setName) label = setName + " › " + label;
        addGroup(p.reqId || "", label, projectOrder(p.reqId)).entries.push({ mv:mv, scope:{ reqId:p.reqId || "", name:p.name || "未归类" } });
      });
      return;
    }
    var label = "未分组", order = 0;
    if(ui.group === "company") label = mv.m.companyName || "未设公司";
    else if(ui.group === "role") label = (Array.isArray(mv.m.roleTitles) ? mv.m.roleTitles : memberRoleTitles(mv.m))[0] || "未设角色";
    else if(ui.group === "status"){ label = STATUS_META[mv.status].label; order = STATUS_ORDER.indexOf(mv.status); }
    addGroup(label, label, order).entries.push({ mv:mv, scope:null });
  });
  if(ui.group === "status") groups.sort(function(a, b){ return a.order - b.order; });
  else if(ui.group === "project") groups.sort(function(a, b){ return a.order - b.order || String(a.label).localeCompare(String(b.label), "zh"); });
  else groups.sort(function(a, b){ return String(a.label).localeCompare(String(b.label), "zh"); });
  return groups.map(function(group){
    var meta = groupMeta(group.entries);
    return '<section class="wl-group"><div class="wl-group-head"><b>' + esc(group.label) + '<span class="roster-empty">' + group.entries.length + ' 人</span></b>'
      + '<span>剩余 ' + fmtHours(meta.remaining) + ' · 未完成 ' + meta.tasks + ' 项' + (meta.over ? ' · 超载 ' + meta.over + ' 人' : '') + '</span></div>'
      + memberGridHTML(group.entries) + '</section>';
  }).join("");
}
function projectOrder(reqId){
  var list = (cache && cache.projects) || [];
  for(var i = 0; i < list.length; i++) if((list[i].id || "") === (reqId || "")) return i;
  return list.length + 1;
}
function rosterHTML(){
  var views = allMemberViews().sort(compareViews);
  var terms = ui.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  var searched = views.filter(function(mv){ return memberMatchesSearch(mv, terms); });
  var filtered = ui.status ? searched.filter(function(mv){ return mv.status === ui.status; }) : searched;
  var head = summaryHTML() + statusChipsHTML(searched) + groupNoteHTML();
  if(!filtered.length){
    return head + '<div class="wl-empty">' + (views.length ? '当前筛选下没有成员' : '当前范围暂无成员负载数据')
      + (ui.status || ui.q ? '<button class="btn sm soft" type="button" data-member-reset>清除成员筛选</button>' : '') + '</div>';
  }
  if(ui.group !== "none"){
    var capped = filtered.slice(0, GROUP_CAP);
    return head + groupedHTML(capped)
      + (filtered.length > capped.length ? '<p class="roster-note">分组视图最多展示 ' + GROUP_CAP + ' 人，当前 ' + filtered.length + ' 人，请用筛选收窄范围。</p>' : '');
  }
  var shown = filtered.slice(0, ui.shown);
  return head + memberGridHTML(shown.map(function(mv){ return { mv:mv, scope:null }; }))
    + '<div class="wl-more">' + (filtered.length > shown.length
      ? '<button class="btn sm block" type="button" data-member-more>显示更多（已显示 ' + shown.length + ' / 共 ' + filtered.length + ' 人）</button>'
      : (filtered.length > LIST_PAGE ? '<span class="foot-note">已显示全部 ' + filtered.length + ' 人</span>' : '')) + '</div>';
}
function renderRosterOnly(){
  var el = $("memberRoster");
  if(el) el.innerHTML = rosterHTML();
}

/* ==================== 按周工时 ==================== */

function weekTable(){
  var rows = (cache.members || []).map(function(m){
    var mv = memberView(m);
    var hasLogs = (m.weekLogs || []).length > 0;
    var nameHTML = '<button class="manager-person manager-cell-link" type="button" data-member-open="' + esc(m.key) + '" data-member-layer="logs" title="打开成员工作台">'
      + avatarHTML(m.name, "sm") + '<b>' + esc(m.name) + '</b></button>' + memberStatusTag(mv.status);
    var cells = (m.dayMinutes || []).map(function(n, i){
      if(!n) return '<td class="num">—</td>';
      if(!hasLogs) return '<td class="num">' + fmtHours(n) + '</td>';
      return '<td class="num"><button class="manager-cell-link" type="button" data-member-open="' + esc(m.key) + '" data-member-layer="logs" data-member-day="' + i + '" title="查看该日计时明细">' + fmtHours(n) + '</button></td>';
    }).join("");
    var diff = (m.weekMinutes || 0) - (m.lastWeekMinutes || 0), cls = diff > 0 ? "tag-warning" : (diff < 0 ? "tag-success" : "tag-ghost");
    var diffHTML = '<span class="tag ' + cls + '">' + (diff === 0 ? '持平' : ((diff > 0 ? '+' : '−') + fmtHours(Math.abs(diff)))) + '</span>';
    if((m.lastWeekLogs || []).length){
      diffHTML = '<button class="manager-cell-link" type="button" data-member-open="' + esc(m.key) + '" data-member-layer="logs" data-member-scope="last" title="查看上周计时明细">' + diffHTML + '</button>';
    }
    var totalHTML = hasLogs ? '<button class="manager-cell-link" type="button" data-member-open="' + esc(m.key) + '" data-member-layer="logs" title="查看本周计时明细"><b>' + fmtHours(m.weekMinutes) + '</b></button>' : '<b>' + fmtHours(m.weekMinutes) + '</b>';
    return '<tr><td><div class="wl-week-who">' + nameHTML + '</div>' + '<span class="wl-week-company">' + esc(m.companyName || "未设公司") + '</span></td>' + cells + '<td class="num">' + totalHTML + '</td><td>' + diffHTML + '</td></tr>';
  }).join("") || '<tr><td colspan="10" class="manager-empty-cell">本周暂无计时记录</td></tr>';
  return '<section class="manager-panel"><div class="manager-panel-head"><b>本周工时</b></div><div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>成员</th>' + WEEK_DAY_NAMES.map(function(d){ return '<th class="num">' + d + '</th>'; }).join("") + '<th class="num">本周合计</th><th>上周对比</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
}

/* ==================== 成员工作台 ==================== */

/* 每日容量与默认 8h 不同时补一行，避免「容量 240h」看着像按 8h 折算 */
function perDaySuffix(m){
  var perDay = Number(m && m.capacityMinutesPerDay) || 480;
  return perDay === 480 ? "" : '（每日 ' + fmtHours(perDay) + '）';
}
function memberKpisHTML(mv){
  var m = mv.m;
  return '<div class="member-sheet-kpis">'
    + '<div class="member-sheet-kpi"><i>未完成工作项</i><b>' + (m.tasks || []).length + ' 项</b></div>'
    + '<div class="member-sheet-kpi"><i class="caliber-label">剩余预估' + caliberMarkHTML("workload.remaining", false, "查看「剩余预估」口径") + '</i><b>' + fmtHours(m.loadRemainingMinutes) + '</b><span>' + (m.testRemainingMinutes ? '含测试 ' + fmtHours(m.testRemainingMinutes) + ' · ' : '') + '按 ' + (m.workdays || 0) + ' 个工作日容量计</span></div>'
    + '<div class="member-sheet-kpi"><i>' + esc(periodLabel()) + '已计</i><b>' + fmtHours(periodMinutes(m)) + '</b><span>' + esc(periodHint(m)) + '</span></div>'
    + '<div class="member-sheet-kpi"><i class="caliber-label">负载' + caliberMarkHTML("workload.load", false, "查看「负载」口径") + '</i><b>' + (Number(m.loadPct) || 0) + '%</b><span>容量 ' + fmtHours(m.capacityMinutes) + (perDaySuffix(m)) + '</span></div>'
    + '</div>';
}
function statePanelHTML(mv){
  var c = mv.counts;
  return '<div class="manager-panel-head"><b>当前状态</b><span class="caliber-label">口径' + caliberMarkHTML("workload.status", false, "查看「成员当前状态」口径") + '</span></div>'
    + '<div class="member-state-grid">'
    + stateTileHTML("进行中", c.doing)
    + stateTileHTML("待处理", c.backlog)
    + stateTileHTML("执行结束", c.ended, c.ended ? "" : "mute")
    + stateTileHTML("逾期", c.overdue, c.overdue ? "danger" : "mute")
    + stateTileHTML("阻塞", c.blocked, c.blocked ? "warn" : "mute")
    + stateTileHTML("今日已计", mv.todayMinutes ? fmtHours(mv.todayMinutes) : "—")
    + (mv.tests.total || Number(mv.m.testWeekMinutes)
        ? stateTileHTML("待测试", mv.tests.waiting, mv.tests.waiting ? "" : "mute")
          + stateTileHTML("测试中", mv.tests.doing, mv.tests.doing ? "" : "mute")
          + stateTileHTML("测试剩余", mv.m.testRemainingMinutes ? fmtHours(mv.m.testRemainingMinutes) : "—", mv.m.testRemainingMinutes ? "" : "mute")
          + stateTileHTML("本周测试", mv.m.testWeekMinutes ? fmtHours(mv.m.testWeekMinutes) : "—")
        : '')
    + '</div>'
    + '<p class="member-state-note">最晚截止 ' + (c.latestDue ? esc(fmtDate(c.latestDue)) : "—")
    + ' · 最近计时 ' + (mv.lastLog ? esc(fmtDate(mv.lastLog)) : "—")
    + (c.unestimated ? ' · ' + c.unestimated + ' 项未填预估' : '')
    + (mv.tests.total ? ' · 测试项 ' + mv.tests.total + ' 项已计入负载' : '') + '</p>';
}
function stateTileHTML(label, value, tone){
  return '<div class="member-state' + (tone && tone !== "mute" ? ' ' + tone : '') + '"><i>' + label + '</i><b>' + value + '</b></div>';
}
function projectKey(reqId){ return reqId || "__none__"; }
function projectsPanelHTML(mv){
  var total = Number(mv.m.loadRemainingMinutes) || 0;
  var body = mv.projects.length ? mv.projects.map(function(p){
    var pct = total ? Math.round((Number(p.remainingMinutes) || 0) / total * 100) : 0;
    var roles = memberRoleTagsHtml(p.roleTitles && p.roleTitles.length ? p.roleTitles : memberRoleTitles(p), 2);
    return '<tr class="member-proj-row' + (memberUi.projectId === projectKey(p.reqId) ? ' on' : '') + '" data-member-project="' + esc(projectKey(p.reqId)) + '" tabindex="0" title="筛选该项目下的工作项">'
      + '<td><b class="manager-drill-title">' + esc(p.name) + '</b><div class="manager-member-labels">' + roles + '</div></td>'
      + '<td class="num">' + (p.taskCount || 0) + (p.testTaskCount ? ' <span class="roster-empty">+' + p.testTaskCount + ' 测试</span>' : '') + '</td>'
      + '<td class="num"' + (p.testRemainingMinutes ? ' title="' + esc('含测试剩余 ' + fmtHours(p.testRemainingMinutes)) + '"' : '') + '>' + fmtHours(p.remainingMinutes) + '</td>'
      + '<td><div class="member-share"><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></div></td>'
      + '</tr>';
  }).join("") : '<tr><td colspan="4" class="manager-empty-cell">该成员暂无参与项目</td></tr>';
  return '<div class="manager-panel-head"><b>参与项目</b><span>' + mv.projects.length + ' 个</span></div>'
    + '<div class="tbl-wrap"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th>项目 / 我的角色</th><th class="num">未完成</th><th class="num">剩余</th><th>占比</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function tasksForProject(m, key){
  var want = key === "__none__" ? "" : (key || "");
  return (m.tasks || []).filter(function(t){ return (t.reqId || "") === want; });
}
function filterTasks(tasks, filter){
  return tasks.filter(function(t){
    if(filter === "doing") return statusBucket(t) === "doing";
    if(filter === "backlog") return statusBucket(t) === "backlog";
    if(filter === "overdue") return taskOverdue(t);
    if(filter === "blocked") return !!t.blocked;
    return true;
  });
}
function dueCellHTML(t){
  if(!t.dueDate) return '<span class="roster-empty">未设</span>';
  var state = dueState(t) || {};
  if(state.kind === "over") return '<span class="member-due over">逾期' + (state.n ? ' ' + state.n + ' 天' : '') + '</span>';
  if(state.kind === "today") return '<span class="member-due today">今天</span>';
  if(state.kind === "soon") return '<span class="member-due soon">' + esc(fmtDate(t.dueDate)) + '</span>';
  return esc(fmtDate(t.dueDate));
}
function taskRowsHTML(tasks){
  return tasks.map(function(t){
    return '<tr data-open-task="' + esc(t.id) + '" tabindex="0" title="打开工作项详情">'
      + '<td><div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + taskPublicationHTML(t) + '</div></td>'
      + '<td>' + assocLinkHTML("project", t.reqId, t.reqName, { plain:"未归类" }) + '</td>'
      + '<td>' + esc(taskStatusName(t)) + '</td>'
      + '<td><span class="member-pri ' + esc(String(t.priority || "P2").toLowerCase()) + '">' + esc(t.priority || "P2") + '</span></td>'
      + '<td class="num">' + dueCellHTML(t) + '</td>'
      + '<td class="num">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
      + '<td class="num">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td></tr>';
  }).join("");
}
function tasksPanelHTML(mv){
  var m = mv.m;
  var scoped = memberUi.projectId ? tasksForProject(m, memberUi.projectId) : (m.tasks || []);
  if(memberUi.pub !== "all"){
    scoped = scoped.filter(function(t){ return taskIsPublished(t) === (memberUi.pub === "published"); });
  }
  var counts = taskCounts(scoped);
  var filtered = filterTasks(scoped, memberUi.taskFilter);
  var shown = filtered.slice(0, memberUi.taskShown);
  var projectOptions = '<option value="">全部项目</option>' + mv.projects.map(function(p){
    var key = projectKey(p.reqId);
    return '<option value="' + esc(key) + '"' + (memberUi.projectId === key ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }).join("");
  var filters = [["all","全部",scoped.length],["doing","进行中",counts.doing],["backlog","待处理",counts.backlog],["overdue","逾期",counts.overdue],["blocked","阻塞",counts.blocked]];
  return '<div class="manager-panel-head"><b>手里的工作项</b><span>共 ' + filtered.length + ' 项 · 逾期 ' + counts.overdue + ' · 阻塞 ' + counts.blocked
    + (counts.unestimated ? ' · 未填预估 ' + counts.unestimated + ' 项' : '') + '</span></div>'
    + '<div class="member-work-tools"><div class="seg mini member-task-seg">'
    + filters.map(function(f){ return '<button type="button" data-member-task-filter="' + f[0] + '" aria-pressed="' + (memberUi.taskFilter === f[0]) + '">' + f[1] + '<b>' + f[2] + '</b></button>'; }).join("")
    + '</div><select class="mini-select' + (memberUi.projectId ? ' is-filtered' : '') + '" data-member-task-project aria-label="按项目筛选工作项">' + projectOptions + '</select>'
    + '<select class="mini-select' + (memberUi.pub !== "all" ? ' is-filtered' : '') + '" data-member-task-pub aria-label="按发布状态筛选工作项">'
    + [["all","全部发布状态"],["published","已发布"],["unpublished","未发布"]].map(function(o){
        return '<option value="' + o[0] + '"' + (memberUi.pub === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join("")
    + '</select>'
    + (memberUi.projectId ? '<button class="member-link" type="button" data-member-project-clear>清除项目筛选</button>' : '') + '</div>'
    + '<div class="tbl-wrap"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th>工作项</th><th>项目</th><th>状态</th><th>优先级</th><th class="num">截止</th><th class="num">预估</th><th class="num">已计</th>'
    + '</tr></thead><tbody>' + (taskRowsHTML(shown) || '<tr><td colspan="7" class="manager-empty-cell">该口径下暂无工作项</td></tr>') + '</tbody></table></div>'
    + moreHTML("task", shown.length, filtered.length, "项");
}
function logsForScope(m){
  var last = memberUi.logScope === "last";
  return { logs:last ? (m.lastWeekLogs || []) : (m.weekLogs || []), start:last ? (cache && cache.lastWeekStart) : (cache && cache.weekStart), last:last };
}
function logRowsHTML(logs){
  return logs.map(function(l){
    var attrs = l.taskId ? ' data-open-task="' + esc(l.taskId) + '" tabindex="0" title="打开工作项详情"' : "";
    var origin = l.origin === "manual" ? ' <span class="tag tag-ghost">补记</span>' : "";
    return '<tr' + attrs + '><td class="num">' + esc(fmtDate(l.date)) + '</td>'
      + '<td><div class="manager-task-title">' + esc(l.title) + origin + '</div></td>'
      + '<td>' + assocLinkHTML("project", l.reqId, l.reqName, { plain:"未归类" }) + '</td><td class="num">' + fmtHours(l.minutes) + '</td></tr>';
  }).join("");
}
function logsPanelHTML(mv){
  var scope = logsForScope(mv.m);
  var dayLogs = memberUi.dayIdx === "" ? scope.logs : scope.logs.filter(function(l){ return l.date === addDaysISO(scope.start, Number(memberUi.dayIdx)); });
  var shown = dayLogs.slice(0, memberUi.logShown);
  var dayTotals = [0,0,0,0,0,0,0];
  scope.logs.forEach(function(l){
    var idx = Math.round((parseDay(l.date) - parseDay(scope.start)) / 86400000);
    if(idx >= 0 && idx < 7) dayTotals[idx] += Number(l.minutes) || 0;
  });
  var todayIdx = scope.last ? -1 : weekTodayIndex(scope.start);
  var days = WEEK_DAY_NAMES.map(function(name, i){
    var on = String(memberUi.dayIdx) === String(i);
    return '<button class="member-day' + (i === todayIdx ? ' is-today' : '') + (on ? ' on' : '') + '" type="button" data-member-day="' + i + '" aria-pressed="' + on + '" title="只看 ' + name + ' 的计时">'
      + '<span>' + name + '</span><b>' + (dayTotals[i] ? fmtHours(dayTotals[i]) : "—") + '</b></button>';
  }).join("");
  var total = dayLogs.reduce(function(n, l){ return n + (Number(l.minutes) || 0); }, 0);
  var label = memberUi.dayIdx === "" ? (scope.last ? "上周工时" : "本周工时") : (WEEK_DAY_NAMES[Number(memberUi.dayIdx)] + " · " + fmtDate(addDaysISO(scope.start, Number(memberUi.dayIdx))));
  return '<div class="manager-panel-head"><b>' + label + '</b><span>共 ' + dayLogs.length + ' 条 · 合计 ' + fmtHours(total) + '</span></div>'
    + '<div class="member-work-tools"><div class="seg mini">'
    + '<button type="button" data-member-log-scope="week" aria-pressed="' + (!scope.last) + '">本周</button>'
    + '<button type="button" data-member-log-scope="last" aria-pressed="' + scope.last + '">上周</button></div>'
    + (memberUi.dayIdx !== "" ? '<button class="member-link" type="button" data-member-day-clear>清除日期筛选</button>' : '')
    + '</div>'
    + '<div class="member-days">' + days + '</div>'
    + '<div class="tbl-wrap member-log-tbl"><table class="manager-tbl member-drill-tbl"><thead><tr>'
    + '<th class="num">日期</th><th>工作项</th><th>项目</th><th class="num">耗时</th>'
    + '</tr></thead><tbody>' + (logRowsHTML(shown) || '<tr><td colspan="4" class="manager-empty-cell">该时段暂无计时记录</td></tr>') + '</tbody></table></div>'
    + moreHTML("log", shown.length, dayLogs.length, "条");
}
function moreHTML(kind, shown, total, unit){
  if(shown >= total) return '';
  return '<div class="member-more"><button class="btn sm" type="button" data-member-' + kind + '-more>加载更多（已显示 ' + shown + ' / 共 ' + total + ' ' + unit + '）</button></div>';
}
function memberPageHTML(mv){
  var m = mv.m;
  var roles = Array.isArray(m.roleTitles) ? m.roleTitles : memberRoleTitles(m);
  return '<div class="member-page">'
    + '<button class="member-back" type="button" data-member-back>← 返回成员负载</button>'
    + '<header class="member-page-head"><div class="member-page-id">' + avatarHTML(m.name, "xl")
    + '<div><h2>' + esc(m.name) + memberStatusTag(mv.status) + '</h2>'
    + '<div class="member-page-meta">' + companyChipHTML(m.companyName) + jobTitleSpan(m.jobTitle, roles)
    + '<span>剩余 ' + fmtHours(m.loadRemainingMinutes) + (m.testRemainingMinutes ? '（含测试 ' + fmtHours(m.testRemainingMinutes) + '）' : '') + ' · ' + esc(periodLabel()) + ' ' + fmtHours(periodMinutes(m)) + '</span></div>'
    + '<div class="member-card-roles">' + memberRoleTagsHtml(roles, 6) + '</div></div></div>'
    + '<div class="member-page-actions"><button class="btn sm soft" type="button" data-member-export>' + icon("download", 13) + '导出该成员 CSV</button></div></header>'
    + memberKpisHTML(mv)
    + '<div class="manager-two-col"><section class="manager-panel">' + statePanelHTML(mv) + '</section>'
    + '<section class="manager-panel">' + projectsPanelHTML(mv) + '</section></div>'
    + '<section class="manager-panel" data-member-tasks-panel>' + tasksPanelHTML(mv) + '</section>'
    + '<section class="manager-panel" data-member-logs-panel>' + logsPanelHTML(mv) + '</section>'
    + '</div>';
}
function renderMemberPage(){
  var body = $("workloadBody"); if(!body) return;
  var m = memberByKey(memberUi.key);
  if(!m){ renderWorkload(); return; }
  var mv = memberView(m);
  body.setAttribute("aria-busy","false");
  body.innerHTML = memberPageHTML(mv);
  if(memberUi.focus){
    var focus = memberUi.focus;
    memberUi.focus = "";
    requestAnimationFrame(function(){
      var el = document.querySelector(focus === "logs" ? "[data-member-logs-panel]" : "[data-member-tasks-panel]");
      if(el && el.scrollIntoView) el.scrollIntoView({ block:"start", behavior:"smooth" });
    });
  }
}
function paintMemberTasks(){
  var m = memberByKey(memberUi.key); if(!m) return;
  var el = document.querySelector("[data-member-tasks-panel]");
  if(el) el.innerHTML = tasksPanelHTML(memberView(m));
  document.querySelectorAll("[data-member-project]").forEach(function(row){
    row.classList.toggle("on", !!memberUi.projectId && row.dataset.memberProject === memberUi.projectId);
  });
}
function paintMemberLogs(){
  var m = memberByKey(memberUi.key); if(!m) return;
  var el = document.querySelector("[data-member-logs-panel]");
  if(el) el.innerHTML = logsPanelHTML(memberView(m));
}

/* ==================== 路由：名册 ⇄ 成员工作台 ==================== */

function routeMemberKey(){
  try{
    if(!window.location) return "";
    var raw = String(window.location.hash || "").replace(/^#\/?/, "");
    var qi = raw.indexOf("?");
    if((qi >= 0 ? raw.substring(0, qi) : raw) !== "workload") return "";
    if(typeof URLSearchParams !== "function") return "";
    return new URLSearchParams(raw.substring(qi + 1)).get("member") || "";
  }catch(e){ return ""; }
}
function memberHash(key){ return "#/workload" + (key ? "?member=" + encodeURIComponent(key) : ""); }
function syncMemberHash(key, push){
  try{
    if(!window.location) return;
    var hash = memberHash(key);
    if(window.location.hash === hash) return;
    if(typeof history === "undefined"){ window.location.hash = hash; return; }
    if(push) history.pushState(null, "", hash); else history.replaceState(null, "", hash);
  }catch(e){ /* file:// 等环境忽略 */ }
}
function resetMemberUi(opts){
  opts = opts || {};
  memberUi.taskFilter = "all";
  memberUi.projectId = opts.projectId || "";
  memberUi.pub = "all";
  memberUi.taskShown = TASK_PAGE;
  memberUi.logScope = opts.logScope === "last" ? "last" : "week";
  memberUi.dayIdx = opts.dayIdx === undefined || opts.dayIdx === null ? "" : String(opts.dayIdx);
  memberUi.logShown = LOG_PAGE;
  memberUi.focus = opts.focus || "";
}
function openMemberPage(key, opts){
  var m = memberByKey(key);
  if(!m) return;
  memberUi.key = key;
  memberUi.openedHere = true;
  resetMemberUi(opts);
  renderMemberPage();
  syncMemberHash(key, true);
}
function closeMemberPage(){
  memberUi.key = "";
  if(memberUi.openedHere && typeof history !== "undefined" && history.length > 1){
    memberUi.openedHere = false;
    history.back();
    if(cache) renderWorkload();
    return;
  }
  memberUi.openedHere = false;
  syncMemberHash("", false);
  if(cache) renderWorkload();
}
function refreshFromHash(){
  var key = routeMemberKey();
  if(key === memberUi.key) return;
  if(key){
    var m = memberByKey(key);
    if(!m){ memberUi.key = ""; syncMemberHash("", false); if(cache) renderWorkload(); return; }
    memberUi.key = key;
    memberUi.openedHere = false;
    resetMemberUi({});
    renderMemberPage();
    return;
  }
  memberUi.key = "";
  memberUi.openedHere = false;
  if(cache) renderWorkload();
}

/* ==================== 导出 ==================== */

function exportWorkloadScope(){
  if(!cache || loading || filterWorkspace !== workloadWorkspace()) return;
  var range = periodRange(period);
  var rows = [["成员负载", workloadScopeText(cache)], ["统计日期", todayIso(), "工时区间", periodLabel(), range.from + " ~ " + range.to],
    ["本周开始", cache.weekStart || ""], [],
    ["成员","状态","公司","空间默认岗位","项目角色（主+兼岗）","未完成工作项","逾期","阻塞","剩余预估(h)","测试剩余(h)","容量(h)","负载","本周工时(h)","上周工时(h)","区间工时(h)"].concat(WEEK_DAY_NAMES.map(function(d){ return d + "(h)"; }))];
  var members = cache.members || [];
  members.forEach(function(m){
    var counts = taskCounts(m.tasks);
    rows.push([m.name,STATUS_META[memberStatus(m, counts)].label,m.companyName || "未设公司",m.jobTitle || "",(Array.isArray(m.roleTitles) ? m.roleTitles : memberRoleTitles(m)).join(" / "),counts.open,counts.overdue,counts.blocked,
      (Number(m.remainingMinutes) || 0) / 60,(Number(m.testRemainingMinutes) || 0) / 60,(Number(m.capacityMinutes) || 0) / 60,(m.loadPct || 0) + "%",(Number(m.weekMinutes) || 0) / 60,(Number(m.lastWeekMinutes) || 0) / 60,periodMinutes(m) / 60]
      .concat(WEEK_DAY_NAMES.map(function(_,i){ return (Number((m.dayMinutes || [])[i]) || 0) / 60; })));
  });
  rows.push([], ["成员","项目","项目角色","未完成工作项","剩余预估(h)","测试剩余(h)"]);
  members.forEach(function(m){ (m.projects || []).forEach(function(p){ rows.push([m.name,p.name,(Array.isArray(p.roleTitles) ? p.roleTitles : memberRoleTitles(p)).join(" / "),p.taskCount,(Number(p.remainingMinutes) || 0) / 60,(Number(p.testRemainingMinutes) || 0) / 60]); }); });
  rows.push([], ["成员","项目","工作项","状态","优先级","截止","预估(h)","实际(h)"]);
  members.forEach(function(m){ (m.tasks || []).forEach(function(t){ rows.push([m.name,t.reqName,t.title,taskStatusName(t),t.priority || "",fmtDate(t.dueDate),(Number(t.estimateMinutes) || 0) / 60,(Number(t.totalMinutes) || 0) / 60]); }); });
  rows.push([], ["计时成员","项目","工作项","日期","耗时(h)","时段"]);
  members.forEach(function(m){ ["weekLogs","lastWeekLogs"].forEach(function(key){ (m[key] || []).forEach(function(l){ rows.push([m.name,l.reqName,l.title,l.date,(Number(l.minutes) || 0) / 60,key === "weekLogs" ? "本周" : "上周"]); }); }); });
  downloadCsv("成员负载-" + todayIso() + ".csv", rows); toast("已导出当前筛选范围", "fs");
}
function exportMember(){
  if(!cache || loading || filterWorkspace !== workloadWorkspace()) return;
  var m = memberByKey(memberUi.key); if(!m) return;
  var mv = memberView(m), counts = mv.counts, range = periodRange(period);
  var rows = [["成员工作台", m.name], ["状态", STATUS_META[mv.status].label, "统计日期", todayIso()], ["筛选范围", workloadScopeText(cache)], [],
    ["工时区间", periodLabel(), range.from + " ~ " + range.to],
    ["公司", m.companyName || "未设公司", "岗位", m.jobTitle || "", "角色", (Array.isArray(m.roleTitles) ? m.roleTitles : memberRoleTitles(m)).join(" / ")],
    ["未完成工作项", counts.open, "进行中", counts.doing, "待处理", counts.backlog],
    ["逾期", counts.overdue, "阻塞", counts.blocked, "未填预估", counts.unestimated],
    ["剩余预估(h)", (Number(m.remainingMinutes) || 0) / 60, "测试剩余(h)", (Number(m.testRemainingMinutes) || 0) / 60, "容量(h)", (Number(m.capacityMinutes) || 0) / 60, "负载", (Number(m.loadPct) || 0) + "%"],
    ["本周工时(h)", (Number(m.weekMinutes) || 0) / 60, "上周工时(h)", (Number(m.lastWeekMinutes) || 0) / 60, "区间工时(h)", periodMinutes(m) / 60], [],
    ["参与项目","我的角色","未完成","剩余预估(h)","测试剩余(h)"]
  ];
  mv.projects.forEach(function(p){ rows.push([p.name, (p.roleTitles || []).join(" / "), p.taskCount, (Number(p.remainingMinutes) || 0) / 60, (Number(p.testRemainingMinutes) || 0) / 60]); });
  rows.push([], ["工作项","项目","状态","优先级","发布","截止","预估(h)","已计(h)"]);
  (m.tasks || []).forEach(function(t){ rows.push([t.title,t.reqName,taskStatusName(t),t.priority || "",taskPublicationText(t),fmtDate(t.dueDate),(Number(t.estimateMinutes) || 0) / 60,(Number(t.totalMinutes) || 0) / 60]); });
  rows.push([], ["计时日期","工作项","项目","耗时(h)","时段"]);
  ["weekLogs","lastWeekLogs"].forEach(function(key){ (m[key] || []).forEach(function(l){ rows.push([l.date,l.title,l.reqName,(Number(l.minutes) || 0) / 60,key === "weekLogs" ? "本周" : "上周"]); }); });
  downloadCsv("成员工作台-" + m.name + ".csv", rows); toast("已导出该成员的工作台数据", "fs");
}

/* ==================== 渲染与交互 ==================== */

/* 每日容量按成员自己的计时设置折算，顶层 capacityMinutesPerDay 只是未设置时的默认值 */
function capacityHoursLabel(data){
  var perDay = Number(data && data.capacityMinutesPerDay) || 480;
  return (Math.round(perDay / 6) / 10) + "h";
}
function maxWorkdaysLabel(data){
  return Number(data && data.maxWorkdays) || 22;
}
function renderWorkload(){
  if(!cache || loading || filterWorkspace !== workloadWorkspace()) return;
  if(memberUi.key){ renderMemberPage(); return; }
  var focusKey = document.activeElement && document.activeElement.dataset.workloadFilter;
  $("workloadBody").innerHTML = workloadToolbar()
    + caliberHTML('负载 =（开发剩余 + 测试剩余）÷（容量窗口工作日 × 每日容量）；测试剩余 = max(0, 测试预估 − 测试窗口内已计工时)，并入成员总负载。每日容量取成员自己的计时设置（未设置按 ' + capacityHoursLabel(cache) + '），无截止日按 5 个工作日计，窗口上限 ' + maxWorkdaysLabel(cache) + ' 个工作日（约一个月）。窗口只决定容量，与实际截止日分开看。')
    + (viewMode === 'week'
      ? weekTable()
      : '<div id="memberRoster" class="member-roster">' + rosterHTML() + '</div>');
  if(focusKey){ var field = document.querySelector('[data-workload-filter="' + focusKey + '"]'); if(field) field.focus(); }
}
function syncModeButtons(){
  var body = $("workloadBody");
  if(!body) return;
  body.querySelectorAll("[data-load-mode]").forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.loadMode === viewMode); });
}
function setViewMode(mode){
  if(mode !== "person" && mode !== "week") return;
  viewMode = mode; savePrefs(); renderWorkload();
}
function resetMemberFilters(){
  ui.q = ""; ui.status = ""; ui.shown = LIST_PAGE;
  workloadFilter = { reqId:"", roleTitle:"", companyName:"" };
  loadWorkload();
}

if($("workloadBody")) $("workloadBody").addEventListener("click", function(e){
  var back = e.target.closest("[data-member-back]");
  if(back){ closeMemberPage(); return; }
  var modeBtn = e.target.closest("[data-load-mode]");
  if(modeBtn && cache && !loading){ setViewMode(modeBtn.dataset.loadMode); return; }
  var periodBtn = e.target.closest("[data-wl-period]");
  if(periodBtn){
    if(periodBtn.dataset.wlPeriod !== period){
      period = periodBtn.dataset.wlPeriod; savePrefs(); loadWorkload();
    }
    return;
  }
  if(e.target.closest("[data-workload-clear]")){ resetMemberFilters(); return; }
  if(e.target.closest("[data-member-reset]")){ ui.q = ""; ui.status = ""; ui.shown = LIST_PAGE; renderRosterOnly(); return; }
  if(e.target.closest("[data-load-export]")){ exportWorkloadScope(); return; }
  if(e.target.closest("[data-empty-action]")){ loadWorkload(); return; }
  if(e.target.closest("[data-member-export]")){ exportMember(); return; }

  var statusChip = e.target.closest("[data-member-status]");
  if(statusChip){ ui.status = ui.status === statusChip.dataset.memberStatus ? "" : statusChip.dataset.memberStatus; ui.shown = LIST_PAGE; renderRosterOnly(); return; }
  var more = e.target.closest("[data-member-more]");
  if(more){ ui.shown += LIST_PAGE; renderRosterOnly(); return; }
  var taskFilter = e.target.closest("[data-member-task-filter]");
  if(taskFilter){ memberUi.taskFilter = taskFilter.dataset.memberTaskFilter; memberUi.taskShown = TASK_PAGE; paintMemberTasks(); return; }
  var logScope = e.target.closest("[data-member-log-scope]");
  if(logScope){ memberUi.logScope = logScope.dataset.memberLogScope === "last" ? "last" : "week"; memberUi.dayIdx = ""; memberUi.logShown = LOG_PAGE; paintMemberLogs(); return; }
  var day = e.target.closest("[data-member-day]");
  if(day){ memberUi.dayIdx = memberUi.dayIdx === day.dataset.memberDay ? "" : day.dataset.memberDay; memberUi.logShown = LOG_PAGE; paintMemberLogs(); return; }
  if(e.target.closest("[data-member-day-clear]")){ memberUi.dayIdx = ""; memberUi.logShown = LOG_PAGE; paintMemberLogs(); return; }
  var dayMore = e.target.closest("[data-member-log-more]");
  if(dayMore){ memberUi.logShown += LOG_PAGE; paintMemberLogs(); return; }
  var taskMore = e.target.closest("[data-member-task-more]");
  if(taskMore){ memberUi.taskShown += TASK_PAGE; paintMemberTasks(); return; }
  if(e.target.closest("[data-member-project-clear]")){ memberUi.projectId = ""; memberUi.taskFilter = "all"; memberUi.taskShown = TASK_PAGE; paintMemberTasks(); return; }

  var proj = e.target.closest("[data-member-project]");
  if(proj){ memberUi.projectId = proj.dataset.memberProject || ""; memberUi.taskFilter = "all"; memberUi.taskShown = TASK_PAGE; paintMemberTasks(); return; }
  var task = e.target.closest("[data-open-task]");
  if(task){ openTaskById(task.dataset.openTask); return; }

  var opener = e.target.closest("[data-member-open]");
  if(opener && cache && !loading && filterWorkspace === workloadWorkspace()){
    openMemberPage(opener.dataset.memberOpen, {
      logScope: opener.dataset.memberScope === "last" ? "last" : "week",
      dayIdx: opener.dataset.memberDay === undefined ? "" : opener.dataset.memberDay,
      focus: opener.dataset.memberLayer === "logs" ? "logs" : ""
    });
  }
});

if($("workloadBody")) $("workloadBody").addEventListener("change", function(e){
  var field = e.target.closest("[data-workload-filter]");
  if(field){
    var key = field.dataset.workloadFilter;
    if(["reqId","companyName","roleTitle"].indexOf(key) === -1) return;
    workloadFilter[key] = field.value; loadWorkload();
    var next = document.querySelector('[data-workload-filter="' + key + '"]'); if(next) next.focus();
    return;
  }
  if(e.target.closest("[data-wl-group]")){
    ui.group = e.target.value; ui.shown = LIST_PAGE; savePrefs();
    renderWorkload();
    return;
  }
  if(e.target.closest("[data-wl-sort]")){
    ui.sort = e.target.value; savePrefs();
    renderRosterOnly();
    return;
  }
  if(e.target.closest("[data-member-task-project]")){
    memberUi.projectId = e.target.value; memberUi.taskFilter = "all"; memberUi.taskShown = TASK_PAGE;
    paintMemberTasks();
    return;
  }
  if(e.target.closest("[data-member-task-pub]")){
    var pub = e.target.value;
    memberUi.pub = pub === "published" || pub === "unpublished" ? pub : "all";
    memberUi.taskShown = TASK_PAGE;
    paintMemberTasks();
  }
});

if($("workloadBody")) $("workloadBody").addEventListener("input", function(e){
  var search = e.target.closest("[data-member-search]");
  if(!search) return;
  ui.q = search.value; ui.shown = LIST_PAGE;
  renderRosterOnly();
});

if($("workloadBody")) $("workloadBody").addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var target = e.target.closest("[data-member-open],[data-open-task],[data-member-project]");
  if(!target || e.target !== target) return;
  e.preventDefault();
  target.click();
});

window.addEventListener("hashchange", function(){
  if(document.body.dataset.view === "workload") refreshFromHash();
});

export { enterWorkloadView, loadWorkload, refreshFromHash };
