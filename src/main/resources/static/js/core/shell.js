/* core/shell · 侧栏收起 */

import { $ } from "./dom.js";
import { icon } from "./icons.js";

function toggleRail(){
  var on = document.body.classList.toggle("side-rail");
  try{ localStorage.setItem("ds.rail", on ? "1" : "0"); }catch(err){ /* 隐私模式忽略 */ }
}
if($("btnRail")) $("btnRail").addEventListener("click", toggleRail);
(function railTips(){
  var nav = $("sideNav");
  if(!nav) return;
  var tip = document.createElement("div");
  tip.className = "rail-tip";
  document.body.appendChild(tip);
  var show = function(item){
    var label = item.querySelector(".nl");
    if(!label) return;
    var r = item.getBoundingClientRect();
    tip.textContent = label.textContent.trim();
    tip.style.top = Math.round(r.top + r.height / 2 - 11) + "px";
    tip.style.left = Math.round(r.right + 10) + "px";
    tip.classList.add("on");
  };
  var hide = function(){ tip.classList.remove("on"); };
  nav.addEventListener("mousemove", function(e){
    if(!document.body.classList.contains("side-rail")){ hide(); return; }
    var item = e.target.closest(".nav-item");
    if(item) show(item); else hide();
  });
  nav.addEventListener("mouseleave", hide);
  nav.addEventListener("click", hide);
  document.addEventListener("click", function(e){
    if(!nav.contains(e.target)) hide();
  });
})();
(function hydrateIcons(){
  document.querySelectorAll("[data-icon]").forEach(function(el){
    el.innerHTML = icon(el.getAttribute("data-icon"), 16);
  });
})();

export { toggleRail };
