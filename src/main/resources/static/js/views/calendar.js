/* views/calendar · 日历视图 */

import { API } from "../core/api.js";
import { $, iDue, unplannedBox, unplannedCount, unplannedList } from "../core/dom.js";
import { boardParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { calState, dueState, dueText, rt, state, taskById, taskCacheExtra } from "../core/state.js";
import { openCardMenu, openDuePopover, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { openTaskDrawer, syncDateBounds } from "../core/task-drawer.js";
import { UI, esc } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { addDays, fmtMD, iso, pad2, parseDate, weekdayCN } from "../lib/format.js";
import { cardHTML, loadBoard } from "./board.js";
import { loadView } from "../core/view-loader.js";
import { openReqDocAndJump } from "./requirements.js";

var calGrid = $("calGrid"), calLabel = $("calLabel"), calDayList = $("calDayList");
function enterCalendarView(){
  var now = new Date();
  if(calState.year === null){ calState.year = now.getFullYear(); calState.month = now.getMonth() + 1; }
  if(calState.selected === null) calState.selected = iso(rt.TODAY);
  /* 启动时看板若未加载成功，筛选栏会没有选项：进日历时静默补拉一次 */
  if(!state.board) loadBoard({silent:true});
  loadCalendar();
}
function refreshCalendarIfOpen(){ if(activeView === "calendar") loadCalendar({silent:true}); }
function refreshGanttIfOpen(){ if(activeView === "gantt") loadView("gantt").then(function(m){ m.loadGantt({silent:true}); }); }
function calShift(delta){
  calState.month += delta;
  if(calState.month < 1){ calState.month = 12; calState.year--; }
  if(calState.month > 12){ calState.month = 1; calState.year++; }
  loadCalendar();
}
function loadCalendar(opts){
  opts = opts || {};
  var seq = ++calState.seq;
  if(!opts.silent){
    calLabel.textContent = "加载中…";
    calGrid.innerHTML = '<div style="grid-column:1/-1;padding:20px">' + UI.skeletonRows(6) + '</div>';
    calDayList.innerHTML = '<div class="skel skel-line" style="width:60%"></div>';
  }
  /* IA-4：日历接入与看板相同的筛选（负责人 / 优先级 / 分类 / 项目 / 标签 / 关键词 / 到期） */
  API.get("/api/calendar", boardParams({year: calState.year, month: calState.month})).then(function(d){
    if(seq !== calState.seq) return;
    calState.year = d.year;
    calState.month = d.month;
    calState.tasks = d.tasks || [];
    renderCalendar();
  }).catch(function(ex){
    if(seq !== calState.seq) return;
    calLabel.textContent = "";
    calGrid.innerHTML = '<div style="grid-column:1/-1;padding:20px">' + UI.errorState(ex.message) + '</div>';
    bindRetry(calGrid, function(){ loadCalendar(); });
  });
}
function calFindTask(id){
  for(var i = 0; i < calState.tasks.length; i++) if(calState.tasks[i].id === id) return calState.tasks[i];
  return null;
}
function calRangeOf(t){
  if(!t || !t.dueDate) return null;
  var end = t.dueDate;
  if(t.boardColumn === "done" && t.completedAt && t.completedAt < end) end = t.completedAt;
  var begin = (t.startDate && t.startDate <= end) ? t.startDate : end;
  return {begin: begin, end: end};
}
function renderCalendar(){
  calLabel.textContent = calState.year + " 年 " + calState.month + " 月";
  var first = new Date(calState.year, calState.month - 1, 1);
  var startOffset = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(calState.year, calState.month, 0).getDate();
  var monthFirst = calState.year + "-" + pad2(calState.month) + "-01";
  var monthLast = calState.year + "-" + pad2(calState.month) + "-" + pad2(daysInMonth);

  /* 按 [开始日期, 截止日期] 区间逐日铺开：正在做的任务每天都应该出现在日历上。
     没填开始日期（或开始晚于截止）就只占截止日那一格，与升级前行为一致。 */
  var byDay = {};
  calState.tasks.forEach(function(t){
    var range = calRangeOf(t);
    if(!range) return;
    var begin = range.begin, end = range.end;
    if(end < monthFirst || begin > monthLast) return;
    var from = begin < monthFirst ? monthFirst : begin;
    var to = end > monthLast ? monthLast : end;
    var cur = parseDate(from), lastD = parseDate(to);
    while(cur <= lastD){
      var key = iso(cur);
      (byDay[key] = byDay[key] || []).push({t: t, isStart: key === begin, isEnd: key === end});
      cur = addDays(cur, 1);
    }
  });
  var html = "";
  for(var i = 0; i < startOffset; i++) html += '<div class="cal-day out"></div>';
  for(var day = 1; day <= daysInMonth; day++){
    var dateIso = calState.year + "-" + pad2(calState.month) + "-" + pad2(day);
    var list = byDay[dateIso] || [];
    var cls = "cal-day";
    if(dateIso === rt.TODAY_ISO) cls += " today";
    if(calState.selected === dateIso) cls += " sel";
    var chips = "";
    /* IA-4：已完成默认折叠，只显示「+n 已完成」；点开后当天才展开（避免格子被历史完成项塞满） */
    var doneItems = list.filter(function(it){ return it.t.boardColumn === "done"; });
    var openItems = list.filter(function(it){ return it.t.boardColumn !== "done"; });
    var expanded = !!calState.showDone[dateIso];
    var visible = expanded ? list : openItems;
    for(var k = 0; k < Math.min(visible.length, 3); k++){
      var it = visible[k], t = it.t;
      var kind = dueState(t).kind;
      /* 已完成的任务在区间内每一格都显示完成日；未完成才提示"进行中，截止 X" */
      var tip = (it.isEnd || kind === "done") ? dueText(t) : ("进行中，截止 " + t.dueDate);
      chips += '<button type="button" class="cal-chip p-' + esc(t.priority) +
        (t.boardColumn === "done" ? " done" : "") + (kind === "over" ? " over" : "") +
        (it.isEnd ? "" : " span") +
        '" data-cal-id="' + esc(t.id) + '" title="' + esc(t.title + " · " + tip) + '">' +
        '<i class="cbar"></i><span class="cal-t">' + esc(t.title) + '</span>' +
        (t.owner ? '<span class="cal-own" aria-label="负责人 ' + esc(t.owner) + '">' + esc(t.owner.slice(-1)) + '</span>' : '') +
        '</button>';
    }
    if(visible.length > 3) chips += '<span class="cal-more">+' + (visible.length - 3) + ' 更多</span>';
    if(doneItems.length && !expanded){
      chips += '<button type="button" class="cal-chip done cal-done-toggle" data-cal-show-done="' + dateIso +
        '" title="展开当天已完成的任务">' + (doneItems.length === 1 ? "1 项已完成" : doneItems.length + " 项已完成") + '</button>';
    }
    html += '<div class="' + cls + '" data-cal-date="' + dateIso + '" role="button" tabindex="0" aria-label="' + dateIso + '">' +
      '<button class="cal-add" type="button" data-cal-add="' + dateIso + '" title="在这一天新建任务" aria-label="在 ' + dateIso + ' 新建任务">' +
        icon("plus", 12) + '</button>' +
      '<span class="cal-dn">' + day + '</span>' +
      '<div class="cal-tasks">' + chips + '</div>' +
    '</div>';
  }
  calGrid.innerHTML = html;
  renderCalDayList();
  loadUnplanned();
}
function openNewTaskOnDate(dateIso){
  openTaskDrawer("backlog");
  iDue.value = dateIso;
  syncDateBounds();
  rt.formDirty = false;   // 预填不算用户改动，避免关抽屉时无故挽留
}
function loadUnplanned(){
  if(!unplannedBox) return;
  API.get("/api/tasks/list", {noDue: true, sort: "priority"}).then(function(d){
    var items = (d && d.items) || [];
    items.forEach(function(t){ taskCacheExtra[t.id] = t; });
    if(unplannedCount) unplannedCount.textContent = String(items.length);
    if(unplannedList){
      unplannedList.innerHTML = items.length
        ? items.slice(0, 50).map(function(t){ return cardHTML(t, 0); }).join("") +
          (items.length > 50 ? '<p class="foot-note">仅显示前 50 项，共 ' + items.length + ' 项未排期</p>' : "")
        : UI.colEmpty("本月没有未排期的任务：所有任务都已有截止日期。");
    }
  }).catch(function(){
    if(unplannedCount) unplannedCount.textContent = "—";
    if(unplannedList) unplannedList.innerHTML = UI.colEmpty("未排期任务加载失败（该接口需要后端支持）");
  });
}
function wireCardContainer(root){
  if(!root || root.__cardWired) return;
  root.__cardWired = true;
  root.addEventListener("click", function(e){
    var due = e.target.closest("[data-due-pop]");
    if(due){ openDuePopover(due, due.dataset.duePop); return; }
    var menu = e.target.closest("[data-card-menu]");
    if(menu){ openCardMenu(menu, menu.dataset.cardMenu); return; }
    var docBtn = e.target.closest("[data-open-reqdoc]");
    if(docBtn){ openReqDocAndJump(docBtn.dataset.openReqdoc); return; }
    var tmr = e.target.closest("[data-timer-toggle]");
    if(tmr){ toggleTaskTimer(tmr.dataset.timerToggle); return; }
    var tick = e.target.closest("[data-done-toggle]");
    if(tick){ toggleTaskDone(tick.dataset.doneToggle); return; }
    if(e.target.closest("button,a")) return;
    var card = e.target.closest(".card");
    if(card && Date.now() > rt.suppressClickUntil) openTaskDrawer(null, taskById(card.dataset.id));
  });
}
function renderCalDayList(){
  if(!calState.selected){
    calDayList.innerHTML = '<div class="empty-state compact"><span class="es-ic">' + icon("calendar", 40) + '</span>' +
      '<p>点击左侧日期查看当天全部截止任务</p></div>';
    return;
  }
  var sel = parseDate(calState.selected);
  var selIso = calState.selected;
  /* 区间包含判断：在 [开始, 实际结束] 内每一天的侧栏里都应该看得到（提前完成的任务不再往后铺） */
  var list = calState.tasks.filter(function(t){
    var range = calRangeOf(t);
    return !!range && selIso >= range.begin && selIso <= range.end;
  });
  list.forEach(function(t){ taskCacheExtra[t.id] = t; });
  var openList = list.filter(function(t){ return t.boardColumn !== "done"; });
  var doneList = list.filter(function(t){ return t.boardColumn === "done"; });
  var showDone = !!calState.showDone[selIso];
  var html = '<div class="cal-side-head">' +
      '<h3>' + fmtMD(sel) + ' ' + weekdayCN(sel) + '</h3>' +
      '<span class="foot-note">共 ' + list.length + ' 项任务</span>' +
    '</div>';
  html += '<div class="cal-side-list">' + (openList.length
    ? openList.map(function(t){ return cardHTML(t, 0); }).join("")
    : UI.colEmpty("当日没有进行中的任务", "inbox"));
  if(doneList.length){
    html += '<button class="btn sm ghost cal-side-done" type="button" data-cal-side-done="' + selIso + '">' +
      (showDone ? "收起已完成" : "展开 " + doneList.length + " 项已完成") + '</button>';
    if(showDone){
      html += doneList.map(function(t){ return cardHTML(t, 0); }).join("");
    }
  }
  html += '</div>';
  calDayList.innerHTML = html;
  wireCardContainer(calDayList);
  UI.wireTooltips(calDayList);
}
$("calPrev").addEventListener("click", function(){ calShift(-1); });
$("calNext").addEventListener("click", function(){ calShift(1); });
$("calToday").addEventListener("click", function(){
  var now = new Date();
  calState.year = now.getFullYear();
  calState.month = now.getMonth() + 1;
  calState.selected = iso(rt.TODAY);
  loadCalendar();
});
calGrid.addEventListener("click", function(e){
  var addBtn = e.target.closest("[data-cal-add]");
  if(addBtn){ e.stopPropagation(); openNewTaskOnDate(addBtn.dataset.calAdd); return; }
  var doneToggle = e.target.closest("[data-cal-show-done]");
  if(doneToggle){
    e.stopPropagation();
    var dayIso = doneToggle.dataset.calShowDone;
    calState.showDone[dayIso] = !calState.showDone[dayIso];
    calState.selected = dayIso;
    renderCalendar();
    return;
  }
  var chip = e.target.closest("[data-cal-id]");
  if(chip){
    e.stopPropagation();
    var t = calFindTask(chip.dataset.calId);
    if(t) openTaskDrawer(null, t);
    return;
  }
  var cell = e.target.closest("[data-cal-date]");
  if(cell){
    calState.selected = cell.dataset.calDate;
    renderCalendar();
  }
});
calGrid.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var cell = e.target.closest("[data-cal-date]");
  if(!cell) return;
  e.preventDefault();
  calState.selected = cell.dataset.calDate;
  renderCalendar();
});
calDayList.addEventListener("click", function(e){
  var more = e.target.closest("[data-cal-side-done]");
  if(more){
    calState.showDone[more.dataset.calSideDone] = !calState.showDone[more.dataset.calSideDone];
    renderCalendar();
    return;
  }
  if(e.target.closest("button,a")) return;
  var card = e.target.closest(".card");
  if(!card) return;
  var t = taskById(card.dataset.id);
  if(t) openTaskDrawer(null, t);
});
if(unplannedList) wireCardContainer(unplannedList);

export { enterCalendarView, loadCalendar, refreshCalendarIfOpen, refreshGanttIfOpen, renderCalendar };
