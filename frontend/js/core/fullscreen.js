/* core/fullscreen · 视图全屏：隐藏应用外壳，让甘特图/日历/看板/报表占满整屏 */

import { icon } from "./icons.js";
import { UI } from "./ui.js";

var body = document.body;
var exitBtn = null;

function isOn(){ return body.classList.contains("fs-view"); }

/* 入口按钮在视图工具条里，部分视图由 JS 渲染、会整体重绘，所以按钮标记统一由这里生成 */
function buttonHTML(){
  var on = isOn();
  return '<button class="icon-btn sm" type="button" data-view-fullscreen aria-pressed="' + (on ? "true" : "false") +
    '" aria-label="' + (on ? "退出全屏" : "全屏查看") + '" title="' + (on ? "退出全屏（Esc）" : "全屏查看（Esc 退出）") + '">' +
    icon(on ? "compress" : "expand", 15) + '</button>';
}

/* 工具条里的按钮本身就切换全屏；只有筛选栏这类入口随外壳一起隐藏的视图，
   才需要底部浮层兜底，避免“进得去出不来”。 */
function hasVisibleEntry(){
  return Array.prototype.some.call(document.querySelectorAll("[data-view-fullscreen]"), function(btn){
    return btn.offsetParent !== null;
  });
}

function syncUI(){
  var on = isOn();
  document.querySelectorAll("[data-view-fullscreen]").forEach(function(btn){
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "退出全屏" : "全屏查看");
    btn.setAttribute("title", on ? "退出全屏（Esc）" : "全屏查看（Esc 退出）");
    btn.innerHTML = icon(on ? "compress" : "expand", 15);
  });
  if(exitBtn) exitBtn.hidden = !on || hasVisibleEntry();
  window.dispatchEvent(new CustomEvent("ds:fullscreen", { detail: { on: on } }));
}

function requestNative(){
  if(document.fullscreenElement) return;
  var el = document.documentElement;
  if(!el.requestFullscreen) return;
  try{
    var p = el.requestFullscreen();
    if(p && p.catch) p.catch(function(){ /* 内嵌/权限受限：保留应用内全屏 */ });
  }catch(e){ /* 同上 */ }
}
function exitNative(){
  if(!document.fullscreenElement || !document.exitFullscreen) return;
  try{
    var p = document.exitFullscreen();
    if(p && p.catch) p.catch(function(){ /* noop */ });
  }catch(e){ /* noop */ }
}

function enter(){
  if(isOn()) return;
  body.classList.add("fs-view");
  syncUI();
  requestNative();
}
function exit(){
  if(!isOn()) return;
  body.classList.remove("fs-view");
  syncUI();
  exitNative();
}
function toggle(){ isOn() ? exit() : enter(); }

function init(){
  exitBtn = document.getElementById("fsExit");
  syncUI();
}

/* 事件委托：各视图工具条会在进入视图后重绘，逐个绑事件会在重绘后失效 */
document.addEventListener("click", function(e){
  if(e.target.closest("#fsExit")){ exit(); return; }
  if(e.target.closest("[data-view-fullscreen]")) toggle();
});

/* 原生全屏由浏览器响应 Esc；应用内全屏在无浮层/抽屉/弹窗时由这里退出 */
document.addEventListener("keydown", function(e){
  if(e.key !== "Escape" || !isOn() || document.fullscreenElement) return;
  if(UI.anyModalOpen() || UI.confirmOpen()) return;
  if(document.querySelector(".drawer-layer.on")) return;
  var popped = Array.prototype.some.call(document.querySelectorAll(".menu,.ws-menu,.popover"), function(el){
    return !!el.__popOpen;
  });
  if(popped) return;
  exit();
});

document.addEventListener("fullscreenchange", function(){
  if(!document.fullscreenElement && isOn()){
    body.classList.remove("fs-view");
    syncUI();
  }
});

/* 外壳都收起了，换页后继续全屏会让人找不到入口：切视图即退出 */
window.addEventListener("ds:view-change", function(){ if(isOn()) exit(); });

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

export { buttonHTML as fullscreenButtonHTML, enter as enterFullscreen, exit as exitFullscreen, init as initFullscreen, isOn as isFullscreen, syncUI as syncFullscreenUI, toggle as toggleFullscreen };
