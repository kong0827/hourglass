/* core/realtime · SSE 实时同步与轮询兜底 */

import { $, taskDrawer } from "./dom.js";
import { API } from "./api.js";
import { loadUnread } from "./notifications.js";
import { refreshActiveView } from "./router.js";
import { rt } from "./state.js";
import { showDrawerNotice } from "./task-drawer.js";
import { viewModule } from "./view-loader.js";
import { UI } from "./ui.js";
import { iso, startOfDay } from "../lib/format.js";
import { drag, loadBoard, loadReqs, pending, refreshBoardPreserving } from "../views/board.js";
import { loadBranches, renderBranches } from "../views/branches.js";

var sse = {conn:null, lastMsg:0, retry:0, timer:null, debounce:null, lastRefresh:0,
  pending:false, pendingEntity:"", disconnectedAt:0};
function parseSseData(raw){
  var out = {ws:"", taskId:"", actor:"", clientId:"", entity:"", docId:""};
  if(!raw) return out;
  var s = String(raw);
  if(s.charAt(0) === "{"){
    try{
      var o = JSON.parse(s);
      out.ws = o.w || o.workspaceId || "";
      out.taskId = o.t || o.taskId || "";
      out.actor = o.a || o.actorName || "";
      out.clientId = o.c || "";
      out.entity = o.e || "";
      out.docId = o.d || "";
      return out;
    }catch(e){ /* 解析失败则落回文本口径 */ }
  }
  out.ws = s;
  return out;
}
function sseHealthy(){
  return !!sse.conn && sse.conn.readyState === 1 && (Date.now() - sse.lastMsg < 60000);
}
function updateSseAlert(){
  var el = $("sseAlert");
  if(!el) return;
  el.hidden = !(Date.now() - sse.lastMsg > 60000);
}
function sseTick(){ sse.lastMsg = Date.now(); updateSseAlert(); }
function sseClose(){
  if(sse.conn){
    try{ sse.conn.close(); }catch(e){ /* noop */ }
    sse.conn = null;
  }
}
function sseScheduleReconnect(){
  if(sse.timer) return;
  var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(sse.retry, 5)));
  sse.retry++;
  sse.timer = setTimeout(function(){ sse.timer = null; sseConnect(); }, delay);
}
function refreshByEntity(entity){
  if(!entity || entity === "all" || entity === "task" || entity === "timer"
      || entity === "column" || entity === "category" || entity === "workspace" || entity === "other"){
    refreshBoardPreserving();
    loadReqs();
    refreshActiveView();
    return;
  }
  if(entity === "req" || entity === "reqdoc"){
    loadReqs();
    refreshActiveView();
    return;
  }
  if(entity === "branch"){
    loadBranches(true).then(renderBranches).catch(function(){ /* 忽略 */ });
    refreshActiveView();
    return;
  }
  refreshActiveView();
}
function onSseChanged(event){
  sseTick();
  var info = parseSseData(event && event.data);
  /* F-NET-1：发起者自己的写请求会收到回声，直接忽略，避免同一操作刷新两遍 */
  if(info.clientId && info.clientId === window.DS_CLIENT_ID) return;
  /* 后台标签页不刷新：只记一笔，切回来时补一次 */
  if(document.hidden){
    sse.pending = true;
    var ent = info.entity || "all";
    /* 后台期间可能收到多种实体：合并成 all，切回时一次全刷，避免漏掉 */
    sse.pendingEntity = (sse.pendingEntity && sse.pendingEntity !== ent) ? "all" : ent;
    return;
  }
  /* R-1：未读角标是跨空间的，且与"是否刷新当前看板"无关，因此放在空间判断之前 */
  loadUnread();
  if(info.ws && window.CURRENT_WORKSPACE && info.ws !== window.CURRENT_WORKSPACE) return;
  /* O-11：抽屉正开着这条任务 → 只给轻提示，不自动刷新、不覆盖未保存草稿 */
  if(taskDrawer.classList.contains("on") && rt.editingId && info.taskId && info.taskId === rt.editingId){
    showDrawerNotice("此任务刚被" + (info.actor ? ("「" + info.actor + "」") : "他人") + "修改，点击刷新查看最新内容");
    return;
  }
  /* 需求文档正开着这篇且被他人改动 → 编辑器内轻提示（dirty 时带「查看最新内容」按钮） */
  if(info.entity === "reqdoc" && info.docId){
    var rq = viewModule("requirements");
    if(rq && rq.notifyReqDocChanged) rq.notifyReqDocChanged(info.docId, info.actor);
  }
  if(sse.debounce) clearTimeout(sse.debounce);
  sse.debounce = setTimeout(function(){
    if(drag || pending){ markSsePending(info.entity); return; }
    if(UI.anyDialogOpen()){ markSsePending(info.entity); return; }              // 弹窗打开时不打扰，关闭后补刷
    if(taskDrawer.classList.contains("on") && rt.formDirty){ markSsePending(info.entity); return; } // 有未保存改动时延迟
    if(Date.now() - sse.lastRefresh < 300){ markSsePending(info.entity); return; }
    sse.lastRefresh = Date.now();
    refreshByEntity(info.entity);
  }, 300);
}
function markSsePending(entity){
  sse.pending = true;
  sse.pendingEntity = (sse.pendingEntity && sse.pendingEntity !== entity) ? "all" : (entity || "all");
}
/* 弹窗/拖拽/草稿阻塞结束后，把攒下的变更补刷一次，避免 SSE 健康时永久陈旧 */
function flushSsePendingIfIdle(){
  if(!sse.pending || document.hidden) return false;
  if(drag || pending || UI.anyDialogOpen()) return false;
  if(taskDrawer.classList.contains("on") && rt.formDirty) return false;
  var ent = sse.pendingEntity || "all";
  sse.pending = false;
  sse.pendingEntity = "";
  sse.lastRefresh = Date.now();
  refreshByEntity(ent);
  return true;
}
function sseConnect(){
  if(!window.EventSource) return;
  sseClose();
  try{ sse.conn = new EventSource(API.base + "/api/events"); }
  catch(e){ sseScheduleReconnect(); return; }
  sse.conn.addEventListener("changed", onSseChanged);
  sse.conn.addEventListener("ping", sseTick);
  sse.conn.onmessage = sseTick;
  sse.conn.onopen = function(){
    var gap = sse.disconnectedAt ? (Date.now() - sse.disconnectedAt) : 0;
    sse.retry = 0;
    sse.disconnectedAt = 0;
    sseTick();
    /* 断开超过 5 秒：期间的事件可能已经丢了，重连后补拉一次 */
    if(gap > 5000 && !document.hidden) refreshByEntity("all");
  };
  sse.conn.onerror = function(){
    if(!sse.disconnectedAt) sse.disconnectedAt = Date.now();
    sseClose();
    updateSseAlert();
    sseScheduleReconnect();
  };
}
function initSSE(){
  if(!window.EventSource) return;
  sse.lastMsg = Date.now();
  sseConnect();
  setInterval(function(){
    updateSseAlert();
    if(!sse.conn){ sseScheduleReconnect(); return; }
    if(Date.now() - sse.lastMsg > 60000){ sseClose(); sseScheduleReconnect(); }
    flushSsePendingIfIdle();
  }, 5000);
}
function refreshIfDayChanged(){
  if(iso(startOfDay(new Date())) !== rt.TODAY_ISO){
    rt.TODAY = startOfDay(new Date());
    rt.TODAY_ISO = iso(rt.TODAY);
    loadBoard({animate:false});
    return true;
  }
  return false;
}
var pollTick = 0;
setInterval(function(){
  if(document.hidden) return;
  if(drag || pending) return;
  if(UI.anyDialogOpen()) return;
  if(taskDrawer.classList.contains("on") && rt.formDirty) return;
  pollTick++;
  flushSsePendingIfIdle();
  /* SSE 健康时不做数据轮询：事件驱动已经够用，只保留跨零点检查 */
  if(sseHealthy()){ refreshIfDayChanged(); return; }
  if(refreshIfDayChanged()) return;
  refreshBoardPreserving();
  loadReqs();
  refreshActiveView();
}, 30000);
document.addEventListener("visibilitychange", function(){
  if(document.hidden) return;
  if(UI.anyDialogOpen() || drag || pending) return;
  if(taskDrawer.classList.contains("on") && rt.formDirty) return;
  if(refreshIfDayChanged()) return;
  /* 后台期间收到的变更在切回来时补一次 */
  if(sse.pending){
    var ent = sse.pendingEntity;
    sse.pending = false;
    sse.pendingEntity = "";
    loadUnread();
    refreshByEntity(ent);
    return;
  }
  refreshBoardPreserving();
});

export { initSSE };
