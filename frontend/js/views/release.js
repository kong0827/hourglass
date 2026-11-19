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

/* #/release 无参数：不再是死胡同卡，列出跨项目最近的未完成发布计划，点任意一条进对应工作台 */
function enterNoParamView(){
  destroy();
  host.innerHTML = '<div class="release-page">' + UI.skeletonRows(3) + '</div>';
  API.get("/api/release-plans", { status:"open" }).then(function(rows){
    if(document.body.dataset.view !== "release") return;
    renderRecentPlans(rows || []);
  }).catch(function(ex){
    if(document.body.dataset.view !== "release") return;
    emptyState((ex.message || "发布计划加载失败") + "；也可从版本卡或「发布日程」进入。");
  });
}
function fmtPlanTime(iso){
  if(!iso) return "未定时间";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return "未定时间";
  function p(n){ return (n < 10 ? "0" : "") + n; }
  return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function planStatusText(st){
  return { ready:"就绪", completed:"已完成", canceled:"已取消", draft:"草稿" }[st] || st || "—";
}
function renderRecentPlans(rows){
  var now = Date.now();
  /* 「最近」= 离当前时间最近（已过期与即将到来的都算）；未定时间的排最后 */
  rows = rows.slice().sort(function(a, b){
    var ta = a.plannedAt ? new Date(a.plannedAt).getTime() : Infinity;
    var tb = b.plannedAt ? new Date(b.plannedAt).getTime() : Infinity;
    if(ta === tb) return 0;
    if(ta === Infinity) return 1;
    if(tb === Infinity) return -1;
    return Math.abs(ta - now) - Math.abs(tb - now);
  });
  var top = rows.slice(0, 8);
  var list = top.map(function(r){
    var late = r.plannedAt && new Date(r.plannedAt).getTime() < now;
    var go = !!(r.versionId && r.reqId);
    return '<button class="rel-plan-row" type="button"'
      + (go ? ' data-rel-plan="' + esc(r.versionId) + '" data-rel-req="' + esc(r.reqId) + '"' : ' disabled')
      + ' title="' + (go ? "打开该版本的发布工作台" : "该计划缺少版本关联，请到发布日程查看") + '">'
      + '<span class="rp-t">' + esc(fmtPlanTime(r.plannedAt)) + (late ? ' <span class="tag tag-warning">已过期</span>' : '') + '</span>'
      + '<span class="rp-p" title="' + esc(r.projectNames || r.projectName || "") + '">' + esc(r.projectNames || r.projectName || "—") + '</span>'
      + '<span class="rp-v" title="' + esc(r.versionNames || r.versionName || "") + '">' + esc(r.versionNames || r.versionName || "—") + '</span>'
      + '<span class="rp-s">' + esc(planStatusText(r.status)) + '</span>'
      + '</button>';
  }).join("");
  host.innerHTML = '<div class="release-page"><div class="panel"><div class="panel-head"><h3>最近发布计划</h3>'
    + '<span class="meta-right">' + rows.length + ' 份未完成</span></div>'
    + (top.length
      ? '<div class="rel-plan-list">' + list + '</div>'
      : '<div class="stack"><p class="hint">还没有未完成的发布计划。</p></div>')
    + '<div class="stack" style="padding:10px 12px 12px"><p class="hint">计划按版本创建</p>'
    + '<div><button class="btn sm" type="button" data-release-empty-back>去版本页</button></div></div>'
    + '</div></div>';
  host.querySelectorAll("[data-rel-plan]").forEach(function(b){
    b.addEventListener("click", function(){
      openReleasePage({ id: b.getAttribute("data-rel-plan"), reqId: b.getAttribute("data-rel-req") });
    });
  });
  var back = host.querySelector("[data-release-empty-back]");
  if(back) back.addEventListener("click", function(){ showView("phase"); });
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
  if(!route || !route.id){ enterNoParamView(); return; }
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
