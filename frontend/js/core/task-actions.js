/* core/task-actions · 深链、卡片级改期 / 计时 / 完成 / 菜单 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { icon } from "./icons.js";
import { activeView, showView } from "./router.js";
import { taskPayloadWith } from "./shortcuts.js";
import { state, canCreateNow, canEditTask, reqNameById, rt, taskById, taskCacheExtra } from "./state.js";
import { recordRecentVisit } from "./recent-visits.js";
import { deleteTask, openTaskDrawer, ownerOptions } from "./task-drawer.js";
import { openDateAt } from "./date-picker.js";
import { guard, loadRules, ruleFor, serverDecision } from "./transitions.js";
import { viewModule } from "./view-loader.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "./ui.js";
import { CAT_DEFAULT_COLOR, COLUMNS, avatarHTML, colName, dayDiff, duePresetDate, fmtElapsed, fmtFull, fmtMinutesShort, parseDate, PRIORITIES, priName, priTagHTML } from "../lib/format.js";
import { loadProjectMembers, memberRoleTitles } from "../lib/member-labels.js";
import { loadBoard, loadReqs, render } from "../views/board.js";
import { refreshCalendarIfOpen, refreshGanttIfOpen, renderCalendar } from "../views/calendar.js";
import { loadList, refreshListIfOpen, repaintListRows } from "../views/list.js";

function taskLink(id){
  return window.location.origin + window.location.pathname + "#/board?task=" + encodeURIComponent(id);
}
var openTaskSeq = 0;
/* 打开工作项即记一次最近访问（本机），全局搜索空态用它回答「刚才看到哪」 */
function rememberTaskVisit(t){
  if(!t || !t.id) return;
  recordRecentVisit({
    type: "task", id: t.id,
    title: t.title || "未命名工作项",
    meta: reqNameById(t.reqId) || "工作项",
    reqId: t.reqId || ""
  });
}
function openTaskById(id, opts){
  var seq = ++openTaskSeq;
  var local = taskById(id);
  if(local && !local.deletedAt){ rememberTaskVisit(local); openTaskDrawer(null, local, opts); return Promise.resolve(true); }
  /* 路径用单数 /api/task/{id}：与 /api/tasks/list、/api/tasks/done 零歧义 */
  return API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
    if(seq !== openTaskSeq) return false;
    if(!t){ toast("工作项不存在或你没有访问权限", "warn"); return false; }
    if(t.deletedAt){ toast("该工作项已被删除，可在回收站查看", "warn"); return false; }
    taskCacheExtra[t.id] = t;
    rememberTaskVisit(t);
    openTaskDrawer(null, t, opts);
    return true;
  }).catch(function(){
    if(seq === openTaskSeq) toast("工作项不存在或你没有访问权限", "warn");
    return false;
  });
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
  if(id){
    stripHashParam("task");   // 先清参数：避免刷新后反复弹窗
    openTaskById(id);
    return;
  }
  /* 助手「新建工作项」入口只属于看板：#/board?new=1 直接打开新建抽屉。
     其他视图的 ?new=1 是全局「新建」菜单的跨视图创建参数（版本 / 需求 / 用例 / 文档 / 分支），
     由目标视图进入时自行消费；这里抢先把参数清掉会把「新建版本」等误开成新建任务 */
  if(activeView === "board" && hashParam("new") === "1"){
    stripHashParam("new");
    if(!canCreateNow()){ toast("当前没有可写的项目，无法新建工作项；请联系空间主或管理员分配项目", "warn"); return; }
    openTaskDrawer("backlog");
  }
}
function openDuePopover(anchor, taskId){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
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
      '<button class="btn sm block" type="button" data-due-pick>' + icon("calendar", 13) + '选择其他日期…</button>' +
    '</div>';
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-due-set]");
    if(b){
      var v = b.dataset.dueSet;
      UI.closeAllPops();
      setTaskDue(taskId, duePresetDate(v));
      return;
    }
    if(e.target.closest("[data-due-pick]")){
      var r = e.target.closest("[data-due-pick]").getBoundingClientRect();
      UI.closeAllPops();
      openDateAt(r, {
        value: t.dueDate || "",
        onPick: function(v){ setTaskDue(taskId, v || null); }
      });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
var dueSeqByTask = {};
function setTaskDue(taskId, dueDate){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var seq = (dueSeqByTask[taskId] || 0) + 1;
  dueSeqByTask[taskId] = seq;
  var before = t.dueDate || null;
  patchTaskMirrors(t, {dueDate: dueDate});            // 乐观更新
  repaintTaskPatch();
  API.put("/api/tasks/" + encodeURIComponent(taskId), taskPayloadWith(t, {dueDate: dueDate})).then(function(){
    if(dueSeqByTask[taskId] !== seq) return;
    toast(dueDate ? ("已改期至 " + fmtFull(parseDate(dueDate))) : "已清除截止日期", dueDate ? "fs" : "warn");
    refreshAfterTaskPatch(taskId);
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    if(dueSeqByTask[taskId] !== seq) return;
    patchTaskMirrors(t, {dueDate: before});            // 失败回滚
    repaintTaskPatch();
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
    window.dispatchEvent(new CustomEvent("ds:running-timer"));
    if(cb) cb(state.runningTimer);
  }).catch(function(){
    if(seq !== runningTimerSeq) return;
    state.runningTimer = null;
    renderTimerPill();
    window.dispatchEvent(new CustomEvent("ds:running-timer"));
    if(cb) cb(null);
  });
}
function renderTimerPill(){
  var pill = $("timerPill");
  if(!pill) return;
  var rt = state.runningTimer;
  pill.hidden = !rt;
  if(!rt) return;
  var name = rt.taskTitle || "工作项";
  $("timerPillName").textContent = name;
  pill.title = "正在计时：" + name + "（点击打开工作项）";
  updateElapsedTexts();
}
function updateElapsedTexts(){
  var rt = state.runningTimer;
  if(!rt) return;
  document.querySelectorAll("[data-elapsed]").forEach(function(el){
    el.textContent = fmtElapsed(rt.elapsedMinutes);
  });
}
/* 计时开始/停止进行中时忽略重复触发：双击或连按会基于同一份旧状态发出两次请求 */
var timerToggleBusy = false;
function toggleTaskTimer(taskId){
  if(timerToggleBusy) return;
  var prev = state.runningTimer;
  var on = !!(prev && prev.taskId === taskId);
  var t = taskById(taskId);
  /* 停止自己已开始的计时始终允许（避免降权后计时卡死）；开始新计时需要项目写权限 */
  if(!on && t && !canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var name = t ? t.title : ((prev && prev.taskTitle) || "工作项");
  var url = "/api/tasks/" + encodeURIComponent(taskId) + "/timer/" + (on ? "stop" : "start");
  timerToggleBusy = true;
  API.post(url, {}).then(function(d){
    timerToggleBusy = false;
    if(on){
      var total = (d && typeof d.totalMinutes === "number") ? d.totalMinutes : 0;
      var auto = (d && d.autoTimerTask) ? " · 已接着开始「" + d.autoTimerTask + "」的计时" : "";
      toast("已停止「" + name + "」的计时" + (total ? "，累计 " + fmtMinutesShort(total) : "") + auto, "fs");
    }else if(prev && prev.taskId && prev.taskId !== taskId){
      var other = taskById(prev.taskId);
      var otherName = other ? other.title : (prev.taskTitle || "另一个工作项");
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
    timerToggleBusy = false;
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
/** 带流转判定的移动：先本地判定，服务端仍拒绝时按 412/422 补救一次。
    opts.from 用于乐观更新后仍按「移动前的列」判定；opts.onFail 在取消/被拒/失败时回滚。 */
function guardedMove(t, target, send, onSuccess, opts){
  var wsId = t.workspaceId || (rt.currentWs && rt.currentWs.id);
  var onFail = (opts && opts.onFail) || function(){};
  var items = [{ from: (opts && opts.from) || t.boardColumn, title: t.title }];
  return guard(wsId, items, target).then(function(pass){
    if(!pass){ onFail(); return false; }
    var retried = false;
    function fail(ex){
      if(retried){ toast(ex.message || "操作失败", "bad"); onFail(); return false; }
      retried = true;
      return serverDecision(wsId, items, target, ex).then(function(retry){
        if(!retry){
          if(ex.code !== 412 && ex.code !== 422) toast(ex.message || "操作失败", "bad");
          onFail();
          return false;
        }
        return send(retry).then(onSuccess).catch(function(e){
          toast(e.message || "操作失败", "bad"); onFail(); return false;
        });
      });
    }
    return send(pass).then(onSuccess).catch(fail);
  });
}
/* ===== 行内状态 chip / 卡片菜单 / 行菜单共用的改列 =====
   乐观更新看板与列表缓存 → 失败或取消回滚 → 成功后可一键撤销。 */
var moveSeqByTask = Object.create(null);
function moveTaskToColumn(t, to){
  if(!t || !to || t.boardColumn === to) return Promise.resolve(false);
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return Promise.resolve(false); }
  var from = t.boardColumn;
  var seq = (moveSeqByTask[t.id] || 0) + 1;
  moveSeqByTask[t.id] = seq;
  /* 看板、列表、详情缓存可能持有同一工作项的不同对象，乐观更新要一起改 */
  var mirrors = [t];
  [taskById(t.id), rt.listCache[t.id], taskCacheExtra[t.id]].forEach(function(m){
    if(m && mirrors.indexOf(m) < 0) mirrors.push(m);
  });
  function stale(){ return moveSeqByTask[t.id] !== seq; }
  function paint(col){
    if(stale()) return;
    mirrors.forEach(function(m){ m.boardColumn = col; });
    if(state.board && activeView === "board") render({animate:false});
    repaintListRows();
  }
  paint(to);
  return guardedMove(t, to, function(pass){
    var body = { column: to };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    return API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", body);
  }, function(res){
    var landed = (res && res.to) || to;
    paint(landed);
    if(!stale()){
      var msg = "「" + t.title + "」移动到「" + colName(landed) + "」" +
        (res && res.autoTimerStarted ? " · 已开始计时" : "") +
        (res && res.autoTimerTask ? " · 已接着开始「" + res.autoTimerTask + "」的计时" : "");
      toastAction(msg, "撤销", function(){
        moveTaskToColumn(taskById(t.id) || t, from);
      }, "", 6000);
    }
    loadBoard({silent:true});
    loadReqs();
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
    var treeMod = viewModule("tree");
    if(treeMod && treeMod.refreshTreeIfOpen) treeMod.refreshTreeIfOpen();
    /* 缺陷的回归状态随列流转，测试页 / 我的工作需要跟着重取 */
    window.dispatchEvent(new CustomEvent("ds:task-saved", { detail:{ id:t.id, created:false } }));
    return true;
  }, { from: from, onFail: function(){ paint(from); } });
}
/** 状态 chip 的列菜单：只列出可去的列，当前列打勾且不可点 */
function openStatusMenu(anchor, taskId){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var wsId = t.workspaceId || (rt.currentWs && rt.currentWs.id);
  var el = document.createElement("div");
  el.className = "menu status-menu";
  el.setAttribute("role", "menu");
  function paintMenu(){
    el.innerHTML = '<div class="menu-title">移动「' + esc(t.title) + '」到</div>' +
      COLUMNS.map(function(c){
        var cur = c.id === t.boardColumn;
        var rule = cur ? "allow" : ruleFor(wsId, t.boardColumn, c.id);
        var tip = cur ? "当前所在列"
          : rule === "deny" ? "该流转被限制，需空间主 / 管理员强制"
          : rule === "reason" ? "该流转需要填写原因"
          : "移动到「" + c.name + "」";
        return '<button class="menu-item" type="button" role="menuitem" data-status-to="' + esc(c.id) + '"' +
          (cur ? ' disabled aria-current="true"' : "") + ' title="' + esc(tip) + '">' +
          '<span class="status-dot" style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
          esc(c.name) +
          (cur ? '<span class="k">当前</span>' : rule === "reason" ? '<span class="k">需原因</span>' : rule === "deny" ? '<span class="k">受限</span>' : "") +
        '</button>';
      }).join("");
  }
  paintMenu();
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-status-to]");
    if(!b || b.disabled) return;
    UI.closeAllPops();
    moveTaskToColumn(t, b.dataset.statusTo);
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
  /* 规则首次读取是异步的：先按默认规则开菜单，拿到矩阵后原地补上「需原因 / 受限」 */
  loadRules(wsId).then(function(){ if(el.isConnected) paintMenu(); }).catch(function(){});
}
/* ===== 列表行内直接修：优先级 / 负责人 =====
   与需求池行内编辑同口径：读态是单元格文字，点开菜单，选中即保存。
   改列仍走 openStatusMenu（含流转规则），改期仍走 openDuePopover。 */
/* 看板、列表、详情缓存可能持有同一工作项的不同对象，乐观更新要一起改 */
function patchTaskMirrors(t, patch){
  var seen = [];
  [t, taskById(t.id), rt.listCache[t.id], taskCacheExtra[t.id]].forEach(function(m){
    if(!m || seen.indexOf(m) >= 0) return;
    seen.push(m);
    for(var k in patch){
      if(Object.prototype.hasOwnProperty.call(patch, k)) m[k] = patch[k];
    }
  });
}
function repaintTaskPatch(){
  if(state.board && activeView === "board") render({animate:false});
  repaintListRows();
}
/* 行内改完统一收口：层级视图重新聚合，列状态工作页 / 缺陷 Tab / 我的工作靠 ds:task-saved 重取 */
function refreshAfterTaskPatch(taskId){
  loadBoard({silent:true});
  refreshListIfOpen();
  var treeMod = viewModule("tree");
  if(treeMod && treeMod.refreshTreeIfOpen) treeMod.refreshTreeIfOpen();
  window.dispatchEvent(new CustomEvent("ds:task-saved", { detail:{ id:taskId, created:false } }));
}
var priSeqByTask = {};
function setTaskPriority(taskId, priority){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  if((t.priority || "P2") === priority) return;
  var seq = (priSeqByTask[taskId] || 0) + 1;
  priSeqByTask[taskId] = seq;
  var before = t.priority || null;
  patchTaskMirrors(t, {priority: priority});
  repaintTaskPatch();
  API.put("/api/tasks/" + encodeURIComponent(taskId), taskPayloadWith(t, {priority: priority})).then(function(){
    if(priSeqByTask[taskId] !== seq) return;
    toast("优先级已改为 " + priName(priority), "fs");
    refreshAfterTaskPatch(taskId);
  }).catch(function(ex){
    if(priSeqByTask[taskId] !== seq) return;
    patchTaskMirrors(t, {priority: before});
    repaintTaskPatch();
    toast(ex.message || "改优先级失败", "bad");
  });
}
function openPriorityMenu(anchor, taskId){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var cur = t.priority || "P2";
  var el = document.createElement("div");
  el.className = "menu";
  el.style.minWidth = "196px";
  el.innerHTML = '<div class="menu-title">改为优先级</div>' + PRIORITIES.map(function(p){
    return '<button class="menu-item" type="button" data-pri="' + p + '">' +
      priTagHTML(p) + (p === cur ? '<span class="k">当前</span>' : '') + '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-pri]");
    if(!b) return;
    UI.closeAllPops();
    setTaskPriority(taskId, b.dataset.pri);
  });
  UI.openPop(el, anchor, {align:"left", width:210, onClose: function(){ el.remove(); }});
  var first = el.querySelector(".menu-item");
  if(first){ try{ first.focus({preventScroll:true}); }catch(err){} }
}
/* 候选与批量改负责人同一口径：项目花名册 ∩ 空间可指派成员；花名册先回源再出菜单 */
function ownerCandidatesFor(t, wsId){
  var pid = t.reqId;
  if(!pid || !wsId) return Promise.resolve(ownerOptions(pid));
  return loadProjectMembers(wsId, pid, true).then(function(data){
    var byId = {};
    ((data && data.members) || []).forEach(function(m){ byId[m.userId] = m; });
    return ownerOptions(pid).filter(function(o){ return !!byId[o.id]; }).map(function(o){
      var m = byId[o.id];
      return { id:o.id, name:o.name, company:m.companyName || o.company, role:memberRoleTitles(m).join(" / ") || o.role };
    });
  });
}
var ownerSeqByTask = {};
function setTaskOwner(taskId, name, userId){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var before = {owner: t.owner || null, ownerUserId: t.ownerUserId || null};
  if((before.owner || "") === (name || "") && String(before.ownerUserId || "") === String(userId || "")) return;
  var seq = (ownerSeqByTask[taskId] || 0) + 1;
  ownerSeqByTask[taskId] = seq;
  var patch = {owner: name || null, ownerUserId: userId || null};
  patchTaskMirrors(t, patch);
  repaintTaskPatch();
  API.put("/api/tasks/" + encodeURIComponent(taskId), taskPayloadWith(t, patch)).then(function(){
    if(ownerSeqByTask[taskId] !== seq) return;
    toast(name ? ("负责人已改为「" + name + "」") : "已清除负责人", "fs");
    refreshAfterTaskPatch(taskId);
  }).catch(function(ex){
    if(ownerSeqByTask[taskId] !== seq) return;
    patchTaskMirrors(t, before);
    repaintTaskPatch();
    toast(ex.message || "改负责人失败", "bad");
  });
}
function openOwnerMenu(anchor, taskId){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var wsId = t.workspaceId || (rt.currentWs && rt.currentWs.id);
  var el = document.createElement("div"), disposed = false;
  el.className = "menu";
  el.innerHTML = '<div class="menu-title" role="status">正在加载可指派成员…</div>';
  function paint(options){
    if(disposed) return;
    var curId = t.ownerUserId ? String(t.ownerUserId) : "";
    el.innerHTML = '<div class="menu-title">改为负责人</div>' + (options.length ? options.map(function(o){
      var on = curId ? String(o.id) === curId : (!!t.owner && t.owner === o.name);
      var label = o.name + " · " + (o.role || "未设角色") + " · " + (o.company || "未标注公司");
      return '<button class="menu-item" type="button" data-owner-set="' + esc(o.id) + '" data-name="' + esc(o.name) + '" title="' + esc(label) + '">' +
        avatarHTML(o.name, "sm") + '<span style="white-space:normal">' + esc(label) + '</span>' +
        (on ? '<span class="k">当前</span>' : '') + '</button>';
    }).join("") : '<div class="menu-note">当前项目没有可指派成员</div>');
  }
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-owner-set]");
    if(!b) return;
    UI.closeAllPops();
    setTaskOwner(taskId, b.dataset.name, b.dataset.ownerSet);
  });
  UI.openPop(el, anchor, {align:"left", width:Math.min(360, window.innerWidth - 16), onClose: function(){ disposed = true; el.remove(); }});
  ownerCandidatesFor(t, wsId).then(paint).catch(function(ex){
    if(disposed) return;
    el.innerHTML = '<div class="menu-title" role="alert">' + esc(ex.message || "成员加载失败，请重试") + '</div>';
  });
}
function toggleTaskDone(taskId){
  var t = taskById(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var isDone = t.boardColumn === "done";
  /* 取消完成 = 回到「完成前所在列」，由后端按最后一次进入已完成列的移动日志还原；
     不是固定回「进行中」。目标列由后端决定，所以先请求；遇到 412/422 再补原因或强制。 */
  if(isDone){
    var wsId = t.workspaceId || (rt.currentWs && rt.currentWs.id);
    var items = [{ from: "done", title: t.title }];
    var retried = false;
    function reopenOk(res){
      var backCol = res && res.to ? colName(res.to) : "进行中";
      toast("已取消完成，回到「" + backCol + "」", "warn");
      loadBoard({animate:false, movedId: taskId});
      loadReqs();
      refreshListIfOpen();
      refreshCalendarIfOpen();
      refreshGanttIfOpen();
    }
    function reopenFail(ex){
      if(retried){ toast(ex.message || "操作失败", "bad"); return; }
      retried = true;
      serverDecision(wsId, items, null, ex).then(function(retry){
        if(!retry){ if(ex.code !== 412 && ex.code !== 422) toast(ex.message || "操作失败", "bad"); return; }
        API.post("/api/tasks/" + encodeURIComponent(taskId) + "/reopen", retry).then(reopenOk)
          .catch(function(e){ toast(e.message || "操作失败", "bad"); });
      });
    }
    API.post("/api/tasks/" + encodeURIComponent(taskId) + "/reopen", {}).then(reopenOk).catch(reopenFail);
    return;
  }
  guardedMove(t, "done", function(pass){
    var body = { column: "done" };
    if(pass.reason) body.reason = pass.reason;
    if(pass.force) body.force = true;
    return API.post("/api/tasks/" + encodeURIComponent(taskId) + "/move", body);
  }, function(res){
    var task = res.task;
    var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
    var doneMsg = dd > 0
      ? ("已完成工作项「" + task.title + "」，延期 " + dd + " 天完成")
      : ("已完成工作项「" + task.title + "」，按期完成");
    if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
    toast(doneMsg, dd > 0 ? "warn" : "fs");
    loadBoard({animate:false, movedId: task.id});
    loadReqs();
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  });
}
function openCardMenu(anchor, taskId){
  var t = taskById(taskId);
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var isCanceled = t.boardColumn === "canceled";
  var editable = canEditTask(t);
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html = '<button class="menu-item" type="button" data-cm="open">' + icon("edit", 14) + '打开详情</button>';
  if(editable && isCanceled){
    html += '<button class="menu-item" type="button" data-cm="restore">' + icon("undo", 14) +
      '恢复到「' + esc(t.cancelFrom ? colName(t.cancelFrom) : "第一个开列") + '」</button>';
  }
  if(editable && !isCanceled){
    html +=
      '<button class="menu-item" type="button" data-cm="due">' + icon("calSmall", 14) + '改期<span class="k">D</span></button>' +
      '<button class="menu-item" type="button" data-cm="done">' + icon(isDone ? "undo" : "check", 14) +
        (isDone ? "取消完成" : "标记完成") + '<span class="k">X</span></button>';
  }
  if((editable && !isCanceled) || running){
    /* 停止自己已开始的计时不受只读限制（与后端口径一致） */
    html += '<button class="menu-item" type="button" data-cm="timer">' + icon(running ? "pause" : "timer", 14) +
      (running ? "停止计时" : "开始计时") + '</button>';
  }
  html +=
    '<button class="menu-item" type="button" data-cm="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-cm="link">' + icon("extlink", 14) + '复制工作项链接</button>';
  var others = editable && !isCanceled ? COLUMNS.filter(function(c){ return c.id !== t.boardColumn; }) : [];
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-cm-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  if(editable){
    html += '<div class="menu-sep"></div>';
    /* 与原型一致：已完成卡片只留「取消完成（重开）」，取消入口不出现；
       已取消卡片只能恢复，不能再取消 */
    if(!isCanceled && !isDone){
      html += '<button class="menu-item" type="button" data-cm="cancel">' + icon("close", 14) + '取消工作项…</button>';
    }
    html += '<button class="menu-item danger" type="button" data-cm="del">' + icon("trash", 14) + '移到回收站</button>';
  }
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
      else if(k === "link") copyToClipboard(taskLink(t.id), "工作项链接已复制（可直接定位到该工作项）");
      else if(k === "cancel") openCancelDialog(t.id);
      else if(k === "restore") restoreCanceled(t.id);
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      UI.closeAllPops();
      moveTaskToColumn(t, mv.dataset.cmMove);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}

/* ===== 终态「已取消」：卡片菜单 / 抽屉 footer 共用同一套取消与恢复 ===== */
var CANCEL_REASONS = [
  ["not_do", "不做", "写清楚为什么不做，恢复时作为依据"],
  ["dup", "重复", "指向合并到哪一条"],
  ["deferred", "延期", "写清暂缓到什么时候、等什么"],
  ["design", "设计如此", "写清按哪条设计行为处理"]
];
/* 取消 / 恢复后各视图统一刷新：看板、列表、日历、甘特与已取消页 */
function refreshAfterTerminal(taskId){
  loadBoard({silent:true});
  loadReqs();
  refreshListIfOpen();
  refreshCalendarIfOpen();
  refreshGanttIfOpen();
  try{ window.dispatchEvent(new CustomEvent("ds:task-saved", { detail:{ id:taskId, created:false } })); }catch(e){ /* noop */ }
  import("../views/canceled.js").then(function(m){ if(m.refreshCanceledIfOpen) m.refreshCanceledIfOpen(); }).catch(function(){});
}
function findTask(taskId){
  return taskById(taskId) || rt.listCache[taskId] || taskCacheExtra[taskId] || null;
}
/** 取消工作项：原因四选一 + 说明必填；已完成要先取消完成，已取消直接转恢复 */
function openCancelDialog(taskId, onDone){
  var t = findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(t.boardColumn === "canceled"){ restoreCanceled(t.id, onDone); return; }
  if(t.boardColumn === "done"){ toast("已完成的工作项不能直接取消，请先取消完成", "warn"); return; }
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  var titleId = "cancelTaskTitle" + Date.now();
  layer.setAttribute("aria-labelledby", titleId);
  layer.innerHTML =
    '<form class="sheet xs" novalidate>' +
      '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0">' +
        '<h2 id="' + titleId + '">取消「' + esc(t.title) + '」</h2>' +
        '<div class="desc">取消后进入终态「已取消」：不计逾期、退出完成率分母，恢复时回到「' +
          esc(t.boardColumn ? colName(t.boardColumn) : "当前列") + '」。</div>' +
      '</div><button class="icon-btn sm" type="button" data-cn-x aria-label="关闭">' + icon("close", 15) + '</button></div>' +
      '<div class="sheet-body"><div class="stack">' +
        '<div class="field"><label for="' + titleId + 'Reason">取消原因</label>' +
          '<select id="' + titleId + 'Reason">' + CANCEL_REASONS.map(function(r){
            return '<option value="' + r[0] + '">' + r[1] + ' — ' + r[2] + '</option>';
          }).join("") + '</select></div>' +
        '<div class="field"><label for="' + titleId + 'Note">取消说明</label>' +
          '<textarea id="' + titleId + 'Note" rows="4" maxlength="250" placeholder="必填：写清为什么不做、后续怎么处理"></textarea>' +
          '<span class="foot-note">原因只用于解释与筛选，不参与状态判定。</span></div>' +
      '</div></div>' +
      '<div class="sheet-foot"><span class="hint">取消会通知负责人与关注者</span>' +
        '<button class="btn" type="button" data-cn-cancel>再想想</button>' +
        '<button class="btn danger" type="submit">确认取消</button>' +
      '</div>' +
    '</form>';
  document.body.appendChild(layer);
  var form = layer.querySelector("form");
  var sel = layer.querySelector("select");
  var note = layer.querySelector("textarea");
  var busy = false;
  function close(){
    UI.closeModal(layer);
    setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 220);
  }
  layer.__uiOnClose = close;
  layer.querySelector("[data-cn-x]").addEventListener("click", close);
  layer.querySelector("[data-cn-cancel]").addEventListener("click", close);
  form.addEventListener("submit", function(e){
    e.preventDefault();
    if(busy) return;
    var text = (note.value || "").trim();
    if(!text){
      toast("请填写取消说明", "warn");
      try{ note.focus(); }catch(err){ /* noop */ }
      return;
    }
    var reason = sel.value;
    var reasonName = (CANCEL_REASONS.filter(function(r){ return r[0] === reason; })[0] || [])[1] || reason;
    busy = true;
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = "取消中…";
    API.post("/api/tasks/" + encodeURIComponent(t.id) + "/cancel", { reason: reason, note: text }).then(function(res){
      busy = false;
      if(res && res.task && res.task.id) taskCacheExtra[res.task.id] = res.task;
      close();
      toast("已取消「" + t.title + "」（" + reasonName + "）", "warn");
      if(onDone) onDone(t);
      refreshAfterTerminal(t.id);
    }).catch(function(ex){
      busy = false;
      submit.disabled = false;
      submit.textContent = "确认取消";
      toast(ex.message || "取消失败", "bad");
    });
  });
  UI.openModal(layer, "textarea");
}

/** 恢复已取消：说明必填；onDone 由已取消页用来就地扣减列表与计数。
    task 供已取消页等「行数据不在看板缓存」的入口直接传入，避免查不到而静默返回 */
function restoreCanceled(taskId, onDone, task){
  var t = task || findTask(taskId);
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var target = t.cancelFrom ? colName(t.cancelFrom) : "第一个开列";
  UI.showPrompt({
    title: "恢复工作项",
    desc: "「" + t.title + "」将回到「" + target + "」。",
    label: "恢复说明",
    placeholder: "写清为什么捡回来（必填，会写进操作日志）",
    multiline: true,
    required: true,
    maxLength: 250,
    okText: "恢复"
  }).then(function(note){
    if(!note) return;
    return API.post("/api/tasks/" + encodeURIComponent(taskId) + "/uncancel", { note: note }).then(function(res){
      if(res && res.task && res.task.id) taskCacheExtra[res.task.id] = res.task;
      var landed = res && res.to ? colName(res.to) : target;
      toast("已恢复「" + t.title + "」到「" + landed + "」", "fs");
      if(onDone) onDone(res, t);
      refreshAfterTerminal(taskId);
    });
  }).catch(function(ex){ toast(ex.message || "恢复失败", "bad"); });
}

/* 发布快照里的只读实体引用（工作项 / 需求）：全局委托一次，version/phase/抽屉等宿主无需各接一遍。
   用 data-snap-* 专用属性，避免与各视图既有的 data-open-task 委托重复触发；按钮原生支持回车/空格。 */
document.addEventListener("click", function(e){
  var el = e.target.closest ? e.target.closest("[data-snap-task],[data-snap-demand]") : null;
  if(!el) return;
  var taskId = el.getAttribute("data-snap-task");
  if(taskId){ openTaskById(taskId); return; }
  var demandId = el.getAttribute("data-snap-demand");
  if(demandId){ import("../views/demands.js").then(function(m){ m.openDemandDetailById(demandId); }).catch(function(){}); }
});

/* 工作项链接（a[data-task-link]）：href 是真的深链，可复制、右键、Ctrl / ⌘ 或中键在新标签页打开；
   普通左键与回车仍留当前页开抽屉，不把视图跳走。 */
document.addEventListener("click", function(e){
  var a = e.target.closest ? e.target.closest("a[data-task-link]") : null;
  if(!a) return;
  if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  openTaskById(a.getAttribute("data-task-link"));
});

/* 高频视图关联纯文本的统一接线：data-jump-* 专用属性 + 捕获阶段全局委托。
   捕获阶段先于各视图「行点击开抽屉/下钻」的冒泡委托命中，stopPropagation 防止误开抽屉或误下钻；
   跳转全部复用现成 open* 助手（懒加载模块，避免循环依赖与首屏负担）。按钮原生支持回车/空格。 */
function assocJump(el){
  var project = el.getAttribute("data-jump-project");
  if(project){ rt.managerProjectId = project; showView("project"); return true; }
  var version = el.getAttribute("data-jump-version");
  if(version){
    var vreq = el.getAttribute("data-jump-req") || "";
    import("../views/version.js").then(function(m){ m.openVersionDetail(vreq, version); }).catch(function(){});
    return true;
  }
  var branch = el.getAttribute("data-jump-branch");
  if(branch){ import("../views/branches.js").then(function(m){ m.openBranchById(branch); }).catch(function(){}); return true; }
  var demand = el.getAttribute("data-jump-demand");
  if(demand){ import("../views/demands.js").then(function(m){ m.openDemandDetailById(demand); }).catch(function(){}); return true; }
  var kase = el.getAttribute("data-jump-case");
  if(kase){
    var creq = el.getAttribute("data-jump-req") || "";
    import("../views/testcases.js").then(function(m){ m.openCaseInProject(creq, kase); }).catch(function(){});
    return true;
  }
  var doc = el.getAttribute("data-jump-doc");
  if(doc){ import("../views/requirements.js").then(function(m){ m.openReqDocAndJump(doc); }).catch(function(){}); return true; }
  var task = el.getAttribute("data-jump-task");
  if(task){ openTaskById(task); return true; }
  return false;
}
document.addEventListener("click", function(e){
  var el = e.target.closest ? e.target.closest("[data-jump-project],[data-jump-version],[data-jump-branch],[data-jump-demand],[data-jump-case],[data-jump-doc],[data-jump-task]") : null;
  if(!el || !assocJump(el)) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

export { handleDeepLink, hashParam, loadRunningTimer, moveTaskToColumn, openCancelDialog, openCardMenu, openDuePopover, openOwnerMenu, openPriorityMenu, openStatusMenu, openTaskById, restoreCanceled, setTaskOwner, setTaskPriority, taskLink, toggleTaskDone, toggleTaskTimer };
