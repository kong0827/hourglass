/* core/activity-ui · 通用活动时间线 */

import { API } from "./api.js";
import { UI, esc } from "./ui.js";
import { fmtTs } from "../lib/format.js";

function activityHTML(logs){
  if(!logs || !logs.length) return '<div class="tl-empty">暂无活动记录</div>';
  return logs.map(function(l){
    return '<div class="activity-item"><span class="activity-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
      '<span class="activity-detail">' + (l.actorName ? '<b>' + esc(l.actorName) + '</b> · ' : '') + esc(l.detail || l.action || "") + '</span></div>';
  }).join("");
}
function loadInto(el, path){
  if(!el) return Promise.resolve([]);
  var seq = String((Number(el.dataset.activitySeq) || 0) + 1);
  el.dataset.activitySeq = seq;
  el.innerHTML = '<div class="tl-empty">加载中…</div>';
  return API.getAllPages(path).then(function(logs){
    if(el.dataset.activitySeq === seq) el.innerHTML = activityHTML(logs);
    return logs;
  }).catch(function(){
    if(el.dataset.activitySeq === seq) el.innerHTML = '<div class="tl-empty">活动记录加载失败</div>';
    return [];
  });
}
function openDialog(title, path){
  var layer = document.createElement("div");
  layer.className = "modal-layer activity-modal";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", title + "活动轨迹");
  layer.innerHTML = '<div class="sheet"><div class="sheet-body"><div class="panel-head"><h3>' + esc(title) + ' · 活动轨迹</h3>' +
    '<button class="icon-btn sm" type="button" data-activity-close aria-label="关闭">×</button></div>' +
    '<div class="activity-list"></div></div></div>';
  document.body.appendChild(layer);
  function close(){ UI.closeModal(layer); setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 180); }
  layer.querySelector("[data-activity-close]").addEventListener("click", close);
  loadInto(layer.querySelector(".activity-list"), path);
  UI.openModal(layer);
}

export { activityHTML, loadInto, openDialog };
