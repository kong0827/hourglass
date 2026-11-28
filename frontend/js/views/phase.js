/* views/phase · 版本：按阶段（首版/迭代）与按版本（三态版本卡）双口径 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocRead } from "../core/task-drawer.js";
import { updateBrand } from "../core/filters.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { canEditReq, projectOptionsHTML, projectRefsEnriched, reqNameById, reqSetId, roleReadOnly, rt, setNameById, state, taskCacheExtra } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { assocLinkHTML, normalizedIds, taskVersionIds, taskVersionsText, sameIds, taskPublicationHTML, taskHref, fmtReleaseTime, localDatetime, releaseEnvironmentName, releaseOperationName, releasePlanTime, releaseSnapshotHTML, itemNoText, releaseNoText, releasePlanNoText, COLUMNS, colName, dayKey, dayDiff, parseDate, fmtMinute, fmtMinutesShort, versionPhaseInfoHTML, VERSION_STATUS_META, PLAN_STATUS_META, versionStatusTagHTML, planStatusName } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { branchMetaById, branchNameById, loadBranches, openBranchById, requestBranchStatus } from "./branches.js";
import { openDemandDetailById, openDemandVersionBackfill } from "./demands.js";
import { openMilestoneDetail } from "../lib/milestone-ui.js";
import { STAGE_META, stageActualOf, summarizeStages } from "../lib/stage-hours.js";
import { stagePanelHTML, stageRowHTML, stageDrillRows, stageHoursText, openStageDrill } from "../lib/stage-panel.js";
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
var viewMode = "list";             /* list | version | phase | allversions | overview */
var PHASE_MODES = { list:1, version:1, phase:1, allversions:1, overview:1 };
var PHASE_SCOPE = {
  allversions: { name:"全部项目", desc:"跨项目版本清单，可按项目集或项目筛选，勾选后新建发布计划" },
  overview: { name:"投入总览", desc:"项目级的首版 / 迭代投入与风险总览" }
};
/* 版本列表范围：单项目（默认）/ 项目集 / 全部项目；分析口径从同一个范围菜单进入 */
var listUi = { scopeType:"proj", scopeId:"", status:"all", sort:"updated", q:"" };
function phaseModeFromHash(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "phase") return "list";
  var m = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "").get("pmode") || "list";
  /* 旧链接 ?pmode=phase 继续有效，语义收敛为「首版 / 迭代分析」 */
  return PHASE_MODES[m] ? m : "list";
}
function syncPhaseModeHash(mode){
  var h = "#/phase" + (mode === "list" ? "" : "?pmode=" + mode);
  if(String(window.location.hash || "") === h) return;
  try{ history.replaceState(null, "", h); }
  catch(e){ /* file:// 等受限环境：模式仍生效，只是不写地址栏 */ }
}
/* 版本列表：筛选 / 排序 / 行内编辑互不干扰；编辑草稿只存在内存，失焦不自动提交 */
var verListUi = { sort:"smart", q:"", riskOnly:false };
/* 队列按状态分组：进行中 / 计划中 / 已发布默认展开，已关闭与已取消默认收 3 行 */
var verGroupUi = { open:{ released:true, closed:false, canceled:false } };
var verInline = null;              /* { id, field:"name"|"dates", busy } */
var cache = null;                  /* { phase, vstats, versions, tasks } */
var overviewCache = null;
var allVersionsCache = null, allVersionsSeq = 0, allVersionsSel = [];
var cacheReqId = null;             /* cache 对应的项目，跨项目视图来回切换后避免串项目 */
var loadSeq = 0;
var pendingPhaseLoad = false;      /* 项目列表未就绪时进入版本分析，等 ds:reqs-loaded 再补渲染 */
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
  if(a <= 15) return "ok";
  /* 偏差有方向：低于预估是用得少，不按风险标色；只有超出预估才升级 */
  if(v < 0) return "";
  return a <= 30 ? "warn" : "over";
}
function devText(v){
  if(v === null || v === undefined) return "—";
  var a = Math.abs(v);
  if(a <= 15) return (v > 0 ? "+" : "") + v + "% · 准确";
  if(v < 0) return v + "% · 偏低";
  return "+" + v + "% · " + (a <= 30 ? "偏高" : "严重超支");
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
  /* 范围三档：全部项目 / 项目集 / 单项目；前两档落到跨项目版本清单，不改变版本归属 */
  var sets = (rt.projectSets || []).filter(function(s){
    return list.some(function(r){ return (r.setId || "") === s.id; });
  });
  phaseReq.innerHTML = '<option value="__all">全部项目</option>'
    + sets.map(function(s){
      return '<option value="__set:' + esc(s.id) + '">项目集 · ' + esc(s.name) + '</option>';
    }).join("")
    + projectOptionsHTML(list, rt.phaseReqId);
  if(!rt.phaseReqId && list.length) rt.phaseReqId = list[0].id;
  if(rt.phaseReqId) phaseReq.value = rt.phaseReqId;
}
/* 启动时的项目请求可能被更晚的刷新覆盖，本视图自己的 then 会拿到空列表；
   以最终落地的项目列表补一次同步，避免刷新后误判「还没有项目」 */
window.addEventListener("ds:reqs-loaded", function(){
  if(document.body.dataset.view !== "phase" || !rt.reqsLoaded) return;
  if(viewMode === "allversions" || viewMode === "list"){
    if(allVersionsCache) return;
    syncModeSeg();
    loadVersionList();
    return;
  }
  if(pendingPhaseLoad){
    pendingPhaseLoad = false;
    syncReqSel();
    if(viewMode === "overview") loadOverview();
    else loadPhaseData();
    return;
  }
  if(!rt.reqList.length || (phaseReq && phaseReq.options.length)) return;
  syncReqSel();
  if(viewMode === "overview") loadOverview();
  else loadPhaseData();
});
/* 里程碑在项目驾驶舱里改过：版本卡上的达成/证据要跟着刷新 */
window.addEventListener("ds:milestones-changed", function(e){
  if(document.body.dataset.view !== "phase") return;
  var reqId = e && e.detail && e.detail.reqId;
  if(reqId && reqId !== rt.phaseReqId) return;
  if(viewMode === "phase" || viewMode === "version" || viewMode === "list" || viewMode === "allversions") reloadView();
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
  clearVersionListPageHead();
  if(!rt.phaseReqId || !rt.reqList.length){
    if(!rt.reqsLoaded){
      pendingPhaseLoad = true;
      phaseBody.innerHTML = UI.skeletonRows(4);
      return;
    }
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目并归入工作项，这里就能按阶段、按版本看投入与偏差。"
    });
    if(phaseMeta) phaseMeta.textContent = "";
    return;
  }
  if(phaseMeta) phaseMeta.textContent = "";
  rt.phaseProjectName = reqNameById(rt.phaseReqId) || "";
  updateBrand();
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
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "list" || viewMode === "overview" || viewMode === "allversions") return;
    cache = { phase: rs[0], vstats: rs[1], versions: rs[2], tasks: rs[3], milestones: rs[4] || [] };
    rollupUi.cats = rs[5] || [];
    cacheReqId = reqId;
    versionOptionsCache[reqId] = rs[2];
    taskOptionsCache[reqId] = rs[3];
    renderPhaseView();
  }).catch(function(ex){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "list" || viewMode === "overview" || viewMode === "allversions") return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    bindRetry(phaseBody, loadPhaseData);
  });
}
function enterPhaseView(){
  /* 默认落在版本列表；?pmode=version 仍可回到旧工作台，?pmode=phase 是首版 / 迭代分析 */
  viewMode = phaseModeFromHash();
  syncModeSeg();
  /* 全局「新建」菜单跨视图创建：#/phase?new=1 进入即开新建版本弹窗（参数消费一次即清） */
  var wantNew = /[?&]new=1(&|$)/.test(String(window.location.hash || ""));
  if(wantNew){
    try{ window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/phase"); }catch(e){ /* noop */ }
  }
  var afterReqs = function(){
    syncReqSel();
    if(wantNew){
      /* 合成范围没有「当前项目」可写：若还记着上次进入的项目，先切回该项目的列表再开弹窗 */
      var crossMode = viewMode === "overview" || viewMode === "allversions" || (viewMode === "list" && listUi.scopeType !== "proj");
      if(crossMode && rt.phaseReqId && canWritePhase()){
        toast("已切到 " + (reqNameById(rt.phaseReqId) || "上次的项目") + "，继续新建版本", "fs");
        viewMode = "list";
        listUi.scopeType = "proj";
        listUi.scopeId = rt.phaseReqId;
        syncPhaseModeHash(viewMode);
        syncModeSeg();
      }
      if(viewMode === "overview" || viewMode === "allversions") toast("请先切换到具体项目，再新建版本", "warn");
      else if(!rt.phaseReqId) toast("先选择项目，再新建版本", "warn");
      else if(!canWritePhase()) denyPhaseReadOnly();
      else openVersionDialog(null);
    }
    if(viewMode === "overview") loadOverview();
    else if(viewMode === "allversions" || viewMode === "list") loadVersionList();
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
  if(viewMode === "overview"){ return loadOverview(); }
  if(viewMode === "allversions" || viewMode === "list"){ allVersionsCache = null; return loadVersionList(); }
  invalidateVersionCache(rt.phaseReqId);
  return loadPhaseData();
}

/* ---------- 全部项目总览（管理端） ---------- */

function loadOverview(){
  clearVersionListPageHead();
  var current = ++loadSeq;
  if(phaseMeta) phaseMeta.textContent = "全部项目";
  rt.phaseProjectName = "";
  updateBrand();
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
    + '</div>'
    + '<div style="padding:12px 0 4px">' + metricCells(kpis, null) + '</div></div>'
    + '<div class="panel" style="margin-top:12px"><div class="panel-head"><h3>项目明细</h3>'
    + '<span class="meta-right">工时口径：首版/迭代按完成工作项的自然日归组</span></div>'
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>项目</th><th>首版上线</th><th class="num">版本（已发/进行/计划）</th>'
    + '<th class="num">首版工时</th><th class="num">迭代工时</th><th class="num">合计工时</th>'
    + '<th class="num">首版准时率</th><th class="num">迭代准时率</th><th>最近版本</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

/* ---------- 版本列表（原型 versions-default：范围 / 状态 / 排序 / 搜索 + 七列） ---------- */

function allVersionRowMap(){
  var map = {};
  (allVersionsCache || []).forEach(function(r){ map[r.versionId] = r; });
  return map;
}
function vlistMD(s){
  var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[2] + "-" + m[3] : "";
}
function vlistEnvName(env){
  return { production:"生产", staging:"预发", test:"测试" }[env] || "";
}
function vlistTimeHM(iso){
  var d = iso ? new Date(iso) : null;
  if(!d || isNaN(d.getTime())) return "";
  return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
}
/* 范围项目：优先用已加载的项目列表；尚未加载时退回版本行里出现过的项目，避免页头数字闪成 0 */
function vlistAllProjects(){
  var list = (rt.reqList || []).filter(function(r){ return !r.archivedAt; });
  if(list.length) return list;
  var seen = {}, out = [];
  (allVersionsCache || []).forEach(function(r){
    if(seen[r.reqId]) return;
    seen[r.reqId] = 1;
    out.push({ id:r.reqId, name:r.projectName });
  });
  return out;
}
function vlistScopeProjects(){
  var all = vlistAllProjects();
  if(listUi.scopeType === "proj"){
    var id = listUi.scopeId || rt.phaseReqId;
    var hit = all.filter(function(r){ return r.id === id; });
    if(!hit.length && id){
      var row = (allVersionsCache || []).filter(function(r){ return r.reqId === id; })[0];
      hit = [{ id:id, name:row ? row.projectName : reqNameById(id) }];
    }
    return hit;
  }
  if(listUi.scopeType === "set"){
    return all.filter(function(r){ return reqSetId(r.id) === listUi.scopeId; });
  }
  return all;
}
function vlistScopeLabel(){
  if(listUi.scopeType === "set") return "项目集 · " + (setNameById(listUi.scopeId) || listUi.scopeId || "");
  if(listUi.scopeType === "all") return "全部项目";
  var id = listUi.scopeId || rt.phaseReqId;
  var row = (allVersionsCache || []).filter(function(r){ return r.reqId === id; })[0];
  return reqNameById(id) || (row && row.projectName) || "当前项目";
}
function vlistScopedRows(rows){
  return (rows || []).filter(function(r){
    if(listUi.scopeType === "proj") return r.reqId === (listUi.scopeId || rt.phaseReqId);
    if(listUi.scopeType === "set") return reqSetId(r.reqId) === listUi.scopeId;
    return true;
  });
}
function vlistFiltered(rows){
  var q = String(listUi.q || "").trim().toLowerCase();
  var out = vlistScopedRows(rows);
  if(listUi.status !== "all") out = out.filter(function(r){ return r.versionStatus === listUi.status; });
  if(q) out = out.filter(function(r){ return String(r.versionName || "").toLowerCase().indexOf(q) !== -1; });
  out.sort(function(a, b){
    if(listUi.sort === "name") return String(a.versionName || "").localeCompare(String(b.versionName || ""), "zh");
    if(listUi.sort === "target"){
      var at = a.targetDate || "", bt = b.targetDate || "";
      if(!at && bt) return 1;
      if(at && !bt) return -1;
      if(at !== bt) return at < bt ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return out;
}
function vlistLatestUpdated(rows){
  var best = "";
  (rows || []).forEach(function(r){
    var t = r.updatedAt || r.releasedAt || "";
    if(t && t > best) best = t;
  });
  return vlistTimeHM(best);
}
function clearVersionListPageHead(){
  rt.phaseListScope = "";
  var inline = document.getElementById("pageInlineMeta");
  if(inline){ inline.textContent = ""; inline.hidden = true; }
  var acts = document.getElementById("pageActions");
  if(acts){ acts.hidden = true; acts.innerHTML = ""; }
  var nw = document.getElementById("newWrap");
  if(nw) nw.hidden = false;
  var pill = document.getElementById("pagePill");
  if(pill){ pill.hidden = true; pill.textContent = ""; }
  var sub = document.getElementById("pageSub");
  if(sub) sub.textContent = "版本计划、工作项范围与交付情况";
  var title = document.getElementById("pageTitleText");
  if(title) title.textContent = "版本";
}
/* 页头按原型：H1 版本 + 内联口径「N 个项目 · M 个版本 · 更新于 HH:mm」，右端 导出 / 新建版本 */
function syncVersionListPageHead(rows, scoped){
  if(document.body.dataset.view !== "phase") return;
  var title = document.getElementById("pageTitleText"), sub = document.getElementById("pageSub");
  var inline = document.getElementById("pageInlineMeta"), pill = document.getElementById("pagePill");
  var acts = document.getElementById("pageActions"), nw = document.getElementById("newWrap");
  var loading = scoped === null;
  var multi = listUi.scopeType !== "proj";
  var projects = vlistScopeProjects();
  var listed = {}, listedN = 0;
  (scoped || []).forEach(function(r){ if(!listed[r.reqId]){ listed[r.reqId] = 1; listedN++; } });
  var meta = loading ? "加载中…"
    : (multi ? (listedN || projects.length) + " 个项目 · " : "") + (scoped || []).length + " 个版本"
      + (vlistLatestUpdated(scoped) ? " · 更新于 " + vlistLatestUpdated(scoped) : "");
  rt.phaseListScope = vlistScopeLabel();
  if(title) title.textContent = "版本";
  if(sub) sub.textContent = "";
  if(pill){ pill.hidden = true; pill.textContent = ""; }
  if(inline){ inline.textContent = meta; inline.hidden = !meta; }
  var writable = listUi.scopeType === "proj" && canEditReq(listUi.scopeId || rt.phaseReqId);
  /* 只读项目：写入口不渲染（规格 §2「写操作按钮隐藏不禁用」），由列表横幅解释原因 */
  var hideNew = listUi.scopeType === "proj" && !writable;
  var reason = multi ? "新建版本需先选定一个具体项目" : "";
  if(acts){
    acts.innerHTML = '<button class="btn" type="button" data-vlist-export>导出</button>'
      + (hideNew ? "" : '<button class="btn primary" type="button" data-vlist-new'
      + (multi ? ' disabled title="' + esc(reason) + '"' : '') + '>'
      + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 4.4v11.2M4.4 10h11.2"/></svg>新建版本</button>');
    acts.hidden = false;
  }
  if(nw) nw.hidden = true;
  document.title = "版本 · 沙漏";
}
function vlistScopeMenuHTML(){
  var projects = vlistAllProjects();
  var sets = (rt.projectSets || []).filter(function(s){
    return projects.some(function(p){ return reqSetId(p.id) === s.id; });
  });
  var op = function(attrs, name, tail){
    return '<button class="vlist-op" type="button" role="menuitem"' + attrs + '>'
      + '<span>' + esc(name) + '</span>' + (tail ? '<small>' + tail + '</small>' : '') + '</button>';
  };
  var cur = function(type, id){
    return listUi.scopeType === type && (type === "all" || listUi.scopeId === id) ? ' aria-current="true"' : '';
  };
  var html = op(' data-vlist-scope="all"' + cur("all"), "全部项目", projects.length + " 个项目");
  if(sets.length){
    html += '<div class="vlist-gh">项目集</div>'
      + sets.map(function(s){
        var n = projects.filter(function(p){ return reqSetId(p.id) === s.id; }).length;
        return op(' data-vlist-scope="set" data-vlist-id="' + esc(s.id) + '"' + cur("set", s.id), s.name, n + " 个项目");
      }).join("");
  }
  html += '<div class="vlist-gh">单个项目</div>'
    + '<div class="vlist-scroll">'
    + projects.map(function(p){
      return op(' data-vlist-scope="proj" data-vlist-id="' + esc(p.id) + '"' + cur("proj", p.id), p.name, canEditReq(p.id) ? "" : "只读");
    }).join("")
    + '</div>';
  html += '<div class="vlist-sep" aria-hidden="true"></div><div class="vlist-gh">分析</div>'
    + op(' data-vlist-analysis="version"', "版本工作台", "单项目")
    + op(' data-vlist-analysis="phase"', "首版 / 迭代分析", "单项目")
    + op(' data-vlist-analysis="overview"', "投入总览", "全部项目");
  return '<div class="menu vlist-menu" id="vlistScopeMenu" hidden>' + html + '</div>';
}
function vlistToolbarHTML(){
  var chevron = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 8l3-3.5"/></svg>';
  var statuses = [["all", "全部"], ["active", "进行中"], ["planned", "计划中"], ["released", "已发布"]];
  var sorts = [["updated", "按更新时间"], ["target", "按目标日期"], ["name", "按名称"]];
  return '<div class="vlist-bar">'
    + '<div class="vlist-scope" id="vlistScopeWrap">'
    + '<button class="vlist-scope-btn" type="button" id="vlistScopeBtn" aria-haspopup="true" aria-expanded="false">范围 <b>' + esc(vlistScopeLabel()) + '</b>' + chevron + '</button>'
    + vlistScopeMenuHTML()
    + '</div>'
    + '<span class="vlist-div" aria-hidden="true"></span>'
    + '<div class="seg mini" role="group" aria-label="版本状态">'
    + statuses.map(function(s){
      return '<button type="button" data-vlist-status="' + s[0] + '" aria-pressed="' + (listUi.status === s[0]) + '">' + s[1] + '</button>';
    }).join("")
    + '</div>'
    + '<span class="vlist-div" aria-hidden="true"></span>'
    + '<label class="vlist-sort">排序<select class="mini-select" data-vlist-sort aria-label="版本排序">'
    + sorts.map(function(s){
      return '<option value="' + s[0] + '"' + (listUi.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join("")
    + '</select></label>'
    + '<div class="vlist-search">' + icon("search", 14)
    + '<input type="search" data-vlist-q value="' + esc(listUi.q) + '" placeholder="搜索版本名称" aria-label="搜索版本名称" autocomplete="off"></div>'
    + '</div>';
}
function vlistSelectionBarHTML(multi){
  if(!multi || !allVersionsSel.length) return "";
  var map = allVersionRowMap();
  var selected = allVersionsSel.map(function(id){ return map[id]; }).filter(Boolean);
  if(!selected.length) return "";
  var projects = {};
  selected.forEach(function(r){ projects[r.reqId] = true; });
  return '<div class="allv-selbar"><div class="allv-selinfo"><b>已选 ' + selected.length + ' 个版本 · 跨 ' + Object.keys(projects).length + ' 个项目</b>'
    + '<div class="release-chips">' + selected.map(function(r){
      return '<span class="release-chip" title="' + esc(r.projectName) + '">' + esc(r.versionName) + '</span>';
    }).join("") + '</div></div>'
    + '<button class="btn sm" type="button" data-allv-clear>清空</button>'
    + '<button class="btn sm primary" type="button" data-allv-plan>新建发布计划</button></div>';
}
function vlistReleaseHTML(r){
  var prod = r.productionSuccessCount || 0, stage = r.stagingSuccessCount || 0;
  if(prod > 0){
    var d = vlistMD(r.latestReleaseDate || r.releasedAt || r.targetDate);
    return '<div class="vlist-rel">生产发布 ' + (d || "已") + ' 成功</div>'
      + (r.deliveryConfirmed ? '<div class="vlist-sub is-ok">交付说明已确认</div>' : '');
  }
  if(r.nextPlanAt){
    var env = vlistEnvName(r.nextPlanEnvironment);
    var sub = [];
    if(stage > 0) sub.push("预发已成功 " + stage + " 次");
    if(!prod) sub.push("生产未发布");
    return '<div class="vlist-rel">下一计划 ' + vlistMD(r.nextPlanAt) + (env ? " " + env : "") + '发布</div>'
      + (sub.length ? '<div class="vlist-sub' + (stage > 0 ? ' is-ok' : '') + '">' + esc(sub.join(" · ")) + '</div>' : '');
  }
  if(r.versionStatus === "released") return '<div class="vlist-rel">已标记发布</div><div class="vlist-sub">暂无生产记录</div>';
  if(versionEnded({ status:r.versionStatus })) return '<div class="vlist-rel is-empty">未发布</div>';
  return '<div class="vlist-rel is-empty">尚未创建发布计划</div>';
}
var VLIST_STATUS_TONE = { planned:"is-purple", active:"is-blue", released:"is-green", closed:"is-gray", canceled:"is-gray" };
function vlistRowHTML(r){
  var multi = listUi.scopeType !== "proj";
  var total = r.taskCount || 0, done = r.doneTaskCount || 0;
  var pct = total ? Math.round(done * 100 / total) : 0;
  /* 原型：完成用绿、有进度用主色、0 进度留浅灰；不引入第三种告警色到进度条 */
  var barTone = pct >= 100 ? " is-green" : (pct > 0 ? " is-blue" : "");
  var selected = allVersionsSel.indexOf(r.versionId) !== -1;
  var ended = versionEnded({ status:r.versionStatus }) || r.versionStatus === "released";
  var pickable = r.canManage && !ended;
  var pickTitle = pickable ? "加入新的发布计划"
    : (ended ? "已发布或已结束的版本不能加入新计划" : "无发布计划权限");
  var range = (function(){
    var s = vlistMD(r.startDate), t = vlistMD(r.targetDate);
    if(s && t) return s + " ~ " + t;
    if(t) return "目标 " + t;
    if(s) return s + " 起";
    return "未定日期";
  })();
  var todo = r.todoCount || 0;
  var statusName = versionStatusName(r.versionStatus);
  return '<tr' + (selected ? ' class="is-selected"' : '') + ' data-ver-row="' + esc(r.versionId) + '" data-ver-req="' + esc(r.reqId) + '" tabindex="0" role="button" aria-label="进入「' + esc(r.versionName) + '」的版本详情">'
    + (multi ? '<td class="vlist-check"><label class="vlist-pick" title="' + esc(pickTitle) + '"><input type="checkbox" data-allv-pick="' + esc(r.versionId) + '"'
      + (selected ? ' checked' : '') + (pickable ? '' : ' disabled') + ' aria-label="选择 ' + esc(r.versionName) + '"></label></td>' : '')
    + '<td class="vlist-name-cell" data-l="版本"><button class="vlist-name allv-vname" type="button" data-ver-open="' + esc(r.versionId) + '" data-ver-req="' + esc(r.reqId) + '" title="打开「' + esc(r.versionName) + '」的版本详情页">' + esc(r.versionName) + '</button>'
    + '<div class="vlist-sub">' + (multi ? '<span class="vlist-proj">' + esc(r.projectName) + '</span>' : '') + esc(range) + ' · 负责人 ' + esc(r.ownerName || "未指派") + '</div></td>'
    + '<td class="vlist-progress" data-l="工作项进度"><div class="vlist-pbar"><i class="' + barTone + '" style="width:' + pct + '%"></i></div><span class="vlist-pct">' + done + '/' + total + '</span></td>'
    + '<td class="vlist-demand" data-l="需求覆盖" title="已覆盖 ' + (r.coveredDemandCount || 0) + ' / 共 ' + (r.demandCount || 0) + ' 个需求">' + (r.coveredDemandCount || 0) + '/' + (r.demandCount || 0) + '</td>'
    + '<td class="vlist-release" data-l="发布">' + vlistReleaseHTML(r) + '</td>'
    + '<td data-l="下一步">' + (todo > 0
      ? '<span class="vlist-pill is-orange" title="打开版本详情处理待办"><i></i>' + todo + ' 件事待处理</span>'
      : '<span class="vlist-pill is-gray"><i></i>无待办</span>') + '</td>'
    + '<td data-l="状态"><span class="vlist-pill ' + (VLIST_STATUS_TONE[r.versionStatus] || "is-gray") + '"><i></i>' + esc(statusName) + '</span></td>'
    + '<td class="vlist-act" data-l="操作"><button class="btn sm soft" type="button" data-ver-open="' + esc(r.versionId) + '" data-ver-req="' + esc(r.reqId) + '">' + (ended ? '查看' : '继续推进') + '</button></td>'
    + '</tr>';
}
function renderVersionList(){
  var rows = allVersionsCache || [];
  if(listUi.scopeType === "proj" && !listUi.scopeId) listUi.scopeId = rt.phaseReqId || "";
  var scoped = vlistScopedRows(rows);
  syncVersionListPageHead(rows, scoped);
  rt.phaseProjectName = listUi.scopeType === "proj" ? (reqNameById(listUi.scopeId) || "") : "";
  updateBrand();
  var multi = listUi.scopeType !== "proj";
  var filtered = vlistFiltered(rows);
  var cols = multi ? 8 : 7;
  var card;
  if(!rows.length){
    card = '<div class="panel vlist-card">' + UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"先在「项目」里创建项目并在其中新建版本，这里会按范围汇总可见的版本。"
    }) + '</div>';
  }else if(!scoped.length){
    var canNew = !multi && canEditReq(listUi.scopeId || rt.phaseReqId);
    card = '<div class="panel vlist-card">' + UI.emptyState({
      icon:"folder", title:vlistScopeLabel() + "下还没有版本",
      text: multi ? "版本 = 一次要交付的批次，先创建一个空壳，内容随时可以补。把范围切到单个项目后即可新建版本。" : "版本 = 一次要交付的批次，先创建一个空壳，内容随时可以补。",
      actionLabel: canNew ? "新建版本" : ""
    }) + '</div>';
  }else{
    var body = filtered.length
      ? filtered.map(vlistRowHTML).join("")
      : '<tr><td colspan="' + cols + '"><div class="allv-empty">没有匹配的版本，试试清空筛选。'
        + '<div class="vlist-empty-act"><button class="btn sm" type="button" data-vlist-reset>清空筛选</button></div></div></td></tr>';
    card = '<div class="panel vlist-card">' + vlistSelectionBarHTML(multi)
      + '<div class="tbl-wrap phase-tbl-wrap vlist-wrap"><table class="phase-tbl vlist-tbl allv-tbl"><thead><tr>'
      + (multi ? '<th class="vlist-check"><span class="sr-only">选择</span></th>' : '')
      + '<th>版本</th><th>工作项进度</th><th>需求覆盖</th><th>发布</th><th>下一步</th><th>状态</th><th class="vlist-act"></th>'
      + '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
  }
  var note = multi
    ? '范围为「' + vlistScopeLabel() + '」：版本按项目汇总展示；新建版本需先选定一个具体项目。点版本行进入聚合视图。'
    : '点任意版本行进入聚合视图；「下一步」由系统自动汇总，处理完自动消失。';
  var roBanner = !multi && !roleReadOnly() && !canEditReq(listUi.scopeId || rt.phaseReqId)
    ? '<div class="readonly-banner" role="status">'
      + '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.4 10S5.2 4.8 10 4.8 17.6 10 17.6 10 14.8 15.2 10 15.2 2.4 10 2.4 10Z"/><circle cx="10" cy="10" r="2.2"/></svg>'
      + '<span><b>只读项目</b>：你没有该项目的写入权限，可查看与导出。</span></div>'
    : "";
  phaseBody.innerHTML = roBanner + vlistToolbarHTML() + card + '<p class="vlist-foot">' + esc(note) + '</p>';
  wireVersionList();
}
function openNewVersionFromList(){
  var reqId = listUi.scopeType === "proj" ? (listUi.scopeId || rt.phaseReqId) : "";
  if(!reqId){ toast("新建版本需先选定一个具体项目", "warn"); return; }
  rt.phaseReqId = reqId;
  if(!canEditReq(reqId)){ denyPhaseReadOnly(); return; }
  openVersionDialog(null);
}
function exportVersionListCSV(){
  if(!allVersionsCache){ toast("版本列表还在加载，请稍后再导出", "warn"); return; }
  var rows = vlistFiltered(allVersionsCache);
  var lines = [["项目", "版本", "状态", "开始日期", "目标日期", "负责人", "已完成工作项", "工作项总数", "已覆盖需求", "需求总数", "下一计划时间", "下一计划环境", "下一计划状态", "生产成功次数", "预发成功次数", "最近生产发布", "待办数"]];
  rows.forEach(function(r){
    lines.push([r.projectName, r.versionName, versionStatusName(r.versionStatus), r.startDate || "", r.targetDate || "", r.ownerName || "",
      r.doneTaskCount || 0, r.taskCount || 0, r.coveredDemandCount || 0, r.demandCount || 0,
      r.nextPlanAt || "", vlistEnvName(r.nextPlanEnvironment), r.nextPlanStatus || "",
      r.productionSuccessCount || 0, r.stagingSuccessCount || 0, r.latestReleaseDate || "", r.todoCount || 0]);
  });
  var url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(function(row){ return row.map(csvCell).join(","); }).join("\r\n")], {type:"text/csv;charset=utf-8"}));
  var a = document.createElement("a");
  a.href = url;
  a.download = "版本清单-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function wireVersionList(){
  var btn = document.getElementById("vlistScopeBtn"), menu = document.getElementById("vlistScopeMenu");
  if(btn && menu){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
    });
  }
  if(menu) menu.addEventListener("click", function(e){
    var sb = e.target.closest("[data-vlist-scope]");
    if(sb){
      var type = sb.getAttribute("data-vlist-scope");
      listUi.scopeType = type;
      listUi.scopeId = type === "all" ? "" : (sb.getAttribute("data-vlist-id") || "");
      if(type === "proj" && listUi.scopeId) rt.phaseReqId = listUi.scopeId;
      allVersionsSel = [];
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      viewMode = type === "proj" ? "list" : "allversions";
      syncPhaseModeHash(viewMode);
      syncModeSeg();
      syncReqSel();
      renderVersionList();
      return;
    }
    var ab = e.target.closest("[data-vlist-analysis]");
    if(ab) applyPhaseMode(ab.getAttribute("data-vlist-analysis"));
  });
  phaseBody.querySelectorAll("[data-vlist-status]").forEach(function(b){
    b.addEventListener("click", function(){ listUi.status = b.getAttribute("data-vlist-status"); renderVersionList(); });
  });
  var sort = phaseBody.querySelector("[data-vlist-sort]");
  if(sort) sort.addEventListener("change", function(){ listUi.sort = sort.value; renderVersionList(); });
  var q = phaseBody.querySelector("[data-vlist-q]");
  if(q) q.addEventListener("input", function(){
    listUi.q = q.value;
    var pos = q.selectionStart;
    renderVersionList();
    var next = phaseBody.querySelector("[data-vlist-q]");
    if(next){ next.focus(); try{ next.setSelectionRange(pos, pos); }catch(e){ /* search 输入不支持选区 API */ } }
  });
  var reset = phaseBody.querySelector("[data-vlist-reset]");
  if(reset) reset.addEventListener("click", function(){ listUi.status = "all"; listUi.q = ""; renderVersionList(); });
  var emptyNew = phaseBody.querySelector(".vlist-card [data-empty-action]");
  if(emptyNew) emptyNew.addEventListener("click", openNewVersionFromList);
  var fresh = document.querySelector("#pageActions [data-vlist-new]");
  if(fresh) fresh.addEventListener("click", openNewVersionFromList);
  var exp = document.querySelector("#pageActions [data-vlist-export]");
  if(exp) exp.addEventListener("click", exportVersionListCSV);
}
function loadVersionList(){
  /* 深链 ?pmode=allversions 直接落全部项目；项目集范围在菜单里已写入 scopeType，保持不动 */
  if(viewMode === "allversions" && listUi.scopeType === "proj"){ listUi.scopeType = "all"; listUi.scopeId = ""; }
  if(listUi.scopeType === "proj" && !listUi.scopeId) listUi.scopeId = rt.phaseReqId || ((rt.reqList || [])[0] || {}).id || "";
  var current = ++allVersionsSeq;
  rt.phaseProjectName = listUi.scopeType === "proj" ? (reqNameById(listUi.scopeId) || "") : "";
  updateBrand();
  syncVersionListPageHead(allVersionsCache, null);
  phaseBody.innerHTML = UI.skeletonRows(5);
  var aliveMode = function(){ return current === allVersionsSeq && (viewMode === "list" || viewMode === "allversions"); };
  return API.get("/api/versions/cross-project").then(function(rows){
    if(!aliveMode()) return;
    allVersionsCache = rows || [];
    var alive = {};
    allVersionsCache.forEach(function(r){ alive[r.versionId] = !versionEnded({ status:r.versionStatus }); });
    allVersionsSel = allVersionsSel.filter(function(id){ return alive[id]; });
    renderVersionList();
  }).catch(function(ex){
    if(!aliveMode()) return;
    phaseBody.innerHTML = UI.emptyState({
      icon:"alert", title:"版本列表加载失败", text: ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    bindRetry(phaseBody, loadVersionList);
  });
}
/* 旧入口保留同名：外部与 E2E 仍按「全部版本」调用，落到的就是同一个列表 */
function loadAllVersions(){ return loadVersionList(); }
function renderAllVersions(){ renderVersionList(); }
function createPlanFromAllVersions(){
  var map = allVersionRowMap();
  var picked = allVersionsSel.map(function(id){ return map[id]; })
    .filter(function(r){ return r && r.canManage && !versionEnded({ status: r.versionStatus }) && r.versionStatus !== "released"; });
  if(!picked.length){ toast("先勾选至少一个可管理、未关闭/取消且未发布的版本", "warn"); return; }
  var anchor = picked[0];
  /* 原型：跨项目勾选后进入 4 步向导，第 1 步带着已勾版本继续；保存仍走同一计划接口 */
  import("./plan-wizard.js").then(function(m){
    m.openPlanWizard({ from:"phase", anchor:anchor.versionId, reqId:anchor.reqId,
      ids:picked.map(function(r){ return r.versionId; }) });
  }).catch(function(ex){ toast(ex && ex.message || "打不开新建计划向导", "bad"); });
}

/* ---------- 发布计划入口（跨项目列表已独立成菜单：这里只做跳转） ---------- */

function openPlanListJump(){
  var h = "#/release?time=quarter";
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("release");
}
function coverageName(c){ return { full:"全量", partial:"部分", unknown:"覆盖未知" }[c] || c || "—"; }

/* ---------- 渲染 ---------- */

function syncModeSeg(){
  var seg = $("phaseModeSeg");
  var listMode = viewMode === "list" || viewMode === "allversions";
  var cross = viewMode === "overview" || viewMode === "allversions";
  /* 新列表自带范围 / 状态工具条：旧工具条只在工作台、阶段分析与投入总览露出，
     但节点仍保留在 DOM 里，外部按 id 触发的入口（发布计划、项目切换）继续可用 */
  var legacyBar = document.querySelector("#phasePage > .page-toolbar");
  if(legacyBar) legacyBar.hidden = listMode;
  if(seg){
    seg.classList.toggle("is-scope", cross);
    seg.querySelectorAll("[data-pmode]").forEach(function(b){
      b.setAttribute("aria-pressed", !cross && b.dataset.pmode === viewMode);
    });
  }
  /* 跨项目口径：项目选择与新建版本让位给范围条；单项目分段置灰；
     发布计划与记录仍保留（进入时按当前项目上下文，与 IA 稿一致） */
  if(phaseReq) phaseReq.style.display = (cross || listMode) ? "none" : "";
  if($("phaseLabelRange")) $("phaseLabelRange").style.display = (cross || listMode) ? "none" : "";
  if($("btnVerNew")){
    /* 合成范围里新建版本会被拒绝：按钮保留但禁用并写清原因，不直接消失 */
    $("btnVerNew").style.display = "";
    $("btnVerNew").classList.add("primary");
    $("btnVerNew").disabled = cross;
    $("btnVerNew").title = cross ? "当前范围是全部项目 / 项目集：先在范围里选择具体项目，再新建版本" : "";
  }
  var scopeLabel = $("phaseScopeLabel");
  if(scopeLabel){
    scopeLabel.textContent = !cross ? "范围"
      : viewMode === "allversions" ? vlistScopeLabel()
      : (PHASE_SCOPE[viewMode] || {}).name || "范围";
  }
  var setsBox = $("phaseScopeSets");
  if(setsBox){
    var scopeProjects = (rt.reqList || []).filter(function(r){ return !r.archivedAt; });
    var setList = (rt.projectSets || []).filter(function(s){
      return scopeProjects.some(function(r){ return (r.setId || "") === s.id; });
    });
    setsBox.innerHTML = setList.map(function(s){
      var on = listUi.scopeType === "set" && listUi.scopeId === s.id;
      return '<button class="scope-item" type="button" role="menuitem" data-scope-set="' + esc(s.id) + '"' + (on ? ' aria-current="true"' : '') + '>'
        + '<span class="si-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A2 2 0 0 1 5 4.5h3l1.5 2H15a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></span>'
        + '<span class="si-tx"><b>项目集 · ' + esc(s.name) + '</b><span>只列该集下项目的版本</span></span></button>';
    }).join("");
  }
  var scopeBtn = $("phaseScopeBtn");
  if(scopeBtn){
    scopeBtn.classList.toggle("is-active", cross);
    scopeBtn.setAttribute("aria-expanded", "false");
  }
  var menu = $("phaseScopeMenu");
  if(menu){ menu.hidden = true; }
  if(menu) menu.querySelectorAll("[data-pmode]").forEach(function(b){
    var on = b.dataset.pmode === viewMode && !(viewMode === "allversions" && listUi.scopeType === "set");
    if(on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  var backName = $("phaseScopeBackName");
  if(backName) backName.textContent = rt.phaseReqId ? " · " + (reqNameById(rt.phaseReqId) || "") : "";
  var strip = $("phaseScopeStrip");
  if(strip){
    strip.hidden = viewMode !== "overview";
    if(viewMode === "overview"){
      var meta = PHASE_SCOPE.overview || {};
      if($("phaseScopeName")) $("phaseScopeName").textContent = meta.name || "";
      if($("phaseScopeDesc")) $("phaseScopeDesc").textContent = meta.desc || "";
    }
  }
}
function applyPhaseMode(mode){
  if(!PHASE_MODES[mode]) return;
  viewMode = mode;
  syncPhaseModeHash(mode);
  if(mode === "list"){
    listUi.scopeType = "proj";
    listUi.scopeId = rt.phaseReqId || ((rt.reqList || [])[0] || {}).id || "";
    syncReqSel();
    syncModeSeg();
    if(allVersionsCache) renderVersionList();
    else loadVersionList();
    return;
  }
  if(mode === "allversions"){
    if(listUi.scopeType === "proj"){ listUi.scopeType = "all"; listUi.scopeId = ""; }
    syncModeSeg();
    if(allVersionsCache) renderVersionList();
    else loadVersionList();
    return;
  }
  if(mode === "version" || mode === "phase"){
    /* 从范围回到单项目：下拉恢复成具体项目，三种范围共用同一个切换器 */
    if(!rt.phaseReqId && (rt.reqList || []).length) rt.phaseReqId = rt.reqList[0].id;
    syncReqSel();
    syncModeSeg();
    if(cache && cacheReqId === rt.phaseReqId) renderPhaseView();
    else loadPhaseData();
    return;
  }
  syncModeSeg();
  loadOverview();
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
    + '<span class="meta-right">' + (min ? (dateShort(min) + " ~ " + dateShort(end)) : "暂无工作项日期") + '</span></div>'
    + '<div class="phase-tl"><span class="tl-node">' + (min ? dateShort(min) : "—") + '<br>首版启动</span>'
    + '<div class="phase-bar">' + inner + '</div>'
    + '<span class="tl-node">' + dateShort(today) + '<br>今日</span></div></div>';
}
function phaseCardHTML(tagCls, tag, sub, cells, drill){
  /* 前四个是阶段主指标，定量格；后两个（准时率 / 均耗时）降为一行文字，避免六格等权 */
  var main = cells.slice(0, 4), extra = cells.slice(4);
  var subRow = extra.length ? '<div class="phase-submetrics">' + extra.map(function(c){
    var color = c[2] ? ' style="color:var(--' + c[2] + ');"' : '';
    if(drill && c[3] !== false){
      return '<button type="button" class="psub" data-drill-scope="' + esc(drill.scope)
        + '" data-drill-val="' + esc(drill.val) + '" data-drill-metric="' + esc(c[1]) + '">'
        + '<span>' + esc(c[1]) + '</span><b' + color + '>' + c[0] + '</b></button>';
    }
    return '<span class="psub"><span>' + esc(c[1]) + '</span><b' + color + '>' + c[0] + '</b></span>';
  }).join("") + '</div>' : "";
  return '<div class="phase-card"><div class="phase-card-head">'
    + '<span class="tag ' + tagCls + '">' + tag + '</span>'
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
    + metricCells(main, drill) + subRow + '</div>';
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
  var mvpMin = (p.mvp && p.mvp.workMinutes) || 0;
  var postMin = (p.post && p.post.workMinutes) || 0;
  return '<div class="panel"><div class="panel-head"><h3>按成员的阶段工时</h3>'
    + '<span class="meta-right member-total" title="自动计时按工作项完成日归入阶段">合计 首版 ' + fmtMinutesShort(mvpMin)
    + ' · 迭代 ' + fmtMinutesShort(postMin) + ' · 共 ' + fmtMinutesShort(mvpMin + postMin) + '</span></div>'
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
    + '<span class="meta-right"></span>' + seg + '</div>'
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
  rt.phaseProjectName = reqNameById(rt.phaseReqId) || "";
  updateBrand();
  if(phaseMeta){
    /* 项目名交给面包屑；工具条只说口径，避免标题行重复三遍项目名 */
    phaseMeta.textContent = firstRel
      ? ("首版上线 " + firstRel + " · 首版 / 迭代分析")
      : "未标记上线 · 首版 / 迭代分析";
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
    + memberTable()
    + taskTable("phase")
    /* 阶段工时汇总属于分析口径，跟首版 / 迭代分析放在一起，不再占用版本列表首屏 */
    + rollupPanelHTML();
  applyPhaseTblFilters();
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
/* ---------- 阶段投入（列表页头与行内构成） ---------- */
function stageCatName(id){
  var cats = (rollupUi && rollupUi.cats) || [];
  for(var i = 0; i < cats.length; i++) if(cats[i].id === id) return cats[i].name;
  return "未分类";
}
function versionStageOf(id){ return summarizeStages(rollupVersionTasks(id)); }
function versionStageTotals(rows){
  var all = [];
  (rows || []).forEach(function(v){ all = all.concat(rollupVersionTasks(v.id)); });
  return summarizeStages(all);
}
function versionStageSummaryHTML(rows){
  var s = versionStageTotals(rows);
  return stagePanelHTML({
    stage:s, mode:"actual", toggle:false, table:false, zeroNote:false,
    title:"阶段投入 · 当前筛选范围", badge:"全部版本",
    sub:(rows || []).length + " 个版本 · 累计 " + stageHoursText(s.actTotal) + " · 史诗不计入 · 跨版本合计会重复计",
    scope:"当前筛选的 " + (rows || []).length + " 个版本",
    note:"跨版本合计用于横向比较投入结构，不用于核算项目总成本；项目口径见项目驾驶舱。",
    denomLabel:"版本累计实际工时"
  });
}
function openPhaseStageDrill(el){
  var key = el && el.dataset ? el.dataset.stageDrill : "";
  if(!key) return;
  var ver = el.dataset.stageVer || "";
  var tasks, scope;
  if(ver === "__unbound__"){
    tasks = rollupVersionTasks("");
    scope = "未绑定版本";
  }else if(ver){
    tasks = rollupVersionTasks(ver);
    var hit = findVersion(ver);
    scope = "版本 · " + ((hit && hit.name) || ver);
  }else{
    var rows = versionListRows();
    tasks = [];
    rows.forEach(function(v){ tasks = tasks.concat(rollupVersionTasks(v.id)); });
    scope = "当前筛选的 " + rows.length + " 个版本";
  }
  openStageDrill({
    scopeLabel:scope,
    stageKey:key,
    rows:stageDrillRows(tasks, { catName:stageCatName })
  });
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
/* 进度条图例：颜色必须配文字，块色与条内分段同 token，不靠悬停标题才知道含义 */
function verBarLegendHTML(done, doing, blocked){
  /* 已完成的数量紧邻进度条（N / M），图例只解释段色，避免同一统计重复两遍 */
  var items = [];
  if(done) items.push('<span><i class="done"></i>已完成</span>');
  if(doing) items.push('<span><i class="doing"></i>进行中 <b>' + doing + '</b></span>');
  if(blocked) items.push('<span><i class="blocked"></i>阻塞 <b>' + blocked + '</b></span>');
  return items.length ? '<div class="vf-legend">' + items.join('') + '</div>' : "";
}
function versionFocusHTML(){
  var v = verFocusVersion();
  if(!v) return "";
  var id = v.id, req = v.reqId || rt.phaseReqId;
  var flags = verRowFlags(v);
  var total = Number(v.taskCount) || 0, done = Number(v.doneCount) || 0;
  var risk = verRisk(v);
  /* 与列表行同口径：已完成 + 进行中（未完成且已有计时）+ 阻塞 */
  var doing = ((cache && cache.tasks) || []).filter(function(t){
    return taskVersionIds(t).indexOf(id) >= 0 && t.boardColumn !== "done" && !t.blocked && Number(t.totalMinutes) > 0;
  }).length;
  var pct = total ? Math.round(done * 100 / total) : 0;
  var doingPct = total ? Math.max(0, Math.min(100 - pct, Math.round(doing * 100 / total))) : 0;
  var blockedPct = total ? Math.max(0, Math.min(100 - pct - doingPct, Math.round(risk.blocked * 100 / total))) : 0;
  var dotCls = v.status === "active" ? "info" : (v.status === "released" ? "success" : "");
  var acts;
  if(flags.canPublish){
    acts = '<button class="btn sm" type="button" data-ver-release="' + esc(id) + '">记录实际发布</button>';
  }else if(flags.editable){
    acts = '<button class="btn sm primary" type="button" data-ver-tasks="' + esc(id) + '">排入工作项</button>'
      + '<button class="btn sm" type="button" data-ver-edit="' + esc(id) + '">设置目标日期</button>';
  }else if(v.status === "released"){
    acts = '<button class="btn sm primary" type="button" data-ver-open-tab="scope" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '">查看工作项</button>'
      + '<button class="btn sm" type="button" data-ver-open-tab="releases" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '">发布记录</button>';
  }else{
    acts = '<button class="btn sm primary" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '">版本详情</button>';
  }
  var actual = Number(v.workMinutes) || 0;
  var metaBits = [];
  if(cycleWindow(v)) metaBits.push(cycleWindow(v));
  metaBits.push("范围 " + total + " 项");
  metaBits.push("完成 " + done);
  metaBits.push("预估 " + (Number(v.estimateMinutes) ? fmtMinutesShort(v.estimateMinutes) : "—")
    + " / 实际 " + (actual ? fmtMinutesShort(actual) : "—"));
  metaBits.push("偏差 " + devText(v.deviationPct));
  if(risk.atRisk) metaBits.push(verRiskText(risk));
  return '<section class="ver-focus" aria-labelledby="verFocusTitle">'
    + '<div class="vf-top">'
      + '<span class="vf-eyebrow"><i class="vf-dot ' + dotCls + '"></i>' + esc(verFocusLabel(v)) + '</span>'
      + verStatusTag(v.status)
      + '<span class="vf-goal">' + esc(verFocusPlanText(v)) + '</span>'
    + '</div>'
    + '<div class="vf-body">'
      + '<div class="vf-left">'
        + '<h2 id="verFocusTitle">' + esc(v.name) + '</h2>'
        + '<p class="vf-meta">' + metaBits.map(esc).join('<span class="vf-sep" aria-hidden="true"></span>') + '</p>'
        + '<div class="vf-bar">'
          /* 条内蓝「进行中」、橙「阻塞」的占比另给可见图例，颜色不单独承载语义 */
          + '<span class="vl-bar" role="img" aria-label="已完成 ' + pct + '%，进行中 ' + doingPct + '%，阻塞 ' + blockedPct + '%"'
            + ' title="绿 = 已完成 ' + done + ' 个 · 蓝 = 进行中 ' + doing + ' 个 · 橙 = 阻塞 ' + (Number(risk.blocked) || 0) + ' 个">'
            + '<i class="done" style="width:' + pct + '%"></i>'
          + (doingPct ? '<i class="doing" style="width:' + doingPct + '%"></i>' : '')
          + (blockedPct ? '<i class="blocked" style="width:' + blockedPct + '%"></i>' : '') + '</span>'
          + '<b>' + pct + '%</b><small>' + (total ? done + ' / ' + total + ' 工作项' : '未规划') + '</small>'
        + '</div>'
        + (total ? verBarLegendHTML(done, doing, Number(risk.blocked) || 0) : '')
      + '</div>'
      + '<div class="vf-acts">' + acts
        + '<button class="link" type="button" data-ver-open="' + esc(id) + '" data-ver-req="' + esc(req) + '">版本详情 →</button>'
        + '<button class="icon-btn sm vl-kebab" type="button" data-ver-menu="' + esc(id) + '" aria-label="更多操作" aria-haspopup="true">' + icon("more", 15) + '</button>'
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
  /* 行内条窄、放不下图例：把三段口径写进 title 与可访问名，避免只靠颜色 */
  var barLabel = total
    ? '已完成 ' + pct + '%（' + done + ' / ' + total + '）；进行中 ' + doing + ' 个；阻塞 ' + (Number(risk.blocked) || 0) + ' 个'
    : '未规划工作项';
  var progressCell = '<button class="vl-progress" type="button" data-ver-open-tab="scope" data-ver-id="' + esc(id) + '" data-ver-req="' + esc(req) + '" title="' + barLabel + ' · 查看工作项明细" aria-label="' + barLabel + ' · 查看工作项明细">'
    + (total
      ? '<span class="vl-bar"><i class="done" style="width:' + pct + '%"></i>' + (doingPct ? '<i class="doing" style="width:' + doingPct + '%"></i>' : '') + (blockedPct ? '<i class="blocked" style="width:' + blockedPct + '%"></i>' : '') + '</span>'
        + '<span class="vl-ptext"><b>' + pct + '%</b><small>' + done + ' / ' + total + '</small></span>'
      : '<span class="vl-bar empty"></span><span class="vl-ptext"><b>未规划</b><small>0 项</small></span>')
    + '</button>';
  var stageCell = stageRowHTML(versionStageOf(id), { versionId:id, scope:"版本 · " + v.name });
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
    + stageCell
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
      + (Number(u.doneCount) ? '，其中 ' + u.doneCount + ' 个已完成' : '') + '</span>'
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
  var stageBox = box.querySelector("[data-ver-stage]");
  if(stageBox) stageBox.innerHTML = versionStageSummaryHTML(rows);
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
    + '<div class="vl-stage-sum" data-ver-stage>' + versionStageSummaryHTML(versionListRows()) + '</div>'
    + '<div class="vl-head" aria-hidden="true"><span>版本</span><span>时间</span><span>进度</span><span class="vl-stage-head">阶段构成 · 点色块下钻</span><span>最近发布</span><span></span></div>'
    + '<div data-ver-rows></div>'
    + '<div class="vl-foot">'
    + '<button class="link-cell vl-foot-link" type="button" data-ver-plans-link>查看全部发布计划 →</button></div>'
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
  add("delivery", "交付报告");
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
  var status = { achieved:"已达成", achieved_rolled_back:"已达成 · 已回滚", evidence_missing:"证据缺失", overdue:"已延期", pending:"未达成" }[m.status] || m.status;
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
  acts += '<button class="btn sm ghost" type="button" data-ver-delivery="' + esc(v.id) + '" title="把承诺范围、实际发布、回归结果与遗留问题聚合成一份可对外提交的说明">交付报告</button>';
  if(permissions.canPublish === true) acts += '<button class="btn sm" type="button" data-ver-release="' + esc(v.id) + '">记录实际发布</button>';
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
  var s = { items:tasks.length, est:0, act:0, dev:0, test:0, done:0,
    stage:summarizeStages(tasks) };
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
    var stage = summarizeStages(tasks);
    var counts = { product:0, dev:0, test:0 };
    tasks.forEach(function(t){
      var a = stageActualOf(t);
      if(a.product > 0) counts.product++;
      if(a.dev > 0) counts.dev++;
      if(a.test > 0) counts.test++;
    });
    var done = tasks.filter(function(t){ return t.boardColumn === "done"; });
    var idle = tasks.filter(function(t){ return t.boardColumn !== "done" && rollupActual(t) === 0; });
    return STAGE_META.map(function(m){
      return { key:m.key, name:m.name, note:m.note, color:m.color, items:counts[m.key],
        est:stage.est[m.key], act:stage.act[m.key], dev:null, test:null };
    }).concat([
      { key:"done", name:"完成", note:"看板已完成，只计条目", color:"var(--success)", items:done.length, est:null, act:null },
      { key:"idle", name:"未开始", note:"未完成且还没有已记工时", color:"var(--text-3)", items:idle.length, est:null, act:null }
    ]);
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
    [rollupH(s.stage.estTotal), "预估工时", "预计 + 测试预估", "kpi", "est", "有预估的工作项"],
    [rollupH(s.act), "实际工时", s.act ? "产品 + 开发 + 测试" : "尚未计时", "kpi", "act", "有实际工时的工作项"],
    [rollupH(s.stage.act.product), "产品 / 设计", "需求类工作项的计时", "stage", "product", "产品 / 设计阶段的工作项"],
    [rollupH(s.stage.act.dev), "开发", "任务 / 缺陷在测试窗口外", "stage", "dev", "开发阶段的工作项"],
    [rollupH(s.stage.act.test), "测试", "测试窗口内计时", "stage", "test", "测试阶段的工作项"]
  ];
  return '<div class="pgrid roll-kpis">' + cells.map(function(c){
    return '<button type="button" class="pcell drillable" data-rollup-group="' + c[3] + '" data-rollup-key="' + c[4] + '" title="下钻：' + esc(c[5]) + '">'
      + '<b>' + esc(String(c[0])) + '</b><span>' + esc(c[1]) + ' · ' + esc(c[2]) + '</span></button>';
  }).join("") + '</div>';
}
function rollupSplitHTML(s){
  if(!s.act) return '<p class="foot-note roll-split-empty">还没有已结束的计时，产品 / 开发 / 测试拆分要等第一条计时产生。</p>';
  var parts = STAGE_META.map(function(m){
    return { key:m.key, name:m.name, color:m.color, act:s.stage.act[m.key],
      pct:Math.round((s.stage.act[m.key] || 0) * 100 / s.act) };
  });
  /* 三段取整后可能差 1%：把差额落在最后一段，保证读屏文案与条宽一致 */
  var sum = parts.reduce(function(a, p){ return a + p.pct; }, 0);
  if(parts.length) parts[parts.length - 1].pct += 100 - sum;
  return '<div class="roll-split" role="img" aria-label="实际工时中' + parts.map(function(p){
      return p.name + ' ' + p.pct + '%';
    }).join('，') + '">'
    + parts.map(function(p){
      return p.act > 0 ? '<i class="' + p.key + '" style="width:' + p.pct + '%;background:' + p.color + '"></i>' : '';
    }).join('') + '</div>'
    + '<div class="roll-split-legend">'
    + parts.map(function(p){
      return '<button type="button" data-rollup-group="stage" data-rollup-key="' + p.key + '" title="下钻：' + esc(p.name) + '阶段的工作项">'
        + '<i class="' + p.key + '" style="background:' + p.color + '"></i>' + esc(p.name) + ' ' + rollupH(p.act) + '（' + p.pct + '%）</button>';
    }).join('') + '</div>';
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
    + '<td class="num">' + s.items + '</td><td class="num">' + rollupH(stage ? s.stage.estTotal : s.est) + '</td><td class="num">' + rollupH(s.act) + '</td>'
    + (stage ? '' : '<td class="num">' + rollupH(s.dev) + '</td><td class="num">' + rollupH(s.test) + '</td>')
    + '<td class="num">' + rollupPct(s.act, s.act) + '</td>'
    + (stage ? '' : '<td class="num">' + rollupPct(s.est, s.est) + '</td>')
    + (stage ? '' : rollupDeltaHTML(s.act, s.est)) + '</tr>';
  return head + '<tbody>' + body + total + '</tbody>';
}
/* 跨版本默认只露 6 行：先给结论，需要时再展开全量 */
var ROLLUP_ALL_ROWS = 6;
function crossDeltaText(act, est){
  if(!est) return "—";
  var d = Math.round((Number(act) - Number(est)) * 100 / Number(est));
  return (d > 0 ? "+" : "") + d + "%";
}
function crossVersionRows(){
  var out = ((cache.vstats && cache.vstats.versions) || []).map(function(v){
    return { id:v.id, name:v.name, status:v.status, done:v.doneCount || 0, total:v.taskCount || 0,
      stage:summarizeStages(rollupVersionTasks(v.id)), unbound:false };
  });
  var u = (cache.vstats && cache.vstats.unbound) || {};
  if(Number(u.taskCount)){
    out.push({ id:"", name:"未绑定版本", status:"", done:u.doneCount || 0, total:Number(u.taskCount),
      stage:summarizeStages(rollupVersionTasks("")), unbound:true });
  }
  return out;
}
function rollupAllVersionsHTML(){
  var data = crossVersionRows();
  var rows = data.map(function(v){
    var s = v.stage;
    var verAttr = v.unbound ? "__unbound__" : v.id;
    var cells = STAGE_META.map(function(m){
      var x = s.act[m.key];
      return '<td class="num"><button class="cell-drill' + (x ? "" : " zero") + '" type="button"'
        + ' data-stage-drill="' + m.key + '" data-stage-ver="' + esc(verAttr) + '"'
        + ' data-stage-scope="' + esc((v.unbound ? "未绑定版本" : "版本 · " + v.name) + " · " + m.name) + '"'
        + ' title="下钻：' + esc((v.unbound ? "未绑定版本" : v.name) + " · " + m.name) + '">'
        + (x ? esc(stageHoursText(x)) : "—") + '</button></td>';
    }).join("");
    return '<tr class="roll-row" tabindex="0" data-rollup-group="version" data-rollup-ver="' + esc(v.id) + '" title="下钻该版本的工作项">'
      + '<td>' + (v.unbound
        ? '<span class="tag ghost">待规划</span>'
        : assocLinkHTML("version", v.id, v.name, {req:rt.phaseReqId})) + '</td>'
      + '<td>' + (v.unbound ? '<span class="muted">未绑定版本</span>' : versionStatusTag(v.status)) + '</td>'
      + '<td class="num">' + v.done + ' / ' + v.total + '</td>'
      + '<td class="num">' + (s.estTotal ? esc(stageHoursText(s.estTotal)) : "—") + '</td>'
      + '<td class="num">' + (s.actTotal ? esc(stageHoursText(s.actTotal)) : "—") + '</td>'
      + cells
      + (v.unbound ? '<td class="num muted">—</td>' : rollupDeltaHTML(s.actTotal, s.estTotal)) + '</tr>';
  });
  var cards = data.map(function(v){
    var s = v.stage;
    var verAttr = v.unbound ? "__unbound__" : v.id;
    var segs = STAGE_META.map(function(m){
      var x = s.act[m.key];
      return '<button class="cc-stage' + (x ? "" : " zero") + '" type="button"'
        + (x ? ' data-stage-drill="' + m.key + '" data-stage-ver="' + esc(verAttr) + '" data-stage-scope="' + esc((v.unbound ? "未绑定版本" : "版本 · " + v.name) + " · " + m.name) + '"' : " disabled")
        + '><i style="background:' + m.color + '"></i><span>' + (m.key === "product" ? "产品" : esc(m.name)) + '</span>'
        + '<b>' + (x ? esc(stageHoursText(x)) : "—") + '</b></button>';
    }).join("");
    return '<article class="cross-card"><div class="cc-head">'
      + (v.unbound ? '<span class="tag ghost">待规划</span><b>未绑定版本</b>' : assocLinkHTML("version", v.id, v.name, {req:rt.phaseReqId}))
      + (v.unbound ? "" : versionStatusTag(v.status))
      + '<b class="cc-dev' + (v.unbound || !s.estTotal ? " muted" : (s.actTotal > s.estTotal ? " over" : "")) + '">'
      + (v.unbound ? "—" : crossDeltaText(s.actTotal, s.estTotal)) + '</b></div>'
      + '<div class="cc-meta">' + v.done + ' / ' + v.total + ' 已完成 · 预估 ' + esc(stageHoursText(s.estTotal))
      + ' · 实际 ' + esc(stageHoursText(s.actTotal)) + '</div>'
      + '<div class="cc-stages">' + segs + '</div></article>';
  });
  var shown = rollupUi.more ? rows : rows.slice(0, ROLLUP_ALL_ROWS);
  var shownCards = rollupUi.more ? cards : cards.slice(0, ROLLUP_ALL_ROWS);
  var table = '<div class="tbl-wrap cross-table"><table class="phase-tbl roll-tbl"><thead><tr>'
    + '<th>版本</th><th>状态</th><th class="num">工作项</th><th class="num">预估</th><th class="num">实际</th>'
    + '<th class="num">产品 / 设计</th><th class="num">开发</th><th class="num">测试</th><th class="num">偏差</th>'
    + '</tr></thead><tbody>' + (shown.join("") || '<tr><td colspan="9" class="tbl-empty foot-note">还没有版本</td></tr>') + '</tbody></table></div>';
  var more = rows.length > ROLLUP_ALL_ROWS
    ? '<button class="link ver-rollup-more" type="button" data-rollup-more>'
      + (rollupUi.more ? '收起，只看最近 ' + ROLLUP_ALL_ROWS + ' 行' : '展开全部 ' + rows.length + ' 行')
      + icon(rollupUi.more ? "chevronUp" : "chevronRight", 12) + '</button>'
    : "";
  return table + '<div class="cross-cards">' + shownCards.join("") + '</div>'
    + '<div class="ver-rollup-foot"><span>版本之间只比较总量与拆分，不做逐项对齐；一个工作项绑定多个版本时会在多个版本里各计一次，跨版本合计不等于项目合计。</span>' + more + '</div>';
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
  var head = '<div class="ver-rollup-head"><div class="ver-rollup-title"><b>阶段工时汇总</b></div>'
    + ctl + '</div>';
  var notes = '<details class="manager-caliber ver-rollup-caliber"><summary>口径</summary><div>'
    + '阶段不是新数据，只是同一批工作项的另一种拆分：测试有真实数据，测试窗口（提测 → 测试结束）内的计时先归「测试」；剩下的计时按工作项类型拆，需求类（需求）归「产品 / 设计」，任务 / 缺陷归「开发」。三段互不重叠，合计始终等于版本累计实际工时。'
    + '产品 / 设计是近似口径：它统计的是需求类工作项上的全部非测试计时，产品评审、分析和跟进都应记在这条需求上；没有产品参与的需求类工作项会计 0，不做摊派。'
    + '测试窗口按自然日判断，提测当天、测试结束当天的计时可能被整段划入窗口；窗口外的任务 / 缺陷计时里也包含设计、运维等非开发工作。'
    + '预估按字段拆：产品 / 设计取需求类预计耗时，开发取任务 / 缺陷预计耗时，测试取测试预估；没填预估的工作项不会按 0 计入偏差。史诗只做分组，不计工时。'
    + '实际占比以版本累计实际为分母，阶段表只有实际占比；完成 / 未开始只计条目。点任意行下钻到工作项，再点行打开详情。'
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
      + ' · 实际 ' + rollupH(s.act) + ' = 产品 / 设计 ' + rollupH(s.stage.act.product)
      + ' + 开发 ' + rollupH(s.stage.act.dev) + ' + 测试 ' + rollupH(s.stage.act.test) + '</span></div>';
    body = rollupKpisHTML(s) + rollupSplitHTML(s) + table + foot;
  }
  return '<section class="ver-rollup" data-rollup>' + head + notes + body + '</section>';
}
function paintRollup(){
  if(!phaseBody || (viewMode !== "version" && viewMode !== "phase")) return;
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
    if(key === "est") tasks = tasks.filter(function(t){ return rollupEst(t) > 0 || Number(t.testEstimateMinutes) > 0; });
    if(key === "act") tasks = tasks.filter(function(t){ return rollupActual(t) > 0; });
  }else if(group === "stage"){
    name = { product:"产品 / 设计", dev:"开发", test:"测试", done:"完成", idle:"未开始" }[key] || "阶段";
    tasks = tasks.filter(function(t){
      if(key === "product" || key === "dev" || key === "test") return stageActualOf(t)[key] > 0;
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
      + (function(a){
        return '<td class="num">' + (a.product ? fmtMinutesShort(a.product) : "—") + '</td>'
          + '<td class="num">' + (a.dev ? fmtMinutesShort(a.dev) : "—") + '</td>'
          + '<td class="num">' + (a.test ? fmtMinutesShort(a.test) : "—") + '</td></tr>';
      })(stageActualOf(t));
  }).join("") || '<tr><td colspan="8" class="foot-note tbl-empty">该分组下暂无工作项</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(drillTitle) + '</h2>'
    + '<div class="desc">共 ' + tasks.length + ' 项 · 预估 ' + rollupH(s.est) + ' · 实际 ' + rollupH(s.act)
    + '（产品 / 设计 ' + rollupH(s.stage.act.product) + ' / 开发 ' + rollupH(s.stage.act.dev)
    + ' / 测试 ' + rollupH(s.stage.act.test) + '）· 点击工作项行打开详情</div></div>'
    + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>工作项</th><th>类型</th><th>负责人</th><th>状态</th><th class="num">预估</th><th class="num">实际</th><th class="num">产品 / 设计</th><th class="num">开发</th><th class="num">测试</th>'
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
  rt.phaseProjectName = reqNameById(rt.phaseReqId) || "";
  updateBrand();
  if(phaseMeta){
    var c = versionListCounts();
    phaseMeta.textContent = "按版本分组 · 共 " + cache.versions.length + " 个版本"
      + (c.planned ? " · " + c.planned + " 个计划中" : "") + (c.active ? " · " + c.active + " 个进行中" : "");
  }
  if(!cache.versions.length && !cache.tasks.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"点右上角「新建版本」创建第一个版本；工作项在详情抽屉里选择计划版本。"
    });
    return;
  }
  /* 列表页只承载「下一版 + 最近发布计划 + 其他版本队列」；工作项明细与阶段汇总分别收进版本详情、首版 / 迭代分析 */
  phaseBody.innerHTML = versionFocusHTML() + recentPlansCardHTML() + versionUnboundBannerHTML() + versionListShellHTML();
  paintVersionList();
}

/* ---------- 最近发布：已发布版本的结果快照，与「未完成计划」口径分开 ---------- */

function recentPlansCardHTML(){
  var rows = ((cache && cache.vstats && cache.vstats.versions) || []).map(mergedVersionRow)
    .filter(function(v){ return v.status === "released" || v.releasedAt; })
    .sort(function(a, b){ return String(b.releasedAt || "").localeCompare(String(a.releasedAt || "")); })
    .slice(0, 2);
  var body;
  if(!rows.length){
    body = '<p class="hint" style="padding:10px 14px">还没有已发布的版本；完成首次生产发布后，这里展示结果快照。</p>';
  }else{
    body = '<div class="rp-results">' + rows.map(function(v){
      var req = v.reqId || rt.phaseReqId;
      var total = Number(v.taskCount) || 0, done = Number(v.doneCount) || 0;
      var events = Number(v.releaseEventCount) || 0;
      return '<article class="rp-result">'
        + '<div class="rp-r-head"><b>' + esc(v.name || "未命名版本") + '</b>'
          + '<span class="tag tag-success">已发布</span>'
          + '<span class="tag ghost">' + esc(v.releasedAt ? dateShort(v.releasedAt) : "已发布") + '</span></div>'
        + '<p class="rp-r-meta">范围 ' + total + ' 项 · 完成 ' + done + ' · 生产发布成功'
          + (events ? ' · 记录 ' + events + ' 次发布' : '') + '</p>'
        + '<div class="rp-r-links">'
          + '<button class="link" type="button" data-ver-open="' + esc(v.id) + '" data-ver-req="' + esc(req) + '">版本详情</button>'
          + '<button class="link" type="button" data-ver-open-tab="releases" data-ver-id="' + esc(v.id) + '" data-ver-req="' + esc(req) + '">发布记录</button>'
        + '</div>'
      + '</article>';
    }).join("") + '</div>';
  }
  return '<section class="panel phase-recent-plans"><div class="panel-head"><h3>最近发布计划</h3>'
    + '<span class="meta-right">已发布 · 结果快照</span></div>'
    + body + '</section>';
}
function loadRecentPlans(){ /* 结果快照随版本统计同步渲染，不再单独请求未完成计划 */ }

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
    if(tool === "actual") return publishVersion(versionId);
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
    editingVerId = null;
    notifyDeliveryChanged(v.reqId || rt.phaseReqId);
    /* 新建后给下一步：刷新列表拿到该版本的发布计划权限标记，再决定是「去制定」还是说明为什么不能制定；
       只有项目写权限的人不该点进一个只能看的计划页 */
    var refreshed = Promise.resolve(reloadView());
    if(savedId){ toast("已更新版本「" + v.name + "」", "fs"); return; }
    refreshed.then(function(){
      var nv = findVersion(v.id);
      if(nv && nv.canManageReleasePlan !== true){
        toast("已创建版本「" + v.name + "」；当前身份不能维护发布计划，需管理员在「设置 → 工作流 → 发布权限」放开", "warn");
        return;
      }
      UI.toastAction("已创建版本「" + v.name + "」", "去制定发布计划", function(){
        openReleaseDetail(v.id, "plan");
      }, "fs", 10000);
    }, function(){
      /* 刷新失败拿不到权限标记：仍给入口，由计划页说明只读原因 */
      UI.toastAction("已创建版本「" + v.name + "」", "打开发布计划", function(){
        openReleaseDetail(v.id, "plan");
      }, "fs", 10000);
    });
  }).catch(function(ex){
    if(!versionDialogCurrent() || seq !== versionDialogSeq) return;
    btnSaveVer.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function releaseStatusName(status){ return PLAN_STATUS_META[status] ? PLAN_STATUS_META[status].name : "未创建"; }
/* 工具栏「发布计划与记录」：切到按版本视图，再按入口打开计划工作台或发布记录 */
function openProjectReleasePlan(entry){
  entry = entry === "history" ? "history" : "plan";
  if(!rt.phaseReqId){ toast("先选择项目，再查看发布计划与记录", "warn"); return; }
  var fromOverview = viewMode === "overview" || viewMode === "allversions" || viewMode === "list";
  viewMode = "version";
  syncPhaseModeHash(viewMode);
  syncModeSeg();
  var ready;
  if(cache && !fromOverview){ renderPhaseView(); ready = Promise.resolve(); }
  else ready = loadPhaseData() || Promise.resolve();
  ready.then(function(){
    if(document.body.dataset.view !== "phase" || viewMode !== "version") return;
    var versions = ((cache && cache.versions) || []).filter(function(v){ return !versionEnded(v); });
    if(!versions.length){ toast("该项目没有可制定发布计划的版本（已关闭或已取消的版本不参与）", "warn"); return; }
    /* 发布记录：已发布版本才有事实可看；没有则提示先去记录实际发布 */
    if(entry === "history"){
      var released = versions.filter(function(v){ return v.status === "released" || v.releasedAt; });
      if(!released.length){ toast("该项目还没有发布记录；先在有成功生产发布的版本上记录实际发布", "warn"); return; }
      versions = released;
    }
    if(versions.length === 1){ openReleaseDetail(versions[0].id, entry); return; }
    chooseReleaseVersion(versions, entry);
  }).catch(function(){});
}
/* 工具栏入口不再静默挑一个版本：多版本时先让用户选，避免误把计划写到别的版本上 */
function chooseReleaseVersion(versions, entry){
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", "选择版本");
  var hist = entry === "history";
  layer.innerHTML = '<div class="sheet sm"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>选择版本</h2><p class="desc">'
    + (hist ? "发布记录按版本归档，选一个已发布版本查看不可变的生产发布事实。"
      : "发布计划和实际记录都挂在具体版本上；先选版本，再填写计划或记录实际发布。")
    + '</p></div><button class="icon-btn sm" type="button" data-pick-close aria-label="关闭">' + icon("close", 15) + '</button></div><div class="sheet-body"><div class="release-version-list">'
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
    openReleaseDetail(versionId, hist ? "history" : "plan");
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
    + '<span class="toolbar-right"><span class="release-watch-slot" data-release-watch-slot></span><button class="btn sm ghost" type="button" data-release-plan-report title="按当前发布计划生成逐版本分章的交付报告">交付报告</button><button class="btn sm ghost" type="button" data-release-plan-share title="生成只读链接：对方无需登录即可查看计划范围与时间">分享计划</button><button class="btn sm ghost" type="button" data-release-view-version>查看版本</button><button class="btn sm ghost" type="button" data-release-history-entry>发布历史</button></span>'
    + '</div><div class="release-body release-page-body" aria-live="polite"></div>';
  host.innerHTML = "";
  host.appendChild(root);
  var surface = {
    layer: root,
    body: root.querySelector(".release-page-body"),
    watchSlot: root.querySelector("[data-release-watch-slot]"),
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
  var viewVersion = root.querySelector("[data-release-view-version]");
  if(viewVersion) viewVersion.addEventListener("click", function(){ openVersionPage(v.reqId, v.id, "scope"); });
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
    mod.openReleasePage({ id:id, reqId:reqId, tab: ["actual", "history"].indexOf(entry) >= 0 ? entry : "plan" });
  }).catch(function(ex){ toast(ex.message || "打开发布计划失败", "bad"); });
}
function releaseRecordHTML(record){ return releaseSnapshotHTML(record); }
/* 交付报告是低频视图：按需拉模块再落路由，不把纸张渲染器拉进版本页首屏 */
function openDeliveryNote(versionId, releaseId){
  if(!versionId){ toast("这条记录没有归属版本，无法生成交付报告", "warn"); return; }
  import("../core/view-loader.js").then(function(m){
    return m.loadView("delivery").then(function(mod){ mod.openDeliveryNote(versionId, releaseId); });
  }).catch(function(ex){ toast(ex.message || "打开交付报告失败", "bad"); });
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
/* 版本卡的「记录发布」落到独立记录页；计划编辑仍走发布工作区 */
function publishVersion(id){
  var v = findVersion(id);
  import("../core/view-loader.js").then(function(m){ return m.loadView("record"); }).then(function(mod){
    mod.openRecordPage({ versionId:id, reqId:(v && v.reqId) || rt.phaseReqId || "" });
  }).catch(function(ex){ toast(ex.message || "打不开记录发布页", "bad"); });
}
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
  var plans = [], planId = opts.planId || null, records = [], tasks = [], members = [], preview = null, previewContext = null;
  var busy = false, loadSeq = 0, previewSeq = 0, mayManage = false, mayPublish = false;
  /* 预览失效后要说清是「没预览过」还是「改过已过期」；范围区还兼顾异常清单，只在清单变化时重绘 */
  var previewStale = false, previewTried = false, scopeSig = "", scopeMode = "";
  var planOptions = null, planScopeVersionIds = null, planVersionQuery = "", planVersionShowReleased = false, planTaskPoolCache = {}, planTaskFetchKey = "", planTaskErrorKey = "", planTaskSeq = 0;
  var presetPlanVersionIds = opts.presetVersionIds && opts.presetVersionIds.length ? normalizedIds(opts.presetVersionIds) : null;
  var pending = null, storageError = "", recoveryMessage = "", recoveredRecord = null, retryAllowed = false, resetAllowed = false;
  var page = 0, filters = {result:"", environment:"", operation:""}, advancedOpen = false;
  /* 版本操作记录（version_log）：与正式发布记录分开，打开时拉一次，刷新按钮重新拉 */
  var verLog = {id:null, rows:[], error:""}, verLogSeq = 0;
  /* 发布检查：只读汇总本版本测试计划，随关联计划变化重新拉取；结论同时冻结进正式记录 */
  var releaseCheck = null, checkSeq = 0, checkLoading = false;
  /* 发布准备：只做提醒与核对，不改变工作项状态；按当前计划懒加载，独立于计划表单 */
  var prepState = { planId:"", loading:false, data:null, error:"", seq:0 };
  var watchState = { planId:"", loading:false, loaded:false, watching:false, count:0, seq:0 };
  /* 通知深链 #/release?prep=me：数据就绪后只自动打开一次，之后切换计划不再弹 */
  var openPrepOnMount = opts.prep === "me";
  /* 计划 / 实际 / 历史与内容 三个步骤：与原型页内步骤条一致；旧链接的 tab=content 归到历史与内容 */
  var activeTab = ["plan", "actual", "history", "content"].indexOf(opts.tab) >= 0 ? (opts.tab === "content" ? "history" : opts.tab) : (entry === "actual" ? "actual" : "plan");
  var syncingFromHash = false;
  var planJustSaved = false, planSavedRevision = null, restoreScroll = null, entryFocus = entry === "actual";
  var actualDraft = {planId:"", occurredAt:localMinute(), environment:"production", targetKeys:"", coverage:"full", artifactRef:"", artifactDigest:"", operation:"deploy", relatedReleaseId:"", executorUserId:"", actualTaskIds:[], deviationReason:"", result:"success", notes:"", failureReason:""};
  var actualPlanTouched = false;
  /* 用户亲手改过的实际字段：计划带入只补没动过的值，避免覆盖已经记录的事实 */
  var actualTouched = {};
  /* 实际发布面的本机草稿：长表单中途离开 / 刷新后能接着填；只存当前版本的字段与勾选，不参与正式记录 */
  var actualDraftKey = "hourglass:release-actual-draft:" + JSON.stringify([wsId, userId, id]);
  var ACTUAL_DRAFT_KEYS = ["planId", "occurredAt", "environment", "targetKeys", "coverage", "artifactRef", "artifactDigest", "operation", "relatedReleaseId", "executorUserId", "deviationReason", "result", "notes", "failureReason"];
  (function restoreActualDraft(){
    if(pending || storageError) return;
    try{
      var saved = JSON.parse(sessionStorage.getItem(actualDraftKey) || "null");
      if(!saved || typeof saved !== "object") return;
      ACTUAL_DRAFT_KEYS.forEach(function(k){ if(saved[k] !== undefined && saved[k] !== null) actualDraft[k] = String(saved[k]); });
      actualDraft.actualTaskIds = normalizedIds(saved.actualTaskIds);
      if(saved.savedAt) actualPlanTouched = true;
    }catch(ex){ /* 草稿损坏按没有处理，不影响正式记录 */ }
  })();
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
  /* 计划面顶部两个动作：交付报告按计划维度生成；分享给业务方只读查看范围与时间 */
  function actionPlanId(){ return planId || (plans.length === 1 ? plans[0].id : ""); }
  var planReportAct = layer.querySelector("[data-release-plan-report]");
  if(planReportAct) planReportAct.addEventListener("click", function(){
    var pid = actionPlanId();
    if(!pid){ toast("先在计划面保存一份发布计划，再生成交付报告", "warn"); return; }
    import("./delivery.js").then(function(m){ m.openPlanDeliveryNote(pid); })
      .catch(function(ex){ toast((ex && ex.message) || "打不开交付报告", "bad"); });
  });
  var planShareAct = layer.querySelector("[data-release-plan-share]");
  if(planShareAct) planShareAct.addEventListener("click", function(){
    var pid = actionPlanId();
    if(!pid){ toast("先在计划面保存一份发布计划，再生成分享链接", "warn"); return; }
    if(!mayManage){ toast("仅空间主、管理员或项目负责人可生成分享链接", "warn"); return; }
    import("../lib/plan-share.js").then(function(m){ m.openPlanShare(pid); })
      .catch(function(ex){ toast((ex && ex.message) || "打不开分享", "bad"); });
  });
  /* 分享要求覆盖项目的管理权；查看者仍可看已分享的公开页，但不能在这里生成或停止链接 */
  function syncPlanShareBtn(){
    if(!planShareAct) return;
    planShareAct.disabled = !mayManage;
    planShareAct.title = mayManage
      ? "生成只读链接：对方无需登录即可查看计划范围与时间"
      : "仅空间主、管理员或项目负责人可生成分享链接";
  }
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
  /* 计划里未出现在「可管理版本」清单中的版本：仍展示，保存前拦截并说明原因。
     缺项可能是无该项目写权限，也可能是版本已关闭 / 取消；前者不可勾选，后者取消勾选即移出。
     planOptions 加载失败时不做本地判定，交回后端校验，避免把全部版本误标为不可管理。 */
  function unmanageablePlanVersions(){
    if(!planOptions || !Array.isArray(planOptions.projects)) return [];
    var selected = planVersionSelection(), known = {};
    planVersionGroups().forEach(function(project){
      (project.versions || []).forEach(function(ver){ known[ver.id] = true; });
    });
    var p = selectedPlan(), meta = {};
    if(p && Array.isArray(p.versions)){
      p.versions.forEach(function(row){ if(row && row.versionId) meta[row.versionId] = row; });
    }
    /* 可选清单只含「未结束且可写」的版本，缺项有两种原因：已关闭 / 取消，或没有该项目写权限。
       两种都要能看见，但处理方式不同：前者取消勾选即移出计划，后者要找对应项目负责人。 */
    return selected.filter(function(vid){ return !known[vid]; }).map(function(vid){
      var row = meta[vid] || {}, status = row.versionStatus || "";
      return { versionId:vid, versionName:row.versionName || vid, projectName:row.projectName || "",
        status:status, ended: status === "closed" || status === "canceled" };
    });
  }
  function planVersionPicker(disabled){
    var selected = planVersionSelection(), groups = planVersionGroups(), missing = unmanageablePlanVersions();
    var ended = missing.filter(function(ver){ return ver.ended; }),
        locked = missing.filter(function(ver){ return !ver.ended; });
    if(!groups.length && !missing.length) return '<p class="hint">没有可管理的版本</p>';
    var q = String(planVersionQuery || "").trim().toLowerCase(), shown = missing.length, total = missing.length;
    var hiddenReleased = 0;
    /* 已保存计划里的版本：已发布的只在计划内保留（可移出），移出后不能再加入 */
    var saved = selectedPlan(), planMembers = saved && saved.id && Array.isArray(saved.versionIds)
      ? normalizedIds(saved.versionIds) : [];
    var html = groups.map(function(project){
      var all = project.versions || [];
      total += all.length;
      var hitProject = !!q && String(project.name || project.id).toLowerCase().indexOf(q) !== -1;
      /* 项目名命中就列出该项目全部版本；当前版本固定包含，搜索时也留在列表里 */
      var versions = all.filter(function(ver){
        if(!q || hitProject) return true;
        return String(ver.name || ver.id).toLowerCase().indexOf(q) !== -1 || String(ver.id) === String(id);
      });
      /* 已发布版本不能新加入计划：默认收起；计划内已有成员与当前版本始终可见，便于核对或移出 */
      versions = versions.filter(function(ver){
        if(ver.status !== "released") return true;
        if(selected.indexOf(ver.id) !== -1 || ver.id === id || planVersionShowReleased) return true;
        hiddenReleased++;
        return false;
      });
      if(!versions.length) return '';
      shown += versions.length;
      var projectCount = all.filter(function(ver){ return selected.indexOf(ver.id) !== -1; }).length;
      return '<div class="release-version-group" role="group" aria-label="' + esc(project.name || project.id) + '"><div class="release-version-project"><span class="release-version-project-name">' + esc(project.name || project.id) + '</span><span class="release-version-project-count' + (projectCount ? ' is-on' : '') + '" data-plan-version-group-count="' + esc(project.id) + '">' + (projectCount ? projectCount + ' / ' + all.length : '未选') + '</span></div>'
        + versions.map(function(ver){
          var on = selected.indexOf(ver.id) !== -1, fixed = ver.id === id;
          var releasedNew = ver.status === "released" && planMembers.indexOf(ver.id) === -1;
          var releasedMember = ver.status === "released" && !releasedNew && !fixed;
          var title = fixed ? '当前版本固定包含在计划中'
            : releasedNew ? '版本已发布，不能再加入新的发布计划；已在计划内的版本不受影响'
            : releasedMember ? '版本已发布；已在计划内可移出，移出后不能再加入' : '';
          return '<label class="release-version-row' + (on ? ' is-selected' : '') + (fixed ? ' is-fixed' : '') + (releasedNew ? ' is-released-locked' : '') + '"' + (title ? ' title="' + title + '"' : '') + '><input type="checkbox" data-plan-version="' + esc(ver.id) + '"' + (on ? ' checked' : '') + (disabled || fixed || releasedNew ? ' disabled' : '') + '><span><b>' + esc(ver.name || ver.id) + '</b><small>' + esc(versionStatusName(ver.status)) + (ver.targetDate ? ' · 目标 ' + esc(ver.targetDate) : '') + (fixed ? ' · 当前版本' : '') + (releasedNew ? ' · 已发布，不能加入' : releasedMember ? ' · 已发布，仅可移出' : '') + '</small></span></label>';
        }).join('') + '</div>';
    }).join('');
    var endedHtml = ended.length
      ? '<div class="release-version-group" role="group" aria-label="计划内已关闭或已取消的版本">'
        + '<div class="release-version-project"><span class="release-version-project-name">已关闭 / 已取消</span><span class="release-version-project-count is-on">' + ended.length + '</span></div>'
        + ended.map(function(ver){
            var fixed = ver.versionId === id, on = fixed || selected.indexOf(ver.versionId) !== -1;
            return '<label class="release-version-row' + (on ? ' is-selected' : '') + (fixed ? ' is-fixed' : '') + ' is-ended" title="' + (fixed ? '当前版本固定包含在计划中，且版本已关闭或取消' : '版本已关闭或取消，不能继续留在发布计划里；取消勾选即可移出') + '"><input type="checkbox" data-plan-version="' + esc(ver.versionId) + '"' + (on ? ' checked' : '') + (disabled || fixed ? ' disabled' : '') + '><span><b>' + esc(ver.versionName || ver.versionId) + '</b><small>' + esc(ver.projectName ? ver.projectName + ' · ' : '') + esc(versionStatusName(ver.status)) + (fixed ? ' · 当前版本' : ' · 取消勾选移出计划') + '</small></span></label>';
          }).join('')
        + '</div>'
      : '';
    var lockedHtml = locked.length
      ? '<div class="release-version-group" role="group" aria-label="不在你的可管理范围">'
        + '<div class="release-version-project"><span class="release-version-project-name">不在你的可管理范围</span><span class="release-version-project-count is-on">' + locked.length + '</span></div>'
        + locked.map(function(ver){
            return '<label class="release-version-row is-selected is-locked" title="该版本所属项目你没有写权限（或项目已归档），保存前请让对应项目负责人调整计划"><input type="checkbox" checked disabled data-plan-version-locked="' + esc(ver.versionId) + '"><span><b>' + esc(ver.versionName || ver.versionId) + '</b><small>' + esc(ver.projectName ? ver.projectName + ' · ' : '') + '需该项目写权限</small></span></label>';
          }).join('')
        + '</div>'
      : '';
    return '<div class="release-version-picker" role="group" aria-label="计划包含的版本">'
      + '<div class="release-version-tools"><input type="search" data-plan-version-search value="' + esc(planVersionQuery || "") + '" placeholder="搜索版本或项目" aria-label="搜索版本或项目" autocomplete="off">'
      + (hiddenReleased || planVersionShowReleased
        ? '<button class="btn sm ghost release-version-released-toggle" type="button" data-plan-version-toggle-released aria-pressed="' + (planVersionShowReleased ? "true" : "false") + '">'
          + (planVersionShowReleased ? "收起已发布" : "显示已发布（" + hiddenReleased + " · 仅可查看）") + '</button>'
        : "")
      + '<span class="release-version-count" role="status">显示 ' + shown + ' / 共 ' + total + ' 个版本</span></div>'
      + html + endedHtml + lockedHtml + '</div>'
      + '<p class="hint">计划可跨版本、跨项目；当前版本固定包含。已发布的版本不能再加入新的发布计划，默认收起；已在计划内的版本仍显示，可移出但不能重新加入。计划只是意图，实际发布仍按单个版本登记，全部包含版本都完成生产部署 / 重部署后计划才自动完成。</p>';
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
  /* ===== 计划带入 + 计划 vs 实际实时对照 =====
     计划在第 1 步维护；实际页只补「和计划不同的部分」。带入只填空字段，用户亲手改过的值不覆盖；
     「按计划重填」是显式覆盖。差异只影响说明要求，不改写工作项状态。 */
  function scopeTaskIds(){
    return normalizedIds(tasks.filter(function(t){ return taskVersionIds(t).indexOf(id) !== -1; }).map(function(t){ return t.id; }));
  }
  /* 多版本计划：实际记录只登记当前版本的任务，其他版本在各自的记录里核对（与后端 omitted 口径一致） */
  function planActualTaskIds(p){
    var scope = scopeTaskIds();
    return normalizedIds((p || {}).plannedTaskIds).filter(function(tid){ return scope.indexOf(tid) !== -1; });
  }
  function actualTouchedKey(target){
    if(!target || !target.matches) return "";
    if(target.matches('[data-release-occurredAt]')) return "occurredAt";
    if(target.matches('[data-release-environment]')) return "environment";
    if(target.matches('[data-release-coverage]')) return "coverage";
    if(target.matches('[data-release-targetKeys]')) return "targetKeys";
    if(target.matches('[data-actual-task]')) return "actualTaskIds";
    return "";
  }
  function inheritPlanFields(force, prev){
    var p = plans.find(function(item){ return item.id === actualDraft.planId; });
    if(!p) return [];
    var a = actualDraft, filled = [];
    if(force || !actualTouched.environment){
      var env = p.environment || "production";
      if(a.environment !== env){
        a.environment = env;
        /* 环境变了，可引用的历史事件也随之变化 */
        a.relatedReleaseId = "";
        filled.push("环境");
      }
    }
    if(force || !actualTouched.coverage){
      var cov = p.coverage || "full";
      if(a.coverage !== cov){ a.coverage = cov; filled.push("覆盖范围"); }
    }
    /* 目标键与工作项：换计划时，仍等于上一个计划带入值的字段随之替换；用户亲手改过的不动 */
    var prevTargets = prev ? normalizedIds(prev.targetKeys) : [];
    var currentTargets = lines(a.targetKeys);
    var targets = normalizedIds(p.targetKeys).join("\n");
    if(targets && (force || (!actualTouched.targetKeys && (!currentTargets.length || sameIds(currentTargets, prevTargets)))) && a.targetKeys !== targets){
      a.targetKeys = targets; filled.push("目标键");
    }
    var planTasks = planActualTaskIds(p), prevTasks = prev ? planActualTaskIds(prev) : [];
    if(planTasks.length && (force || (!actualTouched.actualTaskIds && (!a.actualTaskIds.length || sameIds(a.actualTaskIds, prevTasks)))) && !sameIds(a.actualTaskIds, planTasks)){
      a.actualTaskIds = planTasks; filled.push("工作项");
    }
    if(force){
      var when = localMinute(p.plannedAt);
      if(when && new Date(when).getTime() <= Date.now() && a.occurredAt !== when){ a.occurredAt = when; filled.push("发生时间"); }
    }
    return filled;
  }
  function syncActualFieldInputs(){
    [["[data-release-occurredAt]", "occurredAt"], ["[data-release-environment]", "environment"], ["[data-release-coverage]", "coverage"], ["[data-release-targetKeys]", "targetKeys"]].forEach(function(pair){
      var el = layer.querySelector(pair[0]);
      if(el) el.value = actualDraft[pair[1]] || "";
    });
    layer.querySelectorAll('[data-actual-task]').forEach(function(cb){ cb.checked = actualDraft.actualTaskIds.indexOf(cb.getAttribute("data-actual-task")) !== -1; });
  }
  var inheritSig = "", diffSig = "";
  /* 计划绑定的版本清单：用计划接口已带回的 versions（名称 / 项目 / 状态 / 是否已发布），
     缺字段时退回 versionIds 只显示编号末尾，避免又只剩一句「N 个版本」 */
  function planBoundVersions(p){
    var rows = p && Array.isArray(p.versions) ? p.versions.filter(function(r){ return r && r.versionId; }) : [];
    if(rows.length) return rows;
    return normalizedIds(p && p.versionIds).map(function(vid){ return {versionId:vid}; });
  }
  function planBoundVersionRow(row){
    var cur = row.versionId === id;
    return '<li class="rel-inh-ver' + (cur ? ' is-current' : '') + '">'
      + '<span class="rel-inh-ver-t">' + esc(row.projectName ? row.projectName + " · " : "") + '<b>' + esc(row.versionName || ("#" + String(row.versionId).slice(-6))) + '</b></span>'
      + '<span class="tag ghost">' + esc(versionStatusName(row.versionStatus)) + '</span>'
      + (cur ? '<span class="tag tag-info">本次登记</span>' : '')
      + (row.released ? '<span class="tag tag-success">已发布</span>' : '')
      + '</li>';
  }
  function renderPlanInherit(){
    var host = layer.querySelector('[data-release-plan-inherit]');
    if(!host){ inheritSig = ""; return; }
    var p = plans.find(function(item){ return item.id === actualDraft.planId; });
    if(!p){ if(inheritSig){ host.innerHTML = ""; inheritSig = ""; } return; }
    var planTasks = planActualTaskIds(p), targets = normalizedIds(p.targetKeys), versions = planBoundVersions(p);
    var sig = [p.id, p.status || "", planTasks.length, targets.join(","), p.plannedAt || "",
      versions.map(function(r){ return [r.versionId, r.versionStatus || "", r.released ? 1 : 0].join(":"); }).join(","),
      pending || storageError ? "x" : ""].join("|");
    if(sig === inheritSig) return;
    inheritSig = sig;
    var shown = versions.slice(0, 6);
    var multi = versions.length > 1 ? ' 计划包含 ' + versions.length + ' 个版本，本次只登记当前版本；全部版本生产成功后计划自动完成。' : '';
    host.innerHTML = '<div class="release-inherit">'
      + '<div class="release-inherit-h"><b>计划带入</b><span class="tag tag-info">' + esc(releasePlanNoText(p.planNo) || ("#" + p.id)) + '</span><span class="tag ghost">' + esc(releaseStatusName(p.status)) + '</span><span class="sp"></span>'
      + '<button class="btn sm ghost" type="button" data-release-apply-plan' + (pending || storageError ? ' disabled' : '') + '>按计划重填</button>'
      + '<button class="btn sm ghost" type="button" data-release-goto-plan>查看 / 调整计划</button></div>'
      + '<p class="release-inherit-b">计划范围：' + planTasks.length + ' 项 · ' + esc(releaseEnvironmentName(p.environment || "production")) + ' · ' + esc(p.plannedAt ? fmtReleaseTime(p.plannedAt).slice(0, 16) : "时间未定") + (targets.length ? ' · ' + esc(targets.join(" / ")) : '') + '。修改环境、覆盖范围、目标键或工作项会标为计划偏差，下方「计划 vs 实际」实时对照；时间变更只记录。' + esc(multi) + '</p>'
      + (versions.length
        ? '<div class="release-inherit-vers"><span class="release-inherit-vers-t">计划绑定的版本（' + versions.length + '）</span>'
          + '<ul>' + shown.map(planBoundVersionRow).join("")
          + (versions.length > shown.length ? '<li class="rel-inh-more">另有 ' + (versions.length - shown.length) + ' 个版本，可在第 1 步「计划包含的版本」查看</li>' : '')
          + '</ul></div>'
        : '')
      + '</div>';
  }
  /* 「未按计划发布的原因」常显在预览区上方：被拦时滚动并聚焦到它，并用高亮标出位置 */
  function revealDeviationReason(){
    var box = layer && layer.querySelector('[data-release-deviationReason]');
    if(!box) return;
    try{ box.scrollIntoView({block:"center", behavior:"smooth"}); }catch(ex){ try{ box.scrollIntoView(); }catch(ex2){ /* noop */ } }
    try{ box.focus({preventScroll:true}); }catch(ex3){ try{ box.focus(); }catch(ex4){ /* noop */ } }
    box.classList.add("is-attention");
    setTimeout(function(){ if(box) box.classList.remove("is-attention"); }, 1600);
  }
  function renderActualDiff(){
    var host = layer.querySelector('[data-release-diff]');
    if(!host){ diffSig = ""; return; }
    var p = plans.find(function(item){ return item.id === actualDraft.planId; });
    if(!p){
      /* 无计划时对照表无从展开，但原因仍是必填：就地给出切计划和填原因的入口。
         内容无输入控件，直接重设，避免重绘后旧缓存把提示吞掉 */
      diffSig = "no-plan";
      host.innerHTML = '<div class="release-diff"><div class="release-diff-h"><b>计划 vs 实际</b><span class="tag tag-warning">未关联计划</span></div>'
        + '<p class="hint">本次没有选择发布计划，需要在「未按计划发布的原因」里说明缘由；也可以回到第 1 步选择一个就绪计划。</p>'
        + '<div class="release-diff-acts"><button class="btn sm" type="button" data-diff-plan>去选择发布计划</button>'
        + '<button class="btn sm ghost" type="button" data-diff-reason>填写原因</button></div></div>';
      return;
    }
    var a = actualDraft, rows = [], same = [];
    var cmp = function(label, planText, actualText, diff, action){
      if(diff) rows.push({label:label, plan:planText, actual:actualText, diff:diff, action:action || ""});
      else same.push(label);
    };
    var planMs = p.plannedAt ? new Date(p.plannedAt).getTime() : NaN;
    var actMs = a.occurredAt ? new Date(a.occurredAt).getTime() : NaN;
    var timeDiff = !a.occurredAt ? "未填写"
      : isNaN(planMs) ? "计划未定时间"
      : (function(){ var m = Math.round((actMs - planMs) / 60000); return m === 0 ? "" : (m > 0 ? "晚 " + m + " 分钟" : "早 " + (-m) + " 分钟"); })();
    cmp("发生时间", p.plannedAt ? fmtReleaseTime(p.plannedAt).slice(0, 16) : "时间未定", a.occurredAt ? fmtReleaseTime(a.occurredAt).slice(0, 16) : "未填写", timeDiff, !isNaN(planMs) && planMs <= Date.now() ? "occurredAt" : "");
    cmp("环境", releaseEnvironmentName(p.environment || "production"), releaseEnvironmentName(a.environment), (p.environment || "production") !== a.environment ? "不同" : "", "environment");
    cmp("覆盖范围", coverageName(p.coverage || "full"), coverageName(a.coverage), (p.coverage || "full") !== a.coverage ? "不同" : "", "coverage");
    var planTargets = normalizedIds(p.targetKeys), actualTargets = lines(a.targetKeys);
    cmp("目标键", planTargets.join(" / ") || "未填写", actualTargets.join(" / ") || "未填写",
      sameIds(planTargets, actualTargets) ? "" : (planTargets.length === actualTargets.length ? "内容不同" : "数量不同"), "targetKeys");
    var planTasks = planActualTaskIds(p), allPlan = normalizedIds(p.plannedTaskIds);
    var omitted = planTasks.filter(function(tid){ return a.actualTaskIds.indexOf(tid) === -1; });
    var extra = a.actualTaskIds.filter(function(tid){ return planTasks.indexOf(tid) === -1; });
    var unfinished = a.actualTaskIds.filter(function(tid){ var t = tasks.find(function(x){ return x.id === tid; }); return !t || t.boardColumn !== "done"; });
    var taskDiff = [];
    if(omitted.length) taskDiff.push("计划内未选入 " + omitted.length + " 项");
    if(extra.length) taskDiff.push("超出计划 " + extra.length + " 项");
    if(unfinished.length) taskDiff.push("其中 " + unfinished.length + " 项未完成");
    var otherVersions = allPlan.length - planTasks.length;
    cmp("工作项", planTasks.length + " 项" + (otherVersions ? "（另 " + otherVersions + " 项属其他版本）" : ""), a.actualTaskIds.length ? a.actualTaskIds.length + " 项" : "未勾选", taskDiff.join(" · "), "actualTaskIds");
    var planVids = normalizedIds(p.versionIds);
    if(planVids.length && planVids.indexOf(id) === -1) rows.push({label:"适用版本", plan:planVids.length + " 个版本", actual:"当前版本", diff:"计划不包含当前版本", action:"plan"});
    else same.push("适用版本");
    if(p.status !== "ready") rows.push({label:"计划状态", plan:releaseStatusName(p.status), actual:"—", diff:p.status === "completed" ? "计划已完成，不可复用" : "计划未就绪", action:"plan"});
    else same.push("计划状态");
    var sig = [p.id, p.status || "", rows.map(function(r){ return [r.label, r.plan, r.actual, r.diff].join(":"); }).join("|"), same.join(","), unfinished.length].join("|");
    if(sig === diffSig) return;
    diffSig = sig;
    if(!rows.length){
      host.innerHTML = '<div class="release-diff"><div class="release-diff-h"><b>计划 vs 实际</b><span class="tag tag-success">与计划一致</span></div><p class="hint">发生时间、环境、覆盖范围、目标键与工作项都与计划一致，无需填写计划偏差原因。</p></div>';
      return;
    }
    host.innerHTML = '<div class="release-diff"><div class="release-diff-h"><b>计划 vs 实际</b><span class="tag tag-warning">差异 ' + rows.length + ' 项</span>' + (same.length ? '<span class="hint">一致：' + esc(same.join("、")) + '</span>' : '') + '</div>'
      + '<div class="tbl-wrap"><table class="phase-tbl release-diff-tbl"><thead><tr><th>对照项</th><th>计划</th><th>实际</th><th>差异</th><th>处理</th></tr></thead><tbody>'
      + rows.map(function(r){
        var act = r.action === "plan" ? '<button class="btn sm ghost" type="button" data-diff-plan>去检查发布计划</button>'
          : r.action === "actualTaskIds" ? '<button class="btn sm ghost" type="button" data-diff-apply="actualTaskIds">按计划勾选</button>'
          : r.action ? '<button class="btn sm ghost" type="button" data-diff-apply="' + r.action + '">按计划</button>' : '';
        return '<tr><td>' + esc(r.label) + '</td><td>' + esc(r.plan) + '</td><td>' + esc(r.actual) + '</td><td class="diff">' + esc(r.diff || "不同") + '</td><td>' + act + '</td></tr>';
      }).join("")
      + '</tbody></table></div>'
      + '<div class="release-diff-acts">' + (unfinished.length ? '<button class="btn sm" type="button" data-diff-drop>取消未完成项（' + unfinished.length + '）</button>' : '')
      + '<button class="btn sm" type="button" data-diff-reason>填写未按计划发布的原因</button>'
      + '<span class="hint">环境、覆盖范围、目标键与工作项偏离计划需填写原因；时间偏差只记录，不改写工作项状态。</span></div></div>';
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
        return '<label class="version-task-row release-task-row" data-task-row data-task-id="' + esc(t.id) + '" data-task-title="' + esc(String(t.title || "").toLowerCase()) + '" data-task-state="' + (t.boardColumn === "done" ? "done" : "open") + '" data-task-published="' + (taskIsPublished(t) ? "1" : "0") + '"><input type="checkbox" data-' + prefix + '-task="' + esc(t.id) + '"' + (ids.indexOf(t.id) !== -1 ? ' checked' : '') + (disabled || !allowed ? ' disabled' : '') + '><span><span class="version-task-title"><a class="task-picker-link" href="' + esc(taskHref(t.id)) + '" data-task-link="' + esc(t.id) + '" title="打开工作项详情；Ctrl / ⌘ 点击在新标签页打开"><b>' + esc(t.title) + '</b></a>' + taskPublicationHTML(t) + '</span><small>' + esc(colName(t.boardColumn)) + ' · 完成 ' + esc(fmtReleaseTime(t.completedAt)) + ' · 版本 ' + esc(taskVersionsText(t) || "待规划") + '</small></span></label>';
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
  function setTabCount(key, n){ updateSteps(); }
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
    if(prefix === "actual"){ readActual(); actualTouched.actualTaskIds = true; }
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
  /* 实际发布就绪条件：字段是否齐备、为什么需要、缺失去哪里补；与提交按钮共用同一份判定 */
  function actualNeedItems(a){
    a = a || actualDraft;
    return [
      {key:"occurredAt", label:"实际发生时间", ok:!!a.occurredAt, need:"用于和计划时间比对，也是审计事实的时间锚点", go:"去填写", sel:'[data-release-occurredAt]'},
      {key:"executorUserId", label:"实际执行人", ok:!!a.executorUserId, need:"执行人独立于记录人，便于追溯是谁操作的", go:"去选择", sel:'[data-release-executorUserId]'},
      {key:"artifactRef", label:"制品标识", ok:!!String(a.artifactRef || "").trim(), need:"证明本次部署的是哪个构建，不能只写版本名", go:"去填写", sel:'[data-release-artifactRef]'},
      {key:"targetKeys", label:"实际目标键", ok:lines(a.targetKeys).length > 0, need:"回滚与影响范围都要按目标键核对", go:"去填写", sel:'[data-release-targetKeys]'},
      {key:"actualTaskIds", label:"实际交付工作项", ok:a.actualTaskIds.length > 0, need:"发布快照按本次实际交付的工作项生成", go:"去勾选", sel:'[data-actual-task]'}
    ];
  }
  function actualNeedStats(a){
    var items = actualNeedItems(a), ok = items.filter(function(x){ return x.ok; }).length;
    return {items:items, ok:ok, total:items.length, ready:ok === items.length};
  }
  function actualReady(){ return actualNeedStats().ready; }
  function readinessCardHTML(){
    return '<aside class="rel-ready" data-release-ready-card aria-label="发布就绪条件">'
      + '<div class="rel-ready-head"><b>就绪条件</b><span data-ready-count></span></div>'
      + '<div class="rel-ready-list" data-ready-list></div>'
      + '<p class="rel-ready-note">记录后版本进入只读；如需更正，请走「登记回滚 / 重部署」，不会覆盖本次事实。</p>'
      + '<div class="rel-ready-block" data-ready-block hidden></div>'
      + '<div class="rel-ready-foot"><span data-ready-foot></span><span class="sp"></span><button class="btn sm" type="button" data-release-draft>保存草稿</button><button class="btn sm primary" type="button" data-release-confirm disabled>记录发布</button></div>'
      + '</aside>';
  }
  /* 「记录发布」被拦的可见原因与下一步；按钮 title 只是补充，不能当唯一说明 */
  function readyBlockAction(code){
    if(code === "noPreview") return '<button type="button" class="btn sm" data-release-preview>预览本次范围</button>';
    if(code === "blockedNoReason" || code === "previewBlocked") return '<button type="button" class="btn sm" data-ready-reason>填写原因</button>';
    if(code === "planDirty") return '<button type="button" class="btn sm" data-release-goto-plan>去看计划</button>';
    return "";
  }
  function updateReadyCard(){
    var card = layer.querySelector("[data-release-ready-card]");
    if(!card) return;
    var s = actualNeedStats();
    var count = card.querySelector("[data-ready-count]");
    if(count) count.textContent = s.ok + " / " + s.total;
    var list = card.querySelector("[data-ready-list]");
    if(list){
      list.innerHTML = s.items.map(function(it){
        return '<div class="rel-need' + (it.ok ? " is-ok" : " is-miss") + '"><span class="rel-need-ic" aria-hidden="true">' + (it.ok ? "✓" : "!") + '</span><div><div class="rel-need-t">' + esc(it.label) + '</div>'
          + (it.ok ? "" : '<div class="rel-need-r">为什么需要：' + esc(it.need) + '。去 <button type="button" class="rel-need-go" data-ready-go="' + esc(it.key) + '">' + esc(it.go) + '</button></div>')
          + '</div></div>';
      }).join("");
    }
    var previewOk = !!(preview && preview.canPublish !== false && !preview.requiresDeviationReason);
    var foot = card.querySelector("[data-ready-foot]");
    if(foot) foot.textContent = s.ok + " / " + s.total + " 项就绪" + (s.ready ? (previewOk ? " · 预览通过" : preview ? " · 预览未通过" : " · 待预览") : "");
    var block = card.querySelector("[data-ready-block]");
    if(!block) return;
    var state = s.ready ? confirmBlockState() : null;
    if(!state || busy){ block.hidden = true; block.innerHTML = ""; return; }
    block.hidden = false;
    block.innerHTML = '<b>暂不能记录</b><span>' + esc(state.text) + '</span>' + readyBlockAction(state.code);
  }
  /* 页内 3 步条：计划范围 → 实际发布 → 历史与内容；当前步实心，走过的步也实心 */
  function stepHTML(key, num, label, meta, disabled){
    return '<button type="button" class="rel-step" data-release-step="' + key + '"' + (disabled ? ' disabled aria-disabled="true"' : '') + '>'
      + '<span class="rel-step-no" aria-hidden="true">' + num + '</span>'
      + '<span class="rel-step-tx">' + label + '</span>'
      + '<span class="rel-step-meta" data-rel-step-meta="' + key + '">' + meta + '</span></button>';
  }
  function contentCount(){
    return tasks.filter(function(t){ return taskVersionIds(t).indexOf(id) !== -1; }).length;
  }
  function stepsHTML(){
    var planCount = layer.querySelectorAll('[data-plan-task]:checked').length;
    var ready = actualNeedStats();
    return '<div class="rel-steps-wrap"><nav class="rel-steps" aria-label="发布工作台步骤">'
      + stepHTML("plan", 1, "计划范围", planCount ? planCount + " 项" : "未建计划")
      + '<span class="rel-step-line" aria-hidden="true"></span>'
      + stepHTML("actual", 2, "实际发布", mayPublish ? ready.ok + " / " + ready.total + " 项就绪" : "当前不可操作", !mayPublish)
      + '<span class="rel-step-line" aria-hidden="true"></span>'
      + stepHTML("history", 3, "历史与内容", records.length + " 次发布 · " + contentCount() + " 项内容")
      + '</nav><button class="btn sm" data-release-refresh type="button">刷新</button></div>';
  }
  function updateSteps(){
    var cur = activeTab === "actual" ? 2 : activeTab === "plan" ? 1 : 3;
    layer.querySelectorAll("[data-release-step]").forEach(function(b){
      var n = {plan:1, actual:2, history:3}[b.getAttribute("data-release-step")] || 0;
      b.classList.toggle("is-active", n === cur);
      b.classList.toggle("is-done", n < cur);
      b.setAttribute("aria-current", n === cur ? "step" : "false");
    });
    var planMeta = layer.querySelector('[data-rel-step-meta="plan"]');
    if(planMeta){
      var planCount = layer.querySelectorAll('[data-plan-task]:checked').length;
      planMeta.textContent = planCount ? planCount + " 项" : "未建计划";
    }
    var readyMeta = layer.querySelector('[data-rel-step-meta="actual"]');
    if(readyMeta){ var s = actualNeedStats(); readyMeta.textContent = mayPublish ? s.ok + " / " + s.total + " 项就绪" : "当前不可操作"; }
    var histMeta = layer.querySelector('[data-rel-step-meta="history"]');
    if(histMeta) histMeta.textContent = records.length + " 次发布 · " + contentCount() + " 项内容";
  }
  function saveActualDraft(){
    if(busy) return;
    readActual();
    try{
      var body = {};
      ACTUAL_DRAFT_KEYS.forEach(function(k){ body[k] = actualDraft[k]; });
      body.actualTaskIds = actualDraft.actualTaskIds.slice();
      body.savedAt = new Date().toISOString();
      sessionStorage.setItem(actualDraftKey, JSON.stringify(body));
      toast("已保存到本机草稿；刷新后打开此版本会自动恢复", "fs");
    }catch(ex){ toast("浏览器存储不可用，草稿未能保存", "warn"); }
  }
  function clearActualDraft(){
    try{ sessionStorage.removeItem(actualDraftKey); }catch(ex){ /* 忽略 */ }
  }
  function updateChecklists(){
    var planEl = layer.querySelector("[data-plan-readiness]");
    if(planEl){
      var b = planBody();
      var items = [[!!b.plannedAt, "计划时间"], [!!b.ownerUserId, "负责人"], [b.plannedTaskIds.length > 0, "工作项（已选 " + b.plannedTaskIds.length + " 项）"]];
      /* 目标键与后端 dimensions() 同口径：全量 / 部分覆盖必须明确目标，覆盖未知可留空，与是否就绪无关 */
      if(b.coverage !== "unknown") items.push([b.targetKeys.length > 0, "目标键（覆盖为全量 / 部分时必填）"]);
      items.push([b.status === "ready", "状态：就绪"]);
      if(planReasonRequired(b)) items.push([!!b.reason, "理由（修改就绪计划 / 取消计划必填）"]);
      var miss = items.filter(function(x){ return !x[0]; }).map(function(x){ return x[1]; });
      planEl.className = "release-readiness" + (miss.length ? "" : " is-ready");
      planEl.textContent = "就绪条件 " + (items.length - miss.length) + "/" + items.length + "：" + (miss.length ? "还缺 " + miss.join("、") : "已满足，可保存为就绪计划");
      var planCount = layer.querySelector("[data-plan-task-count]");
      if(planCount) planCount.textContent = String(b.plannedTaskIds.length);
    }
    updateReadyCard();
    updateSteps();
    renderPlanInherit();
    renderActualDiff();
  }
  function switchTab(key, focus){
    if(key === "content") key = "history";
    if(key === "actual" && !mayPublish) key = "plan";
    activeTab = key;
    if(key === "actual"){
      planJustSaved = false;
      var banner = layer.querySelector("[data-release-next]"); if(banner) banner.remove();
    }
    layer.querySelectorAll("[data-release-step]").forEach(function(b){
      var on = b.getAttribute("data-release-step") === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-current", on ? "step" : "false");
    });
    layer.querySelectorAll("[data-release-panel]").forEach(function(p){ p.hidden = p.getAttribute("data-release-panel") !== key; });
    dlg.scrollTo(0);
    updateSteps();
    if(focus && key === "actual") focusActual();
    if(key === "actual" && !releaseCheck && !checkLoading) loadCheck();
    if(opts.onTab && !syncingFromHash) opts.onTab(key);
  }
  function focusActual(){
    ["[data-release-occurredAt]", "[data-release-executorUserId]", "[data-release-artifactRef]", "[data-release-targetKeys]"].some(function(sel){
      var el = layer.querySelector(sel);
      if(!el || String(el.value || "").trim()) return false;
      /* 执行人值在隐藏 input 里，焦点落到它前面的人员字段按钮 */
      var target = (el.tagName === "INPUT" && el.type === "hidden") ? el.previousElementSibling : el;
      try{ (target || el).focus({preventScroll:true}); }catch(ex){ (target || el).focus(); }
      return true;
    });
  }
  /* 计划保存被校验拦下时把对应字段滚进视野并聚焦，避免顶部保存按钮看起来「没反应」 */
  function focusPlanError(sel){
    var el = layer.querySelector(sel);
    if(!el) return;
    var target = (el.tagName === "INPUT" && el.type === "hidden") ? el.previousElementSibling : el;
    try{ el.scrollIntoView({block:"center", behavior:"smooth"}); }catch(ex){ try{ el.scrollIntoView(); }catch(ex2){ /* noop */ } }
    try{ (target || el).focus({preventScroll:true}); }catch(ex3){ try{ (target || el).focus(); }catch(ex4){ /* noop */ } }
  }
  function readActual(){
    if(!layer.querySelector('[data-release-occurredAt]')) return actualDraft;
    ["planId", "occurredAt", "environment", "targetKeys", "coverage", "artifactRef", "artifactDigest", "operation", "relatedReleaseId", "executorUserId", "deviationReason", "result", "notes", "failureReason"].forEach(function(key){ actualDraft[key] = value("release", key); });
    actualDraft.actualTaskIds = checks("actual"); return actualDraft;
  }
  function context(){
    var a = readActual();
    return {planId:a.planId || null, occurredAt:utc(a.occurredAt), environment:a.environment, targetKeys:lines(a.targetKeys), coverage:a.coverage, artifactRef:a.artifactRef.trim(), artifactDigest:(a.artifactDigest.trim().toLowerCase() || null), operation:a.operation, relatedReleaseId:a.relatedReleaseId || null, executorUserId:a.executorUserId || null, actualTaskIds:a.actualTaskIds.slice(), deviationReason:a.deviationReason.trim() || null, result:a.result, notes:a.notes.trim(), failureReason:a.result === "failed" ? a.failureReason.trim() : null};
  }
  function planBody(){
    var p = selectedPlan(), planned = value("plan", "planned");
    /* 发布计划接口使用 LocalDateTime；保留本地墙钟，不能发送 UTC 后丢掉偏移。 */
    var localPlanned = planned && !isNaN(new Date(planned).getTime()) ? localMinute(planned) : null;
    var plannedAt = p && p.plannedAt && localMinute(p.plannedAt) === localPlanned ? p.plannedAt : localPlanned;
    return {id:p ? p.id : null, revision:p ? p.revision : null, versionIds:planVersionSelection(), plannedAt:plannedAt, ownerUserId:value("plan", "owner") || null, status:value("plan", "status"), notes:value("plan", "notes").trim(), risks:value("plan", "risks").trim(), reason:value("plan", "reason").trim(), plannedTaskIds:checks("plan"), environment:value("plan", "environment"), targetKeys:lines(value("plan", "targets")), coverage:value("plan", "coverage")};
  }
  /* 与后端一致：只有「原计划已就绪」或「改为取消」才必须填理由，新建草稿无需理由 */
  function planReasonRequired(b){
    var p = selectedPlan();
    return !!((p && p.status === "ready") || (b && b.status === "canceled"));
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
    if(b.coverage !== "unknown" && !b.targetKeys.length) missing.push("目标键");
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
  function anomaliesHTML(list, hasReason){
    return '<div class="rel-anomaly" role="status">'
      + '<div class="rel-anomaly-h"><b>本次事实有 ' + list.length + ' 处需要说明</b><span>' + (hasReason ? "原因已填写，可以重新预览。" : "系统只记录事实，不会改写工作项状态。") + '</span></div>'
      + '<ul class="rel-anomaly-list">' + list.map(function(x){
        return '<li><span>' + esc(x.text) + '</span>'
          + (x.code === "notDone" ? '<button type="button" class="rel-need-go" data-anomaly-drop="' + esc(x.taskId) + '">取消勾选</button>' : '')
          + '</li>';
      }).join("") + '</ul>'
      + '<div class="rel-anomaly-acts">'
      + (hasReason
        ? '<button type="button" class="btn sm primary" data-anomaly-recheck>重新预览</button>'
        : '<button type="button" class="btn sm" data-anomaly-reason>填写未按计划发布的原因</button>')
      + '<button type="button" class="btn sm ghost" data-anomaly-plan>去检查发布计划</button>'
      + '</div>'
      + '<p class="hint">说明原因后重新预览即可继续；也可以取消勾选未完成项，让本次范围与计划一致。</p></div>';
  }
  /* 预览结果优先展示；没有预览结果时，展示异常清单或下一步提示，避免只留一句含糊的「已变化」 */
  function renderScopeState(force){
    var host = layer.querySelector('[data-release-scope]');
    if(!host || preview) return;
    var list = actualAnomalies();
    var reasonEl = layer.querySelector('[data-release-deviationReason]');
    var hasReason = !!(reasonEl && String(reasonEl.value || "").trim());
    /* 首次打开只给下一步提示；点过预览（或被拦）后才展开异常清单，避免一进来就像报错 */
    var showAnomalies = list.length && (previewTried || previewStale);
    var mode = showAnomalies ? "anomaly" : (previewStale ? "stale" : "empty");
    var sig = list.map(function(x){ return x.code + ":" + (x.taskId || ""); }).join("|") + (hasReason ? "|reason" : "");
    if(!force && sig === scopeSig && mode === scopeMode) return;
    scopeSig = sig; scopeMode = mode;
    if(mode === "anomaly"){ host.innerHTML = anomaliesHTML(list, hasReason); return; }
    host.innerHTML = '<p class="hint">' + (mode === "stale"
      ? '字段已改动，之前的预览已过期，请重新预览。'
      : '尚未预览：点上方「预览本次范围与预检结果」核对本次交付范围，预览通过后才可记录发布。') + '</p>';
  }
  function invalidatePreview(){
    if(preview) previewStale = true;
    preview = null; previewContext = null; previewSeq++;
    renderScopeState();
    syncControls();
  }
  /* 记录发布被拦的同一份判定：既决定按钮禁用，也在就绪条件卡里直接说明原因 */
  function blockedNoReasonNow(){
    return !!(releaseCheck && releaseCheck.verdict === "block" && actualDraft.result === "success" && !String(actualDraft.deviationReason || "").trim());
  }
  function confirmBlockState(){
    var blockedNoReason = blockedNoReasonNow();
    if(busy) return {code:"busy", text:"正在处理，请稍候"};
    if(!mayPublish) return {code:"permission", text:"当前账号不能记录发布：需要空间主、管理员，或对该项目可写的项目负责人"};
    if(pending) return {code:"pending", text:"有待确认的发布请求，请先处理上方的查询 / 重试提示"};
    if(storageError) return {code:"storage", text:"会话存储异常，无法安全提交发布请求"};
    if(planDirty()) return {code:"planDirty", text:"发布计划还有未保存改动，请先保存或放弃"};
    if(!actualReady()) return {code:"notReady", text:"先补齐上方列出的就绪条件"};
    if(blockedNoReason) return {code:"blockedNoReason", text:"发布检查存在阻断项，需填写「未按计划发布的原因」"};
    if(!preview) return {code:"noPreview", text:"尚未预览：先预览本次范围与预检结果"};
    if(preview.canPublish === false) return {code:"previewBlocked", text:"预览判定本次事实有异常，需填写「未按计划发布的原因」后重新预览"};
    return null;
  }
  function confirmBlockReason(){
    var state = confirmBlockState();
    return state ? state.text : "";
  }
  function syncControls(){
    var confirm = layer.querySelector('[data-release-confirm]');
    /* 阻断项不禁止记录事实，但必须留下未按计划发布的原因；预览已判定不可发布时也不放行确认 */
    var blockedNoReason = blockedNoReasonNow();
    if(confirm){
      confirm.disabled = busy || !mayPublish || !!pending || !!storageError || !preview || preview.canPublish === false || planDirty() || blockedNoReason || !actualReady();
      confirm.title = confirm.disabled ? confirmBlockReason() : "按预览范围记录本次实际发布";
    }
    layer.querySelectorAll('[data-release-save], [data-plan-new], [data-release-preview], [data-release-draft]').forEach(function(b){ b.disabled = busy || !!pending || !!storageError; });
    var retry = layer.querySelector('[data-release-retry]'); if(retry) retry.disabled = busy || !mayPublish || !retryAllowed || !!storageError;
    var reset = layer.querySelector('[data-release-reset]'); if(reset) reset.disabled = busy || !pending || !pending.rejection || !!storageError;
    layer.querySelectorAll('[data-release-refresh], [data-release-reconcile]').forEach(function(b){ b.disabled = busy; });
    updateReadyCard();
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
      box.innerHTML = '<p class="hint">暂无操作记录</p>';
      return;
    }
    box.innerHTML = '<ul class="release-scope">' + verLog.rows.map(function(l){
      return '<li>' + esc(fmtReleaseTime(l.createdAt)) + ' · ' + esc(VERSION_LOG_NAME[l.action] || l.action) +
        ' · ' + esc(l.actorName || "系统") + (l.reason ? ' · 理由：<span class="ver-log-reason">' + esc(l.reason) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function renderHistory(){
    var box = layer.querySelector('[data-release-record-list]'); if(!box) return;
    var rows = records.filter(function(r){ return (!filters.result || (filters.result === "published" ? r.result === "success" && r.environment === "production" && r.operation !== "rollback" : r.result === filters.result)) && (!filters.environment || r.environment === filters.environment) && (!filters.operation || r.operation === filters.operation); });
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / 10) - 1));
    box.innerHTML = rows.slice(page * 10, page * 10 + 10).map(releaseRecordHTML).join('') || '<p class="hint">没有匹配的正式记录</p>';
    var count = layer.querySelector('[data-history-count]'); count.textContent = "第 " + (page + 1) + " 页 · " + rows.length + " 条（最多加载 200 条）";
    layer.querySelector('[data-history-prev]').disabled = busy || page === 0;
    layer.querySelector('[data-history-next]').disabled = busy || (page + 1) * 10 >= rows.length;
  }
  /* 高级区默认收起；一旦选了非默认操作 / 覆盖、关联事件或失败，自动展开避免漏填。 */
  function syncAdvanced(){
    var det = layer.querySelector("[data-release-advanced]"); if(!det) return;
    var a = actualDraft;
    if(a.operation !== "deploy" || a.coverage !== "full" || a.relatedReleaseId || a.result === "failed") advancedOpen = true;
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
    var requiredLine = '发布必测 ' + esc(c.requiredTotal) + ' 条：通过 ' + esc(c.requiredPassed)
      + (c.requiredFailed ? ' · 失败 / 阻塞 ' + esc(c.requiredFailed) : '')
      + (c.requiredUntested ? ' · 未执行 / 跳过 ' + esc(c.requiredUntested) : '');
    /* 理由只在预览区上方保留一个输入框；这里只给定位入口，避免两处同名输入各写一半 */
    var riskReason = c.verdict === "block" && actualDraft.result === "success"
      ? '<div class="release-risk"><b>未按计划发布的原因</b><span>发布检查有阻断项：填写原因后重新预览。</span>'
        + '<button type="button" class="rel-need-go" data-ready-reason>去填写原因</button></div>'
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
  /* ==================== 发布准备与关注 ==================== */
  function prepCountdownText(c){
    if(!c || c.daysLeft == null) return "时间未定";
    if(c.daysLeft === 0) return "今天发布";
    if(c.daysLeft > 0) return c.daysLeft + " 天后发布";
    return "已过 " + (-c.daysLeft) + " 天";
  }
  function prepPct(n, total){ return total > 0 ? Math.round(Number(n || 0) * 100 / total) : 0; }
  function prepBarHTML(d){
    var total = Number(d.totalTasks) || 0;
    var seg = function(n, cls){ return Number(n) > 0 ? '<span class="' + cls + '" style="width:' + prepPct(n, total) + '%"></span>' : ""; };
    return '<div class="prep-bar" aria-hidden="true">' + seg(d.confirmedCount, "seg-ok") + seg(d.riskCount, "seg-risk")
      + seg(d.unconfirmedCount, "seg-pending") + seg(d.unassignedCount, "seg-none") + '</div>';
  }
  function prepStatusTag(d){
    if(d.countdown && d.countdown.overdue) return '<span class="tag tag-danger">已过发布日</span>';
    if(d.plan && d.plan.status === "completed") return '<span class="tag">已完成</span>';
    if(d.plan && d.plan.status === "canceled") return '<span class="tag">已取消</span>';
    if(d.plan && d.plan.status === "draft") return '<span class="tag">未就绪</span>';
    return '<span class="tag tag-warning">进行中</span>';
  }
  function prepChannels(v){
    if(!v) return [];
    if(Array.isArray(v)) return v.slice();
    try{ var a = JSON.parse(v); return Array.isArray(a) ? a : []; }catch(e){ return String(v).indexOf("group") >= 0 ? ["group"] : []; }
  }
  function prepChannelNames(v){
    var map = {in_app:"站内", email:"邮件", wecom:"企业微信（按人）", group:"企业微信群"};
    return prepChannels(v).map(function(c){ return map[c] || c; });
  }
  function prepScopeLabel(scope){
    return scope === "owners" ? "仅负责人" : scope === "custom" ? "指定成员" : "全部项目成员";
  }
  function prepGroupText(p){
    if(prepChannels(p && p.channels).indexOf("group") < 0) return "";
    if(p.groupSent === true) return p.groupError ? "群部分发送（" + p.groupError + "）" : "群已发送";
    if(p.groupSent === false) return "群未发送" + (p.groupError ? "（" + p.groupError + "）" : "");
    return "群结果未记录";
  }
  function prepPushSummary(p){
    if(!p) return "";
    var parts = ["涉及 " + (Number(p.recipientCount) || 0) + " 人"];
    var chs = prepChannels(p.channels);
    if(chs.indexOf("in_app") >= 0) parts.push("站内 " + (Number(p.inAppCount) || 0) + " 人");
    if(chs.indexOf("email") >= 0) parts.push("邮件入队 " + (Number(p.emailCount) || 0) + " 人");
    if(chs.indexOf("wecom") >= 0) parts.push("企微入队 " + (Number(p.wecomCount) || 0) + " 人");
    parts.push("回执 " + (Number(p.ackedCount) || 0) + " 人");
    var g = prepGroupText(p);
    if(g) parts.push(g);
    return parts.join(" · ");
  }
  function prepCardHTML(d){
    var total = Number(d.totalTasks) || 0;
    var plan = d.plan || {};
    var latest = d.latestPush;
    var head = '<div class="prep-card-head"><div><h3>发布准备</h3><p class="hint">负责人确认进度，只做发布前提醒，不改变工作项状态；未完成数仅作参考。</p></div>'
      + '<div class="prep-card-acts">' + prepStatusTag(d)
      + '<button class="btn sm ghost" type="button" data-prep-me>我的准备</button>'
      + (d.canManage && Number(d.unconfirmedCount) > 0
        ? '<button class="btn sm" type="button" data-prep-notify data-only="1">' + icon("bell", 14) + ' 通知未确认 ' + esc(d.unconfirmedOwnerCount != null ? d.unconfirmedOwnerCount : d.unconfirmedCount) + ' 人</button>' : '')
      + '</div></div>';
    if(!total){
      return '<section class="release-section prep-card">' + head
        + '<p class="hint">这个计划里还没有工作项。先在上方「这次计划发布哪些工作项」里勾选，再通知负责人确认。</p></section>';
    }
    var body = '<div class="prep-summary"><div class="prep-big"><div class="n">' + esc(d.confirmedCount) + '<small> / ' + esc(total) + ' 已确认</small></div>'
      + '<div class="l">' + (Number(d.riskCount) ? '另有 ' + esc(d.riskCount) + ' 项有风险' : '暂无风险项') + '</div></div>'
      + '<div>' + prepBarHTML(d) + '<div class="prep-metrics">'
      + '<span class="metric ok"><i></i>已确认 <b>' + esc(d.confirmedCount) + '</b></span>'
      + '<span class="metric risk"><i></i>有风险 <b>' + esc(d.riskCount) + '</b></span>'
      + '<span class="metric pending"><i></i>未确认 <b>' + esc(d.unconfirmedCount) + '</b></span>'
      + '<span class="metric none"><i></i>未指派 <b>' + esc(d.unassignedCount) + '</b></span>'
      + '</div></div></div>'
      + '<div class="prep-meta"><span>关注 <b>' + esc(d.watcherCount || 0) + '</b> 人' + (d.watching ? ' · 你已关注' : '') + '</span>'
      + (latest
        ? '<span>最近推送 <b>' + esc(fmtReleaseTime(latest.createdAt)) + '</b> · ' + esc(prepPushSummary(latest)) + '</span>'
          + '<button class="link" type="button" data-prep-history>推送记录</button>'
        : '<span>还没有推送过提醒</span>')
      + '<span class="spacer"></span><span>倒计时 <b>' + esc(prepCountdownText(d.countdown)) + '</b></span></div>'
      + '<div class="prep-table-wrap"><table class="tbl prep-owner-table"><thead><tr><th>负责人</th><th class="num">工作项</th><th class="num">已确认</th><th class="num">有风险</th><th class="num">未确认</th><th>最近确认</th><th></th></tr></thead><tbody>';
    (d.owners || []).forEach(function(o){
      if(o.userId == null){
        body += '<tr class="is-unassigned"><td><span class="prep-owner"><b>未指派</b><small>需要先指定负责人</small></span></td>'
          + '<td class="num"><b>' + esc(o.total || 0) + '</b></td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>—</td><td></td></tr>';
        return;
      }
      body += '<tr><td><span class="prep-owner"><b>' + esc(o.name || "—") + '</b>'
        + (plan.ownerUserId === o.userId ? '<span class="tag">计划负责人</span>' : '')
        + '<small>' + esc(o.projectNames || "—") + '</small></span></td>'
        + '<td class="num"><b>' + esc(o.total || 0) + '</b>' + (Number(o.unfinished) ? '<small>' + esc(o.unfinished) + ' 未完成</small>' : '') + '</td>'
        + '<td class="num ' + (Number(o.confirmed) ? 'is-ok' : '') + '">' + esc(o.confirmed || 0) + '</td>'
        + '<td class="num ' + (Number(o.risk) ? 'is-risk' : '') + '">' + esc(o.risk || 0) + '</td>'
        + '<td class="num">' + esc(o.pending || 0) + '</td>'
        + '<td><span class="muted">' + esc(o.lastCheckedAt ? fmtReleaseTime(o.lastCheckedAt) : "—") + '</span></td>'
        + '<td class="num">' + (d.canManage && Number(o.pending) > 0
          ? '<button class="link" type="button" data-prep-remind="' + esc(o.userId) + '">提醒</button>' : '') + '</td></tr>';
    });
    body += '</tbody></table></div>'
      + '<div class="prep-notes"><div><b>推送范围</b><span>只覆盖对计划项目可见的成员；同一人负责多项时只收一条汇总。</span></div>'
      + '<div><b>确认何时失效</b><span>计划范围变化或发布时间提前，会要求负责人重新确认；只改备注不重来。</span></div>'
      + '<div><b>关注</b><span>关注后接收改期、范围 / 版本变化、进入就绪与发布日提醒；关注不代表负责。</span></div></div>';
    return '<section class="release-section prep-card">' + head + body + '</section>';
  }
  function renderPrep(){
    var host = layer.querySelector("[data-release-prep-host]");
    if(!host) return;
    var p = selectedPlan();
    if(!p || !p.id){ host.innerHTML = ""; return; }
    if(prepState.planId !== p.id || (prepState.loading && !prepState.data)){
      host.innerHTML = '<section class="release-section prep-card"><p class="hint">加载发布准备…</p></section>';
      return;
    }
    if(prepState.error){
      host.innerHTML = '<section class="release-section prep-card"><div class="prep-card-head"><div><h3>发布准备</h3><p class="release-error" role="alert">准备信息加载失败：' + esc(prepState.error) + '</p></div><button class="btn sm" type="button" data-prep-retry>重试</button></div></section>';
      return;
    }
    host.innerHTML = prepState.data ? prepCardHTML(prepState.data) : "";
    UI.wireTooltips(host);
  }
  function loadPrep(){
    var p = selectedPlan(), pid = p && p.id || "";
    prepState.planId = pid; prepState.error = ""; prepState.data = null;
    if(!pid){ prepState.loading = false; renderPrep(); syncWatch(); return; }
    var seq = ++prepState.seq;
    prepState.loading = true; renderPrep(); syncWatch(true);
    API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep").then(function(rs){
      if(!current() || seq !== prepState.seq || prepState.planId !== pid) return;
      prepState.loading = false; prepState.data = rs || null; renderPrep();
      if(rs){
        watchState.planId = pid; watchState.loaded = true;
        watchState.watching = !!rs.watching; watchState.count = Number(rs.watcherCount) || 0;
        renderWatch();
      }
      if(openPrepOnMount){ openPrepOnMount = false; openMyPrep(); }
    }).catch(function(ex){
      if(!current() || seq !== prepState.seq) return;
      prepState.loading = false; prepState.error = ex.message || "网络异常"; renderPrep();
    });
  }
  function renderWatch(){
    var slot = dlg.watchSlot || layer.querySelector("[data-release-watch-slot]");
    if(!slot) return;
    var p = selectedPlan();
    if(!p || !p.id || busy || pending || storageError){ slot.innerHTML = ""; return; }
    if(watchState.loading && !watchState.loaded){
      slot.innerHTML = '<button class="btn sm ghost" type="button" disabled>关注状态…</button>';
      return;
    }
    var label = watchState.watching ? "已关注" : "关注此计划";
    slot.innerHTML = '<button class="btn sm ghost release-watch-btn" type="button" data-release-watch-toggle'
      + ' aria-pressed="' + watchState.watching + '" title="关注后，计划改期、范围变化和临近发布会通知你">'
      + icon("star", 14) + ' ' + esc(label)
      + (watchState.count ? ' <span class="muted">' + esc(watchState.count) + '</span>' : '') + '</button>';
  }
  function syncWatch(force){
    var p = selectedPlan(), pid = p && p.id || "";
    if(!pid || busy || pending || storageError){ watchState.planId = pid; watchState.loading = false; renderWatch(); return; }
    if(!force && watchState.planId === pid && watchState.loaded){ renderWatch(); return; }
    if(watchState.loading && watchState.planId === pid) return;
    watchState.planId = pid; watchState.loading = true; renderWatch();
    var seq = ++watchState.seq;
    API.get("/api/release-plans/" + encodeURIComponent(pid) + "/watch").then(function(rs){
      if(!current() || seq !== watchState.seq || watchState.planId !== pid) return;
      watchState.loading = false; watchState.loaded = true;
      watchState.watching = !!(rs && rs.watching); watchState.count = Number(rs && rs.count) || 0;
      renderWatch();
    }).catch(function(){ if(current() && seq === watchState.seq){ watchState.loading = false; renderWatch(); } });
  }
  function toggleWatch(){
    var p = selectedPlan();
    if(!p || !p.id) return Promise.resolve();
    var pid = p.id, on = watchState.watching;
    watchState.loading = true; renderWatch();
    var req = on
      ? API.del("/api/release-plans/" + encodeURIComponent(pid) + "/watch")
      : API.post("/api/release-plans/" + encodeURIComponent(pid) + "/watch");
    return req.then(function(rs){
      if(!current()) return;
      watchState.loading = false; watchState.loaded = true;
      watchState.watching = !!(rs && rs.watching); watchState.count = Number(rs && rs.count) || 0;
      if(prepState.data){ prepState.data.watching = watchState.watching; prepState.data.watcherCount = watchState.count; }
      renderWatch(); renderPrep();
      toast(watchState.watching ? "已关注此发布计划，改期与范围变化会提醒你" : "已取消关注此发布计划", "fs");
    }).catch(function(ex){
      if(current()){ watchState.loading = false; renderWatch(); toast(ex.message || (on ? "取消关注失败" : "关注失败"), "bad"); }
    });
  }
  /* 通知成员弹窗：范围 / 只发未确认 / 指定成员 / 渠道 / 预览 */
  function openPrepNotify(opts){
    opts = opts || {};
    var plan = selectedPlan();
    if(!plan || !plan.id) return;
    if(!mayManage){ toast("仅空间主、管理员或项目负责人可发送发布准备提醒", "warn"); return; }
    var pid = plan.id;
    var st = { scope:"all", only:!!opts.only, channels:{in_app:true,email:true,wecom:false,group:false}, q:"", note:"", all:[], owners:[], sel:{}, loading:true, error:"", sending:false, sent:null, emailAvailable:true };
    if(opts.ownerId){ st.scope = "custom"; st.sel[opts.ownerId] = true; }
    if(opts.userIds && opts.userIds.length){
      st.scope = "custom";
      opts.userIds.forEach(function(id){ if(id) st.sel[id] = true; });
    }
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", "通知成员");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    document.body.appendChild(layer);
    UI.openModal(layer);
    function listOf(scope){
      if(scope === "owners") return st.owners;
      return st.all;
    }
    function pendingCount(){
      if(st.scope === "custom"){
        return st.all.filter(function(it){ return st.sel[it.userId] && Number(it.unconfirmedCount) > 0; }).length;
      }
      return listOf(st.scope).filter(function(it){ return Number(it.unconfirmedCount) > 0; }).length;
    }
    function selectedItems(){
      var items = st.scope === "custom"
        ? st.all.filter(function(it){ return st.sel[it.userId]; })
        : listOf(st.scope);
      return st.only ? items.filter(function(it){ return Number(it.unconfirmedCount) > 0; }) : items;
    }
    function sendCount(){ return selectedItems().length; }
    function reachCounts(){
      var items = selectedItems(), inApp = 0, email = 0;
      items.forEach(function(it){
        if(it.inAppEnabled) inApp++;
        /* 空间未启用 SMTP 时，有邮箱也不等于「邮件可达」 */
        if(st.emailAvailable !== false && it.emailEnabled && it.hasEmail) email++;
      });
      return { total: items.length, inApp: inApp, email: email };
    }
    function sentText(sent){
      var chs = sent.channels || [];
      var text = "涉及 " + (Number(sent.recipientCount) || 0) + " 人";
      if(chs.indexOf("in_app") >= 0) text += "；站内 " + (Number(sent.inAppCount) || 0) + " 人";
      if(chs.indexOf("email") >= 0) text += "；邮件入队 " + (Number(sent.emailCount) || 0) + " 人";
      if(chs.indexOf("wecom") >= 0) text += "；企业微信入队 " + (Number(sent.wecomCount) || 0) + " 人";
      if(chs.indexOf("group") >= 0){
        if(sent.groupSent === true) text += sent.groupError ? "；企业微信群部分发送（" + sent.groupError + "）" : "；企业微信群已发送";
        else if(sent.groupSent === false) text += "；企业微信群未发送" + (sent.groupError ? "（" + sent.groupError + "）" : "");
        else text += "；企业微信群结果未记录";
      }
      return text;
    }
    /* 通知标题只用计划编号 + 版本名，与后端 planLabel 同口径（不含时间/状态/环境） */
    function pushTitleLabel(item){
      var names = String((item && item.versionNames) || "").split(/\s*\/\s*|[,，、]/).map(function(s){ return s.trim(); }).filter(Boolean);
      if(!names.length && item && Array.isArray(item.versions)){
        names = item.versions.map(function(v){ return v && v.versionName; }).filter(Boolean);
      }
      return "发布准备 · " + planRef(item) + (names.length ? " · " + names.join("、") : "");
    }
    /* 与后端标题同口径：今天发布 / N 天后 / 已过 N 天 */
    function pushCountdownSuffix(plannedAt){
      var days = countdownDays(plannedAt);
      if(days == null) return "";
      if(days === 0) return " · 今天发布";
      return days > 0 ? " · " + days + " 天后" : " · 已过 " + (-days) + " 天";
    }
    /* 预览取首位收件人的真实准备进度；站内正文是「事实行 + 进度行」两行 */
    function pushSampleProgress(){
      var sample = selectedItems()[0] || (st.owners && st.owners[0]) || null;
      var total = sample ? Number(sample.taskCount) || 0 : 0;
      if(!total) return "你没有负责本计划的工作项，可点开查看计划范围。";
      var pending = Number(sample.unconfirmedCount) || 0;
      return pending
        ? "你负责 " + total + " 项：" + pending + " 待确认。"
        : "你负责的 " + total + " 项已全部确认。";
    }
    function memberRowsHTML(){
      var q = st.q.toLowerCase();
      var rows = st.all.filter(function(it){ return !q || String(it.name || "").toLowerCase().indexOf(q) !== -1; });
      if(!rows.length) return '<p class="hint">没有匹配的成员。</p>';
      return rows.map(function(it){
        var reach = (it.inAppEnabled ? "站内" : "站内未开") + " · "
          + (st.emailAvailable === false ? "邮件未启用"
            : it.emailEnabled && it.hasEmail ? "邮件" : it.hasEmail ? "邮件未开" : "无邮箱");
        return '<label class="prep-member-row"><input type="checkbox" data-prep-pick="' + esc(it.userId) + '"' + (st.sel[it.userId] ? " checked" : "") + '>'
          + '<span class="nm">' + esc(it.name || "—") + (it.isOwner ? ' <span class="tag">负责人</span>' : '') + '</span>'
          + '<span class="mt">' + (Number(it.taskCount) ? '负责 ' + esc(it.taskCount) + ' 项' : '未负责计划内工作项')
          + (Number(it.unconfirmedCount) ? ' · 未确认 ' + esc(it.unconfirmedCount) : ' · 已确认') + '</span>'
          + '<span class="meta">' + reach + '</span></label>';
      }).join("");
    }
    function renderPush(){
      var n = sendCount();
      var body = '<div class="sheet prep-push-sheet"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>通知成员</h2>'
        + '<p class="desc">' + esc(planLabel(plan)) + ' · ' + esc(prepCountdownText({daysLeft: countdownDays(plan.plannedAt)})) + '</p></div>'
        + '<button class="icon-btn sm" type="button" data-prep-push-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
        + '<div class="sheet-body prep-push-body">';
      if(st.loading){
        body += UI.skeletonRows(3);
      }else{
        body += '<div class="field-label">推送范围</div><div class="seg prep-push-scope">'
          + '<button type="button" data-prep-scope="all" aria-pressed="' + (st.scope === "all") + '">全部项目成员 <span class="n">' + esc(st.all.length) + '</span></button>'
          + '<button type="button" data-prep-scope="owners" aria-pressed="' + (st.scope === "owners") + '">仅负责人 <span class="n">' + esc(st.owners.length) + '</span></button>'
          + '<button type="button" data-prep-scope="custom" aria-pressed="' + (st.scope === "custom") + '">指定成员 <span class="n">' + esc(Object.keys(st.sel).length) + '</span></button></div>'
          + '<p class="hint">' + esc(st.scope === "all"
            ? "覆盖 " + st.all.length + " 名对计划项目可见的成员；无项目权限的成员不会收到。同一人负责多项时只收一条汇总。"
            : st.scope === "owners"
              ? "只通知计划内工作项的负责人；未指派工作项没有收件人，会在准备区单独标出。"
              : "手动选择需要知会的人，不要求是工作项负责人；只读成员可以收到并查看，但不能确认。") + '</p>'
          + '<label class="prep-check-line"><input type="checkbox" data-prep-only' + (st.only ? " checked" : "") + '> 只发给尚未确认的人 <b>' + esc(pendingCount()) + '</b> 人 <span class="sub-note">避免重复打扰</span></label>';
        if(st.scope === "custom"){
          body += '<div class="prep-pick"><div class="prep-pick-tools"><input type="search" class="input" data-prep-search placeholder="搜索成员" value="' + esc(st.q) + '" aria-label="搜索成员">'
            + '<button class="btn sm" type="button" data-prep-pick-all>全选可见</button><button class="btn sm" type="button" data-prep-pick-clear>清空</button></div>'
            + '<div class="prep-member-list">' + memberRowsHTML() + '</div></div>';
        }
        body += '<div class="field-label">推送方式</div>'
          + '<label class="prep-check-line"><input type="checkbox" data-prep-ch="in_app"' + (st.channels.in_app ? " checked" : "") + '> 站内通知 <span class="sub-note">默认</span></label>'
          + '<label class="prep-check-line"><input type="checkbox" data-prep-ch="email"' + (st.channels.email ? " checked" : "") + (st.emailAvailable === false ? " disabled" : "") + '> 邮件 <span class="sub-note">' + (st.emailAvailable === false ? "空间未启用 SMTP，暂不可用" : "按个人偏好，仅已开启邮件的人收到") + '</span></label>'
          + '<label class="prep-check-line"><input type="checkbox" data-prep-ch="wecom"' + (st.channels.wecom ? " checked" : "") + '> 企业微信（按人） <span class="sub-note">按个人偏好与绑定企业发送；未绑定本空间启用企业的成员收不到</span></label>'
          + '<label class="prep-check-line"><input type="checkbox" data-prep-ch="group"' + (st.channels.group ? " checked" : "") + '> 企业微信群 <span class="sub-note">按收件人绑定的企业发到对应群，不跨企业</span></label>'
          + '<div class="field-label">发送内容</div>'
          + '<div class="prep-note-field"><input class="input" type="text" data-prep-push-note maxlength="200" value="' + esc(st.note) + '" placeholder="补充说明（选填，200 字以内；站内、邮件、企微与群消息都会带上）" aria-label="补充说明"><span class="prep-note-count" data-prep-push-note-count>' + st.note.length + '/200</span></div>'
          + '<div class="prep-push-preview"><span class="pp-icon">备</span><div>'
          + '<div class="pp-title">' + esc(pushTitleLabel(plan)) + esc(pushCountdownSuffix(plan.plannedAt)) + '</div>'
          + '<div class="pp-body">' + esc(fmtMinute(plan.plannedAt) || "未定时间") + ' ' + esc(releaseEnvironmentName(plan.environment)) + '发布<br>'
          + esc(pushSampleProgress()) + '</div>'
          + '<div class="pp-note"' + (st.note ? "" : " hidden") + ' data-prep-push-note-preview>补充说明：' + esc(st.note) + '</div>'
          + '<div class="pp-act">查看并确认 →</div></div></div>'
          + '<p class="side-note">同一人负责多项时只收一条汇总；同一批次重复点击不会重复发送。计划范围或时间提前会要求重新确认。</p>';
        if(st.error) body += '<p class="release-error" role="alert">' + esc(st.error) + '</p>';
        if(st.sent){
          var sentTxt = sentText(st.sent);
          body += st.sent.duplicate
            ? '<div class="prep-send-result is-dup">' + icon("bell", 15) + '<span>刚刚已推送过，本次未重复发送。' + esc(sentTxt) + '。</span></div>'
            : '<div class="prep-send-result">' + icon("checkCircle", 15) + '<span>' + esc(sentTxt) + '。</span></div>';
        }
      }
      var rc = reachCounts();
      var reach = rc.total
        ? '涉及 <b>' + esc(rc.total) + '</b> 人 · 站内可达 <b>' + esc(rc.inApp) + '</b> 人 · 邮件可达 <b>' + esc(rc.email) + '</b> 人'
          + (st.channels.group ? ' · 企业微信群 1 条' : '')
        : '没有可推送成员';
      body += '</div><div class="sheet-foot prep-push-foot"><span>' + reach + '</span><div class="acts">'
        + '<button class="btn" type="button" data-prep-push-close>' + (st.sent ? "完成" : "取消") + '</button>'
        + (!st.sent ? '<button class="btn primary" type="button" data-prep-send' + (!st.loading && n > 0 && !st.sending ? "" : " disabled") + '>' + (st.sending ? "推送中…" : n > 0 ? "推送提醒" : "暂无可推送成员") + '</button>' : '')
        + '</div></div></div>';
      layer.innerHTML = body;
      var search = layer.querySelector("[data-prep-search]");
      if(search && st.focusSearch){ try{ search.focus(); search.setSelectionRange(st.q.length, st.q.length); }catch(e){ /* noop */ } st.focusSearch = false; }
    }
    function loadRecipients(){
      st.loading = true; renderPush();
      Promise.all([
        API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep/recipients", { scope:"all" }),
        API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep/recipients", { scope:"owners" })
      ]).then(function(rs){
        st.all = (rs[0] && rs[0].items) || []; st.owners = (rs[1] && rs[1].items) || [];
        /* 两个接口返回同一空间的开关状态；以任一明确 false 为准 */
        st.emailAvailable = !(rs[0] && rs[0].emailAvailable === false) && !(rs[1] && rs[1].emailAvailable === false);
        if(!st.emailAvailable) st.channels.email = false;
        st.loading = false; renderPush();
      }).catch(function(ex){
        st.loading = false; st.error = ex.message || "成员列表加载失败"; renderPush();
      });
    }
    function send(){
      if(st.sending || sendCount() <= 0) return;
      var channels = Object.keys(st.channels).filter(function(k){ return st.channels[k]; });
      if(!channels.length){ st.error = "请至少选择一个通知渠道"; renderPush(); return; }
      st.sending = true; st.error = ""; renderPush();
      API.post("/api/release-plans/" + encodeURIComponent(pid) + "/prep/notify", {
        scope: st.scope,
        onlyUnconfirmed: st.only,
        userIds: st.scope === "custom" ? Object.keys(st.sel) : null,
        channels: channels,
        note: st.note || null
      }).then(function(rs){
        st.sending = false; st.sent = rs || {}; renderPush();
        toast(rs && rs.duplicate ? "刚刚已推送过，本次未重复发送" : "发布准备已推送", "fs"); loadPrep();
      }).catch(function(ex){
        st.sending = false; st.error = ex.message || "推送失败，请重试"; renderPush();
      });
    }
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-prep-push-close]")){ UI.closeModal(layer); return; }
      var scopeBtn = e.target.closest("[data-prep-scope]");
      if(scopeBtn){ st.scope = scopeBtn.getAttribute("data-prep-scope"); st.error = ""; st.sent = null; renderPush(); return; }
      if(e.target.closest("[data-prep-pick-all]")){ st.all.forEach(function(it){ st.sel[it.userId] = true; }); renderPush(); return; }
      if(e.target.closest("[data-prep-pick-clear]")){ st.sel = {}; renderPush(); return; }
      if(e.target.closest("[data-prep-send]")){ send(); return; }
    });
    layer.addEventListener("input", function(e){
      if(e.target.matches("[data-prep-search]")){ st.q = e.target.value; st.focusSearch = true; renderPush(); return; }
      if(e.target.matches("[data-prep-push-note]")){
        st.note = e.target.value.slice(0, 200);
        var counter = layer.querySelector("[data-prep-push-note-count]");
        if(counter) counter.textContent = st.note.length + "/200";
        var pv = layer.querySelector("[data-prep-push-note-preview]");
        if(pv){ pv.textContent = "补充说明：" + st.note; pv.hidden = !st.note; }
      }
    });
    layer.addEventListener("change", function(e){
      if(e.target.matches("[data-prep-only]")){ st.only = e.target.checked; renderPush(); return; }
      if(e.target.matches("[data-prep-pick]")){ st.sel[e.target.getAttribute("data-prep-pick")] = e.target.checked; renderPush(); return; }
      if(e.target.matches("[data-prep-ch]")){ st.channels[e.target.getAttribute("data-prep-ch")] = e.target.checked; renderPush(); }
    });
    loadRecipients();
  }
  /* 推送记录：最近批次、渠道结果与未回执名单 */
  function openPushHistory(){
    var plan = selectedPlan();
    if(!plan || !plan.id){ toast("请先选择发布计划", "warn"); return; }
    var pid = plan.id;
    var hist = { loading:true, error:"", items:[], open:{}, detail:{}, loadingDetail:{}, detailError:{} };
    var layer = document.createElement("div");
    layer.className = "modal-layer prep-hist-layer";
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", "推送记录");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    document.body.appendChild(layer);
    UI.openModal(layer);
    function personRows(push, d){
      var chs = prepChannels(push.channels);
      return (d.items || []).map(function(it){
        var sent = [];
        if(chs.indexOf("in_app") >= 0) sent.push(it.inAppAt ? "站内已送" : "站内未送");
        if(chs.indexOf("email") >= 0) sent.push(it.emailAt ? "邮件已入队" : "邮件未入队");
        if(chs.indexOf("wecom") >= 0) sent.push(it.wecomAt ? "企微已入队" : "企微未入队");
        return '<div class="prep-hist-person' + (it.ackedAt ? ' is-acked' : '') + '">'
          + '<span class="nm">' + esc(it.name || it.userId || "—") + '</span>'
          + '<span class="meta">' + (it.ackedAt ? '已回执 ' + esc(fmtReleaseTime(it.ackedAt)) : '未回执')
          + (sent.length ? ' · ' + sent.join(" · ") : '') + '</span></div>';
      }).join("");
    }
    function detailHTML(push){
      var id = push.pushId;
      if(hist.loadingDetail[id]) return '<p class="hint">加载回执明细…</p>';
      if(hist.detailError[id]) return '<p class="release-error" role="alert">回执明细加载失败：' + esc(hist.detailError[id]) + '</p>'
        + '<button class="link" type="button" data-hist-detail-retry="' + esc(id) + '">重试</button>';
      var d = hist.detail[id];
      if(!d) return "";
      var head = '<div class="prep-hist-people-head"><span>已回执 <b>' + esc(d.ackedCount || 0) + '</b> / ' + esc(d.total || 0)
        + ' · 未回执 <b>' + esc(d.unackedCount || 0) + '</b></span>'
        + (mayManage && Number(d.unackedCount) > 0
          ? '<button class="btn sm" type="button" data-hist-remind="' + esc(id) + '">提醒未回执 ' + esc(d.unackedCount) + ' 人</button>' : '')
        + '</div>';
      return head + '<div class="prep-hist-people-list">' + personRows(push, d) + '</div>';
    }
    function cardHTML(p){
      var id = p.pushId, isOpen = !!hist.open[id];
      return '<article class="prep-hist">'
        + '<div class="prep-hist-head"><div><b>' + esc(fmtReleaseTime(p.createdAt)) + '</b>'
        + '<span>' + esc(p.senderName || "—") + ' · ' + esc(prepScopeLabel(p.scope))
        + (p.onlyUnconfirmed ? ' · 只发未确认' : '') + '</span></div>'
        + '<div class="prep-hist-meta">' + esc(prepChannelNames(p.channels).join(" / ")) + '</div></div>'
        + '<div class="prep-hist-sum">' + esc(prepPushSummary(p)) + '</div>'
        + (p.note ? '<p class="prep-hist-note">补充说明：' + esc(p.note) + '</p>' : '')
        + '<div class="prep-hist-acts"><button class="link" type="button" data-hist-toggle="' + esc(id) + '">'
        + (isOpen ? "收起回执" : "查看回执") + '</button></div>'
        + '<div class="prep-hist-people"' + (isOpen ? "" : " hidden") + ' data-hist-people="' + esc(id) + '">'
        + (isOpen ? detailHTML(p) : "") + '</div></article>';
    }
    function render(){
      var body;
      if(hist.loading) body = UI.skeletonRows(4);
      else if(hist.error) body = '<p class="release-error" role="alert">推送记录加载失败：' + esc(hist.error) + '</p>'
        + '<button class="btn sm" type="button" data-hist-retry>重试</button>';
      else if(!hist.items.length) body = '<p class="hint">还没有推送过提醒。</p>';
      else body = hist.items.map(cardHTML).join("");
      layer.innerHTML = '<div class="sheet prep-hist-sheet"><div class="sheet-head">'
        + '<div style="flex:1;min-width:0"><h2>推送记录</h2><p class="desc">' + esc(planLabel(plan)) + ' · 最近 ' + (hist.items.length || 0) + ' 次</p></div>'
        + '<button class="icon-btn sm" type="button" data-hist-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
        + '<div class="sheet-body prep-hist-body">' + body + '</div></div>';
    }
    function openDetail(id, cb){
      hist.open[id] = true;
      if(hist.detail[id]){ render(); if(cb) cb(); return; }
      if(hist.loadingDetail[id]) return;
      hist.loadingDetail[id] = true; hist.detailError[id] = ""; render();
      API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep/pushes/" + encodeURIComponent(id) + "/recipients").then(function(rs){
        hist.loadingDetail[id] = false; hist.detail[id] = rs || { items:[] }; render(); if(cb) cb();
      }).catch(function(ex){
        hist.loadingDetail[id] = false; hist.detailError[id] = ex.message || "网络异常"; render();
      });
    }
    function remind(id){
      var d = hist.detail[id];
      if(!d){ openDetail(id, function(){ remind(id); }); return; }
      var ids = (d.items || []).filter(function(it){ return !it.ackedAt; }).map(function(it){ return it.userId; });
      if(!ids.length){ toast("这批推送已全部回执", "fs"); return; }
      UI.closeModal(layer);
      setTimeout(function(){ openPrepNotify({ userIds: ids }); }, 0);
    }
    function load(){
      hist.loading = true; hist.error = ""; render();
      API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep/pushes", { limit: 20 }).then(function(rs){
        hist.loading = false; hist.items = (rs && rs.items) || []; render();
      }).catch(function(ex){
        hist.loading = false; hist.error = ex.message || "网络异常"; render();
      });
    }
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-hist-close]")){ UI.closeModal(layer); return; }
      if(e.target.closest("[data-hist-retry]")){ load(); return; }
      var detailRetry = e.target.closest("[data-hist-detail-retry]");
      if(detailRetry){
        var rid = detailRetry.getAttribute("data-hist-detail-retry");
        delete hist.detail[rid]; hist.detailError[rid] = ""; openDetail(rid);
        return;
      }
      var toggle = e.target.closest("[data-hist-toggle]");
      if(toggle){
        var id = toggle.getAttribute("data-hist-toggle");
        if(hist.open[id]){ hist.open[id] = false; render(); }
        else openDetail(id);
        return;
      }
      var rb = e.target.closest("[data-hist-remind]");
      if(rb){ remind(rb.getAttribute("data-hist-remind")); return; }
    });
    load();
  }
  function countdownDays(value){
    if(!value) return null;
    var d = new Date(String(value).replace(" ", "T"));
    if(isNaN(d.getTime())) return null;
    var today = new Date(); today.setHours(0,0,0,0);
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }
  /* 我的发布准备：通知深链落地，只显示自己负责的工作项与我的回执 */
  function openMyPrep(){
    var plan = selectedPlan();
    if(!plan || !plan.id){ toast("请先选择发布计划", "warn"); return; }
    var pid = plan.id;
    var st = { loading:true, error:"", saveError:"", data:null, filter:"all", editing:"", note:"", saving:"" };
    var layer = document.createElement("div");
    layer.className = "modal-layer prep-me-layer";
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-label", "我的发布准备");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    document.body.appendChild(layer);
    UI.openModal(layer);
    function items(){ return (st.data && st.data.items) || []; }
    function counts(){
      var list = items(), c = { all:list.length, pending:0, risk:0, ok:0 };
      list.forEach(function(it){ if(it.checkState === "ok") c.ok++; else if(it.checkState === "risk") c.risk++; else c.pending++; });
      return c;
    }
    function rowHTML(it){
      var state = it.checkState === "ok" ? "ok" : it.checkState === "risk" ? "risk" : "pending";
      var cls = "prep-row" + (state === "ok" ? " is-ok" : state === "risk" ? " is-risk" : "");
      var ic = state === "ok" ? "checkCircle" : state === "risk" ? "alert" : "clock";
      var stateTag = it.stale ? '<span class="tag tag-warning">范围已变化</span>'
        : state === "ok" ? '<span class="tag tag-success">已确认</span>'
        : state === "risk" ? '<span class="tag tag-warning">有风险</span>' : '<span class="tag">待确认</span>';
      var note = st.editing === it.id
        ? '<div class="prep-risk-editor"><textarea class="textarea" data-prep-note maxlength="500" placeholder="说明风险、依赖或降级方案">' + esc(st.note || it.checkNote || "") + '</textarea>'
          + '<div class="prep-risk-acts"><button class="btn sm" type="button" data-prep-risk-cancel="' + esc(it.id) + '">取消</button>'
          + '<button class="btn sm primary" type="button" data-prep-risk-save="' + esc(it.id) + '"' + (st.saving ? " disabled" : "") + '>保存风险</button></div></div>'
        : (it.checkNote ? '<div class="pr-note"><b>风险：</b>' + esc(it.checkNote) + '</div>' : '');
      return '<article class="' + cls + '"><span class="pr-ic">' + icon(ic, 16) + '</span><div class="pr-main">'
        + '<div class="pr-title"><span class="prep-pri p' + esc(String(it.priority || "P2").slice(1)) + '">' + esc(it.priority || "P2") + '</span>'
        + '<a class="snap-link" href="' + esc(taskHref(it.id)) + '" data-task-link="' + esc(it.id) + '">' + esc(it.title || it.id) + '</a>'
        + (it.itemType === "bug" ? '<span class="tag tag-danger">缺陷</span>' : '')
        + '<span class="tag">' + esc(colName(it.boardColumn || "todo")) + '</span>' + stateTag + '</div>'
        + '<div class="pr-meta"><span>' + esc(it.projectName || "") + '</span><span>截止 ' + esc(it.dueDate ? fmtReleaseTime(it.dueDate).slice(0, 10) : "—") + '</span>'
        + (it.completedAt ? '<span>完成 ' + esc(fmtReleaseTime(it.completedAt)) + '</span>' : '') + '</div>' + note
        + '</div><div class="pr-act">'
        + '<button class="btn sm ghost" type="button" data-prep-open-task="' + esc(it.id) + '">打开工作项</button>'
        + '<button class="btn sm" type="button" data-prep-risk="' + esc(it.id) + '">' + (state === "risk" ? "更新说明" : "有风险") + '</button>'
        + (state !== "ok" ? '<button class="btn sm primary" type="button" data-prep-confirm="' + esc(it.id) + '"' + (st.saving ? " disabled" : "") + '>确认</button>' : '')
        + (state !== "pending" ? '<button class="btn sm ghost" type="button" data-prep-undo="' + esc(it.id) + '"' + (st.saving ? " disabled" : "") + '>撤销</button>' : '')
        + '</div></article>';
    }
    function renderMe(){
      var planInfo = (st.data && st.data.plan) || plan;
      var c = counts();
      var shown = items().filter(function(it){
        if(st.filter === "all") return true;
        if(st.filter === "pending") return !it.checkState;
        return it.checkState === st.filter;
      });
      var receipt = st.data && st.data.receipt;
      var acked = receipt && receipt.ackedAt;
      var receiptNote = receipt && receipt.note ? '<span class="pn">补充说明：' + esc(receipt.note) + '</span>' : '';
      var total = items().length;
      var hero = total ? '<div class="prep-me-hero"><div class="prep-me-cd"><b>' + esc(prepCountdownText(st.data && st.data.countdown)) + '</b><span>' + esc(fmtReleaseTime(planInfo.plannedAt)) + '</span></div>'
        + '<div class="prep-me-prog"><div class="lbl"><span>我的准备</span><b>' + esc((st.data && st.data.checkedMine) || 0) + ' / ' + esc(total) + ' 已确认</b></div>'
        + '<div class="prep-bar">'
        + (c.ok ? '<span class="seg-ok" style="width:' + prepPct(c.ok, total) + '%"></span>' : '')
        + (c.risk ? '<span class="seg-risk" style="width:' + prepPct(c.risk, total) + '%"></span>' : '')
        + (c.pending ? '<span class="seg-pending" style="width:' + prepPct(c.pending, total) + '%"></span>' : '')
        + '</div><div class="hint">' + esc((st.data && st.data.riskMine) || 0) + ' 项有风险 · ' + esc((st.data && st.data.pendingMine) || 0) + ' 项未确认</div></div>'
        + '<button class="btn sm" type="button" data-prep-watch>' + icon("star", 14) + ' ' + ((st.data && st.data.watching) ? "已关注" : "关注此计划") + '</button></div>' : '';
      var ack = "";
      if(receipt && !acked){
        ack = '<div class="prep-ack"><span class="aic">' + icon("bell", 15) + '</span><div><b>这条推送待回执</b>' + receiptNote + '<span>回执只表示收到本次提醒，不影响已完成的逐项确认。</span></div><button class="btn sm primary" type="button" data-prep-ack>确认已收到</button></div>';
      }else if(acked){
        ack = '<div class="prep-ack is-done"><span class="aic">' + icon("checkCircle", 15) + '</span><div><b>本次推送已回执</b>' + receiptNote + '<span>' + esc(fmtReleaseTime(acked)) + '</span></div></div>';
      }
      var chips = total ? '<div class="prep-me-chips">'
        + '<button class="chip" type="button" aria-pressed="' + (st.filter === "all") + '" data-prep-filter="all">全部 ' + c.all + '</button>'
        + '<button class="chip" type="button" aria-pressed="' + (st.filter === "pending") + '" data-prep-filter="pending">待确认 ' + c.pending + '</button>'
        + '<button class="chip" type="button" aria-pressed="' + (st.filter === "risk") + '" data-prep-filter="risk">有风险 ' + c.risk + '</button>'
        + '<button class="chip" type="button" aria-pressed="' + (st.filter === "ok") + '" data-prep-filter="ok">已确认 ' + c.ok + '</button></div>' : '';
      var list = total
        ? (shown.length ? shown.map(rowHTML).join("") : '<div class="prep-me-empty">当前筛选下没有工作项。</div>')
        : '<div class="prep-me-empty"><b>这个计划里没有需要你确认的工作项</b><span>你不在计划范围的工作项负责人名单里；计划新增范围或把你加为负责人后会出现在这里。</span><button class="btn sm" type="button" data-prep-close>查看计划范围</button></div>';
      var aside = total ? '<aside class="prep-me-aside"><div class="prep-side-card"><h4>本次发布</h4>'
        + '<div class="kv"><span>计划时间</span><b>' + esc(fmtReleaseTime(planInfo.plannedAt)) + '</b></div>'
        + '<div class="kv"><span>环境 / 覆盖</span><b>' + esc(releaseEnvironmentName(planInfo.environment)) + ' · ' + esc(coverageName(planInfo.coverage)) + '</b></div>'
        + '<div class="kv"><span>计划负责人</span><b>' + esc(planInfo.ownerName || "—") + '</b></div>'
        + '<div class="kv"><span>范围</span><b>' + esc((planInfo.projectNames || "—") + (planInfo.versionNames ? " · " + planInfo.versionNames : "")) + '</b></div></div>'
        + '<div class="prep-side-card"><h4>确认口径</h4><p class="hint">确认只表示我已核对该工作项的状态、版本与风险，不改变工作项状态，也不构成发布证据。</p></div></aside>' : '';
      var body = '<div class="sheet prep-me-sheet"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>我的发布准备</h2>'
        + '<p class="desc">' + esc(planLabel(planInfo)) + ' · ' + esc(prepCountdownText(st.data && st.data.countdown)) + '</p></div>'
        + '<button class="icon-btn sm" type="button" data-prep-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
        + '<div class="sheet-body prep-me-body">';
      if(st.loading) body += UI.skeletonRows(4);
      else if(st.error) body += '<p class="release-error" role="alert">准备信息加载失败：' + esc(st.error) + '</p><button class="btn sm" type="button" data-prep-reload>重试</button>';
      else{
        if(st.saveError) body += '<p class="release-error" role="alert">' + esc(st.saveError) + '</p>';
        body += hero + ack + '<div class="prep-me-layout"><section class="prep-me-list"><div class="prep-me-list-head"><h3>我负责的工作项</h3><span class="n">' + esc(total) + '</span>' + chips + '</div>' + list + '</section>' + aside + '</div>';
      }
      body += '</div></div>';
      layer.innerHTML = body;
    }
    function reload(){
      st.loading = true; st.error = ""; st.saveError = ""; renderMe();
      API.get("/api/release-plans/" + encodeURIComponent(pid) + "/prep/me").then(function(rs){
        st.loading = false; st.data = rs || null; renderMe();
        if(rs){ watchState.planId = pid; watchState.loaded = true; watchState.watching = !!rs.watching; watchState.count = Number(rs.watcherCount) || 0; renderWatch(); }
      }).catch(function(ex){ st.loading = false; st.error = ex.message || "网络异常"; renderMe(); });
    }
    function saveCheck(taskId, state, note){
      if(st.saving) return;
      st.saving = taskId; st.saveError = ""; renderMe();
      API.post("/api/release-plans/" + encodeURIComponent(pid) + "/prep/items/" + encodeURIComponent(taskId) + "/check", {
        state: state, note: note || null, expectedScopeToken: st.data ? st.data.scopeToken : null
      }).then(function(rs){
        st.saving = ""; st.editing = ""; st.note = "";
        st.data = rs.me || st.data;
        if(rs.summary){ prepState.data = rs.summary; renderPrep(); }
        renderMe();
      }).catch(function(ex){
        st.saving = "";
        st.saveError = ex.message || "保存失败，请重试";
        renderMe();
        if(ex.code === 409) reload();
      });
    }
    function undo(taskId){
      if(st.saving) return;
      st.saving = taskId; st.saveError = ""; renderMe();
      API.del("/api/release-plans/" + encodeURIComponent(pid) + "/prep/items/" + encodeURIComponent(taskId) + "/check").then(function(rs){
        st.saving = ""; st.data = rs.me || st.data;
        if(rs.summary){ prepState.data = rs.summary; renderPrep(); }
        renderMe();
      }).catch(function(ex){ st.saving = ""; st.saveError = ex.message || "撤销失败"; renderMe(); });
    }
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-prep-close]")){ UI.closeModal(layer); return; }
      if(e.target.closest("[data-prep-reload]")){ reload(); return; }
      var f = e.target.closest("[data-prep-filter]");
      if(f){ st.filter = f.getAttribute("data-prep-filter"); renderMe(); return; }
      var confirm = e.target.closest("[data-prep-confirm]");
      if(confirm){ saveCheck(confirm.getAttribute("data-prep-confirm"), "ok", ""); return; }
      var risk = e.target.closest("[data-prep-risk]");
      if(risk){
        var tid = risk.getAttribute("data-prep-risk");
        var item = items().filter(function(x){ return x.id === tid; })[0] || {};
        st.editing = tid; st.note = item.checkNote || ""; renderMe(); return;
      }
      if(e.target.closest("[data-prep-risk-cancel]")){ st.editing = ""; st.note = ""; renderMe(); return; }
      var riskSave = e.target.closest("[data-prep-risk-save]");
      if(riskSave){ var noteEl = layer.querySelector("[data-prep-note]"); saveCheck(riskSave.getAttribute("data-prep-risk-save"), "risk", noteEl ? noteEl.value : ""); return; }
      var undoBtn = e.target.closest("[data-prep-undo]");
      if(undoBtn){ undo(undoBtn.getAttribute("data-prep-undo")); return; }
      if(e.target.closest("[data-prep-ack]")){
        st.saveError = "";
        API.post("/api/release-plans/" + encodeURIComponent(pid) + "/prep/me/receipt").then(function(rs){
          if(st.data) st.data.receipt = rs.receipt || st.data.receipt;
          renderMe(); toast("已回执本次发布准备", "fs");
        }).catch(function(ex){ st.saveError = ex.message || "回执失败"; renderMe(); });
        return;
      }
      if(e.target.closest("[data-prep-watch]")){
        toggleWatch().then(function(){ if(st.data){ st.data.watching = watchState.watching; st.data.watcherCount = watchState.count; } renderMe(); });
        return;
      }
      var open = e.target.closest("[data-prep-open-task]");
      if(open){ openTaskById(open.getAttribute("data-prep-open-task")); return; }
    });
    reload();
  }
  function render(){
    if(releasePickerRef && UI.popOpen(releasePickerRef.el)){ releasePickerRef.close(); }
    releasePickerRef = null;
    if(pending){
      var old = pending.body;
      Object.keys(actualDraft).forEach(function(k){ actualDraft[k] = k === "actualTaskIds" ? normalizedIds(old[k]) : k === "targetKeys" ? normalizedIds(old[k]).join('\n') : k === "occurredAt" ? localMinute(old[k]) : old[k] || ""; });
    }
    /* 已发布版本不能成为新计划的锚点：已有计划仍可按原范围编辑，新计划请基于后续版本 */
    var releasedAnchor = v.status === "released" && !(selectedPlan() && selectedPlan().id);
    var p = selectedPlan() || {}, a = actualDraft, locked = !mayManage || p.status === "completed" || !!pending || !!storageError || releasedAnchor, disabled = locked ? ' disabled' : '';
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
    /* 只读原因分开说明：版本已结束与「没有发布权限」是两回事，不能都甩给权限；计划已完成 / 待确认请求 / 本机草稿异常各自说明 */
    var versionIsEnded = v.status === "closed" || v.status === "canceled";
    var planLockReasons = [];
    if(!mayManage){
      if(versionIsEnded) planLockReasons.push("版本「" + v.name + "」已" + (v.status === "closed" ? "关闭" : "取消") + "：发布计划与实际发布都只读，历史记录仍可在「历史与内容」查看；要继续交付请新建后续版本。");
      else planLockReasons.push("当前身份不能维护发布计划，也不能记录实际发布：默认仅空间主、管理员与项目负责人（且对该项目可写）可操作；如你对该项目可写，可请管理员在「设置 → 工作流 → 发布权限」放开「项目可写成员」。");
    }
    if(releasedAnchor) planLockReasons.push("版本「" + v.name + "」已发布：已发布的版本不能再加入新计划，因此不能再新建发布计划；历史交付请查看发布记录，已有计划仍可在上方选择后核对。");
    if(p.status === "completed") planLockReasons.push("计划已完成，只读；需要调整请新建独立计划。");
    if(pending) planLockReasons.push("本机有一条待确认的发布请求，处理前计划只读。");
    if(storageError) planLockReasons.push("本机草稿读取异常，暂以只读方式展示计划。");
    var planLockHTML = '<p class="hint">' + esc(planLockReasons.length ? planLockReasons.join(" ") : "此计划只读。") + '</p>';
    var planSection = '<section class="release-section"><div class="rel-section-head"><h3>发布计划</h3><span class="row row-gap">'
      + '<span class="tag ghost">' + esc(releaseStatusName(p.status)) + '</span>'
      + (!locked ? '<button class="btn sm soft" type="button" data-release-save' + (p.id && p.status === "ready" ? ' title="保存计划；修改已就绪计划需要在页面底部的「计划变更理由」里填写原因"' : '') + '>' + (p.id ? '保存此计划' : '新建独立计划') + '</button>' : '')
      + '</span></div><div class="row row-gap"><select data-plan-select aria-label="选择独立发布计划"' + (pending ? ' disabled' : '') + '>' + options([["", "＋ 新建独立计划"]].concat(planChoices), planId || "") + '</select>' + '</div><p class="hint">计划 ' + esc(p.id ? (releasePlanNoText(p.planNo) || ("#" + p.id)) : "未保存") + ' · 修订 ' + esc(p.revision || "—") + ' · ' + esc(releaseEnvironmentName(p.environment || "production")) + ' · ' + esc(coverageName(p.coverage || "full")) + ' · ' + esc(planWhen(p)) + (p.versionCount > 1 ? ' · ' + esc(p.versionCount) + ' 个版本（已完成 ' + esc(p.releasedVersionCount || 0) + '）' : '') + '。计划只描述打算怎么发，不改变实际交付事实；已完成计划不可修改。</p>'
      + '<div data-release-prep-host></div>'
      + heading("基本信息", "计划发布的时间与责任人；环境与覆盖范围用于和实际记录比对偏差。")
      + '<div class="form-grid">' + field("计划发布时间（本地）", '<input type="datetime-local" step="60" data-plan-planned value="' + esc(p.plannedAt ? localMinute(p.plannedAt) : "") + '"' + disabled + '>', "计划发布的时间，使用本地时间；只用于计划与偏差对比，不代表实际发生时间。")
        + field("计划负责人", releaseOwnerControl("plan", p.ownerUserId || "", disabled), "计划的责任人，可与实际执行人不同。")
        + field("计划环境", '<select data-plan-environment' + disabled + '>' + options(envs, p.environment || "production") + '</select>', "计划面向的环境；实际环境不同会在预检中记为偏差，需要填写原因。")
        + field("计划覆盖", '<select data-plan-coverage' + disabled + '>' + options(coverage, p.coverage || "full") + '</select>', "计划覆盖范围：全量、部分或覆盖未知；与实际覆盖一致才不构成偏差。") + '</div>'
      + heading('计划包含的版本（<span data-plan-version-count>' + planVersionSelection().length + '</span> 个 · <span data-plan-version-project-count>' + planSelectionProjects(planVersionSelection()) + '</span> 个项目）', "可跨版本、跨项目选择；当前版本固定包含。计划包含的所有版本都完成生产部署 / 重部署后，计划才自动完成。") + '<div data-plan-version-host>' + planVersionPicker(locked) + '</div>'
      + field("计划目标键（每行一个）", '<textarea data-plan-targets placeholder="如 prod-shanghai-a，每行一个"' + disabled + '>' + esc(normalizedIds(p.targetKeys).join('\n')) + '</textarea>', "计划影响的部署目标或服务键，每行一个；覆盖为全量 / 部分时必填，覆盖未知可留空；与实际目标键一致才不构成偏差。")
      + heading('这次计划发布哪些工作项（<span data-plan-task-count>' + normalizedIds(p.plannedTaskIds).length + '</span> 项' + planCoverageHTML + '）', "勾选这次计划发布的工作项；设为「就绪」时至少 1 项。实际记录会独立选择，不自动继承计划范围。") + taskRows("plan", normalizedIds(p.plannedTaskIds), locked)
      + '<div data-plan-sync-host></div>'
      + '<div data-plan-branches-host></div>'
      + (!locked ? '<p class="release-readiness" data-plan-readiness></p>' : '')
      + heading("说明与状态", "计划说明、风险与回滚方案；计划状态决定能否被实际记录引用。")
      + field("计划说明", '<textarea data-plan-notes maxlength="2000"' + disabled + '>' + esc(p.notes || "") + '</textarea>')
      + field("风险与回滚方案", '<textarea data-plan-risks maxlength="1000"' + disabled + '>' + esc(p.risks || "") + '</textarea>', "建议写清回滚命令、数据兼容处理和回滚后的验证步骤。")
      + field("计划状态", '<select data-plan-status' + disabled + '>' + options([["draft", "草稿"], ["ready", "就绪"], ["canceled", "取消"]].concat(p.status === "completed" ? [["completed", "已完成（只读）"]] : []), p.status || "draft") + '</select>', "只有「就绪」计划可被实际记录直接引用；就绪需要计划时间、负责人和至少 1 个工作项。修改已就绪的计划或取消计划需填写理由。")
      + (!locked ? '<div class="release-save-bar">' + field("计划变更理由", '<textarea class="textarea" rows="2" data-plan-reason maxlength="500" placeholder="修改已就绪计划或取消计划时必填"></textarea>', "修改已就绪计划或取消计划时必填；新建草稿可留空。") + '<p class="release-error" data-plan-error role="alert"></p><div class="release-save-acts"><button class="btn sm primary" data-release-save type="button">' + (p.id ? '保存此计划' : '新建独立计划') + '</button></div></div>' : planLockHTML) + '</section>';
    var actualSection = mayPublish ? '<div class="release-actual"><section class="release-section release-actual-main"><h3>实际发布事实</h3><p class="hint">只填本次真实发生的交付；失败、测试和回滚记录不等于生产生效。</p><div class="form-grid">'
        + field("本次关联计划", '<select data-release-planId' + actualDisabled + '>' + actualPlanOptions(a) + '</select>', "关联计划用于预检对比；无计划即紧急记录。环境或状态不一致的计划仍可选择，但必须填写原因。")
        + field("实际发生时间（本地）", '<input type="datetime-local" step="60" data-release-occurredAt value="' + esc(a.occurredAt) + '"' + actualDisabled + '>', "真实发生时间，不能晚于当前时间；与计划时间不同需填写原因。", true)
        + field("实际环境", '<select data-release-environment' + actualDisabled + '>' + options(envs, a.environment) + '</select>', "真实发布环境；与计划环境不同需填写原因。")
        + field("实际结果", '<select data-release-result' + actualDisabled + '>' + options([["success", "成功"], ["failed", "失败"]], a.result) + '</select>', "记录本次真实结果；失败必须填写失败原因。") + '</div>'
        + '<div data-release-plan-inherit></div>'
        + '<div data-release-diff></div>'
        + '<div data-release-check-host></div>'
        + '<div class="form-grid">' + field("实际执行人（独立于记录人）", releaseOwnerControl("actual", a.executorUserId, actualDisabled), "实际执行发布的人，独立于记录人。", true)
        + field("制品标识", '<input type="text" data-release-artifactRef maxlength="500" placeholder="如 hourglass-server.jar#8b44737" value="' + esc(a.artifactRef) + '"' + actualDisabled + '>', "可识别的制品名或构建号，例如 jar 名#提交号，提交号写在这里；不要用普通版本名代替制品证据。", true)
        + field("SHA256（选填）", '<input type="text" data-release-artifactDigest maxlength="64" placeholder="64 位十六进制，可留空" value="' + esc(a.artifactDigest) + '"' + actualDisabled + '>', "选填。填就填制品文件的完整 64 位十六进制 SHA-256；commit id 是 40 位源码哈希，不能填在这里。") + '</div>'
        + field("实际目标键（每行一个）", '<textarea data-release-targetKeys placeholder="如 prod-shanghai-a，每行一个"' + actualDisabled + '>' + esc(a.targetKeys) + '</textarea>', "本次实际涉及的部署目标或服务键，每行一个；回滚时必须是引用事件目标的子集。", true)
        + heading("本次实际交付哪些工作项（与计划分别保存）", "只勾选本次真实交付的工作项，至少 1 项；未完成项会触发预检，需要填写原因。") + taskRows("actual", a.actualTaskIds, !!actualDisabled)
        + '<details class="release-advanced" data-release-advanced' + (advancedOpen ? ' open' : '') + '><summary>高级与异常字段 <span class="mute" data-release-advanced-summary></span></summary><div class="form-grid">'
        + field("实际覆盖", '<select data-release-coverage' + actualDisabled + '>' + options(coverage, a.coverage) + '</select>', "本次实际覆盖范围；与计划覆盖不同需填写原因。")
        + field("操作", '<select data-release-operation' + actualDisabled + '>' + options([["deploy", "部署"], ["redeploy", "重部署 / 失败重试"], ["rollback", "回滚"]], a.operation) + '</select>', "部署 / 重部署 / 回滚；回滚必须引用成功事件，范围须为子集。")
        + field("关联正式事件", '<select data-release-relatedReleaseId' + actualDisabled + '>' + options([["", "请选择（回滚必填）"]].concat(references.map(function(r){ return [r.id, (releaseNoText(r.releaseNo) || "#" + r.id) + " · " + r.result + " · " + releaseOperationName(r.operation) + " · " + fmtReleaseTime(r.occurredAt)]; })), a.relatedReleaseId) + '</select>', "回滚必填；只能引用同环境的成功正式事件，选项随环境与操作过滤。") + '</div>'
        + field("实际说明", '<textarea data-release-notes maxlength="2000"' + actualDisabled + '>' + esc(a.notes) + '</textarea>')
        + field("失败原因（失败时必填）", '<textarea data-release-failureReason maxlength="1000" placeholder="记录失败时必填，说明失败环节与现象"' + actualDisabled + '>' + esc(a.failureReason) + '</textarea>', "实际结果为失败时必须填写失败环节与现象。", a.result === "failed") + '</details>'
        + field("未按计划发布的原因（偏差或异常时必填）", '<textarea data-release-deviationReason maxlength="1000" placeholder="例如：环境临时切换 / 客户紧急窗口 / 计划内 2 项未完成"' + actualDisabled + '>' + esc(a.deviationReason) + '</textarea>', "无计划、环境 / 覆盖 / 范围 / 时间与计划不一致、包含未完成项或发布检查有阻断项时必填；只记录事实，不改写工作项状态。预览被拦时也会定位到这里。")
        + '<p class="release-error" data-actual-error role="alert"></p><div class="release-preview-row"><button class="btn sm" data-release-preview type="button">预览本次范围与预检结果</button><span class="hint">预览通过后，才能在本页右侧「就绪条件」里记录发布。</span></div><div data-release-scope><p class="hint">尚未预览</p></div></section>' + readinessCardHTML() + '</div>' : '';
    var historySection = '<section class="release-section"><h3>发布历史</h3><div class="row row-gap"><select data-history-result aria-label="历史结果">' + options([["", "全部结果"], ["published", "已发布（生产成功，不含回滚）"], ["success", "全部成功（含测试 / 回滚）"], ["failed", "失败"]], filters.result) + '</select><select data-history-environment aria-label="历史环境">' + options([["", "全部环境"]].concat(envs), filters.environment) + '</select><select data-history-operation aria-label="历史操作">' + options([["", "全部操作"], ["deploy", "部署"], ["publish", "发布"], ["redeploy", "重部署"], ["rollback", "回滚"]], filters.operation) + '</select></div><div data-release-record-list></div><div class="row row-gap"><button class="btn sm" data-history-prev type="button">上一页</button><span class="hint" data-history-count></span><button class="btn sm" data-history-next type="button">下一页</button></div></section>';
    var versionLogSection = '<section class="release-section"><h3>版本操作记录</h3><p class="hint">创建、编辑、开始、关闭 / 取消与范围调整的留痕；与上面的正式发布记录分开，后者只记真实部署事实。</p><div data-version-log><p class="hint">加载中…</p></div></section>';
    var contentSection = '<section class="release-section"><h3>版本内容</h3><p class="hint">目标就绪日：' + esc(v.targetDate || "未设置") + '。版本内容不等于计划范围，更不等于实际发布范围。' + (versionContentLocked(v) ? '已有成功正式发布，内容范围只读；可创建新计划和独立事件。' : '') + '</p><ul class="release-scope">' + contentTasks.map(function(t){ return '<li><a class="snap-link" href="' + esc(taskHref(t.id)) + '" data-task-link="' + esc(t.id) + '" title="打开工作项详情；Ctrl / ⌘ 点击在新标签页打开">' + esc(t.title) + '</a> · ' + esc(colName(t.boardColumn)) + ' ' + taskPublicationHTML(t) + '</li>'; }).join('') + '</ul></section>';
    var banner = planJustSaved ? '<div class="release-next" data-release-next><span>计划已保存' + (planSavedRevision != null ? '（修订 ' + esc(planSavedRevision) + '）' : '') + '。下一步：记录本次实际发布。</span><button class="btn sm primary" type="button" data-release-goto-actual>去记录实际发布</button></div>' : '';
    /* 第 2 步不可用时在顶部直接说明原因，而不是等用户点进来才发现被弹回计划页 */
    var publishNotice = mayPublish ? '' : '<div class="release-notice" role="note">' + esc(versionIsEnded
      ? "版本「" + v.name + "」已" + (v.status === "closed" ? "关闭" : "取消") + "，不能再记录实际发布；历史记录仍可在「历史与内容」查看。"
      : "当前身份不能记录实际发布：需要空间主、管理员，或对该项目可写的项目负责人；权限由管理员在「设置 → 工作流 → 发布权限」配置。") + '</div>';
    dlg.body.innerHTML = '<p class="release-error" data-release-error role="alert"></p>'
      + stepsHTML()
      + banner
      + publishNotice
      + (recoveryMessage || storageError ? '<section class="release-section"><h3>请求恢复</h3><p class="release-text">' + esc(storageError || recoveryMessage) + '</p>' + (recoveredRecord ? releaseRecordHTML(recoveredRecord) : '') + '</section>' : '')
      + (pending ? '<section class="release-section"><h3>原请求待确认</h3><p class="hint">键：' + esc(pending.body.idempotencyKey) + ' · ' + esc(releaseEnvironmentName(pending.body.environment)) + ' · ' + esc(releaseOperationName(pending.body.operation)) + ' · ' + esc(fmtReleaseTime(pending.body.occurredAt)) + ' · 明确选择 ' + esc(pending.body.actualTaskIds.length) + ' 项</p><button class="btn sm" data-release-reconcile type="button">查询原键</button> ' + (mayPublish ? '<button class="btn sm primary" data-release-retry type="button">重试原完整请求 / 原键</button> ' : '') + (pending.rejection ? '<button class="btn sm danger" data-release-reset type="button">明确重置已拒绝请求</button>' : '') + '</section>' : '')
      + '<div class="release-panel" id="release-panel-plan" data-release-panel="plan"' + (activeTab === "plan" ? '' : ' hidden') + '>' + planSection + '</div>'
      + (mayPublish ? '<div class="release-panel" id="release-panel-actual" data-release-panel="actual"' + (activeTab === "actual" ? '' : ' hidden') + '>' + actualSection + '</div>' : '')
      + '<div class="release-panel" id="release-panel-history" data-release-panel="history"' + (activeTab === "history" ? '' : ' hidden') + '>' + historySection + versionLogSection + contentSection + '</div>';
    inheritSig = ""; diffSig = "";
    renderHistory(); renderVersionLog(); renderCheck(); renderPrep(); syncWatch(); syncPlanShareBtn(); syncControls(); syncAdvanced(); updateChecklists(); renderScopeState(true); refreshPlanBranches(); filterPicker("plan"); filterPicker("actual"); error(storageError); UI.wireTooltips(dlg.body);
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
      /* 本机草稿里关联的计划已不可见：按无计划处理，避免拿着失效 id 去预检 */
      if(actualDraft.planId && !plans.some(function(p){ return p.id === actualDraft.planId; })) actualDraft.planId = "";
      /* 首次进入实际记录面：自动带出匹配版本与环境的就绪计划，避免误记成紧急发布 */
      if(!pending && !storageError && !actualPlanTouched && !actualDraft.planId) actualDraft.planId = preferredActualPlanId();
      /* 首次进入自动关联就绪计划时同步带入范围与目标；本机草稿或用户亲手选过计划的场景不动 */
      if(!pending && !storageError && !actualPlanTouched && actualDraft.planId) inheritPlanFields(false);
      /* 刷新 / 重新加载时重新拉版本操作记录，避免展示过期列表 */
      verLog = {id:null, rows:[], error:""}; verLogSeq++;
      /* 工具栏在释放容器外：重画 body 前必须先解禁，否则「刷新 / 返回版本」会一直停在被禁用状态 */
      setBusy(false); render(); loadCheck(); loadPrep();
    }).catch(function(ex){
      if(!current() || seq !== loadSeq) return;
      setBusy(false); retryAllowed = false;
      dlg.body.innerHTML = '<p class="release-error" role="alert">' + esc(ex.message || "加载失败；旧请求仍保留") + '</p><button class="btn" data-release-refresh type="button">重新查询 / 加载</button>';
    });
  }
  /* 逐条列出「本次事实与计划不一致」的项：预览前、预览被拦后都按这张清单展示，
     让用户看到具体是哪几项，而不是只知道有一句「存在异常」。判定口径与 validate 完全同源。 */
  function actualAnomalies(b){
    if(!layer || !layer.querySelector('[data-release-occurredAt]')) return [];
    b = b || context();
    var p = plans.find(function(x){ return x.id === b.planId; }) || null, out = [], diffs = [];
    if(!p){
      out.push({code:"noPlan", text:"本次没有关联发布计划"});
    }else{
      if(p.status !== "ready") diffs.push("计划状态不是「就绪」");
      if(p.environment !== b.environment) diffs.push("发布环境不同");
      if(p.coverage !== b.coverage) diffs.push("覆盖范围不同");
      if(!sameIds(p.targetKeys, b.targetKeys)) diffs.push("目标键不同");
      /* 多版本计划只核对当前版本的任务，与差异表、计划带入同源 */
      if(!sameIds(planActualTaskIds(p), b.actualTaskIds)) diffs.push("勾选的工作项与计划不同");
      /* 时间偏差只在对照表里记录：计划时间通常是目标窗口，逐次强制说明会变成噪声 */
      if(diffs.length) out.push({code:"planDeviation", text:"计划偏差：" + diffs.join("；")});
    }
    b.actualTaskIds.forEach(function(tid){
      var t = tasks.find(function(x){ return x.id === tid; });
      if(!t){ out.push({code:"missingTask", text:"工作项已不存在：" + tid}); return; }
      if(t.boardColumn !== "done"){
        out.push({code:"notDone", taskId:t.id, text:"未完成：『" + t.title + "』当前在「" + colName(t.boardColumn || "todo") + "」"});
        return;
      }
      if(t.completedAt && b.occurredAt && new Date(t.completedAt).getTime() > new Date(b.occurredAt).getTime()){
        out.push({code:"late", taskId:t.id, text:"完成时间晚于发布时刻：『" + t.title + "』完成于 " + fmtReleaseTime(t.completedAt)});
      }
    });
    return out;
  }
  function validate(b){
    if(!b.occurredAt || new Date(b.occurredAt).getTime() > Date.now()) return "请填写不晚于当前时间的实际发生时间";
    if(!b.artifactRef || (b.artifactDigest && !/^[a-f0-9]{64}$/.test(b.artifactDigest))) return "制品标识必填；SHA256 要么留空，要么填完整 64 位十六进制（commit id 不算）";
    if(!b.executorUserId || !members.some(function(m){ return (m.userId || m.id) === b.executorUserId; })) return "请选择当前成员作为独立实际执行人";
    if(!b.actualTaskIds.length || !b.targetKeys.length) return "请明确选择实际工作项和至少一个目标键";
    if(b.result === "failed" && !b.failureReason) return "记录失败必须填写失败原因（展开「高级与异常字段」）";
    if(actualAnomalies(b).length && !b.deviationReason) return "本次事实有异常，需填写「未按计划发布的原因」；也可先处理下方列出的异常项。";
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
    setBusy(true); error("", "actual"); previewTried = true;
    reconcile().then(function(){
      if(!current()) return;
      if(pending || storageError){ setBusy(false); render(); error(recoveryMessage || storageError); return; }
      if(planDirty()){ setBusy(false); error("计划有未保存改动，请保存或放弃后预览", "actual"); return; }
      var b = context(), msg = validate(b);
      if(msg){
        setBusy(false); error(msg, "actual"); previewStale = true; renderScopeState(true);
        if(msg.indexOf("未按计划发布的原因") !== -1) revealDeviationReason(); else focusActual();
        return;
      }
      invalidatePreview(); var seq = ++previewSeq, fingerprint = JSON.stringify(b);
      return API.post(base + "/release-preview", b).then(function(rs){
        if(!current() || seq !== previewSeq) return;
        setBusy(false);
        if(fingerprint !== JSON.stringify(context()) || planDirty()){ invalidatePreview(); return; }
        if(!rs.scopeToken){ error("预览未返回范围令牌，不能确认", "actual"); return; }
        preview = rs; previewContext = fingerprint; previewStale = false; scopeMode = "";
        /* 预览内的检查与确认时重新计算同源；先展示它，避免拿旧计划的结论做判断 */
        if(rs.testCheck){ releaseCheck = rs.testCheck; renderCheck(); syncControls(); }
        if(rs.requiresDeviationReason || rs.canPublish === false){
          error("预览未通过：本次事实存在异常，需填写「未按计划发布的原因」后重新预览。", "actual");
          revealDeviationReason();
        }
        var actualPlan = plans.find(function(p){ return p.id === b.planId; });
        var omittedIds = normalizedIds(rs.plannedTaskIds || (actualPlan || {}).plannedTaskIds).filter(function(tid){ return b.actualTaskIds.indexOf(tid) === -1; });
        function scopeTask(tid){
          var excluded = (rs.excluded || []).find(function(x){ return ((x.task || {}).id || x.taskId) === tid; });
          var t = tasks.find(function(t){ return t.id === tid; }) || (excluded || {}).task || {};
          return '<li><a class="snap-link" href="' + esc(taskHref(tid)) + '" data-task-link="' + esc(tid) + '" title="打开工作项详情；Ctrl / ⌘ 点击在新标签页打开">' + esc(t.title || tid) + '</a> · ' + esc(colName(t.boardColumn || "snapshot")) + ' · 完成 ' + esc(fmtReleaseTime(t.completedAt)) + '</li>';
        }
        layer.querySelector('[data-release-scope]').innerHTML = '<h4>本次明确选择 ' + b.actualTaskIds.length + ' 项 · 计划未选入 ' + omittedIds.length + ' 项</h4><p class="hint">预检不改写实际选择；事实异常需理由。环境 ' + esc(releaseEnvironmentName(b.environment)) + ' · 目标 ' + esc(b.targetKeys.join('、')) + ' · ' + esc(fmtReleaseTime(b.occurredAt)) + '</p>'
          + '<h4>明确实际范围（selected）</h4><ul class="release-scope">' + b.actualTaskIds.map(scopeTask).join('') + '</ul>'
          + '<h4>计划未选入本次事实（omitted）</h4>' + (omittedIds.length ? '<ul class="release-scope">' + omittedIds.map(scopeTask).join('') + '</ul>' : '<p class="hint">无计划遗漏项</p>')
          + '<h4>预检提示（不改变工作状态）</h4>' + (rs.warnings || []).map(function(w){ return '<p class="hint">' + esc(typeof w === "string" ? w : JSON.stringify(w)) + '</p>'; }).join('')
          + '<ul class="release-scope">' + (rs.excluded || []).filter(function(x){ return omittedIds.indexOf((x.task || {}).id || x.taskId) === -1; }).map(function(x){ return '<li>预检异常：' + esc((x.task || {}).title || x.title || x.taskId || "—") + ' · ' + esc(x.reason || x.disposition || "—") + '</li>'; }).join('') + '</ul>';
        syncControls();
        /* 窄屏右栏会堆到表单下方：预览可用时把「就绪条件」带进视野，找不到记录按钮的问题就没有了 */
        if(rs.canPublish !== false && !rs.requiresDeviationReason
          && window.matchMedia && window.matchMedia("(max-width:1099px)").matches){
          var readyCard = layer.querySelector(".rel-ready");
          if(readyCard) readyCard.scrollIntoView({block:"start", behavior:"smooth"});
        }
      });
    }).catch(function(ex){ if(current()){ setBusy(false); invalidatePreview(); previewStale = true; renderScopeState(true); error(ex.message || "查询 / 预览失败，待确认请求仍保留", "actual"); } });
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
      clearActualDraft();
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
    var pick = layer.querySelector('[data-actual-picker]');
    if(pick) pick.outerHTML = taskRows("actual", a.actualTaskIds, false);
  }
  function changed(e){
    if(busy || !current()) return;
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
      confirmDiscardPlan(function(){ readActual(); planId = nextPlan; planJustSaved = false; planScopeVersionIds = null; planVersionQuery = ""; planVersionShowReleased = false; planTaskFetchKey = ""; planTaskErrorKey = ""; prepState.planId = ""; prepState.data = null; watchState.planId = ""; watchState.loaded = false; invalidatePreview(); render(); loadPrep(); }, function(){ sel.value = planId || ""; });
      return;
    }
    if(e.target.matches('[data-plan-version]')){
      /* 只合并本次渲染出来的复选框状态；被搜索过滤掉或置灰（无该项目写权限）的已选版本必须原样保留，
         否则一次勾选就会把它们静默从计划里删掉。 */
      var prevSelected = planVersionSelection(), checkedNow = {};
      layer.querySelectorAll('[data-plan-version]').forEach(function(el){ checkedNow[el.getAttribute('data-plan-version')] = el.checked; });
      var nextSelected = prevSelected.filter(function(vid){ return checkedNow[vid] !== false; });
      layer.querySelectorAll('[data-plan-version]:checked').forEach(function(el){
        var vid = el.getAttribute('data-plan-version');
        if(nextSelected.indexOf(vid) === -1) nextSelected.push(vid);
      });
      planScopeVersionIds = normalizedIds(nextSelected.concat(id));
      layer.querySelectorAll('.release-version-row').forEach(function(row){
        var cb = row.querySelector('[data-plan-version]');
        if(cb) row.classList.toggle('is-selected', cb.checked);
      });
      syncPlanVersionMeta();
      dropSavedBanner(); error("", "plan"); invalidatePreview();
      rerenderPlanPicker(false); ensurePlanTaskPool(); refreshPlanBranches(); updateChecklists();
      return;
    }
    if(e.target.matches('input,select,textarea')){
      var scope = e.target.closest('[data-release-panel="plan"]') ? "plan" : e.target.closest('[data-release-panel="actual"]') ? "actual" : "";
      if(scope){ error("", scope); if(scope === "plan"){ dropSavedBanner(); dismissPlanDraftBanner(); schedulePlanDraft(); } }
      /* 用户亲手改过的实际字段不再被「计划带入」覆盖 */
      var touchedKey = actualTouchedKey(e.target);
      if(touchedKey) actualTouched[touchedKey] = true;
      /* 用户亲自选过计划（含“无计划”）后，环境变化或重绘都不再自动改选 */
      var planPicked = e.target.matches('[data-release-planId]');
      var prevPlan = planPicked ? plans.find(function(item){ return item.id === actualDraft.planId; }) : null;
      if(planPicked) actualPlanTouched = true;
      readActual();
      if(planPicked){
        var filled = inheritPlanFields(false, prevPlan);
        if(filled.length){ syncActualFieldInputs(); toast("已按计划带入：" + filled.join("、"), "fs"); }
      }
      invalidatePreview(); syncAdvanced();
      if(e.target.matches('[data-actual-task]')) filterPicker("actual");
      if(e.target.matches('[data-plan-task]')){ filterPicker("plan"); refreshPlanBranches(); }
      updateChecklists();
      /* 计划面边填边校验「就绪」必填项；非就绪状态不清空其它提示 */
      if(scope === "plan") validatePlanReady();
      if(e.target.matches('[data-release-operation], [data-release-environment], [data-release-coverage], [data-release-relatedReleaseId], [data-release-planId]')){
        if(e.target.matches('[data-release-operation], [data-release-environment]')) actualDraft.relatedReleaseId = "";
        refreshActualReferences();
        if(planPicked) loadCheck();
      }
    }
  }
  layer.addEventListener("input", changed); layer.addEventListener("change", changed);
  /* 失焦即时校验（P-FB-2）：需填理由时离开输入框即提示，不必等点保存才发现；
     其余计划字段失焦时顺带复检「就绪」必填项。只读 / 待确认 / 存储异常时不校验。 */
  layer.addEventListener("focusout", function(e){
    if(busy || !current() || planDraftLocked()) return;
    var t = e.target;
    if(!t || !t.matches || !t.closest || !t.closest('[data-release-panel="plan"]')) return;
    if(t.matches('[data-plan-reason]')){
      if(planReasonRequired(planBody()) && !t.value.trim()) error("修改已就绪计划或取消计划必须填写理由", "plan");
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
    var tab = e.target.closest('[data-release-step]');
    if(!tab || busy || !current()) return;
    var keys = Array.from(layer.querySelectorAll('[data-release-step]:not([disabled])')).map(function(b){ return b.getAttribute("data-release-step"); });
    var i = keys.indexOf(tab.getAttribute("data-release-step")), next = -1;
    if(e.key === "ArrowRight") next = (i + 1) % keys.length;
    else if(e.key === "ArrowLeft") next = (i - 1 + keys.length) % keys.length;
    else if(e.key === "Home") next = 0;
    else if(e.key === "End") next = keys.length - 1;
    if(next < 0 || !keys[next]) return;
    e.preventDefault();
    switchTab(keys[next], false);
    var to = layer.querySelector('[data-release-step="' + keys[next] + '"]');
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
    /* 已发布版本默认收起：按钮是 click 语义，和 input/change 的 changed 分开处理 */
    if(e.target.closest('[data-plan-version-toggle-released]')){
      planVersionShowReleased = !planVersionShowReleased;
      rerenderPlanVersionPicker();
      var releasedToggle = layer.querySelector('[data-plan-version-toggle-released]');
      if(releasedToggle){ try{ releasedToggle.focus({preventScroll:true}); }catch(ex){ /* noop */ } }
      return;
    }
    if(busy || !current()) return;
    var applyPlan = e.target.closest('[data-release-apply-plan]');
    if(applyPlan){
      readActual();
      var filled = inheritPlanFields(true);
      syncActualFieldInputs();
      refreshActualReferences();
      invalidatePreview(); syncAdvanced(); updateChecklists(); filterPicker("actual");
      toast(filled.length ? "已按计划重填：" + filled.join("、") : "当前已与计划一致", "fs");
      return;
    }
    var diffApply = e.target.closest('[data-diff-apply]');
    if(diffApply){
      readActual();
      var planRow = plans.find(function(item){ return item.id === actualDraft.planId; });
      if(planRow){
        var diffKey = diffApply.getAttribute("data-diff-apply");
        if(diffKey === "occurredAt"){
          var when = localMinute(planRow.plannedAt);
          if(when && new Date(when).getTime() <= Date.now()){ actualDraft.occurredAt = when; actualTouched.occurredAt = true; }
          else toast("计划时间在未来，不能当作实际发生时间", "warn");
        }else if(diffKey === "environment"){ actualDraft.environment = planRow.environment || "production"; actualDraft.relatedReleaseId = ""; actualTouched.environment = true; }
        else if(diffKey === "coverage"){ actualDraft.coverage = planRow.coverage || "full"; actualTouched.coverage = true; }
        else if(diffKey === "targetKeys"){ actualDraft.targetKeys = normalizedIds(planRow.targetKeys).join("\n"); actualTouched.targetKeys = true; }
        else if(diffKey === "actualTaskIds"){ actualDraft.actualTaskIds = planActualTaskIds(planRow); actualTouched.actualTaskIds = true; }
        syncActualFieldInputs();
        refreshActualReferences();
        invalidatePreview(); syncAdvanced(); updateChecklists(); filterPicker("actual");
      }
      return;
    }
    if(e.target.closest('[data-diff-plan]')){ switchTab("plan"); return; }
    if(e.target.closest('[data-diff-reason]')){ revealDeviationReason(); return; }
    if(e.target.closest('[data-diff-drop]')){
      readActual();
      var dropped = actualDraft.actualTaskIds.filter(function(tid){ var t = tasks.find(function(x){ return x.id === tid; }); return !t || t.boardColumn !== "done"; });
      if(!dropped.length){ toast("当前勾选的工作项都已完成", "warn"); return; }
      actualDraft.actualTaskIds = actualDraft.actualTaskIds.filter(function(tid){ return dropped.indexOf(tid) === -1; });
      actualTouched.actualTaskIds = true;
      syncActualFieldInputs();
      refreshActualReferences();
      invalidatePreview(); syncAdvanced(); updateChecklists(); filterPicker("actual");
      toast("已取消勾选 " + dropped.length + " 个未完成工作项", "fs");
      return;
    }
    if(e.target.closest('[data-release-watch-toggle]')){ toggleWatch(); return; }
    if(e.target.closest('[data-prep-retry]')){ loadPrep(); return; }
    if(e.target.closest('[data-prep-me]')){ openMyPrep(); return; }
    if(e.target.closest('[data-prep-history]')){ openPushHistory(); return; }
    var prepNotify = e.target.closest('[data-prep-notify]');
    if(prepNotify){ openPrepNotify({only:prepNotify.hasAttribute("data-only")}); return; }
    var prepRemind = e.target.closest('[data-prep-remind]');
    if(prepRemind){ openPrepNotify({ownerId:prepRemind.getAttribute("data-prep-remind")}); return; }
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
    var go = e.target.closest('[data-ready-go]');
    if(go){
      var need = actualNeedItems().find(function(x){ return x.key === go.getAttribute("data-ready-go"); });
      var target = need && layer.querySelector(need.sel);
      if(!target) return;
      /* 执行人 / 计划等隐藏 input 的焦点落到前面的可点控件上 */
      var focusEl = (target.tagName === "INPUT" && target.type === "hidden") ? target.previousElementSibling : target;
      try{ (focusEl || target).focus({preventScroll:true}); }catch(ex){ try{ (focusEl || target).focus(); }catch(ex2){ /* noop */ } }
      if(focusEl && focusEl.scrollIntoView) focusEl.scrollIntoView({block:"center", behavior:"smooth"});
      return;
    }
    var tab = e.target.closest('[data-release-step]');
    if(tab){ switchTab(tab.getAttribute("data-release-step"), false); return; }
    if(e.target.closest('[data-release-draft]')){ saveActualDraft(); return; }
    if(e.target.closest('[data-release-history-entry]')){ switchTab("history", false); return; }
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
    if(e.target.closest('[data-plan-new]')){ if(mayManage) confirmDiscardPlan(function(){ readActual(); planId = ""; planJustSaved = false; planScopeVersionIds = null; planVersionQuery = ""; planVersionShowReleased = false; planTaskFetchKey = ""; planTaskErrorKey = ""; prepState.planId = ""; prepState.data = null; watchState.planId = ""; watchState.loaded = false; invalidatePreview(); render(); }); return; }
    if(e.target.closest('[data-release-preview]')){ runPreview(); return; }
    /* 异常清单内的就地处理：取消勾选 / 聚焦原因输入 / 回计划面核对 */
    var anomalyDrop = e.target.closest('[data-anomaly-drop]');
    if(anomalyDrop){
      var dropId = anomalyDrop.getAttribute('data-anomaly-drop');
      var dropCb = layer.querySelector('[data-actual-task="' + dropId + '"]');
      if(dropCb){ dropCb.checked = false; afterPick("actual"); }
      return;
    }
    if(e.target.closest('[data-anomaly-reason]')){ revealDeviationReason(); return; }
    if(e.target.closest('[data-ready-reason]')){ revealDeviationReason(); return; }
    if(e.target.closest('[data-anomaly-recheck]')){ runPreview(); return; }
    if(e.target.closest('[data-anomaly-plan]')){ switchTab("plan", true); return; }
    if(e.target.closest('[data-release-goto-plan]')){ switchTab("plan", true); return; }
    if(e.target.closest('[data-release-save]')){
      var p = selectedPlan(); if(!mayManage || (p && p.status === "completed")) return;
      var missingVersions = unmanageablePlanVersions();
      if(missingVersions.length){
        var versionText = function(ver){ return (ver.versionName || ver.versionId) + (ver.projectName ? "（" + ver.projectName + "）" : ""); };
        var endedSelected = missingVersions.filter(function(ver){ return ver.ended; });
        var noPermission = missingVersions.filter(function(ver){ return !ver.ended; });
        var tips = [];
        if(endedSelected.length) tips.push("先取消勾选移出已关闭 / 已取消的版本：" + endedSelected.map(versionText).join("、") + "。");
        if(noPermission.length) tips.push("版本 " + noPermission.map(versionText).join("、") + " 所属项目你没有写权限，请联系对应项目负责人调整该计划，或新建一个只含你可管理版本的计划。");
        error("计划还不能保存。" + tips.join(""), "plan");
        focusPlanError('[data-plan-version-search]');
        return;
      }
      var b = planBody();
      if(planReasonRequired(b) && !b.reason){ error("修改已就绪计划或取消计划必须填写理由", "plan"); focusPlanError('[data-plan-reason]'); return; }
      /* 与后端 dimensions() 一致：覆盖未知才允许没有目标键 */
      if(b.coverage !== "unknown" && !b.targetKeys.length){ error("覆盖为全量或部分时必须填写至少 1 个目标键，或把覆盖改为未知", "plan"); focusPlanError('[data-plan-targets]'); return; }
      if(b.status === "ready" && (!b.plannedAt || !b.ownerUserId || !b.plannedTaskIds.length)){
        error("就绪计划需要计划时间、负责人和至少 1 个工作项", "plan");
        focusPlanError(!b.plannedAt ? '[data-plan-planned]' : !b.ownerUserId ? '[data-plan-owner-btn]' : '[data-plan-search]');
        return;
      }
      readActual(); setBusy(true); invalidatePreview();
      (p ? API.put(base + "/release-plan", b) : API.post(base + "/release-plans", b)).then(function(saved){ if(current()){ clearPlanDraft(); dismissPlanDraftBanner(); planId = saved.id; planJustSaved = true; planSavedRevision = saved.revision == null ? null : saved.revision; restoreScroll = dlg.scrollTop(); setBusy(false); toast("独立发布计划已保存", "fs"); load(); } }).catch(function(ex){ if(current()){ setBusy(false); error(ex.message || "计划保存失败", "plan"); } }); return;
    }
    var confirm = e.target.closest('[data-release-confirm]');
    if(!confirm || confirm.disabled || !preview || !mayPublish) return;
    var b = context(), msg = validate(b);
    if(msg){
      error(msg, "actual");
      if(msg.indexOf("未按计划发布的原因") !== -1) revealDeviationReason();
      return;
    }
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
      + '<span class="version-task-main"><span class="version-task-title"><a class="task-picker-link" href="' + esc(taskHref(t.id)) + '" data-task-link="' + esc(t.id) + '" title="打开工作项详情；Ctrl / ⌘ 点击在新标签页打开"><b>' + esc(t.title) + '</b></a>' + taskPublicationHTML(t) + '</span>'
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
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><span class="version-task-title"><a class="task-picker-link" href="' + esc(taskHref(t.id)) + '" data-task-link="' + esc(t.id) + '" title="打开工作项详情；Ctrl / ⌘ 点击在新标签页打开"><b>' + esc(t.title) + '</b></a>' + taskPublicationHTML(t) + '</span>'
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
  var val = phaseReq.value || "";
  /* 全部项目 / 项目集：范围是合成视图，落到跨项目版本清单再筛 */
  if(val === "__all"){
    listUi.scopeType = "all";
    listUi.scopeId = "";
    applyPhaseMode("allversions");
    return;
  }
  if(val.indexOf("__set:") === 0){
    listUi.scopeType = "set";
    listUi.scopeId = val.slice(6);
    applyPhaseMode("allversions");
    return;
  }
  rt.phaseReqId = val || null;
  /* 列表里改项目：范围收窄到该项目，工具条上的范围标签同步 */
  if(viewMode === "list" || viewMode === "allversions"){
    viewMode = "list";
    listUi.scopeType = "proj";
    listUi.scopeId = rt.phaseReqId || "";
    allVersionsSel = [];
    syncPhaseModeHash(viewMode);
    syncModeSeg();
    renderVersionList();
    return;
  }
  /* 跨项目视图里改项目：回到单项目按版本，范围条同步收起 */
  if(viewMode === "overview"){
    viewMode = "version";
    syncPhaseModeHash(viewMode);
    syncModeSeg();
  }
  loadPhaseData();
});
if($("phaseModeSeg")) $("phaseModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-pmode]");
  if(!b) return;
  applyPhaseMode(b.dataset.pmode);
});
if($("phaseScopeBtn")) $("phaseScopeBtn").addEventListener("click", function(e){
  e.stopPropagation();
  var menu = $("phaseScopeMenu");
  if(!menu) return;
  menu.hidden = !menu.hidden;
  $("phaseScopeBtn").setAttribute("aria-expanded", menu.hidden ? "false" : "true");
});
if($("phaseScopeMenu")) $("phaseScopeMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-pmode]");
  if(b){
    /* 「全部项目」是范围基线：清掉残留的项目集筛选 */
    if(b.dataset.pmode === "allversions"){ listUi.scopeType = "all"; listUi.scopeId = ""; }
    applyPhaseMode(b.dataset.pmode);
    return;
  }
  var setB = e.target.closest("[data-scope-set]");
  if(setB){
    listUi.scopeType = "set";
    listUi.scopeId = setB.getAttribute("data-scope-set") || "";
    applyPhaseMode("allversions");
    return;
  }
  if(e.target.closest("[data-open-plans]")){ openPlanListJump(); return; }
  if(e.target.closest("[data-scope-back]")) applyPhaseMode("list");
});
if($("phaseScopeBack")) $("phaseScopeBack").addEventListener("click", function(){ applyPhaseMode("list"); });
document.addEventListener("click", function(e){
  var menu = $("phaseScopeMenu");
  if(!menu || menu.hidden) return;
  if(e.target.closest("#phaseScopeWrap")) return;
  menu.hidden = true;
  if($("phaseScopeBtn")) $("phaseScopeBtn").setAttribute("aria-expanded", "false");
});
document.addEventListener("click", function(e){
  var menu = document.getElementById("vlistScopeMenu");
  if(!menu || menu.hidden) return;
  if(e.target.closest("#vlistScopeWrap")) return;
  menu.hidden = true;
  var btn = document.getElementById("vlistScopeBtn");
  if(btn) btn.setAttribute("aria-expanded", "false");
});
if($("btnVerNew")) $("btnVerNew").addEventListener("click", function(){
  if(!rt.phaseReqId){ toast("先选择项目，再新建版本", "warn"); return; }
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  openVersionDialog(null);
});
/* 发布计划与记录：一个入口两种去向。计划进工作台，记录直接落到只读的发布记录页签 */
if($("btnReleasePlan")) $("btnReleasePlan").addEventListener("click", function(e){
  e.stopPropagation();
  var menu = $("releaseEntryMenu");
  if(!menu) return;
  var willOpen = menu.hidden;
  if(willOpen && !rt.phaseReqId){ toast("先选择项目，再查看发布计划与记录", "warn"); return; }
  menu.hidden = !willOpen;
  $("btnReleasePlan").setAttribute("aria-expanded", willOpen ? "true" : "false");
});
if($("releaseEntryMenu")) $("releaseEntryMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-rel-entry]");
  if(!b) return;
  $("releaseEntryMenu").hidden = true;
  $("btnReleasePlan").setAttribute("aria-expanded", "false");
  openProjectReleasePlan(b.getAttribute("data-rel-entry"));
});
document.addEventListener("click", function(e){
  var menu = $("releaseEntryMenu");
  if(!menu || menu.hidden) return;
  if(e.target.closest("#releaseEntryWrap")) return;
  menu.hidden = true;
  if($("btnReleasePlan")) $("btnReleasePlan").setAttribute("aria-expanded", "false");
});
if($("dlgVersionX")) $("dlgVersionX").addEventListener("click", function(){ UI.closeModal($("dlgVersion")); });
if(btnSaveVer) btnSaveVer.addEventListener("click", saveVersion);
if(vName) vName.addEventListener("input", function(){ fVerName.classList.remove("invalid"); });
if(phaseBody) phaseBody.addEventListener("click", function(e){
  /* 阶段构成色块 / 图例 / 跨版本阶段单元格：都长在可点击的版本行里，先于行级跳转处理 */
  var stageHit = e.target.closest("[data-stage-drill]");
  if(stageHit){ openPhaseStageDrill(stageHit); return; }
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
  if(e.target.closest("[data-ver-plans-link]")){ openPlanListJump(); return; }
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
  var ovr = e.target.closest("[data-ov-project]");
  if(ovr){
    rt.phaseReqId = ovr.dataset.ovProject;
    viewMode = "version";
    syncPhaseModeHash(viewMode);
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
  var stageRow = e.target.closest ? e.target.closest("tr[data-stage-drill]") : null;
  if(stageRow && stageRow === e.target){ e.preventDefault(); openPhaseStageDrill(stageRow); return; }
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
  /* 路由懒加载的 enterPhaseView 可能晚于本调用执行：先把模式写进 hash，
     让它读到的是刚选中的模式而不是默认列表，否则列表会盖回落成的分析页 */
  syncPhaseModeHash(viewMode);
  if(document.body.dataset.view === "phase"){
    syncModeSeg();
    syncReqSel();
    if(viewMode === "overview") loadOverview();
    else if(viewMode === "allversions"){ listUi.scopeType = "all"; listUi.scopeId = ""; loadVersionList(); }
    else loadPhaseData();
  }
}
export { enterPhaseView, ensureEpicOptions, ensureFoundVersionOptions, ensureVersionOptions, exportReleaseRecordCSV, invalidateTaskOptionsCache, loadPhaseData, openVersionTool, reloadView, renderPhaseView, setPhaseProject, showReleaseNote };
