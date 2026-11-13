/* views/projects · 项目视图 */

import { API } from "../core/api.js";
import { $, reqExpanded, reqListEl, searchInput, searchWrap } from "../core/dom.js";
import { loadCategories } from "../core/app.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { showView } from "../core/router.js";
import { canEditReq, canManageProject, reqNameById, roleReadOnly, rt, state, taskCacheExtra } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, populateReqSelect } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { CAT_DEFAULT_COLOR, colName, docTypeName, fmtTs, reqStatusName, typeBadgeHTML } from "../lib/format.js";
import * as activityUI from "../core/activity-ui.js";
import * as listPrefs from "../core/list-preferences.js";
import { loadBoard, loadReqs } from "./board.js";
import { openDemandsForReq } from "./demands.js";
import { loadReqDocs, openNewReqDocDialog, openReqDocAndJump, reqDocList, reqDocStatusLabel, setReqDocProjectFilter } from "./requirements.js";

var rName = $("rName"), rDesc = $("rDesc"), fReqName = $("fReqName"),
    rObjective = $("rObjective"), rOwner = $("rOwner"), rPlanStart = $("rPlanStart"), rPlanEnd = $("rPlanEnd"),
    segReqStatus = $("segReqStatus"), btnSaveReq = $("btnSaveReq"),
    btnCancelReqEdit = $("btnCancelReqEdit"), reqFormTitle = $("reqFormTitle"),
    rTemplate = $("rTemplate"), rTemplateHint = $("rTemplateHint"), fReqTemplate = $("fReqTemplate"),
    projCatCfg = $("projCatCfg"), projCatList = $("projCatList"),
    projCatNewName = $("projCatNewName"), projCatNewColor = $("projCatNewColor");
var showArchived = false;
var PROJECT_SORT_DEFAULT_DIR = {
  name:"asc", status:"asc", description:"asc", ownerName:"asc", plannedEnd:"asc",
  taskCount:"desc", doneCount:"desc", progress:"desc", docCount:"desc",
  firstReleasedAt:"desc", createdAt:"desc", updatedAt:"desc"
};
var PROJECT_STATUS_ORDER = { active:0, done:1, hold:2 };
var projectSort = { key:"", dir:"asc" };
function visibleReqs(){
  return rt.reqList.filter(function(r){ return showArchived || !r.archivedAt; });
}
function archivedCount(){
  return rt.reqList.filter(function(r){ return !!r.archivedAt; }).length;
}
function projectSortValue(r, key){
  if(key === "name" || key === "description") return r[key] || null;
  if(key === "status") return Object.prototype.hasOwnProperty.call(PROJECT_STATUS_ORDER, r.status) ? PROJECT_STATUS_ORDER[r.status] : null;
  if(key === "ownerName") return ownerLabelOf(r) || null;
  if(key === "taskCount" || key === "doneCount" || key === "docCount") return Number(r[key]) || 0;
  if(key === "progress") return Number(r.progressPct) || 0;
  if(key === "plannedEnd" || key === "firstReleasedAt" || key === "createdAt" || key === "updatedAt") return r[key] || null;
  return null;
}
function compareProjects(a, b){
  var x = projectSortValue(a, projectSort.key), y = projectSortValue(b, projectSort.key);
  if(x === null && y === null) return 0;
  if(x === null) return 1;
  if(y === null) return -1;
  var result = typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x).localeCompare(String(y), "zh-Hans-CN");
  if(result) return projectSort.dir === "desc" ? -result : result;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
    || String(a.id || "").localeCompare(String(b.id || ""));
}
function sortedProjects(rows){
  return projectSort.key ? rows.slice().sort(compareProjects) : rows;
}
/* 手动排序：空间主/管理员可拖；列排序是临时视图，此时不提供拖拽 */
function canReorderProjects(){
  var role = rt.currentWs && rt.currentWs.myRole;
  return role === "owner" || role === "admin";
}
function reorderEnabled(){
  return canReorderProjects() && !projectSort.key;
}
function reqDragHTML(id){
  return '<button class="req-drag" type="button" draggable="true" data-req-drag="' + esc(id) +
    '" title="拖动调整项目顺序" aria-label="拖动调整项目顺序">' + icon("grip", 14) + '</button>';
}
var dragReqState = null, orderSaving = false;
function listedReqs(){
  return rt.reqList.filter(function(r){ return showArchived || !r.archivedAt; });
}
function clearDropMarks(){
  reqListEl.querySelectorAll(".drop-before,.drop-after").forEach(function(el){
    el.classList.remove("drop-before", "drop-after");
  });
}
function endProjectDrag(){
  dragReqState = null;
  clearDropMarks();
  reqListEl.querySelectorAll(".dragging").forEach(function(el){ el.classList.remove("dragging"); });
  document.body.classList.remove("proj-reordering");
}
/* 只把可见项目按新顺序回填，已归档（当前未显示）的项目保持原位置 */
function mergeVisibleOrder(all, visibleIds){
  var byId = {};
  all.forEach(function(r){ byId[r.id] = r; });
  var out = [], k = 0;
  all.forEach(function(r){
    if(showArchived || !r.archivedAt) out.push(byId[visibleIds[k++]] || r);
    else out.push(r);
  });
  return out;
}
function applyProjectDrop(drag, targetId, after){
  if(!drag || drag.id === targetId || orderSaving) return;
  var ids = drag.order.slice();
  var from = ids.indexOf(drag.id);
  if(from < 0) return;
  ids.splice(from, 1);
  var to = ids.indexOf(targetId);
  if(to < 0) return;
  ids.splice(after ? to + 1 : to, 0, drag.id);
  var before = rt.reqList.slice();
  var next = mergeVisibleOrder(before, ids);
  rt.reqList = next;
  renderReqList();
  orderSaving = true;
  API.put("/api/reqs/order", { ids: next.map(function(r){ return r.id; }) }).then(function(){
    orderSaving = false;
    /* 工作项抽屉、看板筛选等下拉都按 rt.reqList 渲染，保存成功后同步一次 */
    populateReqSelect();
    toast("项目顺序已保存", "fs");
  }).catch(function(ex){
    orderSaving = false;
    rt.reqList = before;
    renderReqList();
    toast("顺序保存失败：" + ((ex && ex.message) || "网络异常"), "bad");
  });
}
function setProjectSort(key){
  if(!Object.prototype.hasOwnProperty.call(PROJECT_SORT_DEFAULT_DIR, key)) return;
  if(projectSort.key !== key){
    projectSort.key = key;
    projectSort.dir = PROJECT_SORT_DEFAULT_DIR[key];
  }else if(projectSort.dir === PROJECT_SORT_DEFAULT_DIR[key]){
    /* 同列再点一次切方向，第三次回到手动顺序（拖拽排序只在手动顺序下可用） */
    projectSort.dir = projectSort.dir === "desc" ? "asc" : "desc";
  }else{
    projectSort.key = "";
    projectSort.dir = "asc";
  }
  renderReqList();
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
  return API.getAllPages("/api/projects/" + encodeURIComponent(reqId) + "/tasks").then(function(rows){
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
/* 一次打开对应一个序号：关掉 A 再打开 B 后，A 迟到的保存响应不能关闭/清空 B；
   editingReqUpdatedAt 是打开时的版本令牌，服务端据此拒绝覆盖别人刚保存的修改 */
var projectFormSeq = 0, editingReqUpdatedAt = null;
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
  projectFormSeq++;
  rt.editingReqId = null;
  editingReqUpdatedAt = null;
  projCatReqId = "";
  btnSaveReq.disabled = false;
  rName.value = ""; rDesc.value = "";
  if(rObjective) rObjective.value = "";
  if(rOwner) rOwner.value = "";
  if(rPlanStart) rPlanStart.value = "";
  if(rPlanEnd) rPlanEnd.value = "";
  rt.formReqStatus = "active";
  fReqName.classList.remove("invalid");
  syncReqStatusSeg();
  reqFormTitle.textContent = "新建项目";
  btnSaveReq.textContent = "新建项目";
  btnCancelReqEdit.hidden = true;
  syncTemplateField();
  if($("dlgProject")) UI.closeModal($("dlgProject"));
  renderReqList();
}
/* 共享空间里成员 / 只读成员看到空列表，多半是还没被分配项目，而不是空间里真的没有项目 */
function emptyProjectsState(){
  var ws = rt.currentWs;
  var role = ws && ws.type !== "personal" ? ws.myRole : "";
  /* 查看者全局只读、不受项目级范围限制：列表为空只可能是空间里还没有项目 */
  if(role === "viewer"){
    return UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"你在此空间是查看者，空间主或管理员创建项目后会显示在这里。"
    });
  }
  if(role === "member"){
    return UI.emptyState({
      icon:"folder", title:"暂无可见项目",
      text:"你还没有被分配到任何项目，可联系空间主或管理员分配；也可以点右上角「新建项目」自己创建。"
    });
  }
  return UI.emptyState({
    icon:"folder", title:"还没有项目",
    text:"点右上角「新建项目」创建第一个；展开项目可以查看文档与工作项进度。"
  });
}
function renderReqList(){
  var list = sortedProjects(visibleReqs());
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
    reqListEl.innerHTML = (showArchived || !archivedCount()) ? emptyProjectsState() : UI.emptyState({
      icon:"folder", title:"全部项目已归档",
      text:"点上方「显示已归档」查看或恢复已归档项目。"
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
        (reorderEnabled() ? reqDragHTML(r.id) : "") +
        '<button class="icon-btn sm req-expand-btn' + (open ? " on" : "") + '" type="button" data-req-expand="' + esc(r.id) + '" aria-expanded="' + open + '" title="展开项目详情">' +
          icon("chevronRight", 14) + '</button>' +
        '<button class="req-name req-name-btn" type="button" data-req-cockpit="' + esc(r.id) + '" title="打开项目驾驶舱">' + esc(r.name) + '</button>' +
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
        '<button class="req-quick-trigger" type="button" data-req-quick="' + esc(r.id) + '">＋ 新建工作项</button>' +
        '<input type="text" maxlength="60" data-req-new-input="' + esc(r.id) + '"' +
          ' placeholder="在此项目下新建工作项，回车确认" aria-label="在项目 ' + esc(r.name) + ' 下新建工作项" />' +
      '</div>') +
      (open ? '<div class="req-expand" data-req-expand-body="' + esc(r.id) + '">' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>文档</span>' +
            (readOnly ? '' : '<button class="btn sm ghost" type="button" data-doc-new="' + esc(r.id) + '">+ 新建文档</button>') + '</div>' +
          docHTML +
        '</section>' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>工作项</span>' +
            (readOnly ? '' : '<button class="btn sm ghost" type="button" data-req-open="' + esc(r.id) + '">+ 新建工作项</button>') + '</div>' +
          '<div class="req-expand-tasks">' + projectTasksHTML(r.id) + '</div>' +
        '</section>' +
        '<div class="req-expand-acts">' +
          '<button class="btn sm primary" type="button" data-req-board="' + esc(r.id) + '">在看板中查看</button>' +
          '<button class="btn sm" type="button" data-req-demands="' + esc(r.id) + '">查看需求池</button>' +
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
  if(key === "name"){
    var nameHTML = '<button class="project-cell project-name-cell req-name-btn" type="button" data-req-cockpit="' + esc(r.id) + '" title="打开项目驾驶舱：' + esc(r.name) + '">' + esc(r.name) + '</button>';
    return reorderEnabled() ? '<span class="project-name-wrap">' + reqDragHTML(r.id) + nameHTML + '</span>' : nameHTML;
  }
  if(key === "status") return '<span><span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' + esc(reqStatusName(r.status)) + '</span></span>';
  if(key === "description") return '<span class="project-cell" title="' + esc(r.description || "") + '">' + esc(r.description || "—") + '</span>';
  if(key === "ownerName") return '<span class="project-cell" title="' + esc(ownerLabelOf(r) || "") + '">' + esc(ownerLabelOf(r) || "—") + '</span>';
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
      '<button class="icon-btn sm" type="button" data-doc-new="' + esc(r.id) + '" title="新建文档" aria-label="新建文档">' + icon("projects", 14) + '</button>') +
    '<button class="icon-btn sm" type="button" data-req-board="' + esc(r.id) + '" title="在看板中查看" aria-label="在看板中查看">' + icon("board", 14) + '</button>' +
    '<button class="icon-btn sm" type="button" data-req-demands="' + esc(r.id) + '" title="查看需求池" aria-label="查看需求池">' + icon("demand", 14) + '</button>' +
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
    '<div class="project-table-head">' + cols.map(function(key){
      var active = projectSort.key === key;
      var ind = active ? (projectSort.dir === "desc" ? "↓" : "↑") : "";
      var hint = active
        ? (projectSort.dir === PROJECT_SORT_DEFAULT_DIR[key] ? "切换排序方向（再点一次恢复手动顺序）" : "恢复手动顺序")
        : "按「" + labels[key] + "」排序";
      return '<span aria-sort="' + (active ? (projectSort.dir === "desc" ? "descending" : "ascending") : "none") + '">' +
        '<button class="lh-sort' + (active ? " on" : "") + '" type="button" data-project-sort="' + esc(key) + '"' +
          ' title="' + esc(hint) + '">' + esc(labels[key]) +
          '<i class="lh-ind" aria-hidden="true">' + ind + '</i></button></span>';
    }).join("") + '<span>操作</span></div>' +
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
  else if(editingReqUpdatedAt) body.updatedAt = editingReqUpdatedAt;
  var seq = projectFormSeq;
  var p = editing ? API.put("/api/reqs/" + encodeURIComponent(rt.editingReqId), body) : API.post("/api/reqs", body);
  btnSaveReq.disabled = true;
  p.then(function(){
    toast(editing ? ("已更新项目「" + name + "」") : ("已新建项目「" + name + "」"), "fs");
    if(seq === projectFormSeq) resetReqForm();
    /* 新建项目后端会预置默认模块，模块字典要立即刷新，否则任务抽屉/筛选举不到 */
    if(!editing) loadCategories(true);
    loadReqs().then(function(){
      renderReqList();
      loadBoard({silent:true});
    });
  }).catch(function(ex){
    if(seq === projectFormSeq) btnSaveReq.disabled = false;
    toast(ex.message || "保存失败", "bad");
    /* 409：项目已被别人修改，刷新列表让下次打开拿到最新内容 */
    if(ex.code === 409) loadReqs().then(function(){ renderReqList(); });
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
    msg: "归档「" + esc(r.name) + "」后将从默认项目列表与项目切换器中隐藏，工作项与文档数据完整保留，可随时恢复。",
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
      okText: (docs || versions || demands || cases) ? "删除项目及关联数据" : "删除项目"
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
        /* 项目的模块清单随删除一并清理，模块字典要立即刷新 */
        loadCategories(true);
        loadReqs().then(function(){
          renderReqList();
          loadBoard({silent:true});
        });
      }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
      });
    });
  });
}
/* ---------- 项目抽屉 · 模块配置（模块按项目配置，仅编辑已有项目时展示） ---------- */
var projCatCache = [];
var projCatReqId = "";
function loadProjCats(reqId){
  var forReq = reqId || "";
  projCatReqId = forReq;
  if(projCatList) projCatList.innerHTML = UI.skeletonRows(2);
  return API.get("/api/categories?project=" + encodeURIComponent(forReq)).then(function(list){
    /* 已切到另一个项目：旧项目的模块不能填进新弹窗（否则排序/新增会写错项目） */
    if(projCatReqId !== forReq) return;
    projCatCache = list || [];
    renderProjCats();
  }).catch(function(ex){
    if(projCatReqId !== forReq) return;
    if(projCatList) projCatList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderProjCats(){
  if(!projCatList) return;
  var canManage = !!projCatReqId && canManageProject(projCatReqId);
  var readOnly = !canManage;
  var canDel = canManage;
  projCatList.innerHTML = projCatCache.map(function(c, idx){
    return '<div class="cfg-row" data-proj-cat-id="' + esc(c.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(c.color || CAT_DEFAULT_COLOR) + '" data-pcat-color aria-label="模块颜色"' + (readOnly ? " disabled" : "") + ' />' +
      '<input type="text" value="' + esc(c.name) + '" maxlength="12" data-pcat-name aria-label="模块名称"' + (readOnly ? " disabled" : "") + ' />' +
      '<button class="cc-act" type="button" data-pcat-up title="上移"' + (readOnly || idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-pcat-down title="下移"' + (readOnly || idx === projCatCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
      '<button class="cc-act dan" type="button" data-pcat-del title="' + (canDel ? "删除模块" : "仅空间主、管理员或项目负责人可删除模块") + '"' + (canDel ? "" : " disabled") + '>' + icon("trash", 14) + '</button>' +
    '</div>';
  }).join("");
  ["projCatNewColor", "projCatNewName", "btnProjCatAdd"].forEach(function(id){
    var el = $(id);
    if(el) el.disabled = readOnly;
  });
  if($("projCatHint")) $("projCatHint").hidden = !readOnly;
  UI.wireTooltips(projCatList);
}
function refreshCatDependents(){
  loadCategories(true);
  loadBoard({silent:true});
}
function saveProjCatRow(id){
  if(roleReadOnly()) return;
  var row = projCatList.querySelector('[data-proj-cat-id="' + id + '"]');
  if(!row) return;
  var name = row.querySelector("[data-pcat-name]").value.trim();
  var color = row.querySelector("[data-pcat-color]").value;
  if(!name){
    toast("模块名不能为空", "warn");
    /* 只回填旧值，不整段重绘：重绘会拆掉行，紧接其后的点击（删除/排序）随按钮一起丢失 */
    var old = null;
    for(var i = 0; i < projCatCache.length; i++) if(projCatCache[i].id === id) old = projCatCache[i];
    row.querySelector("[data-pcat-name]").value = old ? old.name : "";
    return;
  }
  API.put("/api/categories/" + encodeURIComponent(id), { name: name, color: color }).then(function(){
    toast("已更新模块「" + name + "」", "fs");
    loadProjCats(projCatReqId);
    refreshCatDependents();
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); loadProjCats(projCatReqId); });
}
projCatList.addEventListener("change", function(e){
  var row = e.target.closest("[data-proj-cat-id]");
  if(!row) return;
  if(e.target.matches("[data-pcat-name]") || e.target.matches("[data-pcat-color]")) saveProjCatRow(row.dataset.projCatId);
});
projCatList.addEventListener("click", function(e){
  if(roleReadOnly()) return;
  var row = e.target.closest("[data-proj-cat-id]");
  if(!row) return;
  var id = row.dataset.projCatId;
  if(e.target.closest("[data-pcat-up]") || e.target.closest("[data-pcat-down]")){
    var idx = -1;
    for(var i = 0; i < projCatCache.length; i++) if(projCatCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-pcat-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= projCatCache.length) return;
    var moved = projCatCache.splice(idx, 1)[0];
    projCatCache.splice(to, 0, moved);
    API.put("/api/categories/order?project=" + encodeURIComponent(projCatReqId), { ids: projCatCache.map(function(c){ return c.id; }) }).then(function(){
      loadProjCats(projCatReqId);
    }).catch(function(ex){ toast(ex.message || "排序失败", "bad"); loadProjCats(projCatReqId); });
    return;
  }
  if(e.target.closest("[data-pcat-del]")){
    var cat = null;
    for(var j = 0; j < projCatCache.length; j++) if(projCatCache[j].id === id) cat = projCatCache[j];
    if(!cat) return;
    var others = projCatCache.filter(function(c){ return c.id !== id; });
    if(!others.length){ toast("至少需要保留一个模块", "warn"); return; }
    var menu = document.createElement("div");
    menu.className = "menu";
    menu.style.minWidth = "200px";
    menu.innerHTML = '<div class="menu-title">迁移到</div>' + others.map(function(c){
      return '<button class="menu-item" type="button" data-pcat-target="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    }).join("");
    UI.openPop(menu, e.target.closest("[data-pcat-del]"), { onClose: function(){ menu.remove(); } });
    menu.addEventListener("click", function(ev){
      var b = ev.target.closest("[data-pcat-target]");
      if(!b) return;
      var target = null;
      for(var k = 0; k < others.length; k++) if(others[k].id === b.dataset.pcatTarget) target = others[k];
      if(!target) return;
      UI.closeAllPops();
      UI.showConfirm({
        title:"删除模块",
        msg:"删除模块「" + esc(cat.name) + "」？其下工作项与需求将改到「" + esc(target.name) + "」。",
        okText:"删除模块"
      }).then(function(ok){
        if(!ok) return;
        API.del("/api/categories/" + encodeURIComponent(id) + "?targetId=" + encodeURIComponent(target.id)).then(function(){
          toast("已删除模块「" + cat.name + "」，工作项与需求已迁到「" + target.name + "」", "fs");
          loadProjCats(projCatReqId);
          refreshCatDependents();
        }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
      });
    });
  }
});
$("btnProjCatAdd").addEventListener("click", function(){
  if(roleReadOnly()) return;
  var name = projCatNewName.value.trim();
  if(!name){ toast("请填写模块名称", "warn"); return; }
  API.post("/api/categories?project=" + encodeURIComponent(projCatReqId), { name: name, color: projCatNewColor.value }).then(function(){
    toast("已添加模块「" + name + "」", "fs");
    projCatNewName.value = "";
    loadProjCats(projCatReqId);
    refreshCatDependents();
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});

function openProjectDialog(id){
  projectFormSeq++;
  btnSaveReq.disabled = false;
  rt.editingReqId = id || null;
  editingReqUpdatedAt = null;
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
      editingReqUpdatedAt = r.updatedAt || null;
    }
  }
  syncReqStatusSeg();
  reqFormTitle.textContent = id ? "编辑项目" : "新建项目";
  btnSaveReq.textContent = id ? "保存" : "新建项目";
  btnCancelReqEdit.hidden = !id;
  /* 模块按项目配置：新建时项目尚不存在（首建后后端预置「其他」），仅编辑态展示 */
  if(projCatCfg) projCatCfg.hidden = !id;
  if(id) loadProjCats(id);
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
  var cockpit = e.target.closest("[data-req-cockpit]");
  if(cockpit){
    rt.managerProjectId = cockpit.dataset.reqCockpit;
    showView("project");
    return;
  }
  var sort = e.target.closest("[data-project-sort]");
  if(sort){ setProjectSort(sort.dataset.projectSort); return; }
  var activity = e.target.closest("[data-req-activity]");
  if(activity){
    var project = rt.reqList.filter(function(r){ return r.id === activity.dataset.reqActivity; })[0];
    activityUI.openDialog(project ? project.name : "项目", "/api/projects/" + encodeURIComponent(activity.dataset.reqActivity) + "/activities");
    return;
  }
  var quick = e.target.closest("[data-req-quick]");
  if(quick){
    var qinp = quick.parentNode.querySelector("[data-req-new-input]");
    if(qinp) qinp.focus();
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
    state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = []; state.columns = []; state.completion = ""; state.due = null; state.focus = false; state.blocked = false;
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
  var toDemands = e.target.closest("[data-req-demands]");
  if(toDemands){
    openDemandsForReq(toDemands.dataset.reqDemands);
    showView("demands");
    toast("已按项目筛选需求池：" + reqNameById(toDemands.dataset.reqDemands));
    return;
  }
  var dl = e.target.closest("[data-del-req]");
  if(dl) deleteReq(dl.dataset.delReq);
});
/* 项目拖拽排序：只有把手可拖，避免误触按钮/文本选择 */
reqListEl.addEventListener("dragstart", function(e){
  var handle = e.target.closest("[data-req-drag]");
  var row = handle && handle.closest("[data-req-id]");
  if(!handle || !row || !reorderEnabled() || orderSaving){
    e.preventDefault();
    return;
  }
  dragReqState = { id: row.dataset.reqId, order: listedReqs().map(function(r){ return r.id; }) };
  row.classList.add("dragging");
  document.body.classList.add("proj-reordering");
  if(e.dataTransfer){
    e.dataTransfer.effectAllowed = "move";
    try{ e.dataTransfer.setData("text/plain", dragReqState.id); }catch(err){ /* 老浏览器 */ }
    try{ e.dataTransfer.setDragImage(row, 20, 20); }catch(err){ /* 老浏览器 */ }
  }
});
reqListEl.addEventListener("dragover", function(e){
  if(!dragReqState) return;
  var row = e.target.closest("[data-req-id]");
  if(!row || row.classList.contains("dragging")) return;
  e.preventDefault();
  if(e.dataTransfer) e.dataTransfer.dropEffect = "move";
  clearDropMarks();
  var box = row.getBoundingClientRect();
  row.classList.add((e.clientY - box.top) > box.height / 2 ? "drop-after" : "drop-before");
});
reqListEl.addEventListener("dragleave", function(e){
  var row = e.target.closest("[data-req-id]");
  if(row && !row.contains(e.relatedTarget)) row.classList.remove("drop-before", "drop-after");
});
reqListEl.addEventListener("drop", function(e){
  if(!dragReqState) return;
  e.preventDefault();
  var row = e.target.closest("[data-req-id]");
  var drag = dragReqState;
  var ontoSelf = !row || row.classList.contains("dragging");
  endProjectDrag();
  if(ontoSelf) return;
  var box = row.getBoundingClientRect();
  applyProjectDrop(drag, row.dataset.reqId, (e.clientY - box.top) > box.height / 2);
});
reqListEl.addEventListener("dragend", endProjectDrag);
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
    toast(ex.message || "新建失败", "bad");
  });
});

export { enterProjectsView, openProjectDialog, refreshExpandedProjectTasks, renderReqList };
