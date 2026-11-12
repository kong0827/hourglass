/* views/branches · 分支管理 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { canEditReq, roleReadOnly, rt, state } from "../core/state.js";
import { hashParam, openTaskById } from "../core/task-actions.js";
import { ownerOptions } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtTs, priColor, priName } from "../lib/format.js";
import { loadReqs, render } from "./board.js";

var BRANCH_STATUS = [
  { id:"dev",      name:"开发中", cls:"br-st-dev",      timeKey:"devAt",      hint:"代码还在写" },
  { id:"testing",  name:"待测试", cls:"br-st-testing",  timeKey:"testAt",     hint:"开发完成，等测试验证" },
  { id:"merging",  name:"待合并", cls:"br-st-merging",  timeKey:"mergeAt",    hint:"测过了，等合并窗口" },
  { id:"released", name:"已发布", cls:"br-st-released", timeKey:"releasedAt", hint:"已上线" }
];
var branchList = [];            /* 当前已加载的分支（首屏 + 滚动加载），抽屉/拖拽查用 */
var branchRefs = [];            /* 全量轻量引用：id → 名称，看板卡片标签用 */
var branchBoard = null;         /* { columns, counts, avgCycleDays } */
var branchExtra = { dev:[], testing:[], merging:[], released:[] };
var branchesLoaded = false;
var branchFilter = "";
/* 深链来源：从「我的工作 · 待验收 / 待合并」进来时，明确标出筛选依据；用户改筛选即视为已接管 */
var branchSource = null;          /* { from:"accept"|"merge"|"link", status:"testing"|"merging" } */
var branchProjectFilter = "";
var branchOwnerFilter = "";        /* 负责人筛选：按成员账号（owner_user_id），手填姓名的分支走关键词搜索 */
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
  if(branchOwnerFilter) p.ownerUserId = branchOwnerFilter;
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
function loadBranches(force){
  if(branchesLoaded && !force && branchBoard) return Promise.resolve(branchList);
  /* 筛选/搜索连续触发时只认最后一次请求，避免慢响应把新筛选结果盖回旧的 */
  var seq = ++branchLoadSeq;
  return Promise.all([
    API.get("/api/branches/board", branchQueryParams({ limit: BRANCH_BOARD_PAGE })),
    API.getAllPages("/api/branches/options")
  ]).then(function(res){
    if(seq !== branchLoadSeq) return;
    applyBoard(res[0]);
    branchRefs = res[1] || [];
    branchOptionCache = {};
    branchesLoaded = true;
    if(activeView === "branches") renderBranches();
    populateProjectFilter();
    populateOwnerFilter();
    /* 列表模式要有全量数据：看板刷新后顺带刷新一次列表，避免新增/改状态后列表还是旧的 */
    if(activeView === "branches" && branchViewMode === "list" && !branchRowsLoading) loadBranchRows();
    /* 看板卡片上带着分支标签，数据回来后要重画一次（render 会重建 DOM，所以只在看板停留时做） */
    if(state.board && activeView === "board") render({animate:false});
  }).catch(function(){ /* 分支模块不可用时静默降级，不影响主流程 */ });
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
  /* 来源条条数要与「我的工作」一致：深链按全空间该状态看，不叠加此前留下的项目 / 负责人 / 关键词筛选 */
  var search = $("branchSearch");
  var reset = !!branchProjectFilter || !!branchOwnerFilter || !!(search && search.value.trim());
  branchProjectFilter = "";
  branchOwnerFilter = "";
  if($("branchProjectFilter")) $("branchProjectFilter").value = "";
  if($("branchOwnerFilter")) $("branchOwnerFilter").value = "";
  if(search) search.value = "";
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
  renderBranches();                       // 先用缓存出一版，避免空白
  loadBranches(resetScope).then(function(){ renderBranches(); });
  if(branchViewMode === "list") loadBranchRows();
}
/* 列表模式按 100 条续页取完整结果，保留现有本地排序与分组。
   快照只下推项目/负责人这两个「改动必重拉」的条件；状态与关键词在本地过滤——
   若把状态/关键词也下推，快照会停留在旧筛选子集上，本地换筛选就会错显空表。 */
function loadBranchRows(){
  var seq = ++branchRowsSeq;
  branchRowsLoading = true;
  renderBranches();
  var p = {};
  if(branchProjectFilter) p.project = branchProjectFilter;
  if(branchOwnerFilter) p.ownerUserId = branchOwnerFilter;
  return API.getAllPages("/api/branches", p)
    .then(function(rows){
      if(seq !== branchRowsSeq) return;
      branchRows = rows || [];
      branchRowsLoading = false;
      if(activeView === "branches") renderBranches();
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
    if(branchFilter && b.status !== branchFilter) return false;
    if(branchOwnerFilter && b.ownerUserId !== branchOwnerFilter) return false;
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
function branchRowHTML(b){
  var sm = branchStatusMeta(b.status);
  var stay = branchStay(b);
  var writable = canEditBranch(b);
  var taskTxt = b.taskCount ? ((b.doneCount || 0) + "/" + b.taskCount) : "—";
  return '<tr data-branch="' + esc(b.id) + '" tabindex="0">' +
    '<td class="br-name-cell" title="' + esc(b.name) + '">' + esc(b.name) + '</td>' +
    '<td>' + (writable
      ? '<button class="br-badge ' + sm.cls + '" type="button" data-br-status-menu="' + esc(b.id) +
        '" title="点击切换状态">' + sm.name + icon("down", 11) + '</button>'
      : '<span class="br-badge ' + sm.cls + '" title="只读分支，不能改状态">' + sm.name + '</span>') + '</td>' +
    '<td>' + (b.owner ? avatarHTML(b.owner, "sm") + ' ' + esc(b.owner) : '<span class="foot-note">未指定</span>') + '</td>' +
    '<td>' + esc(branchProjectsText(b)) + '</td>' +
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
      : { key: "__none__", label: "未指定负责人" };
  }
  if(branchListGroup === "project"){
    if(b.reqId) return { key: b.reqId, label: projectNameById(b.reqId) || b.reqId };
    var p = (b.projects || [])[0];
    if(p && (p.projectId || p.projectName)) return { key: p.projectId || "__none__", label: p.projectName || p.projectId || "未知项目" };
    return { key: "__none__", label: "空间级公共分支" };
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
  if(!rows.length){
    body = '<tr><td colspan="8" class="manager-empty-cell">没有匹配的分支</td></tr>';
  }else if(branchListGroup !== "none"){
    body = buildBranchGroups(rows).map(function(g){
      var head = (g.dot ? '<i class="br-dot ' + esc(g.dot) + '"></i>' : '') +
        '<span class="bgr-name">' + esc(g.label) + '</span>' +
        '<span class="bgr-n">' + g.rows.length + ' 条</span>';
      return '<tr class="br-group-row"><td colspan="8">' + head + '</td></tr>' +
        g.rows.map(branchRowHTML).join("");
    }).join("");
  }else{
    body = rows.map(branchRowHTML).join("");
  }
  return '<div class="br-list-wrap"><table class="manager-tbl br-list">' +
    '<thead><tr><th>分支</th><th>状态</th><th>负责人</th><th>项目</th><th>目标分支</th>' +
      '<th class="num">工作项</th><th>停留</th><th>更新时间</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
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
  /* 列表模式没有四列分组，容器要退出 grid 布局，否则表格只能占 1/4 宽 */
  box.classList.toggle("br-list-mode", branchViewMode === "list");
  var st = branchStat();
  var meta = $("branchMeta");
  var projectFilterName = branchProjectFilter ? (projectNameById(branchProjectFilter) || "") : "";
  if(meta){
    var cycle = branchCycleAvg();
    var extra = "";
    if(branchProjectFilter) extra += " · 项目「" + esc(projectFilterName) + "」";
    if(branchOwnerFilter) extra += " · 负责人「" + esc(branchOwnerFilterName()) + "」";
    if(branchGroupMode === "project") extra += " · 按项目分组（仅统计已加载 " + branchList.length + " 条）";
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
  var listRows = isList ? filteredBranchRows() : null;
  var hasFilter = !!(branchFilter || branchProjectFilter || branchOwnerFilter || (($("branchSearch") || {}).value || "").trim());
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
          text: "换个关键词，或清掉状态/负责人/项目筛选再试。"
        });
      }
      return;
    }
    box.innerHTML = renderBranchList(listRows);
    return;
  }
  if(!st.total){
    if(hasFilter){
      box.innerHTML = UI.emptyState({
        icon: "filterOff",
        title: "没有匹配的分支",
        text: "换个关键词，或清掉状态/负责人/项目筛选再试。"
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
    return '<span class="tag ' + cls + '" title="' + esc(tip) + '">' + esc(v.name) + '</span>';
  }).join("") + '</div>';
}
function branchProjectChips(b){
  if(b.reqId){
    var name = projectNameById(b.reqId) || b.reqId;
    return '<div class="br-projs"><span class="tag" title="所属项目：' + esc(name) + '">' + esc(name) + '</span></div>';
  }
  if(!b.projects || !b.projects.length) return "";
  return '<div class="br-projs">' + b.projects.map(function(p){
    var tip = "归属项目：" + (p.projectName || p.projectId || "未知");
    return '<span class="tag" title="' + esc(tip) + '">' + esc(p.projectName || p.projectId || "未知") + '</span>';
  }).join("") + '</div>';
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
      if(rt.reqsLoaded && s === sel) fillBranchReqOptions(s, cur);
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
  fillBranchReqOptions($("brReq"), b ? (b.reqId || "") : (fromTask ? taskProjectId : ""));

  /* 负责人：沿用任务抽屉的口径（成员列表 + 账号绑定）。
     从任务里就地新建时默认跟任务负责人走，避免把分支指派给「当前操作人」；
     任务没有负责人时再回落到当前用户。 */
  var sel = $("brOwner");
  if(sel){
    var ownerOpts = ownerOptions();
    var taskOwner = fromTask ? taskOwnerSelection() : null;
    var curName = b ? (b.owner || "")
      : (taskOwner ? taskOwner.name : (rt.currentUser ? (rt.currentUser.displayName || "") : ""));
    var curId = b ? (b.ownerUserId || "")
      : (taskOwner ? (taskOwner.userId || "") : (rt.currentUser ? rt.currentUser.id : ""));
    var html = "", matched = false;
    ownerOpts.forEach(function(o){
      var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
      if(on) matched = true;
      html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (on ? " selected" : "") + '>' +
        esc(o.name) + '</option>';
    });
    if(curName && !matched){
      html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
    }
    sel.innerHTML = html;
  }

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
  var sel = $("brOwner");
  var picked = sel && sel.options[sel.selectedIndex];
  var payload = {
    name: name,
    targetBranch: ($("brTarget").value || "").trim() || null,
    /* 空串 = 明确改成空间级公共分支；null 会被后端当成「不改」 */
    reqId: ($("brReq") || {}).value || "",
    note: ($("brNote").value || "").trim() || null,
    owner: picked ? (picked.dataset.name || picked.textContent || null) : null,
    ownerUserId: picked && picked.value !== "__text__" ? picked.value : null
  };
  if(!brEditingId) payload.status = ($("brStatus") || {}).value || "dev";

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
    $("branchDrawer").classList.add("on");
    loadBranchLogs(b.id);
    loadBranchTasks(b.id);
  }).catch(function(ex){ toast(ex.message || "分支加载失败", "bad"); });
}
function closeBranchDrawer(){
  var d = $("branchDrawer");
  if(d) d.classList.remove("on");
  brDrawerId = null;
  brDrawerData = null;
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
      html += '<option value="' + esc(b.id) + '">' + esc(b.name) +
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
  var cur = sel.value;
  var opts = (rt.reqList || []).map(function(r){ return { id: r.id, name: (r.name || r.id) + (r.archivedAt ? "（已归档）" : "") }; });
  opts.sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "zh-CN"); });
  var html = '<option value="">全部项目</option>';
  opts.forEach(function(o){
    html += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
  });
  sel.innerHTML = html;
  var hasCur = opts.some(function(o){ return o.id === cur; });
  sel.value = hasCur ? cur : "";
}
/* 负责人筛选下拉：与分支新建/编辑同一份花名册口径（ownerOptions 传空串取空间级成员）。
   成员已移出等失效值回落到「全部负责人」，避免下拉与结果对不上。 */
function populateOwnerFilter(){
  var sel = $("branchOwnerFilter");
  if(!sel) return;
  var opts = ownerOptions("").slice().sort(function(a, b){ return String(a.name).localeCompare(String(b.name), "zh-CN"); });
  var cur = branchOwnerFilter;
  var html = '<option value="">全部负责人</option>';
  opts.forEach(function(o){
    html += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
  });
  sel.innerHTML = html;
  var hasCur = opts.some(function(o){ return o.id === cur; });
  sel.value = hasCur ? cur : "";
  if(!hasCur && cur) branchOwnerFilter = "";
}
function branchOwnerFilterName(){
  if(!branchOwnerFilter) return "";
  var sel = $("branchOwnerFilter");
  if(sel && sel.value === branchOwnerFilter && sel.selectedIndex >= 0){
    return sel.options[sel.selectedIndex].textContent || branchOwnerFilter;
  }
  return branchOwnerFilter;
}
/* 筛选下拉与内部状态同源：深链 / 汇总点选改了 branchFilter 后，下拉值与生效态跟着走 */
function syncBranchFilterControls(){
  var stSel = $("branchStatusFilter");
  if(stSel) stSel.value = branchStatusMeta(branchFilter).hint ? branchFilter : "";
  var owSel = $("branchOwnerFilter");
  if(owSel) owSel.value = branchOwnerFilter || "";
  var prSel = $("branchProjectFilter");
  if(prSel) prSel.value = branchProjectFilter || "";
  UI.markFiltered(stSel, !branchFilter);
  UI.markFiltered(owSel, !branchOwnerFilter);
  UI.markFiltered(prSel, !branchProjectFilter);
}
function updateBranchGroupToggle(){
  var btn = $("branchGroupToggle");
  if(!btn) return;
  var isProject = branchGroupMode === "project";
  btn.textContent = isProject ? "按状态分组" : "按项目分组";
  btn.classList.toggle("primary", !isProject);
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

function clearGroupOver(){
  var box = $("branchGroups");
  if(box) box.querySelectorAll(".br-group").forEach(function(g){ g.classList.remove("br-group-over"); });
}
(function wireBranchView(){
  var box = $("branchGroups");
  if(box){
    box.addEventListener("click", function(e){
      var more = e.target.closest("[data-br-more]");
      if(more){ loadMoreBranches(more.dataset.brMore); return; }
      var menu = e.target.closest("[data-br-status-menu]");
      if(menu){ e.stopPropagation(); openBranchStatusMenu(menu, menu.dataset.brStatusMenu); return; }
      var card = e.target.closest("[data-branch]");
      if(card) openBranchDrawer(card.dataset.branch);
    });
    box.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
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
      var pg = e.target.closest("[data-project]");
      if(pg){
        if(pg.dataset.project && pg.dataset.project !== "__none__") branchProjectFilter = pg.dataset.project;
        if($("branchProjectFilter")) $("branchProjectFilter").value = branchProjectFilter;
        branchGroupMode = "status";
        updateBranchGroupToggle();
        loadBranches(true);
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
    if(branchViewMode === "list"){ renderBranches(); return; }  /* 列表数据已全量在手，本地过滤即可 */
    clearTimeout(branchSearchTimer);
    branchSearchTimer = setTimeout(function(){ loadBranches(true); }, 300);
  });
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
  if($("branchListGroup")){
    $("branchListGroup").addEventListener("change", function(e){
      branchListGroup = e.target.value;
      renderBranches();
    });
  }
  if($("branchGroupToggle")){
    $("branchGroupToggle").addEventListener("click", function(){
      branchGroupMode = branchGroupMode === "status" ? "project" : "status";
      updateBranchGroupToggle();
      renderBranches();
    });
  }
  updateBranchGroupToggle();
  if($("dlgBranchCancel")) $("dlgBranchCancel").addEventListener("click", closeBranchDialog);
  if($("dlgBranchOk")) $("dlgBranchOk").addEventListener("click", submitBranchDialog);
  if($("brName")){
    $("brName").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitBranchDialog(); }
    });
  }

  if($("branchDrawer")){
    /* 抽屉内动态内容的统一委托：只处理工作项跳转，状态改走状态区按钮 */
    $("branchDrawer").addEventListener("click", function(e){
      var task = e.target.closest("[data-br-task]");
      if(task){
        /* 任务抽屉是另一层浮层，先收起分支抽屉再打开，避免两层遮罩叠在一起 */
        var tid = task.dataset.brTask;
        closeBranchDrawer();
        openTaskById(tid);
      }
    });
    $("branchScrim").addEventListener("click", closeBranchDrawer);
  }
  if($("brDrawerClose")) $("brDrawerClose").addEventListener("click", closeBranchDrawer);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgBranch") && $("dlgBranch").classList.contains("open")){ closeBranchDialog(); return; }
    if($("branchDrawer") && $("branchDrawer").classList.contains("on")){ closeBranchDrawer(); }
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
