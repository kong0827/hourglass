/* views/requirements · 文档（树、编辑页、AI 拆分/审计） */

import { API, csrfCookie } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { attachmentChipHTML, openAttachment, downloadUrl, bindFileDrop, uploadAttachment, validateFiles, reportRejected } from "../core/attach-kit.js";
import { activeView, showView } from "../core/router.js";
import { canEditDoc, canEditReq, currentRole, reqNameById, roleReadOnly, rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, syncAssocRead, syncAssocViewBtns } from "../core/task-drawer.js";
import { createMentionPicker } from "../core/mention-picker.js";
import { UI, esc, toast } from "../core/ui.js";
import { AIProgress, aiApplyFailText, aiErrorText as aiErrMsg, aiUsageText } from "../core/ai-progress.js";
import * as activityUI from "../core/activity-ui.js";
import { loadViews, savedViewsFor } from "../core/filters-ui.js";
import { DOC_TYPES, PRIORITIES, assocLinkHTML, avatarHTML, colName, docTypeName, fmtTs, pad2, priName, taskDescText, taskPublicationHTML, typeBadgeHTML } from "../lib/format.js";
import { memberToOption, optionSubText } from "../lib/people-picker.js";
import { loadProjectMembers } from "../lib/member-labels.js";
import * as textDiff from "../lib/text-diff.js";
import { loadReqs, render } from "./board.js";
import { openDemandDetailById } from "./demands.js";
import { ensureVendor, openDocView } from "../core/doc-editor.js";
import { htmlToSnapshot, parseSnapshot, snapshotHeadings, snapshotToHtml, snapshotToText } from "../core/univer-doc-io.js";

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
/* 在线文档视图（Univer）：与 SunEditor 互斥，同一时刻只挂载一个 */
var reqUniverView = null;
var reqUniverSeq = 0;
var reqCollapsed = {};
var reqDocCollapsedDocs = {};
/* 文档分类树（独立分类表 doc_category）：扁平缓存 + 分类折叠态 + 最近一次构建的分组模型（右键菜单按 id 查节点用） */
var docCategories = null;
var docCategoriesLoaded = false;
var reqDocCollapsedCats = {};
var reqDocGroupsCache = [];
var editingDocId = null;
var reqDocOpenSeq = 0;
var mdMode = "split";
var mdLibPromise = null;
var mdRenderTimer = null;
var editingMeta = { title: "", reqId: "", status: "draft", format: "markdown", docType: "other", parentId: "", categoryId: "", publishedAt: null, ownerUserId: "", visibility: "team" };
var reqDocReadOnly = false;
/* A 创建人保护：项目可写但非负责人/管理员 → 正文只读，但分享/评论仍按项目可写保留 */
var reqDocOwnerLocked = false;
var docTemplatesCache = null;
/* 新建文档：选中文件后先解析成预览，点「新建并编辑」时直接写入这份内容，避免二次转换 */
var newReqDocParsed = null;
var newReqDocParseSeq = 0;
/* 文档可见范围（照用例分组三档）：仅约束已发布文档；rrdDocDetail 保存最近打开详情，供权限面板回显名单 */
var DOC_VIS_MAX = 50;
var DOC_VIS_META = {
  team: { name: "团队共享", desc: "能看到本项目（空间级文档则为空间）的成员都能阅读；可生成公开只读链接。" },
  members: { name: "指定成员", desc: "仅负责人和勾选的成员可见，最多 50 人；不可生成分享链接。" },
  personal: { name: "仅自己", desc: "只有负责人可见，空间管理员也不可见；不可生成分享链接。" }
};
var docVisPickers = Object.create(null);
var rrdDocDetail = null;
/** 只读文档：隐藏保存/删除/新建工作项/AI/导入/历史恢复，正文与元数据不可编辑 */
function applyReqDocReadOnly(on){
  /* 分享按项目可写：创建人锁定（非负责人但项目可写）时仍保留分享入口，与后端 createShare 同口径 */
  var hideShare = on && !reqDocOwnerLocked;
  ["reqDocSave", "reqDocDelete", "reqDocAddTask", "reqDocAiSplit", "reqDocAiAudit", "reqDocImport", "reqDocHistory", "reqDocPublish", "reqDocShare"].forEach(function(id){
    var b = $(id);
    if(b) b.style.display = (id === "reqDocShare" ? hideShare : on) ? "none" : "";
  });
  ["reqDocType", "reqDocParent"].forEach(function(id){
    var el = $(id);
    if(el) el.disabled = on;
  });
  /* 分类下拉：只读时禁用；可写时也要看该范围有没有分类（无分类仍禁用，避免空下拉误导） */
  var catSel = $("reqDocCategory");
  if(catSel){
    var catScope = editingMeta.reqId || "";
    var hasCats = (docCategories || []).some(function(c){ return (c.reqId || "") === catScope; });
    catSel.disabled = on || !hasCats;
  }
  var md = $("reqDocMdCanvas");
  if(md) md.readOnly = on;
  if(reqEditor){
    if(on) reqEditor.disable(); else reqEditor.enable();
  }
  if(reqUniverView){
    try{ reqUniverView.setReadOnly(on); }catch(e){ /* 视图切换中 */ }
  }
  var saved = $("reqDocSaved");
  if(on && saved) saved.textContent = reqDocOwnerLocked ? "只读 · 仅文档负责人或空间管理员可编辑" : "只读 · 你对该项目只有查看权限";
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
  if(!reqId) return "空间文档";
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === reqId) return rt.reqList[i].name;
  for(var j = 0; j < reqDocList.length; j++) if(reqDocList[j].reqId === reqId && reqDocList[j].reqName) return reqDocList[j].reqName;
  return "未归属项目";
}
function isMarkdownDoc(){
  return editingMeta.format === "markdown";
}
/* 在线文档（Univer 快照）：content 存快照 JSON，编辑/阅读都走 core/doc-editor 挂载 */
function isUniverDoc(){
  return editingMeta.format === "univer";
}
/* 服务端 format 归一化：未知格式一律按旧富文本（html）处理，避免历史脏数据打不开 */
function docFormatOf(format){
  if(format === "markdown") return "markdown";
  if(format === "univer") return "univer";
  return "html";
}
/* 列表里的格式小标：Markdown 不标（默认），在线文档与旧 HTML 分开标 */
function fmtChipHTML(format){
  if(format === "markdown") return "";
  if(format === "univer") return '<span class="rs-fmt-html" title="在线文档">在线</span>';
  return '<span class="rs-fmt-html" title="HTML 文档">HTML</span>';
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
      /* 程序化回填可能晚于抑制窗口触发 onChange：与基线一致就不算用户修改。
         已脏后不再比：大正文（内嵌图片）每次按键都全量序列化会明显卡顿 */
      if(!reqDocDirty && reqEditorBaseline != null && reqEditor.getContents(true) === reqEditorBaseline) return;
      markReqDocDirty();
      scheduleDraftSave();
      scheduleTocRebuild();
    };
    rdaBindEditorSelection();
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
  var body = isUniverDoc() ? $("reqDocUniverBody") : $("reqDocRichBody");
  if(body) body.classList.toggle("is-loading", !!on);
  if($("reqDocSaved") && on) $("reqDocSaved").textContent = "编辑器加载中…";
}
/* 卸载在线文档：序号自增让在途的挂载结果自行丢弃 */
function disposeReqUniver(){
  reqUniverSeq++;
  if(reqUniverView){
    try{ reqUniverView.dispose(); }catch(e){ /* 已销毁 */ }
    reqUniverView = null;
  }
}
/* 挂载在线文档：有快照直接用；没有快照时按 html 现场转换（旧 html 正文 / 导入文件） */
function mountReqUniver(snapshot, html){
  var seq = ++reqUniverSeq;
  if(reqUniverView){
    try{ reqUniverView.dispose(); }catch(e){ /* 已销毁 */ }
    reqUniverView = null;
  }
  var box = $("reqDocUniverBody");
  if(!box) return Promise.resolve(null);
  setReqDocHydrating(true);
  return openDocView({
    container: box,
    snapshot: snapshot || null,
    html: html || "",
    title: editingMeta.title || "文档",
    readOnly: reqDocReadOnly || reqDocOwnerLocked,
    onDirty: function(){
      markReqDocDirty();
      scheduleDraftSave();
      scheduleTocRebuild();
    }
  }).then(function(view){
    if(seq !== reqUniverSeq){
      try{ view.dispose(); }catch(e){ /* 已销毁 */ }
      return null;
    }
    reqUniverView = view;
    setReqDocHydrating(false);
    reqDocDirty = false;
    refreshReqDocSavedText();
    updateReqDocCount();
    tocActive = null;
    rebuildToc();
    applyReqDocReadOnly(reqDocReadOnly || reqDocOwnerLocked);
    return view;
  }).catch(function(ex){
    if(seq === reqUniverSeq){
      setReqDocHydrating(false);
      refreshReqDocSavedText();
      toast(ex.message || "文档编辑器加载失败", "bad");
    }
    return null;
  });
}
var reqDocFetchSeq = 0;
/* 搜索结果单独存放：reqDocList 保持全量（任务表单的文档下拉等消费方需要全量） */
var reqDocSearchList = null;
/* 列表加载失败：与「真的没有文档」区分，保留旧数据并提供重试 */
var reqDocsError = null;
function fetchReqDocs(kw, refreshFull){
  var seq = ++reqDocFetchSeq;
  if(!docCategoriesLoaded) loadDocCategories();
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
  loadDocCategories(true);
  loadReqs().then(function(){
    fillReqDocProjectSelect();
    /* 项目列表到位后重算「新建文档」按钮可见性（树可能先于 reqs 渲染过） */
    if(reqDocsLoaded) renderReqDocMode();
  });
  showReqDocList();
  setReqDocMode(reqDocMode);
  /* 文档列表带「已完成/总工作项」，看板或抽屉里改过任务后必须重新取，否则计数停在旧值 */
  loadReqDocs(true).then(function(){ renderReqDocMode(); });
  /* 新标签页深链只消费一次：之后在同页里切来切去不再把正文强行推出来 */
  var deepDoc = reqDocDeepLinkDone ? "" : docDeepLinkId();
  if(deepDoc){ reqDocDeepLinkDone = true; openReqDocEditor(deepDoc); }
}
function showReqDocList(){
  /* 同视图内再点「文档」也要先处理未保存正文，不能直接清空编辑态 */
  if(isReqDocEditing()){ tryCloseReqDocEditor(); return; }
  reqDocOpenSeq++;
  editingDocId = null;
  if(reqDocCommentMention) reqDocCommentMention.reset();
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
  /* 标题优先：MD 为默认格式不标注，仅 HTML 例外才标；拖拽/重命名收进行尾悬停浮层，不再常驻占位 */
  var fmtTail = fmtChipHTML(r.format);
  var caret = hasChild
    ? '<span class="rr-caret' + (collapsed ? " collapsed" : "") + '" data-toggle-doc="' + esc(r.id) + '" title="展开/收起子文档">' + icon("down", 13) + '</span>'
    : '<span class="rr-caret"></span>';
  /* A 创建人保护：拖动（组织顺序）项目可写即可；重命名/删除仅负责人或空间管理员，非负责人换锁形提示 */
  var acts = canEditReq(r.reqId)
    ? '<span class="rr-acts">' +
        '<span class="rr-drag" title="拖动调整顺序" aria-label="拖动调整顺序">' + icon("grip", 13) + '</span>' +
        (canEditDoc(r)
          ? '<span class="rr-rename" role="button" title="重命名" aria-label="重命名">' + icon("edit", 12) + '</span>'
          : '<span class="rr-lock" title="仅文档负责人或空间管理员可编辑 / 删除">' + icon("lock", 12) + '</span>') +
      '</span>'
    : '';
  return '<button class="reqdoc-row rd-depth' + Math.min(depth, 4) + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-reqdoc="' + esc(r.id) + '"' +
    ' data-rr-reqid="' + esc(r.reqId || "") + '"' +
    ' data-rr-depth="' + depth + '">' +
    caret +
    '<span class="rr-main">' +
      '<span class="rr-title">' + esc(r.title) + fmtTail + (r.publishedAt == null ? '<span class="rr-draft">草稿</span>' : '<span class="rr-published">已发布</span>') + docVisChip(r) + '</span>' +
      '<span class="rr-meta">' + meta.join(" · ") + '</span>' +
      (r.excerpt ? '<span class="rr-excerpt">' + esc(r.excerpt) + '</span>' : '') +
    '</span>' +
    acts +
    '<span class="rr-go">' + icon("chevronRight", 14) + '</span>' +
  '</button>';
}
/* ---------- 文档分类树：分组（项目 / 空间）→ 分类（不限层级）→ 文档（保留 parentId 嵌套） ---------- */

function docCatSort(a, b){
  var sa = a.sortOrder || 0, sb = b.sortOrder || 0;
  if(sa !== sb) return sa - sb;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
}
/* 分类一次取回（扁平 DFS，带 reqId 范围与 parentId），前端按范围分组并重建父子关系 */
function loadDocCategories(force){
  if(docCategoriesLoaded && !force) return Promise.resolve(docCategories || []);
  return API.get("/api/doc-categories").then(function(list){
    docCategories = list || [];
    docCategoriesLoaded = true;
    if(activeView === "requirements") renderReqDocMode();
    return docCategories;
  }).catch(function(){
    /* 分类加载失败不阻塞文档树：按「无分类」渲染，文档仍落在分组根 */
    docCategories = docCategories || [];
    docCategoriesLoaded = true;
    return docCategories;
  });
}
function docCatById(id){
  if(!id || !docCategories) return null;
  for(var i = 0; i < docCategories.length; i++) if(docCategories[i].id === id) return docCategories[i];
  return null;
}
/* 构建分组模型：每组带权限标记与嵌套节点（cat / doc），docCount 为子树文档总数（含嵌套子文档） */
function reqDocBuildTree(rows, search){
  var cats = docCategories || [];
  var groups = [], gIndex = {};
  function ensureGroup(reqId, name, kind){
    var key = reqId || "";
    if(gIndex[key]) return gIndex[key];
    var role = currentRole();
    var g = {
      key: key, reqId: reqId || null, name: name, kind: kind, nodes: [], items: [], docCount: 0,
      writable: reqId ? canEditReq(reqId) : !roleReadOnly(),
      manageCat: reqId ? canEditReq(reqId) : (role === "owner" || role === "admin")
    };
    gIndex[key] = g; groups.push(g); return g;
  }
  var scopeHas = {};
  rows.forEach(function(r){ var k = r.reqId || ""; (scopeHas[k] = scopeHas[k] || {}).docs = true; });
  cats.forEach(function(c){ var k = c.reqId || ""; (scopeHas[k] = scopeHas[k] || {}).cats = true; });
  if(reqDocReqFilter){
    ensureGroup(reqDocReqFilter, reqDocFilterName(reqDocReqFilter), "proj");
  }else{
    var order = {};
    rt.reqList.forEach(function(r, i){ order[r.id] = i; });
    Object.keys(scopeHas).filter(function(k){ return k !== ""; }).sort(function(a, b){
      var oa = order[a] == null ? 9999 : order[a], ob = order[b] == null ? 9999 : order[b];
      return oa - ob;
    }).forEach(function(k){ ensureGroup(k, reqDocProjectName(k), "proj"); });
    /* 空间文档分组常驻（即使暂无文档），便于就地新建空间级分类 / 文档；搜索态只在有命中时出现 */
    if(!search || scopeHas[""]) ensureGroup(null, "空间文档", "space");
  }
  groups.forEach(function(g){
    var scope = g.reqId || "";
    var gCats = cats.filter(function(c){ return (c.reqId || "") === scope; });
    var gDocs = rows.filter(function(r){ return (r.reqId || "") === scope; });
    g.items = gDocs;
    var catIds = {}; gCats.forEach(function(c){ catIds[c.id] = true; });
    var catKids = {};
    gCats.forEach(function(c){
      var pid = c.parentId || "";
      if(pid && catIds[pid]) (catKids[pid] = catKids[pid] || []).push(c);
    });
    var catRoots = gCats.filter(function(c){ var pid = c.parentId || ""; return !pid || !catIds[pid]; });
    /* 文档按 categoryId 归桶；分类不在可见范围时落到分组根桶 */
    var bucket = {};
    gDocs.forEach(function(r){
      var cid = r.categoryId && catIds[r.categoryId] ? r.categoryId : "";
      (bucket[cid] = bucket[cid] || []).push(r);
    });
    function docNodes(list, baseDepth){
      var byId = {}; list.forEach(function(d){ byId[d.id] = d; });
      var kids = {};
      list.forEach(function(d){
        if(d.parentId && byId[d.parentId] && d.parentId !== d.id) (kids[d.parentId] = kids[d.parentId] || []).push(d);
      });
      var roots = list.filter(function(d){ return !(d.parentId && byId[d.parentId] && d.parentId !== d.id); });
      function build(d, depth){
        var ch = (kids[d.id] || []).slice().sort(reqDocSort).map(function(k){ return build(k, depth + 1); });
        return { kind: "doc", id: d.id, doc: d, depth: depth, children: ch,
          docCount: 1 + ch.reduce(function(s, n){ return s + n.docCount; }, 0) };
      }
      return roots.slice().sort(reqDocSort).map(function(d){ return build(d, baseDepth); });
    }
    function catNode(c, depth){
      var subCats = (catKids[c.id] || []).slice().sort(docCatSort).map(function(k){ return catNode(k, depth + 1); });
      var subDocs = docNodes(bucket[c.id] || [], depth + 1);
      var children = subCats.concat(subDocs);
      return { kind: "cat", id: c.id, cat: c, name: c.name, depth: depth, children: children,
        docCount: children.reduce(function(s, n){ return s + n.docCount; }, 0) };
    }
    g.nodes = catRoots.slice().sort(docCatSort).map(function(c){ return catNode(c, 0); })
      .concat(docNodes(bucket[""] || [], 0));
    g.docCount = g.nodes.reduce(function(s, n){ return s + n.docCount; }, 0);
  });
  return groups;
}
/* 遍历模型：分类行 + 文档行共用一套折叠逻辑，两种视图仅行 HTML 不同 */
function reqDocWalkNodes(nodes, g, catHTML, docHTML){
  return nodes.map(function(n){
    if(n.kind === "cat"){
      var col = !!reqDocCollapsedCats[n.id];
      return catHTML(n, g, col) + (col ? "" : reqDocWalkNodes(n.children, g, catHTML, docHTML));
    }
    var colD = !!reqDocCollapsedDocs[n.id];
    return docHTML(n.doc, n.depth, n.children.length > 0, colD) +
      (n.children.length && !colD ? reqDocWalkNodes(n.children, g, catHTML, docHTML) : "");
  }).join("");
}
function reqDocGroupTagsHTML(g){
  return (g.kind === "space" ? '<span class="rp-tag">不挂项目</span>' : "") +
    (g.writable ? "" : '<span class="rp-tag ro">只读</span>');
}
function reqDocEmptyBodyHTML(g){
  return '<div class="reqdoc-cat-empty">' + ((g.writable || g.manageCat) ? "右击分组头可新建分类或文档" : "该范围暂无文档") + '</div>';
}
/* 列表视图分类行 */
function reqDocCatRowHTML(n, g, collapsed){
  var hasKids = n.children.length > 0;
  var caret = hasKids
    ? '<span class="rr-caret' + (collapsed ? " collapsed" : "") + '" data-cat-toggle="' + esc(n.id) + '" title="展开/收起分类">' + icon("down", 13) + '</span>'
    : '<span class="rr-caret"></span>';
  var acts = g.manageCat
    ? '<span class="rr-acts"><span class="rr-rename" role="button" data-cat-rename="' + esc(n.id) + '" title="重命名分类" aria-label="重命名分类">' + icon("edit", 12) + '</span></span>'
    : '';
  return '<button class="reqdoc-cat rd-depth' + Math.min(n.depth, 4) + '" type="button" data-cat="' + esc(n.id) + '"' +
    ' data-cat-reqid="' + esc(g.reqId || "") + '" data-cat-depth="' + n.depth + '">' +
    caret +
    '<span class="rc-folder">' + icon("folder", 15) + '</span>' +
    '<span class="rc-name">' + esc(n.name) + '</span>' + docCatDefaultChip(n.cat) +
    '<span class="rc-count" title="子树文档数">' + n.docCount + '</span>' +
    acts +
  '</button>';
}
function renderReqDocTree(){
  var box = $("reqDocTree");
  if(!box) return;
  /* 新建入口：非查看者（可写空间级文档）或有可写项目时显示。
     查看者对所有项目恒为只读，无需等项目列表加载即可判定隐藏，避免 reqsLoaded 仅由看板置位时误显。 */
  var nb = $("reqDocNew");
  if(nb) nb.style.display = (!roleReadOnly() || rt.reqList.some(function(r){ return canEditReq(r.id); })) ? "" : "none";
  if(!reqDocsLoaded){
    box.innerHTML = UI.skeletonRows(4);
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocVisibleRows();   // 关键字过滤由服务端完成，结果单独缓存
  if(kw && !rows.length){
    box.innerHTML = '<div class="reqdoc-empty2">没有找到匹配的文档</div>';
    return;
  }
  var groups = reqDocBuildTree(rows, !!kw);
  reqDocGroupsCache = groups;
  if(!groups.length){
    box.innerHTML = reqDocEmptyHTML();
    return;
  }
  box.innerHTML = groups.map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    /* 搜索时平铺展示命中项，不做分类层级缩进 */
    var body = kw
      ? g.items.slice().sort(reqDocSort).map(function(r){ return reqDocRowHTML(r, 0, false, false); }).join("")
      : reqDocWalkNodes(g.nodes, g, reqDocCatRowHTML, reqDocRowHTML);
    if(!body) body = reqDocEmptyBodyHTML(g);
    return '<div class="reqdoc-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="reqdoc-proj-head" type="button" data-toggle-proj="' + esc(g.key) + '"' +
        ' data-proj-reqid="' + esc(g.reqId || "") + '" data-proj-kind="' + g.kind + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + (g.kind === "space" ? icon("globe", 14) : icon("down", 14)) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        reqDocGroupTagsHTML(g) +
        '<span class="rp-count">' + g.docCount + '</span>' +
      '</button>' +
      '<div class="reqdoc-proj-body">' + body + '</div>' +
    '</div>';
  }).join("");
}
function toggleReqProj(key){
  reqCollapsed[key] = !reqCollapsed[key];
  renderReqDocTree();
}
function toggleReqDocCat(id){
  reqDocCollapsedCats[id] = !reqDocCollapsedCats[id];
  if(reqDocMode === "read") renderReqDocSplit(); else renderReqDocTree();
}

/* ---------- 分类就地维护：右键菜单 + 行内新建/重命名 + 删除（非空拒绝） ---------- */

var reqDocCtxEl = null;
var reqDocCtxTarget = null;
function reqDocCtxMenu(){
  if(reqDocCtxEl) return reqDocCtxEl;
  var el = document.createElement("div");
  el.className = "reqdoc-ctx";
  el.id = "reqDocCtxMenu";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", "文档分类树右键菜单");
  document.body.appendChild(el);
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-ctx-act]");
    if(!b || !reqDocCtxTarget) return;
    var act = b.dataset.ctxAct, t = reqDocCtxTarget;
    closeReqDocCtx();
    runReqDocCtxAct(act, t);
  });
  reqDocCtxEl = el;
  return el;
}
function closeReqDocCtx(){
  if(reqDocCtxEl) reqDocCtxEl.classList.remove("open");
  reqDocCtxTarget = null;
}
function reqDocFindGroup(key){
  for(var i = 0; i < reqDocGroupsCache.length; i++) if(reqDocGroupsCache[i].key === (key || "")) return reqDocGroupsCache[i];
  return null;
}
function reqDocEachNode(fn){
  reqDocGroupsCache.forEach(function(g){
    (function walk(nodes){ nodes.forEach(function(n){ fn(n, g); walk(n.children); }); })(g.nodes);
  });
}
function reqDocFindNode(id){
  var hit = null;
  reqDocEachNode(function(n, g){ if(!hit && n.id === id) hit = { node: n, group: g }; });
  return hit;
}
function reqDocCatManageable(scope){
  var role = currentRole();
  return scope ? canEditReq(scope) : (role === "owner" || role === "admin");
}
function openReqDocCtx(x, y, target){
  var el = reqDocCtxMenu();
  var g, node = null, head = "", kindLabel = "";
  if(target.type === "group"){
    g = reqDocFindGroup(target.key);
    if(!g){ closeReqDocCtx(); return; }
    head = g.name; kindLabel = g.kind === "space" ? "空间：" : "项目：";
  }else{
    var hit = reqDocFindNode(target.id);
    if(!hit){ closeReqDocCtx(); return; }
    node = hit.node; g = hit.group;
    head = node.kind === "cat" ? node.name : (node.doc.title || "");
    kindLabel = node.kind === "cat" ? "分类：" : "文档：";
  }
  reqDocCtxTarget = target;
  var mc = g.manageCat, wd = g.writable;
  var items = '<div class="ctx-head">' + esc(kindLabel + head) + '</div>';
  var any = false;
  var isContainer = target.type === "group" || (node && node.kind === "cat");
  if(isContainer){
    if(mc){ items += '<button type="button" data-ctx-act="cat"><span class="ic">' + icon("folder", 14) + '</span>' + (target.type === "group" ? "新建一级分类" : "新建子分类") + '</button>'; any = true; }
    if(wd){ items += '<button type="button" data-ctx-act="doc"><span class="ic">' + icon("note", 14) + '</span>新建文档</button>'; any = true; }
    if(target.type !== "group" && mc){
      items += '<div class="sep"></div>';
      if(node && node.kind === "cat"){
        items += '<button type="button" data-ctx-act="catvis"><span class="ic">' + icon("shield", 14) + '</span>默认可见范围…</button>';
      }
      items += '<button type="button" data-ctx-act="rename"><span class="ic">' + icon("edit", 14) + '</span>重命名</button><button type="button" data-ctx-act="del" class="danger"><span class="ic">' + icon("trash", 14) + '</span>删除</button>';
    }
  }else if(wd){
    /* A 创建人保护：新建子文档（组织/新增）项目可写即可；重命名/删除仅负责人或空间管理员 */
    items += '<button type="button" data-ctx-act="subdoc"><span class="ic">' + icon("note", 14) + '</span>新建子文档</button>'; any = true;
    if(canEditDoc(node.doc)){
      items += '<div class="sep"></div><button type="button" data-ctx-act="rename"><span class="ic">' + icon("edit", 14) + '</span>重命名</button><button type="button" data-ctx-act="del" class="danger"><span class="ic">' + icon("trash", 14) + '</span>删除</button>';
    }else{
      items += '<div class="ctx-note">仅文档负责人或空间管理员可重命名 / 删除；你可新建子文档。</div>';
    }
  }
  if(!any) items += '<div class="ctx-note">' + (roleReadOnly() ? "你对该范围只有查看权限。" : (g.kind === "space" ? "空间级分类仅空间主/管理员可维护；你仍可新建空间级文档。" : "你对该项目只读，仅可查看与阅读。")) + '</div>';
  else if(!mc && g.kind === "space") items += '<div class="ctx-note">空间级分类仅空间主/管理员可维护；你仍可新建空间级文档。</div>';
  el.innerHTML = items;
  el.classList.add("open");
  var w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
  el.style.left = Math.max(8, Math.min(x, vw - w - 8)) + "px";
  el.style.top = Math.max(8, Math.min(y, vh - h - 8)) + "px";
}
function runReqDocCtxAct(act, t){
  if(t.type === "group"){
    var g = reqDocFindGroup(t.key);
    if(!g) return;
    var headSel = reqDocMode === "read" ? '#reqDocSplitTree [data-rs-proj="' + g.key + '"]' : '#reqDocTree [data-toggle-proj="' + g.key + '"]';
    var head = document.querySelector(headSel);
    var body = head ? head.parentNode.querySelector(reqDocMode === "read" ? ".rs-proj-body" : ".reqdoc-proj-body") : null;
    if(act === "cat") beginCreateDocCat(g.reqId || "", "", 0, body || head, "prepend");
    else if(act === "doc") openNewReqDocDialog(g.reqId || undefined, {});
    return;
  }
  var hit = reqDocFindNode(t.id);
  if(!hit) return;
  var n = hit.node, g2 = hit.group;
  if(n.kind === "cat"){
    var catSel = reqDocMode === "read" ? '#reqDocSplitTree [data-rs-cat="' + n.id + '"]' : '#reqDocTree [data-cat="' + n.id + '"]';
    var catEl = document.querySelector(catSel);
    if(act === "cat") beginCreateDocCat(g2.reqId || "", n.id, n.depth + 1, catEl, "after");
    else if(act === "doc") openNewReqDocDialog(g2.reqId || undefined, { categoryId: n.id });
    else if(act === "rename") beginRenameDocCat(n.id);
    else if(act === "catvis") openDocCatVisDialog(n.id);
    else if(act === "del") deleteDocCat(n.id);
  }else{
    var d = n.doc;
    if(act === "subdoc") openNewReqDocDialog(d.reqId || undefined, { categoryId: d.categoryId || "", parentId: d.id });
    else if(act === "rename") renameDocFromCtx(d.id);
    else if(act === "del") deleteDocFromCtx(d.id);
  }
}
/* 行内名称输入：新建分类用临时输入框（不落服务端占位），回车提交 / Esc 取消 */
function reqDocCatNameInput(opts){
  if(!opts.anchorEl) return;
  var input = document.createElement("input");
  input.type = "text";
  input.maxLength = 50;
  input.className = opts.inputClass;
  input.value = opts.value || "";
  input.placeholder = opts.placeholder || "分类名称";
  input.setAttribute("aria-label", "分类名称");
  if(opts.place === "prepend") opts.anchorEl.insertBefore(input, opts.anchorEl.firstChild);
  else opts.anchorEl.parentNode.insertBefore(input, opts.anchorEl.nextSibling);
  input.focus();
  input.select();
  var done = false;
  function finish(commit){
    if(done) return;
    done = true;
    var name = (input.value || "").trim();
    if(input.parentNode) input.parentNode.removeChild(input);
    if(commit && name) opts.onCommit(name);
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); finish(true); }
    else if(e.key === "Escape"){ e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function(){ finish(true); });
}
function beginCreateDocCat(scopeReqId, parentId, depth, anchorEl, place){
  if(!reqDocCatManageable(scopeReqId)){
    toast(scopeReqId ? "你对该项目只有查看权限，无法维护分类" : "空间级分类仅空间主或管理员可维护", "warn");
    return;
  }
  reqDocCatNameInput({
    anchorEl: anchorEl, place: place, depth: depth, value: "",
    placeholder: "分类名称，回车创建 / Esc 取消",
    inputClass: (reqDocMode === "read" ? "rs-rename-input" : "rr-rename-input") + " rd-depth" + Math.min(depth, 4),
    onCommit: function(name){
      API.post("/api/doc-categories", { reqId: scopeReqId || "", name: name, parentId: parentId || "" }).then(function(){
        toast("已创建分类「" + name + "」", "fs");
        if(parentId) delete reqDocCollapsedCats[parentId];
        return loadDocCategories(true);
      }).catch(function(ex){ toast(ex.message || "创建分类失败", "bad"); });
    }
  });
}
function beginRenameDocCat(id){
  var c = docCatById(id);
  if(!c) return;
  if(!reqDocCatManageable(c.reqId || "")){
    toast((c.reqId || "") ? "你对该项目只有查看权限" : "空间级分类仅空间主或管理员可维护", "warn");
    return;
  }
  var read = reqDocMode === "read";
  var btn = document.querySelector(read ? '#reqDocSplitTree [data-rs-cat="' + id + '"]' : '#reqDocTree [data-cat="' + id + '"]');
  if(!btn || btn.dataset.catRenaming) return;
  var depth = parseInt(read ? btn.dataset.rsDepth : btn.dataset.catDepth, 10) || 0;
  btn.dataset.catRenaming = "1";
  btn.style.display = "none";
  var input = document.createElement("input");
  input.type = "text";
  input.maxLength = 50;
  input.value = c.name || "";
  input.className = (read ? "rs-rename-input" : "rr-rename-input") + " rd-depth" + Math.min(depth, 4);
  input.setAttribute("aria-label", "分类名称");
  btn.parentNode.insertBefore(input, btn.nextSibling);
  input.focus();
  input.select();
  var done = false;
  function finish(save){
    if(done) return;
    done = true;
    var name = (input.value || "").trim();
    delete btn.dataset.catRenaming;
    btn.style.display = "";
    if(input.parentNode) input.parentNode.removeChild(input);
    if(!save || !name || name === c.name) return;
    API.put("/api/doc-categories/" + encodeURIComponent(id), { name: name }).then(function(){
      toast("已重命名为「" + name + "」", "fs");
      return loadDocCategories(true);
    }).catch(function(ex){ toast(ex.message || "重命名失败", "bad"); });
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); finish(true); }
    else if(e.key === "Escape"){ e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", function(){ finish(true); });
}
function deleteDocCat(id){
  var c = docCatById(id);
  if(!c) return;
  if(!reqDocCatManageable(c.reqId || "")){
    toast((c.reqId || "") ? "你对该项目只有查看权限" : "空间级分类仅空间主或管理员可维护", "warn");
    return;
  }
  var hit = reqDocFindNode(id), subCats = 0, subDocs = 0;
  if(hit){
    (function count(n){ n.children.forEach(function(k){ if(k.kind === "cat"){ subCats++; count(k); } else { subDocs++; count(k); } }); })(hit.node);
  }
  /* 服务端按全部文档计数兜底；这里先用可见模型给出可操作提示 */
  if(subCats || subDocs){
    toast("分类「" + c.name + "」下还有 " + subCats + " 个子分类、" + subDocs + " 篇文档，请先移出或删除后再删分类", "warn");
    return;
  }
  UI.showConfirm({
    title: "删除分类", okText: "删除分类",
    msg: "删除空分类「<b>" + esc(c.name) + "</b>」？分类下没有文档，不影响文档数据。"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/doc-categories/" + encodeURIComponent(id)).then(function(){
      toast("分类「" + c.name + "」已删除", "fs");
      delete reqDocCollapsedCats[id];
      return loadDocCategories(true);
    }).catch(function(ex){ toast(ex.message || "删除分类失败", "bad"); });
  });
}
function renameDocFromCtx(id){
  var d = reqDocById(id);
  if(!d) return;
  if(!canEditReq(d.reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!canEditDoc(d)){ toast("仅文档负责人或空间管理员可编辑 / 删除", "warn"); return; }
  if(reqDocMode === "read"){
    var node = document.querySelector('#reqDocSplitTree [data-rs-doc="' + id + '"]');
    if(node) reqDocBeginRename(id, { titleEl: node.querySelector(".rs-title"), hideEl: node,
      inputClass: "rs-rename-input" + (node.dataset.rsDepth ? " rd-depth" + Math.min(parseInt(node.dataset.rsDepth, 10) || 0, 4) : "") });
  }else{
    var row = document.querySelector('#reqDocTree [data-reqdoc="' + id + '"]');
    if(row) reqDocBeginRename(id, { titleEl: row.querySelector(".rr-title"), hideEl: row,
      inputClass: "rr-rename-input" + (row.dataset.rrDepth ? " rd-depth" + Math.min(parseInt(row.dataset.rrDepth, 10) || 0, 4) : "") });
  }
}
function deleteDocFromCtx(id){
  var d = reqDocById(id);
  if(!d) return;
  if(!canEditReq(d.reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!canEditDoc(d)){ toast("仅文档负责人或空间管理员可编辑 / 删除", "warn"); return; }
  UI.showConfirm({
    title: "删除文档", okText: "删除文档",
    msg: "子文档会上移一级，关联到它的工作项与需求池条目会自动解除关联（工作项与需求本身不会被删除）。确定删除「" + esc(d.title) + "」？"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(id)).then(function(){
      toast("文档已删除");
      if(editingDocId === id) closeReqDocEditor();
      if(splitDocId === id) splitDocId = null;
      loadReqDocs(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function reqDocTreeContextMenu(e){
  var head = e.target.closest("[data-toggle-proj],[data-rs-proj]");
  if(head){
    e.preventDefault();
    var key = head.dataset.toggleProj != null ? head.dataset.toggleProj : head.dataset.rsProj;
    openReqDocCtx(e.clientX, e.clientY, { type: "group", key: key });
    return;
  }
  var cat = e.target.closest("[data-cat],[data-rs-cat]");
  if(cat){ e.preventDefault(); openReqDocCtx(e.clientX, e.clientY, { type: "cat", id: cat.dataset.cat || cat.dataset.rsCat }); return; }
  var doc = e.target.closest("[data-reqdoc],[data-rs-doc]");
  if(doc){ e.preventDefault(); openReqDocCtx(e.clientX, e.clientY, { type: "doc", id: doc.dataset.reqdoc || doc.dataset.rsDoc }); return; }
}

/* ---------- 阅读 / 列表 / 看板 / 最近动态：同一份数据的四种展示（阅读为默认首个 tab） ---------- */

var RD_MODES = ["read", "tree", "kanban", "feed"];
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
/* 阅读侧栏当前 tab：comments（评论）/ perm（权限说明，只读） */
var rrdActiveTab = "comments";
var rrdCanComment = false;
var rrdQuote = null;
var rrdSelText = "";
var rrdFlashCommentId = null;
var rrdSelBubble = null;
/* 两处文档评论框各自的 @ 候选：编辑页一个、阅读侧栏一个（侧栏会随渲染重建） */
var reqDocCommentMention = null;
var rrdMentionPicker = null;
var readerExportSeq = 0;
var feedSeq = 0;
var draggingReqDocId = null;

function reqDocModePref(){
  try{
    var v = localStorage.getItem("ds.reqDocMode");
    return RD_MODES.indexOf(v) >= 0 ? v : "read";
  }catch(e){ return "read"; }
}
function setReqDocMode(mode){
  reqDocMode = RD_MODES.indexOf(mode) >= 0 ? mode : "read";
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
  if(reqDocReqFilter) return '<div class="reqdoc-empty2">这个项目还没有文档。点右上角「新建文档」并选择该项目即可创建。</div>';
  return '<div class="reqdoc-empty2">还没有文档。点右上角「新建文档」，先选项目再填文档名称。</div>';
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
  return !!(p.q || p.reqId || (p.mode && p.mode !== "read"));
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
  setReqDocMode(p.mode || "read");
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
  UI.showConfirm({ title: "删除视图", msg: "确定删除该文档视图？不影响文档数据。", okText: "删除视图" }).then(function(ok){
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
  /* 标题优先：MD 为默认格式不标注，仅 HTML 例外标移到标题之后 */
  var fmtTail = fmtChipHTML(d.format);
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
    '<div class="rk-head"><span class="rk-title">' + esc(d.title) + pub + docVisChip(d) + '</span>' + fmtTail + '</div>' +
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

/* ---------- 正文缩放（阅读 / 编辑共用，只缩正文不缩工具栏） ---------- */

var DOC_ZOOM_MIN = 0.8, DOC_ZOOM_MAX = 2, DOC_ZOOM_STEP = 0.1;
var docZoomCache = null;

function docZoomPref(){
  if(docZoomCache != null) return docZoomCache;
  var v = 1;
  try{
    var saved = parseFloat(localStorage.getItem("ds.reqDocZoom"));
    if(isFinite(saved) && saved >= DOC_ZOOM_MIN && saved <= DOC_ZOOM_MAX) v = saved;
  }catch(e){ /* 隐私模式忽略 */ }
  docZoomCache = Math.round(v * 100) / 100;
  return docZoomCache;
}
function docWidePref(){
  try{ return localStorage.getItem("ds.reqDocWide") === "1"; }catch(e){ return false; }
}
/** 变量挂在视图根节点上：正文容器每次重绘都会重建，挂根节点才能一直生效 */
function applyDocZoom(){
  var root = $("view-requirements");
  if(root) root.style.setProperty("--doc-zoom", String(docZoomPref()));
  syncDocZoomUI();
}
function syncDocZoomUI(){
  var z = docZoomPref();
  var root = $("view-requirements");
  if(!root) return;
  root.querySelectorAll("[data-doc-zoom-val]").forEach(function(el){
    el.textContent = Math.round(z * 100) + "%";
  });
  root.querySelectorAll('[data-doc-zoom="out"]').forEach(function(b){
    b.disabled = z <= DOC_ZOOM_MIN + 0.001;
  });
  root.querySelectorAll('[data-doc-zoom="in"]').forEach(function(b){
    b.disabled = z >= DOC_ZOOM_MAX - 0.001;
  });
  var wide = docWidePref();
  root.querySelectorAll("[data-rrd-wide]").forEach(function(b){
    var tip = wide ? "退出宽屏" : "宽屏阅读（收起左侧文档树）";
    b.setAttribute("aria-pressed", wide ? "true" : "false");
    b.setAttribute("data-tip", tip);
    b.setAttribute("aria-label", tip);
    if(b.classList.contains("ibtn")) b.innerHTML = icon(wide ? "compress" : "expand", 15);
  });
}
function setDocZoom(next){
  var z = Math.round(Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, next)) * 100) / 100;
  if(z === docZoomPref()) return;
  docZoomCache = z;
  try{ localStorage.setItem("ds.reqDocZoom", String(z)); }catch(e){ /* 隐私模式忽略 */ }
  applyDocZoom();
}
function zoomDocBy(step){ setDocZoom(docZoomPref() + step); }
function resetDocZoom(){ setDocZoom(1); }
/** 宽屏只在本轮已选中文档时生效：没有正文可看时保留左树，避免“进得去出不来” */
function applyDocWideState(){
  var split = $("reqDocSplit");
  if(!split) return;
  split.classList.toggle("wide", docWidePref() && !!splitDocId);
  syncDocZoomUI();
}
function toggleDocWide(){
  if(!splitDocId) return;
  try{ localStorage.setItem("ds.reqDocWide", docWidePref() ? "0" : "1"); }catch(e){ /* 忽略 */ }
  applyDocWideState();
}
function docZoomControlHTML(){
  return '<span class="seg mini doc-zoom" role="group" aria-label="正文缩放">' +
    '<button type="button" data-doc-zoom="out" title="缩小正文（Ctrl/⌘ + 滚轮）" aria-label="缩小正文">' + icon("zoomOut", 14) + '</button>' +
    '<button type="button" data-doc-zoom="reset" data-doc-zoom-val title="恢复 100%">' + docZoomLabel() + '</button>' +
    '<button type="button" data-doc-zoom="in" title="放大正文（Ctrl/⌘ + 滚轮）" aria-label="放大正文">' + icon("zoomIn", 14) + '</button>' +
  '</span>';
}
function docZoomLabel(){
  return Math.round(docZoomPref() * 100) + "%";
}

/* ---------- 阅读：左侧文档树 + 右侧正文 ---------- */

function reqDocSplitNodeHTML(r, depth, hasChild, collapsed){
  var caret = hasChild
    ? '<span class="rs-caret' + (collapsed ? " collapsed" : "") + '" data-rs-toggle="' + esc(r.id) + '" title="展开/收起子文档">' + icon("down", 12) + '</span>'
    : '<span class="rs-caret"></span>';
  var pub = r.publishedAt == null ? '<span class="rr-draft">草稿</span>' : '<span class="rr-published" title="已发布">已发布</span>';
  /* 标题优先：MD 为默认格式不标注，仅 HTML 例外才标；拖拽/重命名收进行尾悬停浮层，不再常驻占位 */
  var fmtTail = fmtChipHTML(r.format);
  /* A 创建人保护：拖动项目可写即可；重命名仅负责人或空间管理员，非负责人换锁形提示 */
  var acts = canEditReq(r.reqId)
    ? '<span class="rs-acts">' +
        '<span class="rs-drag" title="拖动调整顺序" aria-label="拖动调整顺序">' + icon("grip", 12) + '</span>' +
        (canEditDoc(r)
          ? '<span class="rs-rename" role="button" title="重命名" aria-label="重命名">' + icon("edit", 11) + '</span>'
          : '<span class="rs-lock" title="仅文档负责人或空间管理员可编辑 / 删除">' + icon("lock", 11) + '</span>') +
      '</span>'
    : '';
  return '<button class="rs-node rd-depth' + Math.min(depth, 4) + (r.id === splitDocId ? " active" : "") + '" type="button" draggable="' + (canEditReq(r.reqId) ? 'true' : 'false') + '" data-rs-doc="' + esc(r.id) + '"' +
    ' data-rs-reqid="' + esc(r.reqId || "") + '"' +
    ' data-rs-depth="' + depth + '">' +
    caret +
    '<span class="rs-title">' + esc(r.title) + '</span>' +
    fmtTail + pub + docVisChip(r) + acts +
  '</button>';
}
/* 阅读视图分类行 */
function reqDocCatSplitHTML(n, g, collapsed){
  var hasKids = n.children.length > 0;
  var caret = hasKids
    ? '<span class="rs-caret' + (collapsed ? " collapsed" : "") + '" data-rs-cat-toggle="' + esc(n.id) + '" title="展开/收起分类">' + icon("down", 12) + '</span>'
    : '<span class="rs-caret"></span>';
  var acts = g.manageCat
    ? '<span class="rs-acts"><span class="rs-rename" role="button" data-cat-rename="' + esc(n.id) + '" title="重命名分类" aria-label="重命名分类">' + icon("edit", 11) + '</span></span>'
    : '';
  return '<button class="rs-cat rd-depth' + Math.min(n.depth, 4) + '" type="button" data-rs-cat="' + esc(n.id) + '"' +
    ' data-rs-cat-reqid="' + esc(g.reqId || "") + '" data-rs-depth="' + n.depth + '">' +
    caret +
    '<span class="rs-folder">' + icon("folder", 14) + '</span>' +
    '<span class="rs-title">' + esc(n.name) + '</span>' + docCatDefaultChip(n.cat) +
    '<span class="rs-kids" title="子树文档数">' + n.docCount + '</span>' +
    acts +
  '</button>';
}
function renderReqDocSplit(){
  var box = $("reqDocSplitTree");
  if(!box) return;
  applyDocWideState();
  /* 选中的文档已被删除：回到占位提示 */
  if(splitDocId && !reqDocById(splitDocId)){
    splitDocId = null;
    if($("reqDocReader")) $("reqDocReader").innerHTML = '<div class="rrd-empty"><div class="rrd-empty-title">从左侧选择文档阅读</div><div class="rrd-empty-text">右击分组头或分类可就地新建分类与文档；空间文档不挂项目</div></div>';
  }
  if(!reqDocsLoaded){
    box.innerHTML = UI.skeletonRows(4);
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocVisibleRows();
  if(kw && !rows.length){
    box.innerHTML = '<div class="reqdoc-empty2">没有找到匹配的文档</div>';
    return;
  }
  var groups = reqDocBuildTree(rows, !!kw);
  reqDocGroupsCache = groups;
  if(!groups.length){
    box.innerHTML = reqDocEmptyHTML();
    return;
  }
  box.innerHTML = groups.map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    /* 搜索时平铺展示命中项，不做分类层级缩进 */
    var body = kw
      ? g.items.slice().sort(reqDocSort).map(function(r){ return reqDocSplitNodeHTML(r, 0, false, false); }).join("")
      : reqDocWalkNodes(g.nodes, g, reqDocCatSplitHTML, reqDocSplitNodeHTML);
    if(!body) body = reqDocEmptyBodyHTML(g);
    return '<div class="rs-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="rs-proj-head' + (g.kind === "space" ? " space" : "") + '" type="button" data-rs-proj="' + esc(g.key) + '"' +
        ' data-proj-reqid="' + esc(g.reqId || "") + '" data-proj-kind="' + g.kind + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + (g.kind === "space" ? icon("globe", 13) : icon("down", 12)) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        reqDocGroupTagsHTML(g) +
        '<span class="rp-count">' + g.docCount + '</span>' +
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
/* 先在惰性的 template 里给图片加懒加载/异步解码再挂载：直接 innerHTML 会立刻解码全部内嵌图片 */
function reqDocReaderFill(body, cleanHtml){
  var tpl = document.createElement("template");
  tpl.innerHTML = cleanHtml;
  var imgs = tpl.content.querySelectorAll("img");
  for(var i = 0; i < imgs.length; i++){
    imgs[i].setAttribute("loading", "lazy");
    imgs[i].setAttribute("decoding", "async");
  }
  body.textContent = "";
  body.appendChild(tpl.content);
}
function renderReqDocReader(doc){
  var box = $("reqDocReader");
  if(!box) return;
  rrdDocDetail = doc;
  var pubBadge = doc.publishedAt == null
    ? '<span class="rr-draft">草稿</span>'
    : '<span class="rr-published" title="已发布">已发布</span>';
  var meta = [esc(docTypeName(doc.docType)), "负责人 " + esc(doc.owner || "—"), reqDocStatusLabel(doc.status)];
  if(doc.updatedAt) meta.push("更新于 " + esc(fmtTs(doc.updatedAt)));
  if(doc.taskCount) meta.push(doc.doneCount + "/" + doc.taskCount + " 工作项");
  var canWrite = !roleReadOnly() && canEditReq(doc.reqId);
  /* A 创建人保护：改删/重命名/恢复历史仅负责人或空间管理员；评论仍按项目可写（canWrite） */
  var canMut = canEditDoc(doc);
  rrdCommentsDocId = doc.id;
  rrdComments = [];
  rrdCommentsOpen = false;
  rrdActiveTab = "comments";
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
        '<h3><span class="rrd-title-text">' + esc(doc.title) + '</span>' + pubBadge + docVisChip(doc) + '</h3>' +
        '<span class="rrd-acts">' +
          docZoomControlHTML() +
          '<span class="vdiv" aria-hidden="true"></span>' +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-wide aria-pressed="false" data-tip="宽屏阅读（收起左侧文档树）" aria-label="宽屏阅读">' + icon("expand", 15) + '</button>' +
          '<span class="vdiv" aria-hidden="true"></span>' +
          (canMut ? '<button class="btn sm ghost ibtn" type="button" data-rrd-rename="' + esc(doc.id) + '" data-tip="重命名文档" aria-label="重命名文档">' + icon("edit", 15) + '</button>' : '') +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-comments="' + esc(doc.id) + '" id="rrdCommentsBtn" data-tip="评论 · 选中正文可划线" aria-label="评论">' + icon("comment", 15) + '<span class="rrd-cnt" id="rrdCommentsBadge" hidden></span></button>' +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-perm="' + esc(doc.id) + '" data-tip="权限说明（只读）" aria-label="权限说明">' + icon("shield", 15) + '</button>' +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-history="' + esc(doc.id) + '" data-can-restore="' + (canMut ? "1" : "0") + '" data-tip="历史版本" aria-label="历史版本">' + icon("clock", 15) + '</button>' +
          '<span class="vdiv" aria-hidden="true"></span>' +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-export="' + esc(doc.id) + '" data-tip="导出 Markdown / HTML" aria-label="导出 Markdown / HTML">' + icon("download", 15) + '</button>' +
          '<button class="btn sm ghost ibtn" type="button" data-rrd-export-word="' + esc(doc.id) + '" data-tip="导出 Word（.docx）" aria-label="导出 Word">' + icon("docW", 15) + '</button>' +
          '<span class="vdiv" aria-hidden="true"></span>' +
          '<button class="btn sm soft" type="button" data-rrd-edit="' + esc(doc.id) + '"' + (canMut ? ' data-tip="编辑这篇文档" aria-label="编辑文档"' : ' disabled title="仅文档负责人或空间管理员可编辑"') + '>' + icon("edit", 13) + ' 编辑文档</button>' +
        '</span>' +
      '</div>' +
      '<div class="rrd-meta">' + meta.join(" · ") + '</div>' +
    '</div>' +
    '<div class="rrd-body markdown-body" id="reqDocReaderBody"></div>' +
    '</div>' +
    '<aside class="rrd-comments" id="rrdComments" hidden aria-label="文档侧栏">' +
      '<div class="rrdc-head rrdc-tabhead">' +
        '<div class="rrdc-tabbar" role="tablist" aria-label="侧栏切换">' +
          '<button class="rrdc-tab active" type="button" role="tab" aria-selected="true" data-rrd-tab="comments"><span id="rrdCommentsTitle">评论</span></button>' +
          '<button class="rrdc-tab" type="button" role="tab" aria-selected="false" data-rrd-tab="perm">' + icon("shield", 13) + ' 权限说明</button>' +
        '</div>' +
        '<button class="icon-btn sm" type="button" id="rrdCommentsX" aria-label="关闭侧栏"><span data-icon="close"></span></button>' +
      '</div>' +
      '<div class="rrdc-pane" id="rrdPaneComments">' +
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
      '</div>' +
      '<div class="rrdc-pane rrdc-perm" id="rrdPanePerm" hidden></div>' +
    '</aside>';
  syncDocZoomUI();
  UI.wireTooltips(box);
  loadRrdCommentCount(doc.id);
  if(!canWrite){ var cf = $("rrdCommentForm"); if(cf) cf.style.display = "none"; }
  bindRrdMention();
  renderReqDocCrumb($("rrdCrumb"), doc.id);
  var body = $("reqDocReaderBody");
  var id = doc.id;
  var prep = doc.format === "univer"
    ? Promise.all([loadMarkdownLib(), ensureVendor()])
    : loadMarkdownLib();
  prep.then(function(){
    if(splitDocId !== id) return;
    var html = "";
    if(doc.format === "univer"){
      var snap = parseSnapshot(doc.content);
      html = snap ? snapshotToHtml(snap) : "";
    }else if(doc.format === "markdown"){
      try{ html = window.marked.parse(doc.content || "", { gfm: true, breaks: false }); }catch(e){ html = ""; }
    }else{
      /* 服务端已按白名单清洗过，这里再过一道 DOMPurify（双保险） */
      html = doc.content || "";
    }
    reqDocReaderFill(body, window.DOMPurify.sanitize(html));
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
  var parts = [assocLinkHTML("project", d.reqId, reqDocProjectName(d.reqId), {cls:"rrd-crumb-proj", plain:'<span class="rrd-crumb-proj">' + esc(reqDocProjectName(d.reqId)) + '</span>'})];
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
  if(!d) return;
  if(!canEditReq(d.reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!canEditDoc(d)){ toast("仅文档负责人或空间管理员可编辑 / 删除", "warn"); return; }
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
function toggleRrdComments(open, tab){
  var panel = $("rrdComments");
  var box = $("reqDocReader");
  if(!panel || !box) return;
  rrdCommentsOpen = open == null ? !rrdCommentsOpen : !!open;
  panel.hidden = !rrdCommentsOpen;
  box.classList.toggle("with-comments", rrdCommentsOpen);
  if(rrdCommentsOpen) setRrdTab(tab || rrdActiveTab || "comments");
}
/* 侧栏 tab 切换：评论 / 权限说明（只读）。打开侧栏时按入口定位 tab */
function setRrdTab(tab){
  rrdActiveTab = tab === "perm" ? "perm" : "comments";
  var pc = $("rrdPaneComments"), pp = $("rrdPanePerm");
  if(pc) pc.hidden = rrdActiveTab !== "comments";
  if(pp) pp.hidden = rrdActiveTab !== "perm";
  var tabs = document.querySelectorAll("#rrdComments [data-rrd-tab]");
  for(var i = 0; i < tabs.length; i++){
    var on = tabs[i].getAttribute("data-rrd-tab") === rrdActiveTab;
    tabs[i].classList.toggle("active", on);
    tabs[i].setAttribute("aria-selected", on ? "true" : "false");
  }
  if(rrdActiveTab === "comments") loadRrdComments();
  else renderRrdPerm();
}
/* 工具栏入口：再次点击当前 tab 则收起；否则展开并切到该 tab */
function openRrdSide(tab){
  if(rrdCommentsOpen && rrdActiveTab === tab){ toggleRrdComments(false); return; }
  toggleRrdComments(true, tab);
}
/* 权限说明（只读）：把后端派生权限口径讲清楚，不做任何授权操作。
   改删 = 负责人本人 / 空间主·管理员 / 无负责人回退项目可写；排序·建子文档 = 项目可写；分享 = 项目可写。 */
function renderRrdPerm(){
  var pane = $("rrdPanePerm");
  if(!pane) return;
  var doc = reqDocById(rrdCommentsDocId);
  if(!doc){ pane.innerHTML = '<div class="perm-empty">文档尚未加载</div>'; return; }
  var role = currentRole();
  var privileged = role === "owner" || role === "admin";
  var me = rt.currentUser && rt.currentUser.id;
  var myName = (rt.currentUser && (rt.currentUser.displayName || rt.currentUser.username)) || "我";
  var owner = doc.ownerUserId;
  var ownerName = doc.owner || "—";
  var isOwner = !!(owner && me && String(owner) === String(me));
  var projWrite = canEditReq(doc.reqId);
  var canMut = canEditDoc(doc);
  var published = doc.publishedAt != null;
  var mineKind = canMut ? "edit" : "read";
  var mineText = canMut
    ? (privileged ? "你可编辑 / 删除（你是空间管理员）"
      : isOwner ? "你可编辑 / 删除（你是负责人）"
      : "你可编辑 / 删除（文档无负责人，按项目可写）")
    : (projWrite ? "你只读：仅负责人 " + ownerName + " 或空间管理员可编辑 / 删除"
      : "你只读：你对该项目只有查看权限");
  var mineIcon = canMut ? icon("check", 14) : icon("lock", 14);
  var belong = doc.reqId ? "项目 · <b>" + esc(reqDocProjectName(doc.reqId)) + "</b>" : "空间级文档（不挂项目）";
  var visDoc = rrdDocDetail && rrdDocDetail.id === doc.id ? rrdDocDetail : doc;
  var vis = docVisOf(visDoc);
  var visCount = visDoc.memberCount || (visDoc.memberIds || []).length || 0;
  var visNames = (visDoc.memberIds || []).map(docVisMemberName).filter(Boolean);
  var visible = !published
    ? "草稿 → 仅 <b>负责人 + 管理员</b> 可见（发布后按可见范围生效）"
    : vis === "members"
      ? "已发布 · <b>指定成员（" + visCount + " 人）</b>" + (visNames.length ? "：" + esc(visNames.join("、")) : "")
      : vis === "personal"
        ? "已发布 · <b>仅自己</b>（仅负责人可见）"
        : "已发布 · <b>团队共享</b> → 能看到本项目的成员" + (visCount ? "（" + visCount + " 人）" : "");
  var visEdit = published && canMut
    ? ' <button class="btn sm ghost" type="button" data-doc-vis-edit="' + esc(doc.id) + '">调整</button>'
    : "";
  var editors = owner
    ? '<span class="perm-people"><span class="pers">' + icon("user", 12) + esc(ownerName) + '（负责人）</span><span class="pers">' + icon("shield", 12) + (vis === "team" ? '空间管理员' : '名单内管理员') + '</span></span>'
    : "项目 / 空间可写者（文档无负责人）";
  var reorder = "项目 / 空间内<b>非只读成员</b>（组织 / 新增，不改本文）";
  var shareNote = !projWrite
    ? "对外分享：已发布文档可由项目 / 空间可写者生成限时公开只读链接；你当前只读，不能管理链接。"
    : !published
      ? "对外分享：发布后才能生成限时公开只读链接。"
      : vis !== "team"
        ? "对外分享：不可用（仅团队共享档可生成公开链接）；改回团队共享后恢复。"
        : "对外分享：已发布文档可生成限时公开只读链接；你具备写权限，可在编辑页「分享」管理。";
  var note = privileged ? "空间管理员豁免创建人保护：可编辑 / 删除任何文档，并维护空间级分类。"
    : isOwner ? "你是本文负责人：可编辑、删除、重命名、撤回发布，也可改派负责人。"
    : (!owner && canMut) ? "文档未设负责人：按项目 / 空间写权限放行，具备写权限者可编辑 / 删除。"
    : projWrite ? "创建人保护：非负责人不可改删他人文档；你仍可阅读、排序、新建子文档、评论。"
    : "你对该项目只读：仅可查看与阅读。";
  if(published && vis !== "team"){
    note += " 可见范围文档对空间管理员同样生效：不在名单内即看不到本文，也不能编辑 / 删除。";
  }
  var catHtml = "";
  var cat = docCatById(doc.categoryId);
  if(cat){
    var catScope = cat.reqId || "";
    var catSpace = !catScope;
    var catManage = reqDocCatManageable(catScope);
    catHtml =
      '<div class="perm-sec" data-sec="cat">' +
        '<button class="perm-sec-head" type="button"><span class="caret">' + icon("down", 12) + '</span>所属分类 · ' + esc(cat.name) + '</button>' +
        '<div class="perm-sec-body"><div class="perm-cat">' +
          '<div class="cr">归属：<b>' + (catSpace ? "空间级分类" : "项目分类 · " + esc(reqDocProjectName(catScope))) + '</b></div>' +
          '<div class="cr">可维护：<b>' + (catSpace ? "仅空间主 / 管理员" : "项目可写者") + '</b>（新建子分类 / 重命名 / 删除）</div>' +
          '<div class="cr">我的权限：<b>' + (catManage ? "可维护" : "只读") + '</b></div>' +
        '</div></div>' +
      '</div>';
  }
  pane.innerHTML =
    '<div class="perm-sec" data-sec="doc">' +
      '<button class="perm-sec-head" type="button"><span class="caret">' + icon("down", 12) + '</span>当前文档 · ' + esc(doc.title) + '</button>' +
      '<div class="perm-sec-body">' +
        '<div class="perm-mine ' + mineKind + '">' + mineIcon + '<span><b>' + esc(myName) + '</b> · ' + esc(mineText) + '</span></div>' +
        '<div class="perm-row"><span class="k">归属</span><span class="v">' + belong + '</span></div>' +
        '<div class="perm-row"><span class="k">可见范围</span><span class="v">' + visible + visEdit + '</span></div>' +
        '<div class="perm-row"><span class="k">可编辑 / 删除</span><span class="v">' + editors + '</span></div>' +
        '<div class="perm-row"><span class="k">可排序 / 建子文档</span><span class="v">' + reorder + '</span></div>' +
        '<div class="perm-share"><div class="perm-note">' + shareNote + '</div></div>' +
        '<div class="perm-note">' + esc(note) + '</div>' +
      '</div>' +
    '</div>' + catHtml;
}
/* ---------- 文档可见范围：三档单选 + 成员名单（照用例分组口径，仅约束已发布） ---------- */

function ensureDocVisStyles(){
  if(document.getElementById("docVisStyles")) return;
  var st = document.createElement("style");
  st.id = "docVisStyles";
  st.textContent =
    ".doc-vis-chip{display:inline-block;margin-left:6px;padding:0 5px;border:1px solid var(--border);border-radius:4px;"
    + "background:var(--surface-sunken);font-size:10px;line-height:15px;font-weight:650;color:var(--text-3);vertical-align:1px;white-space:nowrap;}"
    + ".doc-vis-chip.members{background:var(--primary-soft);border-color:var(--primary-border);color:var(--primary-fg);}"
    + ".doc-vis-chip.personal{background:var(--warning-soft);border-color:var(--warning-border);color:var(--warning-fg);}"
    + ".doc-vis-picker{margin-top:10px;}"
    + ".doc-vis-who{max-height:210px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:6px 8px;"
    + "border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-sunken);}"
    + ".doc-vis-note{margin-top:6px;font-size:11.5px;line-height:1.55;color:var(--text-3);}"
    + ".doc-vis-locked{margin-top:8px;padding:8px 10px;border:1px dashed var(--border-strong);border-radius:var(--r-sm);"
    + "font-size:11.5px;line-height:1.55;color:var(--text-3);}"
    + ".cs-vis-item.locked{opacity:.6;cursor:not-allowed;}"
    /* 新建弹窗的 .reqdoc-dlg-field 会把所有 input 套成文本框样式，这里把单选/复选/搜索框还原 */
    + ".reqdoc-dlg-field .cs-vis-item input:not([type=file])"
    + "{width:auto;height:auto;padding:0;border:0;border-radius:0;background:none;accent-color:var(--primary);flex:0 0 auto;margin-top:2px;}"
    /* Chromium 的复选框用 border/background 画框，不能清零，只缩到原生尺寸 */
    + ".reqdoc-dlg-field .cs-who-row input[type=checkbox]"
    + "{width:16px;height:16px;padding:0;margin:0;flex:0 0 auto;border-color:var(--border-strong);cursor:pointer;}"
    /* 弹窗里 input 的 background-color 会覆盖设计系统的 :checked 填充，这里显式补回 */
    + ".reqdoc-dlg-field .cs-who-row input[type=checkbox]:checked{background-color:var(--primary);border-color:var(--primary);"
    + "background-repeat:no-repeat;background-position:center;"
    + "background-image:url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 20 20' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4.6 10.6l3.6 3.6 7.2-8'/%3E%3C/svg%3E\");}"
    + ".reqdoc-dlg-field .cs-who-search input:not([type=file]){width:auto;height:auto;padding:0;border:0;border-radius:0;background:none;accent-color:var(--primary);}";
  document.head.appendChild(st);
}
function docVisOf(o){
  var v = o && o.visibility;
  return v === "members" || v === "personal" ? v : "team";
}
function docVisName(v){ return DOC_VIS_META[docVisOf({ visibility: v })].name; }
function docVisChip(d){
  if(!d || d.publishedAt == null) return "";
  var v = docVisOf(d);
  if(v === "team") return "";
  var n = d.memberCount || (d.memberIds || []).length || 0;
  return '<span class="doc-vis-chip ' + v + '" title="'
    + (v === "personal" ? "仅负责人可见" : "指定 " + n + " 人可见") + '">'
    + (v === "personal" ? "仅自己" : "指定 " + n + " 人") + '</span>';
}
/* 分类默认可见范围：只是新建文档时的默认值，不参与可见判定，也不改已有文档 */
function docCatDefaultChip(c){
  var v = docVisOf(c);
  if(v === "team") return "";
  var n = (c && (c.memberCount || (c.memberIds || []).length)) || 0;
  return '<span class="doc-vis-chip ' + v + '" title="分类默认：'
    + (v === "personal" ? "仅负责人可见" : "指定 " + n + " 人可见") + '；只影响之后新建的文档">'
    + (v === "personal" ? "默认仅自己" : "默认 " + n + " 人") + '</span>';
}
function docVisOptionsHTML(cur, lockedNarrow, name){
  cur = docVisOf({ visibility: cur });
  return '<div class="cs-vis" role="radiogroup" aria-label="可见范围">' + ["team", "members", "personal"].map(function(v){
    var meta = DOC_VIS_META[v];
    var locked = !!lockedNarrow && v !== "team";
    return '<label class="cs-vis-item' + (locked ? " locked" : "") + '"'
      + (locked ? ' title="仅文档负责人可将团队共享收窄"' : "") + '>'
      + '<input type="radio" name="' + name + '" value="' + v + '"'
      + (v === cur ? " checked" : "") + (locked ? " disabled" : "") + ' />'
      + '<span><b>' + meta.name + (v === "team" ? "（默认）" : locked ? "（仅负责人）" : "") + '</b>'
      + '<small>' + meta.desc + '</small></span></label>';
  }).join("") + '</div>';
}
function docVisPickerState(key){
  if(!docVisPickers[key]){
    docVisPickers[key] = { sel:{}, query:"", options:[], loading:false, error:"", reqId:null, seq:0 };
  }
  return docVisPickers[key];
}
function docVisPickerHTML(){
  return '<label class="cs-who-search">' + icon("search", 13)
    + '<input type="search" data-vis-q placeholder="搜索成员姓名 / 公司 / 岗位" aria-label="搜索可见成员" autocomplete="off" /></label>'
    + '<div class="doc-vis-who" data-vis-list role="group" aria-label="可见成员名单"></div>'
    + '<p class="doc-vis-note" data-vis-count></p>';
}
function docVisLoad(key, reqId, root){
  var s = docVisPickerState(key);
  if(s.reqId === reqId && (s.loading || s.options.length || s.error)){
    docVisPaint(key, root);
    return Promise.resolve(s.options);
  }
  s.reqId = reqId;
  s.loading = true;
  s.error = "";
  s.options = [];
  var seq = ++s.seq;
  docVisPaint(key, root);
  var wsId = rt.currentWs && rt.currentWs.id;
  var promise = !wsId ? Promise.resolve([])
    : !reqId ? Promise.resolve((rt.wsMembersCache || []).map(memberToOption))
    : loadProjectMembers(wsId, reqId).then(function(data){
      return ((data && data.members) || []).map(memberToOption);
    });
  return promise.then(function(opts){
    if(seq !== s.seq) return s.options;
    s.loading = false;
    s.options = (opts || []).filter(function(o){ return o.id; });
    docVisPaint(key, root);
    return s.options;
  }).catch(function(ex){
    if(seq !== s.seq) return s.options;
    s.loading = false;
    s.error = ex.message || "成员候选加载失败";
    docVisPaint(key, root);
    return s.options;
  });
}
function docVisCountText(key){
  return "已选 " + Object.keys(docVisPickerState(key).sel).length + " / " + DOC_VIS_MAX
    + " 人；至少选 1 人，负责人始终可见。";
}
function docVisPaint(key, root){
  if(!root) return;
  var s = docVisPickerState(key);
  var count = root.querySelector("[data-vis-count]");
  if(count) count.textContent = docVisCountText(key);
  var list = root.querySelector("[data-vis-list]");
  if(!list) return;
  if(s.loading){ list.innerHTML = '<div class="tl-empty">加载中…</div>'; return; }
  if(s.error){
    list.innerHTML = '<div class="tl-empty">' + esc(s.error)
      + ' <button class="btn sm ghost" type="button" data-vis-retry>重试</button></div>';
    return;
  }
  var opts = s.options.slice();
  var known = Object.create(null);
  opts.forEach(function(o){ known[o.id] = true; });
  Object.keys(s.sel).forEach(function(uid){
    if(!known[uid]) opts.push({ id: uid, name: "已不在本项目", company: "", role: "", missing: true });
  });
  var q = s.query.trim().toLowerCase();
  var rows = opts.filter(function(o){
    if(!q) return true;
    return (o.name + " " + (o.company || "") + " " + (o.role || "")).toLowerCase().indexOf(q) >= 0;
  });
  if(!rows.length){
    list.innerHTML = '<div class="tl-empty">' + (q
      ? "没有匹配的成员" : "没有可选的成员；请先在成员管理里邀请并授权") + '</div>';
    return;
  }
  list.innerHTML = rows.map(function(o){
    var on = !!s.sel[o.id];
    var sub = o.missing ? "已不在本项目，请移除" : optionSubText(o);
    return '<label class="cs-who-row' + (on ? " on" : "") + '" data-sub="' + esc(sub) + '" title="' + esc(sub) + '">'
      + '<input type="checkbox" data-vis-uid="' + esc(o.id) + '"' + (on ? " checked" : "") + ' />'
      + avatarHTML(o.name)
      + '<span class="cs-who-name">' + esc(o.name) + '</span>'
      + '<span class="cs-who-role">' + esc(sub) + '</span></label>';
  }).join("");
}
function bindDocVisPicker(root, key){
  if(!root || root.dataset.visBound) return;
  root.dataset.visBound = "1";
  root.addEventListener("input", function(e){
    if(!e.target.closest("[data-vis-q]")) return;
    docVisPickerState(key).query = e.target.value || "";
    docVisPaint(key, root);
  });
  root.addEventListener("change", function(e){
    var box = e.target.closest("[data-vis-uid]");
    if(!box) return;
    var s = docVisPickerState(key), uid = box.dataset.visUid;
    if(box.checked){
      if(Object.keys(s.sel).length >= DOC_VIS_MAX){
        box.checked = false;
        toast("指定成员最多 " + DOC_VIS_MAX + " 位，请改用团队共享", "warn");
        return;
      }
      s.sel[uid] = true;
    }else{
      delete s.sel[uid];
    }
    var row = box.closest(".cs-who-row");
    if(row) row.classList.toggle("on", box.checked);
    var count = root.querySelector("[data-vis-count]");
    if(count) count.textContent = docVisCountText(key);
  });
  root.addEventListener("click", function(e){
    if(!e.target.closest("[data-vis-retry]")) return;
    var s = docVisPickerState(key);
    var reqId = s.reqId || "";
    s.reqId = null;
    docVisLoad(key, reqId, root);
  });
}
function newReqDocVisValue(){
  var el = document.querySelector('#newReqDocVis input[name="newDocVis"]:checked');
  return el ? el.value : "team";
}
function resetNewReqDocVis(){
  if(!$("newReqDocVis")) return;
  var s = docVisPickerState("newDoc");
  s.sel = {};
  s.query = "";
  s.options = [];
  s.error = "";
  s.loading = false;
  s.reqId = null;
  s.seq++;
  newDocVisSeed = null;
  var q = $("newReqDocWho") && $("newReqDocWho").querySelector("[data-vis-q]");
  if(q) q.value = "";
  $("newReqDocVis").innerHTML = docVisOptionsHTML("team", false, "newDocVis");
  showEl($("newReqDocWhoField"), false);
  docVisPaint("newDoc", $("newReqDocWho"));
  renderNewDocVisHint();
  syncNewReqDocMoreSum();
}
function syncNewReqDocVis(){
  var vis = newReqDocVisValue();
  showEl($("newReqDocWhoField"), vis === "members");
  syncNewReqDocMoreSum();
  if(vis !== "members") return;
  var reqId = $("newReqDocProject") ? ($("newReqDocProject").value || "") : "";
  docVisLoad("newDoc", reqId, $("newReqDocWho"));
}
/* 选中分类后按分类默认预选档位与名单；用户仍可在弹窗里改，只影响这一篇 */
var newDocVisSeed = null;
function applyDocCatDefaultToNewDoc(){
  var cid = $("newReqDocCategory") ? $("newReqDocCategory").value : "";
  var c = cid ? docCatById(cid) : null;
  var vis = c ? docVisOf(c) : "team";
  var s = docVisPickerState("newDoc");
  s.sel = {};
  s.error = "";
  s.reqId = null;
  s.seq++;
  ((c && c.memberIds) || []).forEach(function(uid){ s.sel[uid] = true; });
  newDocVisSeed = (c && vis !== "team")
    ? { name: c.name, vis: vis, dropped: 0 }
    : null;
  if($("newReqDocVis")) $("newReqDocVis").innerHTML = docVisOptionsHTML(vis, false, "newDocVis");
  showEl($("newReqDocWhoField"), vis === "members");
  renderNewDocVisHint();
  syncNewReqDocMoreSum();
  if(vis !== "members") return;
  var reqId = $("newReqDocProject") ? ($("newReqDocProject").value || "") : "";
  docVisLoad("newDoc", reqId, $("newReqDocWho")).then(pruneNewDocSeed);
}
/* 默认名单里已看不到该项目的人不带入（后端也会兜底过滤），避免一进弹窗就报错 */
function pruneNewDocSeed(){
  if(!newDocVisSeed) return;
  var s = docVisPickerState("newDoc");
  var known = Object.create(null);
  (s.options || []).forEach(function(o){ known[o.id] = true; });
  var dropped = 0;
  Object.keys(s.sel).forEach(function(uid){
    if(!known[uid]){ delete s.sel[uid]; dropped++; }
  });
  newDocVisSeed.dropped = dropped;
  docVisPaint("newDoc", $("newReqDocWho"));
  renderNewDocVisHint();
  syncNewReqDocMoreSum();
}
function renderNewDocVisHint(){
  var el = $("newDocVisHint");
  if(!el) return;
  if(!newDocVisSeed){ el.hidden = true; el.textContent = ""; return; }
  var vis = newReqDocVisValue();
  var want = newDocVisSeed.vis === "personal" ? "仅自己"
    : "指定成员 " + Object.keys(docVisPickerState("newDoc").sel).length + " 人";
  el.hidden = false;
  el.textContent = "按分类「" + newDocVisSeed.name + "」默认：" + want
    + (vis === newDocVisSeed.vis ? "" : "；本文档将按你选的「" + docVisName(vis) + "」保存")
    + (newDocVisSeed.dropped ? "（" + newDocVisSeed.dropped + " 人已不在项目，未带入）" : "");
}
/* 新建弹窗：可见范围与成员名单注入「更多设置」挂载点，主流程只留名称/位置/起点 */
function ensureNewReqDocVisUI(){
  var form = document.querySelector("#dlgNewReqDoc .reqdoc-dlg-form");
  if(!form || $("newReqDocVisField")) return;
  ensureDocVisStyles();
  var mount = $("newReqDocVisMount") || form;
  var html = '<div class="reqdoc-dlg-field" id="newReqDocVisField">'
      + '<span>可见范围</span>'
      + '<div id="newReqDocVis"></div>'
      + '<small id="newDocVisHint" hidden style="color:var(--text-3);display:block;margin-top:4px;line-height:1.5;"></small>'
    + '</div>'
    + '<div class="reqdoc-dlg-field" id="newReqDocWhoField" hidden>'
      + '<span>可见成员</span>'
      + '<div class="cs-who" id="newReqDocWho">' + docVisPickerHTML() + '</div>'
      + '<small style="color:var(--text-3);display:block;margin-top:4px;">草稿始终仅负责人与空间管理员可见；发布后才按可见范围生效。</small>'
    + '</div>';
  mount.insertAdjacentHTML("beforeend", html);
  $("newReqDocVis").innerHTML = docVisOptionsHTML("team", false, "newDocVis");
  $("newReqDocVis").addEventListener("change", function(){
    syncNewReqDocVis();
    renderNewDocVisHint();
  });
  bindDocVisPicker($("newReqDocWho"), "newDoc");
  $("newReqDocWho").addEventListener("change", syncNewReqDocMoreSum);
}
function docVisMemberName(uid){
  if(!uid) return "";
  var list = rt.wsMembersCache || [];
  for(var i = 0; i < list.length; i++){
    if(list[i].userId === uid) return list[i].displayName || list[i].username || uid;
  }
  return uid;
}
function refreshReqDocShareBtn(){
  var b = $("reqDocShare");
  if(!b) return;
  /* 与后端 createShare 同口径：仅团队共享档可生成公开链接 */
  var restricted = !!editingMeta.publishedAt && docVisOf(editingMeta) !== "team";
  b.disabled = restricted;
  b.title = restricted
    ? "指定成员 / 仅自己可见的文档不生成公开链接；如需分享请改回团队共享"
    : "生成只读分享链接（需先发布）";
}
function applyDocVisResult(docId, updated){
  var v = docVisOf(updated);
  var n = (updated && updated.memberIds || []).length;
  [reqDocList, reqDocSearchList].forEach(function(list){
    if(!list) return;
    for(var i = 0; i < list.length; i++){
      if(list[i].id === docId){
        list[i].visibility = v;
        list[i].memberCount = n;
        if(updated.publishedAt) list[i].publishedAt = updated.publishedAt;
      }
    }
  });
  if(editingDocId === docId){
    editingMeta.visibility = v;
    refreshReqDocShareBtn();
  }
  if(rrdDocDetail && rrdDocDetail.id === docId) rrdDocDetail = updated;
  if(splitDocId === docId && $("reqDocReader")) renderReqDocReader(updated);
  renderReqDocMode();
}
function openDocVisDialog(docId){
  var doc = reqDocById(docId);
  if(!doc) return;
  if(!canEditDoc(doc)){ toast("仅文档负责人或空间管理员可调整可见范围", "warn"); return; }
  if(doc.publishedAt == null){ toast("草稿不按可见范围控制；发布后再调整", "warn"); return; }
  var detail = rrdDocDetail && rrdDocDetail.id === docId ? rrdDocDetail : null;
  var cur = docVisOf(detail || doc);
  var me = rt.currentUser && rt.currentUser.id;
  var ownerId = (detail && detail.ownerUserId) || doc.ownerUserId || "";
  /* 与后端同口径：团队共享收窄只允许文档负责人（负责人为空时回退项目可写） */
  var lockedNarrow = cur === "team" && !!ownerId && String(ownerId) !== String(me || "");
  ensureDocVisStyles();
  var s = docVisPickerState("adjust");
  s.sel = {};
  ((detail && detail.memberIds) || doc.memberIds || []).forEach(function(uid){ s.sel[uid] = true; });
  s.query = "";
  s.options = [];
  s.error = "";
  s.loading = false;
  s.reqId = null;
  s.seq++;
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet sm">'
    + '<div class="sheet-head"><div><h2>调整可见范围</h2>'
      + '<div class="desc">' + esc(doc.title) + ' · 仅对已发布文档生效</div></div>'
      + '<button class="icon-btn sm" type="button" data-vis-x aria-label="关闭">' + icon("close", 14) + '</button></div>'
    + '<div class="sheet-body" style="padding:16px 20px">'
      + '<div id="docVisDlgOpts">' + docVisOptionsHTML(cur, lockedNarrow, "docVisDlg") + '</div>'
      + (lockedNarrow ? '<div class="doc-vis-locked">团队共享文档收窄到「指定成员 / 仅自己」需由文档负责人操作，避免其他成员突然看不到。</div>' : '')
      + '<div class="doc-vis-picker" id="docVisDlgWho" hidden><div class="cs-who">' + docVisPickerHTML() + '</div></div>'
      + '<p class="doc-vis-note">草稿始终仅负责人与空间管理员可见；公开分享链接仅团队共享档可用，收窄后已有链接自动撤销。</p>'
    + '</div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-vis-x>取消</button>'
      + '<button class="btn primary" type="button" data-vis-ok>保存</button></div>'
  + '</div>';
  document.body.appendChild(layer);
  var who = $("docVisDlgWho");
  bindDocVisPicker(who, "adjust");
  function syncWho(){
    var el = document.querySelector('#docVisDlgOpts input[name="docVisDlg"]:checked');
    var vis = el ? el.value : cur;
    showEl(who, vis === "members");
    if(vis === "members") docVisLoad("adjust", doc.reqId || "", who);
  }
  /* 遮罩点击 / Esc 也走同一收口：closeModal 的关闭钩子负责把动态节点移出 DOM */
  layer.__uiOnClose = function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); };
  function close(){ UI.closeModal(layer); }
  function send(btn, vis, members){
    btn.disabled = true;
    btn.textContent = "保存中…";
    API.put("/api/req-docs/" + encodeURIComponent(docId) + "/visibility",
      { visibility: vis, memberIds: members }).then(function(updated){
      close();
      applyDocVisResult(docId, updated);
      toast("可见范围已更新为「" + docVisName(vis) + "」", "fs");
    }).catch(function(ex){
      btn.disabled = false;
      btn.textContent = "保存";
      toast(ex.message || "调整失败", "bad");
    });
  }
  $("docVisDlgOpts").addEventListener("change", syncWho);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-vis-x]")){ close(); return; }
    var ok = e.target.closest("[data-vis-ok]");
    if(!ok || ok.disabled) return;
    var el = document.querySelector('#docVisDlgOpts input[name="docVisDlg"]:checked');
    var vis = el ? el.value : cur;
    var members = vis === "members" ? Object.keys(docVisPickerState("adjust").sel) : [];
    if(vis === "members" && !members.length){ toast("「指定成员」至少要选一位成员", "warn"); return; }
    if(cur === "team" && vis !== "team"){
      UI.showConfirm({
        title: "确认收窄可见范围", okText: "仍要收窄",
        msg: "收窄后，不在名单里的成员（含未列入名单的空间管理员）将立刻无法在列表、搜索和直链中访问本文；已有公开分享链接会同步撤销。"
      }).then(function(go){ if(go) send(ok, vis, members); });
      return;
    }
    send(ok, vis, members);
  });
  syncWho();
  UI.openModal(layer);
}
/* 分类默认可见范围：只影响之后在该分类新建的文档，不动已有文档，因此不需要收窄确认 */
function openDocCatVisDialog(catId){
  var c = docCatById(catId);
  if(!c) return;
  var scope = c.reqId || "";
  if(!reqDocCatManageable(scope)){
    toast(scope ? "你对该项目只有查看权限" : "空间级分类仅空间主或管理员可维护", "warn");
    return;
  }
  ensureDocVisStyles();
  var cur = docVisOf(c);
  var s = docVisPickerState("cat");
  s.sel = {};
  (c.memberIds || []).forEach(function(uid){ s.sel[uid] = true; });
  s.query = "";
  s.options = [];
  s.error = "";
  s.loading = false;
  s.reqId = null;
  s.seq++;
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet sm">'
    + '<div class="sheet-head"><div><h2>分类默认可见范围</h2>'
      + '<div class="desc">' + esc(c.name) + ' · 之后在该分类新建的文档按此预填，已有文档不变</div></div>'
      + '<button class="icon-btn sm" type="button" data-catvis-x aria-label="关闭">' + icon("close", 14) + '</button></div>'
    + '<div class="sheet-body" style="padding:16px 20px">'
      + '<div id="docCatVisOpts">' + docVisOptionsHTML(cur, false, "docCatVis") + '</div>'
      + '<div class="doc-vis-picker" id="docCatVisWho" hidden><div class="cs-who">' + docVisPickerHTML() + '</div></div>'
      + '<p class="doc-vis-note">只是新建时的默认值：改档位或名单都不会改变已有文档；每篇文档仍可在阅读页单独调整。</p>'
    + '</div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-catvis-x>取消</button>'
      + '<button class="btn primary" type="button" data-catvis-ok>保存</button></div>'
  + '</div>';
  document.body.appendChild(layer);
  var who = $("docCatVisWho");
  bindDocVisPicker(who, "cat");
  var okBtn = layer.querySelector("[data-catvis-ok]");
  function syncWho(){
    var el = layer.querySelector('#docCatVisOpts input[name="docCatVis"]:checked');
    var vis = el ? el.value : cur;
    showEl(who, vis === "members");
    if(vis === "members") docVisLoad("cat", scope, who);
  }
  layer.__uiOnClose = function(){ if(layer.parentNode) layer.parentNode.removeChild(layer); };
  function close(){ UI.closeModal(layer); }
  $("docCatVisOpts").addEventListener("change", syncWho);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-catvis-x]")){ close(); return; }
    if(!e.target.closest("[data-catvis-ok]") || okBtn.disabled) return;
    var el = layer.querySelector('#docCatVisOpts input[name="docCatVis"]:checked');
    var vis = el ? el.value : cur;
    var members = vis === "members" ? Object.keys(docVisPickerState("cat").sel) : [];
    if(vis === "members" && !members.length){ toast("「指定成员」至少要选一位成员", "warn"); return; }
    okBtn.disabled = true;
    okBtn.textContent = "保存中…";
    API.put("/api/doc-categories/" + encodeURIComponent(catId) + "/visibility",
      { visibility: vis, memberIds: members }).then(function(){
      close();
      loadDocCategories(true).then(function(){
        if(activeView === "requirements") renderReqDocMode();
      });
      toast("分类默认可见范围已更新", "fs");
    }).catch(function(ex){
      okBtn.disabled = false;
      okBtn.textContent = "保存";
      toast(ex.message || "保存失败", "bad");
    });
  });
  syncWho();
  UI.openModal(layer);
}
/* 评论条数角标：单独走 counts 接口，一次轻量请求，不拉评论正文 */
function loadRrdCommentCount(docId){
  if(!docId) return;
  API.get("/api/req-docs/" + encodeURIComponent(docId) + "/comments/counts").then(function(c){
    if(rrdCommentsDocId !== docId) return;
    var n = (c && c.total) || 0;
    var badge = $("rrdCommentsBadge");
    if(badge){
      badge.hidden = !n;
      badge.textContent = n ? (n > 99 ? "99+" : String(n)) : "";
    }
    var btn = $("rrdCommentsBtn");
    if(btn){
      var tip = n ? "评论（" + n + " 条）· 选中正文可划线" : "评论 · 选中正文可划线";
      btn.setAttribute("data-tip", tip);
      btn.setAttribute("aria-label", n ? "评论（" + n + " 条）" : "评论");
    }
  }).catch(function(){ /* 计数失败不打扰阅读 */ });
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
  var mentionIds = rrdMentionPicker ? rrdMentionPicker.idsInText(content) : [];
  if(mentionIds.length) body.mentionUserIds = mentionIds;
  API.post("/api/req-docs/" + encodeURIComponent(rrdCommentsDocId) + "/comments", body).then(function(){
    if(ta) ta.value = "";
    if(rrdMentionPicker){ rrdMentionPicker.close(); rrdMentionPicker.clearPicked(); }
    setRrdQuote(null);
    loadRrdComments();
    loadRrdCommentCount(rrdCommentsDocId);
  }).catch(function(ex){ toast(ex.message || "评论发表失败", "bad"); })
  .then(function(){ if(btn) btn.disabled = false; });
}
function deleteRrdComment(commentId){
  if(!rrdCommentsDocId || !commentId) return;
  UI.showConfirm({ title: "删除评论", msg: "确定删除这条评论？", okText: "删除评论", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(rrdCommentsDocId) + "/comments/" + encodeURIComponent(commentId)).then(function(){
      loadRrdComments();
      loadRrdCommentCount(rrdCommentsDocId);
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
/* 阅读侧栏评论框每次渲染都会重建，@ 候选按当前文档的可见成员拉取 */
function bindRrdMention(){
  if(rrdMentionPicker){ rrdMentionPicker.destroy(); rrdMentionPicker = null; }
  var ta = $("rrdCommentInput");
  if(!ta) return;
  rrdMentionPicker = createMentionPicker(ta, {
    canOpen: function(){ return rrdCanComment && !!rrdCommentsDocId; },
    excludeUserId: function(){ return rt.currentUser && rt.currentUser.id; },
    loadMembers: function(){
      var docId = rrdCommentsDocId;
      if(!docId) return Promise.reject(new Error("未打开文档"));
      return API.get("/api/req-docs/" + encodeURIComponent(docId) + "/mention-candidates");
    }
  });
}
function ensureRrdSelBubble(){  if(rrdSelBubble) return rrdSelBubble;
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
  var scope = reqId || "";
  return reqDocList.filter(function(d){
    return (d.reqId || "") === scope && d.id !== excludeId && !banned[d.id];
  }).sort(reqDocSort);
}
/* 上级文档下拉：按 parentId 还原父子关系，DFS 排序并逐层缩进，避免不同层级的同名文档分不清 */
function parentOptionsHTML(list, emptyLabel){
  var byId = {};
  list.forEach(function(d){ byId[d.id] = d; });
  var kids = {}, roots = [];
  list.forEach(function(d){
    var pid = d.parentId || "";
    if(pid && pid !== d.id && byId[pid]) (kids[pid] = kids[pid] || []).push(d);
    else roots.push(d);
  });
  var out = '<option value="">' + esc(emptyLabel) + '</option>';
  (function walk(nodes, depth){
    nodes.slice().sort(reqDocSort).forEach(function(d){
      out += '<option value="' + esc(d.id) + '">' + "　".repeat(Math.min(depth, 6)) + esc(d.title) + '</option>';
      walk(kids[d.id] || [], depth + 1);
    });
  })(roots, 0);
  return out;
}
/* 分类子树 id 集合（含自身）：新建文档选分类后，上级文档只列该分类子树内的文档 */
function reqDocCatSubtreeIds(cid){
  var out = {}; out[cid] = true;
  var cats = docCategories || [], changed = true;
  while(changed){
    changed = false;
    cats.forEach(function(c){ if(!out[c.id] && out[c.parentId || ""]){ out[c.id] = true; changed = true; } });
  }
  return out;
}
/* 分类下拉：只列当前归属范围内的目录（项目按写权限、空间级按非查看者），树形缩进 */
function fillNewReqDocCategories(selected){
  var sel = $("newReqDocCategory");
  if(!sel) return;
  var reqFilter = $("newReqDocProject") ? ($("newReqDocProject").value || "") : "";
  var cats = roleReadOnly() ? [] : (docCategories || []).filter(function(c){ return (c.reqId || "") === reqFilter; });
  var opts = '<option value="">无分类（不放进目录）</option>';
  var byId = {}; cats.forEach(function(c){ byId[c.id] = c; });
  var kids = {}; cats.forEach(function(c){ var pid = c.parentId || ""; if(pid && byId[pid]) (kids[pid] = kids[pid] || []).push(c); });
  var roots = cats.filter(function(c){ var pid = c.parentId || ""; return !pid || !byId[pid]; });
  (function walk(nodes, depth){
    nodes.slice().sort(docCatSort).forEach(function(c){
      opts += '<option value="' + esc(c.id) + '"' + (c.id === selected ? " selected" : "") + '>' + "　".repeat(Math.min(depth, 6) + 1) + esc(c.name) + '</option>';
      walk(kids[c.id] || [], depth + 1);
    });
  })(roots, 0);
  sel.innerHTML = opts;
  sel.value = selected || "";
  if(sel.value !== (selected || "")) sel.value = "";
  if($("newReqDocCatAdd")) $("newReqDocCatAdd").hidden = roleReadOnly();
}
/* 新建文档时就地建分类：选中分类则建为其子分类，否则建在当前归属的顶层；建好直接选中 */
function beginQuickCreateNewDocCat(){
  var sel = $("newReqDocCategory");
  var row = sel && sel.parentNode;
  if(!row || $("newReqDocCatName")) return;
  var parent = sel.value ? docCatById(sel.value) : null;
  var scope = parent ? (parent.reqId || "") : ($("newReqDocProject") ? ($("newReqDocProject").value || "") : "");
  if(!reqDocCatManageable(scope)){
    toast(scope ? "你对该项目只有查看权限，无法维护分类" : "空间级分类仅空间主或管理员可维护", "warn");
    return;
  }
  reqDocCatNameInput({
    anchorEl: row, value: "",
    placeholder: (parent ? "在「" + parent.name + "」下新建子分类" : "在「" + reqDocProjectName(scope) + "」顶层新建分类") + "，回车创建 / Esc 取消",
    inputClass: "nd-cat-input",
    onCommit: function(name){
      API.post("/api/doc-categories", { reqId: scope, name: name, parentId: parent ? parent.id : "" }).then(function(created){
        toast("已创建分类「" + name + "」", "fs");
        if(parent) delete reqDocCollapsedCats[parent.id];
        return loadDocCategories(true).then(function(){
          var id = created && created.id;
          if(!id){
            var hit = (docCategories || []).filter(function(c){
              return (c.reqId || "") === scope && (c.parentId || "") === (parent ? parent.id : "") && c.name === name;
            })[0];
            id = hit ? hit.id : "";
          }
          fillNewReqDocCategories(id);
          syncNewReqDocProjFromCat();
          fillNewReqDocParents("");
          applyDocCatDefaultToNewDoc();
          syncNewReqDocPath();
        });
      }).catch(function(ex){ toast(ex.message || "创建分类失败", "bad"); });
    }
  });
  var input = row.nextSibling;
  if(input && input.classList && input.classList.contains("nd-cat-input")){
    input.id = "newReqDocCatName";
    /* 抽屉内 Esc 只取消输入，不能冒泡到全局把整个新建抽屉关掉 */
    input.addEventListener("keydown", function(e){ if(e.key === "Escape") e.stopPropagation(); });
  }
}
/* 项目下拉：可写项目 + 空间级（关联可选）；查看者无可写范围 */
function fillNewReqDocProjectOptions(selected){
  var proj = $("newReqDocProject");
  if(!proj) return;
  var prev = proj.value;
  var writable = rt.reqList.filter(function(r){ return canEditReq(r.id); });
  var opts = "";
  if(!roleReadOnly()) opts += '<option value="">空间级（不挂项目）</option>';
  opts += writable.map(function(r){ return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join("");
  if(!opts) opts = '<option value="">（没有可写范围，无法新建文档）</option>';
  proj.innerHTML = opts;
  var cur = selected === undefined ? prev : selected;
  proj.value = cur || "";
  if(proj.value !== (cur || "")) proj.value = proj.options.length ? proj.options[0].value : "";
}
/* 选中分类后项目由分类带出并禁用；未选分类时项目可选（关联非必选） */
function syncNewReqDocProjFromCat(){
  var proj = $("newReqDocProject");
  if(!proj) return;
  var cid = $("newReqDocCategory") ? $("newReqDocCategory").value : "";
  var hint = $("newReqDocProjHint");
  if(cid){
    var c = docCatById(cid);
    var scope = c ? (c.reqId || "") : "";
    proj.innerHTML = scope
      ? '<option value="' + esc(scope) + '">' + esc(reqDocProjectName(scope)) + '</option>'
      : '<option value="">空间级（不挂项目）</option>';
    proj.value = scope;
    proj.disabled = true;
    if(hint) hint.textContent = "由分类带出：" + (scope ? reqDocProjectName(scope) : "空间级（不挂项目）");
  }else{
    proj.disabled = false;
    fillNewReqDocProjectOptions();
    if(hint) hint.textContent = "未选分类：可关联有权限的项目，或留空间级（关联可选）";
  }
  syncNewReqDocPath();
}
function fillNewReqDocParents(selected){
  var sel = $("newReqDocParent");
  if(!sel) return;
  var cid = $("newReqDocCategory") ? $("newReqDocCategory").value : "";
  var proj = $("newReqDocProject") ? $("newReqDocProject").value : "";
  var cur = selected === undefined ? sel.value : selected;
  var list;
  if(cid){
    var sub = reqDocCatSubtreeIds(cid);
    list = reqDocList.filter(function(d){ return d.categoryId && sub[d.categoryId]; }).sort(reqDocSort);
    sel.innerHTML = parentOptionsHTML(list, "无（分类根）");
  }else{
    list = reqDocParentCandidates(proj || null, null);
    sel.innerHTML = parentOptionsHTML(list, proj ? "无（作为顶层文档）" : "无（空间级顶层）");
  }
  sel.disabled = !list.length;
  sel.value = cur || "";
  if(sel.value !== (cur || "")) sel.value = "";
  syncNewReqDocPath();
}
/* 位置摘要：归属 › 分类 › 上级，一眼看清文档会落到哪一层 */
function syncNewReqDocPath(){
  var el = $("newReqDocPath");
  if(!el) return;
  var reqId = $("newReqDocProject") ? ($("newReqDocProject").value || "") : "";
  var catSel = $("newReqDocCategory");
  var catLabel = "无分类";
  if(catSel && catSel.value && catSel.selectedIndex >= 0) catLabel = catSel.options[catSel.selectedIndex].text.replace(/^[\s\u3000]+/, "");
  var pSel = $("newReqDocParent");
  var parentLabel = "顶层";
  if(pSel && pSel.value && pSel.selectedIndex >= 0) parentLabel = pSel.options[pSel.selectedIndex].text.replace(/^[\s\u3000]+/, "");
  el.innerHTML = "位置：<b>" + [reqDocProjectName(reqId), catLabel, parentLabel].map(esc).join("</b><i>›</i><b>") + "</b>";
  syncNewReqDocCtx();
}
/* 新建弹窗头部：先说明落点、保存后的去向与唯一必填项 */
function syncNewReqDocCtx(){
  var el = $("newReqDocCtx");
  if(!el) return;
  var reqId = $("newReqDocProject") ? ($("newReqDocProject").value || "") : "";
  el.innerHTML = esc(reqId ? reqDocProjectName(reqId) : "空间级") + " · 保存后进入编辑 · <span class=\"sub-only\">只有名称必填</span>";
}
/* 名称输入行：Enter 提示与字数，和新建工作项的标题行同一套表达 */
function syncNewReqDocTitleCount(){
  var input = $("newReqDocTitle"), out = $("newReqDocTitleCount");
  if(!input || !out) return;
  out.textContent = (input.value || "").length + "/" + (input.maxLength > 0 ? input.maxLength : "");
}
function showNewReqDocError(show){
  var box = $("newReqDocErr"), input = $("newReqDocTitle");
  if(box) box.hidden = !show;
  if(input) input.classList.toggle("invalid", !!show);
}
/* 更多设置收起时也要能看到当前值：类型 + 可见范围 */
function syncNewReqDocMoreSum(){
  var el = $("newReqDocMoreSum");
  if(!el) return;
  var type = docTypeName($("newReqDocType") ? $("newReqDocType").value : "requirement");
  var vis = newReqDocVisValue();
  var visLabel = vis === "members"
    ? "指定 " + Object.keys(docVisPickerState("newDoc").sel).length + " 人"
    : docVisName(vis);
  el.textContent = "类型：" + type + " · 可见范围：" + visLabel;
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
/* 编辑页分类下拉：仅列文档所在范围的分类（只读时禁用），可改归类或清空 */
function fillReqDocCategorySelect(doc){
  var sel = $("reqDocCategory");
  if(!sel) return;
  var scope = doc.reqId || "";
  var cats = (docCategories || []).filter(function(c){ return (c.reqId || "") === scope; });
  var byId = {}; cats.forEach(function(c){ byId[c.id] = c; });
  var kids = {}; cats.forEach(function(c){ var pid = c.parentId || ""; if(pid && byId[pid]) (kids[pid] = kids[pid] || []).push(c); });
  var roots = cats.filter(function(c){ var pid = c.parentId || ""; return !pid || !byId[pid]; });
  var opts = '<option value="">无分类</option>';
  (function walk(nodes, depth){
    nodes.slice().sort(docCatSort).forEach(function(c){
      opts += '<option value="' + esc(c.id) + '">' + "　".repeat(Math.min(depth, 6)) + esc(c.name) + '</option>';
      walk(kids[c.id] || [], depth + 1);
    });
  })(roots, 0);
  sel.innerHTML = opts;
  sel.value = doc.categoryId || "";
  if(sel.value !== (doc.categoryId || "")) sel.value = "";
  sel.disabled = reqDocReadOnly || !cats.length;
  ensureReqDocCatHint();
  syncReqDocCatDefaultHint();
}
/* 分类默认可见范围的只读提示：保存不会自动改本文档，避免误解为「换分类就改权限」 */
function ensureReqDocCatHint(){
  if($("reqDocCatDefaultHint")) return;
  var sel = $("reqDocCategory");
  var label = sel && sel.closest("label");
  if(!label) return;
  label.insertAdjacentHTML("afterend",
    '<div id="reqDocCatDefaultHint" hidden style="margin:-4px 0 8px;font-size:11.5px;line-height:1.5;color:var(--text-3);"></div>');
}
function syncReqDocCatDefaultHint(){
  var el = $("reqDocCatDefaultHint");
  if(!el) return;
  var cid = $("reqDocCategory") ? $("reqDocCategory").value : "";
  var c = cid ? docCatById(cid) : null;
  var v = c ? docVisOf(c) : "team";
  if(!c || v === "team"){ el.hidden = true; el.textContent = ""; return; }
  var n = c.memberCount || 0;
  el.hidden = false;
  el.textContent = "该分类默认" + (v === "personal" ? "「仅自己」" : "「指定 " + n + " 人」")
    + "；保存文档不会自动改变本文档当前的可见范围";
}
function openNewReqDocDialog(reqId, opts){
  var sel = $("newReqDocProject");
  if(!sel) return;
  opts = opts || {};
  var writable = rt.reqList.filter(function(r){ return canEditReq(r.id); });
  var defProj = (reqId && canEditReq(reqId)) ? reqId : (writable.length ? writable[0].id : "");
  var preCat = opts.categoryId || "";
  var preCatObj = preCat ? docCatById(preCat) : null;
  if(preCatObj) defProj = preCatObj.reqId || "";
  fillNewReqDocProjectOptions(defProj);
  showNewReqDocError(false);
  if($("newReqDocTitle")) $("newReqDocTitle").value = "";
  syncNewReqDocTitleCount();
  if($("newReqDocFormat")) $("newReqDocFormat").value = "markdown";
  resetNewReqDocPreview();
  setNewReqDocSource("blank");
  fillDocTypeSelect("newReqDocType", "requirement");
  fillDocTemplateSelect();
  /* 归属先定，分类只列该范围的目录；分类再带出上级文档候选 */
  fillNewReqDocCategories(preCat);
  syncNewReqDocProjFromCat();
  fillNewReqDocParents(opts.parentId || "");
  if(!docCategoriesLoaded){
    loadDocCategories().then(function(){
      var pc = preCat ? docCatById(preCat) : null;
      fillNewReqDocProjectOptions(pc ? (pc.reqId || "") : defProj);
      fillNewReqDocCategories(preCat);
      syncNewReqDocProjFromCat();
      fillNewReqDocParents(opts.parentId || "");
      applyDocCatDefaultToNewDoc();
    });
  }
  setNewReqDocBusy(null);
  ensureNewReqDocVisUI();
  resetNewReqDocVis();
  applyDocCatDefaultToNewDoc();
  if($("newReqDocMore")) $("newReqDocMore").open = true;
  UI.openModal($("dlgNewReqDoc"));
  setTimeout(function(){ if($("newReqDocTitle")) $("newReqDocTitle").focus(); }, 40);
}
function fillDocTemplateSelect(){
  var sel = $("newReqDocTemplate");
  if(!sel) return;
  sel.innerHTML = '<option value="">空白文档</option>';
  var fill = function(list){
    docTemplatesCache = list;
    sel.innerHTML = '<option value="">空白文档</option>' + list.map(function(t){
      return '<option value="' + esc(t.id) + '">' + esc(t.name) + (t.builtin ? '（内置）' : '') + '</option>';
    }).join("");
    /* 模板异步到货时若已在「使用模板」模式，补选第一套骨架 */
    var tplBtn = document.querySelector('#newReqDocSource [data-docsrc="template"][aria-pressed="true"]');
    if(tplBtn && !sel.value && sel.options.length > 1){
      sel.value = sel.options[1].value;
      applyDocTemplateToNewDoc();
    }
  };
  if(docTemplatesCache){ fill(docTemplatesCache); return; }
  API.get("/api/doc-templates").then(function(list){ fill(list || []); }).catch(function(){ /* 模板加载失败不阻塞新建 */ });
}
/* ---------- 文档模板管理：内置模板只读，自定义模板仅空间主 / 管理员可增删 ---------- */
function canManageDocTpl(){
  var role = currentRole();
  return role === "owner" || role === "admin";
}
function openDocTplDialog(){
  fillDocTypeSelect("docTplNewType", "requirement");
  if($("docTplNewName")) $("docTplNewName").value = "";
  if($("docTplNewFormat")) $("docTplNewFormat").value = "markdown";
  if($("docTplNewContent")) $("docTplNewContent").value = "";
  if($("docTplAddBox")) $("docTplAddBox").hidden = !canManageDocTpl();
  UI.openModal($("dlgDocTpl"));
  loadDocTplManage();
}
function loadDocTplManage(){
  var list = $("docTplList");
  if(!list) return;
  list.innerHTML = UI.skeletonRows(3);
  API.get("/api/doc-templates").then(function(rows){
    /* 与新建文档下拉共用同一份缓存：增删后下拉立即同步 */
    docTemplatesCache = rows || [];
    renderDocTplManage();
  }).catch(function(ex){
    list.innerHTML = UI.errorState(ex.message || "模板加载失败");
  });
}
function renderDocTplManage(){
  var list = $("docTplList");
  if(!list) return;
  var rows = docTemplatesCache || [];
  if(!rows.length){ list.innerHTML = UI.colEmpty("暂无模板"); return; }
  list.innerHTML = rows.map(function(t){
    return '<div class="cfg-row doc-tpl-row" data-doc-tpl="' + esc(t.id) + '">' +
      '<span class="doc-tpl-name">' + esc(t.name) + (t.builtin ? '<span class="tag">内置</span>' : '') + '</span>' +
      '<span class="doc-tpl-meta">' + esc(docTypeName(t.docType)) + ' · ' + (t.format === "html" ? "富文本" : "Markdown") + '</span>' +
      '<button class="btn sm ghost" type="button" data-doc-tpl-prev aria-expanded="false">预览</button>' +
      (t.deletable ? '<button class="btn sm danger" type="button" data-doc-tpl-del>删除</button>' : '') +
      '</div>' +
      '<pre class="doc-tpl-skel" hidden>' + esc(t.content || "（空模板）") + '</pre>';
  }).join("");
}
function toggleDocTplSkel(btn){
  var row = btn.closest("[data-doc-tpl]");
  var pre = row && row.nextElementSibling;
  if(!pre || !pre.classList.contains("doc-tpl-skel")) return;
  var on = pre.hidden;
  pre.hidden = !on;
  btn.setAttribute("aria-expanded", on ? "true" : "false");
  btn.textContent = on ? "收起" : "预览";
}
function resetDocTplAddBtn(){
  var btn = $("docTplAddBtn");
  if(btn){ btn.disabled = false; btn.textContent = "新建模板"; }
}
function createDocTpl(){
  if(!canManageDocTpl()){ toast("只有空间主 / 管理员可以新建模板", "warn"); return; }
  var name = ($("docTplNewName").value || "").trim();
  if(!name){ toast("请填写模板名称", "warn"); $("docTplNewName").focus(); return; }
  var content = $("docTplNewContent").value || "";
  if(!content.trim()){ toast("请填写正文骨架", "warn"); $("docTplNewContent").focus(); return; }
  var btn = $("docTplAddBtn");
  if(btn){ btn.disabled = true; btn.textContent = "新建中…"; }
  API.post("/api/doc-templates", {
    name: name,
    docType: $("docTplNewType").value || "other",
    format: $("docTplNewFormat").value || "markdown",
    content: content
  }).then(function(){
    toast("已新建模板「" + name + "」", "fs");
    $("docTplNewName").value = "";
    $("docTplNewContent").value = "";
    resetDocTplAddBtn();
    loadDocTplManage();
  }).catch(function(ex){
    toast(ex.message || "新建模板失败", "bad");
    resetDocTplAddBtn();
  });
}
function deleteDocTpl(id){
  if(!canManageDocTpl()){ toast("只有空间主 / 管理员可以删除模板", "warn"); return; }
  var t = (docTemplatesCache || []).filter(function(x){ return x.id === id; })[0];
  if(!t || t.builtin) return;
  UI.showConfirm({
    title: "删除模板",
    msg: "删除后新建文档时不再出现「" + esc(t.name) + "」；已用该模板创建的文档不受影响。",
    okText: "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/doc-templates/" + encodeURIComponent(id)).then(function(){
      toast("已删除模板「" + t.name + "」", "fs");
      loadDocTplManage();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function setNewReqDocSource(src){
  var source = src === "file" || src === "template" ? src : "blank";
  var btns = document.querySelectorAll("#newReqDocSource [data-docsrc]");
  for(var i = 0; i < btns.length; i++){
    btns[i].setAttribute("aria-pressed", btns[i].dataset.docsrc === source ? "true" : "false");
  }
  showEl($("newReqDocBlankBody"), source === "blank");
  showEl($("newReqDocTemplateBody"), source === "template");
  showEl($("newReqDocFileBody"), source === "file");
  if(source === "blank") resetNewReqDocPreview();
  if(source === "template"){
    var t = $("newReqDocTemplate");
    /* 快捷创建：进模板模式就预选第一套骨架，不让用户面对「模板：空白文档」 */
    if(t && !t.value && t.options.length > 1) t.value = t.options[1].value;
    applyDocTemplateToNewDoc();
  }
}
/* 模板自带类型与格式：选中即同步，省掉两处重复选择 */
function applyDocTemplateToNewDoc(){
  var sel = $("newReqDocTemplate");
  if(!sel || !sel.value || !docTemplatesCache) return;
  var tpl = docTemplatesCache.filter(function(t){ return t.id === sel.value; })[0];
  if(!tpl) return;
  if(tpl.docType && $("newReqDocType")) $("newReqDocType").value = tpl.docType;
  /* 内置模板是 HTML 正文：新建落到在线文档（content 先存 HTML，首次编辑保存后成为快照） */
  if(tpl.format && $("newReqDocFormat")) $("newReqDocFormat").value = tpl.format === "html" ? "univer" : tpl.format;
  syncNewReqDocMoreSum();
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
function reqDocFileExt(name){
  var m = /\.([^.]+)$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}
/* 预览用沙箱文档：与阅读页排版接近，图片按容器宽度收缩 */
function docPreviewDocument(inner){
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'body{margin:0;padding:16px 20px;font:14px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2329;background:#fff;word-break:break-word;}'
    + 'img{max-width:100%;height:auto;}'
    + 'table{border-collapse:collapse;width:100%;margin:10px 0;}'
    + 'td,th{border:1px solid #dcdfe6;padding:6px 8px;font-size:13px;vertical-align:top;}'
    + 'th{background:#f5f7fa;text-align:left;}'
    + 'pre{background:#f6f8fa;padding:10px 12px;border-radius:6px;overflow:auto;white-space:pre-wrap;}'
    + 'h1,h2,h3,h4,h5,h6{margin:14px 0 8px;line-height:1.4;}'
    + 'blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #dcdfe6;color:#646a73;}'
    + 'hr{border:0;border-top:1px solid #dcdfe6;margin:14px 0;}'
    + '</style></head><body>' + (inner || "") + '</body></html>';
}
function countDocImages(html){
  var m = String(html || "").match(/<img\b/gi);
  return m ? m.length : 0;
}
function docImportMetaText(file, label, html){
  var imgs = countDocImages(html);
  var parts = [file.name, label, imgs ? ("含 " + imgs + " 张图片") : "无内嵌图片"];
  if(reqDocFileExt(file.name) === "doc"){
    parts.push("旧版 .doc 只能保留文字，建议另存为 .docx 再导入");
  }
  return parts.join(" · ");
}
/* Word 由服务端转 HTML（内嵌图片已转 data URL），返回清洗后的正文 */
function fetchWordImport(file){
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
    return json.data || {};
  });
}
function showNewReqDocPreview(meta, html){
  if($("newReqDocPreviewMeta")) $("newReqDocPreviewMeta").textContent = meta;
  if($("newReqDocPreviewFrame")) $("newReqDocPreviewFrame").srcdoc = docPreviewDocument(html);
  if($("newReqDocPreview")) $("newReqDocPreview").hidden = false;
}
function resetNewReqDocPreview(){
  newReqDocParsed = null;
  newReqDocParseSeq++;
  if($("newReqDocFile")) $("newReqDocFile").value = "";
  if($("newReqDocPreview")) $("newReqDocPreview").hidden = true;
  if($("newReqDocPreviewFrame")) $("newReqDocPreviewFrame").removeAttribute("srcdoc");
}
/* 选文件后只解析成预览，不写库；点「新建并编辑」时才用这份内容建文档 */
function parseNewReqDocFile(file){
  var kind = reqDocFileKind(file.name);
  var seq = ++newReqDocParseSeq;
  var stale = function(){ return seq !== newReqDocParseSeq; };
  newReqDocParsed = null;
  if($("newReqDocPreview")) $("newReqDocPreview").hidden = true;
  if(!kind){
    return Promise.reject(new Error("暂不支持该文件格式，请上传 Word、Markdown、TXT 或 HTML 文件"));
  }
  if(kind === "word"){
    return fetchWordImport(file).then(function(data){
      if(stale()) return;
      var html = data.content || "";
      if(!html) throw new Error("文档内容为空或无法识别");
      newReqDocParsed = { file: file, kind: kind, content: html, format: "html" };
      showNewReqDocPreview(docImportMetaText(file, "Word → 富文本", html), html);
    });
  }
  return readTextFile(file).then(function(text){
    if(kind === "html"){
      return loadMarkdownLib().then(function(){
        if(stale()) return;
        var safe = window.DOMPurify.sanitize(text);
        newReqDocParsed = { file: file, kind: kind, content: text, format: "html" };
        showNewReqDocPreview(docImportMetaText(file, "HTML", safe), safe);
      });
    }
    if(reqDocFileExt(file.name) === "txt"){
      if(stale()) return;
      newReqDocParsed = { file: file, kind: kind, content: text, format: "markdown" };
      showNewReqDocPreview(docImportMetaText(file, "纯文本", ""), "<pre>" + esc(text) + "</pre>");
      return;
    }
    return loadMarkdownLib().then(function(){
      if(stale()) return;
      var html = "";
      try{ html = window.marked.parse(text, { gfm: true, breaks: false }); }catch(e){ html = ""; }
      var safe = window.DOMPurify.sanitize(html);
      newReqDocParsed = { file: file, kind: kind, content: text, format: "markdown" };
      showNewReqDocPreview(docImportMetaText(file, "Markdown", safe), safe);
    });
  });
}
function closeNewReqDocDialog(){
  showNewReqDocError(false);
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
        + '<span class="rd-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + taskPublicationHTML(t) + '</span>'
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
  if(st === "done") return "已完成";
  if(st === "closed") return "已关闭";
  if(st === "rej") return "已拒绝";
  if(st === "canceled" || st === "cancelled") return "已取消";
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
  var only = $("dlgNewReqDocCreateOnly");
  if(only) only.disabled = !!label;
  if(!ok) return;
  ok.disabled = !!label;
  ok.textContent = label || "新建并编辑";
}
function submitNewReqDoc(keepList){
  var ok = $("dlgNewReqDocOk");
  if(ok && ok.disabled) return;
  showNewReqDocError(false);
  var categoryId = $("newReqDocCategory") ? $("newReqDocCategory").value : "";
  var reqId = $("newReqDocProject").value;   // 空 = 空间级（关联可选）
  var title = ($("newReqDocTitle").value || "").trim();
  if(reqId && !canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  if(!reqId && roleReadOnly()){ toast("你是只读成员，无法新建文档", "warn"); return; }
  if(categoryId){
    var cat = docCatById(categoryId);
    if(!cat){ toast("所选分类不存在，请刷新后重试", "warn"); return; }
    if((cat.reqId || "") !== (reqId || "")){ toast("文档归属项目须与所选分类一致", "warn"); return; }
  }
  var source = document.querySelector('#newReqDocSource [data-docsrc][aria-pressed="true"]');
  var sourceKind = source ? source.dataset.docsrc : "blank";
  var isFile = sourceKind === "file";
  var isTemplate = sourceKind === "template";
  var file = isFile && $("newReqDocFile") ? $("newReqDocFile").files[0] : null;
  if(isFile && !file){ toast("请选择要上传的文件", "warn"); return; }
  if(file && file.size > 10 * 1024 * 1024){ toast("文件超过 10MB，请拆分后再导入", "warn"); return; }
  var kind = file ? reqDocFileKind(file.name) : null;
  if(isFile && !kind){ toast("暂不支持该文件格式，请上传 Word、Markdown、TXT 或 HTML 文件", "warn"); return; }
  if(!title && file) title = file.name.replace(/\.[^.]+$/, "");
  if(!title){
    showNewReqDocError(true);
    toast("请填写文档名称", "warn");
    $("newReqDocTitle").focus();
    return;
  }
  if(isTemplate && !(docTemplatesCache && $("newReqDocTemplate").value)){
    toast("模板还没加载好，请稍候或改用空白文档", "warn");
    return;
  }
  if(isFile && (!newReqDocParsed || newReqDocParsed.file !== file)){
    toast("文件尚未解析完成，请稍候或重新选择文件", "warn");
    return;
  }
  var format = $("newReqDocFormat") ? $("newReqDocFormat").value : "markdown";
  var content = "";
  if(isFile){
    /* 预览时已经转换/清洗过，这里直接写入同一份内容，保证所见即所得 */
    format = newReqDocParsed.format;
    content = newReqDocParsed.content;
  }else if(isTemplate && $("newReqDocTemplate") && $("newReqDocTemplate").value && docTemplatesCache){
    var tplId = $("newReqDocTemplate").value;
    var tpl = docTemplatesCache.filter(function(t){ return t.id === tplId; })[0];
    if(tpl){ content = tpl.content || ""; format = tpl.format || format; }
  }
  var parentId = $("newReqDocParent") ? $("newReqDocParent").value : "";
  var visibility = newReqDocVisValue();
  var memberIds = visibility === "members" ? Object.keys(docVisPickerState("newDoc").sel) : [];
  if(visibility === "members" && !memberIds.length){
    toast("「指定成员」至少要选一位成员", "warn");
    showEl($("newReqDocWhoField"), true);
    return;
  }
  setNewReqDocBusy(isFile ? "导入文档…" : "新建文档…");
  /* 富文本模板正文是 HTML：建文档前先转成 Univer 快照，后端 univer 只收快照 JSON */
  var prepare = content && format === "html" && isTemplate
    ? ensureVendor().then(function(){
        content = JSON.stringify(htmlToSnapshot(content, "hg-tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
        format = "univer";
      })
    : Promise.resolve();
  prepare.then(function(){
    return API.post("/api/req-docs", {
      reqId: reqId || null, title: title, content: content, status: "draft",
      format: format, docType: ($("newReqDocType") && $("newReqDocType").value) || "requirement", parentId: parentId || null,
      categoryId: categoryId || "", visibility: visibility, memberIds: memberIds
    });
  })
    .then(function(doc){
      if(keepList){
        closeNewReqDocDialog();
        loadReqDocs(true);
        toast("已创建「" + doc.title + "」，留在列表", "fs");
        return;
      }
      if(isFile){
        finishNewReqDocImport(doc, file.name, format);
        return;
      }
      closeNewReqDocDialog();
      loadReqDocs(true);
      openReqDocEditor(doc.id);
      toast("已创建「" + doc.title + "」，接着写正文", "fs");
    })
    .catch(function(ex){
      toast("新建文档失败：" + (ex.message || "网络异常"), "bad");
    })
    .then(function(){ setNewReqDocBusy(null); });
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
function openReqDocEditor(id){
  var seq = ++reqDocOpenSeq;
  setReqDocHydrating(false);
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== reqDocOpenSeq) return;   // 连续点开多份：丢弃过期的响应
    editingDocId = doc.id;
    /* 换文档后成员可见范围可能不同，先丢弃上一份的候选 */
    if(reqDocCommentMention) reqDocCommentMention.reset();
    state.reqDocId = doc.id;
    reqDocDirty = false;
    editingMeta = {
      title: doc.title || "",
      reqId: doc.reqId || "",
      status: doc.status || "draft",
      format: docFormatOf(doc.format),
      docType: doc.docType || "other",
      parentId: doc.parentId || "",
      categoryId: doc.categoryId || "",
      publishedAt: doc.publishedAt || null,
      ownerUserId: doc.ownerUserId || "",
      visibility: docVisOf(doc),
      updatedAt: doc.updatedAt || ""
    };
    /* 先让编辑页可见，再创建编辑器：隐藏容器里量出来的宽高是 0 */
    if($("reqDocListPage")) $("reqDocListPage").hidden = true;
    if($("reqDocEditPage")) $("reqDocEditPage").hidden = false;
    reqDocReadOnly = !canEditReq(doc.reqId);
    reqDocOwnerLocked = !reqDocReadOnly && !canEditDoc(doc);
    fillReqDocEditor(doc);
    applyReqDocReadOnly(reqDocReadOnly || reqDocOwnerLocked);
    refreshReqDocPublishBtn();
    refreshReqDocShareBtn();
    setTocVisible(tocVisiblePref());
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名文档");
    activityUI.loadInto($("reqDocActivityList"), "/api/req-docs/" + encodeURIComponent(doc.id) + "/activities");
    loadReqDocTasks(doc.id);
    loadReqDocDemands(doc.id);
    setReqDocCommentQuote(null);
    reqDocLatestSel = null;
    setReqDocReplyTo(null);
    loadReqDocComments(doc.id);
    loadReqDocAttachments(doc.id);
    if(!reqDocReadOnly && !reqDocOwnerLocked) setTimeout(function(){ checkDraftRecovery(doc.id); }, 500);
    /* 打开时停在顶部：目录高亮与滚动位置对齐 */
    try{ window.scrollTo(0, 0); }catch(e){ /* 忽略 */ }
    setTimeout(refreshTocActive, 60);
  }).catch(function(ex){ toast(ex.message || "文档加载失败", "bad"); });
}
function closeReqDocEditor(){
  setReqDocHydrating(false);
  disposeReqUniver();
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
  editingDocId = null;
  if(reqDocCommentMention) reqDocCommentMention.reset();
  reqDirtyReset();
  renderReqDocMode();
  /* 阅读视图里刚编辑过：右侧正文可能是旧的，重新拉一次 */
  if(reqDocMode === "read" && splitDocId) loadReqDocSplitDoc(splitDocId);
}
function reqDirtyReset(){
  reqDocDirty = false;
  state.reqDocId = null;
}
/* 关闭弹窗两种形态：dirty（有未保存修改，三选一）与 draft-clean（已保存但仍是草稿，问是否发布） */
var reqDocCloseMode = "dirty";
function openReqDocCloseDialog(mode){
  reqDocCloseMode = mode === "draft-clean" ? "draft-clean" : "dirty";
  var draftClean = reqDocCloseMode === "draft-clean";
  var dlg = $("dlgReqDocClose");
  if(!dlg) return;
  if($("dlgReqDocCloseTitle")) $("dlgReqDocCloseTitle").textContent = draftClean ? "这篇文档仍是草稿" : "有未保存的修改";
  if($("dlgReqDocCloseMsg")) $("dlgReqDocCloseMsg").textContent = draftClean
    ? "项目成员现在看不到它。是留在草稿继续编辑，还是现在发布？"
    : "关闭前要保存这次编辑吗？" + (editingMeta.publishedAt ? "" : "这篇文档仍是草稿。");
  if($("dlgReqDocCloseCancel")) $("dlgReqDocCloseCancel").textContent = draftClean ? "留在草稿" : "取消";
  if($("dlgReqDocCloseDiscard")) $("dlgReqDocCloseDiscard").hidden = draftClean;
  if($("dlgReqDocCloseSaveDraft")) $("dlgReqDocCloseSaveDraft").hidden = draftClean || !!editingMeta.publishedAt;
  if($("dlgReqDocCloseSave")) $("dlgReqDocCloseSave").textContent = (editingMeta.publishedAt && !draftClean) ? "保存并关闭" : "发布并关闭";
  UI.openModal(dlg);
}
function finishCloseReqDoc(){
  closeReqDocCloseDialog(true);
  closeReqDocEditor();
  continueReqDocRoute();
}
function tryCloseReqDocEditor(nextView){
  /* 直接绑在 click 上时第一个参数是事件对象，只有路由守卫传的字符串才是目标视图 */
  if(typeof nextView === "string") reqDocPendingView = nextView;
  if(reqDocDirty){ openReqDocCloseDialog("dirty"); return; }
  /* 干净但仍是草稿：关闭是作者认为「写完了」的时刻，兜底问一次是否发布 */
  if(editingDocId && !editingMeta.publishedAt && !reqDocReadOnly && !reqDocOwnerLocked){
    openReqDocCloseDialog("draft-clean");
    return;
  }
  closeReqDocEditor(); continueReqDocRoute();
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
    if(!btn.dataset.html) btn.dataset.html = btn.innerHTML;
    var ico = btn.querySelector("[data-icon]");
    btn.innerHTML = (ico ? ico.outerHTML : "") + "&nbsp;" + esc(label || "处理中…");
  }else if(btn.dataset.html){
    btn.innerHTML = btn.dataset.html;
    delete btn.dataset.html;
  }
}
function runAiSplit(){
  if(!editingDocId || aiBusy) return;
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return; }
  var btn = $("reqDocAiSplit");
  ensureReqDocSaved(function(){
    aiBusy = true;
    aiBtnBusy(btn, true, "生成中…");
    AIProgress.run({
      title: "AI 拆成工作项",
      desc: "正在读「" + (editingMeta.title || "当前文档") + "」，拆成可执行的工作单元…",
      hint: "通常需要 20–60 秒，可以随时取消",
      errorText: aiErrMsg,
      request: function(signal){
        return API.postWithSignal("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/split", {}, signal);
      },
      onSuccess: function(d){
        aiSplitDrafts = d.tasks || [];
        renderAiSplit(d);
        UI.openModal($("dlgAiSplit"));
      }
    }).then(function(){
      aiBusy = false;
      aiBtnBusy(btn, false);
    });
  });
}
function renderAiSplit(d){
  var proj = editingMeta.reqId ? reqNameById(editingMeta.reqId) : "";
  var hasDep = aiSplitDrafts.some(function(t){ return t.dependsOnIndex >= 0; });
  $("dlgAiSplitMsg").textContent = "「" + (d.reqDocTitle || "") + "」正文 " + (d.docChars || 0)
    + " 字，AI 拆出 " + aiSplitDrafts.length + " 条。勾选的会创建到"
    + (proj ? "「" + proj + "」" : "本项目") + "的待处理列并关联本文档，标题和优先级可直接改"
    + (hasDep ? "；有依赖的两条都勾选时会自动连上依赖" : "") + "。";
  $("aiSplitList").innerHTML = aiSplitDrafts.map(function(t, i){
    var p = String(t.priority || "P2").toUpperCase();
    var opts = PRIORITIES.map(function(x){
      return '<option value="' + x + '"' + (x === p ? " selected" : "") + '>' + x + ' · ' + esc(priName(x)) + '</option>';
    }).join("");
    return '<div class="ai-item on" data-i="' + i + '">' +
      '<input type="checkbox" checked data-pick="' + i + '" aria-label="选择工作项">' +
      '<div class="ai-main">' +
        '<input class="ai-title" type="text" maxlength="60" value="' + esc(t.title) + '" data-title="' + i + '" aria-label="工作项标题">' +
        (t.description ? '<div class="ai-desc">' + esc(taskDescText(t.description, 200)) + '</div>' : '') +
        '<div class="ai-meta">' +
          '<select class="ai-pri" data-pri="' + i + '" aria-label="优先级">' + opts + '</select>' +
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
    var priEl = nodes[i].querySelector("[data-pri]");
    picked.push({
      title: title,
      description: src.description || "",
      priority: priEl ? priEl.value : (src.priority || "P2"),
      dependsOnIndex: src.dependsOnIndex == null ? -1 : src.dependsOnIndex,
      draftIndex: idx
    });
  }
  if(!picked.length){ toast("至少选一条要创建的工作项", "warn"); return; }

  var btn = $("dlgAiSplitOk");
  btn.disabled = true;
  API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/tasks", { tasks: picked }).then(function(r){
    btn.disabled = false;
    UI.closeModal($("dlgAiSplit"));
    var msg = "已创建 " + r.created + " 个工作项";
    if(r.linked) msg += "，连上 " + r.linked + " 条依赖";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 个本项目已有的同名项";
    msg += aiApplyFailText(r.failed, "个");
    toast(msg, r.failed && r.failed.length ? "warn" : "fs");
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
    AIProgress.run({
      title: "AI 检查完成度",
      desc: "正在对照「" + (editingMeta.title || "当前文档") + "」和关联工作项，找出还没覆盖的功能点…",
      hint: "文档越长耗时越久，可以随时取消",
      errorText: aiErrMsg,
      request: function(signal){
        return API.postWithSignal("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/audit", {}, signal);
      },
      onSuccess: function(d){
        renderAiAudit(d);
        UI.openModal($("dlgAiAudit"));
      }
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
    return '<div class="ai-item' + (st === "missing" ? " miss" : "") + '">' +
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
/* ---------- AI 选区处理：改写 / 缩写 / 解释 / 提为工作项 ----------
   只产出建议：点「替换」才写回编辑器，随后走正常保存 —— 保存时服务端自动留历史版本。
   选区由当前编辑器真实内容截取（富文本取 Range，Markdown 取 textarea 下标），
   服务端不再解析整篇文档，避免「选的是这段、模型看到的是那段」。 */

var RDA_MAX = 3000;
var rdaBubble = null;
var rdaCard = null;
var rdaSel = null;
/* 发起请求时冻结的选区：卡片里的「原句」和「替换」都以它为准，
   避免卡片开着时又选了别处，替换落到新选区上 */
var rdaTarget = null;
var rdaResult = null;
var rdaBusy = false;
var rdaCtl = null;
var rdaAction = null;
/* 请求序号：取消或重新发起后，旧请求晚到的结果直接丢弃 */
var rdaSeq = 0;
var rdaAnchor = { x: 0, y: 0 };

function rdaEnsureNodes(){
  if(rdaBubble) return;
  rdaBubble = document.createElement("div");
  rdaBubble.className = "rda-bubble";
  rdaBubble.hidden = true;
  rdaBubble.setAttribute("role", "toolbar");
  rdaBubble.setAttribute("aria-label", "AI 处理选中文字");
  rdaBubble.innerHTML = '<span class="rda-badge">' + icon("ai") + ' AI</span>'
    + '<button type="button" data-rda-act="rewrite">改写</button>'
    + '<button type="button" data-rda-act="shorten">缩写</button>'
    + '<button type="button" data-rda-act="expand">扩写</button>'
    + '<button type="button" data-rda-act="explain">解释</button>'
    + '<span class="rda-sep" aria-hidden="true"></span>'
    + '<button type="button" data-rda-act="to_task">提为工作项</button>';
  rdaBubble.addEventListener("mousedown", function(e){ e.preventDefault(); });
  rdaBubble.addEventListener("click", function(e){
    var btn = e.target.closest("[data-rda-act]");
    if(btn) rdaRun(btn.getAttribute("data-rda-act"));
  });

  rdaCard = document.createElement("div");
  rdaCard.className = "rda-card";
  rdaCard.hidden = true;
  rdaCard.setAttribute("role", "dialog");
  rdaCard.setAttribute("aria-label", "AI 建议");
  rdaCard.addEventListener("click", function(e){
    var btn = e.target.closest("[data-rda]");
    if(!btn) return;
    var act = btn.getAttribute("data-rda");
    /* 请求还在跑时关卡片要真的取消，否则结果回来会把卡片再弹出来 */
    if(act === "close"){ if(rdaBusy) rdaCancel(); else rdaHideCard(); return; }
    if(act === "cancel"){ rdaCancel(); return; }
    if(act === "retry"){ if(rdaAction) rdaRun(rdaAction, true); return; }
    if(act === "copy"){ rdaCopy(); return; }
    if(act === "replace"){ rdaReplace(); return; }
    if(act === "expand"){ rdaCard.classList.toggle("is-wide"); rdaPlaceCard(); }
  });
  document.body.appendChild(rdaBubble);
  document.body.appendChild(rdaCard);
}

function rdaSelectionText(text){
  var t = String(text || "").replace(/\u200b/g, "").trim();
  return t;
}

/* SunEditor 有两种渲染模式：同文档 contenteditable div，或 iframe 内的 body。
   取正文根节点与它所属的 window/document，选区与坐标都按实际模式算。 */
function rdaEditorRoot(){
  if(!reqEditor || !reqEditor.core || !reqEditor.core.context) return null;
  var el = reqEditor.core.context.element;
  if(el.wysiwyg && el.wysiwyg.ownerDocument === document){
    return { node: el.wysiwyg, doc: document, win: window, frame: null };
  }
  var frame = el.wysiwygFrame;
  if(frame && frame.tagName === "IFRAME" && frame.contentDocument){
    return { node: frame.contentDocument.body, doc: frame.contentDocument, win: frame.contentWindow, frame: frame };
  }
  return null;
}

/* 富文本：选区、前后文与小节都从编辑器 DOM 现场取；Range 留到点「替换」时复用 */
function rdaCaptureRich(root){
  if(reqDocReadOnly || !editingDocId || rdaBusy){ rdaHideBubble(); return; }
  var sel = root.win.getSelection();
  if(!sel || !sel.rangeCount || sel.isCollapsed){ rdaHideBubble(); return; }
  var range = sel.getRangeAt(0);
  /* 同文档模式下监听挂在 document 上：只处理正文里的选区 */
  if(!root.node.contains(range.startContainer) || !root.node.contains(range.endContainer)){
    rdaHideBubble();
    return;
  }
  var text = rdaSelectionText(sel.toString());
  if(text.length < 4 || text.length > RDA_MAX){ rdaHideBubble(); return; }
  var body = root.node;
  var before = "", after = "";
  try{
    var pre = root.doc.createRange();
    pre.selectNodeContents(body);
    pre.setEnd(range.startContainer, range.startOffset);
    before = pre.toString().slice(-400);
    var post = root.doc.createRange();
    post.selectNodeContents(body);
    post.setStart(range.endContainer, range.endOffset);
    after = post.toString().slice(0, 400);
  }catch(e){ /* 选区跨界失败时上下文留空，不影响改写本身 */ }
  var rect = range.getBoundingClientRect();
  var base = root.frame ? root.frame.getBoundingClientRect() : { left: 0, top: 0 };
  rdaSel = {
    kind: "html", text: text, before: before, after: after,
    section: rdaSectionAt(body, range.startContainer), range: range
  };
  rdaAnchor = { x: base.left + rect.left + rect.width / 2, y: base.top + rect.top };
  rdaShowBubble();
}

function rdaSectionAt(body, node){
  var hs = body.querySelectorAll("h1,h2,h3,h4,h5,h6");
  var label = "";
  for(var i = 0; i < hs.length; i++){
    var pos = hs[i].compareDocumentPosition(node);
    if(pos & 4){ label = (hs[i].textContent || "").trim(); }
    else break;
  }
  return label.slice(0, 120);
}

/* Markdown：textarea 没有可视化选区矩形，气泡挂在鼠标位置 */
function rdaCaptureMd(ta, x, y){
  if(reqDocReadOnly || !editingDocId || rdaBusy){ rdaHideBubble(); return; }
  var start = ta.selectionStart, end = ta.selectionEnd;
  if(start == null || end == null || start === end){ rdaHideBubble(); return; }
  var text = rdaSelectionText(ta.value.slice(start, end));
  if(text.length < 4 || text.length > RDA_MAX){ rdaHideBubble(); return; }
  var caretLine = ta.value.slice(0, start).split("\n");
  var section = "";
  for(var i = caretLine.length - 1; i >= 0; i--){
    var m = /^(#{1,6})\s+(.+)$/.exec(caretLine[i]);
    if(m){ section = m[2].trim(); break; }
  }
  rdaSel = {
    kind: "md", text: text, before: ta.value.slice(Math.max(0, start - 400), start),
    after: ta.value.slice(end, end + 400), section: section.slice(0, 120),
    start: start, end: end
  };
  rdaAnchor = { x: x || 240, y: y || 200 };
  rdaShowBubble();
}

function rdaBindEditorSelection(){
  if(!reqEditor || !reqEditor.core) return;
  /* 编辑器刚创建时正文容器可能还没挂上：最多重试 10 次（约 2 秒），之后放弃。
     用闭包计数，避免把「已放弃」状态留给下一次创建。 */
  var attempt = function(left){
    var root = rdaEditorRoot();
    if(!root || !root.node){
      if(left > 0) setTimeout(function(){ attempt(left - 1); }, 200);
      return;
    }
    if(root.node.dataset.rdaBound) return;
    root.node.dataset.rdaBound = "1";
    var onUp = function(){ setTimeout(function(){ rdaCaptureRich(root); }, 0); };
    root.doc.addEventListener("mouseup", onUp);
    root.doc.addEventListener("keyup", function(e){ if(e.shiftKey) onUp(); });
    root.doc.addEventListener("scroll", rdaHideBubble, true);
  };
  attempt(10);
}

function rdaBindMdSelection(){
  var ta = $("reqDocMdCanvas");
  if(!ta || ta.dataset.rdaBound) return;
  ta.dataset.rdaBound = "1";
  ta.addEventListener("mouseup", function(e){
    setTimeout(function(){ rdaCaptureMd(ta, e.clientX, e.clientY); }, 0);
  });
  ta.addEventListener("keyup", function(e){
    if(!e.shiftKey && e.key !== "Shift"){ rdaHideBubble(); return; }
    var r = ta.getBoundingClientRect();
    setTimeout(function(){ rdaCaptureMd(ta, r.left + r.width / 2, r.top + 28); }, 0);
  });
}

function rdaShowBubble(){
  rdaEnsureNodes();
  rdaBubble.hidden = false;
  var w = rdaBubble.offsetWidth, h = rdaBubble.offsetHeight;
  var x = Math.max(8, Math.min(window.innerWidth - w - 8, rdaAnchor.x - w / 2));
  var y = rdaAnchor.y - h - 8;
  if(y < 8) y = Math.min(window.innerHeight - h - 8, rdaAnchor.y + 22);
  rdaBubble.style.left = Math.round(x) + "px";
  rdaBubble.style.top = Math.round(y) + "px";
}

function rdaHideBubble(){
  if(rdaBubble) rdaBubble.hidden = true;
}

function rdaHideCard(){
  if(rdaCard) rdaCard.hidden = true;
  rdaResult = null;
  rdaAction = null;
  rdaTarget = null;
}

function rdaPlaceCard(){
  if(!rdaCard || rdaCard.hidden) return;
  var w = rdaCard.offsetWidth, h = rdaCard.offsetHeight;
  var x = Math.max(8, Math.min(window.innerWidth - w - 8, rdaAnchor.x - w / 2));
  var y = rdaAnchor.y + 12;
  if(y + h > window.innerHeight - 8){
    y = rdaAnchor.y - h - 12;
    if(y < 8) y = Math.max(8, window.innerHeight - h - 8);
  }
  rdaCard.style.left = Math.round(x) + "px";
  rdaCard.style.top = Math.round(y) + "px";
}

function rdaDelta(d){
  var before = d.beforeChars || 0, after = d.afterChars || 0;
  if(!before) return "";
  var pct = Math.round((before - after) / before * 100);
  return before + " 字 → " + after + " 字" + (pct === 0 ? "" : (pct > 0 ? "（少 " + pct + "%）" : "（多 " + (-pct) + "%）"));
}

function rdaOpenCard(action, d, err){
  rdaEnsureNodes();
  rdaCard.hidden = false;
  var title = action === "rewrite" ? "改写建议"
    : (action === "shorten" ? "缩写建议" : (action === "expand" ? "扩写建议" : "这段在说什么"));
  var head = '<div class="rda-head"><span class="rda-title">' + esc(title) + '</span>'
    + '<span class="rda-usage">' + (d && d.usage ? esc(aiUsageText(d.usage)) : "") + '</span>'
    + '<button class="rda-x" type="button" data-rda="close" aria-label="关闭">×</button></div>';

  if(err){
    rdaCard.innerHTML = head + '<div class="rda-body"><div class="rda-err">' + esc(err) + '</div></div>'
      + '<div class="rda-foot"><button type="button" data-rda="retry">重试</button>'
      + '<button type="button" class="sm primary" data-rda="close">关闭</button></div>';
    rdaPlaceCard();
    return;
  }
  if(!d){
    var busyText = action === "explain" ? "正在读这段文字…"
      : (action === "expand" ? "正在扩写这段文字…" : "正在生成建议…");
    rdaCard.innerHTML = head + '<div class="rda-body"><div class="rda-loading">'
      + '<span class="rda-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
      + busyText + '</div></div>'
      + '<div class="rda-foot"><span class="rda-hint">通常需要 5–30 秒</span>'
      + '<button type="button" data-rda="cancel">取消</button></div>';
    rdaPlaceCard();
    return;
  }

  var orig = '<div class="rda-block"><div class="rda-lbl">原句</div>'
    + '<div class="rda-orig">' + esc(rdaTarget ? rdaTarget.text : "") + '</div></div>';
  var body;
  if(action === "explain"){
    var notes = (d.notes || []).map(function(n){ return '<li>' + esc(n) + '</li>'; }).join("");
    body = orig + '<div class="rda-block"><div class="rda-lbl">解释</div>'
      + '<div class="rda-sug">' + esc(d.text || "") + '</div></div>'
      + (notes ? '<ul class="rda-notes">' + notes + '</ul>' : "");
  }else{
    body = orig + '<div class="rda-block"><div class="rda-lbl">建议</div>'
      + '<div class="rda-sug">' + esc(d.text || "") + '</div></div>';
    /* 假设是模型补出来、原文没有依据的内容：只展示，不随「替换」写回正文 */
    if(action === "expand"){
      var assume = (d.notes || []).map(function(n){ return '<li>' + esc(n) + '</li>'; }).join("");
      if(assume){
        body += '<div class="rda-block"><div class="rda-lbl">待确认假设（不会写回正文）</div>'
          + '<ul class="rda-notes">' + assume + '</ul></div>';
      }
    }
  }
  /* 解释不改正文，字数变化没有意义，不显示 */
  var foot = '<div class="rda-foot">'
    + (action === "explain" ? "" : '<span class="rda-delta">' + esc(rdaDelta(d)) + '</span>')
    + '<span class="rda-spacer"></span>'
    + '<button type="button" data-rda="retry">重新生成</button>'
    + '<button type="button" data-rda="copy">复制</button>';
  if(action !== "explain"){
    foot += '<button type="button" class="primary" data-rda="replace">替换</button>';
  }
  foot += '</div>';
  rdaCard.innerHTML = head + '<div class="rda-body">' + body + '</div>' + foot;
  rdaPlaceCard();
  var sug = rdaCard.querySelector(".rda-sug");
  if(sug) sug.scrollTop = 0;
}

function rdaRun(action, keepTarget){
  var s = keepTarget ? rdaTarget : rdaSel;
  if(rdaBusy || !s || !editingDocId) return;
  if(action === "to_task"){ rdaToTask(); return; }
  if(!keepTarget) rdaTarget = s;
  rdaBusy = true;
  rdaAction = action;
  rdaResult = null;
  rdaHideBubble();
  rdaOpenCard(action, null, null);
  var my = ++rdaSeq;
  rdaCtl = window.AbortController ? new AbortController() : null;
  API.postWithSignal("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/selection", {
    action: action,
    selection: s.text,
    before: s.before,
    after: s.after,
    section: s.section,
    format: s.kind === "md" ? "markdown" : "html"
  }, rdaCtl ? rdaCtl.signal : null).then(function(d){
    if(my !== rdaSeq) return;
    rdaBusy = false;
    rdaCtl = null;
    rdaResult = d;
    rdaOpenCard(action, d, null);
  }).catch(function(ex){
    if(my !== rdaSeq) return;
    rdaBusy = false;
    rdaCtl = null;
    /* api.js 取消请求时抛 aborted/silent 的普通 Error，不是 AbortError */
    if(ex && (ex.aborted || ex.silent || ex.name === "AbortError" || ex.code === 499)){ return; }
    rdaOpenCard(action, null, aiErrMsg(ex && ex.message));
  });
}

function rdaCancel(){
  rdaSeq++;  /* 晚到的结果不再回填 */
  if(rdaCtl){ try{ rdaCtl.abort(); }catch(e){ /* 忽略 */ } }
  rdaBusy = false;
  rdaCtl = null;
  rdaHideCard();
}

function rdaCopy(){
  if(!rdaResult) return;
  var text = rdaResult.text || "";
  if(!text){ toast("没有可复制的内容", "warn"); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      toast("已复制 AI 建议", "fs");
    }).catch(function(){ toast("复制失败，请手动选中后复制", "warn"); });
  }else{
    toast("当前浏览器不支持一键复制，请手动选中后复制", "warn");
  }
}

/* 建议文本按空行切段：单段直接插文本节点（继承选区原有格式），多段包 <p> 保留段落 */
function rdaTextToHtml(text){
  var parts = String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/).filter(function(s){ return s.trim(); });
  if(parts.length <= 1){
    return esc(parts[0] || "").replace(/\n/g, "<br>");
  }
  return parts.map(function(p){ return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
}

function rdaApplyRich(text, target){
  var range = target && target.range;
  if(!range || !range.startContainer || !range.startContainer.isConnected
      || !range.endContainer || !range.endContainer.isConnected){
    toast("原文已被改动，请重新选中后再点替换", "warn");
    return false;
  }
  /* 卡片开着时正文可能被编辑过：偏移还在，但内容已经不是当初那段了 */
  if(rdaSelectionText(range.toString()) !== target.text){
    toast("原文已被改动，请重新选中后再点替换", "warn");
    return false;
  }
  try{
    reqEditor.core.setRange(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    /* addToUndo=true：替换后 Ctrl/⌘+Z 能退回原文 */
    reqEditor.insertHTML(rdaTextToHtml(text), true, true, true);
  }catch(e){
    toast("替换失败，请重新选中后再试", "bad");
    return false;
  }
  return true;
}

function rdaApplyMd(text, target){
  var ta = $("reqDocMdCanvas");
  if(!ta || !target){ return false; }
  if(rdaSelectionText(ta.value.slice(target.start, target.end)) !== target.text){
    toast("原文已被改动，请重新选中后再点替换", "warn");
    return false;
  }
  ta.focus();
  ta.setSelectionRange(target.start, target.end);
  var ok = false;
  try{ ok = document.execCommand("insertText", false, text); }catch(e){ ok = false; }
  if(!ok){
    ta.setRangeText(text, target.start, target.end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  scheduleMdPreview();
  return true;
}

function rdaReplace(){
  var target = rdaTarget;
  if(!rdaResult || !target) return;
  var text = rdaResult.text || "";
  /* 贴回编辑器后按文档原有保存流程走：不静默提交，保存时服务端自动留历史版本 */
  var ok = target.kind === "md" ? rdaApplyMd(text, target) : rdaApplyRich(text, target);
  if(!ok) return;
  markReqDocDirty();
  scheduleTocRebuild();
  rdaHideCard();
  rdaHideBubble();
  rdaSel = null;
  toast("已替换，保存后可在「历史版本」里恢复原文", "fs");
}

function rdaToTask(){
  if(rdaBusy || !rdaSel || !editingDocId) return;
  var s = rdaSel;
  rdaHideBubble();
  ensureReqDocSaved(function(){
    if(!editingDocId) return;
    AIProgress.run({
      title: "从选中文字提工作项",
      desc: "正在把选中的这段文字拆成可执行的工作项…",
      hint: "通常需要 20–60 秒，可以随时取消",
      errorText: aiErrMsg,
      request: function(signal){
        return API.postWithSignal("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/selection/tasks", {
          action: "to_task", selection: s.text, before: s.before, after: s.after,
          section: s.section, format: isMarkdownDoc() ? "markdown" : "html"
        }, signal);
      },
      onSuccess: function(d){
        aiSplitDrafts = d.tasks || [];
        renderAiSplit(d);
        UI.openModal($("dlgAiSplit"));
        rdaHideCard();
        rdaSel = null;
      }
    });
  });
}

if($("reqDocAiSplit")){
  $("reqDocAiSplit").addEventListener("click", runAiSplit);
  $("reqDocAiAudit").addEventListener("click", runAiAudit);
  $("dlgAiSplitCancel").addEventListener("click", function(){ UI.closeModal($("dlgAiSplit")); });
  $("dlgAiSplitX").addEventListener("click", function(){ UI.closeModal($("dlgAiSplit")); });
  $("dlgAiSplitOk").addEventListener("click", applyAiSplit);
  $("dlgAiAuditClose").addEventListener("click", function(){ UI.closeModal($("dlgAiAudit")); });
  $("dlgAiAuditX").addEventListener("click", function(){ UI.closeModal($("dlgAiAudit")); });
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
  var univer = format === "univer";
  showEl($("reqDocRichBody"), !md && !univer);
  showEl($("reqDocMdBody"), md);
  showEl($("reqDocUniverBody"), univer);
  var badge = $("reqDocFormat");
  if(badge){
    showEl(badge, true);
    badge.textContent = md ? "Markdown" : "富文本";
    badge.className = "reqdoc-fmt " + (md ? "md" : "html");
  }
  /* 正文缩放按钮只作用于 DOM 排版；Univer 画布自带缩放，套 CSS zoom 会错位指针坐标 */
  var zoom = document.querySelector("#reqDocEditPage .doc-zoom");
  if(zoom) zoom.hidden = univer;
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
function fillReqDocEditor(doc, opts){
  var keepBody = !!(opts && opts.keepBody);
  var id = doc.id;
  editingMeta = {
    title: doc.title || "",
    reqId: doc.reqId || "",
    status: doc.status || "draft",
    format: docFormatOf(doc.format),
    docType: doc.docType || "other",
    parentId: doc.parentId || "",
    categoryId: doc.categoryId || "",
    /* 发布状态与作者必须随正文一起回填：否则打开/保存已发布文档后按钮误显示「发布」、分享提示「尚未发布」 */
    publishedAt: doc.publishedAt || null,
    ownerUserId: doc.ownerUserId || "",
    visibility: docVisOf(doc),
    updatedAt: doc.updatedAt || ""
  };
  refreshReqDocPublishBtn();
  refreshReqDocShareBtn();
  setDocFormatUI(editingMeta.format);
  fillDocTypeSelect("reqDocType", editingMeta.docType);
  fillDocParentSelect(doc);
  fillReqDocCategorySelect(doc);
  if(isMarkdownDoc()){
    disposeReqUniver();
    reqEditorBaseline = null;
    fillMarkdownEditor(doc);
  }else if(isUniverDoc()){
    reqEditorBaseline = null;
    /* keepBody：刚保存完且正文未变，重挂会丢光标与滚动位置 */
    if(!keepBody){
      var snap = parseSnapshot(doc.content);
      mountReqUniver(snap, snap ? "" : (doc.content || ""));
    }
  }else if(reqEditor){
    disposeReqUniver();
    setReqEditorContents(doc.content);
    updateReqDocCount();
    rebuildToc();
  }else{
    disposeReqUniver();
    /* 首次打开：编辑器按需下载，下载完再灌正文（期间用户切走就丢弃结果） */
    setReqDocHydrating(true);
    ensureEditor().then(function(ed){
      setReqDocHydrating(false);
      if(!ed || editingDocId !== id) return;
      setReqEditorContents(doc.content);
      updateReqDocCount();
      rebuildToc();
      applyReqDocReadOnly(reqDocReadOnly || reqDocOwnerLocked);
    }).catch(function(ex){
      setReqDocHydrating(false);
      toast(ex.message || "编辑器加载失败", "bad");
    });
  }
  reqDocDirty = false;
  refreshReqDocSavedText();
  /* 正文换人了：目录要跟着换（重建前先清掉旧的高亮） */
  tocActive = null;
  rebuildToc();
  applyReqDocReadOnly(reqDocReadOnly || reqDocOwnerLocked);
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
var reqDocCountTimer = null;
function markReqDocDirty(){
  if(reqDocReadOnly) return;
  /* 字数统计要遍历全文，按键期间合并到停顿后再算 */
  if(reqDocCountTimer) clearTimeout(reqDocCountTimer);
  reqDocCountTimer = setTimeout(function(){ reqDocCountTimer = null; updateReqDocCount(); }, 300);
  if(reqDocDirty) return;
  reqDocDirty = true;
  if($("reqDocSaved")) $("reqDocSaved").textContent = "有未保存的修改";
  scheduleDraftSave();
}
function reqDocPlainText(){
  if(isMarkdownDoc()) return $("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "";
  if(isUniverDoc()) return reqUniverView ? snapshotToText(reqUniverView.getSnapshot()) : "";
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
var reqDocReplyTo = null;
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
  var unresolvedOnly = $("reqDocUnresolvedOnly") && $("reqDocUnresolvedOnly").checked;
  var params = unresolvedOnly ? { unresolved: true } : {};
  API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/comments", params).then(function(rows){
    if(editingDocId !== docId) return;
    rows = rows || [];
    if(count) count.textContent = rows.length ? "（" + rows.length + "）" : "";
    if(!rows.length){
      list.innerHTML = '<div class="reqdoc-comment-empty">' + (unresolvedOnly ? '没有未解决的评论' : '还没有评论') + '</div>';
      return;
    }
    list.innerHTML = rows.map(function(c){ return renderCommentThread(c); }).join("");
  }).catch(function(ex){
    if(editingDocId !== docId) return;
    list.innerHTML = '<div class="reqdoc-comment-empty">' + esc(ex.message || "评论加载失败") + '</div>';
  });
}
function renderCommentThread(c){
  var html = renderCommentItem(c, false);
  if(c.replies && c.replies.length){
    html += '<div class="reqdoc-comment-replies">';
    c.replies.forEach(function(r){ html += renderCommentItem(r, true); });
    html += '</div>';
  }
  return html;
}
function renderCommentItem(c, isReply){
  var resolvedBadge = c.resolved ? '<span class="reqdoc-resolved-badge">已解决</span>' : '';
  var taskLink = c.taskId ? '<a class="reqdoc-comment-tasklink" href="#" data-comment-task="' + esc(c.taskId) + '">已转工作项</a>' : '';
  var actions = '';
  if(!roleReadOnly()){
    actions = '<div class="reqdoc-comment-actions-r">';
    if(!isReply) actions += '<button class="btn sm soft" type="button" data-reply-comment="' + esc(c.id) + '" data-reply-user="' + esc(c.userName || "") + '">回复</button>';
    if(!isReply) actions += '<button class="btn sm soft" type="button" data-resolve-comment="' + esc(c.id) + '" data-resolved="' + (c.resolved ? "1" : "0") + '">' + (c.resolved ? '重新打开' : '解决') + '</button>';
    if(!c.taskId) actions += '<button class="btn sm soft" type="button" data-totask-comment="' + esc(c.id) + '">转工作项</button>';
    if(c.deletable) actions += '<button class="btn sm danger" type="button" data-del-comment="1">删除</button>';
    actions += '</div>';
  }
  return '<div class="reqdoc-comment-item' + (isReply ? ' is-reply' : '') + (c.resolved ? ' is-resolved' : '') + '" data-comment-id="' + esc(c.id) + '">'
    + '<div class="reqdoc-comment-head">'
    +   '<span class="reqdoc-comment-user">' + esc(c.userName || "—") + '</span>'
    +   resolvedBadge + taskLink
    +   '<span class="reqdoc-comment-time">' + esc(fmtTs(c.createdAt) || "—") + '</span>'
    + '</div>'
    + (c.quoteText ? '<div class="reqdoc-comment-quote">' + esc(c.quoteText) + '</div>' : '')
    + '<div class="reqdoc-comment-body">' + esc(c.content) + '</div>'
    + actions
    + '</div>';
}
function setReqDocReplyTo(commentId, userName){
  reqDocReplyTo = commentId || null;
  var chip = $("reqDocCommentReplyChip");
  var txt = $("reqDocCommentReplyText");
  if(chip) chip.hidden = !reqDocReplyTo;
  if(txt) txt.textContent = userName || "";
  if(reqDocReplyTo && $("reqDocCommentInput")) $("reqDocCommentInput").focus();
}
function submitReqDocComment(){
  if(!editingDocId || roleReadOnly()){ toast("查看者不能发表评论", "warn"); return; }
  var ta = $("reqDocCommentInput");
  var content = (ta && ta.value || "").trim();
  if(!content){ toast("评论内容不能为空", "warn"); if(ta) ta.focus(); return; }
  var btn = $("reqDocCommentSend");
  if(btn && btn.disabled) return;
  if(btn) btn.disabled = true;
  var body = { content: content };
  if(reqDocCommentQuote) body.quoteText = reqDocCommentQuote;
  if(reqDocReplyTo) body.parentId = reqDocReplyTo;
  var mentionIds = reqDocCommentMention ? reqDocCommentMention.idsInText(content) : [];
  if(mentionIds.length) body.mentionUserIds = mentionIds;
  API.post("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments", body).then(function(){
    if(ta) ta.value = "";
    if(reqDocCommentMention){ reqDocCommentMention.close(); reqDocCommentMention.clearPicked(); }
    setReqDocCommentQuote(null);
    setReqDocReplyTo(null);
    loadReqDocComments(editingDocId);
  }).catch(function(ex){ toast(ex.message || "评论发表失败", "bad"); })
  .then(function(){ if(btn) btn.disabled = false; });
}
function resolveReqDocComment(commentId, resolved){
  if(!editingDocId) return;
  API.put("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments/" + encodeURIComponent(commentId) + "/resolve",
    { resolved: !resolved }).then(function(){
    loadReqDocComments(editingDocId);
    toast(resolved ? "已重新打开" : "已标记为解决", "fs");
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}
function commentToTask(commentId){
  if(!editingDocId) return;
  UI.showConfirm({ title: "转为工作项", msg: "将这条评论转为待办工作项？", okText: "转为工作项" }).then(function(ok){
    if(!ok) return;
    API.post("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments/" + encodeURIComponent(commentId) + "/to-task")
      .then(function(task){
        loadReqDocComments(editingDocId);
        toast("已创建工作项「" + (task.title || "") + "」", "fs");
      }).catch(function(ex){ toast(ex.message || "转工作项失败", "bad"); });
  });
}
function deleteReqDocComment(commentId){
  if(!editingDocId || !commentId) return;
  UI.showConfirm({ title: "删除评论", msg: "确定删除这条评论？", okText: "删除评论", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(editingDocId) + "/comments/" + encodeURIComponent(commentId)).then(function(){
      loadReqDocComments(editingDocId);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------- 文档附件 ---------- */

function loadReqDocAttachments(docId){
  var list = $("reqDocAttachList");
  var count = $("reqDocAttachCount");
  var uploadBtn = $("reqDocAttachUpload");
  var kit = $("reqDocAttachKit");
  if(!list) return;
  if(uploadBtn) uploadBtn.style.display = roleReadOnly() ? "none" : "";
  if(kit) kit.style.display = roleReadOnly() ? "none" : "";
  list.innerHTML = '<div class="tl-empty">加载中…</div>';
  API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/attachments").then(function(rows){
    if(editingDocId !== docId) return;
    rows = rows || [];
    list.__attList = rows;
    if(count) count.textContent = rows.length ? "（" + rows.length + "）" : "";
    if(!rows.length){ list.innerHTML = '<div class="tl-empty">暂无附件</div>'; return; }
    list.innerHTML = '<div class="att-chips">' + rows.map(function(a){
      return attachmentChipHTML(a, { removable: !roleReadOnly() });
    }).join("") + '</div>';
  }).catch(function(){ if(editingDocId === docId) list.innerHTML = '<div class="tl-empty">附件加载失败</div>'; });
}
function uploadReqDocAttachments(files){
  if(!editingDocId || roleReadOnly() || !files || !files.length) return;
  var list = $("reqDocAttachList");
  var current = list && list.__attList ? list.__attList.length : 0;
  var res = validateFiles(files, current);
  reportRejected(res.rejected);
  if(!res.ok.length) return;
  var path = "/api/req-docs/" + encodeURIComponent(editingDocId) + "/attachments";
  var done = 0, failed = 0;
  var chain = Promise.resolve();
  res.ok.forEach(function(f){
    chain = chain.then(function(){
      return uploadAttachment(path, f).then(function(){ done++; }, function(){ failed++; });
    });
  });
  chain.then(function(){
    loadReqDocAttachments(editingDocId);
    if(failed) toast("上传完成：" + done + " 成功，" + failed + " 失败", "warn");
    else toast(done > 1 ? "已上传 " + done + " 个附件" : "附件上传成功", "fs");
  });
}
function deleteReqDocAttachment(attachId){
  if(!editingDocId) return;
  UI.showConfirm({ title: "删除附件", msg: "确定删除这个附件？文件将不可恢复。", okText: "删除", danger: true }).then(function(ok){
    if(!ok) return;
    API.del("/api/attachments/" + encodeURIComponent(attachId)).then(function(){
      loadReqDocAttachments(editingDocId);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------- 打印 / 导出 PDF ---------- */

function printReqDoc(){
  if(!editingDocId) return;
  var bodyHtml;
  if(isMarkdownDoc()){
    var preview = $("reqDocMdPreview");
    bodyHtml = preview ? preview.innerHTML : "";
  }else if(isUniverDoc()){
    bodyHtml = reqUniverView ? snapshotToHtml(reqUniverView.getSnapshot()) : "";
  }else{
    bodyHtml = reqEditor ? reqEditor.getContents() : "";
  }
  if(!bodyHtml || !bodyHtml.trim()){ toast("正文为空，没有可打印的内容", "warn"); return; }
  var title = editingMeta.title || "文档";
  var win = window.open("", "_blank");
  if(!win){ toast("浏览器阻止了弹出窗口，请允许后重试", "warn"); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
    + '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;font-size:14px;color:#222;}'
    + 'h1{font-size:22px;border-bottom:1px solid #ddd;padding-bottom:8px;}img{max-width:100%;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:6px 8px;}'
    + '@media print{body{margin:0;max-width:none;}}</style></head><body>'
    + '<h1>' + esc(title) + '</h1>' + bodyHtml + '</body></html>');
  win.document.close();
  setTimeout(function(){ win.print(); }, 300);
}

/* ---------- 草稿自动保存与恢复 ---------- */

var reqDocDraftTimer = null;
function draftKey(docId){ return "hg.docDraft:" + docId; }
/* localStorage 每源约 5MB，内嵌图片的大正文存不下，序列化本身也拖慢编辑 */
var REQ_DOC_DRAFT_MAX_CHARS = 1500000;
var reqDocDraftSkipWarnedId = null;
function warnReqDocDraftSkipped(){
  if(reqDocDraftSkipWarnedId === editingDocId) return;
  reqDocDraftSkipWarnedId = editingDocId;
  toast("正文较大（含图片），不再自动存本地草稿，请及时保存", "warn");
}
function scheduleDraftSave(){
  if(reqDocDraftTimer) clearTimeout(reqDocDraftTimer);
  reqDocDraftTimer = setTimeout(function(){
    if(!editingDocId || reqDocReadOnly || !reqDocDirty) return;
    var key = draftKey(editingDocId);
    try{
      var content = getEditorContent();
      if(!content) return;
      if(content.length > REQ_DOC_DRAFT_MAX_CHARS){
        localStorage.removeItem(key);
        warnReqDocDraftSkipped();
        return;
      }
      localStorage.setItem(key, JSON.stringify({ content: content, ts: Date.now(), format: editingMeta.format }));
    }catch(e){
      try{ localStorage.removeItem(key); }catch(e2){ /* 存储不可用 */ }
      warnReqDocDraftSkipped();
    }
  }, 3000);
}
function checkDraftRecovery(docId){
  try{
    var raw = localStorage.getItem(draftKey(docId));
    if(!raw) return;
    var draft = JSON.parse(raw);
    if(!draft || !draft.content || Date.now() - draft.ts > 7 * 86400000){ localStorage.removeItem(draftKey(docId)); return; }
    var ago = Math.round((Date.now() - draft.ts) / 60000);
    var label = ago < 60 ? ago + " 分钟前" : Math.round(ago / 60) + " 小时前";
    UI.showConfirm({ title: "恢复未保存的草稿", msg: "检测到 " + label + " 的自动保存草稿，是否恢复？（放弃则删除草稿）", okText: "恢复草稿", cancelText: "放弃" }).then(function(ok){
      if(ok){
        /* 在线文档是异步挂载：要等挂载完成再置脏，否则会被 mountReqUniver 里的复位清掉 */
        Promise.resolve(setEditorContent(draft.content, draft.format || editingMeta.format)).then(function(){
          if(isUniverDoc() && !reqUniverView) return;
          markReqDocDirty();
          toast("已恢复草稿，记得保存", "fs");
        });
      }
      localStorage.removeItem(draftKey(docId));
    });
  }catch(e){ /* 解析失败忽略 */ }
}
function clearDraftOnSave(docId){
  try{ localStorage.removeItem(draftKey(docId)); }catch(e){ /* 忽略 */ }
}
function getEditorContent(){
  if(isUniverDoc()) return reqUniverView ? JSON.stringify(reqUniverView.getSnapshot()) : "";
  if(editingMeta.format === "html" && reqEditor) return reqEditor.getContents();
  var ta = $("reqDocMdCanvas");
  return ta ? ta.value : "";
}
function setEditorContent(content, format){
  if(isUniverDoc()){
    /* 草稿恢复：快照 JSON 直接重挂；旧格式草稿按 html 重新转换 */
    var snap = format === "univer" ? parseSnapshot(content) : null;
    return mountReqUniver(snap, snap ? "" : (format === "univer" ? "" : content));
  }
  if(format === "html" && reqEditor){ reqEditor.setContents(content); return; }
  var ta = $("reqDocMdCanvas");
  if(ta){ ta.value = content; renderMarkdownPreview(); }
}

/* ---------- 历史版本：列表、阅读、对比、恢复 ---------- */

var reqDocHistories = [];
var reqDocHistorySel = null;
var reqDocHistoryTarget = "current";
/* 历史弹窗与编辑器解耦：阅读模式也能打开；docId 记录目标文档，fromReader 决定恢复后回到哪里 */
var reqDocHistoryDocId = null;
var reqDocHistoryFromReader = false;
var reqDocHistoryCanRestore = true;
var reqDocHistoryCurrent = null;
var reqDocHistoryCurrentNo = 1;
var reqDocHistoryMode = "compare";
var reqDocHistoryView = "split";
var reqDocHistoryShowAll = false;
var reqDocHistoryExpanded = {};
var reqDocHistoryHunk = 0;
var reqDocHistoryRows = null;
var reqDocHistoryRowsKey = "";
var reqDocHistorySeq = 0;
var reqDocHistoryLoadSeq = 0;
var reqDocHistoryDocs = {};
var reqDocHistoryPending = {};
var reqDocHistoryScrollTick = false;

function reqDocHistoryFind(id){
  for(var i = 0; i < reqDocHistories.length; i++){
    if(reqDocHistories[i].id === id) return reqDocHistories[i];
  }
  return null;
}
function reqDocHistoryCurrentDoc(){
  if(!reqDocHistoryCurrent) return null;
  return {
    key: "current",
    title: reqDocHistoryCurrent.title,
    content: reqDocHistoryCurrent.content,
    format: reqDocHistoryCurrent.format,
    versionNo: reqDocHistoryCurrentNo,
    savedBy: reqDocHistoryCurrent.owner || "",
    createdAt: reqDocHistoryCurrent.updatedAt || ""
  };
}
function reqDocHistoryDocSync(key){
  if(key === "current") return reqDocHistoryCurrentDoc();
  return reqDocHistoryDocs[key] || null;
}
function reqDocHistoryDoc(key){
  if(key === "current") return Promise.resolve(reqDocHistoryCurrentDoc());
  if(reqDocHistoryDocs[key]) return Promise.resolve(reqDocHistoryDocs[key]);
  if(reqDocHistoryPending[key]) return reqDocHistoryPending[key];
  var docId = reqDocHistoryDocId;
  var pending = API.get("/api/req-docs/" + encodeURIComponent(docId) + "/history/" + encodeURIComponent(key)).then(function(h){
    var doc = {
      key: key,
      id: h.id,
      versionNo: h.versionNo,
      title: h.title,
      content: h.content,
      format: h.format,
      savedBy: h.savedBy,
      createdAt: h.createdAt
    };
    reqDocHistoryDocs[key] = doc;
    delete reqDocHistoryPending[key];
    return doc;
  }).catch(function(ex){
    delete reqDocHistoryPending[key];
    throw ex;
  });
  reqDocHistoryPending[key] = pending;
  return pending;
}

/* 历史版本子页（#/dochistory?doc=&version=&mode=&view=&target=）：
   原来 1080 居中双栏弹框；版本在 URL 里，刷新、分享、后退都回到同一版。 */
function parseDocHistoryRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "dochistory") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  return {
    doc: p.get("doc") || "",
    version: p.get("version") || "",
    target: p.get("target") || "current",
    mode: p.get("mode") === "read" ? "read" : "compare",
    view: p.get("view") === "unified" ? "unified" : "split",
    from: p.get("from") === "read" ? "read" : "edit"
  };
}
function docHistoryHash(r){
  var h = "#/dochistory?doc=" + encodeURIComponent(r.doc || "");
  if(r.version) h += "&version=" + encodeURIComponent(r.version);
  if(r.target && r.target !== "current") h += "&target=" + encodeURIComponent(r.target);
  if(r.mode && r.mode !== "compare") h += "&mode=" + r.mode;
  if(r.view && r.view !== "split") h += "&view=" + r.view;
  /* 从阅读视图进来的，返回时回到阅读分栏；写在链接里，刷新后才不会退到编辑页 */
  if(r.from === "read") h += "&from=read";
  return h;
}
/* 换版本只改地址栏、不压历史：后退回到文档，而不是在版本之间倒退 */
function syncDocHistoryHash(){
  if(activeView !== "dochistory" || !reqDocHistoryDocId) return;
  var h = docHistoryHash({
    doc: reqDocHistoryDocId,
    version: reqDocHistorySel || "",
    target: reqDocHistoryTarget,
    mode: reqDocHistoryMode,
    view: reqDocHistoryView,
    from: reqDocHistoryFromReader ? "read" : "edit"
  });
  if(window.location.hash === h) return;
  try{ history.replaceState(null, "", h); }catch(e){ /* 地址栏受限时页面仍可用 */ }
}
function docHistoryEmpty(msg){
  var list = $("reqDocHistoryList");
  if(list) list.innerHTML = '<div class="rh-empty">' + esc(msg) + '</div>';
  reqDocHistoryResetPane(msg);
  var nameEl = $("docHistoryDocName");
  if(nameEl) nameEl.textContent = "—";
  var projEl = $("docHistoryProject");
  if(projEl) projEl.textContent = "";
}

function openReqDocHistory(docId, opts){
  docId = docId || editingDocId;
  if(!docId) return;
  opts = opts || {};
  reqDocHistoryDocId = docId;
  reqDocHistoryFromReader = !!opts.fromReader;
  reqDocHistoryCanRestore = opts.canRestore != null ? !!opts.canRestore : !(reqDocReadOnly || reqDocOwnerLocked);
  var h = docHistoryHash({
    doc: docId,
    mode: "compare",
    view: window.innerWidth < 900 ? "unified" : "split",
    from: reqDocHistoryFromReader ? "read" : "edit"
  });
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("dochistory");
}

/* 返回文档：记住是从阅读视图还是编辑页打开的，回到同一处 */
function backFromDocHistory(){
  var docId = reqDocHistoryDocId, fromReader = reqDocHistoryFromReader;
  reqDocHistoryDocId = null;
  if(!docId){ showView("requirements"); return; }
  var h = "#/requirements?doc=" + encodeURIComponent(docId);
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("requirements").then(function(){
    if(activeView !== "requirements") return;
    if(fromReader){
      /* 深链进页面会顺手打开编辑页；从阅读态来的要把它撤掉，回到阅读分栏 */
      reqDocOpenSeq++;
      closeReqDocEditor();
      setReqDocMode("read");
      loadReqDocSplitDoc(docId);
    }else if(!isReqDocEditing() || editingDocId !== docId){
      openReqDocEditor(docId);
    }
  });
}

function enterDocHistoryView(){
  var route = parseDocHistoryRoute() || { doc:"", version:"", target:"current", mode:"compare",
    view: window.innerWidth < 900 ? "unified" : "split", from:"edit" };
  var docId = route.doc || reqDocHistoryDocId;
  if(!docId){ docHistoryEmpty("没有指定文档；从文档页的「历史」进入。"); return; }
  reqDocHistoryDocId = docId;
  reqDocHistoryFromReader = route.from === "read";
  var seq = ++reqDocHistorySeq;
  reqDocHistoryHistoriesReset();
  reqDocHistoryView = route.view;
  var nameEl = $("docHistoryDocName");
  if(nameEl) nameEl.textContent = "加载中…";
  var projEl = $("docHistoryProject");
  if(projEl) projEl.textContent = "";
  var list = $("reqDocHistoryList");
  if(list) list.innerHTML = '<div class="rh-empty">加载中…</div>';
  var count = $("reqDocHistoryCount");
  if(count) count.textContent = "";
  reqDocHistoryResetPane("加载中…");
  Promise.all([
    API.getAllPages("/api/req-docs/" + encodeURIComponent(docId) + "/history"),
    API.get("/api/req-docs/" + encodeURIComponent(docId))
  ]).then(function(results){
    if(seq !== reqDocHistorySeq) return;
    var rows = results[0] || [];
    var doc = results[1] || null;
    rows.sort(function(a, b){ return (Number(b.versionNo) || 0) - (Number(a.versionNo) || 0); });
    reqDocHistories = rows;
    reqDocHistoryCurrent = doc;
    /* 直接进链接时没有编辑态可参考，权限按文档所属项目与负责人现算 */
    reqDocHistoryCanRestore = !!(doc && canEditReq(doc.reqId) && canEditDoc(doc));
    var maxNo = 0;
    for(var i = 0; i < rows.length; i++) maxNo = Math.max(maxNo, Number(rows[i].versionNo) || 0);
    reqDocHistoryCurrentNo = maxNo + 1;
    if(nameEl) nameEl.textContent = doc ? (doc.title || "未命名文档") : "文档不可见";
    if(projEl){
      var projName = doc && doc.reqId ? reqNameById(doc.reqId) : "";
      projEl.textContent = projName ? " · " + projName : "";
    }
    reqDocHistorySel = null;
    for(var j = 0; j < rows.length; j++){
      if(rows[j].id === route.version) reqDocHistorySel = rows[j].id;
    }
    if(!reqDocHistorySel && rows.length) reqDocHistorySel = rows[0].id;
    reqDocHistoryTarget = "current";
    if(route.target !== "current"){
      for(var k = 0; k < rows.length; k++){
        if(rows[k].id === route.target) reqDocHistoryTarget = rows[k].id;
      }
    }
    reqDocHistoryMode = rows.length ? route.mode : "read";
    renderReqDocHistoryList();
    reqDocHistoryLoadAndRender(false);
    syncDocHistoryHash();
  }).catch(function(ex){
    if(seq !== reqDocHistorySeq) return;
    docHistoryEmpty(ex.message || "历史版本加载失败");
    if(nameEl) nameEl.textContent = "文档不可见";
  });
}

/* 同一子页内改地址栏（后退 / 手动改 hash）时对齐版本与视图 */
function refreshDocHistoryFromHash(){
  var route = parseDocHistoryRoute();
  if(!route) return;
  if(route.doc !== reqDocHistoryDocId){ enterDocHistoryView(); return; }
  reqDocHistoryFromReader = route.from === "read";
  if(route.mode !== reqDocHistoryMode){
    reqDocHistoryMode = route.mode;
    renderReqDocHistory(false);
  }
  if(route.view !== reqDocHistoryView){
    reqDocHistoryView = route.view;
    renderReqDocHistory(true);
  }
  if(route.version && route.version !== reqDocHistorySel){
    reqDocHistorySel = route.version;
    if(reqDocHistoryTarget === reqDocHistorySel) reqDocHistoryTarget = "current";
    reqDocHistoryExpanded = {};
    reqDocHistoryHunk = 0;
    renderReqDocHistoryList();
    reqDocHistoryLoadAndRender(false);
  }
}
function reqDocHistoryHistoriesReset(){
  reqDocHistories = [];
  reqDocHistorySel = null;
  reqDocHistoryTarget = "current";
  reqDocHistoryCurrent = null;
  reqDocHistoryCurrentNo = 1;
  reqDocHistoryMode = "compare";
  reqDocHistoryShowAll = false;
  reqDocHistoryExpanded = {};
  reqDocHistoryHunk = 0;
  reqDocHistoryRows = null;
  reqDocHistoryRowsKey = "";
  reqDocHistoryDocs = {};
  reqDocHistoryPending = {};
  reqDocHistoryLoadSeq++;
}
function reqDocHistoryShowPaneMessage(msg){
  ["reqDocHistoryDiffShell", "reqDocHistoryDiffFoot", "reqDocHistoryIdentical",
    "reqDocHistoryRead", "reqDocHistoryMetaDiff"].forEach(function(id){
    var el = $(id);
    if(el) el.hidden = true;
  });
  var empty = $("reqDocHistoryEmpty");
  if(empty){
    empty.hidden = false;
    empty.innerHTML = msg ? esc(msg) : "";
  }
}
function reqDocHistoryResetPane(msg){
  var cmpBar = $("reqDocHistoryCmpBar");
  if(cmpBar) cmpBar.hidden = true;
  reqDocHistoryShowPaneMessage(msg);
  var title = $("reqDocHistoryVerTitle");
  if(title) title.textContent = "—";
  var who = $("reqDocHistoryWho");
  if(who) who.textContent = "";
}
function reqDocHistoryShowLoading(){
  reqDocHistoryResetPane("加载中…");
}
function reqDocHistoryLoadAndRender(preserveScroll){
  var loadId = ++reqDocHistoryLoadSeq;
  var baseKey = reqDocHistorySel;
  if(!baseKey){ renderReqDocHistory(preserveScroll); return; }
  var targetKey = reqDocHistoryTarget;
  var needs = [];
  if(!reqDocHistoryDocs[baseKey]) needs.push(reqDocHistoryDoc(baseKey));
  if(targetKey !== "current" && !reqDocHistoryDocs[targetKey]) needs.push(reqDocHistoryDoc(targetKey));
  if(needs.length) reqDocHistoryShowLoading();
  Promise.all(needs).then(function(){
    if(loadId !== reqDocHistoryLoadSeq) return;
    renderReqDocHistory(preserveScroll);
  }).catch(function(ex){
    if(loadId !== reqDocHistoryLoadSeq) return;
    reqDocHistoryResetPane(ex.message || "版本正文加载失败");
  });
}
function renderReqDocHistoryList(){
  var list = $("reqDocHistoryList");
  var count = $("reqDocHistoryCount");
  if(!list) return;
  if(!reqDocHistories.length){
    list.innerHTML = '<div class="rh-empty">还没有历史快照<br>保存正文后自动生成</div>';
    if(count) count.textContent = "";
    return;
  }
  if(count) count.textContent = reqDocHistories.length + " 版";
  list.innerHTML = reqDocHistories.map(function(h, i){
    return '<button class="rh-vrow' + (h.id === reqDocHistorySel ? ' active' : '') + '" type="button" data-history-id="' + esc(h.id) + '">'
      + '<span class="top"><span class="rh-vno">第 ' + esc(h.versionNo) + ' 版</span>'
      + (i === 0 ? '<span class="rh-vchip">最近快照</span>' : '')
      + '</span>'
      + '<span class="rh-vtitle">' + esc(h.title || "未命名") + '</span>'
      + '<span class="rh-vmeta">' + esc(h.savedBy || "—") + ' · ' + esc(fmtTs(h.createdAt) || "—") + '</span>'
      + '</button>';
  }).join("");
}
function renderReqDocHistoryPreview(h, box){
  if(!box) return;
  var prep = h.format === "univer"
    ? Promise.all([loadMarkdownLib(), ensureVendor()])
    : loadMarkdownLib();
  prep.then(function(){
    if(!box.isConnected) return;
    var html;
    if(h.format === "univer"){
      var snap = parseSnapshot(h.content);
      html = snap ? snapshotToHtml(snap) : "";
    }else if(h.format === "markdown"){
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
function renderReqDocHistoryPickers(base, target){
  var baseSel = $("reqDocHistoryBase");
  var targetSel = $("reqDocHistoryTarget");
  var title = $("reqDocHistoryVerTitle");
  var who = $("reqDocHistoryWho");
  var restore = $("reqDocHistoryRestore");
  var modeSeg = $("reqDocHistoryModeSeg");
  if(modeSeg) modeSeg.hidden = !reqDocHistories.length;
  if(baseSel){
    baseSel.disabled = !reqDocHistories.length;
    baseSel.innerHTML = reqDocHistories.map(function(h){
      return '<option value="' + esc(h.id) + '"' + (h.id === reqDocHistorySel ? ' selected' : '') + '>第 '
        + esc(h.versionNo) + ' 版 · ' + esc(fmtTs(h.createdAt) || "—") + '</option>';
    }).join("");
  }
  if(targetSel){
    targetSel.disabled = !reqDocHistories.length;
    var options = '<option value="current"' + (reqDocHistoryTarget === "current" ? ' selected' : '') + '>当前 · 第 '
      + reqDocHistoryCurrentNo + ' 版</option>';
    options += reqDocHistories.map(function(h){
      return '<option value="' + esc(h.id) + '"' + (h.id === reqDocHistoryTarget ? ' selected' : '') + '>第 '
        + esc(h.versionNo) + ' 版 · ' + esc(fmtTs(h.createdAt) || "—") + '</option>';
    }).join("");
    targetSel.innerHTML = options;
  }
  if(title) title.textContent = base ? ("第 " + base.versionNo + " 版") : "—";
  if(who) who.textContent = base
    ? ((base.savedBy || "—") + " · " + (fmtTs(base.createdAt) || "—") + (base.key === "current" ? "（当前）" : ""))
    : "";
  if(restore){
    restore.style.display = (reqDocHistories.length && reqDocHistoryCanRestore) ? "" : "none";
    restore.textContent = base ? ("恢复第 " + base.versionNo + " 版") : "恢复此版本";
    restore.disabled = !base || base.key === "current";
  }
  var modeBtns = document.querySelectorAll("#reqDocHistoryModeSeg button");
  for(var i = 0; i < modeBtns.length; i++){
    modeBtns[i].setAttribute("aria-pressed", String(modeBtns[i].dataset.rhMode === reqDocHistoryMode));
  }
  var viewBtns = document.querySelectorAll("#reqDocHistoryViewSeg button");
  for(var j = 0; j < viewBtns.length; j++){
    viewBtns[j].setAttribute("aria-pressed", String(viewBtns[j].dataset.rhView === reqDocHistoryView));
  }
  var foldAll = $("reqDocHistoryFoldAll");
  if(foldAll){
    foldAll.textContent = reqDocHistoryShowAll ? "仅看差异" : "展开全部";
    foldAll.setAttribute("aria-pressed", String(!!reqDocHistoryShowAll));
  }
}
function reqDocHistorySegsHtml(segs, cls){
  return segs.map(function(seg){
    return seg.c ? '<mark class="' + cls + '">' + esc(seg.t) + '</mark>' : esc(seg.t);
  }).join("");
}
function renderReqDocHistoryMeta(base, target){
  var box = $("reqDocHistoryMetaDiff");
  if(!box) return;
  var a = String(base.title || "");
  var b = String(target.title || "");
  if(a === b){
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  var diff = textDiff.inlineDiff(a, b);
  if(!diff){
    box.innerHTML = '<span class="k">标题</span><span>' + esc(a || "（空）") + '</span><span>→</span><span>' + esc(b || "（空）") + '</span>';
    return;
  }
  box.innerHTML = '<span class="k">标题</span>'
    + '<span>' + reqDocHistorySegsHtml(diff.old, "old") + '</span>'
    + '<span>→</span>'
    + '<span>' + reqDocHistorySegsHtml(diff.new, "new") + '</span>';
}
function reqDocHistorySplitRowHtml(r, hunkStart, hunkIndex){
  var oldSign = (r.type === "del" || r.type === "mod" || r.type === "deladd") ? "-" : "";
  var newSign = (r.type === "add" || r.type === "mod" || r.type === "deladd") ? "+" : "";
  var oldTxt = r.oldNo == null ? "" : (r.inline ? reqDocHistorySegsHtml(r.inline.old, "rh-mk-del") : esc(r.old));
  var newTxt = r.newNo == null ? "" : (r.inline ? reqDocHistorySegsHtml(r.inline.new, "rh-mk-add") : esc(r.new));
  return '<div class="rh-drow' + (textDiff.isChanged(r) ? ' changed' : '') + '"' + (hunkStart ? ' data-hunk="' + hunkIndex + '"' : '') + '>'
    + '<div class="rh-ln' + (r.oldNo == null ? ' blank' : '') + '">' + (r.oldNo == null ? '' : r.oldNo) + '</div>'
    + '<div class="rh-txt' + (oldSign ? ' delbg' : '') + (r.oldNo == null ? ' empty' : '') + '"><span class="sign">' + oldSign + '</span>' + oldTxt + '</div>'
    + '<div class="rh-ln' + (r.newNo == null ? ' blank' : '') + '">' + (r.newNo == null ? '' : r.newNo) + '</div>'
    + '<div class="rh-txt' + (newSign ? ' addbg' : '') + (r.newNo == null ? ' empty' : '') + '"><span class="sign">' + newSign + '</span>' + newTxt + '</div>'
    + '</div>';
}
function reqDocHistoryUnifiedRowHtml(r, hunkStart, hunkIndex){
  var out = "";
  if(r.type === "same"){
    return '<div class="rh-drow uni">'
      + '<div class="rh-ln">' + r.oldNo + '</div>'
      + '<div class="rh-ln">' + r.newNo + '</div>'
      + '<div class="rh-txt"><span class="sign"> </span>' + esc(r.old) + '</div>'
      + '</div>';
  }
  if(r.type === "del" || r.type === "mod" || r.type === "deladd"){
    out += '<div class="rh-drow uni changed"' + (hunkStart ? ' data-hunk="' + hunkIndex + '"' : '') + '>'
      + '<div class="rh-ln">' + (r.oldNo == null ? '' : r.oldNo) + '</div>'
      + '<div class="rh-ln blank"></div>'
      + '<div class="rh-txt delbg"><span class="sign">-</span>' + (r.inline ? reqDocHistorySegsHtml(r.inline.old, "rh-mk-del") : esc(r.old)) + '</div>'
      + '</div>';
    hunkStart = false;
  }
  if(r.type === "add" || r.type === "mod" || r.type === "deladd"){
    out += '<div class="rh-drow uni changed"' + (hunkStart ? ' data-hunk="' + hunkIndex + '"' : '') + '>'
      + '<div class="rh-ln blank"></div>'
      + '<div class="rh-ln">' + (r.newNo == null ? '' : r.newNo) + '</div>'
      + '<div class="rh-txt addbg"><span class="sign">+</span>' + (r.inline ? reqDocHistorySegsHtml(r.inline.new, "rh-mk-add") : esc(r.new)) + '</div>'
      + '</div>';
  }
  return out;
}
function reqDocHistoryFoldHtml(block){
  var olds = [], news = [];
  block.rows.forEach(function(row){
    if(row.oldNo != null) olds.push(row.oldNo);
    if(row.newNo != null) news.push(row.newNo);
  });
  var range = "";
  if(olds.length) range += "旧 " + Math.min.apply(null, olds) + "–" + Math.max.apply(null, olds);
  if(news.length) range += (range ? " / " : "") + "新 " + Math.min.apply(null, news) + "–" + Math.max.apply(null, news);
  return '<button class="rh-dfold" type="button" data-rh-fold="' + block.key + '">'
    + '<span class="chev">▸</span>展开 <b>' + block.rows.length + '</b> 行未改动'
    + '<span class="range">' + range + '</span></button>';
}
function reqDocHistoryHeadHtml(base, target){
  var targetLabel = target.key === "current"
    ? ("当前（第 " + target.versionNo + " 版）")
    : ("第 " + target.versionNo + " 版");
  if(reqDocHistoryView === "split"){
    return '<div class="rh-dhead">'
      + '<div class="dh-ln"></div>'
      + '<div class="dh-side">旧 · 第 ' + base.versionNo + ' 版 <span>' + esc(base.savedBy || "—") + ' · ' + esc(fmtTs(base.createdAt) || "—") + '</span></div>'
      + '<div class="dh-ln"></div>'
      + '<div class="dh-side">新 · ' + esc(targetLabel) + ' <span>' + esc(target.savedBy || "—") + ' · ' + esc(fmtTs(target.createdAt) || "—") + '</span></div>'
      + '</div>';
  }
  return '<div class="rh-dhead uni">'
    + '<div class="dh-ln"></div>'
    + '<div class="dh-ln"></div>'
    + '<div class="dh-side">旧 第 ' + base.versionNo + ' 版 → ' + esc(targetLabel) + '</div>'
    + '</div>';
}
function reqDocHistoryUpdateHunkLabel(){
  var wrap = $("reqDocHistoryDiff");
  var marks = wrap ? wrap.querySelectorAll("[data-hunk]") : [];
  var now = $("reqDocHistoryHunkNow");
  var all = $("reqDocHistoryHunkAll");
  if(now) now.textContent = marks.length ? (reqDocHistoryHunk + 1) : 0;
  if(all) all.textContent = marks.length;
  var prev = $("reqDocHistoryPrev");
  var next = $("reqDocHistoryNext");
  if(prev) prev.disabled = reqDocHistoryHunk <= 0;
  if(next) next.disabled = reqDocHistoryHunk >= marks.length - 1;
}
function reqDocHistoryBuildOverview(){
  var ovl = $("reqDocHistoryOvl");
  var wrap = $("reqDocHistoryDiff");
  if(!ovl || !wrap) return;
  ovl.innerHTML = "";
  var marks = wrap.querySelectorAll("[data-hunk]");
  var total = wrap.scrollHeight || 1;
  for(var i = 0; i < marks.length; i++){
    var row = marks[i];
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "rh-ovmk";
    var add = row.querySelector(".rh-txt.addbg");
    var del = row.querySelector(".rh-txt.delbg");
    if(add && !del) dot.className += " add";
    else if(del && !add) dot.className += " del";
    dot.style.top = Math.max(0, Math.min(99.4, (row.offsetTop / total) * 100)) + "%";
    dot.setAttribute("aria-label", "跳到第 " + (i + 1) + " 处差异");
    dot.dataset.rhOv = String(i);
    ovl.appendChild(dot);
  }
}
function reqDocHistoryJumpHunk(delta){
  var wrap = $("reqDocHistoryDiff");
  if(!wrap) return;
  var marks = wrap.querySelectorAll("[data-hunk]");
  if(!marks.length) return;
  reqDocHistoryHunk = Math.max(0, Math.min(marks.length - 1, reqDocHistoryHunk + delta));
  marks[reqDocHistoryHunk].scrollIntoView({ block: "center", behavior: "smooth" });
  reqDocHistoryUpdateHunkLabel();
}
function reqDocHistoryEnsureHunkVisible(){
  var wrap = $("reqDocHistoryDiff");
  if(!wrap) return;
  var marks = wrap.querySelectorAll("[data-hunk]");
  if(!marks.length) return;
  var top = wrap.scrollTop + 70;
  var idx = 0;
  for(var i = 0; i < marks.length; i++){
    if(marks[i].offsetTop <= top) idx = i;
  }
  if(idx !== reqDocHistoryHunk){
    reqDocHistoryHunk = idx;
    reqDocHistoryUpdateHunkLabel();
  }
}
function renderReqDocHistory(preserveScroll){
  var readBox = $("reqDocHistoryRead");
  var diffShell = $("reqDocHistoryDiffShell");
  var diffFoot = $("reqDocHistoryDiffFoot");
  var identical = $("reqDocHistoryIdentical");
  var cmpBar = $("reqDocHistoryCmpBar");
  var metaBox = $("reqDocHistoryMetaDiff");
  var empty = $("reqDocHistoryEmpty");
  var statsBox = $("reqDocHistoryStats");
  var footStat = $("reqDocHistoryFootStat");
  var base = reqDocHistoryDocSync(reqDocHistorySel);
  var target = reqDocHistoryDocSync(reqDocHistoryTarget);
  if(!base && !reqDocHistories.length && reqDocHistoryCurrent){
    reqDocHistoryMode = "read";
    base = reqDocHistoryCurrentDoc();
    target = base;
  }
  if(!base){
    reqDocHistoryResetPane(reqDocHistories.length ? "版本内容加载失败" : "还没有历史快照：保存正文后自动生成");
    return;
  }
  if(!target) target = reqDocHistoryCurrentDoc();
  if(!target){
    reqDocHistoryResetPane("当前正文加载失败");
    return;
  }
  renderReqDocHistoryList();
  renderReqDocHistoryPickers(base, target);
  if(empty) empty.hidden = true;
  var readMode = reqDocHistoryMode === "read";
  var noHistory = !reqDocHistories.length;
  if(cmpBar) cmpBar.hidden = readMode || noHistory;
  if(diffShell) diffShell.hidden = readMode || noHistory;
  if(diffFoot) diffFoot.hidden = readMode || noHistory;
  if(identical) identical.hidden = true;
  if(metaBox) metaBox.hidden = true;
  if(readBox) readBox.hidden = !readMode;
  if(readMode){
    var readNote = base.key === "current"
      ? '正在阅读当前版本 · ' + esc(base.savedBy || "—") + ' · ' + esc(fmtTs(base.createdAt) || "—")
      : '正在阅读第 ' + base.versionNo + ' 版 · ' + esc(base.savedBy || "—") + ' · ' + esc(fmtTs(base.createdAt) || "—")
        + '（快照内容，不会影响当前正文）';
    readBox.innerHTML = '<div class="rh-read-note">' + readNote + '</div>'
      + '<div class="markdown-body" id="reqDocHistoryReadBody"></div>';
    renderReqDocHistoryPreview(base, $("reqDocHistoryReadBody"));
    return;
  }
  renderReqDocHistoryMeta(base, target);

  var oldLines = textDiff.docLines(base);
  var newLines = textDiff.docLines(target);
  if(textDiff.tooLarge(oldLines, newLines)){
    reqDocHistoryShowPaneMessage("文档超过 " + textDiff.MAX_LINES + " 行，暂不支持结构化差异对比；可切到「阅读」逐版查看。");
    if(statsBox) statsBox.innerHTML = '<span class="hunks">文档过长</span>';
    if(footStat) footStat.textContent = "";
    return;
  }
  var key = (base.key || "current") + "|" + (target.key || "current");
  if(key !== reqDocHistoryRowsKey){
    reqDocHistoryRows = textDiff.buildRows(oldLines, newLines);
    reqDocHistoryRowsKey = key;
  }
  var rows = reqDocHistoryRows.rows;
  var stats = textDiff.rowStats(rows);
  if(!rows.some(textDiff.isChanged)){
    if(diffShell) diffShell.hidden = true;
    if(diffFoot) diffFoot.hidden = true;
    if(identical) identical.hidden = false;
    if(statsBox) statsBox.innerHTML = '<span class="add">+0</span><span class="del">−0</span><span class="hunks">无差异</span>';
    if(footStat) footStat.textContent = "+0 −0";
    return;
  }
  var blocks = textDiff.buildBlocks(rows, { showAll: reqDocHistoryShowAll });
  var prepared = textDiff.prepareBlocks(blocks, reqDocHistoryExpanded);
  if(statsBox){
    statsBox.innerHTML = '<span class="add">+' + stats.add + '</span><span class="del">−' + stats.del + '</span>'
      + '<span class="hunks">' + prepared.hunks + ' 处差异</span>';
  }
  if(footStat) footStat.textContent = '+' + stats.add + ' −' + stats.del;

  var wrap = $("reqDocHistoryDiff");
  if(!wrap) return;
  var scrollTop = preserveScroll ? wrap.scrollTop : 0;
  var html = reqDocHistoryHeadHtml(base, target);
  prepared.items.forEach(function(item){
    if(item.kind === "gap"){
      html += reqDocHistoryFoldHtml(item.block);
      return;
    }
    html += reqDocHistoryView === "split"
      ? reqDocHistorySplitRowHtml(item.row, item.hunkStart, item.hunkIndex)
      : reqDocHistoryUnifiedRowHtml(item.row, item.hunkStart, item.hunkIndex);
  });
  wrap.innerHTML = html;
  if(diffShell) diffShell.hidden = false;
  if(diffFoot) diffFoot.hidden = false;
  wrap.scrollTop = scrollTop;
  reqDocHistoryHunk = Math.max(0, Math.min(reqDocHistoryHunk, prepared.hunks - 1));
  reqDocHistoryUpdateHunkLabel();
  reqDocHistoryBuildOverview();
}
function restoreReqDocHistory(){
  if(!reqDocHistoryDocId || !reqDocHistorySel){ toast("先选择一个历史版本", "warn"); return; }
  if(!reqDocHistoryCanRestore){ toast("你对该项目只有查看权限", "warn"); return; }
  var entry = reqDocHistoryFind(reqDocHistorySel);
  if(!entry){ toast("先选择一个历史版本", "warn"); return; }
  var docId = reqDocHistoryDocId, historyId = reqDocHistorySel;
  var fromReader = reqDocHistoryFromReader;
  UI.showConfirm({
    title: "恢复历史版本",
    msg: "当前正文会先留一版快照，再替换为第 " + entry.versionNo + " 版的内容"
      + (fromReader ? "。" : "（未保存的修改会丢失）。") + "确定恢复？",
    okText: "恢复"
  }).then(function(ok){
    if(!ok) return;
    API.post("/api/req-docs/" + encodeURIComponent(docId) + "/restore", { historyId: historyId }).then(function(){
      toast("已恢复到第 " + entry.versionNo + " 版", "fs");
      loadReqDocs(true);
      backFromDocHistory();
    }).catch(function(ex){ toast(ex.message || "恢复失败", "bad"); });
  });
}

function reqTocRoot(){
  if(isMarkdownDoc()) return $("reqDocMdPreview");
  if(isUniverDoc()) return null;   // 在线文档直接从快照取标题，没有可查询的 DOM
  return document.querySelector(".reqdoc-editbody .sun-editor-editable");
}
function collectToc(){
  var root = reqTocRoot();
  var items = [];
  if(isUniverDoc()){
    var heads = reqUniverView ? snapshotHeadings(reqUniverView.getSnapshot()) : [];
    heads.forEach(function(h, i){
      items.push({ anchor: "u" + i, level: h.level, text: h.text, depth: 0, parent: null, hasChild: false, startIndex: h.startIndex });
    });
  }else if(root){
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
  if(isUniverDoc()){
    var hit = null;
    for(var i = 0; i < tocItems.length; i++) if(tocItems[i].anchor === anchor) hit = tocItems[i];
    if(hit && reqUniverView) reqUniverView.scrollToIndex(hit.startIndex);
    markTocActive(anchor);
    return;
  }
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
  if(isMarkdownDoc()) return $("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "";
  if(isUniverDoc()) return reqUniverView ? JSON.stringify(reqUniverView.getSnapshot()) : "";
  return reqEditor ? reqEditor.getContents(true) : "";
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
/* opts.silent：关闭链路的保存，成功后不弹「仍可发布」提示（由关闭弹窗决定后续动作） */
function saveReqDoc(opts){
  var silent = !!(opts && opts.silent);
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return Promise.resolve(null); }
  if(reqDocSaving) return reqDocSavePromise || Promise.resolve(null);
  var title = (editingMeta.title || "").trim();
  var reqId = editingMeta.reqId;
  if(!title){
    toast("这份文档缺少标题，请回到列表重新创建", "warn");
    return Promise.resolve(null);
  }
  var md = isMarkdownDoc();
  if(!md && isUniverDoc() && !reqUniverView){
    toast("正文编辑器还在加载，请稍候再保存", "warn");
    return Promise.resolve(null);
  }
  if(!md && !isUniverDoc() && !reqEditor){
    toast("正文编辑器还在加载，请稍候再保存", "warn");
    return Promise.resolve(null);
  }
  var parentId = $("reqDocParent") ? $("reqDocParent").value : "";
  var categoryId = $("reqDocCategory") ? $("reqDocCategory").value : (editingMeta.categoryId || "");
  var content = currentReqDocContent();
  var body = {
    reqId: reqId || null,
    title: title,
    content: content,
    status: editingMeta.status || "draft",
    format: md ? "markdown" : (isUniverDoc() ? "univer" : "html"),
    docType: $("reqDocType").value,
    parentId: parentId || null,
    categoryId: categoryId || "",
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
    if(doc.publishedAt !== undefined) editingMeta.publishedAt = doc.publishedAt || null;
    /* 分类/归属可能随保存变化：即便用户还在输入（不走 fillReqDocEditor），元数据也要对齐服务器返回值 */
    editingMeta.categoryId = doc.categoryId || "";
    editingMeta.reqId = doc.reqId || "";
    /* 保存请求发出后用户继续输入：保留当前正文，只把基线推进到刚保存的版本 */
    if(currentReqDocContent() !== content){
      if($("reqDocSaved")) $("reqDocSaved").textContent = "已保存，仍有未保存的修改";
    }else{
      reqDocDirty = false;
      clearDraftOnSave(doc.id);
      fillReqDocEditor(doc, { keepBody: isUniverDoc() });
    }
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名文档");
    refreshReqDocPublishBtn();
    if(silent){
      /* 关闭链路的保存：成功后直接关闭，发布与否由关闭弹窗上的按钮决定 */
    }else if(editingMeta.publishedAt){
      toast("文档已保存", "fs");
    }else{
      /* 保存 ≠ 发布：不打断写作，但把「仍是草稿」和一次性「发布」动作一起递到手边。
         提示在屏幕上停留 8 秒，点的时候要确认还是这篇文档，避免发布到后来打开的文档 */
      UI.toastAction("已保存为草稿 · 项目成员暂不可见", "发布", function(){
        if(editingDocId !== doc.id){ toast("已切换文档，没有发布「" + (doc.title || "原文档") + "」", "warn"); return; }
        reqDocSetPublished(true);
      }, "fs", 8000);
    }
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
    okText: "删除文档"
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
/* 编辑器导入：解析成预览弹窗，确认后才写入正文；取消则正文保持不变 */
var importPreviewConfirm = null;
function closeDocImportPreview(){
  importPreviewConfirm = null;
  if($("dlgDocImportPreview")) UI.closeModal($("dlgDocImportPreview"));
  if($("docImportPreviewFrame")) $("docImportPreviewFrame").removeAttribute("srcdoc");
}
function openDocImportPreview(file, html, label, onConfirm){
  importPreviewConfirm = onConfirm || null;
  if($("docImportPreviewMeta")) $("docImportPreviewMeta").textContent = docImportMetaText(file, label, html);
  if($("docImportPreviewFrame")) $("docImportPreviewFrame").srcdoc = docPreviewDocument(html);
  UI.openModal($("dlgDocImportPreview"));
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
  if(isUniverDoc()){
    importUniverFile(f, kind);
    return;
  }
  if(kind === "word"){
    toast("正在解析 Word 文档…", "info");
    fetchWordImport(f).then(function(data){
      var html = data.content || "";
      openDocImportPreview(f, html, "Word → 富文本", function(){
        applyImportedHtml(f.name, html);
      });
    }).catch(function(ex){ toast(ex.message || "导入失败", "bad"); });
    return;
  }
  readTextFile(f).then(function(text){
    if(kind === "html"){
      loadMarkdownLib().then(function(){
        openDocImportPreview(f, window.DOMPurify.sanitize(text), "HTML", function(){
          applyImportedText(f.name, text, "html");
        });
      }).catch(function(ex){ toast(ex.message || "预览组件加载失败", "bad"); });
      return;
    }
    if(reqDocFileExt(f.name) === "txt"){
      openDocImportPreview(f, "<pre>" + esc(text) + "</pre>", "纯文本", function(){
        applyImportedText(f.name, text, "markdown");
      });
      return;
    }
    loadMarkdownLib().then(function(){
      var html = "";
      try{ html = window.marked.parse(text, { gfm: true, breaks: false }); }catch(err){ html = ""; }
      openDocImportPreview(f, window.DOMPurify.sanitize(html), "Markdown", function(){
        applyImportedText(f.name, text, "markdown");
      });
    }).catch(function(ex){ toast(ex.message || "预览组件加载失败", "bad"); });
  }).catch(function(ex){ toast(ex.message || "读取文件失败", "bad"); });
}
/* 在线文档导入：文件统一转成 HTML 后重挂编辑器（确认写入前的预览仍走同一套弹窗） */
function importUniverFile(f, kind){
  var preview = function(html, label, importHtml){
    openDocImportPreview(f, html, label, function(){ importUniverHtml(f.name, importHtml === undefined ? html : importHtml); });
  };
  if(kind === "word"){
    toast("正在解析 Word 文档…", "info");
    fetchWordImport(f).then(function(data){
      preview(data.content || "", "Word → 富文本");
    }).catch(function(ex){ toast(ex.message || "导入失败", "bad"); });
    return;
  }
  readTextFile(f).then(function(text){
    if(kind === "html"){
      loadMarkdownLib().then(function(){
        preview(window.DOMPurify.sanitize(text), "HTML");
      }).catch(function(ex){ toast(ex.message || "预览组件加载失败", "bad"); });
      return;
    }
    if(reqDocFileExt(f.name) === "txt"){
      /* 预览按白底等宽排版展示，写入正文按段落拆分（转换器不认裸 <pre>） */
      preview("<pre>" + esc(text) + "</pre>", "纯文本", plainTextToHtml(text));
      return;
    }
    loadMarkdownLib().then(function(){
      var html = "";
      try{ html = window.marked.parse(text, { gfm: true, breaks: false }); }catch(err){ html = ""; }
      preview(window.DOMPurify.sanitize(html), "Markdown");
    }).catch(function(ex){ toast(ex.message || "预览组件加载失败", "bad"); });
  }).catch(function(ex){ toast("读取文件失败", "bad"); });
}
function plainTextToHtml(text){
  return String(text || "").split(/\r?\n/).map(function(line){
    return "<p>" + esc(line) + "</p>";
  }).join("");
}
function importUniverHtml(name, html){
  return mountReqUniver(null, html).then(function(view){
    if(!view) return;
    markReqDocDirty();
    updateReqDocCount();
    toast("已导入「" + name + "」，可直接编辑，记得保存", "fs");
  });
}
/* 导入文本类文件：按文件类型切换文档格式，正文直接进入可编辑状态 */
function applyImportedText(name, text, format){
  if(isUniverDoc()){
    if(format === "markdown"){
      loadMarkdownLib().then(function(){
        var html = "";
        try{ html = window.marked.parse(text, { gfm: true, breaks: false }); }catch(e){ html = ""; }
        importUniverHtml(name, html);
      }).catch(function(ex){ toast(ex.message || "预览组件加载失败", "bad"); });
    }else{
      importUniverHtml(name, text);
    }
    return;
  }
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
function applyImportedHtml(name, html){
  if(isUniverDoc()){
    importUniverHtml(name, html);
    return;
  }
  if(editingMeta.format !== "html"){
    editingMeta.format = "html";
    setDocFormatUI("html");
  }
  var apply = function(){
    if(!reqEditor) return;
    setReqEditorContents(html);
    markReqDocDirty();
    rebuildToc();
    updateReqDocCount();
    toast("已导入「" + name + "」，可直接编辑，记得保存", "fs");
  };
  if(reqEditor){
    apply();
  }else{
    ensureEditor().then(function(ed){
      if(!ed || editingMeta.format !== "html") return;
      apply();
    }).catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
  }
}
function exportReqDoc(){
  var md = isMarkdownDoc();
  var univer = isUniverDoc();
  var text = md ? ($("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "")
                : (univer ? (reqUniverView ? snapshotToHtml(reqUniverView.getSnapshot()) : "")
                          : (reqEditor ? reqEditor.getContents(true) : ""));
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
    var toHtml = full.format === "univer"
      ? ensureVendor().then(function(){
          if(seq !== readerExportSeq) return null;
          var snap = parseSnapshot(full.content);
          return snap ? snapshotToHtml(snap) : "";
        })
      : Promise.resolve(full.content || "");
    return toHtml.then(function(text){
      if(text === null) return;
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
    });
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
/* Word 导出：Markdown 先用 marked 转 HTML，再交服务端用 POI 生成真实 .docx（含内嵌图片） */
function downloadBlob(filename, blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 0);
}
function reqDocExportWordHTML(){
  if(isMarkdownDoc()){
    var src = $("reqDocMdCanvas") ? $("reqDocMdCanvas").value : "";
    return loadMarkdownLib().then(function(){
      try{ return window.marked.parse(src, { gfm: true, breaks: false }); }
      catch(e){ return esc(src).replace(/\n/g, "<br>"); }
    });
  }
  if(isUniverDoc()){
    return Promise.resolve(reqUniverView ? snapshotToHtml(reqUniverView.getSnapshot()) : "");
  }
  return Promise.resolve(reqEditor ? reqEditor.getContents(true) : "");
}
function exportReqDocWordFrom(title, html){
  var url = API.url("/api/req-docs/export-docx" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  toast("正在生成 Word 文档…", "info");
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrfCookie() },
    body: JSON.stringify({ title: title || "文档", html: html || "" })
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok){
      return res.json().catch(function(){ return null; }).then(function(json){
        throw new Error((json && json.message) || "导出失败");
      });
    }
    return res.blob();
  }).then(function(blob){
    var name = (title || "文档").replace(/[\\/:*?"<>|]/g, "_") + ".docx";
    downloadBlob(name, blob);
    toast("已导出 " + name, "fs");
  });
}
function exportReqDocWord(){
  reqDocExportWordHTML().then(function(html){
    return exportReqDocWordFrom(editingMeta.title || "文档", html);
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
function exportReqDocWordFromReader(docId){
  var doc = reqDocById(docId);
  if(!doc){ toast("文档信息未加载", "bad"); return; }
  API.get("/api/req-docs/" + encodeURIComponent(docId)).then(function(full){
    var htmlPromise = Promise.resolve(full.content || "");
    if(full.format === "markdown"){
      htmlPromise = loadMarkdownLib().then(function(){
        try{ return window.marked.parse(full.content || "", { gfm: true, breaks: false }); }
        catch(e){ return esc(full.content || "").replace(/\n/g, "<br>"); }
      });
    }else if(full.format === "univer"){
      htmlPromise = ensureVendor().then(function(){
        var snap = parseSnapshot(full.content);
        return snap ? snapshotToHtml(snap) : "";
      });
    }
    return htmlPromise.then(function(html){
      return exportReqDocWordFrom(full.title || "文档", html);
    });
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
/* 保存状态文案：草稿必须带后缀，避免「已保存」被读成「已发布」 */
function refreshReqDocSavedText(){
  var el = $("reqDocSaved");
  if(!el || reqDocDirty) return;   // 脏状态文案由 markReqDocDirty / 保存分支负责
  var base = editingMeta.updatedAt ? ("最后保存 " + fmtTs(editingMeta.updatedAt)) : "尚未保存";
  el.textContent = base + (editingMeta.publishedAt ? "" : " · 草稿");
}
/* 发布/收回发布：草稿仅作者与空间管理员可见，发布后按项目访问规则可见。
   发布是进入可见范围的动作而非每次保存的步骤，因此已发布态用徽标展示，收回收进「更多」菜单 */
function refreshReqDocPublishBtn(){
  var published = !!editingMeta.publishedAt;
  var ro = reqDocReadOnly || reqDocOwnerLocked;
  var b = $("reqDocPublish");
  if(b) b.hidden = published || ro;
  var chip = $("reqDocPubChip");
  if(chip) chip.hidden = !published;
  var un = $("reqDocUnpublish");
  if(un) un.hidden = !published || ro;
}
function reqDocSetPublished(published){
  if(!editingDocId) return Promise.resolve(false);
  if(reqDocReadOnly){ toast("你对该项目只有查看权限", "warn"); return Promise.resolve(false); }
  var btns = ["reqDocPublish", "reqDocUnpublish"].map(function(id){ return $(id); }).filter(Boolean);
  btns.forEach(function(b){ b.disabled = true; });
  return API.put("/api/req-docs/" + encodeURIComponent(editingDocId) + "/publish", { published: !!published }).then(function(d){
    editingMeta.publishedAt = (d && d.publishedAt) || null;
    refreshReqDocPublishBtn();
    refreshReqDocShareBtn();
    refreshReqDocSavedText();
    /* 搜索态下列表来自 reqDocSearchList，两处都要同步，否则徽标仍是「草稿」 */
    [reqDocList, reqDocSearchList].forEach(function(list){
      if(!list) return;
      for(var i = 0; i < list.length; i++){
        if(list[i].id === editingDocId) list[i].publishedAt = editingMeta.publishedAt;
      }
    });
    renderReqDocMode();
    var vis = docVisOf(editingMeta);
    toast(published ? (vis === "members" ? "已发布，仅指定成员可见"
      : vis === "personal" ? "已发布，仅负责人可见"
      : "已发布，项目成员现在可以查看；仍可继续编辑")
      : "已收回发布，文档转为草稿，原分享链接已失效", "fs");
    return true;
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); return false; })
    .then(function(ok){
      btns.forEach(function(b){ b.disabled = false; });
      return ok;
    });
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
  /* 受限可见范围不能外发：公开链接会绕过名单，改回团队共享后才能生成 */
  if(docVisOf(editingMeta) !== "team"){
    toast("仅团队共享文档可生成公开分享链接，请先在「权限说明」里调整可见范围", "warn");
    return;
  }
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
/* 从工作项抽屉里看文档：同页跳转会连带收起抽屉、丢掉正在看的工作项，改在新标签页打开 */
function openReqDocInNewTab(id){
  if(!id) return;
  var url = window.location.origin + window.location.pathname
    + "#/requirements?doc=" + encodeURIComponent(id);
  var win = window.open(url, "_blank");
  /* 弹窗被浏览器拦下时退回同页跳转，至少不丢这次点击 */
  if(!win) openReqDocAndJump(id);
}
/* 深链 #/requirements?doc=<id>：新标签页落到文档正文，而不是文档列表 */
var reqDocDeepLinkDone = false;
function docDeepLinkId(){
  var h = String(window.location.hash || "");
  var q = h.indexOf("?");
  if(q < 0) return "";
  var parts = h.substring(q + 1).split("&");
  for(var i = 0; i < parts.length; i++){
    var kv = parts[i].split("=");
    if(decodeURIComponent(kv[0]) === "doc") return decodeURIComponent(kv[1] || "");
  }
  return "";
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
  syncAssocRead();
}
(function wireRequirementView(){
  /* 新建弹窗的可见范围字段由脚本注入（不改 index.html，避免与并行改动冲突） */
  ensureNewReqDocVisUI();
  /* 正文缩放：阅读页头与编辑页工具栏各一处控件，统一事件委托（阅读页会重绘） */
  document.addEventListener("click", function(e){
    var zb = e.target.closest("#view-requirements [data-doc-zoom]");
    if(!zb) return;
    var act = zb.dataset.docZoom;
    if(act === "out") zoomDocBy(-DOC_ZOOM_STEP);
    else if(act === "in") zoomDocBy(DOC_ZOOM_STEP);
    else resetDocZoom();
  });
  /* Ctrl/⌘ + 滚轮：在正文上直接缩放；不算浏览器页面缩放 */
  function docWheelHandler(e){
    if(!(e.ctrlKey || e.metaKey)) return;
    var t = e.target;
    if(!t || !t.closest) return;
    if(!t.closest("#reqDocReaderBody") && !t.closest("#reqDocRichBody") && !t.closest("#reqDocMdBody")) return;
    e.preventDefault();
    zoomDocBy(e.deltaY < 0 ? DOC_ZOOM_STEP : -DOC_ZOOM_STEP);
  }
  if($("reqDocReader")) $("reqDocReader").addEventListener("wheel", docWheelHandler, { passive: false });
  if($("reqDocEditPage")) $("reqDocEditPage").addEventListener("wheel", docWheelHandler, { passive: false });
  applyDocZoom();

  /* 分类树右键菜单：点菜单外 / Esc / 滚动 时关闭（菜单项点击由菜单自身委托处理，先于此处） */
  document.addEventListener("click", function(e){
    if(reqDocCtxEl && reqDocCtxEl.classList.contains("open") && !e.target.closest(".reqdoc-ctx")) closeReqDocCtx();
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && reqDocCtxEl && reqDocCtxEl.classList.contains("open")) closeReqDocCtx();
  });
  window.addEventListener("scroll", function(){
    if(reqDocCtxEl && reqDocCtxEl.classList.contains("open")) closeReqDocCtx();
  }, true);

  var tree = $("reqDocTree");
  if(tree){
    tree.addEventListener("click", function(e){
      var t = e.target.closest("[data-toggle-proj]");
      if(t){ toggleReqProj(t.dataset.toggleProj); return; }
      /* 分类行：折叠 / 重命名 / 点行折叠。必须先于 .rr-rename 文档判断，
         因为分类重命名按钮也带 .rr-rename 类，否则会被文档重命名分支吞掉 */
      var cToggle = e.target.closest("[data-cat-toggle]");
      if(cToggle){ e.preventDefault(); toggleReqDocCat(cToggle.dataset.catToggle); return; }
      var cRename = e.target.closest("[data-cat-rename]");
      if(cRename){ e.preventDefault(); e.stopPropagation(); beginRenameDocCat(cRename.dataset.catRename); return; }
      var cRow = e.target.closest("[data-cat]");
      if(cRow){ toggleReqDocCat(cRow.dataset.cat); return; }
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
    tree.addEventListener("contextmenu", reqDocTreeContextMenu);
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
      /* 分类行：折叠 / 重命名 / 点行折叠，先于 .rs-rename 文档判断（分类重命名也带 .rs-rename 类） */
      var scToggle = e.target.closest("[data-rs-cat-toggle]");
      if(scToggle){ e.preventDefault(); toggleReqDocCat(scToggle.dataset.rsCatToggle); return; }
      var scRename = e.target.closest("[data-cat-rename]");
      if(scRename){ e.preventDefault(); e.stopPropagation(); beginRenameDocCat(scRename.dataset.catRename); return; }
      var scRow = e.target.closest("[data-rs-cat]");
      if(scRow){ toggleReqDocCat(scRow.dataset.rsCat); return; }
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
    st.addEventListener("contextmenu", reqDocTreeContextMenu);
  }
  var rd = $("reqDocReader");
  if(rd){
    rd.addEventListener("click", function(e){
      var crumb = e.target.closest("[data-rrd-crumb]");
      if(crumb){ loadReqDocSplitDoc(crumb.dataset.rrdCrumb); return; }
      var rn = e.target.closest("[data-rrd-rename]");
      if(rn){
        var rnd = reqDocById(rn.dataset.rrdRename);
        if(rnd && !canEditDoc(rnd)){ toast("仅文档负责人或空间管理员可编辑 / 删除", "warn"); return; }
        reqDocBeginRename(rn.dataset.rrdRename, {
          titleEl: document.querySelector("#reqDocReader .rrd-title-text"),
          inputClass: "rrd-rename-input"
        });
        return;
      }
      var b = e.target.closest("[data-rrd-edit]");
      if(b){
        var edd = reqDocById(b.dataset.rrdEdit);
        if(edd && !canEditDoc(edd)){ toast("仅文档负责人或空间管理员可编辑 / 删除", "warn"); return; }
        openReqDocEditor(b.dataset.rrdEdit); return;
      }
      var hb = e.target.closest("[data-rrd-history]");
      if(hb){
        openReqDocHistory(hb.dataset.rrdHistory, { fromReader: true, canRestore: hb.dataset.canRestore === "1" });
        return;
      }
      var exw = e.target.closest("[data-rrd-export-word]");
      if(exw){ exportReqDocWordFromReader(exw.dataset.rrdExportWord); return; }
      var ex = e.target.closest("[data-rrd-export]");
      if(ex){ exportReqDocFromReader(ex.dataset.rrdExport); return; }
      var cb = e.target.closest("[data-rrd-comments]");
      if(cb){ openRrdSide("comments"); return; }
      var pb = e.target.closest("[data-rrd-perm]");
      if(pb){ openRrdSide("perm"); return; }
      var ve = e.target.closest("[data-doc-vis-edit]");
      if(ve){ openDocVisDialog(ve.dataset.docVisEdit); return; }
      var tb = e.target.closest("[data-rrd-tab]");
      if(tb){ setRrdTab(tb.getAttribute("data-rrd-tab")); return; }
      var sh = e.target.closest(".perm-sec-head");
      if(sh){ var sec = sh.closest(".perm-sec"); if(sec) sec.classList.toggle("collapsed"); return; }
      if(e.target.closest("[data-rrd-wide]")){ toggleDocWide(); return; }
      if(e.target.closest("#rrdCommentsX")){ toggleRrdComments(false); return; }
      if(e.target.closest("#rrdCommentSend")){ submitRrdComment(); return; }
      if(e.target.closest("#rrdQuoteClear")){ setRrdQuote(null); return; }
      var del = e.target.closest("[data-rrd-del-comment]");
      if(del){ deleteRrdComment(del.dataset.rrdDelComment); return; }
      var mk = e.target.closest("mark.rrd-hl");
      if(mk){
        rrdFlashCommentId = mk.dataset.rrdHlComment;
        toggleRrdComments(true, "comments");
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
  if($("reqDocTplBtn")) $("reqDocTplBtn").addEventListener("click", openDocTplDialog);
  if($("dlgDocTplX")) $("dlgDocTplX").addEventListener("click", function(){ UI.closeModal($("dlgDocTpl")); });
  if($("dlgDocTplClose")) $("dlgDocTplClose").addEventListener("click", function(){ UI.closeModal($("dlgDocTpl")); });
  if($("docTplAddBtn")) $("docTplAddBtn").addEventListener("click", createDocTpl);
  if($("docTplList")) $("docTplList").addEventListener("click", function(e){
    var pv = e.target.closest("[data-doc-tpl-prev]");
    if(pv){ toggleDocTplSkel(pv); return; }
    var del = e.target.closest("[data-doc-tpl-del]");
    if(del){
      var row = del.closest("[data-doc-tpl]");
      if(row) deleteDocTpl(row.dataset.docTpl);
      return;
    }
    if(e.target.closest("[data-empty-action]")) loadDocTplManage();
  });
  if($("reqDocProjFilterClear")) $("reqDocProjFilterClear").addEventListener("click", function(){ setReqDocProjectFilter(null); });
  if($("reqDocLoadError")) $("reqDocLoadError").addEventListener("click", function(e){
    var btn = e.target.closest("[data-reqdoc-reload]");
    if(!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "重试中…";
    fetchReqDocs(reqDocKeyword);
  });
  if($("dlgNewReqDocX")) $("dlgNewReqDocX").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocCancel")) $("dlgNewReqDocCancel").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocOk")) $("dlgNewReqDocOk").addEventListener("click", function(){ submitNewReqDoc(false); });
  if($("dlgNewReqDocCreateOnly")) $("dlgNewReqDocCreateOnly").addEventListener("click", function(){ submitNewReqDoc(true); });
  if($("dlgNewReqDoc")) UI.setModalSubmit($("dlgNewReqDoc"), function(){ submitNewReqDoc(false); });
  if($("newReqDocTitle")) $("newReqDocTitle").addEventListener("input", function(){
    syncNewReqDocTitleCount();
    if(this.value.trim()) showNewReqDocError(false);
  });
  if($("newReqDocErr")) $("newReqDocErr").addEventListener("click", function(e){
    if(!e.target.closest("button")) return;
    if($("newReqDocTitle")) $("newReqDocTitle").focus();
  });
  if($("newReqDocTitle")) $("newReqDocTitle").addEventListener("keydown", function(e){
    if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitNewReqDoc();
  });
  if($("newReqDocProject")) $("newReqDocProject").addEventListener("change", function(){
    /* 归属变了：分类只列新范围内的目录，上级文档候选同步重算 */
    fillNewReqDocCategories("");
    fillNewReqDocParents("");
    syncNewReqDocPath();
    /* 指定成员候选取「能看到该项目」的人；换项目后重新加载 */
    syncNewReqDocVis();
  });
  if($("newReqDocCategory")) $("newReqDocCategory").addEventListener("change", function(){
    /* 分类优先：选分类后带出归属项目（锁定），再按范围重填上级文档候选；可见范围按分类默认预填 */
    syncNewReqDocProjFromCat();
    fillNewReqDocParents("");
    applyDocCatDefaultToNewDoc();
    syncNewReqDocPath();
  });
  if($("newReqDocCatAdd")) $("newReqDocCatAdd").addEventListener("click", beginQuickCreateNewDocCat);
  var srcBtns = document.querySelectorAll("#newReqDocSource [data-docsrc]");
  for(var si = 0; si < srcBtns.length; si++){
    (function(btn){
      btn.addEventListener("click", function(){ setNewReqDocSource(btn.dataset.docsrc); });
    })(srcBtns[si]);
  }
  if($("newReqDocTemplate")) $("newReqDocTemplate").addEventListener("change", applyDocTemplateToNewDoc);
  if($("newReqDocType")) $("newReqDocType").addEventListener("change", syncNewReqDocMoreSum);
  if($("newReqDocFile")) $("newReqDocFile").addEventListener("change", function(){
    var f = this.files && this.files[0];
    if(!f){ resetNewReqDocPreview(); return; }
    if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，请拆分后再导入", "warn"); resetNewReqDocPreview(); return; }
    if(!($("newReqDocTitle").value || "").trim()){
      $("newReqDocTitle").value = f.name.replace(/\.[^.]+$/, "");
      syncNewReqDocTitleCount();
    }
    setNewReqDocBusy("解析文件…");
    parseNewReqDocFile(f).catch(function(ex){
      resetNewReqDocPreview();
      toast(ex.message || "文件解析失败", "bad");
    }).then(function(){ setNewReqDocBusy(null); });
  });
  if($("newReqDocPreviewReset")) $("newReqDocPreviewReset").addEventListener("click", function(){
    resetNewReqDocPreview();
    if($("newReqDocFile")) $("newReqDocFile").click();
  });
  if($("newReqDocTitle")){
    $("newReqDocTitle").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitNewReqDoc(); }
    });
  }
  if($("reqDocBack")) $("reqDocBack").addEventListener("click", tryCloseReqDocEditor);
  if($("dlgReqDocCloseCancel")){
    $("dlgReqDocCloseCancel").addEventListener("click", function(){
      /* 草稿兜底弹窗里「留在草稿」= 不发布直接关；未保存弹窗里「取消」= 留在编辑器 */
      if(reqDocCloseMode === "draft-clean"){ finishCloseReqDoc(); return; }
      closeReqDocCloseDialog();
    });
  }
  if($("dlgReqDocCloseDiscard")){
    $("dlgReqDocCloseDiscard").addEventListener("click", function(){
      reqDocDirty = false;
      finishCloseReqDoc();
    });
  }
  if($("dlgReqDocCloseSaveDraft")){
    $("dlgReqDocCloseSaveDraft").addEventListener("click", function(){
      var btn = this;
      if(btn.disabled) return;
      btn.disabled = true;
      saveReqDoc({ silent: true }).then(function(doc){
        btn.disabled = false;
        if(!doc) return;   // 保存失败：保留弹窗与本地正文，用户可重试或放弃
        toast("已存为草稿并关闭（仅你可见）", "fs");
        finishCloseReqDoc();
      });
    });
  }
  if($("dlgReqDocCloseSave")){
    $("dlgReqDocCloseSave").addEventListener("click", function(){
      var btn = this;
      if(btn.disabled) return;
      btn.disabled = true;
      var done = function(){ btn.disabled = false; };
      if(reqDocCloseMode === "draft-clean"){
        reqDocSetPublished(true).then(function(ok){ done(); if(ok) finishCloseReqDoc(); });
        return;
      }
      saveReqDoc({ silent: true }).then(function(doc){
        if(!doc){ done(); return; }   // 保存失败：保留弹窗与本地正文，用户可重试或放弃
        if(editingMeta.publishedAt){ done(); toast("文档已保存", "fs"); finishCloseReqDoc(); return; }
        /* 草稿：先保存已成功，再发布；发布失败就留在弹窗，正文已落库不会丢 */
        reqDocSetPublished(true).then(function(ok){ done(); if(ok) finishCloseReqDoc(); });
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
  if($("reqDocPublish")) $("reqDocPublish").addEventListener("click", function(){ reqDocSetPublished(true); });
  if($("reqDocUnpublish")) $("reqDocUnpublish").addEventListener("click", function(){ reqDocSetPublished(false); });
  if($("reqDocShare")) $("reqDocShare").addEventListener("click", openReqDocShare);
  if($("reqDocShareCopy")) $("reqDocShareCopy").addEventListener("click", reqDocCopyShare);
  if($("reqDocShareRevoke")) $("reqDocShareRevoke").addEventListener("click", reqDocRevokeShare);
  if($("reqDocShareClose")) $("reqDocShareClose").addEventListener("click", function(){ UI.closeModal($("dlgReqDocShare")); });
  if($("reqDocHistory")) $("reqDocHistory").addEventListener("click", function(){ openReqDocHistory(); });
  if($("docHistoryBack")) $("docHistoryBack").addEventListener("click", backFromDocHistory);
  if($("reqDocHistoryRestore")) $("reqDocHistoryRestore").addEventListener("click", restoreReqDocHistory);
  if($("reqDocHistoryList")){
    $("reqDocHistoryList").addEventListener("click", function(e){
      var r = e.target.closest("[data-history-id]");
      if(!r) return;
      var id = r.dataset.historyId;
      if(id === reqDocHistorySel && reqDocHistoryMode === "compare") return;
      reqDocHistorySel = id;
      if(reqDocHistoryTarget === id) reqDocHistoryTarget = "current";
      reqDocHistoryMode = "compare";
      reqDocHistoryExpanded = {};
      reqDocHistoryHunk = 0;
      renderReqDocHistoryList();
      reqDocHistoryLoadAndRender(false);
      syncDocHistoryHash();
    });
  }
  if($("reqDocHistoryBase")){
    $("reqDocHistoryBase").addEventListener("change", function(){
      var id = this.value;
      if(!id) return;
      reqDocHistorySel = id;
      if(reqDocHistoryTarget === id) reqDocHistoryTarget = "current";
      reqDocHistoryExpanded = {};
      reqDocHistoryHunk = 0;
      renderReqDocHistoryList();
      reqDocHistoryLoadAndRender(false);
      syncDocHistoryHash();
    });
  }
  if($("reqDocHistoryTarget")){
    $("reqDocHistoryTarget").addEventListener("change", function(){
      reqDocHistoryTarget = this.value || "current";
      reqDocHistoryExpanded = {};
      reqDocHistoryHunk = 0;
      reqDocHistoryLoadAndRender(false);
      syncDocHistoryHash();
    });
  }
  if($("reqDocHistoryModeSeg")){
    $("reqDocHistoryModeSeg").addEventListener("click", function(e){
      var btn = e.target.closest("button[data-rh-mode]");
      if(!btn) return;
      var mode = btn.dataset.rhMode;
      if(mode === "compare" && !reqDocHistories.length) return;
      reqDocHistoryMode = mode;
      renderReqDocHistory(false);
      syncDocHistoryHash();
    });
  }
  if($("reqDocHistoryViewSeg")){
    $("reqDocHistoryViewSeg").addEventListener("click", function(e){
      var btn = e.target.closest("button[data-rh-view]");
      if(!btn) return;
      reqDocHistoryView = btn.dataset.rhView;
      reqDocHistoryHunk = 0;
      renderReqDocHistory(true);
      syncDocHistoryHash();
    });
  }
  if($("reqDocHistoryFoldAll")){
    $("reqDocHistoryFoldAll").addEventListener("click", function(){
      reqDocHistoryShowAll = !reqDocHistoryShowAll;
      reqDocHistoryExpanded = {};
      reqDocHistoryHunk = 0;
      renderReqDocHistory(true);
    });
  }
  if($("reqDocHistoryDiff")){
    $("reqDocHistoryDiff").addEventListener("click", function(e){
      var fold = e.target.closest("[data-rh-fold]");
      if(!fold) return;
      reqDocHistoryExpanded[fold.dataset.rhFold] = true;
      renderReqDocHistory(true);
    });
    $("reqDocHistoryDiff").addEventListener("scroll", function(){
      if(reqDocHistoryScrollTick) return;
      reqDocHistoryScrollTick = true;
      requestAnimationFrame(function(){
        reqDocHistoryScrollTick = false;
        reqDocHistoryEnsureHunkVisible();
      });
    });
  }
  if($("reqDocHistoryOvl")){
    $("reqDocHistoryOvl").addEventListener("click", function(e){
      var mark = e.target.closest("[data-rh-ov]");
      if(!mark) return;
      reqDocHistoryHunk = Number(mark.dataset.rhOv) || 0;
      var marks = $("reqDocHistoryDiff") ? $("reqDocHistoryDiff").querySelectorAll("[data-hunk]") : [];
      if(marks[reqDocHistoryHunk]) marks[reqDocHistoryHunk].scrollIntoView({ block: "center", behavior: "smooth" });
      reqDocHistoryUpdateHunkLabel();
    });
  }
  if($("reqDocHistoryPrev")) $("reqDocHistoryPrev").addEventListener("click", function(){ reqDocHistoryJumpHunk(-1); });
  if($("reqDocHistoryNext")) $("reqDocHistoryNext").addEventListener("click", function(){ reqDocHistoryJumpHunk(1); });
  if($("reqDocCommentSend")) $("reqDocCommentSend").addEventListener("click", submitReqDocComment);
  if($("reqDocCommentQuoteBtn")) $("reqDocCommentQuoteBtn").addEventListener("click", quoteReqDocSelection);
  if($("reqDocCommentQuoteClear")) $("reqDocCommentQuoteClear").addEventListener("click", function(){ setReqDocCommentQuote(null); });
  if($("reqDocCommentReplyClear")) $("reqDocCommentReplyClear").addEventListener("click", function(){ setReqDocReplyTo(null); });
  if($("reqDocUnresolvedOnly")) $("reqDocUnresolvedOnly").addEventListener("change", function(){ if(editingDocId) loadReqDocComments(editingDocId); });
  document.addEventListener("mouseup", rememberReqDocSelection);
  document.addEventListener("keyup", rememberReqDocSelection);
  rdaBindMdSelection();
  document.addEventListener("mousedown", function(e){
    if(!rdaBubble || rdaBubble.hidden) return;
    if(rdaBubble.contains(e.target)) return;
    rdaHideBubble();
  });
  window.addEventListener("scroll", function(){ rdaHideBubble(); }, true);
  window.addEventListener("resize", function(){ rdaHideBubble(); rdaPlaceCard(); });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if(rdaCard && !rdaCard.hidden){ if(rdaBusy) rdaCancel(); else rdaHideCard(); return; }
    rdaHideBubble();
  });
  if($("reqDocCommentInput")){
    reqDocCommentMention = createMentionPicker($("reqDocCommentInput"), {
      canOpen: function(){ return !roleReadOnly() && !!editingDocId; },
      excludeUserId: function(){ return rt.currentUser && rt.currentUser.id; },
      loadMembers: function(){
        var docId = editingDocId;
        if(!docId) return Promise.reject(new Error("未打开文档"));
        return API.get("/api/req-docs/" + encodeURIComponent(docId) + "/mention-candidates");
      }
    });
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
        return;
      }
      var replyBtn = e.target.closest("[data-reply-comment]");
      if(replyBtn){ setReqDocReplyTo(replyBtn.dataset.replyComment, replyBtn.dataset.replyUser); return; }
      var resolveBtn = e.target.closest("[data-resolve-comment]");
      if(resolveBtn){ resolveReqDocComment(resolveBtn.dataset.resolveComment, resolveBtn.dataset.resolved === "1"); return; }
      var toTaskBtn = e.target.closest("[data-totask-comment]");
      if(toTaskBtn){ commentToTask(toTaskBtn.dataset.totaskComment); return; }
      var taskLink = e.target.closest("[data-comment-task]");
      if(taskLink){ e.preventDefault(); openTaskById(taskLink.dataset.commentTask); return; }
    });
  }
  if($("reqDocSave")) $("reqDocSave").addEventListener("click", saveReqDoc);
  if($("reqDocDelete")) $("reqDocDelete").addEventListener("click", deleteReqDoc);
  if($("reqDocPrint")) $("reqDocPrint").addEventListener("click", printReqDoc);
  if($("reqDocAttachUpload")) $("reqDocAttachUpload").addEventListener("click", function(){ if($("reqDocAttachFile")) $("reqDocAttachFile").click(); });
  if($("reqDocAttachFile")) $("reqDocAttachFile").addEventListener("change", function(){ uploadReqDocAttachments(this.files); this.value = ""; });
  if($("reqDocAttachList")) $("reqDocAttachList").addEventListener("click", function(e){
    var del = e.target.closest("[data-att-del]");
    if(del){ deleteReqDocAttachment(del.dataset.attDel); return; }
    var dl = e.target.closest("[data-att-download]");
    if(dl){ window.open(downloadUrl(dl.dataset.attDownload), "_blank", "noopener"); return; }
    var op = e.target.closest("[data-att-open]");
    if(op){
      e.preventDefault();
      var rows = this.__attList || [];
      var att = rows.filter(function(a){ return a.id === op.dataset.attOpen; })[0];
      if(att) openAttachment(att);
    }
  });
  var rdDrop = $("reqDocAttachDrop");
  if(rdDrop){
    rdDrop.addEventListener("click", function(){ if(roleReadOnly()) return; var fi = $("reqDocAttachFile"); if(fi) fi.click(); });
    rdDrop.addEventListener("keydown", function(e){
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); if(!roleReadOnly()){ var fi = $("reqDocAttachFile"); if(fi) fi.click(); } }
    });
    bindFileDrop(rdDrop, uploadReqDocAttachments, { paste: true, pasteTarget: $("reqDocAttachPanel") });
  }
  if($("reqDocImport")) $("reqDocImport").addEventListener("click", importReqDoc);
  if($("reqDocExport")) $("reqDocExport").addEventListener("click", exportReqDoc);
  if($("reqDocExportWord")) $("reqDocExportWord").addEventListener("click", exportReqDocWord);
  if($("dlgDocImportPreviewOk")) $("dlgDocImportPreviewOk").addEventListener("click", function(){
    var run = importPreviewConfirm;
    closeDocImportPreview();
    if(run) run();
  });
  if($("dlgDocImportPreviewCancel")) $("dlgDocImportPreviewCancel").addEventListener("click", closeDocImportPreview);
  if($("dlgDocImportPreviewX")) $("dlgDocImportPreviewX").addEventListener("click", closeDocImportPreview);
  if($("reqDocImportFile")) $("reqDocImportFile").addEventListener("change", onReqDocImportFile);
  if($("reqDocParent")) $("reqDocParent").addEventListener("change", function(){ markReqDocDirty(); });
  $("reqDocType").addEventListener("change", markReqDocDirty);
  if($("reqDocCategory")) $("reqDocCategory").addEventListener("change", function(){
    markReqDocDirty();
    syncReqDocCatDefaultHint();
  });
  if($("reqDocMdSeg")){
    $("reqDocMdSeg").addEventListener("click", function(e){
      var b = e.target.closest("[data-md-mode]");
      if(b) setMdMode(b.dataset.mdMode);
    });
  }
  if($("reqDocMdCanvas")){
    $("reqDocMdCanvas").addEventListener("input", function(){
      markReqDocDirty();
      scheduleDraftSave();
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

  /* 信息分区折叠：关联需求 / 关联工作项 / 附件 / 文档评论，状态本地记忆 */
  (function(){
    var KEY = "ds.reqDocSecFold";
    function readState(){
      try{
        var s = JSON.parse(localStorage.getItem(KEY) || "{}");
        return s && typeof s === "object" ? s : {};
      }catch(e){ return {}; }
    }
    function apply(section, folded){
      section.classList.toggle("folded", folded);
      var btn = section.querySelector(".reqdoc-sec-fold");
      if(btn) btn.setAttribute("aria-expanded", String(!folded));
    }
    var state = readState();
    document.querySelectorAll("#reqDocEditPage section[data-sec]").forEach(function(section){
      var key = section.getAttribute("data-sec");
      apply(section, state[key] === true);
      var btn = section.querySelector(".reqdoc-sec-fold");
      if(!btn) return;
      btn.addEventListener("click", function(){
        var folded = !section.classList.contains("folded");
        apply(section, folded);
        var s = readState();
        s[key] = folded;
        try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){ /* 存不下就不记 */ }
      });
    });
  })();
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
    if(e.key !== "Escape" || e.__dsEscHandled) return;
    if($("dlgReqDocClose") && $("dlgReqDocClose").classList.contains("open")){ closeReqDocCloseDialog(); return; }
    if($("dlgNewReqDoc") && $("dlgNewReqDoc").classList.contains("open")){ closeNewReqDocDialog(); return; }
    if(activeView === "dochistory"){ backFromDocHistory(); return; }
    if($("dlgReqDocShare") && $("dlgReqDocShare").classList.contains("open")){ UI.closeModal($("dlgReqDocShare")); return; }
    if(activeView === "requirements" && $("reqDocEditPage") && !$("reqDocEditPage").hidden){ tryCloseReqDocEditor(); }
  });

  /* 历史版本对比：n / p 在差异之间跳转（输入控件内不拦截） */
  document.addEventListener("keydown", function(e){
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    if(activeView !== "dochistory") return;
    if(reqDocHistoryMode !== "compare") return;
    var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    if(tag === "select" || tag === "input" || tag === "textarea") return;
    if(e.key === "n" || e.key === "N"){ e.preventDefault(); reqDocHistoryJumpHunk(1); }
    else if(e.key === "p" || e.key === "P"){ e.preventDefault(); reqDocHistoryJumpHunk(-1); }
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

export { aiBtnBusy, aiErrMsg, aiUsageText, ensureReqDocOptions, enterDocHistoryView, enterRequirementsView, isReqDocEditing, loadReqDocs, notifyReqDocChanged, openNewReqDocDialog, openReqDocAndJump, openReqDocInNewTab, populateReqDocSelect, refreshDocHistoryFromHash, refreshReqDocListIfOpen, refreshReqDocTasksIfOpen, reqDocDirty, reqDocList, reqDocNameById, reqDocStatusLabel, reqDocsError, reqDocsLoaded, setReqDocProjectFilter, tryCloseReqDocEditor };
