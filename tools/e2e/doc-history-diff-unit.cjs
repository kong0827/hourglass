/* 文档历史对比算法单测：无浏览器、无服务端，覆盖行级/词级差异、折叠与差异分组。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/js/lib/text-diff.js"), "utf8")
  .replace(/export \{[\s\S]*?\};\s*$/m, "");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: "text-diff.js" });

const splitLines = context.splitLines;
const buildRows = context.buildRows;
const rowStats = context.rowStats;
const buildBlocks = context.buildBlocks;
const prepareBlocks = context.prepareBlocks;
const inlineDiff = context.inlineDiff;
const similarity = context.similarity;
const htmlToLines = context.htmlToLines;
const docLines = context.docLines;
const tooLarge = context.tooLarge;

function rowsOf(oldText, newText) {
  return buildRows(splitLines(oldText), splitLines(newText)).rows;
}

// 1. 完全一致：没有差异，行号一一对应
(function () {
  const rows = rowsOf("a\nb\nc", "a\nb\nc");
  assert.equal(rows.length, 3);
  assert.equal(rowStats(rows).add, 0);
  assert.equal(rowStats(rows).del, 0);
  assert.equal(rows.every(row => row.type === "same"), true);
  assert.equal(rows[2].oldNo, 3);
  assert.equal(rows[2].newNo, 3);
})();

// 2. 修改 + 新增：修改行成对出现，带行内高亮；纯新增单独成行
(function () {
  const rows = rowsOf("标题\n\n一\n金额 100 元\n三", "标题\n\n一\n金额 200 元\n三\n四");
  const stats = rowStats(rows);
  assert.equal(stats.add, 2);
  assert.equal(stats.del, 1);
  const modified = rows.find(row => row.type === "mod");
  assert.ok(modified, "应识别为修改行");
  assert.equal(modified.old, "金额 100 元");
  assert.equal(modified.new, "金额 200 元");
  assert.ok(modified.inline, "修改行应有词级差异");
  assert.equal(modified.inline.old.filter(seg => seg.c).map(seg => seg.t).join(""), "100");
  assert.equal(modified.inline.new.filter(seg => seg.c).map(seg => seg.t).join(""), "200");
  const added = rows.find(row => row.type === "add");
  assert.equal(added.oldNo, null);
  assert.equal(added.new, "四");
})();

// 3. 删除 + 替换：差异较大的行不强行做词级高亮
(function () {
  const rows = rowsOf("甲\n乙\n丙", "甲\n全新的内容\n丙");
  const pair = rows.find(row => row.type === "deladd");
  assert.ok(pair, "低相似度应落到 deladd");
  assert.equal(pair.inline, null);
  assert.ok(similarity("订单状态收敛", "订单状态统一收敛") > 0.5);
  assert.ok(similarity("完全不同的句子", "another line") < 0.24);
})();

// 4. 折叠：默认保留 2 行上下文，中间连续未改动区域折叠；碎条转成可见行
(function () {
  const base = [];
  for (let i = 0; i < 30; i++) base.push("line" + i);
  const next = base.slice();
  next[15] = "line15 changed";
  const rows = buildRows(base, next).rows;
  const blocks = buildBlocks(rows, {});
  assert.equal(blocks.filter(block => block.kind === "fold").length, 2);
  const prepared = prepareBlocks(blocks, {});
  assert.equal(prepared.hunks, 1);
  const changed = prepared.items.filter(item => item.kind === "row" && context.isChanged(item.row));
  assert.equal(changed.length, 1);
  assert.equal(changed[0].hunkStart, true);
  // 折叠区展开后不应再有 gap，行数恢复完整
  const expanded = {};
  blocks.filter(block => block.kind === "fold").forEach(block => { expanded[block.key] = true; });
  const opened = prepareBlocks(blocks, expanded);
  assert.equal(opened.items.some(item => item.kind === "gap"), false);
  assert.equal(opened.items.length, rows.length);
})();

// 5. 差异分组：相隔不超过 4 行算同一处，超过则另起一处
(function () {
  const base = [];
  for (let i = 0; i < 20; i++) base.push("line" + i);
  const next = base.slice();
  next[5] = "line5 changed";
  next[8] = "line8 changed";
  next[15] = "line15 changed";
  const rows = buildRows(base, next).rows;
  const prepared = prepareBlocks(buildBlocks(rows, { showAll: true }), {});
  assert.equal(prepared.hunks, 2);
  const starts = prepared.items.filter(item => item.hunkStart).map(item => item.hunkIndex);
  assert.equal(JSON.stringify(starts), "[0,1]");
})();

// 6. 超大文档直接标记降级，避免进入 DP
(function () {
  const big = new Array(context.MAX_LINES + 1).fill("x");
  assert.equal(tooLarge(big, ["x"]), true);
  assert.equal(tooLarge(["x"], ["x"]), false);
})();

// 7. HTML 正文按块序列化（Node 下走正则兜底）
(function () {
  const lines = htmlToLines("<h2>标题</h2><p>第一段<br>第二行</p><ul><li>甲</li><li>乙</li></ul>");
  assert.equal(JSON.stringify(lines), JSON.stringify(["## 标题", "第一段", "第二行", "- 甲", "- 乙"]));
  assert.equal(JSON.stringify(docLines({ format: "markdown", content: "a\r\nb" })), JSON.stringify(["a", "b"]));
  assert.equal(JSON.stringify(docLines({ format: "html", content: "<p>a</p><p>b</p>" })), JSON.stringify(["a", "b"]));
})();

console.log("doc-history-diff-unit: ok");
