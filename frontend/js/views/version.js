/* views/version · 版本详情子页（#/version?id=&reqId=&tab=）
   从版本卡的版本名 / 「版本详情」按钮，或跨项目「全部版本」表的版本名跳转进来，
   一屏看单个版本的范围、投入与发布事实；hash 带全部位置信息，可分享、可后退。
   范围口径与版本卡完全一致：绑定的工作项 + 首版上线前未绑版本的折算，折算项在行内标注。
   写操作不在此重写：统一借版本页的弹窗（同一份校验、留痕与 CAS），见 phase.js 的 openVersionTool。 */

import { API } from "../core/api.js";
import { searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { activeView, showView } from "../core/router.js";
import { canEditReq, dueState, reqNameById, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { loadView } from "../core/view-loader.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { openMilestoneDetail } from "../lib/milestone-ui.js";
import {
  colName, dayKey, demandNoText, fmtMinutesShort, fmtReleaseTime, itemNoText,
  releaseEnvironmentName, releasePlanNoText, releaseSnapshotHTML, taskPublicationHTML, taskVersionIds, typeBadgeHTML
} from "../lib/format.js";
import { openBranchById } from "./branches.js";

registerHelp({
  "version.actual": {
    title:"已投入工时",
    rows:[
      ["包含什么", "版本当前绑定工作项的全部已结束计时 + 手工补记，未完成的工作项也计入。", "ok"],
      ["范围", "与上方「版本工作项」同源，含首版上线前自动归入的折算项；其他版本或未绑定工作项不计。", "info"]
    ]
  },
  "version.estimate": {
    title:"预估工时",
    rows:[
      ["怎么算", "全部绑定工作项的预估相加，已完成与未完成都算；没填预估的按 0 计。", "ok"],
      ["别拿它算剩余", "它是总量，不扣已投入，也不区分完成状态；看剩余请用「剩余预估」。", "info"]
    ]
  },
  "version.remaining": {
    title:"剩余预估",
    rows:[
      ["怎么算", "只累加未完成工作项的预估原值，已完成工作项不参与。", "ok"],
      ["不扣已投入", "数字不会减去已发生的计时，已超预估的未完成项也不归零；它是「未完成项还挂着多少预估」，不是「还要再干多久」。", "warn"],
      ["没填预估", "未完成但没填预估的工作项按 0 计，所以可能低估实际剩余。", "mute"]
    ]
  },
  "version.variance": {
    title:"整体偏差",
    rows:[
      ["怎么算", "（已完成工作项的实际 − 其预估）÷ 这些工作项的预估；±15% 内视为准确。", "ok"],
      ["只算已完成", "未完成工作项不参与；已完成但没填预估的工作项也不参与。", "info"],
      ["别和总数相减", "不能拿卡片的「已投入工时 − 预估工时」直接算这个百分比，两者范围不同。", "warn"]
    ]
  },
  "version.onTime": {
    title:"准时完成率",
    rows:[
      ["分母", "已完成工作项里填了截止日期的那些。", "ok"],
      ["按时", "完成时间不晚于截止日期（含当天）即算按时。", "info"],
      ["不参与", "没填截止日期或还没完成的工作项不计入分母。", "mute"],
      ["边界", "「完成」指工作项流转到完成列，不等于该版本实际发布。", "warn"]
    ]
  },
  "version.avgTask": {
    title:"工作项均耗时",
    rows:[
      ["怎么算", "已完成工作项自身的实际工时合计 ÷ 已完成工作项数。", "ok"],
      ["只算已完成", "未完成工作项不参与分子，也不进分母；没有完成项时显示 —。", "info"],
      ["不是总工时", "它回答「平均做一项花了多久」，不能拿它乘项数去反推版本总投入。", "warn"]
    ]
  },
  "version.commit.scope": {
    title:"冻结范围",
    rows:[
      ["怎么来", "开始开发时把当时绑定的工作项数与预估快照下来，之后一直以这份快照为准。", "ok"],
      ["不回写", "工作项后来改了预估、换算或移动，都不会改这里；它回答「当初承诺了多少」。", "info"]
    ]
  },
  "version.commit.done": {
    title:"基线完成",
    rows:[
      ["怎么算", "基线内、当前仍绑定且已流转到完成列的工作项 ÷ 冻结范围。", "ok"],
      ["分母含移出", "分母是冻结时的全部项，后来移出的仍在分母里，分子却不再有它，所以完成率可能到不了 100%。", "warn"],
      ["新增不算", "启动后新增的工作项既不进分母、也不算进这里的完成数。", "mute"]
    ]
  },
  "version.commit.added": {
    title:"启动后新增",
    rows:[
      ["怎么算", "当前绑定、但基线快照里没有的工作项数；预估取当前值。", "ok"],
      ["影响", "新增会抬高上方「预估工时」和「已投入」，但不改基线完成率的分母。", "info"]
    ]
  },
  "version.commit.removed": {
    title:"基线移出",
    rows:[
      ["怎么算", "基线里有、现在已不再绑定到该版本的工作项数。", "ok"],
      ["预估取值", "显示的是冻结时的预估快照，不是这些工作项现在的预估。", "info"],
      ["影响", "移出项仍占基线分母，但不再计入完成数，属于范围收缩。", "warn"]
    ]
  }
});
initCaliberHelp();

var TABS = [
  { key:"overview", label:"概览" },
  { key:"scope", label:"工作项" },
  { key:"demands", label:"需求" },
  { key:"releases", label:"发布" },
  { key:"log", label:"操作记录" }
];
var TAB_KEYS = TABS.map(function(t){ return t.key; });
var SORTS = [["default","风险优先"],["actual","实际工时"],["estimate","预估工时"],["due","截止日期"],["title","标题"]];
var SORT_KEYS = SORTS.map(function(s){ return s[0]; });
var STATUS_FILTERS = [["","全部状态"],["done","已完成"],["moving","进行中"],["idle","未开始"],["open","未完成"],["over","已逾期"],["pre","上线前归入"]];
var TYPE_FILTERS = [["","全部类型"],["story","需求"],["task","任务"],["bug","缺陷"],["epic","史诗"]];
var PUB_FILTERS = [["","全部发布状态"],["published","已发布"],["unpublished","未发布"]];
var NONE = "__none__";
/* 联动筛选：从关联实体（模块 / 分支 / 需求 / 阶段 / 负责人）点进来时落在这些字段上，
   与手工筛选共用同一份状态和同一串 hash，分享出去的链接能还原同一份明细 */
function blankFilters(){ return { q:"", status:"", owner:"", type:"", pub:"", sort:"default", cat:"", branch:"", demand:"", stage:"" }; }
/* 有发布事实即算已发布：正式记录的当前生效/部分/回滚/覆盖未知，或人工补录 */
function isPublishedTask(t){
  return !!(t.publishedAt || t.everPublished === true || t.manualPublished === true
    || (t.publicationState && t.publicationState !== "unpublished")
    || (Array.isArray(t.publicationTargets) && t.publicationTargets.length));
}
var LOG_NAME = {
  version_create:"创建版本", version_update:"编辑版本", version_start:"开始开发",
  version_close:"关闭版本", version_cancel:"取消版本", version_scope:"调整版本范围",
  create:"创建版本", release:"发布"
};

var host = null, wired = false;
var st = {
  id:"", reqId:"", tab:"overview",
  seq:0, loading:false, error:"",
  versions:[], version:null, stat:null, phase:null,
  tasks:[], milestones:[], cats:[], allDemands:[],
  filters:blankFilters(),
  relFilters:{ result:"", environment:"", operation:"" }
};
/* 侧栏数据各自独立到位：任一份失败只影响自己那块，不拖垮整页 */
function side(){ return { rows:null, loading:false, error:"" }; }
var extra = { demands:side(), plans:side(), records:side(), log:side() };
var pickerRows = null, pickerQuery = "";

function alive(seq){ return seq === st.seq && activeView === "version"; }
function writable(){ return !!st.reqId && canEditReq(st.reqId); }
function contentLocked(){ var v = st.version; return !!v && (v.contentLocked === true || v.status === "released"); }
function ended(){ var v = st.version; return !!v && (v.status === "closed" || v.status === "canceled"); }
function readOnly(){ return contentLocked() || ended(); }
function versionName(){ return (st.version && st.version.name) || (st.stat && st.stat.name) || "版本"; }
function statusName(s){
  return { released:"已发布", active:"进行中", planned:"计划中", closed:"已关闭", canceled:"已取消" }[s] || s || "—";
}
function statusTag(s){
  var cls = s === "released" ? "tag-success" : s === "active" ? "tag-info" : "ghost";
  return '<span class="tag ' + cls + '">' + esc(statusName(s)) + '</span>';
}
function dateText(s){ return s ? String(s).substring(0, 10) : ""; }
function pctText(v){ return (v === null || v === undefined) ? "—" : ((v > 0 ? "+" : "") + v + "%"); }
function devTone(v){
  if(v === null || v === undefined) return "";
  var a = Math.abs(v);
  /* 用 -text 后缀：裸 vd-warn 是错误横幅的类，会把指标数字渲染成带边框的小方块 */
  return a <= 15 ? "ok" : (a <= 40 ? "warn-text" : "bad-text");
}
function num(v){ return Number(v) || 0; }
function hours(v){ return num(v) ? fmtMinutesShort(v) : "—"; }
function actOf(t){ return Math.max(0, num(t.totalMinutes)); }
function testOf(t){ return Math.min(actOf(t), Math.max(0, num(t.testMinutes))); }
function devOf(t){ return Math.max(0, actOf(t) - testOf(t)); }
function estOf(t){ return Math.max(0, num(t.estimateMinutes)); }
function isDone(t){ return t.boardColumn === "done"; }
function isOver(t){ return dueState(t).kind === "over"; }
function windowText(){
  var v = st.version || st.stat || {};
  var from = dateText(v.startDate), to = dateText(v.targetDate);
  if(from && to && from !== to) return from + " → " + to;
  if(from) return from + " 起";
  if(to) return "目标就绪 " + to;
  return "未设周期";
}

/* ==================== 路由 ==================== */

function filterQuery(){
  var f = st.filters, parts = [];
  if(f.q) parts.push("q=" + encodeURIComponent(f.q));
  if(f.status) parts.push("st=" + encodeURIComponent(f.status));
  if(f.owner) parts.push("ow=" + encodeURIComponent(f.owner));
  if(f.type) parts.push("ty=" + encodeURIComponent(f.type));
  if(f.pub) parts.push("pb=" + encodeURIComponent(f.pub));
  if(f.cat) parts.push("cat=" + encodeURIComponent(f.cat));
  if(f.branch) parts.push("br=" + encodeURIComponent(f.branch));
  if(f.demand) parts.push("dm=" + encodeURIComponent(f.demand));
  if(f.stage) parts.push("sg=" + encodeURIComponent(f.stage));
  if(f.sort !== "default") parts.push("sort=" + encodeURIComponent(f.sort));
  return parts.join("&");
}
function routeHash(){
  var h = "#/version?id=" + encodeURIComponent(st.id);
  if(st.reqId) h += "&reqId=" + encodeURIComponent(st.reqId);
  if(st.tab !== "overview") h += "&tab=" + encodeURIComponent(st.tab);
  /* 筛选只在工作项页有意义：换页签不把它带进 URL，避免分享出去的链接自相矛盾 */
  if(st.tab === "scope"){
    var q = filterQuery();
    if(q) h += "&" + q;
  }
  return h;
}
function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "version") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  var tab = p.get("tab") || "overview";
  var sort = p.get("sort") || "default";
  return {
    id: p.get("id") || "",
    reqId: p.get("reqId") || "",
    tab: TAB_KEYS.indexOf(tab) >= 0 ? tab : "overview",
    filters:{
      q: p.get("q") || "",
      status: p.get("st") || "",
      owner: p.get("ow") || "",
      type: p.get("ty") || "",
      pub: p.get("pb") === "published" || p.get("pb") === "unpublished" ? p.get("pb") : "",
      cat: p.get("cat") || "",
      branch: p.get("br") || "",
      demand: p.get("dm") || "",
      stage: p.get("sg") || "",
      sort: SORT_KEYS.indexOf(sort) >= 0 ? sort : "default"
    }
  };
}
function syncRoute(push){
  var h = routeHash();
  if(window.location.hash === h) return;
  try{
    if(push) history.pushState(null, "", h);
    else history.replaceState(null, "", h);
  }catch(e){ window.location.hash = h; }
}
/* 跳转入口：先把完整 hash 压栈，再切视图；router 的 syncViewHash 会保留查询参数 */
function openVersionDetail(reqId, versionId, tab){
  if(!versionId){ toast("这一行没有归属版本", "warn"); return; }
  st.id = versionId;
  st.reqId = reqId || "";
  st.tab = TAB_KEYS.indexOf(tab) >= 0 ? tab : "overview";
  st.filters = blankFilters();
  syncRoute(true);
  showView("version");
}

function enterVersionView(){
  host = document.getElementById("versionBody");
  if(!host) return;
  wire();
  var route = parseRoute();
  if(!route || !route.id){
    st.seq++;
    st.id = ""; st.reqId = ""; st.version = null; st.stat = null;
    setTitle("版本详情");
    renderPicker();
    return;
  }
  adopt(route);
  load();
}
function adopt(route){
  var changed = route.id !== st.id || route.reqId !== st.reqId;
  st.id = route.id;
  st.reqId = route.reqId;
  st.tab = route.tab;
  st.filters = route.filters;
  if(changed){
    closeHoursSheet();
    st.version = null; st.stat = null; st.phase = null;
    st.tasks = []; st.versions = []; st.milestones = []; st.cats = []; st.allDemands = [];
    st.relFilters = { result:"", environment:"", operation:"" };
    extra = { demands:side(), plans:side(), records:side(), log:side() };
  }
}
/* 后退 / 前进只改了查询参数时 router 不会重进视图，这里自己对齐 */
function refreshFromHash(){
  if(activeView !== "version") return;
  var route = parseRoute();
  if(!route) return;
  if(!route.id){ enterVersionView(); return; }
  var sameTarget = route.id === st.id && route.reqId === st.reqId;
  var sameFilters = JSON.stringify(route.filters) === JSON.stringify(st.filters);
  if(sameTarget && route.tab === st.tab && sameFilters){ return; }
  adopt(route);
  if(!sameTarget){ load(); return; }
  renderAll();
}

/* 版本名由页内 sticky 页头承载（同列状态工作页），顶栏留「版本详情」表示位置，不重复版本名；
   浏览器标签页仍带版本名，收藏与分享出去能认出具体的版本 */
function setTitle(text){
  document.title = text + " · 沙漏";
}

/* ==================== 数据 ==================== */

function load(){
  var current = ++st.seq;
  st.loading = true;
  st.error = "";
  renderAll();
  var ready = st.reqId ? Promise.resolve(st.reqId) : resolveProject(st.id);
  ready.then(function(reqId){
    if(!alive(current)) return null;
    if(!reqId){
      st.loading = false;
      st.error = "找不到这个版本，它可能已被删除，或你已没有该项目的访问权限。";
      renderAll();
      return null;
    }
    st.reqId = reqId;
    /* 弹窗守卫与「返回版本页」都读这个项目上下文，必须先对齐再取数 */
    rt.phaseReqId = reqId;
    syncRoute(false);
    return Promise.all([
      API.get("/api/versions", { reqId: reqId }),
      API.get("/api/versions/stats", { reqId: reqId }),
      API.get("/api/versions/task-options", { reqId: reqId }),
      API.get("/api/phase/stats", { reqId: reqId }).catch(function(){ return null; }),
      API.get("/api/milestones", { reqId: reqId }).catch(function(){ return []; }),
      API.get("/api/categories", { project: reqId }).catch(function(){ return []; })
    ]).then(function(rs){
      if(!alive(current) || st.reqId !== reqId) return;
      st.versions = rs[0] || [];
      st.version = st.versions.filter(function(v){ return v.id === st.id; })[0] || null;
      var stats = rs[1] || {};
      st.stat = (stats.versions || []).filter(function(v){ return v.id === st.id; })[0] || null;
      st.phase = rs[3] || null;
      st.milestones = rs[4] || [];
      st.cats = rs[5] || [];
      st.tasks = scopeTasks(rs[2] || [], stats.versions || []);
      st.loading = false;
      if(!st.version && !st.stat){
        st.error = "这个项目下已没有该版本，它可能已被删除。";
        renderAll();
        return;
      }
      setTitle(versionName());
      renderAll();
      loadSide(current, reqId);
    });
  }).catch(function(ex){
    if(!alive(current)) return;
    st.loading = false;
    st.error = ex.message || "网络异常，请稍后重试";
    renderAll();
  });
}
/* 只给了版本 id 的深链（手输 / 外部粘贴）：用跨项目清单反查所属项目 */
function resolveProject(versionId){
  return API.get("/api/versions/cross-project").then(function(rows){
    var hit = (rows || []).filter(function(r){ return r.versionId === versionId; })[0];
    pickerRows = rows || [];
    return hit ? hit.reqId : "";
  }).catch(function(){ return ""; });
}
/* 首版上线前未绑版本的工作项折算进最早已发布版本：与版本卡同一口径 */
function scopeTasks(all, stats){
  var firstRel = st.phase && st.phase.firstReleasedAt;
  var preId = null;
  stats.forEach(function(v){ if(v.preLaunchCount > 0) preId = v.id; });
  var rows = [];
  all.forEach(function(t){
    var bound = taskVersionIds(t);
    if(bound.length){
      if(bound.indexOf(st.id) !== -1) rows.push(Object.assign({}, t, { _pre:false }));
      return;
    }
    if(!preId || st.id !== preId || !firstRel) return;
    var d = t.completedAt || t.startDate || t.dueDate || "";
    if(d && dayKey(d) <= dayKey(firstRel)) rows.push(Object.assign({}, t, { _pre:true }));
  });
  return rows;
}
function loadSide(current, reqId){
  var id = encodeURIComponent(st.id);
  fetchSide("demands", current, function(){
    return API.getAllPages("/api/demands", { reqId: reqId }).then(function(rows){
      /* 整份留着做名字解析：工作项挂的需求未必把目标版本指向本版本，不能只留过滤后的那几条 */
      st.allDemands = rows || [];
      return st.allDemands.filter(function(d){ return d.versionId === st.id && d.status !== "rej"; });
    });
  });
  fetchSide("plans", current, function(){ return API.get("/api/versions/" + id + "/release-plans"); });
  fetchSide("records", current, function(){ return API.get("/api/versions/" + id + "/release-records"); });
  fetchSide("log", current, function(){ return API.get("/api/versions/" + id + "/release-history"); });
}
function fetchSide(key, current, get){
  var slot = extra[key];
  slot.loading = true;
  slot.error = "";
  get().then(function(rows){
    if(!alive(current)) return;
    slot.rows = rows || [];
    slot.loading = false;
    sideArrived(key);
  }).catch(function(ex){
    if(!alive(current)) return;
    slot.rows = null;
    slot.loading = false;
    slot.error = ex.message || "加载失败";
    sideArrived(key);
  });
}
/* 侧栏数据迟到时只重画用得上它的那一页：别把正在输入的筛选框冲掉 */
var SIDE_TAB = { demands:"demands", plans:"releases", records:"releases", log:"log" };
function sideArrived(key){
  syncTabCounts();
  /* 需求清单还负责给工作项行的关联 chip 供名字，所以它到位时工作项页也要重画 */
  if(st.tab === SIDE_TAB[key] || (key === "demands" && st.tab === "scope")) renderAll();
}
function reload(){
  closeHoursSheet();
  if(!st.id){ renderPicker(); return; }
  extra = { demands:side(), plans:side(), records:side(), log:side() };
  load();
}

/* ==================== 渲染骨架 ==================== */

/* 整页重画时把焦点与光标放回去：筛选框每敲一个字都会重画，不能把输入打断 */
function focusedKey(){
  var el = document.activeElement;
  if(!el || !host || !host.contains(el) || !el.getAttribute) return null;
  var key = el.getAttribute("data-vd-filter");
  if(key) return { sel:'[data-vd-filter="' + key + '"]', pos:el.selectionStart };
  if(el.id === "vdPickerQuery") return { sel:"#vdPickerQuery", pos:el.selectionStart };
  return null;
}
function restoreFocus(mark){
  if(!mark) return;
  var el = host.querySelector(mark.sel);
  if(!el) return;
  el.focus();
  if(mark.pos != null && el.setSelectionRange){
    try{ el.setSelectionRange(mark.pos, mark.pos); }catch(e){ /* search 类型部分浏览器不支持 */ }
  }
}
function renderAll(){
  if(!host) return;
  if(!st.id){ paintPicker(); return; }
  if(st.loading && !st.version && !st.stat){
    host.innerHTML = headSkeleton() + '<div class="vd-body">' + UI.skeletonCards(3) + '</div>';
    return;
  }
  if(st.error && !st.version && !st.stat){
    host.innerHTML = headSkeleton() + '<div class="vd-body">'
      + UI.emptyState({ icon:"alert", title:"版本不可用", text:st.error, actionLabel:"返回版本列表" })
      + '</div>';
    var btn = host.querySelector("[data-empty-action]");
    if(btn) btn.addEventListener("click", backToVersions);
    return;
  }
  var mark = focusedKey();
  host.innerHTML = headHTML() + '<div class="vd-body">' + bodyHTML() + '</div>';
  syncTabCounts();
  syncDescToggle();
  restoreFocus(mark);
}
function headSkeleton(){
  return '<header class="vd-head"><div class="vd-head-top">'
    + backBtn() + '<h1 class="vd-title">版本详情</h1></div></header>';
}
function backBtn(){
  return '<button class="vd-back" type="button" data-vd-back>' + icon("left", 13) + ' 版本</button>';
}
function tabCount(key){
  if(key === "scope") return st.tasks.length;
  if(key === "demands") return extra.demands.rows ? extra.demands.rows.length : null;
  if(key === "releases") return extra.records.rows ? extra.records.rows.length : null;
  if(key === "log") return extra.log.rows ? extra.log.rows.length : null;
  return null;
}
/* 版本说明只在页头展示两行，溢出时才给展开入口；与版本卡此前的「展开说明」保持同一交互 */
function descHTML(text){
  if(!text) return "";
  return '<div class="vd-desc-wrap">'
    + '<p class="vd-desc" data-vd-desc>' + esc(text) + '</p>'
    + '<button class="vd-desc-toggle" type="button" data-vd-desc-toggle hidden>展开说明</button>'
    + '</div>';
}
function syncDescToggle(){
  if(!host) return;
  var p = host.querySelector("[data-vd-desc]");
  var btn = host.querySelector("[data-vd-desc-toggle]");
  if(!p || !btn) return;
  var open = p.classList.contains("open");
  btn.hidden = !open && p.scrollHeight <= p.clientHeight + 1;
  btn.textContent = open ? "收起说明" : "展开说明";
}
function headHTML(){
  var v = st.version || st.stat || {};
  var actions = [];
  if(writable() && !readOnly()){
    actions.push('<button class="btn sm" type="button" data-vd-tool="edit">' + icon("edit", 13) + ' 编辑版本</button>');
    actions.push('<button class="btn sm" type="button" data-vd-tool="tasks">管理范围</button>');
  }
  if(st.version && st.version.canPublish === true){
    actions.push('<button class="btn sm primary" type="button" data-vd-tool="actual">记录实际发布</button>');
  }
  actions.push('<button class="btn sm ghost" type="button" data-vd-tool="plan">计划与历史</button>');
  actions.push('<button class="btn sm ghost" type="button" data-vd-delivery>交付说明</button>');
  var lock = readOnly()
    ? '<span class="tag ghost vd-lock">' + icon("lock", 11) + (ended() ? "已终态" : "正式发布后只读") + '</span>'
    : "";
  return '<header class="vd-head">'
    + '<div class="vd-head-top">' + backBtn()
    + '<h1 class="vd-title" title="' + esc(versionName()) + '">' + esc(versionName()) + '</h1>'
    + statusTag(v.status) + lock
    + '<span class="sp"></span>' + switcherHTML()
    + '<button class="icon-btn sm" type="button" data-vd-refresh title="刷新版本详情" aria-label="刷新版本详情">' + icon("refresh", 15) + '</button>'
    + '</div>'
    + '<div class="vd-sub">'
    + '<button class="vd-proj" type="button" data-vd-project title="打开该项目驾驶舱">' + icon("projects", 12) + esc(reqNameById(st.reqId) || "项目") + '</button>'
    + '<span class="vd-dot">·</span><span>' + esc(windowText()) + '</span>'
    + (v.releasedAt ? '<span class="vd-dot">·</span><span>发布于 ' + esc(dateText(v.releasedAt)) + '</span>' : "")
    + (v.revision ? '<span class="vd-dot">·</span><span class="vd-rev">修订 ' + esc(v.revision) + '</span>' : "")
    + '</div>'
    + descHTML(v.description)
    + (actions.length ? '<div class="vd-acts">' + actions.join("") + '</div>' : "")
    + '<nav class="vd-tabs" aria-label="版本详情分区">' + TABS.map(function(t){
      var on = t.key === st.tab;
      var n = tabCount(t.key);
      return '<button class="vd-tab' + (on ? " on" : "") + '" type="button" data-vd-tab="' + t.key + '"'
        + (on ? ' aria-current="page"' : "") + '>' + esc(t.label)
        + (n === null ? "" : '<b>' + n + '</b>') + '</button>';
    }).join("") + '</nav>'
    + '</header>';
}
function syncTabCounts(){
  if(!host) return;
  TABS.forEach(function(t){
    var b = host.querySelector('[data-vd-tab="' + t.key + '"]');
    if(!b) return;
    var n = tabCount(t.key), bEl = b.querySelector("b");
    if(n === null){ if(bEl) bEl.remove(); return; }
    if(bEl){ bEl.textContent = n; return; }
    b.insertAdjacentHTML("beforeend", "<b>" + n + "</b>");
  });
}
/* 同项目版本切换：详情页里横向比对相邻版本，不用退回列表再点一次 */
function switcherHTML(){
  if(st.versions.length < 2) return "";
  return '<label class="vd-switch"><span>版本</span>'
    + '<select class="mini-select" data-vd-switch aria-label="切换到同项目其他版本">'
    + st.versions.map(function(v){
      return '<option value="' + esc(v.id) + '"' + (v.id === st.id ? " selected" : "") + '>'
        + esc(v.name) + '（' + esc(statusName(v.status)) + '）</option>';
    }).join("") + '</select></label>';
}
function bodyHTML(){
  if(st.tab === "scope") return scopeHTML();
  if(st.tab === "demands") return demandsHTML();
  if(st.tab === "releases") return releasesHTML();
  if(st.tab === "log") return logHTML();
  return overviewHTML();
}
function panel(title, meta, inner, cls){
  return '<section class="panel vd-panel' + (cls ? " " + cls : "") + '"><div class="panel-head"><h3>' + esc(title) + '</h3>'
    + (meta ? '<span class="meta-right">' + meta + '</span>' : "") + '</div>' + inner + '</section>';
}
function tableWrap(head, body){
  return '<div class="vd-tbl-wrap"><table class="phase-tbl"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function emptyRow(cols, text){
  return '<tr><td colspan="' + cols + '" class="foot-note tbl-empty">' + esc(text) + '</td></tr>';
}

/* ==================== 概览 ==================== */

function cell(value, label, tone, drill, help){
  var style = tone ? ' class="vd-' + tone + '"' : "";
  var inner;
  if(drill){
    inner = '<button type="button" class="pcell drillable" data-vd-drill="' + esc(drill) + '" title="在工作项页查看该口径明细">'
      + '<b' + style + '>' + value + '</b><span>' + esc(label) + '</span></button>';
  } else {
    inner = '<div class="pcell"><b' + style + '>' + value + '</b><span>' + esc(label) + '</span></div>';
  }
  if(!help) return inner;
  return '<div class="vd-cell-wrap">' + inner
    + caliberMarkHTML(help.key, !!help.warn, "查看「" + label + "」口径") + '</div>';
}
function overviewHTML(){
  var s = st.stat || {};
  var moving = st.tasks.filter(function(t){ return !isDone(t) && actOf(t) > 0; }).length;
  var cells = [
    cell(st.tasks.length, "版本工作项", "", "all"),
    cell(num(s.doneCount), "已完成", "ok", "done"),
    cell(num(moving), "进行中", "", "moving"),
    cell(pctText(s.deviationPct), "整体偏差", devTone(s.deviationPct), "deviation", { key:"version.variance", warn:true }),
    cell(s.onTimePct === null || s.onTimePct === undefined ? "—" : s.onTimePct + "%", "准时完成率", "", "ontime", { key:"version.onTime" })
  ];
  var demandCount = num(s.demandCount);
  cells.push('<button type="button" class="pcell drillable" data-vd-tab="demands" title="查看排到该版本的需求">'
    + '<b>' + demandCount + '</b><span>已排需求</span></button>');
  var kpis = '<div class="pgrid vd-kpis">' + cells.join("") + '</div>'
    + (st.tasks.some(function(t){ return t._pre; })
      ? '<p class="foot-note vd-caliber">范围 = 该版本绑定的工作项，含首版上线前未绑版本的折算项（行内标注）。</p>'
      : "");
  return kpis
    + hoursCardHTML()
    + progressPanel()
    + commitmentPanel()
    + milestonePanel()
    + branchPanel()
    + deliveryPanel()
    + lifecyclePanel();
}
function progressPanel(){
  var total = st.tasks.length;
  var done = st.tasks.filter(isDone).length;
  var over = st.tasks.filter(isOver).length;
  var idle = st.tasks.filter(function(t){ return !isDone(t) && actOf(t) === 0; }).length;
  var pct = total ? Math.round(done * 100 / total) : 0;
  var seg = [
    { key:"done", label:"已完成", n:done, color:"var(--success)" },
    { key:"moving", label:"进行中", n:total - done - idle, color:"var(--info)" },
    { key:"idle", label:"未开始", n:idle, color:"var(--border-strong)" }
  ];
  var bar = seg.map(function(g){
    if(!g.n) return "";
    return '<i style="width:' + (g.n * 100 / total) + '%;background:' + g.color + '" title="' + esc(g.label + " " + g.n + " 项") + '"></i>';
  }).join("");
  var legend = seg.map(function(g){
    if(!g.n) return "";
    return '<button class="vd-lg vd-lg-btn" type="button" data-vd-drill="' + g.key + '" title="在工作项页查看「' + esc(g.label) + '」明细">'
      + '<i style="background:' + g.color + '"></i>' + esc(g.label) + ' <b>' + g.n + '</b></button>';
  }).join("");
  /* 百分比是完成率，色条是范围构成：两者口径不同，各自标注，避免「0% 却填了大半」的误读 */
  var aria = seg.map(function(g){ return g.label + " " + g.n + " 项"; }).join("，");
  var inner = (total
    ? '<div class="vd-progress">'
      + '<span class="vd-pct"><b>' + pct + '%</b><small>完成率</small></span>'
      + '<span class="vd-bar-wrap"><small class="vd-bar-cap">范围构成</small>'
      + '<span class="vd-bar" role="img" aria-label="' + esc("范围构成：" + aria) + '">' + bar + '</span></span>'
      + '</div>'
      + '<div class="vd-legend">' + legend
      + (over ? '<button class="vd-lg vd-lg-btn vd-lg-danger" type="button" data-vd-drill="over" title="在工作项页查看「已逾期」明细"><i style="background:var(--danger)"></i>已逾期 <b>' + over + '</b></button>' : "")
      + '</div>'
    : '<p class="hint">该版本还没有工作项，先在「管理范围」里绑定，或在工作项抽屉里选择计划版本。</p>');
  return panel("范围进度", '<span class="meta-right">' + (total ? done + " / " + total + " 项已完成" : "") + '</span>', inner);
}
function commitmentPanel(){
  var c = (st.stat || {}).commitment;
  if(!c){
    return panel("承诺基线", "", '<p class="hint">还没有基线。开始开发时会冻结当时的范围与预估，之后新增 / 移出都与它对比。</p>');
  }
  var rows = [
    ["冻结范围", num(c.taskCount) + " 项", "预估 " + hours(c.estimateMinutes), "version.commit.scope", false],
    ["基线完成", (c.donePct === null || c.donePct === undefined ? "—" : c.donePct + "%"), num(c.doneCount) + " 项已完成", "version.commit.done", true],
    ["启动后新增", num(c.addedCount) + " 项", c.addedEstimateMinutes ? "预估 " + hours(c.addedEstimateMinutes) : "无新增预估", "version.commit.added", false],
    ["基线移出", num(c.removedCount) + " 项", c.removedEstimateMinutes ? "预估 " + hours(c.removedEstimateMinutes) : "无移出预估", "version.commit.removed", true]
  ];
  var inner = '<div class="vd-cmp">' + rows.map(function(r, i){
    var tone = i === 2 && num(c.addedCount) ? " vd-warn-text" : (i === 3 && num(c.removedCount) ? " vd-bad-text" : "");
    return '<div class="vd-cmp-cell"><span class="caliber-label">' + esc(r[0])
      + caliberMarkHTML(r[3], r[4], "查看「" + r[0] + "」口径")
      + '</span><b class="' + tone.trim() + '">' + esc(r[1]) + '</b><small>' + esc(r[2]) + '</small></div>';
  }).join("") + '</div>'
    + '<p class="foot-note">基线只快照一次' + (c.capturedAt ? "（" + esc(dateText(c.capturedAt)) + " 冻结）" : "")
    + '；预估变更不回写基线，新增 / 移出按当前绑定与基线的差集计算。</p>';
  return panel("承诺基线", "", inner);
}
function milestonePanel(){
  var list = st.milestones.filter(function(m){ return m.kind === "version" && m.versionId === st.id && m.status !== "canceled"; });
  if(!list.length){
    return panel("里程碑", "", '<p class="hint">该版本没有关联里程碑。里程碑在项目驾驶舱里创建与达成。</p>');
  }
  var names = { achieved:"已达成", achieved_rolled_back:"已达成 · 已回滚", overdue:"已延期", pending:"未达成" };
  var body = list.map(function(m){
    var tone = m.status === "achieved" ? "tag-success" : m.status === "overdue" ? "tag-danger" : "ghost";
    return '<tr data-vd-milestone="' + esc(m.id) + '" tabindex="0" title="查看里程碑详情与达成证据">'
      + '<td>' + esc(m.name || "里程碑") + '</td>'
      + '<td><span class="tag ' + tone + '">' + esc(names[m.status] || m.status) + '</span></td>'
      + '<td class="num">' + esc(dateText(m.targetDate) || "—") + '</td>'
      + '<td class="num">' + esc(dateText(m.achievedAt) || "—") + '</td>'
      + '<td class="num">' + num(m.releaseCount) + '</td></tr>';
  }).join("");
  return panel("里程碑", '<span class="meta-right">点击行看达成证据</span>',
    tableWrap('<th>里程碑</th><th>状态</th><th class="num">目标日</th><th class="num">达成日</th><th class="num">生产成功</th>', body));
}
function catName(id){
  if(!id) return "未指定模块";
  var hit = st.cats.filter(function(c){ return c.id === id; })[0];
  return hit ? hit.name : "未指定模块";
}
function catColor(id){
  var hit = st.cats.filter(function(c){ return c.id === id; })[0];
  return (hit && hit.color) || "var(--palette-8)";
}

/* ==================== 工时卡与工时构成 ====================
   顶层只保留「预估 / 实际」两侧，构成收进弹层：预估按现有字段拆类型 / 模块 / 负责人 / 需求 / 工作项，
   实际拆成员 / 类型 / 模块 / 工作项 / 计时窗口。类型只是阶段的近似观察，不新增字段。 */

var TYPE_PROXY = {
  story:{ label:"需求", proxy:"设计 / 分析", color:"var(--plum)" },
  task:{ label:"任务", proxy:"开发", color:"var(--primary)" },
  bug:{ label:"缺陷", proxy:"测试 / 修复", color:"var(--danger)" },
  epic:{ label:"史诗", proxy:"规划 / 拆解", color:"var(--palette-3)" },
  other:{ label:"其他", proxy:"未分类", color:"var(--palette-8)" }
};
var TYPE_ORDER = ["story","task","bug","epic"];
var HOUR_TABS = {
  estimate:[["type","类型"],["cat","模块"],["owner","负责人"],["demand","需求"],["items","工作项"]],
  actual:[["owner","成员"],["type","类型"],["cat","模块"],["items","工作项"],["window","计时窗口"]]
};
var UNLINKED_DEMAND = "__unlinked__";
var hourSheet = null;

function hourText(v){ var m = num(v); return m ? fmtMinutesShort(m) : "0h"; }
function hourPct(v, total){ return total ? Math.round(v * 1000 / total) / 10 : 0; }
function hourPctText(v, total){
  var p = hourPct(v, total);
  return (p % 1 ? p.toFixed(1) : String(p)) + "%";
}
function estTotal(){ return st.tasks.reduce(function(a, t){ return a + estOf(t); }, 0); }
function actTotal(){ return st.tasks.reduce(function(a, t){ return a + actOf(t); }, 0); }
function avgDoneText(){
  var v = (st.stat || {}).avgTaskMinutes;
  return (v === null || v === undefined) ? "—" : fmtMinutesShort(v);
}
function hourTagHTML(type){
  var p = TYPE_PROXY[type] || TYPE_PROXY.other;
  return '<span class="vd-h-tag ' + esc(type || "other") + '">' + esc(p.label) + '</span>';
}

function hoursCardHTML(){
  var s = st.stat || {};
  var total = st.tasks.length;
  var est = num(s.estimateMinutes) || estTotal();
  var act = num(s.workMinutes) || actTotal();
  var remaining = num(s.remainingMinutes);
  var estItems = st.tasks.filter(function(t){ return estOf(t) > 0; }).length;
  var actItems = st.tasks.filter(function(t){ return actOf(t) > 0; }).length;
  var unest = total - estItems;
  var burn = hourPct(act, est);
  var burnText = est ? hourPctText(act, est) : "—";
  return '<section class="panel vd-panel vd-hours-card" aria-labelledby="vdHoursTitle">'
    + '<div class="panel-head"><h3 id="vdHoursTitle">工时</h3>'
    + '<span class="meta-right"><span class="vd-hours-badge primary">现有字段</span><span class="vd-hours-badge">预估 / 实际</span></span></div>'
    + '<div class="vd-hours-grid">'
    + '<div class="vd-hour-side">'
      + '<button class="vd-hour-main" type="button" data-vd-hours="estimate" aria-haspopup="dialog" title="查看预估工时构成">'
      + '<span class="vd-hour-label"><i style="background:var(--primary)"></i>预估</span>'
      + '<span class="vd-hour-value">' + hourText(est) + '<small>' + (estItems ? estItems + ' 项合计' : '还没有预估') + '</small></span>'
      + '<span class="vd-hour-sub' + (unest ? " warn" : "") + '">'
      + (total ? estItems + " / " + total + " 项已估" + (unest ? " · " + unest + " 项未估" : "") : "该版本还没有工作项")
      + '</span>'
      + '<span class="vd-hour-cta">查看构成' + icon("chevronRight", 11) + '</span>'
      + '</button>'
      + caliberMarkHTML("version.estimate", false, "查看「预估」口径")
    + '</div>'
    + '<span class="vd-hour-sep" aria-hidden="true"></span>'
    + '<div class="vd-hour-side">'
      + '<button class="vd-hour-main" type="button" data-vd-hours="actual" aria-haspopup="dialog" title="查看实际工时构成">'
      + '<span class="vd-hour-label"><i style="background:var(--success)"></i>实际</span>'
      + '<span class="vd-hour-value">' + hourText(act) + '<small>' + (actItems ? actItems + ' 项有计时' : '还没有计时') + '</small></span>'
      + '<span class="vd-hour-sub">' + (total ? actItems + " / " + total + " 项有计时" : "该版本还没有工作项") + '</span>'
      + '<span class="vd-hour-cta">查看构成' + icon("chevronRight", 11) + '</span>'
      + '</button>'
      + '<span class="vd-hour-avgrow"><button class="vd-hour-avg" type="button" data-vd-drill="avg" title="在工作项页查看已完成、按实际工时排序的明细">已完成项均耗时 ' + esc(avgDoneText()) + ' · 只算已完成</button>'
      + caliberMarkHTML("version.avgTask", false, "查看「工作项均耗时」口径") + '</span>'
      + caliberMarkHTML("version.actual", false, "查看「实际」口径")
    + '</div>'
    + '</div>'
    + '<div class="vd-burn">'
      + '<div class="vd-burn-head"><span>实际 / 预估</span><b>' + burnText + '</b></div>'
      + '<span class="vd-burn-track" role="img" aria-label="' + esc("实际 " + hourText(act) + "，为预估 " + hourText(est) + " 的 " + burnText) + '">'
      + '<i style="width:' + Math.min(100, burn) + '%"></i></span>'
      + '<div class="vd-burn-foot"><span>已记 ' + hourText(act) + '</span>'
      + '<span class="mid">剩余预估 ' + hourText(remaining) + caliberMarkHTML("version.remaining", true, "查看「剩余预估」口径") + '</span>'
      + '<span>预估 ' + hourText(est) + '</span></div>'
    + '</div>'
    + '<p class="foot-note vd-hours-note">预估按工作项合计，实际按工作项累计计时；未计时的工作项不计入实际。'
    + '剩余预估是未完成工作项的预估之和，不扣已投入。测试窗口只是实际工时的筛选口径，收进「计时窗口」，不再单列指标。</p>'
    + '</section>';
}

function hourKey(kind, t){
  if(kind === "type") return t.itemType || "other";
  if(kind === "cat") return t.categoryId || NONE;
  if(kind === "owner") return (t.owner || "").trim() || NONE;
  return t.demandId || UNLINKED_DEMAND;
}
function hourLabel(kind, key){
  if(kind === "type") return (TYPE_PROXY[key] || TYPE_PROXY.other).label;
  if(kind === "cat") return catName(key === NONE ? "" : key);
  if(kind === "owner") return key === NONE ? "未指派" : key;
  if(key === UNLINKED_DEMAND) return "未关联需求";
  var d = demandHit(key);
  return (d && d.title) || "已删除需求";
}
/* 颜色保证同一张表里彼此可分：模块用分类色，未配色时按行序走调色板；
   负责人 / 需求没有配色字段，同样按行序取调色板，未指派 / 未关联固定灰色 */
function hourColor(kind, key, i){
  if(kind === "type") return (TYPE_PROXY[key] || TYPE_PROXY.other).color;
  if(kind === "owner" && key === NONE) return "var(--palette-8)";
  if(kind === "demand" && key === UNLINKED_DEMAND) return "var(--palette-8)";
  if(kind === "cat"){
    var c = catColor(key === NONE ? "" : key);
    if(c !== "var(--palette-8)") return c;
  }
  return "var(--palette-" + (i % 7 + 1) + ")";
}
function hourGroupRows(kind, mode){
  var list = mode === "actual" ? st.tasks.filter(function(t){ return actOf(t) > 0; }) : st.tasks;
  var map = {}, order = [];
  list.forEach(function(t){
    var key = hourKey(kind, t);
    if(!map[key]){
      map[key] = { key:key, est:0, act:0, items:0, estItems:0 };
      order.push(key);
    }
    var g = map[key];
    g.est += estOf(t);
    g.act += actOf(t);
    g.items++;
    if(estOf(t) > 0) g.estItems++;
  });
  var rows;
  if(kind === "type"){
    var keys = TYPE_ORDER.filter(function(k){ return map[k]; });
    if(map.other) keys.push("other");
    rows = keys.map(function(k){ return map[k]; });
  }else{
    var vk = mode === "estimate" ? "est" : "act";
    rows = order.map(function(k){ return map[k]; }).sort(function(a, b){ return b[vk] - a[vk] || b.items - a.items; });
  }
  rows.forEach(function(r, i){
    r.label = hourLabel(kind, r.key);
    r.color = hourColor(kind, r.key, i);
  });
  return rows;
}
function hoursShareHTML(v, total, color){
  return '<span class="vd-h-share"><span class="vd-h-track">'
    + '<i style="width:' + (total ? v * 100 / total : 0) + '%;background:' + esc(color) + '"></i></span>'
    + '<b>' + hourPctText(v, total) + '</b></span>';
}
function hoursStackHTML(rows, total, valueKey, labelPrefix){
  var visible = rows.filter(function(r){ return r[valueKey] > 0; });
  var aria = visible.map(function(r){
    return r.label + " " + hourText(r[valueKey]) + " " + hourPctText(r[valueKey], total);
  }).join("，");
  return '<div class="vd-h-stack" role="img" aria-label="' + esc(labelPrefix + "：" + (aria || "暂无计时")) + '">'
    + visible.map(function(r){
      return '<i style="width:' + (r[valueKey] * 100 / total).toFixed(2) + '%;background:' + esc(r.color) + '" title="'
        + esc(r.label + " " + hourText(r[valueKey]) + " " + hourPctText(r[valueKey], total)) + '"></i>';
    }).join("") + '</div>';
}
function hoursLegendHTML(rows, total, valueKey, kind){
  return '<div class="vd-h-legend">' + rows.map(function(r){
    var v = r[valueKey];
    return '<button type="button" data-vd-hfilter="' + esc(kind) + '" data-vd-hvalue="' + esc(r.key) + '" data-vd-hlabel="' + esc(r.label) + '" title="查看该分组的工作项">'
      + '<i style="background:' + esc(r.color) + '"></i>' + esc(r.label) + ' <b>' + hourText(v) + '</b>'
      + '<span class="muted">' + hourPctText(v, total) + '</span></button>';
  }).join("") + '</div>';
}
function hoursProxyHTML(mode){
  var rows = hourGroupRows("type", mode);
  var map = {};
  rows.forEach(function(r){ map[r.key] = r; });
  var keys = ["story","task","bug"].concat(map.epic ? ["epic"] : []);
  var total = rows.reduce(function(a, r){ return a + (mode === "estimate" ? r.est : r.act); }, 0);
  var cards = keys.map(function(k){
    var r = map[k] || { key:k, est:0, act:0, items:0, estItems:0 };
    var v = mode === "estimate" ? r.est : r.act;
    var meta = mode === "estimate"
      ? r.items + " 项 · 占 " + hourPctText(v, total)
      : r.items + " 项 · 预估 " + hourText(r.est);
    return '<div class="vd-h-proxy-card">'
      + '<div class="vd-h-proxy-type"><i style="background:' + TYPE_PROXY[k].color + '"></i>' + esc(TYPE_PROXY[k].label) + '</div>'
      + '<div class="vd-h-proxy-map">≈ <b>' + esc(TYPE_PROXY[k].proxy) + '</b></div>'
      + '<b>' + hourText(v) + '</b><small>' + esc(meta) + '</small></div>';
  }).join("");
  return '<div class="vd-h-proxy-head"><b>按类型近似看阶段</b><span>现有字段 · 不需要新增</span></div>'
    + '<div class="vd-h-proxy-grid">' + cards + '</div>';
}
function hoursExtraHead(kind, mode){
  if(kind === "type") return "近似阶段";
  if(mode === "actual" && kind === "owner") return "名下预估";
  if(mode === "actual") return "预估";
  return "实际";
}
function hoursExtraCell(kind, mode, r){
  if(kind === "type") return '<span class="muted">' + esc((TYPE_PROXY[r.key] || TYPE_PROXY.other).proxy) + '</span>';
  return hourText(mode === "actual" ? r.est : r.act);
}
function hoursExtraTotal(kind, mode){
  if(kind === "type") return "—";
  return hourText(mode === "estimate" ? actTotal() : estTotal());
}
function hoursNoticeHTML(kind, mode, rows, total){
  if(kind === "type"){
    return '<div class="vd-h-notice info">' + icon("info", 13)
      + '<span><b>类型是现有数据里最接近阶段的观察口径。</b>需求 ≈ 设计 / 分析，任务 ≈ 开发，缺陷 ≈ 测试 / 修复。'
      + '一个工作项仍可能跨多个阶段，因此它是代理口径，不是真实阶段工时。</span></div>';
  }
  if(kind === "demand" && mode === "estimate"){
    var un = rows.filter(function(r){ return r.key === UNLINKED_DEMAND; })[0];
    if(un && un.est > 0){
      return '<div class="vd-h-notice info">' + icon("info", 13)
        + '<span><b>未关联需求 ' + un.items + ' 项、' + hourText(un.est) + '，占 ' + hourPctText(un.est, total) + '。</b>'
        + '需求维度目前只覆盖 ' + hourText(total - un.est) + '；补齐工作项的需求关联后，这个维度才完整。 '
        + '<button class="link-btn" type="button" data-vd-hfilter="demand" data-vd-hvalue="' + esc(UNLINKED_DEMAND) + '" data-vd-hlabel="未关联需求">只看未关联</button></span></div>';
    }
  }
  return "";
}
function hoursGroupHTML(kind, mode){
  var rows = hourGroupRows(kind, mode);
  var valueKey = mode === "estimate" ? "est" : "act";
  var total = rows.reduce(function(a, r){ return a + r[valueKey]; }, 0);
  var firstHead = kind === "type" ? "类型"
    : kind === "cat" ? "模块"
    : kind === "owner" ? (mode === "actual" ? "成员" : "负责人")
    : "需求";
  var body = rows.map(function(r){
    var v = r[valueKey];
    return '<tr class="vd-h-row" tabindex="0" data-vd-hfilter="' + esc(kind) + '" data-vd-hvalue="' + esc(r.key) + '" data-vd-hlabel="' + esc(r.label) + '"'
      + ' title="查看「' + esc(r.label) + '」的工作项">'
      + '<td><span class="vd-h-name"><i style="background:' + esc(r.color) + '"></i><span>' + esc(r.label) + '</span></span></td>'
      + '<td class="num strong">' + hourText(v) + '</td>'
      + '<td class="num">' + hoursShareHTML(v, total, r.color) + '</td>'
      + '<td class="num">' + r.items + ' 项</td>'
      + '<td class="num vd-h-hide">' + (mode === "estimate" ? r.estItems + " / " + r.items + " 项" : r.items + " 项") + '</td>'
      + '<td class="num vd-h-hide">' + hoursExtraCell(kind, mode, r) + '</td></tr>';
  }).join("");
  var totalItems = rows.reduce(function(a, r){ return a + r.items; }, 0);
  var totalEstItems = rows.reduce(function(a, r){ return a + r.estItems; }, 0);
  var totalRow = '<tr class="vd-h-total"><td>合计</td><td class="num">' + hourText(total) + '</td>'
    + '<td class="num">' + (total ? "100%" : "—") + '</td><td class="num">' + totalItems + ' 项</td>'
    + '<td class="num vd-h-hide">' + (mode === "estimate" ? totalEstItems + " / " + totalItems + " 项" : totalItems + " 项") + '</td>'
    + '<td class="num vd-h-hide">' + hoursExtraTotal(kind, mode) + '</td></tr>';
  var foot;
  if(kind === "type"){
    foot = "类型来自工作项；近似阶段只用于快速判断投入结构，不作为阶段工时。占比保留一位小数。";
  }else if(kind === "demand"){
    foot = "需求来自工作项关联，需求名与工作项名不一定一致；已关闭需求仍保留在构成里。未关联的工作项也计入合计。";
  }else if(kind === "cat"){
    foot = "模块来自工作项分类，可直接使用；实际按工作项累计计时归集。";
  }else if(mode === "actual"){
    foot = "实际按工作项负责人归集（计时未拆到具体记录）；名下预估按工作项负责人归集。";
  }else{
    foot = "负责人来自工作项；实际按工作项累计计时归集，两者可能不同。";
  }
  var estT = estTotal(), actT = actTotal();
  var compare = kind === "type"
    ? '<div class="vd-h-compare"><span>实际 <b>' + hourText(actT) + '</b> · 预估 <b>' + hourText(estT) + '</b></span>'
      + '<span class="vd-h-compare-bar" aria-hidden="true"><i style="width:' + Math.min(100, hourPct(actT, estT)) + '%"></i></span>'
      + '<span>实际 / 预估 <b>' + (estT ? hourPctText(actT, estT) : "—") + '</b></span></div>'
    : "";
  return hoursNoticeHTML(kind, mode, rows, total)
    + (kind === "type" ? hoursProxyHTML(mode) : "")
    + hoursStackHTML(rows, total, valueKey, mode === "estimate" ? "预估构成" : "实际构成")
    + hoursLegendHTML(rows, total, valueKey, kind)
    + '<div class="vd-h-tablewrap"><table class="vd-h-table"><thead><tr>'
    + '<th>' + firstHead + '</th><th class="num">' + (mode === "estimate" ? "预估" : "实际") + '</th><th class="num">占比</th><th class="num">工作项</th>'
    + '<th class="num vd-h-hide">' + (mode === "estimate" ? "已估" : "计时") + '</th>'
    + '<th class="num vd-h-hide">' + hoursExtraHead(kind, mode) + '</th>'
    + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>'
    + '<p class="foot-note">' + foot + '</p>' + compare;
}

function hoursDeltaHTML(t){
  var est = estOf(t), act = actOf(t);
  if(!est) return '<span class="muted">未估</span>';
  var d = act - est;
  if(!d) return '<span class="muted">持平</span>';
  return '<span class="vd-h-delta ' + (d > 0 ? "up" : "down") + '">' + (d > 0 ? "+" : "−") + fmtMinutesShort(Math.abs(d)) + '</span>';
}
function hoursItemTitle(t){
  return '<span class="vd-h-item"><b>' + esc(t.title) + '</b>' + taskPublicationHTML(t) + '<small>' + esc(itemNoText(t.itemNo) || "WI")
    + (t.categoryId ? " · " + esc(catName(t.categoryId)) : "") + '</small></span>';
}
function hoursItemRowHTML(t, mode){
  var title = '<td>' + hoursItemTitle(t) + '</td>';
  var type = '<td class="vd-h-hide">' + hourTagHTML(t.itemType) + '</td>';
  var owner = '<td class="vd-h-hide vd-muted">' + esc(t.owner || "未指派") + '</td>';
  if(mode === "actual"){
    return '<tr class="vd-h-task" tabindex="0" data-vd-htask="' + esc(t.id) + '" title="打开工作项详情">' + title + type + owner
      + '<td class="num vd-h-hide">' + (estOf(t) ? hours(estOf(t)) : '<span class="muted">未估</span>') + '</td>'
      + '<td class="num strong">' + hours(actOf(t)) + '</td>'
      + '<td class="num">' + hoursDeltaHTML(t) + '</td></tr>';
  }
  var demand = t.demandId ? demandLabel(t.demandId) : "未关联需求";
  return '<tr class="vd-h-task" tabindex="0" data-vd-htask="' + esc(t.id) + '" title="打开工作项详情">' + title + type + owner
    + '<td class="vd-h-hide"><span class="vd-h-demand" title="' + esc(demand) + '">' + esc(demand) + '</span></td>'
    + '<td class="num">' + (estOf(t) ? hours(estOf(t)) : '<span class="muted">未估</span>') + '</td>'
    + '<td class="num">' + (actOf(t) ? hours(actOf(t)) : '<span class="muted">—</span>') + '</td></tr>';
}
function hoursItemsHTML(mode){
  var f = hourSheet.filter;
  var rows = st.tasks.filter(function(t){
    if(f) return f.kind === "unestimated" ? estOf(t) <= 0 : hourKey(f.kind, t) === f.value;
    return true;
  });
  if(mode === "actual") rows = rows.filter(function(t){ return actOf(t) > 0; });
  rows.sort(function(a, b){
    if(mode === "actual") return actOf(b) - actOf(a);
    var ae = estOf(a) > 0, be = estOf(b) > 0;
    if(ae !== be) return ae ? -1 : 1;
    return estOf(b) - estOf(a);
  });
  var unest = st.tasks.filter(function(t){ return estOf(t) <= 0; });
  var over = st.tasks.filter(function(t){ return estOf(t) > 0 && actOf(t) > estOf(t); })
    .sort(function(a, b){ return (actOf(b) - estOf(b)) - (actOf(a) - estOf(a)); });
  var callout = "";
  if(!f){
    if(mode === "estimate" && unest.length){
      callout = '<div class="vd-h-callout">' + icon("alert", 13)
        + '<span><b>' + unest.length + ' 项还没有预估，' + hourText(estTotal()) + ' 可能偏低。</b>'
        + esc(unest.slice(0, 4).map(function(t){ return t.title; }).join("、")) + (unest.length > 4 ? " 等" : "")
        + ' <button class="link-btn" type="button" data-vd-hunest>去补预估</button></span></div>';
    }else if(mode === "actual" && over.length){
      var top = over[0];
      callout = '<div class="vd-h-callout">' + icon("alert", 13)
        + '<span><b>' + over.length + ' 项超出预估，最大的是 ' + esc(top.title) + ' '
        + hours(estOf(top)) + ' → ' + hours(actOf(top)) + '（+' + fmtMinutesShort(actOf(top) - estOf(top)) + '）。</b>'
        + '确认是估算偏低还是范围变化。</span></div>';
    }
  }
  var chip = f ? '<div class="vd-h-filter-bar"><span>筛选</span>'
    + '<button class="vd-h-chip" type="button" data-vd-hclear>' + esc(f.label) + icon("close", 11) + '</button>'
    + '<button class="vd-h-clear" type="button" data-vd-hclear>清除</button></div>' : "";
  var head = mode === "actual"
    ? '<th>工作项</th><th class="vd-h-hide">类型</th><th class="vd-h-hide">负责人</th><th class="num vd-h-hide">预估</th><th class="num">实际</th><th class="num">偏差</th>'
    : '<th>工作项</th><th class="vd-h-hide">类型</th><th class="vd-h-hide">负责人</th><th class="vd-h-hide">需求</th><th class="num">预估</th><th class="num">实际</th>';
  var body = rows.map(function(t){ return hoursItemRowHTML(t, mode); }).join("")
    || '<tr><td colspan="6" class="vd-h-empty">没有符合条件的工作项</td></tr>';
  var sumEst = rows.reduce(function(a, t){ return a + estOf(t); }, 0);
  var sumAct = rows.reduce(function(a, t){ return a + actOf(t); }, 0);
  var totalRow = mode === "actual"
    ? '<tr class="vd-h-total"><td>当前列表 · ' + rows.length + ' 项</td><td class="vd-h-hide"></td><td class="vd-h-hide"></td>'
      + '<td class="num vd-h-hide">' + hourText(sumEst) + '</td><td class="num">' + hourText(sumAct) + '</td><td class="num"></td></tr>'
    : '<tr class="vd-h-total"><td>当前列表 · ' + rows.length + ' 项</td><td class="vd-h-hide"></td><td class="vd-h-hide"></td><td class="vd-h-hide"></td>'
      + '<td class="num">' + hourText(sumEst) + '</td><td class="num">' + hourText(sumAct) + '</td></tr>';
  return callout + chip
    + '<div class="vd-h-tablewrap"><table class="vd-h-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>'
    + '<p class="foot-note">' + (mode === "estimate"
      ? "预估来自工作项；未估工作项排在最后。点类型 / 模块 / 负责人 / 需求分组可快速筛选。"
      : "实际来自工作项累计计时；偏差 = 实际 − 预估，红色为超出。未计时的工作项不在此列表。") + '</p>';
}
function hoursWindowHTML(){
  var list = st.tasks.filter(function(t){ return actOf(t) > 0; }).sort(function(a, b){ return actOf(b) - actOf(a); });
  var out = list.reduce(function(a, t){ return a + devOf(t); }, 0);
  var inn = list.reduce(function(a, t){ return a + testOf(t); }, 0);
  var act = list.reduce(function(a, t){ return a + actOf(t); }, 0);
  var complete = list.filter(function(t){ return t.testStartedAt && t.testFinishedAt; }).length;
  var notice = complete
    ? '<div class="vd-h-notice info">' + icon("info", 13)
      + '<span><b>' + complete + ' 个有计时的工作项填齐了开测 / 结束时间。</b>窗口内计时为 ' + hourText(inn)
      + '，其余 ' + hourText(out) + ' 记为窗口外；窗口外含设计、开发、评审、运维，不能当作开发工时。</span></div>'
    : '<div class="vd-h-notice warn">' + icon("alert", 13)
      + '<span><b>测试窗口只能区分「窗口内 / 窗口外」。</b>本版本 ' + list.length + ' 个有计时的工作项都缺少完整的开测 / 结束时间，'
      + hourText(act) + ' 全部记为窗口外。窗口外含设计、开发、评审、运维，不能当作开发工时。'
      + '补齐这两个时间后，窗口口径即可生效，不需要新增字段。</span></div>';
  var body = list.map(function(t){
    var tIn = testOf(t), tOut = devOf(t);
    var judge = tIn > 0 && tOut > 0 ? "混合" : tIn > 0 ? "窗口内" : "窗口外";
    var tone = judge === "窗口内" ? "in" : judge === "混合" ? "mix" : "out";
    return '<tr class="vd-h-task" tabindex="0" data-vd-htask="' + esc(t.id) + '" title="打开工作项详情">'
      + '<td>' + hoursItemTitle(t) + '</td>'
      + '<td class="num strong">' + hours(actOf(t)) + '</td>'
      + '<td class="num vd-h-hide">' + hours(tOut) + '</td>'
      + '<td class="num vd-h-hide">' + (tIn ? hours(tIn) : '<span class="muted">—</span>') + '</td>'
      + '<td class="num"><span class="vd-h-tag ' + tone + '">' + judge + '</span></td></tr>';
  }).join("") || '<tr><td colspan="5" class="vd-h-empty">还没有已记录计时的工作项</td></tr>';
  return notice
    + '<div class="vd-h-stages">'
    + '<div class="vd-h-stage out"><small><i style="background:var(--info)"></i>测试窗口外</small><b>' + hourText(out) + '</b>'
    + '<span>' + list.filter(function(t){ return devOf(t) > 0; }).length + ' 项 · 含设计、开发、评审、运维</span></div>'
    + '<div class="vd-h-stage in"><small><i style="background:var(--plum)"></i>测试窗口内</small><b>' + hourText(inn) + '</b>'
    + '<span>' + list.filter(function(t){ return testOf(t) > 0; }).length + ' 项 · 开测到结束之间的计时</span></div>'
    + '</div>'
    + '<div class="vd-h-flow" aria-label="测试窗口口径"><span>工作项计时</span><span class="arr">→</span>'
    + '<span>是否落在开测 / 测试结束之间</span><span class="arr">→</span><span>窗口内 / 窗口外</span></div>'
    + '<details class="vd-h-why"><summary>为什么窗口外不等于开发？</summary>'
    + '<p>测试窗口只是由工作项的开测、测试结束时间推导出的时间区间。窗口外的计时既可能是设计、开发，也可能是评审、联调、运维。'
    + '它适合回答「有多少计时发生在测试期间」，不适合回答「开发用了多少小时」。</p></details>'
    + '<div class="vd-h-tablewrap" style="margin-top:12px"><table class="vd-h-table"><thead><tr>'
    + '<th>有计时的工作项</th><th class="num">实际</th><th class="num vd-h-hide">窗口外</th>'
    + '<th class="num vd-h-hide">窗口内</th><th class="num">窗口判定</th></tr></thead><tbody>'
    + body
    + '<tr class="vd-h-total"><td>合计 · ' + list.length + ' 项</td><td class="num">' + hourText(act) + '</td>'
    + '<td class="num vd-h-hide">' + hourText(out) + '</td><td class="num vd-h-hide">' + hourText(inn) + '</td>'
    + '<td class="num">' + (act ? "窗口外 " + hourPctText(out, act) : "—") + '</td></tr>'
    + '</tbody></table></div>'
    + '<div class="vd-h-suggest"><b>用现有数据可以怎么改善</b>'
    + '<p>补齐工作项的开测时间与测试结束时间，窗口内 / 外会自动区分；不需要新增字段。</p>'
    + '<div class="vd-h-chips"><span>开测时间</span><span>测试结束时间</span></div></div>'
    + '<p class="foot-note">测试窗口由工作项的「开测时间 / 测试结束时间」推导；两者齐全才可能计入窗口内。</p>';
}
function renderHoursSheet(){
  var hs = hourSheet;
  if(!hs || !hs.layer) return;
  var layer = hs.layer;
  var s = st.stat || {};
  var total = st.tasks.length;
  var est = num(s.estimateMinutes) || estTotal();
  var act = num(s.workMinutes) || actTotal();
  var estItems = st.tasks.filter(function(t){ return estOf(t) > 0; }).length;
  var actItems = st.tasks.filter(function(t){ return actOf(t) > 0; }).length;
  var titleEl = layer.querySelector("[data-vd-htitle]");
  var subEl = layer.querySelector("[data-vd-hsub]");
  if(hs.mode === "estimate"){
    titleEl.innerHTML = "预估 " + esc(hourText(est)) + '<span class="unit"> · ' + estItems + ' / ' + total + ' 项</span>';
    var avg = estItems ? fmtMinutesShort(Math.round(est / estItems)) : "—";
    subEl.textContent = "平均 " + avg + " / 项"
      + (total - estItems ? " · " + (total - estItems) + " 项未估" : "")
      + " · 实际 / 预估 " + (est ? hourPctText(act, est) : "—");
  }else{
    titleEl.innerHTML = "实际 " + esc(hourText(act)) + '<span class="unit"> · ' + actItems + ' / ' + total + ' 项</span>';
    subEl.textContent = actItems + " 项有计时 · 覆盖 " + hourPctText(actItems, total)
      + " · 已完成项均耗时 " + avgDoneText() + " · 测试窗口见「计时窗口」";
  }
  layer.querySelector("[data-vd-htabs]").innerHTML = (HOUR_TABS[hs.mode] || []).map(function(t){
    var on = hs.tab === t[0];
    return '<button class="vd-h-tab" type="button" role="tab" aria-selected="' + (on ? "true" : "false") + '"'
      + ' data-vd-htab="' + t[0] + '">' + esc(t[1]) + '</button>';
  }).join("");
  var bodyEl = layer.querySelector("[data-vd-hbody]");
  bodyEl.innerHTML = hs.tab === "items" ? hoursItemsHTML(hs.mode)
    : hs.tab === "window" ? hoursWindowHTML()
    : hoursGroupHTML(hs.tab, hs.mode);
  bodyEl.scrollTop = 0;
}
function closeHoursSheet(){
  if(hourSheet && hourSheet.layer) UI.closeModal(hourSheet.layer);
}
function openHoursSheet(mode, tab){
  if(mode !== "estimate" && mode !== "actual") return;
  closeHoursSheet();
  var hs = { mode:mode, tab:tab || (mode === "estimate" ? "type" : "owner"), filter:null, layer:null };
  var layer = document.createElement("div");
  layer.className = "modal-layer vd-h-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet vd-h-sheet">'
    + '<header class="vd-h-head"><div class="vd-h-top"><div class="vd-h-titlewrap">'
    + '<div class="vd-h-eyebrow">工时构成</div>'
    + '<h2 class="vd-h-title" data-vd-htitle></h2>'
    + '<div class="vd-h-sub" data-vd-hsub></div></div>'
    + '<button class="icon-btn sm" type="button" data-vd-hclose aria-label="关闭工时构成">' + icon("close", 15) + '</button></div>'
    + '<div class="vd-h-tabs" role="tablist" aria-label="工时构成维度" data-vd-htabs></div></header>'
    + '<div class="sheet-body vd-h-body" data-vd-hbody></div></div>';
  document.body.appendChild(layer);
  hs.layer = layer;
  hourSheet = hs;
  layer.__uiOnClose = function(){ if(hourSheet === hs) hourSheet = null; layer.remove(); };
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-vd-hclose]")){ UI.closeModal(layer); return; }
    var tabBtn = e.target.closest("[data-vd-htab]");
    if(tabBtn){ hs.tab = tabBtn.getAttribute("data-vd-htab"); hs.filter = null; renderHoursSheet(); return; }
    if(e.target.closest("[data-vd-hclear]")){ hs.filter = null; renderHoursSheet(); return; }
    if(e.target.closest("[data-vd-hunest]")){
      hs.filter = { kind:"unestimated", value:"", label:"未估工作项" };
      hs.tab = "items";
      renderHoursSheet();
      return;
    }
    var f = e.target.closest("[data-vd-hfilter]");
    if(f){
      hs.filter = { kind:f.getAttribute("data-vd-hfilter"), value:f.getAttribute("data-vd-hvalue") || "", label:f.getAttribute("data-vd-hlabel") || "" };
      hs.tab = "items";
      renderHoursSheet();
      return;
    }
    var task = e.target.closest("[data-vd-htask]");
    if(task){ openTaskById(task.getAttribute("data-vd-htask")); return; }
  });
  layer.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest ? e.target.closest("tr[data-vd-hfilter]") : null;
    if(row && row === e.target){ e.preventDefault(); row.click(); }
  });
  renderHoursSheet();
  UI.openModal(layer);
}


/* ==================== 关联实体：名字、联动条、行内入口 ==================== */

function branchName(id){
  var hit = ((st.stat || {}).branches || []).filter(function(b){ return b.branchId === id; })[0];
  return (hit && hit.name) || "分支";
}
function demandHit(id){ return st.allDemands.filter(function(d){ return d.id === id; })[0] || null; }
function demandLabel(id){
  var d = demandHit(id);
  if(!d) return "关联需求";
  var no = demandNoText(d.demandNo);
  return no ? no + " " + d.title : d.title;
}
/* 联动筛选的四种来源共用一份描述：条上显示什么、清除时清哪个字段，都在这里对齐 */
var LINK_META = {
  cat:{ field:"cat", icon:"tag", label:"模块", name:function(v){ return catName(v === NONE ? "" : v); } },
  branch:{ field:"branch", icon:"branch", label:"分支", name:branchName },
  demand:{ field:"demand", icon:"demand", label:"需求", name:demandLabel },
  stage:{ field:"stage", icon:"clock", label:"计时窗口", name:function(v){ return v === "test" ? "窗口内计时" : "窗口外计时"; } }
};
function linkedBarHTML(){
  var f = st.filters;
  var chips = Object.keys(LINK_META).filter(function(k){ return !!f[LINK_META[k].field]; }).map(function(k){
    var m = LINK_META[k], val = f[m.field];
    var open = k === "branch" ? ' data-vd-branch="' + esc(val) + '"'
      : k === "demand" ? ' data-vd-demand="' + esc(val) + '"' : "";
    return '<span class="vd-link-chip">' + icon(m.icon, 12)
      + '<span class="vd-link-k">' + esc(m.label) + '</span>'
      + (open
        ? '<button class="vd-link-v" type="button"' + open + ' title="打开该' + esc(m.label) + '详情">' + esc(m.name(val)) + '</button>'
        : '<span class="vd-link-v">' + esc(m.name(val)) + '</span>')
      + '<button class="vd-link-x" type="button" data-vd-unlink="' + k + '" aria-label="取消' + esc(m.label) + '联动" title="取消这条联动">' + icon("close", 11) + '</button>'
      + '</span>';
  });
  if(!chips.length) return "";
  return '<div class="vd-linked"><span class="vd-linked-lead">' + icon("link", 12) + '联动</span>'
    + chips.join("")
    + '<span class="sp"></span>'
    + '<button class="btn sm ghost" type="button" data-vd-filter-reset>清除全部筛选</button></div>';
}
/* 行内的关联入口：主点击开实体详情，漏斗按钮把本页明细联动到该实体 */
function entityChip(kind, id, label){
  if(!id) return "";
  var m = LINK_META[kind];
  var attr = kind === "branch" ? "data-vd-branch" : "data-vd-demand";
  return '<button class="vd-rel" type="button" ' + attr + '="' + esc(id) + '" title="打开' + esc(m.label) + '详情：' + esc(label) + '">'
    + icon(m.icon, 11) + '<span>' + esc(label) + '</span></button>';
}
/* 负责人已经是筛选行里的下拉，不再重复做成联动 chip；其余四种来源才上联动条 */
var LINK_LABEL = { cat:"模块", branch:"分支", demand:"需求", stage:"计时窗口", owner:"负责人" };
function linkBtn(kind, value, label){
  return '<button class="vd-funnel" type="button" data-vd-link="' + esc(kind + ":" + value) + '"'
    + ' title="把本页工作项联动到该' + esc(LINK_LABEL[kind]) + '：' + esc(label) + '" aria-label="按' + esc(label) + '联动筛选工作项">'
    + icon("filter", 12) + '</button>';
}
function branchPanel(){
  var brs = (st.stat || {}).branches || [];
  if(!brs.length) return panel("分支进度", "", '<p class="hint">该版本的工作项还没有挂分支。</p>');
  var names = { dev:"开发中", testing:"测试中", merging:"合并中", released:"已发布" };
  var tones = { dev:"tag-info", testing:"tag-plum", merging:"tag-warning", released:"tag-success" };
  var chips = brs.map(function(b){
    return '<span class="vd-branch-wrap">'
      + '<button class="vd-branch" type="button" data-vd-branch="' + esc(b.branchId) + '" title="打开分支详情">'
      + icon("branch", 12) + '<span>' + esc(b.name) + '</span>'
      + '<span class="tag ' + (tones[b.status] || "ghost") + '">' + esc(names[b.status] || b.status) + '</span>'
      + '<b>' + num(b.taskCount) + ' 项</b></button>'
      + linkBtn("branch", b.branchId, b.name) + '</span>';
  }).join("");
  return panel("分支进度", '<span class="meta-right">由工作项所挂分支推导 · 点名字看分支，点漏斗看本版本里挂它的工作项</span>',
    '<div class="vd-branches">' + chips + '</div>');
}
function deliveryPanel(){
  var s = st.stat || {};
  var inner;
  if(ended()){
    inner = '<p class="hint">版本已' + (st.version && st.version.status === "closed" ? "关闭" : "取消")
      + '，不再产生发布事实；工作项关联与历史保留。</p>';
  }else if(s.releaseEvidenceKind === "release_snapshot"){
    inner = '<div class="vd-cmp">'
      + '<div class="vd-cmp-cell"><span>发布处理</span><b>' + num(s.publishedTaskCount) + '</b><small>项次（含测试 / 重部署）</small></div>'
      + '<div class="vd-cmp-cell"><span>其他处理</span><b>' + num(s.excludedTaskCount) + '</b><small>项次</small></div>'
      + '<div class="vd-cmp-cell"><span>生产曾交付</span><b>' + num(s.uniqueProductionTaskCount) + '</b><small>项</small></div>'
      + '<div class="vd-cmp-cell"><span>当前生效</span><b class="vd-ok">' + num(s.effectiveProductionTaskCount) + '</b><small>项</small></div>'
      + '</div><p class="foot-note">项次是发布事件累计，不等于待交付数量；成功事件快照才是实际交付依据。</p>';
  }else{
    inner = '<p class="hint">' + (st.version && st.version.status === "released"
      ? "标记为已发布，但没有正式发布记录，不能从完成数量推断实际交付。"
      : "还没有正式发布记录。当前都是规划统计，完成不等于实际发布。") + '</p>';
  }
  var acts = '<div class="vd-inline-acts">'
    + '<button class="btn sm" type="button" data-vd-tab="releases">看发布记录</button>'
    + '<button class="btn sm ghost" type="button" data-vd-tool="note">' + (st.version && st.version.status === "released" ? "发布说明" : "当前规划说明") + '</button>'
    + '<button class="btn sm ghost" type="button" data-vd-delivery>交付说明</button></div>';
  return panel("实际交付事实", "", inner + acts);
}
function lifecyclePanel(){
  if(!writable() || readOnly()) return "";
  var v = st.version || {};
  var acts = [];
  if(v.status === "planned") acts.push('<button class="btn sm" type="button" data-vd-tool="start">开始开发</button>');
  acts.push('<button class="btn sm ghost" type="button" data-vd-tool="close">关闭版本</button>');
  acts.push('<button class="btn sm ghost danger" type="button" data-vd-tool="cancel">取消版本</button>');
  if(rt.currentWs && rt.currentWs.myRole === "owner"){
    acts.push('<button class="btn sm ghost danger" type="button" data-vd-tool="delete">删除版本</button>');
  }
  return panel("版本生命周期", '<span class="meta-right">当前 ' + esc(statusName(v.status)) + '</span>',
    '<p class="hint">开始开发会冻结承诺基线；关闭 / 取消后不再接受编辑与新发布，历史保留。</p>'
    + '<div class="vd-inline-acts">' + acts.join("") + '</div>');
}

/* ==================== 工作项 ==================== */

function owners(){
  var seen = {}, list = [];
  st.tasks.forEach(function(t){
    var o = (t.owner || "").trim();
    if(o && !seen[o]){ seen[o] = 1; list.push(o); }
  });
  return list.sort(function(a, b){ return a.localeCompare(b, "zh-CN"); });
}
function filteredTasks(){
  var f = st.filters, q = f.q.trim().toLowerCase();
  var rows = st.tasks.filter(function(t){
    if(f.status === "done" && !isDone(t)) return false;
    if(f.status === "open" && isDone(t)) return false;
    if(f.status === "moving" && (isDone(t) || actOf(t) <= 0)) return false;
    if(f.status === "idle" && (isDone(t) || actOf(t) > 0)) return false;
    if(f.status === "over" && !isOver(t)) return false;
    if(f.status === "pre" && !t._pre) return false;
    if(f.owner && (f.owner === NONE ? (t.owner || "").trim() !== "" : (t.owner || "").trim() !== f.owner)) return false;
    if(f.type && t.itemType !== f.type) return false;
    if(f.pub && (f.pub === "published" ? !isPublishedTask(t) : isPublishedTask(t))) return false;
    if(f.cat && (f.cat === NONE ? !!t.categoryId : t.categoryId !== f.cat)) return false;
    if(f.branch && t.branchId !== f.branch) return false;
    if(f.demand && t.demandId !== f.demand) return false;
    if(f.stage === "dev" && devOf(t) <= 0) return false;
    if(f.stage === "test" && testOf(t) <= 0) return false;
    if(q && String(t.title || "").toLowerCase().indexOf(q) === -1
      && String(t.owner || "").toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  var sort = f.sort;
  if(sort === "actual") rows.sort(function(a, b){ return actOf(b) - actOf(a); });
  else if(sort === "estimate") rows.sort(function(a, b){ return estOf(b) - estOf(a); });
  else if(sort === "title") rows.sort(function(a, b){ return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"); });
  else if(sort === "due") rows.sort(function(a, b){ return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")); });
  else rows.sort(function(a, b){
    /* 风险优先：逾期 → 未完成 → 已完成；同档按实际工时降序 */
    var ra = isOver(a) ? 0 : (isDone(a) ? 2 : 1), rb = isOver(b) ? 0 : (isDone(b) ? 2 : 1);
    return ra - rb || actOf(b) - actOf(a);
  });
  return rows;
}
function selectHTML(attr, pairs, chosen, label){
  return '<select class="mini-select" data-vd-filter="' + attr + '" aria-label="' + esc(label) + '">'
    + pairs.map(function(p){
      return '<option value="' + esc(p[0]) + '"' + (p[0] === chosen ? " selected" : "") + '>' + esc(p[1]) + '</option>';
    }).join("") + '</select>';
}
function scopeFiltersHTML(){
  var f = st.filters;
  var ownerPairs = [["","全部负责人"],["__none__","未指派"]].concat(owners().map(function(o){ return [o, o]; }));
  var catPairs = [["","全部模块"],["__none__","未指定模块"]].concat(st.cats.map(function(c){ return [c.id, c.name]; }));
  return '<div class="vd-filters">'
    + '<label class="vd-search">' + icon("search", 13)
    + '<input type="search" data-vd-filter="q" value="' + esc(f.q) + '" placeholder="搜索标题或负责人" aria-label="搜索版本工作项"></label>'
    + selectHTML("status", STATUS_FILTERS, f.status, "按状态筛选")
    + selectHTML("cat", catPairs, f.cat, "按模块筛选")
    + selectHTML("owner", ownerPairs, f.owner, "按负责人筛选")
    + selectHTML("type", TYPE_FILTERS, f.type, "按类型筛选")
    + selectHTML("pub", PUB_FILTERS, f.pub, "按发布状态筛选")
    + selectHTML("sort", SORTS, f.sort, "排序方式")
    + '<span class="sp"></span>'
    + '<button class="btn sm ghost" type="button" data-vd-filter-reset>清空筛选</button>'
    + '<button class="btn sm" type="button" data-vd-board title="在看板中按此版本筛选">在看板中查看</button>'
    + '</div>' + linkedBarHTML();
}
function scopeHTML(){
  var rows = filteredTasks();
  var est = rows.reduce(function(a, t){ return a + estOf(t); }, 0);
  var act = rows.reduce(function(a, t){ return a + actOf(t); }, 0);
  var body = rows.map(function(t){
    var over = isOver(t);
    return '<tr data-open-task="' + esc(t.id) + '" tabindex="0" title="打开工作项详情">'
      + '<td class="vd-tt vd-tt-stack"><span class="vd-tt-line"><span class="vd-tname">' + esc(t.title) + '</span>'
      + (t._pre ? '<span class="tag ghost vd-pre" title="首版上线前未绑版本，统计上折算进本版本">上线前归入</span>' : "")
      + taskPublicationHTML(t)
      + '</span>'
      + (t.demandId || t.branchId
        ? '<span class="vd-rels">' + entityChip("demand", t.demandId, demandLabel(t.demandId))
          + entityChip("branch", t.branchId, branchName(t.branchId)) + '</span>'
        : "")
      + '</td>'
      + '<td>' + typeBadgeHTML(t.itemType) + '</td>'
      + '<td>' + esc(t.owner || "—") + '</td>'
      + '<td>' + (isDone(t) ? '<span class="tag tag-success">已完成</span>'
        : '<span class="tag ' + (over ? "tag-danger" : "tag-info") + '">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
      + '<td class="num">' + esc(dateText(t.dueDate) || "—") + (over ? ' <span class="vd-over">逾期</span>' : "") + '</td>'
      + '<td class="num">' + hours(estOf(t)) + '</td>'
      + '<td class="num">' + hours(actOf(t)) + '</td>'
      + '<td class="num">' + hours(devOf(t)) + '</td>'
      + '<td class="num">' + hours(testOf(t)) + '</td></tr>';
  }).join("") || emptyRow(9, st.tasks.length ? "没有匹配的工作项，试试清空筛选。" : "该版本还没有工作项。");
  var meta = '<span class="meta-right">' + rows.length + " / " + st.tasks.length + " 项 · 预估 " + hours(est) + " · 实际 " + hours(act) + '</span>';
  return scopeFiltersHTML() + panel("版本工作项", meta,
    tableWrap('<th>工作项</th><th>类型</th><th>负责人</th><th>状态</th><th class="num">截止</th>'
      + '<th class="num">预估</th><th class="num">实际</th><th class="num">窗口外</th><th class="num">窗口内</th>', body)
    + '<p class="foot-note">点击行打开工作项详情抽屉；窗口内 / 外按测试窗口（提测 → 测试结束）拆分计时，窗口外含评审、设计、开发、运维等。</p>');
}

/* ==================== 需求 ==================== */

function demandStatusName(s){
  return s === "plan" ? "已排期" : s === "pass" ? "已通过" : s === "rej" ? "已拒绝"
    : (s === "canceled" || s === "cancelled") ? "已取消" : "待评审";
}
function demandsHTML(){
  var slot = extra.demands;
  if(slot.error) return panel("已排需求", "", '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>');
  if(!slot.rows) return panel("已排需求", "", UI.skeletonRows(3));
  if(!slot.rows.length){
    return panel("已排需求", "", UI.emptyState({
      icon:"demand", title:"没有排到该版本的需求",
      text:"在需求池里把需求的目标版本指向这里，就能在此汇总；已拒绝的需求不计入。", compact:true
    }));
  }
  var body = slot.rows.map(function(d){
    var linked = st.tasks.filter(function(t){ return t.demandId === d.id; }).length;
    return '<tr data-vd-demand="' + esc(d.id) + '" tabindex="0" title="打开需求详情">'
      + '<td class="vd-tt"><span class="vd-no">' + esc(demandNoText(d.demandNo) || "—") + '</span>'
      + '<span class="vd-tname">' + esc(d.title) + '</span></td>'
      + '<td>' + esc(d.itemKind || "其他") + '</td>'
      + '<td><span class="tag ' + (d.status === "plan" ? "tag-info" : "ghost") + '">' + esc(demandStatusName(d.status)) + '</span></td>'
      + '<td>' + esc(d.priority || "—") + '</td>'
      + '<td class="num">' + esc(dateText(d.expectDate) || "—") + '</td>'
      + '<td class="num vd-rel-cell">' + (linked
        ? '<span>' + linked + ' 项</span>' + linkBtn("demand", d.id, d.title)
        : '<span class="vd-muted" title="本版本的工作项还没有挂到这条需求">未挂工作项</span>') + '</td></tr>';
  }).join("");
  return panel("已排需求", '<span class="meta-right">' + slot.rows.length + ' 项 · 目标版本指向本版本，不含已拒绝</span>',
    tableWrap('<th>需求</th><th>类型</th><th>状态</th><th>优先级</th><th class="num">期望日期</th><th class="num">本版本工作项</th>', body)
    + '<p class="foot-note">点击行打开需求详情，点漏斗把「工作项」页联动到该需求；需求按「目标版本」规划，工作项按「计划版本」归组，两者口径不同。</p>');
}

/* ==================== 发布 ==================== */

function planStatusName(s){
  return { draft:"草稿", ready:"就绪", completed:"已完成", canceled:"已取消" }[s] || s || "未创建";
}
function coverageName(c){ return { full:"全量", partial:"部分", unknown:"覆盖未知" }[c] || c || "—"; }
function releasesHTML(){
  return plansPanel() + recordsPanel();
}
function plansPanel(){
  var slot = extra.plans;
  var acts = '<div class="vd-inline-acts">'
    + '<button class="btn sm" type="button" data-vd-tool="plan">打开发布工作区</button>'
    + (st.version && st.version.canPublish === true ? '<button class="btn sm primary" type="button" data-vd-tool="actual">记录实际发布</button>' : "")
    + '</div>';
  if(slot.error) return panel("发布计划", "", '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>' + acts);
  if(!slot.rows) return panel("发布计划", "", UI.skeletonRows(2) + acts);
  if(!slot.rows.length){
    return panel("发布计划", "", '<p class="hint">还没有发布计划。计划只描述打算怎么发，不改变实际交付事实。</p>' + acts);
  }
  var body = slot.rows.map(function(p){
    var tone = p.status === "completed" ? "tag-success" : p.status === "ready" ? "tag-info" : p.status === "canceled" ? "ghost" : "tag-warning";
    return '<tr data-vd-tool="plan" tabindex="0" title="在发布工作区里查看与编辑该计划">'
      + '<td>' + esc(releasePlanNoText(p.planNo) || ("#" + p.id)) + '</td>'
      + '<td><span class="tag ' + tone + '">' + esc(planStatusName(p.status)) + '</span></td>'
      + '<td>' + esc(releaseEnvironmentName(p.environment || "production")) + '</td>'
      + '<td>' + esc(coverageName(p.coverage)) + '</td>'
      + '<td class="num">' + esc(p.plannedAt ? fmtReleaseTime(p.plannedAt).slice(0, 16) : "时间未定") + '</td>'
      + '<td class="num">' + (num(p.versionCount) > 1 ? num(p.versionCount) + " 个版本（已完成 " + num(p.releasedVersionCount) + "）" : "单版本") + '</td>'
      + '<td class="num">' + (p.plannedTaskIds || []).length + '</td></tr>';
  }).join("");
  return panel("发布计划", '<span class="meta-right">' + slot.rows.length + ' 条 · 点击行进入发布工作区</span>',
    tableWrap('<th>计划编号</th><th>状态</th><th>环境</th><th>覆盖</th><th class="num">计划时间</th><th class="num">范围</th><th class="num">计划项</th>', body) + acts);
}
function recordMatches(r){
  var f = st.relFilters;
  if(f.result === "published"){
    if(!(r.result === "success" && r.environment === "production" && r.operation !== "rollback")) return false;
  }else if(f.result && r.result !== f.result) return false;
  if(f.environment && r.environment !== f.environment) return false;
  if(f.operation && r.operation !== f.operation) return false;
  return true;
}
function recordsPanel(){
  var slot = extra.records;
  if(slot.error) return panel("实际发布记录", "", '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>');
  if(!slot.rows) return panel("实际发布记录", "", UI.skeletonRows(2));
  if(!slot.rows.length){
    return panel("实际发布记录", "", UI.emptyState({
      icon:"note", title:"还没有正式发布记录",
      text:"发布记录使用不可变工作项快照。在发布工作区里记录一次真实部署，这里就会出现事实与快照。", compact:true
    }));
  }
  var envs = {}, rowsAll = slot.rows;
  rowsAll.forEach(function(r){ if(r.environment) envs[r.environment] = 1; });
  var envPairs = [["","全部环境"]].concat(Object.keys(envs).map(function(e){ return [e, releaseEnvironmentName(e)]; }));
  var tools = '<div class="vd-filters vd-rel-filters">'
    + selectHTML("rel-result", [["","全部结果"],["published","已发布（生产成功）"],["success","全部成功"],["failed","失败"]], st.relFilters.result, "按结果筛选")
    + selectHTML("rel-environment", envPairs, st.relFilters.environment, "按环境筛选")
    + selectHTML("rel-operation", [["","全部操作"],["deploy","部署"],["redeploy","重部署"],["rollback","回滚"]], st.relFilters.operation, "按操作筛选")
    + '</div>';
  var rows = rowsAll.filter(recordMatches);
  var list = rows.length
    ? rows.map(function(r){ return releaseSnapshotHTML(r); }).join("")
    : '<p class="hint">没有匹配的发布记录，试试清空筛选。</p>';
  return panel("实际发布记录", '<span class="meta-right">' + rows.length + " / " + rowsAll.length + ' 条 · 生产成功且非回滚才算已发布</span>',
    tools + '<div class="vd-records">' + list + '</div>');
}

/* ==================== 操作记录 ==================== */

function logHTML(){
  var slot = extra.log;
  if(slot.error) return panel("版本操作记录", "", '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>');
  if(!slot.rows) return panel("版本操作记录", "", UI.skeletonRows(3));
  if(!slot.rows.length){
    return panel("版本操作记录", "", '<p class="hint">暂无操作记录；创建、编辑、开始、关闭 / 取消与范围调整都会留痕在这里。</p>');
  }
  var items = slot.rows.map(function(l){
    return '<li class="vd-log-item"><span class="vd-log-time">' + esc(fmtReleaseTime(l.createdAt)) + '</span>'
      + '<span class="vd-log-body"><b>' + esc(LOG_NAME[l.action] || l.action) + '</b>'
      + '<span class="vd-log-actor">' + esc(l.actorName || "系统") + '</span>'
      + (l.reason ? '<span class="vd-log-reason">理由：' + esc(l.reason) + '</span>' : "")
      + '</span></li>';
  }).join("");
  return panel("版本操作记录", '<span class="meta-right">' + slot.rows.length + ' 条 · 与正式发布记录分开</span>',
    '<ul class="vd-log">' + items + '</ul>'
    + '<p class="foot-note">这里只记版本自身的变更留痕；真实部署事实在「发布」页。</p>');
}

/* ==================== 无 id 时的版本选择器 ==================== */

function renderPicker(){
  if(!host) return;
  host.innerHTML = '<header class="vd-head"><div class="vd-head-top">' + backBtn()
    + '<h1 class="vd-title">版本详情</h1></div>'
    + '<div class="vd-sub"><span>选一个版本，打开它的详情页看范围、投入与发布事实。</span></div></header>'
    + '<div class="vd-body"><div id="vdPicker">' + UI.skeletonRows(4) + '</div></div>';
  if(pickerRows){ paintPicker(); return; }
  API.get("/api/versions/cross-project").then(function(rows){
    pickerRows = rows || [];
    if(activeView === "version" && !st.id) paintPicker();
  }).catch(function(ex){
    var box = document.getElementById("vdPicker");
    if(box){
      box.innerHTML = UI.emptyState({ icon:"alert", title:"版本清单加载失败", text:ex.message || "网络异常，请稍后重试", actionLabel:"重试" });
      bindRetry(box, function(){ pickerRows = null; renderPicker(); });
    }
  });
}
function paintPicker(){
  var box = document.getElementById("vdPicker");
  if(!box) return;
  var q = pickerQuery.trim().toLowerCase();
  var rows = (pickerRows || []).filter(function(r){
    return !q || (String(r.projectName) + " " + String(r.versionName)).toLowerCase().indexOf(q) !== -1;
  });
  if(!rows.length){
    box.innerHTML = UI.emptyState({
      icon:"folder", title:pickerQuery ? "没有匹配的版本" : "还没有版本",
      text:pickerQuery ? "换个关键词，或清空搜索。" : "先在「版本」里为项目新建版本。"
    });
    return;
  }
  var groups = {}, order = [];
  rows.forEach(function(r){
    if(!groups[r.reqId]){ groups[r.reqId] = { name:r.projectName, list:[] }; order.push(r.reqId); }
    groups[r.reqId].list.push(r);
  });
  var body = order.map(function(reqId){
    var g = groups[reqId];
    return '<section class="panel vd-panel"><div class="panel-head"><h3>' + esc(g.name) + '</h3>'
      + '<span class="meta-right">' + g.list.length + ' 个版本</span></div><div class="vd-pick-list">'
      + g.list.map(function(r){
        return '<button class="vd-pick" type="button" data-vd-pick="' + esc(r.versionId) + '" data-vd-pick-req="' + esc(r.reqId) + '">'
          + '<span class="vd-pick-name">' + esc(r.versionName) + '</span>' + statusTag(r.versionStatus)
          + '<span class="vd-pick-meta">' + (r.targetDate ? "目标 " + esc(dateText(r.targetDate)) : "未设目标日")
          + ' · 工作项 ' + (r.taskCount == null ? "—" : r.taskCount) + ' 项'
          + (r.latestReleaseDate ? " · 最近发布 " + esc(dateText(r.latestReleaseDate)) : "") + '</span>'
          + icon("chevronRight", 14) + '</button>';
      }).join("") + '</div></section>';
  }).join("");
  box.innerHTML = '<div class="vd-filters"><label class="vd-search">' + icon("search", 13)
    + '<input type="search" id="vdPickerQuery" value="' + esc(pickerQuery) + '" placeholder="搜索项目或版本" aria-label="搜索版本"></label></div>' + body;
}

/* ==================== 交互 ==================== */

function backToVersions(){
  showView("phase");
}
/* 写操作借版本页弹窗：同一份权限校验、CAS 与留痕，避免两处实现漂移 */
function runTool(tool){
  var reqId = st.reqId, id = st.id;
  if(!reqId || !id) return;
  loadView("phase").then(function(m){
    if(activeView !== "version" || st.id !== id) return;
    m.openVersionTool(reqId, id, tool);
  }).catch(function(ex){ toast(ex.message || "打开版本工具失败", "bad"); });
}
function openDelivery(){
  var id = st.id;
  loadView("delivery").then(function(m){ m.openDeliveryNote(id, ""); })
    .catch(function(ex){ toast(ex.message || "打开交付说明失败", "bad"); });
}
function openDemand(id){
  loadView("demands").then(function(m){ m.openDemandDetailById(id); })
    .catch(function(ex){ toast(ex.message || "打开需求详情失败", "bad"); });
}
function jumpBoard(){
  /* 与版本卡下钻同一口径：清掉旧筛选，按当前项目 + 该版本过滤，已完成列放到全部历史。
     看板有的筛选（关键词 / 模块 / 负责人 / 类型）一并带过去，没有的（分支 / 需求 / 计时窗口 / 状态）如实说明 */
  var f = st.filters, carried = [], left = [];
  state.q = f.q || ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = [];
  if(f.q){ carried.push("关键词"); }
  if(f.owner && f.owner !== NONE){ state.owners = [f.owner]; carried.push("负责人"); }
  if(f.cat && f.cat !== NONE){ state.cats = [f.cat]; carried.push("模块"); }
  if(f.type){ state.types = [f.type]; carried.push("类型"); }
  if(f.branch) left.push("分支");
  if(f.demand) left.push("需求");
  if(f.stage) left.push("计时窗口");
  if(f.status) left.push("状态");
  if(f.owner === NONE) left.push("未指派");
  if(f.cat === NONE) left.push("未指定模块");
  state.versions = [st.id]; state.columns = []; state.completion = ""; state.due = null;
  state.focus = false; state.blocked = false; state.doneScope = "all";
  state.reqs = [st.reqId];
  if(searchInput) searchInput.value = state.q;
  if(searchWrap) searchWrap.classList.toggle("has", !!state.q);
  showView("board");
  reloadFilteredViews();
  toast("已按版本筛选看板：" + versionName()
    + (carried.length ? "，并带上" + carried.join(" / ") : "")
    + (left.length ? "；看板没有" + left.join(" / ") + "筛选，未带过去" : ""));
}
function setTab(key){
  if(TAB_KEYS.indexOf(key) === -1 || key === st.tab) return;
  st.tab = key;
  syncRoute(true);
  renderAll();
  if(host) host.scrollTop = 0;
  var view = document.getElementById("view-version");
  if(view) view.scrollTop = 0;
}
function drill(kind){
  var f = blankFilters();
  var ci = kind.indexOf(":");
  if(ci > 0){
    /* 关联实体下钻：cat / branch / demand / stage / owner 五种来源共用一条路径 */
    var k = kind.substring(0, ci), v = kind.substring(ci + 1);
    if(LINK_LABEL[k] === undefined) return;
    f[k] = v;
    f.sort = "actual";
  }
  else if(kind === "done") f.status = "done";
  else if(kind === "moving") f.status = "moving";
  else if(kind === "idle") f.status = "idle";
  else if(kind === "open") f.status = "open";
  else if(kind === "over") f.status = "over";
  else if(kind === "logged") f.sort = "actual";
  else if(kind === "deviation"){ f.status = "done"; f.sort = "estimate"; }
  else if(kind === "ontime"){ f.status = "done"; f.sort = "due"; }
  else if(kind === "avg"){ f.status = "done"; f.sort = "actual"; }
  st.filters = f;
  st.tab = "scope";
  syncRoute(true);
  renderAll();
  var view = document.getElementById("view-version");
  if(view) view.scrollTop = 0;
}
function applyFilters(){
  syncRoute(false);
  renderAll();
}
function exportRecord(record){
  loadView("phase").then(function(m){
    if(m.exportReleaseRecordCSV) m.exportReleaseRecordCSV(record);
  }).catch(function(){ toast("导出模块加载失败", "bad"); });
}

function wire(){
  if(wired || !host) return;
  wired = true;
  host.addEventListener("click", function(e){
    if(e.target.closest("[data-vd-back]")){ backToVersions(); return; }
    if(e.target.closest("[data-vd-refresh]")){ reload(); return; }
    if(e.target.closest("[data-vd-desc-toggle]")){
      var desc = host.querySelector("[data-vd-desc]");
      if(desc){
        desc.classList.toggle("open");
        syncDescToggle();
      }
      return;
    }
    var pick = e.target.closest("[data-vd-pick]");
    if(pick){ openVersionDetail(pick.getAttribute("data-vd-pick-req"), pick.getAttribute("data-vd-pick")); return; }
    var tab = e.target.closest("[data-vd-tab]");
    if(tab){ setTab(tab.dataset.vdTab); return; }
    var hoursBtn = e.target.closest("[data-vd-hours]");
    if(hoursBtn){ openHoursSheet(hoursBtn.getAttribute("data-vd-hours")); return; }
    var drillEl = e.target.closest("[data-vd-drill]");
    if(drillEl){ drill(drillEl.dataset.vdDrill); return; }
    /* 联动入口要先于行级判断：漏斗按钮就长在需求行 / 工作项行里面 */
    var link = e.target.closest("[data-vd-link]");
    if(link){ drill(link.getAttribute("data-vd-link")); return; }
    var unlink = e.target.closest("[data-vd-unlink]");
    if(unlink){
      var meta = LINK_META[unlink.getAttribute("data-vd-unlink")];
      if(meta){ st.filters[meta.field] = ""; applyFilters(); }
      return;
    }
    var tool = e.target.closest("[data-vd-tool]");
    if(tool){ runTool(tool.dataset.vdTool); return; }
    if(e.target.closest("[data-vd-delivery]")){ openDelivery(); return; }
    if(e.target.closest("[data-vd-board]")){ jumpBoard(); return; }
    if(e.target.closest("[data-vd-filter-reset]")){
      st.filters = blankFilters();
      syncRoute(false);
      renderAll();
      return;
    }
    if(e.target.closest("[data-vd-project]")){
      rt.managerProjectId = st.reqId;
      showView("project");
      return;
    }
    var br = e.target.closest("[data-vd-branch]");
    if(br){ openBranchById(br.getAttribute("data-vd-branch")); return; }
    var ms = e.target.closest("[data-vd-milestone]");
    if(ms){
      var hit = st.milestones.filter(function(m){ return m.id === ms.getAttribute("data-vd-milestone"); })[0];
      if(hit) openMilestoneDetail(hit, { canWrite: writable(), onChanged: reload });
      return;
    }
    var dm = e.target.closest("[data-vd-demand]");
    if(dm){ openDemand(dm.getAttribute("data-vd-demand")); return; }
    var exp = e.target.closest("[data-release-export]");
    if(exp){
      var rid = exp.getAttribute("data-release-export");
      var rec = (extra.records.rows || []).filter(function(r){ return r.id === rid; })[0];
      if(rec) exportRecord(rec);
      return;
    }
    var dlv = e.target.closest("[data-release-delivery]");
    if(dlv){
      var vid = dlv.getAttribute("data-release-delivery-version") || st.id;
      loadView("delivery").then(function(m){ m.openDeliveryNote(vid, dlv.getAttribute("data-release-delivery")); })
        .catch(function(){ toast("打开交付说明失败", "bad"); });
      return;
    }
    var task = e.target.closest("[data-open-task]");
    if(task){ openTaskById(task.dataset.openTask); return; }
    /* 发布快照里的 data-snap-task / data-snap-demand 由 core/task-actions.js 全局委托，
       这里不能再接一遍：需求详情每次调用都新建弹层，接两遍会叠出两层关不掉 */
  });
  host.addEventListener("change", function(e){
    var sw = e.target.closest("[data-vd-switch]");
    if(sw){ openVersionDetail(st.reqId, sw.value); return; }
    var f = e.target.closest("[data-vd-filter]");
    if(f){
      var key = f.getAttribute("data-vd-filter");
      if(key.indexOf("rel-") === 0){
        st.relFilters[key.substring(4)] = f.value;
        renderAll();
        return;
      }
      st.filters[key] = f.value;
      applyFilters();
    }
  });
  host.addEventListener("input", function(e){
    if(e.target.id === "vdPickerQuery"){
      pickerQuery = e.target.value;
      var mark = focusedKey();
      paintPicker();
      restoreFocus(mark);
      return;
    }
    var q = e.target.closest('[data-vd-filter="q"]');
    if(q){ st.filters.q = q.value; applyFilters(); }
  });
  host.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest ? e.target.closest("tr[data-open-task], tr[data-vd-demand], tr[data-vd-milestone], tr[data-vd-tool]") : null;
    if(row && row === e.target){ e.preventDefault(); row.click(); }
  });
}

/* 版本 / 发布记录在别处改过（弹窗、驾驶舱、SSE）：详情页跟着刷新，不显示过期数字 */
window.addEventListener("ds:delivery-changed", function(e){
  if(activeView !== "version" || !st.id) return;
  var reqId = e && e.detail && e.detail.reqId;
  if(reqId && reqId !== st.reqId) return;
  reload();
});
window.addEventListener("ds:milestones-changed", function(e){
  if(activeView !== "version" || !st.id) return;
  var reqId = e && e.detail && e.detail.reqId;
  if(reqId && reqId !== st.reqId) return;
  reload();
});
/* 项目列表迟到时补一次项目名，避免顶栏停在「项目」占位 */
window.addEventListener("ds:reqs-loaded", function(){
  if(activeView !== "version" || !st.id || !st.version) return;
  renderAll();
});

export { enterVersionView, openVersionDetail, refreshFromHash };