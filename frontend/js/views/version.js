/* views/version · 版本详情子页（#/version?id=&reqId=&tab=）
   从版本卡的版本名 / 「版本详情」按钮，或跨项目「全部版本」表的版本名跳转进来，
   一屏看单个版本的范围、投入与发布事实；hash 带全部位置信息，可分享、可后退。
   范围口径与版本卡完全一致：绑定的工作项 + 首版上线前未绑版本的折算，折算项在行内标注。
   写操作不在此重写：统一借版本页的弹窗（同一份校验、留痕与 CAS），见 phase.js 的 openVersionTool。 */

import { API } from "../core/api.js";
import { searchInput, searchWrap } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { updateBrand } from "../core/filters.js";
import { activeView, setReturnOrigin, showView } from "../core/router.js";
import { canEditReq, dueState, reqNameById, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { loadView } from "../core/view-loader.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { openMilestoneDetail } from "../lib/milestone-ui.js";
import { summarizeStages } from "../lib/stage-hours.js";
import { stagePanelHTML, stageDrillRows, openStageDrill } from "../lib/stage-panel.js";
import {
  colName, dayKey, demandNoText, fmtMinutesShort, fmtReleaseTime, itemNoText,
  releaseEnvironmentName, releasePlanNoText, releaseNoText, releaseSnapshotBodyHTML, taskPublicationHTML, taskVersionIds, typeBadgeHTML,
  VERSION_STATUS_META, PLAN_STATUS_META, versionStatusTagHTML, planStatusTone
} from "../lib/format.js";
import { gitEnabled, openBranchById } from "./branches.js";

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

/* 11-27 原型：详情默认落「概览」，回答「这个版本处在哪一步、还缺什么」；
   页签＝概览 / 工作项 / 需求 / 发布 / 交付说明。操作记录不再占页签位（动态并入概览最近动态），
   旧深链 tab=log 仍保留；工时构成等深页仍由 tab=overview 直达 */
var TABS = [
  { key:"home", label:"概览" },
  { key:"scope", label:"工作项" },
  { key:"demands", label:"需求" },
  { key:"releases", label:"发布" }
];
var TAB_KEYS = ["overview", "log"].concat(TABS.map(function(t){ return t.key; }));
var DEFAULT_TAB = "home";
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
  id:"", reqId:"", tab:DEFAULT_TAB,
  seq:0, loading:false, error:"",
  versions:[], version:null, stat:null, phase:null,
  tasks:[], milestones:[], cats:[], allDemands:[],
  filters:blankFilters(),
  relChip:"all", planChip:"all"
};
/* 侧栏数据各自独立到位：任一份失败只影响自己那块，不拖垮整页 */
function side(){ return { rows:null, loading:false, error:"" }; }
var extra = { demands:side(), plans:side(), records:side(), log:side(), check:side(), note:side() };
var pickerRows = null, pickerQuery = "";

function alive(seq){ return seq === st.seq && activeView === "version"; }
function writable(){ return !!st.reqId && canEditReq(st.reqId); }
function contentLocked(){ var v = st.version; return !!v && (v.contentLocked === true || v.status === "released"); }
function ended(){ var v = st.version; return !!v && (v.status === "closed" || v.status === "canceled"); }
function readOnly(){ return contentLocked() || ended(); }
function versionName(){ return (st.version && st.version.name) || (st.stat && st.stat.name) || "版本"; }
function statusName(s){
  /* 收敛到 lib/format 的 VERSION_STATUS_META（P2-11）：版本状态名称与色调全站单一来源 */
  return (VERSION_STATUS_META[s] || {}).name || s || "—";
}
function statusTag(s){
  return versionStatusTagHTML(s);
}
function dateText(s){ return s ? String(s).substring(0, 10) : ""; }
function pctText(v){ return (v === null || v === undefined) ? "—" : ((v > 0 ? "+" : "") + v + "%"); }
function devTone(v){
  if(v === null || v === undefined) return "";
  var a = Math.abs(v);
  /* 偏差有方向：低于预估是省了，不按风险标红；只有超预估才按幅度升级 */
  if(v < 0) return a <= 15 ? "ok" : "";
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
  if(st.tab !== DEFAULT_TAB) h += "&tab=" + encodeURIComponent(st.tab);
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
  var tab = p.get("tab") || DEFAULT_TAB;
  var sort = p.get("sort") || "default";
  return {
    id: p.get("id") || "",
    reqId: p.get("reqId") || "",
    tab: TAB_KEYS.indexOf(tab) >= 0 ? tab : DEFAULT_TAB,
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
  st.tab = TAB_KEYS.indexOf(tab) >= 0 ? tab : DEFAULT_TAB;
  st.filters = blankFilters();
  syncRoute(true);
  showView("version");
}

var gitOn = false;
function enterVersionView(){
  host = document.getElementById("versionBody");
  if(!host) return;
  wire();
  /* 未接入 Git 的空间不露出分支入口；探测结果回来后补画一次页头 */
  gitEnabled().then(function(on){
    if(on === gitOn) return;
    gitOn = on;
    if(activeView === "version") renderAll();
  });
  var route = parseRoute();
  if(!route || !route.id){
    st.seq++;
    st.id = ""; st.reqId = ""; st.version = null; st.stat = null;
    setPageHeading("选择版本", "跨项目选择要查看的版本");
    updateBrand();
    renderPicker();
    return;
  }
  adopt(route);
  load();
}
function setPageHeading(title, sub){
  ["pageTitleText", "viewTitle"].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.textContent = title;
  });
  var subEl = document.getElementById("pageSub");
  if(subEl && sub) subEl.textContent = sub;
  setTitle(title);
}
function adopt(route){
  setPageHeading("版本详情", "计划与实际、工时构成与发布记录");
  var changed = route.id !== st.id || route.reqId !== st.reqId;
  st.id = route.id;
  st.reqId = route.reqId;
  st.tab = route.tab;
  st.filters = route.filters;
  if(changed){
    closeHoursSheet();
    st.version = null; st.stat = null; st.phase = null;
    st.tasks = []; st.versions = []; st.milestones = []; st.cats = []; st.allDemands = [];
    st.relChip = "all"; st.planChip = "all";
    extra = { demands:side(), plans:side(), records:side(), log:side(), check:side(), note:side() };
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
      /* 已排需求与后端 demandCount 同口径：不含已关闭（含历史 rej/canceled），已完成照常计入 */
      return st.allDemands.filter(function(d){
        return d.versionId === st.id && d.status !== "closed" && d.status !== "rej"
          && d.status !== "canceled" && d.status !== "cancelled";
      });
    });
  });
  fetchSide("plans", current, function(){ return API.get("/api/versions/" + id + "/release-plans"); });
  fetchSide("records", current, function(){ return API.get("/api/versions/" + id + "/release-records"); });
  fetchSide("log", current, function(){ return API.get("/api/versions/" + id + "/release-history"); });
  /* 概览的两块只读聚合：发布检查口径（需求覆盖）与交付说明待确认数；失败只影响概览对应卡片 */
  fetchSide("check", current, function(){ return API.get("/api/versions/" + id + "/release-check"); });
  loadNote(current);
}
function loadNote(current){
  var id = encodeURIComponent(st.id);
  extra.note.loading = true;
  API.get("/api/versions/" + id + "/delivery-note").then(function(note){
    if(!alive(current)) return;
    extra.note.loading = false;
    extra.note.rows = note || null;
    extra.note.pending = 0;
    if(note){
      import("../lib/delivery-doc.js").then(function(m){
        if(!alive(current) || extra.note.rows !== note) return;
        try{ extra.note.pending = m.DD.pendingFields(note).length; }catch(e){ extra.note.pending = 0; }
        sideArrived("note");
      }).catch(function(){ /* 投影失败按 0 处理，不影响其他卡片 */ });
    }
    sideArrived("note");
  }).catch(function(){
    if(!alive(current)) return;
    extra.note.loading = false;
    extra.note.rows = null;
    extra.note.pending = 0;
  });
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
var SIDE_TAB = { demands:"demands", plans:"releases", records:"releases", log:"home", check:"home", note:"home" };
function sideArrived(key){
  syncTabCounts();
  /* 需求清单还负责给工作项行的关联 chip 供名字，所以它到位时工作项页也要重画；
     操作记录并入概览动态后不在页签里，但旧深链 tab=log 仍要能等到数据 */
  if(st.tab === SIDE_TAB[key] || (key === "demands" && st.tab === "scope")
    || (key === "log" && st.tab === "log")) renderAll();
}
/* 分支只在本版本上下文里看：带 project / version，进入后不再暴露全空间分支入口 */
function openVersionBranches(){
  var qs = [];
  if(st.reqId) qs.push("project=" + encodeURIComponent(st.reqId));
  if(st.id) qs.push("version=" + encodeURIComponent(st.id));
  var h = "#/branches" + (qs.length ? "?" + qs.join("&") : "");
  try{ history.pushState(null, "", h); }catch(e){ try{ window.location.hash = h; }catch(e2){ /* noop */ } }
  setReturnOrigin({ view:"version", label:"版本 " + versionName() });
  showView("branches");
}
function reload(){
  closeHoursSheet();
  if(!st.id){ renderPicker(); return; }
  extra = { demands:side(), plans:side(), records:side(), log:side(), check:side(), note:side() };
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
  UI.bindEmptyCmd(host, { "goto-demands": openDemandPool, "add-demand": openAddDemand });
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
/* 工具页「工时与构成」不在常规页签里，进入时补一个临时页签，避免没有选中态 */
function navTabs(){
  var list = TABS.concat([{ key:"__delivery", label:"交付说明" }]);
  return st.tab === "overview" ? list.concat([{ key:"overview", label:"工时与构成" }]) : list;
}
/* 状态说明条：一行讲清「现在能做什么、记录去哪里」，替代把锁定原因藏在按钮 disabled 里 */
function statusBannerHTML(){
  var v = st.version || st.stat || {};
  var text, tone = "info";
  if(v.status === "planned"){
    text = "当前为计划中：可以调整范围；实际发布时间与结果在发布工作台记录，不会改动计划快照。";
  }else if(v.status === "active"){
    text = "当前为进行中：范围仍可调整；实际发布时间与结果在发布工作台记录，不会改动计划快照。";
  }else if(v.status === "released"){
    text = "已正式发布：范围与计划快照只读；如需更正，请在发布工作台登记回滚或重部署，不覆盖本次事实。";
    tone = "success";
  }else if(v.status === "closed"){
    text = "已关闭：不再接受编辑与新发布，工作项关联与历史保留。";
    tone = "mute";
  }else if(v.status === "canceled"){
    text = "已取消：不再接受编辑与新发布，历史保留。";
    tone = "mute";
  }else if(contentLocked()){
    text = "已有成功的生产发布记录，版本内容只读；如需变更范围，请走发布工作台的记录。";
    tone = "mute";
  }else{
    return "";
  }
  return '<div class="vd-status-note is-' + tone + '">' + icon(tone === "success" ? "check" : "infoCircle", 14)
    + '<span>' + esc(text) + '</span></div>';
}
/* 4 格 KPI：范围 / 完成 / 预估与实际 / 风险，回答「这版能不能按时发」 */
function kpiStripHTML(){
  var s = st.stat || {};
  var total = st.tasks.length;
  if(!total) return "";
  var done = st.tasks.filter(isDone).length;
  var over = st.tasks.filter(isOver).length;
  var blocked = st.tasks.filter(function(t){ return !isDone(t) && t.blocked; }).length;
  var est = st.tasks.reduce(function(a, t){ return a + estOf(t); }, 0);
  var act = st.tasks.reduce(function(a, t){ return a + actOf(t); }, 0);
  var byType = { story:0, bug:0, task:0, epic:0 };
  st.tasks.forEach(function(t){ if(byType[t.itemType] !== undefined) byType[t.itemType]++; });
  var pct = total ? Math.round(done * 100 / total) : 0;
  function kpi(label, value, foot, tone, drill, tail){
    var inner = '<span class="k">' + esc(label) + '</span>'
      + '<b' + (tone ? ' class="vd-' + tone + '"' : '') + '>' + value + (tail ? '<small>' + tail + '</small>' : '') + '</b>'
      + '<span class="f">' + foot + '</span>';
    if(!drill) return '<div class="pcell vd-kpi">' + inner + '</div>';
    return '<button type="button" class="pcell vd-kpi drillable" data-vd-drill="' + esc(drill) + '" title="在范围里查看该口径明细">' + inner + '</button>';
  }
  var typeFoot = "需求 " + byType.story + " · 缺陷 " + byType.bug + " · 任务 " + byType.task;
  return '<div class="pgrid vd-kpis vd-kpis4">'
    + kpi("范围", String(total), esc(typeFoot), "", "all", "项")
    + kpi("完成", String(done) + '<span class="vd-kpi-of"> / ' + total + '</span>', pct + "% 已完成", "ok", "done")
    + kpi("预估 / 实际", esc(hours(est)), "实际 " + esc(hours(act)) + " · 偏差 " + esc(pctText(s.deviationPct)), "", "deviation")
    + kpi("风险", String(over + blocked), over + " 逾期 · " + blocked + " 阻塞", (over + blocked) ? "warn-text" : "ok", over ? "over" : null)
    + '</div>';
}
function moreMenuHTML(canEdit, canPublish){
  var items = [];
  items.push('<button class="menu-item" type="button" role="menuitem" data-vd-tool="plan">' + icon("calendar", 14) + '计划与历史</button>');
  items.push('<button class="menu-item" type="button" role="menuitem" data-vd-delivery>' + icon("note", 14) + '交付报告</button>');
  /* 分支不作为一级入口：接入 Git 后，在版本上下文里看该版本的分支 */
  if(gitOn) items.push('<button class="menu-item" type="button" role="menuitem" data-vd-branches>' + icon("branch", 14) + '本版本分支</button>');
  items.push('<button class="menu-item" type="button" role="menuitem" data-vd-tab="overview">' + icon("stats", 14) + '工时与构成</button>');
  if(canPublish) items.push('<button class="menu-item" type="button" role="menuitem" data-vd-tool="actual">' + icon("upload", 14) + '记录实际发布</button>');
  if(canEdit && st.version && st.version.status === "planned"){
    items.push('<button class="menu-item" type="button" role="menuitem" data-vd-tool="start">' + icon("play", 14) + '开始开发</button>');
  }
  if(canEdit){
    items.push('<span class="menu-sec">生命周期</span>');
    items.push('<button class="menu-item" type="button" role="menuitem" data-vd-tool="close">' + icon("check", 14) + '关闭版本</button>');
    items.push('<button class="menu-item danger" type="button" role="menuitem" data-vd-tool="cancel">' + icon("close", 14) + '取消版本</button>');
    if(rt.currentWs && rt.currentWs.myRole === "owner"){
      items.push('<button class="menu-item danger" type="button" role="menuitem" data-vd-tool="delete">' + icon("trash", 14) + '删除版本</button>');
    }
  }
  return '<span class="vd-more-wrap">'
    + '<button class="btn sm" type="button" data-vd-more aria-haspopup="true" aria-expanded="false">更多 '
    + icon("caretDown", 12) + '</button>'
    + '<div class="menu vd-more-menu" hidden role="menu" aria-label="更多版本操作">' + items.join("") + '</div>'
    + '</span>';
}
function headHTML(){
  var v = st.version || st.stat || {};
  var actions = [];
  var canEdit = writable() && !readOnly();
  var canPublish = st.version && st.version.canPublish === true;
  /* 每屏一个主操作（原型 11-27）：工作项页=添加工作项，需求页=添加需求，其余=记录实际发布 */
  var addKind = canEdit ? (st.tab === "scope" ? "items" : st.tab === "demands" ? "demand" : "") : "";
  /* 管理范围与记录实际发布不互斥：可编辑时范围入口常驻，有发布主操作时降为次级按钮 */
  if(canEdit){
    actions.push('<button class="btn sm" type="button" data-vd-tool="edit">' + icon("edit", 13) + ' 编辑</button>');
    if(canPublish || addKind === "items") actions.push('<button class="btn sm" type="button" data-vd-tool="tasks">管理范围</button>');
  }
  actions.push(moreMenuHTML(canEdit, canPublish));
  if(addKind){
    actions.push('<button class="btn sm primary" type="button" data-vd-add-' + addKind + '>'
      + (addKind === "items" ? "添加工作项" : "添加需求") + '</button>');
  }else if(canPublish){
    actions.push('<button class="btn sm primary" type="button" data-vd-tool="actual">记录实际发布</button>');
  }else if(canEdit){
    actions.push('<button class="btn sm primary" type="button" data-vd-tool="tasks">管理范围</button>');
  }
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
    + statusBannerHTML()
    + ((st.tab === "overview" || st.tab === "home") ? "" : kpiStripHTML())
    + '<nav class="vd-tabs" aria-label="版本详情分区">' + navTabs().map(function(t){
      var virtual = t.key === "__delivery";
      var on = !virtual && t.key === st.tab;
      var n = virtual ? null : tabCount(t.key);
      return '<button class="vd-tab' + (on ? " on" : "") + '" type="button" '
        + (virtual ? 'data-vd-delivery' : 'data-vd-tab="' + t.key + '"')
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
  if(st.tab === "home") return homeHTML();
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
function tableWrap(head, body, cls){
  return '<div class="vd-tbl-wrap"><table class="phase-tbl' + (cls ? ' ' + cls : '') + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function emptyRow(cols, text){
  return '<tr><td colspan="' + cols + '" class="foot-note tbl-empty">' + esc(text) + '</td></tr>';
}

/* ==================== 概览（聚合 + 下一步） ==================== */

function homePlanLabel(p){
  return (releasePlanNoText(p.planNo) || "发布计划") + " · " + releaseEnvironmentName(p.environment || "production");
}
function homeProdRecords(){
  return (extra.records.rows || []).filter(recordEligible);
}
/* 进行中＝已开工未完成；映射与工作项页一致，避免同一口径两套算法 */
function homeMoving(t){ return !isDone(t) && !!t.boardColumn && t.boardColumn !== "todo"; }
function homeBar(ratio, tone){
  var pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
  return '<div class="vd-hbar"><span class="' + (tone || "") + '" style="width:' + pct + '%"></span></div>';
}
function homeCard(label, value, foot, opts){
  opts = opts || {};
  return '<div class="pcell vd-hkpi">'
    + '<span class="k">' + esc(label)
    + (opts.help ? '<span class="vd-hkpi-help" title="' + esc(opts.help) + '" aria-label="' + esc(opts.help) + '">?</span>' : "")
    + '</span>'
    + '<b>' + value + '</b>'
    + (opts.bar == null ? "" : homeBar(opts.bar, opts.tone))
    + '<span class="f" title="' + esc(foot) + '">' + esc(foot) + '</span></div>';
}
function homeKpisHTML(){
  var total = st.tasks.length;
  var done = st.tasks.filter(isDone).length;
  var moving = st.tasks.filter(homeMoving).length;
  var blocked = st.tasks.filter(function(t){ return !isDone(t) && t.blocked; }).length;
  var est = st.tasks.reduce(function(a, t){ return a + estOf(t); }, 0);
  var act = st.tasks.reduce(function(a, t){ return a + actOf(t); }, 0);
  var dev = st.tasks.reduce(function(a, t){ return a + devOf(t); }, 0);
  var test = st.tasks.reduce(function(a, t){ return a + testOf(t); }, 0);
  var ck = extra.check.rows && typeof extra.check.rows === "object" ? extra.check.rows : null;
  var coverVal = ck && num(ck.demandsTotal)
    ? esc(ck.demandsCovered || 0) + '<span class="vd-kpi-of"> / ' + esc(ck.demandsTotal) + '</span>'
    : "—";
  var coverFoot = ck && num(ck.demandsTotal)
    ? Math.max(0, num(ck.demandsTotal) - num(ck.demandsCovered)) + " 个需求尚未关联用例"
    : (extra.check.error ? "发布检查暂不可用" : "本版本还没有需求");
  var prod = homeProdRecords();
  var staging = (extra.records.rows || []).filter(function(r){
    return r.result === "success" && r.environment === "staging" && r.operation !== "rollback";
  }).length;
  var lastProd = prod.slice().sort(function(a, b){
    return String(b.occurredAt || "").localeCompare(String(a.occurredAt || ""));
  })[0];
  var prodFoot = prod.length
    ? (staging ? "预发成功 " + staging + " 次 · " : "")
      + (lastProd ? "最近 " + fmtReleaseTime(lastProd.occurredAt).slice(5, 10) : "")
    : "还没有生产发布记录";
  return homeCard("工作项完成", esc(done) + '<span class="vd-kpi-of"> / ' + esc(total) + '</span>',
      moving + " 项进行中 · " + blocked + " 阻塞",
      { bar: total ? done / total : 0, tone: "is-ok", help:"已完成工作项 ÷ 版本范围内工作项；进行中不含未开始。" })
    + homeCard("需求用例覆盖", coverVal, coverFoot,
      { bar: ck && num(ck.demandsTotal) ? num(ck.demandsCovered) / num(ck.demandsTotal) : 0,
        help:"至少关联一条用例的需求数 ÷ 本版本需求数，口径同发布检查。" })
    + homeCard("已记录工时", esc(hours(act)) + '<span class="vd-kpi-of vd-kpi-den"> / 预估 ' + esc(hours(est)) + '</span>',
      "开发 " + hours(dev) + " · 测试 " + hours(test),
      { bar: est ? act / est : 0, help:"实际用时合计 ÷ 预估合计；开发为总工时扣除测试窗口内计时。" })
    + homeCard("生产发布", esc(prod.length) + " 次成功", prodFoot,
      { help:"只统计成功且非回滚的生产发布记录，预发试跑不计入。" });
}
/* 下一步：系统按当前状态排序，处理完自动消失；原型四类 + 覆盖率两类 */
function homeNextSteps(){
  var list = [];
  var plans = extra.plans.rows || [];
  var ck = extra.check.rows && typeof extra.check.rows === "object" ? extra.check.rows : {};
  var blockedPlan = plans.filter(function(p){ return p.checkVerdict === "block"; })[0];
  if(blockedPlan){
    list.push({ icon:"alert", tone:"warn", title:"发布计划「" + homePlanLabel(blockedPlan) + "」就绪检查未通过",
      sub: num(blockedPlan.checkBlockers) ? num(blockedPlan.checkBlockers) + " 项未通过：补齐工作项或需求用例后重新检查，通过才能执行。"
        : "覆盖版本的就绪检查有阻断项；通过后才能执行并记录发布。",
      act:{ label:"去处理", tool:"plan" } });
  }
  var prod = homeProdRecords();
  if(!prod.length && st.version && st.version.status !== "closed" && st.version.status !== "canceled"){
    var readyPlan = plans.filter(function(p){ return p.status === "ready"; })[0];
    list.push({ icon:"upload", tone:"info", title:"生产发布还没有记录",
      sub: readyPlan && readyPlan.plannedAt
        ? "计划窗口 " + fmtReleaseTime(readyPlan.plannedAt).slice(0, 16) + "。记录后实际交付才算数。"
        : "在发布工作台登记一次生产发布，结果才算真正交付。",
      act: st.version && st.version.canPublish ? { label:"记录发布", tool:"actual" } : { label:"查看发布", tab:"releases" } });
  }
  if(num(extra.note.pending) > 0){
    list.push({ icon:"note", tone:"warn", title:"交付说明有 " + num(extra.note.pending) + " 处对外表述待确认",
      sub:"确认后才会出现在导出的对外版本中；已确认的可撤回。",
      act:{ label:"去确认", delivery:true } });
  }
  var noEst = st.tasks.filter(function(t){ return !isDone(t) && !estOf(t); }).length;
  if(noEst){
    list.push({ icon:"clock", tone:"info", title:noEst + " 项工作项未估时",
      sub:"估时缺失会影响工时统计与就绪检查口径。", act:{ label:"去处理", tab:"scope" } });
  }
  var uncovered = num(ck.demandsTotal) ? Math.max(0, num(ck.demandsTotal) - num(ck.demandsCovered)) : 0;
  if(uncovered){
    list.push({ icon:"demand", tone:"info", title:uncovered + " 个需求尚未关联用例",
      sub:"需求至少关联一条用例才算覆盖；发布检查会按覆盖缺口提醒。", act:{ label:"去处理", tab:"demands" } });
  }
  return list;
}
function nextPanelHTML(){
  var items = homeNextSteps();
  var body = items.length
    ? '<ul class="vd-next">' + items.map(function(it){
        var a = it.act || {}, attrs = "", cls = " ghost";
        if(a.delivery) attrs = " data-vd-delivery";
        else if(a.tool){ attrs = ' data-vd-tool="' + esc(a.tool) + '"'; if(a.tool === "actual") cls = " primary"; }
        else if(a.tab){ attrs = ' data-vd-tab="' + esc(a.tab) + '"'; }
        return '<li class="vd-next-row is-' + esc(it.tone || "info") + '">'
          + '<span class="vd-next-ic">' + icon(it.icon, 14) + '</span>'
          + '<div class="vd-next-tx"><b>' + esc(it.title) + '</b><span>' + esc(it.sub) + '</span></div>'
          + (a.label ? '<button class="btn sm' + cls + '" type="button"' + attrs + '>' + esc(a.label) + '</button>' : "")
          + '</li>';
      }).join("") + '</ul>'
    : '<div class="vd-next-empty">' + icon("check", 15) + '<span>没有待处理事项：计划、记录与交付说明都齐了。</span></div>';
  var head = '<div class="panel-head vd-next-head"><h3>下一步</h3>'
    + '<span class="vd-next-hint">系统按当前状态排序，处理完自动消失</span>'
    + (items.length > 1 ? '<span class="meta-right"><button class="btn sm ghost" type="button" data-vd-next-toggle>全部收起</button></span>' : "")
    + '</div>';
  return '<section class="panel vd-panel vd-next-panel">' + head + body + '</section>';
}
function chainStepHTML(n, title, sub, state){
  return '<div class="vd-chain-step is-' + state + '">'
    + '<span class="vd-chain-dot">' + (state === "done" ? icon("check", 12) : n) + '</span>'
    + '<div class="vd-chain-tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div></div>';
}
function chainPanelHTML(){
  var plans = extra.plans.rows || [];
  var recs = extra.records.rows || [];
  var prod = homeProdRecords();
  var note = extra.note.rows;
  var plan = plans[0];
  var s1 = !!plans.length ? "done" : "current";
  var s2 = prod.length ? "done" : (plans.length ? "current" : "todo");
  var s3 = note && !num(extra.note.pending) ? "done" : (prod.length ? "current" : "todo");
  var d1 = plan
    ? plans.length + " 个计划「" + homePlanLabel(plan) + "」· " + planStatusName(plan.status)
      + (plan.plannedAt ? " · 窗口 " + fmtReleaseTime(plan.plannedAt).slice(0, 16) : "")
    : "还没有发布计划：先定窗口，把要一起发的版本勾进来。";
  var lastRec = recs.slice().sort(function(a, b){
    return String(b.occurredAt || "").localeCompare(String(a.occurredAt || ""));
  })[0];
  var d2 = prod.length
    ? "已记录 " + recs.length + " 次（生产成功 " + prod.length + "）" + (lastRec ? " · 最近 " + fmtReleaseTime(lastRec.occurredAt).slice(5, 16) : "")
    : (plans.length ? "下一步：窗口内登记一次生产发布" : "有计划后才进入执行与记录");
  var d3 = note
    ? (num(extra.note.pending) ? "草稿已生成，" + num(extra.note.pending) + " 处对外表述待确认" : "对外表述已确认，可导出交付报告")
    : "还没有交付说明；有生产成功记录后可一键生成";
  return '<section class="panel vd-panel vd-chain-panel">'
    + '<div class="panel-head"><h3>发布链路</h3><span class="meta-right">日程存计划，记录存事实'
    + '<button class="vd-linkbtn" type="button" data-vd-tab="releases">查看发布页</button></span></div>'
    + '<div class="vd-chain">'
    + chainStepHTML(1, "制作发布计划", d1, s1)
    + chainStepHTML(2, "执行并记录发布", d2, s2)
    + chainStepHTML(3, "确认交付说明", d3, s3)
    + '</div></section>';
}
/* 发布计划的留痕只有 action=release_plan + before/after 快照，动态里要还原成人话 */
function feedPlanText(after, before){
  var name = (releasePlanNoText(after.planNo) || "发布计划") + " · " + releaseEnvironmentName(after.environment || "production");
  if(!before) return "创建发布计划「" + name + "」";
  if(after.status !== before.status){
    if(after.status === "ready") return "将发布计划「" + name + "」标记为就绪";
    if(after.status === "completed") return "完成发布计划「" + name + "」";
    if(after.status === "canceled") return "取消发布计划「" + name + "」";
    if(after.status === "draft") return "将发布计划「" + name + "」退回草稿";
  }
  return "更新发布计划「" + name + "」";
}
function logActionText(l){
  if(l.action === "release_plan"){
    try{
      var cd = typeof l.changeData === "string" ? JSON.parse(l.changeData) : (l.changeData || {});
      if(cd.after) return feedPlanText(cd.after, cd.before);
    }catch(e){ /* 旧数据没有旁路快照，退回通用文案 */ }
    return "更新发布计划";
  }
  return LOG_NAME[l.action] || String(l.action || "").replace(/_/g, " ");
}
function feedPanelHTML(){
  var rows = [];
  (extra.records.rows || []).forEach(function(r){
    var who = r.executorName || "系统";
    if(recordEligible(r)) rows.push({ t:r.occurredAt, who:who, tone:"ok",
      text:"登记生产发布成功" + (num(r.publishedCount) ? " · " + num(r.publishedCount) + " 项上线" : "") });
    else if(r.result === "failed") rows.push({ t:r.occurredAt, who:who, tone:"bad", text:"登记发布失败" });
    else rows.push({ t:r.occurredAt, who:who, tone:"", text:"登记" + releaseEnvironmentName(r.environment) + "发布" });
  });
  (extra.log.rows || []).forEach(function(l){
    rows.push({ t:l.createdAt, who:l.actorName || "系统", tone:"", text:logActionText(l) });
  });
  rows = rows.filter(function(r){ return r.t; })
    .sort(function(a, b){ return String(b.t).localeCompare(String(a.t)); }).slice(0, 6);
  if(!rows.length){
    return panel("最近动态", "", '<p class="hint">还没有动态；创建、调整范围、发布与确认都会出现在这里。</p>');
  }
  return panel("最近动态", "", '<ul class="vd-feed">' + rows.map(function(r){
    return '<li class="vd-feed-item"><span class="vd-feed-dot ' + esc(r.tone) + '"></span>'
      + '<span class="vd-feed-tx"><b>' + esc(r.who) + '</b> ' + esc(r.text) + '</span>'
      + '<span class="vd-feed-time">' + esc(fmtReleaseTime(r.t).slice(5, 16)) + '</span></li>';
  }).join("") + '</ul>');
}
function infoPanelHTML(){
  var v = st.version || st.stat || {};
  var members = {};
  st.tasks.forEach(function(t){ var o = String(t.owner || "").trim(); if(o) members[o] = 1; });
  var ownerCount = Object.keys(members).length;
  var remain = "";
  var target = dateText(v.targetDate);
  if(target){
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((new Date(target + "T00:00:00").getTime() - today.getTime()) / 86400000);
    remain = days > 0 ? "（剩余 " + days + " 天）" : days < 0 ? "（逾期 " + (-days) + " 天）" : "（今天到期）";
  }
  var branchNames = ((st.stat || {}).branches || []).map(function(b){ return b.name; }).filter(Boolean);
  var branchText = branchNames.length
    ? branchNames.slice(0, 2).join("、") + (branchNames.length > 2 ? " 等 " + branchNames.length + " 个" : "")
    : "未关联";
  var rows = [
    ["所属项目", reqNameById(st.reqId) || "—"],
    ["目标日期", (target || "未设置") + (remain || "")],
    ["参与成员", ownerCount ? ownerCount + " 人" : "未指派"],
    ["关联分支", branchText],
    ["创建于", dateText(v.createdAt) || "—"]
  ];
  return panel("版本信息", "", '<dl class="vd-info">' + rows.map(function(r){
    return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
  }).join("") + '</dl>');
}
function startCardHTML(){
  var demands = (extra.demands.rows || []).length;
  var tasks = st.tasks.length;
  function step(n, title, sub, state, label, attrs, reason, foot){
    return '<div class="vd-start-step is-' + state + '">'
      + '<span class="vd-start-no">' + n + '</span>'
      + '<div class="vd-start-tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>'
      + (attrs || state !== "current"
        ? '<button class="btn sm' + (state === "current" ? " primary" : "") + '" type="button"'
          + (attrs || " disabled") + '>' + esc(label) + '</button>'
        : "")
      + (reason ? '<em class="vd-start-reason">' + esc(reason) + '</em>' : "")
      + (foot ? '<em class="vd-start-foot">' + esc(foot) + '</em>' : "")
      + '</div>';
  }
  return '<section class="panel vd-panel vd-start">'
    + '<div class="panel-head vd-start-head"><h3>从这个版本开始</h3>'
    + '<span class="vd-start-hint">完成后下一步会自动出现在这里；不需要一次做完</span></div>'
    + '<div class="vd-start-list">'
    + step(1, "添加需求", "写清「这次要做什么业务、做到什么程度算完成」。可以从 Word 导入已有 PRD。",
        "current", "添加需求", writable() && !readOnly() ? " data-vd-add-demand" : " data-vd-goto-demands", "", "当前 " + demands + " 个，建议 3–10 个")
    + step(2, "拆解工作项", "把需求拆成「具体做什么、谁来做」的任务，建议先完成第 1 步。",
        demands ? "todo" : "locked", "添加工作项", demands ? ' data-vd-add-items' : "", demands ? "" : "需要先有需求")
    + step(3, "制作发布计划", "确定发布窗口与环境，就绪检查通过后到点执行并记录。",
        tasks ? "todo" : "locked", "新建发布计划", tasks ? ' data-vd-new-plan' : "", tasks ? "" : "先拆解工作项")
    + '</div></section>';
}
function homeHTML(){
  var hasContent = st.tasks.length > 0
    || !!(extra.demands.rows && extra.demands.rows.length)
    || !!(extra.plans.rows && extra.plans.rows.length);
  /* 主数据先到、侧栏还在路上时先出骨架，避免先闪一屏「还没有内容」 */
  if(!hasContent && (!extra.demands.rows || !extra.plans.rows)) return UI.skeletonRows(3);
  if(!hasContent) return startCardHTML();
  return '<div class="vd-home">'
    + '<div class="pgrid vd-home-kpis">' + homeKpisHTML() + '</div>'
    + '<div class="vd-home-cols">'
    + '<div class="vd-home-main">' + nextPanelHTML() + chainPanelHTML() + '</div>'
    + '<aside class="vd-home-side">' + feedPanelHTML() + infoPanelHTML() + '</aside>'
    + '</div></div>';
}

/* ==================== 概览（工时与构成深页） ==================== */

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
/* 空版本引导卡（P2-14）：版本还没排入工作项时，用一张引导卡替代全是 0 的空仪表，
   把「下一步该做什么」直接递到手里。按钮复用 data-vd-tool 委托，与页头操作同源。 */
function emptyVersionGuideHTML(){
  var canEdit = writable() && !readOnly();
  var acts = canEdit
    ? '<div class="gc-acts">'
      + '<button class="btn sm primary" type="button" data-vd-tool="tasks">管理范围</button>'
      + '<button class="btn sm" type="button" data-vd-tool="edit">' + icon("edit", 13) + ' 编辑版本</button>'
      + '</div>'
    : "";
  return '<div class="guide-card vd-empty-guide">'
    + '<span class="gc-ic">' + icon("layers", 18) + '</span>'
    + '<div class="gc-tx"><b>这个版本还没有工作项</b>'
    + (canEdit
      ? '先在「管理范围」里把要交付的工作项圈进来；需要的话再设置目标日期与需求。'
      : '该版本尚未排入工作项，暂无可展示的进度与工时。')
    + '</div>'
    + acts
    + '</div>';
}
function overviewHTML(){
  var s = st.stat || {};
  /* 空版本（还没排入任何工作项）：不铺开 6 KPI + 多面板的空仪表，折叠为单引导卡（P2-14） */
  if(!st.tasks.length) return emptyVersionGuideHTML();
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
    + '<div data-vd-stage-wrap>' + stageInlineHTML() + '</div>'
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
  }).join("") + '</div>';
  return panel("承诺基线", "", inner);
}
function milestonePanel(){
  var list = st.milestones.filter(function(m){ return m.kind === "version" && m.versionId === st.id && m.status !== "canceled"; });
  if(!list.length){
    /* 空态给出口：知道里程碑在驾驶舱创建，也要能一键过去 */
    return panel("里程碑", "", '<p class="hint">该版本没有关联里程碑。里程碑在项目驾驶舱里创建与达成。</p>'
      + '<button class="btn sm ghost" type="button" data-vd-project>去项目驾驶舱</button>');
  }
  var names = { achieved:"已达成", achieved_rolled_back:"已达成 · 已回滚", evidence_missing:"证据缺失", overdue:"已延期", pending:"未达成" };
  var body = list.map(function(m){
    var tone = m.status === "achieved" ? "tag-success"
      : m.status === "overdue" ? "tag-danger"
      : (m.status === "evidence_missing" || m.status === "achieved_rolled_back") ? "tag-warning" : "ghost";
    return '<tr data-vd-milestone="' + esc(m.id) + '" tabindex="0" title="查看里程碑详情与达成证据">'
      + '<td>' + esc(m.name || "里程碑") + '</td>'
      + '<td><span class="tag ' + tone + '">' + esc(names[m.status] || m.status) + '</span></td>'
      + '<td class="num">' + esc(dateText(m.targetDate) || "—") + '</td>'
      + '<td class="num">' + esc(dateText(m.achievedAt) || "—") + '</td>'
      + '<td class="num">' + num(m.releaseCount) + '</td></tr>';
  }).join("");
  return panel("里程碑", '',
    tableWrap('<th>里程碑</th><th>状态</th><th class="num">目标日</th><th class="num">达成日</th><th class="num">生产成功</th>', body));
}
function catName(id){
  if(!id) return "未分类";
  var hit = st.cats.filter(function(c){ return c.id === id; })[0];
  return hit ? hit.name : "未分类";
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
  estimate:[["type","类型"],["cat","分类"],["owner","负责人"],["demand","需求"],["items","工作项"]],
  actual:[["owner","成员"],["type","类型"],["cat","分类"],["items","工作项"],["window","计时窗口"]]
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

/* 阶段投入：三段口径与项目页、版本列表同源（lib/stage-hours），这里只做本版本的内联面板。
   工时弹层不再重复一套阶段卡，改为指向这里，保证「阶段」只有一个出处。 */
var stageMode = "actual";
function stageInlineHTML(){
  var s = summarizeStages(st.tasks);
  return stagePanelHTML({
    stage:s,
    mode:stageMode,
    title:"阶段投入",
    sub:"本版本 " + s.items + " 个工作项 · " + s.timed + " 项有计时 · 史诗不计入",
    scope:"版本 · " + versionName(),
    versionId:st.id,
    badge:"本版本",
    denomLabel:"本版本实际工时"
  });
}
function repaintStagePanel(){
  var box = host && host.querySelector("[data-vd-stage-wrap]");
  if(box) box.innerHTML = stageInlineHTML();
}
function openVersionStageDrill(el){
  openStageDrill({
    scopeLabel:"版本 · " + versionName(),
    stageKey:el.getAttribute("data-stage-drill"),
    rows:stageDrillRows(st.tasks, { catName:function(id){ return catName(id); } })
  });
}

function hoursCardHTML(){
  var s = st.stat || {};
  var total = st.tasks.length;
  var est = num(s.estimateMinutes) || estTotal();
  var act = num(s.workMinutes) || actTotal();
  var remaining = num(s.remainingMinutes);
  var openItems = st.tasks.filter(function(t){ return !isDone(t); }).length;
  /* 剩余预估按未完成项的预估相加：为 0 但还有未完成项时，实际是「这些项还没估时」 */
  var remainingText = remaining ? hourText(remaining) : (openItems ? "未估时" : "0h");
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
      + '<span class="mid">剩余预估 ' + remainingText + caliberMarkHTML("version.remaining", false, "查看「剩余预估」口径") + '</span>'
      + '<span>预估 ' + hourText(est) + '</span></div>'
    + '</div>'
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
/* 阶段拆分只在概览页内联面板出现一次：弹层类型页改为指向它，不再自带一套卡片。 */
function stageJumpHTML(){
  return '<div class="vd-h-stage-jump">' + icon("layers", 14)
    + '<span><b>阶段拆分在概览页「阶段投入」。</b>产品 / 设计、开发、测试三段与下钻明细放在版本概览，这里不重复。</span>'
    + '<button class="btn sm" type="button" data-vd-goto-stage>去阶段投入</button></div>';
}
function hoursExtraHead(kind, mode){
  if(kind === "type") return "阶段参考";
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
      + '<span><b>类型是工作项分类，不是阶段。</b>阶段投入按「测试窗口 + 工作项类型」拆成产品 / 设计、开发、测试，'
      + '见概览页的「阶段投入」；下表按需求 / 任务 / 缺陷 / 史诗看投入结构，史诗不计入阶段投入。</span></div>';
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
    : kind === "cat" ? "分类"
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
    foot = "类型来自工作项；阶段投入见概览页，按测试窗口与工作项类型拆分。占比保留一位小数。";
  }else if(kind === "demand"){
    foot = "需求来自工作项关联，需求名与工作项名不一定一致；已关闭需求仍保留在构成里。未关联的工作项也计入合计。";
  }else if(kind === "cat"){
    foot = "分类来自工作项归类，可直接使用；实际按工作项累计计时归集。";
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
    + (kind === "type" ? stageJumpHTML() : "")
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
      ? "预估来自工作项；未估工作项排在最后。点类型 / 分类 / 负责人 / 需求分组可快速筛选。"
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
/* 弹层里的「去阶段投入」：带上当前口径，关掉弹层回到概览页内联面板 */
function gotoStagePanel(){
  stageMode = (hourSheet && hourSheet.mode) || stageMode;
  closeHoursSheet();
  repaintStagePanel();
  var wrap = host && host.querySelector("[data-vd-stage-wrap]");
  if(!wrap) return;
  wrap.scrollIntoView({ behavior:"smooth", block:"start" });
  var first = wrap.querySelector("[data-stage-drill]");
  if(first) first.focus({ preventScroll:true });
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
    if(e.target.closest("[data-vd-goto-stage]")){ gotoStagePanel(); return; }
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
  cat:{ field:"cat", icon:"tag", label:"分类", name:function(v){ return catName(v === NONE ? "" : v); } },
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
var LINK_LABEL = { cat:"分类", branch:"分支", demand:"需求", stage:"计时窗口", owner:"负责人" };
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
  return panel("分支进度", '<span class="meta-right">由工作项所挂分支推导</span>',
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
    + '<button class="btn sm ghost" type="button" data-vd-delivery>交付报告</button></div>';
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
  var catPairs = [["","全部分类"],["__none__","未分类"]].concat(st.cats.map(function(c){ return [c.id, c.name]; }));
  return '<div class="vd-filters">'
    + '<label class="vd-search">' + icon("search", 13)
    + '<input type="search" data-vd-filter="q" value="' + esc(f.q) + '" placeholder="搜索标题或负责人" aria-label="搜索版本工作项"></label>'
    + selectHTML("status", STATUS_FILTERS, f.status, "按状态筛选")
    + selectHTML("cat", catPairs, f.cat, "按分类筛选")
    + selectHTML("owner", ownerPairs, f.owner, "按负责人筛选")
    + selectHTML("type", TYPE_FILTERS, f.type, "按类型筛选")
    + selectHTML("pub", PUB_FILTERS, f.pub, "按发布状态筛选")
    + selectHTML("sort", SORTS, f.sort, "排序方式")
    + '<span class="sp"></span>'
    + '<button class="btn sm ghost" type="button" data-vd-filter-reset>清空筛选</button>'
    + (writable() && !readOnly()
      ? '<button class="btn sm" type="button" data-vd-tool="tasks" title="勾选关联已有工作项，或在此版本新建工作项">管理工作项</button>'
      : '')
    + '<button class="btn sm" type="button" data-vd-board title="在看板中按此版本筛选">在看板中查看</button>'
    + '</div>' + linkedBarHTML();
}
function scopeHTML(){
  var rows = filteredTasks();
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
      + '<td>' + (typeBadgeHTML(t.itemType) || (t.itemType === "task" ? '<span class="mini-tag">任务</span>' : '')) + '</td>'
      + '<td>' + (isDone(t) ? '<span class="tag tag-success">已完成</span>'
        : '<span class="tag ' + (over ? "tag-danger" : "tag-info") + '">' + esc(colName(t.boardColumn)) + '</span>') + '</td>'
      + '<td>' + esc(t.owner || "—") + '</td>'
      + '<td class="num">' + windowCell(t, over) + '</td></tr>';
  }).join("") || emptyRow(5, st.tasks.length ? "没有匹配的工作项，试试清空筛选。" : "该版本还没有工作项。");
  var meta = '<span class="meta-right">' + rows.length + " / " + st.tasks.length + " 项</span>";
  return scopeFiltersHTML() + panel("版本范围", meta,
    tableWrap('<th>工作项</th><th>类型</th><th>状态</th><th>负责人</th><th class="num">计划窗口</th>', body, "vd-scope-tbl")
    + '<p class="foot-note">计划窗口 = 工作项开始 → 截止；预估 / 实际工时在「更多 → 工时与构成」查看。'
    + (st.tasks.some(function(t){ return t._pre; }) ? ' 范围含首版上线前未绑版本的折算项，行内标注。' : '') + '</p>');
}
/* 计划窗口：开始 → 截止；只有一侧时如实只显示一侧，逾期单独标红 */
function shortDate(s){ return s ? dateText(s).substring(5) : ""; }
function windowCell(t, over){
  var from = shortDate(t.startDate), to = shortDate(t.dueDate);
  var txt = from && to ? from + " → " + to : (to ? "截止 " + to : (from ? from + " 起" : "—"));
  return esc(txt) + (over ? ' <span class="vd-over">逾期</span>' : "");
}

/* ==================== 需求 ==================== */

function demandStatusName(s){
  return s === "plan" ? "已排期" : s === "done" ? "已完成" : s === "pass" ? "已通过" : s === "closed" ? "已关闭"
    : s === "rej" ? "已拒绝" : (s === "canceled" || s === "cancelled") ? "已取消" : "待评审";
}
function demandsHTML(){
  var slot = extra.demands;
  if(slot.error) return panel("已排需求", "", '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>');
  if(!slot.rows) return panel("已排需求", "", UI.skeletonRows(3));
  if(!slot.rows.length){
    var canAdd = writable() && !readOnly();
    return panel("已排需求", "", UI.emptyState({
      icon:"demand", title:"没有排到该版本的需求",
      text: canAdd
        ? "先添加一条需求；评审通过并排期到本版本后，会在这里汇总，已关闭的不计入。"
        : "在需求池里把需求的目标版本指向这里，就能在此汇总；已关闭的需求不计入。", compact:true,
      actionLabel: canAdd ? "添加需求" : "去需求池挑需求", actionCmd: canAdd ? "add-demand" : "goto-demands"
    }));
  }
  var body = slot.rows.map(function(d){
    var linked = st.tasks.filter(function(t){ return t.demandId === d.id; }).length;
    /* 补录与「管理工作项」同权限口径：需求仍需在排期中，且有项目发布管理权限 */
    var canFill = writable() && !readOnly() && d.status === "plan" && d.canSchedule === true;
    return '<tr data-vd-demand="' + esc(d.id) + '" tabindex="0" title="打开需求详情">'
      + '<td class="vd-tt"><span class="vd-no">' + esc(demandNoText(d.demandNo) || "—") + '</span>'
      + '<span class="vd-tname">' + esc(d.title) + '</span></td>'
      + '<td>' + esc(d.itemKind || "其他") + '</td>'
      + '<td><span class="tag ' + (d.status === "done" ? "tag-plum" : d.status === "plan" ? "tag-info" : "ghost") + '">' + esc(demandStatusName(d.status)) + '</span></td>'
      + '<td>' + esc(d.priority || "—") + '</td>'
      + '<td class="num">' + esc(dateText(d.expectDate) || "—") + '</td>'
      + '<td class="num vd-rel-cell">' + (linked
        ? '<span>' + linked + ' 项</span>' + linkBtn("demand", d.id, d.title)
        : '<span class="vd-muted" title="本版本的工作项还没有挂到这条需求">未挂工作项</span>')
        + (canFill
          ? '<button class="btn sm vd-backfill" type="button" data-vd-backfill="' + esc(d.id) + '" title="把该需求名下未加入本版本的工作项补录进来">补录工作项</button>'
          : '')
        + '</td></tr>';
  }).join("");
  return panel("已排需求", '<span class="meta-right">' + slot.rows.length + ' 项 · 目标版本指向本版本，不含已关闭</span>',
    tableWrap('<th>需求</th><th>类型</th><th>状态</th><th>优先级</th><th class="num">期望日期</th><th class="num">本版本工作项</th>', body)
    + '<p class="foot-note">需求按「目标版本」规划，工作项按「计划版本」归组。</p>');
}

/* ==================== 发布 ==================== */

function planStatusName(s){
  /* 收敛到 PLAN_STATUS_META（P2-11）；未保存计划仍显示「未创建」 */
  return (PLAN_STATUS_META[s] || {}).name || s || "未创建";
}
function releasesHTML(){
  return '<div class="vd-rel-split">' + plansPanel() + recordsPanel() + '</div>';
}
function planDisplayName(p){
  var custom = String(p.name || "").trim();
  if(custom) return custom;
  return versionName() + " " + releaseEnvironmentName(p.environment || "production") + "发布";
}
function planOwnerName(p){
  var uid = p.ownerUserId;
  if(!uid) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return (m.userId || m.id) === uid; })[0];
  return (hit && (hit.name || hit.nickname || hit.userId)) || "";
}
function planLocalTaskCount(p){
  var ids = p.plannedTaskIds || [];
  return st.tasks.filter(function(t){ return ids.indexOf(t.id) !== -1; }).length;
}
function planCheckText(p){
  if(p.status === "draft") return "草稿：尚未做就绪检查";
  if(p.status === "ready") return "就绪：内容与环境已锁定";
  if(p.status === "completed") return "已完成：由发布记录自动收口";
  return "已取消：不再执行";
}
/* 左栏一个计划一张卡：标题 / 状态 / 窗口常驻，记录发布是行内主操作，管理入口进发布工作区 */
function planCardHTML(p){
  var cross = num(p.versionCount) > 1;
  var vnames = (p.versions || []).map(function(v){ return v.versionName; }).filter(Boolean);
  var versions = num(p.versionCount) || (p.versionIds || []).length || 1;
  var released = num(p.releasedVersionCount);
  var canRecord = st.version && st.version.canPublish === true
    && p.status !== "completed" && p.status !== "canceled";
  var acts = (canRecord ? '<button class="btn sm primary" type="button" data-vd-record-plan="' + esc(p.id) + '">记录发布</button>' : "")
    + '<button class="btn sm ghost" type="button" data-vd-tool="plan" title="在发布工作区查看与调整该计划">管理计划</button>';
  return '<article class="vd-plan-card' + (p.status === "completed" ? " is-done" : "") + '">'
    + '<div class="vd-plan-top"><b>' + esc(planDisplayName(p)) + '</b>'
    + '<span class="tag ' + planStatusTone(p.status) + '">' + esc(planStatusName(p.status)) + '</span>'
    + (cross ? '<span class="tag tag-info">跨项目 · ' + versions + ' 个版本</span>' : "")
    + '<span class="sp"></span>'
    + '<span class="vd-plan-win">窗口 ' + esc(p.plannedAt ? fmtReleaseTime(p.plannedAt).slice(5, 16) : "未定") + '</span>'
    + acts
    + '</div>'
    + '<div class="vd-plan-meta">' + esc(releaseEnvironmentName(p.environment || "production")) + ' 环境 · '
    + planLocalTaskCount(p) + ' 项工作项'
    + (planOwnerName(p) ? ' · 执行人 ' + esc(planOwnerName(p)) : "")
    + '</div>'
    + '<div class="vd-plan-sub">' + esc(vnames.join(" · ") || versionName()) + ' · ' + esc(planCheckText(p)) + '</div>'
    + (versions > 1 && released > 0 && released < versions
      ? '<div class="vd-plan-note">已发 ' + released + "/" + versions + ' 个版本，其余版本发布后自动收口</div>'
      : "")
    + '</article>';
}
function plansPanel(){
  var slot = extra.plans;
  var canManage = st.version && st.version.canManageReleasePlan === true;
  var head = '<div class="panel-head vd-rel-head"><h3>发布计划</h3>'
    + '<span class="vd-rel-hint">日程存计划：打算何时、交付什么</span><span class="sp"></span>'
    + '<span class="seg mini vd-plan-chips" role="group" aria-label="按状态筛选发布计划">'
    + PLAN_CHIPS.map(function(c){
      return '<button type="button" data-vd-plan-chip="' + c[0] + '" aria-pressed="' + (st.planChip === c[0] ? "true" : "false") + '">' + c[1] + '</button>';
    }).join("") + '</span>'
    + '<button class="btn sm ghost" type="button" data-vd-all-plans>全部发布计划</button>'
    + (canManage && !readOnly() ? '<button class="btn sm" type="button" data-vd-new-plan>＋ 新建计划</button>' : "")
    + '</div>';
  /* 入口常驻但写操作按权限隐藏：给一句话说明缺口与放开位置，避免只剩「怎么没有记录发布」的疑问 */
  var permNote = st.version && st.version.canPublish !== true
    ? '<p class="hint vd-rel-perm">当前身份只能查看计划与发布事实；维护计划、记录发布需空间主 / 管理员或项目负责人，空间主 / 管理员也可在「设置 → 工作流 → 发布权限」放开项目可写成员。</p>'
    : "";
  if(slot.error) return '<section class="panel vd-panel vd-rel-plans">' + head
    + '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p>' + permNote + '</section>';
  if(!slot.rows) return '<section class="panel vd-panel vd-rel-plans">' + head + UI.skeletonRows(2) + '</section>';
  var rows = slot.rows.filter(planMatchesChip);
  var body = slot.rows.length
    ? (rows.length
      ? '<div class="vd-plan-cards">' + rows.map(planCardHTML).join("") + '</div>'
      : '<p class="hint vd-tl-empty">没有匹配的发布计划，切换上方筛选看看。</p>')
    : '<div class="vd-rel-empty"><b>还没有发布计划</b><p>临近发布窗口时创建：确定环境与窗口、勾交付内容、通过就绪检查后到点执行。</p>'
      + (canManage && !readOnly() ? '<button class="btn sm primary" type="button" data-vd-new-plan>＋ 新建发布计划</button>' : "") + '</div>';
  return '<section class="panel vd-panel vd-rel-plans">' + head + body + permNote + '</section>';
}
var PLAN_CHIPS = [["all", "全部"], ["ready", "就绪"], ["completed", "已完成"]];
function planMatchesChip(p){
  var chip = st.planChip || "all";
  return chip === "all" || p.status === chip;
}
var REL_CHIPS = [["all", "全部"], ["success", "成功"], ["failed", "失败"], ["rollback", "回滚"]];
function recordMatchesChip(r){
  var chip = st.relChip || "all";
  if(chip === "success") return r.result === "success" && r.operation !== "rollback";
  if(chip === "failed") return r.result === "failed";
  if(chip === "rollback") return r.operation === "rollback";
  return true;
}
/* 一条发布记录一张卡：计划 / 实际事实 / 交付报告同屏，明细收在卡内，不在三个页面之间跳 */
function recordPlan(r){
  var p = r && r.planSnapshot;
  if(typeof p === "string"){ try{ p = JSON.parse(p); }catch(ex){ return null; } }
  return p && typeof p === "object" ? p : null;
}
function recordEligible(r){
  return r.result === "success" && r.environment === "production" && r.operation !== "rollback";
}
function plannedDelayText(r, p){
  if(!p || !p.plannedAt || !r.occurredAt) return "";
  var a = new Date(r.occurredAt), b = new Date(p.plannedAt);
  if(isNaN(a.getTime()) || isNaN(b.getTime())) return "";
  var m = Math.round((a.getTime() - b.getTime()) / 60000);
  if(!m) return "与计划时间一致" + (r.deviationReason ? " · 已填写原因" : "");
  return (m > 0 ? "比计划晚 " + m + " 分钟" : "比计划早 " + (-m) + " 分钟") + (r.deviationReason ? " · 已填写原因" : "");
}
function relRecordTitle(r){
  var env = releaseEnvironmentName(r.environment);
  if(r.operation === "rollback") return env + "回滚" + (r.result === "success" ? "成功" : r.result === "failed" ? "失败" : "");
  return env + "发布" + (r.result === "failed" ? "失败" : r.result === "success" ? "成功" : "结果未记录")
    + (r.operation === "redeploy" ? "（重部署）" : "");
}
function relPlanRef(p){
  if(!p) return "未关联计划";
  var no = releasePlanNoText(p.planNo);
  return "关联「" + (no ? no + " · " : "") + (String(p.name || "").trim() || "发布计划") + "」";
}
/* 右栏时间线：一条事实一行，计划引用与执行人常驻；快照明细、交付与导出收在展开区，不占时间线首屏 */
function releaseTimelineItemHTML(r){
  var p = recordPlan(r), eligible = recordEligible(r);
  var tone = r.operation === "rollback" ? "is-rollback" : (r.result === "failed" ? "is-failed" : "is-success");
  var meta = [releaseNoText(r.releaseNo) || ("#" + r.id), "执行人 " + (r.executorName || "未记录")];
  if(r.artifactRef) meta.push("制品 " + r.artifactRef);
  if(r.failureReason) meta.push("失败原因：" + r.failureReason);
  if(r.deviationReason) meta.push("偏差理由：" + r.deviationReason);
  var delay = plannedDelayText(r, p);
  if(delay) meta.push(delay);
  return '<li class="vd-tl-item">'
    + '<span class="vd-tl-dot ' + tone + '" aria-hidden="true"></span>'
    + '<div class="vd-tl-main">'
    + '<div class="vd-tl-line"><b>' + esc(relRecordTitle(r)) + '</b> · ' + esc(relPlanRef(p))
    + '<time>' + esc(fmtReleaseTime(r.occurredAt).slice(5, 16)) + '</time></div>'
    + '<div class="vd-tl-meta">' + meta.map(esc).join(" · ") + '</div>'
    + '<details class="vd-tl-more"><summary>快照明细（' + (r.items || []).length + ' 项工作项）</summary>'
    + releaseSnapshotBodyHTML(r, null, { hideActions: true })
    + '<div class="vd-tl-acts">'
    + (eligible ? '<button class="btn sm" type="button" data-release-delivery="' + esc(r.id) + '" data-release-delivery-version="' + esc(r.versionId || "") + '">查看交付报告</button>' : "")
    + '<button class="btn sm ghost" type="button" data-release-export="' + esc(r.id) + '">导出快照 CSV</button>'
    + '</div></details>'
    + '</div></li>';
}
function recordsPanel(){
  var slot = extra.records;
  var head = '<div class="panel-head vd-rel-head"><h3>发布记录</h3>'
    + '<span class="vd-rel-hint">记录存事实：只追加、不可改</span><span class="sp"></span>'
    + '<span class="seg mini vd-rel-chips" role="group" aria-label="按结果筛选发布记录">'
    + REL_CHIPS.map(function(c){
      return '<button type="button" data-vd-rel-chip="' + c[0] + '" aria-pressed="' + (st.relChip === c[0] ? "true" : "false") + '">' + c[1] + '</button>';
    }).join("") + '</span></div>';
  var foot = '<p class="foot-note vd-rel-foot">失败与回滚也保留；生产成功 + 非回滚 + 覆盖版本全部完成后，计划自动变「已完成」。</p>';
  if(slot.error) return '<section class="panel vd-panel vd-rel-records">' + head
    + '<p class="vd-warn">' + icon("alert", 12) + ' ' + esc(slot.error) + '</p></section>';
  if(!slot.rows) return '<section class="panel vd-panel vd-rel-records">' + head + UI.skeletonRows(2) + '</section>';
  var rowsAll = slot.rows;
  var rows = rowsAll.filter(recordMatchesChip);
  var body = rowsAll.length
    ? (rows.length
      ? '<ol class="vd-timeline">' + rows.map(releaseTimelineItemHTML).join("") + '</ol>'
      : '<p class="hint vd-tl-empty">没有匹配的发布记录，切换上方筛选看看。</p>')
    : '<div class="vd-rel-empty"><b>还没有发布记录</b><p>发布动作执行完后，回到这里记录真实结果——成功、失败、回滚都算事实。</p></div>';
  return '<section class="panel vd-panel vd-rel-records">' + head + body + foot + '</section>';
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
    + '<h1 class="vd-title">选择版本</h1></div></header>'
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
  /* 记录发布已收成独立页（#/record）：计划比对、偏差理由与保存都在那一页，不再借工作台弹窗 */
  if(tool === "actual"){ openRecordPage(""); return; }
  loadView("phase").then(function(m){
    if(activeView !== "version" || st.id !== id) return;
    m.openVersionTool(reqId, id, tool);
  }).catch(function(ex){ toast(ex.message || "打开版本工具失败", "bad"); });
}
function openDelivery(){
  var id = st.id;
  loadView("delivery").then(function(m){ m.openDeliveryNote(id, ""); })
    .catch(function(ex){ toast(ex.message || "打开交付报告失败", "bad"); });
}
function openRecordPage(planId){
  var id = st.id, reqId = st.reqId;
  if(!id) return;
  loadView("record").then(function(m){
    m.openRecordPage({ versionId:id, reqId:reqId, planId:planId || "" });
  }).catch(function(ex){ toast(ex.message || "打不开记录发布页", "bad"); });
}
/* 概览起步卡第 3 步：直接进入 4 步向导，并预选当前版本 */
function openPlanWizard(){
  var id = st.id;
  loadView("plan-wizard").then(function(m){
    m.openPlanWizard({ from:"version", anchor:id, reqId:st.reqId, ids:[id] });
  }).catch(function(ex){ toast(ex.message || "打不开新建计划向导", "bad"); });
}
function openDemand(id){
  loadView("demands").then(function(m){ m.openDemandDetailById(id); })
    .catch(function(ex){ toast(ex.message || "打开需求详情失败", "bad"); });
}
/* 需求页签空态：直接带到需求池并聚焦本项目，省掉「先找菜单再选项目」 */
function openDemandPool(){
  var reqId = st.reqId;
  loadView("demands").then(function(m){
    if(reqId && m.openDemandsForReq) m.openDemandsForReq(reqId);
    showView("demands");
  }).catch(function(ex){ toast(ex.message || "打开需求池失败", "bad"); });
}
/* 需求页签补录：复用排期带入的同一弹窗与校验，成功后刷新本页工作项与计数 */
function backfillDemandTasks(id){
  var versionId = st.id, label = versionName();
  loadView("demands").then(function(m){
    m.openDemandVersionBackfill(id, versionId, label, { onDone: function(){ reload(); } });
  }).catch(function(ex){ toast(ex.message || "打开补录失败", "bad"); });
}
/* ==================== 添加工作项 / 添加需求（原型 11-27：三选一抽屉） ==================== */
/* 工作项：从需求拆解（推荐）/ 直接新建 / 从其他版本带入。拆解复用需求详情的 AI 草稿流程，
   直接新建复用任务抽屉，带入只新增本版本关联（保留原版本），保存同样走整单 taskIds + 理由。 */
var addDrawerSeq = 0;
function addGuard(){
  if(!st.id) return false;
  if(!writable()){ toast("你没有该项目的写入权限，无法添加", "warn"); return false; }
  if(readOnly()){ toast("版本已发布或已终态，不能再添加内容", "warn"); return false; }
  return true;
}
function demandLinkedCount(id){
  return st.tasks.filter(function(t){ return t.demandId === id; }).length;
}
/* 上一动作的提示会压在侧滑底部主按钮上：开抽屉时先收掉纯提示；
   带操作按钮的（如撤销）保留，避免顺手吞掉用户还能用的入口 */
function dismissToasts(){
  var wrap = document.getElementById("toastWrap");
  if(!wrap) return;
  wrap.querySelectorAll(".toast:not(.out)").forEach(function(el){
    if(el.querySelector(".tact")) return;
    el.remove();
  });
}
function openAddItems(){
  if(!addGuard()) return;
  dismissToasts();
  var seq = ++addDrawerSeq, versionId = st.id, reqId = st.reqId, vName = versionName();
  var demands = (extra.demands.rows || []).filter(function(d){ return d.status !== "done"; });
  var prefer = demands.filter(function(d){ return !demandLinkedCount(d.id); })[0] || demands[0];
  var state = { way:"1", demandId: prefer ? prefer.id : "", sourceId:"", picked:{}, options:null, optionsError:"" };
  var layer = document.createElement("div");
  layer.className = "modal-layer side";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "vdAddItemsTitle");
  layer.innerHTML = '<div class="sheet vd-add-sheet">'
    + '<div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2 id="vdAddItemsTitle">添加工作项</h2><div class="desc">到 ' + esc(vName) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-add-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body">'
    + '<p class="vd-add-intro">工作项回答「具体做什么、谁来做」。按你的实际情况选一种方式：</p>'
    + '<div class="vd-ways" role="radiogroup" aria-label="添加工作项方式">'
    + wayHTML(1, "① 从需求拆解", "选一个需求，生成开发/测试工作项草稿。适合需求已录入、还没拆任务。", true)
    + wayHTML(2, "② 直接新建工作项", "只建一两个零散任务、不挂需求时使用。")
    + wayHTML(3, "③ 从其他版本带入", "把未完成工作项关联到本版本，原版本关联保留。")
    + '</div>'
    + '<div class="vd-add-pane" data-add-pane="1"></div>'
    + '<div class="vd-add-pane" data-add-pane="2" hidden></div>'
    + '<div class="vd-add-pane" data-add-pane="3" hidden></div>'
    + '</div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-add-x>取消</button>'
    + '<span style="flex:1"></span><button class="btn primary" type="button" data-add-go></button></div>'
    + '</div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  UI.openModal(layer);

  function wayHTML(n, title, desc, rec){
    return '<div class="vd-way' + (state.way === String(n) ? " is-on" : "") + '" role="radio" tabindex="0"'
      + ' aria-checked="' + (state.way === String(n)) + '" data-add-way="' + n + '">'
      + '<div class="vd-way-t">' + esc(title) + (rec ? ' <span class="tag tag-info">推荐</span>' : "") + '</div>'
      + '<div class="vd-way-d">' + esc(desc) + '</div></div>';
  }
  function openSources(){
    if(!state.options) return [];
    var order = {};
    st.versions.forEach(function(v){ order[v.id] = v.name; });
    var map = {};
    state.options.forEach(function(t){
      if(isDone(t)) return;
      taskVersionIds(t).forEach(function(vid){
        if(vid === versionId || !order[vid]) return;
        map[vid] = (map[vid] || 0) + 1;
      });
    });
    return Object.keys(map).map(function(vid){ return { id:vid, name:order[vid], count:map[vid] }; });
  }
  function openTasks(){
    if(!state.options || !state.sourceId) return [];
    return state.options.filter(function(t){
      return !isDone(t) && taskVersionIds(t).indexOf(state.sourceId) !== -1
        && taskVersionIds(t).indexOf(versionId) === -1;
    }).sort(function(a, b){ return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN"); });
  }
  function pickedIds(){ return Object.keys(state.picked).filter(function(id){ return state.picked[id]; }); }
  function pane1HTML(){
    if(!demands.length){
      return '<div class="vd-add-empty">本版本还没有已排需求。可以切到「② 直接新建工作项」，或先去需求页添加需求。</div>';
    }
    return '<div class="field"><label for="vdAddDemandPick">选择需求 <em class="req">*</em></label>'
      + '<select class="input" id="vdAddDemandPick" data-add-demand>'
      + demands.map(function(d){
        var n = demandLinkedCount(d.id);
        return '<option value="' + esc(d.id) + '"' + (d.id === state.demandId ? " selected" : "") + '>'
          + esc(d.title) + '（' + (n ? "已挂 " + n + " 项" : "未拆解") + '）</option>';
      }).join("") + '</select>'
      + '<span class="hint">只列出本版本内尚未完成的需求；拆解后草稿要在需求详情里勾选才会创建。</span></div>'
      + '<p class="vd-add-note">拆解会打开需求详情并自动生成草稿：标题、优先级、依赖可逐条改，可逐条勾选创建。</p>';
  }
  function pane2HTML(){
    return '<div class="vd-add-prefill"><b>将新建到</b>'
      + '<span>' + esc(reqNameById(reqId) || "当前项目") + ' · ' + esc(vName) + '</span>'
      + '<i>状态默认「未开始」；负责人、估时、日期在表单里填。</i></div>'
      + '<p class="vd-add-note">表单会预选本版本，保存后立即出现在工作项列表；不挂需求也不影响以后补挂。</p>';
  }
  function pane3HTML(){
    if(state.optionsError){
      return '<div class="vd-add-empty">' + esc(state.optionsError) + ''
        + ' <button class="btn sm" type="button" data-add-reload>重试</button></div>';
    }
    if(!state.options) return '<div class="vd-add-empty">工作项加载中…</div>';
    var sources = openSources();
    if(!sources.length){
      return '<div class="vd-add-empty">同项目其他版本没有可带入的未完成工作项。</div>';
    }
    var list = openTasks();
    return '<div class="field"><label for="vdAddSourcePick">从哪个版本带入 <em class="req">*</em></label>'
      + '<select class="input" id="vdAddSourcePick" data-add-source>'
      + sources.map(function(s){
        return '<option value="' + esc(s.id) + '"' + (s.id === state.sourceId ? " selected" : "") + '>'
          + esc(s.name) + '（未完成 ' + s.count + ' 项）</option>';
      }).join("") + '</select>'
      + '<span class="hint">只带入未完成工作项；只新增本版本关联，原版本关联保留。</span></div>'
      + (list.length
        ? '<div class="vd-pick-head"><span>选择未完成工作项</span>'
          + '<button class="lnk" type="button" data-add-all>' + (pickedIds().length === list.length ? "全不选" : "全选") + '</button></div>'
          + '<div class="vd-pick-list">' + list.map(function(t){
            var others = taskVersionIds(t).filter(function(vid){ return vid !== state.sourceId && vid !== versionId; })
              .map(function(vid){ var hit = st.versions.filter(function(x){ return x.id === vid; })[0]; return hit ? hit.name : ""; })
              .filter(Boolean);
            return '<label class="vd-pick-row"><input type="checkbox" data-add-task="' + esc(t.id) + '"'
              + (state.picked[t.id] ? " checked" : "") + '>'
              + '<span class="tx"><b>' + esc(t.title) + '</b><i>' + esc((t.owner || "未指派") + " · " + (colName(t.boardColumn) || "未开始")
                + (others.length ? " · 也关联 " + others.join("、") : "")) + '</i></span>'
              + (typeBadgeHTML(t.itemType) || "") + '</label>';
          }).join("") + '</div>'
        : '<div class="vd-add-empty">该版本没有可带入的未完成工作项。</div>');
  }
  function sync(){
    layer.querySelectorAll("[data-add-way]").forEach(function(el){
      var on = el.getAttribute("data-add-way") === state.way;
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-checked", on ? "true" : "false");
    });
    layer.querySelectorAll("[data-add-pane]").forEach(function(el){
      el.hidden = el.getAttribute("data-add-pane") !== state.way;
    });
    var p1 = layer.querySelector('[data-add-pane="1"]'), p2 = layer.querySelector('[data-add-pane="2"]'), p3 = layer.querySelector('[data-add-pane="3"]');
    if(!p1.hidden) p1.innerHTML = pane1HTML();
    if(!p2.hidden) p2.innerHTML = pane2HTML();
    if(!p3.hidden) p3.innerHTML = pane3HTML();
    var go = layer.querySelector("[data-add-go]"), n = pickedIds().length;
    if(state.way === "1"){
      go.textContent = "生成工作项";
      go.disabled = !state.demandId;
    }else if(state.way === "2"){
      go.textContent = "打开新建表单";
      go.disabled = false;
    }else{
      go.textContent = n ? "带入 " + n + " 个工作项" : "带入所选工作项";
      go.disabled = !n || !state.sourceId;
    }
  }
  function loadOptions(){
    state.options = null; state.optionsError = "";
    API.get("/api/versions/task-options", { reqId:reqId }).then(function(rows){
      if(seq !== addDrawerSeq || !layer.isConnected) return;
      state.options = rows || [];
      var sources = openSources();
      if(sources.length){ state.sourceId = sources[0].id; }
      sync();
    }).catch(function(ex){
      if(seq !== addDrawerSeq || !layer.isConnected) return;
      state.optionsError = ex.message || "工作项加载失败";
      sync();
    });
  }
  function saveBind(){
    var ids = pickedIds();
    if(!ids.length || !state.sourceId) return;
    if(!state.options) return;
    var currentIds = state.options.filter(function(t){ return taskVersionIds(t).indexOf(versionId) !== -1; })
      .map(function(t){ return t.id; });
    var union = currentIds.slice();
    ids.forEach(function(id){ if(union.indexOf(id) === -1) union.push(id); });
    var src = openSources().filter(function(s){ return s.id === state.sourceId; })[0];
    var v = st.version || {};
    var go = layer.querySelector("[data-add-go]");
    go.disabled = true;
    API.put("/api/versions/" + encodeURIComponent(versionId), {
      reqId: reqId,
      name: v.name || vName,
      description: v.description || null,
      /* 整单覆盖语义：开始日期必须回传，否则保存关联会清掉它 */
      startDate: v.startDate || null,
      targetDate: v.targetDate || null,
      status: v.status === "active" ? "active" : "planned",
      revision: v.revision,
      taskIds: union,
      taskChangeReason: "从版本「" + ((src && src.name) || state.sourceId) + "」带入 " + ids.length + " 个工作项"
    }).then(function(){
      addDrawerSeq++;
      UI.closeModal(layer);
      toast("已从「" + ((src && src.name) || "其他版本") + "」带入 " + ids.length + " 个工作项", "fs");
      reload();
    }).catch(function(ex){
      go.disabled = false;
      toast(ex.message || "带入失败", "bad");
    });
  }
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-add-x]")){ UI.closeModal(layer); return; }
    var way = e.target.closest("[data-add-way]");
    if(way){ state.way = way.getAttribute("data-add-way"); sync(); var f = layer.querySelector(".vd-add-pane:not([hidden]) select"); if(f) try{ f.focus(); }catch(ex){ /* noop */ } return; }
    if(e.target.closest("[data-add-all]")){
      var list = openTasks();
      var all = pickedIds().length === list.length;
      list.forEach(function(t){ state.picked[t.id] = !all; });
      sync();
      return;
    }
    if(e.target.closest("[data-add-reload]")){ loadOptions(); return; }
    var go = e.target.closest("[data-add-go]");
    if(!go || go.disabled) return;
    if(state.way === "1"){
      if(!state.demandId){ toast("请选择要拆解的需求", "warn"); return; }
      addDrawerSeq++;
      UI.closeModal(layer);
      var demandId = state.demandId;
      loadView("demands").then(function(m){
        if(m.openDemandSplitById) m.openDemandSplitById(demandId);
        else m.openDemandDetailById(demandId);
      }).catch(function(ex){ toast(ex.message || "打开需求拆解失败", "bad"); });
      return;
    }
    if(state.way === "2"){
      addDrawerSeq++;
      UI.closeModal(layer);
      openTaskDrawer("backlog", null, {
        reqId: reqId,
        versionIds: [versionId],
        onClose: function(){ reload(); }
      });
      return;
    }
    saveBind();
  });
  layer.addEventListener("change", function(e){
    if(e.target.matches("[data-add-demand]")){ state.demandId = e.target.value; sync(); return; }
    if(e.target.matches("[data-add-source]")){ state.sourceId = e.target.value; state.picked = {}; sync(); return; }
    var cb = e.target.closest("[data-add-task]");
    if(cb){ state.picked[cb.getAttribute("data-add-task")] = cb.checked; sync(); }
  });
  layer.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var way = e.target.closest("[data-add-way]");
    if(way && way === e.target){ e.preventDefault(); state.way = way.getAttribute("data-add-way"); sync(); }
  });
  sync();
  loadOptions();
}
function openAddDemand(){
  if(!addGuard()) return;
  dismissToasts();
  var reqId = st.reqId, vName = versionName();
  var me = rt.currentUser || {};
  var pri = "P1";
  var layer = document.createElement("div");
  layer.className = "modal-layer side";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-labelledby", "vdAddDemandTitle");
  layer.innerHTML = '<div class="sheet vd-add-sheet">'
    + '<div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2 id="vdAddDemandTitle">添加需求</h2><div class="desc">到 ' + esc(vName) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-add-x aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body">'
    + '<p class="vd-add-intro">需求回答「这次要做什么业务、做到什么程度算完成」。'
    + '创建后进入待评审；评审通过并排期到本版本后，会出现在需求列表。</p>'
    + '<div class="field"><label for="vdAddDemandTitleInput">需求标题 <em class="req">*</em></label>'
    + '<input class="input" id="vdAddDemandTitleInput" data-add-title maxlength="80" placeholder="例：大促期间积分翻倍">'
    + '<span class="hint">一句话说清业务目标，例：大促期间积分翻倍。</span></div>'
    + '<div class="field"><label for="vdAddDemandDesc">需求描述</label>'
    + '<textarea class="textarea" id="vdAddDemandDesc" data-add-desc rows="3" maxlength="2000" placeholder="背景、涉及页面或接口、关键业务规则……"></textarea></div>'
    + '<div class="field"><label for="vdAddDemandAccept">验收标准 <em class="req">*</em></label>'
    + '<textarea class="textarea" id="vdAddDemandAccept" data-add-accept rows="3" maxlength="2000" placeholder="例：用户下单后 5 分钟内积分到账；超卖率为 0……"></textarea>'
    + '<span class="hint">验收标准是发布就绪检查与交付说明「能力清单」的来源。</span></div>'
    + '<div class="field"><label>优先级 <em class="req">*</em></label>'
    + '<div class="radio-cards vd-pri4" role="radiogroup" aria-label="需求优先级">'
    + [["P0", "紧急"], ["P1", "高"], ["P2", "中"], ["P3", "低"]].map(function(p){
      return '<button class="rc' + (pri === p[0] ? " on" : "") + '" type="button" role="radio"'
        + ' aria-checked="' + (pri === p[0]) + '" data-add-pri="' + p[0] + '">' + p[1] + '</button>';
    }).join("") + '</div></div>'
    + '<div class="field"><label for="vdAddDemandSource">提出人</label>'
    + '<input class="input" id="vdAddDemandSource" data-add-source-name maxlength="40" value="' + esc(me.displayName || me.username || "") + '">'
    + '<span class="hint">默认当前用户；可改成实际提出需求的人，写进需求的来源。</span></div>'
    + '</div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-add-x>取消</button>'
    + '<span style="flex:1"></span><button class="btn primary" type="button" data-add-create>创建需求</button></div>'
    + '</div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 200); };
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-add-x]")){ UI.closeModal(layer); return; }
    var priBtn = e.target.closest("[data-add-pri]");
    if(priBtn){
      pri = priBtn.getAttribute("data-add-pri");
      layer.querySelectorAll("[data-add-pri]").forEach(function(b){
        var on = b.getAttribute("data-add-pri") === pri;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      return;
    }
    var create = e.target.closest("[data-add-create]");
    if(!create || create.disabled) return;
    var title = layer.querySelector("[data-add-title]").value.trim();
    var accept = layer.querySelector("[data-add-accept]").value.trim();
    if(!title){ toast("请填写需求标题", "warn"); layer.querySelector("[data-add-title]").focus(); return; }
    if(!accept){ toast("请填写验收标准", "warn"); layer.querySelector("[data-add-accept]").focus(); return; }
    var desc = layer.querySelector("[data-add-desc]").value.trim();
    var source = layer.querySelector("[data-add-source-name]").value.trim();
    create.disabled = true;
    API.post("/api/demands", {
      reqId: reqId,
      title: title,
      description: desc || null,
      acceptText: accept,
      priority: pri,
      source: source || null,
      itemKind: "新功能"
    }).then(function(created){
      UI.closeModal(layer);
      if(!created || !created.id){ toast("需求已创建", "fs"); reload(); return; }
      toast("已提交评审「" + title + "」；通过并排期到「" + vName + "」后会出现在需求列表", "fs");
      reload();
      loadView("demands").then(function(m){ m.openDemandDetailById(created.id); })
        .catch(function(){ /* 详情打不开不影响创建结果 */ });
    }).catch(function(ex){
      create.disabled = false;
      toast(ex.message || "创建需求失败", "bad");
    });
  });
  UI.openModal(layer, "[data-add-title]");
}
function jumpBoard(){
  /* 与版本卡下钻同一口径：清掉旧筛选，按当前项目 + 该版本过滤，已完成列放到全部历史。
     看板有的筛选（关键词 / 模块 / 负责人 / 类型）一并带过去，没有的（分支 / 需求 / 计时窗口 / 状态）如实说明 */
  var f = st.filters, carried = [], left = [];
  state.q = f.q || ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = [];
  if(f.q){ carried.push("关键词"); }
  if(f.owner && f.owner !== NONE){ state.owners = [f.owner]; carried.push("负责人"); }
  if(f.cat && f.cat !== NONE){ state.cats = [f.cat]; carried.push("分类"); }
  if(f.type){ state.types = [f.type]; carried.push("类型"); }
  if(f.branch) left.push("分支");
  if(f.demand) left.push("需求");
  if(f.stage) left.push("计时窗口");
  if(f.status) left.push("状态");
  if(f.owner === NONE) left.push("未指派");
  if(f.cat === NONE) left.push("未分类");
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
    var stageModeBtn = e.target.closest("[data-stage-mode]");
    if(stageModeBtn){ stageMode = stageModeBtn.getAttribute("data-stage-mode"); repaintStagePanel(); return; }
    var stageHit = e.target.closest("[data-stage-drill]");
    if(stageHit){ openVersionStageDrill(stageHit); return; }
    var moreBtn = e.target.closest("[data-vd-more]");
    if(moreBtn){
      var menu = host.querySelector(".vd-more-menu");
      if(menu){
        menu.hidden = !menu.hidden;
        moreBtn.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      }
      return;
    }
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
    var planChip = e.target.closest("[data-vd-plan-chip]");
    if(planChip){ st.planChip = planChip.getAttribute("data-vd-plan-chip"); renderAll(); return; }
    var relChip = e.target.closest("[data-vd-rel-chip]");
    if(relChip){ st.relChip = relChip.getAttribute("data-vd-rel-chip"); renderAll(); return; }
    var recPlan = e.target.closest("[data-vd-record-plan]");
    if(recPlan){ openRecordPage(recPlan.getAttribute("data-vd-record-plan")); return; }
    if(e.target.closest("[data-vd-all-plans]")){ showView("release"); return; }
    if(e.target.closest("[data-vd-new-plan]")){ openPlanWizard(); return; }
    if(e.target.closest("[data-vd-goto-demands]")){ openDemandPool(); return; }
    if(e.target.closest("[data-vd-add-items]")){ openAddItems(); return; }
    if(e.target.closest("[data-vd-add-demand]")){ openAddDemand(); return; }
    var nextToggle = e.target.closest("[data-vd-next-toggle]");
    if(nextToggle){
      var nextPanel = nextToggle.closest(".vd-next-panel");
      if(nextPanel){
        nextToggle.textContent = nextPanel.classList.toggle("is-collapsed") ? "全部展开" : "全部收起";
      }
      return;
    }
    if(e.target.closest("[data-vd-branches]")){ openVersionBranches(); return; }
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
    var fill = e.target.closest("[data-vd-backfill]");
    if(fill){ backfillDemandTasks(fill.getAttribute("data-vd-backfill")); return; }
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
        .catch(function(){ toast("打开交付报告失败", "bad"); });
      return;
    }
    var task = e.target.closest("[data-open-task]");
    if(task){ openTaskById(task.dataset.openTask); return; }
    /* 发布快照里的 data-snap-task / data-snap-demand 由 core/task-actions.js 全局委托，
       这里不能再接一遍：需求详情每次调用都新建弹层，接两遍会叠出两层关不掉 */
  });
  /* 更多菜单：点页面其他地方收起；重画后菜单随 headHTML 重建 */
  document.addEventListener("click", function(e){
    if(!host || activeView !== "version") return;
    if(e.target.closest && e.target.closest(".vd-more-wrap")) return;
    var m = host.querySelector(".vd-more-menu");
    if(!m || m.hidden) return;
    m.hidden = true;
    var b = host.querySelector("[data-vd-more]");
    if(b) b.setAttribute("aria-expanded", "false");
  });
  host.addEventListener("change", function(e){
    var sw = e.target.closest("[data-vd-switch]");
    if(sw){ openVersionDetail(st.reqId, sw.value); return; }
    var f = e.target.closest("[data-vd-filter]");
    if(f){
      st.filters[f.getAttribute("data-vd-filter")] = f.value;
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
    var row = e.target.closest ? e.target.closest("tr[data-open-task], tr[data-vd-demand], tr[data-vd-milestone], tr[data-vd-tool], tr[data-stage-drill]") : null;
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