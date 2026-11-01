/* views/list · 列表视图 */

import { API } from "../core/api.js";
import { $, listBulkBar } from "../core/dom.js";
import { clearFilters } from "../core/filters-ui.js";
import { boardParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { catTag, dueState, dueText, filterOn, progressOf, reqNameById, rt, state, tagChip } from "../core/state.js";
import { openDuePopover, taskLink, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { deleteTask, openTaskDrawer, ownerOptions } from "../core/task-drawer.js";
import { UI, copyToClipboard, esc, toast, toastAction } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, COLUMNS, PRIORITIES, avatarHTML, colMeta, colName, darken, duePresetDate, fmtShortMD, parseDate, rgbaOf } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";

var listBody = $("listBody"), listMeta = $("listMeta"), listSort = $("listSort"),
    listSelectAll = $("listSelectAll"), btnListBulk = $("btnListBulk");
function enterListView(){ loadList(); }
function refreshListIfOpen(){ if(activeView === "list") loadList(); }
function loadList(opts){
  opts = opts || {};
  var seq = ++rt.listSeq;
  if(!opts.silent){
    listBody.innerHTML = UI.skeletonRows(8);
    listMeta.textContent = "加载中…";
  }
  /* 选中态不在重载时清空：批量操作后会重载，清空让人误以为操作没生效；
     真正失效的 id 在 renderListItems 里按可见行裁剪 */
  syncListSelectionUI();
  API.get("/api/tasks/list", boardParams({sort: listSort.value})).then(function(d){
    if(seq !== rt.listSeq) return;
    rt.listTotal = d.total || 0;
    var shown = (d.items || []).length;
    listMeta.textContent = "共 " + rt.listTotal + " 项" +
      (filterOn() ? " · 已筛选 " + shown + " 项" : "") +
      (rt.listTotal > 500 ? "（仅显示前 500 项，请用筛选缩小范围）"
        : (rt.listTotal > shown ? "（已截断）" : ""));
    renderListItems(d.items || []);
  }).catch(function(ex){
    if(seq !== rt.listSeq) return;
    listMeta.textContent = "";
    listBody.innerHTML = UI.errorState(ex.message);
    bindRetry(listBody, function(){ loadList(); });
  });
}
function renderListItems(items){
  rt.listCache = {};
  if(!items || !items.length){
    rt.listSelected = {};
    listBody.innerHTML = '<div style="padding:8px">' + (filterOn()
      ? UI.emptyState({ icon:"filterOff", title:"没有符合当前筛选的任务", text:"调整或清空筛选条件后重试。", actionLabel:"清空筛选", compact:true })
      : UI.emptyState({ icon:"inbox", title:"这里还没有任务", text:"新建一个任务；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。", actionLabel:"新建任务", compact:true })) + '</div>';
    bindRetry(listBody, function(){ if(filterOn()) clearFilters(); else openTaskDrawer("backlog"); });
    syncListSelectionUI();
    return;
  }
  var keepSelected = {};
  listBody.innerHTML = items.map(function(t){
    rt.listCache[t.id] = t;
    if(rt.listSelected[t.id]) keepSelected[t.id] = true;
    var st = dueState(t);
    var p = progressOf(t);
    var dueTxt = t.boardColumn === "done"
      ? (t.completedAt ? ("完成于 " + fmtShortMD(parseDate(t.completedAt))) : "已完成")
      : dueText(t);
    var tagsHTML = catTag(t.category);
    (t.tags || []).slice(0, 3).forEach(function(tg){ tagsHTML += tagChip(tg); });
    var colC = colMeta(t.boardColumn);
    var colColor = colC ? colC.color : CAT_DEFAULT_COLOR;
    return '<div class="list-row" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
      '<span><input type="checkbox" class="cbx" data-row-check="' + esc(t.id) + '" aria-label="选择任务：' + esc(t.title) + '"' +
        (rt.listSelected[t.id] ? ' checked' : '') + ' /></span>' +
      '<span class="lr-task">' +
        '<span class="lr-t">' + esc(t.title) + '</span>' +
        (tagsHTML ? '<span class="lr-tags">' + tagsHTML + '</span>' : '') +
      '</span>' +
      '<span class="cell"><span class="tag" style="background:' + rgbaOf(colColor,.10) + ';color:' + darken(colColor) + '">' +
        esc(colName(t.boardColumn)) + '</span></span>' +
      '<span>' + (t.boardColumn === "done"
        ? '<span class="pdot" style="color:var(--success)">' + icon("check", 13) + '</span>'
        : '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>') + '</span>' +
      '<span class="cell">' + esc(t.owner || "—") + '</span>' +
      '<span class="cell ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' + esc(dueTxt) + '</span>' +
      '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span></span>' +
      '<span class="cell">' + (t.reqId ? esc(reqNameById(t.reqId)) : "—") + '</span>' +
      '<span class="cell-act"><button class="icon-btn sm" type="button" data-row-menu="' + esc(t.id) +
        '" aria-label="更多操作" title="更多操作">' + icon("more", 15) + '</button></span>' +
    '</div>';
  }).join("");
  /* 只保留当前可见行的选中态，避免隐藏任务被批量删除 */
  rt.listSelected = keepSelected;
  syncListSelectionUI();
}
function syncListSelectionUI(){
  var checked = listBody.querySelectorAll("[data-row-check]:checked");
  var n = checked.length;
  /* 原「移入回收站」按钮在顶部工具栏、其它批量操作在列表上方，两条并存既重复、
     又让批量入口看起来"只有一个删除"。现在统一收进列表上方那一条（元素保留，仅常驻隐藏）。 */
  btnListBulk.hidden = true;
  if(listBulkBar){
    listBulkBar.hidden = n === 0;
    if(n > 0){
      listBulkBar.innerHTML = '<div class="bulk-bar">' +
        '<span class="bk-n">已选 ' + n + ' 项</span>' +
        '<button class="btn sm" type="button" data-bulk="pri">改优先级</button>' +
        '<button class="btn sm" type="button" data-bulk="owner">改负责人</button>' +
        '<button class="btn sm" type="button" data-bulk="due">改截止</button>' +
        '<button class="btn sm" type="button" data-bulk="col">改所在列</button>' +
        '<button class="btn sm" type="button" data-bulk="tag">加标签</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm danger" type="button" data-bulk="del">' + icon("trash", 13) + ' 移入回收站</button>' +
        '<button class="btn sm ghost" type="button" data-bulk="clear">取消选择</button>' +
      '</div>';
    }else{
      listBulkBar.innerHTML = "";
    }
  }
  var all = listBody.querySelectorAll("[data-row-check]");
  listSelectAll.checked = all.length > 0 && checked.length === all.length;
  listSelectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}
function bulkIds(){
  return Object.keys(rt.listSelected).filter(function(k){ return rt.listSelected[k]; });
}
function bulkApply(patchFor, label){
  var ids = bulkIds();
  if(!ids.length) return;
  var okN = 0, failN = 0;
  UI.syncBusy(true);
  Promise.all(ids.map(function(id){
    var t = rt.listCache[id];
    if(!t) return Promise.resolve();
    var patch = patchFor(t);
    if(!patch || !Object.keys(patch).length) return Promise.resolve();
    return API.put("/api/tasks/" + encodeURIComponent(id), taskPayloadWith(t, patch))
      .then(function(){ okN++; })
      .catch(function(){ failN++; });
  })).then(function(){
    UI.syncBusy(false);
    toast("批量" + label + "完成：" + okN + " 项成功" + (failN ? ("，" + failN + " 项失败") : ""),
      failN ? "warn" : "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  });
}
function bulkMoveTo(column){
  var ids = bulkIds();
  if(!ids.length) return;
  UI.syncBusy(true);
  API.post("/api/tasks/bulk-move", {
    ids: ids,
    column: column,
    autoTimer: false,
    autoResume: false
  }).then(function(res){
    UI.syncBusy(false);
    toast("已批量移动到「" + colName(column) + "」：" + ((res && res.moved) || ids.length) + " 项", "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  }).catch(function(ex){
    UI.syncBusy(false);
    toast("批量移动失败：" + (ex.message || "网络异常"), "bad");
  });
}
function openBulkMenu(anchor, kind){
  var el = document.createElement("div");
  el.className = "menu";
  var html = "";
  if(kind === "pri"){
    html = '<div class="menu-title">改为优先级</div>' + PRIORITIES.map(function(p){
      return '<button class="menu-item" type="button" data-bv="pri" data-v="' + p + '">' +
        '<span class="pdot ' + p + '"><i></i>' + p + '</span></button>';
    }).join("");
  }else if(kind === "owner"){
    html = '<div class="menu-title">改为负责人</div>' + ownerOptions().map(function(o){
      return '<button class="menu-item" type="button" data-bv="owner" data-v="' + esc(o.id) + '" data-n="' + esc(o.name) + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + '</button>';
    }).join("");
  }else if(kind === "due"){
    html = '<div class="menu-title">改为截止日期</div>' +
      [["0","今天"],["1","明天"],["w5","一周后（5 个工作日）"]].map(function(x){
        return '<button class="menu-item" type="button" data-bv="due" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join("") +
      '<button class="menu-item" type="button" data-bv="due" data-v="">清除截止日期</button>';
  }else if(kind === "col"){
    html = '<div class="menu-title">改为所在列</div>' + COLUMNS.map(function(c){
      return '<button class="menu-item" type="button" data-bv="col" data-v="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    }).join("");
  }
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-bv]");
    if(!b) return;
    var k = b.dataset.bv, v = b.dataset.v, n = b.dataset.n;
    UI.closeAllPops();
    if(k === "pri") bulkApply(function(){ return {priority: v}; }, "改优先级");
    else if(k === "owner") bulkApply(function(){ return {owner: n, ownerUserId: v || null}; }, "改负责人");
    else if(k === "due") bulkApply(function(){ return {dueDate: duePresetDate(v)}; }, "改截止");
    else if(k === "col") bulkMoveTo(v);
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
if(listBulkBar){
  listBulkBar.addEventListener("click", function(e){
    var b = e.target.closest("[data-bulk]");
    if(!b) return;
    var kind = b.dataset.bulk;
    if(kind === "clear"){
      rt.listSelected = {};
      listBody.querySelectorAll("[data-row-check]").forEach(function(cb){ cb.checked = false; });
      syncListSelectionUI();
      return;
    }
    if(kind === "del"){
      /* 复用原有的二次确认 + 撤销 Toast 流程（元素常驻隐藏，但 JS 仍可触发） */
      btnListBulk.click();
      return;
    }
    if(kind === "tag"){
      UI.showPrompt({ title: "批量添加标签", label: "标签名（≤16 字，已存在则跳过）", maxLength: 16, okText: "添加" })
        .then(function(input){
          if(!input) return;
          var name = String(input).trim().slice(0, 16);
          if(!name) return;
          bulkApply(function(t){
            var tags = (t.tags || []).slice();
            if(tags.indexOf(name) === -1){
              if(tags.length >= 8) return null;   // 已达上限：跳过该条
              tags.push(name);
            }
            return {tags: tags};
          }, "加标签");
        });
      return;
    }
    openBulkMenu(b, kind);
  });
}
listBody.addEventListener("click", function(e){
  if(e.target.closest("input[type=checkbox]")) return;
  var menuBtn = e.target.closest("[data-row-menu]");
  if(menuBtn){ openRowMenu(menuBtn, menuBtn.dataset.rowMenu); return; }
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  var t = rt.listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listBody.addEventListener("change", function(e){
  var cb = e.target.closest("[data-row-check]");
  if(!cb) return;
  rt.listSelected[cb.dataset.rowCheck] = cb.checked;
  syncListSelectionUI();
});
listBody.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  if(e.target.closest("input,button")) return;
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  e.preventDefault();
  var t = rt.listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listSelectAll.addEventListener("change", function(){
  listBody.querySelectorAll("[data-row-check]").forEach(function(cb){
    cb.checked = listSelectAll.checked;
    rt.listSelected[cb.dataset.rowCheck] = listSelectAll.checked;
  });
  syncListSelectionUI();
});
btnListBulk.addEventListener("click", function(){
  var ids = Object.keys(rt.listSelected).filter(function(k){ return rt.listSelected[k]; });
  if(!ids.length) return;
  UI.showConfirm({
    title:"批量移入回收站",
    msg:"将把选中的 <b>" + ids.length + "</b> 项任务移入回收站（30 天内可恢复）。确定继续？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    btnListBulk.disabled = true;
    UI.syncBusy(true);
    Promise.all(ids.map(function(id){
      return API.del("/api/tasks/" + encodeURIComponent(id)).catch(function(){ return null; });
    })).then(function(){
      UI.syncBusy(false);
      btnListBulk.disabled = false;
      toastAction("已移入回收站 " + ids.length + " 项", "撤销", function(){
        Promise.all(ids.map(function(id){
          return API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).catch(function(){ return null; });
        })).then(function(){
          toast("已恢复 " + ids.length + " 项", "fs");
          loadList(); loadBoard({animate:false}); loadReqs();
        });
      }, "", 8000);
      loadList(); loadBoard({animate:false}); loadReqs();
    });
  });
});
function openRowMenu(anchor, id){
  var t = rt.listCache[id];
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html = '<button class="menu-item" type="button" data-row-act="edit">' + icon("edit", 14) + '编辑</button>' +
    '<button class="menu-item" type="button" data-row-act="done">' + icon(isDone ? "undo" : "check", 14) +
      (isDone ? "取消完成" : "标记完成") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="due">' + icon("calSmall", 14) + '改期</button>' +
    '<button class="menu-item" type="button" data-row-act="timer">' +
      icon("timer", 14) + (running ? "停止计时" : "开始计时") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-row-act="link">' + icon("extlink", 14) + '复制任务链接</button>';
  var others = COLUMNS.filter(function(c){ return c.id !== t.boardColumn; });
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-row-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  html += '<div class="menu-sep"></div>' +
    '<button class="menu-item danger" type="button" data-row-act="del">' + icon("trash", 14) + '移到回收站</button>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var act = e.target.closest("[data-row-act]");
    var mv = e.target.closest("[data-row-move]");
    UI.closeAllPops();
    if(act){
      var k = act.dataset.rowAct;
      if(k === "due"){
        setTimeout(function(){ openDuePopover(anchor, t.id); }, 0);
      }else if(k === "edit") openTaskDrawer(null, t);
      else if(k === "done") toggleTaskDone(t.id);
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "link") copyToClipboard(taskLink(t.id), "任务链接已复制（可直接定位到该任务）");
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      var to = mv.dataset.rowMove;
      API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: to}).then(function(res){
        toast("「" + t.title + "」移动到「" + colName(res.to) + "」" +
          (res.autoTimerStarted ? " · 已开始计时" : ""));
        loadList(); loadBoard({silent:true}); loadReqs();
      }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
listSort.addEventListener("change", function(){ loadList(); });

export { enterListView, loadList, refreshListIfOpen };
