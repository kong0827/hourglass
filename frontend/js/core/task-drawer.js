/* core/task-drawer · 任务详情抽屉、评论、检查清单、附件、工时 */

import { API } from "./api.js";
import { openAttPreview, previewable } from "./att-preview.js";
import { companyChipHTML, companyNameOf } from "../lib/company.js";
import { $, attachCount, attachList, btnCommentAttach, btnCommentSend, btnDeleteTask, btnTaskNew, btnSaveTask, btnSaveTaskContinue, btnTaskWatch, btnTimer, btnTimerAdd, commentAttachChips, commentAttachTip, commentCount, commentList, commentMention, dlgTimeAdd, dlgTimeAddCancel, dlgTimeAddOk, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iCommentFiles, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTimeDate, iTimeHours, iTimeNote, iTimeUser, iTitle, progVal, segCat, segDue, segPri, segProg, segRecur, segStart, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, taskWatchLabel, timelineBox, workLogList, workVal } from "./dom.js";
import { icon } from "./icons.js";
import { canEditReq, canEditTask, catNameById, colRuleOf, reqNameById, rt, state, taskById, taskCacheExtra, timerAllowed } from "./state.js";
import { loadRunningTimer } from "./task-actions.js";
import { guard, serverDecision } from "./transitions.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "./ui.js";
import { normalizedIds, taskVersionIds, taskVersionsText, sameIds, selectedVersionIds, taskPublicationHTML, releaseSnapshotHTML, fmtReleaseTime, COLUMNS, ITEM_TYPE_DESCS, PRIORITIES, avatarHTML, colMeta, dayDiff, docTypeName, duePresetDate, fmtMinutes, fmtMinutesShort, fmtSize, fmtTs, itemTypeInfoHTML, pad2, parseDate, priColor, priName, startPresetDate, versionPhaseInfoHTML, weekdayCN } from "../lib/format.js";
import { GS } from "../lib/gantt-shared.js";
import { loadBoard, loadReqs } from "../views/board.js";
import { loadView, viewModule } from "./view-loader.js";
import { refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { refreshListIfOpen } from "../views/list.js";

/* 抽屉未保存改动的视觉同步：.drawer 加 .dirty，页脚 hint 变警示文案 */
function syncDrawerDirty(){
  var dirty = !!rt.formDirty;
  var drawerEl = taskDrawer.querySelector(".drawer");
  if(drawerEl) drawerEl.classList.toggle("dirty", dirty);
  if(taskFormHint){
    taskFormHint.classList.toggle("dirty", dirty);
    taskFormHint.textContent = dirty ? "有未保存的改动" : "";
  }
}
/* 每次标记改动自增：保存期间又编辑时，不能把新改动误当成已保存 */
var formRev = 0;
/* 语义脏检查：事件只是「可能改过」的提示，是否真的脏由当前值和基线比较决定。
   打开抽屉时 / 保存成功后记基线；选项异步回填、浏览器补发 change、
   重复点已选中的分段按钮都不会误报，改回原值也会恢复为干净。 */
var formBase = null;
function formReady(sel){ return !!(sel && sel.getAttribute("data-ready") === "1"); }
function formProgressValue(){
  var done = iCol && iCol.value === "done";
  return (done && startedDone) ? origProgress : (Number(iProg && iProg.value) || 0);
}
function formSnapshot(){
  var snap = {
    title: (iTitle.value || "").trim(),
    desc: (iDesc.value || "").trim(),
    start: iStart.value || "",
    due: iDue.value || "",
    milestone: !!($("iMilestone") || {}).checked,
    estimate: (function(){ var h = iEstimate ? Number(iEstimate.value) : 0; return h > 0 ? Math.round(h * 60) : 0; })(),
    pri: rt.formPri || "",
    cat: rt.formCat || "",
    col: (iCol && iCol.value) || "",
    req: (iReq && iReq.value) || "",
    owner: (function(){ var o = ownerPick(); return (o.userId || "") + "\u0001" + (o.name || ""); })(),
    type: (iItemType && iItemType.value) || "task",
    severity: (iSeverity && iSeverity.value) || "",
    environment: (iEnvironment && iEnvironment.value || "").trim(),
    repro: (iReproSteps && iReproSteps.value || "").trim(),
    regression: (iRegression && iRegression.value) || "",
    prog: formProgressValue(),
    note: (iNote.value || "").trim(),
    /* 评论草稿与待上传附件也纳入基线：关闭/切页前不能静默丢掉 */
    comment: (iComment && iComment.value || "").trim(),
    commentFiles: pendingCommentFiles.map(function(f){ return f.name + "\u0001" + f.size; }).join("\u0001"),
    recur: rt.formRecur || "",
    remind: (iRemind && iRemind.value) || "",
    remindTarget: (iRemindTarget && iRemindTarget.value) || "owner",
    blocked: !!(iBlocked && iBlocked.checked),
    blockedReason: (iBlocked && iBlocked.checked && iBlockedReason) ? (iBlockedReason.value || "").trim() : "",
    tags: rt.tagsCache.slice(0, 8).join("\u0001"),
    reason: ($("iVersionChangeReason") || {}).value || "",
    /* 新建时暂存的依赖：增删后回到原始组合，不应再提示「有未保存的改动」 */
    deps: (depState && depState.pending ? depState.pending : []).map(function(p){
      return p.direction + ":" + p.task.id + ":" + p.depType + ":" + (Number(p.lagDays) || 0);
    }).join("\u0001")
  };
  var vsel = $("iVersion");
  if(formReady(vsel)) snap.version = selectedVersionIds(vsel).slice().sort().join("\u0001");
  var fsel = $("iFoundVersion");
  if(formReady(fsel)) snap.found = fsel.value || "";
  var esel = $("iEpic");
  if(formReady(esel)) snap.epic = esel.value || "";
  var dsel = $("iDemand");
  if(formReady(dsel)) snap.demand = dsel.value || "";
  var rsel = $("iReqDoc");
  if(formReady(rsel)) snap.reqdoc = rsel.value || "";
  var bsel = $("iBranch");
  if(formReady(bsel)) snap.branch = bsel.value || "";
  return snap;
}
/* 只比较表单字段：重新加载会用服务器内容覆盖表单，但评论草稿会按任务保留 */
function formFieldsDirty(){
  if(!formBase) return false;
  var cur = formSnapshot();
  for(var k in formBase){
    if(k === "comment" || k === "commentFiles") continue;
    if(cur[k] === undefined) continue;
    if(formBase[k] !== cur[k]) return true;
  }
  return false;
}
/* 409 冲突：列出服务器相对本次打开时已变化的字段，供用户选择重载或覆盖 */
var CONFLICT_FIELDS = [
  ["title", "标题"], ["description", "描述"], ["priority", "优先级"], ["categoryId", "模块"],
  ["owner", "负责人"], ["boardColumn", "状态"], ["startDate", "开始日期"], ["dueDate", "截止日期"],
  ["reqId", "所属项目"], ["itemType", "类型"], ["severity", "严重度"], ["environment", "环境"],
  ["progress", "进度"], ["estimateMinutes", "预计耗时"], ["note", "备注"], ["branchId", "分支"],
  ["epicId", "史诗"], ["demandId", "需求"], ["versionIds", "版本"], ["tags", "标签"]
];
function conflictValue(v){
  if(v === null || v === undefined) return "";
  if(Object.prototype.toString.call(v) === "[object Array]") return v.slice().sort().join("\u0001");
  return String(v);
}
function conflictChangedLabels(before, after){
  var labels = [];
  CONFLICT_FIELDS.forEach(function(pair){
    if(conflictValue(before && before[pair[0]]) !== conflictValue(after && after[pair[0]])) labels.push(pair[1]);
  });
  return labels;
}
function resetFormBaseline(){
  formBase = formSnapshot();
  lastReqValue = (iReq && iReq.value) || "";
  var dsel = $("iDemand");
  lastDemandValue = (dsel && dsel.value) || "";
  lastVersionKey = versionKeyOf($("iVersion"));
  syncDrawerDirty();
}
var formAsyncFields = [
  ["iVersion", "version"], ["iFoundVersion", "found"], ["iEpic", "epic"],
  ["iDemand", "demand"], ["iReqDoc", "reqdoc"], ["iBranch", "branch"]
];
/* 记录关联下拉最后一次「已确认」的值：选项重建 / 异步回填也可能触发 change，
   这类伪事件不能当成用户选择去清空版本、史诗、需求等关联。 */
var lastReqValue = null, lastDemandValue = null, lastVersionKey = null;
function versionKeyOf(sel){ return selectedVersionIds(sel).slice().sort().join("\u0001"); }
function formSettling(target){
  if(!target || !target.id) return false;
  for(var i = 0; i < formAsyncFields.length; i++){
    if(formAsyncFields[i][0] === target.id) return !formReady(target);
  }
  return false;
}
/* 需求目标版本继承属于程序化回填，不计入用户改动（版本选择器会被重新填充一次） */
var versionBaseGen = 0, versionBaseAbsorbed = 0;
/* 未就绪的异步下拉不参与基线：就绪后把回填值吸收为基线，避免「刚加载完就被判脏」。
   只吸收「基线里本来没有」或「程序化预填」的值；已经就绪过的字段再次重载
   （换项目等）要保留基线，否则关联被清空后切回原项目会被误判为没改过。 */
function absorbSettledFields(){
  if(!formBase) return;
  var cur = formSnapshot(), changed = false;
  formAsyncFields.forEach(function(pair){
    var sel = $(pair[0]);
    if(!sel || !formReady(sel) || cur[pair[1]] === undefined) return;
    /* 重载完成后的当前值即「已确认值」，后续伪 change 不应再被当成用户选择 */
    if(pair[1] === "version") lastVersionKey = cur.version;
    else if(pair[1] === "demand") lastDemandValue = cur.demand;
    var pending = formBase[pair[1]] === undefined;
    if(pair[1] === "version" && versionBaseAbsorbed < versionBaseGen) pending = true;
    if(!pending) return;
    formBase[pair[1]] = cur[pair[1]];
    changed = true;
    if(pair[1] === "version") versionBaseAbsorbed = versionBaseGen;
  });
  if(changed) syncDrawerDirty();
}
if(typeof window !== "undefined" && window.MutationObserver){
  formAsyncFields.forEach(function(pair){
    var sel = $(pair[0]);
    if(!sel) return;
    new MutationObserver(absorbSettledFields).observe(sel, { attributes:true, attributeFilter:["data-ready"], childList:true, subtree:true });
  });
}
(function watchFormDirty(){
  var desc = Object.getOwnPropertyDescriptor(rt, "formDirty");
  if(desc && desc.set && desc.get) return; // 已被监听
  var val = rt.formDirty;
  Object.defineProperty(rt, "formDirty", {
    get: function(){
      if(!val) return false;
      if(!formBase) return true;
      var cur = formSnapshot();
      for(var k in formBase){
        if(cur[k] === undefined) continue; // 异步下拉重新加载中：先不据此判脏
        if(formBase[k] !== cur[k]) return true;
      }
      return false;
    },
    set: function(v){
      if(v) formRev++;
      val = !!v;
      syncDrawerDirty();
    }
  });
})();
function setSaveLoading(loading){
  if(loading){
    if(!btnSaveTask.dataset.saveText) btnSaveTask.dataset.saveText = btnSaveTask.textContent.trim();
    btnSaveTask.textContent = "保存中…";
    btnSaveTask.disabled = true;
    btnSaveTask.classList.add("loading");
    if(btnSaveTaskContinue){
      btnSaveTaskContinue.disabled = true;
      btnSaveTaskContinue.classList.add("loading");
    }
  }else{
    btnSaveTask.textContent = btnSaveTask.dataset.saveText || "保存工作项";
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
    if(btnSaveTaskContinue){
      btnSaveTaskContinue.disabled = false;
      btnSaveTaskContinue.classList.remove("loading");
    }
  }
}
function focusField(el){
  if(!el) return;
  try{
    el.focus();
    if(el.scrollIntoView) el.scrollIntoView({behavior:"smooth", block:"nearest", inline:"nearest"});
  }catch(err){ /* noop */ }
}

function currentReqId(){ return $("iReq") ? ($("iReq").value || "") : ""; }
/* 关联需求/关联文档的「查看」按钮：有选中值才出现；下拉被模块异步填充时由填充方回调同步 */
function syncAssocViewBtns(){
  [["iDemand", "iDemandView"], ["iReqDoc", "iReqDocView"]].forEach(function(p){
    var sel = $(p[0]), btn = $(p[1]);
    if(btn) btn.hidden = !(sel && sel.value);
  });
}
function assocStillCurrent(seq, taskId, reqId){
  return seq === rt.taskFormSeq
    && (rt.editingId || null) === (taskId || null)
    && currentReqId() === (reqId || "");
}
function ensureReqDoc(v){
  var sel = $("iReqDoc");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, taskId = rt.editingId, reqId = currentReqId();
  loadView("requirements").then(function(m){
    if(assocStillCurrent(seq, taskId, reqId)) m.ensureReqDocOptions(v);
  });
}
var reqDocPickerEl = null;
var reqDocPickerSeq = 0;
function selectableReqDoc(doc){
  if(!doc || !doc.reqId || !iReq) return false;
  return Array.prototype.some.call(iReq.options, function(o){ return o.value === doc.reqId; });
}
function reqDocPickerProjectName(doc){
  var project = rt.reqList.find(function(r){ return r.id === doc.reqId; });
  return (project && project.name) || doc.reqName || "未归属项目";
}
function renderReqDocPickerScope(el){
  var scope = el.querySelector("[data-req-doc-scope]");
  if(!scope) return;
  var current = currentReqId();
  var projects = {}, ids = [];
  el._docs.filter(selectableReqDoc).forEach(function(doc){
    if(projects[doc.reqId]) return;
    projects[doc.reqId] = { id:doc.reqId, name:reqDocPickerProjectName(doc) };
    ids.push(doc.reqId);
  });
  ids.sort(function(a, b){
    if(a === current) return -1;
    if(b === current) return 1;
    return projects[a].name.localeCompare(projects[b].name, "zh-CN");
  });
  var previous = scope.value;
  scope.innerHTML = '<option value="">全部项目</option>' + ids.map(function(id){
    return '<option value="' + esc(id) + '">' + esc(projects[id].name) + (id === current ? "（当前）" : "") + '</option>';
  }).join("");
  scope.value = ids.indexOf(previous) >= 0 ? previous : "";
}
function renderReqDocPickerResults(el){
  var box = el.querySelector("[data-req-doc-results]");
  var count = el.querySelector("[data-req-doc-count]");
  if(!box) return;
  if(el._loading){
    box.innerHTML = UI.skeletonRows(4);
    if(count) count.textContent = "加载中";
    return;
  }
  if(el._error){
    box.innerHTML = '<div class="req-doc-picker-error">' + esc(el._error) +
      '<br><button class="btn sm" type="button" data-req-doc-retry>重新加载</button></div>';
    if(count) count.textContent = "加载失败";
    return;
  }
  var query = (el.querySelector("[data-req-doc-search]").value || "").trim().toLowerCase();
  var scope = el.querySelector("[data-req-doc-scope]").value;
  var current = currentReqId();
  var selectedId = ($("iReqDoc") || {}).value || "";
  var docs = el._docs.filter(selectableReqDoc).filter(function(doc){
    if(scope && doc.reqId !== scope) return false;
    if(!query) return true;
    return (doc.title || "").toLowerCase().indexOf(query) >= 0
      || reqDocPickerProjectName(doc).toLowerCase().indexOf(query) >= 0
      || docTypeName(doc.docType).toLowerCase().indexOf(query) >= 0;
  });
  docs.sort(function(a, b){
    if(a.reqId === current && b.reqId !== current) return -1;
    if(b.reqId === current && a.reqId !== current) return 1;
    var byProject = reqDocPickerProjectName(a).localeCompare(reqDocPickerProjectName(b), "zh-CN");
    if(byProject) return byProject;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  if(count) count.textContent = docs.length + " 篇";
  var html = '<button type="button" class="req-doc-picker-clear' + (!selectedId ? " selected" : "") + '"' +
    ' data-req-doc-clear aria-pressed="' + (!selectedId) + '">' +
    icon("close", 13) + '<span>不关联文档</span></button>';
  if(!docs.length){
    html += '<div class="req-doc-picker-empty">' +
      (el._docs.length ? "没有找到匹配文档，试试文档标题、项目名或文档类型。" : "当前暂无可关联文档，可先到文档页新建。") +
      ((query || scope) ? '<br><button class="btn sm" type="button" data-req-doc-reset>清除搜索与筛选</button>'
        : '<br><button class="btn sm" type="button" data-req-doc-retry>刷新文档列表</button>') +
      '</div>';
    box.innerHTML = html;
    return;
  }
  var lastReqId = null;
  docs.forEach(function(doc){
    if(doc.reqId !== lastReqId){
      lastReqId = doc.reqId;
      var n = docs.filter(function(d){ return d.reqId === lastReqId; }).length;
      html += '<div class="req-doc-picker-group">' + esc(reqDocPickerProjectName(doc)) +
        (doc.reqId === current ? " · 当前项目" : "") + ' · ' + n + ' 篇</div>';
    }
    var selected = doc.id === selectedId;
    html += '<button type="button" class="req-doc-picker-option' + (selected ? " selected" : "") + '"' +
      ' data-req-doc-id="' + esc(doc.id) + '" aria-pressed="' + selected + '">' +
      '<span class="req-doc-picker-option-main">' +
        '<span class="req-doc-picker-option-title">' + esc(doc.title || "未命名文档") + '</span>' +
        '<span class="req-doc-picker-option-meta">' + esc(docTypeName(doc.docType)) + '</span>' +
      '</span>' + (selected ? icon("check", 15) : "") + '</button>';
  });
  box.innerHTML = html;
}
function loadReqDocPickerData(el, module, seq, force){
  el._loading = true;
  el._error = "";
  renderReqDocPickerResults(el);
  module.loadReqDocs(!!force).then(function(){
    if(seq !== reqDocPickerSeq || reqDocPickerEl !== el) return;
    if(module.reqDocsError) throw module.reqDocsError;
    if(!module.reqDocsLoaded) throw new Error("文档加载失败");
    el._docs = (module.reqDocList || []).slice();
    el._loading = false;
    renderReqDocPickerScope(el);
    renderReqDocPickerResults(el);
  }).catch(function(ex){
    if(seq !== reqDocPickerSeq || reqDocPickerEl !== el) return;
    el._loading = false;
    el._error = (ex && ex.message) || "文档加载失败";
    renderReqDocPickerResults(el);
  });
}
function chooseReqDoc(el, docId){
  var doc = docId ? el._docs.find(function(d){ return d.id === docId; }) : null;
  if(docId && !doc) return;
  var sel = $("iReqDoc");
  if(!sel) return;
  var oldReqId = currentReqId();
  var changedProject = !!(doc && doc.reqId !== oldReqId);
  var task = rt.editingId ? taskCacheExtra[rt.editingId] : null;
  if(changedProject){
    iReq.value = doc.reqId;
    iReq.dispatchEvent(new Event("change", { bubbles:true }));
  }
  ensureReqDoc(docId);
  sel.value = docId;
  sel.dispatchEvent(new Event("change", { bubbles:true }));
  rt.formDirty = true;
  syncAssocViewBtns();
  UI.closeAllPops();
  var anchor = $("iReqDocPicker");
  if(anchor) anchor.focus({ preventScroll:true });
  if(changedProject) toast("已关联文档，所属项目已同步为「" + reqDocPickerProjectName(doc) + "」；请确认版本、史诗和关联需求", "fs");
}
function openReqDocPicker(){
  if(rt.drawerReadOnly) return;
  if(reqDocPickerEl && UI.popOpen(reqDocPickerEl)){ UI.closeAllPops(); return; }
  var anchor = $("iReqDocPicker");
  if(!anchor) return;
  var seq = ++reqDocPickerSeq;
  var el = document.createElement("div");
  el.className = "menu req-doc-picker";
  el.id = "reqDocPickerPop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "选择关联文档");
  el._docs = [];
  el._module = null;
  el._loading = true;
  el.innerHTML = '<div class="req-doc-picker-head">' +
      '<div class="req-doc-search">' + icon("search", 15) +
        '<input type="search" data-req-doc-search placeholder="搜索文档标题、项目或类型" aria-label="搜索关联文档" autocomplete="off" />' +
      '</div>' +
      '<div class="req-doc-picker-tools">' +
        '<select data-req-doc-scope aria-label="按项目筛选文档"><option value="">全部项目</option></select>' +
        '<span class="req-doc-picker-count" data-req-doc-count aria-live="polite"></span>' +
      '</div>' +
    '</div>' +
    '<div class="req-doc-picker-results" data-req-doc-results></div>' +
    '<div class="req-doc-picker-foot">无需先选项目；选择其他项目的文档时，会自动同步所属项目</div>';
  reqDocPickerEl = el;
  anchor.setAttribute("aria-controls", el.id);
  UI.openPop(el, anchor, {
    align:"left",
    width:Math.min(440, window.innerWidth - 24),
    onClose:function(){
      if(reqDocPickerEl === el){
        reqDocPickerEl = null;
        reqDocPickerSeq++;
      }
      el.remove();
    }
  });
  el.addEventListener("input", function(e){
    if(e.target.closest("[data-req-doc-search]")) renderReqDocPickerResults(el);
  });
  el.addEventListener("change", function(e){
    if(e.target.closest("[data-req-doc-scope]")) renderReqDocPickerResults(el);
  });
  el.addEventListener("keydown", function(e){
    if(e.key === "Tab"){
      var focusable = Array.prototype.slice.call(el.querySelectorAll(
        'input:not([disabled]),select:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(function(node){ return node.offsetParent !== null; });
      if(!focusable.length){ e.preventDefault(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      return;
    }
    if(e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if(e.target.closest("[data-req-doc-scope]")) return;
    var buttons = Array.prototype.slice.call(boxButtons());
    if(!buttons.length) return;
    e.preventDefault();
    var index = buttons.indexOf(document.activeElement);
    var next = e.key === "ArrowDown" ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
    buttons[next].focus();
  });
  function boxButtons(){ return el.querySelectorAll(".req-doc-picker-clear,.req-doc-picker-option"); }
  el.addEventListener("click", function(e){
    var option = e.target.closest("[data-req-doc-id]");
    if(option){ chooseReqDoc(el, option.dataset.reqDocId); return; }
    if(e.target.closest("[data-req-doc-clear]")){ chooseReqDoc(el, ""); return; }
    if(e.target.closest("[data-req-doc-reset]")){
      el.querySelector("[data-req-doc-search]").value = "";
      el.querySelector("[data-req-doc-scope]").value = "";
      renderReqDocPickerResults(el);
      el.querySelector("[data-req-doc-search]").focus();
      return;
    }
    if(e.target.closest("[data-req-doc-retry]")){
      if(el._module) loadReqDocPickerData(el, el._module, seq, true);
      else{ UI.closeAllPops(); openReqDocPicker(); }
    }
  });
  renderReqDocPickerResults(el);
  loadView("requirements").then(function(m){
    if(seq !== reqDocPickerSeq || reqDocPickerEl !== el) return;
    el._module = m;
    loadReqDocPickerData(el, m, seq, false);
  }).catch(function(ex){
    if(seq !== reqDocPickerSeq || reqDocPickerEl !== el) return;
    el._loading = false;
    el._error = (ex && ex.message) || "文档加载失败";
    renderReqDocPickerResults(el);
  });
  setTimeout(function(){
    var input = el.querySelector("[data-req-doc-search]");
    if(input) input.focus();
  }, 40);
}
var reqDocPickerBtn = $("iReqDocPicker");
if(reqDocPickerBtn) reqDocPickerBtn.addEventListener("click", openReqDocPicker);
function ensureDemand(v){
  var sel = $("iDemand");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, taskId = rt.editingId, reqId = currentReqId();
  loadView("demands").then(function(m){
    if(assocStillCurrent(seq, taskId, reqId)) m.ensureDemandOptions(v || "", reqId);
  });
}
function ensureBranch(v, projectId){
  var sel = $("iBranch");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, taskId = rt.editingId, reqId = currentReqId();
  loadView("branches").then(function(m){
    if(assocStillCurrent(seq, taskId, reqId)) m.ensureBranchOptions(v, projectId);
  });
}
function ensureVersion(keep, taskId){
  var sel = $("iVersion");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, editingId = rt.editingId, reqId = currentReqId();
  loadView("phase").then(function(m){
    if(assocStillCurrent(seq, editingId, reqId)) m.ensureVersionOptions(keep, taskId);
  });
}
function ensureEpic(keep, taskId){
  var sel = $("iEpic");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, editingId = rt.editingId, reqId = currentReqId();
  loadView("phase").then(function(m){
    if(assocStillCurrent(seq, editingId, reqId)) m.ensureEpicOptions(keep, taskId);
  });
}
function ensureFoundVersion(keep){
  var sel = $("iFoundVersion");
  if(sel) sel.removeAttribute("data-ready");
  var seq = rt.taskFormSeq, editingId = rt.editingId, reqId = currentReqId();
  loadView("phase").then(function(m){
    if(assocStillCurrent(seq, editingId, reqId)) m.ensureFoundVersionOptions(keep || "");
  });
}
var fDefect = $("fDefect"), iItemType = $("iItemType"), iSeverity = $("iSeverity");
var iEnvironment = $("iEnvironment"), iReproSteps = $("iReproSteps"), iRegression = $("iRegression");
var TYPE_META = {
  task:  { name:"任务",     placeholder:"一句话说清要做什么，例如：重构权限校验中间件" },
  story: { name:"用户故事", placeholder:"作为〈角色〉，我希望〈功能〉，以便〈价值〉" },
  bug:   { name:"缺陷",     placeholder:"描述现象，例如：企业微信扫码后回跳白屏" },
  epic:  { name:"史诗",     placeholder:"例如：支付链路重构" }
};
var TYPE_ICONS = {
  task: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.4" y="3.8" width="11.2" height="12.8" rx="2"/><path d="M7.6 3.8V2.6h4.8v1.2M7.4 8.2h5.2M7.4 11.2h3.6"/></svg>',
  story:'<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3.4h9.6v13.2L10 13.6l-4.8 3z"/></svg>',
  bug:  '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10.6" r="4.6"/><path d="M10 6V3.4M6.2 7.6 4.4 5.8M13.8 7.6l1.8-1.8M5.4 10.6H2.8M17.2 10.6h-2.6M6.2 13.6l-1.8 1.8M13.8 13.6l1.8 1.8"/></svg>',
  epic: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 3.6 6.4 10 9.8l6.4-3.4z"/><path d="m3.6 10 6.4 3.4L16.4 10"/><path d="m3.6 13.4 6.4 3.4 6.4-3.4"/></svg>'
};
function syncDefectFields(){
  var isBug = !!(iItemType && iItemType.value === "bug");
  if(fDefect) fDefect.hidden = !isBug;
  var fs = $("fSeverity");
  if(fs && (!isBug || (iSeverity && iSeverity.value))) fs.classList.remove("invalid");
  syncSeverityButtons();
}
function syncTypeButtons(){
  var group = $("typeGroup");
  if(!group) return;
  var type = (iItemType && iItemType.value) || "task";
  group.querySelectorAll("[data-type]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.type === type ? "true" : "false");
  });
}
function syncSeverityButtons(){
  var grid = $("sevGrid");
  if(!grid || !iSeverity) return;
  grid.querySelectorAll("[data-sev]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.sev === iSeverity.value ? "true" : "false");
  });
}
function syncTitleCount(){
  var el = $("iTitleCount");
  if(!el || !iTitle) return;
  var n = iTitle.value.length;
  el.textContent = n + "/60";
  el.classList.toggle("near", n >= 55);
}
/* 头部类型图标、创建标题、项目/列摘要与提交按钮文案，统一跟随当前表单状态 */
function syncDrawerHead(){
  var type = (iItemType && iItemType.value) || "task";
  var meta = TYPE_META[type] || TYPE_META.task;
  var iconEl = $("taskDrawerIcon");
  if(iconEl){
    iconEl.className = "head-icon t-" + type;
    iconEl.innerHTML = TYPE_ICONS[type] || TYPE_ICONS.task;
  }
  if(!rt.editingId && taskDrawerTitle) taskDrawerTitle.textContent = "新建" + meta.name;
  if(iTitle) iTitle.placeholder = meta.placeholder;
  var reqSel = $("iReq"), colSel = $("iCol");
  var reqName = (reqSel && reqSel.value && reqSel.selectedIndex >= 0) ? reqSel.options[reqSel.selectedIndex].textContent : "";
  var colName = (colSel && colSel.selectedIndex >= 0) ? colSel.options[colSel.selectedIndex].textContent : "";
  var sub = $("taskDrawerSub");
  if(sub){
    var parts = [];
    if(reqName) parts.push(reqName);
    if(colName) parts.push((rt.editingId ? "所在" : "创建到") + "「" + colName + "」");
    sub.textContent = parts.join(" · ");
  }
  var colLabel = $("ctxColLabel");
  if(colLabel) colLabel.textContent = rt.editingId ? "所在列" : "创建到";
  var colItem = $("ctxColItem");
  if(colItem) colItem.hidden = !!rt.editingId;
  var ctxBox = taskDrawer.querySelector(".ctx");
  if(ctxBox) ctxBox.classList.toggle("ctx-edit", !!rt.editingId);
  if(btnSaveTask){
    var saveText = rt.editingId ? "保存工作项" : ("创建" + meta.name);
    btnSaveTask.dataset.saveText = saveText;
    if(!btnSaveTask.classList.contains("loading")) btnSaveTask.textContent = saveText;
  }
}
function isoDate(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function dueQuickValue(kind){
  if(kind === "clear") return "";
  if(kind === "fri" || kind === "mon"){
    var d = new Date(rt.TODAY.getTime());
    if(kind === "fri") d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    else{
      var add = (1 - d.getDay() + 7) % 7;
      if(add === 0) add = 7;
      d.setDate(d.getDate() + add);
    }
    return isoDate(d);
  }
  return duePresetDate(kind) || "";
}
function syncDueNote(){
  var note = $("dueNote");
  if(!note || !iDue) return;
  var d = iDue.value ? parseDate(iDue.value) : null;
  if(!d || isNaN(d.getTime())){
    note.textContent = "";
    note.classList.remove("overdue");
    return;
  }
  var t = rt.editingId ? taskCacheExtra[rt.editingId] : null;
  var rule = colRuleOf(iCol && iCol.value ? iCol.value : (t && t.boardColumn), t);
  if(rule === "done" || rule === "ended"){
    /* 已完成 / 执行结束列不再提示逾期，与看板、列表、甘特口径一致 */
    note.textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + weekdayCN(d) + " · " + (rule === "done" ? "已完成" : "执行结束");
    note.classList.remove("overdue");
    return;
  }
  var diff = dayDiff(d, rt.TODAY);
  var rel = diff === 0 ? "今天到期" : diff === 1 ? "明天到期" : diff > 1 ? (diff + " 天后") : ("已逾期 " + Math.abs(diff) + " 天");
  note.textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + weekdayCN(d) + " · " + rel;
  note.classList.toggle("overdue", diff < 0);
}
function fmtFactDate(iso){
  var d = iso ? parseDate(iso) : null;
  if(!d || isNaN(d.getTime())) return iso || "—";
  return (d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/* 首屏速览：状态、进度、投入、截止、测试窗口都从当前表单实时取值 */
function syncDrawerFacts(){
  var box = $("drawerFacts");
  if(!box) return;
  box.hidden = !rt.editingId;
  if(!rt.editingId) return;
  var col = (iCol && iCol.value) || "backlog";
  var meta = colMeta(col) || { name: col, color: "#98A2B3" };
  if($("factStatusName")) $("factStatusName").textContent = meta.name || col;
  if($("factStatusDot")) $("factStatusDot").style.background = meta.color || "#98A2B3";
  var prog = Math.max(0, Math.min(100, Number(iProg && iProg.value) || 0));
  if($("factProg")) $("factProg").textContent = prog + "%";
  if($("factProgBar")) $("factProgBar").style.width = prog + "%";
  var act = Number(rt.formActualMinutes) || 0, est = Number(rt.formEstimateMinutes) || 0;
  if($("factActual")) $("factActual").textContent = act ? fmtMinutesShort(act) : "—";
  if($("factEstimate")) $("factEstimate").textContent = est ? "/ " + fmtMinutesShort(est) : "";
  var due = $("factDue"), dueWrap = $("factDueWrap"), dueNote = $("factDueNote");
  if(due && dueWrap){
    var dd = iDue && iDue.value ? parseDate(iDue.value) : null;
    dueWrap.classList.remove("overdue");
    if(!dd || isNaN(dd.getTime())){
      due.textContent = "—";
      if(dueNote) dueNote.textContent = "";
    }else{
      due.textContent = fmtFactDate(iDue.value);
      var task = taskCacheExtra[rt.editingId] || {};
      var rule = colRuleOf(col, task);
      var diff = dayDiff(dd, rt.TODAY);
      var rel = "";
      if(rule === "done") rel = "已完成";
      else if(rule === "ended") rel = "已结束";
      else if(diff === 0) rel = "今天";
      else if(diff === 1) rel = "明天";
      else if(diff > 1) rel = diff + " 天后";
      else{
        rel = "逾期 " + Math.abs(diff) + " 天";
        dueWrap.classList.add("overdue");
      }
      if(dueNote) dueNote.textContent = rel ? "· " + rel : "";
    }
  }
  var current = taskCacheExtra[rt.editingId] || {};
  var ts = current.testStartedAt || "", te = current.testFinishedAt || "";
  var testWrap = $("factTestWrap");
  if(testWrap) testWrap.hidden = !(ts || te);
  if($("factTest")) $("factTest").textContent = ts ? fmtFactDate(ts) + " → " + (te ? fmtFactDate(te) : "进行中") : "—";
}
function demandOption(){
  var sel = $("iDemand");
  if(!sel || !sel.value || sel.selectedIndex < 0) return null;
  return sel.options[sel.selectedIndex] || null;
}
/* 关联需求时展示来源卡；只有「项目」是需求真实带出的值，不夸大其余自动项 */
function syncDrawerSource(){
  var box = $("drawerSource");
  if(!box) return;
  var opt = demandOption();
  syncDemandTarget();
  if(!opt){ box.hidden = true; return; }
  box.hidden = false;
  var title = $("drawerSourceTitle"), meta = $("drawerSourceMeta");
  if(title) title.textContent = (opt.textContent || "").replace(/（[^）]*）\s*$/, "");
  var reqSel = $("iReq");
  var project = (reqSel && reqSel.value && reqSel.selectedIndex >= 0) ? reqSel.options[reqSel.selectedIndex].textContent : "";
  if(meta) meta.textContent = (project ? project + " · " : "") + "关联需求";
  syncAutoProject();
}
/* 折叠的次要关联：只报「设了哪几类」，不把具体长文本塞进首屏 */
function assocText(id){
  var sel = $(id);
  if(!sel || !sel.value || sel.selectedIndex < 0) return "";
  var opt = sel.options[sel.selectedIndex];
  return opt ? (opt.textContent || "").trim() : "";
}
function syncAssocMore(){
  var sum = $("assocMoreSummary");
  if(!sum) return;
  var names = [];
  if(assocText("iEpic")) names.push("史诗");
  if(assocText("iBranch")) names.push("分支");
  if(assocText("iReqDoc")) names.push("文档");
  sum.textContent = names.length ? "已设 " + names.join("、") : "史诗 / 分支 / 文档";
}
/* 只在抽屉读取需求目标，不对看板/列表逐卡请求；缓存随抽屉重开失效。 */
var demandTargetCache = {}, demandTargetPending = {};
var newVersionExplicit = false, newInheritedTarget = null;
function drawerDemandId(){
  var sel = $("iDemand");
  return sel && sel.getAttribute("data-ready") ? (sel.value || "") : (rt.formDemandId || "");
}
function loadDemandTarget(id){
  if(!id) return Promise.resolve(null);
  if(demandTargetCache[id]) return Promise.resolve(demandTargetCache[id]);
  if(demandTargetPending[id]) return demandTargetPending[id];
  var cacheAtRequest = demandTargetCache, pendingAtRequest = demandTargetPending;
  pendingAtRequest[id] = API.get("/api/demands/" + encodeURIComponent(id)).then(function(d){
    cacheAtRequest[id] = d;
    delete pendingAtRequest[id];
    return d;
  }, function(ex){ delete pendingAtRequest[id]; throw ex; });
  return pendingAtRequest[id];
}
function targetVersionOf(d){ return d ? (d.targetVersionId || d.versionId || "") : ""; }
function versionReasonNeeded(d){
  var task = rt.editingId ? taskCacheExtra[rt.editingId] : null;
  var sel = $("iVersion");
  if(!sel || !sel.getAttribute("data-ready")) return false;
  var ids = selectedVersionIds(sel);
  if(task) return !sameIds(taskVersionIds(task), ids);
  return !task && d && d.status === "plan" && !!targetVersionOf(d) && ids.indexOf(targetVersionOf(d)) === -1;
}
function syncVersionReason(){
  var d = demandTargetCache[drawerDemandId()];
  var field = $("fVersionChangeReason");
  if(field) field.hidden = !versionReasonNeeded(d);
}
function syncDemandTarget(){
  var el = $("iDemandTarget"), id = drawerDemandId();
  if(!el) return;
  syncVersionReason();
  if(!id){ el.textContent = "未关联需求目标版本"; return; }
  el.textContent = "需求目标版本加载中…";
  var seq = rt.taskFormSeq, taskId = rt.editingId, reqId = currentReqId();
  loadDemandTarget(id).then(function(d){
    if(!assocStillCurrent(seq, taskId, reqId) || drawerDemandId() !== id) return;
    var target = targetVersionOf(d);
    if(!rt.editingId && !newVersionExplicit && newInheritedTarget !== target && d.status === "plan"){
      newInheritedTarget = target;
      versionBaseGen++;
      ensureVersion(target ? [target] : []);
    }
    var name = d.targetVersionName || d.versionName || "";
    if(target && !name){
      var sel = $("iVersion");
      if(sel) Array.prototype.forEach.call(sel.options, function(o){ if(o.value === target) name = o.textContent; });
    }
    el.textContent = target ? "需求目标版本：" + (name || target) + "（只读，任务计划可按理由调整）" : "需求尚未设置目标版本";
    syncVersionReason();
  }).catch(function(ex){
    if(assocStillCurrent(seq, taskId, reqId) && drawerDemandId() === id) el.textContent = "需求目标加载失败：" + (ex.message || "请重开抽屉重试");
  });
}
function syncTaskPublication(task){
  var box = $("taskPublication");
  if(!box) return;
  /* 没有正式发布事实时不占首屏；确有发布历史时由 loadTaskReleaseRecords 再展开 */
  var hasPub = !!(task && (task.publishedAt || task.everPublished
    || (Array.isArray(task.publicationTargets) && task.publicationTargets.length)));
  box.hidden = !task || !hasPub;
  if(!task) return;
  $("taskPublishedBadge").innerHTML = taskPublicationHTML(task);
  $("taskPublicationInfo").textContent = "正式发布记录派生的只读事实；已完成不等于生产生效，执行状态可独立修改。"
    + (task.publishedAt ? " 最近生产发布：" + fmtReleaseTime(task.publishedAt) + "。" : "")
    + (Array.isArray(task.publicationTargets) && task.publicationTargets.length ? " 目标：" + task.publicationTargets.map(function(t){ return typeof t === "string" ? t : (t.targetKey || t.key || "") + "（" + (t.state || t.publicationState || "unknown") + "）"; }).join("、") : "");
}
function loadTaskReleaseRecords(task){
  var box = $("taskReleaseRecords");
  if(!box) return;
  box.innerHTML = "";
  if(!task) return;
  var seq = rt.taskFormSeq, reqId = currentReqId();
  box.textContent = "交付记录加载中…";
  Promise.all([
    API.get("/api/task/" + encodeURIComponent(task.id)),
    API.get("/api/tasks/" + encodeURIComponent(task.id) + "/release-records")
  ]).then(function(results){
    if(!assocStillCurrent(seq, task.id, reqId)) return;
    var fresh = results[0], records = results[1] || [];
    if(!fresh || (fresh.reqId || "") !== (task.reqId || "")){
      box.textContent = "工作项已变化或不可见，请刷新详情后查看交付记录。";
      showDrawerNotice("工作项已变化，请刷新后继续操作");
      return;
    }
    if(fresh){
      var current = taskCacheExtra[task.id];
      ["publicationState", "everPublished", "publicationTargets", "publishedAt", "publishSource", "publishedReleaseId"].forEach(function(key){ current[key] = fresh[key]; });
      syncTaskPublication(current);
    }
    box.innerHTML = records.length ? '<h4>正式发布历史（含失败 / 测试 / 回滚）</h4>' + records.map(function(record){ return releaseSnapshotHTML(record, task.id); }).join("") : '<p class="hint">未留正式发布记录，不反推或伪造历史。</p>';
    if(records.length) $("taskPublication").hidden = false;
  }).catch(function(ex){
    if(assocStillCurrent(seq, task.id, reqId)) box.textContent = "交付记录加载失败：" + (ex.message || "请重开详情重试");
  });
}
var versionSel = $("iVersion");
if(versionSel){
  versionSel.addEventListener("change", function(){
    /* 未就绪时的 change 来自选项回填；值没变也不是用户改选 */
    if(!formReady(versionSel)) return;
    var key = versionKeyOf(versionSel);
    if(key === lastVersionKey) return;
    lastVersionKey = key;
    if(!rt.editingId) newVersionExplicit = true;
    syncVersionReason();
  });
  if(window.MutationObserver) new MutationObserver(function(){ syncVersionReason(); }).observe(versionSel, {childList:true, attributes:true, attributeFilter:["data-ready"]});
}
["iEpic", "iBranch", "iReqDoc"].forEach(function(id){
  var el = $(id);
  if(!el) return;
  el.addEventListener("change", syncAssocMore);
  if(window.MutationObserver) new MutationObserver(syncAssocMore).observe(el, {childList:true, attributes:true, attributeFilter:["data-ready"]});
});
function syncAutoProject(){
  var badge = $("autoProject");
  if(!badge) return;
  var opt = demandOption(), reqSel = $("iReq");
  var want = opt ? (opt.getAttribute("data-req") || "") : "";
  badge.hidden = !(want && reqSel && reqSel.value === want);
}
/* 「更多设置」收起时也要看得见已选值：模块常驻，其余仅在设置后追加 */
var RECUR_LABELS = { daily:"每天", weekly:"每周", monthly:"每月" };
function syncMoreSummary(){
  var el = $("drawerMoreSummary");
  if(!el) return;
  var parts = ["模块：" + (catNameById(rt.formCat) || "未设置")];
  if(rt.formRecur) parts.push("循环：" + (RECUR_LABELS[rt.formRecur] || rt.formRecur));
  if(iRemind && iRemind.value) parts.push("提醒：" + fmtTs(iRemind.value));
  if(iBlocked && iBlocked.checked) parts.push("已阻塞");
  el.textContent = "· " + parts.join(" · ");
}
if(iSeverity) iSeverity.addEventListener("change", function(){
  var fs = $("fSeverity");
  if(fs && iSeverity.value) fs.classList.remove("invalid");
  syncSeverityButtons();
});
function clearDefectFields(){
  if(iSeverity) iSeverity.value = "";
  if(iEnvironment) iEnvironment.value = "";
  if(iReproSteps) iReproSteps.value = "";
  if(iRegression) iRegression.value = "";
  syncSeverityButtons();
}
function refreshAssociationViews(){
  var projects = viewModule("projects");
  if(projects) projects.refreshExpandedProjectTasks();
  var requirements = viewModule("requirements");
  if(requirements){
    requirements.refreshReqDocTasksIfOpen();
    requirements.refreshReqDocListIfOpen();
  }
  var phase = viewModule("phase");
  if(phase){
    phase.invalidateTaskOptionsCache();
    phase.reloadView();
  }
  var project = viewModule("project");
  if(project) project.loadProject({silent:true});
}
function openDrawer(){ taskDrawer.classList.add("on"); }
function closeDrawer(){ taskDrawer.classList.remove("on"); rt.formDirty = false; }
/**
 * 只读项目：整张表单（含评论/检查清单/附件）不可写，保存与删除入口收起。
 * 恢复时按各字段原有禁用条件还原，不能一律 disabled=false —— 进度列与阻塞原因有自己的状态。
 */
function applyDrawerReadOnly(readOnly){
  rt.drawerReadOnly = !!readOnly;
  var root = taskDrawer.querySelector(".drawer");
  if(root) root.classList.toggle("readonly", !!readOnly);
  var fields = taskForm.querySelectorAll("input,select,textarea");
  for(var i = 0; i < fields.length; i++){
    var f = fields[i];
    if(readOnly){ f.disabled = true; continue; }
    if(f.id === "iVersion" && !f.getAttribute("data-ready")){ f.disabled = true; continue; }
    if(f.id === "iProg"){ syncProgByCol(); continue; }
    if(f.id === "iBlockedReason"){ f.disabled = !(iBlocked && iBlocked.checked); continue; }
    f.disabled = false;
  }
  var chipBtns = taskForm.querySelectorAll("#typeGroup [data-type], #sevGrid [data-sev]");
  for(var c = 0; c < chipBtns.length; c++) chipBtns[c].disabled = !!readOnly;
  var factStatus = $("factStatus");
  if(factStatus) factStatus.disabled = !!readOnly;
  if(reqDocPickerBtn) reqDocPickerBtn.disabled = !!readOnly;
  /* 就地新建分支属于写操作：只读项目里连同入口一起收起，提示也不能再引导去点它 */
  var branchNewBtn = $("iBranchNew");
  if(branchNewBtn) branchNewBtn.hidden = !!readOnly;
  var branchHint = $("iBranchHint");
  if(branchHint) branchHint.textContent = readOnly
    ? "当前项目为只读项目，不能新建分支；可查看已有分支。"
    : "找不到合适的分支？点「新建分支」就地创建，建好自动选中，保存后生效。";
  if(btnAttach) btnAttach.hidden = !!readOnly;
  if(btnSaveTask) btnSaveTask.hidden = !!readOnly;
  /* 新建任务保存后仍走“保存并关闭”：留在新建态再保存会重复创建 */
  if(btnSaveTaskContinue) btnSaveTaskContinue.hidden = !!readOnly || !rt.editingId;
  var moreSaveContinue = $("taskMoreSaveContinue");
  if(moreSaveContinue) moreSaveContinue.hidden = !!readOnly || !rt.editingId;
  if(btnDeleteTask) btnDeleteTask.hidden = !!readOnly || !rt.editingId;
  if(iSubNew){
    iSubNew.disabled = !!readOnly;
    iSubNew.placeholder = readOnly ? "只读项目不可新增检查项" : "添加一项，回车确认";
  }
  if(iComment){
    iComment.disabled = !!readOnly;
    iComment.placeholder = readOnly
      ? "你对该项目只有查看权限，无法评论"
      : "写下讨论、结论或卡点…（Ctrl/⌘ + Enter 发送）";
  }
  if(btnCommentSend) btnCommentSend.hidden = !!readOnly;
  if(btnTimer) btnTimer.hidden = !!readOnly;
  if(btnTimerAdd) btnTimerAdd.hidden = !!readOnly;
  var hint = $("taskFormHint");
  if(hint && !rt.formDirty){
    hint.textContent = readOnly ? "你对该项目只有查看权限，可查看但不能修改" : "保存后可拖动卡片调整状态与顺序";
  }
  syncDepControls();
}
/** 只读抽屉里仍在视图上的写控件（分段按钮、快捷日期等）：拦下并给出反馈 */
function denyReadOnly(){
  if(!rt.drawerReadOnly) return false;
  toast("你对该项目只有查看权限", "warn");
  return true;
}
function buildFormControls(){
  segPri.innerHTML = PRIORITIES.map(function(p){
    return '<button type="button" class="pri-btn ' + p.toLowerCase() + '" data-fpri="' + p + '" aria-pressed="false"' +
      ' title="' + esc(priName(p)) + '" aria-label="优先级 ' + esc(priName(p)) + '"' +
      ' style="--pc:' + esc(priColor(p)) + '"><i></i>' + p + '</button>';
  }).join("");
  segRecur.innerHTML = [{v:"", n:"无"},{v:"daily", n:"每天"},{v:"weekly", n:"每周"},{v:"monthly", n:"每月"}]
    .map(function(o){
      return '<button type="button" data-recur="' + o.v + '" aria-pressed="false">' + o.n + '</button>';
    }).join("");
  syncCatSeg();
  populateColSelect();
}
/* 模块已降到项目级：候选只列指定项目的模块；未挂项目无模块可选（提交后为「未指定」） */
function projCats(reqId){
  if(!reqId) return [];
  return rt.categoriesCache.filter(function(c){ return c.projectId === reqId; });
}
function projFirstCat(reqId){
  return (projCats(reqId)[0] || {}).id || "";
}
function syncCatSeg(){
  if(!segCat) return;
  if(!currentReqId()){
    segCat.innerHTML = '<span class="foot-note">未挂项目，模块为「未指定」</span>';
    return;
  }
  segCat.innerHTML = projCats(currentReqId()).map(function(c){
    return '<button type="button" data-fcat="' + esc(c.id) + '" aria-pressed="' + (c.id === rt.formCat) + '">' + esc(c.name) + '</button>';
  }).join("");
}
/* 切换项目后校准模块选中：原模块不属于新项目则回落到新项目第一个模块 */
function ensureCatForProject(reqId){
  var cats = projCats(reqId);
  if(!cats.some(function(c){ return c.id === rt.formCat; })){
    rt.formCat = (cats[0] || {}).id || "";
    syncFormSegs(); syncMoreSummary();
  }
  syncCatSeg();
}
function populateColSelect(){
  if(!iCol) return;
  var cur = iCol.value;
  iCol.innerHTML = COLUMNS.map(function(c){
    return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
  }).join("");
  if(cur && colMeta(cur)) iCol.value = cur;
}
/* 新建任务的默认项目：当前项目页 > 筛选栏唯一项目 > 最近一次使用的项目。
   仅接受当前空间项目列表内的 ID，避免沿用已删除/无权限的项目。 */
var LAST_REQ_KEY = "ds.lastReqId";
function reqExists(id){
  return !!id && rt.reqList.some(function(r){ return r.id === id; });
}
/* 新建任务不应默认落到已归档项目；已归档项目仅在编辑旧任务时保留为当前项 */
function reqActive(id){
  return !!id && rt.reqList.some(function(r){ return r.id === id && !r.archivedAt; });
}
function rememberedReqId(){
  try{ return localStorage.getItem(LAST_REQ_KEY) || ""; }catch(e){ return ""; }
}
function rememberReqId(id){
  if(!reqActive(id)) return;
  try{ localStorage.setItem(LAST_REQ_KEY, id); }catch(e){ /* 隐私模式忽略 */ }
}
function defaultReqId(){
  if(document.body.dataset.view === "project" && reqActive(rt.managerProjectId)) return rt.managerProjectId;
  var picked = state.reqs;
  if(Array.isArray(picked) && picked.length === 1 && picked[0] !== "__none" && reqActive(picked[0])) return picked[0];
  var last = rememberedReqId();
  return reqActive(last) ? last : "";
}
function populateReqSelect(keepId){
  if(!iReq) return;
  var cur = keepId !== undefined ? keepId : iReq.value;
  var html = '<option value="">（无项目）</option>';
  rt.reqList.forEach(function(r){
    if(r.archivedAt && r.id !== cur) return;
    html += '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  });
  iReq.innerHTML = html;
  if(cur && rt.reqList.some(function(r){ return r.id === cur; })) iReq.value = cur;
  else iReq.value = "";
  /* 项目下拉重建时值可能被收回（如项目已删）：记下来，避免把这次程序化变化当成用户换项目 */
  lastReqValue = iReq.value;
}
/* 项目角色标注缓存：按 空间:项目 缓存，角色变化时由项目页广播失效 */
var projectRoleCache = Object.create(null);
var projectRoleLoading = Object.create(null);
function currentProjectId(){
  return iReq ? (iReq.value || "") : "";
}
function projectRoleMap(projectId){
  if(!projectId || !rt.currentWs) return null;
  return projectRoleCache[rt.currentWs.id + ":" + projectId] || null;
}
/* 花名册接口只对当前项目可见者开放；读取失败就不展示角色，不影响负责人选择 */
function ensureProjectRoles(projectId){
  if(!projectId || !rt.currentWs || rt.currentWs.type !== "shared") return;
  var key = rt.currentWs.id + ":" + projectId;
  if(projectRoleCache[key] || projectRoleLoading[key]) return;
  projectRoleLoading[key] = true;
  API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/projects/" + encodeURIComponent(projectId) + "/members")
    .then(function(data){
      var map = {};
      (data && data.members || []).forEach(function(m){
        if(m.roleTitle) map[m.userId] = m.roleTitle;
      });
      projectRoleCache[key] = map;
      delete projectRoleLoading[key];
      refreshOwnerSelect();
    }).catch(function(){
      delete projectRoleLoading[key];
    });
}
window.addEventListener("ds:project-roles-changed", function(e){
  var pid = e && e.detail && e.detail.projectId;
  if(!pid || !rt.currentWs) return;
  delete projectRoleCache[rt.currentWs.id + ":" + pid];
  if(pid === currentProjectId()) ensureProjectRoles(pid);
});
function ownerOptions(){
  var opts = [], seen = {}, roles = projectRoleMap(currentProjectId()) || {};
  function push(userId, name, m){
    if(!userId || seen[userId]) return;
    seen[userId] = 1;
    opts.push({
      id: userId,
      name: name,
      company: m ? companyNameOf(m) : companyOfUser(userId),
      role: roles[userId] || ""
    });
  }
  if(rt.currentUser){
    push(rt.currentUser.id, rt.currentUser.displayName || rt.currentUser.username);
  }
  if(rt.currentWs && rt.currentWs.type === "shared"){
    rt.wsMembersCache.forEach(function(m){
      /* 空间查看者不参与项目，也不进入负责人可选范围 */
      if((m.role || "member") === "viewer") return;
      push(m.userId, m.displayName || m.username, m);
    });
  }
  return opts;
}
function companyOfUser(userId){
  if(!userId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === userId; })[0];
  return hit ? companyNameOf(hit) : "";
}
function ownerOptionHTML(o, selected){
  return '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (selected ? " selected" : "") + '>' +
    esc(o.name) + (o.role ? ' · ' + esc(o.role) : '') + '</option>';
}
function populateOwnerSelect(currentName, currentUserId){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var opts = ownerOptions();
  var curName = currentName == null ? "" : String(currentName);
  var curId = currentUserId == null ? "" : String(currentUserId);
  var html = "", matched = false;
  var groups = [], groupIndex = {};
  var hasCompany = opts.some(function(o){ return !!o.company; });
  opts.forEach(function(o){
    var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
    if(on) matched = true;
    if(!hasCompany){ html += ownerOptionHTML(o, on); return; }
    var label = o.company || "未标注公司";
    var g = groupIndex[label];
    if(!g){
      g = groupIndex[label] = { label:label, items:[] };
      groups.push(g);
    }
    g.items.push({ o:o, on:on });
  });
  if(hasCompany){
    groups.sort(function(a, b){
      if(a.label === "未标注公司") return 1;
      if(b.label === "未标注公司") return -1;
      return a.label.localeCompare(b.label, "zh");
    });
    groups.forEach(function(g){
      html += '<optgroup label="' + esc(g.label) + '">'
        + g.items.map(function(x){ return ownerOptionHTML(x.o, x.on); }).join("")
        + '</optgroup>';
    });
  }
  if(curName && !matched){
    html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
  }
  if(!opts.length && !curName){
    html += '<option value="__text__" data-name="' + esc(rt.OWNER_DEFAULT) + '">' + esc(rt.OWNER_DEFAULT) + '</option>';
  }
  iOwner.innerHTML = html;
  /* 角色是异步的：先渲染基础选项，拿到花名册后只重绘下拉并保留当前选择 */
  ensureProjectRoles(currentProjectId());
}
function refreshOwnerSelect(){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var sel = iOwner.options[iOwner.selectedIndex];
  var name = sel ? (sel.dataset.name || sel.textContent) : "";
  var uid = sel && sel.value !== "__text__" ? sel.value : "";
  populateOwnerSelect(name, uid);
}
function ownerPick(){
  if(!iOwner || iOwner.tagName !== "SELECT") return {name:null, userId:null};
  var sel = iOwner.options[iOwner.selectedIndex];
  if(!sel) return {name:null, userId:null};
  return {
    name: sel.dataset.name || sel.textContent || null,
    userId: sel.value === "__text__" ? null : sel.value
  };
}
function syncFormSegs(){
  segPri.querySelectorAll("[data-fpri]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.fpri === rt.formPri);
  });
  segCat.querySelectorAll("[data-fcat]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.fcat === rt.formCat);
  });
  segRecur.querySelectorAll("[data-recur]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.recur === rt.formRecur);
  });
}
function renderTagChips(){
  tagWrap.querySelectorAll(".tag").forEach(function(el){ el.remove(); });
  rt.tagsCache.forEach(function(tg, i){
    var span = document.createElement("span");
    span.className = "tag tag-primary";
    span.innerHTML = esc(tg) + '<button class="x" type="button" data-tag-del="' + i +
      '" aria-label="移除标签 ' + esc(tg) + '">' + icon("close", 10) + '</button>';
    tagWrap.insertBefore(span, iTags);
  });
}
function syncProgVal(){ progVal.textContent = (Number(iProg.value) || 0) + "%"; syncDrawerFacts(); }
function renderTimeline(logs){
  if(!timelineBox) return;
  if(!logs || !logs.length){
    timelineBox.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
    return;
  }
  timelineBox.innerHTML = logs.map(function(l){
    var txt = l.detail || l.action || "";
    var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
    var change = null, extra = "";
    if(l.changeData){ try{ change = typeof l.changeData === "string" ? JSON.parse(l.changeData) : l.changeData; }catch(e){} }
    if(change){
      var before = change.before || {}, after = change.after || {};
      if(l.action === "version_change") extra += '<br>计划版本：' + esc(taskVersionsText(before) || "待规划") + ' → ' + esc(taskVersionsText(after) || "待规划");
      if(change.reason) extra += '<br>理由：' + esc(change.reason);
    }
    return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
      '<span class="tl-detail">' + actor + esc(txt) + extra + '</span></div>';
  }).join("");
}
/* 附属数据失败显示“加载失败 + 重试”，不能伪装成空态 */
function drawerLoadErrorHTML(msg, retryAttr){
  return '<div class="sub-empty">' + esc(msg) + ' ' +
    '<button class="btn sm ghost" type="button" data-' + retryAttr + '>重试</button></div>';
}
function loadTimeline(taskId){
  if(!timelineBox) return;
  timelineBox.innerHTML = '<div class="tl-empty">加载中…</div>';
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/logs").then(function(logs){
    if(rt.editingId === taskId) renderTimeline(logs);
  }).catch(function(ex){
    if(rt.editingId !== taskId) return;
    timelineBox.innerHTML = '<div class="tl-empty">操作时间线加载失败：' +
      esc(ex.message || "网络异常") + ' <button class="btn sm ghost" type="button" data-timeline-retry>重试</button></div>';
  });
}
if(timelineBox){
  timelineBox.addEventListener("click", function(e){
    if(e.target.closest("[data-timeline-retry]") && rt.editingId) loadTimeline(rt.editingId);
  });
}
var origProgress = 0;
var startedDone = false;
var commentsCache = [];
function renderActualEstimate(actualMinutes, estimateMinutes){
  if(!iActual) return;
  var act = Number(actualMinutes) || 0;
  var est = Number(estimateMinutes) || 0;
  rt.formActualMinutes = act;
  rt.formEstimateMinutes = est;
  iActual.className = "est-actual";
  if(!act && !est){
    iActual.textContent = "—";
    syncDrawerFacts();
    return;
  }
  var html = fmtMinutesShort(act);
  if(est > 0){
    var r = act / est;
    html += ' <span class="ea-ratio">/ 预估 ' + fmtMinutesShort(est) + '（' + Math.round(r * 100) + '%）</span>';
    if(r >= 1) iActual.classList.add("over");
    else if(r >= 0.8) iActual.classList.add("near");
  }else{
    html += ' <span class="ea-ratio">还没填预估</span>';
  }
  iActual.innerHTML = html;
  syncDrawerFacts();
}
/* 关注人：抽屉头部的开关只负责本任务，状态由后端按（任务, 当前用户）返回 */
var watchTaskId = null;
function renderWatchButton(res){
  if(!btnTaskWatch) return;
  var watching = !!(res && res.watching);
  btnTaskWatch.hidden = !watchTaskId;
  btnTaskWatch.setAttribute("aria-pressed", watching ? "true" : "false");
  if(taskWatchLabel) taskWatchLabel.textContent = watching ? "已关注" : "关注";
  btnTaskWatch.title = watching
    ? "已关注：新评论、移入回收站或恢复时会通知你（点击取消）"
    : "关注后，该工作项的新评论、移入回收站或恢复会通知你";
}
function loadWatchStatus(taskId){
  watchTaskId = taskId || null;
  renderWatchButton(null);
  if(!watchTaskId) return;
  API.get("/api/tasks/" + encodeURIComponent(watchTaskId) + "/watch").then(function(res){
    if(watchTaskId === taskId) renderWatchButton(res);
  }).catch(function(){
    /* 读不到状态时隐藏开关，避免展示错误的关注态 */
    if(watchTaskId === taskId && btnTaskWatch) btnTaskWatch.hidden = true;
  });
}
function openTaskDrawer(colId, task, defaults){
  /* 从搜索、通知、看板其它卡片直接换任务时，也必须走未保存确认；
     否则 openTaskDrawer 会把 formDirty 置 false，静默丢掉当前表单/附件。 */
  if(rt.formDirty && rt.editingId && task && task.id === rt.editingId){
    /* 同一任务重复打开不重填表单，避免把未保存内容冲掉 */
    return;
  }
  if(rt.formDirty && rt.editingId && (!task || task.id !== rt.editingId)){
    var nextCol = colId, nextTask = task, nextDefaults = defaults;
    UI.showConfirm({
      title: "放弃未保存的改动？",
      msg: "当前工作项的表单、评论草稿或待上传附件尚未保存，打开其他工作项后会丢失。",
      okText: "放弃并打开",
      cancelText: "继续编辑"
    }).then(function(ok){
      if(!ok) return;
      forceCloseTaskDrawer({ discardCommentDraft: true });
      openTaskDrawer(nextCol, nextTask, nextDefaults);
    });
    return;
  }
  rt.drawerOpener = (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)
    ? document.activeElement : null;
  /* 切任务前先收好上一条未发送的评论草稿 */
  stashCommentDraft(lastCommentDraftId || rt.editingId);
  rt.taskFormSeq++;
  setSaveLoading(false); // 新抽屉独立管理 loading，后续再应用当前表单的只读权限
  demandTargetCache = {}; demandTargetPending = {};
  newVersionExplicit = !!(defaults && normalizedIds(defaults.versionIds).length);
  newInheritedTarget = null;
  $("iVersionChangeReason").value = (defaults && defaults.versionChangeReason) || "";
  $("fVersionChangeReason").hidden = true;
  rt.editingId = task ? task.id : null;
  rt.formDirty = false;
  mentionPicked = [];
  /* 换任务后候选可能属于上一个项目，先清掉再按需重拉 */
  mentionCandidateTask = null;
  mentionCandidates = [];
  closeMention();
  /* 新建任务先确定项目，再据其权限决定表单是否只读 */
  var initialReqId = task ? (task.reqId || "") : ((defaults && defaults.reqId) || defaultReqId());
  var readOnly = task ? !canEditTask(task) : !canEditReq(initialReqId);
  if(task) taskCacheExtra[task.id] = task;
  if(drawerNotice) drawerNotice.hidden = true;
  /* 分支 / 需求下拉改为按需加载：首次打开抽屉时才拉取对应视图模块，不拖首屏。
     ensureXxxOptions 会保留当前选中值，不会冲掉刚回填的关联。 */

  if(task){
    var isDone = task.boardColumn === "done";
    startedDone = isDone;
    taskDrawerTitle.textContent = task.title || "工作项详情";
    btnDeleteTask.hidden = false;
    if(btnTaskNew) btnTaskNew.hidden = false;
    iTitle.value = task.title || "";
    iDesc.value = task.description || "";
    iStart.value = task.startDate || "";
    iDue.value = task.dueDate || "";
    if($("iMilestone")) $("iMilestone").checked = !!task.isMilestone;
    syncDateBounds();
    /* 预估耗时：库里存分钟，表单用小时（0.5 步进） */
    if(iEstimate) iEstimate.value = task.estimateMinutes ? (task.estimateMinutes / 60) : "";
    renderActualEstimate(task.totalMinutes, task.estimateMinutes);
    rt.formPri = task.priority || "P2";
    /* 模块已删则回落到该项目第一个模块；未挂项目无模块 */
    rt.formCat = task.categoryId || projFirstCat(task.reqId || "");
    populateColSelect();
    iCol.value = task.boardColumn || "backlog";
    populateReqSelect(task.reqId || "");
    iReq.value = task.reqId || "";
    if(iItemType) iItemType.value = task.itemType || "task";
    if(iSeverity) iSeverity.value = task.severity || "";
    if(iEnvironment) iEnvironment.value = task.environment || "";
    if(iReproSteps) iReproSteps.value = task.reproduceSteps || "";
    if(iRegression) iRegression.value = task.regressionStatus || "";
    /* 尚未加载的数组关系由项目任务选项回填；失败时保存 null 保留原关联。 */
    ensureVersion(task.versionIds, task.id);
    ensureFoundVersion(task.foundVersionId || "");
    ensureEpic(task.epicId, task.id);
    rt.formDemandId = task.demandId || null;
    /* 先清掉上一个工作项留下的需求选择：新候选未回来前不能把旧关联显示成当前来源 */
    if($("iDemand")) $("iDemand").value = rt.formDemandId || "";
    ensureDemand(rt.formDemandId || "");
    ensureReqDoc(task.reqDocId || "");
    ensureBranch(task.branchId || "", task.reqId || "");
    origProgress = (typeof task.progress === "number") ? task.progress : 0;
    iProg.value = origProgress;
    iNote.value = task.note || "";
    rt.formRecur = task.recurType || "";
    iRemind.value = task.remindAt ? String(task.remindAt).substring(0, 16) : "";
    if(iRemindTarget) iRemindTarget.value = task.remindTarget || "owner";
    if(iBlocked) iBlocked.checked = !!task.blocked;
    if(iBlockedReason){
      iBlockedReason.disabled = !task.blocked;
      iBlockedReason.value = task.blockedReason || "";
    }
    rt.tagsCache = (task.tags || []).slice(0, 8);
    renderTagChips();
    populateOwnerSelect(task.owner || "", task.ownerUserId || "");
    fWork.hidden = false; fAttach.hidden = false; fSubtasks.hidden = false; fTimeline.hidden = false;
    if(fComments) fComments.hidden = false;
    if($("fProgress")) $("fProgress").hidden = false;
    var testWindow = $("fTestWindow");
    if(testWindow){
      var testStart = task.testStartedAt || "", testEnd = task.testFinishedAt || "";
      testWindow.hidden = !(testStart || testEnd);
      if($("iTestStart")) $("iTestStart").textContent = testStart || "—";
      if($("iTestEnd")) $("iTestEnd").textContent = testEnd || "—";
    }
    if($("fRegression")) $("fRegression").hidden = false;
    if($("afterCreateNote")) $("afterCreateNote").hidden = true;
    /* 只有确实用了低频设置时才展开，避免编辑态默认撑长表单；模块已填也要展开 */
    var drawerMore = $("drawerMore");
    if(drawerMore) drawerMore.open = !!(task.categoryId || task.recurType || task.remindAt || task.blocked);
    loadWorkStatus(task.id);
    loadAttachments(task.id);
    loadSubtasks(task.id);
    restoreCommentDraft(task.id);
    loadComments(task.id);
    loadWatchStatus(task.id);
    loadTimeline(task.id);
  }else{
    taskDrawerTitle.textContent = "新建工作项";
    btnDeleteTask.hidden = true;
    if(btnTaskNew) btnTaskNew.hidden = true;
    startedDone = false;
    iTitle.value = ""; iDesc.value = "";
    /* 甘特图双击空白处新建时预填起止日期；普通入口保持为空 */
    iStart.value = (defaults && defaults.startDate) || "";
    iDue.value = (defaults && defaults.dueDate) || "";
    if($("iMilestone")) $("iMilestone").checked = !!(defaults && defaults.isMilestone);
    syncDateBounds();
    if(iEstimate) iEstimate.value = "";
    renderActualEstimate(0, null);
    rt.formPri = "P2";
    /* 从需求拆解时沿用需求模块；不属于该项目或已删则回落到该项目第一个 */
    var presetCat = defaults && defaults.categoryId;
    var catCands = projCats(initialReqId);
    rt.formCat = catCands.some(function(c){ return c.id === presetCat; })
      ? presetCat : ((catCands[0] || {}).id || "");
    populateColSelect();
    iCol.value = colId || "backlog";
    populateReqSelect(initialReqId);
    /* 基于需求池需求创建工作项（需求详情入口）：锁定需求所在项目；普通入口回落到默认项目 */
    iReq.value = initialReqId;
    if(defaults && defaults.demandId){
      rt.formDemandId = defaults.demandId;
      ensureDemand(defaults.demandId);
    }else{
      rt.formDemandId = null;
      ensureDemand("");
    }
    /* 新建时不能沿用上一个工作项的需求选择 */
    if($("iDemand")) $("iDemand").value = rt.formDemandId || "";
    if(iItemType) iItemType.value = (defaults && defaults.itemType === "bug") ? "bug" : "task";
    clearDefectFields();
    ensureVersion(normalizedIds(defaults && defaults.versionIds));
    ensureFoundVersion("");
    ensureEpic((defaults && defaults.epicId) || "");
    ensureReqDoc((defaults && defaults.reqDocId) || "");
    ensureBranch("", initialReqId);
    origProgress = 0;
    iProg.value = 0;
    iNote.value = "";
    rt.formRecur = "";
    iRemind.value = "";
    if(iRemindTarget) iRemindTarget.value = "owner";
    if(iBlocked) iBlocked.checked = false;
    if(iBlockedReason){ iBlockedReason.disabled = true; iBlockedReason.value = ""; }
    rt.tagsCache = [];
    renderTagChips();
    populateOwnerSelect(rt.currentUser ? (rt.currentUser.displayName || "") : "", rt.currentUser ? rt.currentUser.id : "");
    fWork.hidden = true; fAttach.hidden = true; fSubtasks.hidden = true; fTimeline.hidden = true;
    if(fComments) fComments.hidden = true;
    if($("fProgress")) $("fProgress").hidden = true;
    if($("fTestWindow")) $("fTestWindow").hidden = true;
    if($("iTestStart")) $("iTestStart").textContent = "—";
    if($("iTestEnd")) $("iTestEnd").textContent = "—";
    if($("fRegression")) $("fRegression").hidden = true;
    if($("afterCreateNote")) $("afterCreateNote").hidden = false;
    var drawerMoreNew = $("drawerMore");
    if(drawerMoreNew) drawerMoreNew.open = false;
    commentsCache = [];
    restoreCommentDraft(null);
    loadWatchStatus(null);
    if(commentList) commentList.innerHTML = "";
    if(commentCount) commentCount.textContent = "";
    closeMention();
  }
  initDependencies(task);
  syncDefectFields();
  syncTypeButtons();
  syncSeverityButtons();
  syncTitleCount();
  syncDueNote();
  syncDrawerHead();
  syncDrawerSource();
  syncAssocViewBtns();
  syncProgVal();
  syncProgByCol();
  fTitle.classList.remove("invalid");
  syncCatSeg();
  syncFormSegs();
  syncMoreSummary();
  applyDrawerReadOnly(readOnly);
  syncTaskPublication(task);
  syncDrawerFacts();
  syncAssocMore();
  /* 手机端新建走半屏抽屉，编辑走全屏；桌面端样式不区分 */
  taskForm.classList.toggle("is-create", !task);
  resetFormBaseline();
  openDrawer();
  loadTaskReleaseRecords(task);
  UI.wireTooltips(taskDrawer);
  setTimeout(function(){ try{ iTitle.focus(); iTitle.select(); }catch(e){ /* noop */ } }, 60);
}
/* ==================== 依赖关系（与甘特图共用 task_dependency） ==================== */
var DEP_TYPES = [
  { v:"FS", n:"完成-开始", d:"前置完成后，后置才能开始" },
  { v:"SS", n:"开始-开始", d:"前置开始后，后置才能开始" },
  { v:"FF", n:"完成-完成", d:"前置完成后，后置才能完成" },
  { v:"SF", n:"开始-完成", d:"前置开始后，后置才能完成" }
];
var depState = {
  taskId: null, seq: 0, loading: false, error: "",
  edges: [], pending: [], pendingSeq: 0,
  mode: "", pickerSeq: 0, pickerItems: [], pickerLoading: false, searchTimer: null
};
function depTypeMeta(type){
  for(var i=0;i<DEP_TYPES.length;i++) if(DEP_TYPES[i].v === type) return DEP_TYPES[i];
  return DEP_TYPES[0];
}
function depCurrentRef(){
  return {
    id: rt.editingId || "__new__",
    title: (iTitle.value || "").trim() || "当前工作项",
    reqId: (iReq && iReq.value) || "",
    boardColumn: (iCol && iCol.value) || "",
    startDate: (iStart && iStart.value) || "",
    dueDate: (iDue && iDue.value) || "",
    milestone: !!($("iMilestone") && $("iMilestone").checked)
  };
}
function depDateRange(ref){
  var s = parseDate(ref && ref.startDate) || parseDate(ref && ref.dueDate);
  var e = parseDate(ref && ref.dueDate) || s;
  if(!s || !e) return null;
  if(e < s){ var tmp = s; s = e; e = tmp; }
  return { s:s, e:e };
}
function depRangeText(ref){
  var r = depDateRange(ref);
  if(!r) return "未排期";
  var a = GS.fmtDashMD(r.s), b = GS.fmtDashMD(r.e);
  return a === b ? a : (a + " → " + b);
}
function depProjectName(ref){
  if(!ref || !ref.reqId) return "未归属项目";
  var name = reqNameById(ref.reqId);
  return name && name !== "无" ? name : "未归属项目";
}
function depConflictOf(pred, succ, type, lag){
  var pr = depDateRange(pred), sr = depDateRange(succ);
  if(!pr || !sr) return false;
  return GS.depConflict(
    { s:pr.s, e:pr.e, as:pr.s, ae:pr.e, done:pred.boardColumn === "done" },
    { s:sr.s, e:sr.e, as:sr.s, ae:sr.e },
    type, lag
  );
}
function depTypeOptionsHTML(selected){
  return DEP_TYPES.map(function(t){
    return '<option value="' + t.v + '"' + (t.v === (selected || "FS") ? " selected" : "") +
      ' title="' + esc(t.n + "：" + t.d) + '">' + t.v + '</option>';
  }).join("");
}
function depTaskLinked(taskId){
  for(var i=0;i<depState.edges.length;i++){
    var e = depState.edges[i];
    if((e.from && e.from.id === taskId) || (e.to && e.to.id === taskId)) return true;
  }
  for(var j=0;j<depState.pending.length;j++){
    if(depState.pending[j].task.id === taskId) return true;
  }
  return false;
}
function depRowsFor(direction){
  var cur = depCurrentRef();
  var rows = [];
  depState.edges.forEach(function(e){
    var other = direction === "pred" ? e.from : e.to;
    if(!other) return;
    var matches = direction === "pred" ? (e.to && e.to.id === cur.id) : (e.from && e.from.id === cur.id);
    if(matches) rows.push({ edge:e, other:other, direction:direction, depType:e.depType || "FS", lagDays:Number(e.lagDays) || 0 });
  });
  depState.pending.forEach(function(p){
    if(p.direction === direction){
      rows.push({ pending:p, other:p.task, direction:direction, depType:p.depType || "FS", lagDays:Number(p.lagDays) || 0 });
    }
  });
  return rows;
}
function depRowHTML(row){
  var other = row.other, cur = depCurrentRef();
  var pred = row.direction === "pred" ? other : cur;
  var succ = row.direction === "pred" ? cur : other;
  var conflict = depConflictOf(pred, succ, row.depType, row.lagDays);
  var editable = row.pending ? !rt.drawerReadOnly : (!!row.edge.editable && !rt.drawerReadOnly);
  var idAttr = row.pending
    ? ' data-dep-pending="' + esc(row.pending.key) + '"'
    : ' data-dep-id="' + esc(row.edge.id) + '"';
  var typeAttr = row.pending
    ? ' data-dep-pending-type="' + esc(row.pending.key) + '"'
    : ' data-dep-type="' + esc(row.edge.id) + '"';
  var lagAttr = row.pending
    ? ' data-dep-pending-lag="' + esc(row.pending.key) + '"'
    : ' data-dep-lag="' + esc(row.edge.id) + '"';
  var delAttr = row.pending
    ? ' data-dep-pending-del="' + esc(row.pending.key) + '"'
    : ' data-dep-del="' + esc(row.edge.id) + '"';
  var meta = [
    depProjectName(other),
    depRangeText(other),
    "滞后 " + row.lagDays + " 天"
  ].join(" · ");
  var typeMeta = depTypeMeta(row.depType);
  return '<div class="dep-row"' + idAttr + '>' +
    '<select class="dep-type" ' + typeAttr + ' aria-label="依赖类型"' +
      (editable ? "" : ' disabled data-dep-locked="1"') + ' title="' + esc(typeMeta.n + "：" + typeMeta.d) + '">' +
      depTypeOptionsHTML(row.depType) + '</select>' +
    '<div class="dep-main">' +
      '<span class="dep-title" title="' + esc(other.title || "") + '">' + esc(other.title || "未命名工作项") + '</span>' +
      '<span class="dep-meta" title="' + esc(meta) + '">' + esc(meta) + '</span>' +
    '</div>' +
    (conflict ? '<span class="dep-bad" title="后置排期早于依赖要求，可在甘特图调整日期">排期冲突</span>' : '') +
    (row.pending ? '<span class="dep-pending">未保存</span>' : '') +
    (!row.edge || row.edge.editable ? '' : '<span class="dep-opt-state">只读</span>') +
    '<label class="dep-lag">滞后 <input type="number" min="-365" max="365" step="1" value="' + row.lagDays + '" ' +
      lagAttr + ' aria-label="滞后天数"' +
      (editable ? "" : ' disabled data-dep-locked="1"') + ' /> 天</label>' +
    (editable ? '<button class="dep-del" type="button" ' + delAttr + ' title="删除依赖" aria-label="删除依赖">' +
      icon("close", 12) + '</button>' : '') +
  '</div>';
}
function depGroupHTML(rows, direction){
  if(depState.loading && !rows.length) return '<div class="dep-empty">加载中…</div>';
  if(depState.error && !rows.length){
    return '<div class="dep-empty">加载失败，<button class="link-btn" type="button" data-dep-retry>重新加载</button></div>';
  }
  if(!rows.length) return '<div class="dep-empty">' + (direction === "pred" ? "暂无前置任务" : "暂无后置任务") + '</div>';
  return rows.map(depRowHTML).join("");
}
function syncDepControls(){
  var root = $("fDeps");
  if(!root) return;
  var ro = !!rt.drawerReadOnly;
  Array.prototype.forEach.call(root.querySelectorAll(".dep-add, .dep-del"), function(el){ el.hidden = ro; });
  /* data-dep-locked 标记「依赖两端含只读项目」，恢复可编辑时要还原它，不能一律放开 */
  Array.prototype.forEach.call(root.querySelectorAll(".dep-type, .dep-lag input"), function(el){
    el.disabled = ro || el.getAttribute("data-dep-locked") === "1";
  });
  if(ro) closeDepPicker();
}
function renderDeps(){
  var root = $("fDeps");
  if(!root) return;
  var preds = depRowsFor("pred"), succs = depRowsFor("succ");
  var total = depState.edges.length + depState.pending.length;
  var cnt = $("depCount");
  if(cnt){ cnt.hidden = total === 0; cnt.textContent = total + " 条"; }
  var predList = $("depPredList"), succList = $("depSuccList");
  if(predList) predList.innerHTML = depGroupHTML(preds, "pred");
  if(succList) succList.innerHTML = depGroupHTML(succs, "succ");
  var conflicts = preds.concat(succs).filter(function(row){
    var cur = depCurrentRef();
    var pred = row.direction === "pred" ? row.other : cur;
    var succ = row.direction === "pred" ? cur : row.other;
    return depConflictOf(pred, succ, row.depType, row.lagDays);
  }).length;
  var alert = $("depAlert"), alertText = $("depAlertText");
  if(alert && alertText){
    alert.hidden = conflicts === 0;
    if(conflicts){
      alertText.textContent = conflicts + " 条依赖存在排期冲突：后置任务的开始或结束早于前置要求。可在甘特图调整日期。";
    }
  }
  var foot = $("depFoot");
  if(foot){
    if(rt.drawerReadOnly){
      foot.textContent = "你对该项目只有查看权限，依赖关系只读。";
    }else if(!rt.editingId){
      foot.textContent = "新建工作项时添加的依赖会在保存后一并建立，甘特图随之更新。";
    }else{
      foot.textContent = "修改立即生效并同步甘特图；只调整连线与冲突提示，不会自动改日期。";
    }
    foot.classList.remove("bad");
  }
  var note = $("depScopeNote");
  if(note) note.textContent = rt.editingId ? "影响甘特连线，不自动改日期" : "保存后建立";
  syncDepControls();
}
function loadTaskDeps(taskId){
  var seq = ++depState.seq;
  depState.loading = true;
  depState.error = "";
  renderDeps();
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/dependencies").then(function(list){
    if(seq !== depState.seq || rt.editingId !== taskId) return;
    depState.edges = Array.isArray(list) ? list : [];
    depState.loading = false;
    renderDeps();
  }).catch(function(ex){
    if(seq !== depState.seq) return;
    depState.loading = false;
    depState.error = (ex && ex.message) || "网络异常";
    renderDeps();
  });
}
function initDependencies(task){
  depState.taskId = task ? task.id : null;
  depState.seq++;
  depState.edges = [];
  depState.pending = [];
  depState.loading = !!task;
  depState.error = "";
  depState.pickerItems = [];
  depState.pickerLoading = false;
  closeDepPicker();
  if(task) loadTaskDeps(task.id);
  else renderDeps();
}
function closeDepPicker(){
  depState.mode = "";
  depState.pickerItems = [];
  depState.pickerLoading = false;
  var p = $("depPicker");
  if(p) p.hidden = true;
  var s = $("iDepSearch");
  if(s) s.value = "";
  var list = $("depPickerList");
  if(list) list.innerHTML = "";
}
function openDepPicker(mode){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  depState.mode = mode;
  depState.pickerItems = [];
  depState.pickerLoading = true;
  var p = $("depPicker");
  if(p) p.hidden = false;
  var title = $("depPickerTitle");
  if(title) title.textContent = mode === "pred" ? "添加前置任务" : "添加后置任务";
  var s = $("iDepSearch");
  if(s){ s.value = ""; s.focus(); }
  var list = $("depPickerList");
  if(list) list.innerHTML = '<div class="dep-picker-empty">加载中…</div>';
  searchDepTasks("");
}
function searchDepTasks(q){
  if(!depState.mode) return;
  var seq = ++depState.pickerSeq;
  depState.pickerLoading = true;
  API.get("/api/tasks/list", { q:q, limit:12, sort:"updated" }).then(function(res){
    if(seq !== depState.pickerSeq || !depState.mode) return;
    depState.pickerItems = (res && res.items) || [];
    depState.pickerLoading = false;
    renderDepPicker();
  }).catch(function(){
    if(seq !== depState.pickerSeq) return;
    depState.pickerItems = [];
    depState.pickerLoading = false;
    renderDepPicker("加载失败，请稍后重试");
  });
}
function renderDepPicker(errorText){
  var list = $("depPickerList");
  if(!list) return;
  if(depState.pickerLoading){ list.innerHTML = '<div class="dep-picker-empty">加载中…</div>'; return; }
  if(errorText){ list.innerHTML = '<div class="dep-picker-empty">' + esc(errorText) + '</div>'; return; }
  var currentId = rt.editingId;
  var rows = (depState.pickerItems || []).filter(function(t){ return t.id !== currentId; });
  if(!rows.length){
    list.innerHTML = '<div class="dep-picker-empty">没有匹配的工作项</div>';
    return;
  }
  list.innerHTML = rows.map(function(t){
    var linked = depTaskLinked(t.id);
    var writable = canEditTask(t);
    var disabled = linked || !writable;
    var state = linked ? "已关联" : (!writable ? "只读项目" : "添加");
    var meta = [
      t.reqName || (t.reqId ? reqNameById(t.reqId) : "未归属项目"),
      depRangeText(t)
    ].join(" · ");
    return '<button class="dep-opt" type="button" data-dep-opt="' + esc(t.id) + '"' +
      (disabled ? " disabled" : "") + ' title="' + esc(t.title || "") + '">' +
      '<span class="dep-opt-main">' +
        '<span class="dep-opt-title">' + esc(t.title || "未命名工作项") + '</span>' +
        '<span class="dep-opt-meta">' + esc(meta) + '</span>' +
      '</span>' +
      '<span class="dep-opt-state' + (!writable && !linked ? " bad" : "") + '">' + state + '</span>' +
    '</button>';
  }).join("");
}
function addDependency(other, mode){
  if(!other || !mode) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var currentId = rt.editingId;
  if(!currentId){
    depState.pending.push({
      key: "p" + (++depState.pendingSeq),
      direction: mode,
      task: other,
      depType: "FS",
      lagDays: 0
    });
    renderDeps();
    rt.formDirty = true;
    syncDrawerDirty();
    toast("已添加「" + other.title + "」，保存工作项后建立依赖");
    return;
  }
  var body = mode === "pred"
    ? { fromTaskId:other.id, toTaskId:currentId, depType:"FS", lagDays:0 }
    : { fromTaskId:currentId, toTaskId:other.id, depType:"FS", lagDays:0 };
  API.post("/api/gantt/deps", body).then(function(){
    toast("已添加依赖「" + other.title + "」");
    loadTaskDeps(currentId);
    refreshGanttIfOpen();
  }).catch(function(ex){
    toast((ex && ex.message) || "添加依赖失败", "bad");
  });
}
function updateDependency(row, patch){
  if(!row || !row.edge || rt.drawerReadOnly) return;
  if(!row.edge.editable){
    toast("依赖两端项目中存在只读项目，不能修改", "warn");
    renderDeps();
    return;
  }
  var edge = row.edge;
  var oldType = edge.depType, oldLag = Number(edge.lagDays) || 0;
  edge.depType = patch.depType || oldType;
  edge.lagDays = patch.lagDays == null ? oldLag : patch.lagDays;
  renderDeps();
  API.put("/api/gantt/deps/" + encodeURIComponent(edge.id), {
    depType: edge.depType, lagDays: edge.lagDays
  }).then(function(){
    refreshGanttIfOpen();
  }).catch(function(ex){
    edge.depType = oldType;
    edge.lagDays = oldLag;
    renderDeps();
    toast((ex && ex.message) || "更新依赖失败", "bad");
  });
}
function deleteDependency(row){
  if(!row || rt.drawerReadOnly) return;
  if(row.pending){
    depState.pending = depState.pending.filter(function(p){ return p.key !== row.pending.key; });
    renderDeps();
    rt.formDirty = true;
    syncDrawerDirty();
    return;
  }
  var edge = row.edge;
  if(!edge || !edge.editable){ toast("依赖两端项目中存在只读项目，不能删除", "warn"); return; }
  var body = { fromTaskId:edge.from.id, toTaskId:edge.to.id, depType:edge.depType, lagDays:edge.lagDays };
  API.del("/api/gantt/deps/" + encodeURIComponent(edge.id)).then(function(){
    depState.edges = depState.edges.filter(function(e){ return e.id !== edge.id; });
    renderDeps();
    refreshGanttIfOpen();
    toastAction("已删除与「" + (row.other.title || "工作项") + "」的依赖", "撤销", function(){
      API.post("/api/gantt/deps", body).then(function(){
        if(rt.editingId === depState.taskId) loadTaskDeps(depState.taskId);
        refreshGanttIfOpen();
      }).catch(function(ex){ toast((ex && ex.message) || "撤销失败", "bad"); });
    }, "", 8000);
  }).catch(function(ex){
    toast((ex && ex.message) || "删除依赖失败", "bad");
  });
}
function flushPendingDependencies(taskId){
  var list = depState.pending.slice();
  depState.pending = [];
  if(!list.length) return Promise.resolve({ total:0, failed:0 });
  var failed = [], i = 0;
  function next(){
    if(i >= list.length) return Promise.resolve({ total:list.length, failed:failed.length });
    var p = list[i++];
    var body = p.direction === "pred"
      ? { fromTaskId:p.task.id, toTaskId:taskId, depType:p.depType, lagDays:p.lagDays }
      : { fromTaskId:taskId, toTaskId:p.task.id, depType:p.depType, lagDays:p.lagDays };
    return API.post("/api/gantt/deps", body).then(next, function(ex){
      failed.push({ title:p.task.title, message:(ex && ex.message) || "网络异常" });
      return next();
    });
  }
  return next();
}
(function wireDepSection(){
  var root = $("fDeps");
  if(!root) return;
  var addPred = $("btnDepAddPred"), addSucc = $("btnDepAddSucc");
  if(addPred) addPred.addEventListener("click", function(){ openDepPicker("pred"); });
  if(addSucc) addSucc.addEventListener("click", function(){ openDepPicker("succ"); });
  var closeBtn = $("depPickerClose");
  if(closeBtn) closeBtn.addEventListener("click", closeDepPicker);
  var search = $("iDepSearch");
  if(search){
    search.addEventListener("input", function(){
      var q = this.value.trim();
      if(depState.searchTimer) clearTimeout(depState.searchTimer);
      depState.searchTimer = setTimeout(function(){ searchDepTasks(q); }, 180);
    });
    search.addEventListener("keydown", function(e){
      if(e.key !== "Enter") return;
      e.preventDefault();
      var first = root.querySelector(".dep-opt:not(:disabled)");
      if(first) first.click();
    });
  }
  root.addEventListener("click", function(e){
    var opt = e.target.closest("[data-dep-opt]");
    if(opt && !opt.disabled){
      var id = opt.getAttribute("data-dep-opt");
      var task = null;
      for(var i=0;i<depState.pickerItems.length;i++){
        if(depState.pickerItems[i].id === id){ task = depState.pickerItems[i]; break; }
      }
      var mode = depState.mode;
      closeDepPicker();
      if(task) addDependency(task, mode);
      return;
    }
    var retry = e.target.closest("[data-dep-retry]");
    if(retry && depState.taskId){ loadTaskDeps(depState.taskId); return; }
    var del = e.target.closest("[data-dep-del]");
    var pdel = e.target.closest("[data-dep-pending-del]");
    if(del){
      var rows = depRowsFor("pred").concat(depRowsFor("succ"));
      for(var j=0;j<rows.length;j++){
        if(rows[j].edge && rows[j].edge.id === del.getAttribute("data-dep-del")){
          deleteDependency(rows[j]); return;
        }
      }
    }
    if(pdel){
      var prows = depRowsFor("pred").concat(depRowsFor("succ"));
      for(var k=0;k<prows.length;k++){
        if(prows[k].pending && prows[k].pending.key === pdel.getAttribute("data-dep-pending-del")){
          deleteDependency(prows[k]); return;
        }
      }
    }
  });
  root.addEventListener("change", function(e){
    if(rt.drawerReadOnly) return;
    var typeSel = e.target.closest("[data-dep-type]");
    var lagInput = e.target.closest("[data-dep-lag]");
    var pType = e.target.closest("[data-dep-pending-type]");
    var pLag = e.target.closest("[data-dep-pending-lag]");
    var rows = depRowsFor("pred").concat(depRowsFor("succ"));
    if(typeSel){
      var id = typeSel.getAttribute("data-dep-type");
      for(var i=0;i<rows.length;i++){
        if(rows[i].edge && rows[i].edge.id === id){
          updateDependency(rows[i], { depType:typeSel.value, lagDays:rows[i].lagDays });
          return;
        }
      }
    }
    if(lagInput){
      var lid = lagInput.getAttribute("data-dep-lag");
      var v = parseInt(lagInput.value, 10);
      if(isNaN(v)) v = 0;
      v = Math.max(-365, Math.min(365, v));
      lagInput.value = v;
      for(var j=0;j<rows.length;j++){
        if(rows[j].edge && rows[j].edge.id === lid){
          updateDependency(rows[j], { depType:rows[j].depType, lagDays:v });
          return;
        }
      }
    }
    if(pType){
      var key = pType.getAttribute("data-dep-pending-type");
      for(var k=0;k<depState.pending.length;k++){
        if(depState.pending[k].key === key){
          depState.pending[k].depType = pType.value;
          renderDeps(); rt.formDirty = true; syncDrawerDirty(); return;
        }
      }
    }
    if(pLag){
      var pkey = pLag.getAttribute("data-dep-pending-lag");
      var pv = parseInt(pLag.value, 10);
      if(isNaN(pv)) pv = 0;
      pv = Math.max(-365, Math.min(365, pv));
      pLag.value = pv;
      for(var n=0;n<depState.pending.length;n++){
        if(depState.pending[n].key === pkey){
          depState.pending[n].lagDays = pv;
          renderDeps(); rt.formDirty = true; syncDrawerDirty(); return;
        }
      }
    }
  });
  root.addEventListener("keydown", function(e){
    var lag = e.target.closest(".dep-lag input");
    if(lag && e.key === "Enter"){ e.preventDefault(); lag.blur(); }
  });
})();

function syncProgByCol(){
  var done = iCol && iCol.value === "done";
  var wrap = $("progWrap");
  if(done){
    iProg.value = 100;
    iProg.disabled = true;
    if(segProg) segProg.classList.add("disabled");
    if(progVal) progVal.textContent = "100%";
    if(wrap) wrap.title = "已完成工作项的进度按 100% 计";
    if(hintEl()) hintEl().textContent = "已完成工作项的进度按 100% 计" +
      (origProgress && origProgress !== 100 ? "（原记录 " + origProgress + "%）" : "");
  }else{
    iProg.disabled = false;
    iProg.value = origProgress;
    if(segProg) segProg.classList.remove("disabled");
    if(progVal) progVal.textContent = (Number(origProgress) || 0) + "%";
    if(wrap) wrap.title = "";
    if(hintEl()) hintEl().textContent = "0–100，拖到 100% 不会自动标记完成（完成以「移入已完成列」为准）";
  }
  syncDrawerFacts();
}
function hintEl(){ return $("progHint"); }
/* 路由切换前收口抽屉：干净则直接关，有改动先确认，确认后再放行路由 */
window.addEventListener("ds:before-route", function(e){
  if(!taskDrawer.classList.contains("on")) return;
  if(!rt.formDirty){ forceCloseTaskDrawer(); return; }
  e.preventDefault();
  var to = e.detail && e.detail.to;
  UI.showConfirm({
    title:"离开当前工作项？",
    msg:"表单、评论草稿或待上传附件尚未保存，切换页面后会丢失。",
    okText:"放弃并离开",
    cancelText:"继续编辑"
  }).then(function(ok){
    if(!ok) return;
    forceCloseTaskDrawer({discardCommentDraft:true});
    window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:to } }));
  });
});
function tryCloseTaskDrawer(){
  if(!taskDrawer.classList.contains("on")) return;
  if(rt.formDirty){
    UI.showConfirm({
      title:"放弃未保存的改动？",
      msg:"当前表单、评论草稿或待上传附件有未保存的内容，关闭后将会丢失。",
      okText:"放弃改动",
      cancelText:"继续编辑"
    }).then(function(ok){ if(ok) forceCloseTaskDrawer({discardCommentDraft:true}); });
    return;
  }
  forceCloseTaskDrawer();
}
function forceCloseTaskDrawer(opts){
  opts = opts || {};
  var closingId = lastCommentDraftId || rt.editingId;
  if(opts.discardCommentDraft) discardCommentDraft(closingId);
  else stashCommentDraft(closingId);
  lastCommentDraftId = null;
  rt.taskFormSeq++;
  setSaveLoading(false);
  var opener = rt.drawerOpener;
  closeDrawer();
  clearWorkTick();
  rt.editingId = null;
  if(opener && opener.isConnected && opener.focus){
    if(rt.drawerCloseTimer) clearTimeout(rt.drawerCloseTimer);
    rt.drawerCloseTimer = setTimeout(function(){
      rt.drawerCloseTimer = null;
      if(!taskDrawer.classList.contains("on")) try{ opener.focus(); }catch(err){}
    }, 160);
  }
}
function wireSegKeyboard(seg){
  if(!seg) return;
  seg.addEventListener("keydown", function(e){
    var b = e.target.closest("button");
    if(!b || b.disabled) return;
    var segEl = b.closest(".seg, .quick-row, .pri-group");
    if(!segEl || segEl.classList.contains("disabled")) return;
    var btns = Array.prototype.slice.call(segEl.querySelectorAll("button:not([disabled])"))
      .filter(function(x){ return x.offsetParent !== null; });
    var idx = btns.indexOf(b);
    if(idx < 0) return;
    var next = -1;
    if(e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % btns.length;
    else if(e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + btns.length) % btns.length;
    else if(e.key === "Home") next = 0;
    else if(e.key === "End") next = btns.length - 1;
    else return;
    e.preventDefault();
    var nb = btns[next];
    nb.focus();
    nb.click();
  });
}
segPri.addEventListener("click", function(e){
  var b = e.target.closest("[data-fpri]"); if(!b) return;
  if(denyReadOnly()) return;
  rt.formPri = b.dataset.fpri; syncFormSegs(); rt.formDirty = true;
});
segCat.addEventListener("click", function(e){
  var b = e.target.closest("[data-fcat]"); if(!b) return;
  if(denyReadOnly()) return;
  rt.formCat = b.dataset.fcat; syncFormSegs(); syncMoreSummary(); rt.formDirty = true;
});
segRecur.addEventListener("click", function(e){
  var b = e.target.closest("[data-recur]"); if(!b) return;
  if(denyReadOnly()) return;
  rt.formRecur = b.dataset.recur; syncFormSegs(); syncMoreSummary(); rt.formDirty = true;
});
segDue.addEventListener("click", function(e){
  var b = e.target.closest("[data-due]"); if(!b) return;
  if(denyReadOnly()) return;
  iDue.value = dueQuickValue(b.dataset.due);
  syncDateBounds();
  rt.formDirty = true;
});
function syncDateBounds(){
  if(!iStart || !iDue) return;
  iStart.max = iDue.value || "";
  iDue.min = iStart.value || "";
  syncDueNote();
  syncDrawerFacts();
}
if(iStart) iStart.addEventListener("change", function(){ syncDateBounds(); rt.formDirty = true; });
if(iEstimate) iEstimate.addEventListener("input", function(){
  rt.formDirty = true;
  var t = rt.editingId ? taskCacheExtra[rt.editingId] : null;
  var act = (t && t.totalMinutes) ? t.totalMinutes : 0;
  var h = Number(this.value);
  renderActualEstimate(act, h > 0 ? Math.round(h * 60) : 0);
});
if(iDue) iDue.addEventListener("change", function(){ syncDateBounds(); rt.formDirty = true; });
if(segStart) segStart.addEventListener("click", function(e){
  var b = e.target.closest("[data-start]");
  if(!b) return;
  if(denyReadOnly()) return;
  iStart.value = startPresetDate(b.dataset.start) || "";
  syncDateBounds();
  /* 快捷按钮可能把开始日期推到截止日期之后（例如截止还停在上周，点了「本周一」）：
     这时把截止日期一起顺延，别让用户点完还得回来改另一个字段 */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    iDue.value = iStart.value;
    syncDateBounds();
    toast("截止日期已同步为与开始日期同一天", "warn");
  }
  rt.formDirty = true;
});
segProg.addEventListener("click", function(e){
  var b = e.target.closest("[data-prog]"); if(!b) return;
  if(denyReadOnly()) return;
  iProg.value = b.dataset.prog; syncProgVal(); rt.formDirty = true;
});
[segPri, segCat, segRecur, segDue, segStart, segProg].forEach(wireSegKeyboard);
iProg.addEventListener("input", function(){ syncProgVal(); rt.formDirty = true; });
function inTaskAuxSection(target){
  /* 依赖区是即时保存：类型/滞后改动走各自的接口，不计入主表单脏状态 */
  return !!(target && target.closest && target.closest("#fComments, #fSubtasks, #fAttach, #fDeps"));
}
taskForm.addEventListener("input", function(e){
  if(e.target === iProg) return;
  if(formSettling(e.target)) return; // 异步下拉回填期间的伪 input 不算用户改动
  /* 评论草稿单独计入未保存内容；检查清单/附件区仍按各自的即时操作处理 */
  if(e.target === iComment || !inTaskAuxSection(e.target)) rt.formDirty = true;
  if(e.target === iTitle){
    fTitle.classList.remove("invalid");
    syncTitleCount();
  }
});
taskForm.addEventListener("change", function(e){
  if(formSettling(e.target)) return; // 异步下拉回填期间的伪 change 不算用户改动
  if(!inTaskAuxSection(e.target)) rt.formDirty = true;
  if(e.target && e.target.closest && e.target.closest("#drawerMore")) syncMoreSummary();
});
iCol.addEventListener("change", function(){ syncProgByCol(); syncDrawerHead(); rt.formDirty = true; });
/* 「工作项类型」旁的 ! 图标：点开弹层解释四类区别 */
var itemTypeHelp = $("iItemTypeHelp");
var itemTypeHelpPop = null;
if(itemTypeHelp){
  itemTypeHelp.innerHTML = icon("alertCircle", 13);
  itemTypeHelp.addEventListener("click", function(){
    if(UI.popOpen(itemTypeHelpPop)){ UI.closeAllPops(); return; }
    var el = document.createElement("div");
    el.className = "menu popover type-help-pop";
    el.innerHTML = itemTypeInfoHTML();
    itemTypeHelpPop = el;
    UI.openPop(el, itemTypeHelp, { align:"left", width:360, onClose:function(){ el.remove(); itemTypeHelpPop = null; } });
  });
}
/* 「所属史诗」旁的 ! 图标：解释史诗（Epic）概念 */
var epicHelp = $("iEpicHelp");
var epicHelpPop = null;
if(epicHelp){
  epicHelp.innerHTML = icon("alertCircle", 13);
  epicHelp.addEventListener("click", function(){
    if(UI.popOpen(epicHelpPop)){ UI.closeAllPops(); return; }
    var epicDesc = (ITEM_TYPE_DESCS.filter(function(o){ return o.key === "epic"; })[0] || {}).desc || "";
    var el = document.createElement("div");
    el.className = "menu popover type-help-pop";
    el.innerHTML = '<div class="menu-title">史诗（Epic）</div><div class="type-help-list">' +
      '<div class="type-help-row"><span class="mini-tag type-epic">史诗</span>' +
      '<span class="type-help-desc">' + esc(epicDesc) + '。任务、用户故事、缺陷都可挂到某个史诗下，也可不挂。</span></div></div>';
    epicHelpPop = el;
    UI.openPop(el, epicHelp, { align:"left", width:360, onClose:function(){ el.remove(); epicHelpPop = null; } });
  });
}
/* 「计划版本」旁的 ? 图标：解释版本与首版/迭代为什么不是同一个可选维度 */
var versionHelp = $("iVersionHelp");
var versionHelpPop = null;
if(versionHelp){
  versionHelp.innerHTML = icon("helpCircle", 13);
  versionHelp.addEventListener("click", function(){
    if(UI.popOpen(versionHelpPop)){ UI.closeAllPops(); return; }
    var el = document.createElement("div");
    el.className = "menu popover type-help-pop";
    el.innerHTML = versionPhaseInfoHTML();
    versionHelpPop = el;
    UI.openPop(el, versionHelp, { align:"left", width:Math.max(280, Math.min(380, window.innerWidth - 16)), onClose:function(){ el.remove(); versionHelpPop = null; } });
  });
}
/* 换项目时计划版本的可选项要跟着换；关联需求的刷新在 requirements 模块里各自监听 */
if(iReq) iReq.addEventListener("change", function(){
  var nowReq = iReq.value || "";
  if(nowReq === lastReqValue) return; // 选项重建等程序化事件：不能按换项目处理
  lastReqValue = nowReq;
  if(!rt.editingId){ newVersionExplicit = false; newInheritedTarget = null; }
  ensureVersion([]); ensureFoundVersion(""); ensureEpic("");
  ensureBranch(($("iBranch") || {}).value, iReq.value);
  /* 换项目后原需求池关联失效：立即清空下拉并按新项目重载候选（后端同口径静默解绑） */
  var demandSel = $("iDemand");
  if(demandSel) demandSel.value = "";
  rt.formDemandId = null;
  ensureDemand("");
  /* 模块随项目走：原项目模块不再可选，回落到新项目第一个模块或「未指定」 */
  ensureCatForProject(iReq.value);
  syncAssocViewBtns();
  syncDrawerHead();
  syncDrawerSource();
  /* 负责人选项里的「本项目角色」跟项目走：换项目后重新取花名册 */
  refreshOwnerSelect();
});
var iDemand = $("iDemand");
if(iDemand) iDemand.addEventListener("change", function(){
  if(!formReady(iDemand)) return; // 异步回填期间的 change 不是用户选择
  var demandNow = iDemand.value || "";
  if(demandNow === lastDemandValue) return;
  lastDemandValue = demandNow;
  if(!rt.editingId && !newVersionExplicit){
    if(newInheritedTarget !== null) ensureVersion([]);
    newInheritedTarget = null;
  }
  rt.formDemandId = iDemand.value || null;
  syncAssocViewBtns();
  syncDrawerSource();
  syncDrawerHead();
  /* 选中需求 → 自动带出需求所属项目（与后端「未选项目时以需求为准」同一口径） */
  if(!iDemand.value) return;
  var opt = iDemand.options[iDemand.selectedIndex];
  var wantReq = opt ? (opt.getAttribute("data-req") || "") : "";
  if(wantReq && wantReq !== iReq.value){
    iReq.value = wantReq;
    /* 这里是程序化换项目，iReq 的 change 不会触发；同步记录避免后续伪 change 重跑一遍清空 */
    lastReqValue = iReq.value;
    ensureVersion([]); ensureFoundVersion(""); ensureEpic("");
    ensureBranch(($("iBranch") || {}).value, wantReq);
    ensureCatForProject(wantReq);
    ensureReqDoc("");
    ensureDemand(iDemand.value);
  }
  /* 项目被需求带出后，来源卡的「自动」标记与头部摘要要按新项目重算 */
  syncDrawerSource();
  syncDrawerHead();
});
var demandViewBtn = $("iDemandView");
if(demandViewBtn) demandViewBtn.addEventListener("click", function(){
  var sel = $("iDemand");
  var id = sel ? (sel.value || "") : "";
  if(!id) return;
  loadView("demands").then(function(m){ m.openDemandDetailById(id); });
});
var docViewBtn = $("iReqDocView");
if(docViewBtn) docViewBtn.addEventListener("click", function(){
  var sel = $("iReqDoc");
  var id = sel ? (sel.value || "") : "";
  if(!id) return;
  loadView("requirements").then(function(m){ m.openReqDocAndJump(id); });
});
var sourceRemoveBtn = $("drawerSourceRemove");
if(sourceRemoveBtn) sourceRemoveBtn.addEventListener("click", function(){
  if(denyReadOnly()) return;
  var sel = $("iDemand");
  if(!sel) return;
  sel.value = "";
  sel.dispatchEvent(new Event("change", { bubbles:true }));
});
/* 需求下拉由 demands 模块异步填充，值不变但选项变化时同步来源卡与自动标记 */
if(iDemand && window.MutationObserver){
  new MutationObserver(function(){
    syncDrawerSource();
  }).observe(iDemand, { childList:true });
}
if(iItemType) iItemType.addEventListener("change", function(){
  syncDefectFields();
  syncTypeButtons();
  syncDrawerHead();
  if(iItemType.value === "bug" && iSeverity && !iSeverity.value){
    var firstSev = document.querySelector("#sevGrid [data-sev]");
    try{ (firstSev || iSeverity).focus(); }catch(e){ /* noop */ }
  }
  rt.formDirty = true;
});
var typeGroup = $("typeGroup");
if(typeGroup) typeGroup.addEventListener("click", function(e){
  var b = e.target.closest("[data-type]");
  if(!b || !iItemType) return;
  if(denyReadOnly()) return;
  if(iItemType.value === b.dataset.type) return;
  iItemType.value = b.dataset.type;
  iItemType.dispatchEvent(new Event("change", { bubbles:true }));
});
var sevGrid = $("sevGrid");
if(sevGrid) sevGrid.addEventListener("click", function(e){
  var b = e.target.closest("[data-sev]");
  if(!b || !iSeverity) return;
  if(denyReadOnly()) return;
  iSeverity.value = b.dataset.sev;
  iSeverity.dispatchEvent(new Event("change", { bubbles:true }));
});
if(iBlocked){
  iBlocked.addEventListener("change", function(){
    if(iBlockedReason){
      iBlockedReason.disabled = !iBlocked.checked;
      if(iBlocked.checked){ try{ iBlockedReason.focus(); }catch(e){ /* noop */ } }
      else iBlockedReason.value = "";
    }
    syncMoreSummary();
    rt.formDirty = true;
  });
}
function loadComments(taskId){
  if(!fComments || !commentList) return;
  commentList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/comments").then(function(list){
    if(rt.editingId === taskId) renderComments(list);
  }).catch(function(ex){
    if(rt.editingId !== taskId) return;
    commentsCache = [];
    if(commentCount) commentCount.textContent = "";
    commentList.innerHTML = drawerLoadErrorHTML("评论加载失败：" + (ex.message || "网络异常"), "retry-comments");
  });
}
function renderComments(list){
  commentsCache = list || [];
  if(commentCount) commentCount.textContent = commentsCache.length ? (commentsCache.length + " 条") : "";
  if(!commentsCache.length){
    commentList.innerHTML = '<div class="sub-empty">还没有评论。这里是讨论区，与下方「操作时间线」分开：时间线记系统做了什么，评论记人说了什么。</div>';
    return;
  }
  var myId = rt.currentUser ? rt.currentUser.id : "";
  commentList.innerHTML = commentsCache.map(function(c){
    var mine = c.authorId && c.authorId === myId;
    var files = c.attachments || [];
    return '<div class="comment-item' + (mine ? " mine" : "") + '" data-cid="' + esc(c.id) + '">' +
      avatarHTML(c.authorName || "?", "sm") +
      '<span class="ci-main">' +
        '<span class="ci-head"><span class="ci-who">' + esc(c.authorName || "未知") + '</span>' +
          (function(){
            if(!rt.currentWs || rt.currentWs.type !== "shared") return "";
            var company = companyOfUser(c.authorId);
            return company ? companyChipHTML(company) : "";
          })() +
          '<span class="ci-time">' + esc(fmtTs(c.createdAt)) + '</span>' +
          (mine && !rt.drawerReadOnly ? '<button class="ci-del" type="button" data-comment-del="' + esc(c.id) + '">删除</button>' : '') +
        '</span>' +
        (c.content ? '<span class="ci-body">' + esc(c.content) + '</span>' : '') +
        (files.length ? '<span class="ci-files">' + files.map(function(a){
          /* 与附件区一致：可预览的开弹框，表格开 Univer，其余仍走新标签 */
          var canPrev = previewable(a.filename);
          var isSheet = /\.(xlsx|xls)$/i.test(a.filename || "");
          var openKey = canPrev ? ' data-att-prev="' + esc(a.id) + '"'
            : (isSheet ? ' data-att-sheet="' + esc(a.id) + '"' : "");
          var openTitle = canPrev ? "在线预览" : (isSheet ? "打开表格" : "预览 / 下载");
          return '<a class="ci-file" href="' + attUrl(a.id) + '" target="_blank" rel="noopener" title="' + openTitle + '"' + openKey + '>' +
            icon("clip", 12) +
            '<span class="cf-name">' + esc(a.filename) + '</span>' +
            '<span class="cf-size">' + esc(fmtSize(a.size)) + '</span>' +
          '</a>';
        }).join("") + '</span>' : '') +
      '</span>' +
    '</div>';
  }).join("");
}
/* 评论附件按 id 找回对象：预览/表格弹层都需要文件名与大小 */
function findCommentAtt(attId){
  for(var i = 0; i < commentsCache.length; i++){
    var files = (commentsCache[i] && commentsCache[i].attachments) || [];
    for(var j = 0; j < files.length; j++){
      if(files[j].id === attId) return files[j];
    }
  }
  return null;
}
/* ==================== 评论附件 ==================== */
var pendingCommentFiles = [];
/* 按任务保留未发送的评论草稿：切任务、保存表单或临时关闭抽屉后还能找回 */
var commentDrafts = Object.create(null);
var lastCommentDraftId = null;
var COMMENT_FILE_RE = /\.(jpe?g|png|gif|webp|pdf|txt|md|zip|docx?|xlsx?|pptx?)$/i;
var COMMENT_FILE_MAX = 10 * 1024 * 1024;
var COMMENT_FILE_MAX_COUNT = 5;

function stashCommentDraft(taskId){
  if(!taskId) return;
  var text = iComment ? iComment.value : "";
  if(!text.trim() && !pendingCommentFiles.length){ delete commentDrafts[taskId]; return; }
  commentDrafts[taskId] = { text:text, files:pendingCommentFiles.slice() };
}
function restoreCommentDraft(taskId){
  var draft = taskId ? commentDrafts[taskId] : null;
  if(iComment) iComment.value = draft ? draft.text : "";
  pendingCommentFiles = draft ? draft.files.slice() : [];
  renderPendingCommentFiles();
  lastCommentDraftId = taskId || null;
}
function discardCommentDraft(taskId){
  if(taskId) delete commentDrafts[taskId];
  if(lastCommentDraftId === taskId) lastCommentDraftId = null;
}

function renderPendingCommentFiles(){
  if(!commentAttachChips || !commentAttachTip) return;
  commentAttachChips.hidden = !pendingCommentFiles.length;
  commentAttachChips.innerHTML = pendingCommentFiles.map(function(f, i){
    return '<span class="comment-attach-chip">' +
      '<span class="ca-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
      '<span class="ca-size">' + esc(fmtSize(f.size)) + '</span>' +
      '<button type="button" data-comment-file-remove="' + i + '" title="移除" aria-label="移除附件">×</button>' +
    '</span>';
  }).join("");
  commentAttachTip.textContent = pendingCommentFiles.length
    ? ("待上传 " + pendingCommentFiles.length + " 个") : "";
}
function clearPendingCommentFiles(){
  pendingCommentFiles = [];
  if(iCommentFiles) iCommentFiles.value = "";
  renderPendingCommentFiles();
}
function pickCommentFiles(){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  if(iCommentFiles) iCommentFiles.click();
}
function addCommentFiles(picked){
  var before = pendingCommentFiles.length;
  picked.forEach(function(f){
    if(!f.size){ toast("「" + f.name + "」是空文件，已跳过", "warn"); return; }
    if(f.size > COMMENT_FILE_MAX){ toast("「" + f.name + "」超过 10MB，已跳过", "warn"); return; }
    if(!COMMENT_FILE_RE.test(f.name)){
      toast("「" + f.name + "」类型不支持（图片/PDF/Office/txt/md/zip）", "warn");
      return;
    }
    if(pendingCommentFiles.length >= COMMENT_FILE_MAX_COUNT){
      toast("一次最多添加 " + COMMENT_FILE_MAX_COUNT + " 个附件", "warn");
      return;
    }
    for(var i = 0; i < pendingCommentFiles.length; i++){
      if(pendingCommentFiles[i].name === f.name && pendingCommentFiles[i].size === f.size) return;
    }
    pendingCommentFiles.push(f);
  });
  renderPendingCommentFiles();
  if(pendingCommentFiles.length !== before) rt.formDirty = true;
}
/* 评论先落库，再逐个上传附件；单个失败不影响其它文件，最后汇总提示 */
function uploadCommentFiles(commentId, files){
  var failed = [];
  var chain = Promise.resolve();
  files.forEach(function(f){
    chain = chain.then(function(){
      var fd = new FormData();
      fd.append("file", f);
      var url = API.url("/api/comments/" + encodeURIComponent(commentId) + "/attachments" +
        (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
      return fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-XSRF-TOKEN": csrfCookie() },
        body: fd
      }).then(function(res){
        if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
        return res.json().catch(function(){ return null; });
      }).then(function(json){
        if(!json || json.code !== 0){
          failed.push(f.name + "（" + ((json && json.message) || "上传失败") + "）");
        }
      }).catch(function(ex){
        failed.push(f.name + "（" + (ex && ex.message ? ex.message : "网络异常") + "）");
      });
    });
  });
  return chain.then(function(){ return failed; });
}
function sendComment(){
  if(!rt.editingId || !iComment || rt.commentSending) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var text = iComment.value.trim();
  var files = pendingCommentFiles.slice();
  if(!text && !files.length) return;
  if(text.length > 500){ toast("评论最多 500 字", "warn"); return; }
  var id = rt.editingId;
  rt.commentSending = true;
  btnCommentSend.disabled = true;
  if(btnCommentAttach) btnCommentAttach.disabled = true;
  API.post("/api/tasks/" + encodeURIComponent(id) + "/comments", {
    /* 只发附件时给一个占位正文：评论正文在后端是必填的 */
    content: text || "上传了附件",
    /* 从候选里点选过的成员精确带上 ID：正文重名时也能通知到被选中的那位 */
    mentionUserIds: pickedMentionIds(text)
  }).then(function(comment){
    if(!files.length || !comment || comment.id == null) return;
    return uploadCommentFiles(comment.id, files).then(function(failed){
      if(failed.length) toast("评论已发表，部分附件上传失败：" + failed.join("、"), "bad");
    });
  }).then(function(){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    if(btnCommentAttach) btnCommentAttach.disabled = false;
    /* 发送期间切到了别的任务：不要把新任务抽屉里的草稿清掉 */
    if(rt.editingId !== id) return;
    iComment.value = "";
    closeMention();
    mentionPicked = [];
    clearPendingCommentFiles();
    discardCommentDraft(id);
    /* 评论已发表：把这部分从脏基线里移走，不影响表单其他未保存字段 */
    if(formBase){ formBase.comment = ""; formBase.commentFiles = ""; }
    syncDrawerDirty();
    loadComments(id);
  }).catch(function(ex){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    if(btnCommentAttach) btnCommentAttach.disabled = false;
    toast(ex.message || "发送失败", "bad");
  });
}
if(btnCommentSend) btnCommentSend.addEventListener("click", sendComment);
if(btnCommentAttach) btnCommentAttach.addEventListener("click", pickCommentFiles);
if(iCommentFiles) iCommentFiles.addEventListener("change", function(){
  var picked = Array.prototype.slice.call(iCommentFiles.files || []);
  iCommentFiles.value = "";
  if(!picked.length) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  addCommentFiles(picked);
});
if(commentAttachChips) commentAttachChips.addEventListener("click", function(e){
  var btn = e.target.closest("[data-comment-file-remove]");
  if(!btn) return;
  pendingCommentFiles.splice(Number(btn.dataset.commentFileRemove), 1);
  renderPendingCommentFiles();
  rt.formDirty = true;
});

/* ==================== 评论 @提及 ==================== */
var mentionState = {open:false, items:[], index:0, start:0, end:0};
var mentionMembersLoading = false;
/* 候选拉取失败后短暂退避，避免断网时每次输入都重试 */
var mentionMembersFailedAt = 0;
var MENTION_RETRY_MS = 30000;
/* 候选只含对该任务所在项目可见的成员；按任务缓存，避免把隐藏项目的成员点进去 */
var mentionCandidateTask = null;
var mentionCandidates = [];
var mentionPicked = [];
/* idle / loading / ready / error：@ 后候选区据此展示加载与失败提示，避免静默无反应 */
var mentionLoadState = "idle";
/* @ 后不出现空白，视为一次提及输入；"a@b.com" 这类邮箱不会被识别。
   候选最多渲染 50 条并在框内滚动，避免成员多时“只能靠输入名字才找得到人” */
var MENTION_MAX_ITEMS = 50;
function currentMentionMembers(){
  return mentionCandidates.filter(function(m){
    return m && m.userId && m.displayName && (!rt.currentUser || m.userId !== rt.currentUser.id);
  });
}
function ensureMentionMembers(force){
  var taskId = rt.editingId;
  if(!taskId || mentionMembersLoading || mentionCandidateTask === taskId) return;
  if(!force && mentionMembersFailedAt && Date.now() - mentionMembersFailedAt < MENTION_RETRY_MS) return;
  mentionMembersLoading = true;
  mentionLoadState = "loading";
  if(mentionState.open){ mentionState.notice = "正在加载成员…"; renderMention(); }
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/mention-candidates").then(function(list){
    mentionMembersLoading = false;
    mentionMembersFailedAt = 0;
    mentionLoadState = "ready";
    if(rt.editingId !== taskId) return;
    mentionCandidateTask = taskId;
    mentionCandidates = list || [];
    if(document.activeElement === iComment) detectMention();
  }).catch(function(){
    mentionMembersLoading = false;
    mentionMembersFailedAt = Date.now();
    mentionLoadState = "error";
    if(document.activeElement === iComment) detectMention();
  });
}
function rememberMention(m){
  for(var i = 0; i < mentionPicked.length; i++){
    if(mentionPicked[i].userId === m.userId) return;
  }
  mentionPicked.push({userId: m.userId, displayName: m.displayName});
}
/* 与后端 Mentions 同口径：字母/数字/下划线视为名字的延续，中文按字母处理 */
function isMentionWordChar(ch){
  return !!ch && (/[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) > 127);
}
function hasMentionToken(text, name){
  var token = "@" + name;
  var from = 0;
  while(true){
    var at = text.indexOf(token, from);
    if(at < 0) return false;
    if(!isMentionWordChar(text.charAt(at + token.length))) return true;
    from = at + 1;
  }
}
/* 只把仍留在正文里的点选成员发给后端：删掉 @名字 后不应再通知 */
function pickedMentionIds(text){
  return mentionPicked.filter(function(p){
    return hasMentionToken(text, p.displayName);
  }).map(function(p){ return p.userId; });
}
function closeMention(){
  mentionState.open = false;
  if(commentMention) commentMention.hidden = true;
}
/* 中文没有词边界，"请@张三" 是自然写法；只有 ASCII 字母/数字/下划线前的 @ 视为邮箱 */
function isMentionStartBlocked(ch){
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}
/* 中文输入法常打出全角 ＠，统一成半角，否则前端不触发、后端也解析不到 */
function normalizeFullWidthMention(){
  if(!iComment || iComment.value.indexOf("＠") < 0) return;
  var caret = iComment.selectionStart;
  iComment.value = iComment.value.replace(/＠/g, "@");
  try{ iComment.setSelectionRange(caret, caret); }catch(e){ /* noop */ }
}
function detectMention(){
  if(!iComment || rt.drawerReadOnly){ closeMention(); return; }
  normalizeFullWidthMention();
  ensureMentionMembers();
  var caret = iComment.selectionStart;
  var before = iComment.value.slice(0, caret);
  var at = before.lastIndexOf("@");
  if(at < 0){ closeMention(); return; }
  if(isMentionStartBlocked(before.charAt(at - 1))){ closeMention(); return; }
  var query = before.slice(at + 1);
  if(/\s/.test(query)){ closeMention(); return; }
  var q = query.toLowerCase();
  var items = currentMentionMembers().filter(function(m){
    return (m.displayName || "").toLowerCase().indexOf(q) >= 0
      || (m.username || "").toLowerCase().indexOf(q) >= 0;
  }).slice(0, MENTION_MAX_ITEMS);
  var notice = "";
  if(mentionLoadState !== "ready"){
    notice = mentionLoadState === "error" ? "成员加载失败，点击重试" : "正在加载成员…";
  }else if(!items.length && !q){
    notice = "暂无可提及的成员";
  }
  if(!items.length && !notice){ closeMention(); return; }
  mentionState = {open:true, items:items, index:0, start:at, end:caret, notice:notice};
  renderMention();
}
function renderMention(){
  if(!commentMention) return;
  commentMention.hidden = !mentionState.open;
  if(!mentionState.open) return;
  if(!mentionState.items.length){
    commentMention.innerHTML = '<div class="cm-empty"' +
      (mentionLoadState === "error" ? ' data-cm-retry="1" role="button" tabindex="0"' : '') +
      '>' + esc(mentionState.notice || "") + '</div>';
    return;
  }
  commentMention.innerHTML = mentionState.items.map(function(m, i){
    return '<button type="button" class="cm-item' + (i === mentionState.index ? " on" : "") + '" data-cm-idx="' + i + '">' +
      avatarHTML(m.displayName, "sm") +
      '<span class="cm-name ellipsis">' + esc(m.displayName) + '</span>' +
      (m.username ? '<span class="cm-user">@' + esc(m.username) + '</span>' : '') +
    '</button>';
  }).join("");
  var on = commentMention.querySelector(".cm-item.on");
  if(on && on.scrollIntoView) on.scrollIntoView({block:"nearest"});
}
function pickMention(idx){
  var m = mentionState.items[idx];
  if(!m) return;
  rememberMention(m);
  var insert = "@" + m.displayName + " ";
  iComment.value = iComment.value.slice(0, mentionState.start) + insert + iComment.value.slice(mentionState.end);
  var caret = mentionState.start + insert.length;
  closeMention();
  try{
    iComment.focus();
    iComment.setSelectionRange(caret, caret);
  }catch(e){ /* noop */ }
}
function moveMention(step){
  var n = mentionState.items.length;
  if(!n) return;
  mentionState.index = (mentionState.index + step + n) % n;
  renderMention();
}
function mentionKeydown(e){
  if(!mentionState.open) return false;
  if(e.key === "ArrowDown"){ e.preventDefault(); e.stopPropagation(); moveMention(1); return true; }
  if(e.key === "ArrowUp"){ e.preventDefault(); e.stopPropagation(); moveMention(-1); return true; }
  /* 只有真正有候选时才把 Enter 交给选择，加载/失败提示态下回车仍按普通换行处理 */
  if((e.key === "Enter" || e.key === "Tab") && mentionState.items.length){
    e.preventDefault();
    e.stopPropagation();
    pickMention(mentionState.index);
    return true;
  }
  if(e.key === "Escape"){ e.stopPropagation(); closeMention(); return true; }
  return false;
}
if(iComment){
  /* 聚焦评论框即预载候选，真正敲 @ 时下拉可直接出现，不必等接口 */
  iComment.addEventListener("focus", function(){ ensureMentionMembers(); });
  iComment.addEventListener("input", detectMention);
  iComment.addEventListener("click", detectMention);
  iComment.addEventListener("blur", function(){ setTimeout(closeMention, 120); });
  iComment.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(mentionKeydown(e)) return;
    if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
      e.preventDefault();
      /* 阻止冒泡：否则文档级 Ctrl+Enter 会把评论当成“保存任务”，跟着提交并关闭抽屉 */
      e.stopPropagation();
      sendComment();
    }
  });
}
if(commentMention){
  /* 按下时不让 textarea 失焦，否则 blur 先关掉候选框，click 无法命中 */
  commentMention.addEventListener("mousedown", function(e){ e.preventDefault(); });
  commentMention.addEventListener("click", function(e){
    if(e.target.closest("[data-cm-retry]")){ ensureMentionMembers(true); return; }
    var b = e.target.closest("[data-cm-idx]");
    if(b) pickMention(Number(b.dataset.cmIdx));
  });
}
if(commentList){
  commentList.addEventListener("click", function(e){
    if(e.target.closest("[data-retry-comments]") && rt.editingId){ loadComments(rt.editingId); return; }
    var prev = e.target.closest("[data-att-prev]");
    if(prev){
      e.preventDefault();
      var att = findCommentAtt(prev.dataset.attPrev);
      if(att) openAttPreview({ attachment: att });
      return;
    }
    var sheet = e.target.closest("[data-att-sheet]");
    if(sheet){
      e.preventDefault();
      var attSheet = findCommentAtt(sheet.dataset.attSheet);
      if(!attSheet) return;
      /* 评论附件只读打开，避免从讨论区改写附件内容 */
      import("./sheet-viewer.js").then(function(m){
        m.openSheet({ attachment: attSheet, canEdit: false });
      }).catch(function(ex){ toast(ex && ex.message ? ex.message : "打开表格失败", "bad"); });
      return;
    }
    var del = e.target.closest("[data-comment-del]");
    if(!del || !rt.editingId) return;
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    var id = rt.editingId;
    API.del("/api/comments/" + encodeURIComponent(del.dataset.commentDel)).then(function(){
      toast("评论已删除", "fs");
      loadComments(id);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function showDrawerNotice(text){
  if(!drawerNotice) return;
  drawerNoticeText.textContent = text;
  drawerNotice.hidden = false;
}
if(drawerNoticeReload){
  function reloadDrawerFromServer(){
    if(!rt.editingId) return;
    var id = rt.editingId;
    drawerNotice.hidden = true;
    API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
      if(!t){ toast("工作项不存在或你没有访问权限", "warn"); return; }
      taskCacheExtra[t.id] = t;
      /* 评论草稿按任务保存，重新加载表单不会丢掉未发送的评论 */
      openTaskDrawer(null, t);
    }).catch(function(){ toast("刷新失败，请稍后重试", "bad"); });
  }
  drawerNoticeReload.addEventListener("click", function(){
    if(!formFieldsDirty()){ reloadDrawerFromServer(); return; }
    UI.showConfirm({
      title:"重新加载最新版本？",
      msg:"表单有未保存的修改，重新加载会用服务器最新内容覆盖表单；评论草稿会按任务保留。",
      okText:"放弃表单修改并刷新",
      cancelText:"继续编辑"
    }).then(function(ok){ if(ok) reloadDrawerFromServer(); });
  });
}
iTags.addEventListener("keydown", function(e){
  if(e.isComposing || e.keyCode === 229) return;
  if(e.key === "Enter" || e.key === "," || e.key === "，"){
    e.preventDefault();
    var v = iTags.value.trim().replace(/[,，]/g, "");
    if(!v) return;
    if(rt.tagsCache.length >= 8){ toast("最多 8 个标签", "warn"); return; }
    if(v.length > 16){ toast("单个标签不超过 16 字", "warn"); v = v.slice(0, 16); }
    if(rt.tagsCache.indexOf(v) === -1) rt.tagsCache.push(v);
    iTags.value = "";
    renderTagChips();
    rt.formDirty = true;
  }else if(e.key === "Backspace" && !iTags.value && rt.tagsCache.length){
    rt.tagsCache.pop();
    renderTagChips();
    rt.formDirty = true;
  }
});
iTags.addEventListener("blur", function(){
  var v = iTags.value.trim().replace(/[,，]/g, "");
  if(!v) return;
  if(rt.tagsCache.indexOf(v) === -1 && rt.tagsCache.length < 8) rt.tagsCache.push(v.slice(0, 16));
  iTags.value = "";
  renderTagChips();
});
tagWrap.addEventListener("click", function(e){
  var d = e.target.closest("[data-tag-del]");
  if(!d) return;
  if(denyReadOnly()) return;
  rt.tagsCache.splice(Number(d.dataset.tagDel), 1);
  renderTagChips();
  rt.formDirty = true;
});
taskDrawer.querySelectorAll(".drawer-sect-head").forEach(function(h){
  function toggle(){
    var sect = h.closest(".drawer-sect");
    var collapsed = sect.classList.toggle("collapsed");
    h.setAttribute("aria-expanded", String(!collapsed));
  }
  h.addEventListener("click", toggle);
  h.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
  });
});
$("btnTaskMore").addEventListener("click", function(){
  if(UI.popOpen($("taskMoreMenu"))){ UI.closeAllPops(); return; }
  UI.openPop($("taskMoreMenu"), $("btnTaskMore"), {align:"left"});
});
if(btnTaskWatch) btnTaskWatch.addEventListener("click", function(){
  var taskId = watchTaskId;
  if(!taskId || btnTaskWatch.disabled) return;
  var watching = btnTaskWatch.getAttribute("aria-pressed") === "true";
  btnTaskWatch.disabled = true;
  var req = watching
    ? API.del("/api/tasks/" + encodeURIComponent(taskId) + "/watch")
    : API.post("/api/tasks/" + encodeURIComponent(taskId) + "/watch");
  req.then(function(res){
    btnTaskWatch.disabled = false;
    if(watchTaskId !== taskId) return;
    renderWatchButton(res);
    toast(watching ? "已取消关注" : "已关注：该工作项的评论与回收站操作会通知你");
  }, function(e){
    btnTaskWatch.disabled = false;
    if(!e || !e.silent) toast((e && e.message) || "操作失败", "bad");
  });
});
/* 任务详情内新建任务：沿用当前任务的项目/版本/史诗，抽屉切换为新建模式 */
if(btnTaskNew) btnTaskNew.addEventListener("click", function(){
  if(!rt.editingId) return;
  if(rt.formDirty){ toast("当前工作项有未保存的改动，请先保存再新建", "warn"); return; }
  var t = taskCacheExtra[rt.editingId] || {};
  var vSel = $("iVersion"), eSel = $("iEpic");
  openTaskDrawer(t.boardColumn || "backlog", null, {
    reqId: currentReqId() || t.reqId || "",
    versionIds: selectedVersionIds(vSel).filter(function(id){ return Array.from(vSel.options).some(function(o){ return o.value === id && !o.disabled; }); }),
    epicId: (eSel && eSel.value) || ""
  });
});
$("taskMoreMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-task-more]");
  if(!b) return;
  var kind = b.dataset.taskMore;
  UI.closeAllPops();
  var t = rt.editingId ? taskById(rt.editingId) : null;
  if(kind === "copy-link"){
    if(!t) return;
    copyToClipboard(window.location.origin + window.location.pathname + "#/board?task=" + encodeURIComponent(t.id), "工作项链接已复制到剪贴板");
    return;
  }
  if(kind === "copy-title"){
    if(!t) return;
    copyToClipboard(t.title, "标题已复制到剪贴板");
    return;
  }
  if(kind === "save-continue"){
    if(btnSaveTaskContinue && !btnSaveTaskContinue.hidden && !btnSaveTaskContinue.disabled){
      taskForm.requestSubmit(btnSaveTaskContinue);
    }
    return;
  }
  if(kind === "trash"){
    if(!t) return;
    /* 确认框取消时抽屉保持打开；成功删除后 deleteTask 内部关闭 */
    deleteTask(t.id);
  }
});
taskForm.addEventListener("submit", function(e){
  e.preventDefault();
  if(rt.drawerReadOnly || btnSaveTask.disabled) return;
  var saveAndContinue = !!(e.submitter && e.submitter.id === "btnSaveTaskContinue");
  var title = iTitle.value.trim();
  if(!title){
    fTitle.classList.add("invalid");
    focusField(iTitle);
    return;
  }
  if(!rt.editingId && iReq.value && !$("iVersion").getAttribute("data-ready")){
    toast("请等待计划版本加载完成；加载失败时请重开抽屉重试", "warn"); return;
  }
  var pendingTag = iTags.value.trim().replace(/[,，]/g, "");
  if(pendingTag && rt.tagsCache.indexOf(pendingTag) === -1 && rt.tagsCache.length < 8) rt.tagsCache.push(pendingTag.slice(0, 16));
  /* 开始日期 ≤ 截止日期（服务端也有同样校验，这里先拦一道省一次往返） */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    toast("开始日期不能晚于截止日期", "bad");
    focusField(iStart);
    return;
  }
  var itemTypeValue = (iItemType && iItemType.value) || "task";
  if(itemTypeValue === "bug" && !(iSeverity && iSeverity.value)){
    toast("缺陷必须选择严重度", "bad");
    var severityField = $("fSeverity");
    if(severityField) severityField.classList.add("invalid");
    var firstSevBtn = document.querySelector("#sevGrid [data-sev]");
    focusField(firstSevBtn || iSeverity);
    return;
  }
  var owner = ownerPick();
  var stillDone = (iCol.value || "backlog") === "done";
  var current = rt.editingId ? taskCacheExtra[rt.editingId] : null;
  var docSel = $("iReqDoc"), branchSel = $("iBranch"), foundSel = $("iFoundVersion");
  var payload = {
    oldUpdatedAt: current ? (current.updatedAt || null) : null,
    title: title,
    description: iDesc.value.trim(),
    priority: rt.formPri,
    categoryId: rt.formCat || null,
    owner: owner.name,
    ownerUserId: owner.userId,
    boardColumn: iCol.value || "backlog",
    startDate: iStart.value || null,
    dueDate: iDue.value || null,
    isMilestone: !!(($("iMilestone") || {}).checked),
    reqId: iReq.value || null,
    /* 文档候选未加载完就保存（如 Ctrl+Enter）：保留原关联，不把加载失败误当成解除关联 */
    reqDocId: (docSel && docSel.getAttribute("data-ready")) ? (docSel.value || null) : (current ? (current.reqDocId || null) : null),
    /* 分支按项目过滤后可能只剩占位项，不能用 options 数量判断是否加载完 */
    branchId: (branchSel && branchSel.getAttribute("data-ready")) ? (branchSel.value || null) : (current ? (current.branchId || null) : null),
    itemType: itemTypeValue,
    /* 缺陷字段：type 不是 bug 时后端会清空；bug 时空串表示明确清除文本/解绑，
       null 仅用于「下拉未就绪」以保留原值 */
    severity: itemTypeValue === "bug" ? (iSeverity ? iSeverity.value : "") : null,
    environment: itemTypeValue === "bug" ? (iEnvironment ? iEnvironment.value.trim() : "") : null,
    reproduceSteps: itemTypeValue === "bug" ? (iReproSteps ? iReproSteps.value.trim() : "") : null,
    foundVersionId: (function(){
      if(itemTypeValue !== "bug") return null;
      if(foundSel && foundSel.getAttribute("data-ready")) return foundSel.value || "";
      return current ? (current.foundVersionId || null) : null;
    })(),
    regressionStatus: itemTypeValue === "bug" ? (iRegression ? (iRegression.value || "") : "") : null,
    /* null 保留原关联，已就绪后的 [] 明确解除全部版本。 */
    versionIds: (function(){
      var vs = $("iVersion");
      return vs && vs.getAttribute("data-ready") ? selectedVersionIds(vs) : null;
    })(),
    epicId: (function(){
      var es = $("iEpic");
      if(es && es.getAttribute("data-ready")) return es.value || "";
      return current ? (current.epicId || null) : null;
    })(),
    /* 关联需求池需求：下拉就绪以当前选择为准（空串=明确解除）；
       未就绪（如 Ctrl+Enter）保留打开时带出的关联，null=后端保持原值 */
    demandId: (function(){
      var ds = $("iDemand");
      if(ds && ds.getAttribute("data-ready")) return ds.value || "";
      return rt.formDemandId || null;
    })(),
    /* O-13：在已完成列里不改动原进度（抽屉显示 100% 只是口径）；离开该列才写回用户设定的值 */
    progress: (startedDone && stillDone) ? origProgress : (Number(iProg.value) || 0),
    /* 小时 → 分钟；空/0 一律视为"没估"，不传 0 去污染系数 */
    estimateMinutes: (function(){
      var h = iEstimate ? Number(iEstimate.value) : 0;
      if(!h || h <= 0) return null;
      return Math.min(10080, Math.round(h * 60));
    })(),
    note: iNote.value.trim(),
    recurType: rt.formRecur,
    remindAt: iRemind.value ? iRemind.value : null,
    remindTarget: iRemindTarget ? iRemindTarget.value : "owner",
    blocked: !!(iBlocked && iBlocked.checked),
    blockedReason: (iBlocked && iBlocked.checked && iBlockedReason)
      ? (iBlockedReason.value.trim() || null) : null,
    tags: rt.tagsCache.slice(0, 8)
  };
  var seq = rt.taskFormSeq;
  var wasEdit = !!rt.editingId;
  var editId = rt.editingId;
  var revAtSubmit = formRev;
  /* 抽屉内改列与看板拖拽走同一套流转规则：先判定，必要时补原因/强制 */
  var fromCol = current ? current.boardColumn : null;
  var toCol = payload.boardColumn;
  var columnChanged = wasEdit && fromCol !== toCol;
  var wsId = (current && current.workspaceId) || (rt.currentWs && rt.currentWs.id);
  var items = columnChanged ? [{ from: fromCol, title: title }] : [];
  /* 与后端一致：改到「正常计时」列会自动开表；只在能确认目标列规则时提示，避免误导 */
  var autoTimerHint = (function(){
    if(!columnChanged || payload.blocked) return false;
    if(state.runningTimer && state.runningTimer.taskId === editId) return false;
    for(var i = 0; i < COLUMNS.length; i++){
      if(COLUMNS[i].id === toCol) return COLUMNS[i].processingRule === "normal";
    }
    for(var j = 0; j < rt.colDefsCache.length; j++){
      if(rt.colDefsCache[j].id === toCol) return (rt.colDefsCache[j].processingRule || "normal") === "normal";
    }
    return false;
  })();
  var retried = false;
  var conflictOverwriteTried = false;
  /* 409：先读服务器最新版本，展示变化字段；重载或明确覆盖都由用户决定 */
  function handleSaveConflict(){
    API.get("/api/task/" + encodeURIComponent(editId)).then(function(fresh){
      if(seq !== rt.taskFormSeq) return;
      if(!fresh){ setSaveLoading(false); toast("保存冲突，且无法读取最新版本；请关闭抽屉后重新打开", "bad"); return; }
      var labels = conflictChangedLabels(current, fresh);
      var changedText = labels.length
        ? ("服务器上已更新：" + labels.slice(0, 6).join("、") + (labels.length > 6 ? " 等" : "") + "。")
        : "服务器上的内容已变化。";
      UI.showConfirm({
        title:"工作项已被他人修改",
        msg:esc(changedText) + "重新加载会放弃你当前的修改；也可以选择用当前表单覆盖服务器最新版本。",
        okText:"重新加载最新版本",
        cancelText:"用我的修改覆盖",
        danger:false
      }).then(function(reload){
        if(reload){
          taskCacheExtra[fresh.id] = fresh;
          openTaskDrawer(null, fresh);
          return;
        }
        return UI.showConfirm({
          title:"覆盖服务器最新版本？",
          msg:"这会用当前表单覆盖他人刚刚保存的内容。请确认你已核对差异。",
          okText:"覆盖保存",
          cancelText:"继续编辑"
        }).then(function(force){
          if(!force || seq !== rt.taskFormSeq) return;
          if(formRev !== revAtSubmit){ toast("表单已继续变化，请重新保存", "warn"); return; }
          if(conflictOverwriteTried){ toast("仍与其他修改冲突，请重新加载最新版本", "bad"); return; }
          conflictOverwriteTried = true;
          payload.oldUpdatedAt = fresh.updatedAt || null;
          taskCacheExtra[editId] = Object.assign({}, taskCacheExtra[editId] || fresh, { updatedAt:fresh.updatedAt });
          setSaveLoading(true);
          saveWith();
        });
      });
    }).catch(function(ex){
      if(seq !== rt.taskFormSeq) return;
      setSaveLoading(false);
      toast("保存冲突，且无法读取最新版本：" + (ex.message || "请稍后重试"), "bad");
    });
  }
  function onSaved(nt){
    if(seq === rt.taskFormSeq){ // 只有当前抽屉可修改 loading 和表单；旧成功响应仍刷新视图缓存
      setSaveLoading(false);
      rememberReqId(nt && nt.reqId);
      if(saveAndContinue && wasEdit && rt.editingId === editId){
        /* 连续编辑：留在抽屉里；同步缓存与标题，后续保存不会带着旧值 */
        var changedDuringSave = formRev !== revAtSubmit;
        if(nt && taskCacheExtra[editId]){
          taskCacheExtra[editId] = Object.assign({}, taskCacheExtra[editId], nt);
          if(payload.versionIds !== null && !Array.isArray(nt.versionIds)) taskCacheExtra[editId].versionIds = payload.versionIds.slice();
        }
        if(nt && nt.title && !changedDuringSave) taskDrawerTitle.textContent = nt.title;
        if(!changedDuringSave){
          $("iVersionChangeReason").value = "";
          syncVersionReason();
          syncTaskPublication(taskCacheExtra[editId]);
          rt.formDirty = false;
          resetFormBaseline();
        }
        var stayHint = $("taskFormHint");
        if(stayHint && !rt.drawerReadOnly && !changedDuringSave) stayHint.textContent = "已保存 · 可继续编辑";
        if(changedDuringSave) toast("已保存提交时的内容 · 保存期间的新改动还未保存", "warn");
        else toast("已保存「" + title + "」" + (autoTimerHint ? " · 已开始计时" : ""));
      }else{
        var createdId = !wasEdit && nt ? nt.id : null;
        /* 新建时暂存的依赖要等工作项拿到 id 后才能落库；先记数量再关抽屉 */
        var pendingDepCount = createdId ? depState.pending.length : 0;
        forceCloseTaskDrawer();
        if(wasEdit){
          toast("已更新「" + title + "」" + (autoTimerHint ? " · 已开始计时" : ""), "fs");
        }else if(createdId && pendingDepCount){
          toast("已创建工作项「" + nt.title + "」，正在建立依赖…", "fs");
          flushPendingDependencies(createdId).then(function(res){
            if(res && res.failed){
              toast("工作项已创建，但有 " + res.failed + " 条依赖未建立，可在详情里重新添加", "warn");
            }else{
              toast("已创建工作项「" + nt.title + "」，并建立 " + ((res && res.total) || pendingDepCount) + " 条依赖", "fs");
            }
            refreshGanttIfOpen();
          });
        }else{
          var tip = "已创建工作项「" + nt.title + "」";
          var kind = "fs";
          if(nt.dueDate){
            var d = dayDiff(parseDate(nt.dueDate), rt.TODAY);
            if(d < 0){ tip += "，已逾期 " + Math.abs(d) + " 天"; kind = "warn"; }
            else if(d === 0) tip += "，今天到期";
            else if(d <= 3) tip += "，剩余 " + d + " 天";
          }
          toast(tip, kind);
        }
      }
    }
    loadBoard({animate:true});
    loadReqs();
    refreshCalendarIfOpen();
    refreshListIfOpen();
    refreshGanttIfOpen();
    refreshAssociationViews();
    /* 测试页缺陷 tab 依赖工作项保存后的列与回归状态，通知其重新拉取 */
    window.dispatchEvent(new CustomEvent("ds:task-saved", {
      detail: { id: (wasEdit ? editId : (nt && nt.id)) || "", created: !wasEdit }
    }));
  }
  function saveWith(extra){
    var body = payload;
    if(extra && (extra.reason || extra.force)){
      body = Object.assign({}, payload);
      if(extra.reason) body.moveReason = extra.reason;
      if(extra.force) body.force = true;
    }
    var req = wasEdit
      ? API.put("/api/tasks/" + encodeURIComponent(editId), body)
      : API.post("/api/tasks", body);
    req.then(onSaved).catch(function(ex){
      if(seq !== rt.taskFormSeq) return;
      if(columnChanged && !retried && (ex.code === 412 || ex.code === 422)){
        retried = true;
        serverDecision(wsId, items, toCol, ex).then(function(retry){
          if(seq !== rt.taskFormSeq) return;
          if(!retry){
            setSaveLoading(false);
            if(ex.code !== 412 && ex.code !== 422) toast(ex.message || "保存失败", "bad");
            return;
          }
          saveWith(retry);
        });
        return;
      }
      setSaveLoading(false);
      if(ex.code === 409 && wasEdit){ handleSaveConflict(); return; }
      toast(ex.message || "保存失败", "bad");
    });
  }
  setSaveLoading(true);
  /* 只有实际改版/新建偏离需求目标才要求理由；编辑其他字段不写版本调整理由。 */
  var demandId = payload.demandId === null ? (rt.formDemandId || "") : payload.demandId;
  var needsTarget = !wasEdit && !!demandId;
  (needsTarget ? loadDemandTarget(demandId) : Promise.resolve(null)).then(function(d){
    if(seq !== rt.taskFormSeq) return null;
    var changed = wasEdit && payload.versionIds !== null && !sameIds(payload.versionIds, taskVersionIds(current));
    var deviated = !wasEdit && d && d.status === "plan" && !!targetVersionOf(d) && normalizedIds(payload.versionIds).indexOf(targetVersionOf(d)) === -1;
    if(!changed && !deviated) return true;
    var field = $("fVersionChangeReason"), input = $("iVersionChangeReason");
    field.hidden = false;
    if(input.value.trim()){ payload.versionChangeReason = input.value.trim(); return true; }
    return UI.showPrompt({title:"版本调整理由", desc:changed ? "计划版本发生变化，请说明调整原因。" : "当前计划版本偏离需求目标，请说明原因。", label:"理由（必填）"}).then(function(reason){
      if(seq !== rt.taskFormSeq) return false;
      if(reason === null) return false;
      reason = reason.trim();
      if(!reason || reason.length > 500){ toast("请填写 1–500 字的版本调整理由", "warn"); focusField(input); return false; }
      input.value = reason; payload.versionChangeReason = reason; return true;
    });
  }).then(function(ready){
    if(seq !== rt.taskFormSeq) return;
    if(!ready){ setSaveLoading(false); return; }
    if(formRev !== revAtSubmit){ setSaveLoading(false); toast("填写理由期间表单已变化，请重新保存", "warn"); return; }
    if(!columnChanged){ saveWith(null); return; }
    guard(wsId, items, toCol).then(function(pass){
      if(seq !== rt.taskFormSeq) return;
      if(!pass){ setSaveLoading(false); return; }
      saveWith(pass);
    });
  }).catch(function(ex){
    if(seq !== rt.taskFormSeq) return;
    setSaveLoading(false); toast("需求目标校验失败：" + (ex.message || "请重试"), "bad");
  });
});
$("btnCloseTask").addEventListener("click", tryCloseTaskDrawer);
$("btnCancelTask").addEventListener("click", tryCloseTaskDrawer);
$("taskScrim").addEventListener("click", tryCloseTaskDrawer);
$("btnDeleteTask").addEventListener("click", function(){
  if(!rt.editingId) return;
  var id = rt.editingId;
  /* 先弹确认：取消时抽屉保持打开，未保存的内容不丢；成功删除后 deleteTask 会关闭抽屉 */
  deleteTask(id);
});
taskDrawer.addEventListener("keydown", function(e){
  if(e.key !== "Tab") return;
  var root = taskDrawer.querySelector(".drawer");
  if(!root) return;
  var f = Array.prototype.slice.call(root.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(function(el){ return el.offsetParent !== null; });
  if(!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});
function deleteTask(id){
  var t = taskById(id);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  UI.showConfirm({
    title:"移到回收站",
    msg:"「" + esc(t.title) + "」将移入回收站（30 天内可恢复）。确定删除？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/tasks/" + encodeURIComponent(id)).then(function(){
      t.deletedAt = t.deletedAt || new Date().toISOString();
      delete taskCacheExtra[id];
      delete rt.listCache[id];
      if(rt.editingId === id) forceCloseTaskDrawer({discardCommentDraft:true});
      loadBoard({animate:false});
      loadReqs();
      refreshCalendarIfOpen();
      refreshListIfOpen();
      refreshGanttIfOpen();
      refreshAssociationViews();
      toastAction("已移入回收站「" + t.title + "」", "撤销", function(){
        API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).then(function(){
          delete t.deletedAt;
          toast("已恢复「" + t.title + "」", "fs");
          loadBoard({animate:true, movedId:id});
          loadReqs();
          refreshCalendarIfOpen();
          refreshListIfOpen();
          refreshGanttIfOpen();
          refreshAssociationViews();
        }).catch(function(ex){ toast("恢复失败：" + (ex.message || "网络异常"), "bad"); });
      }, "", 8000);
    }).catch(function(ex){
      toast("删除失败：" + (ex.message || "网络异常"), "bad");
    });
  });
}
function renderSubtasks(list){
  rt.subtasksCache = list || [];
  var doneN = 0;
  rt.subtasksCache.forEach(function(s){ if(s.done) doneN++; });
  if(subCount) subCount.textContent = rt.subtasksCache.length ? (doneN + "/" + rt.subtasksCache.length) : "";
  if(!rt.subtasksCache.length){
    subList.innerHTML = '<div class="sub-empty">暂无检查项，输入后回车即可添加</div>';
    return;
  }
  subList.innerHTML = rt.subtasksCache.map(function(s){
    return '<div class="sub-item' + (s.done ? " done" : "") + '">' +
      '<input type="checkbox" class="cbx" data-sub-toggle="' + s.id + '"' + (s.done ? " checked" : "") +
        (rt.drawerReadOnly ? " disabled" : "") +
        ' aria-label="' + esc(s.title) + '" />' +
      '<span class="sub-txt">' + esc(s.title) + '</span>' +
      (rt.drawerReadOnly ? '' :
        '<button type="button" class="sub-del" data-sub-del="' + s.id + '" title="删除检查项" aria-label="删除检查项">' +
          icon("close", 12) + '</button>') +
    '</div>';
  }).join("");
}
function loadSubtasks(taskId){
  if(!fSubtasks) return;
  subList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/subtasks").then(function(list){
    if(rt.editingId === taskId) renderSubtasks(list);
  }).catch(function(ex){
    if(rt.editingId !== taskId) return;
    rt.subtasksCache = [];
    if(subCount) subCount.textContent = "";
    subList.innerHTML = drawerLoadErrorHTML("检查项加载失败：" + (ex.message || "网络异常"), "retry-subtasks");
  });
}
subList.addEventListener("change", function(e){
  var cb = e.target.closest("[data-sub-toggle]");
  if(!cb || !rt.editingId) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var id = rt.editingId;
  subList.classList.add("busy");
  API.put("/api/subtasks/" + cb.dataset.subToggle, {done: cb.checked}).then(function(){
    subList.classList.remove("busy");
    loadSubtasks(id);
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    subList.classList.remove("busy");
    cb.checked = !cb.checked;
    toast(ex.message || "更新失败", "bad");
  });
});
subList.addEventListener("click", function(e){
  if(e.target.closest("[data-retry-subtasks]") && rt.editingId){ loadSubtasks(rt.editingId); return; }
  var del = e.target.closest("[data-sub-del]");
  if(!del || !rt.editingId) return;
  e.preventDefault();
  e.stopPropagation();
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var id = rt.editingId;
  API.del("/api/subtasks/" + del.dataset.subDel).then(function(){
    loadSubtasks(id);
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
});
iSubNew.addEventListener("keydown", function(e){
  if(e.key !== "Enter") return;
  if(e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var value = iSubNew.value.trim();
  if(!value || !rt.editingId) return;
  var id = rt.editingId;
  iSubNew.value = "";
  API.post("/api/tasks/" + encodeURIComponent(id) + "/subtasks", {title: value}).then(function(){
    loadSubtasks(id);
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    iSubNew.value = value;
    toast(ex.message || "添加失败", "bad");
  });
});
function csrfCookie(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function extOfName(filename){
  var idx = String(filename || "").lastIndexOf(".");
  return idx >= 0 ? String(filename).substring(idx + 1) : "";
}
function attUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function attThumbUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function loadAttachments(taskId){
  if(!fAttach) return;
  attachList.innerHTML = '<div class="attach-empty">加载中…</div>';
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/attachments").then(function(list){
    if(rt.editingId === taskId) renderAttachments(list);
  }).catch(function(){
    if(rt.editingId === taskId) attachList.innerHTML = '<div class="attach-empty">加载失败</div>';
  });
}
var lastAttList = [];
function renderAttachments(list){
  lastAttList = list || [];
  if(attachCount) attachCount.textContent = lastAttList.length ? lastAttList.length + " 个" : "";
  if(!lastAttList.length){
    attachList.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、Office、txt、md、zip，单个 ≤10MB）</div>';
    return;
  }
  attachList.innerHTML = lastAttList.map(function(a){
    var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
    var isSheet = /\.(xlsx|xls)$/i.test(a.filename || "");
    var canPrev = previewable(a.filename);
    /* 可预览的附件点缩略图/文件名直接开弹框，表格开 Univer，其余（zip、ppt）仍走新标签下载 */
    var openKey = canPrev ? ' data-att-prev="' + esc(a.id) + '"'
      : (isSheet ? ' data-att-sheet="' + esc(a.id) + '"' : "");
    var openTitle = canPrev ? "在线预览" : (isSheet ? "打开表格" : "预览 / 下载");
    var isOpen = canPrev || isSheet;
    var openCls = isOpen ? ' class="att-open"' : "";
    var url = attUrl(a.id);
    var head = isImg
      ? '<img class="att-thumb' + (isOpen ? " is-open" : "") + '" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy"' + openKey + ' />'
      : '<span class="att-icon' + (isOpen ? " is-open" : "") + '"' + openKey + '>' + esc(extOfName(a.filename).toUpperCase().slice(0,4) || "FILE") + '</span>';
    return '<div class="attach-item">' + head +
      '<span class="att-name"><a' + openCls + ' href="' + url + '" target="_blank" rel="noopener" title="' + openTitle + '"' + openKey + '>' + esc(a.filename) + '</a></span>' +
      '<span class="att-size">' + fmtSize(a.size) + '</span>' +
      '<span class="att-acts">' +
        (canPrev ? '<button class="icon-btn sm" type="button" data-att-prev="' + esc(a.id) + '" title="在线预览" aria-label="在线预览">' + icon("eye", 14) + '</button>' : '') +
        (isSheet ? '<button class="icon-btn sm" type="button" data-att-sheet="' + esc(a.id) + '" title="打开表格" aria-label="打开表格">' + icon("table", 14) + '</button>' : '') +
        '<a class="icon-btn sm" href="' + url + '" download title="下载" aria-label="下载附件">' + icon("download", 14) + '</a>' +
        (rt.drawerReadOnly ? '' :
          '<button class="icon-btn sm danger" type="button" data-att-del="' + esc(a.id) + '" title="删除附件" aria-label="删除附件">' + icon("trash", 14) + '</button>') +
      '</span>' +
    '</div>';
  }).join("");
}
$("btnAttach").addEventListener("click", function(){ iAttachFile.click(); });
iAttachFile.addEventListener("change", function(){
  var f = iAttachFile.files && iAttachFile.files[0];
  iAttachFile.value = "";
  if(!f || !rt.editingId) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，未上传", "warn"); return; }
  if(!/\.(jpe?g|png|gif|webp|pdf|txt|md|zip|docx?|xlsx?|pptx?)$/i.test(f.name)){
    toast("不支持的文件类型（jpg/png/gif/webp/pdf/txt/md/zip/doc/docx/xls/xlsx/ppt/pptx）", "warn");
    return;
  }
  var id = rt.editingId;
  var fd = new FormData();
  fd.append("file", f);
  attachList.classList.add("busy");
  var uploadUrl = API.url("/api/tasks/" + encodeURIComponent(id) + "/attachments" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  fetch(uploadUrl, {
    method:"POST",
    credentials:"same-origin",
    headers:{ "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    attachList.classList.remove("busy");
    if(json && json.code === 0){
      toast("附件已上传", "fs");
      loadAttachments(id);
      loadBoard({silent:true});
    }else{
      toast((json && json.message) || "上传失败", "bad");
    }
  }).catch(function(ex){
    attachList.classList.remove("busy");
    toast(ex && ex.message ? ex.message : "上传失败", "bad");
  });
});
attachList.addEventListener("click", function(e){
  var prevBtn = e.target.closest("[data-att-prev]");
  if(prevBtn){
    e.preventDefault();
    var att = lastAttList.find(function(a){ return a.id === prevBtn.dataset.attPrev; });
    if(!att){ toast("附件不存在或已删除", "warn"); loadAttachments(rt.editingId); return; }
    openAttPreview({ attachment: att });
    return;
  }
  var sheetBtn = e.target.closest("[data-att-sheet]");
  if(sheetBtn && rt.editingId){
    e.preventDefault();
    var attId = sheetBtn.dataset.attSheet;
    var att2 = lastAttList.find(function(a){ return a.id === attId; });
    if(!att2){ toast("附件不存在或已删除", "warn"); loadAttachments(rt.editingId); return; }
    /* xls 由 SheetJS 只读解析（保存回写只支持 xlsx） */
    import("./sheet-viewer.js").then(function(m){
      m.openSheet({
        attachment: att2,
        canEdit: !rt.drawerReadOnly && /\.xlsx$/i.test(att2.filename || ""),
        onSaved: function(){ loadAttachments(rt.editingId); loadBoard({silent:true}); }
      });
    }).catch(function(ex){ toast(ex && ex.message ? ex.message : "打开表格失败", "bad"); });
    return;
  }
  var del = e.target.closest("[data-att-del]");
  if(!del || !rt.editingId) return;
  e.preventDefault();
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var id = rt.editingId;
  UI.showConfirm({
    title: "删除附件",
    msg: "附件删除后不可恢复，确定删除？",
    okText: "删除"
  }).then(function(yes){
    if(!yes) return;
    API.del("/api/attachments/" + encodeURIComponent(del.dataset.attDel)).then(function(){
      toast("附件已删除", "fs");
      loadAttachments(id);
      loadBoard({silent:true});
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
});
var workTick = null, workSeq = 0, workBusy = false;
function clearWorkTick(){ if(workTick){ clearInterval(workTick); workTick = null; } }
function renderWork(d){
  if(!workVal || !btnTimer) return;
  var running = !!d.running;
  btnTimer.innerHTML = (running ? icon("pause", 14) + " 停止计时" : icon("play", 14) + " 开始计时");
  var mine = (d.myTotalMinutes && d.myTotalMinutes !== d.totalMinutes)
    ? ("（我 " + fmtMinutesShort(d.myTotalMinutes) + "）") : "";
  workVal.textContent = (running ? "计时中 · 已 " + d.elapsedMinutes + " 分钟；" : "") +
    "累计 " + fmtMinutes(d.totalMinutes) + mine;
  workVal.classList.toggle("running", running);
}
function fetchTimer(taskId, seq){
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/timer").then(function(d){
    if(seq !== workSeq || rt.editingId !== taskId) return;
    renderWork(d);
    if(btnTimer){
      var task = taskById(taskId);
      btnTimer.disabled = !d.running && !timerAllowed(task);
    }
  }).catch(function(){
    if(seq !== workSeq || rt.editingId !== taskId) return;
    if(workVal) workVal.textContent = "—";
    if(btnTimer) btnTimer.disabled = true;
  });
}
function loadWorkStatus(taskId){
  if(!fWork) return;
  workSeq++;
  recSeq++;
  workBusy = false;
  if(workVal){ workVal.textContent = "加载中…"; workVal.classList.remove("running"); }
  if(btnTimer){ btnTimer.textContent = "开始计时"; btnTimer.disabled = true; }
  fetchTimer(taskId, workSeq);
  loadWorkRecords(taskId, recSeq);
  clearWorkTick();
  workTick = setInterval(function(){
    if(!taskDrawer.classList.contains("on") || !rt.editingId){ clearWorkTick(); return; }
    if(workBusy) return;
    fetchTimer(rt.editingId, workSeq);
  }, 30000);
}
btnTimer.addEventListener("click", function(){
  if(!rt.editingId || btnTimer.disabled) return;
  var taskId = rt.editingId;
  var running = btnTimer.textContent.indexOf("停止") !== -1;
  if(!running && rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!running){
    var task = taskById(taskId);
    if(!timerAllowed(task)){
      toast("当前列不计时，请先移到处理规则为「正常计时」的列", "warn");
      return;
    }
  }
  workSeq++;
  workBusy = true;
  var opSeq = workSeq;
  btnTimer.disabled = true;
  var p = running
    ? API.post("/api/tasks/" + encodeURIComponent(taskId) + "/timer/stop", {})
    : API.post("/api/tasks/" + encodeURIComponent(taskId) + "/timer/start", {});
  p.then(function(d){
    if(opSeq !== workSeq || rt.editingId !== taskId) return;
    workBusy = false;
    btnTimer.disabled = false;
    renderWork(d);
    toast(running ? ("已停止计时，累计 " + fmtMinutes(d.totalMinutes)) : "开始计时", "fs");
    /* 同步顶部计时胶囊与「我的工作」行内状态（否则最长要等 60s 轮询） */
    loadRunningTimer();
    loadBoard({silent:true});
    /* 列表与甘特都有「工时」列，计时开始/停止要一起刷新 */
    refreshListIfOpen();
    refreshGanttIfOpen();
    recSeq++;
    loadWorkRecords(taskId, recSeq);
  }).catch(function(ex){
    if(opSeq !== workSeq || rt.editingId !== taskId) return;
    workBusy = false;
    btnTimer.disabled = false;
    toast(ex.message || "操作失败", "bad");
  });
});

/* ---- 手工补记实际工时（忘开表、加班等）；工时记录可作废后按天重补 ---- */
var recSeq = 0;
var workRecCache = {};
function loadWorkRecords(taskId, seq){
  if(!workLogList) return;
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/timer/records").then(function(list){
    if(seq !== recSeq || rt.editingId !== taskId) return;
    renderWorkRecords(list);
  }).catch(function(){
    if(seq !== recSeq || rt.editingId !== taskId) return;
    if(workLogList) workLogList.innerHTML = '<div class="wl-empty">工时记录加载失败</div>';
  });
}
function renderWorkRecords(list){
  if(!workLogList) return;
  list = list || [];
  workRecCache = {};
  if(!list.length){
    workLogList.innerHTML = '<div class="wl-empty">还没有工时记录：拖入进行中自动计时，或点右上「补记」手工添加</div>';
    return;
  }
  var html = "";
  list.forEach(function(r){
    var manual = r.origin === "manual";
    workRecCache[String(r.id)] = r;
    var del = !rt.drawerReadOnly
      ? '<button class="wl-del' + (manual ? "" : " hint") + '" type="button" data-wl-del="' + r.id
        + '" data-wl-kind="' + (manual ? "manual" : "timer") + '" title="'
        + (manual ? "删除这条补记" : "作废这条计时记录") + '">' + (manual ? "删除" : "作废") + '</button>' : "";
    var meta;
    if(manual || !r.startedAt){
      meta = esc(r.date || "") + (r.note ? ('<span class="wl-note"> · ' + esc(r.note) + '</span>') : "");
    } else {
      var cross = String(r.startedAt).slice(0, 10) !== String(r.endedAt || "").slice(0, 10);
      meta = esc(fmtTs(r.startedAt)) + ' → ' + esc(fmtTs(r.endedAt))
        + (cross ? '<span class="wl-note"> · 跨天，按每天上限计</span>' : "");
    }
    html += '<div class="wl-item' + (manual ? " manual" : "") + '">'
      + '<span class="wl-ic">' + icon(manual ? "edit" : "clock", 14) + '</span>'
      + '<div class="wl-main">'
      + '<div class="wl-line1"><span class="wl-name">' + esc(r.userName || r.userId || "成员") + '</span>'
      + '<span class="wl-mins">' + fmtMinutesShort(r.minutes) + '</span>'
      + (manual ? '<span class="wl-tag">补记</span>' : "")
      + '</div>'
      + '<div class="wl-meta">' + meta + '</div>'
      + '</div>'
      + del
      + '</div>';
  });
  workLogList.innerHTML = html;
}
function openTimeAddDialog(){
  if(!dlgTimeAdd) return;
  if(!rt.currentUser || !rt.currentUser.id){ toast("当前账号信息缺失，无法补记", "warn"); return; }
  var html = "";
  ownerOptions().forEach(function(o){
    html += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
  });
  if(iTimeUser) iTimeUser.innerHTML = html;
  if(iTimeDate && rt.TODAY) iTimeDate.value = rt.TODAY.getFullYear() + "-" + pad2(rt.TODAY.getMonth() + 1) + "-" + pad2(rt.TODAY.getDate());
  if(iTimeHours) iTimeHours.value = "";
  if(iTimeNote) iTimeNote.value = "";
  UI.openModal(dlgTimeAdd, "#iTimeHours");
}
if(btnTimerAdd){
  btnTimerAdd.addEventListener("click", function(){
    if(!rt.editingId) return;
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    openTimeAddDialog();
  });
}
if(dlgTimeAddCancel){
  dlgTimeAddCancel.addEventListener("click", function(){ UI.closeModal(dlgTimeAdd); });
}
if(dlgTimeAddOk){
  dlgTimeAddOk.addEventListener("click", function(){
    var taskId = rt.editingId;
    if(!taskId || dlgTimeAddOk.disabled) return;
    var date = (iTimeDate.value || "").trim();
    var hours = Number(iTimeHours.value);
    var note = (iTimeNote.value || "").trim();
    if(!date){ toast("请选择补记日期", "warn"); try { iTimeDate.focus(); } catch (e) { /* noop */ } return; }
    if(!hours || hours < 0.5 || hours > 24){ toast("时长需在 0.5 ~ 24 小时之间", "warn"); try { iTimeHours.focus(); } catch (e) { /* noop */ } return; }
    var minutes = Math.round(hours * 60);
    var url = "/api/tasks/" + encodeURIComponent(taskId) + "/timer/manual"
      + "?forUserId=" + encodeURIComponent(iTimeUser.value)
      + "&date=" + encodeURIComponent(date)
      + "&minutes=" + minutes
      + (note ? ("&note=" + encodeURIComponent(note)) : "");
    dlgTimeAddOk.disabled = true;
    API.post(url, {}).then(function(){
      toast("已补记 " + fmtMinutes(minutes), "fs");
      UI.closeModal(dlgTimeAdd);
      recSeq++;
      loadWorkRecords(taskId, recSeq);
      fetchTimer(taskId, workSeq);
      loadBoard({silent:true});
      refreshListIfOpen();
      refreshGanttIfOpen();
    }).catch(function(ex){
      toast(ex.message || "补记失败", "bad");
    }).then(function(){ dlgTimeAddOk.disabled = false; });
  });
}
if(workLogList){
  workLogList.addEventListener("click", function(e){
    var t = e.target;
    var btn = t && t.closest ? t.closest("[data-wl-del]") : null;
    if(!btn) return;
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    var taskId = rt.editingId;
    var logId = btn.getAttribute("data-wl-del");
    var manual = btn.getAttribute("data-wl-kind") === "manual";
    if(!taskId || !logId) return;
    var rec = workRecCache[String(logId)] || {};
    var title = manual ? "删除补记" : "作废这条工时记录？";
    var msg;
    if(manual){
      msg = "删除后这条实际工时将从工作项与报表中移除，确定？";
    } else {
      var when = rec.startedAt ? (fmtTs(rec.startedAt) + " → " + fmtTs(rec.endedAt)) : (rec.date || "");
      msg = esc(rec.userName || rec.userId || "成员") + " · <b>" + fmtMinutes(rec.minutes) + "</b><br>"
        + esc(when) + ' <span style="color:var(--text-3)">计时记录</span><br><br>'
        + "作废后这条记录不再计入工作项、报表与每人每天额度；操作会保留在工作项时间线。"
        + "请用「补记」按天重新录入实际工时。";
    }
    UI.showConfirm({ title:title, msg:msg, okText: manual ? "删除" : "作废并移除", danger:true }).then(function(ok){
      if(!ok) return;
      API.del("/api/tasks/" + encodeURIComponent(taskId) + "/timer/records/" + encodeURIComponent(logId)).then(function(){
        toast(manual ? "已删除" : "已作废", "fs");
        recSeq++;
        loadWorkRecords(taskId, recSeq);
        fetchTimer(taskId, workSeq);
        loadBoard({silent:true});
        refreshListIfOpen();
        refreshGanttIfOpen();
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  });
}

/* 里程碑只占一天：勾选后把另一端补齐；已勾选时改任一端，另一端跟随（抽屉预加载，不依赖甘特） */
if($("iMilestone")){
  $("iMilestone").addEventListener("change", function(){
    if(!this.checked) return;
    if(iStart.value) iDue.value = iStart.value;
    else if(iDue.value) iStart.value = iDue.value;
    syncDateBounds();
  });
  iStart.addEventListener("change", function(){
    if($("iMilestone").checked && iStart.value){ iDue.value = iStart.value; syncDateBounds(); }
  });
  iDue.addEventListener("change", function(){
    if($("iMilestone").checked && iDue.value){ iStart.value = iDue.value; syncDateBounds(); }
  });
}

/* 状态切换入口：底部状态键与首屏「状态」速览共用同一份列菜单 */
function openDrawerColMenu(anchor){
  if(!iCol || denyReadOnly()) return;
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = COLUMNS.map(function(c){
    var on = iCol.value === c.id;
    return '<button class="menu-item" type="button" data-drawer-col="' + esc(c.id) + '">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || "#98A2B3") + '"></span>' +
      esc(c.name) + (on ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-drawer-col]");
    if(!b) return;
    iCol.value = b.dataset.drawerCol;
    iCol.dispatchEvent(new Event("change", { bubbles: true }));
    UI.closeAllPops();
  });
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
var btnDrawerStatus = document.getElementById("btnDrawerStatus");
if(btnDrawerStatus) btnDrawerStatus.addEventListener("click", function(){ openDrawerColMenu(btnDrawerStatus); });
var factStatusBtn = $("factStatus");
if(factStatusBtn) factStatusBtn.addEventListener("click", function(){ openDrawerColMenu(factStatusBtn); });

export { buildFormControls, deleteTask, openTaskDrawer, ownerOptions, populateReqSelect, refreshOwnerSelect, renderTagChips, resetFormBaseline, showDrawerNotice, syncAssocViewBtns, syncCatSeg, syncDateBounds, syncFormSegs, syncProgVal, tryCloseTaskDrawer };
