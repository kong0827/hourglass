/* core/xlsx-fidelity · ExcelJS ⇄ Univer 表格快照互转。
   目标：导入导出保留单元格样式、合并、列宽行高、冻结与公式；图表/图片/数据透视不保留。 */

import { API } from "./api.js";

var VENDOR_URL = API.url("/vendor/exceljs/exceljs.min.js");
var MAX_CELLS = 100000;
var MAX_SHEETS = 20;
var MAX_ROWS = 20000;
var MAX_COLS = 300;
/* 快照 appVersion 必须与本仓 vendor/univer 的 UMD 版本一致，否则 Univer 迁移链会错位 */
var APP_VERSION = "1.3.0";
var DEFAULT_COL_W = 88;
var DEFAULT_ROW_H = 24;

/* ExcelJS 的边框样式名 → Univer BorderStyleTypes（1=thin … 13=thick） */
var BORDER_STYLE = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6,
  double: 7, medium: 8, mediumDashed: 9, mediumDashDot: 10,
  mediumDashDotDot: 11, slantDashDot: 12, thick: 13
};
var H_ALIGN = { left: 1, center: 2, right: 3, justify: 4, fill: 5, distributed: 6 };
var V_ALIGN = { top: 1, middle: 2, bottom: 3 };
var DECORATION = { single: 12, double: 10 }; /* TextDecoration.SINGLE / DOUBLE */

var excelPromise = null;

export function ensureExcelJs(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(excelPromise) return excelPromise;
  excelPromise = new Promise(function(resolve, reject){
    var el = document.createElement("script");
    el.src = VENDOR_URL;
    el.onload = function(){
      window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("ExcelJS 未就绪"));
    };
    el.onerror = function(){ reject(new Error("表格导入组件加载失败")); };
    document.head.appendChild(el);
  }).catch(function(ex){ excelPromise = null; throw ex; });
  return excelPromise;
}

/* ---------- 基础换算 ---------- */

/** ExcelJS 用 ARGB（含 theme 索引）；Univer 只认 #RRGGBB */
function cssColor(color){
  if(!color) return null;
  var argb = color.argb;
  if(typeof argb !== "string" || !/^[0-9a-fA-F]{6,8}$/.test(argb)) return null;
  if(argb.length === 8 && parseInt(argb.slice(0, 2), 16) === 0) return null;
  return "#" + argb.slice(-6);
}

function ptToPx(pt){
  return Math.round((Number(pt) || 0) * 96 / 72);
}
function pxToPt(px){
  return Math.round((Number(px) || 0) * 72 / 96 * 100) / 100;
}
/** Excel 列宽按字符数，Univer 用像素；Calibri 11 下 1 字符约 7px + 5px 内边距 */
function charsToPx(chars){
  return Math.round((Number(chars) || 0) * 7 + 5);
}
function pxToChars(px){
  return Math.max(2, Math.round(((Number(px) || 0) - 5) / 7 * 100) / 100);
}

/** Excel 日期序列号（1900 日期系统，含 1900-02-29 的历史偏差） */
function dateToSerial(date){
  var ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds());
  return (ms - Date.UTC(1899, 11, 30)) / 86400000;
}

function colToNum(text){
  var n = 0;
  for(var i = 0; i < text.length; i++) n = n * 26 + (text.charCodeAt(i) - 64);
  return n;
}

/** ExcelJS 的合并地址形如 "A1:B2"（可能带 Sheet 前缀）→ Univer IRange（0-based） */
function parseMergeRange(text){
  var m = String(text || "").match(/([A-Z]+)(\d+):([A-Z]+)(\d+)\s*$/i);
  if(!m) return null;
  var r1 = Number(m[2]) - 1, c1 = colToNum(m[1].toUpperCase()) - 1;
  var r2 = Number(m[4]) - 1, c2 = colToNum(m[3].toUpperCase()) - 1;
  return { startRow: Math.min(r1, r2), startColumn: Math.min(c1, c2),
    endRow: Math.max(r1, r2), endColumn: Math.max(c1, c2) };
}

/* ---------- 样式池：同样的样式只存一份，单元格里存 id ---------- */

function StyleBook(){
  this.byKey = {};
  this.byId = {};
  this.seq = 0;
}
StyleBook.prototype.add = function(style){
  if(!style || !Object.keys(style).length) return null;
  var key = JSON.stringify(style);
  if(this.byKey[key]) return this.byKey[key];
  var id = "s" + (++this.seq);
  this.byKey[key] = id;
  this.byId[id] = style;
  return id;
};

/* ---------- ExcelJS → Univer ---------- */

function borderOf(style, key){
  var b = style && style.border && style.border[key];
  if(!b || !b.style) return null;
  var type = BORDER_STYLE[b.style];
  if(!type) return null;
  var color = cssColor(b.color);
  return { s: type, cl: { rgb: color || "#000000" } };
}

function styleOf(cell){
  var st = cell.style || {};
  var out = {};
  var font = st.font;
  if(font){
    if(font.name) out.ff = font.name;
    if(font.size) out.fs = font.size;
    if(font.bold) out.bl = 1;
    if(font.italic) out.it = 1;
    var fc = cssColor(font.color);
    if(fc) out.cl = { rgb: fc };
    if(font.strike) out.st = { s: 1, t: DECORATION.single };
    if(font.underline){
      var ulType = /double/i.test(String(font.underline)) ? DECORATION.double : DECORATION.single;
      out.ul = { s: 1, t: ulType };
    }
    if(font.vertAlign === "superscript") out.va = 3;
    else if(font.vertAlign === "subscript") out.va = 2;
  }
  var fill = st.fill;
  if(fill && fill.type === "pattern" && fill.pattern === "solid"){
    var bg = cssColor(fill.fgColor);
    if(bg) out.bg = { rgb: bg };
  } else if(fill && fill.type === "gradient" && fill.stops && fill.stops.length){
    /* Univer 单元格底色不支持渐变，取首个色标近似 */
    var g = cssColor(fill.stops[0].color);
    if(g) out.bg = { rgb: g };
  }
  var al = st.alignment;
  if(al){
    if(H_ALIGN[al.horizontal]) out.ht = H_ALIGN[al.horizontal];
    if(V_ALIGN[al.vertical]) out.vt = V_ALIGN[al.vertical];
    if(al.wrapText) out.tb = 3; /* WrapStrategy.WRAP */
    if(al.shrinkToFit) out.stf = 1;
    var rot = al.textRotation;
    if(typeof rot === "number" && rot){
      if(rot === 255) out.tr = { a: 0, v: 1 };
      else if(rot <= 90) out.tr = { a: rot };
      else out.tr = { a: 180 - rot }; /* OOXML 90~180 表示顺时针，换算回 -90~0 */
    }
  }
  var top = borderOf(st, "top"), bottom = borderOf(st, "bottom");
  var left = borderOf(st, "left"), right = borderOf(st, "right");
  if(top || bottom || left || right){
    out.bd = {};
    if(top) out.bd.t = { s: top.s, cl: top.cl };
    if(bottom) out.bd.b = { s: bottom.s, cl: bottom.cl };
    if(left) out.bd.l = { s: left.s, cl: left.cl };
    if(right) out.bd.r = { s: right.s, cl: right.cl };
  }
  if(st.numFmt) out.n = { pattern: st.numFmt };
  return Object.keys(out).length ? out : null;
}

function richTextPlain(value){
  var parts = value && value.richText;
  if(!parts || !parts.length) return null;
  var text = "";
  parts.forEach(function(part){ text += part.text == null ? "" : String(part.text); });
  return text;
}

/** ExcelJS 单元格值 → Univer ICellData 的取值部分（v/f/custom） */
function valueOf(cell){
  var type = cell.type;
  var VT = window.ExcelJS.ValueType;
  var value = cell.value;
  if(value === null || value === undefined || type === VT.Merge) return null;
  if(value instanceof Date || type === VT.Date){
    return { v: dateToSerial(value) };
  }
  if(type === VT.Number) return { v: value };
  if(type === VT.Boolean) return { v: !!value };
  if(type === VT.String || type === VT.SharedString) return { v: String(value) };
  if(type === VT.Error) return { v: value.error || "#ERROR" };
  if(type === VT.Formula || (value && value.formula)){
    var result = value.result;
    if(result instanceof Date) result = dateToSerial(result);
    else if(result && typeof result === "object" && result.error) result = result.error;
    var out = { f: "=" + String(value.formula || "").replace(/^=/, "") };
    if(result !== undefined && result !== null) out.v = result;
    return out;
  }
  if(value && value.richText) return { v: richTextPlain(value) };
  if(value && value.hyperlink){
    /* 保留链接地址，导出时可还原；单元格内不渲染成可点击样式（Univer 1.5 需富文本文档结构） */
    return { v: value.text == null ? value.hyperlink : String(value.text),
      custom: { hgLink: String(value.hyperlink) } };
  }
  if(typeof value === "string" || typeof value === "number" || typeof value === "boolean"){
    return { v: value };
  }
  return null;
}

/**
 * ExcelJS Buffer → Univer 工作簿快照。
 * opts: { filename, locale, truncate, maxRows, maxCols, maxCells }。
 * 默认超限抛错避免静默丢数据；预览场景传 truncate:true，按上限截断并返回 truncated。
 */
export async function excelToSnapshot(buffer, opts){
  var E = await ensureExcelJs();
  opts = opts || {};
  var truncate = !!opts.truncate;
  var maxRows = opts.maxRows || MAX_ROWS;
  var maxCols = opts.maxCols || MAX_COLS;
  var maxCells = truncate ? Infinity : (opts.maxCells || MAX_CELLS);
  var truncated = false;
  var wb = new E.Workbook();
  await wb.xlsx.load(buffer);
  var sheets = wb.worksheets || [];
  if(!sheets.length) throw new Error("Excel 里没有工作表");
  if(sheets.length > MAX_SHEETS){
    if(!truncate) throw new Error("工作表超过 " + MAX_SHEETS + " 个，请拆分后再导入");
    sheets = sheets.slice(0, MAX_SHEETS);
    truncated = true;
  }

  var book = new StyleBook();
  var snapshot = {
    id: "wb-" + Date.now().toString(36),
    name: opts.filename || "表格",
    appVersion: APP_VERSION,
    locale: opts.locale || "zhCN",
    styles: {},
    sheetOrder: [],
    sheets: {}
  };
  var totalCells = 0;

  sheets.forEach(function(ws, idx){
    var id = "sh" + (idx + 1);
    var cellData = {};
    var mergeData = [];
    var rowData = {};
    var columnData = {};
    var maxRow = 0, maxCol = 0;

    ws.eachRow({ includeEmpty: true }, function(row, rowNumber){
      if(rowNumber > maxRows){
        if(!truncate) throw new Error("「" + ws.name + "」超过 " + maxRows + " 行上限");
        truncated = true;
        return;
      }
      row.eachCell({ includeEmpty: true }, function(cell, colNumber){
        if(colNumber > maxCols){
          if(!truncate) throw new Error("「" + ws.name + "」超过 " + maxCols + " 列上限");
          truncated = true;
          return;
        }
        var isDate = cell.type === E.ValueType.Date || cell.value instanceof Date;
        var style = styleOf(cell);
        var value = valueOf(cell);
        if(!style && !value) return;
        totalCells++;
        if(totalCells > maxCells){
          if(truncate){
            truncated = true;
            return;
          }
          throw new Error("单元格超过 " + maxCells + " 个上限，请拆分后再导入");
        }
        if(isDate && (!style || !style.n)){
          style = style || {};
          style.n = { pattern: "yyyy-mm-dd" }; /* 有值无格式的日期默认按日显示，避免显示成 45xxx */
        }
        var cellOut = value || {};
        if(style) cellOut.s = book.add(style);
        (cellData[rowNumber - 1] || (cellData[rowNumber - 1] = {}))[colNumber - 1] = cellOut;
        if(rowNumber > maxRow) maxRow = rowNumber;
        if(colNumber > maxCol) maxCol = colNumber;
      });
      if(row.height || row.hidden){
        rowData[rowNumber - 1] = {
          h: row.height ? ptToPx(row.height) : undefined,
          hd: row.hidden ? 1 : undefined
        };
      }
    });

    (ws.model.merges || []).forEach(function(text){
      var range = parseMergeRange(text);
      if(!range) return;
      if(range.endRow >= maxRows || range.endColumn >= maxCols){
        if(!truncate){
          throw new Error("「" + ws.name + "」合并区域超出 " + maxRows + " 行 / " + maxCols + " 列上限");
        }
        truncated = true;
        return;
      }
      mergeData.push(range);
      if(range.endRow + 1 > maxRow) maxRow = range.endRow + 1;
      if(range.endColumn + 1 > maxCol) maxCol = range.endColumn + 1;
    });

    for(var c = 1; c <= maxCol; c++){
      var col = ws.getColumn(c);
      if(col.width === undefined && !col.hidden) continue;
      columnData[c - 1] = {
        w: col.width === undefined ? undefined : charsToPx(col.width),
        hd: col.hidden ? 1 : undefined
      };
    }

    var freeze = { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 };
    var view = (ws.views || [])[0];
    if(view && view.state === "frozen"){
      /* ExcelJS 对未冻结的方向可能给 -1 / undefined，Univer 侧按 0 处理 */
      freeze.xSplit = Math.max(0, Number(view.xSplit) || 0);
      freeze.ySplit = Math.max(0, Number(view.ySplit) || 0);
      freeze.startRow = freeze.ySplit;
      freeze.startColumn = freeze.xSplit;
    }

    snapshot.sheetOrder.push(id);
    snapshot.sheets[id] = {
      id: id,
      name: String(ws.name || ("Sheet" + (idx + 1))).slice(0, 31),
      tabColor: cssColor(ws.properties && ws.properties.tabColor) || "",
      hidden: ws.state === "hidden" ? 1 : (ws.state === "veryHidden" ? 2 : 0),
      freeze: freeze,
      rowCount: Math.max(maxRow + 11, 100),
      columnCount: Math.max(maxCol + 6, 30),
      zoomRatio: 1,
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: ws.properties && ws.properties.defaultColWidth
        ? charsToPx(ws.properties.defaultColWidth) : DEFAULT_COL_W,
      defaultRowHeight: ws.properties && ws.properties.defaultRowHeight
        ? ptToPx(ws.properties.defaultRowHeight) : DEFAULT_ROW_H,
      mergeData: mergeData,
      cellData: cellData,
      rowData: rowData,
      columnData: columnData,
      rowHeader: { width: 46 },
      columnHeader: { height: 24 },
      showGridlines: 1,
      rightToLeft: 0
    };
  });

  snapshot.styles = book.byId;
  return { snapshot: snapshot, truncated: truncated };
}

/** 空工作簿快照（新建表格文档用） */
export function blankSnapshot(opts){
  opts = opts || {};
  var id = "sh1";
  return {
    id: "wb-" + Date.now().toString(36),
    name: opts.filename || "表格",
    appVersion: APP_VERSION,
    locale: opts.locale || "zhCN",
    styles: {},
    sheetOrder: [id],
    sheets: (function(){
      var sheets = {};
      sheets[id] = {
        id: id,
        name: "Sheet1",
        tabColor: "",
        hidden: 0,
        freeze: { xSplit: 0, ySplit: 0, startRow: 0, startColumn: 0 },
        rowCount: 100,
        columnCount: 30,
        zoomRatio: 1,
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: DEFAULT_COL_W,
        defaultRowHeight: DEFAULT_ROW_H,
        mergeData: [],
        cellData: {},
        rowData: {},
        columnData: {},
        rowHeader: { width: 46 },
        columnHeader: { height: 24 },
        showGridlines: 1,
        rightToLeft: 0
      };
      return sheets;
    })()
  };
}

/* ---------- Univer → ExcelJS ---------- */

function styleById(styles, cell){
  if(!cell || !cell.s) return null;
  if(typeof cell.s === "object") return cell.s;
  return styles[cell.s] || null;
}

function excelBorderOf(bd, key, style){
  var side = bd && bd[key];
  if(!side || !side.s) return null;
  var name = null;
  Object.keys(BORDER_STYLE).forEach(function(k){
    if(BORDER_STYLE[k] === side.s && !name) name = k;
  });
  if(!name) return null;
  return { style: name, color: { argb: "FF" + (side.cl && side.cl.rgb
    ? side.cl.rgb.replace("#", "").toUpperCase() : "000000") } };
}

function excelStyleOf(style){
  if(!style) return null;
  var out = {};
  var font = {};
  if(style.ff) font.name = style.ff;
  if(style.fs) font.size = style.fs;
  if(style.bl) font.bold = true;
  if(style.it) font.italic = true;
  if(style.cl && style.cl.rgb) font.color = { argb: "FF" + style.cl.rgb.replace("#", "").toUpperCase() };
  if(style.st && style.st.s) font.strike = true;
  if(style.ul && style.ul.s){
    font.underline = style.ul.t === DECORATION.double ? "double" : "single";
  }
  if(style.va === 3) font.vertAlign = "superscript";
  else if(style.va === 2) font.vertAlign = "subscript";
  if(Object.keys(font).length) out.font = font;

  if(style.bg && style.bg.rgb){
    out.fill = { type: "pattern", pattern: "solid",
      fgColor: { argb: "FF" + style.bg.rgb.replace("#", "").toUpperCase() } };
  }
  var align = {};
  var h = { 1: "left", 2: "center", 3: "right", 4: "justify", 5: "fill", 6: "distributed" }[style.ht];
  var v = { 1: "top", 2: "middle", 3: "bottom" }[style.vt];
  if(h) align.horizontal = h;
  if(v) align.vertical = v;
  if(style.tb === 3) align.wrapText = true;
  if(style.stf) align.shrinkToFit = true;
  if(style.tr && style.tr.a){
    align.textRotation = style.tr.v ? 255 : (style.tr.a < 0 ? 180 + style.tr.a : style.tr.a);
  }
  if(Object.keys(align).length) out.alignment = align;

  var border = {};
  var top = excelBorderOf(style.bd, "t"), bottom = excelBorderOf(style.bd, "b");
  var left = excelBorderOf(style.bd, "l"), right = excelBorderOf(style.bd, "r");
  if(top) border.top = top;
  if(bottom) border.bottom = bottom;
  if(left) border.left = left;
  if(right) border.right = right;
  if(Object.keys(border).length) out.border = border;

  if(style.n && style.n.pattern) out.numFmt = style.n.pattern;
  return Object.keys(out).length ? out : null;
}

function plainTextOf(cell){
  if(!cell) return null;
  if(cell.p && cell.p.body && typeof cell.p.body.dataStream === "string"){
    return cell.p.body.dataStream.replace(/[\r\n]+$/, "");
  }
  return null;
}

function linkOf(cell){
  var ranges = cell && cell.p && cell.p.body && cell.p.body.customRanges;
  if(!ranges || !ranges.length) return null;
  for(var i = 0; i < ranges.length; i++){
    if(ranges[i] && ranges[i].properties && ranges[i].properties.url){
      return ranges[i].properties.url;
    }
  }
  return null;
}

function excelValueOf(cell, style){
  if(!cell) return null;
  if(cell.f){
    var result = cell.v;
    if(result === undefined || result === null) result = undefined;
    return { formula: String(cell.f).replace(/^=/, ""), result: result };
  }
  var text = plainTextOf(cell);
  if(text !== null){
    var url = linkOf(cell);
    return url ? { text: text, hyperlink: url } : text;
  }
  if(cell.custom && cell.custom.hgLink){
    return { text: cell.v == null ? "" : String(cell.v), hyperlink: String(cell.custom.hgLink) };
  }
  if(cell.v === undefined) return null;
  return cell.v;
}

/** Univer 快照 → ExcelJS 工作簿字节（xlsx） */
export async function snapshotToExcel(snapshot){
  var E = await ensureExcelJs();
  var wb = new E.Workbook();
  var styles = snapshot.styles || {};
  (snapshot.sheetOrder || []).forEach(function(sheetId){
    var ss = (snapshot.sheets || {})[sheetId];
    if(!ss) return;
    var ws = wb.addWorksheet(String(ss.name || "Sheet").slice(0, 31) || "Sheet", {
      properties: {
        tabColor: ss.tabColor ? { argb: "FF" + ss.tabColor.replace("#", "").toUpperCase() } : undefined,
        defaultRowHeight: ss.defaultRowHeight ? pxToPt(ss.defaultRowHeight) : undefined,
        defaultColWidth: ss.defaultColumnWidth ? pxToChars(ss.defaultColumnWidth) : undefined
      },
      state: ss.hidden === 2 ? "veryHidden" : (ss.hidden ? "hidden" : "visible")
    });

    var freeze = ss.freeze || {};
    if(freeze.xSplit || freeze.ySplit){
      ws.views = [{ state: "frozen", xSplit: freeze.xSplit || 0, ySplit: freeze.ySplit || 0 }];
    }

    var columnData = ss.columnData || {};
    Object.keys(columnData).forEach(function(key){
      var meta = columnData[key] || {};
      var col = ws.getColumn(Number(key) + 1);
      if(meta.w) col.width = pxToChars(meta.w);
      if(meta.hd) col.hidden = true;
    });

    var rowData = ss.rowData || {};
    Object.keys(rowData).forEach(function(key){
      var meta = rowData[key] || {};
      var row = ws.getRow(Number(key) + 1);
      if(meta.h) row.height = pxToPt(meta.h);
      if(meta.hd) row.hidden = true;
    });

    var cellData = ss.cellData || {};
    Object.keys(cellData).forEach(function(rKey){
      var row = cellData[rKey] || {};
      Object.keys(row).forEach(function(cKey){
        var cell = row[cKey];
        if(!cell) return;
        var style = styleById(styles, cell);
        var target = ws.getCell(Number(rKey) + 1, Number(cKey) + 1);
        var value = excelValueOf(cell, style);
        if(value !== null) target.value = value;
        var excelStyle = excelStyleOf(style);
        if(excelStyle) target.style = excelStyle;
      });
    });

    (ss.mergeData || []).forEach(function(range){
      if(!range) return;
      try{
        ws.mergeCells(range.startRow + 1, range.startColumn + 1,
          range.endRow + 1, range.endColumn + 1);
      }catch(e){ /* 重叠合并等脏数据跳过，保证其余内容可导出 */ }
    });
  });
  return wb.xlsx.writeBuffer();
}

export { MAX_CELLS, MAX_SHEETS, MAX_ROWS, MAX_COLS };
