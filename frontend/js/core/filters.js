/* core/filters · 统一筛选参数（看板 / 列表 / 日历 / 甘特共用） */

import { brandSub } from "./dom.js";
import { reloadFilteredViews, toggleIn } from "./filters-ui.js";
import { VIEWS, activeView } from "./router.js";
import { rt, state, totalTaskCount } from "./state.js";

function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

var FILTER_KEYS = [
  { k: "q", kind: "text" },
  { k: "owners", kind: "list", s: "owners" },
  { k: "testOwners", kind: "list", s: "testOwners" },
  { k: "pris", kind: "list", s: "pris" },
  { k: "cats", kind: "list", s: "cats" },
  { k: "reqs", kind: "list", s: "reqs" },
  { k: "tags", kind: "list", s: "tags" },
  { k: "types", kind: "list", s: "types" },
  { k: "versions", kind: "list", s: "versions" },
  { k: "columns", kind: "list", s: "columns" },
  { k: "completion", kind: "text" },
  { k: "due", kind: "text" },
  { k: "noDue", kind: "bool" },
  { k: "dueFrom", kind: "text" },
  { k: "dueTo", kind: "text" },
  { k: "startFrom", kind: "text" },
  { k: "startTo", kind: "text" },
  { k: "focus", kind: "bool" },
  { k: "blocked", kind: "bool" },
  { k: "doneScope", kind: "text", always: true }
];
function filterSource(key){
  for(var i = 0; i < FILTER_KEYS.length; i++){
    if(FILTER_KEYS[i].k === key) return FILTER_KEYS[i];
  }
  return null;
}
function filterParams(extra){
  var p = {};
  FILTER_KEYS.forEach(function(f){
    var v = state[f.s || f.k];
    if(f.kind === "list") p[f.k] = (v && v.length) ? v.slice() : null;
    else if(f.kind === "bool") p[f.k] = v ? true : null;
    else if(f.always) p[f.k] = v;
    else p[f.k] = v || null;
  });
  if(extra){
    for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
  }
  return p;
}
function currentFilterParams(){
  var p = {};
  FILTER_KEYS.forEach(function(f){
    var v = state[f.s || f.k];
    if(f.kind === "list") p[f.k] = (v || []).slice();
    else if(f.kind === "bool") p[f.k] = !!v;
    else if(f.always) p[f.k] = v;
    /* 空值不写成 ""：视图参数按枚举白名单校验，空串会被判为非法值 */
    else p[f.k] = v || null;
  });
  return p;
}
function toggleFilterValue(key, value){
  var f = filterSource(key);
  var arr = state[(f && f.s) || key];
  if(!Array.isArray(arr)) return;
  toggleIn(arr, value);
  reloadFilteredViews();
}
function setFilterValue(key, value){
  state[key] = (state[key] === value) ? null : value;
  reloadFilteredViews();
}
function boardParams(extra){ return filterParams(extra); }
function updateBrand(){
  if(!brandSub) return;
  var wsName = rt.currentWs ? rt.currentWs.name : "";
  var viewMeta = VIEWS[activeView] || {};
  /* 驾驶舱：面包屑只表示位置，项目名由页面标题承载 */
  if(activeView === "project"){
    brandSub.classList.add("breadcrumb");
    brandSub.title = "项目 / 驾驶舱";
    brandSub.innerHTML = '<button type="button" class="crumb-link" data-crumb-view="projects" title="返回项目列表">项目</button>'
      + '<span class="sep">/</span><span>驾驶舱</span>';
    return;
  }
  var parts = [];
  if(wsName) parts.push(wsName);
  parts.push(viewMeta.title || activeView);
  if(activeView === "board" && state.board){
    var doing = state.board.columns.doing ? state.board.columns.doing.total : 0;
    parts.push(doing + " 项进行中 · 共 " + totalTaskCount() + " 项");
  }else if(viewMeta.sub){
    parts.push(viewMeta.sub);
  }
  brandSub.classList.add("breadcrumb");
  /* 每段都带 title：被省略号截断时悬停可看全文；分隔符悬停显示完整路径 */
  brandSub.title = parts.join(" / ");
  brandSub.innerHTML = parts.map(function(p, i, arr){
    return '<span title="' + esc(p) + '">' + esc(p) + '</span>' + (i < arr.length - 1 ? '<span class="sep">/</span>' : '');
  }).join("");
}
/* 面包屑可点击段：当前只用于驾驶舱返回项目列表 */
if(brandSub) brandSub.addEventListener("click", function(e){
  var b = e.target.closest("[data-crumb-view]");
  if(!b) return;
  window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:b.dataset.crumbView } }));
});

/* 列状态工作页从看板进入时沿用通用筛选语境：
   状态列与完成情况属于目标页自身维度，不随筛选带过去（否则会和被点的列冲突）。 */
var WORKPAGE_SCOPE_KEYS = ["q", "owners", "testOwners", "pris", "cats", "reqs", "tags", "types", "versions",
  "due", "noDue", "blocked", "focus", "dueFrom", "dueTo", "startFrom", "startTo"];
function workpageScopeQuery(){
  var parts = [];
  WORKPAGE_SCOPE_KEYS.forEach(function(k){
    var v = state[k];
    if(Array.isArray(v)){
      if(v.length) parts.push(k + "=" + encodeURIComponent(v.join(",")));
      return;
    }
    if(v === true) parts.push(k + "=1");
    else if(typeof v === "string" && v) parts.push(k + "=" + encodeURIComponent(v));
  });
  return parts.join("&");
}

export { boardParams, currentFilterParams, filterParams, setFilterValue, toggleFilterValue, updateBrand, workpageScopeQuery };
