/* views/branches · 分支管理 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { loadViews, savedViewsFor } from "../core/filters-ui.js";
import { canEditReq, roleReadOnly, rt, state } from "../core/state.js";
import { hashParam, openTaskById } from "../core/task-actions.js";
import { ownerOptions, ownerPickerOptions, ownerRosterState, ensureProjectRoles, currentProjectId, syncAssocRead } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { assocLinkHTML, avatarHTML, fmtTs, priColor, priName, taskPublicationHTML } from "../lib/format.js";
import { openPeoplePicker, peopleFieldHTML } from "../lib/people-picker.js";
import { loadProjectMembers } from "../lib/member-labels.js";
import { loadReqs, render } from "./board.js";

var BRANCH_STATUS = [
  { id:"dev",      name:"开发中", cls:"br-st-dev",      timeKey:"devAt",      hint:"代码还在写" },
  { id:"testing",  name:"待测试", cls:"br-st-testing",  timeKey:"testAt",     hint:"开发完成，等测试验证" },
  { id:"merging",  name:"待合并", cls:"br-st-merging",  timeKey:"mergeAt",    hint:"测过了，等合并窗口" },
  { id:"released", name:"已发布", cls:"br-st-released", timeKey:"releasedAt", hint:"已上线" }
];
/* 生命周期（outcome）与开发状态（status）正交：chips 只切 outcome，看板列仍按 status */
var BRANCH_OUTCOMES = [
  { id:"open",     name:"进行中" },
  { id:"done",     name:"已完成" },
  { id:"canceled", name:"已取消" },
  { id:"ignored",  name:"已忽略" },
  { id:"pending",  name:"待确认" },
  { id:"all",      name:"全部" }
];
var branchOutcomeFilter = "open";   /* 兼容后方：接口缺省不限，前端显式只取进行中 */
var branchRepoFilter = "";
var branchRepoCache = [];
var branchPendingGroups = [];
var branchPendingSeq = 0;
var branchSelected = {};            /* 列表批量判定：id → true */
var branchBulkBusy = false;
var branchList = [];            /* 当前已加载的分支（首屏 + 滚动加载），抽屉/拖拽查用 */
var branchRefs = [];            /* 全量轻量引用：id → 名称，看板卡片标签用 */
var branchBoard = null;         /* { columns, counts, avgCycleDays } */
var branchExtra = { dev:[], testing:[], merging:[], released:[] };
var branchesLoaded = false;
var branchFilter = "";
/* 深链来源：从「我的工作 · 待验收 / 待合并」进来时，明确标出筛选依据；用户改筛选即视为已接管 */
var branchSource = null;          /* { from:"accept"|"merge"|"link", status:"testing"|"merging" } */
var branchProjectFilter = "";
var branchOwnerFilter = "";        /* 负责人筛选：按成员账号（owner_user_id），__none__ = 未指派；手填姓名的分支走关键词搜索 */
var branchVersionFilter = "";      /* 版本筛选：分支通过关联工作项挂到项目版本，服务端按 version_task 反查 */
var branchVersionCache = [];       /* 当前项目范围内有分支的版本（含计数） */
var branchGroupMode = "status";    /* "status" | "project"（看板） */
var branchListGroup = "none";      /* "none" | "status" | "owner" | "project"（列表） */
var BRANCH_VIEW_KEY = "ds.branchView";
var branchViewMode = (function(){
  try{ return localStorage.getItem(BRANCH_VIEW_KEY) === "list" ? "list" : "board"; }catch(e){ return "board"; }
})();
var branchRows = [];             /* 列表模式的全量分支 */
var branchRowsLoading = false;
var branchRowsSeq = 0;
var BRANCH_BOARD_PAGE = 50;      /* 每个状态首屏条数 */
var BRANCH_PAGE = 50;            /* 滚动加载每页条数 */
var branchSearchTimer = null;
var branchOptionCache = {};      /* projectId → 下拉选项 */
var brDrawerId = null;
var brEditingId = null;
var brDialogTask = null;      /* 从工作项抽屉就地新建时记录上下文，创建成功后自动挂接 */
var brOwnerPickerRef = null;  /* 分支对话框负责人浮层引用，花名册就绪后原地刷新 */
var dragBranch = null;        /* 拖动中的分支卡片 { id, status } */
var branchSelectProject = ""; /* 工作项抽屉里「所属分支」当前的项目过滤（后台刷新时不能丢） */
var reqsPending = null;       /* 项目列表加载中，避免多个下拉各自重复请求 */
var reqsTried = false;
function ensureReqs(cb){
  if(rt.reqsLoaded || reqsTried){ cb(); return; }
  reqsTried = true;
  if(!reqsPending) reqsPending = loadReqs();
  reqsPending.then(function(){ reqsPending = null; cb(); });
}
function branchStatusMeta(id){
  for(var i = 0; i < BRANCH_STATUS.length; i++) if(BRANCH_STATUS[i].id === id) return BRANCH_STATUS[i];
  return { id: id, name: id || "未知", cls: "", timeKey: "", hint: "" };
}
function branchOutcomeMeta(id){
  for(var i = 0; i < BRANCH_OUTCOMES.length; i++) if(BRANCH_OUTCOMES[i].id === id) return BRANCH_OUTCOMES[i];
  return { id: id || "open", name: id || "进行中" };
}
function branchPendingReasonText(reason){
  if(reason === "disappeared") return "远程分支已消失";
  if(reason === "closed_new_commit") return "关闭后远程又有新提交";
  if(reason === "name_conflict") return "分支名冲突";
  return "需要人工确认";
}
function branchStatusIndex(id){
  for(var i = 0; i < BRANCH_STATUS.length; i++) if(BRANCH_STATUS[i].id === id) return i;
  return -1;
}
var brDrawerData = null;     /* 抽屉按 ID 拉取的最新分支（深链 / 加载更多 / 列表模式时不在看板首屏里） */
function branchById(id){
  if(!id) return null;
  if(brDrawerData && brDrawerData.id === id) return brDrawerData;
  for(var i = 0; i < branchList.length; i++) if(branchList[i].id === id) return branchList[i];
  for(var k in branchExtra){
    if(!Object.prototype.hasOwnProperty.call(branchExtra, k)) continue;
    var extra = branchExtra[k] || [];
    for(var j = 0; j < extra.length; j++) if(extra[j].id === id) return extra[j];
  }
  for(var r = 0; r < branchRows.length; r++) if(branchRows[r].id === id) return branchRows[r];
  /* 待确认队列里的分支可能没进看板/列表快照（如当前只筛进行中） */
  for(var g = 0; g < branchPendingGroups.length; g++){
    var items = branchPendingGroups[g].items || [];
    for(var p = 0; p < items.length; p++) if(items[p].id === id) return items[p];
  }
  return null;
}
function branchNameById(id){
  for(var i = 0; i < branchRefs.length; i++) if(branchRefs[i].id === id) return branchRefs[i].name;
  var b = branchById(id);
  return b ? b.name : "";
}
/* 分支的修改 / 改状态 / 删除与后端一致：按所属项目写权限；空间级公共分支对非查看者开放 */
function canEditBranch(b){
  return !!b && canEditReq(b.reqId);
}
/* 只读元数据：发布计划按工作项实时推导分支时使用，避免只拿到名称而丢失状态/目标分支 */
function branchMetaById(id){
  if(!id) return null;
  for(var i = 0; i < branchRefs.length; i++) if(branchRefs[i].id === id) return branchRefs[i];
  return branchById(id);
}
function branchDurText(ms){
  if(!ms || ms < 0) return "刚刚";
  var h = Math.floor(ms / 3600000);
  if(h < 1) return "刚刚";
  if(h < 24) return h + " 小时";
  var d = Math.floor(h / 24);
  if(d < 60) return d + " 天";
  return Math.floor(d / 30) + " 个月";
}
function branchStay(b){
  if(b.status === "released"){
    if(!b.releasedAt || !b.createdAt) return { text:"周期 —", tip:"缺少发布或创建时间" };
    var span = new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime();
    return { text:"周期 " + branchDurText(span),
             tip:"创建 " + fmtTs(b.createdAt) + " → 发布 " + fmtTs(b.releasedAt) };
  }
  var meta = branchStatusMeta(b.status);
  var from = b[meta.timeKey] || b.createdAt;
  if(!from) return { text:"—", tip:"没有进入该状态的时间" };
  var ms = Date.now() - new Date(from).getTime();
  var q = branchDurText(ms);
  return { text: (q === "刚刚" ? "刚刚进入" : "已 " + q), tip: meta.name + "自 " + fmtTs(from) };
}
function branchQueryParams(extra){
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  if(branchRepoFilter) p.repo = branchRepoFilter;
  if(branchOwnerFilter) p.ownerUserId = branchOwnerFilter;
  if(branchVersionFilter) p.version = branchVersionFilter;
  p.outcome = branchOutcomeFilter || "open";
  var kw = (($("branchSearch") || {}).value || "").trim();
  if(kw) p.q = kw;
  if(extra) for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
  return p;
}
function applyBoard(board){
  board = board || {};
  branchBoard = {
    columns: board.columns || {},
    counts: board.counts || {},
    outcomeCounts: board.outcomeCounts || {},
    repoCounts: board.repoCounts || {},
    avgCycleDays: board.avgCycleDays == null ? null : board.avgCycleDays
  };
  branchExtra = { dev:[], testing:[], merging:[], released:[] };
  branchList = [];
  BRANCH_STATUS.forEach(function(s){
    var col = branchBoard.columns[s.id];
    if(col && col.items) branchList = branchList.concat(col.items);
  });
}
var branchLoadSeq = 0;
var branchReposLoaded = false;
var branchReposSeq = 0;
function loadRepos(force){
  if(branchReposLoaded && !force) return Promise.resolve(branchRepoCache);
  var seq = ++branchReposSeq;
  return API.get("/api/repos").then(function(list){
    if(seq !== branchReposSeq) return branchRepoCache;
    branchRepoCache = list || [];
    branchReposLoaded = true;
    populateRepoFilter();
    updateRepoButton();
    return branchRepoCache;
  }).catch(function(){
    updateRepoButton();
    return branchRepoCache;
  });
}
function loadBranches(force){
  if(branchesLoaded && !force && branchBoard) return Promise.resolve(branchList);
  /* 筛选/搜索连续触发时只认最后一次请求，避免慢响应把新筛选结果盖回旧的 */
  var seq = ++branchLoadSeq;
  return Promise.all([
    API.get("/api/branches/board", branchQueryParams({ limit: BRANCH_BOARD_PAGE })),
    API.getAllPages("/api/branches/options"),
    loadRepos()
  ]).then(function(res){
    if(seq !== branchLoadSeq) return;
    applyBoard(res[0]);
    branchRefs = res[1] || [];
    branchOptionCache = {};
    branchesLoaded = true;
    if(activeView === "branches") renderBranches();
    populateProjectFilter();
    populateRepoFilter();
    populateOwnerFilter();
    populateVersionFilter();
    loadPendingGroups();
    /* 列表模式要有全量数据：看板刷新后顺带刷新一次列表，避免新增/改状态后列表还是旧的 */
    if(activeView === "branches" && branchViewMode === "list" && !branchRowsLoading) loadBranchRows();
    /* 看板卡片上带着分支标签，数据回来后要重画一次（render 会重建 DOM，所以只在看板停留时做） */
    if(state.board && activeView === "board") render({animate:false});
  }).catch(function(){ /* 分支模块不可用时静默降级，不影响主流程 */ });
}
function loadPendingGroups(){
  var seq = ++branchPendingSeq;
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  if(branchRepoFilter) p.repo = branchRepoFilter;
  if(branchOwnerFilter) p.ownerUserId = branchOwnerFilter;
  if(branchVersionFilter) p.version = branchVersionFilter;
  var kw = (($("branchSearch") || {}).value || "").trim();
  if(kw) p.q = kw;
  return API.get("/api/branches/pending", p).then(function(groups){
    if(seq !== branchPendingSeq) return;
    branchPendingGroups = groups || [];
    renderPendingBar();
  }).catch(function(){ /* 待确认队列拉取失败不影响看板主流程 */ });
}
function loadMoreBranches(status){
  var col = branchBoard && branchBoard.columns[status];
  if(!col) return;
  var loaded = (col.items ? col.items.length : 0) + (branchExtra[status] || []).length;
  API.get("/api/branches/page", branchQueryParams({ status: status, offset: loaded, limit: BRANCH_PAGE }))
    .then(function(page){
      page = page || {};
      branchExtra[status] = (branchExtra[status] || []).concat(page.items || []);
      col.matched = page.total;
      col.hasMore = !!page.hasMore;
      branchList = branchList.concat(page.items || []);
      if(page.counts) branchBoard.counts = page.counts;
      if(page.avgCycleDays != null) branchBoard.avgCycleDays = page.avgCycleDays;
      renderBranches();
    }).catch(function(ex){ toast(ex.message || "加载更多失败", "bad"); });
}
function applyBranchDeepLink(){
  var status = hashParam("status"), from = hashParam("from");
  if(!status || !branchStatusMeta(status) || !branchStatusMeta(status).hint){
    /* 侧栏等普通入口：不沿用上一次深链强加的来源条与状态筛选 */
    if(branchSource){ branchSource = null; branchFilter = ""; }
    return false;
  }
  branchSource = { from: from === "accept" || from === "merge" ? from : "link", status: status };
  branchFilter = branchStatusMeta(status).id;
  /* 来源条条数要与「我的工作」一致：深链按全空间该状态看，不叠加此前留下的项目 / 仓库 / 负责人 / 版本 / 关键词筛选 */
  var search = $("branchSearch");
  var reset = !!branchProjectFilter || !!branchRepoFilter || !!branchOwnerFilter || !!branchVersionFilter
    || !!(search && search.value.trim()) || branchOutcomeFilter !== "open";
  branchProjectFilter = "";
  branchRepoFilter = "";
  branchOutcomeFilter = "open";
  branchOwnerFilter = "";
  branchVersionFilter = "";
  if($("branchProjectFilter")) $("branchProjectFilter").value = "";
  if($("branchRepoFilter")) $("branchRepoFilter").value = "";
  if($("branchOwnerFilter")) $("branchOwnerFilter").value = "";
  if($("branchVersionFilter")) $("branchVersionFilter").value = "";
  if(search) search.value = "";
  syncBranchFilterControls();
  return reset;
}
function branchSourceName(){
  if(!branchSource) return null;
  if(branchSource.from === "accept") return "待验收";
  if(branchSource.from === "merge") return "待合并";
  return "按状态筛选";
}
function clearBranchDeepLink(){
  if(String(window.location.hash || "").indexOf("#/branches?") !== 0) return;
  try{ history.replaceState(null, "", "#/branches"); }catch(e){ /* noop */ }
}
function dropBranchSource(){
  if(!branchSource) return;
  branchSource = null;
  clearBranchDeepLink();
}
/* 深链来源条：位于分支看板之上，说明为什么只看这一档，并提供一键清除 */
function renderBranchSource(box){
  var host = document.getElementById("branchSource");
  if(!branchSource){
    if(host) host.remove();
    return;
  }
  var parent = box && box.parentNode;
  if(!parent) return;
  if(!host){
    host = document.createElement("div");
    host.id = "branchSource";
    host.className = "br-source";
    host.setAttribute("role", "status");
    parent.insertBefore(host, box);
  }
  var st = branchStatusMeta(branchFilter || branchSource.status);
  var n = branchStat()[st.id] || 0;
  host.innerHTML = '<span class="br-source-ico" aria-hidden="true">↩</span>'
    + '<span class="br-source-text">来自 <b>我的工作</b> · <b>' + esc(branchSourceName()) + '</b></span>'
    + '<span class="br-source-rule">只看「' + esc(st.name) + '」分支</span>'
    + '<span class="br-source-count">' + n + ' 条</span>'
    + '<button type="button" class="br-source-clear" data-br-source-clear>清除来源 ×</button>';
  host.onclick = function(e){
    if(!e.target.closest("[data-br-source-clear]")) return;
    dropBranchSource();
    branchFilter = "";
    renderBranches();
    if(branchViewMode === "list") loadBranchRows();
  };
}
function enterBranchesView(){
  var resetScope = applyBranchDeepLink();
  updateBranchModeUI();
  populateOwnerFilter();
  populateVersionFilter();
  renderBranches();                       // 先用缓存出一版，避免空白
  loadBranches(resetScope).then(function(){ renderBranches(); });
  if(branchViewMode === "list") loadBranchRows();
}
/* 列表模式按 100 条续页取完整结果，保留现有本地排序与分组。
   快照只下推项目/负责人/版本这三个「改动必重拉」的条件；状态与关键词在本地过滤——
   若把状态/关键词也下推，快照会停留在旧筛选子集上，本地换筛选就会错显空表。 */
function loadBranchRows(){
  var seq = ++branchRowsSeq;
  branchRowsLoading = true;
  renderBranches();
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  if(branchRepoFilter) p.repo = branchRepoFilter;
  if(branchOwnerFilter) p.ownerUserId = branchOwnerFilter;
  if(branchVersionFilter) p.version = branchVersionFilter;
  p.outcome = branchOutcomeFilter || "open";
  return API.getAllPages("/api/branches", p)
    .then(function(rows){
      if(seq !== branchRowsSeq) return;
      branchRows = rows || [];
      branchRowsLoading = false;
      pruneBranchSelection();
      if(activeView === "branches") renderBranches();
      loadPendingGroups();
    })
    .catch(function(ex){
      if(seq !== branchRowsSeq) return;
      branchRowsLoading = false;
      if(activeView === "branches") renderBranches();
      toast(ex.message || "分支列表加载失败", "bad");
    });
}
function branchSearchText(){
  return (($("branchSearch") || {}).value || "").trim().toLowerCase();
}
function filteredBranchRows(){
  var q = branchSearchText();
  return branchRows.filter(function(b){
    if(branchOutcomeFilter !== "all" && (b.outcome || "open") !== branchOutcomeFilter) return false;
    if(branchRepoFilter){
      if(branchRepoFilter === "__none__"){ if(b.repoId) return false; }
      else if(b.repoId !== branchRepoFilter) return false;
    }
    if(branchFilter && b.status !== branchFilter) return false;
    if(branchOwnerFilter === "__none__"){
      if(b.ownerUserId || b.owner) return false;
    }else if(branchOwnerFilter && b.ownerUserId !== branchOwnerFilter) return false;
    if(!q) return true;
    var hay = [b.name, b.targetBranch, b.note, b.owner];
    (b.projects || []).forEach(function(p){ hay.push(p.projectName || p.projectId); });
    if(b.reqId) hay.push(projectNameById(b.reqId));
    return hay.some(function(x){ return String(x || "").toLowerCase().indexOf(q) !== -1; });
  }).sort(function(a, b){
    var d = branchStatusOrder(a.status) - branchStatusOrder(b.status);
    return d !== 0 ? d : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}
function branchProjectsText(b){
  if(b.reqId) return projectNameById(b.reqId) || b.reqId;
  var names = (b.projects || []).map(function(p){ return p.projectName || p.projectId; }).filter(Boolean);
  return names.length ? names.join("、") : "空间级";
}
function branchRowHTML(b, showRepo){
  var sm = branchStatusMeta(b.status);
  var stay = branchStay(b);
  var writable = canEditBranch(b);
  var taskTxt = b.taskCount ? ((b.doneCount || 0) + "/" + b.taskCount) : "—";
  var oc = b.outcome || "open";
  var ocTag = oc === "open" ? "" : '<span class="br-tag-mini' + (oc === "pending" ? " warn" : (oc === "done" ? " ok" : ""))
    + '" title="' + esc(oc === "pending" ? branchPendingReasonText(b.pendingReason) : "生命周期：" + branchOutcomeMeta(oc).name)
    + '">' + esc(branchOutcomeMeta(oc).name) + '</span>';
  var repoCell = b.repoName
    ? esc(b.repoName)
    : (b.repoId ? esc(branchRepoName(b.repoId)) : '<span class="foot-note" title="手工创建，没有绑定 GitLab 仓库">未归属仓库</span>');
  return '<tr data-branch="' + esc(b.id) + '" tabindex="0">' +
    '<td class="br-sel-cell"><input type="checkbox" data-br-select="' + esc(b.id) + '"'
      + (branchSelected[b.id] ? " checked" : "") + ' aria-label="选择分支 ' + esc(b.name) + '" /></td>' +
    '<td class="br-name-cell" title="' + esc(b.name) + '">' + esc(b.name) + '</td>' +
    '<td>' + (writable
      ? '<button class="br-badge ' + sm.cls + '" type="button" data-br-status-menu="' + esc(b.id) +
        '" title="点击切换状态">' + sm.name + icon("down", 11) + '</button>'
      : '<span class="br-badge ' + sm.cls + '" title="只读分支，不能改状态">' + sm.name + '</span>') + ocTag + '</td>' +
    '<td>' + (b.owner ? avatarHTML(b.owner, "sm") + ' ' + esc(b.owner) : '<span class="foot-note">未指派</span>') + '</td>' +
    '<td>' + esc(branchProjectsText(b)) + '</td>' +
    (showRepo ? '<td>' + repoCell + '</td>' : '') +
    '<td>' + (b.targetBranch ? esc(b.targetBranch) : "—") + '</td>' +
    '<td class="num">' + taskTxt + '</td>' +
    '<td title="' + esc(stay.tip) + '">' + esc(stay.text) + '</td>' +
    '<td>' + (b.updatedAt ? esc(fmtTs(b.updatedAt)) : "—") + '</td>' +
  '</tr>';
}
/* 列表分组的组键与组名：项目维度取主项目（reqId 优先，公共分支归「空间级」），不把跨项目分支复制成多行 */
function branchGroupInfo(b){
  if(branchListGroup === "status"){
    var sm = branchStatusMeta(b.status);
    return { key: b.status || "__other__", label: sm.name, dot: sm.cls };
  }
  if(branchListGroup === "owner"){
    return b.owner
      ? { key: b.ownerUserId || ("n:" + b.owner), label: b.owner }
      : { key: "__none__", label: "未指派" };
  }
  if(branchListGroup === "project"){
    if(b.reqId) return { key: b.reqId, label: projectNameById(b.reqId) || b.reqId };
    var p = (b.projects || [])[0];
    if(p && (p.projectId || p.projectName)) return { key: p.projectId || "__none__", label: p.projectName || p.projectId || "未知项目" };
    return { key: "__none__", label: "空间级公共分支" };
  }
  if(branchListGroup === "repo"){
    if(b.repoId) return { key: b.repoId, label: b.repoName || branchRepoName(b.repoId) };
    return { key: "__none__", label: "未归属仓库" };
  }
  return null;
}
function buildBranchGroups(rows){
  var groups = [];
  var byKey = {};
  rows.forEach(function(b){
    var info = branchGroupInfo(b);
    if(!info) return;
    var g = byKey[info.key];
    if(!g){ g = { key: info.key, label: info.label, dot: info.dot || "", rows: [] }; byKey[info.key] = g; groups.push(g); }
    g.rows.push(b);
  });
  if(branchListGroup === "status"){
    groups.sort(function(a, b){ return branchStatusOrder(a.key) - branchStatusOrder(b.key); });
  }else{
    groups.sort(function(a, b){
      if(a.key === "__none__") return 1;
      if(b.key === "__none__") return -1;
      return String(a.label).localeCompare(String(b.label), "zh-CN");
    });
  }
  return groups;
}
function renderBranchList(rows){
  var body;
  var showRepo = branchRepoCache.length > 0 || rows.some(function(b){ return !!b.repoId; });
  var cols = showRepo ? 10 : 9;
  var allSel = !!rows.length && rows.every(function(b){ return !!branchSelected[b.id]; });
  if(!rows.length){
    body = '<tr><td colspan="' + cols + '" class="manager-empty-cell">没有匹配的分支</td></tr>';
  }else if(branchListGroup !== "none"){
    body = buildBranchGroups(rows).map(function(g){
      var head = (g.dot ? '<i class="br-dot ' + esc(g.dot) + '"></i>' : '') +
        '<span class="bgr-name">' + esc(g.label) + '</span>' +
        '<span class="bgr-n">' + g.rows.length + ' 条</span>';
      return '<tr class="br-group-row"><td colspan="' + cols + '">' + head + '</td></tr>' +
        g.rows.map(function(b){ return branchRowHTML(b, showRepo); }).join("");
    }).join("");
  }else{
    body = rows.map(function(b){ return branchRowHTML(b, showRepo); }).join("");
  }
  return '<div class="br-list-wrap"><table class="manager-tbl br-list">' +
    '<thead><tr><th class="br-sel-cell"><input type="checkbox" data-br-select-all aria-label="全选当前列表"'
      + (allSel ? " checked" : "") + ' /></th><th>分支</th><th>状态</th><th>负责人</th><th>项目</th>'
      + (showRepo ? '<th>仓库</th>' : '') + '<th>目标分支</th>' +
      '<th class="num">工作项</th><th>停留</th><th>更新时间</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}
function selectedBranchIds(){
  var ids = [];
  for(var k in branchSelected) if(Object.prototype.hasOwnProperty.call(branchSelected, k) && branchSelected[k]) ids.push(k);
  return ids;
}
function pruneBranchSelection(){
  var rows = filteredBranchRows();
  var alive = {};
  rows.forEach(function(b){ if(branchSelected[b.id]) alive[b.id] = true; });
  branchSelected = alive;
}
function renderBulkBar(){
  var n = selectedBranchIds().length;
  var has = n > 0;
  return '<div class="br-bulk" role="toolbar" aria-label="批量人工判定">' +
    '<span>已选 <b class="sel-n">' + n + '</b> 条</span>' +
    (has ? '<span class="foot-note">判定会记录操作人与时间，可撤销</span>' : '<span class="foot-note">勾选分支后可批量标记生命周期</span>') +
    '<span class="spacer"></span>' +
    '<button class="btn sm" type="button" data-br-bulk-decide="done"' + (has ? "" : " disabled") + '>完成</button>' +
    '<button class="btn sm" type="button" data-br-bulk-decide="canceled"' + (has ? "" : " disabled") + '>取消</button>' +
    '<button class="btn sm" type="button" data-br-bulk-decide="ignored"' + (has ? "" : " disabled") + '>忽略</button>' +
    '<button class="btn sm ghost" type="button" data-br-bulk-decide=""' + (has ? "" : " disabled") + '>撤销判定</button>' +
  '</div>';
}
function renderLifecycleChips(){
  var host = $("branchLifeChips");
  if(!host) return;
  var counts = (branchBoard && branchBoard.outcomeCounts) || {};
  host.innerHTML = BRANCH_OUTCOMES.map(function(o){
    var n = o.id === "all" ? (counts.all || 0) : (counts[o.id] || 0);
    var on = branchOutcomeFilter === o.id;
    return '<button type="button" class="br-chip' + (o.id === "pending" ? " br-chip-pending" : "") + (on ? " on" : "") +
      '" data-br-outcome="' + o.id + '" aria-pressed="' + on + '">' + o.name +
      '<span class="n">' + n + '</span></button>';
  }).join("");
}
function renderPendingBar(){
  var host = $("branchPending");
  if(!host) return;
  var total = 0;
  branchPendingGroups.forEach(function(g){ total += (g.count || 0); });
  if(!total){
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  var groups = branchPendingGroups.map(function(g){
    var items = (g.items || []);
    var shown = items.slice(0, 4);
    var rows = shown.map(function(b){
      var editable = canEditBranch(b);
      return '<div class="br-pending-item">' +
        '<button type="button" class="name" data-br-pending-open="' + esc(b.id) + '" title="查看分支详情">' + esc(b.name) + '</button>' +
        '<span class="why">' + esc(branchPendingReasonText(b.pendingReason)) + '</span>' +
        '<span class="acts">' + (editable
          ? '<button class="btn sm" type="button" data-br-pending-decide="done" data-br-id="' + esc(b.id) + '">完成</button>' +
            '<button class="btn sm ghost" type="button" data-br-pending-decide="canceled" data-br-id="' + esc(b.id) + '">取消</button>' +
            '<button class="btn sm ghost" type="button" data-br-pending-decide="ignored" data-br-id="' + esc(b.id) + '">忽略</button>'
          : '<span class="foot-note">只读</span>') + '</span>' +
      '</div>';
    }).join("");
    var more = items.length > shown.length
      ? '<button class="btn sm ghost" type="button" data-br-pending-repo="' + esc(g.repoId || "") + '">还有 ' + (items.length - shown.length) + ' 条，查看全部</button>'
      : "";
    return '<div class="br-pending-group">' +
      '<div class="br-pending-repo">' +
        '<b>' + esc(g.repoName || "已解绑仓库") + '</b>' +
        (g.reqName ? '<span class="foot-note">' + esc(g.reqName) + '</span>' : "") +
        '<span class="n">' + (g.count || 0) + ' 条</span>' +
      '</div>' + rows + more +
    '</div>';
  }).join("");
  host.hidden = false;
  host.innerHTML = '<div class="br-pending-head">待确认队列 · 共 ' + total + ' 条' +
    '<button class="btn sm" type="button" data-br-outcome="pending">只看待确认</button></div>' + groups;
}
function branchRepoName(id){
  for(var i = 0; i < branchRepoCache.length; i++){
    if(branchRepoCache[i].id === id) return branchRepoCache[i].name || branchRepoCache[i].repoUrl || id;
  }
  return id || "";
}
function repoLabel(r){
  return r.name || r.repoUrl || r.id;
}
/* 仓库筛选跟随项目：选了项目就只列该项目的仓库 */
function projectRepos(){
  return branchRepoCache.filter(function(r){
    return !branchProjectFilter || r.reqId === branchProjectFilter;
  });
}
function scopeRepoToProject(){
  if(!branchRepoFilter || branchRepoFilter === "__none__" || !branchReposLoaded) return;
  var r = findRepo(branchRepoFilter);
  if(!r || (branchProjectFilter && r.reqId !== branchProjectFilter)){
    branchRepoFilter = "";
    if($("branchRepoFilter")) $("branchRepoFilter").value = "";
  }
}
function repoFreshness(r){
  if(r.syncEnabled === false){
    return { dot:"off", text:"已暂停", title:"定时同步已暂停，仍可手动同步" };
  }
  if(r.lastSyncStatus === "error"){
    return { dot:"warn", text:"同步失败", title:r.lastSyncError || "上次同步失败" };
  }
  if(!r.lastSyncAt){
    return { dot:"off", text:"未同步", title:"还没有同步过" };
  }
  var ms = Date.now() - new Date(r.lastSyncAt).getTime();
  var ago;
  if(!(ms > 0) || ms < 60000) ago = "刚刚";
  else if(ms < 3600000) ago = Math.floor(ms / 60000) + " 分钟前";
  else if(ms < 86400000) ago = Math.floor(ms / 3600000) + " 小时前";
  else ago = Math.floor(ms / 86400000) + " 天前";
  return { dot:"ok", text: ago + "同步", title:"上次同步：" + fmtTs(r.lastSyncAt) };
}
function populateRepoFilter(){
  var sel = $("branchRepoFilter");
  if(!sel) return;
  var repos = projectRepos();
  var counts = (branchBoard && branchBoard.repoCounts) || {};
  var unassigned = counts.__none__ || 0;
  var cur = branchRepoFilter || "";
  var html = '<option value="">' + (branchProjectFilter && repos.length ? "全部仓库（" + repos.length + "）" : "全部仓库") + '</option>';
  repos.forEach(function(r){
    html += '<option value="' + esc(r.id) + '">' + esc(repoLabel(r)) + '</option>';
  });
  if(unassigned) html += '<option value="__none__">未归属仓库（' + unassigned + '）</option>';
  sel.innerHTML = html;
  if(branchReposLoaded && cur && cur !== "__none__" && !repos.some(function(r){ return r.id === cur; })) branchRepoFilter = "";
  if(cur === "__none__" && branchBoard && !unassigned) branchRepoFilter = "";
  sel.value = branchRepoFilter || "";
}
/* 本项目仓库条：选了项目就把「这个项目由哪几个仓库组成」摆在分支上方，不用先开抽屉 */
function renderRepoStrip(){
  var host = $("branchRepoStrip");
  if(!host) return;
  var repos = projectRepos();
  var counts = (branchBoard && branchBoard.repoCounts) || {};
  var unassigned = counts.__none__ || 0;
  if(!branchProjectFilter || (!repos.length && !unassigned)){
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  var failed = repos.filter(function(r){
    return r.syncEnabled !== false && r.lastSyncStatus === "error";
  }).length;
  var chips = '<button type="button" class="br-repochip' + (branchRepoFilter ? "" : " on") +
    '" data-br-repo="" aria-pressed="' + (branchRepoFilter ? "false" : "true") + '">' +
    '<span class="nm">全部</span><span class="num">' + (counts.all || 0) + '</span></button>';
  chips += repos.map(function(r){
    var on = branchRepoFilter === r.id;
    var fresh = repoFreshness(r);
    return '<button type="button" class="br-repochip' + (on ? " on" : "") + (r.syncEnabled === false ? " paused" : "") +
      '" data-br-repo="' + esc(r.id) + '" aria-pressed="' + (on ? "true" : "false") +
      '" title="' + esc(repoLabel(r) + " · " + fresh.title) + '">' +
      '<span class="nm">' + esc(repoLabel(r)) + '</span>' +
      '<span class="st"><i class="' + fresh.dot + '"></i>' + esc(fresh.text) + '</span>' +
      '<span class="num">' + (counts[r.id] || 0) + '</span></button>';
  }).join("");
  if(unassigned){
    chips += '<button type="button" class="br-repochip muted' + (branchRepoFilter === "__none__" ? " on" : "") +
      '" data-br-repo="__none__" aria-pressed="' + (branchRepoFilter === "__none__" ? "true" : "false") +
      '" title="手工创建、没有绑定仓库的分支">' +
      '<span class="nm">未归属仓库</span><span class="st"><i class="off"></i>手工</span>' +
      '<span class="num">' + unassigned + '</span></button>';
  }
  host.hidden = false;
  host.innerHTML = '<div class="br-repostrip-head"><b>本项目仓库</b><span>' + repos.length + ' 个仓库' +
      (failed ? ' · <em class="err">' + failed + ' 个同步失败</em>' : "") + '</span>' +
      (isWorkspaceOwner() ? '<button type="button" class="br-repostrip-manage" data-br-repo-manage>管理仓库 →</button>' : "") +
    '</div>' +
    '<div class="br-repostrip-chips">' + chips + '</div>';
}
function isWorkspaceOwner(){
  return !!(rt.currentWs && rt.currentWs.myRole === "owner");
}
function updateRepoButton(){
  var btn = $("branchReposBtn");
  if(btn) btn.hidden = !isWorkspaceOwner();
}
function decideBranch(id, decision){
  var b = branchById(id);
  if(!b){ toast("分支不存在或未加载", "warn"); return Promise.resolve(false); }
  if(!canEditBranch(b)){ toast("你对该项目只有查看权限，不能做人工判定", "warn"); return Promise.resolve(false); }
  var flow;
  if(decision === "canceled" || decision === "ignored"){
    flow = UI.showPrompt({
      title: decision === "canceled" ? "取消分支" : "忽略分支",
      desc: "只标记生命周期，不删除分支；判定人与时间会记入操作记录，之后可撤销。",
      label: "理由（必填，≤32 字）", maxLength: 32, required: true,
      okText: decision === "canceled" ? "确认取消" : "确认忽略"
    });
  }else if(!decision){
    flow = UI.showConfirm({
      title: "撤销人工判定",
      msg: "「" + esc(b.name) + "」将按远程事实与合并证据重新计算生命周期。确定撤销？",
      okText: "撤销判定", danger: false
    });
  }else{
    flow = Promise.resolve(true);
  }
  return flow.then(function(v){
    if(!v) return false;
    var reason = (decision === "canceled" || decision === "ignored") ? v : null;
    return API.post("/api/branches/" + encodeURIComponent(id) + "/outcome", {
      decision: decision || "",
      reason: reason
    }).then(function(nb){
      toast("「" + nb.name + "」→ " + branchOutcomeMeta(nb.outcome).name, "fs");
      branchSelected = {};
      return loadBranches(true).then(function(){
        if(branchViewMode === "list") loadBranchRows();
        if(brDrawerId === id) openBranchDrawer(id);
      });
    }).catch(function(ex){
      toast(ex.message || "判定失败", "bad");
      return false;
    });
  });
}
function batchDecide(decision){
  if(branchBulkBusy) return;
  var ids = selectedBranchIds();
  if(!ids.length){ toast("先勾选要判定的分支", "warn"); return; }
  var run = function(reason){
    branchBulkBusy = true;
    API.post("/api/branches/outcomes/batch", {
      ids: ids,
      decision: decision || "",
      reason: reason || null
    }).then(function(results){
      branchBulkBusy = false;
      var list = results || [];
      var ok = list.filter(function(r){ return r.ok; }).length;
      var lines = list.map(function(r){
        return (r.ok ? "✓ " : "✗ ") + (r.name || r.id)
          + (r.ok ? " → " + branchOutcomeMeta(r.outcome).name : "：" + (r.message || "失败"));
      });
      branchSelected = {};
      return UI.showConfirm({
        title: "批量判定结果（成功 " + ok + " / 失败 " + (list.length - ok) + "）",
        msg: '<div class="br-bulk-result">' + lines.map(esc).join("<br>") + '</div>',
        okText: "知道了", cancelText: "关闭", danger: false
      }).then(function(){
        loadBranches(true).then(function(){
          if(branchViewMode === "list") loadBranchRows();
        });
      });
    }).catch(function(ex){
      branchBulkBusy = false;
      toast(ex.message || "批量判定失败", "bad");
    });
  };
  if(decision === "canceled" || decision === "ignored"){
    UI.showPrompt({
      title: decision === "canceled" ? "批量取消" : "批量忽略",
      desc: "将给所选 " + ids.length + " 条分支写入同一判定理由；单条失败不影响其他条目。",
      label: "理由（必填，≤32 字）", maxLength: 32, required: true,
      okText: "确认"
    }).then(function(reason){ if(reason) run(reason); });
    return;
  }
  run(null);
}
function branchStat(){
  var counts = (branchBoard && branchBoard.counts) || {};
  var s = { total: counts.all || 0 };
  BRANCH_STATUS.forEach(function(x){ s[x.id] = counts[x.id] || 0; });
  return s;
}
function branchCycleAvg(){
  var d = branchBoard && branchBoard.avgCycleDays;
  if(d == null) return null;
  return Number(d).toFixed(Number(d) >= 10 ? 0 : 1);
}
function renderBranches(){
  var box = $("branchGroups");
  if(!box) return;
  renderBranchSource(box);
  syncBranchFilterControls();
  renderLifecycleChips();
  renderPendingBar();
  renderRepoStrip();
  updateRepoButton();
  /* 列表模式没有四列分组，容器要退出 grid 布局，否则表格只能占 1/4 宽 */
  box.classList.toggle("br-list-mode", branchViewMode === "list");
  var st = branchStat();
  var meta = $("branchMeta");
  var projectFilterName = branchProjectFilter ? (projectNameById(branchProjectFilter) || "") : "";
  if(meta){
    var cycle = branchCycleAvg();
    var extra = "";
    if(branchProjectFilter) extra += " · 项目「" + esc(projectFilterName) + "」";
    if(branchRepoFilter) extra += " · 仓库「" + esc(branchRepoFilter === "__none__" ? "未归属仓库" : branchRepoName(branchRepoFilter)) + "」";
    if(branchOwnerFilter) extra += " · 负责人「" + esc(branchOwnerFilterName()) + "」";
    if(branchVersionFilter) extra += " · 版本「" + esc(branchVersionFilterName()) + "」";
    if(branchOutcomeFilter !== "open") extra += " · 生命周期「" + esc(branchOutcomeMeta(branchOutcomeFilter).name) + "」";
    if(branchGroupMode === "project") extra += " · 按项目分组（仅统计已加载 " + branchList.length + " 条）";
    if(branchGroupMode === "repo") extra += " · 按仓库分组（仅统计已加载 " + branchList.length + " 条）";
    if(branchViewMode === "list") extra += " · 列表视图";
    /* 汇总里的每一档都可点击：直接按状态筛选，和分组头的点击等价 */
    var metaLink = function(id, html){
      var on = !!id && branchFilter === id;
      return '<button type="button" class="br-meta-link' + (on ? " on" : "") + '" data-br-meta="' + (id || "") +
        '" aria-pressed="' + on + '" title="' + (id ? "只看这一档，再点一次取消" : "清除状态筛选") + '">' + html + '</button>';
    };
    meta.innerHTML = st.total
      ? metaLink("", "共 <b>" + st.total + "</b> 条")
        + '<span class="br-meta-sep">·</span>' + metaLink("dev", "开发中 <b>" + st.dev + "</b>")
        + '<span class="br-meta-sep">·</span>' + metaLink("testing", "待测试 <b>" + st.testing + "</b>")
        + '<span class="br-meta-sep">·</span>' + metaLink("merging", "待合并 <b>" + st.merging + "</b>")
        + '<span class="br-meta-sep">·</span>' + metaLink("released", "已发布 <b>" + st.released + "</b>")
        + (cycle === null ? "" : ('<span class="br-meta-sep">·</span>平均发布周期 ' + cycle + ' 天'))
        + extra
      : "";
  }

  var isList = branchViewMode === "list";
  if(isList) pruneBranchSelection();
  var listRows = isList ? filteredBranchRows() : null;
  var hasFilter = branchHasFilter();
  /* 一条分支都没有、也没加任何筛选：筛选条针对的是不存在的数据，整条收起，只留空态与新建指引 */
  var filterBarEl = $("branchFilterBar"), filterBtnEl = $("branchFilterBtn"), lifeChipsEl = $("branchLifeChips");
  if(filterBarEl) filterBarEl.hidden = !st.total && !hasFilter;
  if(filterBtnEl) filterBtnEl.hidden = !st.total && !hasFilter;
  if(lifeChipsEl) lifeChipsEl.hidden = !st.total && !hasFilter;
  /* 全空时空态里已有主操作，工具栏不再重复放一个「新建分支」；有数据或筛选无结果时保留 */
  var branchNewBtn = $("branchNew");
  var canCreate = !!branchNewBtn && !roleReadOnly();
  var totalForBtn = isList ? branchRows.length : st.total;
  if(branchNewBtn) branchNewBtn.hidden = !canCreate || (!totalForBtn && !hasFilter);
  if(isList){
    if(branchRowsLoading && !branchRows.length){
      box.innerHTML = '<div class="br-list-wrap" style="padding:16px">' + UI.skeletonRows(5) + '</div>';
      return;
    }
    if(!listRows.length){
      if(!branchRows.length){
        box.innerHTML = '<div class="br-empty-full">' + UI.emptyState({
          icon: "branch",
          title: "还没有分支",
          text: "分支用来跟住一次开发的流转：把分支名记下来，之后每次改状态都会自动留下时间，谁在什么时候推进到哪一步一目了然。",
          actionLabel: canCreate ? "新建分支" : "",
          actionKind: "primary"
        }) + '</div>';
        var emptyBtn = box.querySelector("[data-empty-action]");
        if(emptyBtn) emptyBtn.addEventListener("click", function(){ openBranchDialog(null); });
      }else{
        box.innerHTML = UI.emptyState({
          icon: "filterOff",
          title: "没有匹配的分支",
          text: "换个关键词，或点「清空筛选」再试。"
        });
      }
      return;
    }
    box.innerHTML = renderBulkBar() + renderBranchList(listRows);
    return;
  }
  if(!st.total){
    if(hasFilter){
      box.innerHTML = UI.emptyState({
        icon: "filterOff",
        title: "没有匹配的分支",
        text: "换个关键词，或点「清空筛选」再试。"
      });
      return;
    }
    box.innerHTML = '<div class="br-empty-full">' + UI.emptyState({
      icon: "branch",
      title: "还没有分支",
      text: "分支用来跟住一次开发的流转：把分支名记下来，之后每次改状态都会自动留下时间，谁在什么时候推进到哪一步一目了然。",
      actionLabel: canCreate ? "新建分支" : "",
      actionKind: "primary"
    }) + '</div>';
    var emptyAction = box.querySelector("[data-empty-action]");
    if(emptyAction) emptyAction.addEventListener("click", function(){ openBranchDialog(null); });
    return;
  }

  if(branchGroupMode === "project"){
    box.innerHTML = renderProjectGroups(branchList);
    return;
  }
  if(branchGroupMode === "repo"){
    box.innerHTML = renderRepoGroups(branchList);
    return;
  }

  box.innerHTML = BRANCH_STATUS.map(function(s){
        var col = (branchBoard && branchBoard.columns[s.id]) || {};
        var items = (col.items || []).concat(branchExtra[s.id] || []);
        var matched = col.matched || 0;
        var on = branchFilter === s.id;
        if(branchFilter && !on) items = [];
        var rest = Math.max(matched - items.length, 0);
        var moreHTML = (col.hasMore && rest > 0 && (!branchFilter || on))
          ? '<button class="br-load-more" type="button" data-br-more="' + s.id + '">加载更多（还有 ' + rest + ' 条）</button>'
          : "";
        return '<div class="br-group" data-status="' + s.id + '">' +
          '<div class="br-group-head' + (on ? " on" : "") + '" data-br-filter="' + s.id + '" role="button" tabindex="0"' +
            ' aria-pressed="' + on + '" title="点击只看这一档；再点一次取消">' +
            '<i class="br-dot ' + s.cls + '"></i>' +
            '<span class="br-group-name">' + s.name + '</span>' +
            '<span class="br-group-n">' + matched + '</span>' +
            '<span class="br-group-hint">' + s.hint + '</span>' +
          '</div>' +
          '<div class="br-group-body">' +
            (items.length ? items.map(branchCardHTML).join("") : '<div class="br-empty">暂无</div>') +
            moreHTML +
          '</div>' +
        '</div>';
      }).join("");
}
function branchStatusOrder(status){
  for(var i = 0; i < BRANCH_STATUS.length; i++) if(BRANCH_STATUS[i].id === status) return i;
  return 99;
}
function projectNameById(id){
  if(!id) return null;
  for(var i = 0; i < rt.reqList.length; i++){
    if(rt.reqList[i].id === id) return rt.reqList[i].name || id;
  }
  return id;
}
/* 按仓库分组：同名分支在不同仓库各算一条，未绑定仓库的手工分支单独成组 */
function renderRepoGroups(rows){
  var groups = {};
  rows.forEach(function(b){
    var key = b.repoId || "__none__";
    var name = b.repoName || branchRepoName(b.repoId) || "未归属仓库";
    if(!groups[key]) groups[key] = { id: key, name: name, items: [] };
    groups[key].items.push(b);
  });
  var list = Object.keys(groups).map(function(k){ return groups[k]; });
  list.sort(function(a, b){
    if(a.id === "__none__") return 1;
    if(b.id === "__none__") return -1;
    return String(a.name).localeCompare(String(b.name), "zh-CN");
  });
  return list.map(function(g){
    g.items.sort(function(a, b){
      var d = branchStatusOrder(a.status) - branchStatusOrder(b.status);
      return d !== 0 ? d : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    return '<div class="br-group" data-repo-group="' + esc(g.id) + '">' +
      '<div class="br-group-head' + (branchRepoFilter === g.id ? " on" : "") + '" role="button" tabindex="0" title="点击只看这个仓库">' +
        '<i class="br-dot" aria-hidden="true"></i>' +
        '<span class="br-group-name">' + esc(g.name) + '</span>' +
        '<span class="br-group-n">' + g.items.length + '</span>' +
      '</div>' +
      '<div class="br-group-body">' +
        (g.items.length ? g.items.map(branchCardHTML).join("") : '<div class="br-empty">暂无</div>') +
      '</div>' +
    '</div>';
  }).join("");
}
function renderProjectGroups(rows){
  var groups = {};
  rows.forEach(function(b){
    if(b.reqId){
      addToGroup(b.reqId, projectNameById(b.reqId) || b.reqId, b);
      return;
    }
    var projs = b.projects || [];
    if(!projs.length){
      addToGroup("__none__", "空间级公共分支", b);
      return;
    }
    projs.forEach(function(p){
      addToGroup(p.projectId || "__none__", p.projectName || p.projectId || "未知项目", b);
    });
  });
  function addToGroup(id, name, b){
    var g = groups[id];
    if(!g){ g = { id: id, name: name, items: [] }; groups[id] = g; }
    g.items.push(b);
  }
  var list = Object.keys(groups).map(function(k){ return groups[k]; });
  list.sort(function(a, b){
    if(a.id === "__none__") return 1;
    if(b.id === "__none__") return -1;
    return String(a.name).localeCompare(String(b.name), "zh-CN");
  });
  return list.map(function(g){
    g.items.sort(function(a, b){
      var d = branchStatusOrder(a.status) - branchStatusOrder(b.status);
      return d !== 0 ? d : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    return '<div class="br-group" data-project="' + esc(g.id) + '">' +
      '<div class="br-group-head" role="button" tabindex="0" title="点击按该项目筛选">' +
        '<span class="br-group-name">' + esc(g.name) + '</span>' +
        '<span class="br-group-n">' + g.items.length + '</span>' +
      '</div>' +
      '<div class="br-group-body">' +
        (g.items.length ? g.items.map(branchCardHTML).join("") : '<div class="br-empty">暂无</div>') +
      '</div>' +
    '</div>';
  }).join("");
}
function branchVersionChips(b){
  if(!b.versions || !b.versions.length) return "";
  return '<div class="br-vers">' + b.versions.map(function(v){
    var cls = v.status === "released" ? "tag-success" : (v.status === "active" ? "tag-info" : "ghost");
    var tip = "影响版本：" + (v.reqName ? (v.reqName + " / ") : "") + v.name;
    return assocLinkHTML("version", v.versionId, v.name, {req:v.reqId, cls:"tag " + cls, title:tip});
  }).join("") + '</div>';
}
function branchProjectChips(b){
  if(b.reqId){
    var name = projectNameById(b.reqId) || b.reqId;
    return '<div class="br-projs">' + assocLinkHTML("project", b.reqId, name, {cls:"tag", title:"打开项目：" + name}) + '</div>';
  }
  if(!b.projects || !b.projects.length) return "";
  return '<div class="br-projs">' + b.projects.map(function(p){
    var label = p.projectName || p.projectId || "未知";
    return assocLinkHTML("project", p.projectId, label, {cls:"tag", title:"打开项目：" + label});
  }).join("") + '</div>';
}
function branchShortSha(sha){
  return sha && sha.length > 8 ? sha.slice(0, 8) : (sha || "");
}
/* 卡片/列表的仓库、远程与生命周期标记：只展示事实，不把状态说成结论 */
function branchCardBadges(b){
  var out = [];
  var hasRepo = !!(b.repoId || b.repoName);
  /* 已经按仓库筛过时不再重复挂仓库标签；未归属筛选下反过来标出来源 */
  if(hasRepo && !branchRepoFilter){
    out.push('<span class="br-tag-mini repo" title="' + esc("来源仓库：" + (b.repoUrl || b.repoName || b.repoId)) + '">'
      + esc(b.repoName || "已解绑仓库") + '</span>');
  }
  if(!hasRepo && branchRepoFilter === "__none__"){
    out.push('<span class="br-tag-mini" title="手工创建，没有绑定 GitLab 仓库">未归属仓库</span>');
  }
  var oc = b.outcome || "open";
  if(oc !== "open"){
    var cls = oc === "pending" ? " warn" : (oc === "done" ? " ok" : "");
    var tip = oc === "pending" ? branchPendingReasonText(b.pendingReason) : "生命周期：" + branchOutcomeMeta(oc).name;
    out.push('<span class="br-tag-mini' + cls + '" title="' + esc(tip) + '">' + esc(branchOutcomeMeta(oc).name) + '</span>');
  }
  if(b.remoteState === "deleted") out.push('<span class="br-tag-mini warn" title="远程列表中已看不到该分支">远程已删除</span>');
  if(b.merged) out.push('<span class="br-tag-mini ok" title="' + esc(b.mergeEvidence || ("已合并到 " + (b.mergedInto || "目标分支"))) + '">已合并</span>');
  if(b.remoteHeadSha) out.push('<span class="br-tag-mini sha" title="' + esc("远程 HEAD：" + b.remoteHeadSha + (b.remoteHeadAuthor ? " · " + b.remoteHeadAuthor : "")) + '">HEAD ' + esc(branchShortSha(b.remoteHeadSha)) + '</span>');
  if(b.syncError) out.push('<span class="br-tag-mini warn" title="' + esc(b.syncError) + '">同步失败</span>');
  return out.length ? '<div class="br-card-badges">' + out.join("") + '</div>' : "";
}
function branchCardHTML(b){
  var sm = branchStatusMeta(b.status);
  var stay = branchStay(b);
  var writable = canEditBranch(b);
  var taskTxt = b.taskCount
    ? ((b.doneCount || 0) + "/" + b.taskCount + " 工作项")
    : "无关联工作项";
  return '<article class="br-card" data-branch="' + esc(b.id) + '" data-br-st="' + esc(b.status) + '"' +
      ' draggable="' + (writable ? "true" : "false") + '" title="' + (writable ? "拖到其他状态列" : "只读分支，不能改状态") + '" tabindex="0" role="button"' +
      ' aria-label="' + esc(b.name) + '，' + esc(sm.name) + '">' +
    '<div class="br-card-top">' +
      (writable
        ? '<button class="br-badge ' + sm.cls + '" type="button" data-br-status-menu="' + esc(b.id) + '"' +
          ' title="点击切换状态">' + sm.name + icon("down", 11) + '</button>'
        : '<span class="br-badge ' + sm.cls + '" title="只读分支，不能改状态">' + sm.name + '</span>') +
      (b.owner ? '<span class="br-owner" title="负责人：' + esc(b.owner) + '">' + avatarHTML(b.owner) + '</span>' : '') +
    '</div>' +
    '<div class="br-name" title="' + esc(b.name) + '">' + esc(b.name) + '</div>' +
    branchCardBadges(b) +
    branchVersionChips(b) +
    branchProjectChips(b) +
    (b.targetBranch ? '<div class="br-target" title="目标分支：' + esc(b.targetBranch) + '">→ ' + esc(b.targetBranch) + '</div>' : '') +
    (b.note ? '<div class="br-note" title="' + esc(b.note) + '">' + esc(b.note) + '</div>' : '') +
    '<div class="br-card-foot">' +
      '<span class="br-tasks">' + icon("checklist", 12) + taskTxt + '</span>' +
      '<span class="br-age" title="' + esc(stay.tip) + '">' + esc(stay.text) + '</span>' +
    '</div>' +
  '</article>';
}
function openBranchStatusMenu(anchor, id){
  var b = branchById(id);
  if(!b) return;
  if(!canEditBranch(b)){ toast("你对该项目只有查看权限，不能修改分支", "warn"); return; }
  var el = document.createElement("div");
  el.className = "menu br-status-menu";
  el.innerHTML = BRANCH_STATUS.map(function(s){
    var cur = s.id === b.status;
    return '<button class="menu-item' + (cur ? " on" : "") + '" type="button" data-br-set="' + s.id + '">' +
        '<i class="br-dot ' + s.cls + '"></i>' + s.name +
        (cur ? '<span class="k">当前</span>' : '') +
      '</button>';
  }).join("") +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-br-edit="1">编辑分支信息</button>' +
    '<button class="menu-item danger" type="button" data-br-del="1">删除分支</button>';
  el.addEventListener("click", function(e){
    var set = e.target.closest("[data-br-set]");
    if(set){
      UI.closeAllPops();
      requestBranchStatus(b, set.dataset.brSet);
      return;
    }
    if(e.target.closest("[data-br-edit]")){ UI.closeAllPops(); openBranchDialog(id); return; }
    if(e.target.closest("[data-br-del]")){ UI.closeAllPops(); deleteBranch(id); }
  });
  UI.openPop(el, anchor, { align: "left" });
}
/* 抽屉里的「改状态」：只列状态本身，编辑/删除留在页脚；回退会标出来 */
function openDrawerStatusMenu(anchor, b){
  if(!b) return;
  if(!canEditBranch(b)){ toast("你对该项目只有查看权限，不能修改分支", "warn"); return; }
  var curIdx = branchStatusIndex(b.status);
  var el = document.createElement("div");
  el.className = "menu br-status-menu";
  el.innerHTML = BRANCH_STATUS.map(function(s, i){
    var cur = s.id === b.status;
    return '<button class="menu-item' + (cur ? " on" : "") + '" type="button" data-br-drawer-set="' + s.id + '"' +
        (cur ? " disabled" : "") + '>' +
        '<i class="br-dot ' + s.cls + '"></i>' + s.name +
        (cur ? '<span class="k">当前</span>' : (i < curIdx ? '<span class="k">回退</span>' : '')) +
      '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var set = e.target.closest("[data-br-drawer-set]");
    if(!set) return;
    UI.closeAllPops();
    requestBranchStatus(b, set.dataset.brDrawerSet);
  });
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
/* 所有入口统一走这里：回退（目标状态在当前之前）会改写时间线与负责人通知，先确认；前进保持零阻力 */
function requestBranchStatus(b, to, after){
  if(typeof b === "string") b = branchById(b) || branchMetaById(b);
  if(!b || !to || b.status === to) return;
  var fromIdx = branchStatusIndex(b.status);
  var toIdx = branchStatusIndex(to);
  var toName = branchStatusMeta(to).name;
  if(toIdx < fromIdx){
    UI.showConfirm({
      title: "回退分支状态",
      msg: "「" + esc(b.name) + "」将从 <b>" + esc(branchStatusMeta(b.status).name) + "</b> 回退到 <b>" + esc(toName) +
        "</b>，会写入操作记录并通知负责人。确定继续？",
      okText: "回退到 " + toName
    }).then(function(ok){ if(ok) setBranchStatus(b.id, to, after); });
    return;
  }
  setBranchStatus(b.id, to, after);
}
function setBranchStatus(id, status, after){
  var b = branchMetaById(id);
  if(!b || b.status === status) return;
  API.post("/api/branches/" + encodeURIComponent(id) + "/status", { status: status })
    .then(function(nb){
      /* 先就地更新引用，调用方（如发布计划）不必等列表重拉就能重画 */
      var meta = branchMetaById(id);
      if(meta) meta.status = nb.status;
      toast("「" + nb.name + "」→ " + branchStatusMeta(nb.status).name, "fs");
      if(typeof after === "function"){ try{ after(nb); }catch(e){ /* 调用方刷新失败不影响分支保存 */ } }
      return loadBranches(true);
    })
    .then(function(){
      if(brDrawerId === id) openBranchDrawer(id);
    })
    .catch(function(ex){ toast(ex.message || "状态切换失败", "bad"); });
}
function fillBranchStatusOptions(sel, cur){
  if(!sel) return;
  sel.innerHTML = BRANCH_STATUS.map(function(s){
    return '<option value="' + s.id + '"' + (s.id === cur ? " selected" : "") + '>' + s.name + '</option>';
  }).join("");
}
function fillBranchReqOptions(sel, cur){
  if(!sel) return;
  if(!rt.reqsLoaded){
    ensureReqs(function(){
      var s = $("brReq");
      if(rt.reqsLoaded && s === sel){
        fillBranchReqOptions(s, cur);
        /* 项目列表迟到时，把仓库候选也按选中项目补上 */
        fillBranchRepoOptions($("brRepo"), "", s.value, !!brEditingId);
      }
    });
    return;
  }
  var html = '<option value="">空间级公共分支</option>';
  (rt.reqList || []).forEach(function(r){
    /* 只读项目不提供新建入口；保留当前值以免编辑已有分支时下拉变空 */
    if(r.id !== cur && !canEditReq(r.id)) return;
    html += '<option value="' + esc(r.id) + '"' + (r.id === cur ? " selected" : "") + '>' + esc(r.name || r.id) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  });
  sel.innerHTML = html;
}
/* 所属仓库：只列该项目的仓库；没有绑定仓库或空间级分支时整个字段收起 */
function branchReposFor(reqId){
  if(!reqId) return [];
  return branchRepoCache.filter(function(r){ return r.reqId === reqId; });
}
function fillBranchRepoOptions(sel, cur, reqId, disabled, fallbackLabel){
  if(!sel) return;
  var field = $("brRepoField");
  var repos = branchReposFor(reqId);
  var known = repos.some(function(r){ return r.id === cur; });
  if(!repos.length && !cur){
    if(field) field.hidden = true;
    sel.innerHTML = '<option value="">不归属仓库（手工分支）</option>';
    sel.value = "";
    sel.disabled = true;
    return;
  }
  if(field) field.hidden = false;
  var html = '<option value="">不归属仓库（手工分支）</option>';
  repos.forEach(function(r){
    html += '<option value="' + esc(r.id) + '"' + (r.id === cur ? " selected" : "") + '>' + esc(repoLabel(r)) + '</option>';
  });
  /* 编辑已绑定仓库但它已不在可见缓存里：保留当前值，别让下拉悄悄改成「手工分支」 */
  if(cur && !known){
    html += '<option value="' + esc(cur) + '" selected>' + esc(fallbackLabel || cur) + '</option>';
  }
  sel.innerHTML = html;
  sel.value = cur || "";
  sel.disabled = !!disabled;
}
function ensureBranchRepos(cb){
  if(branchReposLoaded){ cb(); return; }
  loadRepos().then(cb, cb);
}
function openBranchDialog(id){
  brDialogTask = null;
  var known = id ? branchById(id) : null;
  if(id && !known){
    /* 本地缓存里找不到时先按 ID 拉取，绝不以空表单进入编辑（否则保存会把名称外的字段清空） */
    API.get("/api/branches/" + encodeURIComponent(id)).then(function(b){
      if(brDrawerId === b.id) brDrawerData = b;
      openBranchDialogWith(id, b);
    }).catch(function(ex){ toast(ex.message || "分支加载失败", "bad"); });
    return;
  }
  openBranchDialogWith(id, known);
}
/** 从任务表单读取当前负责人，供就地新建分支时预填；没有负责人时返回 null */
function taskOwnerSelection(){
  var sel = $("iOwner");
  if(!sel || sel.tagName !== "SELECT" || sel.selectedIndex < 0) return null;
  var opt = sel.options[sel.selectedIndex];
  if(!opt) return null;
  var name = ((opt.dataset && opt.dataset.name) || opt.textContent || "").replace(/\s+/g, " ").trim();
  if(!name) return null;
  return { name: name, userId: opt.value && opt.value !== "__text__" ? opt.value : "" };
}
/* 分支负责人浮层：与任务抽屉同一份候选（公司分组 + 主岗位 / 兼岗）。
   隐藏值 brOwner=账号 id、brOwnerName=姓名；历史非成员姓名无 id，提交时 ownerUserId=null。 */
function branchOwnerMatched(ownerOpts, curId, curName){
  var m = null;
  if(curId) m = ownerOpts.filter(function(o){ return o.id === curId; })[0] || null;
  if(!m && curName) m = ownerOpts.filter(function(o){ return o.name === curName; })[0] || null;
  return m;
}
function setBranchOwnerField(curId, curName){
  var btn = $("brOwnerBtn"), idEl = $("brOwner"), nameEl = $("brOwnerName");
  if(!btn || !idEl || !nameEl) return;
  var st = ownerRosterState();
  var m = branchOwnerMatched(ownerPickerOptions(), curId, curName);
  var opt;
  if(m){ opt = { id:m.id, name:m.name, company:m.company, role:m.role, secondary:m.secondary }; }
  else if(curId){ opt = { id:curId, name:curName || curId, subText:st.pending ? "候选加载中…" : (st.error ? "候选加载失败" : "已不在本项目候选范围") }; }
  else if(curName){ opt = { id:"", name:curName, textOnly:true }; }
  else { opt = null; }
  idEl.value = opt ? (opt.id || "") : "";
  nameEl.value = opt ? (opt.name || "") : "";
  btn.innerHTML = peopleFieldHTML(opt, "未指派");
  btn.classList.toggle("is-empty", !opt);
  btn.setAttribute("aria-label", opt ? ("负责人：" + opt.name + "，点击修改") : "负责人：未指派，点击选择成员");
}
function buildBranchOwnerCfg(anchor){
  var st = ownerRosterState();
  var curId = ($("brOwner") || {}).value || "", curName = ($("brOwnerName") || {}).value || "";
  var ownerOpts = ownerPickerOptions();
  var m = branchOwnerMatched(ownerOpts, curId, curName);
  return {
    anchor:anchor, title:"负责人",
    options:st.pending || st.error ? [] : ownerOpts,
    currentId:m ? m.id : "", currentName:curName,
    unavailable:(curId && !m) ? { id:curId, name:curName } : null,
    allowClear:true, clearLabel:"未指派",
    loading:st.pending, error:st.error ? (st.error.message || "网络异常") : "",
    onRetry:function(){ ensureProjectRoles(currentProjectId(), true); hookBranchOwnerRoster(); },
    onPick:function(o){ setBranchOwnerField(o ? o.id : "", o ? o.name : ""); }
  };
}
function refreshBranchOwnerPicker(){
  if(brOwnerPickerRef && UI.popOpen(brOwnerPickerRef.el)){
    var cfg = buildBranchOwnerCfg(brOwnerPickerRef.anchor);
    brOwnerPickerRef.refresh({ options:cfg.options, currentId:cfg.currentId, currentName:cfg.currentName, unavailable:cfg.unavailable, loading:cfg.loading, error:cfg.error });
  }
}
function refreshBranchOwnerField(){
  var d = $("dlgBranch");
  if(d && d.classList.contains("open")) setBranchOwnerField(($("brOwner") || {}).value || "", ($("brOwnerName") || {}).value || "");
}
/* 花名册异步就绪后，把字段与浮层从「加载中」刷新为真实公司·岗位；复用同一份加载 Promise，不重复请求。 */
function hookBranchOwnerRoster(){
  if(!ownerRosterState().pending) return;
  ensureProjectRoles(currentProjectId());
  var ws = rt.currentWs, pid = currentProjectId();
  if(ws && pid) loadProjectMembers(ws.id, pid).then(onBranchRosterSettled, onBranchRosterSettled);
}
function onBranchRosterSettled(){ refreshBranchOwnerField(); refreshBranchOwnerPicker(); }
function openBranchOwnerPicker(anchor){
  var cfg = buildBranchOwnerCfg(anchor);
  brOwnerPickerRef = openPeoplePicker(cfg);
  if(brOwnerPickerRef) brOwnerPickerRef.anchor = anchor;
  if(cfg.loading) hookBranchOwnerRoster();
}
/** 工作项抽屉里就地新建：按当前项目预填，创建后自动挂到当前工作项 */
function openBranchDialogForTask(projectId){
  brDialogTask = { projectId: projectId || "" };
  openBranchDialogWith(null, null, { fromTask: true, projectId: projectId || "" });
}
function openBranchDialogWith(id, b, options){
  var dialogOpts = options || {};
  var fromTask = !!dialogOpts.fromTask;
  var taskProjectId = dialogOpts.projectId || "";
  brEditingId = id || null;
  b = brEditingId ? b : null;
  $("dlgBranchTitle").textContent = b ? "编辑分支" : "新建分支";
  $("dlgBranchMsg").textContent = b
    ? "状态不在这里改 —— 点分支卡片上的状态标签切换，那样才会记进时间线。"
    : (fromTask
      ? "建好后会自动选中并挂到当前工作项；保存工作项后关联生效。分支名照 git 里的写法填。"
      : "分支名照 git 里的写法填，建好之后就能跟状态和时间。");
  $("dlgBranchOk").textContent = b ? "保存" : (fromTask ? "新建并选中" : "新建分支");
  /* 编辑时隐藏「初始状态」（状态只能走状态切换接口） */
  if($("brStatusField")) $("brStatusField").hidden = !!b;
  $("brName").value = b ? (b.name || "") : "";
  $("brTarget").value = b ? (b.targetBranch || "") : "";
  $("brNote").value = b ? (b.note || "") : "";
  fillBranchStatusOptions($("brStatus"), b ? b.status : "dev");
  fillBranchReqOptions($("brReq"), b ? (b.reqId || "") : (fromTask ? taskProjectId : (branchProjectFilter || "")));
  /* 所属仓库：新建时跟随项目与当前仓库筛选；编辑时只读展示（换仓库会打乱远程事实） */
  var chosenReq = ($("brReq") || {}).value || "";
  var initialRepo = "";
  if(b){
    initialRepo = b.repoId || "";
  }else if(branchRepoFilter && branchRepoFilter !== "__none__"){
    var presetRepo = findRepo(branchRepoFilter);
    if(presetRepo && presetRepo.reqId === chosenReq) initialRepo = presetRepo.id;
  }
  fillBranchRepoOptions($("brRepo"), initialRepo, chosenReq, !!b, b ? (b.repoName || branchRepoName(b.repoId)) : "");
  if(!b){
    ensureBranchRepos(function(){
      var d = $("dlgBranch");
      if(!d || !d.classList.contains("open") || brEditingId) return;
      fillBranchRepoOptions($("brRepo"), ($("brRepo") || {}).value || initialRepo,
        ($("brReq") || {}).value || "", false);
    });
  }

  /* 负责人：沿用任务抽屉的口径（成员列表 + 账号绑定），改用带公司·岗位的人员浮层。
     从任务里就地新建时默认跟任务负责人走，避免把分支指派给「当前操作人」；
     任务没有负责人时再回落到当前用户。 */
  var taskOwner = fromTask ? taskOwnerSelection() : null;
  var curName = b ? (b.owner || "")
    : (taskOwner ? taskOwner.name : (rt.currentUser ? (rt.currentUser.displayName || "") : ""));
  var curId = b ? (b.ownerUserId || "")
    : (taskOwner ? (taskOwner.userId || "") : (rt.currentUser ? rt.currentUser.id : ""));
  setBranchOwnerField(curId, curName);
  hookBranchOwnerRoster();

  $("dlgBranch").__uiOnClose = function(){ brEditingId = null; brDialogTask = null; };
  UI.openModal($("dlgBranch"));
  setTimeout(function(){ try{ $("brName").focus(); }catch(e){ /* noop */ } }, 40);
}
function closeBranchDialog(){
  var d = $("dlgBranch");
  if(d) UI.closeModal(d);
  brEditingId = null;
  brDialogTask = null;
}
/** 新建成功后就地挂到任务抽屉的下拉，不要求用户再回分支页刷新 */
function attachCreatedBranchToTask(b){
  var sel = $("iBranch");
  if(!sel || !b) return;
  var projectId = (($("iReq") || {}).value) || "";
  var rows = branchOptionCache[projectId];
  if(rows){
    var found = false;
    for(var i = 0; i < rows.length; i++) if(rows[i].id === b.id){ found = true; break; }
    if(!found) rows.push(b);
    branchOptionCache[projectId] = rows;
    if(projectId) delete branchOptionCache[""];  /* 全量缓存已过期，下次按需重拉 */
    fillBranchSelect(sel, b.id, rows);
  }else{
    /* 选项还在加载 / 加载失败：先把新分支塞进当前下拉，避免用户等一次刷新 */
    var opt = null;
    for(var j = 0; j < sel.options.length; j++) if(sel.options[j].value === b.id){ opt = sel.options[j]; break; }
    if(!opt){
      opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name + (b.targetBranch ? " → " + b.targetBranch : "");
      sel.appendChild(opt);
    }
    sel.value = b.id;
    sel.setAttribute("data-ready", "1");
  }
  var hint = $("iBranchHint");
  if(hint) hint.textContent = "已创建并选中「" + b.name + "」，保存工作项后关联生效。";
  try{ sel.dispatchEvent(new Event("change", { bubbles: true })); }catch(e){ /* noop：事件派发失败不影响选中 */ }
}
function submitBranchDialog(){
  /* 回车提交不经过按钮的禁用状态：请求在途时忽略 */
  if($("dlgBranchOk") && $("dlgBranchOk").disabled) return;
  var name = ($("brName").value || "").trim();
  if(!name){ toast("请填写分支名", "warn"); try{ $("brName").focus(); }catch(e){} return; }
  if(!/^[\p{L}\p{N}._/-]{1,80}$/u.test(name)){
    toast("分支名只允许字母、数字、点、下划线、中划线、斜杠", "warn");
    try{ $("brName").focus(); }catch(e){}
    return;
  }
  var ownerId = ($("brOwner") || {}).value || "";
  var ownerName = ($("brOwnerName") || {}).value || "";
  var payload = {
    name: name,
    targetBranch: ($("brTarget").value || "").trim() || null,
    /* 空串 = 明确改成空间级公共分支；null 会被后端当成「不改」 */
    reqId: ($("brReq") || {}).value || "",
    note: ($("brNote").value || "").trim() || null,
    owner: ownerName || null,
    ownerUserId: ownerId || null
  };
  if(!brEditingId){
    payload.status = ($("brStatus") || {}).value || "dev";
    payload.repoId = ($("brRepo") || {}).value || null;
  }

  var req = brEditingId
    ? API.put("/api/branches/" + encodeURIComponent(brEditingId), payload)
    : API.post("/api/branches", payload);
  var wasEdit = !!brEditingId;
  var btn = $("dlgBranchOk");
  btn.disabled = true;
  req.then(function(b){
    var taskCtx = brDialogTask;
    btn.disabled = false;
    closeBranchDialog();
    if(taskCtx){
      attachCreatedBranchToTask(b);
      toast("已创建「" + b.name + "」，保存工作项后关联生效", "fs");
    }else{
      toast(wasEdit ? ("已更新「" + b.name + "」") : ("已创建分支「" + b.name + "」"), "fs");
    }
    loadBranches(true).then(function(){
      if(brDrawerId === b.id) openBranchDrawer(b.id);
    });
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function deleteBranch(id){
  var b = branchById(id);
  if(!b) return;
  if(!canEditBranch(b)){ toast("你对该项目只有查看权限，不能删除分支", "warn"); return; }
  var n = b.taskCount || 0;
  UI.showConfirm({
    title: "删除分支",
    msg: "「" + esc(b.name) + "」将被删除，操作记录一起清掉" +
      (n ? ("；挂在它上面的 " + n + " 个工作项会解除关联（工作项本身保留）") : "") + "。确定删除？",
    okText: "删除分支"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/branches/" + encodeURIComponent(id)).then(function(){
      if(brDrawerId === id) closeBranchDrawer();
      toast("已删除「" + b.name + "」", "fs");
      loadBranches(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openBranchDrawer(id){
  API.get("/api/branches/" + encodeURIComponent(id)).then(function(b){
    brDrawerId = b.id;
    brDrawerData = b;
    renderBranchDrawer(b);
    var d = $("branchDrawer");
    /* 从工作项抽屉里点「所属分支」打开时要压在上面；否则抽屉被抬到 200 时会被它盖住 */
    var taskOn = $("taskDrawer") && $("taskDrawer").classList.contains("on");
    if(d) d.style.zIndex = taskOn ? String(UI.topOverlayZ() + 1) : "";
    if(d) d.classList.add("on");
    loadBranchLogs(b.id);
    loadBranchTasks(b.id);
  }).catch(function(ex){ toast(ex.message || "分支加载失败", "bad"); });
}
function closeBranchDrawer(){
  var d = $("branchDrawer");
  if(d){ d.classList.remove("on"); d.style.zIndex = ""; }
  brDrawerId = null;
  brDrawerData = null;
}
function branchRemoteStateText(s){
  if(s === "deleted") return "已删除";
  if(s === "active") return "存在";
  return "未知";
}
function shortSha(sha){
  var v = String(sha || "");
  return v ? v.slice(0, 8) : "";
}
/** 远程事实区：只展示同步写入的 GitLab 侧事实，供人工判定时核对 */
function branchRemoteFactsHTML(b){
  if(!b.source || b.source !== "git") return "";
  var head = b.remoteHeadSha
    ? esc(shortSha(b.remoteHeadSha)) + (b.remoteHeadAt ? " · " + esc(fmtTs(b.remoteHeadAt)) : "")
    : "—";
  var merged = b.merged
    ? ("是" + (b.mergedInto ? " → " + esc(b.mergedInto) : "") + (b.mergedAt ? " · " + esc(fmtTs(b.mergedAt)) : ""))
    : "否";
  var evidence = b.mergeEvidence ? ("（" + esc(b.mergeEvidence) + "）") : "";
  var err = b.syncStatus === "error" && b.syncError
    ? '<div><span>同步失败</span><b class="err" title="' + esc(b.syncError) + '">' + esc(b.syncError) + '</b></div>'
    : "";
  return '<div class="br-sect">' +
    '<h4>远程事实</h4>' +
    '<div class="br-facts">' +
      '<div><span>来源</span><b>GitLab 同步</b></div>' +
      '<div><span>仓库</span><b title="' + esc(b.repoUrl || "") + '">' + esc(b.repoName || branchRepoName(b.repoId) || "—") + '</b></div>' +
      '<div><span>远程状态</span><b>' + esc(branchRemoteStateText(b.remoteState)) + '</b></div>' +
      '<div><span>HEAD</span><b class="mono">' + head + '</b></div>' +
      '<div><span>最后提交人</span><b>' + (b.remoteHeadAuthor ? esc(b.remoteHeadAuthor) : "—") + '</b></div>' +
      '<div><span>最后同步</span><b>' + (b.lastSeenAt ? esc(fmtTs(b.lastSeenAt)) : "—") + '</b></div>' +
      '<div><span>合并证据</span><b>' + merged + evidence + '</b></div>' +
      '<div><span>同步状态</span><b>' + (b.syncStatus === "ok" ? "正常" : (b.syncStatus === "error" ? "失败" : "—")) + '</b></div>' +
      err +
    '</div>' +
  '</div>';
}
/** 人工判定区：判定优先于远程事实；只读项目只展示不可操作 */
function branchDecisionHTML(b, editable){
  var oc = b.outcome || "open";
  var meta = branchOutcomeMeta(oc);
  var lines = '<div class="br-decision-line"><span>生命周期</span>' +
    '<span class="tag ' + (oc === "pending" ? "tag-warning" : (oc === "done" ? "tag-success" : "")) + '">' + esc(meta.name) + '</span>' +
    (oc === "pending" ? '<span class="foot-note">' + esc(branchPendingReasonText(b.pendingReason)) + '</span>' : '') +
  '</div>';
  if(b.decidedAt){
    lines += '<div class="br-decision-line"><span>人工判定</span><b>' + esc(branchOutcomeMeta(b.decision || "done").name) + '</b>' +
      '<span class="foot-note">' + (b.decidedByName ? esc(b.decidedByName) + " · " : "") + esc(fmtTs(b.decidedAt)) + '</span></div>';
  }
  if(b.decisionReason) lines += '<p class="br-decision-reason">理由：' + esc(b.decisionReason) + '</p>';
  if(b.decisionNote) lines += '<p class="br-decision-reason">备注：' + esc(b.decisionNote) + '</p>';
  var acts = editable
    ? '<div class="br-decision-acts">' +
        '<button class="btn sm" type="button" data-br-decide="done" data-br-id="' + esc(b.id) + '">标记完成</button>' +
        '<button class="btn sm ghost" type="button" data-br-decide="canceled" data-br-id="' + esc(b.id) + '">取消</button>' +
        '<button class="btn sm ghost" type="button" data-br-decide="ignored" data-br-id="' + esc(b.id) + '">忽略</button>' +
        (b.decidedAt
          ? '<button class="btn sm ghost" type="button" data-br-decide="" data-br-id="' + esc(b.id) + '">撤销判定</button>'
          : '') +
      '</div>'
    : '<p class="foot-note" style="margin:0">你对该项目只有查看权限，不能做人工判定</p>';
  return '<div class="br-sect"><h4>人工判定</h4><div class="br-decision">' + lines + acts + '</div></div>';
}
function renderBranchDrawer(b){
  var body = $("brDrawerBody");
  if(!body) return;
  $("brDrawerTitle").textContent = b.name;
  var stay = branchStay(b);
  var curIdx = branchStatusIndex(b.status);
  var editable = canEditBranch(b);
  var next = curIdx >= 0 && curIdx < BRANCH_STATUS.length - 1 ? BRANCH_STATUS[curIdx + 1] : null;
  /* 状态区是只读进度条：时间点合并进来，改状态只走右侧两个显式按钮 */
  var flow = BRANCH_STATUS.map(function(s, i){
    var at = b[s.timeKey];
    var cls = "br-st-node " + s.cls + (at ? " visited" : "") + (i === curIdx ? " cur" : "");
    return '<div class="' + cls + '">' +
      '<i class="br-dot ' + s.cls + '"></i>' +
      '<span class="bf-name">' + s.name + '</span>' +
      '<span class="bf-time">' + (at ? esc(fmtTs(at)) : "未进入") + '</span>' +
    '</div>';
  }).join("");

  body.innerHTML =
    '<div class="br-sect br-st-sect">' +
      '<h4>状态</h4>' +
      '<div class="br-st-flow">' + flow + '</div>' +
      '<div class="br-st-bar">' +
        '<span class="br-stay">' + esc(stay.text) + ' · ' + esc(stay.tip) + '</span>' +
        (editable
          ? '<span class="br-st-actions">' +
              '<button class="btn sm" type="button" id="brStatusMore" aria-haspopup="menu">改状态' + icon("down", 11) + '</button>' +
              (next ? '<button class="btn sm primary" type="button" id="brStatusAdvance">推进到 ' + next.name + '</button>' : '') +
            '</span>'
          : '') +
      '</div>' +
    '</div>' +
    '<div class="br-kv">' +
      '<div><span>目标分支</span><b>' + (b.targetBranch ? esc(b.targetBranch) : "—") + '</b></div>' +
      '<div><span>负责人</span><b>' + (b.owner ? esc(b.owner) : "—") + '</b></div>' +
      '<div><span>创建时间</span><b>' + esc(fmtTs(b.createdAt)) + '</b></div>' +
      '<div><span>关联工作项</span><b>' + (b.taskCount ? ((b.doneCount || 0) + " / " + b.taskCount + " 已完成") : "—") + '</b></div>' +
      '<div><span>影响版本</span><b>' + (b.versions && b.versions.length
        ? esc(b.versions.map(function(v){ return v.name; }).join("、")) : "—") + '</b></div>' +
      '<div><span>归属项目</span><b>' + (b.reqId
        ? esc(projectNameById(b.reqId) || b.reqId)
        : (b.projects && b.projects.length
            ? esc(b.projects.map(function(p){ return p.projectName || p.projectId || "未知"; }).join("、")) : "空间级公共分支")) + '</b></div>' +
    '</div>' +
    (b.note ? '<p class="br-drawer-note">' + esc(b.note) + '</p>' : '') +
    branchRemoteFactsHTML(b) +
    branchDecisionHTML(b, editable) +
    '<div class="br-sect"><h4>关联工作项</h4><div id="brTaskList" class="br-tasklist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-sect"><h4>操作记录</h4><div id="brLogList" class="br-loglist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-drawer-foot">' +
      (editable
        ? '<button class="btn ghost danger-text" type="button" id="brDrawerDelete">删除分支</button>'
        : '<span class="foot-note">你对该项目只有查看权限，不能修改或删除分支</span>') +
      '<span style="flex:1 1 auto"></span>' +
      (editable ? '<button class="btn" type="button" id="brDrawerEdit">编辑信息</button>' : '') +
    '</div>';

  var del = $("brDrawerDelete");
  if(del) del.addEventListener("click", function(){ deleteBranch(b.id); });
  var ed = $("brDrawerEdit");
  if(ed) ed.addEventListener("click", function(){ openBranchDialog(b.id); });
  var more = $("brStatusMore");
  if(more) more.addEventListener("click", function(){ openDrawerStatusMenu(more, b); });
  var adv = $("brStatusAdvance");
  if(adv && next) adv.addEventListener("click", function(){ requestBranchStatus(b, next.id); });
}
function loadBranchLogs(id){
  API.getAllPages("/api/branches/" + encodeURIComponent(id) + "/logs").then(function(logs){
    var box = $("brLogList");
    if(!box || brDrawerId !== id) return;
    if(!logs || !logs.length){
      box.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
      return;
    }
    box.innerHTML = logs.map(function(l){
      var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
      return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
        '<span class="tl-detail">' + actor + esc(l.detail || l.action || "") + '</span></div>';
    }).join("");
  }).catch(function(){
    var box = $("brLogList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">操作记录加载失败</div>';
  });
}
function loadBranchTasks(id){
  API.getAllPages("/api/branches/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    var box = $("brTaskList");
    if(!box || brDrawerId !== id) return;
    if(!tasks || !tasks.length){
      box.innerHTML = '<div class="tl-empty">还没有工作项关联到这条分支。在工作项详情的「所属分支」里挂上来。</div>';
      return;
    }
    box.innerHTML = tasks.map(function(t){
      var done = t.boardColumn === "done";
      return '<button class="br-task" type="button" data-br-task="' + esc(t.id) + '">' +
        '<span class="bt-dot' + (done ? " done" : "") + '"></span>' +
        '<span class="bt-title' + (done ? " done" : "") + '">' + esc(t.title) + '</span>' +
        taskPublicationHTML(t) +
        '<span class="bt-pri ' + esc(t.priority || "") + '" style="color:' + esc(priColor(t.priority)) + '">' + esc(priName(t.priority)) + '</span>' +
      '</button>';
    }).join("");
  }).catch(function(){
    var box = $("brTaskList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">关联工作项加载失败</div>';
  });
}
/** 分支字段提示：只读项目里不能出现「点新建分支」这种做不到的引导 */
function branchFieldHint(rows){
  if(rt.drawerReadOnly){
    return rows.length
      ? "当前项目为只读项目，不能新建分支；可查看已有分支。"
      : "当前项目为只读项目，且还没有分支。";
  }
  return rows.length
    ? "找不到合适的分支？点「新建分支」就地创建，建好自动选中，保存后生效。"
    : "还没有分支，点「新建分支」就地创建，建好自动选中，保存后生效。";
}
function fillBranchSelect(sel, cur, rows){
  var html = '<option value="">不关联分支</option>';
  BRANCH_STATUS.forEach(function(s){
    var items = rows.filter(function(b){ return b.status === s.id; });
    if(!items.length) return;
    html += '<optgroup label="' + esc(s.name) + '">';
    items.forEach(function(b){
      html += '<option value="' + esc(b.id) + '" data-status="' + esc(b.archivedAt ? "arch" : s.id) + '" data-target="' + esc(b.targetBranch || "") + '">' + esc(b.name) +
        (b.targetBranch ? " → " + esc(b.targetBranch) : "") + '</option>';
    });
    html += '</optgroup>';
  });
  var ok = rows.some(function(b){ return b.id === cur; });
  if(cur && !ok){
    /* 当前关联的分支不在本项目选项里（如被多个项目共用的公共分支）：保留原值，避免保存时被静默解除关联 */
    var curName = branchNameById(cur);
    html += '<option value="' + esc(cur) + '">' + esc(curName || "当前分支") + '（当前关联）</option>';
    ok = true;
  }
  sel.innerHTML = html;
  sel.value = ok ? cur : "";
  /* 标记选项已就绪：保存时区分「确实不关联」与「选项还没加载完」 */
  sel.setAttribute("data-ready", "1");
  var newBtn = $("iBranchNew");
  if(newBtn) newBtn.hidden = !!rt.drawerReadOnly;
  var hint = $("iBranchHint");
  if(hint) hint.textContent = branchFieldHint(rows);
  syncAssocRead();
}
function populateBranchSelect(keep, projectId){
  var sel = $("iBranch");
  if(!sel) return;
  if(projectId !== undefined) branchSelectProject = projectId || "";
  projectId = branchSelectProject;
  var cur = (keep === undefined ? sel.value : keep) || "";
  var rows = branchOptionCache[projectId];
  if(!rows){
    /* 选项按项目从服务端取，避免把全空间分支一次性灌进下拉 */
    sel.setAttribute("data-ready", "0");
    API.getAllPages("/api/branches/options", projectId ? { project: projectId } : null).then(function(list){
      branchOptionCache[projectId] = list || [];
      if(branchSelectProject === projectId) populateBranchSelect(cur, projectId);
    }).catch(function(){ /* 分支拉取失败时下拉保持空，不影响工作项保存 */ });
    return;
  }
  fillBranchSelect(sel, cur, rows);
}
function populateProjectFilter(){
  var sel = $("branchProjectFilter");
  if(!sel) return;
  if(!rt.reqsLoaded){
    ensureReqs(function(){ if(rt.reqsLoaded) populateProjectFilter(); });
    return;
  }
  var cur = branchProjectFilter || "";
  /* 归档项目默认不进候选（与用例 / 缺陷一致）；已选中时保留，避免筛选被动丢失 */
  var opts = (rt.reqList || []).filter(function(r){ return !r.archivedAt || r.id === cur; })
    .map(function(r){ return { id: r.id, name: (r.name || r.id) + (r.archivedAt ? "（已归档）" : "") }; });
  opts.sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "zh-CN"); });
  var html = '<option value="">全部项目</option>';
  opts.forEach(function(o){
    html += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
  });
  sel.innerHTML = html;
  var hasCur = opts.some(function(o){ return o.id === cur; });
  sel.value = hasCur ? cur : "";
  if(!hasCur && branchProjectFilter) branchProjectFilter = "";
}
/* 负责人筛选下拉：与分支新建/编辑同一份花名册口径（ownerOptions 传空串取空间级成员）。
   候选按当前项目范围带分支数，零结果成员不出现；未指派单独成项；成员已移出等失效值回落到「全部负责人」。 */
var branchOwnerSeq = 0;
function populateOwnerFilter(){
  var sel = $("branchOwnerFilter");
  if(!sel) return;
  var baseOpts = ownerOptions("").slice().sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "zh-CN"); });
  var paint = function(counts){
    var cur = branchOwnerFilter;
    var opts = counts
      ? baseOpts.filter(function(o){ return (counts[o.id] || 0) > 0 || o.id === cur; })
      : baseOpts;
    var noneCount = counts ? (counts.__none__ || 0) : 0;
    var html = '<option value="">全部负责人</option>';
    opts.forEach(function(o){
      var n = counts ? (counts[o.id] || 0) : null;
      html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '">'
        + esc(o.name) + (n === null ? "" : "（" + n + "）") + '</option>';
    });
    if(counts && (noneCount > 0 || cur === "__none__")){
      html += '<option value="__none__" data-name="未指派">未指派（' + noneCount + '）</option>';
    }else if(!counts && cur === "__none__"){
      /* 计数未回时也要先保住视图/深链里的「未指派」，不能在 paint(null) 阶段被清掉 */
      html += '<option value="__none__" data-name="未指派">未指派</option>';
    }
    sel.innerHTML = html;
    var hasCur = cur === "__none__" ? true : opts.some(function(o){ return o.id === cur; });
    sel.value = hasCur ? cur : "";
    if(!hasCur && cur) branchOwnerFilter = "";
  };
  paint(null);
  var seq = ++branchOwnerSeq;
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  if(branchRepoFilter) p.repo = branchRepoFilter;
  if(branchVersionFilter) p.version = branchVersionFilter;
  p.outcome = branchOutcomeFilter || "open";
  API.getAllPages("/api/branches", p).then(function(rows){
    if(seq !== branchOwnerSeq) return;
    var counts = {};
    (rows || []).forEach(function(b){
      if(!b) return;
      if(b.ownerUserId){ counts[b.ownerUserId] = (counts[b.ownerUserId] || 0) + 1; return; }
      /* 与后端 __none__ 口径一致：账号与手填姓名都为空才算未指派 */
      if(!b.owner) counts.__none__ = (counts.__none__ || 0) + 1;
    });
    paint(counts);
  }).catch(function(){ /* 计数失败时退回不带计数的全量候选 */ });
}
function branchOwnerFilterName(){
  if(!branchOwnerFilter) return "";
  if(branchOwnerFilter === "__none__") return "未指派";
  var sel = $("branchOwnerFilter");
  if(sel && sel.value === branchOwnerFilter && sel.selectedIndex >= 0){
    var opt = sel.options[sel.selectedIndex];
    return (opt && opt.dataset.name) || opt.textContent || branchOwnerFilter;
  }
  return branchOwnerFilter;
}
/* 版本筛选：分支本身不存版本，按关联工作项经 version_task 反查；候选只列当前项目内真有分支的版本 */
var branchVersionSeq = 0;
function populateVersionFilter(){
  var sel = $("branchVersionFilter");
  if(!sel) return;
  var seq = ++branchVersionSeq;
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  API.get("/api/branches/versions", p).then(function(list){
    if(seq !== branchVersionSeq) return;
    branchVersionCache = list || [];
    var before = branchVersionFilter;
    paintVersionOptions();
    /* 视图里的版本已不在当前项目（或已被删）：清掉并重拉，避免停在一个空结果上 */
    if(before && !branchVersionFilter && activeView === "branches"){
      if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
    }
  }).catch(function(){ /* 版本候选拉取失败时保留「全部版本」，不影响其他筛选 */ });
}
function paintVersionOptions(){
  var sel = $("branchVersionFilter");
  if(!sel) return;
  var cur = branchVersionFilter;
  var html = '<option value="">全部版本</option>';
  branchVersionCache.forEach(function(v){
    var label = (v.reqName ? v.reqName + " · " : "") + v.name;
    var n = v.count == null ? "" : "（" + v.count + "）";
    html += '<option value="' + esc(v.versionId) + '" data-name="' + esc(label) + '" title="'
      + esc(label + (v.status === "active" ? " · 进行中" : (v.status === "released" ? " · 已发布" : "")))
      + '">' + esc(label) + n + '</option>';
  });
  sel.innerHTML = html;
  var hasCur = !cur || branchVersionCache.some(function(v){ return v.versionId === cur; });
  if(!hasCur) branchVersionFilter = "";
  sel.value = branchVersionFilter || "";
}
function branchVersionFilterName(){
  if(!branchVersionFilter) return "";
  var sel = $("branchVersionFilter");
  if(sel && sel.value === branchVersionFilter && sel.selectedIndex >= 0){
    var opt = sel.options[sel.selectedIndex];
    return (opt && opt.dataset.name) || opt.textContent || branchVersionFilter;
  }
  for(var i = 0; i < branchVersionCache.length; i++){
    if(branchVersionCache[i].versionId === branchVersionFilter){
      var v = branchVersionCache[i];
      return (v.reqName ? v.reqName + " · " : "") + v.name;
    }
  }
  return branchVersionFilter;
}
/* 筛选下拉与内部状态同源：深链 / 汇总点选改了 branchFilter 后，下拉值与生效态跟着走 */
function branchHasFilter(){
  return !!(branchFilter || branchProjectFilter || branchRepoFilter || branchOwnerFilter || branchVersionFilter
    || (branchOutcomeFilter && branchOutcomeFilter !== "open")
    || (($("branchSearch") || {}).value || "").trim());
}
function branchFilterCount(){
  var n = 0;
  if(branchFilter) n++;
  if(branchRepoFilter) n++;
  if(branchOutcomeFilter && branchOutcomeFilter !== "open") n++;
  if(branchOwnerFilter) n++;
  if(branchVersionFilter) n++;
  if((($("branchSearch") || {}).value || "").trim()) n++;
  return n;
}
/* 清空筛选保留当前项目：项目范围是浏览上下文，其他条件才是筛选 */
function branchHasClearable(){
  return !!(branchFilter || branchProjectFilter || branchRepoFilter || branchOwnerFilter || branchVersionFilter
    || (branchOutcomeFilter && branchOutcomeFilter !== "open")
    || (($("branchSearch") || {}).value || "").trim() || branchSource);
}
function syncBranchFilterControls(){
  var stSel = $("branchStatusFilter");
  if(stSel) stSel.value = branchStatusMeta(branchFilter).hint ? branchFilter : "";
  var owSel = $("branchOwnerFilter");
  if(owSel) owSel.value = branchOwnerFilter || "";
  var verSel = $("branchVersionFilter");
  if(verSel) verSel.value = branchVersionFilter || "";
  var prSel = $("branchProjectFilter");
  if(prSel) prSel.value = branchProjectFilter || "";
  var repoSel = $("branchRepoFilter");
  if(repoSel) repoSel.value = branchRepoFilter || "";
  /* 搜索范围跟随项目筛选：选了项目就只在该项目内搜 */
  var search = $("branchSearch");
  if(search){
    search.placeholder = branchProjectFilter ? "搜索所选项目分支…" : "搜索全部分支…";
    search.title = branchProjectFilter
      ? "在所选项目内搜索分支名 / 目标分支"
      : "在全部项目中搜索分支名 / 目标分支";
    search.setAttribute("aria-label", branchProjectFilter ? "在所选项目内搜索分支" : "在全部项目中搜索分支");
  }
  UI.markFiltered(stSel, !branchFilter);
  UI.markFiltered(owSel, !branchOwnerFilter);
  UI.markFiltered(verSel, !branchVersionFilter);
  UI.markFiltered(prSel, !branchProjectFilter);
  UI.markFiltered(repoSel, !branchRepoFilter);
  var clr = $("branchClearFilter");
  if(clr) clr.hidden = !branchHasClearable();
  /* 手机筛选面板默认收起：按钮上带生效条件数，收起时也知道有几项在筛 */
  var cnt = $("branchFilterCount");
  if(cnt){
    var n = branchFilterCount();
    cnt.hidden = !n;
    cnt.textContent = n;
  }
}
/* 一键清空状态 / 负责人 / 版本 / 仓库 / 关键词与深链来源，保留当前项目范围 */
function clearBranchFilters(){
  var had = branchHasClearable();
  clearTimeout(branchSearchTimer);
  branchFilter = "";
  branchOwnerFilter = "";
  branchVersionFilter = "";
  branchRepoFilter = "";
  branchOutcomeFilter = "open";
  branchSelected = {};
  if($("branchOwnerFilter")) $("branchOwnerFilter").value = "";
  if($("branchVersionFilter")) $("branchVersionFilter").value = "";
  if($("branchRepoFilter")) $("branchRepoFilter").value = "";
  if($("branchSearch")) $("branchSearch").value = "";
  dropBranchSource();
  syncBranchFilterControls();
  if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
  if(had) toast(branchProjectFilter ? "已清空分支筛选，保留当前项目" : "已清空分支筛选", "fs");
}

/* ---------- 分支保存视图（scope=branch：项目 / 状态 / 负责人 / 搜索 / 展示方式） ---------- */

var branchViewsMenuEl = $("branchViewsMenu");
function branchViewParams(){
  return {
    scope: "branch", project: branchProjectFilter || "", status: branchFilter || "",
    repo: branchRepoFilter || "", outcome: branchOutcomeFilter || "open",
    owner: branchOwnerFilter || "", version: branchVersionFilter || "",
    q: (($("branchSearch") || {}).value || "").trim(),
    mode: branchViewMode, group: branchGroupMode, listGroup: branchListGroup
  };
}
function branchViewMeaningful(p){
  return !!(p.project || p.status || p.repo || (p.outcome && p.outcome !== "open") || p.owner || p.version || p.q);
}
function applyBranchView(v){
  var p;
  try{ p = JSON.parse(v.params || "{}"); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "branch"){
    toast("视图参数不合法，无法应用（可删除后重新保存）", "bad");
    return;
  }
  branchProjectFilter = p.project && (rt.reqList || []).some(function(r){ return r.id === p.project; }) ? p.project : "";
  branchRepoFilter = typeof p.repo === "string" ? p.repo : "";
  if(branchRepoFilter && branchRepoFilter !== "__none__" && branchRepoCache.length
     && !branchRepoCache.some(function(r){
       return r.id === branchRepoFilter && (!branchProjectFilter || r.reqId === branchProjectFilter);
     })){
    branchRepoFilter = "";
  }
  branchOutcomeFilter = BRANCH_OUTCOMES.some(function(o){ return o.id === p.outcome; }) ? p.outcome : "open";
  branchFilter = p.status && branchStatusMeta(p.status).hint ? p.status : "";
  branchOwnerFilter = p.owner === "__none__"
    ? "__none__"
    : (p.owner && ownerOptions("").some(function(o){ return o.id === p.owner; }) ? p.owner : "");
  branchVersionFilter = typeof p.version === "string" ? p.version : "";
  branchViewMode = p.mode === "list" ? "list" : "board";
  branchGroupMode = ["project", "repo"].indexOf(p.group) !== -1 ? p.group : "status";
  branchListGroup = ["none", "status", "owner", "project", "repo"].indexOf(p.listGroup) !== -1 ? p.listGroup : "none";
  var search = $("branchSearch");
  if(search) search.value = typeof p.q === "string" ? p.q : "";
  try{ localStorage.setItem(BRANCH_VIEW_KEY, branchViewMode); }catch(e){ /* 受限环境忽略 */ }
  dropBranchSource();
  updateBranchModeUI();
  if($("branchListGroup")) $("branchListGroup").value = branchListGroup;
  /* 视图可能换了项目：先用新的项目范围重画项目 / 负责人 / 版本候选，再回填选中值 */
  populateProjectFilter();
  populateOwnerFilter();
  populateVersionFilter();
  syncBranchFilterControls();
  if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
  toast("已应用视图「" + v.name + "」", "fs");
}
function saveBranchView(){
  var p = branchViewParams();
  if(!branchViewMeaningful(p)){ toast("先选择项目或设置筛选条件，再保存视图", "warn"); return; }
  UI.showPrompt({
    title: "保存分支视图",
    desc: "保存当前项目、状态、负责人、版本与展示方式；同名保存将覆盖原视图",
    label: "视图名称（≤20 字）", maxLength: 20, okText: "保存"
  }).then(function(name){
    if(!name) return;
    var overwrite = savedViewsFor("branch").some(function(v){ return v.name === name; });
    API.post("/api/views", { name: name, params: JSON.stringify(p) }).then(function(){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(renderBranchViewsMenu);
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteBranchView(id){
  UI.showConfirm({ title: "删除视图", msg: "确定删除该分支视图？不影响分支数据。", okText: "删除视图" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      loadViews().then(renderBranchViewsMenu);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function renderBranchViewsMenu(){
  if(!branchViewsMenuEl) return;
  var views = savedViewsFor("branch");
  var html = '<div class="menu-title">分支视图</div>';
  if(!views.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的分支视图；选定项目或筛选条件后保存。</p></div>';
  }else{
    html += views.map(function(v){
      return '<div class="menu-row">' +
        '<button class="menu-item" type="button" data-tc-branch-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
        '<button class="icon-btn sm" type="button" data-tc-branch-view-del="' + esc(v.id) + '" aria-label="删除视图" title="删除视图">' + icon("close", 12) + '</button>' +
      '</div>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-tc-branch-view-save>保存当前为视图</button></div>';
  branchViewsMenuEl.innerHTML = html;
}
function updateBranchGroupToggle(){
  var btn = $("branchGroupToggle");
  if(!btn) return;
  /* 三种分组轮换：状态 → 项目 → 仓库 → 状态 */
  var next = branchGroupMode === "status" ? "project" : (branchGroupMode === "project" ? "repo" : "status");
  var nextName = next === "project" ? "按项目分组" : (next === "repo" ? "按仓库分组" : "按状态分组");
  btn.textContent = nextName;
  btn.setAttribute("data-mode", branchGroupMode);
  btn.setAttribute("title", "当前" + (branchGroupMode === "project" ? "按项目" : (branchGroupMode === "repo" ? "按仓库" : "按状态")) + "分组，点击改为" + nextName);
  btn.classList.toggle("primary", branchGroupMode === "status");
  /* 分组只在看板视图有意义 */
  btn.hidden = branchViewMode === "list";
}
function updateBranchModeUI(){
  var seg = $("branchModeSeg");
  if(seg){
    seg.querySelectorAll("[data-br-mode]").forEach(function(b){
      var on = b.dataset.brMode === branchViewMode;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("primary", on);
    });
  }
  /* 分组：看板用切换按钮（状态↔项目），列表用下拉（不分组/状态/负责人/项目） */
  var groupSel = $("branchListGroup");
  if(groupSel) groupSel.hidden = branchViewMode !== "list";
  updateBranchGroupToggle();
}

/* ---------- GitLab 仓库绑定（仅空间主可管理） ---------- */

var repoEditingId = null;
var repoDetailOpen = false;
function fillRepoReqOptions(cur){
  var sel = $("repoReq");
  if(!sel) return;
  if(!rt.reqsLoaded){
    ensureReqs(function(){ fillRepoReqOptions(cur); });
    return;
  }
  var html = '<option value="">请选择项目</option>';
  (rt.reqList || []).forEach(function(r){
    if(r.archivedAt && r.id !== cur) return;
    html += '<option value="' + esc(r.id) + '"' + (r.id === cur ? " selected" : "") + '>' + esc(r.name || r.id) + '</option>';
  });
  sel.innerHTML = html;
  if(cur) sel.value = cur;
}
function repoStatusBadge(r){
  var f = repoFreshness(r);
  if(f.dot === "ok") return '<span class="br-tag-mini ok">同步正常</span>';
  if(f.dot === "warn") return '<span class="br-tag-mini warn">同步失败</span>';
  if(r.syncEnabled === false) return '<span class="br-tag-mini">已暂停</span>';
  return '<span class="br-tag-mini">未同步</span>';
}
function repoProjectLabel(r){
  return r.reqName || projectNameById(r.reqId) || r.reqId || "未关联项目";
}
function paintRepoSyncCard(repo){
  var card = $("repoSyncCard");
  if(!card) return;
  if(!repo){ card.hidden = true; return; }
  card.hidden = false;
  if($("repoSyncWhen")){
    $("repoSyncWhen").textContent = repo.lastSyncAt
      ? ("上次同步：" + fmtTs(repo.lastSyncAt))
      : (repo.lastSyncStatus === "error" ? "上次同步失败" : "还没有同步过");
  }
  var facts = $("repoSyncFacts");
  if(facts){
    var bits = [
      '<span>进行中 <em>' + (repo.openBranchCount || 0) + '</em></span>',
      '<span>待确认 <em>' + (repo.pendingBranchCount || 0) + '</em></span>'
    ];
    if(repo.lastSyncStatus === "error" && repo.lastSyncError){
      bits.push('<span class="msg err">失败原因：' + esc(repo.lastSyncError) + '</span>');
    } else if(repo.lastSyncStatus === "ok" && repo.lastSyncSummary){
      bits.push('<span class="msg">' + esc(repo.lastSyncSummary) + '</span>');
    }
    facts.innerHTML = bits.join("");
  }
}
function paintRepoHead(repo){
  if($("dlgRepoDetailBadge")) $("dlgRepoDetailBadge").innerHTML = repo ? repoStatusBadge(repo) : "";
  if($("dlgRepoDetailSub") && repo){
    $("dlgRepoDetailSub").textContent = "所属项目：" + repoProjectLabel(repo) +
      " · 已跟踪 " + (repo.openBranchCount || 0) + " 条进行中分支" +
      ((repo.pendingBranchCount || 0) ? " · " + repo.pendingBranchCount + " 条待确认" : "");
  }
  paintRepoSyncCard(repo);
}
function setRepoLevel(open){
  repoDetailOpen = !!open;
  if($("repoListView")) $("repoListView").hidden = !!open;
  if($("repoDetailView")) $("repoDetailView").hidden = !open;
}
function resetRepoForm(repo, presetReqId){
  repoEditingId = repo ? repo.id : null;
  if($("repoId")) $("repoId").value = repo ? repo.id : "";
  fillRepoReqOptions(repo ? (repo.reqId || "") : (presetReqId || branchProjectFilter || ""));
  if($("repoName")) $("repoName").value = repo ? (repo.name || "") : "";
  if($("repoUrl")) $("repoUrl").value = repo ? (repo.repoUrl || "") : "";
  if($("repoRef")) $("repoRef").value = repo ? (repo.projectRef || "") : "";
  if($("repoTarget")) $("repoTarget").value = repo ? (repo.defaultTarget || "") : "";
  if($("repoPolicy")) $("repoPolicy").value = repo ? (repo.importPolicy || "recent90") : "recent90";
  if($("repoEnabled")) $("repoEnabled").checked = repo ? repo.syncEnabled !== false : true;
  var token = $("repoToken");
  if(token){
    token.value = "";
    token.placeholder = repo
      ? (repo.tokenConfigured ? "已配置令牌，留空表示不修改" : "未配置令牌，填写后保存")
      : "填写 GitLab 访问令牌（PRIVATE-TOKEN）";
  }
  if($("repoTokenHint")){
    $("repoTokenHint").textContent = repo
      ? "令牌只保存密文；更换后旧令牌不会在 GitLab 侧自动吊销。"
      : "令牌只保存密文，保存后不再显示原文。";
  }
  if($("repoEditLockHint")) $("repoEditLockHint").hidden = !repo;
  if($("dlgRepoDetailTitle")) $("dlgRepoDetailTitle").textContent = repo ? (repo.name || repo.repoUrl || "仓库") : "新建绑定";
  if($("dlgRepoDetailSub")){
    $("dlgRepoDetailSub").textContent = repo
      ? "所属项目：" + repoProjectLabel(repo)
      : "填写 GitLab 连接信息，沙漏只读拉取分支与已合并 MR。";
  }
  paintRepoHead(repo);
  if($("repoSyncNow")) $("repoSyncNow").disabled = !repo;
  if($("dlgRepoOk")) $("dlgRepoOk").textContent = repo ? "保存修改" : "创建绑定";
}
function openRepoDetailLevel(repo, presetReqId){
  resetRepoForm(repo, presetReqId);
  setRepoLevel(true);
  var first = $("repoUrl");
  if(first && !repo) setTimeout(function(){ try{ first.focus(); }catch(e){} }, 60);
}
function openRepoListLevel(){
  repoEditingId = null;
  setRepoLevel(false);
  paintRepoList();
}
function repoGroups(){
  var groups = [], byKey = {};
  branchRepoCache.forEach(function(r){
    var key = r.reqId || "";
    if(!byKey[key]){
      byKey[key] = { reqId: key, name: repoProjectLabel(r), repos: [] };
      groups.push(byKey[key]);
    }
    byKey[key].repos.push(r);
  });
  return groups;
}
function repoRowHTML(r){
  var f = repoFreshness(r);
  var stats = '<span class="st"><i class="' + f.dot + '"></i>' + esc(f.text) + '</span>';
  if(r.openBranchCount != null) stats += '<span>' + r.openBranchCount + ' 条进行中</span>';
  if(r.pendingBranchCount) stats += '<span class="warn">' + r.pendingBranchCount + ' 条待确认</span>';
  if(r.lastSyncStatus === "error" && r.lastSyncError){
    stats += '<span class="err" title="' + esc(r.lastSyncError) + '">' + esc(r.lastSyncError) + '</span>';
  } else if(r.lastSyncStatus === "ok" && r.lastSyncSummary){
    stats += '<span class="sum">' + esc(r.lastSyncSummary) + '</span>';
  }
  return '<div class="br-repo-card' + (r.syncEnabled === false ? " paused" : "") + '">' +
    '<div class="info">' +
      '<div class="nm"><button class="br-repo-name" type="button" data-repo-open="' + esc(r.id) + '">' + esc(r.name || r.repoUrl || r.id) + '</button>' +
        repoStatusBadge(r) +
        (r.tokenConfigured ? '<span class="br-tag-mini ok">令牌已配置</span>' : '<span class="br-tag-mini warn">未配置令牌</span>') +
      '</div>' +
      '<div class="url" title="' + esc(r.repoUrl || "") + '">' + esc(r.repoUrl || "—") + ' · ' + esc(r.projectRef || "—") + '</div>' +
      '<div class="meta br-repo-meta">' + stats + '</div>' +
    '</div>' +
    '<div class="acts">' +
      '<button class="btn sm" type="button" data-repo-sync="' + esc(r.id) + '">同步</button>' +
      '<button class="btn sm ghost br-repo-open-btn" type="button" data-repo-open="' + esc(r.id) + '">详情</button>' +
      '<button class="br-repo-more" type="button" data-repo-more="' + esc(r.id) + '" aria-label="更多操作" aria-haspopup="true" aria-expanded="false">···</button>' +
    '</div>' +
  '</div>';
}
function paintRepoList(){
  var box = $("repoList");
  if(!box) return;
  if(!branchRepoCache.length){
    box.innerHTML = '<div class="br-repo-empty">' +
      '<b>还没有绑定仓库</b>' +
      '<span>点下方「＋ 新建绑定」为项目绑定 GitLab 仓库。</span>' +
      '<span>一个项目可以有多个仓库（例如前端 / 后端 / 定时任务），同步出的分支按仓库隔离，同名也不会互相覆盖。</span>' +
    '</div>';
    return;
  }
  box.innerHTML = repoGroups().map(function(g){
    return '<section class="br-repo-group">' +
      '<div class="br-repo-group-head">' +
        '<b>' + esc(g.name) + '</b>' +
        '<span class="n">' + g.repos.length + ' 个仓库</span>' +
        '<span class="ln"></span>' +
        '<button class="br-ghost-link" type="button" data-repo-add="' + esc(g.reqId) + '">+ 为本项目绑定仓库</button>' +
      '</div>' +
      g.repos.map(repoRowHTML).join("") +
    '</section>';
  }).join("");
}
function findRepo(id){
  for(var i = 0; i < branchRepoCache.length; i++) if(branchRepoCache[i].id === id) return branchRepoCache[i];
  return null;
}
function openRepoMenu(anchor, id){
  var r = findRepo(id);
  if(!r) return;
  var el = document.createElement("div");
  el.className = "menu br-status-menu";
  el.innerHTML =
    '<button class="menu-item" type="button" data-repo-open="' + esc(id) + '">查看与编辑</button>' +
    '<button class="menu-item" type="button" data-repo-sync="' + esc(id) + '">立即同步</button>' +
    '<button class="menu-item" type="button" data-repo-toggle="' + esc(id) + '">' +
      (r.syncEnabled === false ? "启用定时同步" : "暂停定时同步") + '</button>';
  el.addEventListener("click", function(e){
    if(e.target.closest("[data-repo-open]")){ UI.closeAllPops(); openRepoDetailLevel(findRepo(id)); return; }
    if(e.target.closest("[data-repo-sync]")){ UI.closeAllPops(); syncRepoNow(id); return; }
    if(e.target.closest("[data-repo-toggle]")){ UI.closeAllPops(); toggleRepo(id); }
  });
  UI.openPop(el, anchor, { align: "right", sheet: true });
}
function openRepoDialog(){
  if(!isWorkspaceOwner()){ toast("只有空间主可以管理仓库绑定", "warn"); return; }
  openRepoListLevel();
  UI.openModal($("dlgRepo"));
  loadRepos(true).then(function(){
    paintRepoList();
    populateRepoFilter();
  });
}
function submitRepoDialog(){
  var reqId = (($("repoReq") || {}).value || "").trim();
  var repoUrl = (($("repoUrl") || {}).value || "").trim();
  var projectRef = (($("repoRef") || {}).value || "").trim();
  if(!reqId){ toast("请选择所属项目", "warn"); return; }
  if(!repoUrl){ toast("请填写 GitLab 地址", "warn"); return; }
  if(!projectRef){ toast("请填写 GitLab 项目标识", "warn"); return; }
  var token = (($("repoToken") || {}).value || "").trim();
  var editingId = repoEditingId;
  var payload = {
    reqId: reqId,
    name: (($("repoName") || {}).value || "").trim() || null,
    repoUrl: repoUrl,
    projectRef: projectRef,
    defaultTarget: (($("repoTarget") || {}).value || "").trim() || null,
    importPolicy: (($("repoPolicy") || {}).value || "recent90"),
    syncEnabled: !!($("repoEnabled") && $("repoEnabled").checked)
  };
  if(token) payload.token = token;
  var btn = $("dlgRepoOk");
  if(btn) btn.disabled = true;
  var req = editingId
    ? API.put("/api/repos/" + encodeURIComponent(editingId), payload)
    : API.post("/api/repos", payload);
  req.then(function(r){
    if(btn) btn.disabled = false;
    toast(editingId ? ("已保存仓库「" + (r.name || r.repoUrl) + "」") : ("已绑定仓库「" + (r.name || r.repoUrl) + "」"), "fs");
    var savedId = r && r.id ? r.id : editingId;
    return loadRepos(true).then(function(){
      paintRepoList();
      populateRepoFilter();
      loadBranches(true);
      var fresh = savedId ? findRepo(savedId) : null;
      if(fresh && (editingId || repoDetailOpen)) openRepoDetailLevel(fresh);
      else openRepoListLevel();
    });
  }).catch(function(ex){
    if(btn) btn.disabled = false;
    toast(ex.message || "仓库保存失败", "bad");
  });
}
function toggleRepo(id){
  var r = findRepo(id);
  if(!r) return;
  API.post("/api/repos/" + encodeURIComponent(id) + "/enabled?enabled=" + (r.syncEnabled === false ? "true" : "false"))
    .then(function(){ return loadRepos(true); })
    .then(function(){
      paintRepoList();
      if(repoDetailOpen && repoEditingId === id){ var fresh = findRepo(id); if(fresh) paintRepoHead(fresh); }
      toast(r.syncEnabled === false ? "已启用定时同步" : "已暂停定时同步", "fs");
    })
    .catch(function(ex){ toast(ex.message || "修改同步状态失败", "bad"); });
}
function syncRepoNow(id){
  var r = findRepo(id);
  if(!r) return;
  toast("正在同步「" + (r.name || r.repoUrl) + "」…", "fs");
  API.post("/api/repos/" + encodeURIComponent(id) + "/sync-now")
    .then(function(nb){
      toast(nb.lastSyncStatus === "ok"
        ? ("同步完成：" + (nb.lastSyncSummary || "已更新分支"))
        : ("同步失败：" + (nb.lastSyncError || "未知错误")), nb.lastSyncStatus === "ok" ? "fs" : "bad");
      return loadRepos(true);
    })
    .then(function(){
      paintRepoList();
      if(repoDetailOpen && repoEditingId === id){ var fresh = findRepo(id); if(fresh) paintRepoHead(fresh); }
      loadBranches(true).then(function(){ if(branchViewMode === "list") loadBranchRows(); });
    })
    .catch(function(ex){ toast(ex.message || "同步失败", "bad"); });
}

function clearGroupOver(){
  var box = $("branchGroups");
  if(box) box.querySelectorAll(".br-group").forEach(function(g){ g.classList.remove("br-group-over"); });
}
(function wireBranchView(){
  var box = $("branchGroups");
  if(box){
    box.addEventListener("click", function(e){
      var bulk = e.target.closest("[data-br-bulk-decide]");
      if(bulk){ batchDecide(bulk.dataset.brBulkDecide); return; }
      /* 勾选框与全选不触发抽屉 */
      if(e.target.closest("[data-br-select],[data-br-select-all]")) return;
      var more = e.target.closest("[data-br-more]");
      if(more){ loadMoreBranches(more.dataset.brMore); return; }
      var menu = e.target.closest("[data-br-status-menu]");
      if(menu){ e.stopPropagation(); openBranchStatusMenu(menu, menu.dataset.brStatusMenu); return; }
      var card = e.target.closest("[data-branch]");
      if(card) openBranchDrawer(card.dataset.branch);
    });
    box.addEventListener("change", function(e){
      if(e.target.closest("[data-br-select-all]")){
        var on = !!e.target.checked;
        var rows = branchViewMode === "list" ? filteredBranchRows() : [];
        branchSelected = {};
        if(on) rows.forEach(function(b){ branchSelected[b.id] = true; });
        renderBranches();
        return;
      }
      var boxSel = e.target.closest("[data-br-select]");
      if(!boxSel) return;
      var id = boxSel.dataset.brSelect;
      if(boxSel.checked) branchSelected[id] = true;
      else delete branchSelected[id];
      renderBranches();
    });
    box.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      /* 卡片内的原生按钮（状态菜单、版本/项目跳转 chip）自己处理回车，避免误开抽屉 */
      if(e.target.closest("button,a,input,select,textarea")) return;
      var head = e.target.closest(".br-group-head");
      if(head){ e.preventDefault(); head.click(); return; }
      var card = e.target.closest("[data-branch]");
      if(card){ e.preventDefault(); openBranchDrawer(card.dataset.branch); }
    });
    /* 卡片拖动：跨状态列流转（同列无效；与后端一致，仅项目可写者可改状态） */
    box.addEventListener("dragstart", function(e){
      var card = e.target.closest(".br-card");
      if(!card) return;
      var b = branchById(card.dataset.branch);
      if(!canEditBranch(b)){ e.preventDefault(); return; }
      dragBranch = { id: card.dataset.branch, status: card.dataset.brSt };
      e.dataTransfer.setData("text/plain", dragBranch.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("br-dragging");
    });
    box.addEventListener("dragover", function(e){
      if(!dragBranch) return;
      var g = e.target.closest(".br-group");
      clearGroupOver();
      if(!g || g.dataset.status === dragBranch.status) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      g.classList.add("br-group-over");
    });
    box.addEventListener("drop", function(e){
      var g = e.target.closest(".br-group");
      clearGroupOver();
      if(!dragBranch || !g) return;
      var src = dragBranch;
      dragBranch = null;
      if(g.dataset.status === src.status) return;
      e.preventDefault();
      requestBranchStatus(src.id, g.dataset.status);
    });
    box.addEventListener("dragend", function(e){
      clearGroupOver();
      var card = e.target.closest(".br-card");
      if(card) card.classList.remove("br-dragging");
      dragBranch = null;
    });
  }
  if($("branchGroups")){
    $("branchGroups").addEventListener("click", function(e){
      var c = e.target.closest("[data-br-filter]");
      if(c){
        branchFilter = (branchFilter === c.dataset.brFilter) ? "" : c.dataset.brFilter;
        dropBranchSource();
        renderBranches();
        return;
      }
      /* 只认分组头本身：卡片上的点击不应顺带切项目/仓库筛选 */
      var pg = e.target.closest("[data-project] > .br-group-head");
      if(pg){
        var pgEl = pg.parentNode;
        if(pgEl.dataset.project && pgEl.dataset.project !== "__none__") branchProjectFilter = pgEl.dataset.project;
        if($("branchProjectFilter")) $("branchProjectFilter").value = branchProjectFilter;
        /* 版本候选跟随项目：换了项目就把版本条件收回，避免停在别项目的版本上 */
        branchVersionFilter = "";
        if($("branchVersionFilter")) $("branchVersionFilter").value = "";
        scopeRepoToProject();
        populateRepoFilter();
        branchGroupMode = "status";
        updateBranchGroupToggle();
        loadBranches(true);
        return;
      }
      var rg = e.target.closest("[data-repo-group] > .br-group-head");
      if(rg){
        var rid = rg.parentNode.dataset.repoGroup;
        branchRepoFilter = branchRepoFilter === rid ? "" : rid;
        syncBranchFilterControls();
        if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
      }
    });
  }
  if($("branchMeta")){
    $("branchMeta").addEventListener("click", function(e){
      var b = e.target.closest("[data-br-meta]");
      if(!b) return;
      var v = b.dataset.brMeta;
      branchFilter = (!v || branchFilter === v) ? "" : v;
      dropBranchSource();
      if(branchGroupMode === "project"){
        branchGroupMode = "status";
        updateBranchGroupToggle();
        loadBranches(true);
        return;
      }
      renderBranches();
    });
  }
  if($("branchNew")) $("branchNew").addEventListener("click", function(){ openBranchDialog(null); });
  /* 工作项抽屉里的「新建分支」：按当前项目预填，建好自动挂到当前工作项 */
  if($("iBranchNew")) $("iBranchNew").addEventListener("click", function(){
    var projectId = (($("iReq") || {}).value) || "";
    openBranchDialogForTask(projectId);
  });
  if($("branchSearch")) $("branchSearch").addEventListener("input", function(){
    syncBranchFilterControls();
    if(branchViewMode === "list"){ renderBranches(); return; }  /* 列表数据已全量在手，本地过滤即可 */
    clearTimeout(branchSearchTimer);
    branchSearchTimer = setTimeout(function(){ loadBranches(true); }, 300);
  });
  if($("branchClearFilter")) $("branchClearFilter").addEventListener("click", clearBranchFilters);
  if($("branchFilterBtn")) $("branchFilterBtn").addEventListener("click", function(){
    var bar = $("branchFilterBar");
    if(!bar) return;
    var open = bar.classList.toggle("is-open");
    this.setAttribute("aria-expanded", open ? "true" : "false");
  });
  if($("branchViewsBtn") && branchViewsMenuEl){
    $("branchViewsBtn").addEventListener("click", function(){
      if(UI.popOpen(branchViewsMenuEl)){ UI.closeAllPops(); return; }
      renderBranchViewsMenu();
      UI.openPop(branchViewsMenuEl, $("branchViewsBtn"), { align: "left", width: 260 });
      loadViews().then(renderBranchViewsMenu);
    });
    branchViewsMenuEl.addEventListener("click", function(e){
      var ap = e.target.closest("[data-tc-branch-view]");
      if(ap){
        for(var i = 0; i < rt.savedViews.length; i++){
          if(String(rt.savedViews[i].id) === String(ap.dataset.tcBranchView)){
            applyBranchView(rt.savedViews[i]);
            UI.closeAllPops();
            return;
          }
        }
        return;
      }
      var dl = e.target.closest("[data-tc-branch-view-del]");
      if(dl){ deleteBranchView(dl.dataset.tcBranchViewDel); return; }
      if(e.target.closest("[data-tc-branch-view-save]")){ UI.closeAllPops(); saveBranchView(); }
    });
  }
  if($("branchModeSeg")){
    $("branchModeSeg").addEventListener("click", function(e){
      var b = e.target.closest("[data-br-mode]");
      if(!b || b.dataset.brMode === branchViewMode) return;
      branchViewMode = b.dataset.brMode;
      branchFilter = "";
      dropBranchSource();
      try{ localStorage.setItem(BRANCH_VIEW_KEY, branchViewMode); }catch(err){ /* 受限环境忽略 */ }
      updateBranchModeUI();
      renderBranches();
      /* 切回列表要重拉快照：在看板期间改过的项目/负责人筛选不会自动同步到列表行 */
      if(branchViewMode === "list") loadBranchRows();
    });
  }
  if($("branchProjectFilter")){
    $("branchProjectFilter").addEventListener("change", function(e){
      branchProjectFilter = e.target.value;
      branchVersionFilter = "";
      if($("branchVersionFilter")) $("branchVersionFilter").value = "";
      /* 仓库筛选跟随项目：当前仓库不属于新项目就自动收回，避免停在空结果上 */
      scopeRepoToProject();
      populateRepoFilter();
      loadBranches(true);
    });
  }
  /* 版本是服务端过滤：改了要重拉看板、计数与列表快照 */
  if($("branchVersionFilter")){
    $("branchVersionFilter").addEventListener("change", function(e){
      branchVersionFilter = e.target.value;
      populateOwnerFilter();
      loadBranches(true);
    });
  }
  /* 状态下拉与汇总行点选、看板列头点击是同一状态：改了就算接管，清掉深链来源 */
  if($("branchStatusFilter")){
    $("branchStatusFilter").addEventListener("change", function(e){
      branchFilter = e.target.value;
      dropBranchSource();
      if(branchFilter && branchGroupMode === "project"){
        /* 项目分组下没有状态列可承载过滤，选了具体状态就切回状态分组 */
        branchGroupMode = "status";
        updateBranchGroupToggle();
        loadBranches(true);
        return;
      }
      renderBranches();
    });
  }
  /* 负责人是服务端过滤（计数/看板列/列表都跟着变），要走一次重拉 */
  if($("branchOwnerFilter")){
    $("branchOwnerFilter").addEventListener("change", function(e){
      branchOwnerFilter = e.target.value;
      loadBranches(true);
    });
  }
  /* 生命周期 chips：与状态正交，切换后重拉看板/列表；深链来源视为已接管 */
  if($("branchLifeChips")){
    $("branchLifeChips").addEventListener("click", function(e){
      var chip = e.target.closest("[data-br-outcome]");
      if(!chip || chip.dataset.brOutcome === branchOutcomeFilter) return;
      branchOutcomeFilter = chip.dataset.brOutcome;
      branchSelected = {};
      dropBranchSource();
      syncBranchFilterControls();
      if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
    });
  }
  /* 待确认队列：查看详情 / 逐条判定 / 只看待确认 / 按仓库展开 */
  if($("branchPending")){
    $("branchPending").addEventListener("click", function(e){
      var open = e.target.closest("[data-br-pending-open]");
      if(open){ openBranchDrawer(open.dataset.brPendingOpen); return; }
      var dec = e.target.closest("[data-br-pending-decide]");
      if(dec){ decideBranch(dec.dataset.brId, dec.dataset.brPendingDecide); return; }
      var all = e.target.closest("[data-br-pending-repo]");
      if(all){
        branchOutcomeFilter = "pending";
        branchRepoFilter = all.dataset.brPendingRepo || "";
        if($("branchRepoFilter")) $("branchRepoFilter").value = branchRepoFilter;
        syncBranchFilterControls();
        if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
        return;
      }
      var only = e.target.closest("[data-br-outcome]");
      if(only){
        branchOutcomeFilter = only.dataset.brOutcome;
        branchSelected = {};
        dropBranchSource();
        syncBranchFilterControls();
        if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
      }
    });
  }
  if($("branchRepoFilter")){
    $("branchRepoFilter").addEventListener("change", function(e){
      branchRepoFilter = e.target.value;
      syncBranchFilterControls();
      if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
    });
  }
  if($("branchRepoStrip")){
    $("branchRepoStrip").addEventListener("click", function(e){
      if(e.target.closest("[data-br-repo-manage]")){ openRepoDialog(); return; }
      var chip = e.target.closest("[data-br-repo]");
      if(!chip) return;
      branchRepoFilter = chip.dataset.brRepo || "";
      syncBranchFilterControls();
      if(branchViewMode === "list") loadBranchRows(); else loadBranches(true);
    });
  }
  if($("branchReposBtn")) $("branchReposBtn").addEventListener("click", openRepoDialog);
  if($("repoNew")) $("repoNew").addEventListener("click", function(){ openRepoDetailLevel(null, branchProjectFilter || ""); });
  if($("repoBack")) $("repoBack").addEventListener("click", openRepoListLevel);
  if($("dlgRepoCancel")) $("dlgRepoCancel").addEventListener("click", function(){ UI.closeModal($("dlgRepo")); });
  if($("repoDetailCancel")) $("repoDetailCancel").addEventListener("click", openRepoListLevel);
  if($("dlgRepoOk")) $("dlgRepoOk").addEventListener("click", submitRepoDialog);
  if($("repoSyncNow")) $("repoSyncNow").addEventListener("click", function(){ if(repoEditingId) syncRepoNow(repoEditingId); });
  if($("repoList")){
    $("repoList").addEventListener("click", function(e){
      var add = e.target.closest("[data-repo-add]");
      if(add){ openRepoDetailLevel(null, add.dataset.repoAdd || ""); return; }
      var more = e.target.closest("[data-repo-more]");
      if(more){ openRepoMenu(more, more.dataset.repoMore); return; }
      var sy = e.target.closest("[data-repo-sync]");
      if(sy){ syncRepoNow(sy.dataset.repoSync); return; }
      var open = e.target.closest("[data-repo-open]");
      if(open){ openRepoDetailLevel(findRepo(open.dataset.repoOpen)); }
    });
  }
  if($("branchListGroup")){
    $("branchListGroup").addEventListener("change", function(e){
      branchListGroup = e.target.value;
      renderBranches();
    });
  }
  if($("branchGroupToggle")){
    $("branchGroupToggle").addEventListener("click", function(){
      branchGroupMode = branchGroupMode === "status" ? "project"
        : (branchGroupMode === "project" ? "repo" : "status");
      updateBranchGroupToggle();
      renderBranches();
    });
  }
  updateBranchGroupToggle();
  if($("dlgBranchCancel")) $("dlgBranchCancel").addEventListener("click", closeBranchDialog);
  if($("dlgBranchOk")) $("dlgBranchOk").addEventListener("click", submitBranchDialog);
  if($("brOwnerBtn")) $("brOwnerBtn").addEventListener("click", function(){ openBranchOwnerPicker($("brOwnerBtn")); });
  if($("brReq")){
    $("brReq").addEventListener("change", function(){
      /* 仓库候选只属于所选项目：换项目就重画，已选仓库自然收回 */
      fillBranchRepoOptions($("brRepo"), "", this.value, !!brEditingId);
    });
  }
  if($("brName")){
    $("brName").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitBranchDialog(); }
    });
  }

  if($("branchDrawer")){
    /* 抽屉内动态内容的统一委托：工作项跳转 + 人工判定 */
    $("branchDrawer").addEventListener("click", function(e){
      var dec = e.target.closest("[data-br-decide]");
      if(dec){ decideBranch(dec.dataset.brId, dec.dataset.brDecide || ""); return; }
      var task = e.target.closest("[data-br-task]");
      if(task){
        /* 任务抽屉叠在分支抽屉之上，关闭后回到分支详情 */
        openTaskById(task.dataset.brTask);
      }
    });
    $("branchScrim").addEventListener("click", closeBranchDrawer);
  }
  if($("brDrawerClose")) $("brDrawerClose").addEventListener("click", closeBranchDrawer);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape" || e.__dsEscHandled) return;
    if($("dlgBranch") && $("dlgBranch").classList.contains("open")){ closeBranchDialog(); return; }
    var bd = $("branchDrawer");
    if(!bd || !bd.classList.contains("on")) return;
    /* 有弹窗、或任务抽屉压在本层之上时交给上层逐层关闭，别连带收起分支抽屉 */
    if(UI.anyDialogOpen()) return;
    var td = $("taskDrawer");
    if(td && td.classList.contains("on") &&
       (parseInt(td.style.zIndex, 10) || 0) >= (parseInt(bd.style.zIndex, 10) || 0)) return;
    closeBranchDrawer();
  });
})();

function ensureBranchOptions(keep, projectId){
  var seq = rt.taskFormSeq;
  var wantProject = projectId || "";
  function stillCurrent(){
    return seq === rt.taskFormSeq && (($("iReq") ? $("iReq").value : "") === wantProject);
  }
  if(!stillCurrent()) return;
  populateBranchSelect(keep || "", projectId);
}

/* 通知深链：直接按 ID 打开分支抽屉（接口自带权限校验） */
function openBranchById(id){
  openBranchDrawer(id);
}
export { branchMetaById, branchNameById, branchesLoaded, ensureBranchOptions, enterBranchesView, loadBranches, openBranchById, populateBranchSelect, renderBranches, requestBranchStatus };
