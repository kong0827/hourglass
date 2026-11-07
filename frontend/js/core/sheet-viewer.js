/* core/sheet-viewer · 任务附件 xlsx 在线预览/编辑（Univer 渲染 + SheetJS 互转，vendor 懒加载） */

import { icon } from "./icons.js";
import { esc, toast } from "./ui.js";
import { API } from "./api.js";

var VENDOR_BASE = API.url("/vendor/univer/");
var SHEETJS_URL = API.url("/vendor/sheetjs/xlsx.full.min.js");
var CSS_FILES = ["css/design.css", "css/ui.css", "css/docs-ui.css", "css/sheets-ui.css",
  "css/sheets-formula-ui.css", "css/sheets-numfmt-ui.css"];
/* 依赖顺序与官方 CDN 示例一致：react → jsx 桥 → rxjs/redi → 引擎 → 各功能包 → facade → 语言包 */
var SCRIPT_FILES = [
  "rxjs.umd.min.js", "redi.js", "redi-react.js",
  "themes.js", "protocol.js", "core.js", "network.js", "rpc.js", "design.js",
  "engine-render.js", "engine-formula.js", "drawing.js", "telemetry.js",
  "ui.js", "docs.js", "docs-ui.js",
  "sheets.js", "sheets-ui.js", "sheets-formula.js", "sheets-formula-ui.js",
  "sheets-numfmt.js", "sheets-numfmt-ui.js",
  "facade/core.js", "facade/engine-formula.js", "facade/ui.js", "facade/docs.js",
  "facade/docs-ui.js", "facade/sheets.js", "facade/sheets-ui.js",
  "facade/sheets-formula.js", "facade/sheets-numfmt.js",
  "locale/design.js", "locale/ui.js", "locale/sheets.js", "locale/sheets-ui.js",
  "locale/docs-ui.js", "locale/sheets-formula-ui.js", "locale/sheets-numfmt-ui.js"
];

/* 预览/回写上限：超出部分截断并提示，避免超大表把前端拖死 */
var MAX_ROWS = 20000, MAX_COLS = 200;

var vendorPromise = null;
var rootEl = null, hostEl = null, headName = null, headMeta = null, headActs = null, bodyEl = null;
var univerInst = null, univerAPI = null;
var current = null; /* { attachment, canEdit, onSaved } */

function csrf(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/* ---------- vendor 懒加载（只注入一次） ---------- */

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
  chain = chain.then(function(){ return loadTag("script", VENDOR_BASE + "react.min.js"); })
    .then(function(){ return loadTag("script", VENDOR_BASE + "react-dom.min.js"); })
    .then(function(){
      /* React 18 UMD 不暴露 jsx/jsxs，Univer UMD 需要，用 createElement 桥接（官方示例同款） */
      window.React.jsx = function(type, props, key){
        return React.createElement(type, key === undefined ? props : Object.assign({}, props, { key: key }));
      };
      window.React.jsxs = window.React.jsx;
    })
    .then(function(){ return loadTag("script", SHEETJS_URL); });
  SCRIPT_FILES.forEach(function(f){ chain = chain.then(function(){ return loadTag("script", VENDOR_BASE + f); }); });
  vendorPromise = chain;
  return vendorPromise;
}

/* ---------- xlsx ⇄ Univer 快照互转 ---------- */

/* SheetJS 会丢掉"有公式无缓存值"的单元格（如 openpyxl/pandas 导出的 <v></v> 空值），
   这里直接扫 zip 内 sheet XML 把这类公式补回来；数据仍全部以 SheetJS 为准 */
function inflateRaw(bytes){
  var ds = new DecompressionStream("deflate-raw");
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer()
    .then(function(b){ return new TextDecoder().decode(b); });
}
function decodeXml(s){
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, function(m, n){ return String.fromCharCode(+n); })
    .replace(/&amp;/g, "&");
}
/** 返回 { sheetName: { "A1": "B2*C2" } } 或 null（解析不了就退回纯 SheetJS 行为） */
function extractFormulas(buf){
  if(typeof DecompressionStream === "undefined") return Promise.resolve(null);
  var u = new Uint8Array(buf), dv = new DataView(buf);
  var eocd = -1;
  for(var i = u.length - 22; i >= Math.max(0, u.length - 65558); i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) return Promise.resolve(null);
  var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  var entries = [], p = cdOff;
  for(var k = 0; k < count; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    entries.push({
      name: new TextDecoder().decode(u.subarray(p + 46, p + 46 + nlen)),
      method: dv.getUint16(p + 10, true),
      csize: dv.getUint32(p + 20, true),
      lho: dv.getUint32(p + 42, true)
    });
    p += 46 + nlen + elen + clen;
  }
  function readEntry(name){
    var ent = null;
    for(var i2 = 0; i2 < entries.length; i2++){ if(entries[i2].name === name){ ent = entries[i2]; break; } }
    if(!ent) return Promise.resolve(null);
    var nl = dv.getUint16(ent.lho + 26, true), el = dv.getUint16(ent.lho + 28, true);
    var raw = u.subarray(ent.lho + 30 + nl + el, ent.lho + 30 + nl + el + ent.csize);
    if(ent.method === 0) return Promise.resolve(new TextDecoder().decode(raw));
    if(ent.method !== 8) return Promise.resolve(null);
    return inflateRaw(raw);
  }
  return Promise.all([readEntry("xl/workbook.xml"), readEntry("xl/_rels/workbook.xml.rels")])
    .then(function(pair){
      var wbXml = pair[0], relsXml = pair[1];
      if(!wbXml || !relsXml) return null;
      var ridToTarget = {};
      relsXml.replace(/<Relationship\b[^>]*?>/g, function(m){
        var id = (m.match(/\bId="([^"]+)"/) || [])[1];
        var t = (m.match(/\bTarget="([^"]+)"/) || [])[1];
        if(id && t) ridToTarget[id] = t.replace(/^\//, "");
        return m;
      });
      var sheetFile = {};
      wbXml.replace(/<sheet\b[^>]*?>/g, function(m){
        var nm = (m.match(/\bname="([^"]+)"/) || [])[1];
        var rid = (m.match(/\br:id="([^"]+)"/) || [])[1];
        if(nm && rid && ridToTarget[rid]) sheetFile[decodeXml(nm)] = ridToTarget[rid].replace(/^xl\//, "");
        return m;
      });
      var names = Object.keys(sheetFile);
      return Promise.all(names.map(function(nm){ return readEntry("xl/" + sheetFile[nm]); }))
        .then(function(xmls){
          var out = {};
          names.forEach(function(nm, i2){
            var xml = xmls[i2];
            if(!xml) return;
            var cells = {};
            xml.replace(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>((?:(?!<\/c>)[\s\S])*?)<\/c>/g, function(m, ref, inner){
              var fm = inner.match(/<f[^>]*>([^<]*)<\/f>/);
              if(fm && fm[1]) cells[ref] = decodeXml(fm[1]);
              return m;
            });
            if(Object.keys(cells).length) out[nm] = cells;
          });
          return out;
        });
    })
    .catch(function(){ return null; });
}

function xlsxToSnapshot(wb, filename, locale, formulaMap){
  var XLSX = window.XLSX;
  var sheetOrder = [], sheets = {}, truncated = false;
  wb.SheetNames.forEach(function(name, idx){
    var ws = wb.Sheets[name];
    var cellData = {}, maxR = -1, maxC = -1;
    if(ws && ws["!ref"]){
      var range = XLSX.utils.decode_range(ws["!ref"]);
      if(range.e.r >= MAX_ROWS || range.e.c >= MAX_COLS) truncated = true;
      var limR = Math.min(range.e.r, MAX_ROWS - 1), limC = Math.min(range.e.c, MAX_COLS - 1);
      for(var r = range.s.r; r <= limR; r++){
        for(var c = range.s.c; c <= limC; c++){
          var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
          if(!cell) continue;
          var out;
          if(cell.f){
            out = { f: "=" + cell.f };
            if(cell.v !== undefined && cell.v !== null) out.v = cell.v;
          }else{
            var val = cell.v;
            if(val === undefined || val === null) continue;
            if(cell.t === "b") val = !!val;
            out = { v: val };
          }
          (cellData[r] || (cellData[r] = {}))[c] = out;
          if(r > maxR) maxR = r;
          if(c > maxC) maxC = c;
        }
      }
    }
    var id = "sh" + (idx + 1);
    sheetOrder.push(id);
    /* 补回 SheetJS 丢失的无缓存公式（openpyxl/pandas 导出的 <v></v> 空值） */
    var extra = formulaMap && formulaMap[name];
    if(extra){
      Object.keys(extra).forEach(function(ref){
        var rc = XLSX.utils.decode_cell(ref);
        if(rc.r > MAX_ROWS - 1 || rc.c > MAX_COLS - 1){ truncated = true; return; }
        var row = cellData[rc.r] || (cellData[rc.r] = {});
        if(row[rc.c]) return;
        row[rc.c] = { f: "=" + extra[ref] };
        if(rc.r > maxR) maxR = rc.r;
        if(rc.c > maxC) maxC = rc.c;
      });
    }
    sheets[id] = {
      id: id, name: name,
      rowCount: Math.max(maxR + 11, 100),
      columnCount: Math.max(maxC + 6, 26),
      cellData: cellData
    };
  });
  return {
    snapshot: {
      id: "wb-sheet-viewer", name: filename, appVersion: "1.3.0",
      locale: locale, styles: {}, sheetOrder: sheetOrder, sheets: sheets
    },
    truncated: truncated
  };
}

function richTextPlain(p){
  try{
    var ds = p && p.body && p.body.dataStream;
    if(typeof ds !== "string") return null;
    ds = ds.replace(/[\r\n]+$/, "");
    return ds || null;
  }catch(e){ return null; }
}

function snapshotToXlsx(snapshot){
  var XLSX = window.XLSX;
  var wb = XLSX.utils.book_new();
  snapshot.sheetOrder.forEach(function(sheetId){
    var ss = snapshot.sheets[sheetId] || {};
    var ws = {}, maxR = 0, maxC = 0;
    var cellData = ss.cellData || {};
    Object.keys(cellData).forEach(function(r){
      var row = cellData[r] || {};
      Object.keys(row).forEach(function(c){
        var cell = row[c];
        if(!cell) return;
        var addr = XLSX.utils.encode_cell({ r: +r, c: +c });
        var out;
        if(cell.f){
          out = { f: String(cell.f).replace(/^=/, ""), t: "n" };
          if(cell.v !== undefined && cell.v !== null){
            out.v = cell.v;
            if(typeof cell.v === "string") out.t = "str";
            else if(typeof cell.v === "boolean") out.t = "b";
          }
        }else{
          var v = cell.v;
          if(v === undefined || v === null) v = richTextPlain(cell.p);
          if(v === undefined || v === null) return;
          if(typeof v === "number") out = { v: v, t: "n" };
          else if(typeof v === "boolean") out = { v: v, t: "b" };
          else out = { v: String(v), t: "s" };
        }
        ws[addr] = out;
        if(+r + 1 > maxR) maxR = +r + 1;
        if(+c + 1 > maxC) maxC = +c + 1;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxR - 1, 0), c: Math.max(maxC - 1, 0) } });
    XLSX.utils.book_append_sheet(wb, ws, String(ss.name || "Sheet").slice(0, 31) || "Sheet");
  });
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/* ---------- Univer 实例 ---------- */

function createUniver(){
  var U = window.UniverCore;
  var inst = new U.Univer({
    locale: U.LocaleType.ZH_CN,
    locales: (function(){
      var l = {};
      l[U.LocaleType.ZH_CN] = U.mergeLocales(
        window.UniverDesignZhCN, window.UniverUiZhCN, window.UniverSheetsZhCN,
        window.UniverSheetsUiZhCN, window.UniverDocsUiZhCN,
        window.UniverSheetsFormulaUiZhCN, window.UniverSheetsNumfmtUiZhCN
      );
      return l;
    })()
  });
  inst.registerPlugin(window.UniverEngineRender.UniverRenderEnginePlugin);
  inst.registerPlugin(window.UniverEngineFormula.UniverFormulaEnginePlugin);
  inst.registerPlugin(window.UniverUi.UniverUIPlugin, { container: "sheetUniverHost" });
  inst.registerPlugin(window.UniverDocs.UniverDocsPlugin);
  inst.registerPlugin(window.UniverDocsUi.UniverDocsUIPlugin);
  inst.registerPlugin(window.UniverSheets.UniverSheetsPlugin);
  inst.registerPlugin(window.UniverSheetsUi.UniverSheetsUIPlugin);
  /* 强制重算：外部 xlsx 常不带公式缓存值，WHEN_EMPTY 下缺失值不重算会显示空白 */
  inst.registerPlugin(window.UniverSheetsFormula.UniverSheetsFormulaPlugin, {
    initialFormulaComputing: window.UniverSheetsFormula.CalculationMode.FORCED
  });
  inst.registerPlugin(window.UniverSheetsFormulaUi.UniverSheetsFormulaUIPlugin);
  inst.registerPlugin(window.UniverSheetsNumfmt.UniverSheetsNumfmtPlugin);
  inst.registerPlugin(window.UniverSheetsNumfmtUi.UniverSheetsNumfmtUIPlugin);
  return inst;
}

/* ---------- 弹层 DOM ---------- */

function ensureDom(){
  if(rootEl) return;
  var style = document.createElement("style");
  style.textContent = [
    ".sheet-modal{position:fixed;inset:0;z-index:250;display:flex;flex-direction:column;background:var(--bg);}",
    ".sheet-modal[hidden]{display:none;}",
    ".sheet-modal-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--surface);}",
    ".sheet-modal-head .sm-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".sheet-modal-head .sm-meta{font-size:12px;color:var(--text-2);white-space:nowrap;}",
    ".sheet-modal-head .sm-sp{flex:1;}",
    ".sheet-modal-head .sm-ro{font-size:12px;color:var(--text-2);border:1px solid var(--border);border-radius:var(--r-md);padding:3px 8px;white-space:nowrap;}",
    ".sheet-modal-body{flex:1;position:relative;min-height:0;}",
    "#sheetUniverHost{position:absolute;inset:0;}",
    ".sheet-modal-status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px;color:var(--text-2);white-space:pre-wrap;}"
  ].join("\n");
  document.head.appendChild(style);

  rootEl = document.createElement("div");
  rootEl.className = "sheet-modal";
  rootEl.hidden = true;
  rootEl.setAttribute("role", "dialog");
  rootEl.setAttribute("aria-label", "表格预览");
  rootEl.innerHTML =
    '<div class="sheet-modal-head">' +
      '<span class="sm-name"></span>' +
      '<span class="sm-meta"></span>' +
      '<span class="sm-sp"></span>' +
      '<span class="sm-ro" hidden>只读</span>' +
      '<button type="button" class="btn sm-save" title="保存回附件"></button>' +
      '<button type="button" class="btn sm-dl" title="下载原文件"></button>' +
      '<button type="button" class="btn sm-close" title="关闭（Esc）"></button>' +
    '</div>' +
    '<div class="sheet-modal-body"><div id="sheetUniverHost"></div><div class="sheet-modal-status" hidden></div></div>';
  document.body.appendChild(rootEl);

  headName = rootEl.querySelector(".sm-name");
  headMeta = rootEl.querySelector(".sm-meta");
  headActs = {
    ro: rootEl.querySelector(".sm-ro"),
    save: rootEl.querySelector(".sm-save"),
    dl: rootEl.querySelector(".sm-dl"),
    close: rootEl.querySelector(".sm-close")
  };
  bodyEl = rootEl.querySelector(".sheet-modal-body");

  headActs.save.innerHTML = icon("check", 14) + " 保存";
  headActs.dl.innerHTML = icon("download", 14) + " 下载";
  headActs.close.innerHTML = icon("close", 14) + " 关闭";
  headActs.save.addEventListener("click", saveCurrent);
  headActs.dl.addEventListener("click", function(){
    if(current) window.open(downloadUrl(current.attachment.id), "_blank", "noopener");
  });
  headActs.close.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function(e){
    if(rootEl.hidden) return;
    if(e.key === "Escape"){ e.stopPropagation(); closeSheet(); }
  }, true);
}

function setStatus(text){
  var el = bodyEl.querySelector(".sheet-modal-status");
  if(!text){ el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = text;
}

function downloadUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}

/* ---------- 打开 / 关闭 ---------- */

/** attachment: {id, filename, size}；canEdit: 是否可保存；onSaved: 保存成功后回调（刷新附件列表） */
function openSheet(opts){
  ensureDom();
  current = { attachment: opts.attachment, canEdit: !!opts.canEdit, onSaved: opts.onSaved || null };
  headName.textContent = opts.attachment.filename;
  headMeta.textContent = "加载组件中…";
  headActs.ro.hidden = current.canEdit;
  headActs.save.hidden = !current.canEdit;
  rootEl.hidden = false;
  document.body.style.overflow = "hidden";
  setStatus("正在加载表格组件…");

  var bytes = null, vendorError = null;
  ensureVendor().catch(function(e){ vendorError = e; });
  fetch(downloadUrl(opts.attachment.id), { credentials: "same-origin" })
    .then(function(res){
      if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
      if(!res.ok) throw new Error("下载附件失败（HTTP " + res.status + "）");
      return res.arrayBuffer();
    })
    .then(function(buf){
      bytes = buf;
      return vendorPromise;
    })
    .then(function(){
      if(vendorError) throw vendorError;
      setStatus("正在解析表格…");
      return Promise.resolve().then(function(){
        var parsed = window.XLSX.read(bytes, { type: "array" });
        return extractFormulas(bytes).then(function(formulaMap){
          var converted = xlsxToSnapshot(parsed, opts.attachment.filename,
            window.UniverCore.LocaleType.ZH_CN, formulaMap);
          if(univerInst){
            try{ univerInst.dispose(); }catch(e){ /* 忽略销毁异常 */ }
            univerInst = null; univerAPI = null;
          }
          setStatus(null);
          univerInst = createUniver();
          univerAPI = window.UniverCoreFacade.FUniver.newAPI(univerInst);
          univerAPI.createWorkbook(converted.snapshot);
          var sheets = parsed.SheetNames.length;
          headMeta.textContent = sheets + " 个工作表" +
            (converted.truncated ? "（已按 " + MAX_ROWS + " 行 × " + MAX_COLS + " 列截断）" : "") +
            (current.canEdit ? " · 直接编辑后点保存" : " · 只读模式");
          if(converted.truncated) toast(current.canEdit ? "表格过大，已截断预览，保存前请注意" : "表格过大，已截断预览", "warn");
        });
      });
    })
    .catch(function(e){
      headMeta.textContent = "加载失败";
      setStatus((e && e.message) ? e.message : "表格加载失败");
      toast(e && e.message ? e.message : "表格加载失败", "bad");
    });
}

function closeSheet(){
  if(!rootEl || rootEl.hidden) return;
  if(univerInst){
    try{ univerInst.dispose(); }catch(e){ /* 忽略销毁异常 */ }
    univerInst = null; univerAPI = null;
  }
  current = null;
  rootEl.hidden = true;
  document.body.style.overflow = "";
  setStatus(null);
}

/* ---------- 保存 ---------- */

function saveCurrent(){
  if(!current || !univerAPI || !current.canEdit) return;
  var btn = headActs.save;
  btn.disabled = true;
  headMeta.textContent = "保存中…";
  Promise.resolve().then(function(){
    var snapshot = univerAPI.getActiveWorkbook().save();
    var bytes = snapshotToXlsx(snapshot);
    var fd = new FormData();
    fd.append("file", new Blob([bytes],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      current.attachment.filename);
    var url = API.url("/api/attachments/" + encodeURIComponent(current.attachment.id) + "/content" +
      (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
    return fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "X-XSRF-TOKEN": csrf() },
      body: fd
    }).then(function(res){
      if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
      return res.json().catch(function(){ return null; }).then(function(json){
        if(!json || json.code !== 0) throw new Error((json && json.message) || "保存失败");
        return json.data || {};
      });
    }).then(function(saved){
      toast("表格已保存", "fs");
      headMeta.textContent = "已保存";
      if(current){
        current.attachment.size = saved.size;
        if(current.onSaved) current.onSaved();
      }
    });
  }).catch(function(e){
    toast(e && e.message ? e.message : "保存失败", "bad");
    headMeta.textContent = "保存失败";
  }).then(function(){
    btn.disabled = false;
  });
}

export { openSheet, closeSheet };
