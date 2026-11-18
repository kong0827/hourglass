/* lib/caliber-help · 指标口径提示：? 解释定义，! 提示边界
   页面只登记 HELP 文案、在标签旁放一个 mark；点击由 document 统一代理。 */

import { UI, esc } from "../core/ui.js";

var defs = {};
var activePop = null;
var bound = false;

export function registerHelp(map){
  if(!map) return;
  for(var key in map){ if(map.hasOwnProperty(key)) defs[key] = map[key]; }
}

export function helpBodyHTML(def){
  if(!def) return "";
  /* 状态机图紧跟标题：点开「!」先看到整张图，再往下读口径；图本身可点击放大 */
  return '<div class="menu-title">' + esc(def.title) + '</div>'
    + (def.image
      ? '<figure class="caliber-figure">'
        + '<button type="button" class="caliber-figure-btn" data-caliber-zoom="' + esc(def.image) + '"'
        + ' title="点击放大查看">'
        + '<img src="' + esc(def.image) + '" alt="' + esc(def.imageAlt || def.title) + '" loading="lazy">'
        + '</button>'
        + (def.imageCaption ? '<figcaption>' + esc(def.imageCaption) + '</figcaption>' : '')
        + '</figure>'
      : "")
    + '<div class="type-help-list">' + (def.rows || []).map(function(row){
      return '<div class="type-help-row"><span class="mini-tag ' + row[2] + '">' + row[0] + '</span>'
        + '<span class="type-help-desc">' + row[1] + '</span></div>';
    }).join("") + '</div>'
    + (def.note ? '<div class="caliber-note">' + def.note + '</div>' : "");
}

/** 图片放大弹窗：与口径浮层分离，浮层关闭后仍可继续看图 */
function openImageZoom(src, alt){
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  var titleId = "caliberZoomTitle" + Date.now();
  layer.setAttribute("aria-labelledby", titleId);
  layer.innerHTML =
    '<div class="sheet caliber-zoom">' +
      '<div class="sheet-head"><h2 id="' + titleId + '">' + esc(alt || "状态机图") + '</h2>' +
        '<button class="icon-btn sm" type="button" data-zoom-x aria-label="关闭">' + "✕" + '</button></div>' +
      '<div class="sheet-body"><img src="' + esc(src) + '" alt="' + esc(alt || "") + '"></div>' +
    '</div>';
  document.body.appendChild(layer);
  function close(){
    UI.closeModal(layer);
    setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 220);
  }
  layer.addEventListener("click", function(e){
    if(e.target === layer || (e.target.closest && e.target.closest("[data-zoom-x]"))) close();
  });
  UI.openModal(layer, "[data-zoom-x]");
}

export function openHelp(anchor, def){
  if(!anchor || !def) return;
  if(activePop) UI.closeAllPops();
  var el = document.createElement("div");
  el.className = "menu popover type-help-pop caliber-pop" + (def.image ? " with-figure" : "");
  el.innerHTML = helpBodyHTML(def);
  activePop = el;
  /* 带图的弹层要留出可读宽度：图的细节比文字更需要横向空间 */
  var maxW = def.image ? 620 : 460;
  /* 靠左的 ? 向右展开，靠右的 ? 向左展开，避免宽弹层被夹到屏幕边缘、离锚点太远 */
  var align = anchor.getBoundingClientRect().left > window.innerWidth / 2 ? "right" : "left";
  UI.openPop(el, anchor, {
    align: align,
    width: Math.max(300, Math.min(maxW, window.innerWidth - 16)),
    onClose: function(){ el.remove(); activePop = null; }
  });
}

export function caliberMarkHTML(key, warn, label){
  var text = label || "查看口径说明";
  return '<button class="caliber-mark' + (warn ? ' warn' : '') + '" type="button"'
    + ' data-caliber-help="' + esc(key) + '" aria-label="' + esc(text) + '"'
    + ' title="' + esc(text) + '">' + (warn ? "!" : "?") + '</button>';
}

export function initCaliberHelp(){
  if(bound) return;
  bound = true;
  document.addEventListener("click", function(e){
    var zoom = e.target && e.target.closest ? e.target.closest("[data-caliber-zoom]") : null;
    if(zoom){
      e.preventDefault();
      e.stopPropagation();
      var img = zoom.querySelector("img");
      openImageZoom(zoom.dataset.caliberZoom, img ? img.alt : "");
      return;
    }
    var mark = e.target && e.target.closest ? e.target.closest("[data-caliber-help]") : null;
    if(!mark) return;
    var def = defs[mark.dataset.caliberHelp];
    if(!def) return;
    e.preventDefault();
    e.stopPropagation();
    openHelp(mark, def);
  });
}
