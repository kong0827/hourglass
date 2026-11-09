/* views/phase · 版本：按阶段（首版/迭代）与按版本（三态版本卡）双口径 */

import { API } from "../core/api.js";
import { $, searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { showView } from "../core/router.js";
import { canEditReq, reqNameById, rt, state } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { COLUMNS, colName, fmtMinutesShort } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { branchNameById } from "./branches.js";
import { openDemandDetailById } from "./demands.js";

var phaseReq = $("phaseReq"), phaseMeta = $("phaseMeta"), phaseBody = $("phaseBody"),
    vName = $("vName"), vStart = $("vStart"), vTarget = $("vTarget"), vDesc = $("vDesc"),
    fVerName = $("fVerName"), btnSaveVer = $("btnSaveVer"), verFormTitle = $("verFormTitle");

var editingVerId = null;
var viewMode = "phase";            /* phase | version | overview */
var cache = null;                  /* { phase, vstats, versions, tasks } */
var overviewCache = null;
var loadSeq = 0;
/* 任务抽屉的「影响版本」选项缓存：按项目缓存，写版本后失效 */
var versionOptionsCache = {};
var taskOptionsCache = {};

function isOwner(){ return !!(rt.currentWs && rt.currentWs.myRole === "owner"); }
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
    var tip = "分支状态：" + st.name + " · 该版本 " + (b.taskCount || 0) + " 个工作项挂在此分支";
    return '<span class="ver-br" title="' + esc(tip) + '">' +
      '<i class="br-dot ' + st.cls + '"></i>' + esc(b.name) +
      ((b.taskCount || 0) > 1 ? '<span class="ver-br-n">×' + b.taskCount + '</span>' : '') +
    '</span>';
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
function invalidateVersionCache(reqId){
  delete versionOptionsCache[reqId];
  delete taskOptionsCache[reqId];
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
  Promise.all([
    API.get("/api/phase/stats", { reqId: reqId }),
    API.get("/api/versions/stats", { reqId: reqId }),
    API.get("/api/versions", { reqId: reqId }),
    API.get("/api/versions/task-options", { reqId: reqId })
  ]).then(function(rs){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "overview") return;
    cache = { phase: rs[0], vstats: rs[1], versions: rs[2], tasks: rs[3] };
    versionOptionsCache[reqId] = rs[2];
    taskOptionsCache[reqId] = rs[3];
    renderPhaseView();
  }).catch(function(ex){
    if(current !== loadSeq || rt.phaseReqId !== reqId || viewMode === "overview") return;
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

/* ---------- 渲染 ---------- */

function syncModeSeg(){
  var seg = $("phaseModeSeg");
  if(seg) seg.querySelectorAll("[data-pmode]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.pmode === viewMode);
  });
  /* 总览口径是全部项目：隐藏单项目选择与新建版本 */
  var ov = viewMode === "overview";
  if(phaseReq) phaseReq.style.display = ov ? "none" : "";
  if($("btnVerNew")) $("btnVerNew").style.display = (ov || !canWritePhase()) ? "none" : "";
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
    var tv = t.versionId || "";
    if(tv) return tv === val;
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
  if(metric === "完成工作项" || metric === "已完成") rows = rows.filter(isDone);
  else if(metric === "进行中" || metric === "剩余预估") rows = rows.filter(function(t){ return !isDone(t); });
  else if(metric.indexOf("偏差") >= 0) rows = rows.filter(function(t){ return isDone(t) && t.estimateMinutes; });
  else if(metric === "准时完成率") rows = rows.filter(function(t){ return isDone(t) && t.dueDate; });
  else if(metric === "新增需求 / 缺陷维护") rows = rows.filter(function(t){ return t.itemType === "story" || t.itemType === "bug"; });
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
      state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = []; state.versions = [val]; state.due = null; state.focus = false; state.blocked = false;
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
  return st === "plan" ? "已排期" : st === "pass" ? "已通过" : st === "rej" ? "已拒绝" : "待评审";
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
  API.get("/api/versions/" + encodeURIComponent(versionId) + "/release-note").then(function(note){
    if(!document.body.contains(layer)) return;   // 弹层已被关闭：丢弃过期响应
    var rows = note.demands || [];
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
      group = t.versionId || "";
      groupCell = '<span class="tag ghost">' + esc(t.versionId ? (verName[t.versionId] || "版本") : "待规划") + '</span>';
    }
    return '<tr data-group="' + esc(group) + '" data-open-task="' + esc(t.id) + '"'
      + ' data-status="' + esc(t.boardColumn || "") + '"'
      + ' data-owner="' + esc(t.owner || "") + '"'
      + ' data-type="' + esc(t.itemType || "task") + '"'
      + ' data-search="' + esc(String(t.title || "").toLowerCase()) + '"'
      + ' title="打开工作项详情">'
      + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</td>'
      + '<td>' + groupCell + '</td>'
      + '<td>' + esc(typeName(t.itemType)) + '</td>'
      + '<td class="num">' + dateShort(t.startDate) + '</td>'
      + '<td class="num">' + dateShort(t.dueDate) + '</td>'
      + '<td class="num">' + (est ? fmtMinutesShort(est) : "—") + '</td>'
      + '<td class="num">' + (act ? fmtMinutesShort(act) : "—") + '</td>'
      + '<td><span class="mini-tag ' + devCls(dev) + '">' + (dev === null ? "—" : ((dev > 0 ? "+" : "") + dev + "%")) + '</span></td>'
      + '<td>' + (isDone(t) ? '<span class="tag tag-success">已完成</span>' : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
      + '</tr>';
  }).join("") || '<tr><td colspan="9" class="foot-note" style="padding:16px;text-align:center">该项目还没有工作项</td></tr>';
  var segOpts;
  if(mode === "phase"){
    segOpts = [["all", "全部"], ["mvp", "首版开发"], ["post", "迭代维护"]];
  }else{
    segOpts = [["all", "全部"]].concat(cache.versions.map(function(v){ return [v.id, v.name]; }))
      .concat(cache.tasks.some(function(t){ return !t.versionId; }) ? [["", "待规划"]] : []);
  }
  var seg = '<div class="seg mini">' + segOpts.map(function(o, i){
    return '<button type="button" data-filter="' + esc(o[0]) + '"' + (i === 0 ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(o[1]) + '</button>';
  }).join("") + '</div>';
  var head = mode === "phase" ? "工作项明细 · 按阶段" : "工作项明细 · 按影响版本";

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
    ? '<tr data-tbl-empty hidden><td colspan="9" class="foot-note" style="padding:16px;text-align:center">没有符合筛选条件的工作项</td></tr>'
    : "";
  return '<div class="panel"><div class="panel-head"><h3>' + head + '</h3>'
    + '<span class="meta-right">计划起止 · 预估 / 实际 · 偏差 · 点击行打开工作项</span>' + seg + '</div>'
    + tools
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr><th>工作项</th>'
    + (mode === "phase" ? "<th>阶段</th>" : "<th>版本</th>")
    + '<th>类型</th><th class="num">计划开始</th><th class="num">计划结束</th><th class="num">预估</th><th class="num">实际</th><th>偏差</th><th>状态</th></tr></thead>'
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
    var ok = (group === "all" || tr.dataset.group === group)
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
      : (win ? win + " · " : "") + dateShort(v.releasedAt) + " 发布" + (!win && v.targetDate ? (" · 目标 " + dateShort(v.targetDate)) : "");
  }
  else if(st === "active") sub = win + " · 开发中" + (!win && v.targetDate ? (" · 计划发布 " + dateShort(v.targetDate)) : "");
  else sub = (win ? win + " · 待规划" : "待规划") + (!win && v.targetDate ? (" · 目标 " + dateShort(v.targetDate)) : "") + (v.scheduledDemandCount ? (" · 需求池已排 " + v.scheduledDemandCount + " 项") : "");
  var cells;
  if(st === "released"){
    cells = [
      [fmtMinutesShort(v.workMinutes), "投入工时", ""],
      [v.doneCount, "完成工作项", ""],
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
      [dateShort(v.targetDate), "计划发布", "", false]
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
  if(st === "released"){
    acts += '<button class="btn sm ghost" type="button" data-ver-note="' + esc(v.id) + '">发布说明</button>';
  }else if(writable){
    if(st === "planned"){
      acts += '<button class="btn sm" type="button" data-ver-start="' + esc(v.id) + '">开始开发</button>';
    }
    acts += '<button class="btn sm primary" type="button" data-ver-release="' + esc(v.id) + '">发布</button>';
    acts += '<button class="btn sm ghost" type="button" data-ver-tasks="' + esc(v.id) + '">管理工作项</button>';
    acts += '<button class="btn sm ghost" type="button" data-ver-edit="' + esc(v.id) + '">编辑</button>';
  }
  if(isOwner()){
    acts += '<button class="btn sm ghost danger" type="button" data-ver-del="' + esc(v.id) + '">删除</button>';
  }
  acts += '</div>';
  return '<div class="phase-card ' + cls + '"><div class="phase-card-head">'
    + '<span class="tag tag-primary">' + esc(v.name) + '</span>' + stTag
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
    + branchChipsHTML(v.branches)
    + (v.description ? '<p class="foot-note" style="margin:0">' + esc(v.description) + '</p>' : '')
    + metricCells(cells, { scope: "version", val: v.id }) + acts + '</div>';
}
function renderVersionMode(){
  var p = cache.phase;
  if(phaseMeta){
    phaseMeta.textContent = reqNameById(rt.phaseReqId) + " · 按版本分组 · 共 " + cache.versions.length + " 个版本";
  }
  var cards = cache.vstats.versions.map(versionCardHTML).join("");
  var u = cache.vstats.unbound;
  var unboundTasks = cache.tasks.filter(function(t){ return !t.versionId; });
  var writableVer = cache.versions.some(function(v){ return v.status !== "released"; });
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
  var caliber = '<p class="foot-note" style="margin:0">工作项按「影响版本」归组，需求按「目标版本」规划；'
    + '首版上线前未绑版本的工作项自动归入最早已发布版本，其余未绑工作项归「待规划」；已发布 '
    + relCount + ' 个版本 · 偏差 =（实际 − 预估）÷ 预估，±15% 内为准确</p>';
  if(!cache.versions.length && !cache.tasks.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"点右上角「新建版本」创建第一个版本；工作项在详情抽屉里选择影响版本。"
    });
    return;
  }
  phaseBody.innerHTML = '<div class="ver-grid">' + cards + unboundCard + '</div>' + caliber + taskTable("version");
  applyPhaseTblFilters();
}

/* ---------- 版本弹窗 ---------- */

function findVersion(id){
  for(var i = 0; i < cache.versions.length; i++){
    if(cache.versions[i].id === id) return cache.versions[i];
  }
  return null;
}
function openVersionDialog(id){
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  editingVerId = id || null;
  var v = id ? findVersion(id) : null;
  vName.value = v ? v.name : "";
  vStart.value = v ? (v.startDate || "") : "";
  vTarget.value = v ? (v.targetDate || "") : "";
  vDesc.value = v ? (v.description || "") : "";
  fVerName.classList.remove("invalid");
  verFormTitle.textContent = id ? "编辑版本" : "新建版本";
  btnSaveVer.textContent = id ? "保存修改" : "创建版本";
  UI.openModal($("dlgVersion"), "input");
}
function saveVersion(){
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var name = vName.value.trim();
  if(!name){
    fVerName.classList.add("invalid");
    try{ vName.focus(); }catch(e){ /* noop */ }
    return;
  }
  var editing = editingVerId ? findVersion(editingVerId) : null;
  var body = {
    reqId: rt.phaseReqId,
    name: name,
    description: vDesc.value.trim() || null,
    startDate: vStart.value || null,
    targetDate: vTarget.value || null,
    /* 编辑时保持原状态；新建一律 planned；已发布版本的编辑入口已隐藏（服务端亦拒绝） */
    status: editing && editing.status === "active" ? "active" : "planned"
  };
  btnSaveVer.disabled = true;
  var p = editingVerId
    ? API.put("/api/versions/" + encodeURIComponent(editingVerId), body)
    : API.post("/api/versions", body);
  p.then(function(v){
    btnSaveVer.disabled = false;
    UI.closeModal($("dlgVersion"));
    toast((editingVerId ? "已更新版本「" : "已创建版本「") + v.name + "」", "fs");
    editingVerId = null;
    reloadView();
  }).catch(function(ex){
    btnSaveVer.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function publishVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  UI.showConfirm({
    title:"发布版本",
    msg:"发布「" + esc(v.name) + "」？发布后记录实际发布时间，状态变为「已发布」。",
    okText:"发布", danger:false
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/versions/" + encodeURIComponent(id) + "/release", {}).then(function(){
      toast("已发布「" + v.name + "」", "fs");
      reloadView();
    }).catch(function(ex){ toast(ex.message || "发布失败", "bad"); });
  });
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
    msg:"删除「" + esc(v.name) + "」？其下工作项会保留，仅解除版本绑定。",
    okText:"删除版本"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/versions/" + encodeURIComponent(id)).then(function(){
      toast("已删除「" + v.name + "」，其下工作项已解除绑定", "fs");
      reloadView();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openVersionTasks(id){
  var v = findVersion(id);
  if(!v) return;
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var selected = {}, query = "";
  cache.tasks.forEach(function(t){ if(t.versionId === id) selected[t.id] = true; });
  var versionNames = {};
  cache.versions.forEach(function(item){ versionNames[item.id] = item.name; });
  var rows = cache.tasks.slice().sort(function(a, b){
    var av = a.versionId === id ? 0 : 1, bv = b.versionId === id ? 0 : 1;
    return av - bv || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
  });
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet version-task-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(v.name) + ' · 管理工作项</h2>'
    + '<div class="desc">勾选关联到此版本，取消勾选解除关联；选择其他版本的工作项会将其移动到当前版本。</div></div>'
    + '<button class="icon-btn sm" type="button" data-version-task-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="version-task-tools"><input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索版本工作项" data-version-task-search />'
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div></div>'
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
      var bound = t.versionId && t.versionId !== id;
      var brName = t.branchId ? branchNameById(t.branchId) : "";
      var meta = typeName(t.itemType) + " · " + (t.owner || "未指派") + " · "
        + (t.boardColumn === "done" ? "已完成" : colName(t.boardColumn))
        + (brName ? " · 分支 " + brName : "");
      return '<label class="version-task-row"><input type="checkbox" data-version-task-check="' + esc(t.id) + '"'
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><b>' + esc(t.title) + '</b>'
        + '<small>' + esc(meta) + (bound ? ' · 当前：' + esc(versionNames[t.versionId] || "其他版本") : "") + '</small></span></label>';
    }).join("") : '<div class="tl-empty">没有匹配的工作项</div>';
  }
  document.body.appendChild(layer);
  renderList();
  layer.addEventListener("input", function(e){
    if(e.target.closest("[data-version-task-search]")){
      query = e.target.value.trim().toLowerCase();
      renderList();
    }
  });
  layer.addEventListener("change", function(e){
    var check = e.target.closest("[data-version-task-check]");
    if(!check) return;
    selected[check.dataset.versionTaskCheck] = check.checked;
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + rows.length + " 项";
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-version-task-x], [data-version-task-cancel]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-version-task-new]")){
      UI.closeModal(layer);
      openTaskDrawer("backlog", null, { reqId: v.reqId, versionId: v.id });
      return;
    }
    var save = e.target.closest("[data-version-task-save]");
    if(!save) return;
    var taskIds = selectedIds();
    if(taskIds.length > 500){ toast("单个版本最多关联 500 个工作项", "warn"); return; }
    save.disabled = true;
    API.put("/api/versions/" + encodeURIComponent(id), {
      reqId: v.reqId,
      name: v.name,
      description: v.description || null,
      /* 全量覆盖语义：必须回传当前开始日期，否则保存任务关联会清掉它 */
      startDate: v.startDate || null,
      targetDate: v.targetDate || null,
      status: v.status === "active" ? "active" : "planned",
      taskIds: taskIds
    }).then(function(){
      UI.closeModal(layer);
      toast("已保存「" + v.name + "」的 " + taskIds.length + " 项工作项关联", "fs");
      reloadView();
    }).catch(function(ex){
      save.disabled = false;
      toast(ex.message || "保存工作项关联失败", "bad");
    });
  });
  UI.openModal(layer);
}
/* 待规划卡片入口：把未绑定版本的任务批量分配到一个未发布版本（并入该版本已有任务） */
function openUnboundTasks(){
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  var targets = cache.versions.filter(function(v){ return v.status !== "released"; });
  var unbound = cache.tasks.filter(function(t){ return !t.versionId; })
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
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet version-task-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>分配工作项到版本</h2>'
    + '<div class="desc">把未绑定版本的工作项批量归入所选版本；已发布的版本不可选。</div></div>'
    + '<button class="icon-btn sm" type="button" data-unbound-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="version-task-tools">'
    + '<select aria-label="目标版本" data-unbound-ver>' + opts + '</select>'
    + '<input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索待分配工作项" data-unbound-search />'
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div></div>'
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
    if(e.target.closest("[data-unbound-search]")){
      query = e.target.value.trim().toLowerCase();
      renderList();
    }
  });
  layer.addEventListener("change", function(e){
    var check = e.target.closest("[data-unbound-check]");
    if(!check) return;
    selected[check.dataset.unboundCheck] = check.checked;
    layer.querySelector(".version-task-count").textContent = "已选 " + selectedIds().length + " / 共 " + unbound.length + " 项";
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-unbound-x], [data-unbound-cancel]")){ UI.closeModal(layer); return; }
    var save = e.target.closest("[data-unbound-save]");
    if(!save) return;
    var target = selVer();
    var picked = selectedIds();
    if(!picked.length){ toast("请至少勾选一个工作项", "warn"); return; }
    /* 并入目标版本已有绑定，避免覆盖丢关联 */
    var bound = {};
    cache.tasks.forEach(function(t){ if(t.versionId === target.id) bound[t.id] = true; });
    picked.forEach(function(taskId){ bound[taskId] = true; });
    var taskIds = Object.keys(bound);
    if(taskIds.length > 500){ toast("单个版本最多关联 500 个工作项", "warn"); return; }
    save.disabled = true;
    API.put("/api/versions/" + encodeURIComponent(target.id), {
      reqId: target.reqId,
      name: target.name,
      description: target.description || null,
      startDate: target.startDate || null,
      targetDate: target.targetDate || null,
      status: target.status === "active" ? "active" : "planned",
      taskIds: taskIds
    }).then(function(){
      UI.closeModal(layer);
      toast("已将 " + picked.length + " 项工作项分配到「" + target.name + "」", "fs");
      reloadView();
    }).catch(function(ex){
      save.disabled = false;
      toast(ex.message || "分配失败", "bad");
    });
  });
  UI.openModal(layer);
}
function csvCell(s){
  s = s === null || s === undefined ? "" : String(s);
  if(/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
/* T1.6：发布说明导出 CSV（含 BOM，Excel 打开不乱码） */
function exportReleaseNoteCSV(note){
  var v = note.version || {};
  var lines = [
    ["发布说明", v.name || ""],
    ["生成日期", note.generatedAt || ""],
    ["工作项总数", note.totalCount || 0],
    ["完成工作项", note.doneCount || 0],
    ["实际工时(分钟)", note.workMinutes || 0],
    ["预估工时(分钟)", note.estimateMinutes || 0],
    [],
    ["交付工作项", "状态", "预估(分钟)", "类型"]
  ];
  (note.tasks || []).forEach(function(t){
    lines.push([t.title, t.boardColumn === "done" ? "已完成" : "进行中",
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
  a.download = "发布说明-" + (v.name || "版本") + ".csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function showReleaseNote(id){
  API.get("/api/versions/" + encodeURIComponent(id) + "/release-note").then(function(note){
    var v = note.version || {};
    var taskRows = (note.tasks || []).map(function(t){
      return '<li><button class="link-cell" type="button" data-note-task="' + esc(t.id) + '" title="查看工作项">' + esc(t.title) + '</button>'
        + (t.boardColumn === "done" ? ' <span class="tag tag-success">已完成</span>' : "")
        + (t.preLaunchFold ? ' <span class="tag ghost">上线前归入</span>' : "")
        + (t.estimateMinutes ? ' <span class="mini-tag mute">' + fmtMinutesShort(t.estimateMinutes) + '</span>' : "") + '</li>';
    }).join("") || '<li class="foot-note">该版本没有绑定工作项</li>';
    var demandRows = (note.demands || []).map(function(d){
      return '<li><button class="link-cell" type="button" data-note-demand="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>'
        + ' <span class="tag ghost">' + esc(d.itemKind || "其他") + '</span></li>';
    }).join("") || '<li class="foot-note">没有已排需求</li>';
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    layer.innerHTML = '<div class="sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
      + '<h2>' + esc(v.name || "版本") + ' · 发布说明</h2>'
      + '<div class="desc">生成于 ' + esc(note.generatedAt || "") + ' · 工作项 ' + (note.totalCount || 0)
      + '（完成 ' + (note.doneCount || 0) + '）· 实际工时 ' + fmtMinutesShort(note.workMinutes || 0)
      + ' / 预估 ' + fmtMinutesShort(note.estimateMinutes || 0) + '</div></div>'
      + '<button class="btn sm" type="button" data-note-export>导出 CSV</button>'
      + '<button class="icon-btn sm" type="button" data-note-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body phase-note"><div class="field"><label>交付工作项</label><ul>' + taskRows + '</ul></div>'
      + '<div class="field"><label>已排需求</label><ul>' + demandRows + '</ul></div></div></div>';
    document.body.appendChild(layer);
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-note-x]")) UI.closeModal(layer);
      if(e.target.closest("[data-note-export]")) exportReleaseNoteCSV(note);
      var tk = e.target.closest("[data-note-task]");
      if(tk){ UI.closeModal(layer); openTaskById(tk.dataset.noteTask); return; }
      var dm = e.target.closest("[data-note-demand]");
      if(dm){ UI.closeModal(layer); openDemandDetailById(dm.dataset.noteDemand); return; }
    });
    UI.openModal(layer);
  }).catch(function(ex){ toast(ex.message || "生成发布说明失败", "bad"); });
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

/* ---------- 任务抽屉「影响版本」选项 ---------- */

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
    sel.innerHTML = '<option value="">待规划</option>';
    sel.setAttribute("data-ready", "1");
    return;
  }
  fetchVersions(reqId).then(function(vs){
    if(!stillCurrent()) return;
    var html = '<option value="">待规划（不绑定版本）</option>';
    vs.forEach(function(v){ html += '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; });
    sel.innerHTML = html;
    function pick(v){
      if(!stillCurrent()) return;
      var hit = false;
      Array.prototype.forEach.call(sel.options, function(o){ if(o.value === v) hit = true; });
      sel.value = hit ? v : "";
      sel.setAttribute("data-ready", "1");
    }
    if(keep !== undefined && keep !== null){ pick(keep); return; }
    if(taskId){
      fetchTaskOptions(reqId).then(function(rows){
        if(!stillCurrent()) return;
        var v = "";
        for(var i = 0; i < rows.length; i++){
          if(rows[i].id === taskId){ v = rows[i].versionId || ""; break; }
        }
        pick(v);
      }).catch(function(){ pick(""); });
    }else{
      pick("");
    }
  }).catch(function(){
    if(!stillCurrent()) return;
    sel.innerHTML = '<option value="">待规划</option>';
  });
}
/* 「发现版本」与「影响版本」共用同一份项目版本列表，但语义独立：
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
  if(cache) renderPhaseView();
  else loadPhaseData();
});
if($("btnVerNew")) $("btnVerNew").addEventListener("click", function(){
  if(!rt.phaseReqId){ toast("先选择项目，再新建版本", "warn"); return; }
  if(!canWritePhase()){ denyPhaseReadOnly(); return; }
  openVersionDialog(null);
});
if($("dlgVersionX")) $("dlgVersionX").addEventListener("click", function(){ UI.closeModal($("dlgVersion")); });
if(btnSaveVer) btnSaveVer.addEventListener("click", saveVersion);
if(vName) vName.addEventListener("input", function(){ fVerName.classList.remove("invalid"); });
if(phaseBody) phaseBody.addEventListener("click", function(e){
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
  var ua = e.target.closest("[data-unbound-assign]");
  if(ua){ openUnboundTasks(); return; }
});
if(phaseBody) phaseBody.addEventListener("change", function(e){
  if(e.target.closest("[data-tbl-status],[data-tbl-owner],[data-tbl-type]")) applyPhaseTblFilters();
});
if(phaseBody) phaseBody.addEventListener("input", function(e){
  if(e.target.closest("[data-tbl-kw]")) applyPhaseTblFilters();
});

function setPhaseProject(reqId){
  if(!reqId) return;
  rt.phaseReqId = reqId;
  if(viewMode === "overview") viewMode = "phase";
  if(document.body.dataset.view === "phase"){
    syncModeSeg();
    loadPhaseData();
  }
}
export { enterPhaseView, ensureEpicOptions, ensureFoundVersionOptions, ensureVersionOptions, invalidateTaskOptionsCache, loadPhaseData, reloadView, renderPhaseView, setPhaseProject, showReleaseNote };
