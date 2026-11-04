/* views/gantt · 甘特图（窗口化渲染、依赖、导出、分享） */

import { API } from "../core/api.js";
import { $, iDue, iStart, searchInput, searchWrap } from "../core/dom.js";
import { applyView, clearFilters, promptSaveView, reloadFilteredViews } from "../core/filters-ui.js";
import { filterParams, setFilterValue, toggleFilterValue } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { catTag, filterOn, progressOf, reqNameById, rt, selectedFilterCount, state, taskById, taskCacheExtra } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncDateBounds } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { PRIORITIES, PRIORITY_COLOR, addDays, colName, dayDiff, fmtFull, fmtMinutes, fmtMinutesShort, fmtShortMD, iso, parseDate, typeName } from "../lib/format.js";
import { GS } from "../lib/gantt-shared.js";
import { loadBoard, loadReqs } from "./board.js";
import { refreshCalendarIfOpen } from "./calendar.js";
import { refreshListIfOpen } from "./list.js";

var ganttScroll = $("ganttScroll"), ganttMeta = $("ganttMeta"),
    ganttShowDoneEl = $("ganttShowDone"), ganttZoomEl = $("ganttZoom"),
    ganttDensityEl = $("ganttDensity"),
    ganttGroupEl = $("ganttGroup"), ganttRangeModeEl = $("ganttRangeMode"),
    ganttRangeLabelEl = $("ganttRangeLabel"), ganttPrevMonthEl = $("ganttPrevMonth"),
    ganttNextMonthEl = $("ganttNextMonth"), ganttFilterBtn = $("ganttFilterBtn"),
    ganttFilterMenu = $("ganttFilterMenu"), ganttFilterCountEl = $("ganttFilterCount"),
    ganttClearFilterEl = $("ganttClearFilter"), ganttNoticeEl = $("ganttNotice"),
    ganttUnplannedBox = $("ganttUnplannedBox"), ganttUnplannedCount = $("ganttUnplannedCount"),
    ganttUnplannedList = $("ganttUnplannedList"),
    ganttUndoBtn = $("ganttUndo"), ganttNewBtn = $("ganttNew"),
    ganttViewsBtn = $("ganttViewsBtn"), ganttViewsMenu = $("ganttViewsMenu"),
    ganttExportBtn = $("ganttExportBtn"), ganttExportMenu = $("ganttExportMenu"),
    ganttScaleEl = $("ganttScale"), ganttAnalysisBtn = $("ganttAnalysisBtn"),
    ganttAnalysisMenu = $("ganttAnalysisMenu"), ganttDepMenu = $("ganttDepMenu"),
    ganttLoadBox = $("ganttLoad"), ganttLoadBody = $("ganttLoadBody"),
    ganttLoadRangeEl = $("ganttLoadRange"), ganttLoadCloseEl = $("ganttLoadClose");
var GANTT_LABEL_W = 280;
var GANTT_ROW_H = 54, GANTT_GROUP_H = 32, GANTT_HEAD_H = 54;
var GANTT_LABEL_W_NARROW = 170;
var GANTT_PAGE = 500;
var GANTT_MAX_LOAD = 3000;
var GANTT_MAX_DAYS = 740;
var GANTT_DONE    = {c:"var(--success)", soft:"var(--success-soft)", bd:"var(--success-border)"};
var GANTT_BLOCKED = {c:"var(--warning)", soft:"var(--warning-soft)", bd:"var(--warning-border)"};
var GANTT_OVERDUE = {c:"var(--danger)",  soft:"var(--danger-soft)",  bd:"var(--danger-border)"};
var GANTT_DOING   = {c:"var(--primary)", soft:"var(--primary-soft)", bd:"var(--primary-border)"};
var ganttTipEl = null, ganttDropEl = null;
var ganttSuppressUnplannedClick = 0;
var ganttState = {
  tasks: [], byId: {}, dayW: 28, showDone: false, range: null, seq: 0, drag: null,
  total: 0, scrolled: false, unplannedAuto: false,
  groupBy: "none", collapsed: {}, rangeMode: "auto", anchorMonth: null,
  notice: "", unplannedDrag: null,
  rows: [],               // 当前渲染的已排期行（{t, s, e, rs, re}），CSV 与多选范围共用
  undated: [],            // 未排期任务（左下方抽屉）
  sel: {}, selAnchor: null,
  undo: [], undoBusy: false,   // 改期撤销栈，最多 20 步
  /* ---- V1.4 ---- */
  zoomDayW: 28,           // 「日」刻度下的像素宽度
  scale: "day",           // day | week | month
  sortBy: "start",        // start | due | priority | owner | progress
  groupBy2: "none",       // 第二级分组
  cols: { project: true, owner: true, dates: true, work: true, subtask: true, tags: false, comments: false },
  deps: [], depById: {},
  baseline: {}, baselineAt: null, baselineOn: false,
  showCritical: false, critical: null, criticalDeps: {},
  showLoad: false,
  paging: { total: 0, loaded: 0, hasMore: false, loading: false, nextOffset: 0 },
  layout: [], layoutH: 0, win: { start: -1, end: -1 }, winGeom: {},
  depsLoaded: false,      // false=服务端没返回 deps 字段，渲染时回落 blockedByTaskId
  printAll: false, pendingTop: null,
  loadData: null, loadDoneKey: "", loadKey: "", loadSeq: 0, loadLoading: false,
  serverUnplanned: null, unplannedTasks: [], unscheduledTotal: 0, exportBusy: false, pendingNotice: "",
  wsId: null,
  depDrag: null,
  /* ---- V1.4.1 显示密度与左列宽度 ---- */
  density: "comfortable", // comfortable | compact | minimal
  labelW: GANTT_LABEL_W,  // 左列任务列表像素宽度
  labelDrag: null         // 拖拽调整左列宽度时的状态
};
var GANTT_DEFAULT_COLS = { project: true, owner: true, dates: true, work: true, subtask: true, tags: false, comments: false };
function ganttPrefsKey(){
  var id = rt.currentWs && rt.currentWs.id;
  return id ? ("ds.gantt.prefs." + id) : null;
}
function loadGanttPrefs(){
  /* 先回默认值，避免沿用上一个空间的显示设置 */
  ganttState.showDone = false;
  ganttState.zoomDayW = 28;
  ganttState.dayW = 28;
  ganttState.groupBy = "none";
  ganttState.groupBy2 = "none";
  ganttState.sortBy = "start";
  ganttState.collapsed = {};
  ganttState.scale = "day";
  ganttState.cols = {};
  for(var dk in GANTT_DEFAULT_COLS) ganttState.cols[dk] = GANTT_DEFAULT_COLS[dk];
  ganttState.baselineOn = false;
  ganttState.showCritical = false;
  ganttState.showLoad = false;
  ganttState.density = "comfortable";
  ganttState.labelW = GANTT_LABEL_W;

  var key = ganttPrefsKey();
  if(!key) return;   // 没有空间 id：保持内存状态，不写/不读错误 key
  var saved = null;
  try{ saved = JSON.parse(localStorage.getItem(key) || "null"); }catch(e){ saved = null; }
  if(!saved || typeof saved !== "object") return;
  if(typeof saved.showDone === "boolean") ganttState.showDone = saved.showDone;
  /* 兼容 P0 时期只存 dayW 的旧偏好 */
  var dw = Number(saved.zoomDayW || saved.dayW);
  if(dw === 20 || dw === 28 || dw === 40) ganttState.zoomDayW = dw;
  if(saved.scale === "day" || saved.scale === "week" || saved.scale === "month") ganttState.scale = saved.scale;
  if(saved.groupBy === "project" || saved.groupBy === "owner") ganttState.groupBy = saved.groupBy;
  if(saved.groupBy2 === "project" || saved.groupBy2 === "owner" || saved.groupBy2 === "status"
    || saved.groupBy2 === "category" || saved.groupBy2 === "priority") ganttState.groupBy2 = saved.groupBy2;
  if(saved.sortBy === "start" || saved.sortBy === "due" || saved.sortBy === "priority"
    || saved.sortBy === "owner" || saved.sortBy === "progress") ganttState.sortBy = saved.sortBy;
  if(saved.collapsed && typeof saved.collapsed === "object") ganttState.collapsed = saved.collapsed;
  /* 一级不分组 = 平铺：忽略历史遗留的二级分组偏好 */
  if(ganttState.groupBy === "none") ganttState.groupBy2 = "none";
  if(saved.cols && typeof saved.cols === "object"){
    for(var ck in GANTT_DEFAULT_COLS){
      if(typeof saved.cols[ck] === "boolean") ganttState.cols[ck] = saved.cols[ck];
    }
  }
  if(typeof saved.baselineOn === "boolean") ganttState.baselineOn = saved.baselineOn;
  if(typeof saved.showCritical === "boolean") ganttState.showCritical = saved.showCritical;
  if(typeof saved.showLoad === "boolean") ganttState.showLoad = saved.showLoad;
  if(saved.density === "comfortable" || saved.density === "compact" || saved.density === "minimal") ganttState.density = saved.density;
  var lw = Number(saved.labelW);
  if(lw >= GANTT_LABEL_W_NARROW && lw <= 500) ganttState.labelW = lw;
}
function saveGanttPrefs(){
  var key = ganttPrefsKey();
  if(!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      showDone: ganttState.showDone,
      zoomDayW: ganttState.zoomDayW,
      scale: ganttState.scale,
      groupBy: ganttState.groupBy,
      groupBy2: ganttState.groupBy2,
      sortBy: ganttState.sortBy,
      collapsed: ganttState.collapsed,
      cols: ganttState.cols,
      baselineOn: ganttState.baselineOn,
      showCritical: ganttState.showCritical,
      showLoad: ganttState.showLoad,
      density: ganttState.density,
      labelW: ganttState.labelW
    }));
  }catch(e){ /* 隐私模式 / 配额满：偏好只是增强，不打断使用 */ }
}
function ganttEffectiveDayW(){
  return GS.scaleDayW(ganttState.scale, ganttState.zoomDayW);
}
function ganttRowH(){
  return ganttState.density === "minimal" ? 30 : (ganttState.density === "compact" ? 40 : GANTT_ROW_H);
}
function ganttGroupH(){
  return ganttState.density === "minimal" ? 24 : (ganttState.density === "compact" ? 28 : GANTT_GROUP_H);
}
function ganttLabelW(){
  if(window.innerWidth <= 900) return GANTT_LABEL_W_NARROW;
  return Math.max(GANTT_LABEL_W_NARROW, Math.min(500, ganttState.labelW || GANTT_LABEL_W));
}
function ganttReadOnly(){
  return window.matchMedia("(max-width: 900px)").matches;
}
function enterGanttView(){
  /* 切换工作空间时重新定位到今天，同一空间内保留滚动位置 */
  var wsid = rt.currentWs && rt.currentWs.id;
  if(ganttState.wsId !== wsid){
    ganttState.wsId = wsid;
    ganttState.scrolled = false;
    /* 换空间后月视图回到当前月，避免沿用上一个空间的月份 */
    ganttState.anchorMonth = null;
    ganttState.undo = [];
    syncGanttUndoUI();
  }
  loadGanttPrefs();
  syncGanttControls();
  /* 启动时看板若未加载成功，筛选栏/筛选菜单会没有选项：进甘特时静默补拉一次 */
  if(!state.board) loadBoard({silent:true});
  loadGantt();
  loadReqs().then(function(){
    if(activeView === "gantt" && !ganttState.drag && !ganttState.unplannedDrag && ganttState.tasks.length) renderGantt();
  }).catch(function(){ /* 项目名只是展示增强，失败不影响甘特图 */ });
}
function syncGanttControls(){
  if(ganttShowDoneEl) ganttShowDoneEl.checked = ganttState.showDone;
  if(ganttScaleEl) ganttScaleEl.value = ganttState.scale;
  if(ganttZoomEl){
    ganttZoomEl.value = String(ganttState.zoomDayW);
    ganttZoomEl.disabled = ganttState.scale !== "day";
  }
  if(ganttDensityEl) ganttDensityEl.value = ganttState.density;
  if(ganttGroupEl) ganttGroupEl.value = ganttState.groupBy;
  if(ganttRangeModeEl){
    ganttRangeModeEl.querySelectorAll("[data-gantt-range]").forEach(function(b){
      b.setAttribute("aria-pressed", b.getAttribute("data-gantt-range") === ganttState.rangeMode ? "true" : "false");
    });
  }
  updateGanttRangeUI();
  renderGanttFilterState();
  renderGanttAnalysisMenu();
  syncGanttLoadPanel();
}
function ganttLoadRange(){
  if(ganttState.rangeMode !== "month") return null;
  return ganttMonthRange(ganttState.anchorMonth || ganttMonthStart(rt.TODAY));
}
function ganttTaskParams(offset, limit){
  var params = filterParams({
    sort: "due",
    offset: offset || 0,
    limit: limit || GANTT_PAGE
  });
  var r = ganttLoadRange();
  if(r){ params.from = iso(r.start); params.to = iso(r.end); }
  return params;
}
function loadGantt(opts){
  opts = opts || {};
  if(ganttState.drag || ganttState.unplannedDrag || !ganttScroll) return;
  var silent = !!opts.silent;
  var keepSel = silent ? ganttState.sel : {};
  var keepAnchor = silent ? ganttState.selAnchor : null;
  /* 静默刷新失败时回滚到旧数据，避免页面还显示旧条、状态却已被清空 */
  ganttState.silentBackup = silent ? {
    tasks: ganttState.tasks, byId: ganttState.byId, deps: ganttState.deps,
    depById: ganttState.depById, depsLoaded: ganttState.depsLoaded,
    baseline: ganttState.baseline, baselineAt: ganttState.baselineAt,
    serverUnplanned: ganttState.serverUnplanned, unplannedTasks: ganttState.unplannedTasks,
    unscheduledTotal: ganttState.unscheduledTotal, paging: ganttState.paging,
    loadData: ganttState.loadData, critical: ganttState.critical, criticalDeps: ganttState.criticalDeps
  } : null;
  if(!silent) ganttState.silentBackup = null;
  var seq = ++ganttState.seq;
  ganttState.tasks = [];
  ganttState.byId = {};
  ganttState.deps = [];
  ganttState.depById = {};
  ganttState.depsLoaded = false;
  ganttState.loadData = null;
  ganttState.loadDoneKey = "";
  ganttState.loadLoading = false;
  ganttState.loadSeq++;
  ganttState.serverUnplanned = null;
  ganttState.unplannedTasks = [];
  ganttState.unscheduledTotal = 0;
  if(ganttUnplannedBox) ganttUnplannedBox.hidden = true;
  ganttState.baseline = {};
  ganttState.baselineAt = null;
  ganttState.critical = null;
  ganttState.criticalDeps = {};
  ganttState.sel = keepSel;
  ganttState.selAnchor = keepAnchor;
  ganttState.paging = { total: 0, loaded: 0, hasMore: true, loading: true, nextOffset: 0, silent: silent, present: {} };
  if(!silent && !ganttScroll.querySelector(".gantt-grid")){
    ganttScroll.innerHTML = '<div style="padding:20px">' + UI.skeletonRows(6) + '</div>';
    ganttMeta.textContent = "加载中…";
  }
  ganttLoadPage(seq, 0);
}
function ganttLoadPage(seq, offset){
  API.get("/api/gantt", ganttTaskParams(offset, GANTT_PAGE)).then(function(d){
    if(seq !== ganttState.seq) return;
    var fetched = (d && d.items) || [];
    var items = fetched;
    /* 分页边界排到空页时立即停住，避免 hasMore 异常导致无限递归 */
    if(offset > 0 && !fetched.length){
      ganttState.paging.hasMore = false;
      ganttState.paging.loading = false;
      if(ganttState.paging.silent){ ganttPruneSelection(); renderGantt(); ganttState.silentBackup = null; }
      return;
    }
    if(offset === 0){
      ganttState.tasks = items.slice();
      var deps = (d && d.deps) || [];
      ganttState.deps = deps;
      ganttState.depById = {};
      deps.forEach(function(dep){ ganttState.depById[dep.id] = dep; });
      ganttState.baseline = (d && d.baseline) || {};
      ganttState.baselineAt = (d && d.baselineAt) || null;
      /* 服务端返回 deps 字段（哪怕空数组）就说明迁移过，不再回落到 blockedByTaskId */
      ganttState.depsLoaded = !!(d && d.deps);
      ganttState.serverUnplanned = (d && Array.isArray(d.unscheduled)) ? d.unscheduled : null;
      ganttState.unplannedTasks = (d && d.unscheduled) || [];
      ganttState.unscheduledTotal = (d && typeof d.unscheduledCount === "number")
        ? d.unscheduledCount : ganttState.unplannedTasks.length;
      ganttState.unplannedTasks.forEach(function(t){
        ganttState.byId[t.id] = t;
        taskCacheExtra[t.id] = t;
      });
      if(!ganttState.baselineAt) ganttState.baselineOn = false;
    }else{
      /* 并发改期时 offset 分页可能重复返回同一任务：按 id 去重 */
      var known = {};
      ganttState.tasks.forEach(function(x){ known[x.id] = 1; });
      items = items.filter(function(x){ return !known[x.id]; });
      ganttState.tasks = ganttState.tasks.concat(items);
    }
    ganttState.paging.nextOffset = offset + fetched.length;
    if(!fetched.length) ganttState.paging.hasMore = false;
    var present = {};
    items.forEach(function(t){
      ganttState.byId[t.id] = t;
      taskCacheExtra[t.id] = t;
      present[t.id] = 1;
    });
    if(offset === 0 && !ganttState.paging.silent){
      Object.keys(ganttState.sel).forEach(function(id){ if(!present[id]) delete ganttState.sel[id]; });
      if(ganttState.selAnchor && !present[ganttState.selAnchor]) ganttState.selAnchor = null;
    }
    if(ganttState.paging.silent){
      for(var pid in present) ganttState.paging.present[pid] = 1;
    }
    ganttState.total = (d && typeof d.total === "number") ? d.total : ganttState.tasks.length;
    ganttState.paging.total = ganttState.total;
    ganttState.paging.loaded = ganttState.tasks.length;
    ganttState.paging.hasMore = !!(d && d.hasMore) && fetched.length > 0;
    ganttState.paging.loading = false;
    if(!ganttState.paging.silent) renderGantt();
    /* 自动拉完后续分页，但设上限，避免一次把几万条塞进浏览器 */
    /* 如果渲染过程中切了月视图并重启了加载，seq 会变，旧分页不能再追 */
    if(seq === ganttState.seq && ganttState.paging.hasMore && fetched.length > 0 && ganttState.tasks.length < GANTT_MAX_LOAD){
      ganttLoadPage(seq, ganttState.paging.nextOffset);
    }else if(ganttState.paging.silent){
      /* 静默刷新等全部分页到齐后只渲染一次 */
      ganttPruneSelection();
      renderGantt();
      ganttState.silentBackup = null;
    }
  }).catch(function(ex){
    if(seq !== ganttState.seq) return;
    ganttState.paging.loading = false;
    if(ganttState.silentBackup){
      var b = ganttState.silentBackup;
      ganttState.silentBackup = null;
      ganttState.tasks = b.tasks;
      ganttState.byId = b.byId;
      ganttState.deps = b.deps;
      ganttState.depById = b.depById;
      ganttState.depsLoaded = b.depsLoaded;
      ganttState.baseline = b.baseline;
      ganttState.baselineAt = b.baselineAt;
      ganttState.serverUnplanned = b.serverUnplanned;
      ganttState.unplannedTasks = b.unplannedTasks;
      ganttState.unscheduledTotal = b.unscheduledTotal;
      ganttState.paging = b.paging;
      ganttState.loadData = b.loadData;
      ganttState.critical = b.critical;
      ganttState.criticalDeps = b.criticalDeps;
      toast("甘特图刷新失败：" + (ex.message || "网络异常") + "（保留当前视图）", "bad");
      return;
    }
    if(!ganttState.tasks.length){
      ganttMeta.textContent = "";
      ganttScroll.innerHTML = '<div style="padding:20px">' + UI.errorState(ex.message) + '</div>';
      bindRetry(ganttScroll, function(){ loadGantt(); });
    }else{
      toast("甘特图加载失败：" + (ex.message || "网络异常"), "bad");
    }
  });
}
function ganttPruneSelection(){
  var present = ganttState.paging && ganttState.paging.present;
  if(!present) return;
  Object.keys(ganttState.sel).forEach(function(id){ if(!present[id]) delete ganttState.sel[id]; });
  if(ganttState.selAnchor && !present[ganttState.selAnchor]) ganttState.selAnchor = null;
}
function ganttMonthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function ganttMonthEnd(d){ return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function ganttMonthRange(anchor){
  var m = anchor || rt.TODAY;
  var start = ganttMonthStart(m), end = ganttMonthEnd(m);
  return { start: start, end: end, days: dayDiff(end, start) + 1 };
}
function ganttMonthLabel(d){
  var m = d || rt.TODAY;
  return m.getFullYear() + " 年 " + (m.getMonth() + 1) + " 月";
}
function ganttDateRange(dated){
  var min = dated[0].s, max = dated[0].e;
  dated.forEach(function(x){
    if(x.s < min) min = x.s;
    if(x.e > max) max = x.e;
  });
  /* 今天始终留在时间轴里，方便对照进度 */
  if(rt.TODAY < min) min = rt.TODAY;
  if(rt.TODAY > max) max = rt.TODAY;
  var start = addDays(min, -3), end = addDays(max, 4);
  return { start: start, end: end, days: dayDiff(end, start) + 1 };
}
function ganttMetaText(info){
  var txt = info.count + " 项";
  if(info.hiddenDone) txt += "（已隐藏 " + info.hiddenDone + " 项已完成）";
  if(info.range){
    txt += " · " + (info.mode === "month"
      ? ganttMonthLabel(ganttState.anchorMonth)
      : (fmtShortMD(info.range.start) + " → " + fmtShortMD(info.range.end)));
  }
  if(info.scale && info.scale !== "day") txt += " · " + (info.scale === "week" ? "周刻度" : "月刻度");
  if(info.baselineAt){
    var bd = String(info.baselineAt).substring(0, 10);
    txt += " · 基线 " + fmtShortMD(parseDate(bd));
  }
  var n = selectedFilterCount();
  if(n) txt += " · 已应用 " + n + " 项筛选";
  if(info.paging && info.paging.hasMore){
    txt += info.paging.loaded >= GANTT_MAX_LOAD
      ? (" · 已达加载上限 " + GANTT_MAX_LOAD + " 项，请用筛选缩小范围")
      : (" · 已加载 " + info.paging.loaded + "/" + info.paging.total);
  }
  return txt;
}
function ganttStatusOf(t){
  var done = t.boardColumn === "done";
  var days = 0;
  if(!done && t.dueDate && t.dueDate < rt.TODAY_ISO){
    days = Math.abs(dayDiff(parseDate(t.dueDate), rt.TODAY));
  }
  if(done) return { key: "done", color: GANTT_DONE, days: 0, badge: "已完成" };
  if(t.blocked) return {
    key: "blocked", color: GANTT_BLOCKED, days: days,
    badge: days ? ("阻塞 · 逾期 " + days + " 天") : "阻塞"
  };
  if(days > 0) return { key: "overdue", color: GANTT_OVERDUE, days: days, badge: "逾期 " + days + " 天" };
  return { key: "doing", color: GANTT_DOING, days: 0, badge: "" };
}
function ganttGroupFieldValue(t, field){
  if(field === "project"){
    if(!t.reqId) return { v: "__none", name: "未关联项目" };
    var rn = reqNameById(t.reqId);
    return { v: t.reqId, name: (rn && rn !== "无") ? rn : "未关联项目" };
  }
  if(field === "owner") return t.owner ? { v: t.owner, name: t.owner } : { v: "__none", name: "未分配" };
  if(field === "status"){
    var st = ganttStatusOf(t);
    var nm = st.key === "done" ? "已完成" : st.key === "blocked" ? "阻塞" : st.key === "overdue" ? "逾期" : "进行中";
    return { v: st.key, name: nm };
  }
  if(field === "category") return { v: t.category || "__none", name: t.category || "未分类" };
  if(field === "priority") return { v: t.priority || "P2", name: t.priority || "P2" };
  return { v: "__all", name: "" };
}
function ganttBuildGroups(rows){
  var f1 = ganttState.groupBy, f2 = ganttState.groupBy2;
  if(f1 === "none" && f2 === "none"){
    return [{ key: "", name: "", depth: 0, rows: rows, children: [], count: rows.length }];
  }
  if(f1 === "none"){ f1 = f2; f2 = "none"; }
  var out = [], map = {};
  rows.forEach(function(x){
    var v1 = ganttGroupFieldValue(x.t, f1);
    var k1 = "1:" + f1 + ":" + v1.v;
    var g1 = map[k1];
    if(!g1){ g1 = map[k1] = { key: k1, name: v1.name, depth: 1, rows: [], children: [], count: 0 }; out.push(g1); }
    g1.rows.push(x);
    g1.count++;
    if(f2 !== "none"){
      var v2 = ganttGroupFieldValue(x.t, f2);
      var k2 = "2:" + f2 + ":" + v2.v;
      var g2 = null;
      for(var i = 0; i < g1.children.length; i++) if(g1.children[i].key === k2) g2 = g1.children[i];
      if(!g2){ g2 = { key: k2, name: v2.name, depth: 2, rows: [], count: 0 }; g1.children.push(g2); }
      g2.rows.push(x);
      g2.count++;
    }
  });
  return out;
}
function ganttSortRows(rows){
  var by = ganttState.sortBy;
  rows.sort(function(a, b){
    var c = 0;
    if(by === "due") c = (a.e - b.e) || (a.s - b.s);
    else if(by === "priority") c = PRIORITIES.indexOf(a.t.priority) - PRIORITIES.indexOf(b.t.priority);
    else if(by === "owner") c = String(a.t.owner || "").localeCompare(String(b.t.owner || ""), "zh");
    else if(by === "progress") c = progressOf(a.t) - progressOf(b.t);
    else c = (a.s - b.s) || (a.e - b.e);
    if(c) return c;
    return (a.s - b.s) || (a.e - b.e) || String(a.t.id).localeCompare(String(b.t.id));
  });
}
function ganttBuildLayout(rows){
  var out = [], top = 0;
  var rowH = ganttRowH(), groupH = ganttGroupH();
  ganttBuildGroups(rows).forEach(function(g1){
    var head1 = !!g1.key;
    var col1 = head1 && !!ganttState.collapsed[g1.key];
    if(head1){
      out.push({ type: "group", key: g1.key, name: g1.name, depth: 1, count: g1.count, collapsed: col1, top: top });
      top += groupH;
      if(col1) return;
    }
    var children = g1.children.length ? g1.children : [{ key: "", name: "", depth: 0, rows: g1.rows, count: g1.rows.length }];
    children.forEach(function(g2){
      var head2 = !!g2.key;
      var col2 = head2 && !!ganttState.collapsed[g2.key];
      if(head2){
        out.push({ type: "group", key: g2.key, name: g2.name, depth: 2, count: g2.count, collapsed: col2, top: top });
        top += groupH;
        if(col2) return;
      }
      g2.rows.forEach(function(x){
        out.push({ type: "row", x: x, top: top });
        top += rowH;
      });
    });
  });
  ganttState.layoutH = top;
  return out;
}
function ganttGroupHeadHTML(e){
  return '<div class="gantt-group">' +
    '<button class="gantt-group-head' + (e.depth === 2 ? " depth-2" : "") + '" type="button" data-gantt-group-toggle="' + esc(e.key) + '" aria-expanded="' + (!e.collapsed) + '">' +
      '<span class="gantt-group-caret" aria-hidden="true">' + (e.collapsed ? "▸" : "▾") + '</span>' +
      '<span class="gantt-group-name">' + esc(e.name) + '</span>' +
      '<span class="gantt-group-cnt">' + e.count + ' 项</span>' +
    '</button>' +
  '</div>';
}
function ganttBaselineDelta(t){
  var b = ganttState.baseline[t.id];
  if(!b) return null;
  var curEnd = parseDate(t.dueDate) || parseDate(t.startDate);
  var baseEnd = parseDate(b.dueDate) || parseDate(b.startDate);
  if(!curEnd || !baseEnd) return null;
  return dayDiff(curEnd, baseEnd);
}
function ganttBaselineDeviation(t){
  if(!ganttState.baselineOn) return null;
  return ganttBaselineDelta(t);
}
function ganttRowInfoHTML(t){
  var est = Number(t.estimateMinutes) || 0, act = Number(t.totalMinutes) || 0;
  var subAll = Number(t.subtaskTotal) || 0, subDone = Number(t.subtaskDone) || 0;
  var out = "";
  if(ganttState.cols.work && (est || act)){
    var cls = "";
    if(est && act){
      var r = act / est;
      if(r > 1.1) cls = " over";
      else if(r < 0.8) cls = " under";
    }
    var parts = [];
    if(est) parts.push("估 " + fmtMinutesShort(est));
    if(act) parts.push("实 " + fmtMinutesShort(act));
    out += '<span class="wk' + cls + '">' + esc(parts.join(" · ")) + '</span>';
  }
  if(ganttState.cols.subtask && subAll > 0){
    out += '<span class="sub">子任务 ' + subDone + '/' + subAll + '</span>';
  }
  if(ganttState.cols.tags && t.tags && t.tags.length){
    var tl = t.tags.slice(0, 2).join(" · ") + (t.tags.length > 2 ? " +" + (t.tags.length - 2) : "");
    out += '<span class="sub">#' + esc(tl) + '</span>';
  }
  if(ganttState.cols.comments && Number(t.commentCount) > 0){
    out += '<span class="sub">评论 ' + Number(t.commentCount) + '</span>';
  }
  var dev = ganttBaselineDeviation(t);
  if(dev !== null){
    var dcls = dev > 0 ? " over" : (dev < 0 ? " under" : "");
    var dtxt = dev === 0 ? "按基线" : ("基线 " + (dev > 0 ? "+" : "-") + Math.abs(dev) + "d");
    out += '<span class="wk' + dcls + '">' + esc(dtxt) + '</span>';
  }
  return out ? '<span class="gantt-info">' + out + '</span>' : "";
}
function ganttBaselineHTML(t, range, dayW){
  if(!ganttState.baselineOn) return "";
  var b = ganttState.baseline[t.id];
  if(!b) return "";
  var bs = parseDate(b.startDate) || parseDate(b.dueDate);
  var be = parseDate(b.dueDate) || bs;
  if(!bs || !be) return "";
  if(bs > be){ var bsTmp = bs; bs = be; be = bsTmp; }
  if(be < range.start || bs > range.end) return "";
  var s2 = bs < range.start ? range.start : bs;
  var e2 = be > range.end ? range.end : be;
  var off = dayDiff(s2, range.start);
  var span = Math.max(1, dayDiff(e2, s2) + 1);
  return '<span class="gantt-baseline" style="left:' + (off * dayW) + 'px;width:' + (span * dayW) + 'px"></span>';
}
function ganttRowHTML(x, range, dayW, totalW){
  var t = x.t, s = x.rs || x.s, e = x.re || x.e;
  var off = dayDiff(s, range.start);
  var span = Math.max(1, dayDiff(e, s) + 1);
  var left = off * dayW, width = span * dayW;
  var p = progressOf(t);
  var done = t.boardColumn === "done";
  var st = ganttStatusOf(t);
  var bc = st.color;
  var selected = !!ganttState.sel[t.id];
  var isMs = !!t.isMilestone;
  var critical = !!(ganttState.showCritical && ganttState.critical && ganttState.critical[t.id]);
  var rn = t.reqId ? reqNameById(t.reqId) : "";
  if(rn === "无") rn = "";
  var meta = '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>';
  if(ganttState.cols.project && rn) meta += '<span class="ellipsis shrink">' + esc(rn) + '</span>';
  if(ganttState.cols.owner && t.owner) meta += '<span class="ellipsis">' + esc(t.owner) + '</span>';
  var realS = parseDate(t.startDate) || parseDate(t.dueDate);
  var realE = parseDate(t.dueDate) || parseDate(t.startDate) || realS;
  /* 里程碑是单日节点，只显示一个日期；普通区间跨年时给后端点补年份，避免「11-13→02-08」看不出是明年 */
  var rangeText;
  if(isMs){
    rangeText = fmtShortMD(realS);
  }else if(t.startDate && t.dueDate){
    rangeText = fmtShortMD(realS) + '→' +
      (realS.getFullYear() !== realE.getFullYear()
        ? (realE.getFullYear() + '-' + fmtShortMD(realE))
        : fmtShortMD(realE));
  }else{
    var one = t.startDate ? realS : realE;
    var oneTxt = fmtShortMD(one);
    if(one.getFullYear() !== rt.TODAY.getFullYear()) oneTxt = one.getFullYear() + '-' + oneTxt;
    rangeText = (t.startDate ? '开始 ' : '截止 ') + oneTxt;
  }
  if(ganttState.cols.dates) meta += '<span>' + rangeText + '</span>';
  if(isMs) meta += '<span class="meta">里程碑</span>';
  if(st.key === "overdue"){
    meta += '<span class="meta over">逾期 ' + st.days + ' 天</span>';
  }else if(st.key === "blocked"){
    meta += '<span class="meta blocked">' + icon("alert", 12) + '阻塞' +
      (st.days ? ' · 逾期 ' + st.days + ' 天' : '') + '</span>';
  }
  var fullRange = isMs
    ? fmtFull(realS) + "（里程碑）"
    : ((t.startDate && t.dueDate)
      ? fmtFull(realS) + " → " + fmtFull(realE)
      : (t.startDate ? "开始 " + fmtFull(realS) : "截止 " + fmtFull(realE)));
  var statusText = st.key === "done" ? "已完成"
    : st.key === "blocked" ? ("阻塞" + (st.days ? "，逾期 " + st.days + " 天" : ""))
    : st.key === "overdue" ? ("逾期 " + st.days + " 天")
    : "进行中";
  var barTitle = t.title + " · " + fullRange + " · 进度 " + p + "% · " + statusText +
    (rn ? " · " + rn : "") + (t.owner ? " · " + t.owner : "");
  var est = Number(t.estimateMinutes) || 0, act = Number(t.totalMinutes) || 0;
  if(est || act){
    barTitle += " · 估 " + (est ? fmtMinutesShort(est) : "—") + " / 实 " + (act ? fmtMinutesShort(act) : "—");
  }
  if(critical) barTitle += " · 关键路径";
  var dev = ganttBaselineDelta(t);
  if(dev !== null) barTitle += " · 基线" + (dev === 0 ? "一致" : (dev > 0 ? "推迟 " + dev + " 天" : "提前 " + Math.abs(dev) + " 天"));
  var aria = t.title + "，" + fullRange + "，进度 " + p + "%，状态：" + statusText +
    (selected ? "，已选中" : "") + "。按 Enter 打开详情";
  var handles = (!isMs && t.startDate && t.dueDate)
    ? '<span class="gantt-handle l" data-gantt-handle="l"></span><span class="gantt-handle r" data-gantt-handle="r"></span>'
    : "";
  var linkDot = ganttReadOnly() ? "" :
    '<span class="gantt-link-dot" data-gantt-link="' + esc(t.id) + '" title="拖到另一条任务上建立依赖"></span>';
  var ghost = ganttBaselineHTML(t, range, dayW);
  var rowClass = "gantt-row" + (selected ? " is-selected" : "");
  var labelHTML = '<button class="gantt-label" type="button" data-gantt-open="' + esc(t.id) + '">' +
      '<span class="gantt-title">' + esc(t.title) + '</span>' +
      '<span class="gantt-meta">' + meta + '</span>' +
      ganttRowInfoHTML(t) +
    '</button>';

  if(isMs){
    var mw = Math.max(dayW, 18);
    var ml = off * dayW + (dayW - mw) / 2;
    return '<div class="' + rowClass + '" data-gantt-row-id="' + esc(t.id) + '">' +
      labelHTML +
      '<div class="gantt-track" style="width:' + totalW + 'px">' + ghost +
        '<div class="gantt-milestone-wrap' + (selected ? " is-selected" : "") + '"' +
          ' data-gantt-bar="' + esc(t.id) + '" data-gantt-milestone="1" role="button" tabindex="0"' +
          ' aria-label="' + esc(aria) + '" title="' + esc(barTitle) + '"' +
          ' style="left:' + ml + 'px;width:' + mw + 'px">' +
          '<span class="gantt-milestone' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
            (critical ? " is-critical" : "") + '"></span>' + linkDot +
        '</div>' +
      '</div>' +
    '</div>';
  }

  var inner = "";
  var hasStatus = st.key !== "doing";
  if(width >= 110 && !(hasStatus && width < 200)){
    inner += '<span class="gantt-bar-label">' + esc((done ? "✓ " : "") + t.title) + '</span>';
  }
  if(width >= 72){
    inner += '<span class="gantt-bar-stat">' + esc(hasStatus ? st.badge : (p + "%")) + '</span>';
  }else if(width >= 28 && hasStatus){
    inner += '<span class="gantt-bar-flag" aria-hidden="true">' + (done ? "✓" : "!") + '</span>';
  }
  if(hasStatus && !done && width >= 150){
    inner += '<span class="gantt-bar-pct">' + p + '%</span>';
  }
  return '<div class="' + rowClass + '" data-gantt-row-id="' + esc(t.id) + '">' +
    labelHTML +
    '<div class="gantt-track" style="width:' + totalW + 'px">' + ghost +
      '<div class="gantt-bar' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
        (st.key === "overdue" ? " is-overdue" : "") + (selected ? " is-selected" : "") +
        (critical ? " is-critical" : "") + '"' +
        ' data-gantt-bar="' + esc(t.id) + '" role="button" tabindex="0" aria-label="' + esc(aria) + '"' +
        ' style="left:' + left + 'px;width:' + width + 'px;--bc:' + bc.c +
        ';--bc-soft:' + bc.soft + ';--bc-bd:' + bc.bd + '"' +
        ' title="' + esc(barTitle) + '">' +
        (inner ? '<span class="gantt-bar-inner">' + inner + '</span>' : '') +
        '<span class="gantt-bar-fill" style="width:' + p + '%"></span>' + handles + linkDot +
      '</div>' +
    '</div>' +
  '</div>';
}
function ganttExpectedDeps(){
  /* 依赖表为空时，兼容 P0 的 blockedByTaskId（后端迁移前/旧数据） */
  if(ganttState.depsLoaded) return ganttState.deps;
  var out = [];
  ganttState.tasks.forEach(function(t){
    if(t.blockedByTaskId && t.blockedByTaskId !== t.id){
      out.push({ id: "legacy:" + t.id, fromTaskId: t.blockedByTaskId, toTaskId: t.id, depType: "FS", lagDays: 0 });
    }
  });
  return out;
}
function ganttDepsHTML(geom, range, dayW, totalW, bodyH, headH){
  var all = ganttExpectedDeps();
  if(!all.length) return "";
  var labelW = ganttLabelW();
  var w = labelW + totalW, h = headH + bodyH;
  var out = [];
  all.forEach(function(d){
    var pred = geom[d.fromTaskId], succ = geom[d.toTaskId];
    if(!pred || !succ) return;
    var type = d.depType || "FS", lag = Number(d.lagDays) || 0;
    /* 主页面所有类型都保持 FS 式连线（历史视觉），端点计算与分享页共用同一套函数 */
    var g = GS.depGeometry(type, pred, succ, {
      fsLike: true, dayW: dayW, labelW: labelW, rangeStart: range.start,
      rowH: GANTT_ROW_H, headH: headH, predTop: pred.top, succTop: succ.top
    });
    var x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
    var conflict = GS.depConflict(
      { s: pred.s, e: pred.e, as: pred.as, ae: pred.ae, done: !!(pred.t && pred.t.boardColumn === "done") },
      { s: succ.s, e: succ.e, as: succ.as, ae: succ.ae },
      type, lag
    );
    var critical = !!(ganttState.showCritical && ganttState.criticalDeps && ganttState.criticalDeps[d.id]);
    var path = GS.depPath(x1, y1, x2, y2);
    var cls = "gantt-dep" + (conflict ? " is-conflict" : "") + (critical ? " is-critical-dep" : "");
    var tip = "「" + succ.t.title + "」依赖「" + pred.t.title + "」(" + type +
      (lag ? (lag > 0 ? "+" : "") + lag + " 天" : "") + ")" +
      (conflict ? "；排期冲突" : "") + (critical ? "；关键路径" : "");
    out.push('<path class="' + cls + '" d="' + path + '"' +
      ' marker-end="url(#' + (conflict ? "ganttDepArrowBad" : "ganttDepArrow") + ')"' +
      ' data-gantt-dep="' + esc(d.id) + '" data-dep-from="' + esc(d.fromTaskId) + '"' +
      ' data-dep-to="' + esc(d.toTaskId) + '">' +
      '<title>' + esc(tip) + '</title></path>');
    if(type !== "FS" || lag){
      var bx = Math.round((x1 + x2) / 2), by = Math.round((y1 + y2) / 2) - 4;
      out.push('<text class="gantt-dep-badge" x="' + bx + '" y="' + by + '" text-anchor="middle">' +
        type + (lag ? ((lag > 0 ? "+" : "") + lag) : "") + '</text>');
    }
  });
  if(!out.length) return "";
  var defs = '<defs>' +
    '<marker id="ganttDepArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)"></path></marker>' +
    '<marker id="ganttDepArrowBad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--danger)"></path></marker>' +
    '</defs>';
  return '<svg class="gantt-deps" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    defs + out.join("") + '</svg>';
}
function ganttDepStart(dep, from){
  var to = dep.to, lag = dep.lag;
  if(dep.type === "SS") return from.es + lag;
  if(dep.type === "FF") return from.ef + lag - to.dur + 1;
  if(dep.type === "SF") return from.es + lag - to.dur + 1;
  return from.ef + 1 + lag;
}
function ganttDepLimit(dep){
  var from = dep.from, to = dep.to, lag = dep.lag;
  if(dep.type === "SS") return to.ls - lag + from.dur - 1;
  if(dep.type === "FF") return to.lf - lag;
  if(dep.type === "SF") return to.lf - lag + from.dur - 1;
  return to.ls - 1 - lag;
}
function ganttComputeCritical(){
  var list = [], map = {};
  ganttState.tasks.forEach(function(t){
    var s = parseDate(t.startDate) || parseDate(t.dueDate);
    var e = parseDate(t.dueDate) || s;
    if(!s || !e) return;
    if(e < s){ var tmp = s; s = e; e = tmp; }
    var item = { id: t.id, s: s, e: e, dur: dayDiff(e, s) + 1, es: 0, ef: 0, ls: 0, lf: 0, indeg: 0, outs: [], ins: [] };
    list.push(item);
    map[t.id] = item;
  });
  if(!list.length) return { tasks: {}, deps: {} };
  var deps = [];
  ganttExpectedDeps().forEach(function(d){
    var a = map[d.fromTaskId], b = map[d.toTaskId];
    if(!a || !b) return;
    var dep = { id: d.id, from: a, to: b, type: d.depType || "FS", lag: Number(d.lagDays) || 0 };
    deps.push(dep);
    a.outs.push(dep);
    b.ins.push(dep);
    b.indeg++;
  });
  if(!deps.length) return { tasks: {}, deps: {} };

  var base = list[0].s;
  list.forEach(function(t){ if(t.s < base) base = t.s; });
  list.forEach(function(t){ t.es = dayDiff(t.s, base); t.ef = t.es + t.dur - 1; });

  var queue = [], topo = [];
  list.forEach(function(t){ if(!t.indeg) queue.push(t); });
  while(queue.length){
    var cur = queue.shift();
    topo.push(cur);
    cur.outs.forEach(function(dep){
      var cand = ganttDepStart(dep, cur);
      if(cand > dep.to.es){
        dep.to.es = cand;
        dep.to.ef = cand + dep.to.dur - 1;
      }
      dep.to.indeg--;
      if(!dep.to.indeg) queue.push(dep.to);
    });
  }
  if(topo.length !== list.length) return null;   // 有环

  var projectEnd = 0;
  list.forEach(function(t){ if(t.ef > projectEnd) projectEnd = t.ef; });
  list.forEach(function(t){ t.lf = projectEnd; });
  topo.slice().reverse().forEach(function(t){
    t.ls = t.lf - t.dur + 1;
    t.ins.forEach(function(dep){
      var lim = ganttDepLimit(dep);
      if(lim < dep.from.lf) dep.from.lf = lim;
    });
  });

  var criticalTasks = {}, criticalDeps = {};
  list.forEach(function(t){
    if(t.ls - t.es <= 0) criticalTasks[t.id] = true;
  });
  deps.forEach(function(dep){
    if(!criticalTasks[dep.from.id] || !criticalTasks[dep.to.id]) return;
    if(ganttDepStart(dep, dep.from) === dep.to.es) criticalDeps[dep.id] = true;
  });
  return { tasks: criticalTasks, deps: criticalDeps };
}
function ganttPrepareCritical(){
  ganttState.critical = null;
  ganttState.criticalDeps = {};
  if(!ganttState.showCritical) return;
  var res = ganttComputeCritical();
  if(res === null){
    ganttState.notice = "依赖存在循环，无法计算关键路径";
    return;
  }
  ganttState.critical = res.tasks;
  ganttState.criticalDeps = res.deps;
}
function ganttSelCount(){ return Object.keys(ganttState.sel).length; }
function ganttClearSelection(){
  if(!ganttSelCount() && !ganttState.selAnchor) return;
  ganttState.sel = {}; ganttState.selAnchor = null;
  renderGantt();
}
function ganttToggleSelection(id){
  if(ganttState.sel[id]) delete ganttState.sel[id];
  else ganttState.sel[id] = true;
  ganttState.selAnchor = id;
  renderGantt();
}
function ganttSelectRange(id){
  /* 按屏幕上的行顺序取范围（分组/折叠后与 rows 顺序不同） */
  var order = [];
  ganttState.layout.forEach(function(e){ if(e.type === "row") order.push(e.x.t.id); });
  if(!order.length) order = ganttState.rows.map(function(x){ return x.t.id; });
  var a = order.indexOf(ganttState.selAnchor), b = order.indexOf(id);
  ganttState.sel = {};
  if(a === -1 || b === -1){
    ganttState.sel[id] = true;
  }else{
    for(var i = Math.min(a, b); i <= Math.max(a, b); i++) ganttState.sel[order[i]] = true;
  }
  ganttState.selAnchor = id;
  renderGantt();
}
function ganttPushUndo(label, changes){
  if(!changes || !changes.length) return;
  ganttState.undo.push({ label: label, changes: changes });
  if(ganttState.undo.length > 20) ganttState.undo.shift();
  syncGanttUndoUI();
}
function syncGanttUndoUI(){
  if(!ganttUndoBtn) return;
  var n = ganttState.undo.length;
  ganttUndoBtn.disabled = n === 0;
  ganttUndoBtn.textContent = n > 1 ? ("撤销 " + n) : "撤销";
}
function ganttPutSeq(items){
  var i = 0, applied = [];
  function next(){
    if(i >= items.length) return Promise.resolve(applied);
    var it = items[i++];
    return API.put("/api/tasks/" + encodeURIComponent(it.task.id), taskPayloadWith(it.task, it.patch)).then(function(){
      applied.push(it);
      return next();
    });
  }
  return next().catch(function(err){
    var j = 0;
    function back(){
      if(j >= applied.length) return Promise.reject(err);
      var a = applied[j++];
      var restore = { startDate: a.task.startDate || null, dueDate: a.task.dueDate || null };
      return API.put("/api/tasks/" + encodeURIComponent(a.task.id), taskPayloadWith(a.task, restore)).then(back, back);
    }
    return back();
  });
}
function ganttUndoLast(){
  if(ganttState.drag || ganttState.unplannedDrag || ganttState.depDrag || ganttState.undoBusy) return;
  if(!ganttState.undo.length){ toast("没有可撤销的改期", "warn"); return; }
  var entry = ganttState.undo.pop();
  ganttState.undoBusy = true;
  syncGanttUndoUI();
  var skipped = 0, items = [];
  /* 缓存里找不到（比如切换了筛选）就按 id 拉一次最新任务，避免误判“任务已不存在” */
  Promise.all(entry.changes.map(function(c){
    var cur = ganttState.byId[c.id] || taskById(c.id) || null;
    if(cur) return Promise.resolve({ c: c, cur: cur });
    return API.get("/api/task/" + encodeURIComponent(c.id)).then(function(t){
      return { c: c, cur: t };
    }, function(){ return { c: c, cur: null }; });
  })).then(function(list){
    list.forEach(function(x){
      if(!x.cur){ skipped++; return; }
      /* 撤销前确认任务仍是那次操作后的状态，避免覆盖后来在别处做的修改 */
      if(String(x.cur.startDate || "") !== String(x.c.after.startDate || "") ||
         String(x.cur.dueDate || "") !== String(x.c.after.dueDate || "")){ skipped++; return; }
      items.push({ task: x.cur, patch: { startDate: x.c.before.startDate, dueDate: x.c.before.dueDate } });
    });
    if(!items.length){
      ganttState.undoBusy = false;
      toast(skipped ? "任务已被再次修改，未撤销" : "没有可撤销的改期", "bad");
      loadGantt();
      return;
    }
    return ganttPutSeq(items).then(function(){
      ganttState.undoBusy = false;
      toast("已撤销「" + entry.label + "」" + (skipped ? "（" + skipped + " 项已变更，未恢复）" : ""), "fs");
      loadGantt(); loadBoard({silent:true}); refreshListIfOpen(); refreshCalendarIfOpen();
    }).catch(function(ex){
      ganttState.undoBusy = false;
      toast("撤销失败：" + (ex.message || "网络异常"), "bad");
      loadGantt();
    });
  });
}
function ganttCsvCell(v){
  v = (v === null || v === undefined) ? "" : String(v);
  /* 公式注入：Excel 会把 = + - @ 开头的单元格当公式执行；纯数字（含负数）保持可计算 */
  if(!/^-?\d+(\.\d+)?$/.test(v) && /^\s*[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}
function ganttStatusText(t){
  var st = ganttStatusOf(t);
  if(st.key === "done") return "已完成";
  if(st.key === "blocked") return "阻塞" + (st.days ? " · 逾期 " + st.days + " 天" : "");
  if(st.key === "overdue") return "逾期 " + st.days + " 天";
  return "进行中";
}
function ganttCsvText(scope, rowsOverride){
  var rows = rowsOverride || ((scope === "all") ? ganttAllTasks() : ganttState.rows);
  var lines = [];
  lines.push(["任务","状态","优先级","项目","负责人","开始","截止","工期(天)","进度%","估时(小时)","实际(小时)","子任务","里程碑","基线偏差(天)","标签","看板列"]
    .map(ganttCsvCell).join(","));
  rows.forEach(function(it){
    var t = it.t || it;
    var s = parseDate(t.startDate) || parseDate(t.dueDate);
    var e = parseDate(t.dueDate) || s;
    var rn = t.reqId ? reqNameById(t.reqId) : "";
    if(rn === "无") rn = "";
    var sub = Number(t.subtaskTotal) > 0 ? (Number(t.subtaskDone) || 0) + "/" + t.subtaskTotal : "";
    lines.push([
      t.title,
      ganttStatusText(t),
      t.priority || "",
      rn,
      t.owner || "",
      t.startDate || "",
      t.dueDate || "",
      (s && e) ? (dayDiff(e, s) + 1) : "",
      progressOf(t),
      t.estimateMinutes ? (Number(t.estimateMinutes) / 60).toFixed(1) : "",
      t.totalMinutes ? (Number(t.totalMinutes) / 60).toFixed(1) : "",
      sub,
      t.isMilestone ? "是" : "",
      (function(){ var dv = ganttBaselineDelta(t); return dv === null ? "" : dv; })(),
      (t.tags || []).join(" "),
      colName(t.boardColumn)
    ].map(ganttCsvCell).join(","));
  });
  return lines.join("\r\n");
}
function ganttDownloadCsv(text, name){
  var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){
    URL.revokeObjectURL(url);
    if(a.parentNode) a.parentNode.removeChild(a);
  }, 0);
  toast("已导出 " + name, "fs");
}
function ganttExportAllRemote(){
  if(ganttState.exportBusy){ toast("正在准备导出…", "warn"); return; }
  ganttState.exportBusy = true;
  var collected = [], unplanned = null, offset = 0, seenIds = {};
  function ingest(list){
    (list || []).forEach(function(t){
      if(!t || !t.id || seenIds[t.id]) return;
      seenIds[t.id] = 1;
      collected.push(t);
    });
  }
  function step(){
    var params = ganttTaskParams(offset, 500);
    delete params.from;
    delete params.to;
    API.get("/api/gantt", params).then(function(d){
      var items = (d && d.items) || [];
      ingest(items);
      if(offset === 0 && Array.isArray(d && d.unscheduled)) unplanned = d.unscheduled;
      if(d && d.hasMore && items.length && collected.length < 20000){
        offset += items.length;
        step();
        return;
      }
      ganttState.exportBusy = false;
      ingest(unplanned || []);
      var all = collected;
      if(!all.length){ toast("当前筛选下没有任务", "warn"); return; }
      ganttDownloadCsv(ganttCsvText("all", all), "甘特图-" + rt.TODAY_ISO + "-全部筛选.csv");
    }).catch(function(ex){
      ganttState.exportBusy = false;
      toast("导出失败：" + (ex.message || "网络异常"), "bad");
    });
  }
  step();
}
function ganttExportCsv(scope){
  /* 月视图只加载本月；自动范围若触及加载上限，也要重新按无区间分页拉全 */
  if(scope === "all" && (ganttState.rangeMode === "month" || ganttState.paging.hasMore)){
    ganttExportAllRemote();
    return;
  }
  if(!ganttAllTasks().length){ toast("当前没有可导出的任务", "warn"); return; }
  if(scope !== "all" && !ganttState.rows.length){ toast("当前范围没有已排期任务", "warn"); return; }
  var name = "甘特图-" + rt.TODAY_ISO + (scope === "all" ? "-全部筛选" : "-当前范围") + ".csv";
  ganttDownloadCsv(ganttCsvText(scope), name);
}
function ganttAnalysisItem(attr, label, active, hint){
  return '<button class="menu-item" type="button" ' + attr + '>' +
    '<span class="gantt-analysis-check">' + (active ? "✓" : "") + '</span>' + label +
    (hint ? '<span class="k">' + hint + '</span>' : '') + '</button>';
}
function renderGanttAnalysisMenu(){
  if(!ganttAnalysisMenu) return;
  var hasBaseline = !!ganttState.baselineAt;
  var isOwner = !!(rt.currentWs && rt.currentWs.myRole === "owner");
  ganttAnalysisMenu.innerHTML = '<div class="menu-title">分析</div>' +
    ganttAnalysisItem('data-gantt-critical', '关键路径高亮', ganttState.showCritical, '') +
    ganttAnalysisItem('data-gantt-baseline-toggle', '显示基线', ganttState.baselineOn, hasBaseline ? '' : '未设置') +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-gantt-baseline-set>设为基线（当前计划）</button>' +
    (isOwner ? '<button class="menu-item" type="button" data-gantt-baseline-clear"' + (hasBaseline ? '' : ' disabled') + '>清除基线</button>' : '') +
    '<div class="menu-sep"></div>' +
    ganttAnalysisItem('data-gantt-load', '资源负载面板', ganttState.showLoad, '') +
    (isOwner ? '<button class="menu-item" type="button" data-gantt-share>分享只读链接…</button>' : '');
}
function ganttApplyBaselineInfo(info){
  ganttState.baseline = (info && info.baseline) || {};
  ganttState.baselineAt = (info && info.baselineAt) || null;
  if(!ganttState.baselineAt) ganttState.baselineOn = false;
  saveGanttPrefs();
  renderGanttAnalysisMenu();
}
function ganttToggleCritical(){
  ganttState.showCritical = !ganttState.showCritical;
  saveGanttPrefs();
  renderGantt();
  renderGanttAnalysisMenu();
  if(ganttState.showCritical){
    if(!ganttState.critical || !Object.keys(ganttState.critical).length){
      toast(ganttState.notice || "没有可计算的关键路径（需要依赖关系）", "warn");
    }else{
      toast("已高亮 " + Object.keys(ganttState.critical).length + " 个关键任务", "fs");
    }
  }
}
function ganttToggleBaseline(){
  if(!ganttState.baselineAt){ toast("还没有基线，先点「设为基线」", "warn"); return; }
  ganttState.baselineOn = !ganttState.baselineOn;
  saveGanttPrefs();
  renderGantt();
  renderGanttAnalysisMenu();
}
function ganttCaptureBaseline(){
  if(ganttReadOnly()){ toast("移动端只读，不能设置基线", "warn"); return; }
  API.post("/api/gantt/baseline").then(function(info){
    ganttApplyBaselineInfo(info);
    ganttState.baselineOn = !!ganttState.baselineAt;
    saveGanttPrefs();
    renderGantt();
    toast("已把当前计划设为基线", "fs");
  }).catch(function(ex){ toast("设置基线失败：" + (ex.message || "网络异常"), "bad"); });
}
function ganttClearBaseline(){
  if(ganttReadOnly()){ toast("移动端只读，不能清除基线", "warn"); return; }
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可清除基线", "warn"); return; }
  UI.showConfirm({ title:"清除基线", msg:"清除后无法再对比「计划 vs 当前」，确定？", okText:"清除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/gantt/baseline").then(function(){
      ganttState.baseline = {};
      ganttState.baselineAt = null;
      ganttState.baselineOn = false;
      saveGanttPrefs();
      renderGantt();
      renderGanttAnalysisMenu();
      toast("基线已清除", "fs");
    }).catch(function(ex){ toast("清除失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
function ganttToggleLoad(){
  if(!ganttState.showLoad && !ganttState.range){ toast("当前没有可统计的排期范围", "warn"); return; }
  ganttState.showLoad = !ganttState.showLoad;
  saveGanttPrefs();
  if(!ganttState.showLoad){
    ganttState.loadData = null;
    ganttState.loadDoneKey = "";
    ganttState.loadLoading = false;
    ganttState.loadSeq++;
  }
  syncGanttLoadPanel();
  renderGanttAnalysisMenu();
}
function syncGanttLoadPanel(){
  if(!ganttLoadBox) return;
  ganttLoadBox.hidden = !ganttState.showLoad;
  if(ganttState.showLoad) loadGanttLoad();
}
function ganttLoadKey(){
  if(!ganttState.range) return "";
  return iso(ganttState.range.start) + "|" + iso(ganttState.range.end);
}
function loadGanttLoad(){
  var key = ganttLoadKey();
  if(!key || !ganttLoadBody) return;
  if(ganttState.loadData && ganttState.loadDoneKey === key){ renderGanttLoad(); return; }
  if(ganttState.loadLoading && ganttState.loadKey === key) return;
  var seq = ++ganttState.loadSeq;
  ganttState.loadLoading = true;
  ganttState.loadKey = key;
  ganttLoadBody.innerHTML = '<div class="gantt-load-empty">加载中…</div>';
  API.get("/api/gantt/load", { from: iso(ganttState.range.start), to: iso(ganttState.range.end) }).then(function(d){
    if(seq !== ganttState.loadSeq) return;
    ganttState.loadLoading = false;
    ganttState.loadData = d;
    ganttState.loadDoneKey = key;
    if(ganttState.showLoad) renderGanttLoad();
  }).catch(function(ex){
    if(seq !== ganttState.loadSeq) return;
    ganttState.loadLoading = false;
    if(ganttLoadBody) ganttLoadBody.innerHTML = '<div class="gantt-load-empty">负载加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderGanttLoad(){
  var d = ganttState.loadData;
  if(!ganttLoadBody || !d || !d.weeks || !d.weeks.length){
    if(ganttLoadBody) ganttLoadBody.innerHTML = '<div class="gantt-load-empty">当前范围没有可统计的周。</div>';
    return;
  }
  if(ganttLoadRangeEl) ganttLoadRangeEl.textContent = d.from + " → " + d.to + " · 每周容量 40h";
  var html = '<div class="gantt-load-grid" style="--load-weeks:' + d.weeks.length + '">' +
    '<span class="lh">成员</span>' +
    d.weeks.map(function(w){ return '<span class="lh">' + fmtShortMD(parseDate(w)) + '</span>'; }).join("");
  d.members.forEach(function(m){
    html += '<span class="lm" title="' + esc(m.name) + '">' + esc(m.name) + '</span>';
    d.weeks.forEach(function(w){
      var b = null;
      (m.buckets || []).forEach(function(x){ if(x.weekStart === w) b = x; });
      if(!b){ html += '<span class="gantt-load-cell empty"></span>'; return; }
      var ratio = b.capacityMinutes ? b.estimateMinutes / b.capacityMinutes : 0;
      var cls = ratio > 1 ? " over" : (ratio > 0.85 ? " warn" : "");
      html += '<span class="gantt-load-cell' + cls + '" title="预估 ' + fmtMinutes(b.estimateMinutes) +
        ' / 实际 ' + fmtMinutes(b.actualMinutes) + '">' +
        '<b>估 ' + fmtMinutesShort(b.estimateMinutes) + '</b>' +
        '<span>实 ' + fmtMinutesShort(b.actualMinutes) + '</span></span>';
    });
  });
  html += '</div>';
  if(!d.members.length){
    html = '<div class="gantt-load-empty">当前筛选下没有带估时的排期任务。</div>';
  }
  ganttLoadBody.innerHTML = html;
}
function ganttShareUrl(token){
  if(location.protocol === "file:") return "share.html?token=" + token;
  return location.origin + "/share.html?token=" + encodeURIComponent(token);
}
function ganttFillShare(token){
  var input = $("ganttShareUrl");
  if(!input) return;
  input.value = ganttShareUrl(token);
  $("ganttShareCopy").textContent = "复制链接";
  $("ganttShareRevoke").hidden = false;
}
function openGanttShare(){
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可生成或查看分享链接", "warn"); return; }
  var dlg = $("dlgGanttShare");
  if(!dlg){ toast("分享弹窗未加载", "bad"); return; }
  $("ganttShareUrl").value = "";
  $("ganttShareCopy").textContent = "生成链接";
  $("ganttShareRevoke").hidden = true;
  UI.openModal(dlg);
  API.get("/api/gantt/share").then(function(s){
    if(s && s.token) ganttFillShare(s.token);
  }).catch(function(){ /* 没有分享或没权限时保持“生成链接” */ });
}
function ganttCopyShare(){
  var input = $("ganttShareUrl");
  if(!input) return;
  if(!input.value){
    if(ganttReadOnly()){ toast("移动端只读，不能生成分享链接", "warn"); return; }
    API.post("/api/gantt/share").then(function(s){
      ganttFillShare(s.token);
      toast("分享链接已生成（30 天有效）", "fs");
    }).catch(function(ex){ toast("生成失败：" + (ex.message || "网络异常"), "bad"); });
    return;
  }
  try{
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  }catch(e){ /* noop */ }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(input.value).then(function(){ toast("链接已复制", "fs"); },
      function(){ toast("复制失败，请手动选中复制", "bad"); });
    return;
  }
  var ok = false;
  try{ ok = document.execCommand("copy"); }catch(e2){ ok = false; }
  toast(ok ? "链接已复制" : "复制失败，请手动选中复制", ok ? "fs" : "bad");
}
function ganttRevokeShare(){
  if(ganttReadOnly()){ toast("移动端只读，不能停止分享", "warn"); return; }
  UI.showConfirm({ title:"停止分享", msg:"停止后旧链接立即失效，查看者无法再打开。", okText:"停止分享" }).then(function(ok){
    if(!ok) return;
    API.del("/api/gantt/share").then(function(){
      $("ganttShareUrl").value = "";
      $("ganttShareCopy").textContent = "生成链接";
      $("ganttShareRevoke").hidden = true;
      toast("已停止分享", "fs");
    }).catch(function(ex){ toast("操作失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
function refreshGanttDeps(){
  API.get("/api/gantt/deps").then(function(list){
    ganttState.deps = list || [];
    ganttState.depsLoaded = true;
    ganttState.depById = {};
    ganttState.deps.forEach(function(d){ ganttState.depById[d.id] = d; });
    ganttState.critical = null;
    renderGantt();
    renderGanttAnalysisMenu();
  }).catch(function(ex){ toast("依赖刷新失败：" + (ex.message || "网络异常"), "bad"); });
}
function openGanttDepMenu(depId, anchorEl){
  if(ganttReadOnly()){ toast("移动端只读，不能编辑依赖", "warn"); return; }
  var dep = ganttState.depById[depId];
  if(!dep){
    toast("旧版依赖暂不支持编辑，请删除后重新连线", "warn");
    return;
  }
  if(!ganttDepMenu) return;
  UI.closeAllPops();
  var type = dep.depType || "FS";
  var fromT = ganttState.byId[dep.fromTaskId], toT = ganttState.byId[dep.toTaskId];
  ganttDepMenu.innerHTML = '<div class="menu-title">依赖：' +
      esc(fromT ? fromT.title : dep.fromTaskId) + ' → ' + esc(toT ? toT.title : dep.toTaskId) + '</div>' +
    '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">类型</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
        ["FS","SS","FF","SF"].map(function(t){
          return '<button class="chip" type="button" data-gantt-dep-type="' + t + '" aria-pressed="' + (type === t) + '">' + t + '</button>';
        }).join("") +
      '</div></div>' +
    '<div class="menu-field"><label class="group-label" for="ganttDepLag" style="display:block;margin-bottom:6px">滞后天数（可为负）</label>' +
      '<input class="input" id="ganttDepLag" type="number" min="-365" max="365" step="1" value="' +
      (dep.lagDays == null ? 0 : dep.lagDays) + '" /></div>' +
    '<div class="menu-foot">' +
      '<button class="btn sm danger" type="button" data-gantt-dep-del>删除</button>' +
      '<button class="btn sm primary" type="button" data-gantt-dep-save>保存</button>' +
    '</div>';
  ganttDepMenu.__depId = depId;
  ganttDepMenu.__depType = type;
  UI.openPop(ganttDepMenu, anchorEl, { align: "left", width: 250 });
}
function ganttLinkPoint(fromId){
  var geom = ganttState.winGeom || {};
  var g = geom[fromId];
  if(!g || !ganttState.range) return null;
  var labelW = ganttLabelW();
  return {
    x: labelW + (dayDiff(g.e, ganttState.range.start) + 1) * ganttState.dayW,
    y: GANTT_HEAD_H + g.top + GANTT_ROW_H / 2
  };
}
function onGanttLinkDown(e){
  var dot = e.target.closest ? e.target.closest("[data-gantt-link]") : null;
  if(!dot || ganttReadOnly()) return;
  var bar = dot.closest("[data-gantt-bar]");
  if(!bar || !ganttState.range) return;
  var fromId = dot.getAttribute("data-gantt-link");
  if(!ganttState.byId[fromId]) return;
  var grid = ganttScroll.querySelector(".gantt-grid");
  var start = ganttLinkPoint(fromId);
  if(!grid || !start) return;
  e.preventDefault();
  e.stopPropagation();
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "gantt-link-temp");
  svg.setAttribute("width", grid.scrollWidth);
  svg.setAttribute("height", grid.scrollHeight);
  var path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M" + start.x + "," + start.y + " L" + start.x + "," + start.y);
  svg.appendChild(path);
  grid.appendChild(svg);
  ganttState.depDrag = { fromId: fromId, x0: start.x, y0: start.y, svg: svg, path: path, target: null };
  document.addEventListener("pointermove", onGanttLinkMove);
  document.addEventListener("pointerup", onGanttLinkEnd);
  document.addEventListener("pointercancel", onGanttLinkCancel);
  document.addEventListener("keydown", onGanttLinkKey);
}
function ganttLinkTargetAt(clientX, clientY, fromId){
  var el = document.elementFromPoint(clientX, clientY);
  var bar = el && el.closest ? el.closest("[data-gantt-bar]") : null;
  if(!bar) return null;
  var id = bar.getAttribute("data-gantt-bar");
  return id && id !== fromId ? bar : null;
}
function onGanttLinkMove(e){
  var d = ganttState.depDrag;
  if(!d) return;
  var grid = ganttScroll.querySelector(".gantt-grid");
  if(!grid) return;
  var gr = grid.getBoundingClientRect();
  var x = e.clientX - gr.left, y = e.clientY - gr.top;
  var bx = d.x0 + 12;
  var path = "M" + d.x0 + "," + d.y0 + " H" + bx + " V" + y + " H" + x;
  d.path.setAttribute("d", path);
  var target = ganttLinkTargetAt(e.clientX, e.clientY, d.fromId);
  if(d.target && d.target !== target) d.target.classList.remove("drop-target");
  if(target) target.classList.add("drop-target");
  d.target = target;
}
function cleanupGanttLink(){
  var d = ganttState.depDrag;
  ganttState.depDrag = null;
  if(d){
    if(d.target) d.target.classList.remove("drop-target");
    if(d.svg && d.svg.parentNode) d.svg.parentNode.removeChild(d.svg);
  }
  document.removeEventListener("pointermove", onGanttLinkMove);
  document.removeEventListener("pointerup", onGanttLinkEnd);
  document.removeEventListener("pointercancel", onGanttLinkCancel);
  document.removeEventListener("keydown", onGanttLinkKey);
}
function onGanttLinkEnd(){
  var d = ganttState.depDrag;
  if(!d) return;
  var target = d.target;
  var fromId = d.fromId;
  cleanupGanttLink();
  if(!target) return;
  var toId = target.getAttribute("data-gantt-bar");
  if(!toId || toId === fromId) return;
  API.post("/api/gantt/deps", { fromTaskId: fromId, toTaskId: toId, depType: "FS", lagDays: 0 }).then(function(){
    toast("已建立依赖（FS）", "fs");
    refreshGanttDeps();
  }).catch(function(ex){
    toast("建立依赖失败：" + (ex.message || "网络异常"), "bad");
  });
}
function onGanttLinkCancel(){ if(ganttState.depDrag) cleanupGanttLink(); }
function onGanttLinkKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  cleanupGanttLink();
}

function ganttUnplannedSuffix(){
  /* 计数以当前可见（showDone 过滤后）为准，避免“列表 1 条、角标 3” */
  var n = ganttState.undated ? ganttState.undated.length : 0;
  return n ? (" · 未排期 " + n + " 项") : "";
}
function ganttAllTasks(){
  var list = ganttState.tasks.slice();
  if(ganttState.serverUnplanned !== null) list = list.concat(ganttState.unplannedTasks);
  return list;
}
function renderGanttUnplanned(list, openIt){
  if(!ganttUnplannedBox) return;
  var total = ganttState.serverUnplanned !== null ? ganttState.unscheduledTotal : list.length;
  ganttUnplannedBox.hidden = !list.length;
  if(!list.length){
    ganttUnplannedList.innerHTML = "";
    ganttUnplannedCount.textContent = String(list.length);
    return;
  }
  ganttUnplannedCount.textContent = String(list.length);
  if(openIt && !ganttState.unplannedAuto){
    ganttUnplannedBox.open = true;
    ganttState.unplannedAuto = true;
  }
  ganttUnplannedList.innerHTML = list.slice(0, 50).map(function(t){
    var rn = t.reqId ? reqNameById(t.reqId) : "";
    if(rn === "无") rn = "";
    var meta = [];
    if(rn) meta.push(esc(rn));
    if(t.owner) meta.push(esc(t.owner));
    meta.push(esc(colName(t.boardColumn)));
    var cat = catTag(t.category);
    return '<button class="gantt-unplanned-row" type="button" data-gantt-open="' + esc(t.id) + '" title="拖到时间轴即可排期">' +
      '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
      '<span class="gantt-unplanned-main">' +
        '<span class="gantt-unplanned-t">' + esc(t.title) + '</span>' +
        '<span class="gantt-unplanned-m">' + (cat ? cat + ' · ' : '') + meta.join(" · ") + '</span>' +
      '</span>' +
      '<span class="tag tag-ghost">未排期</span>' +
    '</button>';
  }).join("") +
  (list.length > 50 ? '<p class="foot-note" style="padding:8px 10px">仅显示前 50 项，共 ' + total + ' 项</p>' : "");
}
function renderGantt(){
  if(!ganttScroll) return;
  var prevLeft = ganttScroll.scrollLeft, prevTop = ganttScroll.scrollTop;
  var all = ganttState.tasks;
  var visible = ganttState.showDone ? all.slice() : all.filter(function(t){ return t.boardColumn !== "done"; });
  var hiddenDone = all.length - visible.length;
  var dated = [], undated = [];
  var serverUnplanned = ganttState.serverUnplanned;
  visible.forEach(function(t){
    var s = parseDate(t.startDate), e = parseDate(t.dueDate);
    if(!s && !e){ if(serverUnplanned === null) undated.push(t); return; }
    if(!s) s = e;
    if(!e) e = s;
    if(s > e){ var tmp = s; s = e; e = tmp; }
    dated.push({ t: t, s: s, e: e, rs: s, re: e });
  });
  if(serverUnplanned !== null){
    var upVisible = ganttState.showDone ? serverUnplanned.slice()
      : serverUnplanned.filter(function(t){ return t.boardColumn !== "done"; });
    hiddenDone += serverUnplanned.length - upVisible.length;
    undated = upVisible;
  }
  ganttState.undated = undated;
  renderGanttUnplanned(undated, dated.length === 0);
  ganttState.notice = ganttState.pendingNotice || "";
  ganttState.pendingNotice = "";

  if(!dated.length){
    renderGanttEmpty(all, visible, hiddenDone, undated);
    return;
  }

  ganttState.dayW = ganttEffectiveDayW();
  ganttSortRows(dated);

  var range;
  if(ganttState.rangeMode === "month"){
    if(!ganttState.anchorMonth) ganttState.anchorMonth = ganttMonthStart(rt.TODAY);
    range = ganttMonthRange(ganttState.anchorMonth);
  }else{
    range = ganttDateRange(dated);
    if(range.days > GANTT_MAX_DAYS){
      /* 不能拿“某一页”的数据继续渲染：直接切月视图并重新按区间查询 */
      ganttState.rangeMode = "month";
      ganttState.anchorMonth = ganttMonthStart(rt.TODAY);
      ganttState.pendingNotice = "任务时间跨度超过 2 年，已切换到月视图；可用上一月/下一月查看其他区间。";
      ganttState.scrolled = true;
      syncGanttControls();
      loadGantt();
      if(ganttScroll) ganttScroll.scrollLeft = 0;
      return;
    }
  }
  range = GS.adjustRange(range, ganttState.scale);
  ganttState.range = range;

  var inRange = dated;
  if(ganttState.rangeMode === "month"){
    inRange = dated.filter(function(x){ return x.s <= range.end && x.e >= range.start; });
    inRange.forEach(function(x){
      x.rs = x.s < range.start ? range.start : x.s;
      x.re = x.e > range.end ? range.end : x.e;
    });
  }
  ganttState.rows = inRange;
  ganttPrepareCritical();

  var dayW = ganttState.dayW;
  var labelW = ganttLabelW();
  /* 周/月刻度内容可能比视口窄：向后补几天，避免右侧留一大块空白 */
  var avail = (ganttScroll.clientWidth || 0) - labelW;
  /* 「月视图」必须严格停在自然月，不能用补齐的方式跨月 */
  if(ganttState.rangeMode !== "month" && avail > 0 && range.days * dayW < avail){
    var needDays = Math.ceil((avail - range.days * dayW) / dayW);
    range.end = addDays(range.end, needDays);
    range.days = dayDiff(range.end, range.start) + 1;
  }
  var totalW = range.days * dayW;
  var todayOff = dayDiff(rt.TODAY, range.start);
  var todayIn = todayOff >= 0 && todayOff < range.days;
  ganttState.layout = ganttBuildLayout(inRange);
  ganttState.win = { start: -1, end: -1 };
  ganttState.emptyMonthHTML = (ganttState.rangeMode === "month" && !inRange.length)
    ? UI.colEmpty("本月没有排期任务；可以翻到上一月/下一月，或把未排期任务拖进时间轴。", "calendar")
    : "";

  var densityClass = 'density-' + ganttState.density;
  var rowH = ganttRowH(), groupH = ganttGroupH();
  ganttScroll.innerHTML = '<div class="gantt-grid is-scale-' + ganttState.scale + ' ' + densityClass + '" style="--gantt-label-w:' + labelW + 'px;--gantt-day-w:' + dayW +
      'px;--gantt-row-h:' + rowH + 'px;--gantt-group-h:' + groupH + 'px;">' +
    '<div class="gantt-head">' +
      '<div class="gantt-corner">任务 <span class="gantt-corner-meta">' + inRange.length + '</span><span class="gantt-resizer" aria-label="拖动调整列宽" role="separator"></span></div>' +
      '<div class="gantt-axis" style="width:' + totalW + 'px">' + GS.headHTML(range, dayW, ganttState.scale, rt.TODAY_ISO) + '</div>' +
    '</div>' +
    '<div class="gantt-body"></div>' +
    (todayIn
      ? '<div class="gantt-today-col" style="left:calc(var(--gantt-label-w) + ' + (todayOff * dayW) + 'px);width:' + dayW + 'px"></div>' +
        '<div class="gantt-today" style="left:calc(var(--gantt-label-w) + ' + (todayOff * dayW) + 'px)"></div>'
      : '') +
  '</div>';
  /* 先按旧滚动位置渲染窗口，再恢复滚动条（空 body 时 scrollTop 会被夹到 0） */
  ganttState.pendingTop = prevTop;
  ganttRenderBody(true);
  ganttState.pendingTop = null;
  ganttScroll.scrollLeft = prevLeft;
  ganttScroll.scrollTop = prevTop;
  if(!ganttState.scrolled){
    ganttState.scrolled = true;
    ganttScrollToToday();
  }
  if(ganttNoticeEl){
    ganttNoticeEl.hidden = !ganttState.notice;
    ganttNoticeEl.textContent = ganttState.notice;
  }
  updateGanttRangeUI();
  ganttMeta.textContent = ganttMetaText({
    count: inRange.length, hiddenDone: hiddenDone, range: range,
    mode: ganttState.rangeMode, total: ganttState.total, allCount: all.length,
    paging: ganttState.paging, baselineAt: ganttState.baselineAt, scale: ganttState.scale
  }) + ganttUnplannedSuffix();
  syncGanttUndoUI();
  if(ganttLoadBox) ganttLoadBox.hidden = !ganttState.showLoad;
  if(ganttState.showLoad) loadGanttLoad();
}
function ganttWindowRange(layout, scrollTop, viewH){
  if(ganttState.pendingTop != null) scrollTop = ganttState.pendingTop;
  if(ganttState.printAll) return { start: 0, end: layout.length };
  if(layout.length <= 120) return { start: 0, end: layout.length };
  var rowH = ganttRowH(), groupH = ganttGroupH();
  var from = Math.max(0, scrollTop - 600), to = scrollTop + viewH + 600;
  var lo = 0, hi = layout.length - 1, first = layout.length;
  while(lo <= hi){
    var mid = (lo + hi) >> 1;
    var e = layout[mid];
    var bottom = e.top + (e.type === "group" ? groupH : rowH);
    if(bottom >= from){ first = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  if(first >= layout.length) first = Math.max(0, layout.length - 1);
  var last = first - 1, lo2 = first, hi2 = layout.length - 1;
  while(lo2 <= hi2){
    var mid2 = (lo2 + hi2) >> 1;
    if(layout[mid2].top <= to){ last = mid2; lo2 = mid2 + 1; } else { hi2 = mid2 - 1; }
  }
  return { start: first, end: Math.max(first, last + 1) };
}
function ganttRenderBody(force){
  if(!ganttScroll || !ganttState.range) return;
  var bodyEl = ganttScroll.querySelector(".gantt-body");
  if(!bodyEl) return;
  var layout = ganttState.layout;
  var win = ganttWindowRange(layout, ganttScroll.scrollTop, ganttScroll.clientHeight || 600);
  if(!force && win.start === ganttState.win.start && win.end === ganttState.win.end) return;
  ganttState.win = win;
  var range = ganttState.range, dayW = ganttState.dayW, totalW = range.days * dayW;
  var rowH = ganttRowH(), groupH = ganttGroupH();
  var html = "", geom = {};
  for(var i = win.start; i < win.end; i++){
    var e = layout[i];
    if(e.type === "group"){
      html += ganttGroupHeadHTML(e);
    }else{
      html += ganttRowHTML(e.x, range, dayW, totalW);
      geom[e.x.t.id] = { top: e.top, s: e.x.rs || e.x.s, e: e.x.re || e.x.e, as: e.x.s, ae: e.x.e, t: e.x.t };
    }
  }
  var topPad = layout.length ? layout[win.start].top : 0;
  var last = layout[win.end - 1];
  var lastH = last ? (last.type === "group" ? groupH : rowH) : 0;
  var bottomPad = Math.max(0, ganttState.layoutH - (last ? last.top + lastH : 0));
  bodyEl.innerHTML = (topPad ? '<div style="height:' + topPad + 'px"></div>' : "") + html +
    (bottomPad ? '<div style="height:' + bottomPad + 'px"></div>' : "") +
    (ganttState.emptyMonthHTML || "");
  ganttState.winGeom = geom;
  var old = ganttScroll.querySelector(".gantt-deps");
  if(old && old.parentNode) old.parentNode.removeChild(old);
  if(layout.length){
    var svg = ganttDepsHTML(geom, range, dayW, totalW, ganttState.layoutH, GANTT_HEAD_H);
    if(svg){
      var grid = ganttScroll.querySelector(".gantt-grid");
      if(grid) grid.insertAdjacentHTML("beforeend", svg);
    }
  }
  syncGanttUndoUI();
}
function renderGanttEmpty(all, visible, hiddenDone, undated){
  ganttState.range = null;
  ganttState.rows = [];
  ganttState.layout = [];
  ganttState.layoutH = 0;
  ganttState.win = { start: -1, end: -1 };
  ganttState.winGeom = {};
  if(ganttLoadBox) ganttLoadBox.hidden = true;
  var title, text, action = "", actionKind = "";
  if(!visible.length && all.length){
    /* 有任务但都被「显示已完成」隐藏了：这条优先于月份空态 */
    title = "当前没有未完成任务";
    text = "已完成任务被隐藏了；勾选上方「显示已完成」可以查看。";
  }else if(ganttState.rangeMode === "month"){
    title = filterOn() ? "本月没有符合筛选的排期任务" : "本月没有排期任务";
    text = "可以翻到上一月/下一月，或把未排期任务拖进时间轴。" +
      (filterOn() ? "当前筛选条件下本月没有任务。" : "");
  }else if(!all.length){
    /* 排期任务为 0 不等于没有任务：未排期区可能还有任务 */
    var anyUnplanned = ganttState.serverUnplanned !== null ? ganttState.unscheduledTotal : undated.length;
    if(anyUnplanned > 0){
      title = "还没有排期任务";
      text = "所有任务都还没有开始/截止日期；在下方「未排期」里拖到时间轴即可排期。";
      action = "去列表"; actionKind = "list";
    }else if(filterOn()){
      title = "没有符合筛选的任务";
      text = "当前筛选条件下没有任务；清除筛选后可查看全部任务。";
      action = "清除筛选"; actionKind = "clear";
    }else{
      title = "还没有任务";
      text = "新建任务并填上开始或截止日期，就会按时间出现在甘特图里。";
      action = "新建任务"; actionKind = "new";
    }
  }else{
    title = "还没有排期任务";
    text = "给任务填上开始或截止日期后，这里会按时间排布。";
    action = "去列表"; actionKind = "list";
  }
  ganttScroll.innerHTML = '<div style="padding:20px">' +
    UI.emptyState({ icon: "calendar", title: title, text: text, actionLabel: action }) + '</div>';
  var btn = ganttScroll.querySelector(".empty-state .btn");
  if(btn) btn.addEventListener("click", function(){
    if(actionKind === "clear") clearFilters();
    else if(actionKind === "new") openTaskDrawer("backlog");
    else showView("list");
  });
  if(ganttNoticeEl){ ganttNoticeEl.hidden = true; ganttNoticeEl.textContent = ""; }
  updateGanttRangeUI();
  ganttMeta.textContent = ganttMetaText({
    count: 0, hiddenDone: hiddenDone, range: null, mode: ganttState.rangeMode,
    total: ganttState.total, allCount: all.length, scale: ganttState.scale
  }) + ganttUnplannedSuffix();
  syncGanttUndoUI();
}
function updateGanttRangeUI(){
  var monthMode = ganttState.rangeMode === "month";
  if(ganttRangeLabelEl){
    ganttRangeLabelEl.textContent = monthMode
      ? ganttMonthLabel(ganttState.anchorMonth || rt.TODAY)
      : "自动范围";
  }
  if(ganttPrevMonthEl) ganttPrevMonthEl.disabled = false;
  if(ganttNextMonthEl) ganttNextMonthEl.disabled = false;
  if(ganttRangeModeEl){
    ganttRangeModeEl.querySelectorAll("[data-gantt-range]").forEach(function(b){
      b.setAttribute("aria-pressed", b.getAttribute("data-gantt-range") === ganttState.rangeMode ? "true" : "false");
    });
  }
}
function ganttScrollToToday(){
  if(!ganttState.range || !ganttScroll) return;
  var off = dayDiff(rt.TODAY, ganttState.range.start);
  if(off < 0) off = 0;
  ganttScroll.scrollLeft = Math.max(0, off * ganttState.dayW - 160);
}
function showGanttTip(text, x, y){
  if(!ganttTipEl){
    ganttTipEl = document.createElement("div");
    ganttTipEl.className = "gantt-tip";
    document.body.appendChild(ganttTipEl);
  }
  ganttTipEl.textContent = text;
  ganttTipEl.hidden = false;
  ganttTipEl.style.left = (x + 14) + "px";
  ganttTipEl.style.top = (y + 14) + "px";
}
function hideGanttTip(){
  if(ganttTipEl) ganttTipEl.hidden = true;
}
function renderGanttFilterState(){
  var n = selectedFilterCount();
  if(ganttFilterCountEl){
    ganttFilterCountEl.hidden = n === 0;
    ganttFilterCountEl.textContent = String(n);
  }
  if(ganttClearFilterEl) ganttClearFilterEl.hidden = n === 0;
  if(ganttFilterBtn) ganttFilterBtn.classList.toggle("filter-on", n > 0);
}
function ganttFilterSourceTasks(){
  var list = ganttState.tasks;
  if(ganttState.serverUnplanned !== null && ganttState.unplannedTasks.length) list = list.concat(ganttState.unplannedTasks);
  return list;
}
function ganttFilterOwners(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.owners){
    meta.owners.forEach(function(o){
      if(o && o.name && !seen[o.name]){ seen[o.name] = 1; out.push(o.name); }
    });
  }
  ganttFilterSourceTasks().forEach(function(t){
    if(t.owner && !seen[t.owner]){ seen[t.owner] = 1; out.push(t.owner); }
  });
  return out;
}
function ganttFilterCats(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.cats){
    meta.cats.forEach(function(c){ if(c && c.name && !seen[c.name]){ seen[c.name] = 1; out.push(c.name); } });
  }
  ganttFilterSourceTasks().forEach(function(t){
    if(t.category && !seen[t.category]){ seen[t.category] = 1; out.push(t.category); }
  });
  return out;
}
function ganttFilterTags(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.tags){
    meta.tags.forEach(function(x){ if(x && x.name && !seen[x.name]){ seen[x.name] = 1; out.push(x.name); } });
  }
  ganttFilterSourceTasks().forEach(function(t){
    (t.tags || []).forEach(function(n){ if(!seen[n]){ seen[n] = 1; out.push(n); } });
  });
  return out;
}
function ganttFilterVersions(){
  var meta = state.board && state.board.meta;
  var vs = (meta && meta.versions) || [];
  var nameCount = {};
  vs.forEach(function(v){ nameCount[v.name] = (nameCount[v.name] || 0) + 1; });
  var out = vs.map(function(v){
    var label = v.name;
    if(nameCount[v.name] > 1 && v.projectName) label = v.name + "（" + v.projectName + "）";
    return {id:v.id, label:label};
  });
  if((meta && meta.versionUnassigned) || state.versions.indexOf("__none") !== -1){
    out.push({id:"__none", label:"待规划"});
  }
  return out;
}
function ganttFilterChip(attr, value, label, on){
  return '<button class="chip" type="button" ' + attr + '="' + esc(value) + '" aria-pressed="' +
    (on ? "true" : "false") + '">' + label + '</button>';
}
function ganttFilterSection(title, inner){
  return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
    '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
}
function renderGanttFilterMenu(){
  if(!ganttFilterMenu) return;
  var owners = ganttFilterOwners();
  var ownerHTML = owners.map(function(o){
    return ganttFilterChip("data-gantt-owner", o, esc(o), state.owners.indexOf(o) !== -1);
  }).join("");
  var priHTML = PRIORITIES.map(function(p){
    return ganttFilterChip("data-gantt-pri", p,
      '<i class="cdot" style="background:' + PRIORITY_COLOR[p] + '"></i>' + p,
      state.pris.indexOf(p) !== -1);
  }).join("");
  var typeHTML = ["task", "story", "bug", "epic"].map(function(t){
    return ganttFilterChip("data-gantt-type", t, esc(typeName(t)), state.types.indexOf(t) !== -1);
  }).join("");
  var verHTML = ganttFilterVersions().map(function(v){
    return ganttFilterChip("data-gantt-version", v.id, esc(v.label), state.versions.indexOf(v.id) !== -1);
  }).join("");
  var projHTML = rt.reqList.map(function(r){
    return ganttFilterChip("data-gantt-req", r.id, esc(r.name), state.reqs.indexOf(r.id) !== -1);
  }).join("");
  if(state.reqs.indexOf("__none") !== -1){
    projHTML += ganttFilterChip("data-gantt-req", "__none", "未归类", true);
  }
  var catHTML = ganttFilterCats().map(function(c){
    return ganttFilterChip("data-gantt-cat", c, esc(c), state.cats.indexOf(c) !== -1);
  }).join("");
  var tagHTML = ganttFilterTags().map(function(n){
    return ganttFilterChip("data-gantt-tag", n, esc(n), state.tags.indexOf(n) !== -1);
  }).join("");
  var dueHTML = [{v:"over",n:"已逾期"},{v:"today",n:"今天到期"},{v:"soon",n:"3 天内"}].map(function(d){
    return ganttFilterChip("data-gantt-due", d.v, d.n, state.due === d.v);
  }).join("");
  var blockedHTML = ganttFilterChip("data-gantt-blocked", "1", "仅看被阻塞", state.blocked);
  var html = '<div class="menu-title">筛选任务</div>' +
    '<div class="menu-field"><input class="input" type="search" id="ganttFilterQ" placeholder="关键词：标题 / 项目 / 标签" aria-label="关键词筛选" value="' + esc(state.q) + '" /></div>' +
    ganttFilterSection("负责人", ownerHTML || '<span class="foot-note">当前空间没有负责人可选</span>') +
    ganttFilterSection("优先级", priHTML) +
    ganttFilterSection("类型", typeHTML) +
    (verHTML ? ganttFilterSection("版本", verHTML) : "") +
    ganttFilterSection("项目", projHTML || '<span class="foot-note">还没有项目，可到「项目」页新建</span>') +
    (catHTML ? ganttFilterSection("分类", catHTML) : "") +
    (tagHTML ? ganttFilterSection("标签", tagHTML) : "") +
    ganttFilterSection("到期", dueHTML) +
    ganttFilterSection("状态", blockedHTML) +
    '<div class="menu-foot">' +
      '<button class="btn sm" type="button" data-gantt-filter-reset>重置</button>' +
      '<button class="btn sm primary" type="button" data-gantt-filter-save>保存视图</button>' +
    '</div>';
  ganttFilterMenu.innerHTML = html;
}
function afterGanttFilterChange(){
  renderGanttFilterMenu();
  renderGanttFilterState();
  reloadFilteredViews();
}
var ganttQueryTimer = null;
function ganttSetQuery(kw){
  state.q = kw || "";
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  if(ganttQueryTimer) clearTimeout(ganttQueryTimer);
  ganttQueryTimer = setTimeout(function(){ reloadFilteredViews(); }, 300);
}
function renderGanttViewsMenu(){
  if(!ganttViewsMenu) return;
  var html = '<div class="menu-title">保存的视图</div>';
  if(!rt.savedViews.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的视图；先设置筛选，再保存。</p></div>';
  }else{
    html += rt.savedViews.map(function(v){
      return '<button class="menu-item" type="button" data-gantt-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' +
        esc(v.name) + '</button>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-gantt-view-save>保存为视图</button></div>';
  html += '<div class="menu-sep"></div><div class="menu-title">排序</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["start", "开始"], ["due", "截止"], ["priority", "优先级"], ["owner", "负责人"], ["progress", "进度"]].map(function(o){
      return ganttFilterChip("data-gantt-sort", o[0], o[1], ganttState.sortBy === o[0]);
    }).join("") + '</div></div>';
  html += '<div class="menu-title">第二级分组</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["none", "无"], ["project", "项目"], ["owner", "负责人"], ["status", "状态"], ["category", "分类"], ["priority", "优先级"]].map(function(o){
      return ganttFilterChip("data-gantt-group2", o[0], o[1], ganttState.groupBy2 === o[0]);
    }).join("") + '</div></div>';
  html += '<div class="menu-title">左列字段</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["project", "项目"], ["owner", "负责人"], ["dates", "日期"], ["work", "工时"], ["subtask", "子任务"], ["tags", "标签"], ["comments", "评论"]].map(function(o){
      return ganttFilterChip("data-gantt-col", o[0], o[1], !!ganttState.cols[o[0]]);
    }).join("") + '</div></div>';
  ganttViewsMenu.innerHTML = html;
}
function renderGanttExportMenu(){
  if(!ganttExportMenu) return;
  var allLabel = ganttState.rangeMode === "month"
    ? "全部筛选结果 CSV（跨月拉取）"
    : ("全部筛选结果 CSV（" + ganttAllTasks().length + " 项）");
  ganttExportMenu.innerHTML = '<div class="menu-title">导出</div>' +
    '<button class="menu-item" type="button" data-gantt-export="range">当前范围 CSV（' + ganttState.rows.length + ' 项）</button>' +
    '<button class="menu-item" type="button" data-gantt-export="all">' + allLabel + '</button>' +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-gantt-print>打印 / 另存 PDF（A3 横向）</button>';
}
function ganttSetRangeMode(mode){
  if(mode !== "auto" && mode !== "month") return;
  if(ganttState.rangeMode === mode) return;
  ganttState.rangeMode = mode;
  if(mode === "month" && !ganttState.anchorMonth) ganttState.anchorMonth = ganttMonthStart(rt.TODAY);
  syncGanttControls();
  if(mode === "month"){
    ganttState.scrolled = true;
    loadGantt();
    if(ganttScroll) ganttScroll.scrollLeft = 0;
  }else{
    ganttState.scrolled = false;
    loadGantt();
  }
}
function ganttShiftMonth(delta){
  if(ganttState.rangeMode !== "month"){
    ganttState.rangeMode = "month";
    ganttState.anchorMonth = ganttMonthStart(rt.TODAY);
  }
  var a = ganttState.anchorMonth || ganttMonthStart(rt.TODAY);
  ganttState.anchorMonth = new Date(a.getFullYear(), a.getMonth() + delta, 1);
  syncGanttControls();
  ganttState.scrolled = true;
  loadGantt();
  if(ganttScroll) ganttScroll.scrollLeft = 0;
}
function ganttGoToday(){
  if(ganttState.rangeMode === "month"){
    ganttState.anchorMonth = ganttMonthStart(rt.TODAY);
    syncGanttControls();
    ganttState.scrolled = false;
    loadGantt();
    return;
  }
  ganttScrollToToday();
}
function ganttToggleGroup(key){
  if(!key) return;
  if(ganttState.collapsed[key]) delete ganttState.collapsed[key];
  else ganttState.collapsed[key] = true;
  saveGanttPrefs();
  renderGantt();
}
function ganttAxisEl(){ return ganttScroll ? ganttScroll.querySelector(".gantt-axis") : null; }
function ganttAxisDayIndex(clientX){
  var axis = ganttAxisEl();
  if(!axis || !ganttState.range) return null;
  var r = axis.getBoundingClientRect();
  if(r.width <= 0) return null;
  return (clientX - r.left) / ganttState.dayW;
}
function ganttDayAtClientX(clientX, clientY, timelineOnly){
  if(!ganttState.range) return null;
  if(timelineOnly){
    if(!ganttScroll) return null;
    var sr = ganttScroll.getBoundingClientRect();
    if(clientX < sr.left + ganttLabelW() || clientX > sr.right) return null;
    if(clientY < sr.top || clientY > sr.bottom) return null;
  }
  var idx = ganttAxisDayIndex(clientX);
  if(idx === null) return null;
  idx = Math.floor(idx);
  if(idx < 0) idx = 0;
  if(idx > ganttState.range.days - 1) idx = ganttState.range.days - 1;
  return addDays(ganttState.range.start, idx);
}
function ganttEdgeCalc(clientX, clientY){
  var r = ganttScroll.getBoundingClientRect();
  if(clientY === null || clientY === undefined || clientY < r.top || clientY > r.bottom){
    return { dir: 0, speed: 0 };
  }
  var left = r.left + ganttLabelW(), right = r.right, zone = 32, max = 18;
  var dir = 0, dist = 0;
  if(clientX < left + zone){ dir = -1; dist = left + zone - clientX; }
  else if(clientX > right - zone){ dir = 1; dist = clientX - (right - zone); }
  if(dist < 0) dist = 0;
  if(dist > zone) dist = zone;
  return { dir: dir, speed: dir ? dir * Math.max(2, Math.round((dist / zone) * max)) : 0 };
}
function showGanttDropHint(dayIdx){
  var grid = ganttScroll && ganttScroll.querySelector(".gantt-grid");
  if(!grid || !ganttState.range || dayIdx === null || dayIdx === undefined) return;
  if(!ganttDropEl){
    ganttDropEl = document.createElement("div");
    ganttDropEl.className = "gantt-drop-col";
  }
  if(ganttDropEl.parentNode !== grid) grid.appendChild(ganttDropEl);
  ganttDropEl.style.left = "calc(" + ganttLabelW() + "px + " + (dayIdx * ganttState.dayW) + "px)";
  ganttDropEl.style.width = ganttState.dayW + "px";
  ganttDropEl.hidden = false;
}
function hideGanttDropHint(){
  if(ganttDropEl){ ganttDropEl.hidden = true; ganttDropEl.remove(); }
}
function ganttClampTimelineX(clientX){
  var sr = ganttScroll.getBoundingClientRect();
  var min = sr.left + ganttLabelW();
  if(clientX < min) return min + 1;
  if(clientX > sr.right) return sr.right - 1;
  return clientX;
}
function ganttSetLabelWidth(w){
  ganttState.labelW = Math.max(GANTT_LABEL_W_NARROW, Math.min(500, w));
  var grid = ganttScroll && ganttScroll.querySelector(".gantt-grid");
  if(grid) grid.style.setProperty("--gantt-label-w", ganttState.labelW + "px");
}
function cleanupGanttLabelDrag(){
  var d = ganttState.labelDrag;
  ganttState.labelDrag = null;
  if(d && d.resizer) d.resizer.classList.remove("dragging");
  document.removeEventListener("pointermove", onGanttLabelDragMove);
  document.removeEventListener("pointerup", onGanttLabelDragEnd);
  document.removeEventListener("pointercancel", onGanttLabelDragCancel);
  document.removeEventListener("keydown", onGanttLabelDragKey);
}
function onGanttLabelDragMove(e){
  var d = ganttState.labelDrag;
  if(!d) return;
  var nw = d.startW + (e.clientX - d.startX);
  ganttSetLabelWidth(nw);
}
function onGanttLabelDragEnd(){
  var d = ganttState.labelDrag;
  if(!d) return;
  cleanupGanttLabelDrag();
  saveGanttPrefs();
}
function onGanttLabelDragCancel(){
  if(!ganttState.labelDrag) return;
  var d = ganttState.labelDrag;
  ganttSetLabelWidth(d.startW);
  cleanupGanttLabelDrag();
  saveGanttPrefs();
}
function onGanttLabelDragKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  onGanttLabelDragCancel();
}
function onGanttPointerDown(e){
  /* 左列宽度调整条 */
  var resizer = e.target.closest ? e.target.closest(".gantt-resizer") : null;
  if(resizer){
    if(e.pointerType === "mouse" && e.button !== 0) return;
    var grid = resizer.closest ? resizer.closest(".gantt-grid") : null;
    if(!grid) return;
    e.preventDefault();
    e.stopPropagation();
    resizer.classList.add("dragging");
    ganttState.labelDrag = { startX: e.clientX, startW: ganttLabelW(), resizer: resizer, grid: grid };
    document.addEventListener("pointermove", onGanttLabelDragMove);
    document.addEventListener("pointerup", onGanttLabelDragEnd);
    document.addEventListener("pointercancel", onGanttLabelDragCancel);
    document.addEventListener("keydown", onGanttLabelDragKey);
    return;
  }
  /* 条尾圆点 = 建依赖，不走改期拖拽 */
  var linkDot = e.target.closest ? e.target.closest("[data-gantt-link]") : null;
  if(linkDot){ onGanttLinkDown(e); return; }
  if(ganttReadOnly()) return;
  var bar = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
  if(!bar) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  var t = ganttState.byId[bar.dataset.ganttBar];
  if(!t || !ganttState.range) return;

  /* Ctrl/⌘ 点选、Shift 连选：只改选择，不开始拖动 */
  if(e.ctrlKey || e.metaKey){ e.preventDefault(); ganttToggleSelection(t.id); return; }
  if(e.shiftKey){ e.preventDefault(); ganttSelectRange(t.id); return; }

  var handle = e.target.closest("[data-gantt-handle]");
  var mode = handle ? handle.dataset.ganttHandle : "move";
  var s = parseDate(t.startDate) || parseDate(t.dueDate);
  var d = parseDate(t.dueDate) || s;
  if(!s || !d) return;
  /* 历史数据可能有开始晚于截止：先归一化，否则任何一次拖动都会被服务端校验拒绝 */
  if(s > d){ var tmpDate = s; s = d; d = tmpDate; }

  var items = [];
  if(mode === "move"){
    /* 拖的是已选中的条 → 整体平移；否则只拖这一条 */
    var ids = ganttState.sel[t.id] ? Object.keys(ganttState.sel) : [t.id];
    ids.forEach(function(id){
      var tt = ganttState.byId[id];
      if(!tt) return;
      var ss = parseDate(tt.startDate) || parseDate(tt.dueDate);
      var ee = parseDate(tt.dueDate) || ss;
      if(!ss || !ee) return;   // 未排期任务不参与批量平移
      if(ss > ee){ var tmp2 = ss; ss = ee; ee = tmp2; }
      items.push({
        id: tt.id, task: tt,
        bar: ganttScroll.querySelector('[data-gantt-bar="' + tt.id + '"]'),
        os: tt.startDate || null, oe: tt.dueDate || null,
        s0: ss, e0: ee, ns: ss, ne: ee,
        hasStart: !!tt.startDate, hasDue: !!tt.dueDate,
        milestone: !!tt.isMilestone
      });
    });
  }else{
    var hasStart = !!t.startDate, hasDue = !!t.dueDate;
    if(!(hasStart && hasDue)) return;
    items.push({
      id: t.id, task: t, bar: bar,
      os: t.startDate || null, oe: t.dueDate || null,
      s0: s, e0: d, ns: s, ne: d,
      hasStart: true, hasDue: true,
      milestone: !!t.isMilestone
    });
  }
  if(!items.length) return;

  e.preventDefault();
  e.stopPropagation();
  ganttState.drag = {
    mainId: t.id, mode: mode, items: items, bar: bar,
    x0: e.clientX, y0: e.clientY,
    pointerDay0: ganttAxisDayIndex(ganttClampTimelineX(e.clientX)) || 0,
    lastX: e.clientX, lastY: e.clientY,
    dayW: ganttState.dayW, start: ganttState.range.start,
    moved: false, delta: 0, edgeDir: 0, edgeSpeed: 0, raf: 0
  };
  items.forEach(function(it){ if(it.bar) it.bar.classList.add("dragging"); });
  document.addEventListener("pointermove", onGanttDragMove);
  document.addEventListener("pointerup", onGanttDragEnd);
  document.addEventListener("pointercancel", onGanttDragCancel);
  document.addEventListener("keydown", onGanttDragKey);
}
function ganttDragApply(clientX){
  var d = ganttState.drag;
  if(!d) return;
  var idx = ganttAxisDayIndex(ganttClampTimelineX(clientX));
  if(idx === null) idx = d.pointerDay0;
  var delta = Math.round(idx - d.pointerDay0);
  if(!d.moved && Math.abs(clientX - d.x0) > 3) d.moved = true;
  d.delta = delta;
  d.items.forEach(function(it){
    var ns = it.s0, ne = it.e0;
    if(d.mode === "move"){
      ns = addDays(it.s0, delta);
      ne = addDays(it.e0, delta);
    }else if(d.mode === "l"){
      ns = addDays(it.s0, delta);
      if(ns > it.e0) ns = it.e0;
      ne = it.e0;
    }else{
      ne = addDays(it.e0, delta);
      if(ne < it.s0) ne = it.s0;
      ns = it.s0;
    }
    it.ns = ns;
    it.ne = ne;
    if(it.bar){
      var off = dayDiff(ns, d.start);
      var span = Math.max(1, dayDiff(ne, ns) + 1);
      var bw = span * d.dayW, bl = off * d.dayW;
      if(it.milestone){ bw = Math.max(d.dayW, 18); bl = off * d.dayW + (d.dayW - bw) / 2; }
      it.bar.style.left = bl + "px";
      it.bar.style.width = bw + "px";
    }
  });
  var prim = d.items[0];
  var spanDays = Math.max(1, dayDiff(prim.ne, prim.ns) + 1);
  var suffix = d.items.length > 1 ? (" · " + d.items.length + " 项") : "";
  showGanttTip(fmtShortMD(prim.ns) + " → " + fmtShortMD(prim.ne) + " · " + spanDays + " 天" + suffix, d.lastX, d.lastY);
}
function ganttEdgeTick(){
  var d = ganttState.drag;
  if(!d || !d.edgeDir){ if(d) d.raf = 0; return; }
  var before = ganttScroll.scrollLeft;
  ganttScroll.scrollLeft = before + d.edgeSpeed;
  if(ganttScroll.scrollLeft === before){ d.edgeDir = 0; d.raf = 0; return; }
  ganttDragApply(d.lastX);
  d.raf = requestAnimationFrame(ganttEdgeTick);
}
function onGanttDragMove(e){
  var d = ganttState.drag;
  if(!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  ganttDragApply(e.clientX);
  var edge = ganttEdgeCalc(e.clientX, e.clientY);
  d.edgeDir = edge.dir;
  d.edgeSpeed = edge.speed;
  if(d.edgeDir && !d.raf) d.raf = requestAnimationFrame(ganttEdgeTick);
  if(!d.edgeDir && d.raf){ cancelAnimationFrame(d.raf); d.raf = 0; }
}
function cleanupGanttDrag(){
  var d = ganttState.drag;
  ganttState.drag = null;
  if(d){
    if(d.items) d.items.forEach(function(it){ if(it.bar) it.bar.classList.remove("dragging"); });
    else if(d.bar) d.bar.classList.remove("dragging");
    if(d.raf) cancelAnimationFrame(d.raf);
  }
  document.removeEventListener("pointermove", onGanttDragMove);
  document.removeEventListener("pointerup", onGanttDragEnd);
  document.removeEventListener("pointercancel", onGanttDragCancel);
  document.removeEventListener("keydown", onGanttDragKey);
  hideGanttTip();
}
function onGanttDragKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  var d = ganttState.drag;
  cleanupGanttDrag();
  if(d) renderGantt();
}
function onGanttDragEnd(e){
  var d = ganttState.drag;
  if(!d) return;
  if(e && e.clientX !== undefined){
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    ganttDragApply(e.clientX);
  }
  cleanupGanttDrag();
  if(!d.moved){
    openTaskById(d.mainId);
    return;
  }
  if(!d.delta){
    renderGantt();
    return;
  }
  var items = [], changes = [];
  d.items.forEach(function(it){
    var patch = {};
    if(d.mode === "move"){
      if(it.hasStart) patch.startDate = iso(it.ns);
      if(it.hasDue) patch.dueDate = iso(it.ne);
      if(!it.hasStart && !it.hasDue) patch.dueDate = iso(it.ne);
    }else if(d.mode === "l"){
      patch.startDate = iso(it.ns);
    }else{
      patch.dueDate = iso(it.ne);
    }
    items.push({ task: it.task, patch: patch });
    changes.push({
      id: it.id,
      before: { startDate: it.os, dueDate: it.oe },
      after: {
        startDate: patch.startDate !== undefined ? patch.startDate : it.os,
        dueDate: patch.dueDate !== undefined ? patch.dueDate : it.oe
      }
    });
  });
  var first = d.items[0];
  var label = (first.hasStart ? fmtShortMD(first.ns) : "—") + " → " + (first.hasDue ? fmtShortMD(first.ne) : "—");
  var undoLabel = d.items.length > 1 ? (d.items.length + " 项改期") : ("「" + first.task.title + "」" + label);
  var msg = d.items.length > 1 ? ("已调整 " + d.items.length + " 项排期") : ("已调整「" + first.task.title + "」：" + label);
  ganttPutSeq(items).then(function(){
    toast(msg, "fs");
    ganttPushUndo(undoLabel, changes);
    loadGantt();
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshCalendarIfOpen();
  }).catch(function(ex){
    toast("调整失败：" + (ex.message || "网络异常") + (d.items.length > 1 ? "（已回滚）" : ""), "bad");
    loadGantt();
  });
}
function onGanttDragCancel(){
  if(!ganttState.drag) return;
  cleanupGanttDrag();
  renderGantt();
}
function onGanttUnplannedPointerDown(e){
  if(ganttReadOnly()) return;
  var row = e.target.closest ? e.target.closest(".gantt-unplanned-row") : null;
  if(!row) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  var t = ganttState.byId[row.dataset.ganttOpen];
  if(!t) return;
  ganttState.unplannedDrag = {
    task: t, row: row, x0: e.clientX, y0: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    moved: false, date: null, edgeDir: 0, edgeSpeed: 0, raf: 0
  };
  document.addEventListener("pointermove", onGanttUnplannedMove);
  document.addEventListener("pointerup", onGanttUnplannedEnd);
  document.addEventListener("pointercancel", onGanttUnplannedCancel);
  document.addEventListener("keydown", onGanttUnplannedKey);
}
function ganttUnplannedApply(clientX, clientY){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  var date = ganttDayAtClientX(clientX, clientY, true);
  d.date = date;
  if(date){
    showGanttDropHint(dayDiff(date, ganttState.range.start));
    showGanttTip("排期到 " + fmtFull(date), clientX, clientY);
  }else{
    hideGanttDropHint();
    showGanttTip("拖到时间轴上松手即可排期", clientX, clientY);
  }
}
function ganttUnplannedTick(){
  var d = ganttState.unplannedDrag;
  if(!d || !d.edgeDir){ if(d) d.raf = 0; return; }
  var before = ganttScroll.scrollLeft;
  ganttScroll.scrollLeft = before + d.edgeSpeed;
  if(ganttScroll.scrollLeft === before){ d.edgeDir = 0; d.raf = 0; return; }
  ganttUnplannedApply(d.lastX, d.lastY);
  d.raf = requestAnimationFrame(ganttUnplannedTick);
}
function onGanttUnplannedMove(e){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  if(!d.moved){
    if(Math.abs(e.clientX - d.x0) <= 5 && Math.abs(e.clientY - d.y0) <= 5) return;
    d.moved = true;
    d.row.classList.add("dragging");
  }
  e.preventDefault();
  ganttUnplannedApply(e.clientX, e.clientY);
  var edge = ganttEdgeCalc(e.clientX, e.clientY);
  d.edgeDir = edge.dir;
  d.edgeSpeed = edge.speed;
  if(d.edgeDir && !d.raf) d.raf = requestAnimationFrame(ganttUnplannedTick);
  if(!d.edgeDir && d.raf){ cancelAnimationFrame(d.raf); d.raf = 0; }
}
function cleanupGanttUnplannedDrag(){
  var d = ganttState.unplannedDrag;
  ganttState.unplannedDrag = null;
  if(d){
    if(d.row) d.row.classList.remove("dragging");
    if(d.raf) cancelAnimationFrame(d.raf);
  }
  document.removeEventListener("pointermove", onGanttUnplannedMove);
  document.removeEventListener("pointerup", onGanttUnplannedEnd);
  document.removeEventListener("pointercancel", onGanttUnplannedCancel);
  document.removeEventListener("keydown", onGanttUnplannedKey);
  hideGanttTip();
  hideGanttDropHint();
}
function onGanttUnplannedEnd(e){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  if(d.moved && e && e.clientX !== undefined){
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    ganttUnplannedApply(e.clientX, e.clientY);
  }
  var date = d.date, moved = d.moved;
  cleanupGanttUnplannedDrag();
  if(!moved) return;   // 小位移当作点击，交给 click 打开详情
  ganttSuppressUnplannedClick = Date.now() + 400;
  if(!date){
    toast("拖到时间轴上的某一天再松手，才能排期", "bad");
    return;
  }
  var t = d.task;
  API.put("/api/tasks/" + encodeURIComponent(t.id), taskPayloadWith(t, {
    startDate: iso(date), dueDate: iso(date)
  })).then(function(nt){
    if(nt && nt.id){
      ganttState.byId[nt.id] = nt;
      taskCacheExtra[nt.id] = nt;
    }
    toast("已排期「" + nt.title + "」：" + fmtFull(date), "fs");
    ganttPushUndo("「" + nt.title + "」排期", [{
      id: nt.id,
      before: { startDate: t.startDate || null, dueDate: t.dueDate || null },
      after: { startDate: iso(date), dueDate: iso(date) }
    }]);
    loadGantt(); loadBoard({silent:true}); refreshListIfOpen(); refreshCalendarIfOpen();
  }).catch(function(ex){
    toast("排期失败：" + (ex.message || "网络异常"), "bad");
  });
}
function onGanttUnplannedCancel(){
  if(!ganttState.unplannedDrag) return;
  ganttSuppressUnplannedClick = Date.now() + 400;
  cleanupGanttUnplannedDrag();
}
function onGanttUnplannedKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  var d = ganttState.unplannedDrag;
  cleanupGanttUnplannedDrag();
  if(d && d.moved) renderGantt();
}
if(ganttScroll){
  ganttScroll.addEventListener("click", function(e){
    var grp = e.target.closest("[data-gantt-group-toggle]");
    if(grp){ ganttToggleGroup(grp.dataset.ganttGroupToggle); return; }
    var dep = e.target.closest("[data-gantt-dep]");
    if(dep){ openGanttDepMenu(dep.getAttribute("data-gantt-dep"), dep); return; }
    /* 移动端只读：点条直接看详情（不启动拖拽） */
    var barEl = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
    if(ganttReadOnly() && barEl){ openTaskById(barEl.getAttribute("data-gantt-bar")); return; }
    var open = e.target.closest("[data-gantt-open]");
    if(open){ openTaskById(open.dataset.ganttOpen); return; }
    /* 点空白处取消多选 */
    if(!e.target.closest("[data-gantt-bar],[data-gantt-row-id],.gantt-group-head") && ganttSelCount()){
      ganttClearSelection();
    }
  });
  ganttScroll.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var bar = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
    if(!bar) return;
    e.preventDefault();
    openTaskById(bar.dataset.ganttBar);
  });
  /* 双击时间轴空白：按点击那天新建任务（预填起止，不直接落库） */
  ganttScroll.addEventListener("dblclick", function(e){
    if(e.target.closest("[data-gantt-bar],[data-gantt-handle],[data-gantt-open],.gantt-group-head,.gantt-unplanned-row,.gantt-dep")) return;
    var date = ganttDayAtClientX(e.clientX, e.clientY, true);
    if(!date) return;
    e.preventDefault();
    openTaskDrawer("backlog", null, { startDate: iso(date), dueDate: iso(date) });
  });
  ganttScroll.addEventListener("pointerdown", onGanttPointerDown);
}
if(ganttUnplannedList){
  ganttUnplannedList.addEventListener("click", function(e){
    if(Date.now() < ganttSuppressUnplannedClick) return;
    var open = e.target.closest("[data-gantt-open]");
    if(open) openTaskById(open.dataset.ganttOpen);
  });
  ganttUnplannedList.addEventListener("pointerdown", onGanttUnplannedPointerDown);
}
if(ganttShowDoneEl){
  ganttShowDoneEl.addEventListener("change", function(){
    ganttState.showDone = this.checked;
    saveGanttPrefs();
    renderGantt();
  });
}
if(ganttZoomEl){
  ganttZoomEl.addEventListener("change", function(){
    var dayIndex = ganttScroll.scrollLeft / Math.max(1, ganttState.dayW);
    ganttState.zoomDayW = Number(this.value) || 28;
    if(ganttState.scale === "day") ganttState.dayW = ganttState.zoomDayW;
    saveGanttPrefs();
    renderGantt();
    ganttScroll.scrollLeft = dayIndex * ganttState.dayW;
  });
}
if(ganttDensityEl){
  ganttDensityEl.addEventListener("change", function(){
    var v = this.value;
    if(["comfortable","compact","minimal"].indexOf(v) === -1) return;
    ganttState.density = v;
    saveGanttPrefs();
    renderGantt();
  });
}
if(ganttScaleEl){
  ganttScaleEl.addEventListener("change", function(){
    var v = this.value;
    ganttState.scale = (v === "week" || v === "month") ? v : "day";
    ganttState.dayW = ganttEffectiveDayW();
    saveGanttPrefs();
    renderGantt();
    if(ganttState.scale === "day") ganttScrollToToday();
    else ganttScroll.scrollLeft = 0;
  });
}
if(ganttGroupEl){
  ganttGroupEl.addEventListener("change", function(){
    var v = this.value;
    ganttState.groupBy = ["project","owner","status","category","priority"].indexOf(v) !== -1 ? v : "none";
    /* 一级选「不分组」= 彻底平铺：二级分组也一起清掉，避免下拉显示不分组却仍在分组 */
    if(ganttState.groupBy === "none") ganttState.groupBy2 = "none";
    saveGanttPrefs();
    renderGantt();
    renderGanttViewsMenu();
  });
}
if(ganttRangeModeEl){
  ganttRangeModeEl.addEventListener("click", function(e){
    var b = e.target.closest("[data-gantt-range]");
    if(b) ganttSetRangeMode(b.getAttribute("data-gantt-range"));
  });
}
/* 「更多」是 details 弹层：点外部收起；选中内部操作后也收起 */
var ganttMoreEl = $("ganttMore");
if(ganttMoreEl){
  document.addEventListener("click", function(e){
    if(ganttMoreEl.open && !ganttMoreEl.contains(e.target)) ganttMoreEl.open = false;
  });
  ganttMoreEl.addEventListener("click", function(e){
    if(e.target.closest(".gantt-range-mode button")) ganttMoreEl.open = false;
  });
}
if(ganttPrevMonthEl) ganttPrevMonthEl.addEventListener("click", function(){ ganttShiftMonth(-1); });
if(ganttNextMonthEl) ganttNextMonthEl.addEventListener("click", function(){ ganttShiftMonth(1); });
if(ganttFilterBtn){
  ganttFilterBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttFilterMenu)){ UI.closeAllPops(); return; }
    renderGanttFilterMenu();
    UI.openPop(ganttFilterMenu, ganttFilterBtn, {align:"left", width:340});
  });
}
if(ganttFilterMenu){
  ganttFilterMenu.addEventListener("click", function(e){
    var reset = e.target.closest("[data-gantt-filter-reset]");
    if(reset){ clearFilters(); renderGanttFilterMenu(); return; }
    var save = e.target.closest("[data-gantt-filter-save]");
    if(save){ UI.closeAllPops(); promptSaveView(); return; }
    var o = e.target.closest("[data-gantt-owner]");
    if(o){ toggleFilterValue("owners", o.getAttribute("data-gantt-owner")); afterGanttFilterChange(); return; }
    var p = e.target.closest("[data-gantt-pri]");
    if(p){ toggleFilterValue("pris", p.getAttribute("data-gantt-pri")); afterGanttFilterChange(); return; }
    var tp = e.target.closest("[data-gantt-type]");
    if(tp){ toggleFilterValue("types", tp.getAttribute("data-gantt-type")); afterGanttFilterChange(); return; }
    var vr = e.target.closest("[data-gantt-version]");
    if(vr){ toggleFilterValue("versions", vr.getAttribute("data-gantt-version")); afterGanttFilterChange(); return; }
    var r = e.target.closest("[data-gantt-req]");
    if(r){ toggleFilterValue("reqs", r.getAttribute("data-gantt-req")); afterGanttFilterChange(); return; }
    var c = e.target.closest("[data-gantt-cat]");
    if(c){ toggleFilterValue("cats", c.getAttribute("data-gantt-cat")); afterGanttFilterChange(); return; }
    var tg = e.target.closest("[data-gantt-tag]");
    if(tg){ toggleFilterValue("tags", tg.getAttribute("data-gantt-tag")); afterGanttFilterChange(); return; }
    var due = e.target.closest("[data-gantt-due]");
    if(due){
      setFilterValue("due", due.getAttribute("data-gantt-due"));
      afterGanttFilterChange();
      return;
    }
    if(e.target.closest("[data-gantt-blocked]")){ state.blocked = !state.blocked; afterGanttFilterChange(); return; }
  });
  /* 关键词防抖：只刷新数据，不重建菜单（否则输入框会丢焦点） */
  ganttFilterMenu.addEventListener("input", function(e){
    if(e.target && e.target.id === "ganttFilterQ") ganttSetQuery(e.target.value);
  });
}
if(ganttUndoBtn) ganttUndoBtn.addEventListener("click", ganttUndoLast);
if(ganttNewBtn) ganttNewBtn.addEventListener("click", function(){ openTaskDrawer("backlog"); });
if(ganttViewsBtn){
  ganttViewsBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttViewsMenu)){ UI.closeAllPops(); return; }
    renderGanttViewsMenu();
    UI.openPop(ganttViewsMenu, ganttViewsBtn, {align:"left", width:260});
  });
}
if(ganttViewsMenu){
  ganttViewsMenu.addEventListener("click", function(e){
    if(e.target.closest("[data-gantt-view-save]")){ UI.closeAllPops(); promptSaveView(); return; }
    var sortEl = e.target.closest("[data-gantt-sort]");
    if(sortEl){
      ganttState.sortBy = sortEl.getAttribute("data-gantt-sort");
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var g2El = e.target.closest("[data-gantt-group2]");
    if(g2El){
      ganttState.groupBy2 = g2El.getAttribute("data-gantt-group2");
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var colEl = e.target.closest("[data-gantt-col]");
    if(colEl){
      var ck = colEl.getAttribute("data-gantt-col");
      ganttState.cols[ck] = !ganttState.cols[ck];
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var ap = e.target.closest("[data-gantt-view]");
    if(!ap) return;
    for(var i = 0; i < rt.savedViews.length; i++){
      if(String(rt.savedViews[i].id) === String(ap.getAttribute("data-gantt-view"))){
        UI.closeAllPops();
        applyView(rt.savedViews[i]);
        return;
      }
    }
  });
}
if(ganttExportBtn){
  ganttExportBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttExportMenu)){ UI.closeAllPops(); return; }
    renderGanttExportMenu();
    UI.openPop(ganttExportMenu, ganttExportBtn, {align:"right", width:260});
  });
}
if(ganttExportMenu){
  ganttExportMenu.addEventListener("click", function(e){
    var ex = e.target.closest("[data-gantt-export]");
    if(ex){ UI.closeAllPops(); ganttExportCsv(ex.getAttribute("data-gantt-export")); return; }
    if(e.target.closest("[data-gantt-print]")){ UI.closeAllPops(); window.print(); }
  });
}
if(ganttClearFilterEl) ganttClearFilterEl.addEventListener("click", function(){ clearFilters(); });
if($("ganttToday")) $("ganttToday").addEventListener("click", ganttGoToday);
if($("ganttRefresh")) $("ganttRefresh").addEventListener("click", function(){ loadGantt(); });
if(ganttAnalysisBtn){
  ganttAnalysisBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttAnalysisMenu)){ UI.closeAllPops(); return; }
    renderGanttAnalysisMenu();
    UI.openPop(ganttAnalysisMenu, ganttAnalysisBtn, {align:"left", width:250});
  });
}
if(ganttAnalysisMenu){
  ganttAnalysisMenu.addEventListener("click", function(e){
    if(e.target.closest("[data-gantt-critical]")){ UI.closeAllPops(); ganttToggleCritical(); return; }
    if(e.target.closest("[data-gantt-baseline-toggle]")){ UI.closeAllPops(); ganttToggleBaseline(); return; }
    if(e.target.closest("[data-gantt-baseline-set]")){ UI.closeAllPops(); ganttCaptureBaseline(); return; }
    if(e.target.closest("[data-gantt-baseline-clear]")){ UI.closeAllPops(); ganttClearBaseline(); return; }
    if(e.target.closest("[data-gantt-load]")){ UI.closeAllPops(); ganttToggleLoad(); return; }
    if(e.target.closest("[data-gantt-share]")){ UI.closeAllPops(); openGanttShare(); }
  });
}
if(ganttLoadCloseEl){
  ganttLoadCloseEl.addEventListener("click", function(){
    ganttState.showLoad = false;
    saveGanttPrefs();
    syncGanttLoadPanel();
    renderGanttAnalysisMenu();
  });
}
if(ganttDepMenu){
  ganttDepMenu.addEventListener("click", function(e){
    var typeBtn = e.target.closest("[data-gantt-dep-type]");
    if(typeBtn){
      ganttDepMenu.__depType = typeBtn.getAttribute("data-gantt-dep-type");
      ganttDepMenu.querySelectorAll("[data-gantt-dep-type]").forEach(function(b){
        b.setAttribute("aria-pressed", b === typeBtn ? "true" : "false");
      });
      return;
    }
    var depId = ganttDepMenu.__depId;
    if(!depId) return;
    if(e.target.closest("[data-gantt-dep-save]")){
      var lagInput = $("ganttDepLag");
      var lag = Number(lagInput && lagInput.value) || 0;
      API.put("/api/gantt/deps/" + encodeURIComponent(depId), { depType: ganttDepMenu.__depType || "FS", lagDays: lag }).then(function(){
        UI.closeAllPops();
        toast("依赖已更新", "fs");
        refreshGanttDeps();
      }).catch(function(ex){ toast("更新失败：" + (ex.message || "网络异常"), "bad"); });
      return;
    }
    if(e.target.closest("[data-gantt-dep-del]")){
      UI.closeAllPops();
      UI.showConfirm({ title:"删除依赖", msg:"删除后两条任务不再有先后约束，确定？", okText:"删除" }).then(function(ok){
        if(!ok) return;
        API.del("/api/gantt/deps/" + encodeURIComponent(depId)).then(function(){
          toast("依赖已删除", "fs");
          refreshGanttDeps();
        }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
      });
    }
  });
}
if($("ganttShareCopy")) $("ganttShareCopy").addEventListener("click", ganttCopyShare);
if($("ganttShareRevoke")) $("ganttShareRevoke").addEventListener("click", ganttRevokeShare);
if($("ganttShareClose")) $("ganttShareClose").addEventListener("click", function(){ UI.closeModal($("dlgGanttShare")); });
var ganttScrollRaf = 0;
if(ganttScroll){
  ganttScroll.addEventListener("scroll", function(){
    if(ganttState.drag || ganttState.unplannedDrag || ganttState.depDrag) return;
    if(!ganttState.layout.length || ganttScrollRaf) return;
    ganttScrollRaf = requestAnimationFrame(function(){
      ganttScrollRaf = 0;
      ganttRenderBody(false);
    });
  }, { passive: true });
}
window.addEventListener("beforeprint", function(){
  if(activeView !== "gantt" || !ganttState.range) return;
  ganttState.printAll = true;
  ganttRenderBody(true);
});
window.addEventListener("afterprint", function(){
  if(!ganttState.printAll) return;
  ganttState.printAll = false;
  ganttRenderBody(true);
});
var ganttResizeTimer = 0;
window.addEventListener("resize", function(){
  if(activeView !== "gantt") return;
  if(ganttResizeTimer) clearTimeout(ganttResizeTimer);
  ganttResizeTimer = setTimeout(function(){
    ganttResizeTimer = 0;
    if(activeView === "gantt" && !ganttState.drag) renderGantt();
  }, 180);
});

export { cleanupGanttLink, enterGanttView, ganttCsvCell, ganttState, ganttUndoLast, ganttViewsMenu, loadGantt, loadGanttPrefs, onGanttDragCancel, onGanttUnplannedCancel, renderGanttFilterState, renderGanttViewsMenu, syncGanttControls, syncGanttUndoUI };
