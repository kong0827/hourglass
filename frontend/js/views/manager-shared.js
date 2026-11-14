/* views/manager-shared · 管理组共享格式化、下钻与导出 */

import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc } from "../core/ui.js";
import { triggerDownload } from "../lib/download.js";
import { avatarHTML, colName, fmtMinutesShort, typeBadgeHTML } from "../lib/format.js";

/* 口径说明默认收起，避免每条管理视图顶部都出现一整块提示条 */
function caliberHTML(text){
  return '<details class="manager-caliber"><summary>口径说明</summary><div>' + text + '</div></details>';
}
function fmtHours(minutes){
  var n = Number(minutes) || 0;
  var h = n / 60;
  return (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : h.toFixed(1)) + "h";
}
function fmtDate(value){
  if(!value) return "—";
  var s = String(value);
  var m = s.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? (Number(m[1]) + "-" + m[2]) : s.substring(0, 10);
}
function daysBetween(from, to){
  if(!from || !to) return 0;
  function utc(v){
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }
  var diff = Math.round((utc(to) - utc(from)) / 86400000);
  return isNaN(diff) ? 0 : Math.max(0, diff);
}
function taskStatusName(t){
  return t.boardColumn === "done" ? "已完成" : colName(t.boardColumn);
}
function loadBarHTML(pct){
  var n = Number(pct) || 0;
  var cls = n > 100 ? "over" : (n >= 85 ? "hot" : "");
  return '<span class="manager-load ' + cls + '"><span class="progress"><i style="width:' + Math.max(0, Math.min(100, n)) + '%"></i></span><b>' + n + '%</b></span>';
}
function csvCell(value){
  var s = value === null || value === undefined ? "" : String(value);
  if(typeof value === "string" && /^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadCsv(filename, rows){
  var csv = "\uFEFF" + rows.map(function(row){ return row.map(csvCell).join(","); }).join("\r\n");
  triggerDownload(filename, csv, "text/csv;charset=utf-8;");
}
function managerTaskRowHTML(t, split){
  var splitCells = split
    ? '<td class="num">' + (t.devMinutes ? fmtMinutesShort(t.devMinutes) : "—") + '</td>'
      + '<td class="num">' + (t.testMinutes ? fmtMinutesShort(t.testMinutes) : "—") + '</td>'
    : "";
  return '<tr data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
    + '<td><div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</div></td>'
    + '<td>' + esc(t.reqName || "未归类") + '</td>'
    + '<td><span class="manager-person">' + avatarHTML(t.owner || "未", "sm") + esc(t.owner || "未指派") + '</span></td>'
    + '<td>' + esc(taskStatusName(t)) + '</td>'
    + '<td class="num">' + esc(fmtDate(t.dueDate)) + '</td>'
    + '<td class="num">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
    + '<td class="num">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td>'
    + splitCells + '</tr>';
}
/* pager（可选）：{total, hasMore, fetch(offset) -> Promise<page>}，用于服务端分页的钻取表 */
function openTaskTable(title, tasks, description, pager, opts){
  var split = !!(opts && opts.split);
  var cols = split ? 9 : 7;
  var all = (tasks || []).slice();
  var total = pager && typeof pager.total === "number" ? pager.total : all.length;
  var hasMore = !!(pager && pager.hasMore && pager.fetch);
  var loading = false;
  var filterText = "";
  var filtered = all.slice();
  var searchTimer = null;
  var searchable = !pager; /* 服务端分页时数据不完整，不提供前端搜索，避免误导 */
  function matchesFilter(t){
    if(!filterText.trim()) return true;
    var terms = filterText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var hay = [
      String(t.title || ""),
      String(t.owner || ""),
      String(t.reqName || t.reqId || ""),
      String(taskStatusName(t))
    ].join(" ").toLowerCase();
    return terms.every(function(term){ return hay.indexOf(term) !== -1; });
  }
  function applyFilter(){
    filtered = all.filter(matchesFilter);
  }
  function descText(){
    var base = description || ("共 " + total + " 项 · 点击工作项行打开详情");
    if(searchable && filterText.trim()) base += " · 搜索匹配 " + filtered.length + " 项";
    return base;
  }
  function rowsHTML(){
    if(!filtered.length) return '<tr><td colspan="' + cols + '" class="manager-empty-cell">' +
      (filterText.trim() ? "没有匹配的工作项" : "该口径下暂无工作项") + '</td></tr>';
    return filtered.map(function(t){ return managerTaskRowHTML(t, split); }).join("")
      + (hasMore
        ? '<tr><td colspan="' + cols + '" class="manager-more-cell"><button class="btn sm block" type="button" data-manager-more'
          + (loading ? ' disabled' : '') + '>'
          + (loading ? '加载中…' : '加载更多（已加载 ' + all.length + ' / 共 ' + total + ' 项）')
          + '</button></td></tr>'
        : "");
  }
  function renderBody(){
    if(tbody) tbody.innerHTML = rowsHTML();
    var desc = layer && layer.querySelector(".desc");
    if(desc) desc.textContent = descText();
  }
  var searchBarHTML = searchable
    ? '<div class="manager-search-bar"><input type="search" class="manager-search" placeholder="搜索工作项、负责人、项目或状态…" aria-label="搜索工作项" /></div>'
    : "";
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet manager-drill-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(title) + '</h2><div class="desc">' + esc(descText()) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-manager-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + searchBarHTML
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + '<th>工作项</th><th>项目</th><th>负责人</th><th>状态</th><th class="num">截止</th><th class="num">预估</th><th class="num">实际</th>'
    + (split ? '<th class="num">开发</th><th class="num">测试</th>' : '')
    + '</tr></thead><tbody>' + rowsHTML() + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  var tbody = layer.querySelector("tbody");
  var searchInput = layer.querySelector(".manager-search");
  if(searchInput){
    searchInput.addEventListener("input", function(){
      filterText = searchInput.value;
      if(searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function(){
        searchTimer = null;
        applyFilter();
        renderBody();
      }, 200);
    });
  }
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-manager-close]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-manager-more]")){
      if(loading || !hasMore) return;
      loading = true;
      renderBody();
      pager.fetch(all.length).then(function(page){
        loading = false;
        if(!layer.isConnected) return;
        var known = {};
        all.forEach(function(t){ known[t.id] = 1; });
        var rows = ((page && page.items) || []).filter(function(t){ return !known[t.id]; });
        all = all.concat(rows);
        if(page && typeof page.total === "number") total = page.total;
        hasMore = !!(page && page.hasMore) && rows.length > 0;
        applyFilter();
        renderBody();
      }).catch(function(ex){
        loading = false;
        if(!layer.isConnected) return;
        renderBody();
        UI.toast(ex && ex.message ? ex.message : "加载更多失败", "bad");
      });
      return;
    }
    var row = e.target.closest("[data-open-task]");
    if(row){ openTaskById(row.dataset.openTask); }
  });
  UI.openModal(layer);
}

/* 计时明细（成员负载 / 周回顾共用）：有 taskId 的记录行可进工作项详情。
   pager（可选）：{total, hasMore, fetch(offset) -> Promise<page>}，服务端分页时追加加载 */
function openLogTable(title, logs, description, opts){
  var list = (logs || []).slice();
  var showMember = !!(opts && opts.showMember);
  var pager = opts && opts.pager;
  var total = pager && typeof pager.total === "number" ? pager.total : list.length;
  var hasMore = !!(pager && pager.hasMore && pager.fetch);
  var loading = false;
  var totalMinutes = 0;
  list.forEach(function(l){ totalMinutes += Number(l.minutes) || 0; });
  var cols = showMember ? 5 : 4;
  function rowsHTML(){
    if(!list.length) return '<tr><td colspan="' + cols + '" class="manager-empty-cell">该时段暂无计时记录</td></tr>';
    return list.map(function(l){
      var attrs = l.taskId ? ' data-open-task="' + esc(l.taskId) + '" title="打开工作项详情"' : "";
      var origin = l.origin === "manual" ? ' <span class="tag tag-ghost">补记</span>' : "";
      return '<tr' + attrs + '><td class="num">' + esc(fmtDate(l.date)) + '</td>'
        + (showMember ? '<td>' + esc(l.member || l.userId || "—") + '</td>' : '')
        + '<td><div class="manager-task-title">' + esc(l.title || "未关联工作项") + origin + '</div></td>'
        + '<td>' + esc(l.reqName || "未归类") + '</td>'
        + '<td class="num">' + fmtHours(l.minutes) + '</td></tr>';
    }).join("")
      + (hasMore
        ? '<tr><td colspan="' + cols + '" class="manager-more-cell"><button class="btn sm block" type="button" data-manager-more'
          + (loading ? ' disabled' : '') + '>'
          + (loading ? '加载中…' : '加载更多（已加载 ' + list.length + ' / 共 ' + total + ' 条）')
          + '</button></td></tr>'
        : "");
  }
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet manager-drill-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(title) + '</h2><div class="desc">' + esc(description || ("共 " + total + " 条 · 合计 " + fmtMinutesShort(totalMinutes) + " · 点击记录行打开工作项")) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-manager-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + '<th class="num">日期</th>' + (showMember ? '<th>成员</th>' : '')
    + '<th>工作项</th><th>项目</th><th class="num">耗时</th>'
    + '</tr></thead><tbody>' + rowsHTML() + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  var tbody = layer.querySelector("tbody");
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-manager-close]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-manager-more]")){
      if(loading || !hasMore) return;
      loading = true;
      tbody.innerHTML = rowsHTML();
      pager.fetch(list.length).then(function(page){
        loading = false;
        if(!layer.isConnected) return;
        var known = {};
        list.forEach(function(l){ known[l.id] = 1; });
        var rows = ((page && page.items) || []).filter(function(l){ return !known[l.id]; });
        list = list.concat(rows);
        if(page && typeof page.total === "number") total = page.total;
        hasMore = !!(page && page.hasMore) && rows.length > 0;
        tbody.innerHTML = rowsHTML();
      }).catch(function(ex){
        loading = false;
        if(!layer.isConnected) return;
        tbody.innerHTML = rowsHTML();
        UI.toast(ex && ex.message ? ex.message : "加载更多失败", "bad");
      });
      return;
    }
    var row = e.target.closest("[data-open-task]");
    if(row){ openTaskById(row.dataset.openTask); }
  });
  UI.openModal(layer);
}

export { caliberHTML, daysBetween, downloadCsv, fmtDate, fmtHours, loadBarHTML, openLogTable, openTaskTable, taskStatusName };
