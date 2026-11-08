/* core/gestures · 手机档位的手势：左滑露出操作、右滑快捷菜单、下拉刷新
   桌面端调用直接 return；事件挂在 #views 上做委托，不给每张卡单独绑。 */

import { isMobile } from "./layout.js";
import { refreshActiveView } from "./router.js";
import { rt } from "./state.js";

/* 只接管看板卡片和手机任务卡；日历未排期/侧栏里的 .card 保持浏览态 */
var CARD_SEL = "#view-board .card, .mob-task-card";

function point(e){ return {x:e.clientX, y:e.clientY}; }

/** 通用左/右滑（独立使用；主流程走 initMobileGestures 的委托） */
export function attachSwipe(el, opts){
  opts = opts || {};
  if(!el || el.__swipeWired) return;
  el.__swipeWired = true;
  var threshold = opts.threshold || 56, start = null;
  el.addEventListener("pointerdown", function(e){
    if(!isMobile() || e.pointerType === "mouse") return;
    start = point(e);
  });
  el.addEventListener("pointerup", function(e){
    if(!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if(Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;
    if(dx < 0 && opts.onSwipeLeft) opts.onSwipeLeft(e);
    if(dx > 0 && opts.onSwipeRight) opts.onSwipeRight(e);
  });
  el.addEventListener("pointercancel", function(){ start = null; });
}

/** 长按（独立使用；列表多选等场景可按需接） */
export function attachLongPress(el, opts){
  opts = opts || {};
  if(!el || el.__lpWired) return;
  el.__lpWired = true;
  var delay = opts.delay || 480, tolerance = opts.tolerance || 10;
  var timer = null, start = null;
  function clear(){ if(timer) clearTimeout(timer); timer = null; start = null; }
  el.addEventListener("pointerdown", function(e){
    if(!isMobile() || e.pointerType === "mouse") return;
    start = point(e);
    timer = setTimeout(function(){
      if(start && opts.onLongPress) opts.onLongPress(e);
      timer = null;
    }, delay);
  });
  el.addEventListener("pointermove", function(e){
    if(!start) return;
    if(Math.abs(e.clientX - start.x) > tolerance || Math.abs(e.clientY - start.y) > tolerance) clear();
  });
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointercancel", clear);
}

/** 下拉刷新（独立使用；主流程已由 initMobileGestures 统一处理） */
export function attachPullToRefresh(scroller, opts){
  opts = opts || {};
  if(!scroller || scroller.__ptrWired) return;
  scroller.__ptrWired = true;
  var threshold = opts.threshold || 64, start = null;
  scroller.addEventListener("pointerdown", function(e){
    if(!isMobile() || e.pointerType === "mouse") return;
    if(scroller.scrollTop > 0) return;
    start = point(e);
  });
  scroller.addEventListener("pointerup", function(e){
    if(!start) return;
    var dy = e.clientY - start.y, dx = e.clientX - start.x;
    start = null;
    if(dy > threshold && Math.abs(dy) > Math.abs(dx) && scroller.scrollTop <= 0 && opts.onRefresh) opts.onRefresh();
  });
  scroller.addEventListener("pointercancel", function(){ start = null; });
}

function closeSwiped(except){
  document.querySelectorAll(".mob-task-card.swiped").forEach(function(el){
    if(el !== except) el.classList.remove("swiped");
  });
}
function openQuick(card){
  var menuBtn = card.querySelector("[data-card-menu], [data-row-menu]");
  if(menuBtn){ menuBtn.click(); return; }
  card.click();
}
function setPtr(dy){
  var el = document.getElementById("ptrIndicator");
  if(!el) return;
  if(dy <= 0){ el.classList.remove("on"); el.style.transform = ""; return; }
  el.classList.add("on");
  el.style.transform = "translateY(" + Math.min(dy * 0.45, 52) + "px)";
  el.textContent = dy > 64 ? "松开刷新" : "下拉刷新…";
}

export function initMobileGestures(){
  if(window.__mobGesturesWired) return;
  window.__mobGesturesWired = true;

  var views = document.getElementById("views");
  if(!views) return;
  var start = null;
  var ptr = document.createElement("div");
  ptr.className = "ptr-indicator";
  ptr.id = "ptrIndicator";
  ptr.textContent = "下拉刷新…";
  views.appendChild(ptr);

  views.addEventListener("pointerdown", function(e){
    if(!isMobile() || e.pointerType === "mouse"){ start = null; return; }
    if(e.target.closest("input,textarea,select,a,button,.drawer-layer")){ start = null; return; }
    var scroller = e.target.closest(".view.on");
    if(!scroller) return;
    start = {
      x:e.clientX, y:e.clientY, scroller:scroller,
      card:e.target.closest(CARD_SEL),
      moved:false, pulling:false, swiping:false, lastDx:0, lastDy:0
    };
  }, {passive:true});

  views.addEventListener("pointermove", function(e){
    if(!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    start.lastDx = dx;
    start.lastDy = dy;
    if(!start.moved && Math.abs(dx) + Math.abs(dy) > 8) start.moved = true;

    if(start.card && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18){
      start.swiping = true;
      if(e.cancelable) e.preventDefault();
      return;
    }
    if(!start.swiping && start.scroller.scrollTop <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx)){
      start.pulling = true;
      setPtr(dy);
    }
  }, {passive:false});

  views.addEventListener("pointerup", function(e){
    if(!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    var card = start.card, pulling = start.pulling, swiping = start.swiping, scroller = start.scroller;
    start = null;
    setPtr(0);

    if(swiping && card){
      if(dx < -56){
        if(card.classList.contains("mob-task-card")){
          /* 我的任务 / 列表：展开卡片内操作条 */
          rt.suppressClickUntil = Date.now() + 350;
          closeSwiped(card);
          card.classList.add("swiped");
        }else{
          /* 看板卡片没有操作条：左右滑都只打开快捷菜单，不直接改状态。
             之前左滑会触发“完成”，手指轻微横划就会把任务移到已完成列，误触率太高。 */
          openQuick(card);
          rt.suppressClickUntil = Date.now() + 350;
        }
      }else if(dx > 56){
        closeSwiped(null);
        openQuick(card);
        rt.suppressClickUntil = Date.now() + 350;
      }
      return;
    }
    if(pulling){
      if(dy > 64 && scroller.scrollTop <= 0) refreshActiveView({manual:true});
      return;
    }
    /* 点空白处收起已滑开的卡片 */
    if(!card) closeSwiped(null);
  });

  views.addEventListener("pointercancel", function(){
    /* pan-y 会让浏览器接管纵滚并触发 pointercancel：把最后一次下拉位移视为释放 */
    var s = start;
    start = null;
    setPtr(0);
    if(s && s.pulling && s.lastDy > 64 && s.scroller.scrollTop <= 0){
      refreshActiveView({manual:true});
    }
  });
  /* 指针在 #views 外抬起（底栏/顶栏/抽屉）时也要清掉起点，避免下一次点击误用旧坐标触发幽灵滑动 */
  document.addEventListener("pointerup", function(){ start = null; }, {passive:true});
  document.addEventListener("pointercancel", function(){ start = null; }, {passive:true});

  document.addEventListener("click", function(e){
    if(Date.now() < (rt.suppressClickUntil || 0) && e.target.closest(CARD_SEL) && !e.target.closest(".mtc-swipe")){
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener("pointerdown", function(e){
    if(!isMobile()) return;
    var swiped = e.target.closest(".mob-task-card.swiped");
    closeSwiped(swiped);
  }, {passive:true});
}
