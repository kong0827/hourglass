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
import { enterBranchesView, loadBranches, renderBranches } from "../views/branches.js";
import { enterCalendarView, loadCalendar } from "../views/calendar.js";
import { enterListView, loadList } from "../views/list.js";
import { enterMineView } from "../views/mine.js";

var activeView = "board";
/* 低频视图：第一次进入时才拉取模块（视图代码已按 views/*.js 拆分） */
var settingsTabPending = null;
function lazyEnter(name, method){
  return function(isCurrent){
    return loadView(name).then(function(m){
      if(isCurrent && !isCurrent()) return m;
      m[method]();
      return m;
    });
  };
}
function enterRequirementsLazy(isCurrent){
  return loadView("requirements").then(function(m){
    if(!isCurrent || isCurrent()) m.enterRequirementsView();
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
  mine:     { title:"我的工作", sub:"跨空间汇总「分派给我」的待办（按账号归属）", enter:enterMineView },
  board:    { title:"工作项", sub:"看板视图：按列流转；同组可切到列表、日历与甘特", enter:null },
  list:     { title:"工作项", sub:"列表视图：沿用当前筛选，点击行打开详情抽屉", enter:enterListView },
  calendar: { title:"工作项", sub:"日历视图：按 [开始日期, 实际结束日] 逐日铺开", enter:enterCalendarView },
  gantt:    { title:"工作项", sub:"甘特视图：按开始/截止日期排布；拖动条改期", enter:lazyEnter("gantt", "enterGanttView") },
  projects: { title:"项目", sub:"项目列表与全局健康度；点项目名进入项目驾驶舱", enter:lazyEnter("projects", "enterProjectsView") },
  phase:    { title:"版本", sub:"按阶段或版本看投入、偏差与准时率；可切换全部项目做首版与迭代对比", enter:lazyEnter("phase", "enterPhaseView") },
  demands:  { title:"需求池",   sub:"原始需求、评审与排期：待评审 → 已通过 → 已排期；拒绝后可重新打开", enter:lazyEnter("demands", "enterDemandsView") },
  requirements: { title:"文档", sub:"需求文档、技术方案与测试验收：支持多级文档树，可关联需求与工作项", enter:enterRequirementsLazy },
  testcases: { title:"测试", sub:"一条质量链路：用例 → 测试计划 → 覆盖矩阵 → 测试报告", enter:lazyEnter("testcases", "enterTestCasesView") },
  branches: { title:"分支", sub:"一条分支从开发到发布：改状态就留时间，谁卡在哪一步一眼看到", enter:enterBranchesView },
  review:   { title:"周回顾", sub:"按周自动总结完成与进展", enter:lazyEnter("review", "enterReviewView") },
  analysis: { title:"报表", sub:"团队节奏与质量体检：趋势、完成记录、流程体检，同一周期口径", enter:lazyEnter("analysis", "enterAnalysisView") },
  portfolio: { title:"项目", sub:"一屏看全部项目：健康度、逾期与本周投入；点项目名进入驾驶舱", enter:lazyEnter("portfolio", "enterPortfolioView") },
  project: { title:"项目驾驶舱", sub:"单项目首页：进度、工时、工作项分布、史诗与成员负载", enter:lazyEnter("project", "enterProjectView") },
  workload: { title:"成员负载", sub:"跨项目剩余工时容量与本周计时", enter:lazyEnter("workload", "enterWorkloadView") },
  risks: { title:"逾期与阻塞", sub:"逾期、阻塞、停滞工作项与站内催办", enter:lazyEnter("risks", "enterRisksView") },
  report: { title:"报表", sub:"交付图表：燃尽、速度、累积流与交付周期", enter:lazyEnter("report", "enterReportView") },
  messages: { title:"消息", sub:"站内通知与截止提醒；与右上角通知中心同一数据", enter:lazyEnter("messages", "enterMessagesView") },
  settings: { title:"设置",     sub:"空间、成员与权限、工作流、通知与集成、数据与审计", enter:enterSettingsLazy },
  profile:  { title:"个人设置", sub:"账号信息、计时规则、AI 额度与密码", enter:lazyEnter("profile", "enterProfileView") }
};
/* 视图 → 侧栏一级入口。多个视图共用一个入口时，靠页内子导航切换 */
var NAV_OF = {
  mine:"mine", review:"review",
  demands:"demands", projects:"projects", portfolio:"projects", project:"projects", phase:"phase",
  board:"workitems", list:"workitems", calendar:"workitems", gantt:"workitems",
  requirements:"requirements", testcases:"testcases", branches:"branches",
  analysis:"insight", report:"insight",
  workload:"workload", risks:"risks"
};
/* 点击一级入口落到的默认视图；workitems / insight 记住上次用过的视图 */
var NAV_HOME = {
  mine:"mine", review:"review", demands:"demands", projects:"projects", phase:"phase",
  workitems:"board", requirements:"requirements", testcases:"testcases", branches:"branches",
  insight:"analysis", workload:"workload", risks:"risks"
};
var navMemo = { workitems:"board", insight:"analysis" };
/* 同一业务域内的视图切换：放页内子导航，不占一级菜单 */
var SUBNAV = {
  workitems: [
    { view:"board", label:"看板", title:"按状态分列，拖拽流转" },
    { view:"list", label:"列表", title:"表格字段、分组排序与批量操作" },
    { view:"calendar", label:"日历", title:"按日期铺开，格子可新建" },
    { view:"gantt", label:"甘特", title:"依赖、里程碑与基线" }
  ],
  projects: [
    { view:"projects", label:"项目列表", title:"全部项目与新建入口" },
    { view:"portfolio", label:"全局健康度", title:"一屏看全部项目：健康度、逾期与本周投入" }
  ],
  testcases: [
    { view:"testcases", tab:"cases", label:"用例", title:"用例库：录入、筛选与标记执行结果" },
    { view:"testcases", tab:"plans", label:"测试计划", title:"从用例库圈选一批，按版本留痕" },
    { view:"testcases", tab:"coverage", label:"覆盖矩阵", title:"按需求看用例覆盖与通过率" },
    { view:"testcases", tab:"report", label:"测试报告", title:"当前项目通过率、失败清单与覆盖汇总" }
  ],
  insight: [
    { view:"analysis", tab:"stats", label:"趋势与分布", title:"新增与完成趋势、工时分布" },
    { view:"analysis", tab:"completions", label:"完成记录", title:"按周期查看已完成工作项" },
    { view:"analysis", tab:"flow", label:"流程体检", title:"一次通过率、需求开工延迟与估时准确度" },
    { view:"report", label:"交付图表", title:"燃尽、速度、累积流与交付周期" }
  ]
};
/* 详情页归属的父级子导航项：驾驶舱从项目列表进入，用父项标出所在分区 */
var SUBNAV_PARENT = { project:"projects" };
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
  board: "board", list: "board", calendar: "board", gantt: "board", branches: "board",
  projects: "projects", requirements: "projects", demands: "projects", testcases: "projects",
  portfolio: "projects", project: "projects", phase: "projects",
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
  if(nav){
    nav.querySelectorAll("[data-view]").forEach(function(b){
      var on = b.dataset.view === navKey;
      b.classList.toggle("on", on);
      if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
  }
  renderSubnav(name);
  var sideSet = $("sideSettings");
  if(sideSet) sideSet.classList.toggle("on", name === "settings");
  document.querySelectorAll(".view").forEach(function(s){
    s.classList.toggle("on", s.id === "view-" + name);
  });
  restoreScroll(name);
  if(viewTitle) viewTitle.textContent = VIEWS[name].title;
  document.title = VIEWS[name].title + " · 沙漏";
  syncDocTitle();
  updateBrand();
  window.dispatchEvent(new CustomEvent("ds:view-change", { detail: { view: name } }));
  UI.closeAllPops();
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
}
var subNavEl = $("subNav");
if(subNavEl) subNavEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-sub-view]");
  if(!b) return;
  var view = b.dataset.subView, tab = b.dataset.subTab;
  if(view === "analysis" && tab) rt.analysisTab = tab;
  if(view === "testcases" && tab){
    loadView("testcases").then(function(m){ m.setTcMode(tab); updateSubnavState(); });
    return;
  }
  if(view === activeView){
    if(view === "analysis" && tab) loadView("analysis").then(function(m){ m.setAnalysisTab(tab); });
    updateSubnavState();
    return;
  }
  showView(view);
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
  /* pushState：让浏览器后退能回到上一个视图；file:// 等受限环境降级为直接改 hash */
  try{ history.pushState(null, "", h); }
  catch(e){ try{ window.location.hash = h; }catch(e2){ /* 完全不可用则忽略 */ } }
}
window.addEventListener("popstate", function(){
  var n = viewFromHash();
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
  }
  /* 返回到带 ?task= 的历史项时直接打开对应任务 */
  handleDeepLink();
});
function refreshActiveView(opts){
  /* 看板在 SSE 流程里已由 refreshBoardPreserving 刷新，这里只在手动下拉刷新时兜底 */
  if(activeView === "board"){ if(opts && opts.manual) loadBoard({silent:true}); }
  else if(activeView === "calendar") loadCalendar({silent:true});
  else if(activeView === "list") loadList({silent:true});
  else if(activeView === "projects") loadReqs();
  else if(activeView === "mine") window.dispatchEvent(new CustomEvent("ds:refresh-mine"));
  else if(activeView === "branches") loadBranches(true).then(renderBranches);
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
  var b = e.target.closest("[data-view]");
  if(!b) return;
  var key = b.dataset.view;
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
/* Logo 回首页：与登录后默认落点保持一致（按角色选落点） */
if(sideBrandBtn) sideBrandBtn.addEventListener("click", function(){ showView(defaultLanding()); });
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

/* 左上角品牌回首页按角色选落点：查看者没有「分派给我」的待办，直接进可读的项目列表；
   管理者先进全局健康度；成员仍是「我的工作」 */
function defaultLanding(){
  /* 个人空间没有协作分工，仍回到「我的工作」 */
  if(!rt.currentWs || rt.currentWs.type !== "shared") return "mine";
  var role = rt.currentWs.myRole;
  if(role === "viewer") return "projects";
  if(role === "owner" || role === "admin") return "portfolio";
  return "mine";
}
export { VIEWS, activeView, defaultLanding, refreshActiveView, showView, viewFromHash };
