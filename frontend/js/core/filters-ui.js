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
import { loadView, viewModule } from "./view-loader.js";
import { applyListSavedView, currentListViewId, currentListViewName, currentListViewParams, listViewDeleted, markListViewSaved, refreshListIfOpen, renderSmartTabs } from "../views/list.js";
import { loadMine } from "../views/mine.js";
import { viewParamProvider } from "./view-params.js";

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
  if(noneCount > 0 || noneOn) items.push({id:"__none", name:"未指派", count:noneCount, on:noneOn});
  return items;
}
/* 测试负责人：取值来自后端 meta.testOwners（显示名快照），「待领取」对应空值 */
function testOwnerItems(meta){
  var items = [];
  (meta.testOwners || []).forEach(function(o){
    var on = state.testOwners.indexOf(o.name) !== -1;
    if(o.count === 0 && !on) return;
    items.push({name:o.name, count:o.count, on:on});
  });
  var noneOn = state.testOwners.indexOf("__none") !== -1;
  var noneCount = meta.testOwnerUnassigned || 0;
  if(noneCount > 0 || noneOn) items.push({id:"__none", name:"待领取", count:noneCount, on:noneOn});
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
  if(kind === "owner") return value === "__none" ? "未指派" : value;
  if(kind === "tag") return value;
  for(var i = 0; i < items.length; i++) if(itemVal(items[i]) === value) return items[i].name;
  return value;
}
/* 已选条件拆成「改 / 清」两个热区：点正文回到对应维度继续改，点 × 才清空。
   单值显示真实值；两个短值并列；更多或过长时退回「N 项」，避免 chip 撑满整行。 */
function activeDimHTML(kind, selected, items){
  if(!selected.length) return "";
  var labels = selected.map(function(v){ return dimValueLabel(kind, v, items); });
  var joined = labels.join("、");
  var text = labels.length === 1 || joined.length <= 18
    ? dimTitle(kind) + "：" + joined
    : dimTitle(kind) + " " + selected.length + " 项";
  var key = kind + "s";
  return '<span class="chip chip-split" aria-pressed="true">' +
    '<button class="chip-main" type="button" data-edit-dim="' + key + '" title="修改' + dimTitle(kind) + '筛选">' +
    esc(text) + '</button>' +
    '<button class="chip-x" type="button" data-clear-dim="' + key + '" title="清除' + dimTitle(kind) + '筛选" aria-label="清除' +
    dimTitle(kind) + '筛选">' + icon("close", 12) + '</button></span>';
}
function renderOwnerChips(){
  chipsOwner.innerHTML = "";
  $("fgOwner").hidden = true;
}
function renderPriChips(){
  chipsPri.innerHTML = "";
  $("fgPri").hidden = true;
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
  box.innerHTML = "";
  $("fgColumns").hidden = true;
}
function renderCompletionChip(){
  var box = $("chipsCompletion");
  if(!box) return;
  if(!state.completion){ box.innerHTML = ""; $("fgCompletion").hidden = true; return; }
  box.innerHTML = '<span class="chip chip-split" aria-pressed="true">' +
    '<button class="chip-main" type="button" data-edit-dim="completion" title="修改完成情况筛选">完成情况：' +
    esc(completionLabel(state.completion)) + '</button>' +
    '<button class="chip-x" type="button" data-clear-dim="completion" title="清除完成情况筛选" aria-label="清除完成情况筛选">' +
    icon("close", 12) + '</button></span>';
  $("fgCompletion").hidden = false;
}
function renderReqsChip(){
  chipsReqs.innerHTML = "";
  $("fgReqs").hidden = true;
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
  /* 只有开始日期生效时，点正文直接回到「开始日期」，不要跳到截止日期 */
  var editKey = (!state.noDue && !state.dueFrom && !state.dueTo && (state.startFrom || state.startTo)) ? "start" : "due";
  box.innerHTML = '<span class="chip chip-split" aria-pressed="true">' +
    '<button class="chip-main" type="button" data-edit-dim="' + editKey + '" title="修改日期筛选">' + esc(bits.join(" · ")) + '</button>' +
    '<button class="chip-x" type="button" data-clear-dates title="清除日期筛选" aria-label="清除日期筛选">' +
    icon("close", 12) + '</button></span>';
  $("fgDate").hidden = false;
}

/* ==================== 平铺维度下拉（项目 / 状态 / 负责人 / 优先级） ==================== */
/* 四个高频维度直接摆在筛选栏上，点开是可多选、带计数与搜索的下拉；
   其余维度留在「更多筛选」，避免一次性把十几个维度堆在只有 48px 高的栏里。 */
var DIM_ORDER = { reqs:"项目", columns:"状态", owners:"负责人", testOwners:"测试负责人", pris:"优先级" };
/* HTML 属性名大小写不敏感，dataset 只认全小写：测试负责人不能按 kind 直接截断 */
function dimDataKey(kind){ return kind === "testOwners" ? "testowner" : kind.slice(0, -1); }
var dimQ = "";
function dimItemsOf(kind, meta){
  if(kind === "reqs") return reqItems(meta);
  if(kind === "cats") return catItems(meta);
  if(kind === "tags") return tagItems(meta);
  if(kind === "owners") return ownerItems(meta);
  if(kind === "testOwners") return testOwnerItems(meta);
  if(kind === "pris") return priItems(meta);
  if(kind === "types") return typeItems(meta);
  if(kind === "versions") return versionItems(meta);
  if(kind === "columns") return columnItems(meta);
  return [];
}
function dimSelected(kind){ return state[kind] || []; }
function dimSelectedText(kind){
  var vals = dimSelected(kind);
  if(!vals.length) return "";
  var meta = state.board && state.board.meta;
  if(!meta) return "";
  var items = dimItemsOf(kind, meta);
  if(kind === "columns") return vals.map(function(v){ return colName(v); }).join("、");
  var singular = kind === "pris" ? "pri" : kind.slice(0, -1);
  return vals.map(function(v){ return dimValueLabel(singular, v, items); }).join("、");
}
function syncDueButton(){
  var btn = $("btnDueFilter");
  if(!btn) return;
  var labelEl = btn.querySelector(".fb-dim-label");
  var text = "到期";
  if(state.due === "over") text = "到期：已逾期";
  else if(state.due === "today") text = "到期：今天";
  else if(state.due === "soon") text = "到期：3 天内";
  if(state.focus) text = state.due ? text + " · 聚焦" : "聚焦：今日";
  if(labelEl) labelEl.textContent = text;
  var on = !!(state.due || state.focus);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.title = on ? "截止期筛选：" + text + "（点击修改）" : "按截止期筛选：已逾期 / 今天到期 / 3 天内 / 今日聚焦";
  [["chipOver", "over"], ["chipToday", "today"], ["chipSoon", "soon"], ["chipFocus", "focus"]].forEach(function(it){
    var item = $(it[0]);
    if(!item) return;
    var pressed = it[1] === "focus" ? !!state.focus : state.due === it[1];
    item.setAttribute("aria-pressed", pressed ? "true" : "false");
    var ck = item.querySelector(".ck");
    if(ck) ck.textContent = pressed ? "✓" : "";
  });
}
function syncDimButtons(){
  if(!dimGroup) return;
  syncDueButton();
  dimGroup.querySelectorAll("[data-dim-open]").forEach(function(btn){
    var kind = btn.dataset.dimOpen;
    /* 我的工作天然只含本人任务，负责人维度没有意义，不摆出来制造「点了没反应」 */
    btn.hidden = activeView === "mine" && kind === "owners";
    var n = dimSelected(kind).length;
    var values = dimSelectedText(kind);
    var labelEl = btn.querySelector(".fb-dim-label");
    if(!labelEl){
      btn.textContent = "";
      labelEl = document.createElement("span");
      labelEl.className = "fb-dim-label";
      btn.appendChild(labelEl);
    }
    /* 单选直接把值回显在按钮上；多选留给角标显示数量，避免按钮被长名单撑开 */
    labelEl.textContent = DIM_ORDER[kind] + (n === 1 && values ? "：" + (values.length > 10 ? values.slice(0, 10) + "…" : values) : "");
    btn.setAttribute("aria-pressed", n > 0 ? "true" : "false");
    if(n > 0){
      btn.title = "已按" + DIM_ORDER[kind] + "筛选：" + values + "（点击修改）";
      btn.setAttribute("aria-label", DIM_ORDER[kind] + "：" + values + "，点击修改筛选");
    }else{
      btn.title = "按" + DIM_ORDER[kind] + "筛选（可多选）";
      btn.setAttribute("aria-label", "按" + DIM_ORDER[kind] + "筛选");
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
    return '<button class="menu-item dim-opt" type="button" data-' + dimDataKey(kind) + '="' + esc(val) +
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
    var on = selected.indexOf(btn.dataset[dimDataKey(kind)]) !== -1;
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
/* ==================== 更多筛选：左维度 / 右取值的两级面板 ==================== */
/* 剩余 8 个维度不再纵向平铺：左栏一屏列出，右栏只渲染当前维度的取值。
   顶部搜索同时匹配维度名与取值；选中即生效，不引入「应用」按钮。 */
var MF_DIMS = [
  { key:"cats", title:"模块", icon:"folder" },
  { key:"tags", title:"标签", icon:"tag" },
  { key:"types", title:"类型", icon:"checklist" },
  { key:"versions", title:"版本", icon:"branch" },
  { key:"due", title:"截止日期", icon:"calendar" },
  { key:"start", title:"开始日期", icon:"calendar" },
  { key:"completion", title:"完成情况", icon:"checkCircle" },
  { key:"blocked", title:"其他", icon:"filterOff" }
];
var mfDim = "cats", mfQ = "", mfValQ = "", mfMeta = null;
function mfDef(key){
  for(var i = 0; i < MF_DIMS.length; i++) if(MF_DIMS[i].key === key) return MF_DIMS[i];
  return null;
}
function mfSelectedCount(key){
  if(key === "due") return (state.noDue ? 1 : 0) + ((state.dueFrom || state.dueTo) ? 1 : 0);
  if(key === "start") return (state.startFrom || state.startTo) ? 1 : 0;
  if(key === "completion") return state.completion ? 1 : 0;
  if(key === "blocked") return state.blocked ? 1 : 0;
  return (state[key] || []).length;
}
function mfItems(key){
  if(!mfMeta) return [];
  if(key === "cats") return catItems(mfMeta).map(function(o){
    return { val:itemVal(o), label:o.name, count:o.count, on:o.on };
  });
  if(key === "tags") return tagItems(mfMeta).map(function(o){
    return { val:itemVal(o), label:o.name, count:o.count, on:o.on };
  });
  if(key === "types") return typeItems(mfMeta).map(function(o){
    return { val:itemVal(o), label:typeName(o.name), count:o.count, on:o.on };
  });
  if(key === "versions") return versionItems(mfMeta).map(function(o){
    return { val:itemVal(o), label:o.name, count:o.count, on:o.on, active:o.active };
  });
  return [];
}
function mfHit(o, q){
  if(!q) return true;
  var label = String(o.label == null ? "" : o.label).toLowerCase();
  var val = String(o.val == null ? "" : o.val).toLowerCase();
  return label.indexOf(q) !== -1 || val.indexOf(q) !== -1;
}
function mfDimHasQuery(key, q){
  var def = mfDef(key);
  if(!def) return false;
  if(def.title.toLowerCase().indexOf(q) !== -1) return true;
  if(key === "due") return "截止无截止".indexOf(q) !== -1;
  if(key === "start") return "开始".indexOf(q) !== -1;
  if(key === "completion") return "全部未完成已完成".indexOf(q) !== -1;
  if(key === "blocked") return "阻塞其他".indexOf(q) !== -1;
  var items = mfItems(key);
  for(var i = 0; i < items.length; i++) if(mfHit(items[i], q)) return true;
  return false;
}
function mfDateHTML(key){
  if(key === "due"){
    var presetInner = DATE_PRESETS.map(function(p){
      return '<button class="chip" type="button" data-date-preset="' + p[0] + '" aria-pressed="' + datePresetOn(p[0]) + '">' +
        p[1] + '</button>';
    }).join('') + '<button class="chip ghost" type="button" data-date-preset="none" aria-pressed="' + (state.noDue ? "true" : "false") + '">无截止日期</button>';
    return '<div class="dim-dates"><div class="mf-date-row">' + dateInput("dueFrom", "从") +
      '<span class="sep">~</span>' + dateInput("dueTo", "到") + '</div>' +
      '<div class="mf-date-quick">' + presetInner + '</div></div>';
  }
  return '<div class="dim-dates"><div class="mf-date-row">' + dateInput("startFrom", "从") +
    '<span class="sep">~</span>' + dateInput("startTo", "到") + '</div></div>';
}
function mfOptionHTML(key, o){
  var attr = key.slice(0, -1);
  return '<button class="mf-opt" type="button" data-mf-opt="' + key + '" data-mf-val="' + esc(String(o.val)) + '" data-mf-label="' + esc(String(o.label).toLowerCase()) + '" data-' + attr + '="' + esc(String(o.val)) + '" aria-pressed="' + (o.on ? "true" : "false") + '">' +
    '<span class="mf-ck" aria-hidden="true">' + (o.on ? icon("check", 12) : "") + '</span>' +
    (o.color ? '<i class="cdot" style="background:' + esc(o.color) + '"></i>' : "") +
    '<span class="mf-opt-name">' + esc(o.label) + '</span>' +
    (o.active ? '<span class="mf-opt-tag">进行中</span>' : "") +
    '<span class="mf-n">' + (o.count == null ? "" : o.count) + '</span></button>';
}
function mfValuesHTML(key){
  var def = mfDef(key);
  if(!def) return '<p class="mf-empty">没有匹配的筛选条件</p>';
  var n = mfSelectedCount(key);
  var items = (key === "due" || key === "start" || key === "completion" || key === "blocked") ? [] : mfItems(key);
  var hint = key === "completion" ? "单选" : (key === "blocked" ? "开关" : (key === "due" || key === "start" ? "区间" : "多选 · " + items.length + " 个"));
  var head = '<div class="mf-vals-head"><span class="mf-vt">' + def.title + '</span>' +
    '<span class="mf-vh">' + hint + '</span>' +
    (n ? '<button class="mf-clear" type="button" data-mf-clear="' + key + '">清空</button>' : "") + '</div>';
  if(key === "due" || key === "start") return head + mfDateHTML(key);
  if(key === "completion"){
    return head + '<div class="mf-opts">' + COMPLETION_OPTIONS.map(function(o){
      var on = (state.completion || "") === o[0];
      return '<button class="mf-opt" type="button" data-mf-opt="completion" data-mf-val="' + o[0] + '" data-completion="' + o[0] +
        '" aria-pressed="' + on + '"><span class="mf-ck" aria-hidden="true">' + (on ? icon("check", 12) : "") + '</span>' +
        '<span class="mf-opt-name">' + o[1] + '</span></button>';
    }).join("") + '</div>';
  }
  if(key === "blocked"){
    return head + '<div class="mf-opts"><button class="mf-opt" type="button" data-mf-opt="blocked" data-mf-val="1" data-blocked-filter aria-pressed="' +
      (state.blocked ? "true" : "false") + '"><span class="mf-ck" aria-hidden="true">' + (state.blocked ? icon("check", 12) : "") +
      '</span><i class="cdot" style="background:var(--warning)"></i><span class="mf-opt-name">仅看被阻塞</span></button></div>' +
      '<p class="foot-note mf-hint">被阻塞的工作项会在看板与列表中标记，便于先处理卡点。</p>';
  }
  var q = String(mfQ || "").trim().toLowerCase();
  var vq = String(mfValQ || "").trim().toLowerCase();
  var titleHit = def.title.toLowerCase().indexOf(q) !== -1;
  var shown = 0;
  var rows = items.map(function(o){
    var hit = (o.on || !q || titleHit || mfHit(o, q)) && (o.on || !vq || mfHit(o, vq));
    if(!hit) return "";
    shown++;
    return mfOptionHTML(key, o);
  }).join("");
  var searchHTML = items.length > 8
    ? '<input type="search" class="mf-val-search" data-mf-val-q value="' + esc(mfValQ) +
      '" placeholder="搜索' + def.title + '…（共 ' + items.length + ' 个）" aria-label="搜索' + def.title + '" autocomplete="off">'
    : "";
  return head + searchHTML + '<div class="mf-opts">' + rows +
    '<p class="mf-empty mf-opt-empty"' + (shown ? " hidden" : "") + '>没有匹配的选项</p></div>';
}
function mfFocusDesc(){
  var el = document.activeElement;
  if(!el || !moreFilterMenu.contains(el)) return null;
  if(el.hasAttribute("data-mf-q")) return { t:"q" };
  if(el.hasAttribute("data-mf-val-q")) return { t:"valq" };
  if(el.dataset.mfDim) return { t:"dim", k:el.dataset.mfDim };
  var opt = el.closest("[data-mf-opt]");
  if(opt) return { t:"opt", k:opt.dataset.mfOpt, v:opt.dataset.mfVal };
  return null;
}
function mfRestoreFocus(desc){
  if(!desc) return;
  var el = null;
  if(desc.t === "q") el = moreFilterMenu.querySelector("[data-mf-q]");
  else if(desc.t === "valq") el = moreFilterMenu.querySelector("[data-mf-val-q]");
  else if(desc.t === "dim") el = moreFilterMenu.querySelector('[data-mf-dim="' + desc.k + '"]');
  else if(desc.t === "opt"){
    var opts = moreFilterMenu.querySelectorAll("[data-mf-opt]");
    for(var i = 0; i < opts.length; i++){
      if(opts[i].dataset.mfOpt === desc.k && String(opts[i].dataset.mfVal) === String(desc.v)){ el = opts[i]; break; }
    }
  }
  if(el){ try{ el.focus({preventScroll:true}); }catch(e){ el.focus(); } }
}
function syncMfDimState(){
  moreFilterMenu.querySelectorAll("[data-mf-dim]").forEach(function(btn){
    var on = btn.dataset.mfDim === mfDim;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-current", on ? "true" : "false");
  });
}
function renderMfVals(){
  var box = moreFilterMenu.querySelector("[data-mf-vals]");
  if(!box) return;
  box.innerHTML = mfDim ? mfValuesHTML(mfDim) : '<p class="mf-empty">没有匹配的筛选条件</p>';
  syncMfDimState();
}
function applyMfSearch(){
  var q = String(mfQ || "").trim().toLowerCase();
  var first = "";
  moreFilterMenu.querySelectorAll("[data-mf-dim]").forEach(function(btn){
    var hit = !q || mfDimHasQuery(btn.dataset.mfDim, q);
    btn.hidden = !hit;
    if(hit && !first) first = btn.dataset.mfDim;
  });
  if(!first){
    mfDim = "";
    renderMfVals();
    return;
  }
  if(!mfDim || !mfDef(mfDim) || !mfDimHasQuery(mfDim, q)){
    mfDim = first;
    mfValQ = "";
  }
  renderMfVals();
}
function applyMfValSearch(){
  var vq = String(mfValQ || "").trim().toLowerCase();
  var box = moreFilterMenu.querySelector("[data-mf-vals]");
  if(!box) return;
  var shown = 0;
  box.querySelectorAll(".mf-opt[data-mf-opt]").forEach(function(btn){
    var on = btn.getAttribute("aria-pressed") === "true";
    var hit = on || !vq || String(btn.dataset.mfLabel || "").indexOf(vq) !== -1
      || String(btn.dataset.mfVal || "").toLowerCase().indexOf(vq) !== -1;
    btn.hidden = !hit;
    if(hit) shown++;
  });
  var empty = box.querySelector(".mf-opt-empty");
  if(empty) empty.hidden = shown > 0;
}
function mfTotal(){
  var n = 0;
  MF_DIMS.forEach(function(d){ n += mfSelectedCount(d.key); });
  return n;
}
function renderMoreFilter(meta){
  mfMeta = meta;
  if(!mfDef(mfDim)) mfDim = "cats";
  var q = String(mfQ || "").trim().toLowerCase();
  var visible = [];
  var dimHTML = MF_DIMS.map(function(d){
    var hit = !q || mfDimHasQuery(d.key, q);
    if(hit) visible.push(d.key);
    var n = mfSelectedCount(d.key);
    return '<button class="mf-dim" type="button" data-mf-dim="' + d.key + '" aria-current="' + (d.key === mfDim ? "true" : "false") + '"' +
      (hit ? "" : " hidden") + '>' + icon(d.icon, 14) +
      '<span class="mf-dim-name">' + d.title + '</span>' +
      (n ? '<span class="mf-cnt has">' + n + '</span>' : "") + '</button>';
  }).join("");
  if(visible.indexOf(mfDim) === -1){ mfDim = visible[0] || ""; mfValQ = ""; }
  var desc = mfFocusDesc();
  var opts = moreFilterMenu.querySelector(".mf-opts");
  var scrollTop = opts ? opts.scrollTop : 0;
  moreFilterMenu.innerHTML = '<div class="mf-panel">' +
    '<div class="mf-search">' + icon("search", 14) +
      '<input type="search" data-mf-q value="' + esc(mfQ) + '" placeholder="搜索字段或取值…" aria-label="搜索筛选条件" autocomplete="off">' +
      '<kbd>F</kbd></div>' +
    '<div class="mf-body"><nav class="mf-dims" aria-label="筛选维度">' + dimHTML + '</nav>' +
      '<section class="mf-vals" data-mf-vals aria-live="polite"></section></div>' +
    '<div class="mf-foot"><span class="foot-note" data-mf-total></span>' +
      '<button class="btn sm" type="button" data-mf-reset>清空筛选</button></div>' +
    '</div>';
  renderMfVals();
  var newOpts = moreFilterMenu.querySelector(".mf-opts");
  if(newOpts) newOpts.scrollTop = scrollTop;
  var total = moreFilterMenu.querySelector("[data-mf-total]");
  if(total) total.textContent = mfTotal() ? "已选 " + mfTotal() + " 项 · 选中即生效" : "选中即生效";
  mfRestoreFocus(desc);

  var n = mfTotal();
  moreFilterCount.hidden = n === 0;
  moreFilterCount.textContent = n;
}
function openMoreFilter(dimKey, focusSearch){
  mfDim = mfDef(dimKey) ? dimKey : (mfDef(mfDim) ? mfDim : "cats");
  mfQ = "";
  mfValQ = "";
  renderMoreFilter(state.board ? state.board.meta : null);
  UI.openPop(moreFilterMenu, $("btnMoreFilter"), {align:"left", width:Math.min(576, window.innerWidth - 16)});
  if(focusSearch && !isMobile()){
    var input = moreFilterMenu.querySelector("[data-mf-q]");
    if(input){ try{ input.focus({preventScroll:true}); }catch(e){ input.focus(); } }
  }
}
function editFilterDim(key){
  if(["owners", "pris", "columns", "reqs"].indexOf(key) !== -1){
    var btn = dimGroup && dimGroup.querySelector('[data-dim-open="' + key + '"]');
    if(btn) openDimMenu(key, btn);
    return;
  }
  openMoreFilter(key, false);
}
function mfSetDim(key){
  if(!mfDef(key)) return;
  mfDim = key;
  mfValQ = "";
  renderMfVals();
}
function clearMfDim(key){
  if(key === "due"){
    state.noDue = false; state.dueFrom = null; state.dueTo = null;
  }else if(key === "start"){
    state.startFrom = null; state.startTo = null;
  }else if(key === "completion"){
    state.completion = "";
  }else if(key === "blocked"){
    state.blocked = false;
  }else{
    state[key] = [];
  }
  reloadFilteredViews();
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
  box.innerHTML = '<span class="chip chip-split alert-today" aria-pressed="true">' +
    '<button class="chip-main" type="button" data-edit-dim="blocked" title="修改阻塞筛选">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞</button>' +
    '<button class="chip-x" type="button" data-clear-dim="blocked" title="清除阻塞筛选" aria-label="清除阻塞筛选">' +
    icon("close", 12) + '</button></span>';
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
/* 列表保存的视图带 Smart Bar 预设（分派给我 / 本周到期），在看板、日历上没有等价筛选：
   这些入口只在列表页出现，避免点了没反应。 */
function listOnlyView(v){
  var p = {};
  try{ p = JSON.parse(v.params || "{}") || {}; }catch(e){ return false; }
  return !!(p.preset || p.hideDone) && !p.listConfig;
}
/* 我的工作不展示工作项列表的视图：这些视图含列表布局（预置/分组/排序），在那里只能部分生效。
   没有任何视图时也要保留入口——菜单里还有「保存当前视图」，藏掉就没有保存第一个视图的地方。 */
function viewsShownHere(){
  return activeView !== "mine";
}
function renderViews(){
  if(!viewBox) return;
  var all = savedViewsFor("task");
  var views = activeView === "list" ? all : all.filter(function(v){ return !listOnlyView(v); });
  var shown = viewsShownHere();
  var grp = $("viewGroup"), badge = $("viewsBadge");
  if(grp) grp.hidden = !shown;
  if(badge){
    badge.hidden = views.length === 0;
    badge.textContent = views.length;
  }
  /* 保存视图收进下拉：筛选栏只留一个入口，避免视图名把维度按钮挤出视野 */
  var emptyNote = all.length
    ? '当前页没有可用的视图。列表保存的视图（如「分派给我」）请到「列表」页使用。'
    : '还没有保存的视图。设置筛选后点下方按钮保存。';
  viewBox.innerHTML = views.length
    ? '<div class="menu-title">保存的视图</div>'
      + views.map(function(v){
        return '<div class="menu-row">' +
          '<button class="menu-item" type="button" data-view-apply="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' +
          '<span class="dim-name">' + esc(v.name) + '</span></button>' +
          '<button class="icon-btn sm" type="button" data-view-del="' + esc(v.id) + '" title="删除视图" aria-label="删除视图">' + icon("close", 11) + '</button>' +
          '</div>';
      }).join("")
      + '<div class="menu-foot"><button class="btn sm" type="button" data-view-save>保存当前视图</button></div>'
    : '<div class="menu-field"><p class="foot-note" style="margin:0">' + emptyNote + '</p></div>'
      + '<div class="menu-foot"><button class="btn sm" type="button" data-view-save>保存当前视图</button></div>';
  renderSmartTabs();
  updateFilterActions();
}
function updateFilterActions(){
  var n = selectedFilterCount();
  /* 保存入口收进「视图」菜单；筛选栏操作区只在有已选条件时出现，避免常驻占宽。
     列表的保存入口由 Smart Bar 承担，但「已选 / 清空」在筛选栏仍然有用。 */
  var showActions = n > 0;
  filterActions.hidden = !showActions;
  selectedSummary.hidden = n === 0;
  selectedSummary.innerHTML = '已选 ' + n + ' 项 ' + icon("close", 12);
}
var lastActiveSig = "";
var revealChipsPending = false;
function anyFilterPopoverOpen(){
  var pops = document.querySelectorAll(".popover");
  for(var i = 0; i < pops.length; i++) if(pops[i].__popOpen) return true;
  return false;
}
function revealFilterChips(){
  /* 只滚动已选条件区；左侧入口（截止期 / 项目 / 状态 / 负责人 / 优先级）永远保持可见 */
  var box = document.querySelector(".fb-active");
  if(box && box.scrollWidth > box.clientWidth) box.scrollLeft = box.scrollWidth;
}
/* 浮层打开时不要滚动筛选栏：按钮一移位，面板会跟着跳，正在点的选项就跑了。
   等浮层关掉后再把新 chip 滚进视野。 */
function syncRevealChips(){
  if(anyFilterPopoverOpen()) revealChipsPending = true;
  else revealFilterChips();
}
document.addEventListener("pointerdown", function(){
  if(!revealChipsPending) return;
  setTimeout(function(){
    if(!anyFilterPopoverOpen() && revealChipsPending){
      revealChipsPending = false;
      revealFilterChips();
    }
  }, 0);
}, true);
document.addEventListener("keydown", function(e){
  if(e.key !== "Escape" || !revealChipsPending) return;
  setTimeout(function(){
    if(!anyFilterPopoverOpen() && revealChipsPending){
      revealChipsPending = false;
      revealFilterChips();
    }
  }, 0);
}, true);
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
  /* 已选区没有任何可见条件时彻底收起，别用一个空 flex 占掉半条筛选栏 */
  var activeBox = $("fbActive");
  if(activeBox){
    activeBox.hidden = !activeBox.querySelector(".fgroup:not([hidden])");
  }
  updateFilterActions();
  var sig = [state.owners, state.testOwners, state.pris, state.types, state.versions, state.columns, state.completion,
    state.cats, state.tags, state.reqs, state.blocked, state.q,
    state.noDue, state.dueFrom, state.dueTo, state.startFrom, state.startTo].join("|");
  if(sig !== lastActiveSig){
    lastActiveSig = sig;
    /* 条件一多，筛选栏左侧改为横向滚动：把刚选中的 chip 滚进视野，右侧操作区不被挤掉 */
    syncRevealChips();
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
    /* 树形也是筛选视图：条件变化/应用保存视图/清空条件后必须换一版数据，
       否则树上停留在旧结果，清空筛选也不会回来。
       只在其模块已加载过时刷新（没进过层级视图就不可能在屏上），避免把懒加载拉回启动路径。 */
    var treeMod = viewModule("tree");
    if(treeMod) treeMod.refreshTreeIfOpen();
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
        owners: state.owners.slice(), testOwners: state.testOwners.slice(), pris: state.pris.slice(),
        cats: state.cats.slice(), reqs: state.reqs.slice(),
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
    ["owners","testOwners","pris","cats","reqs","tags","types","versions","columns"].forEach(function(k){
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
  UI.closeAllPops();
  reloadFilteredViews();
}
$("chipOver").addEventListener("click", function(){ setDueFilter("over"); });
$("chipToday").addEventListener("click", function(){ setDueFilter("today"); });
$("chipSoon").addEventListener("click", function(){ setDueFilter("soon"); });
$("chipFocus").addEventListener("click", function(){
  state.focus = !state.focus;
  UI.closeAllPops();
  reloadFilteredViews();
});
/* opts.keepReqs：用户点「清空筛选」时保留项目范围；列表预置、我的工作等内部重置仍用全量清空 */
function clearFilters(opts){
  var keepReqs = !!(opts && opts.keepReqs);
  state.q = ""; state.owners = []; state.testOwners = []; state.pris = []; state.cats = [];
  if(!keepReqs) state.reqs = [];
  state.tags = []; state.types = []; state.versions = []; state.columns = []; state.completion = "";
  state.due = null; state.focus = false; state.blocked = false;
  state.noDue = false; state.dueFrom = null; state.dueTo = null;
  state.startFrom = null; state.startTo = null;
  searchInput.value = "";
  searchWrap.classList.remove("has");
  reloadFilteredViews();
}
$("btnClearFilter").addEventListener("click", function(){ clearFilters({keepReqs:true}); });
selectedSummary.addEventListener("click", function(){
  var n = selectedFilterCount();
  if(n >= 3){
    UI.showConfirm({
      title:"清空筛选",
      msg:"当前有 <b>" + n + "</b> 项筛选条件，确定全部清空？项目范围会保留。",
      okText:"清空",
      danger:false
    }).then(function(ok){ if(ok) clearFilters({keepReqs:true}); });
    return;
  }
  clearFilters({keepReqs:true});
});
function handleFilterClick(e){
  var dueBtn = e.target.closest("[data-due-open]");
  if(dueBtn){
    var dueMenu = $("dueMenu");
    if(dueMenu && UI.popOpen(dueMenu)){ UI.closeAllPops(); return; }
    if(dueMenu){ syncDueButton(); UI.openPop(dueMenu, dueBtn, {align:"left", width:248}); }
    return;
  }
  if(e.target.closest("[data-due-clear]")){
    state.due = null; state.focus = false;
    UI.closeAllPops();
    reloadFilteredViews();
    return;
  }
  var dimBtn = e.target.closest("[data-dim-open]");
  if(dimBtn){ openDimMenu(dimBtn.dataset.dimOpen, dimBtn); return; }
  var edit = e.target.closest("[data-edit-dim]");
  if(edit){ editFilterDim(edit.dataset.editDim); return; }
  var mfDimBtn = e.target.closest("[data-mf-dim]");
  if(mfDimBtn){ mfSetDim(mfDimBtn.dataset.mfDim); return; }
  var mfClear = e.target.closest("[data-mf-clear]");
  if(mfClear){ clearMfDim(mfClear.dataset.mfClear); return; }
  var clear = e.target.closest("[data-clear-dim]");
  if(clear){ clearMfDim(clear.dataset.clearDim); return; }
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
  var to = e.target.closest("[data-testOwner]");
  if(to){ toggleFilterValue("testOwners", to.dataset.testowner); return; }
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
    /* 与筛选栏的「清空筛选」同义：清掉搜索、截止期与各维度，保留当前项目范围 */
    clearFilters({keepReqs:true});
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
  if(e.target.closest("[data-mf-q]")){
    mfQ = e.target.value || "";
    mfValQ = "";
    applyMfSearch();
    return;
  }
  if(e.target.closest("[data-mf-val-q]")){
    mfValQ = e.target.value || "";
    applyMfValSearch();
  }
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
var dueMenuEl = $("dueMenu");
if(dueMenuEl) dueMenuEl.addEventListener("click", handleFilterClick);
/* 浮层打开后会挂到 body 上，点击不再经过筛选栏：菜单自身也要接管点击 */
dimMenu.addEventListener("input", function(e){
  if(e.target.closest("[data-dim-q]")) applyDimSearch();
});
$("btnMoreFilter").addEventListener("click", function(){
  if(UI.popOpen(moreFilterMenu)){ UI.closeAllPops(); return; }
  openMoreFilter(null, true);
});
/* F 打开筛选（Linear 同款）：输入框、弹窗内不抢键；只在本页确实有筛选栏时生效 */
document.addEventListener("keydown", function(e){
  if((e.key !== "f" && e.key !== "F") || e.metaKey || e.ctrlKey || e.altKey) return;
  var t = e.target;
  if(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  if(UI.anyModalOpen && UI.anyModalOpen()) return;
  if(["board", "list", "mine", "calendar", "gantt"].indexOf(activeView) === -1) return;
  var bar = $("filterbar");
  if(!bar || !bar.offsetParent) return;
  e.preventDefault();
  $("btnMoreFilter").click();
}, true);
/* 维度列表方向键切换；顶部搜索里按 ↓ 直接进入维度。
   取值区按键交给浏览器原生处理，否则在选项上按方向键会被拽回左栏 */
moreFilterMenu.addEventListener("keydown", function(e){
  if(e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  var inTopSearch = e.target.hasAttribute("data-mf-q");
  if(!inTopSearch && !e.target.closest("[data-mf-dim]")) return;
  var btns = Array.prototype.filter.call(moreFilterMenu.querySelectorAll("[data-mf-dim]"), function(b){ return !b.hidden; });
  if(!btns.length) return;
  var i = btns.indexOf(document.activeElement);
  var next = i === -1 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length;
  e.preventDefault();
  btns[next].focus();
  mfSetDim(btns[next].dataset.mfDim);
}, true);
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
  var owners = strArr(p.owners), testOwners = strArr(p.testOwners), pris = strArr(p.pris), cats = strArr(p.cats),
      reqs = strArr(p.reqs), tags = strArr(p.tags), types = strArr(p.types), versions = strArr(p.versions),
      columns = strArr(p.columns);
  if(!owners || !testOwners || !pris || !cats || !reqs || !tags || !types || !versions || !columns) return null;
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
    owners: owners, testOwners: testOwners, pris: pris, cats: cats, reqs: reqs, tags: tags, types: types, versions: versions,
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
  state.q = f.q; state.owners = f.owners; state.testOwners = f.testOwners; state.pris = f.pris; state.cats = pruneUnknownCats(f.cats);
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
    UI.closeAllPops();
    for(var i = 0; i < rt.savedViews.length; i++){
      if(String(rt.savedViews[i].id) === String(ap.dataset.viewApply)){ applyView(rt.savedViews[i]); return; }
    }
    return;
  }
  var dl = e.target.closest("[data-view-del]");
  if(dl){ deleteView(dl.dataset.viewDel); return; }
  if(e.target.closest("[data-view-save]")){ UI.closeAllPops(); promptSaveView(); }
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
var btnViewsMenu = $("btnViewsMenu");
if(btnViewsMenu){
  btnViewsMenu.addEventListener("click", function(){
    if(UI.popOpen(viewBox)){ UI.closeAllPops(); return; }
    renderViews();
    UI.openPop(viewBox, btnViewsMenu, {align:"right", width:260});
  });
}
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
