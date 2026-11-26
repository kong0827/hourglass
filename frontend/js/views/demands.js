/* views/demands · 需求池：五态看板、主状态工作页与交付证据派生阶段 */

import { API } from "../core/api.js";
import { AIProgress, aiApplyFailText, aiErrorText as aiErrMsg, aiUsageText } from "../core/ai-progress.js";
import { loadCategories } from "../core/app.js";
import { openAttPreview, previewable, kindOf } from "../core/att-preview.js";
import { bindFileDrop, createAttachKit, uploadAttachment, validateFiles, reportRejected, openAttachment, ACCEPT } from "../core/attach-kit.js";
import { $ } from "../core/dom.js";
import { openDateAt } from "../core/date-picker.js";
import { loadViews, pruneUnknownCats, savedViewsFor } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { listDensitySegHTML } from "../core/list-density.js";
import { createMentionPicker } from "../core/mention-picker.js";
import { MOBILE_APPROVALS } from "../core/mobile-rules.js";
import * as listPrefs from "../core/list-preferences.js";
import { activeView, setReturnOrigin } from "../core/router.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocRead, syncAssocViewBtns, syncDemandLabelFromCache } from "../core/task-drawer.js";
import { canEditReq, catNameById, catTag, projectGroups, projectOptionsHTML, reqNameById, rt, setNameById } from "../core/state.js";
import { UI, esc, toast, copyToClipboard } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { PRIORITIES, assocLinkHTML, taskDescText, taskVersionIds, taskVersionLinksHTML, taskVersionsText, taskPublicationHTML, fmtReleaseTime, colName, demandGanttInfoHTML, docTypeName, fmtMinutesShort, fmtSize, fmtTs, iso, priColor, priName, priTagHTML, typeBadgeHTML, demandNoText } from "../lib/format.js";
import { GS } from "../lib/gantt-shared.js";
import { STAGE_META } from "../lib/stage-hours.js";
import { triggerDownload } from "../lib/download.js";
import { registerHelp, caliberMarkHTML, initCaliberHelp } from "../lib/caliber-help.js";
import { loadProjectMembers } from "../lib/member-labels.js";
import { loadReqs } from "./board.js";

var demandReq = $("demandReq"), demandsMeta = $("demandsMeta"), demandBody = $("demandBody"),
    demandGanttBar = $("demandGanttBar"), demandGanttHelp = $("demandGanttHelp"), demandsPage = $("demandsPage"),
    dReq = $("dReq"), dTitle = $("dTitle"), dDesc = $("dDesc"), dAccept = $("dAccept"),
    dSource = $("dSource"), dKind = $("dKind"), dCategory = $("dCategory"), dExpect = $("dExpect"), dReviewer = $("dReviewer"),
    dWsjfB = $("dWsjfB"), dWsjfU = $("dWsjfU"), dWsjfR = $("dWsjfR"), dWsjfE = $("dWsjfE"),
    fDemandTitle = $("fDemandTitle"), btnSaveDemand = $("btnSaveDemand"), demandFormTitle = $("demandFormTitle"),
    dpVersion = $("dpVersion"), dpNote = $("dpNote"), fDemandPlanVer = $("fDemandPlanVer"), btnDoPlan = $("btnDoPlan"),
    dpPlannedStart = $("dpPlannedStart"), dpPlannedEnd = $("dpPlannedEnd"), dpPriority = $("dpPriority"),
    dpTaskBlock = $("fDemandPlanTasks"), dpTaskToggle = $("dpTaskToggle"), dpTaskSummary = $("dpTaskSummary"),
    dpTaskPicker = $("dpTaskPicker"), dpTaskExpandBtn = $("dpTaskExpandBtn"), dpTaskSearch = $("dpTaskSearch"),
    dpTaskCount = $("dpTaskCount"), dpTaskList = $("dpTaskList"), dpTaskEmpty = $("dpTaskEmpty");

var COLS = [
  ["review", "待评审", "var(--text-3)"],
  ["pass", "已通过", "var(--info)"],
  ["plan", "已排期", "var(--success)"],
  ["done", "已完成", "var(--plum)"],
  ["closed", "已关闭", "var(--text-3)"]
];
var STATUS_HINTS = {
  review: "评审工作台：通过进入排期准备，不通过进入关闭归档",
  pass: "排期准备页：只处理评审通过、尚未排期的需求",
  plan: "交付执行页：交付阶段由工作项开工事实派生",
  done: "完成工作台：工作项全部完成且用例通过后自动进入，交付另行判定",
  closed: "关闭归档：保留关闭原因与关闭前阶段，可恢复到原流程"
};
var DELIVERY_STAGES = [
  ["waiting", "待开工"],
  ["active", "推进中"],
  ["donePending", "待发布"],
  ["delivered", "已交付"]
];
var CLOSE_REASONS = { rej:"评审不通过", cancel:"中途取消", dup:"重复需求" };
/* 与新建表单、AI 拆单同一套类型枚举；类型只在待评审可改，之后由流转锁定 */
var DEMAND_ITEM_KINDS = ["新功能", "体验优化", "缺陷", "其他"];
var CLOSE_STAGES = { review:"待评审", pass:"已通过", plan:"已排期", done:"已完成" };
/* 页面级「!」：状态与流转、交付阶段派生边界，口径与 DemandService / DemandMapper 一致 */
var DEMAND_FLOW_HELP = {
  title: "需求状态与流转",
  rows: [
    ["待评审", "新建需求默认进入。评审通过进入「已通过」；不通过会直接关闭并记录原因，之后只能重新打开回「待评审」。", "mute"],
    ["已通过", "等待排期。可撤回评审回到待评审，也可以直接关闭。", "ok"],
    ["已排期", "已绑定目标版本与计划日期。调期仍停留在已排期；撤销排期回到已通过，并清空版本与计划日期。交付阶段在这里只读派生。", "ok"],
    ["已完成", "至少 1 个工作项全部完成，且关联用例最新执行全部通过（0 条用例视为通过）时自动进入；有成功生产发布或人工交付判定也直接完成。工作项重开、用例执行失败或发布回滚会自动退回「已排期」，版本与计划日期不变。完成 ≠ 交付。", "type-story"],
    ["交付阶段", "只读派生：已排期上为待开工 → 推进中（工作项真实开工）；已完成上为待发布 → 已交付（成功生产发布或人工交付判定）。阶段不能手工改。", "mute"],
    ["已关闭", "保留关闭原因与关闭前阶段。评审不通过的只能重新打开回「待评审」；其他关闭恢复后回到「已通过」，需要重新排期。已完成需求不能直接关闭；需先撤回完成证据（工作项重开、用例失败或发布回滚）让需求退回已排期。", "mute"],
    ["约束", "排期不能选已发布、已关闭或已取消的版本；人工交付判定只能补充已完成需求，绑定当前目标版本，换版本即失效。", "warn"]
  ],
  note: "每次流转都会写需求日志并通知相关人；关闭与撤销排期都不会修改关联工作项的日期或版本。",
  image: "diagrams/demand-main-state.png",
  imageAlt: "沙漏·需求主状态机：待评审 → 已通过 → 已排期 → 已完成 → 已关闭，关闭后可重新打开回到原流程",
  imageCaption: "需求主状态机（点击图放大）：实线是主链推进，虚线是关闭 / 重新打开。"
};
/* 交付阶段「?」：在已排期 / 已完成内出现，阶段由派生条件决定 */
var DEMAND_STAGE_HELP = {
  title: "交付阶段怎么变",
  rows: [
    ["待开工", "排期完成后的默认阶段，还没有任何开工证据。", "mute"],
    ["推进中", "任一关联工作项移出「待处理」即触发：看板拖动、开始计时 / 补记工时，或创建时就不在「待处理」。开工是历史事实，之后拖回「待处理」也不会退回。", "type-story"],
    ["待发布", "需求进入「已完成」后，还没有成功生产发布或人工交付判定。", "warn"],
    ["已交付", "发布记录里有该需求，且是成功的正式生产发布、未回滚；或人工判定为已交付。", "ok"],
    ["回退", "工作项重开或用例失败 → 需求退回「已排期」，阶段回到推进中 / 待开工；发布回滚 → 回到「待发布」。", "mute"],
    ["人工判定", "只能补「待发布 / 已交付」，绑定当前目标版本；一旦检测到真实生产发布，或换了目标版本，人工判定不再生效。", "warn"]
  ],
  note: "阶段实时计算、不落库，只在「已排期 / 已完成」上出现。优先级：真实发布 > 人工已交付 > 待发布；开工证据只决定已排期内的推进中。"
};
registerHelp({ "demands.flow": DEMAND_FLOW_HELP, "demands.stage": DEMAND_STAGE_HELP });
initCaliberHelp();
var PRI_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
var STATUS_ORDER = { review: 0, pass: 1, plan: 2, done: 3, closed: 4, rej: 4, canceled: 4 };
/* P0 的排序值是 0，不能用 || 兜底，否则会被当成最低优先级 */
function priRank(p){ return PRI_ORDER[p] === undefined ? 9 : PRI_ORDER[p]; }
var demands = [];
var demandBoard = null;        /* 看板：{status: {items, matched, hasMore}, counts, stageCounts, doneStageCounts, totalAll} */
var demandColExtra = {};       /* 看板列已滚动加载的追加条目 */
/* 三种形态查询口径不同，切回来时先用上次结果顶上，再静默补差，避免闪骨架 */
var demandViewCache = { board: null, table: null, gantt: null };
var demBoardStage = "all";
var demBoardBar = null, demBoardInput = null, demBoardTimer = null;
/* 工作页两种形态：卡片保留上下文，列表一屏扫完一个批次。只记本机，不占用服务端列表偏好
   DEM_WORK_LAYOUTS 必须先于 demWork 初始化，否则 demWorkLayoutPref() 读到 undefined 直接抛错 */
var DEM_WORK_LAYOUTS = ["card", "list"];
var demWork = {
  active:false, status:"plan", stage:"all", reqId:null, q:"", pris:[],
  versionId:"all", closeReason:"all", closeStage:"all", focus:"all",
  group:"version", sort:"expect", layout:demWorkLayoutPref(),
  items:[], total:0, hasMore:false,
  response:null, seq:0, timer:null
};
function demWorkLayoutPref(){
  var v = "";
  try{ v = localStorage.getItem("ds.demWork.layout"); }catch(e){ return "card"; }
  return DEM_WORK_LAYOUTS.indexOf(v) >= 0 ? v : "card";
}
function setDemWorkLayout(v){
  if(DEM_WORK_LAYOUTS.indexOf(v) === -1 || demWork.layout === v) return;
  demWork.layout = v;
  try{ localStorage.setItem("ds.demWork.layout", v); }catch(e){ /* 受限环境忽略 */ }
  render();
}
function demWorkLayoutSegHTML(){
  var names = { card:"卡片", list:"列表" };
  return '<div class="seg mini dem-work-layout" role="group" aria-label="工作页展示形态">' + DEM_WORK_LAYOUTS.map(function(k){
    return '<button type="button" data-dem-work-layout="' + k + '" aria-pressed="' + (demWork.layout === k) + '">' + names[k] + '</button>';
  }).join("") + '</div>';
}
var demandTotal = 0;           /* 列表模式：当前筛选下的总数 */
var demandHasMore = false;
var demandServerFiltered = false;
var DEMAND_BOARD_PAGE = 50;
var DEMAND_TABLE_PAGE = 100;
var DEMAND_GANTT_PAGE = 100;
var DEMAND_GANTT_MAX_DAYS = 730;
/* 与服务端 DemandSaveRequest.source 的 @Size(max=40) 对齐 */
var DEMAND_SOURCE_MAX = 40;
/* 条内要放下「开发 12天+」这类文字所需的最小宽度 */
var DEMG_SEG_LABEL_MIN_W = 68;
var DEM_STAGE_ORDER = ["review", "plan", "design", "dev", "test", "complete", "release"];
var DEM_STAGE_NAMES = { review:"评审", plan:"排期", design:"设计", dev:"开发", test:"测试", complete:"完成", release:"发布" };
var DEM_STAGE_COLORS = { review:"var(--text-3)", plan:"var(--info)", design:"var(--plum)", dev:"var(--primary)", test:"var(--warning)", complete:"var(--success)", release:"var(--success)" };
var demGantt = { scale:"day", zoomDayW:28, rangeMode:"auto", anchorMonth:null, range:null, dayW:28, scrollLeft:0, scrolled:false, notice:"" };
var versions = [];           /* 当前项目的版本（目标版本展示/排期选择） */
var versionNames = {};       /* 列表模式：全空间 versionId → 名称 */
var editingDemandId = null;
var planDemandId = null;
var demandDetailLayer = null;  /* 当前打开的需求详情，供动作成功后一并关闭 */
var demandCommentReplyTo = null;   /* 当前回复的顶层评论 ID（一层回复） */
var demandCommentMention = null;   /* 详情内发表评论的 @ 提及选择器 */
var demandOverviewMention = null;  /* 概览「讨论」里快速记录的 @ 提及选择器 */
var editingDemandRevision = null, editingPlannedStart = null, editingPlannedEnd = null, editingDemandStatus = null;
var editingDemandReqId = null;  /* 打开编辑时的所属项目，保存成功据此判断是否发生了迁移 */
var planDemandRevision = null, planAction = "plan";
/* 排期弹窗内联带入：候选按所选版本懒加载，提交时先排期再补关联 */
var planTaskState = { seq:0, versionId:"", loaded:false, loading:false, items:[], selected:{}, query:"", total:0 };
var formPri = "P2";
var dragSrc = null;           /* 拖动中的卡片 { id, status, canSchedule } */
var dragOverCol = null;       /* 最近悬停的列：drop 未触发时用 dragend 兜底提示 */
/* 项目页「查看需求池」的跨视图定位参数；enterDemandsView 应用后清空 */
var pendingFocusReq = null;

function isOwner(){ return !!(rt.currentWs && rt.currentWs.myRole === "owner"); }
/* 需求写权限跟随所属项目：成员在只读项目下不显示/不放行任何写入口 */
function canWriteDemand(d){ return !!d && canEditReq(d.reqId); }
/* 评审流转与服务端一致，按所属项目写权限；删除仍仅空间主，排期另按 canSchedule */
function canReviewDemand(d){ return canWriteDemand(d); }
/* 可认领 = 待评审 + 未指派 + 我可写 + 非本人提交；服务端还会做同一组校验 */
function canClaimDemandReview(d){
  return !!d && d.status === "review" && !d.reviewerUserId && canReviewDemand(d) &&
    (!rt.currentUser || d.createdBy !== rt.currentUser.id);
}
function canScheduleDemand(d){ return !!d && d.canSchedule === true; }
function denySchedule(){ toast("仅空间主、管理员或可写项目负责人可管理需求排期", "warn"); }
function plannedText(d){
  if(!d || (!d.plannedStart && !d.plannedEnd)) return "";
  return (d.plannedStart || "未定") + " → " + (d.plannedEnd || "未定");
}
function denyDemandReadOnly(){ toast("你对该项目只有查看权限", "warn"); }
function writableReqs(){ return rt.reqList.filter(function(r){ return canEditReq(r.id); }); }
function statusName(st){
  if(st === "rej") return "已关闭 · 评审不通过";
  if(st === "canceled" || st === "cancelled") return "已关闭 · 中途取消";
  for(var i = 0; i < COLS.length; i++) if(COLS[i][0] === st) return COLS[i][1];
  return st;
}
function deliveryStageName(stage){
  for(var i = 0; i < DELIVERY_STAGES.length; i++) if(DELIVERY_STAGES[i][0] === stage) return DELIVERY_STAGES[i][1];
  return stage || "";
}
/* 派生阶段按主状态分组：已排期只看开工前后，已完成只看待发布/已交付 */
var DEM_STAGE_GROUPS = { plan:["waiting", "active"], done:["donePending", "delivered"] };
function demStageKeys(status){ return DEM_STAGE_GROUPS[status] || []; }
function demStageCounts(status){
  var src = status === "done" ? (demandBoard && demandBoard.doneStageCounts)
    : status === "plan" ? (demandBoard && demandBoard.stageCounts) : null;
  return src || {};
}
function closeReasonName(reason){ return CLOSE_REASONS[reason] || reason || "未记录原因"; }
function closeStageName(stage){ return CLOSE_STAGES[stage] || "待评审"; }
function restoreTargetName(d){ return d && d.closeStage === "review" ? "待评审" : "已通过"; }
function isClosedDemand(d){ return !!d && (d.status === "closed" || d.status === "rej" || d.status === "canceled" || d.status === "cancelled"); }
function versionName(id){
  if(!id) return "";
  for(var i = 0; i < versions.length; i++) if(versions[i].id === id) return versions[i].name;
  return versionNames[id] || "";
}
function demandVersionName(d){
  return d && (d.versionName || versionName(d.versionId)) || "";
}
/* 期望交付相对今天的天数：正数未到期，0 今天，负数已逾期 */
function demandExpectDelta(d){
  if(!d || !d.expectDate) return null;
  var t = new Date(String(d.expectDate).substring(0, 10) + "T00:00:00");
  if(isNaN(t.getTime())) return null;
  var now = new Date();
  return Math.round((t - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
function demandExpectNote(d){
  if(!d || !d.expectDate) return "尚未评估";
  if(isClosedDemand(d)) return "已关闭";
  var delta = demandExpectDelta(d);
  if(delta === null) return "日期待确认";
  if(delta > 1) return delta + " 天后交付";
  if(delta === 1) return "明天交付";
  if(delta === 0) return "今天交付";
  return "已逾期 " + (-delta) + " 天";
}
function demandShortDay(s){ return s ? String(s).substring(5, 10) : "未定"; }
function wsjfText(d){
  if(d.wsjfScore === null || d.wsjfScore === undefined) return "";
  return "WSJF " + (Math.round(d.wsjfScore * 10) / 10);
}

/* ---------- 加载 ---------- */

function syncReqSel(){
  if(!demandReq) return;
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === rt.demandReqId; });
  demandReq.innerHTML = '<option value="">全部项目</option>' + projectOptionsHTML(list, rt.demandReqId);
  demandReq.value = rt.demandReqId || "";
}
var demandLoadSeq = 0;
function readDemandRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var q = raw.indexOf("?");
  var name = q >= 0 ? raw.substring(0, q) : raw;
  var params = new URLSearchParams(q >= 0 ? raw.substring(q + 1) : "");
  var status = params.get("status");
  var valid = COLS.some(function(c){ return c[0] === status; });
  if(name !== "demands" || !valid){
    if(demWork.active){ demWork.active = false; demWork.seq++; }
    return false;
  }
  if(!demWork.active || demWork.status !== status){
    demWork.reqId = rt.demandReqId || null;
    demWork.q = demSmart.q || "";
    demWork.pris = demSmart.pris.slice();
    demWork.versionId = "all";
    demWork.closeReason = "all";
    demWork.closeStage = "all";
    demWork.focus = "all";
    demWork.group = status === "plan" || status === "done" ? "version" : (status === "closed" ? "reason" : "project");
    demWork.sort = status === "pass" ? "wsjf" : (status === "closed" ? "created" : "expect");
  }
  demWork.active = true;
  demWork.status = status;
  var stage = params.get("stage") || "all";
  demWork.stage = demStageKeys(status).indexOf(stage) >= 0 ? stage : "all";
  demWork.items = [];
  demWork.response = null;
  return true;
}
function demandWorkHash(status, stage){
  var keepStage = demStageKeys(status).indexOf(stage) >= 0;
  return "#/demands?status=" + encodeURIComponent(status) + (keepStage ? "&stage=" + encodeURIComponent(stage) : "");
}
/* 视图 = 同一批需求的展示形态（看板/列表/甘特），走地址栏而不是二级菜单：
   ?view= 可分享，也避免「子导航高亮」和「分段选中」两套状态各说各话 */
var DEM_MODES = ["board", "table", "gantt"];
function readDemandViewParam(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var q = raw.indexOf("?");
  var name = q >= 0 ? raw.substring(0, q) : raw;
  if(name !== "demands" || q < 0) return null;
  var view = new URLSearchParams(raw.substring(q + 1)).get("view");
  return DEM_MODES.indexOf(view) !== -1 ? view : null;
}
function demandViewHash(mode){ return "#/demands?view=" + encodeURIComponent(mode); }
/* 看板只有「全部 / 单个项目」，列表与甘特用多项目筛选。
   以 demSmart.reqs 为准对齐看板聚焦：0 个或 2 个以上都回到全部，1 个则聚焦该项目。 */
function syncBoardScopeFromReqs(){
  rt.demandReqId = demSmart.reqs.length === 1 ? demSmart.reqs[0] : null;
  return rt.demandReqId;
}
function switchDemandMode(m){
  if(DEM_MODES.indexOf(m) === -1 || m === listPrefs.viewMode("demand-pool")) return;
  if(m === "board" && !demWork.active){
    syncBoardScopeFromReqs();
    if(rt.reqsLoaded) syncReqSel();
    if(demSmart.reqs.length > 1){
      toast("看板只能看全部或单个项目，已回到「全部项目」；列表与甘特的项目筛选仍保留", "warn");
    }
  }
  /* 先本机生效再后台保存：网络慢或保存失败时，视图切换不应卡住或回退 */
  listPrefs.setViewModeLocal("demand-pool", m);
  try{ history.replaceState(null, "", demandViewHash(m)); }
  catch(e){ /* 受限环境保留原 hash，视图仍可切换 */ }
  if(applyDemandCache(m)) loadDemands({ silent: true });
  else loadDemands();
  listPrefs.setViewMode("demand-pool", m).catch(function(ex){
    toast("视图偏好未保存，本次切换仍生效：" + (ex.message || "网络异常"), "warn");
  });
}
function openDemandWorkpage(status, stage){
  if(!COLS.some(function(c){ return c[0] === status; })) return;
  var fromWork = demWork.active;
  var reqId = fromWork ? demWork.reqId : (rt.demandReqId || null);
  var q = fromWork ? demWork.q : (demSmart.q || "");
  var pris = fromWork ? demWork.pris.slice() : demSmart.pris.slice();
  demWork.active = false;
  demWork.status = status;
  demWork.reqId = reqId;
  demWork.q = q;
  demWork.pris = pris;
  demWork.versionId = "all";
  demWork.closeReason = "all";
  demWork.closeStage = "all";
  demWork.focus = "all";
  demWork.group = status === "plan" || status === "done" ? "version" : (status === "closed" ? "reason" : "project");
  demWork.sort = status === "pass" ? "wsjf" : (status === "closed" ? "created" : "expect");
  demWork.active = true;
  demWork.stage = demStageKeys(status).indexOf(stage) >= 0 ? stage : "all";
  demWork.items = [];
  demWork.response = null;
  try{ history.pushState(null, "", demandWorkHash(status, demWork.stage)); }
  catch(e){ window.location.hash = demandWorkHash(status, demWork.stage); }
  loadDemands();
}
function returnDemandBoard(){
  demWork.active = false;
  demWork.seq++;
  var h = demandViewHash(listPrefs.viewMode("demand-pool"));
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  loadDemands();
}
function loadDemands(opts){
  var silent = !!(opts && opts.silent);
  var seq = ++demandLoadSeq;
  var mode = listPrefs.viewMode("demand-pool");
  syncModeUI(mode);
  if(demWork.active){ loadDemandWorkpage(); return; }
  if(mode === "gantt"){ loadDemandGantt(silent); return; }
  if(mode === "table"){ loadAllDemands(silent); return; }
  if(!rt.reqList.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目，需求池按项目收纳需求。"
    });
    if(demandsMeta) demandsMeta.textContent = "";
    return;
  }
  var reqId = rt.demandReqId;
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!silent) demandBody.innerHTML = UI.skeletonRows(2);
  /* 「全部项目」没有版本清单可拉：卡片版本名由列表行自带，排期对话框按需求所属项目现查 */
  Promise.all([
    API.get("/api/demands/board", {
      reqId: reqId, limit: DEMAND_BOARD_PAGE,
      q: demSmart.q || null,
      pris: demSmart.pris.join(","),
      kinds: demSmart.kinds.join(","),
      cats: demSmart.cats.join(","),
      deliveryStage: demBoardStage === "all" ? null : demBoardStage
    }),
    reqId ? API.get("/api/versions", { reqId: reqId }) : Promise.resolve([])
  ]).then(function(rs){
    if(seq !== demandLoadSeq || rt.demandReqId !== reqId) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    if(listPrefs.viewMode("demand-pool") !== "board") return;
    demandBoard = rs[0].columns || {};
    /* 计数附在列映射上，供元信息与紧凑搜索条共用；列遍历只按 COLS 取键 */
    demandBoard.counts = rs[0].counts || {};
    demandBoard.stageCounts = rs[0].stageCounts || {};
    demandBoard.doneStageCounts = rs[0].doneStageCounts || {};
    demandBoard.totalAll = rs[0].totalAll || 0;
    demandBoard.facets = rs[0].facets || null;
    demandServerFiltered = false;
    demandColExtra = {};
    demands = [];
    COLS.forEach(function(c){
      var col = demandBoard[c[0]];
      if(col) demands = demands.concat(col.items || []);
    });
    versions = rs[1];
    saveDemandCache("board");
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
/* 视图缓存：签名一致才复用，筛选、项目或项目空间一变就重新拉 */
function demandCacheSig(mode){
  return JSON.stringify([
    mode,
    (rt.currentWs && rt.currentWs.id) || "",
    rt.demandReqId || "",
    demSmart.preset, demSmart.q || "", demSmart.pris.join(","),
    demSmart.kinds.join(","), demSmart.cats.join(","), demSmart.reqs.join(","),
    demSmart.sort, demSmart.sortDir,
    mode === "board" ? demBoardStage : ""
  ]);
}
function saveDemandCache(mode){
  demandViewCache[mode] = {
    sig: demandCacheSig(mode),
    board: demandBoard,
    demands: demands.slice(),
    versions: versions.slice(),
    versionNames: versionNames,
    colExtra: demandColExtra,
    total: demandTotal,
    hasMore: demandHasMore,
    serverFiltered: demandServerFiltered
  };
}
function applyDemandCache(mode){
  var c = demandViewCache[mode];
  if(!c || c.sig !== demandCacheSig(mode)) return false;
  demandBoard = c.board;
  demands = c.demands.slice();
  versions = c.versions.slice();
  versionNames = c.versionNames;
  demandColExtra = c.colExtra;
  demandTotal = c.total;
  demandHasMore = c.hasMore;
  demandServerFiltered = c.serverFiltered;
  demandLoadSeq++;   /* 切换前还没回来的请求不再覆盖当前形态 */
  render();
  return true;
}
/* 供项目页等外部视图跳转：进入需求池并定位到指定项目（看板模式选项目、列表模式带项目筛选） */
function openDemandsForReq(reqId){
  pendingFocusReq = reqId || null;
}
function enterDemandsView(){
  var flowMark = $("demandFlowHelp");
  if(flowMark && !flowMark.firstChild) flowMark.innerHTML = caliberMarkHTML("demands.flow", false, "查看需求状态与流转说明");
  initDemSmartBar();
  restoreDemState();
  syncBoardScopeFromReqs();
  readDemandRoute();
  /* 项目页「查看需求池」携带的项目定位：恢复本地视图状态后应用，避免被快照覆盖 */
  if(pendingFocusReq){
    rt.demandReqId = pendingFocusReq;
    demSmart.reqs = [pendingFocusReq];
    saveDemState();
    pendingFocusReq = null;
  }
  /* ?view= 只覆盖本次会话，在 listPrefs.load 之后应用，免得被服务端偏好盖回去 */
  var routeMode = readDemandViewParam();
  syncDemControls();
  syncDemandsPageHead();
  /* 浏览器可能无视 autocomplete，把上次搜索词直接写回输入框；以 demSmart.q 为准清理 */
  [0, 300, 1000, 2000, 4000].forEach(function(ms){ setTimeout(reconcileDemSearchInputs, ms); });
  loadViews().then(renderDemTabs);
  /* 全局「新建」菜单 / 首屏引导的跨视图创建：#/demands?new=1 进入即开提需求弹窗 */
  if(/[?&]new=1(&|$)/.test(String(window.location.hash || ""))){
    try{ window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/demands"); }catch(e){ /* noop */ }
    loadViews().then(function(){ if(activeView === "demands") openDemandDialog(null); });
  }
  /* 分类字典平时由看板加载；直接进需求池时这里补一次，否则分类列与分类筛选都拿不到候选 */
  var catSig = JSON.stringify(rt.categoriesCache || []);
  loadCategories().then(function(){
    if(activeView !== "demands" || !demands.length) return;
    if(JSON.stringify(rt.categoriesCache || []) !== catSig) render();
  });
  /* 视图偏好返回之前先铺骨架：慢网下否则会留一整块空白等 /api/list-preferences */
  if(demandBody && !demandBody.firstElementChild) demandBody.innerHTML = UI.skeletonRows(2);
  listPrefs.load("demand-pool").then(function(){
    if(routeMode) listPrefs.setViewModeLocal("demand-pool", routeMode);
    if(rt.reqsLoaded){
      syncReqSel();
      loadDemands();
    }else{
      demandBody.innerHTML = UI.skeletonRows(2);
      loadReqs().then(function(){
        syncReqSel();
        loadDemands();
      });
    }
  });
}
/* 列表模式：跨项目分页展示，筛选/排序/分组在服务端完成，前端只渲染已加载页 */
function demandPageParams(offset, limit){
  return {
    status: demSmart.preset === "all" ? null : demSmart.preset,
    q: demSmart.q || null,
    pris: demSmart.pris.join(","),
    kinds: demSmart.kinds.join(","),
    cats: demSmart.cats.join(","),
    reqs: demSmart.reqs.join(","),
    sort: demSmart.sort,
    offset: offset,
    limit: limit
  };
}
function mergeLoadedDemands(items){
  var known = {};
  demands.forEach(function(d){ known[d.id] = 1; });
  (items || []).forEach(function(d){ if(!known[d.id]) demands.push(d); });
}
function loadAllDemands(silent){
  if(!rt.reqList.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目，需求池按项目收纳需求。"
    });
    if(demandsMeta) demandsMeta.textContent = "";
    return;
  }
  var seq = ++demandLoadSeq;
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!silent) demandBody.innerHTML = UI.skeletonRows(2);
  API.get("/api/demands/page", demandPageParams(0, DEMAND_TABLE_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    demandServerFiltered = true;
    demandBoard = null;
    demands = (page.items || []).slice();
    demandTotal = page.total || 0;
    demandHasMore = !!page.hasMore;
    versions = [];
    if(listPrefs.viewMode("demand-pool") !== "table") return;
    saveDemandCache("table");
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
/* 行内编辑后的刷新：不闪骨架，按已加载深度补齐分页，并还原滚动位置。
   服务端单页上限 100，加载超过一页时要继续取，否则改一个字段就把列表塌回第一页。 */
function refreshDemandsInline(){
  if(demWork.active || listPrefs.viewMode("demand-pool") !== "table"){ loadDemands({ silent:true }); return; }
  var depth = Math.max(DEMAND_TABLE_PAGE, demands.length);
  var view = demandBody.closest(".view");
  var wrap = demandBody.querySelector(".tbl-wrap");
  var top = view ? view.scrollTop : 0;
  var left = wrap ? wrap.scrollLeft : 0;
  var seq = ++demandLoadSeq;
  var wsId = rt.currentWs && rt.currentWs.id;
  var acc = [];
  function step(){
    return API.get("/api/demands/page", demandPageParams(acc.length, DEMAND_TABLE_PAGE)).then(function(page){
      if(seq !== demandLoadSeq) return;
      if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
      acc = acc.concat(page.items || []);
      demandTotal = page.total || 0;
      demandHasMore = !!page.hasMore;
      if(demandHasMore && acc.length < depth) return step();
      if(listPrefs.viewMode("demand-pool") !== "table") return;
      demandServerFiltered = true;
      demandBoard = null;
      demands = acc;
      versions = [];
      saveDemandCache("table");
      render();
      var v = demandBody.closest(".view");
      if(v) v.scrollTop = top;
      var w = demandBody.querySelector(".tbl-wrap");
      if(w) w.scrollLeft = left;
    });
  }
  step().catch(function(){ loadDemands({ silent:true }); });
}
/* 列表「加载更多」：按当前筛选条件追加下一页 */
function loadMoreDemandTable(){
  if(!demandHasMore) return Promise.resolve(false);
  var seq = demandLoadSeq;
  var btn = demandBody.querySelector("[data-dem-more]");
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  return API.get("/api/demands/page", demandPageParams(demands.length, DEMAND_TABLE_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return false;
    mergeLoadedDemands(page.items);
    demandTotal = page.total || demandTotal;
    demandHasMore = !!page.hasMore;
    render();
    return true;
  }).catch(function(ex){
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
/* 看板单列「加载更多」 */
function loadMoreDemandColumn(status){
  var col = demandBoard && demandBoard[status];
  if(!col || !col.hasMore) return Promise.resolve(false);
  var extra = demandColExtra[status] = demandColExtra[status] || [];
  var seq = demandLoadSeq;
  var reqId = rt.demandReqId;
  return API.get("/api/demands/page", {
    reqId: reqId, status: status, offset: col.items.length + extra.length,
    limit: DEMAND_BOARD_PAGE,
    q: demSmart.q || null,
    pris: demSmart.pris.join(","),
    kinds: demSmart.kinds.join(","),
    cats: demSmart.cats.join(","),
    deliveryStage: demStageKeys(status).indexOf(demBoardStage) >= 0 ? demBoardStage : null
  }).then(function(page){
    if(seq !== demandLoadSeq || rt.demandReqId !== reqId) return false;
    var known = {};
    col.items.concat(extra).forEach(function(d){ known[d.id] = 1; });
    (page.items || []).forEach(function(d){
      if(!known[d.id]){ extra.push(d); demands.push(d); }
    });
    col.hasMore = (col.items.length + extra.length) < page.total;
    render();
    return true;
  }).catch(function(ex){
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function reloadDemands(){
  /* 需求排期会改变版本的「待规划需求」统计，这里只重拉需求与版本名；
     写完数据后三种形态的缓存都可能过期，一并作废 */
  demandViewCache = { board: null, table: null, gantt: null };
  loadDemands();
}

/* ---------- 甘特：加载（跨项目，筛选/排序在服务端） ---------- */

function mergeGanttItems(items){
  var known = {};
  demands.forEach(function(d){ known[d.id] = 1; });
  (items || []).forEach(function(it){
    if(!it || !it.demand || known[it.demand.id]) return;
    it.demand.__timeline = it.timeline || null;
    demands.push(it.demand);
    known[it.demand.id] = 1;
  });
}
function loadDemandGantt(silent){
  if(!rt.reqList.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目，需求池按项目收纳需求。"
    });
    if(demandsMeta) demandsMeta.textContent = "";
    return;
  }
  var seq = ++demandLoadSeq;
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!silent) demandBody.innerHTML = UI.skeletonRows(3);
  API.get("/api/demands/gantt", demandPageParams(0, DEMAND_GANTT_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    demandServerFiltered = true;
    demandBoard = null;
    demands = [];
    mergeGanttItems(page.items);
    demandTotal = page.total || 0;
    demandHasMore = !!page.hasMore;
    if(listPrefs.viewMode("demand-pool") !== "gantt") return;
    saveDemandCache("gantt");
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
function loadMoreDemandGantt(){
  if(!demandHasMore) return Promise.resolve(false);
  var seq = demandLoadSeq;
  var btn = demandBody.querySelector('[data-dem-more="gantt"]');
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  return API.get("/api/demands/gantt", demandPageParams(demands.length, DEMAND_GANTT_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return false;
    mergeGanttItems(page.items);
    demandTotal = page.total || demandTotal;
    demandHasMore = !!page.hasMore;
    render();
    return true;
  }).catch(function(ex){
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    render();
    return false;
  });
}

/* ---------- 看板渲染 ---------- */

function syncModeUI(mode){
  document.querySelectorAll("[data-dem-mode]").forEach(function(b){
    var on = b.dataset.demMode === mode;
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(demandReq) demandReq.hidden = demWork.active || mode !== "board";
  var bc = $("btnDemandColumns");
  if(bc) bc.hidden = demWork.active || mode !== "table";
  /* 工作页自带筛选与分组，不叠加看板/列表工具条 */
  if(demSmartBar) demSmartBar.hidden = demWork.active || mode === "board";
  if(demBoardBar) demBoardBar.hidden = demWork.active || mode !== "board";
  if(demandGanttBar) demandGanttBar.hidden = demWork.active || mode !== "gantt";
  if(demandGanttHelp) demandGanttHelp.hidden = demWork.active || mode !== "gantt";
  if(demandsPage){
    demandsPage.classList.toggle("dem-work-active", demWork.active);
    demandsPage.classList.toggle("dem-gantt", !demWork.active && mode === "gantt");
    var vw = demandsPage.closest(".view");
    if(vw) vw.classList.toggle("is-dem-gantt", !demWork.active && mode === "gantt");
  }
  if(demandBody) demandBody.classList.toggle("demg-body", !demWork.active && mode === "gantt");
  /* 只读项目不显示「提需求」；列表/甘特为全空间，只要有一个可写项目即可；
     看板「全部项目」同全空间口径，聚焦到只读项目时维持隐藏 */
  var bn = $("btnDemandNew");
  if(bn) bn.style.display = (!demWork.active && writableReqs().length
    && (mode !== "board" || (!rt.demandReqId || canEditReq(rt.demandReqId)))) ? "" : "none";
  syncDemGanttControls();
  syncDemBoard();
}
function deliveryStageTag(stage, source){
  if(!stage) return "";
  var manual = source === "manual";
  var tip = manual ? "人工判定；真实发布证据优先"
    : source === "release" ? "由真实生产发布记录派生"
    : "由工作项、用例与发布记录自动派生";
  return '<span class="tag dem-stage-tag st-' + esc(stage) + (manual ? " manual" : "") + '" title="'
    + esc(tip) + '">' + esc(deliveryStageName(stage)) + (manual ? " · 人工" : "") + '</span>';
}
/* 列内阶段胶囊：已排期只放待开工/推进中，已完成只放待发布/已交付；点击进入对应工作页 */
function demandBoardDistHTML(status){
  var counts = demStageCounts(status);
  var keys = demStageKeys(status);
  var total = keys.reduce(function(n, k){ return n + (Number(counts[k]) || 0); }, 0);
  if(!total) return "";
  var target = status === "done" ? "完成工作台" : "交付工作台";
  return '<div class="demb-dist-row"><span class="demb-dist-label">交付阶段</span>'
    + '<div class="demb-dist" role="group" aria-label="' + esc(status === "done" ? "已完成交付阶段" : "已排期交付阶段") + '">' + keys.map(function(k){
    var n = Number(counts[k]) || 0;
    if(!n) return "";
    return '<button type="button" class="demb-dist-seg st-' + k + (demBoardStage !== "all" && demBoardStage !== k ? " dim" : "")
      + '" style="flex:' + n + ' 1 0" data-dem-open="' + status + '" data-dem-stage="' + k + '" title="' + esc(deliveryStageName(k)) + ' ' + n + ' 条，点击进入' + target + '" aria-label="' + esc(deliveryStageName(k)) + ' ' + n + ' 条"></button>';
  }).join("") + '</div></div>';
}
function demBoardStageOptionsHTML(){
  return '<option value="all"' + (demBoardStage === "all" ? " selected" : "") + '>全部阶段</option>'
    + [["plan", "已排期"], ["done", "已完成"]].map(function(g){
      return '<optgroup label="' + g[1] + '">' + demStageKeys(g[0]).map(function(k){
        return '<option value="' + k + '"' + (demBoardStage === k ? " selected" : "") + '>'
          + esc(deliveryStageName(k)) + ' ' + (Number(demStageCounts(g[0])[k]) || 0) + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
}
function demBoardStageFilterHTML(){
  return '<select class="mini-select demb-stage-filter' + (demBoardStage !== "all" ? " active" : "") + '" data-demb-stage aria-label="按交付阶段筛选已排期或已完成列">'
    + demBoardStageOptionsHTML() + '</select>';
}
function render(){
  var mode = listPrefs.viewMode("demand-pool");
  syncModeUI(mode);
  syncDemandsPageHead();
  if(demWork.active){ renderDemandWorkpage(); return; }
  if(mode === "gantt"){ renderDemandGantt(); return; }
  if(mode === "table"){ renderDemandTable(); return; }
  if(demandsMeta){
    /* 条数只放页头胶囊；这里不再重复「共 N 条」 */
    demandsMeta.textContent = "";
  }
  if(!demands.length && !versions.length && !demandBoard){
    demandBody.innerHTML = UI.emptyState({
      icon:"inbox", title:"需求池还是空的",
      text:"点右上角「新建需求」录入第一条；评审通过后排期到版本。"
    });
    return;
  }
  demandBody.innerHTML = '<div class="bkl">' + COLS.map(function(c){
    var status = c[0], col = (demandBoard && demandBoard[status]) || {items:[], matched:0, hasMore:false};
    var extra = demandColExtra[status] || [];
    var items = (col.items || []).concat(extra);
    /* 阶段筛选只落在阶段所属的列：待开工/推进中筛已排期，待发布/已交付筛已完成 */
    var filtered = demStageKeys(status).indexOf(demBoardStage) >= 0;
    var more = col.hasMore
      ? '<button class="bkl-more" type="button" data-dem-more="' + esc(status) + '">加载更多（还有 '
        + Math.max((col.matched || 0) - items.length, 0) + ' 条）</button>'
      : "";
    return '<div class="bkl-col" data-col="' + status + '"><div class="bkl-head">'
      + '<button class="bkl-title bkl-title-link" type="button" data-dem-open="' + status + '" style="--c:' + c[2] + '" title="' + esc(STATUS_HINTS[status] || "") + '">'
      + '<i class="bkl-dot" style="background:' + c[2] + '" aria-hidden="true"></i><span>' + c[1] + '</span><span class="bkl-open" aria-hidden="true">↗</span></button>'
      + (status === "plan" || status === "done" ? caliberMarkHTML("demands.stage", false, "查看交付阶段如何变化") : "")
      + '<span class="bkl-count">' + (filtered ? (col.matched || 0) + " / " + ((demandBoard.counts || {})[status] || 0) : (col.matched || 0)) + '</span></div>'
      + (status === "plan" || status === "done" ? demandBoardDistHTML(status) : "")
      + (demBoardCardsHTML(items) || '<div class="foot-note demb-col-empty">'
        + (filtered ? '该阶段暂无需求<br><button type="button" class="link-btn" data-demb-stage-clear>显示全部阶段</button>' : (demBoardHasCond() ? "没有匹配需求" : "暂无需求")) + '</div>')
      + more
      + '</div>';
  }).join("") + '</div>';
}
/* 全部项目模式下按项目分泳道，泳道头即项目名，卡片不再重复；聚焦项目时直接平铺。
   选了分组维度时改用维度组头（BOARD-5），项目不再作为默认泳道。 */
function demBoardCardsHTML(items){
  if(!items.length) return "";
  if(demSmart.group !== "none") return demDimLanesHTML(items);
  return items.map(cardHTML).join("");
  return demBoardLanes(items).map(function(g){
    return '<div class="bkl-lane"><div class="bkl-lane-head"><span class="bkl-lane-name">' + esc(g.label) + '</span>'
      + '<span class="bkl-lane-count">' + g.rows.length + ' 条</span></div>'
      + g.rows.map(function(d){ return cardHTML(d); }).join("") + '</div>';
  }).join("");
}
function demDimLanesHTML(items){
  var dim = demSmart.group, subDim = demSubDim();
  var groups = [], byKey = {};
  items.forEach(function(d){
    var info = demGroupInfoBy(d, dim), g = byKey[info.key];
    if(!g){ g = {key:info.key, label:info.label, rows:[], subs:[], subByKey:{}}; byKey[info.key] = g; groups.push(g); }
    g.rows.push(d);
    if(subDim !== "none"){
      var si = demGroupInfoBy(d, subDim), s = g.subByKey[si.key];
      if(!s){ s = {key:si.key, label:si.label, rows:[]}; g.subByKey[si.key] = s; g.subs.push(s); }
      s.rows.push(d);
    }
  });
  groups.sort(demGroupCompare(dim));
  groups.forEach(function(g){ g.subs.sort(demGroupCompare(subDim)); });
  return groups.map(function(g){
    var body = subDim === "none"
      ? g.rows.map(function(d){ return cardHTML(d); }).join("")
      : g.subs.map(function(s){
          return '<div class="bkl-lane is-dim is-sub"><div class="bkl-lane-head"><span class="bkl-lane-name">' + esc(s.label) + '</span>'
            + '<span class="bkl-lane-count">' + s.rows.length + ' 条</span></div>'
            + s.rows.map(function(d){ return cardHTML(d); }).join("") + '</div>';
        }).join("");
    return '<div class="bkl-lane is-dim"><div class="bkl-lane-head"><span class="bkl-lane-name">' + esc(g.label) + '</span>'
      + '<span class="bkl-lane-count">' + g.rows.length + ' 条</span></div>' + body + '</div>';
  }).join("");
}
/* 泳道顺序跟随项目选择器（空间 sort_order），不在 reqList 的项目兜底排最后 */
function demBoardLanes(items){
  var groups = {}, order = [];
  items.forEach(function(d){
    var key = d.reqId || "__none";
    if(!groups[key]){ groups[key] = []; order.push(key); }
    groups[key].push(d);
  });
  var rank = {};
  rt.reqList.forEach(function(r, i){ rank[r.id] = i; });
  order.sort(function(a, b){
    var ai = rank[a] === undefined ? 9999 : rank[a], bi = rank[b] === undefined ? 9999 : rank[b];
    if(ai !== bi) return ai - bi;
    return demBoardLaneLabel(a).localeCompare(demBoardLaneLabel(b), "zh-CN");
  });
  return order.map(function(k){ return { key:k, label:demBoardLaneLabel(k), rows:groups[k] }; });
}
function demBoardLaneLabel(key){
  return key === "__none" ? "未归类" : (reqNameById(key) || "未命名项目");
}
/* 行内只保留当前状态的主操作，其余动作收进“更多”，删除仍走危险色与确认 */
function demandMenuItems(d, opts){
  if(!d) return [];
  var out = [];
  /* 详情页桌面不显示底栏，认领放在「更多」里；列表行已有直连按钮，不再重复 */
  if(opts && opts.detail && canClaimDemandReview(d)){
    out.push({ act: "claim", label: "认领评审" });
  }
  if(canWriteDemand(d) && d.status === "review" && canReviewDemand(d)){
    out.push({ act: "rej", label: "评审不通过" });
  }
  /* 已进入流转也能编辑，服务端只放开说明类字段（标题、类型、优先级与日期另有口径） */
  if(canWriteDemand(d) && !isClosedDemand(d)){
    out.push({ act: "edit", label: "编辑" });
  }
  if(canReviewDemand(d)){
    if(d.status === "pass") out.push({ act: "unpass", label: "撤回评审" });
  }
  if(isOwner() && canWriteDemand(d)){
    out.push({ act: "del", label: "删除", danger: true });
  }
  if(canScheduleDemand(d)){
    if(d.status === "plan"){
      out.push({ act: "replan", label: "调整排期" });
      out.push({ act: "unplan", label: "撤销排期" });
    }
    /* 已完成由完成判定自动进入，不能直接关闭；确需终止交付由项目负责人另行处理 */
    if(!isClosedDemand(d) && d.status !== "done") out.push({ act: "cancel", label: "关闭需求", danger: true });
  }
  return out;
}
function demandActs(d, opts){
  /* 列表行里主按钮只保留页头「提需求」一个；行内动作降为主色浅底，避免整屏都是主色 */
  var cls = (opts && opts.subtle) ? "btn sm soft" : "btn sm primary";
  var acts = "";
  if(canClaimDemandReview(d)){
    acts += '<button class="btn sm soft" type="button" data-dem-claim="' + esc(d.id) + '" title="认领后由你评审，不会自动通过">认领评审</button>';
  }
  if(canReviewDemand(d)){
    if(d.status === "review"){
      acts += '<button class="' + cls + '" type="button" data-dem-pass="' + esc(d.id) + '">通过</button>';
    }
    if(isClosedDemand(d) && (d.closeReason === "rej" || d.status === "rej")){
      acts += '<button class="btn sm" type="button" data-dem-reopen="' + esc(d.id) + '">重新打开</button>';
    }
  }
  if(canScheduleDemand(d)){
    if(d.status === "pass") acts += '<button class="' + cls + '" type="button" data-dem-plan="' + esc(d.id) + '">排期进入版本</button>';
    if(isClosedDemand(d) && d.closeReason !== "rej" && d.status !== "rej") acts += '<button class="btn sm" type="button" data-dem-restore="' + esc(d.id) + '">恢复至' + esc(restoreTargetName(d)) + '</button>';
  }
  if(demandMenuItems(d).length){
    acts += '<button class="btn sm ghost" type="button" data-dem-menu-btn="' + esc(d.id) +
      '" aria-haspopup="true" aria-expanded="false" title="更多操作">更多</button>';
  }
  return acts;
}
function openDemandRowMenu(anchor, d){
  if(!anchor || !d) return;
  var items = demandMenuItems(d);
  if(!items.length) return;
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "140px";
  menu.innerHTML = items.map(function(it){
    return '<button class="menu-item' + (it.danger ? " danger" : "") + '" type="button" data-dem-menu="' + it.act + '">' + esc(it.label) + '</button>';
  }).join("");
  UI.openPop(menu, anchor, { onClose: function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-menu]");
    if(!b) return;
    UI.closeAllPops();
    if(b.dataset.demMenu === "rej") rejectDemand(d.id);
    else if(b.dataset.demMenu === "unpass") unpassDemand(d.id);
    else if(b.dataset.demMenu === "unplan") unplanDemand(d.id);
    else if(b.dataset.demMenu === "replan") openPlanDialog(d.id, true);
    else if(b.dataset.demMenu === "cancel") cancelDemand(d.id);
    else if(b.dataset.demMenu === "edit") openDemandDialog(d);
    else if(b.dataset.demMenu === "del") deleteDemand(d.id);
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
}
function dragHint(status, canSchedule){
  if(status === "review") return "可拖到「已通过」，或拖到「已关闭」记录评审不通过";
  if(status === "pass") return canSchedule
    ? "可拖到「已排期」选择目标版本，或拖回「待评审」撤回"
    : "可拖回「待评审」撤回；排期由空间主、管理员或可写项目负责人操作";
  if(status === "plan") return "可拖回「已通过」撤销排期";
  if(status === "done") return "已完成由完成判定自动进出，只可修正文、归档信息与优先级；版本与计划日期不再调整";
  return "关闭归档请使用卡片上的恢复动作";
}
/* 状态语义跟着卡片走：底部总注离卡片太远，窄屏与长列里都看不到 */
function demandStateNote(d){
  if(!d || !isClosedDemand(d)) return "";
  var reason = d.closeReason || (d.status === "rej" ? "rej" : "cancel");
  var note = closeReasonName(reason) + " · 关闭前 " + closeStageName(d.closeStage || (d.status === "rej" ? "review" : "pass"));
  return note + (reason === "rej" ? " · 可重新打开" : " · 恢复至" + restoreTargetName(d));
}
function demandEvidenceHTML(d){
  if(!d || (d.status !== "plan" && d.status !== "done")) return "";
  var total = Number(d.taskCount) || 0, done = Number(d.taskDone) || 0;
  var cases = Number(d.caseCount) || 0, passed = Number(d.casePassed) || 0;
  var html = "";
  if(total){
    var pct = Math.max(0, Math.min(100, Math.round(done / total * 100)));
    html += '<div class="dem-evidence-row"><span>工作项 ' + done + '/' + total + '</span><span class="dem-progress' + (done === total ? " ok" : "") + '"><i style="width:' + pct + '%"></i></span></div>';
  }else if(d.status === "done"){
    html += '<div class="dem-evidence-meta">无关联工作项 · 完成与交付以发布或人工判定为准</div>';
  }else{
    html += '<div class="bkl-tags"><span class="tag tag-warning">未拆工作项</span><span class="tag ghost">待补充交付证据</span></div>';
  }
  if(cases) html += '<div class="dem-evidence-meta">用例 ' + passed + '/' + cases + ' 通过</div>';
  if(d.deliveredAt){
    var deliveredLabel = d.deliveryStageSource === "manual" ? "人工交付 " : "生产发布 ";
    html += '<div class="dem-evidence-meta">' + deliveredLabel + esc(String(d.deliveredAt).substring(0, 10)) + '</div>';
  }
  if(d.deliveryStageSource === "manual" && d.manualDeliveryStage !== "delivered"){
    html += '<div class="dem-evidence-meta">人工判定 ' + esc(deliveryStageName(d.manualDeliveryStage))
      + (d.manualDeliveryEffectiveOn ? " · " + esc(String(d.manualDeliveryEffectiveOn).substring(0, 10)) : "")
      + (d.manualDeliveryReason ? " · " + esc(d.manualDeliveryReason) : "") + '</div>';
  }
  if(d.deliveryEvidenceMissing) html += '<div class="dem-evidence-missing">已发布版本缺少有效发布记录，请人工补录</div>';
  return html;
}
function cardHTML(d, opts){
  var acts = opts && opts.readOnly ? "" : demandActs(d, { subtle: true });
  /* 手机列表没有拖拽落点，卡片不挂 draggable，避免长按误触发拖动；
     已完成只由完成判定进出，不参与拖动 */
  var drag = (canReviewDemand(d) && !isClosedDemand(d) && d.status !== "done" && (d.status !== "plan" || canScheduleDemand(d)) && !(opts && opts.noDrag))
    ? ' draggable="true" data-card-id="' + esc(d.id) + '" data-card-status="' + esc(d.status) + '" title="' + esc(dragHint(d.status, canScheduleDemand(d))) + '"'
    : "";
  var reason = d.closeReason || (d.status === "rej" ? "rej" : (isClosedDemand(d) ? "cancel" : ""));
  var descText = demandDescText(d.description);
  return '<div class="bkl-card" data-dem-card="' + esc(d.id) + '"' + drag + '>'
    + '<div class="bkl-tags">'
    + catTag(d.categoryId)
    + priTagHTML(d.priority || "P2")
    + (d.status === "plan" || d.status === "done" ? deliveryStageTag(d.deliveryStage, d.deliveryStageSource) : '')
    + (isClosedDemand(d) ? '<span class="tag ghost">' + esc(closeReasonName(reason)) + '</span>' : '') + '</div>'
    + '<button class="link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>'
    + (descText ? '<p class="bkl-desc">' + esc(descText) + '</p>' : '')
    + '<div class="bkl-tags">'
    /* 全部项目口径下按类型归堆，卡片自己补项目，避免丢掉归属（原先是项目泳道头承担） */
    + (!rt.demandReqId && d.reqId ? '<span class="tag ghost">' + esc(reqNameById(d.reqId) || "未归类") + '</span>' : '')
    + (demandVersionName(d) ? (d.versionId ? assocLinkHTML("version", d.versionId, demandVersionName(d), { req:d.reqId, cls:"tag ghost" }) : '<span class="tag ghost">' + esc(demandVersionName(d)) + '</span>') : '')
    + (d.expectDate ? '<span class="tag tag-info">期望 ' + esc(String(d.expectDate).substring(5, 10)) + '</span>' : '')
    + (plannedText(d) ? '<span class="tag ghost">计划 ' + esc(plannedText(d)) + '</span>' : '')
    + (wsjfText(d) ? '<span class="tag tag-plum">' + esc(wsjfText(d)) + '</span>' : '')
    + '</div>'
    + (d.source ? '<div class="bkl-src">来源：' + esc(d.source) + '</div>' : '')
    + (demCreatorName(d) ? '<div class="bkl-src dem-creator">提交人：' + esc(demCreatorName(d)) + '</div>' : '')
    + demandEvidenceHTML(d)
    + (demandStateNote(d) ? '<div class="bkl-state">' + esc(demandStateNote(d)) + '</div>' : '')
    + (isClosedDemand(d) && d.reviewNote ? '<div class="bkl-why' + (reason !== "rej" ? " is-canceled" : "") + '">' + esc(d.reviewNote) + '</div>' : '')
    + (acts ? '<div class="bkl-acts">' + acts + '</div>' : '')
    + '</div>';
}

/* ---------- 主状态工作页：全局页签 + 筛选指标 + 分页泳道卡片 ---------- */

function demWorkParams(offset, limit){
  return {
    status:demWork.status,
    reqId:demWork.reqId || null,
    q:demWork.q || null,
    pris:demWork.pris.join(","),
    deliveryStage:demStageKeys(demWork.status).indexOf(demWork.stage) >= 0 ? demWork.stage : null,
    versionId:demStageKeys(demWork.status).length && demWork.versionId !== "all" ? demWork.versionId : null,
    closeReason:demWork.status === "closed" && demWork.closeReason !== "all" ? demWork.closeReason : null,
    closeStage:demWork.status === "closed" && demWork.closeStage !== "all" ? demWork.closeStage : null,
    focus:demWork.focus !== "all" ? demWork.focus : null,
    sort:demWork.sort,
    offset:offset,
    limit:Math.min(100, limit)
  };
}
function loadDemandWorkpage(){
  var seq = ++demWork.seq;
  var status = demWork.status, stage = demWork.stage;
  var wsId = rt.currentWs && rt.currentWs.id;
  demandBody.innerHTML = UI.skeletonRows(3);
  API.get("/api/demands/workpage", demWorkParams(0, 50)).then(function(res){
    if(seq !== demWork.seq || !demWork.active || demWork.status !== status || demWork.stage !== stage) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    demWork.response = res || {};
    var page = res && res.page || {};
    demWork.items = page.items || [];
    demWork.total = page.total || 0;
    demWork.hasMore = !!page.hasMore;
    demands = demWork.items.slice();
    ((res && res.versions) || []).forEach(function(v){ if(v.versionId && v.versionId !== "__none") versionNames[v.versionId] = v.versionName; });
    render();
  }).catch(function(ex){
    if(seq !== demWork.seq) return;
    demandBody.innerHTML = UI.emptyState({ icon:"alert", title:"工作页加载失败", text:ex.message || "网络异常，请稍后重试" });
  });
}
function loadMoreDemandWorkpage(){
  if(!demWork.hasMore) return Promise.resolve(false);
  var seq = demWork.seq;
  var btn = demandBody.querySelector("[data-dem-work-more]");
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  return API.get("/api/demands/workpage", demWorkParams(demWork.items.length, 50)).then(function(res){
    if(seq !== demWork.seq || !demWork.active) return false;
    var page = res && res.page || {};
    var known = {};
    demWork.items.forEach(function(d){ known[d.id] = true; });
    (page.items || []).forEach(function(d){ if(!known[d.id]) demWork.items.push(d); });
    demWork.total = page.total || demWork.total;
    demWork.hasMore = !!page.hasMore;
    demands = demWork.items.slice();
    render();
    return true;
  }).catch(function(ex){
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function demWorkMetric(label, value, note, warn){
  return '<div class="dem-work-metric"><span>' + esc(label) + '</span><b' + (warn ? ' class="warn"' : '') + '>' + esc(value) + '</b><small>' + esc(note) + '</small></div>';
}
function demWorkMetricsHTML(){
  var m = demWork.response && demWork.response.metrics || {};
  var total = Number(m.total) || 0;
  if(demWork.status === "plan"){
    var tasks = Number(m.taskCount) || 0, taskDone = Number(m.taskDone) || 0;
    var cases = Number(m.caseCount) || 0, casePassed = Number(m.casePassed) || 0;
    var risk = Number(m.risk) || 0, missing = Number(m.evidenceMissing) || 0;
    var dateLabel = demWork.stage === "delivered" ? "最近生产发布" : "下一期望交付";
    var date = demWork.stage === "delivered" ? m.lastDelivered : (m.nextPendingExpect || m.nextExpect);
    return demWorkMetric("需求数", total, "当前筛选结果")
      + demWorkMetric("工作项完成", tasks ? Math.round(taskDone / tasks * 100) + "%" : "—", taskDone + " / " + tasks + " 已关闭")
      + demWorkMetric("用例通过", cases ? Math.round(casePassed / cases * 100) + "%" : "—", cases ? casePassed + " / " + cases + " 通过" : "当前结果未登记用例")
      + demWorkMetric("需关注需求", risk + " 条", missing ? missing + " 条缺发布证据" : "未拆解 / 用例 / 日期", risk > 0)
      + demWorkMetric(dateLabel, date ? String(date).substring(0, 10) : "—", "按真实证据与期望日期");
  }
  if(demWork.status === "done"){
    var dTasks = Number(m.taskCount) || 0, dTaskDone = Number(m.taskDone) || 0;
    var dCases = Number(m.caseCount) || 0, dCasePassed = Number(m.casePassed) || 0;
    var sc = demWork.response && demWork.response.stageCounts || {};
    var pending = Number(sc.donePending) || 0, delivered = Number(sc.delivered) || 0;
    return demWorkMetric("需求数", total, "当前筛选结果")
      + demWorkMetric("工作项完成", dTasks ? Math.round(dTaskDone / dTasks * 100) + "%" : "—", dTaskDone + " / " + dTasks + " 已关闭")
      + demWorkMetric("用例通过", dCases ? Math.round(dCasePassed / dCases * 100) + "%" : "—", dCases ? dCasePassed + " / " + dCases + " 通过" : "当前结果未登记用例")
      + demWorkMetric("已交付", delivered + " 条", pending ? "另有 " + pending + " 条待发布" : "成功生产发布或人工判定", pending > 0)
      + demWorkMetric("最近交付", m.lastDelivered ? String(m.lastDelivered).substring(0, 10) : "—", "按成功生产发布或人工判定");
  }
  if(demWork.status === "review"){
    return demWorkMetric("待评审", total, "当前筛选结果")
      + demWorkMetric("高优先级", (Number(m.high) || 0) + " 条", "P0 / P1")
      + demWorkMetric("信息就绪", (Number(m.ready) || 0) + " 条", "已填描述与期望日期")
      + demWorkMetric("期望已过", (Number(m.overdue) || 0) + " 条", "需重新评估", Number(m.overdue) > 0)
      + demWorkMetric("最长等待", (Number(m.longestWait) || 0) + " 天", "按提交日期计算");
  }
  if(demWork.status === "pass"){
    var avg = Number(m.avgWsjf);
    return demWorkMetric("待排期", total, "尚未进入交付阶段")
      + demWorkMetric("高优先级", (Number(m.high) || 0) + " 条", "P0 / P1")
      + demWorkMetric("30 天内期望", (Number(m.dueSoon) || 0) + " 条", "包含已过期日期", Number(m.dueSoon) > 0)
      + demWorkMetric("平均 WSJF", isFinite(avg) && avg > 0 ? (Math.round(avg * 10) / 10) : "—", "只统计四项评分完整的需求")
      + demWorkMetric("最近期望", m.nextExpect ? String(m.nextExpect).substring(0, 10) : "—", "用于安排排期顺序");
  }
  return demWorkMetric("已关闭", total, "历史需求归档")
    + demWorkMetric("评审不通过", (Number(m.rej) || 0) + " 条", "可重新打开")
    + demWorkMetric("中途取消", (Number(m.cancel) || 0) + " 条", "保留取消原因")
    + demWorkMetric("重复需求", (Number(m.dup) || 0) + " 条", "保留查重结论")
    + demWorkMetric("恢复至已通过", (Number(m.restorePass) || 0) + " 条", "由关闭前阶段决定");
}
function demWorkTitle(){
  if(demWork.status === "review") return "待评审 · 评审工作台";
  if(demWork.status === "pass") return "已通过 · 排期准备";
  if(demWork.status === "closed") return "已关闭 · 关闭归档";
  if(demWork.status === "done"){
    return demWork.stage === "all" ? "已完成 · 完成与交付" : deliveryStageName(demWork.stage) + " · 完成与交付";
  }
  return demWork.stage === "all" ? "已排期 · 交付驾驶舱" : deliveryStageName(demWork.stage) + " · 交付驾驶舱";
}
function demWorkRule(){
  if(demWork.status === "review") return "只处理评审决策；通过后进入排期准备，不通过进入关闭归档并保留原因。";
  if(demWork.status === "pass") return "这里只处理评审通过、尚未排期的需求；未产生交付证据，因此不展示交付阶段。";
  if(demWork.status === "closed") return "按关闭原因和关闭前阶段回看；恢复去向由关闭前阶段决定，交付证据与关闭原因继续保留。";
  if(demWork.status === "done") return "工作项全部完成且用例全部通过后自动进入；完成不等于交付，交付以成功生产发布或人工判定为准，版本与计划日期不再调整。";
  return "待开工、推进中、待发布与已交付均为派生只读；缺口应补工作项、用例或生产发布记录，不能手工改阶段。";
}
function demWorkStatusTabsHTML(){
  var counts = demWork.response && demWork.response.statusCounts || {};
  return '<nav class="dem-work-tabs" aria-label="切换主状态工作页">' + COLS.map(function(c){
    var on = demWork.status === c[0];
    return '<button type="button" class="dem-work-tab' + (on ? " on" : "") + '" data-dem-work-status="' + c[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + c[1] + '<b>' + (Number(counts[c[0]]) || 0) + '</b></button>';
  }).join("") + '</nav>';
}
function demWorkStageTabsHTML(){
  var stages = demStageKeys(demWork.status);
  if(!stages.length) return "";
  var counts = demWork.response && demWork.response.stageCounts || {};
  var all = stages.reduce(function(n, k){ return n + (Number(counts[k]) || 0); }, 0);
  var tabs = [["all", "全部阶段", all]].concat(stages.map(function(k){ return [k, deliveryStageName(k), Number(counts[k]) || 0]; }));
  return '<nav class="dem-work-tabs dem-derived-tabs" aria-label="切换交付阶段">' + tabs.map(function(t){
    var on = demWork.stage === t[0];
    return '<button type="button" class="dem-work-tab' + (on ? " on" : "") + '" data-dem-work-stage="' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '<b>' + t[2] + '</b></button>';
  }).join("") + caliberMarkHTML("demands.stage", false, "查看交付阶段如何变化") + '</nav>';
}
function demWorkProjectOptions(){
  return '<option value="all">全部项目</option>' + projectOptionsHTML(rt.reqList, demWork.reqId);
}
function demWorkPriorityOptions(){
  return '<option value="all">全部优先级</option>' + PRIORITIES.map(function(p){
    return '<option value="' + p + '"' + (demWork.pris.length === 1 && demWork.pris[0] === p ? " selected" : "") + '>' + esc(priName(p)) + '</option>';
  }).join("");
}
function demWorkFiltersHTML(){
  var html = '<div class="dem-work-filters"><input class="input dem-work-search" type="search" data-dem-work-q value="' + esc(demWork.q) + '" placeholder="搜索标题、描述、来源或编号…" aria-label="搜索当前工作页需求（含需求编号）">'
    + '<select class="mini-select" data-dem-work-filter="reqId" aria-label="筛选项目">' + demWorkProjectOptions() + '</select>'
    + '<select class="mini-select" data-dem-work-filter="priority" aria-label="筛选优先级">' + demWorkPriorityOptions() + '</select>';
  if(demWork.status === "plan" || demWork.status === "done"){
    var versions = demWork.response && demWork.response.versions || [];
    html += '<select class="mini-select" data-dem-work-filter="versionId" aria-label="筛选目标版本"><option value="all">全部版本</option>' + versions.map(function(v){
      return '<option value="' + esc(v.versionId) + '"' + (demWork.versionId === v.versionId ? " selected" : "") + '>' + esc(v.versionName) + ' · ' + (Number(v.cnt) || 0) + '</option>';
    }).join("") + '</select>'
      + '<select class="mini-select" data-dem-work-filter="focus" aria-label="筛选需关注需求"><option value="all">全部需求</option><option value="risk"' + (demWork.focus === "risk" ? " selected" : "") + '>只看需关注</option></select>'
      + '<select class="mini-select" data-dem-work-filter="group" aria-label="泳道分组"><option value="version"' + (demWork.group === "version" ? " selected" : "") + '>按版本分组</option><option value="project"' + (demWork.group === "project" ? " selected" : "") + '>按项目分组</option></select>';
  }else if(demWork.status === "closed"){
    html += '<select class="mini-select" data-dem-work-filter="closeReason" aria-label="筛选关闭原因"><option value="all">全部关闭原因</option>' + Object.keys(CLOSE_REASONS).map(function(r){
      return '<option value="' + r + '"' + (demWork.closeReason === r ? " selected" : "") + '>' + esc(CLOSE_REASONS[r]) + '</option>';
    }).join("") + '</select><select class="mini-select" data-dem-work-filter="closeStage" aria-label="筛选关闭前阶段"><option value="all">全部关闭前阶段</option>' + Object.keys(CLOSE_STAGES).map(function(s){
      return '<option value="' + s + '"' + (demWork.closeStage === s ? " selected" : "") + '>' + esc(CLOSE_STAGES[s]) + '</option>';
    }).join("") + '</select><select class="mini-select" data-dem-work-filter="group" aria-label="泳道分组"><option value="reason"' + (demWork.group === "reason" ? " selected" : "") + '>按关闭原因分组</option><option value="project"' + (demWork.group === "project" ? " selected" : "") + '>按项目分组</option></select>';
  }else{
    var focus = demWork.status === "review" ? "high" : "dueSoon";
    html += '<select class="mini-select" data-dem-work-filter="focus" aria-label="筛选重点关注"><option value="all">全部需求</option><option value="' + focus + '"' + (demWork.focus === focus ? " selected" : "") + '>' + (focus === "high" ? "只看高优先级" : "30 天内期望") + '</option></select>'
      + '<select class="mini-select" data-dem-work-filter="group" aria-label="泳道分组"><option value="project"' + (demWork.group === "project" ? " selected" : "") + '>按项目分组</option><option value="priority"' + (demWork.group === "priority" ? " selected" : "") + '>按优先级分组</option></select>'
      + '<select class="mini-select" data-dem-work-filter="sort" aria-label="需求排序"><option value="expect"' + (demWork.sort === "expect" ? " selected" : "") + '>按期望交付</option><option value="wsjf"' + (demWork.sort === "wsjf" ? " selected" : "") + '>按 WSJF</option><option value="priority"' + (demWork.sort === "priority" ? " selected" : "") + '>按优先级</option></select>';
  }
  return html + '<button class="btn sm" type="button" data-dem-work-reset>清除筛选</button></div>';
}
function demWorkGroupKey(d){
  if(demWork.group === "version") return d.versionId || "__none";
  if(demWork.group === "priority") return d.priority || "P2";
  if(demWork.group === "reason") return d.closeReason || (d.status === "rej" ? "rej" : "cancel");
  return d.reqId || "__none";
}
function demWorkGroupLabel(key){
  if(demWork.group === "version") return key === "__none" ? "未指定版本" : (versionName(key) || "未命名版本");
  if(demWork.group === "priority") return priName(key);
  if(demWork.group === "reason") return closeReasonName(key);
  return key === "__none" ? "未归类" : (reqNameById(key) || "未命名项目");
}
function demWorkGroups(){
  var groups = {}, order = [];
  demWork.items.forEach(function(d){
    var key = demWorkGroupKey(d);
    if(!groups[key]){ groups[key] = []; order.push(key); }
    groups[key].push(d);
  });
  if(demWork.group === "version"){
    var versionOrder = {};
    ((demWork.response && demWork.response.versions) || []).forEach(function(v, i){ versionOrder[v.versionId] = i; });
    order.sort(function(a, b){
      var ai = versionOrder[a] === undefined ? 9999 : versionOrder[a], bi = versionOrder[b] === undefined ? 9999 : versionOrder[b];
      return ai - bi || demWorkGroupLabel(a).localeCompare(demWorkGroupLabel(b), "zh-CN", {numeric:true});
    });
  }else if(demWork.group === "priority"){
    order.sort(function(a, b){ return priRank(a) - priRank(b); });
  }else{
    order.sort(function(a, b){ return demWorkGroupLabel(a).localeCompare(demWorkGroupLabel(b), "zh-CN"); });
  }
  return order.map(function(key){ return { key:key, label:demWorkGroupLabel(key), rows:groups[key] }; });
}
function demWorkListMode(){
  /* 手机上列表要横向滚动才能放下列宽，形态切换只在桌面端提供 */
  return demWork.layout === "list" && !isMobile();
}
function demWorkLanesHTML(){
  var gs = demWorkGroups();
  if(demWorkListMode()) return demWorkListHTML(gs);
  return gs.map(function(g){
    return '<section class="dem-work-lane"><div class="dem-work-lane-head"><h2>' + esc(g.label) + '</h2><span>' + g.rows.length + ' 条</span></div><div class="dem-work-grid">'
      + g.rows.map(function(d){ return cardHTML(d, {noDrag:true, readOnly:true}); }).join("") + '</div></section>';
  }).join("");
}
/* 列表形态：字段与卡片同源，只是把标签行压成列；表头只在整表上方出现一次，泳道以内嵌分组行区分 */
var DEM_WORK_COL_DEFS = {
  title:{ label:"需求", w:"minmax(180px,2.2fr)", min:180 },
  kind:{ label:"类型", w:"76px", min:76 },
  category:{ label:"分类", w:"104px", min:104 },
  priority:{ label:"优先级", w:"72px", min:72, sort:"priority" },
  stage:{ label:"交付阶段", w:"112px", min:112 },
  wsjf:{ label:"WSJF", w:"72px", min:72, sort:"wsjf", align:"right" },
  close:{ label:"关闭情况", w:"184px", min:184 },
  evidence:{ label:"交付证据", w:"minmax(140px,1.5fr)", min:140 },
  version:{ label:"目标版本", w:"96px", min:96 },
  planned:{ label:"计划区间", w:"140px", min:140 },
  expect:{ label:"期望交付", w:"76px", min:76, sort:"expect", align:"right" },
  source:{ label:"来源", w:"80px", min:80 },
  created:{ label:"提交时间", w:"104px", min:104, align:"right" }
};
/* 排序方向由服务端 SQL 固定（WSJF 倒序，优先级/期望交付正序），表头只切列、不翻转方向；
   可排序列与筛选行的排序下拉同一套词表，两处始终保持一致 */
var DEM_WORK_SORT_DIR = { priority:"asc", expect:"asc", wsjf:"desc" };
var DEM_WORK_STATUS_COLS = {
  plan:["title","kind","category","priority","stage","evidence","version","planned","expect","source"],
  done:["title","kind","category","priority","stage","evidence","version","planned","expect","source"],
  review:["title","kind","category","priority","wsjf","expect","source","created"],
  pass:["title","kind","category","priority","wsjf","expect","source","created"],
  closed:["title","kind","category","priority","close","version","expect","source","created"]
};
function demWorkCols(){
  var keys = (DEM_WORK_STATUS_COLS[demWork.status] || DEM_WORK_STATUS_COLS.plan).slice();
  /* 按版本分组时泳道标题就是版本名，行内不再重复一列 */
  if(demWork.group === "version") keys = keys.filter(function(k){ return k !== "version"; });
  return keys.map(function(k){
    var def = DEM_WORK_COL_DEFS[k];
    return { key:k, label:def.label, w:def.w, align:def.align || "", sort:def.sort || "" };
  });
}
function demWorkListMinW(cols){
  return cols.reduce(function(n, c){ return n + DEM_WORK_COL_DEFS[c.key].min; }, 0) + (cols.length - 1) * 8;
}
function demWorkHeadCellHTML(c){
  var cls = c.align === "right" ? ' class="ta-r"' : '';
  if(!c.sort) return '<span' + cls + '>' + esc(c.label) + '</span>';
  var active = demWork.sort === c.sort;
  var desc = DEM_WORK_SORT_DIR[c.sort] === "desc";
  return '<span aria-sort="' + (active ? (desc ? "descending" : "ascending") : "none") + '"' + cls + '>' +
    '<button class="lh-sort' + (active ? " on" : "") + '" type="button" data-dem-work-sort="' + c.sort + '"' +
      ' title="按「' + esc(c.label) + '」排序">' + esc(c.label) +
      '<i class="lh-ind" aria-hidden="true">' + (active ? (desc ? "↓" : "↑") : "") + '</i></button></span>';
}
function demWorkListHTML(gs){
  var cols = demWorkCols();
  return '<div class="dem-work-list" style="--dem-work-cols:' + cols.map(function(c){ return c.w; }).join(" ")
    + ';--dem-work-min:' + demWorkListMinW(cols) + 'px"><div class="list-head">'
    + cols.map(function(c){ return demWorkHeadCellHTML(c); }).join("") + '</div>'
    + gs.map(function(g){
      return '<section class="dem-work-lane dem-work-lane-list"><div class="dem-work-lane-head"><h2>' + esc(g.label) + '</h2><span>' + g.rows.length + ' 条</span></div>'
        + '<div class="dem-work-rows" role="list">'
        + g.rows.map(function(d){ return demWorkRowHTML(d, cols); }).join("") + '</div></section>';
    }).join("") + '</div>';
}
function demWorkRowHTML(d, cols){
  return '<div class="list-row dem-work-row" data-dem-card="' + esc(d.id) + '" tabindex="0" role="listitem">'
    + cols.map(function(c){
      return '<span class="cell dwl-' + c.key + (c.align === "right" ? " ta-r" : "") + '">' + demWorkCell(d, c.key) + '</span>';
    }).join("")
    + '</div>';
}
function demWorkCell(d, key){
  var none = '<span class="dwl-none">—</span>';
  if(key === "title"){
    return '<div class="dwl-main"><button class="link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>'
      + (demCreatorName(d) ? '<div class="dem-title-sub">由 ' + esc(demCreatorName(d)) + ' 提交</div>' : '')
      + (d.description ? '<p class="dwl-desc">' + esc(demandDescText(d.description)) + '</p>' : '') + '</div>';
  }
  if(key === "kind") return '<span class="tag ghost">' + esc(d.itemKind || "其他") + '</span>';
  if(key === "category") return catTag(d.categoryId) || none;
  if(key === "priority") return priTagHTML(d.priority || "P2");
  if(key === "stage") return (d.status === "plan" || d.status === "done") ? (deliveryStageTag(d.deliveryStage, d.deliveryStageSource) || none) : none;
  if(key === "wsjf") return wsjfText(d) || none;
  if(key === "close") return '<span class="dwl-close" title="' + esc(demandStateNote(d)) + '"><span class="tag ghost">'
    + esc(closeReasonName(d.closeReason || (d.status === "rej" ? "rej" : "cancel"))) + '</span><i>关闭前 '
    + esc(closeStageName(d.closeStage || (d.status === "rej" ? "review" : "pass"))) + '</i></span>';
  if(key === "evidence") return demWorkEvidenceCell(d);
  if(key === "version") return demandVersionName(d) ? (d.versionId ? assocLinkHTML("version", d.versionId, demandVersionName(d), { req:d.reqId }) : esc(demandVersionName(d))) : none;
  if(key === "planned") return plannedText(d) ? esc(plannedText(d)) : none;
  if(key === "expect") return d.expectDate ? esc(String(d.expectDate).substring(5, 10)) : none;
  if(key === "source") return d.source ? esc(d.source) : none;
  if(key === "created") return fmtTs(d.createdAt) ? esc(fmtTs(d.createdAt)) : none;
  return none;
}
function demWorkEvidenceCell(d){
  if(d.status !== "plan" && d.status !== "done") return '<span class="dwl-none">—</span>';
  var total = Number(d.taskCount) || 0, done = Number(d.taskDone) || 0;
  var cases = Number(d.caseCount) || 0, passed = Number(d.casePassed) || 0;
  var html = [], text = [];
  function push(h, t){ html.push(h); text.push(t); }
  if(total) push('<span>工作项 ' + done + '/' + total + '</span>', '工作项 ' + done + '/' + total);
  else if(d.status === "done") push('<span>无关联工作项</span>', '无关联工作项 · 完成与交付以发布或人工判定为准');
  else push('<span class="tag tag-warning">未拆工作项</span><span class="tag ghost">待补充交付证据</span>', '未拆工作项 · 待补充交付证据');
  if(cases) push('<span>用例 ' + passed + '/' + cases + ' 通过</span>', '用例 ' + passed + '/' + cases + ' 通过');
  if(d.deliveredAt){
    var label = d.deliveryStageSource === "manual" ? "人工交付 " : "生产发布 ";
    push('<span>' + label + esc(String(d.deliveredAt).substring(0, 10)) + '</span>', label + String(d.deliveredAt).substring(0, 10));
  }
  if(d.deliveryEvidenceMissing) push('<span class="dwl-warn">已发布版本缺少有效发布记录，请人工补录</span>', '已发布版本缺少有效发布记录，请人工补录');
  return '<span class="dwl-ev" title="' + esc(text.join(" · ")) + '">' + html.join('<i class="dwl-sep">·</i>') + '</span>';
}
function renderDemandWorkpage(){
  if(!demWork.response) return;
  if(demandsMeta) demandsMeta.textContent = demWork.reqId ? reqNameById(demWork.reqId) : "全空间";
  var scope = demWork.reqId ? reqNameById(demWork.reqId) : "全空间需求";
  var html = '<div class="dem-work-page"><header class="dem-work-head"><div class="dem-work-head-top"><button class="btn sm" type="button" data-dem-work-back>' + icon("left", 13) + ' 返回需求看板</button><span class="dem-work-scope">' + esc(scope) + '</span></div>'
    + '<div class="dem-work-title"><div><h1>' + esc(demWorkTitle()) + '</h1><p>' + esc(demWorkRule()) + '</p></div><span class="tag ghost">显示 ' + demWork.items.length + ' / ' + demWork.total + ' 条</span></div>'
    + demWorkStatusTabsHTML() + demWorkStageTabsHTML() + '</header>'
    + '<section class="dem-work-metrics" aria-label="当前筛选指标">' + demWorkMetricsHTML() + '</section>'
    + demWorkFiltersHTML();
  if(demWork.items.length){
    html += '<div class="dem-work-result"><b>当前筛选 ' + demWork.total + ' 条</b><span>分组与指标基于服务端聚合；点击'
      + (demWorkListMode() ? "行" : "卡片") + '可查看需求详情</span>' + (isMobile() ? "" : demWorkLayoutSegHTML() + (demWorkListMode() ? listDensitySegHTML() : "")) + '</div>' + demWorkLanesHTML();
  }else{
    html += '<div class="dem-work-empty">' + UI.emptyState({icon:"filterOff", title:"当前筛选下没有需求", text:"调整项目、阶段或搜索词，也可以清除全部筛选。"}) + '<button class="btn sm primary" type="button" data-dem-work-reset>清除筛选</button></div>';
  }
  if(demWork.hasMore) html += '<button class="bkl-more dem-work-more" type="button" data-dem-work-more>加载更多（已加载 ' + demWork.items.length + ' / 共 ' + demWork.total + ' 条）</button>';
  demandBody.innerHTML = html + '</div>';
}
function resetDemWorkFilters(){
  demWork.reqId = null;
  demWork.q = "";
  demWork.pris = [];
  demWork.versionId = "all";
  demWork.closeReason = "all";
  demWork.closeStage = "all";
  demWork.focus = "all";
  loadDemands();
}

/* ---------- 列表渲染（全空间，跨项目） ---------- */

function statusTag(st){
  if(st === "plan") return '<span class="tag tag-success">已排期</span>';
  if(st === "done") return '<span class="tag tag-plum">已完成</span>';
  if(st === "pass") return '<span class="tag tag-info">已通过</span>';
  if(st === "closed" || st === "rej" || st === "canceled" || st === "cancelled") return '<span class="tag ghost">已关闭</span>';
  return '<span class="tag ghost">待评审</span>';
}
/* 提交人只取服务端按 createdBy 回填的显示名；缺失显示占位，不按账号 ID 猜名字 */
function demCreatorName(d){
  return d && d.createdByName ? String(d.createdByName) : "";
}
function demReviewerName(d){
  return d && d.reviewerName ? String(d.reviewerName) : "";
}
function demCreatorLine(d){
  var name = demCreatorName(d);
  return name ? '<span class="dem-title-sub">由 ' + esc(name) + ' 提交</span>' : "";
}
/* 空值占位统一淡一档：与工作项列表的 .cell.muted 同色，扫读时能看出「没填」而不是「是短横线」 */
function demEmptyCell(){ return '<span class="muted">—</span>'; }
function demandCell(d, key){
  if(key === "title") return '<button class="link-title dem-link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + demCreatorLine(d) + '</button>';
  if(key === "kind") return '<span class="tag ghost">' + esc(d.itemKind || "其他") + '</span>';
  if(key === "category") return demCategoryCell(d);
  if(key === "priority") return demPriorityCell(d);
  if(key === "status") return demStatusCell(d);
  if(key === "project") return demProjectCell(d);
  if(key === "version") return demVersionCell(d);
  if(key === "expectDate") return demExpectCell(d);
  if(key === "wsjf") return d.wsjfScore === null || d.wsjfScore === undefined ? demEmptyCell() : (Math.round(d.wsjfScore * 10) / 10);
  if(key === "source") return demSourceCell(d);
  if(key === "reviewer") return demReviewerName(d) ? esc(demReviewerName(d)) : '<span class="dim">未指派</span>';
  if(key === "createdAt") return esc(fmtTs(d.createdAt) || "—");
  return demEmptyCell();
}

/* ---------- 列表行内编辑：优先级 / 状态 / 所属项目 / 期望交付 / 目标版本 / 分类 / 来源 ----------
   只改列表表格；看板卡片继续用拖拽与行内主按钮。状态沿用原状态机动作，
   需要原因或版本的仍打开原弹窗，避免绕过流转规则。
   分类与来源没有专用端点，走整单 PUT：列表行已含 description/acceptText/wsjf 等全部字段，
   按 demandSaveBody 回填后只覆盖目标字段，不会把说明类内容清空。 */
function demInlineWritable(d){
  return !!d && !isClosedDemand(d) && canWriteDemand(d);
}
/* 换项目：待评审 / 已通过 / 已排期整单迁移（含已排版本的，原排期随迁移撤销）。
   发布记录、冻结版本成员关系与跨项目 Epic 子项仍由服务端最终校验 */
function demandProjectMovable(d){
  if(!d || !canWriteDemand(d)) return false;
  return d.status === "review" || d.status === "pass" || d.status === "plan";
}
/* 候选与层级同口径：保留当前项目（可能已归档）以便标出「当前」，其余只列未归档且可写的项目 */
function demandMoveTargets(reqId){
  var list = rt.reqList.filter(function(r){
    return r.id === reqId || (!r.archivedAt && canEditReq(r.id));
  });
  /* 项目清单尚未加载到当前项目时补一条，避免下拉回落到第一个项目把归属悄悄改掉 */
  if(reqId && !list.some(function(r){ return r.id === reqId; })){
    list.unshift({ id:reqId, name:reqNameById(reqId) || reqId });
  }
  return list;
}
function demInlineProjectEditable(d){
  return demandProjectMovable(d) && demandMoveTargets(d.reqId).length > 1;
}
function demInlineVersionEditable(d){
  return !!d && d.status === "plan" && canScheduleDemand(d);
}
function demPriorityCell(d){
  if(!demInlineWritable(d)) return priTagHTML(d.priority || "P2");
  return demInlineTrigger("priority", d, priTagHTML(d.priority || "P2"), "修改优先级", "dem-inline-pri");
}
function demStatusCell(d){
  /* 已关闭的行保持只读：恢复入口在「更多」菜单里，避免关闭行看起来还能直接流转。
     关闭原因直接写在徽标上，列表不用展开就能区分被否、撤回与重复单 */
  if(isClosedDemand(d)){
    var reason = d.closeReason || (d.status === "rej" ? "rej" : "cancel");
    var stage = closeStageName(d.closeStage || (d.status === "rej" ? "review" : "pass"));
    return '<span class="tag ghost" title="已关闭 · 关闭前 ' + esc(stage) + '">' + esc(closeReasonName(reason)) + '</span>';
  }
  if(!demandStatusMenuItems(d).length) return statusTag(d.status);
  return demInlineTrigger("status", d, statusTag(d.status), "修改状态");
}
function demProjectCell(d){
  var projName = reqNameById(d.reqId);
  if(!demInlineProjectEditable(d)) return projName ? esc(projName) : demEmptyCell();
  return demInlineTrigger("project", d,
    '<span class="dem-inline-txt">' + esc(reqNameById(d.reqId) || "—") + '</span>', "更换所属项目");
}
function demExpectCell(d){
  var text = d.expectDate ? String(d.expectDate).substring(0, 10) : "";
  /* 已完成不再调整交付承诺，期望日期保持只读 */
  if(!demInlineWritable(d) || d.status === "done") return text ? esc(text) : demEmptyCell();
  return demInlineTrigger("expectDate", d,
    '<span class="dem-inline-date-t' + (text ? "" : " is-empty") + '">' + esc(text || "待评估") + '</span>',
    "修改期望交付");
}
/* 分类候选按需求所属项目过滤；缓存未加载时保留原值，避免一次保存把分类悄悄改掉 */
function demCategoryCell(d){
  if(!demInlineWritable(d)) return catTag(d.categoryId) || demEmptyCell();
  var cats = (rt.categoriesCache || []).filter(function(c){ return c.projectId === d.reqId; });
  if(!cats.length) return catTag(d.categoryId) || demEmptyCell();
  return demInlineTrigger("category", d,
    catTag(d.categoryId) || '<span class="dem-inline-date-t is-empty">未分类</span>', "修改分类");
}
/* 单元格统一触发器：读态就是普通文本或标签，悬停/聚焦才露出箭头与底色，点开才出现选项 */
function demInlineTrigger(kind, d, inner, title, extraCls){
  return '<button class="dem-inline-menu' + (extraCls ? " " + extraCls : "") + '" type="button"'
    + ' data-dem-inline-menu="' + kind + '" data-dem-id="' + esc(d.id) + '"'
    + ' aria-haspopup="' + (kind === "expectDate" ? "dialog" : "menu") + '" aria-expanded="false" title="' + esc(title) + '">'
    + inner + icon("caretDown", 11) + '</button>';
}
/* 来源是纯文本，点单元格就地编辑：回车或失焦保存，Esc 取消，不做弹层 */
function demSourceCell(d){
  var text = d.source || "";
  if(!demInlineWritable(d)) return text ? esc(text) : demEmptyCell();
  return '<button class="dem-inline-text' + (text ? "" : " is-empty") + '" type="button" data-dem-source-btn="' +
    esc(d.id) + '" title="点击修改来源" aria-label="来源：' + esc(text || "未填写") + '">' + esc(text || "未填写") + '</button>';
}
function startDemSourceEdit(btn){
  var d = findDemand(btn.dataset.demSourceBtn);
  if(!d) return;
  if(!demInlineWritable(d)){ denyDemandReadOnly(); return; }
  var cur = d.source || "";
  var td = btn.parentNode;
  var el = document.createElement("span");
  el.className = "dem-inline-text inline-edit-field";
  el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "false");
  el.setAttribute("aria-label", "来源");
  el.textContent = cur;
  btn.replaceWith(el);
  try{ el.focus(); }catch(e){ /* noop */ }
  demandFocusEnd(el);
  var done = false, over = false;
  function finish(save){
    if(done) return;
    done = true;
    var val = String(el.innerText || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    over = val.length > DEMAND_SOURCE_MAX;
    if(over) val = val.slice(0, DEMAND_SOURCE_MAX);
    td.innerHTML = demSourceCell(d);
    if(!save || val === cur) return;
    if(over) toast("来源最多 " + DEMAND_SOURCE_MAX + " 字，已截断保存", "warn");
    demPutRow(d, { source: val || null }, val ? "来源已更新" : "已清空来源");
  }
  el.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); finish(false); return; }
    if(e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); finish(true); return; }
    /* 输入到上限后挡掉继续输入，避免靠提交时截断 */
    if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      && (el.innerText || "").length >= DEMAND_SOURCE_MAX && window.getSelection().isCollapsed){
      e.preventDefault();
    }
  });
  el.addEventListener("blur", function(){ finish(true); });
}
function demVersionCell(d){
  /* 版本名与计划区间都按单行省略：列宽固定，日期串按连字符折断会读不出区间 */
  var verName = demandVersionName(d);
  var name = esc(verName || "—");
  var planned = plannedText(d);
  var note = planned ? '<span class="foot-note dem-ver-plan" title="计划 ' + esc(planned) + '">计划 ' + esc(planned) + '</span>' : '';
  var head = demInlineVersionEditable(d)
    ? demInlineTrigger("version", d, '<span class="dem-inline-txt' + (verName ? "" : " is-empty") + '">' + esc(verName || "未指定") + '</span>', "调整目标版本")
    : '<span class="dem-ver-name' + (verName ? "" : " muted") + '" title="' + name + '">' + name + '</span>';
  return '<span class="dem-ver-cell">' + head + note + '</span>';
}
/* 点开才出现选项：菜单项统一带「当前」标记，选中即保存；需要原因或版本的仍交给原弹窗 */
function demInlineMenu(anchor, title, items, onPick){
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "196px";
  menu.innerHTML = '<div class="menu-title">' + esc(title) + '</div>'
    + items.map(function(it){
        if(it.header) return '<div class="menu-sec fact-sec">' + it.header + '</div>';
        return '<button class="menu-item' + (it.sub ? " fact-sub" : "") + '" type="button" data-dem-inline-pick="' + esc(it.value) + '">'
          + it.html + (it.current ? '<span class="k">当前</span>' : '') + '</button>';
      }).join("");
  UI.openPop(menu, anchor, { align:"left", width:210, onClose:function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-inline-pick]");
    if(!b) return;
    UI.closeAllPops();
    onPick(b.dataset.demInlinePick);
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus({ preventScroll:true }); }catch(err){ /* noop */ } }
}
function openDemInlineMenu(btn){
  var d = findDemand(btn.dataset.demId);
  if(!d) return;
  var kind = btn.dataset.demInlineMenu;
  if(kind === "status") return openDemandStatusMenu(btn, d);
  if(kind === "version") return openDemandVersionMenu(btn, d);
  if(kind === "expectDate"){
    var cur = d.expectDate ? String(d.expectDate).substring(0, 10) : "";
    var r = btn.getBoundingClientRect();
    openDateAt({ left:r.left, top:r.bottom, bottom:r.bottom }, {
      value:cur,
      onPick:function(v){
        if((v || "") === cur) return;
        demQuickUpdate(btn, d, "expect-date", { expectDate:v || null },
          v ? ("期望交付已设为 " + v) : "已清空期望交付");
      }
    });
    return;
  }
  if(kind === "priority"){
    var pri = d.priority || "P2";
    demInlineMenu(btn, "优先级", PRIORITIES.map(function(p){
      return { value:p, current:p === pri,
        html:'<span class="pdot ' + esc(p) + '" style="--p-c:' + esc(priColor(p)) + '"><i></i>' + esc(priName(p)) + '</span>' };
    }), function(p){
      if(p === pri) return;
      demQuickUpdate(btn, d, "priority", { priority:p }, "优先级已调整为 " + p);
    });
    return;
  }
  if(kind === "project"){
    /* 层级与筛选栏同口径：项目集标题 + 二级项目；当前项目可能已归档，保留在组内 */
    var items = [];
    projectGroups(demandMoveTargets(d.reqId)).forEach(function(g){
      items.push({ header: esc(g.set ? g.set.name : "未分组") });
      g.rows.forEach(function(req){
        items.push({ value:req.id, current:req.id === d.reqId, sub:true,
          html:esc(req.name) + (req.containerKind ? "（公共）" : "") + (req.archivedAt ? "（已归档）" : "") });
      });
    });
    demInlineMenu(btn, "所属项目", items, function(reqId){
      if(reqId === d.reqId) return;
      confirmDemandMove(d, reqId).then(function(ok){
        if(!ok) return;
        demQuickUpdate(btn, d, "move", { reqId:reqId }, "已移至「" + reqNameById(reqId) + "」");
      }).catch(function(ex){
        toast(ex && ex.message ? ex.message : "读取迁移范围失败", "bad");
      });
    });
    return;
  }
  if(kind === "category"){
    var curCat = d.categoryId || "";
    var cats = (rt.categoriesCache || []).filter(function(c){ return c.projectId === d.reqId; });
    demInlineMenu(btn, "分类", [{ value:"", current:!curCat, html:"未分类" }].concat(cats.map(function(c){
      return { value:c.id, current:c.id === curCat, html:esc(c.name) };
    })), function(next){
      if(next === curCat) return;
      demPutRow(d, { categoryId:next || null },
        next ? ("分类已改为「" + catNameById(next) + "」") : "已清除分类", btn);
    });
  }
}
function openDemandVersionMenu(anchor, d, onSaved, queue){
  if(!anchor || !d) return;
  if(!demInlineVersionEditable(d)){ denySchedule(); return; }
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "220px";
  menu.innerHTML = '<div class="menu-title">目标版本</div><div class="menu-field"><p class="foot-note" style="margin:0">加载中…</p></div>';
  UI.openPop(menu, anchor, { align:"left", width:240, onClose:function(){ menu.remove(); } });
  API.get("/api/versions", { reqId: d.reqId }).then(function(list){
    if(!document.body.contains(menu)) return;
    var usable = (list || []).filter(function(v){
      return (v.status !== "released" && v.status !== "closed" && v.status !== "canceled") || v.id === d.versionId;
    });
    usable.forEach(function(v){ versionNames[v.id] = v.name; });
    menu.__versions = usable;
    menu.innerHTML = '<div class="menu-title">目标版本</div>'
      + '<button class="menu-item" type="button" data-dem-ver="">未指定' + (!d.versionId ? '<span class="k">当前</span>' : '') + '</button>'
      + usable.map(function(v){
        return '<button class="menu-item" type="button" data-dem-ver="' + esc(v.id) + '">' + esc(v.name) +
          (v.id === d.versionId ? '<span class="k">当前</span>' : '') + '</button>';
      }).join("")
      + (usable.length ? "" : '<p class="foot-note" style="padding:8px 10px;margin:0">该项目还没有可选版本</p>')
      + '<div class="menu-foot"><button class="btn sm" type="button" data-dem-ver-cancel>取消</button></div>';
  }).catch(function(ex){
    if(document.body.contains(menu)) menu.innerHTML = '<div class="menu-title">目标版本</div><p class="foot-note" style="padding:8px 10px;margin:0">' + esc(ex.message || "版本加载失败") + '</p>';
  });
  menu.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-ver-cancel]")){ UI.closeAllPops(); return; }
    var b = e.target.closest("[data-dem-ver]");
    if(!b) return;
    var vid = b.dataset.demVer || null;
    UI.closeAllPops();
    if(vid === (d.versionId || null)) return;
    /* 换 / 清目标版本与调期同规则：原因必填并写入需求时间线 */
    UI.showPrompt({
      title:"调整目标版本",
      desc:(vid ? "目标版本将改为「" + versionName(vid) + "」" : "将清除目标版本") +
        "，关联任务的版本与日期保持不变。",
      label:"调期原因（必填）",
      required:true,
      maxLength:500,
      okText:"保存"
    }).then(function(note){
      if(note === null) return;
      if(!note.trim()){ toast("请填写调期原因", "warn"); return; }
      var save = function(){ return API.post("/api/demands/" + encodeURIComponent(d.id) + "/version", {
        revision: d.revision, versionId: vid, note: note.trim()
      }); };
      (queue || function(work){ return work(); })(save).then(function(res){
        toast(vid ? "目标版本已调整为「" + versionName(vid) + "」" : "已清除目标版本", "fs");
        refreshDemandsInline();
        if(onSaved) onSaved(res);
      }).catch(function(ex){
        toast(ex.message || "调整目标版本失败", "bad");
        if(ex.code === 409) refreshDemandsInline();
      });
    });
  });
}
function demQuickUpdate(el, d, action, payload, okMsg, revert){
  el.disabled = true;
  payload.revision = d.revision;
  API.post("/api/demands/" + encodeURIComponent(d.id) + "/" + action, payload).then(function(){
    toast(okMsg, "fs");
    refreshDemandsInline();
  }).catch(function(ex){
    el.disabled = false;
    if(revert) revert();
    toast(ex.message || "修改失败", "bad");
    if(ex.code === 409) refreshDemandsInline();
  });
}
/* 分类 / 来源走整单 PUT：列表行字段齐全，回填后只覆盖目标字段 */
function demPutRow(d, patch, okMsg, el, revert){
  if(el) el.disabled = true;
  var body = demandSaveBody(d);
  Object.keys(patch).forEach(function(k){ body[k] = patch[k]; });
  API.put("/api/demands/" + encodeURIComponent(d.id), body).then(function(){
    toast(okMsg, "fs");
    refreshDemandsInline();
  }).catch(function(ex){
    if(el) el.disabled = false;
    if(revert) revert();
    toast(ex.message || "修改失败", "bad");
    if(ex.code === 409) refreshDemandsInline();
  });
}
/* 换项目是整单迁移：先取服务端预览（随迁范围与不可回退的阻断项），再连续两道确认。
   第一道讲清权限、分类与统计口径的后果；第二道列出随迁和解除的关系。只有两道都确认才返回 true。 */
function confirmDemandMove(d, reqId){
  var targetName = reqNameById(reqId) || reqId;
  var srcName = reqNameById(d.reqId) || "原项目";
  return API.get("/api/demands/" + encodeURIComponent(d.id) + "/move-preview", { reqId:reqId }).then(function(pv){
    pv = pv || {};
    var blockers = (pv.blockers || []).filter(Boolean);
    if(blockers.length){
      return UI.showConfirm({
        title:"不能更换所属项目",
        msg:'「' + esc(d.title) + '」还有不能随迁的内容：<br>'
          + blockers.map(function(b){ return "· " + esc(b); }).join("<br>"),
        okText:"知道了", cancelText:"关闭", danger:true
      }).then(function(){ return false; });
    }
    return UI.showConfirm({
      title:"更换所属项目？",
      msg:'把「' + esc(d.title) + '」从「' + esc(srcName) + '」移到「' + esc(targetName) + '」。<br>'
        + '项目决定成员权限、分类与统计口径：迁移后没有目标项目权限的成员将看不到这条需求，'
        + '工作项与用例也会跟着换项目并重新取号。',
      okText:"继续", cancelText:"再想想", danger:false
    }).then(function(ok){
      if(!ok) return false;
      return UI.showConfirm({
        title:"确认级联迁移",
        msg:demandMoveDetailHTML(pv, d, targetName),
        okText:"确认迁移", cancelText:"取消", danger:true
      });
    });
  });
}
function demandMoveDetailHTML(pv, d, targetName){
  var rows = [];
  var tasks = Number(pv.tasks) || 0;
  if(tasks){
    var extra = [];
    if(pv.startedTasks) extra.push("已开工 " + pv.startedTasks + " 项");
    if(pv.trashedTasks) extra.push("回收站 " + pv.trashedTasks + " 项");
    rows.push("工作项 " + tasks + " 项" + (extra.length ? "（" + extra.join("、") + "）" : "")
      + "：按目标项目重新取号；版本绑定、原项目用例关联与不属于目标项目的分类会解除");
  }
  if(pv.cases){
    rows.push("用例 " + pv.cases + " 条：按目标项目重新取号"
      + (pv.planLinks ? "，并从原项目测试计划移出 " + pv.planLinks + " 处圈选" : ""));
  }
  if(pv.versionName){
    rows.push("原排期（版本「" + pv.versionName + "」）不属于目标项目，将一并撤销");
  }
  var stays = [];
  if(pv.docLinks) stays.push("关联文档 " + pv.docLinks + " 份");
  if(pv.releases) stays.push("历史发布记录 " + pv.releases + " 条");
  return '将要迁移到「' + esc(targetName) + '」：<br>'
    + (rows.length ? rows.map(function(r){ return "· " + esc(r); }).join("<br>") : "· 没有工作项或用例随迁")
    + (stays.length ? "<br><br>留在原项目（只解除引用）：" + esc(stays.join("、")) : "")
    + "<br><br>迁移立即生效，不能一键撤回。";
}
/* ---------- 列表智能视图（预置 Tab + 自定义视图，参考任务列表） ---------- */

var DEM_PRESETS = [["all","全部需求"],["review","待评审"],["pass","已通过"],["plan","已排期"],["done","已完成"],["closed","已关闭"]];
var DEM_GROUPS = ["none","status","priority","set","project","kind"];
var DEM_SORTS = ["default","priority","expect","wsjf","created"];
var DEM_GROUP_LABELS = { none:"不分组", status:"按状态", priority:"按优先级", set:"按项目集", project:"按项目", kind:"按类型" };
var DEM_SORT_LABELS = { default:"默认排序", priority:"按优先级", expect:"按期望交付", wsjf:"按 WSJF", created:"按提交时间" };
var DEM_STATE_KEY = "ds.demandView.v1";
var demSmart = { current:"all", preset:"all", group:"kind", subgroup:"none", sort:"default", pris:[], kinds:[], cats:[], reqs:[], q:"", collapsed:{} };
function normalizeDemPreset(value){
  return value === "rej" || value === "canceled" || value === "cancelled" ? "closed" : value;
}
var demSmartBar = null, demTabsBox = null, demSearchInput = null, demQTimer = null;

function demBaseRows(){
  /* 列表模式的筛选已下推服务端：本地只渲染已加载页，避免分页后二次过滤导致条数对不上 */
  if(demandServerFiltered) return demands;
  return demands.filter(function(d){
    if(demSmart.preset !== "all" && d.status !== demSmart.preset) return false;
    if(demSmart.pris.length && demSmart.pris.indexOf(d.priority || "P2") === -1) return false;
    if(demSmart.kinds.length && demSmart.kinds.indexOf(d.itemKind || "其他") === -1) return false;
    if(demSmart.cats.length && demSmart.cats.indexOf(d.categoryId || "") === -1) return false;
    if(demSmart.reqs.length && demSmart.reqs.indexOf(d.reqId) === -1) return false;
    if(demSmart.q){
      var hay = ((d.title || "") + "\n" + (d.description || "") + "\n" + (d.source || "") + "\n" + catNameById(d.categoryId)).toLowerCase();
      if(hay.indexOf(demSmart.q.toLowerCase()) === -1) return false;
    }
    return true;
  });
}
function demCompare(a, b){
  if(demSmart.sort === "priority") return priRank(a.priority) - priRank(b.priority)
    || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  if(demSmart.sort === "expect") return String(a.expectDate || "9999").localeCompare(String(b.expectDate || "9999"));
  if(demSmart.sort === "wsjf") return (Number(b.wsjfScore) || 0) - (Number(a.wsjfScore) || 0);
  if(demSmart.sort === "created") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  return (STATUS_ORDER[a.status] === undefined ? 9 : STATUS_ORDER[a.status]) - (STATUS_ORDER[b.status] === undefined ? 9 : STATUS_ORDER[b.status])
    || priRank(a.priority) - priRank(b.priority)
    || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}
function demSorted(rows){
  /* 服务端已按所选排序返回，翻页追加后仍保持全局顺序 */
  if(demandServerFiltered) return rows.slice();
  return rows.slice().sort(demCompare);
}
function demSetIdOfReq(reqId){
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === reqId) return rt.reqList[i].setId || "";
  return "";
}
function demGroupInfoBy(d, dim){
  if(dim === "status") return {key:d.status, label:statusName(d.status)};
  if(dim === "priority") return {key:d.priority || "P2", label:priName(d.priority || "P2")};
  if(dim === "set"){
    var setId = demSetIdOfReq(d.reqId);
    return {key:setId || "__none", label:setNameById(setId) || "未归组"};
  }
  if(dim === "project") return {key:d.reqId || "__none", label:d.reqId ? (reqNameById(d.reqId) || "未归类") : "未归类"};
  if(dim === "kind") return {key:d.itemKind || "其他", label:d.itemKind || "其他"};
  return null;
}
/* 二级维度不能与一级重复；一级不分组时二级无意义 */
function demSubDim(){
  return (demSmart.group === "none" || demSmart.subgroup === "none" || demSmart.subgroup === demSmart.group)
    ? "none" : demSmart.subgroup;
}
function demGroupCompare(dim){
  if(dim === "status")
    return function(a, b){
      return (STATUS_ORDER[a.key] === undefined ? 9 : STATUS_ORDER[a.key]) - (STATUS_ORDER[b.key] === undefined ? 9 : STATUS_ORDER[b.key]);
    };
  if(dim === "priority") return function(a, b){ return priRank(a.key) - priRank(b.key); };
  if(dim === "set"){
    return function(a, b){
      var order = {};
      (rt.projectSets || []).forEach(function(s, i){ order[s.id] = Number(s.sortOrder) || i; });
      var ai = order[a.key] === undefined ? 9999 : order[a.key];
      var bi = order[b.key] === undefined ? 9999 : order[b.key];
      return ai - bi || a.label.localeCompare(b.label, "zh-CN");
    };
  }
  return function(a, b){ return a.label.localeCompare(b.label, "zh-CN"); };
}
function demGroups(){
  if(demSmart.group === "none") return [];
  var subDim = demSubDim();
  var groups = [];
  demBaseRows().forEach(function(d){
    var info = demGroupInfoBy(d, demSmart.group), group = null;
    for(var i = 0; i < groups.length; i++) if(groups[i].key === info.key){ group = groups[i]; break; }
    if(!group){ group = {key:info.key, label:info.label, rows:[], subs:[]}; groups.push(group); }
    group.rows.push(d);
    if(subDim !== "none"){
      var sinfo = demGroupInfoBy(d, subDim), sub = null;
      for(var j = 0; j < group.subs.length; j++) if(group.subs[j].key === sinfo.key){ sub = group.subs[j]; break; }
      if(!sub){ sub = {key:sinfo.key, label:sinfo.label, rows:[]}; group.subs.push(sub); }
      sub.rows.push(d);
    }
  });
  groups.forEach(function(g){
    g.rows = demSorted(g.rows);
    g.subs.forEach(function(s){ s.rows = demSorted(s.rows); });
    g.subs.sort(demGroupCompare(subDim));
  });
  groups.sort(demGroupCompare(demSmart.group));
  return groups;
}
function demViewRows(){
  if(demSmart.group === "none") return demSorted(demBaseRows());
  return demGroups().reduce(function(all, g){ return all.concat(g.rows); }, []);
}
function demFilterCount(){
  return demSmart.pris.length + demSmart.kinds.length + demSmart.cats.length + demSmart.reqs.length + (demSmart.q ? 1 : 0);
}
/* ---------- 看板紧凑搜索/筛选（聚焦项目搜该项目，「全部项目」搜整个空间；条件与列表共用） ---------- */
function demBoardFilterCount(){
  return demSmart.pris.length + demSmart.kinds.length + demSmart.cats.length;
}
function demBoardHasCond(){
  return demBoardFilterCount() > 0 || !!demSmart.q;
}
/* 页头按原型 p-demands 收敛：计数进 H1 胶囊（全页只一处），副标题写定位，
   主操作固定为「导出 + 新建需求」；工作页有自己的标题与返回，不叠加页头动作 */
function syncDemandsPageHead(){
  if(activeView !== "demands") return;
  var pill = $("pagePill");
  var total = demandBoard ? Number(demandBoard.totalAll || 0) : Number(demandTotal || 0);
  var matched = demandBoard && demandBoard.counts ? Number(demandBoard.counts.all || 0) : total;
  if(pill){
    if(!demWork.active && total){
      pill.hidden = false;
      pill.textContent = (demBoardHasCond() || demandServerFiltered) && matched !== total
        ? "匹配 " + matched + " / " + total
        : total + " 条";
    }else{
      pill.hidden = true;
      pill.textContent = "";
    }
  }
  var sub = $("pageSub");
  if(sub){
    sub.textContent = ((rt.currentWs && rt.currentWs.name) ? rt.currentWs.name + " / " : "") + "需求池";
  }
  var acts = $("pageActions");
  if(acts){
    /* 手机档位 pagehead 折叠为零高，页级按钮会从标题下方溢出被工具条裁切；
       创建入口继续走右下 FAB（#btnNew），与全站手机口径一致 */
    if(demWork.active || isMobile()){
      acts.hidden = true;
      acts.innerHTML = "";
      acts.__demActs = "";
    }else{
      var mode = listPrefs.viewMode("demand-pool");
      /* 看板聚焦到只读项目时不显示新建；列表/甘特为全空间，只要有一个可写项目即可 */
      var canNew = writableReqs().length > 0
        && (mode !== "board" || (!rt.demandReqId || canEditReq(rt.demandReqId)));
      var html = '<button class="btn" type="button" data-dem-head-export>' + icon("download", 14) + '导出</button>'
        + (canNew ? '<button class="btn primary" type="button" data-dem-head-new>' + icon("plus", 15) + '新建需求</button>' : "");
      /* 路由切走会清空 innerHTML 但保留 dataset：这里用 firstChild 兜底重写 */
      if(acts.__demActs !== html || !acts.firstChild){
        acts.__demActs = html;
        acts.innerHTML = html;
      }
      acts.hidden = false;
    }
  }
  var nw = $("newWrap");
  /* 看板/列表/甘特桌面用页头「新建需求」；手机保留右下 FAB；
     工作页没有页级动作，桌面继续挂通用「新建」菜单，避免整页没有创建入口 */
  if(nw) nw.hidden = !isMobile() && !demWork.active;
}
function syncDemBoard(){
  if(!demBoardBar) return;
  var mode = listPrefs.viewMode("demand-pool");
  demBoardBar.hidden = demWork.active || mode !== "board";
  if(demBoardInput){
    demBoardInput.placeholder = rt.demandReqId ? "搜索本项目需求…" : "搜索全部项目需求…";
    if(demBoardInput.value !== demSmart.q) demBoardInput.value = demSmart.q;
  }
  var fc = demBoardBar.querySelector("[data-demb-fcount]");
  if(fc){ var n = demBoardFilterCount(); fc.hidden = n === 0; fc.textContent = n; }
  var clr = demBoardBar.querySelector("[data-demb-clear]");
  if(clr) clr.hidden = !demBoardHasCond();
  var stageSel = demBoardBar.querySelector("[data-demb-stage]");
  if(stageSel){
    stageSel.innerHTML = demBoardStageOptionsHTML();
    stageSel.value = demBoardStage;
    stageSel.classList.toggle("active", demBoardStage !== "all");
  }
  /* 作用范围只在项目下拉表达，工具条里不再重复；条数由页头 meta 给 */
}
function renderDemTabs(){
  if(!demTabsBox) return;
  var html = DEM_PRESETS.map(function(p){
    var on = demSmart.current === p[0];
    return '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-dem-preset="' + p[0] + '">' + p[1] + '</button>';
  }).join("");
  html += savedViewsFor("demand").map(function(v){
    var id = String(v.id), on = demSmart.current === id;
    return '<span class="smart-view-custom">' +
      '<button class="smart-view-tab' + (on ? ' on' : '') + '" type="button" role="tab" aria-selected="' + on + '" data-dem-view="' + esc(id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="smart-view-del" type="button" data-dem-view-del="' + esc(id) + '" title="删除视图" aria-label="删除视图：' + esc(v.name) + '">' + icon("close", 11) + '</button></span>';
  }).join("");
  /* 保存视图属于「视图」本身，跟页签同排右对齐；工具行只留筛选、显示与导出 */
  html += '<span class="smart-view-spacer"></span>' +
    '<button class="btn sm ghost smart-view-save" type="button" data-dem-save>＋ 保存视图</button>';
  demTabsBox.innerHTML = html;
}
/* 输入框里的值必须与应用状态一致：没有搜索词时清掉浏览器回填的残留 */
function reconcileDemSearchInputs(){
  if(demSmart.q) return;
  [demSearchInput, demBoardInput].forEach(function(el){
    if(el && el.value && el !== document.activeElement) el.value = "";
  });
}
window.addEventListener("pageshow", reconcileDemSearchInputs);
window.addEventListener("focus", reconcileDemSearchInputs);
var demSearchWatch = setInterval(reconcileDemSearchInputs, 1000);
setTimeout(function(){ clearInterval(demSearchWatch); }, 30000);
function syncDemControls(){
  if(demSmartBar){
    var g = demSmartBar.querySelector("[data-dem-group]");
    if(g) g.value = demSmart.group;
    var sg = demSmartBar.querySelector("[data-dem-subgroup]");
    if(sg){ sg.value = demSmart.subgroup; sg.disabled = demSmart.group === "none"; }
    var s = demSmartBar.querySelector("[data-dem-sort]");
    if(s) s.value = demSmart.sort;
    if(demSearchInput) demSearchInput.value = demSmart.q;
    var fc = demSmartBar.querySelector("[data-dem-fcount]");
    if(fc){ var n = demFilterCount(); fc.hidden = n === 0; fc.textContent = n; }
  }
  if(demBoardBar){
    var bg = demBoardBar.querySelector("[data-demb-group]");
    if(bg) bg.value = demSmart.group;
    var bsg = demBoardBar.querySelector("[data-demb-subgroup]");
    if(bsg){ bsg.value = demSmart.subgroup; bsg.disabled = demSmart.group === "none"; }
    var bs = demBoardBar.querySelector("[data-demb-sort]");
    if(bs) bs.value = demSmart.sort;
    var echo = demBoardBar.querySelector("[data-demb-echo]");
    if(echo) echo.textContent = DEM_GROUP_LABELS[demSmart.group] || "不分组";
    var bfc = demBoardBar.querySelector("[data-demb-fcount]");
    if(bfc){ var bn = demBoardFilterCount(); bfc.hidden = bn === 0; bfc.textContent = bn; }
  }
  renderDemTabs();
}
function saveDemState(){
  var ws = rt.currentWs && rt.currentWs.id;
  if(!ws) return;
  try{
    localStorage.setItem(DEM_STATE_KEY, JSON.stringify({
      wsId: ws,
      view: {
        current: demSmart.current, preset: demSmart.preset, group: demSmart.group, subgroup: demSmart.subgroup, sort: demSmart.sort,
        /* 关键词属于临时查询上下文，不跨会话恢复 */
        pris: demSmart.pris.slice(), kinds: demSmart.kinds.slice(),
        cats: demSmart.cats.slice(), reqs: demSmart.reqs.slice(), boardStage: demBoardStage,
        gantt: { scale: demGantt.scale, rangeMode: demGantt.rangeMode, zoomDayW: demGantt.zoomDayW }
      }
    }));
  }catch(e){ /* 隐私模式/受限环境忽略 */ }
}
function demStrArr(v){
  if(!Array.isArray(v)) return [];
  return v.filter(function(x){ return typeof x === "string"; });
}
function restoreDemState(){
  /* 工作区切换后旧区间的像素位置/锚点月份不可复用 */
  function resetGanttTransient(){
    demGantt.anchorMonth = null;
    demGantt.range = null;
    demGantt.scrolled = false;
    demGantt.scrollLeft = 0;
    demGantt.notice = "";
  }
  if(!rt.currentWs){ resetGanttTransient(); return; }
  var snap;
  try{ snap = JSON.parse(localStorage.getItem(DEM_STATE_KEY) || "null"); }
  catch(e){ resetGanttTransient(); return; }
  if(!snap || snap.wsId !== rt.currentWs.id || !snap.view){
    resetGanttTransient();
    return;
  }
  var v = snap.view;
  var preset = normalizeDemPreset(v.preset);
  demSmart.current = typeof v.current === "string" ? v.current : "all";
  demSmart.preset = DEM_PRESETS.some(function(p){ return p[0] === preset; }) ? preset : "all";
  demSmart.group = DEM_GROUPS.indexOf(v.group) !== -1 ? v.group : "none";
  demSmart.subgroup = (demSmart.group !== "none" && DEM_GROUPS.indexOf(v.subgroup) !== -1 && v.subgroup !== demSmart.group) ? v.subgroup : "none";
  demSmart.sort = DEM_SORTS.indexOf(v.sort) !== -1 ? v.sort : "default";
  demSmart.pris = demStrArr(v.pris);
  demSmart.kinds = demStrArr(v.kinds);
  demSmart.cats = demStrArr(v.cats);
  demSmart.reqs = demStrArr(v.reqs);
  /* 旧快照里的关键词不再恢复，避免登录/刷新后搜索框自动出现上次的词 */
  demSmart.q = "";
  demBoardStage = v.boardStage === "all" || DELIVERY_STAGES.some(function(s){ return s[0] === v.boardStage; }) ? (v.boardStage || "all") : "all";
  if(v.gantt && typeof v.gantt === "object"){
    if(["day", "week", "month"].indexOf(v.gantt.scale) !== -1) demGantt.scale = v.gantt.scale;
    if(["auto", "month"].indexOf(v.gantt.rangeMode) !== -1) demGantt.rangeMode = v.gantt.rangeMode;
    if([20, 28, 40].indexOf(v.gantt.zoomDayW) !== -1) demGantt.zoomDayW = v.gantt.zoomDayW;
  }
  resetGanttTransient();
}
function demStateChanged(){
  syncDemControls();
  /* 三种模式的搜索/筛选/排序都下推服务端：看板也要重新取每一列的首屏与匹配数 */
  loadDemands();
  saveDemState();
}
function activateDemPreset(id){
  var ok = false;
  DEM_PRESETS.forEach(function(p){ if(p[0] === id) ok = true; });
  if(!ok) return;
  UI.closeAllPops();
  demSmart.current = id;
  demSmart.preset = id;
  demSmart.group = "none";
  demSmart.subgroup = "none";
  demSmart.sort = "default";
  demSmart.pris = []; demSmart.kinds = []; demSmart.cats = []; demSmart.reqs = []; demSmart.q = "";
  demSmart.collapsed = {};
  demStateChanged();
}
function applyDemView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "demand"){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  UI.closeAllPops();
  var preset = normalizeDemPreset(p.preset);
  demSmart.current = String(v.id);
  demSmart.preset = DEM_PRESETS.some(function(x){ return x[0] === preset; }) ? preset : "all";
  demSmart.group = DEM_GROUPS.indexOf(p.group) !== -1 ? p.group : "none";
  demSmart.subgroup = (demSmart.group !== "none" && DEM_GROUPS.indexOf(p.subgroup) !== -1 && p.subgroup !== demSmart.group) ? p.subgroup : "none";
  demSmart.sort = DEM_SORTS.indexOf(p.sort) !== -1 ? p.sort : "default";
  demSmart.pris = demStrArr(p.pris);
  demSmart.kinds = demStrArr(p.kinds);
  demSmart.cats = pruneUnknownCats(demStrArr(p.cats));
  demSmart.reqs = demStrArr(p.reqs);
  demSmart.q = typeof p.q === "string" ? p.q : "";
  demSmart.collapsed = {};
  demStateChanged();
  toast("已应用视图「" + v.name + "」", "fs");
}
function demPresetName(id){
  for(var i = 0; i < DEM_PRESETS.length; i++) if(DEM_PRESETS[i][0] === id) return DEM_PRESETS[i][1];
  return "";
}
function currentDemViewName(){
  var id = String(demSmart.current);
  var views = savedViewsFor("demand");
  for(var i = 0; i < views.length; i++) if(String(views[i].id) === id) return views[i].name;
  return "";
}
function saveDemView(){
  UI.showPrompt({
    title:"保存自定义视图",
    desc:"保存需求池当前的筛选、分组与排序；同名保存将覆盖原视图",
    label:"视图名称（≤20 字）",
    maxLength:20,
    okText:"保存"
  }).then(function(name){
    if(name === null) return;
    name = String(name).trim().slice(0, 20);
    if(!name){ toast("请填写视图名称", "warn"); return; }
    var overwrite = savedViewsFor("demand").some(function(v){ return v.name === name; });
    var params = JSON.stringify({
      scope:"demand",
      preset:demSmart.preset, group:demSmart.group, subgroup:demSmart.subgroup, sort:demSmart.sort,
      q:demSmart.q, pris:demSmart.pris.slice(), kinds:demSmart.kinds.slice(),
      cats:demSmart.cats.slice(), reqs:demSmart.reqs.slice()
    });
    API.post("/api/views", { name:name, params:params }).then(function(saved){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(function(){
        if(saved) demSmart.current = String(saved.id);
        renderDemTabs();
        saveDemState();
      });
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteDemView(id){
  UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响需求数据。", okText:"删除视图" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      if(demSmart.current === String(id)) activateDemPreset("all");
      loadViews().then(renderDemTabs);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function demFilterMenuHTML(boardOnly){
  var counts = { pris:{}, kinds:{}, reqs:{}, cats:{} };
  var facets = boardOnly && demandBoard && demandBoard.facets;
  if(facets){
    /* 看板只下发每列首屏，且不受列表状态页签影响：计数取服务端按「当前项目 + 搜索词」聚合的全量结果 */
    counts.pris = facets.pris || {};
    counts.kinds = facets.kinds || {};
    counts.cats = facets.cats || {};
  }else{
    var base = demands.filter(function(d){ return boardOnly || demSmart.preset === "all" || d.status === demSmart.preset; });
    base.forEach(function(d){
      var p = d.priority || "P2", k = d.itemKind || "其他", r = d.reqId || "__none", c = d.categoryId || "";
      counts.pris[p] = (counts.pris[p] || 0) + 1;
      counts.kinds[k] = (counts.kinds[k] || 0) + 1;
      counts.reqs[r] = (counts.reqs[r] || 0) + 1;
      counts.cats[c] = (counts.cats[c] || 0) + 1;
    });
  }
  function section(title, inner){
    if(!inner) return "";
    return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
  }
  var priInner = Object.keys(PRI_ORDER).map(function(p){
    var on = demSmart.pris.indexOf(p) !== -1;
    if(!(counts.pris[p] > 0) && !on) return "";
    return '<button class="chip" type="button" data-dem-f="pris" data-dem-fv="' + esc(p) + '" aria-pressed="' + on + '">' +
      esc(priName(p)) + ' <span class="n">' + (counts.pris[p] || 0) + '</span></button>';
  }).join("");
  var kindNames = ["新功能","体验优化","缺陷","其他"];
  Object.keys(counts.kinds).forEach(function(k){ if(kindNames.indexOf(k) === -1) kindNames.push(k); });
  var kindInner = kindNames.map(function(k){
    var on = demSmart.kinds.indexOf(k) !== -1;
    if(!(counts.kinds[k] > 0) && !on) return "";
    return '<button class="chip" type="button" data-dem-f="kinds" data-dem-fv="' + esc(k) + '" aria-pressed="' + on + '">' +
      esc(k) + ' <span class="n">' + (counts.kinds[k] || 0) + '</span></button>';
  }).join("");
  /* 分类只在单项目范围内有意义：看板取当前项目；列表要求恰好选中一个项目。
     跨项目不再下发分类 chip，避免把不同项目的同名分类混在一起筛。 */
  var catScopeReq = boardOnly
    ? (rt.demandReqId || "")
    : (demSmart.reqs.length === 1 ? demSmart.reqs[0] : "");
  var catOptions = catScopeReq
    ? (rt.categoriesCache || []).filter(function(c){ return c.projectId === catScopeReq; })
    : [];
  /* 空分类只用于分组呈现，不放进筛选项：服务端筛选按分类ID传参，空值无法与"未传"区分 */
  var catInner = catOptions.filter(function(o){ return o.id !== ""; }).map(function(o){
    var on = demSmart.cats.indexOf(o.id) !== -1;
    if(!(counts.cats[o.id] > 0) && !on) return "";
    return '<button class="chip" type="button" data-dem-f="cats" data-dem-fv="' + esc(o.id) + '" aria-pressed="' + on + '">' +
      esc(o.name) + ' <span class="n">' + (counts.cats[o.id] || 0) + '</span></button>';
  }).join("");
  var reqInner = "";
  projectGroups(rt.reqList).forEach(function(g){
    var chips = g.rows.map(function(r){
      var on = demSmart.reqs.indexOf(r.id) !== -1;
      if(!(counts.reqs[r.id] > 0) && !on) return "";
      return '<button class="chip" type="button" data-dem-f="reqs" data-dem-fv="' + esc(r.id) + '" aria-pressed="' + on + '">' +
        esc(r.name) + (r.containerKind ? "（公共）" : "") + ' <span class="n">' + (counts.reqs[r.id] || 0) + '</span></button>';
    }).filter(Boolean);
    if(!chips.length) return;
    /* 组头项目数按实际露出的 chip 计，避免与 0 计数被隐藏的行对不上 */
    reqInner += '<div class="fdd-grp"><span>' + esc(g.set ? g.set.name : "未分组") + '</span>'
      + '<span class="n">' + chips.length + ' 个项目</span></div>' + chips.join("");
  });
  var html = '<div class="menu-title">筛选需求</div>' +
    section("优先级", priInner) + section("类型", kindInner) + section("分类", catInner)
    + (boardOnly ? "" : section("项目", reqInner));
  if(!priInner && !kindInner && !catInner && (boardOnly || !reqInner)){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">当前条件下没有可筛选的选项。</p></div>';
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-dem-f-reset>清空筛选</button></div>';
  return html;
}
function openDemFilterPop(anchor, boardOnly){
  var el = document.createElement("div");
  el.className = "menu popover filter-dd";
  el.innerHTML = demFilterMenuHTML(boardOnly);
  el.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-f-reset]")){
      demSmart.pris = []; demSmart.kinds = []; demSmart.cats = []; demSmart.reqs = [];
      el.innerHTML = demFilterMenuHTML(boardOnly);
      demStateChanged();
      return;
    }
    var b = e.target.closest("[data-dem-f]");
    if(!b) return;
    var prevCatScope = demSmart.reqs.length === 1 ? demSmart.reqs[0] : "";
    var arr = demSmart[b.dataset.demF], i = arr.indexOf(b.dataset.demFv);
    if(i === -1) arr.push(b.dataset.demFv); else arr.splice(i, 1);
    /* 分类候选只属于一个项目：项目范围一变就清空已选分类，避免筛出空结果 */
    if(b.dataset.demF === "reqs"){
      var nextCatScope = demSmart.reqs.length === 1 ? demSmart.reqs[0] : "";
      if(nextCatScope !== prevCatScope) demSmart.cats = [];
    }
    el.innerHTML = demFilterMenuHTML(boardOnly);
    demStateChanged();
  });
  UI.openPop(el, anchor, {align:"left", width:320, onClose:function(){ el.remove(); }});
}
function demCsvCell(value){
  var s = value === null || value === undefined ? "" : String(value);
  if(!/^-?\d+(\.\d+)?$/.test(s) && /^\s*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function demCsvValue(d, key){
  if(key === "title") return d.title || "";
  if(key === "kind") return d.itemKind || "";
  if(key === "category") return catNameById(d.categoryId);
  if(key === "priority") return d.priority || "";
  if(key === "status") return statusName(d.status);
  if(key === "project") return reqNameById(d.reqId) || "";
  if(key === "version") return demandVersionName(d);
  if(key === "expectDate") return d.expectDate ? String(d.expectDate).substring(0, 10) : "";
  if(key === "wsjf") return (d.wsjfScore === null || d.wsjfScore === undefined) ? "" : (Math.round(d.wsjfScore * 10) / 10);
  if(key === "source") return d.source || "";
  if(key === "createdAt") return d.createdAt ? fmtTs(d.createdAt) : "";
  return "";
}
function exportDemCsv(){
  var rows = demViewRows();
  if(!rows.length){ toast("当前视图没有可导出的需求", "warn"); return; }
  var cols = listPrefs.columns("demand-pool"), labels = listPrefs.labels("demand-pool");
  var lines = [cols.map(function(key){ return labels[key]; })];
  rows.forEach(function(d){ lines.push(cols.map(function(key){ return demCsvValue(d, key); })); });
  var csv = "\uFEFF" + lines.map(function(line){ return line.map(demCsvCell).join(","); }).join("\r\n");
  var name = currentDemViewName() || demPresetName(demSmart.preset) || "需求池列表";
  name = name.replace(/[\\/:*?"<>|]/g, "-");
  triggerDownload(name + "-" + rt.TODAY_ISO + ".csv", csv, "text/csv;charset=utf-8;");
  toast("已导出当前视图 " + rows.length + " 条", "fs");
}
function initDemSmartBar(){
  if(demSmartBar) return;
  var page = $("demandsPage");
  if(!page || !demandBody) return;
  demSmartBar = document.createElement("div");
  demSmartBar.className = "smart-list-bar";
  demSmartBar.hidden = true;
  demSmartBar.innerHTML =
    '<div class="smart-view-tabs" role="tablist" aria-label="需求视图"></div>' +
    '<div class="smart-view-tools">' +
      '<span class="sv-seg-label">筛选</span>' +
      '<input class="input dem-search" type="search" data-dem-q placeholder="搜索全部需求…" title="在当前空间需求池中搜索需求 / 描述 / 来源 / 分类 / 编号" aria-label="搜索当前空间全部需求" />' +
      '<button class="chip ghost" type="button" data-dem-filter aria-haspopup="true" aria-expanded="false" title="筛选需求（优先级 / 类型 / 分类 / 项目）">更多筛选 <span class="n" data-dem-fcount hidden>0</span>' + icon("caretDown", 12) + '</button>' +
      '<span class="sv-seg-label sv-seg-end">显示</span>' +
      '<label class="smart-view-control"><span>分组</span><select class="mini-select" data-dem-group aria-label="分组方式">' +
        '<option value="none">不分组</option><option value="status">按状态</option><option value="priority">按优先级</option>' +
        '<option value="set">按项目集</option><option value="project">按项目</option><option value="kind">按类型</option></select></label>' +
      '<label class="smart-view-control"><span>二级</span><select class="mini-select" data-dem-subgroup aria-label="二级分组方式">' +
        '<option value="none">不分组</option><option value="status">按状态</option><option value="priority">按优先级</option>' +
        '<option value="set">按项目集</option><option value="project">按项目</option><option value="kind">按类型</option></select></label>' +
      '<label class="smart-view-control"><span>排序</span><select class="mini-select" data-dem-sort aria-label="排序方式">' +
        '<option value="default">默认排序</option><option value="priority">按优先级</option>' +
        '<option value="expect">按期望交付</option><option value="wsjf">按 WSJF</option><option value="created">按提交时间</option></select></label>' +
      '<span class="smart-view-spacer"></span>' +
    '</div>';
  page.insertBefore(demSmartBar, demandBody);
  if(demandGanttBar) page.insertBefore(demandGanttBar, demandBody);
  demBoardBar = document.createElement("div");
  demBoardBar.className = "dem-board-bar";
  demBoardBar.hidden = true;
  demBoardBar.innerHTML =
    '<input class="input demb-search" type="search" data-demb-q placeholder="搜索本项目需求…" title="在当前项目需求中搜索标题 / 描述 / 来源 / 分类 / 编号" aria-label="搜索当前项目需求" />' +
    '<button class="chip ghost" type="button" data-demb-filter aria-haspopup="true" aria-expanded="false" title="筛选当前项目需求（优先级 / 类型 / 分类）">筛选 <span class="n" data-demb-fcount hidden>0</span>' + icon("caretDown", 12) + '</button>' +
    '<button class="chip ghost demb-clear" type="button" data-demb-clear hidden>清除</button>' +
    demBoardStageFilterHTML() +
    '<span class="demb-spacer"></span>' +
    '<details class="gantt-more demb-display" id="demBoardDisplay">' +
      '<summary class="btn sm ghost mine-display-summary" title="列内分组、二级分组与排序">' +
        icon("filter", 14) + '显示 · <span data-demb-echo>不分组</span>' + icon("caretDown", 12) +
      '</summary>' +
      '<div class="menu popover board-display-menu">' +
        '<div class="mine-display-head">显示设置<span>需求池</span></div>' +
        '<label class="gantt-more-row"><span class="gantt-more-label">分组</span><select class="mini-select" data-demb-group aria-label="列内一级分组方式">' +
          DEM_GROUPS.map(function(g){ return '<option value="' + g + '">' + DEM_GROUP_LABELS[g] + '</option>'; }).join("") + '</select></label>' +
        '<label class="gantt-more-row"><span class="gantt-more-label">二级</span><select class="mini-select" data-demb-subgroup aria-label="列内二级分组方式">' +
          DEM_GROUPS.map(function(g){ return '<option value="' + g + '">' + DEM_GROUP_LABELS[g] + '</option>'; }).join("") + '</select></label>' +
        '<label class="gantt-more-row"><span class="gantt-more-label">排序</span><select class="mini-select" data-demb-sort aria-label="列内排序方式">' +
          DEM_SORTS.map(function(s){ return '<option value="' + s + '">' + DEM_SORT_LABELS[s] + '</option>'; }).join("") + '</select></label>' +
        '<div class="mine-display-note">列始终是需求状态；分组只决定卡片在列内如何归堆，不改变拖拽流转。</div>' +
      '</div>' +
    '</details>';
  page.insertBefore(demBoardBar, demandBody);
  demBoardInput = demBoardBar.querySelector("[data-demb-q]");
  demBoardBar.addEventListener("change", function(e){
    var g = e.target.closest("[data-demb-group]");
    if(g){
      if(DEM_GROUPS.indexOf(g.value) === -1) return;
      demSmart.group = g.value;
      if(demSmart.group === "none" || demSmart.group === demSmart.subgroup) demSmart.subgroup = "none";
      demSmart.collapsed = {};
      demStateChanged();
      return;
    }
    var sg = e.target.closest("[data-demb-subgroup]");
    if(sg){
      if(DEM_GROUPS.indexOf(sg.value) === -1) return;
      demSmart.subgroup = sg.value;
      demSmart.collapsed = {};
      demStateChanged();
      return;
    }
    var so = e.target.closest("[data-demb-sort]");
    if(so){
      if(DEM_SORTS.indexOf(so.value) === -1) return;
      demSmart.sort = so.value;
      demStateChanged();
      return;
    }
    var sel = e.target.closest("[data-demb-stage]");
    if(!sel) return;
    demBoardStage = sel.value === "all" || DELIVERY_STAGES.some(function(s){ return s[0] === sel.value; }) ? sel.value : "all";
    saveDemState();
    loadDemands();
  });
  demBoardBar.addEventListener("click", function(e){
    if(e.target.closest("[data-demb-clear]")){
      demSmart.q = "";
      demSmart.pris = []; demSmart.kinds = []; demSmart.cats = [];
      if(demBoardInput) demBoardInput.value = "";
      demStateChanged();
      return;
    }
    var fb = e.target.closest("[data-demb-filter]");
    if(fb){ openDemFilterPop(fb, true); return; }
  });
  if(demBoardInput) demBoardInput.addEventListener("input", function(){
    if(demBoardTimer) clearTimeout(demBoardTimer);
    demBoardTimer = setTimeout(function(){
      demBoardTimer = null;
      demSmart.q = demBoardInput.value.trim();
      demStateChanged();
    }, 300);
  });
  demTabsBox = demSmartBar.querySelector(".smart-view-tabs");
  demSearchInput = demSmartBar.querySelector("[data-dem-q]");
  demSmartBar.addEventListener("click", function(e){
    var del = e.target.closest("[data-dem-view-del]");
    if(del){ deleteDemView(del.dataset.demViewDel); return; }
    var preset = e.target.closest("[data-dem-preset]");
    if(preset){ activateDemPreset(preset.dataset.demPreset); return; }
    var sv = e.target.closest("[data-dem-view]");
    if(sv){
      var views = savedViewsFor("demand");
      for(var i = 0; i < views.length; i++){
        if(String(views[i].id) === sv.dataset.demView){ applyDemView(views[i]); return; }
      }
      return;
    }
    if(e.target.closest("[data-dem-save]")){ saveDemView(); return; }
    if(e.target.closest("[data-dem-export]")){ exportDemCsv(); return; }
    var fb = e.target.closest("[data-dem-filter]");
    if(fb){ openDemFilterPop(fb); return; }
  });
  demSmartBar.addEventListener("change", function(e){
    var g = e.target.closest("[data-dem-group]");
    if(g){
      if(DEM_GROUPS.indexOf(g.value) === -1) return;
      demSmart.group = g.value;
      if(demSmart.group === "none" || demSmart.group === demSmart.subgroup) demSmart.subgroup = "none";
      demSmart.collapsed = {};
      /* 分组只在客户端展开，不改变服务端结果集 */
      if(listPrefs.viewMode("demand-pool") === "gantt"){
        syncDemControls();
        render();
        saveDemState();
      }else{
        demStateChanged();
      }
      return;
    }
    var sg = e.target.closest("[data-dem-subgroup]");
    if(sg){
      if(DEM_GROUPS.indexOf(sg.value) === -1) return;
      demSmart.subgroup = sg.value;
      demSmart.collapsed = {};
      if(listPrefs.viewMode("demand-pool") === "gantt"){
        syncDemControls();
        render();
        saveDemState();
      }else{
        demStateChanged();
      }
      return;
    }
    var s = e.target.closest("[data-dem-sort]");
    if(s){
      if(DEM_SORTS.indexOf(s.value) === -1) return;
      demSmart.sort = s.value;
      demStateChanged();
    }
  });
  if(demSearchInput) demSearchInput.addEventListener("input", function(){
    if(demQTimer) clearTimeout(demQTimer);
    demQTimer = setTimeout(function(){
      demQTimer = null;
      demSmart.q = demSearchInput.value.trim();
      demStateChanged();
    }, 300);
  });
  syncDemControls();
}

function demandMobileList(rows, groups){
  function cards(list){
    return list.map(function(d){ return cardHTML(d, { noDrag: true }); }).join("");
  }
  var body;
  if(demSmart.group === "none"){
    body = '<div class="dem-mob-cards">' + cards(rows) + '</div>';
  }else{
    body = groups.map(function(g){
      var collapsed = !!demSmart.collapsed["$" + g.key];
      var inner;
      if(collapsed){
        inner = "";
      }else if(!g.subs.length){
        inner = '<div class="dem-mob-cards">' + cards(g.rows) + '</div>';
      }else{
        inner = g.subs.map(function(s){
          var sc = !!demSmart.collapsed["$sub:" + g.key + "/" + s.key];
          return '<section class="dem-mob-subgroup">'
            + '<button type="button" class="dem-group-toggle dem-mob-subgroup-head" data-dem-subgroup-toggle="' + esc(g.key + "/" + s.key) + '" aria-expanded="' + (!sc) + '">'
            + '<span class="dem-group-caret' + (sc ? '' : ' open') + '">▶</span>'
            + '<span class="dem-group-name">' + esc(s.label) + '</span>'
            + '<span class="dem-group-count">' + s.rows.length + ' 条</span></button>'
            + (sc ? '' : '<div class="dem-mob-cards">' + cards(s.rows) + '</div>')
            + '</section>';
        }).join("");
      }
      return '<section class="dem-mob-group">'
        + '<button type="button" class="dem-group-toggle dem-mob-group-head" data-dem-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">'
        + '<span class="dem-group-caret' + (collapsed ? '' : ' open') + '">▶</span>'
        + '<span class="dem-group-name">' + esc(g.label) + '</span>'
        + '<span class="dem-group-count">' + g.rows.length + ' 条</span></button>'
        + inner
        + '</section>';
    }).join("");
  }
  var more = demandHasMore
    ? '<button class="bkl-more" type="button" data-dem-more="table">加载更多（已加载 ' + demands.length + ' / 共 ' + demandTotal + ' 条）</button>'
    : "";
  return '<div class="dem-mob-list">' + body + more + '</div>';
}
function renderDemandTable(){
  var rows = demViewRows(), groups = demGroups();
  var hasCond = demFilterCount() > 0 || demSmart.preset !== "all";
  if(demandsMeta){
    /* 条数统一由页头胶囊承担；工具条不再重复 */
    demandsMeta.textContent = "";
  }
  if(!demands.length){
    demandBody.innerHTML = UI.emptyState({
      icon: hasCond ? "filterOff" : "inbox",
      title: hasCond ? "没有符合当前视图条件的需求" : "需求池还是空的",
      text: hasCond ? "切换视图，或调整、清空筛选条件后重试。" : "点右上角「新建需求」录入第一条；评审通过后排期到版本。"
    });
    if(hasCond) bindRetry(demandBody, function(){ activateDemPreset("all"); });
    return;
  }
  /* 手机没有横向空间容纳 8 列表格：列表模式改用看板同款需求卡，字段按卡片的标签行折叠 */
  if(isMobile()){
    demandBody.innerHTML = demandMobileList(rows, groups);
    return;
  }
  var cols = listPrefs.columns("demand-pool"), labels = listPrefs.labels("demand-pool");
  var numCols = { expectDate:1, wsjf:1, createdAt:1 };
  function rowHTML(d, grouped){
    return '<tr' + (grouped ? ' class="dem-group-item-row"' : '') + '>' + cols.map(function(k){
      return '<td' + (numCols[k] ? ' class="num"' : '') + '>' + demandCell(d, k) + '</td>';
    }).join("")
      + '<td><span class="demand-row-acts">' + demandActs(d, { subtle: true }) + '</span></td></tr>';
  }
  var colspan = cols.length + 1;
  function groupHead(g){
    var collapsed = !!demSmart.collapsed["$" + g.key];
    return '<tr class="dem-group-row"><td colspan="' + colspan + '"><button type="button" class="dem-group-toggle" data-dem-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">' +
      '<span class="dem-group-caret' + (collapsed ? '' : ' open') + '">▶</span>' +
      '<span class="dem-group-name">' + esc(g.label) + '</span>' +
      '<span class="dem-group-count">' + g.rows.length + ' 条</span></button></td></tr>';
  }
  function subGroupHead(g, s){
    var collapsed = !!demSmart.collapsed["$sub:" + g.key + "/" + s.key];
    return '<tr class="dem-subgroup-row"><td colspan="' + colspan + '"><button type="button" class="dem-group-toggle" data-dem-subgroup-toggle="' + esc(g.key + "/" + s.key) + '" aria-expanded="' + (!collapsed) + '">' +
      '<span class="dem-group-caret' + (collapsed ? '' : ' open') + '">▶</span>' +
      '<span class="dem-group-name">' + esc(s.label) + '</span>' +
      '<span class="dem-group-count">' + s.rows.length + ' 条</span></button></td></tr>';
  }
  var body = "";
  if(demSmart.group === "none"){
    /* 不直接传 rowHTML：map 的 index 会漏进 grouped 参数，让第 2 行起误带分组缩进 */
    body = rows.map(function(d){ return rowHTML(d, false); }).join("");
  }else{
    body = groups.map(function(g){
      var head = groupHead(g);
      if(demSmart.collapsed["$" + g.key]) return head;
      if(!g.subs.length) return head + g.rows.map(function(d){
        return rowHTML(d, true);
      }).join("");
      return head + g.subs.map(function(s){
        var sc = !!demSmart.collapsed["$sub:" + g.key + "/" + s.key];
        return subGroupHead(g, s) + (sc ? "" : s.rows.map(function(d){
          return rowHTML(d, true);
        }).join(""));
      }).join("");
    }).join("");
  }
  if(demandHasMore){
    body += '<tr class="dem-more-row"><td colspan="' + colspan + '">' +
      '<button class="btn sm" type="button" data-dem-more="table">加载更多（已加载 ' +
      demands.length + ' / 共 ' + demandTotal + ' 条）</button></td></tr>';
  }
  demandBody.innerHTML = '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl">'
    + '<thead><tr>' + cols.map(function(k){ return '<th' + (numCols[k] ? ' class="num"' : '') + '>' + esc(labels[k] || k) + '</th>'; }).join("") + '<th>操作</th></tr></thead>'
    + '<tbody>' + body + '</tbody></table></div></section>';
}

/* ---------- 甘特渲染（阶段区间；并行阶段分 lane，缺口用虚线） ---------- */

function demStageName(st){ return DEM_STAGE_NAMES[st] || st; }
function demStageColor(st){ return DEM_STAGE_COLORS[st] || "var(--text-3)"; }
function demGanttLabelW(){ return window.innerWidth <= 900 ? 190 : 320; }
function demgMonthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function demgMonthRange(anchor){
  var start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  var end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start:start, end:end, days:GS.dayDiff(end, start) + 1 };
}
function demgStages(d){
  return (d && d.__timeline && d.__timeline.stages) || [];
}
/* 甘特按时间轴起点阅读更直观：组内按 timeline.start 升序，缺时间排最后 */
function demgStartMs(d){
  var s = GS.parseDate(d && d.__timeline && d.__timeline.start);
  return s ? s.getTime() : Number.MAX_SAFE_INTEGER;
}
function demgSortRows(rows){
  return rows.slice().sort(function(a, b){
    return demgStartMs(a) - demgStartMs(b) || String(a.id).localeCompare(String(b.id));
  });
}
function demgAutoRange(rows){
  var min = null, max = null;
  rows.forEach(function(d){
    demgStages(d).forEach(function(s){
      var a = GS.parseDate(s.start), b = GS.parseDate(s.end);
      if(a && (!min || a < min)) min = a;
      if(b && (!max || b > max)) max = b;
    });
  });
  var today = GS.startOfDay(rt.TODAY);
  if(!min) min = today;
  if(!max) max = today;
  if(today < min) min = today;
  if(today > max) max = today;
  var start = GS.addDays(min, -3), end = GS.addDays(max, 3);
  return { start:start, end:end, days:GS.dayDiff(end, start) + 1 };
}
function demgRange(rows){
  demGantt.notice = "";
  if(demGantt.rangeMode === "month"){
    if(!demGantt.anchorMonth) demGantt.anchorMonth = demgMonthStart(rt.TODAY);
    return demgMonthRange(demGantt.anchorMonth);
  }
  var range = demgAutoRange(rows);
  if(range.days > DEMAND_GANTT_MAX_DAYS){
    demGantt.rangeMode = "month";
    demGantt.anchorMonth = demgMonthStart(rt.TODAY);
    demGantt.notice = "时间跨度超过 2 年，已切换到月视图；可用上一月/下一月查看其他区间。";
    return demgMonthRange(demGantt.anchorMonth);
  }
  return range;
}
/* 区间端点靠得近的阶段上下错层，避免同一天交接时叠在一起；泳道数按实际并发自动增长 */
function demgPlace(stages){
  var laneEnd = [], placed = [];
  stages.slice().sort(function(a, b){
    var as = GS.parseDate(a.start), bs = GS.parseDate(b.start);
    var av = as ? as.getTime() : Number.MAX_SAFE_INTEGER;
    var bv = bs ? bs.getTime() : Number.MAX_SAFE_INTEGER;
    return av - bv
      || DEM_STAGE_ORDER.indexOf(a.stage) - DEM_STAGE_ORDER.indexOf(b.stage);
  }).forEach(function(s){
    var start = GS.parseDate(s.start), end = GS.parseDate(s.end);
    if(!start) return;
    if(!end || end < start) end = start;
    var lane = 0;
    while(laneEnd[lane] && start <= laneEnd[lane]) lane++;
    laneEnd[lane] = end;
    placed.push({ stage:s, start:start, end:end, lane:lane });
  });
  return placed;
}
function demgGapSegment(from, to, lane, range, dayW, label){
  if(from > to || to < range.start || from > range.end) return "";
  var s = from < range.start ? range.start : from;
  var e = to > range.end ? range.end : to;
  var off = GS.dayDiff(s, range.start);
  var width = Math.max(2, (GS.dayDiff(e, s) + 1) * dayW - 2);
  var text = (label ? label : "缺口") + " " + GS.fmtShortMonthDay(s) + " → " + GS.fmtShortMonthDay(e);
  return '<span class="demg-gap" style="left:' + (off * dayW + 1) + 'px;width:' + width +
    'px;top:' + (9 + lane * 15) + 'px" title="' + esc(text) + '"></span>';
}
function demgGapsHTML(placed, d, range, dayW){
  var bars = placed.filter(function(p){ return !p.stage.point; })
    .sort(function(a, b){ return a.start - b.start; });
  var html = "";
  for(var i = 1; i < bars.length; i++){
    var prev = bars[i - 1], next = bars[i];
    if(next.start > GS.addDays(prev.end, 1)){
      html += demgGapSegment(GS.addDays(prev.end, 1), GS.addDays(next.start, -1), prev.lane, range, dayW);
    }
  }
  /* 尾部缺口：最后一段结束到今天仍缺记录，按当前卡点补虚线 */
  var tl = d.__timeline || {};
  var stages = demgStages(d);
  var hasDev = stages.some(function(s){ return s.stage === "dev"; });
  var hasTest = stages.some(function(s){ return s.stage === "test"; });
  var released = stages.some(function(s){ return s.stage === "release"; });
  var maxEnd = null;
  placed.forEach(function(p){ if(!maxEnd || p.end > maxEnd) maxEnd = p.end; });
  if(!maxEnd || released || isClosedDemand(d)) return html;
  var today = GS.startOfDay(rt.TODAY);
  var tail = GS.addDays(maxEnd, 1);
  if(tail > today) return html;
  var label = "";
  if(d.status === "plan" && !hasDev) label = "已排期未开工";
  else if(hasDev && (tl.caseCount || 0) > 0 && !hasTest) label = "未执行用例";
  else if(hasDev && (tl.taskCount || 0) > 0 && (tl.taskDone || 0) >= tl.taskCount) label = "待发布";
  if(!label) return html;
  return html + demgGapSegment(tail, today, 1, range, dayW, label);
}
function demgStageTitle(s){
  var start = GS.parseDate(s.start), end = GS.parseDate(s.end);
  var days = start && end ? (GS.dayDiff(end, start) + 1) : 1;
  var span = s.point ? GS.fmtFullDate(start) : (GS.fmtFullDate(start) + " → " + GS.fmtFullDate(end));
  var tail = s.point ? "" : (s.open ? "（已 " + days + " 天，进行中）" : "（" + days + " 天）");
  return demStageName(s.stage) + "：" + span + tail;
}
function demgLabelHTML(d, tl){
  var meta = '<span class="demg-status st-' + esc(d.status) + '"><i></i>' + esc(statusName(d.status)) + '</span>';
  meta += priTagHTML(d.priority || "P2");
  var rn = reqNameById(d.reqId) || "";
  if(rn) meta += '<span class="ellipsis shrink">' + esc(rn) + '</span>';
  var ver = demandVersionName(d);
  if(ver) meta += '<span class="tag ghost">' + esc(ver) + '</span>';
  if(d.categoryId) meta += catTag(d.categoryId);
  if(d.expectDate) meta += '<span>期望 ' + esc(String(d.expectDate).substring(5, 10)) + '</span>';
  if(plannedText(d)) meta += '<span>计划 ' + esc(plannedText(d)) + '</span>';
  var info = [];
  if(tl.taskCount) info.push("工作项 " + (tl.taskDone || 0) + "/" + tl.taskCount);
  if(tl.docCount) info.push("文档 " + tl.docCount);
  if(tl.caseCount){
    /* 未执行与未通过分开报：混成「待通过」会让人以为用例跑过了却没通过 */
    var pend = [];
    if(tl.caseUntested) pend.push("未执行 " + tl.caseUntested);
    if(tl.caseFailed) pend.push("未通过 " + tl.caseFailed);
    info.push("用例 " + tl.caseCount + (pend.length ? "（" + pend.join(" · ") + "）" : ""));
  }
  if(tl.days) info.push("跨度 " + tl.days + " 天");
  return '<button class="gantt-label" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' +
    '<span class="gantt-title">' + esc(d.title) + '</span>' +
    '<span class="gantt-meta">' + meta + '</span>' +
    (info.length ? '<span class="gantt-info">' + esc(info.join(" · ")) + '</span>' : '') +
  '</button>';
}
function demgRowHTML(d, range, dayW, totalW){
  var tl = d.__timeline || {};
  var placed = demgPlace(demgStages(d));
  var laneCount = 0;
  placed.forEach(function(p){ if(p.lane + 1 > laneCount) laneCount = p.lane + 1; });
  var rowH = Math.max(56, (laneCount - 1) * 15 + 25);
  var segs = "";
  placed.forEach(function(p){
    var s = p.stage;
    if(p.end < range.start || p.start > range.end) return;
    var s2 = p.start < range.start ? range.start : p.start;
    var e2 = p.end > range.end ? range.end : p.end;
    var off = GS.dayDiff(s2, range.start);
    var span = Math.max(1, GS.dayDiff(e2, s2) + 1);
    var top = 6 + p.lane * 15;
    var title = demgStageTitle(s);
    if(s.point){
      var left = off * dayW + Math.max(0, (dayW - 10) / 2);
      segs += '<button class="demg-point st-' + esc(s.stage) + '" type="button" data-dem-detail="' +
        esc(d.id) + '" style="left:' + left + 'px;top:' + (top + 1) + 'px;--dem-stage-color:' +
        demStageColor(s.stage) + '" title="' + esc(title) + '"></button>';
      return;
    }
    var width = Math.max(4, span * dayW - 1);
    /* 天数取阶段真实区间，不按可视范围裁剪；进行中带 + 表示仍在延续 */
    var segDays = GS.dayDiff(p.end, p.start) + 1;
    var label = width >= DEMG_SEG_LABEL_MIN_W
      ? '<span class="demg-seg-label">' + esc(demStageName(s.stage) + " " + segDays + "天" + (s.open ? "+" : "")) + '</span>'
      : "";
    segs += '<button class="demg-seg st-' + esc(s.stage) + (s.open ? " is-open" : "") +
      '" type="button" data-dem-detail="' + esc(d.id) + '" style="left:' + (off * dayW) +
      'px;width:' + width + 'px;top:' + top + 'px;--dem-stage-color:' + demStageColor(s.stage) +
      '" title="' + esc(title) + '">' + label + '</button>';
  });
  segs += demgGapsHTML(placed, d, range, dayW);
  var expect = GS.parseDate(d.expectDate);
  if(expect && expect >= range.start && expect <= range.end){
    var exOff = GS.dayDiff(expect, range.start);
    segs += '<span class="demg-expect" style="left:' + (exOff * dayW + dayW / 2) +
      'px" title="期望交付 ' + esc(GS.fmtFullDate(expect)) + '"></span>';
  }
  return '<div class="gantt-row demg-row" data-dem-row="' + esc(d.id) +
    '" style="--gantt-row-h:' + rowH + 'px">' +
    demgLabelHTML(d, tl) +
    '<div class="gantt-track demg-track" style="width:' + totalW + 'px">' + segs + '</div>' +
  '</div>';
}
function demgGroupHeadHTML(g){
  var collapsed = !!demSmart.collapsed["$" + g.key];
  return '<div class="gantt-group"><button class="gantt-group-head" type="button" data-dem-group-toggle="' +
    esc(g.key) + '" aria-expanded="' + (!collapsed) + '">' +
    '<span class="gantt-group-caret" aria-hidden="true">' + (collapsed ? "▸" : "▾") + '</span>' +
    '<span class="gantt-group-name">' + esc(g.label) + '</span>' +
    '<span class="gantt-group-cnt">' + g.rows.length + ' 条</span>' +
  '</button></div>';
}
function demgSubGroupHeadHTML(g, s){
  var collapsed = !!demSmart.collapsed["$sub:" + g.key + "/" + s.key];
  return '<div class="gantt-group"><button class="gantt-group-head depth-2" type="button" data-dem-subgroup-toggle="' +
    esc(g.key + "/" + s.key) + '" aria-expanded="' + (!collapsed) + '">' +
    '<span class="gantt-group-caret" aria-hidden="true">' + (collapsed ? "▸" : "▾") + '</span>' +
    '<span class="gantt-group-name">' + esc(s.label) + '</span>' +
    '<span class="gantt-group-cnt">' + s.rows.length + ' 条</span>' +
  '</button></div>';
}
function demgLegendHTML(){
  return DEM_STAGE_ORDER.map(function(st){
    return '<span class="gl-item"><i class="demg-legend-dot st-' + st + '"></i>' + demStageName(st) + '</span>';
  }).join("") +
  '<span class="gl-item"><i class="demg-legend-gap"></i>缺口</span>' +
  '<span class="gl-item"><i class="demg-legend-expect"></i>期望交付</span>' +
  '<span class="gantt-legend-hint">阶段取自真实记录，缺失不补 0 天</span>' +
  '<button class="label-help demg-help-btn" type="button" data-demg-help aria-label="查看各阶段统计方法" title="各阶段怎么算">' +
    icon("helpCircle", 13) +
  '</button>';
}
function syncDemGanttControls(){
  if(!demandGanttBar) return;
  var sc = demandGanttBar.querySelector("[data-demg-scale]");
  if(sc) sc.value = demGantt.scale;
  var rg = demandGanttBar.querySelector("[data-demg-range]");
  if(rg) rg.value = demGantt.rangeMode;
  var zm = demandGanttBar.querySelector("[data-demg-zoom]");
  if(zm) zm.value = String(demGantt.zoomDayW);
  var lb = demandGanttBar.querySelector("[data-demg-range-label]");
  if(lb){
    if(demGantt.rangeMode === "month"){
      var anchor = (demGantt.range && demGantt.range.start) || demGantt.anchorMonth || demgMonthStart(rt.TODAY);
      lb.textContent = anchor.getFullYear() + "年" + (anchor.getMonth() + 1) + "月";
    }else{
      lb.textContent = "自动范围";
    }
  }
}
function renderDemandGantt(){
  if(!demandBody) return;
  var rows = demgSortRows(demViewRows());
  var groups = demSmart.group === "none"
    ? [{ key:"", label:"", rows:rows }]
    : demGroups().map(function(g){
        return { key:g.key, label:g.label, rows:demgSortRows(g.rows),
          subs:g.subs.map(function(s){
            return { key:s.key, label:s.label, rows:demgSortRows(s.rows) };
          }) };
      });
  var hasCond = demFilterCount() > 0 || demSmart.preset !== "all";
  if(demandsMeta){
    /* 同表格视图：条数由页头胶囊承担 */
    demandsMeta.textContent = "";
  }
  if(!demands.length){
    demGantt.range = null;
    demandBody.innerHTML = UI.emptyState({
      icon: hasCond ? "filterOff" : "calendar",
      title: hasCond ? "没有符合当前视图条件的需求" : "需求池还是空的",
      text: hasCond ? "切换视图，或调整、清空筛选条件后重试。"
        : "点右上角「新建需求」录入第一条；评审通过后排期到版本。"
    });
    if(hasCond) bindRetry(demandBody, function(){ activateDemPreset("all"); });
    syncDemGanttControls();
    return;
  }

  var prevScroll = demandBody.querySelector(".demg-scroll");
  if(prevScroll) demGantt.scrollLeft = prevScroll.scrollLeft;

  var scale = demGantt.scale;
  var dayW = GS.scaleDayW(scale, demGantt.zoomDayW);
  var monthMode = demGantt.rangeMode === "month";
  var range = GS.adjustRange(demgRange(rows), scale);
  var labelW = demGanttLabelW();
  /* 自动范围比视口窄时向右补齐，避免时间轴右侧留一大块空白 */
  var avail = (demandBody.clientWidth || 0) - labelW;
  if(!monthMode && avail > 0 && range.days * dayW < avail){
    var need = Math.ceil((avail - range.days * dayW) / dayW);
    range.end = GS.addDays(range.end, need);
    range.days = GS.dayDiff(range.end, range.start) + 1;
  }
  var totalW = range.days * dayW;
  demGantt.range = range;
  demGantt.dayW = dayW;

  var todayOff = GS.dayDiff(rt.TODAY, range.start);
  var todayIn = todayOff >= 0 && todayOff < range.days;
  var bodyHTML = "";
  groups.forEach(function(g){
    if(demSmart.group !== "none") bodyHTML += demgGroupHeadHTML(g);
    if(demSmart.group !== "none" && demSmart.collapsed["$" + g.key]) return;
    if(g.subs && g.subs.length){
      g.subs.forEach(function(s){
        bodyHTML += demgSubGroupHeadHTML(g, s);
        if(demSmart.collapsed["$sub:" + g.key + "/" + s.key]) return;
        s.rows.forEach(function(d){ bodyHTML += demgRowHTML(d, range, dayW, totalW); });
      });
    }else{
      g.rows.forEach(function(d){ bodyHTML += demgRowHTML(d, range, dayW, totalW); });
    }
  });

  demandBody.innerHTML =
    (demGantt.notice ? '<p class="gantt-notice">' + esc(demGantt.notice) + '</p>' : "") +
    '<div class="gantt-legend demg-legend">' + demgLegendHTML() + '</div>' +
    '<div class="gantt-scroll demg-scroll">' +
      '<div class="gantt-grid demg-grid is-scale-' + esc(scale) + '" style="--gantt-label-w:' + labelW +
        'px;--gantt-day-w:' + dayW + 'px;--gantt-row-h:56px;--gantt-group-h:32px;">' +
        '<div class="gantt-head">' +
          '<div class="gantt-corner">需求 <span class="gantt-corner-meta">' + rows.length + '</span></div>' +
          '<div class="gantt-axis" style="width:' + totalW + 'px">' +
            GS.headHTML(range, dayW, scale, rt.TODAY_ISO) +
          '</div>' +
        '</div>' +
        '<div class="gantt-body">' + bodyHTML + '</div>' +
        (todayIn
          ? '<div class="gantt-today-col" style="left:calc(var(--gantt-label-w) + ' + (todayOff * dayW) +
              'px);width:' + dayW + 'px"></div>' +
            '<div class="gantt-today" style="left:calc(var(--gantt-label-w) + ' + (todayOff * dayW) + 'px)"></div>'
          : "") +
      '</div>' +
    '</div>' +
    '<div class="demg-foot">' +
      (demandHasMore
        ? '<button class="btn sm" type="button" data-dem-more="gantt">加载更多（已加载 ' +
            demands.length + ' / 共 ' + demandTotal + ' 条）</button>'
        : "") +
    '</div>';

  var sc = demandBody.querySelector(".demg-scroll");
  if(sc){
    var left = demGantt.scrolled ? demGantt.scrollLeft : Math.max(0, todayOff * dayW - 200);
    sc.scrollLeft = left;
    demGantt.scrollLeft = left;
    sc.addEventListener("scroll", function(){ demGantt.scrollLeft = sc.scrollLeft; });
  }
  demGantt.scrolled = true;
  syncDemGanttControls();
}
function demgShiftMonth(delta){
  var base = demGantt.anchorMonth || demgMonthStart(rt.TODAY);
  demGantt.rangeMode = "month";
  demGantt.anchorMonth = new Date(base.getFullYear(), base.getMonth() + delta, 1);
  demGantt.scrollLeft = 0;
  render();
}
function demgScrollToToday(){
  var sc = demandBody && demandBody.querySelector(".demg-scroll");
  if(!sc || !demGantt.range) return;
  var off = Math.max(0, GS.dayDiff(rt.TODAY, demGantt.range.start));
  sc.scrollLeft = Math.max(0, off * demGantt.dayW - 200);
  demGantt.scrollLeft = sc.scrollLeft;
}

/* ---------- 需求弹窗 ---------- */

function syncPriSeg(){
  var seg = $("segDemandPri");
  if(seg) seg.querySelectorAll("[data-dpri]").forEach(function(b){
    var code = b.dataset.dpri;
    b.className = code.toLowerCase();
    b.style.setProperty("--" + code.toLowerCase(), priColor(code));
    b.textContent = priName(code);
    b.setAttribute("aria-pressed", code === formPri);
  });
}
/* WSJF 就地计分：截断口径与保存端一致（前三项 0-10、工作量 1-10）；
   四项齐全才显示得分，摘要行同步示值，留空回落「未评分」 */
function syncWsjfLive(){
  var vals = [dWsjfB.value, dWsjfU.value, dWsjfR.value, dWsjfE.value].map(function(v){
    return String(v == null ? "" : v).trim();
  });
  var complete = vals.every(function(v){ return v !== ""; });
  var score = null;
  if(complete){
    var nums = vals.map(function(v, i){
      return Math.max(i === 3 ? 1 : 0, Math.min(10, Number(v) || 0));
    });
    score = Math.round((nums[0] + nums[1] + nums[2]) * 10 / nums[3]) / 10;
  }
  var live = $("wsjfLive"), meta = $("wsjfMeta");
  if(live){
    live.hidden = score == null;
    if(score != null) live.textContent = "四项齐全：WSJF = " + score;
  }
  if(meta) meta.textContent = score == null ? "未评分 · 选填" : "已评 " + score;
}
function findDemand(id){
  for(var i = 0; i < demands.length; i++) if(demands[i].id === id) return demands[i];
  return null;
}
/* 分类候选按所选项目过滤。新建/换项目时（fallbackFirst）选中值不可用才回落到第一个分类；
   编辑已有需求时必须保留原值：「未分类」不能被悄悄改成第一个分类，
   分类缓存过期找不到原分类时也保留原 id，避免一次普通保存把分类改掉。 */
function syncDemandCatOptions(reqId, selectedId, fallbackFirst){
  var cats = (rt.categoriesCache || []).filter(function(c){ return c.projectId === reqId; });
  var known = !!selectedId && cats.some(function(c){ return c.id === selectedId; });
  var keepUnknown = !fallbackFirst && !!selectedId && !known;
  dCategory.innerHTML = '<option value="">未分类</option>' + cats.map(function(c){
    return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
  }).join("") + (keepUnknown ? '<option value="' + esc(selectedId) + '">当前分类（列表未加载）</option>' : "");
  var val = (known || keepUnknown) ? selectedId : (fallbackFirst && cats.length ? cats[0].id : "");
  dCategory.value = val;
  return val;
}
/* 弹窗一次打开对应一个序号：关掉 A 再打开 B 后，A 迟到的保存响应不能关闭/改写 B */
var demandFormSeq = 0, demandFormBaseline = null, demandAttKit = null;
function demandFormAttFiles(){
  return demandAttKit ? demandAttKit.files() : [];
}
function demandFormSnapshot(){
  return JSON.stringify([dReq.value, dTitle.value, demandSerializeRichText(dDesc), dAccept.value, dSource.value, dKind.value,
    dCategory.value, dExpect.value, formPri, dWsjfB.value, dWsjfU.value, dWsjfR.value, dWsjfE.value,
    dReviewer ? dReviewer.value : "", demandWatchPick.map(function(w){ return w.userId; }),
    demandFormAttFiles().map(function(f){ return f.name + ":" + f.size; })]);
}
function demandFormDirty(){
  return !!demandFormBaseline && demandFormSnapshot() !== demandFormBaseline;
}
/* ---------- 创建时的提醒人 ----------
   只在新建生效：编辑态的名单在详情「提醒人」浮层里维护，表单不重复承载。
   候选取项目花名册（已排除查看者自己），提交人默认接收通知，无需添加。 */
var demandWatchPick = [];
function demandWatchBox(){ var dlg = $("dlgDemand"); return dlg ? dlg.querySelector("[data-dem-form-watch]") : null; }
function renderDemandWatchChips(){
  var box = demandWatchBox();
  if(!box) return;
  var chips = box.querySelector("[data-dem-form-watch-chips]");
  if(!chips) return;
  chips.innerHTML = demandWatchPick.map(function(w){
    return '<span class="dem-watch-chip">' + esc(w.name)
      + '<button type="button" class="dem-watch-chip-x" data-dem-form-watch-remove="' + esc(w.userId)
      + '" aria-label="移除提醒人 ' + esc(w.name) + '">' + icon("close", 10) + '</button></span>';
  }).join("");
}
function syncDemandWatchPicker(){
  var box = demandWatchBox();
  if(!box) return;
  var sel = box.querySelector("[data-dem-form-watch-select]");
  var add = box.querySelector("[data-dem-form-watch-add]");
  if(!sel) return;
  var projectId = dReq.value;
  if(add) add.disabled = true;
  if(!projectId || !rt.currentWs){ sel.innerHTML = '<option value="">先选项目</option>'; return; }
  sel.innerHTML = '<option value="">加载成员…</option>';
  var picked = {};
  demandWatchPick.forEach(function(w){ picked[w.userId] = 1; });
  loadProjectMembers(rt.currentWs.id, projectId).then(function(roster){
    if(!box.isConnected || dReq.value !== projectId || editingDemandId) return;
    var me = rt.currentUser && rt.currentUser.id;
    var opts = ((roster && roster.members) || []).filter(function(m){
      return m && m.userId && m.userId !== me && !picked[m.userId];
    });
    sel.innerHTML = opts.length
      ? '<option value="">选择成员…</option>' + opts.map(function(m){
          return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
        }).join("")
      : '<option value="">没有可添加的成员</option>';
    if(add) add.disabled = false;
  }).catch(function(){
    if(sel.isConnected) sel.innerHTML = '<option value="">成员加载失败</option>';
  });
}
function resetDemandWatchPick(){ demandWatchPick = []; renderDemandWatchChips(); }
/* 评审人候选：项目花名册里可写的人；查看者与只读成员不能通过/拒绝需求，不列入 */
function syncDemandReviewerSelect(selectedId){
  if(!dReviewer) return;
  var projectId = dReq.value;
  var keep = selectedId !== undefined ? selectedId : dReviewer.value;
  if(!projectId || !rt.currentWs){ dReviewer.innerHTML = '<option value="">先选项目</option>'; return; }
  dReviewer.innerHTML = '<option value="">加载成员…</option>';
  loadProjectMembers(rt.currentWs.id, projectId).then(function(roster){
    if(!dReviewer.isConnected || dReq.value !== projectId) return;
    var me = rt.currentUser && rt.currentUser.id;
    var opts = ((roster && roster.members) || []).filter(function(m){
      return m && m.userId && m.userId !== me && m.access !== "read";
    });
    dReviewer.innerHTML = '<option value="">未指派 · 项目可写成员都可以认领</option>' + opts.map(function(m){
      return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
    }).join("");
    if(keep && opts.some(function(m){ return m.userId === keep; })) dReviewer.value = keep;
    else dReviewer.value = "";
  }).catch(function(){
    if(dReviewer.isConnected) dReviewer.innerHTML = '<option value="">成员加载失败</option>';
  });
}
function closeDemandDialog(){
  demandFormSeq++;
  demandFormBaseline = null;
  demandClearPendingImages();
  if(demandAttKit) demandAttKit.clear();
  editingDemandId = null;
  editingDemandStatus = null;
  editingDemandReqId = null;
  btnSaveDemand.disabled = false;
  UI.closeModal($("dlgDemand"));
}
/* X、Esc、遮罩与路由切换都走这里，避免误关闭丢失填写内容 */
function tryCloseDemandDialog(afterClose){
  function finish(){
    closeDemandDialog();
    if(afterClose) afterClose();
  }
  if(!demandFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: "需求内容还没有保存，关闭后填写的内容会丢失。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) finish(); });
}
function openDemandDialog(d){
  if(d && !canWriteDemand(d)){ denyDemandReadOnly(); return; }
  if(!rt.reqList.length){ toast("先在「项目」里创建项目", "warn"); return; }
  var opts = writableReqs();
  if(!opts.length){ toast("你在当前空间没有可写项目，无法提需求", "warn"); return; }
  editingDemandId = d ? d.id : null;
  editingDemandRevision = d ? d.revision : null;
  editingDemandStatus = d ? d.status : "review";
  editingDemandReqId = d ? d.reqId : null;
  editingPlannedStart = d ? d.plannedStart : null;
  editingPlannedEnd = d ? d.plannedEnd : null;
  /* 编辑态候选与列表行内切换同口径：当前项目 + 其他未归档且可写的项目 */
  dReq.innerHTML = projectOptionsHTML(d ? demandMoveTargets(d.reqId) : opts);
  dReq.value = d ? d.reqId : (rt.demandReqId && canEditReq(rt.demandReqId) ? rt.demandReqId : opts[0].id);
  /* 编辑态可换项目：仅在还有第二个可写项目时放开；迁移范围在提交前二次确认 */
  var canMove = !!d && demandProjectMovable(d) && demandMoveTargets(d.reqId).length > 1;
  dReq.disabled = !!d && !canMove;
  var reqHint = $("dReqHint");
  if(reqHint){
    reqHint.hidden = true;
    if(d && canMove){
      reqHint.hidden = false;
      reqHint.textContent = "更换后按目标项目重排编号：工作项与用例一并迁移并重新取号，原排期、版本绑定与测试计划圈选自动解除；关联文档与历史发布记录留在原项目，保存前会再次确认迁移范围";
    }else if(d && d.status !== "done" && !isClosedDemand(d) && !canMove){
      reqHint.hidden = false;
      reqHint.textContent = "没有其他可写项目可迁移";
    }
  }
  dTitle.value = d ? d.title : "";
  demandClearPendingImages();
  /* 附件只在新建时在这里收集；编辑态的已有附件在详情「关联」页维护 */
  if(demandAttKit) demandAttKit.clear();
  var attField = $("fDemandAtts");
  if(attField) attField.hidden = !!d;
  dDesc.innerHTML = d ? demandDetailHTML(d.description, false) : "";
  demandWrapInlineImages(dDesc);
  demandBindInlineImageResize(dDesc);
  demandUpdateDescCount();
  dAccept.value = d ? (d.acceptText || "") : "";
  /* 来源联想：候选来自当前已加载需求的来源原值，只提示不代入 */
  var dlSource = $("dlDemandSource");
  if(dlSource){
    var seen = {};
    dlSource.innerHTML = demands.reduce(function(html, x){
      var s = (x.source || "").trim();
      if(!s || seen[s]) return html;
      seen[s] = 1;
      return html + '<option value="' + esc(s) + '"></option>';
    }, "");
  }
  dSource.value = d ? (d.source || "") : "";
  dKind.value = d ? (d.itemKind || "其他") : "新功能";
  /* 分类按所选项目过滤：候选只列该项目下的分类 */
  syncDemandCatOptions(dReq.value, d ? (d.categoryId || "") : "", !d);
  /* 提醒人只在新建时可选；编辑态名单在详情浮层维护，避免表单与浮层两头改 */
  resetDemandWatchPick();
  var watchField = $("fDemandWatch"), watchSec = $("fDemandWatchSec");
  if(watchField) watchField.hidden = !!d;
  if(watchSec) watchSec.hidden = !!d;
  if(!d) syncDemandWatchPicker();
  /* 评审人：新建与待评审编辑可指派；已进入流转后由流转动作决定，表单不再改 */
  if(dReviewer) dReviewer.disabled = !!d && d.status !== "review";
  syncDemandReviewerSelect(d ? (d.reviewerUserId || "") : "");
  dExpect.value = d ? (d.expectDate || "") : "";
  formPri = d ? (d.priority || "P2") : "P2";
  dWsjfB.value = d && d.wsjfBusiness != null ? d.wsjfBusiness : "";
  dWsjfU.value = d && d.wsjfUrgency != null ? d.wsjfUrgency : "";
  dWsjfR.value = d && d.wsjfRisk != null ? d.wsjfRisk : "";
  dWsjfE.value = d && d.wsjfEffort != null ? d.wsjfEffort : "";
  syncWsjfLive();
  fDemandTitle.classList.remove("invalid");
  demandFormTitle.textContent = d ? "编辑需求" : "新建需求";
  btnSaveDemand.textContent = d ? "保存" : "提交评审";
  var footNote = $("demandFootNote");
  if(footNote) footNote.hidden = true;
  btnSaveDemand.disabled = false;
  demandFormSeq++;
  syncPriSeg();
  setDemandFormLocked(!!d && d.status !== "review");
  var lockNote = $("demandLockNote");
  if(lockNote) lockNote.textContent = d && d.status === "done"
    ? "已完成：标题与优先级在详情里改；所属项目、版本与计划日期不再调整。"
    : "已进入流转：标题与类型锁定；优先级在列表改，日期用「调整排期」。";
  demandFormBaseline = demandFormSnapshot();
  updateDemandCheckResume();
  UI.openModal($("dlgDemand"), "input");
}
/* 已进入流转的需求只放开说明类字段；标题与类型锁住而不是提交后静默丢弃。
   优先级与期望交付服务端 PUT 同样不落库，改它们要走列表行内或详情事实条的专用端点。 */
function setDemandFormLocked(locked){
  [dTitle, dKind, dExpect, dReviewer].forEach(function(el){ if(el) el.disabled = locked; });
  var seg = $("segDemandPri");
  if(seg){
    seg.classList.toggle("disabled", locked);
    seg.querySelectorAll("[data-dpri]").forEach(function(b){ b.disabled = locked; });
  }
  var note = $("demandLockNote");
  if(note) note.hidden = !locked;
}
function saveDemand(){
  var title = dTitle.value.trim();
  if(!title){
    fDemandTitle.classList.add("invalid");
    try{ dTitle.focus(); }catch(e){ /* noop */ }
    return;
  }
  if(!canEditReq(dReq.value)){ denyDemandReadOnly(); return; }
  var descText = demandSerializeRichText(dDesc);
  if(demandDescText(descText).length > DEM_DESC_MAX){
    toast("需求描述最多 " + DEM_DESC_MAX + " 字，请精简后再提交", "warn");
    try{ dDesc.focus(); }catch(e){ /* noop */ }
    return;
  }
  /* WSJF 可选：留空发 null，服务端只在四项都填时才计分 */
  function wsNum(el, min){
    var raw = String(el.value == null ? "" : el.value).trim();
    if(raw === "") return null;
    var v = Number(raw);
    if(isNaN(v)) v = min;
    return Math.max(min, Math.min(10, v));
  }
  var body = {
    reqId: dReq.value,
    title: title,
    description: descText || null,
    acceptText: dAccept.value.trim() || null,
    source: dSource.value.trim() || null,
    itemKind: dKind.value,
    categoryId: dCategory.value || null,
    priority: formPri,
    expectDate: dExpect.value || null,
    plannedStart: editingPlannedStart || null,
    plannedEnd: editingPlannedEnd || null,
    revision: editingDemandRevision,
    wsjfBusiness: wsNum(dWsjfB, 0),
    wsjfUrgency: wsNum(dWsjfU, 0),
    wsjfRisk: wsNum(dWsjfR, 0),
    wsjfEffort: wsNum(dWsjfE, 1)
  };
  /* 名单只在创建时提交；编辑走详情浮层，避免保存时覆盖别人刚调整的名单 */
  if(!editingDemandId) body.watcherIds = demandWatchPick.map(function(w){ return w.userId; });
  /* 评审人只在新建或待评审整单编辑时提交；其他状态服务端也不会改 */
  if(!editingDemandId || editingDemandStatus === "review"){
    body.reviewerUserId = dReviewer ? (dReviewer.value || null) : null;
  }
  /* 只在新建或待评审编辑时体检；已经流转的需求编辑描述时不打断保存 */
  var checkable = !editingDemandId || editingDemandStatus === "review";
  if(checkable && !demandCheckOff()){
    runDemandCheck(body);
    return;
  }
  doSaveDemand(body);
}
function doSaveDemand(body){
  var title = body.title;
  btnSaveDemand.disabled = true;
  var seq = demandFormSeq, wasEdit = !!editingDemandId;
  var moved = wasEdit && !!editingDemandReqId && body.reqId !== editingDemandReqId;
  var fail = function(ex){
    if(seq === demandFormSeq) btnSaveDemand.disabled = false;
    toast(ex && ex.message ? ex.message : "保存失败", "bad");
  };
  /* 描述里的图片和表单附件此时都还只是本地文件：保存时再逐个上传成需求附件 */
  var pending = demandCommitPendingImages();
  if(pending.length && String(body.description || "").indexOf("(pending:") === -1) pending = [];
  var editId = editingDemandId;
  var attFiles = demandFormAttFiles();
  var done = function(attText){
    toast((!wasEdit ? "已提交评审「" + title + "」"
      : moved ? "已移至「" + reqNameById(body.reqId) + "」并保存"
      : "已更新需求「" + title + "」") + (attText ? "，" + attText : ""), "fs");
    /* 弹窗已被关闭或换成了另一条需求：只刷新列表，不动当前表单 */
    if(seq === demandFormSeq){
      closeDemandDialog();
      if(wasEdit) closeDemandDetailIfOpen();
      /* 聚焦项目时跳到新建需求所在项目；「全部项目」本来就能看到，不切范围。
         编辑迁移则保持原筛选，让这条需求从当前列表里消失即可 */
      if(!wasEdit && rt.demandReqId && body.reqId !== rt.demandReqId){
        rt.demandReqId = body.reqId;
        if(demandReq) demandReq.value = body.reqId;
      }
    }
    loadDemands();
  };
  /* 附件接口要求需求已存在，所以统一在写库成功后再传；返回追加到成功提示的文案 */
  var attach = function(demandId){
    if(!attFiles.length || !demandId) return Promise.resolve("");
    var path = "/api/demands/" + encodeURIComponent(demandId) + "/attachments";
    var ok = 0, failed = 0;
    var chain = Promise.resolve();
    attFiles.forEach(function(f){
      chain = chain.then(function(){
        return uploadAttachment(path, f).then(function(){ ok++; }, function(){ failed++; });
      });
    });
    return chain.then(function(){
      if(failed) toast("附件上传：" + ok + " 个成功，" + failed + " 个失败", "warn");
      return ok ? (ok > 1 ? "附件已上传 " + ok + " 个" : "附件已上传") : "";
    });
  };
  var attachThenDone = function(demandId){
    return attach(demandId).then(function(attText){ done(attText); });
  };
  var attachMissing = function(){
    if(attFiles.length) toast("需求已保存，但附件没有上传，请打开需求在「关联 - 附件」里补传", "warn");
    done();
  };
  var write = function(){
    return editId
      ? API.put("/api/demands/" + encodeURIComponent(editId), body)
      : API.post("/api/demands", body);
  };
  var save = function(){
    /* 编辑态已有 ID：先传图再把 pending 键换成 att 键，一次性保存 */
    if(wasEdit && pending.length){
      return demandUploadPendingImages(editId, pending).then(function(r){
        body.description = demandReplacePendingTokens(body.description, r.mapping) || null;
        demandReportImageUpload(Object.keys(r.mapping).length, r.failed);
        return write().then(function(){ return attachThenDone(editId); });
      });
    }
    if(!pending.length){
      return write().then(function(created){
        var targetId = wasEdit ? editId : (created && created.id);
        if(!targetId) return attachMissing();
        return attachThenDone(targetId);
      });
    }
    /* 新建态附件接口要求需求已存在：先按无图文案建单，上传后把图片片段补回描述再保存一次 */
    var withTokens = String(body.description || "");
    body.description = demandDescText(withTokens) || null;
    return write().then(function(created){
      if(!created || !created.id) return attachMissing();
      return demandUploadPendingImages(created.id, pending).then(function(r){
        demandReportImageUpload(Object.keys(r.mapping).length, r.failed);
        var finalText = demandReplacePendingTokens(withTokens, r.mapping);
        if(!finalText || finalText === (body.description || "")) return attachThenDone(created.id);
        body.description = finalText;
        body.revision = created.revision;
        return API.put("/api/demands/" + encodeURIComponent(created.id), body).then(function(){
          return attachThenDone(created.id);
        }, function(){
          toast("需求已创建、图片已上传，但描述回写失败，请打开需求后再保存一次", "warn");
          return attachThenDone(created.id);
        });
      });
    });
  };
  /* 换了项目先走两道确认；取消时恢复保存按钮，表单内容保持原样 */
  var gate = moved
    ? confirmDemandMove({ id:editingDemandId, reqId:editingDemandReqId, title:title }, body.reqId).then(function(ok){
        if(!ok){
          if(seq === demandFormSeq) btnSaveDemand.disabled = false;
          return null;
        }
        return save();
      })
    : save();
  return gate.catch(fail);
}

/* ---------- 提交前体检 ----------
   只读检查，不调用 AI、不改内容：缺验收标准、描述过短、P0/P1 缺期望交付、同项目相似需求。
   任何一项都只提示，用户仍可「仍然提交」；关闭后可在表单底部「恢复体检」。 */
var DEMAND_CHECK_OFF_KEY = "hg.demandCheckOff";
var demandCheckCtx = null;
function demandCheckOff(){
  try{ return localStorage.getItem(DEMAND_CHECK_OFF_KEY) === "1"; }catch(e){ return false; }
}
function updateDemandCheckResume(){
  var btn = $("demandCheckResume");
  if(btn) btn.hidden = !demandCheckOff();
}
function setDemandCheckOff(on){
  try{
    if(on) localStorage.setItem(DEMAND_CHECK_OFF_KEY, "1");
    else localStorage.removeItem(DEMAND_CHECK_OFF_KEY);
  }catch(e){ /* 隐私模式写不了就只影响本次会话 */ }
  updateDemandCheckResume();
}
function runDemandCheck(body){
  var seq = demandFormSeq;
  var excludeId = editingDemandId;
  btnSaveDemand.disabled = true;
  API.post("/api/demands/quality-check", {
    reqId: body.reqId,
    title: body.title,
    /* 体检只读文案：内嵌图片的标记片段（含未上传的 pending）不计入描述内容 */
    description: body.description ? demandDescText(body.description) : null,
    acceptText: body.acceptText,
    priority: body.priority,
    expectDate: body.expectDate,
    excludeId: excludeId
  }).then(function(res){
    if(seq !== demandFormSeq) return;
    btnSaveDemand.disabled = false;
    var issues = (res && res.issues) || [], similar = (res && res.similar) || [];
    if(!issues.length && !similar.length){ doSaveDemand(body); return; }
    openDemandCheck(res, body);
  }).catch(function(ex){
    if(seq !== demandFormSeq) return;
    btnSaveDemand.disabled = false;
    /* 体检是只读增强，失败不拦提交；无权限是真正的写前错误，直接提示 */
    if(ex && ex.code === 403){ toast(ex.message || "没有该项目的访问权限", "bad"); return; }
    toast("提交前体检没跑成，已直接提交", "warn");
    doSaveDemand(body);
  });
}
function openDemandCheck(res, body){
  demandCheckCtx = { res: res, body: body };
  var issues = res.issues || [], similar = res.similar || [];
  var bits = [];
  if(issues.length) bits.push("可以再补 " + issues.length + " 处");
  if(similar.length) bits.push("发现 " + similar.length + " 条相似需求");
  $("dqSummary").textContent = "「" + body.title + "」" + (bits.length ? bits.join("，") + "。" : "没有发现需要提醒的问题。");
  $("dqIssueSec").hidden = !issues.length;
  $("dqIssueCount").textContent = issues.length ? String(issues.length) : "";
  $("dqIssueList").innerHTML = issues.map(function(it){
    return '<div class="dq-item ' + (it.level === "warn" ? "warn" : "info") + '">'
      + '<span class="dq-dot" aria-hidden="true"></span>'
      + '<div class="dq-item-tx"><b>' + esc(it.title) + '</b><p>' + esc(it.detail) + '</p></div>'
      + '<button class="dq-fix" type="button" data-dq-fix="' + esc(it.field) + '">去填写</button>'
      + '</div>';
  }).join("");
  $("dqSimSec").hidden = !similar.length;
  $("dqSimCount").textContent = similar.length ? String(similar.length) : "";
  $("dqSimList").innerHTML = similar.map(function(s){
    var cls = s.status === "plan" ? "plum" : s.status === "done" ? "green" : s.status === "pass" ? "blue" : "";
    var no = demandNoText(s.demandNo);
    return '<div class="dq-sim"><div class="dq-sim-tx">'
      + '<div class="dq-sim-t1">' + (no ? '<span class="dq-sim-no">' + esc(no) + '</span>' : '')
      +   '<b>' + esc(s.title) + '</b></div>'
      + '<div class="dq-sim-meta"><span class="tag ' + cls + '">' + esc(statusName(s.status)) + '</span>'
      +   (s.priority ? '<span class="tag">' + esc(s.priority) + '</span>' : '')
      +   (s.versionName ? '<span>' + esc(s.versionName) + '</span>' : '')
      + '</div>'
      + '<div class="dq-sim-why">标题关键词重合 ' + (Number(s.score) || 0)
      +   '%；如果范围一致，可以补到这条需求下，避免重复排期。</div>'
      + '</div><button class="dq-go" type="button" data-dq-view="' + esc(s.id) + '">查看</button></div>';
  }).join("");
  $("dqSkip").checked = false;
  UI.openModal($("dlgDemandCheck"), "#dqBack");
}
function focusDemandCheckField(field){
  var el = field === "acceptText" ? dAccept : field === "description" ? dDesc : field === "expectDate" ? dExpect : null;
  if(!el || el.disabled) return;
  setTimeout(function(){
    try{ el.focus(); }catch(e){ /* noop */ }
    if(el.scrollIntoView) el.scrollIntoView({ block:"center" });
  }, 60);
}
function closeDemandCheck(focusField){
  var ctx = demandCheckCtx;
  demandCheckCtx = null;
  var dlg = $("dlgDemandCheck");
  if(dlg) UI.closeModal(dlg);
  if(focusField && ctx && ctx.res && ctx.res.issues && ctx.res.issues.length){
    focusDemandCheckField(ctx.res.issues[0].field);
  }
}
function bindDemandCheckDialog(){
  var dlg = $("dlgDemandCheck");
  if(!dlg) return;
  /* Esc / 遮罩关闭也清掉上下文，避免下一次打开复用旧的提交内容 */
  dlg.__uiOnClose = function(){ demandCheckCtx = null; };
  if($("dqX")) $("dqX").addEventListener("click", function(){ closeDemandCheck(false); });
  if($("dqBack")) $("dqBack").addEventListener("click", function(){ closeDemandCheck(true); });
  if($("dqStill")) $("dqStill").addEventListener("click", function(){
    if($("dqSkip") && $("dqSkip").checked) setDemandCheckOff(true);
    var ctx = demandCheckCtx;
    demandCheckCtx = null;
    UI.closeModal(dlg);
    if(ctx && ctx.body) doSaveDemand(ctx.body);
  });
  if($("dqIssueList")) $("dqIssueList").addEventListener("click", function(e){
    var btn = e.target.closest("[data-dq-fix]");
    if(!btn) return;
    demandCheckCtx = null;
    UI.closeModal(dlg);
    focusDemandCheckField(btn.dataset.dqFix);
  });
  if($("dqSimList")) $("dqSimList").addEventListener("click", function(e){
    var btn = e.target.closest("[data-dq-view]");
    if(!btn) return;
    var id = btn.dataset.dqView;
    demandCheckCtx = null;
    UI.closeModal(dlg);
    showDemandDetail(id);
  });
  updateDemandCheckResume();
}
function deleteDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  UI.showConfirm({
    title:"删除需求",
    msg:"删除「" + esc(d.title) + "」？该需求会从需求池移除，操作不可恢复。",
    okText:"删除需求"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/demands/" + encodeURIComponent(id)).then(function(){
      toast("已删除「" + d.title + "」", "fs");
      closeDemandDetailIfOpen();
      loadDemands();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------- 状态流转 ---------- */

function claimDemandReview(id, btn){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  if(btn) btn.disabled = true;
  API.post("/api/demands/" + encodeURIComponent(id) + "/claim-review", {}).then(function(){
    toast("已认领「" + d.title + "」，由你评审", "fs");
    var wasOpen = !!demandDetailLayer;
    closeDemandDetailIfOpen();
    loadDemands();
    if(wasOpen) showDemandDetail(id);
  }).catch(function(ex){
    if(btn) btn.disabled = false;
    toast(ex.message || "认领失败", "bad");
    if(ex.code === 409){ closeDemandDetailIfOpen(); loadDemands(); }
  });
}
function passDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  function doPass(){
    API.post("/api/demands/" + encodeURIComponent(id) + "/pass", { revision: d.revision }).then(function(){
      toast("已通过「" + d.title + "」，可排期进入版本", "fs");
      closeDemandDetailIfOpen();
      loadDemands();
    }).catch(function(ex){
      toast(ex.message || "操作失败", "bad");
      if(ex.code === 409) closeDemandDetailIfOpen();
    });
  }
  /* 手机端评审通过需二次确认；桌面端保持原有一键通过 */
  if(isMobile() && MOBILE_APPROVALS.review.confirmOnApprove){
    UI.showConfirm({
      title:"确认通过需求",
      msg:"通过后「" + esc(d.title) + "」将进入已通过，可排期进入版本。确定继续？",
      okText:"通过",
      cancelText:"取消"
    }).then(function(ok){ if(ok) doPass(); });
    return;
  }
  doPass();
}
function rejectDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  UI.showPrompt({
    title:"评审不通过",
    desc:"原因会记录在需求时间线，需求进入「已关闭 · 评审不通过」，可重新打开再评审。",
    label:"拒绝原因（必填）",
    required:true
  }).then(function(note){
    if(note === null) return;
    if(!note.trim()){ toast("请填写拒绝原因", "warn"); return; }
    API.post("/api/demands/" + encodeURIComponent(id) + "/rej", { note: note.trim(), revision: d.revision }).then(function(){
      toast("已记录评审不通过「" + d.title + "」", "fs");
      closeDemandDetailIfOpen();
      loadDemands();
    }).catch(function(ex){
      toast(ex.message || "操作失败", "bad");
      if(ex.code === 409) closeDemandDetailIfOpen();
    });
  });
}
function reopenDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  API.post("/api/demands/" + encodeURIComponent(id) + "/reopen", { revision: d.revision }).then(function(){
    toast("已重新打开「" + d.title + "」，回到待评审", "fs");
    closeDemandDetailIfOpen();
    loadDemands();
  }).catch(function(ex){
    toast(ex.message || "操作失败", "bad");
    if(ex.code === 409) closeDemandDetailIfOpen();
  });
}
function unpassDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  API.post("/api/demands/" + encodeURIComponent(id) + "/unpass", { revision: d.revision }).then(function(){
    toast("已撤回「" + d.title + "」，回到待评审", "fs");
    closeDemandDetailIfOpen();
    loadDemands();
  }).catch(function(ex){
    toast(ex.message || "操作失败", "bad");
    if(ex.code === 409) closeDemandDetailIfOpen();
  });
}
function reasonAction(id, action, title, desc){
  var d = findDemand(id);
  if(!d) return;
  if(!canScheduleDemand(d)){ denySchedule(); return; }
  var revision = d.revision;
  UI.showPrompt({ title:title, desc:desc, label:"原因（必填）", required:true, maxLength:500, okText:title }).then(function(note){
    if(note === null) return;
    if(!note.trim()){ toast("请填写原因", "warn"); return; }
    API.post("/api/demands/" + encodeURIComponent(id) + "/" + action, { note:note.trim(), revision:revision }).then(function(){
      toast(title + "成功，关联任务未改变", "fs");
      closeDemandDetailIfOpen();
      drawerDemandOpts.reqId = null;
      loadDemands();
    }).catch(function(ex){
      toast(ex.message || "操作失败", "bad");
      if(ex.code === 409){ closeDemandDetailIfOpen(); loadDemands(); }
    });
  });
}
function unplanDemand(id){
  reasonAction(id, "unplan", "撤销排期", "退回已通过，清除需求目标版本和计划时间；关联任务的版本与日期保持不变。");
}
function cancelDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canScheduleDemand(d)){ denySchedule(); return; }
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet xs"><div class="sheet-body"><div class="panel"><div class="panel-head"><h3>关闭需求</h3>'
    + '<button class="icon-btn sm" type="button" data-dem-close-x aria-label="关闭">' + icon("close", 14) + '</button></div>'
    + '<div class="stack"><p class="foot-note">关闭后不能新拆工作项；已有任务不自动取消或改期。关闭原因与关闭前阶段会保留。</p>'
    + '<label class="field"><span>关闭原因</span><select class="input" id="demCloseReason"><option value="cancel">中途取消</option><option value="dup">重复需求</option></select></label>'
    + '<label class="field"><span>原因说明（必填）</span><textarea class="input" id="demCloseNote" rows="4" maxlength="500"></textarea></label>'
    + '<div class="row row-gap"><button class="btn primary" type="button" data-dem-close-ok>确认关闭</button><button class="btn" type="button" data-dem-close-x>取消</button></div>'
    + '</div></div></div></div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-close-x]")){ UI.closeModal(layer); return; }
    var ok = e.target.closest("[data-dem-close-ok]");
    if(!ok) return;
    var note = layer.querySelector("#demCloseNote").value.trim();
    if(!note){ toast("请填写原因说明", "warn"); layer.querySelector("#demCloseNote").focus(); return; }
    ok.disabled = true;
    API.post("/api/demands/" + encodeURIComponent(id) + "/cancel", {
      note:note, revision:d.revision, closeReason:layer.querySelector("#demCloseReason").value
    }).then(function(){
      UI.closeModal(layer);
      closeDemandDetailIfOpen();
      drawerDemandOpts.reqId = null;
      toast("需求已关闭，关联任务未改变", "fs");
      loadDemands();
    }).catch(function(ex){
      ok.disabled = false;
      toast(ex.message || "关闭失败", "bad");
      if(ex.code === 409){ UI.closeModal(layer); closeDemandDetailIfOpen(); loadDemands(); }
    });
  });
  UI.openModal(layer, "select");
}
function restoreDemand(id){
  var d = findDemand(id);
  if(!d) return;
  var target = restoreTargetName(d);
  reasonAction(id, "restore", "恢复需求", "恢复至「" + target + "」" + (target === "已通过" ? "，清除原目标版本和计划时间，需要重新排期" : "") + "；已有任务保持不变。");
}
/* 优先级档位固定 P0-P3，显示名随空间优先级配置变化，开弹窗时刷新 */
function syncPlanPriOptions(){
  if(!dpPriority) return;
  dpPriority.innerHTML = PRIORITIES.map(function(p){
    return '<option value="' + p + '">' + p + ' · ' + esc(priName(p)) + '</option>';
  }).join("");
}
function openPlanDialog(id, replan){
  var d = findDemand(id);
  if(!d) return;
  if(!canScheduleDemand(d)){ denySchedule(); return; }
  planDemandId = id;
  planDemandRevision = d.revision;
  planAction = replan ? "replan" : "plan";
  syncPlanPriOptions();
  if($("demandPlanTitle")) $("demandPlanTitle").textContent = replan ? "调整需求排期" : "安排需求排期";
  btnDoPlan.textContent = replan ? "保存调期" : "排期";
  fDemandPlanVer.classList.remove("invalid");
  dpNote.value = "";
  dpNote.required = !!replan;
  dpNote.placeholder = replan ? "必填：调期原因（不修改关联任务）" : "选填：排期说明";
  dpNote.setAttribute("aria-label", replan ? "调期原因（必填）" : "排期备注（选填）");
  if(dpPlannedStart) dpPlannedStart.value = d.plannedStart || "";
  if(dpPlannedEnd) dpPlannedEnd.value = d.plannedEnd || "";
  if(dpPriority) dpPriority.value = d.priority || "P2";
  resetPlanTasks();
  UI.openModal($("dlgDemandPlan"), "select");
  dpVersion.innerHTML = '<option value="">加载中…</option>';
  dpVersion.disabled = true;
  /* 列表模式跨项目，版本要按需求所属项目取 */
  API.get("/api/versions", { reqId: d.reqId }).then(function(list){
    if(planDemandId !== id) return;
    (list || []).forEach(function(v){ versionNames[v.id] = v.name; });
    if(listPrefs.viewMode("demand-pool") === "board") versions = list || [];
    fillPlanVersions(d, list || []);
  }).catch(function(ex){
    if(planDemandId !== id) return;
    dpVersion.innerHTML = '<option value="">（版本加载失败）</option>';
    toast(ex.message || "版本加载失败", "bad");
  });
}
function fillPlanVersions(d, list){
  var usable = list.filter(function(v){ return v.status !== "released"; });
  dpVersion.innerHTML = '<option value="">暂不指定目标版本</option>' + usable.map(function(v){
    return '<option value="' + esc(v.id) + '">' + esc(v.name) + (v.targetDate ? (" · 目标 " + String(v.targetDate).substring(5, 10)) : "") + '</option>';
  }).join("");
  dpVersion.disabled = false;
  dpVersion.value = d.versionId && usable.some(function(v){ return v.id === d.versionId; }) ? d.versionId : "";
  loadPlanTaskCandidates();
}
/* ---------- 排期内联带入工作项 ---------- */

function resetPlanTasks(){
  /* 保留 seq：关窗后再开同一需求，旧请求不能覆盖新一轮候选 */
  var seq = planTaskState.seq;
  planTaskState = { seq:seq, versionId:"", loaded:false, loading:false, items:[], selected:{}, query:"", total:0 };
  if(!dpTaskBlock) return;
  dpTaskBlock.hidden = true;
  if(dpTaskPicker) dpTaskPicker.hidden = true;
  if(dpTaskExpandBtn){ dpTaskExpandBtn.hidden = false; dpTaskExpandBtn.setAttribute("aria-expanded", "false"); dpTaskExpandBtn.textContent = "展开选择"; }
  if(dpTaskToggle){ dpTaskToggle.checked = true; dpTaskToggle.disabled = false; }
  if(dpTaskList) dpTaskList.innerHTML = "";
  if(dpTaskSearch) dpTaskSearch.value = "";
  if(dpTaskSummary) dpTaskSummary.textContent = "";
  if(dpTaskEmpty) dpTaskEmpty.hidden = true;
}
function planTaskIds(){
  return planTaskState.items.filter(function(t){ return planTaskState.selected[t.id]; }).map(function(t){ return t.id; });
}
/* 勾选与否只影响本次提交；没有候选或未加载成功时一律不提交 */
function planTasksToAdd(){
  if(!dpTaskBlock || dpTaskBlock.hidden || !planTaskState.loaded) return [];
  if(dpTaskToggle && !dpTaskToggle.checked) return [];
  return planTaskIds();
}
function planTaskSummaryText(){
  if(!planTaskState.loaded) return planTaskState.loading ? "正在查找需求名下的工作项…" : "";
  var total = planTaskState.total || planTaskState.items.length;
  if(dpTaskToggle && !dpTaskToggle.checked) return "本次不加入工作项（共 " + total + " 项候选）";
  var n = planTaskIds().length;
  var cap = planTaskState.total > planTaskState.items.length
    ? "，仅列出前 " + planTaskState.items.length + " 项" : "";
  return "将加入 " + n + " 项（共 " + total + " 项候选，默认勾选未完成" + cap + "）";
}
function hiddenPlanTaskSelected(){
  if(!planTaskState.query.trim() || !dpTaskList) return 0;
  var n = 0;
  dpTaskList.querySelectorAll("[data-dp-task-row]").forEach(function(row){
    if(!row.hidden) return;
    var cb = row.querySelector("[data-dp-task-check]");
    if(cb && cb.checked) n++;
  });
  return n;
}
function syncPlanTaskUI(){
  if(dpTaskSummary) dpTaskSummary.textContent = planTaskSummaryText();
  if(!dpTaskCount) return;
  var total = planTaskState.total || planTaskState.items.length;
  var hidden = hiddenPlanTaskSelected();
  dpTaskCount.textContent = "已选 " + planTaskIds().length + " / 共 " + total + " 项"
    + (hidden ? "（筛选外 " + hidden + " 项也会加入）" : "");
}
function filterPlanTaskRows(){
  if(!dpTaskList) return;
  var q = planTaskState.query.trim().toLowerCase(), shown = 0;
  dpTaskList.querySelectorAll("[data-dp-task-row]").forEach(function(row){
    var match = !q || (row.getAttribute("data-task-title") || "").indexOf(q) !== -1;
    row.hidden = !match;
    if(match) shown++;
  });
  if(dpTaskEmpty) dpTaskEmpty.hidden = shown !== 0;
}
function renderPlanTasks(){
  if(!dpTaskList) return;
  var versionId = planTaskState.versionId;
  dpTaskList.innerHTML = planTaskState.items.map(function(t){
    var bits = [];
    var typeTag = typeBadgeHTML(t.itemType);
    if(typeTag) bits.push(typeTag);
    bits.push(esc(t.owner || "未指派"));
    bits.push(t.boardColumn === "done" ? '<span class="tag tag-success">已完成</span>'
      : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>');
    /* 与「补录工作项」弹窗同口径：工作项可同时属于多个版本，列出其他归属避免只看到本版本 */
    var ids = taskVersionIds(t);
    var others = ids.filter(function(vid){ return vid !== versionId; });
    if(others.length){
      bits.push("其他关联：" + esc(others.map(function(vid){
        var name = t.versionNames && t.versionNames[ids.indexOf(vid)];
        return name || vid;
      }).join("、")));
    }
    return '<label class="version-task-row" data-dp-task-row data-task-title="' + esc(String((t.title || "") + " " + (t.owner || "")).toLowerCase()) + '">'
      + '<input type="checkbox" data-dp-task-check="' + esc(t.id) + '"' + (planTaskState.selected[t.id] ? " checked" : "") + ' />'
      + '<span class="version-task-main"><span class="version-task-title"><b>' + esc(t.title) + '</b></span>'
      + '<small>' + bits.join(" · ") + '</small></span></label>';
  }).join("");
  filterPlanTaskRows();
}
/* 候选口径与「补录工作项」一致：只列需求名下尚未绑定该版本的工作项；pass 需求在排期前也能预览 */
function loadPlanTaskCandidates(){
  if(!dpTaskBlock) return;
  var demandId = planDemandId, verId = dpVersion && dpVersion.value;
  if(planAction === "replan" || !demandId || !verId){
    dpTaskBlock.hidden = true;
    return;
  }
  var seq = ++planTaskState.seq;
  planTaskState.versionId = verId;
  planTaskState.loading = true;
  planTaskState.loaded = false;
  planTaskState.items = [];
  planTaskState.selected = {};
  planTaskState.query = "";
  planTaskState.total = 0;
  dpTaskBlock.hidden = false;
  /* 换版本只重置候选与勾选，保留用户已做的「不加工作项」选择 */
  if(dpTaskToggle) dpTaskToggle.disabled = false;
  if(dpTaskExpandBtn){ dpTaskExpandBtn.hidden = false; dpTaskExpandBtn.setAttribute("aria-expanded", "false"); dpTaskExpandBtn.textContent = "展开选择"; }
  if(dpTaskPicker) dpTaskPicker.hidden = true;
  if(dpTaskList) dpTaskList.innerHTML = "";
  if(dpTaskSearch) dpTaskSearch.value = "";
  if(dpTaskEmpty) dpTaskEmpty.hidden = true;
  if(dpTaskSummary) dpTaskSummary.textContent = "正在查找需求名下的工作项…";
  API.get("/api/demands/" + encodeURIComponent(demandId) + "/version-task-candidates", {
    versionId: verId, offset: 0, limit: 100
  }).then(function(page){
    if(seq !== planTaskState.seq || planDemandId !== demandId) return;
    page = page || {};
    var items = page.items || [];
    planTaskState.items = items;
    planTaskState.total = Number(page.total) || items.length;
    planTaskState.selected = {};
    /* 已完成工作项通常已随历史版本交付，默认不勾，由用户自己决定是否回填 */
    items.forEach(function(t){ if(t.boardColumn !== "done") planTaskState.selected[t.id] = true; });
    planTaskState.loading = false;
    planTaskState.loaded = true;
    if(!items.length){ dpTaskBlock.hidden = true; return; }
    renderPlanTasks();
    syncPlanTaskUI();
  }).catch(function(ex){
    if(seq !== planTaskState.seq) return;
    planTaskState.loading = false;
    planTaskState.loaded = true;
    /* 读候选失败不阻断排期：如实说明，之后仍可在版本页「管理工作项」补录 */
    dpTaskBlock.hidden = false;
    if(dpTaskToggle) dpTaskToggle.disabled = true;
    if(dpTaskExpandBtn) dpTaskExpandBtn.hidden = true;
    if(dpTaskSummary) dpTaskSummary.textContent = "候选工作项加载失败：" + (ex.message || "稍后可在版本页补录");
  });
}
function doPlan(){
  if(!planDemandId) return;
  if(!canScheduleDemand(findDemand(planDemandId))){ denySchedule(); return; }
  var verId = dpVersion.value, start = dpPlannedStart && dpPlannedStart.value, end = dpPlannedEnd && dpPlannedEnd.value;
  if(dpVersion.disabled) return;
  if(start && end && start > end){ toast("计划开始日期不能晚于计划结束日期", "warn"); return; }
  if(planAction === "replan" && !dpNote.value.trim()){ toast("请填写调期原因", "warn"); dpNote.focus(); return; }
  /* 候选还在路上时提交会静默丢掉勾选：等一拍再排期 */
  if(dpTaskBlock && !dpTaskBlock.hidden && planTaskState.loading){ toast("正在加载需求名下的工作项，请稍候再提交", "warn"); return; }
  /* 先定下本次要带入的工作项：排期成功后弹窗即关，不能再读勾选状态 */
  var demandId = planDemandId, action = planAction;
  var taskIds = action === "plan" ? planTasksToAdd() : [];
  btnDoPlan.disabled = true;
  API.post("/api/demands/" + encodeURIComponent(demandId) + "/" + action, {
    versionId: verId || null,
    plannedStart: start || null,
    plannedEnd: end || null,
    priority: dpPriority ? dpPriority.value : findDemand(demandId).priority,
    revision: planDemandRevision,
    note: dpNote.value.trim() || null
  }).then(function(){
    finishPlan(demandId, action, verId, taskIds);
  }).catch(function(ex){
    btnDoPlan.disabled = false;
    toast(ex.message || "排期失败", "bad");
    if(ex.code === 409){ UI.closeModal($("dlgDemandPlan")); planDemandId = null; closeDemandDetailIfOpen(); loadDemands(); }
  });
}
/* 排期已落库：补关联失败只能单独提示补录入口，不能当成排期失败让用户重试 */
function finishPlan(demandId, action, verId, taskIds){
  btnDoPlan.disabled = false;
  UI.closeModal($("dlgDemandPlan"));
  closeDemandDetailIfOpen();
  var dest = verId ? "到「" + versionName(verId) + "」" : "，暂不指定目标版本";
  var label = action === "replan" ? "已调期" : "已排期";
  planDemandId = null;
  drawerDemandOpts.reqId = null;
  loadDemands();
  if(taskIds && taskIds.length){
    API.post("/api/demands/" + encodeURIComponent(demandId) + "/version-tasks", {
      versionId: verId, taskIds: taskIds
    }).then(function(res){
      var added = Number(res && res.added) || 0, skipped = Number(res && res.skipped) || 0;
      toast(added
        ? label + dest + "，已加入 " + added + " 项工作项" + (skipped ? "，" + skipped + " 项已存在跳过" : "")
        : label + dest + "，所选工作项均已在该版本中", "fs");
    }).catch(function(ex){
      toast(label + dest + "，但工作项带入失败：" + (ex.message || "未知原因") + "；可在版本页「管理工作项」补录", "warn");
    });
    return;
  }
  toast(label + dest + "，关联任务不变", "fs");
}

/* 补录工作项：只新增目标版本关联，不改工作项计划日期；版本页「补录工作项」与已排需求抽屉共用 */
function openDemandVersionBackfill(demandId, versionId, label, opts){
  opts = opts || {};
  var versionLabel = label || versionName(versionId) || versionId;
  function refreshHost(){
    if(opts.onDone){ opts.onDone({}); return; }
    closeDemandDetailIfOpen();
    loadDemands();
  }
  API.get("/api/demands/" + encodeURIComponent(demandId) + "/version-task-candidates", {
    versionId: versionId, offset: 0, limit: 100
  }).then(function(page){
    page = page || {};
    var items = page.items || [], total = Number(page.total) || 0;
    if(!total){
      toast(opts.emptyText || "没有可带入的工作项（可能已全部在版本中）", "fs");
      return;
    }
    renderBackfill(items, total);
  }).catch(function(ex){
    toast(ex.message || "候选工作项加载失败", "bad");
    /* 候选端 400/409 表示需求排期或版本前提已过期：刷新宿主，避免继续操作旧数据 */
    if(ex.code === 409 || ex.code === 400) refreshHost();
  });

  function renderBackfill(items, total){
    var selected = {}, query = "", busy = false;
    /* 默认勾选未完成项：已完成工作项通常已随历史版本交付，由用户自己决定是否回填 */
    items.forEach(function(t){ if(t.boardColumn !== "done") selected[t.id] = true; });
    var layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
    UI.setModalCloseGuard(layer, function(){ if(!busy) UI.closeModal(layer); });
    layer.innerHTML = '<div class="sheet version-task-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
      + '<h2>把工作项带入「' + esc(versionLabel) + '」？</h2>'
      + '<div class="desc">需求已排期到此版本，关联任务默认不变。勾选后只新增版本关联，不改工作项的计划日期；默认勾选未完成项。</div></div>'
      + '<button class="icon-btn sm" type="button" data-backfill-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
      + '<div class="sheet-body"><div class="version-task-tools">'
      + '<input type="search" placeholder="搜索工作项标题或负责人…" aria-label="搜索候选工作项" data-backfill-search autocomplete="off" />'
      + '<span class="version-task-count" role="status"></span></div>'
      + '<div class="version-task-list"></div>'
      + '<p class="hint" data-backfill-empty hidden>没有匹配的工作项</p>'
      + '<p class="foot-note" data-backfill-cap' + (total > items.length ? "" : " hidden") + '>共 ' + total + ' 项，此处列出前 ' + items.length + ' 项；其余可在版本页「管理工作项」中补录。</p></div>'
      + '<div class="sheet-foot"><button class="btn" type="button" data-backfill-later>稍后再说</button>'
      + '<span style="flex:1"></span><button class="btn primary" type="button" data-backfill-save></button></div></div>';
    var list = layer.querySelector(".version-task-list");
    var countEl = layer.querySelector(".version-task-count");
    var saveBtn = layer.querySelector("[data-backfill-save]");
    function selectedIds(){
      return items.filter(function(t){ return selected[t.id]; }).map(function(t){ return t.id; });
    }
    /* 搜索只隐藏行、不改勾选：明确提示筛选外仍会一并加入，避免误以为只提交可见项 */
    function hiddenSelectedCount(){
      if(!query.trim()) return 0;
      var n = 0;
      list.querySelectorAll("[data-backfill-row]").forEach(function(row){
        if(!row.hidden) return;
        var cb = row.querySelector("[data-backfill-check]");
        if(cb && cb.checked) n++;
      });
      return n;
    }
    function syncCount(){
      var n = selectedIds().length, hidden = hiddenSelectedCount();
      countEl.textContent = "已选 " + n + " / 共 " + total + " 项"
        + (hidden ? "（筛选外 " + hidden + " 项也会加入）" : "");
      saveBtn.disabled = n === 0 || busy;
      saveBtn.textContent = n ? "加入版本（" + n + "）" : "加入版本";
    }
    function rowHTML(t){
      var ids = taskVersionIds(t);
      var others = ids.filter(function(vid){ return vid !== versionId; });
      var bits = [];
      var typeTag = typeBadgeHTML(t.itemType);
      if(typeTag) bits.push(typeTag);
      bits.push(esc(t.owner || "未指派"));
      bits.push(t.boardColumn === "done" ? '<span class="tag tag-success">已完成</span>'
        : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>');
      if(others.length){
        bits.push("其他关联：" + esc(others.map(function(vid){
          var name = t.versionNames && t.versionNames[ids.indexOf(vid)];
          return name || vid;
        }).join("、")));
      }
      return '<label class="version-task-row" data-backfill-row data-task-title="' + esc(String((t.title || "") + " " + (t.owner || "")).toLowerCase()) + '">'
        + '<input type="checkbox" data-backfill-check="' + esc(t.id) + '"' + (selected[t.id] ? " checked" : "") + ' />'
        + '<span class="version-task-main"><span class="version-task-title"><b>' + esc(t.title) + '</b></span>'
        + '<small>' + bits.join(" · ") + '</small></span></label>';
    }
    function filterRows(){
      var q = query.trim().toLowerCase(), shown = 0;
      list.querySelectorAll("[data-backfill-row]").forEach(function(row){
        var match = !q || (row.getAttribute("data-task-title") || "").indexOf(q) !== -1;
        row.hidden = !match;
        if(match) shown++;
      });
      layer.querySelector("[data-backfill-empty]").hidden = shown !== 0;
    }
    list.innerHTML = items.map(rowHTML).join("");
    document.body.appendChild(layer);
    filterRows();
    syncCount();
    layer.addEventListener("input", function(e){
      if(busy || !e.target.closest("[data-backfill-search]")) return;
      query = e.target.value;
      filterRows();
      syncCount();
    });
    layer.addEventListener("change", function(e){
      if(busy) return;
      var check = e.target.closest("[data-backfill-check]");
      if(!check) return;
      selected[check.getAttribute("data-backfill-check")] = check.checked;
      syncCount();
    });
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-backfill-x], [data-backfill-later]")){
        if(busy) return;
        UI.closeModal(layer);
        return;
      }
      var save = e.target.closest("[data-backfill-save]");
      if(!save || save.disabled || busy) return;
      var taskIds = selectedIds();
      if(!taskIds.length) return;
      busy = true;
      syncCount();
      API.post("/api/demands/" + encodeURIComponent(demandId) + "/version-tasks", {
        versionId: versionId, taskIds: taskIds
      }).then(function(res){
        UI.closeModal(layer);
        var added = Number(res && res.added) || 0, skipped = Number(res && res.skipped) || 0;
        toast(added
          ? "已把 " + added + " 项工作项加入「" + versionLabel + "」" + (skipped ? "，" + skipped + " 项已存在跳过" : "")
          : "所选工作项均已在「" + versionLabel + "」中", "fs");
        if(opts.onDone) opts.onDone(res || {});
        else refreshHost();
      }).catch(function(ex){
        busy = false;
        syncCount();
        /* 该端点的 400/409 都是前提已变化（版本冻结、排期变更、任务被删/移走）：关窗并刷新宿主 */
        if(ex.code === 409 || ex.code === 400){
          UI.closeModal(layer);
          toast(ex.message || "带入工作项失败", "bad");
          refreshHost();
          return;
        }
        toast(ex.message || "带入工作项失败", "bad");
      });
    });
    UI.openModal(layer);
  }
}

/* ---------- 详情（动态弹窗） ---------- */

function attUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function attThumbUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function extOfName(filename){
  var idx = String(filename || "").lastIndexOf(".");
  return idx >= 0 ? String(filename).substring(idx + 1) : "";
}
/* 交付表只展示一个生产发布结论；历史发布压成一行小字，避免 5 列里塞两枚胶囊把表格撑宽 */
/* 有发布事实即算已发布：正式记录的当前生效/部分/回滚/覆盖未知，或人工补录 */
function demandTaskPublished(task){
  return !!(task.publishedAt || task.everPublished === true || task.manualPublished === true
    || (task.publicationState && task.publicationState !== "unpublished")
    || (Array.isArray(task.publicationTargets) && task.publicationTargets.length));
}
function demandPublicationCell(task){
  if(!task) return '<span class="tag ghost">未发布</span>';
  var state = task.publicationState || "unpublished";
  var meta = {
    effective: ["生产生效", "tag-success"],
    partial: ["生产部分生效", "tag-neutral"],
    rolled_back: ["生产已回滚", "tag-neutral"],
    unknown: ["生产覆盖未知", "tag-neutral"]
  }[state];
  var html = meta
    ? '<span class="tag ' + meta[1] + '" title="仅来自正式生产发布记录">' + meta[0] + '</span>'
    : (task.manualPublished === true
      ? '<span class="tag tag-neutral" title="人工补录的历史发布事实，不代表当前生产生效">已发布（人工）</span>'
      : '<span class="tag ghost">未发布</span>');
  if(task.everPublished === true && state !== "effective"){
    html += '<span class="t-sub">曾生产发布</span>';
  }
  return html;
}
function loadDemandTasks(layer, id, targetVersionId){
  var box = layer.querySelector("#demTasks");
  var overview = layer.querySelector("#demandOverviewTasks");
  var count = layer.querySelector("#tabDeliveryCount");
  var progress = layer.querySelector("#demandProgressCount");
  if(!box && !overview && !count && !progress) return;
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    return Promise.all([
      Promise.resolve(tasks),
      API.get("/api/test-cases/task-coverage", { demandId: id }).catch(function(){ return []; })
    ]);
  }).then(function(results){
    if(!layer.isConnected) return;
    var tasks = results[0] || [];
    var covByTask = {};
    (results[1] || []).forEach(function(r){ covByTask[r.taskId] = r; });
    tasks = tasks || [];
    if(!tasks.length){
      if(count) count.textContent = "0/0";
      if(progress) progress.textContent = "0 / 0 完成";
      if(overview) overview.innerHTML = '<li class="read-empty">尚未拆分工作项</li>';
      if(box) box.innerHTML = '<div class="attach-empty">还没有关联工作项；通过「拆分为工作项」把需求拆开执行。</div>';
      return;
    }
    var published = tasks.filter(function(t){ return t.publicationState === "effective"; }).length;
    var partial = tasks.filter(function(t){ return t.publicationState === "partial"; }).length;
    var historical = tasks.filter(function(t){ return t.everPublished === true; }).length;
    var done = tasks.filter(function(t){ return t.boardColumn === "done"; }).length;
    var delivery = "当前生产全量生效 " + published + " 项，部分生效 " + partial + " 项；曾生产发布 " + historical + " 项";
    if(count) count.textContent = done + "/" + tasks.length;
    if(progress) progress.textContent = done + " / " + tasks.length + " 完成";
    if(overview){
      overview.innerHTML = tasks.slice(0, 3).map(function(t){
        var isDone = t.boardColumn === "done";
        return '<li data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
          + '<span class="ra-time">' + (isDone ? "已完成" : esc(colName(t.boardColumn))) + '</span>'
          + '<span class="ra-txt">' + esc(t.title) + taskPublicationHTML(t)
          + (t.owner ? ' <span class="ra-owner">' + esc(t.owner) + '</span>' : '') + '</span></li>';
      }).join("") + (tasks.length > 3 ? '<li class="read-empty">另有 ' + (tasks.length - 3) + ' 项，可在「交付」页签查看</li>' : "");
    }
    if(!box) return;
    box.innerHTML = '<p class="foot-note">' + esc(delivery) + '（' + published + '/' + tasks.length
      + '）。任务发布不等于需求业务验收；版本为当前计划，实际交付以工作项详情中的版本发布记录为准。</p>'
      + '<div class="dem-evidence-tools"><label class="phase-filter"><span>发布</span>'
      + '<select class="mini-select" data-dem-task-pub aria-label="按发布状态筛选">'
      + '<option value="">全部发布状态</option><option value="published">已发布</option><option value="unpublished">未发布</option>'
      + '</select></label></div>'
      + '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl dem-evidence-tbl"><thead><tr>'
      + '<th>工作项</th><th>项目</th><th>类型</th><th>负责人</th><th>状态</th><th>验证用例</th><th>生产发布</th></tr></thead><tbody>'
      + tasks.map(function(t){
        var isDone = t.boardColumn === "done";
        var verText = taskVersionsText(t) || "未绑版本";
        var verHTML = taskVersionIds(t).length ? taskVersionLinksHTML(t, t.reqId) : esc(verText);
        var mismatch = targetVersionId && taskVersionIds(t).indexOf(targetVersionId) === -1;
        /* 存量跨项目关联时，本表可能出现其他项目的工作项，按工作项自身项目展示 */
        var reqName = reqNameById(t.reqId);
        var reqLinked = !!(t.reqId && reqName !== "无");
        var reqCell = reqLinked
          ? assocLinkHTML("project", t.reqId, reqName)
          : '<span class="muted">—</span>';
        var cov = covByTask[t.id];
        var covCell = !cov || !(cov.caseTotal > 0)
          ? '<span class="tag tag-warning" title="该工作项还没有用例验证；用例可只关联需求，因此不等于需求整体未覆盖">未覆盖</span>'
          : '<span class="tag ' + (cov.failed > 0 ? "tag-danger" : "tag-success") + '" title="工作项级覆盖：' + cov.caseTotal + ' 条用例">'
            + cov.caseTotal + ' 条' + (cov.failed > 0 ? " · " + cov.failed + " 失败" : "")
            + (cov.untested > 0 ? " · " + cov.untested + " 未执行" : "") + '</span>';
        return '<tr data-open-task="' + esc(t.id) + '" data-published="' + (demandTaskPublished(t) ? "1" : "0") + '" title="打开工作项详情">'
          + '<td class="t-title-cell"><div class="t-title">' + esc(t.title) + '</div>'
            + '<div class="t-sub">' + (t.estimateMinutes ? esc(fmtMinutesShort(t.estimateMinutes)) + " · " : "") + verHTML
            + (mismatch ? ' · <span class="tag ghost">未关联目标版本</span>' : '') + '</div></td>'
          + '<td class="t-proj-cell" title="' + esc(reqLinked ? reqName : "未归属项目") + '">' + reqCell + '</td>'
          + '<td>' + typeBadgeHTML(t.itemType) + '</td>'
          + '<td>' + esc(t.owner || "—") + '</td>'
          + '<td>' + (isDone ? '<span class="tag tag-success">已完成</span>'
            : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
          + '<td>' + covCell + '</td>'
          + '<td>' + demandPublicationCell(t) + '</td>'
          + '</tr>';
      }).join("")
      + '</tbody></table></div>';
    var pubSel = box.querySelector("[data-dem-task-pub]");
    if(pubSel) pubSel.addEventListener("change", function(){
      var v = pubSel.value;
      box.querySelectorAll("tbody tr[data-open-task]").forEach(function(tr){
        var isPub = tr.getAttribute("data-published") === "1";
        tr.hidden = !!v && (v === "published" ? !isPub : isPub);
      });
    });
  }).catch(function(){
    if(!layer.isConnected) return;
    if(box) box.innerHTML = '<div class="attach-empty">关联工作项加载失败</div>';
    if(overview) overview.innerHTML = '<li class="read-empty">关联工作项加载失败</li>';
  });
}
/* 需求工时：只读展示产品 / 设计、开发、测试三段。
   口径与版本页阶段工时一致：测试窗口内先归测试，需求类剩余归产品，任务 / 缺陷剩余归开发。 */
function demHoursValue(m){
  var n = Number(m) || 0;
  return n > 0 ? fmtMinutesShort(n) : "—";
}
function demHoursPct(part, total){
  if(!total) return "—";
  return Math.round((Number(part) || 0) * 100 / total) + "%";
}
function demHoursDelta(act, est){
  if(!est) return "—";
  var d = Math.round((act - est) * 100 / est);
  return (d > 0 ? "+" : "") + d + "%";
}
function demHoursDeltaTone(act, est){
  if(!est) return "";
  var d = (act - est) * 100 / est;
  if(d < 0) return Math.abs(d) <= 15 ? "ok" : "";
  return Math.abs(d) <= 15 ? "ok" : (Math.abs(d) <= 40 ? "warn-text" : "bad-text");
}
function loadDemandHours(layer, id){
  var box = layer.querySelector("#demandHoursBody");
  var meta = layer.querySelector("#demandHoursMeta");
  if(!box) return;
  API.get("/api/demands/" + encodeURIComponent(id) + "/hours").then(function(h){
    if(!layer.isConnected || !box.isConnected) return;
    h = h || {};
    var count = Number(h.taskCount) || 0;
    var est = Number(h.estimateMinutes) || 0;
    var act = Number(h.actualMinutes) || 0;
    if(meta) meta.textContent = count ? count + " 个工作项 · " + (h.estimatedCount || 0) + " 项已估" : "";
    if(!count){
      box.innerHTML = '<p class="read-empty">还没有关联工作项；拆分后才能统计阶段工时。</p>';
      return;
    }
    var delta = demHoursDelta(act, est), tone = demHoursDeltaTone(act, est);
    var kpis = '<div class="dem-hours-kpis">'
      + '<div class="dem-hours-kpi"><span>预计</span><b>' + demHoursValue(est) + '</b></div>'
      + '<div class="dem-hours-kpi"><span>实际</span><b>' + demHoursValue(act) + '</b></div>'
      + '<div class="dem-hours-kpi"><span>偏差</span><b class="' + tone + '">' + delta + '</b></div>'
      + '</div>';
    var bar = '';
    if(act > 0){
      bar = '<div class="dem-hours-bar" role="img" aria-label="' + esc(STAGE_META.map(function(m){
        return m.name + " " + demHoursValue(h[m.key + "ActualMinutes"]) + " " + demHoursPct(h[m.key + "ActualMinutes"], act);
      }).join("，")) + '">'
        + STAGE_META.map(function(m){
          var w = Math.round((Number(h[m.key + "ActualMinutes"]) || 0) * 10000 / act) / 100;
          return w > 0 ? '<i style="width:' + w + '%;background:' + m.color + '"></i>' : "";
        }).join("") + '</div>';
    }
    var rows = STAGE_META.map(function(m){
      var se = Number(h[m.key + "EstimateMinutes"]) || 0;
      var sa = Number(h[m.key + "ActualMinutes"]) || 0;
      return '<tr>'
        + '<td><span class="dem-hours-name"><i style="background:' + m.color + '"></i>' + esc(m.name)
        + '<small>' + esc(m.note) + '</small></span></td>'
        + '<td class="num">' + demHoursValue(se) + '</td>'
        + '<td class="num"><b>' + demHoursValue(sa) + '</b></td>'
        + '<td class="num">' + demHoursPct(sa, act) + '</td>'
        + '<td class="num ' + demHoursDeltaTone(sa, se) + '">' + demHoursDelta(sa, se) + '</td></tr>';
    }).join("");
    var table = '<div class="tbl-wrap"><table class="dem-hours-tbl"><thead><tr>'
      + '<th>阶段</th><th class="num">预计</th><th class="num">实际</th><th class="num">实际占比</th><th class="num">偏差</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    var notes = [];
    if(!act) notes.push("还没有已结束的计时，拆分要等第一条计时产生。");
    if(Number(h.unestimatedCount))
      notes.push(h.unestimatedCount + " 项没有预估，未按 0 计入偏差；补齐预计后偏差才完整。");
    notes.push("产品 / 设计按需求类工作项的计时近似；测试按「提测 → 测试结束」的自然日窗口；史诗只做分组，不计入工时。");
    box.innerHTML = kpis + bar + table + '<p class="foot-note">' + notes.map(esc).join(" ") + '</p>';
  }).catch(function(){
    if(!layer.isConnected || !box.isConnected) return;
    box.innerHTML = '<p class="read-empty">工时加载失败</p>';
  });
}
/* 需求详情里工作项数量或计时变化后，交付表与工时卡一起刷新 */
function refreshDemandWork(layer, id, versionId){
  loadDemandTasks(layer, id, versionId);
  loadDemandHours(layer, id);
}
/* 概览属性条「文档/附件」计数：0 显示暂无（与工作项附件一致），未加载显示 … */
function demandRelCountHTML(kind, n){
  if(n == null) return "…";
  if(!n) return '<span class="rf-empty">暂无</span>';
  return esc(n + (kind === "docs" ? " 篇" : " 个"));
}
/* 加载完成后就地刷新计数，不整组重建事实条，避免丢掉键盘焦点 */
function setDemandRelCount(layer, kind, n){
  layer.__relCounts = layer.__relCounts || {};
  layer.__relCounts[kind] = n;
  var v = layer.querySelector('[data-dem-rel-jump="' + kind + '"] .rf-v');
  if(v) v.innerHTML = demandRelCountHTML(kind, n);
}
function loadDemandAttachments(layer, id, writable){
  var box = layer.querySelector("#demAtts");
  if(!box) return;
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/attachments").then(function(list){
    if(!layer.isConnected) return;
    box.__attList = list || [];
    setDemandRelCount(layer, "atts", box.__attList.length);
    if(!box.__attList.length){
      box.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、Office、txt、md、zip，单个 ≤10MB）</div>';
      return;
    }
    box.innerHTML = box.__attList.map(function(a){
      var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
      var isSheet = /\.(xlsx|xls)$/i.test(a.filename || "");
      var canPrev = previewable(a.filename);
      /* 与任务抽屉一致：可预览的缩略图/文件名直接开弹框，表格开 Univer，其余（zip、ppt）走新标签 */
      var openKey = canPrev ? ' data-att-prev="' + esc(a.id) + '"'
        : (isSheet ? ' data-att-sheet="' + esc(a.id) + '"' : "");
      var openTitle = canPrev ? "在线预览" : (isSheet ? "打开表格" : "预览 / 下载");
      var isOpen = canPrev || isSheet;
      var openCls = isOpen ? ' class="att-open"' : "";
      var url = attUrl(a.id);
      var head = isImg
        ? '<img class="att-thumb' + (isOpen ? " is-open" : "") + '" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy"' + openKey + ' />'
        : '<span class="att-icon' + (isOpen ? " is-open" : "") + '"' + openKey + '>' + esc(extOfName(a.filename).toUpperCase().slice(0, 4) || "FILE") + '</span>';
      return '<div class="attach-item">' + head +
        '<span class="att-name"><a' + openCls + ' href="' + url + '" target="_blank" rel="noopener" title="' + openTitle + '"' + openKey + '>' + esc(a.filename) + '</a></span>' +
        '<span class="att-size">' + fmtSize(a.size) + '</span>' +
        '<span class="att-acts">' +
          (canPrev ? '<button class="icon-btn sm" type="button" data-att-prev="' + esc(a.id) + '" title="在线预览" aria-label="在线预览">' + icon("eye", 14) + '</button>' : '') +
          (isSheet ? '<button class="icon-btn sm" type="button" data-att-sheet="' + esc(a.id) + '" title="打开表格" aria-label="打开表格">' + icon("table", 14) + '</button>' : '') +
          '<a class="icon-btn sm" href="' + url + '" download title="下载" aria-label="下载附件">' + icon("download", 14) + '</a>' +
          (writable ? '<button class="icon-btn sm danger" type="button" data-att-del="' + esc(a.id) + '" title="删除附件" aria-label="删除附件">' + icon("trash", 14) + '</button>' : '') +
        '</span>' +
      '</div>';
    }).join("");
  }).catch(function(){
    if(layer.isConnected) box.innerHTML = '<div class="attach-empty">附件加载失败</div>';
  });
}

function loadDemandDocs(layer, id, reqId, writable){
  var box = layer.querySelector("#demDocs");
  var pick = layer.querySelector("#demDocPick");
  if(!box) return;
  Promise.all([
    API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/docs"),
    API.getAllPages("/api/req-docs")
  ]).then(function(res){
    if(!layer.isConnected) return;
    var linked = res[0] || [];
    setDemandRelCount(layer, "docs", linked.length);
    var all = (res[1] || []).filter(function(r){ return r.reqId === reqId; });
    var linkedIds = {};
    linked.forEach(function(doc){ linkedIds[doc.id] = true; });
    box.innerHTML = linked.length ? linked.map(function(doc){
      var md = doc.format === "markdown";
      var iconText = md ? "MD" : (doc.format === "sheet" ? "XLS" : "HTML");
      return '<div class="attach-item dem-doc-item">'
        + '<span class="att-icon">' + iconText + '</span>'
        + '<span class="att-name"><button class="link-cell" type="button" data-dem-doc-open="' + esc(doc.id) + '">' + esc(doc.title) + '</button></span>'
        + '<span class="att-size">' + esc(docTypeName(doc.docType)) + '</span>'
        + '<span class="att-acts">' + (writable
          ? '<button class="icon-btn sm danger" type="button" data-dem-doc-unlink="' + esc(doc.id) + '" title="取消关联" aria-label="取消关联">' + icon("close", 13) + '</button>'
          : '') + '</span>'
        + '</div>';
    }).join("") : '<div class="attach-empty">' + (writable ? "还没有关联文档；从下方选择当前项目的文档。" : "还没有关联文档。") + '</div>';
    if(!pick) return;
    var opts = all.filter(function(r){ return !linkedIds[r.id]; });
    if(!all.length){
      pick.innerHTML = '<option value="">当前项目还没有文档</option>';
      pick.disabled = true;
    }else if(!opts.length){
      pick.innerHTML = '<option value="">当前项目的文档都已关联</option>';
      pick.disabled = true;
    }else{
      pick.disabled = false;
      pick.innerHTML = '<option value="">选择要关联的文档…</option>' + opts.map(function(r){
        return '<option value="' + esc(r.id) + '">' + esc(docTypeName(r.docType)) + ' · ' + esc(r.title) + '</option>';
      }).join("");
    }
  }).catch(function(ex){
    if(layer.isConnected) box.innerHTML = '<div class="attach-empty">' + esc(ex.message || "关联文档加载失败") + '</div>';
  });
}

/* ---------- 需求评论：一层回复、解决、@提及、附件、转工作项 ---------- */

/* 评论附件与需求附件走同一张表（target_kind=demand_comment）：
   图片按正文平铺给固定比例缩略图，点开进灯箱；其它类型给扩展名 + 文件名，统一走预览/表格/下载 */
function demandCommentAttIsImg(a){
  return kindOf(a && a.filename) === "image";
}
function demandCommentAttFilesHTML(files){
  if(!files || !files.length) return "";
  var imgs = files.filter(demandCommentAttIsImg);
  var docs = files.filter(function(a){ return !demandCommentAttIsImg(a); });
  var out = "";
  if(imgs.length){
    out += '<div class="dem-comment-imgs">' + imgs.map(function(a){
      var name = a.filename || "图片";
      return '<a class="dem-comment-img" href="' + attUrl(a.id) + '" target="_blank" rel="noopener"'
        + ' data-att-prev="' + esc(a.id) + '" title="' + esc(name) + ' · 点击查看大图">'
        + '<img src="' + attThumbUrl(a.id) + '" alt="' + esc(name) + '" loading="lazy"></a>';
    }).join("") + '</div>';
  }
  if(docs.length){
    out += '<div class="dem-comment-atts">' + docs.map(function(a){
      var canPrev = previewable(a.filename);
      var isSheet = /\.(xlsx|xls)$/i.test(a.filename || "");
      var key = canPrev ? ' data-att-prev="' + esc(a.id) + '"' : (isSheet ? ' data-att-sheet="' + esc(a.id) + '"' : "");
      var tip = canPrev ? "在线查看" : (isSheet ? "打开表格" : "下载");
      return '<a class="dem-comment-att" href="' + attUrl(a.id) + '" target="_blank" rel="noopener"'
        + ' title="' + esc(a.filename || "附件") + ' · ' + tip + '"' + key + '>'
        + '<span class="dem-att-ext">' + esc(extOfName(a.filename).toUpperCase().slice(0, 4) || "FILE") + '</span>'
        + '<span class="dem-att-meta"><span class="dem-att-name">' + esc(a.filename || "附件") + '</span>'
        + '<span class="dem-att-size">' + esc(fmtSize(a.size)) + '</span></span></a>';
    }).join("") + '</div>';
  }
  return out;
}
/* 评论附件按 id 找回对象：预览/表格弹层需要文件名与大小 */
function findDemandCommentAtt(layer, attId){
  var idx = (layer && layer.__attIndex) || {};
  return idx[attId] || null;
}
function registerDemandCommentAtts(layer, rows){
  var idx = layer.__attIndex = layer.__attIndex || {};
  function put(c){
    (c && c.attachments || []).forEach(function(a){ if(a && a.id) idx[a.id] = a; });
  }
  (rows || []).forEach(function(c){
    put(c);
    (c && c.replies || []).forEach(put);
  });
}

function demandCommentThreadHTML(c, compact){
  var html = demandCommentItemHTML(c, false, compact);
  if(c.replies && c.replies.length){
    html += '<div class="reqdoc-comment-replies">';
    c.replies.forEach(function(r){ html += demandCommentItemHTML(r, true, compact); });
    html += '</div>';
  }
  return html;
}

function demandCommentItemHTML(c, isReply, compact){
  var resolvedBadge = c.resolved ? '<span class="reqdoc-resolved-badge">已解决</span>' : '';
  var taskLink = c.taskId
    ? '<a class="reqdoc-comment-tasklink" href="#" data-open-task="' + esc(c.taskId) + '">已转工作项</a>'
    : '';
  var actions = '';
  /* compact：概览里的讨论只读展示，操作统一去「评论」页签做，避免两个入口各有一半按钮 */
  if(c.deletable && !compact){
    actions = '<div class="reqdoc-comment-actions-r">';
    if(!isReply) actions += '<button class="btn sm soft" type="button" data-dem-comment-reply="' + esc(c.id) + '" data-dem-comment-user="' + esc(c.userName || "") + '">回复</button>';
    if(!isReply) actions += '<button class="btn sm soft" type="button" data-dem-comment-resolve="' + esc(c.id) + '" data-dem-comment-resolved="' + (c.resolved ? "1" : "0") + '">' + (c.resolved ? "重新打开" : "解决") + '</button>';
    if(!c.taskId) actions += '<button class="btn sm soft" type="button" data-dem-comment-totask="' + esc(c.id) + '">转工作项</button>';
    actions += '<button class="btn sm danger" type="button" data-dem-comment-del="' + esc(c.id) + '">删除</button>';
    actions += '</div>';
  }
  return '<div class="reqdoc-comment-item' + (isReply ? ' is-reply' : '') + (c.resolved ? ' is-resolved' : '') + '" data-dem-comment-id="' + esc(c.id) + '">'
    + '<div class="reqdoc-comment-head">'
    +   '<span class="reqdoc-comment-user">' + esc(c.userName || "—") + '</span>'
    +   resolvedBadge + taskLink
    +   '<span class="reqdoc-comment-time">' + esc(fmtTs(c.createdAt) || "—") + '</span>'
    + '</div>'
    + '<div class="reqdoc-comment-body">' + esc(c.content) + '</div>'
    + demandCommentAttFilesHTML(c.attachments)
    + actions
    + '</div>';
}

function loadDemandComments(layer, id){
  var list = layer.querySelector("#demCommentList");
  if(!list) return;
  var unresolved = layer.querySelector("#demCommentUnresolved");
  var params = unresolved && unresolved.checked ? { unresolved: true } : {};
  Promise.all([
    API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/comments", params),
    API.get("/api/demands/" + encodeURIComponent(id) + "/comments/counts")
  ]).then(function(res){
    if(!layer.isConnected) return;
    var rows = res[0] || [];
    var counts = res[1] || {};
    var tab = layer.querySelector("#tabCommentCount");
    if(tab) tab.textContent = counts.total ? String(counts.total) : "";
    if(!rows.length){
      list.innerHTML = '<div class="reqdoc-comment-empty">' + (params.unresolved ? "没有未解决的评论" : "还没有评论") + '</div>';
      return;
    }
    registerDemandCommentAtts(layer, rows);
    list.innerHTML = rows.map(function(c){ return demandCommentThreadHTML(c); }).join("");
  }).catch(function(ex){
    if(layer.isConnected) list.innerHTML = '<div class="reqdoc-comment-empty">' + esc(ex.message || "评论加载失败") + '</div>';
  });
}

function setDemandCommentReply(layer, commentId, userName){
  demandCommentReplyTo = commentId || null;
  var chip = layer.querySelector("#demCommentReplyChip");
  var txt = layer.querySelector("#demCommentReplyText");
  var ta = layer.querySelector("#demCommentInput");
  if(chip) chip.hidden = !demandCommentReplyTo;
  if(txt) txt.textContent = userName || "";
  if(demandCommentReplyTo && ta) ta.focus();
}

/* ---------- 评论附件：先发评论，再把待传文件挂到评论上 ----------
   需求详情里有评论页签和概览讨论两个入口，共用一个待传清单结构（scope: tab / ov） */
function demandPendingFiles(layer, scope){
  return scope === "ov" ? (layer.__demOvFiles = layer.__demOvFiles || []) : (layer.__demFiles = layer.__demFiles || []);
}
/* 待发送截图先给本地缩略图：粘贴后立刻能确认是哪张，移除 / 清空 / 关闭详情时释放 objectURL */
function demPendingIsImg(f){
  return /^image\//.test((f && f.type) || "")
    || /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test((f && f.name) || "");
}
function demPendingThumb(f){
  if(!demPendingIsImg(f)) return "";
  if(!f.__thumbUrl){
    try{ f.__thumbUrl = window.URL.createObjectURL(f); }catch(e){ return ""; }
  }
  return f.__thumbUrl;
}
function demRevokeThumb(f){
  if(f && f.__thumbUrl){
    try{ window.URL.revokeObjectURL(f.__thumbUrl); }catch(e){ /* 已释放或浏览器不支持 */ }
    f.__thumbUrl = null;
  }
}
function demRevokeThumbs(list){
  (list || []).forEach(demRevokeThumb);
}
function renderDemandPendingFiles(layer, scope){
  var box = layer.querySelector(scope === "ov" ? "#demOvCommentFiles" : "#demCommentFiles");
  var tip = layer.querySelector(scope === "ov" ? "#demOvAttachTip" : "#demAttachTip");
  var list = demandPendingFiles(layer, scope);
  if(box){
    box.hidden = !list.length;
    box.innerHTML = list.map(function(f, i){
      var thumb = demPendingThumb(f);
      return '<span class="comment-attach-chip' + (thumb ? " is-img" : "") + '">'
        + (thumb ? '<img class="ca-thumb" src="' + esc(thumb) + '" alt="">' : '')
        + '<span class="ca-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>'
        + '<span class="ca-size">' + esc(fmtSize(f.size)) + '</span>'
        + '<button type="button" data-dem-pending-rm="' + i + '" data-dem-pending-scope="' + scope + '" title="移除" aria-label="移除附件">×</button>'
        + '</span>';
    }).join("");
  }
  if(tip) tip.textContent = list.length ? ("待上传 " + list.length + " 个") : "";
}
function addDemandPendingFiles(layer, scope, files){
  var list = demandPendingFiles(layer, scope);
  var res = validateFiles(files, list.length);
  reportRejected(res.rejected);
  res.ok.forEach(function(f){ list.push(f); });
  if(res.ok.length) renderDemandPendingFiles(layer, scope);
}
function clearDemandPendingFiles(layer, scope){
  var list = demandPendingFiles(layer, scope);
  demRevokeThumbs(list);
  list.length = 0;
  var input = layer.querySelector(scope === "ov" ? "#demOvCommentFile" : "#demCommentFile");
  if(input) input.value = "";
  renderDemandPendingFiles(layer, scope);
}
function uploadDemandCommentFiles(commentId, files){
  var failed = 0;
  var chain = Promise.resolve();
  files.forEach(function(f){
    chain = chain.then(function(){
      return uploadAttachment("/api/demand-comments/" + encodeURIComponent(commentId) + "/attachments", f)
        .catch(function(){ failed++; });
    });
  });
  return chain.then(function(){ return failed; });
}

function submitDemandComment(layer, id, scope){
  scope = scope || "tab";
  var ov = scope === "ov";
  var ta = layer.querySelector(ov ? "#demOvCommentInput" : "#demCommentInput");
  var content = (ta && ta.value || "").trim();
  var pending = demandPendingFiles(layer, scope).slice();
  /* 对齐工作项评论：粘贴截图后可以直接发，不必再补一句文字 */
  if(!content && !pending.length){ toast("评论内容不能为空", "warn"); if(ta) ta.focus(); return; }
  var btn = layer.querySelector(ov ? "#demOvCommentSend" : "#demCommentSend");
  if(btn && btn.disabled) return;
  if(btn) btn.disabled = true;
  /* 正文必填：只有附件时用占位文案，附件随后挂到这条评论上 */
  var body = { content: content || "上传了附件" };
  if(!ov && demandCommentReplyTo) body.parentId = demandCommentReplyTo;
  var picker = ov ? demandOverviewMention : demandCommentMention;
  var mentionIds = picker ? picker.idsInText(content) : [];
  if(mentionIds.length) body.mentionUserIds = mentionIds;
  API.post("/api/demands/" + encodeURIComponent(id) + "/comments", body).then(function(created){
    var uploads = (created && created.id && pending.length)
      ? uploadDemandCommentFiles(created.id, pending)
      : Promise.resolve(0);
    return uploads.then(function(failed){
      if(ta) ta.value = "";
      clearDemandPendingFiles(layer, scope);
      if(picker){ picker.close(); picker.clearPicked(); }
      if(!ov) setDemandCommentReply(layer, null, "");
      if(failed) toast("评论已发表，" + failed + " 个附件上传失败", "warn");
      else if(pending.length) toast("评论已发表，附件已上传", "fs");
      else toast("评论已发表", "fs");
      loadDemandComments(layer, id);
      loadDemandOverviewComments(layer, id);
    });
  }).catch(function(ex){ toast(ex.message || "评论发表失败", "bad"); })
  .then(function(){ if(btn) btn.disabled = false; });
}

/* 概览底部的「讨论」：只放最近 3 条，完整列表与操作去评论页签 */
function loadDemandOverviewComments(layer, id){
  var box = layer.querySelector("#demOverviewComments");
  if(!box) return;
  var url = "/api/demands/" + encodeURIComponent(id) + "/comments";
  API.get(url, { offset: 0, limit: 3 }).then(function(first){
    var total = (first && first.total) || 0;
    if(total <= 3) return first;
    return API.get(url, { offset: total - 3, limit: 3 });
  }).then(function(page){
    if(!layer.isConnected) return;
    var rows = (page && page.items) || [];
    var cnt = layer.querySelector("#demOverviewCommentCount");
    if(cnt) cnt.textContent = page && page.total ? ("共 " + page.total + " 条讨论") : "";
    if(!rows.length){
      box.innerHTML = '<div class="read-empty">还没有评论；有问题、结论或卡点可以直接在下面记一条。</div>';
      return;
    }
    registerDemandCommentAtts(layer, rows);
    box.innerHTML = rows.map(function(c){ return demandCommentThreadHTML(c, true); }).join("");
  }).catch(function(){
    if(layer.isConnected) box.innerHTML = '<div class="read-empty">讨论加载失败</div>';
  });
}


function resolveDemandComment(layer, id, commentId, resolved){
  API.put("/api/demands/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(commentId) + "/resolve",
    { resolved: !resolved }).then(function(){
    loadDemandComments(layer, id);
    loadDemandOverviewComments(layer, id);
    toast(resolved ? "已重新打开" : "已标记为解决", "fs");
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}

function demandCommentToTask(layer, id, commentId){
  UI.showConfirm({ title: "转为工作项", msg: "将这条评论转为待办工作项？", okText: "转为工作项" }).then(function(ok){
    if(!ok) return;
    API.post("/api/demands/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(commentId) + "/to-task")
      .then(function(task){
        loadDemandComments(layer, id);
        loadDemandOverviewComments(layer, id);
        toast("已创建工作项「" + (task.title || "") + "」", "fs");
      }).catch(function(ex){ toast(ex.message || "转工作项失败", "bad"); });
  });
}

function deleteDemandComment(layer, id, commentId){
  UI.showConfirm({ title: "删除评论", msg: "删除后不可恢复；顶层评论会连同回复一起删除。", okText: "删除评论", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/demands/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(commentId)).then(function(){
      loadDemandComments(layer, id);
      loadDemandOverviewComments(layer, id);
      toast("评论已删除", "fs");
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

function showDemandDetail(id, opts){
  var wsId = rt.currentWs && rt.currentWs.id;
  return API.get("/api/demands/" + encodeURIComponent(id)).then(function(d){
    if(wsId && (!rt.currentWs || wsId !== rt.currentWs.id)) return false;
    var cached = findDemand(id);
    if(cached) Object.assign(cached, d); else demands.push(d);
    renderDemandDetail(d, opts);
    return true;
  }).catch(function(ex){ toast(ex.message || "需求不存在或无权查看", "warn"); return false; });
}
/* 跳去文档 / 用例页时记下来源，返回后重开这条需求并停在「关联」页签 */
function setDemandReturnOrigin(d, id){
  setReturnOrigin({
    view: "demands",
    label: "需求 " + (demandNoText(d.demandNo) || d.title),
    restore: function(){ showDemandDetail(id, { tab: "rel" }); }
  });
}
function closeDemandDetailIfOpen(){
  var layer = demandDetailLayer;
  if(!layer) return;
  demandDetailLayer = null;
  UI.closeModal(layer);
}
function demandJudgementSectionHTML(d){
  if(d.status !== "done") return "";
  var html = '<div class="detail-section dem-judgement"><span class="section-title">人工交付判定</span>';
  if(d.manualDeliveryStage){
    html += '<div class="dem-judgement-current">'
      + '<span class="tag dem-stage-tag st-' + esc(d.manualDeliveryStage) + ' manual">' + esc(deliveryStageName(d.manualDeliveryStage)) + '</span>'
      + '<span class="dem-evidence-meta">生效 ' + esc(d.manualDeliveryEffectiveOn || "—")
      + ' · ' + esc(d.manualDeliveryJudgedBy || "—") + ' · ' + esc(fmtTs(d.manualDeliveryJudgedAt) || "—") + '</span>'
      + (d.manualDeliveryReason ? '<p class="dem-evidence-meta">原因：' + esc(d.manualDeliveryReason) + '</p>' : '')
      + (d.deliveryStageSource === "release" ? '<p class="foot-note">已有真实生产发布，交付阶段以真实发布为准。</p>' : '')
      + '</div>';
  }
  if(d.canJudgeDelivery){
    html += '<div class="row row-gap">'
      + '<button class="btn sm soft" type="button" data-dem-judge>'
      + (d.manualDeliveryStage ? icon("edit", 13) + ' 修改判定' : icon("plus", 13) + ' 人工判定') + '</button>'
      + (d.manualDeliveryStage
        ? '<button class="btn sm" type="button" data-dem-judge-revoke>' + icon("undo", 13) + ' 撤销判定</button>'
        : '')
      + '</div>';
  }
  html += '<ul class="dem-logs" id="demJudgementLogs"><li class="foot-note">加载中…</li></ul></div>';
  return html;
}
function loadDemandJudgements(layer, id){
  var ul = layer.querySelector("#demJudgementLogs");
  if(!ul) return;
  API.get("/api/demands/" + encodeURIComponent(id) + "/delivery-judgements", { offset:0, limit:100 }).then(function(res){
    var list = (res && res.items) || [];
    if(!ul.isConnected) return;
    ul.innerHTML = list.length ? list.map(function(j){
      var revoked = !!j.revokedAt;
      return '<li' + (revoked ? ' class="is-revoked"' : '') + '>'
        + '<span class="dem-log-ts">' + esc(j.effectiveOn || "—") + '</span>'
        + '<b>' + esc(deliveryStageName(j.judgedStage)) + '</b>'
        + '<span>' + esc(j.judgedByName || "—") + '</span>'
        + '<span class="dem-log-ts">' + esc(fmtTs(j.judgedAt) || "—") + '</span>'
        + (j.judgeReason ? '<span class="dem-log-note">' + esc(j.judgeReason) + '</span>' : '')
        + (revoked
          ? '<span class="tag ghost">已撤销</span><span class="dem-log-note">'
            + esc(fmtTs(j.revokedAt) || "") + ' · ' + esc(j.revokedByName || "—")
            + (j.revokeReason ? ' · ' + esc(j.revokeReason) : "") + '</span>'
          : '<span class="tag tag-success">当前生效</span>')
        + '</li>';
    }).join("") : '<li class="foot-note">暂无人工判定记录</li>';
  }).catch(function(){
    if(ul.isConnected) ul.innerHTML = '<li class="foot-note">人工判定记录加载失败</li>';
  });
}
function openJudgementDialog(id){
  var d = findDemand(id);
  if(!d) return;
  if(!d.canJudgeDelivery){ toast("仅空间主、管理员或项目负责人可以维护人工判定", "warn"); return; }
  var stage = d.manualDeliveryStage || (d.deliveryStage === "delivered" ? "delivered" : "donePending");
  var effectiveOn = d.manualDeliveryEffectiveOn || iso(new Date());
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet xs"><div class="sheet-body"><div class="panel"><div class="panel-head"><h3>'
    + (d.manualDeliveryStage ? "修改人工交付判定" : "人工交付判定") + '</h3>'
    + '<button class="icon-btn sm" type="button" data-dem-judge-x aria-label="关闭">' + icon("close", 14) + '</button></div>'
    + '<div class="stack"><p class="foot-note">人工判定只用于补录缺失证据；真实生产发布记录始终优先。判定绑定当前目标版本，换版本后旧判定不再生效。</p>'
    + '<label class="field"><span>判定阶段</span><select class="input" id="demJudgeStage">'
    + '<option value="donePending"' + (stage === "donePending" ? " selected" : "") + '>已完成 · 待发布</option>'
    + '<option value="delivered"' + (stage === "delivered" ? " selected" : "") + '>已交付</option></select></label>'
    + '<label class="field"><span>生效日期</span><input class="input" type="date" id="demJudgeDate" value="' + esc(effectiveOn) + '" max="' + esc(iso(new Date())) + '"></label>'
    + '<label class="field"><span>判定原因（必填）</span><textarea class="input" id="demJudgeNote" rows="4" maxlength="500">' + esc(d.manualDeliveryReason || "") + '</textarea></label>'
    + '<div class="row row-gap"><button class="btn primary" type="button" data-dem-judge-ok>保存判定</button>'
    + '<button class="btn" type="button" data-dem-judge-x>取消</button></div>'
    + '</div></div></div></div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-judge-x]")){ UI.closeModal(layer); return; }
    var ok = e.target.closest("[data-dem-judge-ok]");
    if(!ok) return;
    var note = layer.querySelector("#demJudgeNote").value.trim();
    var date = layer.querySelector("#demJudgeDate").value;
    if(!date){ toast("请选择判定生效日期", "warn"); layer.querySelector("#demJudgeDate").focus(); return; }
    if(!note){ toast("请填写判定原因", "warn"); layer.querySelector("#demJudgeNote").focus(); return; }
    ok.disabled = true;
    API.post("/api/demands/" + encodeURIComponent(id) + "/delivery-judgement", {
      stage:layer.querySelector("#demJudgeStage").value,
      effectiveOn:date, note:note, revision:d.revision
    }).then(function(){
      UI.closeModal(layer);
      closeDemandDetailIfOpen();
      toast("人工判定已保存，真实发布证据仍然优先", "fs");
      drawerDemandOpts.reqId = null;
      loadDemands();
    }).catch(function(ex){
      ok.disabled = false;
      toast(ex.message || "保存判定失败", "bad");
      if(ex.code === 409){ UI.closeModal(layer); closeDemandDetailIfOpen(); loadDemands(); }
    });
  });
  UI.openModal(layer, "select");
}
function revokeJudgement(id){
  var d = findDemand(id);
  if(!d) return;
  if(!d.canJudgeDelivery){ toast("仅空间主、管理员或项目负责人可以维护人工判定", "warn"); return; }
  UI.showPrompt({ title:"撤销人工判定", desc:"撤销后恢复自动派生结果，历史记录保留。", label:"撤销原因（必填）",
    required:true, maxLength:500, okText:"撤销判定" }).then(function(note){
    if(note === null) return;
    if(!note.trim()){ toast("请填写撤销原因", "warn"); return; }
    API.post("/api/demands/" + encodeURIComponent(id) + "/delivery-judgement/revoke", {
      note:note.trim(), revision:d.revision
    }).then(function(){
      closeDemandDetailIfOpen();
      toast("人工判定已撤销，恢复自动派生结果", "fs");
      drawerDemandOpts.reqId = null;
      loadDemands();
    }).catch(function(ex){
      toast(ex.message || "撤销失败", "bad");
      if(ex.code === 409){ closeDemandDetailIfOpen(); loadDemands(); }
    });
  });
}
/* 流转记录存的是后端事件码，直接展示会露出 pass/rej 这类英文，统一翻成人话 */
var DEM_LOG_ACTIONS = {
  create:"新建需求", update:"编辑需求", priority:"调整优先级", expect:"调整期望交付",
  version:"调整目标版本", move:"变更所属项目", claim:"认领评审", pass:"评审通过", rej:"评审不通过",
  plan:"排期", replan:"调期", unpass:"撤回评审", unplan:"撤销排期",
  cancel:"取消需求", restore:"恢复需求", reopen:"重新打开",
  complete:"自动完成", auto_reopen:"自动退回已排期",
  judge_delivery:"人工判定交付阶段", revoke_delivery_judgement:"撤销人工判定"
};
function demandLogItemHTML(l){
  /* 单字段动作（优先级/期望交付/目标版本）的 note 与结构化差异是同一句话：逐条去重，避免重复显示 */
  var note = l.note || "";
  var change = demandLogChange(l).split("；").filter(function(part){
    return part && note.indexOf(part) === -1;
  }).join("；");
  var notes = (note ? '<span class="dem-log-note">' + esc(note) + '</span>' : '')
    + (change ? '<span class="dem-log-note">' + esc(change) + '</span>' : '');
  return '<li><span class="dem-log-ts">' + esc(fmtTs(l.createdAt) || "—") + '</span>'
    + '<span class="dem-log-main"><b>' + esc(DEM_LOG_ACTIONS[l.action] || l.action || "") + '</b>'
    + (l.operatorName || l.operator ? '<span class="dem-log-op">' + esc(l.operatorName || l.operator) + '</span>' : '')
    + notes + '</span></li>';
}
/* ---------- 需求详情：与工作项共用「右侧抽屉 + 四页签 + 单一状态入口」 ---------- */
function demandStatusDot(status){
  if(status === "review") return "var(--info)";
  if(status === "pass") return "var(--success)";
  if(status === "plan") return "var(--primary)";
  if(status === "done") return "var(--plum)";
  if(status === "closed" || status === "rej" || status === "canceled" || status === "cancelled") return "var(--danger)";
  return "var(--text-3)";
}
function demandStatusLabel(d){
  /* 胶囊只表示评审/排期状态；交付阶段在「交付」页签按事实展示 */
  return statusName(d.status);
}
function demandFootActs(d){
  var acts = "";
  if(canClaimDemandReview(d)){
    acts += '<button class="btn sm" type="button" data-dem-claim="' + esc(d.id) + '" title="认领后由你评审，不会自动通过">认领评审</button>';
  }
  if(canReviewDemand(d) && d.status === "review"){
    /* 卡内主操作降为浅蓝底：实心蓝只留给页头 CTA，避免满屏蓝块 */
    acts += '<button class="btn sm" type="button" data-dem-rej="' + esc(d.id) + '">不通过</button>'
      + '<button class="btn sm soft" type="button" data-dem-pass="' + esc(d.id) + '">通过</button>';
  }else if(canScheduleDemand(d) && d.status === "pass"){
    acts += '<button class="btn sm soft" type="button" data-dem-plan="' + esc(d.id) + '">排期进入版本</button>';
  }else if(canReviewDemand(d) && isClosedDemand(d) && (d.closeReason === "rej" || d.status === "rej")){
    acts += '<button class="btn sm" type="button" data-dem-reopen="' + esc(d.id) + '">重新打开</button>';
  }else if(canScheduleDemand(d) && isClosedDemand(d) && d.closeReason !== "rej" && d.status !== "rej"){
    acts += '<button class="btn sm" type="button" data-dem-restore="' + esc(d.id) + '">恢复至' + esc(restoreTargetName(d)) + '</button>';
  }
  return acts;
}
function demandStatusMenuItems(d){
  var out = [];
  if(canReviewDemand(d)){
    if(d.status === "review"){
      out.push({ act: "pass", label: "通过，可排期" });
      out.push({ act: "rej", label: "评审不通过…", danger: true });
    }
    if(d.status === "pass") out.push({ act: "unpass", label: "撤回评审" });
    if(isClosedDemand(d) && (d.closeReason === "rej" || d.status === "rej")){
      out.push({ act: "reopen", label: "重新打开（回到待评审）" });
    }
  }
  if(canScheduleDemand(d)){
    if(d.status === "pass") out.push({ act: "plan", label: "排期进入版本…" });
    if(d.status === "plan"){
      out.push({ act: "replan", label: "调整排期…" });
      out.push({ act: "unplan", label: "撤销排期…" });
    }
    if(isClosedDemand(d) && d.closeReason !== "rej" && d.status !== "rej"){
      out.push({ act: "restore", label: "恢复至" + restoreTargetName(d) });
    }
    if(!isClosedDemand(d) && d.status !== "done") out.push({ act: "cancel", label: "关闭需求…", danger: true });
  }
  return out;
}
function runDemandStatusAction(d, act){
  if(!d || !act) return;
  if(act === "pass") return passDemand(d.id);
  if(act === "rej") return rejectDemand(d.id);
  if(act === "plan") return openPlanDialog(d.id);
  if(act === "unpass") return unpassDemand(d.id);
  if(act === "unplan") return unplanDemand(d.id);
  if(act === "replan") return openPlanDialog(d.id, true);
  if(act === "cancel") return cancelDemand(d.id);
  if(act === "reopen") return reopenDemand(d.id);
  if(act === "restore") return restoreDemand(d.id);
}
function openDemandStatusMenu(anchor, d){
  var items = demandStatusMenuItems(d);
  if(!items.length){ toast("当前状态没有可执行的动作", "warn"); return; }
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "198px";
  menu.innerHTML = '<div class="menu-title">需求状态</div>' + items.map(function(it){
    return '<button class="menu-item' + (it.danger ? " danger" : "") + '" type="button" data-dem-status-act="' + it.act + '">'
      + esc(it.label) + '</button>';
  }).join("");
  UI.openPop(menu, anchor, { onClose: function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-status-act]");
    if(!b) return;
    UI.closeAllPops();
    runDemandStatusAction(d, b.dataset.demStatusAct);
  });
}
function openDemandDetailMore(anchor, d){
  var items = demandMenuItems(d, { detail:true }).filter(function(it){
    return it.act === "edit" || it.act === "del" || it.act === "claim";
  });
  if(!items.length) return;
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "140px";
  menu.innerHTML = items.map(function(it){
    return '<button class="menu-item' + (it.danger ? " danger" : "") + '" type="button" data-dem-detail-more="' + it.act + '">' + esc(it.label) + '</button>';
  }).join("");
  UI.openPop(menu, anchor, { onClose: function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-detail-more]");
    if(!b) return;
    UI.closeAllPops();
    if(b.dataset.demDetailMore === "edit"){
      /* 完整字段仍在编辑面板；先关详情，避免两层叠加 */
      closeDemandDetailIfOpen();
      setTimeout(function(){ openDemandDialog(d); }, 40);
    }else if(b.dataset.demDetailMore === "del"){
      deleteDemand(d.id);
    }else if(b.dataset.demDetailMore === "claim"){
      claimDemandReview(d.id);
    }
  });
}
function demandDetailPlain(text){
  var value = text == null ? "" : String(text);
  return value ? esc(value) : '<span class="muted">未填写</span>';
}
/* ---------- 需求描述内嵌图片 ----------
   描述仍按纯文本存库，图片以 ![文件名](att:附件ID) 片段夹在文字里，可追加 |宽度：
   库里没有 HTML，导出/搜索/纯文本消费者拿到的仍是文字；展示时替换成图片，摘要时剥掉片段。
   新建表单尚未上传的图片先用 pending:临时键 占位，保存时上传成功后替换成 att 键。 */
var DEM_DESC_IMG_RE = /!\[([^\]\n]{0,80})\]\(att:([A-Za-z0-9_-]+)(?:\|(\d{1,4}))?\)/g;
var DEM_DESC_PENDING_RE = /!\[([^\]\n]{0,80})\]\(pending:([A-Za-z0-9_-]+)(?:\|(\d{1,4}))?\)/g;
var DEM_DESC_MAX = 2000;
var DEM_INLINE_MIN_W = 80;
var DEM_INLINE_MAX_W = 1600;

function demandInlineWidth(width){
  var n = parseInt(width, 10);
  if(!n || n < DEM_INLINE_MIN_W) return 0;
  return Math.min(DEM_INLINE_MAX_W, n);
}
function demandDescText(text){
  return String(text == null ? "" : text)
    .replace(DEM_DESC_IMG_RE, "")
    .replace(DEM_DESC_PENDING_RE, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}
function demandDescImgToken(att, width){
  var name = String((att && att.filename) || "图片").replace(/[\[\]\r\n]/g, "").slice(0, 80);
  var w = demandInlineWidth(width);
  return "![" + (name || "图片") + "](att:" + att.id + (w ? "|" + w : "") + ")";
}
function demandDescPendingToken(name, key, width){
  var clean = String(name || "图片").replace(/[\[\]\r\n]/g, "").slice(0, 80) || "图片";
  var w = demandInlineWidth(width);
  return "![" + clean + "](pending:" + key + (w ? "|" + w : "") + ")";
}
function demandInlineImgHTML(id, name, width){
  var w = demandInlineWidth(width);
  return '<img class="dem-inline-img" data-dem-inline-img="' + esc(id) + '"'
    + (w ? ' data-dem-inline-w="' + w + '" style="width:' + w + 'px"' : "")
    + ' data-dem-inline-name="' + esc(name || "图片") + '"'
    + ' src="' + attUrl(id) + '" alt="' + esc(name || "图片") + '" title="点击查看大图">';
}
/* 描述渲染：blank=false 时空内容返回空串（编辑器用），否则给只读态「未填写」占位 */
function demandDetailHTML(text, blank){
  var value = text == null ? "" : String(text);
  if(!value) return blank === false ? "" : '<span class="muted">未填写</span>';
  var out = "", last = 0, m;
  DEM_DESC_IMG_RE.lastIndex = 0;
  while((m = DEM_DESC_IMG_RE.exec(value))){
    out += esc(value.slice(last, m.index));
    out += demandInlineImgHTML(m[2], m[1], m[3]);
    last = m.index + m[0].length;
  }
  out += esc(value.slice(last));
  return out;
}
/* contenteditable 回写：文字节点原样保留，<br>/块级换行还原成 \n，内嵌图片还原成标记片段 */
function demandSerializeRichText(el){
  var out = "";
  function walk(node){
    if(node.nodeType === 3){
      out += node.nodeValue.replace(/\u00a0/g, " ");
      return;
    }
    if(node.nodeType !== 1) return;
    /* 缩放/移除控件是编辑辅助，不能写进描述 */
    if(node.hasAttribute && node.hasAttribute("data-dem-ui")) return;
    var tag = node.tagName.toLowerCase();
    /* 只读态的「未填写」是占位，不是正文：图片晚到、DOM 已退回读态时不能把它写进描述 */
    if(node.classList && node.classList.contains("muted")) return;
    if(tag === "br"){
      out += "\n";
      return;
    }
    if(tag === "img"){
      var imgId = node.getAttribute("data-dem-inline-img");
      var pend = node.getAttribute("data-dem-inline-pending");
      var w = node.getAttribute("data-dem-inline-w");
      var nm = node.getAttribute("data-dem-inline-name") || node.getAttribute("alt");
      if(imgId) out += demandDescImgToken({ id: imgId, filename: nm }, w);
      else if(pend) out += demandDescPendingToken(nm, pend, w);
      return;
    }
    var block = tag === "div" || tag === "p";
    if(block && out && !/\n$/.test(out)) out += "\n";
    for(var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    if(block && out && !/\n$/.test(out)) out += "\n";
  }
  for(var i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]);
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
}
/* ---------- 描述图片缩放（编辑态） ----------
   选中图片后出现右下角手柄：拖动按宽度等比缩放（高度自动），左右方向键微调；
   宽度写进描述标记，只读态按保存的宽度渲染。新建表单里待上传的图片走同一套交互。 */
var demandDescPending = [], demandDescPendingSeq = 0;

function demandBuildInlineFigure(img){
  var fig = document.createElement("span");
  fig.className = "dem-inline-fig";
  fig.setAttribute("data-dem-fig", "");
  if(img.parentNode) img.parentNode.insertBefore(fig, img);
  fig.appendChild(img);
  var size = document.createElement("span");
  size.className = "dem-inline-size";
  size.setAttribute("data-dem-ui", "");
  var del = document.createElement("button");
  del.type = "button";
  del.className = "dem-inline-del";
  del.setAttribute("data-dem-ui", "");
  del.setAttribute("data-dem-img-del", "");
  del.setAttribute("aria-label", "移除图片");
  del.title = "移除图片";
  del.textContent = "×";
  var handle = document.createElement("button");
  handle.type = "button";
  handle.className = "dem-inline-resize";
  handle.setAttribute("data-dem-ui", "");
  handle.setAttribute("data-dem-img-resize", "");
  handle.setAttribute("aria-label", "调整图片大小，左右方向键微调");
  handle.title = "拖动调整大小；左右方向键微调";
  handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14h8V6"/><path d="M10 10l4 4"/></svg>';
  fig.appendChild(size);
  fig.appendChild(del);
  fig.appendChild(handle);
  demandSyncInlineFigureSize(img);
  return fig;
}
function demandEnsureInlineFigure(img){
  var fig = img.closest ? img.closest("[data-dem-fig]") : null;
  return fig || demandBuildInlineFigure(img);
}
function demandWrapInlineImages(host){
  if(!host) return;
  host.querySelectorAll("img.dem-inline-img").forEach(demandEnsureInlineFigure);
}
function demandSyncInlineFigureSize(img){
  var fig = img.closest ? img.closest("[data-dem-fig]") : null;
  var size = fig && fig.querySelector(".dem-inline-size");
  if(!size) return;
  var w = demandInlineWidth(img.getAttribute("data-dem-inline-w"));
  size.textContent = w ? w + "px" : "原始";
}
function demandSetInlineImgWidth(img, width){
  var w = demandInlineWidth(width);
  if(w){
    img.setAttribute("data-dem-inline-w", String(w));
    img.style.width = w + "px";
  }else{
    img.removeAttribute("data-dem-inline-w");
    img.style.removeProperty("width");
  }
  img.style.height = "auto";
  demandSyncInlineFigureSize(img);
}
function demandSelectInlineFigure(host, fig){
  host.querySelectorAll("[data-dem-fig].is-selected").forEach(function(f){
    if(f !== fig) f.classList.remove("is-selected");
  });
  if(fig) fig.classList.add("is-selected");
}
function demandRemoveInlineFigure(host, fig){
  var img = fig && fig.querySelector("img");
  var key = img && img.getAttribute("data-dem-inline-pending");
  if(key){
    for(var i = 0; i < demandDescPending.length; i++){
      if(demandDescPending[i].key === key){
        try{ URL.revokeObjectURL(demandDescPending[i].url); }catch(e){ /* noop */ }
        demandDescPending.splice(i, 1);
        break;
      }
    }
  }
  if(fig) fig.remove();
  if(host){ try{ host.focus(); }catch(e){ /* noop */ } }
}
function demandBindInlineImageResize(host){
  if(!host || host.__demImgUi) return;
  host.__demImgUi = true;
  host.addEventListener("click", function(e){
    var fig = e.target.closest ? e.target.closest("[data-dem-fig]") : null;
    if(e.target.closest && e.target.closest("[data-dem-img-del]")){
      e.preventDefault(); e.stopPropagation();
      demandRemoveInlineFigure(host, fig);
      return;
    }
    if(e.target.closest && e.target.closest("[data-dem-img-resize]")) return;
    if(fig){
      /* 图片块不是文本节点：点选只用于缩放，不抢光标 */
      e.preventDefault();
      demandSelectInlineFigure(host, fig);
      return;
    }
    demandSelectInlineFigure(host, null);
  });
  host.addEventListener("pointerdown", function(e){
    var handle = e.target.closest ? e.target.closest("[data-dem-img-resize]") : null;
    if(!handle) return;
    e.preventDefault();
    e.stopPropagation();
    var fig = handle.closest("[data-dem-fig]");
    var img = fig && fig.querySelector("img");
    if(!img) return;
    demandSelectInlineFigure(host, fig);
    var startX = e.clientX, startW = img.getBoundingClientRect().width;
    var maxW = Math.max(DEM_INLINE_MIN_W, (host.clientWidth || 640) - 10);
    function move(ev){
      demandSetInlineImgWidth(img, Math.max(DEM_INLINE_MIN_W, Math.min(maxW, startW + ev.clientX - startX)));
    }
    function up(){
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      try{ host.focus(); }catch(err){ /* noop */ }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  host.addEventListener("keydown", function(e){
    var handle = e.target.closest ? e.target.closest("[data-dem-img-resize]") : null;
    if(!handle || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    var img = handle.closest("[data-dem-fig]").querySelector("img");
    if(!img) return;
    var cur = Math.round(img.getBoundingClientRect().width) || demandInlineWidth(img.getAttribute("data-dem-inline-w")) || 320;
    var maxW = Math.max(DEM_INLINE_MIN_W, (host.clientWidth || 640) - 10);
    demandSetInlineImgWidth(img, Math.max(DEM_INLINE_MIN_W, Math.min(maxW, cur + (e.key === "ArrowRight" ? 16 : -16))));
  });
}
/* 上传前把 DOM 里的 pending 临时键对齐到待上传队列：删除过的图片不再上传 */
function demandCommitPendingImages(){
  var alive = {};
  dDesc.querySelectorAll("[data-dem-inline-pending]").forEach(function(img){
    alive[img.getAttribute("data-dem-inline-pending")] = 1;
  });
  demandDescPending = demandDescPending.filter(function(it){
    if(alive[it.key]) return true;
    try{ URL.revokeObjectURL(it.url); }catch(e){ /* noop */ }
    return false;
  });
  return demandDescPending.slice();
}
function demandClearPendingImages(){
  demandDescPending.forEach(function(it){
    try{ URL.revokeObjectURL(it.url); }catch(e){ /* noop */ }
  });
  demandDescPending = [];
}
/* 新建/编辑表单：还没有需求 ID，先以 objectURL 占位插进编辑器，提交时再统一上传 */
function demandUpdateDescCount(){
  var el = $("dDescCount");
  if(!el || !dDesc) return 0;
  var n = demandDescText(demandSerializeRichText(dDesc)).length;
  el.textContent = n + "/" + DEM_DESC_MAX;
  el.classList.toggle("is-over", n > DEM_DESC_MAX);
  return n;
}
function demandInsertFormFigures(files){
  if(!dDesc) return;
  var imgs = (files || []).filter(function(f){
    return /^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp)$/i.test(f.name || "");
  });
  if(imgs.length < (files || []).length){
    toast("描述只支持图片；其它文件请放到下方「附件」", "warn");
  }
  if(!imgs.length) return;
  var res = validateFiles(imgs, demandDescPending.length);
  reportRejected(res.rejected);
  if(!res.ok.length) return;
  /* 粘贴/拖入时保留光标位置；点按钮时选区不在编辑器里，统一追加到末尾 */
  var sel = window.getSelection();
  var range = null;
  if(sel && sel.rangeCount){
    var r = sel.getRangeAt(0);
    if(dDesc.contains(r.startContainer) && dDesc.contains(r.endContainer)) range = r;
  }
  res.ok.forEach(function(f){
    var key = "p" + (++demandDescPendingSeq);
    var url = "";
    try{ url = URL.createObjectURL(f); }catch(e){ /* 无预览图也不影响上传 */ }
    demandDescPending.push({ key:key, file:f, url:url });
    var img = document.createElement("img");
    img.className = "dem-inline-img";
    img.setAttribute("data-dem-inline-pending", key);
    img.setAttribute("data-dem-inline-name", f.name || "图片");
    if(url) img.setAttribute("src", url);
    img.setAttribute("alt", f.name || "图片");
    img.title = "提交后上传；拖动右下角可缩放";
    var fig = demandEnsureInlineFigure(img);
    if(range){
      range.deleteContents();
      range.insertNode(fig);
      range.setStartAfter(fig);
      range.collapse(true);
    }else{
      dDesc.appendChild(fig);
    }
  });
  if(range){
    sel.removeAllRanges();
    sel.addRange(range);
  }else{
    demandFocusEnd(dDesc);
  }
  demandUpdateDescCount();
}
/* 把描述里的 pending:临时键 换成上传后的 att:附件ID，宽度原样保留 */
function demandReplacePendingTokens(text, mapping){
  return String(text || "").replace(DEM_DESC_PENDING_RE, function(all, name, key, width){
    var att = mapping[key];
    return att ? demandDescImgToken(att, width) : "";
  });
}
function demandUploadPendingImages(demandId, pending){
  var mapping = {}, failed = 0;
  var chain = Promise.resolve();
  pending.forEach(function(it){
    chain = chain.then(function(){
      return uploadAttachment("/api/demands/" + encodeURIComponent(demandId) + "/attachments", it.file)
        .then(function(att){ if(att && att.id) mapping[it.key] = att; else failed++; },
              function(){ failed++; });
    });
  });
  return chain.then(function(){
    demandClearPendingImages();
    return { mapping: mapping, failed: failed };
  });
}
function demandReportImageUpload(okCount, failed){
  if(failed) toast("图片上传：" + okCount + " 张成功，" + failed + " 张失败", "warn");
}
/* ---------- 需求详情就地编辑 ----------
   文案（标题/描述/验收）点开即改，失焦或 ⌘/Ctrl+Enter 保存、Esc 还原；
   属性（优先级/期望交付/目标版本/分类/来源）点开弹层选择后直接保存；
   类型与评审人只在待评审点开弹层，进入流转后由状态动作决定。
   保存后只刷新当前详情，不再关闭重开；同一详情内的写操作串行，避免 revision 互相覆盖。 */
function demandSaveQueued(layer, work){
  var prev = layer.__demSaveQueue || Promise.resolve();
  var next = prev.then(work, work);
  layer.__demSaveQueue = next.then(function(){}, function(){});
  return next;
}
function demandApplyServer(d, res){
  if(!res) return;
  Object.assign(d, res);
  var cached = findDemand(d.id);
  if(cached && cached !== d) Object.assign(cached, res);
}
function demandSaveBody(d){
  return {
    reqId: d.reqId,
    title: d.title || "",
    description: d.description || null,
    acceptText: d.acceptText || null,
    source: d.source || null,
    itemKind: d.itemKind || "其他",
    categoryId: d.categoryId || null,
    priority: d.priority || "P2",
    expectDate: d.expectDate || null,
    plannedStart: d.plannedStart || null,
    plannedEnd: d.plannedEnd || null,
    /* 整单 PUT 在待评审会整组覆盖字段：带回当前评审人，避免改分类/来源时把人清掉 */
    reviewerUserId: d.reviewerUserId || null,
    revision: d.revision,
    wsjfBusiness: d.wsjfBusiness == null ? null : d.wsjfBusiness,
    wsjfUrgency: d.wsjfUrgency == null ? null : d.wsjfUrgency,
    wsjfRisk: d.wsjfRisk == null ? null : d.wsjfRisk,
    wsjfEffort: d.wsjfEffort == null ? null : d.wsjfEffort
  };
}
function demandReloadInPlace(ctx){
  return API.get("/api/demands/" + encodeURIComponent(ctx.d.id)).then(function(res){
    demandApplyServer(ctx.d, res);
    ctx.sync();
  }).catch(function(){});
}
function demandSaveFailed(ex, ctx){
  if(ex && ex.code === 409){
    toast("需求已被其他人修改，已刷新为最新内容", "warn");
    demandReloadInPlace(ctx);
    loadDemands({ silent:true });
    return;
  }
  toast((ex && ex.message) || "保存失败", "bad");
}
function demandQuickSave(ctx, action, payload, okMsg){
  return demandSaveQueued(ctx.layer, function(){
    payload.revision = ctx.d.revision;
    return API.post("/api/demands/" + encodeURIComponent(ctx.d.id) + "/" + action, payload).then(function(res){
      demandApplyServer(ctx.d, res);
      ctx.sync();
      toast(okMsg, "fs");
      loadDemands({ silent:true });
      return res;
    }, function(ex){
      demandSaveFailed(ex, ctx);
      throw ex;
    });
  }).catch(function(){});
}
function demandPutField(ctx, patch, okMsg){
  return demandSaveQueued(ctx.layer, function(){
    var body = demandSaveBody(ctx.d);
    Object.keys(patch).forEach(function(k){ body[k] = patch[k]; });
    return API.put("/api/demands/" + encodeURIComponent(ctx.d.id), body).then(function(res){
      demandApplyServer(ctx.d, res);
      ctx.sync();
      toast(okMsg, "fs");
      loadDemands({ silent:true });
      return res;
    }, function(ex){
      demandSaveFailed(ex, ctx);
      throw ex;
    });
  }).catch(function(){});
}
function demandFieldValue(d, field){
  if(field === "title") return d.title || "";
  if(field === "desc") return d.description || "";
  if(field === "source") return d.source || "";
  return d.acceptText || "";
}
function demandRenderField(el, ctx, field){
  if(field === "title") el.textContent = ctx.d.title || "";
  else if(field === "source"){
    el.textContent = ctx.d.source || "未填写";
    el.title = ctx.d.source || "";
  }
  else if(field === "desc") el.innerHTML = demandDetailHTML(ctx.d.description);
  else el.innerHTML = demandDetailPlain(ctx.d.acceptText);
}
function demandFocusEnd(el){
  try{
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){ try{ el.focus(); }catch(err){ /* noop */ } }
}
function demandStartTextEdit(el, ctx, field){
  if(!el || el.isContentEditable) return;
  if(!canWriteDemand(ctx.d)){ denyDemandReadOnly(); return; }
  if(isClosedDemand(ctx.d)){ toast("已关闭的需求不能直接编辑", "warn"); return; }
  if(field === "title" && ctx.d.status !== "review") return;
  /* 描述带内嵌图片：编辑态直接把图片还原成 <img>，失焦后再序列化回标记片段 */
  if(field === "desc"){
    var descVal = demandFieldValue(ctx.d, "desc");
    if(descVal) el.innerHTML = demandDetailHTML(descVal);
    else el.textContent = "";
    demandWrapInlineImages(el);
    demandBindInlineImageResize(el);
  }else{
    el.textContent = demandFieldValue(ctx.d, field);
  }
  el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", field === "title" || field === "source" ? "false" : "true");
  el.classList.add("inline-edit-field");
  /* 窄屏概览是两列网格：编辑时让这一行独占整行，输入框才不会被压成窄条 */
  var metaRow = el.closest ? el.closest(".rf-meta") : null;
  if(metaRow) metaRow.classList.add("is-editing");
  try{ el.focus(); }catch(e){ /* noop */ }
  demandFocusEnd(el);
}
function demandCancelTextEdit(el, ctx, field){
  if(!el || !el.isContentEditable) return;
  el.removeAttribute("contenteditable");
  el.removeAttribute("aria-multiline");
  /* 来源的值本身不可聚焦，键盘入口是外层 data-dem-fact 行 */
  if(field === "source") el.removeAttribute("role");
  else el.setAttribute("role", "button");
  el.classList.remove("inline-edit-field");
  var metaRow = el.closest ? el.closest(".rf-meta") : null;
  if(metaRow) metaRow.classList.remove("is-editing");
  demandRenderField(el, ctx, field);
}
function demandFinishTextEdit(el, ctx, field, save){
  if(!el || !el.isContentEditable) return;
  /* 描述是富文本（文字 + 内嵌图片标记）：从 DOM 还原成库里的纯文本格式 */
  var val = field === "desc" ? demandSerializeRichText(el)
    : String(el.innerText || "").replace(/\u00a0/g, " ");
  if(field === "title" || field === "source") val = val.replace(/[\r\n]+/g, " ").replace(/^\s+|\s+$/g, "");
  else if(field !== "desc") val = val.replace(/^\s+|\s+$/g, "");
  if(save && field === "title" && !val){
    toast("需求标题不能为空", "warn");
    try{ el.focus(); }catch(e){ /* noop */ }
    return;
  }
  var over = field === "source" && val.length > DEMAND_SOURCE_MAX;
  if(over) val = val.slice(0, DEMAND_SOURCE_MAX);
  el.removeAttribute("contenteditable");
  if(field === "source") el.removeAttribute("role");
  else el.setAttribute("role", "button");
  el.removeAttribute("aria-multiline");
  el.classList.remove("inline-edit-field");
  var metaRow = el.closest ? el.closest(".rf-meta") : null;
  if(metaRow) metaRow.classList.remove("is-editing");
  if(!save || val === demandFieldValue(ctx.d, field)){
    demandRenderField(el, ctx, field);
    return;
  }
  if(over) toast("来源最多 " + DEMAND_SOURCE_MAX + " 字，已截断保存", "warn");
  var patch = {};
  if(field === "title") patch.title = val || null;
  else if(field === "desc") patch.description = val || null;
  else if(field === "source") patch.source = val || null;
  else patch.acceptText = val || null;
  var okMsg = field === "title" ? "标题已保存"
    : field === "desc" ? "需求描述已保存"
      : field === "source" ? (val ? "来源已更新" : "已清空来源")
        : "验收标准已保存";
  demandPutField(ctx, patch, okMsg);
}
function openDemandPriorityFact(anchor, ctx){
  var cur = ctx.d.priority || "P2";
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "168px";
  menu.innerHTML = '<div class="menu-title">优先级</div>' + PRIORITIES.map(function(p){
    return '<button class="menu-item" type="button" data-dem-fact-pri="' + p + '">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(priColor(p)) + '"></span>'
      + p + ' · ' + esc(priName(p)) + (p === cur ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  UI.openPop(menu, anchor, { align:"left", width:190, onClose:function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-fact-pri]");
    if(!b) return;
    UI.closeAllPops();
    var p = b.dataset.demFactPri;
    if(p === cur) return;
    demandQuickSave(ctx, "priority", { priority:p }, "优先级已调整为 " + p);
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
}
function openDemandExpectFact(anchor, ctx){
  var cur = ctx.d.expectDate ? String(ctx.d.expectDate).substring(0, 10) : "";
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML = '<div class="menu-title">期望交付</div>'
    + '<div class="menu-field"><input class="input" type="date" id="demFactExpect" value="' + esc(cur) + '" aria-label="期望交付日期"></div>'
    + '<div class="menu-foot"><button class="btn sm" type="button" data-dem-exp-clear>清除</button>'
    + '<button class="btn sm primary" type="button" data-dem-exp-save>保存</button></div>';
  UI.openPop(menu, anchor, { align:"left", width:250, onClose:function(){ menu.remove(); } });
  var input = menu.querySelector("#demFactExpect");
  function commit(clear){
    var next = clear ? "" : (input ? input.value : "");
    UI.closeAllPops();
    if((next || "") === cur) return;
    demandQuickSave(ctx, "expect-date", { expectDate:next || null },
      next ? ("期望交付已设为 " + next) : "已清空期望交付");
  }
  menu.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-exp-clear]")) commit(true);
    else if(e.target.closest("[data-dem-exp-save]")) commit(false);
  });
  if(input){
    input.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); commit(false); }
    });
    setTimeout(function(){ try{ input.focus(); }catch(e){ /* noop */ } }, 30);
  }
}
function openDemandModuleFact(anchor, ctx){
  var cur = ctx.d.categoryId || "";
  var cats = (rt.categoriesCache || []).filter(function(c){ return c.projectId === ctx.d.reqId; });
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "200px";
  menu.innerHTML = '<div class="menu-title">分类</div>'
    + '<button class="menu-item" type="button" data-dem-fact-cat="">未分类'
    + (!cur ? '<span class="k">当前</span>' : '') + '</button>'
    + cats.map(function(c){
        return '<button class="menu-item" type="button" data-dem-fact-cat="' + esc(c.id) + '">' + esc(c.name)
          + (c.id === cur ? '<span class="k">当前</span>' : '') + '</button>';
      }).join("")
    + (cats.length ? "" : '<p class="foot-note" style="padding:8px 10px;margin:0">该项目还没有分类</p>');
  UI.openPop(menu, anchor, { align:"left", width:220, onClose:function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-fact-cat]");
    if(!b) return;
    UI.closeAllPops();
    var next = b.dataset.demFactCat || "";
    if(next === cur) return;
    demandPutField(ctx, { categoryId:next || null },
      next ? ("分类已改为「" + catNameById(next) + "」") : "已清除分类");
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
}
function openDemandTypeFact(anchor, ctx){
  var cur = ctx.d.itemKind || "其他";
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "168px";
  menu.innerHTML = '<div class="menu-title">需求类型</div>' + DEMAND_ITEM_KINDS.map(function(k){
    return '<button class="menu-item" type="button" data-dem-fact-kind="' + esc(k) + '">' + esc(k)
      + (k === cur ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  UI.openPop(menu, anchor, { align:"left", width:190, onClose:function(){ menu.remove(); } });
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-dem-fact-kind]");
    if(!b) return;
    UI.closeAllPops();
    var next = b.dataset.demFactKind;
    if(next === cur) return;
    demandPutField(ctx, { itemKind:next }, "需求类型已改为「" + next + "」");
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
}
/* 评审人候选与新建/编辑表单同口径：项目花名册里可写的人，排除自己和只读成员 */
function openDemandReviewerFact(anchor, ctx){
  var cur = ctx.d.reviewerUserId || "";
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.style.minWidth = "220px";
  menu.innerHTML = '<div class="menu-title">评审人</div><p class="foot-note" style="padding:8px 10px;margin:0">加载成员…</p>';
  UI.openPop(menu, anchor, { align:"left", width:240, onClose:function(){ menu.remove(); } });
  loadProjectMembers(rt.currentWs.id, ctx.d.reqId).then(function(roster){
    if(!menu.isConnected) return;
    var me = rt.currentUser && rt.currentUser.id;
    var opts = ((roster && roster.members) || []).filter(function(m){
      return m && m.userId && m.userId !== me && m.access !== "read";
    });
    var names = {};
    opts.forEach(function(m){ names[m.userId] = m.displayName || m.username || m.userId; });
    /* 当前评审人可能已不在可写名单（换项目或降权），仍保留一行，避免看起来像被清空 */
    if(cur && !names[cur]){
      names[cur] = demReviewerName(ctx.d) || cur;
      opts = [{ userId:cur }].concat(opts);
    }
    menu.innerHTML = '<div class="menu-title">评审人</div>'
      + '<button class="menu-item" type="button" data-dem-fact-rev="">未指派'
      + (!cur ? '<span class="k">当前</span>' : '') + '</button>'
      + opts.map(function(m){
          return '<button class="menu-item" type="button" data-dem-fact-rev="' + esc(m.userId) + '">' + esc(names[m.userId])
            + (m.userId === cur ? '<span class="k">当前</span>' : '') + '</button>';
        }).join("")
      + (opts.length ? "" : '<p class="foot-note" style="padding:8px 10px;margin:0">项目里没有其他可写成员可指派</p>');
    menu.onclick = function(e){
      var b = e.target.closest("[data-dem-fact-rev]");
      if(!b) return;
      UI.closeAllPops();
      var next = b.dataset.demFactRev || "";
      if(next === cur) return;
      demandPutField(ctx, { reviewerUserId:next || null },
        next ? ("评审人已指派给「" + names[next] + "」") : "已改为未指派，项目可写成员可以认领");
    };
    var first = menu.querySelector(".menu-item");
    if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
  }).catch(function(){
    if(menu.isConnected){
      menu.innerHTML = '<div class="menu-title">评审人</div><p class="foot-note" style="padding:8px 10px;margin:0">成员加载失败，请稍后重试</p>';
    }
  });
}
function openDemandFactEditor(kind, anchor, ctx){
  if(!ctx || !ctx.d) return;
  if(!canWriteDemand(ctx.d)){ denyDemandReadOnly(); return; }
  if(isClosedDemand(ctx.d)){ toast("已关闭的需求不能直接编辑", "warn"); return; }
  if(kind === "priority") return openDemandPriorityFact(anchor, ctx);
  if(kind === "expect") return openDemandExpectFact(anchor, ctx);
  if(kind === "version"){
    return openDemandVersionMenu(anchor, ctx.d, function(res){
      demandApplyServer(ctx.d, res);
      ctx.sync();
    }, function(work){ return demandSaveQueued(ctx.layer, work); });
  }
  if(kind === "module") return openDemandModuleFact(anchor, ctx);
  if(kind === "type" || kind === "reviewer"){
    /* 类型与评审人只在待评审开放；进入流转后由状态动作决定，和整单编辑表单同一口径 */
    if(ctx.d.status !== "review"){
      toast("已进入流转，" + (kind === "type" ? "需求类型" : "评审人") + "由流转动作决定，不能再直接改", "warn");
      return;
    }
    return kind === "type" ? openDemandTypeFact(anchor, ctx) : openDemandReviewerFact(anchor, ctx);
  }
  /* 来源是纯文本，与标题/描述一样就地编辑，不再弹输入框 */
  if(kind === "source"){
    var textEl = anchor ? anchor.querySelector('[data-dem-text="source"]') : null;
    if(textEl) demandStartTextEdit(textEl, ctx, "source");
  }
}
/* ---------- 提醒人（关注） ----------
   一个人一份名单：提交人默认接收，不占名单；项目可写者可代他人添加/移除，任何可见成员可自我关注。
   关注后走 demand_watch 个人偏好，与提交人的 demand_status 分开，避免两边重复打扰。 */
function updateDemandWatchButton(layer, res){
  var btn = layer.querySelector("[data-dem-watch-btn]");
  if(!btn) return;
  var isCreator = !!(rt.currentUser && res && res.creatorId && rt.currentUser.id === res.creatorId);
  var on = !isCreator && !!(res && res.watching);
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  var label = btn.querySelector("[data-dem-watch-label]");
  if(label) label.textContent = isCreator ? "提醒人" : (on ? "已关注" : "关注");
  var cnt = btn.querySelector("[data-dem-watch-count]");
  if(cnt){
    var n = res ? Number(res.count) || 0 : 0;
    cnt.textContent = n ? String(n) : "";
    cnt.hidden = !n;
  }
}
function loadDemandWatch(layer, id){
  /* 同一个抽屉元素会复用于不同需求，先清掉上一条的名单，避免浮层闪出别人的关注人 */
  layer.__demWatch = null;
  return API.get("/api/demands/" + encodeURIComponent(id) + "/watch").then(function(res){
    if(!layer.isConnected) return;
    layer.__demWatch = res;
    updateDemandWatchButton(layer, res);
  }).catch(function(){ /* 名单加载失败不影响详情主体 */ });
}
function openDemandWatchPop(anchor, layer, id){
  function show(res){
    var menu = document.createElement("div");
    menu.className = "menu dem-watch-pop";
    menu.style.minWidth = "300px";
    function rowsHTML(){
      var out = [];
      if(res.creatorId){
        out.push('<div class="dem-watch-row is-owner"><span class="dem-watch-name">' + esc(res.creatorName || res.creatorId)
          + '</span><span class="dem-watch-sub">提交人 · 默认接收通知</span></div>');
      }
      (res.watchers || []).forEach(function(w){
        var self = rt.currentUser && rt.currentUser.id === w.userId;
        var canRemove = self || res.canManage;
        out.push('<div class="dem-watch-row">'
          + '<span class="dem-watch-name">' + esc(w.userName || w.userId) + (self ? '<span class="k">我</span>' : '') + '</span>'
          + '<span class="dem-watch-sub">' + (w.addedByName && w.addedBy !== w.userId ? "由 " + esc(w.addedByName) + " 添加" : "已关注") + '</span>'
          + (canRemove
            ? '<button class="icon-btn xs" type="button" data-dem-watch-remove="' + esc(w.userId) + '" title="'
              + (self ? "取消关注" : "移除提醒人") + '" aria-label="' + (self ? "取消关注" : "移除提醒人") + '">'
              + icon("close", 12) + '</button>'
            : '')
          + '</div>');
      });
      if(!res.watchers || !res.watchers.length){
        out.push('<p class="foot-note dem-watch-empty">除了提交人，还没有其他提醒人。</p>');
      }
      return out.join("");
    }
    function render(){
      /* 提交人默认就收通知，不进名单，也不提供「关注 / 取消关注」以免名单出现两条自己 */
      var isCreator = !!(rt.currentUser && res.creatorId && rt.currentUser.id === res.creatorId);
      menu.innerHTML = '<div class="menu-title">提醒人</div>'
        + '<div class="dem-watch-list">' + rowsHTML() + '</div>'
        + (res.canManage
          ? '<div class="dem-watch-add"><select class="input" id="demWatchPick" aria-label="选择要添加的提醒人"><option value="">加载成员…</option></select>'
            + '<button class="btn sm soft" type="button" data-dem-watch-add>' + icon("plus", 12) + ' 添加</button></div>'
          : '')
        + '<div class="menu-foot">'
        + (isCreator
          ? '<span class="foot-note">你是提交人，默认接收通知</span>'
          : '<button class="btn sm ' + (res.watching ? '' : 'primary') + '" type="button" data-dem-watch-toggle>'
            + (res.watching ? '取消关注' : '关注这个需求') + '</button>'
            + '<span class="foot-note">关注后状态流转、内容编辑、行内优先级/期望交付调整与新评论都会通知你</span>')
        + '</div>';
      if(res.canManage) fillPicker();
    }
    function fillPicker(){
      var sel = menu.querySelector("#demWatchPick");
      if(!sel) return;
      API.get("/api/demands/" + encodeURIComponent(id) + "/mention-candidates").then(function(members){
        if(!menu.isConnected || !sel.isConnected) return;
        var taken = {};
        (res.watchers || []).forEach(function(w){ taken[w.userId] = 1; });
        if(res.creatorId) taken[res.creatorId] = 1;
        var opts = (members || []).filter(function(m){ return m.userId && !taken[m.userId]; });
        sel.innerHTML = opts.length
          ? '<option value="">选择成员…</option>' + opts.map(function(m){
              return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
            }).join("")
          : '<option value="">没有可添加的成员</option>';
      }).catch(function(){
        if(sel && sel.isConnected) sel.innerHTML = '<option value="">成员加载失败</option>';
      });
    }
    function apply(next){
      if(!next) return;
      res = next;
      layer.__demWatch = next;
      updateDemandWatchButton(layer, next);
      render();
    }
    menu.addEventListener("click", function(e){
      var toggle = e.target.closest("[data-dem-watch-toggle]");
      if(toggle){
        var wasWatching = !!res.watching;
        toggle.disabled = true;
        var req = wasWatching
          ? API.del("/api/demands/" + encodeURIComponent(id) + "/watch")
          : API.post("/api/demands/" + encodeURIComponent(id) + "/watch", {});
        req.then(function(next){ apply(next); toast(wasWatching ? "已取消关注" : "已关注，需求变更会通知你", "fs"); })
          .catch(function(ex){ toggle.disabled = false; toast(ex.message || "操作失败", "bad"); });
        return;
      }
      var rm = e.target.closest("[data-dem-watch-remove]");
      if(rm){
        rm.disabled = true;
        API.del("/api/demands/" + encodeURIComponent(id) + "/watchers/" + encodeURIComponent(rm.dataset.demWatchRemove))
          .then(function(next){ apply(next); toast("已移除提醒人", "fs"); })
          .catch(function(ex){ rm.disabled = false; toast(ex.message || "移除失败", "bad"); });
        return;
      }
      var add = e.target.closest("[data-dem-watch-add]");
      if(add){
        var sel = menu.querySelector("#demWatchPick");
        var uid = sel && sel.value;
        if(!uid){ toast("先选择要添加的成员", "warn"); return; }
        add.disabled = true;
        API.post("/api/demands/" + encodeURIComponent(id) + "/watchers", { userId: uid })
          .then(function(next){ apply(next); toast("已添加提醒人", "fs"); })
          .catch(function(ex){ add.disabled = false; toast(ex.message || "添加失败", "bad"); });
      }
    });
    UI.openPop(menu, anchor, { align:"right", width:320, onClose:function(){ menu.remove(); } });
    render();
  }
  if(layer.__demWatch){ show(layer.__demWatch); return; }
  API.get("/api/demands/" + encodeURIComponent(id) + "/watch").then(function(res){
    if(!layer.isConnected) return;
    layer.__demWatch = res;
    updateDemandWatchButton(layer, res);
    show(res);
  }).catch(function(ex){ toast(ex.message || "提醒人加载失败", "bad"); });
}
var demandAiDrafts = [];
var demandAiCtx = null;
var demandAiBusy = false;
/* 需求详情里的 AI 一键拆分：只出草稿，勾选确认后才创建；创建口径与手动「新建工作项」一致 */
function runDemandAiSplit(d, layer){
  if(demandAiBusy) return;
  if(!d.description && !d.acceptText){
    toast("需求描述和验收标准都是空的，先补充内容再拆", "warn");
    return;
  }
  var btn = layer.querySelector("[data-dem-ai-split]");
  demandAiBusy = true;
  if(btn) btn.disabled = true;
  AIProgress.run({
    title: "AI 拆需求工作项",
    desc: "正在读「" + d.title + "」，结合描述、验收标准和已有工作项拆成可执行工作项…",
    hint: "通常需要 20–60 秒，可以随时取消",
    errorText: aiErrMsg,
    request: function(signal){
      return API.postWithSignal("/api/ai/demands/" + encodeURIComponent(d.id) + "/split", {}, signal);
    },
    onSuccess: function(res){
      demandAiDrafts = res.tasks || [];
      demandAiCtx = { demand: d, layer: layer };
      renderDemandAiSplit(res);
      UI.openModal($("dlgDemandAiSplit"));
    }
  }).then(function(){
    demandAiBusy = false;
    if(btn) btn.disabled = false;
  });
}
function renderDemandAiSplit(res){
  var d = (demandAiCtx && demandAiCtx.demand) || {};
  var proj = d.reqId ? reqNameById(d.reqId) : "";
  var hasDep = demandAiDrafts.some(function(t){ return t.dependsOnIndex >= 0; });
  var dup = demandAiDrafts.filter(function(t){ return t.duplicate; }).length;
  var msg = "「" + (res.demandTitle || d.title || "") + "」描述与验收共 " + (res.demandChars || 0)
    + " 字，AI 拆出 " + demandAiDrafts.length + " 条"
    + (dup ? "，其中 " + dup + " 条已有同名工作项（默认不勾选）" : "")
    + "。勾选的会创建到" + (proj ? "「" + proj + "」" : "本项目") + "的待处理列并关联本需求，标题和优先级可直接改"
    + (hasDep ? "；有依赖的两条都勾选时会自动连上依赖" : "") + "。";
  if(res.summary) msg += " " + res.summary;
  $("dlgDemandAiSplitMsg").textContent = msg;
  $("demandAiSplitList").innerHTML = demandAiDrafts.map(function(t, i){
    var p = String(t.priority || "P2").toUpperCase();
    var opts = PRIORITIES.map(function(x){
      return '<option value="' + x + '"' + (x === p ? " selected" : "") + '>' + x + ' · ' + esc(priName(x)) + '</option>';
    }).join("");
    var on = t.selected !== false;
    return '<div class="ai-item' + (on ? " on" : "") + '" data-i="' + i + '">'
      + '<input type="checkbox"' + (on ? " checked" : "") + ' data-pick="' + i + '" aria-label="选择工作项">'
      + '<div class="ai-main">'
      +   '<input class="ai-title" type="text" maxlength="60" value="' + esc(t.title || "") + '" data-title="' + i + '" aria-label="工作项标题">'
      +   (t.description ? '<div class="ai-desc">' + esc(taskDescText(t.description, 200)) + '</div>' : '')
      +   '<div class="ai-meta">'
      +     '<select class="ai-pri" data-pri="' + i + '" aria-label="优先级">' + opts + '</select>'
      +     (t.duplicate ? '<span class="ai-tag p1" title="' + esc(t.duplicateOf || "") + '">已有同名</span>' : '')
      +     (t.dependsOnIndex >= 0 ? '<span>依赖第 ' + (t.dependsOnIndex + 1) + ' 条</span>' : '')
      +     (t.reason ? '<span class="ai-reason">' + esc(t.reason) + '</span>' : '')
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join("");
  $("demandAiSplitUsage").textContent = aiUsageText(res.usage);
}
function applyDemandAiSplit(){
  var ctx = demandAiCtx;
  if(!ctx || !ctx.demand) return;
  var picked = [];
  var nodes = document.querySelectorAll("#demandAiSplitList .ai-item");
  for(var i = 0; i < nodes.length; i++){
    var cb = nodes[i].querySelector("input[type=checkbox]");
    if(!cb || !cb.checked) continue;
    var idx = Number(nodes[i].dataset.i);
    var src = demandAiDrafts[idx] || {};
    var titleEl = nodes[i].querySelector(".ai-title");
    var title = (titleEl ? titleEl.value : src.title || "").trim();
    if(!title) continue;
    var priEl = nodes[i].querySelector("[data-pri]");
    picked.push({
      title: title,
      description: src.description || "",
      priority: priEl ? priEl.value : (src.priority || "P2"),
      dependsOnIndex: src.dependsOnIndex == null ? -1 : src.dependsOnIndex,
      draftIndex: src.draftIndex == null ? idx : src.draftIndex
    });
  }
  if(!picked.length){ toast("至少选一条要创建的工作项", "warn"); return; }

  var btn = $("dlgDemandAiSplitOk");
  btn.disabled = true;
  API.post("/api/ai/demands/" + encodeURIComponent(ctx.demand.id) + "/tasks", { tasks: picked }).then(function(r){
    btn.disabled = false;
    UI.closeModal($("dlgDemandAiSplit"));
    var msg = "已创建 " + r.created + " 个工作项";
    if(r.linked) msg += "，连上 " + r.linked + " 条依赖";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 个已有的同名项";
    msg += aiApplyFailText(r.failed, "个");
    toast(msg, r.failed && r.failed.length ? "warn" : "fs");
    refreshDemandWork(ctx.layer, ctx.demand.id, ctx.demand.versionId);
  }).catch(function(ex){
    btn.disabled = false;
    toast(aiErrMsg(ex && ex.message), "bad");
  });
}

function renderDemandDetail(d, opts){
  var id = d.id;
  var writable = canWriteDemand(d), canEditText = writable && !isClosedDemand(d);
  var canEditTitle = canEditText && (d.status === "review" || d.status === "done");
  /* 已完成不再拆分新工作项；已有工作项仍可正常推进与重开（会触发自动退回） */
  var canSplit = canEditText && d.status !== "done";
  var total = Number(d.taskCount) || 0, done = Number(d.taskDone) || 0;
  var cases = Number(d.caseCount) || 0, passed = Number(d.casePassed) || 0;
  var statusLabel = demandStatusLabel(d);
  /* 项目内需求编号：存量未取号时不出胶囊，不编造编号 */
  var demandNo = demandNoText(d.demandNo);
  var statusDot = demandStatusDot(d.status);
  function headMetaText(){
    var created = "提交于 " + (fmtTs(d.createdAt) || "—");
    var creator = demCreatorName(d);
    return [
      reqNameById(d.reqId) || "未归属项目",
      catNameById(d.categoryId) || null,
      d.expectDate ? "期望交付 " + d.expectDate : null,
      creator ? "由 " + creator + " " + created : created
    ].filter(Boolean).join(" · ");
  }
  var meta = headMetaText();
  var relFacts = [
    ["目标版本", demandVersionName(d) || "待规划"],
    ["所属项目", reqNameById(d.reqId) || "未归属项目"],
    ["分类", catNameById(d.categoryId) || "未分类"],
    ["来源", d.source || "—"]
  ];
  var wsjf = (d.wsjfBusiness != null)
    ? '<div class="wsjf-break"><span>WSJF</span><span>业务 ' + d.wsjfBusiness + '</span><span>紧迫 ' + d.wsjfUrgency
      + '</span><span>风险 ' + d.wsjfRisk + '</span><span>工作量 ' + d.wsjfEffort
      + '</span><b>' + wsjfText(d) + '</b><span class="muted">四项都填才计分</span></div>'
    : '<p class="foot-note" style="margin:8px 0 0">未评分</p>';
  var stageLine = d.deliveryStage
    ? '<p class="dem-evidence-line">当前交付阶段 <span class="tag dem-stage-tag st-' + esc(d.deliveryStage)
      + (d.deliveryStageSource === "manual" ? " manual" : "") + '">' + esc(deliveryStageName(d.deliveryStage))
      + '</span><span class="foot-note">' + (d.deliveryStageSource === "manual" ? "人工判定" : "由工作项、用例与发布记录派生")
      + '</span>' + caliberMarkHTML("demands.stage", false, "查看交付阶段如何变化") + '</p>'
    : '';
  function demandFactsHTML(){
    var pri = d.priority || "P2";
    var ver = demandVersionName(d) || "待规划";
    var planned = plannedText(d);
    var expectDelta = demandExpectDelta(d);
    var expectOverdue = !isClosedDemand(d) && expectDelta !== null && expectDelta < 0;
    var donePct = total ? Math.round(done / total * 100) : 0;
    var passPct = cases ? Math.round(passed / cases * 100) : 0;
    var pub = (d.deliveryStageSource === "manual" && d.manualDeliveryStage === "delivered")
      ? { label:"人工交付", sub:"人工判定", cls:" is-manual" }
      : d.deliveredAt
        ? { label:"已发布", sub:String(d.deliveredAt).substring(0, 10), cls:" is-done" }
        : { label:"未发布", sub:"以发布记录为准", cls:"" };
    var reviewMetaEdit = canEditText && d.status === "review";
    var metaItems = [
      ["type", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 8.6V4.4a.8.8 0 0 1 .8-.8h4.2l7.8 7.8-5 5Z"/><circle cx="6.8" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>',
        "需求类型", d.itemKind || "其他", reviewMetaEdit],
      ["module", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="3.2" width="5.8" height="5.8" rx="1.3"/><rect x="11" y="3.2" width="5.8" height="5.8" rx="1.3"/><rect x="3.2" y="11" width="5.8" height="5.8" rx="1.3"/><rect x="11" y="11" width="5.8" height="5.8" rx="1.3"/></svg>',
        "分类", catNameById(d.categoryId) || "未分类", true],
      ["source", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 11.2 5 4.6h10l1.6 6.6v4.2a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z"/><path d="M3.6 11.4h3.6l.9 1.7h3.8l.9-1.7h3.6"/></svg>',
        "来源", d.source || "未填写", true],
      ["creator", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.6" r="2.8"/><path d="M4.4 16.2a5.6 5.6 0 0 1 11.2 0"/></svg>',
        "提交人", demCreatorName(d) || "—", false],
      ["reviewer", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.6" r="2.8"/><path d="M4.4 16.2a5.6 5.6 0 0 1 11.2 0"/><path d="m12.4 15.2 1.3 1.3 2.4-2.5"/></svg>',
        "评审人", demReviewerName(d) || "未指派", reviewMetaEdit]
    ];
    if(isClosedDemand(d)){
      metaItems.push(["close", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.6"/><path d="M5.4 14.6 14.6 5.4"/></svg>',
        "关闭原因", closeReasonName(d.closeReason || (d.status === "rej" ? "rej" : "cancel"))]);
      metaItems.push(["stage", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3.4v13.2"/><path d="M5.2 4.4h9.4l-2 3.2 2 3.2H5.2z"/></svg>',
        "关闭前阶段", closeStageName(d.closeStage || (d.status === "rej" ? "review" : "pass"))]);
    }
    var factEdit = canEditText ? ' rf-edit' : '';
    /* 期望交付在已完成后不再调整，优先级等文本类属性仍可修正 */
    var expectEdit = canEditText && d.status !== "done" ? ' rf-edit' : '';
    var verEdit = d.status === "plan" && canScheduleDemand(d);
    var rc = layer.__relCounts || {};
    function relChip(kind, ico, label){
      var tip = kind === "docs" ? "查看关联文档" : "查看附件";
      return '<div class="rf rf-meta rf-jump" data-meta="' + kind + '" data-dem-rel-jump="' + kind + '" role="button" tabindex="0" title="' + tip + '">'
        + '<span class="rf-k"><span class="rf-meta-ico" aria-hidden="true">' + ico + '</span>' + label + '</span>'
        + '<b class="rf-v">' + demandRelCountHTML(kind, rc[kind]) + '</b></div>';
    }
    return '<div class="read-facts wi-facts demand-facts" id="demandFacts" aria-label="需求概览">'
      + '<div class="wi-row wi-row-main">'
      +   '<div class="rf wi-card' + factEdit + '"' + (canEditText ? ' data-dem-fact="priority" role="button" tabindex="0" title="点击修改优先级"' : '') + '><span class="rf-k">优先级</span>'
      +     '<b class="rf-v rf-v-lg" title="优先级 ' + esc(pri) + '"><span class="rf-dot" style="background:' + esc(priColor(pri)) + '"></span>' + esc(pri + " · " + priName(pri)) + '</b></div>'
      +   '<div class="rf wi-card' + (verEdit ? ' rf-edit' : '') + '"' + (verEdit ? ' data-dem-fact="version" role="button" tabindex="0" title="点击调整目标版本"' : '') + '><span class="rf-k">目标版本</span>'
      +     '<b class="rf-v rf-v-lg" title="' + esc(ver) + '">' + esc(ver) + '</b>'
      +     '<span class="rf-sub">' + (planned
              ? "计划 " + esc(demandShortDay(d.plannedStart)) + " → " + esc(demandShortDay(d.plannedEnd))
              : "尚未进入版本计划") + '</span></div>'
      +   '<div class="rf wi-card rf-date' + (expectOverdue ? " overdue" : "") + expectEdit + '"' + (expectEdit ? ' data-dem-fact="expect" role="button" tabindex="0" title="点击修改期望交付"' : '') + '><span class="rf-k">期望交付</span>'
      +     '<b class="rf-v rf-v-lg" title="' + esc(d.expectDate || "待评估") + '">' + esc(d.expectDate || "待评估") + '</b>'
      +     '<span class="rf-sub">' + esc(demandExpectNote(d)) + '</span></div>'
      + '</div>'
      + '<div class="wi-card wi-delivery demand-band">'
      +   '<div class="rf wi-delivery-cell dem-band-cell is-goto" data-demand-goto="delivery" role="button" tabindex="0" title="查看交付证据与关联工作项"><span class="rf-k">关联工作项</span>'
      +     '<span class="rf-sub">' + (total ? (total - done) + " 个未完成" : "尚未拆分") + '</span>'
      +     '<div class="rf-v dem-band-figure"><b class="rf-stat-num">' + done + '</b>'
      +       '<span class="dem-band-unit">/ ' + total + ' 完成</span>'
      +       '<span class="rf-prog dem-band-bar" role="progressbar" aria-label="工作项完成度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + donePct + '"><i style="width:' + donePct + '%"></i></span>'
      +     '</div></div>'
      +   '<div class="rf wi-delivery-cell dem-band-cell is-goto" data-dem-cases role="button" tabindex="0" title="查看该需求的用例覆盖"><span class="rf-k">测试用例</span>'
      +     '<span class="rf-sub">' + (cases ? passPct + "% 通过" : "尚未关联用例") + '</span>'
      +     '<div class="rf-v dem-band-figure"><b class="rf-stat-num">' + passed + '</b>'
      +       '<span class="dem-band-unit">/ ' + cases + ' 通过</span>'
      +       '<span class="rf-prog dem-band-bar" role="progressbar" aria-label="测试用例通过率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + passPct + '"><i style="width:' + passPct + '%"></i></span>'
      +     '</div></div>'
      +   '<div class="rf wi-delivery-cell dem-band-cell is-goto" data-demand-goto="delivery" role="button" tabindex="0" title="查看生产发布证据"><span class="rf-k">生产发布</span>'
      +     '<span class="rf-sub">' + esc(pub.sub) + '</span>'
      +     '<div class="rf-v dem-band-figure"><span class="dem-band-state' + pub.cls + '"><i></i>' + esc(pub.label) + '</span></div>'
      +   '</div>'
      + '</div>'
      + '<div class="wi-card wi-meta-card demand-meta-card">'
      +   metaItems.map(function(m){
            var editable = !!m[4] && canEditText;
            return '<div class="rf rf-meta' + (editable ? ' rf-edit' : '') + '" data-meta="' + m[0] + '"'
              + (editable ? ' data-dem-fact="' + m[0] + '" role="button" tabindex="0" title="点击修改' + esc(m[2]) + '"' : '') + '>'
              + '<span class="rf-k"><span class="rf-meta-ico" aria-hidden="true">' + m[1] + '</span>' + esc(m[2]) + '</span>'
              + '<b class="rf-v"' + (m[0] === "source" && editable ? ' data-dem-text="source"' : '') + ' title="' + esc(m[3]) + '">' + esc(m[3]) + '</b></div>';
          }).join("")
      +   relChip("docs", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h6l4 4v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M11 3.5v4h4"/></svg>', "文档")
      +   relChip("atts", '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 9.5l-5 5a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-6 6"/></svg>', "附件")
      + '</div>'
      + '</div>';
  }
  var layer = document.createElement("div");
  layer.className = "modal-layer demand-detail";
  demandCommentReplyTo = null;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "demandDetailTitle");
  layer.setAttribute("data-ai-demand", id);
  demandDetailLayer = layer;
  layer.__uiOnClose = function(){
    if(demandDetailLayer === layer) demandDetailLayer = null;
    if(layer.__commentMention){
      layer.__commentMention.close();
      if(demandCommentMention === layer.__commentMention) demandCommentMention = null;
    }
    if(layer.__ovMention){
      layer.__ovMention.close();
      if(demandOverviewMention === layer.__ovMention) demandOverviewMention = null;
    }
    /* 未发送的截图持有 objectURL：关闭详情时一并释放 */
    demRevokeThumbs(layer.__demFiles);
    demRevokeThumbs(layer.__demOvFiles);
    demandCommentReplyTo = null;
    setTimeout(function(){ layer.remove(); }, 0);
  };
  layer.innerHTML =
    '<div class="sheet demand-sheet">'
    + '<div class="drawer-head demand-head">'
    +   '<span class="head-icon t-demand" aria-hidden="true">' + icon("demand", 17) + '</span>'
    +   '<div class="head-txt">'
    +     '<div class="head-title-line">'
    +       '<h2 id="demandDetailTitle"' + (canEditTitle ? ' class="demand-title-edit" data-dem-text="title" tabindex="0" role="button" title="点击修改标题"' : '') + '>' + esc(d.title) + '</h2>'
    +       '<button class="ds-status" type="button" id="demandStatusPill" aria-haspopup="menu" title="切换需求状态"' + (demandStatusMenuItems(d).length ? '' : ' disabled') + '>'
    +         '<i id="demandStatusDot" style="background:' + statusDot + '"></i><span id="demandStatusName">' + esc(statusLabel) + '</span>'
    +         '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>'
    +       '</button>'
    +       (demandNo ? '<button class="drawer-no" type="button" data-dem-copy-no title="点击复制需求编号">' + esc(demandNo) + '</button>' : '')
    +     '</div>'
    +     '<div class="head-sub">' + esc(meta) + '</div>'
    +   '</div>'
    +   '<div class="head-tools">'
    +     '<button class="btn sm ghost dem-watch-btn" type="button" data-dem-watch-btn aria-haspopup="menu" aria-expanded="false" aria-pressed="false" title="提醒人：关注后需求变更会通知你">'
    +       icon("eye", 14) + ' <span data-dem-watch-label>关注</span><span class="dem-watch-count" data-dem-watch-count hidden></span></button>'
    +     (demandMenuItems(d).length ? '<button class="btn sm ghost" type="button" data-dem-detail-more-btn aria-haspopup="menu" aria-expanded="false" title="更多操作">' + icon("more", 14) + ' 更多</button>' : '')
    +     '<button class="icon-btn sm" type="button" data-dem-x aria-label="关闭">' + icon("close", 15) + '</button>'
    +   '</div>'
    + '</div>'
    + '<div class="drawer-tabs demand-tabs" role="tablist">'
    +   '<button class="drawer-tab" type="button" role="tab" data-dem-tab="overview" aria-selected="true">概览</button>'
    +   '<button class="drawer-tab" type="button" role="tab" data-dem-tab="delivery" aria-selected="false">交付 <span class="tab-cnt" id="tabDeliveryCount"></span></button>'
    +   '<button class="drawer-tab" type="button" role="tab" data-dem-tab="rel" aria-selected="false">关联</button>'
    +   '<button class="drawer-tab" type="button" role="tab" data-dem-tab="comments" aria-selected="false">评论 <span class="tab-cnt" id="tabCommentCount"></span></button>'
    +   '<button class="drawer-tab" type="button" role="tab" data-dem-tab="records" aria-selected="false">记录 <span class="tab-cnt" id="tabRecordCount"></span></button>'
    + '</div>'
    + '<div class="drawer-body demand-body" id="demandDetailBody">'
    +   '<div class="drawer-pane" data-dem-pane="overview">'
    +     demandFactsHTML()
    +     (isClosedDemand(d) ? '<p class="foot-note">历史保留；' + esc((d.closeReason === "rej" || d.status === "rej") ? "可重新打开回到「待评审」。" : "可恢复至「" + restoreTargetName(d) + "」。") + '</p>' : '')
    +     (d.deliveryEvidenceMissing ? '<p class="foot-note">目标版本已发布，但没有有效生产发布记录；请人工补录真实交付证据。</p>' : '')
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>需求描述</h3>'
    +         (canEditText ? '<span class="dem-desc-tools">'
    +           '<input type="file" id="demDescImgFile" class="dem-comment-file" accept="image/*" multiple>'
    +           '<button class="btn sm ghost" type="button" data-dem-desc-img title="插入图片：也可以直接在描述里粘贴或拖入；选中图片后拖动右下角调整大小">'
    +             '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.2" width="14" height="11.6" rx="2"/><circle cx="7.4" cy="8" r="1.4"/><path d="m3.6 13.4 3.8-3.4 3 2.6 2.4-2.2 3.6 3.4"/></svg>'
    +             ' 插入图片</button></span>' : '')
    +       '</div>'
    +       '<div class="read-desc demand-copy' + (canEditText ? ' is-editable' : '') + '" id="demandDescView"'
    +         (canEditText ? ' data-dem-text="desc" tabindex="0" role="button" aria-label="需求描述，点击编辑" title="点击编辑；可直接粘贴或拖入图片；失焦或 ⌘/Ctrl+Enter 保存，Esc 取消"' : '')
    +       '>' + demandDetailHTML(d.description) + '</div>'
    +     '</section>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>验收标准</h3></div>'
    +       '<div class="read-desc demand-copy' + (canEditText ? ' is-editable' : '') + '" id="demandAcceptView"'
    +         (canEditText ? ' data-dem-text="accept" tabindex="0" role="button" aria-label="验收标准，点击编辑" title="点击编辑；失焦或 ⌘/Ctrl+Enter 保存，Esc 取消"' : '')
    +       '>' + demandDetailPlain(d.acceptText) + '</div>'
    +       wsjf
    +     '</section>'
    +     '<section class="read-card">'
    +         '<div class="read-card-head dem-progress-head"><h3>交付进度</h3>'
    +         '<span class="read-cnt" id="demandProgressCount">' + done + ' / ' + total + ' 完成</span>'
    +         '<span class="dem-split-actions">'
    +           (canSplit ? '<button class="btn sm soft ai-action" type="button" data-dem-ai-split title="用 AI 读需求描述和验收标准，拆成工作项草稿；勾选确认后才会创建">' + icon("ai", 13) + ' AI 拆工作项</button>' : '')
    +           (canSplit ? '<button class="btn sm soft" type="button" data-dem-addtask title="手动新建一条关联到本需求的工作项">' + icon("plus", 13) + ' 新建工作项</button>' : '')
    +         '</span>'
    +         '<button class="link-btn" type="button" data-demand-goto="delivery">查看交付证据</button></div>'
    +       '<ul class="read-activity demand-overview-tasks" id="demandOverviewTasks"><li class="read-empty">加载关联工作项…</li></ul>'
    +     '</section>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>工时</h3><span class="read-cnt" id="demandHoursMeta"></span>'
    +         '<button class="link-btn" type="button" data-demand-goto="delivery">按工作项查看</button></div>'
    +       '<div class="dem-hours" id="demandHoursBody"><p class="read-empty">加载中…</p></div>'
    +     '</section>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>最近记录</h3><button class="link-btn" type="button" data-demand-goto="records">查看全部</button></div>'
    +       '<ul class="read-activity dem-logs" id="demandRecentLogs"><li class="read-empty">加载中…</li></ul>'
    +     '</section>'
    +     '<section class="read-card dem-discuss-card">'
    +       '<div class="read-card-head"><h3>讨论</h3><span class="read-cnt" id="demOverviewCommentCount"></span>'
    +         '<button class="link-btn" type="button" data-demand-goto="comments">查看全部评论</button></div>'
    +       '<div class="reqdoc-comment-list dem-discuss-list" id="demOverviewComments"><div class="read-empty">加载中…</div></div>'
    +       (writable
        ? '<div class="dem-discuss-form" id="demOverviewCommentForm">'
          + '<textarea id="demOvCommentInput" rows="2" maxlength="1000" placeholder="在概览里直接记一条评论，输入 @ 可提及成员；截图可直接粘贴，Ctrl/⌘ + Enter 发表"></textarea>'
          + '<div class="comment-attach-chips" id="demOvCommentFiles" hidden></div>'
          + '<div class="reqdoc-comment-actions">'
          +   '<span class="dem-comment-actions-l">'
          +     '<input type="file" id="demOvCommentFile" class="dem-comment-file" multiple accept="' + ACCEPT + '">'
          +     '<button class="btn sm soft" type="button" data-dem-attach="ov" title="添加附件；截图也可以直接粘贴">'
          +       '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.6 6.4 7.2 11.8a2.2 2.2 0 0 0 3.1 3.1l5.4-5.4a3.8 3.8 0 0 0-5.4-5.4L4.8 9.6a5.4 5.4 0 0 0 7.6 7.6l3.4-3.4"/></svg>'
          +       ' 附件 / 截图</button>'
          +     '<span class="foot-note" id="demOvAttachTip"></span>'
          +   '</span>'
          +   '<button class="btn sm primary" type="button" id="demOvCommentSend">发表</button>'
          + '</div>'
          + '</div>'
        : '<p class="foot-note">当前为只读：只有项目可写成员可以参与讨论。</p>')
    +     '</section>'
    +   '</div>'
    +   '<div class="drawer-pane" data-dem-pane="delivery" hidden>'
    +     (d.status === "done" ? '<section class="read-card">' + demandJudgementSectionHTML(d) + '</section>' : '')
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>交付证据</h3></div>'
    +       (d.deliveryStage ? stageLine : '')
    +       '<div id="demTasks"><div class="attach-empty">加载中…</div></div>'
    +     '</section>'
    +   '</div>'
    +   '<div class="drawer-pane" data-dem-pane="rel" hidden>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>关联文档</h3></div>'
    +       '<div class="attach-list" id="demDocs"><div class="attach-empty">加载中…</div></div>'
    +       (writable ? '<div class="dem-doc-add"><select id="demDocPick" aria-label="选择要关联的文档"></select>'
    +         '<button class="btn sm add" type="button" data-dem-doc-link>' + icon("plus", 13) + ' 关联文档</button></div>' : '')
    +     '</section>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>附件</h3><span class="foot-note">≤10MB</span></div>'
    +       '<div class="attach-list" id="demAtts"><div class="attach-empty">加载中…</div></div>'
    +       (writable ? '<div class="att-kit compact" style="margin-top:8px">'
    +         '<div class="att-drop" tabindex="0" role="button" aria-label="选择或拖入文件" data-dem-attdrop>'
    +         '<span class="att-drop-ico">' + icon("upload", 16) + '</span>'
    +         '<span class="att-drop-text"><b>点击选择</b>，或将文件拖到这里，也可粘贴截图</span>'
    +         '<input type="file" id="demAttFile" class="att-drop-input" multiple accept="' + ACCEPT + '" tabindex="-1" aria-hidden="true">'
    +         '</div></div>' : '')
    +     '</section>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>计划与归属</h3></div>'
    +       '<dl class="read-evidence">' + relFacts.map(function(g){
              return '<dt>' + esc(g[0]) + '</dt><dd title="' + esc(g[1]) + '">' + esc(g[1]) + '</dd>';
            }).join("") + '</dl>'
    +     '</section>'
    +   '</div>'
    +   '<div class="drawer-pane" data-dem-pane="comments" hidden>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>评论</h3>'
    +         '<label class="reqdoc-unresolved-toggle"><input type="checkbox" id="demCommentUnresolved"> 只看未解决</label></div>'
    +       '<div class="reqdoc-comment-list" id="demCommentList"><div class="reqdoc-comment-empty">加载中…</div></div>'
    +     '</section>'
    +     (writable
      ? '<section class="read-card">'
        + '<div class="reqdoc-comment-form" id="demCommentForm">'
        +   '<div class="reqdoc-comment-quotechip" id="demCommentReplyChip" hidden>'
        +     '<span>回复</span><span class="qc-text" id="demCommentReplyText"></span>'
        +     '<button class="qc-x" type="button" data-dem-comment-reply-clear title="取消回复" aria-label="取消回复">×</button>'
        +   '</div>'
        +   '<textarea id="demCommentInput" rows="3" maxlength="1000" placeholder="写下评论，输入 @ 可提及成员；截图可直接粘贴"></textarea>'
        +   '<div class="comment-attach-chips" id="demCommentFiles" hidden></div>'
        +   '<div class="reqdoc-comment-actions">'
        +     '<span class="dem-comment-actions-l">'
        +       '<input type="file" id="demCommentFile" class="dem-comment-file" multiple accept="' + ACCEPT + '">'
        +       '<button class="btn sm soft" type="button" data-dem-attach="tab" title="添加附件；截图也可以直接粘贴">'
        +         '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.6 6.4 7.2 11.8a2.2 2.2 0 0 0 3.1 3.1l5.4-5.4a3.8 3.8 0 0 0-5.4-5.4L4.8 9.6a5.4 5.4 0 0 0 7.6 7.6l3.4-3.4"/></svg>'
        +         ' 附件 / 截图</button>'
        +       '<span class="foot-note" id="demAttachTip"></span>'
        +     '</span>'
        +     '<button class="btn sm primary" type="button" id="demCommentSend">发表评论</button>'
        +   '</div>'
        + '</div>'
        + '</section>'
      : '<p class="foot-note">当前为只读：只有项目可写成员可以发表评论。</p>')
    +   '</div>'
    +   '<div class="drawer-pane" data-dem-pane="records" hidden>'
    +     '<section class="read-card">'
    +       '<div class="read-card-head"><h3>流转记录</h3></div>'
    +       '<ul class="read-activity dem-logs" id="demLogs"><li class="foot-note">加载中…</li></ul>'
    +     '</section>'
    +   '</div>'
    + '</div>'
    + (demandFootActs(d) ? '<div class="drawer-foot demand-foot">'
            + '<span class="demand-foot-acts">' + demandFootActs(d) + '</span></div>' : '')
    + '</div>';
  document.body.appendChild(layer);
  function syncReadViews(){
    var titleEl = layer.querySelector("#demandDetailTitle");
    if(titleEl && !titleEl.isContentEditable) titleEl.textContent = d.title || "";
    var descEl = layer.querySelector("#demandDescView");
    if(descEl && !descEl.isContentEditable) descEl.innerHTML = demandDetailHTML(d.description);
    var acceptEl = layer.querySelector("#demandAcceptView");
    if(acceptEl && !acceptEl.isContentEditable) acceptEl.innerHTML = demandDetailPlain(d.acceptText);
    var facts = layer.querySelector("#demandFacts");
    if(facts){
      /* 键盘选择属性后整组重建，焦点要落回同一项，否则会跳回页首 */
      var focused = document.activeElement;
      var focusedKind = focused && facts.contains(focused) ? focused.dataset.demFact : null;
      var tmp = document.createElement("div");
      tmp.innerHTML = demandFactsHTML();
      var next = tmp.firstElementChild;
      if(next){
        facts.replaceWith(next);
        if(focusedKind){
          var again = next.querySelector('[data-dem-fact="' + focusedKind + '"]');
          if(again){ try{ again.focus({ preventScroll:true }); }catch(err){ try{ again.focus(); }catch(e2){ /* noop */ } } }
        }
      }
    }
    var sub = layer.querySelector(".demand-head .head-sub");
    if(sub) sub.textContent = headMetaText();
  }
  var detailCtx = { layer:layer, d:d, sync:syncReadViews };
  /* 描述里插入图片：先上传成需求附件，再把 ![文件名](att:ID) 片段插到光标处；
     与文字共用一套纯文本存储，导出/搜索不受影响 */
  function insertDemandDescImages(files){
    var descEl = layer.querySelector("#demandDescView");
    if(!descEl) return;
    if(!canEditText || isClosedDemand(d)){ denyDemandReadOnly(); return; }
    /* 描述里只嵌入图片；其它文件属于「关联-附件」，避免在正文里留下无法显示的文件标记 */
    var imgs = (files || []).filter(function(f){
      return /^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp)$/i.test(f.name || "");
    });
    if(imgs.length < (files || []).length){
      toast("描述只支持插入图片；其它文件请放到「关联 - 附件」", "warn");
    }
    if(!imgs.length) return;
    var res = validateFiles(imgs, 0);
    reportRejected(res.rejected);
    if(!res.ok.length) return;
    if(!descEl.isContentEditable) demandStartTextEdit(descEl, detailCtx, "desc");
    try{ descEl.focus(); }catch(e){ /* noop */ }
    var inserted = 0, failed = 0;
    var chain = Promise.resolve();
    res.ok.forEach(function(f){
      chain = chain.then(function(){
        return uploadAttachment("/api/demands/" + encodeURIComponent(id) + "/attachments", f).then(function(att){
          if(!layer.isConnected || !att) return;
          var img = document.createElement("img");
          img.className = "dem-inline-img";
          img.setAttribute("data-dem-inline-img", att.id);
          img.setAttribute("data-dem-inline-name", att.filename || "图片");
          img.setAttribute("src", attUrl(att.id));
          img.setAttribute("alt", att.filename || "图片");
          img.setAttribute("title", "点击查看大图");
          /* 包一层缩放框：插入后即可拖动右下角调整大小 */
          var fig = demandEnsureInlineFigure(img);
          var sel = window.getSelection();
          var range = null;
          /* 只在仍处于编辑态时按光标插入；已失焦就追加到末尾，避免把选区抢回旧输入框 */
          if(descEl.isContentEditable && sel && sel.rangeCount){
            var r = sel.getRangeAt(0);
            if(descEl.contains(r.startContainer) && descEl.contains(r.endContainer)) range = r;
          }
          if(range){
            range.deleteContents();
            range.insertNode(fig);
            range.setStartAfter(fig);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }else{
            descEl.appendChild(fig);
          }
          inserted++;
        }, function(){ failed++; });
      });
    });
    chain.then(function(){
      if(!layer.isConnected) return;
      if(inserted){
        /* 上传是异步的：期间可能已经失焦并保存过，此时图片只插进了 DOM。
           这里按当前 DOM 重新序列化并走保存队列，保证重开详情后正文里的图片还在。 */
        var nextText = demandSerializeRichText(descEl);
        if(nextText !== demandFieldValue(detailCtx.d, "desc")){
          demandPutField(detailCtx, { description: nextText || null },
            inserted > 1 ? "已插入 " + inserted + " 张图片" : "图片已插入");
        }
        loadDemandAttachments(layer, id, writable);
      }
      if(failed) toast("图片上传：" + inserted + " 张成功，" + failed + " 张失败", "warn");
    });
  }
  layer.addEventListener("focusout", function(e){
    var textEl = e.target && e.target.closest ? e.target.closest("[data-dem-text]") : null;
    if(!textEl || !textEl.isContentEditable) return;
    /* 缩放手柄/移除按钮在编辑框内部，焦点落到它们身上不算离开正文 */
    if(e.relatedTarget && textEl.contains(e.relatedTarget)) return;
    demandFinishTextEdit(textEl, detailCtx, textEl.dataset.demText, true);
  });
  layer.addEventListener("keydown", function(e){
    var textEl = e.target.closest ? e.target.closest("[data-dem-text]") : null;
    if(textEl && textEl.isContentEditable){
      if(e.key === "Escape"){
        e.preventDefault(); e.stopPropagation();
        demandCancelTextEdit(textEl, detailCtx, textEl.dataset.demText);
        return;
      }
      var single = textEl.dataset.demText === "title" || textEl.dataset.demText === "source";
      var sel = window.getSelection();
      if(textEl.dataset.demText === "source" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
        && String(textEl.innerText || "").replace(/\n+$/, "").length >= DEMAND_SOURCE_MAX
        && sel && sel.isCollapsed){
        e.preventDefault();
        return;
      }
      if(e.key === "Enter" && (single || e.metaKey || e.ctrlKey)){
        e.preventDefault();
        demandFinishTextEdit(textEl, detailCtx, textEl.dataset.demText, true);
      }
      return;
    }
    if(e.key !== "Enter" && e.key !== " ") return;
    var navEl = e.target.closest ? e.target.closest("[data-demand-goto],[data-dem-cases],[data-dem-rel-jump]") : null;
    if(navEl){
      e.preventDefault();
      navEl.click();
      return;
    }
    var factEl = e.target.closest ? e.target.closest("[data-dem-fact]") : null;
    if(factEl){
      e.preventDefault();
      openDemandFactEditor(factEl.dataset.demFact, factEl, detailCtx);
      return;
    }
    if(textEl){
      e.preventDefault();
      demandStartTextEdit(textEl, detailCtx, textEl.dataset.demText);
    }
  });
  function setDemandTab(name){
    layer.querySelectorAll("[data-dem-tab]").forEach(function(b){
      b.setAttribute("aria-selected", b.dataset.demTab === name ? "true" : "false");
    });
    layer.querySelectorAll("[data-dem-pane]").forEach(function(p){ p.hidden = p.dataset.demPane !== name; });
    var body = layer.querySelector("#demandDetailBody");
    if(body) body.scrollTop = 0;
  }
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-x]")){ UI.closeModal(layer); return; }
    /* 描述里的内嵌图片：编辑态交给浏览器放光标，只读态点击看大图 */
    var inlineImg = e.target.closest("[data-dem-inline-img]");
    if(inlineImg){
      var imgHost = inlineImg.closest("#demandDescView");
      if(imgHost && imgHost.isContentEditable) return;
      e.preventDefault();
      openAttPreview({ attachment: { id: inlineImg.dataset.demInlineImg, filename: inlineImg.dataset.demInlineName || "图片" } });
      return;
    }
    var copyNo = e.target.closest("[data-dem-copy-no]");
    if(copyNo){ copyToClipboard(copyNo.textContent, "需求编号 " + copyNo.textContent + " 已复制到剪贴板"); return; }
    var tab = e.target.closest("[data-dem-tab]");
    if(tab){ setDemandTab(tab.dataset.demTab); return; }
    var replyClear = e.target.closest("[data-dem-comment-reply-clear]");
    if(replyClear){ setDemandCommentReply(layer, null, ""); return; }
    var pendingRm = e.target.closest("[data-dem-pending-rm]");
    if(pendingRm){
      var scopeRm = pendingRm.dataset.demPendingScope === "ov" ? "ov" : "tab";
      var rmList = demandPendingFiles(layer, scopeRm);
      var rmAt = Number(pendingRm.dataset.demPendingRm);
      demRevokeThumb(rmList[rmAt]);
      rmList.splice(rmAt, 1);
      renderDemandPendingFiles(layer, scopeRm);
      return;
    }
    var attachBtn = e.target.closest("[data-dem-attach]");
    if(attachBtn){
      if(!writable){ denyDemandReadOnly(); return; }
      var scopePick = attachBtn.dataset.demAttach === "ov" ? "ov" : "tab";
      var pickFile = layer.querySelector(scopePick === "ov" ? "#demOvCommentFile" : "#demCommentFile");
      if(pickFile) pickFile.click();
      return;
    }
    var descImgBtn = e.target.closest("[data-dem-desc-img]");
    if(descImgBtn){
      if(!canEditText){ denyDemandReadOnly(); return; }
      if(isClosedDemand(d)){ toast("已关闭的需求不能直接编辑", "warn"); return; }
      var descFile = layer.querySelector("#demDescImgFile");
      if(descFile) descFile.click();
      return;
    }
    var cReply = e.target.closest("[data-dem-comment-reply]");
    if(cReply){ setDemandCommentReply(layer, cReply.dataset.demCommentReply, cReply.dataset.demCommentUser); return; }
    var cResolve = e.target.closest("[data-dem-comment-resolve]");
    if(cResolve){ resolveDemandComment(layer, id, cResolve.dataset.demCommentResolve, cResolve.dataset.demCommentResolved === "1"); return; }
    var cToTask = e.target.closest("[data-dem-comment-totask]");
    if(cToTask){ demandCommentToTask(layer, id, cToTask.dataset.demCommentTotask); return; }
    var cDel = e.target.closest("[data-dem-comment-del]");
    if(cDel){ deleteDemandComment(layer, id, cDel.dataset.demCommentDel); return; }
    if(e.target.closest("#demCommentSend")){ submitDemandComment(layer, id, "tab"); return; }
    if(e.target.closest("#demOvCommentSend")){ submitDemandComment(layer, id, "ov"); return; }
    var go = e.target.closest("[data-demand-goto]");
    if(go){ setDemandTab(go.dataset.demandGoto); return; }
    var relJump = e.target.closest("[data-dem-rel-jump]");
    if(relJump){
      setDemandTab("rel");
      var relBox = layer.querySelector(relJump.dataset.demRelJump === "docs" ? "#demDocs" : "#demAtts");
      setTimeout(function(){
        var card = relBox && relBox.closest ? relBox.closest(".read-card") : null;
        if(card){ try{ card.scrollIntoView({ block: "start" }); }catch(err){} }
      }, 60);
      return;
    }
    var casesGo = e.target.closest("[data-dem-cases]");
    if(casesGo){
      setDemandReturnOrigin(d, id);
      UI.closeModal(layer);
      import("./testcases.js").then(function(m){ m.openDemandCoverage(d.reqId, d.id); });
      return;
    }
    var statusPill = e.target.closest("#demandStatusPill");
    if(statusPill){ openDemandStatusMenu(statusPill, d); return; }
    var textEl = e.target.closest("[data-dem-text]");
    if(textEl && !textEl.isContentEditable){
      demandStartTextEdit(textEl, detailCtx, textEl.dataset.demText);
      return;
    }
    var factEl = e.target.closest("[data-dem-fact]");
    if(factEl){ openDemandFactEditor(factEl.dataset.demFact, factEl, detailCtx); return; }
    var watchBtn = e.target.closest("[data-dem-watch-btn]");
    if(watchBtn){ openDemandWatchPop(watchBtn, layer, id); return; }
    var moreBtn = e.target.closest("[data-dem-detail-more-btn]");
    if(moreBtn){ openDemandDetailMore(moreBtn, d); return; }
    /* 状态动作的子层叠在详情之上：取消回到详情，成功后由动作关闭详情 */
    var cl = e.target.closest("[data-dem-claim]"); if(cl){ claimDemandReview(cl.dataset.demClaim, cl); return; }
    var p = e.target.closest("[data-dem-pass]"); if(p){ passDemand(p.dataset.demPass); return; }
    var r = e.target.closest("[data-dem-rej]"); if(r){ rejectDemand(r.dataset.demRej); return; }
    var pl = e.target.closest("[data-dem-plan]"); if(pl){ openPlanDialog(pl.dataset.demPlan); return; }
    var ro = e.target.closest("[data-dem-reopen]"); if(ro){ reopenDemand(ro.dataset.demReopen); return; }
    var restore = e.target.closest("[data-dem-restore]"); if(restore){ restoreDemand(restore.dataset.demRestore); return; }
    var menuBtn = e.target.closest("[data-dem-menu-btn]"); if(menuBtn){ openDemandRowMenu(menuBtn, d); return; }
    var ed = e.target.closest("[data-dem-edit]");
    if(ed){ closeDemandDetailIfOpen(); setTimeout(function(){ openDemandDialog(d); }, 40); return; }
    var judge = e.target.closest("[data-dem-judge]"); if(judge){ openJudgementDialog(id); return; }
    var judgeRevoke = e.target.closest("[data-dem-judge-revoke]"); if(judgeRevoke){ revokeJudgement(id); return; }
    var aiSplit = e.target.closest("[data-dem-ai-split]");
    if(aiSplit){ runDemandAiSplit(d, layer); return; }
    var at = e.target.closest("[data-dem-addtask]");
    if(at){
      if(!canSplit){ toast("已关闭或已完成的需求不能新拆工作项", "warn"); return; }
      /* 抽屉叠在需求详情之上；关闭抽屉回到详情，关联列表随之刷新 */
      openTaskDrawer("backlog", null, {
        reqId: d.reqId, demandId: d.id, versionIds: d.status === "plan" && d.versionId ? [d.versionId] : [],
        startDate: d.plannedStart, dueDate: d.plannedEnd || d.expectDate,
        categoryId: d.categoryId || null,
        onClose: function(){ refreshDemandWork(layer, id, d.versionId); }
      });
      return;
    }
    var up = e.target.closest("[data-dem-attdrop]");
    if(up){ if(!writable){ denyDemandReadOnly(); return; } var fi = layer.querySelector("#demAttFile"); if(fi) fi.click(); return; }
    var dl = e.target.closest("[data-dem-doc-link]");
    if(dl){
      if(!writable){ denyDemandReadOnly(); return; }
      var pick = layer.querySelector("#demDocPick");
      var docId = pick && pick.value;
      if(!docId){ toast("先选择要关联的文档", "warn"); return; }
      dl.disabled = true;
      API.post("/api/demands/" + encodeURIComponent(id) + "/docs", { docId: docId }).then(function(){
        toast("已关联文档", "fs");
        loadDemandDocs(layer, id, d.reqId, writable);
      }).catch(function(ex){ dl.disabled = false; toast(ex.message || "关联失败", "bad"); });
      return;
    }
    var du = e.target.closest("[data-dem-doc-unlink]");
    if(du){
      if(!writable){ denyDemandReadOnly(); return; }
      du.disabled = true;
      API.del("/api/demands/" + encodeURIComponent(id) + "/docs/" + encodeURIComponent(du.dataset.demDocUnlink)).then(function(){
        toast("已取消关联", "fs");
        loadDemandDocs(layer, id, d.reqId, writable);
      }).catch(function(ex){ du.disabled = false; toast(ex.message || "取消失败", "bad"); });
      return;
    }
    var dop = e.target.closest("[data-dem-doc-open]");
    if(dop){
      var docIdOpen = dop.dataset.demDocOpen;
      setDemandReturnOrigin(d, id);
      UI.closeModal(layer);
      import("./requirements.js").then(function(m){ m.openReqDocAndJump(docIdOpen); });
      return;
    }
    var ot = e.target.closest("[data-open-task]");
    if(ot){
      openTaskById(ot.dataset.openTask, { onClose: function(){ refreshDemandWork(layer, id, d.versionId); } });
      return;
    }
    var pv = e.target.closest("[data-att-prev]");
    if(pv){
      e.preventDefault();
      var boxP = layer.querySelector("#demAtts");
      var attP = ((boxP && boxP.__attList) || []).find(function(a){ return a.id === pv.dataset.attPrev; })
        || findDemandCommentAtt(layer, pv.dataset.attPrev);
      if(attP) openAttPreview({ attachment: attP });
      return;
    }
    var sh = e.target.closest("[data-att-sheet]");
    if(sh){
      e.preventDefault();
      var boxS = layer.querySelector("#demAtts");
      var attS = ((boxS && boxS.__attList) || []).find(function(a){ return a.id === sh.dataset.attSheet; })
        || findDemandCommentAtt(layer, sh.dataset.attSheet);
      if(!attS) return;
      /* xls 由 SheetJS 只读解析（保存回写只支持 xlsx） */
      import("../core/sheet-viewer.js").then(function(m){
        m.openSheet({
          attachment: attS,
          canEdit: writable && /\.xlsx$/i.test(attS.filename || ""),
          onSaved: function(){ loadDemandAttachments(layer, id, writable); }
        });
      }).catch(function(ex){ toast(ex && ex.message ? ex.message : "打开表格失败", "bad"); });
      return;
    }
    var ad = e.target.closest("[data-att-del]");
    if(ad){
      if(!writable){ denyDemandReadOnly(); return; }
      UI.showConfirm({
        title: "删除附件",
        msg: "附件删除后不可恢复，确定删除？",
        okText: "删除附件"
      }).then(function(yes){
        if(!yes) return;
        ad.disabled = true;
        API.del("/api/attachments/" + encodeURIComponent(ad.dataset.attDel)).then(function(){
          toast("附件已删除", "fs");
          loadDemandAttachments(layer, id, writable);
        }).catch(function(ex){ ad.disabled = false; toast(ex.message || "删除失败", "bad"); });
      });
      return;
    }
  });
  layer.addEventListener("change", function(e){
    if(e.target && e.target.id === "demCommentUnresolved") loadDemandComments(layer, id);
  });
  if(writable){
    var mentionOpts = {
      canOpen: function(){ return layer.isConnected; },
      excludeUserId: function(){ return rt.currentUser && rt.currentUser.id; },
      loadMembers: function(){
        return API.get("/api/demands/" + encodeURIComponent(id) + "/mention-candidates");
      }
    };
    var commentInput = layer.querySelector("#demCommentInput");
    if(commentInput){
      demandCommentMention = createMentionPicker(commentInput, mentionOpts);
      layer.__commentMention = demandCommentMention;
      commentInput.addEventListener("keydown", function(e){
        if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); submitDemandComment(layer, id, "tab"); }
      });
      bindFileDrop(commentInput, function(files){ addDemandPendingFiles(layer, "tab", files); },
        { paste: true, pasteTarget: commentInput });
    }
    var ovInput = layer.querySelector("#demOvCommentInput");
    if(ovInput){
      demandOverviewMention = createMentionPicker(ovInput, mentionOpts);
      layer.__ovMention = demandOverviewMention;
      ovInput.addEventListener("keydown", function(e){
        if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); submitDemandComment(layer, id, "ov"); }
      });
      bindFileDrop(ovInput, function(files){ addDemandPendingFiles(layer, "ov", files); },
        { paste: true, pasteTarget: ovInput });
    }
    var cmtFile = layer.querySelector("#demCommentFile");
    if(cmtFile) cmtFile.addEventListener("change", function(){
      var files = cmtFile.files ? Array.prototype.slice.call(cmtFile.files) : [];
      cmtFile.value = "";
      if(files.length) addDemandPendingFiles(layer, "tab", files);
    });
    var ovFile = layer.querySelector("#demOvCommentFile");
    if(ovFile) ovFile.addEventListener("change", function(){
      var files = ovFile.files ? Array.prototype.slice.call(ovFile.files) : [];
      ovFile.value = "";
      if(files.length) addDemandPendingFiles(layer, "ov", files);
    });
    var descView = layer.querySelector("#demandDescView");
    if(descView && canEditText && !isClosedDemand(d)){
      bindFileDrop(descView, insertDemandDescImages, { paste: true, pasteTarget: descView });
      var descImgInput = layer.querySelector("#demDescImgFile");
      if(descImgInput) descImgInput.addEventListener("change", function(){
        var files = descImgInput.files ? Array.prototype.slice.call(descImgInput.files) : [];
        descImgInput.value = "";
        if(files.length) insertDemandDescImages(files);
      });
    }
  }
  function uploadDemandFiles(files){
    if(!writable){ denyDemandReadOnly(); return; }
    var box = layer.querySelector("#demAtts");
    var current = box && box.__attList ? box.__attList.length : 0;
    var res = validateFiles(files, current);
    reportRejected(res.rejected);
    if(!res.ok.length) return;
    var path = "/api/demands/" + encodeURIComponent(id) + "/attachments";
    var done = 0, failed = 0;
    var chain = Promise.resolve();
    res.ok.forEach(function(f){
      chain = chain.then(function(){
        return uploadAttachment(path, f).then(function(){ done++; }, function(){ failed++; });
      });
    });
    chain.then(function(){
      if(!layer.isConnected) return;
      if(failed) toast("上传完成：" + done + " 成功，" + failed + " 失败", "warn");
      else toast(done > 1 ? "已上传 " + done + " 个附件" : "附件已上传", "fs");
      loadDemandAttachments(layer, id, writable);
    });
  }
  var fi = layer.querySelector("#demAttFile");
  var drop = layer.querySelector("[data-dem-attdrop]");
  if(fi) fi.addEventListener("change", function(){
    var files = fi.files ? Array.prototype.slice.call(fi.files) : [];
    fi.value = "";
    if(files.length) uploadDemandFiles(files);
  });
  if(drop){
    drop.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        if(!writable){ denyDemandReadOnly(); return; }
        if(fi) fi.click();
      }
    });
    bindFileDrop(drop, uploadDemandFiles);
  }
  UI.openModal(layer, "[data-dem-x]");
  if(opts && opts.tab && layer.querySelector('[data-dem-tab="' + opts.tab + '"]')) setDemandTab(opts.tab);
  refreshDemandWork(layer, id, d.versionId);
  loadDemandDocs(layer, id, d.reqId, writable);
  loadDemandAttachments(layer, id, writable);
  loadDemandJudgements(layer, id);
  loadDemandComments(layer, id);
  loadDemandOverviewComments(layer, id);
  loadDemandWatch(layer, id);
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/logs").then(function(logs){
    var ul = layer.querySelector("#demLogs");
    var recent = layer.querySelector("#demandRecentLogs");
    var count = layer.querySelector("#tabRecordCount");
    if(count) count.textContent = logs.length ? String(logs.length) : "";
    if(ul) ul.innerHTML = logs.length ? logs.map(demandLogItemHTML).join("") : '<li class="foot-note">暂无流转记录</li>';
    if(recent) recent.innerHTML = logs.length ? logs.slice(0, 2).map(demandLogItemHTML).join("") : '<li class="read-empty">暂无记录</li>';
  }).catch(function(){
    var ul = layer.querySelector("#demLogs");
    if(ul) ul.innerHTML = '<li class="foot-note">时间线加载失败</li>';
    var recent = layer.querySelector("#demandRecentLogs");
    if(recent) recent.innerHTML = '<li class="read-empty">最近记录加载失败</li>';
  });
}

function demandLogChange(log){
  if(!log.changeData) return "";
  try{
    var data = typeof log.changeData === "string" ? JSON.parse(log.changeData) : log.changeData;
    var before = data.before || {}, after = data.after || {}, parts = [];
    /* 快照里同一空值可能是 null / undefined / 空串，直接比较会渲染出「未设置 → 未设置」这种假变更 */
    var norm = function(v){ return (v === null || v === undefined || v === "") ? "" : String(v); };
    [["reqId", "所属项目"], ["categoryId", "分类"], ["versionName", "目标版本"], ["plannedStart", "计划开始"],
      ["plannedEnd", "计划结束"], ["expectDate", "期望交付"], ["priority", "优先级"], ["status", "状态"]].forEach(function(field){
      var key = field[0], a = norm(before[key]), b = norm(after[key]);
      if(a === b) return;
      if(key === "status"){ a = a ? statusName(a) : "未设置"; b = b ? statusName(b) : "未设置"; }
      else if(key === "reqId"){ a = a ? reqNameById(a) : "未设置"; b = b ? reqNameById(b) : "未设置"; }
      else if(key === "categoryId"){ a = a ? (catNameById(a) || a) : "未设置"; b = b ? (catNameById(b) || b) : "未设置"; }
      parts.push(field[1] + "：" + (a || "未设置") + " → " + (b || "未设置"));
    });
    return parts.join("；");
  }catch(e){ return ""; }
}

/* ---------- 事件 ---------- */

if(demandReq) demandReq.addEventListener("change", function(){
  var nextReq = demandReq.value || null;
  if(nextReq !== rt.demandReqId) demSmart.cats = [];
  rt.demandReqId = nextReq;
  /* 看板选中的项目同步进列表/甘特的项目筛选，切过去时不丢范围；也随本地快照恢复 */
  demSmart.reqs = nextReq ? [nextReq] : [];
  saveDemState();
  loadDemands();
});
if($("btnDemandNew")) $("btnDemandNew").addEventListener("click", function(){
  if(!rt.reqList.length){ toast("先在「项目」里创建项目", "warn"); return; }
  openDemandDialog(null);
});
/* 需求池页头专属动作（与项目页共用 #pageActions，按各自 data-* 分发） */
if($("pageActions")) $("pageActions").addEventListener("click", function(e){
  if(e.target.closest("[data-dem-head-export]")){ exportDemCsv(); return; }
  if(e.target.closest("[data-dem-head-new]")){
    if(!rt.reqList.length){ toast("先在「项目」里创建项目", "warn"); return; }
    openDemandDialog(null);
  }
});
if($("dlgDemandX")) $("dlgDemandX").addEventListener("click", function(){ tryCloseDemandDialog(); });
if($("dlgDemand")) UI.setModalCloseGuard($("dlgDemand"), function(){ tryCloseDemandDialog(); });
/* 跨断点重排：窄屏回落卡片形态并收起形态/密度切换器，回到宽屏再恢复上次的选择 */
window.addEventListener("ds:layout", function(){
  if(!demWork.active) return;
  if(demWork.items.length) renderDemandWorkpage();
  else loadDemands();
});
window.addEventListener("ds:before-route", function(e){
  var dlg = $("dlgDemand");
  if(!dlg || !dlg.classList.contains("open")) return;
  e.preventDefault();
  var to = e.detail && e.detail.to;
  tryCloseDemandDialog(function(){
    if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
  });
});
if(btnSaveDemand) btnSaveDemand.addEventListener("click", saveDemand);
if($("demandCheckResume")) $("demandCheckResume").addEventListener("click", function(){
  setDemandCheckOff(false);
  toast("已恢复提交前体检", "fs");
});
bindDemandCheckDialog();
if(dReq) dReq.addEventListener("change", function(){
  if(editingDemandId){
    /* 编辑态换项目：原分类属于旧项目，直接回到「未分类」，由用户按新项目重选 */
    syncDemandCatOptions(dReq.value, "", false);
    /* 评审人同样按新项目重选，旧项目的人可能对新项目没有写权限 */
    syncDemandReviewerSelect("");
    return;
  }
  /* 换项目后原分类不再可选，回落到新项目第一个分类或「未分类」 */
  syncDemandCatOptions(dReq.value, dCategory.value, true);
  /* 提醒人候选取自项目花名册：换项目后旧选择可能已不可见，直接清空重选 */
  resetDemandWatchPick();
  syncDemandWatchPicker();
  syncDemandReviewerSelect("");
});
if($("dlgDemand")) $("dlgDemand").addEventListener("click", function(e){
  var rm = e.target.closest("[data-dem-form-watch-remove]");
  if(rm){
    var uid = rm.dataset.demFormWatchRemove;
    demandWatchPick = demandWatchPick.filter(function(w){ return w.userId !== uid; });
    renderDemandWatchChips();
    syncDemandWatchPicker();
    return;
  }
  var add = e.target.closest("[data-dem-form-watch-add]");
  if(add){
    if(add.disabled) return;
    var sel = $("dlgDemand").querySelector("[data-dem-form-watch-select]");
    var pickId = sel && sel.value;
    if(!pickId){ toast("先选择要添加的成员", "warn"); return; }
    if(demandWatchPick.some(function(w){ return w.userId === pickId; })) return;
    var opt = sel.options[sel.selectedIndex];
    demandWatchPick.push({ userId: pickId, name: opt ? opt.text : pickId });
    renderDemandWatchChips();
    syncDemandWatchPicker();
  }
});
if(dTitle) dTitle.addEventListener("input", function(){ fDemandTitle.classList.remove("invalid"); });
/* 描述：可粘贴/拖入图片；图片选中后可拖动右下角等比缩放，宽度写进描述标记 */
if(dDesc){
  demandBindInlineImageResize(dDesc);
  bindFileDrop($("fDemandDesc") || dDesc, demandInsertFormFigures, { paste:true, pasteTarget:dDesc });
  dDesc.addEventListener("input", demandUpdateDescCount);
}
/* 表单附件：只收集待传文件，提交成功后再挂到需求上 */
if($("fDemandAttsMount")){
  demandAttKit = createAttachKit({
    mount: $("fDemandAttsMount"),
    compact: true,
    label: "点击选择附件"
  });
}
if($("dDescImgBtn") && $("dDescImgFile")){
  $("dDescImgBtn").addEventListener("click", function(){ $("dDescImgFile").click(); });
  $("dDescImgFile").addEventListener("change", function(){
    var input = $("dDescImgFile");
    if(input.files && input.files.length) demandInsertFormFigures(Array.prototype.slice.call(input.files));
    input.value = "";
  });
}
if($("segDemandPri")) $("segDemandPri").addEventListener("click", function(e){
  var b = e.target.closest("[data-dpri]");
  if(!b) return;
  formPri = b.dataset.dpri;
  syncPriSeg();
});
[dWsjfB, dWsjfU, dWsjfR, dWsjfE].forEach(function(el){
  if(el) el.addEventListener("input", syncWsjfLive);
});
if($("dlgDemandPlanX")) $("dlgDemandPlanX").addEventListener("click", function(){ UI.closeModal($("dlgDemandPlan")); });
if(btnDoPlan) btnDoPlan.addEventListener("click", doPlan);
if(dpVersion) dpVersion.addEventListener("change", loadPlanTaskCandidates);
if(dpTaskToggle) dpTaskToggle.addEventListener("change", syncPlanTaskUI);
if(dpTaskExpandBtn) dpTaskExpandBtn.addEventListener("click", function(){
  if(!dpTaskPicker) return;
  var open = dpTaskPicker.hidden;
  dpTaskPicker.hidden = !open;
  dpTaskExpandBtn.setAttribute("aria-expanded", open ? "true" : "false");
  dpTaskExpandBtn.textContent = open ? "收起" : "展开选择";
  if(open && dpTaskSearch) dpTaskSearch.focus();
});
if(dpTaskSearch) dpTaskSearch.addEventListener("input", function(){
  planTaskState.query = dpTaskSearch.value;
  filterPlanTaskRows();
  syncPlanTaskUI();
});
if(dpTaskList) dpTaskList.addEventListener("change", function(e){
  var cb = e.target.closest("[data-dp-task-check]");
  if(!cb) return;
  planTaskState.selected[cb.getAttribute("data-dp-task-check")] = cb.checked;
  syncPlanTaskUI();
});
if($("demandModeSeg")) $("demandModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-dem-mode]");
  if(!b) return;
  switchDemandMode(b.dataset.demMode);
});
/* 甘特「?」：解释七个阶段的口径、缺口与时间范围；工具条与图例两个入口共用 */
var demandGanttHelpPop = null;
function openDemandGanttHelp(anchor){
  if(!anchor) return;
  if(UI.popOpen(demandGanttHelpPop)){ UI.closeAllPops(); return; }
  var el = document.createElement("div");
  el.className = "menu popover type-help-pop demg-help-pop";
  el.innerHTML = demandGanttInfoHTML();
  demandGanttHelpPop = el;
  UI.openPop(el, anchor, { align:"right", width:Math.max(300, Math.min(460, window.innerWidth - 16)), onClose:function(){ el.remove(); demandGanttHelpPop = null; } });
}
if(demandGanttHelp){
  demandGanttHelp.innerHTML = icon("helpCircle", 13);
  demandGanttHelp.addEventListener("click", function(){ openDemandGanttHelp(demandGanttHelp); });
}
if($("btnDemandColumns")) $("btnDemandColumns").addEventListener("click", function(){
  listPrefs.openColumnSettings("demand-pool", function(){ render(); });
});
if(demandGanttBar){
  demandGanttBar.addEventListener("change", function(e){
    var sc = e.target.closest("[data-demg-scale]");
    if(sc){
      if(["day", "week", "month"].indexOf(sc.value) === -1) return;
      demGantt.scale = sc.value;
      render();
      saveDemState();
      return;
    }
    var zm = e.target.closest("[data-demg-zoom]");
    if(zm){
      var zoom = Number(zm.value);
      if([20, 28, 40].indexOf(zoom) === -1) return;
      demGantt.zoomDayW = zoom;
      demGantt.scrolled = false;
      render();
      saveDemState();
      return;
    }
    var rg = e.target.closest("[data-demg-range]");
    if(rg){
      if(["auto", "month"].indexOf(rg.value) === -1) return;
      demGantt.rangeMode = rg.value;
      if(rg.value === "month"){
        if(!demGantt.anchorMonth) demGantt.anchorMonth = demgMonthStart(rt.TODAY);
        demGantt.scrollLeft = 0;
      }else{
        demGantt.scrolled = false;
      }
      render();
      saveDemState();
    }
  });
  demandGanttBar.addEventListener("click", function(e){
    if(e.target.closest("[data-demg-prev]")){ demgShiftMonth(-1); saveDemState(); return; }
    if(e.target.closest("[data-demg-next]")){ demgShiftMonth(1); saveDemState(); return; }
    if(e.target.closest("[data-demg-today]")){
      demGantt.anchorMonth = demgMonthStart(rt.TODAY);
      if(demGantt.rangeMode === "month") render();
      else demgScrollToToday();
    }
  });
}
if(demandBody) demandBody.addEventListener("click", function(e){
  var back = e.target.closest("[data-dem-work-back]");
  if(back){ returnDemandBoard(); return; }
  var ws = e.target.closest("[data-dem-work-status]");
  if(ws){ openDemandWorkpage(ws.dataset.demWorkStatus, "all"); return; }
  var wst = e.target.closest("[data-dem-work-stage]");
  if(wst){
    demWork.stage = wst.dataset.demWorkStage;
    try{ history.pushState(null, "", demandWorkHash(demWork.status, demWork.stage)); }
    catch(ex){ window.location.hash = demandWorkHash(demWork.status, demWork.stage); }
    loadDemands();
    return;
  }
  var wr = e.target.closest("[data-dem-work-reset]");
  if(wr){ resetDemWorkFilters(); return; }
  var wl = e.target.closest("[data-dem-work-layout]");
  if(wl){ setDemWorkLayout(wl.dataset.demWorkLayout); return; }
  var ws = e.target.closest("[data-dem-work-sort]");
  if(ws){
    if(demWork.active && demWork.sort !== ws.dataset.demWorkSort){
      demWork.sort = ws.dataset.demWorkSort;
      loadDemands();
    }
    return;
  }
  var wm = e.target.closest("[data-dem-work-more]");
  if(wm){ loadMoreDemandWorkpage(); return; }
  var open = e.target.closest("[data-dem-open]");
  if(open){ openDemandWorkpage(open.dataset.demOpen, open.dataset.demStage || "all"); return; }
  if(e.target.closest("[data-demb-stage-clear]")){
    demBoardStage = "all";
    saveDemState();
    loadDemands();
    return;
  }
  var dh = e.target.closest("[data-demg-help]");
  if(dh){ openDemandGanttHelp(dh); return; }
  var dm = e.target.closest("[data-dem-more]");
  if(dm){
    if(dm.dataset.demMore === "table") loadMoreDemandTable();
    else if(dm.dataset.demMore === "gantt") loadMoreDemandGantt();
    else loadMoreDemandColumn(dm.dataset.demMore);
    return;
  }
  var st = e.target.closest("[data-dem-subgroup-toggle]");
  if(st){
    var skey = "$sub:" + st.dataset.demSubgroupToggle;
    demSmart.collapsed[skey] = !demSmart.collapsed[skey];
    render();
    return;
  }
  var gt = e.target.closest("[data-dem-group-toggle]");
  if(gt){
    var gkey = "$" + gt.dataset.demGroupToggle;
    demSmart.collapsed[gkey] = !demSmart.collapsed[gkey];
    render();
    return;
  }
  var im = e.target.closest("[data-dem-inline-menu]");
  if(im){ openDemInlineMenu(im); return; }
  var sb = e.target.closest("[data-dem-source-btn]");
  if(sb){ startDemSourceEdit(sb); return; }
  var dt = e.target.closest("[data-dem-detail]");
  if(dt){ showDemandDetail(dt.dataset.demDetail); return; }
  var restore = e.target.closest("[data-dem-restore]");
  if(restore){ restoreDemand(restore.dataset.demRestore); return; }
  var mb = e.target.closest("[data-dem-menu-btn]");
  if(mb){ openDemandRowMenu(mb, findDemand(mb.dataset.demMenuBtn)); return; }
  var cl = e.target.closest("[data-dem-claim]");
  if(cl){ claimDemandReview(cl.dataset.demClaim, cl); return; }
  var p = e.target.closest("[data-dem-pass]");
  if(p){ passDemand(p.dataset.demPass); return; }
  var r = e.target.closest("[data-dem-rej]");
  if(r){ rejectDemand(r.dataset.demRej); return; }
  var pl = e.target.closest("[data-dem-plan]");
  if(pl){ openPlanDialog(pl.dataset.demPlan); return; }
  var ro = e.target.closest("[data-dem-reopen]");
  if(ro){ reopenDemand(ro.dataset.demReopen); return; }
  var ed = e.target.closest("[data-dem-edit]");
  if(ed){ openDemandDialog(findDemand(ed.dataset.demEdit)); return; }
  var dl = e.target.closest("[data-dem-del]");
  if(dl){ deleteDemand(dl.dataset.demDel); return; }
  /* 整卡可点开详情；卡片上的按钮/菜单/输入仍走各自的处理 */
  var card = e.target.closest("[data-dem-card]");
  if(card && !e.target.closest("button,a,input,select,textarea,label,[contenteditable='true']")){
    showDemandDetail(card.dataset.demCard);
  }
});
/* 列表形态的行可键盘打开，与鼠标点击同一入口 */
if(demandBody){
  demandBody.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest(".dem-work-row[data-dem-card]");
    if(!row || e.target.closest("button,a,input,select,textarea")) return;
    e.preventDefault();
    showDemandDetail(row.dataset.demCard);
  });
}
if(demandBody){
  demandBody.addEventListener("change", function(e){
    var boardStage = e.target.closest("[data-demb-stage]");
    if(boardStage){
      demBoardStage = boardStage.value === "all" || DELIVERY_STAGES.some(function(s){ return s[0] === boardStage.value; }) ? boardStage.value : "all";
      saveDemState();
      loadDemands();
      return;
    }
    var filter = e.target.closest("[data-dem-work-filter]");
    if(!filter || !demWork.active) return;
    var key = filter.dataset.demWorkFilter, value = filter.value;
    if(key === "reqId") demWork.reqId = value === "all" ? null : value;
    else if(key === "priority") demWork.pris = value === "all" ? [] : [value];
    else if(key === "group") demWork.group = value;
    else if(key === "sort") demWork.sort = value;
    else if(key === "versionId" || key === "closeReason" || key === "closeStage" || key === "focus") demWork[key] = value;
    else return;
    if(key === "group") render(); else loadDemands();
  });
  demandBody.addEventListener("input", function(e){
    var q = e.target.closest("[data-dem-work-q]");
    if(!q || !demWork.active) return;
    if(demWork.timer) clearTimeout(demWork.timer);
    demWork.timer = setTimeout(function(){
      demWork.timer = null;
      demWork.q = q.value.trim();
      loadDemands();
    }, 300);
  });
}

/* ---------- 卡片拖动：跨列状态流转（项目写权限；状态机同按钮） ---------- */

function allowedDrop(from, to, canSchedule){
  if(from === "review") return to === "pass" || to === "closed";
  if(from === "pass") return (to === "plan" && canSchedule) || to === "review";
  if(from === "plan") return to === "pass" && canSchedule;
  return false;
}
function clearColOver(){
  demandBody.querySelectorAll(".bkl-col").forEach(function(c){
    c.classList.remove("bkl-col-over");
    c.classList.remove("bkl-col-can");
    c.classList.remove("bkl-col-no");
  });
}
/* 拖动一开始就把所有合法目标列点亮，避免长距离拖动时误以为不支持 */
function markCanDrop(from, canSchedule){
  demandBody.querySelectorAll(".bkl-col").forEach(function(c){
    if(allowedDrop(from, c.dataset.col, canSchedule)) c.classList.add("bkl-col-can");
  });
}
/* 不合法落点给出明确文案，而不是静默吞掉 */
function dropDenied(status, to, canSchedule){
  if(to === "done"){
    toast("「已完成」由工作项全部完成与用例全部通过自动判定，不能手动拖入；请补齐工作项与用例", "warn");
  }else if((status === "plan" || status === "pass") && to === "closed"){
    toast("请先使用「更多 → 关闭需求」选择中途取消或重复需求并填写原因", "warn");
  }else if(to){
    toast("「" + statusName(status) + "」不能拖到「" + statusName(to) + "」：" + (dragHint(status, canSchedule) || "请按状态流转规则操作"), "warn");
  }else{
    toast(dragHint(status, canSchedule), "warn");
  }
}
function applyDrop(src, to){
  if(src.status === "review" && to === "closed"){ rejectDemand(src.id); }
  else if(src.status === "review" && to === "pass"){ passDemand(src.id); }
  else if(src.status === "pass" && to === "plan"){ openPlanDialog(src.id); }
  else if(src.status === "pass" && to === "review"){ unpassDemand(src.id); }
  else if(src.status === "plan" && to === "pass"){ unplanDemand(src.id); }
}
if(demandBody){
  demandBody.addEventListener("dragstart", function(e){
    var card = e.target.closest(".bkl-card");
    var d = card ? findDemand(card.dataset.cardId) : null;
    if(!canReviewDemand(d)) return;
    dragSrc = { id: card.dataset.cardId, status: card.dataset.cardStatus, canSchedule: canScheduleDemand(d) };
    dragOverCol = null;
    e.dataTransfer.setData("text/plain", dragSrc.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("bkl-dragging");
    markCanDrop(dragSrc.status, dragSrc.canSchedule);
  });
  demandBody.addEventListener("dragover", function(e){
    if(!dragSrc) return;
    var col = e.target.closest(".bkl-col");
    demandBody.querySelectorAll(".bkl-col-over,.bkl-col-no").forEach(function(c){
      c.classList.remove("bkl-col-over");
      c.classList.remove("bkl-col-no");
    });
    dragOverCol = col ? col.dataset.col : null;
    if(!col) return;
    /* 非法列也要 preventDefault：否则 drop 不触发，用户得不到“为什么不让我放”的提示 */
    e.preventDefault();
    if(!allowedDrop(dragSrc.status, col.dataset.col, dragSrc.canSchedule)){
      col.classList.add("bkl-col-no");
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    col.classList.add("bkl-col-over");
  });
  demandBody.addEventListener("drop", function(e){
    var col = e.target.closest(".bkl-col");
    clearColOver();
    if(!dragSrc || !col) return;
    var src = dragSrc;
    dragSrc = null;
    dragOverCol = null;
    if(!allowedDrop(src.status, col.dataset.col, src.canSchedule)){ dropDenied(src.status, col.dataset.col, src.canSchedule); return; }
    e.preventDefault();
    applyDrop(src, col.dataset.col);
  });
  demandBody.addEventListener("dragend", function(e){
    clearColOver();
    var card = e.target.closest(".bkl-card");
    if(card) card.classList.remove("bkl-dragging");
    /* 某些浏览器在非法落点不派发 drop：dragend 兜底，保证用户始终拿到原因 */
    if(dragSrc && dragOverCol && !allowedDrop(dragSrc.status, dragOverCol, dragSrc.canSchedule)){
      dropDenied(dragSrc.status, dragOverCol, dragSrc.canSchedule);
    }
    dragSrc = null;
    dragOverCol = null;
  });
}

function openDemandById(id){
  return API.get("/api/demands/" + encodeURIComponent(id)).then(function(d){
    openDemandDialog(d);
    return true;
  }).catch(function(ex){
    toast(ex.message || "需求不存在或无权查看", "warn");
    return false;
  });
}

/* 只读详情入口：供用例覆盖矩阵等外部视图跳转，查看者 / 无写权限也能打开 */
function openDemandDetailById(id){
  return showDemandDetail(id);
}

/* ---------------------------------------------------------------------------
 * 任务抽屉「关联需求」下拉（iDemand）
 * 层次口径与后端 applyRequest 一致：需求必须属于任务所选项目；
 * 未选项目时可从全空间挑选，选中后由抽屉自动带出需求所属项目。
 * --------------------------------------------------------------------------- */
var drawerDemandOpts = { reqId: null, list: [], total: 0, error: null };
/* 关联需求候选排序：越接近可执行越靠前；已关闭只保留原关联 */
var DEMAND_OPTION_RANK = { plan: 0, pass: 1, review: 2, done: 3, closed: 4, rej: 5, canceled: 5 };
function demandOptionRank(st){
  var r = DEMAND_OPTION_RANK[st];
  return r === undefined ? 9 : r;
}
function drawerDemandStatusLabel(st){
  for(var i = 0; i < COLS.length; i++){
    if(COLS[i][0] === st) return COLS[i][1];
  }
  return "";
}
function fillDrawerDemandSelect(reqId, keep){
  var sel = $("iDemand");
  if(!sel || sel.dataset.demandReq !== reqId) return;
  if(($("iReq") ? $("iReq").value : "") !== reqId) return;
  if(drawerDemandOpts.error){
    if(keep){
      sel.innerHTML = '<option value="' + esc(keep) + '">原关联需求（列表加载失败，已保留）</option>';
      sel.value = keep;
    }else{
      sel.innerHTML = '<option value="">需求列表加载失败，暂无法选择（可重试）</option>';
      sel.value = "";
    }
    sel.setAttribute("data-ready", "1");
    syncAssocViewBtns();
    syncAssocRead();
    return;
  }
  var html = '<option value="">不关联</option>';
  var matched = false;
  var list = (drawerDemandOpts.list || []).slice().sort(function(a, b){
    return demandOptionRank(a.status) - demandOptionRank(b.status);
  });
  list.forEach(function(d){
    var on = d.id === keep;
    // 已有关联可保留；已关闭、已完成需求不再作为新工作项的候选
    if((isClosedDemand(d) || d.status === "done") && !on) return;
    if(on) matched = true;
    var tag = drawerDemandStatusLabel(d.status);
    if((d.status === "plan" || d.status === "done") && d.versionStatus === "released") tag = tag ? tag + " · 已发布" : "已发布";
    html += '<option value="' + esc(d.id) + '" data-req="' + esc(d.reqId || "") + '" data-status="' + esc(d.status || "") + '">'
      + esc(d.title) + (tag ? "（" + esc(tag) + "）" : "") + '</option>';
  });
  /* 编辑时原关联可能不在本项目候选里（已删除 / 跨项目存量关联 / 超出候选页）：
     保留原值展示，保存时按原关联提交。跨项目存量关联后端已放宽，不再静默解绑。
     这里不能伪造 data-req，否则切换项目会自动跟随一个并不存在的归属。 */
  if(keep && !matched){
    html += '<option value="' + esc(keep) + '">原关联需求（未在当前候选列表，保留原关联）</option>';
    matched = true;
  }
  if(drawerDemandOpts.total > drawerDemandOpts.list.length){
    html += '<option value="" disabled>仅显示前 ' + drawerDemandOpts.list.length + ' 条，共 ' + drawerDemandOpts.total + ' 条</option>';
  }
  sel.innerHTML = html;
  sel.value = keep || "";
  sel.setAttribute("data-ready", "1");
  /* 需求目标常先于本列表返回：就绪后补一次真实标题，替换占位选项 */
  syncDemandLabelFromCache();
  syncAssocViewBtns();
  syncAssocRead();
}
function ensureDemandOptions(keep, reqId){
  var sel = $("iDemand");
  if(!sel) return;
  var want = reqId || "";
  sel.dataset.demandReq = want;
  if(drawerDemandOpts.reqId === want && (drawerDemandOpts.list.length || drawerDemandOpts.error)){
    fillDrawerDemandSelect(want, keep);
    return;
  }
  if(drawerDemandOpts.reqId === want && drawerDemandOpts.loading){
    drawerDemandOpts.keep = keep;
    drawerDemandOpts.formSeq = rt.taskFormSeq;
    return;
  }
  var request = {reqId:want, list:[], total:0, error:null, keep:keep, formSeq:rt.taskFormSeq};
  drawerDemandOpts = request;
  sel.removeAttribute("data-ready");
  sel.innerHTML = '<option value="">需求加载中…</option>';
  sel.value = "";
  syncAssocViewBtns();
  request.loading = API.get("/api/demands/page", {
    reqId: want || null, offset: 0, limit: DEMAND_TABLE_PAGE, sort: "created"
  }).then(function(page){
    if(drawerDemandOpts !== request) return;
    request.list = page.items || [];
    request.total = page.total || 0;
    request.loading = null;
    if(request.formSeq === rt.taskFormSeq) fillDrawerDemandSelect(want, request.keep);
  }).catch(function(ex){
    if(drawerDemandOpts !== request) return;
    request.error = ex || new Error("需求候选加载失败");
    request.loading = null;
    if(request.formSeq === rt.taskFormSeq) fillDrawerDemandSelect(want, request.keep);
  });
}

/* AI 拆需求：弹窗是常驻骨架，按钮只绑一次 */
function bindDemandAiDialog(){
  var dlg = $("dlgDemandAiSplit");
  if(!dlg) return;
  $("dlgDemandAiSplitX").addEventListener("click", function(){ UI.closeModal(dlg); });
  $("dlgDemandAiSplitCancel").addEventListener("click", function(){ UI.closeModal(dlg); });
  $("dlgDemandAiSplitOk").addEventListener("click", applyDemandAiSplit);
  $("demandAiSplitList").addEventListener("change", function(e){
    var cb = e.target.closest("input[type=checkbox]");
    if(!cb) return;
    var item = cb.closest(".ai-item");
    if(item) item.classList.toggle("on", cb.checked);
  });
}
bindDemandAiDialog();

export { enterDemandsView, ensureDemandOptions, loadDemands, openDemandById, openDemandDetailById, openDemandVersionBackfill, openDemandsForReq, render };
