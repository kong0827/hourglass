/* select-picker.js · 桌面端自绘下拉
   原生 <select> 的选项弹层由系统绘制，字号 / 行高 / 高亮都不受控；
   这里在桌面端接管点击、键盘与输入首字母，弹出自绘列表，
   选中后仍写回原 select 并派发 input/change，既有读取 .value 的逻辑无需改动。
   移动端保留原生控件（系统选择器体验更好）。
   不接管：multiple / size>1 / disabled，以及浮层内的 select（浮层会被 UI.openPop 连带关闭）。 */
import { UI } from "./ui.js";
import { icon } from "./icons.js";

var SEARCH_MIN = 9;      // 选项多于该数量才给搜索框，短列表直接点更顺手
var PANEL_MIN_W = 180;
var PANEL_MAX_W = 420;

var active = null;       // { select, el, close }

function shouldUseNative() {
  if (document.body && document.body.getAttribute("data-layout") === "mobile") return true;
  try { return window.matchMedia("(max-width:700px)").matches; } catch (e) { return false; }
}
function insidePopover(el) {
  return !!(el.closest && el.closest(".menu, .select-pop, .date-pop"));
}
function isSelect(el) {
  return !!el && el.tagName === "SELECT" && !el.multiple && (!el.size || el.size <= 1) && !el.disabled;
}
function closeActive() {
  if (!active) return;
  var rec = active;
  active = null;
  try { rec.close(true); } catch (e) { /* noop */ }
}

/* 把 option / optgroup 摊平成渲染描述，保留分组顺序 */
function collectRows(sel) {
  var rows = [];
  Array.prototype.forEach.call(sel.children, function (node) {
    if (node.tagName === "OPTGROUP") {
      rows.push({ kind: "group", label: node.label || "" });
      Array.prototype.forEach.call(node.children, function (o) {
        if (o.tagName === "OPTION") rows.push(optRow(o));
      });
    } else if (node.tagName === "OPTION") {
      rows.push(optRow(node));
    }
  });
  return rows;
}
function optRow(o) {
  return {
    kind: "opt",
    value: o.value,
    label: (o.label || o.textContent || "").trim(),
    disabled: !!o.disabled,
    selected: !!o.selected
  };
}

function buildPanel(sel, done) {
  var rows = collectRows(sel);
  var optCount = 0;
  rows.forEach(function (r) { if (r.kind === "opt") optCount++; });

  var el = document.createElement("div");
  el.className = "menu select-pop";
  el.setAttribute("role", "listbox");
  el.setAttribute("aria-label", sel.getAttribute("aria-label") || "选择");
  el.tabIndex = -1;

  var search = null;
  if (optCount > SEARCH_MIN) {
    var sw = document.createElement("div");
    sw.className = "sp-search";
    search = document.createElement("input");
    search.className = "input sp-input";
    search.type = "text";
    search.placeholder = "搜索选项…";
    search.setAttribute("aria-label", "搜索选项");
    sw.appendChild(search);
    el.appendChild(sw);
  }

  var opts = [];           // 可见的选项按钮，键盘上下移动用
  var groups = [];         // { head, items: [] }，用于整组过滤
  var currentGroup = null;

  rows.forEach(function (r, i) {
    if (r.kind === "group") {
      var head = document.createElement("div");
      head.className = "menu-sec";
      head.textContent = r.label;
      el.appendChild(head);
      currentGroup = { head: head, items: [] };
      groups.push(currentGroup);
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item sp-opt";
    b.id = "sp-opt-" + i;
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", r.selected ? "true" : "false");
    b.dataset.value = r.value;
    b.disabled = r.disabled;
    b.title = r.label;
    var label = document.createElement("span");
    label.className = "sp-label";
    label.textContent = r.label || "（空）";
    b.appendChild(label);
    var check = document.createElement("span");
    check.className = "sp-check";
    check.innerHTML = icon("check", 14);
    b.appendChild(check);
    el.appendChild(b);
    opts.push(b);
    if (currentGroup) currentGroup.items.push(b);
  });

  var empty = document.createElement("div");
  empty.className = "sp-empty";
  empty.textContent = "没有匹配的选项";
  empty.hidden = true;
  el.appendChild(empty);

  function choose(b) {
    if (!b || b.disabled) return;
    done(b.dataset.value);
  }

  el.addEventListener("click", function (e) {
    var b = e.target.closest(".sp-opt");
    if (b) choose(b);
  });

  /* 键盘：上下移动、Home/End、回车选中；Esc 交给 UI.openPop 统一关闭 */
  var idx = -1;
  function mark(i) {
    if (!opts.length) return;
    if (idx >= 0 && opts[idx]) opts[idx].classList.remove("is-active");
    idx = Math.max(0, Math.min(i, opts.length - 1));
    opts[idx].classList.add("is-active");
    el.setAttribute("aria-activedescendant", opts[idx].id);
    opts[idx].scrollIntoView({ block: "nearest" });
  }
  el.addEventListener("keydown", function (e) {
    var visible = opts.filter(function (b) { return !b.hidden; });
    if (!visible.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); step(visible, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(visible, -1); }
    else if (e.key === "Home") { e.preventDefault(); markVisible(visible, 0); }
    else if (e.key === "End") { e.preventDefault(); markVisible(visible, visible.length - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      var cur = opts[idx];
      if (cur && !cur.hidden) choose(cur);
    }
  });
  function step(visible, dir) {
    var at = visible.indexOf(opts[idx]);
    markVisible(visible, at === -1 ? (dir > 0 ? 0 : visible.length - 1) : at + dir);
  }
  function markVisible(visible, pos) {
    var target = visible[Math.max(0, Math.min(pos, visible.length - 1))];
    var gi = opts.indexOf(target);
    if (gi !== -1) mark(gi);
  }

  if (search) {
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      opts.forEach(function (b) {
        b.hidden = !!(q && b.title.toLowerCase().indexOf(q) === -1);
      });
      groups.forEach(function (g) {
        var any = g.items.some(function (b) { return !b.hidden; });
        g.head.hidden = !any;
      });
      var shown = opts.filter(function (b) { return !b.hidden; });
      empty.hidden = shown.length > 0;
      if (idx >= 0 && opts[idx] && opts[idx].hidden) idx = -1;
      if (shown.length) mark(opts.indexOf(shown[0])); else el.removeAttribute("aria-activedescendant");
    });
  }

  /* 初次把当前值滚到可视区并高亮，键盘从这里继续 */
  var selected = opts.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0];
  var first = selected || opts.filter(function (b) { return !b.disabled; })[0];
  if (first) {
    idx = opts.indexOf(first) - 1;
    mark(opts.indexOf(first));
  }
  if (search) {
    setTimeout(function () { try { search.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 0);
  } else {
    setTimeout(function () { try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 0);
  }

  return { el: el, hasSearch: !!search };
}

function commit(sel, value) {
  if (sel.value !== value) {
    sel.value = value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeActive();
}

function open(sel) {
  if (active && active.select === sel) return;
  if (!sel.options.length) return;       // 选项还没加载：交给原生 / 等下次点击
  closeActive();
  var built = buildPanel(sel, function (v) { commit(sel, v); });
  var rect = sel.getBoundingClientRect();
  var width = Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, Math.round(rect.width)));
  var close = UI.openPop(built.el, sel, {
    align: "left",
    width: width,
    onClose: function () {
      built.el.remove();
      if (active && active.el === built.el) active = null;
    }
  });
  active = { select: sel, el: built.el, close: close };
}

/* 鼠标：阻止系统下拉，改开自绘面板 */
document.addEventListener("mousedown", function (e) {
  var sel = e.target.closest ? e.target.closest("select") : null;
  if (!isSelect(sel) || shouldUseNative() || insidePopover(sel)) return;
  e.preventDefault();
  open(sel);
}, true);

/* 键盘：聚焦 select 时回车 / 空格 / 方向键打开面板 */
document.addEventListener("keydown", function (e) {
  var sel = document.activeElement;
  if (!isSelect(sel) || shouldUseNative() || insidePopover(sel)) return;
  if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    open(sel);
  }
}, true);

/* 首字母跳转：与原生行为一致，不展开面板，直接把值切到匹配项 */
var jumpBuf = "", jumpTimer = null;
document.addEventListener("keydown", function (e) {
  var sel = document.activeElement;
  if (!isSelect(sel) || shouldUseNative() || insidePopover(sel)) return;
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  jumpBuf += e.key.toLowerCase();
  clearTimeout(jumpTimer);
  jumpTimer = setTimeout(function () { jumpBuf = ""; }, 600);
  var hit = Array.prototype.find.call(sel.options, function (o) {
    return !o.disabled && (o.label || o.textContent || "").trim().toLowerCase().indexOf(jumpBuf) === 0;
  });
  if (hit) {
    e.preventDefault();
    if (sel.value !== hit.value) {
      sel.value = hit.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}, true);
