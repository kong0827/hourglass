/* core/filters-ui · 筛选栏、搜索、保存视图 */

import { API } from "./api.js";
import { $, chipsOwner, chipsPri, filterActions, moreFilterCount, moreFilterMenu, searchInput, searchWrap, selectedSummary, viewBox } from "./dom.js";
import { currentFilterParams, toggleFilterValue } from "./filters.js";
import { icon } from "./icons.js";
import { activeView, showView } from "./router.js";
import { filterOn, rt, selectedFilterCount, state } from "./state.js";
import { UI, esc, toast, toastAction } from "./ui.js";
import { PRIORITIES, PRIORITY_COLOR, avatarHTML } from "../lib/format.js";
import { loadBoard } from "../views/board.js";
import { loadCalendar, refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { loadView } from "./view-loader.js";
import { refreshListIfOpen } from "../views/list.js";
import { loadMine } from "../views/mine.js";

function metaCount(list, name){
  if(!list) return 0;
  for(var i = 0; i < list.length; i++) if(list[i].name === name) return list[i].count;
  return 0;
}
function overflowChipHTML(kind, n){
  return '<button class="chip" type="button" data-overflow="' + kind + '" aria-haspopup="true" aria-expanded="false" title="展开其余选项">＋' + n + '</button>';
}
function renderOwnerChips(meta){
  var owners = meta.owners || [];
  var only = owners.length <= 1 ? ((owners[0] && owners[0].name) || rt.OWNER_DEFAULT) : null;
  var html = "", shown = 0, items = [];
  if(only){
    var n0 = owners.length ? owners[0].count : 0;
    if(n0 > 0){
      html = '<span class="chip" style="cursor:default">' + avatarHTML(only, "sm") + esc(only) +
        ' <span class="n">' + n0 + '</span></span>';
      shown = 1;
    }
  }else{
    owners.forEach(function(o){
      var on = state.owners.indexOf(o.name) !== -1;
      if(o.count === 0 && !on) return;
      items.push({name:o.name, count:o.count, on:on});
    });
    items.slice(0, 3).forEach(function(o){
      html += '<button class="chip" type="button" data-owner="' + esc(o.name) + '" aria-pressed="' + o.on + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + ' <span class="n">' + o.count + '</span></button>';
      shown++;
    });
    if(items.length > 3) html += overflowChipHTML("owner", items.length - 3);
  }
  chipsOwner.innerHTML = html;
  $("fgOwner").hidden = shown === 0 && items.length === 0;
}
function renderPriChips(meta){
  var html = "", shown = 0, items = [];
  PRIORITIES.forEach(function(p){
    var on = state.pris.indexOf(p) !== -1;
    var n = metaCount(meta.pris, p);
    if(n === 0 && !on) return;
    items.push({name:p, count:n, on:on});
  });
  items.slice(0, 3).forEach(function(o){
    html += '<button class="chip ' + o.name.toLowerCase() + '" type="button" data-pri="' + o.name + '" aria-pressed="' + o.on + '">' +
      '<i class="cdot" style="background:' + PRIORITY_COLOR[o.name] + '"></i>' + o.name + ' <span class="n">' + o.count + '</span></button>';
    shown++;
  });
  if(items.length > 3) html += overflowChipHTML("pri", items.length - 3);
  chipsPri.innerHTML = html;
  $("fgPri").hidden = shown === 0 && items.length === 0;
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
  updateFilterActions();
}
function updateFilterActions(){
  var n = selectedFilterCount();
  filterActions.hidden = n === 0 && rt.savedViews.length === 0;
  selectedSummary.hidden = n === 0;
  selectedSummary.innerHTML = '已选 ' + n + ' 项 ' + icon("close", 12);
}
function renderFilterChips(){
  var meta = state.board ? state.board.meta : null;
  if(meta){
    renderOwnerChips(meta);
    renderPriChips(meta);
    renderMoreFilter(meta);
  }else{
    chipsOwner.innerHTML = "";
    chipsPri.innerHTML = "";
    moreFilterMenu.innerHTML = "";
    $("fgOwner").hidden = true;
    $("fgPri").hidden = true;
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
  }, 150);
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
  state.tags = []; state.due = null; state.focus = false; state.blocked = false;
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
  var ov = e.target.closest("[data-overflow]");
  if(ov){ openOverflowPop(ov); return; }
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
function openOverflowPop(anchor){
  var kind = anchor.dataset.overflow;
  var meta = state.board ? state.board.meta : null;
  if(!meta) return;
  var html = '<div class="menu-title">' + (kind === "owner" ? "全部负责人" : "全部优先级") +
    '</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">';
  if(kind === "owner"){
    (meta.owners || []).forEach(function(o){
      var on = state.owners.indexOf(o.name) !== -1;
      if(o.count === 0 && !on) return;
      html += '<button class="chip" type="button" data-owner="' + esc(o.name) + '" aria-pressed="' + on + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + ' <span class="n">' + o.count + '</span></button>';
    });
  }else{
    PRIORITIES.forEach(function(pp){
      var on = state.pris.indexOf(pp) !== -1;
      var n = metaCount(meta.pris, pp);
      if(n === 0 && !on) return;
      html += '<button class="chip ' + pp.toLowerCase() + '" type="button" data-pri="' + pp + '" aria-pressed="' + on + '">' +
        '<i class="cdot" style="background:' + PRIORITY_COLOR[pp] + '"></i>' + pp + ' <span class="n">' + n + '</span></button>';
    });
  }
  html += '</div></div>';
  var el = document.createElement("div");
  el.className = "menu popover";
  el.innerHTML = html;
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
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
      reqs = strArr(p.reqs), tags = strArr(p.tags);
  if(!owners || !pris || !cats || !reqs || !tags) return null;
  if(p.q !== undefined && p.q !== null && typeof p.q !== "string") return null;
  if(p.focus !== undefined && p.focus !== null && typeof p.focus !== "boolean") return null;
  if(p.blocked !== undefined && p.blocked !== null && typeof p.blocked !== "boolean") return null;
  return {
    q: p.q || "",
    owners: owners, pris: pris, cats: cats, reqs: reqs, tags: tags,
    due: (p.due === "over" || p.due === "today" || p.due === "soon") ? p.due : null,
    focus: p.focus === true,
    blocked: p.blocked === true,
    doneScope: p.doneScope === "all" ? "all" : "week"
  };
}
function applyView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  var f = parseViewParams(p);
  if(!f){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  state.q = f.q; state.owners = f.owners; state.pris = f.pris; state.cats = f.cats;
  state.reqs = f.reqs; state.tags = f.tags; state.due = f.due; state.focus = f.focus;
  state.blocked = f.blocked;
  state.doneScope = f.doneScope;
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  reloadFilteredViews();
  toast("已应用视图「" + v.name + "」", "fs");
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
  if(dl){
    UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响任务数据。", okText:"删除" }).then(function(ok){
      if(!ok) return;
      API.del("/api/views/" + encodeURIComponent(dl.dataset.viewDel)).then(function(){
        toast("视图已删除", "fs");
        loadViews();
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
});
function promptSaveView(){
  if(!filterOn()){ toast("当前没有筛选条件，先设置筛选再保存", "warn"); return; }
  $("dlgViewInput").value = "";
  $("fDlgViewName").classList.remove("invalid");
  UI.openModal($("dlgViewName"));
}
$("btnSaveView").addEventListener("click", promptSaveView);
$("dlgViewNameForm").addEventListener("submit", function(e){
  e.preventDefault();
  var name = $("dlgViewInput").value.trim();
  if(!name){ $("fDlgViewName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  API.post("/api/views", { name: name, params: JSON.stringify(currentFilterParams()) }).then(function(){
    UI.closeModal($("dlgViewName"));
    toast("已保存视图「" + name + "」", "fs");
    loadViews();
    if(activeView === "gantt") loadView("gantt").then(function(m){ m.renderGanttViewsMenu(); });
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
});

export { applyView, clearFilters, loadViews, promptSaveView, reloadFilteredViews, renderFilterChips, toggleIn };
