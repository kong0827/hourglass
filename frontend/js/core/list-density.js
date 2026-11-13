/* core/list-density · 列表密度：标准 56px / 宽松 62px
   我的工作、需求工作页、工作项列状态页三处列表形态共用同一档；
   切换只写 body 上的档位属性，行高由 CSS 变量 --list-row-h 接管，不必重渲染列表。 */

var DENSITY_KEY = "ds.listDensity";
var DENSITY_NAMES = { standard:"标准", relaxed:"宽松" };

function readDensity(){
  var v = null;
  try{ v = localStorage.getItem(DENSITY_KEY); }catch(e){ v = null; }
  return v === "relaxed" ? "relaxed" : "standard";
}

export function initListDensity(){
  document.body.dataset.listDensity = readDensity();
  syncDensitySegs();
}

export function listDensitySegHTML(cls){
  return '<div class="seg mini' + (cls ? " " + cls : "") + '" role="group" aria-label="列表密度">' +
    Object.keys(DENSITY_NAMES).map(function(k){
      return '<button type="button" data-list-density="' + k + '" aria-pressed="' + (readDensity() === k) + '">' +
        DENSITY_NAMES[k] + '</button>';
    }).join("") + '</div>';
}

/* 常驻头部的段控（我的工作）和随渲染生成的段控（两个工作页）长相一致，统一按当前档位回写选中态 */
function syncDensitySegs(){
  var cur = readDensity();
  document.querySelectorAll("[data-list-density]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.listDensity === cur));
  });
}

document.addEventListener("click", function(e){
  var btn = e.target.closest("[data-list-density]");
  if(!btn) return;
  try{ localStorage.setItem(DENSITY_KEY, btn.dataset.listDensity === "relaxed" ? "relaxed" : "standard"); }
  catch(err){ /* 受限环境只改本次会话的档位 */ }
  document.body.dataset.listDensity = readDensity();
  syncDensitySegs();
});
