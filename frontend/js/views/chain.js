/* views/chain · 依赖影响链视图：选定中心工作项，沿前置(fromTaskId)/后继(toTaskId)依赖双向展开成链路，
   回答「动它会牵动谁、它被谁卡住」——与层级视图（怎么分类）互补。
   依赖是 DAG（可能成环），展开用路径级 visited 守卫，成环处标注「检测到环路」不再深入；
   深度有上限，更深层的后继在边上标注未展开数量。
   影响链天然跨项目/状态，因此不沿用看板筛选条件，取工作区内全部可见工作项（分页拉取，有上限），
   仅依赖两端不在已加载范围内的任务按需用 /api/task/{id} 补齐。 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { activeView } from "../core/router.js";
import { progressOf, rt } from "../core/state.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { avatarHTML, colMeta, colName, fmtShortMD, parseDate, severityBadgeHTML, typeBadgeHTML, typeName } from "../lib/format.js";
import { isDoneTask } from "./list.js";

var chainBody = $("chainBody"), chainMeta = $("chainMeta"),
    btnPicker = $("btnChainPick"), segDir = $("chainDir");
var taskMap = {}, deps = [];
var centerId = null, direction = "both";
var chainLoaded = false;
var seq = 0;
var MAX_DEPTH = 4;          /* 每条链最多展开 4 级，更深标注数量 */
var TASK_CAP = 3000;        /* 工作项加载上限，超出在 meta 里提示 */
var EXTRA_CAP = 200;        /* 依赖指向但不在列表里的任务，按需补齐的上限 */

/* 依赖类型说明：几何上 from 端总在上方、to 端在下方（上游段朝中心，下游段离中心），
   所以同一句读法两个方向都成立。 */
var DEP_TEXT = {
  FS:"前驱完成后才能开始",
  SS:"与前驱同时启动",
  FF:"前驱完成时本项须完成",
  SF:"本项开始是前驱完成的信号"
};
/* ---------- 数据 ---------- */
function loadTaskPages(offset){
  return API.get("/api/tasks/list", { sort:"updated", offset:offset, limit:100 }).then(function(d){
    var items = d.items || [];
    items.forEach(function(t){ taskMap[t.id] = t; });
    if(d.hasMore && offset + items.length < TASK_CAP) return loadTaskPages(offset + items.length);
    return { capped: !!d.hasMore };
  });
}
/* 依赖两端不在已加载范围内：按需单条补齐（链上引用了筛选外/已删除恢复前的任务时兜标题） */
function fillMissingTasks(){
  var missing = {}, count = 0;
  deps.forEach(function(dep){
    if(!taskMap[dep.fromTaskId] && count < EXTRA_CAP){ missing[dep.fromTaskId] = 1; count++; }
    if(!taskMap[dep.toTaskId] && count < EXTRA_CAP){ missing[dep.toTaskId] = 1; count++; }
  });
  var ids = Object.keys(missing);
  return Promise.all(ids.map(function(id){
    return API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
      if(t && t.id) taskMap[t.id] = t;
    }).catch(function(){ /* 无权限或已删除：渲染为未知节点 */ });
  })).then(function(){ return null; });
}
function loadChainData(opts){
  opts = opts || {};
  var s = ++seq;
  /* 每次全量重取分页，先清空：否则刷新后已删除 / 被筛掉的工作项仍留在图上和计数里 */
  taskMap = {};
  if(!opts.silent){
    chainBody.innerHTML = UI.skeletonRows(6);
    chainMeta.textContent = "加载中…";
  }
  return Promise.all([ API.get("/api/gantt/deps"), loadTaskPages(0) ]).then(function(rs){
    deps = rs[0] || [];
    return fillMissingTasks();
  }).then(function(){
    if(s !== seq) return;
    chainLoaded = true;
    /* 默认中心：优先选有依赖且未完成的，其次有依赖的，再次第一项 */
    if(!centerId || !taskMap[centerId]){
      centerId = pickDefaultCenter();
    }
    renderChain();
  }).catch(function(ex){
    if(s !== seq) return;
    chainMeta.textContent = "";
    chainBody.innerHTML = UI.errorState(ex.message);
    bindRetry(chainBody, function(){ loadChainData(); });
  });
}
function pickDefaultCenter(){
  var order = Object.keys(taskMap).map(function(id){ return taskMap[id]; });
  order.sort(function(a, b){ return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); });
  var inDep = {};
  deps.forEach(function(d){ inDep[d.fromTaskId] = 1; inDep[d.toTaskId] = 1; });
  var hit = order.filter(function(t){ return inDep[t.id] && !isDoneTask(t); })[0]
    || order.filter(function(t){ return inDep[t.id]; })[0];
  return hit ? hit.id : (order[0] ? order[0].id : null);
}
/* ---------- 链展开 ---------- */
function neighbors(id, dir){
  return deps.filter(function(dep){
    return dir === "up" ? dep.toTaskId === id : dep.fromTaskId === id;
  });
}
function expand(id, dir, path, depth){
  var out = { nodes: [], more: 0 };
  neighbors(id, dir).forEach(function(dep){
    var otherId = dir === "up" ? dep.fromTaskId : dep.toTaskId;
    if(depth >= MAX_DEPTH){ out.more++; return; }
    if(path.indexOf(otherId) !== -1){
      out.nodes.push({ cycle:true, taskId:otherId, dep:dep, task:taskMap[otherId] });
      return;
    }
    out.nodes.push({
      task: taskMap[otherId], missing: !taskMap[otherId], dep: dep,
      kids: expand(otherId, dir, path.concat([otherId]), depth + 1)
    });
  });
  return out;
}
/* 到达去重计数（BFS，全图 visited，区别于路径级成环守卫） */
function reachableCount(id, dir){
  var seen = {}, queue = [id], n = 0;
  seen[id] = 1;
  while(queue.length){
    var cur = queue.shift();
    neighbors(cur, dir).forEach(function(dep){
      var other = dir === "up" ? dep.fromTaskId : dep.toTaskId;
      if(seen[other]) return;
      seen[other] = 1; n++; queue.push(other);
    });
  }
  return n;
}
/* ---------- 渲染 ---------- */
function depTagHTML(dep){
  var type = dep.depType || "FS";
  var lag = Number(dep.lagDays) || 0;
  return '<span class="ch-dep-tag">' + esc(type) + '</span>' +
    (lag ? ' <span class="ch-dep-tag lag">' + (lag > 0 ? "+" : "") + lag + '天</span>' : '') +
    ' <span class="ch-dep-text">' + esc(DEP_TEXT[type] || "") + '</span>';
}
function statusTagHTML(t){
  var c = colMeta(t.boardColumn), color = c ? c.color : "var(--text-3)";
  return '<span class="tag tag-cat" style="--tag-c:' + esc(color) + '">' + esc(colName(t.boardColumn)) + '</span>';
}
function nodeInnerHTML(t, showType){
  var due = t.dueDate ? esc(fmtShortMD(parseDate(t.dueDate))) : "";
  var p = progressOf(t);
  return (showType ? (typeBadgeHTML(t.itemType) || '<span class="mini-tag">' + esc(typeName(t.itemType)) + '</span>') + severityBadgeHTML(t.severity) : "") +
    '<span class="ch-node-title" title="' + esc(t.title) + '">' + esc(t.title) + '</span>' +
    statusTagHTML(t) +
    (p > 0 || t.boardColumn === "doing"
      ? '<span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span>'
      : "") +
    (due ? '<span class="ch-due">' + due + '</span>' : "") +
    (t.owner ? avatarHTML(t.owner) : "");
}
function nodeHTML(t){
  return '<div class="ch-node" role="button" tabindex="0" data-chain-center="' + esc(t.id) + '">' + nodeInnerHTML(t, true) + '</div>';
}
function missingNodeHTML(id){
  return '<div class="ch-node is-missing" aria-disabled="true"><span class="ch-node-title muted">未知工作项（' + esc(String(id).slice(0, 8)) + '…）</span>' +
    '<span class="mini-tag">不在当前数据范围</span></div>';
}
/* 一段分支：节点 → 边（dep）→ 更深的嵌套分支。几何上 from 在上、to 在下，两个方向同构 */
function branchHTML(level, first){
  var html = '<div class="ch-branch' + (first ? " first-level" : "") + '">';
  level.nodes.forEach(function(n){
    if(n.cycle){
      html += '<div class="ch-edge"><span class="ch-edge-line"></span>' + depTagHTML(n.dep) +
        ' <span class="ch-cycle">↩ 检测到环路：回到「' + esc(n.task ? n.task.title : n.taskId) + '」— 不再展开</span></div>';
      return;
    }
    html += n.missing ? missingNodeHTML(n.taskId || "?") : nodeHTML(n.task);
    html += '<div class="ch-edge"><span class="ch-edge-line"></span>' + depTagHTML(n.dep) + '</div>';
    if(n.kids){
      if(n.kids.nodes.length) html += branchHTML(n.kids, false);
      if(n.kids.more) html += '<div class="ch-edge"><span class="ch-edge-line"></span><span class="ch-dep-text">… 还有 ' + n.kids.more + ' 项后继更深，未展开</span></div>';
    }
  });
  return html + '</div>';
}
function sectionHTML(dir, level, count){
  var label = dir === "up" ? "▲ 上游 · 它卡在谁后面" : "▼ 下游 · 它解锁了谁";
  if(!level.nodes.length && !level.more){
    return '<div class="ch-sec"><div class="ch-sec-label">' + label +
      '</div><div class="ch-empty">没有' + (dir === "up" ? "前置" : "后继") + '依赖</div></div>';
  }
  return '<div class="ch-sec"><div class="ch-sec-label">' + label + ' <span class="ch-n">' + count + ' 项</span></div>' +
    branchHTML(level, true) + '</div>';
}
function centerCardHTML(t){
  return '<div class="ch-center-card" role="button" tabindex="0" data-chain-open="' + esc(t.id) + '" title="点击打开详情抽屉">' +
    '<span class="ch-badge">中心工作项</span>' + nodeInnerHTML(t, true) + '</div>';
}
function renderChain(){
  var t = centerId ? taskMap[centerId] : null;
  var ids = Object.keys(taskMap).length;
  chainMeta.textContent = "已加载 " + ids + " 项 · 依赖 " + deps.length + " 条" +
    (ids >= TASK_CAP ? "（已达加载上限）" : "");
  if(!t){
    chainBody.innerHTML = '<div style="padding:8px">' + UI.emptyState({
      icon:"inbox", title:"没有可选的工作项",
      textHtml:"新建一个工作项；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。",
      actionLabel:"新建工作项", compact:true
    }) + '</div>';
    return;
  }
  syncPickerBtn();
  var upCount = reachableCount(centerId, "up"), downCount = reachableCount(centerId, "down");
  var html = "";
  var up = expand(centerId, "up", [centerId], 0);
  var down = expand(centerId, "down", [centerId], 0);
  if(direction !== "down") html += sectionHTML("up", up, upCount);
  html += centerCardHTML(t);
  if(direction !== "up") html += sectionHTML("down", down, downCount);
  chainBody.innerHTML = html;
}
function syncPickerBtn(){
  var t = centerId ? taskMap[centerId] : null;
  $("btnChainPickText").textContent = t ? t.title : "选择中心工作项";
}
/* ---------- 中心工作项选择器 ---------- */
var pickMenu = null;
function openPicker(){
  if(pickMenu && pickMenu.__popOpen) return;
  if(!pickMenu){
    pickMenu = document.createElement("div");
    pickMenu.className = "menu chain-picker-menu";
    pickMenu.hidden = true;
    pickMenu.innerHTML = '<div class="menu-field"><input class="input" type="search" placeholder="搜索标题…" aria-label="搜索工作项" /></div>' +
      '<div class="chain-picker-list" role="listbox"></div>';
    document.body.appendChild(pickMenu);
    var input = pickMenu.querySelector("input");
    input.addEventListener("input", function(){ fillPickerList(input.value); });
    pickMenu.addEventListener("click", function(e){
      var item = e.target.closest("[data-chain-pick]");
      if(!item) return;
      centerId = item.getAttribute("data-chain-pick");
      UI.closeAllPops();
      renderChain();
    });
  }
  fillPickerList("");
  var input = pickMenu.querySelector("input");
  UI.openPop(pickMenu, btnPicker, { width: 340, onClose:function(){ input.value = ""; } });
  setTimeout(function(){ input.focus(); }, 0);
}
function fillPickerList(kw){
  var list = pickMenu.querySelector(".chain-picker-list");
  var items = Object.keys(taskMap).map(function(id){ return taskMap[id]; });
  if(kw){
    var k = kw.toLowerCase();
    items = items.filter(function(t){ return String(t.title || "").toLowerCase().indexOf(k) !== -1; });
  }
  items.sort(function(a, b){ return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); });
  var MAX = 80;
  list.innerHTML = items.slice(0, MAX).map(function(t){
    return '<button type="button" class="chain-picker-item' + (t.id === centerId ? " on" : "") + '" data-chain-pick="' + esc(t.id) + '" role="option" aria-selected="' + (t.id === centerId) + '">' +
      (typeBadgeHTML(t.itemType) || "") +
      '<span class="ch-node-title">' + esc(t.title) + '</span>' +
      statusTagHTML(t) + '</button>';
  }).join("") || '<div class="chain-empty">没有匹配的工作项</div>';
  if(items.length > MAX){
    list.innerHTML += '<div class="chain-empty">仅显示前 ' + MAX + ' 项，请用搜索缩小范围</div>';
  }
}
/* ---------- 入口 / 事件 / 刷新 ---------- */
function syncDirSeg(){
  Array.prototype.forEach.call(segDir.querySelectorAll("button"), function(b){
    var on = b.getAttribute("data-dir") === direction;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function enterChainView(){
  if(!segDir.querySelector("button")) syncDirSeg();
  /* 每次进入都拉数据（GET 有 ETag 缓存，成本可控）：依赖在甘特等视图里可能被改掉，
     只重渲染会让链与 /api/gantt/deps 脱节 */
  loadChainData({ silent: chainLoaded });
}
function refreshChainIfOpen(){
  if(activeView !== "chain") return null;
  var scroller = document.getElementById("view-chain");
  scroller = scroller && scroller.querySelector(".chain-scroll");
  var top = scroller ? scroller.scrollTop : 0;
  return loadChainData({ silent:true }).then(function(){
    if(scroller) scroller.scrollTop = top;
  });
}
btnPicker.addEventListener("click", openPicker);
segDir.addEventListener("click", function(e){
  var b = e.target.closest("[data-dir]");
  if(!b) return;
  direction = b.getAttribute("data-dir");
  syncDirSeg();
  if(activeView === "chain") renderChain();
});
chainBody.addEventListener("click", function(e){
  var opener = e.target.closest("[data-chain-open]");
  if(opener){
    var t = taskMap[opener.getAttribute("data-chain-open")];
    if(t) openTaskDrawer(null, t);
    return;
  }
  var node = e.target.closest("[data-chain-center]");
  if(node){
    centerId = node.getAttribute("data-chain-center");
    renderChain();
    var scroller = document.getElementById("view-chain");
    scroller = scroller && scroller.querySelector(".chain-scroll");
    if(scroller) scroller.scrollTop = 0;
  }
});
chainBody.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var el = e.target.closest("[data-chain-center],[data-chain-open]");
  if(!el) return;
  e.preventDefault();
  el.click();
});

export { enterChainView, refreshChainIfOpen };
