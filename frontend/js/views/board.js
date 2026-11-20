/* views/board · 看板：加载、卡片、拖拽、列操作 */

import { API } from "../core/api.js";
import { loadCategories, pruneStaleFilters, updateTagDatalist } from "../core/app.js";
import { board, reqListEl } from "../core/dom.js";
import { reloadFilteredViews, renderFilterChips, saveViewState } from "../core/filters-ui.js";
import { boardParams, updateBrand, workpageScopeQuery } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { renderAlertBar } from "../core/notifications.js";
import { activeView, showView } from "../core/router.js";
import { loadPriorities } from "../core/priorities.js";
import { canCreateNow, canEditReq, canEditTask, catNameById, catTag, dueFlag, dueMetaClass, dueState, filterOn, progressOf, reqNameById, reqSetId, rt, safeColor, setNameById, state, tagChip, taskById, taskCacheExtra, timerAllowed, totalTaskCount } from "../core/state.js";
import { loadRunningTimer, openCardMenu, openDuePopover, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { guard, serverDecision } from "../core/transitions.js";
import { buildFormControls, deleteTask, openTaskDrawer, populateReqSelect, syncFormSegs } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { RECUR_LABEL, bindRetry, parseQuickAdd } from "../core/utils.js";
import { taskPublicationHTML, assocLinkHTML, CAT_DEFAULT_COLOR, COLUMNS, PALETTE, PRIORITIES, avatarHTML, colMeta, colName, dayDiff, elapsedText, fmtElapsed, fmtFull, fmtMinutes, fmtMinutesShort, fmtShortMD, fmtTs, localDatetime, mdLite, parseDate, priColor, priName, priTagHTML, recurLabel, severityBadgeHTML, syncColumns, taskDescText, typeBadgeHTML, weekdayCN } from "../lib/format.js";
import { loadView, viewModule } from "../core/view-loader.js";
import { initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { taskMemberLabel, syncTaskMemberTooltips } from "../lib/member-labels.js";

/* 看板页「!」：列处理规则、流转与发布徽标，口径与看板列配置 / 发布派生一致 */
registerHelp({
  "board.guide": {
    title: "看板状态流转与发布徽标",
    rows: [
      ["待处理", "系统列：不计时，逾期照常计算。新建工作项默认落这里。", "mute"],
      ["进行中", "系统列：正常计时，逾期照常计算。", "ok"],
      ["待测试", "默认暂停计时、仍算逾期；处理规则可在空间设置里改。", "type-story"],
      ["测试中", "默认正常计时；处理规则同样可改。", "type-story"],
      ["已完成", "固定结束计时、不计逾期。拖入即写完成归档快照，并停表、接力同列下一个任务。", "ok"],
      ["已取消", "终态，与已完成并列，不占看板列。任意非终态列都能取消（原因四选一 + 说明必填），只能恢复到取消前所在列；已完成要先取消完成。不计逾期、退出完成率与需求完成分母，进度保留原值。", "mute"],
      ["怎么流转", "拖动卡片、列表行内改状态或抽屉推进都会改列并写操作日志。拖进可计时列会自动开工（同一时刻只计一个任务），拖进不计时列会停表；从已完成拖出默认要填原因，也可在流转矩阵里改成禁止。", "mute"],
      ["发布徽标", "不是工作项字段，由成功正式生产发布记录派生：生产生效 / 生产部分生效 / 生产已回滚 / 生产覆盖未知；另有「曾生产发布」和「已发布（人工）」。", "warn"],
      ["回滚与人工", "回滚只撤销被回滚的那一次发布；人工标记只补「有没有发布过」，不带生效状态，也不参与需求交付统计。", "warn"],
      ["分组与筛选", "列永远是状态，列内分组只决定卡片归堆（负责人 / 优先级 / 项目 / 分类），拖拽语义不变。发布态用顶部筛选条的「发布态」，与徽标同一口径，看板、列表、层级、日历、甘特共用。", "mute"]
    ],
    note: "处理规则决定能不能计时、算不算逾期；能不能拖动由流转矩阵单独控制——默认全放开，只有从「已完成」拖出要求原因。",
    image: "diagrams/workitem-terminal-state.png",
    imageAlt: "沙漏·工作项终态机：主链五列，任意非终态列可取消进入已取消，已取消只能恢复到取消前所在列",
    imageCaption: "工作项终态机（点击图放大）：实线是现有列间推进，虚线是取消 / 恢复 / 重开。"
  }
});
initCaliberHelp();

/* 需求文档与分支是体积较大的低频视图：看板只用到「名称查询 + 点击跳转」，
   按需 import 即可，不再把两个模块钉进首屏静态依赖图。 */
function reqDocNameById(id){
  var m = viewModule("requirements");
  return m ? m.reqDocNameById(id) : null;
}
function branchNameById(id){
  var m = viewModule("branches");
  return m ? m.branchNameById(id) : "";
}
function loadReqDocsLazy(){
  loadView("requirements").then(function(m){ return m.loadReqDocs(); }).catch(function(){});
}
function openReqDoc(reqDocId){
  /* 加载失败的提示由 view-loader 统一给，这里不重复弹 */
  loadView("requirements").then(function(m){ m.openReqDocAndJump(reqDocId); }).catch(function(){});
}

/* 已完成是长期累积数据：看板只放最近 N 条，完整回看进「列状态工作页」 */
var DONE_BOARD_PREVIEW = 6;
/* 已完成列头的发布态快捷筛选：只作用于该列，下钻时以 pubState 带进工作页 */
var boardDonePub = "";
function donePubLabel(v){ return v === "published" ? "已发布" : (v === "unpublished" ? "未发布" : "全部"); }
/* 看板一屏只铺「当前在手」的量：首批与每次加载都按 20 条。
   更长的队列交给列头进度和列底「查看全部」进状态工作页，不靠一直往下拖。 */
var BOARD_PAGE_SIZE = 20;
/* 列内排序只影响看板展示，不改服务端保存的手动顺序；自动排序下该列停用拖拽 */
var COL_SORTS = ["manual", "due", "priority"];
var COL_SORT_LABEL = { manual: "手动", due: "截止日期", priority: "优先级" };
var COL_SORT_KEY = "ds.boardColSort.v1";
/* 回到顶部按钮在列内滚过约一屏后出现 */
var COL_TOP_AT = 360;
/* 列内分组：列仍是状态，组只决定卡片怎么归堆，拖拽语义不变。
   分组偏好按「账号 + 空间」记住，与列内排序同一套做法。 */
var BOARD_GROUPS = [["none", "不分组"], ["owner", "负责人"], ["priority", "优先级"], ["project", "项目"], ["set", "项目集"]];
var BOARD_GROUPS2 = [["none", "不分组"], ["owner", "负责人"], ["priority", "优先级"], ["project", "项目"], ["set", "项目集"]];
var BOARD_GROUP_KEY = "ds.boardGroup.v1";
var BOARD_GROUP2_KEY = "ds.boardGroup2.v1";
var BOARD_GROUP_FOLD_KEY = "ds.boardGroupFold.v1";
function boardPrefKey(name){
  var u = (rt.currentUser && rt.currentUser.id) || "";
  var w = (rt.currentWs && rt.currentWs.id) || "";
  return name + ":" + u + ":" + w;
}
function readBoardGroupPref(key, list){
  var v = "";
  try{ v = localStorage.getItem(boardPrefKey(key)); }catch(e){ return "none"; }
  for(var i = 0; i < list.length; i++) if(list[i][0] === v) return v;
  return "none";
}
function readBoardGroup(){
  return readBoardGroupPref(BOARD_GROUP_KEY, BOARD_GROUPS);
}
function readBoardGroup2(){
  return readBoardGroupPref(BOARD_GROUP2_KEY, BOARD_GROUPS2);
}
/* 模块加载时空间可能还没就绪（登录/切空间后才写入 rt.currentWs），
   所以不能只读一次：按「账号 + 空间」的键变化时重新取。 */
var boardGroup = "none";
var boardGroupKeySeen = "";
function currentBoardGroup(){
  var k = boardPrefKey(BOARD_GROUP_KEY);
  if(k !== boardGroupKeySeen){ boardGroupKeySeen = k; boardGroup = readBoardGroup(); }
  return boardGroup;
}
var boardGroup2 = "none";
var boardGroup2KeySeen = "";
function currentBoardGroup2(){
  if(currentBoardGroup() === "none") return "none";
  var k = boardPrefKey(BOARD_GROUP2_KEY);
  if(k !== boardGroup2KeySeen){ boardGroup2KeySeen = k; boardGroup2 = readBoardGroup2(); }
  return boardGroup2;
}
/* BOARD-4：列等分后仍放不下时，右缘给「还有 N 列」浮标；纯提示，不改变列语义 */
var boardMorePill = null;
function ensureBoardMorePill(){
  if(boardMorePill) return boardMorePill;
  var toolbar = document.getElementById("boardToolbar");
  if(!toolbar) return null;
  boardMorePill = document.createElement("button");
  boardMorePill.type = "button";
  boardMorePill.className = "board-more-pill";
  boardMorePill.setAttribute("aria-label", "向右查看其余看板列");
  boardMorePill.addEventListener("click", function(){
    board.scrollBy({ left: Math.max(240, board.clientWidth * 0.8), behavior: "smooth" });
  });
  toolbar.insertBefore(boardMorePill, document.getElementById("boardDisplay"));
  return boardMorePill;
}
function updateBoardOverflow(){
  var pill = ensureBoardMorePill();
  if(!pill) return;
  var hidden = 0;
  if(!board.classList.contains("board-mobile")){
    var box = board.getBoundingClientRect();
    board.querySelectorAll(".board-col").forEach(function(col){
      if(col.getBoundingClientRect().right > box.right + 4) hidden++;
    });
  }
  pill.classList.toggle("on", hidden > 0);
  if(hidden) pill.textContent = "还有 " + hidden + " 列 →";
  var section = document.getElementById("view-board");
  if(section) section.classList.toggle("board-more-right", hidden > 0);
}
function readGroupFolds(){
  try{ return JSON.parse(localStorage.getItem(boardPrefKey(BOARD_GROUP_FOLD_KEY)) || "{}") || {}; }
  catch(e){ return {}; }
}
function groupFoldId(colId, key){ return colId + "|" + key; }
function isGroupFolded(colId, key){ return !!readGroupFolds()[groupFoldId(colId, key)]; }
function toggleGroupFold(colId, key){
  var all = readGroupFolds(), id = groupFoldId(colId, key);
  if(all[id]) delete all[id]; else all[id] = 1;
  try{ localStorage.setItem(boardPrefKey(BOARD_GROUP_FOLD_KEY), JSON.stringify(all)); }
  catch(e){ /* 受限环境只改本次会话 */ }
  render({animate:false});
}
function setBoardGroup(v){
  var ok = false;
  for(var i = 0; i < BOARD_GROUPS.length; i++) if(BOARD_GROUPS[i][0] === v) ok = true;
  if(!ok || currentBoardGroup() === v) return;
  boardGroup = v;
  boardGroupKeySeen = boardPrefKey(BOARD_GROUP_KEY);
  try{ localStorage.setItem(boardPrefKey(BOARD_GROUP_KEY), v); }
  catch(e){ /* 受限环境只改本次会话 */ }
  /* 一级回到不分组时，二级也一起清掉：避免下拉显示不分组却仍在分组；
     两级选同一维度没有意义，一级改了就把撞车的二级清掉 */
  if(v === "none" || v === boardGroup2){
    boardGroup2 = "none";
    boardGroup2KeySeen = boardPrefKey(BOARD_GROUP2_KEY);
    try{ localStorage.setItem(boardPrefKey(BOARD_GROUP2_KEY), "none"); }catch(e){ /* noop */ }
  }
  renderBoardGroupControls();
  render({animate:false});
}
function setBoardGroup2(v){
  var ok = false;
  for(var i = 0; i < BOARD_GROUPS2.length; i++) if(BOARD_GROUPS2[i][0] === v) ok = true;
  if(!ok || currentBoardGroup() === "none" || currentBoardGroup2() === v) return;
  boardGroup2 = v;
  boardGroup2KeySeen = boardPrefKey(BOARD_GROUP2_KEY);
  try{ localStorage.setItem(boardPrefKey(BOARD_GROUP2_KEY), v); }
  catch(e){ /* 受限环境只改本次会话 */ }
  renderBoardGroupControls();
  render({animate:false});
}
function renderBoardGroupControls(){
  var sel = document.getElementById("boardGroupSelect");
  var sel2 = document.getElementById("boardGroup2Select");
  if(!sel || !sel2) return;
  if(!sel.childElementCount){
    sel.innerHTML = BOARD_GROUPS.map(function(g){
      return '<option value="' + g[0] + '">' + g[1] + '</option>';
    }).join("");
  }
  var cur = currentBoardGroup(), cur2 = currentBoardGroup2();
  /* 二级下拉排除一级已选的维度：同一维度分两级只是重复自己 */
  if(cur !== "none" && cur2 === cur){
    cur2 = "none";
    boardGroup2 = "none";
    boardGroup2KeySeen = boardPrefKey(BOARD_GROUP2_KEY);
    try{ localStorage.setItem(boardPrefKey(BOARD_GROUP2_KEY), "none"); }catch(e){ /* noop */ }
  }
  sel2.innerHTML = BOARD_GROUPS2.filter(function(g){
    return g[0] === "none" || g[0] !== cur;
  }).map(function(g){
    return '<option value="' + g[0] + '">' + g[1] + '</option>';
  }).join("");
  sel.value = cur;
  sel2.value = cur2;
  sel2.disabled = cur === "none";
  var echo = document.getElementById("boardDisplayEcho");
  if(echo){
    var hit = BOARD_GROUPS.filter(function(g){ return g[0] === cur; })[0];
    echo.textContent = hit ? hit[1] : "不分组";
  }
}
function groupValue(t, dim){
  if(dim === "owner") return t.owner || "";
  if(dim === "priority") return t.priority || "";
  if(dim === "project") return t.reqId || "";
  if(dim === "set") return reqSetId(t.reqId);
  return "";
}
/* 项目名优先取看板 meta（筛选器已用它出项目名单），其次取需求列表缓存 */
function boardReqLabel(id){
  var list = (state.board && state.board.meta && state.board.meta.reqs) || [];
  for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i].name;
  var name = reqNameById(id);
  return name && name !== "无" ? name : id;
}
function groupLabel(t, dim){
  var v = groupValue(t, dim);
  if(!v) return dim === "priority" ? "未设优先级" : (dim === "project" ? "未归类" : "未指定");
  if(dim === "project") return boardReqLabel(v);
  if(dim === "set") return setNameById(v) || v;
  return v;
}
function groupRank(key, dim){
  if(!key) return 9999;
  if(dim === "priority"){
    var i = PRIORITIES.indexOf(key);
    return i < 0 ? 500 : i;
  }
  return 0;
}
function groupColumnItems(items, dim){
  if(dim === "none") return [{key:"__all", label:"", items:items}];
  var map = {}, out = [];
  items.forEach(function(t){
    var k = groupValue(t, dim) || "__none";
    if(!map[k]){ map[k] = {key:k, label:groupLabel(t, dim), items:[]}; out.push(map[k]); }
    map[k].items.push(t);
  });
  out.sort(function(a, b){
    var ra = groupRank(a.key === "__none" ? "" : a.key, dim);
    var rb = groupRank(b.key === "__none" ? "" : b.key, dim);
    if(ra !== rb) return ra - rb;
    if(a.key === "__none") return 1;
    if(b.key === "__none") return -1;
    return String(a.label).localeCompare(String(b.label), "zh-Hans-CN");
  });
  return out;
}
/* 两级分组：一级仍按状态列归堆，列内先按 groupDim 分大组，再按 groupDim2 分子组 */
function groupColumnTree(items, dim1, dim2){
  var groups = groupColumnItems(items, dim1);
  if(dim1 === "none" || dim2 === "none") return groups;
  groups.forEach(function(g){ g.subgroups = groupColumnItems(g.items, dim2); });
  return groups;
}

function colSortKey(){
  var u = (rt.currentUser && rt.currentUser.id) || "";
  var w = (rt.currentWs && rt.currentWs.id) || "";
  return COL_SORT_KEY + ":" + u + ":" + w;
}
function readColSorts(){
  try{ return JSON.parse(localStorage.getItem(colSortKey()) || "{}") || {}; }catch(e){ return {}; }
}
function colSortOf(colId){
  var v = readColSorts()[colId];
  return COL_SORTS.indexOf(v) >= 0 ? v : "manual";
}
function setColSort(colId, mode){
  if(COL_SORTS.indexOf(mode) === -1) return;
  var all = readColSorts();
  if(mode === "manual") delete all[colId];
  else all[colId] = mode;
  try{ localStorage.setItem(colSortKey(), JSON.stringify(all)); }catch(e){ /* 受限环境忽略 */ }
}
function colSortRank(code){
  var i = PRIORITIES.indexOf(code);
  return i < 0 ? 99 : i;
}
function sortColumnItems(items, colId){
  /* 已完成列固定按完成时间预览，不参与列内排序 */
  if(colId === "done") return items;
  var mode = colSortOf(colId);
  if(mode === "manual") return items;
  var arr = items.slice();
  if(mode === "due"){
    arr.sort(function(a, b){
      var ad = a.dueDate ? parseDate(a.dueDate) : null;
      var bd = b.dueDate ? parseDate(b.dueDate) : null;
      var av = ad ? ad.getTime() : Infinity;
      var bv = bd ? bd.getTime() : Infinity;
      if(av === bv) return 0;
      return av < bv ? -1 : 1;
    });
  }else if(mode === "priority"){
    arr.sort(function(a, b){ return colSortRank(a.priority) - colSortRank(b.priority); });
  }
  return arr;
}
function syncBoardMemberTooltips(){
  var tasks = [];
  if(state.board && state.board.columns) Object.keys(state.board.columns).forEach(function(k){ tasks = tasks.concat(state.board.columns[k].items || []); });
  syncTaskMemberTooltips(board, tasks);
}
["ds:project-roles-changed", "ds:member-company-changed", "ds:member-job-title-changed", "ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(){ if(activeView === "board") syncBoardMemberTooltips(); });
});

function showBoardSkeleton(){
  board.classList.remove("busy");
  if(isMobile()){
    board.innerHTML = '<div class="mob-board">' +
      '<div class="mob-col-seg"><span class="skel" style="width:120px;height:34px;border-radius:10px"></span>' +
        '<span class="skel" style="width:90px;height:34px;border-radius:10px"></span></div>' +
      '<div class="mob-board-list">' + UI.skeletonCards(3) + '</div></div>';
    return;
  }
  var h = "";
  for(var i = 0; i < 3; i++){
    h += '<div class="board-col"><div class="board-col-head">' +
      '<span class="skel" style="width:60px;height:12px"></span></div>' +
      '<div class="board-col-body">' + UI.skeletonCards(3) + '</div></div>';
  }
  board.innerHTML = h;
}
function showBoardError(msg){
  board.classList.remove("busy");
  board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:60vh">' +
    UI.errorState(msg) + '</div>';
  bindRetry(board, function(){ state.board = null; loadBoard({animate:true}); });
}
function openColumnWorkpage(colId, range){
  if(!colId) return;
  /* 把看板当前筛选带进子页面：进入后看到的仍是这一批工作项，而不是整列全量 */
  var scope = workpageScopeQuery();
  /* 已完成是长期累积：进入工作页始终按全部历史取数（单次仍分页），避免只看到本周几条 */
  if(colId === "done") range = "all";
  if(colId === "done" && boardDonePub){
    /* 列头筛选只属于已完成列：去掉全局发布态，避免与它互相覆盖 */
    scope = scope.split("&").filter(function(p){ return p.indexOf("pubState=") !== 0; }).join("&");
  }
  var hash = "#/workcolumn?col=" + encodeURIComponent(colId);
  if(range) hash += "&range=" + encodeURIComponent(range);
  if(scope) hash += "&" + scope;
  if(colId === "done" && boardDonePub) hash += "&pubState=" + encodeURIComponent(boardDonePub);
  try{ history.pushState(null, "", hash); }
  catch(e){ window.location.hash = hash; }
  showView("workcolumn");
}
function loadBoard(opts){
  opts = opts || {};
  /* 发布态一个维度只留一个生效值：顶部全局筛选在时，以它为准 */
  if(state.pubState) boardDonePub = "";
  var seq = ++state.loadSeq;
  if(!opts.silent){
    if(!state.board) showBoardSkeleton();
    else { board.classList.add("busy"); UI.syncBusy(true); opts._busy = true; }
  }
  return Promise.all([API.get("/api/board", boardParams({doneLimit: DONE_BOARD_PREVIEW, openLimit: BOARD_PAGE_SIZE, donePubState: boardDonePub || null})), loadPriorities()]).then(function(rs){
    var data = rs[0];
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    state.board = data;
    state.boardGen++;
    syncCanceledBadge();
    syncColumns(data.columnDefs);
    buildFormControls();
    syncFormSegs();
    updateTagDatalist();
    loadCategories();
    if(pruneStaleFilters(data.meta)){ saveViewState(); loadBoard({silent:true}); return; }
    board.classList.remove("busy");
    /* 筛选栏与看板解耦：render() 在非看板视图会早退，此前筛选 chips 只在看板渲染，
       直接进列表/日历等页面时负责人/优先级/类型/更多筛选全部空白 */
    renderFilterChips();
    render({animate: !!opts.animate});
    /* 计时状态加载后由 ds:running-timer 监听统一重绘，避免这里与监听器各渲染一次 */
    loadRunningTimer();
    /* 卡片上的需求名来自需求列表（首次加载后会重绘一次） */
    loadReqDocsLazy();
  }).catch(function(ex){
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    board.classList.remove("busy");
    if(!state.board) showBoardError(ex.message || "网络异常，请稍后重试");
    else toast("加载失败：" + (ex.message || "网络异常"), "bad");
  });
}
var reqLoadSeq = 0, reqsPending = null, reqsPendingWs = "";
function loadReqs(){
  /* 启动、报表/投入入口、看板刷新可能同时触发：同一空间复用进行中的请求，
     避免重复拉全量项目列表；换空间时按新空间另发一次。 */
  var wsId = rt.currentWs && rt.currentWs.id;
  if(reqsPending && reqsPendingWs === wsId) return reqsPending;
  var seq = ++reqLoadSeq;
  reqsPendingWs = wsId || "";
  /* 项目集与项目并行取：所有项目下拉都要按集分组，不能等某个视图单独补 */
  var pending = Promise.all([
    API.getAllPages("/api/reqs"),
    API.get("/api/project-sets").catch(function(){ return rt.projectSets || []; })
  ]).then(function(res){
    if(seq !== reqLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    var list = res[0];
    if(Array.isArray(res[1])) rt.projectSets = res[1];
    rt.reqList = list || [];
    rt.reqsLoaded = true;
    populateReqSelect();
    try{ window.dispatchEvent(new CustomEvent("ds:reqs-loaded")); }catch(e){ /* 非浏览器环境 */ }
    if(activeView === "projects") loadView("projects").then(function(m){ m.renderReqList(); });
  }).catch(function(){
    if(seq !== reqLoadSeq) return;
    if(activeView === "projects" && !rt.reqsLoaded && reqListEl){
      reqListEl.innerHTML = UI.errorState("项目加载失败，请稍后重试");
    }
  });
  var wrapped = pending.then(function(){
    if(reqsPending === wrapped){ reqsPending = null; reqsPendingWs = ""; }
  });
  reqsPending = wrapped;
  return wrapped;
}
function loadMoreColumn(colId){
  var cd = state.board && state.board.columns[colId];
  if(!cd || !cd.hasMore) return Promise.resolve(false);
  var gen = state.boardGen;
  var offset = cd.items.length;
  var listEl = board.querySelector('.board-col[data-col="' + colId + '"] .board-col-body') ||
    board.querySelector(".mob-board-list");
  if(listEl) listEl.classList.add("loading-more");
  UI.syncBusy(true);
  return API.get("/api/tasks/column", boardParams({col: colId, offset: offset, limit: BOARD_PAGE_SIZE})).then(function(page){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen !== state.boardGen) return false;
    var known = {};
    cd.items.forEach(function(t){ known[t.id] = 1; });
    (page.items || []).forEach(function(t){ if(!known[t.id]) cd.items.push(t); });
    cd.matched = page.matched;
    cd.total = page.total;
    cd.hasMore = cd.items.length < page.matched;
    render({animate:false});
    return true;
  }).catch(function(ex){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen === state.boardGen) toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function refreshBoardPreserving(){
  loadBoard({silent:true});
}
function testStripHTML(t, editable){
  var col = t.boardColumn;
  var tester = t.testOwner || t.testOwnerUserId || "";
  var isDone = col === "done";
  if(col !== "test" && col !== "testing" && !(isDone && tester)) return "";
  var claimBtn = '<button type="button" class="ct-claim" data-test-claim="' + esc(t.id) + '">开始测试</button>';
  if(col === "test"){
    if(tester){
      return '<div class="card-test"><span class="ct-lbl">测试</span>' +
        '<span class="ct-who">' + avatarHTML(tester) + esc(tester) + '</span>' +
        '<span class="ct-tag">等待验证</span>' +
        '<span class="ct-since">' + (t.testRequestedAt ? "提测 " + esc(elapsedText(t.testRequestedAt)) + "前" : "") + '</span></div>';
    }
    var waited = elapsedText(t.testRequestedAt);
    var hot = t.testRequestedAt && (Date.now() - new Date(t.testRequestedAt).getTime()) >= 3 * 86400000;
    return '<div class="card-test"><span class="ct-wait' + (hot ? " hot" : "") + '">待领取' +
      (waited ? ' · 已等待 ' + esc(waited) : "") + '</span>' +
      (editable ? claimBtn : '') + '</div>';
  }
  if(col === "testing"){
    var measured = t.testStartedAt ? ("已测 " + elapsedText(t.testStartedAt)) : "刚开始";
    return '<div class="card-test"><span class="ct-lbl">测试</span>' +
      (tester ? '<span class="ct-who">' + avatarHTML(tester) + esc(tester) + '</span>'
              : '<span class="ct-wait hot">待领取</span>') +
      '<span class="ct-tag">' + esc(measured) + '</span>' +
      (t.testStartedAt
        ? '<span class="ct-since" title="' + esc(fmtTs(t.testStartedAt)) + '">' + esc(fmtShortMD(parseDate(t.testStartedAt))) + '</span>'
        : (editable && !tester ? claimBtn : '')) + '</div>';
  }
  return '<div class="card-test"><span class="ct-lbl">测试</span>' +
    '<span class="ct-who">' + avatarHTML(tester) + esc(tester) + '</span>' +
    (t.testFinishedAt ? '<span class="ct-tag">' + esc(fmtTs(t.testFinishedAt)) + ' 完成</span>' : '') + '</div>';
}
function cardHTML(t, idx){
  var s = dueState(t);
  var isDone = t.boardColumn === "done";
  var blocked = !!t.blocked;
  /* 只读项目：隐藏写操作，但保留「更多」以打开详情/复制链接 */
  var editable = canEditTask(t);
  /* 只有"我自己"正在计时的任务才高亮；别人的计时在卡上不体现（工时是个人口径） */
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 色条只表达状态：完成绿、阻塞琥珀、逾期红、其余中性；优先级已在卡片头部用 P 标签表达 */
  var stripe = isDone ? "var(--success)"
    : (blocked ? "var(--warning)" : (s.kind === "over" ? "var(--danger)" : "var(--border-strong)"));
  var tip = t.dueDate ? ("截止 " + fmtFull(parseDate(t.dueDate)) + " " + weekdayCN(parseDate(t.dueDate))) : "未设置截止日期";
  if(isDone && t.completedAt) tip += " · 完成于 " + fmtFull(parseDate(t.completedAt)) + " " + weekdayCN(parseDate(t.completedAt));

  var tagsHTML = catTag(t.categoryId);
  /* 关联文档：点一下跳到正文（不打开任务抽屉，所以单独用 data-open-reqdoc） */
  if(t.reqDocId){
    var docTitle = reqDocNameById(t.reqDocId);
    if(docTitle){
      tagsHTML += '<button type="button" class="tag tag-doc" data-open-reqdoc="' + esc(t.reqDocId) + '"' +
        ' title="打开文档：' + esc(docTitle) + '">' + esc(docTitle) + '</button>';
    }
  }
  if(t.branchId){
    /* 分支标签可点跳转分支详情；捕获阶段全局委托先于卡片「开抽屉」命中，不会误开抽屉 */
    var brName = branchNameById(t.branchId);
    if(brName) tagsHTML += assocLinkHTML("branch", t.branchId, brName, {cls:"tag tag-branch", html:icon("branch", 11) + esc(brName), title:"打开分支：" + brName});
  }
  if(t.tags && t.tags.length){
    t.tags.slice(0, 2).forEach(function(tg){ tagsHTML += tagChip(tg); });
    if(t.tags.length > 2) tagsHTML += '<span class="tag tag-ghost">+' + (t.tags.length - 2) + '</span>';
  }

  var blockedTag = blocked
    ? '<span class="blocked-tag" title="' + esc(t.blockedReason || "被阻塞（未填原因）") + '">' +
        icon("alert", 12) + '被阻塞</span>'
    : "";

  var metaHTML = "";
  if(t.dueDate) metaHTML += '<span class="' + dueMetaClass(s.kind) + '" title="' + esc(tip) + '">' +
    icon("calSmall", 14) + esc(fmtShortMD(parseDate(t.dueDate))) + '</span>';
  var dueF = dueFlag(t);
  if(dueF) metaHTML += '<span class="mini-tag ' + (dueF.kind === "over" ? "over" : (dueF.kind === "today" ? "warn" : "")) + '">' + esc(dueF.text) + '</span>';
  if(t.subtaskTotal){
    var allSub = t.subtaskDone >= t.subtaskTotal;
    metaHTML += '<span class="meta' + (allSub ? " full" : "") + '" title="子任务（检查清单）完成 ' +
      t.subtaskDone + '/' + t.subtaskTotal + '">' +
      icon("checklist", 14) + '子任务 ' + t.subtaskDone + '/' + t.subtaskTotal + '</span>';
  }
  if(Number(t.attachmentCount) > 0){
    metaHTML += '<span class="meta" title="附件">' + icon("clip", 14) + t.attachmentCount + '</span>';
  }
  if(Number(t.commentCount) > 0){
    metaHTML += '<span class="meta" title="评论">' + icon("comment", 14) + t.commentCount + '</span>';
  }
  if(t.estimateMinutes){
    /* 有预估就显示「实际/预估」：光看实际用了几小时没人知道自己算不算慢。
       计时中的工作项同样要显示 —— 那正是最该知道自己快超了的时候；
       此时实际值只含已结束的段，title 里说明，避免误读。 */
    var actMin = Number(t.totalMinutes) || 0;
    var estR = actMin / t.estimateMinutes;
    var estCls = estR >= 1 ? " over" : (estR >= 0.8 ? " near" : "");
    metaHTML += '<span class="meta est-chip' + estCls + '" title="实际 ' + fmtMinutes(actMin) +
      (running ? '（不含正在计的这一段）' : '') + ' / 预估 ' + fmtMinutes(t.estimateMinutes) + '">' +
      (running ? '' : icon("timer", 14)) +
      fmtMinutesShort(actMin) + '/' + fmtMinutesShort(t.estimateMinutes) + '</span>';
  }else if(t.totalMinutes && !running){
    metaHTML += '<span class="meta' + (isDone ? ' full' : '') + '" title="' + (isDone ? "总耗时" : "累计工时") + '">' +
      icon("timer", 14) + (isDone ? '总耗时 ' : '') + fmtMinutesShort(t.totalMinutes) + '</span>';
  }
  if(running){
    /* 计时中的停止入口放在 meta 行（胶囊按钮）。放右上角会常驻挡住卡片标题 */
    metaHTML = '<button class="timer-chip" type="button" data-timer-toggle="' + esc(t.id) + '" title="点击停止计时">' +
      icon("pause", 12) + '<span>计时中</span><b data-elapsed>' +
      fmtElapsed(state.runningTimer.elapsedMinutes) + '</b></button>' + metaHTML;
  }
  if(t.recurType){
    metaHTML += '<span class="meta" title="循环任务：' + recurLabel(t.recurType) + '">' + icon("recur", 14) + '</span>';
  }
  if(t.remindAt && !isDone){
    metaHTML += '<span class="meta" title="提醒 ' + esc(fmtTs(t.remindAt)) + '">' + icon("bell", 14) + fmtTs(t.remindAt) + '</span>';
  }

  var p = progressOf(t);
  /* BOARD-4：0% 不占行，只有真实进度或完成态才画进度条 */
  var progHTML = p > 0
    ? '<div class="progress' + (p >= 100 ? " full" : "") + (s.kind === "over" && p < 100 ? " over" : "") +
      '" title="当前进度 ' + p + '%"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></div>'
    : '';
  var owner = t.owner || "—";

  return '<article class="card' + (isDone ? " is-done" : "") + (blocked ? " is-blocked" : "") +
      (s.kind === "over" ? " is-over" : "") +
      '" data-id="' + esc(t.id) + '" tabindex="0" role="listitem" draggable="false"' +
      ' style="--stripe:' + stripe + '" aria-label="' + esc(t.title) + '">' +
    '<div class="card-acts">' +
      /* 「开始计时」放动作区（hover 出现）；已在计时时不放 —— 停止入口在 meta 行的胶囊里，
         否则常驻的绿色按钮会盖住卡片标题 */
      (editable && !running && timerAllowed(t)
        ? '<button class="card-act low" type="button" data-timer-toggle="' + esc(t.id) + '"' +
            ' title="开始计时（会自动暂停其他工作项的计时）" aria-label="开始计时：' + esc(t.title) + '">' +
            icon("timer", 13) + '</button>'
        : '') +
      (editable
        ? '<button class="card-act low" type="button" data-due-pop="' + esc(t.id) + '" title="改期（快捷键 D）" aria-label="改期：' + esc(t.title) + '">' +
            icon("calSmall", 13) + '</button>'
        : '') +
      '<button class="card-act always" type="button" data-card-menu="' + esc(t.id) + '" title="更多操作" aria-haspopup="true" aria-label="更多操作：' + esc(t.title) + '">' +
        icon("more", 14) + '</button>' +
    '</div>' +
    '<div class="card-head">' +
      '<span class="pri-mark">' +
        '<span class="card-tickwrap">' +
          (isDone
            ? '<span class="pdot-ico" style="color:var(--success-fg)">' + icon("check", 13) + '</span>'
            : priTagHTML(t.priority, null, true)) +
          (editable
            ? '<button class="card-tick" type="button" data-done-toggle="' + esc(t.id) + '"' +
                ' title="' + (isDone ? "取消完成（快捷键 X）" : "标记完成（快捷键 X）") + '"' +
                ' aria-label="' + (isDone ? "取消完成" : "标记完成") + '：' + esc(t.title) + '">' +
                icon(isDone ? "undo" : "check", 11) + '</button>'
            : '') +
        '</span>' +
        (isDone ? '' : '<span class="pdot ' + esc(t.priority) + '" style="--p-c:' + esc(priColor(t.priority)) + '">' + esc(priName(t.priority)) + '</span>') +
      '</span>' +
      '<h3 class="card-title">' + typeBadgeHTML(t.itemType) + severityBadgeHTML(t.severity) + esc(t.title) + '</h3>' +
    '</div>' +
    (t.description ? '<p class="card-desc">' + mdLite(taskDescText(t.description, 200)) + '</p>' : '') +
    ((tagsHTML || blockedTag || !editable || taskPublicationHTML(t))
      ? '<div class="card-tags">' +
          taskPublicationHTML(t) +
          (editable ? '' : '<span class="tag tag-ghost" title="你对该项目只有查看权限">' + icon("eye", 11) + '只读</span>') +
          blockedTag + tagsHTML + '</div>'
      : '') +
    (metaHTML ? '<div class="card-meta">' + metaHTML + '</div>' : '') +
    testStripHTML(t, editable) +
    '<div class="card-foot">' + progHTML +
      '<span data-member-task="' + esc(t.id) + '" title="负责人：' + esc(owner) + (taskMemberLabel(t) ? ' · ' + esc(taskMemberLabel(t)) : '') + '">' + avatarHTML(owner) + '</span>' +
    '</div>' +
  '</article>';
}
function cardAddHTML(colId){
  /* 查看者或没有任何可写项目：不渲染创建入口，避免点了才被后端拒绝 */
  if(!canCreateNow()) return "";
  return '<button class="card-add" type="button" data-add="' + esc(colId) + '" aria-label="在「' + esc(colName(colId)) + '」新建工作项">' +
    icon("plus", 13) + ' 添加工作项</button>';
}
var mobCol = null;
function mobileColId(){
  for(var i = 0; i < COLUMNS.length; i++) if(COLUMNS[i].id === mobCol) return mobCol;
  mobCol = COLUMNS.length ? COLUMNS[0].id : "backlog";
  return mobCol;
}
function syncMobSegEdges(seg){
  if(!seg) return;
  var max = seg.scrollWidth - seg.clientWidth;
  seg.classList.toggle("seg-less", seg.scrollLeft > 2);
  seg.classList.toggle("seg-more", max - seg.scrollLeft > 2);
}
function centerMobSegActive(seg){
  var active = seg.querySelector(".mob-col-btn.on");
  if(!active || seg.scrollWidth <= seg.clientWidth) return;
  var sr = seg.getBoundingClientRect(), ar = active.getBoundingClientRect();
  seg.scrollLeft += (ar.left - sr.left) - (sr.width - ar.width) / 2;
}
window.addEventListener("resize", function(){
  syncMobSegEdges(document.querySelector(".mob-col-seg"));
  if(activeView === "board") updateBoardOverflow();
});
function renderMobileBoard(opts){
  opts = opts || {};
  updateBrand();
  if(activeView !== "board"){
    rt.boardDirty = true;
    return;
  }
  rt.boardDirty = false;
  UI.hideTip();
  if(!state.board) return;

  board.classList.add("board-mobile");
  if(totalTaskCount() === 0 && !filterOn()){
    var canNewMob = canCreateNow();
    board.innerHTML = '<div class="mob-board">' +
      UI.emptyState({
        icon:"board",
        title:"看板还是空的",
        text: canNewMob
          ? "点击右下角「新建」创建第一个工作项，数据会实时同步到其他端。"
          : "当前空间还没有工作项。你是查看者或没有可写项目，只能浏览。",
        actionLabel: canNewMob ? "新建第一项工作项" : ""
      }) + '</div>';
    if(canNewMob) bindRetry(board, function(){ openTaskDrawer("backlog"); });
    renderAlertBar(); renderFilterChips();
    return;
  }

  var active = mobileColId();
  var seg = '<div class="mob-col-seg" role="tablist" aria-label="看板列">' + COLUMNS.map(function(c){
    var cd = state.board.columns[c.id] || {};
    var n = (filterOn() || (c.id === "done" && boardDonePub)) ? ((cd.matched || 0) + "/" + (cd.total || 0)) : (cd.total || 0);
    return '<button class="mob-col-btn' + (c.id === active ? " on" : "") + '" type="button" role="tab" ' +
      'aria-selected="' + (c.id === active) + '" data-mob-col="' + esc(c.id) + '">' +
      '<i style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></i>' +
      '<span class="mob-col-name">' + esc(c.name) + '</span><b>' + esc(n) + '</b></button>';
  }).join("") + '</div>';

  var cd = state.board.columns[active] || {items:[], matched:0, total:0, allTotal:0, hasMore:false};
  var items = sortColumnItems((cd.items || []).slice(), active);
  var listHTML;
  if(!items.length){
    var mobFiltered = filterOn() || (active === "done" && !!boardDonePub);
    var emptyTitle = mobFiltered ? "无匹配工作项" : "这一列还没有工作项";
    var emptyDesc = mobFiltered ? "调整筛选条件后再看" : "从下面新建，或把别的列拖过来";
    listHTML = UI.emptyState({ icon:"inbox", title:emptyTitle, text:emptyDesc, actionLabel: canCreateNow() ? "新建工作项" : "", compact:true });
  }else{
    listHTML = items.map(function(t){ return cardHTML(t, 0); }).join("");
  }
  if(active !== "done" && cd.hasMore){
    listHTML += '<button class="btn mob-load-more" type="button" data-more="1">加载更多（还有 ' +
      Math.max((cd.matched || 0) - items.length, 0) + ' 项）</button>';
  }
  var activeCol = colMeta(active) || {};
  /* 移动端列入口文案：直接给数量与去向，不用「进入…状态工作页」的绕口说法 */
  var mobCount = (filterOn() || (active === "done" && boardDonePub)) ? (cd.matched || 0) : (cd.total || 0);
  var stageLink = '<button class="btn mob-stage-link" type="button" data-col-open="' + esc(active) + '"' +
    (active === "done" ? ' data-col-range="all"' : '') + '>' +
    esc(activeCol.name || active) + ' ' + mobCount + ' 项 →' +
    '</button>';

  board.innerHTML = '<div class="mob-board">' + seg + stageLink +
    '<div class="mob-board-list" role="list">' + listHTML + cardAddHTML(active) + '</div></div>';

  var mobSeg = board.querySelector(".mob-col-seg");
  if(mobSeg){
    centerMobSegActive(mobSeg);
    syncMobSegEdges(mobSeg);
    mobSeg.addEventListener("scroll", function(){ syncMobSegEdges(mobSeg); }, {passive:true});
  }

  var emptyBtn = board.querySelector(".empty-state [data-empty-action]");
  if(emptyBtn) emptyBtn.addEventListener("click", function(){ openTaskDrawer(active); });

  var movedId = opts.movedId;
  if(movedId){
    var el = board.querySelector('.card[data-id="' + movedId + '"]');
    if(el && el.scrollIntoView) el.scrollIntoView({block:"nearest"});
  }
  renderAlertBar();
  renderFilterChips();
  UI.wireTooltips(board);
  syncBoardMemberTooltips();
  syncBoardGuide();
}
function render(opts){
  if(isMobile()) return renderMobileBoard(opts);
  board.classList.remove("board-mobile");
  opts = opts || {};
  updateBrand();
  /* 不在看板视图时只置脏：避免甘特/列表视图下后台反复重建整块 DOM */
  if(activeView !== "board"){
    rt.boardDirty = true;
    return;
  }
  rt.boardDirty = false;
  UI.hideTip();
  renderBoardGroupControls();
  if(!state.board) return;

  var scrollMemo = {}, boardLeft = board.scrollLeft;
  board.querySelectorAll(".board-col-body").forEach(function(el){
    var col = el.closest(".board-col");
    if(col) scrollMemo[col.dataset.col] = el.scrollTop;
  });

  board.innerHTML = "";
  var movedId = opts.movedId || null;

  if(totalTaskCount() === 0 && !filterOn()){
    var canNew = canCreateNow();
    board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:70vh;width:100%">' +
      UI.emptyState({
        icon:"board",
        title:"看板还是空的",
        textHtml: canNew
          ? "新建一个工作项，或用快捷键 <b>N</b> 快速录入。<br>数据保存在服务器，多端实时同步。"
          : "当前空间还没有工作项。你是查看者或没有可写项目，只能浏览；需要写权限请联系空间主或管理员。",
        actionLabel: canNew ? "新建第一项工作项" : ""
      }) + '</div>';
    if(canNew) bindRetry(board, function(){ openTaskDrawer("backlog"); });
    renderAlertBar(); renderFilterChips();
    return;
  }

  COLUMNS.forEach(function(c){
    var cd = state.board.columns[c.id] || {items:[], matched:0, total:0, allTotal:0, hasMore:false};
    var items = sortColumnItems(cd.items.slice(), c.id);
    var collapsed = !!state.collapsedCols[c.id];

    var col = document.createElement("section");
    col.className = "board-col" + (collapsed ? " collapsed" : "");
    col.dataset.col = c.id;

    var isCustom = (c.id !== "backlog" && c.id !== "doing" && c.id !== "done");
    /* 已完成列头快捷筛选：只改已完成列的预览与计数；顶部已设发布态时就地回显同一值 */
    var effDonePub = c.done ? (boardDonePub || state.pubState || "") : "";
    var doneFiltered = !!effDonePub;
    /* 计数同时也是「查看全部」入口：进度只表达已加载多少，完整数据进状态工作页 */
    var allCount = cd.allTotal || cd.total || 0;
    /* 列头只报整列条数，与列表「共 N 项」同口径；已加载多少在列尾「加载更多」里说，不在头部再报一个分数 */
    var countText = (filterOn() || doneFiltered)
      ? ((cd.matched || 0) + " / " + (cd.total || 0))
      : String(cd.total || 0);
    var countTip = doneFiltered
      ? "已完成 · " + donePubLabel(effDonePub) + " " + (cd.matched || 0) + " 项 / 当前时间窗 " + (cd.total || 0) + " 项，点击进入工作页"
      : (filterOn()
        ? "当前筛选命中 " + (cd.matched || 0) + " 项，该列共 " + (cd.total || 0) + " 项，点击进入工作页"
        : "查看「" + c.name + "」全部 " + allCount + " 项" + (c.done ? "（含历史）" : ""));
    var sortMode = c.done ? "manual" : colSortOf(c.id);
    /* 已完成列的发布态筛选不再常驻列头：常驻下拉会把列名挤成「已..」。
       筛选收进「列设置」菜单，生效时列设置按钮提色，计数用 matched/total 表达范围。 */
    var head = '<div class="board-col-head">' +
      '<span class="col-dot" style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"' +
        (isCustom ? ' role="button" tabindex="0" data-col-color="' + esc(c.id) + '" title="修改列颜色"' : '') + '></span>' +
      '<button class="col-name" type="button" data-col-open="' + esc(c.id) + '" title="打开「' + esc(c.name) + '」状态工作页">' + esc(c.name) + '</button>' +
      '<button class="col-count-btn" type="button" data-col-open="' + esc(c.id) + '" aria-live="polite"' +
        (c.done ? ' data-col-range="all"' : '') +
        ' title="' + esc(countTip) + '" aria-label="' + esc(countTip) + '">' + esc(countText) + '</button>' +
      '<span class="sp"></span>' +
      /* 列头只留「+」与「⋯」：排序、折叠、发布态筛选取值都收进列设置菜单；
         没有写权限时不渲染「+」，只读列仍保留设置菜单 */
      (canCreateNow() ? '<button class="icon-btn sm" type="button" data-col-add="' + esc(c.id) + '" title="在「' + esc(c.name) + '」新建工作项" aria-label="在「' + esc(c.name) + '」新建工作项">' + icon("plus", 14) + '</button>' : '') +
      '<button class="icon-btn sm' + (doneFiltered ? " on" : "") + '" type="button" data-col-menu="' + esc(c.id) + '" title="' + (doneFiltered ? "「" + esc(c.name) + "」列设置 · 发布态：" + donePubLabel(effDonePub) : "「" + esc(c.name) + "」列设置") + '" aria-label="「" + esc(c.name) + "」列设置" aria-haspopup="menu" aria-expanded="false">' + icon("more", 14) + '</button>' +
    '</div>';

    var body = '<div class="board-col-body" role="list">';
    if(!items.length){
      var emptyText, emptyIc;
      if(filterOn() || doneFiltered){ emptyText = "无匹配工作项"; emptyIc = "filterOff"; }
      else if(c.done && !cd.total && cd.allTotal){ emptyText = "本周还没有完成的工作项"; emptyIc = "checkCircle"; }
      else { emptyText = "拖动卡片到这里"; emptyIc = "inbox"; }
      body += UI.colEmpty(emptyText, emptyIc);
    }else{
      var groupDim = currentBoardGroup();
      var groupDim2 = currentBoardGroup2();
      groupColumnTree(items, groupDim, groupDim2).forEach(function(g){
        if(groupDim !== "none"){
          var folded = isGroupFolded(c.id, g.key);
          body += '<button class="board-group-head' + (folded ? " folded" : "") + '" type="button"' +
            ' data-group-fold="' + esc(groupFoldId(c.id, g.key)) + '"' +
            ' aria-expanded="' + (!folded) + '"' +
            ' title="' + esc(folded ? "展开" : "折叠") + '本组">' +
            icon(folded ? "right" : "caretDown", 12) +
            '<span class="bg-name">' + esc(g.label) + '</span>' +
            '<span class="bg-n">' + g.items.length + '</span></button>';
          if(folded) return;
        }
        if(g.subgroups){
          g.subgroups.forEach(function(sg){
            var subKey = g.key + "|" + sg.key;
            var subFolded = isGroupFolded(c.id, subKey);
            body += '<button class="board-group-head depth-2' + (subFolded ? " folded" : "") + '" type="button"' +
              ' data-group-fold="' + esc(groupFoldId(c.id, subKey)) + '"' +
              ' aria-expanded="' + (!subFolded) + '"' +
              ' title="' + esc(subFolded ? "展开" : "折叠") + '本子组">' +
              icon(subFolded ? "right" : "caretDown", 12) +
              '<span class="bg-name">' + esc(sg.label) + '</span>' +
              '<span class="bg-n">' + sg.items.length + '</span></button>';
            if(!subFolded) sg.items.forEach(function(t){ body += cardHTML(t); });
          });
        }else{
          g.items.forEach(function(t){ body += cardHTML(t); });
        }
      });
    }
    if(!c.done && cd.hasMore){
      body += '<button class="col-more" type="button" data-more="1">加载更多（还有 ' +
        Math.max((cd.matched || 0) - items.length, 0) + ' 项）</button>';
    }
    body += cardAddHTML(c.id);
    body += '</div>';

    /* 回到顶部收进列脚，和「查看全部」一起靠右；悬浮定位会压住「添加工作项」按钮 */
    var topBtn = '<button class="col-top" type="button" data-col-top="' + esc(c.id) + '" title="回到顶部" aria-label="回到顶部">' +
      icon("chevronUp", 12) + '</button>';
    var foot = "";
    if(c.done){
      var scopeDone = cd.total || 0;
      var allDone = cd.allTotal || 0;
      var scopeLabel = state.doneScope === "all" ? "全部完成" : "本周完成";
      var previewBase = (filterOn() || doneFiltered) ? (cd.matched || 0) : scopeDone;
      var previewNote = previewBase > DONE_BOARD_PREVIEW ? ' · 仅显示前 ' + DONE_BOARD_PREVIEW + ' 条' : '';
      var pubNote = doneFiltered ? ' · ' + donePubLabel(effDonePub) + ' ' + (cd.matched || 0) + ' 项' : '';
      foot = '<div class="col-foot col-foot-split">' +
        '<span class="col-foot-note">' + scopeLabel + ' ' + scopeDone + ' 项' + pubNote + previewNote + '</span>' +
        topBtn +
        '<button class="col-foot-link" type="button" data-col-open="' + esc(c.id) + '" data-col-range="all">' +
          (doneFiltered ? '查看全部 →' : '查看全部 ' + allDone + ' 条 →') + '</button>' +
      '</div>';
    }else if(allCount > 0){
      /* 队列再长也留一个固定出口：看板负责处理，完整检索去工作页 */
      foot = '<div class="col-foot col-foot-end">' +
        topBtn +
        '<button class="col-foot-link" type="button" data-col-open="' + esc(c.id) + '">查看全部 ' + allCount + ' 条 →</button>' +
      '</div>';
    }

    col.innerHTML = head + body + foot;
    board.appendChild(col);

    var listEl = col.querySelector(".board-col-body");
    if(scrollMemo[c.id] != null) listEl.scrollTop = scrollMemo[c.id];
    var topEl = col.querySelector(".col-top");
    if(topEl) topEl.classList.toggle("on", listEl.scrollTop > COL_TOP_AT);
  });

  board.scrollLeft = boardLeft;
  updateBoardOverflow();

  if(state.inlineAdd && state.inlineAdd.col){
    openInlineAdd(state.inlineAdd.col, state.inlineAdd.value, false);
  }

  if(movedId){
    var el = board.querySelector('.card[data-id="' + movedId + '"]');
    if(el){
      el.classList.add("just-moved");
      if(el.scrollIntoView) el.scrollIntoView({block:"nearest", inline:"nearest"});
      try{ el.focus({preventScroll:true}); }catch(e){ /* noop */ }
    }
  }
  renderAlertBar();
  renderFilterChips();
  UI.wireTooltips(board);
  syncBoardMemberTooltips();
  syncBoardGuide();
}
/* ---- 首屏引导：工作项 <3 条的新空间，在看板上方递出「下一步」 ---- */
function syncBoardGuide(){
  var parent = board.parentNode;
  if(!parent) return;
  var old = parent.querySelector(".guide-card");
  if(old) old.remove();
  var n = totalTaskCount();
  if(!n || n > 2 || filterOn()) return;
  board.insertAdjacentHTML("beforebegin", UI.guideCard());
}
var boardGuideBound = false;
function bindBoardGuide(){
  if(boardGuideBound) return;
  boardGuideBound = true;
  var parent = board.parentNode;
  if(!parent) return;
  parent.addEventListener("click", function(e){
    var g = e.target.closest("[data-guide]");
    if(!g) return;
    var kind = g.getAttribute("data-guide");
    if(kind === "task") openTaskDrawer("backlog");
    else if(kind === "project"){
      showView("projects");
      setTimeout(function(){ loadView("projects").then(function(m){ m.openProjectDialog(null); }); }, 80);
    }
    else if(kind === "demand"){
      /* 先写入带 ?new=1 的 hash（syncViewHash 保留名单会保住参数），再切视图；demands enter 时消费参数开提需求弹窗 */
      window.location.hash = "#/demands?new=1";
      showView("demands");
    }
  });
}
bindBoardGuide();
function openInlineAdd(colId, preset, focusIt){
  if(!canCreateNow()){ toast("你是该空间的查看者，不能新建工作项", "warn"); return; }
  /* 手机单列模式没有 .board-col 容器，直接开抽屉，复用同一套新建表单 */
  if(isMobile()){ state.inlineAdd = null; openTaskDrawer(colId); return; }
  var col = board.querySelector('.board-col[data-col="' + colId + '"]');
  if(!col) return;
  var addBtn = col.querySelector(".card-add");
  if(!addBtn) return;
  var input = document.createElement("input");
  input.className = "card-add-input";
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "输入标题后回车创建…（!P0 / #项目 / @负责人 / +标签 / %进度 / ~每周 / 明天）";
  input.value = preset || "";
  input.setAttribute("aria-label", "在「" + colName(colId) + "」新建工作项");
  input._restore = addBtn;

  var hint = document.createElement("div");
  hint.className = "foot-note";
  hint.style.marginTop = "4px";
  hint.hidden = true;

  addBtn.replaceWith(input);
  input.parentNode.insertBefore(hint, input.nextSibling);

  function restore(){
    state.inlineAdd = null;
    if(hint.parentNode) hint.remove();
    if(input._restore && input.parentNode) input.replaceWith(input._restore);
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){
      e.preventDefault();
      var v = input.value.trim();
      if(!v) return;
      state.inlineAdd = {col: colId, value: ""};
      inlineAddCreate(colId, v, input);
    }else if(e.key === "Escape"){
      e.preventDefault();
      restore();
    }
  });
  input.addEventListener("input", function(){
    if(state.inlineAdd) state.inlineAdd.value = input.value;
    /* O-24：#项目名 没命中时给即时提示，而不是静默把它留在标题里 */
    var q = parseQuickAdd(input.value);
    if(q.unmatchedReq){
      hint.textContent = "未找到项目「" + q.unmatchedReq + "」，这段文字会留在标题里（可改用抽屉里的项目下拉）";
      hint.hidden = false;
    }else if(q.unmatchedOwner){
      hint.textContent = "未找到成员「" + q.unmatchedOwner + "」，负责人未设置（这段文字会留在标题里）";
      hint.hidden = false;
    }else if(q.invalidDate){
      hint.textContent = "日期「" + q.invalidDate + "」不存在，不会设置截止日期";
      hint.hidden = false;
    }else{
      hint.hidden = true;
    }
  });
  input.addEventListener("blur", function(){
    setTimeout(function(){
      if(document.activeElement === input) return;
      if(state.inlineAdd && state.inlineAdd.value) return; // 有未提交内容时保留
      restore();
    }, 140);
  });
  if(focusIt !== false){
    try{ input.focus(); input.setSelectionRange(input.value.length, input.value.length); }catch(e){ /* noop */ }
  }
}
function inlineAddCreate(colId, title, input){
  var q = parseQuickAdd(title);
  if(q.reqId && !canEditReq(q.reqId)){
    toast("「" + q.reqName + "」只有查看权限，无法新建工作项", "warn");
    return;
  }
  var payload = {
    title: q.title || title,
    priority: q.priority || "P2",
    boardColumn: colId,
    dueDate: q.dueDate || null,
    reqId: q.reqId || null,
    progress: q.progress == null ? 0 : q.progress,
    owner: q.owner || null,
    ownerUserId: q.ownerUserId || null,
    tags: q.tags || [],
    recurType: q.recurType || ""
  };
  if(q.invalidDate) toast("日期「" + q.invalidDate + "」不存在，未设置截止日期", "warn");
  input.disabled = true;
  API.post("/api/tasks", payload).then(function(nt){
    input.disabled = false;
    input.value = "";
    state.inlineAdd = {col: colId, value: ""};
    var tip = "已创建「" + nt.title + "」到「" + colName(colId) + "」";
    if(nt.dueDate) tip += " · 截止 " + nt.dueDate;
    if(q.priority) tip += " · " + priName(q.priority);
    if(q.owner) tip += " · 负责人 " + q.owner;
    if(q.tags && q.tags.length) tip += " · 标签 " + q.tags.join("/");
    if(q.recurType) tip += " · " + (RECUR_LABEL[q.recurType] || "循环");
    taskCacheExtra[nt.id] = nt;
    loadBoard({animate:true, movedId: nt.id});
    loadReqs();
    toast(tip, "fs");
  }).catch(function(ex){
    input.disabled = false;
    toast(ex.message || "新建失败", "bad");
  });
}
var drag = null, pending = null, lastPt = {x:0, y:0}, rafId = null, dragRaf = 0;
function onPointerDown(e){
  /* 手机档位不做拖拽换列（单列流 + 长按拖动留待下期），横向手势交给 cards 左滑 */
  if(isMobile()) return;
  var cardEl = e.target.closest ? e.target.closest(".card") : null;
  if(!cardEl) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  if(e.target.closest("button,input,textarea,select,a")) return;
  /* 只读项目不允许拖动改列：不动卡片位置，也不进入 pending 态 */
  if(!canEditTask(taskById(cardEl.dataset.id))) return;
  /* 自动排序的列，显示顺序不是手动顺序，拖动会落到反直觉的位置 */
  var fromColEl = cardEl.closest(".board-col");
  if(fromColEl && colSortOf(fromColEl.dataset.col) !== "manual") return;
  pending = {
    el: cardEl, id: cardEl.dataset.id,
    x0: e.clientX, y0: e.clientY,
    touch: e.pointerType !== "mouse",
    timer: null
  };
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending.touch){
    pending.timer = setTimeout(function(){ if(pending) beginDrag(lastPt.x, lastPt.y); }, 190);
  }
}
function onPointerMove(e){
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending && !drag){
    var dx = e.clientX - pending.x0, dy = e.clientY - pending.y0;
    if(Math.abs(dx) + Math.abs(dy) > 6){
      if(pending.touch){
        if(pending.timer) clearTimeout(pending.timer);
        pending = null;
        return;
      }
      beginDrag(e.clientX, e.clientY);
    }
  }
  if(drag){
    if(e.cancelable) e.preventDefault();
    /* 合并到一帧里读写 DOM，避免 pointermove 高频触发时反复测量布局 */
    if(!dragRaf) dragRaf = requestAnimationFrame(function(){ dragRaf = 0; if(drag) updateDrag(); });
  }
}
function onPointerUp(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; if(drag) updateDrag(); }
  if(drag) endDrag();
}
function onPointerCancel(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(drag) cancelDrag();
}
function boardTouchMove(e){ if(drag && e.cancelable) e.preventDefault(); }
function beginDrag(x, y){
  if(!pending) return;
  var cardEl = pending.el, id = pending.id;
  pending = null;
  if(!cardEl || !cardEl.parentNode) return;

  var rect = cardEl.getBoundingClientRect();
  var ghost = cardEl.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("just-moved");
  ghost.removeAttribute("tabindex");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);

  var line = document.createElement("div");
  line.className = "drop-line";

  cardEl.classList.add("dragging");
  document.body.classList.add("dragging-active");

  drag = {
    id: id, el: cardEl, ghost: ghost, line: line,
    x0: x, y0: y,
    colEl: cardEl.closest(".board-col"),
    beforeId: null
  };
  if(drag.colEl) drag.colEl.classList.add("drop-active");
  document.addEventListener("touchmove", boardTouchMove, {passive:false});
  var originBody = cardEl.closest(".board-col-body");
  if(originBody) originBody.insertBefore(line, cardEl.nextSibling);
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function updateDrag(){
  if(!drag) return;
  var x = lastPt.x, y = lastPt.y;
  drag.ghost.style.transform = "translate(" + (x - drag.x0) + "px," + (y - drag.y0) + "px) rotate(2deg)";

  var cols = board.querySelectorAll(".board-col");
  var target = null;
  for(var i = 0; i < cols.length; i++){
    var r = cols[i].getBoundingClientRect();
    if(x >= r.left - 12 && x <= r.right + 12){ target = cols[i]; break; }
  }
  if(!target) return;

  if(drag.colEl !== target){
    if(drag.colEl) drag.colEl.classList.remove("drop-active");
    drag.colEl = target;
    target.classList.add("drop-active");
  }

  var bodyEl = target.querySelector(".board-col-body");
  if(!bodyEl) return;
  var cards = Array.prototype.slice.call(bodyEl.querySelectorAll(".card:not(.dragging)"));
  var before = null;
  for(var k = 0; k < cards.length; k++){
    var cr = cards[k].getBoundingClientRect();
    if(y < cr.top + cr.height/2){ before = cards[k]; break; }
  }
  if(before) bodyEl.insertBefore(drag.line, before);
  else {
    var tail = bodyEl.querySelector(".card-add, .card-add-input, .col-more");
    if(tail) bodyEl.insertBefore(drag.line, tail);
    else bodyEl.appendChild(drag.line);
  }
  drag.beforeId = before ? before.dataset.id : null;
}
function loop(){
  if(!drag){ rafId = null; return; }
  var x = lastPt.x, y = lastPt.y;
  var br = board.getBoundingClientRect();
  if(x < br.left + 60) board.scrollLeft -= 14;
  else if(x > br.right - 60) board.scrollLeft += 14;
  if(drag.colEl){
    var bodyEl = drag.colEl.querySelector(".board-col-body");
    if(bodyEl){
      var lr = bodyEl.getBoundingClientRect();
      if(y < lr.top + 40) bodyEl.scrollTop -= 12;
      else if(y > lr.bottom - 40) bodyEl.scrollTop += 12;
    }
  }
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function endDrag(){
  var d = drag;
  var toCol = d.colEl ? d.colEl.dataset.col : null;
  var beforeId = d.beforeId;
  var fromEl = d.el.closest(".board-col");
  var fromCol = fromEl ? fromEl.dataset.col : null;
  cleanupDrag();
  if(!toCol){ render({animate:false}); return; }

  var wsId = rt.currentWs && rt.currentWs.id;
  var lifted = taskById(d.id);
  var items = [{ from: fromCol, title: lifted ? lifted.title : "" }];
  guard(wsId, items, toCol).then(function(pass){
    if(!pass){ render({animate:false}); return; }

    rt.suppressClickUntil = Date.now() + 260;
    optimisticMove(d.id, toCol, beforeId);
    render({animate:false, movedId:d.id});

    var body = { column: toCol };
    if(beforeId) body.beforeId = beforeId;
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    var retried = false;
    function fail(ex){
      if(retried){ toast("移动失败：" + (ex.message || "网络异常"), "bad"); loadBoard({silent:true}); return; }
      retried = true;
      serverDecision(wsId, items, toCol, ex).then(function(retry){
        if(retry){
          body.reason = retry.reason;
          body.force = retry.force;
          send();
          return;
        }
        toast("移动失败：" + (ex.message || "网络异常"), "bad");
        loadBoard({silent:true});
      });
    }
    function send(){
      API.post("/api/tasks/" + encodeURIComponent(d.id) + "/move", body).then(function(res){
        var task = res.task;
        if(res.to === "done" && res.from !== "done"){
          var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
          var doneMsg = dd > 0
            ? ("已完成工作项「" + task.title + "」，延期 " + dd + " 天完成")
            : ("已完成工作项「" + task.title + "」，按期完成");
          /* 完成后自动接力了同列的下一个任务，明确说出来，别让人以为计时断了 */
          if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
          toast(doneMsg, dd > 0 ? "warn" : "fs");
        }else if(res.from === "done" && res.to !== "done"){
          toast("已清除完成时间", "warn");
        }else if(fromCol !== res.to){
          toast("「" + task.title + "」移动到「" + colName(res.to) + "」" +
            (res.autoTimerStarted ? " · 已开始计时（拖到「已完成」会自动停止）" : "") +
            (res.autoTimerTask ? " · 已接着开始「" + res.autoTimerTask + "」的计时" : ""));
        }
        loadBoard({silent:true});
        loadReqs();
      }).catch(fail);
    }
    send();
  });
}
/* 卡片上的「开始测试」：移入测试中并由后端自动认领给当前用户 */
function claimTest(id){
  var task = taskById(id);
  if(!task) return;
  function done(res){
    var tester = (res.task && res.task.testOwner) || "我";
    toast("已认领测试负责人：" + tester + "，开始测试", "fs");
    loadBoard({silent:true});
  }
  function fail(ex){
    toast("认领失败：" + (ex.message || "网络异常"), "bad");
    loadBoard({silent:true});
  }
  /* 已在「测试中」只是没认领（批量移入）：直接补测试负责人与开始时间 */
  if(task.boardColumn === "testing"){
    API.post("/api/tasks/" + encodeURIComponent(id) + "/test-claim", {}).then(done).catch(fail);
    return;
  }
  var wsId = rt.currentWs && rt.currentWs.id;
  var items = [{ from: task.boardColumn, title: task.title }];
  guard(wsId, items, "testing").then(function(pass){
    if(!pass) return;
    var body = { column: "testing" };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    API.post("/api/tasks/" + encodeURIComponent(id) + "/move", body).then(done).catch(fail);
  });
}
function cancelDrag(){ cleanupDrag(); render({animate:false}); }
function cleanupDrag(){
  if(!drag) return;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; }
  document.removeEventListener("touchmove", boardTouchMove);
  if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
  if(drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  if(drag.line && drag.line.parentNode) drag.line.parentNode.removeChild(drag.line);
  if(drag.el) drag.el.classList.remove("dragging");
  if(drag.colEl) drag.colEl.classList.remove("drop-active");
  document.body.classList.remove("dragging-active");
  drag = null;
}
function optimisticMove(id, toCol, beforeId){
  if(!state.board) return;
  var t = null, cdFrom = null;
  for(var i = 0; i < COLUMNS.length; i++){
    var cd = state.board.columns[COLUMNS[i].id];
    if(!cd) continue;
    for(var j = 0; j < cd.items.length; j++){
      if(cd.items[j].id === id){ t = cd.items[j]; cdFrom = cd; cd.items.splice(j,1); break; }
    }
    if(t) break;
  }
  if(!t) return;
  if(cdFrom){
    cdFrom.matched = Math.max(0, cdFrom.matched - 1);
    if(cdFrom.total > 0) cdFrom.total--;
    if(t.boardColumn === "done"){
      cdFrom.allTotal = Math.max(0, cdFrom.allTotal - 1);
      cdFrom.hasMore = false;
    }
  }
  var cdTo = state.board.columns[toCol];
  if(!cdTo) return;
  var wasDone = t.boardColumn === "done";
  t.boardColumn = toCol;
  if(toCol === "done" && !wasDone) t.completedAt = localDatetime();
  else if(toCol !== "done") t.completedAt = null;
  var pos = cdTo.items.length;
  if(beforeId){
    for(var m = 0; m < cdTo.items.length; m++){
      if(cdTo.items[m].id === beforeId){ pos = m; break; }
    }
  }
  cdTo.items.splice(pos, 0, t);
  cdTo.matched++; cdTo.total++;
  if(toCol === "done" && !wasDone) cdTo.allTotal++;
}
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("pointermove", onPointerMove, {passive:false});
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("pointercancel", onPointerCancel);
/* 分组切换在列外工具条，单独接一层，不进卡片点击的判定链 */
var boardToolbarEl = document.getElementById("boardToolbar");
if(boardToolbarEl){
  boardToolbarEl.addEventListener("change", function(e){
    if(e.target.id === "boardGroupSelect") setBoardGroup(e.target.value);
    else if(e.target.id === "boardGroup2Select") setBoardGroup2(e.target.value);
  });
}
/* 已取消是终态，不占看板列：只在工具条留一个入口，点进去看归档与恢复 */
var canceledBtn = document.getElementById("btnCanceled");
if(canceledBtn){
  canceledBtn.addEventListener("click", function(){ showView("canceled"); });
}
function syncCanceledBadge(){
  var badge = document.getElementById("canceledBadge");
  if(!badge) return;
  var n = state.board && state.board.counts ? (state.board.counts.canceled || 0) : 0;
  /* 入口常显，0 也显示：否则「已取消」看起来像一条普通说明，用户以为没有这个状态 */
  badge.textContent = n > 99 ? "99+" : String(n);
}
/* 列内滚过一屏后露出「回到顶部」；scroll 不冒泡，用捕获阶段接住 */
board.addEventListener("scroll", function(e){
  var el = e.target;
  if(el === board){ updateBoardOverflow(); return; }
  if(!el || !el.classList || !el.classList.contains("board-col-body")) return;
  var colEl = el.closest(".board-col");
  var btn = colEl && colEl.querySelector(".col-top");
  if(btn) btn.classList.toggle("on", el.scrollTop > COL_TOP_AT);
}, true);
/* 已完成列发布态：与顶部筛选同属发布维度，列内选择接管该维度，避免两处同维条件互相覆盖 */
function setDonePubFilter(value){
  var next = value === "published" || value === "unpublished" ? value : "";
  if(next === (boardDonePub || "") && !state.pubState) return;
  boardDonePub = next;
  state.pubState = null;
  reloadFilteredViews();
}
board.addEventListener("click", function(e){
  var mobTab = e.target.closest("[data-mob-col]");
  if(mobTab){ mobCol = mobTab.dataset.mobCol; render({animate:false}); return; }
  var gfold = e.target.closest("[data-group-fold]");
  if(gfold){
    var raw = gfold.dataset.groupFold, sep = raw.indexOf("|");
    if(sep > 0) toggleGroupFold(raw.slice(0, sep), raw.slice(sep + 1));
    return;
  }
  var colOpen = e.target.closest("[data-col-open]");
  if(colOpen){ openColumnWorkpage(colOpen.dataset.colOpen, colOpen.dataset.colRange); return; }
  var fold = e.target.closest("[data-col-fold]");
  if(fold){
    var cid = fold.dataset.colFold;
    state.collapsedCols[cid] = !state.collapsedCols[cid];
    render({animate:false});
    return;
  }
  var sortBtn = e.target.closest("[data-col-sort]");
  if(sortBtn){ openColSortMenu(sortBtn, sortBtn.dataset.colSort); return; }
  var topBtn = e.target.closest("[data-col-top]");
  if(topBtn){
    var topColEl = topBtn.closest(".board-col");
    var topBodyEl = topColEl && topColEl.querySelector(".board-col-body");
    if(topBodyEl) topBodyEl.scrollTo({top:0, behavior:"smooth"});
    return;
  }
  var colAdd = e.target.closest("[data-col-add]");
  if(colAdd){
    if(!canCreateNow()){ toast("你是该空间的查看者，不能新建工作项", "warn"); return; }
    state.inlineAdd = {col: colAdd.dataset.colAdd, value: ""}; openInlineAdd(colAdd.dataset.colAdd, ""); return;
  }
  var add = e.target.closest("[data-add]");
  if(add){
    if(!canCreateNow()){ toast("你是该空间的查看者，不能新建工作项", "warn"); return; }
    state.inlineAdd = {col: add.dataset.add, value: ""}; openInlineAdd(add.dataset.add, ""); return;
  }
  var colorDot = e.target.closest("[data-col-color]");
  if(colorDot){ openColColorPop(colorDot, colorDot.dataset.colColor); return; }
  var colMenuBtn = e.target.closest("[data-col-menu]");
  if(colMenuBtn){ openColMenu(colMenuBtn, colMenuBtn.dataset.colMenu); return; }
  var more = e.target.closest("[data-more]");
  if(more){
    var colEl = more.closest(".board-col");
    loadMoreColumn(colEl ? colEl.dataset.col : mobileColId());
    return;
  }
  var dueBtn = e.target.closest("[data-due-pop]");
  if(dueBtn){ openDuePopover(dueBtn, dueBtn.dataset.duePop); return; }
  var menuBtn = e.target.closest("[data-card-menu]");
  if(menuBtn){ openCardMenu(menuBtn, menuBtn.dataset.cardMenu); return; }
  var docBtn = e.target.closest("[data-open-reqdoc]");
  if(docBtn){ openReqDoc(docBtn.dataset.openReqdoc); return; }
  var tmr = e.target.closest("[data-timer-toggle]");
  if(tmr){ toggleTaskTimer(tmr.dataset.timerToggle); return; }
  var claim = e.target.closest("[data-test-claim]");
  if(claim){ claimTest(claim.dataset.testClaim); return; }
  var tick = e.target.closest("[data-done-toggle]");
  if(tick){ toggleTaskDone(tick.dataset.doneToggle); return; }
  var ed = e.target.closest("[data-edit]");
  if(ed){ openTaskDrawer(null, taskById(ed.dataset.edit)); return; }
  var del = e.target.closest("[data-del]");
  if(del){ deleteTask(del.dataset.del); return; }
  var card = e.target.closest(".card");
  if(card && Date.now() > rt.suppressClickUntil) openTaskDrawer(null, taskById(card.dataset.id));
});
board.addEventListener("dblclick", function(e){
  var title = e.target.closest(".card-title");
  if(!title) return;
  var card = title.closest(".card");
  if(!card) return;
  var t = taskById(card.dataset.id);
  if(t) openTaskDrawer(null, t);
});
board.addEventListener("keydown", function(e){
  var dot = e.target.closest("[data-col-color]");
  if(dot && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openColColorPop(dot, dot.dataset.colColor); return; }
  if(e.target.closest("button")) return;   // 卡内按钮自己处理 Enter/Space
  if(e.key === "Enter" || e.key === " "){
    var card = e.target.closest(".card");
    if(card){ e.preventDefault(); openTaskDrawer(null, taskById(card.dataset.id)); }
  }
});
function startColRename(el, colId){
  var col = colMeta(colId);
  if(!col || col.done) return;
  var old = colName(colId);
  var input = document.createElement("input");
  input.className = "col-name-edit";
  input.type = "text";
  input.maxLength = 12;
  input.value = old;
  input.setAttribute("aria-label", "列名");
  el.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function restore(focus){
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "col-name";
    btn.dataset.colOpen = colId;
    btn.title = "打开「" + old + "」状态工作页";
    btn.textContent = old;
    if(input.parentNode) input.replaceWith(btn);
    /* Esc 取消时把焦点还给列名入口；失焦保存不抢焦点 */
    if(focus && btn.isConnected){
      try{ btn.focus({preventScroll:true}); }catch(e){ btn.focus(); }
    }
  }
  function commit(save){
    if(done) return;
    done = true;
    var name = input.value.trim();
    if(!save || !name || name === old){ restore(!save); return; }
    API.put("/api/columns/" + encodeURIComponent(colId), { name: name, color: colColorOf(colId) }).then(function(){
      toast("已更新列「" + name + "」", "fs");
      loadBoard({silent:true});
    }).catch(function(ex){
      toast(ex.message || "保存失败", "bad");
      loadBoard({silent:true});
    });
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); commit(true); }
    else if(e.key === "Escape"){ e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", function(){ commit(true); });
}
function colColorOf(colId){
  var c = colMeta(colId);
  return safeColor(c && c.color);
}
function openColMenu(anchor, colId){
  var col = colMeta(colId);
  if(!col) return;
  var isCustom = (colId !== "backlog" && colId !== "doing" && colId !== "done");
  var html = '<div class="menu-title">' + esc(colName(colId)) + '</div>' +
    '<button class="menu-item" type="button" data-col-menu-open="' + esc(colId) + '"><span>打开状态工作页</span></button>' +
    (col.done ? '' :
      '<button class="menu-item" type="button" data-col-menu-rename="' + esc(colId) + '"><span>重命名列</span></button>') +
    (isCustom
      ? '<button class="menu-item" type="button" data-col-menu-color="' + esc(colId) + '"><span>设置列颜色</span></button>'
      : '');
  if(!col.done){
    html += '<button class="menu-item" type="button" data-col-menu-sort="' + esc(colId) + '">' +
      '<span>列内排序：' + COL_SORT_LABEL[colSortOf(colId)] + '</span></button>';
  }
  html += '<button class="menu-item" type="button" data-col-menu-fold="' + esc(colId) + '">' +
    '<span>' + (state.collapsedCols[colId] ? "展开列" : "折叠列") + '</span></button>';
  if(col.done){
    var effPub = boardDonePub || state.pubState || "";
    html += '<div class="menu-sep"></div><div class="menu-title">发布态筛选</div>' +
      [["", "全部"], ["published", "已发布"], ["unpublished", "未发布"]].map(function(o){
        var on = effPub === o[0];
        return '<button class="menu-item' + (on ? " on" : "") + '" type="button" role="menuitemradio" aria-checked="' + on + '" data-col-pub-set="' + o[0] + '">' +
          '<span>' + o[1] + '</span>' + (on ? icon("check", 14) : '') + '</button>';
      }).join("");
  }
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var open = e.target.closest("[data-col-menu-open]");
    if(open){ UI.closeAllPops(); openColumnWorkpage(open.dataset.colMenuOpen); return; }
    var pub = e.target.closest("[data-col-pub-set]");
    if(pub){ UI.closeAllPops(); setDonePubFilter(pub.dataset.colPubSet); return; }
    var rename = e.target.closest("[data-col-menu-rename]");
    if(rename){
      UI.closeAllPops();
      var nameEl = board.querySelector('.board-col[data-col="' + rename.dataset.colMenuRename + '"] .col-name');
      if(nameEl) startColRename(nameEl, rename.dataset.colMenuRename);
      return;
    }
    var color = e.target.closest("[data-col-menu-color]");
    if(color){ UI.closeAllPops(); openColColorPop(anchor, color.dataset.colMenuColor); return; }
    var sortItem = e.target.closest("[data-col-menu-sort]");
    if(sortItem){ UI.closeAllPops(); openColSortMenu(anchor, sortItem.dataset.colMenuSort); return; }
    var foldItem = e.target.closest("[data-col-menu-fold]");
    if(foldItem){
      UI.closeAllPops();
      var fid = foldItem.dataset.colMenuFold;
      state.collapsedCols[fid] = !state.collapsedCols[fid];
      render({animate:false});
      return;
    }
  });
  UI.openPop(el, anchor, {align:"right", onClose: function(){
    anchor.setAttribute("aria-expanded", "false");
    el.remove();
  }});
  anchor.setAttribute("aria-expanded", "true");
}
function openColSortMenu(anchor, colId){
  var cur = colSortOf(colId);
  var cd = state.board && state.board.columns[colId];
  var loaded = cd && cd.items ? cd.items.length : 0;
  var matched = (cd && cd.matched) || 0;
  var html = '<div class="menu-title">列内排序</div>';
  COL_SORTS.forEach(function(mode){
    html += '<button class="menu-item" type="button" data-colsort-pick="' + mode + '">' +
      '<span>' + COL_SORT_LABEL[mode] + '</span>' +
      (mode === cur ? '<span class="k">当前</span>' : '') + '</button>';
  });
  html += '<div class="menu-note">' +
    (loaded < matched ? "只对已加载的 " + loaded + " 条排序 · " : "") +
    "自动排序下不能拖动卡片</div>";
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-colsort-pick]");
    if(!b) return;
    UI.closeAllPops();
    setColSort(colId, b.dataset.colsortPick);
    /* 换了排序就看新顺序的开头，不沿用旧滚动位置 */
    var bodyEl = board.querySelector('.board-col[data-col="' + colId + '"] .board-col-body');
    if(bodyEl) bodyEl.scrollTop = 0;
    render({animate:false});
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
function openColColorPop(anchor, colId){
  var html = '<div class="menu-title">列颜色</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:8px">';
  PALETTE.forEach(function(c){
    html += '<button type="button" data-colpick="' + c + '" title="' + c + '" aria-label="选择颜色 ' + c +
      '" style="width:26px;height:26px;border-radius:8px;border:1px solid rgba(16,24,40,.12);background:' + c + '"></button>';
  });
  html += '</div><div class="row row-gap" style="margin-top:10px">' +
    '<input type="color" value="' + esc(colColorOf(colId)) + '" data-colpick-custom aria-label="自定义颜色" /></div></div>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-colpick]");
    if(!b) return;
    UI.closeAllPops();
    saveColColor(colId, b.dataset.colpick);
  });
  el.addEventListener("change", function(e){
    if(e.target.matches("[data-colpick-custom]")){
      UI.closeAllPops();
      saveColColor(colId, e.target.value);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
function saveColColor(colId, color){
  var col = colMeta(colId);
  if(!col) return;
  API.put("/api/columns/" + encodeURIComponent(colId), { name: col.name, color: color }).then(function(){
    toast("已更新列颜色", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
}

window.addEventListener("ds:layout", function(){
  if(!state.board) return;
  /* 看板没有 enter 回调：断点时不在看板也要置脏，否则切回来仍是旧档位的 DOM */
  if(activeView === "board") render({animate:false});
  else rt.boardDirty = true;
});

/* 拖列 / 抽屉改列可能在后端停止计时：计时身份变化时按最新状态重绘，
   否则卡片会残留「计时中」胶囊（loadBoard 期间拿到的还是旧计时状态）。 */
var lastTimerTaskId = state.runningTimer ? state.runningTimer.taskId : null;
window.addEventListener("ds:running-timer", function(){
  var id = state.runningTimer ? state.runningTimer.taskId : null;
  if(id === lastTimerTaskId) return;
  lastTimerTaskId = id;
  /* 拖拽过程中重建 DOM 会让幽灵卡/插入线失效，等拖拽结束后的渲染接管 */
  if(drag || pending) return;
  if(activeView === "board" && state.board) render({animate:false});
});

export { cancelDrag, cardHTML, drag, loadBoard, loadReqs, openInlineAdd, pending, refreshBoardPreserving, render, showBoardSkeleton };
