/* views/testcases · 测试用例：用例库、执行结果标记、失败一键转缺陷 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { canEditReq, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { PRIORITIES, fmtTs, priName, priTagHTML } from "../lib/format.js";
import { loadReqs } from "./board.js";

var cases = [];
var stats = { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
var caseReqId = null;
var statusFilter = "all";
var modFilter = "all";
var priFilter = "all";
var ownerFilter = "all";
var bugOnly = false;
var searchText = "";
var editingCase = null;
var runningCaseId = null;
var defectCaseId = null;
var runStatus = "passed";
var loadSeq = 0;
/* 项目需求池条目缓存：填充「关联需求」下拉，避免每次开弹窗都请求 */
var demandOptions = { reqId: null, list: [], loading: null };

var STATUS_LABEL = { passed: "通过", failed: "失败", blocked: "阻塞" };
function statusBadgeHTML(s){
  if(!s) return '<span class="mini-tag mute">未执行</span>';
  var cls = { passed: "ok", failed: "over", blocked: "warn" }[s];
  return '<span class="mini-tag ' + cls + '">' + STATUS_LABEL[s] + '</span>';
}
function caseById(id){
  for(var i = 0; i < cases.length; i++) if(cases[i].id === id) return cases[i];
  return null;
}
function isWritable(){ return !!caseReqId && canEditReq(caseReqId); }

/* ---------- 加载 ---------- */

function syncReqSel(){
  var sel = $("tcReq");
  sel.innerHTML = rt.reqList.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  if(!caseReqId && rt.reqList.length) caseReqId = rt.reqList[0].id;
  if(caseReqId) sel.value = caseReqId;
}
function loadCases(){
  var seq = ++loadSeq;
  if(!caseReqId || !rt.reqList.length){
    cases = [];
    syncFilterOptions();
    $("tcList").innerHTML = UI.emptyState({
      icon: "folder", title: "还没有项目",
      text: "先在「项目」里创建项目，测试用例按项目收纳。"
    });
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = "";
    return;
  }
  var reqId = caseReqId;
  $("tcList").innerHTML = UI.skeletonRows(3);
  Promise.all([
    API.get("/api/test-cases", { reqId: reqId }),
    API.get("/api/test-cases/stats", { reqId: reqId })
  ]).then(function(rs){
    if(seq !== loadSeq || caseReqId !== reqId) return;
    cases = rs[0] || [];
    stats = rs[1] || { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
    render();
  }).catch(function(ex){
    if(seq !== loadSeq) return;
    $("tcList").innerHTML = UI.emptyState({
      icon: "alert", title: "加载失败", text: ex.message || "网络异常，请稍后重试"
    });
  });
}
function enterTestCasesView(){
  if(rt.reqsLoaded){ syncReqSel(); loadCases(); return; }
  $("tcList").innerHTML = UI.skeletonRows(3);
  loadReqs().then(function(){
    if(rt.reqsLoaded){ syncReqSel(); loadCases(); return; }
    /* 首屏并发：别的调用先占了 seq，本次回调被跳过，reqList 还没填充，再等一轮 */
    loadReqs().then(function(){
      if(rt.reqsLoaded){ syncReqSel(); loadCases(); return; }
      syncReqSel(); loadCases();
    });
  });
}

/* ---------- 渲染 ---------- */

function render(){
  syncModeUI();
  renderStats();
  syncFilterOptions();
  var rows = cases.filter(matchStatus).filter(matchSearch)
    .filter(matchModule).filter(matchPri).filter(matchOwner).filter(matchBug);
  $("tcMeta").textContent = (stats && stats.total)
    ? (rows.length === stats.total ? "共 " + stats.total + " 条用例" : "筛选出 " + rows.length + " / " + stats.total + " 条用例")
    : "";
  if(!rows.length){
    var anyFilter = statusFilter !== "all" || modFilter !== "all" || priFilter !== "all"
      || ownerFilter !== "all" || bugOnly || !!searchText;
    $("tcList").innerHTML = UI.emptyState({
      icon: anyFilter ? "filterOff" : "checklist",
      title: searchText ? "没有匹配的用例" : (cases.length ? "没有符合条件的用例" : "还没有测试用例"),
      text: searchText ? "换个关键词或清空搜索试试" : (cases.length ? "换个筛选条件试试" : "点右上角「新增用例」录入第一条，执行后按结果统计。")
    });
    return;
  }
  $("tcList").innerHTML = rows.map(caseRowHTML).join("");
}
function matchStatus(c){
  if(statusFilter === "all") return true;
  if(statusFilter === "untested") return !c.latestStatus;
  return c.latestStatus === statusFilter;
}
function matchModule(c){
  if(modFilter === "all") return true;
  if(modFilter === "__none") return !c.module;
  return c.module === modFilter;
}
function matchPri(c){
  if(priFilter === "all") return true;
  if(priFilter === "__none") return !c.priority;
  return c.priority === priFilter;
}
function matchOwner(c){
  if(ownerFilter === "all") return true;
  return c.latestBy === ownerFilter;
}
function matchBug(c){
  return !bugOnly || !!c.latestBugTaskId;
}
function matchSearch(c){
  if(!searchText) return true;
  var hay = [c.title, c.module, c.precondition, c.latestNote, c.latestBugTaskTitle, c.demandTitle]
    .concat((c.steps || []).map(function(s){ return [s.action, s.expected].join(" "); }))
    .join("\n").toLowerCase();
  return hay.indexOf(searchText) !== -1;
}
/* 筛选下拉选项由已加载用例动态生成；当前选中值失效时回落到「全部」 */
function uniqValues(list, pick){
  var seen = {};
  var out = [];
  (list || []).forEach(function(c){
    var v = pick(c);
    if(!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  });
  return out;
}
function fillFilterSelect(id, allLabel, values, noneLabel, state){
  var sel = $(id);
  var html = '<option value="all">' + allLabel + '</option>';
  values.forEach(function(v){
    html += '<option value="' + esc(v) + '">' + esc(v) + '</option>';
  });
  if(noneLabel){
    html += '<option value="__none">' + noneLabel + '</option>';
  }
  sel.innerHTML = html;
  var valid = state() === "all" || state() === "__none" || values.indexOf(state()) !== -1;
  if(!valid) state("all");
  sel.value = state();
}
function syncFilterOptions(){
  var modules = uniqValues(cases, function(c){ return c.module; });
  var owners = uniqValues(cases, function(c){ return c.latestBy; });
  var prisEmpty = cases.some(function(c){ return !c.priority; });
  var modsEmpty = cases.some(function(c){ return !c.module; });
  fillFilterSelect("tcModule", "模块：全部", modules, modsEmpty ? "未填模块" : null, function(v){
    if(v === undefined) return modFilter;
    modFilter = v;
  });
  fillFilterSelect("tcOwner", "执行人：全部", owners, null, function(v){
    if(v === undefined) return ownerFilter;
    ownerFilter = v;
  });
  fillFilterSelect("tcPri", "优先级：全部", PRIORITIES, prisEmpty ? "未设置" : null, function(v){
    if(v === undefined) return priFilter;
    priFilter = v;
  });
  $("tcModuleList").innerHTML = modules.map(function(m){
    return '<option value="' + esc(m) + '"></option>';
  }).join("");
  $("tcBug").classList.toggle("primary", bugOnly);
  $("tcBug").setAttribute("aria-pressed", bugOnly ? "true" : "false");
}
function renderStats(){
  var s = stats || {};
  var items = [
    [s.total, "总计", ""],
    [s.untested, "未执行", "mute"],
    [s.passed, "通过", "ok"],
    [s.failed, "失败", "over"],
    [s.blocked, "阻塞", "warn"]
  ];
  $("tcStats").innerHTML = items.map(function(it){
    return '<span class="tc-stat ' + it[2] + '"><b>' + it[0] + '</b>' + it[1] + '</span>';
  }).join("");
}
function syncModeUI(){
  var bn = $("btnCaseNew");
  if(bn) bn.style.display = isWritable() ? "" : "none";
  document.querySelectorAll("#tcStatusSeg [data-tc-status]").forEach(function(b){
    var on = b.dataset.tcStatus === statusFilter;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function caseRowHTML(c){
  var meta = [];
  var stepCount = (c.steps || []).length;
  if(c.module) meta.push(c.module);
  if(c.demandTitle) meta.push("需求：" + cut(c.demandTitle, 30));
  meta.push(stepCount ? (stepCount + " 步") : "无步骤");
  if(c.precondition) meta.push("前置：" + cut(c.precondition, 36));
  if(c.latestStatus){
    meta.push((c.latestBy || "—") + " " + (c.latestAt ? fmtTs(c.latestAt) : ""));
  }
  var w = isWritable();
  var acts = "";
  if(w){
    acts += '<button class="btn sm" type="button" data-tc-run="' + esc(c.id) + '">' + icon("play", 13) + ' 执行</button>';
  }
  if(c.latestBugTaskId){
    acts += '<button class="btn sm ghost" type="button" data-tc-bug="' + esc(c.id) + '" title="打开关联缺陷">'
      + '缺陷 · ' + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 14)) + '</button>';
  }else if(w && c.latestStatus === "failed"){
    acts += '<button class="btn sm ghost danger" type="button" data-tc-defect="' + esc(c.id) + '">转缺陷</button>';
  }
  if(w){
    acts += '<span class="tc-secondary">'
      + '<button class="btn sm ghost" type="button" data-tc-edit="' + esc(c.id) + '">' + icon("edit", 13) + ' 编辑</button>'
      + '<button class="icon-btn sm" type="button" data-tc-del="' + esc(c.id) + '" aria-label="删除用例">' + icon("trash", 14) + '</button>'
      + '</span>';
  }
  return '<div class="tc-row" data-tc-open="' + esc(c.id) + '">'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="tc-main">'
    +   '<div class="tc-title">' + esc(c.title) + (c.priority ? ' <span class="tc-pri">' + priTagHTML(c.priority) + '</span>' : "") + '</div>'
    +   '<div class="tc-meta">' + meta.map(esc).join(" · ") + '</div>'
    +   (c.latestNote ? '<div class="tc-note">' + esc(c.latestNote) + '</div>' : "")
    + '</div>'
    + '<div class="tc-acts">' + acts + '</div>'
    + '</div>';
}
function cut(s, n){
  s = String(s || "");
  return s.length > n ? s.substring(0, n) + "…" : s;
}

/* ---------- 用例编辑 ---------- */

function demandStatusLabel(st){
  return { review:"待评审", pass:"已通过", plan:"已排期", rej:"已拒绝" }[st] || st || "";
}
function demandPickLabel(d){
  var tag = demandStatusLabel(d.status);
  return d.title + (tag ? "（" + tag + "）" : "");
}
function loadDemandOptions(reqId){
  if(!reqId) return Promise.resolve([]);
  if(demandOptions.reqId === reqId && demandOptions.list.length) return Promise.resolve(demandOptions.list);
  if(demandOptions.reqId === reqId && demandOptions.loading) return demandOptions.loading;
  demandOptions.reqId = reqId;
  demandOptions.list = [];
  demandOptions.loading = API.get("/api/demands", { reqId: reqId }).then(function(list){
    if(demandOptions.reqId === reqId){
      demandOptions.list = list || [];
    }
    demandOptions.loading = null;
    return demandOptions.list;
  }).catch(function(){
    demandOptions.loading = null;
    return [];
  });
  return demandOptions.loading;
}
function fillDemandSelect(selected){
  var sel = $("cDemand");
  var list = (demandOptions.reqId === caseReqId && demandOptions.list) ? demandOptions.list : [];
  var valid = selected && list.some(function(d){ return d.id === selected; });
  sel.innerHTML = '<option value="">不关联</option>'
    + list.map(function(d){
      return '<option value="' + esc(d.id) + '">' + esc(demandPickLabel(d)) + '</option>';
    }).join("");
  sel.value = valid ? selected : "";
  if(selected && !valid && list.length) sel.value = "";
}
function setDemandLoading(){
  $("cDemand").innerHTML = '<option value="">需求加载中…</option>';
  $("cDemand").value = "";
}
/* 优先级档位固定 P0-P3，显示名随空间优先级配置变化，开弹窗时刷新 */
function syncPriOptions(){
  $("cPri").innerHTML = '<option value="">不设置</option>'
    + PRIORITIES.map(function(p){
      return '<option value="' + p + '">' + p + ' · ' + esc(priName(p)) + '</option>';
    }).join("");
}

function openNewDialog(){
  editingCase = { id: null, steps: [{ action: "", expected: "" }] };
  $("caseFormTitle").textContent = "新增用例";
  $("cTitle").value = "";
  $("cModule").value = "";
  syncPriOptions();
  $("cPri").value = "";
  $("cPrecondition").value = "";
  setDemandLoading();
  loadDemandOptions(caseReqId).then(function(){ if(editingCase && !editingCase.id) fillDemandSelect(""); });
  renderStepRows();
  applyReadOnly(!isWritable());
  UI.openModal($("dlgCase"), "input");
}
function openEditDialog(id){
  var c = caseById(id);
  if(!c) return;
  editingCase = {
    id: id,
    demandId: c.demandId || "",
    steps: (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
  $("caseFormTitle").textContent = isWritable() ? "编辑用例" : "查看用例";
  $("cTitle").value = c.title || "";
  $("cModule").value = c.module || "";
  syncPriOptions();
  $("cPri").value = c.priority || "";
  $("cPrecondition").value = c.precondition || "";
  setDemandLoading();
  loadDemandOptions(caseReqId).then(function(){
    if(editingCase && editingCase.id === id) fillDemandSelect(editingCase.demandId);
  });
  renderStepRows();
  applyReadOnly(!isWritable());
  UI.openModal($("dlgCase"), "input");
}
function renderStepRows(){
  var rows = editingCase.steps;
  $("tcSteps").innerHTML = rows.length
    ? rows.map(function(s, i){
      return '<div class="tc-step-row">'
        + '<span class="tc-step-no">' + (i + 1) + '</span>'
        + '<textarea rows="1" maxlength="200" placeholder="操作步骤（必填）" aria-label="步骤 ' + (i + 1) + ' 操作">' + esc(s.action) + '</textarea>'
        + '<textarea rows="1" maxlength="500" placeholder="预期结果（选填）" aria-label="步骤 ' + (i + 1) + ' 预期">' + esc(s.expected) + '</textarea>'
        + '<button class="icon-btn sm" type="button" data-step-del="' + i + '" aria-label="删除该步骤">' + icon("trash", 14) + '</button>'
        + '</div>';
    }).join("")
    : '<p class="foot-note">还没有步骤，点下方「添加步骤」录入操作与预期结果，或在步骤里按 Ctrl+Enter 快捷插入新行。</p>';
}
function focusStep(i){
  var row = $("tcSteps").querySelectorAll(".tc-step-row")[i];
  var ta = row && row.querySelector("textarea");
  if(ta) ta.focus();
}
function applyReadOnly(on){
  ["cTitle", "cPrecondition", "cDemand", "cModule", "cPri"].forEach(function(id){ $(id).disabled = on; });
  $("tcSteps").querySelectorAll("textarea").forEach(function(inp){ inp.disabled = on; });
  $("tcSteps").querySelectorAll("[data-step-del]").forEach(function(b){ b.style.display = on ? "none" : ""; });
  $("btnCaseAddStep").style.display = on ? "none" : "";
  $("caseSaveRow").style.display = on ? "none" : "";
  $("caseReadonlyHint").hidden = !on;
}
function collectSteps(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    var a = tas[0].value.trim();
    var e = tas[1].value.trim();
    if(!a && !e) return;
    rows.push({ action: a, expected: e });
  });
  return rows;
}
function syncStepsFromDom(){
  if(!editingCase) return;
  editingCase.steps = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    editingCase.steps.push({
      action: tas[0].value.trim(),
      expected: (tas[1].value || "").trim()
    });
  });
}
function saveCase(){
  var title = $("cTitle").value.trim();
  if(!title){
    $("fCaseTitle").classList.add("invalid");
    toast("请填写用例标题", "warn");
    return;
  }
  var body = {
    reqId: caseReqId,
    title: title,
    precondition: $("cPrecondition").value.trim() || null,
    module: $("cModule").value.trim() || null,
    priority: $("cPri").value || null,
    demandId: $("cDemand").value || null,
    steps: collectSteps()
  };
  var p = editingCase.id
    ? API.put("/api/test-cases/" + encodeURIComponent(editingCase.id), body)
    : API.post("/api/test-cases", body);
  p.then(function(){
    UI.closeModal($("dlgCase"));
    toast(editingCase.id ? "用例已保存" : "用例已创建");
    loadCases();
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
}
function removeCase(id){
  var c = caseById(id);
  if(!window.confirm("删除用例「" + (c ? c.title : id) + "」？其执行记录将一并删除。")) return;
  API.del("/api/test-cases/" + encodeURIComponent(id)).then(function(){
    toast("用例已删除");
    loadCases();
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
}

/* ---------- 执行结果 ---------- */

function openRunDialog(id){
  runningCaseId = id;
  runStatus = "passed";
  $("runNote").value = "";
  var c = caseById(id);
  $("runFormTitle").textContent = "执行 · " + (c ? cut(c.title, 18) : "");
  syncRunSeg();
  UI.openModal($("dlgCaseRun"), "textarea");
}
function syncRunSeg(){
  document.querySelectorAll("#segCaseRun [data-run-status]").forEach(function(b){
    var on = b.dataset.runStatus === runStatus;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function doRun(){
  API.post("/api/test-cases/" + encodeURIComponent(runningCaseId) + "/runs", {
    status: runStatus,
    note: $("runNote").value.trim() || null
  }).then(function(){
    UI.closeModal($("dlgCaseRun"));
    toast(runStatus === "failed" ? "已记录失败，可点击「转缺陷」生成缺陷任务" : "执行结果已记录");
    loadCases();
  }).catch(function(ex){ toast(ex.message || "记录失败", "bad"); });
}

/* ---------- 失败转缺陷 ---------- */

function openDefectDialog(id){
  defectCaseId = id;
  var c = caseById(id);
  $("caseDefectDesc").textContent = "「" + (c ? c.title : "") + "」将生成一条缺陷任务，执行步骤与失败备注写入描述。";
  $("defectSeverity").value = "";
  $("defectEnvironment").value = "";
  $("fDefectSeverity").classList.remove("invalid");
  UI.openModal($("dlgCaseDefect"), "select");
}
function doDefect(){
  var severity = $("defectSeverity").value;
  if(!severity){
    $("fDefectSeverity").classList.add("invalid");
    toast("缺陷必须选择严重度", "warn");
    return;
  }
  API.post("/api/test-cases/" + encodeURIComponent(defectCaseId) + "/defect", {
    severity: severity,
    environment: $("defectEnvironment").value.trim() || null
  }).then(function(task){
    UI.closeModal($("dlgCaseDefect"));
    toast("缺陷已创建");
    loadCases();
    openTaskById(task.id);
  }).catch(function(ex){ toast(ex.message || "创建失败", "bad"); });
}

/* ---------- 事件 ---------- */

$("tcReq").addEventListener("change", function(){
  caseReqId = $("tcReq").value;
  loadCases();
});
["tcModule", "tcPri", "tcOwner"].forEach(function(id){
  $(id).addEventListener("change", function(){
    modFilter = $("tcModule").value;
    priFilter = $("tcPri").value;
    ownerFilter = $("tcOwner").value;
    render();
  });
});
$("tcBug").addEventListener("click", function(){
  bugOnly = !bugOnly;
  render();
});
$("tcSearch").addEventListener("input", function(){
  searchText = this.value.trim().toLowerCase();
  render();
});
$("tcStatusSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-tc-status]");
  if(!b) return;
  statusFilter = b.dataset.tcStatus;
  render();
});
$("btnCaseNew").addEventListener("click", openNewDialog);
$("tcList").addEventListener("click", function(e){
  var run = e.target.closest("[data-tc-run]");
  if(run){ openRunDialog(run.dataset.tcRun); return; }
  var def = e.target.closest("[data-tc-defect]");
  if(def){ openDefectDialog(def.dataset.tcDefect); return; }
  var bug = e.target.closest("[data-tc-bug]");
  if(bug){ var cb = caseById(bug.dataset.tcBug); if(cb) openTaskById(cb.latestBugTaskId); return; }
  var edit = e.target.closest("[data-tc-edit]");
  if(edit){ openEditDialog(edit.dataset.tcEdit); return; }
  var del = e.target.closest("[data-tc-del]");
  if(del){ removeCase(del.dataset.tcDel); return; }
  var open = e.target.closest("[data-tc-open]");
  if(open && !e.target.closest(".tc-acts")) openEditDialog(open.dataset.tcOpen);
});
$("btnCaseAddStep").addEventListener("click", function(){
  if(!editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  syncStepsFromDom();
  editingCase.steps.push({ action: "", expected: "" });
  renderStepRows();
  focusStep(editingCase.steps.length - 1);
});
$("tcSteps").addEventListener("click", function(e){
  var d = e.target.closest("[data-step-del]");
  if(!d || !editingCase) return;
  syncStepsFromDom();
  editingCase.steps.splice(Number(d.dataset.stepDel), 1);
  renderStepRows();
});
/* Ctrl/Cmd+Enter 在当前步骤下方插入新行，长步骤输入不受干扰 */
$("tcSteps").addEventListener("keydown", function(e){
  if(e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  e.preventDefault();
  syncStepsFromDom();
  var row = e.target.closest(".tc-step-row");
  var idx = row
    ? Array.prototype.indexOf.call($("tcSteps").querySelectorAll(".tc-step-row"), row)
    : editingCase.steps.length - 1;
  editingCase.steps.splice(idx + 1, 0, { action: "", expected: "" });
  renderStepRows();
  focusStep(idx + 1);
});
$("btnSaveCase").addEventListener("click", saveCase);
$("cTitle").addEventListener("input", function(){ $("fCaseTitle").classList.remove("invalid"); });
$("dlgCaseX").addEventListener("click", function(){ UI.closeModal($("dlgCase")); });

$("segCaseRun").addEventListener("click", function(e){
  var b = e.target.closest("[data-run-status]");
  if(!b) return;
  runStatus = b.dataset.runStatus;
  syncRunSeg();
});
$("btnDoRun").addEventListener("click", doRun);
$("dlgCaseRunX").addEventListener("click", function(){ UI.closeModal($("dlgCaseRun")); });

$("btnDoDefect").addEventListener("click", doDefect);
$("defectSeverity").addEventListener("change", function(){ $("fDefectSeverity").classList.remove("invalid"); });
$("dlgCaseDefectX").addEventListener("click", function(){ UI.closeModal($("dlgCaseDefect")); });

export { enterTestCasesView };
