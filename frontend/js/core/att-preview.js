/* core/att-preview · 附件在线预览弹框
   图片：灯箱舞台，支持放大缩小（按钮/滚轮/双击）、左右旋转 90°、复位、放大后拖拽平移；
   PDF：浏览器内置查看器（沙箱 iframe 里插件不渲染，所以单独用无 sandbox 的 frame）；
   md/txt/doc/docx：marked + DOMPurify / 纯文本 / 服务端转 HTML 放入沙箱 iframe；
   xlsx/xls 不在此处，走 core/sheet-viewer.js 的 Univer 表格。 */

import { icon } from "./icons.js";
import { API } from "./api.js";

var rootEl = null, headName = null, headMeta = null, bodyEl = null, toolsEl = null, zoomEl = null;
var frameEl = null, pdfEl = null, imgEl = null, stageEl = null, textEl = null, statusEl = null;
var current = null; /* { attachment, kind } */
var mdLibPromise = null;

/* 图片变换：scale 以「适配窗口」为 1 倍，tx/ty 为屏幕位移（px） */
var MIN_ZOOM = 0.2, MAX_ZOOM = 8, WHEEL_STEP = 1.15, BTN_STEP = 1.25;
var view = { scale: 1, rot: 0, tx: 0, ty: 0 };
var animTimer = null;

var IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
var PDF_RE = /\.pdf$/i;
var DOC_RE = /\.(md|markdown|txt|docx?)$/i;

/** 附件的预览方式：image / pdf / doc / none（xlsx/xls 由 sheet-viewer 处理） */
function kindOf(filename){
  var f = String(filename || "");
  if(IMAGE_RE.test(f)) return "image";
  if(PDF_RE.test(f)) return "pdf";
  if(DOC_RE.test(f)) return "doc";
  return "none";
}

/** 是否支持在线预览（xlsx/xls 走 sheet-viewer，不在这里） */
function previewable(filename){
  return kindOf(filename) !== "none";
}

function downloadUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}

function previewUrl(id){
  return "/api/attachments/" + encodeURIComponent(id) + "/preview";
}

function loadScript(src){
  return new Promise(function(resolve, reject){
    var s = document.createElement("script");
    s.src = src;
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error("预览组件加载失败")); };
    document.head.appendChild(s);
  });
}

function ensureMarkdownLib(){
  if(typeof window.marked !== "undefined" && window.DOMPurify) return Promise.resolve();
  if(mdLibPromise) return mdLibPromise;
  /* 与 sheet-viewer 一致：经 API.url 补应用根路径，避免页面 URL 无尾斜杠时相对路径解析到 /vendor */
  mdLibPromise = loadScript(API.url("/vendor/markdown/marked.min.js"))
    .then(function(){ return loadScript(API.url("/vendor/markdown/purify.min.js")); })
    .catch(function(ex){ mdLibPromise = null; throw ex; });
  return mdLibPromise;
}

function ensureDom(){
  if(rootEl) return;
  var style = document.createElement("style");
  style.textContent = [
    ".att-modal{position:fixed;inset:0;z-index:250;display:flex;flex-direction:column;background:var(--bg);}",
    ".att-modal[hidden]{display:none;}",
    ".att-modal-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface);}",
    ".att-modal-head .ap-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".att-modal-head .ap-meta{font-size:12px;color:var(--text-2);white-space:nowrap;}",
    ".att-modal-head .ap-sp{flex:1;}",
    /* 图片工具栏：缩小 / 百分比 / 放大 / 左转 / 右转 / 复位，仅图片预览时出现 */
    ".att-modal-head .ap-tools{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--border);border-radius:var(--r-pill);background:var(--bg);}",
    ".att-modal-head .ap-tools[hidden]{display:none;}",
    ".ap-tool{width:26px;height:26px;display:grid;place-items:center;border:0;border-radius:var(--r-xs);background:none;color:var(--text-2);cursor:pointer;}",
    ".ap-tool:hover{background:var(--surface-hover);color:var(--text);}",
    ".ap-tool:disabled{opacity:.4;cursor:default;background:none;color:var(--text-3);}",
    ".ap-zoom{min-width:46px;text-align:center;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums;cursor:pointer;user-select:none;}",
    ".ap-zoom:hover{color:var(--text);}",
    ".att-modal-body{flex:1;position:relative;min-height:0;}",
    ".att-modal-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;}",
    /* 图片舞台：overflow 裁掉放大后的溢出部分，平移靠 transform 位移 */
    ".att-img-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;overflow:hidden;cursor:grab;touch-action:none;}",
    ".att-img-stage.dragging{cursor:grabbing;}",
    ".att-img-stage img{max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;box-shadow:var(--shadow-md);transform-origin:center center;}",
    ".att-img-stage img.ap-anim{transition:transform .16s ease;}",
    ".att-modal-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px;color:var(--text-2);white-space:pre-wrap;}",
    ".att-md-body{position:absolute;inset:0;overflow:auto;padding:28px 40px;background:var(--surface);color:var(--text);font-size:14px;line-height:1.75;}",
    ".att-md-body h1,.att-md-body h2,.att-md-body h3,.att-md-body h4{margin:1.2em 0 .5em;line-height:1.35;}",
    ".att-md-body h1{font-size:1.5em;border-bottom:1px solid var(--border);padding-bottom:.3em;}",
    ".att-md-body h2{font-size:1.3em;}.att-md-body h3{font-size:1.15em;}",
    ".att-md-body p{margin:.6em 0;}",
    ".att-md-body ul,.att-md-body ol{padding-left:1.6em;margin:.6em 0;}",
    ".att-md-body pre{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 14px;overflow:auto;}",
    ".att-md-body code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;}",
    ".att-md-body pre code{background:none;border:0;padding:0;}",
    ".att-md-body code:not(pre code){background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1px 5px;}",
    ".att-md-body blockquote{margin:.8em 0;padding:.2em 1em;border-left:3px solid var(--border);color:var(--text-2);}",
    ".att-md-body table{border-collapse:collapse;margin:.8em 0;max-width:100%;display:block;overflow:auto;}",
    ".att-md-body th,.att-md-body td{border:1px solid var(--border);padding:6px 12px;text-align:left;}",
    ".att-md-body th{background:var(--bg);}",
    ".att-md-body img{max-width:100%;}",
    ".att-md-body hr{border:0;border-top:1px solid var(--border);margin:1.4em 0;}",
    ".att-plain-body{position:absolute;inset:0;overflow:auto;padding:28px 40px;background:var(--surface);color:var(--text);font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;}"
  ].join("\n");
  document.head.appendChild(style);

  rootEl = document.createElement("div");
  rootEl.className = "att-modal";
  rootEl.hidden = true;
  rootEl.setAttribute("role", "dialog");
  rootEl.setAttribute("aria-label", "附件预览");
  rootEl.innerHTML =
    '<div class="att-modal-head">' +
      '<span class="ap-name"></span>' +
      '<span class="ap-meta"></span>' +
      '<span class="ap-sp"></span>' +
      '<span class="ap-tools" hidden>' +
        '<button type="button" class="ap-tool ap-zoom-out" title="缩小（-）" aria-label="缩小">' + icon("zoomOut", 15) + '</button>' +
        '<span class="ap-zoom" title="恢复适配窗口">100%</span>' +
        '<button type="button" class="ap-tool ap-zoom-in" title="放大（+）" aria-label="放大">' + icon("zoomIn", 15) + '</button>' +
        '<button type="button" class="ap-tool ap-rot-l" title="向左旋转 90°（Shift+R）" aria-label="向左旋转">' + icon("rotateLeft", 15) + '</button>' +
        '<button type="button" class="ap-tool ap-rot-r" title="向右旋转 90°（R）" aria-label="向右旋转">' + icon("rotateRight", 15) + '</button>' +
        '<button type="button" class="ap-tool ap-reset" title="复位（0）" aria-label="复位">' + icon("refresh", 15) + '</button>' +
      '</span>' +
      '<button type="button" class="btn sm ap-dl" title="下载原文件"></button>' +
      '<button type="button" class="btn sm ap-close" title="关闭（Esc）"></button>' +
    '</div>' +
    '<div class="att-modal-body">' +
      '<iframe hidden sandbox=""></iframe>' +
      '<iframe class="ap-pdf" hidden></iframe>' +
      '<div class="att-img-stage" hidden><img alt="" draggable="false" /></div>' +
      '<div class="att-md-body" hidden></div>' +
      '<div class="att-plain-body" hidden></div>' +
      '<div class="att-modal-status" hidden></div>' +
    '</div>';
  document.body.appendChild(rootEl);

  headName = rootEl.querySelector(".ap-name");
  headMeta = rootEl.querySelector(".ap-meta");
  toolsEl = rootEl.querySelector(".ap-tools");
  zoomEl = rootEl.querySelector(".ap-zoom");
  bodyEl = rootEl.querySelector(".att-modal-body");
  frameEl = rootEl.querySelector("iframe:not(.ap-pdf)");
  pdfEl = rootEl.querySelector(".ap-pdf");
  stageEl = rootEl.querySelector(".att-img-stage");
  imgEl = stageEl.querySelector("img");
  textEl = rootEl.querySelector(".att-md-body");
  statusEl = rootEl.querySelector(".att-modal-status");

  rootEl.querySelector(".ap-dl").innerHTML = icon("download", 14) + " 下载";
  rootEl.querySelector(".ap-close").innerHTML = icon("close", 14) + " 关闭";
  rootEl.querySelector(".ap-dl").addEventListener("click", function(){
    if(current) window.open(downloadUrl(current.attachment.id), "_blank", "noopener");
  });
  rootEl.querySelector(".ap-close").addEventListener("click", closeAttPreview);

  rootEl.querySelector(".ap-zoom-out").addEventListener("click", function(){ zoomBy(1 / BTN_STEP, true); });
  rootEl.querySelector(".ap-zoom-in").addEventListener("click", function(){ zoomBy(BTN_STEP, true); });
  rootEl.querySelector(".ap-rot-l").addEventListener("click", function(){ rotateBy(-90); });
  rootEl.querySelector(".ap-rot-r").addEventListener("click", function(){ rotateBy(90); });
  rootEl.querySelector(".ap-reset").addEventListener("click", resetView);
  zoomEl.addEventListener("click", resetView);

  /* 滚轮缩放；双击在「适配窗口」与「实际像素」之间切换 */
  stageEl.addEventListener("wheel", function(e){
    if(!isImageMode()) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, false);
  }, { passive: false });
  stageEl.addEventListener("dblclick", function(e){
    if(!isImageMode()) return;
    e.preventDefault();
    toggleActual();
  });
  bindPan();

  document.addEventListener("keydown", function(e){
    if(rootEl.hidden) return;
    if(e.key === "Escape"){ e.stopPropagation(); closeAttPreview(); return; }
    if(!isImageMode() || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if(e.key === "+" || e.key === "="){ e.preventDefault(); zoomBy(BTN_STEP, true); }
    else if(e.key === "-" || e.key === "_"){ e.preventDefault(); zoomBy(1 / BTN_STEP, true); }
    else if(e.key === "0"){ e.preventDefault(); resetView(); }
    else if(e.key === "r" || e.key === "R"){ e.preventDefault(); rotateBy(e.shiftKey ? -90 : 90); }
  }, true);
}

function isImageMode(){
  return !!current && current.kind === "image" && !!rootEl && !rootEl.hidden;
}

/** 按住拖动平移：放大或旋转后看图的其他部位；缩放回 1 倍时自动归位 */
function bindPan(){
  var dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;
  stageEl.addEventListener("pointerdown", function(e){
    if(!isImageMode() || e.button !== 0) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    baseX = view.tx; baseY = view.ty;
    stageEl.classList.add("dragging");
    try{ stageEl.setPointerCapture(e.pointerId); }catch(err){ /* 不支持指针捕获时降级为不可拖拽 */ }
    e.preventDefault();
  });
  stageEl.addEventListener("pointermove", function(e){
    if(!dragging) return;
    view.tx = baseX + (e.clientX - startX);
    view.ty = baseY + (e.clientY - startY);
    applyView(false);
  });
  function end(e){
    if(!dragging) return;
    dragging = false;
    stageEl.classList.remove("dragging");
    try{ stageEl.releasePointerCapture(e.pointerId); }catch(err){ /* 同上 */ }
  }
  stageEl.addEventListener("pointerup", end);
  stageEl.addEventListener("pointercancel", end);
}

/* ---------- 图片视图状态 ---------- */

function applyView(animate){
  if(view.scale <= 1.001){ view.tx = 0; view.ty = 0; }
  imgEl.style.transform = "translate(" + view.tx + "px," + view.ty + "px) rotate(" + view.rot + "deg) scale(" + view.scale + ")";
  zoomEl.textContent = Math.round(view.scale * 100) + "%";
  rootEl.querySelector(".ap-zoom-out").disabled = view.scale <= MIN_ZOOM + 0.001;
  rootEl.querySelector(".ap-zoom-in").disabled = view.scale >= MAX_ZOOM - 0.001;
  if(!animate) return;
  imgEl.classList.add("ap-anim");
  clearTimeout(animTimer);
  animTimer = setTimeout(function(){ imgEl.classList.remove("ap-anim"); }, 190);
}

function zoomBy(factor, animate){
  var next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
  if(Math.abs(next - view.scale) < 0.0001) return;
  view.scale = next;
  applyView(animate);
}

function rotateBy(deg){
  view.rot = (view.rot + deg + 36000) % 360;
  applyView(true);
}

function resetView(){
  view.scale = 1; view.rot = 0; view.tx = 0; view.ty = 0;
  applyView(true);
}

/** 无动画复位：打开与关闭时用，避免复位过程被看到 */
function resetSilently(){
  view.scale = 1; view.rot = 0; view.tx = 0; view.ty = 0;
  imgEl.style.transform = "";
  zoomEl.textContent = "100%";
  rootEl.querySelector(".ap-zoom-out").disabled = false;
  rootEl.querySelector(".ap-zoom-in").disabled = false;
}

/** 双击：适配窗口与实际像素切换（实际倍率按图片未缩放时的显示宽度换算） */
function toggleActual(){
  if(view.scale > 1.001 || view.rot !== 0){ resetView(); return; }
  var laid = imgEl.clientWidth || imgEl.offsetWidth;
  var actual = laid > 0 ? imgEl.naturalWidth / laid : 1;
  view.scale = Math.min(MAX_ZOOM, Math.max(1.05, actual));
  applyView(true);
}

function showImage(att){
  resetSilently();
  toolsEl.hidden = false;
  stageEl.hidden = false;
  headMeta.textContent = "图片";
  imgEl.onload = function(){
    setStatus(null);
    headMeta.textContent = "图片 · " + imgEl.naturalWidth + "×" + imgEl.naturalHeight;
    applyView(false);
  };
  imgEl.onerror = function(){
    stageEl.hidden = true;
    toolsEl.hidden = true;
    setStatus("图片预览加载失败，可下载后本地打开");
  };
  imgEl.src = downloadUrl(att.id);
}

function setStatus(text){
  if(!text){ statusEl.hidden = true; statusEl.textContent = ""; return; }
  statusEl.hidden = false;
  statusEl.textContent = text;
}

function hideBody(){
  frameEl.hidden = true;
  pdfEl.hidden = true;
  stageEl.hidden = true;
  textEl.hidden = true;
  var plain = rootEl.querySelector(".att-plain-body");
  plain.hidden = true;
  toolsEl.hidden = true;
}

function fetchText(url){
  return fetch(url, { credentials: "same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok) throw new Error("下载附件失败（HTTP " + res.status + "）");
    return res.text();
  });
}

function showMarkdown(src){
  ensureMarkdownLib().then(function(){
    /* 渲染结果走 DOMPurify：附件内容可能来自他人上传的文件 */
    var html = "";
    try{ html = window.marked.parse(src, { gfm: true, breaks: false }); }catch(e){ html = ""; }
    textEl.innerHTML = window.DOMPurify.sanitize(html);
    var links = textEl.querySelectorAll("a[href]");
    for(var i = 0; i < links.length; i++){
      links[i].setAttribute("target", "_blank");
      links[i].setAttribute("rel", "noopener noreferrer");
    }
    setStatus(null);
  }).catch(function(ex){
    setStatus(ex.message || "Markdown 预览加载失败");
  });
}

function showPlain(src){
  var plain = rootEl.querySelector(".att-plain-body");
  plain.textContent = src;
  setStatus(null);
}

/** 服务端已按扩展名过滤，输出放进无脚本权限的沙箱 iframe，再补一层基础排版 */
function showDocHtml(html){
  var inject = "<style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;"
    + "color:#1f2329;background:#fff;padding:28px 40px;line-height:1.75;max-width:920px;margin:0 auto;}"
    + "img{max-width:100%;}td,th{border:1px solid #d0d3d9;padding:6px 10px;}"
    + "table{border-collapse:collapse;}</style>";
  var doc = html;
  if(/<\/head>/i.test(doc)){
    doc = doc.replace(/<\/head>/i, inject + "</head>");
  }else{
    doc = "<html><head><meta charset=\"utf-8\">" + inject + "</head><body>" + doc + "</body></html>";
  }
  frameEl.srcdoc = doc;
  setStatus(null);
}

function showDocPreview(att){
  API.get(previewUrl(att.id)).then(function(res){
    if(res && res.type === "html"){
      frameEl.hidden = false;
      showDocHtml(res.content || "");
    }else if(res && res.type === "text"){
      var plain = rootEl.querySelector(".att-plain-body");
      plain.hidden = false;
      showPlain(res.content || "");
    }else{
      throw new Error("预览响应格式不正确");
    }
  }).catch(function(ex){
    setStatus(ex.message || "预览加载失败，可下载后本地打开");
  });
}

/** attachment: {id, filename, size} */
function openAttPreview(opts){
  var att = opts && opts.attachment;
  if(!att || !att.id) return;
  ensureDom();
  var kind = kindOf(att.filename);
  current = { attachment: att, kind: kind };
  headName.textContent = att.filename || "附件预览";
  headMeta.textContent = "加载中…";
  hideBody();
  setStatus("正在加载预览…");
  resetSilently();
  rootEl.hidden = false;
  document.body.style.overflow = "hidden";

  var ext = (String(att.filename || "").split(".").pop() || "").toLowerCase();
  if(kind === "image"){
    showImage(att);
  }else if(kind === "pdf"){
    pdfEl.hidden = false;
    headMeta.textContent = "PDF";
    setStatus(null);
    pdfEl.src = downloadUrl(att.id);
  }else if(kind === "doc" && (ext === "md" || ext === "markdown")){
    textEl.hidden = false;
    headMeta.textContent = "Markdown";
    fetchText(downloadUrl(att.id)).then(showMarkdown).catch(function(ex){
      setStatus(ex.message || "预览加载失败");
    });
  }else if(kind === "doc" && ext === "txt"){
    var plain = rootEl.querySelector(".att-plain-body");
    plain.hidden = false;
    headMeta.textContent = "文本";
    fetchText(downloadUrl(att.id)).then(showPlain).catch(function(ex){
      setStatus(ex.message || "预览加载失败");
    });
  }else if(kind === "doc"){
    frameEl.hidden = false;
    headMeta.textContent = "Word 文档";
    showDocPreview(att);
  }else{
    setStatus("该文件类型暂不支持在线预览，请下载后用本地应用打开");
  }
}

function closeAttPreview(){
  if(!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  current = null;
  toolsEl.hidden = true;
  frameEl.removeAttribute("srcdoc");
  pdfEl.removeAttribute("src");
  imgEl.onload = null;
  imgEl.onerror = null;
  imgEl.removeAttribute("src");
  resetSilently();
  textEl.innerHTML = "";
  var plain = rootEl.querySelector(".att-plain-body");
  plain.textContent = "";
  setStatus(null);
  document.body.style.overflow = "";
}

export { openAttPreview, closeAttPreview, previewable, kindOf };
