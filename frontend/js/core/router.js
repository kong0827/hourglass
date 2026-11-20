/* core/router · hash 路由与视图切换 */

import { $, viewTitle } from "./dom.js";
import { updateBrand } from "./filters.js";
import { syncDocTitle } from "./notifications.js";
import { loadPriorities } from "./priorities.js";
import { rt } from "./state.js";
import { handleDeepLink } from "./task-actions.js";
import { UI } from "./ui.js";
import { loadView, viewModule } from "./view-loader.js";
import { loadBoard, loadReqs, render } from "../views/board.js";
import { enterCalendarView, loadCalendar } from "../views/calendar.js";
import { enterListView, loadList } from "../views/list.js";
import { enterMineView } from "../views/mine.js";

var activeView = "board";
/* 低频视图：第一次进入时才拉取模块（视图代码已按 views/*.js 拆分） */
var settingsTabPending = null;
var settingsTabActive = "space";
window.addEventListener("ds:settings-tab", function(e){
  settingsTabActive = (e.detail || "space");
  if(activeView === "settings") syncNavState("settings");
});
function lazyEnter(name, method){
  return function(isCurrent){
    /* 模块尚未在内存中时才给全局进度指示；已加载的切换保持零延迟观感 */
    var pending = !viewModule(name);
    if (pending) UI.chunkBusy(true);
    return loadView(name).then(function(m){
      if (pending) UI.chunkBusy(false);
      if(isCurrent && !isCurrent()) return m;
      m[method]();
      return m;
    }, function(err){
      if (pending) UI.chunkBusy(false);
      throw err;
    });
  };
}
function enterRequirementsLazy(isCurrent){
  return loadView("requirements").then(function(m){
    if(!isCurrent || isCurrent()) m.enterRequirementsView();
    return m;
  });
}
/* 文档历史是 requirements 的子页：同一模块渲染，只换外层页面壳 */
function enterDocHistoryLazy(isCurrent){
  return loadView("requirements").then(function(m){
    if(isCurrent && !isCurrent()) return m;
    m.enterDocHistoryView();
    return m;
  });
}
function enterSettingsLazy(isCurrent){
  return loadView("settings").then(function(m){
    if(isCurrent && !isCurrent()) return m;
    m.enterSettingsView();
    if(settingsTabPending){ m.setSettingsTab(settingsTabPending); settingsTabPending = null; }
    return m;
  });
}
var VIEWS = {
  mine:     { title:"我的工作", sub:"分派给我与参与中的工作项，按截止时间排列", enter:enterMineView },
  board:    { title:"工作项", sub:"按状态分列，拖拽卡片流转", enter:null },
  workcolumn: { title:"工作项", sub:"单列聚焦，逐条推进状态", enter:lazyEnter("workcolumn", "enterWorkColumn") },
  canceled: { title:"工作项", sub:"已取消的终态工作项归档", enter:lazyEnter("canceled", "enterCanceledView") },
  list:     { title:"工作项", sub:"表格字段、分组排序与批量操作", enter:enterListView },
  tree:     { title:"工作项", sub:"按项目 / 版本 / 分类缩进查看层级", enter:lazyEnter("tree", "enterTreeView") },
  chain:    { title:"工作项", sub:"沿依赖关系查看影响链", enter:lazyEnter("chain", "enterChainView") },
  calendar: { title:"工作项", sub:"按截止日期查看排期", enter:enterCalendarView },
  gantt:    { title:"工作项", sub:"时间轴与依赖关系总览", enter:lazyEnter("gantt", "enterGanttView") },
  projects: { title:"项目", sub:"项目集下的项目与全局健康度", enter:lazyEnter("projects", "enterProjectsView") },
  phase:    { title:"版本", sub:"版本计划、工作项范围与交付情况", enter:lazyEnter("phase", "enterPhaseView") },
  version:  { title:"版本详情", sub:"计划与实际、工时构成与发布记录", enter:lazyEnter("version", "enterVersionView") },
  release:  { title:"发布计划", sub:"跨版本的发布窗口与执行记录", enter:lazyEnter("release", "enterReleaseView") },
  delivery: { title:"交付说明", sub:"面向使用方的变更说明", enter:lazyEnter("delivery", "enterDeliveryView") },
  demands:  { title:"需求池", sub:"未进入版本的需求与来源", enter:lazyEnter("demands", "enterDemandsView") },
  requirements: { title:"文档", sub:"空间文档、分类与协作记录", enter:enterRequirementsLazy },
  dochistory: { title:"文档历史", sub:"历史版本的正文与修订", enter:enterDocHistoryLazy },
  testcases: { title:"测试", sub:"用例、计划与执行结果", enter:lazyEnter("testcases", "enterTestCasesView") },
  branches: { title:"分支", sub:"分支与工作项的关联 · 阶段与停留时间来自状态变更", enter:lazyEnter("branches", "enterBranchesView") },
  review:   { title:"周回顾", sub:"本周完成、进行中与风险", enter:lazyEnter("review", "enterReviewView") },
  analysis: { title:"报表", sub:"交付与投入的统计口径", enter:lazyEnter("analysis", "enterAnalysisView") },
  portfolio: { title:"项目", sub:"项目集与项目的全局视图", enter:lazyEnter("portfolio", "enterPortfolioView") },
  project: { title:"项目驾驶舱", sub:"项目范围、排期与风险一览", enter:lazyEnter("project", "enterProjectView") },
  workload: { title:"成员负载", sub:"成员在计划窗口内外的工时", enter:lazyEnter("workload", "enterWorkloadView") },
  risks: { title:"逾期与阻塞", sub:"需要关注的工作项与原因", enter:lazyEnter("risks", "enterRisksView") },
  report: { title:"报表", sub:"交付与投入的统计口径", enter:lazyEnter("report", "enterReportView") },
  investment: { title:"报表", sub:"交付与投入的统计口径", enter:lazyEnter("investment", "enterInvestmentView") },
  messages: { title:"消息中心", sub:"通知与 @ 提醒", enter:lazyEnter("messages", "enterMessagesView") },
  settings: { title:"设置", sub:"空间配置、成员与可见范围", enter:enterSettingsLazy },
  profile:  { title:"个人设置", sub:"账号、计时与密码", enter:lazyEnter("profile", "enterProfileView") }
};
/* 视图 → 侧栏一级入口。多个视图共用一个入口时，靠页内子导航切换 */
var NAV_OF = {
  mine:"mine", review:"review", messages:"messages",
  demands:"demands", projects:"projects", portfolio:"projects", project:"projects", phase:"phase", version:"phase", release:"phase", delivery:"delivery",
  board:"workitems", list:"workitems", tree:"workitems", chain:"workitems", calendar:"workitems", gantt:"workitems", workcolumn:"workitems", canceled:"workitems",
  requirements:"requirements", dochistory:"requirements", testcases:"testcases", branches:"branches",
  analysis:"insight", report:"insight", investment:"insight",
  workload:"workload", risks:"risks", settings:"settings"
};
/* 点击一级入口落到的默认视图；workitems / insight 记住上次用过的视图 */
var NAV_HOME = {
  mine:"mine", review:"review", messages:"messages", demands:"demands", projects:"projects", phase:"phase",
  workitems:"board", requirements:"requirements", testcases:"testcases", branches:"branches",
  insight:"analysis", workload:"workload", risks:"risks", delivery:"delivery", settings:"settings"
};
var navMemo = { workitems:"board", insight:"analysis" };
/* 同一业务域内的视图切换：放页内子导航，不占一级菜单 */
var SUBNAV = {
  workitems: [
    { view:"board", label:"看板", title:"按状态分列，拖拽流转" },
    { view:"list", label:"列表", title:"表格字段、分组排序与批量操作" },
    { view:"tree", label:"层级", title:"按项目/版本/分类缩进，父级进度自动聚合" },
    { view:"chain", label:"影响链", title:"沿前置/后继依赖展开，动一个看一串" },
    { view:"calendar", label:"日历", title:"按日期铺开，格子可新建" },
    { view:"gantt", label:"甘特", title:"依赖、里程碑与基线" }
  ],
  projects: [
    { view:"projects", label:"项目列表", title:"全部项目与新建入口" },
    { view:"portfolio", label:"全局健康度", title:"一屏看全部项目：健康度、逾期与本周投入" }
  ],
  testcases: [
    { view:"testcases", tab:"cases", label:"用例", title:"用例库：录入、筛选与标记执行结果" },
    { view:"testcases", tab:"defects", label:"缺陷", title:"按缺陷收敛质量问题：默认未关闭，按严重度排序" },
    { view:"testcases", tab:"plans", label:"测试计划", title:"从用例库圈选一批，按版本留痕" },
    { view:"testcases", tab:"coverage", label:"覆盖矩阵", title:"按需求看用例覆盖与通过率" },
    { view:"testcases", tab:"report", label:"测试报告", title:"当前项目通过率、失败清单与覆盖汇总" }
  ],
  insight: [
    { view:"analysis", tab:"stats", label:"趋势与分布", title:"新增与完成趋势、工时分布" },
    { view:"analysis", tab:"completions", label:"完成记录", title:"按周期查看已完成工作项" },
    { view:"analysis", tab:"flow", label:"流程体检", title:"一次通过率、需求开工延迟与估时准确度" },
    { view:"report", label:"交付图表", title:"燃尽、速度、累积流与交付周期" },
    { view:"investment", label:"投入结构", title:"按年度 / 季度看人力、工时与资源分布" }
  ]
};
/* 详情页归属的父级子导航项：驾驶舱从项目列表进入，用父项标出所在分区 */
var SUBNAV_PARENT = { project:"projects", workcolumn:"board", canceled:"board" };
/* 移动端「更多视图」的分组顺序，与侧栏保持一致 */
var NAV_GROUPS = [
  { title:"我的", items:[["review","周回顾"]] },
  { title:"规划", items:[["demands","需求池"],["phase","版本"]] },
  { title:"交付", items:[["requirements","文档"],["testcases","测试"],["branches","分支"]] },
  { title:"洞察", items:[["insight","报表"],["workload","成员负载"],["risks","逾期与阻塞"]] },
  { title:"", items:[["settings","设置"]] }
];
var TAB_OF = {
  mine: "mine", review: "mine",
  board: "board", list: "board", calendar: "board", gantt: "board", branches: "board", workcolumn: "board", canceled: "board",
  projects: "projects", requirements: "projects", dochistory: "projects", demands: "projects", testcases: "projects",
  portfolio: "projects", project: "projects", phase: "projects", version: "projects", delivery: "projects",
  messages: "messages",
  settings: "me", profile: "me"
};
function syncTab(name){
  var bar = document.getElementById("tabBar");
  if(!bar) return;
  var want = Object.prototype.hasOwnProperty.call(TAB_OF, name) ? TAB_OF[name] : "";
  bar.querySelectorAll("[data-tab]").forEach(function(b){
    var on = b.dataset.tab === want;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
}
/* ---------- 跨视图返回：从详情跳到文档 / 用例等页面后，左下角留一条回到来源的入口 ---------- */
var returnOrigin = null;
function returnPillEl(){
  var el = document.getElementById("returnOrigin");
  if(el) return el;
  el = document.createElement("div");
  el.id = "returnOrigin";
  el.className = "return-origin";
  el.hidden = true;
  el.innerHTML =
    '<button class="return-origin-go" type="button" title="回到来源页面">'
    + '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10H4"/><path d="m9 5-5 5 5 5"/></svg>'
    + '<span>返回</span><b data-return-label></b></button>'
    + '<button class="return-origin-x" type="button" aria-label="关闭返回入口" title="关闭">'
    + '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>'
    + '</button>';
  el.addEventListener("click", function(e){
    if(e.target.closest(".return-origin-x")){ setReturnOrigin(null); return; }
    if(!e.target.closest(".return-origin-go")) return;
    var origin = returnOrigin;
    if(!origin) return;
    var entered = showView(origin.view);
    Promise.resolve(entered).then(function(){
      /* 被「未保存改动」守卫拦下时仍停在目标页，保留入口，别丢掉原来的返回位置 */
      if(activeView !== origin.view) return;
      setReturnOrigin(null);
      if(origin.restore) origin.restore();
    });
  });
  document.body.appendChild(el);
  return el;
}
function syncReturnPill(){
  var el = returnPillEl();
  if(!returnOrigin || activeView === returnOrigin.view){ el.hidden = true; return; }
  var label = el.querySelector("[data-return-label]");
  if(label){
    label.textContent = returnOrigin.label
      || (VIEWS[returnOrigin.view] && VIEWS[returnOrigin.view].title) || "上一页";
  }
  el.hidden = false;
}
/* origin: { view, label, restore? }；restore 在回到来源视图后执行，用来重开原抽屉 */
function setReturnOrigin(origin){
  returnOrigin = origin || null;
  syncReturnPill();
}

var routeSeq = 0;
var scrollMemo = Object.create(null);
function saveScroll(){
  var cur = document.querySelector(".view.on");
  if(cur) scrollMemo[cur.id] = cur.scrollTop || 0;
}
function restoreScroll(name){
  var el = document.getElementById("view-" + name);
  if(!el) return;
  el.scrollTop = scrollMemo["view-" + name] || 0;
  requestAnimationFrame(function(){ el.scrollTop = scrollMemo["view-" + name] || 0; });
}
function syncNavState(name){
  var nav = $("sideNav");
  if(!nav) return;
  var navKey = NAV_OF[name] || "";
  nav.querySelectorAll(".nav-item[data-view]").forEach(function(b){
    var on = b.dataset.view === navKey;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  nav.querySelectorAll(".nav-sub-item").forEach(function(b){
    var on = b.dataset.view === name;
    if(on && b.dataset.subTab){
      if(name === "testcases") on = b.dataset.subTab === subnavCurrentTab("testcases");
      else if(name === "analysis") on = b.dataset.subTab === rt.analysisTab;
    }
    if(on && b.dataset.setNav) on = name === "settings" && b.dataset.setNav === settingsTabActive;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  nav.querySelectorAll(".nav-group").forEach(function(g){
    var open = !!g.querySelector(".nav-item.on");
    g.classList.toggle("open", open);
    var exp = g.querySelector(".nav-exp");
    if(exp) exp.setAttribute("aria-expanded", open ? "true" : "false");
  });
}
function showView(name){
  /* 兼容旧入口：回收站→数据与审计、用户管理→平台 */
  if(name === "trash"){ settingsTabPending = "data"; showView("settings"); return; }
  if(name === "users"){ settingsTabPending = "account"; showView("settings"); return; }
  /* 兼容旧入口：分析页的三个页签 */
  if(name === "stats" || name === "completions" || name === "flow"){
    rt.analysisTab = name; showView("analysis"); return;
  }
  if(!VIEWS[name]) return;
  /* 路由守卫：先让正在编辑的浮层决定是否放行（如任务抽屉有未保存改动） */
  if(activeView && activeView !== name){
    var guard = new CustomEvent("ds:before-route", {cancelable:true, detail:{from:activeView, to:name}});
    if(!window.dispatchEvent(guard)){
      try{ history.replaceState(null, "", "#/" + activeView); }catch(e){ /* noop */ }
      /* 跳转被拦下：保留返回入口，处理完未保存改动后还能再点一次 */
      return Promise.resolve(null);
    }
  }
  var seq = ++routeSeq;
  /* 路由切换统一收口：弹窗不跟随新页面残留（抽屉由 ds:before-route 监听方自行关闭） */
  document.querySelectorAll(".modal-layer.open").forEach(function(m){ UI.closeModal(m); });
  function isCurrent(){ return seq === routeSeq && activeView === name; }
  saveScroll();
  activeView = name;
  document.body.dataset.view = name;
  syncTab(name);
  var navKey = NAV_OF[name] || "";
  /* 记住多视图业务域上次查看的视图，再点一级入口时回到那里 */
  if(navKey === "workitems" || navKey === "insight") navMemo[navKey] = name;
  var nav = $("sideNav");
  if(nav) syncNavState(name);
  renderSubnav(name);
  var sideSet = $("sideSettings");
  if(sideSet) sideSet.classList.toggle("on", name === "settings");
  document.querySelectorAll(".view").forEach(function(s){
    s.classList.toggle("on", s.id === "view-" + name);
  });
  restoreScroll(name);
  if(viewTitle) viewTitle.textContent = VIEWS[name].title;
  var phTitle = $("pageTitle"), phSub = $("pageSub");
  if(phTitle) phTitle.textContent = VIEWS[name].title;
  if(phSub) phSub.textContent = VIEWS[name].sub || "";
  document.title = VIEWS[name].title + " · 沙漏";
  syncDocTitle();
  updateBrand();
  window.dispatchEvent(new CustomEvent("ds:view-change", { detail: { view: name } }));
  UI.closeAllPops();
  /* 已经回到来源视图（手动导航或胶囊返回）就结束这次返回上下文，别让胶囊跟到后续页面 */
  if(returnOrigin && activeView === returnOrigin.view) setReturnOrigin(null);
  else syncReturnPill();
  syncViewHash(name);
  var entered = loadPriorities().then(function(){
    if(!isCurrent()) return null;
    return VIEWS[name].enter ? VIEWS[name].enter(isCurrent) : null;
  }).catch(function(){ return null; });
  /* 看板不在当前视图时只置脏，切回来再渲染一次 */
  if(name === "board" && rt.boardDirty){ rt.boardDirty = false; render({animate:false}); }
  return entered;
}
function subnavCurrentTab(navKey){
  if(navKey === "insight") return rt.analysisTab;
  if(navKey === "testcases"){
    var m = viewModule("testcases");
    return (m && m.currentTcMode) ? m.currentTcMode() : "cases";
  }
  return "";
}
function renderSubnav(name){
  var el = $("subNav");
  if(!el) return;
  var navKey = NAV_OF[name] || "";
  var items = SUBNAV[navKey];
  if(!items){
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  var html = items.map(function(it){
    return '<button class="subnav-item" type="button" data-sub-view="' + it.view + '"'
      + (it.tab ? ' data-sub-tab="' + it.tab + '"' : "")
      + (it.title ? ' title="' + UI.esc(it.title) + '"' : "")
      + '>' + UI.esc(it.label) + '</button>';
  }).join("");
  el.innerHTML = html;
  el.hidden = false;
  updateSubnavState(name);
}
/* 只同步高亮，不重建 DOM：同域切页签时保留按钮焦点 */
function updateSubnavState(name){
  var el = $("subNav");
  if(!el) return;
  name = name || activeView;
  var navKey = NAV_OF[name] || "";
  var items = SUBNAV[navKey];
  if(!items) return;
  var curTab = subnavCurrentTab(navKey);
  el.querySelectorAll(".subnav-item").forEach(function(b){
    var on = b.dataset.subView === name && (!b.dataset.subTab || b.dataset.subTab === curTab);
    var parent = !on && SUBNAV_PARENT[name] === b.dataset.subView;
    b.classList.toggle("on", on);
    b.classList.toggle("is-parent", parent);
    if(on) b.setAttribute("aria-current","page");
    else if(parent) b.setAttribute("aria-current","location");
    else b.removeAttribute("aria-current");
  });
  /* 页签多到需要横向滚动时（窄屏 5 个入口），把当前页签滚进可见区 */
  var current = el.querySelector(".subnav-item.on");
  if(current && el.scrollWidth > el.clientWidth){
    var cr = current.getBoundingClientRect(), er = el.getBoundingClientRect();
    if(cr.left < er.left) el.scrollLeft += cr.left - er.left - 8;
    else if(cr.right > er.right) el.scrollLeft += cr.right - er.right + 8;
  }
}
var subNavEl = $("subNav");
if(subNavEl) subNavEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-sub-view]");
  if(!b) return;
  var view = b.dataset.subView, tab = b.dataset.subTab;
  if(view === "analysis" && tab) rt.analysisTab = tab;
  if(view === "testcases" && tab){
    loadView("testcases").then(function(m){ m.setTcMode(tab); updateSubnavState(); syncNavState("testcases"); });
    return;
  }
  if(view === activeView){
    if(view === "analysis" && tab){ loadView("analysis").then(function(m){ m.setAnalysisTab(tab); }); syncNavState("analysis"); }
    updateSubnavState();
    return;
  }
  showView(view);
});
/* 窄屏旋转 / 窗口变窄后页签可能溢出，重新把当前页签带进可见区 */
window.addEventListener("resize", function(){
  if(activeView) updateSubnavState(activeView);
});

function viewFromHash(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var q = raw.indexOf("?");
  var name = q >= 0 ? raw.substring(0, q) : raw;
  var legacy = {trash:1, users:1, stats:1, completions:1, flow:1};
  if(VIEWS[name] || legacy[name]) return name;
  /* 无 hash 时固定落「我的工作」：登录首屏对所有角色一致 */
  return "mine";
}
var suppressHashSync = false;
function syncViewHash(name){
  if(suppressHashSync) return;
  var h = "#/" + name;
  if(window.location.hash === h) return;
  /* 分支、工作项列、需求主状态工作页、版本详情与文档深链：保留查询参数，避免 showView 抹掉下钻位置；
     phase/testcases/requirements/branches/demands 还承载全局「新建」菜单的 ?new=1 跨视图创建参数 */
  if((name === "branches" || name === "workcolumn" || name === "canceled" || name === "demands" || name === "version" || name === "release" || name === "requirements" || name === "dochistory" || name === "workload" || name === "phase" || name === "testcases")
      && String(window.location.hash || "").indexOf(h + "?") === 0) return;
  /* pushState：让浏览器后退能回到上一个视图；file:// 等受限环境降级为直接改 hash */
  try{ history.pushState(null, "", h); }
  catch(e){ try{ window.location.hash = h; }catch(e2){ /* 完全不可用则忽略 */ } }
}
var demandRouteHash = "";
function enterDemandRoute(){
  demandRouteHash = String(window.location.hash || "");
  loadView("demands").then(function(m){
    if(viewFromHash() === "demands") m.enterDemandsView();
  });
}
window.addEventListener("popstate", function(){
  var n = viewFromHash();
  if(n === "demands") demandRouteHash = String(window.location.hash || "");
  /* 后退时正在编辑需求且未保存：留在编辑页并问是否保存，避免静默丢正文 */
  var reqMod = viewModule("requirements");
  if(n !== activeView && activeView === "requirements" && reqMod && reqMod.isReqDocEditing()){
    try{ history.pushState(null, "", "#/requirements"); }catch(e){ /* noop */ }
    reqMod.tryCloseReqDocEditor();
    return;
  }
  if(n !== activeView){
    suppressHashSync = true;
    try{ showView(n); } finally { suppressHashSync = false; }
  }else if(n === "workcolumn"){
    /* 同一视图内只改了 ?col=&range=：把 hash 变化交给工作页自己处理 */
    var wcMod = viewModule("workcolumn");
    if(wcMod && wcMod.refreshFromHash) wcMod.refreshFromHash();
  }else if(n === "canceled"){
    /* 已取消页只按 ?reason= 切原因：交给页面自己重取，不整页重进 */
    var cnMod = viewModule("canceled");
    if(cnMod && cnMod.refreshFromHash) cnMod.refreshFromHash();
  }else if(n === "version"){
    /* 同一版本内换页签 / 改筛选，或后退到另一个版本：都交给详情页对齐 */
    var vdMod = viewModule("version");
    if(vdMod && vdMod.refreshFromHash) vdMod.refreshFromHash();
  }else if(n === "release"){
    /* 发布工作台：后退/前进换页签或换版本都交给子页对齐，不整页重进 */
    var relMod = viewModule("release");
    if(relMod && relMod.refreshFromHash) relMod.refreshFromHash();
  }else if(n === "dochistory"){
    /* 文档历史：后退/前进换版本或视图，交给子页对齐 */
    var rhMod = viewModule("requirements");
    if(rhMod && rhMod.refreshDocHistoryFromHash) rhMod.refreshDocHistoryFromHash();
  }else if(n === "workload"){
    /* 成员负载：后退/前进在名册与成员工作台之间切换，交给子页对齐 */
    var wlMod = viewModule("workload");
    if(wlMod && wlMod.refreshFromHash) wlMod.refreshFromHash();
  }else if(n === "demands"){
    enterDemandRoute();
  }
  /* 返回到带 ?task= 的历史项时直接打开对应任务 */
  handleDeepLink();
});
window.addEventListener("hashchange", function(){
  if(viewFromHash() === "release" && activeView === "release"){
    var relMod = viewModule("release");
    if(relMod && relMod.refreshFromHash) relMod.refreshFromHash();
    return;
  }
  if(viewFromHash() === "dochistory" && activeView === "dochistory"){
    var rhMod = viewModule("requirements");
    if(rhMod && rhMod.refreshDocHistoryFromHash) rhMod.refreshDocHistoryFromHash();
    return;
  }
  if(activeView !== "demands" || viewFromHash() !== "demands") return;
  if(String(window.location.hash || "") === demandRouteHash) return;
  enterDemandRoute();
});
function refreshActiveView(opts){
  /* 看板在 SSE 流程里已由 refreshBoardPreserving 刷新，这里只在手动下拉刷新时兜底 */
  if(activeView === "board"){ if(opts && opts.manual) loadBoard({silent:true}); }
  else if(activeView === "calendar") loadCalendar({silent:true});
  else if(activeView === "list") loadList({silent:true, keepLoaded:true});
  else if(activeView === "projects") loadReqs();
  else if(activeView === "mine") window.dispatchEvent(new CustomEvent("ds:refresh-mine"));
  else if(activeView === "branches") loadView("branches").then(function(m){ m.loadBranches(true).then(m.renderBranches); });
  else if(activeView === "gantt") loadView("gantt").then(function(m){ m.loadGantt({silent:true}); });
  else if(activeView === "analysis") loadView("analysis").then(function(m){ m.refreshAnalysisTab(true); });
  else if(activeView === "requirements") loadView("requirements").then(function(m){ m.loadReqDocs(!!(opts && opts.manual)); });
  else if(activeView === "testcases") loadView("testcases").then(function(m){ m.enterTestCasesView(); });
  else if(activeView === "phase") loadView("phase").then(function(m){ m.enterPhaseView(); });
  else if(activeView === "demands") loadView("demands").then(function(m){ m.enterDemandsView(); });
  else if(activeView === "portfolio") loadView("portfolio").then(function(m){ m.loadPortfolio({silent:true}); });
  else if(activeView === "project") loadView("project").then(function(m){ m.loadProject({silent:true}); });
  else if(activeView === "workload") loadView("workload").then(function(m){ m.loadWorkload({silent:true}); });
  else if(activeView === "risks") loadView("risks").then(function(m){ m.loadRisks({silent:true}); });
  else if(activeView === "report") loadView("report").then(function(m){ m.loadReport({silent:true}); });
  else if(activeView === "investment") loadView("investment").then(function(m){ m.loadInvestment({silent:true}); });
  else if(activeView === "messages") loadView("messages").then(function(m){ m.enterMessagesView(); });
  else if(activeView === "settings"){
    loadView("settings").then(function(m){
      if(m.settingsTab === "data") m.loadTrash({silent:true});
      if(m.settingsTab === "platform") m.refreshPlatformTab();
    });
  }
}
$("sideNav").addEventListener("click", function(e){
  /* MOB-1：底部 tab 的「更多」 */
  if(e.target.closest("#mobMore")){ openMobMore(); return; }
  /* SHELL-1：父项展开/收起，不触发页面跳转 */
  var exp = e.target.closest("[data-nav-exp]");
  if(exp){
    var group = exp.closest(".nav-group");
    if(group){
      var open = group.classList.toggle("open");
      exp.setAttribute("aria-expanded", open ? "true" : "false");
    }
    return;
  }
  var b = e.target.closest("[data-view]");
  if(!b) return;
  var key = b.dataset.view;
  /* 子项页签：测试/报表在业务域内切换页签，不重复进栈 */
  if(b.dataset.subTab){
    if(key === "testcases"){
      var tab = b.dataset.subTab;
      function applyTab(){ loadView("testcases").then(function(m){ m.setTcMode(tab); updateSubnavState(); syncNavState("testcases"); }); }
      if(activeView === "testcases") applyTab();
      else showView("testcases").then(applyTab);
      return;
    }
    if(key === "analysis"){
      rt.analysisTab = b.dataset.subTab;
      if(activeView === "analysis"){
        loadView("analysis").then(function(m){ m.setAnalysisTab(rt.analysisTab); });
        updateSubnavState();
        syncNavState("analysis");
        return;
      }
    }
  }
  /* 设置子项：同一视图内切换分区，不重复进栈 */
  if(b.dataset.setNav){
    var setTab = b.dataset.setNav;
    settingsTabPending = setTab;
    if(activeView === "settings"){
      loadView("settings").then(function(m){ m.setSettingsTab(setTab); settingsTabPending = null; });
    }else{
      showView("settings");
    }
    return;
  }
  /* 一级入口就是视图本身 */
  if(VIEWS[key]){ showView(key); return; }
  /* 已在本业务域内：单独点击不打断当前视图（子导航负责切换） */
  if(NAV_OF[activeView] === key) return;
  var target = navMemo[key] || NAV_HOME[key];
  if(target) showView(target);
});
var sideSettingsBtn = $("sideSettings");
if(sideSettingsBtn) sideSettingsBtn.addEventListener("click", function(){ showView("settings"); });
var sideBrandBtn = $("sideBrand");
/* Logo 回首页：与登录首屏一致，固定落「我的工作」 */
if(sideBrandBtn) sideBrandBtn.addEventListener("click", function(){ showView("mine"); });
/* 底栏已覆盖的入口不再放进「更多视图」；分组与侧栏一致，设置置底 */
function moreMenuHTML(){
  return NAV_GROUPS.map(function(g){
    var items = g.items.map(function(it){
      return '<button class="menu-item" type="button" data-nav-key="' + it[0] + '">' + UI.esc(it[1]) + '</button>';
    }).join("");
    if(!items) return "";
    return (g.title ? '<div class="menu-sec">' + UI.esc(g.title) + '</div>' : "") + items;
  }).join("");
}
function openMobMore(anchor){
  var btn = anchor || $("mobMore");
  if(!btn) return;
  var menu = $("mobMoreMenu");
  if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
  if(!menu){
    menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "mobMoreMenu";
    menu.innerHTML = moreMenuHTML();
    document.body.appendChild(menu);
    menu.addEventListener("click", function(ev){
      var mb = ev.target.closest("[data-nav-key]");
      if(!mb) return;
      UI.closeAllPops();
      var key = mb.dataset.navKey;
      if(VIEWS[key]){ showView(key); return; }
      var target = navMemo[key] || NAV_HOME[key];
      if(target) showView(target);
    });
  }
  UI.openPop(menu, btn, {align:"right"});
}
/* 手机顶栏「更多视图」：复用平板的视图菜单 */
var mobViewsBtn = $("btnMobViews");
if(mobViewsBtn) mobViewsBtn.addEventListener("click", function(){ openMobMore(mobViewsBtn); });

/* 移动端底部 Tab：消息落独立页面；me 落个人设置 */
window.addEventListener("ds:tab", function(e){
  var tab = e.detail && e.detail.tab;
  if(!tab) return;
  if(tab === "messages"){ showView("messages"); return; }
  if(tab === "me"){ showView("profile"); return; }
  if(tab === "board"){ showView(navMemo.workitems || "board"); return; }
  showView(tab);
});

/* 浮层确认放弃改动后，重新发起被守卫拦下的路由 */
window.addEventListener("ds:route-go", function(e){
  var to = e.detail && e.detail.view;
  if(to && VIEWS[to]) showView(to);
});

export { VIEWS, activeView, refreshActiveView, showView, viewFromHash, setReturnOrigin };
