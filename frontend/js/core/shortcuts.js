/* core/shortcuts · 键盘快捷键 */

import { API } from "./api.js";
import { $, board, btnSaveTask, iReq, searchInput, taskDrawer, taskForm } from "./dom.js";
import { activeView, showView } from "./router.js";
import { toggleRail } from "./shell.js";
import { calState, canEditTask, rt, state, taskById } from "./state.js";
import { openDuePopover, toggleTaskDone } from "./task-actions.js";
import { deleteTask, openTaskDrawer, tryCloseTaskDrawer } from "./task-drawer.js";
import { UI, toast } from "./ui.js";
import { COLUMNS, COL_INDEX, colName, iso, parseDate } from "../lib/format.js";
import { cancelDrag, drag, loadBoard, loadReqs, openInlineAdd } from "../views/board.js";
import { loadView, viewModule } from "./view-loader.js";
import { loadList, refreshListIfOpen } from "../views/list.js";
import { init as initSearchPalette, openSearchPalette } from "./search-palette.js";

initSearchPalette();

/* 手机顶栏搜索图标：打开全局搜索面板（项目 / 工作项 / 文档 / 需求 / 用例） */
var mobSearchBtn = $("btnMobSearch");
if(mobSearchBtn) mobSearchBtn.addEventListener("click", openSearchPalette);

var gPending = 0;
function inEditable(el){
  if(!el) return false;
  var tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
function focusedCard(){
  var el = document.activeElement;
  return (el && el.classList && el.classList.contains("card")) ? el : null;
}
function focusedRow(){
  var el = document.activeElement;
  return (el && el.classList && el.classList.contains("list-row")) ? el : null;
}
function moveTaskCol(t, delta){
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var idx = COL_INDEX[t.boardColumn] + delta;
  if(idx < 0 || idx >= COLUMNS.length) return;
  API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: COLUMNS[idx].id}).then(function(res){
    toast("「" + res.task.title + "」移动到「" + colName(res.to) + "」" +
      (res.autoTimerStarted ? " · 已开始计时" : ""));
    if(activeView === "list") loadList(); else loadBoard({animate:false, movedId: t.id});
    loadReqs();
  }).catch(function(ex){ toast("移动失败：" + (ex.message || "网络异常"), "bad"); });
}
document.addEventListener("keydown", function(e){
  if(e.isComposing || e.keyCode === 229) return;
  var mod = e.ctrlKey || e.metaKey;

  /* Esc：逐层关闭（优先级：拖拽 > 确认框 > Popover > 抽屉 > 弹窗 > 内联输入 > 搜索） */
  if(e.key === "Escape"){
    if(drag){ cancelDrag(); return; }
    var gMod = viewModule("gantt");
    if(gMod && gMod.ganttState.drag){ gMod.onGanttDragCancel(); return; }
    if(gMod && gMod.ganttState.unplannedDrag){ gMod.onGanttUnplannedCancel(); return; }
    if(gMod && gMod.ganttState.depDrag){ gMod.cleanupGanttLink(); return; }
    if(UI.confirmOpen()){ UI.settleConfirm(false); return; }
    var popEls = document.querySelectorAll(".menu,.ws-menu");
    var hasPop = Array.prototype.some.call(popEls, function(el){ return UI.popOpen(el); });
    if(hasPop){ UI.closeAllPops(); return; }
    if(taskDrawer.classList.contains("on")){ tryCloseTaskDrawer(); return; }
    if(UI.closeTopModal()) return;
    var inline = board.querySelector(".card-add-input");
    if(inline){
      var restore = inline._restore;
      state.inlineAdd = null;
      if(restore) inline.replaceWith(restore);
      return;
    }
    if(document.activeElement === searchInput) searchInput.blur();
    return;
  }

  /* Ctrl/⌘ + Z：甘特图改期多步撤销（输入框 / 抽屉 / 弹窗内不抢） */
  if(mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && activeView === "gantt" &&
     !inEditable(e.target) && !taskDrawer.classList.contains("on") &&
     !UI.anyModalOpen()){
    var gUndo = viewModule("gantt");
    if(gUndo && !gUndo.ganttState.drag && !gUndo.ganttState.unplannedDrag){
      e.preventDefault();
      gUndo.ganttUndoLast();
      return;
    }
  }

  /* Ctrl/⌘ + K：全局搜索（项目/工作项/文档/需求/用例）；/ 仍聚焦顶部搜索框 */
  if(mod && (e.key === "k" || e.key === "K")){
    e.preventDefault();
    openSearchPalette();
    return;
  }
  if(e.key === "/" && !inEditable(e.target)){
    e.preventDefault();
    /* 手机档位没有顶部搜索框，先打开筛选面板再聚焦关键词 */
    if(document.documentElement.dataset.layout === "mobile"){
      window.dispatchEvent(new CustomEvent("ds:view-search"));
      return;
    }
    searchInput.focus();
    searchInput.select();
    return;
  }
  /* Ctrl/⌘ + B 或 Ctrl/⌘ + \ ：侧边栏收起切换
     注意：在输入框 / 富文本编辑器里**不抢 B** —— 那里 Ctrl+B 是"加粗"，交给浏览器原生处理。
     这是一个真实踩过的坑：编辑器里按 Ctrl+B 结果侧边栏收起来了。 */
  if(mod && (e.key === "\\" || ((e.key === "b" || e.key === "B") && !inEditable(e.target)))){
    e.preventDefault();
    toggleRail();
    return;
  }
  /* Ctrl/⌘ + Enter：保存当前表单 */
  if(mod && e.key === "Enter"){
    if(taskDrawer.classList.contains("on")){
      e.preventDefault();
      if(!btnSaveTask.disabled) taskForm.dispatchEvent(new Event("submit", {cancelable:true, bubbles:true}));
      return;
    }
    /* 非 <form> 弹窗（项目、用例、执行、转缺陷等）注册了自己的提交入口 */
    var topModal = UI.topOpenModal();
    if(topModal && topModal.__submitFn){
      e.preventDefault();
      topModal.__submitFn();
      return;
    }
    var openForm = document.querySelector(".modal-layer.open form");
    if(openForm){
      e.preventDefault();
      openForm.dispatchEvent(new Event("submit", {cancelable:true, bubbles:true}));
      return;
    }
  }

  if(inEditable(e.target) || UI.anyModalOpen()) return;

  /* ?：快捷键帮助（Shift + /） */
  if(!mod && e.key === "?"){
    e.preventDefault();
    loadView("settings").then(function(m){ m.openHelp(); });
    return;
  }
  /* g + 字母：跳转视图（800ms 内组合，允许 g g） */
  if(gPending && Date.now() - gPending < 900){
    var gmap = {b:"board", l:"list", m:"mine", c:"calendar", g:"gantt", p:"projects",
                r:"review", a:"analysis", s:"settings"};
    var gt = gmap[String(e.key || "").toLowerCase()];
    gPending = 0;
    if(gt){ e.preventDefault(); showView(gt); return; }
  }
  if(!mod && !e.altKey && (e.key === "g" || e.key === "G")){
    gPending = Date.now();
    return;
  }
  gPending = 0;

  var card = focusedCard();
  var row = focusedRow();

  /* ← / → 移动所在列（卡片或列表行聚焦时） */
  if(e.key === "ArrowLeft" || e.key === "ArrowRight"){
    var target = card ? taskById(card.dataset.id) : (row ? rt.listCache[row.dataset.listId] : null);
    if(!target) return;
    e.preventDefault();
    moveTaskCol(target, e.key === "ArrowRight" ? 1 : -1);
    return;
  }
  /* ↑ / ↓ 卡片之间移动焦点 */
  if(card && (e.key === "ArrowUp" || e.key === "ArrowDown")){
    e.preventDefault();
    var all = Array.prototype.slice.call(board.querySelectorAll(".card"));
    var i = all.indexOf(card);
    var next = all[i + (e.key === "ArrowDown" ? 1 : -1)];
    if(next){
      next.focus();
      if(next.scrollIntoView) next.scrollIntoView({block:"nearest"});
    }
    return;
  }
  /* 卡片聚焦时的操作（列表行同样支持，O-5 O-6） */
  var kt = card ? taskById(card.dataset.id) : (row ? rt.listCache[row.dataset.listId] : null);
  if(card || row){
    if(e.key === " " || e.key === "Spacebar"){
      e.preventDefault();
      if(kt) openTaskDrawer(null, kt);
      return;
    }
    if(e.key === "d" || e.key === "D"){
      e.preventDefault();
      if(kt) openDuePopover(card || row, kt.id);
      return;
    }
    if(e.key === "x" || e.key === "X"){
      e.preventDefault();
      if(kt) toggleTaskDone(kt.id);
      return;
    }
    if(e.key === "Delete"){
      e.preventDefault();
      if(kt) deleteTask(kt.id);
      return;
    }
    if(e.key >= "0" && e.key <= "3"){
      e.preventDefault();
      if(!kt) return;
      if(!canEditTask(kt)){ toast("你对该项目只有查看权限", "warn"); return; }
      var pri = "P" + e.key;
      API.put("/api/tasks/" + encodeURIComponent(kt.id), taskPayloadWith(kt, {priority: pri})).then(function(){
        toast("已设为 " + pri, "fs");
        loadBoard({silent:true});
        refreshListIfOpen();
      }).catch(function(ex){ toast(ex.message || "更新失败", "bad"); });
      return;
    }
  }

  /* N：新建任务。看板内落在列内快速录入；其它视图就在当前视图打开抽屉并预填上下文 */
  if(!mod && !e.altKey && (e.key === "n" || e.key === "N")){
    e.preventDefault();
    if(activeView === "board"){
      var colId = "backlog";
      if(card){
        var colEl = card.closest(".board-col");
        if(colEl) colId = colEl.dataset.col;
      }
      state.inlineAdd = {col: colId, value: ""};
      openInlineAdd(colId, "");
      return;
    }
    if(activeView === "calendar"){
      openTaskDrawer("backlog", null, {dueDate: calState.selected || rt.TODAY_ISO});
      return;
    }
    if(activeView === "gantt"){
      var gAnchor = viewModule("gantt");
      var anchor = gAnchor && gAnchor.ganttState.anchorMonth ? parseDate(gAnchor.ganttState.anchorMonth) : rt.TODAY;
      openTaskDrawer("backlog", null, {startDate: iso(anchor)});
      return;
    }
    if(activeView === "list" && rt.listSelected && Object.keys(rt.listSelected).length === 1){
      var onlyId = Object.keys(rt.listSelected)[0];
      var onlyTask = rt.listCache[onlyId];
      if(onlyTask && onlyTask.reqId){
        openTaskDrawer("backlog", null, {});
        if(iReq) iReq.value = onlyTask.reqId;
        return;
      }
    }
    openTaskDrawer("backlog");
    return;
  }
  /* C：新建任务抽屉 */
  if(!mod && !e.altKey && (e.key === "c" || e.key === "C")){
    e.preventDefault();
    openTaskDrawer("backlog");
    return;
  }
  /* T：日历回到今天 */
  if(!mod && !e.altKey && (e.key === "t" || e.key === "T")){
    if(activeView === "calendar"){ e.preventDefault(); $("calToday").click(); }
    return;
  }
});
function taskPayloadWith(t, patch){
  var p = {
    title: t.title,
    description: t.description || "",
    priority: t.priority,
    category: t.category || null,
    owner: t.owner || null,
    ownerUserId: t.ownerUserId || null,
    boardColumn: t.boardColumn,
    startDate: t.startDate || null,
    dueDate: t.dueDate || null,
    reqId: t.reqId || null,
    reqDocId: t.reqDocId || null,
    branchId: t.branchId || null,
    progress: Number(t.progress) || 0,
    isMilestone: !!t.isMilestone,
    estimateMinutes: t.estimateMinutes == null ? null : Number(t.estimateMinutes),
    note: t.note || "",
    recurType: t.recurType || "",
    remindAt: t.remindAt || null,
    remindTarget: t.remindTarget || "owner",
    blocked: !!t.blocked,
    blockedReason: t.blockedReason || null,
    blockedByTaskId: t.blockedByTaskId || null,
    tags: t.tags || []
  };
  for(var k in patch) if(Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
  return p;
}

export { taskPayloadWith };
