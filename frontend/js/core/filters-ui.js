/* core/filters-ui · 筛选栏、搜索、保存视图 */

import { API } from "./api.js";
import { $, chipsCats, chipsDate, chipsOwner, chipsPri, chipsReqs, chipsTags, chipsType, chipsVersion, dimGroup, dimMenu, filterActions, moreFilterCount, moreFilterMenu, searchInput, searchWrap, selectedSummary, viewBox } from "./dom.js";
import { currentFilterParams, toggleFilterValue, updateBrand } from "./filters.js";
import { icon } from "./icons.js";
import { isMobile } from "./layout.js";
import { activeView, showView } from "./router.js";
import { catNameById, filterOn, rt, selectedFilterCount, state } from "./state.js";
import { UI, esc, toast, toastAction } from "./ui.js";
import { COLUMNS, PRIORITIES, colName, iso, priName, typeName } from "../lib/format.js";
import { loadBoard } from "../views/board.js";
import { loadCalendar, refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { loadView } from "./view-loader.js";
import { applyListSavedView, currentListViewId, currentListViewName, currentListViewParams, listViewDeleted, markListViewSaved, refreshListIfOpen, renderSmartTabs } from "../views/list.js";
import { loadMine } from "../views/mine.js";
import { viewParamProvider } from "./view-params.js";

var mfVersionQ = "";
function applyVersionFilter(){
  var menu = moreFilterMenu;
  if(!menu) return;
  var input = menu.querySelector("[data-mf-version-q]");
  if(!input) return;
  mfVersionQ = String(input.value || "").toLowerCase();
  var empty = menu.querySelector("[data-mf-version-empty]");
  var shown = 0;
  menu.querySelectorAll("[data-mf-version-item]").forEach(function(btn){
    var hit = !mfVersionQ || String(btn.dataset.label || "").indexOf(mfVersionQ) !== -1
      || btn.getAttribute("aria-pressed") === "true";
    btn.hidden = !hit;
    if(hit) shown++;
  });
  if(empty) empty.hidden = shown > 0;
}
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
  /* 空值也是一档筛选条件：没填负责人的工作项同样需要能被找出来 */
  var noneOn = state.owners.indexOf("__none") !== -1;
  var noneCount = meta.ownerUnassigned || 0;
  if(noneCount > 0 || noneOn) items.push({id:"__none", name:"无负责人", count:noneCount, on:noneOn});
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
/* 状态（看板列）按真实列定义渲染；meta.columns 提供各列计数，缺省时不显示数字 */
function columnItems(meta){
  var counts = {};
  (meta.columns || []).forEach(function(c){ counts[c.name] = c.count; });
  return COLUMNS.map(function(c){
    return { id:c.id, name:c.name, color:c.color, count:counts[c.id], on:state.columns.indexOf(c.id) !== -1 };
  });
}
var COMPLETION_OPTIONS = [["", "全部"], ["open", "未完成"], ["done", "已完成"]];
function completionLabel(v){
  for(var i = 0; i < COMPLETION_OPTIONS.length; i++) if(COMPLETION_OPTIONS[i][0] === (v || "")) return COMPLETION_OPTIONS[i][1];
  return "全部";
}
function itemVal(o){ return o.id !== undefined ? o.id : o.name; }
/* 项目 / 模块：与其它维度一样带计数，「未指定」作为空值项保留在末位 */
function reqItems(meta){
  var items = [];
  (meta.reqs || []).forEach(function(r){
    var on = state.reqs.indexOf(r.id) !== -1;
    if(r.count === 0 && !on) return;
    items.push({id:r.id, name:r.name, count:r.count, on:on});
  });
  var noneOn = state.reqs.indexOf("__none") !== -1;
  var noneCount = meta.unassigned || 0;
  if(noneCount > 0 || noneOn) items.push({id:"__none", name:"未归类", count:noneCount, on:noneOn});
  return items;
}
function catItems(meta){
  var items = [];
  (meta.cats || []).forEach(function(c){
    var on = state.cats.indexOf(c.id) !== -1;
    if(c.count === 0 && !on) return;
    items.push({id:c.id, name:c.name, count:c.count, on:on});
  });
  var noneOn = state.cats.indexOf("__none") !== -1;
  var noneCount = meta.catUnassigned || 0;
  if(noneCount > 0 || noneOn) items.push({id:"__none", name:"未指定模块", count:noneCount, on:noneOn});
  return items;
}
function tagItems(meta){
  var items = [];
  (meta.tags || []).forEach(function(t){
    var on = state.tags.indexOf(t.name) !== -1;
    if(t.count === 0 && !on) return;
    items.push({name:t.name, count:t.count, on:on});
  });
  return items;
}
/* 已选维度在筛选栏里只留一枚可清除的 chip；可选值统一收进下拉 Popover */
function dimTitle(kind){
  return kind === "owner" ? "负责人" : (kind === "type" ? "类型" : (kind === "version" ? "版本"
    : (kind === "pri" ? "优先级" : (kind === "req" ? "项目" : (kind === "cat" ? "模块" : "标签")))));
}
function dimValueLabel(kind, value, items){
  if(kind === "pri") return priName(value);
  if(kind === "type") return typeName(value);
  if(kind === "owner") return value === "__none" ? "无负责人" : value;
  if(kind === "tag") return value;
  for(var i = 0; i < items.length; i++) if(itemVal(items[i]) === value) return items[i].name;
  return value;
}
function activeDimHTML(kind, selected, items){
  if(!selected.length) return "";
  var text = selected.length === 1
    ? dimTitle(kind) + "：" + dimValueLabel(kind, selected[0], items)
    : dimTitle(kind) + " " + selected.length + " 项";
  return '<button class="chip" type="button" data-clear-dim="' + kind + 's" aria-pressed="true" title="清除' +
    dimTitle(kind) + '筛选">' + esc(text) + icon("close", 12) + '</button>';
}
function renderOwnerChips(meta){
  var items = ownerItems(meta);
  chipsOwner.innerHTML = activeDimHTML("owner", state.owners, items);
  $("fgOwner").hidden = state.owners.length === 0;
}
function renderPriChips(meta){
  var items = priItems(meta);
  chipsPri.innerHTML = activeDimHTML("pri", state.pris, items);
  $("fgPri").hidden = state.pris.length === 0;
}
function renderTypeChips(meta){
  var items = typeItems(meta);
  chipsType.innerHTML = activeDimHTML("type", state.types, items);
  $("fgType").hidden = state.types.length === 0;
}
function renderVersionChips(meta){
  var items = versionItems(meta);
  chipsVersion.innerHTML = activeDimHTML("version", state.versions, items);
  $("fgVersion").hidden = state.versions.length === 0;
}
function renderColumnsChips(){
  var box = $("chipsColumns");
  if(!box) return;
  if(!state.columns.length){ box.innerHTML = ""; $("fgColumns").hidden = true; return; }
  var text = state.columns.length === 1
    ? "状态：" + colName(state.columns[0])
    : "状态 " + state.columns.length + " 项";
  box.innerHTML = '<button class="chip" type="button" data-clear-dim="columns" aria-pressed="true" title="清除状态筛选">' +
    esc(text) + icon("close", 12) + '</button>';
  $("fgColumns").hidden = false;
}
function renderCompletionChip(){
  var box = $("chipsCompletion");
  if(!box) return;
  if(!state.completion){ box.innerHTML = ""; $("fgCompletion").hidden = true; return; }
  box.innerHTML = '<button class="chip" type="button" data-clear-completion aria-pressed="true" title="清除完成情况筛选">' +
    "完成情况：" + esc(completionLabel(state.completion)) + icon("close", 12) + '</button>';
  $("fgCompletion").hidden = false;
}
function renderReqsChip(meta){
  chipsReqs.innerHTML = activeDimHTML("req", state.reqs, reqItems(meta));
  $("fgReqs").hidden = state.reqs.length === 0;
}
function renderCatsChip(meta){
  chipsCats.innerHTML = activeDimHTML("cat", state.cats, catItems(meta));
  $("fgCats").hidden = state.cats.length === 0;
}
function renderTagsChip(meta){
  chipsTags.innerHTML = activeDimHTML("tag", state.tags, tagItems(meta));
  $("fgTags").hidden = state.tags.length === 0;
}
/* 日期区间统一按「截止 / 开始」两行展示；无截止日期是一档独立的空值筛选 */
function shortDay(v){
  return String(v || "").replace(/^\d{4}-/, "");
}
function dateRangeText(from, to){
  if(from && to) return from === to ? shortDay(from) : shortDay(from) + " ~ " + shortDay(to);
  if(from) return shortDay(from) + " 起";
  if(to) return "截至 " + shortDay(to);
  return "";
}
function dateFilterActive(){
  return !!(state.noDue || state.dueFrom || state.dueTo || state.startFrom || state.startTo);
}
function renderDateChip(){
  var box = $("chipsDate");
  if(!box) return;
  if(!dateFilterActive()){ box.innerHTML = ""; $("fgDate").hidden = true; return; }
  var bits = [];
  if(state.noDue) bits.push("无截止日期");
  var due = dateRangeText(state.dueFrom, state.dueTo);
  if(due) bits.push("截止 " + due);
  var start = dateRangeText(state.startFrom, state.startTo);
  if(start) bits.push("开始 " + start);
  box.innerHTML = '<button class="chip" type="button" data-clear-dates aria-pressed="true" title="清除日期筛选">' +
    esc(bits.join(" · ")) + icon("close", 12) + '</button>';
  $("fgDate").hidden = false;
}

/* ==================== 平铺维度下拉（项目 / 状态 / 负责人 / 优先级） ==================== */
/* 四个高频维度直接摆在筛选栏上，点开是可多选、带计数与搜索的下拉；
   其余维度留在「更多筛选」，避免一次性把十几个维度堆在只有 48px 高的栏里。 */
var DIM_ORDER = { reqs:"项目", columns:"状态", owners:"负责人", pris:"优先级" };
var dimQ = "";
function dimItemsOf(kind, meta){
  if(kind === "reqs") return reqItems(meta);
  if(kind === "cats") return catItems(meta);
  if(kind === "tags") return tagItems(meta);
  if(kind === "owners") return ownerItems(meta);
  if(kind === "pris") return priItems(meta);
  if(kind === "types") return typeItems(meta);
  if(kind === "versions") return versionItems(meta);
  if(kind === "columns") return columnItems(meta);
  return [];
}
function dimSelected(kind){ return state[kind] || []; }
function syncDimButtons(){
  if(!dimGroup) return;
  dimGroup.querySelectorAll("[data-dim-open]").forEach(function(btn){
    /* 我的工作天然只含本人任务，负责人维度没有意义，不摆出来制造「点了没反应」 */
    btn.hidden = activeView === "mine" && btn.dataset.dimOpen === "owners";
    var n = dimSelected(btn.dataset.dimOpen).length;
    btn.setAttribute("aria-pressed", n > 0 ? "true" : "false");
    if(n > 0){
      btn.title = "已按" + DIM_ORDER[btn.dataset.dimOpen] + "筛选 " + n + " 项，点击修改";
    }else{
      btn.title = "按" + DIM_ORDER[btn.dataset.dimOpen] + "筛选（可多选）";
    }
    var badge = btn.querySelector(".n");
    if(n > 0){
      if(!badge){ badge = document.createElement("span"); badge.className = "n"; btn.appendChild(badge); }
      badge.textContent = n;
    }else if(badge){
      badge.parentNode.removeChild(badge);
    }
  });
}
function renderDimMenu(kind){
  var meta = state.board && state.board.meta;
  if(!meta){
    dimMenu.innerHTML = '<div class="menu-field"><p class="foot-note" style="margin:0">筛选数据尚未加载，请稍候。</p></div>';
    return;
  }
  var items = dimItemsOf(kind, meta);
  var rows = items.map(function(o){
    var val = itemVal(o);
    var label = String(o.name);
    return '<button class="menu-item dim-opt" type="button" data-' + kind.slice(0, -1) + '="' + esc(val) +
      '" data-label="' + esc((label + " " + val).toLowerCase()) + '" aria-pressed="' + (o.on ? "true" : "false") + '">' +
      '<span class="ck" aria-hidden="true">' + (o.on ? icon("check", 13) : "") + '</span>' +
      (o.color ? '<i class="cdot" style="background:' + esc(o.color) + '"></i>' : "") +
      '<span class="dim-name">' + esc(label) + '</span>' +
      '<span class="k">' + (o.count == null ? "" : o.count) + '</span>' +
      '</button>';
  }).join("");
  if(!rows) rows = '<p class="foot-note dim-empty">当前空间还没有可选的' + DIM_ORDER[kind] + '。</p>';
  var search = items.length > 8
    ? '<div class="menu-field dim-search"><input type="search" data-dim-q value="' + esc(dimQ) +
      '" placeholder="搜索' + DIM_ORDER[kind] + '…（共 ' + items.length + ' 个）" aria-label="搜索' + DIM_ORDER[kind] + '" autocomplete="off"></div>'
    : "";
  dimMenu.innerHTML = '<div class="menu-title">' + DIM_ORDER[kind] + '</div>' + search +
    '<div class="dim-list">' + rows + '<p class="foot-note dim-empty" data-dim-empty hidden>没有匹配的选项</p></div>' +
    '<div class="menu-foot"><button class="btn sm" type="button" data-dim-clear="' + kind + '"' +
      (dimSelected(kind).length ? "" : " disabled") + '>清空' + DIM_ORDER[kind] + '</button></div>';
  applyDimSearch();
}
function applyDimSearch(){
  if(!dimMenu) return;
  var input = dimMenu.querySelector("[data-dim-q]");
  if(!input) return;
  dimQ = String(input.value || "").toLowerCase();
  var shown = 0;
  dimMenu.querySelectorAll(".dim-opt").forEach(function(btn){
    var hit = !dimQ || btn.getAttribute("aria-pressed") === "true"
      || String(btn.dataset.label || "").indexOf(dimQ) !== -1;
    btn.hidden = !hit;
    if(hit) shown++;
  });
  var empty = dimMenu.querySelector("[data-dim-empty]");
  if(empty) empty.hidden = shown > 0;
}
/* 勾选即时生效、菜单保持打开：只刷新选中态与计数，不重排列表，避免输入焦点和滚动位置丢失 */
function syncDimMenu(){
  if(!dimMenu) return;
  var kind = dimMenu.dataset.kind;
  if(!kind) return;
  var selected = dimSelected(kind);
  dimMenu.querySelectorAll(".dim-opt").forEach(function(btn){
    var on = selected.indexOf(btn.dataset[kind.slice(0, -1)]) !== -1;
    if((btn.getAttribute("aria-pressed") === "true") === on) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var ck = btn.querySelector(".ck");
    if(ck) ck.innerHTML = on ? icon("check", 13) : "";
  });
  var clear = dimMenu.querySelector("[data-dim-clear]");
  if(clear) clear.disabled = selected.length === 0;
}
function openDimMenu(kind, anchor){
  if(UI.popOpen(dimMenu) && dimMenu.dataset.kind === kind){ UI.closeAllPops(); return; }
  UI.closeAllPops();
  dimQ = "";
  dimMenu.dataset.kind = kind;
  renderDimMenu(kind);
  UI.openPop(dimMenu, anchor, {align:"left", width:288});
}
var DATE_PRESETS = [["week", "本周"], ["month", "本月"], ["next7", "未来 7 天"]];
/* 快捷区间按自然周 / 自然月计算，给的是可直接落到后端 dueFrom/dueTo 的 ISO 日期 */
function dateRangeOf(preset){
  var base = rt.TODAY;
  if(preset === "week"){
    var d = new Date(base.getTime());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var w = new Date(d.getTime());
    w.setDate(w.getDate() + 6);
    return [iso(d), iso(w)];
  }
  if(preset === "month"){
    return [iso(new Date(base.getFullYear(), base.getMonth(), 1)),
      iso(new Date(base.getFullYear(), base.getMonth() + 1, 0))];
  }
  if(preset === "next7"){
    var e = new Date(base.getTime());
    e.setDate(e.getDate() + 6);
    return [iso(base), iso(e)];
  }
  return null;
}
function datePresetOn(preset){
  var range = dateRangeOf(preset);
  return !!range && state.dueFrom === range[0] && state.dueTo === range[1];
}
function dateInput(key, label){
  return '<label class="mf-date-unit"><span class="group-label">' + label + '</span>' +
    '<input type="date" data-date="' + key + '" value="' + esc(state[key] || "") +
    '" aria-label="' + label + '" title="' + label + '"></label>';
}
function renderMoreFilter(meta){
  var cats = catItems(meta);
  var tags = tagItems(meta);
  var types = typeItems(meta);
  var versionList = versionItems(meta);

  function section(title, inner){
    if(!inner) return "";
    return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
  }
  function option(attr, value, label, count, on, lead){
    return '<button class="chip" type="button" data-' + attr + '="' + esc(value) + '" aria-pressed="' + on + '">' +
      (lead || "") + label + ' <span class="n">' + count + '</span></button>';
  }
  var typeInner = types.map(function(o){
    return option("type", o.name, esc(typeName(o.name)), o.count, state.types.indexOf(o.name) !== -1);
  }).join("");
  var versionInner = versionList.map(function(o){
    return option("version", itemVal(o), esc(o.name), o.count, state.versions.indexOf(itemVal(o)) !== -1)
      .replace('<button class="chip"', '<button class="chip" data-mf-version-item data-label="' + esc(String(o.name).toLowerCase()) + '"');
  }).join("");
  /* 版本会随发布持续累积，上百个平铺会撑爆弹层：超过一屏就加搜索并限制高度 */
  if(versionList.length > 8){
    versionInner = '<input type="search" class="mf-version-search" data-mf-version-q value="' + esc(mfVersionQ) +
      '" placeholder="搜索版本名…（共 ' + versionList.length + ' 个）" aria-label="搜索版本" autocomplete="off" />' +
      '<div class="mf-version-scroll" data-mf-version-list>' + versionInner +
      '<p class="foot-note mf-version-empty" data-mf-version-empty hidden style="margin:4px 0 0">没有匹配的版本</p></div>';
  }
  var catInner = cats.map(function(c){
    return option("cat", itemVal(c), esc(c.name), c.count, state.cats.indexOf(itemVal(c)) !== -1);
  }).join("");
  var tagInner = tags.map(function(t){
    return option("tag", t.name, esc(t.name), t.count, state.tags.indexOf(t.name) !== -1);
  }).join("");
  var blockedInner = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="' + (state.blocked ? "true" : "false") + '">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞</button>';
  var completionInner = COMPLETION_OPTIONS.map(function(o){
    return '<button class="chip" type="button" data-completion="' + o[0] + '" aria-pressed="' +
      ((state.completion || "") === o[0]) + '">' + o[1] + '</button>';
  }).join("");
  var duePresetInner = DATE_PRESETS.map(function(p){
    return '<button class="chip" type="button" data-date-preset="' + p[0] + '" aria-pressed="' + datePresetOn(p[0]) + '">' +
      p[1] + '</button>';
  }).join('') + '<button class="chip ghost" type="button" data-date-preset="none" aria-pressed="' + (state.noDue ? "true" : "false") + '">无截止日期</button>';
  var dueBlock = '<div class="menu-field dim-dates"><div class="group-label">截止日期</div>' +
    '<div class="mf-date-row">' + dateInput("dueFrom", "从") + '<span class="sep">~</span>' + dateInput("dueTo", "到") + '</div>' +
    '<div class="mf-date-quick">' + duePresetInner + '</div></div>';
  var startBlock = '<div class="menu-field dim-dates"><div class="group-label">开始日期</div>' +
    '<div class="mf-date-row">' + dateInput("startFrom", "从") + '<span class="sep">~</span>' + dateInput("startTo", "到") + '</div></div>';

  var html = '<div class="menu-title">更多筛选</div>' +
    section("模块", catInner) + section("标签", tagInner) +
    section("类型", typeInner) + section("版本", versionInner) +
    dueBlock + startBlock +
    section("完成情况", completionInner) + section("其他", blockedInner);
  if(!catInner && !tagInner && !typeInner && !versionInner){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">当前空间还没有可筛选的字段。</p></div>';
  }
  /* O-15 / F11：去掉只负责关闭的「应用」按钮——本栏所有 chip 都是即时生效，留着它会误导用户 */
  html += '<div class="menu-foot">' +
      '<button class="btn sm" type="button" data-mf-reset>重置筛选</button>' +
    '</div>';
  var scrollTop = moreFilterMenu.scrollTop;
  moreFilterMenu.innerHTML = html;
  moreFilterMenu.scrollTop = scrollTop;
  applyVersionFilter();

  var n = state.types.length + state.versions.length + state.cats.length + state.tags.length
    + (state.completion ? 1 : 0) + (state.blocked ? 1 : 0)
    + (state.noDue ? 1 : 0) + ((state.dueFrom || state.dueTo) ? 1 : 0)
    + ((state.startFrom || state.startTo) ? 1 : 0);
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
  box.innerHTML = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="true" title="清空：只看被阻塞的工作项">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞' + icon("close", 12) + '</button>';
  $("fgBlocked").hidden = false;
}
/* 保存视图按 scope 隔离：任务视图（无 scope）与需求池视图（scope=demand）共用一张表，展示/应用时互不可见 */
function viewScopeOf(v){
  try{ return (JSON.parse(v.params || "{}").scope) || "task"; }
  catch(e){ return "task"; }
}
function savedViewsFor(scope){
  return (rt.savedViews || []).filter(function(v){ return viewScopeOf(v) === scope; });
}
/* 我的工作不展示工作项列表的视图：这些视图含列表布局（预置/分组/排序），在那里只能部分生效 */
function viewsShownHere(){
  return activeView !== "mine" && savedViewsFor("task").length > 0;
}
function renderViews(){
  if(!viewBox) return;
  viewBox.innerHTML = savedViewsFor("task").map(function(v){
    return '<span class="view-chip">' +
      '<button class="vname" type="button" data-view-apply="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="vx" type="button" data-view-del="' + esc(v.id) + '" title="删除视图" aria-label="删除视图">' + icon("close", 11) + '</button>' +
      '</span>';
  }).join("");
  $("viewGroup").hidden = !viewsShownHere();
  renderSmartTabs();
  updateFilterActions();
}
function updateFilterActions(){
  var n = selectedFilterCount();
  /* 列表视图由 Smart Bar 承载「视图」入口，筛选栏只保留清空与已选摘要；
     我的工作不展示工作项列表的视图，因此也不因已有视图常驻操作区 */
  var showActions = n > 0 ||
    (activeView !== "list" && activeView !== "mine" && savedViewsFor("task").length > 0);
  filterActions.hidden = !showActions;
  selectedSummary.hidden = n === 0;
  selectedSummary.innerHTML = '已选 ' + n + ' 项 ' + icon("close", 12);
}
var lastActiveSig = "";
function renderFilterChips(){
  var meta = state.board ? state.board.meta : null;
  if(meta){
    renderOwnerChips(meta);
    renderPriChips(meta);
    renderTypeChips(meta);
    renderVersionChips(meta);
    renderReqsChip(meta);
    renderCatsChip(meta);
    renderTagsChip(meta);
    renderMoreFilter(meta);
  }else{
    chipsOwner.innerHTML = "";
    chipsPri.innerHTML = "";
    chipsType.innerHTML = "";
    chipsVersion.innerHTML = "";
    chipsReqs.innerHTML = "";
    chipsCats.innerHTML = "";
    chipsTags.innerHTML = "";
    moreFilterMenu.innerHTML = "";
    $("fgOwner").hidden = true;
    $("fgPri").hidden = true;
    $("fgType").hidden = true;
    $("fgVersion").hidden = true;
    $("fgReqs").hidden = true;
    $("fgCats").hidden = true;
    $("fgTags").hidden = true;
  }
  renderColumnsChips();
  renderCompletionChip();
  renderDateChip();
  renderBlockedChip();
  renderQueryChip();
  syncDimButtons();
  syncDimMenu();
  updateFilterActions();
  var sig = [state.owners, state.pris, state.types, state.versions, state.columns, state.completion,
    state.cats, state.tags, state.reqs, state.blocked, state.q,
    state.noDue, state.dueFrom, state.dueTo, state.startFrom, state.startTo].join("|");
  if(sig !== lastActiveSig){
    lastActiveSig = sig;
    var af = $("fbActive");
    if(af && af.scrollWidth > af.clientWidth) af.scrollLeft = af.scrollWidth;
  }
  updateMobFilterSummary();
}
function toggleIn(arr, v){
  var i = arr.indexOf(v);
  if(i === -1) arr.push(v); else arr.splice(i, 1);
}
var filterReloadTimer = null;
function reloadFilteredViews(){
  /* 先用上一份 meta 立即回显已选条件，避免等接口返回才出现 chip */
  renderFilterChips();
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
/* 把当前筛选/视图/列表视图状态按「账号 + 工作区」持久化到 localStorage，刷新后可恢复。
   不能只按空间存：同一浏览器切换账号后，上一个人的搜索词（常见是账号名）会被当前账号恢复出来。 */
var VIEW_STATE_KEY = "ds.viewState.v2";
function currentWsId(){ return rt.currentWs && rt.currentWs.id || ""; }
function currentUserId(){ return rt.currentUser && rt.currentUser.id || ""; }
function viewStateKey(){ return VIEW_STATE_KEY + ":" + currentUserId() + ":" + currentWsId(); }
function saveViewState(){
  var ws = currentWsId(), user = currentUserId();
  if(!ws || !user) return;
  try{
    var listSnap = null;
    try{
      var lp = currentListViewParams();
      listSnap = { current: currentListViewId(), preset: lp.preset, group: lp.group,
        subgroup: lp.subgroup || "none", hideDone: !!lp.hideDone, sort: lp.sort, sortDir: lp.sortDir };
    }catch(err){ /* 列表模块尚未就绪 */ }
    localStorage.setItem(viewStateKey(), JSON.stringify({
      userId: user,
      wsId: ws,
      filters: {
        /* 关键词不跨会话恢复：搜索是临时上下文，恢复旧词（常见是别人的账号名）会让人以为查询条件被自动写入 */
        owners: state.owners.slice(), pris: state.pris.slice(), cats: state.cats.slice(), reqs: state.reqs.slice(),
        tags: state.tags.slice(), types: state.types.slice(), versions: state.versions.slice(),
        columns: state.columns.slice(), completion: state.completion,
        due: state.due, focus: state.focus, blocked: state.blocked, doneScope: state.doneScope,
        noDue: state.noDue, dueFrom: state.dueFrom, dueTo: state.dueTo,
        startFrom: state.startFrom, startTo: state.startTo
      },
      list: listSnap
    }));
  }catch(e){ /* 隐私模式/受限环境忽略 */ }
}
function restoreViewState(){
  if(!rt.currentWs || !rt.currentUser) return false;
  /* v1 仅按空间存，可能混入其他账号的搜索词；升级后直接清掉，不再恢复 */
  try{ localStorage.removeItem("ds.viewState.v1"); }catch(e){ /* 受限环境忽略 */ }
  var snap;
  try{ snap = JSON.parse(localStorage.getItem(viewStateKey()) || "null"); }catch(e){ return false; }
  if(!snap || snap.userId !== rt.currentUser.id || snap.wsId !== rt.currentWs.id) return false;
  var changed = false;
  /* 旧快照里的 q 不再恢复；当前页面已经输入的关键词属于会话内筛选，不能被 settings 等
     再次调用 loadWorkspaces 时清掉。 */
  var f = snap.filters;
  if(f){
    ["owners","pris","cats","reqs","tags","types","versions","columns"].forEach(function(k){
      var arr = Array.isArray(f[k]) ? f[k].slice() : [];
      if(arr.length !== state[k].length || arr.some(function(v,i){ return v !== state[k][i]; })){ state[k] = arr; changed = true; }
    });
    var newCompletion = f.completion || "";
    if(newCompletion !== state.completion){ state.completion = newCompletion; changed = true; }
    var newDue = f.due || null;
    if(newDue !== state.due){ state.due = newDue; changed = true; }
    var newFocus = !!f.focus;
    if(newFocus !== state.focus){ state.focus = newFocus; changed = true; }
    var newBlocked = !!f.blocked;
    if(newBlocked !== state.blocked){ state.blocked = newBlocked; changed = true; }
    var newDoneScope = f.doneScope || "week";
    if(newDoneScope !== state.doneScope){ state.doneScope = newDoneScope; changed = true; }
    var newNoDue = !!f.noDue;
    if(newNoDue !== state.noDue){ state.noDue = newNoDue; changed = true; }
    ["dueFrom", "dueTo", "startFrom", "startTo"].forEach(function(k){
      var nv = typeof f[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f[k]) ? f[k] : null;
      if(nv !== state[k]){ state[k] = nv; changed = true; }
    });
  }
  if(snap.list && typeof applyListSavedView === "function"){
    var lp = currentListViewParams();
    if((snap.list.current || "all") !== currentListViewId() ||
       snap.list.preset !== lp.preset || snap.list.group !== lp.group ||
       (snap.list.subgroup || "none") !== (lp.subgroup || "none") ||
       !!snap.list.hideDone !== !!lp.hideDone ||
       snap.list.sort !== lp.sort || (snap.list.sortDir || "asc") !== (lp.sortDir || "asc")){
      applyListSavedView(snap.list.current || "all", {
        preset: snap.list.preset || "all",
        group: snap.list.group || "none",
        subgroup: snap.list.subgroup || "none",
        hideDone: !!snap.list.hideDone,
        sort: snap.list.sort || "default",
        sortDir: snap.list.sortDir || "asc"
      });
      changed = true;
    }
  }
  if(changed){
    if(searchInput){ searchInput.value = state.q; searchWrap.classList.toggle("has", !!state.q); }
    renderFilterChips();
    updateBrand();
  }else if(!state.q && searchInput && searchInput.value){
    /* 没有活动搜索时清掉浏览器/密码管理器自动填进输入框的残留值 */
    searchInput.value = "";
    searchWrap.classList.remove("has");
  }
  return changed;
}
var searchTimer = null;
/* 单字查询是最贵的一档（全列计数 + 字面 LIKE），拉丁单字符多半只是单词前缀：
   1 个字等 600ms，2 个字起维持 300ms；没有生效中的关键词时，拉丁单字符先不发请求。 */
var SINGLE_ASCII = /^[\x00-\x7F]$/;
/* 浏览器 / 密码管理器会把登录名自动填进文本输入框。输入框初始 readonly，
   首次交互时再解除，避免扩展在页面加载阶段直接写入；清理只针对“用户没输入过”的值。 */
var searchHumanTouched = false;
function lookalikeTokens(){
  var u = rt.currentUser;
  if(!u) return [];
  return [u.username, u.displayName, u.email, u.id].map(function(v){
    return String(v == null ? "" : v).trim().toLowerCase();
  }).filter(function(v){ return !!v; });
}
function looksLikeOwnAccount(value){
  var s = String(value == null ? "" : value).trim().toLowerCase();
  return !!s && lookalikeTokens().indexOf(s) !== -1;
}
function markHumanSearchInput(){ searchHumanTouched = true; }
["keydown", "paste", "beforeinput", "compositionstart"].forEach(function(type){
  searchInput.addEventListener(type, markHumanSearchInput);
});
function releaseSearchReadonly(){
  if(searchInput.readOnly) searchInput.readOnly = false;
}
["pointerdown", "touchstart", "focus", "keydown"].forEach(function(type){
  searchInput.addEventListener(type, releaseSearchReadonly, {passive:true});
});
function clearAutoFilledSearch(){
  /* 用户真正键鼠/输入法输入过就不再自动清理，避免把用户主动搜索的词删掉 */
  if(searchHumanTouched || !searchInput) return;
  var v = searchInput.value;
  if(!v) return;
  /* 只清“没有搜索状态”或“搜索状态就是这次自动填充值”的情况，别抹掉用户刚应用的视图 */
  if(state.q && state.q !== v.trim()) return;
  searchInput.value = "";
  searchWrap.classList.remove("has");
  /* 自动填充可能已经触发过一次查询，这里一并复位，避免框空了但结果仍按旧词过滤 */
  if(state.q) applySearch("");
}
window.addEventListener("ds:user-ready", clearAutoFilledSearch);
window.addEventListener("pageshow", clearAutoFilledSearch);
window.addEventListener("focus", clearAutoFilledSearch);
document.addEventListener("visibilitychange", function(){
  if(!document.hidden) clearAutoFilledSearch();
});
searchInput.addEventListener("focus", clearAutoFilledSearch);
/* Chrome/Edge 自动填充会触发 :-webkit-autofill 上的动画；这是不读取密码也能
   感知“浏览器自己填了值”的可靠信号。 */
searchInput.addEventListener("animationstart", function(e){
  if(e.animationName === "ds-autofill-start") clearAutoFilledSearch();
});
/* 密码管理器可能在 load 之后一段时间才回填：前 10 秒定期兜底 */
var autofillWatch = setInterval(clearAutoFilledSearch, 1000);
setTimeout(function(){ clearInterval(autofillWatch); }, 10000);
searchInput.addEventListener("input", function(){
  releaseSearchReadonly();
  if(!searchInput.value.trim()) searchHumanTouched = false;
  if(!searchHumanTouched && looksLikeOwnAccount(searchInput.value)){
    searchInput.value = "";
    searchWrap.classList.remove("has");
    /* 若之前已有搜索词，自动填充不应只是视觉清空而让旧查询继续生效 */
    if(state.q) applySearch("");
    return;
  }
  var kw = searchInput.value.trim();
  searchWrap.classList.toggle("has", kw.length > 0);
  if(searchTimer){ clearTimeout(searchTimer); searchTimer = null; }
  if(!kw){
    /* 清空且原本就没有生效条件：不必再拉一次全量数据 */
    if(state.q) applySearch("");
    return;
  }
  if(kw.length === 1 && SINGLE_ASCII.test(kw) && !state.q) return;
  searchTimer = setTimeout(function(){
    searchTimer = null;
    applySearch(kw);
  }, kw.length === 1 ? 600 : 300);
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
  /* 截止期预设与自定义区间是同一维度的两种表达，不能叠加 */
  if(state.due){ state.dueFrom = null; state.dueTo = null; state.noDue = false; }
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
  state.tags = []; state.types = []; state.versions = []; state.columns = []; state.completion = "";
  state.due = null; state.focus = false; state.blocked = false;
  state.noDue = false; state.dueFrom = null; state.dueTo = null;
  state.startFrom = null; state.startTo = null;
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
function handleFilterClick(e){
  var dimBtn = e.target.closest("[data-dim-open]");
  if(dimBtn){ openDimMenu(dimBtn.dataset.dimOpen, dimBtn); return; }
  var clear = e.target.closest("[data-clear-dim]");
  if(clear){
    var key = clear.dataset.clearDim;
    if(Array.isArray(state[key])) state[key] = [];
    reloadFilteredViews();
    return;
  }
  var dimClear = e.target.closest("[data-dim-clear]");
  if(dimClear){
    state[dimClear.dataset.dimClear] = [];
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-clear-dates]")){
    state.noDue = false; state.dueFrom = null; state.dueTo = null;
    state.startFrom = null; state.startTo = null;
    reloadFilteredViews();
    return;
  }
  var preset = e.target.closest("[data-date-preset]");
  if(preset){
    applyDatePreset(preset.dataset.datePreset);
    return;
  }
  var o = e.target.closest("[data-owner]");
  if(o){ toggleFilterValue("owners", o.dataset.owner); return; }
  var p = e.target.closest("[data-pri]");
  if(p){ toggleFilterValue("pris", p.dataset.pri); return; }
  var ty = e.target.closest("[data-type]");
  if(ty){ toggleFilterValue("types", ty.dataset.type); return; }
  var v = e.target.closest("[data-version]");
  if(v){ toggleFilterValue("versions", v.dataset.version); return; }
  var col = e.target.closest("[data-column]");
  if(col){ toggleFilterValue("columns", col.dataset.column); return; }
  var comp = e.target.closest("[data-completion]");
  if(comp){
    state.completion = comp.dataset.completion || "";
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-clear-completion]")){
    state.completion = "";
    reloadFilteredViews();
    return;
  }
  var c = e.target.closest("[data-cat]");
  if(c){ toggleFilterValue("cats", c.dataset.cat); return; }
  var r = e.target.closest("[data-req]");
  if(r){ toggleFilterValue("reqs", r.dataset.req); return; }
  var t = e.target.closest("[data-tag]");
  if(t){ toggleFilterValue("tags", t.dataset.tag); return; }
  if(e.target.closest("[data-mf-reset]")){
    state.owners = []; state.pris = []; state.types = []; state.versions = []; state.columns = [];
    state.cats = []; state.tags = []; state.reqs = []; state.blocked = false; state.completion = "";
    state.noDue = false; state.dueFrom = null; state.dueTo = null;
    state.startFrom = null; state.startTo = null;
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
}
/* 截止日期预设与区间、无截止日期三者互斥：后选的覆盖先选的，避免叠加出空结果 */
function applyDatePreset(preset){
  if(preset === "none"){
    state.noDue = !state.noDue;
    if(state.noDue){ state.dueFrom = null; state.dueTo = null; state.due = null; }
  }else{
    var range = dateRangeOf(preset);
    if(!range) return;
    if(state.dueFrom === range[0] && state.dueTo === range[1]){
      state.dueFrom = null; state.dueTo = null;
    }else{
      state.dueFrom = range[0]; state.dueTo = range[1];
      state.noDue = false; state.due = null;
    }
  }
  reloadFilteredViews();
}
$("filterbar").addEventListener("click", handleFilterClick);
/* 打开后菜单会被挂到 body 下，点击不再冒泡到筛选栏，需要单独监听 */
moreFilterMenu.addEventListener("click", handleFilterClick);
moreFilterMenu.addEventListener("input", function(e){
  if(e.target.closest("[data-mf-version-q]")) applyVersionFilter();
});
moreFilterMenu.addEventListener("change", function(e){
  var inp = e.target.closest("[data-date]");
  if(!inp) return;
  var key = inp.dataset.date;
  state[key] = inp.value || null;
  if(key.indexOf("due") === 0){
    if(state[key]){ state.noDue = false; }
    state.due = null;
  }
  reloadFilteredViews();
});
dimMenu.addEventListener("click", handleFilterClick);
dimMenu.addEventListener("input", function(e){
  if(e.target.closest("[data-dim-q]")) applyDimSearch();
});
$("btnMoreFilter").addEventListener("click", function(){
  if(UI.popOpen(moreFilterMenu)){ UI.closeAllPops(); return; }
  UI.openPop(moreFilterMenu, $("btnMoreFilter"), {align:"left", width:344});
});
function loadViews(){
  return API.get("/api/views").then(function(list){
    rt.savedViews = list || [];
    renderViews();
  }).catch(function(){});
}
function parseViewParams(p){
  if(!p || typeof p !== "object" || Array.isArray(p)) return null;
  if(p.scope === "demand") return null;
  function strArr(v){
    if(v === undefined || v === null) return [];
    if(!Array.isArray(v)) return null;
    for(var i = 0; i < v.length; i++) if(typeof v[i] !== "string") return null;
    return v.slice();
  }
  var owners = strArr(p.owners), pris = strArr(p.pris), cats = strArr(p.cats),
      reqs = strArr(p.reqs), tags = strArr(p.tags), types = strArr(p.types), versions = strArr(p.versions),
      columns = strArr(p.columns);
  if(!owners || !pris || !cats || !reqs || !tags || !types || !versions || !columns) return null;
  if(p.q !== undefined && p.q !== null && typeof p.q !== "string") return null;
  if(p.focus !== undefined && p.focus !== null && typeof p.focus !== "boolean") return null;
  if(p.blocked !== undefined && p.blocked !== null && typeof p.blocked !== "boolean") return null;
  if(p.noDue !== undefined && p.noDue !== null && typeof p.noDue !== "boolean") return null;
  function dateStr(v){
    if(v === undefined || v === null || v === "") return "";
    if(typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return v;
  }
  var dueFrom = dateStr(p.dueFrom), dueTo = dateStr(p.dueTo),
      startFrom = dateStr(p.startFrom), startTo = dateStr(p.startTo);
  if(dueFrom === null || dueTo === null || startFrom === null || startTo === null) return null;
  var preset = (p.preset === undefined || p.preset === null) ? "all" : p.preset;
  var group = (p.group === undefined || p.group === null) ? "none" : p.group;
  var subgroup = (p.subgroup === undefined || p.subgroup === null) ? "none" : p.subgroup;
  var sort = (p.sort === undefined || p.sort === null) ? "default" : p.sort;
  if(["all", "mine", "doing", "over"].indexOf(preset) === -1) return null;
  if(["none", "status", "owner", "priority", "project", "category", "version"].indexOf(group) === -1) return null;
  if(["none", "status", "owner", "priority", "project", "category", "version"].indexOf(subgroup) === -1) return null;
  if(p.hideDone !== undefined && p.hideDone !== null && typeof p.hideDone !== "boolean") return null;
  if(["default", "due", "priority", "estimate", "actual", "updated",
      "title", "type", "column", "owner", "progress", "project", "version",
      "category", "startDate", "tags", "subtasks", "comments"].indexOf(sort) === -1) return null;
  return {
    q: p.q || "",
    owners: owners, pris: pris, cats: cats, reqs: reqs, tags: tags, types: types, versions: versions,
    columns: columns,
    completion: p.completion === "open" || p.completion === "done" ? p.completion : "",
    due: (p.due === "over" || p.due === "today" || p.due === "soon") ? p.due : null,
    noDue: p.noDue === true,
    dueFrom: dueFrom, dueTo: dueTo, startFrom: startFrom, startTo: startTo,
    focus: p.focus === true,
    blocked: p.blocked === true,
    doneScope: p.doneScope === "all" ? "all" : "week",
    preset: preset,
    group: group,
    subgroup: subgroup,
    hideDone: p.hideDone === true,
    sort: sort,
    sortDir: p.sortDir === "desc" ? "desc" : "asc",
    listConfig: p.preset !== undefined || p.group !== undefined || p.subgroup !== undefined ||
      p.hideDone !== undefined || p.sort !== undefined
  };
}
/* 甘特布局可能从看板/列表的通用视图条应用，此时甘特模块还没加载：
   先把模块拉起来恢复布局，避免用户切到甘特后看到的是旧布局 */
function hasGanttLayout(p){
  return ["ganttGroup", "ganttGroup2", "ganttSort", "ganttCols", "ganttShowDone",
    "ganttDensity", "ganttScale", "ganttZoom", "ganttRange"].some(function(k){
    return p[k] !== undefined && p[k] !== null;
  });
}
/* 应用视图时剔除字典中已不存在的模块：模块删除不会回刷已保存视图，旧 ID 会筛出空结果。
   模块缓存尚未加载（空）时无法校验，保持原样，避免把有效筛选误删。 */
function pruneUnknownCats(cats){
  var cache = rt.categoriesCache || [];
  if(!cache.length || !cats.length) return cats;
  var known = {};
  cache.forEach(function(c){ known[c.id] = 1; });
  return cats.filter(function(n){ return n === "__none" || known[n]; });
}
function applyView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  var f = parseViewParams(p);
  if(!f){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  state.q = f.q; state.owners = f.owners; state.pris = f.pris; state.cats = pruneUnknownCats(f.cats);
  state.reqs = f.reqs; state.tags = f.tags; state.types = f.types; state.versions = f.versions;
  state.columns = f.columns; state.completion = f.completion;
  state.due = f.due; state.focus = f.focus;
  state.noDue = f.noDue;
  state.dueFrom = f.dueFrom || null; state.dueTo = f.dueTo || null;
  state.startFrom = f.startFrom || null; state.startTo = f.startTo || null;
  state.blocked = f.blocked;
  state.doneScope = f.doneScope;
  markHumanSearchInput();
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  /* 视图 = 筛选 + 可选的布局：甘特布局由视图自己恢复，列表布局只作用于列表 */
  var provider = viewParamProvider(activeView);
  if(provider && provider.apply) provider.apply(p, v);
  else if(hasGanttLayout(p)) loadView("gantt").then(function(m){ m.applyGanttViewParams(p); });
  if(f.listConfig) applyListSavedView(v.id, f);
  reloadFilteredViews();
  toast("已应用视图「" + v.name + "」", "fs");
}
function deleteView(id){
  UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响任务数据。", okText:"删除视图" }).then(function(ok){
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
  var provider = viewParamProvider(activeView);
  /* 甘特图等带布局参数的视图：没有筛选也可以保存（布局本身就是视图内容） */
  if(!forList && !provider && !filterOn()){ toast("当前没有筛选条件，先设置筛选再保存", "warn"); return; }
  $("dlgViewInput").value = forList ? currentListViewName() : "";
  $("fDlgViewName").classList.remove("invalid");
  var desc = $("dlgViewName").querySelector(".desc");
  if(desc) desc.textContent = forList
    ? "保存当前筛选、分组与排序；同名保存将覆盖原视图"
    : (provider && provider.describe
        ? provider.describe()
        : "保存当前筛选与列表视图设置（看板 / 列表共用）；同名保存将覆盖原视图");
  UI.openModal($("dlgViewName"));
}
$("btnSaveView").addEventListener("click", promptSaveView);
$("dlgViewNameForm").addEventListener("submit", function(e){
  e.preventDefault();
  if($("dlgViewNameOk").disabled) return;
  var name = $("dlgViewInput").value.trim();
  if(!name){ $("fDlgViewName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  var forList = activeView === "list";
  var params = currentFilterParams();
  var provider = viewParamProvider(activeView);
  if(provider && provider.capture){
    var extra = provider.capture();
    for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k];
  }
  /* 甘特视图只表达甘特布局：不写列表布局，避免应用时顺带改掉列表设置 */
  if(!(provider && provider.skipListConfig)){
    var listParams = currentListViewParams();
    params.preset = listParams.preset;
    params.group = listParams.group;
    params.subgroup = listParams.subgroup;
    params.hideDone = listParams.hideDone;
    params.sort = listParams.sort;
    params.sortDir = listParams.sortDir;
  }
  var overwrite = savedViewsFor("task").some(function(v){ return v.name === name; });
  var submitBtn = $("dlgViewNameOk");
  submitBtn.disabled = true;
  API.post("/api/views", { name: name, params: JSON.stringify(params) }).then(function(saved){
    submitBtn.disabled = false;
    UI.closeModal($("dlgViewName"));
    /* 甘特视图不写列表布局，也不要把列表的当前视图改到它上面 */
    if(saved && !(provider && provider.skipListConfig)) markListViewSaved(saved.id);
    toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
    loadViews().then(function(){
      if(activeView === "gantt") loadView("gantt").then(function(m){ m.renderGanttViewsMenu(); });
    });
  }).catch(function(ex){ submitBtn.disabled = false; toast(ex.message || "保存失败", "bad"); });
});

/* ==================== 手机：筛选摘要 + 底部面板 ==================== */
/* 桌面结构保持原样；手机首屏只显示一行摘要，筛选栏与列表视图设置临时搬进面板。 */
var mobFilterBar = $("mobFilter"), mobFilterBtn = $("btnMobFilter"), mobFilterText = $("mobFilterText");
var mobSheet = $("mobFilterSheet"), mobSheetBody = mobSheet && mobSheet.querySelector(".mob-sheet-body");
var mobSheetPanel = mobSheet && mobSheet.querySelector(".mob-sheet");
var mobSheetFilterSlot = $("mobSheetFilterSlot"), mobSheetSearchSlot = $("mobSheetSearchSlot");
var mobSheetToolsSlot = $("mobSheetToolsSlot"), mobSheetToolsBlock = $("mobSheetToolsBlock");
var MOB_FILTER_VIEWS = { board:1, list:1, mine:1, calendar:1 };
var sheetOpen = false, sheetFocus = null, sheetCloseTimer = null;
var filterHome = null, searchHome = null, toolsHome = null;

function mobFilterLabel(){
  if(activeView === "list"){
    var tab = document.querySelector("#view-list .smart-view-tab.on");
    if(tab && tab.textContent.trim()) return tab.textContent.trim();
  }
  var title = $("viewTitle");
  return (title && title.textContent.trim()) || "工作项";
}
function dueFilterLabel(v){
  return v === "today" ? "今天到期" : v === "soon" ? "3 天内" : v === "over" ? "已逾期" : "到期";
}
function mobFilterAvailable(){
  return !!MOB_FILTER_VIEWS[activeView] &&
    !(activeView === "mine" && document.body.classList.contains("mine-team"));
}
function updateMobFilterSummary(){
  if(!mobFilterBar || !mobFilterBtn) return;
  var show = mobFilterAvailable();
  mobFilterBar.hidden = !show;
  if(!show) return;
  var bits = [];
  if(state.q) bits.push("搜索「" + state.q + "」");
  if(state.focus) bits.push("今日聚焦");
  if(state.due) bits.push(dueFilterLabel(state.due));
  if(state.noDue) bits.push("无截止日期");
  var dueRange = dateRangeText(state.dueFrom, state.dueTo);
  if(dueRange) bits.push("截止 " + dueRange);
  var startRange = dateRangeText(state.startFrom, state.startTo);
  if(startRange) bits.push("开始 " + startRange);
  if(state.blocked) bits.push("仅看阻塞");
  var n = selectedFilterCount() - (state.q ? 1 : 0) - (state.focus ? 1 : 0)
    - (state.due ? 1 : 0) - (state.blocked ? 1 : 0) - (state.noDue ? 1 : 0)
    - ((state.dueFrom || state.dueTo) ? 1 : 0) - ((state.startFrom || state.startTo) ? 1 : 0);
  if(n > 0) bits.push(n + " 项筛选");
  var text = bits.length ? (mobFilterLabel() + " · " + bits.join(" · ")) : (mobFilterLabel() + " · 全部");
  mobFilterText.textContent = text;
  mobFilterBtn.classList.toggle("has", selectedFilterCount() > 0);
  mobFilterBtn.setAttribute("aria-label", "筛选与视图：" + text);
}
function restoreNode(el, home){
  if(!el || !home || !home.parent) return;
  var before = home.next && home.next.parentNode === home.parent ? home.next : null;
  home.parent.insertBefore(el, before);
}
function openMobFilterSheet(opts){
  opts = opts || {};
  /* 设置、文档、分支等页面没有任务筛选：/ 快捷键和事件不能把无关的筛选栏搬到面板里 */
  if(!isMobile() || !mobSheet || !mobFilterAvailable()) return;
  if(sheetOpen){
    if(opts.section === "tools" && mobSheetBody && mobSheetToolsBlock){
      mobSheetBody.scrollTop = Math.max(mobSheetToolsBlock.offsetTop - 12, 0);
    }
    return;
  }
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = null;
  sheetFocus = (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)
    ? document.activeElement
    : mobFilterBtn;
  var bar = $("filterbar"), search = $("searchWrap");
  if(bar && mobSheetFilterSlot){
    if(!filterHome) filterHome = { parent: bar.parentNode, next: bar.nextSibling };
    mobSheetFilterSlot.appendChild(bar);
  }
  if(search && mobSheetSearchSlot && search.parentNode !== mobSheetSearchSlot){
    if(!searchHome) searchHome = { parent: search.parentNode, next: search.nextSibling };
    mobSheetSearchSlot.appendChild(search);
  }
  var tools = activeView === "list" ? document.querySelector("#view-list .smart-view-tools") : null;
  if(tools && mobSheetToolsSlot){
    if(tools.parentNode !== mobSheetToolsSlot){
      toolsHome = { parent: tools.parentNode, next: tools.nextSibling };
      mobSheetToolsSlot.appendChild(tools);
    }
    mobSheetToolsBlock.hidden = false;
  }else if(mobSheetToolsBlock){
    mobSheetToolsBlock.hidden = true;
  }
  mobSheet.hidden = false;
  document.body.classList.add("mob-sheet-open");
  mobFilterBtn.setAttribute("aria-expanded", "true");
  /* 强制一次布局再上 open 类：不依赖 rAF，后台标签页/节流时也能确定地展开 */
  void mobSheet.offsetWidth;
  mobSheet.classList.add("open");
  sheetOpen = true;
  /* 面板是 aria-modal 对话框：焦点先落到面板本身（读屏会念标题），Tab 再进入首个控件 */
  if(opts.focus !== "search" && mobSheetPanel){
    try{ mobSheetPanel.focus({ preventScroll: true }); }catch(e){ /* noop */ }
  }
  setTimeout(function(){
    if(!sheetOpen) return;
    if(opts.focus === "search" && searchInput){
      searchInput.focus();
      if(searchInput.select) searchInput.select();
      return;
    }
    if(opts.section === "tools" && mobSheetToolsBlock && mobSheetBody){
      mobSheetBody.scrollTop = Math.max(mobSheetToolsBlock.offsetTop - 12, 0);
    }
  }, 80);
}
function closeMobFilterSheet(immediate){
  if(!sheetOpen) return;
  sheetOpen = false;
  mobSheet.classList.remove("open");
  mobFilterBtn.setAttribute("aria-expanded", "false");
  document.body.classList.remove("mob-sheet-open");
  UI.closeAllPops();
  restoreNode($("filterbar"), filterHome);
  restoreNode($("searchWrap"), searchHome);
  var tools = mobSheetToolsSlot && mobSheetToolsSlot.firstElementChild;
  if(tools) restoreNode(tools, toolsHome);
  if(mobSheetToolsBlock) mobSheetToolsBlock.hidden = true;
  /* 关闭是"立即完成"的交互：焦点当场还给触发按钮。
     如果拖到 200ms 动画结束再还，这段窗口里 Tab 会落进正在淡出的面板，
     而且用户若已继续操作，延迟的 focus 还会把焦点抢回来。 */
  if(sheetFocus && document.contains(sheetFocus)){
    try{ sheetFocus.focus({ preventScroll: true }); }catch(e){ /* noop */ }
  }
  function finish(){ mobSheet.hidden = true; }
  if(immediate || !isMobile()){ finish(); return; }
  sheetCloseTimer = setTimeout(finish, 200);
}
mobFilterBtn && mobFilterBtn.addEventListener("click", function(){ openMobFilterSheet(); });
mobSheet && mobSheet.addEventListener("click", function(e){
  if(e.target.closest("[data-mob-sheet-close]")) closeMobFilterSheet();
});
document.addEventListener("keydown", function(e){
  if(e.key !== "Escape" || !sheetOpen) return;
  if(UI.anyModalOpen && UI.anyModalOpen()) return;
  if(openSheetPopovers().length) return;   // 先让浮层自己关，再按一次才关面板
  closeMobFilterSheet();
}, true);
function openSheetPopovers(){
  return Array.prototype.filter.call(document.querySelectorAll(".popover"), function(el){
    return !!el.__popOpen;
  });
}
function sheetFocusRoots(){
  if(!mobSheetPanel) return [];
  var roots = [mobSheetPanel];
  /* 「更多筛选」等浮层会被 UI.openPop 挂到 body：面板打开时也要纳入焦点循环 */
  openSheetPopovers().forEach(function(el){ roots.push(el); });
  return roots;
}
function sheetFocusables(){
  var all = [];
  sheetFocusRoots().forEach(function(root){
    var nodes = root.querySelectorAll("a[href],button,input,select,textarea,[tabindex]");
    Array.prototype.forEach.call(nodes, function(el){
      if(el.disabled || el.hidden || el.getAttribute("tabindex") === "-1") return;
      var cs = getComputedStyle(el);
      if(cs.visibility === "hidden" || cs.display === "none" || !el.getClientRects().length) return;
      all.push(el);
    });
  });
  return all;
}
document.addEventListener("keydown", function(e){
  if(e.key !== "Tab" || !sheetOpen || !mobSheetPanel) return;
  if(UI.anyModalOpen && UI.anyModalOpen()) return;   // 面板上再叠确认框时交给上层
  var list = sheetFocusables();
  if(!list.length) return;
  /* 浮层挂在 body 上，DOM 顺序与面板并不相接：只处理首尾会在两者之间漏到页面导航上 */
  var idx = list.indexOf(document.activeElement);
  e.preventDefault();
  var next = idx === -1
    ? (e.shiftKey ? list.length - 1 : 0)
    : (idx + (e.shiftKey ? -1 : 1) + list.length) % list.length;
  list[next].focus();
}, true);
window.addEventListener("ds:view-change", function(){
  /* 视图切换后按新页面的口径重算「视图」入口与操作区：我的工作不保留工作项列表的视图 */
  renderViews();
  /* 平铺维度的可见性随视图变化（我的工作不展示负责人），切换后立即重排 */
  syncDimButtons();
  /* 面板是按当前视图拼装的（列表的视图设置块会搬进去）：换页就收起，避免旧控制条留在新页面 */
  if(sheetOpen) closeMobFilterSheet();
});
window.addEventListener("ds:layout", function(){
  updateMobFilterSummary();
  if(!isMobile()) closeMobFilterSheet(true);
});
window.addEventListener("ds:view-search", function(){
  openMobFilterSheet({ focus: "search" });
});
updateMobFilterSummary();

export { applyView, clearFilters, deleteView, loadViews, markHumanSearchInput, openMobFilterSheet, pruneUnknownCats, promptSaveView, reloadFilteredViews, renderFilterChips, restoreViewState, saveViewState, savedViewsFor, toggleIn, updateMobFilterSummary };
