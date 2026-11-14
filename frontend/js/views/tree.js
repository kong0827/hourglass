/* views/tree · 层级视图：把当前筛选下的工作项按可配层级（项目/计划版本/模块）缩进成树，节点可折叠。
   只留结构性维度：状态/优先级/负责人是流动属性，作层级会让树结构随手流转抖动，留给筛选与列表分组。
   叶行渲染与列设置复用列表视图（taskCell / 显示字段 / 密度），
   父级行显示聚合：项数、最早截止、平均进度、子任务合计 —— 口径与列表的子任务计数列一致。
   层级维度与列表分组共用 core/group-dims 单一来源，保证文案与顺序一致。 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { boardParams } from "../core/filters.js";
import { groupOptionsHTML, groupDimName } from "../core/group-dims.js";
import { isMobile } from "../core/layout.js";
import { activeView } from "../core/router.js";
import * as listPrefs from "../core/list-preferences.js";
import { filterOn, progressOf, reqNameById, catNameById, rt, state } from "../core/state.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { COLUMNS, PRIORITIES, colMeta, colName, fmtShortMD, parseDate, priName, taskVersionsText } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import { COL_WIDTHS, isDoneTask, minutesText, taskCell } from "./list.js";

var treeBody = $("treeBody"), treeHead = $("treeHead"), treeMeta = $("treeMeta"),
    selL1 = $("treeLevel1"), selL2 = $("treeLevel2"), selL3 = $("treeLevel3"),
    btnHideDone = $("btnTreeHideDone");
var lastItems = [], lastTree = [];
var treeHasMore = false, treeLoadingMore = false;
var PAGE_SIZE = 100;
var levels = { l1:"project", l2:"version", l3:"none" };
/* 层级只保留结构性维度（项目/计划版本/模块）：见文件头说明 */
var TREE_LEVEL_DIMS = ["project", "version", "category"];
var collapsed = {};
var hideDone = false;
var treeLoaded = false;
var LEVEL_SLOTS = ["l1", "l2", "l3"];
var LEVEL_SLOT_NAMES = { l1:"一级", l2:"二级", l3:"三级" };

/* ---------- 层级维度 ---------- */
function activeLevels(){
  var raw = [levels.l1, levels.l2, levels.l3], out = [];
  raw.forEach(function(d){ if(d && d !== "none" && out.indexOf(d) === -1) out.push(d); });
  return out;
}
function levelInfo(t, dim){
  if(dim === "owner") return { key:t.owner || "__none", label:t.owner || "未分配" };
  if(dim === "priority") return { key:t.priority || "unknown", label:t.priority ? priName(t.priority) : "未设置优先级" };
  if(dim === "project") return { key:t.reqId || "__none", label:t.reqId ? (reqNameById(t.reqId) || "未归类") : "未归类" };
  if(dim === "category") return { key:t.categoryId || "__none", label:catNameById(t.categoryId) || "未指定模块" };
  if(dim === "status") return { key:t.boardColumn || "unknown", label:colName(t.boardColumn) || "未设置状态" };
  if(dim === "version"){
    var label = taskVersionsText(t) || "待规划";
    return { key:label, label:label };
  }
  return { key:"unknown", label:"未设置" };
}
function nodeCompare(dim){
  if(dim === "status"){
    return function(a, b){
      var ai = -1, bi = -1;
      COLUMNS.forEach(function(c, i){ if(c.id === a.key) ai = i; if(c.id === b.key) bi = i; });
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    };
  }
  if(dim === "priority"){
    return function(a, b){
      return (PRIORITIES.indexOf(a.key) < 0 ? 9 : PRIORITIES.indexOf(a.key)) -
        (PRIORITIES.indexOf(b.key) < 0 ? 9 : PRIORITIES.indexOf(b.key));
    };
  }
  if(dim === "category"){
    var order = {};
    (rt.categoriesCache || []).forEach(function(c, i){ order[c.id] = i; });
    return function(a, b){
      return (order[a.key] === undefined ? 999 : order[a.key]) - (order[b.key] === undefined ? 999 : order[b.key])
        || a.label.localeCompare(b.label, "zh-CN");
    };
  }
  if(dim === "version"){
    return function(a, b){
      if(a.label === "待规划") return 1;
      if(b.label === "待规划") return -1;
      return a.label.localeCompare(b.label, "zh-CN");
    };
  }
  return function(a, b){ return a.label.localeCompare(b.label, "zh-CN"); };
}
/* ---------- 建树：levels 逐层分组，叶是工作项 ----------
   每一行都带 path（祖先节点，长度=行深度）与 last（是否同级最后一个）：
   引导线的收口依赖这两个信息，必须按排序后的顺序计算，不能边建边算。 */
function buildTree(items){
  var dims = activeLevels();
  if(!dims.length){
    return items.map(function(t, i){ return { task:t, last:i === items.length - 1, path:[] }; });
  }
  function groupLevel(list, depth, path){
    var dim = dims[depth], map = {}, order = [];
    list.forEach(function(t){
      var info = levelInfo(t, dim);
      var key = path.map(function(n){ return n.key; }).concat([dim + ":" + info.key]).join("|");
      var n = map[key];
      if(!n){ n = { node:true, dim:dim, key:key, label:info.label, children:[] }; map[key] = n; order.push(key); }
      n.children.push(t);
    });
    var nodes = order.map(function(key){ return map[key]; });
    nodes.sort(function(a, b){
      var r = nodeCompare(dim)(a, b);
      return r !== 0 ? r : 0;
    });
    nodes.forEach(function(n, i){
      n.last = i === nodes.length - 1;
      n.path = path;
      n.children = (depth + 1 < dims.length)
        ? groupLevel(n.children, depth + 1, path.concat([n]))
        : n.children.map(function(t, j, arr){ return { task:t, last:j === arr.length - 1, path:path.concat([n]) }; });
    });
    return nodes;
  }
  return groupLevel(items, 0, []);
}
/* ---------- 聚合：项数 / 平均进度 / 最早截止 / 子任务合计 / 工时合计 ---------- */
function nodeAgg(node){
  var tasks = [];
  (function collect(children){
    children.forEach(function(c){
      if(c.task) tasks.push(c.task);
      else collect(c.children);
    });
  })(node.children);
  var prog = tasks.length ? Math.round(tasks.reduce(function(s, t){ return s + progressOf(t); }, 0) / tasks.length) : 0;
  var dues = tasks.map(function(t){ return t.dueDate; }).filter(Boolean).sort();
  var subT = 0, subD = 0, minutes = 0;
  tasks.forEach(function(t){
    subT += Number(t.subtaskTotal) || 0;
    subD += Number(t.subtaskDone) || 0;
    minutes += Number(t.totalMinutes) || 0;
  });
  return { count:tasks.length, prog:prog, due:dues[0] || "", subT:subT, subD:subD, minutes:minutes };
}
/* ---------- 表头与网格：列集合沿用列表的显示字段设置 ---------- */
function applyTreeGrid(el){
  var widths = listPrefs.columns("task-list").map(function(key){ return COL_WIDTHS[key] || "120px"; });
  el.style.gridTemplateColumns = ["22px"].concat(widths, ["24px"]).join(" ");
}
function renderTreeHead(){
  var labels = listPrefs.labels("task-list");
  treeHead.innerHTML = '<span></span>' + listPrefs.columns("task-list").map(function(key){
    return '<span>' + esc(labels[key]) + '</span>';
  }).join("") + '<span></span>';
  applyTreeGrid(treeHead);
}
/* ---------- 行 ---------- */
/* 每级一根竖线：祖先子树在本行之后还有内容就画满，否则在本行中线收口；
   最靠近内容的一级再加横向肘线，形成 ├─ / └─。 */
function indentHTML(depth, row){
  var html = "";
  for(var i = 0; i < depth; i++){
    var endsHere = row.last;
    for(var j = i + 1; j < depth && endsHere; j++){
      endsHere = !!(row.path[j] && row.path[j].last);
    }
    var cls = "tree-indent" + (endsHere ? " end" : "");
    if(i === depth - 1) cls += " elbow";
    html += '<span class="' + cls + '"></span>';
  }
  return html;
}
/* 父级行只填有聚合口径的列；状态/优先级/模块/项目/版本是叶子自身的属性，分组没有单一取值，
   留空占位（不能整列不输出，否则网格列会左移错位）。 */
function aggCell(key, agg){
  if(key === "dueDate") return agg.due ? '<span class="cell" title="组内最早截止">' + esc(fmtShortMD(parseDate(agg.due))) + '</span>' : "<span></span>";
  if(key === "progress"){
    return '<span><span class="progress mini"><span class="bar"><i style="width:' + agg.prog + '%"></i></span><span class="pv">' + agg.prog + '%</span></span></span>';
  }
  if(key === "subtasks") return agg.subT ? '<span class="cell">' + agg.subD + "/" + agg.subT + '</span>' : "<span></span>";
  if(key === "work") return agg.minutes ? '<span class="cell">' + esc(minutesText(agg.minutes)) + '</span>' : "<span></span>";
  return "<span></span>";
}
function nodeRowHTML(node, depth){
  var agg = nodeAgg(node);
  var isCollapsed = !!collapsed[node.key];
  var cols = listPrefs.columns("task-list");
  return '<div class="tree-row list-row tree-node-row" data-tree-node="' + esc(node.key) + '" tabindex="0" role="treeitem" aria-level="' + (depth + 1) + '" aria-expanded="' + (!isCollapsed) + '">' +
    '<span><span class="tree-caret' + (isCollapsed ? "" : " open") + '" aria-hidden="true">▸</span></span>' +
    '<span class="lr-task">' + indentHTML(depth, node) +
      '<span class="tree-node">' + esc(node.label) + '</span>' +
      '<span class="tree-count">' + agg.count + ' 项 · ' + groupDimName(node.dim) + '</span></span>' +
    cols.map(function(key){
      if(key === "title") return "";
      return aggCell(key, agg);
    }).join("") +
    '<span class="cell-act"></span></div>';
}
function leafRowHTML(t, depth, row){
  var cols = listPrefs.columns("task-list");
  var hasTypeCol = cols.indexOf("type") !== -1;
  /* 标题前加缩进引导线：叶子深度 = 层级数。缩进只在这一份 titleCell 上生成，
     不能再按列重算一次 taskCell，否则缩进会被覆盖（树被拍平）。 */
  var titleCell = taskCell(t, "title", hasTypeCol).replace('<span class="lr-task">', '<span class="lr-task">' + indentHTML(depth, row));
  return '<div class="tree-row list-row" data-tree-id="' + esc(t.id) + '" tabindex="0" role="treeitem" aria-level="' + (depth + 1) + '">' +
    '<span><span class="tree-caret leaf" aria-hidden="true">▸</span></span>' +
    cols.map(function(key){ return key === "title" ? titleCell : taskCell(t, key, hasTypeCol); }).join("") +
    '<span class="cell-act"></span></div>';
}
function rowsHTML(children, depth){
  return children.map(function(c){
    if(c.task) return leafRowHTML(c.task, depth, c);
    return nodeRowHTML(c, depth) + (collapsed[c.key] ? "" : rowsHTML(c.children, depth + 1));
  }).join("");
}
/* ---------- 手机：卡片式紧凑行 ----------
   桌面是 618px 网格，手机上表头隐藏、容器不滚动，右侧列会被直接裁掉。
   手机改为每行一张卡片：标题 + 状态/优先级/截止/进度，层级用左缩进表达，不再横向溢出。 */
function mobDepthAttr(depth){
  return depth ? ' style="--tree-d:' + depth + '"' : "";
}
function progressMiniHTML(p){
  return '<span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span>';
}
function nodeRowMobileHTML(node, depth){
  var agg = nodeAgg(node);
  var isCollapsed = !!collapsed[node.key];
  return '<div class="tree-mob-row is-node" data-tree-node="' + esc(node.key) + '" tabindex="0" role="treeitem" aria-level="' + (depth + 1) + '" aria-expanded="' + (!isCollapsed) + '"' + mobDepthAttr(depth) + '>' +
    '<span class="tree-caret' + (isCollapsed ? "" : " open") + '" aria-hidden="true">▸</span>' +
    '<span class="tmr-title">' + esc(node.label) + '</span>' +
    '<span class="tree-count">' + agg.count + ' 项 · ' + esc(groupDimName(node.dim)) + '</span>' +
    '<span class="tmr-meta">' +
      (agg.due ? '<span class="cell" title="组内最早截止">' + esc(fmtShortMD(parseDate(agg.due))) + '</span>' : "") +
      '<span class="tmr-prog">' + progressMiniHTML(agg.prog) + '</span>' +
    '</span></div>';
}
function leafRowMobileHTML(t, depth, row){
  return '<div class="tree-mob-row" data-tree-id="' + esc(t.id) + '" tabindex="0" role="treeitem" aria-level="' + (depth + 1) + '"' + mobDepthAttr(depth) + '>' +
    /* 占位箭头：让叶子标题比父级再右移一档，缩进不会被箭头宽度吃掉 */
    '<span class="tree-caret leaf" aria-hidden="true">▸</span>' +
    '<span class="tmr-title">' + esc(t.title) + '</span>' +
    '<span class="tmr-meta">' +
      taskCell(t, "column") + taskCell(t, "priority") + taskCell(t, "dueDate") +
      '<span class="tmr-prog">' + progressMiniHTML(progressOf(t)) + '</span>' +
    '</span></div>';
}
function rowsMobileHTML(children, depth){
  return children.map(function(c){
    if(c.task) return leafRowMobileHTML(c.task, depth, c);
    return nodeRowMobileHTML(c, depth) + (collapsed[c.key] ? "" : rowsMobileHTML(c.children, depth + 1));
  }).join("");
}
/* ---------- 渲染 ---------- */
function updateTreeMeta(){
  var nodeCount = countNodes(lastTree);
  var text = "已加载 " + lastItems.length + " / 共 " + rt.listTotal + " 项";
  if(filterOn() || hideDone) text += " · 当前视图 " + countLeaves(lastTree) + " 项";
  if(nodeCount) text += " · " + nodeCount + " 个分组";
  if(hideDone) text += " · 已隐藏已完成";
  /* 屏面上没有父级行（拍平或空结果）时，不解释父级聚合口径 */
  if(nodeCount) text += " · 父级进度按已加载子项平均，子任务按合计";
  treeMeta.textContent = text;
}
function countLeaves(children){
  var n = 0;
  children.forEach(function(c){ n += c.task ? 1 : countLeaves(c.children); });
  return n;
}
function countNodes(children){
  var n = 0;
  children.forEach(function(c){ if(!c.task) n += 1 + countNodes(c.children); });
  return n;
}
/* 行 DOM 每次重渲染都重建：先记住聚焦的是哪一行，渲染后放回同一行，
   否则键盘展开/折叠一次，焦点就掉回 body。 */
function focusedRowKey(){
  var el = document.activeElement;
  if(!el || !el.closest) return "";
  var row = el.closest("[data-tree-node],[data-tree-id]");
  if(!row || !treeBody.contains(row)) return "";
  return row.hasAttribute("data-tree-node") ? "n" + row.dataset.treeNode : "i" + row.dataset.treeId;
}
function restoreFocusedRow(key){
  if(!key) return;
  var isNode = key.charAt(0) === "n", val = key.slice(1);
  var rows = treeBody.querySelectorAll(isNode ? "[data-tree-node]" : "[data-tree-id]");
  for(var i = 0; i < rows.length; i++){
    if((isNode ? rows[i].dataset.treeNode : rows[i].dataset.treeId) === val){ rows[i].focus(); return; }
  }
}
function renderTreeItems(){
  var focusKey = focusedRowKey();
  renderTreeHead();
  rt.listCache = {};
  lastItems.forEach(function(t){ rt.listCache[t.id] = t; });
  var items = hideDone ? lastItems.filter(function(t){ return !isDoneTask(t); }) : lastItems;
  lastTree = buildTree(items);
  if(!countLeaves(lastTree)){
    var hasConditions = filterOn() || hideDone;
    treeBody.removeAttribute("role");
    treeBody.innerHTML = '<div style="padding:8px">' + (hasConditions
      ? UI.emptyState({ icon:"filterOff", title:"没有符合当前视图条件的工作项", text:"切换视图，或调整、清空筛选条件后重试。", actionLabel:"查看全部工作项", compact:true })
      : UI.emptyState({ icon:"inbox", title:"这里还没有工作项", textHtml:"新建一个工作项；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。", actionLabel:"新建工作项", compact:true })) + '</div>';
    bindRetry(treeBody, function(){
      if(!hasConditions){ openTaskDrawer("backlog"); return; }
      hideDone = false; syncHideDoneBtn();
      /* 「查看全部工作项」= 回到无筛选结果：点筛选栏的清空按钮，与它同一口径（保留项目范围、联动全部视图刷新） */
      if(filterOn()) $("btnClearFilter").click();
      else renderTreeItems();
    });
    updateTreeMeta();
    appendTreeMore();
    return;
  }
  treeBody.setAttribute("role", "tree");
  if(isMobile()){
    treeBody.innerHTML = rowsMobileHTML(lastTree, 0);
    updateTreeMeta();
    appendTreeMore();
    restoreFocusedRow(focusKey);
    return;
  }
  treeBody.innerHTML = rowsHTML(lastTree, 0);
  Array.prototype.forEach.call(treeBody.querySelectorAll(".tree-row"), applyTreeGrid);
  updateTreeMeta();
  appendTreeMore();
  restoreFocusedRow(focusKey);
}
function appendTreeMore(){
  if(!treeHasMore) return;
  var more = document.createElement("div");
  more.style.cssText = "padding:14px;text-align:center;";
  more.innerHTML = '<button class="btn" type="button" data-tree-more' + (treeLoadingMore ? " disabled" : "") + '>' +
    (treeLoadingMore ? "加载中…" : "加载更多（已 " + lastItems.length + " / 共 " + rt.listTotal + " 项）") + '</button>';
  treeBody.appendChild(more);
}
/* ---------- 数据 ---------- */
function loadTree(opts){
  opts = opts || {};
  var append = !!(opts.more && lastItems.length);
  var keep = !!(opts.keepLoaded && lastItems.length && !append);
  var offset = append ? lastItems.length : 0;
  var limit = keep ? Math.min(500, Math.max(PAGE_SIZE, lastItems.length)) : PAGE_SIZE;
  var seq = ++rt.listSeq;
  treeLoadingMore = append;
  if(!append) treeHasMore = false;
  if(!opts.silent && !append && !keep){
    treeBody.innerHTML = UI.skeletonRows(8);
    treeMeta.textContent = "加载中…";
  }
  renderTreeHead();
  return API.get("/api/tasks/list", boardParams({ sort:"column", offset:offset, limit:limit })).then(function(d){
    if(seq !== rt.listSeq) return;
    rt.listTotal = d.total || 0;
    treeHasMore = !!d.hasMore;
    treeLoadingMore = false;
    treeLoaded = true;
    var items = d.items || [];
    lastItems = append ? lastItems.concat(items) : items;
    renderTreeItems();
  }).catch(function(ex){
    if(seq !== rt.listSeq) return;
    treeLoadingMore = false;
    if(append || keep || opts.silent){
      if(append) renderTreeItems();
      return;
    }
    treeMeta.textContent = "";
    treeBody.innerHTML = UI.errorState(ex.message);
    bindRetry(treeBody, function(){ loadTree(); });
  });
}
/* ---------- 工具条 ---------- */
function syncHideDoneBtn(){
  btnHideDone.setAttribute("aria-pressed", hideDone ? "true" : "false");
  btnHideDone.classList.toggle("on", hideDone);
  btnHideDone.title = hideDone ? "当前已隐藏已完成（点击显示）" : "隐藏已完成工作项，聚焦未完成项";
}
function fillLevelSelects(){
  selL1.innerHTML = groupOptionsHTML(TREE_LEVEL_DIMS, levels.l1, "不分组");
  selL2.innerHTML = groupOptionsHTML(TREE_LEVEL_DIMS, levels.l2, "不分组");
  selL3.innerHTML = groupOptionsHTML(TREE_LEVEL_DIMS, levels.l3, "不分组");
  syncLevelSelects();
}
/* 「不分组」在 group-dims 里的值是空串，levels 内部用 "none"：回写下拉时统一换算 */
function syncLevelSelects(){
  selL1.value = levels.l1 === "none" ? "" : levels.l1;
  selL2.value = levels.l2 === "none" ? "" : levels.l2;
  selL3.value = levels.l3 === "none" ? "" : levels.l3;
}
function setLevel(which, value){
  if(value !== "none" && TREE_LEVEL_DIMS.indexOf(value) === -1) value = "none";
  var i = LEVEL_SLOTS.indexOf(which);
  if(value !== "none"){
    var dupEarlier = LEVEL_SLOTS.slice(0, i).filter(function(k){ return levels[k] === value; });
    var dupLater = LEVEL_SLOTS.slice(i + 1).filter(function(k){ return levels[k] === value; });
    /* 同一维度占两级时以前一级为准，并说清本层被改回不分组：静默去重会让人以为层级没生效 */
    if(dupEarlier.length){
      toast("「" + groupDimName(value) + "」已用作" + LEVEL_SLOT_NAMES[dupEarlier[0]] + "，本层改为不分组", "warn");
      value = "none";
    } else if(dupLater.length){
      dupLater.forEach(function(k){ levels[k] = "none"; });
      toast("「" + groupDimName(value) + "」移到" + LEVEL_SLOT_NAMES[which] + "，" + LEVEL_SLOT_NAMES[dupLater[0]] + "改为不分组");
    }
  }
  levels[which] = value;
  collapsed = {};
  syncLevelSelects();
  if(activeView === "tree") renderTreeItems();
}
function walkNodes(children, fn){
  children.forEach(function(c){
    if(c.task) return;
    fn(c);
    walkNodes(c.children, fn);
  });
}
/* ---------- 入口与事件 ---------- */
function enterTreeView(){
  if(!selL1.options.length) fillLevelSelects();
  /* 启动时看板若未加载成功，筛选栏会没有选项：进树形时静默补拉一次（与列表同口径） */
  if(!state.board) loadBoard({ silent:true });
  listPrefs.load("task-list").then(function(){
    if(activeView !== "tree") return;
    renderTreeHead();
    if(treeLoaded) renderTreeItems();
  });
  if(state.board) loadTree({ silent:treeLoaded });
  else loadTree();
}
function refreshTreeIfOpen(){
  if(activeView !== "tree") return null;
  var scroller = document.getElementById("view-tree");
  scroller = scroller && scroller.querySelector(".list-scroll");
  var top = scroller ? scroller.scrollTop : 0;
  return loadTree({ silent:true, keepLoaded:true }).then(function(){
    if(scroller) scroller.scrollTop = top;
  });
}
selL1.addEventListener("change", function(){ setLevel("l1", selL1.value); });
selL2.addEventListener("change", function(){ setLevel("l2", selL2.value); });
selL3.addEventListener("change", function(){ setLevel("l3", selL3.value); });
btnHideDone.addEventListener("click", function(){
  hideDone = !hideDone;
  syncHideDoneBtn();
  if(activeView === "tree") renderTreeItems();
});
$("btnTreeExpand").addEventListener("click", function(){
  collapsed = {};
  if(activeView === "tree") renderTreeItems();
});
$("btnTreeCollapse").addEventListener("click", function(){
  collapsed = {};
  walkNodes(lastTree, function(n){ collapsed[n.key] = true; });
  if(activeView === "tree") renderTreeItems();
});
treeBody.addEventListener("click", function(e){
  if(e.target.closest("[data-tree-more]")){
    if(!treeLoadingMore) loadTree({ more:true });
    return;
  }
  var nodeRow = e.target.closest("[data-tree-node]");
  if(nodeRow){
    var key = nodeRow.dataset.treeNode;
    if(collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
    renderTreeItems();
    return;
  }
  var row = e.target.closest("[data-tree-id]");
  if(!row) return;
  var t = rt.listCache[row.dataset.treeId];
  if(t) openTaskDrawer(null, t);
});
function visibleRows(){
  return Array.prototype.slice.call(treeBody.querySelectorAll("[data-tree-node],[data-tree-id]"));
}
function focusRow(rows, i){
  if(!rows[i]) return;
  rows[i].focus();
  rows[i].scrollIntoView({ block:"nearest" });
}
/* 键盘：↑↓/Home/End 在可见行间移动，→ 展开或进入子级，← 折叠或回到父级；
   切换后 DOM 重建，焦点由 renderTreeItems 的还原逻辑放回同一行。 */
treeBody.addEventListener("keydown", function(e){
  if(e.target.closest("input,button")) return;
  var nodeRow = e.target.closest("[data-tree-node]");
  var leafRow = e.target.closest("[data-tree-id]");
  var row = nodeRow || leafRow;
  if(!row) return;
  if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    if(nodeRow){ nodeRow.click(); return; }
    var t = rt.listCache[leafRow.dataset.treeId];
    if(t) openTaskDrawer(null, t);
    return;
  }
  var rows = visibleRows(), i = rows.indexOf(row);
  if(e.key === "ArrowDown"){ e.preventDefault(); focusRow(rows, i + 1); }
  else if(e.key === "ArrowUp"){ e.preventDefault(); focusRow(rows, i - 1); }
  else if(e.key === "Home"){ e.preventDefault(); focusRow(rows, 0); }
  else if(e.key === "End"){ e.preventDefault(); focusRow(rows, rows.length - 1); }
  else if(e.key === "ArrowRight"){
    e.preventDefault();
    if(nodeRow && nodeRow.getAttribute("aria-expanded") === "false") nodeRow.click();
    else focusRow(rows, i + 1);
  } else if(e.key === "ArrowLeft"){
    e.preventDefault();
    if(nodeRow && nodeRow.getAttribute("aria-expanded") === "true"){ nodeRow.click(); return; }
    var lvl = Number(row.getAttribute("aria-level")) || 1;
    for(var j = i - 1; j >= 0; j--){
      if(Number(rows[j].getAttribute("aria-level")) < lvl){ focusRow(rows, j); break; }
    }
  }
});
window.addEventListener("ds:layout", function(){
  if(lastItems && lastItems.length) renderTreeItems();
});

export { enterTreeView, refreshTreeIfOpen };
