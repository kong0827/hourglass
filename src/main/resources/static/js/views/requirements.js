/* views/requirements · 需求文档（树、编辑页、AI 拆分/审计） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { rt, state } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { fmtTs } from "../lib/format.js";
import { loadReqs, render } from "./board.js";

var reqDocList = [];
var reqDocDirty = false;
var reqEditor = null;
var reqCollapsed = {};
var editingDocId = null;
var reqDocOpenSeq = 0;
var editingMeta = { title: "", reqId: "", status: "draft" };
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
      placeholder: "在这里写需求：目标、范围、验收标准…",
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
function loadReqDocs(force){
  if(reqDocsLoaded && !force) return Promise.resolve(reqDocList);
  return API.get("/api/req-docs").then(function(rows){
    reqDocList = rows || [];
    reqDocsLoaded = true;
    if(activeView === "requirements") renderReqDocTree();
    populateReqDocSelect();
    if(state.board) render({animate:false});
  }).catch(function(){ /* 需求模块不可用时静默降级 */ });
}
function enterRequirementsView(){
  fillReqDocProjectSelect();
  loadReqs().then(function(){ fillReqDocProjectSelect(); });
  showReqDocList();
  loadReqDocs().then(function(){ renderReqDocTree(); });
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
function renderReqDocTree(){
  var box = $("reqDocTree");
  if(!box) return;
  if(!reqDocList.length){
    box.innerHTML = '<div class="reqdoc-empty2">还没有需求。点右上角「新增需求」，先选项目再填需求名称。</div>';
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocList.filter(function(r){
    return !kw || String(r.title || "").toLowerCase().indexOf(kw) !== -1;
  });
  if(!rows.length){
    box.innerHTML = '<div class="reqdoc-empty2">没有匹配的需求</div>';
    return;
  }

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

  box.innerHTML = groups.map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    return '<div class="reqdoc-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="reqdoc-proj-head" type="button" data-toggle-proj="' + esc(g.key) + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + icon("down", 14) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        '<span class="rp-count">' + g.items.length + '</span>' +
      '</button>' +
      '<div class="reqdoc-proj-body">' +
        g.items.map(function(r){
          var meta = [esc(r.owner || "—") + " 创建"];
          if(r.createdAt) meta.push(esc(fmtTs(r.createdAt)));
          if(r.status && r.status !== "draft") meta.push(reqDocStatusLabel(r.status));
          if(r.taskCount) meta.push(r.doneCount + "/" + r.taskCount + " 任务");
          return '<button class="reqdoc-row" type="button" data-reqdoc="' + esc(r.id) + '">' +
            '<span class="rr-main">' +
              '<span class="rr-title">' + esc(r.title) + '</span>' +
              '<span class="rr-meta">' + meta.join(" · ") + '</span>' +
              (r.excerpt ? '<span class="rr-excerpt">' + esc(r.excerpt) + '</span>' : '') +
            '</span>' +
            '<span class="rr-go">' + icon("chevronRight", 14) + '</span>' +
          '</button>';
        }).join("") +
      '</div>' +
    '</div>';
  }).join("");
}
function toggleReqProj(key){
  reqCollapsed[key] = !reqCollapsed[key];
  renderReqDocTree();
}
function reqDocReadOnly(){
  return !!(rt.currentWs && rt.currentWs.myRole === "exec");
}
function openNewReqDocDialog(reqId){
  if(reqDocReadOnly()){ toast("管理层为只读模式，不能新增需求", "warn"); return; }
  var sel = $("newReqDocProject");
  if(!sel) return;
  sel.innerHTML = rt.reqList.length
    ? rt.reqList.map(function(r){ return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join("")
    : '<option value="">（还没有项目，请先去「项目」建一个）</option>';
  if(reqId) sel.value = reqId;
  $("newReqDocTitle").value = "";
  UI.openModal($("dlgNewReqDoc"));
  setTimeout(function(){ $("newReqDocTitle").focus(); }, 40);
}
function closeNewReqDocDialog(){
  var d = $("dlgNewReqDoc");
  if(d) UI.closeModal(d);
}
function submitNewReqDoc(){
  var reqId = $("newReqDocProject").value;
  var title = ($("newReqDocTitle").value || "").trim();
  if(!reqId){ toast("还没有项目，请先到「项目」里建一个", "warn"); return; }
  if(!title){ toast("请填写需求名称", "warn"); $("newReqDocTitle").focus(); return; }
  API.post("/api/req-docs", { reqId: reqId, title: title, content: "", status: "draft" })
    .then(function(doc){
      closeNewReqDocDialog();
      loadReqDocs(true);
      openReqDocEditor(doc.id);
      toast("已创建「" + doc.title + "」，接着写正文", "fs");
    })
    .catch(function(ex){ toast(ex.message || "创建失败", "bad"); });
}
function openReqDocEditor(id){
  var seq = ++reqDocOpenSeq;
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== reqDocOpenSeq) return;   // 连续点开多份：丢弃过期的响应
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    editingMeta = { title: doc.title || "", reqId: doc.reqId || "", status: doc.status || "draft" };
    /* 先让编辑页可见，再创建编辑器：隐藏容器里量出来的宽高是 0 */
    if($("reqDocListPage")) $("reqDocListPage").hidden = true;
    if($("reqDocEditPage")) $("reqDocEditPage").hidden = false;
    fillReqDocEditor(doc);
    setTocVisible(tocVisiblePref());
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名需求");
    /* 打开时停在顶部：目录高亮与滚动位置对齐 */
    try{ window.scrollTo(0, 0); }catch(e){ /* 忽略 */ }
    setTimeout(refreshTocActive, 60);
  }).catch(function(ex){ toast(ex.message || "需求加载失败", "bad"); });
}
function closeReqDocEditor(){
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
  editingDocId = null;
  reqDirtyReset();
  renderReqDocTree();
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
          '<span class="ai-tag ' + pcls + '">' + esc(p) + '</span>' +
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
      '<div class="sc-lbl">' + (V[d.verdict] || d.verdict) + ' · 共拆出 ' + d.totalPoints + ' 个功能点，按状态加权计算</div>' +
      '<div class="sc-cnt">已完成 ' + d.donePoints + ' · 进行中 ' + d.doingPoints
        + ' · 未开始 ' + d.todoPoints + ' · <b>缺任务 ' + d.missingPoints + '</b></div>' +
    '</div>';

  var S = { done: "已完成", doing: "进行中", todo: "未开始", missing: "缺任务" };
  /* 缺任务的排最前面：那才是用户真正要动手的地方 */
  var order = { missing: 0, todo: 1, doing: 2, done: 3 };
  var pts = (d.points || []).slice().sort(function(a, b){
    return (order[a.status] == null ? 9 : order[a.status]) - (order[b.status] == null ? 9 : order[b.status]);
  });
  $("aiAuditList").innerHTML = pts.map(function(p){
    var st = p.status || "missing";
    return '<div class="ai-item' + (st === "missing" ? " on" : "") + '">' +
      '<div class="ai-main">' +
        '<div class="ai-meta">' +
          '<span class="ai-tag ' + st + '">' + (S[st] || st) + '</span>' +
          (p.taskTitle ? '<span>对应任务：' + esc(p.taskTitle) + '</span>' : '') +
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
function fillReqDocEditor(doc){
  var id = doc.id;
  if(reqEditor){
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
    }).catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
  }
  $("reqDocSaved").textContent = doc.updatedAt ? ("最后保存 " + fmtTs(doc.updatedAt)) : "尚未保存";
  reqDocDirty = false;
  /* 正文换人了：目录要跟着换（重建前先清掉旧的高亮） */
  tocActive = null;
  rebuildToc();
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
  updateReqDocCount();
  if(reqDocDirty) return;
  reqDocDirty = true;
  if($("reqDocSaved")) $("reqDocSaved").textContent = "有未保存的修改";
}
function updateReqDocCount(){
  var el = $("reqDocCount");
  if(!el) return;
  var n = (reqEditor ? reqEditor.getText() : "").replace(/\s+/g, "").length;
  el.textContent = n ? (n + " 字") : "";
}
function copyReqDoc(){
  var text = (reqEditor ? reqEditor.getText() : "").trim();
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
function reqTocRoot(){
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
  var bar = $("reqDocEditPage") ? $("reqDocEditPage").querySelector(".reqdoc-editbar") : null;
  var offset = (bar ? bar.getBoundingClientRect().height : 0) + 40;
  var sc = reqScrollRoot();
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
  var line = 96;   // 判定线：标题越过它就算"已经读到这一节"
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
  if(reqDocReadOnly()){ toast("管理层为只读模式，不能保存需求", "warn"); return Promise.resolve(null); }
  var title = (editingMeta.title || "").trim();
  var reqId = editingMeta.reqId;
  if(!title || !reqId){
    toast("这份需求缺少标题或项目，请回到列表重新创建", "warn");
    return Promise.resolve(null);
  }
  if(!reqEditor){
    toast("正文编辑器还在加载，请稍候再保存", "warn");
    return Promise.resolve(null);
  }
  var body = {
    reqId: reqId,
    title: title,
    content: reqEditor ? reqEditor.getContents(true) : "",
    status: editingMeta.status || "draft"
  };
  var id = editingDocId;
  var p = id ? API.put("/api/req-docs/" + encodeURIComponent(id), body)
             : API.post("/api/req-docs", body);
  return p.then(function(doc){
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    editingMeta = { title: doc.title || "", reqId: doc.reqId || "", status: doc.status || "draft" };
    reqDocDirty = false;
    fillReqDocEditor(doc);
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名需求");
    toast("需求已保存", "fs");
    loadReqDocs(true);
    return doc;
  }).catch(function(ex){
    toast(ex.message || "保存失败", "bad");
    return null;
  });
}
function deleteReqDoc(){
  if(reqDocReadOnly()){ toast("管理层为只读模式，不能删除需求", "warn"); return; }
  var id = editingDocId || state.reqDocId;
  if(!id){ toast("先打开一份已保存的需求", "warn"); return; }
  UI.showConfirm({
    title: "删除需求",
    msg: "关联到它的任务会自动解除关联（任务本身不会被删除）。确定删除？",
    okText: "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(id)).then(function(){
      toast("需求已删除");
      closeReqDocEditor();
      loadReqDocs(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openReqDocAndJump(id){
  showView("requirements");
  state.reqDocId = id;
  openReqDocEditor(id);
}
function populateReqDocSelect(keep){
  var sel = $("iReqDoc");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  var cur = (keep === undefined ? sel.value : keep) || "";
  var opts = reqId ? reqDocList.filter(function(d){ return d.reqId === reqId; }) : [];
  sel.innerHTML = '<option value="">不关联</option>' + opts.map(function(d){
    return '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>';
  }).join("");
  var ok = false;
  for(var i = 0; i < opts.length; i++) if(opts[i].id === cur) ok = true;
  sel.value = ok ? cur : "";
  sel.disabled = !reqId;
  var hint = $("iReqDocHint");
  if(hint){
    hint.textContent = !reqId ? "先选项目，再从该项目的需求里挑"
      : (opts.length ? "从该项目的需求里挑" : "该项目还没有需求");
  }
}
(function wireRequirementView(){
  var tree = $("reqDocTree");
  if(tree){
    tree.addEventListener("click", function(e){
      var t = e.target.closest("[data-toggle-proj]");
      if(t){ toggleReqProj(t.dataset.toggleProj); return; }
      var row = e.target.closest("[data-reqdoc]");
      if(row){ openReqDocEditor(row.dataset.reqdoc); }
    });
  }
  if($("reqDocNew")) $("reqDocNew").addEventListener("click", openNewReqDocDialog);
  if($("dlgNewReqDocCancel")) $("dlgNewReqDocCancel").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocOk")) $("dlgNewReqDocOk").addEventListener("click", submitNewReqDoc);
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
  if($("reqDocSave")) $("reqDocSave").addEventListener("click", saveReqDoc);
  if($("reqDocDelete")) $("reqDocDelete").addEventListener("click", deleteReqDoc);

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
  if($("reqDocSearch")) $("reqDocSearch").addEventListener("input", renderReqDocTree);
  if($("iReq")) $("iReq").addEventListener("change", function(){ populateReqDocSelect(""); });

  /* Esc：先关弹窗，再问是否保存并关闭编辑页 */
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgReqDocClose") && $("dlgReqDocClose").classList.contains("open")){ closeReqDocCloseDialog(); return; }
    if($("dlgNewReqDoc") && $("dlgNewReqDoc").classList.contains("open")){ closeNewReqDocDialog(); return; }
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
  var run = function(){ populateReqDocSelect(keep || ""); };
  if(reqDocsLoaded) run();
  else loadReqDocs().then(run).catch(run);
}
/** 路由后退守卫：需求编辑页有未保存正文 */
function isReqDocEditing(){
  var page = document.getElementById("reqDocEditPage");
  return !!(page && !page.hidden && reqDocDirty);
}

export { aiBtnBusy, aiErrMsg, aiUsageText, ensureReqDocOptions, enterRequirementsView, isReqDocEditing, loadReqDocs, openNewReqDocDialog, openReqDocAndJump, populateReqDocSelect, reqDocDirty, reqDocList, reqDocNameById, reqDocStatusLabel, tryCloseReqDocEditor };
