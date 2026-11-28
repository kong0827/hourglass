/* main.js · 入口：核心与首屏模块同步加载，低频视图按需 import */

/* 必须第一个：把抽屉/弹窗结构注入 DOM，供 core/dom.js 顶层取元素 */
import "./core/templates/index.js";
/* 模板注入后再统一给输入框加禁用自动填充标记（含后续动态插入的表单） */
import "./core/no-autofill.js";
import { initNavTelemetry } from "./core/nav-telemetry.js";
import { initMobileGestures } from "./core/gestures.js";
import { initAssistant } from "./core/assistant.js";
import { initReleaseAi } from "./core/release-ai.js";
import { initSimilarHints } from "./core/similar-hints.js";
import { initTour } from "./core/tour.js";
import { initLayout, isMobile } from "./core/layout.js";
import { loadMe } from "./core/app.js";
import { API } from "./core/api.js";
import { $, offlineBadge } from "./core/dom.js";
import { loadViews } from "./core/filters-ui.js";
import "./core/fullscreen.js";
import { loadUnread, routeNotificationLink } from "./core/notifications.js";
import { initSSE } from "./core/realtime.js";
import { VIEWS, showView, viewFromHash } from "./core/router.js";
import { handleDeepLink, hashParam, openTaskById } from "./core/task-actions.js";
import { buildFormControls, openTaskDrawer, renderTagChips, syncFormSegs, syncProgVal } from "./core/task-drawer.js";
import { UI } from "./core/ui.js";
import { rt } from "./core/state.js";
import { loadBoard, loadReqs, showBoardSkeleton } from "./views/board.js";
import { loadView, viewModule } from "./core/view-loader.js";
import { initTheme } from "./core/theme.js";
/* 桌面端日期 / 时间、下拉自绘面板（副作用注册，移动端自动回落原生） */
import "./core/date-picker.js";
import "./core/select-picker.js";
import { initListDensity } from "./core/list-density.js";

function boot(){
  function autoRail(){
    /* 手机档位由底部 Tab 承载，rail 折叠态在手机上没有意义 */
    if(isMobile()){ document.body.classList.remove("side-rail"); return; }
    var w = window.innerWidth;
    var saved = null;
    try{ saved = localStorage.getItem("ds.rail"); }catch(e){ saved = null; }
    /* 用户手动点过（或按过 Ctrl+B）就听用户的，别让窗口宽度去覆盖他的选择；
       没选过才按宽度自适应：窄屏默认收起，宽屏展开。
       原来这里只读一次 savedRail 并按真值判断，导致"手动展开后一 resize 又被收起"。 */
    if(saved === "1"){ document.body.classList.add("side-rail"); return; }
    if(saved === "0"){ document.body.classList.remove("side-rail"); return; }
    if(w < 1440) document.body.classList.add("side-rail");
    else document.body.classList.remove("side-rail");
  }
  initLayout();
  initListDensity();
  initMobileGestures();
  autoRail();
  window.addEventListener("resize", autoRail);

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  $("kbdMod").textContent = isMac ? "⌘" : "Ctrl";
  initTheme();

  buildFormControls();
  syncFormSegs();
  syncProgVal();
  renderTagChips();
  UI.wireTooltips(document);

  var deepTaskId = hashParam("task");   // 必须在任何 hash 改写之前抓取（O-3）
  /* 空 hash 固定落「我的工作」；有 hash 说明是刷新、收藏或分享链接，尊重原视图 */
  var startView = viewFromHash();
  /* 助手「新建工作项」入口只认看板；其他视图的 ?new=1 属于全局「新建」菜单的跨视图创建参数 */
  var deepNewTask = startView === "board" && hashParam("new") === "1";
  /* 工作页深链带 query：空 hash 才落默认视图，带参数时保留原 hash */
  var startHash = String(window.location.hash || "");
  var keepHash = (startView === "branches" || startView === "workcolumn" || startView === "demands" || startView === "version" || startView === "record" || startView === "release" || startView === "requirements" || startView === "dochistory" || startView === "phase" || startView === "plan-wizard")
    && startHash.indexOf("#/" + startView + "?") === 0;
  if(!keepHash){
    try{ history.replaceState(null, "", "#/" + startView); }
    catch(e){ /* file:// 等受限环境：跳过，不影响功能 */ }
  }
  /* 视图初始化可能触发低频模块 import / 网络请求，等鉴权通过后再进入 */

  /* O-21：快捷键面板首次登录自动展开一次，之后尊重用户的折叠状态。
     注意 localStorage 在 file:// / 隐私模式下会抛错，因此把"读写 localStorage"与"DOM 展开"分开，
     避免读失败连带跳过展开。 */
  try{
    var kbdSeen = null;
    try{ kbdSeen = localStorage.getItem("ds.kbdSeen"); }catch(e2){ kbdSeen = null; }
    if(kbdSeen !== "1"){
      var ks = $("kbdSect");
      if(ks && ks.classList.contains("collapsed")){
        ks.classList.remove("collapsed");
        var kh = ks.querySelector(".drawer-sect-head");
        if(kh) kh.setAttribute("aria-expanded", "true");
      }
      try{ localStorage.setItem("ds.kbdSeen", "1"); }catch(e3){ /* 受限环境：忽略 */ }
    }
  }catch(e){ /* noop */ }

  /* 未登录时只允许先打这一次鉴权请求；401 由 API 层统一跳登录页，
     其余看板/通知/SSE 请求全部等鉴权通过后再发，避免首屏一串 401。 */
  API.get("/api/auth/me").then(function(meUser){
    startAuthenticatedApp(meUser, startView, deepTaskId, deepNewTask);
  }).catch(function(ex){
    if(ex && ex.status === 401) return;
    UI.showConfirm({
      title:"暂时无法连接沙漏",
      msg:"请检查网络或服务状态后重试。" + (ex && ex.message ? "<br>" + UI.esc(ex.message) : ""),
      okText:"重新加载",
      cancelText:"稍后重试",
      danger:false
    }).then(function(retry){ if(retry) window.location.reload(); });
  });
}

function startAuthenticatedApp(meUser, startView, deepTaskId, deepNewTask){
  initNavTelemetry(startView);
  showView(startView);
  showBoardSkeleton();
  initAssistant();
  initReleaseAi();
  initSimilarHints();
  /* 首次进入的欢迎卡与分步指引：失败不影响主流程 */
  try{ initTour(); }catch(e){ /* noop */ }
  /* 侧栏摆件是纯装饰：首屏之后再挂，不占关键路径 */
  import("./core/side-ornament.js").then(function(m){ m.initSideOrnament(); }).catch(function(){});
  /* 沙漏说同样在本机计算、纯展示：失败也不影响主流程 */
  import("./core/sand-say.js").then(function(m){ m.initSandSay(); }).catch(function(){});
  loadBoard({animate:true}).then(function(){
    /* O-3：深链任务；跨空间时（从「我的任务」切过来）用 sessionStorage 接力 */
    var pendingTask = deepTaskId;
    if(!pendingTask){
      try{
        pendingTask = sessionStorage.getItem("ds.openTask") || "";
        if(pendingTask) sessionStorage.removeItem("ds.openTask");
      }catch(e){ pendingTask = ""; }
    }
    if(pendingTask) openTaskById(pendingTask);
    else if(deepNewTask) openTaskDrawer("backlog");
    /* 跨空间通知深链：切换空间 reload 后用 sessionStorage 接力 */
    var pendingLink = null;
    try{
      var rawLink = sessionStorage.getItem("ds.openNoticeLink");
      if(rawLink){
        pendingLink = JSON.parse(rawLink);
        sessionStorage.removeItem("ds.openNoticeLink");
      }
    }catch(e){ pendingLink = null; }
    if(pendingLink && pendingLink.kind && pendingLink.id){
      routeNotificationLink(pendingLink.kind, pendingLink.id, pendingLink.type);
    }
  });
  loadReqs();
  /* 分支模块 126KB，只用于卡片上的分支标签；首屏渲染后再拉，避免和首屏抢带宽 */
  function warmBranches(){
    loadView("branches").then(function(m){ m.loadBranches(); }).catch(function(){});
  }
  if(window.requestIdleCallback) window.requestIdleCallback(warmBranches, {timeout:2500});
  else setTimeout(warmBranches, 1200);
  loadViews();
  loadMe(meUser);
  initSSE();
  /* R-1：未读角标。SSE 之外再兜一层低频轮询；后台也拉，保证标签页标题计数实时 */
  loadUnread(true);
  setInterval(function(){
    loadUnread();
  }, 60000);

  /* O-4：注册 Service Worker（离线只读：静态壳可离线打开，/api/ 永不缓存） */
  if("serviceWorker" in navigator){
    /* 换版交接：静态资源缓存优先，新 HTML 配旧 JS 会短暂不同版。
       新 SW 接管页面时（首次安装除外）空闲就自动刷新；有未保存输入时改为手动刷新入口。 */
    var swHadController = !!navigator.serviceWorker.controller;
    function canReloadForUpdate(){
      if(rt.formDirty || UI.anyDialogOpen()) return false;
      var drawer = $("taskDrawer");
      if(drawer && drawer.classList.contains("on")) return false;
      /* 文档正文编辑器是整页编辑，不属于弹窗，单独看它有没有未保存修改 */
      var req = viewModule("requirements");
      return !(req && req.reqDocDirty);
    }
    function reloadForUpdate(){
      if(canReloadForUpdate()){ window.location.reload(); return; }
      UI.toastAction("新版本已就绪，保存后刷新即可更新", "刷新", function(){
        if(canReloadForUpdate()) window.location.reload();
        else UI.toast("请先保存或关闭正在编辑的面板，再刷新页面", "warn");
      }, "", 30000);
    }
    navigator.serviceWorker.addEventListener("controllerchange", function(){
      if(!swHadController) return;   /* 首次安装：页面没有旧版本资源可混用 */
      reloadForUpdate();
    });
    window.addEventListener("load", function(){
      navigator.serviceWorker.register(API.appBase + "/sw.js").then(function(reg){
        /* 浏览器自身的 SW 更新检查最多约 24 小时一次，发布后可能整天都拿旧缓存；
           每次打开页面主动查一次（sw.js 只有几 KB），换版当天就能接管 */
        if(reg && reg.update) reg.update().catch(function(){});
      }).catch(function(){ /* http 直连不支持 SW，忽略 */ });
    });
  }
  updateOnlineBadge();
  window.addEventListener("online", updateOnlineBadge);
  window.addEventListener("offline", updateOnlineBadge);
}
function updateOnlineBadge(){
  if(!offlineBadge) return;
  offlineBadge.hidden = navigator.onLine !== false;
}
window.addEventListener("hashchange", function(){ handleDeepLink(); });
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
