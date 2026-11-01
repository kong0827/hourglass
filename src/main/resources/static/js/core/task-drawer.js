/* core/task-drawer · 任务详情抽屉、评论、检查清单、附件、工时 */

import { API } from "./api.js";
import { $, attachCount, attachList, btnCommentSend, btnDeleteTask, btnSaveTask, btnTimer, commentCount, commentList, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTitle, progVal, segCat, segDue, segPri, segProg, segRecur, segStart, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, timelineBox, workVal } from "./dom.js";
import { icon } from "./icons.js";
import { rt, taskById, taskCacheExtra } from "./state.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "./ui.js";
import { COLUMNS, PRIORITIES, avatarHTML, colMeta, dayDiff, duePresetDate, fmtMinutes, fmtMinutesShort, fmtSize, fmtTs, parseDate, startPresetDate } from "../lib/format.js";
import { loadBoard, loadReqs } from "../views/board.js";
import { loadView } from "./view-loader.js";
import { refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { refreshListIfOpen } from "../views/list.js";


function ensureReqDoc(v){ loadView("requirements").then(function(m){ m.ensureReqDocOptions(v); }); }
function ensureBranch(v){ loadView("branches").then(function(m){ m.ensureBranchOptions(v); }); }
function openDrawer(){ taskDrawer.classList.add("on"); }
function closeDrawer(){ taskDrawer.classList.remove("on"); rt.formDirty = false; }
function buildFormControls(){
  segPri.innerHTML = PRIORITIES.map(function(p){
    return '<button type="button" class="' + p.toLowerCase() + '" data-fpri="' + p + '" aria-pressed="false">' + p + '</button>';
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
function populateReqSelect(){
  if(!iReq) return;
  var cur = iReq.value;
  var html = '<option value="">（无项目）</option>';
  rt.reqList.forEach(function(r){ html += '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; });
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
function openTaskDrawer(colId, task, defaults){  rt.taskFormSeq++;
  rt.editingId = task ? task.id : null;
  rt.formDirty = false;
  if(task) taskCacheExtra[task.id] = task;
  if(drawerNotice) drawerNotice.hidden = true;
  /* 分支 / 需求下拉改为按需加载：首次打开抽屉时才拉取对应视图模块，不拖首屏。
     ensureXxxOptions 会保留当前选中值，不会冲掉刚回填的关联。 */

  if(task){
    var isDone = task.boardColumn === "done";
    startedDone = isDone;
    taskDrawerTitle.textContent = task.title || "任务详情";
    btnDeleteTask.hidden = false;
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
    populateReqSelect();
    iReq.value = task.reqId || "";
    ensureReqDoc(task.reqDocId || "");
    ensureBranch(task.branchId || "");
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
    loadWorkStatus(task.id);
    loadAttachments(task.id);
    loadSubtasks(task.id);
    loadComments(task.id);
    timelineBox.innerHTML = '<div class="tl-empty">加载中…</div>';
    API.get("/api/tasks/" + encodeURIComponent(task.id) + "/logs").then(function(logs){
      if(rt.editingId === task.id) renderTimeline(logs);
    }).catch(function(){ if(rt.editingId === task.id) renderTimeline([]); });
  }else{
    taskDrawerTitle.textContent = "新建任务";
    btnDeleteTask.hidden = true;
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
    populateReqSelect();
    iReq.value = "";
    ensureReqDoc("");
    ensureBranch("");
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
    commentsCache = [];
    if(commentList) commentList.innerHTML = "";
    if(commentCount) commentCount.textContent = "";
  }
  syncProgVal();
  syncProgByCol();
  fTitle.classList.remove("invalid");
  syncFormSegs();
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
  closeDrawer();
  clearWorkTick();
  rt.editingId = null;
}
segPri.addEventListener("click", function(e){
  var b = e.target.closest("[data-fpri]"); if(!b) return;
  rt.formPri = b.dataset.fpri; syncFormSegs(); rt.formDirty = true;
});
segCat.addEventListener("click", function(e){
  var b = e.target.closest("[data-fcat]"); if(!b) return;
  rt.formCat = b.dataset.fcat; syncFormSegs(); rt.formDirty = true;
});
segRecur.addEventListener("click", function(e){
  var b = e.target.closest("[data-recur]"); if(!b) return;
  rt.formRecur = b.dataset.recur; syncFormSegs(); rt.formDirty = true;
});
segDue.addEventListener("click", function(e){
  var b = e.target.closest("[data-due]"); if(!b) return;
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
  iProg.value = b.dataset.prog; syncProgVal(); rt.formDirty = true;
});
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
  }).catch(function(){
    if(rt.editingId === taskId) renderComments([]);
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
          (mine ? '<button class="ci-del" type="button" data-comment-del="' + esc(c.id) + '">删除</button>' : '') +
        '</span>' +
        '<span class="ci-body">' + esc(c.content) + '</span>' +
      '</span>' +
    '</div>';
  }).join("");
}
function sendComment(){
  if(!rt.editingId || !iComment || rt.commentSending) return;
  var text = iComment.value.trim();
  if(!text) return;
  if(text.length > 500){ toast("评论最多 500 字", "warn"); return; }
  var id = rt.editingId;
  rt.commentSending = true;
  btnCommentSend.disabled = true;
  API.post("/api/tasks/" + encodeURIComponent(id) + "/comments", {content: text}).then(function(){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    /* 发送期间切到了别的任务：不要把新任务抽屉里的草稿清掉 */
    if(rt.editingId !== id) return;
    iComment.value = "";
    loadComments(id);
  }).catch(function(ex){
    rt.commentSending = false;
    btnCommentSend.disabled = false;
    toast(ex.message || "发送失败", "bad");
  });
}
if(btnCommentSend) btnCommentSend.addEventListener("click", sendComment);
if(iComment){
  iComment.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
      e.preventDefault();
      /* 阻止冒泡：否则文档级 Ctrl+Enter 会把评论当成“保存任务”，跟着提交并关闭抽屉 */
      e.stopPropagation();
      sendComment();
    }
  });
}
if(commentList){
  commentList.addEventListener("click", function(e){
    var del = e.target.closest("[data-comment-del]");
    if(!del || !rt.editingId) return;
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
$("taskMoreMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-task-more]");
  if(!b) return;
  var kind = b.dataset.taskMore;
  UI.closeAllPops();
  var t = rt.editingId ? taskById(rt.editingId) : null;
  if(kind === "copy-link"){
    copyToClipboard(window.location.origin + "/#/board", "任务链接已复制到剪贴板");
    return;
  }
  if(kind === "copy-title"){
    if(!t) return;
    copyToClipboard(t.title, "标题已复制到剪贴板");
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
  var title = iTitle.value.trim();
  if(!title){
    fTitle.classList.add("invalid");
    try{ iTitle.focus(); }catch(err){ /* noop */ }
    return;
  }
  var pendingTag = iTags.value.trim().replace(/[,，]/g, "");
  if(pendingTag && rt.tagsCache.indexOf(pendingTag) === -1 && rt.tagsCache.length < 8) rt.tagsCache.push(pendingTag.slice(0, 16));
  /* 开始日期 ≤ 截止日期（服务端也有同样校验，这里先拦一道省一次往返） */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    toast("开始日期不能晚于截止日期", "bad");
    try{ iStart.focus(); }catch(err){ /* noop */ }
    return;
  }
  var owner = ownerPick();
  var stillDone = (iCol.value || "backlog") === "done";
  var payload = {
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
    reqDocId: (($("iReqDoc") || {}).value) || null,
    branchId: (($("iBranch") || {}).value) || null,
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
  btnSaveTask.disabled = true;
  btnSaveTask.classList.add("loading");
  var req = wasEdit
    ? API.put("/api/tasks/" + encodeURIComponent(editId), payload)
    : API.post("/api/tasks", payload);
  req.then(function(nt){
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
    if(seq !== rt.taskFormSeq) return;   // 抽屉已切换：界面由新的打开流程管理
    rt.formDirty = false;
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
    loadBoard({animate:true});
    loadReqs();
    refreshCalendarIfOpen();
    refreshListIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
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
  UI.showConfirm({
    title:"移到回收站",
    msg:"「" + esc(t.title) + "」将移入回收站（30 天内可恢复）。确定删除？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/tasks/" + encodeURIComponent(id)).then(function(){
      if(rt.editingId === id) forceCloseTaskDrawer();
      loadBoard({animate:false});
      loadReqs();
      refreshCalendarIfOpen();
      refreshListIfOpen();
      refreshGanttIfOpen();
      toastAction("已移入回收站「" + t.title + "」", "撤销", function(){
        API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).then(function(){
          toast("已恢复「" + t.title + "」", "fs");
          loadBoard({animate:true, movedId:id});
          loadReqs();
          refreshCalendarIfOpen();
          refreshListIfOpen();
          refreshGanttIfOpen();
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
        ' aria-label="' + esc(s.title) + '" />' +
      '<span class="sub-txt">' + esc(s.title) + '</span>' +
      '<button type="button" class="sub-del" data-sub-del="' + s.id + '" title="删除检查项" aria-label="删除检查项">' +
        icon("close", 12) + '</button>' +
    '</div>';
  }).join("");
}
function loadSubtasks(taskId){
  if(!fSubtasks) return;
  subList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/subtasks").then(function(list){
    if(rt.editingId === taskId) renderSubtasks(list);
  }).catch(function(){
    if(rt.editingId === taskId) renderSubtasks([]);
  });
}
subList.addEventListener("change", function(e){
  var cb = e.target.closest("[data-sub-toggle]");
  if(!cb || !rt.editingId) return;
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
  var del = e.target.closest("[data-sub-del]");
  if(!del || !rt.editingId) return;
  e.preventDefault();
  e.stopPropagation();
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
  return "/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
}
function attThumbUrl(id){
  return "/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
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
function renderAttachments(list){
  if(attachCount) attachCount.textContent = (list && list.length) ? list.length + " 个" : "";
  if(!list || !list.length){
    attachList.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、txt、md、zip，单个 ≤10MB）</div>';
    return;
  }
  attachList.innerHTML = list.map(function(a){
    var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
    var url = attUrl(a.id);
    var head = isImg
      ? '<img class="att-thumb" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" />'
      : '<span class="att-icon">' + esc(extOfName(a.filename).toUpperCase().slice(0,4) || "FILE") + '</span>';
    return '<div class="attach-item">' + head +
      '<span class="att-name"><a href="' + url + '" target="_blank" rel="noopener" title="预览 / 下载">' + esc(a.filename) + '</a></span>' +
      '<span class="att-size">' + fmtSize(a.size) + '</span>' +
      '<span class="att-acts">' +
        '<a class="icon-btn sm" href="' + url + '" download title="下载" aria-label="下载附件">' + icon("download", 14) + '</a>' +
        '<button class="icon-btn sm danger" type="button" data-att-del="' + esc(a.id) + '" title="删除附件" aria-label="删除附件">' + icon("trash", 14) + '</button>' +
      '</span>' +
    '</div>';
  }).join("");
}
$("btnAttach").addEventListener("click", function(){ iAttachFile.click(); });
iAttachFile.addEventListener("change", function(){
  var f = iAttachFile.files && iAttachFile.files[0];
  iAttachFile.value = "";
  if(!f || !rt.editingId) return;
  if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，未上传", "warn"); return; }
  if(!/\.(jpe?g|png|gif|webp|pdf|txt|md|zip)$/i.test(f.name)){
    toast("不支持的文件类型（jpg/png/gif/webp/pdf/txt/md/zip）", "warn");
    return;
  }
  var id = rt.editingId;
  var fd = new FormData();
  fd.append("file", f);
  attachList.classList.add("busy");
  var uploadUrl = "/api/tasks/" + encodeURIComponent(id) + "/attachments" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
  fetch(uploadUrl, {
    method:"POST",
    credentials:"same-origin",
    headers:{ "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = "/login.html"; throw new Error("未登录"); }
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
  var del = e.target.closest("[data-att-del]");
  if(!del || !rt.editingId) return;
  e.preventDefault();
  var id = rt.editingId;
  API.del("/api/attachments/" + encodeURIComponent(del.dataset.attDel)).then(function(){
    toast("附件已删除", "fs");
    loadAttachments(id);
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
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
  workBusy = false;
  if(workVal){ workVal.textContent = "加载中…"; workVal.classList.remove("running"); }
  if(btnTimer){ btnTimer.textContent = "开始计时"; btnTimer.disabled = true; }
  fetchTimer(taskId, workSeq);
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
  }).catch(function(ex){
    if(opSeq !== workSeq || rt.editingId !== taskId) return;
    workBusy = false;
    btnTimer.disabled = false;
    toast(ex.message || "操作失败", "bad");
  });
});

export { buildFormControls, deleteTask, openTaskDrawer, ownerOptions, populateReqSelect, refreshOwnerSelect, renderTagChips, showDrawerNotice, syncCatSeg, syncDateBounds, syncFormSegs, syncProgVal, tryCloseTaskDrawer };
