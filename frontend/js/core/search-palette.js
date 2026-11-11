/* core/search-palette · 全局搜索（Cmd/Ctrl+K）：项目 / 分支 / 工作项 / 文档 / 需求 / 用例一次聚合 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { showView } from "./router.js";
import { rt } from "./state.js";
import { openTaskById } from "./task-actions.js";
import { UI, esc, toast } from "./ui.js";

var TYPE_META = {
  project: { label: "项目", icon: "项" },
  branch:  { label: "分支", icon: "分" },
  task:    { label: "工作项", icon: "任" },
  doc:     { label: "文档", icon: "文" },
  demand:  { label: "需求", icon: "需" },
  case:    { label: "用例", icon: "测" }
};
var TYPE_ORDER = { project:0, branch:1, task:2, doc:3, demand:4, case:5 };
var BRANCH_STATUS = { dev:"开发中", testing:"待测试", merging:"待合并", released:"已发布" };
var DOC_TYPE = { requirement: "需求文档", technical: "技术方案", acceptance: "测试验收" };
var DEMAND_STATUS = { review: "待评审", pass: "已通过", plan: "已排期", rej: "已拒绝" };
var CASE_STATUS = { passed: "通过", failed: "失败", blocked: "阻塞" };
var PROJECT_STATUS = { active: "进行中", done: "已完成", hold: "已搁置" };

var inputEl, resultsEl, scopeEl;
var timer = null;
var seq = 0;
var hits = [];
var active = -1;
var recent = [];
var RECENT_MAX = 5;

function wsId(){ return (rt.currentWs && rt.currentWs.id) || "none"; }
function userId(){ return (rt.currentUser && rt.currentUser.id) || "anon"; }
function wsName(){ return (rt.currentWs && rt.currentWs.name) || ""; }
/* 最近搜索必须按账号隔离：同一浏览器切换账号后不能看到上一个人的搜索历史 */
function recentKey(){ return "ds.search.recent:" + userId() + ":" + wsId(); }

function loadRecent(){
  recent = [];
  try{
    /* 旧 key 只按空间存，可能泄露其他账号的搜索历史，升级后清掉 */
    localStorage.removeItem("ds.search.recent:" + wsId());
    var raw = localStorage.getItem(recentKey());
    var rows = raw ? JSON.parse(raw) : [];
    if(Array.isArray(rows)) recent = rows.filter(function(x){ return x && x.q; }).slice(0, RECENT_MAX);
  }catch(e){ recent = []; }
}
function saveRecent(){
  try{ localStorage.setItem(recentKey(), JSON.stringify(recent)); }catch(e){ /* 存不下就不记 */ }
}
function remember(q, h){
  q = String(q || "").trim();
  if(!q) return;
  var meta = TYPE_META[h.type] ? TYPE_META[h.type].label : "结果";
  if(h.title) meta += " · " + h.title;
  recent = recent.filter(function(x){ return x.q !== q; });
  recent.unshift({ q: q, meta: meta });
  if(recent.length > RECENT_MAX) recent = recent.slice(0, RECENT_MAX);
  saveRecent();
}

function branchMeta(h){
  var parts = [BRANCH_STATUS[h.status] || "分支"];
  var v = h.versionName || (h.versions && h.versions[0] && h.versions[0].name) || "";
  if(v) parts.push(v);
  if(h.owner) parts.push(h.owner);
  return parts.join(" · ");
}

function metaText(h){
  if(h.type === "branch") return branchMeta(h);
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

function scopeMessage(){
  var name = wsName();
  return name
    ? "只在「" + name + "」内搜索；切换空间后在对应空间内查找"
    : "只在当前空间内搜索；切换空间后在对应空间内查找";
}

function idleHTML(){
  var html = "";
  if(recent.length){
    html += '<div class="palette-recent-head"><span>最近搜索</span>'
      + '<button type="button" class="palette-clear" data-recent-clear>清除</button></div>';
    recent.forEach(function(r, i){
      html += '<button class="palette-recent" type="button" data-recent="' + i + '">'
        + '<span class="palette-recent-ic" aria-hidden="true">'
        + '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><path d="M10 6.4V10l2.6 1.8"/></svg>'
        + '</span>'
        + '<span class="palette-body"><span class="palette-title">' + esc(r.q) + '</span>'
        + '<span class="palette-meta">' + esc(r.meta || "搜索") + '</span></span>'
        + '</button>';
    });
  }else{
    html += '<div class="palette-empty">输入关键词，搜索项目、分支、工作项、文档、需求与测试用例</div>';
  }
  html += '<div class="palette-scope-note">' + esc(scopeMessage()) + '</div>';
  return html;
}

function renderIdle(){
  active = -1;
  resultsEl.innerHTML = idleHTML();
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
      var gm = TYPE_META[h.type] || { label: "结果", icon: "•" };
      html += '<div class="palette-group">' + gm.label + '</div>';
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

function branchHits(kw){
  return API.get("/api/branches", { q: kw, limit: 4 }).then(function(page){
    var rows = (page && page.items) || [];
    return rows.map(function(b){
      return {
        type: "branch",
        id: b.id,
        title: b.name,
        status: b.status,
        owner: b.owner || "",
        versions: b.versions || [],
        projects: b.projects || [],
        versionName: (b.versions && b.versions[0] && b.versions[0].name) || ""
      };
    });
  });
}

function query(value){
  var kw = String(value || "").trim();
  if(!kw){
    seq++;
    hits = [];
    active = -1;
    renderIdle();
    return;
  }
  var my = ++seq;
  resultsEl.innerHTML = '<div class="palette-empty">搜索中…</div>';
  var err = null;
  var main = API.get("/api/search", { q: kw, limit: 6 }).catch(function(ex){ err = err || ex; return []; });
  var br = branchHits(kw).catch(function(ex){ err = err || ex; return []; });
  Promise.all([main, br]).then(function(res){
    if(my !== seq) return;
    var rows = (res[0] || []).concat(res[1] || []);
    if(err && !rows.length) throw err;
    rows = rows.filter(function(h){ return h && TYPE_META[h.type]; });
    rows.sort(function(a, b){
      var da = TYPE_ORDER[a.type] == null ? 9 : TYPE_ORDER[a.type];
      var db = TYPE_ORDER[b.type] == null ? 9 : TYPE_ORDER[b.type];
      return da - db;
    });
    hits = rows;
    active = hits.length ? 0 : -1;
    render();
  }).catch(function(ex){
    if(my !== seq) return;
    hits = [];
    active = -1;
    resultsEl.innerHTML = '<div class="palette-empty">' + esc(ex.message || "搜索失败，请稍后重试") + '</div>';
  });
}

function setScope(){
  if(!scopeEl) return;
  var name = wsName();
  scopeEl.textContent = name ? "仅当前空间 · " + name : "仅当前空间";
  scopeEl.title = scopeMessage();
}

function open(){
  var m = $("dlgSearch");
  if(!m) return;
  // 丢弃上次未触发的防抖与在途查询，避免旧结果覆盖重新打开后的「最近搜索」
  if(timer){ clearTimeout(timer); timer = null; }
  seq++;
  inputEl.value = "";
  hits = [];
  active = -1;
  loadRecent();
  setScope();
  renderIdle();
  UI.openModal(m, "#paletteInput");
  setTimeout(function(){ try{ inputEl.focus(); }catch(e){ /* noop */ } }, 30);
}

function close(){
  var m = $("dlgSearch");
  if(m) UI.closeModal(m);
}

function openHit(h){
  if(!h) return;
  remember(inputEl ? inputEl.value : "", h);
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
  if(h.type === "branch"){
    import("../views/branches.js").then(function(mod){ mod.openBranchById(h.id); });
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

function useRecent(i){
  var r = recent[i];
  if(!r) return;
  if(timer){ clearTimeout(timer); timer = null; }
  inputEl.value = r.q;
  try{ inputEl.focus(); }catch(e){ /* noop */ }
  query(r.q);
}

function init(){
  inputEl = $("paletteInput");
  resultsEl = $("paletteResults");
  scopeEl = $("paletteScope");
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
    var rc = e.target.closest("[data-recent-clear]");
    if(rc){
      recent = [];
      saveRecent();
      renderIdle();
      try{ inputEl.focus(); }catch(err){ /* noop */ }
      return;
    }
    var re = e.target.closest("[data-recent]");
    if(re){ useRecent(Number(re.getAttribute("data-recent"))); return; }
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
