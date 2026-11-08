/* views/projects · 项目视图 */

import { API } from "../core/api.js";
import { $, reqExpanded, reqListEl, searchInput, searchWrap } from "../core/dom.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { showView } from "../core/router.js";
import { canEditReq, reqNameById, rt, state, taskCacheExtra } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { colName, docTypeName, fmtTs, reqStatusName, typeBadgeHTML } from "../lib/format.js";
import * as activityUI from "../core/activity-ui.js";
import * as listPrefs from "../core/list-preferences.js";
import { loadBoard, loadReqs } from "./board.js";
import { loadReqDocs, openNewReqDocDialog, openReqDocAndJump, reqDocList, reqDocStatusLabel, setReqDocProjectFilter } from "./requirements.js";

var rName = $("rName"), rDesc = $("rDesc"), fReqName = $("fReqName"),
    rObjective = $("rObjective"), rOwner = $("rOwner"), rPlanStart = $("rPlanStart"), rPlanEnd = $("rPlanEnd"),
    segReqStatus = $("segReqStatus"), btnSaveReq = $("btnSaveReq"),
    btnCancelReqEdit = $("btnCancelReqEdit"), reqFormTitle = $("reqFormTitle"),
    rTemplate = $("rTemplate"), rTemplateHint = $("rTemplateHint"), fReqTemplate = $("fReqTemplate");
var showArchived = false;
function visibleReqs(){
  return rt.reqList.filter(function(r){ return showArchived || !r.archivedAt; });
}
function archivedCount(){
  return rt.reqList.filter(function(r){ return !!r.archivedAt; }).length;
}
function syncArchivedToggle(){
  var btn = $("btnShowArchived");
  if(!btn) return;
  var n = archivedCount();
  if(!n && showArchived) showArchived = false;
  btn.hidden = !n && !showArchived;
  btn.textContent = showArchived ? "隐藏已归档" : "显示已归档" + (n ? "（" + n + "）" : "");
  btn.setAttribute("aria-pressed", showArchived ? "true" : "false");
  btn.classList.toggle("primary", showArchived);
}
function syncOwnerOptions(){
  if(!rOwner) return;
  var current = rOwner.value;
  rOwner.innerHTML = '<option value="">未指定</option>' + (rt.wsMembersCache || []).map(function(m){
    return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
  }).join("");
  rOwner.value = current || "";
}
function ownerLabelOf(r){
  if(!r.ownerUserId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === r.ownerUserId; })[0];
  return hit ? (hit.displayName || hit.username || r.ownerUserId) : (r.ownerName || r.ownerUserId);
}
function planRange(r){
  if(!r.plannedStart && !r.plannedEnd) return "";
  return (r.plannedStart ? String(r.plannedStart).slice(0, 10) : "未定") + " → " + (r.plannedEnd ? String(r.plannedEnd).slice(0, 10) : "未定");
}
var projectTemplates = null;
function loadProjectTemplates(){
  if(projectTemplates) return Promise.resolve(projectTemplates);
  return API.get("/api/project-templates").then(function(list){
    projectTemplates = list || [];
    if(rTemplate){
      rTemplate.innerHTML = projectTemplates.map(function(t){
        return '<option value="' + esc(t.code) + '">' + esc(t.name) + '</option>';
      }).join("");
      rTemplate.value = "blank";
      syncTemplateHint();
    }
    return projectTemplates;
  }).catch(function(){ projectTemplates = []; return projectTemplates; });
}
function syncTemplateHint(){
  if(!rTemplate || !rTemplateHint) return;
  var hit = (projectTemplates || []).filter(function(t){ return t.code === rTemplate.value; })[0];
  var parts = [];
  if(hit && hit.columns && hit.columns.length) parts.push("列：" + hit.columns.join(" / "));
  if(hit && hit.docs && hit.docs.length) parts.push("文档：" + hit.docs.join(" / "));
  if(hit && hit.modules && hit.modules.length) parts.push("测试模块：" + hit.modules.join(" / "));
  if(hit && hit.versionName) parts.push("默认版本：" + hit.versionName);
  rTemplateHint.textContent = parts.length
    ? "将补充 " + parts.join("；") + "。只补缺失项，不覆盖已有内容。"
    : (hit && hit.description) || "只创建项目本身，后续按需补充";
}
function syncTemplateField(){
  if(!fReqTemplate) return;
  fReqTemplate.hidden = !!rt.editingReqId;
}
var projectTasks = {}, projectTaskErrors = {}, projectTaskSeq = {};
function loadProjectTasks(reqId, force){
  if(!force && projectTasks[reqId]) return Promise.resolve(projectTasks[reqId]);
  var current = (projectTaskSeq[reqId] || 0) + 1;
  projectTaskSeq[reqId] = current;
  projectTasks[reqId] = null;
  delete projectTaskErrors[reqId];
  return API.get("/api/projects/" + encodeURIComponent(reqId) + "/tasks").then(function(rows){
    if(projectTaskSeq[reqId] !== current) return rows;
    projectTasks[reqId] = rows || [];
    if(reqExpanded[reqId]) renderReqList();
    return rows;
  }).catch(function(ex){
    if(projectTaskSeq[reqId] === current){
      projectTaskErrors[reqId] = ex.message || "工作项加载失败";
      if(reqExpanded[reqId]) renderReqList();
    }
    throw ex;
  });
}
function projectTasksHTML(reqId){
  var rows = projectTasks[reqId], error = projectTaskErrors[reqId];
  if(error) return '<div class="tl-empty">' + esc(error) + ' <button class="btn sm ghost" type="button" data-project-task-retry="' + esc(reqId) + '">重试</button></div>';
  if(!rows) return '<div class="tl-empty">工作项加载中…</div>';
  if(!rows.length) return '<p class="foot-note" style="margin:4px 0">该项目还没有工作项。</p>';
  return rows.map(function(t){
    var status = t.boardColumn === "done" ? "已完成" : colName(t.boardColumn);
    return '<button class="req-expand-doc" type="button" data-project-task-open="' + esc(t.id) + '">'
      + '<span class="rd-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</span>'
      + '<span class="rd-meta">' + esc(status) + ' · ' + esc(t.owner || "未指派")
      + (t.dueDate ? ' · 截止 ' + esc(String(t.dueDate).substring(0, 10)) : '') + '</span></button>';
  }).join("");
}
function refreshExpandedProjectTasks(){
  Object.keys(reqExpanded).forEach(function(reqId){
    if(reqExpanded[reqId]) loadProjectTasks(reqId, true).catch(function(){});
  });
}
function syncReqStatusSeg(){
  segReqStatus.querySelectorAll("[data-rst]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.rst === rt.formReqStatus);
  });
}
var projectFormBaseline = null;
function projectFormSnapshot(){
  return JSON.stringify([
    rName.value, rDesc.value,
    rObjective ? rObjective.value : "",
    rOwner ? rOwner.value : "",
    rPlanStart ? rPlanStart.value : "",
    rPlanEnd ? rPlanEnd.value : "",
    rTemplate ? rTemplate.value : "",
    rt.formReqStatus
  ]);
}
function projectFormDirty(){
  return !!projectFormBaseline && projectFormSnapshot() !== projectFormBaseline;
}
/* X、Esc、遮罩、取消编辑与路由切换都走这里，避免误关闭丢失填写内容 */
function tryCloseProjectDialog(afterClose){
  function finish(){
    resetReqForm();
    if(afterClose) afterClose();
  }
  if(!projectFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: "项目信息还没有保存，关闭后填写的内容会丢失。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) finish(); });
}
function resetReqForm(){
  projectFormBaseline = null;
  rt.editingReqId = null;
  rName.value = ""; rDesc.value = "";
  if(rObjective) rObjective.value = "";
  if(rOwner) rOwner.value = "";
  if(rPlanStart) rPlanStart.value = "";
  if(rPlanEnd) rPlanEnd.value = "";
  rt.formReqStatus = "active";
  fReqName.classList.remove("invalid");
  syncReqStatusSeg();
  reqFormTitle.textContent = "新增项目";
  btnSaveReq.textContent = "添加项目";
  btnCancelReqEdit.hidden = true;
  syncTemplateField();
  if($("dlgProject")) UI.closeModal($("dlgProject"));
  renderReqList();
}
function renderReqList(){
  var list = visibleReqs();
  var countEl = $("reqCount");
  if(countEl) countEl.textContent = list.length ? "共 " + list.length + " 个" : "";
  syncArchivedToggle();
  document.querySelectorAll("[data-project-mode]").forEach(function(b){
    var on = b.dataset.projectMode === listPrefs.viewMode("project-list");
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if($("btnProjectColumns")) $("btnProjectColumns").hidden = listPrefs.viewMode("project-list") !== "table";
  if(!list.length){
    reqListEl.className = "req-list";
    reqListEl.innerHTML = showArchived ? UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"点右上角「新建项目」创建第一个；展开项目可以查看文档与工作项进度。"
    }) : UI.emptyState({
      icon:"folder", title: archivedCount() ? "全部项目已归档" : "还没有项目",
      text: archivedCount() ? "点上方「显示已归档」查看或恢复已归档项目。" : "点右上角「新建项目」创建第一个；展开项目可以查看文档与工作项进度。"
    });
    return;
  }
  if(listPrefs.viewMode("project-list") === "table"){
    renderProjectTable(list);
    return;
  }
  reqListEl.className = "req-list";
  reqListEl.innerHTML = list.map(function(r){
    var open = !!reqExpanded[r.id];
    var readOnly = r.access === "read";
    var docs = (reqDocList || []).filter(function(d){ return d.reqId === r.id; });
    var docHTML = docs.length ? docs.map(function(d){
      return '<button class="req-expand-doc" type="button" data-reqdoc-open="' + esc(d.id) + '">' +
        '<span class="rd-title">' + esc(d.title) + '</span>' +
        '<span class="rd-meta">' + esc(docTypeName(d.docType)) + ' · ' + esc(reqDocStatusLabel(d.status)) +
          (Number(d.taskCount) ? (" · " + Number(d.doneCount || 0) + "/" + Number(d.taskCount) + " 工作项") : "") +
        '</span></button>';
    }).join("") : '<p class="foot-note" style="margin:4px 0">还没有文档。</p>';
    return '<div class="req-item' + (rt.editingReqId === r.id ? " editing" : "") + '" data-req-id="' + esc(r.id) + '">' +
      '<div class="req-top">' +
        '<button class="icon-btn sm req-expand-btn' + (open ? " on" : "") + '" type="button" data-req-expand="' + esc(r.id) + '" aria-expanded="' + open + '" title="展开项目详情">' +
          icon("chevronRight", 14) + '</button>' +
        '<span class="req-name">' + esc(r.name) + '</span>' +
        '<span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' +
          reqStatusName(r.status) + '</span>' +
        (r.archivedAt ? '<span class="tag tag-ghost" title="已归档：默认视图隐藏">已归档</span>' : '') +
        (readOnly ? '<span class="tag tag-ghost" title="你对该项目只有查看权限">只读</span>' : '') +
        '<span class="req-acts">' +
          '<button class="icon-btn sm" type="button" data-req-activity="' + esc(r.id) + '" title="活动轨迹" aria-label="活动轨迹">' + icon("clock", 14) + '</button>' +
          (readOnly ? '' : '<button class="icon-btn sm" type="button" data-archive-req="' + esc(r.id) + '" title="' + (r.archivedAt ? "取消归档" : "归档项目") + '" aria-label="' + (r.archivedAt ? "取消归档" : "归档项目") + '">' + icon("inbox", 14) + '</button>') +
          (readOnly ? '' : '<button class="icon-btn sm" type="button" data-edit-req="' + esc(r.id) + '" title="编辑项目" aria-label="编辑项目">' + icon("edit", 14) + '</button>') +
          (rt.currentWs && rt.currentWs.myRole === "owner"
            ? '<button class="icon-btn sm danger" type="button" data-del-req="' + esc(r.id) + '" title="删除项目" aria-label="删除项目">' + icon("trash", 14) + '</button>'
            : '') +
        '</span>' +
      '</div>' +
      (r.description ? '<div class="req-desc">' + esc(r.description) + '</div>' : '') +
      '<div class="req-meta">' +
        '<span class="progress" style="width:140px"><span class="bar"><i style="width:' + r.progressPct +
          '%;background:' + (r.status === "done" ? "var(--success)" : "var(--primary)") + '"></i></span></span>' +
        '<span style="font-weight:600;color:var(--text-2)">' + r.progressPct + '%</span>' +
        '<span>' + r.taskCount + ' 工作项 · ' + r.doneCount + ' 完成' +
          (Number(r.docCount) ? (' · ' + r.docCount + ' 文档') : '') + '</span>' +
      '</div>' +
      (function(){
        var bits = [];
        if(r.ownerUserId) bits.push('<span class="req-profile-item"><i class="req-profile-label">负责人</i>' + esc(ownerLabelOf(r)) + '</span>');
        var range = planRange(r);
        if(range) bits.push('<span class="req-profile-item"><i class="req-profile-label">计划</i>' + esc(range) + '</span>');
        if(r.objective) bits.push('<span class="req-profile-item req-profile-goal" title="' + esc(r.objective) + '"><i class="req-profile-label">目标</i>' + esc(r.objective) + '</span>');
        return bits.length ? '<div class="req-profile">' + bits.join("") + '</div>' : '';
      })() +
      (readOnly ? '' : '<div class="req-taskbar">' +
        '<input type="text" maxlength="60" data-req-new-input="' + esc(r.id) + '"' +
          ' placeholder="在此项目下新建工作项，回车确认" aria-label="在项目 ' + esc(r.name) + ' 下新建工作项" />' +
        '<button class="icon-btn sm" type="button" data-req-open="' + esc(r.id) + '" title="打开完整新建抽屉" aria-label="打开完整新建抽屉">' +
          icon("edit", 14) + '</button>' +
      '</div>') +
      (open ? '<div class="req-expand" data-req-expand-body="' + esc(r.id) + '">' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>文档</span>' +
            (readOnly ? '' : '<button class="btn sm ghost" type="button" data-doc-new="' + esc(r.id) + '">+ 新增文档</button>') + '</div>' +
          docHTML +
        '</section>' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>工作项</span>' +
            (readOnly ? '' : '<button class="btn sm ghost" type="button" data-req-open="' + esc(r.id) + '">+ 新建工作项</button>') + '</div>' +
          '<div class="req-expand-tasks">' + projectTasksHTML(r.id) + '</div>' +
        '</section>' +
        '<div class="req-expand-acts">' +
          '<button class="btn sm primary" type="button" data-req-board="' + esc(r.id) + '">在看板中查看</button>' +
          '<button class="btn sm" type="button" data-req-docs="' + esc(r.id) + '">管理文档</button>' +
        '</div>' +
      '</div>' : '') +
    '</div>';
  }).join("");
}
var PROJECT_WIDTHS = { name:"minmax(180px,1fr)", status:"90px", description:"minmax(180px,1.2fr)", ownerName:"110px", plannedEnd:"120px", taskCount:"76px", doneCount:"76px", progress:"140px", docCount:"76px", firstReleasedAt:"120px", createdAt:"140px", updatedAt:"140px" };
function projectGrid(el){
  var widths = listPrefs.columns("project-list").map(function(key){ return PROJECT_WIDTHS[key] || "120px"; });
  el.style.gridTemplateColumns = widths.concat(["224px"]).join(" ");
}
function projectCell(r, key){
  if(key === "name") return '<span class="project-cell project-name-cell" title="' + esc(r.name) + '">' + esc(r.name) + '</span>';
  if(key === "status") return '<span><span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' + esc(reqStatusName(r.status)) + '</span></span>';
  if(key === "description") return '<span class="project-cell" title="' + esc(r.description || "") + '">' + esc(r.description || "—") + '</span>';
  if(key === "ownerName") return '<span class="project-cell">' + esc(ownerLabelOf(r) || "—") + '</span>';
  if(key === "plannedEnd") return '<span class="project-cell">' + (r.plannedEnd ? esc(String(r.plannedEnd).slice(0, 10)) : "—") + '</span>';
  if(key === "taskCount") return '<span class="project-cell">' + (Number(r.taskCount) || 0) + '</span>';
  if(key === "doneCount") return '<span class="project-cell">' + (Number(r.doneCount) || 0) + '</span>';
  if(key === "progress") return '<span class="progress mini"><span class="bar"><i style="width:' + Math.max(0, Math.min(100, Number(r.progressPct) || 0)) + '%"></i></span><span class="pv">' + (Number(r.progressPct) || 0) + '%</span></span>';
  if(key === "docCount") return '<span class="project-cell">' + (Number(r.docCount) || 0) + '</span>';
  if(key === "firstReleasedAt") return '<span class="project-cell">' + (r.firstReleasedAt ? esc(String(r.firstReleasedAt).slice(0, 10)) : "—") + '</span>';
  if(key === "createdAt" || key === "updatedAt") return '<span class="project-cell">' + (r[key] ? esc(fmtTs(r[key])) : "—") + '</span>';
  return '<span class="project-cell">—</span>';
}
function projectActions(r){
  var readOnly = r.access === "read";
  return '<span class="project-row-acts">' +
    (readOnly ? '' :
      '<button class="icon-btn sm" type="button" data-req-open="' + esc(r.id) + '" title="新建工作项" aria-label="新建工作项">' + icon("plus", 14) + '</button>' +
      '<button class="icon-btn sm" type="button" data-doc-new="' + esc(r.id) + '" title="新增文档" aria-label="新增文档">' + icon("projects", 14) + '</button>') +
    '<button class="icon-btn sm" type="button" data-req-board="' + esc(r.id) + '" title="在看板中查看" aria-label="在看板中查看">' + icon("board", 14) + '</button>' +
    '<button class="icon-btn sm" type="button" data-req-docs="' + esc(r.id) + '" title="管理文档" aria-label="管理文档">' + icon("folder", 14) + '</button>' +
    '<button class="icon-btn sm" type="button" data-req-activity="' + esc(r.id) + '" title="活动轨迹" aria-label="活动轨迹">' + icon("clock", 14) + '</button>' +
    (readOnly ? '' :
      '<button class="icon-btn sm" type="button" data-archive-req="' + esc(r.id) + '" title="' + (r.archivedAt ? "取消归档" : "归档项目") + '" aria-label="' + (r.archivedAt ? "取消归档" : "归档项目") + '">' + icon("inbox", 14) + '</button>') +
    (readOnly ? '' :
      '<button class="icon-btn sm" type="button" data-edit-req="' + esc(r.id) + '" title="编辑项目" aria-label="编辑项目">' + icon("edit", 14) + '</button>') +
    (rt.currentWs && rt.currentWs.myRole === "owner" ? '<button class="icon-btn sm danger" type="button" data-del-req="' + esc(r.id) + '" title="删除项目" aria-label="删除项目">' + icon("trash", 14) + '</button>' : '') +
  '</span>';
}
function renderProjectTable(list){
  list = list || visibleReqs();
  var cols = listPrefs.columns("project-list"), labels = listPrefs.labels("project-list");
  reqListEl.className = "req-list project-table-wrap";
  reqListEl.innerHTML = '<div class="project-table">' +
    '<div class="project-table-head">' + cols.map(function(key){ return '<span>' + esc(labels[key]) + '</span>'; }).join("") + '<span>操作</span></div>' +
    '<div class="project-table-body">' + list.map(function(r){
      return '<div class="project-table-row" data-req-id="' + esc(r.id) + '">' + cols.map(function(key){ return projectCell(r, key); }).join("") + projectActions(r) + '</div>';
    }).join("") + '</div></div>';
  var head = reqListEl.querySelector(".project-table-head");
  if(head) projectGrid(head);
  reqListEl.querySelectorAll(".project-table-row").forEach(projectGrid);
}
function enterProjectsView(){
  loadProjectTemplates();
  if(rt.reqsLoaded) renderReqList();
  else reqListEl.innerHTML = UI.skeletonRows(3);
  listPrefs.load("project-list").then(renderReqList);
  loadReqs();
  /* IA-2：项目行展开要显示文档与任务进度 */
  loadReqDocs().then(function(){ renderReqList(); });
  refreshExpandedProjectTasks();
}
function saveReq(){
  if(btnSaveReq.disabled) return;
  var name = rName.value.trim();
  if(!name){
    fReqName.classList.add("invalid");
    try{ rName.focus(); }catch(e){ /* noop */ }
    return;
  }
  var body = {
    name: name,
    description: rDesc.value.trim(),
    objective: rObjective ? rObjective.value.trim() : "",
    ownerUserId: rOwner ? (rOwner.value || null) : null,
    plannedStart: rPlanStart && rPlanStart.value ? rPlanStart.value : null,
    plannedEnd: rPlanEnd && rPlanEnd.value ? rPlanEnd.value : null,
    status: rt.formReqStatus
  };
  var editing = !!rt.editingReqId;
  if(!editing) body.template = (rTemplate && rTemplate.value) || "blank";
  var p = editing ? API.put("/api/reqs/" + encodeURIComponent(rt.editingReqId), body) : API.post("/api/reqs", body);
  btnSaveReq.disabled = true;
  p.then(function(){
    btnSaveReq.disabled = false;
    toast(editing ? ("已更新项目「" + name + "」") : ("已新增项目「" + name + "」"), "fs");
    resetReqForm();
    loadReqs().then(function(){
      renderReqList();
      loadBoard({silent:true});
    });
  }).catch(function(ex){
    btnSaveReq.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function toggleArchive(id){
  var r = null;
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
  if(!r) return;
  var archiving = !r.archivedAt;
  function apply(){
    API.put("/api/reqs/" + encodeURIComponent(id) + "/archive?archived=" + archiving).then(function(){
      toast(archiving ? "已归档「" + r.name + "」，可在「显示已归档」中恢复" : "已取消归档「" + r.name + "」", "fs");
      return loadReqs();
    }).then(function(){
      renderReqList();
      loadBoard({silent:true});
    }).catch(function(ex){ toast("操作失败：" + (ex.message || "网络异常"), "bad"); });
  }
  if(!archiving){ apply(); return; }
  UI.showConfirm({
    title: "归档项目",
    msg: "归档「" + esc(r.name) + "」后将从默认项目列表与项目切换器中隐藏，任务与文档数据完整保留，可随时恢复。",
    danger: false,
    okText: "归档"
  }).then(function(ok){ if(ok) apply(); });
}
function deleteReq(id){
  var r = null;
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
  if(!r) return;
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可删除项目", "warn"); return; }
  /* A5 删除保护：确认文案改用后端 /delete-impact 的准确统计（含测试用例），
     接口失败时退回列表快照数值；服务端还会强制 confirm=项目名 二次校验。 */
  var liveDocs = (reqDocList || []).filter(function(d){ return d.reqId === id; }).length;
  var fallback = {
    unlinked: Number(r.taskCount) || 0,
    docs: Math.max(Number(r.docCount) || 0, liveDocs),
    versions: Number(r.versionCount) || 0,
    demands: Number(r.demandCount) || 0,
    cases: Number(r.caseCount) || 0
  };
  API.get("/api/reqs/" + encodeURIComponent(id) + "/delete-impact").then(function(imp){
    return imp || fallback;
  }).catch(function(){ return fallback; }).then(function(impact){
    var docs = impact.docs, versions = impact.versions, demands = impact.demands, cases = impact.cases;
    var msg = "删除项目「" + esc(r.name) + "」？其下工作项会保留，仅解除关联（回收站中的工作项也会一并解除）。";
    if(docs || versions || demands || cases){
      msg += "<br><br>以下数据会一并删除，<b>不可恢复</b>：";
      var parts = [];
      if(docs) parts.push("<b>" + docs + "</b> 份文档");
      if(versions) parts.push("<b>" + versions + "</b> 个版本");
      if(demands) parts.push("<b>" + demands + "</b> 条需求池记录");
      if(cases) parts.push("<b>" + cases + "</b> 条测试用例（含执行记录与测试计划）");
      msg += parts.join("、") + "。";
    }
    UI.showConfirm({
      title:"删除项目",
      msg: msg,
      okText: (docs || versions || demands || cases) ? "删除项目及关联数据" : "删除"
    }).then(function(ok){
      if(!ok) return;
      /* 二次确认：输入项目名才可删，防误点（项目删除不可恢复） */
      UI.showPrompt({
        title: "确认删除项目",
        desc: "此操作不可恢复。请输入项目名「" + r.name + "」以确认删除。",
        label: "项目名",
        okText: "确认删除"
      }).then(function(v){
      if(v === null) return;
      if(v !== r.name){ toast("项目名不匹配，未删除", "warn"); return; }
      API.del("/api/reqs/" + encodeURIComponent(id) + "?confirm=" + encodeURIComponent(r.name)).then(function(res){
        var deletedDocs = res && typeof res.docs === "number" ? res.docs : docs;
        var extras = [];
        if(deletedDocs) extras.push(deletedDocs + " 份文档");
        if(res && res.versions) extras.push(res.versions + " 个版本");
        if(res && res.demands) extras.push(res.demands + " 条需求池记录");
        if(res && res.cases) extras.push(res.cases + " 条测试用例");
        toast("已删除项目「" + r.name + "」，其下工作项已解除关联" +
          (res && res.unlinked ? "（" + res.unlinked + " 项）" : "") +
          (extras.length ? "；同时删除 " + extras.join("、") : ""), "fs");
        if(rt.editingReqId === id) resetReqForm();
        loadReqDocs(true);
        loadReqs().then(function(){
          renderReqList();
          loadBoard({silent:true});
        });
      }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
      });
    });
  });
}
function openProjectDialog(id){
  rt.editingReqId = id || null;
  rName.value = "";
  rDesc.value = "";
  if(rObjective) rObjective.value = "";
  if(rOwner) rOwner.value = "";
  if(rPlanStart) rPlanStart.value = "";
  if(rPlanEnd) rPlanEnd.value = "";
  rt.formReqStatus = "active";
  syncOwnerOptions();
  fReqName.classList.remove("invalid");
  syncTemplateField();
  if(!id){
    loadProjectTemplates().then(function(){
      if(rTemplate) rTemplate.value = "blank";
      syncTemplateHint();
    });
  }
  if(id){
    var r = null;
    for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
    if(r){
      rName.value = r.name || "";
      rDesc.value = r.description || "";
      if(rObjective) rObjective.value = r.objective || "";
      if(rOwner) rOwner.value = r.ownerUserId || "";
      if(rPlanStart) rPlanStart.value = r.plannedStart ? String(r.plannedStart).slice(0, 10) : "";
      if(rPlanEnd) rPlanEnd.value = r.plannedEnd ? String(r.plannedEnd).slice(0, 10) : "";
      rt.formReqStatus = r.status || "active";
    }
  }
  syncReqStatusSeg();
  reqFormTitle.textContent = id ? "编辑项目" : "新增项目";
  btnSaveReq.textContent = id ? "保存修改" : "添加项目";
  btnCancelReqEdit.hidden = !id;
  projectFormBaseline = projectFormSnapshot();
  UI.openModal($("dlgProject"), "input");
  setTimeout(function(){ try{ rName.focus(); }catch(e){ /* noop */ } }, 40);
}
if($("btnReqNew")) $("btnReqNew").addEventListener("click", function(){ openProjectDialog(null); });
document.querySelectorAll("[data-project-mode]").forEach(function(btn){
  btn.addEventListener("click", function(){
    if(btn.dataset.projectMode === listPrefs.viewMode("project-list")) return;
    btn.disabled = true;
    listPrefs.setViewMode("project-list", btn.dataset.projectMode).then(function(){
      btn.disabled = false;
      renderReqList();
    }).catch(function(ex){
      btn.disabled = false;
      toast(ex.message || "视图切换失败", "bad");
    });
  });
});
if($("btnProjectColumns")) $("btnProjectColumns").addEventListener("click", function(){
  listPrefs.openColumnSettings("project-list", renderReqList);
});
if($("btnShowArchived")) $("btnShowArchived").addEventListener("click", function(){
  showArchived = !showArchived;
  renderReqList();
});
if($("dlgProjectX")) $("dlgProjectX").addEventListener("click", function(){ tryCloseProjectDialog(); });
btnSaveReq.addEventListener("click", saveReq);
btnCancelReqEdit.addEventListener("click", function(){ tryCloseProjectDialog(); });
rName.addEventListener("input", function(){ fReqName.classList.remove("invalid"); });
/* 单行输入 Enter 直接提交；CJK 输入法组合期间不触发 */
rName.addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if(!btnSaveReq.disabled) saveReq();
});
if($("dlgProject")){
  UI.setModalCloseGuard($("dlgProject"), function(){ tryCloseProjectDialog(); });
  UI.setModalSubmit($("dlgProject"), function(){ if(!btnSaveReq.disabled) saveReq(); });
}
window.addEventListener("ds:before-route", function(e){
  var dlg = $("dlgProject");
  if(!dlg || !dlg.classList.contains("open")) return;
  e.preventDefault();
  var to = e.detail && e.detail.to;
  tryCloseProjectDialog(function(){
    if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
  });
});
if(rTemplate) rTemplate.addEventListener("change", syncTemplateHint);
segReqStatus.addEventListener("click", function(e){
  var b = e.target.closest("[data-rst]"); if(!b) return;
  rt.formReqStatus = b.dataset.rst; syncReqStatusSeg();
});
reqListEl.addEventListener("click", function(e){
  var activity = e.target.closest("[data-req-activity]");
  if(activity){
    var project = rt.reqList.filter(function(r){ return r.id === activity.dataset.reqActivity; })[0];
    activityUI.openDialog(project ? project.name : "项目", "/api/projects/" + encodeURIComponent(activity.dataset.reqActivity) + "/activities");
    return;
  }
  var openNew = e.target.closest("[data-req-open]");
  if(openNew){
    if(!canEditReq(openNew.dataset.reqOpen)){ toast("你对该项目只有查看权限", "warn"); return; }
    openTaskDrawer("backlog", null, { reqId: openNew.dataset.reqOpen });
    return;
  }
  var projectTask = e.target.closest("[data-project-task-open]");
  if(projectTask){ openTaskById(projectTask.dataset.projectTaskOpen); return; }
  var taskRetry = e.target.closest("[data-project-task-retry]");
  if(taskRetry){ loadProjectTasks(taskRetry.dataset.projectTaskRetry, true).catch(function(){}); return; }
  var ed = e.target.closest("[data-edit-req]");
  if(ed){
    if(!canEditReq(ed.dataset.editReq)){ toast("你对该项目只有查看权限", "warn"); return; }
    openProjectDialog(ed.dataset.editReq);
    return;
  }
  var archiveBtn = e.target.closest("[data-archive-req]");
  if(archiveBtn){ toggleArchive(archiveBtn.dataset.archiveReq); return; }
  var ex = e.target.closest("[data-req-expand]");
  if(ex){
    var rid0 = ex.dataset.reqExpand;
    reqExpanded[rid0] = !reqExpanded[rid0];
    renderReqList();
    if(reqExpanded[rid0]) loadProjectTasks(rid0).catch(function(){});
    return;
  }
  var docNew = e.target.closest("[data-doc-new]");
  if(docNew){
    if(!canEditReq(docNew.dataset.docNew)){ toast("你对该项目只有查看权限", "warn"); return; }
    openNewReqDocDialog(docNew.dataset.docNew);
    return;
  }
  var docOpen = e.target.closest("[data-reqdoc-open]");
  if(docOpen){ openReqDocAndJump(docOpen.dataset.reqdocOpen); return; }
  var toBoard = e.target.closest("[data-req-board]");
  if(toBoard){
    var rid1 = toBoard.dataset.reqBoard;
    state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = []; state.due = null; state.focus = false; state.blocked = false;
    searchInput.value = "";
    searchWrap.classList.remove("has");
    state.reqs = [rid1];
    showView("board");
    reloadFilteredViews();
    toast("已按项目筛选看板：" + reqNameById(rid1));
    return;
  }
  var manage = e.target.closest("[data-req-docs]");
  if(manage){
    setReqDocProjectFilter(manage.dataset.reqDocs);
    showView("requirements");
    return;
  }
  var dl = e.target.closest("[data-del-req]");
  if(dl) deleteReq(dl.dataset.delReq);
});
reqListEl.addEventListener("keydown", function(e){
  var inp = e.target.closest("[data-req-new-input]");
  if(!inp) return;
  if(e.key !== "Enter") return;
  if(e.isComposing || e.keyCode === 229) return;
  var v = inp.value.trim();
  if(!v) return;
  e.preventDefault();
  var reqId = inp.dataset.reqNewInput;
  if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  inp.disabled = true;
  API.post("/api/tasks", {
    title: v.slice(0, 60), boardColumn: "backlog", priority: "P2", progress: 0, reqId: reqId
  }).then(function(nt){
    inp.disabled = false;
    inp.value = "";
    taskCacheExtra[nt.id] = nt;
    toast("已在项目中新建「" + nt.title + "」", "fs");
    loadProjectTasks(reqId, true).catch(function(){});
    loadReqs().then(function(){ renderReqList(); loadBoard({silent:true}); });
  }).catch(function(ex){
    inp.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});

export { enterProjectsView, openProjectDialog, refreshExpandedProjectTasks, renderReqList };
