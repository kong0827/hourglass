/* views/demands · 需求池：评审状态机看板（待评审 → 已通过 → 已排期；拒绝可重新打开） */

import { API } from "../core/api.js";
import { openAttPreview, previewable } from "../core/att-preview.js";
import { $ } from "../core/dom.js";
import { loadViews, savedViewsFor } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { MOBILE_APPROVALS } from "../core/mobile-rules.js";
import * as listPrefs from "../core/list-preferences.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocViewBtns } from "../core/task-drawer.js";
import { canEditReq, reqNameById, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { colName, docTypeName, fmtMinutesShort, fmtSize, fmtTs, priColor, priName, priTagHTML, typeBadgeHTML } from "../lib/format.js";
import { GS } from "../lib/gantt-shared.js";
import { triggerDownload } from "../lib/download.js";
import { loadReqs } from "./board.js";

var demandReq = $("demandReq"), demandsMeta = $("demandsMeta"), demandBody = $("demandBody"),
    demandGanttBar = $("demandGanttBar"), demandsPage = $("demandsPage"),
    dReq = $("dReq"), dTitle = $("dTitle"), dDesc = $("dDesc"), dAccept = $("dAccept"),
    dSource = $("dSource"), dKind = $("dKind"), dExpect = $("dExpect"),
    dWsjfB = $("dWsjfB"), dWsjfU = $("dWsjfU"), dWsjfR = $("dWsjfR"), dWsjfE = $("dWsjfE"),
    fDemandTitle = $("fDemandTitle"), btnSaveDemand = $("btnSaveDemand"), demandFormTitle = $("demandFormTitle"),
    dpVersion = $("dpVersion"), dpNote = $("dpNote"), fDemandPlanVer = $("fDemandPlanVer"), btnDoPlan = $("btnDoPlan");

var COLS = [
  ["review", "待评审", "var(--text-3)"],
  ["pass", "已通过", "var(--info)"],
  ["plan", "已排期", "var(--success)"],
  ["rej", "已拒绝", "var(--danger)"]
];
var PRI_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
var STATUS_ORDER = { review: 0, pass: 1, plan: 2, rej: 3 };
/* P0 的排序值是 0，不能用 || 兜底，否则会被当成最低优先级 */
function priRank(p){ return PRI_ORDER[p] === undefined ? 9 : PRI_ORDER[p]; }
var demands = [];
var demandBoard = null;        /* 看板：{status: {items, matched, hasMore}} */
var demandColExtra = {};       /* 看板列已滚动加载的追加条目 */
var demandTotal = 0;           /* 列表模式：当前筛选下的总数 */
var demandHasMore = false;
var demandServerFiltered = false;
var DEMAND_BOARD_PAGE = 50;
var DEMAND_TABLE_PAGE = 100;
var DEMAND_GANTT_PAGE = 100;
var DEMAND_GANTT_MAX_DAYS = 730;
var DEM_STAGE_ORDER = ["review", "plan", "design", "dev", "test", "complete", "release"];
var DEM_STAGE_NAMES = { review:"评审", plan:"排期", design:"设计", dev:"开发", test:"测试", complete:"完成", release:"发布" };
var DEM_STAGE_COLORS = { review:"var(--text-3)", plan:"var(--info)", design:"var(--plum)", dev:"var(--primary)", test:"var(--warning)", complete:"var(--success)", release:"var(--success)" };
var demGantt = { scale:"day", zoomDayW:28, rangeMode:"auto", anchorMonth:null, range:null, dayW:28, scrollLeft:0, scrolled:false, notice:"" };
var versions = [];           /* 当前项目的版本（目标版本展示/排期选择） */
var versionNames = {};       /* 列表模式：全空间 versionId → 名称 */
var editingDemandId = null;
var planDemandId = null;
var formPri = "P2";
var dragSrc = null;           /* 拖动中的卡片 { id, status }，仅空间主可拖 */
/* 项目页「查看需求池」的跨视图定位参数；enterDemandsView 应用后清空 */
var pendingFocusReq = null;

function isOwner(){ return !!(rt.currentWs && rt.currentWs.myRole === "owner"); }
/* 需求写权限跟随所属项目：成员在只读项目下不显示/不放行任何写入口 */
function canWriteDemand(d){ return !!d && canEditReq(d.reqId); }
function denyDemandReadOnly(){ toast("你对该项目只有查看权限", "warn"); }
function writableReqs(){ return rt.reqList.filter(function(r){ return canEditReq(r.id); }); }
function statusName(st){
  for(var i = 0; i < COLS.length; i++) if(COLS[i][0] === st) return COLS[i][1];
  return st;
}
function versionName(id){
  if(!id) return "";
  for(var i = 0; i < versions.length; i++) if(versions[i].id === id) return versions[i].name;
  return versionNames[id] || "";
}
function demandVersionName(d){
  return d && (d.versionName || versionName(d.versionId)) || "";
}
function wsjfText(d){
  if(d.wsjfScore === null || d.wsjfScore === undefined) return "";
  return "WSJF " + (Math.round(d.wsjfScore * 10) / 10);
}

/* ---------- 加载 ---------- */

function syncReqSel(){
  if(!demandReq) return;
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === rt.demandReqId; });
  demandReq.innerHTML = list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
  if(!rt.demandReqId && list.length) rt.demandReqId = list[0].id;
  if(rt.demandReqId) demandReq.value = rt.demandReqId;
}
var demandLoadSeq = 0;
function loadDemands(){
  var seq = ++demandLoadSeq;
  var mode = listPrefs.viewMode("demand-pool");
  syncModeUI(mode);
  if(mode === "gantt"){ loadDemandGantt(); return; }
  if(mode === "table"){ loadAllDemands(); return; }
  if(!rt.demandReqId || !rt.reqList.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"先在「项目」里创建项目，需求池按项目收纳需求。"
    });
    if(demandsMeta) demandsMeta.textContent = "";
    return;
  }
  var reqId = rt.demandReqId;
  var wsId = rt.currentWs && rt.currentWs.id;
  if(demandsMeta) demandsMeta.textContent = reqNameById(rt.demandReqId);
  demandBody.innerHTML = UI.skeletonRows(2);
  Promise.all([
    API.get("/api/demands/board", { reqId: reqId, limit: DEMAND_BOARD_PAGE }),
    API.get("/api/versions", { reqId: reqId })
  ]).then(function(rs){
    if(seq !== demandLoadSeq || rt.demandReqId !== reqId) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    if(listPrefs.viewMode("demand-pool") !== "board") return;
    demandBoard = rs[0].columns || {};
    demandServerFiltered = false;
    demandColExtra = {};
    demands = [];
    COLS.forEach(function(c){
      var col = demandBoard[c[0]];
      if(col) demands = demands.concat(col.items || []);
    });
    versions = rs[1];
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
/* 供项目页等外部视图跳转：进入需求池并定位到指定项目（看板模式选项目、列表模式带项目筛选） */
function openDemandsForReq(reqId){
  pendingFocusReq = reqId || null;
}
function enterDemandsView(){
  initDemSmartBar();
  restoreDemState();
  /* 项目页「查看需求池」携带的项目定位：恢复本地视图状态后应用，避免被快照覆盖 */
  if(pendingFocusReq){
    rt.demandReqId = pendingFocusReq;
    demSmart.reqs = [pendingFocusReq];
    saveDemState();
    pendingFocusReq = null;
  }
  syncDemControls();
  loadViews().then(renderDemTabs);
  listPrefs.load("demand-pool").then(function(){
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
function loadAllDemands(){
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
  demandBody.innerHTML = UI.skeletonRows(2);
  demandServerFiltered = true;
  demandBoard = null;
  demands = [];
  demandTotal = 0;
  demandHasMore = false;
  API.get("/api/demands/page", demandPageParams(0, DEMAND_TABLE_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    demands = (page.items || []).slice();
    demandTotal = page.total || 0;
    demandHasMore = !!page.hasMore;
    versions = [];
    if(listPrefs.viewMode("demand-pool") !== "table") return;
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
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
    limit: DEMAND_BOARD_PAGE
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
  /* 需求排期会改变版本的「待规划需求」统计，这里只重拉需求与版本名 */
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
function loadDemandGantt(){
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
  demandBody.innerHTML = UI.skeletonRows(3);
  demandServerFiltered = true;
  demandBoard = null;
  demands = [];
  demandTotal = 0;
  demandHasMore = false;
  API.get("/api/demands/gantt", demandPageParams(0, DEMAND_GANTT_PAGE)).then(function(page){
    if(seq !== demandLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    demands = [];
    mergeGanttItems(page.items);
    demandTotal = page.total || 0;
    demandHasMore = !!page.hasMore;
    if(listPrefs.viewMode("demand-pool") !== "gantt") return;
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
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(demandReq) demandReq.hidden = mode !== "board";
  var bc = $("btnDemandColumns");
  if(bc) bc.hidden = mode !== "table";
  /* 智能视图条承载搜索/筛选/分组/排序：列表与甘特共用，看板保持评审状态机原貌 */
  if(demSmartBar) demSmartBar.hidden = mode === "board";
  if(demandGanttBar) demandGanttBar.hidden = mode !== "gantt";
  if(demandsPage){
    demandsPage.classList.toggle("dem-gantt", mode === "gantt");
    var vw = demandsPage.closest(".view");
    if(vw) vw.classList.toggle("is-dem-gantt", mode === "gantt");
  }
  if(demandBody) demandBody.classList.toggle("demg-body", mode === "gantt");
  /* 只读项目不显示「提需求」；列表/甘特为全空间，只要有一个可写项目即可 */
  var bn = $("btnDemandNew");
  if(bn) bn.style.display = (writableReqs().length && (mode !== "board" || canEditReq(rt.demandReqId))) ? "" : "none";
  syncDemGanttControls();
}
function render(){
  var mode = listPrefs.viewMode("demand-pool");
  syncModeUI(mode);
  if(mode === "gantt"){ renderDemandGantt(); return; }
  if(mode === "table"){ renderDemandTable(); return; }
  if(demandsMeta){
    var total = 0;
    COLS.forEach(function(c){
      var col = demandBoard && demandBoard[c[0]];
      if(col) total += col.matched || 0;
    });
    demandsMeta.textContent = reqNameById(rt.demandReqId) + (total ? (" · 共 " + total + " 条") : "");
  }
  if(!demands.length && !versions.length && !demandBoard){
    demandBody.innerHTML = UI.emptyState({
      icon:"inbox", title:"需求池还是空的",
      text:"点右上角「提需求」录入第一条；评审通过后排期到版本。"
    });
    return;
  }
  demandBody.innerHTML = '<div class="bkl">' + COLS.map(function(c){
    var col = (demandBoard && demandBoard[c[0]]) || {items:[], matched:0, hasMore:false};
    var extra = demandColExtra[c[0]] || [];
    var items = (col.items || []).concat(extra);
    var more = col.hasMore
      ? '<button class="bkl-more" type="button" data-dem-more="' + esc(c[0]) + '">加载更多（还有 '
        + Math.max((col.matched || 0) - items.length, 0) + ' 条）</button>'
      : "";
    return '<div class="bkl-col" data-col="' + c[0] + '"><div class="bkl-head"><span class="bkl-title">'
      + '<span class="pdot" style="background:' + c[2] + '"></span>' + c[1] + '</span>'
      + '<span class="bkl-count">' + (col.matched || 0) + '</span></div>'
      + (items.map(cardHTML).join("") || '<p class="foot-note" style="padding:10px 2px">暂无需求</p>')
      + more
      + '</div>';
  }).join("") + '</div>';
}
/* 行内只保留当前状态的主操作，其余动作收进“更多”，删除仍走危险色与确认 */
function demandMenuItems(d){
  if(!isOwner()) return [];
  var out = [];
  if(d.status === "review"){
    out.push({ act: "rej", label: "拒绝" });
    out.push({ act: "edit", label: "编辑" });
  }
  if(d.status === "pass") out.push({ act: "unpass", label: "撤回评审" });
  if(d.status === "plan") out.push({ act: "unplan", label: "撤销排期" });
  out.push({ act: "del", label: "删除", danger: true });
  return out;
}
function demandActs(d, opts){
  /* 列表行里主按钮只保留页头「提需求」一个；行内动作降为普通按钮，避免整屏都是主色 */
  var cls = (opts && opts.subtle) ? "btn sm" : "btn sm primary";
  var acts = "";
  if(isOwner()){
    if(d.status === "review"){
      acts += '<button class="' + cls + '" type="button" data-dem-pass="' + esc(d.id) + '">通过</button>';
    }
    if(d.status === "pass"){
      acts += '<button class="' + cls + '" type="button" data-dem-plan="' + esc(d.id) + '">排期进入版本</button>';
    }
    if(d.status === "rej"){
      acts += '<button class="btn sm" type="button" data-dem-reopen="' + esc(d.id) + '">重新打开</button>';
    }
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
    else if(b.dataset.demMenu === "edit") openDemandDialog(d);
    else if(b.dataset.demMenu === "del") deleteDemand(d.id);
  });
  var first = menu.querySelector(".menu-item");
  if(first){ try{ first.focus(); }catch(e){ /* noop */ } }
}
function dragHint(status){
  if(status === "review") return "可拖到「已通过」或「已拒绝」";
  if(status === "pass") return "可拖到「已排期」选择目标版本，或拖回「待评审」撤回";
  if(status === "rej") return "可拖回「待评审」重新打开";
  if(status === "plan") return "可拖回「已通过」撤销排期";
  return "拖到其他列流转状态";
}
function cardHTML(d, opts){
  var acts = demandActs(d);
  /* 手机列表没有拖拽落点，卡片不挂 draggable，避免长按误触发拖动 */
  var drag = (isOwner() && !(opts && opts.noDrag))
    ? ' draggable="true" data-card-id="' + esc(d.id) + '" data-card-status="' + esc(d.status) + '" title="' + esc(dragHint(d.status)) + '"'
    : "";
  return '<div class="bkl-card"' + drag + '>'
    + '<div class="bkl-tags"><span class="tag ghost">' + esc(d.itemKind || "其他") + '</span>'
    + priTagHTML(d.priority || "P2") + '</div>'
    + '<button class="link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>'
    + (d.description ? '<p class="bkl-desc">' + esc(d.description) + '</p>' : '')
    + '<div class="bkl-tags">'
    + (demandVersionName(d) ? '<span class="tag ghost">' + esc(demandVersionName(d)) + '</span>' : '')
    + (d.expectDate ? '<span class="tag tag-info">期望 ' + esc(String(d.expectDate).substring(5, 10)) + '</span>' : '')
    + (wsjfText(d) ? '<span class="tag tag-plum">' + esc(wsjfText(d)) + '</span>' : '')
    + '</div>'
    + (d.source ? '<div class="bkl-src">来源：' + esc(d.source) + '</div>' : '')
    + (d.status === "rej" && d.reviewNote ? '<div class="bkl-why">' + esc(d.reviewNote) + '</div>' : '')
    + (acts ? '<div class="bkl-acts">' + acts + '</div>' : '')
    + '</div>';
}

/* ---------- 列表渲染（全空间，跨项目） ---------- */

function statusTag(st){
  if(st === "plan") return '<span class="tag tag-success">已排期</span>';
  if(st === "pass") return '<span class="tag tag-info">已通过</span>';
  if(st === "rej") return '<span class="tag tag-danger">已拒绝</span>';
  return '<span class="tag ghost">待评审</span>';
}
function demandCell(d, key){
  if(key === "title") return '<button class="link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>';
  if(key === "kind") return '<span class="tag ghost">' + esc(d.itemKind || "其他") + '</span>';
  if(key === "priority") return priTagHTML(d.priority || "P2");
  if(key === "status") return statusTag(d.status);
  if(key === "project") return esc(reqNameById(d.reqId) || "—");
  if(key === "version") return esc(demandVersionName(d) || "—");
  if(key === "expectDate") return esc(d.expectDate ? String(d.expectDate).substring(0, 10) : "—");
  if(key === "wsjf") return d.wsjfScore === null || d.wsjfScore === undefined ? "—" : (Math.round(d.wsjfScore * 10) / 10);
  if(key === "source") return esc(d.source || "—");
  if(key === "createdAt") return esc(fmtTs(d.createdAt) || "—");
  return "—";
}
/* ---------- 列表智能视图（预置 Tab + 自定义视图，参考任务列表） ---------- */

var DEM_PRESETS = [["all","全部需求"],["review","待评审"],["pass","已通过"],["plan","已排期"],["rej","已拒绝"]];
var DEM_GROUPS = ["none","status","priority","project","kind"];
var DEM_SORTS = ["default","priority","expect","wsjf","created"];
var DEM_STATE_KEY = "ds.demandView.v1";
var demSmart = { current:"all", preset:"all", group:"none", sort:"default", pris:[], kinds:[], reqs:[], q:"", collapsed:{} };
var demSmartBar = null, demTabsBox = null, demSearchInput = null, demQTimer = null;

function demBaseRows(){
  /* 列表模式的筛选已下推服务端：本地只渲染已加载页，避免分页后二次过滤导致条数对不上 */
  if(demandServerFiltered) return demands;
  return demands.filter(function(d){
    if(demSmart.preset !== "all" && d.status !== demSmart.preset) return false;
    if(demSmart.pris.length && demSmart.pris.indexOf(d.priority || "P2") === -1) return false;
    if(demSmart.kinds.length && demSmart.kinds.indexOf(d.itemKind || "其他") === -1) return false;
    if(demSmart.reqs.length && demSmart.reqs.indexOf(d.reqId) === -1) return false;
    if(demSmart.q){
      var hay = ((d.title || "") + "\n" + (d.description || "") + "\n" + (d.source || "")).toLowerCase();
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
function demGroupInfo(d){
  if(demSmart.group === "status") return {key:d.status, label:statusName(d.status)};
  if(demSmart.group === "priority") return {key:d.priority || "P2", label:priName(d.priority || "P2")};
  if(demSmart.group === "project") return {key:d.reqId || "__none", label:d.reqId ? (reqNameById(d.reqId) || "未归类") : "未归类"};
  if(demSmart.group === "kind") return {key:d.itemKind || "其他", label:d.itemKind || "其他"};
  return null;
}
function demGroups(){
  if(demSmart.group === "none") return [];
  var groups = [];
  demBaseRows().forEach(function(d){
    var info = demGroupInfo(d), group = null;
    for(var i = 0; i < groups.length; i++) if(groups[i].key === info.key){ group = groups[i]; break; }
    if(!group){ group = {key:info.key, label:info.label, rows:[]}; groups.push(group); }
    group.rows.push(d);
  });
  groups.forEach(function(g){ g.rows = demSorted(g.rows); });
  groups.sort(function(a, b){
    if(demSmart.group === "status")
      return (STATUS_ORDER[a.key] === undefined ? 9 : STATUS_ORDER[a.key]) - (STATUS_ORDER[b.key] === undefined ? 9 : STATUS_ORDER[b.key]);
    if(demSmart.group === "priority") return priRank(a.key) - priRank(b.key);
    return a.label.localeCompare(b.label, "zh-CN");
  });
  return groups;
}
function demViewRows(){
  if(demSmart.group === "none") return demSorted(demBaseRows());
  return demGroups().reduce(function(all, g){ return all.concat(g.rows); }, []);
}
function demFilterCount(){
  return demSmart.pris.length + demSmart.kinds.length + demSmart.reqs.length + (demSmart.q ? 1 : 0);
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
  demTabsBox.innerHTML = html;
}
function syncDemControls(){
  if(demSmartBar){
    var g = demSmartBar.querySelector("[data-dem-group]");
    if(g) g.value = demSmart.group;
    var s = demSmartBar.querySelector("[data-dem-sort]");
    if(s) s.value = demSmart.sort;
    if(demSearchInput) demSearchInput.value = demSmart.q;
    var fc = demSmartBar.querySelector("[data-dem-fcount]");
    if(fc){ var n = demFilterCount(); fc.hidden = n === 0; fc.textContent = n; }
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
        current: demSmart.current, preset: demSmart.preset, group: demSmart.group, sort: demSmart.sort,
        q: demSmart.q, pris: demSmart.pris.slice(), kinds: demSmart.kinds.slice(), reqs: demSmart.reqs.slice(),
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
  demSmart.current = typeof v.current === "string" ? v.current : "all";
  demSmart.preset = DEM_PRESETS.some(function(p){ return p[0] === v.preset; }) ? v.preset : "all";
  demSmart.group = DEM_GROUPS.indexOf(v.group) !== -1 ? v.group : "none";
  demSmart.sort = DEM_SORTS.indexOf(v.sort) !== -1 ? v.sort : "default";
  demSmart.pris = demStrArr(v.pris);
  demSmart.kinds = demStrArr(v.kinds);
  demSmart.reqs = demStrArr(v.reqs);
  demSmart.q = typeof v.q === "string" ? v.q : "";
  if(v.gantt && typeof v.gantt === "object"){
    if(["day", "week", "month"].indexOf(v.gantt.scale) !== -1) demGantt.scale = v.gantt.scale;
    if(["auto", "month"].indexOf(v.gantt.rangeMode) !== -1) demGantt.rangeMode = v.gantt.rangeMode;
    if([20, 28, 40].indexOf(v.gantt.zoomDayW) !== -1) demGantt.zoomDayW = v.gantt.zoomDayW;
  }
  resetGanttTransient();
}
function demStateChanged(){
  syncDemControls();
  /* 列表与甘特的筛选/排序下推服务端，条件变化必须重新取第一页 */
  var mode = listPrefs.viewMode("demand-pool");
  if(mode === "table" || mode === "gantt") loadDemands();
  else render();
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
  demSmart.sort = "default";
  demSmart.pris = []; demSmart.kinds = []; demSmart.reqs = []; demSmart.q = "";
  demSmart.collapsed = {};
  demStateChanged();
}
function applyDemView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "demand"){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  UI.closeAllPops();
  demSmart.current = String(v.id);
  demSmart.preset = DEM_PRESETS.some(function(x){ return x[0] === p.preset; }) ? p.preset : "all";
  demSmart.group = DEM_GROUPS.indexOf(p.group) !== -1 ? p.group : "none";
  demSmart.sort = DEM_SORTS.indexOf(p.sort) !== -1 ? p.sort : "default";
  demSmart.pris = demStrArr(p.pris);
  demSmart.kinds = demStrArr(p.kinds);
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
      preset:demSmart.preset, group:demSmart.group, sort:demSmart.sort,
      q:demSmart.q, pris:demSmart.pris.slice(), kinds:demSmart.kinds.slice(), reqs:demSmart.reqs.slice()
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
  UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响需求数据。", okText:"删除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      if(demSmart.current === String(id)) activateDemPreset("all");
      loadViews().then(renderDemTabs);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function demFilterMenuHTML(){
  var base = demands.filter(function(d){ return demSmart.preset === "all" || d.status === demSmart.preset; });
  var counts = { pris:{}, kinds:{}, reqs:{} };
  base.forEach(function(d){
    var p = d.priority || "P2", k = d.itemKind || "其他", r = d.reqId || "__none";
    counts.pris[p] = (counts.pris[p] || 0) + 1;
    counts.kinds[k] = (counts.kinds[k] || 0) + 1;
    counts.reqs[r] = (counts.reqs[r] || 0) + 1;
  });
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
  var reqInner = rt.reqList.map(function(r){
    var on = demSmart.reqs.indexOf(r.id) !== -1;
    if(!(counts.reqs[r.id] > 0) && !on) return "";
    return '<button class="chip" type="button" data-dem-f="reqs" data-dem-fv="' + esc(r.id) + '" aria-pressed="' + on + '">' +
      esc(r.name) + ' <span class="n">' + (counts.reqs[r.id] || 0) + '</span></button>';
  }).join("");
  var html = '<div class="menu-title">筛选需求</div>' +
    section("优先级", priInner) + section("类型", kindInner) + section("项目", reqInner);
  if(!priInner && !kindInner && !reqInner){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">当前条件下没有可筛选的选项。</p></div>';
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-dem-f-reset>重置筛选</button></div>';
  return html;
}
function openDemFilterPop(anchor){
  var el = document.createElement("div");
  el.className = "menu popover filter-dd";
  el.innerHTML = demFilterMenuHTML();
  el.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-f-reset]")){
      demSmart.pris = []; demSmart.kinds = []; demSmart.reqs = [];
      el.innerHTML = demFilterMenuHTML();
      demStateChanged();
      return;
    }
    var b = e.target.closest("[data-dem-f]");
    if(!b) return;
    var arr = demSmart[b.dataset.demF], i = arr.indexOf(b.dataset.demFv);
    if(i === -1) arr.push(b.dataset.demFv); else arr.splice(i, 1);
    el.innerHTML = demFilterMenuHTML();
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
  toast("已导出当前视图 " + rows.length + " 项", "fs");
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
      '<input class="input dem-search" type="search" data-dem-q placeholder="搜索需求 / 描述 / 来源" aria-label="搜索需求" />' +
      '<button class="chip ghost" type="button" data-dem-filter aria-haspopup="true" aria-expanded="false" title="筛选需求（优先级 / 类型 / 项目）">筛选 <span class="n" data-dem-fcount hidden>0</span>' + icon("caretDown", 12) + '</button>' +
      '<label class="smart-view-control"><span>分组</span><select class="mini-select" data-dem-group aria-label="分组方式">' +
        '<option value="none">不分组</option><option value="status">按状态</option><option value="priority">按优先级</option>' +
        '<option value="project">按项目</option><option value="kind">按类型</option></select></label>' +
      '<label class="smart-view-control"><span>排序</span><select class="mini-select" data-dem-sort aria-label="排序方式">' +
        '<option value="default">默认顺序（状态→优先级）</option><option value="priority">按优先级</option>' +
        '<option value="expect">按期望交付</option><option value="wsjf">按 WSJF</option><option value="created">按提交时间</option></select></label>' +
      '<span class="smart-view-spacer"></span>' +
      '<button class="btn sm" type="button" data-dem-export>' + icon("download", 13) + ' 导出当前视图</button>' +
      '<button class="btn sm primary" type="button" data-dem-save>＋ 保存视图</button>' +
    '</div>';
  page.insertBefore(demSmartBar, demandBody);
  if(demandGanttBar) page.insertBefore(demandGanttBar, demandBody);
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
      return '<section class="dem-mob-group">'
        + '<button type="button" class="dem-group-toggle dem-mob-group-head" data-dem-group-toggle="' + esc(g.key) + '" aria-expanded="' + (!collapsed) + '">'
        + '<span class="dem-group-caret' + (collapsed ? '' : ' open') + '">▶</span>'
        + '<span class="dem-group-name">' + esc(g.label) + '</span>'
        + '<span class="dem-group-count">' + g.rows.length + ' 项</span></button>'
        + (collapsed ? '' : '<div class="dem-mob-cards">' + cards(g.rows) + '</div>')
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
    var text = demandTotal ? ("全空间 · 共 " + demandTotal + " 条") : "全空间";
    if(hasCond && demandTotal) text += " · 已加载 " + demands.length + " 条";
    if(demSmart.group !== "none" && groups.length) text += " · " + groups.length + " 组";
    demandsMeta.textContent = text;
  }
  if(!demands.length){
    demandBody.innerHTML = UI.emptyState({
      icon: hasCond ? "filterOff" : "inbox",
      title: hasCond ? "没有符合当前视图条件的需求" : "需求池还是空的",
      text: hasCond ? "切换视图，或调整、清空筛选条件后重试。" : "点右上角「提需求」录入第一条；评审通过后排期到版本。"
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
      '<span class="dem-group-count">' + g.rows.length + ' 项</span></button></td></tr>';
  }
  var body = "";
  if(demSmart.group === "none"){
    body = rows.map(rowHTML).join("");
  }else{
    body = groups.map(function(g){
      return groupHead(g) + (demSmart.collapsed["$" + g.key] ? "" : g.rows.map(function(d){
        return rowHTML(d, true);
      }).join(""));
    }).join("");
  }
  if(demandHasMore){
    body += '<tr class="dem-more-row"><td colspan="' + colspan + '">' +
      '<button class="btn ghost sm" type="button" data-dem-more="table">加载更多（已加载 ' +
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
  if(!maxEnd || released) return html;
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
  return demStageName(s.stage) + "：" + span + (s.open ? "（进行中）" : "（" + days + " 天）");
}
function demgLabelHTML(d, tl){
  var meta = '<span class="demg-status st-' + esc(d.status) + '"><i></i>' + esc(statusName(d.status)) + '</span>';
  meta += priTagHTML(d.priority || "P2");
  var rn = reqNameById(d.reqId) || "";
  if(rn) meta += '<span class="ellipsis shrink">' + esc(rn) + '</span>';
  var ver = demandVersionName(d);
  if(ver) meta += '<span class="tag ghost">' + esc(ver) + '</span>';
  if(d.expectDate) meta += '<span>期望 ' + esc(String(d.expectDate).substring(5, 10)) + '</span>';
  var info = [];
  if(tl.taskCount) info.push("工作项 " + (tl.taskDone || 0) + "/" + tl.taskCount);
  if(tl.docCount) info.push("文档 " + tl.docCount);
  if(tl.caseCount) info.push("用例 " + tl.caseCount + (tl.casePending ? "（待通过 " + tl.casePending + "）" : ""));
  if(tl.days) info.push("历时 " + tl.days + " 天");
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
    var label = width >= 52 ? '<span class="demg-seg-label">' + esc(demStageName(s.stage)) + '</span>' : "";
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
    '<span class="gantt-group-cnt">' + g.rows.length + ' 项</span>' +
  '</button></div>';
}
function demgLegendHTML(){
  return DEM_STAGE_ORDER.map(function(st){
    return '<span class="gl-item"><i class="demg-legend-dot st-' + st + '"></i>' + demStageName(st) + '</span>';
  }).join("") +
  '<span class="gl-item"><i class="demg-legend-gap"></i>缺口</span>' +
  '<span class="gl-item"><i class="demg-legend-expect"></i>期望交付</span>' +
  '<span class="gantt-legend-hint">阶段取自真实记录，缺失不补 0 天</span>';
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
        return { key:g.key, label:g.label, rows:demgSortRows(g.rows) };
      });
  var hasCond = demFilterCount() > 0 || demSmart.preset !== "all";
  if(demandsMeta){
    var text = demandTotal ? ("全空间 · 共 " + demandTotal + " 条") : "全空间";
    if(hasCond && demandTotal) text += " · 已加载 " + demands.length + " 条";
    if(demSmart.group !== "none" && groups.length) text += " · " + groups.length + " 组";
    demandsMeta.textContent = text;
  }
  if(!demands.length){
    demGantt.range = null;
    demandBody.innerHTML = UI.emptyState({
      icon: hasCond ? "filterOff" : "calendar",
      title: hasCond ? "没有符合当前视图条件的需求" : "需求池还是空的",
      text: hasCond ? "切换视图，或调整、清空筛选条件后重试。"
        : "点右上角「提需求」录入第一条；评审通过后排期到版本。"
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
    g.rows.forEach(function(d){ bodyHTML += demgRowHTML(d, range, dayW, totalW); });
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
      '<span class="foot-note">阶段时间取自评审日志、关联文档、工作项、用例与版本记录；无记录阶段不推算。</span>' +
      (demandHasMore
        ? '<button class="btn ghost sm" type="button" data-dem-more="gantt">加载更多（已加载 ' +
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
function findDemand(id){
  for(var i = 0; i < demands.length; i++) if(demands[i].id === id) return demands[i];
  return null;
}
function openDemandDialog(d){
  if(d && !canWriteDemand(d)){ denyDemandReadOnly(); return; }
  if(!rt.reqList.length){ toast("先在「项目」里创建项目", "warn"); return; }
  var opts = writableReqs();
  if(!opts.length){ toast("你在当前空间没有可写项目，无法提需求", "warn"); return; }
  editingDemandId = d ? d.id : null;
  dReq.innerHTML = opts.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  dReq.value = d ? d.reqId : (canEditReq(rt.demandReqId) ? rt.demandReqId : opts[0].id);
  dTitle.value = d ? d.title : "";
  dDesc.value = d ? (d.description || "") : "";
  dAccept.value = d ? (d.acceptText || "") : "";
  dSource.value = d ? (d.source || "") : "";
  dKind.value = d ? (d.itemKind || "其他") : "新功能";
  dExpect.value = d ? (d.expectDate || "") : "";
  formPri = d ? (d.priority || "P2") : "P2";
  dWsjfB.value = d && d.wsjfBusiness != null ? d.wsjfBusiness : "";
  dWsjfU.value = d && d.wsjfUrgency != null ? d.wsjfUrgency : "";
  dWsjfR.value = d && d.wsjfRisk != null ? d.wsjfRisk : "";
  dWsjfE.value = d && d.wsjfEffort != null ? d.wsjfEffort : "";
  fDemandTitle.classList.remove("invalid");
  demandFormTitle.textContent = d ? "编辑需求" : "提需求";
  btnSaveDemand.textContent = d ? "保存修改" : "提交评审";
  syncPriSeg();
  UI.openModal($("dlgDemand"), "input");
}
function saveDemand(){
  var title = dTitle.value.trim();
  if(!title){
    fDemandTitle.classList.add("invalid");
    try{ dTitle.focus(); }catch(e){ /* noop */ }
    return;
  }
  if(!canEditReq(dReq.value)){ denyDemandReadOnly(); return; }
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
    description: dDesc.value.trim() || null,
    acceptText: dAccept.value.trim() || null,
    source: dSource.value.trim() || null,
    itemKind: dKind.value,
    priority: formPri,
    expectDate: dExpect.value || null,
    wsjfBusiness: wsNum(dWsjfB, 0),
    wsjfUrgency: wsNum(dWsjfU, 0),
    wsjfRisk: wsNum(dWsjfR, 0),
    wsjfEffort: wsNum(dWsjfE, 1)
  };
  btnSaveDemand.disabled = true;
  var p = editingDemandId
    ? API.put("/api/demands/" + encodeURIComponent(editingDemandId), body)
    : API.post("/api/demands", body);
  p.then(function(){
    btnSaveDemand.disabled = false;
    UI.closeModal($("dlgDemand"));
    toast(editingDemandId ? "已更新需求「" + title + "」" : "已提交评审「" + title + "」", "fs");
    editingDemandId = null;
    if(body.reqId !== rt.demandReqId){
      rt.demandReqId = body.reqId;
      if(demandReq) demandReq.value = body.reqId;
    }
    loadDemands();
  }).catch(function(ex){
    btnSaveDemand.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
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
      loadDemands();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------- 状态流转 ---------- */

function passDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  function doPass(){
    API.post("/api/demands/" + encodeURIComponent(id) + "/pass", {}).then(function(){
      toast("已通过「" + d.title + "」，可排期进入版本", "fs");
      loadDemands();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
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
    title:"拒绝需求",
    desc:"拒绝原因会记录在需求时间线，需求进入「已拒绝」，可重新打开再评审。",
    label:"拒绝原因（必填）",
    required:true
  }).then(function(note){
    if(note === null) return;
    if(!note.trim()){ toast("请填写拒绝原因", "warn"); return; }
    API.post("/api/demands/" + encodeURIComponent(id) + "/rej", { note: note.trim() }).then(function(){
      toast("已拒绝「" + d.title + "」", "fs");
      loadDemands();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}
function reopenDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  API.post("/api/demands/" + encodeURIComponent(id) + "/reopen", {}).then(function(){
    toast("已重新打开「" + d.title + "」，回到待评审", "fs");
    loadDemands();
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}
function unpassDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  API.post("/api/demands/" + encodeURIComponent(id) + "/unpass", {}).then(function(){
    toast("已撤回「" + d.title + "」，回到待评审", "fs");
    loadDemands();
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}
function unplanDemand(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  var ver = d.versionId ? versionNames[d.versionId] : "";
  UI.showConfirm({
    title:"撤销排期",
    msg:"「" + esc(d.title) + "」将退回「已通过」" + (ver ? "，并解除与版本「" + esc(ver) + "」的关联" : "") + "。确定继续？",
    okText:"撤销排期",
    cancelText:"取消"
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/demands/" + encodeURIComponent(id) + "/unplan", {}).then(function(){
      toast("已撤销「" + d.title + "」的排期", "fs");
      loadDemands();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}
function openPlanDialog(id){
  var d = findDemand(id);
  if(!d) return;
  if(!canWriteDemand(d)){ denyDemandReadOnly(); return; }
  planDemandId = id;
  fDemandPlanVer.classList.remove("invalid");
  dpNote.value = "";
  UI.openModal($("dlgDemandPlan"), "select");
  dpVersion.innerHTML = '<option value="">加载中…</option>';
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
  dpVersion.innerHTML = usable.length
    ? usable.map(function(v){
        return '<option value="' + esc(v.id) + '">' + esc(v.name) + (v.targetDate ? (" · 目标 " + String(v.targetDate).substring(5, 10)) : "") + '</option>';
      }).join("")
    : '<option value="">（该项目还没有未发布版本）</option>';
  if(!usable.length) toast("先在「规划 > 版本」里创建版本，再排期需求", "warn");
  dpVersion.value = d.versionId && usable.some(function(v){ return v.id === d.versionId; }) ? d.versionId : "";
}
function doPlan(){
  if(!planDemandId) return;
  if(!canWriteDemand(findDemand(planDemandId))){ denyDemandReadOnly(); return; }
  var verId = dpVersion.value;
  if(!verId){
    fDemandPlanVer.classList.add("invalid");
    return;
  }
  btnDoPlan.disabled = true;
  API.post("/api/demands/" + encodeURIComponent(planDemandId) + "/plan", {
    versionId: verId,
    note: dpNote.value.trim() || null
  }).then(function(){
    btnDoPlan.disabled = false;
    UI.closeModal($("dlgDemandPlan"));
    toast("已排期到「" + versionName(verId) + "」", "fs");
    planDemandId = null;
    loadDemands();
  }).catch(function(ex){
    btnDoPlan.disabled = false;
    toast(ex.message || "排期失败", "bad");
  });
}

/* ---------- 详情（动态弹窗） ---------- */

function csrfCookie(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
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
function loadDemandTasks(layer, id){
  var box = layer.querySelector("#demTasks");
  if(!box) return;
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    if(!layer.isConnected) return;
    if(!tasks || !tasks.length){
      box.innerHTML = '<div class="attach-empty">还没有关联工作项；通过「拆分为工作项」把需求拆开执行。</div>';
      return;
    }
    box.innerHTML = '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
      + '<th>工作项</th><th>类型</th><th>负责人</th><th class="num">预估</th><th>状态</th></tr></thead><tbody>'
      + tasks.map(function(t){
        var done = t.boardColumn === "done";
        return '<tr data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
          + '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</td>'
          + '<td>' + typeBadgeHTML(t.itemType) + '</td>'
          + '<td>' + esc(t.owner || "—") + '</td>'
          + '<td class="num">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
          + '<td>' + (done ? '<span class="tag tag-success">已完成</span>'
            : '<span class="tag tag-info">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
          + '</tr>';
      }).join("")
      + '</tbody></table></div>';
  }).catch(function(){
    if(layer.isConnected) box.innerHTML = '<div class="attach-empty">关联工作项加载失败</div>';
  });
}
function loadDemandAttachments(layer, id, writable){
  var box = layer.querySelector("#demAtts");
  if(!box) return;
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/attachments").then(function(list){
    if(!layer.isConnected) return;
    box.__attList = list || [];
    if(!box.__attList.length){
      box.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、Office、txt、md、zip，单个 ≤10MB）</div>';
      return;
    }
    box.innerHTML = box.__attList.map(function(a){
      var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
      var isSheet = /\.(xlsx|xls)$/i.test(a.filename || "");
      var canPrev = previewable(a.filename);
      var url = attUrl(a.id);
      var head = isImg
        ? '<img class="att-thumb" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" />'
        : '<span class="att-icon">' + esc(extOfName(a.filename).toUpperCase().slice(0, 4) || "FILE") + '</span>';
      return '<div class="attach-item">' + head +
        '<span class="att-name"><a href="' + url + '" target="_blank" rel="noopener" title="预览 / 下载">' + esc(a.filename) + '</a></span>' +
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
    var all = (res[1] || []).filter(function(r){ return r.reqId === reqId; });
    var linkedIds = {};
    linked.forEach(function(doc){ linkedIds[doc.id] = true; });
    box.innerHTML = linked.length ? linked.map(function(doc){
      var md = doc.format === "markdown";
      return '<div class="attach-item dem-doc-item">'
        + '<span class="att-icon">' + (md ? "MD" : "HTML") + '</span>'
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

function showDemandDetail(id){
  var d = findDemand(id);
  if(!d) return;
  var writable = canWriteDemand(d);
  var grid = [
    ["状态", statusName(d.status)],
    ["需求类型", d.itemKind || "其他"],
    ["优先级", priName(d.priority || "P2")],
    ["目标版本", demandVersionName(d) || "待规划"],
    ["期望交付", d.expectDate || "待评估"],
    ["需求来源", d.source || "—"]
  ];
  var wsjf = (d.wsjfBusiness != null)
    ? '<div class="detail-section"><span class="section-title">WSJF 评分</span>'
      + '<div class="wsjf-break"><span>业务 ' + d.wsjfBusiness + '</span><span>紧迫 ' + d.wsjfUrgency
      + '</span><span>风险 ' + d.wsjfRisk + '</span><span>工作量 ' + d.wsjfEffort
      + '</span><b>' + wsjfText(d) + '</b></div></div>'
    : "";
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet md"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(d.title) + '</h2>'
    + '<div class="desc">' + esc(reqNameById(d.reqId)) + ' · 提交于 ' + esc(fmtTs(d.createdAt) || "—") + '</div></div>'
    + (writable ? '<button class="btn sm ghost" type="button" data-dem-addtask>' + icon("plus", 13) + ' 拆分为工作项</button>' : '')
    + '<button class="icon-btn sm" type="button" data-dem-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body phase-note">'
    + '<div class="detail-grid">' + grid.map(function(g){
        return '<div class="detail-item"><span>' + esc(g[0]) + '</span><b>' + esc(g[1]) + '</b></div>';
      }).join("") + '</div>'
    + (d.description ? '<div class="detail-section"><span class="section-title">需求描述</span><div class="detail-copy">' + esc(d.description) + '</div></div>' : '')
    + (d.acceptText ? '<div class="detail-section"><span class="section-title">验收标准</span><div class="detail-copy">' + esc(d.acceptText) + '</div></div>' : '')
    + (d.status === "rej" && d.reviewNote ? '<div class="detail-section"><span class="section-title">拒绝原因</span><div class="detail-copy">' + esc(d.reviewNote) + '</div></div>' : '')
    + wsjf
    + '<div class="detail-section"><span class="section-title">关联文档</span>'
    + '<div class="attach-list" id="demDocs"><div class="attach-empty">加载中…</div></div>'
    + (writable ? '<div class="dem-doc-add"><select id="demDocPick" aria-label="选择要关联的文档"></select>'
      + '<button class="btn sm ghost" type="button" data-dem-doc-link>' + icon("plus", 13) + ' 关联文档</button></div>' : '')
    + '</div>'
    + '<div class="detail-section"><span class="section-title">关联工作项</span>'
    + '<div id="demTasks"><div class="attach-empty">加载中…</div></div>'
    + (writable ? '<div style="margin-top:8px"><button class="btn sm ghost" type="button" data-dem-addtask>' + icon("plus", 13) + ' 拆分为工作项</button></div>' : '')
    + '</div>'
    + '<div class="detail-section"><span class="section-title">附件</span>'
    + '<div class="attach-list" id="demAtts"><div class="attach-empty">加载中…</div></div>'
    + (writable ? '<div style="margin-top:8px"><button class="btn sm ghost" type="button" data-dem-attup>' + icon("upload", 13) + ' 上传附件</button>'
      + '<input type="file" id="demAttFile" hidden accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.zip,.xlsx,.xls,.doc,.docx,.ppt,.pptx"></div>' : '')
    + '</div>'
    + '<div class="detail-section"><span class="section-title">流转时间线</span><ul class="dem-logs" id="demLogs"><li class="foot-note">加载中…</li></ul></div>'
    + '</div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-dem-x]")) UI.closeModal(layer);
    var p = e.target.closest("[data-dem-pass]"); if(p){ UI.closeModal(layer); passDemand(p.dataset.demPass); return; }
    var r = e.target.closest("[data-dem-rej]"); if(r){ UI.closeModal(layer); rejectDemand(r.dataset.demRej); return; }
    var pl = e.target.closest("[data-dem-plan]"); if(pl){ UI.closeModal(layer); openPlanDialog(pl.dataset.demPlan); return; }
    var ro = e.target.closest("[data-dem-reopen]"); if(ro){ UI.closeModal(layer); reopenDemand(ro.dataset.demReopen); return; }
    var at = e.target.closest("[data-dem-addtask]");
    if(at){
      if(!writable){ denyDemandReadOnly(); return; }
      UI.closeModal(layer);
      openTaskDrawer("backlog", null, {
        reqId: d.reqId, demandId: d.id, versionId: d.versionId, dueDate: d.expectDate
      });
      return;
    }
    var up = e.target.closest("[data-dem-attup]");
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
      UI.closeModal(layer);
      import("./requirements.js").then(function(m){ m.openReqDocAndJump(docIdOpen); });
      return;
    }
    var ot = e.target.closest("[data-open-task]");
    if(ot){ UI.closeModal(layer); openTaskById(ot.dataset.openTask); return; }
    var pv = e.target.closest("[data-att-prev]");
    if(pv){
      var boxP = layer.querySelector("#demAtts");
      var attP = ((boxP && boxP.__attList) || []).find(function(a){ return a.id === pv.dataset.attPrev; });
      if(attP) openAttPreview({ attachment: attP });
      return;
    }
    var sh = e.target.closest("[data-att-sheet]");
    if(sh){
      var boxS = layer.querySelector("#demAtts");
      var attS = ((boxS && boxS.__attList) || []).find(function(a){ return a.id === sh.dataset.attSheet; });
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
        okText: "删除"
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
  var fi = layer.querySelector("#demAttFile");
  if(fi) fi.addEventListener("change", function(){
    var f = fi.files && fi.files[0];
    fi.value = "";
    if(!f) return;
    if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，未上传", "warn"); return; }
    if(!/\.(jpe?g|png|gif|webp|pdf|txt|md|zip|docx?|xlsx?|pptx?)$/i.test(f.name)){
      toast("不支持的文件类型（jpg/png/gif/webp/pdf/txt/md/zip/doc/docx/xls/xlsx/ppt/pptx）", "warn");
      return;
    }
    var fd = new FormData();
    fd.append("file", f);
    var url = API.url("/api/demands/" + encodeURIComponent(id) + "/attachments" +
      (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
    fetch(url, {
      method:"POST",
      credentials:"same-origin",
      headers:{ "X-XSRF-TOKEN": csrfCookie() },
      body: fd
    }).then(function(res){
      if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
      return res.json().catch(function(){ return null; });
    }).then(function(json){
      if(json && json.code === 0){
        toast("附件已上传", "fs");
        loadDemandAttachments(layer, id, writable);
      }else{
        toast((json && json.message) || "上传失败", "bad");
      }
    }).catch(function(ex){ toast(ex && ex.message ? ex.message : "上传失败", "bad"); });
  });
  UI.openModal(layer);
  loadDemandTasks(layer, id);
  loadDemandDocs(layer, id, d.reqId, writable);
  loadDemandAttachments(layer, id, writable);
  API.getAllPages("/api/demands/" + encodeURIComponent(id) + "/logs").then(function(logs){
    var ul = layer.querySelector("#demLogs");
    if(!ul) return;
    ul.innerHTML = logs.length ? logs.map(function(l){
      return '<li><span class="dem-log-ts">' + esc(fmtTs(l.createdAt) || "—") + '</span>'
        + '<b>' + esc(l.action || "") + '</b>'
        + (l.operatorName || l.operator ? '<span class="dem-log-op">' + esc(l.operatorName || l.operator) + '</span>' : '')
        + (l.note ? '<span class="dem-log-note">' + esc(l.note) + '</span>' : '')
        + '</li>';
    }).join("") : '<li class="foot-note">暂无流转记录</li>';
  }).catch(function(){
    var ul = layer.querySelector("#demLogs");
    if(ul) ul.innerHTML = '<li class="foot-note">时间线加载失败</li>';
  });
}

/* ---------- 事件 ---------- */

if(demandReq) demandReq.addEventListener("change", function(){
  rt.demandReqId = demandReq.value || null;
  loadDemands();
});
if($("btnDemandNew")) $("btnDemandNew").addEventListener("click", function(){
  if(!rt.reqList.length){ toast("先在「项目」里创建项目", "warn"); return; }
  openDemandDialog(null);
});
if($("dlgDemandX")) $("dlgDemandX").addEventListener("click", function(){ UI.closeModal($("dlgDemand")); });
if(btnSaveDemand) btnSaveDemand.addEventListener("click", saveDemand);
if(dTitle) dTitle.addEventListener("input", function(){ fDemandTitle.classList.remove("invalid"); });
if($("segDemandPri")) $("segDemandPri").addEventListener("click", function(e){
  var b = e.target.closest("[data-dpri]");
  if(!b) return;
  formPri = b.dataset.dpri;
  syncPriSeg();
});
if($("dlgDemandPlanX")) $("dlgDemandPlanX").addEventListener("click", function(){ UI.closeModal($("dlgDemandPlan")); });
if(btnDoPlan) btnDoPlan.addEventListener("click", doPlan);
if($("demandModeSeg")) $("demandModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-dem-mode]");
  if(!b) return;
  var m = b.dataset.demMode;
  if(m === listPrefs.viewMode("demand-pool")) return;
  listPrefs.setViewMode("demand-pool", m).then(function(){
    loadDemands();
  }).catch(function(ex){ toast(ex.message || "切换失败", "bad"); });
});
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
  var dm = e.target.closest("[data-dem-more]");
  if(dm){
    if(dm.dataset.demMore === "table") loadMoreDemandTable();
    else if(dm.dataset.demMore === "gantt") loadMoreDemandGantt();
    else loadMoreDemandColumn(dm.dataset.demMore);
    return;
  }
  var gt = e.target.closest("[data-dem-group-toggle]");
  if(gt){
    var gkey = "$" + gt.dataset.demGroupToggle;
    demSmart.collapsed[gkey] = !demSmart.collapsed[gkey];
    render();
    return;
  }
  var dt = e.target.closest("[data-dem-detail]");
  if(dt){ showDemandDetail(dt.dataset.demDetail); return; }
  var mb = e.target.closest("[data-dem-menu-btn]");
  if(mb){ openDemandRowMenu(mb, findDemand(mb.dataset.demMenuBtn)); return; }
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
});

/* ---------- 卡片拖动：跨列状态流转（仅空间主；状态机同按钮） ---------- */

function allowedDrop(from, to){
  if(from === "review") return to === "pass" || to === "rej";
  if(from === "pass") return to === "plan" || to === "review";
  if(from === "rej") return to === "review";
  if(from === "plan") return to === "pass";
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
function markCanDrop(from){
  demandBody.querySelectorAll(".bkl-col").forEach(function(c){
    if(allowedDrop(from, c.dataset.col)) c.classList.add("bkl-col-can");
  });
}
/* 不合法落点给出明确文案，而不是静默吞掉 */
function dropDenied(status){
  if(status === "pass") toast("已通过的需求可拖到「已排期」，或拖回「待评审」撤回", "warn");
  else if(status === "plan") toast("已排期的需求可拖回「已通过」撤销排期", "warn");
  else if(status === "rej") toast("已拒绝的需求只能拖回「待评审」重新打开", "warn");
  else toast("待评审的需求可以拖到「已通过」或「已拒绝」", "warn");
}
function applyDrop(src, to){
  if(src.status === "review" && to === "rej"){ rejectDemand(src.id); }
  else if(src.status === "review" && to === "pass"){ passDemand(src.id); }
  else if(src.status === "pass" && to === "plan"){ openPlanDialog(src.id); }
  else if(src.status === "pass" && to === "review"){ unpassDemand(src.id); }
  else if(src.status === "plan" && to === "pass"){ unplanDemand(src.id); }
  else if(src.status === "rej" && to === "review"){ reopenDemand(src.id); }
}
if(demandBody){
  demandBody.addEventListener("dragstart", function(e){
    var card = e.target.closest(".bkl-card");
    if(!card || !isOwner()) return;
    dragSrc = { id: card.dataset.cardId, status: card.dataset.cardStatus };
    e.dataTransfer.setData("text/plain", dragSrc.id);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("bkl-dragging");
    markCanDrop(dragSrc.status);
  });
  demandBody.addEventListener("dragover", function(e){
    if(!dragSrc) return;
    var col = e.target.closest(".bkl-col");
    demandBody.querySelectorAll(".bkl-col-over,.bkl-col-no").forEach(function(c){
      c.classList.remove("bkl-col-over");
      c.classList.remove("bkl-col-no");
    });
    if(!col) return;
    /* 非法列也要 preventDefault：否则 drop 不触发，用户得不到“为什么不让我放”的提示 */
    e.preventDefault();
    if(!allowedDrop(dragSrc.status, col.dataset.col)){
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
    if(!allowedDrop(src.status, col.dataset.col)){ dropDenied(src.status); return; }
    e.preventDefault();
    applyDrop(src, col.dataset.col);
  });
  demandBody.addEventListener("dragend", function(e){
    clearColOver();
    var card = e.target.closest(".bkl-card");
    if(card) card.classList.remove("bkl-dragging");
    dragSrc = null;
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
  var hit = findDemand(id);
  if(hit){ showDemandDetail(id); return Promise.resolve(true); }
  return API.get("/api/demands/" + encodeURIComponent(id)).then(function(d){
    if(!findDemand(d.id)) demands.push(d);
    showDemandDetail(d.id);
    return true;
  }).catch(function(ex){
    toast(ex.message || "需求不存在或无权查看", "warn");
    return false;
  });
}

/* ---------------------------------------------------------------------------
 * 任务抽屉「关联需求」下拉（iDemand）
 * 层次口径与后端 applyRequest 一致：需求必须属于任务所选项目；
 * 未选项目时可从全空间挑选，选中后由抽屉自动带出需求所属项目。
 * --------------------------------------------------------------------------- */
var drawerDemandOpts = { reqId: null, list: [], total: 0, error: null };
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
    return;
  }
  var html = '<option value="">不关联</option>';
  var matched = false;
  (drawerDemandOpts.list || []).forEach(function(d){
    var on = d.id === keep;
    if(on) matched = true;
    var tag = drawerDemandStatusLabel(d.status);
    html += '<option value="' + esc(d.id) + '" data-req="' + esc(d.reqId || "") + '">'
      + esc(d.title) + (tag ? "（" + esc(tag) + "）" : "") + '</option>';
  });
  /* 编辑时原关联已被删除/失效：保留原值展示，保存时后端会静默解绑 */
  if(keep && !matched){
    html += '<option value="' + esc(keep) + '" data-req="' + esc(reqId) + '">原关联需求（已不在当前候选页）</option>';
    matched = true;
  }
  if(drawerDemandOpts.total > drawerDemandOpts.list.length){
    html += '<option value="" disabled>仅显示前 ' + drawerDemandOpts.list.length + ' 条，共 ' + drawerDemandOpts.total + ' 条</option>';
  }
  sel.innerHTML = html;
  sel.value = keep || "";
  sel.setAttribute("data-ready", "1");
  syncAssocViewBtns();
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
  if(drawerDemandOpts.reqId === want && drawerDemandOpts.loading) return;
  drawerDemandOpts.reqId = want;
  drawerDemandOpts.list = [];
  drawerDemandOpts.total = 0;
  drawerDemandOpts.error = null;
  sel.innerHTML = '<option value="">需求加载中…</option>';
  sel.value = "";
  syncAssocViewBtns();
  drawerDemandOpts.loading = API.get("/api/demands/page", {
    reqId: want || null, offset: 0, limit: DEMAND_TABLE_PAGE, sort: "created"
  }).then(function(page){
    if(drawerDemandOpts.reqId !== want) return;
    drawerDemandOpts.list = page.items || [];
    drawerDemandOpts.total = page.total || 0;
    drawerDemandOpts.loading = null;
    fillDrawerDemandSelect(want, keep);
  }).catch(function(ex){
    if(drawerDemandOpts.reqId !== want) return;
    drawerDemandOpts.error = ex || new Error("需求候选加载失败");
    drawerDemandOpts.loading = null;
    fillDrawerDemandSelect(want, keep);
  });
}

export { enterDemandsView, ensureDemandOptions, loadDemands, openDemandById, openDemandDetailById, openDemandsForReq, render };
