/* views/phase · 版本阶段：按阶段（首版/迭代）与按版本（三态版本卡）双口径 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { reqNameById, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { colName, fmtMinutesShort } from "../lib/format.js";
import { loadReqs } from "./board.js";

var phaseReq = $("phaseReq"), phaseMeta = $("phaseMeta"), phaseBody = $("phaseBody"),
    vName = $("vName"), vTarget = $("vTarget"), vDesc = $("vDesc"),
    fVerName = $("fVerName"), btnSaveVer = $("btnSaveVer"), verFormTitle = $("verFormTitle");

var editingVerId = null;
var viewMode = "phase";            /* phase | version | overview */
var cache = null;                  /* { phase, vstats, versions, tasks } */
var overviewCache = null;
/* 任务抽屉的「影响版本」选项缓存：按项目缓存，写版本后失效 */
var versionOptionsCache = {};
var taskOptionsCache = {};

function isOwner(){ return !!(rt.currentWs && rt.currentWs.myRole === "owner"); }
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
  return { story:"用户故事", task:"任务", bug:"缺陷", epic:"Epic" }[itemType || "task"] || "任务";
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
  phaseReq.innerHTML = rt.reqList.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  if(!rt.phaseReqId && rt.reqList.length) rt.phaseReqId = rt.reqList[0].id;
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
      text:"先在「项目」里创建项目并归入任务，这里就能按阶段、按版本看投入与偏差。"
    });
    if(phaseMeta) phaseMeta.textContent = "";
    return;
  }
  if(phaseMeta) phaseMeta.textContent = reqNameById(rt.phaseReqId);
  phaseBody.innerHTML = UI.skeletonRows(4);
  var reqId = rt.phaseReqId;
  Promise.all([
    API.get("/api/phase/stats", { reqId: reqId }),
    API.get("/api/versions/stats", { reqId: reqId }),
    API.get("/api/versions", { reqId: reqId }),
    API.get("/api/versions/task-options", { reqId: reqId })
  ]).then(function(rs){
    if(rt.phaseReqId !== reqId) return;
    cache = { phase: rs[0], vstats: rs[1], versions: rs[2], tasks: rs[3] };
    versionOptionsCache[reqId] = rs[2];
    taskOptionsCache[reqId] = rs[3];
    renderPhaseView();
  }).catch(function(ex){
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
  if(phaseMeta) phaseMeta.textContent = "全部项目";
  phaseBody.innerHTML = UI.skeletonRows(5);
  API.get("/api/versions/overview").then(function(ov){
    overviewCache = ov;
    if(viewMode === "overview") renderOverviewMode();
  }).catch(function(ex){
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
      text:"先在「项目」里创建项目并归入任务，这里就能横向对比各项目的首版与迭代投入。"
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
    + '<span class="meta-right">工时口径：首版/迭代按完成任务的自然日归组</span></div>'
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
  if($("btnVerNew")) $("btnVerNew").style.display = ov ? "none" : "";
}
function metricCells(cells, drill){
  return '<div class="pgrid">' + cells.map(function(c){
    var color = c[2] ? ' style="color:var(--' + c[2] + ');"' : '';
    /* drill：{scope:"version"|"phase", val} —— 指标格点击下钻任务明细；c[3]===false 的格不参与（如计划发布日期） */
    if(drill && c[3] !== false){
      return '<button type="button" class="pcell drillable" data-drill-scope="' + esc(drill.scope)
        + '" data-drill-val="' + esc(drill.val) + '" data-drill-metric="' + esc(c[1])
        + '" title="查看该口径的任务明细"><b' + color + '>' + c[0] + '</b><span>' + esc(c[1]) + '</span></button>';
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
  if(metric === "完成任务" || metric === "已完成") rows = rows.filter(isDone);
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
    return '<tr data-open-task="' + esc(t.id) + '" title="打开任务详情">'
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
  }).join("") || '<tr><td colspan="8" class="foot-note" style="padding:16px;text-align:center">该口径下暂无任务</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(reqNameById(rt.phaseReqId)) + ' · ' + esc(scopeName) + ' · ' + esc(metric) + '</h2>'
    + '<div class="desc">共 ' + rows.length + ' 项 · 点击任务行打开详情</div></div>'
    + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
    + '<th>任务</th><th>类型</th><th>负责人</th><th>计划开始</th><th>计划结束</th><th>预估</th><th>实际</th><th>状态</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
    var t = e.target.closest("[data-open-task]");
    if(t){ UI.closeModal(layer); openTaskById(t.dataset.openTask); }
  });
  UI.openModal(layer);
}

/* 成员阶段工时下钻：按该成员自己的计时记录列出「任务 × 阶段」，合计与阶段卡一致 */
function openMemberDrill(userId, name){
  if(!cache || !cache.phase || !rt.phaseReqId) return;
  var reqId = rt.phaseReqId;
  API.get("/api/phase/member-tasks", { reqId: reqId, userId: userId || "" }).then(function(rows){
    if(rt.phaseReqId !== reqId) return;
    rows = rows || [];
    var mvpMin = 0, postMin = 0;
    rows.forEach(function(r){
      if(r.phase === "mvp") mvpMin += r.minutes || 0;
      else postMin += r.minutes || 0;
    });
    var body = rows.map(function(r){
      var est = r.estimateMinutes || 0, act = r.minutes || 0;
      return '<tr data-open-task="' + esc(r.taskId) + '" title="打开任务详情">'
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
    }).join("") || '<tr><td colspan="8" class="foot-note" style="padding:16px;text-align:center">该成员在此项目暂无计时记录</td></tr>';
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    layer.innerHTML = '<div class="sheet wide"><div class="sheet-head"><div style="flex:1;min-width:0">'
      + '<h2>' + esc(name) + ' · 阶段工时明细</h2>'
      + '<div class="desc">共 ' + rows.length + ' 行 · 首版 ' + fmtMinutesShort(mvpMin) + ' · 迭代 ' + fmtMinutesShort(postMin)
      + ' · 按计时自然日归组，点击任务行打开详情</div></div>'
      + '<button class="icon-btn sm" type="button" data-drill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body"><div class="tbl-wrap"><table class="phase-tbl"><thead><tr>'
      + '<th>任务</th><th>阶段</th><th>类型</th><th>计划开始</th><th>计划结束</th><th>预估</th><th>实际</th><th>状态</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table></div></div></div>';
    document.body.appendChild(layer);
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-drill-x]")){ UI.closeModal(layer); return; }
      var t = e.target.closest("[data-open-task]");
      if(t){ UI.closeModal(layer); openTaskById(t.dataset.openTask); }
    });
    UI.openModal(layer);
  }).catch(function(ex){ toast("加载成员工时失败：" + (ex.message || "网络异常"), "bad"); });
}

function renderPhaseView(){
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
  var mvpLabel = "<b>" + fmtMinutesShort(mvp.workMinutes) + "</b>首版开发 · 完成 " + mvp.doneTasks + " 任务";
  var inner;
  if(firstRel && min){
    var total = Math.max(1, (new Date(end) - new Date(min)) / 86400000);
    var mvpW = Math.max(8, Math.min(85, Math.round(((new Date(firstRel) - new Date(min)) / 86400000) / total * 100)));
    var postLabel = post ? ("<b>" + fmtMinutesShort(post.workMinutes) + "</b>迭代维护 · 完成 " + post.doneTasks + " 任务") : "";
    var postSeg = postLabel
      ? '<button type="button" class="pseg post" style="flex:1" data-drill-scope="phase" data-drill-val="post" data-drill-metric="完成任务" title="查看迭代维护阶段的任务明细">' + postLabel + '</button>'
      : '<span class="pseg post" style="flex:1">' + postLabel + '</span>';
    inner = '<button type="button" class="pseg mvp" style="width:' + mvpW + '%" data-drill-scope="phase" data-drill-val="mvp" data-drill-metric="完成任务" title="查看首版开发阶段的任务明细">' + mvpLabel + '</button>'
      + '<span class="plaunch" data-label="' + dateShort(firstRel) + ' 首版上线"></span>'
      + postSeg;
  }else{
    inner = '<button type="button" class="pseg mvp" style="width:100%" data-drill-scope="phase" data-drill-val="mvp" data-drill-metric="完成任务" title="查看首版开发阶段的任务明细">' + mvpLabel + '</button>';
  }
  return '<div class="panel"><div class="panel-head"><h3>阶段时间轴与投入</h3>'
    + '<span class="meta-right">' + (min ? (dateShort(min) + " ~ " + dateShort(end)) : "暂无任务日期") + ' · 点击色块查看任务</span></div>'
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
    [p.doneTasks, "完成任务", ""],
    [p.memberCount ? (fmtMinutesShort(p.avgMemberMinutes) + "（" + p.memberCount + " 人）") : "—", "人均", ""],
    [devText(p.deviationPct), "整体偏差", devColor(p.deviationPct)],
    [withSplit ? ((p.storyCount || 0) + " / " + (p.bugCount || 0)) : fmtPct(p.onTimePct),
      withSplit ? "新增需求 / 缺陷维护" : "准时完成率", ""],
    [p.avgTaskMinutes === null || p.avgTaskMinutes === undefined ? "—" : fmtMinutesShort(p.avgTaskMinutes), "任务均耗时", ""]
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
    return '<tr data-member-drill="' + esc(r.userId || "") + '" data-member-name="' + esc(r.name) + '" title="查看该成员的任务明细"><td>' + esc(r.name) + '</td>'
      + '<td class="num">' + fmtMinutesShort(r.mvp) + '</td>'
      + '<td class="num">' + fmtMinutesShort(r.post) + '</td>'
      + '<td class="num" style="font-weight:600">' + fmtMinutesShort(total) + '</td>'
      + '<td>' + (r.post > r.mvp ? '<span class="tag tag-plum">迭代为主</span>' : '<span class="tag tag-info">首版为主</span>') + '</td></tr>';
  }).join("");
  return '<div class="panel"><div class="panel-head"><h3>按成员的阶段工时</h3>'
    + '<span class="meta-right">自动计时按任务完成日归入阶段 · 点击成员行查看明细</span></div>'
    + '<div class="tbl-wrap"><table class="phase-tbl"><thead><tr><th style="width:160px">成员</th><th>首版开发</th>'
    + '<th>迭代维护</th><th>合计</th><th>阶段重心</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
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
    return '<tr data-group="' + esc(group) + '" data-open-task="' + esc(t.id) + '" title="打开任务详情">'
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
  }).join("") || '<tr><td colspan="9" class="foot-note" style="padding:16px;text-align:center">该项目还没有任务</td></tr>';
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
  var head = mode === "phase" ? "任务明细 · 按阶段" : "任务明细 · 按影响版本";
  return '<div class="panel"><div class="panel-head"><h3>' + head + '</h3>'
    + '<span class="meta-right">计划起止 · 预估 / 实际 · 偏差 · 点击行打开任务</span>' + seg + '</div>'
    + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr><th>任务</th>'
    + (mode === "phase" ? "<th>阶段</th>" : "<th>版本</th>")
    + '<th>类型</th><th>计划开始</th><th>计划结束</th><th>预估</th><th>实际</th><th>偏差</th><th>状态</th></tr></thead>'
    + '<tbody id="phaseTblBody">' + rows + '</tbody></table></div></div>';
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
      + '<div class="phase-pend-desc">该项目尚未标记首版上线。标记后，此前的投入归入<b>首版开发</b>，之后的投入归入<b>迭代维护</b>，历史任务阶段不受影响。</div>'
      + (isOwner()
          ? '<button class="btn sm primary" type="button" data-launch="1">标记首版上线</button>'
          : '<p class="foot-note">标记首版上线需空间主操作</p>')
      + '</div>';
  }
  phaseBody.innerHTML = phaseTimeline(firstRel)
    + '<div class="phase-duo">' + mvpCard + postCard + '</div>'
    + memberTable()
    + taskTable("phase");
}

/* ===== 按版本 ===== */

function versionCardHTML(v){
  var st = v.status;
  var stTag = st === "released" ? '<span class="tag tag-success">已发布</span>'
    : (st === "active" ? '<span class="tag tag-info">开发中</span>' : '<span class="tag ghost">待规划</span>');
  var cls = st === "released" ? "ver-rel" : (st === "active" ? "ver-doing" : "ver-plan");
  var sub;
  if(st === "released"){
    sub = (v.preLaunchCount > 0)
      ? dateShort(v.releasedAt) + " · 首版（上线前投入自动归入）"
      : dateShort(v.releasedAt) + " 发布" + (v.targetDate ? (" · 目标 " + dateShort(v.targetDate)) : "");
  }
  else if(st === "active") sub = "开发中" + (v.targetDate ? (" · 计划发布 " + dateShort(v.targetDate)) : "");
  else sub = "待规划" + (v.targetDate ? (" · 目标 " + dateShort(v.targetDate)) : "") + (v.scheduledDemandCount ? (" · 需求池已排 " + v.scheduledDemandCount + " 项") : "");
  var cells;
  if(st === "released"){
    cells = [
      [fmtMinutesShort(v.workMinutes), "投入工时", ""],
      [v.doneCount, "完成任务", ""],
      [v.demandCount, "已排需求", "", false],
      [devText(v.deviationPct), "整体偏差", devColor(v.deviationPct)],
      [fmtPct(v.onTimePct), "准时完成率", ""],
      [v.avgTaskMinutes === null || v.avgTaskMinutes === undefined ? "—" : fmtMinutesShort(v.avgTaskMinutes), "任务均耗时", ""]
    ];
  }else if(st === "active"){
    cells = [
      [fmtMinutesShort(v.workMinutes), "已投入工时", ""],
      [v.doneCount, "已完成", ""],
      [v.doingCount, "进行中", ""],
      [v.demandCount, "已排需求", "", false],
      [fmtMinutesShort(v.remainingMinutes), "剩余预估", ""],
      [dateShort(v.targetDate), "计划发布", "", false]
    ];
  }else{
    cells = [
      [v.scheduledDemandCount, "待规划需求", "", false],
      [fmtMinutesShort(v.estimateMinutes), "预估工时", ""],
      [v.taskCount ? v.taskCount : "—", "已拆解任务", ""],
      [fmtMinutesShort(v.workMinutes), "已投入工时", ""]
    ];
  }
  var acts = '<div class="phase-acts">';
  if(st === "released"){
    acts += '<button class="btn sm ghost" type="button" data-ver-note="' + esc(v.id) + '">发布说明</button>';
  }else{
    acts += '<button class="btn sm primary" type="button" data-ver-release="' + esc(v.id) + '">发布</button>';
  }
  acts += '<button class="btn sm ghost" type="button" data-ver-tasks="' + esc(v.id) + '">管理任务</button>';
  acts += '<button class="btn sm ghost" type="button" data-ver-edit="' + esc(v.id) + '">编辑</button>';
  if(isOwner()){
    acts += '<button class="btn sm ghost danger" type="button" data-ver-del="' + esc(v.id) + '">删除</button>';
  }
  acts += '</div>';
  return '<div class="phase-card ' + cls + '"><div class="phase-card-head">'
    + '<span class="tag tag-primary">' + esc(v.name) + '</span>' + stTag
    + '<span class="phase-card-sub">' + esc(sub) + '</span></div>'
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
  var unboundCard = '<div class="phase-card ver-plan"><div class="phase-card-head">'
    + '<span class="tag ghost">待规划</span><span class="phase-card-sub">未绑定版本的任务</span></div>'
    + metricCells([
      [u.taskCount, "待规划任务", ""],
      [u.doneCount, "已完成", ""],
      [fmtMinutesShort(u.estimateMinutes), "预估工时", ""],
      [fmtMinutesShort(u.remainingMinutes), "剩余预估", ""]
    ], { scope: "version", val: "" }) + '</div>';
  var relCount = cache.versions.filter(function(v){ return v.status === "released"; }).length;
  var caliber = '<p class="foot-note" style="margin:0">任务按「影响版本」归组，需求按「目标版本」规划；'
    + '首版上线前未绑版本的任务自动归入最早已发布版本，其余未绑任务归「待规划」；已发布 '
    + relCount + ' 个版本 · 偏差 =（实际 − 预估）÷ 预估，±15% 内为准确</p>';
  if(!cache.versions.length && !cache.tasks.length){
    phaseBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有版本",
      text:"点右上角「新建版本」创建第一个版本；任务在详情抽屉里选择影响版本。"
    });
    return;
  }
  phaseBody.innerHTML = '<div class="ver-grid">' + cards + unboundCard + '</div>' + caliber + taskTable("version");
}

/* ---------- 版本弹窗 ---------- */

function findVersion(id){
  for(var i = 0; i < cache.versions.length; i++){
    if(cache.versions[i].id === id) return cache.versions[i];
  }
  return null;
}
function openVersionDialog(id){
  editingVerId = id || null;
  var v = id ? findVersion(id) : null;
  vName.value = v ? v.name : "";
  vTarget.value = v ? (v.targetDate || "") : "";
  vDesc.value = v ? (v.description || "") : "";
  fVerName.classList.remove("invalid");
  verFormTitle.textContent = id ? "编辑版本" : "新建版本";
  btnSaveVer.textContent = id ? "保存修改" : "创建版本";
  UI.openModal($("dlgVersion"), "input");
}
function saveVersion(){
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
    targetDate: vTarget.value || null,
    /* 编辑时保持原状态（released 服务端会忽略），新建一律 planned */
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
function deleteVersion(id){
  var v = findVersion(id);
  if(!v) return;
  if(!isOwner()){ toast("仅空间主可删除版本", "warn"); return; }
  UI.showConfirm({
    title:"删除版本",
    msg:"删除「" + esc(v.name) + "」？其下任务会保留，仅解除版本绑定。",
    okText:"删除版本"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/versions/" + encodeURIComponent(id)).then(function(){
      toast("已删除「" + v.name + "」，其下任务已解除绑定", "fs");
      reloadView();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openVersionTasks(id){
  var v = findVersion(id);
  if(!v) return;
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
    + '<h2>' + esc(v.name) + ' · 管理任务</h2>'
    + '<div class="desc">勾选关联到此版本，取消勾选解除关联；选择其他版本的任务会将其移动到当前版本。</div></div>'
    + '<button class="icon-btn sm" type="button" data-version-task-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="version-task-tools"><input type="search" placeholder="搜索任务标题或负责人…" aria-label="搜索版本任务" data-version-task-search />'
    + '<span class="version-task-count"></span></div><div class="version-task-list"></div></div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-version-task-new>+ 在此版本新建任务</button>'
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
      var meta = typeName(t.itemType) + " · " + (t.owner || "未指派") + " · "
        + (t.boardColumn === "done" ? "已完成" : colName(t.boardColumn));
      return '<label class="version-task-row"><input type="checkbox" data-version-task-check="' + esc(t.id) + '"'
        + (selected[t.id] ? " checked" : "") + ' /><span class="version-task-main"><b>' + esc(t.title) + '</b>'
        + '<small>' + esc(meta) + (bound ? ' · 当前：' + esc(versionNames[t.versionId] || "其他版本") : "") + '</small></span></label>';
    }).join("") : '<div class="tl-empty">没有匹配的任务</div>';
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
    if(taskIds.length > 500){ toast("单个版本最多关联 500 个任务", "warn"); return; }
    save.disabled = true;
    API.put("/api/versions/" + encodeURIComponent(id), {
      reqId: v.reqId,
      name: v.name,
      description: v.description || null,
      targetDate: v.targetDate || null,
      status: v.status === "active" ? "active" : "planned",
      taskIds: taskIds
    }).then(function(){
      UI.closeModal(layer);
      toast("已保存「" + v.name + "」的 " + taskIds.length + " 项任务关联", "fs");
      reloadView();
    }).catch(function(ex){
      save.disabled = false;
      toast(ex.message || "保存任务关联失败", "bad");
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
    ["任务总数", note.totalCount || 0],
    ["完成任务", note.doneCount || 0],
    ["实际工时(分钟)", note.workMinutes || 0],
    ["预估工时(分钟)", note.estimateMinutes || 0],
    [],
    ["交付任务", "状态", "预估(分钟)", "类型"]
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
      return '<li>' + esc(t.title) + (t.boardColumn === "done" ? ' <span class="tag tag-success">已完成</span>' : "")
        + (t.preLaunchFold ? ' <span class="tag ghost">上线前归入</span>' : "")
        + (t.estimateMinutes ? ' <span class="mini-tag mute">' + fmtMinutesShort(t.estimateMinutes) + '</span>' : "") + '</li>';
    }).join("") || '<li class="foot-note">该版本没有绑定任务</li>';
    var demandRows = (note.demands || []).map(function(d){
      return '<li>' + esc(d.title) + ' <span class="tag ghost">' + esc(d.itemKind || "其他") + '</span></li>';
    }).join("") || '<li class="foot-note">没有已排需求</li>';
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    layer.innerHTML = '<div class="sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
      + '<h2>' + esc(v.name || "版本") + ' · 发布说明</h2>'
      + '<div class="desc">生成于 ' + esc(note.generatedAt || "") + ' · 任务 ' + (note.totalCount || 0)
      + '（完成 ' + (note.doneCount || 0) + '）· 实际工时 ' + fmtMinutesShort(note.workMinutes || 0)
      + ' / 预估 ' + fmtMinutesShort(note.estimateMinutes || 0) + '</div></div>'
      + '<button class="btn sm" type="button" data-note-export>导出 CSV</button>'
      + '<button class="icon-btn sm" type="button" data-note-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body phase-note"><div class="field"><label>交付任务</label><ul>' + taskRows + '</ul></div>'
      + '<div class="field"><label>已排需求</label><ul>' + demandRows + '</ul></div></div></div>';
    document.body.appendChild(layer);
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-note-x]")) UI.closeModal(layer);
      if(e.target.closest("[data-note-export]")) exportReleaseNoteCSV(note);
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
  sel.removeAttribute("data-ready");
  if(!reqId){
    sel.innerHTML = '<option value="">待规划</option>';
    sel.setAttribute("data-ready", "1");
    return;
  }
  fetchVersions(reqId).then(function(vs){
    var html = '<option value="">待规划（不绑定版本）</option>';
    vs.forEach(function(v){ html += '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; });
    sel.innerHTML = html;
    function pick(v){
      var hit = false;
      Array.prototype.forEach.call(sel.options, function(o){ if(o.value === v) hit = true; });
      sel.value = hit ? v : "";
      sel.setAttribute("data-ready", "1");
    }
    if(keep !== undefined && keep !== null){ pick(keep); return; }
    if(taskId){
      fetchTaskOptions(reqId).then(function(rows){
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
    sel.innerHTML = '<option value="">待规划</option>';
  });
}
function ensureEpicOptions(keep, taskId){
  var sel = $("iEpic");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  sel.removeAttribute("data-ready");
  if(!reqId){
    sel.innerHTML = '<option value="">无所属 Epic</option>';
    sel.setAttribute("data-ready", "1");
    return;
  }
  sel.innerHTML = '<option value="">Epic 加载中…</option>';
  fetchTaskOptions(reqId).then(function(rows){
    var html = '<option value="">无所属 Epic</option>';
    rows.forEach(function(t){
      if(t.itemType === "epic" && t.id !== taskId){
        html += '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>';
      }
    });
    sel.innerHTML = html;
    function pick(value){
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
    sel.innerHTML = '<option value="">Epic 加载失败，保存时保留原关联</option>';
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
  if(dr){ openDrillModal(dr.dataset.drillScope, dr.dataset.drillVal, dr.dataset.drillMetric); return; }
  var flt = e.target.closest("[data-filter]");
  if(flt){
    var seg = flt.parentNode;
    seg.querySelectorAll("button").forEach(function(b){
      b.setAttribute("aria-pressed", b === flt);
    });
    var f = flt.dataset.filter;
    var body = $("phaseTblBody");
    if(body){
      body.querySelectorAll("tr[data-group]").forEach(function(tr){
        tr.style.display = (f === "all" || tr.dataset.group === f) ? "" : "none";
      });
    }
    return;
  }
  var launch = e.target.closest("[data-launch]");
  if(launch){ markFirstRelease(); return; }
  var rel = e.target.closest("[data-ver-release]");
  if(rel){ publishVersion(rel.dataset.verRelease); return; }
  var manageTasks = e.target.closest("[data-ver-tasks]");
  if(manageTasks){ openVersionTasks(manageTasks.dataset.verTasks); return; }
  var ed = e.target.closest("[data-ver-edit]");
  if(ed){ openVersionDialog(ed.dataset.verEdit); return; }
  var dl = e.target.closest("[data-ver-del]");
  if(dl){ deleteVersion(dl.dataset.verDel); return; }
  var nt = e.target.closest("[data-ver-note]");
  if(nt){ showReleaseNote(nt.dataset.verNote); return; }
});

export { enterPhaseView, ensureEpicOptions, ensureVersionOptions, invalidateTaskOptionsCache, loadPhaseData, reloadView, renderPhaseView };
