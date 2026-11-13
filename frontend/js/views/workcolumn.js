/* views/workcolumn · 工作项列状态工作页：时间窗、服务端聚合指标与分页明细 */

import { API } from "../core/api.js";
import { loadCategories } from "../core/app.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { dueMetaClass, dueState, dueText, reqNameById, rt, state, tagChip } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { ownerOptions } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { COLUMNS, avatarHTML, colMeta, colName, dayDiff, fmtMinutesShort, fmtShortMD, parseDate, priTagHTML, typeBadgeHTML, typeName } from "../lib/format.js";

var PAGE_SIZE = 100;
var DONE_COL = "done";
var DEFAULT_RANGE = "week";
var RANGE_OPTIONS = [["week","本周"],["month","本月"],["quarter","近 90 天"],["all","全部历史"]];
var GROUP_OPTIONS = [["owner","负责人"],["project","项目"],["priority","优先级"],["category","模块"]];
var TYPE_OPTIONS = [["story","需求"],["task","任务"],["bug","缺陷"],["epic","史诗"]];
var PRI_OPTIONS = ["P0","P1","P2","P3"];
var DUE_OPTIONS = [["over","已逾期"],["today","今天到期"],["soon","3 天内"],["none","未设截止"]];
var PRI_RANK = { P0:0, P1:1, P2:2, P3:3 };
var COLUMN_RULES = {
  backlog:"队列入口：先看未分配与超期未动的项，决定推进、重排还是关闭。",
  doing:"在制品：关注逾期、阻塞与工时消耗；同时开工过多时优先收敛队列。",
  test:"等待测试：等待时长比逾期更能说明交付缓冲是否被吃掉。",
  testing:"测试中：P0/P1 优先回归，阻塞会直接拖长本轮周期。",
  done:"已完成长期累积：默认只看本周，完整回看可切时间窗；看板只放最近 6 条。"
};
var DEFAULT_RULE = "当前列的队列、风险与工时消耗；统计在服务端聚合，明细分页加载。";

var st = {
  active:false,
  col:"",
  routeKey:"",
  seq:0,
  loading:false,
  timer:null,
  columns:{}
};

function colState(id){
  if(!st.columns[id]){
    st.columns[id] = {
      q:"", req:"", owner:"", pri:"", type:"", cat:"", due:"", blocked:false,
      sort: id === DONE_COL ? "completed" : "due",
      group: id === DONE_COL ? "project" : "owner",
      range: DEFAULT_RANGE,
      offset: 0,
      rows: [],
      data: null,
      error: ""
    };
  }
  return st.columns[id];
}
function currentCol(){ return st.col || "backlog"; }
function currentState(){ return colState(currentCol()); }
function isDone(col){ return col === DONE_COL; }
function normalizeRange(v){ return v === "month" || v === "quarter" || v === "all" ? v : DEFAULT_RANGE; }
function rangeLabel(v){
  for(var i = 0; i < RANGE_OPTIONS.length; i++) if(RANGE_OPTIONS[i][0] === v) return RANGE_OPTIONS[i][1];
  return "本周";
}
function groupLabel(v){
  for(var i = 0; i < GROUP_OPTIONS.length; i++) if(GROUP_OPTIONS[i][0] === v) return GROUP_OPTIONS[i][1];
  return "负责人";
}
function typeLabel(v){
  for(var i = 0; i < TYPE_OPTIONS.length; i++) if(TYPE_OPTIONS[i][0] === v) return TYPE_OPTIONS[i][1];
  return v || "任务";
}
function routeHash(col, range){
  var h = "#/workcolumn?col=" + encodeURIComponent(col);
  if(isDone(col)) h += "&range=" + encodeURIComponent(normalizeRange(range));
  return h;
}
function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "workcolumn") return null;
  var params = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  return { col: params.get("col") || "", range: params.get("range") || "" };
}
function setRouteHash(push, col, range){
  var h = routeHash(col || currentCol(), range || currentState().range);
  if(window.location.hash === h) return;
  try{
    if(push) history.pushState(null, "", h);
    else history.replaceState(null, "", h);
  }catch(e){ window.location.hash = h; }
}

function queryParams(cs, offset){
  var done = isDone(currentCol());
  return {
    col: currentCol(),
    range: done ? cs.range : null,
    sort: cs.sort,
    offset: offset,
    limit: PAGE_SIZE,
    q: cs.q || null,
    reqs: cs.req || null,
    owners: cs.owner || null,
    pris: cs.pri || null,
    types: cs.type || null,
    cats: cs.cat || null,
    due: cs.due && cs.due !== "none" ? cs.due : null,
    noDue: cs.due === "none" ? 1 : null,
    blocked: cs.blocked ? 1 : null
  };
}

function load(reset, quiet){
  var col = currentCol();
  var cs = colState(col);
  if(reset){
    cs.offset = 0;
    cs.rows = [];
    cs.data = null;
    cs.error = "";
  }
  var seq = ++st.seq;
  st.loading = true;
  if(!quiet) render();
  API.get("/api/tasks/workpage", queryParams(cs, reset ? 0 : cs.offset)).then(function(data){
    if(seq !== st.seq) return;
    st.loading = false;
    var resolved = data.column || col;
    if(resolved !== col){
      st.col = resolved;
      cs = colState(resolved);
    }
    st.routeKey = resolved + "|" + (isDone(resolved) ? cs.range : "");
    /* 追问「加载更多」的响应不带指标，沿用首屏结果 */
    var prevMetrics = cs.data && cs.data.metrics;
    cs.data = data;
    if(!reset && prevMetrics) data.metrics = prevMetrics;
    cs.error = "";
    var items = data.items || [];
    if(reset){
      cs.rows = items;
    }else{
      var known = {};
      cs.rows.forEach(function(t){ known[t.id] = 1; });
      items.forEach(function(t){ if(!known[t.id]){ cs.rows.push(t); known[t.id] = 1; } });
    }
    cs.offset = cs.rows.length;
    setRouteHash(false, resolved, cs.range);
    if(activeView === "workcolumn" && st.active) render();
  }).catch(function(ex){
    if(seq !== st.seq) return;
    st.loading = false;
    if(cs.data){
      toast("加载失败：" + (ex.message || "网络异常"), "bad");
    }else{
      cs.error = ex.message || "网络异常，请稍后重试";
    }
    if(activeView === "workcolumn" && st.active) render();
  });
}

function enterWorkColumn(){
  st.active = true;
  var route = parseRoute();
  if(!route){ st.active = false; return; }
  var col = route.col || "backlog";
  st.col = col;
  var cs = colState(col);
  if(route.range) cs.range = normalizeRange(route.range);
  st.routeKey = col + "|" + (isDone(col) ? cs.range : "");
  loadCategories().then(function(){ if(activeView === "workcolumn") render(); });
  load(true);
}
function refreshFromHash(){
  if(activeView !== "workcolumn") return;
  var route = parseRoute();
  if(!route) return;
  var col = route.col || "backlog";
  var cs = colState(col);
  if(route.range) cs.range = normalizeRange(route.range);
  var key = col + "|" + (isDone(col) ? cs.range : "");
  if(key === st.routeKey && cs.data) return;
  st.routeKey = key;
  st.col = col;
  load(true);
}

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
      + metric("平均周期", (m.avgAgeDays == null ? "—" : m.avgAgeDays + " 天"), "创建到完成，按当前时间窗")
      + metric("逾期完成", (m.lateCompleted || 0) + " 项", dueNote, (m.lateCompleted || 0) ? "warn" : "ok")
      + timeMetric(m)
      + metric("最近完成", m.lastCompletedAt ? fmtShortMD(parseDate(m.lastCompletedAt)) : "—", "按完成日期");
  }
  return metric("当前列", (d.matched || 0) + " 项", "叠加筛选后的条数")
    + (d.overdueEnabled === false
      ? metric("已逾期", "—", "该列不累计逾期")
      : metric("已逾期", (m.overdue || 0) + " 项",
        m.overdue ? "优先确认是否可关闭或改期" : "当前结果无逾期",
        m.overdue ? "bad" : "ok"))
    + metric("被阻塞", (m.blocked || 0) + " 项",
      m.blocked ? "需先解除依赖" : "当前结果无阻塞",
      m.blocked ? "warn" : "ok")
    + metric("高优先级", (m.high || 0) + " 项", "P0 / P1 优先推进", m.high ? "warn" : "")
    + timeMetric(m);
}

function uniqueSorted(list){
  var seen = {}, out = [];
  (list || []).forEach(function(v){
    var s = String(v == null ? "" : v).trim();
    if(!s || seen[s]) return;
    seen[s] = 1;
    out.push(s);
  });
  return out.sort(function(a, b){ return a.localeCompare(b, "zh-CN"); });
}
function ownerNames(){
  var meta = state.board && state.board.meta;
  if(meta && meta.owners && meta.owners.length){
    return uniqueSorted(meta.owners.map(function(o){ return o.name; }));
  }
  try{ return uniqueSorted(ownerOptions("").map(function(o){ return o.name; })); }
  catch(e){ return []; }
}
function reqOptions(selected){
  var list = uniqueSorted((rt.reqList || []).map(function(r){ return r.name; }));
  var html = '<option value="">全部项目</option>';
  list.forEach(function(name){
    var hit = (rt.reqList || []).filter(function(r){ return r.name === name; })[0];
    var value = hit ? hit.id : name;
    html += '<option value="' + esc(value) + '"' + (selected === value ? " selected" : "") + '>' + esc(name) + '</option>';
  });
  html += '<option value="__none"' + (selected === "__none" ? " selected" : "") + '>未归类</option>';
  return html;
}
function catOptions(selected){
  var html = '<option value="">全部模块</option>';
  (rt.categoriesCache || []).slice().sort(function(a, b){ return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"); })
    .forEach(function(c){
      html += '<option value="' + esc(c.id) + '"' + (selected === c.id ? " selected" : "") + '>' + esc(c.name) + '</option>';
    });
  return html;
}
function optionHTML(pairs, selected, allLabel){
  var html = '<option value="">' + esc(allLabel) + '</option>';
  pairs.forEach(function(p){
    html += '<option value="' + esc(p[0]) + '"' + (selected === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>';
  });
  return html;
}
function filterSelect(label, key, html, active){
  return '<label class="wc-field"><span>' + esc(label) + '</span>' +
    '<select data-wc-filter="' + key + '"' + (active ? ' class="is-on"' : '') + '>' + html + '</select></label>';
}
function filtersHTML(d, cs){
  var done = d.done;
  var sortPairs = done
    ? [["completed","完成时间"],["due","截止日期"],["priority","优先级"],["updated","更新时间"]]
    : [["due","截止日期"],["priority","优先级"],["updated","更新时间"]];
  var html = '<div class="wc-filters">' +
    '<label class="wc-field"><span>搜索</span><input id="wcQ" type="search" data-wc-filter="q" value="' + esc(cs.q) +
      '" placeholder="标题 / 项目 / 负责人 / 标签"' + (cs.q ? ' class="is-on"' : '') + '></label>';
  if(done){
    var rangeSel = '<select data-wc-filter="range"' + (cs.range !== DEFAULT_RANGE ? ' class="is-on"' : '') + '>';
    RANGE_OPTIONS.forEach(function(p){
      rangeSel += '<option value="' + p[0] + '"' + (cs.range === p[0] ? " selected" : "") + '>' + esc(p[1]) + '</option>';
    });
    rangeSel += '</select>';
    html += '<label class="wc-field"><span>完成时间</span>' + rangeSel + '</label>';
  }
  html += filterSelect("项目", "req", reqOptions(cs.req), !!cs.req)
    + filterSelect("负责人", "owner", optionHTML(ownerNames().map(function(n){ return [n, n]; }), cs.owner, "全部负责人"), !!cs.owner)
    + filterSelect("优先级", "pri", optionHTML(PRI_OPTIONS.map(function(p){ return [p, p]; }), cs.pri, "全部优先级"), !!cs.pri)
    + filterSelect("类型", "type", optionHTML(TYPE_OPTIONS, cs.type, "全部类型"), !!cs.type)
    + filterSelect("模块", "cat", catOptions(cs.cat), !!cs.cat)
    /* 已完成列与已结束列不累计逾期，截止筛选只留「未设截止」 */
    + filterSelect("截止", "due", optionHTML(done || d.overdueEnabled === false ? [["none","未设截止"]] : DUE_OPTIONS, cs.due, "全部"), !!cs.due)
    + '<div class="wc-field"><span>风险</span><button class="wc-toggle" type="button" data-wc-blocked aria-pressed="' +
      (cs.blocked ? "true" : "false") + '">只看被阻塞</button></div>'
    + filterSelect("排序", "sort", optionHTML(sortPairs, cs.sort, "默认顺序").replace('<option value="">默认顺序</option>', ''), false)
    + filterSelect("分组", "group", optionHTML(GROUP_OPTIONS, cs.group, "不分组").replace('<option value="">不分组</option>', ''), false)
    + '<div class="wc-actions"><span class="wc-note">指标与统计按当前筛选实时聚合 · 明细单次最多 ' + PAGE_SIZE + ' 条</span>' +
      '<button class="btn sm" type="button" data-wc-reset>清空筛选</button></div>'
    + '</div>';
  return html;
}

function groupKey(t, mode){
  if(mode === "project") return t.reqName || reqNameById(t.reqId) || "未归类项目";
  if(mode === "priority") return t.priority || "P2";
  if(mode === "category") return catName(t);
  return t.owner || "未分配";
}
function catName(t){ return catNameById(t.categoryId) || "未分类"; }
function catNameById(id){
  if(!id) return "";
  for(var i = 0; i < rt.categoriesCache.length; i++){
    if(rt.categoriesCache[i].id === id) return rt.categoriesCache[i].name;
  }
  return "";
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
  var map = new Map();
  rows.forEach(function(t){
    var key = groupKey(t, mode);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  });
  return Array.from(map.keys()).sort(function(a, b){
    var r = groupRank(a, mode) - groupRank(b, mode);
    return r || String(a).localeCompare(String(b), "zh-CN");
  }).map(function(key){ return { name: groupName(key, mode), rows: map.get(key) }; });
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
    '<div class="card-head"><span class="pri-mark">' + priTagHTML(t.priority, null, true) + '</span>' +
      '<h3 class="card-title">' + esc(t.title) + '</h3></div>' +
    '<div class="card-meta"><span>' + esc(project) + (module ? " · " + esc(module) : "") + '</span>' +
      '<span class="wc-who" title="负责人：' + esc(t.owner || "未分配") + '">' + avatarHTML(t.owner || "未分配") +
      '<span>' + esc(t.owner || "未分配") + '</span></span></div>' +
    '<div class="card-tags">' + tags + '</div>' +
    '<div class="card-foot wc-foot">' + foot + '<span class="wc-open">查看详情 →</span></div>' +
  '</article>';
}

function bodyHTML(d, cs){
  if(cs.error){
    return '<div class="wc-empty"><h3>加载失败</h3><p>' + esc(cs.error) + '</p>' +
      '<button class="btn" type="button" data-wc-retry>重试</button></div>';
  }
  if(!d){
    return '<div class="wc-skel"><div class="skel" style="height:86px;border-radius:var(--r-lg)"></div>' +
      '<div class="wc-skel">' + UI.skeletonCards(6) + '</div></div>';
  }
  var mode = cs.group;
  var groups = groupedRows(cs.rows, mode);
  var html = '<div class="wc-intro"><h2>' + esc(d.columnName) + ' · ' + esc(isDone(d.column) ? "完成回看" : "队列与风险") + '</h2>' +
    '<p class="wc-rule">' + esc(COLUMN_RULES[d.column] || DEFAULT_RULE) + '</p></div>' +
    '<div class="wc-metrics">' + metricsHTML(d) + '</div>' +
    filtersHTML(d, cs);

  var notes = ['当前显示 <b>' + cs.rows.length + ' / ' + (d.matched || 0) + '</b> 条'];
  if(d.done) notes.unshift(rangeLabel(d.range) + ' <b>' + d.rangeTotal + '</b> 条');
  if(mode) notes.push('按' + groupLabel(mode) + '分组（已加载）');
  if(d.range === "all") notes.push('全部历史仅分页查明细，指标按近 90 天');
  html += '<div class="wc-result">' + notes.map(function(n){ return '<span>' + n + '</span>'; }).join('<span class="note">·</span>') + '</div>';

  if(!cs.rows.length){
    var filtered = cs.q || cs.req || cs.owner || cs.pri || cs.type || cs.cat || cs.due || cs.blocked;
    html += '<div class="wc-empty"><h3>' + (filtered ? "没有匹配的工作项" : "这一列还没有工作项") + '</h3>' +
      '<p>' + (filtered ? "调整筛选条件后再看，或清空筛选回到整列。" : (d.done ? "换个时间窗回看历史完成项。" : "从看板新建，或把卡片拖到这一列。")) + '</p>' +
      (filtered ? '<button class="btn" type="button" data-wc-reset>清空筛选</button>' : '') + '</div>';
    return html;
  }

  groups.forEach(function(g){
    html += '<section class="wc-lane"><div class="wc-lane-head">' +
      '<span class="wc-lane-title">' + esc(g.name) + '</span>' +
      '<span class="wc-lane-count">' + g.rows.length + '</span>' +
      '<span class="wc-lane-meta">' + esc(laneMeta(d, g.rows)) + '</span>' +
      '<div class="wc-lane-stats">' + laneStats(d, g.rows) + '</div></div>' +
      '<div class="wc-lane-grid">' + g.rows.map(function(t){ return cardHTML(t, d.done); }).join("") + '</div></section>';
  });
  if(d.hasMore){
    html += '<button class="wc-loadmore" type="button" data-wc-loadmore' + (st.loading ? ' disabled' : '') + '>' +
      (st.loading ? "加载中…" : "加载更多（已显示 " + cs.rows.length + " / " + d.matched + " 条）") + '</button>';
  }else if(cs.rows.length < d.matched){
    /* 翻页期间他处改动会让排序位移、去重后条数对不上；offset 已越过被跳过的行，继续翻页无效，改为引导刷新 */
    html += '<button class="wc-loadmore-note" type="button" data-wc-refresh>列表有更新，已显示 ' + cs.rows.length + ' / ' + d.matched + ' 条 · 点击刷新重载</button>';
  }
  return html;
}

function headHTML(d, cs){
  var col = d ? d.column : currentCol();
  var tabs = d && d.columns && d.columns.length ? d.columns : COLUMNS.map(function(c){
    return { id:c.id, name:c.name, color:c.color, done:!!c.done, count:0 };
  });
  var title = d ? d.columnName : colName(col);
  var totalText = "—";
  if(d){
    var doneTab = tabs.filter(function(t){ return t.id === DONE_COL; })[0];
    var hit = d.matched !== d.rangeTotal ? " · 筛选命中 " + d.matched + " 项" : "";
    totalText = d.done
      ? (d.range === "all"
          ? "全部历史 " + d.rangeTotal + " 项"
          : rangeLabel(d.range) + " " + d.rangeTotal + " 项"
            + (doneTab && doneTab.allTotal != null ? " · 历史共 " + doneTab.allTotal + " 项" : "")) + hit
      : (d.rangeTotal + " 项工作项" + hit);
  }
  return '<header class="wc-head"><div class="wc-head-top">' +
    '<button class="wc-back" type="button" data-wc-back>' + icon("left", 13) + ' 返回工作项看板</button>' +
    '<span class="wc-crumbs">工作项 / ' + esc(title) + '</span>' +
    '<span class="sp"></span>' +
    '<button class="icon-btn sm" type="button" data-wc-refresh title="刷新当前列" aria-label="刷新当前列">' + icon("refresh", 15) + '</button>' +
    '</div><div class="wc-title-row"><h1 class="wc-title">' + esc(title) + '</h1>' +
      '<span class="tag tag-primary wc-title-tag">状态工作页</span>' +
      '<span class="wc-total">' + esc(totalText) + '</span></div>' +
    '<nav class="wc-tabs" aria-label="切换看板列">' + tabs.map(function(t){
      var on = t.id === col;
      var tabRange = rangeLabel(d ? d.range : DEFAULT_RANGE);
      var all = "";
      if(t.id === DONE_COL && t.allTotal != null){
        all = d && d.range === "all"
          ? ' title="历史共 ' + t.allTotal + ' 项"'
          : ' title="' + tabRange + ' ' + t.count + ' 项 · 历史共 ' + t.allTotal + ' 项"';
      }
      return '<button class="wc-tab' + (on ? " on" : "") + '" type="button" role="tab" aria-selected="' + on +
        '" data-wc-col="' + esc(t.id) + '"' + all + '>' +
        '<i class="dot" style="background:' + esc(t.color || "var(--border-strong)") + '"></i>' +
        esc(t.name) + '<b>' + t.count + '</b></button>';
    }).join("") + '</nav></header>';
}

function render(){
  var el = document.getElementById("workcolumnBody");
  if(!el) return;
  var cs = currentState();
  var active = document.activeElement;
  var focusedQ = !!(active && active.getAttribute && active.getAttribute("data-wc-filter") === "q");
  var selStart = focusedQ ? active.selectionStart : 0;
  var selEnd = focusedQ ? active.selectionEnd : 0;
  el.innerHTML = headHTML(cs.data, cs) + '<div class="wc-body">' + bodyHTML(cs.data, cs) + '</div>';
  if(focusedQ){
    var q = document.getElementById("wcQ");
    if(q){
      q.focus();
      try{ q.setSelectionRange(selStart, selEnd); }catch(e){ /* noop */ }
    }
  }
  UI.wireTooltips(el);
}

function switchCol(col){
  if(!col || col === currentCol()) return;
  st.col = col;
  var cs = colState(col);
  st.routeKey = col + "|" + (isDone(col) ? cs.range : "");
  setRouteHash(true, col, cs.range);
  load(true);
}
function resetFilters(){
  var col = currentCol();
  var cs = colState(col);
  cs.q = ""; cs.req = ""; cs.owner = ""; cs.pri = ""; cs.type = ""; cs.cat = ""; cs.due = ""; cs.blocked = false;
  load(true);
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
    if(e.target.closest("[data-wc-refresh]")){ load(true); return; }
    if(e.target.closest("[data-wc-reset]")){ resetFilters(); return; }
    if(e.target.closest("[data-wc-retry]")){ load(true); return; }
    if(e.target.closest("[data-wc-loadmore]")){ if(!st.loading) load(false); return; }
    var blocked = e.target.closest("[data-wc-blocked]");
    if(blocked){
      var cs = currentState();
      cs.blocked = !cs.blocked;
      load(true);
      return;
    }
    var card = e.target.closest("[data-wc-task]");
    if(card){ openTaskById(card.dataset.wcTask); return; }
  });
  bodyEl.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest("[data-wc-task]");
    if(card){ e.preventDefault(); openTaskById(card.dataset.wcTask); }
  });
  bodyEl.addEventListener("change", function(e){
    var el = e.target.closest("[data-wc-filter]");
    if(!el) return;
    var key = el.dataset.wcFilter;
    var cs = currentState();
    if(key === "group"){
      cs.group = el.value || "owner";
      render();
      return;
    }
    if(key === "range"){
      cs.range = normalizeRange(el.value);
      cs.offset = 0;
      cs.rows = [];
      cs.data = null;
      setRouteHash(true, currentCol(), cs.range);
      load(true);
      return;
    }
    cs[key] = el.value;
    cs.offset = 0;
    load(true);
  });
  bodyEl.addEventListener("input", function(e){
    var el = e.target.closest('[data-wc-filter="q"]');
    if(!el) return;
    var cs = currentState();
    cs.q = el.value;
    cs.offset = 0;
    clearTimeout(st.timer);
    st.timer = setTimeout(function(){ load(true, true); }, 300);
  });
}

window.addEventListener("hashchange", function(){
  if(activeView === "workcolumn") refreshFromHash();
});
window.addEventListener("ds:reqs-loaded", function(){
  if(activeView === "workcolumn") render();
});
window.addEventListener("ds:task-saved", function(e){
  if(activeView !== "workcolumn") return;
  var saved = e.detail && e.detail.task;
  var cs = currentState();
  if(!saved || !cs.data) { load(true, true); return; }
  /* 状态或字段变化会影响当前列口径：静默重拉首屏，避免数字与卡片不一致 */
  load(true, true);
});

export { enterWorkColumn, refreshFromHash };
