/* core/html-import · HTML 文件导入归一化
   目标：HTML 导入后结构与常用排版都保留，且预览内容 = 保存内容。

   做法：
   1. 先剥掉脚本、外链样式、表单、嵌入对象等不可信内容（附件预览另有沙箱兜底）；
   2. 把整页 HTML 放进「允许同源、禁止脚本」的隐藏 iframe，读取计算样式，
      只把常用排版属性写成行内 style（对齐服务端白名单），再统一标签；
   3. 去掉 class/id——样式已经内联，留着只会误导阅读页；
   4. 图片只保留 data 位图与 http(s) 外链，链接只保留 http(s)/mailto。

   刻意不做的：执行脚本、加载外部 CSS/字体、保留 float/position 等复杂布局。 */

var STYLE_ALLOW = {
  "color": 1, "background-color": 1, "text-align": 1,
  "font-size": 1, "font-weight": 1, "font-style": 1, "font-family": 1, "line-height": 1,
  "text-decoration": 1, "text-decoration-line": 1, "text-indent": 1, "text-transform": 1,
  "white-space": 1, "word-break": 1, "overflow-wrap": 1, "letter-spacing": 1,
  "vertical-align": 1, "list-style-type": 1,
  "margin": 1, "margin-top": 1, "margin-right": 1, "margin-bottom": 1, "margin-left": 1,
  "padding": 1, "padding-top": 1, "padding-right": 1, "padding-bottom": 1, "padding-left": 1,
  "border": 1, "border-top": 1, "border-right": 1, "border-bottom": 1, "border-left": 1,
  "border-width": 1, "border-style": 1, "border-color": 1, "border-collapse": 1, "border-spacing": 1,
  "border-radius": 1,
  "width": 1, "height": 1, "max-width": 1, "max-height": 1, "min-width": 1,
  "box-sizing": 1, "table-layout": 1
};
var BLOCK_VALUE = ["url(", "expression", "javascript:", "@import", "behavior", "binding", "attr(", "\\"];

/* 整块删除（含内容）：脚本、样式、外链、嵌入对象、表单控件与媒体 */
var DROP_TAGS = "script,style,link,meta,base,title,iframe,frame,frameset,object,embed,applet,param,"
  + "canvas,svg,math,video,audio,source,track,input,button,select,textarea,option,optgroup,datalist,"
  + "output,progress,meter,dialog,marquee,blink,noscript,template,wbr";
/* 只去壳保留内容：表单容器、图片容器等 */
var UNWRAP_TAGS = "form,label,fieldset,legend,picture,ruby,rt,rp";

var TAG_MAP = {
  font: "span", center: "div", big: "span", small: "span", mark: "span", tt: "span",
  strike: "s", article: "div", section: "div", header: "div", footer: "div", main: "div",
  aside: "div", nav: "div", figure: "div", figcaption: "div", address: "div",
  details: "div", summary: "div", time: "span", abbr: "span", acronym: "span",
  kbd: "span", samp: "span", var: "span"
};
var ALLOWED_TAGS = {
  p: 1, div: 1, span: 1, br: 1, hr: 1,
  h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
  blockquote: 1, pre: 1, code: 1, a: 1, img: 1,
  ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1,
  table: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, td: 1, th: 1, caption: 1, col: 1, colgroup: 1,
  strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, del: 1, ins: 1, sub: 1, sup: 1, q: 1, cite: 1
};

var STYLE_TIMEOUT = 6000;

function safeStyleValue(v){
  if(!v) return false;
  var s = String(v).trim();
  if(!s || s.length > 200) return false;
  var lower = s.toLowerCase();
  for(var i = 0; i < BLOCK_VALUE.length; i += 1){
    if(lower.indexOf(BLOCK_VALUE[i]) !== -1) return false;
  }
  for(var j = 0; j < s.length; j += 1){
    var c = s.charCodeAt(j);
    if(c < 32 || c === 127 || s.charAt(j) === "<" || s.charAt(j) === ">" || s.charAt(j) === "{" || s.charAt(j) === "}") return false;
  }
  return true;
}

function isZero(v){
  return /^0(px|em|rem|%|pt)?(\s+0(px|em|rem|%|pt)?)*$/.test(String(v || ""));
}
function isTransparent(v){
  return v === "transparent" || v === "rgba(0, 0, 0, 0)" || v === "rgba(0,0,0,0)" || v === "rgb(255, 255, 255)";
}
function isDefaultStart(v){
  return v === "start" || v === "left" || v === "" || v === "auto";
}
function isDefaultFont(v){
  var s = String(v || "").replace(/["']/g, "").toLowerCase();
  return !s || s === "times new roman" || s === "serif";
}
function isDefaultWeight(v){
  return v === "400" || v === "normal" || v === "500";
}
function isDefaultSize(v){
  return v === "16px" || v === "medium" || v === "";
}
function isDefaultAlign(v){
  return isDefaultStart(v);
}

function removeComments(body){
  var walker = body.ownerDocument.createTreeWalker(body, 128 /* NodeFilter.SHOW_COMMENT */, null, false);
  var list = [], node;
  while((node = walker.nextNode())) list.push(node);
  list.forEach(function(n){ if(n.parentNode) n.parentNode.removeChild(n); });
}

function cleanSeed(body){
  removeComments(body);
  var i, list;
  list = body.querySelectorAll(DROP_TAGS);
  for(i = list.length - 1; i >= 0; i -= 1){
    if(list[i].parentNode) list[i].parentNode.removeChild(list[i]);
  }
  list = body.querySelectorAll(UNWRAP_TAGS);
  for(i = list.length - 1; i >= 0; i -= 1){
    var el = list[i];
    if(!el.parentNode) continue;
    while(el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.parentNode.removeChild(el);
  }
  var all = body.querySelectorAll("*");
  for(i = 0; i < all.length; i += 1){
    var node = all[i];
    var attrs = node.attributes;
    for(var k = attrs.length - 1; k >= 0; k -= 1){
      var name = attrs[k].name.toLowerCase();
      if(name.indexOf("on") === 0 || name === "srcset" || name === "sizes" || name === "contenteditable"){
        node.removeAttribute(attrs[k].name);
      }
    }
    if(node.tagName.toLowerCase() === "a"){
      var href = node.getAttribute("href") || "";
      if(/^\s*javascript:/i.test(href)) node.removeAttribute("href");
    }
  }
}

/* 读取 body 上需要随正文带走的继承类样式；浏览器默认值不写成 wrapper，避免覆盖阅读页字体 */
function bodyWrapperStyle(cs){
  var props = [];
  function add(name, value, skip){
    if(!value || !safeStyleValue(value)) return;
    if(skip && skip(value)) return;
    props.push(name + ": " + value);
  }
  add("font-family", cs.fontFamily, isDefaultFont);
  add("font-size", cs.fontSize, isDefaultSize);
  add("font-weight", cs.fontWeight, isDefaultWeight);
  add("font-style", cs.fontStyle, function(v){ return v === "normal"; });
  add("line-height", cs.lineHeight, function(v){ return v === "normal"; });
  add("color", cs.color, function(v){ return v === "rgb(0, 0, 0)"; });
  add("text-align", cs.textAlign, isDefaultAlign);
  add("letter-spacing", cs.letterSpacing, function(v){ return v === "normal"; });
  add("word-break", cs.wordBreak, function(v){ return v === "normal"; });
  add("overflow-wrap", cs.overflowWrap || cs.wordWrap, function(v){ return !v || v === "normal"; });
  add("white-space", cs.whiteSpace, function(v){ return v === "normal"; });
  add("text-transform", cs.textTransform, function(v){ return v === "none"; });
  add("direction", cs.direction, function(v){ return v === "ltr"; });
  return props.join("; ");
}

function refStyleFor(wrapperStyle){
  var base = "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;";
  return wrapperStyle ? (base + wrapperStyle + ";") : base;
}

function pickElementStyle(doc, cs, ref, tag){
  var out = [];
  function same(name, value){
    if(!ref) return false;
    return ref.getPropertyValue(name) === value;
  }
  function add(name, value, skip){
    if(!value || !safeStyleValue(value)) return;
    if(skip && skip(value)) return;
    if(same(name, value)) return;
    out.push(name + ": " + value);
  }
  add("color", cs.color);
  add("background-color", cs.backgroundColor, isTransparent);
  add("text-align", cs.textAlign, isDefaultStart);
  add("font-size", cs.fontSize);
  add("font-family", cs.fontFamily);
  add("font-weight", cs.fontWeight);
  add("font-style", cs.fontStyle, function(v){ return v === "normal"; });
  add("line-height", cs.lineHeight, function(v){ return v === "normal"; });
  add("letter-spacing", cs.letterSpacing, function(v){ return v === "normal"; });
  add("text-indent", cs.textIndent, isZero);
  add("text-transform", cs.textTransform, function(v){ return v === "none"; });
  add("white-space", cs.whiteSpace, function(v){ return v === "normal"; });
  add("vertical-align", cs.verticalAlign, function(v){ return v === "baseline"; });
  var deco = cs.textDecorationLine || cs.textDecoration;
  add("text-decoration-line", deco, function(v){ return v === "none" || !v; });
  if(tag === "ul" || tag === "ol" || tag === "li"){
    add("list-style-type", cs.listStyleType);
  }
  if(tag === "table"){
    add("border-collapse", cs.borderCollapse, function(v){ return v === "separate"; });
    add("border-spacing", cs.borderSpacing, isZero);
    add("table-layout", cs.tableLayout, function(v){ return v === "auto"; });
  }
  add("border-radius", cs.borderRadius, isZero);
  add("max-width", cs.maxWidth, function(v){ return v === "none"; });
  var sides = [["Top", "top"], ["Right", "right"], ["Bottom", "bottom"], ["Left", "left"]];
  sides.forEach(function(pair){
    var cap = pair[0], low = pair[1];
    add("margin-" + low, cs["margin" + cap], isZero);
    add("padding-" + low, cs["padding" + cap], isZero);
    var width = cs["border" + cap + "Width"];
    var style = cs["border" + cap + "Style"];
    var color = cs["border" + cap + "Color"];
    if(style && style !== "none" && parseFloat(width) > 0){
      add("border-" + low, width + " " + style + " " + color);
    }
  });
  return out.join("; ");
}

function normalizeInFrame(doc, body){
  var win = doc.defaultView;
  var elements = body.querySelectorAll("*");
  /* 超大页面逐元素读取计算样式会卡住主线程：退化为「结构 + 原内联样式」 */
  if(elements.length > 8000) return fallbackHtml(body);
  var bodyCs = win.getComputedStyle(body);
  var wrapperStyle = bodyWrapperStyle(bodyCs);
  var refHost = doc.createElement("div");
  var refTable = doc.createElement("table");
  refTable.innerHTML = "<tbody><tr><td></td><th></th></tr></tbody>";
  refHost.setAttribute("style", refStyleFor(wrapperStyle));
  /* 参考元素放进 shadow root：页面样式（如 td{border}）不会命中参考元素，
     只保留继承与浏览器默认值，否则按标签写的 CSS 会被误判成默认值丢掉 */
  var refRoot = typeof refHost.attachShadow === "function"
    ? refHost.attachShadow({ mode: "open" })
    : refHost;
  refRoot.appendChild(refTable);
  /* 挂在末尾：避免占掉正文首个子元素，影响 :first-child 一类选择器的量测 */
  body.appendChild(refHost);

  var refs = {};
  function refFor(tag){
    if(refs[tag]) return refs[tag];
    var el;
    if(tag === "td" || tag === "th"){
      el = refTable.querySelector(tag);
    }else if(tag === "li"){
      var list = doc.createElement("ul");
      list.appendChild(doc.createElement("li"));
      refRoot.appendChild(list);
      el = list.firstChild;
    }else{
      el = doc.createElement(tag);
      refRoot.appendChild(el);
    }
    refs[tag] = win.getComputedStyle(el);
    return refs[tag];
  }

  var all = body.querySelectorAll("*");
  for(var i = 0; i < all.length; i += 1){
    var el = all[i];
    if(!el.parentNode || refHost.contains(el) || el === refTable) continue;
    if(el.nodeType !== 1) continue;
    var tag = el.tagName.toLowerCase();
    var cs = win.getComputedStyle(el);
    var style = pickElementStyle(doc, cs, refFor(tag), tag);
    var target = TAG_MAP[tag] || (ALLOWED_TAGS[tag] ? tag : (isInlineDisplay(cs) ? "span" : "div"));
    el.removeAttribute("class");
    el.removeAttribute("id");
    el.removeAttribute("style");
    if(target !== tag && !isVoid(tag)){
      el = renameTag(doc, el, target);
    }
    if(style) el.setAttribute("style", style);
  }

  cleanLinksAndImages(body);
  body.removeChild(refHost);

  var content = body.innerHTML;
  if(!wrapperStyle) return content;
  return '<div style="' + wrapperStyle.replace(/"/g, "&quot;") + '">' + content + "</div>";
}

function isVoid(tag){
  return tag === "br" || tag === "hr" || tag === "img" || tag === "col";
}
function isInlineDisplay(cs){
  var display = cs.display || "";
  return /^inline(-block|-flex|-grid|-table)?$/.test(display);
}
function renameTag(doc, el, tag){
  var next = doc.createElement(tag);
  var attrs = el.attributes;
  for(var i = 0; i < attrs.length; i += 1){
    try{ next.setAttribute(attrs[i].name, attrs[i].value); }catch(e){ /* 非法属性名跳过 */ }
  }
  while(el.firstChild) next.appendChild(el.firstChild);
  el.parentNode.replaceChild(next, el);
  return next;
}

function cleanLinksAndImages(body){
  var links = body.querySelectorAll("a");
  for(var i = 0; i < links.length; i += 1){
    var a = links[i];
    var href = (a.getAttribute("href") || "").trim();
    if(!/^(https?:|mailto:)/i.test(href)){
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }else{
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    a.removeAttribute("class");
    a.removeAttribute("id");
  }
  var imgs = body.querySelectorAll("img");
  for(var j = imgs.length - 1; j >= 0; j -= 1){
    var img = imgs[j];
    var src = (img.getAttribute("src") || "").trim();
    var ok = /^https?:\/\//i.test(src)
      || /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(src);
    if(!ok){
      img.parentNode.removeChild(img);
      continue;
    }
    var alt = img.getAttribute("alt") || "";
    var w = img.getAttribute("width") || "";
    var h = img.getAttribute("height") || "";
    var dataSize = img.getAttribute("data-size") || "";
    while(img.attributes.length) img.removeAttribute(img.attributes[0].name);
    img.setAttribute("src", src);
    if(alt) img.setAttribute("alt", alt);
    if(!dataSize && /^\d{1,5}$/.test(w) && /^\d{1,5}$/.test(h)){
      dataSize = w + "px," + h + "px";
    }
    if(dataSize) img.setAttribute("data-size", dataSize);
  }
  var tables = body.querySelectorAll("table,td,th,col,colgroup");
  for(var k = 0; k < tables.length; k += 1){
    var cell = tables[k];
    var width = cell.getAttribute("width");
    if(width && !/^\d{1,5}%?$/.test(width)) cell.removeAttribute("width");
    var span = cell.getAttribute("span");
    if(span && !/^\d{1,3}$/.test(span)) cell.removeAttribute("span");
    var colspan = cell.getAttribute("colspan");
    if(colspan && !/^\d{1,3}$/.test(colspan)) cell.removeAttribute("colspan");
    var rowspan = cell.getAttribute("rowspan");
    if(rowspan && !/^\d{1,3}$/.test(rowspan)) cell.removeAttribute("rowspan");
  }
}

function fallbackHtml(body){
  var all = body.querySelectorAll("*");
  for(var i = 0; i < all.length; i += 1){
    var el = all[i];
    var tag = el.tagName.toLowerCase();
    var keep = STYLE_ALLOW, keepStyles = [];
    var style = el.getAttribute("style") || "";
    if(style){
      style.split(";").forEach(function(part){
        var idx = part.indexOf(":");
        if(idx <= 0) return;
        var k = part.substring(0, idx).trim().toLowerCase();
        var v = part.substring(idx + 1).trim();
        if(keep[k] && safeStyleValue(v)) keepStyles.push(k + ": " + v);
      });
    }
    if(keepStyles.length) el.setAttribute("style", keepStyles.join("; "));
    else el.removeAttribute("style");
    el.removeAttribute("class");
    el.removeAttribute("id");
    if(targetForFallback(tag) !== tag && !isVoid(tag)){
      renameTag(body.ownerDocument, el, targetForFallback(tag));
    }
  }
  cleanLinksAndImages(body);
  return body.innerHTML;
}
function targetForFallback(tag){
  return TAG_MAP[tag] || (ALLOWED_TAGS[tag] ? tag : "div");
}

function buildSrcdoc(seed, css){
  var safeCss = String(css || "").split("</style").join("<\\/style");
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
    + "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:;\">"
    + "<style>html,body{margin:0;padding:0;}</style>"
    + (safeCss ? "<style>" + safeCss + "</style>" : "")
    + "</head><body>" + seed + "</body></html>";
}

/* 本地导出的 HTML 常见 GBK/GB18030：先看 BOM 与 <meta charset>，再按实际编码解码 */
function detectHtmlEncoding(bytes){
  if(bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return "utf-8";
  if(bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return "utf-16le";
  if(bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return "utf-16be";
  var head = "", n = Math.min(bytes.length, 4096);
  for(var i = 0; i < n; i += 1) head += String.fromCharCode(bytes[i]);
  var m = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_\-]+)/i.exec(head);
  if(m){
    var enc = m[1].toLowerCase();
    if(enc === "gb2312" || enc === "gbk" || enc === "gb18030") return "gb18030";
    return enc;
  }
  return "utf-8";
}

/** 按 HTML 自声明编码解码 ArrayBuffer；解码失败退 UTF-8，绝不抛错中断导入。 */
function decodeHtmlBytes(buffer){
  var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  var enc = detectHtmlEncoding(bytes);
  try{
    return new TextDecoder(enc, { fatal: false }).decode(bytes);
  }catch(e){
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/**
 * 把上传的 .html/.htm 归一化成可入库的正文 HTML。
 * 返回 Promise<string>，任何解析异常都会降级为「结构 + 内联样式」而不是中断导入。
 */
function normalizeImportedHtml(raw){
  if(!raw || !String(raw).trim()) return Promise.resolve("");
  var src;
  try{
    src = new DOMParser().parseFromString(String(raw), "text/html");
  }catch(e){
    return Promise.resolve("");
  }
  var body = src.body;
  if(!body) return Promise.resolve("");
  var css = [];
  var styleNodes = src.querySelectorAll("style");
  for(var i = 0; i < styleNodes.length; i += 1){
    css.push(styleNodes[i].textContent || "");
  }
  cleanSeed(body);
  var seed = body.innerHTML;
  var fallback;
  try{ fallback = fallbackHtml(body); }catch(e){ fallback = seed; }

  return new Promise(function(resolve){
    var frame = document.createElement("iframe");
    var done = false;
    var timer = setTimeout(function(){ finish(null); }, STYLE_TIMEOUT);
    function finish(result){
      if(done) return;
      done = true;
      clearTimeout(timer);
      frame.onload = null;
      if(frame.parentNode) frame.parentNode.removeChild(frame);
      resolve(result == null ? fallback : result);
    }
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden;";
    frame.onload = function(){
      var html = null;
      try{
        var doc = frame.contentDocument;
        if(doc && doc.body) html = normalizeInFrame(doc, doc.body);
      }catch(e){ html = null; }
      finish(html);
    };
    frame.srcdoc = buildSrcdoc(seed, css.join("\n"));
    document.body.appendChild(frame);
  });
}

export { normalizeImportedHtml, decodeHtmlBytes };
