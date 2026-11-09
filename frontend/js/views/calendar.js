/* views/calendar · 日历视图 */

import { API } from "../core/api.js";
import { $, iDue, unplannedBox, unplannedCount, unplannedList } from "../core/dom.js";
import { boardParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { activeView } from "../core/router.js";
import { calState, dueState, dueText, rt, state, taskById, taskCacheExtra } from "../core/state.js";
import { openCardMenu, openDuePopover, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { openTaskDrawer, syncDateBounds } from "../core/task-drawer.js";
import { UI, esc } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { addDays, fmtMD, iso, pad2, parseDate, priColor, rgbaOf, weekdayCN } from "../lib/format.js";
import { cardHTML, loadBoard } from "./board.js";
import { loadView } from "../core/view-loader.js";
import { openReqDocAndJump } from "./requirements.js";

var calGrid = $("calGrid"), calLabel = $("calLabel"), calDayList = $("calDayList");
var calLayout = null;
/* 日历里用 -fg 档位而不是原始品牌色：小字号下后者在浅色底上对比度不足 */
function priFg(p){
  var code = String(p || "P2").toUpperCase();
  return { P0: "var(--p0-fg)", P1: "var(--p1-fg)", P2: "var(--p2-fg)", P3: "var(--p3-fg)" }[code] || "var(--text-2)";
}
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
  /* 首屏若还没拿到数据（或加载失败），年月仍是 null：先落到今天，避免算出 year=-1 */
  if(calState.year == null || calState.month == null){
    var today = rt.TODAY || new Date();
    calState.year = today.getFullYear();
    calState.month = today.getMonth() + 1;
  }
  if(isMobile()){
    var base = calState.selected ? parseDate(calState.selected) : rt.TODAY;
    var next = addDays(base, delta * 7);
    calState.selected = iso(next);
    calState.year = next.getFullYear();
    calState.month = next.getMonth() + 1;
    loadCalendar();
    return;
  }
  calState.month += delta;
  if(calState.month < 1){ calState.month = 12; calState.year--; }
  if(calState.month > 12){ calState.month = 1; calState.year++; }
  loadCalendar();
}
/* 手机周视图可能跨月：同时取本周起止所在的两个月，合并后去重 */
function calendarRequestMonths(){
  if(!isMobile() || !calState.selected){
    return [{year: calState.year, month: calState.month}];
  }
  var anchor = parseDate(calState.selected);
  var start = addDays(anchor, -((anchor.getDay() + 6) % 7));
  var end = addDays(start, 6);
  var a = {year: start.getFullYear(), month: start.getMonth() + 1};
  var b = {year: end.getFullYear(), month: end.getMonth() + 1};
  if(a.year === b.year && a.month === b.month) return [a];
  return [a, b];
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
  var months = calendarRequestMonths();
  Promise.all(months.map(function(m){
    return API.get("/api/calendar", boardParams({year: m.year, month: m.month}));
  })).then(function(pages){
    if(seq !== calState.seq) return;
    var first = pages[0] || {};
    if(first.year) calState.year = first.year;
    if(first.month) calState.month = first.month;
    var seen = {}, tasks = [];
    pages.forEach(function(d){
      (d && d.tasks ? d.tasks : []).forEach(function(t){
        if(!t || seen[t.id]) return;
        seen[t.id] = true;
        tasks.push(t);
      });
    });
    calState.tasks = tasks;
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
function renderMobileCalendar(){
  var anchor = calState.selected ? parseDate(calState.selected) : rt.TODAY;
  var dow = (anchor.getDay() + 6) % 7;
  var start = addDays(anchor, -dow);
  var end = addDays(start, 6);
  var sameYear = start.getFullYear() === end.getFullYear();
  calLabel.textContent = (sameYear ? "" : start.getFullYear() + " 年 ") + fmtMD(start) +
    " – " + (sameYear ? "" : end.getFullYear() + " 年 ") + fmtMD(end);
  $("calPrev").setAttribute("aria-label", "上一周");
  $("calNext").setAttribute("aria-label", "下一周");
  calGrid.classList.add("cal-week");

  var html = "";
  for(var i = 0; i < 7; i++){
    var day = addDays(start, i);
    var dateIso = iso(day);
    var list = [];
    calState.tasks.forEach(function(t){
      var range = calRangeOf(t);
      if(range && dateIso >= range.begin && dateIso <= range.end) list.push({t:t, range:range});
    });
    var cls = "cal-week-day";
    if(dateIso === rt.TODAY_ISO) cls += " today";
    if(dateIso === calState.selected) cls += " sel";
    var rows = list.map(function(it){
      var t = it.t;
      var kind = dueState(t).kind;
      var span = it.range.begin === it.range.end ? "" :
        (fmtMD(parseDate(it.range.begin)) + " – " + fmtMD(parseDate(it.range.end)));
      return '<button class="cwd-task p-' + esc(t.priority) +
        (t.boardColumn === "done" ? " done" : "") + (kind === "over" ? " over" : "") +
        '" type="button" data-cal-id="' + esc(t.id) + '" title="' + esc(t.title + " · " + dueText(t)) + '">' +
        '<i class="cbar" style="background:' + esc(priColor(t.priority)) + '"></i><span class="cwd-t">' + esc(t.title) + '</span>' +
        (span ? '<span class="cwd-span">' + esc(span) + '</span>' : '') + '</button>';
    }).join("");
    html += '<section class="' + cls + '" data-cal-date="' + dateIso + '" role="button" tabindex="0" aria-label="' + dateIso + '">' +
      '<div class="cwd-head">' +
        '<span class="cwd-dn">' + day.getDate() + '</span>' +
        '<span class="cwd-dw">' + weekdayCN(day) + '</span>' +
        '<span class="cwd-n">' + (list.length ? list.length + " 项" : "无工作项") + '</span>' +
        '<button class="cal-add" type="button" data-cal-add="' + dateIso + '" title="在这一天新建工作项" aria-label="在 ' + dateIso + ' 新建工作项">' + icon("plus", 12) + '</button>' +
      '</div>' +
      (rows ? '<div class="cwd-tasks">' + rows + '</div>' : '') +
    '</section>';
  }
  calGrid.innerHTML = html;
  calDayList.innerHTML = "";
  loadUnplanned();
}
function renderCalendar(){
  if(isMobile()) return renderMobileCalendar();
  calGrid.classList.remove("cal-week");
  $("calPrev").setAttribute("aria-label", "上个月");
  $("calNext").setAttribute("aria-label", "下个月");
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
      /* 跨天区间的非截止日/已完成项用中性色弱化；不靠整体透明度，否则文字对比度会掉到 AA 以下 */
      var chipColor = t.boardColumn === "done" ? "var(--text-2)"
        : (kind === "over" ? "var(--danger-fg)"
        : (it.isEnd ? priFg(t.priority) : "var(--text-2)"));
      chips += '<button type="button" class="cal-chip p-' + esc(t.priority) +
        (t.boardColumn === "done" ? " done" : "") + (kind === "over" ? " over" : "") +
        (it.isEnd ? "" : " span") +
        '" style="color:' + esc(chipColor) + ';background:' + esc(rgbaOf(priColor(t.priority), .10)) +
        '" data-cal-id="' + esc(t.id) + '" title="' + esc(t.title + " · " + tip) + '">' +
        '<i class="cbar" style="background:' + esc(priColor(t.priority)) + '"></i><span class="cal-t">' + esc(t.title) + '</span>' +
        (t.owner ? '<span class="cal-own" aria-label="负责人 ' + esc(t.owner) + '">' + esc(t.owner.slice(-1)) + '</span>' : '') +
        '</button>';
    }
    if(visible.length > 3) chips += '<button type="button" class="cal-more" title="查看当天全部工作项">+' + (visible.length - 3) + ' 更多</button>';
    if(doneItems.length && !expanded){
      chips += '<button type="button" class="cal-chip done cal-done-toggle" data-cal-show-done="' + dateIso +
        '" title="展开当天已完成的工作项">' + (doneItems.length === 1 ? "1 项已完成" : doneItems.length + " 项已完成") + '</button>';
    }
    html += '<div class="' + cls + '" data-cal-date="' + dateIso + '" role="button" tabindex="0" aria-label="' + dateIso + '">' +
      '<button class="cal-add" type="button" data-cal-add="' + dateIso + '" title="在这一天新建工作项" aria-label="在 ' + dateIso + ' 新建工作项">' +
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
}var unplannedState = {items:[], total:0, hasMore:false, loading:false};
function loadUnplanned(opts){
  if(!unplannedBox) return;
  opts = opts || {};
  var append = !!opts.more && unplannedState.items.length > 0;
  if(append && unplannedState.loading) return;
  if(!append){
    unplannedState.items = [];
    unplannedState.total = 0;
    unplannedState.hasMore = false;
  }
  unplannedState.loading = true;
  API.get("/api/tasks/list", {
    noDue: true,
    sort: "priority",
    offset: unplannedState.items.length,
    limit: 100
  }).then(function(d){
    unplannedState.loading = false;
    var items = (d && d.items) || [];
    unplannedState.items = append ? unplannedState.items.concat(items) : items;
    unplannedState.total = Math.max((d && d.total) || 0, unplannedState.items.length);
    unplannedState.hasMore = !!(d && d.hasMore) && items.length > 0;
    unplannedState.items.forEach(function(t){ taskCacheExtra[t.id] = t; });
    if(unplannedCount) unplannedCount.textContent = String(unplannedState.total);
    if(unplannedList){
      unplannedList.innerHTML = unplannedState.items.length
        ? unplannedState.items.map(function(t){ return cardHTML(t, 0); }).join("") +
          (unplannedState.hasMore
            ? '<div class="unplanned-more"><button class="btn sm block" type="button" data-unplanned-more>加载更多</button></div>'
            : "")
        : UI.colEmpty("本月没有未排期的工作项：所有工作项都已有截止日期。");
    }
  }).catch(function(){
    unplannedState.loading = false;
    if(append) return;
    if(unplannedCount) unplannedCount.textContent = "—";
    if(unplannedList) unplannedList.innerHTML = UI.colEmpty("未排期工作项加载失败（该接口需要后端支持）");
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
      '<p>点击左侧日期查看当天全部截止工作项</p></div>';
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
      '<span class="foot-note">共 ' + list.length + ' 项工作项</span>' +
    '</div>';
  html += '<div class="cal-side-list">' + (openList.length
    ? openList.map(function(t){ return cardHTML(t, 0); }).join("")
    : UI.colEmpty("当日没有进行中的工作项", "inbox"));
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
if(unplannedList) unplannedList.addEventListener("click", function(e){
  if(e.target.closest("[data-unplanned-more]")) loadUnplanned({more:true});
});
if(unplannedList) wireCardContainer(unplannedList);
window.addEventListener("ds:layout", function(e){
  var next = e.detail && e.detail.layout;
  if(rt.currentWs && activeView === "calendar"){
    /* 桌面翻月不更新 selected；切到手机周视图时，若选中日不在当前月，跟随当前显示月 */
    if(next === "mobile" && calLayout && calLayout !== "mobile" && calState.selected && calState.year){
      var sel = parseDate(calState.selected);
      if(sel.getFullYear() !== calState.year || sel.getMonth() + 1 !== calState.month){
        calState.selected = iso(new Date(calState.year, calState.month - 1, 1));
      }
    }
    /* 断点切换会改变取数范围（月 ↔ 周），直接重拉，避免用旧月份数据画新视图 */
    loadCalendar({silent:true});
  }
  calLayout = next;
});

export { enterCalendarView, loadCalendar, refreshCalendarIfOpen, refreshGanttIfOpen, renderCalendar };
