/* views/list · 列表视图 */

import { API } from "../core/api.js";
import { $, listBulkBar } from "../core/dom.js";
import { applyView, clearFilters, deleteView, openMobFilterSheet, promptSaveView, saveViewState, savedViewsFor, updateMobFilterSummary } from "../core/filters-ui.js";
import { boardParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { activeView } from "../core/router.js";
import { GROUP_IDS, groupOptionsHTML } from "../core/group-dims.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { guard, serverDecision } from "../core/transitions.js";
import { canEditTask, catNameById, catTag, dueDateMD, dueDateTip, dueFlag, dueState, filterOn, progressOf, reqNameById, rt, state, tagChip } from "../core/state.js";
import { moveTaskToColumn, openDuePopover, openStatusMenu, taskLink, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { deleteTask, openTaskDrawer, ownerOptions } from "../core/task-drawer.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { taskVersionsText, taskPublicationHTML, CAT_DEFAULT_COLOR, COLUMNS, PRIORITIES, avatarHTML, colMeta, colName, duePresetDate, fmtShortMD, fmtTs, parseDate, priName, priTagHTML, severityBadgeHTML, typeBadgeHTML, typeName } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import * as listPrefs from "../core/list-preferences.js";
import { triggerDownload } from "../lib/download.js";
import { loadProjectMembers, memberRoleTitles, taskMemberLabel, syncTaskMemberTooltips } from "../lib/member-labels.js";

/* 共用显示列设置读取同一份可变标签表，统一任务列表及其列设置的版本术语。 */
listPrefs.labels("task-list").version = "计划版本";

var listBody = $("listBody"), listMeta = $("listMeta"), listSort = $("listSort"),
    btnListBulk = $("btnListBulk"), listHead = $("listHead");
var lastItems = [];
["ds:project-roles-changed", "ds:member-company-changed", "ds:member-job-title-changed", "ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(){ if(activeView === "list") syncTaskMemberTooltips(listBody, lastItems); });
});
var listLoaded = false;
var listHasMore = false, listLoadingMore = false;
var LIST_PAGE_SIZE = 100;
var smartBar = null, smartTabs = null, smartGroup = null;
var serverSort = listSort.value || "column";
var smart = { current:"all", preset:"all", group:"none", subgroup:"none", hideDone:false,
  sort:"default", sortDir:"asc", collapsed:{} };
var LIST_GROUPS = GROUP_IDS;
/* 版本分组需组内完整：自动按 100/页续拉到该上限；单项可入多组，导出仍按唯一工作项去重 */
var VERSION_GROUP_MAX = 500;
/* 列头排序：dueDate/updatedAt/work 复用服务端已有的 due/updated/actual，其余按列 key 本地排序 */
var SORT_DEFAULT_DIR = {
  due:"asc", priority:"asc", estimate:"desc", actual:"desc", updated:"desc",
  title:"asc", type:"asc", column:"asc", owner:"asc", progress:"desc",
  project:"asc", version:"asc", category:"asc", startDate:"asc", tags:"asc",
  subtasks:"desc", comments:"desc"
};
var HEAD_SORT_MAP = { dueDate:"due", updatedAt:"updated", work:"actual" };
var LIST_SORTS = ["default"].concat(Object.keys(SORT_DEFAULT_DIR));
var COL_WIDTHS = { title:"minmax(200px,1fr)", type:"80px", column:"96px", priority:"72px", owner:"96px", dueDate:"108px", progress:"108px", project:"120px", version:"110px", category:"100px", startDate:"110px", tags:"160px", subtasks:"90px", work:"100px", comments:"80px", updatedAt:"150px" };

function renderSmartTabs(){
  updateMobFilterSummary();
  if(!smartTabs) return;
  var presets = [["all","全部工作项"],["mine","分派给我"],["doing","进行中"],["over","已逾期"]];
  var html = presets.map(function(p){
    var on = smart.current === p[0];
    return '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-list-preset="' + p[0] + '">' + p[1] + '</button>';
  }).join("");
  html += savedViewsFor("task").map(function(v){
    var id = String(v.id), on = smart.current === id;
    return '<span class="smart-view-custom">' +
      '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-list-saved="' + esc(id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="smart-view-del" type="button" data-list-del="' + esc(id) + '" title="删除视图" aria-label="删除视图：' + esc(v.name) + '">' + icon("close", 11) + '</button></span>';
  }).join("");
  smartTabs.innerHTML = html;
  /* 计数挂在视图标签行右侧；这行会被整体重绘，所以每次重绘后都重新挂回 */
  if(listMeta){
    listMeta.classList.add("smart-view-meta");
    smartTabs.appendChild(listMeta);
  }
}
function syncSmartControls(){
  if(smartGroup) smartGroup.value = smart.group;
  var sub = smartBar && smartBar.querySelector("[data-list-subgroup]");
  if(sub){ sub.value = effectiveSubgroup(); sub.disabled = smart.group === "none"; }
  var hideBtn = smartBar && smartBar.querySelector("[data-list-hide-done]");
  if(hideBtn){
    hideBtn.setAttribute("aria-pressed", smart.hideDone ? "true" : "false");
    hideBtn.classList.toggle("on", smart.hideDone);
    hideBtn.title = smart.hideDone ? "当前已隐藏已完成（点击显示）" : "隐藏已完成工作项，聚焦未完成项";
  }
  if(listSort) listSort.value = smart.sort;
  syncSortDirUI();
  renderSmartTabs();
}
function syncSortDirUI(){
  var btn = smartBar && smartBar.querySelector("[data-list-sortdir]");
  if(!btn) return;
  var on = smart.sort !== "default";
  btn.hidden = !on;
  btn.textContent = smart.sortDir === "desc" ? "↓" : "↑";
  btn.title = smart.sortDir === "desc" ? "当前降序，点击切换为升序" : "当前升序，点击切换为降序";
}
function activatePreset(id){
  if(["all", "mine", "doing", "over"].indexOf(id) === -1) return;
  smart.current = id;
  smart.preset = id;
  smart.group = "none";
  smart.subgroup = "none";
  smart.hideDone = false;
  smart.sort = "default";
  smart.sortDir = "asc";
  smart.collapsed = {};
  syncSmartControls();
  /* 预置视图从干净条件开始；后续在全局筛选栏追加的条件仍与预置条件叠加。 */
  clearFilters();
  saveViewState();
}
function currentListViewParams(){
  return {preset:smart.preset, group:smart.group, subgroup:effectiveSubgroup(), hideDone:smart.hideDone,
    sort:smart.sort, sortDir:smart.sortDir};
}
function currentListViewId(){ return smart.current; }
function currentListViewName(){
  for(var i = 0; i < rt.savedViews.length; i++){
    if(String(rt.savedViews[i].id) === smart.current) return rt.savedViews[i].name;
  }
  return "";
}
function applyListSavedView(id, params){
  smart.current = String(id);
  smart.preset = ["all", "mine", "doing", "over"].indexOf(params.preset) !== -1 ? params.preset : "all";
  smart.group = LIST_GROUPS.indexOf(params.group) !== -1 ? params.group : "none";
  smart.subgroup = LIST_GROUPS.indexOf(params.subgroup) !== -1 ? params.subgroup : "none";
  smart.hideDone = params.hideDone === true;
  smart.sort = LIST_SORTS.indexOf(params.sort) !== -1 ? params.sort : "default";
  smart.sortDir = params.sortDir === "desc" ? "desc"
    : (params.sortDir === "asc" ? "asc" : (SORT_DEFAULT_DIR[smart.sort] || "asc"));
  smart.collapsed = {};
  syncSmartControls();
  saveViewState();
}
function markListViewSaved(id){
  smart.current = String(id);
  renderSmartTabs();
}
function listViewDeleted(id){
  if(smart.current === String(id)) activatePreset("all");
  else renderSmartTabs();
}
function initSmartTable(){
  if(smartBar) return;
  var page = listBody.closest(".view-page");
  var toolbar = page.querySelector(".list-toolbar");
  smartBar = document.createElement("div");
  smartBar.className = "smart-list-bar";
  smartBar.innerHTML = '<div class="smart-view-tabs" role="tablist" aria-label="视图"></div>' +
    '<div class="smart-view-tools">' +
      '<label class="smart-view-control"><span>分组</span><select class="mini-select" data-list-group aria-label="分组方式">' +
        groupOptionsHTML(LIST_GROUPS, smart.group) + '</select></label>' +
      '<label class="smart-view-control"><span>二级</span><select class="mini-select" data-list-subgroup aria-label="二级分组方式">' +
        groupOptionsHTML(LIST_GROUPS, smart.subgroup) + '</select></label>' +
      '<button class="btn sm ghost list-hide-done" type="button" data-list-hide-done aria-pressed="false">隐藏已完成</button>' +
      '<span class="smart-list-sort"></span>' +
      '<button class="btn sm ghost smart-sort-dir" type="button" data-list-sortdir hidden aria-label="切换排序方向">↑</button>' +
      '<span class="smart-view-spacer"></span>' +
      '<button class="btn sm" type="button" data-list-export>' + icon("download", 13) + ' 导出当前视图</button>' +
      '<button class="btn sm ghost" type="button" data-list-save>＋ 保存视图</button>' +
    '</div>';
  page.insertBefore(smartBar, toolbar);
  /* 手机：分组/排序/导出/保存视图收进筛选面板，标签行右侧保留入口 */
  var mobSettings = document.createElement("button");
  mobSettings.type = "button";
  mobSettings.id = "listMobSettings";
  mobSettings.className = "smart-mob-settings";
  mobSettings.title = "分组、排序、导出与保存视图";
  mobSettings.setAttribute("aria-label", "视图设置：分组、排序、导出与保存视图");
  mobSettings.innerHTML = icon("settings", 13) + " 视图";
  mobSettings.addEventListener("click", function(){ openMobFilterSheet({ section: "tools" }); });
  smartBar.appendChild(mobSettings);
  smartTabs = smartBar.querySelector(".smart-view-tabs");
  smartGroup = smartBar.querySelector("[data-list-group]");
  var smartSubgroup = smartBar.querySelector("[data-list-subgroup]");
  var sortLabel = listSort.closest("label");
  smartBar.querySelector(".smart-list-sort").appendChild(sortLabel);
  sortLabel.classList.add("smart-view-control");
  /* 合并控制层：计数并入视图标签行、显示字段并入工具行，去掉原来单独的一层 list-toolbar */
  var listColsBtn = $("btnListColumns");
  if(listColsBtn){
    var spacer = smartBar.querySelector(".smart-view-spacer");
    if(spacer) spacer.parentNode.insertBefore(listColsBtn, spacer);
  }
  toolbar.hidden = true;
  listSort.innerHTML = '<option value="default">默认顺序（沿用服务端）</option>' +
    '<option value="due">按截止日期</option><option value="priority">按优先级</option>' +
    '<option value="estimate">按预估工时</option><option value="actual">按实际工时</option>' +
    '<option value="updated">按更新时间</option>' +
    [["title", "按标题"], ["type", "按类型"], ["column", "按状态"], ["owner", "按负责人"],
     ["progress", "按进度"], ["project", "按项目"], ["version", "按计划版本"], ["category", "按模块"],
     ["startDate", "按开始日期"], ["tags", "按标签"], ["subtasks", "按子任务"], ["comments", "按评论数"]
    ].map(function(o){
      return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>';
    }).join("");
  syncSmartControls();
  smartTabs.addEventListener("click", function(e){
    var del = e.target.closest("[data-list-del]");
    if(del){ deleteView(del.dataset.listDel); return; }
    var preset = e.target.closest("[data-list-preset]");
    if(preset){ activatePreset(preset.dataset.listPreset); return; }
    var saved = e.target.closest("[data-list-saved]");
    if(!saved) return;
    for(var i = 0; i < rt.savedViews.length; i++){
      if(String(rt.savedViews[i].id) === saved.dataset.listSaved){ applyView(rt.savedViews[i]); return; }
    }
  });
  smartGroup.addEventListener("change", function(){
    if(LIST_GROUPS.indexOf(smartGroup.value) === -1) return;
    smart.group = smartGroup.value;
    if(smart.group === "none" || smart.group === smart.subgroup) smart.subgroup = "none";
    smart.collapsed = {};
    syncSmartControls();
    renderListItems(lastItems);
    updateListMeta(lastItems.length);
    saveViewState();
    autoLoadVersionGroups();
  });
  smartSubgroup.addEventListener("change", function(){
    if(LIST_GROUPS.indexOf(smartSubgroup.value) === -1) return;
    smart.subgroup = smartSubgroup.value;
    smart.collapsed = {};
    syncSmartControls();
    renderListItems(lastItems);
    updateListMeta(lastItems.length);
    saveViewState();
    autoLoadVersionGroups();
  });
  /* 监听挂在工具条自身：手机档位整条会搬进筛选面板，挂在 smartBar 上会收不到点击 */
  var smartTools = smartBar.querySelector(".smart-view-tools");
  smartTools.addEventListener("click", function(e){
    if(e.target.closest("[data-list-save]")) promptSaveView();
    else if(e.target.closest("[data-list-export]")) exportListCsv();
    else if(e.target.closest("[data-list-sortdir]")) toggleListSortDir();
    else if(e.target.closest("[data-list-hide-done]")){
      smart.hideDone = !smart.hideDone;
      smart.collapsed = {};
      syncSmartControls();
      renderListItems(lastItems);
      updateListMeta(lastItems.length);
      saveViewState();
    }
  });
}
function enterListView(){
  initSmartTable();
  /* 启动时看板若未加载成功，筛选栏会没有选项：进列表时静默补拉一次 */
  if(!state.board) loadBoard({silent:true});
  listPrefs.load("task-list").then(function(){
    if(activeView !== "list") return;
    renderListHead();
    if(listLoaded) renderListItems(lastItems);
  });
  loadList();
}
/* 保存 / 删除 / 批量操作后的刷新：保留已加载分页与滚动位置，
   不闪骨架屏、不把 offset 归零；筛选或排序变化仍走普通 loadList。 */
/* 桌面端真正的滚动容器是 .list-scroll（#view-list 为 overflow:hidden），
   静默刷新必须还原它而不是外层的 scrollTop。 */
function listScroller(){
  var view = document.getElementById("view-list");
  return (view && view.querySelector(".list-scroll")) || view;
}
function refreshListIfOpen(){
  if(activeView !== "list") return null;
  var scroller = listScroller();
  var top = scroller ? scroller.scrollTop : 0;
  return loadList({silent:true, keepLoaded:true, restoreScroll:top});
}
/* 行内改状态的乐观重绘：直接按缓存重排分组与计数，不等网络往返 */
function repaintListRows(){
  if(activeView !== "list" || !lastItems.length) return;
  var scroller = listScroller();
  var top = scroller ? scroller.scrollTop : 0;
  renderListItems(lastItems);
  if(scroller) scroller.scrollTop = top;
}
function listRequestParams(offset, limit){
  var requestSort = smart.sort === "default" ? serverSort : smart.sort;
  if(requestSort === "estimate" || requestSort === "actual") requestSort = serverSort;
  var extra = {sort:requestSort, offset:offset || 0, limit:limit || LIST_PAGE_SIZE};
  /* 能下推的预置条件下推，避免 500 条上限截断后本地预置结果偏少。 */
  if(smart.preset === "mine" && !state.owners.length && rt.currentUser){
    var myName = rt.currentUser.displayName || rt.currentUser.username;
    if(myName) extra.owners = [myName];
  }
  if(smart.preset === "over" && !state.due) extra.due = "over";
  return boardParams(extra);
}
function updateListMeta(rawCount){
  var shown = currentViewRows().length;
  var hasLocalPreset = ["mine", "doing", "over"].indexOf(smart.preset) !== -1;
  var text = "已加载 " + lastItems.length + " / 共 " + rt.listTotal + " 项";
  if(filterOn() || hasLocalPreset) text += " · 当前视图 " + shown + " 项";
  if(smart.group !== "none") text += " · " + currentViewGroups().length + " 组";
  if(smart.hideDone) text += " · 已隐藏已完成";
  listMeta.textContent = text;
}
function versionGroupingActive(){
  return smart.group === "version" || effectiveSubgroup() === "version";
}
/* 版本分组要看到组内全貌：按服务端 100 条/页自动续拉，直到 500 上限或没有更多 */
function autoLoadVersionGroups(added){
  /* added=0 防死循环：服务端说还有下一页但本页为空（期间被删）时不再自动续拉 */
  if(added === 0) return;
  if(activeView !== "list" || !versionGroupingActive() || !listHasMore || listLoadingMore) return;
  if(lastItems.length >= VERSION_GROUP_MAX) return;
  loadList({more:true, silent:true});
}
function loadList(opts){
  opts = opts || {};
  var append = !!(opts.more && lastItems.length);
  /* 保留已加载分页：一次重新拉取与当前加载量等量的数据，避免回到第一页 */
  var keep = !!(opts.keepLoaded && lastItems.length && !append);
  var offset = append ? lastItems.length : 0;
  var limit = keep ? Math.min(500, Math.max(LIST_PAGE_SIZE, lastItems.length)) : LIST_PAGE_SIZE;
  var seq = ++rt.listSeq;
  listLoadingMore = append;
  if(!append) listHasMore = false;
  if(!opts.silent && !append && !keep){
    listBody.innerHTML = UI.skeletonRows(8);
    listMeta.textContent = "加载中…";
  }
  renderListHead();
  /* 选中态不在重载时清空：批量操作后会重载，清空让人误以为操作没生效；
     真正失效的 id 在 renderListItems 里按可见行裁剪 */
  syncListSelectionUI();
  return API.get("/api/tasks/list", listRequestParams(offset, limit)).then(function(d){
    if(seq !== rt.listSeq) return;
    rt.listTotal = d.total || 0;
    listHasMore = !!d.hasMore;
    listLoadingMore = false;
    listLoaded = true;
    var items = d.items || [];
    renderListItems(append ? lastItems.concat(items) : items);
    updateListMeta((append ? lastItems.length : items.length));
    if(opts.restoreScroll != null){
      var scroller = listScroller();
      if(scroller){
        scroller.scrollTop = opts.restoreScroll;
        requestAnimationFrame(function(){ scroller.scrollTop = opts.restoreScroll; });
      }
    }
    autoLoadVersionGroups(items.length);
  }).catch(function(ex){
    if(seq !== rt.listSeq) return;
    listLoadingMore = false;
    if(append || keep || opts.silent){
      toast(ex.message || "列表刷新失败", "bad");
      if(append) renderListItems(lastItems);
      return;
    }
    listMeta.textContent = "";
    listBody.innerHTML = UI.errorState(ex.message);
    bindRetry(listBody, function(){ loadList(); });
  });
}
function applyGrid(el){
  var widths = listPrefs.columns("task-list").map(function(key){ return COL_WIDTHS[key] || "120px"; });
  el.style.gridTemplateColumns = ["40px"].concat(widths, ["48px"]).join(" ");
}
function renderListHead(){
  var labels = listPrefs.labels("task-list");
  listHead.innerHTML = '<span><input type="checkbox" class="cbx" data-list-select-all aria-label="全选当前页" /></span>' +
    listPrefs.columns("task-list").map(function(key){
      var sortKey = HEAD_SORT_MAP[key] || key;
      var active = smart.sort === sortKey;
      var ind = active ? (smart.sortDir === "desc" ? "↓" : "↑") : "";
      return '<span aria-sort="' + (active ? (smart.sortDir === "desc" ? "descending" : "ascending") : "none") + '">' +
        '<button class="lh-sort' + (active ? " on" : "") + '" type="button" data-sort-col="' + esc(key) + '"' +
          ' title="按「' + esc(labels[key]) + '」排序">' + esc(labels[key]) +
          '<i class="lh-ind" aria-hidden="true">' + ind + '</i></button></span>';
    }).join("") + '<span></span>';
  applyGrid(listHead);
  syncListColumnsBtn();
}
function syncListColumnsBtn(){
  var btn = $("btnListColumns");
  if(!btn) return;
  var shown = listPrefs.columns("task-list").length;
  var total = Object.keys(listPrefs.labels("task-list")).length;
  btn.textContent = "显示字段 " + shown + "/" + total;
  btn.title = "当前显示 " + shown + "/" + total + " 个字段；点击勾选或调整顺序";
}
function minutesText(value){
  var n = Number(value) || 0;
  if(!n) return "—";
  return n < 60 ? (n + " 分钟") : ((Math.round(n / 60 * 10) / 10) + " 小时");
}
function taskCell(t, key, hasTypeCol){
  if(key === "title") return '<span class="lr-task"><span class="lr-t" title="' + esc(t.title) + '">' + (hasTypeCol ? "" : typeBadgeHTML(t.itemType) + severityBadgeHTML(t.severity)) + esc(t.title)
    + taskPublicationHTML(t) + '</span></span>';
  if(key === "type") return '<span class="cell">' + (typeBadgeHTML(t.itemType) || esc(typeName(t.itemType))) + severityBadgeHTML(t.severity) + '</span>';
  if(key === "column"){
    var colC = colMeta(t.boardColumn), color = colC ? colC.color : CAT_DEFAULT_COLOR;
    var f = dueFlag(t);
    var flagHTML = f ? ' <span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>' : "";
    var chip = '<span class="tag tag-cat" style="--tag-c:' + color + '">' + esc(colName(t.boardColumn)) + '</span>';
    /* 状态点开即改：可写才做成按钮，只读项目保持纯标签 */
    if(canEditTask(t)){
      chip = '<button class="tag tag-cat row-status" type="button" style="--tag-c:' + color + '"' +
        ' data-row-status="' + esc(t.id) + '" aria-haspopup="menu"' +
        ' aria-label="状态：' + esc(colName(t.boardColumn)) + '，点击修改"' +
        ' title="点击改状态">' + esc(colName(t.boardColumn)) +
        '<svg class="row-status-caret" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4"/></svg>' +
      '</button>';
    }
    return '<span class="cell">' + chip + flagHTML + '</span>';
  }
  if(key === "priority") return '<span>' + (t.boardColumn === "done" ? '<span class="pdot" style="color:var(--success-fg)">' + icon("check", 13) + '</span>' : priTagHTML(t.priority)) + '</span>';
  if(key === "owner") return '<span class="cell" data-member-task="' + esc(t.id) + '" title="负责人：' + esc(t.owner || "") + (taskMemberLabel(t) ? ' · ' + esc(taskMemberLabel(t)) : '') + '">' + esc(t.owner || "—") + '</span>';
  if(key === "dueDate"){
    if(!t.dueDate) return '<span class="cell muted">—</span>';
    return '<span class="cell" title="' + esc(dueDateTip(t)) + '">' + esc(dueDateMD(t)) + '</span>';
  }
  if(key === "progress"){
    var p = progressOf(t);
    /* 未开始且进度为 0 时不画空进度条，与「我的工作」保持一致 */
    if(p <= 0 && t.boardColumn !== "doing") return '<span class="cell">—</span>';
    return '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span></span>';
  }
  if(key === "project") return '<span class="cell" title="' + esc(t.reqId ? reqNameById(t.reqId) : "") + '">' + (t.reqId ? esc(reqNameById(t.reqId)) : "—") + '</span>';
  if(key === "version") return '<span class="cell" title="' + esc('计划版本：' + (taskVersionsText(t) || '待规划') + '；不代表实际交付。调整版本请在详情填写理由。') + '">' + esc(taskVersionsText(t) || "待规划") + '</span>';
  if(key === "category") return '<span class="cell">' + (catTag(t.categoryId) || "—") + '</span>';
  if(key === "startDate") return '<span class="cell">' + (t.startDate ? esc(fmtShortMD(parseDate(t.startDate))) : "—") + '</span>';
  if(key === "tags") return '<span class="cell lr-tags">' + ((t.tags || []).map(tagChip).join("") || "—") + '</span>';
  if(key === "subtasks") return '<span class="cell">' + (Number(t.subtaskTotal) ? (Number(t.subtaskDone || 0) + "/" + Number(t.subtaskTotal)) : "—") + '</span>';
  if(key === "work") return '<span class="cell">' + esc(minutesText(t.totalMinutes)) + '</span>';
  if(key === "comments") return '<span class="cell">' + (Number(t.commentCount) || 0) + '</span>';
  if(key === "updatedAt") return '<span class="cell">' + (t.updatedAt ? esc(fmtTs(t.updatedAt)) : "—") + '</span>';
  return '<span class="cell">—</span>';
}
function mineMatches(t){
  var u = rt.currentUser;
  if(!u) return false;
  if(t.ownerUserId) return String(t.ownerUserId) === String(u.id);
  /* 历史任务未绑定账号时，沿用系统的负责人显示名回落规则。 */
  return !!t.owner && t.owner === (u.displayName || u.username);
}
function isDoneTask(t){
  var c = colMeta(t.boardColumn);
  return !!(c && c.done) || t.boardColumn === "done";
}
function presetFilteredItems(){
  var items = smart.hideDone ? lastItems.filter(function(t){ return !isDoneTask(t); }) : lastItems;
  return items.filter(function(t){
    if(smart.preset === "mine") return mineMatches(t);
    if(smart.preset === "doing") return t.boardColumn === "doing";
    if(smart.preset === "over") return dueState(t).kind === "over";
    return true;
  });
}
function sortValue(t, key){
  if(key === "title") return String(t.title || "");
  if(key === "type") return typeName(t.itemType) || "";
  if(key === "column"){
    var ci = -1;
    COLUMNS.forEach(function(c, i){ if(c.id === t.boardColumn) ci = i; });
    return ci < 0 ? 99 : ci;
  }
  if(key === "priority"){
    var pi = PRIORITIES.indexOf(t.priority);
    return pi < 0 ? 9 : pi;
  }
  if(key === "owner") return String(t.owner || "");
  if(key === "due") return t.dueDate || null;
  if(key === "progress") return progressOf(t);
  if(key === "project") return t.reqId ? String(reqNameById(t.reqId) || "") : "";
  if(key === "version") return taskVersionsText(t);
  if(key === "category") return catNameById(t.categoryId) || "";
  if(key === "startDate") return t.startDate || null;
  if(key === "tags") return (t.tags || []).join(",");
  if(key === "subtasks") return Number(t.subtaskTotal) || 0;
  if(key === "actual") return Number(t.totalMinutes) || 0;
  if(key === "estimate") return Number(t.estimateMinutes) || 0;
  if(key === "comments") return Number(t.commentCount) || 0;
  if(key === "updated") return t.updatedAt || null;
  return "";
}
function compareTasks(a, b){
  if(smart.sort === "default") return 0;
  var x = sortValue(a, smart.sort), y = sortValue(b, smart.sort);
  /* 空值（未填截止/开始/更新时间）任何方向都排最后 */
  if(x === null && y === null) return 0;
  if(x === null) return 1;
  if(y === null) return -1;
  var r = (typeof x === "number" && typeof y === "number")
    ? x - y
    : String(x).localeCompare(String(y), "zh-Hans-CN");
  return smart.sortDir === "desc" ? -r : r;
}
function sortedTasks(rows){
  var out = rows.slice();
  if(smart.sort !== "default") out.sort(compareTasks);
  return out;
}
function setListSort(key){
  var mapped = HEAD_SORT_MAP[key] || key;
  if(LIST_SORTS.indexOf(mapped) === -1) return;
  if(mapped === smart.sort){
    smart.sortDir = smart.sortDir === "desc" ? "asc" : "desc";
  }else{
    smart.sort = mapped;
    smart.sortDir = SORT_DEFAULT_DIR[mapped] || "asc";
  }
  if(mapped === "due" || mapped === "priority" || mapped === "updated") serverSort = mapped;
  syncSmartControls();
  renderListHead();
  renderListItems(lastItems);
  saveViewState();
}
function toggleListSortDir(){
  if(smart.sort === "default") return;
  smart.sortDir = smart.sortDir === "desc" ? "asc" : "desc";
  syncSmartControls();
  renderListHead();
  renderListItems(lastItems);
  saveViewState();
}
function groupInfoBy(t, dim){
  if(dim === "status") return {key:t.boardColumn || "unknown", label:colName(t.boardColumn) || "未设置状态"};
  if(dim === "owner") return {key:t.owner || "__none", label:t.owner || "未分配"};
  if(dim === "priority") return {key:t.priority || "unknown", label:t.priority ? priName(t.priority) : "未设置优先级"};
  if(dim === "project") return {key:t.reqId || "__none", label:t.reqId ? reqNameById(t.reqId) : "未归类"};
  if(dim === "category") return {key:t.categoryId || "__none", label:catNameById(t.categoryId) || "未指定模块"};
  return null;
}
/* 版本标签来自看板 meta：同名版本跨项目时用项目名消歧，进行中版本排前 */
var versionLabelCache = null, versionLabelSource = null;
function versionGroupMeta(){
  var meta = state.board && state.board.meta;
  if(versionLabelCache && versionLabelSource === meta) return versionLabelCache;
  var map = {}, nameCount = {};
  var list = (meta && meta.versions) || [];
  list.forEach(function(v){ nameCount[v.name] = (nameCount[v.name] || 0) + 1; });
  list.forEach(function(v){
    map[v.id] = {
      label: nameCount[v.name] > 1 && v.projectName ? v.name + "（" + v.projectName + "）" : v.name,
      status: v.status
    };
  });
  versionLabelCache = map;
  versionLabelSource = meta;
  return map;
}
/* 一项可绑定多个版本：分组时进入每个所属版本组，未绑定的归「待规划」 */
function versionGroupInfos(t){
  var ids = Array.isArray(t.versionIds) ? t.versionIds : [];
  var names = Array.isArray(t.versionNames) ? t.versionNames : [];
  if(!ids.length) return [{key:"__none", label:"待规划"}];
  var map = versionGroupMeta(), seen = {}, out = [];
  ids.forEach(function(id, i){
    if(seen[id]) return;
    seen[id] = 1;
    var m = map[id];
    out.push({key:id, label:(m && m.label) || names[i] || id});
  });
  return out;
}
function groupInfosBy(t, dim){
  if(dim === "version") return versionGroupInfos(t);
  var info = groupInfoBy(t, dim);
  return info ? [info] : [];
}
/* 二级维度不能与一级重复；一级不分组时二级无意义 */
function effectiveSubgroup(){
  return (smart.group === "none" || smart.subgroup === "none" || smart.subgroup === smart.group)
    ? "none" : smart.subgroup;
}
function groupCompare(dim){
  if(dim === "category"){
    var order = {};
    (rt.categoriesCache || []).forEach(function(c, i){ order[c.id] = i; });
    return function(a, b){
      var ai = order[a.key] === undefined ? 999 : order[a.key];
      var bi = order[b.key] === undefined ? 999 : order[b.key];
      return ai - bi || a.label.localeCompare(b.label, "zh-CN");
    };
  }
  return function(a, b){
    if(dim === "status"){
      var ai = -1, bi = -1;
      COLUMNS.forEach(function(c, i){ if(c.id === a.key) ai = i; if(c.id === b.key) bi = i; });
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    }
    if(dim === "priority"){
      return (PRIORITIES.indexOf(a.key) < 0 ? 9 : PRIORITIES.indexOf(a.key)) -
        (PRIORITIES.indexOf(b.key) < 0 ? 9 : PRIORITIES.indexOf(b.key));
    }
    if(dim === "version"){
      var map = versionGroupMeta();
      var rank = function(key){
        if(key === "__none") return 2;
        var m = map[key];
        return m && m.status === "active" ? 0 : 1;
      };
      return rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "zh-CN");
    }
    return a.label.localeCompare(b.label, "zh-CN");
  };
}
function currentViewGroups(){
  if(smart.group === "none") return [];
  var groups = [], groupIndex = {}, subIndex = {};
  var subDim = effectiveSubgroup();
  presetFilteredItems().forEach(function(t){
    groupInfosBy(t, smart.group).forEach(function(info){
      var group = groupIndex[info.key];
      if(!group){ group = {key:info.key, label:info.label, rows:[], subgroups:[]}; groupIndex[info.key] = group; groups.push(group); }
      group.rows.push(t);
      if(subDim === "none") return;
      groupInfosBy(t, subDim).forEach(function(subInfo){
        var subKey = info.key + "/" + subInfo.key;
        var sub = subIndex[subKey];
        if(!sub){ sub = {key:subInfo.key, label:subInfo.label, rows:[]}; subIndex[subKey] = sub; group.subgroups.push(sub); }
        sub.rows.push(t);
      });
    });
  });
  groups.forEach(function(g){
    g.rows = sortedTasks(g.rows);
    g.subgroups.forEach(function(s){ s.rows = sortedTasks(s.rows); });
    g.subgroups.sort(groupCompare(smart.subgroup));
  });
  groups.sort(groupCompare(smart.group));
  return groups;
}
function currentViewRows(){
  if(smart.group === "none") return sortedTasks(presetFilteredItems());
  /* 一项可入多个版本组：导出/计数按工作项去重，避免同一条重复出现 */
  var seen = {}, rows = [];
  currentViewGroups().forEach(function(g){
    g.rows.forEach(function(t){
      if(seen[t.id]) return;
      seen[t.id] = 1;
      rows.push(t);
    });
  });
  return rows;
}
function csvCell(value){
  var s = value === null || value === undefined ? "" : String(value);
  if(!/^-?\d+(\.\d+)?$/.test(s) && /^\s*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function taskCsvValue(t, key){
  if(key === "title") return t.title || "";
  if(key === "type") return typeName(t.itemType);
  if(key === "column") return colName(t.boardColumn);
  if(key === "priority") return t.priority || "";
  if(key === "owner") return t.owner || "";
  if(key === "dueDate") return t.dueDate || "";
  if(key === "progress") return progressOf(t) + "%";
  if(key === "project") return t.reqId ? reqNameById(t.reqId) : "";
  if(key === "version") return taskVersionsText(t);
  if(key === "category") return catNameById(t.categoryId) || "";
  if(key === "startDate") return t.startDate || "";
  if(key === "tags") return (t.tags || []).join(" ");
  if(key === "subtasks") return Number(t.subtaskTotal) ? (Number(t.subtaskDone || 0) + "/" + Number(t.subtaskTotal)) : "";
  if(key === "work") return Number(t.totalMinutes) || 0;
  if(key === "comments") return Number(t.commentCount) || 0;
  if(key === "updatedAt") return t.updatedAt ? fmtTs(t.updatedAt) : "";
  return "";
}
function exportListCsv(){
  var rows = currentViewRows();
  if(!rows.length){ toast("当前视图没有可导出的工作项", "warn"); return; }
  var columns = listPrefs.columns("task-list"), labels = listPrefs.labels("task-list");
  var lines = [columns.map(function(key){ return labels[key]; })];
  rows.forEach(function(t){ lines.push(columns.map(function(key){ return taskCsvValue(t, key); })); });
  var csv = "\uFEFF" + lines.map(function(line){ return line.map(csvCell).join(","); }).join("\r\n");
  var presetNames = {all:"全部工作项", mine:"分派给我", doing:"进行中", over:"已逾期"};
  var name = currentListViewName() || presetNames[smart.preset] || "工作项列表";
  name = name.replace(/[\\/:*?"<>|]/g, "-");
  triggerDownload(name + "-" + rt.TODAY_ISO + ".csv", csv, "text/csv;charset=utf-8;");
  toast("已导出当前视图 " + rows.length + " 项", "fs");
}
function mobileListCardHTML(t){
  var f = dueFlag(t);
  var col = colMeta(t.boardColumn) || {};
  var p = progressOf(t);
  var projectName = t.reqId ? reqNameById(t.reqId) : "";
  var colChip = '<span class="mtc-chip" style="--c:' + esc(col.color || CAT_DEFAULT_COLOR) + '"><i></i>' + esc(colName(t.boardColumn)) + '</span>';
  if(canEditTask(t)){
    colChip = '<button class="mtc-chip mtc-status" type="button" style="--c:' + esc(col.color || CAT_DEFAULT_COLOR) + '"' +
      ' data-row-status="' + esc(t.id) + '" aria-haspopup="menu"' +
      ' aria-label="状态：' + esc(colName(t.boardColumn)) + '，点击修改"><i></i>' + esc(colName(t.boardColumn)) +
      '<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5 8 10.5l4-4"/></svg></button>';
  }
  return '<article class="mob-task-card" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
    '<div class="mtc-top">' +
      priTagHTML(t.priority || "P2") +
      colChip +
      (t.itemType && t.itemType !== "task" ? '<span class="mtc-chip ghost">' + esc(typeName(t.itemType)) + '</span>' : '') +
      '<span class="sp"></span>' +
      '<button class="mtc-ico" type="button" data-row-menu="' + esc(t.id) + '" aria-label="更多操作" title="更多操作">' + icon("more", 16) + '</button>' +
    '</div>' +
    '<h3 class="mtc-title">' + esc(t.title) + '</h3>' + taskPublicationHTML(t) +
    '<div class="mtc-meta">' +
      '<span class="mtc-path">' + esc(projectName || "未关联项目") + '</span>' +
      (t.dueDate ? '<span class="mtc-due" title="' + esc(dueDateTip(t)) + '">' + esc(dueDateMD(t)) + '</span>' : '<span class="mtc-due">未设截止</span>') +
      (f ? '<span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>' : '') +
    '</div>' +
    '<div class="mtc-foot">' +
      '<span class="progress mini' + (p >= 100 ? " full" : "") + '"><span class="bar"><i style="width:' + p + '%"></i></span>' +
        '<span class="pv">' + p + '%</span></span>' +
      '<span class="mtc-owner" data-member-task="' + esc(t.id) + '" title="负责人：' + esc(t.owner || "—") + (taskMemberLabel(t) ? ' · ' + esc(taskMemberLabel(t)) : '') + '">' + avatarHTML(t.owner || "—") + '</span>' +
    '</div>' +
    '<div class="mtc-swipe">' +
      '<button class="mtc-act done" type="button" data-mob-done="' + esc(t.id) + '">完成</button>' +
      '<button class="mtc-act" type="button" data-mob-timer="' + esc(t.id) + '">计时</button>' +
    '</div>' +
  '</article>';
}
function renderMobileListItems(viewRows, groups){
  var cards = function(rows){ return rows.map(mobileListCardHTML).join(""); };
  if(smart.group === "none" || !groups || !groups.length){
    listBody.innerHTML = cards(viewRows);
    return;
  }
  listBody.innerHTML = groups.map(function(g){
    var collapsed = !!smart.collapsed["$" + g.key];
    var inner = "";
    if(!collapsed){
      if(g.subgroups.length){
        inner = g.subgroups.map(function(s){
          var sc = !!smart.collapsed["$sub:" + g.key + "/" + s.key];
          return '<div class="mob-list-subgroup">' +
            '<button class="mob-subgroup-head" type="button" data-list-subgroup-toggle="' + esc(g.key + "/" + s.key) + '" aria-expanded="' + (!sc) + '">' +
            '<h4>' + esc(s.label) + '</h4><span class="mob-group-n">' + s.rows.length + '</span>' +
            '<span class="mob-group-caret' + (sc ? "" : " open") + '">' + icon("caretDown", 14) + '</span></button>' +
            (sc ? "" : '<div class="mob-card-list">' + cards(s.rows) + '</div>') + '</div>';
        }).join("");
      }else{
        inner = '<div class="mob-card-list">' + cards(g.rows) + '</div>';
      }
    }
    return '<div class="mob-list-group"><button class="mob-group-head" type="button" data-list-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">' +
      '<h3>' + esc(g.label) + '</h3><span class="mob-group-n">' + g.rows.length + '</span>' +
      '<span class="mob-group-caret' + (collapsed ? "" : " open") + '">' + icon("caretDown", 14) + '</span></button>' +
      inner + '</div>';
  }).join("");
}
function renderListItems(items){
  lastItems = items || [];
  rt.listCache = {};
  renderListHead();
  var groups = currentViewGroups();
  var viewRows = currentViewRows();
  if(!viewRows.length){
    rt.listSelected = {};
    var hasConditions = filterOn() || smart.preset !== "all" || smart.hideDone;
    listBody.innerHTML = '<div style="padding:8px">' + (hasConditions
      ? UI.emptyState({ icon:"filterOff", title:"没有符合当前视图条件的工作项", text:"切换视图，或调整、清空筛选条件后重试。", actionLabel:"查看全部工作项", compact:true })
      : UI.emptyState({ icon:"inbox", title:"这里还没有工作项", textHtml:"新建一个工作项；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。", actionLabel:"新建工作项", compact:true })) + '</div>';
    bindRetry(listBody, function(){ if(hasConditions) activatePreset("all"); else openTaskDrawer("backlog"); });
    syncListSelectionUI();
    appendListMore();
    return;
  }
  var keepSelected = {}, visibleColumns = listPrefs.columns("task-list");
  var hasTypeCol = visibleColumns.indexOf("type") !== -1;
  viewRows.forEach(function(t){ rt.listCache[t.id] = t; });
  if(isMobile()){
    renderMobileListItems(viewRows, groups);
    syncTaskMemberTooltips(listBody, viewRows);
    rt.listSelected = {};
    syncListSelectionUI();
    appendListMore();
    return;
  }
  function rowHTML(t){
    var editable = canEditTask(t);
    /* 只保留可编辑任务的选中态：权限被收回后不能继续参与批量写操作 */
    if(rt.listSelected[t.id] && editable) keepSelected[t.id] = true;
    return '<div class="list-row" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
      '<span><input type="checkbox" class="cbx" data-row-check="' + esc(t.id) + '"' +
        (editable ? '' : ' disabled title="只读项目不可批量操作"') +
        ' aria-label="选择工作项：' + esc(t.title) + '"' + (keepSelected[t.id] ? ' checked' : '') + ' /></span>' +
      visibleColumns.map(function(key){ return taskCell(t, key, hasTypeCol); }).join("") +
      '<span class="cell-act"><button class="icon-btn sm" type="button" data-row-menu="' + esc(t.id) + '" aria-label="更多操作" title="更多操作">' + icon("more", 15) + '</button></span></div>';
  }
  if(smart.group === "none"){
    listBody.innerHTML = viewRows.map(rowHTML).join("");
  }else{
    listBody.innerHTML = groups.map(function(g){
      var collapsed = !!smart.collapsed["$" + g.key];
      var head = '<div class="list-group-row"><button type="button" data-list-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">' +
        '<span class="list-group-caret' + (collapsed ? '' : ' open') + '">▶</span><span class="list-group-name">' + esc(g.label) + '</span>' +
        '<span class="list-group-count">' + g.rows.length + ' 项</span></button></div>';
      if(collapsed) return head;
      if(!g.subgroups.length) return head + g.rows.map(rowHTML).join("");
      return head + g.subgroups.map(function(s){
        var sc = !!smart.collapsed["$sub:" + g.key + "/" + s.key];
        var subHead = '<div class="list-subgroup-row"><button type="button" data-list-subgroup-toggle="' + esc(g.key + "/" + s.key) + '" aria-expanded="' + (!sc) + '">' +
          '<span class="list-subgroup-caret' + (sc ? '' : ' open') + '">▶</span><span class="list-subgroup-name">' + esc(s.label) + '</span>' +
          '<span class="list-subgroup-count">' + s.rows.length + ' 项</span></button></div>';
        return subHead + (sc ? "" : s.rows.map(rowHTML).join(""));
      }).join("");
    }).join("");
  }
  syncTaskMemberTooltips(listBody, viewRows);
  Array.prototype.forEach.call(listBody.querySelectorAll(".list-row"), applyGrid);
  /* 只保留当前展开行的选中态，避免隐藏任务被批量删除 */
  rt.listSelected = keepSelected;
  syncListSelectionUI();
  appendListMore();
}
function appendListMore(){
  if(!listHasMore) return;
  var more = document.createElement("div");
  more.style.cssText = "padding:14px;text-align:center;";
  more.innerHTML = '<button class="btn" type="button" data-list-more' + (listLoadingMore ? " disabled" : "") + '>' +
    (listLoadingMore ? "加载中…" : "加载更多（已 " + lastItems.length + " / 共 " + rt.listTotal + " 项）") + '</button>';
  listBody.appendChild(more);
}
if($("btnListColumns")) $("btnListColumns").addEventListener("click", function(){
  listPrefs.openColumnSettings("task-list", function(){ renderListItems(lastItems); });
});
function syncListSelectionUI(){
  var checked = listBody.querySelectorAll("[data-row-check]:checked");
  var n = checked.length;
  /* 原「移入回收站」按钮在顶部工具栏、其它批量操作在列表上方，两条并存既重复、
     又让批量入口看起来"只有一个删除"。现在统一收进列表上方那一条（元素保留，仅常驻隐藏）。 */
  btnListBulk.hidden = true;
  if(listBulkBar){
    listBulkBar.hidden = n === 0;
    if(n > 0){
      listBulkBar.innerHTML = '<div class="bulk-bar">' +
        '<span class="bk-n">已选 ' + n + ' 项</span>' +
        '<button class="btn sm" type="button" data-bulk="pri">改优先级</button>' +
        '<button class="btn sm" type="button" data-bulk="owner">改负责人</button>' +
        '<button class="btn sm" type="button" data-bulk="due">改截止</button>' +
        '<button class="btn sm" type="button" data-bulk="col">改所在列</button>' +
        '<button class="btn sm" type="button" data-bulk="tag">加标签</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm danger" type="button" data-bulk="del">' + icon("trash", 13) + ' 移入回收站</button>' +
        '<button class="btn sm ghost" type="button" data-bulk="clear">取消选择</button>' +
      '</div>';
    }else{
      listBulkBar.innerHTML = "";
    }
  }
  var all = listBody.querySelectorAll("[data-row-check]");
  var selectAll = listHead.querySelector("[data-list-select-all]");
  if(selectAll){
    selectAll.checked = all.length > 0 && checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}
function bulkIds(){
  return Object.keys(rt.listSelected).filter(function(k){ return rt.listSelected[k]; });
}
function bulkApply(patchFor, label){
  var ids = bulkIds();
  if(!ids.length) return;
  var okN = 0, failN = 0;
  UI.syncBusy(true);
  Promise.all(ids.map(function(id){
    var t = rt.listCache[id];
    if(!t) return Promise.resolve();
    var patch = patchFor(t);
    if(!patch || !Object.keys(patch).length) return Promise.resolve();
    return API.put("/api/tasks/" + encodeURIComponent(id), taskPayloadWith(t, patch))
      .then(function(){ okN++; })
      .catch(function(){ failN++; });
  })).then(function(){
    UI.syncBusy(false);
    toast("批量" + label + "完成：" + okN + " 项成功" + (failN ? ("，" + failN + " 项失败") : ""),
      failN ? "warn" : "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  });
}
function bulkMoveTo(column){
  var ids = bulkIds();
  if(!ids.length) return;
  var wsId = rt.currentWs && rt.currentWs.id;
  var items = ids.map(function(id){
    var t = rt.listCache[id];
    return { from: t && t.boardColumn, title: t && t.title };
  });
  guard(wsId, items, column).then(function(pass){
    if(!pass) return;
    var body = { ids: ids, column: column, autoTimer: false, autoResume: false };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    var retried = false;
    function fail(ex){
      if(retried){
        UI.syncBusy(false);
        toast("批量移动失败：" + (ex.message || "网络异常"), "bad");
        return;
      }
      retried = true;
      serverDecision(wsId, items, column, ex).then(function(retry){
        if(!retry){
          UI.syncBusy(false);
          if(ex.code !== 422 && ex.code !== 412) toast("批量移动失败：" + (ex.message || "网络异常"), "bad");
          return;
        }
        body.reason = retry.reason;
        body.force = retry.force;
        send();
      });
    }
    function send(){
      UI.syncBusy(true);
      API.post("/api/tasks/bulk-move", body).then(function(res){
        UI.syncBusy(false);
        toast("已批量移动到「" + colName(column) + "」：" + ((res && res.moved) || ids.length) + " 项", "fs");
        loadList();
        loadBoard({silent:true});
        loadReqs();
      }).catch(fail);
    }
    send();
  });
}
function bulkOwnerCandidates(ids, wsId){
  var projectIds = [], tasks = ids.map(function(id){ return rt.listCache[id]; }).filter(Boolean);
  tasks.forEach(function(t){ if(t.reqId && projectIds.indexOf(t.reqId) === -1) projectIds.push(t.reqId); });
  var base = ownerOptions("");
  return Promise.all(projectIds.map(function(pid){ return loadProjectMembers(wsId, pid, true); })).then(function(rosters){
    return base.filter(function(o){ return rosters.every(function(data){ return (data && data.members || []).some(function(m){ return m.userId === o.id; }); }); }).map(function(o){
      var roles = [], company = o.company;
      rosters.forEach(function(data){
        var m = (data.members || []).filter(function(x){ return x.userId === o.id; })[0];
        if(m){ company = m.companyName || company; memberRoleTitles(m).forEach(function(r){ if(roles.indexOf(r) === -1) roles.push(r); }); }
      });
      return {id:o.id, name:o.name, company:company, role:roles.length ? roles.join(" / ") : o.role};
    });
  });
}
function openBulkMenu(anchor, kind){
  var el = document.createElement("div"), disposed = false, selectedIds = bulkIds().slice().sort(), wsId = rt.currentWs && rt.currentWs.id;
  el.className = "menu";
  var html = "";
  if(kind === "pri"){
    html = '<div class="menu-title">改为优先级</div>' + PRIORITIES.map(function(p){
      return '<button class="menu-item" type="button" data-bv="pri" data-v="' + p + '">' +
        priTagHTML(p) + '</button>';
    }).join("");
  }else if(kind === "owner"){
    html = '<div class="menu-title" role="status">正在确认所选项目的共同可指派成员…</div>';
    bulkOwnerCandidates(selectedIds, wsId).then(function(options){
      if(disposed || !rt.currentWs || rt.currentWs.id !== wsId) return;
      el.innerHTML = '<div class="menu-title">共同可指派成员（各项目角色汇总）</div>' + (options.map(function(o){
        var label = o.name + " · " + (o.role || "未设角色") + " · " + (o.company || "未标注公司");
        return '<button class="menu-item" type="button" data-bv="owner" data-v="' + esc(o.id) + '" data-n="' + esc(o.name) + '" title="' + esc(label) + '">' + avatarHTML(o.name, "sm") + '<span style="white-space:normal">' + esc(label) + '</span></button>';
      }).join("") || '<div class="menu-title">没有所选项目的共同候选，请按项目分别指派。</div>');
    }).catch(function(ex){ if(!disposed) el.innerHTML = '<div class="menu-title" role="alert">' + esc(ex.message || "加载失败，请关闭后重试") + '</div>'; });
  }else if(kind === "due"){
    html = '<div class="menu-title">改为截止日期</div>' +
      [["0","今天"],["1","明天"],["w5","一周后（5 个工作日）"]].map(function(x){
        return '<button class="menu-item" type="button" data-bv="due" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join("") +
      '<button class="menu-item" type="button" data-bv="due" data-v="">清除截止日期</button>';
  }else if(kind === "col"){
    html = '<div class="menu-title">改为所在列</div>' + COLUMNS.map(function(c){
      return '<button class="menu-item" type="button" data-bv="col" data-v="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    }).join("");
  }
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-bv]");
    if(!b) return;
    var k = b.dataset.bv, v = b.dataset.v, n = b.dataset.n;
    UI.closeAllPops();
    if(k === "pri") bulkApply(function(){ return {priority: v}; }, "改优先级");
    else if(k === "owner"){
      if(!rt.currentWs || rt.currentWs.id !== wsId || JSON.stringify(bulkIds().slice().sort()) !== JSON.stringify(selectedIds)){ toast("空间或选择已变更，请重新打开负责人候选", "warn"); return; }
      bulkApply(function(){ return {owner: n, ownerUserId: v || null}; }, "改负责人");
    }
    else if(k === "due") bulkApply(function(){ return {dueDate: duePresetDate(v)}; }, "改截止");
    else if(k === "col") bulkMoveTo(v);
  });
  UI.openPop(el, anchor, {align:"left", width:Math.min(480, window.innerWidth - 16), onClose: function(){ disposed = true; el.remove(); }});
}
if(listBulkBar){
  listBulkBar.addEventListener("click", function(e){
    var b = e.target.closest("[data-bulk]");
    if(!b) return;
    var kind = b.dataset.bulk;
    if(kind === "clear"){
      rt.listSelected = {};
      listBody.querySelectorAll("[data-row-check]").forEach(function(cb){ cb.checked = false; });
      syncListSelectionUI();
      return;
    }
    if(kind === "del"){
      /* 复用原有的二次确认 + 撤销 Toast 流程（元素常驻隐藏，但 JS 仍可触发） */
      btnListBulk.click();
      return;
    }
    if(kind === "tag"){
      UI.showPrompt({ title: "批量添加标签", label: "标签名（≤16 字，已存在则跳过）", maxLength: 16, okText: "添加" })
        .then(function(input){
          if(!input) return;
          var name = String(input).trim().slice(0, 16);
          if(!name) return;
          bulkApply(function(t){
            var tags = (t.tags || []).slice();
            if(tags.indexOf(name) === -1){
              if(tags.length >= 8) return null;   // 已达上限：跳过该条
              tags.push(name);
            }
            return {tags: tags};
          }, "加标签");
        });
      return;
    }
    openBulkMenu(b, kind);
  });
}
listBody.addEventListener("click", function(e){
  if(e.target.closest("[data-list-more]")){
    if(!listLoadingMore) loadList({more:true});
    return;
  }
  var subgroupToggle = e.target.closest("[data-list-subgroup-toggle]");
  if(subgroupToggle){
    var subKey = "$sub:" + subgroupToggle.dataset.listSubgroupToggle;
    smart.collapsed[subKey] = !smart.collapsed[subKey];
    renderListItems(lastItems);
    return;
  }
  var groupToggle = e.target.closest("[data-list-group-toggle]");
  if(groupToggle){
    var key = "$" + groupToggle.dataset.listGroupToggle;
    smart.collapsed[key] = !smart.collapsed[key];
    renderListItems(lastItems);
    return;
  }
  if(e.target.closest("input[type=checkbox]")) return;
  var mobDone = e.target.closest("[data-mob-done]");
  if(mobDone){ toggleTaskDone(mobDone.dataset.mobDone); return; }
  var mobTimer = e.target.closest("[data-mob-timer]");
  if(mobTimer){ toggleTaskTimer(mobTimer.dataset.mobTimer); return; }
  var menuBtn = e.target.closest("[data-row-menu]");
  if(menuBtn){ openRowMenu(menuBtn, menuBtn.dataset.rowMenu); return; }
  var statusBtn = e.target.closest("[data-row-status]");
  if(statusBtn){ openStatusMenu(statusBtn, statusBtn.dataset.rowStatus); return; }
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  var t = rt.listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listBody.addEventListener("change", function(e){
  var cb = e.target.closest("[data-row-check]");
  if(!cb) return;
  rt.listSelected[cb.dataset.rowCheck] = cb.checked;
  syncListSelectionUI();
});
listBody.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  if(e.target.closest("input,button")) return;
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  e.preventDefault();
  var t = rt.listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listHead.addEventListener("change", function(e){
  var selectAll = e.target.closest("[data-list-select-all]");
  if(!selectAll) return;
  listBody.querySelectorAll("[data-row-check]").forEach(function(cb){
    if(cb.disabled) return;
    cb.checked = selectAll.checked;
    rt.listSelected[cb.dataset.rowCheck] = selectAll.checked;
  });
  syncListSelectionUI();
});
btnListBulk.addEventListener("click", function(){
  var ids = Object.keys(rt.listSelected).filter(function(k){ return rt.listSelected[k]; });
  if(!ids.length) return;
  UI.showConfirm({
    title:"批量移入回收站",
    msg:"将把选中的 <b>" + ids.length + "</b> 项工作项移入回收站（30 天内可恢复）。确定继续？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    btnListBulk.disabled = true;
    UI.syncBusy(true);
    var deleted = [], failed = [];
    Promise.all(ids.map(function(id){
      return API.del("/api/tasks/" + encodeURIComponent(id))
        .then(function(){ deleted.push(id); })
        .catch(function(ex){ failed.push({ id: id, error: ex }); });
    })).then(function(){
      UI.syncBusy(false);
      btnListBulk.disabled = false;
      loadList(); loadBoard({animate:false}); loadReqs();
      if(!deleted.length){
        toast("批量移入回收站失败：" + ((failed[0] && failed[0].error && failed[0].error.message) || "网络异常"), "bad");
        return;
      }
      var msg = "已移入回收站 " + deleted.length + " 项" + (failed.length ? ("，" + failed.length + " 项失败") : "");
      toastAction(msg, "撤销", function(){
        var restored = [], restoreFailed = 0;
        UI.syncBusy(true);
        Promise.all(deleted.map(function(id){
          return API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {})
            .then(function(){ restored.push(id); })
            .catch(function(){ restoreFailed++; });
        })).then(function(){
          UI.syncBusy(false);
          loadList(); loadBoard({animate:false}); loadReqs();
          if(!restored.length){
            toast("恢复失败：" + restoreFailed + " 项均未恢复", "bad");
            return;
          }
          toast("已恢复 " + restored.length + " 项" +
            (restoreFailed ? ("，" + restoreFailed + " 项失败") : ""), restoreFailed ? "warn" : "fs");
        });
      }, failed.length ? "warn" : "", 8000);
    });
  });
});
function openRowMenu(anchor, id){
  var t = rt.listCache[id];
  if(!t) return;
  var editable = canEditTask(t);
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html = '<button class="menu-item" type="button" data-row-act="edit">' + icon("edit", 14) + '编辑</button>';
  if(editable){
    html +=
      '<button class="menu-item" type="button" data-row-act="done">' + icon(isDone ? "undo" : "check", 14) +
        (isDone ? "取消完成" : "标记完成") + '</button>' +
      '<button class="menu-item" type="button" data-row-act="due">' + icon("calSmall", 14) + '改期</button>';
  }
  if(editable || running){
    /* 停止自己已开始的计时不受只读限制（与后端口径一致） */
    html += '<button class="menu-item" type="button" data-row-act="timer">' +
      icon("timer", 14) + (running ? "停止计时" : "开始计时") + '</button>';
  }
  html +=
    '<button class="menu-item" type="button" data-row-act="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-row-act="link">' + icon("extlink", 14) + '复制工作项链接</button>';
  var others = editable ? COLUMNS.filter(function(c){ return c.id !== t.boardColumn; }) : [];
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-row-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  if(editable){
    html += '<div class="menu-sep"></div>' +
      '<button class="menu-item danger" type="button" data-row-act="del">' + icon("trash", 14) + '移到回收站</button>';
  }
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var act = e.target.closest("[data-row-act]");
    var mv = e.target.closest("[data-row-move]");
    UI.closeAllPops();
    if(act){
      var k = act.dataset.rowAct;
      if(k === "due"){
        setTimeout(function(){ openDuePopover(anchor, t.id); }, 0);
      }else if(k === "edit") openTaskDrawer(null, t);
      else if(k === "done"){
        toggleTaskDone(t.id);
      }
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "link") copyToClipboard(taskLink(t.id), "工作项链接已复制（可直接定位到该工作项）");
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      moveTaskToColumn(t, mv.dataset.rowMove);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
if(listHead){
  listHead.addEventListener("click", function(e){
    var h = e.target.closest("[data-sort-col]");
    if(h) setListSort(h.dataset.sortCol);
  });
}
listSort.addEventListener("change", function(){
  if(LIST_SORTS.indexOf(listSort.value) === -1) return;
  smart.sort = listSort.value;
  smart.sortDir = SORT_DEFAULT_DIR[smart.sort] || "asc";
  if(smart.sort === "default") smart.sortDir = "asc";
  if(smart.sort === "due" || smart.sort === "priority" || smart.sort === "updated") serverSort = smart.sort;
  syncSmartControls();
  renderListHead();
  loadList();
  saveViewState();
});
window.addEventListener("ds:layout", function(){
  if(lastItems && lastItems.length) renderListItems(lastItems);
});
/* 移动 / 完成 / 抽屉改列都可能由服务端停表；列表也要跟着计时身份变化重绘 */
var lastTimerTaskId = state.runningTimer ? state.runningTimer.taskId : null;
window.addEventListener("ds:running-timer", function(){
  var id = state.runningTimer ? state.runningTimer.taskId : null;
  if(id === lastTimerTaskId) return;
  lastTimerTaskId = id;
  if(activeView !== "list") return;
  /* 计时只影响行内按钮，本地重绘即可；没有已加载数据时才回源 */
  if(lastItems && lastItems.length) renderListItems(lastItems);
  else refreshListIfOpen();
});

export { applyListSavedView, COL_WIDTHS, currentListViewId, currentListViewName, currentListViewParams, enterListView, isDoneTask, listViewDeleted, loadList, markListViewSaved, minutesText, refreshListIfOpen, renderSmartTabs, repaintListRows, taskCell };
