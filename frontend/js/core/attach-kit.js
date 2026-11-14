/* core/attach-kit · 全局附件组件：拖拽 / 点击 / 粘贴上传，待传文件清单，
   在线预览与下载的统一入口。执行证据、任务附件、缺陷证据共用同一套口径。 */

import { API } from "./api.js";
import { openAttPreview, previewable, kindOf } from "./att-preview.js";
import { icon } from "./icons.js";
import { esc, toast } from "./ui.js";

/* 与后端 AttachmentService.ALLOWED_EXT 保持一致 */
var ALLOWED_EXT = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "txt", "md", "zip",
  "xlsx", "doc", "docx", "xls", "ppt", "pptx"];
var ACCEPT = ALLOWED_EXT.map(function(e){ return "." + e; }).join(",");
var MAX_SIZE = 10 * 1024 * 1024;
var MAX_FILES = 20;

function extOf(name){
  var m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}
function fmtSize(n){
  if(!n && n !== 0) return "";
  if(n < 1024) return n + " B";
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function csrfCookie(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function withWs(url){
  var ws = window.CURRENT_WORKSPACE;
  if(!ws) return url;
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "workspace=" + encodeURIComponent(ws);
}
function downloadUrl(id){
  return API.url(withWs("/api/attachments/" + encodeURIComponent(id) + "/download"));
}
function thumbUrl(id){
  return API.url(withWs("/api/attachments/" + encodeURIComponent(id) + "/thumb"));
}

/** 校验一批文件：返回 {ok, rejected:[{file, reason}]}，超限/类型不符逐条说明 */
function validateFiles(files, currentCount){
  var ok = [], rejected = [];
  var room = MAX_FILES - (currentCount || 0);
  Array.prototype.forEach.call(files || [], function(f){
    if(!f) return;
    var ext = extOf(f.name);
    if(ALLOWED_EXT.indexOf(ext) === -1){
      rejected.push({ file: f, reason: "不支持的类型 ." + (ext || "?") });
      return;
    }
    if(f.size > MAX_SIZE){
      rejected.push({ file: f, reason: "超过 10MB" });
      return;
    }
    if(room <= 0){
      rejected.push({ file: f, reason: "最多 " + MAX_FILES + " 个文件" });
      return;
    }
    room--;
    ok.push(f);
  });
  return { ok: ok, rejected: rejected };
}
function reportRejected(rejected){
  if(!rejected.length) return;
  var first = rejected[0];
  toast("「" + first.file.name + "」" + first.reason
    + (rejected.length > 1 ? "（另有 " + (rejected.length - 1) + " 个未加入）" : ""), "warn");
}

/** multipart 上传单个附件；path 形如 /api/tasks/{id}/attachments，返回附件记录 */
function uploadAttachment(path, file){
  var fd = new FormData();
  fd.append("file", file);
  return fetch(API.url(withWs(path)), {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    if(!json || json.code !== 0) throw new Error((json && json.message) || "上传失败");
    return json.data;
  });
}

/** 统一打开入口：图片/PDF/MD/TXT/Word 走预览弹层，Excel 走在线表格，其余直接下载 */
function openAttachment(att, opts){
  if(!att || !att.id) return;
  opts = opts || {};
  var name = att.filename || "";
  if(previewable(name)){
    openAttPreview({ attachment: att });
    return;
  }
  if(/\.(xlsx|xls)$/i.test(name)){
    import("./sheet-viewer.js").then(function(m){
      m.openSheet({ attachment: att, canEdit: !!opts.canEdit, onSaved: opts.onSaved });
    }).catch(function(ex){ toast(ex && ex.message ? ex.message : "打开表格失败", "bad"); });
    return;
  }
  window.open(downloadUrl(att.id), "_blank", "noopener");
}

/** 已上传附件的 chip：预览 + 下载 + 可选删除。data 属性由宿主容器统一代理点击 */
function attachmentChipHTML(att, opts){
  opts = opts || {};
  var isImg = kindOf(att.filename) === "image";
  var prev = previewable(att.filename) || /\.(xlsx|xls)$/i.test(att.filename || "");
  var id = esc(att.id);
  var openAttr = prev ? ' data-att-open="' + id + '"' : "";
  var title = esc(att.filename || "附件") + (prev ? " · 在线预览" : " · 下载");
  var thumb = isImg
    ? '<img class="att-chip-thumb" src="' + thumbUrl(att.id) + '" alt="" loading="lazy" />'
    : '<span class="att-chip-ico">' + icon("clip", 13) + '</span>';
  return '<span class="att-chip' + (isImg ? " is-img" : "") + '" title="' + title + '">'
    + '<a class="att-chip-main" href="' + downloadUrl(att.id) + '" target="_blank" rel="noopener"' + openAttr + '>'
    + thumb + '<span class="att-chip-name">' + esc(att.filename || "附件") + '</span></a>'
    + '<button class="icon-btn xs" type="button" data-att-download="' + id + '" title="下载" aria-label="下载">' + icon("download", 12) + '</button>'
    + (opts.removable ? '<button class="icon-btn xs danger" type="button" data-att-del="' + id + '" title="删除" aria-label="删除">' + icon("trash", 12) + '</button>' : "")
    + '</span>';
}

/** 给任意元素挂拖拽（可选粘贴）接收文件；返回解绑函数。高亮类 .is-dragover 由 CSS 定义 */
function bindFileDrop(el, onFiles, opts){
  if(!el) return function(){};
  opts = opts || {};
  var depth = 0;
  function hasFiles(e){
    if(!e.dataTransfer) return false;
    if(e.dataTransfer.types){
      for(var i = 0; i < e.dataTransfer.types.length; i++){
        if(e.dataTransfer.types[i] === "Files") return true;
      }
      return false;
    }
    return true;
  }
  function over(e){
    if(!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth++;
    el.classList.add("is-dragover");
    if(e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function enter(e){
    if(!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add("is-dragover");
  }
  function leave(e){
    e.stopPropagation();
    depth = Math.max(0, depth - 1);
    if(depth === 0) el.classList.remove("is-dragover");
  }
  function drop(e){
    if(!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove("is-dragover");
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      onFiles(Array.prototype.slice.call(e.dataTransfer.files));
    }
  }
  function paste(e){
    if(!opts.paste) return;
    /* 只接收剪贴板里的文件（截图），不拦截纯文本粘贴 */
    var items = e.clipboardData && e.clipboardData.items;
    if(!items) return;
    var files = [];
    for(var i = 0; i < items.length; i++){
      if(items[i].kind === "file"){
        var f = items[i].getAsFile();
        if(f) files.push(f);
      }
    }
    if(!files.length) return;
    e.preventDefault();
    onFiles(files.map(function(f){
      /* 剪贴板截图默认名 image.png，补一个带时间戳的名字便于追溯 */
      if(f.name === "image.png"){
        var d = new Date();
        var pad = function(n){ return (n < 10 ? "0" : "") + n; };
        return new File([f], "截图-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
          + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + ".png", { type: f.type });
      }
      return f;
    }));
  }
  el.addEventListener("dragover", over);
  el.addEventListener("dragenter", enter);
  el.addEventListener("dragleave", leave);
  el.addEventListener("drop", drop);
  if(opts.paste){
    var pasteTarget = opts.pasteTarget || el;
    pasteTarget.addEventListener("paste", paste);
  }
  return function(){
    el.removeEventListener("dragover", over);
    el.removeEventListener("dragenter", enter);
    el.removeEventListener("dragleave", leave);
    el.removeEventListener("drop", drop);
    if(opts.paste) (opts.pasteTarget || el).removeEventListener("paste", paste);
  };
}

/**
 * 待传文件收集器（不立即上传）：拖拽区 + 点击选择 + 粘贴 + 文件 chips。
 * opts: { mount, label, hint, onChange(files), paste, compact }
 * 返回 { files, addFiles, clear, destroy, el }；宿主提交时取 files() 逐个上传。
 */
function createAttachKit(opts){
  opts = opts || {};
  var mount = opts.mount;
  if(!mount) return null;
  var pending = [];
  var seq = 0;
  var urls = {};

  var root = document.createElement("div");
  root.className = "att-kit" + (opts.compact ? " compact" : "");
  root.innerHTML =
    '<div class="att-drop" tabindex="0" role="button" aria-label="选择或拖入文件">'
    + '<span class="att-drop-ico">' + icon("upload", 16) + '</span>'
    + '<span class="att-drop-text"><b>' + esc(opts.label || "点击选择") + '</b>，或将文件拖到这里'
    + (opts.paste ? "，也可粘贴截图" : "") + '</span>'
    + '<span class="att-drop-hint">' + esc(opts.hint || "截图 / 日志 / 文档 / 表格，单个 ≤10MB，最多 " + MAX_FILES + " 个") + '</span>'
    + '<input type="file" class="att-drop-input" multiple accept="' + ACCEPT + '" tabindex="-1" aria-hidden="true" />'
    + '</div>'
    + '<div class="att-chips" hidden></div>';
  mount.appendChild(root);

  var dropEl = root.querySelector(".att-drop");
  var input = root.querySelector(".att-drop-input");
  var chipsEl = root.querySelector(".att-chips");

  function render(){
    if(!pending.length){
      chipsEl.hidden = true;
      chipsEl.innerHTML = "";
      return;
    }
    chipsEl.hidden = false;
    chipsEl.innerHTML = pending.map(function(p){
      var isImg = /^image\//.test(p.file.type || "");
      var thumb = isImg && urls[p.key]
        ? '<img class="att-chip-thumb" src="' + urls[p.key] + '" alt="" />'
        : '<span class="att-chip-ico">' + icon("clip", 13) + '</span>';
      return '<span class="att-chip pending' + (isImg ? " is-img" : "") + '" title="' + esc(p.file.name) + '">'
        + '<span class="att-chip-main">' + thumb
        + '<span class="att-chip-name">' + esc(p.file.name) + '</span>'
        + '<span class="att-chip-size">' + fmtSize(p.file.size) + '</span></span>'
        + '<button class="icon-btn xs danger" type="button" data-kit-rm="' + p.key + '" title="移除" aria-label="移除 ' + esc(p.file.name) + '">' + icon("trash", 12) + '</button>'
        + '</span>';
    }).join("");
  }
  function changed(){
    render();
    if(opts.onChange) opts.onChange(files());
  }
  function files(){
    return pending.map(function(p){ return p.file; });
  }
  function addFiles(list){
    var res = validateFiles(list, pending.length);
    reportRejected(res.rejected);
    res.ok.forEach(function(f){
      var key = "k" + (++seq);
      pending.push({ key: key, file: f });
      if(/^image\//.test(f.type || "")){
        try{ urls[key] = URL.createObjectURL(f); }catch(e){ /* 老浏览器不支持则显示图标 */ }
      }
    });
    if(res.ok.length) changed();
  }
  function clear(){
    pending.forEach(function(p){ if(urls[p.key]) URL.revokeObjectURL(urls[p.key]); });
    pending = [];
    urls = {};
    input.value = "";
    changed();
  }

  input.addEventListener("change", function(){
    if(input.files && input.files.length) addFiles(Array.prototype.slice.call(input.files));
    input.value = "";
  });
  dropEl.addEventListener("click", function(){ input.click(); });
  dropEl.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); input.click(); }
  });
  chipsEl.addEventListener("click", function(e){
    var rm = e.target.closest("[data-kit-rm]");
    if(!rm) return;
    var key = rm.dataset.kitRm;
    pending = pending.filter(function(p){ return p.key !== key; });
    if(urls[key]){ URL.revokeObjectURL(urls[key]); delete urls[key]; }
    changed();
  });
  var unbind = bindFileDrop(dropEl, addFiles, { paste: opts.paste, pasteTarget: opts.pasteTarget || root });

  return {
    el: root,
    files: files,
    addFiles: addFiles,
    clear: clear,
    destroy: function(){
      unbind();
      clear();
      root.remove();
    }
  };
}

export {
  ALLOWED_EXT, ACCEPT, MAX_SIZE, MAX_FILES,
  extOf, fmtSize, validateFiles, reportRejected,
  uploadAttachment, openAttachment, attachmentChipHTML,
  downloadUrl, thumbUrl, bindFileDrop, createAttachKit
};