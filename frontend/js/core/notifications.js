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
  demand_watch: "eye",
  test_plan_assigned: "check",
  doc_changed: "projects",
  branch_status: "branch",
  version_released: "tag",
  version_deleted: "trash",
  release_prep: "bell",
  release_watch: "star",
  project_access: "shield",
  member_role: "user",
  member_removed: "users",
  manager_nudge: "alert",
  weekly_report: "calendar",
  version_report: "stats"
};
/* 只有任务类通知的 refTaskId 才是任务 ID；需求/文档/分支等走 refKind + refId */
var TASK_REF_TYPES = {
  task_remind: 1, task_due: 1, task_assigned: 1,
  task_comment: 1, task_mention: 1, task_watch: 1, task_updated: 1,
  manager_nudge: 1
};
function isTaskRef(type){ return !!TASK_REF_TYPES[type]; }
/* 新提及写 task_mention；历史合并期的提及曾写 task_comment，标题固定以「…」提到了你 结尾 */
function isMentionNotice(x){
  return !!x && (x.type === "task_mention"
    || (x.type === "task_comment" && /」提到了你$/.test(String(x.title || ""))));
}
/* typeCounts 是服务端按当前筛选返回的类型全量计数：列表只加载一页，不能拿 items 回算 */
var notifyState = {unread:0, total:0, mentions:0, items:[], loading:false, hasMore:false, typeCounts:null,
  expanded:{}, watch:{}};
/* 正文最多两行：报告与发布准备需要看全时给「展开」，不改变其他类型的紧凑列表 */
var EXPANDABLE_TYPES = { weekly_report:1, version_report:1, release_prep:1 };
var noticeMutationSeq = 0, unreadReqSeq = 0, noticeListReqSeq = 0;
function invalidateNotifications(){
  noticeMutationSeq++;
  /* 作废在途列表请求时同步复位 loading，否则「加载更多」会被永久拦住 */
  notifyState.loading = false;
}
var bubbleTimer = null;
var lastBubbleId = 0;
try{ lastBubbleId = parseInt(sessionStorage.getItem("ds.lastUnreadId") || "0", 10) || 0; }catch(e){ /* 受限环境忽略 */ }
var deadlineGroups = {over:[], today:[], soon:[]};
try{ rt.alertTab = localStorage.getItem("ds.alertTab") === "due" ? "due" : "notice"; }
catch(e){ rt.alertTab = "notice"; }
/* 通知筛选：全部 / 未读 / 提及（提及=有人 @ 到我） */
try{ rt.noticeFilter = ["unread", "mention"].indexOf(localStorage.getItem("ds.noticeFilter")) >= 0 ? localStorage.getItem("ds.noticeFilter") : "all"; }
catch(e){ rt.noticeFilter = "all"; }
/* 消息页的类型筛选只作用于已加载列表；类型按业务域归类，避免出现空类目 */
var msgType = "";
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
    syncMessagesReadAllButton();
    if(changed){
      if(!$("alertPanel").hidden && rt.alertTab === "notice") loadNoticeList();
      if(n > prev) maybeUnreadBubble();
    }
  }).catch(function(){ /* 通知是增强能力：失败静默，不打扰用户 */ });
}
function alertCenterHTML(isPage){
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

  var foot = "";
  /* 面板是浮层，需要一条去完整消息页的出口；消息页自身不再重复显示 */
  if(!isPage && document.body.dataset.view !== "messages") foot += '<button class="btn sm" type="button" data-ap-all title="打开消息中心，与这个面板同一份数据">查看全部</button>';
  if(rt.alertTab === "notice"){
    /* 消息页把「一键已读」放到页头常驻；浮层面板仍放在底部，按未读数显隐 */
    if(!isPage && unread > 0) foot += '<button class="btn sm soft" type="button" data-ap-readall>' + icon("check", 13) + '全部标为已读</button>';
  }else if(rt.currentWs && rt.currentWs.myRole === "owner"){
    foot += '<button class="btn sm" type="button" data-ap-test>在空间中测试推送</button>';
  }
  if(foot) html += '<div class="ap-foot">' + foot + '</div>';
  return html;
}
function renderAlertPanel(){
  var panel = $("alertPanel");
  if(!panel) return;
  panel.innerHTML = alertCenterHTML();
  renderMessagesPage();
}
/* 消息页与右上角通知面板共用同一份数据；页面是「左范围 + 按类型 + 时间流」两栏布局 */
var MSG_TYPE_META = [
  { key:"work", label:"工作项", types:["task_remind","task_due","task_assigned","task_watch","task_updated","manager_nudge"] },
  { key:"doc", label:"文档", types:["doc_changed"] },
  { key:"version", label:"发布", types:["version_released","version_deleted","branch_status","release_prep","release_watch"] },
  { key:"demand", label:"需求", types:["demand_status","demand_watch"] },
  { key:"test", label:"测试", types:["test_plan_assigned"] },
  { key:"report", label:"报告", types:["weekly_report","version_report"] },
  { key:"comment", label:"评论", types:["task_comment","task_mention"] },
  { key:"member", label:"成员与角色", types:["project_access","member_role","member_removed"] }
];
function msgTypeOf(type){
  for(var i = 0; i < MSG_TYPE_META.length; i++) if(MSG_TYPE_META[i].types.indexOf(type) >= 0) return MSG_TYPE_META[i].key;
  return "other";
}
/* 当前「全部 / 未读 / 提及」筛选下的本地条目；类型筛选由调用方另加 */
function msgFilteredItems(){
  var items = notifyState.items || [];
  if(rt.noticeFilter === "unread") items = items.filter(function(x){ return !x.readAt; });
  else if(rt.noticeFilter === "mention") items = items.filter(isMentionNotice);
  return items;
}
function msgTypeCounts(){
  var m = {};
  var raw = notifyState.typeCounts;
  if(raw && typeof raw === "object"){
    Object.keys(raw).forEach(function(t){
      var k = msgTypeOf(t);
      m[k] = (m[k] || 0) + (Number(raw[t]) || 0);
    });
    return m;
  }
  /* 旧服务端没有 typeCounts 时退回本地计数，保证类型按钮仍可用 */
  msgFilteredItems().forEach(function(x){ var k = msgTypeOf(x.type); m[k] = (m[k] || 0) + 1; });
  return m;
}
/* 服务端类型计数只在重新拉列表时刷新；未读筛选下本地标已读后同步扣减，避免页签数字大于列表 */
function dropUnreadTypeCounts(types){
  if(rt.noticeFilter !== "unread" || !notifyState.typeCounts) return;
  types.forEach(function(t){
    var n = Number(notifyState.typeCounts[t]) || 0;
    if(n <= 1) delete notifyState.typeCounts[t];
    else notifyState.typeCounts[t] = n - 1;
  });
}
function msgPageItems(){
  var items = msgFilteredItems();
  if(msgType) items = items.filter(function(x){ return msgTypeOf(x.type) === msgType; });
  return items;
}
function msgRailItem(attr, key, label, n, active){
  return '<button class="msg-rail-item' + (active ? " on" : "") + '" type="button" ' + attr + (key ? '="' + key + '"' : "") +
    ' aria-pressed="' + active + '"><span>' + esc(label) + '</span>' + (n ? '<span class="n">' + (n > 99 ? "99+" : n) + '</span>' : '') + '</button>';
}
function msgTypeCountSpan(n){
  return n ? ' <span class="n">' + (n > 99 ? "99+" : n) + '</span>' : '';
}
function msgTypeChips(){
  var counts = msgTypeCounts();
  var html = '<button class="msg-chip' + (msgType ? "" : " on") + '" type="button" data-msg-type="" aria-pressed="' + (!msgType) + '">全部类型</button>';
  MSG_TYPE_META.forEach(function(m){
    var n = counts[m.key] || 0;
    if(!n && msgType !== m.key) return;
    /* 页签是否出现由服务端全量计数决定：历史消息没加载到也要保留入口；计数随当前筛选变化 */
    html += '<button class="msg-chip' + (msgType === m.key ? " on" : "") + '" type="button" data-msg-type="' + m.key + '" aria-pressed="' + (msgType === m.key) + '">'
      + esc(m.label) + msgTypeCountSpan(n) + '</button>';
  });
  if(counts.other || msgType === "other"){
    html += '<button class="msg-chip' + (msgType === "other" ? " on" : "") + '" type="button" data-msg-type="other" aria-pressed="' + (msgType === "other") + '">'
      + '其他' + msgTypeCountSpan(counts.other || 0) + '</button>';
  }
  return html;
}
function msgPageListHTML(){
  if(notifyState.loading && !notifyState.items.length) return UI.skeletonRows(5);
  var items = msgPageItems();
  if(!items.length){
    var what = rt.noticeFilter === "mention" ? "没有 @ 到我的通知" : (rt.noticeFilter === "unread" ? "没有未读通知" : "还没有通知");
    return '<div class="ap-empty">' + icon("checkCircle", 22) + '<div style="margin-top:6px">' + what + '</div>'
      + '<div class="ap-empty-sub">' + (rt.noticeFilter === "all" ? "工作项到点提醒、评论与指派都会出现在这里" : "切换「全部」查看历史通知") + '</div></div>';
  }
  return noticeGroupsHTML(items);
}
function setAlertTab(next){
  next = next === "due" ? "due" : "notice";
  if(next === rt.alertTab) return;
  rt.alertTab = next;
  try{ localStorage.setItem("ds.alertTab", rt.alertTab); }catch(err){ /* 受限环境忽略 */ }
  renderAlertPanel();
  loadAlertPanel();
}
/* 消息页的标题、未读数与页级操作交给页头（原型 p-messages）；
   正文里的 .msg-page-head 只在手机保留一份，桌面由 CSS 隐藏，避免同一状态出现两次 */
function syncMessagesPageHead(){
  if(document.body.dataset.view !== "messages") return;
  var titleEl = $("pageTitleText"), sub = $("pageSub"), pill = $("pagePill");
  var acts = $("pageActions"), nw = $("newWrap");
  var unread = notifyState.unread || 0, mentions = notifyState.mentions || 0, total = notifyState.total || 0;
  var ws = (rt.currentWs && rt.currentWs.name) || "";
  if(titleEl) titleEl.textContent = "消息中心";
  if(sub){
    sub.textContent = (ws ? ws + " / " : "") + (unread
      ? ("未读 " + unread + " 中包含提及 " + mentions + " · 顶栏铃铛只显示最近 5 条，完整记录在这里")
      : ("已全部读完，共 " + total + " 条 · 顶栏铃铛只显示最近 5 条，完整记录在这里"));
  }
  if(pill){
    pill.hidden = !unread;
    pill.textContent = unread ? ("未读 " + (unread > 99 ? "99+" : unread)) : "";
  }
  if(acts){
    acts.innerHTML = '<button class="btn" type="button" data-msg-prefs>通知偏好</button>'
      + (unread > 0 ? '<button class="btn" type="button" data-ap-readall>' + icon("check", 14) + ' 全部标为已读</button>' : "");
    acts.hidden = false;
  }
  if(nw) nw.hidden = true;
  document.title = "消息中心 · 沙漏";
}
function renderMessagesPage(){
  var box = $("messagesBody");
  if(!box) return;
  var view = box.closest(".view");
  if(view && !view.classList.contains("on")) return;
  syncMessagesPageHead();
  var unread = notifyState.unread || 0, mentions = notifyState.mentions || 0, total = notifyState.total || 0;
  var isDue = rt.alertTab === "due";
  var scopeLabel = isDue ? "截止提醒" : (rt.noticeFilter === "unread" ? "未读消息" : (rt.noticeFilter === "mention" ? "提及我的消息" : "全部消息"));
  /* 类型筛选只在正文顶部一处：左栏再放一份同名按钮会让用户不确定哪处生效 */
  var dueCount = deadlineGroups.over.length + deadlineGroups.today.length + deadlineGroups.soon.length;
  var shown = isDue ? 0 : msgPageItems().length;
  var body = isDue
    ? dueGroupsHTML()
    : msgPageListHTML();
  /* 标题与面包屑已由顶栏承担，正文只留状态行：未读数、总数与铃铛口径说明 */
  var head = '<div class="msg-page-head">'
    + '<div class="msg-page-txt"><span class="msg-page-sub">'
      + (unread ? '<span class="msg-unread"><i></i>未读 ' + unread + '</span>' : '')
      + (unread ? "提及 " + mentions + " 条" : "已全部读完，共 " + total + " 条")
      + ' · 顶栏铃铛只显示最近 5 条，完整记录在这里</span></div>'
    + '<div class="manager-actions"><button class="btn sm" type="button" data-msg-prefs>通知偏好</button>'
      /* 没有未读时不摆一个永远点不动的按钮：页头已写明「已全部读完」 */
      + (unread > 0 ? '<button class="btn sm" type="button" data-ap-readall>全部标为已读</button>' : '') + '</div></div>';
  var mainHead = '<div class="msg-main-head"><b>' + scopeLabel + '</b>'
    + (!isDue ? '<div class="msg-chips">' + msgTypeChips() + '</div>' : '<span class="msg-hint">逾期 / 今天到期 / 3 天内 · 点一条打开工作项</span>')
    + (!isDue ? '<span class="msg-hint">按时间倒序 · 同任务连续消息已合并</span>' : '') + '</div>';
  var foot = isDue ? ""
    : '<div class="msg-foot"><span>已显示 ' + shown + ' 条' + (notifyState.hasMore ? ' · 还有更多' : '') + ' · 标记已读后立即从「未读」移除</span>'
      + (notifyState.hasMore ? '<button class="btn sm" type="button" data-ap-more>加载更多</button>' : '') + '</div>';
  box.innerHTML = head
    + '<div class="msg-layout"><aside class="msg-rail">'
    + '<div class="msg-rail-card"><div class="msg-rail-title">消息</div>'
      + msgRailItem('data-msg-filter', "all", "全部", total, !isDue && rt.noticeFilter === "all")
      + msgRailItem('data-msg-filter', "unread", "未读", unread, !isDue && rt.noticeFilter === "unread")
      + msgRailItem('data-msg-filter', "mention", "提及我", mentions, !isDue && rt.noticeFilter === "mention")
      + '</div>'
    + '<div class="msg-rail-card"><div class="msg-rail-title">提醒</div>'
      + msgRailItem('data-msg-due', "", "截止提醒", dueCount, isDue) + '</div>'
    + '<div class="msg-rail-note">提及是未读的子集，读过之后两边同时减少。</div>'
    + '</aside><section class="msg-pane">' + mainHead + '<div class="msg-list">' + body + '</div>' + foot + '</section></div>';
  if(view) view.scrollTop = view.scrollTop || 0;
}
function enterMessagesView(){
  renderMessagesPage();
  loadUnread(true);
  loadDeadlineGroups();
  loadAlertPanel();
}
/* 未读数变化时只同步页头按钮状态，避免整页重绘导致消息页滚动位置丢失 */
function syncMessagesReadAllButton(){
  var btns = document.querySelectorAll("#messagesBody [data-ap-readall], #pageActions [data-ap-readall]");
  btns.forEach(function(btn){ btn.disabled = (notifyState.unread || 0) <= 0; });
  syncMessagesPageHead();
}
function togglePlanWatch(btn){
  var planId = btn.getAttribute("data-apn-watch");
  if(!planId || btn.disabled) return;
  var watching = notifyState.watch[planId] === true;
  var url = "/api/release-plans/" + encodeURIComponent(planId) + "/watch";
  btn.disabled = true;
  (watching ? API.del(url) : API.post(url)).then(function(rs){
    notifyState.watch[planId] = !!(rs && rs.watching);
    btn.disabled = false;
    btn.textContent = notifyState.watch[planId] ? "已关注" : "关注";
    toast(notifyState.watch[planId] ? "已关注该发布计划，改期、范围变化和发布日会提醒你" : "已取消关注", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "关注操作失败，请重试", "bad");
  });
}
function handleNoticeClick(e){
  if(e.target.closest("[data-ap-more]")){
    loadNoticeList({more:true});
    return;
  }
  /* 条目动作：展开正文 / 关注计划，都不触发整行跳转 */
  var expandBtn = e.target.closest("[data-apn-expand]");
  if(expandBtn){
    var row = expandBtn.closest("[data-apn-row]");
    var open = row ? !row.classList.contains("is-expanded") : true;
    if(row){
      row.classList.toggle("is-expanded", open);
      var nid = row.getAttribute("data-apn-row");
      if(nid) notifyState.expanded[nid] = open;
    }
    expandBtn.setAttribute("aria-expanded", open ? "true" : "false");
    expandBtn.textContent = open ? "收起" : "展开";
    return;
  }
  var watchBtn = e.target.closest("[data-apn-watch]");
  if(watchBtn){
    togglePlanWatch(watchBtn);
    return;
  }
  /* 通知筛选：全部 / 未读 / 提及 */
  var filterBtn = e.target.closest("[data-ap-filter]");
  if(filterBtn){
    setNoticeFilter(filterBtn.dataset.apFilter);
    return;
  }
  /* 消息页左栏：范围 / 类型 / 截止提醒 */
  var scopeBtn = e.target.closest("[data-msg-filter]");
  if(scopeBtn){
    setNoticeFilter(scopeBtn.dataset.msgFilter);
    return;
  }
  var typeBtn = e.target.closest("[data-msg-type]");
  if(typeBtn){
    msgType = typeBtn.dataset.msgType || "";
    renderMessagesPage();
    return;
  }
  if(e.target.closest("[data-msg-due]")){
    setAlertTab("due");
    return;
  }
  if(e.target.closest("[data-msg-prefs]")){
    window.dispatchEvent(new CustomEvent("ds:route-go", {detail:{view:"profile"}}));
    return;
  }
  /* 顶部 tab：通知 / 截止提醒 */
  var tabBtn = e.target.closest("[data-ap-tab]");
  if(tabBtn){
    setAlertTab(tabBtn.dataset.apTab);
    return;
  }
  /* 完整消息页入口：面板与消息页共用同一份数据，路由由 router 统一处理 */
  if(e.target.closest("[data-ap-all]")){
    UI.closeAllPops();
    window.dispatchEvent(new CustomEvent("ds:route-go", {detail:{view:"messages"}}));
    return;
  }
  /* 全部标为已读 */
  if(e.target.closest("[data-ap-readall]")){
    invalidateNotifications();
    API.postGlobal("/api/notifications/read-all").then(function(){
      notifyState.items.forEach(function(x){ if(!x.readAt) x.readAt = new Date().toISOString(); });
      notifyState.unread = 0;
      notifyState.mentions = 0;
      /* 未读筛选下类型计数归零；其他筛选仍含已读，计数不变 */
      if(rt.noticeFilter === "unread") notifyState.typeCounts = {};
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
  function p(n){ return n < 10 ? "0" + n : String(n); }
  var md = p(d.getMonth() + 1) + "-" + p(d.getDate());
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = Math.round((today - d) / 86400000);
  if(diff <= 0) return "今天 · " + md;
  if(diff === 1) return "昨天 · " + md;
  return d.getFullYear() === now.getFullYear() ? md : key;
}
function noticeListHTML(){
  if(notifyState.loading && !notifyState.items.length) return UI.skeletonRows(4);
  if(!notifyState.items.length){
    return '<div class="ap-empty">' + icon("checkCircle", 22) +
      '<div style="margin-top:6px">还没有通知</div>' +
      '<div class="ap-empty-sub">工作项到点提醒、评论与指派都会出现在这里</div></div>';
  }
  var items = msgFilteredItems();
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
  if(notifyState.hasMore){
    html += '<div class="ap-more"><button class="btn sm block" type="button" data-ap-more>加载更多</button></div>';
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
function clockOf(v){
  var s = String(v || "").replace(" ", "T");
  var d = new Date(s);
  if(isNaN(d.getTime())) return "";
  function p(n){ return n < 10 ? "0" + n : String(n); }
  var now = new Date();
  return d.toDateString() === now.toDateString() ? p(d.getHours()) + ":" + p(d.getMinutes()) : (p(d.getMonth() + 1) + "-" + p(d.getDate()));
}
/* 列表徽标用类型字而非线图标：一列消息扫下来能直接分辨「提及 / 评论 / 文档 / 发布」 */
var NOTIFY_CHAR = {
  task_mention:"提", task_comment:"评", task_remind:"提", task_due:"期",
  task_assigned:"派", task_watch:"关", task_updated:"改", manager_nudge:"催",
  doc_changed:"文", demand_status:"需", demand_watch:"需",
  version_released:"发", version_deleted:"发", branch_status:"支",
  release_prep:"备", release_watch:"关",
  weekly_report:"报", version_report:"报",
  project_access:"权", member_role:"人", member_removed:"人"
};
function notifyChar(type){
  return NOTIFY_CHAR[type] || (String(type || "").indexOf("test") === 0 ? "测" : "通");
}
function noticeItemHTML(g){
  var x = g.lead;
  var count = g.items.length;
  var ids = g.items.map(function(n){ return n.id; }).join(",");
  var expanded = !!notifyState.expanded[x.id];
  var meta = [];
  if(count > 1) meta.push("共 " + count + " 条同类通知");
  if(x.type === "release_prep" && x.refOwnerName) meta.push("计划负责人 " + x.refOwnerName);
  if(x.workspaceName) meta.push(x.workspaceName);
  /* 动作与整行点击分离：动作按钮不能嵌在跳转按钮里，否则键盘与读屏会把两个操作混成一个 */
  var acts = "";
  if(EXPANDABLE_TYPES[x.type]){
    acts += '<button class="apn-act" type="button" data-apn-expand aria-expanded="' + (expanded ? "true" : "false") + '">'
      + (expanded ? "收起" : "展开") + '</button>';
  }
  var watchable = x.type === "release_prep" && x.refKind === "release_plan" && x.refId
    && rt.currentWs && x.workspaceId === rt.currentWs.id;
  var watching = watchable ? notifyState.watch[x.refId] : undefined;
  if(watchable && watching !== undefined){
    acts += '<button class="apn-act" type="button" data-apn-watch="' + esc(x.refId) + '">'
      + (watching ? "已关注" : "关注") + '</button>';
  }
  return '<div class="apn' + (x.readAt ? "" : " unread") + (expanded ? " is-expanded" : "") + '" data-apn-row="' + esc(x.id) + '">' +
    '<button class="apn-hit" type="button"' +
    ' data-apn="' + esc(x.id) + '" data-apn-ids="' + esc(ids) + '"' +
    (isTaskRef(x.type) && x.refTaskId ? ' data-apn-task="' + esc(x.refTaskId) + '"' : "") +
    /* 「已被移出空间」不带深链：历史数据里的 workspace 链接指向已无权进入的空间 */
    (!isTaskRef(x.type) && x.type !== "member_removed" && x.refKind && x.refId
      ? ' data-apn-kind="' + esc(x.refKind) + '" data-apn-ref="' + esc(x.refId) + '"' : "") +
    (x.workspaceId ? ' data-apn-ws="' + esc(x.workspaceId) + '"' : "") +
    ' title="' + esc(x.title) + '">' +
    '<span class="apn-ic">' + esc(notifyChar(x.type)) + '</span>' +
    '<span class="apn-main">' +
      '<span class="apn-title">' + esc(x.title) +
        (count > 1 ? ' <span class="apn-count">×' + count + '</span>' : "") + '</span>' +
      /* 正文由后端按纯文本拼行；空行在只显示两行的列表里会白占一行，先折成单换行 */
      (x.body ? '<span class="apn-body">' + esc(String(x.body).replace(/\n{2,}/g, "\n")) + '</span>' : "") +
      (meta.length ? '<span class="apn-meta">' + esc(meta.join(" · ")) + '</span>' : "") +
    '</span>' +
    (x.readAt ? "" : '<i class="apn-dot"></i>') +
    '<span class="apn-time">' + esc(clockOf(x.createdAt)) + '</span>' +
    '</button>' +
    (acts ? '<div class="apn-acts">' + acts + '</div>' : "") +
  '</div>';
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
function loadNoticeList(opts){
  opts = opts || {};
  var append = !!opts.more && notifyState.items.length > 0;
  if(append && notifyState.loading) return Promise.resolve();
  var req = ++noticeListReqSeq, mutation = noticeMutationSeq;
  notifyState.loading = true;
  if(!append && !notifyState.items.length) renderAlertPanel();
  /* 服务端按 all/unread/mention 过滤，并返回全量计数，避免「加载 200 条再本地数」失真 */
  return API.getGlobal("/api/notifications", {
    offset: append ? notifyState.items.length : 0,
    limit: 100,
    filter: rt.noticeFilter
  }).then(function(d){
    if(req !== noticeListReqSeq || mutation !== noticeMutationSeq) return;
    notifyState.loading = false;
    var rows = (d && d.items) || [];
    notifyState.items = append ? notifyState.items.concat(rows) : rows;
    notifyState.hasMore = !!(d && d.hasMore) && rows.length > 0;
    if(d && typeof d.unread === "number") notifyState.unread = d.unread;
    if(d && typeof d.total === "number") notifyState.total = d.total; /* 服务端仍返回总量，前端不展示（见 noticeFilterHTML） */
    if(d && typeof d.mentions === "number") notifyState.mentions = d.mentions; /* 口径：未读的 @ 我的通知数 */
    notifyState.typeCounts = d && d.typeCounts ? d.typeCounts : null; /* 服务端全量类型计数，切换筛选后随本次响应更新 */
    loadWatchStates();
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }).catch(function(){
    if(req !== noticeListReqSeq || mutation !== noticeMutationSeq) return;
    notifyState.loading = false;
    if(append){ renderAlertPanel(); return; }
    notifyState.items = [];
    notifyState.hasMore = false;
    notifyState.typeCounts = null;
    renderAlertPanel();
  });
}
/* 切换「全部 / 未读 / 提及」：清空旧列表并重新按服务端筛选拉取 */
function setNoticeFilter(f){
  if(f !== "unread" && f !== "mention") f = "all";
  /* 从「截止提醒」右栏点回消息范围时要真的离开提醒模式，否则左栏高亮和右侧内容对不上 */
  var leaveDue = rt.alertTab !== "notice";
  if(leaveDue){
    rt.alertTab = "notice";
    try{ localStorage.setItem("ds.alertTab", "notice"); }catch(e){ /* 受限环境忽略 */ }
  }
  if(f === rt.noticeFilter && !leaveDue) return;
  rt.noticeFilter = f;
  try{ localStorage.setItem("ds.noticeFilter", f); }catch(e){ /* 受限环境忽略 */ }
  notifyState.items = [];
  notifyState.typeCounts = null;
  notifyState.loading = true;
  renderAlertPanel();
  loadNoticeList();
}
/* 发布准备条目的「关注」需要知道当前是否已关注；只在当前空间取一次，切空间后按新空间重新取 */
function loadWatchStates(){
  if(!rt.currentWs || !rt.currentWs.id) return;
  var ids = [];
  notifyState.items.forEach(function(x){
    if(x.type !== "release_prep" || x.refKind !== "release_plan" || !x.refId) return;
    if(x.workspaceId !== rt.currentWs.id) return;
    if(Object.prototype.hasOwnProperty.call(notifyState.watch, x.refId)) return;
    notifyState.watch[x.refId] = null;
    ids.push(x.refId);
  });
  if(!ids.length) return;
  Promise.all(ids.map(function(id){
    return API.get("/api/release-plans/" + encodeURIComponent(id) + "/watch").then(function(rs){
      notifyState.watch[id] = !!(rs && rs.watching);
    }).catch(function(){
      delete notifyState.watch[id];
    });
  })).then(function(){
    /* 就地回填状态，避免整块重绘把打开中的面板滚动位置打回顶部 */
    document.querySelectorAll("[data-apn-watch]").forEach(function(btn){
      var id = btn.getAttribute("data-apn-watch");
      if(ids.indexOf(id) < 0) return;
      var st = notifyState.watch[id];
      if(st === undefined) return;
      btn.textContent = st ? "已关注" : "关注";
    });
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
  if(kind === "demand"){ go("demands", function(m){ m.openDemandDetailById(refId); }); return true; }
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
  if(kind === "release_plan"){
    /* 通知只带计划 ID：先用准备汇总换出首个版本与项目，再落发布工作台 */
    API.get("/api/release-plans/" + encodeURIComponent(refId) + "/prep").then(function(rs){
      var plan = (rs && rs.plan) || {};
      if(!plan.versionId){
        toast("该计划缺少版本关联，请到发布日程查看", "warn");
        return;
      }
      return import("../views/release.js").then(function(m){
        m.openReleasePage({
          id: plan.versionId,
          reqId: plan.reqId || "",
          tab: "plan",
          planId: refId,
          prep: type === "release_prep" ? "me" : ""
        });
      });
    }).catch(function(ex){ toast(ex.message || "无法打开发布计划，请稍后重试", "warn"); });
    return true;
  }
  if(kind === "project"){
    rt.managerProjectId = refId;
    go("project");
    return true;
  }
  if(kind === "workspace"){ go("settings"); return true; }
  if(kind === "mywork"){ go("mine"); return true; }
  return false;
}
function openFromNotification(ds){
  var taskId = ds.apnTask || "";
  var refKind = ds.apnKind || "";
  var refId = ds.apnRef || "";
  var wsId = ds.apnWs || "";
  var ids = String(ds.apnIds || ds.apn || "").split(",").map(Number).filter(function(n){ return n > 0; });
  var item = null;
  var marked = 0, markedMentions = 0, markedTypes = [];
  /* 聚合条目一次标掉组内全部通知，避免点开任务后还剩一串未读 */
  ids.forEach(function(nid){
    for(var i = 0; i < notifyState.items.length; i++){
      var n = notifyState.items[i];
      if(n.id !== nid) continue;
      if(!item) item = n;
      if(!n.readAt){
        n.readAt = new Date().toISOString();
        marked++;
        if(isMentionNotice(n)) markedMentions++;
        markedTypes.push(n.type);
        API.postGlobal("/api/notifications/" + nid + "/read").catch(function(){ /* 已读失败不阻断打开 */ });
      }
      break;
    }
  });
  if(marked > 0){
    invalidateNotifications();
    dropUnreadTypeCounts(markedTypes);
    notifyState.unread = Math.max(0, notifyState.unread - marked);
    /* 「提及我」只数未读提及：点开一条就同步扣减，不等下次轮询 */
    if(markedMentions > 0) notifyState.mentions = Math.max(0, notifyState.mentions - markedMentions);
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
