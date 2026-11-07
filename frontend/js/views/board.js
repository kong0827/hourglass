/* views/board · 看板：加载、卡片、拖拽、列操作 */

import { API } from "../core/api.js";
import { loadCategories, pruneStaleFilters, updateTagDatalist } from "../core/app.js";
import { board, reqListEl } from "../core/dom.js";
import { renderFilterChips, saveViewState } from "../core/filters-ui.js";
import { boardParams, updateBrand } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { renderAlertBar } from "../core/notifications.js";
import { activeView } from "../core/router.js";
import { loadPriorities } from "../core/priorities.js";
import { canEditReq, canEditTask, catTag, dueMetaClass, dueState, dueText, filterOn, progressOf, rt, safeColor, state, tagChip, taskById, taskCacheExtra, timerAllowed, totalTaskCount } from "../core/state.js";
import { loadRunningTimer, openCardMenu, openDuePopover, toggleTaskDone, toggleTaskTimer } from "../core/task-actions.js";
import { buildFormControls, deleteTask, openTaskDrawer, populateReqSelect, syncFormSegs } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { RECUR_LABEL, bindRetry, parseQuickAdd } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, COLUMNS, PALETTE, avatarHTML, colMeta, colName, dayDiff, fmtElapsed, fmtFull, fmtMinutes, fmtMinutesShort, fmtTs, mdLite, parseDate, priColor, priName, priTagHTML, recurLabel, severityBadgeHTML, syncColumns, typeBadgeHTML } from "../lib/format.js";
import { branchNameById } from "./branches.js";
import { loadView } from "../core/view-loader.js";
import { loadReqDocs, openReqDocAndJump, reqDocNameById } from "./requirements.js";

function showBoardSkeleton(){
  board.classList.remove("busy");
  if(isMobile()){
    board.innerHTML = '<div class="mob-board">' +
      '<div class="mob-col-seg"><span class="skel" style="width:120px;height:34px;border-radius:10px"></span>' +
        '<span class="skel" style="width:90px;height:34px;border-radius:10px"></span></div>' +
      '<div class="mob-board-list">' + UI.skeletonCards(3) + '</div></div>';
    return;
  }
  var h = "";
  for(var i = 0; i < 3; i++){
    h += '<div class="board-col"><div class="board-col-head">' +
      '<span class="skel" style="width:60px;height:12px"></span></div>' +
      '<div class="board-col-body">' + UI.skeletonCards(3) + '</div></div>';
  }
  board.innerHTML = h;
}
function showBoardError(msg){
  board.classList.remove("busy");
  board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:60vh">' +
    UI.errorState(msg) + '</div>';
  bindRetry(board, function(){ state.board = null; loadBoard({animate:true}); });
}
function loadBoard(opts){
  opts = opts || {};
  var seq = ++state.loadSeq;
  if(!opts.silent){
    if(!state.board) showBoardSkeleton();
    else { board.classList.add("busy"); UI.syncBusy(true); opts._busy = true; }
  }
  return Promise.all([API.get("/api/board", boardParams()), loadPriorities()]).then(function(rs){
    var data = rs[0];
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    state.board = data;
    state.doneExtra = [];
    state.boardGen++;
    syncColumns(data.columnDefs);
    buildFormControls();
    syncFormSegs();
    updateTagDatalist();
    loadCategories();
    if(pruneStaleFilters(data.meta)){ saveViewState(); loadBoard({silent:true}); return; }
    board.classList.remove("busy");
    /* 筛选栏与看板解耦：render() 在非看板视图会早退，此前筛选 chips 只在看板渲染，
       直接进列表/日历等页面时负责人/优先级/类型/更多筛选全部空白 */
    renderFilterChips();
    render({animate: !!opts.animate});
    /* 卡片上的「计时中」状态来自另一个接口；只有确实有运行中的计时才补一次渲染 */
    loadRunningTimer(function(rt){
      if(rt && seq === state.loadSeq) render({animate:false});
    });
    /* 卡片上的需求名来自需求列表（首次加载后会重绘一次） */
    loadReqDocs();
  }).catch(function(ex){
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    board.classList.remove("busy");
    if(!state.board) showBoardError(ex.message || "网络异常，请稍后重试");
    else toast("加载失败：" + (ex.message || "网络异常"), "bad");
  });
}
var reqLoadSeq = 0;
function loadReqs(){
  var seq = ++reqLoadSeq;
  var wsId = rt.currentWs && rt.currentWs.id;
  return API.get("/api/reqs").then(function(list){
    if(seq !== reqLoadSeq) return;
    if(wsId && (!rt.currentWs || rt.currentWs.id !== wsId)) return;
    rt.reqList = list || [];
    rt.reqsLoaded = true;
    populateReqSelect();
    if(activeView === "projects") loadView("projects").then(function(m){ m.renderReqList(); });
  }).catch(function(){
    if(seq !== reqLoadSeq) return;
    if(activeView === "projects" && !rt.reqsLoaded && reqListEl){
      reqListEl.innerHTML = UI.errorState("项目加载失败，请稍后重试");
    }
  });
}
function loadMoreDone(){
  var cd = state.board && state.board.columns.done;
  if(!cd || !cd.hasMore) return Promise.resolve(false);
  var gen = state.boardGen;
  var offset = cd.items.length + state.doneExtra.length;
  var listEl = board.querySelector('.board-col[data-col="done"] .board-col-body');
  if(listEl) listEl.classList.add("loading-more");
  UI.syncBusy(true);
  return API.get("/api/tasks/done", boardParams({doneLimit:20, doneOffset:offset})).then(function(page){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen !== state.boardGen) return false;
    var known = {};
    cd.items.forEach(function(t){ known[t.id] = 1; });
    state.doneExtra.forEach(function(t){ known[t.id] = 1; });
    (page.items || []).forEach(function(t){ if(!known[t.id]) state.doneExtra.push(t); });
    cd.matched = page.matched;
    cd.hasMore = (cd.items.length + state.doneExtra.length) < page.matched;
    render({animate:false});
    return true;
  }).catch(function(ex){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen === state.boardGen) toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function refreshBoardPreserving(){
  var wanted = state.doneExtra.length;
  loadBoard({silent:true}).then(function(){
    if(wanted === 0) return;
    var tries = 0;
    (function step(){
      var cd = state.board && state.board.columns ? state.board.columns.done : null;
      if(state.doneExtra.length >= wanted || !cd || !cd.hasMore || tries++ > 10) return;
      loadMoreDone().then(function(ok){ if(ok) step(); });
    })();
  });
}
function cardHTML(t, idx){
  var s = dueState(t);
  var isDone = t.boardColumn === "done";
  var blocked = !!t.blocked;
  /* 只读项目：隐藏写操作，但保留「更多」以打开详情/复制链接 */
  var editable = canEditTask(t);
  /* 只有"我自己"正在计时的任务才高亮；别人的计时在卡上不体现（工时是个人口径） */
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 色条只表达状态：完成绿、阻塞琥珀、逾期红、其余中性；优先级已在卡片头部用 P 标签表达 */
  var stripe = isDone ? "var(--success)"
    : (blocked ? "var(--warning)" : (s.kind === "over" ? "var(--danger)" : "var(--border-strong)"));
  var tip = t.dueDate ? ("截止 " + fmtFull(parseDate(t.dueDate))) : "未设置截止日期";
  if(isDone && t.completedAt) tip += " · 完成于 " + fmtFull(parseDate(t.completedAt));

  var tagsHTML = catTag(t.category);
  /* 关联文档：点一下跳到正文（不打开任务抽屉，所以单独用 data-open-reqdoc） */
  if(t.reqDocId){
    var docTitle = reqDocNameById(t.reqDocId);
    if(docTitle){
      tagsHTML += '<button type="button" class="tag tag-doc" data-open-reqdoc="' + esc(t.reqDocId) + '"' +
        ' title="打开文档：' + esc(docTitle) + '">' + esc(docTitle) + '</button>';
    }
  }
  if(t.branchId){
    /* 分支标签只做展示（点击跳转交给「分支」页，避免卡片上三个标签抢点击） */
    var brName = branchNameById(t.branchId);
    if(brName) tagsHTML += '<span class="tag tag-branch" title="所属分支：' + esc(brName) + '">' +
      icon("branch", 11) + esc(brName) + '</span>';
  }
  if(t.tags && t.tags.length){
    t.tags.slice(0, 2).forEach(function(tg){ tagsHTML += tagChip(tg); });
    if(t.tags.length > 2) tagsHTML += '<span class="tag tag-ghost">+' + (t.tags.length - 2) + '</span>';
  }

  var blockedTag = blocked
    ? '<span class="blocked-tag" title="' + esc(t.blockedReason || "被阻塞（未填原因）") + '">' +
        icon("alert", 12) + '被阻塞</span>'
    : "";

  var metaHTML = "";
  if(t.dueDate) metaHTML += '<span class="' + dueMetaClass(s.kind) + '" title="' + esc(tip) + '">' +
    icon("calSmall", 14) + dueText(t) + '</span>';
  if(t.subtaskTotal){
    var allSub = t.subtaskDone >= t.subtaskTotal;
    metaHTML += '<span class="meta' + (allSub ? " full" : "") + '" title="检查清单进度">' +
      icon("checklist", 14) + t.subtaskDone + '/' + t.subtaskTotal + '</span>';
  }
  if(Number(t.attachmentCount) > 0){
    metaHTML += '<span class="meta" title="附件">' + icon("clip", 14) + t.attachmentCount + '</span>';
  }
  if(Number(t.commentCount) > 0){
    metaHTML += '<span class="meta" title="评论">' + icon("comment", 14) + t.commentCount + '</span>';
  }
  if(t.estimateMinutes){
    /* 有预估就显示「实际/预估」：光看实际用了几小时没人知道自己算不算慢。
       计时中的任务同样要显示 —— 那正是最该知道自己快超了的时候；
       此时实际值只含已结束的段，title 里说明，避免误读。 */
    var actMin = Number(t.totalMinutes) || 0;
    var estR = actMin / t.estimateMinutes;
    var estCls = estR >= 1 ? " over" : (estR >= 0.8 ? " near" : "");
    metaHTML += '<span class="meta est-chip' + estCls + '" title="实际 ' + fmtMinutes(actMin) +
      (running ? '（不含正在计的这一段）' : '') + ' / 预估 ' + fmtMinutes(t.estimateMinutes) + '">' +
      (running ? '' : icon("timer", 14)) +
      fmtMinutesShort(actMin) + '/' + fmtMinutesShort(t.estimateMinutes) + '</span>';
  }else if(t.totalMinutes && !running){
    metaHTML += '<span class="meta' + (isDone ? ' full' : '') + '" title="' + (isDone ? "总耗时" : "累计工时") + '">' +
      icon("timer", 14) + (isDone ? '总耗时 ' : '') + fmtMinutesShort(t.totalMinutes) + '</span>';
  }
  if(running){
    /* 计时中的停止入口放在 meta 行（胶囊按钮）。放右上角会常驻挡住卡片标题 */
    metaHTML = '<button class="timer-chip" type="button" data-timer-toggle="' + esc(t.id) + '" title="点击停止计时">' +
      icon("pause", 12) + '<span>计时中</span><b data-elapsed>' +
      fmtElapsed(state.runningTimer.elapsedMinutes) + '</b></button>' + metaHTML;
  }
  if(t.recurType){
    metaHTML += '<span class="meta" title="循环任务：' + recurLabel(t.recurType) + '">' + icon("recur", 14) + '</span>';
  }
  if(t.remindAt && !isDone){
    metaHTML += '<span class="meta" title="提醒 ' + esc(fmtTs(t.remindAt)) + '">' + icon("bell", 14) + fmtTs(t.remindAt) + '</span>';
  }

  var p = progressOf(t);
  var progHTML = '<div class="progress' + (p >= 100 ? " full" : "") + (s.kind === "over" && p < 100 ? " over" : "") +
    '" title="当前进度 ' + p + '%"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></div>';
  var owner = t.owner || "—";

  return '<article class="card' + (isDone ? " is-done" : "") + (blocked ? " is-blocked" : "") +
      (s.kind === "over" ? " is-over" : "") +
      '" data-id="' + esc(t.id) + '" tabindex="0" role="listitem" draggable="false"' +
      ' style="--stripe:' + stripe + '" aria-label="' + esc(t.title) + '">' +
    '<div class="card-acts">' +
      /* 「开始计时」放动作区（hover 出现）；已在计时时不放 —— 停止入口在 meta 行的胶囊里，
         否则常驻的绿色按钮会盖住卡片标题 */
      (editable && !running && timerAllowed(t)
        ? '<button class="card-act low" type="button" data-timer-toggle="' + esc(t.id) + '"' +
            ' title="开始计时（会自动暂停其他任务的计时）" aria-label="开始计时：' + esc(t.title) + '">' +
            icon("timer", 13) + '</button>'
        : '') +
      (editable
        ? '<button class="card-act low" type="button" data-due-pop="' + esc(t.id) + '" title="改期（快捷键 D）" aria-label="改期：' + esc(t.title) + '">' +
            icon("calSmall", 13) + '</button>'
        : '') +
      '<button class="card-act always" type="button" data-card-menu="' + esc(t.id) + '" title="更多操作" aria-haspopup="true" aria-label="更多操作：' + esc(t.title) + '">' +
        icon("more", 14) + '</button>' +
    '</div>' +
    '<div class="card-head">' +
      '<span class="pri-mark">' +
        '<span class="card-tickwrap">' +
          (isDone
            ? '<span class="pdot-ico" style="color:var(--success-fg)">' + icon("check", 13) + '</span>'
            : priTagHTML(t.priority, null, true)) +
          (editable
            ? '<button class="card-tick" type="button" data-done-toggle="' + esc(t.id) + '"' +
                ' title="' + (isDone ? "取消完成（快捷键 X）" : "标记完成（快捷键 X）") + '"' +
                ' aria-label="' + (isDone ? "取消完成" : "标记完成") + '：' + esc(t.title) + '">' +
                icon(isDone ? "undo" : "check", 11) + '</button>'
            : '') +
        '</span>' +
        (isDone ? '' : '<span class="pdot ' + esc(t.priority) + '" style="color:' + esc(priColor(t.priority)) + '">' + esc(priName(t.priority)) + '</span>') +
      '</span>' +
      '<h3 class="card-title">' + typeBadgeHTML(t.itemType) + severityBadgeHTML(t.severity) + esc(t.title) + '</h3>' +
    '</div>' +
    (t.description ? '<p class="card-desc">' + mdLite(t.description) + '</p>' : '') +
    ((tagsHTML || blockedTag || !editable)
      ? '<div class="card-tags">' +
          (editable ? '' : '<span class="tag tag-ghost" title="你对该项目只有查看权限">' + icon("eye", 11) + '只读</span>') +
          blockedTag + tagsHTML + '</div>'
      : '') +
    (metaHTML ? '<div class="card-meta">' + metaHTML + '</div>' : '') +
    '<div class="card-foot">' + progHTML +
      '<span title="负责人：' + esc(owner) + '">' + avatarHTML(owner) + '</span>' +
    '</div>' +
  '</article>';
}
function cardAddHTML(colId){
  return '<button class="card-add" type="button" data-add="' + esc(colId) + '" aria-label="在「' + esc(colName(colId)) + '」新增任务">' +
    icon("plus", 13) + ' 添加任务</button>';
}
var mobCol = null;
function mobileColId(){
  for(var i = 0; i < COLUMNS.length; i++) if(COLUMNS[i].id === mobCol) return mobCol;
  mobCol = COLUMNS.length ? COLUMNS[0].id : "backlog";
  return mobCol;
}
function renderMobileBoard(opts){
  opts = opts || {};
  updateBrand();
  if(activeView !== "board"){
    rt.boardDirty = true;
    return;
  }
  rt.boardDirty = false;
  UI.hideTip();
  if(!state.board) return;

  board.classList.add("board-mobile");
  if(totalTaskCount() === 0 && !filterOn()){
    board.innerHTML = '<div class="mob-board">' +
      UI.emptyState({
        icon:"board",
        title:"看板还是空的",
        text:"点击右下角「新建」创建第一个任务，数据会实时同步到其他端。",
        actionLabel:"新建第一项任务"
      }) + '</div>';
    bindRetry(board, function(){ openTaskDrawer("backlog"); });
    renderAlertBar(); renderFilterChips();
    return;
  }

  var active = mobileColId();
  var seg = '<div class="mob-col-seg" role="tablist" aria-label="看板列">' + COLUMNS.map(function(c){
    var cd = state.board.columns[c.id] || {};
    var n = filterOn() ? ((cd.matched || 0) + "/" + (cd.total || 0)) : (cd.total || 0);
    return '<button class="mob-col-btn' + (c.id === active ? " on" : "") + '" type="button" role="tab" ' +
      'aria-selected="' + (c.id === active) + '" data-mob-col="' + esc(c.id) + '">' +
      '<i style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></i>' +
      '<span class="mob-col-name">' + esc(c.name) + '</span><b>' + esc(n) + '</b></button>';
  }).join("") + '</div>';

  var cd = state.board.columns[active] || {items:[], matched:0, total:0, allTotal:0, hasMore:false};
  var items = (cd.items || []).slice();
  if(active === "done" && state.doneExtra.length) items = items.concat(state.doneExtra);
  var listHTML;
  if(!items.length){
    var emptyTitle = filterOn() ? "无匹配任务" : "这一列还没有任务";
    var emptyDesc = filterOn() ? "调整筛选条件后再看" : "从下面新建，或把别的列拖过来";
    listHTML = UI.emptyState({ icon:"inbox", title:emptyTitle, text:emptyDesc, actionLabel:"新建任务", compact:true });
  }else{
    listHTML = items.map(function(t){ return cardHTML(t, 0); }).join("");
  }
  if(active === "done" && cd.hasMore){
    listHTML += '<button class="btn mob-load-more" type="button" data-more="1">加载更多（还有 ' +
      Math.max((cd.matched || 0) - items.length, 0) + ' 项）</button>';
  }

  board.innerHTML = '<div class="mob-board">' + seg +
    '<div class="mob-board-list" role="list">' + listHTML + cardAddHTML(active) + '</div></div>';

  var emptyBtn = board.querySelector(".empty-state [data-empty-action]");
  if(emptyBtn) emptyBtn.addEventListener("click", function(){ openTaskDrawer(active); });

  var movedId = opts.movedId;
  if(movedId){
    var el = board.querySelector('.card[data-id="' + movedId + '"]');
    if(el && el.scrollIntoView) el.scrollIntoView({block:"nearest"});
  }
  renderAlertBar();
  renderFilterChips();
  UI.wireTooltips(board);
}
function render(opts){
  if(isMobile()) return renderMobileBoard(opts);
  board.classList.remove("board-mobile");
  opts = opts || {};
  updateBrand();
  /* 不在看板视图时只置脏：避免甘特/列表视图下后台反复重建整块 DOM */
  if(activeView !== "board"){
    rt.boardDirty = true;
    return;
  }
  rt.boardDirty = false;
  UI.hideTip();
  if(!state.board) return;

  var scrollMemo = {}, boardLeft = board.scrollLeft;
  board.querySelectorAll(".board-col-body").forEach(function(el){
    var col = el.closest(".board-col");
    if(col) scrollMemo[col.dataset.col] = el.scrollTop;
  });

  board.innerHTML = "";
  var movedId = opts.movedId || null;

  if(totalTaskCount() === 0 && !filterOn()){
    board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:70vh;width:100%">' +
      UI.emptyState({
        icon:"board",
        title:"看板还是空的",
        textHtml:"新建一个任务，或用快捷键 <b>N</b> 快速录入。<br>数据保存在服务器，多端实时同步。",
        actionLabel:"新建第一项任务"
      }) + '</div>';
    bindRetry(board, function(){ openTaskDrawer("backlog"); });
    renderAlertBar(); renderFilterChips();
    return;
  }

  COLUMNS.forEach(function(c){
    var cd = state.board.columns[c.id] || {items:[], matched:0, total:0, allTotal:0, hasMore:false};
    var items = cd.items.slice();
    if(c.id === "done" && state.doneExtra.length) items = items.concat(state.doneExtra);
    var collapsed = !!state.collapsedCols[c.id];

    var col = document.createElement("section");
    col.className = "board-col" + (collapsed ? " collapsed" : "");
    col.dataset.col = c.id;

    var isCustom = (c.id !== "backlog" && c.id !== "doing" && c.id !== "done");
    var head = '<div class="board-col-head">' +
      '<span class="col-dot" style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"' +
        (isCustom ? ' role="button" tabindex="0" data-col-color="' + esc(c.id) + '" title="修改列颜色"' : '') + '></span>' +
      '<span class="col-name" data-col-rename="' + esc(c.id) + '"' +
        (c.done ? '' : ' role="button" tabindex="0" title="点击改名"') + '>' + esc(c.name) + '</span>' +
      '<span class="col-count" aria-live="polite">' + (filterOn() ? (cd.matched + "/" + cd.total) : cd.total) + '</span>' +
      '<span class="sp"></span>' +
      '<button class="icon-btn sm" type="button" data-col-add="' + esc(c.id) + '" title="在「' + esc(c.name) + '」新增任务" aria-label="在「' + esc(c.name) + '」新增任务">' + icon("plus", 14) + '</button>' +
      '<button class="icon-btn sm" type="button" data-col-fold="' + esc(c.id) + '" title="' + (collapsed ? "展开" : "折叠") + '列" aria-label="' + (collapsed ? "展开" : "折叠") + '列" aria-expanded="' + (!collapsed) + '">' +
        icon(collapsed ? "right" : "caretDown", 14) + '</button>' +
    '</div>';

    var body = '<div class="board-col-body" role="list">';
    if(!items.length){
      var emptyText, emptyIc;
      if(filterOn()){ emptyText = "无匹配任务"; emptyIc = "filterOff"; }
      else if(c.done && state.doneScope === "week" && cd.allTotal){ emptyText = "本周还没有完成的任务"; emptyIc = "checkCircle"; }
      else { emptyText = "拖动卡片到这里"; emptyIc = "inbox"; }
      body += UI.colEmpty(emptyText, emptyIc);
    }else{
      items.forEach(function(t, i){ body += cardHTML(t, i); });
    }
    if(c.done && cd.hasMore){
      body += '<button class="col-more" type="button" data-more="1">加载更多（还有 ' +
        Math.max(cd.matched - items.length, 0) + ' 项）</button>';
    }
    body += cardAddHTML(c.id);
    body += '</div>';

    var foot = "";
    if(c.done){
      var scopeLabel = state.doneScope === "week"
        ? ("仅本周 ⇄ 显示全部（共 " + cd.allTotal + "）")
        : "显示全部 ⇄ 仅本周";
      foot = '<div class="col-foot">' +
        '<button class="col-scope' + (state.doneScope === "week" ? " on" : "") + '" type="button" data-scope="1" title="切换「仅本周 / 全部」">' +
          esc(scopeLabel) + '</button>' +
      '</div>';
    }

    col.innerHTML = head + body + foot;
    board.appendChild(col);

    var listEl = col.querySelector(".board-col-body");
    if(scrollMemo[c.id] != null) listEl.scrollTop = scrollMemo[c.id];
  });

  board.scrollLeft = boardLeft;

  if(state.inlineAdd && state.inlineAdd.col){
    openInlineAdd(state.inlineAdd.col, state.inlineAdd.value, false);
  }

  if(movedId){
    var el = board.querySelector('.card[data-id="' + movedId + '"]');
    if(el){
      el.classList.add("just-moved");
      if(el.scrollIntoView) el.scrollIntoView({block:"nearest", inline:"nearest"});
      try{ el.focus({preventScroll:true}); }catch(e){ /* noop */ }
    }
  }
  renderAlertBar();
  renderFilterChips();
  UI.wireTooltips(board);
}
function openInlineAdd(colId, preset, focusIt){
  /* 手机单列模式没有 .board-col 容器，直接开抽屉，复用同一套新建表单 */
  if(isMobile()){ state.inlineAdd = null; openTaskDrawer(colId); return; }
  var col = board.querySelector('.board-col[data-col="' + colId + '"]');
  if(!col) return;
  var addBtn = col.querySelector(".card-add");
  if(!addBtn) return;
  var input = document.createElement("input");
  input.className = "card-add-input";
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "输入标题后回车创建…（!P0 / #项目 / @负责人 / +标签 / %进度 / ~每周 / 明天）";
  input.value = preset || "";
  input.setAttribute("aria-label", "在「" + colName(colId) + "」新增任务");
  input._restore = addBtn;

  var hint = document.createElement("div");
  hint.className = "foot-note";
  hint.style.marginTop = "4px";
  hint.hidden = true;

  addBtn.replaceWith(input);
  input.parentNode.insertBefore(hint, input.nextSibling);

  function restore(){
    state.inlineAdd = null;
    if(hint.parentNode) hint.remove();
    if(input._restore && input.parentNode) input.replaceWith(input._restore);
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){
      e.preventDefault();
      var v = input.value.trim();
      if(!v) return;
      state.inlineAdd = {col: colId, value: ""};
      inlineAddCreate(colId, v, input);
    }else if(e.key === "Escape"){
      e.preventDefault();
      restore();
    }
  });
  input.addEventListener("input", function(){
    if(state.inlineAdd) state.inlineAdd.value = input.value;
    /* O-24：#项目名 没命中时给即时提示，而不是静默把它留在标题里 */
    var q = parseQuickAdd(input.value);
    if(q.unmatchedReq){
      hint.textContent = "未找到项目「" + q.unmatchedReq + "」，这段文字会留在标题里（可改用抽屉里的项目下拉）";
      hint.hidden = false;
    }else if(q.unmatchedOwner){
      hint.textContent = "未找到成员「" + q.unmatchedOwner + "」，负责人未设置（这段文字会留在标题里）";
      hint.hidden = false;
    }else if(q.invalidDate){
      hint.textContent = "日期「" + q.invalidDate + "」不存在，不会设置截止日期";
      hint.hidden = false;
    }else{
      hint.hidden = true;
    }
  });
  input.addEventListener("blur", function(){
    setTimeout(function(){
      if(document.activeElement === input) return;
      if(state.inlineAdd && state.inlineAdd.value) return; // 有未提交内容时保留
      restore();
    }, 140);
  });
  if(focusIt !== false){
    try{ input.focus(); input.setSelectionRange(input.value.length, input.value.length); }catch(e){ /* noop */ }
  }
}
function inlineAddCreate(colId, title, input){
  var q = parseQuickAdd(title);
  if(q.reqId && !canEditReq(q.reqId)){
    toast("「" + q.reqName + "」只有查看权限，无法新增任务", "warn");
    return;
  }
  var payload = {
    title: q.title || title,
    priority: q.priority || "P2",
    boardColumn: colId,
    dueDate: q.dueDate || null,
    reqId: q.reqId || null,
    progress: q.progress == null ? 0 : q.progress,
    owner: q.owner || null,
    ownerUserId: q.ownerUserId || null,
    tags: q.tags || [],
    recurType: q.recurType || ""
  };
  if(q.invalidDate) toast("日期「" + q.invalidDate + "」不存在，未设置截止日期", "warn");
  input.disabled = true;
  API.post("/api/tasks", payload).then(function(nt){
    input.disabled = false;
    input.value = "";
    state.inlineAdd = {col: colId, value: ""};
    var tip = "已创建「" + nt.title + "」到「" + colName(colId) + "」";
    if(nt.dueDate) tip += " · 截止 " + nt.dueDate;
    if(q.priority) tip += " · " + priName(q.priority);
    if(q.owner) tip += " · 负责人 " + q.owner;
    if(q.tags && q.tags.length) tip += " · 标签 " + q.tags.join("/");
    if(q.recurType) tip += " · " + (RECUR_LABEL[q.recurType] || "循环");
    taskCacheExtra[nt.id] = nt;
    loadBoard({animate:true, movedId: nt.id});
    loadReqs();
    toast(tip, "fs");
  }).catch(function(ex){
    input.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
}
var drag = null, pending = null, lastPt = {x:0, y:0}, rafId = null, dragRaf = 0;
function onPointerDown(e){
  /* 手机档位不做拖拽换列（单列流 + 长按拖动留待下期），横向手势交给 cards 左滑 */
  if(isMobile()) return;
  var cardEl = e.target.closest ? e.target.closest(".card") : null;
  if(!cardEl) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  if(e.target.closest("button,input,textarea,select,a")) return;
  /* 只读项目不允许拖动改列：不动卡片位置，也不进入 pending 态 */
  if(!canEditTask(taskById(cardEl.dataset.id))) return;
  pending = {
    el: cardEl, id: cardEl.dataset.id,
    x0: e.clientX, y0: e.clientY,
    touch: e.pointerType !== "mouse",
    timer: null
  };
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending.touch){
    pending.timer = setTimeout(function(){ if(pending) beginDrag(lastPt.x, lastPt.y); }, 190);
  }
}
function onPointerMove(e){
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending && !drag){
    var dx = e.clientX - pending.x0, dy = e.clientY - pending.y0;
    if(Math.abs(dx) + Math.abs(dy) > 6){
      if(pending.touch){
        if(pending.timer) clearTimeout(pending.timer);
        pending = null;
        return;
      }
      beginDrag(e.clientX, e.clientY);
    }
  }
  if(drag){
    if(e.cancelable) e.preventDefault();
    /* 合并到一帧里读写 DOM，避免 pointermove 高频触发时反复测量布局 */
    if(!dragRaf) dragRaf = requestAnimationFrame(function(){ dragRaf = 0; if(drag) updateDrag(); });
  }
}
function onPointerUp(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; if(drag) updateDrag(); }
  if(drag) endDrag();
}
function onPointerCancel(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(drag) cancelDrag();
}
function boardTouchMove(e){ if(drag && e.cancelable) e.preventDefault(); }
function beginDrag(x, y){
  if(!pending) return;
  var cardEl = pending.el, id = pending.id;
  pending = null;
  if(!cardEl || !cardEl.parentNode) return;

  var rect = cardEl.getBoundingClientRect();
  var ghost = cardEl.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("just-moved");
  ghost.removeAttribute("tabindex");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);

  var line = document.createElement("div");
  line.className = "drop-line";

  cardEl.classList.add("dragging");
  document.body.classList.add("dragging-active");

  drag = {
    id: id, el: cardEl, ghost: ghost, line: line,
    x0: x, y0: y,
    colEl: cardEl.closest(".board-col"),
    beforeId: null
  };
  if(drag.colEl) drag.colEl.classList.add("drop-active");
  document.addEventListener("touchmove", boardTouchMove, {passive:false});
  var originBody = cardEl.closest(".board-col-body");
  if(originBody) originBody.insertBefore(line, cardEl.nextSibling);
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function updateDrag(){
  if(!drag) return;
  var x = lastPt.x, y = lastPt.y;
  drag.ghost.style.transform = "translate(" + (x - drag.x0) + "px," + (y - drag.y0) + "px) rotate(2deg)";

  var cols = board.querySelectorAll(".board-col");
  var target = null;
  for(var i = 0; i < cols.length; i++){
    var r = cols[i].getBoundingClientRect();
    if(x >= r.left - 12 && x <= r.right + 12){ target = cols[i]; break; }
  }
  if(!target) return;

  if(drag.colEl !== target){
    if(drag.colEl) drag.colEl.classList.remove("drop-active");
    drag.colEl = target;
    target.classList.add("drop-active");
  }

  var bodyEl = target.querySelector(".board-col-body");
  if(!bodyEl) return;
  var cards = Array.prototype.slice.call(bodyEl.querySelectorAll(".card:not(.dragging)"));
  var before = null;
  for(var k = 0; k < cards.length; k++){
    var cr = cards[k].getBoundingClientRect();
    if(y < cr.top + cr.height/2){ before = cards[k]; break; }
  }
  if(before) bodyEl.insertBefore(drag.line, before);
  else {
    var tail = bodyEl.querySelector(".card-add, .card-add-input, .col-more");
    if(tail) bodyEl.insertBefore(drag.line, tail);
    else bodyEl.appendChild(drag.line);
  }
  drag.beforeId = before ? before.dataset.id : null;
}
function loop(){
  if(!drag){ rafId = null; return; }
  var x = lastPt.x, y = lastPt.y;
  var br = board.getBoundingClientRect();
  if(x < br.left + 60) board.scrollLeft -= 14;
  else if(x > br.right - 60) board.scrollLeft += 14;
  if(drag.colEl){
    var bodyEl = drag.colEl.querySelector(".board-col-body");
    if(bodyEl){
      var lr = bodyEl.getBoundingClientRect();
      if(y < lr.top + 40) bodyEl.scrollTop -= 12;
      else if(y > lr.bottom - 40) bodyEl.scrollTop += 12;
    }
  }
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function endDrag(){
  var d = drag;
  var toCol = d.colEl ? d.colEl.dataset.col : null;
  var beforeId = d.beforeId;
  var fromEl = d.el.closest(".board-col");
  var fromCol = fromEl ? fromEl.dataset.col : null;
  cleanupDrag();
  if(!toCol){ render({animate:false}); return; }

  rt.suppressClickUntil = Date.now() + 260;
  optimisticMove(d.id, toCol, beforeId);
  render({animate:false, movedId:d.id});

  var body = { column: toCol };
  if(beforeId) body.beforeId = beforeId;
  API.post("/api/tasks/" + encodeURIComponent(d.id) + "/move", body).then(function(res){
    var task = res.task;
    if(res.to === "done" && res.from !== "done"){
      var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
      var doneMsg = dd > 0
        ? ("已完成任务「" + task.title + "」，延期 " + dd + " 天完成")
        : ("已完成任务「" + task.title + "」，按期完成");
      /* 完成后自动接力了同列的下一个任务，明确说出来，别让人以为计时断了 */
      if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
      toast(doneMsg, dd > 0 ? "warn" : "fs");
    }else if(res.from === "done" && res.to !== "done"){
      toast("已清除完成时间", "warn");
    }else if(fromCol !== res.to){
      toast("「" + task.title + "」移动到「" + colName(res.to) + "」" +
        (res.autoTimerStarted ? " · 已开始计时（拖到「已完成」会自动停止）" : ""));
    }
    loadBoard({silent:true});
    loadReqs();
  }).catch(function(ex){
    toast("移动失败：" + (ex.message || "网络异常"), "bad");
    loadBoard({silent:true});
  });
}
function cancelDrag(){ cleanupDrag(); render({animate:false}); }
function cleanupDrag(){
  if(!drag) return;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; }
  document.removeEventListener("touchmove", boardTouchMove);
  if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
  if(drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  if(drag.line && drag.line.parentNode) drag.line.parentNode.removeChild(drag.line);
  if(drag.el) drag.el.classList.remove("dragging");
  if(drag.colEl) drag.colEl.classList.remove("drop-active");
  document.body.classList.remove("dragging-active");
  drag = null;
}
function optimisticMove(id, toCol, beforeId){
  if(!state.board) return;
  var t = null, cdFrom = null;
  for(var i = 0; i < COLUMNS.length; i++){
    var cd = state.board.columns[COLUMNS[i].id];
    if(!cd) continue;
    for(var j = 0; j < cd.items.length; j++){
      if(cd.items[j].id === id){ t = cd.items[j]; cdFrom = cd; cd.items.splice(j,1); break; }
    }
    if(t) break;
  }
  if(!t){
    for(var k = 0; k < state.doneExtra.length; k++){
      if(state.doneExtra[k].id === id){
        t = state.doneExtra[k];
        cdFrom = state.board.columns.done;
        state.doneExtra.splice(k,1);
        break;
      }
    }
  }
  if(!t) return;
  if(cdFrom){
    cdFrom.matched = Math.max(0, cdFrom.matched - 1);
    if(cdFrom.total > 0) cdFrom.total--;
    if(t.boardColumn === "done"){
      cdFrom.allTotal = Math.max(0, cdFrom.allTotal - 1);
      cdFrom.hasMore = false;
    }
  }
  var cdTo = state.board.columns[toCol];
  if(!cdTo) return;
  var wasDone = t.boardColumn === "done";
  t.boardColumn = toCol;
  if(toCol === "done" && !wasDone) t.completedAt = rt.TODAY_ISO;
  else if(toCol !== "done") t.completedAt = null;
  var pos = cdTo.items.length;
  if(beforeId){
    for(var m = 0; m < cdTo.items.length; m++){
      if(cdTo.items[m].id === beforeId){ pos = m; break; }
    }
  }
  cdTo.items.splice(pos, 0, t);
  cdTo.matched++; cdTo.total++;
  if(toCol === "done" && !wasDone) cdTo.allTotal++;
}
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("pointermove", onPointerMove, {passive:false});
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("pointercancel", onPointerCancel);
board.addEventListener("click", function(e){
  var mobTab = e.target.closest("[data-mob-col]");
  if(mobTab){ mobCol = mobTab.dataset.mobCol; render({animate:false}); return; }
  var fold = e.target.closest("[data-col-fold]");
  if(fold){
    var cid = fold.dataset.colFold;
    state.collapsedCols[cid] = !state.collapsedCols[cid];
    render({animate:false});
    return;
  }
  var colAdd = e.target.closest("[data-col-add]");
  if(colAdd){ state.inlineAdd = {col: colAdd.dataset.colAdd, value: ""}; openInlineAdd(colAdd.dataset.colAdd, ""); return; }
  var add = e.target.closest("[data-add]");
  if(add){ state.inlineAdd = {col: add.dataset.add, value: ""}; openInlineAdd(add.dataset.add, ""); return; }
  var colorDot = e.target.closest("[data-col-color]");
  if(colorDot){ openColColorPop(colorDot, colorDot.dataset.colColor); return; }
  var rename = e.target.closest("[data-col-rename]");
  if(rename){ startColRename(rename, rename.dataset.colRename); return; }
  var sc = e.target.closest("[data-scope]");
  if(sc){
    state.doneScope = (state.doneScope === "week") ? "all" : "week";
    saveViewState();
    loadBoard({animate:true}).then(function(){
      toast(state.doneScope === "week" ? "已完成列：仅显示本周" : "已完成列：显示全部记录");
    });
    return;
  }
  var more = e.target.closest("[data-more]");
  if(more){ loadMoreDone(); return; }
  var dueBtn = e.target.closest("[data-due-pop]");
  if(dueBtn){ openDuePopover(dueBtn, dueBtn.dataset.duePop); return; }
  var menuBtn = e.target.closest("[data-card-menu]");
  if(menuBtn){ openCardMenu(menuBtn, menuBtn.dataset.cardMenu); return; }
  var docBtn = e.target.closest("[data-open-reqdoc]");
  if(docBtn){ openReqDocAndJump(docBtn.dataset.openReqdoc); return; }
  var tmr = e.target.closest("[data-timer-toggle]");
  if(tmr){ toggleTaskTimer(tmr.dataset.timerToggle); return; }
  var tick = e.target.closest("[data-done-toggle]");
  if(tick){ toggleTaskDone(tick.dataset.doneToggle); return; }
  var ed = e.target.closest("[data-edit]");
  if(ed){ openTaskDrawer(null, taskById(ed.dataset.edit)); return; }
  var del = e.target.closest("[data-del]");
  if(del){ deleteTask(del.dataset.del); return; }
  var card = e.target.closest(".card");
  if(card && Date.now() > rt.suppressClickUntil) openTaskDrawer(null, taskById(card.dataset.id));
});
board.addEventListener("dblclick", function(e){
  var title = e.target.closest(".card-title");
  if(!title) return;
  var card = title.closest(".card");
  if(!card) return;
  var t = taskById(card.dataset.id);
  if(t) openTaskDrawer(null, t);
});
board.addEventListener("keydown", function(e){
  var nameEl = e.target.closest("[data-col-rename]");
  if(nameEl && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); startColRename(nameEl, nameEl.dataset.colRename); return; }
  var dot = e.target.closest("[data-col-color]");
  if(dot && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openColColorPop(dot, dot.dataset.colColor); return; }
  if(e.target.closest("button")) return;   // 卡内按钮自己处理 Enter/Space
  if(e.key === "Enter" || e.key === " "){
    var card = e.target.closest(".card");
    if(card){ e.preventDefault(); openTaskDrawer(null, taskById(card.dataset.id)); }
  }
});
function startColRename(el, colId){
  var col = colMeta(colId);
  if(!col || col.done) return;
  var old = colName(colId);
  var input = document.createElement("input");
  input.className = "col-name-edit";
  input.type = "text";
  input.maxLength = 12;
  input.value = old;
  input.setAttribute("aria-label", "列名");
  el.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function restore(){
    var span = document.createElement("span");
    span.className = "col-name";
    span.dataset.colRename = colId;
    span.setAttribute("role","button");
    span.setAttribute("tabindex","0");
    span.title = "点击改名";
    span.textContent = old;
    if(input.parentNode) input.replaceWith(span);
  }
  function commit(save){
    if(done) return;
    done = true;
    var name = input.value.trim();
    if(!save || !name || name === old){ restore(); return; }
    API.put("/api/columns/" + encodeURIComponent(colId), { name: name, color: colColorOf(colId) }).then(function(){
      toast("已更新列「" + name + "」", "fs");
      loadBoard({silent:true});
    }).catch(function(ex){
      toast(ex.message || "保存失败", "bad");
      loadBoard({silent:true});
    });
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); commit(true); }
    else if(e.key === "Escape"){ e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", function(){ commit(true); });
}
function colColorOf(colId){
  var c = colMeta(colId);
  return safeColor(c && c.color);
}
function openColColorPop(anchor, colId){
  var html = '<div class="menu-title">列颜色</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:8px">';
  PALETTE.forEach(function(c){
    html += '<button type="button" data-colpick="' + c + '" title="' + c + '" aria-label="选择颜色 ' + c +
      '" style="width:26px;height:26px;border-radius:8px;border:1px solid rgba(16,24,40,.12);background:' + c + '"></button>';
  });
  html += '</div><div class="row row-gap" style="margin-top:10px">' +
    '<input type="color" value="' + esc(colColorOf(colId)) + '" data-colpick-custom aria-label="自定义颜色" />' +
    '<span class="foot-note">自定义颜色</span></div></div>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-colpick]");
    if(!b) return;
    UI.closeAllPops();
    saveColColor(colId, b.dataset.colpick);
  });
  el.addEventListener("change", function(e){
    if(e.target.matches("[data-colpick-custom]")){
      UI.closeAllPops();
      saveColColor(colId, e.target.value);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
function saveColColor(colId, color){
  var col = colMeta(colId);
  if(!col) return;
  API.put("/api/columns/" + encodeURIComponent(colId), { name: col.name, color: color }).then(function(){
    toast("已更新列颜色", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
}

window.addEventListener("ds:layout", function(){
  if(!state.board) return;
  /* 看板没有 enter 回调：断点时不在看板也要置脏，否则切回来仍是旧档位的 DOM */
  if(activeView === "board") render({animate:false});
  else rt.boardDirty = true;
});

export { cancelDrag, cardHTML, drag, loadBoard, loadReqs, openInlineAdd, pending, refreshBoardPreserving, render, showBoardSkeleton };
