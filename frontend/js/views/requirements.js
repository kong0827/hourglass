/* views/requirements · 文档（树、编辑页、AI 拆分/审计） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { canEditReq, roleReadOnly, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import * as activityUI from "../core/activity-ui.js";
import { DOC_TYPES, colName, docTypeName, fmtTs, pad2, priColor, priName, typeBadgeHTML } from "../lib/format.js";
import { loadReqs, render } from "./board.js";

var reqDocList = [];
var reqDocDirty = false;
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
  return "草稿";
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
    reqEditor.onChange = function(){ markReqDocDirty(); scheduleTocRebuild(); };
    return reqEditor;
  }).catch(function(e){
    editorPromise = null;
    throw e;
  });
  return editorPromise;
}
var reqDocsLoaded = false;
var reqDocKeyword = "";
var reqDocFetchSeq = 0;
/* 搜索结果单独存放：reqDocList 保持全量（任务表单的文档下拉等消费方需要全量） */
var reqDocSearchList = null;
function fetchReqDocs(kw){
  var seq = ++reqDocFetchSeq;
  return API.get("/api/req-docs", kw ? { keyword: kw } : null).then(function(rows){
    if(seq !== reqDocFetchSeq) return;   // 快速连续搜索：丢弃过期响应
    rows = rows || [];
    if(kw){
      reqDocSearchList = rows;
    }else{
      reqDocList = rows;
      reqDocSearchList = null;
    }
    reqDocsLoaded = true;
    if(activeView === "requirements") renderReqDocMode();
    populateReqDocSelect();
    if(state.board) render({animate:false});
  }).catch(function(){ /* 需求模块不可用时静默降级 */ });
}
function loadReqDocs(force){
  if(reqDocsLoaded && !force) return Promise.resolve(reqDocList);
  return fetchReqDocs(reqDocKeyword);
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
  loadReqDocs().then(function(){ renderReqDocMode(); });
}
function showReqDocList(){
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
function reqDocRowHTML(r, depth, hasChild, collapsed){
  var meta = [esc(docTypeName(r.docType)), esc(r.owner || "—") + " 创建"];
  if(r.createdAt) meta.push(esc(fmtTs(r.createdAt)));
  if(r.status && r.status !== "draft") meta.push(reqDocStatusLabel(r.status));
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
  return '<button class="reqdoc-row rd-depth' + Math.min(depth, 4) + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-reqdoc="' + esc(r.id) + '"' +
    ' data-rr-reqid="' + esc(r.reqId || "") + '" data-rr-parent="' + esc(r.parentId || "") + '"' +
    ' data-rr-depth="' + depth + '" data-rr-sort="' + (r.sortOrder || 0) + '">' +
    caret + drag +
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
    box.innerHTML = '<div class="reqdoc-empty2">还没有文档。点右上角「新增文档」，先选项目再填文档名称。</div>';
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocSearchList || reqDocList;   // 关键字过滤由服务端完成，结果单独缓存
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
  if(reqDocMode === "kanban") renderReqDocKanban();
  else if(reqDocMode === "read") renderReqDocSplit();
  else if(reqDocMode === "feed") renderReqDocFeed();
  else renderReqDocTree();
}
function reqDocById(id){
  for(var i = 0; i < reqDocList.length; i++) if(reqDocList[i].id === id) return reqDocList[i];
  return null;
}
function reqDocEmptyHTML(){
  var kw = (($("reqDocSearch") || {}).value || "").trim();
  return '<div class="reqdoc-empty2">' + (kw ? "没有找到匹配的文档" : "还没有文档。点右上角「新增文档」，先选项目再填文档名称。") + '</div>';
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
  var rows = reqDocSearchList || reqDocList;
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
  return '<button class="rs-node rd-depth' + Math.min(depth, 4) + (r.id === splitDocId ? " active" : "") + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-rs-doc="' + esc(r.id) + '"' +
    ' data-rs-reqid="' + esc(r.reqId || "") + '" data-rs-parent="' + esc(r.parentId || "") + '"' +
    ' data-rs-depth="' + depth + '" data-rs-sort="' + (r.sortOrder || 0) + '">' +
    caret + fmt + drag +
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
  var rows = reqDocSearchList || reqDocList;
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
  box.innerHTML =
    '<div class="rrd-head">' +
      '<div class="rrd-title-row">' +
        '<h3>' + esc(doc.title) + pubBadge + '</h3>' +
        '<span class="rrd-acts">' +
          '<button class="btn sm ghost" type="button" data-rrd-export="' + esc(doc.id) + '" title="导出文档">' + icon("download", 13) + ' 导出</button>' +
          '<button class="btn sm ghost" type="button" data-rrd-edit="' + esc(doc.id) + '">' + icon("edit", 13) + ' 编辑文档</button>' +
        '</span>' +
      '</div>' +
      '<div class="rrd-meta">' + meta.join(" · ") + '</div>' +
    '</div>' +
    '<div class="rrd-body markdown-body" id="reqDocReaderBody"></div>';
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
  }).catch(function(ex){
    if(splitDocId === id) body.innerHTML = UI.errorState(ex.message || "正文渲染失败");
  });
}

/* ---------- 阅读树拖拽排序 ---------- */

var rsDragId = null;
var rsDragSource = null;
var rsDropLine = null;
var rsDroppedInside = false;
function ensureRsDropLine(){
  if(rsDropLine) return rsDropLine;
  rsDropLine = document.createElement("div");
  rsDropLine.className = "rs-drop-line";
  return rsDropLine;
}
function removeRsDropLine(){
  if(rsDropLine && rsDropLine.parentNode) rsDropLine.parentNode.removeChild(rsDropLine);
}
function rsNodeSiblings(node){
  /* 返回与 node 同项目、同父级、同层深的兄弟节点（按 DOM 顺序） */
  var container = node.parentNode;
  if(!container) return [];
  var reqId = node.dataset.rsReqid;
  var parentId = node.dataset.rsParent || "";
  var depth = node.dataset.rsDepth;
  return Array.from(container.children).filter(function(el){
    return el.classList && el.classList.contains("rs-node")
      && el.dataset.rsReqid === reqId
      && (el.dataset.rsParent || "") === parentId
      && el.dataset.rsDepth === depth;
  });
}
function rsHitInfo(e){
  /* 返回 {node, after: bool}：after=true 表示落在节点下半区，应插到它之后 */
  var st = $("reqDocSplitTree");
  if(!st) return null;
  var y = e.clientY;
  var nodes = Array.from(st.querySelectorAll(".rs-node")).filter(function(n){ return n !== rsDragSource; });
  var best = null, bestDist = Infinity;
  for(var i = 0; i < nodes.length; i++){
    var r = nodes[i].getBoundingClientRect();
    if(y < r.top || y > r.bottom) continue;
    var mid = r.top + r.height / 2;
    var dist = Math.abs(y - mid);
    if(dist < bestDist){
      bestDist = dist;
      best = { node: nodes[i], after: y >= mid };
    }
  }
  return best;
}
function rsCanDrop(targetNode){
  if(!rsDragSource || !targetNode) return false;
  if(targetNode === rsDragSource) return false;
  /* 只允许同项目、同父级（同级兄弟）之间排序，避免跨项目/跨层级破坏树结构 */
  return targetNode.dataset.rsReqid === rsDragSource.dataset.rsReqid
    && (targetNode.dataset.rsParent || "") === (rsDragSource.dataset.rsParent || "");
}
function rsCommitReorder(){
  if(!rsDragSource) return;
  var line = ensureRsDropLine();
  var container = line.parentNode;
  if(!container || !container.contains(rsDragSource)){
    removeRsDropLine();
    rsDragSource = null;
    rsDragId = null;
    return;
  }
  /* 把被拖节点插到占位线位置，再按 DOM 顺序重算 sortOrder */
  container.insertBefore(rsDragSource, line);
  removeRsDropLine();
  var reqId = rsDragSource.dataset.rsReqid;
  var parentId = rsDragSource.dataset.rsParent || "";
  var depth = rsDragSource.dataset.rsDepth;
  var siblings = Array.from(container.children).filter(function(el){
    return el.classList && el.classList.contains("rs-node")
      && el.dataset.rsReqid === reqId
      && (el.dataset.rsParent || "") === parentId
      && el.dataset.rsDepth === depth;
  });
  var items = [];
  for(var i = 0; i < siblings.length; i++){
    items.push({ id: siblings[i].dataset.rsDoc, sortOrder: i * 10, parentId: parentId || null });
  }
  rsDragSource = null;
  rsDragId = null;
  if(!canEditReq(reqId)){
    toast("你对该项目只有查看权限", "warn");
    renderReqDocSplit();
    return;
  }
  API.post("/api/req-docs/reorder", { items: items }).then(function(){
    /* 本地同步 sortOrder，避免重新拉取前顺序回跳 */
    items.forEach(function(it){
      var d = reqDocById(it.id);
      if(d){ d.sortOrder = it.sortOrder; d.parentId = it.parentId; }
    });
    renderReqDocSplit();
    toast("顺序已保存", "fs");
  }).catch(function(ex){
    toast(ex.message || "排序保存失败", "bad");
    renderReqDocSplit();
  });
}
function initReqDocSplitDrag(){
  var st = $("reqDocSplitTree");
  if(!st) return;
  st.addEventListener("dragstart", function(e){
    var handle = e.target.closest ? e.target.closest(".rs-drag") : null;
    if(!handle){
      e.preventDefault();
      return;
    }
    var node = handle.closest(".rs-node");
    if(!node){ e.preventDefault(); return; }
    var d = reqDocById(node.dataset.rsDoc);
    if(!d || !canEditReq(d.reqId)){
      e.preventDefault();
      return;
    }
    rsDragId = node.dataset.rsDoc;
    rsDragSource = node;
    rsDroppedInside = false;
    node.classList.add("dragging");
    try{
      e.dataTransfer.setData("text/plain", rsDragId);
      e.dataTransfer.effectAllowed = "move";
      if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(node, 0, 0);
    }catch(err){ /* 旧浏览器忽略 */ }
  });
  st.addEventListener("dragend", function(e){
    var node = e.target.closest ? e.target.closest(".rs-node") : null;
    if(node) node.classList.remove("dragging");
    if(rsDragSource && rsDragSource.classList.contains("dragging")) rsDragSource.classList.remove("dragging");
    if(rsDroppedInside){
      rsDroppedInside = false;
    }else{
      removeRsDropLine();
      rsDragSource = null;
      rsDragId = null;
    }
  });
  st.addEventListener("dragover", function(e){
    if(!rsDragSource){ return; }
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = "move"; }catch(err){}
    var hit = rsHitInfo(e);
    var line = ensureRsDropLine();
    if(hit && rsCanDrop(hit.node)){
      var container = hit.node.parentNode;
      if(hit.after){
        container.insertBefore(line, hit.node.nextSibling);
      }else{
        container.insertBefore(line, hit.node);
      }
    }else{
      removeRsDropLine();
    }
  });
  st.addEventListener("dragleave", function(e){
    if(!rsDragSource) return;
    var stBox = $("reqDocSplitTree");
    if(stBox && !stBox.contains(e.relatedTarget)) removeRsDropLine();
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
var rrDroppedInside = false;
function rrHitInfo(e){
  var tree = $("reqDocTree");
  if(!tree) return null;
  var y = e.clientY;
  var rows = Array.from(tree.querySelectorAll(".reqdoc-row")).filter(function(n){ return n !== rrDragSource; });
  var best = null, bestDist = Infinity;
  for(var i = 0; i < rows.length; i++){
    var r = rows[i].getBoundingClientRect();
    if(y < r.top || y > r.bottom) continue;
    var mid = r.top + r.height / 2;
    var dist = Math.abs(y - mid);
    if(dist < bestDist){
      bestDist = dist;
      best = { node: rows[i], after: y >= mid };
    }
  }
  return best;
}
function rrCanDrop(targetNode){
  if(!rrDragSource || !targetNode) return false;
  if(targetNode === rrDragSource) return false;
  return targetNode.dataset.rrReqid === rrDragSource.dataset.rrReqid
    && (targetNode.dataset.rrParent || "") === (rrDragSource.dataset.rrParent || "");
}
function rrCommitReorder(){
  if(!rrDragSource) return;
  var line = ensureRsDropLine();
  var container = line.parentNode;
  if(!container || !container.contains(rrDragSource)){
    removeRsDropLine();
    rrDragSource = null;
    return;
  }
  container.insertBefore(rrDragSource, line);
  removeRsDropLine();
  var reqId = rrDragSource.dataset.rrReqid;
  var parentId = rrDragSource.dataset.rrParent || "";
  var depth = rrDragSource.dataset.rrDepth;
  var siblings = Array.from(container.children).filter(function(el){
    return el.classList && el.classList.contains("reqdoc-row")
      && el.dataset.rrReqid === reqId
      && (el.dataset.rrParent || "") === parentId
      && el.dataset.rrDepth === depth;
  });
  var items = [];
  for(var i = 0; i < siblings.length; i++){
    items.push({ id: siblings[i].dataset.reqdoc, sortOrder: i * 10, parentId: parentId || null });
  }
  rrDragSource = null;
  if(!canEditReq(reqId)){
    toast("你对该项目只有查看权限", "warn");
    renderReqDocTree();
    return;
  }
  API.post("/api/req-docs/reorder", { items: items }).then(function(){
    items.forEach(function(it){
      var d = reqDocById(it.id);
      if(d){ d.sortOrder = it.sortOrder; d.parentId = it.parentId; }
    });
    renderReqDocTree();
    toast("顺序已保存", "fs");
  }).catch(function(ex){
    toast(ex.message || "排序保存失败", "bad");
    renderReqDocTree();
  });
}
function initReqDocTreeDrag(){
  var tree = $("reqDocTree");
  if(!tree) return;
  tree.addEventListener("dragstart", function(e){
    var handle = e.target.closest ? e.target.closest(".rr-drag") : null;
    if(!handle){ e.preventDefault(); return; }
    var row = handle.closest(".reqdoc-row");
    if(!row){ e.preventDefault(); return; }
    var d = reqDocById(row.dataset.reqdoc);
    if(!d || !canEditReq(d.reqId)){ e.preventDefault(); return; }
    rrDragSource = row;
    rrDroppedInside = false;
    row.classList.add("dragging");
    try{
      e.dataTransfer.setData("text/plain", row.dataset.reqdoc);
      e.dataTransfer.effectAllowed = "move";
      if(e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 0, 0);
    }catch(err){}
  });
  tree.addEventListener("dragend", function(e){
    var row = e.target.closest ? e.target.closest(".reqdoc-row") : null;
    if(row) row.classList.remove("dragging");
    if(rrDragSource && rrDragSource.classList.contains("dragging")) rrDragSource.classList.remove("dragging");
    if(rrDroppedInside){
      rrDroppedInside = false;
    }else{
      removeRsDropLine();
      rrDragSource = null;
    }
  });
  tree.addEventListener("dragover", function(e){
    if(!rrDragSource) return;
    e.preventDefault();
    try{ e.dataTransfer.dropEffect = "move"; }catch(err){}
    var hit = rrHitInfo(e);
    var line = ensureRsDropLine();
    if(hit && rrCanDrop(hit.node)){
      var container = hit.node.parentNode;
      if(hit.after) container.insertBefore(line, hit.node.nextSibling);
      else container.insertBefore(line, hit.node);
    }else{
      removeRsDropLine();
    }
  });
  tree.addEventListener("dragleave", function(e){
    if(!rrDragSource) return;
    var t = $("reqDocTree");
    if(t && !t.contains(e.relatedTarget)) removeRsDropLine();
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
  API.get("/api/req-docs/activities").then(function(rows){
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
  if($("newReqDocWordFile")) $("newReqDocWordFile").value = "";
  toggleNewReqDocWordField();
  fillDocTypeSelect("newReqDocType", "requirement");
  fillNewReqDocParents("");
  UI.openModal($("dlgNewReqDoc"));
  setTimeout(function(){ if($("newReqDocTitle")) $("newReqDocTitle").focus(); }, 40);
}
function toggleNewReqDocWordField(){
  var field = $("newReqDocWordField");
  if(!field) return;
  var isWord = $("newReqDocFormat") && $("newReqDocFormat").value === "word";
  field.hidden = !isWord;
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
  API.get("/api/req-docs/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
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
  API.get("/api/req-docs/" + encodeURIComponent(id) + "/demands").then(function(rows){
    if(editingDocId !== id) return;
    rows = rows || [];
    if($("reqDocDemandCount")) $("reqDocDemandCount").textContent = rows.length ? "（" + rows.length + "）" : "";
    if(!rows.length){
      list.innerHTML = '<div class="tl-empty">还没有关联需求；到需求池打开需求详情，在「关联文档」里挑这份文档。</div>';
      return;
    }
    list.innerHTML = rows.map(function(d){
      return '<div class="req-expand-doc dem-doc-readonly">'
        + '<span class="rd-title">' + esc(d.title) + '</span>'
        + '<span class="rd-meta">' + esc(demandStatusName(d.status)) + ' · ' + esc(priName(d.priority)) + '</span></div>';
    }).join("");
  }).catch(function(ex){
    if(editingDocId === id) list.innerHTML = UI.errorState(ex.message || "关联需求加载失败");
  });
}
function refreshReqDocTasksIfOpen(){
  var page = $("reqDocEditPage");
  if(editingDocId && page && !page.hidden) loadReqDocTasks(editingDocId);
}
function createReqDocTask(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  ensureReqDocSaved(function(){
    if(!editingDocId) return;
    openTaskDrawer("backlog", null, { reqId: editingMeta.reqId, reqDocId: editingDocId });
  });
}
function submitNewReqDoc(){
  var ok = $("dlgNewReqDocOk");
  if(ok && ok.disabled) return;
  var reqId = $("newReqDocProject").value;
  var title = ($("newReqDocTitle").value || "").trim();
  if(!reqId){ toast("还没有可写项目，请先到「项目」里建一个", "warn"); return; }
  if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!title){ toast("请填写文档名称", "warn"); $("newReqDocTitle").focus(); return; }
  var format = $("newReqDocFormat") ? $("newReqDocFormat").value : "markdown";
  var parentId = $("newReqDocParent") ? $("newReqDocParent").value : "";
  var isWord = format === "word";
  var wordFile = isWord && $("newReqDocWordFile") ? $("newReqDocWordFile").files[0] : null;
  if(isWord && !wordFile){ toast("请选择要导入的 Word 文件", "warn"); return; }
  if(ok) ok.disabled = true;
  API.post("/api/req-docs", {
    reqId: reqId, title: title, content: "", status: "draft",
    format: isWord ? "html" : format, docType: $("newReqDocType").value, parentId: parentId || null
  })
    .then(function(doc){
      if(isWord){
        return importWordForNewDoc(doc, wordFile);
      }else{
        closeNewReqDocDialog();
        loadReqDocs(true);
        openReqDocEditor(doc.id);
        toast("已创建「" + doc.title + "」，接着写正文", "fs");
        return null;
      }
    })
    .catch(function(ex){ toast(ex.message || "创建失败", "bad"); })
    .then(function(){ if(ok) ok.disabled = false; });
}
function importWordForNewDoc(doc, file){
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
    var content = (json.data && json.data.content) || "";
    return API.put("/api/req-docs/" + encodeURIComponent(doc.id), {
      reqId: doc.reqId, title: doc.title, content: content, status: "draft",
      format: "html", docType: doc.docType || "requirement", parentId: doc.parentId || null,
      updatedAt: doc.updatedAt || ""
    }).then(function(){
      closeNewReqDocDialog();
      loadReqDocs(true);
      openReqDocEditor(doc.id);
      toast("已导入「" + file.name + "」，记得检查格式", "fs");
    });
  });
}
function openReqDocEditor(id){
  var seq = ++reqDocOpenSeq;
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== reqDocOpenSeq) return;   // 连续点开多份：丢弃过期的响应
    editingDocId = doc.id;
    state.reqDocId = doc.id;
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
function tryCloseReqDocEditor(){
  if(!reqDocDirty){ closeReqDocEditor(); return; }
  UI.openModal($("dlgReqDocClose"));
}
function closeReqDocCloseDialog(){
  var d = $("dlgReqDocClose");
  if(d) UI.closeModal(d);
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
      '<input type="checkbox" checked data-pick="' + i + '" aria-label="选择任务">' +
      '<div class="ai-main">' +
        '<input class="ai-title" type="text" maxlength="60" value="' + esc(t.title) + '" data-title="' + i + '" aria-label="任务标题">' +
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
  if(!picked.length){ toast("至少选一条要创建的任务", "warn"); return; }

  var btn = $("dlgAiSplitOk");
  btn.disabled = true;
  API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/tasks", { tasks: picked }).then(function(r){
    btn.disabled = false;
    UI.closeModal($("dlgAiSplit"));
    var msg = "已创建 " + r.created + " 个任务";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 个同名任务";
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
  if(imp) imp.title = md ? "导入 Markdown 文件" : "导入 HTML / Word 文件";
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
    updatedAt: doc.updatedAt || ""
  };
  setDocFormatUI(editingMeta.format);
  fillDocTypeSelect("reqDocType", editingMeta.docType);
  fillDocParentSelect(doc);
  if(isMarkdownDoc()){
    fillMarkdownEditor(doc);
  }else if(reqEditor){
    reqEditor.setContents(doc.content || "", false);
    updateReqDocCount();
    rebuildToc();
  }else{
    /* 首次打开：编辑器按需下载，下载完再灌正文（期间用户切走就丢弃结果） */
    ensureEditor().then(function(ed){
      if(!ed || editingDocId !== id) return;
      ed.setContents(doc.content || "", false);
      updateReqDocCount();
      rebuildToc();
      applyReqDocReadOnly(reqDocReadOnly);
    }).catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
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
  sel.innerHTML = '<option value="">选择项目</option>' + rt.reqList.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
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
  API.get("/api/req-docs/" + encodeURIComponent(docId) + "/comments").then(function(rows){
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
function openReqDocHistory(){
  if(!editingDocId) return;
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
  restore.style.display = reqDocReadOnly ? "none" : "";
  UI.openModal(layer);
  var docId = editingDocId;
  API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history").then(function(rows){
    if(docId !== editingDocId) return;
    rows = rows || [];
    reqDocHistories = rows;
    list.innerHTML = rows.length ? rows.map(function(h){
      return '<button class="rh-row" type="button" data-history-id="' + esc(h.id) + '">'
        + '<span class="rh-ver">第 ' + h.versionNo + ' 版</span>'
        + '<span class="rh-main">'
        +   '<span class="rh-t">' + esc(h.title || "未命名") + '</span>'
        +   '<span class="rh-m">' + esc(h.savedBy || "—") + ' · ' + esc(fmtTs(h.createdAt) || "—") + '</span>'
        + '</span></button>';
    }).join("") : '<div class="rh-empty">还没有历史快照：保存正文后自动生成</div>';
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
  if(!editingDocId){ toast("没有打开的文档", "warn"); return; }
  if(!reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  setReqDocHistoryCompareMode(!reqDocHistoryCompareMode);
  if(reqDocHistoryCompareMode){ loadReqDocHistoryCompare(reqDocHistorySel); }
  else { loadReqDocHistoryPreview(reqDocHistorySel); }
}
function loadReqDocHistoryCompare(historyId){
  if(!editingDocId || !historyId) return;
  var currentBox = $("reqDocHistoryCompareCurrent");
  var historyBox = $("reqDocHistoryCompareHistory");
  if(currentBox) currentBox.innerHTML = '<div class="rh-empty">加载中…</div>';
  if(historyBox) historyBox.innerHTML = '<div class="rh-empty">加载中…</div>';
  var docId = editingDocId;
  Promise.all([
    API.get("/api/req-docs/" + encodeURIComponent(docId)),
    API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history/" + encodeURIComponent(historyId))
  ]).then(function(results){
    if(docId !== editingDocId || !reqDocHistoryCompareMode) return;
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
  if(!editingDocId){ toast("没有打开的文档", "warn"); return; }
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
  if(!editingDocId) return;
  reqDocHistorySel = historyId;
  var list = $("reqDocHistoryList");
  if(list) list.querySelectorAll(".rh-row").forEach(function(r){
    r.classList.toggle("active", r.dataset.historyId === historyId);
  });
  if(reqDocHistoryCompareMode){ loadReqDocHistoryCompare(historyId); return; }
  var preview = $("reqDocHistoryContent");
  preview.innerHTML = '<div class="rh-empty">加载中…</div>';
  var docId = editingDocId;
  API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history/" + encodeURIComponent(historyId)).then(function(h){
    if(docId !== editingDocId) return;
    var verTitle = $("reqDocHistoryVerTitle");
    if(verTitle) verTitle.textContent = "第 " + h.versionNo + " 版 · " + (h.savedBy || "—") + " · " + (fmtTs(h.createdAt) || "—");
    renderReqDocHistoryPreview(h, preview);
  }).catch(function(ex){
    preview.innerHTML = '<div class="rh-empty">' + esc(ex.message || "版本正文加载失败") + '</div>';
  });
}
function restoreReqDocHistory(){
  if(!editingDocId || !reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var docId = editingDocId, historyId = reqDocHistorySel;
  UI.showConfirm({
    title: "恢复历史版本",
    msg: "当前正文会先留一版快照，再替换为所选版本的内容（未保存的修改会丢失）。确定恢复？",
    okText: "恢复"
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/req-docs/" + encodeURIComponent(docId) + "/restore", { historyId: historyId }).then(function(){
      UI.closeModal($("dlgReqDocHistory"));
      toast("已恢复到所选版本", "fs");
      loadReqDocs(true);
      openReqDocEditor(docId);
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
function saveReqDoc(){
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return Promise.resolve(null); }
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
  var body = {
    reqId: reqId,
    title: title,
    content: md
      ? ($("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "")
      : (reqEditor ? reqEditor.getContents(true) : ""),
    status: editingMeta.status || "draft",
    format: md ? "markdown" : "html",
    docType: $("reqDocType").value,
    parentId: parentId || null,
    updatedAt: editingMeta.updatedAt || null
  };
  var id = editingDocId;
  var p = id ? API.put("/api/req-docs/" + encodeURIComponent(id), body)
             : API.post("/api/req-docs", body);
  return p.then(function(doc){
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    reqDocDirty = false;
    fillReqDocEditor(doc);
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名文档");
    toast("文档已保存", "fs");
    loadReqDocs(true);
    activityUI.loadInto($("reqDocActivityList"), "/api/req-docs/" + encodeURIComponent(doc.id) + "/activities");
    return doc;
  }).catch(function(ex){
    if(ex && ex.code === 409){
      /* 版本冲突：本地编辑基于旧版本，点「查看最新内容」加载对方保存后的正文（本地未保存修改会被覆盖） */
      UI.toastAction(ex.message || "文档已被他人修改", "查看最新内容", function(){
        if(editingDocId) openReqDocEditor(editingDocId);
      }, "bad", 12000);
      return null;
    }
    toast(ex.message || "保存失败", "bad");
    return null;
  });
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
    input.accept = isMarkdownDoc() ? ".md,.markdown,.txt" : ".html,.htm,.docx";
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
  if(/\.docx$/i.test(f.name)){
    importWordFile(f);
    return;
  }
  var reader = new FileReader();
  reader.onload = function(){
    var text = String(reader.result || "");
    if(isMarkdownDoc()){
      if(!$("reqDocMdCanvas")) return;
      $("reqDocMdCanvas").value = text;
      markReqDocDirty();
      renderMarkdownPreview();
    }else{
      if(!reqEditor) return;
      reqEditor.setContents(text);
      markReqDocDirty();
    }
    toast("已导入「" + f.name + "」，记得保存", "fs");
  };
  reader.onerror = function(){ toast("读取文件失败", "bad"); };
  reader.readAsText(f, "utf-8");
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
      reqEditor.setContents(data.content || "");
      markReqDocDirty();
      rebuildToc();
      updateReqDocCount();
      toast("已导入「" + f.name + "」，记得保存", "fs");
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
  b.title = published ? "收回后仅作者与空间管理员可见" : "发布后项目成员可见";
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
    for(var i = 0; i < reqDocList.length; i++){
      if(reqDocList[i].id === editingDocId) reqDocList[i].publishedAt = editingMeta.publishedAt;
    }
    renderReqDocMode();
    toast(published ? "已收回发布，文档转为草稿" : "已发布，项目成员现在可以查看", "fs");
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
  var opts = reqId ? reqDocList.filter(function(d){ return d.reqId === reqId; }) : [];
  sel.innerHTML = '<option value="">不关联</option>' + opts.map(function(d){
    return '<option value="' + esc(d.id) + '">' + esc(docTypeName(d.docType)) + ' · ' + esc(d.title) + '</option>';
  }).join("");
  var ok = false;
  for(var i = 0; i < opts.length; i++) if(opts[i].id === cur) ok = true;
  sel.value = ok ? cur : "";
  sel.disabled = !reqId;
  var hint = $("iReqDocHint");
  if(hint){
    hint.textContent = !reqId ? "先选项目，再从该项目的文档里挑"
      : (opts.length ? "从该项目的文档里挑" : "该项目还没有文档");
  }
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
      var node = e.target.closest("[data-rs-doc]");
      if(node) loadReqDocSplitDoc(node.dataset.rsDoc);
    });
    initReqDocSplitDrag();
  }
  var rd = $("reqDocReader");
  if(rd){
    rd.addEventListener("click", function(e){
      var b = e.target.closest("[data-rrd-edit]");
      if(b){ openReqDocEditor(b.dataset.rrdEdit); return; }
      var ex = e.target.closest("[data-rrd-export]");
      if(ex) exportReqDocFromReader(ex.dataset.rrdExport);
    });
  }
  /* 动态：点条目打开对应文档 */
  var fd = $("reqDocFeed");
  if(fd){
    fd.addEventListener("click", function(e){
      var item = e.target.closest("[data-rf-doc]");
      if(item) openReqDocEditor(item.dataset.rfDoc);
    });
  }
  if($("reqDocNew")) $("reqDocNew").addEventListener("click", function(){ openNewReqDocDialog(); });
  if($("dlgNewReqDocCancel")) $("dlgNewReqDocCancel").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocOk")) $("dlgNewReqDocOk").addEventListener("click", submitNewReqDoc);
  if($("newReqDocProject")) $("newReqDocProject").addEventListener("change", function(){ fillNewReqDocParents(""); });
  if($("newReqDocFormat")) $("newReqDocFormat").addEventListener("change", toggleNewReqDocWordField);
  if($("newReqDocTitle")){
    $("newReqDocTitle").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitNewReqDoc(); }
    });
  }
  if($("reqDocBack")) $("reqDocBack").addEventListener("click", tryCloseReqDocEditor);
  if($("dlgReqDocCloseCancel")) $("dlgReqDocCloseCancel").addEventListener("click", closeReqDocCloseDialog);
  if($("dlgReqDocCloseDiscard")){
    $("dlgReqDocCloseDiscard").addEventListener("click", function(){
      closeReqDocCloseDialog();
      reqDocDirty = false;
      closeReqDocEditor();
    });
  }
  if($("dlgReqDocCloseSave")){
    $("dlgReqDocCloseSave").addEventListener("click", function(){
      saveReqDoc().then(function(doc){
        closeReqDocCloseDialog();
        if(doc) closeReqDocEditor();
      });
    });
  }
  if($("reqDocCopy")) $("reqDocCopy").addEventListener("click", copyReqDoc);
  if($("reqDocPublish")) $("reqDocPublish").addEventListener("click", toggleReqDocPublish);
  if($("reqDocShare")) $("reqDocShare").addEventListener("click", openReqDocShare);
  if($("reqDocShareCopy")) $("reqDocShareCopy").addEventListener("click", reqDocCopyShare);
  if($("reqDocShareRevoke")) $("reqDocShareRevoke").addEventListener("click", reqDocRevokeShare);
  if($("reqDocShareClose")) $("reqDocShareClose").addEventListener("click", function(){ UI.closeModal($("dlgReqDocShare")); });
  if($("reqDocHistory")) $("reqDocHistory").addEventListener("click", openReqDocHistory);
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
    UI.toastAction("此文档刚被" + who + "修改，你的未保存内容基于旧版本", "查看最新内容", function(){
      openReqDocEditor(editingDocId);
    }, "warn", 12000);
    return;
  }
  openReqDocEditor(editingDocId);
}

export { aiBtnBusy, aiErrMsg, aiUsageText, ensureReqDocOptions, enterRequirementsView, isReqDocEditing, loadReqDocs, notifyReqDocChanged, openNewReqDocDialog, openReqDocAndJump, populateReqDocSelect, refreshReqDocTasksIfOpen, reqDocDirty, reqDocList, reqDocNameById, reqDocStatusLabel, tryCloseReqDocEditor };
