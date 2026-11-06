/* core/filters-ui · 筛选栏、搜索、保存视图 */

import { API } from "./api.js";
import { $, chipsOwner, chipsPri, chipsType, chipsVersion, filterActions, moreFilterCount, moreFilterMenu, searchInput, searchWrap, selectedSummary, viewBox } from "./dom.js";
import { currentFilterParams, toggleFilterValue, updateBrand } from "./filters.js";
import { icon } from "./icons.js";
import { activeView, showView } from "./router.js";
import { filterOn, rt, selectedFilterCount, state } from "./state.js";
import { UI, esc, toast, toastAction } from "./ui.js";
import { PRIORITIES, avatarHTML, priColor, priName, typeName } from "../lib/format.js";
import { loadBoard } from "../views/board.js";
import { loadCalendar, refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { loadView } from "./view-loader.js";
import { applyListSavedView, currentListViewId, currentListViewName, currentListViewParams, listViewDeleted, markListViewSaved, refreshListIfOpen, renderSmartTabs } from "../views/list.js";
import { loadMine } from "../views/mine.js";

function metaCount(list, name){
  if(!list) return 0;
  for(var i = 0; i < list.length; i++) if(list[i].name === name) return list[i].count;
  return 0;
}
/* 负责人 / 优先级选项可能很多：不再铺 chip，改为单个下拉按钮 + 可勾选列表 */
function ownerItems(meta){
  var items = [];
  (meta.owners || []).forEach(function(o){
    var on = state.owners.indexOf(o.name) !== -1;
    if(o.count === 0 && !on) return;
    items.push({name:o.name, count:o.count, on:on});
  });
  return items;
}
function priItems(meta){
  var items = [];
  PRIORITIES.forEach(function(p){
    var on = state.pris.indexOf(p) !== -1;
    var n = metaCount(meta.pris, p);
    if(n === 0 && !on) return;
    items.push({name:p, count:n, on:on});
  });
  return items;
}
var TYPE_ORDER = ["task", "story", "bug", "epic"];
function typeItems(meta){
  var items = [];
  TYPE_ORDER.forEach(function(t){
    var on = state.types.indexOf(t) !== -1;
    var n = metaCount(meta.types, t);
    if(n === 0 && !on) return;
    items.push({name:t, count:n, on:on});
  });
  return items;
}
/* 版本按 ID 筛选：同名版本跨项目存在，展示时用项目名消歧；进行中版本置顶并标记 */
function versionItems(meta){
  var vs = (meta.versions || []).slice().sort(function(a, b){
    if((a.status === "active") !== (b.status === "active")) return a.status === "active" ? -1 : 1;
    return 0;
  });
  var nameCount = {};
  vs.forEach(function(v){ nameCount[v.name] = (nameCount[v.name] || 0) + 1; });
  var items = [];
  vs.forEach(function(v){
    var on = state.versions.indexOf(v.id) !== -1;
    /* 进行中版本是当前迭代锚点，即使暂无任务也保留在筛选里并高亮 */
    if(v.count === 0 && !on && v.status !== "active") return;
    var label = v.name;
    if(nameCount[v.name] > 1 && v.projectName) label = v.name + "（" + v.projectName + "）";
    items.push({id:v.id, name:label, count:v.count, on:on, active:v.status === "active"});
  });
  var noneOn = state.versions.indexOf("__none") !== -1;
  if((meta.versionUnassigned || 0) > 0 || noneOn){
    items.push({id:"__none", name:"待规划", count:meta.versionUnassigned || 0, on:noneOn});
  }
  return items;
}
function itemVal(o){ return o.id !== undefined ? o.id : o.name; }
function ddCount(items, selected){
  var n = 0;
  items.forEach(function(o){
    if(!selected.length || selected.indexOf(itemVal(o)) !== -1) n += o.count || 0;
  });
  return n;
}
function ddButtonHTML(kind, selected, items){
  var first;
  if(kind === "version"){
    var f0 = null;
    for(var i = 0; i < items.length; i++) if(itemVal(items[i]) === selected[0]) f0 = items[i];
    first = f0 ? f0.name : selected[0];
  }else{
    first = kind === "type" ? typeName(selected[0]) : (kind === "pri" ? priName(selected[0]) : selected[0]);
  }
  var label = !selected.length ? "全部"
    : (selected.length === 1 ? first : first + " +" + (selected.length - 1));
  var title = kind === "owner" ? "负责人" : (kind === "type" ? "类型" : (kind === "version" ? "版本" : "优先级"));
  return '<button class="chip' + (selected.length ? "" : " ghost") + '" type="button" data-dd="' + kind +
    '" aria-haspopup="true" aria-expanded="false" title="选择' + title + '（可多选）">' +
    esc(label) + ' <span class="n">' + ddCount(items, selected) + '</span>' + icon("caretDown", 12) + '</button>';
}
function renderOwnerChips(meta){
  var owners = meta.owners || [];
  var only = owners.length <= 1 ? ((owners[0] && owners[0].name) || rt.OWNER_DEFAULT) : null;
  if(only){
    var n0 = owners.length ? owners[0].count : 0;
    chipsOwner.innerHTML = n0 > 0
      ? '<span class="chip" style="cursor:default">' + avatarHTML(only, "sm") + esc(only) + ' <span class="n">' + n0 + '</span></span>'
      : "";
    $("fgOwner").hidden = n0 === 0;
    return;
  }
  var items = ownerItems(meta);
  chipsOwner.innerHTML = ddButtonHTML("owner", state.owners, items);
  $("fgOwner").hidden = items.length === 0 && state.owners.length === 0;
  reopenDropdown("owner");
}
function renderPriChips(meta){
  var items = priItems(meta);
  chipsPri.innerHTML = ddButtonHTML("pri", state.pris, items);
  $("fgPri").hidden = items.length === 0 && state.pris.length === 0;
  reopenDropdown("pri");
}
function renderTypeChips(meta){
  var items = typeItems(meta);
  chipsType.innerHTML = ddButtonHTML("type", state.types, items);
  $("fgType").hidden = items.length === 0 && state.types.length === 0;
  reopenDropdown("type");
}
function renderVersionChips(meta){
  var items = versionItems(meta);
  chipsVersion.innerHTML = ddButtonHTML("version", state.versions, items);
  $("fgVersion").hidden = items.length === 0 && state.versions.length === 0;
  reopenDropdown("version");
}
function renderMoreFilter(meta){
  var cats = (meta.cats || []).filter(function(c){ return c.count > 0 || state.cats.indexOf(c.name) !== -1; });
  var tags = (meta.tags || []).filter(function(t){ return t.count > 0 || state.tags.indexOf(t.name) !== -1; });
  var reqs = (meta.reqs || []).filter(function(r){ return r.count > 0 || state.reqs.indexOf(r.id) !== -1; });
  var noneOn = state.reqs.indexOf("__none") !== -1;

  function section(title, inner){
    if(!inner) return "";
    return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
  }
  var catInner = cats.map(function(c){
    var on = state.cats.indexOf(c.name) !== -1;
    return '<button class="chip" type="button" data-cat="' + esc(c.name) + '" aria-pressed="' + on + '">' +
      esc(c.name) + ' <span class="n">' + c.count + '</span></button>';
  }).join("");
  var tagInner = tags.map(function(t){
    var on = state.tags.indexOf(t.name) !== -1;
    return '<button class="chip" type="button" data-tag="' + esc(t.name) + '" aria-pressed="' + on + '">' +
      esc(t.name) + ' <span class="n">' + t.count + '</span></button>';
  }).join("");
  var reqInner = reqs.map(function(r){
    var on = state.reqs.indexOf(r.id) !== -1;
    return '<button class="chip" type="button" data-req="' + esc(r.id) + '" aria-pressed="' + on + '">' +
      esc(r.name) + ' <span class="n">' + r.count + '</span></button>';
  }).join("");
  if((meta.unassigned || 0) > 0 || noneOn){
    reqInner += '<button class="chip ghost" type="button" data-req="__none" aria-pressed="' + noneOn + '">未归类 <span class="n">' +
      (meta.unassigned || 0) + '</span></button>';
  }
  var blockedInner = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="' + (state.blocked ? "true" : "false") + '">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞</button>';

  var html = '<div class="menu-title">更多筛选</div>' +
    section("状态", blockedInner) +
    section("分类", catInner) + section("标签", tagInner) + section("项目", reqInner);
  if(!catInner && !tagInner && !reqInner){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">当前空间还没有分类、标签或项目可供筛选。</p></div>';
  }
  /* O-15 / F11：去掉只负责关闭的「应用」按钮——本栏所有 chip 都是即时生效，留着它会误导用户 */
  html += '<div class="menu-foot">' +
      '<button class="btn sm" type="button" data-mf-reset>重置</button>' +
    '</div>';
  moreFilterMenu.innerHTML = html;

  var n = state.cats.length + state.tags.length + state.reqs.length + (state.blocked ? 1 : 0);
  moreFilterCount.hidden = n === 0;
  moreFilterCount.textContent = n;
}
function renderQueryChip(){
  var box = $("chipsQuery");
  if(!box) return;
  if(!state.q){ box.innerHTML = ""; $("fgQuery").hidden = true; return; }
  box.innerHTML = '<button class="chip query-chip" type="button" data-clear-q title="清空搜索">' +
    icon("search", 12) + '<span class="q">' + esc(state.q) + '</span>' + icon("close", 12) + '</button>';
  $("fgQuery").hidden = false;
}
function renderBlockedChip(){
  var box = $("chipsBlocked");
  if(!box) return;
  if(!state.blocked){ box.innerHTML = ""; $("fgBlocked").hidden = true; return; }
  box.innerHTML = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="true" title="清空：只看被阻塞的任务">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞' + icon("close", 12) + '</button>';
  $("fgBlocked").hidden = false;
}
function renderViews(){
  if(!viewBox) return;
  viewBox.innerHTML = rt.savedViews.map(function(v){
    return '<span class="view-chip">' +
      '<button class="vname" type="button" data-view-apply="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="vx" type="button" data-view-del="' + esc(v.id) + '" title="删除视图" aria-label="删除视图">' + icon("close", 11) + '</button>' +
      '</span>';
  }).join("");
  $("viewGroup").hidden = rt.savedViews.length === 0;
  renderSmartTabs();
  updateFilterActions();
}
function updateFilterActions(){
  var n = selectedFilterCount();
  /* 列表视图由 Smart Bar 承载「视图」入口，筛选栏只保留清空与已选摘要 */
  var showActions = n > 0 || (activeView !== "list" && rt.savedViews.length > 0);
  filterActions.hidden = !showActions;
  selectedSummary.hidden = n === 0;
  selectedSummary.innerHTML = '已选 ' + n + ' 项 ' + icon("close", 12);
}
function renderFilterChips(){
  var meta = state.board ? state.board.meta : null;
  if(meta){
    renderOwnerChips(meta);
    renderPriChips(meta);
    renderTypeChips(meta);
    renderVersionChips(meta);
    renderMoreFilter(meta);
  }else{
    chipsOwner.innerHTML = "";
    chipsPri.innerHTML = "";
    chipsType.innerHTML = "";
    chipsVersion.innerHTML = "";
    moreFilterMenu.innerHTML = "";
    $("fgOwner").hidden = true;
    $("fgPri").hidden = true;
    $("fgType").hidden = true;
    $("fgVersion").hidden = true;
  }
  renderBlockedChip();
  renderQueryChip();
  updateFilterActions();
}
function toggleIn(arr, v){
  var i = arr.indexOf(v);
  if(i === -1) arr.push(v); else arr.splice(i, 1);
}
var filterReloadTimer = null;
function reloadFilteredViews(){
  /* 连续点选多个筛选条件时合并成一次请求（150ms），避免每点一下都刷新看板/列表/甘特 */
  if(filterReloadTimer) clearTimeout(filterReloadTimer);
  filterReloadTimer = setTimeout(function(){
    filterReloadTimer = null;
    loadBoard({animate:true});
    refreshListIfOpen();
    refreshGanttIfOpen();
    refreshCalendarIfOpen();
    if(activeView === "mine") loadMine({silent:true});
    if(activeView === "gantt") loadView("gantt").then(function(m){ m.renderGanttFilterState(); });
    saveViewState();
  }, 150);
}
/* 把当前筛选/视图/列表视图状态按工作区持久化到 localStorage，刷新后可恢复 */
var VIEW_STATE_KEY = "ds.viewState.v1";
function currentWsId(){ return rt.currentWs && rt.currentWs.id || ""; }
function saveViewState(){
  var ws = currentWsId();
  if(!ws) return;
  try{
    var listSnap = null;
    try{
      var lp = currentListViewParams();
      listSnap = { current: currentListViewId(), preset: lp.preset, group: lp.group, sort: lp.sort };
    }catch(err){ /* 列表模块尚未就绪 */ }
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      wsId: ws,
      filters: {
        q: state.q,
        owners: state.owners.slice(), pris: state.pris.slice(), cats: state.cats.slice(), reqs: state.reqs.slice(),
        tags: state.tags.slice(), types: state.types.slice(), versions: state.versions.slice(),
        due: state.due, focus: state.focus, blocked: state.blocked, doneScope: state.doneScope
      },
      list: listSnap
    }));
  }catch(e){ /* 隐私模式/受限环境忽略 */ }
}
function restoreViewState(){
  if(!rt.currentWs) return false;
  var snap;
  try{ snap = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || "null"); }catch(e){ return false; }
  if(!snap || snap.wsId !== rt.currentWs.id) return false;
  var changed = false;
  var f = snap.filters;
  if(f){
    var newQ = typeof f.q === "string" ? f.q : "";
    if(newQ !== state.q){ state.q = newQ; changed = true; }
    ["owners","pris","cats","reqs","tags","types","versions"].forEach(function(k){
      var arr = Array.isArray(f[k]) ? f[k].slice() : [];
      if(arr.length !== state[k].length || arr.some(function(v,i){ return v !== state[k][i]; })){ state[k] = arr; changed = true; }
    });
    var newDue = f.due || null;
    if(newDue !== state.due){ state.due = newDue; changed = true; }
    var newFocus = !!f.focus;
    if(newFocus !== state.focus){ state.focus = newFocus; changed = true; }
    var newBlocked = !!f.blocked;
    if(newBlocked !== state.blocked){ state.blocked = newBlocked; changed = true; }
    var newDoneScope = f.doneScope || "week";
    if(newDoneScope !== state.doneScope){ state.doneScope = newDoneScope; changed = true; }
  }
  if(snap.list && typeof applyListSavedView === "function"){
    var lp = currentListViewParams();
    if((snap.list.current || "all") !== currentListViewId() ||
       snap.list.preset !== lp.preset || snap.list.group !== lp.group || snap.list.sort !== lp.sort){
      applyListSavedView(snap.list.current || "all", {
        preset: snap.list.preset || "all",
        group: snap.list.group || "none",
        sort: snap.list.sort || "default"
      });
      changed = true;
    }
  }
  if(changed){
    if(searchInput){ searchInput.value = state.q; searchWrap.classList.toggle("has", !!state.q); }
    renderFilterChips();
    updateBrand();
  }
  return changed;
}
var searchTimer = null;
searchInput.addEventListener("input", function(){
  searchWrap.classList.toggle("has", searchInput.value.trim().length > 0);
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(function(){ applySearch(searchInput.value.trim()); }, 300);
});
function applySearch(kw){
  var supported = {board:1, list:1, mine:1, gantt:1, calendar:1};
  state.q = kw || "";
  searchWrap.classList.toggle("has", state.q.length > 0);
  saveViewState();
  /* 不支持筛选的视图：保留关键词并提示，由用户决定何时去看板/列表查看（不打断当前上下文） */
  if(kw && !supported[activeView]){
    toastAction("「" + kw + "」的搜索结果在看板 / 列表中查看", "去列表", function(){ showView("list"); }, "warn");
    return;
  }
  if(activeView === "mine"){ loadMine(); return; }
  if(activeView === "calendar"){ loadCalendar({silent:true}); return; }
  if(activeView === "gantt"){ loadView("gantt").then(function(m){ m.loadGantt({silent:true}); m.renderGanttFilterState(); }); return; }
  reloadFilteredViews();
}
$("searchClear").addEventListener("click", function(){
  searchInput.value = "";
  state.q = "";
  searchWrap.classList.remove("has");
  applySearch("");
  searchInput.focus();
});
function setDueFilter(v){
  state.due = (state.due === v) ? null : v;
  reloadFilteredViews();
}
$("chipOver").addEventListener("click", function(){ setDueFilter("over"); });
$("chipToday").addEventListener("click", function(){ setDueFilter("today"); });
$("chipSoon").addEventListener("click", function(){ setDueFilter("soon"); });
$("chipFocus").addEventListener("click", function(){
  state.focus = !state.focus;
  reloadFilteredViews();
});
function clearFilters(){
  state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.reqs = [];
  state.tags = []; state.types = []; state.versions = []; state.due = null; state.focus = false; state.blocked = false;
  searchInput.value = "";
  searchWrap.classList.remove("has");
  reloadFilteredViews();
}
$("btnClearFilter").addEventListener("click", function(){ clearFilters(); });
selectedSummary.addEventListener("click", function(){
  var n = selectedFilterCount();
  if(n >= 3){
    UI.showConfirm({
      title:"清空筛选",
      msg:"当前有 <b>" + n + "</b> 项筛选条件，确定全部清空？",
      okText:"清空",
      danger:false
    }).then(function(ok){ if(ok) clearFilters(); });
    return;
  }
  clearFilters();
});
$("filterbar").addEventListener("click", function(e){
  var o = e.target.closest("[data-owner]");
  if(o){ toggleFilterValue("owners", o.dataset.owner); return; }
  var p = e.target.closest("[data-pri]");
  if(p){ toggleFilterValue("pris", p.dataset.pri); return; }
  var c = e.target.closest("[data-cat]");
  if(c){ toggleFilterValue("cats", c.dataset.cat); return; }
  var r = e.target.closest("[data-req]");
  if(r){ toggleFilterValue("reqs", r.dataset.req); return; }
  var t = e.target.closest("[data-tag]");
  if(t){ toggleFilterValue("tags", t.dataset.tag); return; }
  var dd = e.target.closest("[data-dd]");
  if(dd){
    if(ddPop && ddPop.anchor === dd){ UI.closeAllPops(); return; }
    openFilterDropdown(dd);
    return;
  }
  if(e.target.closest("[data-mf-reset]")){
    state.cats = []; state.tags = []; state.reqs = []; state.blocked = false;
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-blocked-filter]")){
    state.blocked = !state.blocked;
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-clear-q]")){
    searchInput.value = "";
    searchWrap.classList.remove("has");
    applySearch("");
    return;
  }
});
var ddPop = null;
function openFilterDropdown(anchor){
  var kind = anchor.dataset.dd;
  var meta = state.board ? state.board.meta : null;
  if(!meta) return;
  var el = document.createElement("div");
  el.className = "menu popover filter-dd";
  function rows(){
    var items = kind === "owner" ? ownerItems(meta)
      : (kind === "type" ? typeItems(meta) : (kind === "version" ? versionItems(meta) : priItems(meta)));
    var sel = kind === "owner" ? state.owners
      : (kind === "type" ? state.types : (kind === "version" ? state.versions : state.pris));
    var title = kind === "owner" ? "负责人（可多选）"
      : (kind === "type" ? "类型（可多选）" : (kind === "version" ? "版本（可多选）" : "优先级（可多选）"));
    var html = '<div class="menu-title">' + title +
      '</div><div class="dd-list">';
    html += items.length ? items.map(function(o){
      var on = sel.indexOf(itemVal(o)) !== -1;
      var lead = kind === "owner"
        ? avatarHTML(o.name, "sm")
        : (kind === "type" || kind === "version" ? "" : '<i class="cdot" style="background:' + esc(priColor(o.name)) + '"></i>');
      return '<button class="dd-row' + (o.active ? " dd-active" : "") + '" type="button" data-dd-val="' + esc(itemVal(o)) + '" aria-pressed="' + on + '">' +
        '<span class="tick">' + (on ? icon("check", 12) : "") + '</span>' + lead +
        '<span class="dd-name">' + (kind === "type" ? esc(typeName(o.name)) : (kind === "pri" ? esc(priName(o.name)) : esc(o.name))) + '</span>' +
        (o.active ? '<span class="tag tag-info">开发中</span>' : '') +
        '<span class="n">' + o.count + '</span></button>';
    }).join("") : '<p class="foot-note" style="margin:0;padding:8px">暂无可选项</p>';
    html += '</div>';
    if(sel.length){
      html += '<div class="menu-foot"><button class="btn sm" type="button" data-dd-clear>清空选择</button></div>';
    }
    return html;
  }
  el.innerHTML = rows();
  el.addEventListener("click", function(e){
    if(e.target.closest("[data-dd-clear]")){
      if(kind === "owner") state.owners = [];
      else if(kind === "type") state.types = [];
      else if(kind === "version") state.versions = [];
      else state.pris = [];
      reloadFilteredViews();
      el.innerHTML = rows();
      return;
    }
    var row = e.target.closest("[data-dd-val]");
    if(!row) return;
    toggleFilterValue(kind === "owner" ? "owners" : (kind === "type" ? "types" : (kind === "version" ? "versions" : "pris")), row.dataset.ddVal);
    el.innerHTML = rows();
  });
  ddPop = { anchor: anchor, el: el, kind: kind };
  UI.openPop(el, anchor, {align:"left", onClose:function(){ el.remove(); ddPop = null; }});
}
/* 筛选后 chip 会整体重绘，旧锚点被移除：把浮层重新挂到新按钮上，多选时不中断 */
function reopenDropdown(kind){
  if(!ddPop || ddPop.kind !== kind) return;
  UI.closeAllPops();
  var anchor = document.querySelector('[data-dd="' + kind + '"]');
  if(anchor) openFilterDropdown(anchor);
}
$("btnMoreFilter").addEventListener("click", function(){
  if(UI.popOpen(moreFilterMenu)){ UI.closeAllPops(); return; }
  UI.openPop(moreFilterMenu, $("btnMoreFilter"), {align:"left", width:320});
});
function loadViews(){
  return API.get("/api/views").then(function(list){
    rt.savedViews = list || [];
    renderViews();
  }).catch(function(){});
}
function parseViewParams(p){
  if(!p || typeof p !== "object" || Array.isArray(p)) return null;
  function strArr(v){
    if(v === undefined || v === null) return [];
    if(!Array.isArray(v)) return null;
    for(var i = 0; i < v.length; i++) if(typeof v[i] !== "string") return null;
    return v.slice();
  }
  var owners = strArr(p.owners), pris = strArr(p.pris), cats = strArr(p.cats),
      reqs = strArr(p.reqs), tags = strArr(p.tags), types = strArr(p.types), versions = strArr(p.versions);
  if(!owners || !pris || !cats || !reqs || !tags || !types || !versions) return null;
  if(p.q !== undefined && p.q !== null && typeof p.q !== "string") return null;
  if(p.focus !== undefined && p.focus !== null && typeof p.focus !== "boolean") return null;
  if(p.blocked !== undefined && p.blocked !== null && typeof p.blocked !== "boolean") return null;
  var preset = (p.preset === undefined || p.preset === null) ? "all" : p.preset;
  var group = (p.group === undefined || p.group === null) ? "none" : p.group;
  var sort = (p.sort === undefined || p.sort === null) ? "default" : p.sort;
  if(["all", "mine", "doing", "over"].indexOf(preset) === -1) return null;
  if(["none", "status", "owner", "priority", "project"].indexOf(group) === -1) return null;
  if(["default", "due", "priority", "estimate", "actual", "updated"].indexOf(sort) === -1) return null;
  return {
    q: p.q || "",
    owners: owners, pris: pris, cats: cats, reqs: reqs, tags: tags, types: types, versions: versions,
    due: (p.due === "over" || p.due === "today" || p.due === "soon") ? p.due : null,
    focus: p.focus === true,
    blocked: p.blocked === true,
    doneScope: p.doneScope === "all" ? "all" : "week",
    preset: preset,
    group: group,
    sort: sort,
    listConfig: p.preset !== undefined || p.group !== undefined || p.sort !== undefined
  };
}
function applyView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  var f = parseViewParams(p);
  if(!f){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  state.q = f.q; state.owners = f.owners; state.pris = f.pris; state.cats = f.cats;
  state.reqs = f.reqs; state.tags = f.tags; state.types = f.types; state.versions = f.versions;
  state.due = f.due; state.focus = f.focus;
  state.blocked = f.blocked;
  state.doneScope = f.doneScope;
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  if(f.listConfig || activeView === "list"){
    applyListSavedView(v.id, f);
    loadBoard({animate:false});
    if(activeView === "list") refreshListIfOpen();
    else showView("list");
  }else{
    reloadFilteredViews();
  }
  toast("已应用视图「" + v.name + "」", "fs");
}
function deleteView(id){
  UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响任务数据。", okText:"删除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      listViewDeleted(id);
      loadViews();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
viewBox.addEventListener("click", function(e){
  var ap = e.target.closest("[data-view-apply]");
  if(ap){
    for(var i = 0; i < rt.savedViews.length; i++){
      if(String(rt.savedViews[i].id) === String(ap.dataset.viewApply)){ applyView(rt.savedViews[i]); return; }
    }
    return;
  }
  var dl = e.target.closest("[data-view-del]");
  if(dl) deleteView(dl.dataset.viewDel);
});
function promptSaveView(){
  var forList = activeView === "list";
  if(!forList && !filterOn()){ toast("当前没有筛选条件，先设置筛选再保存", "warn"); return; }
  $("dlgViewInput").value = forList ? currentListViewName() : "";
  $("fDlgViewName").classList.remove("invalid");
  var desc = $("dlgViewName").querySelector(".desc");
  if(desc) desc.textContent = forList ? "保存当前筛选、分组与排序；同名保存将覆盖原视图" : "保存当前全部筛选条件，可跨设备应用";
  UI.openModal($("dlgViewName"));
}
$("btnSaveView").addEventListener("click", promptSaveView);
$("dlgViewNameForm").addEventListener("submit", function(e){
  e.preventDefault();
  var name = $("dlgViewInput").value.trim();
  if(!name){ $("fDlgViewName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  var forList = activeView === "list";
  var params = currentFilterParams();
  if(forList){
    var listParams = currentListViewParams();
    params.preset = listParams.preset;
    params.group = listParams.group;
    params.sort = listParams.sort;
  }
  var overwrite = rt.savedViews.some(function(v){ return v.name === name; });
  var submitBtn = $("dlgViewNameOk");
  submitBtn.disabled = true;
  API.post("/api/views", { name: name, params: JSON.stringify(params) }).then(function(saved){
    submitBtn.disabled = false;
    UI.closeModal($("dlgViewName"));
    if(forList && saved) markListViewSaved(saved.id);
    toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
    loadViews();
    if(activeView === "gantt") loadView("gantt").then(function(m){ m.renderGanttViewsMenu(); });
  }).catch(function(ex){ submitBtn.disabled = false; toast(ex.message || "保存失败", "bad"); });
});

export { applyView, clearFilters, deleteView, loadViews, promptSaveView, reloadFilteredViews, renderFilterChips, restoreViewState, saveViewState, toggleIn };
