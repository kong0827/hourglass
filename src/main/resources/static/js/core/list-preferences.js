/* core/list-preferences · 列表视图与显示列偏好 */

import { API } from "./api.js";
import { rt } from "./state.js";
import { UI, esc, toast } from "./ui.js";

var DEFS = {
  "task-list": {
    mode: "table",
    modes: ["table"],
    required: "title",
    labels: { title:"任务", type:"类型", column:"看板列", priority:"优先级", owner:"负责人", dueDate:"截止日期", progress:"进度", project:"项目", version:"影响版本", category:"分类", startDate:"开始日期", tags:"标签", subtasks:"子任务", work:"工时", comments:"评论", updatedAt:"更新时间" },
    defaults: ["title","type","column","priority","owner","dueDate","progress","project","version"]
  },
  "project-list": {
    mode: "card",
    modes: ["card", "table"],
    required: "name",
    labels: { name:"项目名称", status:"状态", description:"描述", taskCount:"工作项数", doneCount:"完成数", progress:"进度", docCount:"文档数", firstReleasedAt:"首版上线日", createdAt:"创建时间", updatedAt:"更新时间" },
    defaults: ["name","status","taskCount","doneCount","progress","docCount","firstReleasedAt"]
  },
  "portfolio": {
    mode: "card",
    modes: ["card", "table"],
    required: "name",
    labels: { name:"项目", status:"状态", health:"健康度", total:"总任务", backlog:"待处理", doing:"进行中", done:"已完成", overdue:"逾期", blocked:"阻塞", progress:"完成率", weekCompleted:"本周完成", weekWorkMinutes:"本周工时", members:"成员" },
    defaults: ["name","status","health","total","backlog","doing","done","overdue","progress"]
  },
  "project-view": {
    mode: "board",
    modes: ["board", "drill"],
    required: "name",
    labels: { name:"名称", status:"状态", health:"健康度", total:"总任务", backlog:"待处理", doing:"进行中", done:"已完成", overdue:"逾期", progress:"进度", owner:"负责人", dueDate:"截止", estimate:"预估", actual:"实际" },
    defaults: ["name","status","health","backlog","doing","done","overdue","progress"]
  },
  "demand-pool": {
    mode: "board",
    modes: ["board", "table"],
    required: "title",
    labels: { title:"需求", kind:"类型", priority:"优先级", status:"状态", project:"项目", version:"目标版本", expectDate:"期望交付", wsjf:"WSJF", source:"来源", createdAt:"提交时间" },
    defaults: ["title","kind","priority","status","project","version","expectDate","wsjf"]
  }
};
var cache = {};
var pending = {};
function wsKey(viewKey){ return ((rt.currentWs && rt.currentWs.id) || "none") + ":" + viewKey; }
function defaults(viewKey){ return DEFS[viewKey].defaults.slice(); }
function sanitize(viewKey, columns){
  var def = DEFS[viewKey], out = [];
  (Array.isArray(columns) ? columns : []).forEach(function(key){
    if(def.labels[key] && out.indexOf(key) === -1) out.push(key);
  });
  out = out.filter(function(key){ return key !== def.required; });
  out.unshift(def.required);
  return out;
}
function stateFor(viewKey){
  var key = wsKey(viewKey);
  if(!cache[key]) cache[key] = { viewMode: DEFS[viewKey].mode, columns: defaults(viewKey) };
  return cache[key];
}
function load(viewKey){
  var key = wsKey(viewKey);
  if(pending[key]) return pending[key];
  if(cache[key] && cache[key].loaded) return Promise.resolve(cache[key]);
  pending[key] = API.get("/api/list-preferences/" + viewKey).then(function(d){
    var current = stateFor(viewKey);
    if(d && Array.isArray(d.columns) && d.columns.length) current.columns = sanitize(viewKey, d.columns);
    if(d && DEFS[viewKey].modes.indexOf(d.viewMode) !== -1) current.viewMode = d.viewMode;
    current.loaded = true;
    delete pending[key];
    return current;
  }).catch(function(ex){
    delete pending[key];
    return stateFor(viewKey);
  });
  return pending[key];
}
function columns(viewKey){ return stateFor(viewKey).columns.slice(); }
function viewMode(viewKey){ return stateFor(viewKey).viewMode; }
function labels(viewKey){ return DEFS[viewKey].labels; }
function save(viewKey, next){
  var key = wsKey(viewKey);
  var old = cache[key];
  cache[key] = { viewMode: next.viewMode, columns: sanitize(viewKey, next.columns), loaded: true };
  return API.put("/api/list-preferences/" + viewKey, { viewMode: next.viewMode, columns: cache[key].columns }).then(function(d){
    if(d && Array.isArray(d.columns)) cache[key].columns = sanitize(viewKey, d.columns);
    return cache[key];
  }).catch(function(ex){
    if(old) cache[key] = old;
    throw ex;
  });
}
function setViewMode(viewKey, mode){
  var key = wsKey(viewKey);
  var ready = pending[key] || Promise.resolve(stateFor(viewKey));
  return ready.then(function(current){
    return save(viewKey, { viewMode: mode, columns: current.columns });
  });
}
function openColumnSettings(viewKey, onChange){
  var key = wsKey(viewKey);
  if(pending[key]){
    pending[key].then(function(){ openColumnSettings(viewKey, onChange); });
    return;
  }
  var def = DEFS[viewKey], current = stateFor(viewKey);
  var draft = current.columns.slice();
  var layer = document.createElement("div");
  layer.className = "modal-layer column-pref-modal";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "显示字段设置");
  layer.innerHTML = '<div class="sheet sm"><div class="sheet-body">' +
    '<div class="panel-head"><h3>显示字段</h3><button class="icon-btn sm" type="button" data-pref-close aria-label="关闭">×</button></div>' +
    '<p class="set-hint">勾选要展示的字段，用上下按钮调整顺序；保存后跨设备生效。</p>' +
    '<div class="column-pref-list"></div>' +
    '<div class="set-actions"><button class="btn" type="button" data-pref-reset>恢复默认</button><span class="spacer"></span><button class="btn primary" type="button" data-pref-save>保存</button></div>' +
    '</div></div>';
  document.body.appendChild(layer);
  function close(){ UI.closeModal(layer); setTimeout(function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); }, 180); }
  function renderRows(){
    var list = layer.querySelector(".column-pref-list");
    list.innerHTML = draft.map(function(key, i){
      var required = key === def.required;
      return '<div class="column-pref-row" data-pref-key="' + esc(key) + '">' +
        '<label><input type="checkbox" data-pref-toggle ' + (required ? 'checked disabled' : 'checked') + ' /> <span>' + esc(def.labels[key]) + '</span></label>' +
        '<span class="column-pref-order"><button class="icon-btn sm" type="button" data-pref-up aria-label="上移" ' + ((i === 0 || required) ? "disabled" : "") + '>↑</button>' +
        '<button class="icon-btn sm" type="button" data-pref-down aria-label="下移" ' + (i === draft.length - 1 ? "disabled" : "") + '>↓</button></span></div>';
    }).join("");
    var hidden = Object.keys(def.labels).filter(function(key){ return draft.indexOf(key) === -1; });
    if(hidden.length){
      list.innerHTML += '<div class="column-pref-sep">未显示</div>' + hidden.map(function(key){
        return '<div class="column-pref-row muted" data-pref-key="' + esc(key) + '"><label><input type="checkbox" data-pref-toggle /> <span>' + esc(def.labels[key]) + '</span></label></div>';
      }).join("");
    }
  }
  renderRows();
  layer.addEventListener("change", function(e){
    var row = e.target.closest("[data-pref-key]");
    if(!row || !e.target.matches("[data-pref-toggle]")) return;
    var key = row.dataset.prefKey;
    if(e.target.checked){ if(draft.indexOf(key) === -1) draft.push(key); }
    else draft = draft.filter(function(k){ return k !== key; });
    renderRows();
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-pref-close]")){ close(); return; }
    if(e.target.closest("[data-pref-reset]")){ draft = defaults(viewKey); renderRows(); return; }
    var row = e.target.closest("[data-pref-key]");
    if(row){
      var key = row.dataset.prefKey, i = draft.indexOf(key), to = -1;
      if(e.target.closest("[data-pref-up]")) to = i - 1;
      if(e.target.closest("[data-pref-down]")) to = i + 1;
      if(i > 0 && to > 0 && to < draft.length){
        draft.splice(i, 1); draft.splice(to, 0, key); renderRows();
      }
      return;
    }
    var saveBtn = e.target.closest("[data-pref-save]");
    if(saveBtn){
      saveBtn.disabled = true;
      save(viewKey, { viewMode: current.viewMode, columns: draft }).then(function(){
        saveBtn.disabled = false;
        close();
        toast("显示字段已保存", "fs");
        if(onChange) onChange();
      }).catch(function(ex){
        saveBtn.disabled = false;
        toast(ex.message || "保存失败", "bad");
      });
    }
  });
  UI.openModal(layer);
}

export { columns, labels, load, openColumnSettings, setViewMode, viewMode };
