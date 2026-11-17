/* core/univer-doc-io · Univer 文档快照与 HTML / 纯文本互转（调用前需 core/doc-editor.js 的 ensureVendor 已就绪） */

function docsUi(){
  return window.UniverDocsUi;
}

/** HTML → Univer 文档数据（导入路径；unitId 必须与随后创建文档的 id 一致，图片 drawings 依赖它） */
export function htmlToSnapshot(html, unitId){
  return docsUi().convertClipboardHtmlToDocumentData(html || "", unitId);
}

/** 在 index 处插入一个空段落，并把其后所有索引右移一位 */
function insertSpacerParagraph(body, atIndex){
  body.dataStream = body.dataStream.slice(0, atIndex) + "\r" + body.dataStream.slice(atIndex);
  var shift = function(value){ return value >= atIndex ? value + 1 : value; };
  (body.textRuns || []).forEach(function(run){
    run.st = shift(run.st);
    if(run.ed > atIndex) run.ed += 1;
  });
  (body.paragraphs || []).forEach(function(p){ p.startIndex = shift(p.startIndex); });
  (body.sectionBreaks || []).forEach(function(s){ s.startIndex = shift(s.startIndex); });
  (body.customRanges || []).forEach(function(r){ r.startIndex = shift(r.startIndex); r.endIndex = shift(r.endIndex); });
  (body.blockRanges || []).forEach(function(b){ b.startIndex = shift(b.startIndex); b.endIndex = shift(b.endIndex); });
  (body.customBlocks || []).forEach(function(b){ b.startIndex = shift(b.startIndex); });
  (body.tables || []).forEach(function(t){ t.startIndex = shift(t.startIndex); t.endIndex = shift(t.endIndex); });
  body.paragraphs = body.paragraphs || [];
  body.paragraphs.push({
    startIndex: atIndex,
    paragraphId: "spacer-" + atIndex + "-" + Math.random().toString(36).slice(2, 8),
    paragraphStyle: {}
  });
  body.paragraphs.sort(function(left, right){ return left.startIndex - right.startIndex; });
}

/**
 * 官方 convertBodyToHtml 的两处丢字需要导出前修补（spike 实测结论）：
 * 1) 表格后紧跟的段落被并入表格节点，段落文字被丢弃 → 补一个空段落占位；
 * 2) 没有任何 textRun 相交的段落整段丢字 → 用空样式 run 补齐覆盖区间。
 */
export function prepareForExport(snapshot){
  var doc = structuredClone(snapshot);
  var body = doc.body;
  if(!body || typeof body.dataStream !== "string") return doc;
  (body.tables || []).slice().sort(function(a, b){ return b.endIndex - a.endIndex; }).forEach(function(table){
    /* tables[].endIndex 是表格结束符之后的位置（不含） */
    var atIndex = table.endIndex;
    var next = (body.paragraphs || []).filter(function(p){ return p.startIndex >= atIndex; })[0];
    if(next && next.startIndex === atIndex) return;
    insertSpacerParagraph(body, atIndex);
  });
  var stream = body.dataStream;
  var sorted = (body.textRuns || []).slice().sort(function(a, b){ return a.st - b.st; });
  var filled = [];
  var cursor = 0;
  sorted.forEach(function(run){
    if(run.st > cursor) filled.push({ st: cursor, ed: run.st, ts: {} });
    filled.push(run);
    cursor = Math.max(cursor, run.ed);
  });
  if(cursor < stream.length) filled.push({ st: cursor, ed: stream.length, ts: {} });
  body.textRuns = filled;
  return doc;
}

/** 快照 → HTML（已做导出预处理，可直接回导） */
export function snapshotToHtml(snapshot){
  if(!snapshot) return "";
  return docsUi().convertBodyToHtml(prepareForExport(snapshot));
}

/** 快照 → 纯文本（dataStream 中去掉段落/块标记） */
export function snapshotToText(snapshot){
  var stream = snapshot && snapshot.body ? snapshot.body.dataStream : "";
  if(typeof stream !== "string") return "";
  return stream
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "");
}

/**
 * 快照标题段落：[{ startIndex, level, text }]，level 1-6。
 * paragraphs[].startIndex 指向段落结束符（\r）本身，段落文字在「上一段结束符之后 ~ 本段结束符之前」。
 */
export function snapshotHeadings(snapshot){
  var body = snapshot && snapshot.body;
  if(!body || typeof body.dataStream !== "string") return [];
  var stream = body.dataStream;
  /* 表格单元格文字与段落同处 dataStream，取文字前把表格区间抹成空格（保留索引） */
  (body.tables || []).forEach(function(t){
    if(typeof t.startIndex !== "number" || typeof t.endIndex !== "number") return;
    stream = stream.slice(0, t.startIndex) + " ".repeat(Math.max(0, t.endIndex - t.startIndex)) + stream.slice(t.endIndex);
  });
  var paragraphs = (body.paragraphs || []).slice().sort(function(a, b){ return a.startIndex - b.startIndex; });
  var out = [];
  var prev = -1;
  paragraphs.forEach(function(p){
    var start = prev + 1;
    prev = p.startIndex;
    var named = p.paragraphStyle && p.paragraphStyle.namedStyleType;
    if(typeof named !== "number" || named < 4 || named > 9) return;
    var text = stream.slice(start, p.startIndex)
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if(!text) return;
    out.push({ startIndex: p.startIndex, level: named - 3, text: text });
  });
  return out;
}

/** content 是否是 Univer 快照 JSON（对象或字符串均可） */
export function parseSnapshot(content){
  if(!content) return null;
  if(typeof content === "object") return content;
  try{
    var parsed = JSON.parse(content);
    return parsed && parsed.body && typeof parsed.body.dataStream === "string" ? parsed : null;
  }catch(e){
    return null;
  }
}
