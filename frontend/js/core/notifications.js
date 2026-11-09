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
  member_removed: "users",
  manager_nudge: "alert"
};
/* 只有任务类通知的 refTaskId 才是任务 ID；需求/文档/分支等走 refKind + refId */
var TASK_REF_TYPES = {
  task_remind: 1, task_due: 1, task_assigned: 1,
  task_comment: 1, task_mention: 1, task_watch: 1, task_updated: 1,
  manager_nudge: 1
};
function isTaskRef(type){ return !!TASK_REF_TYPES[type]; }
var notifyState = {unread:0, total:0, mentions:0, items:[], loading:false};
var noticeMutationSeq = 0, unreadReqSeq = 0, noticeListReqSeq = 0;
function invalidateNotifications(){ noticeMutationSeq++; }
var bubbleTimer = null;
var lastBubbleId = 0;
try{ lastBubbleId = parseInt(sessionStorage.getItem("ds.lastUnreadId") || "0", 10) || 0; }catch(e){ /* 受限环境忽略 */ }
var deadlineGroups = {over:[], today:[], soon:[]};
try{ rt.alertTab = localStorage.getItem("ds.alertTab") === "due" ? "due" : "notice"; }
catch(e){ rt.alertTab = "notice"; }
/* 通知筛选：全部 / 未读 / 提及（提及=有人 @ 到我） */
try{ rt.noticeFilter = ["unread", "mention"].indexOf(localStorage.getItem("ds.noticeFilter")) >= 0 ? localStorage.getItem("ds.noticeFilter") : "all"; }
catch(e){ rt.noticeFilter = "all"; }
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
  var req = ++unreadReqSeq, mutation = noticeMutationSeq;
  return API.getGlobal("/api/notifications/unread").then(function(d){
    if(req !== unreadReqSeq || mutation !== noticeMutationSeq) return;
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
function alertCenterHTML(){
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
      (rt.alertTab === "notice" ? noticeFilterHTML() + noticeListHTML() : dueGroupsHTML()) +
    '</div>';

  if(rt.alertTab === "notice"){
    if(unread > 0){
      html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-readall>全部标为已读</button></div>';
    }
  }else if(rt.currentWs && rt.currentWs.myRole === "owner"){
    html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-test>在空间中测试推送</button></div>';
  }
  return html;
}
function renderAlertPanel(){
  var panel = $("alertPanel");
  if(!panel) return;
  panel.innerHTML = alertCenterHTML();
  renderMessagesPage();
}
/* 消息页与右上角通知面板共用同一套结构，避免两处口径漂移 */
function renderMessagesPage(){
  var box = $("messagesBody");
  if(!box) return;
  var view = box.closest(".view");
  if(view && !view.classList.contains("on")) return;
  box.innerHTML = '<div class="alert-panel msg-center">' + alertCenterHTML() + '</div>';
}
function enterMessagesView(){
  renderMessagesPage();
  loadUnread(true);
  loadAlertPanel();
}
function handleNoticeClick(e){
  /* 通知筛选：全部 / 未读 / 提及 */
  var filterBtn = e.target.closest("[data-ap-filter]");
  if(filterBtn){
    setNoticeFilter(filterBtn.dataset.apFilter);
    return;
  }
  /* 顶部 tab：通知 / 截止提醒 */
  var tabBtn = e.target.closest("[data-ap-tab]");
  if(tabBtn){
    var next = tabBtn.dataset.apTab === "due" ? "due" : "notice";
    if(next !== rt.alertTab){
      rt.alertTab = next;
      try{ localStorage.setItem("ds.alertTab", rt.alertTab); }catch(err){ /* 受限环境忽略 */ }
      renderAlertPanel();
      loadAlertPanel();
    }
    return;
  }
  /* 全部标为已读 */
  if(e.target.closest("[data-ap-readall]")){
    invalidateNotifications();
    API.postGlobal("/api/notifications/read-all").then(function(){
      notifyState.items.forEach(function(x){ if(!x.readAt) x.readAt = new Date().toISOString(); });
      notifyState.unread = 0;
      renderBellBadge(); updateBellTitle(); renderAlertPanel();
      loadAlertPanel();
      loadUnread(true);
      toast("已全部标为已读", "fs");
    }).catch(function(ex){
      loadAlertPanel();
      loadUnread(true);
      toast(ex.message || "操作失败", "bad");
    });
    return;
  }
  /* 通知项：标记已读 + 打开关联任务 */
  var apn = e.target.closest("[data-apn]");
  if(apn){
    UI.closeAllPops();
    openFromNotification(apn.dataset);
    return;
  }
  var t = e.target.closest("[data-ap-task]");
  if(t){
    UI.closeAllPops();
    var taskId = t.dataset.apTask;
    /* 动态引入，避免 notifications ↔ task-drawer ↔ router 的静态循环依赖 */
    import("./task-actions.js").then(function(m){ m.openTaskById(taskId); });
    return;
  }
  if(e.target.closest("[data-ap-test]")){
    UI.closeAllPops();
    import("../views/settings.js").then(function(){
      var b = $("btnNotifyTest");
      if(b) b.click();
    }).catch(function(){ toast("请在「设置 · 通知与集成」中测试推送", "warn"); });
  }
}
function noticeFilterHTML(){
  /* 计数只给「读完能归零」的行动量：未读与未读提及。
     「全部」是保留期内的历史库存，标记已读也不会让它变小，显示数字反而会被读成待办量，故只留标签。
     计数来自服务端全量统计；列表只返回当前筛选的一页，不能拿列表长度当计数。 */
  var unread = notifyState.unread || 0;
  var mentions = notifyState.mentions || 0;
  function tab(key, label, n){
    return '<button class="ap-filter" type="button" data-ap-filter="' + key + '" aria-pressed="' + (rt.noticeFilter === key) + '">'
      + label + (n ? '<span class="n">' + (n > 99 ? "99+" : n) + '</span>' : '') + '</button>';
  }
  return '<div class="ap-filters" role="group" aria-label="通知筛选">'
    + tab("all", "全部") + tab("unread", "未读", unread) + tab("mention", "提及", mentions)
    + '</div>';
}
function dayKey(v){
  var s = String(v || "");
  return s.length >= 10 ? s.slice(0, 10) : "";
}
function dayLabel(key){
  if(!key) return "更早";
  var d = new Date(key + "T00:00:00");
  if(isNaN(d.getTime())) return key;
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = Math.round((today - d) / 86400000);
  if(diff <= 0) return "今天";
  if(diff === 1) return "昨天";
  return key;
}
function noticeListHTML(){
  if(notifyState.loading && !notifyState.items.length) return UI.skeletonRows(4);
  if(!notifyState.items.length){
    return '<div class="ap-empty">' + icon("checkCircle", 22) +
      '<div style="margin-top:6px">还没有通知</div>' +
      '<div class="ap-empty-sub">工作项到点提醒、评论与指派都会出现在这里</div></div>';
  }
  var items = notifyState.items;
  if(rt.noticeFilter === "unread") items = items.filter(function(x){ return !x.readAt; });
  else if(rt.noticeFilter === "mention") items = items.filter(function(x){ return x.type === "task_mention"; });
  if(!items.length){
    return '<div class="ap-empty">' + icon("checkCircle", 22) +
      '<div style="margin-top:6px">' + (rt.noticeFilter === "mention" ? "没有 @ 到我的通知" : "没有未读通知") + '</div>' +
      '<div class="ap-empty-sub">切换「全部」查看历史通知</div></div>';
  }
  var unread = [], read = [];
  items.forEach(function(x){ (x.readAt ? read : unread).push(x); });
  var html = "";
  if(unread.length){
    html += '<div class="ap-glabel">未读 ' + unread.length + '</div>' + noticeGroupsHTML(unread);
  }
  if(read.length){
    /* 「已读」是历史，数字既不指向待办也清不掉，标题只作分区用 */
    html += '<div class="ap-glabel" style="margin-top:6px">已读</div>' + noticeGroupsHTML(read);
  }
  return html;
}
/* 连续的同任务 + 同类型通知合并为一条：避免一次编辑/关注刷出十几条近似消息；再按自然日分组 */
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
  var html = "", day = null;
  groups.forEach(function(g){
    var k = dayKey(g.lead.createdAt);
    if(k !== day){
      day = k;
      html += '<div class="ap-day">' + esc(dayLabel(k)) + '</div>';
    }
    html += noticeItemHTML(g);
  });
  return html;
}
function noticeItemHTML(g){
  var x = g.lead;
  var count = g.items.length;
  var ids = g.items.map(function(n){ return n.id; }).join(",");
  var ic = NOTIFY_ICON[x.type] || "bell";
  return '<button class="apn' + (x.readAt ? "" : " unread") + '" type="button"' +
    ' data-apn="' + esc(x.id) + '" data-apn-ids="' + esc(ids) + '"' +
    (isTaskRef(x.type) && x.refTaskId ? ' data-apn-task="' + esc(x.refTaskId) + '"' : "") +
    (!isTaskRef(x.type) && x.refKind && x.refId
      ? ' data-apn-kind="' + esc(x.refKind) + '" data-apn-ref="' + esc(x.refId) + '"' : "") +
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
    html += '<div class="ap-empty">' + icon("checkCircle", 22) + '<div style="margin-top:6px">节奏健康，没有逾期或临期工作项</div></div>';
  }
  return html;
}
function loadAlertPanel(){
  if(rt.alertTab === "notice") return loadNoticeList();
  return loadDeadlineGroups();
}
function loadNoticeList(){
  var req = ++noticeListReqSeq, mutation = noticeMutationSeq;
  notifyState.loading = true;
  if(!notifyState.items.length) renderAlertPanel();
  /* 服务端按 all/unread/mention 过滤，并返回全量计数，避免「加载 200 条再本地数」失真 */
  return API.getGlobal("/api/notifications", {limit: 100, filter: rt.noticeFilter}).then(function(d){
    if(req !== noticeListReqSeq || mutation !== noticeMutationSeq) return;
    notifyState.loading = false;
    notifyState.items = (d && d.items) || [];
    if(d && typeof d.unread === "number") notifyState.unread = d.unread;
    if(d && typeof d.total === "number") notifyState.total = d.total; /* 服务端仍返回总量，前端不展示（见 noticeFilterHTML） */
    if(d && typeof d.mentions === "number") notifyState.mentions = d.mentions; /* 口径：未读的 @ 我的通知数 */
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }).catch(function(){
    if(req !== noticeListReqSeq || mutation !== noticeMutationSeq) return;
    notifyState.loading = false;
    notifyState.items = [];
    renderAlertPanel();
  });
}
/* 切换「全部 / 未读 / 提及」：清空旧列表并重新按服务端筛选拉取 */
function setNoticeFilter(f){
  if(f !== "unread" && f !== "mention") f = "all";
  if(f === rt.noticeFilter) return;
  rt.noticeFilter = f;
  try{ localStorage.setItem("ds.noticeFilter", f); }catch(e){ /* 受限环境忽略 */ }
  notifyState.items = [];
  notifyState.loading = true;
  renderAlertPanel();
  loadNoticeList();
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
/* 非任务通知深链：kind 决定目标页面，模块按需加载，避免通知中心与各视图循环依赖 */
function routeNotificationLink(kind, refId, type){
  if(!kind || !refId) return false;
  function go(view, open){
    Promise.all([import("./router.js"), import("./view-loader.js")]).then(function(mods){
      var showView = mods[0].showView, loadView = mods[1].loadView;
      return showView(view).then(function(){
        return loadView(view).then(function(m){ if(open) open(m); });
      });
    }).catch(function(){
      toast("无法打开通知关联内容，请手动前往对应页面", "warn");
    });
  }
  if(kind === "demand"){ go("demands", function(m){ m.openDemandById(refId); }); return true; }
  if(kind === "doc"){ go("requirements", function(m){ m.openReqDocAndJump(refId); }); return true; }
  if(kind === "branch"){ go("branches", function(m){ if(m.openBranchById) m.openBranchById(refId); }); return true; }
  if(kind === "version"){
    if(type === "version_deleted"){
      go("phase", function(){ toast("该版本已删除，可在版本列表中查看历史", "warn"); });
      return true;
    }
    go("phase", function(m){ if(m.showReleaseNote) m.showReleaseNote(refId); });
    return true;
  }
  if(kind === "project"){
    rt.managerProjectId = refId;
    go("project");
    return true;
  }
  if(kind === "workspace"){ go("settings"); return true; }
  return false;
}
function openFromNotification(ds){
  var taskId = ds.apnTask || "";
  var refKind = ds.apnKind || "";
  var refId = ds.apnRef || "";
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
    invalidateNotifications();
    notifyState.unread = Math.max(0, notifyState.unread - marked);
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }
  var canDeepLink = !!taskId || !!(refKind && refId);
  if(!canDeepLink){
    toast(item && item.body ? item.body : (item ? item.title : "已读"));
    return;
  }
  if(wsId && rt.currentWs && wsId !== rt.currentWs.id){
    /* 跨空间通知：先二次确认（切空间会 reload，别让人点一下就被带走） */
    askSwitchWorkspace(wsId, (item && item.workspaceName) || wsNameById(wsId), taskId ? {
      title: "打开其他空间的工作项",
      okText: "切换并打开",
      taskTitle: item ? item.title : "",
      openTaskId: taskId
    } : {
      title: "打开其他空间的通知",
      okText: "切换并打开",
      linkTitle: item ? item.title : "",
      openLink: { kind: refKind, id: refId, type: item ? item.type : "" }
    });
    return;
  }
  if(taskId){
    openTaskById(taskId);
    return;
  }
  routeNotificationLink(refKind, refId, item ? item.type : "");
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

export { enterMessagesView, handleNoticeClick, invalidateNotifications, loadAlertPanel, loadUnread, notifyState, openFromNotification, renderAlertBar, renderAlertPanel, renderBellBadge, renderMessagesPage, routeNotificationLink, setNoticeFilter, syncDocTitle, updateBellTitle };
