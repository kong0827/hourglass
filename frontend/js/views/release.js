/* views/release · 发布计划工作台子页（#/release?id=&reqId=&tab=）
   原来 960 居中弹框里的计划 / 实际 / 历史 / 内容四个工作面搬到这里：
   页签和版本都在 URL 里，刷新、分享、后退都回到同一页签；关闭回到版本页。
   工作区本身仍由 phase.js 的同一份代码挂载，校验、留痕、幂等都没有第二套。 */

import { API } from "../core/api.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { UI, esc } from "../core/ui.js";
import { mountReleaseWorkspace, takeReleaseIntent } from "./phase.js";

var TAB_KEYS = ["plan", "actual", "history", "content"];
var host = null, handle = null;

function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "release") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  var tab = p.get("tab") || "plan";
  return {
    id: p.get("id") || "",
    reqId: p.get("reqId") || "",
    tab: TAB_KEYS.indexOf(tab) >= 0 ? tab : "plan"
  };
}
function routeHash(r){
  var h = "#/release?id=" + encodeURIComponent(r.id);
  if(r.reqId) h += "&reqId=" + encodeURIComponent(r.reqId);
  if(r.tab && r.tab !== "plan") h += "&tab=" + r.tab;
  return h;
}
/* 换页签压一条历史：浏览器后退能回到上一个页签，分享出去的链接也带着页签 */
function syncTabHash(tab){
  var r = parseRoute();
  if(!r || !r.id) return;
  var h = routeHash({ id:r.id, reqId:r.reqId, tab:tab });
  if(window.location.hash === h) return;
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
}

export function openReleasePage(opts){
  var r = { id: opts.id, reqId: opts.reqId || "", tab: opts.tab || "plan" };
  try{ history.pushState(null, "", routeHash(r)); }
  catch(e){ window.location.hash = routeHash(r); }
  showView("release");
}

function destroy(){
  if(handle && handle.destroy) handle.destroy();
  handle = null;
}
function emptyState(msg){
  destroy();
  host.innerHTML = '<div class="release-page"><div class="panel"><div class="panel-head"><h3>发布工作台</h3></div>'
    + '<div class="stack"><p class="hint">' + esc(msg) + '</p>'
    + '<div><button class="btn sm" type="button" data-release-empty-back>返回版本</button></div></div></div></div>';
  var btn = host.querySelector("[data-release-empty-back]");
  if(btn) btn.addEventListener("click", function(){ showView("phase"); });
}

function mount(route, version, intent){
  destroy();
  /* 工作区按 rt.phaseReqId 校验迟到的响应；直接打开链接时先把它对齐到当前版本 */
  if(version.reqId) rt.phaseReqId = version.reqId;
  handle = mountReleaseWorkspace(host, {
    id: route.id,
    tab: route.tab,
    entry: intent ? intent.entry : (route.tab === "actual" ? "actual" : "plan"),
    version: version,
    onClose: intent ? intent.onClose : null,
    presetVersionIds: intent ? intent.presetVersionIds : null,
    forceNewPlan: !!(intent && intent.forceNewPlan),
    returnHash: intent ? intent.returnHash : "",
    onTab: syncTabHash
  });
}

export function enterReleaseView(){
  host = document.getElementById("releaseBody");
  if(!host) return;
  var route = parseRoute();
  var intent = takeReleaseIntent();
  if(!route || !route.id){ emptyState("没有指定版本；从版本卡或「发布计划」入口进入。"); return; }
  if(intent && intent.id !== route.id) intent = null;
  if(intent && intent.version){ mount(route, intent.version, intent); return; }
  var reqId = (intent && intent.reqId) || route.reqId;
  host.innerHTML = '<div class="release-page">' + UI.skeletonRows(4) + '</div>';
  API.get("/api/versions", { reqId: reqId }).then(function(vs){
    if(document.body.dataset.view !== "release") return;
    var v = (vs || []).filter(function(item){ return item.id === route.id; })[0];
    if(!v){ emptyState("版本已变化或不可见"); return; }
    /* 直接从链接进入时没有入口参数，版本从接口取到的这份为准 */
    if(!reqId) route.reqId = v.reqId;
    mount(route, v, intent);
  }).catch(function(ex){
    if(document.body.dataset.view !== "release") return;
    emptyState(ex.message || "版本加载失败，请稍后重试");
  });
}

export function refreshFromHash(){
  var route = parseRoute();
  if(!route || !route.id){ enterReleaseView(); return; }
  if(handle && handle.id === route.id){ handle.setTab(route.tab); return; }
  enterReleaseView();
}

/* 离开路由（后退 / 点菜单 / 返回版本）时清掉 SSE 监听与入口回调 */
window.addEventListener("ds:before-route", function(e){
  if(e.detail && e.detail.from === "release" && e.detail.to !== "release") destroy();
});

/* 只有直接改地址栏 hash 才会走这里；pushState 走 popstate */
window.addEventListener("hashchange", function(){
  if(document.body.dataset.view !== "release" || !parseRoute()) return;
  refreshFromHash();
});
