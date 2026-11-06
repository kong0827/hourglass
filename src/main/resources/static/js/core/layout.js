/* core/layout · 三档断点 → body[data-layout]
   只负责“当前是什么档位”，不碰业务渲染。视图自己监听 ds:layout 决定是否重渲染。 */

var MQ_MOBILE = "(max-width: 639px)";
var MQ_TABLET = "(min-width: 640px) and (max-width: 1023px)";
var mqMobile = window.matchMedia(MQ_MOBILE);
var mqTablet = window.matchMedia(MQ_TABLET);

/** 唯一判定出口。不要读 dataset，dataset 只是给 CSS 用的镜像。 */
export function isMobile(){ return mqMobile.matches; }
export function isTablet(){ return mqTablet.matches; }
export function layoutMode(){
  return mqMobile.matches ? "mobile" : (mqTablet.matches ? "tablet" : "desktop");
}

var last = null;
function apply(){
  var next = layoutMode();
  if (next === last) return;
  last = next;
  /* html 上的镜像用于首屏 CSS 提前生效（index.html 头部已按宽度预置） */
  document.documentElement.dataset.layout = next;
  document.body.dataset.layout = next;

  /* 与现有 body.side-rail 互斥：手机档位下强制清掉 rail，否则 rail 逻辑会和底部 Tab 打架 */
  if (next === "mobile") document.body.classList.remove("side-rail");

  var tabbar = document.getElementById("tabBar");
  if (tabbar) tabbar.hidden = next !== "mobile";

  window.dispatchEvent(new CustomEvent("ds:layout", { detail: { layout: next } }));
}

function wireTabbar(){
  var bar = document.getElementById("tabBar");
  if (!bar || bar.__wired) return;
  bar.__wired = true;
  bar.addEventListener("click", function(e){
    var b = e.target.closest("[data-tab]");
    if (!b) return;
    window.dispatchEvent(new CustomEvent("ds:tab", { detail: { tab: b.dataset.tab } }));
  });
}

export function initLayout(){
  wireTabbar();
  apply();
  window.addEventListener("resize", apply, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", apply, { passive: true });
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", apply);
  else if (mqMobile.addListener) mqMobile.addListener(apply);
  if (mqTablet.addEventListener) mqTablet.addEventListener("change", apply);
  else if (mqTablet.addListener) mqTablet.addListener(apply);
}
