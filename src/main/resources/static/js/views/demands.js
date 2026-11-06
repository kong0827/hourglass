/* views/demands · 需求池：评审状态机看板（待评审 → 已通过 → 已排期；拒绝可重新打开） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { MOBILE_APPROVALS } from "../core/mobile-rules.js";
import * as listPrefs from "../core/list-preferences.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { canEditReq, reqNameById, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { colName, docTypeName, fmtMinutesShort, fmtSize, fmtTs, typeBadgeHTML } from "../lib/format.js";
import { loadReqs } from "./board.js";

var demandReq = $("demandReq"), demandsMeta = $("demandsMeta"), demandBody = $("demandBody"),
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
var versions = [];           /* 当前项目的版本（目标版本展示/排期选择） */
var versionNames = {};       /* 列表模式：全空间 versionId → 名称 */
var editingDemandId = null;
var planDemandId = null;
var formPri = "P2";
var dragSrc = null;           /* 拖动中的卡片 { id, status }，仅空间主可拖 */

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
function wsjfText(d){
  if(d.wsjfScore === null || d.wsjfScore === undefined) return "";
  return "WSJF " + (Math.round(d.wsjfScore * 10) / 10);
}

/* ---------- 加载 ---------- */

function syncReqSel(){
  if(!demandReq) return;
  demandReq.innerHTML = rt.reqList.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  if(!rt.demandReqId && rt.reqList.length) rt.demandReqId = rt.reqList[0].id;
  if(rt.demandReqId) demandReq.value = rt.demandReqId;
}
var demandLoadSeq = 0;
function loadDemands(){
  var seq = ++demandLoadSeq;
  if(listPrefs.viewMode("demand-pool") === "table"){ loadAllDemands(); return; }
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
    API.get("/api/demands", { reqId: reqId }),
    API.get("/api/versions", { reqId: reqId })
  ]).then(function(rs){
    if(seq !== demandLoadSeq || rt.demandReqId !== reqId) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    if(listPrefs.viewMode("demand-pool") !== "board") return;
    demands = rs[0];
    versions = rs[1];
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
function enterDemandsView(){
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
/* 列表模式：跨项目全量展示，不随项目切换；版本名按项目补查一次 */
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
  API.get("/api/demands").then(function(list){
    if(seq !== demandLoadSeq) return null;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return null;
    demands = list || [];
    versions = [];
    var reqIds = [];
    demands.forEach(function(d){ if(d.reqId && reqIds.indexOf(d.reqId) === -1) reqIds.push(d.reqId); });
    return Promise.all(reqIds.map(function(rid){
      return API.get("/api/versions", { reqId: rid }).then(function(vs){
        (vs || []).forEach(function(v){ versionNames[v.id] = v.name; });
      }).catch(function(){});
    }));
  }).then(function(done){
    if(done === null || seq !== demandLoadSeq) return;
    if(listPrefs.viewMode("demand-pool") !== "table") return;
    render();
  }).catch(function(ex){
    if(seq !== demandLoadSeq) return;
    demandBody.innerHTML = UI.emptyState({
      icon:"alert", title:"加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
function reloadDemands(){
  /* 需求排期会改变版本的「待规划需求」统计，这里只重拉需求与版本名 */
  loadDemands();
}

/* ---------- 看板渲染 ---------- */

function syncModeUI(mode){
  document.querySelectorAll("[data-dem-mode]").forEach(function(b){
    var on = b.dataset.demMode === mode;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(demandReq) demandReq.hidden = mode === "table";
  var bc = $("btnDemandColumns");
  if(bc) bc.hidden = mode !== "table";
  /* 只读项目不显示「提需求」；列表模式全空间，只要有一个可写项目即可 */
  var bn = $("btnDemandNew");
  if(bn) bn.style.display = (writableReqs().length && (mode === "table" || canEditReq(rt.demandReqId))) ? "" : "none";
}
function render(){
  var mode = listPrefs.viewMode("demand-pool");
  syncModeUI(mode);
  if(mode === "table"){ renderDemandTable(); return; }
  if(demandsMeta){
    var total = demands.length;
    demandsMeta.textContent = reqNameById(rt.demandReqId) + (total ? (" · 共 " + total + " 条") : "");
  }
  if(!demands.length && !versions.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"inbox", title:"需求池还是空的",
      text:"点右上角「提需求」录入第一条；评审通过后排期到版本。"
    });
    return;
  }
  demandBody.innerHTML = '<div class="bkl">' + COLS.map(function(c){
    var items = demands.filter(function(d){ return d.status === c[0]; }).sort(function(a, b){
      return priRank(a.priority) - priRank(b.priority)
        || String(a.expectDate || "9999").localeCompare(String(b.expectDate || "9999"));
    });
    return '<div class="bkl-col" data-col="' + c[0] + '"><div class="bkl-head"><span class="bkl-title">'
      + '<span class="pdot" style="background:' + c[2] + '"></span>' + c[1] + '</span>'
      + '<span class="bkl-count">' + items.length + '</span></div>'
      + (items.map(cardHTML).join("") || '<p class="foot-note" style="padding:10px 2px">暂无需求</p>')
      + '</div>';
  }).join("") + '</div>';
}
function demandActs(d){
  var acts = "";
  if(isOwner()){
    if(d.status === "review"){
      acts += '<button class="btn sm primary" type="button" data-dem-pass="' + esc(d.id) + '">通过</button>'
        + '<button class="btn sm" type="button" data-dem-rej="' + esc(d.id) + '">拒绝</button>';
    }
    if(d.status === "pass"){
      acts += '<button class="btn sm primary" type="button" data-dem-plan="' + esc(d.id) + '">排期进入版本</button>';
    }
    if(d.status === "rej"){
      acts += '<button class="btn sm" type="button" data-dem-reopen="' + esc(d.id) + '">重新打开</button>';
    }
  }
  var editBtn = (isOwner() && d.status === "review")
    ? '<button class="btn sm ghost" type="button" data-dem-edit="' + esc(d.id) + '">编辑</button>' : "";
  var delBtn = isOwner()
    ? '<button class="btn sm ghost danger" type="button" data-dem-del="' + esc(d.id) + '">删除</button>' : "";
  return acts + editBtn + delBtn;
}
function cardHTML(d){
  var acts = demandActs(d);
  var drag = isOwner()
    ? ' draggable="true" data-card-id="' + esc(d.id) + '" data-card-status="' + esc(d.status) + '" title="拖到其他列流转状态"'
    : "";
  return '<div class="bkl-card"' + drag + '>'
    + '<div class="bkl-tags"><span class="tag ghost">' + esc(d.itemKind || "其他") + '</span>'
    + '<span class="tag tag-info">' + esc(d.priority || "P2") + '</span></div>'
    + '<button class="link-title" type="button" data-dem-detail="' + esc(d.id) + '" title="查看需求详情">' + esc(d.title) + '</button>'
    + (d.description ? '<p class="bkl-desc">' + esc(d.description) + '</p>' : '')
    + '<div class="bkl-tags">'
    + (versionName(d.versionId) ? '<span class="tag ghost">' + esc(versionName(d.versionId)) + '</span>' : '')
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
  if(key === "priority") return '<span class="tag tag-info">' + esc(d.priority || "P2") + '</span>';
  if(key === "status") return statusTag(d.status);
  if(key === "project") return esc(reqNameById(d.reqId) || "—");
  if(key === "version") return esc(versionName(d.versionId) || "—");
  if(key === "expectDate") return esc(d.expectDate ? String(d.expectDate).substring(0, 10) : "—");
  if(key === "wsjf") return d.wsjfScore === null || d.wsjfScore === undefined ? "—" : (Math.round(d.wsjfScore * 10) / 10);
  if(key === "source") return esc(d.source || "—");
  if(key === "createdAt") return esc(fmtTs(d.createdAt) || "—");
  return "—";
}
function renderDemandTable(){
  if(demandsMeta) demandsMeta.textContent = demands.length ? ("全空间 · 共 " + demands.length + " 条") : "全空间";
  if(!demands.length){
    demandBody.innerHTML = UI.emptyState({
      icon:"inbox", title:"需求池还是空的",
      text:"点右上角「提需求」录入第一条；评审通过后排期到版本。"
    });
    return;
  }
  var cols = listPrefs.columns("demand-pool"), labels = listPrefs.labels("demand-pool");
  var numCols = { expectDate:1, wsjf:1, createdAt:1 };
  var rows = demands.slice().sort(function(a, b){
    return (STATUS_ORDER[a.status] === undefined ? 9 : STATUS_ORDER[a.status]) - (STATUS_ORDER[b.status] === undefined ? 9 : STATUS_ORDER[b.status])
      || priRank(a.priority) - priRank(b.priority)
      || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  demandBody.innerHTML = '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl">'
    + '<thead><tr>' + cols.map(function(k){ return '<th' + (numCols[k] ? ' class="num"' : '') + '>' + esc(labels[k] || k) + '</th>'; }).join("") + '<th>操作</th></tr></thead>'
    + '<tbody>' + rows.map(function(d){
      return '<tr>' + cols.map(function(k){
        return '<td' + (numCols[k] ? ' class="num"' : '') + '>' + demandCell(d, k) + '</td>';
      }).join("")
        + '<td><span class="demand-row-acts">' + demandActs(d) + '</span></td></tr>';
    }).join("") + '</tbody></table></div></section>';
}

/* ---------- 需求弹窗 ---------- */

function syncPriSeg(){
  var seg = $("segDemandPri");
  if(seg) seg.querySelectorAll("[data-dpri]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.dpri === formPri);
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
  dWsjfB.value = d && d.wsjfBusiness != null ? d.wsjfBusiness : 5;
  dWsjfU.value = d && d.wsjfUrgency != null ? d.wsjfUrgency : 5;
  dWsjfR.value = d && d.wsjfRisk != null ? d.wsjfRisk : 5;
  dWsjfE.value = d && d.wsjfEffort != null ? d.wsjfEffort : 5;
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
  function num(el, min){
    var v = Number(el.value);
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
    wsjfBusiness: num(dWsjfB, 0),
    wsjfUrgency: num(dWsjfU, 0),
    wsjfRisk: num(dWsjfR, 0),
    wsjfEffort: num(dWsjfE, 1)
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
      msg:"通过后「" + d.title + "」将进入已通过，可排期进入版本。确定继续？",
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
  if(!usable.length) toast("先在「版本阶段」里创建版本，再排期需求", "warn");
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
  API.get("/api/demands/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    if(!layer.isConnected) return;
    if(!tasks || !tasks.length){
      box.innerHTML = '<div class="attach-empty">还没有关联工作项；通过「拆分为工作项」把需求拆开执行。</div>';
      return;
    }
    box.innerHTML = '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
      + '<th>工作项</th><th>类型</th><th>负责人</th><th class="num">预估</th><th>状态</th></tr></thead><tbody>'
      + tasks.map(function(t){
        var done = t.boardColumn === "done";
        return '<tr data-open-task="' + esc(t.id) + '" title="打开任务详情">'
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
  API.get("/api/demands/" + encodeURIComponent(id) + "/attachments").then(function(list){
    if(!layer.isConnected) return;
    if(!list || !list.length){
      box.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、Excel、txt、md、zip，单个 ≤10MB）</div>';
      return;
    }
    box.innerHTML = list.map(function(a){
      var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
      var url = attUrl(a.id);
      var head = isImg
        ? '<img class="att-thumb" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" />'
        : '<span class="att-icon">' + esc(extOfName(a.filename).toUpperCase().slice(0, 4) || "FILE") + '</span>';
      return '<div class="attach-item">' + head +
        '<span class="att-name"><a href="' + url + '" target="_blank" rel="noopener" title="预览 / 下载">' + esc(a.filename) + '</a></span>' +
        '<span class="att-size">' + fmtSize(a.size) + '</span>' +
        '<span class="att-acts">' +
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
    API.get("/api/demands/" + encodeURIComponent(id) + "/docs"),
    API.get("/api/req-docs")
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
    ["优先级", d.priority || "P2"],
    ["目标版本", versionName(d.versionId) || "待规划"],
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
      + '<input type="file" id="demAttFile" hidden accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.zip,.xlsx"></div>' : '')
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
    if(!/\.(jpe?g|png|gif|webp|pdf|txt|md|zip|xlsx)$/i.test(f.name)){
      toast("不支持的文件类型（jpg/png/gif/webp/pdf/txt/md/zip/xlsx）", "warn");
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
      if(res.status === 401){ window.location.href = API.base + "/login.html"; throw new Error("未登录"); }
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
  API.get("/api/demands/" + encodeURIComponent(id) + "/logs").then(function(logs){
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
if(demandBody) demandBody.addEventListener("click", function(e){
  var dt = e.target.closest("[data-dem-detail]");
  if(dt){ showDemandDetail(dt.dataset.demDetail); return; }
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
  if(from === "pass") return to === "plan";
  if(from === "rej") return to === "review";
  return false;
}
function clearColOver(){
  demandBody.querySelectorAll(".bkl-col").forEach(function(c){ c.classList.remove("bkl-col-over"); });
}
function applyDrop(src, to){
  if(src.status === "review" && to === "rej"){ rejectDemand(src.id); }
  else if(src.status === "review" && to === "pass"){ passDemand(src.id); }
  else if(src.status === "pass" && to === "plan"){ openPlanDialog(src.id); }
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
  });
  demandBody.addEventListener("dragover", function(e){
    if(!dragSrc) return;
    var col = e.target.closest(".bkl-col");
    clearColOver();
    if(!col || !allowedDrop(dragSrc.status, col.dataset.col)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    col.classList.add("bkl-col-over");
  });
  demandBody.addEventListener("drop", function(e){
    var col = e.target.closest(".bkl-col");
    clearColOver();
    if(!dragSrc || !col) return;
    var src = dragSrc;
    dragSrc = null;
    if(!allowedDrop(src.status, col.dataset.col)) return;
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

export { enterDemandsView, loadDemands, render };
