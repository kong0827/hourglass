/* views/phase · 版本：按阶段（首版/迭代）与按版本（三态版本卡）双口径 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocRead } from "../core/task-drawer.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { canEditReq, projectOptionsHTML, projectRefsEnriched, reqNameById, rt, state, taskCacheExtra } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { assocLinkHTML, normalizedIds, taskVersionIds, taskVersionsText, sameIds, taskPublicationHTML, fmtReleaseTime, localDatetime, releaseEnvironmentName, releaseOperationName, releasePlanTime, releaseSnapshotHTML, itemNoText, releaseNoText, releasePlanNoText, COLUMNS, colName, dayKey, dayDiff, parseDate, fmtMinute, fmtMinutesShort, versionPhaseInfoHTML, addDays, iso, VERSION_STATUS_META, PLAN_STATUS_META, versionStatusTagHTML, planStatusTagHTML, planStatusName } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { branchMetaById, branchNameById, loadBranches, openBranchById, requestBranchStatus } from "./branches.js";
import { openDemandDetailById, openDemandVersionBackfill } from "./demands.js";
import { openMilestoneDetail } from "../lib/milestone-ui.js";
import { openPeoplePicker, peopleFieldHTML, memberToOption } from "../lib/people-picker.js";

/* datetime-local 按分钟记录：秒级差异既不可读，也会让未改动的计划被误判为有草稿 */
function localMinute(s){ var text = localDatetime(s); return text ? text.slice(0, 16) : text; }

/* 有发布事实即算已发布：正式记录的当前生效/部分/回滚/覆盖未知，或人工补录 */
function taskIsPublished(t){
  return !!(t.publishedAt || t.everPublished === true || t.manualPublished === true
    || (t.publicationState && t.publicationState !== "unpublished")
    || (Array.isArray(t.publicationTargets) && t.publicationTargets.length));
}

var phaseReq = $("phaseReq"), phaseMeta = $("phaseMeta"), phaseBody = $("phaseBody"),
    vName = $("vName"), vStart = $("vStart"), vTarget = $("vTarget"), vDesc = $("vDesc"),
    fVerName = $("fVerName"), btnSaveVer = $("btnSaveVer"), verFormTitle = $("verFormTitle");

var editingVerId = null;
/* 打开编辑时的版本令牌：保存时不能从缓存重读（缓存可能已被迟到的列表响应换掉，静默覆盖并发修改） */
var editingVerRevision = null, editingVerStatus = null;
var viewMode = "phase";            /* phase | version | allversions | schedule | overview */
/* 版本列表：筛选 / 排序 / 行内编辑互不干扰；编辑草稿只存在内存，失焦不自动提交 */
var verListUi = { sort:"smart", q:"", riskOnly:false };
/* 队列按状态分组：进行中 / 计划中默认展开，已发布与已关闭默认只露 3 行 */
var verGroupUi = { open:{ released:false, closed:false, canceled:false } };
var verInline = null;              /* { id, field:"name"|"dates", busy } */
var cache = null;                  /* { phase, vstats, versions, tasks } */
var overviewCache = null;
var allVersionsCache = null, allVersionsSeq = 0, allVersionsSel = [];
var allVersionsFilters = { project:"", status:"", q:"" };
var scheduleCache = null;          /* { rows }：跨项目发布计划 */
var scheduleSeq = 0;
var cacheReqId = null;             /* cache 对应的项目，日程跳转后避免串项目 */
var scheduleFilters = { project:"", env:"", status:"open", range:"90" };
var loadSeq = 0;
/* 任务抽屉的「计划版本」选项缓存：按项目缓存，写版本后失效 */
var versionOptionsCache = {};
var taskOptionsCache = {};

function isOwner(){ return !!(rt.currentWs && rt.currentWs.myRole === "owner"); }
/* 版本页顶部的 ?：解释版本与首版/迭代的区分口径，与工作项抽屉共用同一份说明 */
var phaseHelp = $("phaseHelp"), phaseHelpPop = null;
if(phaseHelp){
  phaseHelp.innerHTML = icon("helpCircle", 13);
  phaseHelp.addEventListener("click", function(){
    if(UI.popOpen(phaseHelpPop)){ UI.closeAllPops(); return; }
    var el = document.createElement("div");
    el.className = "menu popover type-help-pop";
    el.innerHTML = versionPhaseInfoHTML();
    phaseHelpPop = el;
    UI.openPop(el, phaseHelp, { align:"left", width:Math.max(280, Math.min(380, window.innerWidth - 16)), onClose:function(){ el.remove(); phaseHelpPop = null; } });
  });
}
/* 版本写入口跟随所选项目的可写性（成员在只读项目下不应看到发布/编辑/管理任务） */
function canWritePhase(){ return !!rt.phaseReqId && canEditReq(rt.phaseReqId); }
function denyPhaseReadOnly(){ toast("你对该项目只有查看权限", "warn"); }
function fmtPct(v){ return (v === null || v === undefined) ? "—" : ((v > 0 ? "+" : "") + v + "%"); }
function devCls(v){
  if(v === null || v === undefined) return "mute";
  var a = Math.abs(v);
  return a <= 15 ? "ok" : (a <= 30 ? "warn" : "over");
}
function devText(v){
  if(v === null || v === undefined) return "—";
  var a = Math.abs(v);
  return (v > 0 ? "+" : "") + v + "% · " + (a <= 15 ? "准确" : (a <= 30 ? "偏高" : "严重偏差"));
}
/* devCls 的 ok/warn/over 只是语义档位，进指标格要换算成色板 token */
function devColor(v){
  var c = devCls(v);
  return { ok:"success", warn:"warning", over:"danger" }[c] || "";
}
function typeName(itemType){
  return { story:"用户故事", task:"任务", bug:"缺陷", epic:"史诗" }[itemType || "task"] || "任务";
}
/* 分支模块四状态（与 branches.js 的 BRANCH_STATUS 同源）：版本卡分支进度行用 */
var BRANCH_ST = {
  dev:      { name:"开发中", cls:"br-st-dev" },
  testing:  { name:"待测试", cls:"br-st-testing" },
  merging:  { name:"待合并", cls:"br-st-merging" },
  released: { name:"已发布", cls:"br-st-released" }
};
function branchChipsHTML(brs){
  if(!brs || !brs.length) return "";
  return '<div class="ver-branches">' + brs.map(function(b){
    var st = BRANCH_ST[b.status] || { name: b.status || "未知", cls: "" };
    var meta = branchMetaById(b.branchId);
    var owner = meta && meta.owner ? meta.owner : "";
    var tip = "打开分支详情 · " + st.name + (owner ? " · " + owner : "") + " · 该版本 " + (b.taskCount || 0) + " 个工作项挂在此分支";
    return '<button type="button" class="ver-br" data-ver-branch="' + esc(b.branchId) + '" title="' + esc(tip) + '">' +
      '<i class="br-dot ' + st.cls + '"></i>' + esc(b.name) +
      ((b.taskCount || 0) > 1 ? '<span class="ver-br-n">×' + b.taskCount + '</span>' : '') +
      '<span class="ver-br-go" aria-hidden="true">›</span>' +
    '</button>';
  }).join("") + '</div>';
}
function dateShort(s){
  if(!s) return "—";
  var m = String(s).substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (Number(m[2]) + "-" + m[3]) : String(s).substring(0, 10);
}
function phaseOf(t, firstRel){
  if(!firstRel) return "mvp";
  var d = t.completedAt || t.startDate || t.dueDate || "";
  /* 与后端 VersionPhaseService 同口径：上线当日归首版；无日期任务也归首版 */
  return (d && dayKey(d) > dayKey(firstRel)) ? "post" : "mvp";
}

/* ---------- 数据加载 ---------- */

function syncReqSel(){
  if(!phaseReq) return;
  /* 归档项目默认不出现在切换器里，但当前正在看的那一个保留，避免视图突然跳走 */
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === rt.phaseReqId; });
  phaseReq.innerHTML = projectOptionsHTML(list, rt.phaseReqId);
  if(!rt.phaseReqId && list.length) rt.phaseReqId = list[0].id;
  if(rt.phaseReqId) phaseReq.value = rt.phaseReqId;
}
/* 启动时的项目请求可能被更晚的刷新覆盖，本视图自己的 then 会拿到空列表；
   以最终落地的项目列表补一次同步，避免刷新后误判「还没有项目」 */
window.addEventListener("ds:reqs-loaded", function(){
  if(document.body.dataset.view !== "phase" || !rt.reqsLoaded) return;
  if(viewMode === "allversions"){ loadAllVersions(); return; }
  if(!rt.reqList.length || (phaseReq && phaseReq.options.length)) return;
  syncReqSel();
  if(viewMode === "overview") loadOverview();
  else if(viewMode === "schedule") loadSchedule();
  else loadPhaseData();
});
/* 里程碑在项目驾驶舱里改过：版本卡上的达成/证据要跟着刷新 */
window.addEventListener("ds:milestones-changed", function(e){
  if(document.body.dataset.view !== "phase") return;
  var reqId = e && e.detail && e.detail.reqId;
  if(reqId && reqId !== rt.phaseReqId) return;
  if(viewMode === "phase" || viewMode === "version") reloadView();
});
function invalidateVersionCache(reqId){
  delete versionOptionsCache[reqId];
  delete taskOptionsCache[reqId];
}
/* 版本 / 发布记录变化后通知项目驾驶舱等缓存方失效，避免「新建了版本但项目里还是旧数量」 */
function notifyDeliveryChanged(reqId){
  try{ window.dispatchEvent(new CustomEvent("ds:delivery-changed", { detail:{ reqId: reqId || rt.phaseReqId } })); }catch(e){ /* noop */ }
}
function loadPhaseData(){
  if(!rt.phaseReqId || !rt.reqList.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目并归入工作项，这里就能按阶段、按版本看投入与偏差。"
    });
    if(phaseMeta) phaseMeta.textContent = "";
    return;
  }
  if(phaseMeta) phaseMeta.textContent = reqNameById(rt.phaseReqId);
  phaseBody.innerHTML = UI.skeletonRows(4);
  var reqId = rt.phaseReqId;
  verInline = null;
  if(rollupUi.reqId !== reqId){
    rollupUi.reqId = reqId;
    rollupUi.verId = "__all";
    rollupUi.more = false;
    rollupUi.demands = null;
    rollupUi.demandsReqId = "";
  }
  var current = ++loadSeq;
  return Promise.all([
    API.get("/api/phase/stats", { reqId: reqId }),
    API.get("/api/versions/stats", { reqId: reqId }),
    API.get("/api/versions", { reqId: reqId }),
    API.get("/api/versions/task-options", { reqId: reqId }),
    /* 里程碑只读展示：失败不影响版本页主体 */
    API.get("/api/milestones", { reqId: reqId }).catch(function(){ return []; }),
    /* 版本工时汇总的分类维度：分类名与颜色，失败只影响分类分组标题 */
    API.get("/api/categories", { project: reqId }).catch(function(){ return []; })
  ]).then(function(rs){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "overview" || viewMode === "schedule" || viewMode === "allversions") return;
    cache = { phase: rs[0], vstats: rs[1], versions: rs[2], tasks: rs[3], milestones: rs[4] || [] };
    rollupUi.cats = rs[5] || [];
    cacheReqId = reqId;
    versionOptionsCache[reqId] = rs[2];
    taskOptionsCache[reqId] = rs[3];
    renderPhaseView();
  }).catch(function(ex){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "overview" || viewMode === "allversions") return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    bindRetry(phaseBody, loadPhaseData);
  });
}
function enterPhaseView(){
  syncModeSeg();
  /* 全局「新建」菜单跨视图创建：#/phase?new=1 进入即开新建版本弹窗（参数消费一次即清） */
  var wantNew = /[?&]new=1(&|$)/.test(String(window.location.hash || ""));
  if(wantNew){
    try{ window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/phase"); }catch(e){ /* noop */ }
  }
  var afterReqs = function(){
    syncReqSel();
    if(wantNew){
      if(viewMode === "overview" || viewMode === "schedule" || viewMode === "allversions") toast("请先切换到具体项目，再新建版本", "warn");
      else if(!rt.phaseReqId) toast("先选择项目，再新建版本", "warn");
      else openVersionDialog(null);
    }
    if(viewMode === "overview") loadOverview();
    else if(viewMode === "schedule") loadSchedule();
    else if(viewMode === "allversions") loadAllVersions();
    else loadPhaseData();
  };
  if(rt.reqsLoaded){
    afterReqs();
  }else{
    phaseBody.innerHTML = UI.skeletonRows(4);
    loadReqs().then(afterReqs).catch(function(ex){
      phaseBody.innerHTML = UI.emptyState({
        icon:"alert", title:"项目列表加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
      });
      bindRetry(phaseBody, enterPhaseView);
    });
  }
}
function reloadView(){
  if(viewMode === "overview"){ loadOverview(); return; }
  if(viewMode === "schedule"){ loadSchedule(); return; }
  if(viewMode === "allversions"){ loadAllVersions(); return; }
  invalidateVersionCache(rt.phaseReqId);
  loadPhaseData();
}

/* ---------- 全部项目总览（管理端） ---------- */

function loadOverview(){
  var current = ++loadSeq;
  if(phaseMeta) phaseMeta.textContent = "全部项目";
  phaseBody.innerHTML = UI.skeletonRows(5);
  API.get("/api/versions/overview").then(function(ov){
    if(current !== loadSeq || viewMode !== "overview") return;
    overviewCache = ov;
    renderOverviewMode();
  }).catch(function(ex){
    if(current !== loadSeq || viewMode !== "overview") return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"总览加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
function pctPlain(v){
  return (v === null || v === undefined) ? "—" : (v + "%");
}
function versionStatusName(st){
  /* 收敛到 lib/format 的 VERSION_STATUS_META（P2-11）：名称与色调全站单一来源 */
  return (VERSION_STATUS_META[st] || {}).name || st || "—";
}
function versionStatusTag(st){
  return versionStatusTagHTML(st);
}
function renderOverviewMode(){
  var ov = overviewCache;
  if(!ov) return;
  var list = ov.projects || [];
  var t = ov.totals || {};
  if(!list.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目并归入工作项，这里就能横向对比各项目的首版与迭代投入。"
    });
    return;
  }
  var total = t.totalWorkMinutes || 0;
  var mvpShare = total ? Math.round((t.mvpWorkMinutes || 0) * 100 / total) : 0;
  var kpis = [
    [fmtMinutesShort(t.totalWorkMinutes), "总计投入工时", ""],
    [fmtMinutesShort(t.mvpWorkMinutes) + "（" + mvpShare + "%）", "首版工时", ""],
    [fmtMinutesShort(t.iterationWorkMinutes), "迭代工时", ""],
    [(t.projectCount || 0) + " / " + (t.versionCount || 0), "项目 / 版本", ""],
    [pctPlain(t.mvpOnTimePct), "首版准时率（项目均值）", ""],
    [pctPlain(t.iterationOnTimePct), "迭代准时率（项目均值）", ""]
  ];
  var rows = list.map(function(p){
    var versions = (p.releasedCount || 0) + " / " + (p.activeCount || 0) + " / " + (p.plannedCount || 0);
    var latest = p.latestVersionName
      ? (esc(p.latestVersionName) + ' <span class="mute">' + (p.latestVersionTarget ? dateShort(p.latestVersionTarget) : "未定日期") + '</span> ' + versionStatusTag(p.latestVersionStatus))
      : "—";
    var released = p.firstReleasedAt ? dateShort(p.firstReleasedAt) : '<span class="mute">未标记</span>';
    return '<tr data-ov-project="' + esc(p.reqId) + '" title="打开该项目的阶段明细">'
      + '<td><span class="link-cell">' + esc(p.reqName) + '</span></td>'
      + '<td>' + released + '</td>'
      + '<td class="num" title="已发布 / 进行中 / 计划中">' + versions + '</td>'
      + '<td class="num">' + fmtMinutesShort(p.mvpWorkMinutes) + '</td>'
      + '<td class="num">' + fmtMinutesShort(p.iterationWorkMinutes) + '</td>'
      + '<td class="num"><b>' + fmtMinutesShort(p.totalWorkMinutes) + '</b></td>'
      + '<td class="num">' + pctPlain(p.mvpOnTimePct) + '</td>'
      + '<td class="num">' + pctPlain(p.iterationOnTimePct) + '</td>'
      + '<td>' + latest + '</td>'
      + '</tr>';
  }).join("");
  phaseBody.innerHTML = '<div class="panel"><div class="panel-head"><h3>跨项目投入对比</h3>'
    + '<span class="meta-right">点击行打开项目阶段明细</span></div>'
    + '<div style="padding:12px 0 4px">' + metricCells(kpis, null) + '</div></div>'
    + '<div class="panel" style="margin-top:12px"><div class="panel-head"><h3>项目明细</h3>'
    + '<span class="meta-right">工时口径：首版/迭代按完成工作项的自然日归组</span></div>'
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>项目</th><th>首版上线</th><th class="num">版本（已发/进行/计划）</th>'
    + '<th class="num">首版工时</th><th class="num">迭代工时</th><th class="num">合计工时</th>'
    + '<th class="num">首版准时率</th><th class="num">迭代准时率</th><th>最近版本</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

/* ---------- 全部版本（跨项目勾选 → 现有发布计划） ---------- */

function allVersionRowMap(){
  var map = {};
  (allVersionsCache || []).forEach(function(r){ map[r.versionId] = r; });
  return map;
}
function loadAllVersions(){
  var current = ++allVersionsSeq;
  if(phaseMeta) phaseMeta.textContent = "全部版本";
  phaseBody.innerHTML = UI.skeletonRows(4);
  return API.get("/api/versions/cross-project").then(function(rows){
    if(current !== allVersionsSeq || viewMode !== "allversions") return;
    allVersionsCache = rows || [];
    var alive = {};
    allVersionsCache.forEach(function(r){ alive[r.versionId] = versionEnded({ status: r.versionStatus }) ? null : true; });
    allVersionsSel = allVersionsSel.filter(function(id){ return alive[id]; });
    renderAllVersions();
  }).catch(function(ex){
    if(current !== allVersionsSeq || viewMode !== "allversions") return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"全部版本加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    bindRetry(phaseBody, loadAllVersions);
  });
}
function allVersionsFiltered(){
  var f = allVersionsFilters, q = String(f.q || "").trim().toLowerCase();
  return (allVersionsCache || []).filter(function(r){
    if(f.project && r.reqId !== f.project) return false;
    if(f.status && r.versionStatus !== f.status) return false;
    if(q && String(r.versionName || "").toLowerCase().indexOf(q) === -1
      && String(r.projectName || "").toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}
function allVersionsSelect(name, pairs, chosen, label){
  return '<select class="mini-select" data-allv-filter="' + name + '" aria-label="' + esc(label) + '">'
    + pairs.map(function(p){ return '<option value="' + esc(p[0]) + '"' + (p[0] === chosen ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join("")
    + '</select>';
}
function renderAllVersions(){
  var rows = allVersionsCache || [];
  if(!rows.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本", text:"先在项目中新建版本，这里会汇总全部可见项目的版本。"
    });
    return;
  }
  var map = allVersionRowMap();
  var selected = allVersionsSel.map(function(id){ return map[id]; }).filter(Boolean);
  var selectedProjects = {};
  selected.forEach(function(r){ selectedProjects[r.reqId] = true; });
  var projectIds = [], projectNames = {}, manageable = {};
  rows.forEach(function(r){
    if(projectIds.indexOf(r.reqId) === -1){ projectIds.push(r.reqId); projectNames[r.reqId] = r.projectName; }
    if(r.canManage) manageable[r.reqId] = true;
  });
  var filtered = allVersionsFiltered();
  var manageCount = projectIds.filter(function(id){ return manageable[id]; }).length;
  var selbar = "";
  if(selected.length){
    selbar = '<div class="allv-selbar"><div class="allv-selinfo"><b>已选 ' + selected.length + ' 个版本 · 跨 ' + Object.keys(selectedProjects).length + ' 个项目</b>'
      + '<div class="release-chips">' + selected.map(function(r){ return '<span class="release-chip" title="' + esc(r.projectName) + '">' + esc(r.versionName) + '</span>'; }).join("") + '</div></div>'
      + '<button class="btn sm" type="button" data-allv-clear>清空</button>'
      + '<button class="btn sm primary" type="button" data-allv-plan>新建发布计划</button></div>';
  }else{
    selbar = '<p class="allv-hint">' + (manageCount
      ? "勾选可管理的版本后，可跨项目新建一个发布计划；只读项目不可勾选。"
      : "当前项目均无发布计划权限，仅可查看版本；需要创建计划请联系空间主、管理员或项目负责人。") + '</p>';
  }
  var body = "";
  if(!filtered.length){
    body = '<tr><td colspan="7"><div class="allv-empty">没有匹配的版本，试试清空筛选。</div></td></tr>';
  }else{
    var lastReq = null;
    filtered.forEach(function(r){
      if(r.reqId !== lastReq){
        lastReq = r.reqId;
        var count = filtered.filter(function(x){ return x.reqId === r.reqId; }).length;
        body += '<tr class="allv-group"><td colspan="7"><span class="allv-gname">' + esc(r.projectName) + '</span>'
          + '<span class="allv-gmeta">' + count + ' 个版本 · ' + (r.canManage ? '可创建计划' : '只读 · 无发布权限') + '</span></td></tr>';
      }
      var on = allVersionsSel.indexOf(r.versionId) !== -1;
      var ended = versionEnded({ status: r.versionStatus });
      body += '<tr' + (on ? ' class="is-selected"' : '') + '>'
        + '<td class="allv-checkcol"><label class="allv-pick"><input type="checkbox" data-allv-pick="' + esc(r.versionId) + '"'
          + (on ? ' checked' : '') + (r.canManage && !ended ? '' : ' disabled') + ' aria-label="选择 ' + esc(r.versionName) + '"></label></td>'
        + '<td><button class="allv-vname link-cell" type="button" data-ver-open="' + esc(r.versionId) + '" data-ver-req="' + esc(r.reqId) + '" title="打开「' + esc(r.versionName) + '」的版本详情页">'
          + '<span>' + esc(r.versionName) + '</span>' + icon("chevronRight", 12) + '</button><div class="allv-vsub">'
          + (ended ? esc(versionStatusName(r.versionStatus)) + ' · 历史保留，不参与发布计划'
            : (r.versionStatus === "released" ? '已发布 · 内容只读' : '工作项 ' + (r.taskCount == null ? "—" : r.taskCount) + ' 项')) + '</div></td>'
        + '<td>' + versionStatusTag(r.versionStatus) + '</td>'
        + '<td>' + (r.targetDate ? esc(String(r.targetDate).substring(0, 10)) : '<span class="mute">未设置</span>') + '</td>'
        + '<td class="num">' + (r.taskCount == null ? "—" : r.taskCount) + '</td>'
        + '<td>' + (r.latestReleaseDate ? esc(String(r.latestReleaseDate).substring(0, 10)) : "—") + '</td>'
        + '<td><span class="allv-perm' + (r.canManage ? '' : ' is-off') + '">' + (r.canManage ? '可创建计划' : '无发布权限') + '</span></td>'
        + '</tr>';
    });
  }
  phaseBody.innerHTML = '<div class="panel allv-panel">'
    + '<div class="phase-tbl-tools allv-tools">'
    + '<label class="phase-filter">项目<select class="mini-select" data-allv-filter="project" aria-label="按项目筛选">'
    + '<option value="">全部项目</option>'
    + projectOptionsHTML(projectRefsEnriched(projectIds.map(function(id){ return { id:id, name:projectNames[id] }; })), allVersionsFilters.project)
    + '</select></label>'
    + '<label class="phase-filter">状态' + allVersionsSelect("status", [["", "全部状态"], ["active", "进行中"], ["planned", "计划中"], ["released", "已发布"], ["closed", "已关闭"], ["canceled", "已取消"]], allVersionsFilters.status, "按状态筛选") + '</label>'
    + '<input class="phase-filter-input" type="search" data-allv-kw value="' + esc(allVersionsFilters.q) + '" placeholder="搜索版本或项目" aria-label="搜索版本或项目">'
    + '<span class="phase-tbl-count">' + filtered.length + ' 个版本 · ' + manageCount + ' 个可管理项目</span>'
    + '</div>'
    + selbar
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl allv-tbl"><thead><tr>'
    + '<th class="allv-checkcol"><span class="sr-only">选择</span></th><th>版本</th><th>状态</th><th>目标就绪日</th><th class="num">工作项</th><th>最近发布</th><th>可管理</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div>'
    + '<p class="allv-foot">发布计划可跨项目、跨版本；主版本取第一个勾选版本。已发布版本的内容只读，但仍可用于汇总计划。列表按项目分组、版本倒序。</p>'
    + '</div>';
}
function createPlanFromAllVersions(){
  var map = allVersionRowMap();
  var picked = allVersionsSel.map(function(id){ return map[id]; })
    .filter(function(r){ return r && r.canManage && !versionEnded({ status: r.versionStatus }); });
  if(!picked.length){ toast("先勾选至少一个可管理且未关闭/取消的版本", "warn"); return; }
  var anchor = picked[0];
  var known = { id: anchor.versionId, reqId: anchor.reqId, name: anchor.versionName, status: anchor.versionStatus,
    targetDate: anchor.targetDate, canManageReleasePlan: true, canPublish: false };
  openReleaseDetail(anchor.versionId, "plan", null, known, picked.map(function(r){ return r.versionId; }), true);
}

/* ---------- 发布日程（跨项目只读汇总） ---------- */

function planStatusTag(st){
  /* 收敛到 PLAN_STATUS_META（P2-11）：draft/canceled 原用未定义的 tag-neutral，现统一为 ghost */
  return planStatusTagHTML(st);
}
function coverageName(c){ return { full:"全量", partial:"部分", unknown:"覆盖未知" }[c] || c || "—"; }
/* 日程里的项目/版本是 GROUP_CONCAT 的「 / 」串：最多展示两枚标签，其余收进 +N，完整列表放 title */
function nameChips(text, max, unit){
  var list = String(text || "").split(" / ").map(function(s){ return s.trim(); }).filter(Boolean);
  if(!list.length) return '<span class="release-chip is-empty">—</span>';
  var shown = list.slice(0, max), rest = list.length - shown.length;
  return '<span class="release-chips">'
    + shown.map(function(n){ return '<span class="release-chip" title="' + esc(n) + '">' + esc(n) + '</span>'; }).join("")
    + (rest > 0 ? '<span class="release-chip is-more" title="' + esc(list.slice(shown.length).join("、")) + '" aria-label="还有 ' + rest + ' 个' + (unit || "") + '">+' + rest + '</span>'
      + '<span class="sr-only">共 ' + list.length + ' 个' + (unit || "") + '：' + esc(list.join("、")) + '</span>' : "")
    + '</span>';
}
/* 日程版本列：名称串与后端同序的 ids/reqIds 串逐枚对齐后才接成跳转入口；
   旧后端不返回 ids（或长度不齐）时回落纯文本 pill，不渲染死链。+N 是聚合计数，保持纯文本。 */
function versionChips(r, max){
  var names = String(r.versionNames || r.versionName || "").split(" / ").map(function(s){ return s.trim(); }).filter(Boolean);
  if(!names.length) return '<span class="release-chip is-empty">—</span>';
  var ids = String(r.versionIds || "").split(",").map(function(s){ return s.trim(); });
  var reqs = String(r.versionReqIds || "").split(",").map(function(s){ return s.trim(); });
  var aligned = ids.length === names.length && reqs.length === names.length
    && ids.every(function(id, i){ return !!id && !!reqs[i]; });
  if(!aligned) return nameChips(names.join(" / "), max, "版本");
  var shown = names.slice(0, max), rest = names.length - shown.length;
  return '<span class="release-chips">'
    + shown.map(function(n, i){ return assocLinkHTML("version", ids[i], n, { req:reqs[i], cls:"release-chip tag" }); }).join("")
    + (rest > 0 ? '<span class="release-chip is-more" title="' + esc(names.slice(shown.length).join("、")) + '" aria-label="还有 ' + rest + ' 个版本">+' + rest + '</span>'
      + '<span class="sr-only">共 ' + names.length + ' 个版本：' + esc(names.join("、")) + '</span>' : "")
    + '</span>';
}
function scheduleRange(){
  if(scheduleFilters.range === "all") return { from:"", to:"" };
  if(scheduleFilters.range === "around") return { from:iso(addDays(new Date(), -90)), to:iso(addDays(new Date(), 90)) };
  return { from:iso(new Date()), to:iso(addDays(new Date(), scheduleFilters.range === "30" ? 30 : 90)) };
}
function loadSchedule(){
  var seq = ++scheduleSeq;
  if(phaseMeta) phaseMeta.textContent = "全部项目";
  phaseBody.innerHTML = UI.skeletonRows(4);
  var range = scheduleRange(), f = scheduleFilters;
  return API.get("/api/release-plans", { from:range.from, to:range.to, project:f.project, env:f.env, status:f.status }).then(function(rows){
    if(seq !== scheduleSeq || viewMode !== "schedule") return;
    scheduleCache = { rows: rows || [] };
    renderSchedule();
  }).catch(function(ex){
    if(seq !== scheduleSeq || viewMode !== "schedule") return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"发布日程加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    bindRetry(phaseBody, loadSchedule);
  });
}
function renderSchedule(){
  if(!scheduleCache) return;
  var rows = scheduleCache.rows, f = scheduleFilters, now = Date.now();
  var projects = (rt.reqList || []).filter(function(r){ return !r.archivedAt; });
  var openCount = rows.filter(function(r){ return r.status === "draft" || r.status === "ready"; }).length;
  var overdueCount = rows.filter(function(r){
    return (r.status === "draft" || r.status === "ready") && r.plannedAt && new Date(r.plannedAt).getTime() < now;
  }).length;
  function select(name, pairs, chosen, label){
    return '<label class="phase-filter"><span>' + esc(label) + '</span>'
      + '<select class="mini-select" data-schedule-filter="' + name + '" aria-label="按' + esc(label) + '筛选">'
      + pairs.map(function(p){ return '<option value="' + esc(p[0]) + '"' + (p[0] === chosen ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join("")
      + '</select></label>';
  }
  var body = rows.map(function(r){
    var late = (r.status === "draft" || r.status === "ready") && r.plannedAt && new Date(r.plannedAt).getTime() < now;
    var planTime = r.plannedAt ? fmtReleaseTime(r.plannedAt).replace(/:00$/, "") : "未定时间";
    var projectText = r.projectNames || r.projectName || "—";
    return '<tr data-schedule-open="' + esc(r.id) + '" data-schedule-version="' + esc(r.versionId) + '" data-schedule-project="' + esc(r.reqId) + '" title="打开该计划（含全部版本）的发布计划与发布记录">'
      + '<td>' + esc(planTime) + (late ? ' <span class="tag tag-warning">已过期</span>' : '') + '</td>'
      + '<td>' + nameChips(projectText, 2, "项目") + '</td>'
      + '<td>' + versionChips(r, 2) + '</td>'
      + '<td>' + esc(releaseEnvironmentName(r.environment)) + ' · ' + esc(coverageName(r.coverage)) + '</td>'
      + '<td>' + planStatusTag(r.status) + '</td>'
      + '<td>' + esc(r.ownerName || "未指定") + '</td>'
      + '<td class="num">' + (r.plannedTaskCount || 0) + '</td>'
      + '</tr>';
  }).join("");
  var empty = '<tr><td colspan="7"><p class="hint">当前筛选下没有发布计划；可放宽时间范围或状态，或到「按版本」新建独立计划。</p></td></tr>';
  phaseBody.innerHTML = '<div class="panel"><div class="panel-head"><h3>跨项目发布日程</h3>'
    + '<span class="meta-right">' + rows.length + ' 份计划 · 未完成 ' + openCount + ' · 已过期 ' + overdueCount + '</span></div>'
    + '<div class="row row-gap schedule-filters">'
    + '<label class="phase-filter"><span>项目</span>'
    + '<select class="mini-select" data-schedule-filter="project" aria-label="按项目筛选">'
    + '<option value="">全部项目</option>' + projectOptionsHTML(projects, f.project) + '</select></label>'
    + select("env", [["", "全部环境"], ["production", "生产"], ["staging", "预发布"], ["test", "测试"]], f.env, "环境")
    + select("status", [["open", "未完成"], ["all", "全部状态"], ["ready", "仅就绪"], ["draft", "仅草稿"], ["completed", "已完成"], ["canceled", "已取消"]], f.status, "状态")
    + select("range", [["30", "未来 30 天"], ["90", "未来 90 天"], ["around", "前后 3 个月"], ["all", "全部时间"]], f.range, "时间范围")
    + '<button class="btn sm" type="button" data-schedule-refresh>刷新</button>'
    + '</div>'
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>计划时间</th><th>项目</th><th>版本</th><th>环境 · 覆盖</th><th>状态</th><th>负责人</th><th class="num">范围项数</th>'
    + '</tr></thead><tbody>' + (body || empty) + '</tbody></table></div>'
    + '<p class="hint" style="padding-top:10px">日程只汇总计划，不代表实际发布；点击任意一行打开该版本的完整计划、预览与历史。</p></div>';
}
function openSchedulePlan(reqId, versionId){
  if(!reqId || !versionId) return;
  rt.phaseReqId = reqId;
  if(phaseReq) phaseReq.value = reqId;
  if(cacheReqId !== reqId){ cache = null; cacheReqId = null; }
  function onClose(){ if(viewMode === "schedule") loadSchedule(); }
  var known = findVersion(versionId);
  if(known){ openReleaseDetail(versionId, "plan", onClose, known); return; }
  API.get("/api/versions", { reqId:reqId }).then(function(vs){
    if(viewMode !== "schedule") return;
    var v = (vs || []).filter(function(item){ return item.id === versionId; })[0];
    if(!v){ toast("版本已变化或不可见", "warn"); return; }
    openReleaseDetail(versionId, "plan", onClose, v);
  }).catch(function(ex){ toast(ex.message || "版本加载失败", "warn"); });
}

/* ---------- 渲染 ---------- */

function syncModeSeg(){
  var seg = $("phaseModeSeg");
  if(seg) seg.querySelectorAll("[data-pmode]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.pmode === viewMode);
  });
  /* 总览、发布日程与全部版本都是跨项目口径：隐藏单项目选择、新建版本与单项目发布入口 */
  var allProjects = viewMode === "overview" || viewMode === "schedule" || viewMode === "allversions";
  if(phaseReq) phaseReq.style.display = allProjects ? "none" : "";
  /* 版本页的主按钮是焦点卡的「排入工作项」，头部新建版本降为描边，避免两个实心按钮打架 */
  if($("btnVerNew")){
    $("btnVerNew").style.display = (allProjects || !canWritePhase()) ? "none" : "";
    $("btnVerNew").classList.toggle("primary", viewMode !== "version");
  }
  if($("btnReleasePlan")) $("btnReleasePlan").style.display = (viewMode === "schedule" || viewMode === "allversions") ? "none" : "";
}
function metricCells(cells, drill){
  return '<div class="pgrid">' + cells.map(function(c){
    var color = c[2] ? ' style="color:var(--' + c[2] + ');"' : '';
    /* drill：{scope:"version"|"phase", val} —— 指标格点击下钻任务明细；c[3]===false 的格不参与（如计划发布日期）；
       c[4]="demands" 表示该格下钻需求明细而非工作项（已排需求/已排期需求） */
    if(drill && c[3] !== false){
      var kind = c[4] ? ' data-drill-kind="' + esc(c[4]) + '"' : '';
      return '<button type="button" class="pcell drillable" data-drill-scope="' + esc(drill.scope)
        + '" data-drill-val="' + esc(drill.val) + '" data-drill-metric="' + esc(c[1]) + '"' + kind
        + ' title="查看该口径的明细"><b' + color + '>' + c[0] + '</b><span>' + esc(c[1]) + '</span></button>';
    }
    return '<div class="pcell"><b' + color + '>' + c[0] + '</b><span>' + esc(c[1]) + '</span></div>';
  }).join("") + '</div>';
}

/* 指标格下钻：先按版本/阶段圈定任务，再按指标语义收敛（完成/进行中/偏差等） */
function preLaunchVersionId(){
  if(!cache || !cache.phase || !cache.phase.firstReleasedAt) return null;
  var id = null;
  (cache.vstats.versions || []).forEach(function(v){ if(v.preLaunchCount > 0) id = v.id; });
  return id;
}
function drillRows(scope, val, metric){
  var firstRel = cache.phase ? cache.phase.firstReleasedAt : null;
  var preId = preLaunchVersionId();
  var rows = cache.tasks.filter(function(t){
    if(scope === "phase") return phaseOf(t, firstRel) === val;
    var tv = taskVersionIds(t);
    if(tv.length) return tv.indexOf(val) !== -1;
    if(val === ""){
      if(!preId) return true;
      var d0 = t.completedAt || t.startDate || t.dueDate || "";
      return !(d0 && dayKey(d0) <= dayKey(firstRel));
    }
    /* 上线前未绑版本任务自动归入首版版本：下钻口径与版本卡一致 */
    if(val === preId){
      var d = t.completedAt || t.startDate || t.dueDate || "";
      return !!(d && dayKey(d) <= dayKey(firstRel));
    }
    return false;
  });
  var isDone = function(t){ return t.boardColumn === "done"; };
  /* 下钻口径与指标卡一致：卡片只统计已完成工作项（fillPhase 先跳过未完成） */
  if(metric === "完成工作项" || metric === "当前完成工作项" || metric === "已完成" || metric === "工作项均耗时") rows = rows.filter(isDone);
  else if(metric === "进行中" || metric === "剩余预估") rows = rows.filter(function(t){ return !isDone(t); });
  else if(metric.indexOf("偏差") >= 0) rows = rows.filter(function(t){ return isDone(t) && t.estimateMinutes; });
  else if(metric === "准时完成率") rows = rows.filter(function(t){ return isDone(t) && t.dueDate; });
  else if(metric === "新增需求 / 缺陷维护") rows = rows.filter(function(t){ return isDone(t) && (t.itemType === "story" || t.itemType === "bug"); });
  return rows;
}
function openDrillModal(scope, val, metric){
  var rows = drillRows(scope, val, metric);
  var scopeName;
  if(scope === "phase"){
    scopeName = val === "mvp" ? "首版开发" : "迭代维护";
  }else{
    var v = val === "" ? null : findVersion(val);
    scopeName = val === "" ? "待规划" : (v ? v.name : "版本");
  }
  var body = rows.map(function(t){
    var est = t.estimateMinutes || 0, act = t.totalMinutes || 0;
    return '<tr data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
      + '<td class="phase-task-cell"><span class="tbl-task"><span class="tbl-task-t" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' + taskPublicationHTML(t) + '</span></td>'
      + '<td>' + esc(typeName(t.itemType)) + '</td>'
      + '<td>' + esc(t.owner || "—") + '</td>'
      + '<td class="num">' + dateShort(t.startDate) + '</td>'
      + '<td class="num">' + dateShort(t.dueDate) + '</td>'
      + '<td class="num">' + (est ? fmtMinutesShort(est) : "—") + '</td>'
      + '<td class="num">' + (act ? fmtMinutesShort(act) : "—") + '</td>'
      + '<td>' + (t.boardColumn === "done"
        ? '<span class="tag tag-success">已完成</span>'
        : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td></tr>';
  }).join("") || '<tr><td colspan="8" class="foot-note tbl-empty">该口径下暂无工作项</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  var boardBtn = (scope === "version" && val)
    ? '<button class="btn sm" type="button" data-drill-board title="在看板中按此版本筛选">在看板中查看</button>'
    : '';
  layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(reqNameById(rt.phaseReqId)) + ' · ' + esc(scopeName) + ' · ' + esc(metric) + '</h2>'
    + '<div class="desc">共 ' + rows.length + ' 项 · 点击工作项行打开详情</div></div>'
    + boardBtn
    + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>工作项</th><th>类型</th><th>负责人</th><th class="num">计划开始</th><th class="num">计划结束</th><th class="num">预估</th><th class="num">实际</th><th>状态</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
    var bb = e.target.closest("[data-drill-board]");
    if(bb){
      UI.closeModal(layer);
      /* 复用项目页「在看板中查看」的跳转口径：清掉旧筛选，按当前项目 + 该版本过滤。
         下钻弹窗列的是版本全部工作项（含任意时间完成的），doneScope 一并切到 all，避免跳过去只剩空列。 */
      state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = []; state.versions = [val]; state.columns = []; state.completion = ""; state.due = null; state.focus = false; state.blocked = false;
      state.doneScope = "all";
      if(searchInput) searchInput.value = "";
      if(searchWrap) searchWrap.classList.remove("has");
      state.reqs = [rt.phaseReqId];
      showView("board");
      reloadFilteredViews();
      toast("已按版本筛选看板：" + scopeName + "，已完成列仅预览最近完成项");
      return;
    }
    var t = e.target.closest("[data-open-task]");
    if(t){ openTaskById(t.dataset.openTask); }
  });
  UI.openModal(layer);
}

/* 版本需求下钻：已排需求/已排期需求格点击，列出排到该版本的需求（与后端 demandCount 同口径：不含已关闭），行点击开需求详情 */
function demandStatusLabel(st){
  return st === "plan" ? "已排期" : st === "done" ? "已完成" : st === "pass" ? "已通过" : st === "closed" ? "已关闭" : st === "rej" ? "已拒绝" : (st === "canceled" || st === "cancelled") ? "已取消" : "待评审";
}
function openVersionDemandsModal(versionId){
  var v = findVersion(versionId);
  var name = v ? v.name : "版本";
  var canBackfill = canWritePhase() && !versionReadOnly(v);
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(reqNameById(rt.phaseReqId)) + ' · ' + esc(name) + ' · 已排需求</h2>'
    + '<div class="desc">加载中…</div></div>'
    + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"></div></div></div>';
  document.body.appendChild(layer);
  function loadRows(){
    API.getAllPages("/api/demands", { reqId: rt.phaseReqId }).then(function(demands){
      if(!document.body.contains(layer)) return;
      var rows = (demands || []).filter(function(d){
        return d.versionId === versionId && d.status !== "closed" && d.status !== "rej"
          && d.status !== "canceled" && d.status !== "cancelled";
      });
      var body = rows.map(function(d){
        var canFill = canBackfill && d.status === "plan" && d.canSchedule === true;
        return '<tr data-open-demand="' + esc(d.id) + '" title="查看需求详情">'
          + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(d.title) + '</td>'
          + '<td>' + esc(d.itemKind || "其他") + '</td>'
          + '<td><span class="tag ghost">' + esc(demandStatusLabel(d.status)) + '</span></td>'
          + '<td>' + esc(d.priority || "—") + '</td>'
          + '<td>' + (canFill
            ? '<button class="btn sm" type="button" title="把该需求名下未加入本版本的工作项补录进来" data-backfill-demand="' + esc(d.id) + '">补录工作项</button>'
            : '<span class="t-sub">—</span>') + '</td></tr>';
      }).join("") || '<tr><td colspan="5" class="foot-note tbl-empty">该版本没有已排需求</td></tr>';
      layer.querySelector(".desc").textContent = "共 " + rows.length + " 项 · 点击需求行打开详情"
        + (canBackfill ? "；已排期需求可把名下未加入本版本的工作项补录进来" : "");
      layer.querySelector(".tbl-wrap").innerHTML = '<table class="phase-tbl"><thead><tr>'
        + '<th>需求</th><th>类型</th><th>状态</th><th>优先级</th><th>操作</th>'
        + '</tr></thead><tbody>' + body + '</tbody></table>';
    }).catch(function(ex){
      if(!document.body.contains(layer)) return;
      layer.querySelector(".tbl-wrap").innerHTML = UI.errorState(ex.message || "已排需求加载失败");
    });
  }
  loadRows();
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
    var fill = e.target.closest("[data-backfill-demand]");
    if(fill){
      if(!canWritePhase()){ denyPhaseReadOnly(); return; }
      if(versionReadOnly(v)){ toast("该版本内容只读，不能补录工作项", "warn"); return; }
      openDemandVersionBackfill(fill.dataset.backfillDemand, versionId, name, {
        emptyText: "没有可带入的工作项（可能已全部在版本中）",
        onDone: function(){ loadRows(); reloadView(); }
      });
      return;
    }
    var d = e.target.closest("[data-open-demand]");
    if(d){ openDemandDetailById(d.dataset.openDemand); }
  });
  UI.openModal(layer);
}

/* 成员阶段工时下钻：按该成员自己的计时记录列出「任务 × 阶段」，合计与阶段卡一致 */
var memberDrillSeq = 0;
function memberDrillRowHTML(r){
  var est = r.estimateMinutes || 0, act = r.minutes || 0;
  return '<tr data-open-task="' + esc(r.taskId) + '" title="打开工作项详情">'
    + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(r.title) + taskPublicationHTML(r) + '</td>'
    + '<td>' + (r.phase === "mvp" ? '<span class="tag tag-primary">首版</span>' : '<span class="tag tag-info">迭代</span>') + '</td>'
    + '<td>' + esc(typeName(r.itemType)) + '</td>'
    + '<td class="num">' + dateShort(r.startDate) + '</td>'
    + '<td class="num">' + dateShort(r.dueDate) + '</td>'
    + '<td class="num">' + (est ? fmtMinutesShort(est) : "—") + '</td>'
    + '<td class="num">' + (act ? fmtMinutesShort(act) : "—") + '</td>'
    + '<td>' + (r.boardColumn === "done"
      ? '<span class="tag tag-success">已完成</span>'
      : '<span class="tag tag-info">' + esc(colName(r.boardColumn)) + '</span>') + '</td></tr>';
}
function openMemberDrill(userId, name){
  if(!cache || !cache.phase || !rt.phaseReqId) return;
  var reqId = rt.phaseReqId;
  var seq = ++memberDrillSeq;
  API.get("/api/phase/member-tasks", { reqId: reqId, userId: userId || "", offset: 0, limit: 100 }).then(function(page){
    if(seq !== memberDrillSeq) return;
    if(rt.phaseReqId !== reqId) return;
    page = page || {};
    var st = {
      items: page.items || [],
      total: Number(page.total) || 0,
      hasMore: !!page.hasMore,
      loading: false,
      mvpMinutes: Number(page.mvpMinutes) || 0,
      postMinutes: Number(page.postMinutes) || 0
    };
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
      + '<h2>' + esc(name) + ' · 阶段工时明细</h2>'
      + '<div class="desc"></div></div>'
      + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
      + '<th>工作项</th><th>阶段</th><th>类型</th><th class="num">计划开始</th><th class="num">计划结束</th><th class="num">预估</th><th class="num">实际</th><th>状态</th>'
      + '</tr></thead><tbody></tbody></table></div></div></div>';
    document.body.appendChild(layer);

    var tbody = layer.querySelector("tbody");
    var desc = layer.querySelector(".desc");
    function syncBody(){
      var body = st.items.map(memberDrillRowHTML).join("");
      if(!st.items.length){
        body = '<tr><td colspan="8" class="foot-note tbl-empty">该成员在此项目暂无计时记录</td></tr>';
      } else if(st.hasMore){
        body += '<tr><td colspan="8" class="foot-note" style="padding:10px;text-align:center">'
          + '<button class="btn sm block" type="button" data-member-more' + (st.loading ? " disabled" : "") + '>'
          + (st.loading ? "加载中…" : "加载更多（已加载 " + st.items.length + " / 共 " + st.total + " 行）")
          + '</button></td></tr>';
      }
      tbody.innerHTML = body;
      desc.textContent = "共 " + st.total + " 行"
        + (st.items.length < st.total ? "（已加载 " + st.items.length + "）" : "")
        + " · 首版 " + fmtMinutesShort(st.mvpMinutes) + " · 迭代 " + fmtMinutesShort(st.postMinutes)
        + " · 按计时自然日归组，点击工作项行打开详情";
    }
    function loadMore(){
      if(st.loading || !st.hasMore) return;
      st.loading = true;
      syncBody();
      API.get("/api/phase/member-tasks", { reqId: reqId, userId: userId || "", offset: st.items.length, limit: 100 }).then(function(next){
        if(!document.body.contains(layer)) return;
        if(rt.phaseReqId !== reqId) return;
        st.loading = false;
        next = next || {};
        var known = {};
        st.items.forEach(function(r){ known[r.taskId + "|" + r.phase] = 1; });
        var fresh = [];
        (next.items || []).forEach(function(r){
          var k = r.taskId + "|" + r.phase;
          if(known[k]) return;
          known[k] = 1;
          fresh.push(r);
        });
        st.items = st.items.concat(fresh);
        if(typeof next.total === "number") st.total = next.total;
        if(typeof next.mvpMinutes === "number") st.mvpMinutes = next.mvpMinutes;
        if(typeof next.postMinutes === "number") st.postMinutes = next.postMinutes;
        /* 整页都是已加载行时停止翻页，避免死循环 */
        st.hasMore = !!next.hasMore && fresh.length > 0;
        syncBody();
      }).catch(function(ex){
        if(!document.body.contains(layer)) return;
        st.loading = false;
        toast("成员阶段工时加载失败：" + (ex && ex.message ? ex.message : "网络异常"), "bad");
        syncBody();
      });
    }
    syncBody();

    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
      if(e.target.closest("[data-member-more]")){ loadMore(); return; }
      var t = e.target.closest("[data-open-task]");
      if(t){ openTaskById(t.dataset.openTask); }
    });
    UI.openModal(layer);
  }).catch(function(ex){ toast("加载成员工时失败：" + (ex.message || "网络异常"), "bad"); });
}

function renderPhaseView(){
  syncModeSeg();
  if(viewMode === "overview"){ renderOverviewMode(); return; }
  if(viewMode === "schedule"){ if(scheduleCache) renderSchedule(); return; }
  if(!cache) return;
  if(viewMode === "version") renderVersionMode();
  else renderPhaseMode();
}

/* ===== 按阶段 ===== */

function phaseTimeline(firstRel){
  var tasks = cache.tasks;
  var min = null, max = null;
  tasks.forEach(function(t){
    [t.startDate, t.dueDate, t.completedAt].forEach(function(raw){
      var d = dayKey(raw);
      if(!d) return;
      if(!min || d < min) min = d;
      if(!max || d > max) max = d;
    });
  });
  var today = new Date().toISOString().substring(0, 10);
  var end = (max && max > today) ? max : today;
  var mvp = cache.phase.mvp, post = cache.phase.post;
  var mvpLabel = "<b>" + fmtMinutesShort(mvp.workMinutes) + "</b>首版开发 · 完成 " + mvp.doneTasks + " 工作项";
  var inner;
  if(firstRel && min){
    var total = Math.max(1, (new Date(end) - new Date(min)) / 86400000);
    var mvpW = Math.max(8, Math.min(85, Math.round(((new Date(firstRel) - new Date(min)) / 86400000) / total * 100)));
    var postLabel = post ? ("<b>" + fmtMinutesShort(post.workMinutes) + "</b>迭代维护 · 完成 " + post.doneTasks + " 工作项") : "";
    var postSeg = postLabel
      ? '<button type="button" class="pseg post" style="flex:1" data-drill-scope="phase" data-drill-val="post" data-drill-metric="完成工作项" title="查看迭代维护阶段的工作项明细">' + postLabel + '</button>'
      : '<span class="pseg post" style="flex:1">' + postLabel + '</span>';
    inner = '<button type="button" class="pseg mvp" style="width:' + mvpW + '%" data-drill-scope="phase" data-drill-val="mvp" data-drill-metric="完成工作项" title="查看首版开发阶段的工作项明细">' + mvpLabel + '</button>'
      + '<span class="plaunch" data-label="' + dateShort(firstRel) + ' 首版上线"></span>'
      + postSeg;
  }else{
    inner = '<button type="button" class="pseg mvp" style="width:100%" data-drill-scope="phase" data-drill-val="mvp" data-drill-metric="完成工作项" title="查看首版开发阶段的工作项明细">' + mvpLabel + '</button>';
  }
  return '<div class="panel"><div class="panel-head phase-tl-head"><h3>阶段时间轴与投入</h3>'
    + '<span class="meta-right">' + (min ? (dateShort(min) + " ~ " + dateShort(end)) : "暂无工作项日期") + ' · 点击色块查看工作项</span></div>'
    + '<div class="phase-tl"><span class="tl-node">' + (min ? dateShort(min) : "—") + '<br>首版启动</span>'
    + '<div class="phase-bar">' + inner + '</div>'
    + '<span class="tl-node">' + dateShort(today) + '<br>今日</span></div></div>';
}
function phaseCardHTML(tagCls, tag, sub, cells, drill){
  return '<div class="phase-card"><div class="phase-card-head">'
    + '<span class="tag ' + tagCls + '">' + tag + '</span>'
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
    + metricCells(cells, drill) + '</div>';
}
function phaseCells(p, withSplit){
  var cells = [
    [fmtMinutesShort(p.workMinutes), "投入工时", ""],
    [p.doneTasks, "完成工作项", ""],
    [p.memberCount ? (fmtMinutesShort(p.avgMemberMinutes) + "（" + p.memberCount + " 人）") : "—", "人均", ""],
    [devText(p.deviationPct), "整体偏差", devColor(p.deviationPct)],
    [withSplit ? ((p.storyCount || 0) + " / " + (p.bugCount || 0)) : fmtPct(p.onTimePct),
      withSplit ? "新增需求 / 缺陷维护" : "准时完成率", ""],
    [p.avgTaskMinutes === null || p.avgTaskMinutes === undefined ? "—" : fmtMinutesShort(p.avgTaskMinutes), "工作项均耗时", ""]
  ];
  return cells;
}
function memberTable(){
  var p = cache.phase;
  /* memberHours 只有 minutes，按阶段分别归位再合并成行 */
  var rows = {};
  (p.mvp.memberHours || []).forEach(function(m){
    var r = rows[m.userId];
    if(!r) r = rows[m.userId] = { name: m.name || m.userId, mvp: 0, post: 0 };
    r.mvp = m.minutes || 0;
  });
  (p.post && p.post.memberHours || []).forEach(function(m){
    var r = rows[m.userId];
    if(!r) r = rows[m.userId] = { name: m.name || m.userId, mvp: 0, post: 0 };
    r.post = m.minutes || 0;
  });
  var list = Object.keys(rows).map(function(k){ rows[k].userId = k; return rows[k]; });
  list.sort(function(a, b){ return (b.mvp + b.post) - (a.mvp + a.post); });
  if(!list.length) return "";
  var body = list.map(function(r){
    var total = r.mvp + r.post;
    return '<tr data-member-drill="' + esc(r.userId || "") + '" data-member-name="' + esc(r.name) + '" title="查看该成员的工作项明细"><td>' + esc(r.name) + '</td>'
      + '<td class="num">' + fmtMinutesShort(r.mvp) + '</td>'
      + '<td class="num">' + fmtMinutesShort(r.post) + '</td>'
      + '<td class="num" style="font-weight:600">' + fmtMinutesShort(total) + '</td>'
      + '<td>' + (r.post > r.mvp ? '<span class="tag tag-info">迭代为主</span>' : '<span class="tag tag-primary">首版为主</span>') + '</td></tr>';
  }).join("");
  return '<div class="panel"><div class="panel-head"><h3>按成员的阶段工时</h3>'
    + '<span class="meta-right">自动计时按工作项完成日归入阶段 · 点击成员行查看明细</span></div>'
    + '<div class="tbl-wrap"><table class="phase-tbl member-tbl"><thead><tr><th>成员</th><th class="num">首版开发</th>'
    + '<th class="num">迭代维护</th><th class="num">合计</th><th>阶段重心</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}
function taskTable(mode){
  var firstRel = cache.phase ? cache.phase.firstReleasedAt : null;
  var verName = {};
  cache.versions.forEach(function(v){ verName[v.id] = v.name; });
  var isDone = function(t){ return t.boardColumn === "done"; };
  var rows = cache.tasks.map(function(t){
    var est = t.estimateMinutes || 0, act = t.totalMinutes || 0;
    var dev = est > 0 ? Math.round((act - est) / est * 100) : null;
    var group, groupCell;
    if(mode === "phase"){
      var ph = phaseOf(t, firstRel);
      group = ph;
      groupCell = ph === "mvp" ? '<span class="tag tag-primary">首版</span>' : '<span class="tag tag-info">迭代</span>';
    }else{
      group = "";
      var vids = taskVersionIds(t), vnames = Array.isArray(t.versionNames) ? t.versionNames : [];
      groupCell = vids.length
        ? vids.map(function(id, i){ return assocLinkHTML("version", id, vnames[i] || id, {req:t.reqId || rt.phaseReqId, cls:"tag ghost"}); }).join(" ")
        : '<span class="tag ghost">待规划</span>';
    }
    return '<tr data-groups="' + esc(JSON.stringify(mode === "phase" ? [group] : (taskVersionIds(t).length ? taskVersionIds(t) : [""]))) + '" data-group="' + esc(group) + '" data-open-task="' + esc(t.id) + '"'
      + ' data-status="' + esc(t.boardColumn || "") + '"'
      + ' data-owner="' + esc(t.owner || "") + '"'
      + ' data-type="' + esc(t.itemType || "task") + '"'
      + ' data-published="' + (taskIsPublished(t) ? "1" : "0") + '"'
      + ' data-search="' + esc(String(t.title || "").toLowerCase()) + '"'
      + ' title="打开工作项详情">'
      + '<td class="phase-task-cell"><span class="tbl-task"><span class="tbl-task-t" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' + taskPublicationHTML(t) + '</span></td>'
      + '<td>' + groupCell + '</td>'
      + '<td>' + esc(typeName(t.itemType)) + '</td>'
      + '<td class="phase-owner">' + (t.owner ? esc(t.owner) : '<span class="muted">未指派</span>') + '</td>'
      + '<td class="num">' + dateShort(t.startDate) + '</td>'
      + '<td class="num">' + dateShort(t.dueDate) + '</td>'
      + '<td class="num">' + (est ? fmtMinutesShort(est) : "—") + '</td>'
      + '<td class="num">' + (act ? fmtMinutesShort(act) : "—") + '</td>'
      + '<td><span class="mini-tag ' + devCls(dev) + '">' + (dev === null ? "—" : ((dev > 0 ? "+" : "") + dev + "%")) + '</span></td>'
      + '<td>' + (isDone(t) ? '<span class="tag tag-success">已完成</span>' : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
      + '</tr>';
  }).join("") || '<tr><td colspan="10" class="foot-note tbl-empty">该项目还没有工作项</td></tr>';
  var seg = "";
  if(mode === "phase"){
    seg = '<div class="seg mini">' + [["all", "全部"], ["mvp", "首版开发"], ["post", "迭代维护"]].map(function(o, i){
      return '<button type="button" data-filter="' + esc(o[0]) + '"' + (i === 0 ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(o[1]) + '</button>';
    }).join("") + '</div>';
  }
  var head = mode === "phase" ? "工作项明细 · 按阶段" : "工作项明细 · 按计划版本";
  /* 版本改用下拉：选项带上状态 / 目标日期 / 工作项数，十几个版本不再把表头顶成两行 */
  var verSel = "";
  if(mode === "version"){
    var verOpts = cache.versions.map(function(v){
      var meta = [versionStatusName(v.status)];
      if(v.status === "released" && v.releasedAt) meta.push("上线 " + dateShort(v.releasedAt));
      else if(v.targetDate) meta.push("目标 " + dateShort(v.targetDate));
      if(v.taskCount != null) meta.push(v.taskCount + " 项");
      return [v.id, v.name + "（" + meta.join(" · ") + "）"];
    });
    if(cache.tasks.some(function(t){ return !taskVersionIds(t).length; })) verOpts.push(["", "待规划"]);
    verSel = '<label class="phase-filter"><span>版本</span>'
      + '<select class="mini-select ver-select" data-tbl-version aria-label="按版本筛选">'
      + '<option value="all">全部版本</option>'
      + verOpts.map(function(o){ return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join("")
      + '</select></label>';
  }

  /* 维度筛选：状态 / 负责人 / 类型 / 标题关键字，与版本下拉（或阶段分段）叠加生效 */
  var statusSet = {}, ownerSet = {}, typeSet = {};
  cache.tasks.forEach(function(t){
    if(t.boardColumn) statusSet[t.boardColumn] = 1;
    if(t.owner) ownerSet[t.owner] = 1;
    typeSet[t.itemType || "task"] = 1;
  });
  var statusIds = [];
  COLUMNS.forEach(function(c){ if(statusSet[c.id]) statusIds.push(c.id); });
  Object.keys(statusSet).forEach(function(id){ if(statusIds.indexOf(id) < 0) statusIds.push(id); });
  var statusOpts = statusIds.map(function(id){ return [id, colName(id)]; });
  var ownerOpts = Object.keys(ownerSet)
    .sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); })
    .map(function(n){ return [n, n]; });
  var typeOrder = ["task", "bug", "story", "epic"];
  var typeOpts = typeOrder.filter(function(k){ return typeSet[k]; })
    .map(function(k){ return [k, typeName(k)]; });
  Object.keys(typeSet).forEach(function(k){
    if(typeOrder.indexOf(k) < 0) typeOpts.push([k, typeName(k)]);
  });
  function filterSelect(attr, label, opts, allLabel){
    return '<label class="phase-filter"><span>' + esc(label) + '</span>'
      + '<select class="mini-select" ' + attr + ' aria-label="按' + esc(label) + '筛选">'
      + '<option value="">' + esc(allLabel) + '</option>'
      + opts.map(function(o){ return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join("")
      + '</select></label>';
  }
  var tools = cache.tasks.length
    ? '<div class="phase-tbl-tools">'
      + verSel
      + filterSelect("data-tbl-status", "状态", statusOpts, "全部状态")
      + filterSelect("data-tbl-owner", "负责人", ownerOpts, "全部负责人")
      + filterSelect("data-tbl-type", "类型", typeOpts, "全部类型")
      + filterSelect("data-tbl-publish", "发布", [["published", "已发布"], ["unpublished", "未发布"]], "全部发布状态")
      + '<label class="phase-filter"><span>关键字</span><input type="search" class="phase-filter-input" data-tbl-kw placeholder="搜索工作项标题" aria-label="搜索工作项标题"></label>'
      + '<span class="phase-tbl-count" data-tbl-count></span>'
      + '<button class="btn sm" type="button" data-tbl-reset disabled>清空筛选</button>'
      + '</div>'
    : "";
  var emptyRow = cache.tasks.length
    ? '<tr data-tbl-empty hidden><td colspan="10" class="foot-note tbl-empty">没有符合筛选条件的工作项</td></tr>'
    : "";
  return '<div class="panel"><div class="panel-head phase-tbl-head"><h3>' + head + '</h3>'
    + '<span class="meta-right">计划起止 · 预估 / 实际 · 偏差 · 点击行打开工作项</span>' + seg + '</div>'
    + tools
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr><th>工作项</th>'
    + (mode === "phase" ? "<th>阶段</th>" : "<th>版本</th>")
    + '<th>类型</th><th>负责人</th><th class="num">计划开始</th><th class="num">计划结束</th><th class="num">预估</th><th class="num">实际</th><th>偏差</th><th>状态</th></tr></thead>'
    + '<tbody id="phaseTblBody">' + rows + emptyRow + '</tbody></table></div></div>';
}

/* 阶段/版本分段、状态、负责人、类型、发布、关键字任一变化都按交集重算可见行 */
function applyPhaseTblFilters(){
  var body = $("phaseTblBody");
  if(!body) return;
  var panel = body.closest(".panel");
  if(!panel) return;
  var verEl = panel.querySelector("[data-tbl-version]");
  var statusEl = panel.querySelector("[data-tbl-status]");
  var ownerEl = panel.querySelector("[data-tbl-owner]");
  var typeEl = panel.querySelector("[data-tbl-type]");
  var publishEl = panel.querySelector("[data-tbl-publish]");
  var kwEl = panel.querySelector("[data-tbl-kw]");
  var status = statusEl ? statusEl.value : "";
  var owner = ownerEl ? ownerEl.value : "";
  var type = typeEl ? typeEl.value : "";
  var publish = publishEl ? publishEl.value : "";
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : "";
  var segBtn = panel.querySelector(".seg.mini button[aria-pressed='true']");
  var group = verEl ? verEl.value : (segBtn ? segBtn.dataset.filter : "all");
  var shown = 0, total = 0;
  body.querySelectorAll("tr[data-open-task]").forEach(function(tr){
    total++;
    var ok = (group === "all" || JSON.parse(tr.dataset.groups || '[]').indexOf(group) !== -1)
      && (!status || tr.dataset.status === status)
      && (!owner || tr.dataset.owner === owner)
      && (!type || tr.dataset.type === type)
      && (!publish || (publish === "published" ? tr.dataset.published === "1" : tr.dataset.published !== "1"))
      && (!kw || (tr.dataset.search || "").indexOf(kw) >= 0);
    tr.style.display = ok ? "" : "none";
    if(ok) shown++;
  });
  var empty = panel.querySelector("[data-tbl-empty]");
  if(empty) empty.hidden = !(total > 0 && shown === 0);
  var count = panel.querySelector("[data-tbl-count]");
  if(count) count.textContent = "显示 " + shown + " / " + total;
  var reset = panel.querySelector("[data-tbl-reset]");
  if(reset) reset.disabled = !(status || owner || type || publish || kw || group !== "all");
}
function renderPhaseMode(){
  var p = cache.phase;
  var firstRel = p.firstReleasedAt;
  if(phaseMeta){
    phaseMeta.textContent = reqNameById(rt.phaseReqId)
      + (firstRel ? (" · 首版上线 " + firstRel + " · 双阶段统计") : " · 未标记上线，投入全部归入首版开发");
  }
  var mvpCard = phaseCardHTML("tag-primary", "首版开发",
    (firstRel ? (dateShort(firstRel) + " 之前 · 上线前全部投入") : "项目启动 ~ 上线 · 全部投入"),
    phaseCells(p.mvp, false), { scope: "phase", val: "mvp" });
  var postCard;
  /* post 由后端恒返回（零值对象），是否进入双阶段以 firstReleasedAt 为准 */
  if(firstRel){
    postCard = phaseCardHTML("tag-info", "迭代维护",
      dateShort(firstRel) + " 之后 · 上线后新增需求与维护", phaseCells(p.post, true), { scope: "phase", val: "post" });
  }else{
    postCard = '<div class="phase-card pend"><div class="phase-card-head"><span class="tag ghost">迭代维护 · 未开启</span></div>'
      + '<div class="phase-pend-desc">该项目尚未标记首版上线。标记后，此前的投入归入<b>首版开发</b>，之后的投入归入<b>迭代维护</b>，历史工作项阶段不受影响。</div>'
      + (isOwner()
          ? '<button class="btn sm primary" type="button" data-launch="1">标记首版上线</button>'
          : '<p class="foot-note">标记首版上线需空间主操作</p>')
      + '</div>';
  }
  phaseBody.innerHTML = phaseTimeline(firstRel)
    + '<div class="phase-duo">' + mvpCard + postCard + '</div>'
    + recentPlansCardHTML()
    + memberTable()
    + taskTable("phase");
  applyPhaseTblFilters();
  loadRecentPlans(rt.phaseReqId);
}

/* ===== 按版本 ===== */

/* 版本周期窗口：开始 → 目标，如「11-10 → 11-24」；无开始只有目标时返回空（调用处另行展示目标日） */
function cycleWindow(v){
  if(!v || !v.startDate) return "";
  if(v.targetDate && v.targetDate !== v.startDate) return dateShort(v.startDate) + " → " + dateShort(v.targetDate);
  return dateShort(v.startDate) + " 起";
}

/* ---------- 版本列表（可筛选 / 可内联编辑 / 行级下钻） ---------- */

function verStatusTag(st){
  /* 收敛到 VERSION_STATUS_META（P2-11）：原 closed/canceled 用未定义的 tag-neutral（灰底），
     现统一为 ghost（描边），与 version.js 的安静终态观感一致 */
  return versionStatusTagHTML(st);
}
function statsVersionFor(id){
  var rows = (cache && cache.vstats && cache.vstats.versions) || [];
  for(var i = 0; i < rows.length; i++){ if(rows[i].id === id) return rows[i]; }
  return null;
}
/* 列表行同时要「持久化字段（revision / reqId / 权限）」与「聚合字段（进度 / 工时 / 发布次数）」：
   以完整版本为底，统计对象覆盖其上，避免两处口径漂移 */
function mergedVersionRow(s){
  var f = findVersion(s.id) || {};
  var out = {};
  Object.keys(f).forEach(function(k){ out[k] = f[k]; });
  Object.keys(s).forEach(function(k){ if(s[k] !== undefined) out[k] = s[k]; });
  return out;
}
/* 列表风险口径（与原型一致）：有未完成的阻塞工作项，或未结束且目标日期已过。
   已发布版本不再因目标日期过期而算风险，只保留阻塞提示 */
function verRisk(v){
  var blocked = 0;
  ((cache && cache.tasks) || []).forEach(function(t){
    if(t.blocked && t.boardColumn !== "done" && taskVersionIds(t).indexOf(v.id) >= 0) blocked++;
  });
  var overdueDays = 0;
  if(v.status !== "released" && !versionEnded(v) && v.targetDate){
    var d = dayDiff(parseDate(v.targetDate), rt.TODAY);
    if(d !== null && d !== undefined && d < 0) overdueDays = -d;
  }
  return { blocked:blocked, overdueDays:overdueDays, atRisk:blocked > 0 || overdueDays > 0 };
}
function verRiskText(r){
  var parts = [];
  if(r.blocked > 0) parts.push(r.blocked + " 个阻塞");
  if(r.overdueDays > 0) parts.push("已逾期 " + r.overdueDays + " 天");
  return parts.join(" · ");
}
function versionListRows(){
  var q = (verListUi.q || "").trim().toLowerCase();
  var rows = ((cache && cache.vstats && cache.vstats.versions) || []).map(mergedVersionRow).filter(function(v){
    if(verListUi.riskOnly && !verRisk(v).atRisk) return false;
    if(!q) return true;
    return (v.name || "").toLowerCase().indexOf(q) !== -1
      || (v.description || "").toLowerCase().indexOf(q) !== -1;
  });
  function targetKey(v){ return v.targetDate || "9999-12-31"; }
  var ended = function(v){ return v.status === "released" || v.status === "closed" || v.status === "canceled"; };
  if(verListUi.sort === "name"){
    rows.sort(function(a, b){ return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"); });
  }else if(verListUi.sort === "target"){
    rows.sort(function(a, b){
      var x = targetKey(a), y = targetKey(b);
      return x === y ? String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN") : (x < y ? -1 : 1);
    });
  }else{
    /* 分组标题已承载状态，组内只按时序：未结束按最早到期在前，已结束按最近在前 */
    rows.sort(function(a, b){
      var x = targetKey(a), y = targetKey(b);
      if(x === y) return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
      return (x < y ? -1 : 1) * (ended(a) ? -1 : 1);
    });
  }
  return rows;
}
function versionListCounts(){
  var c = { all:0, planned:0, active:0, released:0, closed:0, canceled:0, risk:0 };
  ((cache && cache.vstats && cache.vstats.versions) || []).forEach(function(v){
    c.all++;
    if(c[v.status] !== undefined) c[v.status]++;
    if(verRisk(v).atRisk) c.risk++;
  });
  return c;
}
function verDueHint(v){
  if(!v.targetDate || v.status === "released" || versionEnded(v)) return "";
  var d = dayDiff(parseDate(v.targetDate), rt.TODAY);
  if(d === null || d === undefined) return "";
  if(d < 0) return '<small class="bad">逾期 ' + (-d) + ' 天</small>';
  if(d === 0) return '<small class="warn">今天到期</small>';
  if(d <= 7) return '<small class="warn">还剩 ' + d + ' 天</small>';
  return '<small>还剩 ' + d + ' 天</small>';
}
function verLatestReleaseText(v){
  if(v.status === "released") return v.releasedAt ? ("上线 " + dateShort(v.releasedAt)) : "已发布";
  if(v.contentLocked) return "内容已锁定";
  if((v.releaseEventCount || 0) > 0) return "已记录 " + v.releaseEventCount + " 次";
  return "—";
}
function verRowFlags(v){
  var perm = findVersion(v.id) || v;
  var locked = versionContentLocked(perm) || versionContentLocked(v);
  var done = versionEnded(perm) || versionEnded(v);
  return {
    locked:locked,
    ended:done,
    readOnly:locked || done,
    editable:!locked && !done && canWritePhase(),
    canPublish:perm.canPublish === true,
    canManagePlan:perm.canManageReleasePlan === true
  };
}
function inlineErrorHTML(){
  return '<span class="vl-edit-err" data-ver-inline-err hidden></span>';
}
function inlineNameEditor(v){
  return '<div class="vl-edit">'
    + '<div class="vl-edit-row"><input class="vl-input" type="text" maxlength="40" data-ver-inline-input="name" value="' + esc(v.name || "") + '" aria-label="版本名称" autocomplete="off">'
    + '<button class="btn sm primary" type="button" data-ver-inline-save>保存</button>'
    + '<button class="btn sm ghost" type="button" data-ver-inline-cancel>取消</button></div>'
    + inlineErrorHTML()
    + '</div>';
}
function inlineDateEditor(v){
  return '<div class="vl-edit vl-date-edit">'
    + '<label>开始<input class="vl-input" type="date" data-ver-inline-input="startDate" value="' + esc(v.startDate || "") + '" aria-label="计划开始日期"></label>'
    + '<label>目标<input class="vl-input" type="date" data-ver-inline-input="targetDate" value="' + esc(v.targetDate || "") + '" aria-label="目标发布日期"></label>'
    + '<span class="vl-edit-btns"><button class="btn sm primary" type="button" data-ver-inline-save>保存</button>'
    + '<button class="btn sm ghost" type="button" data-ver-inline-cancel>取消</button></span>'
    + inlineErrorHTML()
    + '</div>';
}
/* 焦点版本：优先当前进行中，其次最近要开始的计划版本，最后退回最近已发布 */
function verFocusVersion(){
  var rows = ((cache && cache.vstats && cache.vstats.versions) || []).map(mergedVersionRow);
  var active = rows.filter(function(v){ return v.status === "active"; })[0];
  if(active) return active;
  var planned = rows.filter(function(v){ return v.status === "planned"; }).sort(function(a, b){
    return String(a.targetDate || "9999-12-31").localeCompare(String(b.targetDate || "9999-12-31"));
  })[0];
  if(planned) return planned;
  var released = rows.filter(function(v){ return v.status === "released"; }).sort(function(a, b){
    return String(b.releasedAt || b.targetDate || "").localeCompare(String(a.releasedAt || a.targetDate || ""));
  })[0];
  return released || null;
}
function verFocusLabel(v){
  if(v.status === "active") return "当前版本";
  if(v.status === "planned") return "下一版";
  return "最近发布";
}
function verFocusPlanText(v){
  if(v.status === "released") return "上线 " + (v.releasedAt ? dateShort(v.releasedAt) : "已发布");
  if(!v.targetDate) return "发布计划：未安排";
  var d = dayDiff(parseDate(v.targetDate), rt.TODAY);
  if(d === null || d === undefined) return "发布计划：" + dateShort(v.targetDate);
  var tail = d < 0 ? "已逾期 " + (-d) + " 天" : (d === 0 ? "今天到期" : "还剩 " + d + " 天");
  return "发布计划：" + dateShort(v.targetDate) + " · " + tail;
}
function versionFocusHTML(){
  var v = verFocusVersion();
  if(!v) return "";
  var id = v.id, req = v.reqId || rt.phaseReqId;
  var flags = verRowFlags(v);
  var total = Number(v.taskCount) || 0, done = Number(v.doneCount) || 0;
  var demands = Number(v.demandCount) || 0;
  var risk = verRisk(v);
  /* 与列表行同口径：已完成 + 进行中（未完成且已有计时）+ 阻塞 */
  var doing = ((cache && cache.tasks) || []).filter(function(t){
    return taskVersionIds(t).indexOf(id) >= 0 && t.boardColumn !== "done" && !t.blocked && Number(t.totalMinutes) > 0;
  }).length;
  var pct = total ? Math.round(done * 100 / total) : 0;
  var doingPct = total ? Math.max(0, Math.min(100 - pct, Math.round(doing * 100 / total))) : 0;
  var blockedPct = total ? Math.max(0, Math.min(100 - pct - doingPct, Math.round(risk.blocked * 100 / total))) : 0;
  var dotCls = v.status === "active" ? "info" : (v.status === "released" ? "success" : "");
  var descBits = [cycleWindow(v) || "未设周期", total ? total + " 个工作项" : "还没有排入工作项"];
  if(demands) descBits.push(demands + " 个需求");
  if(flags.locked) descBits.push("内容已锁定");
  var acts;
  if(flags.editable){
    acts = '<button class="btn sm primary" type="button" data-ver-tasks="' + esc(id) + '">排入工作项</button>'
      + '<button class="btn sm" type="button" data-ver-edit="' + esc(id) + '">设置目标日期</button>';
  }else if(v.status === "released"){
    acts = '<button class="btn sm primary" type="button" data-ver-open-tab="scope" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '">查看工作项</button>'
      + '<button class="btn sm" type="button" data-ver-open-tab="releases" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '">发布记录</button>';
  }else{
    acts = '<button class="btn sm primary" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '">版本详情</button>';
  }
  return '<section class="ver-focus" aria-labelledby="verFocusTitle">'
    + '<div class="vf-top">'
      + '<span class="vf-eyebrow"><i class="vf-dot ' + dotCls + '"></i>' + esc(verFocusLabel(v)) + '</span>'
      + verStatusTag(v.status)
      + '<span class="vf-goal">' + esc(verFocusPlanText(v)) + '</span>'
    + '</div>'
    + '<div class="vf-body">'
      + '<div class="vf-left">'
        + '<h2 id="verFocusTitle">' + esc(v.name) + '</h2>'
        + '<p class="vf-desc">' + descBits.map(esc).join('<span class="vf-sep" aria-hidden="true"></span>')
          + (verRisk(v).atRisk ? '<span class="vl-risk-inline">' + esc(verRiskText(risk)) + '</span>' : '') + '</p>'
        + '<div class="vf-bar">'
          + '<span class="vl-bar" role="img" aria-label="进度 ' + pct + '%"><i class="done" style="width:' + pct + '%"></i>'
          + (doingPct ? '<i class="doing" style="width:' + doingPct + '%"></i>' : '')
          + (blockedPct ? '<i class="blocked" style="width:' + blockedPct + '%"></i>' : '') + '</span>'
          + '<b>' + pct + '%</b><small>' + (total ? done + ' / ' + total + ' 工作项' : '未规划') + '</small>'
        + '</div>'
      + '</div>'
      + '<div class="vf-kpis">'
        + '<div><b>' + demands + '</b><span>已排需求</span></div>'
        + '<div><b>' + total + '</b><span>工作项</span></div>'
        + '<div><b>' + (Number(v.estimateMinutes) ? fmtMinutesShort(v.estimateMinutes) : "—") + '</b><span>预估工时</span></div>'
      + '</div>'
      + '<div class="vf-acts">' + acts
        + '<button class="link" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '">版本详情 →</button>'
      + '</div>'
    + '</div>'
    + '</section>';
}
function versionRowHTML(v){
  var id = v.id, req = v.reqId || rt.phaseReqId;
  var flags = verRowFlags(v);
  var editingName = !!verInline && verInline.id === id && verInline.field === "name";
  var editingDates = !!verInline && verInline.id === id && verInline.field === "dates";
  var total = Number(v.taskCount) || 0, done = Number(v.doneCount) || 0;
  var demands = Number(v.demandCount) || 0;
  var risk = verRisk(v);
  var riskText = verRiskText(risk);
  /* stats 里的 doingCount 是「未完成」而非「进行中」：真正在做 = 未完成、已有计时且未被阻塞 */
  var doing = ((cache && cache.tasks) || []).filter(function(t){
    return taskVersionIds(t).indexOf(id) >= 0 && t.boardColumn !== "done" && !t.blocked && Number(t.totalMinutes) > 0;
  }).length;
  var pct = total ? Math.round(done * 100 / total) : 0;
  var doingPct = total ? Math.max(0, Math.min(100 - pct, Math.round(doing * 100 / total))) : 0;
  var blockedPct = total ? Math.max(0, Math.min(100 - pct - doingPct, Math.round(risk.blocked * 100 / total))) : 0;
  /* 状态由分组标题承载，行内只保留可下钻的范围链接与风险 / 锁定提示 */
  var sub = '<button type="button" class="vl-scope-link" data-ver-open-tab="scope" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="查看工作项">工作项 ' + total + '</button>'
    + '<span class="vl-sep" aria-hidden="true">·</span>'
    + '<button type="button" class="vl-scope-link" data-ver-open-tab="demands" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="查看排到该版本的需求">需求 ' + demands + '</button>';
  if((v.branches || []).length) sub += '<span class="vl-sep" aria-hidden="true">·</span><span>' + v.branches.length + ' 个分支</span>';
  if(riskText) sub += '<span class="vl-risk-inline">' + esc(riskText) + '</span>';
  if(flags.locked && v.status !== "released") sub += '<span class="vl-lock" title="已有成功的生产发布记录，版本内容只读">内容已锁定</span>';
  var nameCell = '<div class="vl-name">'
    + (editingName ? inlineNameEditor(v)
      : '<div class="vl-name-row"><button class="vl-name-link" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="打开「' + esc(v.name) + '」的版本详情页">' + esc(v.name) + '</button>'
        + '<span class="vl-chev" aria-hidden="true">' + icon("chevronRight", 12) + '</span>'
        + (flags.editable ? '<button class="vl-pencil" type="button" data-ver-inline="name" data-ver-id="' + esc(id) + '" title="直接编辑版本名称" aria-label="直接编辑版本名称">' + icon("edit", 12) + '</button>' : '')
        + '</div><div class="vl-sub"' + (v.description ? ' title="' + esc(v.description) + '"' : '') + '>' + sub + '</div>')
    + '</div>';
  var timeCell = editingDates ? inlineDateEditor(v)
    : (flags.editable
      ? '<button class="vl-cell vl-time" type="button" data-ver-inline="dates" data-ver-id="' + esc(id) + '" title="点击直接编辑计划开始与目标日期">'
        + '<b>' + esc(cycleWindow(v) || (v.targetDate ? "目标 " + dateShort(v.targetDate) : "未设周期")) + '</b>' + verDueHint(v) + '</button>'
      : '<div class="vl-time"><b>' + esc(cycleWindow(v) || (v.targetDate ? "目标 " + dateShort(v.targetDate) : "未设周期")) + '</b>' + verDueHint(v) + '</div>');
  var progressCell = '<button class="vl-progress" type="button" data-ver-open-tab="scope" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="查看该版本的工作项明细">'
    + (total
      ? '<span class="vl-bar"><i class="done" style="width:' + pct + '%"></i>' + (doingPct ? '<i class="doing" style="width:' + doingPct + '%"></i>' : '') + (blockedPct ? '<i class="blocked" style="width:' + blockedPct + '%"></i>' : '') + '</span>'
        + '<span class="vl-ptext"><b>' + pct + '%</b><small>' + done + ' / ' + total + '</small></span>'
      : '<span class="vl-bar empty"></span><span class="vl-ptext"><b>未规划</b><small>0 项</small></span>')
    + '</button>';
  var relCell = '<button type="button" class="vl-cell vl-rel" data-ver-open-tab="releases" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="查看发布计划与实际发布记录">' + esc(verLatestReleaseText(v)) + '</button>';
  var quick;
  if(flags.editable && v.status === "planned"){
    quick = '<button class="btn sm" type="button" data-ver-start="' + esc(id) + '">开始开发</button>';
  }else if(v.status === "active" && flags.canPublish){
    quick = '<button class="btn sm primary" type="button" data-ver-release="' + esc(id) + '">记录发布</button>';
  }else if(v.status === "released"){
    quick = '<button class="btn sm ghost" type="button" data-ver-open-tab="releases" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '">发布记录</button>';
  }else{
    quick = '<button class="btn sm ghost" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '">详情</button>';
  }
  var acts = '<div class="vl-acts">' + quick
    + '<button class="icon-btn sm vl-kebab" type="button" data-ver-menu="' + esc(id) + '" aria-label="更多操作" aria-haspopup="true">' + icon("more", 15) + '</button>'
    + '</div>';
  return '<div class="vl-row" data-ver-row="' + esc(id) + '" data-ver-req="' + esc(req) + '" tabindex="0" role="button" aria-label="进入「' + esc(v.name) + '」的版本详情页">'
    + nameCell
    + timeCell
    + progressCell
    + relCell
    + acts
    + '</div>';
}
/* 未规划工作项用一条轻提示承接，不混进版本队列，避免把「待规划」误读成一个版本 */
function versionUnboundBannerHTML(){
  var u = (cache && cache.vstats && cache.vstats.unbound) || {};
  var taskCount = Number(u.taskCount) || 0;
  if(!taskCount) return "";
  var unboundTasks = (cache.tasks || []).filter(function(t){ return !taskVersionIds(t).length; });
  var writableVer = (cache.versions || []).some(function(v){ return !versionReadOnly(v); });
  var canAssign = canWritePhase() && unboundTasks.length && writableVer;
  return '<div class="vl-unbound-banner">'
    + '<span class="vl-ub-icon" aria-hidden="true">' + icon("alertCircle", 15) + '</span>'
    + '<span class="vl-ub-text"><b>' + taskCount + ' 个工作项</b>还没有排版本'
      + (Number(u.doneCount) ? '，其中 ' + u.doneCount + ' 项已完成' : '') + '</span>'
    + (canAssign ? '<button class="btn sm soft vl-ub-go" type="button" data-unbound-assign>去规划 →</button>' : '')
    + '</div>';
}
/* 分组标题承载状态：进行中 / 计划中常开，已结束的组默认只露最近 3 行 */
var VER_GROUP_DEFS = [["active","进行中"],["planned","计划中"],["released","已发布"],["closed","已关闭"],["canceled","已取消"]];
function verGroupOpen(status){
  if(verListUi.q || verListUi.riskOnly) return true;
  if(status === "released" || status === "closed" || status === "canceled") return !!verGroupUi.open[status];
  return true;
}
function verGroupNote(status, rows){
  if(status === "released"){
    var latest = rows.filter(function(v){ return v.releasedAt; }).sort(function(a, b){
      return String(b.releasedAt).localeCompare(String(a.releasedAt));
    })[0];
    return latest ? "最近上线 " + dateShort(latest.releasedAt) : "";
  }
  if(status === "active" || status === "planned"){
    var next = rows.filter(function(v){ return v.targetDate; }).sort(function(a, b){
      return String(a.targetDate).localeCompare(String(b.targetDate));
    })[0];
    return next ? "最近目标 " + dateShort(next.targetDate) : "未设目标日期";
  }
  return "";
}
function versionQueueGroups(){
  var focus = verFocusVersion();
  var rows = versionListRows().filter(function(v){ return !focus || v.id !== focus.id; });
  return VER_GROUP_DEFS.map(function(d){
    return { status:d[0], label:d[1], rows:rows.filter(function(v){ return v.status === d[0]; }) };
  }).filter(function(g){ return g.rows.length; });
}
function versionGroupsHTML(){
  var groups = versionQueueGroups();
  var filtered = !!(verListUi.q || verListUi.riskOnly);
  if(!groups.length){
    return '<div class="vl-empty">' + icon(filtered ? "search" : "folder", 16)
      + '<b>' + (filtered ? "没有符合条件的版本" : "还没有其他版本") + '</b>'
      + '<span>' + (filtered ? "清空搜索或取消「只看需关注」再试。" : "焦点卡之外还没有版本，新建后会排进这里。") + '</span></div>';
  }
  return groups.map(function(g){
    var open = verGroupOpen(g.status);
    var visible = open ? g.rows : g.rows.slice(0, 3);
    var note = verGroupNote(g.status, g.rows);
    var more = (!verListUi.q && !verListUi.riskOnly && g.rows.length > 3)
      ? '<button class="vl-group-more" type="button" data-ver-group-more="' + g.status + '">'
        + (open ? '收起，只看最近 3 个' : '展开其余 ' + (g.rows.length - 3) + ' 个' + esc(g.label) + '版本')
        + icon(open ? "chevronUp" : "chevronRight", 13) + '</button>'
      : "";
    return '<div class="vl-group">'
      + '<button class="vl-group-head" type="button" data-ver-group="' + g.status + '" aria-expanded="' + (open ? "true" : "false") + '">'
      + '<span class="vl-group-chev" aria-hidden="true">' + icon("chevronRight", 14) + '</span>'
      + '<b>' + esc(g.label) + '</b><span class="vl-group-count">' + g.rows.length + '</span>'
      + (note ? '<span class="vl-group-note">' + esc(note) + '</span>' : '')
      + '</button>'
      + visible.map(versionRowHTML).join("")
      + more
      + '</div>';
  }).join("");
}
function paintVersionList(){
  var box = document.getElementById("verList");
  if(!box) return;
  var rows = versionListRows();
  var focus = verFocusVersion();
  var riskBox = box.querySelector("[data-ver-risk]");
  if(riskBox) riskBox.checked = !!verListUi.riskOnly;
  var rowsBox = box.querySelector("[data-ver-rows]");
  if(rowsBox) rowsBox.innerHTML = versionGroupsHTML();
  var count = box.querySelector("[data-ver-count]");
  if(count){
    var other = focus ? rows.filter(function(v){ return v.id !== focus.id; }) : rows;
    var allOther = Math.max(0, versionListCounts().all - (focus ? 1 : 0));
    count.textContent = other.length + " 个" + ((verListUi.q || verListUi.riskOnly) ? "（已筛选，共 " + allOther + " 个）" : "");
  }
}
function versionListShellHTML(){
  return '<div class="panel ver-list" id="verList">'
    + '<div class="vl-toolbar">'
    + '<h2 class="vl-title">其他版本 <span class="vl-count" data-ver-count></span></h2>'
    + '<div class="vl-tools">'
    + '<label class="vl-check"><input type="checkbox" data-ver-risk' + (verListUi.riskOnly ? " checked" : "") + '> 只看需关注</label>'
    + '<div class="vl-search">' + icon("search", 14) + '<input type="search" data-ver-q placeholder="搜索版本名或说明" value="' + esc(verListUi.q) + '" aria-label="搜索版本"></div>'
    + '<label class="vl-sort">排序 <select class="mini-select" data-ver-sort aria-label="版本排序">'
    + '<option value="smart"' + (verListUi.sort === "smart" ? " selected" : "") + '>推荐顺序</option>'
    + '<option value="target"' + (verListUi.sort === "target" ? " selected" : "") + '>目标日期</option>'
    + '<option value="name"' + (verListUi.sort === "name" ? " selected" : "") + '>名称</option>'
    + '</select></label>'
    + '</div></div>'
    + '<div class="vl-head" aria-hidden="true"><span>版本</span><span>时间</span><span>进度</span><span>最近发布</span><span></span></div>'
    + '<div data-ver-rows></div>'
    + '<div class="vl-foot"><span class="vl-foot-note">点击版本进入详情 · 悬停字段可编辑名称与日期 · 进度按工作项自动计算</span>'
    + '<button class="link-cell vl-foot-link" type="button" data-ver-schedule-link>查看发布日程 →</button></div>'
    + '</div>';
}

/* ---------- 版本行内编辑 ---------- */

function mergedVersionById(id){
  var s = statsVersionFor(id);
  return s ? mergedVersionRow(s) : (findVersion(id) ? mergedVersionRow(findVersion(id)) : null);
}
function showInlineError(msg){
  var box = document.getElementById("verList");
  var err = box && box.querySelector("[data-ver-inline-err]");
  if(err){ err.textContent = msg; err.hidden = false; return; }
  toast(msg, "warn");
}
function setInlineBusy(busy){
  var box = document.getElementById("verList");
  var btn = box && box.querySelector("[data-ver-inline-save]");
  if(btn){ btn.disabled = busy; btn.textContent = busy ? "保存中…" : "保存"; }
}
function startVersionInlineEdit(id, field){
  var v = mergedVersionById(id);
  if(!v) return;
  if(verInline && verInline.busy){ toast("正在保存上一个修改，请稍候", "warn"); return; }
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  if(versionReadOnly(v)){ toast(versionEnded(v) ? "已关闭或已取消的版本不能编辑" : "已有成功正式发布，版本内容只读", "warn"); return; }
  verInline = { id:id, field:field, busy:false };
  paintVersionList();
  var box = document.getElementById("verList");
  var input = box && box.querySelector('[data-ver-inline-input="' + (field === "dates" ? "startDate" : "name") + '"]');
  if(input){ input.focus(); if(input.select) input.select(); }
}
function cancelVersionInlineEdit(){
  if(verInline && verInline.busy) return;
  verInline = null;
  paintVersionList();
}
/* 内联保存复用 PUT /api/versions/{id}：revision 做 CAS，权限 / 锁定 / 日期校验都在服务端再走一遍 */
function saveVersionInline(){
  if(!verInline || verInline.busy) return;
  var id = verInline.id, field = verInline.field;
  var v = mergedVersionById(id);
  if(!v){ toast("版本已不可见，请刷新后重试", "warn"); return; }
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  if(versionReadOnly(v)){ toast(versionEnded(v) ? "已关闭或已取消的版本不能编辑" : "已有成功正式发布，版本内容只读", "warn"); cancelVersionInlineEdit(); return; }
  var box = document.getElementById("verList");
  var patch = {};
  if(field === "name"){
    var nameEl = box && box.querySelector('[data-ver-inline-input="name"]');
    var name = nameEl ? String(nameEl.value || "").trim() : "";
    if(!name){ showInlineError("请填写版本名称"); if(nameEl) nameEl.focus(); return; }
    if(name === (v.name || "")){ cancelVersionInlineEdit(); return; }
    patch.name = name;
  }else{
    var startEl = box && box.querySelector('[data-ver-inline-input="startDate"]');
    var targetEl = box && box.querySelector('[data-ver-inline-input="targetDate"]');
    var startDate = startEl ? startEl.value : "";
    var targetDate = targetEl ? targetEl.value : "";
    if(startDate && targetDate && startDate > targetDate){
      showInlineError("计划开始日期不能晚于目标发布日期");
      if(startEl) startEl.focus();
      return;
    }
    if(startDate === (v.startDate || "") && targetDate === (v.targetDate || "")){ cancelVersionInlineEdit(); return; }
    patch.startDate = startDate || null;
    patch.targetDate = targetDate || null;
  }
  var body = {
    reqId: v.reqId || rt.phaseReqId,
    name: patch.name !== undefined ? patch.name : (v.name || ""),
    description: v.description || null,
    startDate: patch.startDate !== undefined ? patch.startDate : (v.startDate || null),
    targetDate: patch.targetDate !== undefined ? patch.targetDate : (v.targetDate || null),
    status: v.status === "active" ? "active" : "planned",
    revision: v.revision
  };
  verInline.busy = true;
  setInlineBusy(true);
  API.put("/api/versions/" + encodeURIComponent(id), body).then(function(saved){
    var i = -1;
    for(var k = 0; k < cache.versions.length; k++){ if(cache.versions[k].id === id){ i = k; break; } }
    if(i >= 0 && saved){
      /* 更新接口返回的是版本实体：canPublish / taskCount 等聚合字段在这里是 null，
         整对象覆盖会把列表上的发布权限与统计一并抹掉，只回写持久化字段 */
      ["name","description","startDate","targetDate","status","releasedAt","endedAt","endReason","commitmentAt","revision","updatedAt"].forEach(function(key){
        if(saved[key] !== undefined) cache.versions[i][key] = saved[key];
      });
    }
    var s = statsVersionFor(id);
    if(s){
      ["name","description","status","startDate","targetDate","releasedAt","revision"].forEach(function(key){
        if(saved && saved[key] !== undefined) s[key] = saved[key];
      });
    }
    verInline = null;
    invalidateVersionCache(v.reqId || rt.phaseReqId);
    paintVersionList();
    toast("已更新版本「" + ((saved && saved.name) || body.name) + "」", "fs");
    notifyDeliveryChanged(v.reqId || rt.phaseReqId);
  }).catch(function(ex){
    if(!verInline || verInline.id !== id) return;
    verInline.busy = false;
    setInlineBusy(false);
    if(ex && ex.code === 409){
      verInline = null;
      toast(ex.message || "版本已被其他人修改，已刷新", "warn");
      reloadView();
      return;
    }
    showInlineError(ex.message || "保存失败，请重试");
  });
}

/* ---------- 行级操作菜单：所有写入仍走 openVersionTool，不在列表里重写校验 ---------- */

function openVersionRowMenu(anchor, id){
  var v = mergedVersionById(id);
  if(!v) return;
  var flags = verRowFlags(v);
  var items = [];
  function add(act, text, cls){ items.push('<button class="menu-item' + (cls ? " " + cls : "") + '" type="button" data-ver-menu-act="' + act + '" data-ver-id="' + esc(id) + '">' + text + '</button>'); }
  add("open", "打开版本详情");
  add("plan", "计划与历史");
  if(flags.editable) add("edit", "编辑版本");
  if(flags.editable) add("tasks", "管理工作项");
  add("delivery", "交付说明");
  add("note", v.status === "released" ? "发布说明" : "当前规划说明");
  if(flags.canPublish) add("actual", "记录实际发布");
  if(flags.editable && v.status === "planned") add("start", "开始开发");
  if(flags.editable) add("close", "关闭版本");
  if(flags.editable) add("cancel", "取消版本", "danger");
  if(isOwner() && flags.editable) add("delete", "删除版本", "danger");
  var el = document.createElement("div");
  el.className = "menu ver-row-menu";
  el.innerHTML = '<div class="menu-title">' + esc(v.name) + '</div>' + items.join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-ver-menu-act]");
    if(!b) return;
    var act = b.getAttribute("data-ver-menu-act");
    UI.closeAllPops();
    if(act === "open"){ openVersionPage(rt.phaseReqId, id); return; }
    if(act === "delivery"){ openDeliveryNote(id, ""); return; }
    openVersionTool(rt.phaseReqId, id, act);
  });
  UI.openPop(el, anchor, { align:"left", width:180, onClose:function(){ el.remove(); } });
}

function versionDeliverySummary(v){
  /* 摘要与「查看实际记录」拆开：摘要可截断，入口不会被截断吃掉 */
  if(versionEnded(v)){
    return '<p class="foot-note ver-delivery-note">' + (v.status === "closed" ? '版本已关闭' : '版本已取消')
      + '，不再产生发布事实；工作项关联与历史保留。</p>';
  }
  if(v.releaseEvidenceKind === "release_snapshot"){
    return '<div class="ver-delivery"><p class="foot-note">成功事件快照：发布处理 ' + v.publishedTaskCount + ' 项次（含测试 / 重部署）· 其他处理 ' + v.excludedTaskCount
      + ' 项次。生产曾交付 ' + (v.uniqueProductionTaskCount || 0) + ' 项 · 当前生效 ' + (v.effectiveProductionTaskCount || 0) + ' 项，不等于待交付数量。</p>'
      + '<button class="link-cell" type="button" data-ver-note="' + esc(v.id) + '">查看实际记录</button></div>';
  }
  return '<p class="foot-note ver-delivery-note">' + (v.status === "released" ? '无正式发布记录，不能从完成数量或首版统计推断实际交付。' : '当前规划统计，完成不等于实际发布。') + '</p>';
}
/* 内容只读由后端 contentLocked 判定（成功的生产部署 / 重部署）；测试环境部署与回滚不锁定，前端不再自行拼条件 */
function versionContentLocked(v){
  return !!v && (v.contentLocked === true || v.status === "released");
}
function versionEnded(v){ return !!v && (v.status === "closed" || v.status === "canceled"); }
/* 终态版本与正式发布一样不再接受编辑、新工作项与新发布 */
function versionReadOnly(v){ return versionContentLocked(v) || versionEnded(v); }
/* 版本卡只读展示该版本的里程碑：达成与发布证据同卡可见，操作在项目驾驶舱 */
function versionMilestoneHTML(v){
  var m = (cache.milestones || []).filter(function(x){
    return x.kind === "version" && x.versionId === v.id && x.status !== "canceled";
  })[0];
  if(!m) return "";
  var status = { achieved:"已达成", achieved_rolled_back:"已达成 · 已回滚", overdue:"已延期", pending:"未达成" }[m.status] || m.status;
  var parts = ["里程碑 " + status];
  if(m.achievedAt){
    parts.push(dateShort(m.achievedAt) + " 达成");
    if(m.releaseAt) parts.push("生产发布 " + dateShort(m.releaseAt));
  }else if(m.targetDate){
    parts.push("目标 " + dateShort(m.targetDate));
  }
  parts.push("生产成功 " + (m.releaseCount || 0) + " 次");
  return '<button class="link-cell ver-milestone" type="button" data-ms-jump="' + esc(m.id) + '">' + esc(parts.join(" · ")) + '</button>';
}
function versionCardHTML(v){
  var st = v.status;
  var stTag = st === "released" ? '<span class="tag tag-success">已发布</span>'
    : (st === "active" ? '<span class="tag tag-info">进行中</span>'
    : (st === "closed" ? '<span class="tag tag-neutral">已关闭</span>'
    : (st === "canceled" ? '<span class="tag tag-neutral">已取消</span>' : '<span class="tag ghost">计划中</span>')));
  var cls = st === "released" ? "ver-rel" : (st === "active" ? "ver-doing" : "ver-plan");
  var sub;
  var win = cycleWindow(v);
  if(versionEnded(v)){
    sub = (win ? win + " · " : "") + (st === "closed" ? "已关闭" : "已取消")
      + (v.endedAt ? " · " + dateShort(v.endedAt) : "") + (v.endReason ? " · " + v.endReason : "");
  }
  else if(st === "released"){
    sub = (v.preLaunchCount > 0)
      ? dateShort(v.releasedAt) + " · 首版（上线前投入自动归入）"
      : (win ? win + " · " : "") + dateShort(v.releasedAt) + " 发布" + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "");
  }
  else if(st === "active") sub = win + " · 进行中" + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "");
  else sub = (win ? win + " · 计划中" : "计划中") + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "") + (v.scheduledDemandCount ? (" · 需求池已排 " + v.scheduledDemandCount + " 项") : "");
  var cells;
  if(versionEnded(v)){
    cells = [
      [v.taskCount || 0, "工作项", ""],
      [v.doneCount, "已完成", ""],
      [fmtMinutesShort(v.workMinutes), "累计投入工时", ""],
      [fmtMinutesShort(v.estimateMinutes), "预估工时", ""],
      [devText(v.deviationPct), "整体偏差", devColor(v.deviationPct)],
      [fmtPct(v.onTimePct), "准时完成率", ""]
    ];
  }else if(st === "released"){
    cells = [
      [fmtMinutesShort(v.workMinutes), "当前投入工时", ""],
      [v.doneCount, "当前完成工作项", ""],
      [v.demandCount, "已排需求", "", true, "demands"],
      [devText(v.deviationPct), "整体偏差", devColor(v.deviationPct)],
      [fmtPct(v.onTimePct), "准时完成率", ""],
      [v.avgTaskMinutes === null || v.avgTaskMinutes === undefined ? "—" : fmtMinutesShort(v.avgTaskMinutes), "工作项均耗时", ""]
    ];
  }else if(st === "active"){
    cells = [
      [fmtMinutesShort(v.workMinutes), "已投入工时", ""],
      [v.doneCount, "已完成", ""],
      [v.doingCount, "进行中", ""],
      [v.demandCount, "已排需求", "", true, "demands"],
      [fmtMinutesShort(v.remainingMinutes), "剩余预估", ""],
      [dateShort(v.targetDate), "目标就绪日", "", false]
    ];
  }else{
    cells = [
      [v.demandCount, "已排需求", "", true, "demands"],
      [fmtMinutesShort(v.estimateMinutes), "预估工时", ""],
      [v.taskCount ? v.taskCount : "—", "已拆解工作项", ""],
      [fmtMinutesShort(v.workMinutes), "已投入工时", ""]
    ];
  }
  var acts = '<div class="phase-acts">';
  var writable = canWritePhase();
  var permissions = (cache.versions || []).find(function(item){ return item.id === v.id; }) || v;
  acts += '<button class="btn sm" type="button" data-ver-open="' + esc(v.id) + '" title="打开版本详情页：范围、投入、需求、发布事实与操作记录">版本详情</button>';
  acts += '<button class="btn sm" type="button" data-ver-detail="' + esc(v.id) + '" title="查看计划与发布历史">计划与历史</button>';
  acts += '<button class="btn sm ghost" type="button" data-ver-note="' + esc(v.id) + '">' + (st === "released" ? '发布说明' : '当前规划说明') + '</button>';
  acts += '<button class="btn sm ghost" type="button" data-ver-delivery="' + esc(v.id) + '" title="把承诺范围、实际发布、回归结果与遗留问题聚合成一份可对外提交的说明">交付说明</button>';
  if(permissions.canPublish === true) acts += '<button class="btn sm primary" type="button" data-ver-release="' + esc(v.id) + '">记录实际发布</button>';
  var contentLocked = versionContentLocked(permissions) || versionContentLocked(v);
  var ended = versionEnded(permissions) || versionEnded(v);
  if(contentLocked) acts += '<span class="tag tag-neutral">正式发布后内容只读</span>';
  if(!contentLocked && !ended && writable){
    if(st === "planned"){
      acts += '<button class="btn sm" type="button" data-ver-start="' + esc(v.id) + '">开始开发</button>';
    }
    acts += '<button class="btn sm ghost" type="button" data-ver-tasks="' + esc(v.id) + '">管理工作项</button>';
    acts += '<button class="btn sm ghost" type="button" data-ver-edit="' + esc(v.id) + '">编辑</button>';
    acts += '<button class="btn sm ghost" type="button" data-ver-close="' + esc(v.id) + '">关闭</button>';
    acts += '<button class="btn sm ghost danger" type="button" data-ver-cancel="' + esc(v.id) + '">取消</button>';
  }
  if(isOwner() && !contentLocked && !ended){
    acts += '<button class="btn sm ghost danger" type="button" data-ver-del="' + esc(v.id) + '">删除</button>';
  }
  acts += '</div>';
  /* 说明只留两行：长文案会把整行版本卡撑到一屏高；是否被截断在渲染后量出来再决定要不要给展开入口 */
  var descHTML = v.description
    ? '<div class="ver-desc-wrap"><p class="ver-desc" data-ver-desc title="' + esc(v.description) + '">' + esc(v.description) + '</p>'
      + '<button class="link-cell ver-desc-toggle" type="button" data-ver-desc-toggle hidden>展开说明</button></div>'
    : "";
  return '<div class="phase-card ' + cls + '"><div class="phase-card-head">'
    + '<button class="tag tag-primary ver-open" type="button" data-ver-open="' + esc(v.id) + '" title="打开「' + esc(v.name) + '」的版本详情页">'
      + '<span>' + esc(v.name) + '</span>' + icon("chevronRight", 12) + '</button>' + stTag
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
    + branchChipsHTML(v.branches)
    + descHTML
    + metricCells(cells, { scope: "version", val: v.id }) + commitmentHTML(v) + versionMilestoneHTML(v) + versionDeliverySummary(v) + acts + '</div>';
}
/* 承诺基线只在开始开发时快照一次：这里只读展示，新增/移出都是与当时的差集 */
function commitmentHTML(v){
  var c = v && v.commitment;
  if(!c) return "";
  var parts = ["承诺基线 " + (c.taskCount || 0) + " 项 · 预估 " + fmtMinutesShort(c.estimateMinutes)];
  if(c.donePct !== null && c.donePct !== undefined) parts.push("基线完成 " + c.donePct + "%");
  if(c.addedCount) parts.push("新增 " + c.addedCount + " 项" + (c.addedEstimateMinutes ? "（" + fmtMinutesShort(c.addedEstimateMinutes) + "）" : ""));
  if(c.removedCount) parts.push("移出 " + c.removedCount + " 项" + (c.removedEstimateMinutes ? "（" + fmtMinutesShort(c.removedEstimateMinutes) + "）" : ""));
  if(c.capturedAt) parts.push(dateShort(c.capturedAt) + " 冻结");
  return '<p class="foot-note ver-commitment">' + esc(parts.join(" · ")) + '</p>';
}
/* 说明默认截断两行；只有真的溢出时才露出「展开说明」，已展开时固定显示「收起说明」 */
function syncVersionDescToggles(){
  if(!phaseBody) return;
  phaseBody.querySelectorAll("[data-ver-desc]").forEach(function(p){
    var btn = p.parentNode.querySelector("[data-ver-desc-toggle]");
    if(!btn) return;
    var open = p.classList.contains("open");
    btn.hidden = !open && p.scrollHeight <= p.clientHeight + 1;
    btn.textContent = open ? "收起说明" : "展开说明";
  });
}
/* ---------- 版本阶段工时汇总（向上抽象一层的只读聚合） ---------- */

/* 列表页默认跨版本对比；单版本视角再从下拉切进去 */
var rollupUi = { reqId:"", verId:"__all", dim:"stage", more:false, cats:[], demands:null, demandsReqId:"", demandLoading:false };

function rollupH(m){
  var n = Number(m) || 0;
  return n > 0 ? fmtMinutesShort(n) : "—";
}
function rollupPct(part, total){
  if(!total) return "—";
  return Math.round((Number(part) || 0) * 100 / total) + "%";
}
function rollupActual(t){ return Math.max(0, Number(t.totalMinutes) || 0); }
function rollupTest(t){ return Math.min(rollupActual(t), Math.max(0, Number(t.testMinutes) || 0)); }
function rollupDev(t){ return Math.max(0, rollupActual(t) - rollupTest(t)); }
function rollupEst(t){ return Math.max(0, Number(t.estimateMinutes) || 0); }

/* 版本范围与版本卡、指标格下钻同一口径：绑定的工作项 + 首版上线前未绑版本的折算 */
function rollupVersionTasks(versionId){
  var firstRel = cache.phase ? cache.phase.firstReleasedAt : null;
  var preId = preLaunchVersionId();
  return (cache.tasks || []).filter(function(t){
    var tv = taskVersionIds(t);
    if(tv.length) return tv.indexOf(versionId) !== -1;
    if(versionId !== preId) return false;
    var d = t.completedAt || t.startDate || t.dueDate || "";
    return !!(d && dayKey(d) <= dayKey(firstRel));
  });
}
function rollupSummary(tasks){
  var s = { items:tasks.length, est:0, act:0, dev:0, test:0, done:0 };
  tasks.forEach(function(t){
    s.est += rollupEst(t);
    s.act += rollupActual(t);
    s.dev += rollupDev(t);
    s.test += rollupTest(t);
    if(t.boardColumn === "done") s.done++;
  });
  return s;
}
function rollupCatName(id){
  if(!id) return "未分类";
  var hit = (rollupUi.cats || []).filter(function(c){ return c.id === id; })[0];
  return hit ? hit.name : "未分类";
}
/* 「没关联」和「关联了但找不到」是两种情况：并成一个词会让多行同名，看起来像分组重复 */
function rollupDemandHit(id){
  if(!id) return null;
  return (rollupUi.demands || []).filter(function(d){ return d.id === id; })[0] || null;
}
function rollupDemandName(id){
  if(!id) return "未关联需求";
  var hit = rollupDemandHit(id);
  if(hit) return hit.title;
  return rollupUi.demands ? "需求已删除（" + String(id).slice(0, 6) + "）" : "需求信息未加载";
}
/* 分组行：结构统一，阶段行只有窗口内 / 外带工时，完成/未开始只计条目 */
function rollupRows(tasks, dim){
  if(dim === "stage"){
    var dev = tasks.filter(function(t){ return rollupDev(t) > 0; });
    var test = tasks.filter(function(t){ return rollupTest(t) > 0; });
    var done = tasks.filter(function(t){ return t.boardColumn === "done"; });
    var idle = tasks.filter(function(t){ return t.boardColumn !== "done" && rollupActual(t) === 0; });
    return [
      { key:"dev", name:"测试窗口外", note:"预估 + 窗口外计时", color:"var(--info)", items:dev.length,
        est:rollupSummary(tasks).est, act:dev.reduce(function(a, t){ return a + rollupDev(t); }, 0), dev:null, test:null },
      { key:"test", name:"测试窗口内", note:"窗口内计时", color:"var(--primary)", items:test.length,
        est:0, act:test.reduce(function(a, t){ return a + rollupTest(t); }, 0), dev:null, test:null },
      { key:"done", name:"完成", note:"看板已完成，只计条目", color:"var(--success)", items:done.length, est:null, act:null },
      { key:"idle", name:"未开始", note:"未完成且还没有已记工时", color:"var(--text-3)", items:idle.length, est:null, act:null }
    ];
  }
  var groups = {}, order = [];
  tasks.forEach(function(t){
    var key = dim === "module" ? (t.categoryId || "") : (dim === "owner" ? (t.owner || "").trim() : (t.demandId || ""));
    if(!groups[key]){
      groups[key] = { key:key, name: dim === "module" ? rollupCatName(key) : (dim === "owner" ? (key || "未指派") : rollupDemandName(key)), tasks:[] };
      order.push(key);
    }
    groups[key].tasks.push(t);
  });
  var rows = order.map(function(key){
    var g = groups[key], s = rollupSummary(g.tasks);
    return { key:key, name:g.name, note:"", color:"", items:s.items, est:s.est, act:s.act, dev:s.dev, test:s.test };
  });
  rows.sort(function(a, b){
    if(!a.key !== !b.key) return a.key ? -1 : 1;
    return b.act - a.act;
  });
  return rows;
}
function rollupVersionSelectHTML(){
  var versions = cache.versions || [];
  return '<select class="mini-select" data-rollup-ver aria-label="汇总版本">'
    + '<option value="__all"' + (rollupUi.verId === "__all" ? " selected" : "") + '>全部版本（跨版本对比）</option>'
    + versions.map(function(v){
      return '<option value="' + esc(v.id) + '"' + (v.id === rollupUi.verId ? " selected" : "") + '>' + esc(v.name) + '</option>';
    }).join("")
    + '</select>';
}
function rollupCurrentVersion(){
  var versions = cache.versions || [];
  var hit = versions.filter(function(v){ return v.id === rollupUi.verId; })[0];
  if(hit) return hit;
  hit = versions.filter(function(v){ return v.status === "active"; })[0] || versions[0] || null;
  rollupUi.verId = hit ? hit.id : "__all";
  return hit;
}
function rollupKpisHTML(s){
  /* 卡片与表格行同一套下钻：卡片只是「不分组」的快捷入口，点开仍落到工作项明细 */
  var cells = [
    [s.items, "工作项", "已完成 " + s.done, "kpi", "items", "全部工作项"],
    [rollupH(s.est), "预估工时", "全部计入窗口外行", "kpi", "est", "有预估的工作项"],
    [rollupH(s.act), "实际工时", s.act ? "窗口外 + 窗口内" : "尚未计时", "kpi", "act", "有实际工时的工作项"],
    [rollupH(s.dev), "测试窗口外", "含评审、设计、开发、运维等", "stage", "dev", "测试窗口外的工作项"],
    [rollupH(s.test), "测试窗口内", "提测 → 测试结束的计时", "stage", "test", "测试窗口内的工作项"],
    [s.done + " / " + s.items, "已完成", "只计条目", "stage", "done", "已完成的工作项"]
  ];
  return '<div class="pgrid roll-kpis">' + cells.map(function(c){
    return '<button type="button" class="pcell drillable" data-rollup-group="' + c[3] + '" data-rollup-key="' + c[4] + '" title="下钻：' + esc(c[5]) + '">'
      + '<b>' + esc(String(c[0])) + '</b><span>' + esc(c[1]) + ' · ' + esc(c[2]) + '</span></button>';
  }).join("") + '</div>';
}
function rollupSplitHTML(s){
  if(!s.act) return '<p class="foot-note roll-split-empty">还没有已结束的计时，窗口内 / 外拆分要等第一条计时产生。</p>';
  var dw = Math.round(s.dev * 100 / s.act), tw = 100 - dw;
  return '<div class="roll-split" role="img" aria-label="实际工时中窗口外 ' + dw + '%，窗口内 ' + tw + '%">'
    + '<i class="dev" style="width:' + dw + '%"></i><i class="test" style="width:' + tw + '%"></i></div>'
    + '<div class="roll-split-legend">'
    + '<button type="button" data-rollup-group="stage" data-rollup-key="dev" title="下钻：测试窗口外的工作项"><i class="dev"></i>窗口外 ' + rollupH(s.dev) + '（' + dw + '%）</button>'
    + '<button type="button" data-rollup-group="stage" data-rollup-key="test" title="下钻：测试窗口内的工作项"><i class="test"></i>窗口内 ' + rollupH(s.test) + '（' + tw + '%）</button></div>';
}
function rollupDeltaHTML(act, est){
  if(est === null || est === undefined || !est) return '<td class="num muted">—</td>';
  var d = Math.round((act - est) * 100 / est);
  return '<td class="num">' + (d > 0 ? "+" : "") + d + '%</td>';
}
function rollupPivotHTML(tasks, s){
  var dim = rollupUi.dim, rows = rollupRows(tasks, dim);
  var stage = dim === "stage";
  var head = '<thead><tr><th>' + (stage ? "阶段" : dim === "module" ? "分类" : dim === "owner" ? "负责人" : "需求") + '</th>'
    + (stage ? '<th>数据来源</th>' : '')
    + '<th class="num">条目</th><th class="num">预估</th><th class="num">实际</th>'
    + (stage ? '' : '<th class="num">窗口外</th><th class="num">窗口内</th>')
    + '<th class="num">实际占比</th>' + (stage ? '' : '<th class="num">预估占比</th>')
    + (stage ? '' : '<th class="num">偏差</th>') + '</tr></thead>';
  var body = rows.map(function(r){
    var hours = r.act !== null && r.act !== undefined;
    var hasEst = r.est !== null && r.est !== undefined;
    var nameHTML = dim === "demand" && r.key ? (rollupDemandHit(r.key) ? assocLinkHTML("demand", r.key, r.name) : esc(r.name)) : esc(r.name);
    return '<tr class="roll-row" tabindex="0" data-rollup-group="' + esc(dim) + '" data-rollup-key="' + esc(r.key) + '" title="下钻该分组的工作项">'
      + '<td><span class="roll-name">' + (stage ? '<i class="roll-dot" style="background:' + r.color + '"></i>' : '') + nameHTML + '</span></td>'
      + (stage ? '<td class="muted">' + esc(r.note) + '</td>' : '')
      + '<td class="num">' + r.items + '</td>'
      + '<td class="num">' + (hasEst ? rollupH(r.est) : "—") + '</td>'
      + '<td class="num">' + (hours ? rollupH(r.act) : "—") + '</td>'
      + (stage ? '' : '<td class="num">' + (hours ? rollupH(r.dev) : "—") + '</td><td class="num">' + (hours ? rollupH(r.test) : "—") + '</td>')
      + '<td class="num">' + (hours ? rollupPct(r.act, s.act) : "—") + '</td>'
      + (stage ? '' : '<td class="num">' + (hasEst ? rollupPct(r.est, s.est) : "—") + '</td>')
      + (stage ? '' : rollupDeltaHTML(r.act || 0, r.est))
      + '</tr>';
  }).join("");
  var total = '<tr class="roll-total"><td colspan="' + (stage ? 2 : 1) + '"><b>合计</b></td>'
    + '<td class="num">' + s.items + '</td><td class="num">' + rollupH(s.est) + '</td><td class="num">' + rollupH(s.act) + '</td>'
    + (stage ? '' : '<td class="num">' + rollupH(s.dev) + '</td><td class="num">' + rollupH(s.test) + '</td>')
    + '<td class="num">' + rollupPct(s.act, s.act) + '</td>'
    + (stage ? '' : '<td class="num">' + rollupPct(s.est, s.est) + '</td>')
    + (stage ? '' : rollupDeltaHTML(s.act, s.est)) + '</tr>';
  return head + '<tbody>' + body + total + '</tbody>';
}
/* 跨版本默认只露 6 行：先给结论，需要时再展开全量 */
var ROLLUP_ALL_ROWS = 6;
function rollupAllVersionsHTML(){
  var versions = cache.vstats.versions || [];
  var rows = versions.map(function(v){
    return '<tr class="roll-row" tabindex="0" data-rollup-group="version" data-rollup-ver="' + esc(v.id) + '" title="下钻该版本的工作项">'
      + '<td>' + assocLinkHTML("version", v.id, v.name, {req:rt.phaseReqId}) + '</td><td>' + versionStatusTag(v.status) + '</td>'
      + '<td class="num">' + (v.doneCount || 0) + ' / ' + (v.taskCount || 0) + '</td>'
      + '<td class="num">' + rollupH(v.estimateMinutes) + '</td><td class="num">' + rollupH(v.workMinutes) + '</td>'
      + '<td class="num">' + rollupH(v.devMinutes) + '</td><td class="num">' + rollupH(v.testMinutes) + '</td>'
      + rollupDeltaHTML(v.workMinutes || 0, v.estimateMinutes) + '</tr>';
  });
  var u = cache.vstats.unbound || {};
  if(Number(u.taskCount)){
    rows.push('<tr class="roll-row" tabindex="0" data-rollup-group="version" data-rollup-ver="" title="下钻未绑定版本的工作项">'
      + '<td><span class="tag ghost">待规划</span></td><td class="muted">未绑定版本</td>'
      + '<td class="num">' + (u.doneCount || 0) + ' / ' + u.taskCount + '</td>'
      + '<td class="num">' + rollupH(u.estimateMinutes) + '</td><td class="num">' + rollupH(u.workMinutes) + '</td>'
      + '<td class="num">' + rollupH(u.devMinutes) + '</td><td class="num">' + rollupH(u.testMinutes) + '</td>'
      + '<td class="num muted">—</td></tr>');
  }
  var shown = rollupUi.more ? rows : rows.slice(0, ROLLUP_ALL_ROWS);
  var table = '<div class="tbl-wrap"><table class="phase-tbl roll-tbl"><thead><tr>'
    + '<th>版本</th><th>状态</th><th class="num">工作项</th><th class="num">预估</th><th class="num">实际</th>'
    + '<th class="num">窗口外</th><th class="num">窗口内</th><th class="num">偏差</th>'
    + '</tr></thead><tbody>' + (shown.join("") || '<tr><td colspan="8" class="tbl-empty foot-note">还没有版本</td></tr>') + '</tbody></table></div>';
  var more = rows.length > ROLLUP_ALL_ROWS
    ? '<button class="link ver-rollup-more" type="button" data-rollup-more>'
      + (rollupUi.more ? '收起，只看最近 ' + ROLLUP_ALL_ROWS + ' 行' : '展开全部 ' + rows.length + ' 行')
      + icon(rollupUi.more ? "chevronUp" : "chevronRight", 12) + '</button>'
    : "";
  return table + '<div class="ver-rollup-foot"><span>版本之间只比较总量与拆分，不做逐项对齐；一个工作项绑定多个版本时会在多个版本里各计一次，跨版本合计不等于项目合计。</span>' + more + '</div>';
}
function rollupPanelHTML(){
  var versions = cache.versions || [];
  if(!versions.length) return "";
  var all = rollupUi.verId === "__all";
  var v = all ? null : rollupCurrentVersion();
  if(!v && !all) return "";
  var dims = [["stage", "阶段"], ["module", "分类"], ["owner", "负责人"], ["demand", "需求"]];
  var ctl = '<div class="ver-rollup-ctl">' + rollupVersionSelectHTML()
    + (all ? '' : '<span class="seg mini" role="group" aria-label="汇总维度">' + dims.map(function(d){
        return '<button type="button" data-rollup-dim="' + d[0] + '" aria-pressed="' + (rollupUi.dim === d[0]) + '">' + d[1] + '</button>';
      }).join("") + '</span>')
    + '</div>';
  var head = '<div class="ver-rollup-head"><div class="ver-rollup-title"><b>阶段工时汇总</b>'
    + '<span>' + (all ? "跨版本对比：同一批工作项按版本归组，看实际与预估是否在收敛" : "向上抽象一层：这个版本一共投了多少、预计多少、窗口内与窗口外各占多少") + '</span></div>'
    + ctl + '</div>';
  var notes = '<details class="manager-caliber ver-rollup-caliber"><summary>口径</summary><div>'
    + '阶段不是新数据，只是同一批工作项的另一种分组：预估全部计入测试窗口外；实际工时里，测试窗口（提测 → 测试结束）内的计时计入窗口内，其余计入窗口外（含需求评审、设计、开发、运维等），所以窗口内 + 窗口外始终等于版本累计实际工时。'
    + '实际占比以版本累计实际为分母，预估占比以版本累计预估为分母，两个分母不同，不能互相比大小；阶段表只有实际占比。'
    + '评审 / 排期属于需求池阶段、不产生工作项工时，这里不重复统计；发布以版本卡的发布证据为准。'
    + '阶段表里的完成 / 未开始只计条目，不与工时相加。点任意行下钻到工作项，再点行打开详情。'
    + '工作项按「计划版本」归组，需求按「目标版本」规划；首版上线前未绑版本的工作项在统计中归入最早已发布版本（不代表实际交付），其余未绑工作项归「未绑定版本」。'
    + '偏差 =（实际 − 预估）÷ 预估，±15% 内为准确。</div></details>';
  var body;
  if(all){
    body = rollupAllVersionsHTML();
  }else{
    var tasks = rollupVersionTasks(v.id);
    var s = rollupSummary(tasks);
    var table = '<div class="tbl-wrap"><table class="phase-tbl roll-tbl">' + rollupPivotHTML(tasks, s) + '</table></div>';
    var foot = '<div class="ver-rollup-foot"><span>' + esc(v.name) + ' · ' + tasks.length + ' 个工作项 · 预估 ' + rollupH(s.est)
      + ' · 实际 ' + rollupH(s.act) + ' = 窗口外 ' + rollupH(s.dev) + ' + 窗口内 ' + rollupH(s.test) + '</span></div>';
    body = rollupKpisHTML(s) + rollupSplitHTML(s) + table + foot;
  }
  return '<section class="ver-rollup" data-rollup>' + head + notes + body + '</section>';
}
function paintRollup(){
  if(!phaseBody || viewMode !== "version") return;
  var old = phaseBody.querySelector("[data-rollup]");
  if(!old) return;
  var wrap = document.createElement("div");
  wrap.innerHTML = rollupPanelHTML();
  var next = wrap.firstChild;
  if(next) old.parentNode.replaceChild(next, old);
}
function ensureRollupDemands(done){
  var reqId = rt.phaseReqId;
  if(rollupUi.demands && rollupUi.demandsReqId === reqId){ done(); return; }
  if(rollupUi.demandLoading) return;
  rollupUi.demandLoading = true;
  API.getAllPages("/api/demands", { reqId: reqId }).then(function(rows){
    rollupUi.demandLoading = false;
    rollupUi.demands = rows || [];
    rollupUi.demandsReqId = reqId;
    if(rt.phaseReqId === reqId) done();
  }).catch(function(ex){
    rollupUi.demandLoading = false;
    toast(ex.message || "需求加载失败", "bad");
    done();
  });
}
/* 下钻：先按分组圈定工作项，弹窗里保留窗口内 / 外拆分，行内可继续打开详情 */
function rollupRowTasks(group, key, versionId){
  if(group === "version"){
    return { tasks: drillRows("version", versionId, ""), name: versionId ? ((cache.versions.filter(function(v){ return v.id === versionId; })[0] || {}).name || "版本") : "待规划" };
  }
  var tasks = rollupVersionTasks(versionId || rollupUi.verId);
  var name;
  if(group === "kpi"){
    name = { items:"全部工作项", est:"有预估的工作项", act:"有实际工时的工作项" }[key] || "工作项";
    if(key === "est") tasks = tasks.filter(function(t){ return rollupEst(t) > 0; });
    if(key === "act") tasks = tasks.filter(function(t){ return rollupActual(t) > 0; });
  }else if(group === "stage"){
    name = { dev:"测试窗口外", test:"测试窗口内", done:"完成", idle:"未开始" }[key] || "阶段";
    tasks = tasks.filter(function(t){
      if(key === "dev") return rollupDev(t) > 0;
      if(key === "test") return rollupTest(t) > 0;
      if(key === "done") return t.boardColumn === "done";
      return t.boardColumn !== "done" && rollupActual(t) === 0;
    });
  }else if(group === "module"){
    name = rollupCatName(key);
    tasks = tasks.filter(function(t){ return (t.categoryId || "") === key; });
  }else if(group === "owner"){
    name = key || "未指派";
    tasks = tasks.filter(function(t){ return (t.owner || "").trim() === key; });
  }else{
    name = key ? rollupDemandName(key) : "未关联需求";
    tasks = tasks.filter(function(t){ return (t.demandId || "") === key; });
  }
  return { tasks: tasks, name: name };
}
function openRollupDrill(group, key, versionId){
  var scope = rollupRowTasks(group, key || "", versionId || "");
  var tasks = scope.tasks.slice().sort(function(a, b){ return rollupActual(b) - rollupActual(a); });
  var s = rollupSummary(tasks);
  var versionName = versionId ? ((cache.versions.filter(function(v){ return v.id === versionId; })[0] || {}).name || "") : ((rollupCurrentVersion() || {}).name || "");
  /* 版本分组下 scope.name 就是版本名，再拼一次版本名会重复 */
  var drillTitle = group === "version"
    ? reqNameById(rt.phaseReqId) + " · " + scope.name
    : reqNameById(rt.phaseReqId) + " · " + versionName + " · " + scope.name;
  var body = tasks.map(function(t){
    return '<tr data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
      + '<td class="phase-task-cell"><span class="tbl-task"><span class="tbl-task-t" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' + taskPublicationHTML(t) + '</span></td>'
      + '<td>' + esc(typeName(t.itemType)) + '</td>'
      + '<td>' + esc(t.owner || "—") + '</td>'
      + '<td>' + (t.boardColumn === "done" ? '<span class="tag tag-success">已完成</span>' : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
      + '<td class="num">' + (rollupEst(t) ? fmtMinutesShort(rollupEst(t)) : "—") + '</td>'
      + '<td class="num">' + (rollupActual(t) ? fmtMinutesShort(rollupActual(t)) : "—") + '</td>'
      + '<td class="num">' + (rollupDev(t) ? fmtMinutesShort(rollupDev(t)) : "—") + '</td>'
      + '<td class="num">' + (rollupTest(t) ? fmtMinutesShort(rollupTest(t)) : "—") + '</td></tr>';
  }).join("") || '<tr><td colspan="8" class="foot-note tbl-empty">该分组下暂无工作项</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(drillTitle) + '</h2>'
    + '<div class="desc">共 ' + tasks.length + ' 项 · 预估 ' + rollupH(s.est) + ' · 实际 ' + rollupH(s.act)
    + '（窗口外 ' + rollupH(s.dev) + ' / 窗口内 ' + rollupH(s.test) + '）· 点击工作项行打开详情</div></div>'
    + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>工作项</th><th>类型</th><th>负责人</th><th>状态</th><th class="num">预估</th><th class="num">实际</th><th class="num">窗口外</th><th class="num">窗口内</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
    var t = e.target.closest("[data-open-task]");
    if(t){ openTaskById(t.dataset.openTask); }
  });
  UI.openModal(layer);
}

function renderVersionMode(){
  if(phaseMeta){
    var c = versionListCounts();
    phaseMeta.textContent = reqNameById(rt.phaseReqId) + " · 按版本分组 · 共 " + cache.versions.length + " 个版本"
      + (c.planned ? " · " + c.planned + " 个计划中" : "") + (c.active ? " · " + c.active + " 个进行中" : "");
  }
  if(!cache.versions.length && !cache.tasks.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"点右上角「新建版本」创建第一个版本；工作项在详情抽屉里选择计划版本。"
    });
    return;
  }
  /* 列表页只承载「下一版 + 最近发布计划 + 其他版本队列 + 阶段汇总」；工作项明细收进版本详情页签 */
  phaseBody.innerHTML = versionFocusHTML() + recentPlansCardHTML() + versionUnboundBannerHTML() + versionListShellHTML() + rollupPanelHTML();
  paintVersionList();
  loadRecentPlans(rt.phaseReqId);
}

/* ---------- 最近发布计划卡（发布入口前置到版本页首屏） ---------- */

var recentPlansSeq = 0;
function recentPlansCardHTML(){
  return '<section class="panel phase-recent-plans"><div class="panel-head"><h3>最近发布计划</h3>'
    + '<span class="meta-right"><button class="btn sm" type="button" data-recent-plan-new>新建发布计划</button></span></div>'
    + '<div data-recent-plans><p class="hint" style="padding:10px 14px">加载中…</p></div></section>';
}
function loadRecentPlans(reqId){
  var seq = ++recentPlansSeq;
  API.get("/api/release-plans", { project:reqId, status:"open" }).then(function(rows){
    if(seq !== recentPlansSeq || cacheReqId !== reqId || (viewMode !== "version" && viewMode !== "phase")) return;
    var box = phaseBody.querySelector("[data-recent-plans]");
    if(!box) return;
    var now = Date.now();
    /* 「最近」= 离当前时间最近（已过期与即将到来的都算）；未定时间的排最后 */
    rows = (rows || []).slice().sort(function(a, b){
      var ta = a.plannedAt ? new Date(a.plannedAt).getTime() : Infinity;
      var tb = b.plannedAt ? new Date(b.plannedAt).getTime() : Infinity;
      if(ta === tb) return 0;
      if(ta === Infinity) return 1;
      if(tb === Infinity) return -1;
      return Math.abs(ta - now) - Math.abs(tb - now);
    }).slice(0, 3);
    if(!rows.length){
      box.innerHTML = '<p class="hint" style="padding:10px 14px">没有未完成的发布计划；点右上「新建发布计划」选一个版本制定。</p>';
      return;
    }
    box.innerHTML = '<div class="rel-plan-list">' + rows.map(function(r){
      var late = r.plannedAt && new Date(r.plannedAt).getTime() < now;
      var planTime = r.plannedAt ? fmtReleaseTime(r.plannedAt).replace(/:00$/, "") : "未定时间";
      var go = !!r.versionId;
      return '<button class="rel-plan-row" type="button"' + (go ? ' data-recent-plan="' + esc(r.versionId) + '"' : ' disabled')
        + ' title="' + (go ? "打开该版本的发布工作台" : "该计划缺少版本关联") + '">'
        + '<span class="rp-t">' + esc(planTime) + (late ? ' <span class="tag tag-warning">已过期</span>' : '') + '</span>'
        + '<span class="rp-v">' + nameChips(r.versionNames || r.versionName, 2, "版本") + '</span>'
        + '<span class="rp-p">' + esc(releaseEnvironmentName(r.environment)) + ' · ' + esc(coverageName(r.coverage)) + '</span>'
        + '<span class="rp-s">' + planStatusTag(r.status) + '</span>'
        + '</button>';
    }).join("") + '</div>';
  }).catch(function(ex){
    if(seq !== recentPlansSeq || cacheReqId !== reqId || (viewMode !== "version" && viewMode !== "phase")) return;
    var box = phaseBody.querySelector("[data-recent-plans]");
    if(box) box.innerHTML = '<p class="hint" style="padding:10px 14px">' + esc(ex.message || "发布计划加载失败") + '</p>';
  });
}

/* ---------- 版本弹窗 ---------- */

function findVersion(id){
  if(!cache || !cache.versions) return null;
  for(var i = 0; i < cache.versions.length; i++){
    if(cache.versions[i].id === id) return cache.versions[i];
  }
  return null;
}
var versionDialogSeq = 0, versionDialogContext = null;
function versionDialogCurrent(){
  var c = versionDialogContext;
  return !!c && c.seq === versionDialogSeq && c.reqId === rt.phaseReqId && c.wsId === (rt.currentWs || {}).id && c.userId === (rt.currentUser || {}).id && c.route === document.body.dataset.view;
}
/* 版本详情子页借这里的弹窗做写操作：同一份权限校验、CAS 与留痕，不在两处实现。
   弹窗守卫读 rt.phaseReqId + 当前路由，findVersion 读 cache，所以必须先对齐上下文再打开。 */
function openVersionTool(reqId, versionId, tool){
  if(!reqId || !versionId) return Promise.resolve();
  var prevMode = viewMode;
  return (rt.reqsLoaded ? Promise.resolve() : loadReqs()).then(function(){
    rt.phaseReqId = reqId;
    if(phaseReq) phaseReq.value = reqId;
    if(cache && cacheReqId === reqId) return null;
    /* 总览 / 日程 / 全部版本模式下 loadPhaseData 会跳过取数，借版本模式把缓存拉齐 */
    viewMode = "version";
    return loadPhaseData();
  }).then(function(){
    /* 取数已落地，把列表页的模式还回去：从日程跳转过来再返回时不该变成版本卡 */
    viewMode = prevMode;
    if(!findVersion(versionId)){ toast("版本信息未就绪，请刷新后重试", "bad"); return; }
    if(tool === "edit") return openVersionDialog(versionId);
    if(tool === "tasks") return openVersionTasks(versionId);
    if(tool === "plan") return openReleaseDetail(versionId, "plan", function(){ notifyDeliveryChanged(reqId); });
    if(tool === "actual") return openReleaseDetail(versionId, "actual", function(){ notifyDeliveryChanged(reqId); });
    if(tool === "note") return showReleaseNote(versionId);
    if(tool === "start") return startVersion(versionId);
    if(tool === "close") return endVersion(versionId, "closed");
    if(tool === "cancel") return endVersion(versionId, "canceled");
    if(tool === "delete") return deleteVersion(versionId);
  }).catch(function(ex){
    viewMode = prevMode;
    toast(ex.message || "打开版本操作失败", "bad");
  });
}
function openVersionDialog(id, fresh){
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  if(!fresh){
    var seq = ++versionDialogSeq, reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id, route = document.body.dataset.view;
    versionDialogContext = {seq:seq, reqId:reqId, wsId:wsId, userId:userId, route:route};
    if(id){
      btnSaveVer.disabled = true;
      Promise.all([API.get("/api/versions", {reqId:reqId})]).then(function(rs){
        if(!versionDialogCurrent() || seq !== versionDialogSeq || !cache) return;
        cache.versions = rs[0];
        var v = findVersion(id);
        openVersionDialog(id, true);
      }).catch(function(ex){ if(versionDialogCurrent() && seq === versionDialogSeq) toast(ex.message || "加载版本失败", "bad"); });
      return;
    }
  }
  editingVerId = id || null;
  var v = id ? findVersion(id) : null;
  if(id && !v){ editingVerId = null; toast("版本已不可见，请刷新", "warn"); return; }
  if(v && versionContentLocked(v)){ editingVerId = null; toast("已有成功正式发布，版本内容只读", "warn"); return; }
  if(v && versionEnded(v)){ editingVerId = null; toast("已关闭或已取消的版本不能编辑", "warn"); return; }
  editingVerRevision = v ? v.revision : null;
  editingVerStatus = v ? v.status : null;
  $("dlgVersion").__uiOnClose = function(){ versionDialogSeq++; versionDialogContext = null; editingVerId = null; };
  btnSaveVer.disabled = false;
  vName.value = v ? v.name : "";
  vStart.value = v ? (v.startDate || "") : "";
  vTarget.value = v ? (v.targetDate || "") : "";
  vDesc.value = v ? (v.description || "") : "";
  fVerName.classList.remove("invalid");
  verFormTitle.textContent = id ? "编辑版本" : "新建版本";
  btnSaveVer.textContent = id ? "保存" : "新建版本";
  if($("vProjectName")) $("vProjectName").textContent = reqNameById(rt.phaseReqId) || "—";
  UI.openModal($("dlgVersion"), "input");
}
function saveVersion(){
  if(btnSaveVer.disabled || !versionDialogCurrent()) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var name = vName.value.trim();
  if(!name){
    fVerName.classList.add("invalid");
    try{ vName.focus(); }catch(e){ /* noop */ }
    return;
  }
  var savedId = editingVerId, seq = versionDialogSeq;
  var editing = savedId ? findVersion(savedId) : null;
  if(editing && versionContentLocked(editing)){ toast("已有成功正式发布，版本内容只读", "warn"); return; }
  if(editing && versionEnded(editing)){ toast("已关闭或已取消的版本不能编辑", "warn"); return; }
  var body = {
    reqId: rt.phaseReqId,
    name: name,
    description: vDesc.value.trim() || null,
    startDate: vStart.value || null,
    targetDate: vTarget.value || null,
    /* 编辑时保持原状态；新建一律 planned；已发布版本的编辑入口已隐藏（服务端亦拒绝） */
    status: savedId && editingVerStatus === "active" ? "active" : "planned",
    revision: savedId ? editingVerRevision : null
  };
  btnSaveVer.disabled = true;
  var p = savedId
    ? API.put("/api/versions/" + encodeURIComponent(savedId), body)
    : API.post("/api/versions", body);
  p.then(function(v){
    if(!versionDialogCurrent() || seq !== versionDialogSeq){
      /* 弹窗已关：不碰新表单，但保存确实成功了，仍要告知并刷新列表 */
      toast((savedId ? "已更新版本「" : "已创建版本「") + v.name + "」", "fs");
      notifyDeliveryChanged(v.reqId || rt.phaseReqId);
      if(document.body.dataset.view === "phase") reloadView();
      return;
    }
    btnSaveVer.disabled = false;
    UI.closeModal($("dlgVersion"));
    toast((savedId ? "已更新版本「" : "已创建版本「") + v.name + "」", "fs");
    editingVerId = null;
    notifyDeliveryChanged(v.reqId || rt.phaseReqId);
    reloadView();
  }).catch(function(ex){
    if(!versionDialogCurrent() || seq !== versionDialogSeq) return;
    btnSaveVer.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function releaseStatusName(status){ return PLAN_STATUS_META[status] ? PLAN_STATUS_META[status].name : "未创建"; }
/* 工具栏「发布计划」：切到按版本视图，直接打开最相关版本的发布计划 / 记录 */
function openProjectReleasePlan(){
  if(!rt.phaseReqId){ toast("先选择项目，再查看发布计划", "warn"); return; }
  var fromOverview = viewMode === "overview";
  viewMode = "version";
  syncModeSeg();
  var ready;
  if(cache && !fromOverview){ renderPhaseView(); ready = Promise.resolve(); }
  else ready = loadPhaseData() || Promise.resolve();
  ready.then(function(){
    if(document.body.dataset.view !== "phase" || viewMode !== "version") return;
    var versions = ((cache && cache.versions) || []).filter(function(v){ return !versionEnded(v); });
    if(!versions.length){ toast("该项目没有可制定发布计划的版本（已关闭或已取消的版本不参与）", "warn"); return; }
    if(versions.length === 1){ openReleaseDetail(versions[0].id, "plan"); return; }
    chooseReleaseVersion(versions);
  }).catch(function(){});
}
/* 工具栏入口不再静默挑一个版本：多版本时先让用户选，避免误把计划写到别的版本上 */
function chooseReleaseVersion(versions){
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", "选择版本");
  layer.innerHTML = '<div class="sheet sm"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>选择版本</h2><p class="desc">发布计划和实际记录都挂在具体版本上；先选版本，再填写计划或记录实际发布。</p></div><button class="icon-btn sm" type="button" data-pick-close aria-label="关闭">' + icon("close", 15) + '</button></div><div class="sheet-body"><div class="release-version-list">'
    + versions.map(function(v){
      return '<button class="release-version-item" type="button" data-pick-version="' + esc(v.id) + '"><b>' + esc(v.name) + '</b><small>' + esc(versionStatusName(v.status)) + ' · 目标就绪 ' + esc(v.targetDate || "未设置") + ' · 工作项 ' + esc(v.taskCount == null ? "—" : v.taskCount) + '</small></button>';
    }).join('') + '</div></div></div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  UI.openModal(layer, "[data-pick-version]");
  layer.addEventListener("click", function(e){
    if(e.target === layer || e.target.closest("[data-pick-close]")){ UI.closeModal(layer); return; }
    var btn = e.target.closest("[data-pick-version]");
    if(!btn) return;
    var versionId = btn.getAttribute("data-pick-version");
    UI.closeModal(layer);
    openReleaseDetail(versionId, "plan");
  });
}
/* 发布工作台是页面级子页：入口先记下参数并落 #/release，再由 views/release.js 把同一份工作区挂到页面容器。
   只有页面一个容器：计划、实际、历史、内容都在这一页，不再有弹框内页签与版本页页签并存的第二套。 */
var releaseIntent = null;
function releasePageSurface(host, v, returnHash){
  var root = document.createElement("div");
  root.className = "release-page";
  root.innerHTML = '<div class="page-toolbar release-page-bar">'
    + '<button class="btn sm ghost" type="button" data-release-back><span aria-hidden="true">←</span> 返回版本</button>'
    + '<span class="toolbar-meta"><b>' + esc(v.name) + '</b> · 发布工作台</span>'
    + '<span class="toolbar-right"><span class="hint">计划只描述打算怎么发；发布记录使用不可变工作项快照</span></span>'
    + '</div><div class="release-body release-page-body" aria-live="polite"></div>';
  host.innerHTML = "";
  host.appendChild(root);
  var surface = {
    layer: root,
    body: root.querySelector(".release-page-body"),
    isPage: true,
    current: function(){ return document.body.dataset.view === "release"; },
    /* 从版本详情下钻进来就回那一页；从版本列表 / 日程进来回版本页（日程的 onClose 会重拉列表） */
    close: function(){
      if(returnHash){
        try{ history.pushState(null, "", returnHash); }catch(e){ /* file:// 等受限环境：直接切视图 */ }
        showView("version");
        return;
      }
      showView("phase");
    },
    scrollTop: function(){ var sec = document.getElementById("view-release"); return sec ? sec.scrollTop : 0; },
    scrollTo: function(top){ var sec = document.getElementById("view-release"); if(sec) sec.scrollTop = top || 0; }
  };
  root.querySelector("[data-release-back]").addEventListener("click", function(){ surface.close(); });
  return surface;
}
export function takeReleaseIntent(){
  var it = releaseIntent;
  releaseIntent = null;
  return it;
}
/* 发布说明是轻量只读说明（不是工作流），仍用弹框；发布工作台已迁到子页 */
function releaseDialog(v, title){
  var layer = document.createElement("div"), disposed = false;
  var reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, route = document.body.dataset.view;
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", title);
  layer.__uiOnClose = function(){ disposed = true; setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet release-sheet"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>' + esc(v.name) + ' · ' + esc(title) + '</h2>'
    + '<p class="desc">计划版本不等于实际交付；发布记录使用不可变工作项快照。</p></div><button class="icon-btn sm" type="button" data-release-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body release-body" aria-live="polite">' + UI.skeletonRows(3) + '</div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){ if(e.target.closest("[data-release-close]")) UI.closeModal(layer); });
  UI.openModal(layer);
  return {layer:layer, body:layer.querySelector(".release-body"), current:function(){
    var valid = !disposed && reqId === rt.phaseReqId && wsId === (rt.currentWs || {}).id && route === document.body.dataset.view;
    if(!valid && !disposed) UI.closeModal(layer);
    return valid;
  }};
}
/* 保留原入口签名：所有调用方只换落点，不改业务流程 */
function openReleaseDetail(id, entry, onClose, knownVersion, presetVersionIds, forceNewPlan){
  var v = knownVersion || findVersion(id);
  var reqId = (v && v.reqId) || rt.phaseReqId;
  releaseIntent = { id:id, reqId:reqId, entry:entry || "plan", version:v || null, onClose:onClose || null, presetVersionIds:presetVersionIds || null, forceNewPlan:!!forceNewPlan,
    returnHash: document.body.dataset.view === "version" ? String(window.location.hash || "") : "" };
  import("../core/view-loader.js").then(function(m){ return m.loadView("release"); }).then(function(mod){
    mod.openReleasePage({ id:id, reqId:reqId, tab: entry === "actual" ? "actual" : "plan" });
  }).catch(function(ex){ toast(ex.message || "打开发布计划失败", "bad"); });
}
function releaseRecordHTML(record){ return releaseSnapshotHTML(record); }
/* 交付说明是低频视图：按需拉模块再落路由，不把纸张渲染器拉进版本页首屏 */
function openDeliveryNote(versionId, releaseId){
  if(!versionId){ toast("这条记录没有归属版本，无法生成说明", "warn"); return; }
  import("../core/view-loader.js").then(function(m){
    return m.loadView("delivery").then(function(mod){ mod.openDeliveryNote(versionId, releaseId); });
  }).catch(function(ex){ toast(ex.message || "打开交付说明失败", "bad"); });
}
/* 版本详情是独立路由页：按需拉模块再落 hash，链接可分享、浏览器可后退 */
function openVersionPage(reqId, versionId, tab){
  if(!versionId){ toast("这一行没有归属版本", "warn"); return; }
  import("../core/view-loader.js").then(function(m){
    return m.loadView("version").then(function(mod){ mod.openVersionDetail(reqId, versionId, tab); });
  }).catch(function(ex){ toast(ex.message || "打开版本详情失败", "bad"); });
}
function exportReleaseRecordCSV(record){
  /* ID 列保留原值供对账 join，编号列给人读；两者并存而不是互相替换 */
  var lines = [["发布记录编号", releaseNoText(record.releaseNo)], ["发布记录ID", record.id], ["项目ID", record.reqId], ["项目", record.projectName], ["版本ID", record.versionId], ["版本", record.versionName], ["计划ID", record.planId], ["计划修订", record.planRevision], ["计划时间（不可变快照）", releasePlanTime(record)], ["实际时间UTC", record.occurredAt], ["记录时间UTC", record.recordedAt],
    ["环境", record.environment], ["操作", record.operation], ["结果", record.result], ["目标键", JSON.stringify(record.targetKeys || [])], ["覆盖", record.coverage], ["制品引用", record.artifactRef], ["SHA256", record.artifactDigest], ["关联发布编号", releaseNoText(record.relatedReleaseNo)], ["关联发布ID", record.relatedReleaseId],
    ["记录人ID", record.recordedByUserId || record.releasedBy], ["记录人", record.recordedByName || record.releasedByName], ["实际执行人ID", record.executorUserId], ["实际执行人", record.executorName], ["幂等键", record.idempotencyKey], ["未按计划发布的原因", record.deviationReason], ["说明", record.notes], ["失败原因", record.failureReason],
    [], ["工作项编号", "工作项ID", "标题快照", "负责人ID", "负责人", "需求ID", "需求标题", "实际记录版本ID", "实际记录版本", "需求目标版本ID", "需求目标版本", "工作状态快照", "完成时间", "处理结果", "实际分钟", "预估分钟"]];
  (record.items || []).forEach(function(item){ lines.push([itemNoText(item.taskItemNo), item.taskId, item.title, item.ownerUserId, item.ownerName, item.demandId, item.demandTitle, record.versionId, record.versionName, item.targetVersionId, item.targetVersionName, item.boardColumn, fmtMinute(item.completedAt), item.disposition, item.workMinutes, item.estimateMinutes]); });
  var url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(function(row){ return row.map(csvCell).join(","); }).join("\r\n")], {type:"text/csv;charset=utf-8"}));
  var a = document.createElement("a"); a.href = url; a.download = "发布快照-" + (record.versionName || "版本") + "-" + (releaseNoText(record.releaseNo) || record.id) + ".csv";
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function publishVersion(id){ openReleaseDetail(id, "actual"); }
export function mountReleaseWorkspace(pageHost, opts){
  var id = opts.id, v = opts.version, entry = opts.entry || "plan";
  if(!id || !v) return null;
  var dlg = releasePageSurface(pageHost, v, opts.returnHash || ""), layer = dlg.layer;
  var base = "/api/versions/" + encodeURIComponent(id), reqId = v.reqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id;
  var syncBannerTimer = null, syncRowTimer = null, syncDebounceTimer = null;
  var justSynced = {};      /* 最近一次同步变化的分支 id，8 秒内重画也保留高亮 */
  document.addEventListener("ds:sse-entity", onBranchSync);
  function cleanup(){
    document.removeEventListener("ds:sse-entity", onBranchSync);
    if(syncBannerTimer){ clearTimeout(syncBannerTimer); syncBannerTimer = null; }
    if(syncRowTimer){ clearTimeout(syncRowTimer); syncRowTimer = null; }
    if(syncDebounceTimer){ clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    /* 关闭工作区前把待写的计划草稿落盘，保证刷新 / 重开后可恢复 */
    if(planDraftTimer){ clearTimeout(planDraftTimer); planDraftTimer = null; savePlanDraft(); }
    if(opts.onClose) opts.onClose();
  }
  dlg.destroy = cleanup;
  var storageKey = "hourglass:release-pending:" + JSON.stringify([wsId, userId, id]);
  var plans = [], planId = null, records = [], tasks = [], members = [], preview = null, previewContext = null;
  var busy = false, loadSeq = 0, previewSeq = 0, mayManage = false, mayPublish = false;
  var planOptions = null, planScopeVersionIds = null, planVersionQuery = "", planTaskPoolCache = {}, planTaskFetchKey = "", planTaskErrorKey = "", planTaskSeq = 0;
  var presetPlanVersionIds = opts.presetVersionIds && opts.presetVersionIds.length ? normalizedIds(opts.presetVersionIds) : null;
  var pending = null, storageError = "", recoveryMessage = "", recoveredRecord = null, retryAllowed = false, resetAllowed = false;
  var page = 0, filters = {result:"", environment:"", operation:""}, advancedOpen = false;
  /* 版本操作记录（version_log）：与正式发布记录分开，打开时拉一次，刷新按钮重新拉 */
  var verLog = {id:null, rows:[], error:""}, verLogSeq = 0;
  /* 发布检查：只读汇总本版本测试计划，随关联计划变化重新拉取；结论同时冻结进正式记录 */
  var releaseCheck = null, checkSeq = 0, checkLoading = false;
  /* 计划 / 实际 / 历史 / 内容 四个工作面：优先用 URL 里的页签，其次看入口；入口只决定看哪页 */
  var activeTab = ["plan", "actual", "history", "content"].indexOf(opts.tab) >= 0 ? opts.tab : (entry === "actual" ? "actual" : "plan");
  var syncingFromHash = false;
  var planJustSaved = false, planSavedRevision = null, restoreScroll = null, entryFocus = entry === "actual";
  var actualDraft = {planId:"", occurredAt:localMinute(), environment:"production", targetKeys:"", coverage:"full", artifactRef:"", artifactDigest:"", operation:"deploy", relatedReleaseId:"", executorUserId:"", actualTaskIds:[], deviationReason:"", result:"success", notes:"", failureReason:""};
  var actualPlanTouched = false;
  var releasePickerRef = null;  /* 计划负责人 / 实际执行人人员浮层引用；整表重绘前先收起，避免锚点被替换 */
  /* 计划编辑草稿本地留存（P-FB-3）：此前草稿只在内存，刷新即丢。这里按 [空间,用户,版本,计划] 存 localStorage，
     进入时若与已保存内容不同则提示恢复。只持久化计划面的标量 / 文本字段，不动版本选择与工作项勾选，
     也不触碰实际发布记录的 sessionStorage 幂等 / 恢复逻辑。 */
  var planDraftTimer = null, planDraftOffered = {};
  try{
    var stored = sessionStorage.getItem(storageKey);
    if(stored){
      pending = JSON.parse(stored);
      if(!pending || !pending.body || !pending.body.idempotencyKey || !Array.isArray(pending.body.actualTaskIds) || !Array.isArray(pending.body.targetKeys)) throw new Error("待确认请求格式异常");
    }
  }catch(ex){ storageError = "无法安全读取待确认请求；禁止新建事件，请恢复会话存储后重开。"; }
  function current(){
    if(userId !== (rt.currentUser || {}).id){ dlg.close(); return false; }
    return dlg.current() && reqId === rt.phaseReqId && wsId === (rt.currentWs || {}).id;
  }
  function error(msg, scope){
    var targets = scope === "plan" ? ["[data-plan-error]"]
      : scope === "actual" ? ["[data-actual-error]"]
      : ["[data-release-error]", "[data-plan-error]", "[data-actual-error]"];
    targets.forEach(function(sel){ layer.querySelectorAll(sel).forEach(function(el){ el.textContent = ""; }); });
    if(!msg) return;
    var el = layer.querySelector(scope === "plan" ? "[data-plan-error]" : scope === "actual" ? "[data-actual-error]" : "[data-release-error]");
    if(el) el.textContent = msg;
  }
  function dropSavedBanner(){
    if(!planJustSaved) return;
    planJustSaved = false;
    var banner = layer.querySelector("[data-release-next]");
    if(banner) banner.remove();
  }
  function readStored(){
    var text = sessionStorage.getItem(storageKey), stored = text ? JSON.parse(text) : null;
    if(stored && (!stored.body || !stored.body.idempotencyKey || !Array.isArray(stored.body.actualTaskIds) || !Array.isArray(stored.body.targetKeys))) throw new Error("待确认请求格式异常");
    return stored;
  }
  function persist(next, expectedKey){
    try{
      var stored = readStored(), key = stored && stored.body.idempotencyKey;
      var expected = expectedKey || (pending && pending.body.idempotencyKey);
      if((next && key && key !== next.body.idempotencyKey) || (!next && key && key !== expected) || (next && expectedKey && key !== expectedKey)){
        pending = stored; recoveryMessage = "会话中存在另一待确认请求；不会覆盖或删除，请先查询原键。"; error(recoveryMessage); return false;
      }
      if(next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else if(key) sessionStorage.removeItem(storageKey);
      pending = next; return true;
    }catch(ex){ storageError = "无法安全保存发布请求；旧请求不会被丢弃，请检查会话存储。"; error(storageError); return false; }
  }
  function selectedPlan(){ return plans.find(function(p){ return p.id === planId; }) || null; }
  function value(prefix, key){ var el = layer.querySelector('[data-' + prefix + '-' + key + ']'); return el ? el.value : ""; }
  function checks(prefix){ return normalizedIds(Array.from(layer.querySelectorAll('[data-' + prefix + '-task]:checked')).map(function(el){ return el.getAttribute('data-' + prefix + '-task'); })); }
  function lines(text){ return normalizedIds(String(text || "").split(/\r?\n/).map(function(s){ return s.trim(); })); }
  function utc(value){ return value && !isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null; }
  function options(values, chosen){ return values.map(function(pair){ return '<option value="' + esc(pair[0]) + '"' + (pair[0] === chosen ? ' selected' : '') + '>' + esc(pair[1]) + '</option>'; }).join(''); }
  var fieldSeq = 0;
  /* 字段说明用 data-tip：弹层内 .menu 会被 .modal-layer 盖住，tooltip 的层级在其之上 */
  function help(tip){
    return '<button type="button" class="label-help" data-tip="' + esc(tip) + '" aria-label="字段说明">' + icon("helpCircle", 13) + '</button>';
  }
  function field(label, control, tip, required, extra){
    var fid = "release-f" + (++fieldSeq);
    var ctrl = control.replace(/^<([a-z0-9]+)/i, function(_, tag){ return "<" + tag + ' id="' + fid + '"'; });
    return '<div class="field"><div class="label-row"><label for="' + fid + '">' + label + (required ? ' <span class="req">*</span>' : '') + '</label>' + (tip ? help(tip) : '') + '</div>' + ctrl + (extra || "") + '</div>';
  }
  function heading(text, tip){ return '<div class="label-row"><h4>' + text + '</h4>' + (tip ? help(tip) : '') + '</div>'; }
  function planWhen(item){ return item && item.plannedAt ? fmtReleaseTime(item.plannedAt).slice(0, 16) : "时间未定"; }
  function planVersionGroups(){
    return planOptions && Array.isArray(planOptions.projects) ? planOptions.projects : [];
  }
  function planVersionSelection(){
    if(planScopeVersionIds) return normalizedIds(planScopeVersionIds.concat(id));
    var p = selectedPlan();
    var list = p && Array.isArray(p.versionIds) ? normalizedIds(p.versionIds) : [];
    if(!list.length) list = [id];
    if(list.indexOf(id) === -1) list.push(id);
    return list;
  }
  function planPoolKey(){ return planVersionSelection().slice().sort().join(","); }
  function planPool(){ return planTaskPoolCache[planPoolKey()] || null; }
  function planSelectionProjects(selected){
    return planVersionGroups().filter(function(project){
      return (project.versions || []).some(function(ver){ return selected.indexOf(ver.id) !== -1; });
    }).length;
  }
  function planVersionPicker(disabled){
    var selected = planVersionSelection(), groups = planVersionGroups();
    if(!groups.length) return '<p class="hint">没有可管理的版本，或版本选项尚未加载；当前版本始终包含在计划中。</p>';
    var q = String(planVersionQuery || "").trim().toLowerCase(), shown = 0, total = 0;
    var html = groups.map(function(project){
      var all = project.versions || [];
      total += all.length;
      var hitProject = !!q && String(project.name || project.id).toLowerCase().indexOf(q) !== -1;
      /* 项目名命中就列出该项目全部版本；当前版本固定包含，搜索时也留在列表里 */
      var versions = all.filter(function(ver){
        if(!q || hitProject) return true;
        return String(ver.name || ver.id).toLowerCase().indexOf(q) !== -1 || String(ver.id) === String(id);
      });
      if(!versions.length) return '';
      shown += versions.length;
      var projectCount = all.filter(function(ver){ return selected.indexOf(ver.id) !== -1; }).length;
      return '<div class="release-version-group" role="group" aria-label="' + esc(project.name || project.id) + '"><div class="release-version-project"><span class="release-version-project-name">' + esc(project.name || project.id) + '</span><span class="release-version-project-count' + (projectCount ? ' is-on' : '') + '" data-plan-version-group-count="' + esc(project.id) + '">' + (projectCount ? projectCount + ' / ' + all.length : '未选') + '</span></div>'
        + versions.map(function(ver){
          var on = selected.indexOf(ver.id) !== -1, fixed = ver.id === id;
          return '<label class="release-version-row' + (on ? ' is-selected' : '') + (fixed ? ' is-fixed' : '') + '"' + (fixed ? ' title="当前版本固定包含在计划中"' : '') + '><input type="checkbox" data-plan-version="' + esc(ver.id) + '"' + (on ? ' checked' : '') + (disabled || fixed ? ' disabled' : '') + '><span><b>' + esc(ver.name || ver.id) + '</b><small>' + esc(versionStatusName(ver.status)) + (ver.targetDate ? ' · 目标 ' + esc(ver.targetDate) : '') + (fixed ? ' · 当前版本' : '') + '</small></span></label>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="release-version-picker" role="group" aria-label="计划包含的版本">'
      + '<div class="release-version-tools"><input type="search" data-plan-version-search value="' + esc(planVersionQuery || "") + '" placeholder="搜索版本或项目" aria-label="搜索版本或项目" autocomplete="off">'
      + '<span class="release-version-count" role="status">显示 ' + shown + ' / 共 ' + total + ' 个版本</span></div>'
      + html + '</div>'
      + '<p class="hint">计划可跨版本、跨项目；当前版本固定包含。计划只是意图，实际发布仍按单个版本登记，全部包含版本都完成生产部署 / 重部署后计划才自动完成。</p>';
  }
  /* 搜索只重建版本清单本身；勾选以 planScopeVersionIds 为准，不会被重绘丢掉 */
  function rerenderPlanVersionPicker(){
    var host = layer.querySelector('[data-plan-version-host]'); if(!host) return;
    var input = host.querySelector('[data-plan-version-search]');
    var focused = !!(input && document.activeElement === input), caret = focused ? input.selectionStart : null;
    var p = selectedPlan() || {};
    host.innerHTML = planVersionPicker(!mayManage || p.status === "completed" || !!pending || !!storageError);
    if(!focused) return;
    var next = host.querySelector('[data-plan-version-search]');
    if(!next) return;
    try{ next.focus({preventScroll:true}); }catch(ex){ /* noop */ }
    try{ next.setSelectionRange(caret, caret); }catch(ex){ /* noop */ }
  }
  function syncPlanVersionMeta(){
    var selected = planVersionSelection();
    layer.querySelectorAll('[data-plan-version-count]').forEach(function(el){ el.textContent = String(selected.length); });
    layer.querySelectorAll('[data-plan-version-project-count]').forEach(function(el){ el.textContent = String(planSelectionProjects(selected)); });
    layer.querySelectorAll('[data-plan-version-group-count]').forEach(function(el){
      var pid = el.getAttribute('data-plan-version-group-count');
      var group = planVersionGroups().filter(function(g){ return String(g.id) === pid; })[0];
      var total = group ? (group.versions || []).length : 0;
      var n = group ? (group.versions || []).filter(function(ver){ return selected.indexOf(ver.id) !== -1; }).length : 0;
      el.textContent = n ? n + ' / ' + total : '未选';
      el.classList.toggle('is-on', n > 0);
    });
  }
  function planVersionSummary(item){
    var count = item && item.versionCount != null ? Number(item.versionCount) : normalizedIds(item && item.versionIds).length;
    if(!count || count < 2) return "";
    return " · " + count + " 个版本" + (item.releasedVersionCount != null ? "（已完成 " + item.releasedVersionCount + "）" : "");
  }
  function planLabel(item){
    return planWhen(item) + " · " + releaseStatusName(item.status) + " · " + releaseEnvironmentName(item.environment) + " · " + coverageName(item.coverage) + " · " + normalizedIds(item.plannedTaskIds).length + " 项 · " + planRef(item) + planVersionSummary(item);
  }
  /* 计划可以跨项目，编号按空间取；存量未取号才回退 ID 尾号 */
  function planRef(item){
    var no = releasePlanNoText(item.planNo);
    return no || ("#" + String(item.id || "").slice(-6));
  }
  /* 选择框只放辨识信息，完整计划信息在下方摘要里展开，避免原生 select 截断 */
  function planOptionShort(item){
    return planWhen(item) + " · " + releaseStatusName(item.status) + " · " + releaseEnvironmentName(item.environment) + " · " + normalizedIds(item.plannedTaskIds).length + " 项" + planVersionSummary(item);
  }
  /* 不按环境 / 状态硬过滤：偏差也要能如实记录；改为在选项上标出会触发理由的情形 */
  function planOptionForActual(item, a){
    var marks = [];
    if(item.environment !== a.environment) marks.push("环境 " + releaseEnvironmentName(item.environment) + "≠当前");
    if(item.coverage !== a.coverage) marks.push("计划" + coverageName(item.coverage) + "≠当前");
    if(item.status !== "ready") marks.push(item.status === "canceled" ? "已取消" : item.status === "completed" ? "已完成" : "未就绪");
    return planLabel(item) + (marks.length ? "（" + marks.join("，") + "，需填理由）" : "");
  }
  function actualPlanOptions(a){
    return options([["", "无计划（紧急记录，理由必填）"]].concat(plans.map(function(item){ return [item.id, planOptionForActual(item, a)]; })), a.planId);
  }
  /* 默认关联当前版本、当前环境下最新的就绪计划；没有就绪计划才回落到“无计划”
     用户一旦手动选择（包括明确选择无计划），后续重绘不再覆盖。 */
  function preferredActualPlanId(){
    var best = null, bestScore = -1;
    plans.forEach(function(p){
      if(p.status !== "ready") return;
      if((p.environment || "production") !== actualDraft.environment) return;
      var vids = normalizedIds(p.versionIds);
      if(vids.length && vids.indexOf(id) === -1) return;
      var score = (p.coverage || "full") === actualDraft.coverage ? 2 : 0;
      score += vids.indexOf(id) !== -1 ? 1 : 0;
      if(score > bestScore || (score === bestScore && String(p.plannedAt || "") > String(best && best.plannedAt || ""))){
        best = p; bestScore = score;
      }
    });
    return best ? best.id : "";
  }
  /* 原生 select 会截断长选项，另起一行把所选计划的完整信息与偏差提示露出来 */
  function planSummaryInfo(a){
    var p = plans.find(function(item){ return item.id === a.planId; });
    if(!a.planId) return {text:"未关联计划：按紧急记录处理，确认时需填写「未按计划发布的原因」。", warn:false};
    if(!p) return {text:"所选计划不在当前列表中，请重新选择。", warn:true};
    var diffs = [];
    if(p.environment !== a.environment) diffs.push("环境为" + releaseEnvironmentName(p.environment) + "，当前实际为" + releaseEnvironmentName(a.environment));
    if(p.coverage !== a.coverage) diffs.push("覆盖为" + coverageName(p.coverage) + "，当前实际为" + coverageName(a.coverage));
    if(p.status !== "ready") diffs.push("状态为" + releaseStatusName(p.status));
    if(normalizedIds(p.versionIds).length && normalizedIds(p.versionIds).indexOf(id) === -1) diffs.push("计划不包含当前版本");
    var base = "计划 " + planWhen(p) + " · " + releaseEnvironmentName(p.environment) + " · " + coverageName(p.coverage) + " · " + normalizedIds(p.plannedTaskIds).length + " 项 · " + planRef(p) + planVersionSummary(p);
    var multi = normalizedIds(p.versionIds).length > 1 ? "；本次只登记当前版本，全部包含版本生产成功后才自动完成计划。" : "";
    return {text: base + (diffs.length ? "；" + diffs.join("；") + "，确认时需填写「未按计划发布的原因」。" : "；环境、覆盖与状态一致。") + multi, warn:!!diffs.length};
  }
  function planSummaryHTML(a){
    var s = planSummaryInfo(a);
    return '<p class="release-plan-summary' + (s.warn ? ' is-warn' : '') + '" data-release-plan-summary role="status">' + esc(s.text) + '</p>';
  }
  /* 计划负责人 / 实际执行人：与分支、详情同一套人员浮层（公司分组 + 主岗位 / 兼岗）。
     候选 = 本空间成员；值存在隐藏 input（data-plan-owner / data-release-executorUserId），
     按钮只负责展示与打开浮层，选完派发 change 让既有 changed / readActual / 校验链路照常跑。
     计划负责人保留历史非成员（retain），实际执行人须为当前成员，非成员回落为空由校验拦截。 */
  function releaseMemberOption(id){
    if(!id) return null;
    return members.map(memberToOption).filter(function(o){ return o.id === id; })[0] || null;
  }
  function releaseOwnerControl(scope, chosen, disabled){
    var isPlan = scope === "plan";
    var m = releaseMemberOption(chosen);
    var effectiveId = m ? m.id : (isPlan ? (chosen || "") : "");
    var emptyLabel = isPlan ? "未指派" : "请选择成员";
    var fieldOpt = m ? m : (isPlan && chosen ? { id:chosen, name:chosen, subText:"原负责人 · 已不在候选范围" } : null);
    var dataBtn = isPlan ? "data-plan-owner-btn" : "data-release-executorUserId-btn";
    var dataVal = isPlan ? "data-plan-owner" : "data-release-executorUserId";
    var label = (isPlan ? "计划负责人：" : "实际执行人：") + (fieldOpt ? fieldOpt.name : emptyLabel) + "，点击修改";
    return '<button type="button" class="people-field' + (fieldOpt ? "" : " is-empty") + '" ' + dataBtn + ' aria-haspopup="dialog" aria-expanded="false" aria-label="' + esc(label) + '"' + disabled + '>' + peopleFieldHTML(fieldOpt, emptyLabel) + '</button>' +
      '<input type="hidden" ' + dataVal + ' value="' + esc(effectiveId) + '">';
  }
  function openReleaseOwnerPicker(anchor, scope){
    var isPlan = scope === "plan";
    var hidden = layer.querySelector(isPlan ? '[data-plan-owner]' : '[data-release-executorUserId]');
    if(!hidden) return;
    var chosen = hidden.value || "", m = releaseMemberOption(chosen);
    var emptyLabel = isPlan ? "未指派" : "请选择成员";
    releasePickerRef = openPeoplePicker({
      anchor:anchor, title:isPlan ? "计划负责人" : "实际执行人",
      options:members.map(memberToOption), currentId:m ? m.id : "", currentName:chosen,
      unavailable:(isPlan && chosen && !m) ? { id:chosen, name:chosen } : null,
      allowClear:isPlan, clearLabel:"未指派",
      foot:isPlan ? "<b>岗位</b> = 空间默认岗位（项目内另有覆盖）；计划负责人可与实际执行人不同。仅展示，不改变权限。"
                  : "<b>岗位</b> = 空间默认岗位；实际执行人独立于记录人，须为当前空间成员。仅展示，不改变权限。",
      onPick:function(o){
        hidden.value = o ? o.id : "";
        anchor.innerHTML = peopleFieldHTML(o || null, emptyLabel);
        anchor.classList.toggle("is-empty", !o);
        anchor.setAttribute("aria-label", (isPlan ? "计划负责人：" : "实际执行人：") + (o ? o.name : emptyLabel) + "，点击修改");
        try{ hidden.dispatchEvent(new Event("change", { bubbles:true })); }catch(ex){ /* noop */ }
      }
    });
  }
  /* 工作项清单：分组 / 范围筛选 / 折叠 / 放大。勾选状态始终留在 layer DOM 里，
     checks() 与事件委托不用改；「放大」只是同一个节点的定位变化，不会被挪出表单。 */
  var pickerState = {
    plan:{ q:"", state:"", pub:"", scope:"", group:"version", expanded:false, collapsed:{} },
    actual:{ q:"", state:"", pub:"", scope:"", group:"version", expanded:false, collapsed:{} }
  };
  function pickerSt(prefix){ return pickerState[prefix] || pickerState.plan; }
  function pickerVersionIds(prefix){ return prefix === "plan" ? planVersionSelection() : [id]; }
  function pickerVersionName(vid){
    var name = "";
    planVersionGroups().some(function(project){
      return (project.versions || []).some(function(ver){ if(String(ver.id) === String(vid)){ name = ver.name || ver.id; return true; } return false; });
    });
    if(name) return name;
    var found = findVersion(vid);
    return (found && found.name) || vid;
  }
  /* 只有一个版本时按版本分组没有意义，悄悄退化成不分组；再加版本会自动恢复 */
  function pickerGroupMode(prefix){
    var mode = pickerSt(prefix).group || "none";
    return mode === "version" && pickerVersionIds(prefix).length < 2 ? "none" : mode;
  }
  function pickerGroupKey(prefix, t, mode){
    if(mode === "version"){
      var own = taskVersionIds(t);
      var hit = pickerVersionIds(prefix).filter(function(vid){ return own.indexOf(vid) !== -1; })[0];
      return hit ? "v:" + hit : "v:";
    }
    if(mode === "status") return t.boardColumn === "done" ? "s:done" : "s:open";
    if(mode === "owner") return "o:" + (t.owner || "");
    return "";
  }
  function pickerGroupLabel(key, mode){
    if(!key) return "";
    if(mode === "version") return key === "v:" ? "待规划（未绑定版本）" : pickerVersionName(key.slice(2));
    if(mode === "status") return key === "s:done" ? "已完成" : "未完成";
    return key === "o:" ? "未指派" : key.slice(2);
  }
  function rowVisible(row){
    if(row.hidden) return false;
    var group = row.closest("[data-task-group]");
    if(group && group.hidden) return false;
    var body = group && group.querySelector(".release-task-group-body");
    return !body || !body.hidden;
  }
  function taskRows(prefix, ids, disabled){
    var st = pickerSt(prefix);
    var actualPlan = plans.find(function(p){ return p.id === actualDraft.planId; });
    var planVids = pickerVersionIds(prefix);
    var loadedPool = prefix === "plan" ? planPool() : null;
    var pool = (loadedPool || tasks).filter(function(t){ return planVids.some(function(vid){ return taskVersionIds(t).indexOf(vid) !== -1; }) || ids.indexOf(t.id) !== -1 || (prefix === "actual" && normalizedIds((actualPlan || {}).plannedTaskIds).indexOf(t.id) !== -1); });
    var ref = records.find(function(r){ return r.id === actualDraft.relatedReleaseId; });
    if(prefix === "actual" && ref) (ref.items || []).forEach(function(s){ if(!pool.some(function(t){ return t.id === s.taskId; })) pool.push({id:s.taskId, title:s.title, boardColumn:"snapshot", versionIds:taskVersionIds(s), versionNames:s.versionNames}); });
    var retained = prefix === "actual" ? ids.concat(normalizedIds((actualPlan || {}).plannedTaskIds).filter(function(tid){ return tasks.some(function(t){ return t.id === tid && taskVersionIds(t).indexOf(id) !== -1; }); })) : ids;
    normalizedIds(retained).forEach(function(tid){ if(!pool.some(function(t){ return t.id === tid; })) pool.push({id:tid, title:tid + "（当前不可见）", boardColumn:"snapshot", versionIds:[]}); });
    var unbound = prefix === "plan" && planVids.length <= 1 ? tasks.filter(function(t){ return !taskVersionIds(t).length; }).length : 0;
    var selectedCount = pool.filter(function(t){ return ids.indexOf(t.id) !== -1; }).length;
    var mode = pickerGroupMode(prefix);
    var groups = [], seen = {};
    pool.forEach(function(t){
      var key = pickerGroupKey(prefix, t, mode);
      if(!seen[key]){ seen[key] = { key:key, label:pickerGroupLabel(key, mode), rows:[] }; groups.push(seen[key]); }
      seen[key].rows.push(t);
    });
    var groupOpts = (planVids.length > 1 ? [["version", "按版本"]] : []).concat([["status", "按状态"], ["owner", "按负责人"], ["none", "不分组"]]);
    var groupChosen = planVids.length > 1 || st.group !== "version" ? st.group : "none";
    var groupsHTML = groups.map(function(g){
      var collapsed = !!st.collapsed[g.key];
      var sel = g.rows.filter(function(t){ return ids.indexOf(t.id) !== -1; }).length;
      var rows = g.rows.map(function(t){
        var allowed = prefix !== "actual" || actualDraft.operation !== "rollback" || (ref && recordTaskIds(ref).indexOf(t.id) !== -1);
        return '<label class="version-task-row release-task-row" data-task-row data-task-id="' + esc(t.id) + '" data-task-title="' + esc(String(t.title || "").toLowerCase()) + '" data-task-state="' + (t.boardColumn === "done" ? "done" : "open") + '" data-task-published="' + (taskIsPublished(t) ? "1" : "0") + '"><input type="checkbox" data-' + prefix + '-task="' + esc(t.id) + '"' + (ids.indexOf(t.id) !== -1 ? ' checked' : '') + (disabled || !allowed ? ' disabled' : '') + '><span><span class="version-task-title"><b>' + esc(t.title) + '</b>' + taskPublicationHTML(t) + '</span><small>' + esc(colName(t.boardColumn)) + ' · 完成 ' + esc(fmtReleaseTime(t.completedAt)) + ' · 版本 ' + esc(taskVersionsText(t) || "待规划") + '</small></span></label>';
      }).join("");
      return '<section class="release-task-group' + (g.key ? "" : " is-flat") + (collapsed ? " is-collapsed" : "") + '" data-task-group="' + esc(g.key) + '">'
        + (g.key ? '<div class="release-task-group-head">'
          + '<button type="button" class="release-group-toggle" data-' + prefix + '-group-toggle="' + esc(g.key) + '" aria-expanded="' + (collapsed ? "false" : "true") + '" title="' + (collapsed ? "展开本组" : "收起本组") + '">' + icon("down", 12) + '<span class="release-group-name">' + esc(g.label) + '</span></button>'
          + '<label class="release-group-all"><input type="checkbox" data-' + prefix + '-group-all="' + esc(g.key) + '"' + (sel && sel === g.rows.length ? ' checked' : '') + (disabled ? ' disabled' : '') + '><span>全选本组</span></label>'
          + '<span class="release-group-count" data-group-count>已选 ' + sel + ' / ' + g.rows.length + '</span>'
          + '</div>' : "")
        + '<div class="release-task-group-body"' + (collapsed ? " hidden" : "") + '>' + rows + '</div>'
        + '</section>';
    }).join("");
    return '<div class="release-picker' + (st.expanded ? " is-expanded" : "") + '" data-' + prefix + '-picker>'
      + '<div class="release-picker-tools">'
      + '<input type="search" data-' + prefix + '-search value="' + esc(st.q) + '" placeholder="搜索标题或 ID" aria-label="搜索工作项">'
      + '<select data-' + prefix + '-filter aria-label="按状态筛选">' + options([["", "全部状态"], ["done", "仅已完成"], ["open", "仅未完成"]], st.state) + '</select>'
      + '<select data-' + prefix + '-pub aria-label="按发布状态筛选">' + options([["", "全部发布状态"], ["published", "已发布"], ["unpublished", "未发布"]], st.pub) + '</select>'
      + '<select data-' + prefix + '-scope aria-label="按选择状态筛选">' + options([["", "全部"], ["selected", "已选"], ["unselected", "未选"]], st.scope) + '</select>'
      + '<select data-' + prefix + '-group aria-label="工作项分组方式">' + options(groupOpts, groupChosen) + '</select>'
      + '<button class="btn sm" type="button" data-' + prefix + '-all' + (disabled ? ' disabled' : '') + '>全选可见</button>'
      + '<button class="btn sm" type="button" data-' + prefix + '-done' + (disabled ? ' disabled' : '') + '>仅选已完成</button>'
      + '<button class="btn sm" type="button" data-' + prefix + '-clear' + (disabled ? ' disabled' : '') + '>清空</button>'
      + '<span class="release-picker-count" data-' + prefix + '-count role="status">已选 ' + selectedCount + ' / 共 ' + pool.length + '</span>'
      + '<button class="btn sm release-picker-expand" type="button" data-' + prefix + '-expand aria-expanded="' + (st.expanded ? "true" : "false") + '" aria-controls="release-' + prefix + '-task-list" title="放大或收起工作项列表">' + icon(st.expanded ? "compress" : "expand", 13) + '<span>' + (st.expanded ? "收起" : "放大") + '</span></button>'
      + '</div>'
      + (prefix === "plan" && planVids.length > 1 && !loadedPool ? '<p class="hint">正在加载所选版本的工作项…</p>' : '')
      + (unbound ? '<p class="hint">另有 ' + unbound + ' 个未绑定版本的工作项，不属于本版本范围，不能选入。</p>' : '')
      + '<div class="release-task-picker" id="release-' + prefix + '-task-list" data-' + prefix + '-list>' + groupsHTML + '</div>'
      + '<p class="hint" data-' + prefix + '-empty hidden>没有匹配的工作项，试试清空搜索或切换筛选。</p>'
      + '</div>';
  }
  var PLAN_BRANCH_RANK = { merging:0, testing:1, dev:2, released:3 };
  function planBranchProjectName(pid){
    if(!pid) return "空间公共分支";
    var groups = planVersionGroups();
    for(var i = 0; i < groups.length; i++){
      if(String(groups[i].id) === String(pid)) return groups[i].name || "项目 " + pid;
    }
    var name = reqNameById(pid);
    return name && name !== "无" ? name : "项目 " + pid;
  }
  /* 只按计划选中的工作项实时推导；不写库、不做快照，变更后随选择重算 */
  function planBranchData(ids){
    var selected = normalizedIds(ids);
    var multi = planVersionSelection().length > 1;
    var pool = planPool();
    var loading = multi && !pool && planTaskFetchKey === planPoolKey();
    var failed = multi && !pool && planTaskErrorKey === planPoolKey();
    var source = pool || tasks || [];
    var byTask = {}, groups = {}, order = [], unknownBranches = {}, unknownTasks = 0, unbound = 0, missing = 0;
    source.forEach(function(t){ byTask[t.id] = t; });
    selected.forEach(function(tid){
      var t = byTask[tid];
      if(!t){
        if(!loading) missing++;
        return;
      }
      if(!t.branchId){ unbound++; return; }
      var meta = branchMetaById(t.branchId);
      if(!meta){
        if(!unknownBranches[t.branchId]) unknownBranches[t.branchId] = 0;
        unknownBranches[t.branchId]++; unknownTasks++;
        return;
      }
      var g = groups[t.branchId];
      if(!g){
        g = groups[t.branchId] = { id:t.branchId, name:meta.name || t.branchId, status:meta.status || "", target:meta.targetBranch || "", reqId:meta.reqId || t.reqId || "", owner:meta.owner || "", count:0 };
        order.push(g);
      }
      g.count++;
      if(!g.reqId && t.reqId) g.reqId = t.reqId;
    });
    order.sort(function(a, b){
      var ra = PLAN_BRANCH_RANK[a.status]; if(ra == null) ra = 9;
      var rb = PLAN_BRANCH_RANK[b.status]; if(rb == null) rb = 9;
      return ra - rb || String(a.name).localeCompare(String(b.name), "zh-CN");
    });
    return { selected:selected, groups:order, branchCount:order.length + Object.keys(unknownBranches).length, unknownBranchCount:Object.keys(unknownBranches).length, unknownTasks:unknownTasks, unbound:unbound, missing:missing, loading:loading, failed:failed };
  }
  function planBranchesHTML(ids){
    var d = planBranchData(ids);
    var head = '<div class="plan-br-head"><h4>计划涉及分支</h4><span class="plan-br-live"><i></i>实时</span><span class="plan-br-summary">' + d.selected.length + ' 项工作项 · <b>' + d.branchCount + '</b> 条分支' + (d.unbound ? ' · ' + d.unbound + ' 项未关联分支' : '') + '</span></div>';
    if(!d.selected.length){
      return '<div class="plan-branches" data-plan-branches role="region" aria-label="计划涉及分支（实时）">' + head + '<p class="plan-br-empty">尚未选择工作项；选择后会按分支去重汇总。</p></div>';
    }
    var counts = { merging:0, testing:0, dev:0, released:0 };
    d.groups.forEach(function(g){ if(counts[g.status] != null) counts[g.status]++; });
    var stats = ["merging", "testing", "dev", "released"].filter(function(st){ return counts[st] > 0; }).map(function(st){
      return '<span class="plan-br-stat"><i class="br-dot ' + BRANCH_ST[st].cls + '"></i>' + BRANCH_ST[st].name + ' ' + counts[st] + '</span>';
    }).join('');
    var rows = d.groups.map(function(g){
      var st = BRANCH_ST[g.status] || { name:g.status || "未知", cls:"" };
      var target = g.target
        ? '<span class="plan-br-target" title="' + esc(g.target) + '"><em>→</em><span>' + esc(g.target) + '</span></span>'
        : '<span class="plan-br-target is-empty" title="该分支未填写目标分支"><em>→</em><span>未指定目标分支</span></span>';
      var project = planBranchProjectName(g.reqId);
      var editable = canEditReq(g.reqId);
      var badge = editable
        ? '<button type="button" class="plan-br-badge is-' + esc(g.status || "unknown") + ' is-editable" data-plan-br-status="' + esc(g.id) + '" title="修改分支状态（当前：' + esc(st.name) + '）" aria-label="' + esc(g.name + "，当前" + st.name + "，点击修改状态") + '">' + esc(st.name) + icon("down", 10) + '</button>'
        : '<span class="plan-br-badge is-' + esc(g.status || "unknown") + '">' + esc(st.name) + '</span>';
      var owner = '<span class="plan-br-owner' + (g.owner ? '' : ' is-empty') + '" title="分支负责人：' + esc(g.owner || "未设置") + '">' + (g.owner ? icon("user", 12) : '') + '<span>' + esc(g.owner || "—") + '</span></span>';
      return '<div class="plan-br-row' + (g.status === "released" ? ' is-released' : '') + '" data-plan-br-row="' + esc(g.id) + '">'
        + '<span class="plan-br-name" title="' + esc(g.name) + '"><i class="br-dot ' + st.cls + '"></i><span>' + esc(g.name) + '</span></span>'
        + target
        + badge
        + '<span class="plan-br-count">' + g.count + ' 项</span>'
        + owner
        + '<span class="plan-br-project" title="' + esc(project) + '">' + esc(project) + '</span>'
        + '</div>';
    }).join('');
    var notes = '';
    if(d.loading) notes += '<p class="plan-br-note">所选版本的工作项正在加载，当前仅统计已加载部分；加载完成后自动刷新。</p>';
    if(d.failed) notes += '<p class="plan-br-note">所选版本的工作项加载失败，当前仅统计已加载部分；可刷新后重试。</p>';
    if(d.unknownBranchCount) notes += '<p class="plan-br-note">另有 <b>' + d.unknownBranchCount + '</b> 条分支信息暂不可见（' + d.unknownTasks + ' 项工作项），可能无权限或分支已删除。</p>';
    if(d.missing) notes += '<p class="plan-br-note"><b>' + d.missing + '</b> 项工作项暂不可加载，未计入分支清单。</p>';
    return '<div class="plan-branches" data-plan-branches role="region" aria-label="计划涉及分支（实时）">'
      + head
      + (stats ? '<div class="plan-br-stats">' + stats + '</div>' : '')
      + (rows ? '<div class="plan-br-list">' + rows + '</div>' : '')
      + (d.unbound ? '<div class="plan-br-unbound">还有 <b>' + d.unbound + '</b> 项工作项未关联分支，未计入上方清单。</div>' : '')
      + notes
      + '<p class="plan-br-note">按所选工作项<b>实时汇总并按分支去重</b>；分支状态以分支模块为准，会随分支变化，不代表“已合并”，也不作为发布证据。计划完成仍以版本生产发布为准。</p>'
      + '</div>';
  }
  function refreshPlanBranches(){
    var host = layer.querySelector('[data-plan-branches-host]'); if(!host) return;
    var picker = pickerBox("plan");
    var ids = picker ? checks("plan") : normalizedIds((selectedPlan() || {}).plannedTaskIds);
    host.innerHTML = planBranchesHTML(ids);
    /* 重画（勾选变化、后续同步）不能把刚同步行的高亮抹掉 */
    Object.keys(justSynced).forEach(function(bid){
      var row = host.querySelector('[data-plan-br-row="' + bid.replace(/["\\]/g, "") + '"]');
      if(row) row.classList.add("is-just-synced");
    });
  }
  /* 打开的发布工作区：只跟分支实体，重拉分支元数据并就地重算分支区块；不碰表单草稿与滚动位置 */
  function planBranchSnapshot(){
    var picker = pickerBox("plan");
    var ids = picker ? checks("plan") : normalizedIds((selectedPlan() || {}).plannedTaskIds);
    var map = {};
    planBranchData(ids).groups.forEach(function(g){ map[g.id] = { name:g.name, status:g.status }; });
    return map;
  }
  function showPlanSyncBanner(changes){
    var host = layer.querySelector("[data-plan-sync-host]"); if(!host) return;
    if(!changes || !changes.length){ host.innerHTML = ""; return; }
    var first = changes[0], toMeta = BRANCH_ST[first.to], fromMeta = BRANCH_ST[first.from];
    host.innerHTML = '<div class="plan-br-sync" role="status">'
      + '<i class="br-dot ' + (toMeta ? toMeta.cls : "") + '"></i>'
      + '<span class="plan-br-sync-text"><b>' + esc(first.name) + '</b> 状态已更新：'
      + esc(fromMeta ? fromMeta.name : (first.from || "未知")) + ' → ' + esc(toMeta ? toMeta.name : (first.to || "未知"))
      + (changes.length > 1 ? ' <span class="plan-br-sync-more">等 ' + changes.length + ' 条</span>' : '')
      + '<span class="plan-br-sync-time"> · 刚刚</span></span>'
      + '<button class="btn sm" type="button" data-plan-sync-open="' + esc(first.id) + '">查看分支</button>'
      + '<button class="icon-btn sm" type="button" data-plan-sync-close aria-label="收起同步提示">' + icon("close", 12) + '</button>'
      + '</div>';
    if(syncBannerTimer) clearTimeout(syncBannerTimer);
    syncBannerTimer = setTimeout(function(){ var h = layer.querySelector("[data-plan-sync-host]"); if(h) h.innerHTML = ""; }, 20000);
  }
  var syncInFlight = false, syncAgain = false;
  function refreshPlanBranchesFromSse(){
    if(!layer.classList.contains("open") || !current()) return;
    if(syncInFlight){ syncAgain = true; return; }
    syncInFlight = true;
    var before = planBranchSnapshot();
    loadBranches(true).then(function(){
      if(!layer.classList.contains("open") || !current()) return;
      var after = planBranchSnapshot(), changes = [];
      Object.keys(after).forEach(function(bid){
        var prev = before[bid];
        if(prev && prev.status !== after[bid].status) changes.push({ id:bid, name:after[bid].name, from:prev.status, to:after[bid].status });
      });
      changes.forEach(function(c){ justSynced[c.id] = 1; });
      refreshPlanBranches();
      if(changes.length){
        if(syncRowTimer) clearTimeout(syncRowTimer);
        syncRowTimer = setTimeout(function(){
          justSynced = {};
          layer.querySelectorAll(".plan-br-row.is-just-synced").forEach(function(row){ row.classList.remove("is-just-synced"); });
        }, 8000);
      }
      /* 无变化的后续事件不清掉已显示的提示：提示按 20 秒自动收起或手动关闭 */
      if(changes.length) showPlanSyncBanner(changes);
    }).catch(function(){ /* 分支元数据暂不可用时保持现状 */ }).then(function(){
      syncInFlight = false;
      if(syncAgain){ syncAgain = false; refreshPlanBranchesFromSse(); }
    });
  }
  function onBranchSync(e){
    if(!(e && e.detail && e.detail.entity === "branch")) return;
    /* 批量改状态会连发多条事件：合并成一次重拉，避免并发请求互相覆盖前后对比 */
    if(syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(function(){ syncDebounceTimer = null; refreshPlanBranchesFromSse(); }, 250);
  }
  /* 状态改在分支本身上：这里只提供快捷入口，不写计划；成功后重算实时区块 */
  function openPlanBranchStatusMenu(anchor, branchId){
    var meta = branchMetaById(branchId);
    if(!meta) return;
    var el = document.createElement("div");
    el.className = "menu plan-br-status-menu";
    el.setAttribute("role", "menu");
    el.innerHTML = ["dev", "testing", "merging", "released"].map(function(key){
      var st = BRANCH_ST[key], cur = meta.status === key;
      return '<button class="menu-item' + (cur ? " on" : "") + '" type="button" role="menuitem" data-plan-br-set="' + key + '">'
        + '<i class="br-dot ' + st.cls + '"></i>' + st.name + (cur ? '<span class="k">当前</span>' : '') + '</button>';
    }).join("");
    el.addEventListener("click", function(e){
      var btn = e.target.closest("[data-plan-br-set]");
      if(!btn) return;
      UI.closeAllPops();
      requestBranchStatus(branchId, btn.getAttribute("data-plan-br-set"), function(){ refreshPlanBranches(); });
    });
    UI.openPop(el, anchor, { align:"left" });
  }
  function pickerBox(prefix){ return layer.querySelector('[data-' + prefix + '-picker]'); }
  /* 多版本计划的工作项池来自所选版本并集；按排序后的版本键缓存，避免重复请求。 */
  function ensurePlanTaskPool(){
    var ids = planVersionSelection(), key = planPoolKey();
    if(ids.length < 2 || planTaskPoolCache[key] || planTaskFetchKey === key) return;
    planTaskFetchKey = key; var seq = ++planTaskSeq;
    API.get("/api/release-plan-tasks", {versionIds: ids}).then(function(rows){
      if(seq !== planTaskSeq || !current()) return;
      planTaskFetchKey = ""; planTaskErrorKey = ""; planTaskPoolCache[key] = rows || [];
      if(planPoolKey() === key) rerenderPlanPicker(true);
    }).catch(function(ex){
      if(seq !== planTaskSeq) return;
      planTaskFetchKey = ""; planTaskErrorKey = key;
      if(current()){ refreshPlanBranches(); toast(ex.message || "所选版本的工作项加载失败", "bad"); }
    });
  }
  function rerenderPlanPicker(dropStale){
    var old = pickerBox("plan"); if(!old) return;
    var p = selectedPlan() || {};
    var locked = !mayManage || p.status === "completed" || !!pending || !!storageError;
    var ids = checks("plan"), pool = planPool();
    if(dropStale && pool){
      var allow = {}; pool.forEach(function(t){ allow[t.id] = 1; });
      ids = ids.filter(function(tid){ return allow[tid]; });
    }
    var holder = document.createElement("div"); holder.innerHTML = taskRows("plan", ids, locked);
    old.replaceWith(holder.firstChild);
    filterPicker("plan"); updateChecklists(); refreshPlanBranches();
  }
  function setTabCount(key, n){
    var el = layer.querySelector('[data-release-tab="' + key + '"] .release-tab-count');
    if(el) el.textContent = String(n);
  }
  function pickerCount(prefix){
    var box = pickerBox(prefix); if(!box) return;
    var total = box.querySelectorAll('input[data-' + prefix + '-task]').length;
    var selected = box.querySelectorAll('input[data-' + prefix + '-task]:checked').length;
    var el = box.querySelector('[data-' + prefix + '-count]');
    if(el) el.textContent = "已选 " + selected + " / 共 " + total;
    if(prefix === "actual") setTabCount("actual", selected);
  }
  /* 分组头按当前筛选可见项统计；折叠与隐藏由 filterPicker 统一处理 */
  function syncPickerGroups(prefix){
    var box = pickerBox(prefix); if(!box) return;
    box.querySelectorAll("[data-task-group]").forEach(function(group){
      var total = 0, sel = 0, enabled = 0, enabledSel = 0;
      group.querySelectorAll("[data-task-row]").forEach(function(row){
        if(row.hidden) return;
        var cb = row.querySelector('input[data-' + prefix + '-task]');
        if(!cb) return;
        total++; if(cb.checked) sel++;
        if(!cb.disabled){ enabled++; if(cb.checked) enabledSel++; }
      });
      var count = group.querySelector("[data-group-count]");
      if(count) count.textContent = "已选 " + sel + " / " + total;
      var all = group.querySelector('[data-' + prefix + '-group-all]');
      if(all){ all.checked = enabled > 0 && enabledSel === enabled; all.indeterminate = enabledSel > 0 && enabledSel < enabled; }
    });
  }
  function filterPicker(prefix){
    var box = pickerBox(prefix); if(!box) return;
    var st = pickerSt(prefix);
    var q = String(st.q || "").trim().toLowerCase(), f = st.state, pf = st.pub, scope = st.scope, shown = 0;
    box.querySelectorAll("[data-task-row]").forEach(function(row){
      var state = row.getAttribute("data-task-state"), published = row.getAttribute("data-task-published") === "1";
      var cb = row.querySelector('input[data-' + prefix + '-task]');
      var chosen = !!(cb && cb.checked);
      var match = (!q || (row.getAttribute("data-task-title") || "").toLowerCase().indexOf(q) !== -1 || (row.getAttribute("data-task-id") || "").toLowerCase().indexOf(q) !== -1)
        && (!f || (f === "done" ? state === "done" : state !== "done"))
        && (!pf || (pf === "published" ? published : !published))
        && (!scope || (scope === "selected" ? chosen : !chosen));
      row.hidden = !match; if(match) shown++;
    });
    box.querySelectorAll("[data-task-group]").forEach(function(group){
      var any = false;
      group.querySelectorAll("[data-task-row]").forEach(function(row){ if(!row.hidden) any = true; });
      group.hidden = !any;
      var collapsed = !!st.collapsed[group.getAttribute("data-task-group")];
      var body = group.querySelector(".release-task-group-body");
      if(body) body.hidden = collapsed;
      group.classList.toggle("is-collapsed", collapsed);
      var toggle = group.querySelector('[data-' + prefix + '-group-toggle]');
      if(toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
    var empty = box.querySelector('[data-' + prefix + '-empty]'); if(empty) empty.hidden = shown !== 0;
    pickerCount(prefix);
    syncPickerGroups(prefix);
  }
  function afterPick(prefix){
    if(prefix === "actual") readActual();
    invalidatePreview();
    if(prefix === "plan") dropSavedBanner();
    error("", prefix);
    filterPicker(prefix); updateChecklists(); if(prefix === "plan") refreshPlanBranches();
  }
  /* 全选只作用于当前筛选可见项；仅选已完成与清空作用于全部可选行，避免筛选状态造成误判 */
  function bulkPick(prefix, mode){
    var box = pickerBox(prefix); if(!box) return;
    box.querySelectorAll("[data-task-row]").forEach(function(row){
      var cb = row.querySelector('input[data-' + prefix + '-task]');
      if(!cb || cb.disabled) return;
      if(mode === "clear") cb.checked = false;
      else if(mode === "done") cb.checked = row.getAttribute("data-task-state") === "done";
      else if(rowVisible(row)) cb.checked = true;
    });
    afterPick(prefix);
  }
  /* 整组勾选：勾上只作用于可见行，取消作用于全组，与「全选可见 / 清空」同一口径 */
  function groupPick(prefix, key, on){
    var box = pickerBox(prefix); if(!box) return;
    var target = null;
    box.querySelectorAll("[data-task-group]").forEach(function(group){ if(group.getAttribute("data-task-group") === key) target = group; });
    if(!target) return;
    target.querySelectorAll("[data-task-row]").forEach(function(row){
      var cb = row.querySelector('input[data-' + prefix + '-task]');
      if(!cb || cb.disabled) return;
      if(on && !rowVisible(row)) return;
      cb.checked = on;
    });
    afterPick(prefix);
  }
  function rerenderPicker(prefix){
    if(prefix === "plan"){ rerenderPlanPicker(false); return; }
    var old = pickerBox("actual"); if(!old) return;
    var holder = document.createElement("div");
    holder.innerHTML = taskRows("actual", checks("actual"), !!(pending || storageError));
    old.replaceWith(holder.firstChild);
    filterPicker("actual"); updateChecklists();
  }
  function setPickerExpanded(prefix, on){
    var st = pickerSt(prefix), box = pickerBox(prefix); if(!box) return;
    st.expanded = !!on;
    box.classList.toggle("is-expanded", st.expanded);
    var btn = box.querySelector('[data-' + prefix + '-expand]');
    if(btn){
      btn.innerHTML = icon(st.expanded ? "compress" : "expand", 13) + '<span>' + (st.expanded ? "收起" : "放大") + '</span>';
      btn.setAttribute("aria-expanded", st.expanded ? "true" : "false");
    }
    var target = st.expanded ? box.querySelector('[data-' + prefix + '-search]') : btn;
    if(target){ try{ target.focus({preventScroll:true}); }catch(ex){ try{ target.focus(); }catch(ex2){ /* noop */ } } }
  }
  function updateChecklists(){
    var planEl = layer.querySelector("[data-plan-readiness]");
    if(planEl){
      var b = planBody();
      var items = [[!!b.plannedAt, "计划时间"], [!!b.ownerUserId, "负责人"], [b.plannedTaskIds.length > 0, "工作项（已选 " + b.plannedTaskIds.length + " 项）"], [b.targetKeys.length > 0, "目标键（" + b.targetKeys.length + " 个）"], [b.status === "ready", "状态：就绪"]];
      var miss = items.filter(function(x){ return !x[0]; }).map(function(x){ return x[1]; });
      planEl.className = "release-readiness" + (miss.length ? "" : " is-ready");
      planEl.textContent = "就绪条件 " + (items.length - miss.length) + "/" + items.length + "：" + (miss.length ? "还缺 " + miss.join("、") : "已满足，可保存为就绪计划");
      var planCount = layer.querySelector("[data-plan-task-count]");
      if(planCount) planCount.textContent = String(b.plannedTaskIds.length);
    }
    var actualEl = layer.querySelector("[data-actual-readiness]");
    if(actualEl){
      var a = actualDraft;
      var needs = [[!!a.occurredAt, "发生时间"], [!!a.executorUserId, "执行人"], [!!String(a.artifactRef || "").trim(), "制品标识"], [/^[a-f0-9]{64}$/.test(String(a.artifactDigest || "").trim().toLowerCase()), "64 位 SHA256"], [lines(a.targetKeys).length > 0, "目标键"], [a.actualTaskIds.length > 0, "实际工作项（已选 " + a.actualTaskIds.length + " 项）"]];
      var missing = needs.filter(function(x){ return !x[0]; }).map(function(x){ return x[1]; });
      actualEl.className = "release-readiness" + (missing.length ? "" : " is-ready");
      actualEl.textContent = "记录条件 " + (needs.length - missing.length) + "/" + needs.length + "：" + (missing.length ? "还缺 " + missing.join("、") : "已填齐，可先预览再确认");
    }
  }
  function tabButton(key, label, count){
    var on = activeTab === key;
    return '<button type="button" role="tab" class="release-tab' + (on ? " is-active" : "") + '" id="release-tab-' + key + '" data-release-tab="' + key + '" aria-selected="' + (on ? "true" : "false") + '" aria-controls="release-panel-' + key + '" tabindex="' + (on ? "0" : "-1") + '">' + label + '<span class="release-tab-count">' + count + '</span></button>';
  }
  function switchTab(key, focus){
    if(key === "actual" && !mayPublish) key = "plan";
    activeTab = key;
    if(key === "actual"){
      planJustSaved = false;
      var banner = layer.querySelector("[data-release-next]"); if(banner) banner.remove();
    }
    layer.querySelectorAll("[data-release-tab]").forEach(function(b){
      var on = b.getAttribute("data-release-tab") === key;
      b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1;
    });
    layer.querySelectorAll("[data-release-panel]").forEach(function(p){ p.hidden = p.getAttribute("data-release-panel") !== key; });
    dlg.scrollTo(0);
    if(focus && key === "actual") focusActual();
    if(key === "actual" && !releaseCheck && !checkLoading) loadCheck();
    if(opts.onTab && !syncingFromHash) opts.onTab(key);
  }
  function focusActual(){
    ["[data-release-occurredAt]", "[data-release-executorUserId]", "[data-release-artifactRef]", "[data-release-artifactDigest]", "[data-release-targetKeys]"].some(function(sel){
      var el = layer.querySelector(sel);
      if(!el || String(el.value || "").trim()) return false;
      /* 执行人值在隐藏 input 里，焦点落到它前面的人员字段按钮 */
      var target = (el.tagName === "INPUT" && el.type === "hidden") ? el.previousElementSibling : el;
      try{ (target || el).focus({preventScroll:true}); }catch(ex){ (target || el).focus(); }
      return true;
    });
  }
  function readActual(){
    if(!layer.querySelector('[data-release-occurredAt]')) return actualDraft;
    ["planId", "occurredAt", "environment", "targetKeys", "coverage", "artifactRef", "artifactDigest", "operation", "relatedReleaseId", "executorUserId", "deviationReason", "result", "notes", "failureReason"].forEach(function(key){ actualDraft[key] = value("release", key); });
    actualDraft.actualTaskIds = checks("actual"); return actualDraft;
  }
  function context(){
    var a = readActual();
    return {planId:a.planId || null, occurredAt:utc(a.occurredAt), environment:a.environment, targetKeys:lines(a.targetKeys), coverage:a.coverage, artifactRef:a.artifactRef.trim(), artifactDigest:a.artifactDigest.trim().toLowerCase(), operation:a.operation, relatedReleaseId:a.relatedReleaseId || null, executorUserId:a.executorUserId || null, actualTaskIds:a.actualTaskIds.slice(), deviationReason:a.deviationReason.trim() || null, result:a.result, notes:a.notes.trim(), failureReason:a.result === "failed" ? a.failureReason.trim() : null};
  }
  function planBody(){
    var p = selectedPlan(), planned = value("plan", "planned");
    /* 发布计划接口使用 LocalDateTime；保留本地墙钟，不能发送 UTC 后丢掉偏移。 */
    var localPlanned = planned && !isNaN(new Date(planned).getTime()) ? localMinute(planned) : null;
    var plannedAt = p && p.plannedAt && localMinute(p.plannedAt) === localPlanned ? p.plannedAt : localPlanned;
    return {id:p ? p.id : null, revision:p ? p.revision : null, versionIds:planVersionSelection(), plannedAt:plannedAt, ownerUserId:value("plan", "owner") || null, status:value("plan", "status"), notes:value("plan", "notes").trim(), risks:value("plan", "risks").trim(), reason:value("plan", "reason").trim(), plannedTaskIds:checks("plan"), environment:value("plan", "environment"), targetKeys:lines(value("plan", "targets")), coverage:value("plan", "coverage")};
  }
  function planDirty(){
    var p = selectedPlan();
    if(!mayManage || (p && p.status === "completed") || !layer.querySelector('[data-plan-planned]')) return false;
    var b = planBody();
    var savedVersions = p && Array.isArray(p.versionIds) && p.versionIds.length ? p.versionIds : [id];
    return !sameIds(b.versionIds, savedVersions) || b.plannedAt !== (p && p.plannedAt ? p.plannedAt : null) || b.ownerUserId !== ((p || {}).ownerUserId || null) || b.status !== ((p || {}).status || "draft") || b.notes !== ((p || {}).notes || "") || b.risks !== ((p || {}).risks || "") || b.environment !== ((p || {}).environment || "production") || b.coverage !== ((p || {}).coverage || "full") || !sameIds(b.targetKeys, (p || {}).targetKeys) || !sameIds(b.plannedTaskIds, (p || {}).plannedTaskIds);
  }
  /* 计划「就绪」即时校验（P-FB-2）：状态切到就绪时，边填边提示还缺哪些必填项，不必等到点保存才报错。
     非就绪状态不触碰错误区，避免清掉理由字段的失焦提示。 */
  function validatePlanReady(){
    if(value("plan", "status") !== "ready") return true;
    var b = planBody(), missing = [];
    if(!b.plannedAt) missing.push("计划时间");
    if(!b.ownerUserId) missing.push("负责人");
    if(!b.plannedTaskIds.length) missing.push("至少 1 个工作项");
    if(!b.targetKeys.length) missing.push("目标键");
    if(missing.length){ error("设为「就绪」还需补齐：" + missing.join("、"), "plan"); return false; }
    error("", "plan");
    return true;
  }
  /* ---- 计划编辑草稿本地留存（P-FB-3） ----
     只覆盖计划面的标量 / 文本字段；版本选择与工作项勾选是结构性数据、可由已保存计划重绘，不纳入草稿，
     以免与分支联动 / 任务池逻辑相互干扰。存储不可用时静默降级，绝不阻断编辑或发布流程。 */
  var PLAN_DRAFT_KEYS = ["planned", "owner", "environment", "coverage", "status", "targets", "notes", "risks", "reason"];
  function planDraftKey(){ return "hourglass:release-plan-draft:" + JSON.stringify([wsId, userId, id, planId || "new"]); }
  function planDraftLocked(){
    var p = selectedPlan();
    return !mayManage || (p && p.status === "completed") || !!pending || !!storageError || !layer.querySelector('[data-plan-planned]');
  }
  function planDraftFields(){
    var f = {};
    PLAN_DRAFT_KEYS.forEach(function(k){ var el = layer.querySelector('[data-plan-' + k + ']'); f[k] = el ? el.value : ""; });
    return f;
  }
  /* 空草稿判定：可填项全空且状态 / 环境 / 覆盖回到默认，视为没有值得保留的内容 */
  function planDraftBlank(f){
    return !f.planned && !f.owner && !(f.reason || "").trim() && !(f.targets || "").trim() && !(f.notes || "").trim() && !(f.risks || "").trim()
      && (!f.status || f.status === "draft") && (!f.environment || f.environment === "production") && (!f.coverage || f.coverage === "full");
  }
  function samePlanDraft(a, b){ return PLAN_DRAFT_KEYS.every(function(k){ return (a[k] || "") === (b[k] || ""); }); }
  function savePlanDraft(){
    planDraftTimer = null;
    if(!current()) return;
    if(planDraftLocked()){ clearPlanDraft(); return; }
    var f = planDraftFields();
    try{
      if(planDraftBlank(f)) localStorage.removeItem(planDraftKey());
      else localStorage.setItem(planDraftKey(), JSON.stringify({ fields:f, savedAt:new Date().toISOString() }));
    }catch(ex){ /* 存储配额 / 隐私模式：草稿留存是增强项，失败即跳过 */ }
  }
  function schedulePlanDraft(){
    if(planDraftTimer) clearTimeout(planDraftTimer);
    planDraftTimer = setTimeout(savePlanDraft, 400);
  }
  function clearPlanDraft(){
    if(planDraftTimer){ clearTimeout(planDraftTimer); planDraftTimer = null; }
    try{ localStorage.removeItem(planDraftKey()); }catch(ex){ /* noop */ }
    delete planDraftOffered[planDraftKey()];
  }
  function readPlanDraft(){
    try{
      var raw = localStorage.getItem(planDraftKey());
      if(!raw) return null;
      var d = JSON.parse(raw);
      return (d && d.fields && typeof d.fields === "object") ? d : null;
    }catch(ex){ return null; }
  }
  function applyPlanDraft(f){
    PLAN_DRAFT_KEYS.forEach(function(k){
      if(k === "owner") return;
      var el = layer.querySelector('[data-plan-' + k + ']');
      if(el) el.value = f[k] || "";
    });
    /* 负责人 = 隐藏域 + 人员按钮：同步隐藏值并刷新按钮文案，与 openReleaseOwnerPicker 的 onPick 一致 */
    var hidden = layer.querySelector('[data-plan-owner]'), btn = layer.querySelector('[data-plan-owner-btn]');
    if(hidden) hidden.value = f.owner || "";
    if(btn){
      var m = releaseMemberOption(f.owner || "");
      var opt = m ? m : (f.owner ? { id:f.owner, name:f.owner, subText:"原负责人 · 已不在候选范围" } : null);
      btn.innerHTML = peopleFieldHTML(opt, "未指派");
      btn.classList.toggle("is-empty", !opt);
      btn.setAttribute("aria-label", "计划负责人：" + (opt ? opt.name : "未指派") + "，点击修改");
    }
    invalidatePreview(); refreshPlanBranches(); updateChecklists(); syncControls();
  }
  /* 进入 / 重绘计划面时提示恢复：每个计划键只提示一次，与已保存内容相同或为空则直接清掉 */
  function maybeOfferPlanDraft(){
    if(planDraftLocked()) return;
    var key = planDraftKey();
    if(planDraftOffered[key]) return;
    var d = readPlanDraft();
    if(!d) return;
    if(planDraftBlank(d.fields) || samePlanDraft(d.fields, planDraftFields())){ clearPlanDraft(); return; }
    planDraftOffered[key] = true;
    var panel = layer.querySelector('[data-release-panel="plan"]');
    if(!panel) return;
    var when = d.savedAt ? localDatetime(d.savedAt) : "";
    var bar = document.createElement("div");
    bar.className = "release-draft-banner";
    bar.setAttribute("data-plan-draft-banner", "");
    bar.innerHTML = '<span class="rdb-ic">' + icon("inbox", 14) + '</span>'
      + '<span class="rdb-tx">检测到上次未保存的计划草稿' + (when ? '（' + esc(when) + '）' : '') + '，可恢复到当前编辑。</span>'
      + '<span class="rdb-acts"><button class="btn sm primary" type="button" data-plan-draft-restore>恢复草稿</button>'
      + '<button class="btn sm ghost" type="button" data-plan-draft-dismiss>丢弃</button></span>';
    panel.insertBefore(bar, panel.firstChild);
  }
  function dismissPlanDraftBanner(){
    var bar = layer.querySelector('[data-plan-draft-banner]');
    if(bar) bar.remove();
  }
  /* 刷新 / 切换计划 / 新建计划都会按已保存内容重绘计划区：有未保存改动先确认，避免静默丢草稿 */
  function confirmDiscardPlan(proceed, revert){
    if(!planDirty()){ proceed(); return; }
    UI.showConfirm({ title:"放弃未保存的计划修改？", msg:"发布计划还有未保存的改动，继续将按已保存内容重新显示，本地草稿也会一并清除。", okText:"放弃修改", cancelText:"继续编辑" })
      .then(function(ok){ if(!current()) return; if(ok){ clearPlanDraft(); dismissPlanDraftBanner(); proceed(); } else if(revert) revert(); });
  }
  function recordTaskIds(record){
    if(Array.isArray(record.actualTaskIds)) return normalizedIds(record.actualTaskIds);
    return normalizedIds((record.items || []).filter(function(i){ return i.disposition === "published" || i.disposition === "candidate" || i.disposition === "rolled_back"; }).map(function(i){ return i.taskId; }));
  }
  function identical(record, body){
    if(record.idempotencyKey !== body.idempotencyKey) return false;
    var scalars = ["environment", "coverage", "artifactRef", "artifactDigest", "operation", "executorUserId", "result"];
    if(!scalars.every(function(k){ return record[k] === body[k]; })) return false;
    if(new Date(record.occurredAt).getTime() !== new Date(body.occurredAt).getTime()) return false;
    if((record.planRevision == null ? null : record.planRevision) !== (body.planRevision == null ? null : body.planRevision)) return false;
    if(!["planId", "relatedReleaseId", "notes", "failureReason", "deviationReason"].every(function(k){ return (record[k] || null) === (body[k] || null); })) return false;
    return sameIds(record.targetKeys, body.targetKeys) && sameIds(recordTaskIds(record), body.actualTaskIds);
  }
  /* 所有恢复路径先按旧键查询；查询失败绝不生成新键或清除待确认请求。 */
  function reconcile(){
    retryAllowed = false; resetAllowed = false;
    if(storageError) return Promise.reject(new Error(storageError));
    try{ pending = readStored(); }catch(ex){ storageError = "无法安全读取旧请求，禁止新事件。"; return Promise.reject(new Error(storageError)); }
    if(!pending) return Promise.resolve(false);
    var old = pending;
    return API.get(base + "/release-records", {key:old.body.idempotencyKey}).then(function(found){
      var list = Array.isArray(found) ? found : found ? [found] : [];
      if(list.length){
        var record = list.find(function(r){ return identical(r, old.body); });
        if(!record){ recoveryMessage = "旧键已有记录但无法验证上下文一致；请求保留，禁止新建或重试，请核对历史。"; return true; }
        recoveredRecord = record; recoveryMessage = "已找回同一次正式记录 " + (releaseNoText(record.releaseNo) || "#" + record.id) + "（" + record.result + "），不会创建重复事件。";
        if(persist(null, old.body.idempotencyKey) && current()){ invalidateVersionCache(reqId); reloadFilteredViews(); }
        return true;
      }
      recoveryMessage = old.rejection ? "服务端已明确拒绝：" + old.rejection + "。可显式重置后重新预览。" : "尚未找到旧键记录；仅允许使用原完整请求和原键重试。";
      retryAllowed = !old.rejection; resetAllowed = !!old.rejection; return true;
    });
  }
  function invalidatePreview(){
    preview = null; previewContext = null; previewSeq++;
    var el = layer.querySelector('[data-release-scope]');
    if(el) el.innerHTML = '<p class="hint">范围或确认上下文已变化，请重新预览；实际选择不会被计划替换。</p>';
    syncControls();
  }
  function syncControls(){
    var confirm = layer.querySelector('[data-release-confirm]');
    /* 阻断项不禁止记录事实，但必须留下未按计划发布的原因；预览已判定不可发布时也不放行确认 */
    var blockedNoReason = releaseCheck && releaseCheck.verdict === "block" && actualDraft.result === "success" && !String(actualDraft.deviationReason || "").trim();
    if(confirm) confirm.disabled = busy || !mayPublish || !!pending || !!storageError || !preview || preview.canPublish === false || planDirty() || blockedNoReason;
    layer.querySelectorAll('[data-release-save], [data-plan-new], [data-release-preview]').forEach(function(b){ b.disabled = busy || !!pending || !!storageError; });
    var retry = layer.querySelector('[data-release-retry]'); if(retry) retry.disabled = busy || !mayPublish || !retryAllowed || !!storageError;
    var reset = layer.querySelector('[data-release-reset]'); if(reset) reset.disabled = busy || !pending || !pending.rejection || !!storageError;
    layer.querySelectorAll('[data-release-refresh], [data-release-reconcile]').forEach(function(b){ b.disabled = busy; });
  }
  function setBusy(on){
    busy = on;
    layer.querySelectorAll('input, select, textarea, button').forEach(function(el){
      /* 加载中也要能离开：返回按钮和关闭按钮不被忙碌态锁住 */
      if(el.matches('[data-release-close], [data-release-back]')) return;
      if(on){ el.dataset.wasDisabled = el.disabled ? "1" : "0"; el.disabled = true; }
      else if(el.dataset.wasDisabled !== undefined){ el.disabled = el.dataset.wasDisabled === "1"; delete el.dataset.wasDisabled; }
    });
    syncControls();
  }
  /* create / release 是早期数据里的动作名，保留兜底标签避免历史记录显示英文 */
  var VERSION_LOG_NAME = {version_create:"创建版本", version_update:"编辑版本", version_start:"开始开发",
    version_close:"关闭版本", version_cancel:"取消版本", version_scope:"调整版本范围",
    create:"创建版本", release:"发布"};
  function renderVersionLog(){
    var box = layer.querySelector('[data-version-log]'); if(!box) return;
    if(verLog.id !== v.id){
      if(verLog.id !== null) verLog = {id:v.id, rows:[], error:""};
      else verLog.id = v.id;
      var seq = ++verLogSeq;
      API.get("/api/versions/" + encodeURIComponent(v.id) + "/release-history").then(function(rows){
        if(seq !== verLogSeq || !layer.querySelector('[data-version-log]')) return;
        verLog = {id:v.id, rows:rows || [], error:""};
        renderVersionLog();
      }).catch(function(ex){
        if(seq !== verLogSeq || !layer.querySelector('[data-version-log]')) return;
        verLog = {id:v.id, rows:[], error:ex.message || "网络异常"};
        renderVersionLog();
      });
    }
    if(verLog.error){
      box.innerHTML = '<p class="hint">操作记录加载失败：' + esc(verLog.error) + '</p>';
      return;
    }
    if(!verLog.rows.length){
      box.innerHTML = '<p class="hint">暂无操作记录；创建、编辑、开始、关闭 / 取消与范围调整都会记录在这里。</p>';
      return;
    }
    box.innerHTML = '<ul class="release-scope">' + verLog.rows.map(function(l){
      return '<li>' + esc(fmtReleaseTime(l.createdAt)) + ' · ' + esc(VERSION_LOG_NAME[l.action] || l.action) +
        ' · ' + esc(l.actorName || "系统") + (l.reason ? ' · 理由：' + esc(l.reason) : '') + '</li>';
    }).join('') + '</ul>';
  }
  function renderHistory(){
    var box = layer.querySelector('[data-release-record-list]'); if(!box) return;
    var rows = records.filter(function(r){ return (!filters.result || (filters.result === "published" ? r.result === "success" && r.environment === "production" && r.operation !== "rollback" : r.result === filters.result)) && (!filters.environment || r.environment === filters.environment) && (!filters.operation || r.operation === filters.operation); });
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / 10) - 1));
    box.innerHTML = rows.slice(page * 10, page * 10 + 10).map(releaseRecordHTML).join('') || '<p class="hint">没有匹配的正式记录，不反推历史。</p>';
    var count = layer.querySelector('[data-history-count]'); count.textContent = "第 " + (page + 1) + " 页 · " + rows.length + " 条（最多加载 200 条）";
    layer.querySelector('[data-history-prev]').disabled = busy || page === 0;
    layer.querySelector('[data-history-next]').disabled = busy || (page + 1) * 10 >= rows.length;
  }
  /* 高级区默认收起；一旦选了非默认操作 / 覆盖、关联事件、失败或偏差，自动展开避免漏填。 */
  function syncAdvanced(){
    var det = layer.querySelector("[data-release-advanced]"); if(!det) return;
    var a = actualDraft;
    if(a.operation !== "deploy" || a.coverage !== "full" || a.relatedReleaseId || a.result === "failed" || a.deviationReason) advancedOpen = true;
    det.open = advancedOpen;
    var sum = det.querySelector("[data-release-advanced-summary]");
    if(sum) sum.textContent = coverageName(a.coverage) + " · " + releaseOperationName(a.operation) + (a.relatedReleaseId ? " · 已关联事件" : "") + (a.result === "failed" ? " · 记录失败" : "");
  }
  function checkPolicyName(p){ return {strict:"严格", standard:"标准", loose:"宽松"}[p] || "标准"; }
  function checkCaseNames(c){
    return esc(c.caseNo || c.caseId || "") + (c.title ? " · " + esc(c.title) : "") + (c.result ? "（" + esc(c.result === "untested" ? "未执行" : c.result === "blocked" ? "阻塞" : c.result === "failed" ? "失败" : c.result) + "）" : "");
  }
  function checkCaseList(list, note){
    return '<ul class="release-case-list">' + list.map(function(x){
      return '<li><span>' + checkCaseNames(x) + '</span><span class="hint">' + note + '</span>'
        + '<button class="btn sm ghost" type="button" data-release-case="' + esc(x.caseId) + '">去处理</button></li>';
    }).join("") + '</ul>';
  }
  /* 团队共享分组进证据：只呈现结果分布，阻断判定仍只看发布必测与项目策略 */
  function checkSetList(list){
    if(!list || !list.length) return "";
    var dyn = list.filter(function(s){ return s.kind === "dynamic"; }).length;
    var seg = function(n, total, color){
      return n ? '<i style="width:' + (n / total * 100).toFixed(1) + '%;background:' + color + '"></i>' : "";
    };
    return '<p class="release-text">团队共享分组 ' + list.length + ' 个' + (dyn ? '（含动态 ' + dyn + ' 个）' : '')
      + ' · 分组间可重叠，计数不能相加当总数</p>'
      + '<ul class="release-set-list">' + list.map(function(s){
        var total = Number(s.total) || 0, t = total || 1;
        var passed = Number(s.passed) || 0, failed = Number(s.failed) || 0, blocked = Number(s.blocked) || 0;
        var skipped = Number(s.skipped) || 0, untested = Number(s.untested) || 0;
        var dist = total + ' 条 · 通过 ' + passed + ' / 失败 ' + failed + ' / 阻塞 ' + blocked
          + ' / 跳过 ' + skipped + ' / 未执行 ' + untested;
        return '<li title="' + esc(dist) + '"><span class="nm">' + esc(s.name)
          + (s.kind === "dynamic" ? '<i class="dyn">动态</i>' : "") + '</span>'
          + '<span class="bar" aria-hidden="true">'
          + seg(passed, t, "var(--success)") + seg(failed, t, "var(--danger)") + seg(blocked, t, "var(--warning)")
          + seg(skipped, t, "var(--text-3)") + seg(untested, t, "var(--border-strong)") + '</span>'
          + '<span class="dist">' + esc(total + ' 条 · 通过 ' + passed + ' / 失败 ' + failed + ' / 未执行 ' + untested) + '</span></li>';
      }).join("") + '</ul>'
      + '<p class="hint">分组证据只呈现结果分布，不改变阻断判定；指定成员 / 仅自己可见的分组不进证据。</p>';
  }
  function checkPanelHTML(){
    if(pending || storageError) return "";
    if(checkLoading && !releaseCheck) return '<section class="release-check"><h4>发布检查</h4><p class="hint">正在汇总本版本的测试计划…</p></section>';
    if(!releaseCheck) return '<section class="release-check"><h4>发布检查</h4><p class="hint">尚未获取检查结果；点「预览本次范围与预检结果」会重新汇总。</p></section>';
    var c = releaseCheck, meta = c.verdict === "block" ? ["有阻断项", "tag-danger"] : c.verdict === "warn" ? ["有提醒", "tag-warning"] : ["通过", "tag-success"];
    var policyHint = '策略：' + esc(checkPolicyName(c.policy)) + (mayManage ? '（在「编辑项目」中修改）' : '');
    var inlineDisabled = busy || pending || storageError ? ' disabled' : '';
    var requiredLine = '发布必测 ' + esc(c.requiredTotal) + ' 条：通过 ' + esc(c.requiredPassed)
      + (c.requiredFailed ? ' · 失败 / 阻塞 ' + esc(c.requiredFailed) : '')
      + (c.requiredUntested ? ' · 未执行 / 跳过 ' + esc(c.requiredUntested) : '');
    var riskReason = c.verdict === "block" && actualDraft.result === "success"
      ? '<div class="release-risk"><label for="releaseRiskReason">未按计划发布的原因 <span class="req">*</span></label>'
        + '<textarea id="releaseRiskReason" class="textarea" data-release-inlineReason maxlength="1000" placeholder="例如：未执行的 2 条必测已人工核对，窗口内补测"' + inlineDisabled + '>' + esc(actualDraft.deviationReason) + '</textarea>'
        + '<p class="hint">只记录为什么仍要发布；与高级区同一个字段，填写后重新预览确认。</p></div>'
      : "";
    var coverageLine = (!c.demandsTotal && !c.workItemsTotal)
      ? '本版本范围：还没有纳入版本的需求或工作项，先规划版本范围'
      : '本版本范围：需求级覆盖 ' + esc(c.demandsCovered) + '/' + esc(c.demandsTotal) + '（需求下至少 1 条用例，已驳回 / 取消的需求不计）'
        + ' · 工作项级覆盖 ' + esc(c.workItemsCovered) + '/' + esc(c.workItemsTotal) + '（用例已关联到工作项）'
        + (c.planId ? '' : ' · 未关联计划，覆盖分母取版本范围');
    return '<section class="release-check is-' + esc(c.verdict || "pass") + '"><h4>发布检查 <span class="tag ' + meta[1] + '">' + meta[0] + '</span></h4>'
      + '<p class="hint">' + policyHint + ' · 检查于 ' + esc(fmtReleaseTime(c.checkedAt)) + ' · 只读汇总，不改变用例结果</p>'
      + '<p class="release-text">测试计划用例 ' + esc(c.caseTotal) + ' 条：通过 ' + esc(c.casePassed) + ' · 失败 ' + esc(c.caseFailed)
        + ' · 阻塞 ' + esc(c.caseBlocked) + ' · 跳过 ' + esc(c.caseSkipped) + ' · 未执行 ' + esc(c.caseUntested) + '</p>'
      + '<p class="release-text">' + requiredLine + '</p>'
      + '<p class="hint">' + coverageLine + '</p>'
      + checkSetList(c.caseSets)
      + (c.blockers && c.blockers.length ? '<p class="release-error">阻断：' + c.blockers.map(function(x){ return esc(x); }).join("；") + '</p>' : "")
      + (c.reminders && c.reminders.length ? '<p class="hint">提醒：' + c.reminders.map(function(x){ return esc(x); }).join("；") + '</p>' : "")
      + (c.requiredFailures && c.requiredFailures.length ? '<p class="release-text">失败的发布必测</p>' + checkCaseList(c.requiredFailures, "失败 / 阻塞") : "")
      + (c.requiredUnexecuted && c.requiredUnexecuted.length ? '<p class="release-text">未完成的发布必测</p>' + checkCaseList(c.requiredUnexecuted, "未执行 / 跳过") : "")
      + riskReason
      + (c.verdict === "block" && actualDraft.result !== "success" ? '<p class="release-readiness is-warn" role="status">存在阻断项：检查证据会随记录冻结；本次为失败记录，不要求填写原因。</p>' : "")
      + '</section>';
  }
  function renderCheck(){
    var host = layer.querySelector("[data-release-check-host]");
    if(host) host.innerHTML = checkPanelHTML();
    syncPlanCoverage();
  }
  /* 检查是异步的：计划页标题不重绘，只就地更新覆盖进度，避免打断表单输入 */
  function syncPlanCoverage(){
    var el = layer.querySelector("[data-plan-check-coverage]");
    if(!el) return;
    var p = selectedPlan();
    el.textContent = releaseCheck && p && p.id && releaseCheck.planId === p.id
      ? " · 本版本已覆盖工作项 " + releaseCheck.workItemsCovered + "/" + releaseCheck.workItemsTotal
      : "";
  }
  function loadCheck(){
    if(!mayPublish && !mayManage) return;
    if(pending || storageError){ releaseCheck = null; checkLoading = false; renderCheck(); return; }
    var seq = ++checkSeq, planned = actualDraft.planId || "";
    checkLoading = true; releaseCheck = null; renderCheck(); syncControls(); syncAdvanced();
    API.get(base + "/release-check", planned ? {planId:planned} : null).then(function(rs){
      if(!current() || seq !== checkSeq) return;
      checkLoading = false; releaseCheck = rs || null; renderCheck(); syncControls(); syncAdvanced();
    }).catch(function(ex){
      if(!current() || seq !== checkSeq) return;
      checkLoading = false; releaseCheck = null;
      var host = layer.querySelector("[data-release-check-host]");
      if(host) host.innerHTML = '<section class="release-check"><h4>发布检查</h4><p class="release-error" role="alert">加载失败：' + esc(ex.message || "请稍后重试") + '</p></section>';
      syncPlanCoverage();
      syncControls(); syncAdvanced();
    });
  }
  function openCheckCase(caseId){
    var projectId = reqId;
    /* 页面模式下由路由切换负责收掉工作台；用例仍按同一入口打开 */
    import("./testcases.js").then(function(m){
      showView("testcases");
      m.setTcMode("cases");
      return m.openCaseInProject(projectId, caseId);
    }).catch(function(ex){ toast(ex.message || "打开用例失败", "bad"); });
  }
  function render(){
    if(releasePickerRef && UI.popOpen(releasePickerRef.el)){ releasePickerRef.close(); }
    releasePickerRef = null;
    if(pending){
      var old = pending.body;
      Object.keys(actualDraft).forEach(function(k){ actualDraft[k] = k === "actualTaskIds" ? normalizedIds(old[k]) : k === "targetKeys" ? normalizedIds(old[k]).join('\n') : k === "occurredAt" ? localMinute(old[k]) : old[k] || ""; });
    }
    var p = selectedPlan() || {}, a = actualDraft, locked = !mayManage || p.status === "completed" || !!pending || !!storageError, disabled = locked ? ' disabled' : '';
    if(activeTab === "actual" && !mayPublish) activeTab = "plan";
    var envs = [["production", "生产"], ["staging", "预发布"], ["test", "测试"]], coverage = [["full", "全量"], ["partial", "部分"], ["unknown", "覆盖未知"]];
    var planChoices = plans.map(function(item){ return [item.id, planOptionShort(item)]; });
    var references = records.filter(function(r){ return r.environment === a.environment && r.operation !== "rollback" && (a.operation === "rollback" ? r.result === "success" : r.result === "failed" || r.result === "success"); });
    var actualDisabled = pending || storageError ? ' disabled' : '';
    var contentTasks = tasks.filter(function(t){ return taskVersionIds(t).indexOf(id) !== -1; });
    var planCoverage = releaseCheck && p.id && releaseCheck.planId === p.id
      ? ' · 本版本已覆盖工作项 ' + releaseCheck.workItemsCovered + '/' + releaseCheck.workItemsTotal
      : '';
    var planCoverageHTML = '<span data-plan-check-coverage>' + esc(planCoverage) + '</span>';
    var planSection = '<section class="release-section"><h3>发布计划</h3><div class="row row-gap"><select data-plan-select aria-label="选择独立发布计划"' + (pending ? ' disabled' : '') + '>' + options([["", "新独立计划"]].concat(planChoices), planId || "") + '</select>' + (mayManage ? '<button class="btn sm" data-plan-new type="button">新建独立计划</button>' : '') + '</div><p class="hint">计划 ' + esc(p.id ? (releasePlanNoText(p.planNo) || ("#" + p.id)) : "未保存") + ' · 修订 ' + esc(p.revision || "—") + ' · ' + esc(releaseStatusName(p.status)) + ' · ' + esc(releaseEnvironmentName(p.environment || "production")) + ' · ' + esc(coverageName(p.coverage || "full")) + ' · ' + esc(planWhen(p)) + (p.versionCount > 1 ? ' · ' + esc(p.versionCount) + ' 个版本（已完成 ' + esc(p.releasedVersionCount || 0) + '）' : '') + '。计划只描述打算怎么发，不改变实际交付事实；已完成计划不可修改。</p>'
      + '<div class="form-grid">' + field("计划发布时间（本地）", '<input type="datetime-local" step="60" data-plan-planned value="' + esc(p.plannedAt ? localMinute(p.plannedAt) : "") + '"' + disabled + '>', "计划发布的时间，使用本地时间；只用于计划与偏差对比，不代表实际发生时间。")
        + field("计划负责人", releaseOwnerControl("plan", p.ownerUserId || "", disabled), "计划的责任人，可与实际执行人不同。")
        + field("计划环境", '<select data-plan-environment' + disabled + '>' + options(envs, p.environment || "production") + '</select>', "计划面向的环境；实际环境不同会在预检中记为偏差，需要填写原因。")
        + field("计划覆盖", '<select data-plan-coverage' + disabled + '>' + options(coverage, p.coverage || "full") + '</select>', "计划覆盖范围：全量、部分或覆盖未知；与实际覆盖一致才不构成偏差。") + '</div>'
      + heading('计划包含的版本（<span data-plan-version-count>' + planVersionSelection().length + '</span> 个 · <span data-plan-version-project-count>' + planSelectionProjects(planVersionSelection()) + '</span> 个项目）', "可跨版本、跨项目选择；当前版本固定包含。计划包含的所有版本都完成生产部署 / 重部署后，计划才自动完成。") + '<div data-plan-version-host>' + planVersionPicker(locked) + '</div>'
      + field("计划目标键（每行一个）", '<textarea data-plan-targets placeholder="如 prod-shanghai-a，每行一个"' + disabled + '>' + esc(normalizedIds(p.targetKeys).join('\n')) + '</textarea>', "计划影响的部署目标或服务键，每行一个；与实际目标键一致才不构成偏差。")
      + heading('这次计划发布哪些工作项（<span data-plan-task-count>' + normalizedIds(p.plannedTaskIds).length + '</span> 项' + planCoverageHTML + '）', "勾选这次计划发布的工作项；设为「就绪」时至少 1 项。实际记录会独立选择，不自动继承计划范围。") + taskRows("plan", normalizedIds(p.plannedTaskIds), locked)
      + '<div data-plan-sync-host></div>'
      + '<div data-plan-branches-host></div>'
      + (!locked ? '<p class="release-readiness" data-plan-readiness></p>' : '')
      + field("计划说明", '<textarea data-plan-notes maxlength="2000"' + disabled + '>' + esc(p.notes || "") + '</textarea>')
      + field("风险与回滚方案", '<textarea data-plan-risks maxlength="1000"' + disabled + '>' + esc(p.risks || "") + '</textarea>', "建议写清回滚命令、数据兼容处理和回滚后的验证步骤。")
      + field("计划状态", '<select data-plan-status' + disabled + '>' + options([["draft", "草稿"], ["ready", "就绪"], ["canceled", "取消"]].concat(p.status === "completed" ? [["completed", "已完成（只读）"]] : []), p.status || "draft") + '</select>', "只有「就绪」计划可被实际记录直接引用；就绪需要计划时间、负责人、至少 1 个工作项和目标键。草稿、取消或已完成会触发偏差校验，需要填写理由。")
      + (!locked ? field("新建 / 修改理由", '<input data-plan-reason maxlength="500" placeholder="说明为什么新建或修改此计划">', "", true) + '<p class="release-error" data-plan-error role="alert"></p><button class="btn sm primary" data-release-save type="button">' + (p.id ? '保存此计划' : '新建独立计划') + '</button>' : '<p class="hint">此计划只读</p>') + '</section>';
    var actualSection = mayPublish ? '<section class="release-section"><h3>实际发布事实</h3><p class="release-guide">记录顺序：发生时间 → 执行人 → 制品与 SHA256 → 目标键 → 勾选实际交付项，然后预览并确认。</p><p class="release-readiness" data-actual-readiness></p><p class="hint">只填本次真实发生的交付。覆盖、操作、关联事件与失败原因收在高级区，异常时自动展开；失败、测试和回滚记录不等于生产生效。</p><div class="form-grid">'
        + field("本次关联计划", '<select data-release-planId' + actualDisabled + '>' + actualPlanOptions(a) + '</select>', "关联计划用于预检对比；无计划即紧急记录。环境或状态不一致的计划仍可选择，但必须填写原因。", false, planSummaryHTML(a))
        + field("实际发生时间（本地）", '<input type="datetime-local" step="60" data-release-occurredAt value="' + esc(a.occurredAt) + '"' + actualDisabled + '>', "真实发生时间，不能晚于当前时间；与计划时间不同需填写原因。", true)
        + field("实际环境", '<select data-release-environment' + actualDisabled + '>' + options(envs, a.environment) + '</select>', "真实发布环境；与计划环境不同需填写原因。")
        + field("实际结果", '<select data-release-result' + actualDisabled + '>' + options([["success", "成功"], ["failed", "失败"]], a.result) + '</select>', "记录本次真实结果；失败必须填写失败原因。") + '</div>'
        + '<div data-release-check-host></div>'
        + '<div class="form-grid">' + field("实际执行人（独立于记录人）", releaseOwnerControl("actual", a.executorUserId, actualDisabled), "实际执行发布的人，独立于记录人。", true)
        + field("制品标识", '<input type="text" data-release-artifactRef maxlength="500" placeholder="如 hourglass-server.jar#8b44737" value="' + esc(a.artifactRef) + '"' + actualDisabled + '>', "可识别的制品名或构建号，例如 jar 名 + 提交号；不要用普通版本名代替制品证据。", true)
        + field("SHA256", '<input type="text" data-release-artifactDigest maxlength="64" placeholder="64 位十六进制" value="' + esc(a.artifactDigest) + '"' + actualDisabled + '>', "制品文件的 SHA256，只能填 64 位十六进制；用于证明部署的是同一制品。", true) + '</div>'
        + field("实际目标键（每行一个）", '<textarea data-release-targetKeys placeholder="如 prod-shanghai-a，每行一个"' + actualDisabled + '>' + esc(a.targetKeys) + '</textarea>', "本次实际涉及的部署目标或服务键，每行一个；回滚时必须是引用事件目标的子集。", true)
        + heading("本次实际交付哪些工作项（与计划分别保存）", "只勾选本次真实交付的工作项，至少 1 项；未完成项会触发预检，需要填写原因。") + taskRows("actual", a.actualTaskIds, !!actualDisabled)
        + '<details class="release-advanced" data-release-advanced' + (advancedOpen ? ' open' : '') + '><summary>高级与异常字段 <span class="mute" data-release-advanced-summary></span></summary><div class="form-grid">'
        + field("实际覆盖", '<select data-release-coverage' + actualDisabled + '>' + options(coverage, a.coverage) + '</select>', "本次实际覆盖范围；与计划覆盖不同需填写原因。")
        + field("操作", '<select data-release-operation' + actualDisabled + '>' + options([["deploy", "部署"], ["redeploy", "重部署 / 失败重试"], ["rollback", "回滚"]], a.operation) + '</select>', "部署 / 重部署 / 回滚；回滚必须引用成功事件，范围须为子集。")
        + field("关联正式事件", '<select data-release-relatedReleaseId' + actualDisabled + '>' + options([["", "请选择（回滚必填）"]].concat(references.map(function(r){ return [r.id, (releaseNoText(r.releaseNo) || "#" + r.id) + " · " + r.result + " · " + releaseOperationName(r.operation) + " · " + fmtReleaseTime(r.occurredAt)]; })), a.relatedReleaseId) + '</select>', "回滚必填；只能引用同环境的成功正式事件，选项随环境与操作过滤。") + '</div>'
        + field("未按计划发布的原因", '<textarea data-release-deviationReason maxlength="1000" placeholder="例如：环境临时切换 / 客户紧急窗口 / 计划内 2 项未完成"' + actualDisabled + '>' + esc(a.deviationReason) + '</textarea>', "无计划、环境 / 覆盖 / 范围 / 时间与计划不一致、包含未完成项或发布检查有阻断项时必填；只记录事实，不改写工作项状态。")
        + field("实际说明", '<textarea data-release-notes maxlength="2000"' + actualDisabled + '>' + esc(a.notes) + '</textarea>')
        + field("失败原因（失败时必填）", '<textarea data-release-failureReason maxlength="1000" placeholder="记录失败时必填，说明失败环节与现象"' + actualDisabled + '>' + esc(a.failureReason) + '</textarea>', "实际结果为失败时必须填写失败环节与现象。", a.result === "failed") + '</details>'
        + '<p class="release-error" data-actual-error role="alert"></p><button class="btn sm" data-release-preview type="button">预览本次范围与预检结果</button><div data-release-scope><p class="hint">尚未预览。预览会分别列出本次实际范围与计划未选入的项，两边都保留。</p></div><button class="btn primary" data-release-confirm type="button" disabled>确认记录本次事实</button></section>' : '';
    var historySection = '<section class="release-section"><h3>发布历史</h3><div class="row row-gap"><select data-history-result aria-label="历史结果">' + options([["", "全部结果"], ["published", "已发布（生产成功，不含回滚）"], ["success", "全部成功（含测试 / 回滚）"], ["failed", "失败"]], filters.result) + '</select><select data-history-environment aria-label="历史环境">' + options([["", "全部环境"]].concat(envs), filters.environment) + '</select><select data-history-operation aria-label="历史操作">' + options([["", "全部操作"], ["deploy", "部署"], ["redeploy", "重部署"], ["rollback", "回滚"]], filters.operation) + '</select></div><div data-release-record-list></div><div class="row row-gap"><button class="btn sm" data-history-prev type="button">上一页</button><span class="hint" data-history-count></span><button class="btn sm" data-history-next type="button">下一页</button></div></section>';
    var versionLogSection = '<section class="release-section"><h3>版本操作记录</h3><p class="hint">创建、编辑、开始、关闭 / 取消与范围调整的留痕；与上面的正式发布记录分开，后者只记真实部署事实。</p><div data-version-log><p class="hint">加载中…</p></div></section>';
    var contentSection = '<section class="release-section"><h3>版本内容</h3><p class="hint">目标就绪日：' + esc(v.targetDate || "未设置") + '。版本内容不等于计划范围，更不等于实际发布范围。' + (versionContentLocked(v) ? '已有成功正式发布，内容范围只读；可创建新计划和独立事件。' : '') + '</p><ul class="release-scope">' + contentTasks.map(function(t){ return '<li>' + esc(t.title) + ' · ' + esc(colName(t.boardColumn)) + ' ' + taskPublicationHTML(t) + '</li>'; }).join('') + '</ul></section>';
    var banner = planJustSaved ? '<div class="release-next" data-release-next><span>计划已保存' + (planSavedRevision != null ? '（修订 ' + esc(planSavedRevision) + '）' : '') + '。下一步：记录本次实际发布。</span><button class="btn sm primary" type="button" data-release-goto-actual>去记录实际发布</button></div>' : '';
    dlg.body.innerHTML = '<p class="release-error" data-release-error role="alert"></p><div class="release-topbar"><div class="release-tabs" role="tablist" aria-label="发布工作区">'
      + tabButton("plan", "计划", plans.length)
      + (mayPublish ? tabButton("actual", "实际", a.actualTaskIds.length) : '')
      + tabButton("history", "历史", records.length)
      + tabButton("content", "内容", contentTasks.length)
      + '</div><button class="btn sm" data-release-refresh type="button">刷新</button></div>'
      + banner
      + (recoveryMessage || storageError ? '<section class="release-section"><h3>请求恢复</h3><p class="release-text">' + esc(storageError || recoveryMessage) + '</p>' + (recoveredRecord ? releaseRecordHTML(recoveredRecord) : '') + '</section>' : '')
      + (pending ? '<section class="release-section"><h3>原请求待确认</h3><p class="hint">键：' + esc(pending.body.idempotencyKey) + ' · ' + esc(releaseEnvironmentName(pending.body.environment)) + ' · ' + esc(releaseOperationName(pending.body.operation)) + ' · ' + esc(fmtReleaseTime(pending.body.occurredAt)) + ' · 明确选择 ' + esc(pending.body.actualTaskIds.length) + ' 项</p><button class="btn sm" data-release-reconcile type="button">查询原键</button> ' + (mayPublish ? '<button class="btn sm primary" data-release-retry type="button">重试原完整请求 / 原键</button> ' : '') + (pending.rejection ? '<button class="btn sm danger" data-release-reset type="button">明确重置已拒绝请求</button>' : '') + '</section>' : '')
      + '<div class="release-panel" role="tabpanel" id="release-panel-plan" aria-labelledby="release-tab-plan" data-release-panel="plan"' + (activeTab === "plan" ? '' : ' hidden') + '>' + planSection + '</div>'
      + (mayPublish ? '<div class="release-panel" role="tabpanel" id="release-panel-actual" aria-labelledby="release-tab-actual" data-release-panel="actual"' + (activeTab === "actual" ? '' : ' hidden') + '>' + actualSection + '</div>' : '')
      + '<div class="release-panel" role="tabpanel" id="release-panel-history" aria-labelledby="release-tab-history" data-release-panel="history"' + (activeTab === "history" ? '' : ' hidden') + '>' + historySection + versionLogSection + '</div>'
      + '<div class="release-panel" role="tabpanel" id="release-panel-content" aria-labelledby="release-tab-content" data-release-panel="content"' + (activeTab === "content" ? '' : ' hidden') + '>' + contentSection + '</div>';
    renderHistory(); renderVersionLog(); renderCheck(); syncControls(); syncAdvanced(); updateChecklists(); refreshPlanBranches(); filterPicker("plan"); filterPicker("actual"); error(storageError); UI.wireTooltips(dlg.body);
    if(restoreScroll != null){ dlg.scrollTo(restoreScroll); restoreScroll = null; }
    if(entryFocus){ entryFocus = false; focusActual(); }
    if(mayManage && activeTab === "plan") ensurePlanTaskPool();
    if(mayManage && activeTab === "plan") maybeOfferPlanDraft();
  }
  function load(){
    if(busy || !current()) return;
    if(layer.querySelector('[data-release-occurredAt]') && !pending) readActual();
    var seq = ++loadSeq; invalidatePreview(); setBusy(true); dlg.body.innerHTML = UI.skeletonRows(3);
    reconcile().then(function(){
      if(!current() || seq !== loadSeq) throw new Error("stale");
      return API.get("/api/versions", {reqId:reqId});
    }).then(function(vs){
      if(!current() || seq !== loadSeq) throw new Error("stale");
      v = vs.find(function(item){ return item.id === id; }); if(!v) throw new Error("版本已变化或不可见");
      mayManage = v.canManageReleasePlan === true; mayPublish = v.canPublish === true;
      if(cache && rt.phaseReqId === reqId) cache.versions = vs;
      versionOptionsCache[reqId] = vs;
      return Promise.all([API.get(base + "/release-plans"), API.get(base + "/release-records", {limit:200}), API.get("/api/versions/task-options", {reqId:reqId}), mayManage || mayPublish ? API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/members") : Promise.resolve([]), mayManage ? API.get("/api/release-plan-options").catch(function(){ return null; }) : Promise.resolve(null)]);
    }).then(function(rs){
      if(!current() || seq !== loadSeq) return;
      plans = rs[0] || []; records = (rs[1] || []).slice(0, 200); tasks = rs[2] || []; members = rs[3] || [];
      if(rs[4]) planOptions = rs[4];
      planScopeVersionIds = presetPlanVersionIds ? normalizedIds(presetPlanVersionIds.concat(id)) : null;
      presetPlanVersionIds = null;
      planTaskPoolCache = {}; planTaskFetchKey = ""; planTaskErrorKey = ""; planTaskSeq++;
      taskOptionsCache[reqId] = tasks; if(cache && rt.phaseReqId === reqId) cache.tasks = tasks;
      if(planId === null) planId = opts.forceNewPlan ? "" : (plans.length ? plans[0].id : "");
      if(planId && !plans.some(function(p){ return p.id === planId; })) planId = "";
      /* 首次进入实际记录面：自动带出匹配版本与环境的就绪计划，避免误记成紧急发布 */
      if(!pending && !storageError && !actualPlanTouched && !actualDraft.planId) actualDraft.planId = preferredActualPlanId();
      /* 刷新 / 重新加载时重新拉版本操作记录，避免展示过期列表 */
      verLog = {id:null, rows:[], error:""}; verLogSeq++;
      /* 工具栏在释放容器外：重画 body 前必须先解禁，否则「刷新 / 返回版本」会一直停在被禁用状态 */
      setBusy(false); render(); loadCheck();
    }).catch(function(ex){
      if(!current() || seq !== loadSeq) return;
      setBusy(false); retryAllowed = false;
      dlg.body.innerHTML = '<p class="release-error" role="alert">' + esc(ex.message || "加载失败；旧请求仍保留") + '</p><button class="btn" data-release-refresh type="button">重新查询 / 加载</button>';
    });
  }
  function validate(b){
    if(!b.occurredAt || new Date(b.occurredAt).getTime() > Date.now()) return "请填写不晚于当前时间的实际发生时间";
    if(!b.artifactRef || !/^[a-f0-9]{64}$/.test(b.artifactDigest)) return "制品标识和 64 位 SHA256 必填";
    if(!b.executorUserId || !members.some(function(m){ return (m.userId || m.id) === b.executorUserId; })) return "请选择当前成员作为独立实际执行人";
    if(!b.actualTaskIds.length || !b.targetKeys.length) return "请明确选择实际工作项和至少一个目标键";
    if(b.result === "failed" && !b.failureReason) return "记录失败必须填写失败原因（展开「高级与异常字段」）";
    var p = plans.find(function(p){ return p.id === b.planId; });
    var anomaly = !p || p.status !== "ready" || p.environment !== b.environment || p.coverage !== b.coverage || !sameIds(p.targetKeys, b.targetKeys) || !sameIds(p.plannedTaskIds, b.actualTaskIds) || utc(localMinute(p.plannedAt)) !== b.occurredAt;
    if(b.actualTaskIds.some(function(tid){ var t = tasks.find(function(t){ return t.id === tid; }); return !t || t.boardColumn !== "done" || (t.completedAt && new Date(t.completedAt).getTime() > new Date(b.occurredAt).getTime()); })) anomaly = true;
    if(anomaly && !b.deviationReason) return "无计划、计划偏差、未完成或完成日期异常须填写「未按计划发布的原因」（展开「高级与异常字段」），不会伪造完成记录";
    if(b.result === "success" && releaseCheck && releaseCheck.verdict === "block" && !String(b.deviationReason || "").trim()) return "发布检查存在阻断项：成功发布须填写「未按计划发布的原因」";
    var ref = records.find(function(r){ return r.id === b.relatedReleaseId; });
    if(b.relatedReleaseId && (!ref || ref.environment !== b.environment || ref.operation === "rollback")) return "请选择同环境可引用的正式事件";
    if(b.operation === "rollback"){
      if(!ref || ref.result !== "success") return "回滚必须引用成功部署 / 重部署事件";
      if(b.actualTaskIds.some(function(tid){ return recordTaskIds(ref).indexOf(tid) === -1; }) || b.targetKeys.some(function(key){ return normalizedIds(ref.targetKeys).indexOf(key) === -1; })) return "回滚范围与目标必须是被引用成功事件的子集";
    }
    return "";
  }
  function runPreview(){
    if(busy || !mayPublish || !current()) return;
    setBusy(true); error("", "actual");
    reconcile().then(function(){
      if(!current()) return;
      if(pending || storageError){ setBusy(false); render(); error(recoveryMessage || storageError); return; }
      if(planDirty()){ setBusy(false); error("计划有未保存改动，请保存或放弃后预览", "actual"); return; }
      var b = context(), msg = validate(b);
      if(msg){ setBusy(false); error(msg, "actual"); return; }
      invalidatePreview(); var seq = ++previewSeq, fingerprint = JSON.stringify(b);
      return API.post(base + "/release-preview", b).then(function(rs){
        if(!current() || seq !== previewSeq) return;
        setBusy(false);
        if(fingerprint !== JSON.stringify(context()) || planDirty()){ invalidatePreview(); return; }
        if(!rs.scopeToken){ error("预览未返回范围令牌，不能确认", "actual"); return; }
        preview = rs; previewContext = fingerprint;
        /* 预览内的检查与确认时重新计算同源；先展示它，避免拿旧计划的结论做判断 */
        if(rs.testCheck){ releaseCheck = rs.testCheck; renderCheck(); syncControls(); }
        if(rs.requiresDeviationReason){ advancedOpen = true; var adv = layer.querySelector("[data-release-advanced]"); if(adv) adv.open = true; }
        var actualPlan = plans.find(function(p){ return p.id === b.planId; });
        var omittedIds = normalizedIds(rs.plannedTaskIds || (actualPlan || {}).plannedTaskIds).filter(function(tid){ return b.actualTaskIds.indexOf(tid) === -1; });
        function scopeTask(tid){
          var excluded = (rs.excluded || []).find(function(x){ return ((x.task || {}).id || x.taskId) === tid; });
          var t = tasks.find(function(t){ return t.id === tid; }) || (excluded || {}).task || {};
          return '<li>' + esc(t.title || tid) + ' · ' + esc(colName(t.boardColumn || "snapshot")) + ' · 完成 ' + esc(fmtReleaseTime(t.completedAt)) + '</li>';
        }
        layer.querySelector('[data-release-scope]').innerHTML = '<h4>本次明确选择 ' + b.actualTaskIds.length + ' 项 · 计划未选入 ' + omittedIds.length + ' 项</h4><p class="hint">预检不改写实际选择；事实异常需理由。环境 ' + esc(releaseEnvironmentName(b.environment)) + ' · 目标 ' + esc(b.targetKeys.join('、')) + ' · ' + esc(fmtReleaseTime(b.occurredAt)) + '</p>'
          + '<h4>明确实际范围（selected）</h4><ul class="release-scope">' + b.actualTaskIds.map(scopeTask).join('') + '</ul>'
          + '<h4>计划未选入本次事实（omitted）</h4>' + (omittedIds.length ? '<ul class="release-scope">' + omittedIds.map(scopeTask).join('') + '</ul>' : '<p class="hint">无计划遗漏项</p>')
          + '<h4>预检提示（不改变工作状态）</h4>' + (rs.warnings || []).map(function(w){ return '<p class="hint">' + esc(typeof w === "string" ? w : JSON.stringify(w)) + '</p>'; }).join('')
          + '<ul class="release-scope">' + (rs.excluded || []).filter(function(x){ return omittedIds.indexOf((x.task || {}).id || x.taskId) === -1; }).map(function(x){ return '<li>预检异常：' + esc((x.task || {}).title || x.title || x.taskId || "—") + ' · ' + esc(x.reason || x.disposition || "—") + '</li>'; }).join('') + '</ul>';
        syncControls();
      });
    }).catch(function(ex){ if(current()){ setBusy(false); invalidatePreview(); error(ex.message || "查询 / 预览失败，待确认请求仍保留", "actual"); } });
  }
  function sendPending(){
    if(!pending || pending.rejection || !mayPublish || !current()) return;
    var sent = pending, body = sent.body;
    setBusy(true); error("", "actual");
    API.post(base + "/release", body).then(function(record){
      recoveredRecord = record; recoveryMessage = "已记录正式事件 " + (releaseNoText(record.releaseNo) || "#" + record.id) + "（" + record.result + "）。";
      persist(null, body.idempotencyKey); retryAllowed = false;
      if(!current()) return;
      setBusy(false); invalidatePreview(); invalidateVersionCache(reqId); notifyDeliveryChanged(reqId); reloadFilteredViews();
      actualDraft.actualTaskIds = []; actualDraft.artifactRef = ""; actualDraft.artifactDigest = "";
      toast("已记录" + releaseEnvironmentName(record.environment) + " · " + releaseOperationName(record.operation) + " · " + (record.result === "success" ? "成功" : "失败"), "fs"); render(); load();
    }).catch(function(ex){
      /* 409 / 参数或权限拒绝是已知未接受；其余响应（含超时、非 JSON、5xx）仍可能已落库。 */
      if([400, 403, 404, 409, 422].indexOf(ex.code) !== -1){ sent.rejection = ex.message || "服务端明确拒绝"; persist(sent, body.idempotencyKey); retryAllowed = false; recoveryMessage = "请求已明确拒绝，请先查询原键，再显式重置后重新预览。"; }
      else { retryAllowed = false; recoveryMessage = "响应不确定；完整原请求与原键已保留。必须先查询原键，不会自动创建新事件。"; }
      if(current()){ setBusy(false); render(); error(recoveryMessage + " " + (ex.message || "")); }
    });
  }
  function refreshActualReferences(){
    var a = actualDraft;
    var refs = records.filter(function(r){ return r.environment === a.environment && r.operation !== "rollback" && (a.operation === "rollback" ? r.result === "success" : r.result === "failed" || r.result === "success"); });
    var select = layer.querySelector('[data-release-relatedReleaseId]');
    if(select) select.innerHTML = options([["", "请选择（回滚必填）"]].concat(refs.map(function(r){ return [r.id, (releaseNoText(r.releaseNo) || "#" + r.id) + " · " + r.result + " · " + releaseOperationName(r.operation) + " · " + fmtReleaseTime(r.occurredAt)]; })), a.relatedReleaseId);
    var planSelect = layer.querySelector('[data-release-planId]');
    if(planSelect) planSelect.innerHTML = actualPlanOptions(a);
    var summary = layer.querySelector('[data-release-plan-summary]');
    if(summary){
      var info = planSummaryInfo(a);
      summary.textContent = info.text;
      summary.classList.toggle("is-warn", info.warn);
    }
    var pick = layer.querySelector('[data-actual-picker]');
    if(pick) pick.outerHTML = taskRows("actual", a.actualTaskIds, false);
  }
  function changed(e){
    if(busy || !current()) return;
    /* 检查面板内联的理由与高级区是同一字段，双向镜像，避免读回时互相覆盖 */
    if(e.target.matches('[data-release-inlineReason]')){
      var mirror = layer.querySelector('[data-release-deviationReason]');
      if(mirror) mirror.value = e.target.value;
    }
    if(e.target.matches('[data-release-deviationReason]')){
      var inline = layer.querySelector('[data-release-inlineReason]');
      if(inline) inline.value = e.target.value;
    }
    if(e.target.matches('[data-history-result], [data-history-environment], [data-history-operation]')){
      filters = {result:value("history", "result"), environment:value("history", "environment"), operation:value("history", "operation")}; page = 0; renderHistory(); return;
    }
    if(e.target.matches('[data-plan-group-all], [data-actual-group-all]')){
      if(e.type !== "change") return;
      var allPrefix = e.target.hasAttribute("data-actual-group-all") ? "actual" : "plan";
      groupPick(allPrefix, e.target.getAttribute("data-" + allPrefix + "-group-all"), e.target.checked);
      return;
    }
    if(e.target.matches('[data-plan-search], [data-plan-filter], [data-plan-pub], [data-plan-scope], [data-actual-search], [data-actual-filter], [data-actual-pub], [data-actual-scope]')){
      var pickPrefix = e.target.matches('[data-plan-search], [data-plan-filter], [data-plan-pub], [data-plan-scope]') ? "plan" : "actual";
      var pst = pickerSt(pickPrefix);
      if(e.target.matches('[data-plan-search], [data-actual-search]')) pst.q = e.target.value;
      else if(e.target.matches('[data-plan-filter], [data-actual-filter]')) pst.state = e.target.value;
      else if(e.target.matches('[data-plan-pub], [data-actual-pub]')) pst.pub = e.target.value;
      else pst.scope = e.target.value;
      filterPicker(pickPrefix);
      return;
    }
    if(e.target.matches('[data-plan-group], [data-actual-group]')){
      /* select 的 input 与 change 都会进来，只按 change 重建一次 */
      if(e.type !== "change") return;
      var groupPrefix = e.target.matches('[data-plan-group]') ? "plan" : "actual";
      pickerSt(groupPrefix).group = e.target.value;
      rerenderPicker(groupPrefix);
      var nextGroup = pickerBox(groupPrefix) && pickerBox(groupPrefix).querySelector('[data-' + groupPrefix + '-group]');
      if(nextGroup){ try{ nextGroup.focus({preventScroll:true}); }catch(ex){ /* noop */ } }
      return;
    }
    if(e.target.matches('[data-plan-version-search]')){
      if(e.type !== "input") return;
      planVersionQuery = e.target.value;
      rerenderPlanVersionPicker();
      return;
    }
    if(pending || storageError) return;
    if(e.target.matches('[data-plan-select]')){
      var sel = e.target, nextPlan = sel.value;
      confirmDiscardPlan(function(){ readActual(); planId = nextPlan; planJustSaved = false; planScopeVersionIds = null; planVersionQuery = ""; planTaskFetchKey = ""; planTaskErrorKey = ""; invalidatePreview(); render(); }, function(){ sel.value = planId || ""; });
      return;
    }
    if(e.target.matches('[data-plan-version]')){
      var selectedVersions = Array.from(layer.querySelectorAll('[data-plan-version]:checked')).map(function(el){ return el.getAttribute('data-plan-version'); });
      planScopeVersionIds = normalizedIds(selectedVersions.concat(id));
      layer.querySelectorAll('.release-version-row').forEach(function(row){
        var cb = row.querySelector('[data-plan-version]');
        row.classList.toggle('is-selected', !!(cb && cb.checked));
      });
      syncPlanVersionMeta();
      dropSavedBanner(); error("", "plan"); invalidatePreview();
      rerenderPlanPicker(false); ensurePlanTaskPool(); refreshPlanBranches(); updateChecklists();
      return;
    }
    if(e.target.matches('input,select,textarea')){
      var scope = e.target.closest('[data-release-panel="plan"]') ? "plan" : e.target.closest('[data-release-panel="actual"]') ? "actual" : "";
      if(scope){ error("", scope); if(scope === "plan"){ dropSavedBanner(); dismissPlanDraftBanner(); schedulePlanDraft(); } }
      /* 用户亲自选过计划（含“无计划”）后，环境变化或重绘都不再自动改选 */
      if(e.target.matches('[data-release-planId]')) actualPlanTouched = true;
      readActual(); invalidatePreview(); syncAdvanced();
      if(e.target.matches('[data-actual-task]')) filterPicker("actual");
      if(e.target.matches('[data-plan-task]')){ filterPicker("plan"); refreshPlanBranches(); }
      updateChecklists();
      /* 计划面边填边校验「就绪」必填项；非就绪状态不清空其它提示 */
      if(scope === "plan") validatePlanReady();
      if(e.target.matches('[data-release-operation], [data-release-environment], [data-release-coverage], [data-release-relatedReleaseId], [data-release-planId]')){
        if(e.target.matches('[data-release-operation], [data-release-environment]')) actualDraft.relatedReleaseId = "";
        refreshActualReferences();
        if(e.target.matches('[data-release-planId]')) loadCheck();
      }
    }
  }
  layer.addEventListener("input", changed); layer.addEventListener("change", changed);
  /* 失焦即时校验（P-FB-2）：计划理由必填，离开输入框即提示，不必等点保存才发现；
     其余计划字段失焦时顺带复检「就绪」必填项。只读 / 待确认 / 存储异常时不校验。 */
  layer.addEventListener("focusout", function(e){
    if(busy || !current() || planDraftLocked()) return;
    var t = e.target;
    if(!t || !t.matches || !t.closest || !t.closest('[data-release-panel="plan"]')) return;
    if(t.matches('[data-plan-reason]')){
      if(!t.value.trim()) error("保存前请填写新建 / 修改计划理由", "plan");
      return;
    }
    validatePlanReady();
  });
  layer.addEventListener("toggle", function(e){ if(e.target.matches && e.target.matches("[data-release-advanced]")) advancedOpen = e.target.open; }, true);
  layer.addEventListener("keydown", function(e){
    if(e.key === "Escape"){
      var openPrefix = pickerState.plan.expanded ? "plan" : pickerState.actual.expanded ? "actual" : "";
      if(openPrefix){ e.preventDefault(); setPickerExpanded(openPrefix, false); return; }
    }
    var tab = e.target.closest('[data-release-tab]');
    if(!tab || busy || !current()) return;
    var keys = Array.from(layer.querySelectorAll('[data-release-tab]')).map(function(b){ return b.getAttribute("data-release-tab"); });
    var i = keys.indexOf(tab.getAttribute("data-release-tab")), next = -1;
    if(e.key === "ArrowRight") next = (i + 1) % keys.length;
    else if(e.key === "ArrowLeft") next = (i - 1 + keys.length) % keys.length;
    else if(e.key === "Home") next = 0;
    else if(e.key === "End") next = keys.length - 1;
    if(next < 0 || !keys[next]) return;
    e.preventDefault();
    switchTab(keys[next], false);
    var to = layer.querySelector('[data-release-tab="' + keys[next] + '"]');
    if(to) to.focus();
  });
  layer.addEventListener("click", function(e){
    var checkCase = e.target.closest('[data-release-case]');
    if(checkCase){ confirmDiscardPlan(function(){ openCheckCase(checkCase.getAttribute("data-release-case")); }); return; }
    var exp = e.target.closest('[data-release-export]');
    if(exp){ var r = records.concat(recoveredRecord ? [recoveredRecord] : []).find(function(r){ return String(r.id) === exp.dataset.releaseExport; }); if(r) exportReleaseRecordCSV(r); return; }
    var dnote = e.target.closest('[data-release-delivery]');
    if(dnote){ openDeliveryNote(dnote.dataset.releaseDeliveryVersion, dnote.dataset.releaseDelivery); return; }
    var syncOpen = e.target.closest('[data-plan-sync-open]');
    if(syncOpen){
      /* 跳去分支抽屉要先关掉工作区：有未保存的计划修改时先确认，避免草稿被静默丢弃 */
      var syncBranchId = syncOpen.getAttribute("data-plan-sync-open");
      /* 页面模式下分支抽屉直接叠在工作台上，关闭后仍回发布计划，不再先退一层弹框 */
      confirmDiscardPlan(function(){ openBranchById(syncBranchId); });
      return;
    }
    if(e.target.closest('[data-plan-sync-close]')){ var syncHost = layer.querySelector("[data-plan-sync-host]"); if(syncHost) syncHost.innerHTML = ""; return; }
    if(busy || !current()) return;
    /* 放大态下点浮层以外的地方即收起；点浮层内部的空白不算「外部」 */
    var openPrefix = pickerState.plan.expanded ? "plan" : pickerState.actual.expanded ? "actual" : "";
    if(openPrefix){
      var openBox = pickerBox(openPrefix);
      if(!openBox || !openBox.contains(e.target)) setPickerExpanded(openPrefix, false);
    }
    var planOwnerBtn = e.target.closest('[data-plan-owner-btn]');
    if(planOwnerBtn){ if(!planOwnerBtn.disabled) openReleaseOwnerPicker(planOwnerBtn, "plan"); return; }
    var execBtn = e.target.closest('[data-release-executorUserId-btn]');
    if(execBtn){ if(!execBtn.disabled) openReleaseOwnerPicker(execBtn, "actual"); return; }
    var tab = e.target.closest('[data-release-tab]');
    if(tab){ switchTab(tab.getAttribute("data-release-tab"), false); return; }
    if(e.target.closest('[data-release-goto-actual]')){ switchTab("actual", true); return; }
    var expandBtn = e.target.closest('[data-plan-expand], [data-actual-expand]');
    if(expandBtn){
      var expandPrefix = expandBtn.hasAttribute("data-actual-expand") ? "actual" : "plan";
      setPickerExpanded(expandPrefix, !pickerSt(expandPrefix).expanded);
      return;
    }
    var groupToggle = e.target.closest('[data-plan-group-toggle], [data-actual-group-toggle]');
    if(groupToggle){
      var togglePrefix = groupToggle.hasAttribute("data-actual-group-toggle") ? "actual" : "plan";
      var toggleKey = groupToggle.getAttribute("data-" + togglePrefix + "-group-toggle");
      var toggleSt = pickerSt(togglePrefix);
      toggleSt.collapsed[toggleKey] = !toggleSt.collapsed[toggleKey];
      var section = groupToggle.closest("[data-task-group]");
      if(section){
        var groupBody = section.querySelector(".release-task-group-body");
        if(groupBody) groupBody.hidden = !!toggleSt.collapsed[toggleKey];
        section.classList.toggle("is-collapsed", !!toggleSt.collapsed[toggleKey]);
      }
      groupToggle.setAttribute("aria-expanded", toggleSt.collapsed[toggleKey] ? "false" : "true");
      return;
    }
    if(e.target.closest('[data-release-refresh], [data-release-reconcile]')){ planJustSaved = false; confirmDiscardPlan(load); return; }
    if(e.target.closest('[data-history-prev], [data-history-next]')){ page += e.target.closest('[data-history-prev]') ? -1 : 1; renderHistory(); return; }
    if(e.target.closest('[data-release-reset]')){
      if(!pending || !pending.rejection) return;
      var rejectedKey = pending.body.idempotencyKey;
      setBusy(true);
      reconcile().then(function(){
        if(!current()) return;
        setBusy(false);
        if(pending && pending.rejection && resetAllowed && pending.body.idempotencyKey === rejectedKey && persist(null, rejectedKey)){
          retryAllowed = false; resetAllowed = false; recoveryMessage = "已查询原键并明确重置被拒绝请求；请重新预览。"; invalidatePreview(); load();
        }else render();
      }).catch(function(ex){ if(current()){ setBusy(false); error(ex.message || "查询失败，被拒绝原请求仍保留"); } });
      return;
    }
    if(e.target.closest('[data-release-retry]')){
      if(!pending || pending.rejection || !mayPublish) return;
      setBusy(true); reconcile().then(function(){ if(!current()) return; setBusy(false); if(pending && retryAllowed) sendPending(); else render(); }).catch(function(ex){ if(current()){ setBusy(false); error(ex.message || "查询失败，原请求保留"); } }); return;
    }
    if(pending || storageError) return;
    var statusBtn = e.target.closest('[data-plan-br-status]');
    if(statusBtn){ openPlanBranchStatusMenu(statusBtn, statusBtn.getAttribute("data-plan-br-status")); return; }
    var bulk = e.target.closest('[data-plan-all], [data-plan-done], [data-plan-clear], [data-actual-all], [data-actual-done], [data-actual-clear]');
    if(bulk){
      var bulkKey = bulk.hasAttribute("data-actual-all") || bulk.hasAttribute("data-actual-done") || bulk.hasAttribute("data-actual-clear") ? "actual" : "plan";
      var bulkMode = (bulk.hasAttribute("data-plan-all") || bulk.hasAttribute("data-actual-all")) ? "all" : (bulk.hasAttribute("data-plan-done") || bulk.hasAttribute("data-actual-done")) ? "done" : "clear";
      bulkPick(bulkKey, bulkMode); return;
    }
    if(e.target.closest('[data-plan-draft-restore]')){
      var draft = readPlanDraft();
      dismissPlanDraftBanner();
      if(draft && !planDraftLocked()){ applyPlanDraft(draft.fields); toast("已恢复未保存的计划草稿", "fs"); }
      return;
    }
    if(e.target.closest('[data-plan-draft-dismiss]')){
      /* 丢弃：删掉本地草稿，但保留"本次已提示过"标记，避免重绘后又弹一次 */
      try{ localStorage.removeItem(planDraftKey()); }catch(ex){ /* noop */ }
      dismissPlanDraftBanner();
      return;
    }
    if(e.target.closest('[data-plan-new]')){ if(mayManage) confirmDiscardPlan(function(){ readActual(); planId = ""; planJustSaved = false; planScopeVersionIds = null; planVersionQuery = ""; planTaskFetchKey = ""; planTaskErrorKey = ""; invalidatePreview(); render(); }); return; }
    if(e.target.closest('[data-release-preview]')){ runPreview(); return; }
    if(e.target.closest('[data-release-save]')){
      var p = selectedPlan(); if(!mayManage || (p && p.status === "completed")) return;
      var b = planBody();
      if(!b.reason){ error("请填写新建 / 修改计划理由", "plan"); return; }
      if(b.status === "ready" && (!b.plannedAt || !b.ownerUserId || !b.plannedTaskIds.length || !b.targetKeys.length)){ error("就绪计划需要时间、负责人、明确任务范围与目标键", "plan"); return; }
      readActual(); setBusy(true); invalidatePreview();
      (p ? API.put(base + "/release-plan", b) : API.post(base + "/release-plans", b)).then(function(saved){ if(current()){ clearPlanDraft(); dismissPlanDraftBanner(); planId = saved.id; planJustSaved = true; planSavedRevision = saved.revision == null ? null : saved.revision; restoreScroll = dlg.scrollTop(); setBusy(false); toast("独立发布计划已保存", "fs"); load(); } }).catch(function(ex){ if(current()){ setBusy(false); error(ex.message || "计划保存失败", "plan"); } }); return;
    }
    var confirm = e.target.closest('[data-release-confirm]');
    if(!confirm || confirm.disabled || !preview || !mayPublish) return;
    var b = context(), msg = validate(b);
    if(msg){ error(msg, "actual"); return; }
    if(planDirty() || JSON.stringify(b) !== previewContext){ invalidatePreview(); error("完整上下文已变化，请重新预览", "actual"); return; }
    b.scopeToken = preview.scopeToken; b.planRevision = preview.planRevision == null ? null : preview.planRevision;
    b.idempotencyKey = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "release-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    if(persist({body:b, createdAt:new Date().toISOString()})) sendPending();
  });
  load();
  return {
    id: id,
    setTab: function(key){
      if(busy) return;
      syncingFromHash = true;
      try{ switchTab(key, false); } finally { syncingFromHash = false; }
    },
    destroy: cleanup
  };
}
function startVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  UI.showConfirm({
    title:"开始开发",
    msg:"将「" + esc(v.name) + "」转为进行中？开始开发会把当前工作项与预估冻结为承诺基线，之后新增或移出会单独标注。"
      + (v.startDate ? "" : "该版本尚无开始日期，将自动记为今天。"),
    okText:"开始开发", danger:false
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/versions/" + encodeURIComponent(id) + "/start", {}).then(function(){
      toast("已开始开发「" + v.name + "」", "fs");
      notifyDeliveryChanged(v.reqId || rt.phaseReqId);
      reloadView();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}
/* 关闭 / 取消都要求原因；关闭是「本轮结束但未发布」，取消是「本轮作废」，都在版本历史中留痕 */
function endVersion(id, status){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var closing = status === "closed";
  var endReason = "";
  UI.showPrompt({
    title: closing ? "关闭版本" : "取消版本",
    desc: closing
      ? "关闭表示本轮交付结束但未发布；版本与工作项关联保留，不再接受新工作项和发布记录。"
      : "取消表示本轮版本作废；历史保留，但不参与交付统计与发布计划。",
    label: "原因（必填）", required: true, multiline: true, maxLength: 500,
    okText: closing ? "关闭版本" : "取消版本"
  }).then(function(reason){
    if(reason == null) return;
    endReason = reason;
    if(closing) return submit();
    return UI.showConfirm({
      title: "确认取消版本",
      msg: "取消「" + esc(v.name) + "」后不能恢复，也不再计入交付统计。",
      okText: "确认取消"
    }).then(function(ok){ if(ok) return submit(); });
  });
  function submit(){
    API.post("/api/versions/" + encodeURIComponent(id) + "/" + (closing ? "close" : "cancel"), { reason: endReason }).then(function(){
      toast((closing ? "已关闭「" : "已取消「") + v.name + "」", "fs");
      notifyDeliveryChanged(v.reqId || rt.phaseReqId);
      reloadView();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  }
}
function deleteVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!isOwner()){ toast("仅空间主可删除版本", "warn"); return; }
  UI.showConfirm({
    title:"删除版本",
    msg:"删除「" + esc(v.name) + "」？已发布或已有发布尝试记录的版本不能删除；仍有工作项绑定（含回收站）、需求目标引用（含已取消）或关联里程碑也会拒绝删除。请先填写原因解除 / 调整工作项版本，撤排 / 调整需求目标；已取消需求需有因恢复以清目标。删除不会自动解绑。",
    okText:"删除版本"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/versions/" + encodeURIComponent(id)).then(function(){
      toast("已删除「" + v.name + "」（无工作项绑定或需求目标引用，未自动解绑）", "fs");
      notifyDeliveryChanged(v.reqId || rt.phaseReqId);
      reloadView();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
var versionBindingSeq = 0;
function bindingDialogGuard(layer){
  var seq = ++versionBindingSeq, reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id, route = document.body.dataset.view;
  var disposed = false, busy = false;
  layer.__uiOnClose = function(){ disposed = true; setTimeout(function(){ layer.remove(); }, 0); };
  return {current:function(){
    var valid = !disposed && seq === versionBindingSeq && reqId === rt.phaseReqId && wsId === (rt.currentWs || {}).id && userId === (rt.currentUser || {}).id && route === document.body.dataset.view;
    if(!valid && !disposed) UI.closeModal(layer);
    return valid;
  }, busy:function(){ return busy; }, setBusy:function(on){
    busy = on;
    layer.querySelectorAll('input, select, textarea, button').forEach(function(el){
      if(el.matches('[data-version-task-x], [data-version-task-cancel], [data-unbound-x], [data-unbound-cancel]')) return;
      if(on){ el.dataset.wasDisabled = el.disabled ? "1" : "0"; el.disabled = true; }
      else if(el.dataset.wasDisabled !== undefined){ el.disabled = el.dataset.wasDisabled === "1"; delete el.dataset.wasDisabled; }
    });
  }};
}
function openVersionTasks(id, fresh, preset){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  if(versionEnded(v)){ toast("已关闭或已取消的版本不能调整工作项", "warn"); return; }
  if(!fresh){
    var seq = ++versionBindingSeq, reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id, route = document.body.dataset.view;
    Promise.all([API.get("/api/versions", {reqId:reqId}), API.get("/api/versions/task-options", {reqId:reqId})]).then(function(rs){
      if(seq !== versionBindingSeq || reqId !== rt.phaseReqId || wsId !== (rt.currentWs || {}).id || userId !== (rt.currentUser || {}).id || route !== document.body.dataset.view || !cache) return;
      cache.versions = rs[0]; cache.tasks = rs[1];
      var current = findVersion(id);
      openVersionTasks(id, true, preset);
    }).catch(function(ex){ if(seq === versionBindingSeq && reqId === rt.phaseReqId && wsId === (rt.currentWs || {}).id && userId === (rt.currentUser || {}).id && route === document.body.dataset.view) toast(ex.message || "加载版本内容范围失败", "bad"); });
    return;
  }
  if(versionContentLocked(v)){ toast("已有成功正式发布，版本内容范围只读", "warn"); return; }
  var selected = {}, query = "", stateFilter = "", publishFilter = "", scopeFilter = "", groupMode = "none", collapsed = {};
  cache.tasks.forEach(function(t){ if(taskVersionIds(t).indexOf(id) !== -1) selected[t.id] = true; });
  /* 新建工作项会先收起本弹框：回来时还原用户勾选（新建项按数据里的真实关联决定，不被旧快照覆盖） */
  if(preset){
    (preset.on || []).forEach(function(tid){ selected[tid] = true; });
    (preset.off || []).forEach(function(tid){ delete selected[tid]; });
  }
  var versionNames = {};
  cache.versions.forEach(function(item){ versionNames[item.id] = item.name; });
  var demandTitles = {};
  cache.tasks.forEach(function(t){ if(t.demandId && t.demandTitle) demandTitles[t.demandId] = t.demandTitle; });
  var rows = cache.tasks.slice().sort(function(a, b){
    var av = taskVersionIds(a).indexOf(id) !== -1 ? 0 : 1, bv = taskVersionIds(b).indexOf(id) !== -1 ? 0 : 1;
    return av - bv || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  var guard = bindingDialogGuard(layer);
  layer.innerHTML = '<div class="sheet version-task-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(v.name) + ' · 管理工作项</h2>'
    + '<div class="desc">勾选关联到此版本，取消勾选解除关联；只增减当前版本的关联，保留工作项的其他版本关联。</div></div>'
    + '<button class="icon-btn sm" type="button" data-version-task-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="version-task-tools release-picker-tools">'
    + '<input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索版本工作项" data-version-task-search autocomplete="off" />'
    + '<select data-version-task-state aria-label="按状态筛选"><option value="">全部状态</option><option value="done">仅已完成</option><option value="open">仅未完成</option></select>'
    + '<select data-version-task-publish aria-label="按发布状态筛选"><option value="">全部发布状态</option><option value="published">已发布</option><option value="unpublished">未发布</option></select>'
    + '<select data-version-task-scope aria-label="按勾选状态筛选"><option value="">全部</option><option value="selected">已选</option><option value="unselected">未选</option></select>'
    + '<select data-version-task-group aria-label="工作项分组方式"><option value="none">不分组</option><option value="status">按状态</option><option value="demand">按需求</option><option value="publish">按发布状态</option><option value="owner">按负责人</option></select>'
    + '<span class="version-task-count release-picker-count" role="status"></span>'
    + '<button class="btn sm release-picker-expand" type="button" data-version-task-expand aria-expanded="false" title="放大或收起工作项列表">' + icon("expand", 13) + '<span>放大</span></button>'
    + '</div><div class="version-task-list"></div>'
    + '<p class="hint" data-version-task-empty hidden>没有匹配的工作项，试试清空搜索或切换筛选。</p>'
    + '<label class="field version-change-reason">版本调整理由（变更关联时必填）<textarea data-task-change-reason maxlength="500" placeholder="说明新增、顺延或移出此版本的原因"></textarea></label></div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-version-task-new>+ 在此版本新建工作项</button>'
    + '<span style="flex:1"></span><button class="btn" type="button" data-version-task-cancel>取消</button>'
    + '<button class="btn primary" type="button" data-version-task-save>保存关联</button></div></div>';
  function selectedIds(){ return Object.keys(selected).filter(function(taskId){ return selected[taskId]; }); }
  function rowState(t){ return t.boardColumn === "done" ? "done" : "open"; }
  function groupKeyOf(t){
    if(groupMode === "status") return t.boardColumn === "done" ? "s:done" : "s:open";
    if(groupMode === "demand") return "q:" + (t.demandId || "");
    if(groupMode === "publish") return taskIsPublished(t) ? "p:1" : "p:0";
    if(groupMode === "owner") return "o:" + (t.owner || "");
    return "";
  }
  function groupLabelOf(key){
    if(groupMode === "status") return key === "s:done" ? "已完成" : "未完成";
    if(groupMode === "demand"){
      if(key === "q:") return "未关联需求";
      return demandTitles[key.slice(2)] || key.slice(2);
    }
    if(groupMode === "publish") return key === "p:1" ? "已发布" : "未发布";
    return key === "o:" ? "未指派" : key.slice(2);
  }
  function rowHTML(t){
    var bound = taskVersionIds(t).filter(function(vid){ return vid !== id; });
    var brName = t.branchId ? branchNameById(t.branchId) : "";
    var meta = typeName(t.itemType) + " · " + (t.owner || "未指派") + " · "
      + (t.boardColumn === "done" ? "已完成" : colName(t.boardColumn))
      + (brName ? " · 分支 " + brName : "");
    return '<label class="version-task-row" data-version-task-row data-task-state="' + rowState(t) + '"'
      + ' data-task-published="' + (taskIsPublished(t) ? "1" : "0") + '"'
      + ' data-task-title="' + esc(String(t.title || "").toLowerCase()) + '" data-task-meta="' + esc(String(t.owner || "").toLowerCase()) + '">'
      + '<input type="checkbox" data-version-task-check="' + esc(t.id) + '"' + (selected[t.id] ? " checked" : "") + ' />'
      + '<span class="version-task-main"><span class="version-task-title"><b>' + esc(t.title) + '</b>' + taskPublicationHTML(t) + '</span>'
      + '<small>' + esc(meta)
      + (bound.length ? ' · 其他关联：' + esc(bound.map(function(vid){ return versionNames[vid] || vid; }).join('、')) : "") + '</small></span></label>';
  }
  function renderRows(){
    var list = layer.querySelector(".version-task-list"), groups = [], seen = {};
    rows.forEach(function(t){
      var key = groupKeyOf(t);
      if(!seen[key]){ seen[key] = { key:key, label:groupLabelOf(key), items:[] }; groups.push(seen[key]); }
      seen[key].items.push(t);
    });
    list.innerHTML = groups.map(function(g){
      var body = g.items.map(rowHTML).join("");
      if(!g.key) return '<section class="release-task-group is-flat" data-version-task-section=""><div class="release-task-group-body">' + body + '</div></section>';
      var open = !collapsed[g.key];
      return '<section class="release-task-group' + (open ? "" : " is-collapsed") + '" data-version-task-section="' + esc(g.key) + '">'
        + '<div class="release-task-group-head"><button type="button" class="release-group-toggle" data-version-task-group-toggle="' + esc(g.key) + '" aria-expanded="' + (open ? "true" : "false") + '" title="' + (open ? "收起本组" : "展开本组") + '">' + icon("down", 12) + '<span class="release-group-name">' + esc(g.label) + '</span></button>'
        + '<label class="release-group-all"><input type="checkbox" data-version-task-group-all="' + esc(g.key) + '"><span>全选本组</span></label>'
        + '<span class="release-group-count" data-version-task-group-count>已选 0 / ' + g.items.length + '</span></div>'
        + '<div class="release-task-group-body"' + (open ? "" : " hidden") + '>' + body + '</div></section>';
    }).join("");
    filterRows();
  }
  /* 分组头与总数只统计当前筛选可见行，和发布计划清单同一口径 */
  function syncCounts(){
    var list = layer.querySelector(".version-task-list");
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + rows.length + " 项";
    list.querySelectorAll("[data-version-task-section]").forEach(function(group){
      if(!group.getAttribute("data-version-task-section")) return;
      var total = 0, sel = 0;
      group.querySelectorAll("[data-version-task-row]").forEach(function(row){
        if(row.hidden) return;
        var cb = row.querySelector("[data-version-task-check]");
        if(!cb) return;
        total++; if(cb.checked) sel++;
      });
      var count = group.querySelector("[data-version-task-group-count]");
      if(count) count.textContent = "已选 " + sel + " / " + total;
      var all = group.querySelector("[data-version-task-group-all]");
      if(all){ all.checked = total > 0 && sel === total; all.indeterminate = sel > 0 && sel < total; }
    });
  }
  function filterRows(){
    var list = layer.querySelector(".version-task-list");
    var q = query.trim().toLowerCase(), shown = 0;
    list.querySelectorAll("[data-version-task-row]").forEach(function(row){
      var cb = row.querySelector("[data-version-task-check]");
      var chosen = !!(cb && cb.checked);
      var match = (!q || (row.getAttribute("data-task-title") || "").indexOf(q) !== -1 || (row.getAttribute("data-task-meta") || "").indexOf(q) !== -1)
        && (!stateFilter || (stateFilter === "done" ? row.getAttribute("data-task-state") === "done" : row.getAttribute("data-task-state") !== "done"))
        && (!publishFilter || (publishFilter === "published" ? row.getAttribute("data-task-published") === "1" : row.getAttribute("data-task-published") !== "1"))
        && (!scopeFilter || (scopeFilter === "selected" ? chosen : !chosen));
      row.hidden = !match; if(match) shown++;
    });
    list.querySelectorAll("[data-version-task-section]").forEach(function(group){
      var any = false;
      group.querySelectorAll("[data-version-task-row]").forEach(function(row){ if(!row.hidden) any = true; });
      group.hidden = !any;
      var key = group.getAttribute("data-version-task-section");
      var open = !key || !collapsed[key];
      var body = group.querySelector(".release-task-group-body");
      group.classList.toggle("is-collapsed", !!key && !open);
      if(body) body.hidden = !open;
      var toggle = group.querySelector("[data-version-task-group-toggle]");
      if(toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    layer.querySelector("[data-version-task-empty]").hidden = shown !== 0;
    syncCounts();
  }
  document.body.appendChild(layer);
  renderRows();
  layer.addEventListener("input", function(e){
    if(!guard.current() || guard.busy()) return;
    if(e.target.closest("[data-version-task-search]")){
      query = e.target.value;
      filterRows();
    }
  });
  layer.addEventListener("change", function(e){
    if(!guard.current() || guard.busy()) return;
    var groupAll = e.target.closest("[data-version-task-group-all]");
    if(groupAll){
      /* 勾上只作用于筛选可见行，取消作用于整组；和发布计划清单的整组勾选一致 */
      var section = groupAll.closest("[data-version-task-section]");
      section.querySelectorAll("[data-version-task-row]").forEach(function(row){
        var cb = row.querySelector("[data-version-task-check]");
        if(!cb) return;
        if(groupAll.checked && row.hidden) return;
        cb.checked = groupAll.checked;
        selected[cb.getAttribute("data-version-task-check")] = cb.checked;
      });
      filterRows();
      return;
    }
    if(e.target.closest("[data-version-task-state]")){ stateFilter = e.target.value; filterRows(); return; }
    if(e.target.closest("[data-version-task-publish]")){ publishFilter = e.target.value; filterRows(); return; }
    if(e.target.closest("[data-version-task-scope]")){ scopeFilter = e.target.value; filterRows(); return; }
    if(e.target.closest("[data-version-task-group]")){ groupMode = e.target.value; renderRows(); return; }
    var check = e.target.closest("[data-version-task-check]");
    if(!check) return;
    selected[check.getAttribute("data-version-task-check")] = check.checked;
    filterRows();
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-version-task-x], [data-version-task-cancel]")){ UI.closeModal(layer); return; }
    if(!guard.current() || guard.busy()) return;
    var groupToggle = e.target.closest("[data-version-task-group-toggle]");
    if(groupToggle){
      var gkey = groupToggle.getAttribute("data-version-task-group-toggle");
      collapsed[gkey] = !collapsed[gkey];
      filterRows();
      return;
    }
    if(e.target.closest("[data-version-task-expand]")){
      var sheet = layer.querySelector(".version-task-sheet");
      var on = !sheet.classList.contains("is-expanded");
      sheet.classList.toggle("is-expanded", on);
      var expandBtn = layer.querySelector("[data-version-task-expand]");
      expandBtn.innerHTML = icon(on ? "compress" : "expand", 13) + '<span>' + (on ? "收起" : "放大") + '</span>';
      expandBtn.setAttribute("aria-expanded", on ? "true" : "false");
      var focusTarget = on ? layer.querySelector("[data-version-task-search]") : expandBtn;
      if(focusTarget){ try{ focusTarget.focus({preventScroll:true}); }catch(ex){ /* noop */ } }
      return;
    }
    if(!canWritePhase()){ denyPhaseReadOnly(); return; }
    if(e.target.closest("[data-version-task-new]")){
      /* 一次只留一层浮层：先收起版本弹框，任务抽屉建完/关闭后再回到这里，勾选原样还原 */
      var keep = {
        on: selectedIds(),
        off: Object.keys(selected).filter(function(tid){ return !selected[tid]; })
      };
      UI.closeModal(layer);
      openTaskDrawer("backlog", null, {
        reqId: v.reqId,
        versionIds: [v.id],
        onClose: function(){ openVersionTasks(id, false, keep); }
      });
      return;
    }
    var save = e.target.closest("[data-version-task-save]");
    if(!save || save.disabled) return;
    var taskIds = selectedIds();
    if(taskIds.length > 500){ toast("单个版本最多关联 500 个工作项", "warn"); return; }
    var changed = rows.some(function(t){ return !!selected[t.id] !== (taskVersionIds(t).indexOf(id) !== -1); });
    if(!changed){ UI.closeModal(layer); toast("版本工作项关联未变化"); return; }
    var reason = layer.querySelector('[data-task-change-reason]').value.trim();
    if(!reason){ toast("请填写版本调整理由", "warn"); layer.querySelector('[data-task-change-reason]').focus(); return; }
    guard.setBusy(true);
    API.put("/api/versions/" + encodeURIComponent(id), {
      reqId: v.reqId,
      name: v.name,
      description: v.description || null,
      /* 全量覆盖语义：必须回传当前开始日期，否则保存任务关联会清掉它 */
      startDate: v.startDate || null,
      targetDate: v.targetDate || null,
      status: v.status === "active" ? "active" : "planned",
      revision: v.revision,
      taskIds: taskIds,
      taskChangeReason: reason
    }).then(function(){
      if(!guard.current()) return;
      UI.closeModal(layer);
      toast("已保存「" + v.name + "」的 " + taskIds.length + " 项工作项关联", "fs");
      reloadView();
    }).catch(function(ex){
      if(!guard.current()) return;
      guard.setBusy(false);
      toast(ex.message || "保存工作项关联失败", "bad");
    });
  });
  UI.openModal(layer);
}
/* 待规划卡片入口：分配到无成功正式发布的版本（并入已有成员，保留其他版本关联）。 */
function openUnboundTasks(){
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var targets = cache.versions.filter(function(v){ return !versionContentLocked(v); });
  var unbound = cache.tasks.filter(function(t){ return !taskVersionIds(t).length; })
    .slice().sort(function(a, b){ return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"); });
  if(!unbound.length || !targets.length) return;
  var firstActive = targets.find(function(v){ return v.status === "active"; });
  var selected = {}, query = "", publishFilter = "";
  unbound.forEach(function(t){ selected[t.id] = true; });
  var opts = targets.map(function(v){
    return '<option value="' + esc(v.id) + '"' + (v === (firstActive || targets[0]) ? " selected" : "") + '>'
      + esc(v.name) + (v.status === "active" ? "（进行中）" : "（计划中）") + '</option>';
  }).join("");
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  var guard = bindingDialogGuard(layer);
  layer.innerHTML = '<div class="sheet version-task-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>分配工作项到版本</h2>'
    + '<div class="desc">把未绑定版本的工作项批量关联到所选版本，保留其他版本关联；已有成功正式发布的版本内容只读。</div></div>'
    + '<button class="icon-btn sm" type="button" data-unbound-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="version-task-tools">'
    + '<select aria-label="目标版本" data-unbound-ver>' + opts + '</select>'
    + '<input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索待分配工作项" data-unbound-search />'
    + '<select data-unbound-publish aria-label="按发布状态筛选"><option value="">全部发布状态</option><option value="published">已发布</option><option value="unpublished">未发布</option></select>'
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div>'
    + '<label class="field version-change-reason">版本调整理由（变更关联时必填）<textarea data-task-change-reason maxlength="500" placeholder="说明新增、顺延或移出此版本的原因"></textarea></label></div>'
    + '<div class="sheet-foot"><span style="flex:1"></span><button class="btn" type="button" data-unbound-cancel>取消</button>'
    + '<button class="btn primary" type="button" data-unbound-save>分配所选工作项</button></div></div>';
  function selVer(){ return targets.find(function(v){ return v.id === layer.querySelector("[data-unbound-ver]").value; }) || targets[0]; }
  function selectedIds(){ return unbound.filter(function(t){ return selected[t.id]; }).map(function(t){ return t.id; }); }
  function renderList(){
    var list = layer.querySelector(".version-task-list");
    var visible = unbound.filter(function(t){
      if(publishFilter && taskIsPublished(t) !== (publishFilter === "published")) return false;
      if(!query) return true;
      return (String(t.title || "") + " " + String(t.owner || "")).toLowerCase().indexOf(query) !== -1;
    });
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + unbound.length + " 项";
    list.innerHTML = visible.length ? visible.map(function(t){
      var brName = t.branchId ? branchNameById(t.branchId) : "";
      var meta = typeName(t.itemType) + " · " + (t.owner || "未指派") + " · "
        + (t.boardColumn === "done" ? "已完成" : colName(t.boardColumn))
        + (brName ? " · 分支 " + brName : "");
      return '<label class="version-task-row"><input type="checkbox" data-unbound-check="' + esc(t.id) + '"'
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><span class="version-task-title"><b>' + esc(t.title) + '</b>' + taskPublicationHTML(t) + '</span>'
        + '<small>' + esc(meta) + '</small></span></label>';
    }).join("") : '<div class="tl-empty">没有匹配的工作项</div>';
  }
  document.body.appendChild(layer);
  renderList();
  layer.addEventListener("input", function(e){
    if(!guard.current() || guard.busy()) return;
    if(e.target.closest("[data-unbound-search]")){
      query = e.target.value.trim().toLowerCase();
      renderList();
    }
  });
  layer.addEventListener("change", function(e){
    if(!guard.current() || guard.busy()) return;
    if(e.target.closest("[data-unbound-publish]")){
      var v = e.target.value;
      publishFilter = v === "published" || v === "unpublished" ? v : "";
      renderList();
      return;
    }
    var check = e.target.closest("[data-unbound-check]");
    if(!check) return;
    selected[check.dataset.unboundCheck] = check.checked;
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + unbound.length + " 项";
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-unbound-x], [data-unbound-cancel]")){ UI.closeModal(layer); return; }
    if(!guard.current() || guard.busy()) return;
    if(!canWritePhase()){ denyPhaseReadOnly(); return; }
    var save = e.target.closest("[data-unbound-save]");
    if(!save || save.disabled) return;
    var target = selVer();
    var picked = selectedIds();
    if(!picked.length){ toast("请至少勾选一个工作项", "warn"); return; }
    var reason = layer.querySelector('[data-task-change-reason]').value.trim();
    if(!reason){ toast("请填写版本调整理由", "warn"); layer.querySelector('[data-task-change-reason]').focus(); return; }
    guard.setBusy(true);
    var targetId = target.id;
    /* 提交前重新读取目标和成员范围；已有正式交付（后端 contentLocked）的内容不可编辑。 */
    Promise.all([API.get("/api/versions", {reqId:target.reqId}), API.get("/api/versions/task-options", {reqId:target.reqId})]).then(function(rs){
      if(!guard.current()) return false;
      if(!canWritePhase()) throw new Error("当前项目已变为只读");
      target = (rs[0] || []).find(function(v){ return v.id === targetId; });
      if(!target) throw new Error("目标版本已不可见，请刷新");
      cache.versions = rs[0]; cache.tasks = rs[1];
      if(versionContentLocked(target)) throw new Error("目标版本已有成功正式发布，内容范围只读");
      /* 只增加本版本成员，保留最新已有成员与工作项的其他版本关联。 */
      var bound = {};
      cache.tasks.forEach(function(t){ if(taskVersionIds(t).indexOf(targetId) !== -1) bound[t.id] = true; });
      picked.forEach(function(taskId){ bound[taskId] = true; });
      var taskIds = Object.keys(bound);
      if(taskIds.length > 500) throw new Error("单个版本最多关联 500 个工作项");
      return API.put("/api/versions/" + encodeURIComponent(targetId), {
        reqId:target.reqId, name:target.name, description:target.description || null,
        startDate:target.startDate || null, targetDate:target.targetDate || null,
        status:target.status === "active" ? "active" : "planned", revision:target.revision,
        taskIds:taskIds, taskChangeReason:reason
      }).then(function(){ return true; });
    }).then(function(saved){
      if(!saved || !guard.current()) return;
      UI.closeModal(layer);
      toast("已将 " + picked.length + " 项工作项分配到「" + target.name + "」", "fs");
      reloadView();
    }).catch(function(ex){
      if(!guard.current()) return;
      guard.setBusy(false);
      toast(ex.message || "分配失败", "bad");
    });
  });
  UI.openModal(layer);
}
function csvCell(s){
  var text = typeof s === "string";
  s = s === null || s === undefined ? "" : String(s);
  if(text && /^\s*[=+\-@\t\r]/.test(s)) s = "'" + s;
  if(/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
/* T1.6：发布说明导出 CSV（含 BOM，Excel 打开不乱码） */
function exportReleaseNoteCSV(note){
  var v = note.version || {};
  var lines = [
    ["当前规划说明（非实际交付）", v.name || ""],
    ["生成日期", note.generatedAt || ""],
    ["工作项总数", note.totalCount || 0],
    ["完成工作项", note.doneCount || 0],
    ["实际工时(分钟)", note.workMinutes || 0],
    ["预估工时(分钟)", note.estimateMinutes || 0],
    [],
    ["计划工作项", "完成状态（非交付状态）", "预估(分钟)", "类型"]
  ];
  (note.tasks || []).forEach(function(t){
    lines.push([t.title, t.boardColumn === "done" ? "已完成（未必交付）" : colName(t.boardColumn),
      t.estimateMinutes == null ? "" : t.estimateMinutes, typeName(t.itemType)]);
  });
  lines.push([]);
  lines.push(["已排需求", "类型", "状态", "优先级"]);
  (note.demands || []).forEach(function(d){
    lines.push([d.title, d.itemKind || "", d.status || "", d.priority || ""]);
  });
  var csv = "\uFEFF" + lines.map(function(row){
    return row.map(csvCell).join(",");
  }).join("\r\n");
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "当前规划说明-" + (v.name || "版本") + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function showReleaseNote(id){
  var dlg = releaseDialog(findVersion(id) || {name:"版本"}, "发布说明"), note = null, snapshot = null;
  var base = "/api/versions/" + encodeURIComponent(id);
  function load(){
    dlg.body.innerHTML = UI.skeletonRows(3);
    var cached = findVersion(id);
    (cached ? Promise.resolve(cached) : API.get(base)).then(function(v){
      if(!dlg.current()) return null;
      /* 有成功生产发布事实就展示实际快照：新版本不会再被置为 released，不能只看 status */
      if(v.status === "released" || v.releaseEvidenceKind === "release_snapshot") return API.get(base + "/release-records").then(function(records){ return {version:v, records:records || [], actual:true}; });
      return API.get(base + "/release-note").then(function(data){ return {version:v, note:data}; });
    }).then(function(data){
      if(!data || !dlg.current()) return;
      note = null; snapshot = null;
      if(data.actual){
        /* 与服务端 latestSuccess 同口径：按实际发生时间、再按记录时间取最新 */
        snapshot = data.records.filter(function(r){ return r.result === "success" && r.environment === "production" && r.operation !== "rollback"; }).sort(function(a,b){
          return String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")) || String(b.recordedAt || "").localeCompare(String(a.recordedAt || ""));
        })[0] || null;
        dlg.body.innerHTML = '<h3>' + esc(data.version.name) + ' · 实际发布快照</h3>'
          + (snapshot ? '<p class="hint">以下为成功发布时的不可变快照，不是当前规划，也不以首版统计推断交付。</p>' + releaseRecordHTML(snapshot)
            : '<p class="hint">该历史已发布版本未留成功发布记录，不反推实际交付，也不生成伪造快照。</p>');
        var details = dlg.body.querySelector('details'); if(details) details.open = true;
        return;
      }
      note = Object.assign({}, data.note || {}, {version:data.version});
      note.tasks = (note.tasks || []).filter(function(t){ return !t.preLaunchFold; });
      note.totalCount = note.tasks.length; note.doneCount = note.tasks.filter(function(t){ return t.boardColumn === "done"; }).length;
      var taskRows = note.tasks.map(function(t){
        return '<li><button class="link-cell" type="button" data-note-task="' + esc(t.id) + '">' + esc(t.title) + '</button>'
          + (t.boardColumn === "done" ? ' <span class="tag tag-success">已完成（未必交付）</span>' : '') + '</li>';
      }).join('') || '<li class="hint">没有计划工作项</li>';
      var demands = (note.demands || []).map(function(d){ return '<li><button class="link-cell" type="button" data-note-demand="' + esc(d.id) + '">' + esc(d.title) + '</button></li>'; }).join('') || '<li class="hint">没有目标需求</li>';
      dlg.body.innerHTML = '<div class="phase-note"><h3>' + esc(data.version.name) + ' · 当前规划说明</h3><p class="hint">此处为当前计划范围，不代表实际交付。实际交付以成功发布记录快照为准。</p>'
        + '<button class="btn sm" type="button" data-note-export>导出当前规划 CSV</button><h4>计划工作项</h4><ul>' + taskRows + '</ul><h4>目标需求</h4><ul>' + demands + '</ul></div>';
    }).catch(function(ex){
      if(!dlg.current()) return;
      dlg.body.innerHTML = '<p class="release-error" role="alert">' + esc(ex.message || "加载发布说明失败") + '</p><button class="link-btn" type="button" data-note-retry>重试</button>';
    });
  }
  dlg.layer.addEventListener("click", function(e){
    if(e.target.closest('[data-note-retry]')){ load(); return; }
    if(e.target.closest('[data-note-export]') && note) exportReleaseNoteCSV(note);
    if(e.target.closest('[data-release-export]') && snapshot) exportReleaseRecordCSV(snapshot);
    if(e.target.closest('[data-release-delivery]')){ openDeliveryNote(id, snapshot ? snapshot.id : ""); return; }
    var task = e.target.closest('[data-note-task]');
    if(task){ openTaskById(task.dataset.noteTask); return; }
    var demand = e.target.closest('[data-note-demand]');
    if(demand){ openDemandDetailById(demand.dataset.noteDemand); }
  });
  load();
}
function markFirstRelease(){
  if(!isOwner()){ toast("仅空间主可标记首版上线", "warn"); return; }
  var today = new Date().toISOString().substring(0, 10);
  UI.showPrompt({
    title:"标记首版上线",
    desc:"标记后统计切换为双阶段：此前的投入归入首版开发，之后的归入迭代维护。",
    label:"上线日期（YYYY-MM-DD）",
    value: today
  }).then(function(v){
    if(v === null) return;
    var d = v.trim() || today;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast("日期格式应为 YYYY-MM-DD", "bad"); return; }
    API.post("/api/reqs/" + encodeURIComponent(rt.phaseReqId) + "/first-release", { date: d }).then(function(){
      toast("已标记首版上线：" + d, "fs");
      loadReqs();
      reloadView();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}

/* ---------- 任务抽屉「计划版本」选项 ---------- */

function fetchVersions(reqId){
  if(versionOptionsCache[reqId]) return Promise.resolve(versionOptionsCache[reqId]);
  return API.get("/api/versions", { reqId: reqId }).then(function(vs){
    versionOptionsCache[reqId] = vs;
    return vs;
  });
}
function fetchTaskOptions(reqId){
  if(taskOptionsCache[reqId]) return Promise.resolve(taskOptionsCache[reqId]);
  return API.get("/api/versions/task-options", { reqId: reqId }).then(function(rows){
    taskOptionsCache[reqId] = rows;
    return rows;
  });
}
function invalidateTaskOptionsCache(){ taskOptionsCache = {}; }
function ensureVersionOptions(keep, taskId){
  var sel = $("iVersion");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "", seq = rt.taskFormSeq, editingId = rt.editingId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id;
  var optionSeq = (Number(sel.dataset.optionSeq) || 0) + 1;
  sel.dataset.optionSeq = String(optionSeq);
  function stillCurrent(){ return seq === rt.taskFormSeq && optionSeq === Number(sel.dataset.optionSeq) && (rt.editingId || null) === (editingId || null) && (($("iReq") ? $("iReq").value : "") === reqId) && wsId === (rt.currentWs || {}).id && userId === (rt.currentUser || {}).id; }
  sel.removeAttribute("data-ready"); delete sel.dataset.retainedIds; sel.disabled = true;
  if(!reqId){ sel.innerHTML = ''; sel.disabled = !!rt.drawerReadOnly; sel.setAttribute("data-ready", "1"); return; }
  sel.innerHTML = '<option disabled>计划版本加载中…</option>';
  Promise.all([fetchVersions(reqId), Array.isArray(keep) ? Promise.resolve(keep) : taskId ? fetchTaskOptions(reqId).then(function(rows){
    var task = rows.find(function(t){ return t.id === taskId; });
    if(!task || !Array.isArray(task.versionIds)) throw new Error("关联未加载");
    return task.versionIds;
  }) : Promise.resolve([])]).then(function(results){
    if(!stillCurrent()) return;
    var vs = results[0], ids = normalizedIds(results[1]);
    if(!taskId) ids = ids.filter(function(id){ return vs.some(function(v){ return v.id === id && !versionReadOnly(v); }); });
    sel.innerHTML = vs.filter(function(v){ return !versionReadOnly(v) || ids.indexOf(v.id) !== -1; }).map(function(v){
      var lockText = versionEnded(v) ? '（已关闭/已取消，保留关联）' : '（正式发布后内容只读，保留关联）';
      return '<option value="' + esc(v.id) + '" data-vstatus="' + esc(v.status || "") + '"' + (ids.indexOf(v.id) !== -1 ? ' selected' : '') + (versionReadOnly(v) ? ' disabled' : '') + '>' + esc(v.name) + (versionReadOnly(v) ? lockText : '') + '</option>';
    }).join('');
    ids.forEach(function(id){
      if(!vs.some(function(v){ return v.id === id; })){
        var retained = document.createElement("option"); retained.value = id; retained.textContent = id + "（不可见，保留关联）"; retained.disabled = true; retained.selected = true; sel.appendChild(retained);
      }
    });
    sel.dataset.retainedIds = JSON.stringify(ids.filter(function(id){ var v = vs.find(function(v){ return v.id === id; }); return !v || versionReadOnly(v); }));
    if(taskId && taskCacheExtra[taskId] && !Array.isArray(taskCacheExtra[taskId].versionIds)) taskCacheExtra[taskId].versionIds = ids.slice();
    sel.disabled = !!rt.drawerReadOnly; sel.setAttribute("data-ready", "1");
  }).catch(function(){
    if(!stillCurrent()) return;
    sel.innerHTML = '<option disabled>关联加载失败，保留原关联；请重开重试</option>'; sel.disabled = true; sel.removeAttribute("data-ready");
  });
}
/* 「发现版本」与「计划版本」共用同一份项目版本列表，但语义独立：
   未就绪时保留原值，就绪后空串表示明确「暂未定位」。 */
function ensureFoundVersionOptions(keep){
  var sel = $("iFoundVersion");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  var seq = rt.taskFormSeq;
  var editingId = rt.editingId;
  function stillCurrent(){
    return seq === rt.taskFormSeq
      && (rt.editingId || null) === (editingId || null)
      && (($("iReq") ? $("iReq").value : "") === reqId);
  }
  sel.removeAttribute("data-ready");
  if(!reqId){
    sel.innerHTML = '<option value="">暂未定位</option>';
    sel.setAttribute("data-ready", "1");
    return;
  }
  sel.innerHTML = '<option value="">版本加载中…</option>';
  fetchVersions(reqId).then(function(vs){
    if(!stillCurrent()) return;
    var html = '<option value="">暂未定位</option>';
    vs.forEach(function(v){ html += '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; });
    sel.innerHTML = html;
    var hit = false;
    Array.prototype.forEach.call(sel.options, function(o){ if(o.value === keep) hit = true; });
    sel.value = hit ? keep : "";
    sel.setAttribute("data-ready", "1");
  }).catch(function(){
    if(!stillCurrent()) return;
    sel.innerHTML = '<option value="">暂未定位</option>';
  });
}
function ensureEpicOptions(keep, taskId){
  var sel = $("iEpic");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  var seq = rt.taskFormSeq;
  var editingId = rt.editingId;
  function stillCurrent(){
    return seq === rt.taskFormSeq
      && (rt.editingId || null) === (editingId || null)
      && (($("iReq") ? $("iReq").value : "") === reqId);
  }
  sel.removeAttribute("data-ready");
  sel.removeAttribute("data-failed");
  if(!reqId){
    sel.innerHTML = '<option value="">无所属史诗</option>';
    sel.setAttribute("data-ready", "1");
    syncAssocRead();
    return;
  }
  sel.innerHTML = '<option value="">史诗加载中…</option>';
  fetchTaskOptions(reqId).then(function(rows){
    if(!stillCurrent()) return;
    var html = '<option value="">无所属史诗</option>';
    rows.forEach(function(t){
      if(t.itemType === "epic" && t.id !== taskId){
        html += '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>';
      }
    });
    sel.innerHTML = html;
    function pick(value){
      if(!stillCurrent()) return;
      var hit = false;
      Array.prototype.forEach.call(sel.options, function(o){ if(o.value === value) hit = true; });
      sel.value = hit ? value : "";
      sel.setAttribute("data-ready", "1");
      syncAssocRead();
    }
    if(keep !== undefined && keep !== null){ pick(keep); return; }
    if(taskId){
      var current = rows.filter(function(t){ return t.id === taskId; })[0];
      pick(current ? (current.epicId || "") : "");
    }else{
      pick("");
    }
  }).catch(function(){
    if(!stillCurrent()) return;
    sel.innerHTML = '<option value="">史诗加载失败，保存时保留原关联</option>';
    sel.setAttribute("data-failed", "1");
    syncAssocRead();
  });
}

/* ---------- 事件 ---------- */

if(phaseReq) phaseReq.addEventListener("change", function(){
  rt.phaseReqId = phaseReq.value || null;
  /* 从"全部项目"总览切回单项目：选择器重新可见并加载该项目 */
  if(viewMode === "overview"){
    viewMode = "phase";
    syncModeSeg();
  }
  loadPhaseData();
});
if($("phaseModeSeg")) $("phaseModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-pmode]");
  if(!b) return;
  viewMode = b.dataset.pmode;
  syncModeSeg();
  if(viewMode === "overview"){ loadOverview(); return; }
  if(viewMode === "schedule"){ loadSchedule(); return; }
  if(viewMode === "allversions"){ loadAllVersions(); return; }
  if(cache) renderPhaseView();
  else loadPhaseData();
});
if($("btnVerNew")) $("btnVerNew").addEventListener("click", function(){
  if(!rt.phaseReqId){ toast("先选择项目，再新建版本", "warn"); return; }
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  openVersionDialog(null);
});
if($("btnReleasePlan")) $("btnReleasePlan").addEventListener("click", openProjectReleasePlan);
if($("dlgVersionX")) $("dlgVersionX").addEventListener("click", function(){ UI.closeModal($("dlgVersion")); });
if(btnSaveVer) btnSaveVer.addEventListener("click", saveVersion);
if(vName) vName.addEventListener("input", function(){ fVerName.classList.remove("invalid"); });
if(phaseBody) phaseBody.addEventListener("click", function(e){
  /* 列表工具栏 / 分组折叠 / 内联编辑：这些控件都长在可点击的版本行里，必须先于行级下钻处理 */
  var grp = e.target.closest("[data-ver-group]");
  if(grp){
    var gs = grp.getAttribute("data-ver-group");
    verGroupUi.open[gs] = !verGroupOpen(gs);
    paintVersionList();
    return;
  }
  var grpMore = e.target.closest("[data-ver-group-more]");
  if(grpMore){
    var gs2 = grpMore.getAttribute("data-ver-group-more");
    verGroupUi.open[gs2] = !verGroupOpen(gs2);
    paintVersionList();
    return;
  }
  if(e.target.closest("[data-rollup-more]")){ rollupUi.more = !rollupUi.more; paintRollup(); return; }
  if(e.target.closest("[data-ver-schedule-link]")){ viewMode = "schedule"; syncModeSeg(); loadSchedule(); return; }
  /* 最近发布计划卡：点行开该版本发布工作台，回来时刷新卡片计数 */
  var rpRow = e.target.closest("[data-recent-plan]");
  if(rpRow){
    openReleaseDetail(rpRow.getAttribute("data-recent-plan"), "plan", function(){
      if(viewMode === "version" || viewMode === "phase") loadRecentPlans(rt.phaseReqId);
    });
    return;
  }
  if(e.target.closest("[data-recent-plan-new]")){ openProjectReleasePlan(); return; }
  var inlineBtn = e.target.closest("[data-ver-inline]");
  if(inlineBtn){ startVersionInlineEdit(inlineBtn.getAttribute("data-ver-id"), inlineBtn.getAttribute("data-ver-inline")); return; }
  if(e.target.closest("[data-ver-inline-save]")){ saveVersionInline(); return; }
  if(e.target.closest("[data-ver-inline-cancel]")){ cancelVersionInlineEdit(); return; }
  var menuBtn = e.target.closest("[data-ver-menu]");
  if(menuBtn){ openVersionRowMenu(menuBtn, menuBtn.getAttribute("data-ver-menu")); return; }
  var tabOpen = e.target.closest("[data-ver-open-tab]");
  if(tabOpen){
    openVersionPage(tabOpen.getAttribute("data-ver-req") || rt.phaseReqId, tabOpen.getAttribute("data-ver-id"), tabOpen.getAttribute("data-ver-open-tab"));
    return;
  }
  /* 版本名 / 版本详情按钮：跳转到独立的版本详情页（可分享、可后退），先于行级下钻判断 */
  var verOpen = e.target.closest("[data-ver-open]");
  if(verOpen){
    openVersionPage(verOpen.getAttribute("data-ver-req") || rt.phaseReqId, verOpen.getAttribute("data-ver-open"));
    return;
  }
  if(e.target.closest("[data-schedule-refresh]")){ loadSchedule(); return; }
  var rollDim = e.target.closest("[data-rollup-dim]");
  if(rollDim){
    var dim = rollDim.dataset.rollupDim;
    rollupUi.dim = dim;
    if(dim === "demand" && !(rollupUi.demands && rollupUi.demandsReqId === rt.phaseReqId)) ensureRollupDemands(paintRollup);
    else paintRollup();
    return;
  }
  var rollRow = e.target.closest("[data-rollup-group]");
  if(rollRow){ openRollupDrill(rollRow.dataset.rollupGroup, rollRow.dataset.rollupKey || "", rollRow.dataset.rollupVer || ""); return; }
  if(e.target.closest("[data-allv-clear]")){ allVersionsSel = []; renderAllVersions(); return; }
  if(e.target.closest("[data-allv-plan]")){ createPlanFromAllVersions(); return; }
  var sch = e.target.closest("[data-schedule-open]");
  if(sch){ openSchedulePlan(sch.dataset.scheduleProject, sch.dataset.scheduleVersion); return; }
  var ovr = e.target.closest("[data-ov-project]");
  if(ovr){
    rt.phaseReqId = ovr.dataset.ovProject;
    viewMode = "phase";
    syncModeSeg();
    if(phaseReq) phaseReq.value = rt.phaseReqId;
    loadPhaseData();
    return;
  }
  var task = e.target.closest("[data-open-task]");
  if(task){ openTaskById(task.dataset.openTask); return; }
  var mr = e.target.closest("[data-member-drill]");
  if(mr){ openMemberDrill(mr.dataset.memberDrill, mr.dataset.memberName); return; }
  var dr = e.target.closest("[data-drill-scope]");
  if(dr){
    if(dr.dataset.drillKind === "demands") openVersionDemandsModal(dr.dataset.drillVal);
    else openDrillModal(dr.dataset.drillScope, dr.dataset.drillVal, dr.dataset.drillMetric);
    return;
  }
  var flt = e.target.closest("[data-filter]");
  if(flt){
    var seg = flt.parentNode;
    seg.querySelectorAll("button").forEach(function(b){
      b.setAttribute("aria-pressed", b === flt);
    });
    applyPhaseTblFilters();
    return;
  }
  var rst = e.target.closest("[data-tbl-reset]");
  if(rst){
    var panel = rst.closest(".panel");
    if(panel){
      panel.querySelectorAll("[data-tbl-version],[data-tbl-status],[data-tbl-owner],[data-tbl-type],[data-tbl-publish]").forEach(function(s){
        s.value = s.hasAttribute("data-tbl-version") ? "all" : "";
      });
      var kw = panel.querySelector("[data-tbl-kw]");
      if(kw) kw.value = "";
      var segEl = panel.querySelector(".seg.mini");
      if(segEl) segEl.querySelectorAll("button").forEach(function(b, i){
        b.setAttribute("aria-pressed", i === 0);
      });
      applyPhaseTblFilters();
    }
    return;
  }
  var launch = e.target.closest("[data-launch]");
  if(launch){ markFirstRelease(); return; }
  var detail = e.target.closest("[data-ver-detail]");
  if(detail){ openReleaseDetail(detail.dataset.verDetail, "plan"); return; }
  var chipBranch = e.target.closest("[data-ver-branch]");
  if(chipBranch){ openBranchById(chipBranch.getAttribute("data-ver-branch")); return; }
  var rel = e.target.closest("[data-ver-release]");
  if(rel){ publishVersion(rel.dataset.verRelease); return; }
  var st = e.target.closest("[data-ver-start]");
  if(st){ startVersion(st.dataset.verStart); return; }
  var closeVer = e.target.closest("[data-ver-close]");
  if(closeVer){ endVersion(closeVer.dataset.verClose, "closed"); return; }
  var cancelVer = e.target.closest("[data-ver-cancel]");
  if(cancelVer){ endVersion(cancelVer.dataset.verCancel, "canceled"); return; }
  var manageTasks = e.target.closest("[data-ver-tasks]");
  if(manageTasks){ openVersionTasks(manageTasks.dataset.verTasks); return; }
  var ed = e.target.closest("[data-ver-edit]");
  if(ed){ openVersionDialog(ed.dataset.verEdit); return; }
  var dl = e.target.closest("[data-ver-del]");
  if(dl){ deleteVersion(dl.dataset.verDel); return; }
  var nt = e.target.closest("[data-ver-note]");
  if(nt){ showReleaseNote(nt.dataset.verNote); return; }
  var dnote = e.target.closest("[data-ver-delivery]");
  if(dnote){ openDeliveryNote(dnote.dataset.verDelivery, ""); return; }
  var dt = e.target.closest("[data-ver-desc-toggle]");
  if(dt){
    var descP = dt.parentNode.querySelector("[data-ver-desc]");
    if(descP) descP.classList.toggle("open");
    syncVersionDescToggles();
    return;
  }
  var ua = e.target.closest("[data-unbound-assign]");
  if(ua){ openUnboundTasks(); return; }
  var msJump = e.target.closest("[data-ms-jump]");
  if(msJump){
    var ms = (cache.milestones || []).filter(function(x){ return x.id === msJump.dataset.msJump; })[0];
    if(ms) openMilestoneDetail(ms, {
      canWrite: canWritePhase(),
      onChanged: function(){ reloadView(); }
    });
    return;
  }
  /* 行级下钻放最后：前面的按钮 / 链接 / 编辑控件各自处理完，剩下的空白区域才进入详情 */
  var rowEl = e.target.closest("[data-ver-row]");
  if(rowEl){
    if(e.target.closest("button,a,input,select,label,textarea")) return;
    verInline = null;
    openVersionPage(rowEl.getAttribute("data-ver-req") || rt.phaseReqId, rowEl.getAttribute("data-ver-row"));
    return;
  }
});
if(phaseBody) phaseBody.addEventListener("change", function(e){
  var vr = e.target.closest("[data-ver-risk]");
  if(vr){ verListUi.riskOnly = !!vr.checked; paintVersionList(); return; }
  var vs = e.target.closest("[data-ver-sort]");
  if(vs){ verListUi.sort = vs.value; paintVersionList(); return; }
  var rv = e.target.closest("[data-rollup-ver]");
  if(rv){
    rollupUi.verId = rv.value;
    paintRollup();
    return;
  }
  var sf = e.target.closest("[data-schedule-filter]");
  if(sf){
    scheduleFilters[sf.dataset.scheduleFilter] = sf.value;
    loadSchedule();
    return;
  }
  var avf = e.target.closest("[data-allv-filter]");
  if(avf){
    allVersionsFilters[avf.dataset.allvFilter] = avf.value;
    renderAllVersions();
    return;
  }
  var avp = e.target.closest("[data-allv-pick]");
  if(avp){
    var vid = avp.getAttribute("data-allv-pick"), at = allVersionsSel.indexOf(vid);
    if(at === -1 && avp.checked) allVersionsSel.push(vid);
    else if(at !== -1 && !avp.checked) allVersionsSel.splice(at, 1);
    renderAllVersions();
    var again = phaseBody.querySelector('[data-allv-pick="' + vid.replace(/["\\]/g, "") + '"]');
    if(again) again.focus();
    return;
  }
  if(e.target.closest("[data-tbl-version],[data-tbl-status],[data-tbl-owner],[data-tbl-type],[data-tbl-publish]")) applyPhaseTblFilters();
});
if(phaseBody) phaseBody.addEventListener("keydown", function(e){
  /* 内联编辑：Enter 保存、Esc 取消；不把回车冒泡成行级跳转 */
  if(e.target.closest("[data-ver-inline-input]")){
    if(e.key === "Enter"){ e.preventDefault(); saveVersionInline(); }
    else if(e.key === "Escape"){ e.preventDefault(); cancelVersionInlineEdit(); }
    return;
  }
  if(e.key !== "Enter" && e.key !== " ") return;
  var verRow = e.target.closest ? e.target.closest("[data-ver-row]") : null;
  if(verRow && verRow === e.target){
    e.preventDefault();
    openVersionPage(verRow.getAttribute("data-ver-req") || rt.phaseReqId, verRow.getAttribute("data-ver-row"));
    return;
  }
  var row = e.target.closest ? e.target.closest("tr[data-rollup-group]") : null;
  if(row && row === e.target){ e.preventDefault(); row.click(); }
});
if(phaseBody) phaseBody.addEventListener("input", function(e){
  if(e.target.closest("[data-ver-q]")){ verListUi.q = e.target.value; paintVersionList(); return; }
  if(e.target.closest("[data-allv-kw]")){
    allVersionsFilters.q = e.target.value;
    renderAllVersions();
    var kw = phaseBody.querySelector("[data-allv-kw]");
    if(kw){ kw.focus(); kw.setSelectionRange(kw.value.length, kw.value.length); }
    return;
  }
  if(e.target.closest("[data-tbl-kw]")) applyPhaseTblFilters();
});
/* 列数随窗口变化，说明的截断与否要重新量 */
window.addEventListener("resize", function(){
  if(document.body.dataset.view === "phase") syncVersionDescToggles();
});

function setPhaseProject(reqId, mode){
  if(!reqId) return;
  rt.phaseReqId = reqId;
  if(mode === "phase" || mode === "version" || mode === "overview" || mode === "allversions") viewMode = mode;
  else if(viewMode === "overview") viewMode = "phase";
  if(document.body.dataset.view === "phase"){
    syncModeSeg();
    syncReqSel();
    loadPhaseData();
  }
}
export { enterPhaseView, ensureEpicOptions, ensureFoundVersionOptions, ensureVersionOptions, exportReleaseRecordCSV, invalidateTaskOptionsCache, loadPhaseData, openVersionTool, reloadView, renderPhaseView, setPhaseProject, showReleaseNote };
