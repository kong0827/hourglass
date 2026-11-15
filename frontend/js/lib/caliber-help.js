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
  return '<div class="menu-title">' + esc(def.title) + '</div>'
    + '<div class="type-help-list">' + (def.rows || []).map(function(row){
      return '<div class="type-help-row"><span class="mini-tag ' + row[2] + '">' + row[0] + '</span>'
        + '<span class="type-help-desc">' + row[1] + '</span></div>';
    }).join("") + '</div>'
    + (def.note ? '<div class="caliber-note">' + def.note + '</div>' : "");
}

export function openHelp(anchor, def){
  if(!anchor || !def) return;
  if(activePop) UI.closeAllPops();
  var el = document.createElement("div");
  el.className = "menu popover type-help-pop caliber-pop";
  el.innerHTML = helpBodyHTML(def);
  activePop = el;
  /* 靠左的 ? 向右展开，靠右的 ? 向左展开，避免宽弹层被夹到屏幕边缘、离锚点太远 */
  var align = anchor.getBoundingClientRect().left > window.innerWidth / 2 ? "right" : "left";
  UI.openPop(el, anchor, {
    align: align,
    width: Math.max(300, Math.min(460, window.innerWidth - 16)),
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
    var mark = e.target && e.target.closest ? e.target.closest("[data-caliber-help]") : null;
    if(!mark) return;
    var def = defs[mark.dataset.caliberHelp];
    if(!def) return;
    e.preventDefault();
    e.stopPropagation();
    openHelp(mark, def);
  });
}
