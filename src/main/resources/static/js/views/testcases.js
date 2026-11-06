/* views/testcases · 测试用例：用例库、执行结果标记、失败一键转缺陷 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { canEditReq, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { fmtTs } from "../lib/format.js";
import { loadReqs } from "./board.js";

var cases = [];
var stats = { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
var caseReqId = null;
var statusFilter = "all";
var editingCase = null;
var runningCaseId = null;
var defectCaseId = null;
var runStatus = "passed";
var loadSeq = 0;

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
  var rows = cases.filter(matchStatus);
  if(!rows.length){
    $("tcList").innerHTML = UI.emptyState({
      icon: cases.length ? "filterOff" : "checklist",
      title: cases.length ? "没有符合条件的用例" : "还没有测试用例",
      text: cases.length ? "换个执行结果筛选试试" : "点右上角「新增用例」录入第一条，执行后按结果统计。"
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
  $("tcMeta").textContent = (stats && stats.total) ? ("共 " + stats.total + " 条用例") : "";
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
    acts += '<button class="btn sm ghost" type="button" data-tc-edit="' + esc(c.id) + '">' + icon("edit", 13) + ' 编辑</button>';
    acts += '<button class="icon-btn sm" type="button" data-tc-del="' + esc(c.id) + '" aria-label="删除用例">' + icon("trash", 14) + '</button>';
  }
  return '<div class="tc-row" data-tc-open="' + esc(c.id) + '">'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="tc-main">'
    +   '<div class="tc-title">' + esc(c.title) + '</div>'
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

function openNewDialog(){
  editingCase = { id: null, steps: [{ action: "", expected: "" }] };
  $("caseFormTitle").textContent = "新增用例";
  $("cTitle").value = "";
  $("cPrecondition").value = "";
  renderStepRows();
  applyReadOnly(!isWritable());
  UI.openModal($("dlgCase"), "input");
}
function openEditDialog(id){
  var c = caseById(id);
  if(!c) return;
  editingCase = {
    id: id,
    steps: (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
  $("caseFormTitle").textContent = isWritable() ? "编辑用例" : "查看用例";
  $("cTitle").value = c.title || "";
  $("cPrecondition").value = c.precondition || "";
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
        + '<input type="text" maxlength="200" placeholder="操作步骤（必填）" value="' + esc(s.action) + '" aria-label="步骤 ' + (i + 1) + ' 操作" />'
        + '<input type="text" maxlength="500" placeholder="预期结果（选填）" value="' + esc(s.expected) + '" aria-label="步骤 ' + (i + 1) + ' 预期" />'
        + '<button class="icon-btn sm" type="button" data-step-del="' + i + '" aria-label="删除该步骤">' + icon("trash", 14) + '</button>'
        + '</div>';
    }).join("")
    : '<p class="foot-note">还没有步骤，点下方「添加步骤」录入操作与预期结果。</p>';
}
function applyReadOnly(on){
  ["cTitle", "cPrecondition"].forEach(function(id){ $(id).disabled = on; });
  $("tcSteps").querySelectorAll("input").forEach(function(inp){ inp.disabled = on; });
  $("tcSteps").querySelectorAll("[data-step-del]").forEach(function(b){ b.style.display = on ? "none" : ""; });
  $("btnCaseAddStep").style.display = on ? "none" : "";
  $("caseSaveRow").style.display = on ? "none" : "";
  $("caseReadonlyHint").hidden = !on;
}
function collectSteps(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var inputs = row.querySelectorAll("input");
    var a = inputs[0].value.trim();
    var e = inputs[1].value.trim();
    if(!a && !e) return;
    rows.push({ action: a, expected: e });
  });
  return rows;
}
function syncStepsFromDom(){
  if(!editingCase) return;
  editingCase.steps = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var inputs = row.querySelectorAll("input");
    editingCase.steps.push({
      action: inputs[0].value.trim(),
      expected: (inputs[1].value || "").trim()
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
    steps: collectSteps()
  };
  var p = editingCase.id
    ? API.put("/api/test-cases/" + editingCase.id, body)
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
  API.del("/api/test-cases/" + id).then(function(){
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
  API.post("/api/test-cases/" + runningCaseId + "/runs", {
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
  API.post("/api/test-cases/" + defectCaseId + "/defect", {
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
});
$("tcSteps").addEventListener("click", function(e){
  var d = e.target.closest("[data-step-del]");
  if(!d || !editingCase) return;
  syncStepsFromDom();
  editingCase.steps.splice(Number(d.dataset.stepDel), 1);
  renderStepRows();
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
