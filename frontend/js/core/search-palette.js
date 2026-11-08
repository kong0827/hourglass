/* core/search-palette · 全局搜索（Cmd/Ctrl+K）：项目 / 工作项 / 文档 / 需求 / 用例一次聚合 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { showView } from "./router.js";
import { rt } from "./state.js";
import { openTaskById } from "./task-actions.js";
import { UI, esc, toast } from "./ui.js";

var TYPE_META = {
  project: { label: "项目", icon: "项" },
  task:    { label: "工作项", icon: "任" },
  doc:     { label: "文档", icon: "文" },
  demand:  { label: "需求", icon: "需" },
  case:    { label: "用例", icon: "测" }
};
var DOC_TYPE = { requirement: "需求文档", technical: "技术方案", acceptance: "测试验收" };
var DEMAND_STATUS = { review: "待评审", pass: "已通过", plan: "已排期", rej: "已拒绝" };
var CASE_STATUS = { passed: "通过", failed: "失败", blocked: "阻塞" };
var PROJECT_STATUS = { active: "进行中", done: "已完成", hold: "已搁置" };

var inputEl, resultsEl;
var timer = null;
var seq = 0;
var hits = [];
var active = -1;

function metaText(h){
  var parts = [];
  if(h.reqName) parts.push(h.reqName);
  if(h.type === "doc" && h.extra) parts.push(DOC_TYPE[h.extra] || h.extra);
  if(h.type === "case" && h.extra) parts.push(h.extra);
  if(h.type === "task" && h.extra) parts.push(h.extra);
  if(h.type === "demand" && h.extra) parts.push(h.extra);
  if(h.type === "project") parts.push(PROJECT_STATUS[h.status] || "项目");
  if(h.type === "demand") parts.push(DEMAND_STATUS[h.status] || "");
  if(h.type === "case") parts.push(CASE_STATUS[h.status] || "未执行");
  if(h.type === "doc") parts.push(h.status === "published" ? "已发布" : "草稿");
  return parts.filter(Boolean).join(" · ");
}

function emptyHint(){
  return '<div class="palette-empty">输入关键词，搜索项目、工作项、文档、需求与测试用例</div>';
}

function render(){
  if(!hits.length){
    resultsEl.innerHTML = '<div class="palette-empty">没有找到匹配内容，换个关键词试试</div>';
    active = -1;
    return;
  }
  var html = "";
  var lastType = "";
  hits.forEach(function(h, i){
    if(h.type !== lastType){
      lastType = h.type;
      var meta = TYPE_META[h.type] || { label: "结果", icon: "•" };
      html += '<div class="palette-group">' + meta.label + '</div>';
    }
    var m = TYPE_META[h.type] || { label: "结果", icon: "•" };
    html += '<button class="palette-item' + (i === active ? " on" : "") + '" type="button" role="option"'
      + ' aria-selected="' + (i === active ? "true" : "false") + '" data-hit="' + i + '">'
      + '<span class="palette-ic">' + m.icon + '</span>'
      + '<span class="palette-body"><span class="palette-title">' + esc(h.title || "未命名") + '</span>'
      + '<span class="palette-meta">' + esc(metaText(h)) + '</span></span>'
      + '</button>';
  });
  resultsEl.innerHTML = html;
}

function move(delta){
  if(!hits.length) return;
  active = (active + delta + hits.length) % hits.length;
  render();
  var on = resultsEl.querySelector(".palette-item.on");
  if(on) on.scrollIntoView({ block: "nearest" });
}

function query(value){
  var kw = String(value || "").trim();
  if(!kw){
    hits = [];
    active = -1;
    resultsEl.innerHTML = emptyHint();
    return;
  }
  var my = ++seq;
  resultsEl.innerHTML = '<div class="palette-empty">搜索中…</div>';
  API.get("/api/search", { q: kw, limit: 6 }).then(function(rows){
    if(my !== seq) return;
    hits = rows || [];
    active = hits.length ? 0 : -1;
    render();
  }).catch(function(ex){
    if(my !== seq) return;
    resultsEl.innerHTML = '<div class="palette-empty">' + esc(ex.message || "搜索失败，请稍后重试") + '</div>';
  });
}

function open(){
  var m = $("dlgSearch");
  if(!m) return;
  inputEl.value = "";
  hits = [];
  active = -1;
  resultsEl.innerHTML = emptyHint();
  UI.openModal(m, "#paletteInput");
  setTimeout(function(){ try{ inputEl.focus(); }catch(e){ /* noop */ } }, 30);
}

function close(){
  var m = $("dlgSearch");
  if(m) UI.closeModal(m);
}

function openHit(h){
  if(!h) return;
  close();
  if(h.type === "task"){
    openTaskById(h.id);
    return;
  }
  if(h.type === "project"){
    rt.managerProjectId = h.id;
    showView("project");
    return;
  }
  if(h.type === "doc"){
    import("../views/requirements.js").then(function(mod){ mod.openReqDocAndJump(h.id); });
    return;
  }
  if(h.type === "demand"){
    showView("demands").then(function(){
      if(window.location.hash.indexOf("demands") < 0) return;
      import("../views/demands.js").then(function(mod){ mod.openDemandById(h.id); });
    });
    return;
  }
  if(h.type === "case"){
    showView("testcases").then(function(){
      import("../views/testcases.js").then(function(mod){ mod.openCaseInProject(h.reqId, h.id); });
    });
  }
}

function init(){
  inputEl = $("paletteInput");
  resultsEl = $("paletteResults");
  if(!inputEl || !resultsEl) return;

  inputEl.addEventListener("input", function(){
    if(timer) clearTimeout(timer);
    var value = inputEl.value;
    timer = setTimeout(function(){ query(value); }, 220);
  });
  inputEl.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "ArrowDown"){ e.preventDefault(); move(1); return; }
    if(e.key === "ArrowUp"){ e.preventDefault(); move(-1); return; }
    if(e.key === "Enter"){
      e.preventDefault();
      if(active >= 0 && hits[active]) openHit(hits[active]);
      return;
    }
    if(e.key === "Escape"){ e.preventDefault(); close(); }
  });
  resultsEl.addEventListener("click", function(e){
    var btn = e.target.closest("[data-hit]");
    if(!btn) return;
    var hit = hits[Number(btn.dataset.hit)];
    openHit(hit);
  });
  resultsEl.addEventListener("mousemove", function(e){
    var btn = e.target.closest("[data-hit]");
    if(!btn) return;
    var idx = Number(btn.dataset.hit);
    if(idx === active) return;
    active = idx;
    resultsEl.querySelectorAll(".palette-item").forEach(function(el){
      var on = Number(el.dataset.hit) === active;
      el.classList.toggle("on", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
  });
}

export { init, open as openSearchPalette };
