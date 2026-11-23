/* core/img-fit · 正文图片的尺寸治理：上传前降采样、插入后收敛初始尺寸、首次插入提示可缩放。
   工作项描述与需求文档编辑器共用同一口径。
   时序注意：SunEditor 在 img load 时才定尺寸，onImageUpload 回调里 img 还没加载完
   （offsetWidth=0），直接写尺寸会被编辑器自己的加载逻辑改写，必须挂 load 事件之后再写。 */

import { toast } from "./ui.js";

/* 长边上限：2K/4K 截图缩到 1600 仍可读，PNG 重编码后一般 <1MB */
var MAX_EDGE = 1600;

/** 大图降采样：长边超过 MAX_EDGE 时等比重编码，返回 File（失败或无需缩放时原样返回）。
    gif 直接跳过，避免丢动画。 */
export function shrinkImageFile(file){
  if(!file || !/^image\//.test(file.type || "") || /gif$/i.test(file.type || "")){
    return Promise.resolve(file);
  }
  return new Promise(function(resolve){
    var url = URL.createObjectURL(file);
    var im = new Image();
    im.onload = function(){
      URL.revokeObjectURL(url);
      try{
        var nw = im.naturalWidth, nh = im.naturalHeight;
        if(!nw || !nh || Math.max(nw, nh) <= MAX_EDGE){ resolve(file); return; }
        var scale = MAX_EDGE / Math.max(nw, nh);
        var c = document.createElement("canvas");
        c.width = Math.round(nw * scale);
        c.height = Math.round(nh * scale);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        var mime = file.type;
        var quality = mime === "image/png" ? undefined : 0.92;
        c.toBlob(function(blob){
          /* 重编码反而更大（常见于照片被存成 png）时保留原图 */
          if(!blob || blob.size >= file.size){ resolve(file); return; }
          try{
            resolve(new File([blob], file.name, { type: mime, lastModified: file.lastModified }));
          }catch(e){ resolve(file); }
        }, mime, quality);
      }catch(e){ resolve(file); }
    };
    im.onerror = function(){
      URL.revokeObjectURL(url);
      resolve(file);
    };
    im.src = url;
  });
}

/** 插入后收敛初始显示尺寸：原图不超编辑区宽用原尺寸；超出则 100%+auto（随容器缩放、不失真）。
    同时写 data-size 与拖拽后编辑器自己写的格式一致，保存/重开都能还原。 */
export function fitInsertedImage(img, editable){
  if(!img || img.tagName !== "IMG") return;
  var done = false;
  var fit = function(){
    if(done) return;
    done = true;
    var nw = img.naturalWidth, nh = img.naturalHeight;
    if(!nw || !nh) return;
    var host = img.parentElement || editable;
    var maxW = (host && host.clientWidth) || (editable && editable.clientWidth) || 0;
    if(!maxW) return;
    if(nw > maxW){
      img.style.width = "100%";
      img.style.height = "auto";
      img.setAttribute("data-size", "100%,auto");
    }else{
      img.style.width = nw + "px";
      img.style.height = nh + "px";
      img.setAttribute("data-size", nw + "px," + nh + "px");
    }
  };
  if(img.complete && img.naturalWidth) fit();
  else img.addEventListener("load", fit, { once: true });
}

var hintShown = false;
/** 首次插入正文图片时提示一次：手柄要点击图片才出现，不提示基本没人发现 */
export function notifyResizeHint(){
  if(hintShown) return;
  hintShown = true;
  toast("图片已插入：点击图片出现手柄，拖四角可调整大小");
}
