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
function openTaskTable(title, tasks, description){
  var rows = (tasks || []).map(function(t){
    return '<tr data-open-task="' + esc(t.id) + '" title="打开工作项详情">'
      + '<td><div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</div></td>'
      + '<td>' + esc(t.reqName || "未归类") + '</td>'
      + '<td><span class="manager-person">' + avatarHTML(t.owner || "未", "sm") + esc(t.owner || "未指派") + '</span></td>'
      + '<td>' + esc(taskStatusName(t)) + '</td>'
      + '<td class="num">' + esc(fmtDate(t.dueDate)) + '</td>'
      + '<td class="num">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
      + '<td class="num">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td></tr>';
  }).join("") || '<tr><td colspan="7" class="manager-empty-cell">该口径下暂无工作项</td></tr>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet manager-drill-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>' + esc(title) + '</h2><div class="desc">' + esc(description || ("共 " + (tasks || []).length + " 项 · 点击工作项行打开详情")) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-manager-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + '<th>工作项</th><th>项目</th><th>负责人</th><th>状态</th><th class="num">截止</th><th class="num">预估</th><th class="num">实际</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-manager-close]")){ UI.closeModal(layer); return; }
    var row = e.target.closest("[data-open-task]");
    if(row){ UI.closeModal(layer); openTaskById(row.dataset.openTask); }
  });
  UI.openModal(layer);
}

export { caliberHTML, daysBetween, downloadCsv, fmtDate, fmtHours, loadBarHTML, openTaskTable, taskStatusName };
