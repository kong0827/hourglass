/* core/ai-field.js · 字段级 AI 草稿：需求「验收标准」、工作项「完成标准」
 *
 * 权限与边界（改之前先读）：
 *   1. 只发送当前表单里的标题与描述；结果只写入表单，不自动保存；
 *   2. 采用、替换、追加都由用户点；生成失败不留下半截内容；
 *   3. 写权限与限流由服务端校验，前端隐藏按钮只是体验优化；
 *   4. 按钮在运行时注入，不改表单模板，避免和正在改抽屉的批次互相踩。
 */
import { API } from "./api.js";
import { esc, toast } from "./ui.js";

var DRAFT = {
  acceptance: {
    label: "验收标准",
    endpoint: "/api/ai/drafts/acceptance",
    missing: "先选择所属项目并填写需求标题"
  },
  taskDone: {
    label: "完成标准",
    endpoint: "/api/ai/drafts/task-done",
    missing: "先选择所属项目并填写工作项标题"
  }
};

var observer = null;
var layerObserver = null;
var scanTimer = null;
var cfgPromise = null;
var readyState = null;
var cfgStatus = "";

/* ==================== 初始化 ==================== */

function initAiFields(){
  if(observer) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  layerObserver = new MutationObserver(function(muts){
    for(var i = 0; i < muts.length; i++){
      var t = muts[i].target;
      if(t.id === "dAccept"){ markButtons(); continue; }
      /* 需求弹窗加 open，任务抽屉加 on：两种打开方式都要清掉上一次的结果 */
      var opened = t.classList && (t.classList.contains("open") || t.classList.contains("on"));
      if(opened) resetFields();
      else markButtons();
    }
  });
  document.addEventListener("click", onClick, true);
  scheduleScan();
  probeConfig();
}

function scheduleScan(){
  if(scanTimer) return;
  scanTimer = setTimeout(function(){
    scanTimer = null;
    scan();
  }, 50);
}

function scan(){
  var accept = document.getElementById("dAccept");
  if(accept){
    var field = accept.closest(".field");
    var label = field && field.querySelector('label[for="dAccept"]');
    inject(field, label, "acceptance");
  }
  var desc = document.getElementById("iDesc");
  if(desc && desc.querySelector(".sun-editor-editable")){
    var box = desc.closest(".field");
    var prev = desc.previousElementSibling;
    var lab = prev && prev.classList && prev.classList.contains("field-label")
      ? prev : (box && box.querySelector(".field-label"));
    inject(box, lab, "taskDone");
  }
  markButtons();
  watchLayers();
  pruneStale();
}

/* 面板归属生成时的那条需求 / 工作项；抽屉不关直接切换对象时把它清掉 */
function pruneStale(){
  document.querySelectorAll("[data-ai-field]").forEach(function(field){
    if(field.getAttribute("data-ai-busy") === "1" || field.__aiTarget === undefined) return;
    var kind = field.getAttribute("data-ai-field");
    if(field.__aiTarget !== targetKey(kind)) resetField(field);
  });
}

function targetKey(kind){
  return kind === "acceptance"
    ? value("dReq") + "|" + value("dTitle")
    : value("iReq") + "|" + value("iTitle");
}

/* 弹窗 / 抽屉每次打开都从干净状态开始：上一次生成的面板不该跟着换一条需求/工作项 */
function watchLayers(){
  if(!layerObserver) return;
  ["dlgDemand", "taskDrawer"].forEach(function(id){
    var el = document.getElementById(id);
    if(!el || el.__aiLayerWatched) return;
    el.__aiLayerWatched = true;
    layerObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
  });
  var accept = document.getElementById("dAccept");
  if(accept && !accept.__aiAttrWatched){
    accept.__aiAttrWatched = true;
    layerObserver.observe(accept, { attributes: true, attributeFilter: ["disabled"] });
  }
  /* 只读项目是异步判定的，类一加上就要把按钮收回去 */
  var drawer = document.getElementById("taskDrawer");
  var inner = drawer && drawer.querySelector(".drawer");
  if(inner && !inner.__aiReadonlyWatched){
    inner.__aiReadonlyWatched = true;
    layerObserver.observe(inner, { attributes: true, attributeFilter: ["class"] });
  }
}

function resetFields(){
  document.querySelectorAll("[data-ai-field]").forEach(resetField);
  markButtons();
}

function resetField(field){
  field.__aiSeq = (field.__aiSeq || 0) + 1;
  delete field.__aiTarget;
  field.removeAttribute("data-ai-busy");
  var panel = field.querySelector(".ai-field-panel");
  if(panel) panel.remove();
  var btn = field.querySelector("[data-ai-field-btn]");
  if(btn){ btn.disabled = false; btn.textContent = "AI 生成"; }
}

function inject(field, label, kind){
  if(!field || !label || field.querySelector("[data-ai-field-btn]")) return;
  field.setAttribute("data-ai-field", kind);
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ai-field-btn";
  btn.setAttribute("data-ai-field-btn", kind);
  btn.textContent = "AI 生成";
  btn.title = "把当前标题与描述发送到你配置的模型服务，只生成草稿，不会自动保存";
  label.appendChild(btn);
}

/* ==================== 配置就绪 ==================== */

function probeConfig(){
  if(cfgPromise) return cfgPromise;
  /* 不长期缓存：用户刚在设置里配好 Key 切回来，按钮要能立刻恢复可用 */
  cfgPromise = API.get("/api/ai/config").then(function(view){
    readyState = isReady(view);
    cfgStatus = (view && view.status) || "";
    markButtons();
    return readyState;
  }).catch(function(){
    /* 取不到配置不挡用户：让请求本身给出服务端文案 */
    return null;
  }).then(function(v){
    cfgPromise = null;
    return v;
  });
  return cfgPromise;
}

function isReady(v){
  if(!v || !v.enabled) return false;
  if(v.source === "team" || v.source === "workspace") return true;
  if(v.source !== "personal" || v.keyBroken) return false;
  return (v.hasKey || v.provider === "ollama") && text(v.baseUrl) !== "" && text(v.model) !== "";
}

function markButtons(){
  var off = readyState === false;
  var accept = document.getElementById("dAccept");
  var drawer = document.getElementById("taskDrawer");
  document.querySelectorAll("[data-ai-field-btn]").forEach(function(btn){
    var kind = btn.getAttribute("data-ai-field-btn");
    /* 只读标记在抽屉内部的 .drawer 上，不在 #taskDrawer 本身 */
    var ro = kind === "acceptance"
      ? !!(accept && accept.disabled)
      : !!(drawer && drawer.querySelector(".drawer.readonly"));
    btn.hidden = ro;
    btn.classList.toggle("is-off", off);
    btn.title = off
      ? "还没有可用的 AI：先在「个人设置 → AI 设置」里配置"
      : "把当前标题与描述发送到你配置的模型服务，只生成草稿，不会自动保存";
    btn.setAttribute("aria-disabled", off ? "true" : "false");
  });
}

/* ==================== 点击分发 ==================== */

function onClick(e){
  var btn = e.target.closest && e.target.closest("[data-ai-field-btn]");
  if(btn){
    e.preventDefault();
    e.stopPropagation();
    onGenerate(btn);
    return;
  }
  var retry = e.target.closest && e.target.closest("[data-ai-field-retry]");
  if(retry){
    e.preventDefault();
    var rp = retry.closest(".ai-field-panel");
    var rf = rp && rp.closest(".field");
    if(rf) runRequest(rf, rp.__kind, collect(rp.__kind));
    return;
  }
  var close = e.target.closest && e.target.closest("[data-ai-field-close]");
  if(close){
    e.preventDefault();
    var cp = close.closest(".ai-field-panel");
    if(cp) cp.remove();
    return;
  }
  var act = e.target.closest && e.target.closest("[data-ai-field-act]");
  if(act){
    e.preventDefault();
    applyAction(act);
  }
  var del = e.target.closest && e.target.closest("[data-ai-field-remove]");
  if(del){
    e.preventDefault();
    var row = del.closest(".ai-field-item");
    if(row) row.remove();
    return;
  }
  var add = e.target.closest && e.target.closest("[data-ai-field-add]");
  if(add){
    e.preventDefault();
    var list = add.parentNode.querySelector(".ai-field-list");
    if(!list) return;
    var li = document.createElement("li");
    li.className = "ai-field-item";
    li.innerHTML = itemInputHtml("", list.children.length);
    list.appendChild(li);
    var inp = li.querySelector(".ai-field-item-input");
    if(inp) inp.focus();
  }
}

function onGenerate(btn){
  var kind = btn.getAttribute("data-ai-field-btn");
  var field = btn.closest(".field");
  if(!field || field.getAttribute("data-ai-busy") === "1") return;
  var payload = collect(kind);
  if(!payload.projectId || !payload.title){
    toast(DRAFT[kind].missing, "warn");
    return;
  }
  runRequest(field, kind, payload);
}

function collect(kind){
  if(kind === "acceptance"){
    return {
      projectId: value("dReq"),
      title: value("dTitle"),
      description: plain("dDesc", 2000),
      /* 已经写过验收标准时发过去，避免追加出一堆重复条目 */
      existing: value("dAccept").slice(0, 2000)
    };
  }
  return {
    projectId: value("iReq"),
    title: value("iTitle"),
    description: plain(id("iDesc"), 2000)
  };
}

/* ==================== 请求与渲染 ==================== */

function runRequest(field, kind, payload){
  var seq = (field.__aiSeq || 0) + 1;
  field.__aiSeq = seq;
  field.__aiTarget = targetKey(kind);
  field.setAttribute("data-ai-busy", "1");
  var btn = field.querySelector("[data-ai-field-btn]");
  if(btn){ btn.disabled = true; btn.textContent = "生成中…"; }
  var panel = panelFor(field);
  panel.className = "ai-field-panel";
  panel.innerHTML = '<div class="ai-field-head"><b>' + esc("正在生成" + DRAFT[kind].label)
    + '</b><span>通常 5–15 秒</span></div>'
    + '<div class="ai-field-loading">读取标题与描述，生成可核对的条目…</div>';

  probeConfig().then(function(ready){
    if(seq !== field.__aiSeq || !document.body.contains(field)) return;
    if(ready === false){ notReady(field); return; }
    return API.post(DRAFT[kind].endpoint, payload).then(function(res){
      if(seq !== field.__aiSeq || !document.body.contains(field)) return;
      renderResult(field, kind, res, payload);
    }).catch(function(ex){
      if(seq !== field.__aiSeq || !document.body.contains(field)) return;
      renderError(field, kind, payload, ex);
    });
  }).then(function(){
    if(seq !== field.__aiSeq) return;
    resetBusy(field);
  });
}

function renderResult(field, kind, res, payload){
  var items = (res && res.items) || [];
  var panel = panelFor(field);
  panel.__kind = kind;
  panel.__payload = payload;
  panel.innerHTML = '<div class="ai-field-head"><b>' + esc("AI 生成 " + items.length + " 条" + DRAFT[kind].label)
    + '</b><span>' + esc(usageText(res && res.usage)) + '</span></div>'
    + '<ul class="ai-field-list">' + items.map(function(s, i){
        return '<li class="ai-field-item">' + itemInputHtml(s, i) + '</li>';
      }).join("") + '</ul>'
    + '<button type="button" class="ai-field-add" data-ai-field-add>＋ 加一条</button>'
    + (res && res.note ? '<p class="ai-field-note">' + esc(res.note) + '</p>' : "")
    + '<div class="ai-field-acts">' + actions(kind) + '</div>'
    + '<p class="ai-field-tip">条目可以直接改、删或再加一条，采用时以面板里的内容为准；仍需你点保存。</p>';
}

function itemInputHtml(s, i){
  return '<input type="text" class="ai-field-item-input" maxlength="120" value="' + esc(s)
    + '" placeholder="写一条可核对的内容" aria-label="第 ' + (i + 1) + ' 条">'
    + '<button type="button" class="ai-field-item-del" data-ai-field-remove title="删除这条" aria-label="删除第 ' + (i + 1) + ' 条">×</button>';
}

function actions(kind){
  var adopt = kind === "taskDone"
    ? '<button class="btn sm primary" type="button" data-ai-field-act="insert">插入到描述末尾</button>'
    : (value("dAccept").trim()
        ? '<button class="btn sm primary" type="button" data-ai-field-act="replace">替换现有内容</button>'
          + '<button class="btn sm" type="button" data-ai-field-act="append">追加到末尾</button>'
        : '<button class="btn sm primary" type="button" data-ai-field-act="replace">采用</button>');
  return adopt
    + '<button class="btn sm ghost" type="button" data-ai-field-act="again">重新生成</button>'
    + '<button class="btn sm ghost" type="button" data-ai-field-close>关闭</button>';
}

function renderError(field, kind, payload, ex){
  var panel = panelFor(field);
  panel.className = "ai-field-panel is-error";
  panel.__kind = kind;
  panel.__payload = payload;
  var msg = (ex && ex.message) || "生成失败，请稍后重试";
  /* 弹窗不会随 hash 跳转关闭，新标签打开才看得到设置页 */
  var link = /配置|AI|Key|密钥|模型|额度/.test(msg)
    ? ' <a href="#/profile" target="_blank" rel="noopener">去 AI 设置</a>' : "";
  panel.innerHTML = '<div class="ai-field-head"><b>生成失败</b></div>'
    + '<p class="ai-field-msg">' + esc(msg) + link + '</p>'
    + '<div class="ai-field-acts"><button class="btn sm" type="button" data-ai-field-retry>重试</button>'
    + '<button class="btn sm ghost" type="button" data-ai-field-close>关闭</button></div>';
}

function notReady(field){
  var panel = panelFor(field);
  panel.className = "ai-field-panel is-error";
  panel.innerHTML = '<div class="ai-field-head"><b>还没有可用的 AI</b></div>'
    + '<p class="ai-field-msg">' + esc(cfgStatus || "请先在「个人设置 → AI 设置」里配置模型与 Key，"
    + "或联系平台管理员开通团队 AI。") + '<a href="#/profile" target="_blank" rel="noopener">去 AI 设置</a></p>'
    + '<div class="ai-field-acts"><button class="btn sm ghost" type="button" data-ai-field-close>关闭</button></div>';
  resetBusy(field);
}

/* ==================== 采用 ==================== */

function applyAction(act){
  var panel = act.closest(".ai-field-panel");
  var field = panel && panel.closest(".field");
  if(!panel || !field) return;
  var kind = panel.__kind;
  var items = [];
  /* 以面板里当前内容为准：用户可能改过、删过或加过条目 */
  panel.querySelectorAll(".ai-field-item-input").forEach(function(inp){
    var v = String(inp.value || "").trim();
    if(v) items.push(v);
  });
  if(!items.length){
    toast("面板里没有非空条目，写一条再采用", "warn");
    return;
  }
  var how = act.getAttribute("data-ai-field-act");

  if(how === "again"){
    runRequest(field, kind, collect(kind));
    return;
  }
  if(kind === "taskDone"){
    if(!insertIntoDescription(field, items)){
      toast("先进入编辑态再插入", "warn");
      return;
    }
    toast("已插入描述末尾，记得保存", "fs");
  }else{
    var ta = document.getElementById("dAccept");
    if(!ta) return;
    var lines = numberLines(items);
    var next = how === "append" && ta.value.trim()
      ? ta.value.replace(/\s+$/, "") + "\n" + lines
      : lines;
    /* 直接赋 value 不受 maxlength 限制，超了会在保存时才报错 */
    if(next.length > 2000){
      toast("合并后超过 2000 字，先精简现有内容或改用替换", "warn");
      return;
    }
    ta.value = next;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    try{ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }catch(e){ /* noop */ }
    toast(how === "append" ? "已追加到验收标准末尾" : "已写入验收标准", "fs");
  }
  panel.remove();
}

function insertIntoDescription(field, items){
  var ed = field.querySelector(".sun-editor-editable");
  if(!ed) return false;
  ed.focus();
  try{
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }catch(e){ /* 选区失败就退回追加 */ }
  var html = items.map(function(s){ return "<p>• " + esc(s) + "</p>"; }).join("");
  var ok = false;
  try{ ok = document.execCommand("insertHTML", false, html); }catch(e){ ok = false; }
  if(!ok) ed.insertAdjacentHTML("beforeend", html);
  ed.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/* ==================== 小工具 ==================== */

function panelFor(field){
  var panel = field.querySelector(".ai-field-panel");
  if(!panel){
    panel = document.createElement("div");
    panel.className = "ai-field-panel";
    field.appendChild(panel);
  }
  return panel;
}

function resetBusy(field){
  field.removeAttribute("data-ai-busy");
  var btn = field.querySelector("[data-ai-field-btn]");
  if(btn){ btn.disabled = false; btn.textContent = "AI 生成"; }
  markButtons();
}

function numberLines(items){
  return items.map(function(s, i){ return (i + 1) + ". " + s; }).join("\n");
}

function usageText(u){
  if(!u) return "";
  return (u.totalTokens || 0) + " tokens · " + (u.sourceLabel || "我的额度");
}

function id(x){
  return typeof x === "string" ? document.getElementById(x) : x;
}

function value(x){
  var el = id(x);
  return el ? String(el.value || "").trim() : "";
}

function plain(x, max){
  var el = id(x);
  if(!el) return "";
  var t = String(el.innerText || el.textContent || "").replace(/\n{2,}/g, "\n").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function text(s){
  return s == null ? "" : String(s).trim();
}

export { initAiFields };
