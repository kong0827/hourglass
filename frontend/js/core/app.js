/* core/app · 空间切换、当前用户、模块数据、顶栏 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { reloadFilteredViews, restoreViewState } from "./filters-ui.js";
import { updateBrand } from "./filters.js";
import { icon } from "./icons.js";
import { isMobile } from "./layout.js";
import { currentMode } from "./mobile-rules.js";
import { handleNoticeClick, loadAlertPanel, loadUnread, renderAlertPanel } from "./notifications.js";
import { activeView, showView } from "./router.js";
import { rt, state } from "./state.js";
import { openTaskDrawer, refreshOwnerSelect, syncCatSeg } from "./task-drawer.js";
import { UI, esc, toast } from "./ui.js";
import { avatarColor, avatarColorIndex, initial } from "../lib/format.js";
import { loadBoard, loadReqs, render } from "../views/board.js";
import { askSwitchWorkspace, wsNameById } from "../views/mine.js";
import { loadView } from "./view-loader.js";

var wsMenuEl = $("wsMenu"), wsListEl = $("wsList"), wsSwitchBtn = $("wsSwitch");
function loadWorkspaces(meUser){
  var hadWorkspace = !!rt.currentWs;
  return API.get("/api/workspaces").then(function(list){
    rt.allWorkspaces = list || [];
    var target = null;
    if(meUser && meUser.lastWorkspaceId){
      for(var i = 0; i < rt.allWorkspaces.length; i++) if(rt.allWorkspaces[i].id === meUser.lastWorkspaceId) target = rt.allWorkspaces[i];
    }
    if(!target && rt.allWorkspaces.length) target = rt.allWorkspaces[0];
    if(target){
      rt.currentWs = target;
      window.CURRENT_WORKSPACE = target.id;
      var nameEl = $("wsName");
      if(nameEl) nameEl.textContent = target.name;
      var av = $("wsAvatar");
      if(av){
        av.className = "avatar ws-avatar avatar-c" + avatarColorIndex(target.name || "空");
        av.textContent = target.name ? target.name.charAt(0) : "空";
      }
      var kindEl = $("wsKind");
      if(kindEl) kindEl.textContent = target.type === "personal"
        ? "个人空间"
        : ("共享 · " + (target.memberCount || 1) + " 人" +
            (target.myRole === "owner" ? " · 空间主"
              : target.myRole === "admin" ? " · 管理员"
              : target.myRole === "viewer" ? " · 查看者（只读）" : ""));
    }
    renderWsMenu();
    applyWsRoleGating();
    loadWsMembers();
    updateBrand();
    if(restoreViewState()) reloadFilteredViews();
    /* 深链直达甘特图时，空间在首屏之后才确定：偏好与请求都要按新空间补跑一次 */
    if(activeView === "gantt"){
      loadView("gantt").then(function(m){ m.loadGanttPrefs(); m.syncGanttControls(); m.loadGantt(); });
    }
    if(activeView === "settings" && !rt.settingsReady) loadView("settings").then(function(m){ m.enterSettingsView(); });
    /* 空间就绪前 mine 已经进过一次：只有确实要落团队模式才需要按角色补进一次，避免普通成员重复拉 my-tasks */
    if(!hadWorkspace && isMobile() && activeView === "mine" &&
        currentMode(target ? target.id : "", target && target.myRole) === "team") showView("mine");
    return target;
  }).catch(function(){ return null; });
}
function applyWsRoleGating(){
  var owner = !rt.currentWs || rt.currentWs.myRole === "owner";
  [["btnExport","导出任务备份"],["btnImport","导入任务备份"],["btnReset","清空任务数据"],["btnNotifyTest","测试推送"]].forEach(function(pair){
    var b = $(pair[0]);
    if(!b) return;
    if(b.dataset.ownerTitle === undefined) b.dataset.ownerTitle = b.title || "";
    b.disabled = !owner;
    b.title = owner ? b.dataset.ownerTitle : ("仅空间主可" + pair[1]);
  });
}
function loadWsMembers(){
  rt.wsMembersCache = [];
  refreshOwnerSelect();
  if(!rt.currentWs || rt.currentWs.type !== "shared") return;
  API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members").then(function(list){
    rt.wsMembersCache = list || [];
    refreshOwnerSelect();
  }).catch(function(){});
}
function renderWsMenu(){
  if(!wsListEl) return;
  wsListEl.innerHTML = rt.allWorkspaces.map(function(w){
    var on = rt.currentWs && w.id === rt.currentWs.id;
    return '<button class="ws-item' + (on ? " on" : "") + '" type="button" data-ws="' + esc(w.id) + '" data-ws-name="' + esc(w.name) + '">' +
      icon(w.type === "personal" ? "user" : "users", 14) +
      '<span class="ellipsis">' + esc(w.name) + '</span>' +
      '<span class="ws-kind">' + (w.type === "personal" ? "个人" : "共享") + '</span>' +
      (on ? '<span class="ws-check">' + icon("check", 12) + '</span>' : '') +
    '</button>';
  }).join("");
}
wsListEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-ws]");
  if(!b) return;
  var id = b.dataset.ws;
  if(rt.currentWs && id === rt.currentWs.id){ UI.closeAllPops(); return; }
  var name = b.dataset.wsName || wsNameById(id);
  UI.closeAllPops();
  /* 切空间会 reload：先确认，避免误点后丢掉当前筛选与未保存的编辑 */
  askSwitchWorkspace(id, name);
});
wsSwitchBtn.addEventListener("click", function(){
  if(UI.popOpen(wsMenuEl)){ UI.closeAllPops(); return; }
  UI.openPop(wsMenuEl, wsSwitchBtn, {align:"left", width:232});
});
$("btnWsCreate").addEventListener("click", function(){
  UI.closeAllPops();
  $("dlgWsName").value = "";
  $("fDlgWsName").classList.remove("invalid");
  UI.openModal($("dlgWsCreate"));
});
$("btnWsSettings").addEventListener("click", function(){
  UI.closeAllPops();
  showView("settings");
});
$("dlgWsCreateForm").addEventListener("submit", function(e){
  e.preventDefault();
  if($("dlgWsCreateOk").disabled) return;
  var name = $("dlgWsName").value.trim();
  if(!name){ $("fDlgWsName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  var btn = $("dlgWsCreateOk");
  btn.disabled = true;
  API.post("/api/workspaces", { name: name }).then(function(){
    btn.disabled = false;
    UI.closeModal($("dlgWsCreate"));
    toast("已创建空间「" + name + "」", "fs");
    loadWorkspaces(rt.currentUser).then(function(){
      loadBoard({animate:true});
      loadReqs();
    });
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});
function loadMe(prefetched){
  var p = prefetched ? Promise.resolve(prefetched) : API.get("/api/auth/me");
  return p.then(function(u){
    rt.currentUser = u;
    if(u.displayName) rt.OWNER_DEFAULT = u.displayName;
    var tabPlat = $("setTabPlatform");
    if(tabPlat) tabPlat.hidden = u.role !== "admin";
    renderSideUser(u);
    /* me 回来了：把等它的视图初始化补跑一遍（深链直达 #/profile 时靠这个） */
    loadView("profile").then(function(m){ m.flushMeReady(); });
    return loadWorkspaces(u);
  }).catch(function(){ /* 未登录由 api.js 统一跳转 */ });
}
function renderSideUser(u){
  var name = (u && (u.displayName || u.username)) || "?";
  var av = $("sideUserAv"), nm = $("sideUserName"), btn = $("sideUserBtn");
  if(av){ av.className = "avatar avatar-c" + avatarColorIndex(name); av.textContent = initial(name); }
  /* 侧栏宽度有限，长名字会被省略：补 title 让悬停可看全名 */
  if(nm){ nm.textContent = name; nm.title = name; }
  if(btn) btn.title = name + " · 个人设置（账号 / 计时 / 密码）";
}
/* 手机端 FAB 在滚动时收起、停稳后恢复，避免盖住列表内容 */
var fabScrollLast = new WeakMap(), fabRevealTimer = 0;
function onAppScroll(e){
  if(!isMobile()) return;
  var el = e.target;
  if(!el || el.nodeType !== 1) return;
  var y = el.scrollTop || 0, prev = fabScrollLast.get(el) || 0;
  fabScrollLast.set(el, y);
  if(y <= 24 || prev - y > 4) document.body.classList.remove("fab-away");
  else if(y - prev > 4) document.body.classList.add("fab-away");
  clearTimeout(fabRevealTimer);
  fabRevealTimer = setTimeout(function(){ document.body.classList.remove("fab-away"); }, 900);
}
document.addEventListener("scroll", onAppScroll, true);
var lastCatLoad = 0;
function loadCategories(force){
  if(!force && Date.now() - lastCatLoad < 30000) return Promise.resolve();
  lastCatLoad = Date.now();
  return API.get("/api/categories").then(function(list){
    var next = list || [];
    var changed = JSON.stringify(next) !== JSON.stringify(rt.categoriesCache);
    rt.categoriesCache = next;
    if(changed){
      syncCatSeg();
      if(state.board) render({animate:false});
    }
  }).catch(function(){});
}
function updateTagDatalist(){
  var el = $("tagOptions");
  if(!el || !state.board || !state.board.meta) return;
  el.innerHTML = (state.board.meta.tags || []).map(function(t){
    return '<option value="' + esc(t.name) + '"></option>';
  }).join("");
}
function pruneStaleFilters(meta){
  if(!meta) return false;
  var changed = false;
  var catIds = {};
  (meta.cats || []).forEach(function(c){ catIds[c.id] = 1; });
  var keptCats = state.cats.filter(function(c){ return catIds[c]; });
  if(keptCats.length !== state.cats.length){ state.cats = keptCats; changed = true; }
  var reqIds = {};
  (meta.reqs || []).forEach(function(r){ reqIds[r.id] = 1; });
  var keptReqs = state.reqs.filter(function(v){ return v === "__none" || reqIds[v]; });
  if(keptReqs.length !== state.reqs.length){ state.reqs = keptReqs; changed = true; }
  var tagNames = {};
  (meta.tags || []).forEach(function(t){ tagNames[t.name] = 1; });
  var keptTags = state.tags.filter(function(t){ return tagNames[t]; });
  if(keptTags.length !== state.tags.length){ state.tags = keptTags; changed = true; }
  if(changed) toast("部分筛选条件已失效，已自动清理", "warn");
  return changed;
}
$("btnNew").addEventListener("click", function(){
  if(UI.popOpen($("newMenu"))){ UI.closeAllPops(); return; }
  UI.openPop($("newMenu"), $("btnNew"), {align:"left"});
});
$("newMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-new]");
  if(!b) return;
  UI.closeAllPops();
  if(b.dataset.new === "task"){ openTaskDrawer("backlog"); }
  else { showView("projects"); setTimeout(function(){ loadView("projects").then(function(m){ m.openProjectDialog(null); }); }, 60); }
});
$("btnAlert").addEventListener("click", function(){
  if(UI.popOpen($("alertPanel"))){ UI.closeAllPops(); return; }
  renderAlertPanel();     // 先用缓存渲染，避免打开瞬间空白
  loadAlertPanel();
  loadUnread();
  UI.openPop($("alertPanel"), $("btnAlert"), {align:"left"});
});
$("alertPanel").addEventListener("click", handleNoticeClick);

/* 顶栏帮助菜单：帮助对话框由设置模块渲染，这里只在点击时按需加载，
   保证未访问过设置页也能用（帮助中心 / GitHub 直接新开） */
function openHelpDialog(){
  loadView("settings").then(function(m){ m.openHelp(); });
}
if($("btnHelp")) $("btnHelp").addEventListener("click", function(){
  var menu = $("helpMenu");
  if(!menu){ openHelpDialog(); return; }
  if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
  UI.openPop(menu, $("btnHelp"), {align:"right"});
});
if($("helpMenu")) $("helpMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-help]");
  if(!b) return;
  UI.closeAllPops();
  if(b.dataset.help === "shortcuts"){ openHelpDialog(); return; }
  if(b.dataset.help === "manual"){ window.open("help.html", "_blank", "noopener"); return; }
  if(b.dataset.help === "github"){ window.open("https://github.com/kong0827/hourglass", "_blank", "noopener"); }
});

export { loadCategories, loadMe, loadWorkspaces, pruneStaleFilters, renderSideUser, updateTagDatalist };
