/* main.js · 入口：核心与首屏模块同步加载，低频视图按需 import */

import { loadMe } from "./core/app.js";
import { $, offlineBadge } from "./core/dom.js";
import { loadViews } from "./core/filters-ui.js";
import { loadUnread } from "./core/notifications.js";
import { initSSE } from "./core/realtime.js";
import { VIEWS, showView, viewFromHash } from "./core/router.js";
import { handleDeepLink, hashParam, openTaskById } from "./core/task-actions.js";
import { buildFormControls, renderTagChips, syncFormSegs, syncProgVal } from "./core/task-drawer.js";
import { UI } from "./core/ui.js";
import { loadBoard, loadReqs, showBoardSkeleton } from "./views/board.js";
import { loadBranches } from "./views/branches.js";
import { initTheme } from "./core/theme.js";

function boot(){
  function autoRail(){
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
  var startView = viewFromHash();
  try{ history.replaceState(null, "", "#/" + startView); }
  catch(e){ /* file:// 等受限环境：跳过，不影响功能 */ }
  showView(startView);

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

  showBoardSkeleton();
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
  });
  loadReqs();
  loadBranches();
  loadViews();
  loadMe();
  initSSE();
  /* R-1：未读角标。SSE 之外再兜一层低频轮询，SSE 断连时也能拿到新通知 */
  loadUnread(true);
  setInterval(function(){
    if(document.hidden) return;
    loadUnread();
  }, 60000);

  /* O-4：注册 Service Worker（离线只读：静态壳可离线打开，/api/ 永不缓存） */
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw.js").catch(function(){ /* http 直连不支持 SW，忽略 */ });
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
