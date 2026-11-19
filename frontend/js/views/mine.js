/* views/mine · 我的工作（分页 + 分组 + 行内操作） */

import { API } from "../core/api.js";
import { btnMineFields, btnMineFold, btnMineRefresh, mineBody, mineGroup, mineMeta, minePub, mineSort, mineSpaceFilter, mineStats, mineSubgroup } from "../core/dom.js";
import { clearFilters, reloadFilteredViews, renderFilterChips, syncDimButtons } from "../core/filters-ui.js";
import { filterParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import * as listPrefs from "../core/list-preferences.js";
import { currentMode, saveMode } from "../core/mobile-rules.js";
import { loadPrioritySpaces } from "../core/priorities.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { canEditTask, catColor, catNameById, dueDateMD, dueDateTip, dueFlag, dueState, progressOf, reqSetId, rt, setNameById, setSortOf, state, statusBucket, timerAllowed } from "../core/state.js";
import { loadRunningTimer, openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { loadView } from "../core/view-loader.js";
import { guard, serverDecision } from "../core/transitions.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, COLUMNS, PRIORITIES, addDays, assocLinkHTML, avatarHTML, colMeta, colName, duePresetDate, elapsedText, fmtFull, fmtMinutesShort, fmtShortMD, fmtTs, iso, parseDate, priColor, priName, priTagHTML, syncColumns, taskPublicationHTML, typeBadgeHTML, typeName, weekdayCN } from "../lib/format.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { loadBoard } from "./board.js";
import { refreshCalendarIfOpen } from "./calendar.js";
import { openTaskTable } from "./manager-shared.js";

registerHelp({
  "mine.doneRate": {
    title:"完成率",
    rows:[
      ["怎么算", "区间内完成的工作项数 ÷ 计划工作项数。", "ok"],
      ["计划怎么来", "完成时间落在区间内的，加上截止日期落在区间内的（同一个工作项只算一次）；所以计划里可能包含早已完成、但截止日在本期的项。", "info"],
      ["快照部分", "逾期、被阻塞与待处理是当前快照，不随「本月 / 近 30 天」切换。", "mute"]
    ]
  },
  "mine.load": {
    title:"成员负载",
    rows:[
      ["怎么算", "该成员在所选区间内的实际计时 ÷（区间工作日 × 每日 8h 容量），不是按未完成工作项的预估任务量算。", "ok"],
      ["容量", "区间内周一至周五统一折算，不区分成员档期、请假或兼职比例。", "info"],
      ["计时归入", "按计时开始日期落在区间内统计。", "mute"],
      ["阈值", "超过 100% 为超出容量；90%–100% 为接近容量。", "warn"]
    ]
  },
  "mine.stats": {
    title:"统计条",
    rows:[
      ["范围", "只统计当前已载入的「我的工作」项；继续滚动会补载，数字随之变化，不是整个空间的全量。", "warn"],
      ["已载入 / 共", "已载入是列表当前累计的条数；共是服务端本轮筛选后的全部条数，继续加载会向「共」靠近。按空间二次筛选时空间条件只在前端生效，不显示共，改为报「筛选出 / 已载入」。", "ok"],
      ["逾期 / 7 天内到期", "逾期按截止日期早于今天计算；7 天内到期含今天与之后 6 天。已完成、已取消、执行结束的项都不计入。", "info"],
      ["被阻塞", "当前标记为阻塞的项，是此刻的快照。", "mute"],
      ["未设截止", "未完成、执行未结束且没有截止日期的项。", "mute"]
    ]
  },
  "mine.personalLoad": {
    title:"个人剩余与负载",
    rows:[
      ["怎么算", "已载入、未完成工作项的（预估工时 − 已用工时）之和；负数按 0 计。", "ok"],
      ["容量", "按 5 个工作日 × 每天 8h = 40h 折算负载百分比，不区分请假、兼职或你另外安排的时间。", "info"],
      ["不含哪些", "已完成、已取消、执行结束的项不计；未填预估的项单独显示「未估时」，不进入剩余工时。", "mute"],
      ["和成员负载的区别", "成员负载按所选区间内的实际计时 ÷ 区间容量；这里看的是你手上剩余预估工作量的粗口径。", "warn"]
    ]
  },
  "mine.testQueue": {
    title:"测试队列统计",
    rows:[
      ["范围", "当前已载入的测试队列，含你认领的项和项目内尚未认领的待测项，同样不是全量。", "warn"],
      ["待领取", "没有测试负责人的项，不是「你没认领」的数量。", "info"],
      ["测试中", "看板列处于测试中的项，不含已认领但还没开始的待测项。", "ok"],
      ["最久等待", "最早一次提测时间到现在的时长；退回后重新提测会从新时间重新计算。", "mute"]
    ]
  }
});
initCaliberHelp();

function wsNameById(id){
  for(var i = 0; i < rt.allWorkspaces.length; i++) if(rt.allWorkspaces[i].id === id) return rt.allWorkspaces[i].name;
  return "该空间";
}
var WS_HANDOFF_KEY = "ds.wsHandoff.v1";
/* 切空间要整页重载：把空间无关的筛选和「我的工作」分组偏好带过去。
   项目 / 分类 / 负责人 / 标签 / 版本都是空间内实体，跨空间没有意义，不带。 */
function saveWorkspaceHandoff(targetId){
  try{
    sessionStorage.setItem(WS_HANDOFF_KEY, JSON.stringify({
      wsId: targetId,
      filters: {
        pris: state.pris.slice(), types: state.types.slice(),
        completion: state.completion, pubState: state.pubState, due: state.due,
        focus: !!state.focus, blocked: !!state.blocked, doneScope: state.doneScope,
        noDue: !!state.noDue, dueFrom: state.dueFrom, dueTo: state.dueTo,
        startFrom: state.startFrom, startTo: state.startTo
      },
      mine: { group: state.mineGroup, subgroup: state.mineSubgroup, sort: state.mineSort, view: mineViewMode }
    }));
  }catch(e){ /* 受限环境：保持原来的「重载后回默认」 */ }
}
/**
 * 空间加载完成后调用：目标空间匹配时恢复通勤筛选和分组偏好。
 * 返回是否有变化，调用方据此决定要不要重拉筛选视图。
 */
function restoreWorkspaceHandoff(){
  var raw = null;
  try{
    raw = sessionStorage.getItem(WS_HANDOFF_KEY);
    sessionStorage.removeItem(WS_HANDOFF_KEY);
  }catch(e){ return false; }
  if(!raw || !rt.currentWs) return false;
  var snap = null;
  try{ snap = JSON.parse(raw); }catch(e){ return false; }
  if(!snap || snap.wsId !== rt.currentWs.id) return false;
  var changed = false, f = snap.filters || {};
  ["pris", "types"].forEach(function(k){
    var arr = Array.isArray(f[k]) ? f[k].slice() : [];
    if(arr.length !== state[k].length || arr.some(function(v, i){ return v !== state[k][i]; })){ state[k] = arr; changed = true; }
  });
  var completion = typeof f.completion === "string" ? f.completion : "";
  if(completion !== state.completion){ state.completion = completion; changed = true; }
  var pubState = f.pubState === "published" || f.pubState === "unpublished" ? f.pubState : null;
  if(pubState !== state.pubState){ state.pubState = pubState; changed = true; }
  var due = f.due || null;
  if(due !== state.due){ state.due = due; changed = true; }
  var focus = !!f.focus;
  if(focus !== state.focus){ state.focus = focus; changed = true; }
  var blocked = !!f.blocked;
  if(blocked !== state.blocked){ state.blocked = blocked; changed = true; }
  var doneScope = f.doneScope || "week";
  if(doneScope !== state.doneScope){ state.doneScope = doneScope; changed = true; }
  var noDue = !!f.noDue;
  if(noDue !== state.noDue){ state.noDue = noDue; changed = true; }
  ["dueFrom", "dueTo", "startFrom", "startTo"].forEach(function(k){
    var nv = typeof f[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f[k]) ? f[k] : null;
    if(nv !== state[k]){ state[k] = nv; changed = true; }
  });
  var m = snap.mine || {};
  /* 空间筛选不跨空间带：目标是另一个空间，保留旧空间筛选会把刚打开的工作项藏起来 */
  if(state.mineSpace){ state.mineSpace = ""; changed = true; }
  if(MINE_GROUP_DIMS.indexOf(m.group) !== -1 && m.group !== state.mineGroup){ state.mineGroup = m.group; changed = true; }
  if(MINE_GROUP_DIMS.indexOf(m.subgroup) !== -1 && m.subgroup !== state.mineSubgroup){ state.mineSubgroup = m.subgroup; changed = true; }
  if(MINE_SORTS.indexOf(m.sort) !== -1 && m.sort !== state.mineSort){ state.mineSort = m.sort; changed = true; }
  if((m.view === "board" || m.view === "list") && m.view !== mineViewMode){
    mineViewMode = m.view;
    try{ localStorage.setItem(MINE_VIEW_KEY, m.view); }catch(e){ /* noop */ }
    changed = true;
  }
  if(changed){
    renderFilterChips();
    syncMineFilters();
    syncMineViewUI();
  }
  return changed;
}
function clearWorkspaceHandoff(){
  try{ sessionStorage.removeItem(WS_HANDOFF_KEY); }catch(e){ /* 受限环境忽略 */ }
}
function askSwitchWorkspace(wsId, wsName, opts){
  opts = opts || {};
  var target = wsName || wsNameById(wsId);
  var msg = opts.taskTitle
    ? ('即将切换到「' + esc(target) + '」并打开工作项「' + esc(opts.taskTitle) + '」。<br><br>' +
       '当前空间的项目、分类、负责人等空间专属条件会清空；通用的优先级、完成情况、截止条件与「我的工作」分组会带过去。抽屉里未保存的编辑不会保留。')
    : opts.linkTitle
      ? ('即将切换到「' + esc(target) + '」并打开通知关联内容「' + esc(opts.linkTitle) + '」。<br><br>' +
         '当前空间的项目、分类、负责人等空间专属条件会清空；通用的优先级、完成情况、截止条件与「我的工作」分组会带过去。抽屉里未保存的编辑不会保留。')
      : ('切换到「' + esc(target) + '」会重新加载页面。<br><br>' +
         '当前空间的项目、分类、负责人等空间专属条件会清空；通用的优先级、完成情况、截止条件与「我的工作」分组会带过去。抽屉里未保存的编辑不会保留。');
  return UI.showConfirm({
    title: opts.title || "切换空间",
    msg: msg,
    okText: "切换",
    cancelText: "取消",
    danger: false
  }).then(function(ok){
    if(!ok) return false;
    saveWorkspaceHandoff(wsId);
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
      /* 切换没成功：清掉刚存的快照，避免下次进入该空间时套用一份过期条件 */
      clearWorkspaceHandoff();
      toast(ex.message || "切换空间失败", "bad");
      return false;
    });
  });
}
var mineGuideBound = false;
function enterMineView(){
  if(!mineGuideBound){ mineGuideBound = true; bindMineGuide(); }
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
    /* 不分组时二级分组不适用：整个控件隐藏，而不是外置置灰占位（工具栏降噪） */
    var subWrap = mineSubgroup.closest("label");
    if(subWrap) subWrap.hidden = state.mineGroup === "none";
  }
  if(mineSort) mineSort.value = MINE_SORTS.indexOf(state.mineSort) !== -1 ? state.mineSort : "default";
  if(minePub) minePub.value = state.pubState === "published" || state.pubState === "unpublished" ? state.pubState : "";
  var echo = document.getElementById("mineDisplayEcho");
  if(echo){
    var groupName = {due:"按截止",workspace:"按空间",priority:"按优先级",status:"按状态",project:"按项目",set:"按项目集",none:"不分组"};
    echo.textContent = groupName[state.mineGroup] || "按截止";
  }
  syncMineFilterMarks();
}
/* 筛选生效态：偏离默认值才标记，默认值与 state.js 首屏一致、不发光 */
function syncMineFilterMarks(){
  [[mineGroup, "due"], [mineSubgroup, "none"], [mineSort, "default"], [mineSpaceFilter, ""], [minePub, ""]]
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
/* 行内状态下拉要列出当前空间的自定义列；列定义只随空间加载一次，失败时沿用内置列 */
var mineColsWs = null;
function loadMineColumns(){
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!wsId || mineColsWs === wsId) return Promise.resolve();
  return API.get("/api/columns").then(function(defs){
    syncColumns(defs);
    mineColsWs = wsId;
  }).catch(function(){ /* 列定义不影响列表主体，继续用内置列渲染 */ });
}
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
  /* 发布态是全局维度：筛选条清空/应用视图时也同步回页内控件 */
  if(minePub) minePub.value = state.pubState || "";
  syncMineFilterMarks();
  mineLoading = true;
  var seq = ++mineSeq;
  var offset = append ? mineAll.length : 0;
  var btn = mineBody.querySelector("[data-mine-more]");
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  if(!opts.silent && !append){
    mineBody.innerHTML = UI.skeletonRows(6);
    if(mineMeta) mineMeta.textContent = "加载中…";
  }
  /* 完成情况=已完成时 scope 必须是 all，否则 openOnly 与 completion=done 叠加后恒为空；
     待我测试只看在测队列，完成情况筛选对这里无意义，直接丢弃 */
  var testMode = currentMineMode() === "test";
  var scope = (!testMode && state.completion === "done") ? "all" : "open";
  var params = filterParams({scope: scope, offset: offset, limit: MINE_PAGE_SIZE});
  delete params.owners;      // 负责人维度天然是我
  if(testMode){ params.view = "test"; delete params.completion; }
  /* 显示列偏好先就位再渲染，避免首屏按默认列闪一帧 */
  listPrefs.load("my-tasks").then(function(){
    if(seq !== mineSeq) return;
    return Promise.all([loadMineColumns(), API.getGlobal("/api/my-tasks", params)]).then(function(res){
      if(seq !== mineSeq) return;
      var d = res[1];
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
var MINE_GROUP_DIMS = ["due", "workspace", "priority", "status", "project", "set", "none"];
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
  if(dim === "set"){
    var sid = reqSetId(t.reqId);
    return {key:sid || "__none", label:setNameById(sid) || "未归组", tone:"neutral"};
  }
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
  if(dim === "set"){
    var ai = a.key === "__none" ? 9999 : setSortOf(a.key);
    var bi = b.key === "__none" ? 9999 : setSortOf(b.key);
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
  {k:"status", label:"状态", w:"128px"},
  {k:"dueDate", label:"截止", w:"96px"},
  {k:"startDate", label:"开始", w:"88px"},
  {k:"progress", label:"进度", w:"96px"},
  {k:"work", label:"工时", w:"76px"},
  {k:"project", label:"项目", w:"minmax(140px,1fr)"},
  {k:"updatedAt", label:"更新", w:"76px", align:"right"}
];
var MINE_OPS_W = "76px";
/* 待我测试只看交接信息：状态 / 提测时间 / 等待或已测时长 / 开发负责人 */
var MINE_TEST_COLS = [
  {k:"title", label:"工作项", w:"minmax(260px,2fr)"},
  {k:"testStatus", label:"状态", w:"104px"},
  {k:"testRequested", label:"提测时间", w:"112px"},
  {k:"testElapsed", label:"等待 / 已测", w:"110px"},
  {k:"owner", label:"开发负责人", w:"128px"}
];
var MINE_TEST_OPS_W = "176px";
var MINE_CLOSED_KEY = "ds.mineClosed";
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
  if(k === "project") return w < 1000;
  if(k === "startDate") return w < 1000;
  if(k === "work") return w < 920;
  if(k === "updatedAt") return w < 980;
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
    sub.push(assocLinkHTML("project", t.reqId, t.reqName, {cls:"mine-proj-chip", title:"打开项目：" + t.reqName}));
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
  var pub = taskPublicationHTML(t);
  if(pub) sub.push(pub);
  return '<span class="mine-tc-main">' +
    '<span class="mine-tc-title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
    (sub.length ? '<span class="mine-tc-sub">' + sub.join("") + '</span>' : '') +
  '</span>';
}
/* ---- 行内编辑单元：静置态「图标 + 文字」，点击弹自绘菜单；只读态同一长相，仅不带箭头 ---- */
var MINE_CARET = '<span class="mine-cell-caret" aria-hidden="true">' + icon("caretDown", 11) + '</span>';
/* 状态环按列自己的处理规则取形：已完成=实心勾，结束计时=圆点，等待/待处理=空心，正常计时=半环 */
function mineRingHTML(colId){
  var col = colMeta(colId) || {};
  var color = esc(col.color || CAT_DEFAULT_COLOR);
  var rule = col.processingRule || (col.done ? "done" : "normal");
  var cls = col.done || rule === "done" ? "is-done"
    : (rule === "ended" ? "is-ended" : (rule === "normal" && colId !== "backlog" ? "is-doing" : ""));
  return '<i class="mine-st-ring ' + cls + '" style="--c:' + color + '">' +
    (cls === "is-done" ? icon("check", 8) : "") + '</i>';
}
function minePriFlagHTML(t){
  var p = t.priority || "";
  return '<i class="mine-pri-bar" style="--c:' + esc(p ? priColor(p, t.workspaceId) : CAT_DEFAULT_COLOR) + '"></i>' +
    '<span class="mine-cell-txt">' + esc(p ? priName(p, t.workspaceId) : "未设置") + '</span>';
}
function mineStatusInner(t){
  return mineRingHTML(t.boardColumn) +
    '<span class="mine-cell-txt">' + esc(colName(t.boardColumn) || "未设置") + '</span>';
}
function mineStatusFlagHTML(t, dueVisible){
  /* 截止列在同一行已用红/橙描出逾期，只有截止列被收起时才补一枚标记 */
  var f = dueFlag(t);
  if(!f || dueVisible) return "";
  return ' <span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>';
}
/* 行内改状态：列定义按当前空间加载，跨空间任务仍需切换空间后再改 */
function mineStatusEditable(t){
  return !!t && canEditTask(t) && !!rt.currentWs && t.workspaceId === rt.currentWs.id;
}
function minePriorityCell(t){
  var inner = minePriFlagHTML(t);
  if(!canEditTask(t)) return '<span class="cell mine-pri-cell mine-cell-static">' + inner + '</span>';
  return '<span class="cell mine-pri-cell">' +
    '<button class="mine-cell-btn" type="button" data-mine-cell="priority"' +
      ' aria-haspopup="menu" aria-expanded="false" title="修改优先级">' + inner + MINE_CARET + '</button></span>';
}
function mineStatusCell(t, dueVisible){
  var inner = mineStatusInner(t);
  var flag = mineStatusFlagHTML(t, dueVisible);
  if(!mineStatusEditable(t)){
    return '<span class="cell mine-status-cell mine-cell-static">' + inner + flag + '</span>';
  }
  return '<span class="cell mine-status-cell">' +
    '<button class="mine-cell-btn" type="button" data-mine-cell="status"' +
      ' aria-haspopup="menu" aria-expanded="false" title="修改状态">' + inner + MINE_CARET + '</button>' + flag + '</span>';
}
function mineDueCell(t, dueCls){
  var txt = t.dueDate ? esc(dueDateMD(t)) : "—";
  if(!canEditTask(t)){
    return '<span class="cell mine-due-cell ' + dueCls + '" title="' + esc(dueDateTip(t)) + '">' + txt + '</span>';
  }
  return '<span class="cell mine-due-cell ' + dueCls + '" title="' + esc(dueDateTip(t)) + '">' + txt +
    '<button class="mine-cell-ico" type="button" data-mine-cell="due" aria-haspopup="dialog"' +
      ' aria-label="修改截止日期" title="修改截止日期">' + icon("calSmall", 12) + '</button></span>';
}
function mineActsHTML(t, running, editable, tAllowed, isDone){
  return '<span class="mine-acts">' +
    ((editable && !isDone) ? '<button class="icon-btn sm" type="button" data-mine-done title="标记完成" aria-label="标记完成">' + icon("check", 14) + '</button>' : '') +
    ((running || (editable && tAllowed)) ? '<button class="icon-btn sm' + (running ? " on" : "") + '" type="button" data-mine-timer' +
      ' title="' + (running ? "停止计时" : "开始计时") + '"' +
      ' aria-label="开始或停止计时">' + icon(running ? "pause" : "clock", 14) + '</button>' : '') +
    (editable ? '<button class="icon-btn sm" type="button" data-mine-due title="改期" aria-label="改期">' + icon("calendar", 14) + '</button>' : '') +
  '</span>';
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
  var acts = {running:running, editable:editable, tAllowed:tAllowed, isDone:isDone};
  var updShown = cols.some(function(c){ return c.k === "updatedAt"; });
  return '<div class="list-row" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    mineRowCells(t, dueCls, p, cols, acts) +
    (updShown ? "" : mineActsHTML(t, running, editable, tAllowed, isDone)) +
  '</div>';
}
function mineRowCells(t, dueCls, p, cols, acts){
  var dueVisible = cols.some(function(c){ return c.k === "dueDate"; });
  return cols.map(function(c){
    if(c.k === "title") return mineTaskCell(t, cols);
    if(c.k === "type"){
      var badge = typeBadgeHTML(t.itemType);
      return '<span class="cell">' + (badge || esc(typeName(t.itemType))) + '</span>';
    }
    if(c.k === "priority") return minePriorityCell(t);
    if(c.k === "status") return mineStatusCell(t, dueVisible);
    if(c.k === "dueDate") return mineDueCell(t, dueCls);
    if(c.k === "startDate") return '<span class="cell muted">' + (t.startDate ? esc(fmtShortMD(parseDate(t.startDate))) : "—") + '</span>';
    if(c.k === "progress"){
      /* 未开始且进度为 0 时不画空进度条，避免零信息量的灰槽 */
      if(p <= 0 && t.boardColumn !== "doing") return '<span class="cell muted">—</span>';
      return '<span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span>';
    }
    if(c.k === "work") return '<span class="cell">' + esc(fmtMinutesShort(t.totalMinutes)) + '</span>';
    if(c.k === "project"){
      var vn = Array.isArray(t.versionNames) && t.versionNames.length ? t.versionNames[0] : "";
      return '<span class="cell">' + assocLinkHTML("project", t.reqId, t.reqName, {plain:"—"}) +
        (vn ? ' <span class="muted">/ ' + esc(vn) + '</span>' : '') + '</span>';
    }
    if(c.k === "updatedAt"){
      var rel = mineRelText(t.updatedAt);
      var upd = parseDate(t.updatedAt);
      var updTip = upd ? (fmtFull(upd) + " " + weekdayCN(upd)) : rel;
      /* 行尾一格兼作操作位：静置读更新，悬停换成操作，避免一条空的操作列 */
      return '<span class="cell mine-upd-cell" title="最近更新：' + esc(updTip) + '">' +
        '<span class="mine-upd-time">' + esc(rel) + '</span>' +
        (acts ? mineActsHTML(t, acts.running, acts.editable, acts.tAllowed, acts.isDone) : '') + '</span>';
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
var mineViewSeg = document.getElementById("mineViewSeg");
/* 列表 / 看板：看板按状态列展示，可拖拽改状态；偏好存本机，手机端固定列表 */
var MINE_VIEW_KEY = "ds.mineView";
var mineViewMode = (function(){
  try{ return localStorage.getItem(MINE_VIEW_KEY) === "board" ? "board" : "list"; }catch(e){ return "list"; }
})();
function setMineView(v){
  if(v !== "board" && v !== "list") return;
  /* 团队是成员面板、待我测试是卡片队列，都不接受列表/看板切换 */
  if(currentMineMode() !== "mine") return;
  if(mineViewMode === v) return;
  mineViewMode = v;
  try{ localStorage.setItem(MINE_VIEW_KEY, v); }catch(e){ /* 受限环境只在本次生效 */ }
  syncMineViewUI();
  rerenderMine();
}
function syncMineViewUI(){
  /* 看板只属于「我的」：待我测试是卡片队列，团队是成员面板，都不套看板壳 */
  var board = mineViewMode === "board" && !isMobile() && currentMineMode() === "mine";
  var view = document.getElementById("view-mine");
  if(view) view.classList.toggle("is-board", board);
  if(mineViewSeg){
    mineViewSeg.querySelectorAll("[data-mine-view]").forEach(function(b){
      b.setAttribute("aria-pressed", String(b.dataset.mineView === (mineViewMode === "board" ? "board" : "list")));
    });
  }
}
var teamSeq = 0;
var teamLoading = false;
var teamQueued = false;

function currentMineMode(){
  var ws = rt.currentWs;
  return currentMode(ws ? ws.id : "", ws && ws.myRole);
}
function mineTestMode(){ return currentMineMode() === "test"; }
function syncMineModeUI(){
  if(!mineModeEl) return;
  var mode = currentMineMode();
  mineModeEl.querySelectorAll("[data-mine-mode]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.mineMode === mode));
  });
  document.body.classList.toggle("mine-team", isMobile() && mode === "team");
  var mineView = document.getElementById("view-mine");
  if(mineView) mineView.classList.toggle("is-test", mode === "test");
}
function setMineMode(mode){
  var prev = currentMineMode();
  var ws = rt.currentWs;
  saveMode(ws ? ws.id : "", mode);
  /* 三种模式的请求参数不同：切换时清空，避免先拿旧模式的数据渲染一帧 */
  if(mode !== prev){
    mineAll = []; mineSpaces = []; mineTotal = 0; mineHasMore = false; mineCache = {};
  }
  syncMineModeUI();
  /* 「待我测试」固定卡片列表，切模式时同步列表/看板分段状态 */
  syncMineViewUI();
  /* 测试负责人维度只在「待我测试」摆出来，切模式后筛选栏立即重排 */
  syncDimButtons();
  if(mode === "team"){ renderTeam(); return; }
  if(mineAll.length) rerenderMine(); else loadMine();
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
        pub: true,
        fetch: function(offset, pub){
          return teamTaskPage(Object.assign({}, params,
            { pubState: (pub === "published" || pub === "unpublished") ? pub : "" }), offset);
        }
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
  if(mineView){ mineView.classList.remove("is-empty", "is-test"); mineView.classList.add("is-team"); }
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
        '<div class="th-main" style="--done-rate:' + rate + '%"><b>' + rate + '%</b><span class="caliber-label">' + range.label + '完成率' + caliberMarkHTML("mine.doneRate", false, "查看「完成率」口径") + '</span>' +
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
      html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3>' + caliberMarkHTML("mine.load", false, "查看「成员负载」口径")
        + '<span class="foot-note">' + range.label + '计时 / ' + capDays + ' 个工作日容量</span></div>' +
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
      taskPublicationHTML(t) +
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
function renderMobileMine(sections, cardFn){
  var card = cardFn || mobileMineCardHTML;
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
          '<div class="mob-card-list">' + sub.rows.map(card).join("") + '</div>' +
        '</section>';
      }).join("");
    }else{
      inner = '<div class="mob-card-list">' + s.rows.map(card).join("") + '</div>';
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
/* ---- 我的工作 · 看板：按状态列铺开，拖拽卡片即改状态（走流转矩阵） ---- */
var MINE_BOARD_COL_LIMIT = 100;
/* 列以当前空间列定义为主；跨空间的旧列 id 兜底补一列，避免卡片无处安放 */
function mineBoardColumns(items){
  var cols = COLUMNS.slice(), seen = {};
  cols.forEach(function(c){ seen[c.id] = true; });
  (items || []).forEach(function(t){
    var id = t.boardColumn || "";
    if(!id || seen[id]) return;
    seen[id] = true;
    cols.push({ id:id, name:colName(id) || id, color:"#98A2B3" });
  });
  return cols;
}
function mineBoardCardHTML(t){
  var canMove = canEditTask(t);
  var pri = t.priority || "P2";
  var f = dueFlag(t);
  var setName = t.reqId ? setNameById(reqSetId(t.reqId)) : "";
  var path = [t.workspaceName || wsNameById(t.workspaceId), setName, t.reqName || "未归类"]
    .filter(function(s){ return !!s; }).join(" › ");
  return '<article class="mb-card' + (f && f.kind === "over" ? " is-over" : "") + '"'
    + ' draggable="' + (canMove ? "true" : "false") + '"'
    + ' data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '" data-mine-board-card'
    + ' tabindex="0" role="listitem"'
    + ' title="' + (canMove ? "拖动到其他列可改状态；点击打开详情" : "只读项目：可查看，不能拖拽改状态") + '"'
    + ' aria-label="' + esc(t.title + " · " + colName(t.boardColumn)) + '">'
    + '<div class="mb-top">' + priTagHTML(pri, t.workspaceId)
      + (t.blocked ? '<span class="mb-blocked">' + icon("alert", 11) + '被阻塞</span>' : "")
      + taskPublicationHTML(t)
      + '<button class="icon-btn xs mb-menu" type="button" data-mine-board-menu aria-label="更改状态" title="更改状态">' + icon("more", 14) + '</button>'
    + '</div>'
    + '<h4 class="mb-title">' + esc(t.title) + '</h4>'
    + '<p class="mb-path" title="' + esc(path) + '">' + esc(path) + '</p>'
    + '<div class="mb-meta">'
      + '<span class="mb-due' + (f && f.kind === "over" ? " over" : (f && f.kind === "today" ? " today" : "")) + '">'
        + (t.dueDate ? esc(dueDateMD(t)) : "未设截止") + '</span>'
      + (f ? '<span class="mini-tag ' + (f.kind === "over" ? "over" : (f.kind === "today" ? "warn" : "")) + '">' + esc(f.text) + '</span>' : '')
    + '</div></article>';
}
function renderMineBoard(items){
  var cols = mineBoardColumns(items);
  var html = '<div class="mine-board" role="group" aria-label="我的工作看板">';
  cols.forEach(function(c){
    var list = items.filter(function(t){ return (t.boardColumn || "") === c.id; });
    var shown = list.slice(0, MINE_BOARD_COL_LIMIT);
    html += '<section class="mb-col" data-mine-bcol="' + esc(c.id) + '">' +
      '<div class="mb-col-head"><span class="mb-col-dot" style="--c:' + esc(c.color || "#98A2B3") + '"></span>' +
        '<b>' + esc(c.name) + '</b><span class="mb-col-n">' + list.length + '</span></div>' +
      '<div class="mb-col-body" data-mine-col-drop="' + esc(c.id) + '">' +
        (shown.length ? shown.map(mineBoardCardHTML).join("") : '<p class="mb-empty">暂无</p>') +
        (list.length > shown.length
          ? '<p class="mb-more">仅显示前 ' + MINE_BOARD_COL_LIMIT + ' 项 · 共 ' + list.length + ' 项</p>' : '') +
      '</div></section>';
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
  var testMode = mineTestMode();
  /* 空态时分组/排序/空间控件没有可作用的对象，先收起，避免空页面顶着一排设置 */
  var mineView = document.getElementById("view-mine");
  if(mineView){
    mineView.classList.toggle("is-empty", !items.length);
    mineView.classList.remove("is-team");
    mineView.classList.toggle("is-test", testMode);
  }
  if(mineMeta){
    var nameOnly = mineNameOnly;
    var loaded = mineAll.length;
    /* 计数只出现一次：常规态交给统计行「今天 · N 项在办」，工具条只报筛选与分组名 */
    var countTxt = filtering ? ("筛选出 " + items.length + " / " + loaded + " 项（已加载）") : "";
    var boardHint = !testMode && mineViewMode === "board" && !isMobile() && currentMineMode() === "mine"
      ? "拖动卡片可改状态" : "";
    var spaceTxt = spaces.length > 1 ? ("覆盖 " + spaces.length + " 个空间") : "";
    mineMeta.textContent = [testMode ? "待我测试" : "", countTxt, spaceTxt,
      mineHasMore ? "还有更多，可继续加载" : "", boardHint,
      !testMode && nameOnly > 0 ? ("其中 " + nameOnly + " 项仅按显示名匹配（未绑定账号）") : ""]
      .filter(Boolean).join(" · ");
  }
  if(!mineAll.length){
    if(mineStats) mineStats.innerHTML = "";
    mineBody.innerHTML = UI.emptyState(testMode ? {
      icon:"checkCircle", title:"没有待你测试的工作项",
      text:"研发把工作项移到「待测试」后，会出现在这里；项目里没人认领的待测队列也汇总在这里，先到先得。",
      actionLabel:"去工作项"
    } : {
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
  if(testMode){ renderMineTest(items); return; }
  renderMineStats(items);
  syncMineViewUI();
  /* 看板只在桌面「我的」模式出现：手机端保持卡片列表，拖拽不是移动端目标 */
  if(mineViewMode === "board" && !isMobile() && currentMineMode() === "mine"){ renderMineBoard(items); prependMineGuide(); return; }
  var sections = mineSections(items);
  if(isMobile()){ renderMobileMine(sections); prependMineGuide(); return; }
  var cols = mineVisibleCols(mineListWidth());
  var updShown = cols.some(function(c){ return c.k === "updatedAt"; });
  /* 表头只出现一次，分组以内嵌可折叠行区分，避免每组各带一个卡片与表头 */
  var html = '<div class="mine-groups"><div class="list-scroll mine-list">' +
    '<div class="list-head">' +
      cols.map(function(c){
        return '<span' + (c.align === "right" ? ' class="ta-r"' : '') + '>' + esc(c.label) + '</span>';
      }).join("") + (updShown ? "" : '<span class="ta-r"></span>') +
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
  prependMineGuide();
  var scroller = mineBody.querySelector(".mine-list");
  /* 操作位并入「更新」列；只有该列被收起时才补一条独立动作列 */
  var gridCols = cols.map(function(c){ return c.w; });
  if(!updShown) gridCols = gridCols.concat(MINE_OPS_W);
  if(scroller) scroller.style.setProperty("--mine-cols", gridCols.join(" "));
  mineSyncFoldBtn(sections);
}
/* ---- 首屏引导：已加载工作项 <3 条的新空间，把「下一步」递到手里 ---- */
function mineGuideHTML(){
  if(mineTestMode() || mineFiltering()) return "";
  if(!mineAll.length || mineAll.length > 2) return "";
  return UI.guideCard();
}
function prependMineGuide(){
  var h = mineGuideHTML();
  if(h) mineBody.insertAdjacentHTML("afterbegin", h);
}
function bindMineGuide(){
  mineBody.addEventListener("click", function(e){
    var g = e.target.closest("[data-guide]");
    if(!g) return;
    var kind = g.getAttribute("data-guide");
    if(kind === "task") openTaskDrawer("backlog");
    else if(kind === "project"){
      window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"projects" } }));
      setTimeout(function(){ loadView("projects").then(function(m){ m.openProjectDialog(null); }); }, 80);
    }
    else if(kind === "demand"){
      /* 先写入带 ?new=1 的 hash（syncViewHash 保留名单会保住参数），再走统一路由；demands enter 时消费参数开提需求弹窗 */
      window.location.hash = "#/demands?new=1";
      window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"demands" } }));
    }
  });
}
/* ---- 待我测试：同事移入「待测试」后，测试同学在这里承接 ---- */
function mineTestStatusHTML(t){
  if(t.boardColumn === "testing") return '<span class="mini-tag ok">测试中</span>';
  return t.testOwnerUserId ? '<span class="mini-tag">待测试</span>' : '<span class="mini-tag warn">待领取</span>';
}
function mineTestRequestedCell(t){
  var txt = t.testRequestedAt ? fmtTs(t.testRequestedAt) : "—";
  if(!t.testRequestedAt) return '<span class="cell muted">' + txt + '</span>';
  return '<span class="cell" title="' + esc(t.testRequestedAt) + '">' + esc(txt) + '</span>';
}
function mineTestElapsedText(t){
  var from = t.boardColumn === "testing" ? (t.testStartedAt || t.testRequestedAt) : t.testRequestedAt;
  var el = elapsedText(from);
  return el ? ((t.boardColumn === "testing" ? "已测 " : "等待 ") + el) : "";
}
function mineTestElapsedCell(t){
  var txt = mineTestElapsedText(t);
  return txt ? '<span class="cell">' + esc(txt) + '</span>' : '<span class="cell muted">—</span>';
}
function mineTestOwnerCell(t){
  if(!t.owner) return '<span class="cell muted">—</span>';
  return '<span class="cell mine-test-dev">' + avatarHTML(t.owner, "sm") +
    '<span class="mine-cell-txt">' + esc(t.owner) + '</span></span>';
}
function mineTestActsHTML(t){
  var editable = canEditTask(t);
  var acts = [];
  if(editable && t.boardColumn === "test"){
    acts.push('<button class="btn sm primary" type="button" data-test-claim>' +
      (t.testOwnerUserId ? "开始测试" : "开始测试并认领") + '</button>');
  }else if(editable && t.boardColumn === "testing"){
    acts.push('<button class="btn sm" type="button" data-test-reject>退回…</button>');
    acts.push('<button class="btn sm primary" type="button" data-test-pass>通过</button>');
  }
  return '<span class="mine-acts mine-test-acts">' + acts.join("") + '</span>';
}
function mineTestRowCells(t, cols){
  return cols.map(function(c){
    if(c.k === "title") return mineTaskCell(t, cols);
    if(c.k === "testStatus") return '<span class="cell">' + mineTestStatusHTML(t) + '</span>';
    if(c.k === "testRequested") return mineTestRequestedCell(t);
    if(c.k === "testElapsed") return mineTestElapsedCell(t);
    if(c.k === "owner") return mineTestOwnerCell(t);
    return "";
  }).join("");
}
function mineTestRowHTML(t, cols){
  return '<div class="list-row" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    mineTestRowCells(t, cols) + mineTestActsHTML(t) +
  '</div>';
}
function mineTestSortRows(rows){
  /* 最久没动的排前面：先看提测时间，缺时间再按标题兜底 */
  return rows.slice().sort(function(a, b){
    var x = a.testRequestedAt || "", y = b.testRequestedAt || "";
    if(x !== y) return x < y ? -1 : 1;
    return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
  });
}
function mineTestSections(items){
  var unclaimed = [], claimed = [];
  items.forEach(function(t){
    if(t.testOwnerUserId) claimed.push(t);
    else unclaimed.push(t);
  });
  var secs = [];
  if(unclaimed.length){
    secs.push({key:"unclaimed", label:"待领取 · 项目内", tone:"warning", subs: [],
      hint:"还没人认领的待测队列，先到先得", rows:mineTestSortRows(unclaimed)});
  }
  if(claimed.length){
    secs.push({key:"claimed", label:"测试中 · 我认领", tone:"info", subs: [],
      hint:"已认领给你，含尚未开始的待测试", rows:mineTestSortRows(claimed)});
  }
  return secs;
}
function renderMineTestStats(items){
  if(!mineStats) return;
  if(isMobile()){ mineStats.innerHTML = ""; return; }
  var unclaimed = 0, testing = 0, oldest = null;
  items.forEach(function(t){
    if(!t.testOwnerUserId) unclaimed++;
    if(t.boardColumn === "testing") testing++;
    if(t.testRequestedAt && (!oldest || t.testRequestedAt < oldest)) oldest = t.testRequestedAt;
  });
  mineStats.innerHTML =
    '<span class="mine-stat">待领取 <b>' + unclaimed + '</b></span>' +
    '<span class="mine-stat today">测试中 <b>' + testing + '</b></span>' +
    '<span class="mine-stat">最久等待 <b>' + esc(oldest ? elapsedText(oldest) : "—") + '</b></span>' +
    '<span class="mine-stat-hint">含项目内尚未认领的待测队列 · 先到先得'
      + caliberMarkHTML("mine.testQueue", false, "查看测试队列口径") + '</span>';
}
function renderMineTest(items){
  renderMineTestStats(items);
  var sections = mineTestSections(items);
  if(isMobile()){ renderMobileMine(sections, mobileMineTestCardHTML); return; }
  var cols = MINE_TEST_COLS;
  var grid = cols.map(function(c){ return c.w; }).concat(MINE_TEST_OPS_W).join(" ");
  var html = '<div class="mine-groups"><div class="list-scroll mine-list" style="--mine-cols:' + esc(grid) + '">' +
    '<div class="list-head">' +
      cols.map(function(c){ return '<span>' + esc(c.label) + '</span>'; }).join("") +
      '<span class="ta-r">操作</span>' +
    '</div><div class="list-body">';
  sections.forEach(function(s){
    if(!s.rows.length) return;
    var gk = mineGroupKey("test", s.key);
    var closed = !!mineClosed[gk];
    html += '<section class="mine-grp' + (closed ? " collapsed" : "") + ' has-head" data-mine-group="' + esc(s.key) + '" data-tone="' + esc(s.tone || "neutral") + '">' +
      '<div class="mine-grp-h" role="button" tabindex="0" aria-expanded="' + (!closed) + '" data-mine-toggle="' + esc(gk) + '">' +
        '<span class="mine-grp-chev" aria-hidden="true">' + icon("chevronRight", 15) + '</span>' +
        '<span class="mine-grp-name">' + esc(s.label) + '</span>' +
        '<span class="mine-grp-n">' + s.rows.length + '</span>' +
        (s.hint ? '<span class="mine-grp-hint">' + esc(s.hint) + '</span>' : '') +
        '<span class="mine-grp-act">' + (closed ? "展开" : "收起") + '</span>' +
      '</div>' +
      '<div class="mine-grp-body">' + s.rows.map(function(t){ return mineTestRowHTML(t, cols); }).join("") + '</div>' +
    '</section>';
  });
  html += '</div></div></div>' + mineMoreHTML();
  mineBody.innerHTML = html;
  mineSyncFoldBtn(sections);
}
function mobileMineTestCardHTML(t){
  var path = [t.workspaceName, t.reqName].filter(function(x){ return !!x; }).join(" · ");
  return '<article class="mob-task-card" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    '<div class="mtc-top">' +
      mineTestStatusHTML(t) +
      '<span class="sp"></span>' +
      '<span class="mtc-path">' + esc(path || "—") + '</span>' +
      taskPublicationHTML(t) +
    '</div>' +
    '<h3 class="mtc-title">' + esc(t.title) + '</h3>' +
    '<div class="mtc-meta">' +
      '<span>提测 ' + esc(t.testRequestedAt ? fmtTs(t.testRequestedAt) : "—") + '</span>' +
      '<span>' + esc(mineTestElapsedText(t) || "—") + '</span>' +
      '<span class="mtc-path">开发 ' + esc(t.owner || "—") + '</span>' +
    '</div>' +
    '<div class="mtc-test-acts">' + mineTestActsHTML(t) + '</div>' +
  '</article>';
}
/* 认领：待测试列直接移入测试中（后端自动认领）；已在测试中但空位时走显式认领 */
function mineTestClaim(t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(t.boardColumn === "test"){ mineChangeColumn(t, "testing", "认领失败"); return; }
  API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/test-claim", {}).then(function(res){
    var nt = res && res.task;
    var who = (nt && nt.testOwner) || (rt.currentUser && rt.currentUser.displayName) || "我";
    toast("已认领「" + t.title + "」开始测试（测试负责人：" + who + "）", "fs");
    loadMine({silent:true});
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "认领失败", "bad"); });
}
function mineTestReject(t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  UI.showPrompt({
    title:"退回「测试中」→「进行中」",
    desc:"退回代表本轮测试结束并记录结束时间；原因会写入活动记录并通知开发负责人。",
    label:"退回原因", placeholder:"例如：关键用例未通过 / 缺少自测记录",
    maxLength:120, required:true, okText:"确认退回"
  }).then(function(reason){ if(reason) mineChangeColumn(t, "doing", "退回失败", reason); });
}
function renderMineStats(items){
  if(!mineStats) return;
  if(isMobile()){ mineStats.innerHTML = ""; return; }
  var over = 0, week = 0, blocked = 0, noDue = 0, missingEst = 0, remainingMinutes = 0;
  var filtering = mineFiltering();
  var capacity = 5 * 8 * 60;   // 5 个工作日 × 8h，仅用于个人剩余负载粗算
  items.forEach(function(t){
    var s = dueState(t);
    /* 终态看列本身：没有截止日期的已完成项 dueState 是 none，不能当成未设截止 */
    var finished = t.boardColumn === "done" || t.boardColumn === "canceled" || s.kind === "ended";
    if(s.kind === "over") over++;
    if(s.kind === "today" || s.kind === "soon" || (s.kind === "ok" && s.n <= 6)) week++;
    /* 已完成 / 已取消的项即使残留阻塞标记也不再算当前卡点：与风险页同一取舍 */
    if(t.blocked && !finished) blocked++;
    if(!t.dueDate && !finished) noDue++;
    /* 未完成项才计入个人剩余：已完成 / 已取消 / 执行结束不再产生剩余工作量 */
    if(finished) return;
    var est = Number(t.estimateMinutes) || 0;
    if(est > 0) remainingMinutes += Math.max(0, est - (Number(t.totalMinutes) || 0));
    else missingEst++;
  });
  var loadPct = Math.round(remainingMinutes / capacity * 100);
  /* 第一枚统计只说「今天 + 在办数」，与原型一致；空间筛选是前端二次过滤，服务端「共」不随它变化 */
  var loadedTxt = filtering
    ? ('筛选出 <b>' + items.length + '</b> 项 · 已载入 <b>' + mineAll.length + '</b>')
    : ('今天 ' + fmtShortMD(rt.TODAY) + ' · <b>' + items.length + '</b> 项在办');
  mineStats.innerHTML =
    '<span class="mine-stat">' + loadedTxt + '</span>' +
    '<span class="mine-stat' + (over > 0 ? ' over' : '') + '">逾期 <b>' + over + '</b></span>' +
    '<span class="mine-stat">7 天内到期 <b>' + week + '</b></span>' +
    '<span class="mine-stat' + (blocked > 0 ? ' blocked' : '') + '">阻塞 <b>' + blocked + '</b></span>' +
    '<span class="mine-stat">未设截止 <b>' + noDue + '</b></span>' +
    '<span class="mine-stat personal' + (loadPct > 100 ? " over" : "") + '" title="已载入未完成项的剩余预估，对比 5 个工作日 40h">' +
      '个人剩余 <b>' + fmtMinutesShort(remainingMinutes) + '</b> · <b>' + loadPct + '%</b>' +
      caliberMarkHTML("mine.personalLoad", false, "查看个人负载口径") + '</span>' +
    (missingEst ? '<span class="mine-stat" title="未填预估的工作项不进入个人剩余计算">未估时 <b>' + missingEst + '</b></span>' : '') +
    '<span class="mine-stat-hint">统计基于已载入项'
      + caliberMarkHTML("mine.stats", false, "查看统计条口径") + '</span>';
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
  if(mineTestMode()){ btnMineFold.hidden = true; return; }
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
function mineMoreHTML(){
  if(mineHasMore){
    return '<div class="mine-more"><span class="foot-note">已显示 ' + mineAll.length + ' / 共 ' + mineTotal + ' 项</span>' +
      '<button class="btn sm ghost" type="button" data-mine-more>加载更多</button></div>';
  }
  if(mineAll.length){
    return '<div class="mine-more"><span class="foot-note">已显示 ' + mineAll.length + ' / 共 ' + Math.max(mineTotal, mineAll.length) + ' 项</span></div>';
  }
  return "";
}
function mineTaskFromRow(row){
  return mineCache[(row.dataset.mineWs || "") + "|" + row.dataset.mineId] || null;
}
/* 状态变更统一走 move：沿用流转矩阵的原因/强制弹窗，完成后同步计时与看板。
   presetReason 表示调用方已收集过原因（如测试退回），不再二次弹窗。 */
function mineChangeColumn(t, column, failText, presetReason){
  if(!t || !column || column === t.boardColumn) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var from = t.boardColumn;
  var items = [{ from: from, title: t.title }];
  function send(pass){
    var body = { column: column };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    return API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/move", body);
  }
  function ok(res){
    var to = (res && res.to) || column;
    var msg;
    if(to === "done" && from !== "done") msg = "已完成「" + t.title + "」";
    else if(from === "done" && to !== "done") msg = "已取消完成「" + t.title + "」";
    else msg = "「" + t.title + "」已移到「" + colName(to) + "」";
    if(res && res.autoTimerStarted) msg += " · 已开始计时";
    toast(msg, "fs");
    loadMine({silent:true});
    loadBoard({silent:true});
    loadRunningTimer();
  }
  guard(t.workspaceId, items, column, { reason: presetReason || null }).then(function(pass){
    if(!pass) return;
    var retried = false;
    send(pass).then(ok).catch(function(ex){
      if(retried){ toast(ex.message || failText, "bad"); return; }
      retried = true;
      serverDecision(t.workspaceId, items, column, ex).then(function(retry){
        if(!retry){ if(ex.code !== 412 && ex.code !== 422) toast(ex.message || failText, "bad"); return; }
        send(retry).then(ok).catch(function(e){ toast(e.message || failText, "bad"); });
      });
    });
  });
}
function mineComplete(t){
  mineChangeColumn(t, "done", "完成失败");
}
/* 优先级：复用任务保存接口，带上行数据里的 updatedAt 做并发校验 */
function mineInlinePut(t, patch, okMsg){
  var body = taskPayloadWith(t, patch);
  body.oldUpdatedAt = t.updatedAt || null;
  return API.putWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id), body).then(function(){
    toast(okMsg, "fs");
    loadMine({silent:true});
    loadBoard({silent:true});
    if(Object.prototype.hasOwnProperty.call(patch, "dueDate")) refreshCalendarIfOpen();
  });
}
function openMinePriorityMenu(anchor, t){
  var cur = t.priority || "P2";
  var el = document.createElement("div");
  el.className = "menu mine-cell-menu";
  el.innerHTML = PRIORITIES.map(function(p){
    var on = p === cur;
    return '<button class="menu-item' + (on ? " on" : "") + '" type="button" data-mine-pri="' + p + '">' +
      '<i class="mine-pri-bar" style="--c:' + esc(priColor(p, t.workspaceId)) + '"></i>' +
      '<span class="mine-cell-txt">' + esc(priName(p, t.workspaceId)) + '</span>' +
      (on ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-pri]");
    if(!b) return;
    UI.closeAllPops();
    var next = b.dataset.minePri;
    if(next === cur) return;
    mineInlinePut(t, { priority: next }, "优先级已调整为 " + priName(next, t.workspaceId))
      .catch(function(ex){
        toast(ex.message || "修改失败", "bad");
        if(ex.code === 409) loadMine({silent:true});
      });
  });
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
function openMineStatusMenu(anchor, t){
  var el = document.createElement("div");
  el.className = "menu mine-cell-menu";
  el.innerHTML = COLUMNS.map(function(c){
    var on = c.id === t.boardColumn;
    return '<button class="menu-item' + (on ? " on" : "") + '" type="button" data-mine-col="' + esc(c.id) + '">' +
      mineRingHTML(c.id) + '<span class="mine-cell-txt">' + esc(c.name) + '</span>' +
      (on ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-col]");
    if(!b) return;
    UI.closeAllPops();
    mineChangeColumn(t, b.dataset.mineCol, "移动失败");
  });
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
function openMineCellMenu(cell, t){
  if(!t) return;
  var kind = cell.dataset.mineCell;
  if(kind === "status"){ openMineStatusMenu(cell, t); return; }
  if(kind === "priority"){ openMinePriorityMenu(cell, t); return; }
  if(kind === "due") mineReschedule(cell, t);
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
    var boardMenu = e.target.closest("[data-mine-board-menu]");
    if(boardMenu){
      e.stopPropagation();
      var bCard = boardMenu.closest("[data-mine-id]");
      var bTask = bCard ? mineTaskFromRow(bCard) : null;
      if(bTask) openMineStatusMenu(boardMenu, bTask);
      return;
    }
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    /* 行内字段控件自己处理点击，不能顺带打开详情抽屉 */
    if(e.target.closest("select,input")) return;
    var t = mineTaskFromRow(row);
    if(e.target.closest("[data-test-claim]")){ e.stopPropagation(); mineTestClaim(t); return; }
    if(e.target.closest("[data-test-reject]")){ e.stopPropagation(); mineTestReject(t); return; }
    if(e.target.closest("[data-test-pass]")){ e.stopPropagation(); mineChangeColumn(t, "done", "测试通过失败"); return; }
    var cell = e.target.closest("[data-mine-cell]");
    if(cell){ e.stopPropagation(); openMineCellMenu(cell, t); return; }
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
  /* 看板拖拽：桌面专用，改状态统一走 mineChangeColumn（流转矩阵 + 原因/强推弹窗） */
  var mineDragTask = null;
  function clearMineDrop(){
    mineBody.querySelectorAll(".mb-col.is-drop").forEach(function(c){ c.classList.remove("is-drop"); });
    mineBody.querySelectorAll(".mb-card.is-dragging").forEach(function(c){ c.classList.remove("is-dragging"); });
  }
  mineBody.addEventListener("dragstart", function(e){
    if(mineViewMode !== "board" || isMobile()) return;
    var card = e.target.closest("[data-mine-board-card]");
    if(!card) return;
    var t = mineTaskFromRow(card);
    if(!t || !canEditTask(t)){ e.preventDefault(); return; }
    mineDragTask = t;
    card.classList.add("is-dragging");
    try{
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
    }catch(e2){ /* 老浏览器没有 dataTransfer 也允许拖 */ }
  });
  mineBody.addEventListener("dragover", function(e){
    if(!mineDragTask) return;
    var body = e.target.closest("[data-mine-col-drop]");
    if(!body) return;
    if((mineDragTask.boardColumn || "") === body.getAttribute("data-mine-col-drop")){
      try{ e.dataTransfer.dropEffect = "none"; }catch(e2){ /* noop */ }
      return;
    }
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = "move"; }catch(e2){ /* noop */ }
    var col = body.closest(".mb-col");
    if(col) col.classList.add("is-drop");
    /* 相邻列同时高亮会误导落点：只保留当前悬停列 */
    mineBody.querySelectorAll(".mb-col.is-drop").forEach(function(c){ if(c !== col) c.classList.remove("is-drop"); });
  });
  mineBody.addEventListener("dragleave", function(e){
    var body = e.target.closest("[data-mine-col-drop]");
    if(!body) return;
    /* dragleave 会在子元素之间冒泡，只有真正离开整列时才撤高亮 */
    if(e.relatedTarget && body.contains(e.relatedTarget)) return;
    var col = body.closest(".mb-col");
    if(col) col.classList.remove("is-drop");
  });
  mineBody.addEventListener("drop", function(e){
    var body = e.target.closest("[data-mine-col-drop]");
    if(!mineDragTask || !body) return;
    e.preventDefault();
    var t = mineDragTask, col = body.getAttribute("data-mine-col-drop");
    mineDragTask = null;
    clearMineDrop();
    if(!col || mineViewMode !== "board" || isMobile()) return;
    mineChangeColumn(t, col, "移动失败");
  });
  mineBody.addEventListener("dragend", function(){
    mineDragTask = null;
    clearMineDrop();
  });
}
if(mineSpaceFilter){
  mineSpaceFilter.addEventListener("change", function(){
    state.mineSpace = mineSpaceFilter.value || "";
    syncMineFilterMarks();
    rerenderMine();
  });
}
if(minePub){
  minePub.addEventListener("change", function(){
    /* 发布态是全局维度：与看板共用 state.pubState，切换后联动重载其它可见视图 */
    state.pubState = minePub.value === "published" || minePub.value === "unpublished" ? minePub.value : null;
    syncMineFilterMarks();
    reloadFilteredViews();
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
if(mineViewSeg){
  mineViewSeg.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-view]");
    if(b) setMineView(b.dataset.mineView);
  });
}
/* 跨断点重排：手机卡片 / 桌面表格共用同一份数据 */
window.addEventListener("ds:layout", function(){
  if(!rt.currentWs || document.body.dataset.view !== "mine") return;
  syncMineModeUI();
  syncMineViewUI();
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
function refreshMineIfOpen(){
  if(document.body.dataset.view !== "mine") return;
  if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
  else loadMine({silent:true});
}
window.addEventListener("ds:refresh-mine", refreshMineIfOpen);
window.addEventListener("ds:task-saved", refreshMineIfOpen);
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
syncMineViewUI();

export { askSwitchWorkspace, clearWorkspaceHandoff, enterMineView, loadMine, restoreWorkspaceHandoff, saveWorkspaceHandoff, wsNameById };
