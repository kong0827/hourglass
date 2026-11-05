/* views/list · 列表视图 */

import { API } from "../core/api.js";
import { $, listBulkBar } from "../core/dom.js";
import { applyView, clearFilters, deleteView, promptSaveView, saveViewState } from "../core/filters-ui.js";
import { boardParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { activeView } from "../core/router.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { catTag, dueState, dueText, filterOn, progressOf, reqNameById, rt, state, tagChip } from "../core/state.js";
import { openDuePopover, taskLink, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { deleteTask, openTaskDrawer, ownerOptions } from "../core/task-drawer.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, COLUMNS, PRIORITIES, avatarHTML, colMeta, colName, darken, duePresetDate, fmtShortMD, fmtTs, parseDate, rgbaOf, typeBadgeHTML, typeName } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import * as listPrefs from "../core/list-preferences.js";
import { triggerDownload } from "../lib/download.js";

var listBody = $("listBody"), listMeta = $("listMeta"), listSort = $("listSort"),
    btnListBulk = $("btnListBulk"), listHead = $("listHead");
var lastItems = [];
var listLoaded = false;
var listHasMore = false, listLoadingMore = false;
var LIST_PAGE_SIZE = 500;
var smartBar = null, smartTabs = null, smartGroup = null;
var serverSort = listSort.value || "column";
var smart = { current:"all", preset:"all", group:"none", sort:"default", collapsed:{} };
var LIST_GROUPS = ["none", "status", "owner", "priority", "project"];
var LIST_SORTS = ["default", "due", "priority", "estimate", "actual", "updated"];
var COL_WIDTHS = { title:"minmax(220px,1fr)", type:"90px", column:"100px", priority:"84px", owner:"110px", dueDate:"120px", progress:"128px", project:"140px", version:"110px", category:"100px", startDate:"110px", tags:"160px", subtasks:"90px", work:"100px", comments:"80px", updatedAt:"150px" };

function renderSmartTabs(){
  if(!smartTabs) return;
  var presets = [["all","全部任务"],["mine","我的任务"],["doing","进行中"],["over","已逾期"]];
  var html = presets.map(function(p){
    var on = smart.current === p[0];
    return '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-list-preset="' + p[0] + '">' + p[1] + '</button>';
  }).join("");
  html += rt.savedViews.map(function(v){
    var id = String(v.id), on = smart.current === id;
    return '<span class="smart-view-custom">' +
      '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-list-saved="' + esc(id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="smart-view-del" type="button" data-list-del="' + esc(id) + '" title="删除视图" aria-label="删除视图：' + esc(v.name) + '">' + icon("close", 11) + '</button></span>';
  }).join("");
  smartTabs.innerHTML = html;
}
function syncSmartControls(){
  if(smartGroup) smartGroup.value = smart.group;
  if(listSort) listSort.value = smart.sort;
  renderSmartTabs();
}
function activatePreset(id){
  if(["all", "mine", "doing", "over"].indexOf(id) === -1) return;
  smart.current = id;
  smart.preset = id;
  smart.group = "none";
  smart.sort = "default";
  smart.collapsed = {};
  syncSmartControls();
  /* 预置视图从干净条件开始；后续在全局筛选栏追加的条件仍与预置条件叠加。 */
  clearFilters();
  saveViewState();
}
function currentListViewParams(){ return {preset:smart.preset, group:smart.group, sort:smart.sort}; }
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
  smart.sort = LIST_SORTS.indexOf(params.sort) !== -1 ? params.sort : "default";
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
        '<option value="none">不分组</option><option value="status">按状态</option><option value="owner">按负责人</option>' +
        '<option value="priority">按优先级</option><option value="project">按项目</option></select></label>' +
      '<span class="smart-list-sort"></span><span class="smart-view-spacer"></span>' +
      '<button class="btn sm" type="button" data-list-export>' + icon("download", 13) + ' 导出当前视图</button>' +
      '<button class="btn sm primary" type="button" data-list-save>＋ 保存视图</button>' +
    '</div>';
  page.insertBefore(smartBar, toolbar);
  smartTabs = smartBar.querySelector(".smart-view-tabs");
  smartGroup = smartBar.querySelector("[data-list-group]");
  var sortLabel = listSort.closest("label");
  smartBar.querySelector(".smart-list-sort").appendChild(sortLabel);
  sortLabel.classList.add("smart-view-control");
  listSort.innerHTML = '<option value="default">默认顺序（沿用服务端）</option><option value="due">按截止日期</option>' +
    '<option value="priority">按优先级</option><option value="estimate">按预估工时</option>' +
    '<option value="actual">按实际工时</option><option value="updated">按更新时间</option>';
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
    smart.collapsed = {};
    renderListItems(lastItems);
    updateListMeta(lastItems.length);
    saveViewState();
  });
  smartBar.addEventListener("click", function(e){
    if(e.target.closest("[data-list-save]")) promptSaveView();
    else if(e.target.closest("[data-list-export]")) exportListCsv();
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
function refreshListIfOpen(){ if(activeView === "list") loadList(); }
function listRequestParams(offset){
  var requestSort = smart.sort === "default" ? serverSort : smart.sort;
  if(requestSort === "estimate" || requestSort === "actual") requestSort = serverSort;
  var extra = {sort:requestSort, offset:offset || 0, limit:LIST_PAGE_SIZE};
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
  listMeta.textContent = text;
}
function loadList(opts){
  opts = opts || {};
  var append = !!(opts.more && lastItems.length);
  var offset = append ? lastItems.length : 0;
  var seq = ++rt.listSeq;
  listLoadingMore = append;
  if(!append) listHasMore = false;
  if(!opts.silent && !append){
    listBody.innerHTML = UI.skeletonRows(8);
    listMeta.textContent = "加载中…";
  }
  renderListHead();
  /* 选中态不在重载时清空：批量操作后会重载，清空让人误以为操作没生效；
     真正失效的 id 在 renderListItems 里按可见行裁剪 */
  syncListSelectionUI();
  API.get("/api/tasks/list", listRequestParams(offset)).then(function(d){
    if(seq !== rt.listSeq) return;
    rt.listTotal = d.total || 0;
    listHasMore = !!d.hasMore;
    listLoadingMore = false;
    listLoaded = true;
    var items = d.items || [];
    renderListItems(append ? lastItems.concat(items) : items);
    updateListMeta((append ? lastItems.length : items.length));
  }).catch(function(ex){
    if(seq !== rt.listSeq) return;
    listLoadingMore = false;
    if(append){
      toast(ex.message || "加载更多失败", "bad");
      renderListItems(lastItems);
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
    listPrefs.columns("task-list").map(function(key){ return '<span>' + esc(labels[key]) + '</span>'; }).join("") + '<span></span>';
  applyGrid(listHead);
}
function minutesText(value){
  var n = Number(value) || 0;
  if(!n) return "—";
  return n < 60 ? (n + " 分钟") : ((Math.round(n / 60 * 10) / 10) + " 小时");
}
function taskCell(t, key, hasTypeCol){
  if(key === "title") return '<span class="lr-task"><span class="lr-t">' + (hasTypeCol ? "" : typeBadgeHTML(t.itemType)) + esc(t.title) + '</span></span>';
  if(key === "type") return '<span class="cell">' + (typeBadgeHTML(t.itemType) || esc(typeName(t.itemType))) + '</span>';
  if(key === "column"){
    var colC = colMeta(t.boardColumn), color = colC ? colC.color : CAT_DEFAULT_COLOR;
    return '<span class="cell"><span class="tag" style="background:' + rgbaOf(color,.10) + ';color:' + darken(color) + '">' + esc(colName(t.boardColumn)) + '</span></span>';
  }
  if(key === "priority") return '<span>' + (t.boardColumn === "done" ? '<span class="pdot" style="color:var(--success-fg)">' + icon("check", 13) + '</span>' : '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>') + '</span>';
  if(key === "owner") return '<span class="cell">' + esc(t.owner || "—") + '</span>';
  if(key === "dueDate"){
    var st = dueState(t), txt = t.boardColumn === "done" ? (t.completedAt ? ("完成于 " + fmtShortMD(parseDate(t.completedAt))) : "已完成") : dueText(t);
    return '<span class="cell ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' + esc(txt) + '</span>';
  }
  if(key === "progress"){
    var p = progressOf(t);
    return '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span></span>';
  }
  if(key === "project") return '<span class="cell">' + (t.reqId ? esc(reqNameById(t.reqId)) : "—") + '</span>';
  if(key === "version") return '<span class="cell">' + esc(t.versionName || "—") + '</span>';
  if(key === "category") return '<span class="cell">' + (catTag(t.category) || "—") + '</span>';
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
function presetFilteredItems(){
  return lastItems.filter(function(t){
    if(smart.preset === "mine") return mineMatches(t);
    if(smart.preset === "doing") return t.boardColumn === "doing";
    if(smart.preset === "over") return dueState(t).kind === "over";
    return true;
  });
}
function compareTasks(a, b){
  var x, y;
  if(smart.sort === "due"){
    x = a.dueDate || "9999-12-31"; y = b.dueDate || "9999-12-31";
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  if(smart.sort === "priority"){
    x = PRIORITIES.indexOf(a.priority); y = PRIORITIES.indexOf(b.priority);
    return (x < 0 ? 9 : x) - (y < 0 ? 9 : y);
  }
  if(smart.sort === "estimate") return (Number(b.estimateMinutes) || 0) - (Number(a.estimateMinutes) || 0);
  if(smart.sort === "actual") return (Number(b.totalMinutes) || 0) - (Number(a.totalMinutes) || 0);
  if(smart.sort === "updated"){
    x = a.updatedAt || ""; y = b.updatedAt || "";
    return x < y ? 1 : (x > y ? -1 : 0);
  }
  return 0;
}
function sortedTasks(rows){
  var out = rows.slice();
  if(smart.sort !== "default") out.sort(compareTasks);
  return out;
}
function groupInfo(t){
  if(smart.group === "status") return {key:t.boardColumn || "unknown", label:colName(t.boardColumn) || "未设置状态"};
  if(smart.group === "owner") return {key:t.owner || "__none", label:t.owner || "未分配"};
  if(smart.group === "priority") return {key:t.priority || "unknown", label:t.priority || "未设置优先级"};
  if(smart.group === "project") return {key:t.reqId || "__none", label:t.reqId ? reqNameById(t.reqId) : "未归类"};
  return null;
}
function currentViewGroups(){
  if(smart.group === "none") return [];
  var groups = [];
  presetFilteredItems().forEach(function(t){
    var info = groupInfo(t), group = null;
    for(var i = 0; i < groups.length; i++) if(groups[i].key === info.key){ group = groups[i]; break; }
    if(!group){ group = {key:info.key, label:info.label, rows:[]}; groups.push(group); }
    group.rows.push(t);
  });
  groups.forEach(function(g){ g.rows = sortedTasks(g.rows); });
  groups.sort(function(a, b){
    if(smart.group === "status"){
      var ai = -1, bi = -1;
      COLUMNS.forEach(function(c, i){ if(c.id === a.key) ai = i; if(c.id === b.key) bi = i; });
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    }
    if(smart.group === "priority"){
      return (PRIORITIES.indexOf(a.key) < 0 ? 9 : PRIORITIES.indexOf(a.key)) -
        (PRIORITIES.indexOf(b.key) < 0 ? 9 : PRIORITIES.indexOf(b.key));
    }
    return a.label.localeCompare(b.label, "zh-CN");
  });
  return groups;
}
function currentViewRows(){
  if(smart.group === "none") return sortedTasks(presetFilteredItems());
  return currentViewGroups().reduce(function(all, g){ return all.concat(g.rows); }, []);
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
  if(key === "version") return t.versionName || "";
  if(key === "category") return t.category || "";
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
  if(!rows.length){ toast("当前视图没有可导出的任务", "warn"); return; }
  var columns = listPrefs.columns("task-list"), labels = listPrefs.labels("task-list");
  var lines = [columns.map(function(key){ return labels[key]; })];
  rows.forEach(function(t){ lines.push(columns.map(function(key){ return taskCsvValue(t, key); })); });
  var csv = "\uFEFF" + lines.map(function(line){ return line.map(csvCell).join(","); }).join("\r\n");
  var presetNames = {all:"全部任务", mine:"我的任务", doing:"进行中", over:"已逾期"};
  var name = currentListViewName() || presetNames[smart.preset] || "任务列表";
  name = name.replace(/[\\/:*?"<>|]/g, "-");
  triggerDownload(name + "-" + rt.TODAY_ISO + ".csv", csv, "text/csv;charset=utf-8;");
  toast("已导出当前视图 " + rows.length + " 项", "fs");
}
function mobileListCardHTML(t){
  var st = dueState(t);
  var col = colMeta(t.boardColumn) || {};
  var p = progressOf(t);
  var projectName = t.reqId ? reqNameById(t.reqId) : "";
  return '<article class="mob-task-card" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
    '<div class="mtc-top">' +
      '<span class="pdot ' + esc(t.priority || "P2") + '"><i></i>' + esc(t.priority || "P2") + '</span>' +
      '<span class="mtc-chip" style="--c:' + esc(col.color || CAT_DEFAULT_COLOR) + '"><i></i>' + esc(colName(t.boardColumn)) + '</span>' +
      (t.itemType && t.itemType !== "task" ? '<span class="mtc-chip ghost">' + esc(typeName(t.itemType)) + '</span>' : '') +
      '<span class="sp"></span>' +
      '<button class="mtc-ico" type="button" data-row-menu="' + esc(t.id) + '" aria-label="更多操作" title="更多操作">' + icon("more", 16) + '</button>' +
    '</div>' +
    '<h3 class="mtc-title">' + esc(t.title) + '</h3>' +
    '<div class="mtc-meta">' +
      '<span class="mtc-path">' + esc(projectName || "未关联项目") + '</span>' +
      '<span class="mtc-due ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' + esc(dueText(t)) + '</span>' +
    '</div>' +
    '<div class="mtc-foot">' +
      '<span class="progress mini' + (p >= 100 ? " full" : "") + '"><span class="bar"><i style="width:' + p + '%"></i></span>' +
        '<span class="pv">' + p + '%</span></span>' +
      '<span class="mtc-owner" title="负责人：' + esc(t.owner || "—") + '">' + avatarHTML(t.owner || "—") + '</span>' +
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
    return '<div class="mob-list-group"><button class="mob-group-head" type="button" data-list-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">' +
      '<h3>' + esc(g.label) + '</h3><span class="mob-group-n">' + g.rows.length + '</span>' +
      '<span class="mob-group-caret' + (collapsed ? "" : " open") + '">' + icon("caretDown", 14) + '</span></button>' +
      (collapsed ? "" : '<div class="mob-card-list">' + cards(g.rows) + '</div>') + '</div>';
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
    var hasConditions = filterOn() || smart.preset !== "all";
    listBody.innerHTML = '<div style="padding:8px">' + (hasConditions
      ? UI.emptyState({ icon:"filterOff", title:"没有符合当前视图条件的任务", text:"切换视图，或调整、清空筛选条件后重试。", actionLabel:"查看全部任务", compact:true })
      : UI.emptyState({ icon:"inbox", title:"这里还没有任务", textHtml:"新建一个任务；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。", actionLabel:"新建任务", compact:true })) + '</div>';
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
    rt.listSelected = {};
    syncListSelectionUI();
    appendListMore();
    return;
  }
  function rowHTML(t){
    if(rt.listSelected[t.id]) keepSelected[t.id] = true;
    return '<div class="list-row" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
      '<span><input type="checkbox" class="cbx" data-row-check="' + esc(t.id) + '" aria-label="选择任务：' + esc(t.title) + '"' + (rt.listSelected[t.id] ? ' checked' : '') + ' /></span>' +
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
      return head + (collapsed ? '' : g.rows.map(rowHTML).join(""));
    }).join("");
  }
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
  UI.syncBusy(true);
  API.post("/api/tasks/bulk-move", {
    ids: ids,
    column: column,
    autoTimer: false,
    autoResume: false
  }).then(function(res){
    UI.syncBusy(false);
    toast("已批量移动到「" + colName(column) + "」：" + ((res && res.moved) || ids.length) + " 项", "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  }).catch(function(ex){
    UI.syncBusy(false);
    toast("批量移动失败：" + (ex.message || "网络异常"), "bad");
  });
}
function openBulkMenu(anchor, kind){
  var el = document.createElement("div");
  el.className = "menu";
  var html = "";
  if(kind === "pri"){
    html = '<div class="menu-title">改为优先级</div>' + PRIORITIES.map(function(p){
      return '<button class="menu-item" type="button" data-bv="pri" data-v="' + p + '">' +
        '<span class="pdot ' + p + '"><i></i>' + p + '</span></button>';
    }).join("");
  }else if(kind === "owner"){
    html = '<div class="menu-title">改为负责人</div>' + ownerOptions().map(function(o){
      return '<button class="menu-item" type="button" data-bv="owner" data-v="' + esc(o.id) + '" data-n="' + esc(o.name) + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + '</button>';
    }).join("");
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
    else if(k === "owner") bulkApply(function(){ return {owner: n, ownerUserId: v || null}; }, "改负责人");
    else if(k === "due") bulkApply(function(){ return {dueDate: duePresetDate(v)}; }, "改截止");
    else if(k === "col") bulkMoveTo(v);
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
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
    msg:"将把选中的 <b>" + ids.length + "</b> 项任务移入回收站（30 天内可恢复）。确定继续？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    btnListBulk.disabled = true;
    UI.syncBusy(true);
    Promise.all(ids.map(function(id){
      return API.del("/api/tasks/" + encodeURIComponent(id)).catch(function(){ return null; });
    })).then(function(){
      UI.syncBusy(false);
      btnListBulk.disabled = false;
      toastAction("已移入回收站 " + ids.length + " 项", "撤销", function(){
        Promise.all(ids.map(function(id){
          return API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).catch(function(){ return null; });
        })).then(function(){
          toast("已恢复 " + ids.length + " 项", "fs");
          loadList(); loadBoard({animate:false}); loadReqs();
        });
      }, "", 8000);
      loadList(); loadBoard({animate:false}); loadReqs();
    });
  });
});
function openRowMenu(anchor, id){
  var t = rt.listCache[id];
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html = '<button class="menu-item" type="button" data-row-act="edit">' + icon("edit", 14) + '编辑</button>' +
    '<button class="menu-item" type="button" data-row-act="done">' + icon(isDone ? "undo" : "check", 14) +
      (isDone ? "取消完成" : "标记完成") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="due">' + icon("calSmall", 14) + '改期</button>' +
    '<button class="menu-item" type="button" data-row-act="timer">' +
      icon("timer", 14) + (running ? "停止计时" : "开始计时") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-row-act="link">' + icon("extlink", 14) + '复制任务链接</button>';
  var others = COLUMNS.filter(function(c){ return c.id !== t.boardColumn; });
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-row-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  html += '<div class="menu-sep"></div>' +
    '<button class="menu-item danger" type="button" data-row-act="del">' + icon("trash", 14) + '移到回收站</button>';
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
      else if(k === "done") toggleTaskDone(t.id);
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "link") copyToClipboard(taskLink(t.id), "任务链接已复制（可直接定位到该任务）");
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      var to = mv.dataset.rowMove;
      API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: to}).then(function(res){
        toast("「" + t.title + "」移动到「" + colName(res.to) + "」" +
          (res.autoTimerStarted ? " · 已开始计时" : ""));
        loadList(); loadBoard({silent:true}); loadReqs();
      }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
listSort.addEventListener("change", function(){
  if(LIST_SORTS.indexOf(listSort.value) === -1) return;
  smart.sort = listSort.value;
  if(smart.sort === "due" || smart.sort === "priority" || smart.sort === "updated") serverSort = smart.sort;
  loadList();
  saveViewState();
});
window.addEventListener("ds:layout", function(){
  if(lastItems && lastItems.length) renderListItems(lastItems);
});

export { applyListSavedView, currentListViewId, currentListViewName, currentListViewParams, enterListView, listViewDeleted, loadList, markListViewSaved, refreshListIfOpen, renderSmartTabs };
