/* 文档文本差异：行级 LCS + 行内词级差异；纯函数，无第三方依赖。
   行级 DP 先裁掉公共前后缀，只对中间区域计算；超大文档/差异过大时降级为整段替换。 */
var MAX_LINES = 5000;
var MAX_CELLS = 4000000;
var MAX_TOKEN_CELLS = 360000;
var MAX_TOKENS = 600;
var SIMILARITY_THRESHOLD = 0.24;
var HUNK_MERGE = 4;

function splitLines(text){
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
}

function decodeEntities(text){
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function normalizeLine(line){
  return String(line == null ? "" : line).replace(/\s+/g, " ").trim();
}

/* 无 DOMParser（Node 单测 / 极简环境）时的正则兜底：保留标题与列表语义。 */
function htmlToLinesFallback(html){
  var s = String(html == null ? "" : html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, function(_, n){ return "\n" + new Array(Number(n) + 1).join("#") + " "; })
    .replace(/<\/(h[1-6]|p|div|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(s).split("\n").map(normalizeLine).filter(Boolean);
}

var DOM_BLOCK_TAGS = {
  P: 1, DIV: 1, LI: 1, TR: 1, TABLE: 1, UL: 1, OL: 1, BLOCKQUOTE: 1, PRE: 1,
  H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, HEADER: 1, FOOTER: 1
};

function inlineText(node){
  var out = "";
  var kids = node && node.childNodes ? node.childNodes : [];
  for(var i = 0; i < kids.length; i++){
    var c = kids[i];
    if(c.nodeType === 3){ out += c.nodeValue || ""; continue; }
    if(c.nodeType !== 1) continue;
    var tag = c.tagName ? c.tagName.toLowerCase() : "";
    if(tag === "script" || tag === "style") continue;
    if(tag === "br"){ out += "\n"; continue; }
    out += inlineText(c);
    if(DOM_BLOCK_TAGS[c.tagName]) out += "\n";
  }
  return out;
}

/* HTML 正文按块序列化成可比较的行，避免整篇被 textContent 抹成一行。 */
function htmlToLines(html){
  var raw = String(html == null ? "" : html);
  if(typeof DOMParser === "undefined") return htmlToLinesFallback(raw);
  var doc;
  try{ doc = new DOMParser().parseFromString(raw, "text/html"); }catch(e){ return htmlToLinesFallback(raw); }
  if(!doc || !doc.body) return htmlToLinesFallback(raw);
  var out = [];
  function push(text, prefix){
    String(text == null ? "" : text).split("\n").forEach(function(line){
      line = normalizeLine(line);
      if(line) out.push((prefix || "") + line);
    });
  }
  function walk(el){
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if(!tag || tag === "script" || tag === "style") return;
    if(/^h[1-6]$/.test(tag)){
      push(inlineText(el), new Array(Number(tag.charAt(1)) + 1).join("#") + " ");
      return;
    }
    if(tag === "p" || tag === "pre" || tag === "address"){
      push(inlineText(el));
      return;
    }
    if(tag === "blockquote"){
      String(inlineText(el)).split("\n").forEach(function(line){
        line = normalizeLine(line);
        if(line) out.push("> " + line);
      });
      return;
    }
    if(tag === "ul" || tag === "ol"){
      var idx = 1;
      var kids = el.children || [];
      for(var i = 0; i < kids.length; i++){
        var child = kids[i];
        var ctag = child.tagName ? child.tagName.toLowerCase() : "";
        if(ctag === "li"){
          push(inlineText(child), tag === "ol" ? (idx++) + ". " : "- ");
        }else{
          walk(child);
        }
      }
      return;
    }
    if(tag === "table"){
      var trs = el.querySelectorAll("tr");
      for(var t = 0; t < trs.length; t++){
        var cells = [];
        var tds = trs[t].children || [];
        for(var d = 0; d < tds.length; d++){
          var dtag = tds[d].tagName ? tds[d].tagName.toLowerCase() : "";
          if(dtag === "td" || dtag === "th") cells.push(normalizeLine(inlineText(tds[d])));
        }
        if(cells.length) out.push(cells.join(" | "));
      }
      return;
    }
    if(tag === "hr"){ out.push("---"); return; }
    if(tag === "img"){
      var alt = el.getAttribute("alt") || "";
      var src = el.getAttribute("src") || "";
      out.push("[图片] " + (alt || src));
      return;
    }
    var children = el.childNodes || [];
    for(var k = 0; k < children.length; k++){
      var node = children[k];
      if(node.nodeType === 1) walk(node);
      else if(node.nodeType === 3) push(node.nodeValue);
    }
  }
  walk(doc.body);
  return out;
}

function docLines(doc){
  doc = doc || {};
  if(doc.format === "markdown") return splitLines(doc.content);
  return htmlToLines(doc.content);
}

/* 行级 diff：返回 {ops:[{type,ai,bi}], degraded}。degraded 表示中间区域超过 DP 预算。 */
function lineOps(a, b){
  var n = a.length, m = b.length;
  var start = 0, endA = n, endB = m;
  while(start < n && start < m && a[start] === b[start]) start++;
  while(endA > start && endB > start && a[endA - 1] === b[endB - 1]){ endA--; endB--; }

  var ops = [], i, j;
  for(i = 0; i < start; i++) ops.push({ type:"same", ai:i, bi:i });

  var midA = endA - start, midB = endB - start;
  var degraded = false;
  if(midA * midB > MAX_CELLS){
    degraded = true;
    for(i = start; i < endA; i++) ops.push({ type:"del", ai:i });
    for(j = start; j < endB; j++) ops.push({ type:"add", bi:j });
  }else if(midA && midB){
    var dp = [];
    for(i = 0; i <= midA; i++) dp[i] = new Int32Array(midB + 1);
    for(i = midA - 1; i >= 0; i--){
      for(j = midB - 1; j >= 0; j--){
        dp[i][j] = a[start + i] === b[start + j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    i = 0; j = 0;
    while(i < midA && j < midB){
      if(a[start + i] === b[start + j]){ ops.push({ type:"same", ai:start + i, bi:start + j }); i++; j++; }
      else if(dp[i + 1][j] >= dp[i][j + 1]){ ops.push({ type:"del", ai:start + i }); i++; }
      else { ops.push({ type:"add", bi:start + j }); j++; }
    }
    while(i < midA){ ops.push({ type:"del", ai:start + i }); i++; }
    while(j < midB){ ops.push({ type:"add", bi:start + j }); j++; }
  }else{
    for(i = start; i < endA; i++) ops.push({ type:"del", ai:i });
    for(j = start; j < endB; j++) ops.push({ type:"add", bi:j });
  }

  for(i = endA; i < n; i++) ops.push({ type:"same", ai:i, bi:endB + (i - endA) });
  return { ops:ops, degraded:degraded };
}

function tokenize(s){
  return String(s == null ? "" : s).match(/[\u3400-\u9FFF\uF900-\uFAFF]|[A-Za-z0-9]+|\s+|[^\s]/g) || [];
}

function tokenLcs(A, B){
  var n = A.length, m = B.length;
  if(n * m > MAX_TOKEN_CELLS) return -1;
  var dp = [], i, j;
  for(i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for(i = n - 1; i >= 0; i--){
    for(j = m - 1; j >= 0; j--){
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp[0][0];
}

function similarity(a, b){
  var A = tokenize(a), B = tokenize(b);
  if(!A.length && !B.length) return 1;
  var l = tokenLcs(A, B);
  if(l < 0) return 0;
  return (2 * l) / (A.length + B.length);
}

function inlineDiff(a, b){
  var A = tokenize(a), B = tokenize(b);
  var n = A.length, m = B.length;
  if(n > MAX_TOKENS || m > MAX_TOKENS || n * m > MAX_TOKEN_CELLS) return null;
  var dp = [], i, j;
  for(i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for(i = n - 1; i >= 0; i--){
    for(j = m - 1; j >= 0; j--){
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  var oldSegs = [], newSegs = [];
  i = 0; j = 0;
  while(i < n && j < m){
    if(A[i] === B[j]){
      oldSegs.push({ t:A[i], c:false }); newSegs.push({ t:B[j], c:false }); i++; j++;
    }else if(dp[i + 1][j] >= dp[i][j + 1]){
      oldSegs.push({ t:A[i], c:true }); i++;
    }else{
      newSegs.push({ t:B[j], c:true }); j++;
    }
  }
  while(i < n) oldSegs.push({ t:A[i++], c:true });
  while(j < m) newSegs.push({ t:B[j++], c:true });
  return { old:oldSegs, new:newSegs };
}

function tooLarge(a, b){
  return a.length > MAX_LINES || b.length > MAX_LINES;
}

function buildRows(a, b){
  var result = lineOps(a, b);
  var ops = result.ops;
  var rows = [], p = 0;
  while(p < ops.length){
    var op = ops[p];
    if(op.type === "same"){
      rows.push({ type:"same", old:a[op.ai], new:b[op.bi], oldNo:op.ai + 1, newNo:op.bi + 1, inline:null });
      p++;
      continue;
    }
    var dels = [], adds = [];
    while(p < ops.length && ops[p].type !== "same"){
      var cur = ops[p++];
      if(cur.type === "del") dels.push(cur.ai); else adds.push(cur.bi);
    }
    var count = Math.max(dels.length, adds.length);
    for(var k = 0; k < count; k++){
      var di = dels[k], ai = adds[k];
      if(di != null && ai != null){
        var sim = similarity(a[di], b[ai]);
        var mod = sim >= SIMILARITY_THRESHOLD;
        rows.push({
          type: mod ? "mod" : "deladd",
          old: a[di], new: b[ai],
          oldNo: di + 1, newNo: ai + 1,
          inline: mod ? inlineDiff(a[di], b[ai]) : null
        });
      }else if(di != null){
        rows.push({ type:"del", old:a[di], new:null, oldNo:di + 1, newNo:null, inline:null });
      }else{
        rows.push({ type:"add", old:null, new:b[ai], oldNo:null, newNo:ai + 1, inline:null });
      }
    }
  }
  return { rows:rows, degraded:!!result.degraded };
}

function isChanged(row){ return row.type !== "same"; }

function buildBlocks(rows, opts){
  opts = opts || {};
  if(opts.showAll){
    return rows.map(function(row){ return { kind:"row", row:row }; });
  }
  var ctx = opts.context == null ? 2 : opts.context;
  var minFold = opts.minFold == null ? 5 : opts.minFold;
  var keep = new Array(rows.length);
  rows.forEach(function(row, i){
    if(!isChanged(row)) return;
    for(var k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true;
  });
  /* 间隔不超过 2 倍上下文的未改动区不折叠，避免出现「展开 1 行」这种碎条。 */
  var blocks = [], group = null, groupStart = 0;
  rows.forEach(function(row, i){
    if(keep[i]){
      if(group){
        blocks.push({ kind:"fold", rows:group, key:"f" + groupStart });
        group = null;
      }
      blocks.push({ kind:"row", row:row });
    }else{
      if(!group){ group = []; groupStart = i; }
      group.push(row);
    }
  });
  if(group) blocks.push({ kind:"fold", rows:group, key:"f" + groupStart });
  return blocks.map(function(block){
    if(block.kind === "fold" && block.rows.length < minFold){
      return { kind:"group", rows:block.rows };
    }
    return block;
  });
}

/* 把折叠区展开/收起后，标记每处差异的起始行；相隔不超过 HUNK_MERGE 行的改动算同一处。 */
function prepareBlocks(blocks, expanded){
  var items = [], hunk = -1, prevChanged = false, sameRun = 0;
  blocks.forEach(function(block){
    if(block.kind === "row"){
      items.push({ kind:"row", row:block.row, hunkStart:false, hunkIndex:-1 });
    }else if(block.kind === "group" || (expanded && expanded[block.key])){
      block.rows.forEach(function(row){ items.push({ kind:"row", row:row, hunkStart:false, hunkIndex:-1 }); });
    }else{
      items.push({ kind:"gap", block:block });
    }
  });
  items.forEach(function(item){
    if(item.kind === "gap"){ prevChanged = false; sameRun = 999; return; }
    var changed = isChanged(item.row);
    if(changed){
      if(!prevChanged && (hunk < 0 || sameRun > HUNK_MERGE)){
        hunk++;
        item.hunkStart = true;
      }
      item.hunkIndex = hunk;
      sameRun = 0;
    }else{
      sameRun++;
    }
    prevChanged = changed;
  });
  return { items:items, hunks:hunk + 1 };
}

function rowStats(rows){
  var add = 0, del = 0;
  rows.forEach(function(row){
    if(row.type === "add" || row.type === "mod" || row.type === "deladd") add++;
    if(row.type === "del" || row.type === "mod" || row.type === "deladd") del++;
  });
  return { add:add, del:del };
}

export {
  MAX_LINES, HUNK_MERGE, splitLines, htmlToLines, docLines, tooLarge,
  lineOps, tokenize, inlineDiff, similarity, buildRows, isChanged,
  buildBlocks, prepareBlocks, rowStats
};
