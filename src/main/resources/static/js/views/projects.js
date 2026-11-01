/* views/projects · 项目视图 */

import { API } from "../core/api.js";
import { $, iReq, reqExpanded, reqListEl, searchInput, searchWrap } from "../core/dom.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { showView } from "../core/router.js";
import { reqNameById, rt, state, taskCacheExtra } from "../core/state.js";
import { openTaskDrawer, populateReqSelect } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { reqStatusName } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import { loadReqDocs, openNewReqDocDialog, openReqDocAndJump, reqDocList, reqDocStatusLabel } from "./requirements.js";

var rName = $("rName"), rDesc = $("rDesc"), fReqName = $("fReqName"),
    segReqStatus = $("segReqStatus"), btnSaveReq = $("btnSaveReq"),
    btnCancelReqEdit = $("btnCancelReqEdit"), reqFormTitle = $("reqFormTitle");
function syncReqStatusSeg(){
  segReqStatus.querySelectorAll("[data-rst]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.rst === rt.formReqStatus);
  });
}
function resetReqForm(){
  rt.editingReqId = null;
  rName.value = ""; rDesc.value = "";
  rt.formReqStatus = "active";
  fReqName.classList.remove("invalid");
  syncReqStatusSeg();
  reqFormTitle.textContent = "新增项目";
  btnSaveReq.textContent = "添加项目";
  btnCancelReqEdit.hidden = true;
  if($("dlgProject")) UI.closeModal($("dlgProject"));
  renderReqList();
}
function renderReqList(){
  var countEl = $("reqCount");
  if(countEl) countEl.textContent = rt.reqList.length ? "共 " + rt.reqList.length + " 个" : "";
  if(!rt.reqList.length){
    reqListEl.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"点右上角「新建项目」创建第一个；展开项目可以查看需求文档与任务进度。"
    });
    return;
  }
  reqListEl.innerHTML = rt.reqList.map(function(r){
    var open = !!reqExpanded[r.id];
    var docs = (reqDocList || []).filter(function(d){ return d.reqId === r.id; });
    var docHTML = docs.length ? docs.map(function(d){
      return '<button class="req-expand-doc" type="button" data-reqdoc-open="' + esc(d.id) + '">' +
        '<span class="rd-title">' + esc(d.title) + '</span>' +
        '<span class="rd-meta">' + esc(reqDocStatusLabel(d.status)) +
          (Number(d.taskCount) ? (" · " + Number(d.doneCount || 0) + "/" + Number(d.taskCount) + " 任务") : "") +
        '</span></button>';
    }).join("") : '<p class="foot-note" style="margin:4px 0">还没有需求文档。</p>';
    return '<div class="req-item' + (rt.editingReqId === r.id ? " editing" : "") + '" data-req-id="' + esc(r.id) + '">' +
      '<div class="req-top">' +
        '<button class="icon-btn sm req-expand-btn' + (open ? " on" : "") + '" type="button" data-req-expand="' + esc(r.id) + '" aria-expanded="' + open + '" title="展开项目详情">' +
          icon("chevronRight", 14) + '</button>' +
        '<span class="req-name">' + esc(r.name) + '</span>' +
        '<span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' +
          reqStatusName(r.status) + '</span>' +
        '<span class="req-acts">' +
          '<button class="icon-btn sm" type="button" data-edit-req="' + esc(r.id) + '" title="编辑项目" aria-label="编辑项目">' + icon("edit", 14) + '</button>' +
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
        '<span>' + r.taskCount + ' 任务 · ' + r.doneCount + ' 完成' +
          (Number(r.docCount) ? (' · ' + r.docCount + ' 需求文档') : '') + '</span>' +
      '</div>' +
      '<div class="req-taskbar">' +
        '<input type="text" maxlength="60" data-req-new-input="' + esc(r.id) + '"' +
          ' placeholder="在此项目下新建任务，回车确认" aria-label="在项目 ' + esc(r.name) + ' 下新建任务" />' +
        '<button class="icon-btn sm" type="button" data-req-open="' + esc(r.id) + '" title="打开完整新建抽屉" aria-label="打开完整新建抽屉">' +
          icon("edit", 14) + '</button>' +
      '</div>' +
      (open ? '<div class="req-expand" data-req-expand-body="' + esc(r.id) + '">' +
        '<div class="req-expand-head"><span>需求文档</span>' +
          '<button class="btn sm ghost" type="button" data-doc-new="' + esc(r.id) + '">+ 新增需求</button></div>' +
        docHTML +
        '<div class="req-expand-acts">' +
          '<button class="btn sm primary" type="button" data-req-board="' + esc(r.id) + '">在看板中查看</button>' +
          '<button class="btn sm" type="button" data-req-docs="' + esc(r.id) + '">管理需求文档</button>' +
        '</div>' +
      '</div>' : '') +
    '</div>';
  }).join("");
}
function enterProjectsView(){
  if(rt.reqsLoaded) renderReqList();
  else reqListEl.innerHTML = UI.skeletonRows(3);
  loadReqs();
  /* IA-2：项目行展开要显示需求文档与任务进度 */
  loadReqDocs().then(function(){ renderReqList(); });
}
function saveReq(){
  var name = rName.value.trim();
  if(!name){
    fReqName.classList.add("invalid");
    try{ rName.focus(); }catch(e){ /* noop */ }
    return;
  }
  var body = { name: name, description: rDesc.value.trim(), status: rt.formReqStatus };
  var editing = !!rt.editingReqId;
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
function deleteReq(id){
  var r = null;
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
  if(!r) return;
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可删除项目", "warn"); return; }
  /* 后端删除项目会连带删除其下需求文档；确认框必须把这件事说清楚。
     docCount 来自项目列表，reqDocList 是本会话已加载的需求，取较大值防止列表快照过期。 */
  var liveDocs = (reqDocList || []).filter(function(d){ return d.reqId === id; }).length;
  var docs = Math.max(Number(r.docCount) || 0, liveDocs);
  var msg = "删除项目「" + esc(r.name) + "」？其下任务会保留，仅解除关联。";
  if(docs){
    msg += "<br><br>其下 <b>" + docs + "</b> 份需求文档会一并删除，<b>不可恢复</b>。";
  }
  UI.showConfirm({
    title:"删除项目",
    msg: msg,
    okText: docs ? "删除项目与需求文档" : "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/reqs/" + encodeURIComponent(id)).then(function(res){
      var deletedDocs = res && typeof res.docs === "number" ? res.docs : docs;
      toast("已删除项目「" + r.name + "」，其下任务已解除关联" +
        (res && res.unlinked ? "（" + res.unlinked + " 项）" : "") +
        (deletedDocs ? "；同时删除 " + deletedDocs + " 份需求文档" : ""), "fs");
      if(rt.editingReqId === id) resetReqForm();
      loadReqDocs(true);
      loadReqs().then(function(){
        renderReqList();
        loadBoard({silent:true});
      });
    }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
function openProjectDialog(id){
  rt.editingReqId = id || null;
  rName.value = "";
  rDesc.value = "";
  rt.formReqStatus = "active";
  fReqName.classList.remove("invalid");
  if(id){
    var r = null;
    for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
    if(r){ rName.value = r.name; rDesc.value = r.description || ""; rt.formReqStatus = r.status || "active"; }
  }
  syncReqStatusSeg();
  reqFormTitle.textContent = id ? "编辑项目" : "新增项目";
  btnSaveReq.textContent = id ? "保存修改" : "添加项目";
  btnCancelReqEdit.hidden = !id;
  UI.openModal($("dlgProject"), "input");
  setTimeout(function(){ try{ rName.focus(); }catch(e){ /* noop */ } }, 40);
}
if($("btnReqNew")) $("btnReqNew").addEventListener("click", function(){ openProjectDialog(null); });
if($("dlgProjectX")) $("dlgProjectX").addEventListener("click", function(){ resetReqForm(); });
btnSaveReq.addEventListener("click", saveReq);
btnCancelReqEdit.addEventListener("click", resetReqForm);
rName.addEventListener("input", function(){ fReqName.classList.remove("invalid"); });
segReqStatus.addEventListener("click", function(e){
  var b = e.target.closest("[data-rst]"); if(!b) return;
  rt.formReqStatus = b.dataset.rst; syncReqStatusSeg();
});
reqListEl.addEventListener("click", function(e){
  var openNew = e.target.closest("[data-req-open]");
  if(openNew){
    var rid = openNew.dataset.reqOpen;
    openTaskDrawer("backlog");
    populateReqSelect();
    iReq.value = rid;
    return;
  }
  var ed = e.target.closest("[data-edit-req]");
  if(ed){
    var r = null;
    for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === ed.dataset.editReq) r = rt.reqList[i];
    if(r){
      rt.editingReqId = r.id;
      rName.value = r.name;
      rDesc.value = r.description || "";
      rt.formReqStatus = r.status || "active";
      fReqName.classList.remove("invalid");
      syncReqStatusSeg();
      reqFormTitle.textContent = "编辑项目";
      btnSaveReq.textContent = "保存修改";
      btnCancelReqEdit.hidden = false;
      UI.openModal($("dlgProject"), "input");
      try{ rName.focus(); }catch(e2){ /* noop */ }
    }
    return;
  }
  var ex = e.target.closest("[data-req-expand]");
  if(ex){
    var rid0 = ex.dataset.reqExpand;
    reqExpanded[rid0] = !reqExpanded[rid0];
    renderReqList();
    return;
  }
  var docNew = e.target.closest("[data-doc-new]");
  if(docNew){ openNewReqDocDialog(docNew.dataset.docNew); return; }
  var docOpen = e.target.closest("[data-reqdoc-open]");
  if(docOpen){ openReqDocAndJump(docOpen.dataset.reqdocOpen); return; }
  var toBoard = e.target.closest("[data-req-board]");
  if(toBoard){
    var rid1 = toBoard.dataset.reqBoard;
    state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.due = null; state.focus = false; state.blocked = false;
    searchInput.value = "";
    searchWrap.classList.remove("has");
    state.reqs = [rid1];
    showView("board");
    reloadFilteredViews();
    toast("已按项目筛选看板：" + reqNameById(rid1));
    return;
  }
  var manage = e.target.closest("[data-req-docs]");
  if(manage){ showView("requirements"); return; }
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
  inp.disabled = true;
  API.post("/api/tasks", {
    title: v.slice(0, 60), boardColumn: "backlog", priority: "P2", progress: 0, reqId: reqId
  }).then(function(nt){
    inp.disabled = false;
    inp.value = "";
    taskCacheExtra[nt.id] = nt;
    toast("已在项目中新建「" + nt.title + "」", "fs");
    loadReqs().then(function(){ renderReqList(); loadBoard({silent:true}); });
  }).catch(function(ex){
    inp.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});

export { enterProjectsView, openProjectDialog, renderReqList };
