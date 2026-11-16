/* lib/people-picker · 分配人员浮层：按公司分组 + 主岗位 / 兼岗，搜索 / 键盘 / 加载 / 失败 / 历史不可选。
   公司与岗位只是展示属性，不参与鉴权与候选口径；复用 UI.openPop 定位与移动端底部浮层。 */
import { UI, esc } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { avatarHTML } from "./format.js";
import { companyColor, companyNameOf } from "./company.js";
import { effectiveMemberRole, memberRoleTitles } from "./member-labels.js";

var SHEET_QUERY = "(max-width:700px)";
function isSheetMode(){ return window.matchMedia(SHEET_QUERY).matches; }

/* 把任意成员对象（项目花名册 / 空间成员）映射为浮层候选：role 为主岗位，secondary 为兼岗。 */
export function memberToOption(m){
  var role = effectiveMemberRole(m);
  return {
    id: m && (m.userId || m.id) || "",
    name: m && (m.displayName || m.username || m.userId || m.id) || "",
    company: companyNameOf(m),
    role: role,
    secondary: memberRoleTitles(m).filter(function(t){ return t !== role; })
  };
}
export function roleText(o){ return (o && o.role) || "未设岗位"; }
export function optionSubText(o){ return ((o && o.company) || "未标注公司") + " · " + roleText(o); }

/* 表单里的「人员字段」按钮内容：头像 + 姓名 + 公司·岗位副标题 + 下拉箭头。
   o.textOnly 表示历史「非成员」姓名（无账号绑定）；o.subText 覆盖副标题（候选加载中 / 已不在范围）。 */
export function peopleFieldHTML(o, emptyLabel){
  if(!o || (!o.id && !o.name)){
    return '<span class="avatar none" aria-hidden="true">' + icon("user", 15) + '</span>' +
      '<span class="pf-main"><span class="pf-name"><span class="nm">' + esc(emptyLabel || "未指派") + '</span></span>' +
      '<span class="pf-sub">点击选择成员</span></span>' +
      '<span class="pf-chev" aria-hidden="true">' + icon("caretDown", 14) + '</span>';
  }
  var subText = o.subText ? o.subText : (o.textOnly ? "非成员 · 手动填写" : optionSubText(o));
  var dot = o.company ? companyColor(o.company) : "transparent";
  return avatarHTML(o.name) +
    '<span class="pf-main"><span class="pf-name"><span class="nm">' + esc(o.name) + '</span></span>' +
    '<span class="pf-sub"><i style="background:' + dot + '"></i>' + esc(subText) + '</span></span>' +
    '<span class="pf-chev" aria-hidden="true">' + icon("caretDown", 14) + '</span>';
}

function groupsOf(list){
  var map = Object.create(null), groups = [];
  list.forEach(function(o){
    var label = o.company || "未标注公司";
    if(!map[label]){ map[label] = { label:label, items:[] }; groups.push(map[label]); }
    map[label].items.push(o);
  });
  groups.sort(function(a, b){
    if(a.label === b.label) return 0;
    if(a.label === "未标注公司") return 1;
    if(b.label === "未标注公司") return -1;
    return a.label.localeCompare(b.label, "zh");
  });
  return groups;
}

var activeEl = null;
/* cfg: { anchor, title, options, currentId, currentName, allowClear, clearLabel, foot,
          loading, error, onRetry, unavailable:{id,name}, onPick(option|null) }
   返回 { el, refresh(partial), close }；refresh 用于花名册异步就绪后原地刷新。 */
export function openPeoplePicker(cfg){
  if(activeEl && UI.popOpen(activeEl)){ UI.closeAllPops(); return null; }
  var anchor = cfg.anchor;
  if(!anchor) return null;
  var cur = {
    title: cfg.title || "选择成员", options: cfg.options || [], currentId: cfg.currentId || "",
    currentName: cfg.currentName || "", allowClear: !!cfg.allowClear, clearLabel: cfg.clearLabel || "未分配",
    foot: cfg.foot, loading: !!cfg.loading, error: cfg.error || "", unavailable: cfg.unavailable || null
  };
  var query = "";
  var el = document.createElement("div");
  el.className = "menu search-picker people-picker";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", cur.title);
  var listId = "pp-list-" + Math.random().toString(36).slice(2, 8);
  el.innerHTML =
    '<div class="search-picker-head">' +
      '<div class="search-picker-search">' + icon("search", 15) +
        '<input type="text" placeholder="搜索姓名 / 公司 / 岗位…" aria-label="搜索成员" role="combobox" aria-expanded="true" aria-controls="' + listId + '" autocomplete="off" spellcheck="false">' +
        '<button class="pp-clear-search" type="button" aria-label="清除搜索" hidden>' + icon("close", 12) + '</button>' +
      '</div>' +
      '<div class="search-picker-tools"><span class="pp-count" aria-live="polite"></span></div>' +
    '</div>' +
    '<div class="search-picker-results" id="' + listId + '" role="listbox" aria-label="' + esc(cur.title) + '"></div>' +
    '<div class="search-picker-foot">' + (cur.foot || '<b>岗位</b> = 本项目有效岗位（项目覆盖优先，否则沿用空间默认）；兼岗另列。仅展示，不改变权限。') + '</div>';
  var input = el.querySelector("input");
  var clearSearchBtn = el.querySelector(".pp-clear-search");
  var results = el.querySelector(".search-picker-results");
  var count = el.querySelector(".pp-count");

  function matches(o){
    var q = query.trim().toLowerCase();
    if(!q) return true;
    return (o.name + " " + (o.company || "") + " " + (o.role || "") + " " + (o.secondary || []).join(" ")).toLowerCase().indexOf(q) !== -1;
  }
  function optionHTML(o){
    var on = cur.currentId === o.id;
    var meta = '<span class="role' + (o.role ? "" : " unset") + '">' + esc(roleText(o)) + '</span>';
    (o.secondary || []).forEach(function(s){ meta += '<span class="pp-side">兼 ' + esc(s) + '</span>'; });
    return '<button class="pp-opt' + (on ? " selected" : "") + '" type="button" role="option" aria-selected="' + on + '" data-pick="' + esc(o.id) + '">' +
      avatarHTML(o.name) +
      '<span class="pp-opt-main"><span class="pp-opt-name"><span class="nm">' + esc(o.name) + '</span></span>' +
      '<span class="pp-opt-meta">' + meta + '</span></span>' +
      (on ? '<span class="pp-check">' + icon("check", 14) + '当前</span>' : '') + '</button>';
  }
  function render(){
    clearSearchBtn.hidden = !query;
    if(cur.loading){
      count.innerHTML = '<span class="pp-title">' + esc(cur.title) + '</span>正在确认本项目可指派成员…';
      var sk = "";
      for(var i = 0; i < 4; i++) sk += '<div class="pp-skel"><span class="av"></span><span class="ln"></span><span class="ln short"></span></div>';
      results.innerHTML = '<div class="pp-loading">' + sk + '</div><div class="pp-loading-note"><span class="spin"></span>候选来自本项目花名册，稍候…</div>';
      return;
    }
    if(cur.error){
      count.innerHTML = '<span class="pp-title">' + esc(cur.title) + '</span>候选加载失败';
      results.innerHTML = '<div class="pp-error">候选加载失败：' + esc(cur.error.message || cur.error || "网络异常") +
        '<br><button class="btn sm" type="button" data-retry>重试</button></div>';
      return;
    }
    var filtered = cur.options.filter(matches);
    var groups = groupsOf(filtered);
    var html = "";
    if(cur.unavailable && cur.unavailable.id){
      html += '<button class="pp-opt" type="button" role="option" aria-selected="true" disabled data-pick="__retained__">' +
        avatarHTML(cur.unavailable.name || cur.currentName || cur.unavailable.id) +
        '<span class="pp-opt-main"><span class="pp-opt-name"><span class="nm">' + esc(cur.unavailable.name || cur.currentName || cur.unavailable.id) + '</span><span class="pp-side">当前不可选</span></span>' +
        '<span class="pp-opt-meta"><span class="role unset">已不在本项目候选范围</span></span></span>' +
        '<span class="pp-check">' + icon("check", 14) + '当前</span></button>' +
        '<div class="pp-retained-note">' + icon("alert", 12) + '<span>保留当前负责人；重新指派请另选成员。</span></div>';
    }
    if(cur.allowClear && !query.trim()){
      var noneOn = !cur.currentId;
      html += '<button class="pp-clear' + (noneOn ? " selected" : "") + '" type="button" role="option" aria-selected="' + noneOn + '" data-pick="">' +
        '<span class="avatar none" aria-hidden="true">' + icon("user", 15) + '</span><span>' + esc(cur.clearLabel) + '</span>' +
        (noneOn ? '<span class="pp-check" style="margin-left:auto">' + icon("check", 14) + '当前</span>' : '') + '</button>';
    }
    groups.forEach(function(g){
      var un = g.label === "未标注公司";
      html += '<div class="pp-group' + (un ? " unassigned" : "") + '" role="presentation"><i style="background:' + (un ? "transparent" : companyColor(g.label)) + '"></i>' +
        esc(g.label) + '<span class="n">' + g.items.length + ' 人</span></div>';
      g.items.forEach(function(o){ html += optionHTML(o); });
    });
    if(!filtered.length){
      html = '<div class="pp-empty">没有匹配「' + esc(query.trim()) + '」的成员<br><button class="btn sm" type="button" data-clearq>清除搜索</button></div>';
    }
    results.innerHTML = html;
    var companyN = groupsOf(cur.options).length;
    count.innerHTML = '<span class="pp-title">' + esc(cur.title) + '</span>' +
      (query.trim() ? '匹配 ' + filtered.length + ' 人' : cur.options.length + ' 位可指派 · ' + companyN + ' 家公司');
  }
  /* 与 UI.openPop 同一套定位：刷新内容后高度变化时原地重排，移动端走底部浮层。 */
  function reposition(){
    if(isSheetMode()){
      el.style.left = "12px"; el.style.right = "12px"; el.style.top = "auto"; el.style.bottom = "12px"; el.style.width = "auto";
      return;
    }
    var r = anchor.getBoundingClientRect();
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    var top = r.bottom + 6;
    if(top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
    el.style.left = left + "px"; el.style.top = top + "px"; el.style.right = "auto"; el.style.bottom = "auto";
  }
  function optionButtons(){ return Array.prototype.slice.call(results.querySelectorAll(".pp-opt:not([disabled]),.pp-clear")); }
  function pick(id){
    if(id === "__retained__") return;
    var o = id ? cur.options.filter(function(x){ return x.id === id; })[0] : null;
    if(id && !o) return;
    UI.closeAllPops();
    if(cfg.onPick) cfg.onPick(o || null);
  }
  input.addEventListener("input", function(){ query = input.value; render(); });
  clearSearchBtn.addEventListener("click", function(){ input.value = ""; query = ""; render(); input.focus(); });
  results.addEventListener("click", function(e){
    if(e.target.closest("[data-retry]")){ if(cfg.onRetry) cfg.onRetry(); return; }
    if(e.target.closest("[data-clearq]")){ input.value = ""; query = ""; render(); input.focus(); return; }
    var b = e.target.closest("[data-pick]");
    if(b && !b.disabled) pick(b.dataset.pick);
  });
  el.addEventListener("keydown", function(e){
    if(e.key === "Tab"){
      var focusable = Array.prototype.slice.call(el.querySelectorAll('input:not([disabled]),button:not([disabled])')).filter(function(n){ return n.offsetParent !== null; });
      if(!focusable.length){ e.preventDefault(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      return;
    }
    if(e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End"){
      var buttons = optionButtons();
      if(!buttons.length) return;
      e.preventDefault();
      var index = buttons.indexOf(document.activeElement);
      var next;
      if(e.key === "Home") next = 0;
      else if(e.key === "End") next = buttons.length - 1;
      else if(e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % buttons.length;
      else next = index <= 0 ? buttons.length - 1 : index - 1;
      buttons[next].focus();
    }
  });
  activeEl = el;
  UI.openPop(el, anchor, {
    align: "left", width: Math.min(344, window.innerWidth - 24), sheet: true,
    onClose: function(){ if(activeEl === el) activeEl = null; el.remove(); }
  });
  render();
  setTimeout(function(){ if(UI.popOpen(el)) input.focus(); }, 40);
  return {
    el: el,
    refresh: function(partial){
      if(!UI.popOpen(el)) return;
      Object.keys(partial || {}).forEach(function(k){ cur[k] = partial[k]; });
      render(); reposition();
    },
    close: function(){ if(UI.popOpen(el)) UI.closeAllPops(); }
  };
}