/* views/canceled · 已取消：工作项终态归档（原因筛选 + 逐条恢复）
   终态不占看板列，也不进清单 / 我的工作 / 日历 / 甘特；
   本页是唯一能看到已取消工作项的地方，恢复后回到取消前所在列。 */

import { API } from "../core/api.js";
import { activeView, showView } from "../core/router.js";
import { canEditTask } from "../core/state.js";
import { openTaskById, restoreCanceled } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { caliberMarkHTML } from "../lib/caliber-help.js";
import { colName, fmtTs } from "../lib/format.js";

var PAGE_SIZE = 100;
var REASON_NAMES = { not_do: "不做", dup: "重复", deferred: "延期", design: "设计如此" };
var st = {
  active: false,
  reason: "",
  items: [],
  total: 0,
  matched: 0,
  hasMore: false,
  reasons: [],
  seq: 0
};

function bodyEl(){ return document.getElementById("canceledBody"); }

function reasonName(code){ return REASON_NAMES[code] || (code ? code : "未注明"); }

function hashReason(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var q = raw.indexOf("?");
  if(q < 0) return "";
  var parts = raw.substring(q + 1).split("&");
  for(var i = 0; i < parts.length; i++){
    var kv = parts[i].split("=");
    if(decodeURIComponent(kv[0]) === "reason") return decodeURIComponent(kv[1] || "");
  }
  return "";
}

function setHashReason(reason){
  var h = "#/canceled";
  if(reason) h += "?reason=" + encodeURIComponent(reason);
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
}

function load(reason){
  var seq = ++st.seq;
  st.reason = reason || "";
  var qs = "/api/tasks/canceled?offset=0&limit=" + PAGE_SIZE;
  if(st.reason) qs += "&reason=" + encodeURIComponent(st.reason);
  var el = bodyEl();
  if(!el) return Promise.resolve();
  if(!st.items.length) el.innerHTML = '<div class="page-pad">' + UI.emptyState({ title: "加载中…" }) + '</div>';
  return API.get(qs).then(function(d){
    if(seq !== st.seq) return;
    st.items = (d && d.items) || [];
    st.total = d ? d.total : 0;
    st.matched = d ? d.matched : 0;
    st.hasMore = !!(d && d.hasMore);
    st.reasons = (d && d.reasons) || [];
    render();
  }).catch(function(ex){
    if(seq !== st.seq) return;
    el.innerHTML = '<div class="page-pad">' + UI.errorState(ex.message || "已取消工作项加载失败") + '</div>';
    var retry = el.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", function(){ load(st.reason); });
  });
}

function loadMore(){
  if(!st.hasMore) return Promise.resolve();
  var seq = st.seq;
  var qs = "/api/tasks/canceled?offset=" + st.items.length + "&limit=" + PAGE_SIZE;
  if(st.reason) qs += "&reason=" + encodeURIComponent(st.reason);
  return API.get(qs).then(function(d){
    if(seq !== st.seq) return;
    var known = {};
    st.items.forEach(function(t){ known[t.id] = 1; });
    ((d && d.items) || []).forEach(function(t){ if(!known[t.id]) st.items.push(t); });
    st.hasMore = !!(d && d.hasMore);
    render();
  }).catch(function(ex){ toast(ex.message || "加载更多失败", "bad"); });
}

function reasonCount(code){
  for(var i = 0; i < st.reasons.length; i++){
    if((st.reasons[i].name || "") === code) return st.reasons[i].count || 0;
  }
  return 0;
}

function chipsHTML(){
  var html = '<button class="chip' + (st.reason ? "" : " on") + '" type="button" data-cn-reason="">' +
    '全部 <span class="n">' + st.total + '</span></button>';
  st.reasons.forEach(function(r){
    var code = r.name || "";
    var label = reasonName(code);
    html += '<button class="chip' + (st.reason === code ? " on" : "") + '" type="button" data-cn-reason="' + esc(code) + '">' +
      esc(label) + ' <span class="n">' + (r.count || 0) + '</span></button>';
  });
  return html;
}

function rowHTML(t){
  var project = t.reqName || "";
  var editable = canEditTask(t);
  return '<div class="list-row wc-row" data-cn-task="' + esc(t.id) + '" tabindex="0" role="listitem"' +
      ' aria-label="' + esc(t.title) + '">' +
    '<span class="cell wcl-title"><span class="wcl-t" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
      (project ? '<span class="wcl-sub">' + esc(project) + '</span>' : '') + '</span>' +
    '<span class="cell">' + (t.cancelFrom ? esc(colName(t.cancelFrom)) : '<span class="muted">—</span>') + '</span>' +
    '<span class="cell"><span class="tag">' + esc(reasonName(t.cancelReason)) + '</span></span>' +
    '<span class="cell">' + esc(t.owner || "未分配") + '</span>' +
    '<span class="cell">' + esc(fmtTs(t.canceledAt)) + '</span>' +
    '<span class="cell ta-r">' +
      (editable ? '<button class="btn sm soft" type="button" data-cn-restore="' + esc(t.id) + '">恢复</button>'
                : '<span class="mini-tag mute" title="你对该项目只有查看权限">只读</span>') +
    '</span>' +
  '</div>';
}

function listHTML(){
  if(!st.items.length){
    return UI.emptyState({
      title: st.reason ? "该原因下没有已取消工作项" : "没有已取消的工作项",
      text: st.reason ? "切到「全部」看看其他原因。" : "工作项取消后会归档到这里，不计逾期，也不进完成率分母。"
    });
  }
  return '<div class="wc-list cn-list" style="--wc-cols:minmax(260px,3fr) 96px 96px 120px 108px 84px;--wc-min:764px">' +
    '<div class="list-head"><span>工作项</span><span>取消前状态</span><span>取消原因</span><span>负责人</span><span>取消时间</span><span class="ta-r">操作</span></div>' +
    '<div class="wc-lane wc-flat"><div class="wc-lane-rows" role="list">' +
      st.items.map(rowHTML).join("") +
    '</div></div>' +
  '</div>' +
  (st.hasMore ? '<div class="cn-more"><button class="btn sm" type="button" data-cn-more>加载更多</button></div>' : "");
}

function render(){
  var el = bodyEl();
  if(!el) return;
  var scope = st.reason
    ? ('「' + reasonName(st.reason) + '」' + st.matched + ' 条')
    : (st.total + ' 条');
  el.innerHTML =
    '<header class="wc-head"><div class="wc-head-top">' +
      '<button class="wc-back" type="button" data-cn-back>← 看板</button>' +
      '<h1 class="wc-title">已取消 <span class="cn-count">' + st.total + '</span></h1>' +
      '<span class="tag tag-primary wc-title-tag">终态</span>' +
      caliberMarkHTML("board.guide", true, "查看工作项终态与流转说明") +
      '<span class="sp"></span>' +
      '<span class="wc-total">' + esc(scope) + '</span>' +
    '</div></header>' +
    '<div class="cn-body">' +
      '<div class="cn-filters">' + chipsHTML() + '</div>' +
      '<div class="cn-list-wrap">' + listHTML() + '</div>' +
    '</div>';
}

function restoreTask(id){
  var t = null;
  for(var i = 0; i < st.items.length; i++) if(st.items[i].id === id) t = st.items[i];
  if(!t) return;
  /* 行数据不在看板缓存里，把任务对象直接交给恢复动作，避免找不到而静默返回 */
  restoreCanceled(id, function(){
    /* 就地扣减，避免为一条恢复整页重取 */
    st.items = st.items.filter(function(x){ return x.id !== id; });
    st.total = Math.max(0, st.total - 1);
    st.matched = Math.max(0, st.matched - 1);
    st.reasons.forEach(function(r){ if((r.name || "") === (t.cancelReason || "")) r.count = Math.max(0, (r.count || 0) - 1); });
    render();
  }, t);
}

function wire(){
  var el = bodyEl();
  if(!el || el.__cnWired) return;
  el.__cnWired = true;
  el.addEventListener("click", function(e){
    var back = e.target.closest("[data-cn-back]");
    if(back){ showView("board"); return; }
    var reasonBtn = e.target.closest("[data-cn-reason]");
    if(reasonBtn){
      var next = reasonBtn.dataset.cnReason || "";
      if(next === st.reason) return;
      setHashReason(next);
      st.items = [];
      load(next);
      return;
    }
    var restore = e.target.closest("[data-cn-restore]");
    if(restore){ e.stopPropagation(); restoreTask(restore.dataset.cnRestore); return; }
    var more = e.target.closest("[data-cn-more]");
    if(more){ loadMore(); return; }
    var row = e.target.closest("[data-cn-task]");
    if(row){ openTaskById(row.dataset.cnTask); }
  });
  el.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest && e.target.closest("[data-cn-task]");
    if(!row) return;
    e.preventDefault();
    openTaskById(row.dataset.cnTask);
  });
}

export function enterCanceledView(){
  st.active = true;
  wire();
  var reason = hashReason();
  st.items = [];
  load(reason);
}

export function refreshFromHash(){
  if(activeView !== "canceled") return;
  var reason = hashReason();
  if(reason === st.reason) return;
  st.items = [];
  load(reason);
}

/* 任务在别处被取消后回到本页：点看板入口会重新 enter，若已在本页则手动刷新 */
export function refreshCanceledIfOpen(){
  if(activeView === "canceled") load(st.reason);
}
