/* date-picker.js · 桌面端自绘日期 / 时间选择
   原生 input[type=date] 在网络面板之外仍是系统日历，字号 / 圆角 / 高亮都不受控；
   这里在桌面端接管点击，弹出自绘面板，值仍写回原 input 并派发 input/change，
   因此所有既有读取 .value 的逻辑无需改动。移动端保留原生控件（系统日历体验更好）。
   值格式：date → YYYY-MM-DD；datetime-local → YYYY-MM-DDTHH:mm。 */
import { UI } from "./ui.js";

var WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
var PANEL_W = 272;

function pad(n) { return (n < 10 ? "0" : "") + n; }
function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseIso(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}
function timeOf(s) {
  var m = /T(\d{2}):(\d{2})/.exec(s || "");
  return m ? (m[1] + ":" + m[2]) : "";
}
function nowTime() {
  var d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function sameDay(a, b) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/* 移动布局由 layout.js 写在 body[data-layout] 上；窄视口同样保留原生 */
function shouldUseNative() {
  if (document.body && document.body.getAttribute("data-layout") === "mobile") return true;
  try { return window.matchMedia("(max-width:700px)").matches; } catch (e) { return false; }
}
/* 位于筛选等浮层内的日期输入暂不接管：浮层由 UI.openPop 管理，
   打开独立面板会连带关闭宿主菜单，导致输入框失效。 */
function insidePopover(el) {
  return !!(el.closest && el.closest(".menu"));
}
function isSupportedInput(el) {
  return el && el.tagName === "INPUT" && (el.type === "date" || el.type === "datetime-local");
}
function commit(input, value) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

var active = null;   // { el, close }

function closeActive() {
  if (!active) return;
  var rec = active;
  active = null;
  try { rec.close(true); } catch (e) { /* noop */ }
}

function iconChevron(dir) {
  var d = dir < 0 ? "M12.5 4 7 10l5.5 6" : "M7.5 4 13 10l-5.5 6";
  return '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
}
function iconDouble(dir) {
  var d = dir < 0 ? "M10.5 4 5 10l5.5 6M16 4l-5.5 6L16 16" : "M9.5 4 15 10l-5.5 6M4 4l5.5 6L4 16";
  return '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
}

/**
 * 生成日期面板。
 * @param {{type:string, value:string, min?:string, max?:string, keepOpen?:boolean, onPick:Function}} opts
 * @returns {HTMLElement}
 */
function buildPanel(opts) {
  var isDateTime = opts.type === "datetime-local";
  var today = new Date();
  var selected = parseIso(opts.value);
  var view = new Date((selected || today).getFullYear(), (selected || today).getMonth(), 1);
  var time = timeOf(opts.value) || nowTime();
  var min = opts.min ? parseIso(opts.min) : null;
  var max = opts.max ? parseIso(opts.max) : null;

  var el = document.createElement("div");
  el.className = "menu date-pop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "选择日期" + (isDateTime ? "和时间" : ""));
  el.style.width = PANEL_W + "px";

  function valueFor(dayIso) {
    return isDateTime ? (dayIso + "T" + time) : dayIso;
  }
  function apply(value) {
    opts.onPick(value);
    if (opts.keepOpen) render();
    else closeActive();
  }
  function render() {
    var first = new Date(view.getFullYear(), view.getMonth(), 1);
    var offset = (first.getDay() + 6) % 7;              // 周一开头
    var start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var dayIso = isoOf(d);
      var cls = "dp-day";
      if (d.getMonth() !== view.getMonth()) cls += " is-out";
      if (sameDay(d, today)) cls += " is-today";
      if (sameDay(d, selected)) cls += " is-sel";
      var outOfRange = (min && d < min) || (max && d > max);
      cells.push('<button class="' + cls + '" type="button" data-dp-day="' + dayIso + '"' +
        (outOfRange ? " disabled" : "") + ' aria-label="' + dayIso + '">' + d.getDate() + "</button>");
    }
    el.innerHTML =
      '<div class="dp-head">' +
        '<button class="dp-nav" type="button" data-dp-year="-1" aria-label="上一年">' + iconDouble(-1) + "</button>" +
        '<button class="dp-nav" type="button" data-dp-month="-1" aria-label="上个月">' + iconChevron(-1) + "</button>" +
        '<span class="dp-title" aria-live="polite">' + view.getFullYear() + "年" + (view.getMonth() + 1) + "月</span>" +
        '<button class="dp-nav" type="button" data-dp-month="1" aria-label="下个月">' + iconChevron(1) + "</button>" +
        '<button class="dp-nav" type="button" data-dp-year="1" aria-label="下一年">' + iconDouble(1) + "</button>" +
      "</div>" +
      '<div class="dp-week">' + WEEK_LABELS.map(function (w) { return "<span>" + w + "</span>"; }).join("") + "</div>" +
      '<div class="dp-grid">' + cells.join("") + "</div>" +
      (isDateTime
        ? '<div class="dp-timebar"><span>时间</span><input type="text" inputmode="numeric" maxlength="5" data-dp-time value="' + time + '" placeholder="HH:mm" aria-label="时间（24 小时制）"><span class="dp-time-hint">24 小时制</span></div>'
        : "") +
      '<div class="dp-foot">' +
        '<button class="btn sm ghost" type="button" data-dp-clear>清空</button>' +
        '<button class="btn sm" type="button" data-dp-today>今天</button>' +
        (isDateTime
          ? '<button class="btn sm primary dp-done" type="button" data-dp-done>完成</button>'
          : "") +
      "</div>";
  }
  render();

  el.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t || !el.contains(t)) return;
    var y = t.getAttribute("data-dp-year");
    var m = t.getAttribute("data-dp-month");
    if (y) { view.setFullYear(view.getFullYear() + Number(y)); render(); return; }
    if (m) { view.setMonth(view.getMonth() + Number(m)); render(); return; }
    if (t.hasAttribute("data-dp-clear")) { opts.onPick(""); closeActive(); return; }
    if (t.hasAttribute("data-dp-done")) { closeActive(); return; }
    if (t.hasAttribute("data-dp-today")) {
      selected = new Date();
      apply(valueFor(isoOf(selected)));
      return;
    }
    var day = t.getAttribute("data-dp-day");
    if (day) {
      selected = parseIso(day);
      apply(valueFor(day));
    }
  });

  el.addEventListener("input", function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute("data-dp-time")) return;
    var v = t.value.replace(/[^\d:]/g, "").slice(0, 5);
    if (v.length === 4 && v.indexOf(":") === -1) v = v.slice(0, 2) + ":" + v.slice(2);
    t.value = v;
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    var h = Number(v.slice(0, 2)), mm = Number(v.slice(3, 5));
    if (h > 23 || mm > 59) return;
    time = v;
    if (selected) opts.onPick(valueFor(isoOf(selected)));
  });
  el.addEventListener("blur", function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute("data-dp-time")) return;
    if (!/^\d{2}:\d{2}$/.test(t.value)) t.value = time;
  }, true);

  return el;
}

/* 绑定到原生 input：保留 value / 事件契约，只替换弹层 */
function open(input) {
  if (active && active.input === input) return;
  closeActive();
  input.readOnly = true;                      // 桌面端阻止手输，避免与面板值冲突
  input.setAttribute("data-dp", "1");
  input.setAttribute("aria-haspopup", "dialog");

  var el = buildPanel({
    type: input.type,
    value: input.value,
    min: input.min,
    max: input.max,
    keepOpen: input.type === "datetime-local",
    onPick: function (v) {
      if (!document.contains(input)) { closeActive(); return; }
      commit(input, v);
    }
  });
  var close = UI.openPop(el, input, {
    align: "left",
    onClose: function () {
      el.remove();
      if (active && active.el === el) active = null;
    }
  });
  active = { input: input, el: el, close: close };
  try { input.focus({ preventScroll: true }); } catch (e) { /* noop */ }
}

/**
 * 在指定位置打开日期面板（不依赖 input，供 .due-pop 等自定义浮层使用）。
 * @param {{left:number,top:number,bottom:number}} rect 触发按钮的视口坐标
 * @param {{value?:string,type?:string,min?:string,max?:string,onPick:Function,onClose?:Function}} opts
 */
export function openDateAt(rect, opts) {
  opts = opts || {};
  var ghost = document.createElement("div");
  ghost.style.cssText = "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;width:1px;height:1px;pointer-events:none;";
  document.body.appendChild(ghost);

  var el = buildPanel({
    type: opts.type || "date",
    value: opts.value || "",
    min: opts.min,
    max: opts.max,
    keepOpen: false,
    onPick: opts.onPick || function () {}
  });
  var close = UI.openPop(el, ghost, {
    align: "left",
    onClose: function () {
      el.remove();
      ghost.remove();
      if (active && active.el === el) active = null;
      if (opts.onClose) opts.onClose();
    }
  });
  active = { el: el, close: close };
}

document.addEventListener("click", function (e) {
  var input = e.target.closest ? e.target.closest('input[type="date"],input[type="datetime-local"]') : null;
  if (!isSupportedInput(input) || input.disabled) return;
  if (shouldUseNative()) {
    /* 曾经在桌面端打开过（被设成 readOnly），切回窄屏 / 移动布局时还原原生可输入 */
    if (input.hasAttribute("data-dp")) { input.readOnly = false; input.removeAttribute("data-dp"); }
    return;
  }
  if (insidePopover(input)) return;
  e.preventDefault();                         // 阻止原生日历弹层
  open(input);
}, true);

document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  var input = document.activeElement;
  if (!isSupportedInput(input) || input.disabled) return;
  if (shouldUseNative() || insidePopover(input)) return;
  e.preventDefault();
  open(input);
}, true);
