/* core/task-drawer · 任务详情抽屉、评论、检查清单、附件、工时 */

import { API } from "./api.js";
import { openAttPreview, previewable } from "./att-preview.js";
import { $, attachCount, attachList, btnCommentSend, btnDeleteTask, btnTaskNew, btnSaveTask, btnSaveTaskContinue, btnTaskWatch, btnTimer, btnTimerAdd, commentCount, commentList, commentMention, dlgTimeAdd, dlgTimeAddCancel, dlgTimeAddOk, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTimeDate, iTimeHours, iTimeNote, iTimeUser, iTitle, progVal, segCat, segDue, segPri, segProg, segRecur, segStart, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, taskWatchLabel, timelineBox, workLogList, workVal } from "./dom.js";
import { icon } from "./icons.js";
import { canEditReq, canEditTask, rt, state, taskById, taskCacheExtra } from "./state.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "./ui.js";
import { COLUMNS, ITEM_TYPE_DESCS, PRIORITIES, avatarHTML, colMeta, dayDiff, duePresetDate, fmtMinutes, fmtMinutesShort, fmtSize, fmtTs, itemTypeInfoHTML, pad2, parseDate, priColor, priName, startPresetDate } from "../lib/format.js";
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
(function watchFormDirty(){
  var desc = Object.getOwnPropertyDescriptor(rt, "formDirty");
  if(desc && desc.set && desc.get) return; // 已被监听
  var val = rt.formDirty;
  Object.defineProperty(rt, "formDirty", {
    get: function(){ return val; },
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
    btnSaveTask.textContent = btnSaveTask.dataset.saveText || "保存任务";
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
function assocStillCurrent(seq, taskId, reqId){
  return seq === rt.taskFormSeq
    && (rt.editingId || null) === (taskId || null)
    && currentReqId() === (reqId || "");
}
function ensureReqDoc(v){
  var seq = rt.taskFormSeq, taskId = rt.editingId, reqId = currentReqId();
  loadView("requirements").then(function(m){
    if(assocStillCurrent(seq, taskId, reqId)) m.ensureReqDocOptions(v);
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
function syncDefectFields(){
  var isBug = !!(iItemType && iItemType.value === "bug");
  if(fDefect) fDefect.hidden = !isBug;
  var fs = $("fSeverity");
  if(fs && (!isBug || (iSeverity && iSeverity.value))) fs.classList.remove("invalid");
}
if(iSeverity) iSeverity.addEventListener("change", function(){
  var fs = $("fSeverity");
  if(fs && iSeverity.value) fs.classList.remove("invalid");
});
function clearDefectFields(){
  if(iSeverity) iSeverity.value = "";
  if(iEnvironment) iEnvironment.value = "";
  if(iReproSteps) iReproSteps.value = "";
  if(iRegression) iRegression.value = "";
}
function refreshAssociationViews(){
  var projects = viewModule("projects");
  if(projects) projects.refreshExpandedProjectTasks();
  var requirements = viewModule("requirements");
  if(requirements) requirements.refreshReqDocTasksIfOpen();
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
    if(f.id === "iProg"){ syncProgByCol(); continue; }
    if(f.id === "iBlockedReason"){ f.disabled = !(iBlocked && iBlocked.checked); continue; }
    f.disabled = false;
  }
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
}
/** 只读抽屉里仍在视图上的写控件（分段按钮、快捷日期等）：拦下并给出反馈 */
function denyReadOnly(){
  if(!rt.drawerReadOnly) return false;
  toast("你对该项目只有查看权限", "warn");
  return true;
}
function buildFormControls(){
  segPri.innerHTML = PRIORITIES.map(function(p){
    return '<button type="button" class="' + p.toLowerCase() + '" data-fpri="' + p + '" aria-pressed="false" style="--' +
      p.toLowerCase() + ':' + esc(priColor(p)) + '">' + esc(priName(p)) + '</button>';
  }).join("");
  segRecur.innerHTML = [{v:"", n:"无"},{v:"daily", n:"每天"},{v:"weekly", n:"每周"},{v:"monthly", n:"每月"}]
    .map(function(o){
      return '<button type="button" data-recur="' + o.v + '" aria-pressed="false">' + o.n + '</button>';
    }).join("");
  syncCatSeg();
  populateColSelect();
}
function syncCatSeg(){
  if(!segCat) return;
  segCat.innerHTML = rt.categoriesCache.map(function(c){
    return '<button type="button" data-fcat="' + esc(c.name) + '" aria-pressed="' + (c.name === rt.formCat) + '">' + esc(c.name) + '</button>';
  }).join("");
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
}
function ownerOptions(){
  var opts = [], seen = {};
  if(rt.currentUser){
    opts.push({id: rt.currentUser.id, name: rt.currentUser.displayName || rt.currentUser.username});
    seen[rt.currentUser.id] = 1;
  }
  if(rt.currentWs && rt.currentWs.type === "shared"){
    rt.wsMembersCache.forEach(function(m){
      if(!m.userId || seen[m.userId]) return;
      seen[m.userId] = 1;
      opts.push({id: m.userId, name: m.displayName || m.username});
    });
  }
  return opts;
}
function populateOwnerSelect(currentName, currentUserId){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var opts = ownerOptions();
  var curName = currentName == null ? "" : String(currentName);
  var curId = currentUserId == null ? "" : String(currentUserId);
  var html = "", matched = false;
  opts.forEach(function(o){
    var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
    if(on) matched = true;
    html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (on ? " selected" : "") + '>' +
      esc(o.name) + '</option>';
  });
  if(curName && !matched){
    html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
  }
  if(!opts.length && !curName){
    html += '<option value="__text__" data-name="' + esc(rt.OWNER_DEFAULT) + '">' + esc(rt.OWNER_DEFAULT) + '</option>';
  }
  iOwner.innerHTML = html;
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
function syncProgVal(){ progVal.textContent = (Number(iProg.value) || 0) + "%"; }
function renderTimeline(logs){
  if(!timelineBox) return;
  if(!logs || !logs.length){
    timelineBox.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
    return;
  }
  timelineBox.innerHTML = logs.map(function(l){
    var txt = l.detail || l.action || "";
    var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
    return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
      '<span class="tl-detail">' + actor + esc(txt) + '</span></div>';
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
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/logs").then(function(logs){
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
  iActual.className = "est-actual";
  if(!act && !est){
    iActual.textContent = "—";
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
    : "关注后，该任务的新评论、移入回收站或恢复会通知你";
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
  rt.drawerOpener = (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)
    ? document.activeElement : null;
  rt.taskFormSeq++;
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
    taskDrawerTitle.textContent = task.title || "任务详情";
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
    rt.formCat = task.category || (rt.categoriesCache.length ? rt.categoriesCache[0].name : "");
    populateColSelect();
    iCol.value = task.boardColumn || "backlog";
    populateReqSelect(task.reqId || "");
    iReq.value = task.reqId || "";
    if(iItemType) iItemType.value = task.itemType || "task";
    if(iSeverity) iSeverity.value = task.severity || "";
    if(iEnvironment) iEnvironment.value = task.environment || "";
    if(iReproSteps) iReproSteps.value = task.reproduceSteps || "";
    if(iRegression) iRegression.value = task.regressionStatus || "";
    /* versionId 只有深链取回的任务带；看板缓存里没有，交给 phase 模块查项目任务表回填 */
    ensureVersion(task.versionId, task.id);
    ensureFoundVersion(task.foundVersionId || "");
    ensureEpic(task.epicId, task.id);
    rt.formDemandId = task.demandId || null;
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
    /* 编辑已有任务时展开低频字段，避免已填的版本/文档/分支被折叠隐藏 */
    var drawerMore = $("drawerMore");
    if(drawerMore) drawerMore.open = true;
    loadWorkStatus(task.id);
    loadAttachments(task.id);
    loadSubtasks(task.id);
    loadComments(task.id);
    loadWatchStatus(task.id);
    loadTimeline(task.id);
  }else{
    taskDrawerTitle.textContent = "新建任务";
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
    rt.formCat = rt.categoriesCache.length ? rt.categoriesCache[0].name : "";
    populateColSelect();
    iCol.value = colId || "backlog";
    populateReqSelect(initialReqId);
    /* 基于需求池需求创建工作项（需求详情入口）：锁定需求所在项目；普通入口回落到默认项目 */
    iReq.value = initialReqId;
    if(defaults && defaults.demandId){
      taskDrawerTitle.textContent = "基于需求创建工作项";
      rt.formDemandId = defaults.demandId;
    }else{
      rt.formDemandId = null;
    }
    if(iItemType) iItemType.value = "task";
    clearDefectFields();
    ensureVersion((defaults && defaults.versionId) || "");
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
    var drawerMoreNew = $("drawerMore");
    if(drawerMoreNew) drawerMoreNew.open = false;
    commentsCache = [];
    loadWatchStatus(null);
    if(commentList) commentList.innerHTML = "";
    if(commentCount) commentCount.textContent = "";
    closeMention();
  }
  syncDefectFields();
  syncProgVal();
  syncProgByCol();
  fTitle.classList.remove("invalid");
  syncFormSegs();
  applyDrawerReadOnly(readOnly);
  /* 手机端新建走半屏抽屉，编辑走全屏；桌面端样式不区分 */
  taskForm.classList.toggle("is-create", !task);
  openDrawer();
  UI.wireTooltips(taskDrawer);
  setTimeout(function(){ try{ iTitle.focus(); iTitle.select(); }catch(e){ /* noop */ } }, 60);
}
function syncProgByCol(){
  var done = iCol && iCol.value === "done";
  var wrap = $("progWrap");
  if(done){
    iProg.value = 100;
    iProg.disabled = true;
    if(segProg) segProg.classList.add("disabled");
    if(progVal) progVal.textContent = "100%";
    if(wrap) wrap.title = "已完成任务的进度按 100% 计";
    if(hintEl()) hintEl().textContent = "已完成任务的进度按 100% 计" +
      (origProgress && origProgress !== 100 ? "（原记录 " + origProgress + "%）" : "");
  }else{
    iProg.disabled = false;
    iProg.value = origProgress;
    if(segProg) segProg.classList.remove("disabled");
    if(progVal) progVal.textContent = (Number(origProgress) || 0) + "%";
    if(wrap) wrap.title = "";
    if(hintEl()) hintEl().textContent = "0–100，拖到 100% 不会自动标记完成（完成以「移入已完成列」为准）";
  }
}
function hintEl(){ return $("progHint"); }
/* 路由切换前收口抽屉：干净则直接关，有改动先确认，确认后再放行路由 */
window.addEventListener("ds:before-route", function(e){
  if(!taskDrawer.classList.contains("on")) return;
  if(!rt.formDirty){ forceCloseTaskDrawer(); return; }
  e.preventDefault();
  var to = e.detail && e.detail.to;
  UI.showConfirm({
    title:"离开当前任务？",
    msg:"表单有未保存的修改，切换页面后会丢失。",
    okText:"放弃并离开",
    cancelText:"继续编辑"
  }).then(function(ok){
    if(!ok) return;
    forceCloseTaskDrawer();
    window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:to } }));
  });
});
function tryCloseTaskDrawer(){
  if(!taskDrawer.classList.contains("on")) return;
  if(rt.formDirty){
    UI.showConfirm({
      title:"放弃未保存的改动？",
      msg:"当前表单有未保存的修改，关闭后将会丢失。",
      okText:"放弃改动",
      cancelText:"继续编辑"
    }).then(function(ok){ if(ok) forceCloseTaskDrawer(); });
    return;
  }
  forceCloseTaskDrawer();
}
function forceCloseTaskDrawer(){
  rt.taskFormSeq++;
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
    var segEl = b.closest(".seg");
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
  rt.formCat = b.dataset.fcat; syncFormSegs(); rt.formDirty = true;
});
segRecur.addEventListener("click", function(e){
  var b = e.target.closest("[data-recur]"); if(!b) return;
  if(denyReadOnly()) return;
  rt.formRecur = b.dataset.recur; syncFormSegs(); rt.formDirty = true;
});
segDue.addEventListener("click", function(e){
  var b = e.target.closest("[data-due]"); if(!b) return;
  if(denyReadOnly()) return;
  iDue.value = duePresetDate(b.dataset.due) || "";
  syncDateBounds();
  rt.formDirty = true;
});
function syncDateBounds(){
  if(!iStart || !iDue) return;
  iStart.max = iDue.value || "";
  iDue.min = iStart.value || "";
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
  return !!(target && target.closest && target.closest("#fComments, #fSubtasks, #fAttach"));
}
taskForm.addEventListener("input", function(e){
  if(e.target === iProg) return;
  if(!inTaskAuxSection(e.target)) rt.formDirty = true;
  if(e.target === iTitle) fTitle.classList.remove("invalid");
});
taskForm.addEventListener("change", function(e){
  if(!inTaskAuxSection(e.target)) rt.formDirty = true;
});
iCol.addEventListener("change", function(){ syncProgByCol(); rt.formDirty = true; });
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
/* 换项目时影响版本的可选项要跟着换；关联需求的刷新在 requirements 模块里各自监听 */
if(iReq) iReq.addEventListener("change", function(){
  ensureVersion(""); ensureFoundVersion(""); ensureEpic("");
  ensureBranch(($("iBranch") || {}).value, iReq.value);
  rt.formDemandId = null;
});
if(iItemType) iItemType.addEventListener("change", function(){
  syncDefectFields();
  if(iItemType.value === "bug" && iSeverity && !iSeverity.value){
    try{ iSeverity.focus(); }catch(e){ /* noop */ }
  }
  rt.formDirty = true;
});
if(iBlocked){
  iBlocked.addEventListener("change", function(){
    if(iBlockedReason){
      iBlockedReason.disabled = !iBlocked.checked;
      if(iBlocked.checked){ try{ iBlockedReason.focus(); }catch(e){ /* noop */ } }
      else iBlockedReason.value = "";
    }
    rt.formDirty = true;
  });
}
function loadComments(taskId){
  if(!fComments || !commentList) return;
  commentList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/comments").then(function(list){
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
    return '<div class="comment-item' + (mine ? " mine" : "") + '" data-cid="' + esc(c.id) + '">' +
      avatarHTML(c.authorName || "?", "sm") +
      '<span class="ci-main">' +
        '<span class="ci-head"><span class="ci-who">' + esc(c.authorName || "未知") + '</span>' +
          '<span class="ci-time">' + esc(fmtTs(c.createdAt)) + '</span>' +
          (mine && !rt.drawerReadOnly ? '<button class="ci-del" type="button" data-comment-del="' + esc(c.id) + '">删除</button>' : '') +
        '</span>' +
        '<span class="ci-body">' + esc(c.content) + '</span>' +
      '</span>' +
    '</div>';
  }).join("");
}
function sendComment(){
  if(!rt.editingId || !iComment || rt.commentSending) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var text = iComment.value.trim();
  if(!text) return;
  if(text.length > 500){ toast("评论最多 500 字", "warn"); return; }
  var id = rt.editingId;
  rt.commentSending = true;
  btnCommentSend.disabled = true;
  API.post("/api/tasks/" + encodeURIComponent(id) + "/comments", {
    content: text,
    /* 从候选里点选过的成员精确带上 ID：正文重名时也能通知到被选中的那位 */
    mentionUserIds: pickedMentionIds(text)
  }).then(function(){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    /* 发送期间切到了别的任务：不要把新任务抽屉里的草稿清掉 */
    if(rt.editingId !== id) return;
    iComment.value = "";
    closeMention();
    mentionPicked = [];
    loadComments(id);
  }).catch(function(ex){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    toast(ex.message || "发送失败", "bad");
  });
}
if(btnCommentSend) btnCommentSend.addEventListener("click", sendComment);

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
  drawerNoticeReload.addEventListener("click", function(){
    if(!rt.editingId) return;
    var id = rt.editingId;
    drawerNotice.hidden = true;
    API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
      if(!t){ toast("任务不存在或你没有访问权限", "warn"); return; }
      taskCacheExtra[t.id] = t;
      openTaskDrawer(null, t);
    }).catch(function(){ toast("刷新失败，请稍后重试", "bad"); });
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
    toast(watching ? "已取消关注" : "已关注：该任务的评论与回收站操作会通知你");
  }, function(e){
    btnTaskWatch.disabled = false;
    if(!e || !e.silent) toast((e && e.message) || "操作失败", "bad");
  });
});
/* 任务详情内新建任务：沿用当前任务的项目/版本/史诗，抽屉切换为新建模式 */
if(btnTaskNew) btnTaskNew.addEventListener("click", function(){
  if(!rt.editingId) return;
  if(rt.formDirty){ toast("当前任务有未保存的改动，请先保存再新建", "warn"); return; }
  var t = taskCacheExtra[rt.editingId] || {};
  var vSel = $("iVersion"), eSel = $("iEpic");
  openTaskDrawer(t.boardColumn || "backlog", null, {
    reqId: currentReqId() || t.reqId || "",
    versionId: (vSel && vSel.value) || "",
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
    copyToClipboard(window.location.origin + window.location.pathname + "#/board?task=" + encodeURIComponent(t.id), "任务链接已复制到剪贴板");
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
    focusField(iSeverity);
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
    category: rt.formCat || null,
    owner: owner.name,
    ownerUserId: owner.userId,
    boardColumn: iCol.value || "backlog",
    startDate: iStart.value || null,
    dueDate: iDue.value || null,
    isMilestone: !!(($("iMilestone") || {}).checked),
    reqId: iReq.value || null,
    /* 下拉还没加载完就保存（如 Ctrl+Enter）：保留任务原有关系，不要写成 null */
    reqDocId: (docSel && docSel.options.length > 1) ? (docSel.value || null) : (current ? (current.reqDocId || null) : null),
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
    /* 版本下拉 data-ready 由 phase 模块置位：没就绪说明选项还没回来，保留原绑定（null=不改）；
       就绪后空值是明确的「待规划」（空串=解绑），与后端口径一一对应 */
    versionId: (function(){
      var vs = $("iVersion");
      if(vs && vs.getAttribute("data-ready")) return vs.value || "";
      return current ? (current.versionId || null) : null;
    })(),
    epicId: (function(){
      var es = $("iEpic");
      if(es && es.getAttribute("data-ready")) return es.value || "";
      return current ? (current.epicId || null) : null;
    })(),
    /* 关联需求池需求：由需求拆分时携带；编辑未变更时与后端「null=保持原值」口径一致 */
    demandId: rt.formDemandId || null,
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
  setSaveLoading(true);
  var req = wasEdit
    ? API.put("/api/tasks/" + encodeURIComponent(editId), payload)
    : API.post("/api/tasks", payload);
  req.then(function(nt){
    setSaveLoading(false);
    if(seq !== rt.taskFormSeq) return;   // 抽屉已切换：界面由新的打开流程管理
    rememberReqId(nt && nt.reqId);
    if(saveAndContinue && wasEdit && rt.editingId === editId){
      /* 连续编辑：留在抽屉里；同步缓存与标题，后续保存不会带着旧值 */
      var changedDuringSave = formRev !== revAtSubmit;
      if(nt && taskCacheExtra[editId]) taskCacheExtra[editId] = Object.assign({}, taskCacheExtra[editId], nt);
      if(nt && nt.title && !changedDuringSave) taskDrawerTitle.textContent = nt.title;
      if(!changedDuringSave) rt.formDirty = false;
      var stayHint = $("taskFormHint");
      if(stayHint && !rt.drawerReadOnly && !changedDuringSave) stayHint.textContent = "已保存 · 可继续编辑";
      if(changedDuringSave) toast("已保存提交时的内容 · 保存期间的新改动还未保存", "warn");
      else toast("已保存「" + title + "」");
    }else{
      forceCloseTaskDrawer();
      if(wasEdit){
        toast("已更新「" + title + "」", "fs");
      }else{
        var tip = "已创建任务「" + nt.title + "」";
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
    loadBoard({animate:true});
    loadReqs();
    refreshCalendarIfOpen();
    refreshListIfOpen();
    refreshGanttIfOpen();
    refreshAssociationViews();
  }).catch(function(ex){
    setSaveLoading(false);
    if(seq !== rt.taskFormSeq) return;
    toast(ex.message || "保存失败", "bad");
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
      if(rt.editingId === id) forceCloseTaskDrawer();
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
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/subtasks").then(function(list){
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
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/attachments").then(function(list){
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
    var url = attUrl(a.id);
    var head = isImg
      ? '<img class="att-thumb" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" />'
      : '<span class="att-icon">' + esc(extOfName(a.filename).toUpperCase().slice(0,4) || "FILE") + '</span>';
    return '<div class="attach-item">' + head +
      '<span class="att-name"><a href="' + url + '" target="_blank" rel="noopener" title="预览 / 下载">' + esc(a.filename) + '</a></span>' +
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
    if(btnTimer) btnTimer.disabled = false;
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
    loadBoard({silent:true});
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
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/timer/records").then(function(list){
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
      msg = "删除后这条实际工时将从任务与报表中移除，确定？";
    } else {
      var when = rec.startedAt ? (fmtTs(rec.startedAt) + " → " + fmtTs(rec.endedAt)) : (rec.date || "");
      msg = esc(rec.userName || rec.userId || "成员") + " · <b>" + fmtMinutes(rec.minutes) + "</b><br>"
        + esc(when) + ' <span style="color:var(--text-3)">计时记录</span><br><br>'
        + "作废后这条记录不再计入任务、报表与每人每天额度；操作会保留在任务时间线。"
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

/* 手机端操作条左侧状态入口：自建列菜单，避免依赖移动端不响应脚本 click 的原生 select */
var btnDrawerStatus = document.getElementById("btnDrawerStatus");
if(btnDrawerStatus){
  btnDrawerStatus.addEventListener("click", function(){
    if(!iCol) return;
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
    UI.openPop(el, btnDrawerStatus, { align: "left", onClose: function(){ el.remove(); } });
  });
}

/* 低频字段归入「更多字段」：只移动 DOM，id 与事件监听保持不变 */
(function initDrawerMoreFields(){
  var host = $("drawerMoreBody");
  if(!host) return;
  ["iItemType", "iTags", "iReqDoc", "iVersion", "iEpic", "iBranch"].forEach(function(id){
    var el = $(id);
    var field = el && el.closest(".field");
    if(field) host.appendChild(field);
  });
  var remindGrid = iRemind && iRemind.closest(".form-grid");
  if(remindGrid) host.appendChild(remindGrid);
  /* 字段搬走后清掉空栅格，避免留下空白间距 */
  document.querySelectorAll(".task-detail-main .form-grid").forEach(function(grid){
    if(!grid.querySelector(".field")) grid.remove();
  });
})();

export { buildFormControls, deleteTask, openTaskDrawer, ownerOptions, populateReqSelect, refreshOwnerSelect, renderTagChips, showDrawerNotice, syncCatSeg, syncDateBounds, syncFormSegs, syncProgVal, tryCloseTaskDrawer };
