/* views/phase · 版本：按阶段（首版/迭代）与按版本（三态版本卡）双口径 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { canEditReq, reqNameById, rt, state, taskCacheExtra } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { normalizedIds, taskVersionIds, taskVersionsText, sameIds, taskPublicationHTML, fmtReleaseTime, localDatetime, releaseEnvironmentName, releaseOperationName, releasePlanTime, releaseSnapshotHTML, COLUMNS, colName, fmtMinutesShort, versionPhaseInfoHTML, addDays, iso } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { branchMetaById, branchNameById, loadBranches, openBranchById, requestBranchStatus } from "./branches.js";
import { openDemandDetailById } from "./demands.js";

/* datetime-local 按分钟记录：秒级差异既不可读，也会让未改动的计划被误判为有草稿 */
function localMinute(s){ var text = localDatetime(s); return text ? text.slice(0, 16) : text; }

var phaseReq = $("phaseReq"), phaseMeta = $("phaseMeta"), phaseBody = $("phaseBody"),
    vName = $("vName"), vStart = $("vStart"), vTarget = $("vTarget"), vDesc = $("vDesc"),
    fVerName = $("fVerName"), btnSaveVer = $("btnSaveVer"), verFormTitle = $("verFormTitle");

var editingVerId = null;
/* 打开编辑时的版本令牌：保存时不能从缓存重读（缓存可能已被迟到的列表响应换掉，静默覆盖并发修改） */
var editingVerRevision = null, editingVerStatus = null;
var viewMode = "phase";            /* phase | version | allversions | schedule | overview */
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
  return (d && String(d) > String(firstRel)) ? "post" : "mvp";
}

/* ---------- 数据加载 ---------- */

function syncReqSel(){
  if(!phaseReq) return;
  /* 归档项目默认不出现在切换器里，但当前正在看的那一个保留，避免视图突然跳走 */
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === rt.phaseReqId; });
  phaseReq.innerHTML = list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
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
  var current = ++loadSeq;
  return Promise.all([
    API.get("/api/phase/stats", { reqId: reqId }),
    API.get("/api/versions/stats", { reqId: reqId }),
    API.get("/api/versions", { reqId: reqId }),
    API.get("/api/versions/task-options", { reqId: reqId })
  ]).then(function(rs){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "overview" || viewMode === "schedule" || viewMode === "allversions") return;
    cache = { phase: rs[0], vstats: rs[1], versions: rs[2], tasks: rs[3] };
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
  var afterReqs = function(){
    syncReqSel();
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
  return { released:"已发布", active:"进行中", planned:"计划中" }[st] || (st || "—");
}
function versionStatusTag(st){
  var cls = st === "released" ? "tag-success" : (st === "active" ? "tag-info" : "tag-neutral");
  return '<span class="tag ' + cls + '">' + esc(versionStatusName(st)) + '</span>';
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
    allVersionsCache.forEach(function(r){ alive[r.versionId] = true; });
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
      body += '<tr' + (on ? ' class="is-selected"' : '') + '>'
        + '<td class="allv-checkcol"><label class="allv-pick"><input type="checkbox" data-allv-pick="' + esc(r.versionId) + '"'
          + (on ? ' checked' : '') + (r.canManage ? '' : ' disabled') + ' aria-label="选择 ' + esc(r.versionName) + '"></label></td>'
        + '<td><div class="allv-vname">' + esc(r.versionName) + '</div><div class="allv-vsub">'
          + (r.versionStatus === "released" ? '已发布 · 内容只读' : '工作项 ' + (r.taskCount == null ? "—" : r.taskCount) + ' 项') + '</div></td>'
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
    + '<label class="phase-filter">项目' + allVersionsSelect("project", [["", "全部项目"]].concat(projectIds.map(function(id){ return [id, projectNames[id]]; })), allVersionsFilters.project, "按项目筛选") + '</label>'
    + '<label class="phase-filter">状态' + allVersionsSelect("status", [["", "全部状态"], ["active", "进行中"], ["planned", "计划中"], ["released", "已发布"]], allVersionsFilters.status, "按状态筛选") + '</label>'
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
  var picked = allVersionsSel.map(function(id){ return map[id]; }).filter(function(r){ return r && r.canManage; });
  if(!picked.length){ toast("先勾选至少一个可管理的版本", "warn"); return; }
  var anchor = picked[0];
  var known = { id: anchor.versionId, reqId: anchor.reqId, name: anchor.versionName, status: anchor.versionStatus,
    targetDate: anchor.targetDate, canManageReleasePlan: true, canPublish: false };
  openReleaseDetail(anchor.versionId, "plan", null, known, picked.map(function(r){ return r.versionId; }), true);
}

/* ---------- 发布日程（跨项目只读汇总） ---------- */

function planStatusTag(st){
  var meta = { ready:["就绪", "tag-info"], completed:["已完成", "tag-success"],
    canceled:["已取消", "tag-neutral"], draft:["草稿", "tag-neutral"] }[st];
  meta = meta || [st || "—", "tag-neutral"];
  return '<span class="tag ' + meta[1] + '">' + meta[0] + '</span>';
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
    var versionText = r.versionNames || r.versionName || "—";
    var projectText = r.projectNames || r.projectName || "—";
    return '<tr data-schedule-open="' + esc(r.id) + '" data-schedule-version="' + esc(r.versionId) + '" data-schedule-project="' + esc(r.reqId) + '" title="打开该计划（含全部版本）的发布计划与发布记录">'
      + '<td>' + esc(planTime) + (late ? ' <span class="tag tag-warning">已过期</span>' : '') + '</td>'
      + '<td>' + nameChips(projectText, 2, "项目") + '</td>'
      + '<td>' + nameChips(versionText, 2, "版本") + '</td>'
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
    + select("project", [["", "全部项目"]].concat(projects.map(function(r){ return [r.id, r.name]; })), f.project, "项目")
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
  if($("btnVerNew")) $("btnVerNew").style.display = (allProjects || !canWritePhase()) ? "none" : "";
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
      return !(d0 && String(d0) <= String(firstRel));
    }
    /* 上线前未绑版本任务自动归入首版版本：下钻口径与版本卡一致 */
    if(val === preId){
      var d = t.completedAt || t.startDate || t.dueDate || "";
      return !!(d && String(d) <= String(firstRel));
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
      + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</td>'
      + '<td>' + esc(typeName(t.itemType)) + '</td>'
      + '<td>' + esc(t.owner || "—") + '</td>'
      + '<td class="num">' + dateShort(t.startDate) + '</td>'
      + '<td class="num">' + dateShort(t.dueDate) + '</td>'
      + '<td class="num">' + (est ? fmtMinutesShort(est) : "—") + '</td>'
      + '<td class="num">' + (act ? fmtMinutesShort(act) : "—") + '</td>'
      + '<td>' + (t.boardColumn === "done"
        ? '<span class="tag tag-success">已完成</span>'
        : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td></tr>';
  }).join("") || '<tr><td colspan="8" class="foot-note" style="padding:16px;text-align:center">该口径下暂无工作项</td></tr>';
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
      toast("已按版本筛选看板：" + scopeName + "，已完成列显示全部");
      return;
    }
    var t = e.target.closest("[data-open-task]");
    if(t){ UI.closeModal(layer); openTaskById(t.dataset.openTask); }
  });
  UI.openModal(layer);
}

/* 版本需求下钻：已排需求/已排期需求格点击，列出排到该版本的需求（与计数同口径：不含已拒绝），行点击开需求详情 */
function demandStatusLabel(st){
  return st === "plan" ? "已排期" : st === "pass" ? "已通过" : st === "rej" ? "已拒绝" : (st === "canceled" || st === "cancelled") ? "已取消" : "待评审";
}
function openVersionDemandsModal(versionId){
  var v = findVersion(versionId);
  var name = v ? v.name : "版本";
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
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
    var d = e.target.closest("[data-open-demand]");
    if(d){ UI.closeModal(layer); openDemandDetailById(d.dataset.openDemand); }
  });
  UI.openModal(layer);
  API.getAllPages("/api/demands", { reqId: rt.phaseReqId }).then(function(demands){
    if(!document.body.contains(layer)) return;
    var rows = (demands || []).filter(function(d){ return d.versionId === versionId && d.status !== "rej"; });
    var body = rows.map(function(d){
      return '<tr data-open-demand="' + esc(d.id) + '" title="查看需求详情">'
        + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(d.title) + '</td>'
        + '<td>' + esc(d.itemKind || "其他") + '</td>'
        + '<td><span class="tag ghost">' + esc(demandStatusLabel(d.status)) + '</span></td>'
        + '<td>' + esc(d.priority || "—") + '</td></tr>';
    }).join("") || '<tr><td colspan="4" class="foot-note" style="padding:16px;text-align:center">该版本没有已排需求</td></tr>';
    layer.querySelector(".desc").textContent = "共 " + rows.length + " 项 · 点击需求行打开详情";
    layer.querySelector(".tbl-wrap").innerHTML = '<table class="phase-tbl"><thead><tr>'
      + '<th>需求</th><th>类型</th><th>状态</th><th>优先级</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }).catch(function(ex){
    if(!document.body.contains(layer)) return;
    layer.querySelector(".tbl-wrap").innerHTML = UI.errorState(ex.message || "已排需求加载失败");
  });
}

/* 成员阶段工时下钻：按该成员自己的计时记录列出「任务 × 阶段」，合计与阶段卡一致 */
var memberDrillSeq = 0;
function memberDrillRowHTML(r){
  var est = r.estimateMinutes || 0, act = r.minutes || 0;
  return '<tr data-open-task="' + esc(r.taskId) + '" title="打开工作项详情">'
    + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(r.title) + '</td>'
    + '<td>' + (r.phase === "mvp" ? '<span class="tag tag-info">首版</span>' : '<span class="tag tag-plum">迭代</span>') + '</td>'
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
        body = '<tr><td colspan="8" class="foot-note" style="padding:16px;text-align:center">该成员在此项目暂无计时记录</td></tr>';
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
      if(t){ UI.closeModal(layer); openTaskById(t.dataset.openTask); }
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
    [t.startDate, t.dueDate, t.completedAt].forEach(function(d){
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
      + '<td>' + (r.post > r.mvp ? '<span class="tag tag-plum">迭代为主</span>' : '<span class="tag tag-info">首版为主</span>') + '</td></tr>';
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
      groupCell = ph === "mvp" ? '<span class="tag tag-info">首版</span>' : '<span class="tag tag-plum">迭代</span>';
    }else{
      group = "";
      groupCell = '<span class="tag ghost">' + esc(taskVersionsText(t) || "待规划") + '</span>';
    }
    return '<tr data-groups="' + esc(JSON.stringify(mode === "phase" ? [group] : (taskVersionIds(t).length ? taskVersionIds(t) : [""]))) + '" data-group="' + esc(group) + '" data-open-task="' + esc(t.id) + '"'
      + ' data-status="' + esc(t.boardColumn || "") + '"'
      + ' data-owner="' + esc(t.owner || "") + '"'
      + ' data-type="' + esc(t.itemType || "task") + '"'
      + ' data-search="' + esc(String(t.title || "").toLowerCase()) + '"'
      + ' title="打开工作项详情">'
      + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</td>'
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
  }).join("") || '<tr><td colspan="10" class="foot-note" style="padding:16px;text-align:center">该项目还没有工作项</td></tr>';
  var segOpts;
  if(mode === "phase"){
    segOpts = [["all", "全部"], ["mvp", "首版开发"], ["post", "迭代维护"]];
  }else{
    segOpts = [["all", "全部"]].concat(cache.versions.map(function(v){ return [v.id, v.name]; }))
      .concat(cache.tasks.some(function(t){ return !taskVersionIds(t).length; }) ? [["", "待规划"]] : []);
  }
  var seg = '<div class="seg mini">' + segOpts.map(function(o, i){
    return '<button type="button" data-filter="' + esc(o[0]) + '"' + (i === 0 ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(o[1]) + '</button>';
  }).join("") + '</div>';
  var head = mode === "phase" ? "工作项明细 · 按阶段" : "工作项明细 · 按计划版本";

  /* 维度筛选：状态 / 负责人 / 类型 / 标题关键字，与阶段-版本分段叠加生效 */
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
      + filterSelect("data-tbl-status", "状态", statusOpts, "全部状态")
      + filterSelect("data-tbl-owner", "负责人", ownerOpts, "全部负责人")
      + filterSelect("data-tbl-type", "类型", typeOpts, "全部类型")
      + '<label class="phase-filter"><span>关键字</span><input type="search" class="phase-filter-input" data-tbl-kw placeholder="搜索工作项标题" aria-label="搜索工作项标题"></label>'
      + '<span class="phase-tbl-count" data-tbl-count></span>'
      + '<button class="btn sm" type="button" data-tbl-reset disabled>重置筛选</button>'
      + '</div>'
    : "";
  var emptyRow = cache.tasks.length
    ? '<tr data-tbl-empty hidden><td colspan="10" class="foot-note" style="padding:16px;text-align:center">没有符合筛选条件的工作项</td></tr>'
    : "";
  return '<div class="panel"><div class="panel-head"><h3>' + head + '</h3>'
    + '<span class="meta-right">计划起止 · 预估 / 实际 · 偏差 · 点击行打开工作项</span>' + seg + '</div>'
    + tools
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr><th>工作项</th>'
    + (mode === "phase" ? "<th>阶段</th>" : "<th>版本</th>")
    + '<th>类型</th><th>负责人</th><th class="num">计划开始</th><th class="num">计划结束</th><th class="num">预估</th><th class="num">实际</th><th>偏差</th><th>状态</th></tr></thead>'
    + '<tbody id="phaseTblBody">' + rows + emptyRow + '</tbody></table></div></div>';
}

/* 阶段/版本分段、状态、负责人、类型、关键字任一变化都按交集重算可见行 */
function applyPhaseTblFilters(){
  var body = $("phaseTblBody");
  if(!body) return;
  var panel = body.closest(".panel");
  if(!panel) return;
  var statusEl = panel.querySelector("[data-tbl-status]");
  var ownerEl = panel.querySelector("[data-tbl-owner]");
  var typeEl = panel.querySelector("[data-tbl-type]");
  var kwEl = panel.querySelector("[data-tbl-kw]");
  var status = statusEl ? statusEl.value : "";
  var owner = ownerEl ? ownerEl.value : "";
  var type = typeEl ? typeEl.value : "";
  var kw = kwEl ? kwEl.value.trim().toLowerCase() : "";
  var segBtn = panel.querySelector(".seg.mini button[aria-pressed='true']");
  var group = segBtn ? segBtn.dataset.filter : "all";
  var shown = 0, total = 0;
  body.querySelectorAll("tr[data-open-task]").forEach(function(tr){
    total++;
    var ok = (group === "all" || JSON.parse(tr.dataset.groups || '[]').indexOf(group) !== -1)
      && (!status || tr.dataset.status === status)
      && (!owner || tr.dataset.owner === owner)
      && (!type || tr.dataset.type === type)
      && (!kw || (tr.dataset.search || "").indexOf(kw) >= 0);
    tr.style.display = ok ? "" : "none";
    if(ok) shown++;
  });
  var empty = panel.querySelector("[data-tbl-empty]");
  if(empty) empty.hidden = !(total > 0 && shown === 0);
  var count = panel.querySelector("[data-tbl-count]");
  if(count) count.textContent = "显示 " + shown + " / " + total;
  var reset = panel.querySelector("[data-tbl-reset]");
  if(reset) reset.disabled = !(status || owner || type || kw || group !== "all");
}
function renderPhaseMode(){
  var p = cache.phase;
  var firstRel = p.firstReleasedAt;
  if(phaseMeta){
    phaseMeta.textContent = reqNameById(rt.phaseReqId)
      + (firstRel ? (" · 首版上线 " + firstRel + " · 双阶段统计") : " · 未标记上线，投入全部归入首版开发");
  }
  var mvpCard = phaseCardHTML("tag-info", "首版开发",
    (firstRel ? (dateShort(firstRel) + " 之前 · 上线前全部投入") : "项目启动 ~ 上线 · 全部投入"),
    phaseCells(p.mvp, false), { scope: "phase", val: "mvp" });
  var postCard;
  /* post 由后端恒返回（零值对象），是否进入双阶段以 firstReleasedAt 为准 */
  if(firstRel){
    postCard = phaseCardHTML("tag-plum", "迭代维护",
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
    + memberTable()
    + taskTable("phase");
  applyPhaseTblFilters();
}

/* ===== 按版本 ===== */

/* 版本周期窗口：开始–目标，如「11/10–11/24」；无开始只有目标时返回空（调用处另行展示目标日） */
function cycleWindow(v){
  if(!v || !v.startDate) return "";
  if(v.targetDate && v.targetDate !== v.startDate) return dateShort(v.startDate) + "–" + dateShort(v.targetDate);
  return dateShort(v.startDate) + " 起";
}

function versionDeliverySummary(v){
  /* 摘要与「查看实际记录」拆开：摘要可截断，入口不会被截断吃掉 */
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
function versionCardHTML(v){
  var st = v.status;
  var stTag = st === "released" ? '<span class="tag tag-success">已发布</span>'
    : (st === "active" ? '<span class="tag tag-info">开发中</span>' : '<span class="tag ghost">待规划</span>');
  var cls = st === "released" ? "ver-rel" : (st === "active" ? "ver-doing" : "ver-plan");
  var sub;
  var win = cycleWindow(v);
  if(st === "released"){
    sub = (v.preLaunchCount > 0)
      ? dateShort(v.releasedAt) + " · 首版（上线前投入自动归入）"
      : (win ? win + " · " : "") + dateShort(v.releasedAt) + " 发布" + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "");
  }
  else if(st === "active") sub = win + " · 开发中" + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "");
  else sub = (win ? win + " · 待规划" : "待规划") + (!win && v.targetDate ? (" · 目标就绪日 " + dateShort(v.targetDate)) : "") + (v.scheduledDemandCount ? (" · 需求池已排 " + v.scheduledDemandCount + " 项") : "");
  var cells;
  if(st === "released"){
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
  acts += '<button class="btn sm" type="button" data-ver-detail="' + esc(v.id) + '" title="查看计划与发布历史">计划与历史</button>';
  acts += '<button class="btn sm ghost" type="button" data-ver-note="' + esc(v.id) + '">' + (st === "released" ? '发布说明' : '当前规划说明') + '</button>';
  if(permissions.canPublish === true) acts += '<button class="btn sm primary" type="button" data-ver-release="' + esc(v.id) + '">记录实际发布</button>';
  var contentLocked = versionContentLocked(permissions) || versionContentLocked(v);
  if(contentLocked) acts += '<span class="tag tag-neutral">正式发布后内容只读</span>';
  if(!contentLocked && writable){
    if(st === "planned"){
      acts += '<button class="btn sm" type="button" data-ver-start="' + esc(v.id) + '">开始开发</button>';
    }
    acts += '<button class="btn sm ghost" type="button" data-ver-tasks="' + esc(v.id) + '">管理工作项</button>';
    acts += '<button class="btn sm ghost" type="button" data-ver-edit="' + esc(v.id) + '">编辑</button>';
  }
  if(isOwner() && !contentLocked){
    acts += '<button class="btn sm ghost danger" type="button" data-ver-del="' + esc(v.id) + '">删除</button>';
  }
  acts += '</div>';
  /* 说明只留两行：长文案会把整行版本卡撑到一屏高；是否被截断在渲染后量出来再决定要不要给展开入口 */
  var descHTML = v.description
    ? '<div class="ver-desc-wrap"><p class="ver-desc" data-ver-desc title="' + esc(v.description) + '">' + esc(v.description) + '</p>'
      + '<button class="link-cell ver-desc-toggle" type="button" data-ver-desc-toggle hidden>展开说明</button></div>'
    : "";
  return '<div class="phase-card ' + cls + '"><div class="phase-card-head">'
    + '<span class="tag tag-primary">' + esc(v.name) + '</span>' + stTag
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
    + branchChipsHTML(v.branches)
    + descHTML
    + metricCells(cells, { scope: "version", val: v.id }) + versionDeliverySummary(v) + acts + '</div>';
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
function renderVersionMode(){
  var p = cache.phase;
  if(phaseMeta){
    phaseMeta.textContent = reqNameById(rt.phaseReqId) + " · 按版本分组 · 共 " + cache.versions.length + " 个版本";
  }
  var cards = cache.vstats.versions.map(versionCardHTML).join("");
  var u = cache.vstats.unbound;
  var unboundTasks = cache.tasks.filter(function(t){ return !taskVersionIds(t).length; });
  var writableVer = cache.versions.some(function(v){ return !versionContentLocked(v); });
  var unboundAssign = (canWritePhase() && unboundTasks.length && writableVer)
    ? '<div class="phase-acts"><button class="btn sm" type="button" data-unbound-assign>分配工作项到版本</button></div>'
    : "";
  var unboundCard = '<div class="phase-card ver-plan"><div class="phase-card-head">'
    + '<span class="tag ghost">待规划</span><span class="phase-card-sub">未绑定版本的工作项</span></div>'
    + branchChipsHTML(u.branches)
    + metricCells([
      [u.taskCount, "待规划工作项", ""],
      [u.doneCount, "已完成", ""],
      [fmtMinutesShort(u.estimateMinutes), "预估工时", ""],
      [fmtMinutesShort(u.remainingMinutes), "剩余预估", ""]
    ], { scope: "version", val: "" }) + unboundAssign + '</div>';
  var relCount = cache.versions.filter(function(v){ return v.status === "released"; }).length;
  var caliber = '<p class="foot-note" style="margin:0">工作项按「计划版本」归组，需求按「目标版本」规划；'
    + '首版上线前未绑版本的工作项在统计中归入最早已发布版本（不代表实际交付），其余未绑工作项归「待规划」；已发布 '
    + relCount + ' 个版本 · 偏差 =（实际 − 预估）÷ 预估，±15% 内为准确</p>';
  if(!cache.versions.length && !cache.tasks.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"点右上角「新建版本」创建第一个版本；工作项在详情抽屉里选择计划版本。"
    });
    return;
  }
  phaseBody.innerHTML = '<div class="ver-grid">' + cards + unboundCard + '</div>' + caliber + taskTable("version");
  syncVersionDescToggles();
  applyPhaseTblFilters();
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
function releaseStatusName(status){ return {draft:"草稿", ready:"就绪", completed:"已完成", canceled:"已取消"}[status] || "未创建"; }
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
    var versions = (cache && cache.versions) || [];
    if(!versions.length){ toast("该项目还没有版本，先新建版本再制定发布计划", "warn"); return; }
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
/* 独立真实 ESM 弹窗：关闭/切项目/切路由/切空间后不渲染迟到响应。 */
function releaseDialog(v, title, onClose){
  var layer = document.createElement("div"), disposed = false;
  var reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, route = document.body.dataset.view;
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", title);
  layer.__uiOnClose = function(){ disposed = true; if(onClose) onClose(); setTimeout(function(){ layer.remove(); }, 0); };
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
function releaseRecordHTML(record){ return releaseSnapshotHTML(record); }
function exportReleaseRecordCSV(record){
  var lines = [["发布记录ID", record.id], ["项目ID", record.reqId], ["项目", record.projectName], ["版本ID", record.versionId], ["版本", record.versionName], ["计划ID", record.planId], ["计划修订", record.planRevision], ["计划时间（不可变快照）", releasePlanTime(record)], ["实际时间UTC", record.occurredAt], ["记录时间UTC", record.recordedAt],
    ["环境", record.environment], ["操作", record.operation], ["结果", record.result], ["目标键", JSON.stringify(record.targetKeys || [])], ["覆盖", record.coverage], ["制品引用", record.artifactRef], ["SHA256", record.artifactDigest], ["关联发布ID", record.relatedReleaseId],
    ["记录人ID", record.recordedByUserId || record.releasedBy], ["记录人", record.recordedByName || record.releasedByName], ["实际执行人ID", record.executorUserId], ["实际执行人", record.executorName], ["幂等键", record.idempotencyKey], ["偏差理由", record.deviationReason], ["说明", record.notes], ["失败原因", record.failureReason],
    [], ["工作项ID", "标题快照", "负责人ID", "负责人", "需求ID", "需求标题", "实际记录版本ID", "实际记录版本", "需求目标版本ID", "需求目标版本", "工作状态快照", "完成日期", "处理结果", "实际分钟", "预估分钟"]];
  (record.items || []).forEach(function(item){ lines.push([item.taskId, item.title, item.ownerUserId, item.ownerName, item.demandId, item.demandTitle, record.versionId, record.versionName, item.targetVersionId, item.targetVersionName, item.boardColumn, item.completedAt, item.disposition, item.workMinutes, item.estimateMinutes]); });
  var url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(function(row){ return row.map(csvCell).join(","); }).join("\r\n")], {type:"text/csv;charset=utf-8"}));
  var a = document.createElement("a"); a.href = url; a.download = "发布快照-" + (record.versionName || "版本") + "-" + record.id + ".csv";
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function publishVersion(id){ openReleaseDetail(id, "actual"); }
function openReleaseDetail(id, entry, onClose, knownVersion, presetVersionIds, forceNewPlan){
  var v = knownVersion || findVersion(id);
  if(!v) return;
  var dlg = releaseDialog(v, "发布工作区", onClose), layer = dlg.layer;
  var base = "/api/versions/" + encodeURIComponent(id), reqId = v.reqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id;
  var syncBannerTimer = null, syncRowTimer = null, syncDebounceTimer = null, pendingBranchId = null;
  var justSynced = {};      /* 最近一次同步变化的分支 id，8 秒内重画也保留高亮 */
  document.addEventListener("ds:sse-entity", onBranchSync);
  var prevClose = layer.__uiOnClose;
  layer.__uiOnClose = function(){
    document.removeEventListener("ds:sse-entity", onBranchSync);
    if(syncBannerTimer){ clearTimeout(syncBannerTimer); syncBannerTimer = null; }
    if(syncRowTimer){ clearTimeout(syncRowTimer); syncRowTimer = null; }
    if(syncDebounceTimer){ clearTimeout(syncDebounceTimer); syncDebounceTimer = null; }
    if(prevClose) prevClose();
    /* 弹窗关掉后再开抽屉：抽屉层级低于弹窗，且关闭时可能还有未保存确认 */
    if(pendingBranchId){ var bid = pendingBranchId; pendingBranchId = null; setTimeout(function(){ openBranchById(bid); }, 0); }
  };
  var storageKey = "hourglass:release-pending:" + JSON.stringify([wsId, userId, id]);
  var plans = [], planId = null, records = [], tasks = [], members = [], preview = null, previewContext = null;
  var busy = false, loadSeq = 0, previewSeq = 0, mayManage = false, mayPublish = false;
  var planOptions = null, planScopeVersionIds = null, planTaskPoolCache = {}, planTaskFetchKey = "", planTaskErrorKey = "", planTaskSeq = 0;
  var presetPlanVersionIds = presetVersionIds && presetVersionIds.length ? normalizedIds(presetVersionIds) : null;
  var pending = null, storageError = "", recoveryMessage = "", recoveredRecord = null, retryAllowed = false, resetAllowed = false;
  var page = 0, filters = {result:"", environment:"", operation:""}, advancedOpen = false;
  /* 计划 / 实际 / 历史 / 内容 四个工作面，入口决定初始页；入口只决定看哪页，不再用顶部报错兜底 */
  var activeTab = entry === "actual" ? "actual" : "plan", planJustSaved = false, planSavedRevision = null, restoreScroll = null, entryFocus = entry === "actual";
  var actualDraft = {planId:"", occurredAt:localMinute(), environment:"production", targetKeys:"", coverage:"full", artifactRef:"", artifactDigest:"", operation:"deploy", relatedReleaseId:"", executorUserId:"", actualTaskIds:[], deviationReason:"", result:"success", notes:"", failureReason:""};
  var actualPlanTouched = false;
  try{
    var stored = sessionStorage.getItem(storageKey);
    if(stored){
      pending = JSON.parse(stored);
      if(!pending || !pending.body || !pending.body.idempotencyKey || !Array.isArray(pending.body.actualTaskIds) || !Array.isArray(pending.body.targetKeys)) throw new Error("待确认请求格式异常");
    }
  }catch(ex){ storageError = "无法安全读取待确认请求；禁止新建事件，请恢复会话存储后重开。"; }
  function current(){
    if(userId !== (rt.currentUser || {}).id){ UI.closeModal(layer); return false; }
    return dlg.current();
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
    var html = groups.map(function(project){
      var projectCount = (project.versions || []).filter(function(ver){ return selected.indexOf(ver.id) !== -1; }).length;
      return '<div class="release-version-group" role="group" aria-label="' + esc(project.name || project.id) + '"><div class="release-version-project"><span class="release-version-project-name">' + esc(project.name || project.id) + '</span><span class="release-version-project-count' + (projectCount ? ' is-on' : '') + '" data-plan-version-group-count="' + esc(project.id) + '">' + (projectCount ? projectCount + ' / ' + (project.versions || []).length : '未选') + '</span></div>'
        + (project.versions || []).map(function(ver){
          var on = selected.indexOf(ver.id) !== -1, fixed = ver.id === id;
          return '<label class="release-version-row' + (on ? ' is-selected' : '') + (fixed ? ' is-fixed' : '') + '"' + (fixed ? ' title="当前版本固定包含在计划中"' : '') + '><input type="checkbox" data-plan-version="' + esc(ver.id) + '"' + (on ? ' checked' : '') + (disabled || fixed ? ' disabled' : '') + '><span><b>' + esc(ver.name || ver.id) + '</b><small>' + esc(versionStatusName(ver.status)) + (ver.targetDate ? ' · 目标 ' + esc(ver.targetDate) : '') + (fixed ? ' · 当前版本' : '') + '</small></span></label>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="release-version-picker" role="group" aria-label="计划包含的版本">' + html + '</div>'
      + '<p class="hint">计划可跨版本、跨项目；当前版本固定包含。计划只是意图，实际发布仍按单个版本登记，全部包含版本都完成生产部署 / 重部署后计划才自动完成。</p>';
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
    return planWhen(item) + " · " + releaseStatusName(item.status) + " · " + releaseEnvironmentName(item.environment) + " · " + coverageName(item.coverage) + " · " + normalizedIds(item.plannedTaskIds).length + " 项 · #" + String(item.id || "").slice(-6) + planVersionSummary(item);
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
    if(!a.planId) return {text:"未关联计划：按紧急记录处理，确认时需填写事实理由。", warn:false};
    if(!p) return {text:"所选计划不在当前列表中，请重新选择。", warn:true};
    var diffs = [];
    if(p.environment !== a.environment) diffs.push("环境为" + releaseEnvironmentName(p.environment) + "，当前实际为" + releaseEnvironmentName(a.environment));
    if(p.coverage !== a.coverage) diffs.push("覆盖为" + coverageName(p.coverage) + "，当前实际为" + coverageName(a.coverage));
    if(p.status !== "ready") diffs.push("状态为" + releaseStatusName(p.status));
    if(normalizedIds(p.versionIds).length && normalizedIds(p.versionIds).indexOf(id) === -1) diffs.push("计划不包含当前版本");
    var base = "计划 " + planWhen(p) + " · " + releaseEnvironmentName(p.environment) + " · " + coverageName(p.coverage) + " · " + normalizedIds(p.plannedTaskIds).length + " 项 · #" + String(p.id || "").slice(-6) + planVersionSummary(p);
    var multi = normalizedIds(p.versionIds).length > 1 ? "；本次只登记当前版本，全部包含版本生产成功后才自动完成计划。" : "";
    return {text: base + (diffs.length ? "；" + diffs.join("；") + "，确认时需填写偏差理由。" : "；环境、覆盖与状态一致。") + multi, warn:!!diffs.length};
  }
  function planSummaryHTML(a){
    var s = planSummaryInfo(a);
    return '<p class="release-plan-summary' + (s.warn ? ' is-warn' : '') + '" data-release-plan-summary role="status">' + esc(s.text) + '</p>';
  }
  function memberOptions(chosen, retain){
    var pairs = [["", "请选择当前成员"]].concat(members.map(function(m){ return [m.userId || m.id, m.displayName || m.username || m.userId || m.id]; }));
    if(retain && chosen && !pairs.some(function(p){ return p[0] === chosen; })) pairs.push([chosen, chosen + "（原负责人）"]);
    return options(pairs, chosen);
  }
  function taskRows(prefix, ids, disabled){
    var actualPlan = plans.find(function(p){ return p.id === actualDraft.planId; });
    var planVids = prefix === "plan" ? planVersionSelection() : [id];
    var loadedPool = prefix === "plan" ? planPool() : null;
    var pool = (loadedPool || tasks).filter(function(t){ return planVids.some(function(vid){ return taskVersionIds(t).indexOf(vid) !== -1; }) || ids.indexOf(t.id) !== -1 || (prefix === "actual" && normalizedIds((actualPlan || {}).plannedTaskIds).indexOf(t.id) !== -1); });
    var ref = records.find(function(r){ return r.id === actualDraft.relatedReleaseId; });
    if(prefix === "actual" && ref) (ref.items || []).forEach(function(s){ if(!pool.some(function(t){ return t.id === s.taskId; })) pool.push({id:s.taskId, title:s.title, boardColumn:"snapshot", versionIds:taskVersionIds(s), versionNames:s.versionNames}); });
    var retained = prefix === "actual" ? ids.concat(normalizedIds((actualPlan || {}).plannedTaskIds).filter(function(tid){ return tasks.some(function(t){ return t.id === tid && taskVersionIds(t).indexOf(id) !== -1; }); })) : ids;
    normalizedIds(retained).forEach(function(tid){ if(!pool.some(function(t){ return t.id === tid; })) pool.push({id:tid, title:tid + "（当前不可见）", boardColumn:"snapshot", versionIds:[]}); });
    var unbound = prefix === "plan" && planVids.length <= 1 ? tasks.filter(function(t){ return !taskVersionIds(t).length; }).length : 0;
    var selectedCount = pool.filter(function(t){ return ids.indexOf(t.id) !== -1; }).length;
    return '<div class="release-picker" data-' + prefix + '-picker>'
      + '<div class="release-picker-tools">'
      + '<input type="search" data-' + prefix + '-search placeholder="搜索标题或 ID" aria-label="搜索工作项">'
      + '<select data-' + prefix + '-filter aria-label="筛选工作项状态">' + options([["", "全部状态"], ["done", "仅已完成"], ["open", "仅未完成"]], "") + '</select>'
      + '<button class="btn sm" type="button" data-' + prefix + '-all' + (disabled ? ' disabled' : '') + '>全选可见</button>'
      + '<button class="btn sm" type="button" data-' + prefix + '-done' + (disabled ? ' disabled' : '') + '>仅选已完成</button>'
      + '<button class="btn sm" type="button" data-' + prefix + '-clear' + (disabled ? ' disabled' : '') + '>清空</button>'
      + '<span class="release-picker-count" data-' + prefix + '-count role="status">已选 ' + selectedCount + ' / 共 ' + pool.length + '</span>'
      + '</div>'
      + (prefix === "plan" && planVids.length > 1 && !loadedPool ? '<p class="hint">正在加载所选版本的工作项…</p>' : '')
      + (unbound ? '<p class="hint">另有 ' + unbound + ' 个未绑定版本的工作项，不属于本版本范围，不能选入。</p>' : '')
      + '<div class="release-task-picker" data-' + prefix + '-list>' + pool.map(function(t){
        var allowed = prefix !== "actual" || actualDraft.operation !== "rollback" || (ref && recordTaskIds(ref).indexOf(t.id) !== -1);
        return '<label class="version-task-row release-task-row" data-task-row data-task-id="' + esc(t.id) + '" data-task-title="' + esc(String(t.title || "").toLowerCase()) + '" data-task-state="' + (t.boardColumn === "done" ? "done" : "open") + '"><input type="checkbox" data-' + prefix + '-task="' + esc(t.id) + '"' + (ids.indexOf(t.id) !== -1 ? ' checked' : '') + (disabled || !allowed ? ' disabled' : '') + '><span><b>' + esc(t.title) + '</b><small>' + esc(colName(t.boardColumn)) + ' · 完成 ' + esc(fmtReleaseTime(t.completedAt)) + ' · 版本 ' + esc(taskVersionsText(t) || "待规划") + '</small></span></label>';
      }).join('') + '</div>'
      + '<p class="hint" data-' + prefix + '-empty hidden>没有匹配的工作项，试试清空搜索或切换状态。</p>'
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
    var search = old.querySelector('[data-plan-search]'), filter = old.querySelector('[data-plan-filter]');
    var q = search ? search.value : "", f = filter ? filter.value : "";
    var holder = document.createElement("div"); holder.innerHTML = taskRows("plan", ids, locked);
    old.replaceWith(holder.firstChild);
    var next = pickerBox("plan");
    if(next){
      if(q && next.querySelector('[data-plan-search]')) next.querySelector('[data-plan-search]').value = q;
      if(f && next.querySelector('[data-plan-filter]')) next.querySelector('[data-plan-filter]').value = f;
    }
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
  function filterPicker(prefix){
    var box = pickerBox(prefix); if(!box) return;
    var q = value(prefix, "search").trim().toLowerCase(), f = value(prefix, "filter"), shown = 0;
    box.querySelectorAll("[data-task-row]").forEach(function(row){
      var state = row.getAttribute("data-task-state");
      var match = (!q || (row.getAttribute("data-task-title") || "").toLowerCase().indexOf(q) !== -1 || (row.getAttribute("data-task-id") || "").toLowerCase().indexOf(q) !== -1)
        && (!f || (f === "done" ? state === "done" : state !== "done"));
      row.hidden = !match; if(match) shown++;
    });
    var empty = box.querySelector('[data-' + prefix + '-empty]'); if(empty) empty.hidden = shown !== 0;
    pickerCount(prefix);
  }
  /* 全选只作用于当前筛选可见项；仅选已完成与清空作用于全部可选行，避免筛选状态造成误判 */
  function bulkPick(prefix, mode){
    var box = pickerBox(prefix); if(!box) return;
    box.querySelectorAll("[data-task-row]").forEach(function(row){
      var cb = row.querySelector('input[data-' + prefix + '-task]');
      if(!cb || cb.disabled) return;
      if(mode === "clear") cb.checked = false;
      else if(mode === "done") cb.checked = row.getAttribute("data-task-state") === "done";
      else if(!row.hidden) cb.checked = true;
    });
    if(prefix === "actual") readActual();
    invalidatePreview();
    if(prefix === "plan") dropSavedBanner();
    error("", prefix);
    pickerCount(prefix); updateChecklists(); if(prefix === "plan") refreshPlanBranches();
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
    dlg.body.scrollTop = 0;
    if(focus && key === "actual") focusActual();
  }
  function focusActual(){
    ["[data-release-occurredAt]", "[data-release-executorUserId]", "[data-release-artifactRef]", "[data-release-artifactDigest]", "[data-release-targetKeys]"].some(function(sel){
      var el = layer.querySelector(sel);
      if(!el || String(el.value || "").trim()) return false;
      try{ el.focus({preventScroll:true}); }catch(ex){ el.focus(); }
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
  /* 刷新 / 切换计划 / 新建计划都会按已保存内容重绘计划区：有未保存改动先确认，避免静默丢草稿 */
  function confirmDiscardPlan(proceed, revert){
    if(!planDirty()){ proceed(); return; }
    UI.showConfirm({ title:"放弃未保存的计划修改？", msg:"发布计划还有未保存的改动，继续将按已保存内容重新显示。", okText:"放弃修改", cancelText:"继续编辑" })
      .then(function(ok){ if(!current()) return; if(ok) proceed(); else if(revert) revert(); });
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
        recoveredRecord = record; recoveryMessage = "已找回同一次正式记录 #" + record.id + "（" + record.result + "），不会创建重复事件。";
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
    if(confirm) confirm.disabled = busy || !mayPublish || !!pending || !!storageError || !preview || planDirty();
    layer.querySelectorAll('[data-release-save], [data-plan-new], [data-release-preview]').forEach(function(b){ b.disabled = busy || !!pending || !!storageError; });
    var retry = layer.querySelector('[data-release-retry]'); if(retry) retry.disabled = busy || !mayPublish || !retryAllowed || !!storageError;
    var reset = layer.querySelector('[data-release-reset]'); if(reset) reset.disabled = busy || !pending || !pending.rejection || !!storageError;
    layer.querySelectorAll('[data-release-refresh], [data-release-reconcile]').forEach(function(b){ b.disabled = busy; });
  }
  function setBusy(on){
    busy = on;
    layer.querySelectorAll('input, select, textarea, button').forEach(function(el){
      if(el.matches('[data-release-close]')) return;
      if(on){ el.dataset.wasDisabled = el.disabled ? "1" : "0"; el.disabled = true; }
      else if(el.dataset.wasDisabled !== undefined){ el.disabled = el.dataset.wasDisabled === "1"; delete el.dataset.wasDisabled; }
    });
    syncControls();
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
  function render(){
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
    var planSection = '<section class="release-section"><h3>发布计划</h3><div class="row row-gap"><select data-plan-select aria-label="选择独立发布计划"' + (pending ? ' disabled' : '') + '>' + options([["", "新独立计划"]].concat(planChoices), planId || "") + '</select>' + (mayManage ? '<button class="btn sm" data-plan-new type="button">新建独立计划</button>' : '') + '</div><p class="hint">计划 #' + esc(p.id || "未保存") + ' · 修订 ' + esc(p.revision || "—") + ' · ' + esc(releaseStatusName(p.status)) + ' · ' + esc(releaseEnvironmentName(p.environment || "production")) + ' · ' + esc(coverageName(p.coverage || "full")) + ' · ' + esc(planWhen(p)) + (p.versionCount > 1 ? ' · ' + esc(p.versionCount) + ' 个版本（已完成 ' + esc(p.releasedVersionCount || 0) + '）' : '') + '。计划只描述打算怎么发，不改变实际交付事实；已完成计划不可修改。</p>'
      + '<div class="form-grid">' + field("计划发布时间（本地）", '<input type="datetime-local" step="60" data-plan-planned value="' + esc(p.plannedAt ? localMinute(p.plannedAt) : "") + '"' + disabled + '>', "计划发布的时间，使用本地时间；只用于计划与偏差对比，不代表实际发生时间。")
        + field("计划负责人", '<select data-plan-owner' + disabled + '>' + memberOptions(p.ownerUserId || "", true) + '</select>', "计划的责任人，可与实际执行人不同。")
        + field("计划环境", '<select data-plan-environment' + disabled + '>' + options(envs, p.environment || "production") + '</select>', "计划面向的环境；实际环境不同会在预检中记为偏差，需要填写事实理由。")
        + field("计划覆盖", '<select data-plan-coverage' + disabled + '>' + options(coverage, p.coverage || "full") + '</select>', "计划覆盖范围：全量、部分或覆盖未知；与实际覆盖一致才不构成偏差。") + '</div>'
      + heading('计划包含的版本（<span data-plan-version-count>' + planVersionSelection().length + '</span> 个 · <span data-plan-version-project-count>' + planSelectionProjects(planVersionSelection()) + '</span> 个项目）', "可跨版本、跨项目选择；当前版本固定包含。计划包含的所有版本都完成生产部署 / 重部署后，计划才自动完成。") + planVersionPicker(locked)
      + field("计划目标键（每行一个）", '<textarea data-plan-targets placeholder="如 prod-shanghai-a，每行一个"' + disabled + '>' + esc(normalizedIds(p.targetKeys).join('\n')) + '</textarea>', "计划影响的部署目标或服务键，每行一个；与实际目标键一致才不构成偏差。")
      + heading('这次计划发布哪些工作项（<span data-plan-task-count>' + normalizedIds(p.plannedTaskIds).length + '</span> 项）', "勾选这次计划发布的工作项；设为「就绪」时至少 1 项。实际记录会独立选择，不自动继承计划范围。") + taskRows("plan", normalizedIds(p.plannedTaskIds), locked)
      + '<div data-plan-sync-host></div>'
      + '<div data-plan-branches-host></div>'
      + (!locked ? '<p class="release-readiness" data-plan-readiness></p>' : '')
      + field("计划说明", '<textarea data-plan-notes maxlength="2000"' + disabled + '>' + esc(p.notes || "") + '</textarea>')
      + field("风险与回滚方案", '<textarea data-plan-risks maxlength="1000"' + disabled + '>' + esc(p.risks || "") + '</textarea>', "建议写清回滚命令、数据兼容处理和回滚后的验证步骤。")
      + field("计划状态", '<select data-plan-status' + disabled + '>' + options([["draft", "草稿"], ["ready", "就绪"], ["canceled", "取消"]].concat(p.status === "completed" ? [["completed", "已完成（只读）"]] : []), p.status || "draft") + '</select>', "只有「就绪」计划可被实际记录直接引用；就绪需要计划时间、负责人、至少 1 个工作项和目标键。草稿、取消或已完成会触发偏差校验，需要填写理由。")
      + (!locked ? field("新建 / 修改理由", '<input data-plan-reason maxlength="500" placeholder="说明为什么新建或修改此计划">', "", true) + '<p class="release-error" data-plan-error role="alert"></p><button class="btn sm primary" data-release-save type="button">' + (p.id ? '保存此计划' : '新建独立计划') + '</button>' : '<p class="hint">此计划只读</p>') + '</section>';
    var actualSection = mayPublish ? '<section class="release-section"><h3>实际发布事实</h3><p class="release-guide">记录顺序：发生时间 → 执行人 → 制品与 SHA256 → 目标键 → 勾选实际交付项，然后预览并确认。</p><p class="release-readiness" data-actual-readiness></p><p class="hint">只填本次真实发生的交付。覆盖、操作、关联事件与失败原因收在高级区，异常时自动展开；失败、测试和回滚记录不等于生产生效。</p><div class="form-grid">'
        + field("本次关联计划", '<select data-release-planId' + actualDisabled + '>' + actualPlanOptions(a) + '</select>', "关联计划用于预检对比；无计划即紧急记录。环境或状态不一致的计划仍可选择，但必须填写事实理由。", false, planSummaryHTML(a))
        + field("实际发生时间（本地）", '<input type="datetime-local" step="60" data-release-occurredAt value="' + esc(a.occurredAt) + '"' + actualDisabled + '>', "真实发生时间，不能晚于当前时间；与计划时间不同需填写偏差理由。", true)
        + field("实际环境", '<select data-release-environment' + actualDisabled + '>' + options(envs, a.environment) + '</select>', "真实发布环境；与计划环境不同需填写偏差理由。")
        + field("实际结果", '<select data-release-result' + actualDisabled + '>' + options([["success", "成功"], ["failed", "失败"]], a.result) + '</select>', "记录本次真实结果；失败必须填写失败原因。") + '</div>'
        + '<div class="form-grid">' + field("实际执行人（独立于记录人）", '<select data-release-executorUserId' + actualDisabled + '>' + memberOptions(a.executorUserId, false) + '</select>', "实际执行发布的人，独立于记录人。", true)
        + field("制品标识", '<input type="text" data-release-artifactRef maxlength="500" placeholder="如 hourglass-server.jar#8b44737" value="' + esc(a.artifactRef) + '"' + actualDisabled + '>', "可识别的制品名或构建号，例如 jar 名 + 提交号；不要用普通版本名代替制品证据。", true)
        + field("SHA256", '<input type="text" data-release-artifactDigest maxlength="64" placeholder="64 位十六进制" value="' + esc(a.artifactDigest) + '"' + actualDisabled + '>', "制品文件的 SHA256，只能填 64 位十六进制；用于证明部署的是同一制品。", true) + '</div>'
        + field("实际目标键（每行一个）", '<textarea data-release-targetKeys placeholder="如 prod-shanghai-a，每行一个"' + actualDisabled + '>' + esc(a.targetKeys) + '</textarea>', "本次实际涉及的部署目标或服务键，每行一个；回滚时必须是引用事件目标的子集。", true)
        + heading("本次实际交付哪些工作项（与计划分别保存）", "只勾选本次真实交付的工作项，至少 1 项；未完成项会触发预检，需要填写事实理由。") + taskRows("actual", a.actualTaskIds, !!actualDisabled)
        + '<details class="release-advanced" data-release-advanced' + (advancedOpen ? ' open' : '') + '><summary>高级与异常字段 <span class="mute" data-release-advanced-summary></span></summary><div class="form-grid">'
        + field("实际覆盖", '<select data-release-coverage' + actualDisabled + '>' + options(coverage, a.coverage) + '</select>', "本次实际覆盖范围；与计划覆盖不同需填写偏差理由。")
        + field("操作", '<select data-release-operation' + actualDisabled + '>' + options([["deploy", "部署"], ["redeploy", "重部署 / 失败重试"], ["rollback", "回滚"]], a.operation) + '</select>', "部署 / 重部署 / 回滚；回滚必须引用成功事件，范围须为子集。")
        + field("关联正式事件", '<select data-release-relatedReleaseId' + actualDisabled + '>' + options([["", "请选择（回滚必填）"]].concat(references.map(function(r){ return [r.id, "#" + r.id + " · " + r.result + " · " + releaseOperationName(r.operation) + " · " + fmtReleaseTime(r.occurredAt)]; })), a.relatedReleaseId) + '</select>', "回滚必填；只能引用同环境的成功正式事件，选项随环境与操作过滤。") + '</div>'
        + field("偏差 / 紧急 / 未完成事实理由", '<textarea data-release-deviationReason maxlength="1000" placeholder="说明与计划的差异、未完成项或紧急发布原因"' + actualDisabled + '>' + esc(a.deviationReason) + '</textarea>', "无计划、环境 / 覆盖 / 范围 / 时间与计划不一致或包含未完成项时必须说明；只记录事实，不改写工作项状态。")
        + field("实际说明", '<textarea data-release-notes maxlength="2000"' + actualDisabled + '>' + esc(a.notes) + '</textarea>')
        + field("失败原因（失败时必填）", '<textarea data-release-failureReason maxlength="1000" placeholder="记录失败时必填，说明失败环节与现象"' + actualDisabled + '>' + esc(a.failureReason) + '</textarea>', "实际结果为失败时必须填写失败环节与现象。", a.result === "failed") + '</details>'
        + '<p class="release-error" data-actual-error role="alert"></p><button class="btn sm" data-release-preview type="button">预览本次范围与预检结果</button><div data-release-scope><p class="hint">尚未预览。预览会分别列出本次实际范围与计划未选入的项，两边都保留。</p></div><button class="btn primary" data-release-confirm type="button" disabled>确认记录本次事实</button></section>' : '';
    var historySection = '<section class="release-section"><h3>发布历史</h3><div class="row row-gap"><select data-history-result aria-label="历史结果">' + options([["", "全部结果"], ["published", "已发布（生产成功，不含回滚）"], ["success", "全部成功（含测试 / 回滚）"], ["failed", "失败"]], filters.result) + '</select><select data-history-environment aria-label="历史环境">' + options([["", "全部环境"]].concat(envs), filters.environment) + '</select><select data-history-operation aria-label="历史操作">' + options([["", "全部操作"], ["deploy", "部署"], ["redeploy", "重部署"], ["rollback", "回滚"]], filters.operation) + '</select></div><div data-release-record-list></div><div class="row row-gap"><button class="btn sm" data-history-prev type="button">上一页</button><span class="hint" data-history-count></span><button class="btn sm" data-history-next type="button">下一页</button></div></section>';
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
      + '<div class="release-panel" role="tabpanel" id="release-panel-history" aria-labelledby="release-tab-history" data-release-panel="history"' + (activeTab === "history" ? '' : ' hidden') + '>' + historySection + '</div>'
      + '<div class="release-panel" role="tabpanel" id="release-panel-content" aria-labelledby="release-tab-content" data-release-panel="content"' + (activeTab === "content" ? '' : ' hidden') + '>' + contentSection + '</div>';
    renderHistory(); syncControls(); syncAdvanced(); updateChecklists(); refreshPlanBranches(); filterPicker("plan"); filterPicker("actual"); error(storageError); UI.wireTooltips(dlg.body);
    if(restoreScroll != null){ dlg.body.scrollTop = restoreScroll; restoreScroll = null; }
    if(entryFocus){ entryFocus = false; focusActual(); }
    if(mayManage && activeTab === "plan") ensurePlanTaskPool();
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
      if(planId === null) planId = forceNewPlan ? "" : (plans.length ? plans[0].id : "");
      if(planId && !plans.some(function(p){ return p.id === planId; })) planId = "";
      /* 首次进入实际记录面：自动带出匹配版本与环境的就绪计划，避免误记成紧急发布 */
      if(!pending && !storageError && !actualPlanTouched && !actualDraft.planId) actualDraft.planId = preferredActualPlanId();
      busy = false; render();
    }).catch(function(ex){
      if(!current() || seq !== loadSeq) return;
      busy = false; retryAllowed = false;
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
    if(anomaly && !b.deviationReason) return "无计划、计划偏差、未完成或完成日期异常须填写事实理由（展开「高级与异常字段」），不会伪造完成记录";
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
      recoveredRecord = record; recoveryMessage = "已记录正式事件 #" + record.id + "（" + record.result + "）。";
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
    if(select) select.innerHTML = options([["", "请选择（回滚必填）"]].concat(refs.map(function(r){ return [r.id, "#" + r.id + " · " + r.result + " · " + releaseOperationName(r.operation) + " · " + fmtReleaseTime(r.occurredAt)]; })), a.relatedReleaseId);
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
    if(e.target.matches('[data-history-result], [data-history-environment], [data-history-operation]')){
      filters = {result:value("history", "result"), environment:value("history", "environment"), operation:value("history", "operation")}; page = 0; renderHistory(); return;
    }
    if(e.target.matches('[data-plan-search], [data-plan-filter], [data-actual-search], [data-actual-filter]')){
      filterPicker(e.target.matches('[data-actual-search], [data-actual-filter]') ? "actual" : "plan");
      return;
    }
    if(pending || storageError) return;
    if(e.target.matches('[data-plan-select]')){
      var sel = e.target, nextPlan = sel.value;
      confirmDiscardPlan(function(){ readActual(); planId = nextPlan; planJustSaved = false; planScopeVersionIds = null; planTaskFetchKey = ""; planTaskErrorKey = ""; invalidatePreview(); render(); }, function(){ sel.value = planId || ""; });
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
      if(scope){ error("", scope); if(scope === "plan") dropSavedBanner(); }
      /* 用户亲自选过计划（含“无计划”）后，环境变化或重绘都不再自动改选 */
      if(e.target.matches('[data-release-planId]')) actualPlanTouched = true;
      readActual(); invalidatePreview(); syncAdvanced();
      if(e.target.matches('[data-actual-task]')) pickerCount("actual");
      if(e.target.matches('[data-plan-task]')){ pickerCount("plan"); refreshPlanBranches(); }
      updateChecklists();
      if(e.target.matches('[data-release-operation], [data-release-environment], [data-release-coverage], [data-release-relatedReleaseId], [data-release-planId]')){
        if(e.target.matches('[data-release-operation], [data-release-environment]')) actualDraft.relatedReleaseId = "";
        refreshActualReferences();
      }
    }
  }
  layer.addEventListener("input", changed); layer.addEventListener("change", changed);
  layer.addEventListener("toggle", function(e){ if(e.target.matches && e.target.matches("[data-release-advanced]")) advancedOpen = e.target.open; }, true);
  layer.addEventListener("keydown", function(e){
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
    var exp = e.target.closest('[data-release-export]');
    if(exp){ var r = records.concat(recoveredRecord ? [recoveredRecord] : []).find(function(r){ return String(r.id) === exp.dataset.releaseExport; }); if(r) exportReleaseRecordCSV(r); return; }
    var syncOpen = e.target.closest('[data-plan-sync-open]');
    if(syncOpen){
      /* 跳去分支抽屉要先关掉工作区：有未保存的计划修改时先确认，避免草稿被静默丢弃 */
      var syncBranchId = syncOpen.getAttribute("data-plan-sync-open");
      confirmDiscardPlan(function(){ pendingBranchId = syncBranchId; UI.closeModal(layer); });
      return;
    }
    if(e.target.closest('[data-plan-sync-close]')){ var syncHost = layer.querySelector("[data-plan-sync-host]"); if(syncHost) syncHost.innerHTML = ""; return; }
    if(busy || !current()) return;
    var tab = e.target.closest('[data-release-tab]');
    if(tab){ switchTab(tab.getAttribute("data-release-tab"), false); return; }
    if(e.target.closest('[data-release-goto-actual]')){ switchTab("actual", true); return; }
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
    if(e.target.closest('[data-plan-new]')){ if(mayManage) confirmDiscardPlan(function(){ readActual(); planId = ""; planJustSaved = false; planScopeVersionIds = null; planTaskFetchKey = ""; planTaskErrorKey = ""; invalidatePreview(); render(); }); return; }
    if(e.target.closest('[data-release-preview]')){ runPreview(); return; }
    if(e.target.closest('[data-release-save]')){
      var p = selectedPlan(); if(!mayManage || (p && p.status === "completed")) return;
      var b = planBody();
      if(!b.reason){ error("请填写新建 / 修改计划理由", "plan"); return; }
      if(b.status === "ready" && (!b.plannedAt || !b.ownerUserId || !b.plannedTaskIds.length || !b.targetKeys.length)){ error("就绪计划需要时间、负责人、明确任务范围与目标键", "plan"); return; }
      readActual(); setBusy(true); invalidatePreview();
      (p ? API.put(base + "/release-plan", b) : API.post(base + "/release-plans", b)).then(function(saved){ if(current()){ planId = saved.id; planJustSaved = true; planSavedRevision = saved.revision == null ? null : saved.revision; restoreScroll = dlg.body.scrollTop; setBusy(false); toast("独立发布计划已保存", "fs"); load(); } }).catch(function(ex){ if(current()){ setBusy(false); error(ex.message || "计划保存失败", "plan"); } }); return;
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
}
function startVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  UI.showConfirm({
    title:"开始开发",
    msg:"将「" + esc(v.name) + "」转为开发中？" + (v.startDate ? "" : "该版本尚无开始日期，将自动记为今天。"),
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
function deleteVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!isOwner()){ toast("仅空间主可删除版本", "warn"); return; }
  UI.showConfirm({
    title:"删除版本",
    msg:"删除「" + esc(v.name) + "」？已发布或已有发布尝试记录的版本不能删除；仍有工作项绑定（含回收站）或需求目标引用（含已取消）也会拒绝删除。请先填写原因解除 / 调整工作项版本，撤排 / 调整需求目标；已取消需求需有因恢复以清目标。删除不会自动解绑。",
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
function openVersionTasks(id, fresh){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  if(!fresh){
    var seq = ++versionBindingSeq, reqId = rt.phaseReqId, wsId = (rt.currentWs || {}).id, userId = (rt.currentUser || {}).id, route = document.body.dataset.view;
    Promise.all([API.get("/api/versions", {reqId:reqId}), API.get("/api/versions/task-options", {reqId:reqId})]).then(function(rs){
      if(seq !== versionBindingSeq || reqId !== rt.phaseReqId || wsId !== (rt.currentWs || {}).id || userId !== (rt.currentUser || {}).id || route !== document.body.dataset.view || !cache) return;
      cache.versions = rs[0]; cache.tasks = rs[1];
      var current = findVersion(id);
      openVersionTasks(id, true);
    }).catch(function(ex){ if(seq === versionBindingSeq && reqId === rt.phaseReqId && wsId === (rt.currentWs || {}).id && userId === (rt.currentUser || {}).id && route === document.body.dataset.view) toast(ex.message || "加载版本内容范围失败", "bad"); });
    return;
  }
  if(versionContentLocked(v)){ toast("已有成功正式发布，版本内容范围只读", "warn"); return; }
  var selected = {}, query = "";
  cache.tasks.forEach(function(t){ if(taskVersionIds(t).indexOf(id) !== -1) selected[t.id] = true; });
  var versionNames = {};
  cache.versions.forEach(function(item){ versionNames[item.id] = item.name; });
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
    + '<div class="sheet-body"><div class="version-task-tools"><input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索版本工作项" data-version-task-search />'
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div>'
    + '<label class="field version-change-reason">版本调整理由（变更关联时必填）<textarea data-task-change-reason maxlength="500" placeholder="说明新增、顺延或移出此版本的原因"></textarea></label></div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-version-task-new>+ 在此版本新建工作项</button>'
    + '<span style="flex:1"></span><button class="btn" type="button" data-version-task-cancel>取消</button>'
    + '<button class="btn primary" type="button" data-version-task-save>保存关联</button></div></div>';
  function selectedIds(){ return Object.keys(selected).filter(function(taskId){ return selected[taskId]; }); }
  function renderList(){
    var list = layer.querySelector(".version-task-list");
    var visible = rows.filter(function(t){
      if(!query) return true;
      return (String(t.title || "") + " " + String(t.owner || "")).toLowerCase().indexOf(query) !== -1;
    });
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + rows.length + " 项";
    list.innerHTML = visible.length ? visible.map(function(t){
      var bound = taskVersionIds(t).filter(function(vid){ return vid !== id; });
      var brName = t.branchId ? branchNameById(t.branchId) : "";
      var meta = typeName(t.itemType) + " · " + (t.owner || "未指派") + " · "
        + (t.boardColumn === "done" ? "已完成" : colName(t.boardColumn))
        + (brName ? " · 分支 " + brName : "");
      return '<label class="version-task-row"><input type="checkbox" data-version-task-check="' + esc(t.id) + '"'
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><b>' + esc(t.title) + '</b>'
        + '<small>' + esc(meta) + (bound.length ? ' · 其他关联：' + esc(bound.map(function(vid){ return versionNames[vid] || vid; }).join('、')) : "") + '</small></span></label>';
    }).join("") : '<div class="tl-empty">没有匹配的工作项</div>';
  }
  document.body.appendChild(layer);
  renderList();
  layer.addEventListener("input", function(e){
    if(!guard.current() || guard.busy()) return;
    if(e.target.closest("[data-version-task-search]")){
      query = e.target.value.trim().toLowerCase();
      renderList();
    }
  });
  layer.addEventListener("change", function(e){
    if(!guard.current() || guard.busy()) return;
    var check = e.target.closest("[data-version-task-check]");
    if(!check) return;
    selected[check.dataset.versionTaskCheck] = check.checked;
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + rows.length + " 项";
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-version-task-x], [data-version-task-cancel]")){ UI.closeModal(layer); return; }
    if(!guard.current() || guard.busy()) return;
    if(!canWritePhase()){ denyPhaseReadOnly(); return; }
    if(e.target.closest("[data-version-task-new]")){
      UI.closeModal(layer);
      openTaskDrawer("backlog", null, { reqId: v.reqId, versionIds: [v.id] });
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
  var selected = {}, query = "";
  unbound.forEach(function(t){ selected[t.id] = true; });
  var opts = targets.map(function(v){
    return '<option value="' + esc(v.id) + '"' + (v === (firstActive || targets[0]) ? " selected" : "") + '>'
      + esc(v.name) + (v.status === "active" ? "（开发中）" : "（待规划）") + '</option>';
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
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div>'
    + '<label class="field version-change-reason">版本调整理由（变更关联时必填）<textarea data-task-change-reason maxlength="500" placeholder="说明新增、顺延或移出此版本的原因"></textarea></label></div>'
    + '<div class="sheet-foot"><span style="flex:1"></span><button class="btn" type="button" data-unbound-cancel>取消</button>'
    + '<button class="btn primary" type="button" data-unbound-save>分配所选工作项</button></div></div>';
  function selVer(){ return targets.find(function(v){ return v.id === layer.querySelector("[data-unbound-ver]").value; }) || targets[0]; }
  function selectedIds(){ return unbound.filter(function(t){ return selected[t.id]; }).map(function(t){ return t.id; }); }
  function renderList(){
    var list = layer.querySelector(".version-task-list");
    var visible = unbound.filter(function(t){
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
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><b>' + esc(t.title) + '</b>'
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
      dlg.body.innerHTML = '<p class="release-error" role="alert">' + esc(ex.message || "加载发布说明失败") + '</p><button class="btn" type="button" data-note-retry>重试</button>';
    });
  }
  dlg.layer.addEventListener("click", function(e){
    if(e.target.closest('[data-note-retry]')){ load(); return; }
    if(e.target.closest('[data-note-export]') && note) exportReleaseNoteCSV(note);
    if(e.target.closest('[data-release-export]') && snapshot) exportReleaseRecordCSV(snapshot);
    var task = e.target.closest('[data-note-task]');
    if(task){ UI.closeModal(dlg.layer); openTaskById(task.dataset.noteTask); return; }
    var demand = e.target.closest('[data-note-demand]');
    if(demand){ UI.closeModal(dlg.layer); openDemandDetailById(demand.dataset.noteDemand); }
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
    if(!taskId) ids = ids.filter(function(id){ return vs.some(function(v){ return v.id === id && !versionContentLocked(v); }); });
    sel.innerHTML = vs.filter(function(v){ return !versionContentLocked(v) || ids.indexOf(v.id) !== -1; }).map(function(v){
      return '<option value="' + esc(v.id) + '"' + (ids.indexOf(v.id) !== -1 ? ' selected' : '') + (versionContentLocked(v) ? ' disabled' : '') + '>' + esc(v.name) + (versionContentLocked(v) ? '（正式发布后内容只读，保留关联）' : '') + '</option>';
    }).join('');
    ids.forEach(function(id){
      if(!vs.some(function(v){ return v.id === id; })){
        var retained = document.createElement("option"); retained.value = id; retained.textContent = id + "（不可见，保留关联）"; retained.disabled = true; retained.selected = true; sel.appendChild(retained);
      }
    });
    sel.dataset.retainedIds = JSON.stringify(ids.filter(function(id){ var v = vs.find(function(v){ return v.id === id; }); return !v || versionContentLocked(v); }));
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
  if(!reqId){
    sel.innerHTML = '<option value="">无所属史诗</option>';
    sel.setAttribute("data-ready", "1");
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
  if(e.target.closest("[data-schedule-refresh]")){ loadSchedule(); return; }
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
      panel.querySelectorAll("[data-tbl-status],[data-tbl-owner],[data-tbl-type]").forEach(function(s){
        s.value = "";
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
  var manageTasks = e.target.closest("[data-ver-tasks]");
  if(manageTasks){ openVersionTasks(manageTasks.dataset.verTasks); return; }
  var ed = e.target.closest("[data-ver-edit]");
  if(ed){ openVersionDialog(ed.dataset.verEdit); return; }
  var dl = e.target.closest("[data-ver-del]");
  if(dl){ deleteVersion(dl.dataset.verDel); return; }
  var nt = e.target.closest("[data-ver-note]");
  if(nt){ showReleaseNote(nt.dataset.verNote); return; }
  var dt = e.target.closest("[data-ver-desc-toggle]");
  if(dt){
    var descP = dt.parentNode.querySelector("[data-ver-desc]");
    if(descP) descP.classList.toggle("open");
    syncVersionDescToggles();
    return;
  }
  var ua = e.target.closest("[data-unbound-assign]");
  if(ua){ openUnboundTasks(); return; }
});
if(phaseBody) phaseBody.addEventListener("change", function(e){
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
  if(e.target.closest("[data-tbl-status],[data-tbl-owner],[data-tbl-type]")) applyPhaseTblFilters();
});
if(phaseBody) phaseBody.addEventListener("input", function(e){
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
    loadPhaseData();
  }
}
export { enterPhaseView, ensureEpicOptions, ensureFoundVersionOptions, ensureVersionOptions, invalidateTaskOptionsCache, loadPhaseData, reloadView, renderPhaseView, setPhaseProject, showReleaseNote };
