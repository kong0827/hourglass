/* core/state · 全局可变状态（跨视图共享的写入统一走 rt） */

import { esc } from "./ui.js";
import { CAT_DEFAULT_COLOR, COLUMNS, darken, dayDiff, fmtShortMD, iso, parseDate, rgbaOf, startOfDay } from "../lib/format.js";

/* 跨视图共享的可变状态：import 绑定只读，写入一律走 rt */
export const rt = {};
rt.TODAY = startOfDay(new Date());
rt.TODAY_ISO = iso(rt.TODAY);
rt.OWNER_DEFAULT = "我";
rt.categoriesCache = [];
rt.reqList = [];
rt.reqsLoaded = false;
rt.formReqStatus = "active";
rt.editingReqId = null;
rt.formPri = "P2";
rt.formCat = "";
rt.formRecur = "";
rt.tagsCache = [];
rt.editingId = null;
rt.taskFormSeq = 0;
rt.formDirty = false;
rt.resetArmed = null;
rt.suppressClickUntil = 0;
rt.currentUser = null;
rt.currentWs = null;
rt.allWorkspaces = [];
rt.wsMembersCache = [];
rt.savedViews = [];
rt.inviteCache = [];
rt.colDefsCache = [];
rt.catDefsCache = [];
rt.settingsReady = false;
rt.subtasksCache = [];
rt.listCache = {};
rt.listSeq = 0;
rt.listSelected = {};
rt.listTotal = 0;
rt.reviewSeq = 0;
rt.reviewTarget = null;
rt.analysisTab = "stats";
rt.boardDirty = false;
rt.notifyInfo = null;
rt.pickedChannel = "";
rt.commentSending = false;
rt.alertTab = "notice";

var state = {
  q:"", owners:[], pris:[], cats:[], reqs:[], tags:[], types:[], versions:[],
  due:null, focus:false, doneScope:"week", blocked:false,
  board:null, doneExtra:[], loadSeq:0, boardGen:0,
  reviewData:null, statsWeeks:8, flowDays:90, workScope:"mine", reviewWork:null,
  mineSpace:"",
  collapsedCols:{}, inlineAdd:null,
  runningTimer:null, compMonth:null, reqDocId:null
};
var taskCacheExtra = {};
var calState = {year:null, month:null, tasks:[], selected:null, seq:0, showDone:{}};
function safeColor(c){
  return /^#[0-9a-f]{6}$/i.test(String(c == null ? "" : c)) ? c : CAT_DEFAULT_COLOR;
}
function catColor(name){
  for(var i = 0; i < rt.categoriesCache.length; i++){
    if(rt.categoriesCache[i].name === name) return safeColor(rt.categoriesCache[i].color);
  }
  return CAT_DEFAULT_COLOR;
}
function catTag(name){
  if(!name) return "";
  var color = catColor(name);
  return '<span class="tag" style="background:' + rgbaOf(color,.09) + ';color:' + darken(color) +
    ';border-color:' + rgbaOf(color,.22) + '">' +
    '<i class="dot" style="background:' + color + '"></i>' + esc(name) + '</span>';
}
function tagChip(name){
  return '<span class="tag tag-ghost">' + esc(name) + '</span>';
}
function progressOf(t){ return t.boardColumn === "done" ? 100 : (Number(t.progress) || 0); }
function timerAllowed(t){
  if(!t) return false;
  return t.boardColumn !== "backlog" && t.boardColumn !== "done";
}
function dueState(t){
  if(!t.dueDate) return {kind:"none"};
  if(t.boardColumn === "done") return {kind:"done"};
  var d = dayDiff(parseDate(t.dueDate), rt.TODAY);
  if(d < 0)   return {kind:"over", n:Math.abs(d)};
  if(d === 0) return {kind:"today", n:0};
  if(d <= 3)  return {kind:"soon", n:d};
  return {kind:"ok", n:d};
}
function dueText(t){
  var s = dueState(t);
  if(s.kind === "none")  return "未设截止";
  if(s.kind === "done")  return "已完成 " + fmtShortMD(parseDate(t.completedAt || t.dueDate));
  if(s.kind === "over")  return "逾期 " + s.n + " 天";
  if(s.kind === "today") return "今天到期";
  if(s.kind === "soon")  return "剩余 " + s.n + " 天";
  return fmtShortMD(parseDate(t.dueDate));
}
function dueMetaClass(kind){
  if(kind === "over") return "meta over";
  if(kind === "today") return "meta today";
  if(kind === "done") return "meta full";
  return "meta ok";
}
function filterOn(){
  return !!(state.q || state.owners.length || state.pris.length || state.cats.length
    || state.reqs.length || state.tags.length || state.types.length || state.versions.length
    || state.due || state.focus || state.blocked);
}
function selectedFilterCount(){
  var n = 0;
  if(state.q) n++;
  n += state.owners.length + state.pris.length + state.cats.length + state.reqs.length + state.tags.length + state.types.length + state.versions.length;
  if(state.due) n++;
  if(state.focus) n++;
  if(state.blocked) n++;
  return n;
}
function totalTaskCount(){
  var n = 0;
  if(state.board){
    COLUMNS.forEach(function(c){
      var cd = state.board.columns[c.id];
      if(cd) n += cd.allTotal;
    });
  }
  return n;
}
function taskById(id){
  if(state.board){
    for(var i = 0; i < COLUMNS.length; i++){
      var cd = state.board.columns[COLUMNS[i].id];
      if(!cd) continue;
      for(var j = 0; j < cd.items.length; j++) if(cd.items[j].id === id) return cd.items[j];
    }
    for(var k = 0; k < state.doneExtra.length; k++) if(state.doneExtra[k].id === id) return state.doneExtra[k];
  }
  return rt.listCache[id] || taskCacheExtra[id] || null;
}
function reqNameById(id){
  if(!id) return "无";
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) return rt.reqList[i].name;
  return "无";
}

/* ---- 项目级写权限：与后端 ProjectAccessService 同口径 ---- */
function currentRole(){
  return rt.currentWs && rt.currentWs.myRole ? rt.currentWs.myRole : "";
}
/** 查看者全局只读；其余角色按项目判定 */
function roleReadOnly(){
  return currentRole() === "viewer";
}
/**
 * write / read。判定顺序：查看者 → 空间主/管理员 → 空间下发的 projectAccess
 * → 已加载的 reqList.access；无法判定时按可写，避免误伤默认参与的项目。
 */
function projectAccess(reqId){
  if(roleReadOnly()) return "read";
  var role = currentRole();
  if(role === "owner" || role === "admin") return "write";
  if(reqId){
    var map = rt.currentWs && rt.currentWs.projectAccess;
    if(map && map[reqId]){
      /* none 的项目本应被列表过滤；万一漏到前端也按只读处理，不能按可写放行 */
      return map[reqId] === "read" || map[reqId] === "none" ? "read" : "write";
    }
    for(var i = 0; i < rt.reqList.length; i++){
      if(rt.reqList[i].id === reqId && rt.reqList[i].access === "read") return "read";
    }
  }
  return "write";
}
function canEditReq(reqId){
  return projectAccess(reqId) === "write";
}
function canEditTask(t){
  if(!t) return false;
  /* 跨空间「我的任务」由后端逐条下发 write/read，优先采用（rt.currentWs 未必是任务所属空间） */
  if(t.access === "write" || t.access === "read") return t.access === "write";
  return projectAccess(t.reqId) === "write";
}

export { calState, canEditReq, canEditTask, catColor, catTag, currentRole, dueMetaClass, dueState, dueText, filterOn, progressOf, projectAccess, reqNameById, roleReadOnly, safeColor, selectedFilterCount, state, tagChip, taskById, taskCacheExtra, timerAllowed, totalTaskCount };
