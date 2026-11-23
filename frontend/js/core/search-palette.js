/* core/search-palette · 全局搜索（Cmd/Ctrl+K）：项目 / 分支 / 工作项 / 文档 / 需求 / 用例一次聚合 */

import { API } from "./api.js";
import { $, taskDrawer } from "./dom.js";
import { COLUMNS } from "../lib/format.js";
import { showView } from "./router.js";
import { reqSetId, rt, setNameById } from "./state.js";
import { openTaskById } from "./task-actions.js";
import { tryCloseTaskDrawer } from "./task-drawer.js";
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
var DEMAND_STATUS = { review: "待评审", pass: "已通过", plan: "已排期", done: "已完成", closed: "已关闭", rej: "已拒绝", canceled: "已取消", cancelled: "已取消" };
var CASE_STATUS = { passed: "通过", failed: "失败", blocked: "阻塞" };
var PROJECT_STATUS = { active: "进行中", done: "已完成", hold: "已搁置" };
/* 状态取值跨实体，按类型切换候选；未选类型时状态不可用，避免「已通过」被拿去筛工作项 */
var STATUS_OPTIONS = {
  project: [["active", "进行中"], ["done", "已完成"], ["hold", "已搁置"]],
  doc: [["draft", "草稿"], ["active", "进行中"], ["done", "已完成"]],
  demand: [["review", "待评审"], ["pass", "已通过"], ["plan", "已排期"], ["done", "已完成"], ["closed", "已关闭"], ["rej", "已拒绝"], ["canceled", "已取消"]],
  case: [["untested", "未执行"], ["passed", "通过"], ["failed", "失败"], ["blocked", "阻塞"], ["skipped", "跳过"]]
};

var inputEl, resultsEl, scopeEl, filtersEl;
var typeEl, projectEl, versionEl, statusEl, ownerEl, fromEl, toEl, clearBtn, saveBtn;
var timer = null;
var seq = 0;
var hits = [];
var active = -1;
var recent = [];
var saved = [];
var projects = [];
var versions = [];
var members = [];
var optionsWs = "";
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

/* ---------- 结构化范围 ---------- */
function filtersFromEls(){
  return {
    type: typeEl ? typeEl.value : "",
    reqId: projectEl ? projectEl.value : "",
    versionId: versionEl ? versionEl.value : "",
    status: statusEl ? statusEl.value : "",
    owner: ownerEl ? ownerEl.value : "",
    from: fromEl ? fromEl.value : "",
    to: toEl ? toEl.value : ""
  };
}
function hasScope(f){
  f = f || filtersFromEls();
  return !!(f.type || f.reqId || f.versionId || f.status || f.owner || f.from || f.to);
}
function queryParams(q){
  var f = filtersFromEls();
  var p = { q: q, limit: 6 };
  ["type", "reqId", "versionId", "status", "owner", "from", "to"].forEach(function(k){
    if(f[k]) p[k] = f[k];
  });
  return p;
}
function fillSelect(sel, rows, placeholder, keep){
  if(!sel) return;
  var html = '<option value="">' + esc(placeholder) + '</option>' + rows.map(function(o){
    return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
  }).join("");
  sel.innerHTML = html;
  if(keep && rows.some(function(o){ return o.value === keep; })) sel.value = keep;
}
function syncStatusOptions(type, keep){
  if(!statusEl) return;
  var rows = type === "task"
    ? COLUMNS.map(function(c){ return { value: c.id, label: c.name }; })
    : type ? (STATUS_OPTIONS[type] || []).map(function(o){ return { value: o[0], label: o[1] }; }) : [];
  var usable = rows.length > 0;
  statusEl.disabled = !usable;
  fillSelect(statusEl, rows, usable ? "全部状态" : (type ? "全部状态" : "先选类型"), keep);
}
/* 项目/版本/负责人候选只拉一次；项目下拉用于把「3 步内定位」缩到项目范围 */
function loadProjects(){
  return API.getAllPages("/api/reqs").then(function(list){
    projects = (list || []).filter(function(r){ return r && r.id; })
      .map(function(r){ return { value: r.id, label: r.name || r.id }; });
    fillSelect(projectEl, projects, "全部项目", projectEl ? projectEl.value : "");
  }).catch(function(){ /* 项目候选失败不挡搜索 */ });
}
function loadMembers(){
  var ws = rt.currentWs;
  members = (rt.wsMembersCache || []).slice();
  if(members.length) { paintMembers(); return Promise.resolve(); }
  if(!ws || ws.type !== "shared"){
    members = rt.currentUser ? [{ userId: rt.currentUser.id, displayName: rt.currentUser.displayName || rt.currentUser.username }] : [];
    paintMembers();
    return Promise.resolve();
  }
  return API.get("/api/workspaces/" + encodeURIComponent(ws.id) + "/members").then(function(list){
    members = list || [];
    paintMembers();
  }).catch(function(){ paintMembers(); });
}
function paintMembers(){
  fillSelect(ownerEl, members.filter(function(m){ return m && m.userId; }).map(function(m){
    return { value: m.userId, label: m.displayName || m.username || m.userId };
  }), "全部负责人", ownerEl ? ownerEl.value : "");
}
var versionSeq = 0;
function loadVersions(reqId, keep){
  var my = ++versionSeq;
  versions = [];
  if(versionEl) versionEl.disabled = true;
  fillSelect(versionEl, [], "全部版本");
  if(!reqId) return Promise.resolve();
  return API.get("/api/versions", { reqId: reqId }).then(function(list){
    if(my !== versionSeq) return;
    versions = (list || []).filter(function(v){ return v && v.id; }).map(function(v){
      return { value: v.id, label: v.name || v.id };
    });
    fillSelect(versionEl, versions, "全部版本", keep || "");
    if(versionEl) versionEl.disabled = versions.length === 0;
  }).catch(function(){ if(my === versionSeq && versionEl) versionEl.disabled = true; });
}
function ensureOptions(){
  var ws = wsId();
  if(optionsWs === ws) return Promise.resolve();
  optionsWs = ws;
  projects = [];
  versions = [];
  versionSeq++;
  fillSelect(projectEl, [], "全部项目");
  fillSelect(versionEl, [], "全部版本");
  if(versionEl) versionEl.disabled = true;
  syncStatusOptions(typeEl ? typeEl.value : "", "");
  return Promise.all([loadProjects(), loadMembers()]);
}
function updateFilterUI(){
  if(clearBtn) clearBtn.hidden = !hasScope();
  if(saveBtn) saveBtn.disabled = false;
}
function resetFilters(){
  [typeEl, projectEl, versionEl, statusEl, ownerEl, fromEl, toEl].forEach(function(el){ if(el) el.value = ""; });
  versionSeq++;
  if(versionEl) versionEl.disabled = true;
  fillSelect(versionEl, [], "全部版本");
  syncStatusOptions("", "");
  updateFilterUI();
}
function filterSummary(f){
  var parts = [];
  if(f.type && TYPE_META[f.type]) parts.push(TYPE_META[f.type].label);
  if(f.reqId){
    var p = projects.filter(function(o){ return o.value === f.reqId; })[0];
    parts.push(p ? p.label : f.reqId);
  }
  if(f.versionId){
    var v = versions.filter(function(o){ return o.value === f.versionId; })[0];
    parts.push(v ? v.label : f.versionId);
  }
  if(f.status){
    var label = "";
    var rows = f.type === "task" ? COLUMNS.map(function(c){ return [c.id, c.name]; }) : (STATUS_OPTIONS[f.type] || []);
    rows.forEach(function(o){ if(o[0] === f.status) label = o[1]; });
    parts.push(label || f.status);
  }
  if(f.owner){
    var m = members.filter(function(x){ return x.userId === f.owner; })[0];
    parts.push(m ? (m.displayName || m.username || m.userId) : f.owner);
  }
  if(f.from || f.to) parts.push((f.from || "…") + " 至 " + (f.to || "…"));
  return parts;
}

/* ---------- 保存的搜索（复用 /api/views，scope=search） ---------- */
function viewParams(v){
  var p = v && v.params;
  if(typeof p === "string"){
    try{ p = JSON.parse(p); }catch(e){ return null; }
  }
  return p && typeof p === "object" && !Array.isArray(p) ? p : null;
}
function loadSaved(){
  return API.get("/api/views").then(function(list){
    saved = (list || []).map(function(v){
      var p = viewParams(v);
      return p && p.scope === "search" ? { id: v.id, name: v.name, p: p } : null;
    }).filter(Boolean);
    if(!hits.length) renderIdle();
  }).catch(function(){ saved = []; });
}
function saveSearch(){
  var f = filtersFromEls();
  var q = inputEl ? String(inputEl.value || "").trim() : "";
  if(!q && !hasScope(f)){ toast("先输入关键词或选择筛选条件", "warn"); return; }
  var params = { scope: "search" };
  if(q) params.q = q;
  ["type", "reqId", "versionId", "status", "owner", "from", "to"].forEach(function(k){ if(f[k]) params[k] = f[k]; });
  var parts = filterSummary(f);
  var suggest = q || parts.join(" ") || "搜索";
  UI.showPrompt({
    title: "保存搜索", desc: "保存后可在「保存的搜索」里一键复用",
    label: "名称", value: suggest.slice(0, 20), maxLength: 20, required: true
  }).then(function(name){
    if(!name) return;
    API.post("/api/views", { name: name, params: JSON.stringify(params) }).then(function(){
      toast("已保存搜索「" + name + "」", "fs");
      loadSaved();
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function applySaved(item){
  if(!item || !item.p) return;
  var p = item.p;
  if(timer){ clearTimeout(timer); timer = null; }
  if(inputEl) inputEl.value = p.q || "";
  if(typeEl) typeEl.value = p.type || "";
  syncStatusOptions(typeEl ? typeEl.value : "", p.status || "");
  if(projectEl) projectEl.value = p.reqId || "";
  if(ownerEl) ownerEl.value = p.owner || "";
  if(fromEl) fromEl.value = p.from || "";
  if(toEl) toEl.value = p.to || "";
  updateFilterUI();
  /* 版本下拉是异步加载的：等候选就位再查，否则第一次查询会丢掉版本条件 */
  Promise.resolve(loadVersions(projectEl ? projectEl.value : "", p.versionId || "")).then(function(){
    updateFilterUI();
    query(p.q || "");
  });
}
function deleteSaved(id){
  if(!id) return;
  API.del("/api/views/" + encodeURIComponent(id)).then(function(){
    saved = saved.filter(function(s){ return s.id !== id; });
    toast("已删除保存的搜索", "fs");
    renderIdle();
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
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
  if(h.type === "project"){
    /* 项目命中带上项目集，跨项目同名时能分清归属 */
    return [setNameById(reqSetId(h.id)), PROJECT_STATUS[h.status] || "项目"].filter(Boolean).join(" · ");
  }
  var parts = [];
  if(h.reqName) parts.push(h.reqName);
  if(h.type === "doc" && h.extra) parts.push(DOC_TYPE[h.extra] || h.extra);
  if(h.type === "case" && h.extra) parts.push(h.extra);
  if(h.type === "task" && h.extra) parts.push(h.extra);
  if(h.type === "demand" && h.extra) parts.push(h.extra);
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

/* 文档 brief 来自 Markdown：表格片段会带出「| --- |」这类结构符号，
   摘要里只保留可读文字，分隔符换成间隔点 */
function readableSnippet(snippet){
  if(String(snippet).indexOf("|") < 0) return snippet;
  return snippet.replace(/\s*\|\s*/g, " · ")
    .replace(/(?:·\s*)?-{3,}(?:\s*·)?/g, " ")
    .replace(/(\s*·\s*)+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s{2,}/g, " ").trim();
}

/* 先分段转义再包 mark：关键词含 & < > 等字符时也不会破坏转义或注入标签 */
function snippetHTML(snippet, q){
  snippet = readableSnippet(snippet);
  var kw = String(q || "").trim();
  if(!kw) return esc(snippet);
  var lower = snippet.toLowerCase(), needle = kw.toLowerCase();
  var out = "", i = 0;
  for(;;){
    var idx = lower.indexOf(needle, i);
    if(idx < 0){ out += esc(snippet.slice(i)); break; }
    out += esc(snippet.slice(i, idx)) + "<mark>" + esc(snippet.slice(idx, idx + kw.length)) + "</mark>";
    i = idx + kw.length;
  }
  return out;
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
    html += '<div class="palette-empty">输入关键词，或先按类型 / 项目 / 状态收窄范围</div>';
  }
  if(saved.length){
    html += '<div class="palette-saved-head"><span>保存的搜索</span><span>' + saved.length + '</span></div>';
    saved.forEach(function(s, i){
      var meta = filterSummary(s.p).join(" · ");
      if(s.p.q) meta = "“" + s.p.q + "”" + (meta ? " · " + meta : "");
      html += '<div class="palette-saved">'
        + '<button class="palette-saved-open" type="button" data-saved="' + i + '">'
        + '<span class="palette-saved-ic" aria-hidden="true">'
        + '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h10v14l-5-3-5 3z"/></svg>'
        + '</span>'
        + '<span class="palette-body"><span class="palette-title">' + esc(s.name) + '</span>'
        + '<span class="palette-meta">' + esc(meta || "全部内容") + '</span></span>'
        + '</button>'
        + '<button class="palette-saved-del" type="button" data-saved-del="' + i + '" title="删除「' + esc(s.name) + '」" aria-label="删除保存的搜索">×</button>'
        + '</div>';
    });
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
      + '<span class="palette-meta">' + esc(metaText(h)) + '</span>'
      + (h.type === "doc" && h.snippet ? '<span class="palette-snippet">' + snippetHTML(h.snippet, inputEl ? inputEl.value : "") + '</span>' : '')
      + '</span>'
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
  var f = filtersFromEls();
  if(!kw && !hasScope(f)){
    seq++;
    hits = [];
    active = -1;
    renderIdle();
    return;
  }
  var my = ++seq;
  resultsEl.innerHTML = '<div class="palette-empty">搜索中…</div>';
  var err = null;
  var main = API.get("/api/search", queryParams(kw)).catch(function(ex){ err = err || ex; return []; });
  /* 分支接口只支持关键词：一旦收了类型/项目/状态等范围就不再混入分支，避免出现「筛选后仍有分支」的错觉 */
  var branchable = kw && !f.type && !f.reqId && !f.versionId && !f.status && !f.owner && !f.from && !f.to;
  var br = branchable ? branchHits(kw).catch(function(ex){ err = err || ex; return []; }) : Promise.resolve([]);
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
  /* 抽屉和搜索都是整页浮层：先把抽屉收掉，避免搜索叠在抽屉上、关掉后不知回到哪。
     有未保存改动时不静默丢弃，让用户先处理再搜。 */
  if(taskDrawer && taskDrawer.classList.contains("on")){
    if(rt.formDirty){ toast("工作项抽屉有未保存的改动，先保存或关闭再搜索", "warn"); return; }
    tryCloseTaskDrawer();
  }
  // 丢弃上次未触发的防抖与在途查询，避免旧结果覆盖重新打开后的「最近搜索」
  if(timer){ clearTimeout(timer); timer = null; }
  seq++;
  inputEl.value = "";
  hits = [];
  active = -1;
  resetFilters();
  loadRecent();
  setScope();
  renderIdle();
  Promise.all([ensureOptions(), loadSaved()]).then(function(){
    if(!hits.length) renderIdle();
  });
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
      import("../views/demands.js").then(function(mod){ mod.openDemandDetailById(h.id); });
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
  filtersEl = $("paletteFilters");
  typeEl = $("pfType");
  projectEl = $("pfProject");
  versionEl = $("pfVersion");
  statusEl = $("pfStatus");
  ownerEl = $("pfOwner");
  fromEl = $("pfFrom");
  toEl = $("pfTo");
  clearBtn = $("pfClear");
  saveBtn = $("pfSave");
  if(!inputEl || !resultsEl) return;

  inputEl.addEventListener("input", function(){
    if(timer) clearTimeout(timer);
    var value = inputEl.value;
    timer = setTimeout(function(){ query(value); }, 220);
  });
  function runFilters(){
    updateFilterUI();
    if(timer){ clearTimeout(timer); timer = null; }
    query(inputEl.value);
  }
  if(typeEl) typeEl.addEventListener("change", function(){
    syncStatusOptions(typeEl.value, "");
    runFilters();
  });
  if(projectEl) projectEl.addEventListener("change", function(){
    loadVersions(projectEl.value, "");
    runFilters();
  });
  [versionEl, statusEl, ownerEl, fromEl, toEl].forEach(function(el){
    if(el) el.addEventListener("change", runFilters);
  });
  if(clearBtn) clearBtn.addEventListener("click", function(){
    resetFilters();
    if(timer){ clearTimeout(timer); timer = null; }
    (inputEl.value.trim() ? query(inputEl.value) : renderIdle());
    try{ inputEl.focus(); }catch(err){ /* noop */ }
  });
  if(saveBtn) saveBtn.addEventListener("click", saveSearch);
  inputEl.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "ArrowDown"){ e.preventDefault(); move(1); return; }
    if(e.key === "ArrowUp"){ e.preventDefault(); move(-1); return; }
    if(e.key === "Enter"){
      e.preventDefault();
      if(active >= 0 && hits[active]) openHit(hits[active]);
      return;
    }
    /* 搜索面板是最顶层：Esc 只收自己，别再让全局快捷键把下层弹窗/抽屉一起关掉 */
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); }
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
    var sd = e.target.closest("[data-saved-del]");
    if(sd){
      e.stopPropagation();
      var dead = saved[Number(sd.getAttribute("data-saved-del"))];
      if(dead) deleteSaved(dead.id);
      return;
    }
    var sv = e.target.closest("[data-saved]");
    if(sv){ applySaved(saved[Number(sv.getAttribute("data-saved"))]); return; }
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
