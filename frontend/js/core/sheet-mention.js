/* core/sheet-mention · 表格单元格内 @提及候选
   单元格编辑器是 Univer 隐藏的 contenteditable（id __editor_ + 内部 docs 单元），
   光标定位容器以 fixed 定位贴住插入点，候选浮层按该容器坐标摆放。
   候选列表与评论 @ 同口径；写入单元格走 InsertTextCommand 替换 [@, 光标) 区间。 */

import { avatarHTML } from "../lib/format.js";
import { companyColor, companyNameOf } from "../lib/company.js";
import { effectiveMemberRole } from "../lib/member-labels.js";
import { esc } from "./ui.js";

var DOC_UNIT_ID = "__INTERNAL_EDITOR__DOCS_NORMAL";
var INPUT_ID = "__editor_" + DOC_UNIT_ID;
var CARET_HOST_ID = "univer-doc-selection-container-" + DOC_UNIT_ID;
var MAX_ITEMS = 8;
var MAX_HEIGHT = 260;
var MIN_WIDTH = 260;
var MAX_WIDTH = 380;
var GAP = 6;
var RETRY_MS = 30000;
/* 同一时刻只开一个候选框：页面里可能同时存在编辑态与预览态表格 */
var active = null;

function memberOrg(m){
  var company = companyNameOf(m);
  var role = effectiveMemberRole(m);
  return {
    hasCompany: !!company,
    text: (company || "未标注公司") + " · " + (role || "未设岗位")
  };
}

/**
 * @param {Object} opts
 *   container            表格宿主元素
 *   getInjector()        返回 Univer 根 injector
 *   canOpen()            返回 false 时不弹候选（只读 / 未在编辑文档）
 *   excludeUserId        字符串或函数：候选里排除自己
 *   loadMembers()        返回成员数组的 Promise
 * 返回 { dispose } ；Univer 版本不支持时返回 null（退化为手输完整名字）
 */
export function createSheetMention(opts){
  opts = opts || {};
  var container = opts.container;
  if(!container) return null;
  if(!(window.UniverDocsUi && window.UniverDocsUi.IEditorService
      && window.UniverDocs && window.UniverDocs.InsertTextCommand
      && window.UniverCore && window.UniverCore.ICommandService)){
    return null;
  }

  var layer = null;
  var opened = false;
  var items = [];
  var index = 0;
  var start = 0;
  var end = 0;
  var notice = "";
  var members = [];
  var loadState = "idle";
  var loading = false;
  var failedAt = 0;
  var composing = false;
  var timer = 0;
  var frame = 0;

  function selfId(){
    var v = opts.excludeUserId;
    return typeof v === "function" ? (v() || "") : (v || "");
  }

  function inputEl(){
    /* 同一页面可能同时挂多个 Univer 实例：按宿主元素限定，避免命中外层/另一份视图 */
    var el = container.querySelector('[id="' + INPUT_ID + '"]');
    return el && container.contains(el) ? el : null;
  }

  function isOurs(node){
    var el = inputEl();
    if(!el || !node) return false;
    return node === el || (node.nodeType === 1 && el.contains(node));
  }

  function editor(){
    try{
      var inj = opts.getInjector && opts.getInjector();
      if(!inj) return null;
      return inj.get(window.UniverDocsUi.IEditorService).getEditor(DOC_UNIT_ID) || null;
    }catch(e){ return null; }
  }

  function cellText(){
    var ed = editor();
    if(!ed) return null;
    var data = ed.getDocumentData();
    var text = data && data.body && typeof data.body.dataStream === "string" ? data.body.dataStream : "";
    var caret = ed.getCursorPosition();
    if(caret == null || caret < 0 || caret > text.length) return null;
    return { ed: ed, text: text, caret: caret };
  }

  function loadMembers(){
    if(!opts.loadMembers || loading) return;
    if(loadState === "ready") return;
    if(loadState === "error" && failedAt && Date.now() - failedAt < RETRY_MS) return;
    loading = true;
    loadState = "loading";
    var p;
    try{
      p = opts.loadMembers();
    }catch(e){
      p = Promise.reject(e);
    }
    Promise.resolve(p).then(function(list){
      loading = false;
      failedAt = 0;
      loadState = "ready";
      members = list || [];
      if(opened || isOurs(document.activeElement)) detect();
    }, function(){
      loading = false;
      failedAt = Date.now();
      loadState = "error";
      if(opened) detect();
    });
  }

  function ensureLayer(){
    if(layer) return layer;
    layer = document.createElement("div");
    layer.className = "mention-pop";
    layer.setAttribute("role", "listbox");
    layer.hidden = true;
    /* 按下时不抢焦点，否则单元格编辑器会失焦、选区被清掉 */
    layer.addEventListener("mousedown", function(e){ e.preventDefault(); });
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-mp-retry]")){ loadState = "idle"; failedAt = 0; loadMembers(); return; }
      var b = e.target.closest("[data-mp-idx]");
      if(b) pick(Number(b.dataset.mpIdx));
    });
    document.body.appendChild(layer);
    return layer;
  }

  function caretRect(){
    var host = document.getElementById(CARET_HOST_ID);
    var r = host ? host.getBoundingClientRect() : null;
    if(r && (r.left || r.top || r.width > 1 || r.height > 1)) return r;
    var inp = inputEl();
    r = inp ? inp.getBoundingClientRect() : null;
    if(r && (r.left || r.top)) return r;
    return container.getBoundingClientRect();
  }

  function place(){
    if(!opened || !layer) return;
    var r = caretRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var width = Math.round(Math.min(Math.max(r.width, MIN_WIDTH), MAX_WIDTH, vw - 16));
    var above = r.top - GAP - 8;
    var below = vh - r.bottom - GAP - 8;
    var openAbove = above >= 160 || above >= below;
    var space = Math.max(openAbove ? above : below, 96);
    /* 视口边缘兜底：下方空间极小（移动端键盘弹起）时不要把浮层顶出屏幕 */
    var visible = Math.max(openAbove ? r.top - GAP : vh - r.bottom - GAP, 0);
    layer.style.width = width + "px";
    layer.style.left = Math.round(Math.max(8, Math.min(r.left, vw - width - 8))) + "px";
    layer.style.maxHeight = Math.round(Math.min(MAX_HEIGHT, space, visible)) + "px";
    if(openAbove){
      layer.style.top = "auto";
      layer.style.bottom = Math.round(vh - r.top + GAP) + "px";
    }else{
      layer.style.bottom = "auto";
      layer.style.top = Math.round(r.bottom + GAP) + "px";
    }
  }

  function onViewportChange(){
    if(frame) return;
    frame = requestAnimationFrame(function(){
      frame = 0;
      place();
    });
  }

  function close(){
    opened = false;
    items = [];
    index = 0;
    notice = "";
    if(layer) layer.hidden = true;
    if(active === api) active = null;
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
  }

  function render(){
    ensureLayer();
    layer.hidden = !opened;
    if(!opened) return;
    if(!items.length){
      layer.innerHTML = '<div class="cm-empty"' +
        (loadState === "error" ? ' data-mp-retry="1" role="button" tabindex="0"' : '') +
        '>' + esc(notice || "") + '</div>';
      place();
      return;
    }
    layer.innerHTML = items.map(function(m, i){
      var org = memberOrg(m);
      return '<button type="button" class="cm-item' + (i === index ? " on" : "") + '" data-mp-idx="' + i + '" role="option" aria-selected="' + (i === index) + '">' +
        avatarHTML(m.displayName, "sm") +
        '<span class="cm-main">' +
          '<span class="cm-name ellipsis">' + esc(m.displayName) + '</span>' +
          '<span class="cm-sub ellipsis"><i' + (org.hasCompany ? ' style="background:' + companyColor(companyNameOf(m)) + '"' : '') + '></i>'
            + esc(org.text) + '</span>' +
        '</span>' +
        (m.username ? '<span class="cm-user">@' + esc(m.username) + '</span>' : '') +
      '</button>';
    }).join("");
    place();
    var on = layer.querySelector(".cm-item.on");
    if(on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  function open(nextItems, st, en, nt){
    if(active && active !== api) active.close();
    active = api;
    opened = true;
    items = nextItems || [];
    index = 0;
    start = st;
    end = en;
    notice = nt || "";
    render();
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
  }

  /* 与后端 Mentions 同口径：ASCII 字母/数字/下划线视为名字的延续，中文没有词边界 */
  function detect(){
    timer = 0;
    if(!opts.canOpen || !opts.canOpen() || !opts.loadMembers){ close(); return; }
    var cur = cellText();
    if(!cur){ close(); return; }
    var before = cur.text.slice(0, cur.caret);
    var at = before.lastIndexOf("@");
    if(at < 0) at = before.lastIndexOf("＠");
    if(at < 0){ close(); return; }
    if(/[A-Za-z0-9_]/.test(before.charAt(at - 1))){ close(); return; }
    var query = before.slice(at + 1);
    if(/[\s\u3000]/.test(query) || query.length > 20){ close(); return; }
    loadMembers();
    var self = selfId();
    var q = query.toLowerCase();
    var list = members.filter(function(m){
      if(!m || !m.userId || !m.displayName) return false;
      if(self && m.userId === self) return false;
      return (m.displayName || "").toLowerCase().indexOf(q) >= 0
        || (m.username || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, MAX_ITEMS);
    var nt = "";
    if(loadState !== "ready"){
      nt = loadState === "error" ? "成员加载失败，点击重试" : "正在加载成员…";
    }
    if(!list.length && !nt){ close(); return; }
    open(list, at, cur.caret, nt);
  }

  function schedule(){
    if(timer) return;
    timer = setTimeout(detect, 0);
  }

  function pick(i){
    var m = items[i];
    if(!m) return;
    var cur = cellText();
    if(!cur){ close(); return; }
    /* 候选打开后可能继续打字：按当前光标重算替换区间，仍以 @ 起点为界 */
    var token = cur.text.charAt(start);
    var query = cur.text.slice(start + 1, cur.caret);
    if((token !== "@" && token !== "＠") || cur.caret <= start || /[\s\u3000]/.test(query)){
      close();
      return;
    }
    end = cur.caret;
    var insert = "@" + m.displayName + " ";
    var ok = false;
    try{
      var inj = opts.getInjector && opts.getInjector();
      var cmd = inj && inj.get(window.UniverCore.ICommandService);
      ok = cmd && cmd.syncExecuteCommand(window.UniverDocs.InsertTextCommand.id, {
        unitId: DOC_UNIT_ID,
        segmentId: "",
        range: { startOffset: start, endOffset: end, collapsed: false },
        body: { dataStream: insert, textRuns: [] },
        debounce: false
      });
    }catch(e){ ok = false; }
    close();
    if(!ok) return;
    try{
      var caret = start + insert.length;
      cur.ed.setSelectionRanges([{ startOffset: caret, endOffset: caret }], true);
      cur.ed.focus();
    }catch(e){ /* 选区校正失败不影响已插入的文字 */ }
  }

  function move(step){
    var n = items.length;
    if(!n) return;
    index = (index + step + n) % n;
    render();
  }

  function onKeydown(e){
    if(e.isComposing || e.keyCode === 229){
      composing = true;
      return;
    }
    if(!opened) return;
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(!isOurs(e.target)) return;
    if(e.key === "ArrowDown"){ e.preventDefault(); e.stopPropagation(); move(1); return; }
    if(e.key === "ArrowUp"){ e.preventDefault(); e.stopPropagation(); move(-1); return; }
    if((e.key === "Enter" || e.key === "Tab") && items.length){
      e.preventDefault();
      e.stopPropagation();
      pick(index);
      return;
    }
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); }
  }

  function onKeyup(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(!isOurs(e.target)) return;
    if(e.key === "ArrowUp" || e.key === "ArrowDown") return;
    schedule();
  }

  function onInput(e){
    if(e.isComposing || composing) return;
    if(!isOurs(e.target)) return;
    schedule();
  }

  function onFocusin(e){
    if(!isOurs(e.target)) return;
    schedule();
  }

  function onFocusout(e){
    if(!isOurs(e.target)) return;
    composing = false;
    setTimeout(function(){
      if(opened && !isOurs(document.activeElement)) close();
    }, 0);
  }

  function onCompositionStart(){ composing = true; }
  function onCompositionEnd(e){
    composing = false;
    if(!isOurs(e.target)) return;
    schedule();
  }

  /* 捕获阶段挂在 document：单元格编辑器的 keydown 监听在隐藏输入上，
     先于它拦截方向键 / 回车 / Esc，避免候选打开时把光标或换行交给编辑器 */
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("keyup", onKeyup, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("focusin", onFocusin, true);
  document.addEventListener("focusout", onFocusout, true);
  document.addEventListener("compositionstart", onCompositionStart, true);
  document.addEventListener("compositionend", onCompositionEnd, true);

  var api = {
    close: close,
    dispose: function(){
      close();
      if(timer){
        clearTimeout(timer);
        timer = 0;
      }
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("keyup", onKeyup, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("focusin", onFocusin, true);
      document.removeEventListener("focusout", onFocusout, true);
      document.removeEventListener("compositionstart", onCompositionStart, true);
      document.removeEventListener("compositionend", onCompositionEnd, true);
      if(layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null;
    }
  };
  return api;
}
