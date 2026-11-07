/* core/notifications · 通知中心与到期提醒 */

import { API } from "./api.js";
import { $, taskDrawer } from "./dom.js";
import { icon } from "./icons.js";
import { dueText, rt, state, taskCacheExtra } from "./state.js";
import { openTaskById } from "./task-actions.js";
import { UI, esc, toast } from "./ui.js";
import { askSwitchWorkspace, wsNameById } from "../views/mine.js";
import { priTagHTML } from "../lib/format.js";

var NOTIFY_ICON = {
  task_remind: "clock",
  task_due: "alert",
  task_assigned: "user",
  task_comment: "comment",
  task_watch: "eye",
  task_mention: "users",
  task_updated: "edit",
  daily_digest: "clock",
  demand_status: "list",
  doc_changed: "projects",
  branch_status: "branch",
  version_released: "tag",
  version_deleted: "trash",
  project_access: "shield",
  member_role: "user",
  member_removed: "users"
};
/* 只有任务类通知的 refTaskId 才是任务 ID；历史需求/文档/分支通知可能残留旧引用 */
var TASK_REF_TYPES = {
  task_remind: 1, task_due: 1, task_assigned: 1,
  task_comment: 1, task_mention: 1, task_watch: 1, task_updated: 1
};
function isTaskRef(type){ return !!TASK_REF_TYPES[type]; }
var notifyState = {unread:0, items:[], loading:false};
var bubbleTimer = null;
var lastBubbleId = 0;
try{ lastBubbleId = parseInt(sessionStorage.getItem("ds.lastUnreadId") || "0", 10) || 0; }catch(e){ /* 受限环境忽略 */ }
var deadlineGroups = {over:[], today:[], soon:[]};
try{ rt.alertTab = localStorage.getItem("ds.alertTab") === "due" ? "due" : "notice"; }
catch(e){ rt.alertTab = "notice"; }
function renderAlertBar(){
  var c = state.board ? state.board.counts : {over:0, today:0, soon:0};
  $("nOver").textContent = c.over;
  $("nToday").textContent = c.today;
  $("nSoon").textContent = c.soon;

  var chipOver = $("chipOver"), chipToday = $("chipToday"), chipSoon = $("chipSoon"), chipFocus = $("chipFocus");
  chipOver.setAttribute("aria-pressed", state.due === "over");
  chipToday.setAttribute("aria-pressed", state.due === "today");
  chipSoon.setAttribute("aria-pressed", state.due === "soon");
  chipFocus.setAttribute("aria-pressed", state.focus);

  chipOver.hidden  = !(c.over > 0 || state.due === "over");
  chipToday.hidden = !(c.today > 0 || state.due === "today");
  chipSoon.hidden  = !(c.soon > 0 || state.due === "soon");

  /* R-1：角标 = 未读通知数；紧急截止改用独立橙点，两件事不共用一个数字 */
  var urgent = c.over + c.today;
  var healthy = $("chipHealthy"), bUrgent = $("bellUrgent");
  if(bUrgent) bUrgent.hidden = !(urgent > 0);
  healthy.hidden = urgent > 0;
  if(urgent === 0){
    healthy.textContent = c.soon > 0 ? ("暂无逾期，最近一项 " + c.soon + " 天后到期") : "暂无逾期";
  }
  renderBellBadge();
  updateBellTitle();
}
function renderBellBadge(){
  var dot = $("alertDot");
  var n = notifyState.unread;
  if(dot){
    dot.hidden = n <= 0;
    dot.textContent = n > 99 ? "99+" : n;
  }
  var tabDot = document.getElementById("tabMsgDot");
  if(tabDot) tabDot.hidden = n <= 0;
  syncDocTitle();
}
/* 标题栏未读计数：切到别的标签页也能扫到；导航换标题后由 router 重新同步 */
function syncDocTitle(){
  var base = (document.title || "").replace(/^\(\d+\+?\)\s*/, "");
  if(!base) base = "沙漏";
  var n = notifyState.unread;
  document.title = (n > 0 ? "(" + (n > 99 ? "99+" : n) + ") " : "") + base;
}
function updateBellTitle(){
  var c = state.board ? state.board.counts : {over:0, today:0, soon:0};
  var parts = [];
  if(notifyState.unread > 0) parts.push("未读 " + notifyState.unread);
  if(c.over > 0) parts.push("逾期 " + c.over);
  if(c.today > 0) parts.push("今天到期 " + c.today);
  $("btnAlert").title = parts.length ? ("通知中心：" + parts.join(" · ")) : "通知中心";
}
function relTime(v){
  if(!v) return "";
  var s = String(v).replace(" ", "T");
  var d = new Date(s);
  if(isNaN(d.getTime())) return s.substring(0, 16).replace("T", " ");
  var diff = Date.now() - d.getTime();
  if(diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if(min < 1) return "刚刚";
  if(min < 60) return min + " 分钟前";
  var hr = Math.floor(min / 60);
  if(hr < 24) return hr + " 小时前";
  var day = Math.floor(hr / 24);
  if(day === 1) return "昨天";
  if(day < 30) return day + " 天前";
  return s.substring(0, 10);
}
var unreadFetchedAt = 0;
function loadUnread(force){
  var now = Date.now();
  if(!force && now - unreadFetchedAt < 3000) return Promise.resolve();
  unreadFetchedAt = now;
  return API.getGlobal("/api/notifications/unread").then(function(d){
    var n = (d && d.unread) || 0;
    var prev = notifyState.unread;
    var changed = n !== prev;
    notifyState.unread = n;
    renderBellBadge();
    updateBellTitle();
    if(changed){
      if(!$("alertPanel").hidden && rt.alertTab === "notice") loadNoticeList();
      if(n > prev) maybeUnreadBubble();
    }
  }).catch(function(){ /* 通知是增强能力：失败静默，不打扰用户 */ });
}
function renderAlertPanel(){
  var panel = $("alertPanel");
  if(!panel) return;
  var unread = notifyState.unread;
  var html = '<div class="ap-tabs" role="tablist">' +
      '<button class="ap-tab" type="button" role="tab" data-ap-tab="notice" aria-selected="' + (rt.alertTab === "notice") + '">' +
        icon("bell", 14) + '通知' +
        (unread > 0 ? '<span class="n">' + (unread > 99 ? "99+" : unread) + '</span>' : '') +
      '</button>' +
      '<button class="ap-tab" type="button" role="tab" data-ap-tab="due" aria-selected="' + (rt.alertTab === "due") + '">' +
        icon("clock", 14) + '截止提醒' +
      '</button>' +
    '</div><div class="ap-body">' +
      (rt.alertTab === "notice" ? noticeListHTML() : dueGroupsHTML()) +
    '</div>';

  if(rt.alertTab === "notice"){
    if(unread > 0){
      html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-readall>全部标为已读</button></div>';
    }
  }else if(rt.currentWs && rt.currentWs.myRole === "owner"){
    html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-test>在空间中测试推送</button></div>';
  }
  panel.innerHTML = html;
}
function noticeListHTML(){
  if(notifyState.loading && !notifyState.items.length) return UI.skeletonRows(4);
  if(!notifyState.items.length){
    return '<div class="ap-empty">' + icon("checkCircle", 22) +
      '<div style="margin-top:6px">还没有通知</div>' +
      '<div class="ap-empty-sub">任务到点提醒、评论与指派都会出现在这里</div></div>';
  }
  var unread = [], read = [];
  notifyState.items.forEach(function(x){ (x.readAt ? read : unread).push(x); });
  var html = "";
  if(unread.length){
    html += '<div class="ap-glabel">未读 ' + unread.length + '</div>' + noticeGroupsHTML(unread);
  }
  if(read.length){
    html += '<div class="ap-glabel" style="margin-top:6px">已读 ' + read.length + '</div>' + noticeGroupsHTML(read);
  }
  return html;
}
/* 连续的同任务 + 同类型通知合并为一条：避免一次编辑/关注刷出十几条近似消息 */
function noticeGroupsHTML(items){
  var groups = [];
  items.forEach(function(x){
    var last = groups[groups.length - 1];
    if(last && x.refTaskId && last.lead.refTaskId === x.refTaskId && last.lead.type === x.type){
      last.items.push(x);
      return;
    }
    groups.push({lead:x, items:[x]});
  });
  return groups.map(noticeItemHTML).join("");
}
function noticeItemHTML(g){
  var x = g.lead;
  var count = g.items.length;
  var ids = g.items.map(function(n){ return n.id; }).join(",");
  var ic = NOTIFY_ICON[x.type] || "bell";
  return '<button class="apn' + (x.readAt ? "" : " unread") + '" type="button"' +
    ' data-apn="' + esc(x.id) + '" data-apn-ids="' + esc(ids) + '"' +
    (isTaskRef(x.type) && x.refTaskId ? ' data-apn-task="' + esc(x.refTaskId) + '"' : "") +
    (x.workspaceId ? ' data-apn-ws="' + esc(x.workspaceId) + '"' : "") +
    ' title="' + esc(x.title) + '">' +
    '<span class="apn-ic">' + icon(ic, 13) + '</span>' +
    '<span class="apn-main">' +
      '<span class="apn-title">' + esc(x.title) +
        (count > 1 ? ' <span class="apn-count">×' + count + '</span>' : "") + '</span>' +
      (x.body ? '<span class="apn-body">' + esc(x.body) + '</span>' : "") +
      '<span class="apn-meta">' + esc(relTime(x.createdAt)) +
        (count > 1 ? " · 共 " + count + " 条同类通知" : "") +
        (x.workspaceName ? " · " + esc(x.workspaceName) : "") + '</span>' +
    '</span>' +
    (x.readAt ? "" : '<i class="apn-dot"></i>') +
  '</button>';
}
function dueGroupsHTML(){
  var g = deadlineGroups;
  var total = g.over.length + g.today.length + g.soon.length;
  var html = "";
  function group(cls, label, list){
    if(!list.length) return;
    html += '<div class="ap-group ' + cls + '"><div class="ap-glabel"><i></i>' + label + ' ' + list.length + '</div>';
    list.forEach(function(t){
      html += '<button class="ap-item" type="button" data-ap-task="' + esc(t.id) + '">' +
        priTagHTML(t.priority) +
        '<span class="apt">' + esc(t.title) + '</span>' +
        '<span class="' + (cls === "over" ? "meta over" : (cls === "today" ? "meta today" : "meta ok")) + '">' + esc(dueText(t)) + '</span>' +
      '</button>';
    });
    html += '</div>';
  }
  group("over","已逾期", g.over);
  group("today","今天到期", g.today);
  group("soon","3 天内", g.soon);
  if(!total){
    html += '<div class="ap-empty">' + icon("checkCircle", 22) + '<div style="margin-top:6px">节奏健康，没有逾期或临期任务</div></div>';
  }
  return html;
}
function loadAlertPanel(){
  if(rt.alertTab === "notice") return loadNoticeList();
  return loadDeadlineGroups();
}
function loadNoticeList(){
  notifyState.loading = true;
  if(!notifyState.items.length) renderAlertPanel();
  return API.getGlobal("/api/notifications", {limit: 30}).then(function(d){
    notifyState.loading = false;
    notifyState.items = (d && d.items) || [];
    if(d && typeof d.unread === "number") notifyState.unread = d.unread;
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }).catch(function(){
    notifyState.loading = false;
    notifyState.items = [];
    renderAlertPanel();
  });
}
function loadDeadlineGroups(){
  function fetchGroup(due){
    return API.get("/api/tasks/list", {due: due, sort:"due"}).then(function(d){
      var items = (d.items || []).slice(0, 5);
      items.forEach(function(t){ taskCacheExtra[t.id] = t; });
      return items;
    }).catch(function(){ return []; });
  }
  return Promise.all([fetchGroup("over"), fetchGroup("today"), fetchGroup("soon")]).then(function(r){
    deadlineGroups = {over:r[0], today:r[1], soon:r[2]};
    renderAlertPanel();
  });
}
/* 未读数增加且前台空闲时，右上角浮出最新一条通知（点击进通知中心） */
function maybeUnreadBubble(){
  if(document.hidden) return;
  if(UI.anyDialogOpen()) return;
  if(!$("alertPanel") || !$("alertPanel").hidden) return;
  if(taskDrawer && taskDrawer.classList.contains("on")) return;
  API.getGlobal("/api/notifications", {limit:1}).then(function(d){
    var it = d && d.items && d.items[0];
    if(!it || it.readAt || it.id === lastBubbleId) return;
    lastBubbleId = it.id;
    try{ sessionStorage.setItem("ds.lastUnreadId", String(it.id)); }catch(e){ /* 受限环境忽略 */ }
    showUnreadBubble(it);
  }).catch(function(){ /* 气泡是增强能力：失败静默 */ });
}
function showUnreadBubble(it){
  var b = $("unreadBubble");
  if(!b) return;
  $("unreadBubbleIcon").innerHTML = icon(NOTIFY_ICON[it.type] || "bell", 14);
  $("unreadBubbleTitle").textContent = it.title || "收到新通知";
  $("unreadBubbleMeta").textContent = relTime(it.createdAt) + (it.workspaceName ? " · " + it.workspaceName : "");
  b.classList.remove("leaving");
  b.hidden = false;
  if(bubbleTimer){ clearTimeout(bubbleTimer); bubbleTimer = null; }
  bubbleTimer = setTimeout(hideUnreadBubble, 6000);
}
function hideUnreadBubble(){
  var b = $("unreadBubble");
  if(!b) return;
  if(bubbleTimer){ clearTimeout(bubbleTimer); bubbleTimer = null; }
  b.classList.add("leaving");
  bubbleTimer = setTimeout(function(){
    if(!$("unreadBubble")) return;
    b.hidden = true;
    b.classList.remove("leaving");
  }, 260);
}
function openAlertCenterFromBubble(){
  var panel = $("alertPanel"), bell = $("btnAlert");
  if(!panel || !bell || UI.popOpen(panel)) return;
  if(rt.alertTab !== "notice"){
    rt.alertTab = "notice";
    try{ localStorage.setItem("ds.alertTab", "notice"); }catch(e){ /* 受限环境忽略 */ }
  }
  renderAlertPanel();
  loadAlertPanel();
  loadUnread();
  UI.openPop(panel, bell, {align:"left"});
}
function openFromNotification(ds){
  var taskId = ds.apnTask || "";
  var wsId = ds.apnWs || "";
  var ids = String(ds.apnIds || ds.apn || "").split(",").map(Number).filter(function(n){ return n > 0; });
  var item = null;
  var marked = 0;
  /* 聚合条目一次标掉组内全部通知，避免点开任务后还剩一串未读 */
  ids.forEach(function(nid){
    for(var i = 0; i < notifyState.items.length; i++){
      var n = notifyState.items[i];
      if(n.id !== nid) continue;
      if(!item) item = n;
      if(!n.readAt){
        n.readAt = new Date().toISOString();
        marked++;
        API.postGlobal("/api/notifications/" + nid + "/read").catch(function(){ /* 已读失败不阻断打开 */ });
      }
      break;
    }
  });
  if(marked > 0){
    notifyState.unread = Math.max(0, notifyState.unread - marked);
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }
  if(!taskId){
    toast(item && item.body ? item.body : (item ? item.title : "已读"));
    return;
  }
  if(wsId && rt.currentWs && wsId !== rt.currentWs.id){
    /* 跨空间通知：先二次确认（切空间会 reload，别让人点一下就被带走） */
    askSwitchWorkspace(wsId, (item && item.workspaceName) || wsNameById(wsId), {
      title: "打开其他空间的任务",
      okText: "切换并打开",
      taskTitle: item ? item.title : "",
      openTaskId: taskId
    });
    return;
  }
  openTaskById(taskId);
}

(function(){
  var b = $("unreadBubble");
  if(!b) return;
  $("unreadBubbleMain").addEventListener("click", function(){
    hideUnreadBubble();
    openAlertCenterFromBubble();
  });
  $("unreadBubbleX").addEventListener("click", hideUnreadBubble);
})();

export { loadAlertPanel, loadUnread, notifyState, openFromNotification, renderAlertBar, renderAlertPanel, renderBellBadge, syncDocTitle, updateBellTitle };
