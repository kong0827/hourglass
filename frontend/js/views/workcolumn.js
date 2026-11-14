/* views/workcolumn · 列状态工作页：时间窗、服务端聚合指标与分页明细 */

import { API } from "../core/api.js";
import { loadCategories } from "../core/app.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { catNameById, dueMetaClass, dueState, dueText, reqNameById, rt, state, tagChip } from "../core/state.js";
import { groupDimName, groupOptionsHTML } from "../core/group-dims.js";
import { openTaskById } from "../core/task-actions.js";
import { ownerOptions } from "../core/task-drawer.js";
import { isMobile } from "../core/layout.js";
import { listDensitySegHTML } from "../core/list-density.js";
import { UI, esc, toast } from "../core/ui.js";
import { COLUMNS, avatarHTML, colName, dayDiff, fmtMinutesShort, fmtShortMD, parseDate, priName, priTagHTML, typeBadgeHTML, typeName } from "../lib/format.js";

var PAGE_SIZE = 100;
var DONE_COL = "done";
var DEFAULT_RANGE = "week";
var RANGE_OPTIONS = [["week","本周"],["month","本月"],["quarter","近 90 天"],["all","全部历史"]];
/* 一列本身就是一种状态；分组只回答「列内再怎么切一刀」，默认不分组、保持服务端风险顺序 */
var GROUP_OPTIONS = ["none", "owner", "priority", "project", "category"];
var TYPE_OPTIONS = [["story","需求"],["task","任务"],["bug","缺陷"],["epic","史诗"]];
var PRI_OPTIONS = ["P0","P1","P2","P3"];
var DUE_OPTIONS = [["over","已逾期"],["today","今天到期"],["soon","3 天内"],["none","未设截止"]];
var SORTS = { open:["due","priority","updated"], done:["completed","due","priority","updated"] };
var SORT_LABELS = { completed:"完成时间", due:"截止日期", priority:"优先级", updated:"更新时间" };
var PRI_RANK = { P0:0, P1:1, P2:2, P3:3 };
var COLUMN_RULES = {
  backlog:"队列入口：先看未分配与超期未动的项，决定推进、重排还是关闭。",
  doing:"在制品：关注逾期、阻塞与工时消耗；同时开工过多时优先收敛队列。",
  test:"等待测试：等待时长比逾期更能说明交付缓冲是否被吃掉。",
  testing:"测试中：P0/P1 优先回归，阻塞会直接拖长本轮周期。",
  done:"已完成长期累积：默认只看本周，完整回看可切时间窗；看板只放最近 6 条。"
};
var DEFAULT_RULE = "当前列的队列、风险与工时消耗；统计在服务端聚合，明细分页加载。";

var SCOPE_LIST_KEYS = ["owners", "pris", "cats", "reqs", "tags", "types", "versions"];
var SCOPE_DATE_KEYS = ["dueFrom", "dueTo", "startFrom", "startTo"];
var DIM_TITLES = { reqs:"项目", owners:"负责人", pris:"优先级", types:"类型", cats:"模块", tags:"标签", versions:"版本" };

var WC_LAYOUTS = ["card", "list"];
var wcLayout = wcLayoutPref();
function wcLayoutPref(){
  var v = "";
  try{ v = localStorage.getItem("ds.wc.layout"); }catch(e){ return "card"; }
  return WC_LAYOUTS.indexOf(v) >= 0 ? v : "card";
}
function setWcLayout(v){
  if(WC_LAYOUTS.indexOf(v) === -1 || wcLayout === v) return;
  wcLayout = v;
  try{ localStorage.setItem("ds.wc.layout", v); }catch(e){ /* 受限环境忽略 */ }
  renderResults();
}
function wcListMode(){
  /* 手机上列表要横向滚动才能放下列宽，形态切换只在桌面端提供 */
  return wcLayout === "list" && !isMobile();
}
function wcLayoutSegHTML(){
  var names = { card:"卡片", list:"列表" };
  return '<div class="seg mini wc-layout" role="group" aria-label="工作页展示形态">' + WC_LAYOUTS.map(function(k){
    return '<button type="button" data-wc-layout="' + k + '" aria-pressed="' + (wcLayout === k) + '">' + names[k] + '</button>';
  }).join("") + '</div>';
}

function emptyScope(){
  return {
    q:"", owners:[], pris:[], cats:[], reqs:[], tags:[], types:[], versions:[],
    due:"", noDue:false, focus:false, blocked:false,
    dueFrom:"", dueTo:"", startFrom:"", startTo:""
  };
}

/* 列、排序、分组与筛选全部进 URL：刷新、收藏、发给同事都能复现同一屏 */
var st = {
  active:false,
  col:"backlog",
  range:DEFAULT_RANGE,
  group:"none",
  sort:"due",
  scope:emptyScope(),
  tabs:null,
  data:null,
  rows:[],
  offset:0,
  error:"",
  loading:false,
  seq:0,
  moreOpen:false,
  scopeTimer:0,
  qTimer:0
};
/* 页签是导航不是选项卡：窄屏下要保证当前列在可视区内，键盘切换后焦点回到新页签 */
var refocusTab = false;

function isDone(col){ return col === DONE_COL; }
function normalizeRange(v){ return v === "month" || v === "quarter" || v === "all" ? v : DEFAULT_RANGE; }
function rangeLabel(v){
  for(var i = 0; i < RANGE_OPTIONS.length; i++) if(RANGE_OPTIONS[i][0] === v) return RANGE_OPTIONS[i][1];
  return "本周";
}
function normalizeGroup(v){ return GROUP_OPTIONS.indexOf(v) !== -1 ? v : "none"; }
function groupLabel(v){ return groupDimName(v || "none"); }
function defaultSort(col){ return isDone(col) ? "completed" : "due"; }
function normalizeSort(col, v){
  var list = SORTS[isDone(col) ? "done" : "open"];
  return list.indexOf(v) !== -1 ? v : defaultSort(col);
}
function dueLabel(v){
  for(var i = 0; i < DUE_OPTIONS.length; i++) if(DUE_OPTIONS[i][0] === v) return DUE_OPTIONS[i][1];
  return v || "";
}
function typeLabel(v){
  for(var i = 0; i < TYPE_OPTIONS.length; i++) if(TYPE_OPTIONS[i][0] === v) return TYPE_OPTIONS[i][1];
  return typeName(v) || v;
}

function scopeList(v){
  var out = [];
  String(v || "").split(",").forEach(function(x){
    x = x.trim();
    if(!x || x.length > 120 || out.length >= 50) return;
    if(out.indexOf(x) === -1) out.push(x);
  });
  return out;
}
function isDate(v){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
  var p = v.split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return d.getFullYear() === Number(p[0]) && d.getMonth() === Number(p[1]) - 1 && d.getDate() === Number(p[2]);
}
function parseScope(params){
  var s = emptyScope();
  s.q = String(params.get("q") || "").slice(0, 200);
  SCOPE_LIST_KEYS.forEach(function(k){ s[k] = scopeList(params.get(k)); });
  SCOPE_DATE_KEYS.forEach(function(k){
    var v = params.get(k) || "";
    s[k] = isDate(v) ? v : "";
  });
  var due = params.get("due") || "";
  s.due = due === "over" || due === "today" || due === "soon" ? due : "";
  s.noDue = params.get("noDue") === "1";
  s.focus = params.get("focus") === "1";
  s.blocked = params.get("blocked") === "1";
  /* 未设截止与到期窗口互斥：下拉只能表达一个，URL 同时带两个时以未设截止为准 */
  if(s.noDue) s.due = "";
  return s;
}
function scopeActive(s){
  return !!(s.q || s.due || s.noDue || s.focus || s.blocked ||
    s.dueFrom || s.dueTo || s.startFrom || s.startTo ||
    s.owners.length || s.pris.length || s.cats.length || s.reqs.length ||
    s.tags.length || s.types.length || s.versions.length);
}
function scopeSig(s){
  return JSON.stringify([s.q, s.owners, s.pris, s.cats, s.reqs, s.tags, s.types, s.versions,
    s.due, s.noDue, s.focus, s.blocked, s.dueFrom, s.dueTo, s.startFrom, s.startTo]);
}
function scopeQuery(s){
  var parts = [];
  if(s.q) parts.push("q=" + encodeURIComponent(s.q));
  SCOPE_LIST_KEYS.forEach(function(k){
    if(s[k] && s[k].length) parts.push(k + "=" + encodeURIComponent(s[k].join(",")));
  });
  if(s.due) parts.push("due=" + encodeURIComponent(s.due));
  if(s.noDue) parts.push("noDue=1");
  if(s.blocked) parts.push("blocked=1");
  if(s.focus) parts.push("focus=1");
  SCOPE_DATE_KEYS.forEach(function(k){
    if(isDate(s[k])) parts.push(k + "=" + s[k]);
  });
  return parts.join("&");
}

function routeHash(){
  var h = "#/workcolumn?col=" + encodeURIComponent(st.col);
  if(isDone(st.col) && st.range !== DEFAULT_RANGE) h += "&range=" + encodeURIComponent(st.range);
  if(st.group !== "none") h += "&group=" + encodeURIComponent(st.group);
  if(st.sort !== defaultSort(st.col)) h += "&sort=" + encodeURIComponent(st.sort);
  var scope = scopeQuery(st.scope);
  if(scope) h += "&" + scope;
  return h;
}
function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "workcolumn") return null;
  var params = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  return { col: params.get("col") || "", range: params.get("range") || "", group: params.get("group") || "", sort: params.get("sort") || "", scope: parseScope(params) };
}
function syncRoute(push){
  var h = routeHash();
  if(window.location.hash === h) return;
  try{
    if(push) history.pushState(null, "", h);
    else history.replaceState(null, "", h);
  }catch(e){ window.location.hash = h; }
}

function queryParams(offset){
  var p = {
    col: st.col,
    range: isDone(st.col) ? st.range : null,
    sort: st.sort,
    offset: offset,
    limit: PAGE_SIZE
  };
  var s = st.scope;
  if(s.q) p.q = s.q;
  SCOPE_LIST_KEYS.forEach(function(k){
    if(s[k] && s[k].length) p[k] = s[k].join(",");
  });
  if(s.due) p.due = s.due;
  if(s.noDue) p.noDue = 1;
  if(s.blocked) p.blocked = 1;
  if(s.focus) p.focus = 1;
  SCOPE_DATE_KEYS.forEach(function(k){
    if(isDate(s[k])) p[k] = s[k];
  });
  return p;
}

function resultTotal(d){
  if(!d) return 0;
  /* matched 是当前列 + 时间窗 + 筛选后的服务端总数；metrics.count 在「全部历史」
     时收敛到近 90 天，只能用于指标，不能拿来判断还该不该翻页 */
  if(typeof d.matched === "number") return d.matched;
  if(d.metrics && typeof d.metrics.count === "number") return d.metrics.count;
  return 0;
}

function load(reset, quiet){
  if(reset){
    st.offset = 0;
    st.error = "";
    /* 静默刷新保留旧结果并压暗，避免每敲一个字都闪一次骨架 */
    if(!quiet || !st.data){ st.rows = []; st.data = null; }
  }
  var seq = ++st.seq;
  st.loading = true;
  if(!quiet || !st.data) renderAll();
  else setBusy(true);
  API.get("/api/tasks/workpage", queryParams(reset ? 0 : st.offset)).then(function(data){
    if(seq !== st.seq) return;
    st.loading = false;
    var resolved = data.column || st.col;
    var colChanged = resolved !== st.col;
    if(colChanged){
      st.col = resolved;
      st.sort = normalizeSort(resolved, st.sort);
      UI.closeAllPops();
    }
    if(isDone(resolved) && data.range) st.range = normalizeRange(data.range);
    if(data.columns && data.columns.length) st.tabs = data.columns;
    /* 追问「加载更多」的响应不带指标，沿用首屏结果 */
    var prevMetrics = st.data && st.data.metrics;
    st.data = data;
    if(!reset && prevMetrics) data.metrics = prevMetrics;
    st.error = "";
    var items = data.items || [];
    if(reset){
      st.rows = items;
    }else{
      var known = {};
      st.rows.forEach(function(t){ known[t.id] = 1; });
      items.forEach(function(t){ if(!known[t.id]){ st.rows.push(t); known[t.id] = 1; } });
    }
    st.offset = st.rows.length;
    syncRoute(false);
    if(!st.active || activeView !== "workcolumn") return;
    if(colChanged) renderAll();
    else { syncHead(); renderResults(); }
  }).catch(function(ex){
    if(seq !== st.seq) return;
    st.loading = false;
    if(st.data){
      toast("加载失败：" + (ex.message || "网络异常"), "bad");
      setBusy(false);
      return;
    }
    st.error = ex.message || "网络异常，请稍后重试";
    if(st.active && activeView === "workcolumn") renderAll();
  });
}

function enterWorkColumn(){
  st.active = true;
  var route = parseRoute();
  if(!route){ st.active = false; return; }
  st.col = route.col || "backlog";
  st.range = normalizeRange(route.range);
  st.group = normalizeGroup(route.group);
  st.sort = normalizeSort(st.col, route.sort);
  st.scope = route.scope;
  st.data = null;
  st.rows = [];
  st.offset = 0;
  st.error = "";
  st.moreOpen = false;
  st.tabs = null;
  refocusTab = false;
  load(true);
  loadCategories().then(function(){
    if(activeView === "workcolumn" && st.active) syncFilterBits();
  });
}
function refreshFromHash(){
  if(activeView !== "workcolumn") return;
  var route = parseRoute();
  if(!route) return;
  var col = route.col || "backlog";
  var next = {
    col: col,
    range: normalizeRange(route.range),
    group: normalizeGroup(route.group),
    sort: normalizeSort(col, route.sort),
    scope: route.scope
  };
  var sameQuery = next.col === st.col && next.range === st.range &&
    next.sort === st.sort && scopeSig(next.scope) === scopeSig(st.scope);
  var sameView = sameQuery && next.group === st.group;
  if(sameView) return;
  st.col = next.col;
  st.range = next.range;
  st.group = next.group;
  st.sort = next.sort;
  st.scope = next.scope;
  st.moreOpen = false;
  /* 只改了分组：数据一样，重排即可，不重新请求 */
  if(sameQuery){
    renderFilters();
    syncHead();
    renderResults();
    return;
  }
  st.data = null;
  st.rows = [];
  st.offset = 0;
  st.error = "";
  UI.closeAllPops();
  load(true);
}

/* ==================== 服务端聚合指标 ==================== */
function metric(label, value, note, tone){
  return '<div class="wc-metric"><div class="wc-metric-label">' + esc(label) + '</div>' +
    '<div class="wc-metric-value' + (tone ? " " + tone : "") + '">' + value + '</div>' +
    '<div class="wc-metric-note" title="' + esc(note) + '">' + esc(note) + '</div></div>';
}
function timeMetric(m){
  var est = Number(m.estimateMinutes) || 0;
  var logged = Number(m.loggedMinutes) || 0;
  var pct = est > 0 ? Math.round(logged / est * 100) : null;
  return metric("工时消耗",
    pct == null ? fmtMinutesShort(logged) : pct + "%",
    (logged ? "已记录 " + fmtMinutesShort(logged) : "暂无计时") + (est ? " / 预估 " + fmtMinutesShort(est) : " / 未估时"),
    pct != null && pct >= 100 ? "warn" : "");
}
function metricsHTML(d){
  var m = d.metrics || {};
  if(d.done){
    var windowNote = d.range === "all"
      ? "全部历史明细，指标按近 90 天"
      : rangeLabel(d.range) + " · 服务端聚合";
    var dueNote = (m.withDue || 0) > 0
      ? (m.withDue + " 项有截止 · " + (m.onTime || 0) + " 项按时")
      : "没有设置截止日期的完成项";
    /* 五张卡统一按 metricRange 口径：全部历史明细时指标收敛到近 90 天，全量数留在头部 */
    return metric(rangeLabel(d.metricRange || d.range) + "完成", Number(m.count || 0) + " 项", windowNote)
      + metric("平均周期", (m.avgAgeDays == null ? "暂无" : m.avgAgeDays + " 天"), "创建到完成，按当前时间窗")
      + metric("逾期完成", (m.lateCompleted || 0) + " 项", dueNote, (m.lateCompleted || 0) ? "warn" : "ok")
      + timeMetric(m)
      + metric("最近完成", m.lastCompletedAt ? fmtShortMD(parseDate(m.lastCompletedAt)) : "暂无", "按完成日期");
  }
  return metric("当前列", resultTotal(d) + " 项", scopeActive(st.scope) ? "叠加筛选后的条数" : "这一列的全部工作项")
    + (d.overdueEnabled === false
      ? metric("已逾期", "不适用", "该列不累计逾期")
      : metric("已逾期", (m.overdue || 0) + " 项",
        m.overdue ? "优先确认是否可关闭或改期" : "当前结果无逾期",
        m.overdue ? "bad" : "ok"))
    + metric("被阻塞", (m.blocked || 0) + " 项",
      m.blocked ? "需先解除依赖" : "当前结果无阻塞",
      m.blocked ? "warn" : "ok")
    + metric("高优先级", (m.high || 0) + " 项", "P0 / P1 优先推进", m.high ? "warn" : "")
    + timeMetric(m);
}

/* ==================== 筛选选项与标签 ==================== */
function boardMeta(){ return (state.board && state.board.meta) || {}; }
function metaName(list, id){
  for(var i = 0; i < (list || []).length; i++){
    if(list[i] && list[i].id === id) return list[i].name;
  }
  return "";
}
function reqItems(){
  var m = boardMeta(), out = [], seen = {};
  (m.reqs || []).forEach(function(r){
    if(!r || !r.id || seen[r.id]) return;
    seen[r.id] = 1;
    out.push({ id:r.id, name:r.name || r.id, count:r.count });
  });
  if(!out.length){
    (rt.reqList || []).forEach(function(r){
      if(!r || !r.id || seen[r.id]) return;
      seen[r.id] = 1;
      out.push({ id:r.id, name:r.name || r.id, count:null });
    });
  }
  out.push({ id:"__none", name:"未归类", count:out.length ? (m.unassigned || 0) : null });
  return out;
}
function ownerItems(){
  var m = boardMeta(), out = [];
  (m.owners || []).forEach(function(o){
    if(o && o.name) out.push({ id:o.name, name:o.name, count:o.count });
  });
  if(!out.length){
    try{
      ownerOptions("").forEach(function(o){ out.push({ id:o.name, name:o.name, count:null }); });
    }catch(e){ /* 抽屉未就绪时留空 */ }
  }
  out.push({ id:"__none", name:"未指派", count:out.length ? (m.ownerUnassigned || 0) : null });
  return out;
}
function priItems(){
  var m = boardMeta(), out = [];
  PRI_OPTIONS.forEach(function(p){
    var hit = (m.pris || []).filter(function(x){ return x && x.name === p; })[0];
    out.push({ id:p, name:priName(p) + " · " + p, count:hit ? hit.count : null });
  });
  return out;
}
function typeItems(){
  var m = boardMeta(), out = [];
  TYPE_OPTIONS.forEach(function(p){
    var hit = (m.types || []).filter(function(x){ return x && x.name === p[0]; })[0];
    out.push({ id:p[0], name:p[1], count:hit ? hit.count : null });
  });
  return out;
}
function catItems(){
  var m = boardMeta(), out = [], seen = {};
  (m.cats || []).forEach(function(c){
    if(!c || !c.id || seen[c.id]) return;
    seen[c.id] = 1;
    out.push({ id:c.id, name:c.name || c.id, count:c.count });
  });
  if(!out.length){
    (rt.categoriesCache || []).forEach(function(c){
      if(!c || !c.id || seen[c.id]) return;
      seen[c.id] = 1;
      out.push({ id:c.id, name:c.name || c.id, count:null });
    });
  }
  out.push({ id:"__none", name:"未指定模块", count:out.length ? (m.catUnassigned || 0) : null });
  return out;
}
function tagItems(){
  var m = boardMeta(), out = [];
  (m.tags || []).forEach(function(t){
    if(t && t.name) out.push({ id:t.name, name:t.name, count:t.count });
  });
  return out;
}
function versionItems(){
  var m = boardMeta(), out = [];
  (m.versions || []).forEach(function(v){
    if(!v || !v.id) return;
    out.push({ id:v.id, name:versionLabel(v.id), count:v.count });
  });
  out.push({ id:"__none", name:"待规划", count:out.length ? (m.versionUnassigned || 0) : null });
  return out;
}
var DIM_ITEMS = { reqs:reqItems, owners:ownerItems, pris:priItems, types:typeItems, cats:catItems, tags:tagItems, versions:versionItems };

function versionLabel(id){
  if(id === "__none") return "待规划";
  var vs = boardMeta().versions || [];
  for(var i = 0; i < vs.length; i++){
    if(vs[i] && vs[i].id === id){
      return vs[i].name + (vs[i].projectName ? "（" + vs[i].projectName + "）" : "");
    }
  }
  return id;
}
function labelOf(dim, value){
  if(dim === "pris") return priName(value) + " · " + value;
  if(dim === "types") return typeLabel(value);
  if(dim === "owners") return value === "__none" ? "未指派" : value;
  if(dim === "cats") return value === "__none" ? "未指定模块" : (catNameById(value) || metaName(boardMeta().cats, value) || value);
  if(dim === "reqs") return value === "__none" ? "未归类" : (reqNameById(value) || metaName(boardMeta().reqs, value) || value);
  if(dim === "versions") return versionLabel(value);
  return value;
}

/* ==================== 多选筛选浮层 ==================== */
var dimMenuEl = null;
var dimCur = "";
var dimQ = "";
var dimClose = null;
function ensureDimMenu(){
  if(dimMenuEl) return dimMenuEl;
  dimMenuEl = document.createElement("div");
  dimMenuEl.className = "menu wc-dim-menu";
  dimMenuEl.hidden = true;
  document.body.appendChild(dimMenuEl);
  return dimMenuEl;
}
function renderDimMenu(){
  ensureDimMenu();
  var def = DIM_ITEMS[dimCur];
  if(!def){ dimMenuEl.innerHTML = ""; return; }
  var selected = st.scope[dimCur] || [];
  var items = def();
  var known = {};
  items.forEach(function(it){ known[it.id] = 1; });
  /* 从看板继承来的值可能不在当前 meta 里，仍然要能看到并移除 */
  selected.forEach(function(v){
    if(!known[v]){ known[v] = 1; items.push({ id:v, name:labelOf(dimCur, v), count:null }); }
  });
  items = items.filter(function(it){
    return it.count == null || it.count > 0 || selected.indexOf(it.id) !== -1;
  });
  var q = dimQ.trim().toLowerCase();
  var visible = q ? items.filter(function(it){ return String(it.name).toLowerCase().indexOf(q) !== -1; }) : items;
  var active = document.activeElement;
  var wasSearch = !!(active && active.getAttribute && active.getAttribute("data-dim-q") != null);
  var caret = wasSearch ? active.selectionStart : 0;
  var head = '<div class="wc-dim-head"><span>' + esc(DIM_TITLES[dimCur]) + '</span>' +
    '<button class="btn link sm" type="button" data-dim-clear' + (selected.length ? "" : " hidden") + '>清空</button></div>';
  var search = items.length > 6
    ? '<div class="wc-dim-search">' + icon("search", 14) + '<input type="search" data-dim-q value="' + esc(dimQ) +
        '" placeholder="筛选' + esc(DIM_TITLES[dimCur]) + '" aria-label="搜索' + esc(DIM_TITLES[dimCur]) + '"></div>'
    : "";
  dimMenuEl.setAttribute("aria-label", DIM_TITLES[dimCur]);
  dimMenuEl.innerHTML = head + search +
    '<div class="wc-dim-list" role="listbox" aria-multiselectable="true" aria-label="' + esc(DIM_TITLES[dimCur]) + '">' +
      (visible.length ? visible.map(function(it){
        var on = selected.indexOf(it.id) !== -1;
        return '<button class="wc-dim-opt' + (on ? " on" : "") + '" type="button" role="option" aria-selected="' + on +
          '" data-dim-opt="' + esc(it.id) + '">' +
          '<span class="ck" aria-hidden="true">' + (on ? icon("check", 12) : "") + '</span>' +
          '<span class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</span>' +
          (typeof it.count === "number" ? '<span class="n">' + it.count + '</span>' : '') +
        '</button>';
      }).join("") : '<div class="wc-dim-none">没有匹配的选项</div>') +
    '</div>' +
    '<div class="wc-dim-foot"><span data-dim-count>已选 ' + selected.length + ' 项</span>' +
      '<button class="btn sm" type="button" data-dim-done>完成</button></div>';
  if(wasSearch){
    var input = dimMenuEl.querySelector("[data-dim-q]");
    if(input){
      input.focus();
      try{ input.setSelectionRange(caret, caret); }catch(e){ /* noop */ }
    }
  }
}
function openDimMenu(dim, anchor){
  ensureDimMenu();
  if(UI.popOpen(dimMenuEl)) UI.closeAllPops();
  dimCur = dim;
  dimQ = "";
  renderDimMenu();
  if(anchor) anchor.setAttribute("aria-expanded", "true");
  dimClose = UI.openPop(dimMenuEl, anchor, {
    align:"left",
    width:Math.min(320, window.innerWidth - 24),
    onClose:function(){
      var btn = document.querySelector('.wc-dim[data-wc-dim="' + dimCur + '"]');
      if(btn) btn.setAttribute("aria-expanded", "false");
      dimCur = "";
      dimQ = "";
      dimMenuEl.innerHTML = "";
    }
  });
  if(!isMobile() && dimMenuEl.querySelector("[data-dim-q]")){
    try{ dimMenuEl.querySelector("[data-dim-q]").focus({preventScroll:true}); }catch(e){ /* noop */ }
  }
}
function toggleScopeValue(dim, value, btn){
  var arr = st.scope[dim];
  var i = arr.indexOf(value);
  if(i >= 0) arr.splice(i, 1);
  else if(arr.length < 50) arr.push(value);
  if(btn){
    var on = arr.indexOf(value) !== -1;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    var ck = btn.querySelector(".ck");
    if(ck) ck.innerHTML = on ? icon("check", 12) : "";
  }
  var count = dimMenuEl && dimMenuEl.querySelector("[data-dim-count]");
  if(count) count.textContent = "已选 " + arr.length + " 项";
  var clear = dimMenuEl && dimMenuEl.querySelector("[data-dim-clear]");
  if(clear) clear.hidden = !arr.length;
  st.offset = 0;
  syncDimButton(dim);
  syncChips();
  syncMoreButton();
  syncRoute(false);
  scheduleLoad();
}
function dimInnerHTML(dim){
  var vals = st.scope[dim] || [];
  var extra = vals.length === 1 ? labelOf(dim, vals[0]) : (vals.length > 1 ? "已选 " + vals.length + " 项" : "");
  return '<span class="k">' + esc(DIM_TITLES[dim]) + '</span>' +
    (extra ? '<span class="v" title="' + esc(extra) + '">' + esc(extra) + '</span>' : "") +
    '<span class="caret" aria-hidden="true"></span>';
}
function dimButtonHTML(dim){
  var on = (st.scope[dim] || []).length > 0;
  return '<button class="wc-dim' + (on ? " is-on" : "") + '" type="button" data-wc-dim="' + dim +
    '" aria-haspopup="dialog" aria-expanded="false" aria-label="筛选' + esc(DIM_TITLES[dim]) + '">' +
    dimInnerHTML(dim) + '</button>';
}
function syncDimButton(dim){
  var btn = document.querySelector('.wc-dim[data-wc-dim="' + dim + '"]');
  if(!btn) return;
  btn.innerHTML = dimInnerHTML(dim);
  btn.classList.toggle("is-on", (st.scope[dim] || []).length > 0);
}

/* ==================== 筛选栏 ==================== */
function chipHTML(label, key){
  return '<button class="wc-chip" type="button" data-wc-chip="' + key + '" aria-label="移除筛选：' + esc(label) + '">' +
    '<span class="t">' + esc(label) + '</span><span class="x" aria-hidden="true">' + icon("close", 10) + '</span></button>';
}
function shortJoin(names, max){
  var list = names.slice(0, max || 2);
  return list.join("、") + (names.length > list.length ? " 等 " + names.length + " 项" : "");
}
function dateSpan(from, to){
  var a = from ? fmtShortMD(parseDate(from)) : "";
  var b = to ? fmtShortMD(parseDate(to)) : "";
  if(a && b) return a + " ~ " + b;
  return a ? a + " 起" : b + " 止";
}
function chipsInnerHTML(){
  var s = st.scope, out = [];
  if(s.q) out.push(chipHTML("搜索 “" + (s.q.length > 16 ? s.q.slice(0, 16) + "…" : s.q) + "”", "q"));
  if(s.reqs.length) out.push(chipHTML("项目 · " + shortJoin(s.reqs.map(function(v){ return labelOf("reqs", v); })), "reqs"));
  if(s.pris.length) out.push(chipHTML("优先级 · " + shortJoin(s.pris.map(function(v){ return labelOf("pris", v); })), "pris"));
  if(s.owners.length) out.push(chipHTML("负责人 · " + shortJoin(s.owners.map(function(v){ return labelOf("owners", v); })), "owners"));
  if(s.due) out.push(chipHTML("到期 · " + dueLabel(s.due), "due"));
  if(s.noDue) out.push(chipHTML("未设截止", "noDue"));
  if(s.focus) out.push(chipHTML("今日聚焦", "focus"));
  if(s.blocked) out.push(chipHTML("只看被阻塞", "blocked"));
  if(s.dueFrom || s.dueTo) out.push(chipHTML("截止 " + dateSpan(s.dueFrom, s.dueTo), "dueRange"));
  if(s.startFrom || s.startTo) out.push(chipHTML("开始 " + dateSpan(s.startFrom, s.startTo), "startRange"));
  if(s.types.length) out.push(chipHTML("类型 · " + shortJoin(s.types.map(typeLabel)), "types"));
  if(s.cats.length) out.push(chipHTML("模块 · " + (s.cats.length === 1 ? labelOf("cats", s.cats[0]) : s.cats.length + " 项"), "cats"));
  if(s.tags.length) out.push(chipHTML("标签 · " + shortJoin(s.tags), "tags"));
  if(s.versions.length) out.push(chipHTML("版本 · " + (s.versions.length === 1 ? labelOf("versions", s.versions[0]) : s.versions.length + " 项"), "versions"));
  return out.join("");
}
function chipsHTML(){
  var inner = chipsInnerHTML();
  return '<div class="wc-chip-row' + (inner ? "" : " is-empty") + '" id="wcChips">' + inner + '</div>';
}
function syncChips(){
  var row = document.getElementById("wcChips");
  if(!row) return;
  var inner = chipsInnerHTML();
  row.innerHTML = inner;
  row.classList.toggle("is-empty", !inner);
}
function moreCount(s){
  var n = 0;
  ["types", "cats", "tags", "versions"].forEach(function(k){ if(s[k] && s[k].length) n += 1; });
  if(s.dueFrom || s.dueTo) n += 1;
  if(s.startFrom || s.startTo) n += 1;
  if(s.blocked) n += 1;
  return n;
}
function moreBits(s){
  var bits = [];
  ["types", "cats", "tags", "versions"].forEach(function(k){ if(s[k] && s[k].length) bits.push(DIM_TITLES[k]); });
  if(s.dueFrom || s.dueTo) bits.push("截止日期");
  if(s.startFrom || s.startTo) bits.push("开始日期");
  if(s.blocked) bits.push("只看被阻塞");
  return bits;
}
function moreButtonHTML(){
  var n = moreCount(st.scope);
  return '<span class="k">' + icon("filter", 14) + ' 更多筛选</span>' +
    (n ? '<b class="n">' + n + '</b>' : '') +
    '<span class="caret' + (st.moreOpen ? " up" : "") + '" aria-hidden="true"></span>';
}
function syncMoreButton(){
  var btn = document.querySelector("[data-wc-more]");
  if(!btn) return;
  btn.innerHTML = moreButtonHTML();
  btn.classList.toggle("is-on", moreCount(st.scope) > 0);
  btn.setAttribute("aria-expanded", st.moreOpen ? "true" : "false");
}
function dueSelectHTML(){
  var noDueOnly = isDone(st.col) || (st.data && st.data.overdueEnabled === false);
  var opts = noDueOnly ? [["none","未设截止"]] : DUE_OPTIONS.slice();
  var cur = st.scope.noDue ? "none" : (st.scope.due || "");
  var has = opts.some(function(o){ return o[0] === cur; });
  if(cur && !has) opts = opts.concat([[cur, dueLabel(cur)]]);
  return '<option value="">全部</option>' + opts.map(function(o){
    return '<option value="' + o[0] + '"' + (cur === o[0] ? " selected" : "") + '>' + esc(o[1]) + '</option>';
  }).join("");
}
function sortSelectHTML(){
  var list = SORTS[isDone(st.col) ? "done" : "open"];
  return list.map(function(k){
    return '<option value="' + k + '"' + (st.sort === k ? " selected" : "") + '>' + esc(SORT_LABELS[k]) + '</option>';
  }).join("");
}
function rangeSelectHTML(){
  return RANGE_OPTIONS.map(function(p){
    return '<option value="' + p[0] + '"' + (st.range === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>';
  }).join("");
}
function morePanelHTML(){
  var s = st.scope;
  var bits = moreBits(s);
  return '<div class="wc-filter-more' + (st.moreOpen ? " is-open" : "") + '" id="wcMore">' +
    '<div class="wc-more-grid">' +
      '<div class="wc-field"><span>类型</span>' + dimButtonHTML("types") + '</div>' +
      '<div class="wc-field"><span>模块</span>' + dimButtonHTML("cats") + '</div>' +
      '<div class="wc-field"><span>标签</span>' + dimButtonHTML("tags") + '</div>' +
      '<div class="wc-field"><span>版本</span>' + dimButtonHTML("versions") + '</div>' +
      '<div class="wc-field wc-field-wide"><span>截止日期</span><div class="wc-dates">' +
        '<input type="date" data-wc-date="dueFrom" value="' + esc(s.dueFrom) + '" aria-label="截止日期起">' +
        '<span class="sep">→</span>' +
        '<input type="date" data-wc-date="dueTo" value="' + esc(s.dueTo) + '" aria-label="截止日期止">' +
      '</div></div>' +
      '<div class="wc-field wc-field-wide"><span>开始日期</span><div class="wc-dates">' +
        '<input type="date" data-wc-date="startFrom" value="' + esc(s.startFrom) + '" aria-label="开始日期起">' +
        '<span class="sep">→</span>' +
        '<input type="date" data-wc-date="startTo" value="' + esc(s.startTo) + '" aria-label="开始日期止">' +
      '</div></div>' +
      '<div class="wc-field"><span>风险</span>' +
        '<button class="wc-toggle' + (s.blocked ? " is-on" : "") + '" type="button" data-wc-blocked aria-pressed="' + (s.blocked ? "true" : "false") + '">只看被阻塞</button>' +
      '</div>' +
    '</div>' +
    '<div class="wc-more-foot"><span class="wc-note">' +
      (bits.length ? "已启用：" + esc(bits.join("、")) + " · " : "") +
      '指标按当前筛选实时聚合 · 明细单次最多 ' + PAGE_SIZE + ' 条</span>' +
      '<button class="btn sm" type="button" data-wc-reset>清空筛选</button></div>' +
  '</div>';
}
function filtersHTML(){
  var done = isDone(st.col);
  var s = st.scope;
  return '<div class="wc-filters">' +
    '<div class="wc-filter-row">' +
      '<div class="wc-search">' + icon("search", 15) +
        '<input id="wcQ" type="search" data-wc-filter="q" value="' + esc(s.q) + '"' +
          ' placeholder="搜索标题 / 项目 / 负责人 / 标签" aria-label="搜索工作项" autocomplete="off" enterkeyhint="search">' +
        '<button class="wc-q-clear" type="button" data-wc-q-clear aria-label="清空搜索"' + (s.q ? "" : " hidden") + '>' + icon("close", 11) + '</button>' +
      '</div>' +
      dimButtonHTML("reqs") + dimButtonHTML("owners") + dimButtonHTML("pris") +
      '<label class="wc-inline"><span>到期</span><select data-wc-filter="due">' + dueSelectHTML() + '</select></label>' +
      '<button class="wc-more-btn' + (moreCount(s) ? " is-on" : "") + '" type="button" data-wc-more' +
        ' aria-expanded="' + (st.moreOpen ? "true" : "false") + '" aria-controls="wcMore">' + moreButtonHTML() + '</button>' +
      '<span class="wc-viewopts">' +
        (done ? '<label class="wc-inline"><span>完成时间</span><select data-wc-filter="range">' + rangeSelectHTML() + '</select></label>' : "") +
        '<label class="wc-inline"><span>排序</span><select data-wc-filter="sort">' + sortSelectHTML() + '</select></label>' +
        '<label class="wc-inline"><span>分组</span><select data-wc-filter="group">' + groupOptionsHTML(GROUP_OPTIONS, st.group) + '</select></label>' +
      '</span>' +
    '</div>' +
    chipsHTML() + morePanelHTML() +
  '</div>';
}

/* ==================== 分组与明细 ==================== */
function catName(t){ return catNameById(t.categoryId) || "未分类"; }
function groupKey(t, mode){
  if(mode === "project") return t.reqName || reqNameById(t.reqId) || "未归类项目";
  if(mode === "priority") return t.priority || "P2";
  if(mode === "category") return catName(t);
  return t.owner || "未分配";
}
function groupName(key, mode){
  if(mode === "priority") return key + " · " + ({P0:"紧急",P1:"高",P2:"中",P3:"低"}[key] || "");
  return key;
}
function groupRank(key, mode){
  if(mode === "priority") return PRI_RANK[key] == null ? 9 : PRI_RANK[key];
  if(key === "未分配" || key === "未归类项目" || key === "未分类") return 999;
  return 0;
}
function groupedRows(rows, mode){
  if(mode === "none") return [{ name:"", rows:rows, flat:true }];
  var map = new Map();
  rows.forEach(function(t){
    var key = groupKey(t, mode);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  return Array.from(map.keys()).sort(function(a, b){
    var r = groupRank(a, mode) - groupRank(b, mode);
    return r || String(a).localeCompare(String(b), "zh-CN");
  }).map(function(key){ return { name:groupName(key, mode), rows:map.get(key) }; });
}

function laneStats(d, rows){
  if(d.done){
    var late = rows.filter(function(t){ return t.completedAt && t.dueDate && t.completedAt > t.dueDate; }).length;
    return late
      ? '<span class="tag tag-warning">' + late + ' 项逾期完成</span>'
      : '<span class="tag tag-success">按截止完成</span>';
  }
  var over = rows.filter(function(t){ return dueState(t).kind === "over"; }).length;
  var blocked = rows.filter(function(t){ return t.blocked; }).length;
  return (over ? '<span class="tag tag-danger">逾期 ' + over + '</span>' : '<span class="tag tag-success">无逾期</span>')
    + (blocked ? '<span class="tag tag-warning">阻塞 ' + blocked + '</span>' : "");
}
function laneMeta(d, rows){
  if(d.done){
    var ds = rows.map(function(t){ return t.completedAt; }).filter(Boolean).sort();
    return ds.length ? "最近完成 " + fmtShortMD(parseDate(ds[ds.length - 1])) : "暂无完成记录";
  }
  var dues = rows.map(function(t){ return t.dueDate; }).filter(Boolean).sort();
  return dues.length ? "最近截止 " + fmtShortMD(parseDate(dues[0])) : "暂无截止日期";
}
function laneHeadHTML(g, d){
  return '<div class="wc-lane-head">' +
    '<span class="wc-lane-title">' + esc(g.name) + '</span>' +
    '<span class="wc-lane-count">' + g.rows.length + '</span>' +
    '<span class="wc-lane-meta">' + esc(laneMeta(d, g.rows)) + '</span>' +
    '<div class="wc-lane-stats">' + laneStats(d, g.rows) + '</div></div>';
}

function cardHTML(t, done){
  var s = dueState(t);
  var project = t.reqName || reqNameById(t.reqId) || "未归类项目";
  var module = catName(t);
  var tags = typeBadgeHTML(t.itemType);
  if(t.blocked) tags += '<span class="tag tag-warning" title="' + esc(t.blockedReason || "被阻塞") + '">被阻塞</span>';
  if(done && t.completedAt && t.dueDate && t.completedAt > t.dueDate) tags += '<span class="tag tag-warning">逾期完成</span>';
  if(!done && s.kind === "over") tags += '<span class="tag tag-danger">' + esc(dueText(t)) + '</span>';
  if(t.tags && t.tags.length) tags += tagChip(t.tags[0]);
  var foot = done
    ? '<span>完成 ' + esc(fmtShortMD(parseDate(t.completedAt))) + '</span>' +
      (t.createdAt && t.completedAt ? '<span>周期 ' + Math.max(0, dayDiff(parseDate(t.completedAt), parseDate(t.createdAt))) + ' 天</span>' : '')
    : '<span class="' + dueMetaClass(s.kind) + '">' + esc(dueText(t)) + '</span>' +
      '<span>' + (t.estimateMinutes
        ? '实际 ' + fmtMinutesShort(t.totalMinutes) + ' / 预估 ' + fmtMinutesShort(t.estimateMinutes)
        : '累计 ' + fmtMinutesShort(t.totalMinutes)) + '</span>';
  return '<article class="card wc-card" data-wc-task="' + esc(t.id) + '" tabindex="0" role="listitem" aria-label="' + esc(t.title) + '">' +
    '<div class="card-head"><span class="pri-mark">' + priTagHTML(t.priority, null, false) + '</span>' +
      '<h3 class="card-title">' + esc(t.title) + '</h3></div>' +
    '<div class="card-meta"><span>' + esc(project) + (module ? " · " + esc(module) : "") + '</span>' +
      '<span class="wc-who" title="负责人：' + esc(t.owner || "未分配") + '">' + avatarHTML(t.owner || "未分配") +
      '<span>' + esc(t.owner || "未分配") + '</span></span></div>' +
    '<div class="card-tags">' + tags + '</div>' +
    '<div class="card-foot wc-foot">' + foot + '<span class="wc-open">查看详情 →</span></div>' +
  '</article>';
}

/* 列表形态：字段与卡片同源，只是把标签行压成列；表头只在整表上方出现一次，分组以内嵌泳道头区分。
   列宽沿用 task-list 词表，两组列的 min 之和都压在 960 以内，1280 视口不横向滚动。 */
var WC_COL_DEFS = {
  title:{ label:"工作项", w:"minmax(176px,2.4fr)", min:176 },
  type:{ label:"类型", w:"80px", min:80 },
  priority:{ label:"优先级", w:"72px", min:72, sort:"priority" },
  owner:{ label:"负责人", w:"96px", min:96 },
  due:{ label:"截止", w:"108px", min:108, sort:"due" },
  completed:{ label:"完成", w:"92px", min:92, sort:"completed", align:"right" },
  cycle:{ label:"周期", w:"72px", min:72, align:"right" },
  work:{ label:"工时", w:"minmax(120px,1.1fr)", min:120, align:"right" },
  risk:{ label:"风险", w:"84px", min:84 },
  tag:{ label:"标签", w:"104px", min:104 }
};
/* 排序方向由服务端 SQL 固定（完成/更新倒序，截止/优先级正序），表头只切列、不翻转方向 */
var WC_SORT_DIR = { completed:"desc", updated:"desc", priority:"asc", due:"asc" };
var WC_LIST_COLS = {
  open:["title","type","priority","owner","due","work","risk","tag"],
  done:["title","type","priority","owner","completed","cycle","work","risk","tag"]
};
function wcCols(d, mode){
  var keys = (d.done ? WC_LIST_COLS.done : WC_LIST_COLS.open).slice();
  /* 分组泳道的标题就是该维度，行内不再重复一列 */
  if(mode === "owner") keys = keys.filter(function(k){ return k !== "owner"; });
  if(mode === "priority") keys = keys.filter(function(k){ return k !== "priority"; });
  return keys.map(function(k){
    var def = WC_COL_DEFS[k];
    return { key:k, label:def.label, w:def.w, align:def.align || "", sort:def.sort || "" };
  });
}
function wcListMinW(cols){
  return cols.reduce(function(n, c){ return n + WC_COL_DEFS[c.key].min; }, 0) + (cols.length - 1) * 8;
}
function wcHeadCellHTML(c, cs){
  var cls = c.align === "right" ? ' class="ta-r"' : '';
  if(!c.sort) return '<span' + cls + '>' + esc(c.label) + '</span>';
  var active = cs.sort === c.sort;
  var desc = WC_SORT_DIR[c.sort] === "desc";
  return '<span aria-sort="' + (active ? (desc ? "descending" : "ascending") : "none") + '"' + cls + '>' +
    '<button class="lh-sort' + (active ? " on" : "") + '" type="button" data-wc-sort="' + c.sort + '"' +
      ' title="按「' + esc(c.label) + '」排序">' + esc(c.label) +
      '<i class="lh-ind" aria-hidden="true">' + (active ? (desc ? "↓" : "↑") : "") + '</i></button></span>';
}
function wcRowHTML(t, done, mode, cols){
  return '<div class="list-row wc-row" data-wc-task="' + esc(t.id) + '" tabindex="0" role="listitem" aria-label="' + esc(t.title) + '">' +
    cols.map(function(c){
      return '<span class="cell wcl-' + c.key + (c.align === "right" ? " ta-r" : "") + '">' + wcCell(t, c.key, done, mode) + '</span>';
    }).join("") +
    '</div>';
}
function wcSubtitle(t, mode){
  var parts = [];
  if(mode !== "project") parts.push(t.reqName || reqNameById(t.reqId) || "未归类项目");
  if(mode !== "category"){
    var module = catName(t);
    if(module) parts.push(module);
  }
  return parts.join(" · ");
}
function wcCell(t, key, done, mode){
  /* 无值就留白，不用「—」占位 */
  var none = "";
  if(key === "title"){
    var sub = wcSubtitle(t, mode);
    return '<span class="wcl-t" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
      (sub ? '<span class="wcl-sub" title="' + esc(sub) + '">' + esc(sub) + '</span>' : '');
  }
  if(key === "type") return typeBadgeHTML(t.itemType) || '<span class="mini-tag mute">' + esc(typeName(t.itemType)) + '</span>';
  if(key === "priority") return priTagHTML(t.priority || "P2");
  if(key === "owner") return '<span class="wcl-who" title="负责人：' + esc(t.owner || "未分配") + '">' +
    avatarHTML(t.owner || "未分配") + '<span>' + esc(t.owner || "未分配") + '</span></span>';
  if(key === "due"){
    if(done || !t.dueDate) return none;
    return '<span class="' + dueMetaClass(dueState(t).kind) + '">' + esc(dueText(t)) + '</span>';
  }
  if(key === "completed") return t.completedAt ? esc(fmtShortMD(parseDate(t.completedAt))) : none;
  if(key === "cycle"){
    if(!t.createdAt || !t.completedAt) return none;
    return esc(Math.max(0, dayDiff(parseDate(t.completedAt), parseDate(t.createdAt))) + " 天");
  }
  if(key === "work") return esc(t.estimateMinutes
    ? '实际 ' + fmtMinutesShort(t.totalMinutes) + ' / 预估 ' + fmtMinutesShort(t.estimateMinutes)
    : '累计 ' + fmtMinutesShort(t.totalMinutes));
  if(key === "risk"){
    if(t.blocked) return '<span class="tag tag-warning" title="' + esc(t.blockedReason || "被阻塞") + '">被阻塞</span>';
    /* 未完成的逾期已在「截止」列标红，风险列不再重复一次 */
    if(done && t.completedAt && t.dueDate && t.completedAt > t.dueDate) return '<span class="tag tag-warning">逾期完成</span>';
    return none;
  }
  if(key === "tag") return t.tags && t.tags.length ? tagChip(t.tags[0]) : none;
  return none;
}
function wcListHTML(groups, d, mode, cs){
  var cols = wcCols(d, mode);
  return '<div class="wc-list" style="--wc-cols:' + cols.map(function(c){ return c.w; }).join(" ") +
    ';--wc-min:' + wcListMinW(cols) + 'px"><div class="list-head">' +
    cols.map(function(c){ return wcHeadCellHTML(c, cs); }).join("") + '</div>' +
    groups.map(function(g){
      var rows = '<div class="wc-lane-rows" role="list">' +
        g.rows.map(function(t){ return wcRowHTML(t, d.done, mode, cols); }).join("") + '</div>';
      if(g.flat) return '<div class="wc-lane wc-flat">' + rows + '</div>';
      return '<section class="wc-lane wc-lane-list">' + laneHeadHTML(g, d) + rows + '</section>';
    }).join("") + '</div>';
}

/* ==================== 页头与结果区 ==================== */
function tabDefs(){
  if(st.tabs && st.tabs.length) return st.tabs;
  return COLUMNS.map(function(c){
    return { id:c.id, name:c.name, color:c.color, done:!!c.done, count:0 };
  });
}
function currentTitle(){
  if(st.data) return st.data.columnName;
  var tabs = tabDefs();
  for(var i = 0; i < tabs.length; i++){
    if(tabs[i].id === st.col) return tabs[i].name || colName(st.col);
  }
  return colName(st.col);
}
function totalTextOf(d){
  if(!d) return "";
  var total = resultTotal(d);
  var base;
  if(d.done){
    base = d.range === "all"
      ? "全部历史 " + d.rangeTotal + " 项"
      : rangeLabel(d.range) + " " + d.rangeTotal + " 项";
    var doneTab = (d.columns || []).filter(function(t){ return t.id === DONE_COL; })[0];
    if(doneTab && doneTab.allTotal != null && d.range !== "all") base += " · 历史共 " + doneTab.allTotal + " 项";
  }else{
    base = d.rangeTotal + " 项";
  }
  if(scopeActive(st.scope) || total !== d.rangeTotal) base += " · 筛选命中 " + total + " 项";
  return base;
}
function headHTML(){
  var d = st.data;
  var tabs = tabDefs();
  var title = currentTitle();
  var rule = COLUMN_RULES[st.col] || DEFAULT_RULE;
  var totalText = totalTextOf(d);
  var activeTotal = d && scopeActive(st.scope) ? resultTotal(d) : null;
  return '<header class="wc-head"><div class="wc-head-top">' +
    '<button class="wc-back" type="button" data-wc-back>' + icon("left", 13) + ' 看板</button>' +
    '<h1 class="wc-title">' + esc(title) + '</h1>' +
    '<span class="tag tag-primary wc-title-tag">状态工作页</span>' +
    '<button class="icon-btn sm wc-rule-btn" type="button" data-wc-rule aria-label="查看列说明" data-tip="' + esc(rule) + '">' + icon("helpCircle", 15) + '</button>' +
    '<span class="sp"></span>' +
    (totalText ? '<span class="wc-total">' + esc(totalText) + '</span>' : "") +
    '<button class="icon-btn sm" type="button" data-wc-refresh title="刷新当前列" aria-label="刷新当前列">' + icon("refresh", 15) + '</button>' +
    '</div>' +
    '<nav class="wc-tabs" aria-label="切换看板列">' + tabs.map(function(t){
      var on = t.id === st.col;
      var tabTitle = "";
      if(t.id === DONE_COL && t.allTotal != null){
        tabTitle = d && d.range === "all"
          ? "历史共 " + t.allTotal + " 项"
          : rangeLabel(d ? d.range : st.range) + " " + (t.count || 0) + " 项 · 历史共 " + t.allTotal + " 项";
      }
      if(on && activeTotal != null) tabTitle = "筛选命中 " + activeTotal + " 项" + (tabTitle ? " · " + tabTitle : "");
      /* 每个页签都是一次真实导航（URL 随列变化），用 aria-current 比 tablist 更准确 */
      return '<button class="wc-tab' + (on ? " on" : "") + '" type="button"' + (on ? ' aria-current="page"' : "") +
        ' data-wc-col="' + esc(t.id) + '"' + (tabTitle ? ' title="' + esc(tabTitle) + '"' : "") + '>' +
        '<i class="dot" style="background:' + esc(t.color || "var(--border-strong)") + '"></i>' +
        esc(t.name) + '<b>' + (t.count || 0) + '</b></button>';
    }).join("") + '</nav></header>';
}
function toolbarHTML(d, total){
  var notes = ['当前显示 <b>' + st.rows.length + ' / ' + total + '</b> 条'];
  if(d.done) notes.unshift(rangeLabel(d.range) + ' <b>' + d.rangeTotal + '</b> 条');
  if(st.group !== "none") notes.push('按' + groupLabel(st.group) + '分组');
  if(d.range === "all") notes.push('全部历史仅分页查明细，指标按近 90 天');
  return '<div class="wc-result">' +
    notes.map(function(n){ return '<span>' + n + '</span>'; }).join('<span class="note">·</span>') +
    '<span class="sp"></span>' +
    (isMobile() ? "" : wcLayoutSegHTML() + (wcListMode() ? listDensitySegHTML() : "")) +
  '</div>';
}
function resultsHTML(){
  if(st.error){
    return '<div class="wc-empty"><h3>加载失败</h3><p>' + esc(st.error) + '</p>' +
      '<button class="btn" type="button" data-wc-retry>重试</button></div>';
  }
  if(!st.data){
    return '<div class="wc-skel"><div class="skel" style="height:88px;border-radius:var(--r-lg)"></div>' +
      '<div class="wc-skel">' + UI.skeletonCards(6) + '</div></div>';
  }
  var d = st.data;
  var total = resultTotal(d);
  var mode = st.group;
  var html = '<div class="wc-metrics">' + metricsHTML(d) + '</div>' + toolbarHTML(d, total);
  if(!st.rows.length){
    var filtered = scopeActive(st.scope);
    /* 时间窗本身为空时，清筛选也还是空：直接给下一步动作 */
    if(d.done && !d.rangeTotal){
      html += '<div class="wc-empty"><h3>' + esc(rangeLabel(d.range)) + '还没有完成项</h3>' +
        '<p>把「完成时间」切到本月、近 90 天或全部历史，再回看完成记录。</p></div>';
    }else{
      html += '<div class="wc-empty"><h3>' + (filtered ? "没有匹配的工作项" : "这一列还没有工作项") + '</h3>' +
        '<p>' + (filtered ? "调整筛选条件后再看，或清空筛选回到整列。" : (d.done ? "换个时间窗回看历史完成项。" : "从看板新建，或把卡片拖到这一列。")) + '</p>' +
        (filtered ? '<button class="btn" type="button" data-wc-reset>清空筛选</button>' : '') + '</div>';
    }
    return html;
  }
  var groups = groupedRows(st.rows, mode);
  if(wcListMode()){
    html += wcListHTML(groups, d, mode, st);
  }else{
    html += groups.map(function(g){
      var grid = '<div class="wc-lane-grid" role="list">' + g.rows.map(function(t){ return cardHTML(t, d.done); }).join("") + '</div>';
      return g.flat
        ? '<section class="wc-lane wc-flat">' + grid + '</section>'
        : '<section class="wc-lane">' + laneHeadHTML(g, d) + grid + '</section>';
    }).join("");
  }
  if(d.hasMore && st.rows.length < total){
    html += '<button class="wc-loadmore" type="button" data-wc-loadmore' + (st.loading ? ' disabled' : '') + '>' +
      (st.loading ? "加载中…" : "加载更多（已显示 " + st.rows.length + " / " + total + " 条）") + '</button>';
  }else if(st.rows.length < total){
    /* 翻页期间他处改动会让排序位移、去重后条数对不上；offset 已越过被跳过的行，继续翻页无效，改为引导刷新 */
    html += '<button class="wc-loadmore-note" type="button" data-wc-refresh>列表有更新，已显示 ' + st.rows.length + ' / ' + total + ' 条 · 点击刷新重载</button>';
  }
  return html;
}

function renderAll(){
  var el = document.getElementById("workcolumnBody");
  if(!el) return;
  el.innerHTML = headHTML() + '<div class="wc-body">' +
    '<div id="wcFilters">' + filtersHTML() + '</div>' +
    '<div class="wc-results" id="wcResults">' + resultsHTML() + '</div>' +
    '</div>';
  UI.wireTooltips(el);
  syncStickyTop();
  /* 头部整段重建会把页签的 scrollLeft 归零，必须重新居中（不能走同列缓存） */
  centerActiveTab();
  restoreTabFocus(el);
}
function renderFilters(){
  var host = document.getElementById("wcFilters");
  if(!host) return;
  host.innerHTML = filtersHTML();
  UI.wireTooltips(host);
  syncStickyTop();
}
function renderResults(){
  var host = document.getElementById("wcResults");
  if(!host) return;
  host.innerHTML = resultsHTML();
  host.classList.toggle("is-busy", st.loading);
  UI.wireTooltips(host);
  syncStickyTop();
}
function setBusy(on){
  var host = document.getElementById("wcResults");
  if(host) host.classList.toggle("is-busy", !!on);
}
function syncHead(){
  var el = document.getElementById("workcolumnBody");
  if(!el) return;
  var header = el.querySelector(".wc-head");
  if(!header) return;
  header.outerHTML = headHTML();
  UI.wireTooltips(el.querySelector(".wc-head") || el);
  syncStickyTop();
  centerActiveTab();
  restoreTabFocus(el);
}
/* 窄屏页签横向滚动：当前列可能在可视区外，换列后把它居中，避免"点进来却看不出在哪一列" */
function centerActiveTab(){
  var tabsEl = document.querySelector("#workcolumnBody .wc-tabs");
  if(!tabsEl || !tabsEl.clientWidth) return;
  var on = tabsEl.querySelector(".wc-tab.on");
  if(!on) return;
  var tr = tabsEl.getBoundingClientRect(), or = on.getBoundingClientRect();
  if(or.left >= tr.left - 1 && or.right <= tr.right + 1) return;
  tabsEl.scrollLeft += (or.left - tr.left) - (tr.width - or.width) / 2;
}
function restoreTabFocus(el){
  if(!refocusTab) return;
  var on = el.querySelector(".wc-tab.on");
  if(!on) return;
  try{ on.focus({preventScroll:true}); }catch(e){ on.focus(); }
  if(st.data) refocusTab = false;
}
function syncQClear(){
  var btn = document.querySelector("[data-wc-q-clear]");
  if(btn) btn.hidden = !st.scope.q;
}
function syncFilterBits(){
  SCOPE_LIST_KEYS.forEach(syncDimButton);
  syncMoreButton();
  syncChips();
  syncQClear();
  var due = document.querySelector('select[data-wc-filter="due"]');
  if(due) due.value = st.scope.noDue ? "none" : (st.scope.due || "");
  var blocked = document.querySelector("[data-wc-blocked]");
  if(blocked){
    blocked.classList.toggle("is-on", st.scope.blocked);
    blocked.setAttribute("aria-pressed", st.scope.blocked ? "true" : "false");
  }
  var q = document.getElementById("wcQ");
  if(q && q.value !== (st.scope.q || "")) q.value = st.scope.q || "";
}

/* 列表表头要贴在页头下方：页头高度随标题与换行变化，渲染后与窗口变化后各量一次 */
function syncStickyTop(){
  var el = document.getElementById("workcolumnBody");
  if(!el) return;
  var list = el.querySelector(".wc-list");
  if(!list) return;
  var head = el.querySelector(".wc-head");
  list.style.setProperty("--wc-sticky-top", (head ? head.offsetHeight : 0) + "px");
}

/* ==================== 交互 ==================== */
function scheduleLoad(delay){
  clearTimeout(st.scopeTimer);
  st.scopeTimer = setTimeout(function(){ load(true, true); }, delay == null ? 180 : delay);
}
function applyScopeChange(opts){
  st.offset = 0;
  if(opts && opts.rebuild) renderFilters();
  else syncFilterBits();
  syncRoute(false);
  scheduleLoad();
}
function clearScopeKey(key){
  if(key === "q") st.scope.q = "";
  else if(key === "due"){ st.scope.due = ""; st.scope.noDue = false; }
  else if(key === "noDue") st.scope.noDue = false;
  else if(key === "focus") st.scope.focus = false;
  else if(key === "blocked") st.scope.blocked = false;
  else if(key === "dueRange"){ st.scope.dueFrom = ""; st.scope.dueTo = ""; }
  else if(key === "startRange"){ st.scope.startFrom = ""; st.scope.startTo = ""; }
  else if(Array.isArray(st.scope[key])) st.scope[key] = [];
  applyScopeChange({ rebuild:true });
}
function resetScope(){
  st.scope = emptyScope();
  st.offset = 0;
  renderFilters();
  syncRoute(false);
  scheduleLoad();
}
function fixDateRange(prefix){
  var from = st.scope[prefix + "From"];
  var to = st.scope[prefix + "To"];
  if(from && to && from > to){
    st.scope[prefix + "From"] = to;
    st.scope[prefix + "To"] = from;
  }
}
function switchCol(col){
  if(!col || col === st.col) return;
  st.col = col;
  st.range = normalizeRange(st.range);
  st.sort = normalizeSort(col, st.sort);
  /* 已完成列不累计逾期，截止期与「今日聚焦」这两个维度带过去只会得到空结果 */
  if(isDone(col)){ st.scope.due = ""; st.scope.focus = false; }
  st.data = null;
  st.rows = [];
  st.offset = 0;
  st.error = "";
  st.moreOpen = false;
  /* 整页重渲染会销毁被点的页签：标记一次，新页签渲染后把焦点接回去 */
  refocusTab = true;
  UI.closeAllPops();
  syncRoute(true);
  var view = document.getElementById("view-workcolumn");
  if(view) view.scrollTop = 0;
  load(true);
}
function toggleMore(){
  st.moreOpen = !st.moreOpen;
  var panel = document.getElementById("wcMore");
  if(panel) panel.classList.toggle("is-open", st.moreOpen);
  syncMoreButton();
  syncStickyTop();
}

var bodyEl = document.getElementById("workcolumnBody");
if(bodyEl){
  bodyEl.addEventListener("click", function(e){
    if(e.target.closest("[data-wc-back]")){
      window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"board" } }));
      return;
    }
    var tab = e.target.closest("[data-wc-col]");
    if(tab){ switchCol(tab.dataset.wcCol); return; }
    if(e.target.closest("[data-wc-refresh]")){ load(true, true); return; }
    if(e.target.closest("[data-wc-reset]")){ resetScope(); return; }
    if(e.target.closest("[data-wc-retry]")){ load(true); return; }
    if(e.target.closest("[data-wc-loadmore]")){ if(!st.loading) load(false); return; }
    var clearQ = e.target.closest("[data-wc-q-clear]");
    if(clearQ){
      st.scope.q = "";
      syncQClear();
      syncChips();
      syncRoute(false);
      var input = document.getElementById("wcQ");
      if(input){ input.value = ""; input.focus(); }
      scheduleLoad(0);
      return;
    }
    var chip = e.target.closest("[data-wc-chip]");
    if(chip){
      var chips = [].slice.call(document.querySelectorAll("#wcChips .wc-chip"));
      var chipAt = chips.indexOf(chip);
      clearScopeKey(chip.dataset.wcChip);
      /* chip 会被重渲染：焦点接到下一枚，删到空则落到「更多筛选」 */
      var leftChips = document.querySelectorAll("#wcChips .wc-chip");
      var nextFocus = leftChips[Math.min(chipAt, leftChips.length - 1)] || document.querySelector("[data-wc-more]");
      if(nextFocus) nextFocus.focus();
      return;
    }
    var dim = e.target.closest("[data-wc-dim]");
    if(dim){ openDimMenu(dim.dataset.wcDim, dim); return; }
    if(e.target.closest("[data-wc-more]")){ toggleMore(); return; }
    var blocked = e.target.closest("[data-wc-blocked]");
    if(blocked){
      st.scope.blocked = !st.scope.blocked;
      syncFilterBits();
      syncRoute(false);
      scheduleLoad();
      return;
    }
    var sortBtn = e.target.closest("[data-wc-sort]");
    if(sortBtn){
      if(st.sort !== sortBtn.dataset.wcSort){
        st.sort = normalizeSort(st.col, sortBtn.dataset.wcSort);
        st.offset = 0;
        syncRoute(false);
        load(true, true);
      }
      return;
    }
    var layout = e.target.closest("[data-wc-layout]");
    if(layout){ setWcLayout(layout.dataset.wcLayout); return; }
    var card = e.target.closest("[data-wc-task]");
    if(card){ openTaskById(card.dataset.wcTask); return; }
  });
  bodyEl.addEventListener("keydown", function(e){
    /* 搜索框回车立即生效，不必等 300ms 防抖 */
    if(e.key === "Enter" && e.target.closest && e.target.closest('input[data-wc-filter="q"]')){
      e.preventDefault();
      clearTimeout(st.qTimer);
      load(true, true);
      return;
    }
    if(e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest("[data-wc-task]");
    if(card){ e.preventDefault(); openTaskById(card.dataset.wcTask); }
  });
  bodyEl.addEventListener("change", function(e){
    var dateEl = e.target.closest("[data-wc-date]");
    if(dateEl){
      var dk = dateEl.dataset.wcDate;
      if(dk === "dueFrom" || dk === "dueTo") fixDateRange("due");
      if(dk === "startFrom" || dk === "startTo") fixDateRange("start");
      applyScopeChange({ rebuild:true });
      return;
    }
    var el = e.target.closest("[data-wc-filter]");
    if(!el) return;
    var key = el.dataset.wcFilter;
    if(key === "group"){
      st.group = normalizeGroup(el.value);
      syncRoute(false);
      renderResults();
      return;
    }
    if(key === "sort"){
      st.sort = normalizeSort(st.col, el.value);
      st.offset = 0;
      syncRoute(false);
      load(true, true);
      return;
    }
    if(key === "range"){
      st.range = normalizeRange(el.value);
      st.offset = 0;
      syncRoute(true);
      load(true, true);
      return;
    }
    if(key === "due"){
      if(el.value === "none"){ st.scope.noDue = true; st.scope.due = ""; }
      else { st.scope.noDue = false; st.scope.due = DUE_OPTIONS.some(function(o){ return o[0] === el.value; }) ? el.value : ""; }
      applyScopeChange();
      return;
    }
  });
  bodyEl.addEventListener("input", function(e){
    var el = e.target.closest('input[data-wc-filter="q"]');
    if(!el) return;
    st.scope.q = el.value.slice(0, 200);
    syncQClear();
    syncChips();
    syncRoute(false);
    clearTimeout(st.qTimer);
    st.qTimer = setTimeout(function(){ load(true, true); }, 300);
  });
}

document.addEventListener("click", function(e){
  if(!dimMenuEl || !UI.popOpen(dimMenuEl)) return;
  var opt = e.target.closest("[data-dim-opt]");
  if(opt){ toggleScopeValue(dimCur, opt.dataset.dimOpt, opt); return; }
  if(e.target.closest("[data-dim-clear]")){
    if(!dimCur) return;
    st.scope[dimCur] = [];
    st.offset = 0;
    renderDimMenu();
    syncDimButton(dimCur);
    syncChips();
    syncMoreButton();
    syncRoute(false);
    scheduleLoad();
    return;
  }
  if(e.target.closest("[data-dim-done]")){ if(dimClose) dimClose(false); }
});
document.addEventListener("input", function(e){
  if(!dimMenuEl || !UI.popOpen(dimMenuEl)) return;
  var input = e.target.closest("[data-dim-q]");
  if(!input) return;
  dimQ = input.value;
  renderDimMenu();
});

window.addEventListener("hashchange", function(){
  if(activeView === "workcolumn") refreshFromHash();
});
window.addEventListener("ds:reqs-loaded", function(){
  if(activeView === "workcolumn" && st.active) syncFilterBits();
});
window.addEventListener("ds:task-saved", function(){
  if(activeView !== "workcolumn" || !st.active) return;
  /* 状态或字段变化会影响当前列口径：静默重拉首屏，避免数字与卡片不一致 */
  load(true, true);
});
/* 跨断点重排：窄屏回落卡片形态并收起形态/密度切换器，回到宽屏再恢复上次的选择 */
window.addEventListener("ds:layout", function(){
  if(activeView !== "workcolumn" || !st.active) return;
  if(st.data) renderResults();
  else if(!st.loading) load(true);
  centerActiveTab();
});
/* 页头高度只在换行或尺寸变化时才变，量一次吸顶偏移即可 */
var wcStickyTimer = 0;
window.addEventListener("resize", function(){
  if(activeView !== "workcolumn" || !st.active) return;
  clearTimeout(wcStickyTimer);
  wcStickyTimer = setTimeout(function(){ syncStickyTop(); centerActiveTab(); }, 150);
});

export { enterWorkColumn, refreshFromHash };
