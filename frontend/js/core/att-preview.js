/* core/att-preview · 附件 md/txt/doc/docx 在线预览（md 用 marked 渲染，doc/docx 走服务端转 HTML 放入沙箱 iframe） */

import { icon } from "./icons.js";
import { API } from "./api.js";

var rootEl = null, headName = null, headMeta = null, bodyEl = null;
var frameEl = null, textEl = null, statusEl = null;
var current = null; /* { attachment } */
var mdLibPromise = null;

var PREVIEW_RE = /\.(md|markdown|txt|docx?)$/i;

/** 是否支持在线预览（xlsx/xls 走 sheet-viewer，不在这里） */
function previewable(filename){
  return PREVIEW_RE.test(String(filename || ""));
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
    ".att-modal-body{flex:1;position:relative;min-height:0;}",
    ".att-modal-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;}",
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
      '<button type="button" class="btn sm ap-dl" title="下载原文件"></button>' +
      '<button type="button" class="btn sm ap-close" title="关闭（Esc）"></button>' +
    '</div>' +
    '<div class="att-modal-body">' +
      '<iframe hidden sandbox=""></iframe>' +
      '<div class="att-md-body" hidden></div>' +
      '<div class="att-plain-body" hidden></div>' +
      '<div class="att-modal-status" hidden></div>' +
    '</div>';
  document.body.appendChild(rootEl);

  headName = rootEl.querySelector(".ap-name");
  headMeta = rootEl.querySelector(".ap-meta");
  bodyEl = rootEl.querySelector(".att-modal-body");
  frameEl = rootEl.querySelector("iframe");
  textEl = rootEl.querySelector(".att-md-body");
  statusEl = rootEl.querySelector(".att-modal-status");

  rootEl.querySelector(".ap-dl").innerHTML = icon("download", 14) + " 下载";
  rootEl.querySelector(".ap-close").innerHTML = icon("close", 14) + " 关闭";
  rootEl.querySelector(".ap-dl").addEventListener("click", function(){
    if(current) window.open(downloadUrl(current.attachment.id), "_blank", "noopener");
  });
  rootEl.querySelector(".ap-close").addEventListener("click", closeAttPreview);
  document.addEventListener("keydown", function(e){
    if(rootEl.hidden) return;
    if(e.key === "Escape"){ e.stopPropagation(); closeAttPreview(); }
  }, true);
}

function setStatus(text){
  if(!text){ statusEl.hidden = true; statusEl.textContent = ""; return; }
  statusEl.hidden = false;
  statusEl.textContent = text;
}

function hideBody(){
  frameEl.hidden = true;
  textEl.hidden = true;
  var plain = rootEl.querySelector(".att-plain-body");
  plain.hidden = true;
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
  current = { attachment: att };
  headName.textContent = att.filename || "附件预览";
  headMeta.textContent = "加载中…";
  hideBody();
  setStatus("正在加载预览…");
  rootEl.hidden = false;
  document.body.style.overflow = "hidden";

  var ext = (String(att.filename || "").split(".").pop() || "").toLowerCase();
  if(ext === "md" || ext === "markdown"){
    textEl.hidden = false;
    headMeta.textContent = "Markdown";
    fetchText(downloadUrl(att.id)).then(showMarkdown).catch(function(ex){
      setStatus(ex.message || "预览加载失败");
    });
  }else if(ext === "txt"){
    var plain = rootEl.querySelector(".att-plain-body");
    plain.hidden = false;
    headMeta.textContent = "文本";
    fetchText(downloadUrl(att.id)).then(showPlain).catch(function(ex){
      setStatus(ex.message || "预览加载失败");
    });
  }else{
    frameEl.hidden = false;
    headMeta.textContent = "Word 文档";
    showDocPreview(att);
  }
}

function closeAttPreview(){
  if(!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  current = null;
  frameEl.removeAttribute("srcdoc");
  textEl.innerHTML = "";
  var plain = rootEl.querySelector(".att-plain-body");
  plain.textContent = "";
  setStatus(null);
  document.body.style.overflow = "";
}

export { openAttPreview, closeAttPreview, previewable };
