/* views/mine · 我的工作（分页 + 分组 + 行内操作） */

import { API } from "../core/api.js";
import { btnMineFields, btnMineFold, btnMineRefresh, mineBody, mineDensity, mineGroup, mineMeta, mineSort, mineSpaceFilter, mineStats, mineSubgroup } from "../core/dom.js";
import { clearFilters } from "../core/filters-ui.js";
import { filterParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import * as listPrefs from "../core/list-preferences.js";
import { currentMode, saveMode } from "../core/mobile-rules.js";
import { loadPrioritySpaces } from "../core/priorities.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { canEditTask, catColor, catNameById, dueDateMD, dueDateTip, dueFlag, dueState, progressOf, rt, state, statusBucket, timerAllowed } from "../core/state.js";
import { loadRunningTimer, openTaskById } from "../core/task-actions.js";
import { guard, serverDecision } from "../core/transitions.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, COLUMNS, PRIORITIES, addDays, colMeta, colName, duePresetDate, fmtFull, fmtMinutesShort, fmtShortMD, iso, parseDate, priName, priTagHTML, typeBadgeHTML, typeName, weekdayCN } from "../lib/format.js";
import { loadBoard } from "./board.js";
import { refreshCalendarIfOpen } from "./calendar.js";
import { openTaskTable } from "./manager-shared.js";

function wsNameById(id){
  for(var i = 0; i < rt.allWorkspaces.length; i++) if(rt.allWorkspaces[i].id === id) return rt.allWorkspaces[i].name;
  return "该空间";
}
function askSwitchWorkspace(wsId, wsName, opts){
  opts = opts || {};
  var target = wsName || wsNameById(wsId);
  var msg = opts.taskTitle
    ? ('即将切换到「' + esc(target) + '」并打开工作项「' + esc(opts.taskTitle) + '」。<br><br>' +
       '当前空间的筛选条件、抽屉里未保存的编辑都不会保留。')
    : opts.linkTitle
      ? ('即将切换到「' + esc(target) + '」并打开通知关联内容「' + esc(opts.linkTitle) + '」。<br><br>' +
         '当前空间的筛选条件、抽屉里未保存的编辑都不会保留。')
      : ('切换到「' + esc(target) + '」会重新加载页面。<br><br>' +
         '当前空间的筛选条件、抽屉里未保存的编辑都不会保留。');
  return UI.showConfirm({
    title: opts.title || "切换空间",
    msg: msg,
    okText: "切换",
    cancelText: "取消",
    danger: false
  }).then(function(ok){
    if(!ok) return false;
    return API.post("/api/workspaces/" + encodeURIComponent(wsId) + "/select", {}).then(function(){
      if(opts.openTaskId){
        try{ sessionStorage.setItem("ds.openTask", opts.openTaskId); }catch(e){ /* noop */ }
      }
      if(opts.openLink && opts.openLink.kind && opts.openLink.id){
        try{ sessionStorage.setItem("ds.openNoticeLink", JSON.stringify(opts.openLink)); }catch(e){ /* noop */ }
      }
      window.location.reload();
      return true;
    }).catch(function(ex){
      toast(ex.message || "切换空间失败", "bad");
      return false;
    });
  });
}
function enterMineView(){
  syncMineFilters();
  if(isMobile() && currentMineMode() === "team"){ renderTeam(); return; }
  loadMine();
}
function mineFiltered(items){
  return (items || []).filter(function(t){
    if(state.mineSpace && t.workspaceId !== state.mineSpace) return false;
    return true;
  });
}
function mineFiltering(){ return !!state.mineSpace; }
function syncMineFilters(){
  /* 统一筛选由顶栏 FilterBar 显示；页内只同步分组/排序/空间控件 */
  if(mineGroup) mineGroup.value = MINE_GROUP_DIMS.indexOf(state.mineGroup) !== -1 ? state.mineGroup : "due";
  if(mineSubgroup){
    mineSubgroup.value = MINE_GROUP_DIMS.indexOf(state.mineSubgroup) !== -1 ? state.mineSubgroup : "none";
    mineSubgroup.disabled = state.mineGroup === "none";
  }
  if(mineSort) mineSort.value = MINE_SORTS.indexOf(state.mineSort) !== -1 ? state.mineSort : "default";
  syncMineFilterMarks();
}
/* 筛选生效态：偏离默认值才标记，默认值与 state.js 首屏一致、不发光 */
function syncMineFilterMarks(){
  [[mineGroup, "due"], [mineSubgroup, "none"], [mineSort, "default"], [mineSpaceFilter, ""]]
    .forEach(function(pair){
      var el = pair[0];
      if(el) UI.markFiltered(el, el.value === pair[1]);
    });
}
function populateMineSpaces(spaces){
  if(!mineSpaceFilter) return;
  var cur = state.mineSpace || "";
  var html = '<option value="">全部空间</option>' + (spaces || []).map(function(s){
    return '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
  }).join("");
  if(mineSpaceFilter.innerHTML !== html) mineSpaceFilter.innerHTML = html;
  mineSpaceFilter.value = cur;
  if(mineSpaceFilter.value !== cur){
    state.mineSpace = "";
    mineSpaceFilter.value = "";
  }
  syncMineFilterMarks();
}
var mineCache = {};
var mineAll = [], mineSpaces = [], mineNameOnly = 0, mineTotal = 0, mineHasMore = false;
var MINE_PAGE_SIZE = 100;
var mineLoading = false, mineSeq = 0;
function rerenderMine(){
  renderMine({items: mineAll, spaces: mineSpaces, matchedByNameOnly: mineNameOnly,
    total: mineTotal, hasMore: mineHasMore}, false);
}
function loadMine(opts){
  opts = opts || {};
  if(!mineBody) return;
  /* 团队模式下搜索/筛选仍可能走到这里：不要用 my-tasks 骨架覆盖团队面板 */
  if(isMobile() && currentMineMode() === "team"){ renderTeam({silent:true}); return; }
  var append = !!opts.append;
  /* 只有「加载更多」需要排队；筛选/搜索变化必须作废在途请求（seq 丢弃旧响应），否则新条件被吞掉 */
  if(mineLoading && append) return;
  mineLoading = true;
  var seq = ++mineSeq;
  var offset = append ? mineAll.length : 0;
  var btn = mineBody.querySelector("[data-mine-more]");
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  if(!opts.silent && !append){
    mineBody.innerHTML = UI.skeletonRows(6);
    if(mineMeta) mineMeta.textContent = "加载中…";
  }
  /* 完成情况=已完成时 scope 必须是 all，否则 openOnly 与 completion=done 叠加后恒为空 */
  var scope = state.completion === "done" ? "all" : "open";
  var params = filterParams({scope: scope, offset: offset, limit: MINE_PAGE_SIZE});
  delete params.owners;      // 负责人维度天然是我
  /* 显示列偏好先就位再渲染，避免首屏按默认列闪一帧 */
  listPrefs.load("my-tasks").then(function(){
    if(seq !== mineSeq) return;
    return API.getGlobal("/api/my-tasks", params).then(function(d){
      if(seq !== mineSeq) return;
      return loadPrioritySpaces(d && d.spaces).then(function(){
        if(seq !== mineSeq) return;
        mineLoading = false;
        renderMine(d || {}, append);
      });
    });
  }).catch(function(ex){
    if(seq !== mineSeq) return;
    mineLoading = false;
    if(append){
      toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
      if(btn){ btn.disabled = false; btn.textContent = "加载更多"; }
      return;
    }
    if(mineMeta) mineMeta.textContent = "";
    mineBody.innerHTML = UI.errorState(ex.message);
    bindRetry(mineBody, function(){ loadMine(); });
  });
}
function mineGroupOf(t){
  var st = dueState(t);
  if(st.kind === "over") return "over";
  if(st.kind === "today") return "today";
  if(st.kind === "ended") return "ended";
  if(st.kind === "none") return "later";
  var dow = (rt.TODAY.getDay() + 6) % 7;             // 周一=0
  var weekEnd = addDays(rt.TODAY, 6 - dow);
  return parseDate(t.dueDate) <= weekEnd ? "week" : "later";
}
var MINE_GROUPS = [
  {k:"over", label:"逾期", hint:"先处理已经拖过期的", tone:"danger"},
  {k:"today", label:"今天", hint:"今天到期", tone:"warning"},
  {k:"week", label:"本周", hint:"本周内到期", tone:"info"},
  {k:"ended", label:"执行结束", hint:"所在列已结束计时，不计逾期", tone:"success"},
  {k:"later", label:"以后", hint:"本周之后或未设截止", tone:"neutral"}
];

/* ---- 排序 / 分组（页内工具栏，state.mineSort / state.mineGroup） ---- */
var MINE_SORTS = ["default", "due", "priority", "updated", "title"];
var MINE_SORT_DESC = {updated:true};
var MINE_GROUP_DIMS = ["due", "workspace", "priority", "status", "project", "category", "none"];
function mineSortValue(t, key){
  if(key === "title") return String(t.title || "");
  if(key === "priority"){ var pi = PRIORITIES.indexOf(t.priority); return pi < 0 ? 9 : pi; }
  if(key === "due") return t.dueDate || null;
  if(key === "updated") return t.updatedAt || null;
  return "";
}
function mineCompare(a, b){
  var key = state.mineSort;
  if(MINE_SORTS.indexOf(key) === -1 || key === "default") return 0;
  var x = mineSortValue(a, key), y = mineSortValue(b, key);
  /* 空值（未填截止/更新时间）任何方向都排最后 */
  if(x === null && y === null) return 0;
  if(x === null) return 1;
  if(y === null) return -1;
  var r = (typeof x === "number" && typeof y === "number")
    ? x - y
    : String(x).localeCompare(String(y), "zh-Hans-CN");
  return MINE_SORT_DESC[key] ? -r : r;
}
function mineSortRows(rows){
  if(state.mineSort === "default") return rows;
  return rows.slice().sort(mineCompare);
}
function mineDueInfo(k){
  for(var i = 0; i < MINE_GROUPS.length; i++) if(MINE_GROUPS[i].k === k) return MINE_GROUPS[i];
  return MINE_GROUPS[MINE_GROUPS.length - 1];
}
function mineSectionInfoBy(t, dim){
  if(dim === "due"){
    var g = mineDueInfo(mineGroupOf(t));
    return {key:g.k, label:g.label, hint:g.hint, tone:g.tone, order:MINE_GROUPS.indexOf(g)};
  }
  if(dim === "workspace") return {key:t.workspaceId || "__none", label:t.workspaceName || "未知空间", tone:"neutral"};
  if(dim === "priority"){
    var pri = t.priority || "";
    return {key:pri || "__none", label:pri ? priName(pri, t.workspaceId) : "未设置优先级", pri:pri,
      tone: pri === "P0" ? "danger" : (pri === "P1" ? "warning" : (pri === "P2" ? "info" : "neutral"))};
  }
  if(dim === "status"){
    var col = t.boardColumn || "__none";
    return {key:col, label:colName(t.boardColumn) || "未设置状态", tone:mineStatusTone(col, t)};
  }
  if(dim === "project") return {key:t.reqId || "__none", label:t.reqName || (t.reqId ? "未知项目" : "无项目"), tone:"neutral"};
  if(dim === "category") return {key:t.categoryId || "__none", label:catNameById(t.categoryId) || "未指定模块", tone:"neutral"};
  return null;
}
function mineStatusTone(col, task){
  if(!col || col === "__none") return "neutral";
  var b = statusBucket(task || {boardColumn: col});
  if(b === "backlog") return "neutral";
  if(b === "done" || b === "ended") return "success";
  return "info";
}
function mineSectionCompareBy(a, b, dim){
  if(dim === "due") return (a.order === undefined ? 99 : a.order) - (b.order === undefined ? 99 : b.order);
  if(dim === "category"){
    var order = {};
    (rt.categoriesCache || []).forEach(function(c, i){ order[c.id] = i; });
    var ai = order[a.key] === undefined ? 999 : order[a.key];
    var bi = order[b.key] === undefined ? 999 : order[b.key];
    return ai - bi || a.label.localeCompare(b.label, "zh-Hans-CN");
  }
  if(dim === "priority"){
    return (PRIORITIES.indexOf(a.pri) < 0 ? 9 : PRIORITIES.indexOf(a.pri)) -
      (PRIORITIES.indexOf(b.pri) < 0 ? 9 : PRIORITIES.indexOf(b.pri));
  }
  if(dim === "status"){
    var si = -1, ti = -1;
    COLUMNS.forEach(function(c, i){ if(c.id === a.key) si = i; if(c.id === b.key) ti = i; });
    return (si < 0 ? 99 : si) - (ti < 0 ? 99 : ti);
  }
  return a.label.localeCompare(b.label, "zh-Hans-CN");
}
/* 二级维度不能与一级重复；一级不分组时二级无意义 */
function mineSubDim(){
  return (state.mineGroup === "none" || state.mineSubgroup === "none" || state.mineSubgroup === state.mineGroup)
    ? "none" : state.mineSubgroup;
}
function mineSections(items){
  if(state.mineGroup === "none"){
    return [{key:"all", label:"", rows:mineSortRows(items), subs:[]}];
  }
  var subDim = mineSubDim();
  var sections;
  if(state.mineGroup === "due"){
    var byDue = {};
    MINE_GROUPS.forEach(function(g){ byDue[g.k] = []; });
    items.forEach(function(t){ byDue[mineGroupOf(t)].push(t); });
    sections = MINE_GROUPS.map(function(g){
      return {key:g.k, label:g.label, hint:g.hint, tone:g.tone, order:MINE_GROUPS.indexOf(g), rows:byDue[g.k], subs:[]};
    });
  }else{
    var map = {}, order = [];
    items.forEach(function(t){
      var info = mineSectionInfoBy(t, state.mineGroup);
      if(!info) return;
      var sec = map[info.key];
      if(!sec){
        sec = map[info.key] = {key:info.key, label:info.label, pri:info.pri || "", hint:info.hint || "", tone:info.tone || "neutral", order:info.order, rows:[], subs:[]};
        order.push(info.key);
      }
      sec.rows.push(t);
    });
    sections = order.map(function(k){ return map[k]; });
    sections.sort(function(a, b){ return mineSectionCompareBy(a, b, state.mineGroup); });
  }
  sections.forEach(function(s){ s.rows = mineSortRows(s.rows); });
  if(subDim !== "none"){
    sections.forEach(function(s){
      var subMap = {}, subOrder = [];
      s.rows.forEach(function(t){
        var info = mineSectionInfoBy(t, subDim);
        if(!info) return;
        var sub = subMap[info.key];
        if(!sub){
          sub = subMap[info.key] = {key:info.key, label:info.label, pri:info.pri || "", hint:info.hint || "", order:info.order, rows:[]};
          subOrder.push(info.key);
        }
        sub.rows.push(t);
      });
      s.subs = subOrder.map(function(k){ return subMap[k]; });
      s.subs.sort(function(a, b){ return mineSectionCompareBy(a, b, subDim); });
      s.subs.forEach(function(sub){ sub.rows = mineSortRows(sub.rows); });
    });
  }
  return sections;
}
/* ---- 列表形态：列 / 密度 / 折叠（与缺陷列表优化后同一套两行行高） ---- */
var MINE_COLS = [
  {k:"title", label:"工作项", w:"minmax(300px,2fr)"},
  {k:"type", label:"类型", w:"64px"},
  {k:"priority", label:"优先级", w:"64px"},
  {k:"status", label:"状态", w:"88px"},
  {k:"dueDate", label:"截止", w:"96px"},
  {k:"startDate", label:"开始", w:"88px"},
  {k:"progress", label:"进度", w:"96px"},
  {k:"work", label:"工时", w:"76px"},
  {k:"project", label:"项目", w:"minmax(140px,1fr)"},
  {k:"updatedAt", label:"更新", w:"76px", align:"right"}
];
var MINE_OPS_W = "76px";
var MINE_DENSITY_KEY = "ds.mineDensity";
var MINE_CLOSED_KEY = "ds.mineClosed";
function mineDensityValue(){
  try{ return localStorage.getItem(MINE_DENSITY_KEY) === "relaxed" ? "relaxed" : "standard"; }
  catch(e){ return "standard"; }
}
var mineClosed = (function(){
  try{
    var raw = JSON.parse(localStorage.getItem(MINE_CLOSED_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  }catch(e){ return {}; }
})();
function mineSaveClosed(){
  try{ localStorage.setItem(MINE_CLOSED_KEY, JSON.stringify(mineClosed)); }catch(e){ /* 受限环境仅本次生效 */ }
}
function mineGroupKey(dim, key){ return "g|" + dim + "|" + key; }
function mineSubKey(dim, gkey, sdim, skey){ return "s|" + dim + "|" + gkey + "|" + sdim + "|" + skey; }
/* 与分组维度相同的列自动隐藏，避免同一信息出现两次 */
function mineDimUsed(dim){ return state.mineGroup === dim || mineSubDim() === dim; }
function mineWidthHidden(k, w){
  if(k === "project") return w < 1180;
  if(k === "startDate") return w < 1080;
  if(k === "work") return w < 1000;
  if(k === "updatedAt") return w < 1000;
  if(k === "progress") return w < 840;
  return false;
}
function mineVisibleCols(w){
  var prefs = listPrefs.columns("my-tasks");
  var byKey = {};
  MINE_COLS.forEach(function(c){ byKey[c.k] = c; });
  /* 列顺序跟随「显示字段」里的排序，工作项始终在首列 */
  return prefs.filter(function(k){ return byKey[k]; }).map(function(k){ return byKey[k]; }).filter(function(c){
    if(c.k === "priority" && mineDimUsed("priority")) return false;
    if(c.k === "status" && mineDimUsed("status")) return false;
    if(c.k === "dueDate" && mineDimUsed("due")) return false;
    if(c.k === "project" && mineDimUsed("project")) return false;
    return !mineWidthHidden(c.k, w);
  });
}
function mineRelText(v){
  if(!v) return "—";
  var s = String(v).replace(" ", "T");
  var d = new Date(s);
  if(isNaN(d.getTime())) return String(v).substring(0, 10);
  var diff = Math.max(0, Date.now() - d.getTime());
  var min = Math.floor(diff / 60000);
  if(min < 1) return "刚刚";
  if(min < 60) return min + " 分钟前";
  var hr = Math.floor(min / 60);
  if(hr < 24) return hr + " 小时前";
  var day = Math.floor(hr / 24);
  if(day === 1) return "昨天";
  if(day < 7) return day + " 天前";
  return fmtShortMD(parseDate(s));
}
function mineTaskCell(t, cols){
  var cat = catNameById(t.categoryId);
  var colSet = {};
  (cols || []).forEach(function(c){ colSet[c.k] = true; });
  var sub = [];
  if(!mineDimUsed("project") && !colSet.project && t.reqName){
    sub.push('<span class="mine-proj-chip" title="项目：' + esc(t.reqName) + '">' + esc(t.reqName) + '</span>');
  }
  if(!mineDimUsed("workspace") && t.workspaceName){
    sub.push('<span class="mine-sub-ws" title="空间：' + esc(t.workspaceName) + '">' + esc(t.workspaceName) + '</span>');
  }
  if(!mineDimUsed("category") && cat){
    sub.push('<span class="mine-r-cat" style="--c:' + catColor(t.categoryId) + '"><i></i>' + esc(cat) + '</span>');
  }
  /* 模块已在副行用彩色点表达，同名标签不再重复占位 */
  (t.tags || []).filter(function(n){ return n && n !== cat; }).slice(0, 2).forEach(function(n){
    sub.push('<span class="mine-r-tag">' + esc(n) + '</span>');
  });
  if(t.blocked) sub.push('<span class="mine-r-blocked">被阻塞</span>');
  return '<span class="mine-tc-main">' +
    '<span class="mine-tc-title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
    (sub.length ? '<span class="mine-tc-sub">' + sub.join("") + '</span>' : '') +
  '</span>';
}
function minePriPill(t){
  var p = t.priority || "";
  var name = p ? priName(p, t.workspaceId) : "未设置";
  return '<span class="mine-pri-pill ' + (p ? p.toLowerCase() : "p3") + '" title="优先级：' + esc(name) + '">' + esc(name) + '</span>';
}
function mineStatusPill(t){
  var b = statusBucket(t);
  var cls = (b === "done" || b === "ended") ? "done" : (b === "doing" ? "doing" : "todo");
  var f = dueFlag(t);
  var flagHTML = f ? ' <span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>' : "";
  return '<span class="mine-st-pill ' + cls + '">' + esc(colName(t.boardColumn) || "未设置") + '</span>' + flagHTML;
}
function mineRowHTML(t, cols){
  var st = dueState(t);
  var p = progressOf(t);
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 跨空间任务的可写性由后端下发；只读项目只保留「停止计时」这一条合法入口 */
  var editable = canEditTask(t);
  /* 待处理/已完成列不能计时（与后端 startManual 同口径）：不渲染这个不可用入口 */
  var tAllowed = timerAllowed(t);
  var isDone = t.boardColumn === "done";
  var dueCls = (!t.dueDate || isDone || st.kind === "ended") ? "muted" : "";
  return '<div class="list-row" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    mineRowCells(t, dueCls, p, cols) +
    '<span class="mine-acts">' +
      ((editable && !isDone) ? '<button class="icon-btn sm" type="button" data-mine-done title="标记完成" aria-label="标记完成">' + icon("check", 14) + '</button>' : '') +
      ((running || (editable && tAllowed)) ? '<button class="icon-btn sm' + (running ? " on" : "") + '" type="button" data-mine-timer' +
        ' title="' + (running ? "停止计时" : "开始计时") + '"' +
        ' aria-label="开始或停止计时">' + icon(running ? "pause" : "clock", 14) + '</button>' : '') +
      (editable ? '<button class="icon-btn sm" type="button" data-mine-due title="改期" aria-label="改期">' + icon("calendar", 14) + '</button>' : '') +
    '</span>' +
  '</div>';
}
function mineRowCells(t, dueCls, p, cols){
  return cols.map(function(c){
    if(c.k === "title") return mineTaskCell(t, cols);
    if(c.k === "type"){
      var badge = typeBadgeHTML(t.itemType);
      return '<span class="cell">' + (badge || esc(typeName(t.itemType))) + '</span>';
    }
    if(c.k === "priority") return minePriPill(t);
    if(c.k === "status") return mineStatusPill(t);
    if(c.k === "dueDate") return '<span class="cell ' + dueCls + '" title="' + esc(dueDateTip(t)) + '">' + (t.dueDate ? esc(dueDateMD(t)) : "—") + '</span>';
    if(c.k === "startDate") return '<span class="cell muted">' + (t.startDate ? esc(fmtShortMD(parseDate(t.startDate))) : "—") + '</span>';
    if(c.k === "progress"){
      /* 未开始且进度为 0 时不画空进度条，避免零信息量的灰槽 */
      if(p <= 0 && t.boardColumn !== "doing") return '<span class="cell muted">—</span>';
      return '<span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span>';
    }
    if(c.k === "work") return '<span class="cell">' + esc(fmtMinutesShort(t.totalMinutes)) + '</span>';
    if(c.k === "project"){
      return '<span class="cell" title="' + esc(t.reqName || "未关联项目") + '">' + esc(t.reqName || "—") + '</span>';
    }
    if(c.k === "updatedAt"){
      var rel = mineRelText(t.updatedAt);
      var upd = parseDate(t.updatedAt);
      var updTip = upd ? (fmtFull(upd) + " " + weekdayCN(upd)) : rel;
      return '<span class="cell muted ta-r mine-upd" title="最近更新：' + esc(updTip) + '">' + esc(rel) + '</span>';
    }
    return "";
  }).join("");
}
var mineMeasuredWidth = 0;
function mineListWidth(){
  if(mineBody && mineBody.clientWidth) mineMeasuredWidth = mineBody.clientWidth;
  return mineMeasuredWidth || window.innerWidth;
}
var mineModeEl = document.getElementById("mineMode");
var teamSeq = 0;
var teamLoading = false;
var teamQueued = false;

function currentMineMode(){
  var ws = rt.currentWs;
  return currentMode(ws ? ws.id : "", ws && ws.myRole);
}
function syncMineModeUI(){
  if(!mineModeEl) return;
  var mode = currentMineMode();
  mineModeEl.querySelectorAll("[data-mine-mode]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.mineMode === mode));
  });
  document.body.classList.toggle("mine-team", isMobile() && mode === "team");
}
function setMineMode(mode){
  var ws = rt.currentWs;
  saveMode(ws ? ws.id : "", mode);
  syncMineModeUI();
  if(mode === "team"){ renderTeam(); return; }
  if(!mineAll.length) loadMine(); else rerenderMine();
}
function hm(minutes){
  var h = (Number(minutes) || 0) / 60;
  return (Math.round(h * 10) / 10) + "h";
}
/* 团队视图统计区间：区间只作用于完成率、工时、环比这类统计量；
   待办（待评审/待验收/待合并）与风险始终是「此刻」的快照，见 renderTeam 里的「截止此刻」标注。 */
var TEAM_RANGE_KEYS = ["week", "month", "days30"];
var TEAM_RANGE_LABELS = {week: "本周", month: "本月", days30: "近 30 天"};
function teamRangeKey(){
  var k = null;
  try{ k = localStorage.getItem("ds.teamRange"); }catch(e){ /* 受限环境回落本周 */ }
  return TEAM_RANGE_KEYS.indexOf(k) >= 0 ? k : "week";
}
function teamRange(){
  var key = teamRangeKey(), t = rt.TODAY, from, to;
  if(key === "month"){
    from = new Date(t.getFullYear(), t.getMonth(), 1);
    to = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  }else if(key === "days30"){
    to = t;
    from = addDays(t, -29);
  }else{
    var dow = (t.getDay() + 6) % 7;
    from = addDays(t, -dow);
    to = addDays(from, 6);
  }
  return {key: key, label: TEAM_RANGE_LABELS[key], from: iso(from), to: iso(to)};
}
function teamRangeBarHTML(range){
  return '<div class="team-range" role="group" aria-label="统计区间">'
    + TEAM_RANGE_KEYS.map(function(k){
        return '<button type="button" class="tr-btn' + (k === range.key ? " on" : "") + '" data-team-range="' + k + '"'
          + ' aria-pressed="' + (k === range.key) + '">' + TEAM_RANGE_LABELS[k] + '</button>';
      }).join("")
    + '<span class="tr-dates">' + esc(range.from) + ' ~ ' + esc(range.to) + '</span>'
    + '</div>';
}
function withReqNames(items){
  return (items || []).map(function(t){
    if(!t.reqName && t.reqId){
      var hit = rt.reqList.filter(function(r){ return r.id === t.reqId; })[0];
      if(hit) t.reqName = hit.name;
    }
    return t;
  });
}
function teamTaskPage(params, offset){
  return API.get("/api/tasks/list", Object.assign({}, params, { offset: offset || 0, limit: 100 }))
    .then(function(page){
      if(page && page.items) withReqNames(page.items);
      return page;
    });
}
function openTeamTaskTable(title, params, errMsg){
  teamTaskPage(params, 0).then(function(page){
    openTaskTable(title, (page && page.items) || [],
      "团队视图 · 点击工作项行打开详情", {
        total: (page && page.total) || 0,
        hasMore: !!(page && page.hasMore),
        fetch: function(offset){ return teamTaskPage(params, offset); }
      });
  }).catch(function(err){ toast(err && err.message ? err.message : errMsg, "bad"); });
}
function openTeamRiskTasks(kind){
  var blocked = kind === "blocked";
  openTeamTaskTable(blocked ? "被阻塞工作项" : "逾期工作项",
    blocked ? { blocked: true } : { due: "over" }, "工作项加载失败");
}
function openMemberTasks(name){
  openTeamTaskTable(name + " · 未完成工作项", { owners: name, open: 1 }, "工作项加载失败");
}
function teamSectionError(err, title){
  if(err && err.code === 4030){
    return UI.noPermState({ title: title || "当前角色无权查看", desc: "该区块仅对空间管理员开放，请联系空间主调整成员角色。" });
  }
  return UI.errorState(err && err.message ? err.message : "网络异常，请稍后重试");
}
function renderTeam(opts){
  opts = opts || {};
  syncMineModeUI();
  if(mineStats) mineStats.innerHTML = "";
  var mineView = document.getElementById("view-mine");
  if(mineView){ mineView.classList.remove("is-empty"); mineView.classList.add("is-team"); }
  var range = teamRange();
  if(mineMeta) mineMeta.textContent = "团队视图 · " + range.label;
  if(!mineBody) return;
  /* 刷新途中收到新的进入/刷新请求：只保留尾随一次，避免旧响应覆盖新模式 */
  if(teamLoading){ teamQueued = true; return; }
  if(!opts.silent) mineBody.innerHTML = UI.skeletonRows(6);
  teamLoading = true;
  var seq = ++teamSeq;
  var params = {from: range.from, to: range.to};
  Promise.all([
    API.get("/api/mobile/team-overview", params),
    API.get("/api/mobile/workload", params).catch(function(err){ return {__err: err}; }),
    API.get("/api/mobile/risks").catch(function(err){ return {__err: err}; })
  ]).then(function(res){
    teamLoading = false;
    if(teamQueued){
      teamQueued = false;
      if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
      return;
    }
    if(seq !== teamSeq || !isMobile() || currentMineMode() !== "team") return;
    var overview = res[0] || {};
    var workload = res[1] || {};
    var risks = res[2] || {};
    var h = overview.health || {};
    var pending = overview.pending || {};
    var riskList = (overview.risks || []).slice();
    if(!riskList.length && !risks.__err){
      riskList = (risks.overdue || []).concat(risks.blocked || []).slice(0, 5);
    }

    var rate = Math.round((Number(h.doneRate) || 0) * 100);
    var delta = Math.round((Number(h.deltaWeek) || 0) * 100);
    var html = '<div class="team-panel">' + teamRangeBarHTML(range) +
      '<section class="team-hero">' +
        '<div class="th-main"><b>' + rate + '%</b><span>' + range.label + '完成率</span>' +
          '<em class="' + (delta >= 0 ? "up" : "down") + '" title="与前一等长周期比较">' +
            (delta >= 0 ? "↑ +" + delta : "↓ " + Math.abs(delta)) + '%</em></div>' +
        '<div class="th-grid">' +
          '<div><b>' + (h.doneCount || 0) + '/' + (h.planCount || 0) + '</b><span>完成 / 计划</span></div>' +
          '<button type="button" class="danger" data-team-risk="over" title="查看逾期工作项"><b>' + (h.overdue || 0) + '</b><span>已逾期</span></button>' +
          '<button type="button" class="warn" data-team-risk="blocked" title="查看被阻塞工作项"><b>' + (h.blocked || 0) + '</b><span>被阻塞</span></button>' +
        '</div>' +
        '<div class="th-note">完成率与工时按「' + esc(range.label) + '」统计；逾期、阻塞与待处理是当前快照，不随区间变化。</div>' +
      '</section>' +
      '<section class="team-card"><div class="tc-head"><h3>待处理</h3><span class="foot-note">截止此刻</span></div>' +
        '<div class="team-pending">' +
          '<button type="button" data-team-go="demands"><b>' + (pending.review || 0) + '</b><span>待评审</span></button>' +
          '<button type="button" data-team-go="branches" data-team-status="testing"><b>' + (pending.accept || 0) + '</b><span>待验收</span></button>' +
          '<button type="button" data-team-go="branches" data-team-status="merging"><b>' + (pending.merge || 0) + '</b><span>待合并</span></button>' +
        '</div></section>';

    html += '<section class="team-card"><div class="tc-head"><h3>风险工作项</h3><span class="foot-note">' + riskList.length + ' 项 · 截止此刻</span></div>' +
      (riskList.length ? '<div class="team-risks">' + riskList.map(function(r){
        var lv = r.level === "high" ? "high" : "mid";
        return '<div class="team-risk ' + lv + '" data-team-task="' + esc(r.taskId) + '" role="button" tabindex="0">' +
          '<i class="tr-dot"></i>' +
          '<div class="tr-main"><b>' + esc(r.title || "未命名工作项") + '</b>' +
            '<span>' + esc(r.ownerName || "未指派") + ' · ' + esc(r.reason || "") + '</span></div>' +
          (r.dayCount ? '<span class="tr-days">' + r.dayCount + ' 天</span>' : '') +
        '</div>';
      }).join("") + '</div>' : UI.emptyState({icon:"checkCircle", title:"此刻没有风险工作项", compact:true})) +
      '</section>';

    if(workload.__err){
      html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3></div>' + teamSectionError(workload.__err, "成员负载不可见") + '</section>';
    } else {
      var members = workload.members || [];
      var capDays = Number(workload.rangeWorkdays) || 0;
      html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3><span class="foot-note">' + range.label + '计时 / ' + capDays + ' 个工作日容量</span></div>' +
        (members.length ? '<div class="team-load">' + members.map(function(m){
          var pct = Math.round((Number(m.percent) || 0) * 100);
          var cls = pct > 100 ? "over" : (pct >= 90 ? "near" : "");
          return '<button type="button" class="tl-row" data-team-member="' + esc(m.name || "") + '" title="查看该成员未完成工作项">' +
            '<div class="tl-top"><b>' + esc(m.name || "—") + '</b><span>' + hm(m.actualMinutes) + ' / ' + hm(m.plannedMinutes) + '</span></div>' +
            '<div class="tl-bar"><i class="' + cls + '" style="width:' + Math.min(pct, 100) + '%"></i></div>' +
            '<span class="tl-pct ' + cls + '">' + pct + '%</span>' +
          '</button>';
        }).join("") + '</div>' : UI.emptyState({icon:"inbox", title:"该区间还没有成员计时", compact:true})) +
        '</section>';
    }
    html += '</div>';
    mineBody.innerHTML = html;
    var retry = mineBody.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", function(){ renderTeam(); });
    mineBody.querySelectorAll("[data-team-range]").forEach(function(el){
      el.addEventListener("click", function(){
        var key = el.dataset.teamRange;
        if(key === teamRangeKey()) return;
        try{ localStorage.setItem("ds.teamRange", key); }catch(e){ /* 受限环境仅本次生效 */ }
        /* 静默重绘：切区间是常规操作，不该闪一次骨架屏 */
        renderTeam({silent: true});
      });
    });
    mineBody.querySelectorAll("[data-team-task]").forEach(function(el){
      el.addEventListener("click", function(){ openTaskById(el.dataset.teamTask); });
      el.addEventListener("keydown", function(ev){
        if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); el.click(); }
      });
    });
    mineBody.querySelectorAll("[data-team-risk]").forEach(function(el){
      el.addEventListener("click", function(){ openTeamRiskTasks(el.dataset.teamRisk); });
    });
    mineBody.querySelectorAll("[data-team-member]").forEach(function(el){
      el.addEventListener("click", function(){ if(el.dataset.teamMember) openMemberTasks(el.dataset.teamMember); });
    });
    mineBody.querySelectorAll("[data-team-go]").forEach(function(el){
      el.addEventListener("click", function(){
        var status = el.dataset.teamStatus || "";
        /* 待验收 / 待合并直接落到对应分支状态，并保留来源，便于返回与清除 */
        if(status){
          var from = status === "testing" ? "accept" : "merge";
          try{ window.location.hash = "#/branches?status=" + status + "&from=" + from; }catch(e){ /* noop */ }
        }
        /* 走侧栏既有的 data-view 入口，避免 mine → router 的循环依赖 */
        var nav = document.querySelector('#sideNav [data-view="' + el.dataset.teamGo + '"]');
        if(nav) nav.click();
      });
    });
  }).catch(function(err){
    teamLoading = false;
    if(teamQueued){
      teamQueued = false;
      if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
      return;
    }
    if(seq !== teamSeq || !isMobile() || currentMineMode() !== "team") return;
    if(mineMeta) mineMeta.textContent = "";
    mineBody.innerHTML = (err && err.code === 4030)
      ? UI.noPermState({title:"当前角色无权查看团队数据", desc:"团队视图仅对空间主、管理员开放。"})
      : UI.errorState(err && err.message ? err.message : "网络异常，请稍后重试");
    var retry = mineBody.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", function(){ renderTeam(); });
  });
}

function mobileMineCardHTML(t){
  var f = dueFlag(t);
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var tAllowed = timerAllowed(t);
  var col = colMeta(t.boardColumn) || {};
  var colColor = col.color || CAT_DEFAULT_COLOR;
  var pri = t.priority || "P2";
  return '<article class="mob-task-card" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    '<div class="mtc-top">' +
      priTagHTML(pri, t.workspaceId) +
      '<span class="mtc-chip" style="--c:' + esc(colColor) + '"><i></i>' + esc(colName(t.boardColumn)) + '</span>' +
      (t.blocked ? '<span class="blocked-tag">' + icon("alert", 12) + '被阻塞</span>' : '') +
      '<span class="sp"></span>' +
      '<button class="mtc-ico' + (running ? " on" : "") + '" type="button" data-mine-timer' +
        ((!running && !tAllowed) ? " disabled" : "") +
        ' title="' + (running ? "停止计时" : (tAllowed ? "开始计时" : "待处理/已完成的工作项不能计时")) + '" aria-label="开始或停止计时">' +
        icon(running ? "pause" : "clock", 15) + '</button>' +
    '</div>' +
    '<h3 class="mtc-title">' + esc(t.title) + '</h3>' +
    '<div class="mtc-meta">' +
      '<span class="mtc-path">' + esc(t.workspaceName || "—") + ' · ' + esc(colName(t.boardColumn)) + '</span>' +
      '<span class="mtc-due" title="' + esc(dueDateTip(t)) + '">' +
        (t.dueDate ? esc(dueDateMD(t)) : "未设截止") + '</span>' +
      (f ? '<span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>' : '') +
    '</div>' +
    '<div class="mtc-swipe">' +
      '<button class="mtc-act done" type="button" data-mine-done>完成</button>' +
      '<button class="mtc-act" type="button" data-mine-due>改期</button>' +
    '</div>' +
  '</article>';
}
function renderMobileMine(sections){
  if(mineStats) mineStats.innerHTML = "";
  var html = '<div class="mob-groups">';
  sections.forEach(function(s){
    if(!s.rows.length) return;
    var inner;
    if(s.subs.length){
      inner = s.subs.map(function(sub){
        if(!sub.rows.length) return "";
        return '<section class="mine-mob-subgroup">' +
          (sub.label
            ? '<div class="mine-mob-subgroup-head"><h4>' + esc(sub.label) + '</h4>' +
              '<span class="mob-group-n">' + sub.rows.length + '</span></div>'
            : '') +
          '<div class="mob-card-list">' + sub.rows.map(mobileMineCardHTML).join("") + '</div>' +
        '</section>';
      }).join("");
    }else{
      inner = '<div class="mob-card-list">' + s.rows.map(mobileMineCardHTML).join("") + '</div>';
    }
    html += '<section class="mob-group" data-mine-group="' + esc(s.key) + '">' +
      (s.label
        ? '<div class="mob-group-head"><h3 class="' + (s.key === "over" ? "over" : "") + '">' + esc(s.label) + '</h3>' +
          '<span class="mob-group-n">' + s.rows.length + '</span></div>'
        : '') +
      inner +
    '</section>';
  });
  html += '</div>' + mineMoreHTML();
  mineBody.innerHTML = html;
}
function renderMine(d, append){
  if(isMobile() && currentMineMode() === "team"){ syncMineModeUI(); return; }
  var incoming = d.items || [];
  var spaces = d.spaces || [];
  mineSpaces = spaces;
  mineNameOnly = Number(d.matchedByNameOnly) || 0;
  mineTotal = typeof d.total === "number" ? d.total : (append ? mineAll.length : incoming.length);
  mineHasMore = !!d.hasMore;
  if(append){
    var seen = {};
    mineAll.forEach(function(t){ seen[t.workspaceId + "|" + t.id] = true; });
    incoming.forEach(function(t){
      var key = t.workspaceId + "|" + t.id;
      if(!seen[key]){ seen[key] = true; mineAll.push(t); }
    });
  }else{
    mineAll = incoming;
  }
  populateMineSpaces(spaces);
  mineCache = {};
  mineAll.forEach(function(t){ mineCache[t.workspaceId + "|" + t.id] = t; });
  var items = mineFiltered(mineAll);
  var filtering = mineFiltering();
  /* 空态时分组/排序/空间控件没有可作用的对象，先收起，避免空页面顶着一排设置 */
  var mineView = document.getElementById("view-mine");
  if(mineView){
    mineView.classList.toggle("is-empty", !items.length);
    mineView.classList.remove("is-team");
  }
  if(mineMeta){
    var nameOnly = mineNameOnly;
    var loaded = mineAll.length;
    var countTxt = filtering
      ? ("筛选出 " + items.length + " / " + loaded + " 项（已加载）")
      : ("已加载 " + loaded + (mineTotal > loaded ? (" / " + mineTotal) : "") + " 项");
    mineMeta.textContent = countTxt + " · 覆盖 " + spaces.length + " 个空间" +
      (mineHasMore ? " · 还有更多，可继续加载" : "") +
      (nameOnly > 0 ? (" · 其中 " + nameOnly + " 项仅按显示名匹配（未绑定账号）") : "");
  }
  if(!mineAll.length){
    if(mineStats) mineStats.innerHTML = "";
    mineBody.innerHTML = UI.emptyState({
      icon:"checkCircle", title:"没有分派给你的工作项",
      text:"被指派到你账号的工作项会汇总在这里（跨你参与的全部空间）。新成员可以先去「工作项」看看团队正在做什么；若老数据只填了显示名、没有绑定账号，请在工作项里重新指定负责人。",
      actionLabel:"去工作项"
    });
    var emptyGo = mineBody.querySelector("[data-empty-action]");
    if(emptyGo) emptyGo.addEventListener("click", function(){
      window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"board" } }));
    });
    return;
  }
  if(!items.length){
    if(mineStats) mineStats.innerHTML = "";
    mineBody.innerHTML = UI.emptyState({
      icon:"filterOff", title:"当前筛选下没有工作项", compact:true,
      text:"试着放宽顶栏筛选条件，或切换空间。",
      actionLabel:"清除筛选"
    }) + mineMoreHTML();
    var btn = mineBody.querySelector(".empty-state .btn");
    if(btn) btn.addEventListener("click", function(){
      state.mineSpace = "";
      clearFilters();
      syncMineFilters();
      rerenderMine();
    });
    return;
  }
  renderMineStats(items);
  var sections = mineSections(items);
  if(isMobile()){ renderMobileMine(sections); return; }
  var cols = mineVisibleCols(mineListWidth());
  /* 表头只出现一次，分组以内嵌可折叠行区分，避免每组各带一个卡片与表头 */
  var html = '<div class="mine-groups"><div class="list-scroll mine-list" data-density="' + mineDensityValue() + '">' +
    '<div class="list-head">' +
      cols.map(function(c){
        return '<span' + (c.align === "right" ? ' class="ta-r"' : '') + '>' + esc(c.label) + '</span>';
      }).join("") + '<span class="ta-r">操作</span>' +
    '</div><div class="list-body">';
  sections.forEach(function(s){
    if(!s.rows.length) return;
    var gk = mineGroupKey(state.mineGroup, s.key);
    var closed = !!mineClosed[gk];
    html += '<section class="mine-grp' + (closed ? " collapsed" : "") + (s.label ? " has-head" : "") + '" data-mine-group="' + esc(s.key) + '" data-tone="' + esc(s.tone || "neutral") + '">' +
      (s.label
        ? '<div class="mine-grp-h" role="button" tabindex="0" aria-expanded="' + (!closed) + '" data-mine-toggle="' + esc(gk) + '">' +
            '<span class="mine-grp-chev" aria-hidden="true">' + icon("chevronRight", 15) + '</span>' +
            '<span class="mine-grp-name">' + esc(s.label) + '</span>' +
            '<span class="mine-grp-n">' + s.rows.length + '</span>' +
            (s.hint ? '<span class="mine-grp-hint">' + esc(s.hint) + '</span>' : '') +
            '<span class="mine-grp-act">' + (closed ? "展开" : "收起") + '</span>' +
          '</div>'
        : '') +
      '<div class="mine-grp-body">';
    if(s.subs.length){
      s.subs.forEach(function(sub){
        if(!sub.rows.length) return;
        var sk = mineSubKey(state.mineGroup, s.key, mineSubDim(), sub.key);
        var sClosed = !!mineClosed[sk];
        html += '<div class="mine-sub' + (sClosed ? " closed" : "") + '">' +
          '<div class="mine-sub-h" role="button" tabindex="0" aria-expanded="' + (!sClosed) + '" data-mine-toggle="' + esc(sk) + '">' +
            '<span class="mine-sub-chev" aria-hidden="true">' + icon("chevronRight", 12) + '</span>' +
            '<span class="mine-sub-name">' + esc(sub.label) + '</span>' +
            '<span class="mine-sub-n">' + sub.rows.length + '</span>' +
          '</div>' +
          '<div class="mine-sub-body">' + sub.rows.map(function(t){ return mineRowHTML(t, cols); }).join("") + '</div>' +
        '</div>';
      });
    }else{
      html += s.rows.map(function(t){ return mineRowHTML(t, cols); }).join("");
    }
    html += '</div></section>';
  });
  html += '</div></div></div>' + mineMoreHTML();
  mineBody.innerHTML = html;
  var scroller = mineBody.querySelector(".mine-list");
  if(scroller) scroller.style.setProperty("--mine-cols", cols.map(function(c){ return c.w; }).concat(MINE_OPS_W).join(" "));
  mineSyncFoldBtn(sections);
}
function renderMineStats(items){
  if(!mineStats) return;
  if(isMobile()){ mineStats.innerHTML = ""; return; }
  var over = 0, today = 0, blocked = 0, noDue = 0;
  items.forEach(function(t){
    var s = dueState(t);
    if(s.kind === "over") over++;
    else if(s.kind === "today") today++;
    if(t.blocked) blocked++;
    if(!t.dueDate && s.kind !== "done" && s.kind !== "ended") noDue++;
  });
  mineStats.innerHTML =
    '<span class="mine-stat">共 <b>' + items.length + '</b> 项</span>' +
    '<span class="mine-stat over">逾期 <b>' + over + '</b></span>' +
    '<span class="mine-stat today">今天到期 <b>' + today + '</b></span>' +
    '<span class="mine-stat blocked">被阻塞 <b>' + blocked + '</b></span>' +
    '<span class="mine-stat">未设截止 <b>' + noDue + '</b></span>' +
    '<span class="mine-stat-hint">统计基于已载入项 · 悬停行显示快捷操作</span>';
}
function mineAnyGroupOpen(sections){
  if(state.mineGroup === "none") return false;
  for(var i = 0; i < sections.length; i++){
    var s = sections[i];
    if(s.rows.length && !mineClosed[mineGroupKey(state.mineGroup, s.key)]) return true;
  }
  return false;
}
function mineSyncFoldBtn(sections){
  if(!btnMineFold) return;
  var has = state.mineGroup !== "none";
  btnMineFold.hidden = !has;
  btnMineFold.textContent = has && mineAnyGroupOpen(sections) ? "折叠全部" : "展开全部";
}
function mineToggleFoldAll(){
  if(state.mineGroup === "none") return;
  var sections = mineSections(mineFiltered(mineAll));
  if(mineAnyGroupOpen(sections)){
    var sub = mineSubDim();
    sections.forEach(function(s){
      if(!s.rows.length) return;
      mineClosed[mineGroupKey(state.mineGroup, s.key)] = 1;
      if(sub !== "none"){
        s.subs.forEach(function(x){ mineClosed[mineSubKey(state.mineGroup, s.key, sub, x.key)] = 1; });
      }
    });
  }else{
    mineClosed = {};
  }
  mineSaveClosed();
  rerenderMine();
}
function mineSyncDensityUI(){
  if(!mineDensity) return;
  var cur = mineDensityValue();
  mineDensity.querySelectorAll("[data-mine-density]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.mineDensity === cur));
  });
}
function mineMoreHTML(){
  if(mineHasMore){
    return '<div class="mine-more"><button class="btn sm" type="button" data-mine-more>加载更多（已显示 ' +
      mineAll.length + ' / ' + mineTotal + '）</button></div>';
  }
  if(mineTotal > MINE_PAGE_SIZE){
    return '<div class="mine-more"><span class="foot-note">已显示全部 ' + mineTotal + ' 项</span></div>';
  }
  return "";
}
function mineTaskFromRow(row){
  return mineCache[(row.dataset.mineWs || "") + "|" + row.dataset.mineId] || null;
}
function mineComplete(t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var items = [{ from: t.boardColumn, title: t.title }];
  function send(pass){
    var body = { column: "done" };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    return API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/move", body);
  }
  function ok(){
    toast("已完成「" + t.title + "」", "fs");
    loadMine({silent:true});
    loadBoard({silent:true});
    loadRunningTimer();
  }
  guard(t.workspaceId, items, "done").then(function(pass){
    if(!pass) return;
    var retried = false;
    send(pass).then(ok).catch(function(ex){
      if(retried){ toast(ex.message || "完成失败", "bad"); return; }
      retried = true;
      serverDecision(t.workspaceId, items, "done", ex).then(function(retry){
        if(!retry){ if(ex.code !== 412 && ex.code !== 422) toast(ex.message || "完成失败", "bad"); return; }
        send(retry).then(ok).catch(function(e){ toast(e.message || "完成失败", "bad"); });
      });
    });
  });
}
/* 同一时刻只允许一个计时请求在途：双击会基于同一份旧状态连发两次开始/停止 */
var mineTimerBusy = false;
function mineToggleTimer(t){
  if(!t || mineTimerBusy) return;
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 停止自己的计时不受项目可见范围限制（与后端一致），只拦「开始」 */
  if(!running && !canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!running && !timerAllowed(t)){ toast("当前列不计时，请先移到处理规则为「正常计时」的列", "warn"); return; }
  mineTimerBusy = true;
  API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/timer/" + (running ? "stop" : "start"), {})
    .then(function(){
      mineTimerBusy = false;
      /* 乐观更新本地状态并立即重渲染：不等 /my-running-timer 往返，行内图标即刻切换 */
      state.runningTimer = running ? null : {
        running:true, taskId:t.id, taskTitle:t.title,
        workspaceId:t.workspaceId, workspaceName:t.workspaceName, elapsedMinutes:0
      };
      mineLastRunningId = running ? null : t.id;
      rerenderMine();
      toast(running ? ("已停止「" + t.title + "」计时") : ("已开始「" + t.title + "」计时"), "fs");
      /* 权威同步：刷新顶部计时胶囊；服务端状态与本地不一致时经 ds:running-timer 纠正 */
      loadRunningTimer();
    }).catch(function(ex){ mineTimerBusy = false; toast(ex.message || "计时操作失败", "bad"); });
}
function mineReschedule(anchor, t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var el = document.createElement("div");
  el.className = "menu due-pop";
  el.innerHTML =
    '<div class="dp-quick">' +
      '<button class="btn sm" type="button" data-mine-due-set="0">今天</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="1">明天</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="w5" title="按 5 个工作日计算，自动跳过周末">一周后</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="">无期限</button>' +
    '</div>' +
    '<div class="dp-row">' +
      '<input type="date" value="' + esc(t.dueDate || "") + '" data-mine-due-input aria-label="选择截止日期" />' +
      '<button class="btn sm primary" type="button" data-mine-due-save>确定</button>' +
    '</div>';
  function apply(v){
    UI.closeAllPops();
    API.putWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id), taskPayloadWith(t, {dueDate: v || null}))
      .then(function(){
        toast(v ? ("已改期至 " + fmtFull(parseDate(v))) : "已清除截止日期", v ? "fs" : "warn");
        loadMine({silent:true});
        loadBoard({silent:true});
        refreshCalendarIfOpen();
      }).catch(function(ex){ toast(ex.message || "改期失败", "bad"); });
  }
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-due-set]");
    if(b){ apply(duePresetDate(b.dataset.mineDueSet)); return; }
    if(e.target.closest("[data-mine-due-save]")){
      apply(el.querySelector("[data-mine-due-input]").value || null);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
  setTimeout(function(){
    try{ el.querySelector("[data-mine-due-input]").focus(); }catch(e2){ /* noop */ }
  }, 30);
}
if(mineBody){
  mineBody.addEventListener("click", function(e){
    var tgl = e.target.closest("[data-mine-toggle]");
    if(tgl){
      e.stopPropagation();
      var tk = tgl.dataset.mineToggle;
      if(mineClosed[tk]) delete mineClosed[tk];
      else mineClosed[tk] = 1;
      mineSaveClosed();
      rerenderMine();
      return;
    }
    if(e.target.closest("[data-mine-more]")){ e.stopPropagation(); loadMine({append:true}); return; }
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    var t = mineTaskFromRow(row);
    if(e.target.closest("[data-mine-done]")){ e.stopPropagation(); mineComplete(t); return; }
    if(e.target.closest("[data-mine-timer]")){ e.stopPropagation(); mineToggleTimer(t); return; }
    var dueBtn = e.target.closest("[data-mine-due]");
    if(dueBtn){ e.stopPropagation(); mineReschedule(dueBtn, t); return; }
    var id = row.dataset.mineId;
    var wsId = row.dataset.mineWs;
    if(wsId && rt.currentWs && wsId !== rt.currentWs.id){
      var rowTitle = row.querySelector(".mine-tc-title") || row.querySelector(".mtc-title") || row.querySelector(".lr-t");
      askSwitchWorkspace(wsId, wsNameById(wsId), {
        title: "打开其他空间的工作项",
        okText: "切换并打开",
        taskTitle: rowTitle ? rowTitle.textContent : "",
        openTaskId: id
      });
      return;
    }
    openTaskById(id);
  });
  mineBody.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    if(e.target.closest("button,input,select,a,textarea")) return;
    var tgl = e.target.closest("[data-mine-toggle]");
    if(tgl){ e.preventDefault(); tgl.click(); return; }
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    e.preventDefault();
    row.click();
  });
}
if(mineSpaceFilter){
  mineSpaceFilter.addEventListener("change", function(){
    state.mineSpace = mineSpaceFilter.value || "";
    syncMineFilterMarks();
    rerenderMine();
  });
}
if(mineGroup){
  mineGroup.addEventListener("change", function(){
    state.mineGroup = MINE_GROUP_DIMS.indexOf(mineGroup.value) !== -1 ? mineGroup.value : "due";
    if(state.mineGroup === "none" || state.mineGroup === state.mineSubgroup) state.mineSubgroup = "none";
    syncMineFilters();
    rerenderMine();
  });
}
if(mineSubgroup){
  mineSubgroup.addEventListener("change", function(){
    if(MINE_GROUP_DIMS.indexOf(mineSubgroup.value) === -1) return;
    state.mineSubgroup = mineSubgroup.value;
    syncMineFilterMarks();
    rerenderMine();
  });
}
if(mineSort){
  mineSort.addEventListener("change", function(){
    state.mineSort = MINE_SORTS.indexOf(mineSort.value) !== -1 ? mineSort.value : "default";
    syncMineFilterMarks();
    rerenderMine();
  });
}
if(mineDensity){
  mineDensity.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-density]");
    if(!b) return;
    try{ localStorage.setItem(MINE_DENSITY_KEY, b.dataset.mineDensity === "relaxed" ? "relaxed" : "standard"); }catch(e2){ /* 受限环境仅本次生效 */ }
    mineSyncDensityUI();
    var scroller = mineBody && mineBody.querySelector(".mine-list");
    if(scroller) scroller.dataset.density = mineDensityValue();
  });
}
if(btnMineFields){
  btnMineFields.addEventListener("click", function(){
    listPrefs.openColumnSettings("my-tasks", function(){ rerenderMine(); });
  });
}
if(btnMineFold) btnMineFold.addEventListener("click", mineToggleFoldAll);
if(btnMineRefresh) btnMineRefresh.addEventListener("click", function(){ loadMine(); });
if(mineModeEl){
  mineModeEl.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-mode]");
    if(b) setMineMode(b.dataset.mineMode);
  });
}
/* 跨断点重排：手机卡片 / 桌面表格共用同一份数据 */
window.addEventListener("ds:layout", function(){
  if(!rt.currentWs || document.body.dataset.view !== "mine") return;
  syncMineModeUI();
  mineSyncDensityUI();
  if(isMobile() && currentMineMode() === "team"){ renderTeam(); return; }
  /* 从手机团队模式切回桌面时，我的任务可能从未加载过 */
  if(mineAll.length) rerenderMine(); else loadMine();
});
/* 列裁剪按容器宽度决定，窗口变化后重绘保持表头与行对齐 */
var mineResizeTimer = 0;
window.addEventListener("resize", function(){
  if(document.body.dataset.view !== "mine" || isMobile() || !mineAll.length) return;
  clearTimeout(mineResizeTimer);
  mineResizeTimer = setTimeout(function(){
    if(currentMineMode() !== "team") rerenderMine();
  }, 150);
});
/* 下拉刷新走统一入口：团队模式刷新团队面板，我的模式刷新任务列表 */
window.addEventListener("ds:refresh-mine", function(){
  if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
  else loadMine({silent:true});
});
/* 计时状态变化（行内按钮 / 顶部胶囊 / 其他设备）：只在运行任务真正变化时重渲染行 */
var mineLastRunningId = null;
window.addEventListener("ds:running-timer", function(){
  var cur = state.runningTimer && state.runningTimer.taskId ? state.runningTimer.taskId : null;
  var changed = cur !== mineLastRunningId;
  mineLastRunningId = cur;
  if(!changed) return;
  if(document.body.dataset.view !== "mine" || mineLoading) return;
  if(isMobile() && currentMineMode() === "team") return;
  if(mineAll.length) rerenderMine();
});
syncMineModeUI();
mineSyncDensityUI();

export { askSwitchWorkspace, enterMineView, loadMine, wsNameById };
