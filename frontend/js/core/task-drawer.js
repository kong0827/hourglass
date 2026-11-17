/* core/task-drawer · 任务详情抽屉、评论、检查清单、附件、工时 */

import { API, csrfCookie } from "./api.js";
import { openAttPreview, previewable } from "./att-preview.js";
import { bindFileDrop, validateFiles, reportRejected, uploadAttachment } from "./attach-kit.js";
import { attachCombo } from "./combo.js";
import { attachEnvDict, recordEnv } from "./env-dict.js";
import { companyChipHTML, companyNameOf, companyColor } from "../lib/company.js";
import { loadProjectMembers, peekProjectMembers, memberRoleTitles, effectiveMemberRole, taskMemberLabel } from "../lib/member-labels.js";
import { openPeoplePicker, optionSubText } from "../lib/people-picker.js";
import { $, attachCount, attachList, btnActualAdd, btnCommentAttach, btnCommentSend, btnDeleteTask, btnTaskNew, btnSaveTask, btnSaveTaskContinue, btnTaskWatch, btnTimer, btnTimerAdd, rfHoursAdd, commentAttachChips, commentAttachTip, commentCount, commentList, dlgTimeAdd, dlgTimeAddCancel, dlgTimeAddOk, drawerNotice, drawerNoticeReload, drawerNoticeText, fAttach, fComments, fSubtasks, fTimeline, fTitle, fWork, iActual, iAttachFile, iBlocked, iBlockedReason, iCol, iComment, iCommentFiles, iDesc, iDue, iEstimate, iNote, iOwner, iProg, iRemind, iRemindTarget, iReq, iStart, iSubNew, iTags, iTimeDate, iTimeHours, iTimeNote, iTimeProject, iTimeUser, iTitle, progVal, segCat, segDue, segPri, segProg, segRecur, segStart, subCount, subList, tagWrap, taskDrawer, taskDrawerTitle, taskForm, taskWatchLabel, timelineBox, workLogList, workVal } from "./dom.js";
import { icon } from "./icons.js";
import { createMentionPicker } from "./mention-picker.js";
import { canEditReq, canEditTask, canManageProject, catNameById, colRuleOf, projectOptionsHTML, reqNameById, roleReadOnly, rt, state, taskById, taskCacheExtra, timerAllowed } from "./state.js";
import { loadRunningTimer } from "./task-actions.js";
import { guard, serverDecision } from "./transitions.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "./ui.js";
import { isHtml, normalizedIds, taskVersionIds, taskVersionsText, taskVersionLinksHTML, assocLinkHTML, sameIds, selectedVersionIds, taskPublicationHTML, releaseSnapshotHTML, fmtReleaseTime, itemNoText, COLUMNS, CAT_DEFAULT_COLOR, ITEM_TYPE_DESCS, PRIORITIES, avatarHTML, colMeta, dayDiff, docTypeName, duePresetDate, elapsedText, spanText, fmtMinutes, fmtMinutesShort, fmtSize, fmtShortMD, fmtTs, itemTypeInfoHTML, pad2, parseDate, priColor, priName, startPresetDate, versionPhaseInfoHTML, weekdayCN } from "../lib/format.js";
import { GS } from "../lib/gantt-shared.js";
import { loadBoard, loadReqs } from "../views/board.js";
import { loadView, viewModule } from "./view-loader.js";
/* 树形视图懒加载：已加载才刷新，避免为一次刷新拉取整个模块 */
function refreshTreeIfOpen(){
  var m = viewModule("tree");
  if(m && m.refreshTreeIfOpen) m.refreshTreeIfOpen();
}
/* 影响链视图懒加载：同上 */
function refreshChainIfOpen(){
  var m = viewModule("chain");
  if(m && m.refreshChainIfOpen) m.refreshChainIfOpen();
}
import { refreshCalendarIfOpen, refreshGanttIfOpen } from "../views/calendar.js";
import { refreshListIfOpen } from "../views/list.js";
import { initCaliberHelp, registerHelp } from "../lib/caliber-help.js";

registerHelp({
  "drawer.actual": {
    title:"实际工时 / 实际投入",
    rows:[
      ["包含什么", "这张工作项所有已结束的计时 + 手工补记；正在进行的计时不计，作废的记录不计。", "ok"],
      ["自动计时的裁剪", "按个人工作时段（默认 09:00–18:00）、跳过周末、每人每天 8 小时额度计算。", "info"],
      ["补记不算裁剪", "手工补记填多少算多少，但仍占用当天后续自动计时的额度。", "mute"],
      ["与驾驶舱的关系", "项目驾驶舱的「实际投入」由各工作项合计后再按测试窗口拆成窗口内 / 窗口外，这里只显示单项合计。", "mute"]
    ]
  }
});
initCaliberHelp();

/* 抽屉未保存改动的视觉同步：.drawer 加 .dirty，页脚 hint 变警示文案 */
function syncDrawerDirty(){
  var dirty = !!rt.formDirty;
  var drawerEl = taskDrawer.querySelector(".drawer");
  if(drawerEl) drawerEl.classList.toggle("dirty", dirty);
  if(taskFormHint){
    taskFormHint.classList.toggle("dirty", dirty);
    taskFormHint.textContent = dirty ? "有未保存的改动"
      : (rt.drawerReadOnly ? "你对该项目只有查看权限，可查看但不能修改"
        : (drawerMode === "read" ? "点标题、描述或概览事实即可改，失焦自动保存；完整字段用「编辑」" : "保存后可拖动卡片调整状态与顺序"));
  }
}

/* ==================== 详情子页：读态 / 四页签 ====================
   既有区块整体搬入「执行 / 关联 / 动态」，保留原 id 与事件绑定：
   计时开始/停止、补记工时、检查项、附件、依赖、评论都不重写。 */
var drawerMode = "edit", drawerTab = "overview", timelineCache = [];
/* 从抽屉里的关联跳到另一个工作项（如所属史诗）时压下的层级，供头部「返回」逐层退回 */
var drawerBackStack = [];
var drawerTabsEl = $("drawerTabs"), drawerBodyEl = $("drawerBody"),
    drawerStatusPill = $("drawerStatusPill"), btnDrawerEdit = $("btnDrawerEdit"),
    btnFootStatus = $("btnFootStatus"), btnFootWatch = $("btnFootWatch");
function drawerColMeta(id){
  var m = colMeta(id);
  if(m) return m;
  var list = rt.colDefsCache || [];
  for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
  return { id: id, name: id || "未设置", color: "#98A2B3" };
}
function relocateDrawerSections(){
  var exec = $("paneExec"), rel = $("paneRel"), act = $("paneActivity"), edit = $("drawerEditOverview");
  if(!exec || !rel || !act || !edit) return;
  function stackOf(box){
    var s = box.querySelector(".stack");
    if(!s){ s = document.createElement("div"); s.className = "stack"; box.appendChild(s); }
    return s;
  }
  var execBox = stackOf(exec), relBox = rel.querySelector(".stack") || rel, actBox = stackOf(act);
  [$("fSubtasks"), $("fWork"), $("fAttach"), $("fDeps")].forEach(function(el){ if(el) execBox.appendChild(el); });
  [$("drawerSource"), $("assocEditBox"), $("taskPublication")].forEach(function(el){ if(el) relBox.appendChild(el); });
  [$("fComments"), $("fTimeline")].forEach(function(el){ if(el) actBox.appendChild(el); });
  var note = $("afterCreateNote");
  if(note) edit.appendChild(note);
  var layout = taskDrawer.querySelector(".task-detail-layout");
  if(layout) layout.classList.add("single");
  var aside = taskDrawer.querySelector(".task-detail-side");
  if(aside && !aside.children.length) aside.remove();
}
relocateDrawerSections();
/* 新建态页签是收起的：把「关联」「依赖」两张卡搬进概览折叠区，编辑态再按原路搬回。
   依赖卡被就地编辑借住时不动它，免得把打开中的编辑器拆散。 */
function setCreateExtras(isCreate){
  var box = $("createExtras"), host = $("createExtrasBody");
  if(!box || !host) return;
  if(isCreate){
    [$("drawerSource"), $("assocEditBox"), $("fDeps")].forEach(function(el){ if(el) host.appendChild(el); });
    box.hidden = false;
    return;
  }
  box.hidden = true;
  var rel = $("paneRel"), exec = $("paneExec");
  var relBox = rel ? (rel.querySelector(".stack") || rel) : null;
  var execBox = exec ? (exec.querySelector(".stack") || exec) : null;
  if(relBox){
    [$("drawerSource"), $("assocEditBox"), $("taskPublication")].forEach(function(el){ if(el) relBox.appendChild(el); });
  }
  if(execBox && !depInlineOpen && $("fDeps")) execBox.appendChild($("fDeps"));
}
function expandDrawerSects(root){
  if(!root) return;
  root.querySelectorAll(".drawer-sect").forEach(function(s){
    s.classList.remove("collapsed");
    var head = s.querySelector(".drawer-sect-head");
    if(head) head.setAttribute("aria-expanded", "true");
  });
}
function setDrawerTab(name){
  if(["overview", "exec", "rel", "activity"].indexOf(name) < 0) name = "overview";
  /* 借住在关联卡里的依赖编辑器只在关联页成立，离开就搬回执行页 */
  if(depInlineOpen && name !== "rel") closeDepInline();
  drawerTab = name;
  taskDrawer.querySelectorAll("[data-drawer-tab]").forEach(function(b){
    b.setAttribute("aria-selected", b.dataset.drawerTab === name ? "true" : "false");
  });
  taskDrawer.querySelectorAll("[data-drawer-pane]").forEach(function(p){
    p.hidden = p.dataset.drawerPane !== name;
  });
  if(name === "exec") expandDrawerSects($("paneExec"));
  if(name === "activity") expandDrawerSects($("paneActivity"));
  if(name === "overview") renderReadView();
  if(drawerBodyEl) drawerBodyEl.scrollTop = 0;
}
function setDrawerMode(mode){
  if(mode === "read" && !rt.editingId) mode = "edit";
  drawerMode = mode;
  var isRead = mode === "read";
  if(rt.editingId) showTaskErrors([]);
  var root = taskDrawer.querySelector(".drawer");
  if(root) root.classList.toggle("read-mode", isRead);
  var readBox = $("drawerReadOverview"), editBox = $("drawerEditOverview");
  if(readBox) readBox.hidden = !isRead;
  if(editBox) editBox.hidden = isRead;
  /* 关联页：读态看摘要，编辑态才展开表单；发布事实两种模式都可看 */
  var readAssoc = $("readAssocCard"), assocBox = $("assocEditBox");
  if(readAssoc) readAssoc.hidden = !isRead;
  if(assocBox) assocBox.hidden = isRead;
  if(drawerTabsEl) drawerTabsEl.hidden = !rt.editingId;
  if(btnDrawerEdit) btnDrawerEdit.hidden = !isRead || rt.drawerReadOnly;
  if(btnTaskNew) btnTaskNew.hidden = !rt.editingId || rt.drawerReadOnly;
  if(taskDrawerTitle) taskDrawerTitle.title = isRead ? "点击编辑工作项" : "";
  if(btnSaveTask) btnSaveTask.hidden = isRead || rt.drawerReadOnly;
  if(btnSaveTaskContinue) btnSaveTaskContinue.hidden = isRead || rt.drawerReadOnly || !rt.editingId;
  var againBtn = $("btnSaveTaskAgain");
  if(againBtn) againBtn.hidden = isRead || rt.drawerReadOnly || !!rt.editingId;
  if(btnDeleteTask) btnDeleteTask.hidden = rt.drawerReadOnly || !rt.editingId;
  var cancelBtn = $("btnCancelTask");
  if(cancelBtn) cancelBtn.textContent = isRead ? "关闭" : "取消";
  if(taskFormHint && !rt.formDirty){
    taskFormHint.textContent = rt.drawerReadOnly
      ? "你对该项目只有查看权限，可查看但不能修改"
      : (isRead ? "点标题、描述或概览事实即可改，失焦自动保存；完整字段用「编辑」" : "保存后可拖动卡片调整状态与顺序");
  }
  taskForm.classList.toggle("is-create", !rt.editingId);
  setDrawerTab("overview");
  syncInlineTextAffordance();
}
function enterDrawerEdit(opts){
  if(!rt.editingId) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  setDrawerMode("edit");
  setTimeout(function(){
    if(opts && opts.focus === "desc"){
      try{ iDesc.scrollIntoView({ block: "center" }); }catch(e){ /* noop */ }
      /* SunEditor 实例的 focus() 在隐藏容器里不生效，直接聚焦可编辑区 */
      ensureTaskDescEditor().then(function(){
        /* SunEditor 会把编辑器插到容器旁边（容器自身 display:none），从父级找可编辑区 */
        var el = iDesc && iDesc.parentElement ? iDesc.parentElement.querySelector(".sun-editor-editable") : null;
        if(el){ try{ el.focus(); }catch(e){} }
      }).catch(function(){ /* noop */ });
    }else{
      try{ iTitle.focus(); iTitle.select(); }catch(e){ /* noop */ }
    }
  }, 50);
}
function readTask(){
  return (rt.editingId && (taskCacheExtra[rt.editingId] || taskById(rt.editingId))) || {};
}
function selText(id){
  var el = $(id);
  if(!el || !el.value || el.selectedIndex < 0) return "";
  return (el.options[el.selectedIndex].textContent || "").trim();
}
/* 负责人下拉的选项带「姓名 · 角色 · 公司」，只读区只展示姓名 */
function ownerNameNow(){
  var name = selText("iOwner");
  if(!name) return "";
  return name.split(" · ")[0].trim();
}
function versionNamesNow(){
  var sel = $("iVersion"), names = [];
  if(sel && sel.getAttribute("data-ready")){
    var ids = selectedVersionIds(sel);
    for(var i = 0; i < sel.options.length; i++){
      if(ids.indexOf(sel.options[i].value) >= 0) names.push(sel.options[i].textContent);
    }
  }
  if(names.length) return names.join("、");
  return taskVersionsText(readTask()) || "";
}
function demandNameNow(){
  var opt = demandOption();
  return opt ? (opt.textContent || "").replace(/（[^）]*）\s*$/, "").trim() : "";
}
function renderReadDesc(){
  var box = $("readDesc");
  if(!box || box.isContentEditable) return;
  var html = readTask().description || "";
  box.innerHTML = html ? (isHtml(html) ? descHtmlForEditor(html) : plainTextToHtml(html)) : "";
}
function renderReadChecklist(){
  var list = rt.subtasksCache || [], done = 0;
  list.forEach(function(s){ if(s.done) done++; });
  var meta = $("readSubMeta"), bar = $("readSubBar"), ul = $("readChecklist");
  if(meta) meta.textContent = list.length ? done + "/" + list.length : "";
  if(bar) bar.style.width = (list.length ? Math.round(done / list.length * 100) : 0) + "%";
  if(!ul) return;
  if(!list.length){
    ul.innerHTML = '<li class="read-empty">还没有检查项，去「执行」里添加</li>';
    return;
  }
  ul.innerHTML = list.slice(0, 6).map(function(s){
    return '<li class="' + (s.done ? "done" : "") + '">' +
      '<input type="checkbox" class="read-tick" data-read-sub-toggle="' + s.id + '"' + (s.done ? " checked" : "") +
        (rt.drawerReadOnly ? " disabled" : "") + ' aria-label="勾选检查项：' + esc(s.title) + '">' +
      '<span>' + esc(s.title) + '</span></li>';
  }).join("") + (list.length > 6
    ? '<li class="read-empty">还有 ' + (list.length - 6) + ' 项，去「管理」查看</li>' : "");
}
/* 交付证据 / 关联摘要的一行：有穿透目标时渲染为可点可聚焦的 dd */
function evRow(label, text, attrs, hint){
  if(attrs){
    return '<dt>' + esc(label) + '</dt><dd class="ev-link" role="button" tabindex="0" ' + attrs
      + ' title="' + esc(hint || text) + '">' + esc(text) + '</dd>';
  }
  return '<dt>' + esc(label) + '</dt><dd title="' + esc(text) + '">' + esc(text) + '</dd>';
}
/* 关联就地编辑行（P4）：值仍是跳转按钮，可写时右侧加铅笔单独触发选择浮层。
   dd 用 flex 容器而非 role=button，避免按钮里再嵌按钮；跳转委托仍按 data-ev-* 命中内层按钮。 */
function evAssocRow(label, kind, id, text, hint){
  var editable = !!rt.editingId && !rt.drawerReadOnly;
  var val = id
    ? '<button type="button" class="ev-link" data-ev-' + kind + '="' + esc(id) + '" title="' + esc(hint || text) + '">' + esc(text) + '</button>'
    : '<span class="ev-empty">' + esc(text) + '</span>';
  var edit = editable
    ? '<button type="button" class="assoc-edit" data-assoc-edit="' + kind + '" aria-label="就地编辑' + esc(label) + '" title="就地编辑' + esc(label) + '（值仍可点击跳转）">' + icon("edit", 13) + '</button>'
    : "";
  return '<dt>' + esc(label) + '</dt><dd class="ev-assoc">' + val + edit + '</dd>';
}
/* 生产发布一行：正式记录优先；没有正式记录时人工标记只说「发布过」，不冒充生产生效 */
function publicationEvidenceRow(t){
  var hasPub = !!(t.publishedAt || t.everPublished || (Array.isArray(t.publicationTargets) && t.publicationTargets.length));
  var manual = t.manualPublished === true;
  var formal = t.publishedAt ? ("已发布 · " + fmtReleaseTime(t.publishedAt))
    : (t.everPublished ? "有发布记录" : "");
  var text = formal || (manual ? ("已发布（人工）" + (t.manualPublishedAt ? " · 生效 " + t.manualPublishedAt : "")) : "未发布");
  var value = hasPub
    ? '<button type="button" class="ev-link" data-ev-goto="publication" title="查看生产发布记录">' + esc(text) + '</button>'
    : '<span class="' + (manual ? "" : "ev-empty") + '">' + esc(text) + '</span>';
  var actions = "";
  if(t.id && !t.deletedAt && canManageProject(t.reqId)){
    actions = '<span class="ev-actions">'
      + '<button type="button" class="link-btn" data-pub-judge title="补录从其他系统迁移的历史发布事实">'
      + (manual ? "修改标记" : "标记已发布") + '</button>'
      + (manual ? '<button type="button" class="link-btn" data-pub-revoke title="撤销人工发布标记">撤销标记</button>' : "")
      + '</span>';
  }
  return '<dt>生产发布</dt><dd class="ev-publication">' + value + actions + '</dd>';
}
function renderReadEvidence(){
  var dl = $("readEvidence");
  if(!dl) return;
  var t = readTask();
  var demandId = drawerDemandId();
  dl.innerHTML = [
    evRow("计划版本", versionNamesNow() || "待规划", 'data-ev-goto="version"', "查看计划版本与关联"),
    demandId
      ? evRow("关联需求", demandNameNow() || "未关联", 'data-ev-demand="' + esc(demandId) + '"', "打开需求详情")
      : evRow("关联需求", "未关联", "", ""),
    publicationEvidenceRow(t)
  ].join("");
}
/* ==================== 读态测试卡：谁测、何时提测、测了多久 ==================== */
function testPhaseOf(t, col){
  if(col === "testing") return t.testOwnerUserId ? "测试中" : "待领取";
  if(col === "test") return t.testOwnerUserId ? "待测试" : "待领取";
  if(t.testFinishedAt) return col === "done" ? "已通过" : "已退回";
  return "";
}
/* 测试历史：只从操作日志派生轮次（进入 test=提测、进入 testing=开始、离开 testing=本轮结束），
   不新增字段；日志缺失或不足两轮时整块隐藏，避免和当前流程条重复。 */
var testHistOpen = false;
function testRoundReason(detail){
  var m = String(detail || "").match(/原因[：:]\s*([\s\S]+)$/);
  return m ? m[1].trim() : "";
}
function testRoundsFromLogs(){
  var logs = (timelineCache || []).slice().sort(function(a, b){
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  var rounds = [], cur = null;
  function open(at, actor){
    cur = { requested:at || "", started:"", ended:"", owner:actor || "", result:"", reason:"" };
    rounds.push(cur);
  }
  logs.forEach(function(l){
    if(l.action !== "move") return;
    var from = l.fromColumn || "", to = l.toColumn || "";
    if(to === "test" && from !== "testing"){
      open(l.createdAt, l.actorName);
    } else if(to === "testing"){
      if(!cur || cur.ended) open("", l.actorName);
      if(!cur.requested) cur.requested = l.createdAt;
      cur.started = l.createdAt;
      cur.owner = l.actorName || cur.owner;
    } else if(from === "testing"){
      if(!cur) open(l.createdAt, l.actorName);
      cur.ended = l.createdAt;
      cur.result = to === "done" ? "ok" : "bad";
      cur.reason = to === "done" ? "" : testRoundReason(l.detail);
      /* 退回后回到待测队列：本轮已结束，同时开启下一轮的提测（与后端重置口径一致） */
      if(to !== "done") open(l.createdAt, "");
    }
  });
  return rounds;
}
function testRoundDate(ts){
  var d = ts ? fmtShortMD(parseDate(ts)) : "";
  return d || "—";
}
function renderTestHistory(){
  var btn = $("readTestHistBtn"), panel = $("readTestHistory"), ol = $("readTestRounds");
  if(!btn || !panel || !ol) return;
  var rounds = testRoundsFromLogs();
  var show = rounds.length >= 2;
  btn.hidden = !show;
  if(!show){ panel.hidden = true; ol.innerHTML = ""; return; }
  if($("readTestHistCnt")) $("readTestHistCnt").textContent = rounds.length;
  btn.classList.toggle("is-open", testHistOpen);
  btn.setAttribute("aria-expanded", testHistOpen ? "true" : "false");
  panel.hidden = !testHistOpen;
  var html = rounds.map(function(r, idx){
    var out = "", outCls = "";
    if(r.ended){ out = r.result === "ok" ? "已通过" : "退回"; outCls = r.result === "ok" ? "ok" : "bad"; }
    else if(r.started){ out = "进行中"; outCls = "wait"; }
    else { out = "待测"; outCls = "wait"; }
    var flow = '<b>提测 ' + esc(testRoundDate(r.requested)) + '</b>' +
      (r.started ? '<i>→</i><b>开始 ' + esc(testRoundDate(r.started)) + '</b>' : "") +
      (r.owner ? '<i>·</i><span class="tf-round-owner">' + esc(r.owner) + '</span>' : "");
    var span = r.ended ? ("历时 " + spanText(r.started || r.requested, r.ended))
      : r.started ? ("已测 " + elapsedText(r.started))
      : r.requested ? ("已等待 " + elapsedText(r.requested))
      : "";
    return '<li class="tf-round' + (idx === rounds.length - 1 ? " is-current" : "") + '">' +
      '<span class="tf-round-no">第 ' + (idx + 1) + ' 轮</span>' +
      '<span class="tf-round-flow">' + flow + '</span>' +
      '<span class="tf-round-out' + (outCls ? " " + outCls : "") + '">' + esc(out) + '</span>' +
      (span ? '<span class="tf-round-span">' + esc(span) + '</span>' : "") +
      (r.reason ? '<span class="tf-round-reason">原因：' + esc(r.reason) + '</span>' : "") +
      '</li>';
  }).reverse().join("");
  ol.innerHTML = html;
}
function testStep(liId, valId, ts, doneCls){
  var li = $(liId), v = $(valId);
  if(li) li.className = ts ? doneCls : "todo";
  if(v){
    v.textContent = ts ? fmtShortMD(parseDate(ts)) : "—";
    if(ts) v.title = fmtTs(ts); else v.removeAttribute("title");
  }
}
function renderReadTestCard(){
  var card = $("readTestCard");
  if(!card) return;
  var t = readTask();
  var col = (iCol && iCol.value) || t.boardColumn || "";
  var requested = t.testRequestedAt || "", start = t.testStartedAt || "", end = t.testFinishedAt || "";
  var tester = t.testOwner || t.testOwnerUserId || "";
  var visible = col === "test" || col === "testing" || !!(requested || start || end || t.testOwnerUserId);
  card.hidden = !visible;
  if(!visible) return;
  var editable = !!rt.editingId && !rt.drawerReadOnly;
  var phase = testPhaseOf(t, col);
  var phaseEl = $("readTestPhase");
  if(phaseEl){
    phaseEl.textContent = phase || "—";
    phaseEl.className = "test-phase" + (phase === "已通过" ? " ok" : phase === "已退回" ? " bad" : (phase === "待领取" || phase === "待测试") ? " wait" : "");
  }
  if($("readTestWhoAv")) $("readTestWhoAv").innerHTML = tester
    ? avatarHTML(tester, "sm")
    : '<span class="avatar avatar-c5 sm" aria-hidden="true">?</span>';
  if($("readTestOwner")) $("readTestOwner").textContent = tester || "未指派";
  if($("readTestOwnerSub")) $("readTestOwnerSub").textContent = tester
    ? (col === "testing" ? "本轮进行中" : (end ? "本轮已结束" : "等待开始测试"))
    : (col === "test" || col === "testing" ? "点「开始测试」或改派" : "尚未指派");
  var whoCell = $("readTestWhoCell");
  if(whoCell){
    whoCell.classList.toggle("is-empty", !tester);
    var canPick = editable && (col === "test" || col === "testing");
    var whoInfo = tester
      ? ownerPickerOptions().filter(function(o){ return t.testOwnerUserId ? o.id === t.testOwnerUserId : o.name === tester; })[0]
      : null;
    var whoTip = whoInfo ? optionSubText(whoInfo) : "";
    whoCell.classList.toggle("is-clickable", canPick);
    if(canPick){
      whoCell.setAttribute("role", "button");
      whoCell.tabIndex = 0;
      whoCell.title = whoTip ? whoTip + " · 点击改派" : "点击改派测试负责人";
    } else {
      whoCell.removeAttribute("role");
      whoCell.tabIndex = -1;
      if(whoTip) whoCell.title = whoTip; else whoCell.removeAttribute("title");
    }
  }
  testStep("readTestStepReq", "readTestRequested", requested, "");
  testStep("readTestStepStart", "readTestStart", start, "");
  testStep("readTestStepEnd", "readTestEnd", end, end ? (col === "done" ? "ok-end" : "bad-end") : "");
  var dur = "", durSub = "";
  if(end){ dur = "历时 " + spanText(start || requested, end); durSub = (start ? "开始" : "提测") + " → 结束"; }
  else if(start){ dur = "已测 " + elapsedText(start); durSub = "开始 → 现在"; }
  else if(requested){ dur = "已等待 " + elapsedText(requested); durSub = "提测 → 现在"; }
  if($("readTestDur")) $("readTestDur").textContent = dur || "—";
  if($("readTestDurSub")) $("readTestDurSub").textContent = durSub;
  if($("readTestReassign")) $("readTestReassign").hidden = !editable || (col !== "test" && col !== "testing");
  var note = $("readTestNote");
  if(note){
    note.hidden = !((col === "test" || col === "testing") && !t.testOwnerUserId);
    note.textContent = "尚未指派测试负责人。可以直接通过，但卡片会持续提示「未指派测试」；建议先认领或改派。";
  }
  var acts = $("readTestActs");
  if(acts) acts.hidden = !(editable && (col === "test" || col === "testing"));
  var claimable = col === "test" || (col === "testing" && !t.testOwnerUserId);
  if($("readTestClaim")){
    $("readTestClaim").hidden = !claimable;
    $("readTestClaim").textContent = col === "test"
      ? (t.testOwnerUserId ? "开始测试" : "开始测试并认领")
      : "认领测试";
  }
  if($("readTestReject")) $("readTestReject").hidden = col !== "testing";
  if($("readTestPass")) $("readTestPass").hidden = col !== "testing";
  if($("readTestHint")) $("readTestHint").textContent = col === "test"
    ? "开始测试 → 记录开始时间并认领为测试负责人；也可以先改派给其他人。"
    : (t.testOwnerUserId
      ? "测试通过 → 记录结束时间并流转到「已完成」；退回 → 必填原因，通知开发负责人。"
      : "认领测试 → 记录开始时间；也可以先改派给其他人。");
  renderTestHistory();
}
function renderReadAssoc(){
  var dl = $("readAssoc");
  if(!dl) return;
  var t = readTask();
  var demandId = drawerDemandId();
  var docSel = $("iReqDoc");
  /* 文档候选同样异步加载：未就绪时用任务自身的关联，不显示成「未设置」 */
  var docId = docSel
    ? (docSel.getAttribute("data-ready") ? (docSel.value || "") : ((t && t.reqDocId) || ""))
    : "";
  var epicSel = $("iEpic");
  /* 史诗候选异步拉取：未就绪时下拉为空，不能据此显示「未设置」，先用任务自身的关联 */
  var epicId = epicSel
    ? (epicSel.getAttribute("data-ready") ? (epicSel.value || "") : ((t && t.epicId) || ""))
    : "";
  var branchSel = $("iBranch");
  /* 分支候选按项目异步拉取：没就绪时下拉是空的，不能据此说「未设置」，先用任务自身的关联 */
  var branchId = branchSel
    ? (branchSel.getAttribute("data-ready") ? (branchSel.value || "") : (t.branchId || ""))
    : "";
  var projId = t.reqId || currentReqId();
  var assocEditable = !!rt.editingId && !rt.drawerReadOnly;
  var projVal = projId
    ? assocLinkHTML("project", projId, reqNameById(projId))
    : '<span class="ev-empty">未归属项目</span>';
  var projEdit = assocEditable
    ? '<button type="button" class="assoc-edit" data-assoc-edit="project" aria-label="就地编辑所属项目" title="切换所属项目">' + icon("edit", 13) + '</button>'
    : "";
  var projRow = '<dt>所属项目</dt><dd class="ev-assoc">' + projVal + projEdit + '</dd>';
  var verLinks = taskVersionLinksHTML(t, projId);
  var verEdit = assocEditable
    ? '<button type="button" class="assoc-edit" data-assoc-edit="version" aria-label="就地编辑计划版本" title="就地编辑计划版本（值仍可点击跳转）">' + icon("edit", 13) + '</button>'
    : "";
  var versionRow = '<dt>计划版本</dt><dd class="ev-vers">' +
    (verLinks === "待规划" ? '<span class="ev-empty">待规划</span>' : verLinks) + verEdit + '</dd>';
  var depCounts = depAssocCounts();
  var depText = depState.loading ? "加载中…" : (depCounts.total ? ("前置 " + depCounts.pred + " · 后置 " + depCounts.succ) : "暂无依赖");
  var depEdit = assocEditable
    ? '<button type="button" class="assoc-edit" data-assoc-edit="deps" aria-label="就地编辑依赖关系" aria-expanded="' + (depInlineOpen ? "true" : "false") + '" title="' + (depInlineOpen ? "收起依赖编辑" : "就地编辑依赖（即时生效，联动甘特）") + '">' + icon("edit", 13) + '</button>'
    : "";
  var depRow = '<dt>依赖关系</dt><dd class="ev-assoc">' +
    '<button type="button" class="ev-link" data-ev-goto="deps" title="展开依赖编辑（即时生效，联动甘特）">' + esc(depText) + '</button>' + depEdit + '</dd>';
  dl.innerHTML = [
    projRow,
    evRow("分类", catNameById(t.categoryId || rt.formCat) || "未分类", "", ""),
    evRow("负责人", ownerNameNow() || "未分配", "", ""),
    versionRow,
    evAssocRow("关联需求", "demand", demandId, demandId ? (demandNameNow() || "未关联") : "未关联", "打开需求详情"),
    epicId
      ? evRow("所属史诗", assocText("iEpic") || epicLabelFallback(epicSel, epicId), 'data-ev-task="' + esc(epicId) + '"', "打开史诗工作项")
      : evRow("所属史诗", "未设置", "", ""),
    evAssocRow("所属分支", "branch", branchId, branchId ? (assocText("iBranch") || "加载中…") : "未设置", "打开分支详情"),
    depRow,
    docId
      ? evRow("关联文档", assocText("iReqDoc") || (docSel && !docSel.getAttribute("data-ready") ? "加载中…" : "未设置"), 'data-ev-doc="' + esc(docId) + '"', "在新标签页打开关联文档")
      : evRow("关联文档", "未设置", "", ""),
    t.itemType === "bug"
      ? '<dt>来源用例</dt><dd id="readSourceCase" class="ev-case-cell"><span class="ev-case-empty">加载中…</span></dd>'
      : ""
  ].join("");
  if(t.itemType === "bug") loadReadSourceCases(t);
}
/* 缺陷反查来源用例：执行流水里把本缺陷记为 bug_task_id 的用例，可点回用例详情 */
var readSourceCaseSeq = 0;
function loadReadSourceCases(t){
  var seq = ++readSourceCaseSeq;
  var taskId = t.id;
  API.get("/api/test-cases/by-bug/" + encodeURIComponent(taskId)).then(function(links){
    if(seq !== readSourceCaseSeq || rt.editingId !== taskId) return;
    var dd = $("readSourceCase");
    if(!dd) return;
    if(!links || !links.length){
      dd.innerHTML = '<span class="ev-case-empty">手工创建，无来源用例</span>';
      return;
    }
    dd.innerHTML = links.map(function(l){
      var n = Number(l.caseNo) || 0, no = "";
      if(n > 0){ no = String(n); while(no.length < 3) no = "0" + no; no = "TC-" + no + " "; }
      var label = no + (l.caseTitle || "");
      return '<span class="ev-case-link" role="button" tabindex="0" data-ev-case="' + esc(l.caseId)
        + '" data-ev-case-req="' + esc(l.reqId || "") + '" title="' + esc("打开来源用例：" + label) + '">'
        + esc(label) + '</span>';
    }).join("");
  }).catch(function(){
    if(seq !== readSourceCaseSeq || rt.editingId !== taskId) return;
    var dd = $("readSourceCase");
    if(dd) dd.innerHTML = '<span class="ev-case-empty">来源用例加载失败</span>';
  });
}
function activityEntries(){
  var out = [];
  (commentsCache || []).forEach(function(c){
    out.push({ at: c.createdAt, who: c.authorName || "成员", kind: "评论", text: c.content || "" });
  });
  (timelineCache || []).forEach(function(l){
    out.push({ at: l.createdAt, who: l.actorName || "系统", kind: "操作", text: l.detail || l.action || "" });
  });
  out.sort(function(a, b){ return String(b.at || "").localeCompare(String(a.at || "")); });
  return out;
}
function renderReadActivity(){
  var ul = $("readActivity");
  if(!ul) return;
  var list = activityEntries().slice(0, 2);
  ul.innerHTML = list.length ? list.map(function(it){
    return '<li><span class="ra-time">' + esc(fmtTs(it.at) || "—") + '</span>' +
      '<span class="ra-txt"><b>' + esc(it.who) + '</b> · ' + esc(it.kind) + '：' +
      esc(String(it.text).slice(0, 90)) + '</span></li>';
  }).join("") : '<li class="read-empty">暂无动态</li>';
}
function syncDrawerCounts(){
  var list = rt.subtasksCache || [], done = 0;
  list.forEach(function(s){ if(s.done) done++; });
  var ec = $("tabExecCount");
  if(ec) ec.textContent = list.length ? done + "/" + list.length : "";
  var ac = $("tabActivityCount");
  if(ac){
    var n = (commentsCache || []).length + (timelineCache || []).length;
    ac.textContent = n ? String(n) : "";
  }
}
function renderReadView(){
  if(drawerMode !== "read" || !rt.editingId) return;
  syncDrawerFacts();
  renderReadTestCard();
  renderReadDesc();
  renderReadChecklist();
  renderReadEvidence();
  renderReadAssoc();
  renderReadActivity();
  syncDrawerCounts();
}
/* 任务描述富文本编辑器（SunEditor） */
var taskDescEditor = null, taskDescEditorPromise = null, pendingTaskDesc = null, pendingDescReadOnly = null,
    taskDescSuppressChange = false;
function plainTextToHtml(text){
  if(!text) return "";
  return text.split(/\n\n+/).map(function(p){
    return "<p>" + p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>") + "</p>";
  }).join("");
}
function loadSunEditorLib(){
  if(typeof window.SUNEDITOR !== "undefined") return Promise.resolve();
  return new Promise(function(resolve, reject){
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/suneditor/suneditor.min.css";
    document.head.appendChild(css);
    var s = document.createElement("script");
    s.src = "vendor/suneditor/suneditor.min.js";
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error("富文本编辑器加载失败，请检查网络后重试")); };
    document.head.appendChild(s);
  });
}
function syncTaskDescEditorReadOnly(){
  if(!taskDescEditor) return;
  if(pendingDescReadOnly) taskDescEditor.disable(); else taskDescEditor.enable();
}
function ensureTaskDescEditor(){
  if(taskDescEditor) return Promise.resolve(taskDescEditor);
  if(taskDescEditorPromise) return taskDescEditorPromise;
  taskDescEditorPromise = loadSunEditorLib().then(function(){
    if(!$("iDesc")){ taskDescEditorPromise = null; return null; }
    taskDescEditor = SUNEDITOR.create("iDesc", {
      width: "100%",
      height: "auto",
      minHeight: "120px",
      placeholder: "目标、验收标准、注意事项…（可选）",
      buttonList: [
        ["undo","redo"],
        ["bold","underline","italic","strike"],
        ["fontColor","hiliteColor"],
        ["align","list"],
        ["link","image"],
        ["removeFormat"]
      ],
      mode: "classic",
      resizingBar: false,
      showPathLabel: false,
      charCounter: false,
      imageUploadSizeLimit: 3 * 1024 * 1024
    });
    /* SunEditor 的上传钩子挂在实例上，创建后再赋值；写进 options 不会生效。
       粘贴图片与工具栏选图都走这里，避免默认塞 base64。 */
    taskDescEditor.onImageUploadBefore = uploadTaskDescImage;
    taskDescEditor.onChange = function(){ if(taskDescSuppressChange) return; rt.formDirty = true; };
    syncTaskDescEditorReadOnly();
    if(pendingTaskDesc !== null){
      taskDescSuppressChange = true;
      try{
        var html = isHtml(pendingTaskDesc) ? pendingTaskDesc : plainTextToHtml(pendingTaskDesc);
        taskDescEditor.setContents(descHtmlForEditor(html), false);
      }finally{ taskDescSuppressChange = false; }
      pendingTaskDesc = null;
    }
    if(formBase) formBase.desc = getTaskDescContent();
    return taskDescEditor;
  }).catch(function(e){
    taskDescEditorPromise = null;
    throw e;
  });
  return taskDescEditorPromise;
}
/* 描述内图片在库里存站内相对路径（/api/attachments/...），部署前缀不进数据；
   编辑器内显示时补 appBase，保存前再剥掉，避免换部署路径后图片全挂。 */
var DESC_IMG_REL = 'src="/api/attachments/';
function descHtmlForEditor(html){
  if(!html || !API.base) return html;
  return html.split(DESC_IMG_REL).join('src="' + API.base + '/api/attachments/');
}
function descHtmlForSave(html){
  if(!html || !API.base) return html;
  return html.split('src="' + API.base + '/api/attachments/').join(DESC_IMG_REL);
}
function setTaskDescContent(htmlOrText){
  pendingTaskDesc = htmlOrText === null || htmlOrText === undefined ? "" : htmlOrText;
  if(taskDescEditor){
    taskDescSuppressChange = true;
    try{
      var html = isHtml(pendingTaskDesc) ? pendingTaskDesc : plainTextToHtml(pendingTaskDesc);
      taskDescEditor.setContents(descHtmlForEditor(html), false);
    }finally{ taskDescSuppressChange = false; }
    pendingTaskDesc = null;
  }else{
    ensureTaskDescEditor();
  }
}
function getTaskDescContent(){
  if(taskDescEditor) return descHtmlForSave(taskDescEditor.getContents(true));
  if(pendingTaskDesc !== null) return pendingTaskDesc;
  return "";
}
function uploadTaskDescImage(files, info, core, uploadHandler){
  var f = files[0];
  if(!f) return false;
  if(!rt.editingId){ toast("请先保存工作项，再上传描述图片", "warn"); return false; }
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return false; }
  if(f.size > 3 * 1024 * 1024){ toast("图片超过 3MB，未上传", "warn"); return false; }
  var fd = new FormData();
  fd.append("file", f);
  var url = API.url("/api/tasks/" + encodeURIComponent(rt.editingId) + "/description-images" +
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
    if(json && json.code === 0 && json.data && json.data.url){
      uploadHandler({ result: [{ url: API.url(json.data.url), name: json.data.filename || f.name, size: f.size }] });
    }else{
      toast((json && json.message) || "图片上传失败", "bad");
    }
  }).catch(function(ex){
    toast(ex && ex.message ? ex.message : "图片上传失败", "bad");
  });
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
    desc: getTaskDescContent(),
    start: iStart.value || "",
    due: iDue.value || "",
    estimate: (function(){ var h = iEstimate ? Number(iEstimate.value) : 0; return h > 0 ? Math.round(h * 60) : 0; })(),
    pri: rt.formPri || "",
    cat: rt.formCat || "",
    col: (iCol && iCol.value) || "",
    req: (iReq && iReq.value) || "",
    owner: (function(){ var o = ownerPick(); return (o.userId || "") + "\u0001" + (o.name || ""); })(),
    testOwner: (function(){ var s = $("iTestOwner"); return s && !s.disabled ? (s.value || "") : ""; })(),
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
  ["title", "标题"], ["description", "描述"], ["priority", "优先级"], ["categoryId", "分类"],
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
/* 就地单字段保存的状态：飞行中标记、排队标记、保存前的页签与滚动位置、成功后的专用提示 */
var factSaving = false, factSaveQueued = false, factSaveView = null, factSaveMsg = "";
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
    var againBtnLoading = $("btnSaveTaskAgain");
    if(againBtnLoading){
      againBtnLoading.disabled = true;
      againBtnLoading.classList.add("loading");
    }
  }else{
    btnSaveTask.textContent = btnSaveTask.dataset.saveText || "保存";
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
    if(btnSaveTaskContinue){
      btnSaveTaskContinue.disabled = false;
      btnSaveTaskContinue.classList.remove("loading");
    }
    var againBtnIdle = $("btnSaveTaskAgain");
    if(againBtnIdle){
      againBtnIdle.disabled = false;
      againBtnIdle.classList.remove("loading");
    }
    factSaving = false;
    /* 保存期间又点了一个就地字段：排队的那次在这里补发，避免两次整单提交互相覆盖 */
    if(factSaveQueued){
      factSaveQueued = false;
      setTimeout(factSave, 0);
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
  var docBtn = $("iReqDocView");
  if(docBtn) docBtn.title = "在新标签页打开文档";
}
/* 需求 / 分支候选异步灌进下拉，到位后阅读态关联卡与来源卡要跟着重画，否则会停在空值上 */
function syncAssocRead(){
  if(drawerMode === "read" && rt.editingId) syncDrawerSource();
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
    box.innerHTML = '<div class="search-picker-error">' + esc(el._error) +
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
  var html = '<button type="button" class="search-picker-clear' + (!selectedId ? " selected" : "") + '"' +
    ' data-req-doc-clear aria-pressed="' + (!selectedId) + '">' +
    icon("close", 13) + '<span>不关联文档</span></button>';
  if(!docs.length){
    html += '<div class="search-picker-empty">' +
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
      html += '<div class="search-picker-group">' + esc(reqDocPickerProjectName(doc)) +
        (doc.reqId === current ? " · 当前项目" : "") + ' · ' + n + ' 篇</div>';
    }
    var selected = doc.id === selectedId;
    html += '<button type="button" class="search-picker-option' + (selected ? " selected" : "") + '"' +
      ' data-req-doc-id="' + esc(doc.id) + '" aria-pressed="' + selected + '">' +
      '<span class="search-picker-option-main">' +
        '<span class="search-picker-option-title">' + esc(doc.title || "未命名文档") + '</span>' +
        '<span class="search-picker-option-meta">' + esc(docTypeName(doc.docType)) + '</span>' +
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
  el.className = "menu search-picker";
  el.id = "reqDocPickerPop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "选择关联文档");
  el._docs = [];
  el._module = null;
  el._loading = true;
  el.innerHTML = '<div class="search-picker-head">' +
      '<div class="search-picker-search">' + icon("search", 15) +
        '<input type="search" data-req-doc-search placeholder="搜索文档标题、项目或类型" aria-label="搜索关联文档" autocomplete="off" />' +
      '</div>' +
      '<div class="search-picker-tools">' +
        '<select data-req-doc-scope aria-label="按项目筛选文档"><option value="">全部项目</option></select>' +
        '<span class="search-picker-count" data-req-doc-count aria-live="polite"></span>' +
      '</div>' +
    '</div>' +
    '<div class="search-picker-results" data-req-doc-results></div>' +
    '<div class="search-picker-foot">无需先选项目；选择其他项目的文档时，会自动同步所属项目</div>';
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
  function boxButtons(){ return el.querySelectorAll(".search-picker-clear,.search-picker-option"); }
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
  syncEpicField();
}
/* 史诗自身不能再挂史诗：隐藏归属条里的「所属史诗」并清空残留值 */
function syncEpicField(){
  var box = $("ctxEpicItem"), sel = $("iEpic");
  if(!box) return;
  var isEpic = !!(iItemType && iItemType.value === "epic");
  box.hidden = isEpic;
  if(isEpic && sel) sel.value = "";
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
  else if(rt.editingId && taskDrawerTitle && !taskDrawerTitle.isContentEditable) taskDrawerTitle.textContent = (iTitle && iTitle.value) || "工作项详情";
  if(iTitle) iTitle.placeholder = meta.placeholder;
  /* 编号胶囊：项目内序号，改类型不换号；新建尚未取号时不显示 */
  var noChip = $("drawerItemNo");
  if(noChip){
    var noLabel = itemNoText(readTask().itemNo);
    noChip.hidden = !noLabel;
    noChip.textContent = noLabel;
  }
  var reqSel = $("iReq");
  var reqName = (reqSel && reqSel.value && reqSel.selectedIndex >= 0) ? reqSel.options[reqSel.selectedIndex].textContent : "";
  var sub = $("taskDrawerSub");
  if(sub){
    if(rt.editingId){
      var parts = [];
      if(reqName) parts.push(reqName);
      /* 读态头部按原型：项目 · 版本 · 截止 · 负责人；列名由状态胶囊承担，不再重复 */
      var vn = versionNamesNow();
      if(vn) parts.push(vn);
      if(iDue && iDue.value) parts.push("截止 " + fmtFactDate(iDue.value));
      var ownName = ownerNameNow();
      if(ownName) parts.push(ownName);
      sub.textContent = parts.join(" · ");
    }else{
      /* 新建态先给底线与去向：编号在保存后生成，字段只有标题必填 */
      sub.textContent = "";
      if(reqName) sub.appendChild(document.createTextNode(reqName + " · "));
      sub.appendChild(document.createTextNode("保存后自动编号 · "));
      var onlyPill = document.createElement("span");
      onlyPill.className = "sub-only";
      onlyPill.textContent = "只有标题必填";
      sub.appendChild(onlyPill);
    }
  }
  var colLabel = $("ctxColLabel");
  if(colLabel) colLabel.textContent = rt.editingId ? "所在列" : "新建到";
  var colItem = $("ctxColItem");
  if(colItem) colItem.hidden = !!rt.editingId;
  var ctxBox = taskDrawer.querySelector(".ctx");
  if(ctxBox) ctxBox.classList.toggle("ctx-edit", !!rt.editingId);
  if(btnSaveTask){
    var saveText = rt.editingId ? "保存" : ("新建" + meta.name);
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
  if(!d || isNaN(d.getTime())) return iso || "未设置";
  return (d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/* 开始与截止合并成一段「计划时间」，避免两个同义卡片各占一格 */
function syncDateRangeFact(col){
  var wrap = $("rfDateWrap"), val = $("rfDateRange"), note = $("rfDateNote");
  if(!wrap || !val) return;
  wrap.classList.remove("overdue");
  var s = iStart && iStart.value ? parseDate(iStart.value) : null;
  var d = iDue && iDue.value ? parseDate(iDue.value) : null;
  if(s && isNaN(s.getTime())) s = null;
  if(d && isNaN(d.getTime())) d = null;
  if(!s && !d){
    val.textContent = "未设置";
    if(note) note.textContent = "点此设置";
    return;
  }
  if(s && !d){
    val.innerHTML = esc(fmtFactDate(iStart.value)) + '<span class="rf-date-sep">起</span>';
    if(note) note.textContent = "未设截止";
    return;
  }
  var rule = colRuleOf(col, taskCacheExtra[rt.editingId] || {});
  var rel = "";
  if(rule === "done") rel = "已完成";
  else if(rule === "ended") rel = "已结束";
  else{
    var diff = dayDiff(d, rt.TODAY);
    if(diff === 0) rel = "今天到期";
    else if(diff === 1) rel = "明天到期";
    else if(diff > 1) rel = diff + " 天后到期";
    else{
      rel = "逾期 " + Math.abs(diff) + " 天";
      wrap.classList.add("overdue");
    }
  }
  if(!s){
    val.innerHTML = '<span class="rf-date-sep">截止</span>' + esc(fmtFactDate(iDue.value));
    if(note) note.textContent = rel;
    return;
  }
  val.innerHTML = esc(fmtFactDate(iStart.value)) + '<span class="rf-date-sep">→</span>' + esc(fmtFactDate(iDue.value));
  if(note){
    var span = dayDiff(d, s) + 1;
    note.textContent = (span > 0 ? "共 " + span + " 天" : "") + (rel ? (span > 0 ? " · " : "") + rel : "");
  }
}
/* 状态胶囊 + 概览事实：都从当前表单实时取值，状态只有一个入口 */
function syncDrawerFacts(){
  var col = (iCol && iCol.value) || "backlog";
  var meta = drawerColMeta(col);
  if(drawerStatusPill) drawerStatusPill.hidden = !rt.editingId;
  if($("drawerStatusName")) $("drawerStatusName").textContent = meta.name || col;
  if($("drawerStatusDot")) $("drawerStatusDot").style.background = meta.color || "#98A2B3";
  if(btnFootStatus) btnFootStatus.hidden = !rt.editingId;
  if($("footStatusName")) $("footStatusName").textContent = meta.name || col;
  if($("footStatusDot")) $("footStatusDot").style.background = meta.color || "#98A2B3";
  if(!rt.editingId) return;
  var taskNow = taskCacheExtra[rt.editingId] || {};
  var projectName = reqNameById((iReq && iReq.value) || taskNow.reqId || "");
  /* 跨空间/搜索命中的任务可能不在当前 reqList，回退任务自带的 reqName */
  if((!projectName || projectName === "无") && taskNow.reqName) projectName = taskNow.reqName;
  projectName = projectName || "未归属";
  if($("rfProject")){
    $("rfProject").textContent = projectName;
    $("rfProject").title = projectName;
  }
  var typeNow = (iItemType && iItemType.value) || "task";
  if($("rfTypeIco")){
    $("rfTypeIco").className = "rf-meta-ico rf-type-ico t-" + typeNow;
    $("rfTypeIco").innerHTML = TYPE_ICONS[typeNow] || TYPE_ICONS.task;
  }
  if($("rfType")){
    $("rfType").textContent = (TYPE_META[typeNow] || TYPE_META.task).name;
  }
  if($("rfCategory")){
    var catName = catNameById(rt.formCat) || "";
    $("rfCategory").innerHTML = catName ? esc(catName) : '<span class="rf-empty">未分类</span>';
    $("rfCategory").title = catName || "点击指定分类";
  }
  var versionText = versionNamesNow();
  if($("rfVersion")){
    $("rfVersion").innerHTML = versionText ? esc(versionText) : '<span class="rf-empty">待规划</span>';
    $("rfVersion").title = versionText || "点击加入计划版本";
  }
  syncDateRangeFact(col);
  syncProgFact(col);
  if($("rfTags")){
    var tags = rt.tagsCache || [];
    $("rfTags").innerHTML = tags.length
      ? tags.slice(0, 3).map(function(tg){ return '<span class="tag tag-ghost">' + esc(tg) + '</span>'; }).join("") +
        (tags.length > 3 ? '<span class="rf-sub">+' + (tags.length - 3) + '</span>' : "")
      : '<span class="rf-add">' + icon("plus", 11) + "添加标签</span>";
    $("rfTags").title = tags.length ? tags.join("、") : "点击添加标签";
  }
  if($("rfAttach")){
    var attN = (lastAttList || []).length;
    $("rfAttach").innerHTML = attN ? attN + " 个" : '<span class="rf-empty">暂无</span>';
  }
  /* 关联文档为单选：有则计 1 篇，chip 点击直接打开；空则跳关联页设置 */
  if($("rfDoc")){
    var docIdNow = $("iReqDoc") ? ($("iReqDoc").value || "") : "";
    var docNameNow = docIdNow ? assocText("iReqDoc") : "";
    $("rfDoc").innerHTML = docIdNow ? "1 篇" : '<span class="rf-empty">暂无</span>';
    $("rfDoc").title = docNameNow || (docIdNow ? "查看关联文档" : "点击设置关联文档");
    var rfBox = $("readFacts");
    var docChip = rfBox ? rfBox.querySelector('[data-fact-goto="doc"]') : null;
    if(docChip) docChip.title = docIdNow ? ("打开关联文档" + (docNameNow ? "：" + docNameNow : "")) : "设置关联文档";
  }
  if($("rfOwner")){
    var ownerName = ownerNameNow();
    $("rfOwner").innerHTML = ownerName
      ? avatarHTML(ownerName, "sm") + '<span class="rf-owner-name">' + esc(ownerName) + '</span>'
      : '<span class="rf-empty">未分配</span>';
    $("rfOwner").title = ownerName || "点击分配负责人";
    var ownerSub = $("rfOwnerSub");
    if(ownerSub){
      var ownerLabel = ownerName ? taskMemberLabel(readTask()) : "";
      if(ownerLabel){
        var ownerCompany = ownerLabel.split(" · ")[0];
        var ownerDot = ownerCompany && ownerCompany !== "未标注公司" ? companyColor(ownerCompany) : "transparent";
        ownerSub.innerHTML = '<i style="background:' + ownerDot + '"></i>' + esc(ownerLabel);
        ownerSub.hidden = false;
      }else{
        ownerSub.innerHTML = ""; ownerSub.hidden = true;
      }
    }
  }
  if($("rfPri")){
    var priNow = rt.formPri || "P2";
    $("rfPri").innerHTML = '<span class="rf-dot" style="background:' + esc(priColor(priNow)) + '"></span>' +
      esc(priNow + " · " + priName(priNow));
    $("rfPri").title = "优先级 " + priNow + " · " + priName(priNow);
  }
  var act = Number(rt.formActualMinutes) || 0;
  /* 预估以表单当前值为准：就地改预估后不必等整单回填 rt.formEstimateMinutes */
  var est = iEstimate ? Math.max(0, Math.round((Number(iEstimate.value) || 0) * 60)) : (Number(rt.formEstimateMinutes) || 0);
  if($("rfHours")){
    $("rfHours").innerHTML = (act ? esc(fmtMinutesShort(act)) : "未记录") +
      (est ? ' <span class="rf-hours-est">/ 预估 ' + esc(fmtMinutesShort(est)) + '</span>' : "");
  }
  if($("rfHoursNote")){
    var hoursNote = "";
    if(est && act > est) hoursNote = "超预估 " + fmtMinutesShort(act - est);
    else if(est && act) hoursNote = "剩余 " + fmtMinutesShort(est - act);
    $("rfHoursNote").innerHTML = hoursNote && act > est ? '<span class="rf-chip">' + esc(hoursNote) + '</span>' : esc(hoursNote);
    if($("rfHoursWrap")) $("rfHoursWrap").classList.toggle("overdue", !!hoursNote && act > est);
  }
  renderReadBlocked();
}
/* 阅读态阻塞：事实条上的状态与卡点卡同源，都读表单当前值，就地切换后无需重新打开详情 */
function renderReadBlocked(){
  var blocked = !!(iBlocked && iBlocked.checked);
  var reason = blocked && iBlockedReason ? String(iBlockedReason.value || "").trim() : "";
  var chip = $("rfBlocked"), chipWrap = chip && chip.closest ? chip.closest(".rf-block") : null;
  if(chip){
    chip.textContent = blocked ? "已阻塞" : "未阻塞";
    if(chipWrap){
      chipWrap.classList.toggle("is-blocked", blocked);
      chipWrap.title = blocked ? ("已阻塞" + (reason ? "：" + reason : "（未填原因）")) : "点击标记阻塞";
    }
  }
  var card = $("readBlockedCard");
  if(card){
    card.hidden = !blocked;
    var reasonEl = $("readBlockedReason");
    if(reasonEl) reasonEl.textContent = reason || "未填写卡点原因";
    var clearBtn = $("readBlockedClear");
    if(clearBtn) clearBtn.hidden = !!rt.drawerReadOnly;
  }
}
/* 测试窗口：提测 / 开始 / 结束三个时点只读展示；有测试经历的任务换列后仍可回看 */
function syncTestWindow(task){
  var box = $("fTestWindow");
  if(!box) return;
  var requested = task ? (task.testRequestedAt || "") : "";
  var start = task ? (task.testStartedAt || "") : "";
  var end = task ? (task.testFinishedAt || "") : "";
  var inTest = !!task && (task.boardColumn === "test" || task.boardColumn === "testing");
  box.hidden = !rt.editingId || !(inTest || requested || start || end);
  if($("iTestRequested")) $("iTestRequested").textContent = requested ? fmtTs(requested) : "—";
  if($("iTestStart")) $("iTestStart").textContent = start ? fmtTs(start) : "—";
  if($("iTestEnd")) $("iTestEnd").textContent = end ? fmtTs(end) : "—";
}
/* 进度控件按来源切换：可手改时给滑块，检查项/已完成时给派生读数并指向勾选入口 */
function syncProgFact(col){
  var cell = $("rfProgWrap"), manual = $("rfProgManual"), stat = $("rfProgStatic");
  var range = $("rfProgRange"), pct = $("rfProg"), note = $("rfProgNote");
  if(!cell || !manual || !stat) return;
  var done = col === "done";
  var derived = !done && origSubtaskTotal > 0;
  var prog = Math.max(0, Math.min(100, Number(iProg && iProg.value) || 0));
  manual.hidden = done || derived;
  stat.hidden = !(done || derived);
  if(done || derived){
    var shown = done ? 100 : Math.round(origSubtaskDone / origSubtaskTotal * 100);
    if($("rfProgText")) $("rfProgText").textContent = shown + "%";
    if($("rfProgBar")) $("rfProgBar").style.width = shown + "%";
    if(note) note.textContent = done ? "已完成"
      : "按检查项 " + origSubtaskDone + "/" + origSubtaskTotal + " 派生" + (rt.drawerReadOnly ? "" : " · 点击去勾选");
    cell.setAttribute("role", "button");
    cell.tabIndex = rt.drawerReadOnly ? -1 : 0;
    cell.setAttribute("data-fact-goto", "checklist");
    cell.classList.add("rf-goto");
    cell.title = done ? "已完成工作项进度固定为 100%" : "进度按检查项派生，点击去勾选";
    return;
  }
  if(range){
    range.value = prog;
    range.disabled = !!rt.drawerReadOnly;
    range.style.setProperty("--fill", prog + "%");
  }
  if(pct) pct.textContent = prog + "%";
  if(note) note.textContent = rt.drawerReadOnly ? "只读" : "拖动调整";
  cell.removeAttribute("role");
  cell.removeAttribute("data-fact-goto");
  cell.removeAttribute("tabindex");
  cell.classList.remove("rf-goto");
  cell.title = rt.drawerReadOnly ? "只读" : "拖动滑块调整进度";
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
  if(!opt){ box.hidden = true; renderReadView(); return; }
  box.hidden = false;
  /* 只读态不给「移除关联」入口：点击虽被 denyReadOnly 拦截，但不应展示一个按不动的按钮 */
  var sourceRm = $("drawerSourceRemove");
  if(sourceRm) sourceRm.hidden = !!rt.drawerReadOnly;
  var title = $("drawerSourceTitle"), meta = $("drawerSourceMeta");
  if(title) title.textContent = (opt.textContent || "").replace(/（[^）]*）\s*$/, "");
  var reqSel = $("iReq");
  var project = (reqSel && reqSel.value && reqSel.selectedIndex >= 0) ? reqSel.options[reqSel.selectedIndex].textContent : "";
  if(meta) meta.textContent = (project ? project + " · " : "") + "关联需求";
  syncAutoProject();
  renderReadView();
  syncCreateExtrasSummary();
}
/* 折叠的次要关联：只报「设了哪几类」，不把具体长文本塞进首屏 */
function assocText(id){
  var sel = $(id);
  if(!sel || !sel.value || sel.selectedIndex < 0) return "";
  var opt = sel.options[sel.selectedIndex];
  return opt ? (opt.textContent || "").trim() : "";
}
/* 下拉未就绪时用缓存里的任务标题顶上，别让已关联的史诗显示成「未设置」 */
function epicLabelFallback(sel, id){
  if(sel && !sel.getAttribute("data-ready")){
    if(sel.getAttribute("data-failed")) return "加载失败";
    var cached = taskById(id);
    return cached && cached.title ? cached.title : "加载中…";
  }
  return "未设置";
}
function syncAssocMore(){
  var sum = $("assocMoreSummary");
  if(!sum) return;
  var names = [];
  if(assocText("iBranch")) names.push("分支");
  if(assocText("iReqDoc")) names.push("文档");
  sum.textContent = names.length ? "已设 " + names.join("、") : "分支 / 文档";
  syncCreateExtrasSummary();
}
/* 收起时摘要要报实际值，否则新建态看不出关联区里已经带了东西 */
function syncCreateExtrasSummary(){
  var el = $("createExtrasSummary");
  if(!el) return;
  var parts = [];
  if(versionNamesNow()) parts.push("版本");
  if(demandNameNow()) parts.push("需求");
  if(assocText("iBranch")) parts.push("分支");
  if(assocText("iReqDoc")) parts.push("文档");
  if(depState && depState.pending.length) parts.push("依赖 " + depState.pending.length);
  el.textContent = parts.length ? "· 已设 " + parts.join("、") : "· 未设置";
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
  /* 没有正式发布事实时不占首屏；确有发布记录或人工标记时展开 */
  var hasPub = !!(task && (task.publishedAt || task.everPublished || task.manualPublished === true
    || (Array.isArray(task.publicationTargets) && task.publicationTargets.length)));
  box.hidden = !task || !hasPub;
  if(!task) return;
  $("taskPublishedBadge").innerHTML = taskPublicationHTML(task);
  $("taskPublicationInfo").textContent = "正式发布记录派生的只读事实；已完成不等于生产生效，执行状态可独立修改。"
    + (task.publishedAt ? " 最近生产发布：" + fmtReleaseTime(task.publishedAt) + "。" : "")
    + (Array.isArray(task.publicationTargets) && task.publicationTargets.length ? " 目标：" + task.publicationTargets.map(function(t){ return typeof t === "string" ? t : (t.targetKey || t.key || "") + "（" + (t.state || t.publicationState || "unknown") + "）"; }).join("、") : "")
    + (task.manualPublished === true
      ? " 人工标记：已发布（生效 " + (task.manualPublishedAt || "—")
        + (task.manualJudgeName ? " · " + task.manualJudgeName : "") + "）"
        + (task.manualJudgeReason ? "：" + task.manualJudgeReason : "")
        + "；仅用于展示与筛选，不参与需求交付统计。"
      : "");
  renderReadView();
}
/* 换项目守卫要按「有没有发布记录」判定（后端 selectTaskRecordIdsForScope 口径，含失败 / 测试 / 回滚），
   比 everPublished（仅生产成功）宽。这里存下已读到的记录数：>0 一定能拦，读不到（-1）就交给后端裁决。 */
var releaseRecordGuard = { taskId:null, count:-1 };
function publicationJudgementLogHTML(j){
  var revoked = !!j.revokedAt;
  return '<li' + (revoked ? ' class="is-revoked"' : '') + '>'
    + '<span class="pub-log-ts">' + esc(j.effectiveOn || "—") + '</span>'
    + '<b>已发布（人工）</b>'
    + '<span>' + esc(j.judgedByName || "—") + '</span>'
    + '<span class="pub-log-ts">' + esc(fmtTs(j.judgedAt) || "—") + '</span>'
    + (j.judgeReason ? '<span class="pub-log-note">' + esc(j.judgeReason) + '</span>' : '')
    + (revoked
      ? '<span class="tag ghost">已撤销</span><span class="pub-log-note">'
        + esc(fmtTs(j.revokedAt) || "") + ' · ' + esc(j.revokedByName || "—")
        + (j.revokeReason ? ' · ' + esc(j.revokeReason) : "") + '</span>'
      : '<span class="tag tag-success">当前生效</span>')
    + '</li>';
}
function loadTaskReleaseRecords(task){
  var box = $("taskReleaseRecords");
  releaseRecordGuard = { taskId: task ? task.id : null, count:-1 };
  if(!box) return;
  box.innerHTML = "";
  if(!task) return;
  var seq = rt.taskFormSeq, reqId = currentReqId();
  box.textContent = "交付记录加载中…";
  Promise.all([
    API.get("/api/task/" + encodeURIComponent(task.id)),
    API.get("/api/tasks/" + encodeURIComponent(task.id) + "/release-records"),
    API.get("/api/tasks/" + encodeURIComponent(task.id) + "/publication-judgements", { offset:0, limit:100 })
      .catch(function(){ return { items:[] }; })
  ]).then(function(results){
    if(!assocStillCurrent(seq, task.id, reqId)) return;
    var fresh = results[0], records = results[1] || [];
    var judgements = (results[2] && results[2].items) || [];
    releaseRecordGuard = { taskId: task.id, count: records.length };
    if(!fresh || (fresh.reqId || "") !== (task.reqId || "")){
      box.textContent = "工作项已变化或不可见，请刷新详情后查看交付记录。";
      showDrawerNotice("工作项已变化，请刷新后继续操作");
      return;
    }
    if(fresh){
      var current = taskCacheExtra[task.id];
      ["publicationState", "everPublished", "publicationTargets", "publishedAt", "publishSource", "publishedReleaseId",
        "manualPublished", "manualPublishedAt", "manualJudgeName", "manualJudgeReason"].forEach(function(key){ current[key] = fresh[key]; });
      syncTaskPublication(current);
    }
    var recordsHTML = records.length
      ? '<h4>正式发布历史（含失败 / 测试 / 回滚）</h4>' + records.map(function(record){ return releaseSnapshotHTML(record, task.id); }).join("")
      : '<p class="hint">未留正式发布记录' + (judgements.length ? '；下方为人工补录的历史发布事实。' : '，不反推或伪造历史。') + '</p>';
    var manualHTML = judgements.length
      ? '<h4 class="pub-manual-head">人工标记历史</h4><ul class="pub-logs">'
        + judgements.map(publicationJudgementLogHTML).join("") + '</ul>'
      : "";
    box.innerHTML = recordsHTML + manualHTML;
    if(records.length || judgements.length) $("taskPublication").hidden = false;
  }).catch(function(ex){
    if(assocStillCurrent(seq, task.id, reqId)) box.textContent = "交付记录加载失败：" + (ex.message || "请重开详情重试");
  });
}
/* 人工发布标记：只补录「有没有发布过」，不写正式发布记录，也不改需求交付阶段 */
function openPublicationJudgementDialog(task){
  if(!task || !task.id) return;
  if(!canManageProject(task.reqId)){
    toast("仅空间主、管理员或项目负责人可标记工作项发布状态", "warn");
    return;
  }
  var date = task.manualPublishedAt || rt.TODAY_ISO;
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet xs"><div class="sheet-body"><div class="panel"><div class="panel-head"><h3>'
    + (task.manualPublished ? "修改人工发布标记" : "标记为已发布（人工）") + '</h3>'
    + '<button class="icon-btn sm" type="button" data-pub-judge-x aria-label="关闭">' + icon("close", 14) + '</button></div>'
    + '<div class="stack"><p class="foot-note">用于补录从其他系统迁移、没有正式发布记录的历史数据。'
    + '标记只影响工作项徽标与「发布态」筛选，不写入版本发布记录，也不参与需求交付派生与统计。</p>'
    + '<label class="field"><span>生效日期</span><input class="input" type="date" id="pubJudgeDate" value="' + esc(date) + '" max="' + esc(rt.TODAY_ISO) + '"></label>'
    + '<label class="field"><span>补录原因（必填）</span><textarea class="input" id="pubJudgeNote" rows="4" maxlength="500" placeholder="例如：从旧系统迁移，原系统记录已随项目归档">' + esc(task.manualJudgeReason || "") + '</textarea></label>'
    + '<div class="row row-gap"><button class="btn primary" type="button" data-pub-judge-ok>保存标记</button>'
    + '<button class="btn" type="button" data-pub-judge-x>取消</button></div>'
    + '</div></div></div></div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-pub-judge-x]")){ UI.closeModal(layer); return; }
    var ok = e.target.closest("[data-pub-judge-ok]");
    if(!ok) return;
    var note = layer.querySelector("#pubJudgeNote").value.trim();
    var effectiveOn = layer.querySelector("#pubJudgeDate").value;
    if(!effectiveOn){ toast("请选择标记生效日期", "warn"); layer.querySelector("#pubJudgeDate").focus(); return; }
    if(!note){ toast("请填写人工标记原因", "warn"); layer.querySelector("#pubJudgeNote").focus(); return; }
    ok.disabled = true;
    API.post("/api/tasks/" + encodeURIComponent(task.id) + "/publication-judgement", {
      effectiveOn:effectiveOn, note:note
    }).then(function(){
      UI.closeModal(layer);
      toast("已标记为发布过（仅影响展示与筛选）", "fs");
      refreshAfterPublicationChange(task);
    }).catch(function(ex){
      ok.disabled = false;
      toast(ex.message || "保存标记失败", "bad");
    });
  });
  UI.openModal(layer, "select");
}
function revokePublicationJudgement(task){
  if(!task || !task.id) return;
  if(!canManageProject(task.reqId)){
    toast("仅空间主、管理员或项目负责人可撤销工作项发布标记", "warn");
    return;
  }
  UI.showPrompt({ title:"撤销人工发布标记", desc:"撤销后该工作项回落为未发布，正式发布记录不受影响；历史记录保留。",
    label:"撤销原因（必填）", required:true, maxLength:500, okText:"撤销标记" }).then(function(note){
    if(note === null) return;
    if(!note.trim()){ toast("请填写撤销原因", "warn"); return; }
    API.post("/api/tasks/" + encodeURIComponent(task.id) + "/publication-judgement/revoke", {
      note:note.trim()
    }).then(function(){
      toast("人工发布标记已撤销", "fs");
      refreshAfterPublicationChange(task);
    }).catch(function(ex){ toast(ex.message || "撤销失败", "bad"); });
  });
}
function refreshAfterPublicationChange(task){
  loadTaskReleaseRecords(task);
  /* 筛选视图（看板 / 列表 / 甘特 / 我的工作）都要按新的发布态重算；动态加载避免与筛选模块成环 */
  import("./filters.js").then(function(m){ m.reloadFilteredViews(); }).catch(function(){});
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
    syncCreateExtrasSummary();
  });
  if(window.MutationObserver) new MutationObserver(function(){ syncVersionReason(); syncCreateExtrasSummary(); }).observe(versionSel, {childList:true, attributes:true, attributeFilter:["data-ready"]});
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
/* 「更多设置」收起时也要看得见已选值；分类已常驻归属条，不再重复展示 */
var RECUR_LABELS = { daily:"每天", weekly:"每周", monthly:"每月" };
function syncMoreSummary(){
  var el = $("drawerMoreSummary");
  if(!el) return;
  var parts = [];
  if(rt.formRecur) parts.push("循环：" + (RECUR_LABELS[rt.formRecur] || rt.formRecur));
  if(iRemind && iRemind.value) parts.push("提醒：" + fmtTs(iRemind.value));
  if(iBlocked && iBlocked.checked) parts.push("已阻塞");
  el.textContent = parts.length ? "· " + parts.join(" · ") : "· 未设置";
}
/* 新建态空标题等错误的顶部汇总：长表单滚下去后，行内红字容易被漏看 */
function showTaskErrors(list){
  var box = $("taskErrSum"), title = $("taskErrTitle"), links = $("taskErrLinks");
  if(!box) return;
  list = list || [];
  box.hidden = !!rt.editingId || !list.length;
  if(!list.length){
    if(links) links.innerHTML = "";
    return;
  }
  if(title) title.textContent = "还有 " + list.length + " 处需要处理";
  if(links) links.innerHTML = list.map(function(it){
    return '<button type="button" data-task-err="' + esc(it.target) + '">' + esc(it.label) + '</button>';
  }).join("");
}
function focusTaskErr(target){
  var el = target === "sevGrid" ? document.querySelector("#sevGrid [data-sev]") : $(target);
  if(el) focusField(el);
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
/* 从弹层（需求详情、下钻表等）打开时，抽屉要抬到弹层之上；
   关闭抽屉只收起自己，下面的弹层原样保留，用户回到上一层而不是被一起关掉 */
function openDrawer(){
  var hasBelow = UI.anyDialogOpen() || !!document.querySelector(".drawer-layer.on:not(#taskDrawer)");
  taskDrawer.style.zIndex = hasBelow ? String(UI.topModalZ() + 1) : "";
  taskDrawer.classList.toggle("nested", hasBelow);
  taskDrawer.classList.add("on");
}
function closeDrawer(){
  if(inlineText) finishTaskTextEdit(inlineText.el, inlineText.field, false);
  closeDepInline();
  taskDrawer.classList.remove("on", "nested");
  taskDrawer.style.zIndex = "";
  rt.formDirty = false;
  factSaveView = null;
  factSaveQueued = false;
  factSaveMsg = "";
}
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
    if(f.id === "iOwner"){ refreshOwnerSelect(); continue; }
    if(f.id === "iTestOwner"){ refreshTestOwnerSelect(); continue; }
    if(f.id === "iProg"){ syncProgByCol(); continue; }
    if(f.id === "iBlockedReason"){ f.disabled = !(iBlocked && iBlocked.checked); continue; }
    f.disabled = false;
  }
  var chipBtns = taskForm.querySelectorAll("#typeGroup [data-type], #sevGrid [data-sev]");
  for(var c = 0; c < chipBtns.length; c++) chipBtns[c].disabled = !!readOnly;
  if(drawerStatusPill) drawerStatusPill.disabled = !!readOnly;
  if(btnFootStatus) btnFootStatus.disabled = !!readOnly;
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
  /* 只读项目：概览事实降级为纯文本，不再提示可点编辑 */
  var factsEl = $("readFacts");
  if(factsEl){
    factsEl.classList.toggle("read-only", !!readOnly);
    factsEl.querySelectorAll("[data-fact-edit],[data-fact-jump]").forEach(function(el){
      el.setAttribute("aria-disabled", readOnly ? "true" : "false");
      el.tabIndex = readOnly ? -1 : 0;
    });
  }
  renderReadBlocked();
  var descEl = $("readDesc");
  if(descEl){
    descEl.classList.toggle("read-only", !!readOnly);
    descEl.tabIndex = readOnly ? -1 : 0;
    descEl.setAttribute("aria-disabled", readOnly ? "true" : "false");
    if(readOnly && descEl.isContentEditable) finishTaskTextEdit(descEl, "desc", false);
  }
  if(readOnly && taskDrawerTitle && taskDrawerTitle.isContentEditable) finishTaskTextEdit(taskDrawerTitle, "title", false);
  syncInlineTextAffordance();
  /* 新建任务保存后仍走“保存并关闭”：留在新建态再保存会重复创建 */
  if(btnSaveTaskContinue) btnSaveTaskContinue.hidden = !!readOnly || !rt.editingId;
  var moreSaveContinue = $("taskMoreSaveContinue");
  if(moreSaveContinue) moreSaveContinue.hidden = !!readOnly || !rt.editingId;
  if(btnDeleteTask) btnDeleteTask.hidden = !!readOnly || !rt.editingId;
  if(iSubNew){
    iSubNew.disabled = !!readOnly;
    iSubNew.placeholder = readOnly ? "只读项目不可添加检查项" : "添加一项，回车确认";
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
  if(btnActualAdd) btnActualAdd.hidden = !!readOnly;
  if(rfHoursAdd) rfHoursAdd.hidden = !!readOnly;
  pendingDescReadOnly = !!readOnly;
  syncTaskDescEditorReadOnly();
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
/* 分类已降到项目级：候选只列指定项目的分类；未挂项目无分类可选（提交后为「未分类」） */
function projCats(reqId){
  if(!reqId) return [];
  return rt.categoriesCache.filter(function(c){ return c.projectId === reqId; });
}
function syncCatSeg(){
  if(!segCat) return;
  var reqId = currentReqId();
  if(!reqId){
    segCat.innerHTML = '<span class="foot-note">未挂项目，分类为「未分类」</span>';
    syncCatPath();
    return;
  }
  var cats = projCats(reqId);
  if(!cats.length){
    /* 项目写成员即可建分类，删除才要求管理员或项目负责人 */
    var cfg = canEditReq(reqId)
      ? '<button class="chip" type="button" data-cat-cfg="1">去项目设置添加</button>'
      : "";
    segCat.innerHTML = '<span class="foot-note">该项目还没有分类</span>' + cfg;
    syncCatPath();
    return;
  }
  segCat.innerHTML = '<button type="button" data-fcat="" aria-pressed="' + (rt.formCat === "") + '">未分类</button>' +
    cats.map(function(c){
      return '<button type="button" data-fcat="' + esc(c.id) + '" aria-pressed="' + (c.id === rt.formCat) + '">' + esc(c.name) + '</button>';
    }).join("");
  syncCatPath();
}
/* 分类路径：选中后回显完整层级，避免同名节点选错 */
function syncCatPath(){
  var line = $("catPathLine"), note = $("catNote");
  if(!line) return;
  var reqId = currentReqId();
  var cats = projCats(reqId);
  var byId = {};
  cats.forEach(function(c){ byId[c.id] = c; });
  var parts = [], cur = rt.formCat ? byId[rt.formCat] : null, guard = 0;
  while(cur && guard++ < 10){
    parts.unshift(cur.name);
    cur = cur.parentId ? byId[cur.parentId] : null;
  }
  var path = parts.join(" › ");
  if(!path){ line.hidden = true; line.innerHTML = ""; }
  else{
    var full = [reqNameById(reqId), path].filter(Boolean).join(" › ");
    line.innerHTML = "位置：<b>" + esc(full) + "</b>";
    line.hidden = false;
  }
  if(note) note.hidden = !(reqId && cats.length);
}
/* 切换项目后校准分类选中：原分类不属于新项目则回到「未分类」，空值本身合法不再回落第一项 */
function ensureCatForProject(reqId){
  if(rt.formCat && !projCats(reqId).some(function(c){ return c.id === rt.formCat; })){
    rt.formCat = "";
  }
  syncCatSeg();
  syncFormSegs();
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
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === cur; });
  iReq.innerHTML = '<option value="">（无项目）</option>' + projectOptionsHTML(list, cur);
  if(cur && rt.reqList.some(function(r){ return r.id === cur; })) iReq.value = cur;
  else iReq.value = "";
  /* 项目下拉重建时值可能被收回（如项目已删）：记下来，避免把这次程序化变化当成用户换项目 */
  lastReqValue = iReq.value;
}
/* 项目候选以服务端花名册为准；未返回时不先开放全部空间成员。 */
var projectRoleLoading = Object.create(null), projectRoleErrors = Object.create(null);
function currentProjectId(){ return iReq ? (iReq.value || "") : ""; }
function ownerRosterKey(){ return rt.currentWs ? rt.currentWs.id + ":" + currentProjectId() : ""; }
function ensureProjectRoles(projectId, force){
  if(!projectId || !rt.currentWs || rt.currentWs.type !== "shared") return;
  var wsId = rt.currentWs.id, key = wsId + ":" + projectId;
  if(!force && (peekProjectMembers(wsId, projectId) || projectRoleLoading[key])) return;
  delete projectRoleErrors[key];
  var request = loadProjectMembers(wsId, projectId, force);
  projectRoleLoading[key] = request;
  request.then(function(){
    if(projectRoleLoading[key] !== request) return;
    delete projectRoleLoading[key];
    if(rt.currentWs && rt.currentWs.id === wsId && currentProjectId() === projectId){ refreshOwnerSelect(); refreshTestOwnerSelect(); refreshDepCreateOwners(); refreshOwnerPicker(); refreshTestPicker(); }
  }).catch(function(ex){
    if(projectRoleLoading[key] !== request) return;
    delete projectRoleLoading[key]; projectRoleErrors[key] = ex;
    if(rt.currentWs && rt.currentWs.id === wsId && currentProjectId() === projectId){ refreshOwnerSelect(); refreshTestOwnerSelect(); refreshDepCreateOwners(); refreshOwnerPicker(); refreshTestPicker(); }
  });
}
["ds:project-roles-changed", "ds:member-company-changed", "ds:member-job-title-changed", "ds:member-label-options-changed", "ds:member-roster-changed"].forEach(function(eventName){
  window.addEventListener(eventName, function(e){
    var detail = e.detail || {};
    if(!rt.currentWs || (detail.workspaceId && detail.workspaceId !== rt.currentWs.id)) return;
    if(detail.projectId && detail.projectId !== currentProjectId()) return;
    delete projectRoleErrors[ownerRosterKey()];
    ensureProjectRoles(currentProjectId(), true);
    refreshOwnerSelect();
    refreshTestOwnerSelect();
    refreshDepCreateOwners();
    refreshOwnerPicker();
    refreshTestPicker();
  });
});
function ownerOptions(projectId){
  var opts = [], seen = Object.create(null), ws = rt.currentWs, pid = projectId === undefined ? currentProjectId() : projectId;
  function push(userId, name, m){
    if(!userId || seen[userId]) return;
    seen[userId] = true;
    var titles = memberRoleTitles(m), primary = effectiveMemberRole(m);
    opts.push({ id:userId, name:name, company:companyNameOf(m), role:titles.join(" / "),
      primaryRole:primary, secondary:titles.filter(function(t){ return t !== primary; }) });
  }
  if(ws && ws.type === "shared"){
    var roster = pid ? peekProjectMembers(ws.id, pid) : null;
    /* 无项目时按空间非查看者列出；选了项目必须等可见花名册，失败关闭候选。 */
    var members = pid ? (roster && roster.members || []) : (rt.wsMembersCache || []);
    members.forEach(function(m){ if(m.role !== "viewer" && m.access !== "none") push(m.userId, m.displayName || m.username || m.userId, m); });
  } else if(rt.currentUser){
    push(rt.currentUser.id, rt.currentUser.displayName || rt.currentUser.username, null);
  }
  return opts;
}
function companyOfUser(userId){
  if(!userId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === userId; })[0];
  return hit ? companyNameOf(hit) : "";
}
function ownerOptionHTML(o, selected){
  var shared = rt.currentWs && rt.currentWs.type === "shared";
  var label = o.name + (shared ? " · " + (o.role || "未设角色") + " · " + (o.company || "未标注公司") : "");
  return '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (selected ? " selected" : "") + '>' + esc(label) + '</option>';
}
/* 负责人花名册提示：保留但不可指派的状态收成标签旁一个感叹号，避免在窄列里撑出两行；
   候选项文案里已有「（当前不可选）」，长句只放在悬浮提示里。加载中/加载失败仍用下方提示条。 */
function ownerRosterHint(error, unavailable){
  var item = iOwner && iOwner.closest ? iOwner.closest(".ctx-item") : null;
  var label = item ? item.querySelector(".ctx-label") : null;
  var mark = $("ownerRosterMark");
  if(!mark && label){
    mark = document.createElement("span");
    mark.id = "ownerRosterMark";
    mark.className = "ctx-warn";
    mark.tabIndex = 0;
    mark.setAttribute("role", "img");
    label.appendChild(mark);
  }
  if(mark){
    var show = !!unavailable && !error;
    mark.hidden = !show;
    if(show){
      mark.innerHTML = icon("alertCircle", 13);
      mark.title = "该负责人已不在本项目候选范围：保留不影响保存，重新指派请另选成员";
      mark.setAttribute("aria-label", mark.title);
    } else {
      mark.innerHTML = "";
      mark.removeAttribute("title");
      mark.removeAttribute("aria-label");
    }
  }

  var hint = $("ownerRosterHint");
  if(!hint && iOwner && iOwner.parentNode){
    hint = document.createElement("div"); hint.id = "ownerRosterHint"; hint.className = "foot-note";
    hint.setAttribute("aria-live", "polite"); iOwner.parentNode.appendChild(hint);
    hint.addEventListener("click", function(e){ if(e.target.closest("[data-owner-retry]")){ ensureProjectRoles(currentProjectId(), true); refreshOwnerSelect(); } });
  }
  if(!hint) return;
  hint.hidden = !error;
  hint.innerHTML = error ? '候选加载失败：' + esc(error.message || "网络异常") + ' <button class="btn sm" type="button" data-owner-retry>重试</button>' : "";
}
function populateOwnerSelect(currentName, currentUserId){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var ws = rt.currentWs, pid = currentProjectId(), key = ownerRosterKey();
  var needsRoster = !!(ws && ws.type === "shared" && pid);
  var error = needsRoster && projectRoleErrors[key];
  var pending = needsRoster && !peekProjectMembers(ws.id, pid) && !error;
  var opts = ownerOptions(), curName = currentName == null ? "" : String(currentName), curId = currentUserId == null ? "" : String(currentUserId);
  var html = "", matched = false, groups = [], groupIndex = Object.create(null);
  var uniqueName = curName && opts.filter(function(o){ return o.name === curName; }).length === 1;
  var hasCompany = opts.some(function(o){ return !!o.company; });
  opts.forEach(function(o){
    var on = (curId && o.id === curId) || (!curId && uniqueName && o.name === curName);
    if(on) matched = true;
    if(!hasCompany){ html += ownerOptionHTML(o, on); return; }
    var label = o.company || "未标注公司", g = groupIndex[label];
    if(!g){ g = groupIndex[label] = {label:label, items:[]}; groups.push(g); }
    g.items.push({o:o, on:on});
  });
  if(hasCompany){
    groups.sort(function(a, b){ if(a.label === b.label) return 0; if(a.label === "未标注公司") return 1; if(b.label === "未标注公司") return -1; return a.label.localeCompare(b.label, "zh"); });
    groups.forEach(function(g){ html += '<optgroup label="' + esc(g.label) + '">' + g.items.map(function(x){ return ownerOptionHTML(x.o, x.on); }).join("") + '</optgroup>'; });
  }
  if((curName || curId) && !matched){
    /* 历史账号绑定不能退化成纯文本，否则无关保存会清掉 owner_user_id。 */
    html += '<option value="' + esc(curId || "__text__") + '" data-name="' + esc(curName) + '"' + (curId ? ' data-unavailable="1" disabled' : '') + ' selected>' + esc(curName || curId) + (pending ? "（加载中）" : curId ? "（当前不可选）" : "（非成员）") + '</option>';
  } else if(!matched){
    html = '<option value="__none__" data-name="" selected disabled>' + (pending ? "加载可指派成员…" : error ? "候选加载失败" : opts.length ? "请选择负责人" : "暂无可指派成员") + '</option>' + html;
  }
  iOwner.innerHTML = html;
  iOwner.disabled = !!pending || !!error || !!rt.drawerReadOnly;
  ownerRosterHint(error, !!curId && !matched && !pending && !error);
  if(pending) ensureProjectRoles(pid);
}
function refreshOwnerSelect(){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var sel = iOwner.options[iOwner.selectedIndex];
  var name = sel ? (sel.dataset.name !== undefined ? sel.dataset.name : sel.textContent) : "";
  var uid = sel && sel.value !== "__text__" && sel.value !== "__none__" ? sel.value : "";
  populateOwnerSelect(name, uid);
}
function ownerPick(){
  if(!iOwner || iOwner.tagName !== "SELECT") return {name:null, userId:null};
  var sel = iOwner.options[iOwner.selectedIndex];
  if(!sel || sel.value === "__none__") return {name:null, userId:null};
  return { name:sel.dataset.name || sel.textContent || null, userId:sel.value === "__text__" ? null : sel.value };
}
/* 测试负责人：与开发负责人共用可指派候选，额外允许「待领取」。
   花名册未就绪时禁用并保留原值，避免保存时把已有测试负责人误清空。 */
function populateTestOwnerSelect(currentName, currentUserId){
  var sel = $("iTestOwner");
  if(!sel) return;
  var ws = rt.currentWs, pid = currentProjectId(), key = ownerRosterKey();
  var needsRoster = !!(ws && ws.type === "shared" && pid);
  var error = needsRoster && projectRoleErrors[key];
  var pending = needsRoster && !peekProjectMembers(ws.id, pid) && !error;
  var opts = ownerOptions();
  var curName = currentName == null ? "" : String(currentName), curId = currentUserId == null ? "" : String(currentUserId);
  var uniqueName = curName && opts.filter(function(o){ return o.name === curName; }).length === 1;
  var matched = false, html = '<option value="" data-name="">待领取（不指定）</option>';
  opts.forEach(function(o){
    var on = (curId && o.id === curId) || (!curId && uniqueName && o.name === curName);
    if(on) matched = true;
    html += ownerOptionHTML(o, on);
  });
  if(curId && !matched){
    html += '<option value="' + esc(curId) + '" data-name="' + esc(curName) + '" data-unavailable="1" disabled selected>' +
      esc(curName || curId) + (pending ? "（加载中）" : "（当前不可选）") + '</option>';
  }
  sel.innerHTML = html;
  sel.disabled = !!pending || !!error || !!rt.drawerReadOnly;
  if(pending) ensureProjectRoles(pid);
}
function refreshTestOwnerSelect(){
  var sel = $("iTestOwner");
  if(!sel) return;
  var opt = sel.options[sel.selectedIndex];
  var name = opt ? (opt.dataset.name !== undefined ? opt.dataset.name : opt.textContent) : "";
  populateTestOwnerSelect(name || "", (opt && opt.value) || "");
}
function refreshDepCreateOwners(){
  var f = $("depCreateForm");
  if(f && !f.hidden) populateDepOwners();
}
function testOwnerPick(){
  var sel = $("iTestOwner");
  if(!sel) return null;
  return sel.value || "";
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
  syncCatPath();
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
  timelineCache = logs || [];
  syncDrawerCounts();
  renderReadView();
  if(!timelineBox) return;
  if(!timelineCache.length){
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
    '<button class="link-btn" type="button" data-' + retryAttr + '>重试</button></div>';
}
function loadTimeline(taskId){
  if(!timelineBox) return;
  timelineBox.innerHTML = '<div class="tl-empty">加载中…</div>';
  API.getAllPages("/api/tasks/" + encodeURIComponent(taskId) + "/logs").then(function(logs){
    if(rt.editingId === taskId) renderTimeline(logs);
  }).catch(function(ex){
    if(rt.editingId !== taskId) return;
    timelineBox.innerHTML = '<div class="tl-empty">操作时间线加载失败：' +
      esc(ex.message || "网络异常") + ' <button class="link-btn" type="button" data-timeline-retry>重试</button></div>';
  });
}
if(timelineBox){
  timelineBox.addEventListener("click", function(e){
    if(e.target.closest("[data-timeline-retry]") && rt.editingId) loadTimeline(rt.editingId);
  });
}
var origProgress = 0;
/* 有检查项时进度由完成比派生，不再读手填值；这里记住打开时的基数，供渲染与保存复用 */
var origSubtaskTotal = 0;
var origSubtaskDone = 0;
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
  if(!btnTaskWatch && !btnFootWatch) return;
  var watching = !!(res && res.watching);
  if(btnTaskWatch){
    btnTaskWatch.hidden = !watchTaskId;
    btnTaskWatch.setAttribute("aria-pressed", watching ? "true" : "false");
    btnTaskWatch.title = watching
      ? "已关注：新评论、移入回收站或恢复时会通知你（点击取消）"
      : "关注后，该工作项的新评论、移入回收站或恢复会通知你";
  }
  if(taskWatchLabel) taskWatchLabel.textContent = watching ? "已关注" : "关注";
  if(btnFootWatch){
    btnFootWatch.hidden = !watchTaskId;
    btnFootWatch.setAttribute("aria-pressed", watching ? "true" : "false");
    btnFootWatch.title = btnTaskWatch ? btnTaskWatch.title : "";
  }
  if($("footWatchLabel")) $("footWatchLabel").textContent = watching ? "已关注" : "关注";
}
function loadWatchStatus(taskId){
  watchTaskId = taskId || null;
  renderWatchButton(null);
  if(!watchTaskId) return;
  API.get("/api/tasks/" + encodeURIComponent(watchTaskId) + "/watch").then(function(res){
    if(watchTaskId === taskId) renderWatchButton(res);
  }).catch(function(){
    /* 读不到状态时隐藏开关，避免展示错误的关注态 */
    if(watchTaskId === taskId){
      if(btnTaskWatch) btnTaskWatch.hidden = true;
      if(btnFootWatch) btnFootWatch.hidden = true;
    }
  });
}
/* 抽屉内的「返回上一层」：只记录抽屉自己走过的关联跳转，外部打开仍从零开始 */
function pushDrawerBack(){
  if(!rt.editingId) return null;
  var entry = {
    id: rt.editingId,
    title: (taskDrawerTitle && taskDrawerTitle.textContent) || (taskCacheExtra[rt.editingId] || {}).title || "",
    tab: drawerTab,
    scroll: drawerBodyEl ? drawerBodyEl.scrollTop : 0
  };
  drawerBackStack.push(entry);
  syncDrawerBackBtn();
  return entry;
}
/* 跳转没成功（任务不存在，或被「放弃未保存改动」拦下）时撤掉刚压的那层 */
function dropDrawerBack(entry){
  var i = entry ? drawerBackStack.lastIndexOf(entry) : -1;
  if(i < 0) return;
  drawerBackStack.splice(i, 1);
  syncDrawerBackBtn();
}
function syncDrawerBackBtn(){
  var btn = $("btnDrawerBack");
  if(!btn) return;
  var top = drawerBackStack[drawerBackStack.length - 1];
  btn.hidden = !top;
  if(top) btn.title = "返回「" + (top.title || "上一个工作项") + "」";
}
function drawerGoBack(){
  var prev = drawerBackStack.pop();
  syncDrawerBackBtn();
  if(!prev) return;
  import("./task-actions.js").then(function(m){
    return m.openTaskById(prev.id, {
      keepBackStack: true,
      restoreView: { tab: prev.tab, scroll: prev.scroll }
    });
  }).then(function(ok){
    /* 打开失败或被「放弃未保存改动」拦下时，当前还停在原来那层，别把返回栈吞掉 */
    if(!ok || rt.editingId !== prev.id){ drawerBackStack.push(prev); syncDrawerBackBtn(); }
  });
}
function openTaskDrawer(colId, task, defaults){
  if(!task && roleReadOnly()){ toast("查看者为只读角色，不能新建工作项", "warn"); return; }
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
  /* 从外部（搜索、看板、通知）打开时重置返回栈；抽屉内的关联跳转与「返回」会保住它 */
  if(!(defaults && defaults.keepBackStack)) drawerBackStack = [];
  syncDrawerBackBtn();
  /* 上层弹层可登记“抽屉关闭后刷新自己”的回调（如下钻表、需求详情的关联列表） */
  rt.drawerOnClose = (defaults && typeof defaults.onClose === "function") ? defaults.onClose : null;
  /* 切任务前先收好上一条未发送的评论草稿 */
  stashCommentDraft(lastCommentDraftId || rt.editingId);
  closeTimeAddInline();
  rt.taskFormSeq++;
  setSaveLoading(false); // 新抽屉独立管理 loading，后续再应用当前表单的只读权限
  demandTargetCache = {}; demandTargetPending = {};
  newVersionExplicit = !!(defaults && normalizedIds(defaults.versionIds).length);
  newInheritedTarget = null;
  $("iVersionChangeReason").value = (defaults && defaults.versionChangeReason) || "";
  $("fVersionChangeReason").hidden = true;
  rt.editingId = task ? task.id : null;
  rt.formDirty = false;
  /* 换任务后候选可能属于上一个项目，先清掉再按需重拉 */
  if(commentMentionPicker) commentMentionPicker.reset();
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
    setTaskDescContent(task.description || "");
    iStart.value = task.startDate || "";
    iDue.value = task.dueDate || "";
    syncDateBounds();
    /* 预估耗时：库里存分钟，表单用小时（0.5 步进） */
    if(iEstimate) iEstimate.value = task.estimateMinutes ? (task.estimateMinutes / 60) : "";
    renderActualEstimate(task.totalMinutes, task.estimateMinutes);
    rt.formPri = task.priority || "P2";
    /* 分类已删/不属于当前项目则视为「未分类」 */
    var taskCats = projCats(task.reqId || "");
    rt.formCat = taskCats.some(function(c){ return c.id === task.categoryId; }) ? task.categoryId : "";
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
    origSubtaskTotal = Math.max(0, Number(task.subtaskTotal) || 0);
    origSubtaskDone = Math.max(0, Number(task.subtaskDone) || 0);
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
    populateTestOwnerSelect(task.testOwner || "", task.testOwnerUserId || "");
    fWork.hidden = false; fAttach.hidden = false; fSubtasks.hidden = false; fTimeline.hidden = false;
    if(fComments) fComments.hidden = false;
    if($("fProgress")) $("fProgress").hidden = false;
    syncTestWindow(task);
    if($("fRegression")) $("fRegression").hidden = false;
    if($("afterCreateNote")) $("afterCreateNote").hidden = true;
    /* 只有确实用了低频设置时才展开，避免编辑态默认撑长表单 */
    var drawerMore = $("drawerMore");
    if(drawerMore) drawerMore.open = !!(task.recurType || task.remindAt || task.blocked);
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
    iTitle.value = ""; setTaskDescContent("");
    /* 甘特图双击空白处新建时预填起止日期；普通入口保持为空 */
    iStart.value = (defaults && defaults.startDate) || "";
    iDue.value = (defaults && defaults.dueDate) || "";
    syncDateBounds();
    if(iEstimate) iEstimate.value = "";
    renderActualEstimate(0, null);
    rt.formPri = (defaults && defaults.priority) || "P2";
    /* 从需求拆解时沿用需求分类；显式传入（含空串=未分类）优先，只在没传时回落到该项目第一个 */
    var presetCat = defaults && defaults.categoryId;
    var catExplicit = defaults && defaults.categoryId !== undefined;
    var catCands = projCats(initialReqId);
    var catHit = !!presetCat && catCands.some(function(c){ return c.id === presetCat; });
    rt.formCat = catHit ? presetCat
      : (catExplicit ? "" : ((catCands[0] || {}).id || ""));
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
    if(iItemType) iItemType.value = (defaults && defaults.itemType) || "task";
    clearDefectFields();
    ensureVersion(normalizedIds(defaults && defaults.versionIds));
    ensureFoundVersion("");
    ensureEpic((defaults && defaults.epicId) || "");
    ensureReqDoc((defaults && defaults.reqDocId) || "");
    ensureBranch("", initialReqId);
    origProgress = 0;
    origSubtaskTotal = 0;
    origSubtaskDone = 0;
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
    populateTestOwnerSelect("", "");
    fWork.hidden = true; fAttach.hidden = true; fSubtasks.hidden = true; fTimeline.hidden = true;
    if(fComments) fComments.hidden = true;
    if($("fProgress")) $("fProgress").hidden = true;
    syncTestWindow(null);
    if($("fRegression")) $("fRegression").hidden = true;
    if($("afterCreateNote")) $("afterCreateNote").hidden = false;
    var drawerMoreNew = $("drawerMore");
    if(drawerMoreNew) drawerMoreNew.open = false;
    commentsCache = [];
    restoreCommentDraft(null);
    loadWatchStatus(null);
    if(commentList) commentList.innerHTML = "";
    if(commentCount) commentCount.textContent = "";
    if(commentMentionPicker) commentMentionPicker.close();
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
  showTaskErrors([]);
  applyDrawerReadOnly(readOnly);
  syncTaskPublication(task);
  syncDrawerFacts();
  syncAssocMore();
  resetFormBaseline();
  /* 已有工作项打开先读、再编辑；新建直接进编辑态，页签收起 */
  setDrawerMode(task ? "read" : "edit");
  /* 新建没有页签入口：关联与依赖改由概览折叠区承载；已带出需求时直接展开，别把来源卡藏起来 */
  setCreateExtras(!rt.editingId);
  var extrasBox = $("createExtras");
  if(extrasBox && !rt.editingId) extrasBox.open = !!rt.formDemandId;
  openDrawer();
  loadTaskReleaseRecords(task);
  UI.wireTooltips(taskDrawer);
  /* 就地保存失败回滚 / 冲突重载：重填后停在原页签与原滚动位置，不把用户弹回概览顶部 */
  var restoreView = (defaults && defaults.restoreView) || null;
  setTimeout(function(){
    if(restoreView && rt.editingId === (task ? task.id : null)){
      if(restoreView.tab && restoreView.tab !== "overview") setDrawerTab(restoreView.tab);
      /* 重填会经 setDrawerTab("overview") 收起依赖卡；失败回滚不该把用户正在看的卡收掉 */
      if(restoreView.depInline) openDepSection(true);
      restoreDrawerScroll(restoreView.scroll || 0, task ? task.id : null);
      return;
    }
    if(drawerMode === "read"){
      try{ taskForm.focus({ preventScroll: true }); }catch(e){ /* noop */ }
      if(drawerBodyEl) drawerBodyEl.scrollTop = 0;
    }else{
      try{ iTitle.focus(); iTitle.select(); }catch(e){ /* noop */ }
    }
  }, 60);
}
/* 关联页的交付记录异步补进来，重填后 60ms 时内容可能还不够高，一次赋值会被夹回 0。
   撑开前重试几次；到位、超时、切了任务或用户自己滚动就停，不跟用户抢滚动条。 */
function restoreDrawerScroll(target, taskId){
  if(!drawerBodyEl || !target) return;
  var tries = 0, last = -1;
  (function step(){
    if(!drawerBodyEl || rt.editingId !== taskId) return;
    if(last >= 0 && Math.abs(drawerBodyEl.scrollTop - last) > 2) return;
    drawerBodyEl.scrollTop = target;
    last = drawerBodyEl.scrollTop;
    if(Math.abs(last - target) <= 2 || ++tries >= 12) return;
    setTimeout(step, 60);
  })();
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
  mode: "", pickerSeq: 0, pickerItems: [], pickerLoading: false, searchTimer: null, alignOnce: false
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
    dueDate: (iDue && iDue.value) || ""
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
  var otherTitle = esc(other.title || "未命名工作项");
  var titleEl = other.id
    ? '<button type="button" class="dep-title" data-dep-open="' + esc(other.id) + '" title="打开「' + otherTitle + '」详情">' + otherTitle + '</button>'
    : '<span class="dep-title">' + otherTitle + '</span>';
  return '<div class="dep-row"' + idAttr + '>' +
    '<select class="dep-type" ' + typeAttr + ' aria-label="依赖类型"' +
      (editable ? "" : ' disabled data-dep-locked="1"') + ' title="' + esc(typeMeta.n + "：" + typeMeta.d) + '">' +
      depTypeOptionsHTML(row.depType) + '</select>' +
    '<div class="dep-main">' +
      titleEl +
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
  syncDepCreateTrigger();
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
  syncCreateExtrasSummary();
  /* 关联卡的依赖汇总跟着同一份 depState 走：增删改都在此收口，避免读态摘要停在旧条数 */
  if(drawerMode === "read") renderReadAssoc();
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
  /* 换工作项 / 新建：借住在关联卡里的依赖编辑器先搬回执行页，别挂在上一个工作项的摘要下 */
  if(depInlineOpen && (!task || task.id !== depState.taskId)) closeDepInline();
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
  depState.alignOnce = false;
  var p = $("depPicker");
  if(p) p.hidden = true;
  var s = $("iDepSearch");
  if(s) s.value = "";
  var list = $("depPickerList");
  if(list) list.innerHTML = "";
  resetDepCreate();
}
/* ===== 依赖选择器内「新建并关联」=====
   搜不到就就地建一个，省掉「关抽屉→新建→回来再关联」的往返。
   新工作项继承当前工作项的项目，落在待规划列，建好立刻连依赖。 */
var depCreateBusy = false;
function setDepCreateBusy(on){
  depCreateBusy = !!on;
  var ok = $("btnDepCreateOk"), cancel = $("btnDepCreateCancel");
  if(ok){ ok.disabled = !!on; ok.textContent = on ? "创建中…" : "创建并关联"; }
  if(cancel) cancel.disabled = !!on;
}
function syncDepCreateTrigger(){
  var box = $("depCreate");
  if(box) box.hidden = !!rt.drawerReadOnly || !depState.mode;
  var txt = $("depCreateTriggerText");
  if(!txt) return;
  var s = $("iDepSearch");
  var q = ((s && s.value) || "").trim().slice(0, 60);
  txt.textContent = q ? ("新建「" + q + "」并关联") : "新建工作项并关联";
}
function syncDepCreateHint(message, bad){
  var h = $("depCreateHint");
  if(!h) return;
  h.classList.toggle("bad", !!bad);
  if(message){ h.textContent = message; return; }
  var pid = currentReqId();
  var where = pid ? (reqNameById(pid) || "当前项目") : "未归属项目";
  var col = colMeta("backlog");
  h.textContent = "将创建在「" + where + "」· " + ((col && col.name) || "待规划");
}
function populateDepOwners(){
  var sel = $("depNewOwner");
  if(!sel) return;
  var pid = currentReqId();
  var first = sel.getAttribute("data-init") !== "1";
  var keep = first ? ((rt.currentUser && rt.currentUser.id) || "") : sel.value;
  var opts = ownerOptions(pid);
  var html = '<option value="">不指派</option>';
  opts.forEach(function(o){ html += ownerOptionHTML(o, o.id === keep); });
  sel.innerHTML = html;
  sel.value = opts.some(function(o){ return o.id === keep; }) ? keep : "";
  sel.setAttribute("data-init", "1");
}
function resetDepCreate(){
  var f = $("depCreateForm");
  if(f) f.hidden = true;
  var t = $("depNewTitle"); if(t) t.value = "";
  var ty = $("depNewType"); if(ty) ty.value = "task";
  var sv = $("depNewSeverity"); if(sv) sv.value = "major";
  var sf = $("depNewSeverityField"); if(sf) sf.hidden = true;
  var d = $("depNewDue"); if(d) d.value = "";
  var sel = $("depNewOwner"); if(sel) sel.removeAttribute("data-init");
  setDepCreateBusy(false);
  syncDepCreateHint("");
  syncDepCreateTrigger();
}
function openDepCreateForm(){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var f = $("depCreateForm");
  if(!f) return;
  var s = $("iDepSearch"), t = $("depNewTitle");
  if(t) t.value = ((s && s.value) || "").trim().slice(0, 60);
  f.hidden = false;
  populateDepOwners();
  ensureProjectRoles(currentReqId());
  syncDepCreateHint("");
  if(t){ t.focus(); t.select(); }
}
function submitDepCreate(){
  if(depCreateBusy || !depState.mode) return;
  var t = $("depNewTitle");
  var title = ((t && t.value) || "").trim();
  if(!title){ syncDepCreateHint("请先填写标题", true); if(t) t.focus(); return; }
  var mode = depState.mode;
  var type = ($("depNewType") && $("depNewType").value) || "task";
  var osel = $("depNewOwner");
  var oopt = osel && osel.options[osel.selectedIndex];
  var body = {
    title: title,
    reqId: currentReqId() || null,
    boardColumn: "backlog",
    itemType: type,
    priority: "P2",
    progress: 0
  };
  if(type === "bug") body.severity = ($("depNewSeverity") && $("depNewSeverity").value) || "major";
  if(osel && osel.value){
    body.ownerUserId = osel.value;
    body.owner = (oopt && oopt.dataset.name) || "";
  }
  var due = ($("depNewDue") && $("depNewDue").value) || "";
  if(due) body.dueDate = due;
  setDepCreateBusy(true);
  syncDepCreateHint("");
  API.post("/api/tasks", body).then(function(nt){
    setDepCreateBusy(false);
    resetDepCreate();
    closeDepPicker();
    addDependency(nt, mode, true);
    toast("已创建「" + (nt.title || title) + "」并关联为" + (mode === "pred" ? "前置任务" : "后置任务") +
      (rt.editingId ? "" : "（保存本工作项后生效）"), "fs");
    loadBoard({silent:true});
    loadReqs();
    refreshListIfOpen();
    refreshTreeIfOpen();
    refreshChainIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    setDepCreateBusy(false);
    syncDepCreateHint((ex && ex.message) || "创建失败，请稍后重试", true);
  });
}
function openDepPicker(mode){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  depState.mode = mode;
  depState.pickerItems = [];
  depState.pickerLoading = true;
  /* 卡内展开时浮层在关联页底部，候选到位后对齐一次；执行页原位打开保持不动 */
  depState.alignOnce = depInlineOpen;
  var p = $("depPicker");
  if(p) p.hidden = false;
  var title = $("depPickerTitle");
  if(title) title.textContent = mode === "pred" ? "添加前置任务" : "添加后置任务";
  var s = $("iDepSearch");
  if(s){ s.value = ""; s.focus(); }
  var list = $("depPickerList");
  if(list) list.innerHTML = '<div class="dep-picker-empty">加载中…</div>';
  resetDepCreate();
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
  /* 从关联卡铅笔进来时浮层先撑「加载中…」，候选到位后才长足高度；
     对齐要等这一帧写完 DOM，且用即时滚动：跨页签跳转后再叠一段平滑动画，容易停在半路。 */
  if(depState.alignOnce && !depState.pickerLoading){
    depState.alignOnce = false;
    setTimeout(function(){
      var p = $("depPicker");
      if(p && !p.hidden){ try{ p.scrollIntoView({ block:"end" }); }catch(err){ try{ p.scrollIntoView(); }catch(e){} } }
    }, 0);
  }
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
function addDependency(other, mode, silent){
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
    if(!silent) toast("已添加「" + other.title + "」，保存工作项后建立依赖");
    return;
  }
  var body = mode === "pred"
    ? { fromTaskId:other.id, toTaskId:currentId, depType:"FS", lagDays:0 }
    : { fromTaskId:currentId, toTaskId:other.id, depType:"FS", lagDays:0 };
  API.post("/api/gantt/deps", body).then(function(){
    if(!silent) toast("已添加依赖「" + other.title + "」");
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
  var inlineClose = $("btnDepInlineClose");
  if(inlineClose) inlineClose.addEventListener("click", closeDepInline);
  var search = $("iDepSearch");
  if(search){
    search.addEventListener("input", function(){
      var q = this.value.trim();
      syncDepCreateTrigger();
      if(depState.searchTimer) clearTimeout(depState.searchTimer);
      depState.searchTimer = setTimeout(function(){ searchDepTasks(q); }, 180);
    });
    search.addEventListener("keydown", function(e){
      if(e.key !== "Enter") return;
      e.preventDefault();
      var first = root.querySelector(".dep-opt:not(:disabled)");
      if(first) first.click();
      else if(this.value.trim()) openDepCreateForm();
    });
  }
  var depCreateBtn = $("btnDepCreate");
  if(depCreateBtn) depCreateBtn.addEventListener("click", openDepCreateForm);
  var depCreateCancel = $("btnDepCreateCancel");
  if(depCreateCancel) depCreateCancel.addEventListener("click", function(){
    resetDepCreate();
    var s = $("iDepSearch");
    if(s) s.focus();
  });
  var depCreateOk = $("btnDepCreateOk");
  if(depCreateOk) depCreateOk.addEventListener("click", submitDepCreate);
  var depNewType = $("depNewType");
  if(depNewType) depNewType.addEventListener("change", function(){
    var f = $("depNewSeverityField");
    if(f) f.hidden = this.value !== "bug";
  });
  var depNewTitle = $("depNewTitle");
  if(depNewTitle){
    depNewTitle.addEventListener("input", function(){ syncDepCreateHint(""); });
    depNewTitle.addEventListener("keydown", function(e){
      if(e.key !== "Enter") return;
      e.preventDefault();
      submitDepCreate();
    });
  }
  root.addEventListener("click", function(e){
    var depOpen = e.target.closest("[data-dep-open]");
    if(depOpen){ import("./task-actions.js").then(function(m){ m.openTaskById(depOpen.getAttribute("data-dep-open")); }); return; }
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
  /* 有检查项就按完成比自动算：手填会与检查项打架，还会让两处数字对不上 */
  var derived = !done && origSubtaskTotal > 0;
  if(done){
    iProg.value = 100;
    iProg.disabled = true;
    if(segProg) segProg.classList.add("disabled");
    if(progVal) progVal.textContent = "100%";
    if(wrap) wrap.title = "已完成工作项的进度按 100% 计";
    if(hintEl()) hintEl().textContent = "已完成工作项的进度按 100% 计" +
      (origProgress && origProgress !== 100 ? "（原记录 " + origProgress + "%）" : "");
  }else if(derived){
    var pct = Math.round(origSubtaskDone / origSubtaskTotal * 100);
    iProg.value = pct;
    iProg.disabled = true;
    if(segProg) segProg.classList.add("disabled");
    if(progVal) progVal.textContent = pct + "%";
    if(wrap) wrap.title = "按检查项完成比自动计算";
    if(hintEl()) hintEl().textContent = "按检查项完成比自动计算（" +
      origSubtaskDone + "/" + origSubtaskTotal + "）；完成以「移入已完成列」为准";
  }else{
    iProg.disabled = !!rt.drawerReadOnly;
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
  /* 失焦刚触发就地保存时 formDirty 仍为 true，但内容已在提交途中，不该再拦一次「放弃改动」 */
  if(rt.formDirty && !factSaving){
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
  var onClose = rt.drawerOnClose;
  rt.drawerOnClose = null;
  closeTimeAddInline();
  closeDrawer();
  clearWorkTick();
  drawerBackStack = [];
  syncDrawerBackBtn();
  rt.editingId = null;
  if(onClose){ try{ onClose(); }catch(e){ /* 刷新失败不影响关闭 */ } }
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
  var cfg = e.target.closest("[data-cat-cfg]");
  if(cfg){
    var reqId = currentReqId();
    if(reqId) loadView("projects").then(function(m){ m.openProjectDialog(reqId); });
    return;
  }
  var b = e.target.closest("[data-fcat]"); if(!b) return;
  if(denyReadOnly()) return;
  rt.formCat = b.dataset.fcat; syncFormSegs(); rt.formDirty = true;
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
  if(iProg.disabled) return;   /* 派生进度不可手改 */
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
    syncDrawerHead();
    if(iTitle.value.trim()) showTaskErrors([]);
  }
});
var taskErrLinks = $("taskErrLinks");
if(taskErrLinks) taskErrLinks.addEventListener("click", function(e){
  var b = e.target.closest("[data-task-err]");
  if(b) focusTaskErr(b.getAttribute("data-task-err"));
});
/* 标题行提示「Enter 保存」：回车即整单提交，输入法组字中的回车不算 */
iTitle.addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if(!btnSaveTask || btnSaveTask.disabled) return;
  taskForm.requestSubmit(btnSaveTask);
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
  /* 分类随项目走：原项目分类不再可选，回落到新项目第一个分类或「未分类」 */
  ensureCatForProject(iReq.value);
  syncAssocViewBtns();
  syncDrawerHead();
  syncDrawerSource();
  /* 负责人选项里的「本项目角色」跟项目走：换项目后重新取花名册 */
  refreshOwnerSelect();
  refreshTestOwnerSelect();
  refreshDepCreateOwners();
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
    refreshOwnerSelect();
    refreshTestOwnerSelect();
    refreshDepCreateOwners();
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
  loadView("requirements").then(function(m){ m.openReqDocInNewTab(id); });
});
var sourceRemoveBtn = $("drawerSourceRemove");
if(sourceRemoveBtn) sourceRemoveBtn.addEventListener("click", function(){
  if(denyReadOnly()) return;
  var sel = $("iDemand");
  if(!sel) return;
  var hadLink = !!sel.value;
  sel.value = "";
  sel.dispatchEvent(new Event("change", { bubbles:true }));
  /* 读态表单没人提交：只清字段会让来源卡当场消失、刷新后又回来，这里立即落库 */
  if(hadLink && drawerMode === "read" && rt.editingId) factSave("已移除关联需求");
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
  syncDrawerCounts();
  renderReadView();
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
  var path = "/api/comments/" + encodeURIComponent(commentId) + "/attachments";
  var chain = Promise.resolve();
  files.forEach(function(f){
    chain = chain.then(function(){
      return uploadAttachment(path, f).catch(function(ex){
        failed.push(f.name + "（" + (ex && ex.message ? ex.message : "上传失败") + "）");
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
    mentionUserIds: commentMentionPicker ? commentMentionPicker.idsInText(text) : []
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
    if(commentMentionPicker){
      commentMentionPicker.close();
      commentMentionPicker.clearPicked();
    }
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
/* 评论附件与任务附件共用拖拽 / 粘贴口径（全局 attach-kit）：拖入composer或粘贴截图即加入待传 */
var commentCompose = document.querySelector(".comment-compose");
if(commentCompose){
  bindFileDrop(commentCompose, function(files){
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    addCommentFiles(files);
  }, { paste: true, pasteTarget: iComment });
}

/* ==================== 评论 @提及 ==================== */
/* 候选只含对该任务所在项目可见的成员；切换任务时 reset() 丢弃旧候选 */
var commentMentionPicker = iComment ? createMentionPicker(iComment, {
  canOpen: function(){ return !rt.drawerReadOnly; },
  excludeUserId: function(){ return rt.currentUser && rt.currentUser.id; },
  loadMembers: function(){
    var taskId = rt.editingId;
    if(!taskId) return Promise.reject(new Error("未选择工作项"));
    return API.get("/api/tasks/" + encodeURIComponent(taskId) + "/mention-candidates");
  }
}) : null;
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
attachCombo(iTags);
attachEnvDict(iEnvironment);
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
function toggleTaskWatch(btn){
  var taskId = watchTaskId;
  if(!taskId || (btn && btn.disabled)) return;
  var watching = btnTaskWatch
    ? btnTaskWatch.getAttribute("aria-pressed") === "true"
    : (btn && btn.getAttribute("aria-pressed") === "true");
  if(btn) btn.disabled = true;
  if(btnTaskWatch) btnTaskWatch.disabled = true;
  if(btnFootWatch) btnFootWatch.disabled = true;
  var req = watching
    ? API.del("/api/tasks/" + encodeURIComponent(taskId) + "/watch")
    : API.post("/api/tasks/" + encodeURIComponent(taskId) + "/watch");
  req.then(function(res){
    if(btn) btn.disabled = false;
    if(btnTaskWatch) btnTaskWatch.disabled = false;
    if(btnFootWatch) btnFootWatch.disabled = false;
    if(watchTaskId !== taskId) return;
    renderWatchButton(res);
    toast(watching ? "已取消关注" : "已关注：该工作项的评论与回收站操作会通知你");
  }, function(e){
    if(btn) btn.disabled = false;
    if(btnTaskWatch) btnTaskWatch.disabled = false;
    if(btnFootWatch) btnFootWatch.disabled = false;
    if(!e || !e.silent) toast((e && e.message) || "操作失败", "bad");
  });
}
if(btnTaskWatch) btnTaskWatch.addEventListener("click", function(){ toggleTaskWatch(btnTaskWatch); });
if(btnFootWatch) btnFootWatch.addEventListener("click", function(){ toggleTaskWatch(btnFootWatch); });
/* 任务详情内新建任务：沿用当前任务的项目/版本/史诗，抽屉切换为新建模式 */
if(btnTaskNew) btnTaskNew.addEventListener("click", function(){
  if(!rt.editingId) return;
  if(rt.formDirty){ toast("当前工作项有未保存的改动，请先保存再新建", "warn"); return; }
  UI.closeAllPops();
  var t = taskCacheExtra[rt.editingId] || {};
  var vSel = $("iVersion"), eSel = $("iEpic");
  openTaskDrawer(t.boardColumn || "backlog", null, {
    reqId: currentReqId() || t.reqId || "",
    versionIds: selectedVersionIds(vSel).filter(function(id){ return Array.from(vSel.options).some(function(o){ return o.value === id && !o.disabled; }); }),
    epicId: (eSel && eSel.value) || ""
  });
});
$("drawerItemNo").addEventListener("click", function(){
  var label = itemNoText(readTask().itemNo);
  if(label) copyToClipboard(label, "编号 " + label + " 已复制到剪贴板");
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
  var saveAgain = !!(e.submitter && e.submitter.id === "btnSaveTaskAgain");
  /* 读态就地单字段保存：任何一步失败都要把表单还原成服务器上的值，
     否则读态卡片会停在一个根本没落库的新值上。编辑态失败保留输入供改了再存。 */
  var inlineFact = factSaving && drawerMode === "read" && !!rt.editingId;
  function failSave(msg, kind){
    var view = factSaveView;
    factSaveView = null;
    factSaveMsg = "";
    factSaveQueued = false;   // 失败后不再补发排队的那次就地保存
    setSaveLoading(false);
    if(msg) toast(msg, kind || "bad");
    if(inlineFact) revertFailedFactSave(view);
  }
  var title = iTitle.value.trim();
  showTaskErrors([]);
  if(!title){
    fTitle.classList.add("invalid");
    showTaskErrors([{ target:"iTitle", label:"工作项标题：请填写工作项标题" }]);
    focusField(iTitle);
    failSave();
    return;
  }
  if(!rt.editingId && iReq.value && !$("iVersion").getAttribute("data-ready")){
    failSave("请等待计划版本加载完成；加载失败时请重开抽屉重试", "warn"); return;
  }
  var pendingTag = iTags.value.trim().replace(/[,，]/g, "");
  if(pendingTag && rt.tagsCache.indexOf(pendingTag) === -1 && rt.tagsCache.length < 8) rt.tagsCache.push(pendingTag.slice(0, 16));
  /* 开始日期 ≤ 截止日期（服务端也有同样校验，这里先拦一道省一次往返） */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    failSave("开始日期不能晚于截止日期");
    showTaskErrors([{ target:"iStart", label:"开始日期：不能晚于截止日期" }]);
    focusField(iStart);
    return;
  }
  var itemTypeValue = (iItemType && iItemType.value) || "task";
  if(itemTypeValue === "bug" && !(iSeverity && iSeverity.value)){
    failSave("缺陷必须选择严重度");
    showTaskErrors([{ target:"sevGrid", label:"严重度：缺陷必须选择严重度" }]);
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
    description: getTaskDescContent(),
    priority: rt.formPri,
    categoryId: rt.formCat || "",
    owner: owner.name,
    ownerUserId: owner.userId,
    /* null=不调整（候选未就绪），空串=清空回待领取，id=指定测试负责人 */
    testOwnerUserId: (function(){
      var sel = $("iTestOwner");
      if(!sel || sel.disabled) return null;
      return sel.value || "";
    })(),
    boardColumn: iCol.value || "backlog",
    startDate: iStart.value || null,
    dueDate: iDue.value || null,
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
      if(itemTypeValue === "epic") return null;
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
      if(!fresh){ failSave("保存冲突，且无法读取最新版本；请关闭抽屉后重新打开"); return; }
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
          var backView = factSaveView;
          factSaveView = null;
          factSaveMsg = "";
          /* 已决定放弃当前表单：不清脏标记会撞上「同一任务不重填」守卫，重载变成空操作 */
          rt.formDirty = false;
          openTaskDrawer(null, fresh, { restoreView: inlineFact ? backView : null });
          return;
        }
        return UI.showConfirm({
          title:"覆盖服务器最新版本？",
          msg:"这会用当前表单覆盖他人刚刚保存的内容。请确认你已核对差异。",
          okText:"覆盖保存",
          cancelText:"继续编辑"
        }).then(function(force){
          if(seq !== rt.taskFormSeq) return;
          if(!force){ failSave(inlineFact ? "已取消覆盖保存，详情已还原为服务器上的内容" : "", "warn"); return; }
          if(formRev !== revAtSubmit){ toast("表单已继续变化，请重新保存", "warn"); return; }
          if(conflictOverwriteTried){ failSave("仍与其他修改冲突，请重新加载最新版本"); return; }
          conflictOverwriteTried = true;
          payload.oldUpdatedAt = fresh.updatedAt || null;
          taskCacheExtra[editId] = Object.assign({}, taskCacheExtra[editId] || fresh, { updatedAt:fresh.updatedAt });
          setSaveLoading(true);
          saveWith();
        });
      });
    }).catch(function(ex){
      if(seq !== rt.taskFormSeq) return;
      failSave("保存冲突，且无法读取最新版本：" + (ex.message || "请稍后重试"));
    });
  }
  function onSaved(nt){
    if(payload.itemType === "bug" && payload.environment) recordEnv(payload.environment);
    if(seq === rt.taskFormSeq){ // 只有当前抽屉可修改 loading 和表单；旧成功响应仍刷新视图缓存
      setSaveLoading(false);
      var backView = factSaveView;
      factSaveView = null;
      var okMsg = factSaveMsg;
      factSaveMsg = "";
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
          /* 就地改字段：回到读态但停在原页签、原滚动位置，不把用户弹回概览顶部 */
          setDrawerMode("read");
          if(backView){
            if(backView.tab && backView.tab !== "overview") setDrawerTab(backView.tab);
            /* setDrawerMode("read") 会经 setDrawerTab("overview") 收起依赖卡；就地保存不该把用户正在看的卡收掉 */
            if(backView.depInline) openDepSection(true);
            restoreDrawerScroll(backView.scroll || 0, editId);
          }
        }
        var stayHint = $("taskFormHint");
        if(stayHint && !rt.drawerReadOnly && !changedDuringSave) stayHint.textContent = "已保存 · 可继续编辑";
        if(changedDuringSave) toast("已保存提交时的内容 · 保存期间的新改动还未保存", "warn");
        else if(okMsg) toast(okMsg, "fs");
        else toast("已保存「" + title + "」" + (autoTimerHint ? " · 已开始计时" : ""));
      }else{
        var createdId = !wasEdit && nt ? nt.id : null;
        /* 新建时暂存的依赖要等工作项拿到 id 后才能落库；先记数量再关抽屉 */
        var pendingDepCount = createdId ? depState.pending.length : 0;
        if(createdId && saveAgain){
          /* 保存并再建一条：保留项目 / 类型 / 优先级 / 分类 / 列，清空内容后重开同一抽屉 */
          var nextDefaults = {
            keepBackStack: true,
            reqId: payload.reqId || "",
            itemType: payload.itemType,
            priority: payload.priority,
            categoryId: payload.categoryId,
            demandId: payload.demandId || null
          };
          var reopenForNext = function(){
            openTaskDrawer(payload.boardColumn, null, nextDefaults);
          };
          toast("已创建工作项「" + nt.title + "」，接着写下一条", "fs");
          if(pendingDepCount){
            flushPendingDependencies(createdId).then(function(res){
              if(res && res.failed) toast("刚创建的工作项有 " + res.failed + " 条依赖未建立，可在详情里重新添加", "warn");
              refreshGanttIfOpen();
              reopenForNext();
            });
          }else{
            reopenForNext();
          }
        }else{
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
              else if(d === 0){ tip += "，今天到期"; }
              else if(d <= 3){ tip += "，剩余 " + d + " 天"; }
            }
            toast(tip, kind);
          }
        }
      }
    }
    loadBoard({animate:true});
    loadReqs();
    refreshCalendarIfOpen();
    refreshListIfOpen();
    refreshTreeIfOpen();
    refreshChainIfOpen();
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
            failSave(inlineFact ? "已取消状态流转，改动未保存"
              : (ex.code !== 412 && ex.code !== 422 ? (ex.message || "保存失败") : ""), "warn");
            return;
          }
          saveWith(retry);
        });
        return;
      }
      if(ex.code === 409 && wasEdit){ setSaveLoading(false); handleSaveConflict(); return; }
      failSave(ex.message || "保存失败");
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
    if(!ready){ failSave(inlineFact ? "已取消保存，改动未生效" : "", "warn"); return; }
    if(formRev !== revAtSubmit){ setSaveLoading(false); toast("填写理由期间表单已变化，请重新保存", "warn"); return; }
    if(!columnChanged){ saveWith(null); return; }
    guard(wsId, items, toCol).then(function(pass){
      if(seq !== rt.taskFormSeq) return;
      if(!pass){ failSave(inlineFact ? "已取消状态流转，改动未保存" : "", "warn"); return; }
      saveWith(pass);
    });
  }).catch(function(ex){
    if(seq !== rt.taskFormSeq) return;
    failSave("需求目标校验失败：" + (ex.message || "请重试"));
  });
});
$("btnCloseTask").addEventListener("click", tryCloseTaskDrawer);
$("btnCancelTask").addEventListener("click", function(){
  /* 已有工作项的编辑态：没有改动就回到读态，而不是关掉整个详情 */
  if(rt.editingId && drawerMode === "edit" && !rt.formDirty){ setDrawerMode("read"); return; }
  tryCloseTaskDrawer();
});
$("taskScrim").addEventListener("click", tryCloseTaskDrawer);
if(btnDrawerEdit) btnDrawerEdit.addEventListener("click", function(){ enterDrawerEdit(); });
var btnDrawerBack = $("btnDrawerBack");
if(btnDrawerBack) btnDrawerBack.addEventListener("click", drawerGoBack);
/* ==================== 读态正文点开即改：标题 / 描述 ====================
   点正文就地编辑，失焦或 Ctrl/⌘ + Enter 保存、Esc 还原；保存走「保存并继续」整单提交，
   抽屉不关闭、页签与滚动位置保留。只读项目与新建态不给就地入口。 */
var inlineText = null;
function taskInlineWritable(){
  return drawerMode === "read" && !!rt.editingId && !rt.drawerReadOnly;
}
function caretToEnd(el){
  try{
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){ /* noop */ }
}
function restoreTaskTextAttrs(el, field){
  el.removeAttribute("contenteditable");
  el.removeAttribute("aria-multiline");
  el.classList.remove("inline-edit-field");
  if(field === "title"){
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "工作项标题，点击修改");
    el.title = "点击修改标题";
  }else{
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "工作项描述，点击修改");
    el.title = "点击修改描述；失焦或 Ctrl/⌘ + Enter 保存，Esc 取消";
  }
}
function startTaskTextEdit(el, field){
  if(!el) return;
  if(!taskInlineWritable()){
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    if(rt.editingId) enterDrawerEdit(field === "desc" ? { focus: "desc" } : undefined);
    return;
  }
  if(inlineText && inlineText.el !== el) finishTaskTextEdit(inlineText.el, inlineText.field, true);
  if(el.isContentEditable) return;
  inlineText = { el: el, field: field, before: field === "title" ? (iTitle.value || "") : el.innerHTML };
  if(field === "title") el.textContent = iTitle.value || "";
  el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", field === "desc" ? "true" : "false");
  el.setAttribute("aria-label", field === "title" ? "工作项标题" : "工作项描述");
  el.removeAttribute("title");
  el.classList.add("inline-edit-field");
  try{ el.focus(); }catch(e){ /* noop */ }
  caretToEnd(el);
}
function descHtmlBlank(html){
  var probe = document.createElement("div");
  probe.innerHTML = html || "";
  if(probe.querySelector("img,hr,table,li")) return false;
  return !String(probe.textContent || "").replace(/\u00a0/g, " ").trim();
}
function finishTaskTextEdit(el, field, save){
  if(!el || !el.isContentEditable) return;
  var before = inlineText && inlineText.el === el ? inlineText.before : null;
  var val;
  if(field === "title"){
    val = String(el.innerText || "").replace(/\u00a0/g, " ").replace(/[\r\n]+/g, " ").trim();
    if(save && !val){ toast("工作项标题不能为空", "warn"); try{ el.focus(); }catch(e){} return; }
    if(save && val.length > 60){ toast("工作项标题不能超过 60 字", "warn"); try{ el.focus(); }catch(e){} return; }
  }else{
    val = descHtmlForSave(el.innerHTML || "");
    if(descHtmlBlank(val)) val = "";
  }
  restoreTaskTextAttrs(el, field);
  inlineText = null;
  var changed = field === "title" ? val !== (iTitle.value || "") : el.innerHTML !== before;
  if(!save || !changed){
    if(field === "title") el.textContent = (iTitle.value || "") || "工作项详情";
    else renderReadDesc();
    rt.formDirty = formFieldsDirty();
    syncDrawerDirty();
    return;
  }
  if(field === "title"){
    iTitle.value = val;
    syncTitleCount();
    el.textContent = val;
  }else{
    setTaskDescContent(val);
  }
  factSave();
}
function syncInlineTextAffordance(){
  var canEdit = taskInlineWritable();
  if(taskDrawerTitle){
    taskDrawerTitle.classList.toggle("task-title-edit", canEdit);
    if(canEdit){
      taskDrawerTitle.tabIndex = 0;
      taskDrawerTitle.setAttribute("role", "button");
      taskDrawerTitle.title = "点击修改标题";
    }else if(!taskDrawerTitle.isContentEditable){
      taskDrawerTitle.removeAttribute("tabindex");
      taskDrawerTitle.removeAttribute("role");
      taskDrawerTitle.removeAttribute("title");
    }
  }
  var box = $("readDesc"), hint = $("readDescHint");
  if(box){
    box.classList.toggle("is-editable", canEdit);
    if(!box.isContentEditable){
      box.tabIndex = canEdit ? 0 : -1;
      box.setAttribute("aria-disabled", canEdit ? "false" : "true");
    }
  }
  if(hint) hint.hidden = !canEdit;
}
if(taskDrawerTitle){
  taskDrawerTitle.addEventListener("click", function(){
    if(taskDrawerTitle.isContentEditable) return;
    startTaskTextEdit(taskDrawerTitle, "title");
  });
  taskDrawerTitle.addEventListener("keydown", function(e){
    if(taskDrawerTitle.isContentEditable) return;
    if(e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    startTaskTextEdit(taskDrawerTitle, "title");
  });
}
var readDescBox = $("readDesc");
if(readDescBox){
  readDescBox.addEventListener("click", function(e){
    if(readDescBox.isContentEditable) return;
    if(e.target.closest("a")) return;
    startTaskTextEdit(readDescBox, "desc");
  });
  readDescBox.addEventListener("keydown", function(e){
    if(readDescBox.isContentEditable) return;
    if(e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    startTaskTextEdit(readDescBox, "desc");
  });
}
taskDrawer.addEventListener("focusout", function(e){
  if(!inlineText || e.target !== inlineText.el) return;
  finishTaskTextEdit(inlineText.el, inlineText.field, true);
});
taskDrawer.addEventListener("keydown", function(e){
  if(!inlineText) return;
  var el = inlineText.el, field = inlineText.field;
  if(e.target !== el) return;
  if(e.key === "Escape"){
    e.preventDefault();
    e.stopPropagation();
    finishTaskTextEdit(el, field, false);
    return;
  }
  if(e.key === "Enter" && (field === "title" || e.metaKey || e.ctrlKey)){
    e.preventDefault();
    e.stopPropagation();
    finishTaskTextEdit(el, field, true);
  }
}, true);
if(drawerTabsEl) drawerTabsEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-drawer-tab]");
  if(b) setDrawerTab(b.dataset.drawerTab);
});
taskDrawer.addEventListener("click", function(e){
  var go = e.target.closest("[data-drawer-goto]");
  if(go) setDrawerTab(go.dataset.drawerGoto);
});
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
      refreshTreeIfOpen();
      refreshChainIfOpen();
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
  /* 检查项是进度的唯一事实来源，列表一刷新就重算并同步抽屉里的进度 */
  origSubtaskTotal = rt.subtasksCache.length;
  origSubtaskDone = doneN;
  if(subCount) subCount.textContent = rt.subtasksCache.length ? (doneN + "/" + rt.subtasksCache.length) : "";
  var subHint = $("subHint");
  if(subHint){
    subHint.hidden = !rt.subtasksCache.length;
    subHint.textContent = rt.drawerReadOnly ? "只读项目：可查看清单，不能排序" : "拖把手或聚焦后按 ↑/↓ 调整顺序";
  }
  syncProgByCol();
  syncDrawerCounts();
  renderReadView();
  if(!rt.subtasksCache.length){
    subList.innerHTML = '<div class="sub-empty">暂无检查项，输入后回车即可添加</div>';
    return;
  }
  subList.innerHTML = rt.subtasksCache.map(function(s, i){
    return '<div class="sub-item' + (s.done ? " done" : "") + '" data-sub="' + s.id + '">' +
      (rt.drawerReadOnly ? '' :
        '<button type="button" class="sub-grip" data-sub-grip="' + s.id + '" title="拖拽调整顺序，或聚焦后按 ↑/↓" aria-label="调整顺序：' + esc(s.title) + '，第 ' + (i + 1) + ' 项，共 ' + rt.subtasksCache.length + ' 项；上下方向键移动">' +
          icon("grip", 12) + '</button>') +
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
  var hintEl = $("subHint");
  if(hintEl) hintEl.hidden = true;
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
/* ---- 检查项重排：拖把手或聚焦后 ↑/↓；乐观重排，失败还原手势前顺序 ---- */
var subSortBusy = false, subSortQueued = null, subSortSnapshot = null, subDrag = null;
var subLiveEl = $("subLive");
function setSubLive(text){ if(subLiveEl) subLiveEl.textContent = text || ""; }
function focusSubGrip(id){
  var g = subList.querySelector('[data-sub-grip="' + id + '"]');
  if(g) try{ g.focus({ preventScroll:true }); }catch(e){ /* noop */ }
}
function subById(id){
  for(var i = 0; i < rt.subtasksCache.length; i++) if(rt.subtasksCache[i].id === id) return rt.subtasksCache[i];
  return null;
}
function commitSubOrder(focusId, announce){
  var ids = rt.subtasksCache.map(function(s){ return s.id; });
  if(subSortBusy){ subSortQueued = { focusId:focusId, announce:announce, taskId:rt.editingId }; return; }
  subSortBusy = true;
  var taskId = rt.editingId;
  API.post("/api/tasks/" + encodeURIComponent(taskId) + "/subtasks/reorder", { ids: ids }).then(function(list){
    subSortBusy = false;
    var q = subSortQueued; subSortQueued = null;
    /* 有排队的新手势时保留当前乐观顺序，不能被上一笔的服务端回包盖掉 */
    if(!q && rt.editingId === taskId && Array.isArray(list)) rt.subtasksCache = list;
    subSortSnapshot = null;
    if(q && rt.editingId === q.taskId){ commitSubOrder(q.focusId, q.announce); return; }
    setSubLive(announce);
  }).catch(function(ex){
    subSortBusy = false; subSortQueued = null;
    if(rt.editingId !== taskId){ subSortSnapshot = null; return; }
    if(subSortSnapshot){
      /* 只还原顺序，勾选/标题以当前缓存为准，避免复活旧状态 */
      var cur = rt.subtasksCache;
      var restored = subSortSnapshot.map(function(id){ return subById(id); }).filter(Boolean);
      cur.forEach(function(s){ if(restored.indexOf(s) < 0) restored.push(s); });
      rt.subtasksCache = restored;
      subSortSnapshot = null;
    }
    renderSubtasks(rt.subtasksCache);
    focusSubGrip(focusId);
    setSubLive("");
    toast("排序失败，已还原为原顺序：" + (ex.message || "网络异常"), "bad");
  });
}
function moveSub(id, to){
  var idx = -1;
  rt.subtasksCache.forEach(function(s, i){ if(s.id === id) idx = i; });
  if(idx < 0 || to < 0 || to >= rt.subtasksCache.length || to === idx) return false;
  /* 快照只存 id：回滚时按 id 取当前对象，勾选/标题以最新为准 */
  if(!subSortSnapshot) subSortSnapshot = rt.subtasksCache.map(function(s){ return s.id; });
  var moved = rt.subtasksCache.splice(idx, 1)[0];
  rt.subtasksCache.splice(to, 0, moved);
  renderSubtasks(rt.subtasksCache);
  focusSubGrip(id);
  return true;
}
subList.addEventListener("pointerdown", function(e){
  var g = e.target.closest("[data-sub-grip]");
  if(!g || rt.drawerReadOnly || !rt.editingId || e.button !== 0) return;
  e.preventDefault();
  subSortSnapshot = rt.subtasksCache.map(function(s){ return s.id; });
  subDrag = { id: Number(g.dataset.subGrip), row: g.closest(".sub-item") };
  subDrag.row.classList.add("dragging");
  try{ g.setPointerCapture(e.pointerId); }catch(err){ /* noop */ }
});
subList.addEventListener("pointermove", function(e){
  if(!subDrag) return;
  var rows = Array.prototype.slice.call(subList.querySelectorAll(".sub-item:not(.dragging)"));
  rows.forEach(function(r){ r.classList.remove("drop-before", "drop-after"); });
  var target = null;
  for(var i = 0; i < rows.length; i++){
    var b = rows[i].getBoundingClientRect();
    if(e.clientY < b.top + b.height / 2){ target = rows[i]; break; }
  }
  if(target){ target.classList.add("drop-before"); subList.insertBefore(subDrag.row, target); }
  else if(rows.length){ rows[rows.length - 1].classList.add("drop-after"); subList.appendChild(subDrag.row); }
});
function endSubDrag(){
  if(!subDrag) return;
  var id = subDrag.id;
  subDrag.row.classList.remove("dragging");
  Array.prototype.slice.call(subList.querySelectorAll(".sub-item")).forEach(function(r){ r.classList.remove("drop-before", "drop-after"); });
  subDrag = null;
  var order = Array.prototype.slice.call(subList.querySelectorAll(".sub-item")).map(function(el){ return Number(el.getAttribute("data-sub")); });
  rt.subtasksCache = order.map(subById).filter(Boolean);
  renderReadView();
  /* 只点了一下把手、顺序没变：不发请求也不留痕 */
  var snap = subSortSnapshot;
  if(snap && snap.length === order.length && snap.every(function(sid, i){ return sid === order[i]; })){
    subSortSnapshot = null;
    return;
  }
  var idx = order.indexOf(id), s = subById(id);
  commitSubOrder(id, s ? "已把「" + s.title + "」移到第 " + (idx + 1) + " 项，共 " + order.length + " 项" : "");
}
subList.addEventListener("pointerup", endSubDrag);
subList.addEventListener("pointercancel", endSubDrag);
subList.addEventListener("keydown", function(e){
  var g = e.target.closest("[data-sub-grip]");
  if(!g || rt.drawerReadOnly || !rt.editingId || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  e.preventDefault();
  var id = Number(g.dataset.subGrip);
  var idx = -1;
  rt.subtasksCache.forEach(function(s, i){ if(s.id === id) idx = i; });
  var to = e.key === "ArrowUp" ? idx - 1 : idx + 1;
  if(!moveSub(id, to)) return;
  var s = subById(id);
  commitSubOrder(id, "已把「" + s.title + "」移到第 " + (to + 1) + " 项，共 " + rt.subtasksCache.length + " 项");
});
/* 概览检查项也能直接勾：有检查项时进度由完成比派生，勾完进度当场重算 */
var readChecklistEl = $("readChecklist");
if(readChecklistEl){
  readChecklistEl.addEventListener("change", function(e){
    var cb = e.target.closest("[data-read-sub-toggle]");
    if(!cb || !rt.editingId) return;
    if(rt.drawerReadOnly){
      cb.checked = !cb.checked;
      toast("你对该项目只有查看权限", "warn");
      return;
    }
    var id = rt.editingId;
    cb.disabled = true;
    API.put("/api/subtasks/" + encodeURIComponent(cb.dataset.readSubToggle), {done: cb.checked}).then(function(){
      if(rt.editingId === id) loadSubtasks(id);
      loadBoard({silent:true});
      refreshListIfOpen();
      refreshGanttIfOpen();
    }).catch(function(ex){
      cb.disabled = false;
      cb.checked = !cb.checked;
      toast(ex.message || "更新失败", "bad");
    });
  });
}
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
  syncDrawerFacts();
  if(!lastAttList.length){
    attachList.innerHTML = '<div class="attach-empty">暂无附件 · 把文件拖到这里，或点下方「上传文件」（图片、PDF、Office、txt、md、zip，单个 ≤10MB）</div>';
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
/* 任务附件：点击多选与拖入共用同一上传口径（全局 attach-kit）。
   不挂粘贴：抽屉里描述编辑器 / 评论框的粘贴应留给它们自己，不能被附件抢走。 */
var attUploading = false;
function uploadTaskFiles(list){
  if(attUploading || !rt.editingId || !list || !list.length) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var res = validateFiles(list, 0);
  reportRejected(res.rejected);
  if(!res.ok.length) return;
  var id = rt.editingId;
  var path = "/api/tasks/" + encodeURIComponent(id) + "/attachments";
  attUploading = true;
  attachList.classList.add("busy");
  var uploaded = 0, failed = 0;
  var chain = Promise.resolve();
  res.ok.forEach(function(f){
    chain = chain.then(function(){
      return uploadAttachment(path, f).then(function(){ uploaded++; }, function(){ failed++; });
    });
  });
  chain.then(function(){
    attUploading = false;
    attachList.classList.remove("busy");
    if(uploaded){
      toast("已上传 " + uploaded + " 个附件" + (failed ? "，" + failed + " 个失败" : ""), failed ? "warn" : "fs");
      loadAttachments(id);
      loadBoard({silent:true});
    }else{
      toast("附件上传失败", "bad");
    }
  });
}
iAttachFile.addEventListener("change", function(){
  var files = iAttachFile.files ? Array.prototype.slice.call(iAttachFile.files) : [];
  iAttachFile.value = "";
  uploadTaskFiles(files);
});
var attDropZone = (fAttach && fAttach.querySelector(".drawer-sect-body")) || attachList;
bindFileDrop(attDropZone, uploadTaskFiles);
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
    okText: "删除附件"
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
  /* 补记、作废后「实际投入」要跟着工时汇总变，不能只刷新工时区块那一处 */
  renderActualEstimate(d.totalMinutes, rt.formEstimateMinutes);
  renderReadView();
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
function closeTimeAddInline(){
  if(dlgTimeAdd) dlgTimeAdd.hidden = true;
}
function openTimeAddInline(){
  if(!dlgTimeAdd) return;
  /* 入口可能在概览：先把执行页签与工时区展开，再在区内展开表单 */
  if(rt.editingId) setDrawerTab("exec");
  var sect = $("fWork");
  if(sect){
    sect.hidden = false;
    sect.classList.remove("collapsed");
    var head = sect.querySelector(".drawer-sect-head");
    if(head) head.setAttribute("aria-expanded", "true");
  }
  dlgTimeAdd.hidden = false;
  try{ dlgTimeAdd.scrollIntoView({ block:"nearest" }); }catch(e){ /* 老浏览器无平滑滚动 */ }
  try{ iTimeHours.focus({ preventScroll:true }); }catch(e){ try{ iTimeHours.focus(); }catch(e2){ /* noop */ } }
}
function openTimeAddDialog(){
  if(!dlgTimeAdd) return;
  if(!rt.currentUser || !rt.currentUser.id){ toast("当前账号信息缺失，无法补记", "warn"); return; }
  var html = "";
  ownerOptions().forEach(function(o){
    html += '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>';
  });
  if(iTimeUser) iTimeUser.innerHTML = html;
  if(iTimeProject){
    /* 派生口径：归属跟随工作项所属项目，只展示+跳转，不在此编辑 */
    var pid = readTask().reqId || "";
    var pname = pid ? reqNameById(pid) : "";
    var hasProj = !!(pid && pname && pname !== "无");
    iTimeProject.innerHTML = (hasProj ? assocLinkHTML("project", pid, pname) : "<span>未归类</span>")
      + '<span class="time-attr-note">'
      + (hasProj ? "跟随工作项所属项目；如需调整请修改工作项的项目" : "该工作项未归属任何项目，报表计入「未归类」")
      + "</span>";
  }
  if(iTimeDate && rt.TODAY) iTimeDate.value = rt.TODAY.getFullYear() + "-" + pad2(rt.TODAY.getMonth() + 1) + "-" + pad2(rt.TODAY.getDate());
  if(iTimeHours) iTimeHours.value = "";
  if(iTimeNote) iTimeNote.value = "";
  openTimeAddInline();
}
/* 概览工时格、「工时」区块和「实际投入」旁边各有一个补记入口，共用同一个弹窗 */
function openTimeAddFromEntry(){
  if(!rt.editingId) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  openTimeAddDialog();
}
if(btnTimerAdd) btnTimerAdd.addEventListener("click", openTimeAddFromEntry);
if(btnActualAdd) btnActualAdd.addEventListener("click", openTimeAddFromEntry);
if(rfHoursAdd) rfHoursAdd.addEventListener("click", openTimeAddFromEntry);
if(dlgTimeAddCancel){
  dlgTimeAddCancel.addEventListener("click", closeTimeAddInline);
}
if(dlgTimeAdd){
  dlgTimeAdd.addEventListener("click", function(e){
    if(e.target.closest("[data-time-add-cancel]")) closeTimeAddInline();
  });
}
/* 「计入项目」等关联 chip 会离开本面板：先收起补记，避免跳转后还停在旧表单 */
document.addEventListener("click", function(e){
  if(!dlgTimeAdd || dlgTimeAdd.hidden || !e.target.closest) return;
  if(e.target.closest("#dlgTimeAdd [data-jump-project],#dlgTimeAdd [data-jump-version],#dlgTimeAdd [data-jump-task],"
    + "#dlgTimeAdd [data-jump-demand],#dlgTimeAdd [data-jump-doc],#dlgTimeAdd [data-jump-branch],#dlgTimeAdd [data-jump-case]")) closeTimeAddInline();
}, true);
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
      closeTimeAddInline();
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
    UI.showConfirm({ title:title, msg:msg, okText: manual ? "删除补记" : "作废并移除", danger:true }).then(function(ok){
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

/* 状态只有一个入口：头部胶囊。读态下改列立即生效，和看板拖拽走同一套流转规则。
   presetReason：调用方已收集过原因（测试退回），不再二次弹窗。 */
function moveDrawerTask(toCol, presetReason){
  var id = rt.editingId;
  if(!id || !toCol) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var t = taskById(id) || taskCacheExtra[id] || {};
  var from = t.boardColumn || (iCol && iCol.value);
  if(from === toCol) return;
  var items = [{ from: from, title: t.title || (iTitle && iTitle.value) || "" }];
  var wsId = t.workspaceId || (rt.currentWs && rt.currentWs.id);
  var retried = false;
  function done(res){
    var nt = res && res.task;
    if(taskCacheExtra[id]){
      if(nt) Object.assign(taskCacheExtra[id], nt);
      taskCacheExtra[id].boardColumn = (res && res.to) || toCol;
    }
    iCol.value = (res && res.to) || toCol;
    startedDone = iCol.value === "done";
    if(rt.editingId === id){
      syncProgByCol();
      syncHeadAfterMove();
      syncTestWindow(taskCacheExtra[id]);
      renderReadView();
      syncDueNote();
      loadWorkStatus(id);
    }
    var msg = "「" + (t.title || "工作项") + "」已移到「" + drawerColMeta(iCol.value).name + "」";
    if(nt && nt.testOwner && toCol === "testing") msg += " · 测试负责人 " + nt.testOwner;
    if(res && res.autoTimerStarted) msg += " · 已开始计时";
    if(res && res.autoTimerTask) msg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
    toast(msg, "fs");
    loadRunningTimer();
    loadBoard({ animate: true, movedId: id });
    loadReqs();
    refreshListIfOpen();
    refreshGanttIfOpen();
    refreshCalendarIfOpen();
    refreshTreeIfOpen();
    refreshChainIfOpen();
    refreshAssociationViews();
    /* 我的工作列表不随看板自动刷新：抽屉里的移列/认领要显式通知它 */
    window.dispatchEvent(new CustomEvent("ds:refresh-mine"));
  }
  function send(dec){
    var body = { column: toCol };
    if(dec && dec.reason) body.reason = dec.reason;
    if(dec && dec.force) body.force = true;
    return API.post("/api/tasks/" + encodeURIComponent(id) + "/move", body).then(done);
  }
  function fail(ex){
    if(retried){ toast(ex.message || "移动失败", "bad"); return; }
    retried = true;
    serverDecision(wsId, items, toCol, ex).then(function(retry){
      if(!retry){ if(ex.code !== 412 && ex.code !== 422) toast(ex.message || "移动失败", "bad"); return; }
      send(retry).catch(function(e){ toast(e.message || "移动失败", "bad"); });
    });
  }
  guard(wsId, items, toCol, { reason: presetReason || null }).then(function(pass){
    if(!pass) return;
    send(pass).catch(fail);
  });
}
/* 测试中尚未认领（批量移入等）时一键承接：补测试负责人与开始时间 */
function claimDrawerTest(){
  var id = rt.editingId;
  if(!id) return;
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var t = taskCacheExtra[id] || taskById(id) || {};
  if((iCol && iCol.value) === "test"){ moveDrawerTask("testing"); return; }
  API.post("/api/tasks/" + encodeURIComponent(id) + "/test-claim", {}).then(function(res){
    var nt = res && res.task;
    if(nt && taskCacheExtra[id]) Object.assign(taskCacheExtra[id], nt);
    if(nt){
      populateTestOwnerSelect(nt.testOwner || "", nt.testOwnerUserId || "");
      syncTestWindow(nt);
    }
    renderReadView();
    toast("已认领测试负责人：" + ((nt && nt.testOwner) || t.testOwner || "我") + "，开始测试", "fs");
    loadBoard({animate:true, movedId:id});
    loadReqs();
    refreshListIfOpen();
    refreshGanttIfOpen();
    refreshCalendarIfOpen();
    refreshTreeIfOpen();
    refreshChainIfOpen();
    refreshAssociationViews();
    window.dispatchEvent(new CustomEvent("ds:refresh-mine"));
  }).catch(function(ex){
    toast("认领失败：" + (ex.message || "网络异常"), "bad");
  });
}
/* 测试退回：必填原因，写进移动日志并通知开发负责人 */
function rejectDrawerTest(){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  UI.showPrompt({
    title:"退回「测试中」→「进行中」",
    desc:"退回代表本轮测试结束并记录结束时间；原因会写入活动记录并通知开发负责人。",
    label:"退回原因",
    placeholder:"例如：关键用例未通过 / 缺少自测记录",
    maxLength:120,
    required:true,
    okText:"确认退回"
  }).then(function(reason){
    if(reason) moveDrawerTask("doing", reason);
  });
}
function syncHeadAfterMove(){
  syncDrawerHead();
  syncDrawerFacts();
}
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
    var to = b.dataset.drawerCol;
    UI.closeAllPops();
    /* 读态与编辑态都即时生效：底部不再有第二个状态入口 */
    moveDrawerTask(to);
  });
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
if(drawerStatusPill) drawerStatusPill.addEventListener("click", function(){ openDrawerColMenu(drawerStatusPill); });
if(btnFootStatus) btnFootStatus.addEventListener("click", function(){ openDrawerColMenu(btnFootStatus); });
/* 读态测试卡：认领 / 退回 / 通过，均按当前流转规则走 move */
var readTestClaimBtn = $("readTestClaim"), readTestRejectBtn = $("readTestReject"),
    readTestPassBtn = $("readTestPass"), readTestReassignBtn = $("readTestReassign");
if(readTestClaimBtn) readTestClaimBtn.addEventListener("click", claimDrawerTest);
if(readTestRejectBtn) readTestRejectBtn.addEventListener("click", rejectDrawerTest);
if(readTestPassBtn) readTestPassBtn.addEventListener("click", function(){ moveDrawerTask("done"); });
if(readTestReassignBtn) readTestReassignBtn.addEventListener("click", function(){ openTestOwnerPicker(readTestReassignBtn); });
var readTestHistBtn = $("readTestHistBtn");
if(readTestHistBtn) readTestHistBtn.addEventListener("click", function(){
  testHistOpen = !testHistOpen;
  renderTestHistory();
});
var readTestWhoCell = $("readTestWhoCell");
if(readTestWhoCell){
  /* 可点条件由 renderReadTestCard 的 is-clickable 统一裁决（仅测试/待测试列且可编辑）：
     done 列的历史测试卡也会渲染，若这里只判权限就会出现「看着只读却能点开改派」。 */
  readTestWhoCell.addEventListener("click", function(){ if(readTestWhoCell.classList.contains("is-clickable")) openTestOwnerPicker(readTestWhoCell); });
  readTestWhoCell.addEventListener("keydown", function(e){ if((e.key === "Enter" || e.key === " ") && readTestWhoCell.classList.contains("is-clickable")){ e.preventDefault(); openTestOwnerPicker(readTestWhoCell); } });
}

/* ==================== 概览事实条：就地编辑（单字段保存） ====================
   读态点事实 → 选值/填值 → 复用「保存并继续」提交整单后留在读态。
   只读项目/只读角色不开放任何就地入口。 */
function factSave(successMsg){
  if(!rt.editingId || rt.drawerReadOnly || !btnSaveTaskContinue) return;
  /* 上一次就地保存还在飞：排队而不是再提交一次，否则 requestSubmit 会带上被禁用的提交按钮 */
  if(btnSaveTaskContinue.disabled){ factSaveQueued = true; return; }
  if(progFactTimer){ clearTimeout(progFactTimer); progFactTimer = 0; }
  rt.formDirty = true;
  factSaving = true;
  /* 成功提示等落库后再给：失败时不能先弹一句「已更新」 */
  factSaveMsg = successMsg || "";
  factSaveView = { tab: drawerTab, scroll: drawerBodyEl ? drawerBodyEl.scrollTop : 0, depInline: depInlineOpen };
  syncDrawerFacts();
  /* 提交按钮在阅读态是 hidden，但仍属于表单；requestSubmit 会带入它的 id */
  taskForm.requestSubmit(btnSaveTaskContinue);
}
/* 就地保存失败：读态卡片不能停在没落库的新值上。以服务器为准重读回填整表，
   再回到原页签与滚动位置；编辑态失败不走这里，保留用户输入供改了再存。 */
function revertFailedFactSave(view){
  var id = rt.editingId, seq = rt.taskFormSeq;
  if(!id) return;
  var failed = "保存失败，且读不到服务器最新版本；请关闭详情后重新打开核对";
  API.get("/api/task/" + encodeURIComponent(id)).then(function(fresh){
    if(seq !== rt.taskFormSeq || rt.editingId !== id) return;
    if(!fresh){ showDrawerNotice(failed); return; }
    taskCacheExtra[id] = fresh;
    /* 明确放弃这次没落库的改动，否则 openTaskDrawer 的「同一任务不重填」守卫会跳过回填 */
    rt.formDirty = false;
    openTaskDrawer(null, fresh, { restoreView: view || null });
  }).catch(function(){
    if(seq !== rt.taskFormSeq || rt.editingId !== id) return;
    showDrawerNotice(failed);
  });
}
/* 概览进度滑块：拖动只改本地值，松手后合并提交，避免一次拖动打出一串 PUT */
var progFactTimer = 0;
function scheduleProgFactSave(){
  clearTimeout(progFactTimer);
  progFactTimer = setTimeout(function(){
    progFactTimer = 0;
    if(!rt.editingId || rt.drawerReadOnly) return;
    factSave();
  }, 300);
}
var rfProgRange = $("rfProgRange");
if(rfProgRange){
  rfProgRange.addEventListener("input", function(){
    if(rt.drawerReadOnly){ rfProgRange.value = iProg.value; return; }
    iProg.value = rfProgRange.value;
    syncProgVal();
  });
  rfProgRange.addEventListener("change", function(){ scheduleProgFactSave(); });
}
function openFactPop(el, anchor){
  UI.closeAllPops();
  UI.openPop(el, anchor, { align: "left", onClose: function(){ el.remove(); } });
}
function factMenu(title, items){
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = '<div class="menu-title">' + esc(title) + '</div>' + items;
  return el;
}
/* 浮层候选：把 ownerOptions 的合并角色拆成主岗位 + 兼岗（仅展示，不改候选口径）。 */
function ownerPickerOptions(){
  return ownerOptions().map(function(o){ return { id:o.id, name:o.name, company:o.company, role:o.primaryRole, secondary:o.secondary }; });
}
function ownerRosterState(){
  var ws = rt.currentWs, pid = currentProjectId(), key = ownerRosterKey();
  var needsRoster = !!(ws && ws.type === "shared" && pid);
  var error = needsRoster && projectRoleErrors[key];
  var pending = needsRoster && !peekProjectMembers(ws.id, pid) && !error;
  return { pending:pending, error:error };
}
function selectedOwnerInfo(sel){
  var opt = sel ? sel.options[sel.selectedIndex] : null;
  var id = opt && opt.value !== "__none__" && opt.value !== "__text__" ? opt.value : "";
  var name = opt ? (opt.dataset.name !== undefined ? opt.dataset.name : opt.textContent) : "";
  var unavailable = opt && opt.dataset.unavailable && id ? { id:id, name:name } : null;
  return { id:id, name:name, unavailable:unavailable };
}
var ownerPickerRef = null, testPickerRef = null;
function buildOwnerPickerCfg(anchor){
  var st = ownerRosterState(), cur = selectedOwnerInfo(iOwner);
  return {
    anchor:anchor, title:"负责人",
    options:st.pending || st.error ? [] : ownerPickerOptions(),
    currentId:cur.id, currentName:cur.name, unavailable:cur.unavailable,
    allowClear:true, clearLabel:"未分配",
    loading:st.pending, error:st.error ? (st.error.message || "网络异常") : "",
    onRetry:function(){ ensureProjectRoles(currentProjectId(), true); refreshOwnerPicker(); },
    onPick:function(o){
      var nextId = o ? o.id : "";
      if((iOwner.value || "") === nextId) return;
      iOwner.value = nextId;
      factSave();
    }
  };
}
function refreshOwnerPicker(){
  if(ownerPickerRef && UI.popOpen(ownerPickerRef.el)){
    var cfg = buildOwnerPickerCfg(ownerPickerRef.anchor);
    ownerPickerRef.refresh({ options:cfg.options, currentId:cfg.currentId, currentName:cfg.currentName, unavailable:cfg.unavailable, loading:cfg.loading, error:cfg.error });
  }
}
function openOwnerFact(anchor){
  var cfg = buildOwnerPickerCfg(anchor);
  ownerPickerRef = openPeoplePicker(cfg);
  if(ownerPickerRef) ownerPickerRef.anchor = anchor;
  if(cfg.loading) ensureProjectRoles(currentProjectId());
}
function buildTestPickerCfg(anchor){
  var st = ownerRosterState(), cur = selectedOwnerInfo($("iTestOwner"));
  return {
    anchor:anchor, title:"测试负责人",
    options:st.pending || st.error ? [] : ownerPickerOptions(),
    currentId:cur.id, currentName:cur.name, unavailable:cur.unavailable,
    allowClear:true, clearLabel:"待领取（不指定）",
    foot:"<b>岗位</b> = 本项目有效岗位；测试负责人与开发负责人共用候选。仅展示，不改变权限。",
    loading:st.pending, error:st.error ? (st.error.message || "网络异常") : "",
    onRetry:function(){ ensureProjectRoles(currentProjectId(), true); refreshTestPicker(); },
    onPick:function(o){
      var nextId = o ? o.id : "";
      var sel = $("iTestOwner");
      if(sel && (sel.value || "") === nextId) return;
      populateTestOwnerSelect(o ? o.name : "", o ? o.id : "");
      factSave();
    }
  };
}
function refreshTestPicker(){
  if(testPickerRef && UI.popOpen(testPickerRef.el)){
    var cfg = buildTestPickerCfg(testPickerRef.anchor);
    testPickerRef.refresh({ options:cfg.options, currentId:cfg.currentId, currentName:cfg.currentName, unavailable:cfg.unavailable, loading:cfg.loading, error:cfg.error });
  }
}
function openTestOwnerPicker(anchor){
  if(rt.drawerReadOnly || !rt.editingId){ toast("你对该项目只有查看权限", "warn"); return; }
  var cfg = buildTestPickerCfg(anchor);
  testPickerRef = openPeoplePicker(cfg);
  if(testPickerRef) testPickerRef.anchor = anchor;
  if(cfg.loading) ensureProjectRoles(currentProjectId());
}
function openPriFact(anchor){
  var el = factMenu("优先级", PRIORITIES.map(function(p){
    return '<button class="menu-item" type="button" data-fact-pri="' + p + '">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(priColor(p)) + '"></span>' +
      p + ' · ' + esc(priName(p)) + (rt.formPri === p ? '<span class="k">当前</span>' : '') + '</button>';
  }).join(""));
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-fact-pri]");
    if(!b) return;
    UI.closeAllPops();
    if(rt.formPri === b.dataset.factPri) return;
    rt.formPri = b.dataset.factPri;
    syncFormSegs();
    factSave();
  });
  openFactPop(el, anchor);
}
function openTypeFact(anchor){
  var el = factMenu("类型", ["task","story","bug","epic"].map(function(v){
    var m = TYPE_META[v];
    return '<button class="menu-item" type="button" data-fact-type="' + v + '">' + esc(m.name) +
      ((iItemType && iItemType.value || "task") === v ? '<span class="k">当前</span>' : '') + '</button>';
  }).join(""));
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-fact-type]");
    if(!b) return;
    UI.closeAllPops();
    var v = b.dataset.factType;
    if(!iItemType || iItemType.value === v) return;
    iItemType.value = v;
    syncTypeButtons();
    syncDefectFields();
    if(v === "bug" && !(iSeverity && iSeverity.value)){
      toast("缺陷必须选择严重度，已打开编辑", "warn");
      enterDrawerEdit();
      setTimeout(function(){ try{ $("fSeverity").scrollIntoView({ block: "center" }); }catch(err){} }, 80);
      return;
    }
    factSave();
  });
  openFactPop(el, anchor);
}
function openCategoryFact(anchor){
  var reqId = currentReqId();
  var cats = projCats(reqId);
  if(!reqId){ toast("先选择所属项目，再指定分类", "warn"); return; }
  if(!cats.length){
    toast(canEditReq(reqId) ? "该项目还没有分类，可在项目设置里添加" : "该项目还没有分类，请联系项目负责人添加", "warn");
    return;
  }
  var items = '<button class="menu-item" type="button" data-fact-cat="">' +
    '未分类' + (!rt.formCat ? '<span class="k">当前</span>' : '') + '</button>' +
    cats.map(function(c){
      return '<button class="menu-item" type="button" data-fact-cat="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:2px;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + (rt.formCat === c.id ? '<span class="k">当前</span>' : '') + '</button>';
    }).join("");
  var el = factMenu("分类", items);
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-fact-cat]");
    if(!b) return;
    UI.closeAllPops();
    var v = b.dataset.factCat || "";
    if(v === (rt.formCat || "")) return;
    rt.formCat = v;
    syncCatSeg();
    factSave();
  });
  openFactPop(el, anchor);
}
function openProjectFact(anchor){
  /* 后端按「任意正式发布记录」拒绝换项目（含失败 / 测试 / 回滚），比 everPublished 宽。
     这里只提前拦掉必然失败的那部分：everPublished 为真，或已读到本任务的发布记录。
     记录还没读回来时不拦，交给后端裁决——保存失败会回滚表单，不会留下假关联。 */
  var editing = rt.editingId ? readTask() : null;
  var seenRecords = releaseRecordGuard.taskId === rt.editingId && releaseRecordGuard.count > 0;
  if(editing && (editing.everPublished || seenRecords)){
    toast("任务已有正式发布记录，不能改变项目；执行状态仍可独立调整", "warn");
    return;
  }
  var el = factMenu("所属项目", Array.prototype.map.call(iReq.options, function(o){
    return '<button class="menu-item" type="button" data-fact-req="' + esc(o.value) + '">' +
      esc(o.textContent || "未归属") + (iReq.value === o.value ? '<span class="k">当前</span>' : '') + '</button>';
  }).join(""));
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-fact-req]");
    if(!b) return;
    var next = b.dataset.factReq || "";
    UI.closeAllPops();
    if(next === (iReq.value || "")) return;
    if(next && !canEditReq(next)){ toast("你对该项目没有写权限", "warn"); return; }
    var hasDemand = !!($("iDemand") && $("iDemand").value);
    UI.showConfirm({
      title: "切换所属项目？",
      msg: hasDemand
        ? "切换后会解除当前需求关联，并按新项目重载分类、计划版本与负责人候选。"
        : "切换后会按新项目重载分类、计划版本与负责人候选。",
      okText: "切换项目"
    }).then(function(ok){
      if(!ok || !rt.editingId) return;
      var view = { tab: drawerTab, scroll: drawerBodyEl ? drawerBodyEl.scrollTop : 0 };
      iReq.value = next;
      iReq.dispatchEvent(new Event("change", { bubbles: true }));
      var tries = 0;
      (function waitVersionReady(){
        if(!rt.editingId || rt.drawerReadOnly) return;
        var vs = $("iVersion");
        if(vs && vs.getAttribute("data-ready")){ factSave(); return; }
        if(++tries > 80){
          /* 版本候选没回来就不能整单保存：表单停在改选后的项目上是假关联，直接还原 */
          toast("计划版本加载失败，项目未切换，已还原为原项目", "warn");
          revertFailedFactSave(view);
          return;
        }
        setTimeout(waitVersionReady, 100);
      })();
    });
  });
  openFactPop(el, anchor);
}
/* 关联卡依赖汇总：按当前工作项统计前置 / 后置条数（depState 打开抽屉即加载） */
function depAssocCounts(){
  var cur = rt.editingId, pred = 0, succ = 0;
  (depState.edges || []).forEach(function(e){
    if(e.to && e.to.id === cur) pred++;
    else if(e.from && e.from.id === cur) succ++;
  });
  return { pred:pred, succ:succ, total:pred + succ };
}
/* 依赖就地编辑：把执行页那张依赖卡整体搬进关联卡——同一份 DOM 与 depState，
   类型 / 滞后 / 增删的即时保存与甘特联动都不复刻；收起时搬回执行页原位。 */
var depInlineOpen = false;
function syncDepInlineAffordance(){
  var btn = $("btnDepInlineClose");
  if(btn) btn.hidden = !depInlineOpen;
  var dl = $("readAssoc");
  var pencil = dl ? dl.querySelector('[data-assoc-edit="deps"]') : null;
  if(pencil){
    pencil.setAttribute("aria-expanded", depInlineOpen ? "true" : "false");
    pencil.title = depInlineOpen ? "收起依赖编辑" : "就地编辑依赖（即时生效，联动甘特）";
  }
}
function closeDepInline(){
  if(!depInlineOpen) return;
  depInlineOpen = false;
  var card = $("fDeps");
  if(card){
    card.classList.remove("dep-card-inline");
    var exec = $("paneExec"), box = exec ? exec.querySelector(".stack") : null;
    /* 依赖卡原本就是执行页最后一张，append 即回原位 */
    if(box) box.appendChild(card);
  }
  closeDepPicker();
  if(drawerMode === "read") renderReadAssoc();
  syncDepInlineAffordance();
  if(drawerMode === "read" && drawerTab === "rel"){
    var dl = $("readAssoc"), pencil = dl ? dl.querySelector('[data-assoc-edit="deps"]') : null;
    if(pencil) try{ pencil.focus({ preventScroll:true }); }catch(e){ /* noop */ }
  }
}
function openDepSection(noScroll){
  /* 只读项目也展开：控件由 syncDepControls 锁住，页脚说明只读，至少还能就地看清依赖 */
  if(!rt.editingId) return;
  var card = $("fDeps"), host = $("readAssocCard");
  if(!card || !host) return;
  if(drawerTab !== "rel") setDrawerTab("rel");
  depInlineOpen = true;
  card.classList.add("dep-card-inline");
  host.appendChild(card);
  renderDeps();
  syncDepInlineAffordance();
  if(noScroll) return;
  setTimeout(function(){
    if(depInlineOpen && $("fDeps") === card){
      try{ card.scrollIntoView({ block:"nearest" }); }catch(e){ /* noop */ }
    }
  }, 0);
}
/* 候选行状态标签文案：与需求池 COLS / 分支 BRANCH_STATUS 同口径，颜色见 components.css .sp-tag.* */
var DEMAND_ST_LABEL = { review:"待评审", pass:"已通过", plan:"已排期", done:"已完成", closed:"已关闭" };
var BRANCH_ST_LABEL = { dev:"开发中", testing:"待测试", merging:"待合并", released:"已发布", arch:"已归档" };
/* 关联就地编辑（P4）：需求 / 分支。候选取自抽屉已加载的 iDemand / iBranch 下拉，
   复用 search-picker 骨架与 factSave 整表保存；选中即写回下拉 + 自动保存，失败由表单保存回滚。
   值本身的跳转仍由 data-ev-* 委托处理，铅笔只负责改。 */
function openAssocFact(kind, anchor){
  if(rt.drawerReadOnly || !rt.editingId){ toast("你对该项目只有查看权限", "warn"); return; }
  if(kind === "project"){ openProjectFact(anchor); return; }
  if(kind === "deps"){ if(depInlineOpen) closeDepInline(); else openDepSection(); return; }
  var isDemand = kind === "demand";
  var sel = $(isDemand ? "iDemand" : "iBranch");
  if(!sel) return;
  var title = isDemand ? "关联需求" : "所属分支";
  var clearLabel = isDemand ? "不关联" : "未设置";
  var foot = isDemand
    ? "候选来自当前项目；已关闭、已完成需求不作为新关联。选中即保存。"
    : "候选来自当前项目分支；归档分支已标注。选中即保存。";
  var query = "";
  var el = document.createElement("div");
  el.className = "menu search-picker assoc-picker";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", title);
  el.innerHTML =
    '<div class="search-picker-head">' +
      '<div class="search-picker-search">' + icon("search", 15) +
        '<input type="text" placeholder="' + (isDemand ? "搜索需求标题…" : "搜索分支名 / 目标分支…") + '" aria-label="' + esc(title) + '" role="combobox" aria-expanded="true" autocomplete="off" spellcheck="false">' +
        '<button class="pp-clear-search" type="button" aria-label="清除搜索" hidden>' + icon("close", 12) + '</button>' +
      '</div>' +
      '<div class="search-picker-tools"><span class="pp-count" aria-live="polite"></span></div>' +
    '</div>' +
    '<div class="search-picker-results" role="listbox" aria-label="' + esc(title) + '"></div>' +
    '<div class="search-picker-foot">' + esc(foot) + '</div>';
  var input = el.querySelector("input"), clearSearch = el.querySelector(".pp-clear-search");
  var results = el.querySelector(".search-picker-results"), count = el.querySelector(".pp-count");

  function ready(){ return sel.getAttribute("data-ready") === "1"; }
  function options(){
    var out = [];
    Array.prototype.forEach.call(sel.options, function(o){
      if(o.disabled || o.value === "") return;   // 占位项（加载中 / 仅显示前 N 条）与清除项不进入候选
      var label = (o.textContent || "").trim();
      var status = o.getAttribute("data-status") || "";
      if(isDemand){
        out.push({ id:o.value, label:label, title:label.replace(/（[^）]*）\s*$/, "").trim() || label,
          status:status, released:/已发布/.test(label) });
      }else{
        var target = o.getAttribute("data-target") || "";
        var btitle = target ? label.split(" → ")[0].trim() : label.replace(/（[^）]*）\s*$/, "").trim();
        out.push({ id:o.value, label:label, title:btitle || label, status:status, target:target });
      }
    });
    return out;
  }
  function matches(o){
    var q = query.trim().toLowerCase();
    return !q || o.label.toLowerCase().indexOf(q) !== -1;
  }
  function statusLabel(s){ return (isDemand ? DEMAND_ST_LABEL : BRANCH_ST_LABEL)[s] || ""; }
  function optHTML(o, curId){
    var on = curId === o.id;
    var st = statusLabel(o.status);
    var meta = st ? '<span class="sp-tag ' + esc(o.status) + '">' + esc(st) + '</span>' : "";
    if(isDemand && o.released) meta += '<span class="sp-tag pass">已发布</span>';
    if(!isDemand && o.target) meta += '<span class="sp-target">→ ' + esc(o.target) + '</span>';
    return '<button class="search-picker-option' + (on ? " selected" : "") + '" type="button" role="option" aria-selected="' + on + '" data-pick="' + esc(o.id) + '">' +
      '<span class="sp-ico ' + (isDemand ? "demand" : "branch") + '" aria-hidden="true">' + icon(isDemand ? "demand" : "branch", 15) + '</span>' +
      '<span class="search-picker-option-main"><span class="sp-title">' + esc(o.title) + '</span>' +
        (meta ? '<span class="sp-meta">' + meta + '</span>' : '') + '</span>' +
      (on ? '<span class="pp-check">' + icon("check", 14) + '当前</span>' : '') + '</button>';
  }
  function render(){
    clearSearch.hidden = !query;
    var curId = sel.value || "";
    if(!ready()){
      count.innerHTML = '<span class="pp-title">' + esc(title) + '</span>候选加载中…';
      results.innerHTML = '<div class="search-picker-empty">正在加载' + esc(title) + '候选…</div>';
      return;
    }
    var opts = options(), filtered = opts.filter(matches), html = "";
    if(!query.trim()){
      var noneOn = !curId;
      html += '<button class="search-picker-clear' + (noneOn ? " selected" : "") + '" type="button" role="option" aria-selected="' + noneOn + '" data-pick="">' +
        '<span class="ci" aria-hidden="true">' + icon("ban", 14) + '</span><span>' + esc(clearLabel) + '</span>' +
        (noneOn ? '<span class="pp-check" style="margin-left:auto">' + icon("check", 14) + '当前</span>' : '') + '</button>';
    }
    filtered.forEach(function(o){ html += optHTML(o, curId); });
    if(!filtered.length){
      html = '<div class="search-picker-empty">没有匹配「' + esc(query.trim()) + '」的' + (isDemand ? "需求" : "分支") +
        '<br><button class="btn sm" type="button" data-clearq>清除搜索</button></div>';
    }
    results.innerHTML = html;
    count.innerHTML = '<span class="pp-title">' + esc(title) + '</span>' +
      (query.trim() ? ("匹配 " + filtered.length + " 条") : (opts.length + " 条候选"));
  }
  function commit(id){
    var next = id || "";
    if((sel.value || "") === next){ UI.closeAllPops(); return; }
    sel.value = next;
    sel.dispatchEvent(new Event("change", { bubbles:true }));
    if(isDemand){ rt.formDemandId = next || null; syncAssocViewBtns(); }
    else syncAssocMore();
    UI.closeAllPops();
    var hit = options().filter(function(o){ return o.id === next; })[0];
    factSave("已更新" + title + "：" + (hit ? hit.label : clearLabel));
  }
  input.addEventListener("input", function(){ query = input.value; render(); });
  clearSearch.addEventListener("click", function(){ input.value = ""; query = ""; render(); input.focus(); });
  results.addEventListener("click", function(e){
    if(e.target.closest("[data-clearq]")){ input.value = ""; query = ""; render(); input.focus(); return; }
    var b = e.target.closest("[data-pick]");
    if(b && !b.disabled) commit(b.dataset.pick);
  });
  el.addEventListener("keydown", function(e){
    if(e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End"){
      var btns = Array.prototype.slice.call(results.querySelectorAll(".search-picker-option,.search-picker-clear"));
      if(!btns.length) return;
      e.preventDefault();
      var i = btns.indexOf(document.activeElement), next;
      if(e.key === "Home") next = 0;
      else if(e.key === "End") next = btns.length - 1;
      else if(e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % btns.length;
      else next = i <= 0 ? btns.length - 1 : i - 1;
      btns[next].focus();
    }
  });
  /* 候选异步就绪后就地刷新（与 syncAssocMore 同样监听 data-ready） */
  var mo = null;
  if(!ready()){
    if(isDemand) ensureDemand(rt.formDemandId || "");
    else ensureBranch(sel.value || "", currentReqId());
    if(window.MutationObserver){
      mo = new MutationObserver(function(){ if(ready()){ render(); if(mo){ mo.disconnect(); mo = null; } } });
      mo.observe(sel, { attributes:true, attributeFilter:["data-ready"], childList:true });
    }
  }
  UI.openPop(el, anchor, {
    align:"left", width:Math.min(344, window.innerWidth - 24), sheet:true,
    onClose:function(){ if(mo) mo.disconnect(); el.remove(); }
  });
  render();
  setTimeout(function(){ if(UI.popOpen(el)) input.focus(); }, 40);
}
/* 计划版本就地编辑：多选，勾选只改本地态，保存才写回；确实变更时沿用整单保存里的
   「版本调整理由」必填流程，保存后回到读态同一位置。 */
function openVersionAssocPicker(anchor){
  if(rt.drawerReadOnly || !rt.editingId){ toast("你对该项目只有查看权限", "warn"); return; }
  var sel = $("iVersion");
  if(!sel) return;
  var chosen = selectedVersionIds(sel);
  var query = "";
  var el = document.createElement("div");
  el.className = "menu search-picker assoc-picker ver-picker";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "计划版本");
  el.innerHTML =
    '<div class="search-picker-head">' +
      '<div class="search-picker-search">' + icon("search", 15) +
        '<input type="text" placeholder="搜索版本…" aria-label="搜索版本" role="combobox" aria-expanded="true" autocomplete="off" spellcheck="false">' +
        '<button class="pp-clear-search" type="button" aria-label="清除搜索" hidden>' + icon("close", 12) + '</button>' +
      '</div>' +
      '<div class="search-picker-tools"><span class="pp-count" aria-live="polite"></span></div>' +
    '</div>' +
    '<div class="search-picker-results" role="listbox" aria-multiselectable="true" aria-label="计划版本"></div>' +
    '<div class="pp-foot-actions">' +
      '<button class="btn sm" type="button" data-ver-cancel>取消</button>' +
      '<button class="btn sm primary" type="button" data-ver-save>保存</button>' +
    '</div>' +
    '<div class="search-picker-foot">全部取消即「待规划」；改动需填写版本调整理由。</div>';
  var input = el.querySelector("input"), clearSearch = el.querySelector(".pp-clear-search");
  var results = el.querySelector(".search-picker-results"), count = el.querySelector(".pp-count");
  var saveBtn = el.querySelector("[data-ver-save]");
  function ready(){ return sel.getAttribute("data-ready") === "1"; }
  var STATUS_TEXT = { planned:"计划中", active:"进行中", released:"已发布", closed:"已关闭", canceled:"已取消" };
  function options(){
    return Array.prototype.slice.call(sel.options).filter(function(o){ return o.value; })
      .map(function(o){ return { id:o.value, label:(o.textContent || "").trim(), locked:!!o.disabled, status:o.getAttribute("data-vstatus") || "" }; });
  }
  function render(){
    clearSearch.hidden = !query;
    if(!ready()){
      results.innerHTML = '<div class="search-picker-empty">正在加载计划版本候选…</div>';
      count.innerHTML = '候选来自当前项目 · 加载中…';
      saveBtn.disabled = true;
      return;
    }
    saveBtn.disabled = false;
    var q = query.trim().toLowerCase();
    var list = options().filter(function(o){ return !q || o.label.toLowerCase().indexOf(q) !== -1; });
    count.innerHTML = '候选来自当前项目 · 已选 ' + chosen.length + ' 项';
    results.innerHTML = list.length ? list.map(function(o){
      var on = chosen.indexOf(o.id) !== -1;
      var stText = STATUS_TEXT[o.status] || "";
      var meta = stText ? '<span class="sp-meta"><span class="sp-tag ' + esc(o.status) + '">' + esc(stText) + '</span></span>' : '';
      if(o.locked){
        /* 只读/不可见版本不可改选，但必须列出来，否则「已选 N 项」和勾选状态对不上 */
        return '<button class="search-picker-option selected is-locked" type="button" role="option" aria-selected="true" aria-disabled="true" disabled title="只读或不可见版本，锁定保留关联">' +
          '<span class="pp-box" aria-hidden="true"></span>' +
          '<span class="search-picker-option-main"><span class="search-picker-option-title">' + esc(o.label) + '</span>' + meta + '</span>' +
          '<span class="pp-lock" aria-hidden="true">' + icon("lock", 12) + '</span>' +
        '</button>';
      }
      return '<button class="search-picker-option' + (on ? " selected" : "") + '" type="button" role="option" aria-selected="' + on + '" data-ver-pick="' + esc(o.id) + '">' +
        '<span class="pp-box" aria-hidden="true"></span>' +
        '<span class="search-picker-option-main"><span class="search-picker-option-title">' + esc(o.label) + '</span>' + meta + '</span>' +
      '</button>';
    }).join("") : '<div class="search-picker-empty">没有匹配「' + esc(query.trim()) + '」的版本' +
        '<br><button class="btn sm" type="button" data-clearq>清除搜索</button></div>';
  }
  function commit(){
    if(!ready()) return;
    var same = sameIds(chosen, selectedVersionIds(sel));
    UI.closeAllPops();
    if(same) return;
    /* 只改候选里可见的选项，加载失败/归档而暂未列出的关联保持原状 */
    Array.prototype.forEach.call(sel.options, function(o){
      if(o.disabled || !o.value) return;
      o.selected = chosen.indexOf(o.value) !== -1;
    });
    var reason = $("iVersionChangeReason");
    if(reason) reason.value = "";
    factSave();
  }
  input.addEventListener("input", function(){ query = input.value; render(); });
  clearSearch.addEventListener("click", function(){ input.value = ""; query = ""; render(); input.focus(); });
  input.addEventListener("keydown", function(e){
    if(e.key !== "ArrowDown") return;
    var first = results.querySelector(".search-picker-option:not([disabled])");
    if(first){ e.preventDefault(); first.focus(); }
  });
  results.addEventListener("click", function(e){
    if(e.target.closest("[data-clearq]")){ input.value = ""; query = ""; render(); input.focus(); return; }
    var b = e.target.closest("[data-ver-pick]");
    if(!b) return;
    var id = b.getAttribute("data-ver-pick");
    var i = chosen.indexOf(id);
    if(i === -1) chosen.push(id); else chosen.splice(i, 1);
    render();
    var again = results.querySelector('[data-ver-pick="' + id + '"]');
    if(again) again.focus();
  });
  el.querySelector("[data-ver-cancel]").addEventListener("click", function(){ UI.closeAllPops(); });
  saveBtn.addEventListener("click", commit);
  var mo = null;
  if(!ready()){
    ensureVersion(chosen, rt.editingId);
    if(window.MutationObserver){
      mo = new MutationObserver(function(){ if(ready()){ render(); if(mo){ mo.disconnect(); mo = null; } } });
      mo.observe(sel, { attributes:true, attributeFilter:["data-ready"], childList:true });
    }
  }
  UI.openPop(el, anchor, {
    align:"left", width:Math.min(344, window.innerWidth - 24), sheet:true,
    onClose:function(){ if(mo) mo.disconnect(); el.remove(); }
  });
  render();
  setTimeout(function(){ if(UI.popOpen(el)) input.focus(); }, 40);
}
function openDateRangeFact(anchor){
  var el = document.createElement("div");
  el.className = "menu";
  el.style.width = "260px";
  el.innerHTML = '<div class="menu-title">计划时间</div>' +
    '<div class="menu-field"><label class="menu-label" for="factStartInput">开始</label>' +
      '<input class="input" id="factStartInput" type="date" data-fact-start value="' + esc(iStart.value || "") + '"></div>' +
    '<div class="menu-field"><label class="menu-label" for="factDueInput">截止</label>' +
      '<input class="input" id="factDueInput" type="date" data-fact-due value="' + esc(iDue.value || "") + '"></div>' +
    '<div class="hint" style="padding:0 6px 8px">开始可留空；截止不能早于开始。</div>' +
    '<div class="menu-foot"><button class="btn sm" type="button" data-fact-date-clear>清空</button>' +
    '<button class="btn sm primary" type="button" data-fact-date-ok>保存</button></div>';
  var sIn = el.querySelector("[data-fact-start]"), dIn = el.querySelector("[data-fact-due]");
  function commit(sv, dv){
    if(sv && dv && sv > dv){ toast("开始日期不能晚于截止日期", "bad"); return; }
    if((iStart.value || "") === sv && (iDue.value || "") === dv){ UI.closeAllPops(); return; }
    iStart.value = sv;
    iDue.value = dv;
    syncDateBounds();
    UI.closeAllPops();
    factSave();
  }
  el.querySelector("[data-fact-date-ok]").addEventListener("click", function(){ commit(sIn.value || "", dIn.value || ""); });
  el.querySelector("[data-fact-date-clear]").addEventListener("click", function(){ commit("", ""); });
  [sIn, dIn].forEach(function(inp){
    inp.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); commit(sIn.value || "", dIn.value || ""); }
    });
  });
  openFactPop(el, anchor);
  setTimeout(function(){ try{ sIn.focus(); }catch(e){} }, 30);
}
function openEstimateFact(anchor){
  var el = document.createElement("div");
  el.className = "menu";
  el.style.width = "236px";
  el.innerHTML = '<div class="menu-title">预估工时</div>' +
    '<div class="menu-field"><div class="est-wrap"><input class="input" id="factEstInput" type="number" min="0" max="168" step="0.5" ' +
      'value="' + esc(iEstimate && iEstimate.value ? iEstimate.value : "") + '" aria-label="预估工时（小时）">' +
      '<span class="est-unit">小时</span></div>' +
      '<div class="hint" style="margin-top:6px">留空或 0 表示不预估</div></div>' +
    '<div class="menu-foot"><button class="btn sm" type="button" data-fact-est-clear>清空</button>' +
    '<button class="btn sm primary" type="button" data-fact-est-ok>保存</button></div>';
  var input = el.querySelector("#factEstInput");
  function commit(v){
    var h = Number(v);
    if(!isFinite(h) || h < 0) h = 0;
    if(h > 168) h = 168;
    var curH = Math.max(0, Number(iEstimate && iEstimate.value) || 0);
    if(Math.abs(curH - h) < 0.001){ UI.closeAllPops(); return; }
    if(iEstimate) iEstimate.value = h ? h : "";
    UI.closeAllPops();
    factSave();
  }
  el.querySelector("[data-fact-est-ok]").addEventListener("click", function(){ commit(input.value); });
  el.querySelector("[data-fact-est-clear]").addEventListener("click", function(){ commit(0); });
  input.addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); commit(input.value); }
  });
  openFactPop(el, anchor);
  setTimeout(function(){ try{ input.focus(); input.select(); }catch(e){} }, 30);
}
function openTagsFact(){
  UI.showPrompt({
    title: "编辑标签",
    desc: "用逗号分隔，最多 8 个，每个不超过 16 字；留空即清除。",
    value: (rt.tagsCache || []).join(","),
    placeholder: "例如：支付、P0、线上问题",
    maxLength: 160,
    required: false,
    okText: "保存标签"
  }).then(function(v){
    if(v === null || !rt.editingId) return;
    var out = [], seen = Object.create(null);
    String(v).split(/[,，、\s]+/).forEach(function(tg){
      tg = tg.trim().slice(0, 16);
      if(!tg || seen[tg] || out.length >= 8) return;
      seen[tg] = true;
      out.push(tg);
    });
    if(out.join("\u0001") === (rt.tagsCache || []).join("\u0001")) return;
    rt.tagsCache = out;
    renderTagChips();
    factSave();
  });
}
/* 阻塞是整单保存里的一个字段：读态切换后走同一条保存链路，计时联动与审计照旧 */
function applyBlockedState(blocked, reason, okMsg){
  if(!iBlocked) return;
  iBlocked.checked = !!blocked;
  if(iBlockedReason){
    iBlockedReason.disabled = !blocked;
    iBlockedReason.value = blocked ? (reason || "") : "";
  }
  syncMoreSummary();
  renderReadBlocked();
  factSave(okMsg);
}
function openBlockedFact(){
  if(!rt.editingId) return;
  var blocked = !!(iBlocked && iBlocked.checked);
  var reason = (iBlockedReason && iBlockedReason.value || "").trim();
  if(blocked){
    UI.showConfirm({
      title:"解除阻塞",
      msg: reason ? "当前卡点：" + esc(reason) : "当前工作项处于阻塞状态（未填写原因）。",
      okText:"解除阻塞",
      cancelText:"保持阻塞",
      danger:false
    }).then(function(ok){
      if(!ok || !rt.editingId) return;
      applyBlockedState(false, "", "已解除阻塞");
    });
    return;
  }
  UI.showPrompt({
    title:"标记阻塞",
    desc:"说明卡在什么上、等谁、预计何时解除；原因可留空。标记后会停止该工作项上的运行中计时，并在卡片上显示橙色条纹。",
    value:"",
    placeholder:"等谁 / 等什么 / 预计何时解除",
    maxLength:120,
    required:false,
    okText:"标记阻塞"
  }).then(function(v){
    if(v === null || !rt.editingId) return;
    applyBlockedState(true, v, "已标记阻塞");
  });
}
function openFactEditor(kind, anchor){
  if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!rt.editingId) return;
  if(kind === "owner") openOwnerFact(anchor);
  else if(kind === "pri") openPriFact(anchor);
  else if(kind === "type") openTypeFact(anchor);
  else if(kind === "category") openCategoryFact(anchor);
  else if(kind === "project") openProjectFact(anchor);
  else if(kind === "dateRange") openDateRangeFact(anchor);
  else if(kind === "estimate") openEstimateFact(anchor);
  else if(kind === "tags") openTagsFact();
  else if(kind === "blocked") openBlockedFact();
}
var readBlockedClearBtn = $("readBlockedClear");
if(readBlockedClearBtn){
  readBlockedClearBtn.addEventListener("click", function(){
    if(rt.drawerReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
    openBlockedFact();
  });
}
var readFactsBox = $("readFacts");
if(readFactsBox){
  readFactsBox.addEventListener("click", function(e){
    var goto = e.target.closest("[data-fact-goto]");
    if(goto && rt.editingId){
      if(goto.dataset.factGoto === "checklist"){
        var card = $("readChecklistCard");
        if(card){ try{ card.scrollIntoView({ behavior:"smooth", block:"center" }); }catch(err){ try{ card.scrollIntoView(); }catch(e){} } }
        return;
      }
      if(goto.dataset.factGoto === "doc"){
        var docGo = $("iReqDoc") ? ($("iReqDoc").value || "") : "";
        if(docGo){
          import("../views/requirements.js").then(function(m){ m.openReqDocInNewTab(docGo); });
        }else{
          enterDrawerEdit();
          setDrawerTab("rel");
          setTimeout(function(){
            var picker = $("iReqDocPicker");
            var det = picker && picker.closest ? picker.closest("details") : null;
            if(det) det.open = true;
            if(picker){
              try{ picker.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(err){ try{ picker.scrollIntoView(); }catch(e){} }
              try{ picker.focus({ preventScroll:true }); }catch(err){}
            }
          }, 90);
        }
        return;
      }
      setDrawerTab("exec");
      setTimeout(function(){ try{ fAttach.scrollIntoView({ block: "start" }); }catch(err){} }, 60);
      return;
    }
    var jump = e.target.closest("[data-fact-jump]");
    if(jump && rt.editingId){
      enterDrawerEdit();
      /* 计划版本在「关联」页签里编辑：直接切过去，少一次找入口 */
      if(jump.dataset.factJump === "version") setDrawerTab("rel");
      setTimeout(function(){
        var target = jump.dataset.factJump === "version" ? $("iVersion") : null;
        if(!target) return;
        try{ target.scrollIntoView({ block: "center" }); }catch(err){}
        /* 版本候选在换项目后异步重载，disabled 期间 focus 不生效，就绪后再聚焦 */
        var tries = 0;
        (function focusReady(){
          if(!target.isConnected || rt.drawerReadOnly) return;
          if(target.disabled && ++tries < 30){ setTimeout(focusReady, 100); return; }
          try{ target.focus({ preventScroll: true }); }catch(err){}
        })();
      }, 90);
      return;
    }
    var fact = e.target.closest("[data-fact-edit]");
    if(!fact) return;
    openFactEditor(fact.dataset.factEdit, fact);
  });
  readFactsBox.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var goto = e.target.closest("[data-fact-goto]");
    if(goto){ e.preventDefault(); goto.click(); return; }
    var jump = e.target.closest("[data-fact-jump]");
    if(jump){ e.preventDefault(); jump.click(); return; }
    var fact = e.target.closest("[data-fact-edit]");
    if(!fact) return;
    e.preventDefault();
    openFactEditor(fact.dataset.factEdit, fact);
  });
}

/* 交付证据 / 关联摘要的点击穿透：跨视图目标用动态 import，避免与 views 形成加载环 */
function evDrill(el){
  var demandId = el.getAttribute("data-ev-demand");
  if(demandId){ import("../views/demands.js").then(function(m){ m.openDemandDetailById(demandId); }); return; }
  var docId = el.getAttribute("data-ev-doc");
  if(docId){ import("../views/requirements.js").then(function(m){ m.openReqDocInNewTab(docId); }); return; }
  var epicId = el.getAttribute("data-ev-task");
  if(epicId){
    /* 史诗换掉当前抽屉内容：先记下这一层，头部「返回」能回到原工作项 */
    var back = epicId === rt.editingId ? null : pushDrawerBack();
    import("./task-actions.js").then(function(m){
      return m.openTaskById(epicId, { keepBackStack:true });
    }).then(function(ok){
      if(back && (!ok || rt.editingId !== epicId)) dropDrawerBack(back);
    });
    return;
  }
  var branchId = el.getAttribute("data-ev-branch");
  if(branchId){ import("../views/branches.js").then(function(m){ m.openBranchById(branchId); }); return; }
  var caseId = el.getAttribute("data-ev-case");
  if(caseId){
    var caseReq = el.getAttribute("data-ev-case-req") || "";
    import("./router.js").then(function(r){ return r.showView("testcases"); }).then(function(){
      return import("../views/testcases.js");
    }).then(function(m){ m.openCaseInProject(caseReq, caseId); });
    return;
  }
  var goto = el.getAttribute("data-ev-goto");
  if(goto === "version"){
    setDrawerTab("rel");
    setTimeout(function(){
      var target = drawerMode === "read" ? $("readAssocCard") : $("iVersion");
      if(target){ try{ target.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(err){ try{ target.scrollIntoView(); }catch(e){} } }
    }, 60);
    return;
  }
  if(goto === "publication"){
    setDrawerTab("rel");
    setTimeout(function(){
      var box = $("taskPublication");
      if(box && !box.hidden){ try{ box.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(err){ try{ box.scrollIntoView(); }catch(e){} } }
      else toast("该工作项暂无生产发布记录", "info");
    }, 60);
    return;
  }
  if(goto === "deps"){
    openDepSection();
    return;
  }
}
if(drawerBodyEl){
  var evActivate = function(e){
    var el = e.target.closest ? e.target.closest("[data-ev-goto],[data-ev-demand],[data-ev-doc],[data-ev-task],[data-ev-branch],[data-ev-case]") : null;
    if(!el) return;
    if(e.type === "keydown"){
      if(e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
    }
    evDrill(el);
  };
  drawerBodyEl.addEventListener("click", evActivate);
  drawerBodyEl.addEventListener("keydown", evActivate);
  /* 关联就地编辑铅笔（P4）：与跳转委托分开命中，铅笔只改不跳 */
  var assocEditActivate = function(e){
    var el = e.target.closest ? e.target.closest("[data-assoc-edit]") : null;
    if(!el) return;
    if(e.type === "keydown"){
      if(e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
    }
    if(el.getAttribute("data-assoc-edit") === "version") openVersionAssocPicker(el);
    else openAssocFact(el.getAttribute("data-assoc-edit"), el);
  };
  drawerBodyEl.addEventListener("click", assocEditActivate);
  drawerBodyEl.addEventListener("keydown", assocEditActivate);
  /* 人工发布标记入口：只补录历史发布事实，权限与后端 assertManageProject 同口径 */
  var pubActivate = function(e){
    var el = e.target.closest ? e.target.closest("[data-pub-judge],[data-pub-revoke]") : null;
    if(!el) return;
    if(e.type === "keydown"){
      if(e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
    }
    var task = readTask();
    if(el.hasAttribute("data-pub-judge")) openPublicationJudgementDialog(task);
    else revokePublicationJudgement(task);
  };
  drawerBodyEl.addEventListener("click", pubActivate);
  drawerBodyEl.addEventListener("keydown", pubActivate);
}

export { buildFormControls, currentProjectId, deleteTask, openTaskDrawer, ownerOptions, ownerPickerOptions, ownerRosterState, ensureProjectRoles, populateReqSelect, refreshOwnerSelect, renderTagChips, resetFormBaseline, showDrawerNotice, syncAssocRead, syncAssocViewBtns, syncCatSeg, syncDateBounds, syncFormSegs, syncProgVal, tryCloseTaskDrawer };
