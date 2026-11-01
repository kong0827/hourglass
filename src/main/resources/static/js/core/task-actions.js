/* core/task-actions · 深链、卡片级改期 / 计时 / 完成 / 菜单 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { icon } from "./icons.js";
import { activeView } from "./router.js";
import { taskPayloadWith } from "./shortcuts.js";
import { state, taskById, taskCacheExtra } from "./state.js";
import { deleteTask, openTaskDrawer } from "./task-drawer.js";
import { UI, copyToClipboard, esc, toast } from "./ui.js";
import { CAT_DEFAULT_COLOR, COLUMNS, colName, dayDiff, duePresetDate, fmtElapsed, fmtFull, fmtMinutesShort, parseDate } from "../lib/format.js";
import { loadBoard, loadReqs, render } from "../views/board.js";
import { refreshCalendarIfOpen, refreshGanttIfOpen, renderCalendar } from "../views/calendar.js";
import { loadList, refreshListIfOpen } from "../views/list.js";

function taskLink(id){
  return window.location.origin + window.location.pathname + "#/board?task=" + encodeURIComponent(id);
}
function openTaskById(id){
  var local = taskById(id);
  if(local && !local.deletedAt){ openTaskDrawer(null, local); return Promise.resolve(true); }
  /* 路径用单数 /api/task/{id}：与 /api/tasks/list、/api/tasks/done 零歧义 */
  return API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
    if(!t){ toast("任务不存在或你没有访问权限", "warn"); return false; }
    if(t.deletedAt){ toast("该任务已被删除，可在回收站查看", "warn"); return false; }
    taskCacheExtra[t.id] = t;
    openTaskDrawer(null, t);
    return true;
  }).catch(function(){ toast("任务不存在或你没有访问权限", "warn"); return false; });
}
function hashParam(name){
  var h = String(window.location.hash || "");
  var q = h.indexOf("?");
  if(q < 0) return "";
  var parts = h.substring(q + 1).split("&");
  for(var i = 0; i < parts.length; i++){
    var kv = parts[i].split("=");
    if(decodeURIComponent(kv[0]) === name) return decodeURIComponent(kv[1] || "");
  }
  return "";
}
function stripHashParam(name){
  var h = String(window.location.hash || "");
  var q = h.indexOf("?");
  if(q < 0) return;
  var keep = h.substring(q + 1).split("&").filter(function(p){
    return p && decodeURIComponent(p.split("=")[0]) !== name;
  });
  var next = h.substring(0, q) + (keep.length ? ("?" + keep.join("&")) : "");
  try{ history.replaceState(null, "", next || ("#/" + activeView)); }catch(e){ /* noop */ }
}
function handleDeepLink(){
  var id = hashParam("task");
  if(!id) return;
  stripHashParam("task");   // 先清参数：避免刷新后反复弹窗
  openTaskById(id);
}
function openDuePopover(anchor, taskId){
  var t = taskById(taskId);
  if(!t) return;
  var el = document.createElement("div");
  el.className = "menu due-pop";
  el.innerHTML =
    '<div class="dp-quick">' +
      '<button class="btn sm" type="button" data-due-set="0">今天</button>' +
      '<button class="btn sm" type="button" data-due-set="1">明天</button>' +
      '<button class="btn sm" type="button" data-due-set="w5" title="按 5 个工作日计算，自动跳过周末">一周后</button>' +
      '<button class="btn sm" type="button" data-due-set="">无期限</button>' +
    '</div>' +
    '<div class="dp-row">' +
      '<input type="date" value="' + esc(t.dueDate || "") + '" data-due-input aria-label="选择截止日期" />' +
      '<button class="btn sm primary" type="button" data-due-save>确定</button>' +
    '</div>';
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-due-set]");
    if(b){
      var v = b.dataset.dueSet;
      UI.closeAllPops();
      setTaskDue(taskId, duePresetDate(v));
      return;
    }
    if(e.target.closest("[data-due-save]")){
      var inp = el.querySelector("[data-due-input]");
      UI.closeAllPops();
      setTaskDue(taskId, inp.value || null);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
  setTimeout(function(){
    try{ el.querySelector("[data-due-input]").focus(); }catch(e2){ /* noop */ }
  }, 30);
}
function setTaskDue(taskId, dueDate){
  var t = taskById(taskId);
  if(!t) return;
  var before = t.dueDate || null;
  t.dueDate = dueDate;                                  // 乐观更新
  if(state.board && activeView === "board") render({animate:false});
  API.put("/api/tasks/" + encodeURIComponent(taskId), taskPayloadWith(t, {dueDate: dueDate})).then(function(){
    toast(dueDate ? ("已改期至 " + fmtFull(parseDate(dueDate))) : "已清除截止日期", dueDate ? "fs" : "warn");
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    t.dueDate = before;                                  // 失败回滚
    if(state.board && activeView === "board") render({animate:false});
    toast(ex.message || "改期失败", "bad");
  });
}
var runningTimerSeq = 0;
function loadRunningTimer(cb){
  var seq = ++runningTimerSeq;
  API.getGlobal("/api/my-running-timer").then(function(d){
    if(seq !== runningTimerSeq) return;
    state.runningTimer = (d && d.running) ? d : null;
    updateElapsedTexts();
    renderTimerPill();
    if(cb) cb(state.runningTimer);
  }).catch(function(){
    if(seq !== runningTimerSeq) return;
    state.runningTimer = null;
    renderTimerPill();
    if(cb) cb(null);
  });
}
function renderTimerPill(){
  var pill = $("timerPill");
  if(!pill) return;
  var rt = state.runningTimer;
  pill.hidden = !rt;
  if(!rt) return;
  var name = rt.taskTitle || "任务";
  $("timerPillName").textContent = name;
  pill.title = "正在计时：" + name + "（点击打开任务）";
  updateElapsedTexts();
}
function updateElapsedTexts(){
  var rt = state.runningTimer;
  if(!rt) return;
  document.querySelectorAll("[data-elapsed]").forEach(function(el){
    el.textContent = fmtElapsed(rt.elapsedMinutes);
  });
}
function toggleTaskTimer(taskId){
  var prev = state.runningTimer;
  var on = !!(prev && prev.taskId === taskId);
  var t = taskById(taskId);
  var name = t ? t.title : ((prev && prev.taskTitle) || "任务");
  var url = "/api/tasks/" + encodeURIComponent(taskId) + "/timer/" + (on ? "stop" : "start");
  API.post(url, {}).then(function(d){
    if(on){
      var total = (d && typeof d.totalMinutes === "number") ? d.totalMinutes : 0;
      toast("已停止「" + name + "」的计时" + (total ? "，累计 " + fmtMinutesShort(total) : ""), "fs");
    }else if(prev && prev.taskId && prev.taskId !== taskId){
      var other = taskById(prev.taskId);
      var otherName = other ? other.title : (prev.taskTitle || "另一个任务");
      toast("已开始「" + name + "」的计时 · 自动暂停了「" + otherName + "」", "fs");
    }else{
      toast("已开始「" + name + "」的计时", "fs");
    }
    loadRunningTimer(function(){
      if(state.runningTimer || on){
        if(activeView === "board") render({animate:false});
        else if(activeView === "list") loadList();
        else if(activeView === "calendar") renderCalendar();
      }
    });
  }).catch(function(ex){
    toast(ex.message || "计时操作失败", "bad");
  });
}
if($("timerPill")){
  $("timerPill").addEventListener("click", function(e){
    var rt = state.runningTimer;
    if(!rt) return;
    if(e.target.closest("#timerPillStop")){
      e.stopPropagation();
      toggleTaskTimer(rt.taskId);
      return;
    }
    openTaskById(rt.taskId);
  });
}
setInterval(function(){
  if(document.hidden) return;
  var prevId = state.runningTimer ? state.runningTimer.taskId : null;
  loadRunningTimer(function(rt){
    var nowId = rt ? rt.taskId : null;
    if(prevId !== nowId){
      if(activeView === "board") render({animate:false});
      else if(activeView === "calendar") renderCalendar();
    }
  });
}, 60000);
function toggleTaskDone(taskId){
  var t = taskById(taskId);
  if(!t) return;
  var isDone = t.boardColumn === "done";
  /* 取消完成 = 回到「完成前所在列」，由后端按最后一次进入已完成列的移动日志还原；
     不是固定回「进行中」。 */
  if(isDone){
    API.post("/api/tasks/" + encodeURIComponent(taskId) + "/reopen", {}).then(function(res){
      var backCol = res && res.to ? colName(res.to) : "进行中";
      toast("已取消完成，回到「" + backCol + "」", "warn");
      loadBoard({animate:false, movedId: taskId});
      loadReqs();
      refreshListIfOpen();
      refreshCalendarIfOpen();
      refreshGanttIfOpen();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
    return;
  }
  API.post("/api/tasks/" + encodeURIComponent(taskId) + "/move", {column:"done"}).then(function(res){
    var task = res.task;
    var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
    var doneMsg = dd > 0
      ? ("已完成任务「" + task.title + "」，延期 " + dd + " 天完成")
      : ("已完成任务「" + task.title + "」，按期完成");
    if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
    toast(doneMsg, dd > 0 ? "warn" : "fs");
    loadBoard({animate:false, movedId: task.id});
    loadReqs();
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}
function openCardMenu(anchor, taskId){
  var t = taskById(taskId);
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html =
    '<button class="menu-item" type="button" data-cm="open">' + icon("edit", 14) + '打开详情</button>' +
    '<button class="menu-item" type="button" data-cm="due">' + icon("calSmall", 14) + '改期<span class="k">D</span></button>' +
    '<button class="menu-item" type="button" data-cm="done">' + icon(isDone ? "undo" : "check", 14) +
      (isDone ? "取消完成" : "标记完成") + '<span class="k">X</span></button>' +
    '<button class="menu-item" type="button" data-cm="timer">' + icon("timer", 14) +
      (running ? "停止计时" : "开始计时") + '</button>' +
    '<button class="menu-item" type="button" data-cm="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-cm="link">' + icon("extlink", 14) + '复制任务链接</button>';
  var others = COLUMNS.filter(function(c){ return c.id !== t.boardColumn; });
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-cm-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  html += '<div class="menu-sep"></div>' +
    '<button class="menu-item danger" type="button" data-cm="del">' + icon("trash", 14) + '移到回收站</button>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-cm]");
    var mv = e.target.closest("[data-cm-move]");
    if(b){
      var k = b.dataset.cm;
      if(k === "due"){
        UI.closeAllPops();
        setTimeout(function(){ openDuePopover(anchor, t.id); }, 0);
        return;
      }
      UI.closeAllPops();
      if(k === "open") openTaskDrawer(null, t);
      else if(k === "done") toggleTaskDone(t.id);
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "link") copyToClipboard(taskLink(t.id), "任务链接已复制（可直接定位到该任务）");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      UI.closeAllPops();
      var to = mv.dataset.cmMove;
      API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: to}).then(function(res){
        toast("「" + t.title + "」移动到「" + colName(res.to) + "」" +
          (res.autoTimerStarted ? " · 已开始计时" : ""));
        loadBoard({silent:true}); loadReqs(); refreshListIfOpen();
      }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}

export { handleDeepLink, hashParam, loadRunningTimer, openCardMenu, openDuePopover, openTaskById, taskLink, toggleTaskDone, toggleTaskTimer };
