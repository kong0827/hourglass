/* core/mention-picker · 评论框 @提及
   候选浮层挂到 body 并用 fixed 定位：评论框通常位于抽屉 / 侧栏的滚动容器内，
   绝对定位会被 overflow 裁掉（候选多时面板顶部整块被页签盖住）。
   浮层优先出现在输入框上方，上方空间不足时翻到下方，并始终限制在视口内。 */

import { avatarHTML } from "../lib/format.js";
import { esc } from "./ui.js";

var MAX_ITEMS = 50;
var MAX_HEIGHT = 240;
var RETRY_MS = 30000;
var GAP = 6;
var MIN_WIDTH = 260;
var MAX_WIDTH = 420;
/* 同一时刻只开一个候选框，避免两个评论框的下拉叠在一起 */
var active = null;

/* 与后端 Mentions 同口径：字母/数字/下划线视为名字的延续，中文按字母处理 */
function isWordChar(ch){
  return !!ch && (/[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) > 127);
}
function hasMentionToken(text, name){
  var token = "@" + name;
  var from = 0;
  while(true){
    var at = text.indexOf(token, from);
    if(at < 0) return false;
    if(!isWordChar(text.charAt(at + token.length))) return true;
    from = at + 1;
  }
}
/* 中文没有词边界，"请@张三" 是自然写法；只有 ASCII 字母/数字/下划线前的 @ 视为邮箱 */
function startBlocked(ch){
  return !!ch && /[A-Za-z0-9_]/.test(ch);
}

/**
 * @param {HTMLTextAreaElement} input 评论输入框
 * @param {Object} opts
 *   canOpen()            返回 false 时不弹候选（如只读）
 *   excludeUserId        字符串或函数：候选里排除自己
 *   loadMembers(force)   返回成员数组的 Promise（按空间 / 任务 / 文档可见范围）
 */
export function createMentionPicker(input, opts){
  if(!input) return null;
  opts = opts || {};

  var picked = [];
  var members = [];
  var loadState = "idle";   /* idle / loading / ready / error */
  var loading = false;
  var failedAt = 0;
  var seq = 0;              /* reset 后丢弃迟到的成员响应 */
  var layer = null;
  var opened = false;
  var items = [];
  var index = 0;
  var start = 0;
  var end = 0;
  var notice = "";
  var frame = 0;
  var blurTimer = 0;

  function canOpen(){
    return !opts.canOpen || !!opts.canOpen();
  }
  function selfId(){
    var v = opts.excludeUserId;
    return typeof v === "function" ? (v() || "") : (v || "");
  }

  function loadMembers(force){
    if(!opts.loadMembers || loading) return;
    if(!force && loadState === "ready") return;
    /* 候选拉取失败后短暂退避，避免断网时每次输入都重试 */
    if(!force && failedAt && Date.now() - failedAt < RETRY_MS) return;
    loading = true;
    loadState = "loading";
    var my = seq;
    if(opened) render();
    var p;
    try{
      p = opts.loadMembers(force);
    }catch(e){
      p = Promise.reject(e);
    }
    Promise.resolve(p).then(function(list){
      if(my !== seq) return;
      loading = false;
      failedAt = 0;
      loadState = "ready";
      members = list || [];
      if(document.activeElement === input) detect();
    }, function(){
      if(my !== seq) return;
      loading = false;
      failedAt = Date.now();
      loadState = "error";
      if(document.activeElement === input) detect();
    });
  }

  function ensureLayer(){
    if(layer) return layer;
    layer = document.createElement("div");
    layer.className = "mention-pop";
    layer.setAttribute("role", "listbox");
    layer.hidden = true;
    /* 按下时不抢焦点，否则 blur 先关面板，click 无法命中 */
    layer.addEventListener("mousedown", function(e){ e.preventDefault(); });
    layer.addEventListener("click", function(e){
      if(e.target.closest("[data-mp-retry]")){ loadMembers(true); return; }
      var b = e.target.closest("[data-mp-idx]");
      if(b) pick(Number(b.dataset.mpIdx));
    });
    layer.addEventListener("keydown", function(e){
      if((e.key === "Enter" || e.key === " ") && e.target.closest("[data-mp-retry]")){
        e.preventDefault();
        loadMembers(true);
      }
    });
    document.body.appendChild(layer);
    return layer;
  }

  /* 输入框上方最近的裁剪边界（抽屉正文、侧栏等滚动容器）：
     只按视口算的话，候选会盖住抽屉页签和顶栏，翻到下方更自然 */
  function clipTop(inputTop){
    var top = 0;
    var el = input.parentElement;
    while(el && el !== document.body && el !== document.documentElement){
      var cs = window.getComputedStyle(el);
      if(/(auto|scroll|hidden)/.test(cs.overflowY)){
        var r = el.getBoundingClientRect();
        if(r.height > 0 && r.top < inputTop && r.top > top) top = r.top;
      }
      el = el.parentElement;
    }
    return top;
  }

  function place(){
    if(!opened || !layer) return;
    if(!document.documentElement.contains(input)){ close(); return; }
    var r = input.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var width = Math.round(Math.min(Math.max(r.width, MIN_WIDTH), MAX_WIDTH, vw - 16));
    var above = r.top - clipTop(r.top) - GAP - 8;
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
      return '<button type="button" class="cm-item' + (i === index ? " on" : "") + '" data-mp-idx="' + i + '" role="option" aria-selected="' + (i === index) + '">' +
        avatarHTML(m.displayName, "sm") +
        '<span class="cm-name ellipsis">' + esc(m.displayName) + '</span>' +
        (m.username ? '<span class="cm-user">@' + esc(m.username) + '</span>' : '') +
      '</button>';
    }).join("");
    place();
    var on = layer.querySelector(".cm-item.on");
    if(on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  function remember(m){
    for(var i = 0; i < picked.length; i++){
      if(picked[i].userId === m.userId) return;
    }
    picked.push({ userId: m.userId, displayName: m.displayName });
  }

  function pick(i){
    var m = items[i];
    if(!m) return;
    remember(m);
    var insert = "@" + m.displayName + " ";
    input.value = input.value.slice(0, start) + insert + input.value.slice(end);
    var caret = start + insert.length;
    close();
    try{
      input.focus();
      input.setSelectionRange(caret, caret);
    }catch(e){ /* noop */ }
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function move(step){
    var n = items.length;
    if(!n) return;
    index = (index + step + n) % n;
    render();
  }

  /* 中文输入法常打出全角 ＠，统一成半角，否则前端不触发、后端也解析不到 */
  function normalizeFullWidth(){
    if(input.value.indexOf("＠") < 0) return;
    var caret = input.selectionStart;
    input.value = input.value.replace(/＠/g, "@");
    try{ input.setSelectionRange(caret, caret); }catch(e){ /* noop */ }
  }

  function detect(){
    if(!canOpen()){ close(); return; }
    loadMembers();
    var caret = input.selectionStart;
    if(caret == null) caret = input.value.length;
    var before = input.value.slice(0, caret);
    var at = before.lastIndexOf("@");
    if(at < 0 || startBlocked(before.charAt(at - 1))){ close(); return; }
    var query = before.slice(at + 1);
    if(/\s/.test(query)){ close(); return; }
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
    }else if(!list.length && !q){
      nt = "暂无可提及的成员";
    }
    if(!list.length && !nt){ close(); return; }
    open(list, at, caret, nt);
  }

  function onKeydown(e){
    if(!opened) return;
    if(e.isComposing || e.keyCode === 229) return;
    /* Ctrl/⌘ + Enter 是发送评论，留给业务快捷键 */
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(e.key === "ArrowDown"){ e.preventDefault(); e.stopImmediatePropagation(); move(1); return; }
    if(e.key === "ArrowUp"){ e.preventDefault(); e.stopImmediatePropagation(); move(-1); return; }
    /* 只有真正有候选时才把 Enter / Tab 交给选择，加载与失败提示态下回车仍按普通换行处理 */
    if((e.key === "Enter" || e.key === "Tab") && items.length){
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      pick(index);
      return;
    }
    if(e.key === "Escape"){ e.stopImmediatePropagation(); close(); }
  }

  function onInput(e){
    if(e && e.isComposing) return;
    if(!canOpen()){ close(); return; }
    normalizeFullWidth();
    detect();
  }

  function onFocus(){
    if(!canOpen()) return;
    loadMembers();
  }

  function onBlur(){
    blurTimer = setTimeout(close, 120);
  }

  var api = {
    close: close,
    /* 切换任务 / 文档时调用：丢弃旧候选与已点选成员 */
    reset: function(){
      seq++;
      loading = false;
      failedAt = 0;
      loadState = "idle";
      members = [];
      picked = [];
      close();
    },
    /* 评论发送后只清点选记录，候选成员仍可复用 */
    clearPicked: function(){ picked = []; },
    /* 只把仍留在正文里的点选成员发给后端：删掉 @名字 后不应再通知 */
    idsInText: function(text){
      return picked.filter(function(p){
        return hasMentionToken(text, p.displayName);
      }).map(function(p){ return p.userId; });
    },
    isOpen: function(){ return opened; },
    refreshMembers: function(){ loadMembers(true); },
    destroy: function(){
      close();
      clearTimeout(blurTimer);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("input", onInput);
      input.removeEventListener("click", detect);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onKeydown);
      if(layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null;
    }
  };

  input.addEventListener("focus", onFocus);
  input.addEventListener("input", onInput);
  input.addEventListener("click", detect);
  input.addEventListener("blur", onBlur);
  /* keydown 在这里注册，业务侧后注册的发送快捷键排在它后面，
     Enter/Tab 被消费时用 stopImmediatePropagation 拦住 */
  input.addEventListener("keydown", onKeydown);
  return api;
}
