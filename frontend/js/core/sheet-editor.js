/* core/sheet-editor · Univer 电子表格文档编辑器/阅读器（vendor 懒加载，含筛选/排序/条件格式/数据校验/超链接/查找替换） */

import { API } from "./api.js";
import { esc } from "./ui.js";
import { createSheetMention } from "./sheet-mention.js";

var VENDOR_BASE = API.url("/vendor/univer/");

var CSS_FILES = [
  "css/design.css", "css/ui.css", "css/docs-ui.css",
  "css/sheets-ui.css", "css/sheets-formula-ui.css", "css/sheets-numfmt-ui.css",
  "css/sheets-filter-ui.css", "css/sheets-sort-ui.css",
  "css/sheets-conditional-formatting-ui.css", "css/sheets-data-validation-ui.css",
  "css/sheets-hyper-link-ui.css"
];

/* 依赖顺序与官方 UMD 示例一致；ok 用来判断上一个模块是否已由文档编辑器/附件预览加载过 */
var SCRIPTS = [
  ["react.min.js", function(){ return !!window.React; }],
  ["react-dom.min.js", function(){ return !!window.ReactDOM; }],
  ["rxjs.umd.min.js", function(){ return !!window.rxjs; }],
  ["redi.js", function(){ return !!window["@wendellhu/redi"]; }],
  ["redi-react.js", function(){ return !!window["@wendellhu/redi/react-bindings"]; }],
  ["themes.js", function(){ return !!window.UniverThemes; }],
  ["protocol.js", function(){ return !!window.UniverProtocol; }],
  ["core.js", function(){ return !!window.UniverCore; }],
  ["network.js", function(){ return !!window.UniverNetwork; }],
  ["rpc.js", function(){ return !!window.UniverRpc; }],
  ["design.js", function(){ return !!window.UniverDesign; }],
  ["engine-render.js", function(){ return !!window.UniverEngineRender; }],
  ["engine-formula.js", function(){ return !!window.UniverEngineFormula; }],
  ["drawing.js", function(){ return !!window.UniverDrawing; }],
  ["telemetry.js", function(){ return !!window.UniverTelemetry; }],
  ["ui.js", function(){ return !!window.UniverUi; }],
  ["docs.js", function(){ return !!window.UniverDocs; }],
  ["docs-ui.js", function(){ return !!window.UniverDocsUi; }],
  ["sheets.js", function(){ return !!window.UniverSheets; }],
  ["sheets-ui.js", function(){ return !!window.UniverSheetsUi; }],
  ["sheets-formula.js", function(){ return !!window.UniverSheetsFormula; }],
  ["sheets-formula-ui.js", function(){ return !!window.UniverSheetsFormulaUi; }],
  ["sheets-numfmt.js", function(){ return !!window.UniverSheetsNumfmt; }],
  ["sheets-numfmt-ui.js", function(){ return !!window.UniverSheetsNumfmtUi; }],
  ["sheets-filter.js", function(){ return !!window.UniverSheetsFilter; }],
  ["sheets-filter-ui.js", function(){ return !!window.UniverSheetsFilterUi; }],
  ["sheets-sort.js", function(){ return !!window.UniverSheetsSort; }],
  ["sheets-sort-ui.js", function(){ return !!window.UniverSheetsSortUi; }],
  ["sheets-conditional-formatting.js", function(){ return !!window.UniverSheetsConditionalFormatting; }],
  ["sheets-conditional-formatting-ui.js", function(){ return !!window.UniverSheetsConditionalFormattingUi; }],
  ["data-validation.js", function(){ return !!window.UniverDataValidation; }],
  ["sheets-data-validation.js", function(){ return !!window.UniverSheetsDataValidation; }],
  ["sheets-data-validation-ui.js", function(){ return !!window.UniverSheetsDataValidationUi; }],
  ["sheets-hyper-link.js", function(){ return !!window.UniverSheetsHyperLink; }],
  ["sheets-hyper-link-ui.js", function(){ return !!window.UniverSheetsHyperLinkUi; }],
  ["find-replace.js", function(){ return !!window.UniverFindReplace; }],
  ["sheets-find-replace.js", function(){ return !!window.UniverSheetsFindReplace; }],
  ["facade/core.js", function(){ return !!(window.UniverCoreFacade && window.UniverCoreFacade.FUniver); }],
  ["facade/engine-formula.js", function(){ return !!window.UniverEngineFormulaFacade; }],
  /* 这四个包只扩展已有的 facade，没有独立全局名：用 sheets-ui facade 判断是否已由附件预览加载过 */
  ["facade/ui.js", function(){ return !!window.UniverSheetsUiFacade; }],
  ["facade/docs.js", function(){ return !!window.UniverDocsFacade; }],
  ["facade/docs-ui.js", function(){ return !!(window.UniverDocsFacade && window.UniverDocsUi); }],
  ["facade/sheets.js", function(){ return !!window.UniverSheetsFacade; }],
  ["facade/sheets-ui.js", function(){ return !!window.UniverSheetsUiFacade; }],
  ["facade/sheets-formula.js", function(){ return !!window.UniverSheetsUiFacade; }],
  ["facade/sheets-numfmt.js", function(){ return !!window.UniverSheetsUiFacade; }],
  ["locale/design.js", function(){ return !!window.UniverDesignZhCN; }],
  ["locale/ui.js", function(){ return !!window.UniverUiZhCN; }],
  ["locale/sheets.js", function(){ return !!window.UniverSheetsZhCN; }],
  ["locale/sheets-ui.js", function(){ return !!window.UniverSheetsUiZhCN; }],
  ["locale/docs-ui.js", function(){ return !!window.UniverDocsUiZhCN; }],
  ["locale/sheets-formula-ui.js", function(){ return !!window.UniverSheetsFormulaUiZhCN; }],
  ["locale/sheets-numfmt-ui.js", function(){ return !!window.UniverSheetsNumfmtUiZhCN; }],
  ["locale/sheets-filter.js", function(){ return !!window.UniverSheetsFilterZhCN; }],
  ["locale/sheets-filter-ui.js", function(){ return !!window.UniverSheetsFilterUiZhCN; }],
  ["locale/sheets-sort-ui.js", function(){ return !!window.UniverSheetsSortUiZhCN; }],
  ["locale/sheets-conditional-formatting.js", function(){ return !!window.UniverSheetsConditionalFormattingZhCN; }],
  ["locale/sheets-conditional-formatting-ui.js", function(){ return !!window.UniverSheetsConditionalFormattingUiZhCN; }],
  ["locale/data-validation.js", function(){ return !!window.UniverDataValidationZhCN; }],
  ["locale/sheets-data-validation.js", function(){ return !!window.UniverSheetsDataValidationZhCN; }],
  ["locale/sheets-data-validation-ui.js", function(){ return !!window.UniverSheetsDataValidationUiZhCN; }],
  ["locale/sheets-hyper-link.js", function(){ return !!window.UniverSheetsHyperLinkZhCN; }],
  ["locale/sheets-hyper-link-ui.js", function(){ return !!window.UniverSheetsHyperLinkUiZhCN; }],
  ["locale/find-replace.js", function(){ return !!window.UniverFindReplaceZhCN; }]
];

var vendorPromise = null;
var hostSeq = 0;

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

function ensureVendor(){
  if(vendorPromise) return vendorPromise;
  var chain = Promise.resolve();
  CSS_FILES.forEach(function(f){ chain = chain.then(function(){ return loadTag("link", VENDOR_BASE + f); }); });
  SCRIPTS.forEach(function(item){
    chain = chain.then(function(){
      if(item[1]()) return null;
      return loadTag("script", VENDOR_BASE + item[0]).then(function(){
        /* React 18 UMD 不暴露 jsx/jsxs，Univer UMD 需要，用 createElement 桥接 */
        if(window.React && !window.React.jsx){
          window.React.jsx = function(type, props, key){
            return React.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key }));
          };
          window.React.jsxs = window.React.jsx;
        }
      });
    });
  });
  vendorPromise = chain.catch(function(ex){ vendorPromise = null; throw ex; });
  return vendorPromise;
}

function localePack(){
  var U = window.UniverCore;
  var packs = [
    window.UniverDesignZhCN, window.UniverUiZhCN, window.UniverSheetsZhCN, window.UniverSheetsUiZhCN,
    window.UniverDocsUiZhCN, window.UniverSheetsFormulaUiZhCN, window.UniverSheetsNumfmtUiZhCN,
    window.UniverSheetsFilterZhCN, window.UniverSheetsFilterUiZhCN, window.UniverSheetsSortUiZhCN,
    window.UniverSheetsConditionalFormattingZhCN, window.UniverSheetsConditionalFormattingUiZhCN,
    window.UniverDataValidationZhCN, window.UniverSheetsDataValidationZhCN,
    window.UniverSheetsDataValidationUiZhCN, window.UniverSheetsHyperLinkZhCN,
    window.UniverSheetsHyperLinkUiZhCN, window.UniverFindReplaceZhCN
  ].filter(Boolean);
  var zh = {};
  zh[U.LocaleType.ZH_CN] = U.mergeLocales.apply(U, packs);
  return zh;
}

function registerPlugin(univer, pkg, cls){
  if(!pkg || !pkg[cls]) return;
  univer.registerPlugin(pkg[cls]);
}

function createUniver(hostId){
  var U = window.UniverCore;
  var univer = new U.Univer({ locale: U.LocaleType.ZH_CN, locales: localePack() });
  univer.registerPlugin(window.UniverEngineRender.UniverRenderEnginePlugin);
  univer.registerPlugin(window.UniverEngineFormula.UniverFormulaEnginePlugin);
  univer.registerPlugin(window.UniverUi.UniverUIPlugin, { container: hostId });
  univer.registerPlugin(window.UniverDocs.UniverDocsPlugin);
  univer.registerPlugin(window.UniverDocsUi.UniverDocsUIPlugin);
  univer.registerPlugin(window.UniverSheets.UniverSheetsPlugin);
  univer.registerPlugin(window.UniverSheetsUi.UniverSheetsUIPlugin);
  univer.registerPlugin(window.UniverSheetsFormula.UniverSheetsFormulaPlugin, {
    initialFormulaComputing: window.UniverSheetsFormula.CalculationMode.FORCED
  });
  univer.registerPlugin(window.UniverSheetsFormulaUi.UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(window.UniverSheetsNumfmt.UniverSheetsNumfmtPlugin);
  univer.registerPlugin(window.UniverSheetsNumfmtUi.UniverSheetsNumfmtUIPlugin);
  /* 筛选 → 排序 → 条件格式 → 数据校验 → 超链接 → 查找替换，UI 包必须跟在对应功能包后面 */
  registerPlugin(univer, window.UniverSheetsFilter, "UniverSheetsFilterPlugin");
  registerPlugin(univer, window.UniverSheetsFilterUi, "UniverSheetsFilterUIPlugin");
  registerPlugin(univer, window.UniverSheetsSort, "UniverSheetsSortPlugin");
  registerPlugin(univer, window.UniverSheetsSortUi, "UniverSheetsSortUIPlugin");
  registerPlugin(univer, window.UniverSheetsConditionalFormatting, "UniverSheetsConditionalFormattingPlugin");
  registerPlugin(univer, window.UniverSheetsConditionalFormattingUi, "UniverSheetsConditionalFormattingUIPlugin");
  registerPlugin(univer, window.UniverDataValidation, "UniverDataValidationPlugin");
  registerPlugin(univer, window.UniverSheetsDataValidation, "UniverSheetsDataValidationPlugin");
  registerPlugin(univer, window.UniverSheetsDataValidationUi, "UniverSheetsDataValidationUIPlugin");
  registerPlugin(univer, window.UniverSheetsHyperLink, "UniverSheetsHyperLinkPlugin");
  registerPlugin(univer, window.UniverSheetsHyperLinkUi, "UniverSheetsHyperLinkUIPlugin");
  registerPlugin(univer, window.UniverFindReplace, "UniverFindReplacePlugin");
  registerPlugin(univer, window.UniverSheetsFindReplace, "UniverSheetsFindReplacePlugin");
  return univer;
}

/* 1.3.0 的 FWorkbook 没有 setReadOnly，只读走工作簿权限（viewer / editor） */
function setWorkbookMode(wb, readOnly){
  if(typeof wb.setReadOnly === "function" && typeof wb.setEditable === "function"){
    return readOnly ? wb.setReadOnly() : wb.setEditable();
  }
  var perm = typeof wb.getWorkbookPermission === "function" ? wb.getWorkbookPermission() : null;
  if(!perm || typeof perm.setReadOnly !== "function"){
    throw new Error("当前表格版本不支持只读模式");
  }
  return readOnly ? perm.setReadOnly() : perm.setEditable();
}

/* ---------- 单元格引用（评论/批注锚点）：Sheet1!B3 / 'My Sheet'!B3:C5 ---------- */

function colToName(idx){
  var s = "";
  var n = idx + 1;
  while(n > 0){
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function rangeToA1(range){
  var a = colToName(range.startColumn) + (range.startRow + 1);
  var b = colToName(range.endColumn) + (range.endRow + 1);
  return a === b ? a : a + ":" + b;
}

/* 表名含空白或特殊字符时按 Excel 规则加单引号，否则引用串解析会歧义 */
function quoteSheetName(name){
  var s = String(name || "");
  return /^[A-Za-z0-9_\u4e00-\u9fa5.]+$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'";
}

/**
 * 解析单元格引用。返回 { sheetName, a1 }；不是单元格引用时返回 null。
 * 供评论侧判断「这条引用能不能定位到单元格」，不依赖 Univer 实例。
 */
export function parseCellRef(ref){
  var s = String(ref || "").trim();
  var bang = s.lastIndexOf("!");
  if(bang <= 0) return null;
  var sheetName = s.slice(0, bang).trim();
  var a1 = s.slice(bang + 1).trim();
  if(sheetName.charAt(0) === "'" && sheetName.charAt(sheetName.length - 1) === "'"){
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  if(!/^[A-Za-z]+[0-9]+(:[A-Za-z]+[0-9]+)?$/.test(a1)) return null;
  return { sheetName: sheetName, a1: a1 };
}

/**
 * 在 container 内挂载一个 Univer 工作簿视图。
 * opts: { container, snapshot, readOnly, onDirty, mention }
 * mention（可选，仅编辑态）: { canOpen, excludeUserId, loadMembers } —— 单元格内 @提及候选
 * 返回 handle：getSnapshot/getText/setReadOnly/dispose
 */
export async function openSheetView(opts){
  await ensureVendor();
  var U = window.UniverCore;
  var container = opts.container;
  if(!container) throw new Error("缺少表格容器");
  /* 必须用独立 id：若复用容器自身 id，Univer 的 getElementById 会命中外层容器，
     直接把外层 innerHTML 清空，内层 .univer-sheet-host 包装（含只读类）会被销毁 */
  var hostId = "univerSheetHost" + (++hostSeq);
  container.innerHTML = '<div class="univer-sheet-host' + (opts.readOnly ? " univer-sheet-readonly" : "") + '"></div>';
  var host = container.firstChild;
  host.id = hostId;

  var univer = createUniver(hostId);
  var wb = null;
  try{
    var api = window.UniverCoreFacade.FUniver.newAPI(univer);
    api.createWorkbook(opts.snapshot);
    wb = api.getActiveWorkbook();
    if(!wb) throw new Error("表格初始化失败");
    if(opts.readOnly) await setWorkbookMode(wb, true);
  }catch(ex){
    try{ univer.dispose(); }catch(e){ /* 忽略 */ }
    throw ex;
  }

  var dirtySub = null;
  if(!opts.readOnly && typeof opts.onDirty === "function" && typeof univer.onCommandExecuted === "function"){
    dirtySub = univer.onCommandExecuted(function(command){
      var id = command && command.id ? String(command.id) : "";
      if(/selection|Selection|cursor|Cursor|focus|Focus|scroll|Scroll|activate|Activate|hover|Hover/.test(id)) return;
      opts.onDirty();
    });
  }

  var mention = null;
  if(!opts.readOnly && opts.mention){
    try{
      mention = createSheetMention({
        container: container,
        /* 1.3.0 的 Univer 实例只暴露 __getInjector()，没有公开 getInjector() */
        getInjector: function(){
          try{
            if(typeof univer.__getInjector === "function") return univer.__getInjector();
            if(typeof univer.getInjector === "function") return univer.getInjector();
            return api && api._injector ? api._injector : null;
          }catch(e){ return null; }
        },
        canOpen: opts.mention.canOpen,
        excludeUserId: opts.mention.excludeUserId,
        loadMembers: opts.mention.loadMembers
      });
    }catch(ex){ mention = null; }
  }

  var disposed = false;
  return {
    getSnapshot: function(){ return wb.save(); },
    getText: function(){ return sheetSnapshotText(wb.save()); },
    /* 当前选区引用：Sheet1!B3 或 Sheet1!B3:C5；无选区/异常时返回 null */
    getSelectionRef: function(){
      try{
        var ws = wb.getActiveSheet();
        if(!ws) return null;
        var sel = typeof ws.getSelection === "function" ? ws.getSelection() : null;
        var range = sel && typeof sel.getActiveRange === "function" ? sel.getActiveRange() : null;
        if(!range) return null;
        return quoteSheetName(ws.getSheetName()) + "!" + rangeToA1(range.getRange());
      }catch(ex){ return null; }
    },
    /* 按引用定位：切到目标工作表、选中区域并滚动到可见位置 */
    selectRef: function(ref){
      var parsed = parseCellRef(ref);
      if(!parsed) return false;
      try{
        var ws = parsed.sheetName && typeof wb.getSheetByName === "function" ? wb.getSheetByName(parsed.sheetName) : wb.getActiveSheet();
        if(!ws) return false;
        if(typeof ws.activate === "function") ws.activate();
        var range = ws.getRange(parsed.a1);
        if(!range) return false;
        range.activate();
        if(typeof ws.scrollToCell === "function") ws.scrollToCell(range.getRow(), range.getColumn());
        return true;
      }catch(ex){ return false; }
    },
    setReadOnly: function(on){
      host.classList.toggle("univer-sheet-readonly", !!on);
      return setWorkbookMode(wb, !!on);
    },
    dispose: function(){
      if(disposed) return;
      disposed = true;
      if(mention){ try{ mention.dispose(); }catch(e){ /* 忽略 */ } }
      mention = null;
      if(dirtySub){
        if(typeof dirtySub === "function"){ try{ dirtySub(); }catch(e){ /* 忽略 */ } }
        else if(typeof dirtySub.dispose === "function"){ try{ dirtySub.dispose(); }catch(e){ /* 忽略 */ } }
      }
      try{ univer.dispose(); }catch(e){ /* 忽略 */ }
      container.innerHTML = "";
    }
  };
}

/* ---------- 快照 → 纯文本（字数、复制、历史对比共用） ---------- */

function cellTextOf(cell){
  if(!cell) return "";
  if(cell.p && cell.p.body && typeof cell.p.body.dataStream === "string") return cell.p.body.dataStream;
  if(cell.v === undefined || cell.v === null) return "";
  if(typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v);
}

export function sheetSnapshotText(snapshot){
  if(!snapshot) return "";
  var out = [];
  (snapshot.sheetOrder || []).forEach(function(sheetId){
    var ss = (snapshot.sheets || {})[sheetId];
    if(!ss) return;
    out.push(ss.name || "");
    var cellData = ss.cellData || {};
    Object.keys(cellData).forEach(function(rKey){
      var row = cellData[rKey] || {};
      var line = [];
      Object.keys(row).sort(function(a, b){ return a - b; }).forEach(function(cKey){
        var text = cellTextOf(row[cKey]);
        if(text !== "") line.push(text);
      });
      if(line.length) out.push(line.join("\t"));
    });
  });
  return out.join("\n");
}

/* ---------- 快照 → 简单 HTML 表格（打印、Word 导出、历史预览） ---------- */

function styleOfCell(snapshot, cell){
  if(!cell || !cell.s) return null;
  if(typeof cell.s === "object") return cell.s;
  return (snapshot.styles || {})[cell.s] || null;
}

export function sheetSnapshotToHtml(snapshot){
  if(!snapshot) return "";
  var parts = [];
  (snapshot.sheetOrder || []).forEach(function(sheetId){
    var ss = (snapshot.sheets || {})[sheetId];
    if(!ss) return;
    if(ss.hidden === 2) return;
    var cellData = ss.cellData || {};
    var covered = {}, spans = {};
    (ss.mergeData || []).forEach(function(range){
      if(!range) return;
      var sr = range.startRow, sc = range.startColumn, er = range.endRow, ec = range.endColumn;
      for(var r = sr; r <= er; r++){
        for(var c = sc; c <= ec; c++){
          if(r === sr && c === sc) continue;
          covered[r + "," + c] = true;
        }
      }
      spans[sr + "," + sc] = { rows: er - sr + 1, cols: ec - sc + 1 };
    });
    var rowKeys = Object.keys(cellData).map(Number);
    var maxRow = rowKeys.length ? Math.max.apply(null, rowKeys) : -1;
    var maxCol = -1;
    rowKeys.forEach(function(r){
      Object.keys(cellData[r] || {}).forEach(function(c){ maxCol = Math.max(maxCol, +c); });
    });
    var html = ['<table class="sheet-doc-table"><caption>' + esc(ss.name || "") + '</caption>'];
    for(var r = 0; r <= maxRow; r++){
      html.push("<tr>");
      for(var c = 0; c <= maxCol; c++){
        if(covered[r + "," + c]) continue;
        var cell = (cellData[r] || {})[c];
        var style = styleOfCell(snapshot, cell);
        var attrs = "";
        var span = spans[r + "," + c];
        if(span){
          if(span.rows > 1) attrs += ' rowspan="' + span.rows + '"';
          if(span.cols > 1) attrs += ' colspan="' + span.cols + '"';
        }
        var css = [];
        if(style){
          if(style.bg && style.bg.rgb) css.push("background:" + style.bg.rgb);
          if(style.cl && style.cl.rgb) css.push("color:" + style.cl.rgb);
          if(style.bl) css.push("font-weight:700");
          if(style.it) css.push("font-style:italic");
          if(style.fs) css.push("font-size:" + style.fs + "px");
          if(style.ht === 2) css.push("text-align:center");
          else if(style.ht === 3) css.push("text-align:right");
          else if(style.ht === 1) css.push("text-align:left");
        }
        if(css.length) attrs += ' style="' + css.join(";") + '"';
        html.push("<td" + attrs + ">" + esc(cellTextOf(cell)) + "</td>");
      }
      html.push("</tr>");
    }
    html.push("</table>");
    parts.push(html.join(""));
  });
  return parts.join("");
}
