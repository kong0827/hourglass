/* ==========================================================================
   ui.js · 通用交互组件（ui-redesign-spec §4.8–4.13）
   Toast / Modal / Confirm / Popover / Tooltip / 焦点陷阱 / 单例浮层管理
   ========================================================================== */
(function () {
  "use strict";

  var esc = window.esc;
  function esc2(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ==================== Toast（§4.9） ==================== */
  var DURATION = { "": 3000, fs: 3000, warn: 4000, bad: 6000 };
  var TICON = { "": "infoCircle", fs: "checkCircle", warn: "alert", bad: "alertCircle" };

  function buildToast(msg, kind, actionLabel, onAction, timeout) {
    var wrap = document.getElementById("toastWrap");
    if (!wrap) return null;
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");

    var ic = document.createElement("span");
    ic.className = "tic";
    ic.innerHTML = window.icon(TICON[kind] || TICON[""], 16);
    el.appendChild(ic);

    var txt = document.createElement("span");
    txt.className = "tmsg";
    txt.textContent = msg;
    el.appendChild(txt);

    var timer = null;
    function close() {
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.add("out");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }

    if (actionLabel) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tact";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () { close(); if (onAction) onAction(); });
      el.appendChild(btn);
    }

    var x = document.createElement("button");
    x.type = "button";
    x.className = "tclose";
    x.setAttribute("aria-label", "关闭提示");
    x.innerHTML = window.icon("close", 12);
    x.addEventListener("click", close);
    el.appendChild(x);

    var bar = document.createElement("span");
    bar.className = "tbar";
    el.appendChild(bar);

    wrap.appendChild(el);

    var ms = timeout || DURATION[kind] || 3000;
    bar.style.transition = "width " + ms + "ms linear";
    bar.style.width = "100%";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bar.style.width = "0%"; });
    });
    timer = setTimeout(close, ms);
    return close;
  }

  function toast(msg, kind) { return buildToast(msg, kind, null, null, 0); }
  /* 撤销窗口统一 8 秒（O-17：单删与批量撤销此前 6s/8s 不一致） */
  function toastAction(msg, label, fn, kind, timeout) {
    return buildToast(msg, kind, label, fn, timeout || 8000);
  }

  /* ==================== 弹窗基础设施（§4.8） ==================== */
  var MODALS = null;
  var lastFocus = null;

  function modalEls() {
    if (!MODALS) {
      MODALS = ["dlgWsCreate", "dlgViewName", "dlgWsDelete", "dlgUserPwd", "dlgConfirm", "dlgGanttShare",
        "dlgNewReqDoc", "dlgReqDocClose", "dlgAiSplit", "dlgAiAudit", "dlgBranch"]
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean);
    }
    return MODALS;
  }
  function anyModalOpen() {
    var open = modalEls().some(function (m) { return m.classList.contains("open"); });
    if (open) return true;
    var d = document.getElementById("taskDrawer");
    return !!(d && d.classList.contains("on"));
  }
  function anyDialogOpen() { return modalEls().some(function (m) { return m.classList.contains("open"); }); }

  function focusables(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function openModal(m, focusSel) {
    if (!m) return;
    lastFocus = document.activeElement;
    m.classList.add("open");
    var target = focusSel ? m.querySelector(focusSel) : (m.querySelector("input:not([type=hidden]),textarea,select") || focusables(m)[0]);
    setTimeout(function () { try { if (target) target.focus(); } catch (e) { /* noop */ } }, 40);
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.remove("open");
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* noop */ } }
    lastFocus = null;
  }
  /* 关闭最上层弹窗，返回是否关闭了东西 */
  function closeTopModal() {
    var els = modalEls();
    for (var i = els.length - 1; i >= 0; i--) {
      if (els[i].classList.contains("open")) { closeModal(els[i]); return true; }
    }
    return false;
  }

  /* 焦点陷阱 + 遮罩关闭（仅当 pointerdown 起点就在遮罩上，避免拖选文本误关） */
  function wireModal(m, onClose) {
    if (!m) return;
    var downOnBackdrop = false;
    m.addEventListener("pointerdown", function (e) { downOnBackdrop = (e.target === m); });
    m.addEventListener("click", function (e) { if (e.target === m && downOnBackdrop) onClose(); });
    m.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = focusables(m.querySelector(".sheet") || m);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---- 统一确认框 ---- */
  var confirmResolve = null;
  function showConfirm(opts) {
    var dlg = document.getElementById("dlgConfirm");
    if (!dlg) return Promise.resolve(false);
    if (dlg.classList.contains("open")) return Promise.resolve(false);
    opts = opts || {};
    var danger = opts.danger !== false;
    document.getElementById("dlgConfirmTitle").textContent = opts.title || "确认操作";
    document.getElementById("dlgConfirmMsg").innerHTML = opts.msg || "";
    var ic = document.getElementById("dlgConfirmIc");
    if (ic) ic.className = "confirm-ic " + (danger ? "danger" : "info");
    var ok = document.getElementById("dlgConfirmOk");
    ok.textContent = opts.okText || "确定";
    ok.className = danger ? "btn danger-solid" : "btn primary";
    var cancel = document.getElementById("dlgConfirmCancel");
    if (cancel) cancel.textContent = opts.cancelText || "取消";
    openModal(dlg);
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  function settleConfirm(v) {
    var dlg = document.getElementById("dlgConfirm");
    if (dlg && dlg.classList.contains("open")) closeModal(dlg);
    var r = confirmResolve; confirmResolve = null;
    if (r) r(v);
  }
  function confirmOpen() {
    var dlg = document.getElementById("dlgConfirm");
    return !!(dlg && dlg.classList.contains("open"));
  }

  /* ==================== Popover / DropdownMenu（§4.10） ==================== */
  var openPops = [];
  function closeAllPops() {
    while (openPops.length) {
      var p = openPops.pop();
      try { p.close(); } catch (e) { /* noop */ }
    }
  }
  /**
   * 展开一个浮层。
   * 注意「是否已展开」用内部标记 __popOpen 判断，不能用 el.hidden：
   * 动态新建的元素 hidden 本来就是 false，用它判断会导致浮层永远打不开。
   * @param {HTMLElement} el     浮层元素（.menu / .ws-menu）
   * @param {HTMLElement} anchor 触发按钮
   * @param {{onClose:Function, align:string, width:number}} [opts]
   */
  function openPop(el, anchor, opts) {
    if (!el || !anchor) return;
    opts = opts || {};
    if (el.__popOpen) { return; } // 已展开
    closeAllPops();
    el.__popOpen = true;
    el.hidden = false;
    anchor.setAttribute("aria-expanded", "true");

    if (opts.width) el.style.width = opts.width + "px";
    if (el.parentNode !== document.body) document.body.appendChild(el);
    el.style.position = "fixed";
    el.style.visibility = "hidden";

    function place() {
      var r = anchor.getBoundingClientRect();
      var w = el.offsetWidth, h = el.offsetHeight;
      var left = (opts.align === "left") ? r.left : r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      var top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, r.top - h - 6);
      }
      el.style.left = left + "px";
      el.style.top = top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.visibility = "";
    }
    place();

    function onDown(e) {
      if (el.contains(e.target) || anchor.contains(e.target)) return;
      close();
    }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    function onScroll() { place(); }
    function close() {
      if (!el.__popOpen) return;
      el.__popOpen = false;
      el.hidden = true;
      anchor.setAttribute("aria-expanded", "false");
      el.style.left = el.style.top = el.style.width = "";
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      var i = openPops.indexOf(rec);
      if (i >= 0) openPops.splice(i, 1);
      if (opts.onClose) opts.onClose();
    }
    var rec = { close: close, el: el, anchor: anchor };
    openPops.push(rec);

    setTimeout(function () {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
    }, 0);
    return close;
  }
  function popOpen(el) { return !!(el && el.__popOpen); }

  /* ==================== Tooltip（§4.13） ==================== */
  var tipEl = null, tipTimer = null;
  function showTip(anchor, text) {
    hideTip();
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    var r = anchor.getBoundingClientRect();
    var tr = tipEl.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 8));
    var top = r.bottom + 6;
    if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 6;
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }
  function hideTip() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
  }
  function wireTooltips(root) {
    (root || document).querySelectorAll("[data-tip]").forEach(function (el) {
      if (el.__tipWired) return;
      el.__tipWired = true;
      el.addEventListener("pointerenter", function () {
        var t = el.getAttribute("data-tip");
        if (!t) return;
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(function () { showTip(el, t); }, 400);
      });
      el.addEventListener("pointerleave", hideTip);
      el.addEventListener("focus", function () {
        var t = el.getAttribute("data-tip");
        if (t) showTip(el, t);
      });
      el.addEventListener("blur", hideTip);
      el.addEventListener("click", hideTip);
    });
  }

  /* ==================== 空态 / 骨架（§4.11 §4.12） ==================== */
  function emptyState(opts) {
    opts = opts || {};
    var ic = opts.icon || "inbox";
    var h = '<div class="empty-state' + (opts.compact ? " compact" : "") + '">' +
      '<span class="es-ic">' + window.icon(ic, 48) + '</span>' +
      '<h3>' + esc2(opts.title || "暂无数据") + '</h3>' +
      (opts.text ? '<p>' + opts.text + '</p>' : "");
    if (opts.actionLabel) {
      h += '<button class="btn ' + (opts.actionKind || "") + '" type="button" data-empty-action="1">' + esc2(opts.actionLabel) + '</button>';
    }
    return h + '</div>';
  }
  function errorState(msg) {
    return '<div class="empty-state">' +
      '<span class="es-ic">' + window.icon("alertCircle", 48) + '</span>' +
      '<h3>加载失败</h3>' +
      '<p>' + esc2(msg || "网络异常，请稍后重试") + '</p>' +
      '<button class="btn" type="button" data-empty-action="1">重试</button>' +
      '</div>';
  }
  function skeletonCards(n) {
    var h = "";
    for (var i = 0; i < (n || 3); i++) h += '<div class="skel skel-card"></div>';
    return h;
  }
  function skeletonRows(n) {
    var h = "";
    for (var i = 0; i < (n || 8); i++) h += '<div class="skel skel-row"></div>';
    return h;
  }

  /* ==================== 刷新进度条 ==================== */
  var syncCount = 0;
  function syncBusy(on) {
    syncCount = Math.max(0, syncCount + (on ? 1 : -1));
    var bar = document.getElementById("syncBar");
    if (bar) bar.classList.toggle("on", syncCount > 0);
  }

  /* ==================== 剪贴板 ==================== */
  function copyText(text, okMsg, failMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(okMsg || "已复制到剪贴板", "fs"); }
      catch (e) { toast(failMsg || "复制失败，请手动复制", "bad"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast(okMsg || "已复制到剪贴板", "fs"); },
        fallback
      );
    } else { fallback(); }
  }

  /* ==================== 弹窗按钮接线 ==================== */
  function wire() {
    var dlgConfirm = document.getElementById("dlgConfirm");
    if (dlgConfirm) {
      document.getElementById("dlgConfirmOk").addEventListener("click", function () { settleConfirm(true); });
      document.getElementById("dlgConfirmCancel").addEventListener("click", function () { settleConfirm(false); });
      document.getElementById("dlgConfirmX").addEventListener("click", function () { settleConfirm(false); });
      wireModal(dlgConfirm, function () { settleConfirm(false); });
    }
    [["dlgWsCreate", ["dlgWsCreateX", "dlgWsCreateCancel"]],
     ["dlgViewName", ["dlgViewNameX", "dlgViewNameCancel"]],
     ["dlgWsDelete", ["dlgWsDeleteX", "dlgWsDeleteCancel"]],
     ["dlgUserPwd", ["dlgUserPwdX", "dlgUserPwdCancel"]],
     ["dlgGanttShare", ["ganttShareClose"]]].forEach(function (pair) {
      var m = document.getElementById(pair[0]);
      if (!m) return;
      pair[1].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.addEventListener("click", function () { closeModal(m); });
      });
      wireModal(m, function () { closeModal(m); });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else { wire(); }

  window.UI = {
    esc: esc2,
    toast: toast,
    toastAction: toastAction,
    showConfirm: showConfirm,
    settleConfirm: settleConfirm,
    confirmOpen: confirmOpen,
    openModal: openModal,
    closeModal: closeModal,
    closeTopModal: closeTopModal,
    anyModalOpen: anyModalOpen,
    anyDialogOpen: anyDialogOpen,
    openPop: openPop,
    closeAllPops: closeAllPops,
    popOpen: popOpen,
    hideTip: hideTip,
    wireTooltips: wireTooltips,
    emptyState: emptyState,
    errorState: errorState,
    skeletonCards: skeletonCards,
    skeletonRows: skeletonRows,
    syncBusy: syncBusy,
    copyText: copyText
  };
})();
