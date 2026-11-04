/* core/router · hash 路由与视图切换 */

import { $, viewTitle } from "./dom.js";
import { updateBrand } from "./filters.js";
import { rt } from "./state.js";
import { handleDeepLink } from "./task-actions.js";
import { UI } from "./ui.js";
import { loadView, viewModule } from "./view-loader.js";
import { loadReqs, render } from "../views/board.js";
import { enterBranchesView, loadBranches, renderBranches } from "../views/branches.js";
import { enterCalendarView, loadCalendar } from "../views/calendar.js";
import { enterListView, loadList } from "../views/list.js";
import { enterMineView, loadMine } from "../views/mine.js";

var activeView = "board";
/* 低频视图：第一次进入时才拉取模块（视图代码已按 views/*.js 拆分） */
var settingsTabPending = null;
function lazyEnter(name, method){
  return function(){
    return loadView(name).then(function(m){ m[method](); return m; });
  };
}
function enterRequirementsLazy(){
  return loadView("requirements").then(function(m){ m.enterRequirementsView(); return m; });
}
function enterSettingsLazy(){
  return loadView("settings").then(function(m){
    m.enterSettingsView();
    if(settingsTabPending){ m.setSettingsTab(settingsTabPending); settingsTabPending = null; }
    return m;
  });
}
var VIEWS = {
  mine:     { title:"我的任务", sub:"跨空间汇总「分派给我」的待办（按账号归属）", enter:enterMineView },
  board:    { title:"任务看板", sub:null, enter:null },
  list:     { title:"任务列表", sub:"沿用当前筛选条件，点击行打开详情抽屉", enter:enterListView },
  calendar: { title:"日历",     sub:"按 [开始日期, 实际结束日] 逐日铺开；点任务开详情，格子可新建", enter:enterCalendarView },
  gantt:    { title:"甘特图",   sub:"按开始/截止日期排布任务；拖动条改期，拖两端调起止", enter:lazyEnter("gantt", "enterGanttView") },
  projects: { title:"项目",     sub:"把任务归入项目，筛选栏可按项目查看全部工作", enter:lazyEnter("projects", "enterProjectsView") },
  phase:    { title:"版本阶段", sub:"按阶段或版本看投入、偏差与准时率；可切换全部项目做首版与迭代对比", enter:lazyEnter("phase", "enterPhaseView") },
  demands:  { title:"需求池",   sub:"原始需求、评审与排期：待评审 → 已通过 → 已排期；拒绝后可重新打开", enter:lazyEnter("demands", "enterDemandsView") },
  requirements: { title:"文档", sub:"需求文档、技术方案与测试验收：支持多级文档树，可关联需求与工作项", enter:enterRequirementsLazy },
  branches: { title:"分支", sub:"一条分支从开发到发布：改状态就留时间，谁卡在哪一步一眼看到", enter:enterBranchesView },
  review:   { title:"周回顾", sub:"按周自动总结完成与进展", enter:lazyEnter("review", "enterReviewView") },
  analysis: { title:"分析", sub:"趋势与分布 / 完成记录 / 流程体检，同一周期口径", enter:lazyEnter("analysis", "enterAnalysisView") },
  portfolio: { title:"项目总览", sub:"全部项目的健康度、逾期与本周投入；点项目名进入项目看板", enter:lazyEnter("portfolio", "enterPortfolioView") },
  project: { title:"项目看板", sub:"单项目：周期、工时、任务分布、Epic 与成员负载", enter:lazyEnter("project", "enterProjectView") },
  workload: { title:"成员负载", sub:"跨项目剩余工时容量与本周计时", enter:lazyEnter("workload", "enterWorkloadView") },
  risks: { title:"逾期与阻塞", sub:"逾期、阻塞、停滞任务与站内催办", enter:lazyEnter("risks", "enterRisksView") },
  report: { title:"报表中心", sub:"燃尽、速度、累积流与交付周期", enter:lazyEnter("report", "enterReportView") },
  settings: { title:"设置",     sub:"空间、成员与邀请、看板列、分类与数据管理", enter:enterSettingsLazy },
  profile:  { title:"个人设置", sub:"账号信息、计时规则、AI 额度与密码", enter:lazyEnter("profile", "enterProfileView") }
};
function showView(name){
  /* IA-5：旧入口并入设置页 tabs —— 回收站→数据、用户管理→账号 */
  if(name === "trash"){ settingsTabPending = "data"; showView("settings"); return; }
  if(name === "users"){ settingsTabPending = "account"; showView("settings"); return; }
  /* IA-1：旧入口并入「分析」的三个 tab */
  if(name === "stats" || name === "completions" || name === "flow"){
    rt.analysisTab = name; showView("analysis"); return;
  }
  if(!VIEWS[name]) return;
  activeView = name;
  document.body.dataset.view = name;
  var nav = $("sideNav");
  var navKey = name === "project" ? "portfolio" : name;
  if(nav){
    nav.querySelectorAll("[data-view]").forEach(function(b){
      var on = b.dataset.view === navKey;
      b.classList.toggle("on", on);
      if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
  }
  var sideSet = $("sideSettings");
  if(sideSet) sideSet.classList.toggle("on", name === "settings");
  document.querySelectorAll(".view").forEach(function(s){
    s.classList.toggle("on", s.id === "view-" + name);
  });
  if(viewTitle) viewTitle.textContent = VIEWS[name].title;
  document.title = VIEWS[name].title + " · 工作台";
  updateBrand();
  UI.closeAllPops();
  syncViewHash(name);
  try{ localStorage.setItem("ds.view", name); }catch(e){ /* 隐私模式忽略 */ }
  var entered = VIEWS[name].enter ? VIEWS[name].enter() : null;
  /* 看板不在当前视图时只置脏，切回来再渲染一次 */
  if(name === "board" && rt.boardDirty){ rt.boardDirty = false; render({animate:false}); }
  return entered;
}
function viewFromHash(){
  var name = String(window.location.hash || "").replace(/^#\/?/, "");
  var legacy = {trash:1, users:1, stats:1, completions:1, flow:1};
  return (VIEWS[name] || legacy[name]) ? name : "board";
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
function refreshActiveView(){
  if(activeView === "calendar") loadCalendar({silent:true});
  else if(activeView === "list") loadList({silent:true});
  else if(activeView === "projects") loadReqs();
  else if(activeView === "mine") loadMine({silent:true});
  else if(activeView === "branches") loadBranches(true).then(renderBranches);
  else if(activeView === "gantt") loadView("gantt").then(function(m){ m.loadGantt({silent:true}); });
  else if(activeView === "analysis") loadView("analysis").then(function(m){ m.refreshAnalysisTab(true); });
  else if(activeView === "requirements") loadView("requirements").then(function(m){ m.loadReqDocs(); });
  else if(activeView === "phase") loadView("phase").then(function(m){ m.enterPhaseView(); });
  else if(activeView === "demands") loadView("demands").then(function(m){ m.enterDemandsView(); });
  else if(activeView === "portfolio") loadView("portfolio").then(function(m){ m.loadPortfolio({silent:true}); });
  else if(activeView === "project") loadView("project").then(function(m){ m.loadProject({silent:true}); });
  else if(activeView === "workload") loadView("workload").then(function(m){ m.loadWorkload({silent:true}); });
  else if(activeView === "risks") loadView("risks").then(function(m){ m.loadRisks({silent:true}); });
  else if(activeView === "report") loadView("report").then(function(m){ m.loadReport({silent:true}); });
  else if(activeView === "settings"){
    loadView("settings").then(function(m){
      if(m.settingsTab === "data") m.loadTrash({silent:true});
      if(m.settingsTab === "account") m.loadUsers(true);
    });
  }
}
$("sideNav").addEventListener("click", function(e){
  /* MOB-1：底部 tab 的「更多」 */
  if(e.target.closest("#mobMore")){ openMobMore(); return; }
  var b = e.target.closest("[data-view]");
  if(b) showView(b.dataset.view);
});
var sideSettingsBtn = $("sideSettings");
if(sideSettingsBtn) sideSettingsBtn.addEventListener("click", function(){ showView("settings"); });
function openMobMore(){
  var btn = $("mobMore");
  var menu = $("mobMoreMenu");
  if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
  if(!menu){
    menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "mobMoreMenu";
    menu.innerHTML = [["demands","需求池"],["list","任务列表"],["gantt","甘特图"],["analysis","分析"],["portfolio","项目总览"],["phase","版本阶段"],["workload","成员负载"],["risks","逾期与阻塞"],["report","报表中心"],["projects","项目"],["requirements","文档"],["branches","分支"],["settings","设置"],["profile","个人设置"]]
      .map(function(x){ return '<button class="menu-item" type="button" data-mob-view="' + x[0] + '">' + x[1] + '</button>'; }).join("");
    document.body.appendChild(menu);
    menu.addEventListener("click", function(ev){
      var mb = ev.target.closest("[data-mob-view]");
      if(!mb) return;
      UI.closeAllPops();
      showView(mb.dataset.mobView);
    });
  }
  UI.openPop(menu, btn, {align:"right"});
}

export { VIEWS, activeView, refreshActiveView, showView, viewFromHash };
