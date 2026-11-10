/* views/requirements · 文档（树、编辑页、AI 拆分/审计） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { canEditReq, roleReadOnly, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocViewBtns } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import * as activityUI from "../core/activity-ui.js";
import { loadViews, savedViewsFor } from "../core/filters-ui.js";
import { DOC_TYPES, colName, docTypeName, fmtTs, pad2, priColor, priName, typeBadgeHTML } from "../lib/format.js";
import { loadReqs, render } from "./board.js";
import { openDemandDetailById } from "./demands.js";

var reqDocList = [];
var reqDocDirty = false;
var reqDocSaving = false;
var reqDocSavePromise = null;
/* 被路由守卫拦下时记住目标视图，保存/放弃后继续跳转 */
var reqDocPendingView = null;
/* 从项目页「管理文档」进入时携带的项目筛选；为空表示不过滤 */
var reqDocReqFilter = null;
/* setContents 会触发 SunEditor 的 onChange：灌正文期间先压住，避免刚打开就显示「有未保存的修改」 */
var reqDocSuppressChange = false;
var reqEditor = null;
var reqCollapsed = {};
var reqDocCollapsedDocs = {};
var editingDocId = null;
var reqDocOpenSeq = 0;
var mdMode = "split";
var mdLibPromise = null;
var mdRenderTimer = null;
var editingMeta = { title: "", reqId: "", status: "draft", format: "markdown", docType: "other", parentId: "", publishedAt: null, ownerUserId: "" };
var reqDocReadOnly = false;
/** 只读文档：隐藏保存/删除/新建工作项/AI/导入/历史恢复，正文与元数据不可编辑 */
function applyReqDocReadOnly(on){
  ["reqDocSave", "reqDocDelete", "reqDocAddTask", "reqDocAiSplit", "reqDocAiAudit", "reqDocImport", "reqDocHistory", "reqDocPublish", "reqDocShare"].forEach(function(id){
    var b = $(id);
    if(b) b.style.display = on ? "none" : "";
  });
  ["reqDocType", "reqDocParent"].forEach(function(id){
    var el = $(id);
    if(el) el.disabled = on;
  });
  var md = $("reqDocMdCanvas");
  if(md) md.readOnly = on;
  if(reqEditor){
    if(on) reqEditor.disable(); else reqEditor.enable();
  }
  var saved = $("reqDocSaved");
  if(on && saved) saved.textContent = "只读 · 你对该项目只有查看权限";
}
function fillDocTypeSelect(id, selected){
  var sel = $(id);
  sel.innerHTML = DOC_TYPES.map(function(t){
    return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
  }).join("");
  sel.value = selected;
}
function reqDocNameById(id){
  if(!id) return null;
  for(var i = 0; i < reqDocList.length; i++) if(reqDocList[i].id === id) return reqDocList[i].title;
  return null;
}
function reqDocStatusLabel(s){
  if(s === "active") return "进行中";
  if(s === "done") return "已完成";
  if(s === "draft") return "草稿";
  /* 历史数据可能出现非法状态：不冒充草稿，避免与「已发布」徽标自相矛盾 */
  return "未设置";
}
function reqDocProjectName(reqId){
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === reqId) return rt.reqList[i].name;
  for(var j = 0; j < reqDocList.length; j++) if(reqDocList[j].reqId === reqId && reqDocList[j].reqName) return reqDocList[j].reqName;
  return "未归属项目";
}
function isMarkdownDoc(){
  return editingMeta.format === "markdown";
}
function showEl(el, on){
  if(!el) return;
  if(on){
    el.removeAttribute("hidden");
    el.style.display = "";
  }else{
    el.setAttribute("hidden", "");
    el.style.display = "none";
  }
}
function mdModePref(){
  try{
    var v = localStorage.getItem("ds.reqMdMode");
    return v === "edit" || v === "preview" ? v : "split";
  }catch(e){ return "split"; }
}
var sunEditorPromise = null;
function loadSunEditor(){
  if(typeof window.SUNEDITOR !== "undefined") return Promise.resolve();
  if(sunEditorPromise) return sunEditorPromise;
  sunEditorPromise = new Promise(function(resolve, reject){
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/suneditor/suneditor.min.css";
    document.head.appendChild(css);
    var s = document.createElement("script");
    s.src = "vendor/suneditor/suneditor.min.js";
    s.onload = function(){ resolve(); };
    s.onerror = function(){
      sunEditorPromise = null;
      reject(new Error("富文本编辑器加载失败，请检查网络后重试"));
    };
    document.head.appendChild(s);
  });
  return sunEditorPromise;
}
var editorPromise = null;
function ensureEditor(){
  if(reqEditor) return Promise.resolve(reqEditor);
  if(!$("reqDocCanvas")) return Promise.resolve(null);
  if(editorPromise) return editorPromise;
  editorPromise = loadSunEditor().then(function(){
    /* 加载期间用户已经退出编辑页：不要对着隐藏容器创建（尺寸会算成 0） */
    if(!$("reqDocEditPage") || $("reqDocEditPage").hidden){
      editorPromise = null;
      return null;
    }
    reqEditor = SUNEDITOR.create("reqDocCanvas", {
      buttonList: [
        ["undo", "redo"],
        ["formatBlock", "font", "fontSize"],
        ["bold", "underline", "italic", "strike"],
        ["fontColor", "hiliteColor"],
        ["align", "list", "lineHeight"],
        ["outdent", "indent"],
        ["table", "link", "image"],
        ["removeFormat"],
        ["codeView"]
      ],
      mode: "classic",
      /* auto：不内滚，内容多高就多高，靠外层整页滚动 */
      height: "auto",
      minHeight: "360px",
      placeholder: "在这里写文档：目标、方案、说明…",
      charCounter: false,
      resizingBar: false,
      showPathLabel: false
    });
    reqEditor.onChange = function(){
      if(reqDocSuppressChange) return;
      /* 程序化回填可能晚于抑制窗口触发 onChange：与基线一致就不算用户修改 */
      if(reqEditorBaseline != null && reqEditor.getContents(true) === reqEditorBaseline) return;
      markReqDocDirty();
      scheduleTocRebuild();
    };
    return reqEditor;
  }).catch(function(e){
    editorPromise = null;
    throw e;
  });
  return editorPromise;
}
var reqDocsLoaded = false;
var reqDocKeyword = "";
/* 灌正文统一走这里：setContents 引起的 onChange 不算用户修改。
   同时记录正文基线，迟到的 onChange 只要与基线一致就忽略。 */
var reqEditorBaseline = null;
function setReqEditorContents(html){
  if(!reqEditor) return;
  reqDocSuppressChange = true;
  try{
    reqEditor.setContents(html || "", false);
    reqEditorBaseline = reqEditor.getContents(true);
  }finally{
    reqDocSuppressChange = false;
  }
}
function setReqDocHydrating(on){
  var body = $("reqDocRichBody");
  if(body) body.classList.toggle("is-loading", !!on);
  if($("reqDocSaved") && on) $("reqDocSaved").textContent = "编辑器加载中…";
}
var reqDocFetchSeq = 0;
/* 搜索结果单独存放：reqDocList 保持全量（任务表单的文档下拉等消费方需要全量） */
var reqDocSearchList = null;
/* 列表加载失败：与「真的没有文档」区分，保留旧数据并提供重试 */
var reqDocsError = null;
function fetchReqDocs(kw, refreshFull){
  var seq = ++reqDocFetchSeq;
  var main = API.getAllPages("/api/req-docs", kw ? { keyword: kw } : null);
  /* 搜索结果是子集，写操作后只刷新它会让全量列表（下拉、卡片文档名）停在旧数据；
     force 刷新时顺带取一份全量，打字搜索仍然只发一个请求 */
  var full = (kw && refreshFull) ? API.getAllPages("/api/req-docs", null).catch(function(){ return null; }) : null;
  return Promise.all([main, full]).then(function(res){
    if(seq !== reqDocFetchSeq) return;   // 快速连续搜索：丢弃过期响应
    var rows = res[0] || [];
    if(kw){
      reqDocSearchList = rows;
      if(res[1]) reqDocList = res[1];
    }else{
      reqDocList = rows;
      reqDocSearchList = null;
    }
    reqDocsLoaded = true;
    reqDocsError = null;
    if(activeView === "requirements") renderReqDocMode();
    populateReqDocSelect();
    if(state.board) render({animate:false});
  }).catch(function(ex){
    if(seq !== reqDocFetchSeq) return;
    reqDocsError = ex || new Error("文档加载失败");
    if(activeView === "requirements") renderReqDocMode();
  });
}
function loadReqDocs(force){
  if(reqDocsLoaded && !force) return Promise.resolve(reqDocList);
  return fetchReqDocs(reqDocKeyword, !!force);
}
function enterRequirementsView(){
  fillReqDocProjectSelect();
  loadReqs().then(function(){
    fillReqDocProjectSelect();
    /* 项目列表到位后重算「新增文档」按钮可见性（树可能先于 reqs 渲染过） */
    if(reqDocsLoaded) renderReqDocMode();
  });
  showReqDocList();
  setReqDocMode(reqDocMode);
  /* 文档列表带「已完成/总工作项」，看板或抽屉里改过任务后必须重新取，否则计数停在旧值 */
  loadReqDocs(true).then(function(){ renderReqDocMode(); });
}
function showReqDocList(){
  /* 同视图内再点「文档」也要先处理未保存正文，不能直接清空编辑态 */
  if(isReqDocEditing()){ tryCloseReqDocEditor(); return; }
  reqDocOpenSeq++;
  editingDocId = null;
  state.reqDocId = null;
  reqDocDirty = false;
  tocItems = [];
  tocActive = null;
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
}
function reqDocSort(a, b){
  var sa = a.sortOrder || 0, sb = b.sortOrder || 0;
  if(sa !== sb) return sa - sb;
  var ca = a.createdAt || "", cb = b.createdAt || "";
  if(ca !== cb) return ca < cb ? -1 : 1;
  return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
}
function reqDocDescendants(id){
  var out = {};
  if(!id) return out;
  var stack = [id];
  while(stack.length){
    var cur = stack.pop();
    reqDocList.forEach(function(d){
      if(d.parentId === cur && !out[d.id]){
        out[d.id] = true;
        stack.push(d.id);
      }
    });
  }
  return out;
}
/* 某父级下的同项目子文档（parentId 传 null 取根级），按 sortOrder 排好 */
function reqDocKidsOf(parentId, reqId){
  var out = reqDocList.filter(function(d){
    if(reqId && d.reqId !== reqId) return false;
    return (d.parentId || "") === (parentId || "");
  });
  return out.sort(reqDocSort);
}
/* 拖拽移动计划：返回要提交给 /api/req-docs/reorder 的 items（含新父级与整组重排的 sortOrder） */
function reqDocPlanMove(srcId, targetId, zone){
  var src = reqDocById(srcId);
  if(!src) return null;
  var newParentId, kids;
  if(zone === "into"){
    var t = reqDocById(targetId);
    if(!t) return null;
    newParentId = t.id;
    kids = reqDocKidsOf(t.id, src.reqId);
  }else if(zone === "root"){
    newParentId = null;
    kids = reqDocKidsOf(null, src.reqId);
  }else{
    var t2 = reqDocById(targetId);
    if(!t2) return null;
    newParentId = t2.parentId || null;
    kids = reqDocKidsOf(t2.parentId, src.reqId);
  }
  kids = kids.filter(function(k){ return k.id !== srcId; });
  var idx = kids.length;
  if(zone === "before" || zone === "after"){
    idx = -1;
    for(var i = 0; i < kids.length; i++){
      if(kids[i].id === targetId){ idx = i; break; }
    }
    if(idx < 0) return null;
    if(zone === "after") idx += 1;
  }
  kids.splice(idx, 0, src);
  var items = [];
  for(var j = 0; j < kids.length; j++){
    items.push({ id: kids[j].id, sortOrder: j * 10, parentId: newParentId });
  }
  return items;
}
function reqDocRowHTML(r, depth, hasChild, collapsed){
  var meta = [esc(docTypeName(r.docType)), esc(r.owner || "—") + " 创建"];
  if(r.createdAt) meta.push(esc(fmtTs(r.createdAt)));
  if(r.status && r.status !== "draft") meta.push("状态：" + reqDocStatusLabel(r.status));
  if(r.taskCount) meta.push(r.doneCount + "/" + r.taskCount + " 工作项");
  var fmt = r.format === "markdown"
    ? '<span class="rr-fmt md">MD</span>'
    : '<span class="rr-fmt">HTML</span>';
  var caret = hasChild
    ? '<span class="rr-caret' + (collapsed ? " collapsed" : "") + '" data-toggle-doc="' + esc(r.id) + '" title="展开/收起子文档">' + icon("down", 13) + '</span>'
    : '<span class="rr-caret"></span>';
  var drag = canEditReq(r.reqId)
    ? '<span class="rr-drag" title="拖动调整顺序" aria-label="拖动调整顺序">' + icon("grip", 13) + '</span>'
    : '';
  var rename = canEditReq(r.reqId)
    ? '<span class="rr-rename" role="button" title="重命名" aria-label="重命名">' + icon("edit", 12) + '</span>'
    : '';
  return '<button class="reqdoc-row rd-depth' + Math.min(depth, 4) + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-reqdoc="' + esc(r.id) + '"' +
    ' data-rr-reqid="' + esc(r.reqId || "") + '"' +
    ' data-rr-depth="' + depth + '">' +
    caret + drag + rename +
    '<span class="rr-main">' +
      '<span class="rr-title">' + fmt + esc(r.title) + (r.publishedAt == null ? '<span class="rr-draft">草稿</span>' : '<span class="rr-published">已发布</span>') + '</span>' +
      '<span class="rr-meta">' + meta.join(" · ") + '</span>' +
      (r.excerpt ? '<span class="rr-excerpt">' + esc(r.excerpt) + '</span>' : '') +
    '</span>' +
    '<span class="rr-go">' + icon("chevronRight", 14) + '</span>' +
  '</button>';
}
function renderReqDocNodes(nodes, children, depth, seen){
  seen = seen || {};
  return nodes.slice().sort(reqDocSort).map(function(r){
    if(seen[r.id]) return "";
    seen[r.id] = true;
    var kids = children[r.id] || [];
    var collapsed = !!reqDocCollapsedDocs[r.id];
    return reqDocRowHTML(r, depth, kids.length > 0, collapsed) +
      (kids.length && !collapsed ? renderReqDocNodes(kids, children, depth + 1, seen) : "");
  }).join("");
}
function reqDocGroupByProject(rows){
  var groups = [], index = {};
  rows.forEach(function(r){
    var key = r.reqId || "__none";
    if(!index[key]){
      index[key] = { key: key, reqId: r.reqId, name: r.reqName || "未归属项目", items: [] };
      groups.push(index[key]);
    }
    index[key].items.push(r);
  });
  /* 按「项目」里的顺序排，未在列表中的排最后 */
  var order = {};
  rt.reqList.forEach(function(r, i){ order[r.id] = i; });
  groups.sort(function(a, b){
    var oa = order[a.reqId] == null ? 9999 : order[a.reqId];
    var ob = order[b.reqId] == null ? 9999 : order[b.reqId];
    return oa - ob;
  });
  groups.forEach(function(g){
    var byId = {}, children = {};
    g.items.forEach(function(r){ byId[r.id] = r; });
    g.items.forEach(function(r){
      if(r.parentId && byId[r.parentId] && r.parentId !== r.id){
        (children[r.parentId] = children[r.parentId] || []).push(r);
      }
    });
    g.children = children;
    g.roots = g.items.filter(function(r){ return !(r.parentId && byId[r.parentId] && r.parentId !== r.id); });
  });
  return groups;
}
function renderReqDocTree(){
  var box = $("reqDocTree");
  if(!box) return;
  /* 没有可写项目就不显示「新增文档」；项目列表未加载时不判定（加载完成后会重渲染修正） */
  var nb = $("reqDocNew");
  if(nb) nb.style.display = (!rt.reqsLoaded || rt.reqList.some(function(r){ return canEditReq(r.id); })) ? "" : "none";
  if(!reqDocsLoaded){
    box.innerHTML = UI.skeletonRows(4);
    return;
  }
  if(!reqDocList.length){
    box.innerHTML = reqDocEmptyHTML();
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocVisibleRows();   // 关键字过滤由服务端完成，结果单独缓存
  if(!rows.length){
    box.innerHTML = kw
      ? '<div class="reqdoc-empty2">没有找到匹配的文档</div>'
      : '<div class="reqdoc-empty2">还没有文档。点右上角「新增文档」，先选项目再填文档名称。</div>';
    return;
  }

  box.innerHTML = reqDocGroupByProject(rows).map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    /* 搜索时平铺展示命中项，不做层级缩进 */
    var body = kw
      ? g.items.slice().sort(reqDocSort).map(function(r){ return reqDocRowHTML(r, 0, false, false); }).join("")
      : renderReqDocNodes(g.roots, g.children, 0);
    return '<div class="reqdoc-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="reqdoc-proj-head" type="button" data-toggle-proj="' + esc(g.key) + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + icon("down", 14) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        '<span class="rp-count">' + g.items.length + '</span>' +
      '</button>' +
      '<div class="reqdoc-proj-body">' + body + '</div>' +
    '</div>';
  }).join("");
}
function toggleReqProj(key){
  reqCollapsed[key] = !reqCollapsed[key];
  renderReqDocTree();
}

/* ---------- 列表 / 看板 / 阅读 / 最近动态：同一份数据的四种展示 ---------- */

var RD_MODES = ["tree", "kanban", "read", "feed"];
var RD_STATUS = [
  { id: "draft", name: "草稿" },
  { id: "active", name: "进行中" },
  { id: "done", name: "已完成" }
];
var reqDocMode = reqDocModePref();
var splitDocId = null;
var splitDocSeq = 0;
/* 阅读模式评论：面板状态 + 划线气泡 + 引用高亮 */
var rrdCommentsDocId = null;
var rrdComments = [];
var rrdCommentsOpen = false;
var rrdCanComment = false;
var rrdQuote = null;
var rrdSelText = "";
var rrdFlashCommentId = null;
var rrdSelBubble = null;
var readerExportSeq = 0;
var feedSeq = 0;
var draggingReqDocId = null;

function reqDocModePref(){
  try{
    var v = localStorage.getItem("ds.reqDocMode");
    return RD_MODES.indexOf(v) >= 0 ? v : "tree";
  }catch(e){ return "tree"; }
}
function setReqDocMode(mode){
  reqDocMode = RD_MODES.indexOf(mode) >= 0 ? mode : "tree";
  try{ localStorage.setItem("ds.reqDocMode", reqDocMode); }catch(e){ /* 隐私模式忽略 */ }
  var btns = document.querySelectorAll("#reqDocListPage [data-rdmode]");
  for(var i = 0; i < btns.length; i++){
    btns[i].setAttribute("aria-selected", btns[i].dataset.rdmode === reqDocMode ? "true" : "false");
  }
  showEl($("reqDocTree"), reqDocMode === "tree");
  showEl($("reqDocKanban"), reqDocMode === "kanban");
  showEl($("reqDocSplit"), reqDocMode === "read");
  showEl($("reqDocFeed"), reqDocMode === "feed");
  renderReqDocMode();
}
function renderReqDocMode(){
  syncReqDocFilterUI();
  syncReqDocLoadError();
  if(reqDocMode === "kanban") renderReqDocKanban();
  else if(reqDocMode === "read") renderReqDocSplit();
  else if(reqDocMode === "feed") renderReqDocFeed();
  else renderReqDocTree();
}
function reqDocById(id){
  for(var i = 0; i < reqDocList.length; i++) if(reqDocList[i].id === id) return reqDocList[i];
  return null;
}
function syncReqDocLoadError(){
  var box = $("reqDocLoadError");
  if(!box) return;
  if(!reqDocsError){ box.hidden = true; box.innerHTML = ""; return; }
  var hasOld = reqDocList.length || (reqDocSearchList && reqDocSearchList.length);
  box.hidden = false;
  box.innerHTML = '<span>文档加载失败：' + esc(reqDocsError.message || "网络异常") +
    (hasOld ? "（下方为上次加载结果）" : "") + '</span>' +
    '<button class="btn sm" type="button" data-reqdoc-reload>重试</button>';
}
function reqDocEmptyHTML(){
  var kw = (($("reqDocSearch") || {}).value || "").trim();
  if(kw) return '<div class="reqdoc-empty2">没有找到匹配的文档</div>';
  if(reqDocsError) return '<div class="reqdoc-empty2">暂时无法加载文档，请点上方的「重试」</div>';
  if(reqDocReqFilter) return '<div class="reqdoc-empty2">这个项目还没有文档。点右上角「新增文档」并选择该项目即可创建。</div>';
  return '<div class="reqdoc-empty2">还没有文档。点右上角「新增文档」，先选项目再填文档名称。</div>';
}
function reqDocFilterName(id){
  for(var i = 0; i < rt.reqList.length; i++){
    if(rt.reqList[i].id === id) return rt.reqList[i].name;
  }
  for(var j = 0; j < reqDocList.length; j++){
    if(reqDocList[j].reqId === id) return reqDocList[j].reqName || "所选项目";
  }
  return "所选项目";
}
function syncReqDocFilterUI(){
  var chip = $("reqDocProjFilter");
  if(!chip) return;
  chip.hidden = !reqDocReqFilter;
  var name = $("reqDocProjFilterName");
  if(name && reqDocReqFilter) name.textContent = reqDocFilterName(reqDocReqFilter);
}
/* 文档列表按项目过滤：供项目页「管理文档」携带上下文进入 */
function setReqDocProjectFilter(reqId){
  reqDocReqFilter = reqId || null;
  syncReqDocFilterUI();
  if(activeView === "requirements") renderReqDocMode();
}
function reqDocVisibleRows(){
  var rows = reqDocSearchList || reqDocList;
  if(reqDocReqFilter){
    rows = rows.filter(function(d){ return d.reqId === reqDocReqFilter; });
  }
  return rows;
}

/* ---------- 文档保存视图（scope=doc：搜索词 / 项目范围 / 展示方式） ---------- */

var rdViewsMenuEl = $("rdViewsMenu");
function rdViewParams(){
  return { scope: "doc", q: reqDocKeyword || "", reqId: reqDocReqFilter || "", mode: reqDocMode };
}
function rdViewMeaningful(p){
  return !!(p.q || p.reqId || (p.mode && p.mode !== "tree"));
}
function applyRdView(v){
  var p;
  try{ p = JSON.parse(v.params || "{}"); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "doc" || (p.q && typeof p.q !== "string")
    || (p.reqId && typeof p.reqId !== "string")
    || (p.mode && RD_MODES.indexOf(p.mode) === -1)){
    toast("视图参数不合法，无法应用（可删除后重新保存）", "bad");
    return;
  }
  reqDocKeyword = p.q || "";
  if($("reqDocSearch")) $("reqDocSearch").value = reqDocKeyword;
  reqDocReqFilter = p.reqId || null;
  syncReqDocFilterUI();
  setReqDocMode(p.mode || "tree");
  loadReqDocs(true).then(function(){ renderReqDocMode(); });
  toast("已应用视图「" + v.name + "」", "fs");
}
function saveRdView(){
  var p = rdViewParams();
  if(!rdViewMeaningful(p)){ toast("先设置搜索、项目范围或切换展示方式，再保存视图", "warn"); return; }
  UI.showPrompt({
    title: "保存文档视图",
    desc: "保存当前搜索、项目范围与展示方式；同名保存将覆盖原视图",
    label: "视图名称（≤20 字）", maxLength: 20, okText: "保存"
  }).then(function(name){
    if(!name) return;
    var overwrite = savedViewsFor("doc").some(function(v){ return v.name === name; });
    API.post("/api/views", { name: name, params: JSON.stringify(p) }).then(function(){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(renderRdViewsMenu);
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteRdView(id){
  UI.showConfirm({ title: "删除视图", msg: "确定删除该文档视图？不影响文档数据。", okText: "删除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      loadViews().then(renderRdViewsMenu);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function renderRdViewsMenu(){
  if(!rdViewsMenuEl) return;
  var views = savedViewsFor("doc");
  var html = '<div class="menu-title">文档视图</div>';
  if(!views.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的文档视图；设置搜索、项目范围或展示方式后保存。</p></div>';
  }else{
    html += views.map(function(v){
      return '<div class="menu-row">' +
        '<button class="menu-item" type="button" data-rd-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
        '<button class="icon-btn sm" type="button" data-rd-view-del="' + esc(v.id) + '" aria-label="删除视图" title="删除视图">' + icon("close", 12) + '</button>' +
      '</div>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-rd-view-save>保存当前为视图</button></div>';
  rdViewsMenuEl.innerHTML = html;
}

/* ---------- 看板：按状态分列，拖拽卡片流转状态 ---------- */

function reqDocKanbanCard(d){
  var editable = canEditReq(d.reqId);
  var fmt = d.format === "markdown"
    ? '<span class="rr-fmt md">MD</span>'
    : '<span class="rr-fmt">HTML</span>';
  var meta = [esc(reqDocProjectName(d.reqId)), esc(d.owner || "—") + " 创建"];
  if(d.updatedAt) meta.push("更新 " + esc(fmtTs(d.updatedAt)));
  var tasks = d.taskCount
    ? '<span class="rk-tasks" title="关联工作项完成度">' + d.doneCount + "/" + d.taskCount + " 工作项</span>"
    : "";
  /* 状态下拉是拖拽之外的兜底入口（触屏/键盘也能流转）；只读项目只显示文字 */
  var st = d.status === "done" ? "done" : (d.status === "active" ? "doing" : "draft");
  var statusCtl = editable
    ? '<select class="rk-status" data-rkstatus="' + esc(d.id) + '" aria-label="文档状态">'
      + RD_STATUS.map(function(s){
        return '<option value="' + s.id + '"' + (s.id === (d.status || "draft") ? " selected" : "") + '>' + s.name + '</option>';
      }).join("")
      + '</select>'
    : '<span class="rk-status-label st ' + st + '"><i></i>' + reqDocStatusLabel(d.status) + '</span>';
  var pub = d.publishedAt == null ? '<span class="rr-draft">草稿</span>' : '<span class="rr-published">已发布</span>';
  return '<div class="rk-card" data-rkdoc="' + esc(d.id) + '"' + (editable ? ' draggable="true"' : '') + '>' +
    '<div class="rk-head">' + fmt + '<span class="rk-title">' + esc(d.title) + pub + '</span></div>' +
    '<div class="rk-meta">' + meta.join(" · ") + '</div>' +
    '<div class="rk-foot">' + statusCtl + tasks + '</div>' +
  '</div>';
}
function renderReqDocKanban(){
  var box = $("reqDocKanban");
  if(!box) return;
  if(!reqDocsLoaded){
    box.innerHTML = UI.skeletonRows(3);
    return;
  }
  var rows = reqDocVisibleRows();
  if(!rows.length){
    box.innerHTML = reqDocEmptyHTML();
    return;
  }
  box.innerHTML = RD_STATUS.map(function(col){
    var cards = rows.filter(function(d){ return (d.status || "draft") === col.id; }).sort(reqDocSort);
    return '<div class="rk-col rk-' + col.id + '" data-rkcol="' + col.id + '">' +
      '<div class="rk-col-head"><span class="rk-dot" aria-hidden="true"></span>' + col.name +
        '<span class="rk-count">' + cards.length + '</span></div>' +
      '<div class="rk-col-body">' +
        (cards.length ? cards.map(reqDocKanbanCard).join("") : '<div class="rk-empty">暂无文档</div>') +
      '</div>' +
    '</div>';
  }).join("");
}
function reqDocChangeStatus(id, status){
  var d = reqDocById(id);
  if(!d) return;
  if((d.status || "draft") === status) return;
  if(!canEditReq(d.reqId)){
    toast("你对该项目只有查看权限", "warn");
    renderReqDocKanban();
    return;
  }
  API.put("/api/req-docs/" + encodeURIComponent(id) + "/status", { status: status }).then(function(doc){
    [reqDocList, reqDocSearchList].forEach(function(list){
      if(!list) return;
      for(var i = 0; i < list.length; i++){
        if(list[i].id === id){
          list[i].status = doc.status;
          list[i].updatedAt = doc.updatedAt;
        }
      }
    });
    renderReqDocKanban();
    toast("「" + d.title + "」已流转为「" + reqDocStatusLabel(status) + "」", "fs");
  }).catch(function(ex){
    toast(ex.message || "状态流转失败", "bad");
    renderReqDocKanban();
  });
}
function reqDocKanbanClearDrop(){
  var kb = $("reqDocKanban");
  if(!kb) return;
  var cols = kb.querySelectorAll(".rk-col.drop-active");
  for(var i = 0; i < cols.length; i++) cols[i].classList.remove("drop-active");
}

/* ---------- 阅读：左侧文档树 + 右侧正文 ---------- */

function reqDocSplitNodeHTML(r, depth, hasChild, collapsed){
  var caret = hasChild
    ? '<span class="rs-caret' + (collapsed ? " collapsed" : "") + '" data-rs-toggle="' + esc(r.id) + '" title="展开/收起子文档">' + icon("down", 12) + '</span>'
    : '<span class="rs-caret"></span>';
  var fmt = r.format === "markdown"
    ? '<span class="rr-fmt md">MD</span>'
    : '<span class="rr-fmt">HTML</span>';
  var pub = r.publishedAt == null ? '<span class="rr-draft">草稿</span>' : '<span class="rr-published" title="已发布，项目成员可见">已发布</span>';
  var drag = canEditReq(r.reqId)
    ? '<span class="rs-drag" title="拖动调整顺序" aria-label="拖动调整顺序">' + icon("grip", 12) + '</span>'
    : '';
  var rename = canEditReq(r.reqId)
    ? '<span class="rs-rename" role="button" title="重命名" aria-label="重命名">' + icon("edit", 11) + '</span>'
    : '';
  return '<button class="rs-node rd-depth' + Math.min(depth, 4) + (r.id === splitDocId ? " active" : "") + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-rs-doc="' + esc(r.id) + '"' +
    ' data-rs-reqid="' + esc(r.reqId || "") + '"' +
    ' data-rs-depth="' + depth + '">' +
    caret + fmt + drag + rename +
    '<span class="rs-title">' + esc(r.title) + '</span>' +
    pub +
  '</button>';
}
function renderReqDocSplitNodes(nodes, children, depth){
  return nodes.slice().sort(reqDocSort).map(function(r){
    var kids = children[r.id] || [];
    var collapsed = !!reqDocCollapsedDocs[r.id];
    return reqDocSplitNodeHTML(r, depth, kids.length > 0, collapsed) +
      (kids.length && !collapsed ? renderReqDocSplitNodes(kids, children, depth + 1) : "");
  }).join("");
}
function renderReqDocSplit(){
  var box = $("reqDocSplitTree");
  if(!box) return;
  /* 选中的文档已被删除：回到占位提示 */
  if(splitDocId && !reqDocById(splitDocId)){
    splitDocId = null;
    if($("reqDocReader")) $("reqDocReader").innerHTML = '<div class="rrd-empty"><div class="rrd-empty-title">从左侧选择文档阅读</div><div class="rrd-empty-text">有编辑权限时，可拖动文档左侧的手柄调整顺序</div></div>';
  }
  if(!reqDocsLoaded){
    box.innerHTML = UI.skeletonRows(4);
    return;
  }
  var rows = reqDocVisibleRows();
  if(!rows.length){
    box.innerHTML = reqDocEmptyHTML();
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  box.innerHTML = reqDocGroupByProject(rows).map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    /* 搜索时平铺展示命中项，不做层级缩进 */
    var body = kw
      ? g.items.slice().sort(reqDocSort).map(function(r){ return reqDocSplitNodeHTML(r, 0, false, false); }).join("")
      : renderReqDocSplitNodes(g.roots, g.children, 0);
    return '<div class="rs-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="rs-proj-head" type="button" data-rs-proj="' + esc(g.key) + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + icon("down", 12) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        '<span class="rp-count">' + g.items.length + '</span>' +
      '</button>' +
      '<div class="rs-proj-body">' + body + '</div>' +
    '</div>';
  }).join("");
}
function loadReqDocSplitDoc(id){
  splitDocId = id;
  renderReqDocSplit();
  var box = $("reqDocReader");
  if(!box) return;
  var seq = ++splitDocSeq;
  box.innerHTML = '<div class="rrd-empty">加载中…</div>';
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== splitDocSeq || splitDocId !== id) return;
    renderReqDocReader(doc);
  }).catch(function(ex){
    if(seq !== splitDocSeq || splitDocId !== id) return;
    box.innerHTML = UI.errorState(ex.message || "文档加载失败");
  });
}
function reqDocReaderOpenLinks(body){
  var links = body.querySelectorAll("a[href]");
  for(var i = 0; i < links.length; i++){
    links[i].setAttribute("target", "_blank");
    links[i].setAttribute("rel", "noopener noreferrer");
  }
}
function renderReqDocReader(doc){
  var box = $("reqDocReader");
  if(!box) return;
  var pubBadge = doc.publishedAt == null
    ? '<span class="rr-draft">草稿</span>'
    : '<span class="rr-published" title="已发布，项目成员可见">已发布</span>';
  var meta = [esc(docTypeName(doc.docType)), "负责人 " + esc(doc.owner || "—"), reqDocStatusLabel(doc.status)];
  if(doc.updatedAt) meta.push("更新于 " + esc(fmtTs(doc.updatedAt)));
  if(doc.taskCount) meta.push(doc.doneCount + "/" + doc.taskCount + " 工作项");
  var canWrite = !roleReadOnly() && canEditReq(doc.reqId);
  rrdCommentsDocId = doc.id;
  rrdComments = [];
  rrdCommentsOpen = false;
  rrdCanComment = canWrite;
  rrdFlashCommentId = null;
  setRrdQuote(null);
  hideRrdSelBubble();
  box.classList.remove("with-comments");
  box.innerHTML =
    '<div class="rrd-main">' +
    '<div class="rrd-head">' +
      '<div class="rrd-crumb" id="rrdCrumb"></div>' +
      '<div class="rrd-title-row">' +
        '<h3><span class="rrd-title-text">' + esc(doc.title) + '</span>' + pubBadge + '</h3>' +
        '<span class="rrd-acts">' +
          (canWrite ? '<button class="btn sm ghost" type="button" data-rrd-rename="' + esc(doc.id) + '" title="重命名文档">' + icon("edit", 13) + ' 重命名</button>' : '') +
          '<button class="btn sm ghost" type="button" data-rrd-comments="' + esc(doc.id) + '" title="查看评论；选中正文可划线评论">' + icon("comment", 13) + ' 评论</button>' +
          '<button class="btn sm ghost" type="button" data-rrd-history="' + esc(doc.id) + '" data-can-restore="' + (canWrite ? "1" : "0") + '" title="查看历史版本">' + icon("clock", 13) + ' 历史版本</button>' +
          '<button class="btn sm ghost" type="button" data-rrd-export="' + esc(doc.id) + '" title="导出文档">' + icon("download", 13) + ' 导出</button>' +
          '<button class="btn sm ghost" type="button" data-rrd-edit="' + esc(doc.id) + '">' + icon("edit", 13) + ' 编辑文档</button>' +
        '</span>' +
      '</div>' +
      '<div class="rrd-meta">' + meta.join(" · ") + '</div>' +
    '</div>' +
    '<div class="rrd-body markdown-body" id="reqDocReaderBody"></div>' +
    '</div>' +
    '<aside class="rrd-comments" id="rrdComments" hidden aria-label="文档评论">' +
      '<div class="rrdc-head"><span id="rrdCommentsTitle">评论</span>' +
        '<button class="icon-btn sm" type="button" id="rrdCommentsX" aria-label="关闭评论"><span data-icon="close"></span></button>' +
      '</div>' +
      '<div class="reqdoc-comment-list rrdc-list" id="rrdCommentList"></div>' +
      '<div class="reqdoc-comment-form rrdc-form" id="rrdCommentForm">' +
        '<div class="reqdoc-comment-quotechip" id="rrdQuoteChip" hidden>' +
          '<span data-icon="quote"></span>' +
          '<span class="qc-text" id="rrdQuoteText"></span>' +
          '<button class="qc-x" type="button" id="rrdQuoteClear" title="移除引用" aria-label="移除引用">×</button>' +
        '</div>' +
        '<textarea id="rrdCommentInput" rows="2" placeholder="写下你的评论…"></textarea>' +
        '<div class="reqdoc-comment-actions">' +
          '<span class="rrdc-hint">选中正文可划线评论</span>' +
          '<button class="btn sm primary" type="button" id="rrdCommentSend">发表评论</button>' +
        '</div>' +
      '</div>' +
    '</aside>';
  if(!canWrite){ var cf = $("rrdCommentForm"); if(cf) cf.style.display = "none"; }
  renderReqDocCrumb($("rrdCrumb"), doc.id);
  var body = $("reqDocReaderBody");
  var id = doc.id;
  loadMarkdownLib().then(function(){
    if(splitDocId !== id) return;
    if(doc.format === "markdown"){
      var html = "";
      try{ html = window.marked.parse(doc.content || "", { gfm: true, breaks: false }); }catch(e){ html = ""; }
      body.innerHTML = window.DOMPurify.sanitize(html);
    }else{
      /* 服务端已按白名单清洗过，这里再过一道 DOMPurify（双保险） */
      body.innerHTML = window.DOMPurify.sanitize(doc.content || "");
    }
    reqDocReaderOpenLinks(body);
    rrdApplyHighlights();
  }).catch(function(ex){
    if(splitDocId === id) body.innerHTML = UI.errorState(ex.message || "正文渲染失败");
  });
}

/* ---------- 阅读：面包屑（项目 / 上层文档链 / 当前文档）与行内重命名 ---------- */

function renderReqDocCrumb(el, docId){
  if(!el) return;
  var d = reqDocById(docId);
  if(!d){ el.innerHTML = ""; return; }
  var parts = ['<span class="rrd-crumb-proj">' + esc(reqDocProjectName(d.reqId)) + '</span>'];
  var guard = 0, cur = d;
  while(cur && cur.parentId && guard++ < 20){
    var p = reqDocById(cur.parentId);
    if(!p) break;
    parts.push('<span class="rrd-crumb-sep">/</span><button class="rrd-crumb-link" type="button" data-rrd-crumb="' + esc(p.id) + '" title="打开上层文档">' + esc(p.title) + '</button>');
    cur = p;
  }
  parts.push('<span class="rrd-crumb-sep">/</span><span class="rrd-crumb-cur">' + esc(d.title) + '</span>');
  el.innerHTML = parts.join("");
}
/* 行内重命名：titleEl 被临时隐藏并出现输入框；保存走轻量 PUT /title 接口。
   hideEl（树行/节点是 button，输入框不能放进 button 里）：隐藏它，把输入框插到它后面 */
function reqDocBeginRename(id, opts){
  if(!id || !opts) return;
  var titleEl = opts.titleEl, hideEl = opts.hideEl || null;
  if(!titleEl) return;
  var d = reqDocById(id);
  if(!d || !canEditReq(d.reqId)) return;
  var host = hideEl || titleEl;
  if(host.dataset.rrRenaming) return;
  var old = d.title || "";
  var input = document.createElement("input");
  input.className = opts.inputClass || "rr-rename-input";
  input.type = "text";
  input.maxLength = 100;
  input.value = old;
  input.setAttribute("aria-label", "文档名称");
  host.dataset.rrRenaming = "1";
  host.style.display = "none";
  host.parentNode.insertBefore(input, host.nextSibling);
  input.focus();
  input.select();
  var done = false;
  function finish(save){
    if(done) return;
    done = true;
    var name = (input.value || "").trim();
    delete host.dataset.rrRenaming;
    host.style.display = "";
    if(input.parentNode) input.parentNode.removeChild(input);
    if(!save || !name || name === old) return;
    API.put("/api/req-docs/" + encodeURIComponent(id) + "/title", { title: name }).then(function(doc){
      var newTitle = (doc && doc.title) ? doc.title : name;
      [reqDocList, reqDocSearchList].forEach(function(list){
        if(!list) return;
        for(var i = 0; i < list.length; i++){
          if(list[i].id === id) list[i].title = newTitle;
        }
      });
      syncReqDocTitleViews(id);
      toast("已重命名为「" + newTitle + "」", "fs");
    }).catch(function(ex){
      toast(ex.message || "重命名失败", "bad");
    });
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); finish(true); }
    else if(e.key === "Escape"){ e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function(){ finish(true); });
}
/* 重命名成功后把各处展示的标题同步一遍（列表/左树/阅读器标题/面包屑） */
function syncReqDocTitleViews(id){
  var d = reqDocById(id);
  if(!d) return;
  if(reqDocMode === "tree") renderReqDocTree();
  else if(reqDocMode === "read") renderReqDocSplit();
  else if(reqDocMode === "kanban") renderReqDocKanban();
  /* 阅读器此刻显示的是被重命名的这篇，才更新标题与面包屑 */
  if(splitDocId !== id) return;
  var span = document.querySelector("#reqDocReader .rrd-title-text");
  if(span) span.textContent = d.title;
  renderReqDocCrumb($("rrdCrumb"), id);
}
/* 把 reorder 结果同步进全量与搜索两份列表，避免搜索态下显示旧结构 */
function reqDocApplySortItems(items){
  [reqDocList, reqDocSearchList].forEach(function(list){
    if(!list) return;
    items.forEach(function(it){
      for(var i = 0; i < list.length; i++){
        if(list[i].id === it.id){ list[i].sortOrder = it.sortOrder; list[i].parentId = it.parentId; break; }
      }
    });
  });
}

/* ---------- 阅读模式：划线评论 ---------- */

function setRrdQuote(text){
  rrdQuote = (text || "").trim() || null;
  var chip = $("rrdQuoteChip");
  var txt = $("rrdQuoteText");
  if(chip) chip.hidden = !rrdQuote;
  if(txt) txt.textContent = rrdQuote || "";
}
function toggleRrdComments(open){
  var panel = $("rrdComments");
  var box = $("reqDocReader");
  if(!panel || !box) return;
  rrdCommentsOpen = open == null ? !rrdCommentsOpen : !!open;
  panel.hidden = !rrdCommentsOpen;
  box.classList.toggle("with-comments", rrdCommentsOpen);
  if(rrdCommentsOpen) loadRrdComments();
}
function loadRrdComments(){
  var list = $("rrdCommentList");
  if(!list || !rrdCommentsDocId) return;
  var docId = rrdCommentsDocId;
  list.innerHTML = '<div class="reqdoc-comment-empty">加载中…</div>';
  API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/comments").then(function(rows){
    if(rrdCommentsDocId !== docId) return;
    rrdComments = rows || [];
    var title = $("rrdCommentsTitle");
    if(title) title.textContent = rrdComments.length ? "评论（" + rrdComments.length + "）" : "评论";
    if(!rrdComments.length){
      list.innerHTML = '<div class="reqdoc-comment-empty">还没有评论，选中正文即可划线评论</div>';
    }else{
      list.innerHTML = rrdComments.map(function(c){
        return '<div class="reqdoc-comment-item" data-rrd-comment-id="' + esc(c.id) + '">'
          + '<div class="reqdoc-comment-head">'
          +   '<span class="reqdoc-comment-user">' + esc(c.userName || "—") + '</span>'
          +   '<span class="reqdoc-comment-time">' + esc(fmtTs(c.createdAt) || "—") + '</span>'
          + '</div>'
          + (c.quoteText ? '<div class="reqdoc-comment-quote">' + esc(c.quoteText) + '</div>' : '')
          + '<div class="reqdoc-comment-body">' + esc(c.content) + '</div>'
          + (c.deletable ? '<div class="reqdoc-comment-actions-r"><button class="btn sm danger" type="button" data-rrd-del-comment="' + esc(c.id) + '">删除</button></div>' : '')
          + '</div>';
      }).join("");
    }
    rrdApplyHighlights();
    if(rrdFlashCommentId){
      var item = list.querySelector('[data-rrd-comment-id="' + rrdFlashCommentId + '"]');
      if(item){
        item.classList.add("flash");
        item.scrollIntoView({ block: "nearest" });
        setTimeout(function(){ item.classList.remove("flash"); }, 1600);
      }
      rrdFlashCommentId = null;
    }
  }).catch(function(ex){
    if(rrdCommentsDocId !== docId) return;
    list.innerHTML = '<div class="reqdoc-comment-empty">' + esc(ex.message || "评论加载失败") + '</div>';
  });
}
function submitRrdComment(){
  if(!rrdCommentsDocId) return;
  if(!rrdCanComment){ toast("你对该项目只有查看权限", "warn"); return; }
  var ta = $("rrdCommentInput");
  var content = (ta && ta.value || "").trim();
  if(!content){ toast("评论内容不能为空", "warn"); if(ta) ta.focus(); return; }
  var btn = $("rrdCommentSend");
  if(btn) btn.disabled = true;
  var body = { content: content };
  if(rrdQuote) body.quoteText = rrdQuote;
  API.post("/api/req-docs/" + encodeURIComponent(rrdCommentsDocId) + "/comments", body).then(function(){
    if(ta) ta.value = "";
    setRrdQuote(null);
    loadRrdComments();
  }).catch(function(ex){ toast(ex.message || "评论发表失败", "bad"); })
  .then(function(){ if(btn) btn.disabled = false; });
}
function deleteRrdComment(commentId){
  if(!rrdCommentsDocId || !commentId) return;
  UI.showConfirm({ title: "删除评论", msg: "确定删除这条评论？", okText: "删除", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(rrdCommentsDocId) + "/comments/" + encodeURIComponent(commentId)).then(function(){
      loadRrdComments();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
/* 把有引用的评论在正文里高亮；仅匹配单个文本节点内的完整引用，跨节点的长引用只在评论里展示 */
function rrdApplyHighlights(){
  var body = $("reqDocReaderBody");
  if(!body) return;
  body.querySelectorAll("mark.rrd-hl").forEach(function(m){
    m.replaceWith(document.createTextNode(m.textContent));
  });
  body.normalize();
  if(!rrdComments.length) return;
  rrdComments.forEach(function(c){
    var q = (c.quoteText || "").trim();
    if(!q) return;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        if(n.parentNode && n.parentNode.closest && n.parentNode.closest("mark.rrd-hl")) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.indexOf(q) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var node = walker.nextNode();
    if(!node) return;
    var idx = node.nodeValue.indexOf(q);
    var range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + q.length);
    var mark = document.createElement("mark");
    mark.className = "rrd-hl";
    mark.dataset.rrdHlComment = c.id;
    mark.title = "查看划线评论";
    try{ range.surroundContents(mark); }catch(e){ /* 跨节点时不强行高亮 */ }
  });
}
function ensureRrdSelBubble(){
  if(rrdSelBubble) return rrdSelBubble;
  var b = document.createElement("button");
  b.type = "button";
  b.id = "rrdSelBubble";
  b.className = "rrd-sel-bubble";
  b.textContent = "划线评论";
  b.addEventListener("mousedown", function(e){ e.preventDefault(); });
  b.addEventListener("click", function(){
    if(!rrdCommentsDocId || !rrdCanComment) return;
    toggleRrdComments(true);
    setRrdQuote(rrdSelText);
    hideRrdSelBubble();
    var sel = window.getSelection();
    if(sel) sel.removeAllRanges();
    var ta = $("rrdCommentInput");
    if(ta) ta.focus();
  });
  document.body.appendChild(b);
  rrdSelBubble = b;
  return b;
}
function hideRrdSelBubble(){
  if(rrdSelBubble) rrdSelBubble.style.display = "none";
}
function maybeShowRrdSelBubble(){
  hideRrdSelBubble();
  if(!rrdCanComment || !rrdCommentsDocId) return;
  var body = $("reqDocReaderBody");
  var sel = window.getSelection();
  if(!body || !sel || sel.isCollapsed || !sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  if(!body.contains(range.commonAncestorContainer)) return;
  var text = sel.toString().trim();
  if(!text) return;
  rrdSelText = text.length > 500 ? text.slice(0, 500) : text;
  var rect = range.getBoundingClientRect();
  if(!rect || (!rect.width && !rect.height)) return;
  var b = ensureRrdSelBubble();
  b.style.display = "block";
  var left = Math.max(8, rect.left + rect.width / 2 - b.offsetWidth / 2);
  var top = rect.top - b.offsetHeight - 8;
  if(top < 8) top = rect.bottom + 8;
  b.style.left = left + "px";
  b.style.top = top + "px";
}

/* ---------- 阅读树拖拽排序 ---------- */

var rsDragId = null;
var rsDragSource = null;
var rsDropLine = null;
var rsDropTarget = null;
var rsDroppedInside = false;
var rsHandlePressed = false;
function ensureRsDropLine(){
  if(rsDropLine) return rsDropLine;
  rsDropLine = document.createElement("div");
  rsDropLine.className = "rs-drop-line";
  return rsDropLine;
}
function removeRsDropLine(){
  if(rsDropLine && rsDropLine.parentNode) rsDropLine.parentNode.removeChild(rsDropLine);
}
/* 清掉“放入此文档/项目”的高亮（drop-into） */
function reqDocDragClearDropHighlight(tree){
  if(!tree) return;
  tree.querySelectorAll(".drop-into").forEach(function(el){ el.classList.remove("drop-into"); });
}
/* 指示线 pointer-events:none，指针压在线那几像素上时命中不到行；此时保持上一帧目标，
   否则会被误判成“拖回项目根级”，在插入位置与根级之间来回抖 */
function reqDocDragOnDropLine(e){
  if(!rsDropLine || !rsDropLine.parentNode) return false;
  var r = rsDropLine.getBoundingClientRect();
  return e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
}
function rsHitInfo(e){
  /* 返回 {node, zone}：zone = before（上 30% 插到它前面）/ into（中间，成为它的子文档）/ after（下 30% 插到它后面） */
  var st = $("reqDocSplitTree");
  if(!st) return null;
  var y = e.clientY;
  var nodes = Array.from(st.querySelectorAll(".rs-node")).filter(function(n){ return n !== rsDragSource; });
  for(var i = 0; i < nodes.length; i++){
    var r = nodes[i].getBoundingClientRect();
    if(y < r.top || y > r.bottom) continue;
    var rel = (y - r.top) / Math.max(r.height, 1);
    return { node: nodes[i], zone: rel < 0.3 ? "before" : (rel > 0.7 ? "after" : "into") };
  }
  return null;
}
function rsProjRootHit(e){
  /* 悬停在项目分组标题上：可把文档放回该项目根级 */
  if(!rsDragSource) return null;
  var proj = e.target.closest ? e.target.closest(".rs-proj") : null;
  if(!proj) return null;
  var head = proj.querySelector(".rs-proj-head");
  if(!head) return null;
  var key = head.dataset.rsProj || "";
  if(key !== (rsDragSource.dataset.rsReqid || "")) return null;
  return head;
}
function rsCanDrop(targetNode){
  if(!rsDragSource || !targetNode) return false;
  if(targetNode === rsDragSource) return false;
  if(targetNode.dataset.rsReqid !== rsDragSource.dataset.rsReqid) return false;
  /* 跨项目禁止；目标在自己子树内（含“插到后代旁边”）会成环，也禁止。同项目内跨层级/跨目录允许 */
  var desc = reqDocDescendants(rsDragSource.dataset.rsDoc);
  return !desc[targetNode.dataset.rsDoc];
}
function rsCommitReorder(){
  var source = rsDragSource;
  var target = rsDropTarget;
  var st = $("reqDocSplitTree");
  rsDragSource = null;
  rsDragId = null;
  rsDropTarget = null;
  removeRsDropLine();
  reqDocDragClearDropHighlight(st);
  if(!source || !target){ if(st) renderReqDocSplit(); return; }
  var srcId = source.dataset.rsDoc;
  if(!canEditReq(source.dataset.rsReqid)){
    toast("你对该项目只有查看权限", "warn");
    renderReqDocSplit();
    return;
  }
  var before = reqDocById(srcId);
  var oldParentId = before ? (before.parentId || null) : null;
  var items = reqDocPlanMove(srcId, target.docId, target.zone);
  if(!items){ renderReqDocSplit(); return; }
  var changed = false;
  for(var i = 0; i < items.length; i++){
    var d = reqDocById(items[i].id);
    if(d && ((d.sortOrder || 0) !== items[i].sortOrder || (d.parentId || null) !== (items[i].parentId || null))){
      changed = true;
      break;
    }
  }
  if(!changed){ renderReqDocSplit(); return; }
  API.post("/api/req-docs/reorder", { items: items }).then(function(){
    /* 本地同步 sortOrder/parentId，避免重新拉取前顺序回跳 */
    reqDocApplySortItems(items);
    /* 拖进某个文档下时顺手展开它，让移动结果可见 */
    if(target.zone === "into" && target.docId) delete reqDocCollapsedDocs[target.docId];
    renderReqDocSplit();
    var after = reqDocById(srcId);
    toast(after && (after.parentId || null) !== oldParentId ? "文档已移动" : "顺序已保存", "fs");
  }).catch(function(ex){
    toast(ex.message || "移动保存失败", "bad");
    renderReqDocSplit();
  });
}
function initReqDocSplitDrag(){
  var st = $("reqDocSplitTree");
  if(!st) return;
  st.addEventListener("mousedown", function(e){
    rsHandlePressed = !!(e.target.closest && e.target.closest(".rs-drag"));
  });
  document.addEventListener("mouseup", function(){ rsHandlePressed = false; });
  st.addEventListener("dragstart", function(e){
    var handle = e.target.closest ? e.target.closest(".rs-drag") : null;
    if(!handle && !rsHandlePressed){
      e.preventDefault();
      return;
    }
    var node = (handle || e.target).closest(".rs-node");
    if(!node){ e.preventDefault(); return; }
    var d = reqDocById(node.dataset.rsDoc);
    if(!d || !canEditReq(d.reqId)){
      e.preventDefault();
      return;
    }
    rsDragId = node.dataset.rsDoc;
    rsDragSource = node;
    rsDropTarget = null;
    rsDroppedInside = false;
    node.classList.add("dragging");
    try{
      e.dataTransfer.setData("text/plain", rsDragId);
      e.dataTransfer.effectAllowed = "move";
      if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(node, 0, 0);
    }catch(err){ /* 旧浏览器忽略 */ }
  });
  st.addEventListener("dragend", function(e){
    rsHandlePressed = false;
    var node = e.target.closest ? e.target.closest(".rs-node") : null;
    if(node) node.classList.remove("dragging");
    if(rsDragSource && rsDragSource.classList.contains("dragging")) rsDragSource.classList.remove("dragging");
    if(rsDroppedInside){
      rsDroppedInside = false;
    }else{
      removeRsDropLine();
      reqDocDragClearDropHighlight(st);
      rsDragSource = null;
      rsDragId = null;
      rsDropTarget = null;
    }
  });
  st.addEventListener("dragover", function(e){
    if(!rsDragSource){ return; }
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = "move"; }catch(err){}
    if(reqDocDragOnDropLine(e)) return;
    var hit = rsHitInfo(e);
    var line = ensureRsDropLine();
    reqDocDragClearDropHighlight(st);
    var target = null;
    if(hit && rsCanDrop(hit.node)){
      target = { zone: hit.zone, docId: hit.node.dataset.rsDoc };
      if(hit.zone === "into"){
        removeRsDropLine();
        hit.node.classList.add("drop-into");
      }else{
        var container = hit.node.parentNode;
        if(hit.zone === "after") container.insertBefore(line, hit.node.nextSibling);
        else container.insertBefore(line, hit.node);
      }
    }else if(!hit){
      var projHead = rsProjRootHit(e);
      if(projHead){
        target = { zone: "root", docId: null };
        removeRsDropLine();
        projHead.classList.add("drop-into");
      }else{
        removeRsDropLine();
      }
    }else{
      removeRsDropLine();
    }
    rsDropTarget = target;
  });
  st.addEventListener("dragleave", function(e){
    if(!rsDragSource) return;
    var stBox = $("reqDocSplitTree");
    if(stBox && !stBox.contains(e.relatedTarget)){
      removeRsDropLine();
      reqDocDragClearDropHighlight(stBox);
      rsDropTarget = null;
    }
  });
  st.addEventListener("drop", function(e){
    if(!rsDragSource) return;
    e.preventDefault();
    rsDroppedInside = true;
    rsCommitReorder();
  });
}

/* ---------- 列表树拖拽排序（与阅读树共用同一套逻辑，仅选择器不同） ---------- */

var rrDragSource = null;
var rrDropTarget = null;
var rrDroppedInside = false;
/* 行本身才是 draggable 元素，dragstart 的 target 是整行，找不到 .rr-drag；
   所以在 mousedown 时记住是否按在手柄上 */
var rrHandlePressed = false;
function rrHitInfo(e){
  /* 返回 {node, zone}：zone = before / into / after（与阅读树一致） */
  var tree = $("reqDocTree");
  if(!tree) return null;
  var y = e.clientY;
  var rows = Array.from(tree.querySelectorAll(".reqdoc-row")).filter(function(n){ return n !== rrDragSource; });
  for(var i = 0; i < rows.length; i++){
    var r = rows[i].getBoundingClientRect();
    if(y < r.top || y > r.bottom) continue;
    var rel = (y - r.top) / Math.max(r.height, 1);
    return { node: rows[i], zone: rel < 0.3 ? "before" : (rel > 0.7 ? "after" : "into") };
  }
  return null;
}
function rrProjRootHit(e){
  if(!rrDragSource) return null;
  var proj = e.target.closest ? e.target.closest(".reqdoc-proj") : null;
  if(!proj) return null;
  var head = proj.querySelector(".reqdoc-proj-head");
  if(!head) return null;
  var key = head.dataset.toggleProj || "";
  if(key !== (rrDragSource.dataset.rrReqid || "")) return null;
  return head;
}
function rrCanDrop(targetNode){
  if(!rrDragSource || !targetNode) return false;
  if(targetNode === rrDragSource) return false;
  if(targetNode.dataset.rrReqid !== rrDragSource.dataset.rrReqid) return false;
  /* 跨项目禁止；目标在自己子树内会成环，也禁止。同项目内跨目录/跨层级允许 */
  var desc = reqDocDescendants(rrDragSource.dataset.reqdoc);
  return !desc[targetNode.dataset.reqdoc];
}
function rrCommitReorder(){
  var source = rrDragSource;
  var target = rrDropTarget;
  var tree = $("reqDocTree");
  rrDragSource = null;
  rrDropTarget = null;
  removeRsDropLine();
  reqDocDragClearDropHighlight(tree);
  if(!source || !target){ if(tree) renderReqDocTree(); return; }
  var srcId = source.dataset.reqdoc;
  if(!canEditReq(source.dataset.rrReqid)){
    toast("你对该项目只有查看权限", "warn");
    renderReqDocTree();
    return;
  }
  var before = reqDocById(srcId);
  var oldParentId = before ? (before.parentId || null) : null;
  var items = reqDocPlanMove(srcId, target.docId, target.zone);
  if(!items){ renderReqDocTree(); return; }
  var changed = false;
  for(var i = 0; i < items.length; i++){
    var d = reqDocById(items[i].id);
    if(d && ((d.sortOrder || 0) !== items[i].sortOrder || (d.parentId || null) !== (items[i].parentId || null))){
      changed = true;
      break;
    }
  }
  if(!changed){ renderReqDocTree(); return; }
  API.post("/api/req-docs/reorder", { items: items }).then(function(){
    reqDocApplySortItems(items);
    if(target.zone === "into" && target.docId) delete reqDocCollapsedDocs[target.docId];
    renderReqDocTree();
    var after = reqDocById(srcId);
    toast(after && (after.parentId || null) !== oldParentId ? "文档已移动" : "顺序已保存", "fs");
  }).catch(function(ex){
    toast(ex.message || "移动保存失败", "bad");
    renderReqDocTree();
  });
}
function initReqDocTreeDrag(){
  var tree = $("reqDocTree");
  if(!tree) return;
  tree.addEventListener("mousedown", function(e){
    rrHandlePressed = !!(e.target.closest && e.target.closest(".rr-drag"));
  });
  document.addEventListener("mouseup", function(){ rrHandlePressed = false; });
  tree.addEventListener("dragstart", function(e){
    var handle = e.target.closest ? e.target.closest(".rr-drag") : null;
    if(!handle && !rrHandlePressed){ e.preventDefault(); return; }
    var row = (handle || e.target).closest(".reqdoc-row");
    if(!row){ e.preventDefault(); return; }
    var d = reqDocById(row.dataset.reqdoc);
    if(!d || !canEditReq(d.reqId)){ e.preventDefault(); return; }
    rrDragSource = row;
    rrDropTarget = null;
    rrDroppedInside = false;
    row.classList.add("dragging");
    try{
      e.dataTransfer.setData("text/plain", row.dataset.reqdoc);
      e.dataTransfer.effectAllowed = "move";
      if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 0, 0);
    }catch(err){}
  });
  tree.addEventListener("dragend", function(e){
    rrHandlePressed = false;
    var row = e.target.closest ? e.target.closest(".reqdoc-row") : null;
    if(row) row.classList.remove("dragging");
    if(rrDragSource && rrDragSource.classList.contains("dragging")) rrDragSource.classList.remove("dragging");
    if(rrDroppedInside){
      rrDroppedInside = false;
    }else{
      removeRsDropLine();
      reqDocDragClearDropHighlight(tree);
      rrDragSource = null;
      rrDropTarget = null;
    }
  });
  tree.addEventListener("dragover", function(e){
    if(!rrDragSource) return;
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = "move"; }catch(err){}
    if(reqDocDragOnDropLine(e)) return;
    var hit = rrHitInfo(e);
    var line = ensureRsDropLine();
    reqDocDragClearDropHighlight(tree);
    var target = null;
    if(hit && rrCanDrop(hit.node)){
      target = { zone: hit.zone, docId: hit.node.dataset.reqdoc };
      if(hit.zone === "into"){
        removeRsDropLine();
        hit.node.classList.add("drop-into");
      }else{
        var container = hit.node.parentNode;
        if(hit.zone === "after") container.insertBefore(line, hit.node.nextSibling);
        else container.insertBefore(line, hit.node);
      }
    }else if(!hit){
      var projHead = rrProjRootHit(e);
      if(projHead){
        target = { zone: "root", docId: null };
        removeRsDropLine();
        projHead.classList.add("drop-into");
      }else{
        removeRsDropLine();
      }
    }else{
      removeRsDropLine();
    }
    rrDropTarget = target;
  });
  tree.addEventListener("dragleave", function(e){
    if(!rrDragSource) return;
    var t = $("reqDocTree");
    if(t && !t.contains(e.relatedTarget)){
      removeRsDropLine();
      reqDocDragClearDropHighlight(t);
      rrDropTarget = null;
    }
  });
  tree.addEventListener("drop", function(e){
    if(!rrDragSource) return;
    e.preventDefault();
    rrDroppedInside = true;
    rrCommitReorder();
  });
}

/* ---------- 最近动态：空间内全部文档的创建/更新/流转记录 ---------- */

function reqDocFeedDayLabel(day){
  if(!day) return "更早";
  var today = new Date();
  var t = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
  var yest = new Date(today.getTime() - 86400000);
  var y = yest.getFullYear() + "-" + pad2(yest.getMonth() + 1) + "-" + pad2(yest.getDate());
  if(day === t) return "今天";
  if(day === y) return "昨天";
  return day.substring(5).replace("-", "月") + "日";
}
function reqDocFeedItemHTML(r){
  return '<button class="rf-item" type="button" data-rf-doc="' + esc(r.docId) + '" title="打开文档「' + esc(r.docTitle || "") + '」">' +
    '<span class="rf-actor">' + esc(r.actorName || "—") + '</span>' +
    '<span class="rf-detail">' + esc(r.detail || r.action || "") + '</span>' +
    '<span class="rf-doc">' + esc(r.docTitle || "已删除的文档") + '</span>' +
    '<span class="rf-time">' + esc(String(r.createdAt || "").substring(11, 16)) + '</span>' +
  '</button>';
}
function renderReqDocFeed(){
  var box = $("reqDocFeed");
  if(!box) return;
  var seq = ++feedSeq;
  box.innerHTML = '<div class="reqdoc-empty2">加载中…</div>';
  API.getAllPages("/api/req-docs/activities").then(function(rows){
    if(seq !== feedSeq) return;
    rows = rows || [];
    if(!rows.length){
      box.innerHTML = '<div class="reqdoc-empty2">还没有文档动态：创建、编辑或流转文档后，这里会按时间汇总展示。</div>';
      return;
    }
    var groups = [], byDay = {};
    rows.forEach(function(r){
      var day = r.createdAt ? String(r.createdAt).substring(0, 10) : "";
      if(!byDay[day]){
        byDay[day] = { day: day, items: [] };
        groups.push(byDay[day]);
      }
      byDay[day].items.push(r);
    });
    box.innerHTML = groups.map(function(g){
      return '<div class="rf-day"><h4>' + esc(reqDocFeedDayLabel(g.day)) + '</h4>' +
        g.items.map(reqDocFeedItemHTML).join("") + '</div>';
    }).join("");
  }).catch(function(ex){
    if(seq !== feedSeq) return;
    box.innerHTML = UI.errorState(ex.message || "动态加载失败");
  });
}
function reqDocParentCandidates(reqId, excludeId){
  var banned = excludeId ? reqDocDescendants(excludeId) : {};
  return reqDocList.filter(function(d){
    return d.reqId === reqId && d.id !== excludeId && !banned[d.id];
  }).sort(reqDocSort);
}
function parentOptionsHTML(list, emptyLabel){
  return '<option value="">' + esc(emptyLabel) + '</option>' + list.map(function(d){
    return '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>';
  }).join("");
}
function fillNewReqDocParents(selected){
  var sel = $("newReqDocParent");
  if(!sel) return;
  var reqId = $("newReqDocProject") ? $("newReqDocProject").value : "";
  var cur = selected === undefined ? sel.value : selected;
  sel.innerHTML = reqId
    ? parentOptionsHTML(reqDocParentCandidates(reqId, null), "无（作为顶层文档）")
    : '<option value="">无（作为顶层文档）</option>';
  sel.disabled = !reqId;
  sel.value = cur || "";
  if(sel.value !== (cur || "")) sel.value = "";
}
function fillDocParentSelect(doc){
  var sel = $("reqDocParent");
  if(!sel) return;
  var list = reqDocParentCandidates(doc.reqId, doc.id);
  sel.innerHTML = parentOptionsHTML(list, "无（顶层文档）");
  sel.disabled = !list.length;
  sel.value = doc.parentId || "";
  if(sel.value !== (doc.parentId || "")) sel.value = "";
}
function openNewReqDocDialog(reqId){
  var sel = $("newReqDocProject");
  if(!sel) return;
  var writable = rt.reqList.filter(function(r){ return canEditReq(r.id); });
  sel.innerHTML = writable.length
    ? writable.map(function(r){ return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join("")
    : '<option value="">（没有可写项目，无法新建文档）</option>';
  if(reqId && canEditReq(reqId)) sel.value = reqId;
  if($("newReqDocTitle")) $("newReqDocTitle").value = "";
  if($("newReqDocFormat")) $("newReqDocFormat").value = "markdown";
  if($("newReqDocFile")) $("newReqDocFile").value = "";
  setNewReqDocSource("blank");
  fillDocTypeSelect("newReqDocType", "requirement");
  fillNewReqDocParents("");
  setNewReqDocBusy(null);
  UI.openModal($("dlgNewReqDoc"));
  setTimeout(function(){ if($("newReqDocTitle")) $("newReqDocTitle").focus(); }, 40);
}
function setNewReqDocSource(src){
  var source = src === "file" ? "file" : "blank";
  var btns = document.querySelectorAll("#newReqDocSource [data-docsrc]");
  for(var i = 0; i < btns.length; i++){
    btns[i].setAttribute("aria-pressed", btns[i].dataset.docsrc === source ? "true" : "false");
  }
  showEl($("newReqDocFormatField"), source === "blank");
  showEl($("newReqDocFileField"), source === "file");
}
/* 按扩展名判断导入形态：word / markdown / html */
function reqDocFileKind(name){
  var m = /\.([^.]+)$/.exec(String(name || ""));
  var ext = m ? m[1].toLowerCase() : "";
  if(ext === "docx" || ext === "doc") return "word";
  if(ext === "md" || ext === "markdown" || ext === "txt") return "markdown";
  if(ext === "html" || ext === "htm") return "html";
  return null;
}
function closeNewReqDocDialog(){
  var d = $("dlgNewReqDoc");
  if(d) UI.closeModal(d);
}
function loadReqDocTasks(id){
  var list = $("reqDocTaskList");
  if(!list || !id) return;
  list.innerHTML = '<div class="tl-empty">加载中…</div>';
  if($("reqDocTaskCount")) $("reqDocTaskCount").textContent = "";
  API.getAllPages("/api/req-docs/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    if(editingDocId !== id) return;
    if($("reqDocTaskCount")) $("reqDocTaskCount").textContent = "（" + tasks.length + "）";
    list.innerHTML = tasks.length ? tasks.map(function(t){
      var status = t.boardColumn === "done" ? "已完成" : colName(t.boardColumn);
      return '<button class="req-expand-doc" type="button" data-reqdoc-task="' + esc(t.id) + '">'
        + '<span class="rd-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</span>'
        + '<span class="rd-meta">' + esc(status) + ' · ' + esc(t.owner || "未指派")
        + (t.dueDate ? ' · 截止 ' + esc(String(t.dueDate).substring(0, 10)) : '') + '</span></button>';
    }).join("") : '<div class="tl-empty">还没有关联工作项，可从当前文档直接新建。</div>';
  }).catch(function(ex){
    if(editingDocId === id) list.innerHTML = UI.errorState(ex.message || "关联工作项加载失败");
  });
}
function demandStatusName(st){
  if(st === "pass") return "已通过";
  if(st === "plan") return "已排期";
  if(st === "rej") return "已拒绝";
  return "待评审";
}
function loadReqDocDemands(id){
  var list = $("reqDocDemandList");
  if(!list || !id) return;
  list.innerHTML = '<div class="tl-empty">加载中…</div>';
  if($("reqDocDemandCount")) $("reqDocDemandCount").textContent = "";
  API.getAllPages("/api/req-docs/" + encodeURIComponent(id) + "/demands").then(function(rows){
    if(editingDocId !== id) return;
    rows = rows || [];
    if($("reqDocDemandCount")) $("reqDocDemandCount").textContent = rows.length ? "（" + rows.length + "）" : "";
    if(!rows.length){
      list.innerHTML = '<div class="tl-empty">还没有关联需求；到需求池打开需求详情，在「关联文档」里挑这份文档。</div>';
      return;
    }
    list.innerHTML = rows.map(function(d){
      return '<button class="req-expand-doc" type="button" data-doc-demand="' + esc(d.id) + '" title="查看需求详情">'
        + '<span class="rd-title">' + esc(d.title) + '</span>'
        + '<span class="rd-meta">' + esc(demandStatusName(d.status)) + ' · ' + esc(priName(d.priority)) + '</span></button>';
    }).join("");
  }).catch(function(ex){
    if(editingDocId === id) list.innerHTML = UI.errorState(ex.message || "关联需求加载失败");
  });
}
function refreshReqDocTasksIfOpen(){
  var page = $("reqDocEditPage");
  if(editingDocId && page && !page.hidden) loadReqDocTasks(editingDocId);
}
/* 工作项的文档归属或完成状态变了：文档列表里的工作项计数要一起刷新 */
function refreshReqDocListIfOpen(){
  if(activeView !== "requirements") return;
  loadReqDocs(true);
}
function createReqDocTask(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  ensureReqDocSaved(function(){
    if(!editingDocId) return;
    openTaskDrawer("backlog", null, { reqId: editingMeta.reqId, reqDocId: editingDocId });
  });
}
function setNewReqDocBusy(label){
  var ok = $("dlgNewReqDocOk");
  if(!ok) return;
  ok.disabled = !!label;
  ok.textContent = label || "创建并编辑";
}
/* 创建已成功、导入却失败：不静默留下空稿，直接进入草稿让用户继续编辑或重新导入 */
function recoverFailedNewDocImport(doc, file, ex){
  closeNewReqDocDialog();
  loadReqDocs(true);
  openReqDocEditor(doc.id);
  toast("导入失败：" + ((ex && ex.message) || "网络异常") +
    "；已创建草稿「" + (doc.title || file.name) + "」，可继续编辑，也可在编辑器里重新导入", "bad", 12000);
}
function submitNewReqDoc(){
  var ok = $("dlgNewReqDocOk");
  if(ok && ok.disabled) return;
  var reqId = $("newReqDocProject").value;
  var title = ($("newReqDocTitle").value || "").trim();
  if(!reqId){ toast("还没有可写项目，请先到「项目」里建一个", "warn"); return; }
  if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  var source = document.querySelector('#newReqDocSource [data-docsrc][aria-pressed="true"]');
  var isFile = !!(source && source.dataset.docsrc === "file");
  var file = isFile && $("newReqDocFile") ? $("newReqDocFile").files[0] : null;
  if(isFile && !file){ toast("请选择要上传的文件", "warn"); return; }
  if(file && file.size > 10 * 1024 * 1024){ toast("文件超过 10MB，请拆分后再导入", "warn"); return; }
  var kind = file ? reqDocFileKind(file.name) : null;
  if(isFile && !kind){ toast("暂不支持该文件格式，请上传 Word、Markdown、TXT 或 HTML 文件", "warn"); return; }
  if(!title && file) title = file.name.replace(/\.[^.]+$/, "");
  if(!title){ toast("请填写文档名称", "warn"); $("newReqDocTitle").focus(); return; }
  var format = $("newReqDocFormat") ? $("newReqDocFormat").value : "markdown";
  if(kind === "word" || kind === "html") format = "html";
  if(kind === "markdown") format = "markdown";
  var parentId = $("newReqDocParent") ? $("newReqDocParent").value : "";
  var createdDoc = null;
  setNewReqDocBusy("创建文档…");
  API.post("/api/req-docs", {
    reqId: reqId, title: title, content: "", status: "draft",
    format: format, docType: $("newReqDocType").value, parentId: parentId || null
  })
    .then(function(doc){
      createdDoc = doc;
      if(isFile){
        return kind === "word"
          ? importWordForNewDoc(doc, file, setNewReqDocBusy)
          : importTextForNewDoc(doc, file, kind, setNewReqDocBusy);
      }
      closeNewReqDocDialog();
      loadReqDocs(true);
      openReqDocEditor(doc.id);
      toast("已创建「" + doc.title + "」，接着写正文", "fs");
      return null;
    })
    .catch(function(ex){
      if(createdDoc) recoverFailedNewDocImport(createdDoc, file, ex);
      else toast("创建文档失败：" + (ex.message || "网络异常"), "bad");
    })
    .then(function(){ setNewReqDocBusy(null); });
}
function putReqDocContent(doc, content, format){
  return API.put("/api/req-docs/" + encodeURIComponent(doc.id), {
    reqId: doc.reqId, title: doc.title, content: content, status: "draft",
    format: format, docType: doc.docType || "requirement", parentId: doc.parentId || null,
    updatedAt: doc.updatedAt || ""
  });
}
function readTextFile(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){ resolve(String(reader.result || "")); };
    reader.onerror = function(){ reject(new Error("读取文件失败")); };
    reader.readAsText(file, "utf-8");
  });
}
function finishNewReqDocImport(doc, fileName, format){
  closeNewReqDocDialog();
  loadReqDocs(true);
  openReqDocEditor(doc.id);
  toast("已导入「" + fileName + "」为" + (format === "markdown" ? " Markdown" : "富文本")
    + "，可直接在线编辑", "fs");
}
function importTextForNewDoc(doc, file, format, onStage){
  if(onStage) onStage("读取文件…");
  return readTextFile(file).then(function(text){
    if(onStage) onStage("写入正文…");
    return putReqDocContent(doc, text, format);
  }).then(function(){ finishNewReqDocImport(doc, file.name, format); });
}
function importWordForNewDoc(doc, file, onStage){
  if(onStage) onStage("转换文件…");
  var fd = new FormData();
  fd.append("file", file);
  var url = API.url("/api/req-docs/import-word" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    if(!json || json.code !== 0){ throw new Error((json && json.message) || "导入失败"); }
    if(onStage) onStage("写入正文…");
    var content = (json.data && json.data.content) || "";
    return putReqDocContent(doc, content, "html")
      .then(function(){ finishNewReqDocImport(doc, file.name, "html"); });
  });
}
function openReqDocEditor(id){
  var seq = ++reqDocOpenSeq;
  setReqDocHydrating(false);
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== reqDocOpenSeq) return;   // 连续点开多份：丢弃过期的响应
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    reqDocDirty = false;
    editingMeta = {
      title: doc.title || "",
      reqId: doc.reqId || "",
      status: doc.status || "draft",
      format: doc.format === "markdown" ? "markdown" : "html",
      docType: doc.docType || "other",
      parentId: doc.parentId || "",
      publishedAt: doc.publishedAt || null,
      ownerUserId: doc.ownerUserId || "",
      updatedAt: doc.updatedAt || ""
    };
    /* 先让编辑页可见，再创建编辑器：隐藏容器里量出来的宽高是 0 */
    if($("reqDocListPage")) $("reqDocListPage").hidden = true;
    if($("reqDocEditPage")) $("reqDocEditPage").hidden = false;
    reqDocReadOnly = !canEditReq(doc.reqId);
    fillReqDocEditor(doc);
    applyReqDocReadOnly(reqDocReadOnly);
    refreshReqDocPublishBtn();
    setTocVisible(tocVisiblePref());
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名文档");
    activityUI.loadInto($("reqDocActivityList"), "/api/req-docs/" + encodeURIComponent(doc.id) + "/activities");
    loadReqDocTasks(doc.id);
    loadReqDocDemands(doc.id);
    setReqDocCommentQuote(null);
    reqDocLatestSel = null;
    loadReqDocComments(doc.id);
    /* 打开时停在顶部：目录高亮与滚动位置对齐 */
    try{ window.scrollTo(0, 0); }catch(e){ /* 忽略 */ }
    setTimeout(refreshTocActive, 60);
  }).catch(function(ex){ toast(ex.message || "文档加载失败", "bad"); });
}
function closeReqDocEditor(){
  setReqDocHydrating(false);
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
  editingDocId = null;
  reqDirtyReset();
  renderReqDocMode();
  /* 阅读视图里刚编辑过：右侧正文可能是旧的，重新拉一次 */
  if(reqDocMode === "read" && splitDocId) loadReqDocSplitDoc(splitDocId);
}
function reqDirtyReset(){
  reqDocDirty = false;
  state.reqDocId = null;
}
function tryCloseReqDocEditor(nextView){
  if(nextView) reqDocPendingView = nextView;
  if(!reqDocDirty){ closeReqDocEditor(); continueReqDocRoute(); return; }
  UI.openModal($("dlgReqDocClose"));
}
function closeReqDocCloseDialog(keepPending){
  if(!keepPending) reqDocPendingView = null;
  var d = $("dlgReqDocClose");
  if(d) UI.closeModal(d);
}
function continueReqDocRoute(){
  var to = reqDocPendingView;
  reqDocPendingView = null;
  if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
}
var aiSplitDrafts = [];
var aiBusy = false;
function ensureReqDocSaved(fn){
  if(!reqDocDirty){ fn(); return; }
  saveReqDoc().then(function(doc){ if(doc) fn(); });
}
function aiBtnBusy(btn, busy, label){
  if(!btn) return;
  btn.disabled = busy;
  if(busy){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = label || "处理中…";
  }else if(btn.dataset.label){
    btn.textContent = btn.dataset.label;
  }
}
function aiErrMsg(msg){
  var m = msg || "AI 调用失败";
  if(m.indexOf("个人设置") < 0 &&
     (m.indexOf("AI 设置") >= 0 || m.indexOf("API Key") >= 0 || m.indexOf("AI 开关") >= 0
      || m.indexOf("AI 配置") >= 0)){
    m += "（到「个人设置 → AI 设置」里配一下）";
  }
  return m;
}
function aiUsageText(u){
  if(!u) return "";
  return "本次 " + (u.totalTokens || 0) + " tokens（输入 " + (u.promptTokens || 0)
    + " / 输出 " + (u.completionTokens || 0) + "）· 模型 " + (u.model || "—")
    + (u.jsonMode ? "" : " · 该模型不支持 JSON 模式，已降级解析");
}
function runAiSplit(){
  if(!editingDocId || aiBusy) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var btn = $("reqDocAiSplit");
  ensureReqDocSaved(function(){
    aiBusy = true;
    aiBtnBusy(btn, true, "拆分中…");
    API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/split", {}).then(function(d){
      aiSplitDrafts = d.tasks || [];
      renderAiSplit(d);
      UI.openModal($("dlgAiSplit"));
    }).catch(function(ex){
      toast(aiErrMsg(ex && ex.message), "bad");
    }).then(function(){
      aiBusy = false;
      aiBtnBusy(btn, false);
    });
  });
}
function renderAiSplit(d){
  $("dlgAiSplitMsg").textContent = "「" + (d.reqDocTitle || "") + "」正文 " + (d.docChars || 0)
    + " 字，AI 拆出 " + aiSplitDrafts.length + " 条。勾选要创建的，标题可以直接改；没勾的不会落库。";
  $("aiSplitList").innerHTML = aiSplitDrafts.map(function(t, i){
    var p = String(t.priority || "P2").toUpperCase();
    var pcls = p === "P0" ? "p0" : (p === "P1" ? "p1" : "");
    return '<div class="ai-item on" data-i="' + i + '">' +
      '<input type="checkbox" checked data-pick="' + i + '" aria-label="选择工作项">' +
      '<div class="ai-main">' +
        '<input class="ai-title" type="text" maxlength="60" value="' + esc(t.title) + '" data-title="' + i + '" aria-label="工作项标题">' +
        (t.description ? '<div class="ai-desc">' + esc(t.description) + '</div>' : '') +
        '<div class="ai-meta">' +
          '<span class="ai-tag ' + pcls + '" style="color:' + esc(priColor(p)) + '">' + esc(priName(p)) + '</span>' +
          (t.dependsOnIndex >= 0 ? '<span>依赖第 ' + (t.dependsOnIndex + 1) + ' 条</span>' : '') +
          (t.reason ? '<span class="ai-reason">' + esc(t.reason) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");
  $("aiSplitUsage").textContent = aiUsageText(d.usage);
}
function applyAiSplit(){
  var picked = [];
  var nodes = document.querySelectorAll("#aiSplitList .ai-item");
  for(var i = 0; i < nodes.length; i++){
    var cb = nodes[i].querySelector("input[type=checkbox]");
    if(!cb || !cb.checked) continue;
    var idx = Number(nodes[i].dataset.i);
    var src = aiSplitDrafts[idx] || {};
    var titleEl = nodes[i].querySelector(".ai-title");
    var title = (titleEl ? titleEl.value : src.title || "").trim();
    if(!title) continue;
    picked.push({
      title: title,
      description: src.description || "",
      priority: src.priority || "P2",
      dependsOnIndex: src.dependsOnIndex == null ? -1 : src.dependsOnIndex
    });
  }
  if(!picked.length){ toast("至少选一条要创建的工作项", "warn"); return; }

  var btn = $("dlgAiSplitOk");
  btn.disabled = true;
  API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/tasks", { tasks: picked }).then(function(r){
    btn.disabled = false;
    UI.closeModal($("dlgAiSplit"));
    var msg = "已创建 " + r.created + " 个工作项";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 个同名工作项";
    if(r.failed && r.failed.length) msg += "，" + r.failed.length + " 个失败";
    toast(msg, r.failed && r.failed.length ? "warn" : "fs");
    if(r.failed && r.failed.length){
      console.warn("AI 拆分落库失败项", r.failed);
    }
    /* 任务数变了：列表页的「任务/完成」计数要跟着动 */
    loadReqDocs(true);
  }).catch(function(ex){
    btn.disabled = false;
    toast(aiErrMsg(ex && ex.message), "bad");
  });
}
function runAiAudit(){
  if(!editingDocId || aiBusy) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var btn = $("reqDocAiAudit");
  ensureReqDocSaved(function(){
    aiBusy = true;
    aiBtnBusy(btn, true, "检查中…");
    API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/audit", {}).then(function(d){
      renderAiAudit(d);
      UI.openModal($("dlgAiAudit"));
    }).catch(function(ex){
      toast(aiErrMsg(ex && ex.message), "bad");
    }).then(function(){
      aiBusy = false;
      aiBtnBusy(btn, false);
    });
  });
}
function renderAiAudit(d){
  var V = { done: "已完成", mostly: "基本完成", partial: "做了一部分", not_started: "基本没开始" };
  /* 配色跟结论文字走同一套档位：done→绿 / mostly·partial→橙 / not_started→红 */
  var cls = d.verdict === "done" ? "good" : (d.verdict === "not_started" ? "bad" : "warn");
  var color = cls === "good" ? "var(--success)" : (cls === "warn" ? "var(--warning)" : "var(--danger)");

  $("dlgAiAuditTitle").textContent = "完成度检查 · " + (d.reqDocTitle || "");
  $("dlgAiAuditSummary").textContent = d.summary || "—";

  $("aiAuditScore").className = "ai-score " + cls;
  $("aiAuditScore").innerHTML =
    '<div class="big">' + d.coverage + '<small>%</small></div>' +
    '<div class="sc-main">' +
      '<div class="bar"><i style="width:' + Math.max(2, d.coverage) + '%;--c:' + color + '"></i></div>' +
      '<div class="sc-lbl">' + esc(V[d.verdict] || d.verdict) + ' · 共拆出 ' + d.totalPoints + ' 个功能点，按状态加权计算</div>' +
      '<div class="sc-cnt">已完成 ' + d.donePoints + ' · 进行中 ' + d.doingPoints
        + ' · 未开始 ' + d.todoPoints + ' · <b>缺工作项 ' + d.missingPoints + '</b></div>' +
    '</div>';

  var S = { done: "已完成", doing: "进行中", todo: "未开始", missing: "缺工作项" };
  /* 缺工作项的排最前面：那才是用户真正要动手的地方 */
  var order = { missing: 0, todo: 1, doing: 2, done: 3 };
  var pts = (d.points || []).slice().sort(function(a, b){
    return (order[a.status] == null ? 9 : order[a.status]) - (order[b.status] == null ? 9 : order[b.status]);
  });
  $("aiAuditList").innerHTML = pts.map(function(p){
    /* 状态同时进 class 与文案：只接受四个已知值，避免异常值破坏属性 */
    var st = S[p.status] ? p.status : "missing";
    return '<div class="ai-item' + (st === "missing" ? " on" : "") + '">' +
      '<div class="ai-main">' +
        '<div class="ai-meta">' +
          '<span class="ai-tag ' + st + '">' + (S[st] || st) + '</span>' +
          (p.taskTitle ? '<span>对应工作项：' + esc(p.taskTitle) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);line-height:19px">' + esc(p.point) + '</div>' +
        (p.note ? '<div class="ai-reason">' + esc(p.note) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join("");

  var extra = d.nextStep ? "建议下一步：" + d.nextStep + "　·　" : "";
  $("aiAuditUsage").textContent = extra + aiUsageText(d.usage);
}
if($("reqDocAiSplit")){
  $("reqDocAiSplit").addEventListener("click", runAiSplit);
  $("reqDocAiAudit").addEventListener("click", runAiAudit);
  $("dlgAiSplitCancel").addEventListener("click", function(){ UI.closeModal($("dlgAiSplit")); });
  $("dlgAiSplitOk").addEventListener("click", applyAiSplit);
  $("dlgAiAuditClose").addEventListener("click", function(){ UI.closeModal($("dlgAiAudit")); });
  /* 勾选态与卡片底色联动：一眼看出哪几条会被创建 */
  $("aiSplitList").addEventListener("change", function(e){
    var cb = e.target;
    if(!cb || cb.type !== "checkbox") return;
    var item = cb.closest(".ai-item");
    if(item) item.classList.toggle("on", cb.checked);
  });
}
function loadMarkdownLib(){
  if(typeof window.marked !== "undefined" && window.DOMPurify) return Promise.resolve();
  if(mdLibPromise) return mdLibPromise;
  var loadScript = function(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = src;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error("Markdown 预览组件加载失败")); };
      document.head.appendChild(s);
    });
  };
  mdLibPromise = loadScript("vendor/markdown/marked.min.js")
    .then(function(){ return loadScript("vendor/markdown/purify.min.js"); })
    .catch(function(ex){ mdLibPromise = null; throw ex; });
  return mdLibPromise;
}
function renderMarkdownPreview(){
  var src = $("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "";
  var box = $("reqDocMdPreview");
  if(!box) return;
  loadMarkdownLib().then(function(){
    /* 预览是本地渲染，仍走 DOMPurify：文档内容可能来自导入文件 */
    var html = "";
    try{ html = window.marked.parse(src, { gfm: true, breaks: false }); }catch(e){ html = ""; }
    box.innerHTML = window.DOMPurify.sanitize(html);
    var links = box.querySelectorAll("a[href]");
    for(var i = 0; i < links.length; i++){
      links[i].setAttribute("target", "_blank");
      links[i].setAttribute("rel", "noopener noreferrer");
    }
    rebuildToc();
  }).catch(function(ex){
    box.innerHTML = '<div class="rt-empty">' + esc(ex.message || "Markdown 预览加载失败") + '</div>';
  });
}
function scheduleMdPreview(){
  if(mdRenderTimer) clearTimeout(mdRenderTimer);
  mdRenderTimer = setTimeout(function(){ mdRenderTimer = null; renderMarkdownPreview(); }, 180);
}
function setMdMode(mode){
  mdMode = mode === "edit" || mode === "preview" ? mode : "split";
  var split = $("reqDocMdSplit");
  if(split){
    split.classList.remove("md-edit", "md-split", "md-preview");
    split.classList.add("md-" + mdMode);
  }
  var btns = document.querySelectorAll("#reqDocMdSeg [data-md-mode]");
  for(var i = 0; i < btns.length; i++){
    btns[i].setAttribute("aria-pressed", btns[i].dataset.mdMode === mdMode ? "true" : "false");
  }
  try{ localStorage.setItem("ds.reqMdMode", mdMode); }catch(e){ /* 隐私模式忽略 */ }
  setTimeout(refreshTocActive, 30);
}
function setDocFormatUI(format){
  var md = format === "markdown";
  showEl($("reqDocRichBody"), !md);
  showEl($("reqDocMdBody"), md);
  var badge = $("reqDocFormat");
  if(badge){
    showEl(badge, true);
    badge.textContent = md ? "Markdown" : "富文本";
    badge.className = "reqdoc-fmt " + (md ? "md" : "html");
  }
  var imp = $("reqDocImport"), exp = $("reqDocExport");
  if(imp) imp.title = "导入 Word / Markdown / TXT / HTML 文件";
  if(exp) exp.title = md ? "导出为 Markdown 文件" : "导出为 HTML 文件";
}
function fillMarkdownEditor(doc){
  if($("reqDocMdCanvas")) $("reqDocMdCanvas").value = doc.content || "";
  setMdMode(mdModePref());
  updateReqDocCount();
  renderMarkdownPreview();
}
function fillReqDocEditor(doc){
  var id = doc.id;
  editingMeta = {
    title: doc.title || "",
    reqId: doc.reqId || "",
    status: doc.status || "draft",
    format: doc.format === "markdown" ? "markdown" : "html",
    docType: doc.docType || "other",
    parentId: doc.parentId || "",
    /* 发布状态与作者必须随正文一起回填：否则打开/保存已发布文档后按钮误显示「发布」、分享提示「尚未发布」 */
    publishedAt: doc.publishedAt || null,
    ownerUserId: doc.ownerUserId || "",
    updatedAt: doc.updatedAt || ""
  };
  refreshReqDocPublishBtn();
  setDocFormatUI(editingMeta.format);
  fillDocTypeSelect("reqDocType", editingMeta.docType);
  fillDocParentSelect(doc);
  if(isMarkdownDoc()){
    reqEditorBaseline = null;
    fillMarkdownEditor(doc);
  }else if(reqEditor){
    setReqEditorContents(doc.content);
    updateReqDocCount();
    rebuildToc();
  }else{
    /* 首次打开：编辑器按需下载，下载完再灌正文（期间用户切走就丢弃结果） */
    setReqDocHydrating(true);
    ensureEditor().then(function(ed){
      setReqDocHydrating(false);
      if(!ed || editingDocId !== id) return;
      setReqEditorContents(doc.content);
      updateReqDocCount();
      rebuildToc();
      applyReqDocReadOnly(reqDocReadOnly);
    }).catch(function(ex){
      setReqDocHydrating(false);
      toast(ex.message || "编辑器加载失败", "bad");
    });
  }
  $("reqDocSaved").textContent = doc.updatedAt ? ("最后保存 " + fmtTs(doc.updatedAt)) : "尚未保存";
  reqDocDirty = false;
  /* 正文换人了：目录要跟着换（重建前先清掉旧的高亮） */
  tocActive = null;
  rebuildToc();
  applyReqDocReadOnly(reqDocReadOnly);
}
function fillReqDocProjectSelect(selected){
  var sel = $("reqDocProject");
  if(!sel) return;
  var cur = selected === undefined ? sel.value : selected;
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === cur; });
  sel.innerHTML = '<option value="">选择项目</option>' + list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
  if(cur) sel.value = cur;
}
function markReqDocDirty(){
  if(reqDocReadOnly) return;
  updateReqDocCount();
  if(reqDocDirty) return;
  reqDocDirty = true;
  if($("reqDocSaved")) $("reqDocSaved").textContent = "有未保存的修改";
}
function reqDocPlainText(){
  if(isMarkdownDoc()) return $("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "";
  return reqEditor ? reqEditor.getText() : "";
}
function updateReqDocCount(){
  var el = $("reqDocCount");
  if(!el) return;
  var n = reqDocPlainText().replace(/\s+/g, "").length;
  el.textContent = n ? (n + " 字") : "";
}
function copyReqDoc(){
  var text = reqDocPlainText().trim();
  if(!text){ toast("正文是空的，没有可复制的内容", "warn"); return; }
  var ok = function(){ toast("已复制全文（" + text.length + " 字）", "fs"); };
  var fail = function(){
    /* 降级：选中正文后走 execCommand */
    var area = reqEditor && reqEditor.core ? reqEditor.core.getFrameElement && reqEditor.core.getFrameElement() : null;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        toast("复制失败，请手动选中后按 Ctrl+C", "warn");
      }else{
        toast("当前浏览器不支持一键复制，请手动选中后按 Ctrl+C", "warn");
      }
    }catch(e){ toast("复制失败，请手动选中后按 Ctrl+C", "warn"); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(ok).catch(fail);
  }else{
    fail();
  }
}
var tocItems = [];
var tocCollapsed = {};
var tocActive = null;
var tocBuildTimer = null;

/* ---------- 文档评论 ---------- */

var reqDocCommentQuote = null;
var reqDocLatestSel = null;
/* 点击按钮会收走选区，所以先把正文内的最近一次选区存下来再取用 */
function rememberReqDocSelection(){
  var sel = window.getSelection();
  if(!sel || !sel.rangeCount) return;
  var page = $("reqDocEditPage");
  if(!page || page.hidden) return;
  var anchor = sel.anchorNode;
  if(!anchor || !page.contains(anchor)) return;
  var text = sel.toString().replace(/\s+/g, " ").trim();
  reqDocLatestSel = text ? text.slice(0, 500) : null;
}
function setReqDocCommentQuote(text){
  reqDocCommentQuote = text || null;
  var chip = $("reqDocCommentQuoteChip");
  var txt = $("reqDocCommentQuoteText");
  if(chip) chip.hidden = !reqDocCommentQuote;
  if(txt) txt.textContent = reqDocCommentQuote || "";
}
function quoteReqDocSelection(){
  if(!reqDocLatestSel){ toast("先在正文中选中要引用的内容，再点「引用选中」", "warn"); return; }
  setReqDocCommentQuote(reqDocLatestSel);
  toast("已引用选中内容", "fs");
}

function loadReqDocComments(docId){
  var list = $("reqDocCommentList");
  var count = $("reqDocCommentsCount");
  var form = $("reqDocCommentForm");
  if(!list) return;
  list.innerHTML = '<div class="reqdoc-comment-empty">加载中…</div>';
  if(form) form.style.display = roleReadOnly() ? "none" : "";
  API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/comments").then(function(rows){
    if(editingDocId !== docId) return;
    rows = rows || [];
    if(count) count.textContent = rows.length ? "（" + rows.length + "）" : "";
    if(!rows.length){
      list.innerHTML = '<div class="reqdoc-comment-empty">还没有评论</div>';
      return;
    }
    list.innerHTML = rows.map(function(c){
      return '<div class="reqdoc-comment-item" data-comment-id="' + esc(c.id) + '">'
        + '<div class="reqdoc-comment-head">'
        +   '<span class="reqdoc-comment-user">' + esc(c.userName || "—") + '</span>'
        +   '<span class="reqdoc-comment-time">' + esc(fmtTs(c.createdAt) || "—") + '</span>'
        + '</div>'
        + (c.quoteText ? '<div class="reqdoc-comment-quote">' + esc(c.quoteText) + '</div>' : '')
        + '<div class="reqdoc-comment-body">' + esc(c.content) + '</div>'
        + (c.deletable ? '<div class="reqdoc-comment-actions-r"><button class="btn sm danger" type="button" data-del-comment="1">删除</button></div>' : '')
        + '</div>';
    }).join("");
  }).catch(function(ex){
    if(editingDocId !== docId) return;
    list.innerHTML = '<div class="reqdoc-comment-empty">' + esc(ex.message || "评论加载失败") + '</div>';
  });
}
function submitReqDocComment(){
  if(!editingDocId || roleReadOnly()){ toast("查看者不能发表评论", "warn"); return; }
  var ta = $("reqDocCommentInput");
  var content = (ta && ta.value || "").trim();
  if(!content){ toast("评论内容不能为空", "warn"); if(ta) ta.focus(); return; }
  var btn = $("reqDocCommentSend");
  /* Ctrl/⌘+Enter 不经过按钮：在途时直接忽略，避免同一条评论发两次 */
  if(btn && btn.disabled) return;
  if(btn) btn.disabled = true;
  var body = { content: content };
  if(reqDocCommentQuote) body.quoteText = reqDocCommentQuote;
  API.post("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments", body).then(function(){
    if(ta) ta.value = "";
    setReqDocCommentQuote(null);
    loadReqDocComments(editingDocId);
  }).catch(function(ex){ toast(ex.message || "评论发表失败", "bad"); })
  .then(function(){ if(btn) btn.disabled = false; });
}
function deleteReqDocComment(commentId){
  if(!editingDocId || !commentId) return;
  UI.showConfirm({ title: "删除评论", msg: "确定删除这条评论？", okText: "删除", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments/" + encodeURIComponent(commentId)).then(function(){
      loadReqDocComments(editingDocId);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------- 历史版本：列表、预览、恢复 ---------- */

var reqDocHistories = [];
var reqDocHistorySel = null;
var reqDocHistoryCompareMode = false;
var reqDocCompareCurrentDoc = null;
var reqDocCompareHistoryDoc = null;
var reqDocTextDiffVisible = false;
/* 历史弹窗与编辑器解耦：阅读模式也能打开；docId 记录目标文档，fromReader 决定恢复后回到哪里 */
var reqDocHistoryDocId = null;
var reqDocHistoryFromReader = false;
var reqDocHistoryCanRestore = true;
function openReqDocHistory(docId, opts){
  docId = docId || editingDocId;
  if(!docId) return;
  opts = opts || {};
  reqDocHistoryDocId = docId;
  reqDocHistoryFromReader = !!opts.fromReader;
  reqDocHistoryCanRestore = opts.canRestore != null ? !!opts.canRestore : !reqDocReadOnly;
  var layer = $("dlgReqDocHistory");
  var list = $("reqDocHistoryList");
  var verTitle = $("reqDocHistoryVerTitle");
  var restore = $("reqDocHistoryRestore");
  var preview = $("reqDocHistoryContent");
  if(!layer || !list) return;
  reqDocHistories = [];
  reqDocHistorySel = null;
  reqDocCompareCurrentDoc = null;
  reqDocCompareHistoryDoc = null;
  setReqDocHistoryCompareMode(false);
  setReqDocTextDiffVisible(false);
  list.innerHTML = '<div class="rh-empty">加载中…</div>';
  preview.innerHTML = '<div class="rh-empty">点击左侧版本查看正文</div>';
  verTitle.textContent = "";
  restore.style.display = reqDocHistoryCanRestore ? "" : "none";
  UI.openModal(layer);
  API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/history").then(function(rows){
    if(docId !== reqDocHistoryDocId) return;
    rows = rows || [];
    reqDocHistories = rows;
    list.innerHTML = rows.length ? rows.map(function(h, i){
      return '<button class="rh-row" type="button" data-history-id="' + esc(h.id) + '">'
        + '<span class="rh-ver">第 ' + h.versionNo + ' 版' + (i === 0 ? '<span class="rh-latest">最新</span>' : '') + '</span>'
        + '<span class="rh-main">'
        +   '<span class="rh-t">' + esc(h.title || "未命名") + '</span>'
        +   '<span class="rh-m">' + esc(h.savedBy || "—") + ' · ' + esc(fmtTs(h.createdAt) || "—") + '</span>'
        + '</span></button>';
    }).join("") : '<div class="rh-empty">还没有历史快照：保存正文后自动生成</div>';
    /* 与语雀/飞书一致：打开即预览最近一版，而不是空白等待点击 */
    if(rows.length) loadReqDocHistoryPreview(rows[0].id);
  }).catch(function(ex){
    list.innerHTML = '<div class="rh-empty">' + esc(ex.message || "历史版本加载失败") + '</div>';
  });
}
function renderReqDocHistoryPreview(h, box){
  loadMarkdownLib().then(function(){
    var html;
    if(h.format === "markdown"){
      try{ html = window.marked.parse(h.content || "", { gfm: true, breaks: false }); }catch(e){ html = ""; }
    }else{
      html = h.content || "";
    }
    box.innerHTML = window.DOMPurify.sanitize(html);
    var links = box.querySelectorAll("a[href]");
    for(var i = 0; i < links.length; i++){
      links[i].setAttribute("target", "_blank");
      links[i].setAttribute("rel", "noopener noreferrer");
    }
  }).catch(function(ex){
    box.innerHTML = '<div class="rh-empty">' + esc(ex.message || "预览组件加载失败") + '</div>';
  });
}
function setReqDocHistoryCompareMode(on){
  reqDocHistoryCompareMode = !!on;
  var btn = $("reqDocHistoryCompare");
  var preview = $("reqDocHistoryContent");
  var wrap = $("reqDocHistoryCompareWrap");
  if(btn) btn.textContent = reqDocHistoryCompareMode ? "取消对比" : "与当前对比";
  if(btn) btn.classList.toggle("primary", reqDocHistoryCompareMode);
  if(preview) preview.hidden = reqDocHistoryCompareMode;
  if(wrap) wrap.hidden = !reqDocHistoryCompareMode;
}
function toggleReqDocHistoryCompare(){
  if(!reqDocHistoryDocId){ toast("没有打开的文档", "warn"); return; }
  if(!reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  setReqDocHistoryCompareMode(!reqDocHistoryCompareMode);
  if(reqDocHistoryCompareMode){ loadReqDocHistoryCompare(reqDocHistorySel); }
  else { loadReqDocHistoryPreview(reqDocHistorySel); }
}
function loadReqDocHistoryCompare(historyId){
  if(!reqDocHistoryDocId || !historyId) return;
  var currentBox = $("reqDocHistoryCompareCurrent");
  var historyBox = $("reqDocHistoryCompareHistory");
  if(currentBox) currentBox.innerHTML = '<div class="rh-empty">加载中…</div>';
  if(historyBox) historyBox.innerHTML = '<div class="rh-empty">加载中…</div>';
  var docId = reqDocHistoryDocId;
  Promise.all([
    API.get("/api/req-docs/" + encodeURIComponent(docId)),
    API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history/" + encodeURIComponent(historyId))
  ]).then(function(results){
    if(docId !== reqDocHistoryDocId || !reqDocHistoryCompareMode) return;
    var current = results[0];
    var h = results[1];
    reqDocCompareCurrentDoc = current;
    reqDocCompareHistoryDoc = h;
    var verTitle = $("reqDocHistoryVerTitle");
    if(verTitle) verTitle.textContent = "第 " + h.versionNo + " 版 · " + (h.savedBy || "—") + " · " + (fmtTs(h.createdAt) || "—") + " 与当前对比";
    if(currentBox) renderReqDocHistoryPreview({ format: current.format, content: current.content }, currentBox);
    if(historyBox) renderReqDocHistoryPreview(h, historyBox);
    if(reqDocTextDiffVisible) renderReqDocTextDiff();
  }).catch(function(ex){
    var msg = esc(ex.message || "对比内容加载失败");
    if(currentBox) currentBox.innerHTML = '<div class="rh-empty">' + msg + '</div>';
    if(historyBox) historyBox.innerHTML = '<div class="rh-empty">' + msg + '</div>';
  });
}
function setReqDocTextDiffVisible(on){
  reqDocTextDiffVisible = !!on;
  var wrap = $("reqDocHistoryDiffWrap");
  var btn = $("reqDocHistoryTextDiff");
  if(wrap) wrap.hidden = !reqDocTextDiffVisible;
  if(btn){
    btn.classList.toggle("primary", reqDocTextDiffVisible);
    btn.textContent = reqDocTextDiffVisible ? "隐藏差异" : "文本差异";
  }
  if(reqDocTextDiffVisible) renderReqDocTextDiff();
}
function toggleReqDocTextDiff(){
  if(!reqDocHistoryDocId){ toast("没有打开的文档", "warn"); return; }
  if(!reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  if(!reqDocHistoryCompareMode){
    setReqDocHistoryCompareMode(true);
    loadReqDocHistoryCompare(reqDocHistorySel);
  }
  setReqDocTextDiffVisible(!reqDocTextDiffVisible);
}
function renderReqDocTextDiff(){
  var box = $("reqDocHistoryDiffContent");
  if(!box) return;
  if(!reqDocCompareCurrentDoc || !reqDocCompareHistoryDoc){
    box.innerHTML = '<div class="rh-empty">加载对比内容后显示差异</div>';
    return;
  }
  var oldText = docContentToPlainText(reqDocCompareHistoryDoc);
  var newText = docContentToPlainText(reqDocCompareCurrentDoc);
  if(oldText === newText){
    box.innerHTML = '<div class="rh-empty">内容完全一致</div>';
    return;
  }
  var lines = computeLineDiff(oldText, newText);
  box.innerHTML = lines.map(function(l){
    var sign = l.type === "add" ? "+" : (l.type === "del" ? "-" : " ");
    return '<div class="diff-line diff-line-' + l.type + '"><span class="diff-sign">' + sign + '</span>' + esc(l.text) + '</div>';
  }).join("");
}
function docContentToPlainText(doc){
  var raw = doc && doc.content ? doc.content : "";
  if(doc && doc.format === "markdown") return raw;
  try{
    var parsed = new DOMParser().parseFromString(raw, "text/html");
    return parsed.body.textContent || "";
  }catch(e){ return raw; }
}
function computeLineDiff(oldText, newText){
  var a = (oldText || "").split("\n");
  var b = (newText || "").split("\n");
  var MAX = 1200;
  if(a.length > MAX || b.length > MAX){
    return [{ type: "same", text: "（文档超过 1200 行，暂不支持文本差异对比）" }];
  }
  var n = a.length, m = b.length;
  var dp = [];
  var i, j;
  for(i = 0; i <= n; i++){ dp[i] = []; dp[i][m] = 0; }
  for(j = 0; j <= m; j++){ dp[n][j] = 0; }
  for(i = n - 1; i >= 0; i--){
    for(j = m - 1; j >= 0; j--){
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  var out = [];
  i = 0; j = 0;
  while(i < n && j < m){
    if(a[i] === b[j]){ out.push({ type: "same", text: a[i] }); i++; j++; }
    else if(dp[i + 1][j] >= dp[i][j + 1]){ out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while(i < n){ out.push({ type: "del", text: a[i] }); i++; }
  while(j < m){ out.push({ type: "add", text: b[j] }); j++; }
  return out;
}
function loadReqDocHistoryPreview(historyId){
  if(!reqDocHistoryDocId) return;
  reqDocHistorySel = historyId;
  var list = $("reqDocHistoryList");
  if(list) list.querySelectorAll(".rh-row").forEach(function(r){
    r.classList.toggle("active", r.dataset.historyId === historyId);
  });
  if(reqDocHistoryCompareMode){ loadReqDocHistoryCompare(historyId); return; }
  var preview = $("reqDocHistoryContent");
  preview.innerHTML = '<div class="rh-empty">加载中…</div>';
  var docId = reqDocHistoryDocId;
  API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history/" + encodeURIComponent(historyId)).then(function(h){
    if(docId !== reqDocHistoryDocId) return;
    var verTitle = $("reqDocHistoryVerTitle");
    if(verTitle) verTitle.textContent = "第 " + h.versionNo + " 版 · " + (h.savedBy || "—") + " · " + (fmtTs(h.createdAt) || "—");
    renderReqDocHistoryPreview(h, preview);
  }).catch(function(ex){
    preview.innerHTML = '<div class="rh-empty">' + esc(ex.message || "版本正文加载失败") + '</div>';
  });
}
function restoreReqDocHistory(){
  if(!reqDocHistoryDocId || !reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  if(!reqDocHistoryCanRestore){ toast("你对该项目只有查看权限", "warn"); return; }
  var docId = reqDocHistoryDocId, historyId = reqDocHistorySel;
  var fromReader = reqDocHistoryFromReader;
  UI.showConfirm({
    title: "恢复历史版本",
    msg: "当前正文会先留一版快照，再替换为所选版本的内容"
      + (fromReader ? "。" : "（未保存的修改会丢失）。") + "确定恢复？",
    okText: "恢复"
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/req-docs/" + encodeURIComponent(docId) + "/restore", { historyId: historyId }).then(function(){
      UI.closeModal($("dlgReqDocHistory"));
      toast("已恢复到所选版本", "fs");
      loadReqDocs(true);
      if(fromReader){ loadReqDocSplitDoc(docId); }
      else { openReqDocEditor(docId); }
    }).catch(function(ex){ toast(ex.message || "恢复失败", "bad"); });
  });
}

function reqTocRoot(){
  if(isMarkdownDoc()) return $("reqDocMdPreview");
  return document.querySelector(".reqdoc-editbody .sun-editor-editable");
}
function collectToc(){
  var root = reqTocRoot();
  var items = [];
  if(root){
    var hs = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for(var i = 0; i < hs.length; i++){
      var el = hs[i];
      var lv = parseInt(el.tagName.charAt(1), 10) || 1;
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if(!text) continue;
      var anchor = "t" + items.length;
      el.setAttribute("data-toc", anchor);
      items.push({ anchor: anchor, level: lv, text: text, depth: 0, parent: null, hasChild: false });
    }
  }
  /* 层级按"标题级别栈"算，不按级别差：H1 后面直接跟 H3 时不该多缩进两层 */
  var stack = [];
  items.forEach(function(t){
    while(stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    t.depth = Math.min(stack.length, 3);
    t.parent = stack.length ? stack[stack.length - 1].anchor : null;
    stack.push(t);
  });
  var byAnchor = {};
  items.forEach(function(t){ byAnchor[t.anchor] = t; });
  items.forEach(function(t){
    if(t.parent && byAnchor[t.parent]) byAnchor[t.parent].hasChild = true;
  });
  tocItems = items;
}
function renderToc(){
  var body = $("reqDocTocBody");
  if(!body) return;
  if(!tocItems.length){
    body.innerHTML = '<div class="rt-empty">正文里用标题样式写几段（一级/二级标题），这里会自动生成大纲。</div>';
    return;
  }
  /* 折叠：父项收起时，它的所有后代一起隐藏 */
  var hidden = {};
  tocItems.forEach(function(t){
    if(t.parent && (tocCollapsed[t.parent] || hidden[t.parent])) hidden[t.anchor] = true;
  });
  var html = "";
  tocItems.forEach(function(t){
    if(hidden[t.anchor]) return;
    var lv = Math.min(t.depth + 1, 4);
    var caret = t.hasChild
      ? '<span class="rt-caret' + (tocCollapsed[t.anchor] ? " collapsed" : "") + '" data-toc-fold="' + t.anchor + '">' + icon("down", 11) + '</span>'
      : '<span class="rt-caret"></span>';
    html += '<button class="rt-item rt-lv' + lv + (t.anchor === tocActive ? " active" : "") + '"' +
      ' type="button" data-toc-go="' + t.anchor + '" title="' + esc(t.text) + '">' +
      caret + '<span class="rt-text">' + esc(t.text) + '</span></button>';
  });
  body.innerHTML = html;
}
function rebuildToc(){
  collectToc();
  renderToc();
  refreshTocActive();
}
function scheduleTocRebuild(){
  if(tocBuildTimer) clearTimeout(tocBuildTimer);
  tocBuildTimer = setTimeout(function(){ tocBuildTimer = null; rebuildToc(); }, 400);
}
function markTocActive(anchor){
  if(!anchor || anchor === tocActive) return;
  tocActive = anchor;
  var body = $("reqDocTocBody");
  if(!body) return;
  var prev = body.querySelector(".rt-item.active");
  if(prev) prev.classList.remove("active");
  var next = body.querySelector('[data-toc-go="' + anchor + '"]');
  if(next) next.classList.add("active");
}
function reqScrollRoot(){
  var el = $("reqDocEditPage");
  while(el && el !== document.body && el !== document.documentElement){
    var cs = window.getComputedStyle(el);
    if(/(auto|scroll)/.test(cs.overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}
function scrollToToc(anchor){
  var root = reqTocRoot();
  if(!root) return;
  var el = root.querySelector('[data-toc="' + anchor + '"]');
  if(!el) return;
  if(isMarkdownDoc() && mdMode === "edit"){
    /* 编辑态看不到预览：先切到分屏，等布局完成再滚动 */
    setMdMode("split");
    setTimeout(function(){ scrollToToc(anchor); }, 80);
    return;
  }
  var md = isMarkdownDoc();
  var bar = md ? null : ($("reqDocEditPage") ? $("reqDocEditPage").querySelector(".reqdoc-editbar") : null);
  var offset = md ? 14 : (bar ? bar.getBoundingClientRect().height : 0) + 40;
  var sc = md ? $("reqDocMdPreview") : reqScrollRoot();
  if(sc){
    var top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset;
    if(top < 0) top = 0;
    try{ sc.scrollTo({ top: top, behavior: "smooth" }); }
    catch(e){ sc.scrollTop = top; }
  }else{
    var top2 = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0) - offset;
    if(top2 < 0) top2 = 0;
    try{ window.scrollTo({ top: top2, behavior: "smooth" }); }
    catch(e){ window.scrollTo(0, top2); }
  }
  markTocActive(anchor);
}
function refreshTocActive(){
  if(!tocItems.length) return;
  var page = $("reqDocEditPage");
  if(!page || page.hidden) return;
  var root = reqTocRoot();
  if(!root) return;
  var md = isMarkdownDoc();
  if(md && mdMode === "edit") return;   // 编辑态预览不可见，滚动位置无意义
  var line = md ? (root.getBoundingClientRect().top + 24) : 96;   // 判定线：标题越过它就算"已经读到这一节"
  var cur = tocItems[0].anchor;
  for(var i = 0; i < tocItems.length; i++){
    var el = root.querySelector('[data-toc="' + tocItems[i].anchor + '"]');
    if(!el) continue;
    if(el.getBoundingClientRect().top <= line) cur = tocItems[i].anchor;
    else break;
  }
  markTocActive(cur);
}
function setTocVisible(on){
  var page = $("reqDocEditPage");
  if(!page) return;
  if(on) page.classList.remove("no-toc"); else page.classList.add("no-toc");
  try{ localStorage.setItem("ds.reqToc", on ? "1" : "0"); }catch(e){ /* 隐私模式忽略 */ }
}
function tocVisiblePref(){
  try{ return localStorage.getItem("ds.reqToc") !== "0"; }catch(e){ return true; }
}
function setReqDocSaving(on){
  reqDocSaving = !!on;
  var btn = $("reqDocSave");
  if(!btn) return;
  btn.disabled = !!on;
  if(on){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = "保存中…";
  }else if(btn.dataset.label){
    btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
}
function currentReqDocContent(){
  return isMarkdownDoc()
    ? ($("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "")
    : (reqEditor ? reqEditor.getContents(true) : "");
}
/* 409 时默认保留本地草稿；只有用户二次确认才加载服务器版本 */
function confirmReloadReqDoc(){
  var id = editingDocId;
  if(!id) return;
  UI.showConfirm({
    title: "加载服务器上的最新内容？",
    msg: "加载后会替换当前正文，<b>你本地未保存的修改会丢失</b>。建议先复制需要保留的内容。",
    okText: "加载最新内容",
    cancelText: "保留我的修改"
  }).then(function(ok){
    if(ok && editingDocId === id) openReqDocEditor(id);
  });
}
function saveReqDoc(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return Promise.resolve(null); }
  if(reqDocSaving) return reqDocSavePromise || Promise.resolve(null);
  var title = (editingMeta.title || "").trim();
  var reqId = editingMeta.reqId;
  if(!title || !reqId){
    toast("这份文档缺少标题或项目，请回到列表重新创建", "warn");
    return Promise.resolve(null);
  }
  var md = isMarkdownDoc();
  if(!md && !reqEditor){
    toast("正文编辑器还在加载，请稍候再保存", "warn");
    return Promise.resolve(null);
  }
  var parentId = $("reqDocParent") ? $("reqDocParent").value : "";
  var content = currentReqDocContent();
  var body = {
    reqId: reqId,
    title: title,
    content: content,
    status: editingMeta.status || "draft",
    format: md ? "markdown" : "html",
    docType: $("reqDocType").value,
    parentId: parentId || null,
    updatedAt: editingMeta.updatedAt || null
  };
  var id = editingDocId;
  setReqDocSaving(true);
  var p = id ? API.put("/api/req-docs/" + encodeURIComponent(id), body)
             : API.post("/api/req-docs", body);
  reqDocSavePromise = p.then(function(doc){
    /* 保存期间已切到别的文档：只刷新列表，不要回填到当前编辑页 */
    if(id && editingDocId !== doc.id){
      loadReqDocs(true);
      return doc;
    }
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    editingMeta.updatedAt = doc.updatedAt || editingMeta.updatedAt;
    /* 保存请求发出后用户继续输入：保留当前正文，只把基线推进到刚保存的版本 */
    if(currentReqDocContent() !== content){
      if($("reqDocSaved")) $("reqDocSaved").textContent = "已保存，仍有未保存的修改";
    }else{
      reqDocDirty = false;
      fillReqDocEditor(doc);
    }
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名文档");
    toast("文档已保存", "fs");
    loadReqDocs(true);
    activityUI.loadInto($("reqDocActivityList"), "/api/req-docs/" + encodeURIComponent(doc.id) + "/activities");
    return doc;
  }).catch(function(ex){
    if(ex && ex.code === 409){
      /* 冲突不覆盖本地：正文、dirty 状态都保持原样，由用户显式选择是否加载服务器版本 */
      UI.toastAction("保存冲突：文档已被他人修改，你的修改仍保留在编辑器中", "查看最新内容", confirmReloadReqDoc, "bad", 15000);
      return null;
    }
    toast(ex.message || "保存失败", "bad");
    return null;
  }).then(function(doc){
    reqDocSaving = false;
    reqDocSavePromise = null;
    setReqDocSaving(false);
    return doc;
  });
  return reqDocSavePromise;
}
function deleteReqDoc(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var id = editingDocId || state.reqDocId;
  if(!id){ toast("先打开一份已保存的文档", "warn"); return; }
  UI.showConfirm({
    title: "删除文档",
    msg: "子文档会上移一级，关联到它的工作项与需求池条目会自动解除关联（工作项与需求本身不会被删除）。确定删除？",
    okText: "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(id)).then(function(){
      toast("文档已删除");
      closeReqDocEditor();
      loadReqDocs(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function importReqDoc(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var input = $("reqDocImportFile");
  if(input){
    input.accept = ".docx,.doc,.md,.markdown,.txt,.html,.htm";
    input.click();
  }
}
function onReqDocImportFile(e){
  var input = e.target;
  var f = input.files && input.files[0];
  input.value = "";
  if(!f) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，请拆分后再导入", "warn"); return; }
  var kind = reqDocFileKind(f.name);
  if(!kind){ toast("暂不支持该文件格式，请导入 Word、Markdown、TXT 或 HTML 文件", "warn"); return; }
  if(kind === "word"){ importWordFile(f); return; }
  readTextFile(f).then(function(text){
    applyImportedText(f.name, text, kind);
  }).catch(function(ex){ toast(ex.message || "读取文件失败", "bad"); });
}
/* 导入文本类文件：按文件类型切换文档格式，正文直接进入可编辑状态 */
function applyImportedText(name, text, format){
  if(format === "markdown"){
    if(!isMarkdownDoc()){
      editingMeta.format = "markdown";
      setDocFormatUI("markdown");
    }
    if(!$("reqDocMdCanvas")) return;
    $("reqDocMdCanvas").value = text;
    markReqDocDirty();
    renderMarkdownPreview();
    rebuildToc();
    updateReqDocCount();
    toast("已导入「" + name + "」，已切换为 Markdown，可直接编辑", "fs");
    return;
  }
  if(!isMarkdownDoc()){
    var insert = function(){
      if(!reqEditor) return;
      setReqEditorContents(text);
      markReqDocDirty();
      rebuildToc();
      updateReqDocCount();
      toast("已导入「" + name + "」，可直接编辑", "fs");
    };
    if(reqEditor){ insert(); return; }
    ensureEditor().then(function(ed){ if(ed) insert(); })
      .catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
    return;
  }
  /* 当前是 Markdown 文档：切到富文本再灌入 HTML */
  editingMeta.format = "html";
  setDocFormatUI("html");
  var apply = function(){
    if(!reqEditor) return;
    setReqEditorContents(text);
    markReqDocDirty();
    rebuildToc();
    updateReqDocCount();
    toast("已导入「" + name + "」，已切换为富文本，可直接编辑", "fs");
  };
  if(reqEditor){ apply(); return; }
  ensureEditor().then(function(ed){ if(ed && editingMeta.format === "html") apply(); })
    .catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
}
function importWordFile(f){
  var fd = new FormData();
  fd.append("file", f);
  var url = API.url("/api/req-docs/import-word" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  toast("正在导入 Word 文档…", "info");
  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    if(!json || json.code !== 0){ throw new Error((json && json.message) || "导入失败"); }
    var data = json.data || {};
    if(editingMeta.format !== "html"){
      editingMeta.format = "html";
      setDocFormatUI("html");
    }
    var apply = function(){
      if(!reqEditor) return;
      setReqEditorContents(data.content);
      markReqDocDirty();
      rebuildToc();
      updateReqDocCount();
      toast("已导入「" + f.name + "」，可直接编辑，记得保存", "fs");
    };
    if(reqEditor){
      apply();
    }else{
      ensureEditor().then(function(ed){
        if(!ed || editingMeta.format !== "html") return;
        apply();
      }).catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
    }
  }).catch(function(ex){ toast(ex.message || "导入失败", "bad"); });
}
function exportReqDoc(){
  var md = isMarkdownDoc();
  var text = md ? ($("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "")
                : (reqEditor ? reqEditor.getContents(true) : "");
  var ext = md ? ".md" : ".html";
  var mime = md ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8";
  var name = (editingMeta.title || "文档").replace(/[\\/:*?"<>|]/g, "_") + ext;
  var blob = new Blob([text || ""], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
  toast("已导出 " + name, "fs");
}
function exportReqDocFromReader(docId){
  var doc = reqDocById(docId);
  if(!doc){ toast("文档信息未加载", "bad"); return; }
  var seq = ++readerExportSeq;
  API.get("/api/req-docs/" + encodeURIComponent(docId)).then(function(full){
    if(seq !== readerExportSeq) return;
    var md = full.format === "markdown";
    var text = full.content || "";
    var ext = md ? ".md" : ".html";
    var mime = md ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8";
    var name = (full.title || "文档").replace(/[\\/:*?"<>|]/g, "_") + ext;
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
    toast("已导出 " + name, "fs");
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
/* 发布/收回发布：草稿仅作者与空间管理员可见，发布后按项目访问规则可见 */
function refreshReqDocPublishBtn(){
  var b = $("reqDocPublish");
  if(!b) return;
  var published = !!editingMeta.publishedAt;
  b.textContent = published ? "收回发布" : "发布";
  b.title = published ? "收回后仅作者与空间管理员可见，已生成的分享链接同时失效；收回不影响继续编辑" : "发布后项目成员可见，发布后仍可继续编辑";
  b.classList.toggle("is-published", published);
}
function toggleReqDocPublish(){
  if(!editingDocId) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var published = !!editingMeta.publishedAt;
  var btn = $("reqDocPublish");
  if(btn) btn.disabled = true;
  API.put("/api/req-docs/" + encodeURIComponent(editingDocId) + "/publish", { published: !published }).then(function(d){
    editingMeta.publishedAt = (d && d.publishedAt) || null;
    refreshReqDocPublishBtn();
    /* 搜索态下列表来自 reqDocSearchList，两处都要同步，否则徽标仍是「草稿」 */
    [reqDocList, reqDocSearchList].forEach(function(list){
      if(!list) return;
      for(var i = 0; i < list.length; i++){
        if(list[i].id === editingDocId) list[i].publishedAt = editingMeta.publishedAt;
      }
    });
    renderReqDocMode();
    toast(published ? "已收回发布，文档转为草稿，原分享链接已失效" : "已发布，项目成员现在可以查看；仍可继续编辑", "fs");
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); })
    .then(function(){ if(btn) btn.disabled = false; });
}
function reqDocShareUrl(token){
  if(location.protocol === "file:") return "share.html?token=" + token + "&kind=doc";
  return location.origin + API.appBase + "/share.html?token=" + encodeURIComponent(token) + "&kind=doc";
}
function reqDocFillShare(token){
  var input = $("reqDocShareUrl");
  if(!input) return;
  input.value = reqDocShareUrl(token);
  $("reqDocShareCopy").textContent = "复制链接";
  $("reqDocShareRevoke").hidden = false;
}
function openReqDocShare(){
  if(!editingDocId) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var dlg = $("dlgReqDocShare");
  if(!dlg){ toast("分享弹窗未加载", "bad"); return; }
  if(!editingMeta.publishedAt){ toast("文档尚未发布，先点「发布」再生成分享链接", "warn"); return; }
  $("reqDocShareUrl").value = "";
  $("reqDocShareCopy").textContent = "生成链接";
  $("reqDocShareRevoke").hidden = true;
  UI.openModal(dlg);
  API.get("/api/req-docs/" + encodeURIComponent(editingDocId) + "/share").then(function(s){
    if(s && s.token) reqDocFillShare(s.token);
  }).catch(function(){ /* 没有分享或没权限时保持“生成链接” */ });
}
function reqDocCopyShare(){
  var input = $("reqDocShareUrl");
  if(!input) return;
  if(!input.value){
    API.post("/api/req-docs/" + encodeURIComponent(editingDocId) + "/share").then(function(s){
      reqDocFillShare(s.token);
      toast("分享链接已生成（30 天有效）", "fs");
    }).catch(function(ex){ toast("生成失败：" + (ex.message || "网络异常"), "bad"); });
    return;
  }
  try{
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  }catch(e){ /* noop */ }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(input.value).then(function(){ toast("链接已复制", "fs"); },
      function(){ toast("复制失败，请手动选中复制", "bad"); });
    return;
  }
  var ok = false;
  try{ ok = document.execCommand("copy"); }catch(e2){ ok = false; }
  toast(ok ? "链接已复制" : "复制失败，请手动选中复制", ok ? "fs" : "bad");
}
function reqDocRevokeShare(){
  UI.showConfirm({ title: "停止分享", msg: "停止后旧链接立即失效，查看者无法再打开。", okText: "停止分享" }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(editingDocId) + "/share").then(function(){
      $("reqDocShareUrl").value = "";
      $("reqDocShareCopy").textContent = "生成链接";
      $("reqDocShareRevoke").hidden = true;
      toast("已停止分享", "fs");
    }).catch(function(ex){ toast("操作失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
function openReqDocAndJump(id){
  if(isReqDocEditing() && editingDocId !== id){
    toast("当前文档还有未保存的修改，请先保存或放弃后再打开其它文档", "warn");
    return Promise.resolve(false);
  }
  return showView("requirements").then(function(){
    if(activeView !== "requirements") return;
    state.reqDocId = id;
    openReqDocEditor(id);
  });
}
function populateReqDocSelect(keep){
  var sel = $("iReqDoc");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  var cur = (keep === undefined ? sel.value : keep) || "";
  var opts = reqDocList.slice();
  if(cur && !reqDocsLoaded && !opts.some(function(d){ return d.id === cur; })){
    opts.push({ id:cur, reqId:reqId, title:"当前关联文档", docType:"other" });
  }
  sel.innerHTML = '<option value="">不关联</option>' + opts.map(function(d){
    return '<option value="' + esc(d.id) + '" data-req="' + esc(d.reqId || "") + '">' +
      esc(docTypeName(d.docType)) + ' · ' + esc(d.title) + '</option>';
  }).join("");
  var selected = null;
  for(var i = 0; i < opts.length; i++) if(opts[i].id === cur) selected = opts[i];
  sel.value = selected ? cur : "";
  sel.disabled = !!rt.drawerReadOnly;
  if(reqDocsLoaded) sel.setAttribute("data-ready", "1");
  else sel.removeAttribute("data-ready");
  var trigger = $("iReqDocPicker");
  var triggerText = $("iReqDocPickerText");
  if(trigger) trigger.disabled = !!rt.drawerReadOnly;
  if(triggerText){
    triggerText.textContent = selected ? selected.title : "搜索并选择文档";
    triggerText.classList.toggle("placeholder", !selected);
  }
  if(trigger) trigger.title = selected ? (selected.title + "\n" + reqDocProjectName(selected.reqId)) : "搜索全部可见文档";
  var hint = $("iReqDocHint");
  if(hint){
    hint.textContent = rt.drawerReadOnly ? "只读项目不可修改关联文档"
      : (!reqDocsLoaded && cur ? "文档列表加载失败；现在保存会保留原关联"
        : (selected ? reqDocProjectName(selected.reqId) + " · " + docTypeName(selected.docType)
          : "无需先选项目，可搜索全部可见文档"));
  }
  syncAssocViewBtns();
}
(function wireRequirementView(){
  var tree = $("reqDocTree");
  if(tree){
    tree.addEventListener("click", function(e){
      var t = e.target.closest("[data-toggle-proj]");
      if(t){ toggleReqProj(t.dataset.toggleProj); return; }
      var tc = e.target.closest("[data-toggle-doc]");
      if(tc){
        e.preventDefault();
        e.stopPropagation();
        reqDocCollapsedDocs[tc.dataset.toggleDoc] = !reqDocCollapsedDocs[tc.dataset.toggleDoc];
        renderReqDocTree();
        return;
      }
      if(e.target.closest(".rr-drag")) return;
      var rn = e.target.closest(".rr-rename");
      if(rn){
        var rrow = e.target.closest("[data-reqdoc]");
        if(rrow){
          reqDocBeginRename(rrow.dataset.reqdoc, {
            titleEl: rrow.querySelector(".rr-title"),
            hideEl: rrow,
            inputClass: "rr-rename-input" + (rrow.dataset.rrDepth ? " rd-depth" + Math.min(parseInt(rrow.dataset.rrDepth, 10) || 0, 4) : "")
          });
        }
        return;
      }
      var row = e.target.closest("[data-reqdoc]");
      if(row){ openReqDocEditor(row.dataset.reqdoc); }
    });
    initReqDocTreeDrag();
  }
  /* 列表 / 看板 / 阅读 / 动态：展示方式切换 */
  var rdModeBtns = document.querySelectorAll("#reqDocListPage [data-rdmode]");
  for(var mi = 0; mi < rdModeBtns.length; mi++){
    (function(btn){
      btn.addEventListener("click", function(){ setReqDocMode(btn.dataset.rdmode); });
    })(rdModeBtns[mi]);
  }
  /* 文档视图：保存/应用搜索、项目范围与展示方式的组合 */
  var rdViewsBtn = $("rdViewsBtn");
  if(rdViewsBtn && rdViewsMenuEl){
    rdViewsBtn.addEventListener("click", function(){
      if(UI.popOpen(rdViewsMenuEl)){ UI.closeAllPops(); return; }
      renderRdViewsMenu();
      UI.openPop(rdViewsMenuEl, rdViewsBtn, { align: "right", width: 260 });
      loadViews().then(renderRdViewsMenu);
    });
    rdViewsMenuEl.addEventListener("click", function(e){
      var ap = e.target.closest("[data-rd-view]");
      if(ap){
        for(var i = 0; i < rt.savedViews.length; i++){
          if(String(rt.savedViews[i].id) === String(ap.dataset.rdView)){
            applyRdView(rt.savedViews[i]);
            UI.closeAllPops();
            return;
          }
        }
        return;
      }
      var dl = e.target.closest("[data-rd-view-del]");
      if(dl){ deleteRdView(dl.dataset.rdViewDel); return; }
      if(e.target.closest("[data-rd-view-save]")){ UI.closeAllPops(); saveRdView(); }
    });
  }
  /* 看板：点卡片进编辑页；状态下拉兜底流转；拖拽卡片换列 */
  var kb = $("reqDocKanban");
  if(kb){
    kb.addEventListener("click", function(e){
      if(e.target.closest(".rk-status")) return;
      var card = e.target.closest("[data-rkdoc]");
      if(card) openReqDocEditor(card.dataset.rkdoc);
    });
    kb.addEventListener("change", function(e){
      var sel = e.target.closest("[data-rkstatus]");
      if(sel) reqDocChangeStatus(sel.dataset.rkstatus, sel.value);
    });
    kb.addEventListener("dragstart", function(e){
      var card = e.target.closest ? e.target.closest("[data-rkdoc]") : null;
      if(!card){ e.preventDefault(); return; }
      var d = reqDocById(card.dataset.rkdoc);
      if(!d || !canEditReq(d.reqId)){ e.preventDefault(); return; }
      draggingReqDocId = card.dataset.rkdoc;
      card.classList.add("dragging");
      try{
        e.dataTransfer.setData("text/plain", draggingReqDocId);
        e.dataTransfer.effectAllowed = "move";
      }catch(err){ /* 旧浏览器忽略 */ }
    });
    kb.addEventListener("dragend", function(e){
      draggingReqDocId = null;
      reqDocKanbanClearDrop();
      var card = e.target.closest ? e.target.closest("[data-rkdoc]") : null;
      if(card) card.classList.remove("dragging");
      renderReqDocKanban();
    });
    kb.addEventListener("dragover", function(e){
      if(!draggingReqDocId) return;
      var col = e.target.closest ? e.target.closest("[data-rkcol]") : null;
      if(!col) return;
      e.preventDefault();
      try{ e.dataTransfer.dropEffect = "move"; }catch(err){ /* 忽略 */ }
      reqDocKanbanClearDrop();
      col.classList.add("drop-active");
    });
    kb.addEventListener("drop", function(e){
      var col = e.target.closest ? e.target.closest("[data-rkcol]") : null;
      if(!col || !draggingReqDocId) return;
      e.preventDefault();
      var id = draggingReqDocId;
      draggingReqDocId = null;
      reqDocKanbanClearDrop();
      reqDocChangeStatus(id, col.dataset.rkcol);
    });
  }
  /* 阅读视图：左树选文档，右文阅读/编辑 */
  var st = $("reqDocSplitTree");
  if(st){
    st.addEventListener("click", function(e){
      var proj = e.target.closest("[data-rs-proj]");
      if(proj){
        reqCollapsed[proj.dataset.rsProj] = !reqCollapsed[proj.dataset.rsProj];
        renderReqDocSplit();
        return;
      }
      var caret = e.target.closest("[data-rs-toggle]");
      if(caret){
        reqDocCollapsedDocs[caret.dataset.rsToggle] = !reqDocCollapsedDocs[caret.dataset.rsToggle];
        renderReqDocSplit();
        return;
      }
      if(e.target.closest(".rs-drag")) return;
      var srn = e.target.closest(".rs-rename");
      if(srn){
        var snode = e.target.closest("[data-rs-doc]");
        if(snode){
          reqDocBeginRename(snode.dataset.rsDoc, {
            titleEl: snode.querySelector(".rs-title"),
            hideEl: snode,
            inputClass: "rs-rename-input" + (snode.dataset.rsDepth ? " rd-depth" + Math.min(parseInt(snode.dataset.rsDepth, 10) || 0, 4) : "")
          });
        }
        return;
      }
      var node = e.target.closest("[data-rs-doc]");
      if(node) loadReqDocSplitDoc(node.dataset.rsDoc);
    });
    initReqDocSplitDrag();
  }
  var rd = $("reqDocReader");
  if(rd){
    rd.addEventListener("click", function(e){
      var crumb = e.target.closest("[data-rrd-crumb]");
      if(crumb){ loadReqDocSplitDoc(crumb.dataset.rrdCrumb); return; }
      var rn = e.target.closest("[data-rrd-rename]");
      if(rn){
        reqDocBeginRename(rn.dataset.rrdRename, {
          titleEl: document.querySelector("#reqDocReader .rrd-title-text"),
          inputClass: "rrd-rename-input"
        });
        return;
      }
      var b = e.target.closest("[data-rrd-edit]");
      if(b){ openReqDocEditor(b.dataset.rrdEdit); return; }
      var hb = e.target.closest("[data-rrd-history]");
      if(hb){
        openReqDocHistory(hb.dataset.rrdHistory, { fromReader: true, canRestore: hb.dataset.canRestore === "1" });
        return;
      }
      var ex = e.target.closest("[data-rrd-export]");
      if(ex){ exportReqDocFromReader(ex.dataset.rrdExport); return; }
      var cb = e.target.closest("[data-rrd-comments]");
      if(cb){ toggleRrdComments(); return; }
      if(e.target.closest("#rrdCommentsX")){ toggleRrdComments(false); return; }
      if(e.target.closest("#rrdCommentSend")){ submitRrdComment(); return; }
      if(e.target.closest("#rrdQuoteClear")){ setRrdQuote(null); return; }
      var del = e.target.closest("[data-rrd-del-comment]");
      if(del){ deleteRrdComment(del.dataset.rrdDelComment); return; }
      var mk = e.target.closest("mark.rrd-hl");
      if(mk){
        rrdFlashCommentId = mk.dataset.rrdHlComment;
        toggleRrdComments(true);
      }
    });
    /* 划选正文后弹出「划线评论」气泡；延迟到 mouseup 之后等选区稳定 */
    rd.addEventListener("mouseup", function(e){
      if(!e.target.closest("#reqDocReaderBody")){ hideRrdSelBubble(); return; }
      setTimeout(maybeShowRrdSelBubble, 0);
    });
    document.addEventListener("mousedown", function(e){
      if(rrdSelBubble && !rrdSelBubble.contains(e.target)) hideRrdSelBubble();
    });
    document.addEventListener("scroll", hideRrdSelBubble, true);
  }
  /* 动态：点条目打开对应文档 */
  var fd = $("reqDocFeed");
  if(fd){
    fd.addEventListener("click", function(e){
      var item = e.target.closest("[data-rf-doc]");
      if(item) openReqDocEditor(item.dataset.rfDoc);
    });
  }
  if($("reqDocNew")) $("reqDocNew").addEventListener("click", function(){ openNewReqDocDialog(reqDocReqFilter || undefined); });
  if($("reqDocProjFilterClear")) $("reqDocProjFilterClear").addEventListener("click", function(){ setReqDocProjectFilter(null); });
  if($("reqDocLoadError")) $("reqDocLoadError").addEventListener("click", function(e){
    var btn = e.target.closest("[data-reqdoc-reload]");
    if(!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "重试中…";
    fetchReqDocs(reqDocKeyword);
  });
  if($("dlgNewReqDocCancel")) $("dlgNewReqDocCancel").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocOk")) $("dlgNewReqDocOk").addEventListener("click", submitNewReqDoc);
  if($("dlgNewReqDoc")) UI.setModalSubmit($("dlgNewReqDoc"), submitNewReqDoc);
  if($("newReqDocTitle")) $("newReqDocTitle").addEventListener("keydown", function(e){
    if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitNewReqDoc();
  });
  if($("newReqDocProject")) $("newReqDocProject").addEventListener("change", function(){ fillNewReqDocParents(""); });
  var srcBtns = document.querySelectorAll("#newReqDocSource [data-docsrc]");
  for(var si = 0; si < srcBtns.length; si++){
    (function(btn){
      btn.addEventListener("click", function(){ setNewReqDocSource(btn.dataset.docsrc); });
    })(srcBtns[si]);
  }
  if($("newReqDocFile")) $("newReqDocFile").addEventListener("change", function(){
    var f = this.files && this.files[0];
    if(f && !($("newReqDocTitle").value || "").trim()){
      $("newReqDocTitle").value = f.name.replace(/\.[^.]+$/, "");
    }
  });
  if($("newReqDocTitle")){
    $("newReqDocTitle").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitNewReqDoc(); }
    });
  }
  if($("reqDocBack")) $("reqDocBack").addEventListener("click", tryCloseReqDocEditor);
  if($("dlgReqDocCloseCancel")) $("dlgReqDocCloseCancel").addEventListener("click", closeReqDocCloseDialog);
  if($("dlgReqDocCloseDiscard")){
    $("dlgReqDocCloseDiscard").addEventListener("click", function(){
      reqDocDirty = false;
      closeReqDocCloseDialog(true);
      closeReqDocEditor();
      continueReqDocRoute();
    });
  }
  if($("dlgReqDocCloseSave")){
    $("dlgReqDocCloseSave").addEventListener("click", function(){
      var btn = this;
      if(btn.disabled) return;
      btn.disabled = true;
      saveReqDoc().then(function(doc){
        btn.disabled = false;
        if(!doc) return;   // 保存失败：保留弹窗与本地正文，用户可重试或放弃
        closeReqDocCloseDialog(true);
        closeReqDocEditor();
        continueReqDocRoute();
      });
    });
  }
  if($("reqDocCopy")) $("reqDocCopy").addEventListener("click", copyReqDoc);
  /* 低频操作收进“更多”：点开后保持与顶部工具栏相同的位置计算与关闭规则 */
  if($("reqDocMore")){
    $("reqDocMore").addEventListener("click", function(){
      var menu = $("reqDocMoreMenu");
      if(!menu) return;
      if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
      UI.openPop(menu, this, { width: 188 });
    });
    if($("reqDocMoreMenu")) $("reqDocMoreMenu").addEventListener("click", function(e){
      if(e.target.closest(".menu-item")) UI.closeAllPops();
    });
  }
  if($("reqDocPublish")) $("reqDocPublish").addEventListener("click", toggleReqDocPublish);
  if($("reqDocShare")) $("reqDocShare").addEventListener("click", openReqDocShare);
  if($("reqDocShareCopy")) $("reqDocShareCopy").addEventListener("click", reqDocCopyShare);
  if($("reqDocShareRevoke")) $("reqDocShareRevoke").addEventListener("click", reqDocRevokeShare);
  if($("reqDocShareClose")) $("reqDocShareClose").addEventListener("click", function(){ UI.closeModal($("dlgReqDocShare")); });
  if($("reqDocHistory")) $("reqDocHistory").addEventListener("click", function(){ openReqDocHistory(); });
  if($("dlgReqDocHistoryX")) $("dlgReqDocHistoryX").addEventListener("click", function(){ UI.closeModal($("dlgReqDocHistory")); });
  if($("reqDocHistoryRestore")) $("reqDocHistoryRestore").addEventListener("click", restoreReqDocHistory);
  if($("reqDocHistoryCompare")) $("reqDocHistoryCompare").addEventListener("click", toggleReqDocHistoryCompare);
  if($("reqDocHistoryTextDiff")) $("reqDocHistoryTextDiff").addEventListener("click", toggleReqDocTextDiff);
  if($("reqDocHistoryList")){
    $("reqDocHistoryList").addEventListener("click", function(e){
      var r = e.target.closest("[data-history-id]");
      if(r) loadReqDocHistoryPreview(r.dataset.historyId);
    });
  }
  if($("reqDocCommentSend")) $("reqDocCommentSend").addEventListener("click", submitReqDocComment);
  if($("reqDocCommentQuoteBtn")) $("reqDocCommentQuoteBtn").addEventListener("click", quoteReqDocSelection);
  if($("reqDocCommentQuoteClear")) $("reqDocCommentQuoteClear").addEventListener("click", function(){ setReqDocCommentQuote(null); });
  document.addEventListener("mouseup", rememberReqDocSelection);
  document.addEventListener("keyup", rememberReqDocSelection);
  if($("reqDocCommentInput")){
    $("reqDocCommentInput").addEventListener("keydown", function(e){
      if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ submitReqDocComment(); }
    });
  }
  if($("reqDocCommentList")){
    $("reqDocCommentList").addEventListener("click", function(e){
      var btn = e.target.closest("[data-del-comment]");
      if(btn){
        var item = btn.closest("[data-comment-id]");
        if(item) deleteReqDocComment(item.dataset.commentId);
      }
    });
  }
  if($("reqDocSave")) $("reqDocSave").addEventListener("click", saveReqDoc);
  if($("reqDocDelete")) $("reqDocDelete").addEventListener("click", deleteReqDoc);
  if($("reqDocImport")) $("reqDocImport").addEventListener("click", importReqDoc);
  if($("reqDocExport")) $("reqDocExport").addEventListener("click", exportReqDoc);
  if($("reqDocImportFile")) $("reqDocImportFile").addEventListener("change", onReqDocImportFile);
  if($("reqDocParent")) $("reqDocParent").addEventListener("change", function(){ markReqDocDirty(); });
  $("reqDocType").addEventListener("change", markReqDocDirty);
  if($("reqDocMdSeg")){
    $("reqDocMdSeg").addEventListener("click", function(e){
      var b = e.target.closest("[data-md-mode]");
      if(b) setMdMode(b.dataset.mdMode);
    });
  }
  if($("reqDocMdCanvas")){
    $("reqDocMdCanvas").addEventListener("input", function(){
      markReqDocDirty();
      scheduleMdPreview();
    });
  }
  if($("reqDocMdPreview")){
    $("reqDocMdPreview").addEventListener("scroll", function(){ refreshTocActive(); }, { passive: true });
  }
  if($("reqDocAddTask")) $("reqDocAddTask").addEventListener("click", createReqDocTask);
  if($("reqDocTaskList")) $("reqDocTaskList").addEventListener("click", function(e){
    var task = e.target.closest("[data-reqdoc-task]");
    if(task) openTaskById(task.dataset.reqdocTask);
    var retry = e.target.closest("[data-empty-action]");
    if(retry && editingDocId) loadReqDocTasks(editingDocId);
  });
  if($("reqDocDemandList")) $("reqDocDemandList").addEventListener("click", function(e){
    var dem = e.target.closest("[data-doc-demand]");
    if(dem) openDemandDetailById(dem.dataset.docDemand);
  });

  /* 大纲：工具条上的「大纲」按钮开关；面板标题栏的折叠按钮收起 */
  if($("reqDocTocToggle")){
    $("reqDocTocToggle").addEventListener("click", function(){
      var page = $("reqDocEditPage");
      setTocVisible(page ? page.classList.contains("no-toc") : true);
    });
  }
  /* 折叠按钮：收起大纲；再打开点工具条上的「大纲」按钮 */
  if($("reqDocTocFold")) $("reqDocTocFold").addEventListener("click", function(){ setTocVisible(false); });
  if($("reqDocTocBody")){
    $("reqDocTocBody").addEventListener("click", function(e){
      var f = e.target.closest("[data-toc-fold]");
      if(f){
        e.preventDefault(); e.stopPropagation();
        tocCollapsed[f.dataset.tocFold] = !tocCollapsed[f.dataset.tocFold];
        renderToc();
        return;
      }
      var g = e.target.closest("[data-toc-go]");
      if(g){ e.preventDefault(); scrollToToc(g.dataset.tocGo); }
    });
  }
  window.addEventListener("scroll", function(){ refreshTocActive(); }, { passive: true });
  window.addEventListener("resize", function(){ refreshTocActive(); });
  if($("reqDocSearch")){
    var reqDocSearchTimer = null;
    $("reqDocSearch").addEventListener("input", function(){
      clearTimeout(reqDocSearchTimer);
      reqDocSearchTimer = setTimeout(function(){
        reqDocKeyword = ($("reqDocSearch").value || "").trim();
        fetchReqDocs(reqDocKeyword);
      }, 280);
    });
  }
  if($("iReq")) $("iReq").addEventListener("change", function(){ populateReqDocSelect(""); });

  /* 侧栏/路由切换：编辑页有未保存正文时先确认，保存或放弃后再继续跳转 */
  window.addEventListener("ds:before-route", function(e){
    if(activeView !== "requirements" || !isReqDocEditing()) return;
    e.preventDefault();
    tryCloseReqDocEditor(e.detail && e.detail.to);
  });
  /* 刷新/关闭标签页：仅在正文真正有未保存修改时使用浏览器原生确认 */
  window.addEventListener("beforeunload", function(e){
    if(!isReqDocEditing() || !reqDocDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  /* Esc：先关弹窗，再问是否保存并关闭编辑页 */
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgReqDocClose") && $("dlgReqDocClose").classList.contains("open")){ closeReqDocCloseDialog(); return; }
    if($("dlgNewReqDoc") && $("dlgNewReqDoc").classList.contains("open")){ closeNewReqDocDialog(); return; }
    if($("dlgReqDocHistory") && $("dlgReqDocHistory").classList.contains("open")){ UI.closeModal($("dlgReqDocHistory")); return; }
    if($("dlgReqDocShare") && $("dlgReqDocShare").classList.contains("open")){ UI.closeModal($("dlgReqDocShare")); return; }
    if(activeView === "requirements" && $("reqDocEditPage") && !$("reqDocEditPage").hidden){ tryCloseReqDocEditor(); }
  });

  /* 编辑器改成打开需求时按需加载，这里不再预初始化（首屏省下 2.5 MB） */

  /* Ctrl/Cmd+S 保存（SunEditor 内部会接管键盘，这里在文档级兜住） */
  document.addEventListener("keydown", function(e){
    if((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")){
      if(activeView !== "requirements") return;
      if(!$("reqDocEditPage") || $("reqDocEditPage").hidden) return;
      e.preventDefault();
      saveReqDoc();
    }
  });
})();

function ensureReqDocOptions(keep){
  var seq = rt.taskFormSeq;
  var reqId = $("iReq") ? $("iReq").value : "";
  function stillCurrent(){
    return seq === rt.taskFormSeq && (($("iReq") ? $("iReq").value : "") === reqId);
  }
  var run = function(){ if(stillCurrent()) populateReqDocSelect(keep || ""); };
  if(reqDocsLoaded) run();
  else loadReqDocs().then(run).catch(run);
}
/** 路由后退守卫：需求编辑页有未保存正文 */
function isReqDocEditing(){
  var page = document.getElementById("reqDocEditPage");
  return !!(page && !page.hidden && reqDocDirty);
}
/**
 * SSE：正开着的这篇文档被他人改动。
 * 有未保存修改 → 只提示不覆盖，由用户决定加载对方版本；
 * 没有未保存修改 → 静默重载为最新内容。
 */
function notifyReqDocChanged(docId, actor){
  if(!editingDocId || editingDocId !== docId) return;
  var page = document.getElementById("reqDocEditPage");
  if(!page || page.hidden) return;
  var who = actor ? ("「" + actor + "」") : "他人";
  if(reqDocDirty){
    UI.toastAction("此文档刚被" + who + "修改，你的未保存内容基于旧版本", "查看最新内容", confirmReloadReqDoc, "warn", 12000);
    return;
  }
  openReqDocEditor(editingDocId);
}

export { aiBtnBusy, aiErrMsg, aiUsageText, ensureReqDocOptions, enterRequirementsView, isReqDocEditing, loadReqDocs, notifyReqDocChanged, openNewReqDocDialog, openReqDocAndJump, populateReqDocSelect, refreshReqDocListIfOpen, refreshReqDocTasksIfOpen, reqDocDirty, reqDocList, reqDocNameById, reqDocStatusLabel, reqDocsError, reqDocsLoaded, setReqDocProjectFilter, tryCloseReqDocEditor };
