/* core/doc-editor · Univer 文档编辑器/阅读器（vendor 懒加载，文档排版走 ESM Worker） */

import { API } from "./api.js";

var VENDOR_BASE = API.url("/vendor/univer/");
var WORKER_URL = API.url("/vendor/univer/docs-layout-worker.js");
var CSS_FILES = ["css/design.css", "css/ui.css", "css/docs-ui.css"];
/* 依赖顺序与官方 UMD 示例一致；sheets 相关包不加载（表格预览有自己的 loader） */
var SCRIPT_FILES = [
  "rxjs.umd.min.js", "redi.js", "redi-react.js",
  "themes.js", "protocol.js", "core.js", "network.js", "rpc.js", "design.js",
  "engine-render.js", "drawing.js", "telemetry.js",
  "ui.js", "docs.js", "docs-ui.js",
  "facade/core.js", "facade/docs.js", "facade/docs-ui.js",
  "locale/design.js", "locale/ui.js", "locale/docs-ui.js"
];

var vendorPromise = null;
var hostSeq = 0;
var styleReady = false;

function loadTag(tag, url){
  return new Promise(function(resolve, reject){
    var el = document.createElement(tag);
    if(tag === "link"){ el.rel = "stylesheet"; el.href = url; }
    else el.src = url;
    el.onload = function(){ resolve(); };
    el.onerror = function(){ reject(new Error("加载失败：" + url)); };
    document.head.appendChild(el);
  });
}

/** 文档编辑器 vendor 就绪（与 sheet-viewer 共用同一批 UMD 文件，已加载则直接返回） */
export function ensureVendor(){
  if(vendorPromise) return vendorPromise;
  if(window.UniverDocsFacade && window.UniverDocsUi && window.UniverCore){ vendorPromise = Promise.resolve(); return vendorPromise; }
  var chain = Promise.resolve();
  CSS_FILES.forEach(function(f){ chain = chain.then(function(){ return loadTag("link", VENDOR_BASE + f); }); });
  chain = chain.then(function(){ return loadTag("script", VENDOR_BASE + "react.min.js"); })
    .then(function(){ return loadTag("script", VENDOR_BASE + "react-dom.min.js"); })
    .then(function(){
      /* React 18 UMD 不暴露 jsx/jsxs，Univer UMD 需要，用 createElement 桥接 */
      window.React.jsx = function(type, props, key){
        return React.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key }));
      };
      window.React.jsxs = window.React.jsx;
    });
  SCRIPT_FILES.forEach(function(f){ chain = chain.then(function(){ return loadTag("script", VENDOR_BASE + f); }); });
  vendorPromise = chain.catch(function(ex){ vendorPromise = null; throw ex; });
  return vendorPromise;
}

function ensureStyle(){
  if(styleReady) return;
  styleReady = true;
  var style = document.createElement("style");
  style.textContent = [
    ".univer-doc-host{position:absolute;inset:0;}",
    ".univer-doc-host .univer-toolbar-container{position:sticky;top:0;z-index:5;}",
    ".univer-doc-readonly .univer-toolbar-container{display:none;}",
    ".univer-doc-host .univer-render-canvas-container{background:transparent;}"
  ].join("\n");
  document.head.appendChild(style);
}

function localePack(){
  var U = window.UniverCore;
  var zh = {};
  zh[U.LocaleType.ZH_CN] = U.mergeLocales(
    window.UniverDesignZhCN, window.UniverUiZhCN, window.UniverDocsUiZhCN
  );
  return zh;
}

/**
 * 在 container 内挂载一个 Univer 文档视图。
 * opts: { container, snapshot, html, readOnly, title, onDirty }
 * snapshot 为空时用 html 现场转换（旧 html 正文与导入文件走同一入口）
 * 返回 handle：save/getSnapshot/getText/setReadOnly/scrollToIndex/dispose
 */
export async function openDocView(opts){
  await ensureVendor();
  ensureStyle();
  var U = window.UniverCore;
  var container = opts.container;
  if(!container) throw new Error("缺少文档容器");
  var hostId = container.id || ("univerDocHost" + (++hostSeq));
  container.innerHTML = '<div class="univer-doc-host' + (opts.readOnly ? " univer-doc-readonly" : "") + '"></div>';
  var host = container.firstChild;
  host.id = hostId;

  var univer = new U.Univer({ locale: U.LocaleType.ZH_CN, locales: localePack() });
  var api = null;
  try{
    univer.registerPlugin(window.UniverEngineRender.UniverRenderEnginePlugin);
    univer.registerPlugin(window.UniverUi.UniverUIPlugin, { container: hostId });
    univer.registerPlugin(window.UniverDocs.UniverDocsPlugin);
    univer.registerPlugin(window.UniverDocsUi.UniverDocsUIPlugin);
    univer.registerPlugin(window.UniverDocs.UniverDocsLayoutWorkerPlugin, {
      workerFactory: function(){ return new Worker(WORKER_URL, { type: "module" }); }
    });
    api = window.UniverCoreFacade.FUniver.newAPI(univer);
    var unitId = "hg-doc-" + Date.now().toString(36) + "-" + (++hostSeq);
    var snapshot = opts.snapshot
      ? Object.assign({}, opts.snapshot)
      : window.UniverDocsUi.convertClipboardHtmlToDocumentData(opts.html || "<p></p>", unitId);
    snapshot.id = unitId;
    snapshot.title = opts.title || "文档";
    api.createDocument(snapshot);
    var doc = api.getDocument(unitId);
    if(!doc) throw new Error("文档初始化失败");
    if(opts.readOnly) await doc.setReadOnly();
  }catch(ex){
    try{ univer.dispose(); }catch(e){ /* 忽略 */ }
    throw ex;
  }

  var dirtySub = null;
  if(!opts.readOnly && typeof opts.onDirty === "function" && typeof univer.onCommandExecuted === "function"){
    /* 命令事件挂在 Univer 实例上；facade 的 FUniverAPI 未暴露该订阅 */
    dirtySub = univer.onCommandExecuted(function(command){
      var id = command && command.id ? String(command.id) : "";
      /* 选区/主键移动类命令不算内容修改 */
      if(/selection|Selection|cursor|Cursor|focus|Focus/.test(id)) return;
      opts.onDirty();
    });
  }

  var disposed = false;
  return {
    getSnapshot: function(){ return doc.save(); },
    getText: function(){
      var snap = doc.save();
      var stream = snap && snap.body ? snap.body.dataStream : "";
      return typeof stream === "string" ? stream : "";
    },
    save: function(){ return doc.save(); },
    setReadOnly: function(on){
      host.classList.toggle("univer-doc-readonly", !!on);
      return on ? doc.setReadOnly() : doc.setEditable();
    },
    scrollToIndex: function(index){
      try{ doc.setSelection(index); }catch(e){ /* 版本差异时忽略跳转 */ }
    },
    dispose: function(){
      if(disposed) return;
      disposed = true;
      if(dirtySub){
        if(typeof dirtySub === "function"){ try{ dirtySub(); }catch(e){ /* 忽略 */ } }
        else if(typeof dirtySub.dispose === "function"){ try{ dirtySub.dispose(); }catch(e){ /* 忽略 */ } }
      }
      try{ univer.dispose(); }catch(e){ /* 忽略 */ }
      container.innerHTML = "";
    }
  };
}
