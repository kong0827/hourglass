/* core/assistant.js · 右下角 AI 助手：问答、入口建议、单任务草稿确认
 *
 * 权限边界（改之前先读）：
 *   1. 项目下拉只来自 /api/ai/assistant/bootstrap 下发的「可写项目」，前端不自行拼选项；
 *   2. 入口链接只允许站内 #/ 与 help.html#/，其余一律不渲染；
 *   3. 创建一律带上服务端下发的 requestId，最终由后端重新校验项目与权限；
 *   4. 回答正文里的链接同样按白名单过滤，不信任模型输出。
 */

import { API } from "./api.js";
import { icon } from "./icons.js";
import { VIEWS, activeView, showView } from "./router.js";
import { esc, toast } from "./ui.js";
import { openTaskById } from "./task-actions.js";
import { openTaskDrawer } from "./task-drawer.js";
import { loadBoard, loadReqs } from "../views/board.js";

var MAX_HISTORY = 8;
var TYPE_LABEL = { story: "故事", task: "任务", bug: "缺陷", epic: "史诗" };
var PRIO_LABEL = { P0: "P0 紧急", P1: "P1 高", P2: "P2 中", P3: "P3 低" };
var SEVERITIES = [["blocker", "阻断"], ["critical", "严重"], ["major", "一般"], ["minor", "轻微"]];
var ROLE_LABEL = { owner: "空间主", admin: "管理员", member: "成员", viewer: "查看者（只读）" };

var els = null;
var boot = null;
var bootPromise = null;
var history = [];
var draft = null;
var requestId = "";
var missing = [];
var busy = false;
var abortCtrl = null;
var mdPromise = null;
var open = false;

/* ==================== 可见性偏好 ====================
   个人设置里的开关决定是否显示悬浮助手；默认显示，只有显式存 "off" 才隐藏。
   存 localStorage（与主题同款做法），切换即时生效，无需保存按钮。 */
var PREF_KEY = "ds.aiAssistant";
function readEnabled(){
  try{ return localStorage.getItem(PREF_KEY) !== "off"; }catch(e){ return true; }
}
function writeEnabled(on){
  try{ localStorage.setItem(PREF_KEY, on ? "on" : "off"); }catch(e){ /* 受限环境忽略 */ }
}
var enabled = readEnabled();

function isAssistantEnabled(){ return enabled; }

/* 供个人设置开关调用：写偏好并即时显隐；关闭时若面板开着则一并收起 */
function setAssistantEnabled(on){
  enabled = !!on;
  writeEnabled(enabled);
  if(enabled && !els){ buildDom(); bind(); }
  applyEnabled();
}

function applyEnabled(){
  if(!els) return;
  els.fab.hidden = !enabled;
  if(!enabled && open) closePanel();
}

/* ==================== 初始化 ==================== */

function initAssistant(){
  if(els){ applyEnabled(); return; }
  buildDom();
  bind();
  applyEnabled();
}

function buildDom(){
  var fab = document.createElement("button");
  fab.type = "button";
  fab.className = "ai-fab";
  fab.id = "aiFab";
  fab.setAttribute("aria-label", "AI 助手");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-controls", "aiPanel");
  fab.innerHTML = icon("ai", 22);

  var panel = document.createElement("section");
  panel.className = "ai-panel";
  panel.id = "aiPanel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-label", "沙漏 AI 助手");
  panel.innerHTML =
    '<header class="ai-head">' +
      '<span class="ai-head-ic">' + icon("ai", 17) + '</span>' +
      '<div class="ai-head-txt">' +
        '<div class="ai-head-title">沙漏助手</div>' +
        '<div class="ai-head-sub" id="aiHeadSub">正在读取当前空间…</div>' +
      '</div>' +
      '<button class="ai-icon-btn" type="button" data-ai-close aria-label="关闭助手">' + icon("close", 16) + '</button>' +
    '</header>' +
    '<div class="ai-body" id="aiBody">' +
      '<div class="ai-welcome" id="aiWelcome">' +
        '<p class="ai-welcome-title">可以帮你找到入口，也能按自然语言建工作项。</p>' +
        '<p class="ai-welcome-sub" id="aiWelcomeSub">只会使用你当前空间内有权限的项目；创建前需要你确认。</p>' +
        '<div class="ai-suggest" id="aiSuggest"></div>' +
      '</div>' +
      '<div class="ai-msgs" id="aiMsgs"></div>' +
    '</div>' +
    '<div class="ai-draft-slot" id="aiDraftSlot" hidden></div>' +
    '<form class="ai-compose" id="aiForm">' +
      '<textarea id="aiInput" rows="1" maxlength="2000" placeholder="问点什么，或直接说：在 XX 项目建一个任务…"></textarea>' +
      '<button class="ai-send" id="aiSend" type="submit" aria-label="发送">' + icon("up", 16) + '</button>' +
    '</form>' +
    '<div class="ai-foot" id="aiFoot">只读取你有权访问的项目 · 创建前需确认</div>';

  document.body.appendChild(panel);
  document.body.appendChild(fab);

  els = {
    fab: fab,
    panel: panel,
    sub: panel.querySelector("#aiHeadSub"),
    body: panel.querySelector("#aiBody"),
    msgs: panel.querySelector("#aiMsgs"),
    welcome: panel.querySelector("#aiWelcome"),
    welcomeSub: panel.querySelector("#aiWelcomeSub"),
    suggest: panel.querySelector("#aiSuggest"),
    draftSlot: panel.querySelector("#aiDraftSlot"),
    form: panel.querySelector("#aiForm"),
    input: panel.querySelector("#aiInput"),
    send: panel.querySelector("#aiSend"),
    foot: panel.querySelector("#aiFoot")
  };
}

function bind(){
  els.fab.addEventListener("click", function(){
    if(open) closePanel(); else openPanel();
  });
  els.panel.addEventListener("click", function(e){
    if(e.target.closest("[data-ai-close]")){ closePanel(); return; }
    var link = e.target.closest("[data-ai-href]");
    if(link){ e.preventDefault(); goHref(link.getAttribute("data-ai-href")); return; }
    var sug = e.target.closest("[data-ai-suggest]");
    if(sug){ send(sug.getAttribute("data-ai-suggest")); return; }
    if(e.target.closest("[data-ai-retry]")){
      bootPromise = null;
      loadBootstrap();
      return;
    }
    if(e.target.closest("[data-ai-discard]")){ clearDraft(); return; }
    if(e.target.closest("[data-ai-confirm]")){ confirmDraft(); }
  });
  els.draftSlot.addEventListener("input", syncDraftState);
  els.draftSlot.addEventListener("change", syncDraftState);
  els.form.addEventListener("submit", function(e){
    e.preventDefault();
    if(busy){ stop(); return; }
    send(els.input.value);
  });
  els.input.addEventListener("input", autoGrow);
  els.input.addEventListener("keydown", function(e){
    /* 手机软键盘的回车更适合换行；桌面回车直接发送 */
    if(e.key === "Enter" && !e.shiftKey && !e.isComposing && document.documentElement.dataset.layout !== "mobile"){
      e.preventDefault();
      if(!busy) send(els.input.value);
    }
  });
  els.panel.addEventListener("keydown", function(e){
    if(e.key === "Escape" && open){ e.stopPropagation(); closePanel(); }
  });
}

function openPanel(){
  if(open) return;
  open = true;
  els.panel.hidden = false;
  els.fab.setAttribute("aria-expanded", "true");
  document.body.classList.add("ai-open");
  loadBootstrap();
  setTimeout(function(){
    try{ els.input.focus(); }catch(e){ /* noop */ }
  }, 30);
}

function closePanel(){
  if(!open) return;
  open = false;
  els.panel.hidden = true;
  els.fab.setAttribute("aria-expanded", "false");
  document.body.classList.remove("ai-open");
  if(els.panel.contains(document.activeElement)){
    try{ els.fab.focus({preventScroll:true}); }catch(e){ /* noop */ }
  }
}

function autoGrow(){
  var t = els.input;
  t.style.height = "auto";
  t.style.height = Math.min(120, t.scrollHeight || 38) + "px";
}

/* ==================== 启动信息 ==================== */

function loadBootstrap(){
  if(bootPromise) return bootPromise;
  els.sub.textContent = "正在读取当前空间…";
  bootPromise = API.get("/api/ai/assistant/bootstrap").then(function(v){
    boot = v || {};
    renderHead();
    renderSuggestions();
    return boot;
  }).catch(function(ex){
    bootPromise = null;
    els.sub.textContent = "无法读取当前空间";
    els.sub.title = (ex && ex.message) || "";
    els.suggest.innerHTML = '<button type="button" data-ai-retry>重试连接</button>';
    return null;
  });
  return bootPromise;
}

function renderHead(){
  if(!boot) return;
  var parts = [];
  if(ROLE_LABEL[boot.role]) parts.push(ROLE_LABEL[boot.role]);
  parts.push(boot.aiReady ? "模型已就绪" : "未配置模型");
  if(!boot.canCreate) parts.push("无可写项目");
  els.sub.textContent = parts.join(" · ");
  els.sub.title = boot.aiStatus || "";
  els.foot.textContent = "只读取你有权访问的项目 · 创建前需确认";
  els.foot.title = boot.privacyNotice || "";
  if(!boot.canCreate){
    els.welcomeSub.textContent = "当前空间里你没有可写的项目，助手只能回答问题，不能创建任务。";
  }
}

function renderSuggestions(){
  var list = (boot && boot.suggestions) || [];
  els.suggest.innerHTML = list.slice(0, 4).map(function(s){
    return '<button type="button" data-ai-suggest="' + esc(s) + '">' + esc(s) + '</button>';
  }).join("");
}

/* ==================== 对话 ==================== */

function send(text){
  text = String(text == null ? "" : text).trim();
  if(!text || busy) return;
  if(text.length > 2000) text = text.slice(0, 2000);
  els.welcome.hidden = true;
  appendUser(text);
  history.push({ role: "user", content: text });
  trimHistory();
  els.input.value = "";
  autoGrow();
  requestChat();
}

function requestChat(){
  busy = true;
  setBusy(true);
  var typing = appendTyping();
  abortCtrl = window.AbortController ? new AbortController() : null;

  var body = {
    /* 服务端单条上限 2000 字：历史里的长回答必须截断，否则整轮会被 Bean Validation 拒掉 */
    messages: history.slice(-MAX_HISTORY).map(function(m){
      return { role: m.role, content: String(m.content || "").slice(0, 2000) };
    }),
    context: { view: activeView }
  };
  if(draft) body.draft = copyDraft();

  API.postWithSignal("/api/ai/assistant/chat", body, abortCtrl && abortCtrl.signal).then(function(res){
    typing.remove();
    finishBusy();
    handleResponse(res || {});
  }).catch(function(ex){
    typing.remove();
    finishBusy();
    if(ex && ex.aborted){ appendNote("已停止本次回答"); return; }
    appendError((ex && ex.message) || "助手暂时不可用，请稍后重试");
  });
}

function stop(){
  if(abortCtrl){ try{ abortCtrl.abort(); }catch(e){ /* noop */ } }
}

function finishBusy(){
  busy = false;
  abortCtrl = null;
  setBusy(false);
}

function setBusy(on){
  els.send.classList.toggle("stop", on);
  els.send.setAttribute("aria-label", on ? "停止" : "发送");
  els.send.innerHTML = on ? icon("close", 14) : icon("up", 16);
}

function handleResponse(res){
  var answer = String(res.answer || "").trim();
  var question = String(res.question || "").trim();
  var links = res.links || [];

  if(!answer && !question){
    answer = "我没有找到明确的答案。可以打开帮助中心，或换个说法再问一次。";
    if(!links.length){
      links = [
        { label: "常见问题", href: "help.html#/faq" },
        { label: "用户使用手册", href: "help.html#/manual" }
      ];
    }
  }

  if(answer){
    history.push({ role: "assistant", content: answer });
    trimHistory();
  }
  appendBot(answer, links);
  if(question && answer.indexOf(question) === -1){
    var q = document.createElement("div");
    q.className = "ai-msg note";
    q.textContent = "需要你补充：" + question;
    els.msgs.appendChild(q);
    scrollBottom();
  }

  if(res.requestId && res.draft){
    missing = res.missing || [];
    draft = normalizeDraft(res.draft);
    requestId = res.requestId;
    renderDraft();
  } else if("create_task" === res.intent || "clarify" === res.intent){
    /* 模型想建任务却没给可用草稿：保持旧草稿不动，只提示补充 */
    if(!draft) appendNote("请把任务标题和所属项目再说具体一点。");
  }
}

function trimHistory(){
  if(history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
}

/* ==================== 消息渲染 ==================== */

function appendUser(text){
  var el = document.createElement("div");
  el.className = "ai-msg user";
  el.textContent = text;
  els.msgs.appendChild(el);
  scrollBottom();
}

function appendBot(text, links){
  var el = document.createElement("div");
  el.className = "ai-msg bot";
  var body = document.createElement("div");
  body.className = "ai-md";
  el.appendChild(body);
  els.msgs.appendChild(el);
  renderMarkdown(body, text || "");
  if(links && links.length) appendLinkChips(el, links);
  scrollBottom();
  return el;
}

function appendNote(text){
  var el = document.createElement("div");
  el.className = "ai-msg note";
  el.textContent = text;
  els.msgs.appendChild(el);
  scrollBottom();
}

function appendError(text){
  var el = document.createElement("div");
  el.className = "ai-msg error";
  el.textContent = text;
  els.msgs.appendChild(el);
  if(/未配置|配置 AI|API Key|密钥|模型/.test(text)){
    appendLinkChips(el, [{ label: "前往 AI 设置", href: "#/profile" }]);
  }
  scrollBottom();
}

function appendTyping(){
  var el = document.createElement("div");
  el.className = "ai-msg bot typing";
  el.innerHTML = '<span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span>';
  els.msgs.appendChild(el);
  scrollBottom();
  return { remove: function(){ if(el.parentNode) el.parentNode.removeChild(el); } };
}

function scrollBottom(){
  els.body.scrollTop = els.body.scrollHeight;
}

/* 只允许站内视图与帮助中心；模型或文档里出现的其他链接一律丢弃 */
function isSafeHref(href){
  href = String(href || "");
  if(href.indexOf("#/") === 0) return true;
  return href.indexOf("help.html#/") === 0;
}

function appendLinkChips(container, links){
  var wrap = document.createElement("div");
  wrap.className = "ai-links";
  var count = 0;
  (links || []).forEach(function(l){
    if(!l) return;
    var href = String(l.href || "");
    if(!isSafeHref(href)) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ai-link";
    b.setAttribute("data-ai-href", href);
    var ext = href.indexOf("help.html") === 0;
    b.innerHTML = esc(l.label || href) + icon(ext ? "extlink" : "right", 12);
    wrap.appendChild(b);
    count++;
  });
  if(count) container.appendChild(wrap);
}

function renderMarkdown(body, text){
  ensureMarkdown().then(function(ok){
    if(!ok){
      body.textContent = text;
      scrollBottom();
      return;
    }
    var html = "";
    try{ html = window.marked.parse(text, { gfm: true, breaks: true }); }catch(e){ html = ""; }
    body.innerHTML = window.DOMPurify.sanitize(html);
    Array.prototype.slice.call(body.querySelectorAll("a")).forEach(function(a){
      var href = a.getAttribute("href") || "";
      if(isSafeHref(href)){
        a.setAttribute("data-ai-href", href);
      }else{
        a.parentNode.replaceChild(document.createTextNode(a.textContent || ""), a);
      }
    });
    scrollBottom();
  });
}

function ensureMarkdown(){
  if(window.marked && window.DOMPurify) return Promise.resolve(true);
  if(mdPromise) return mdPromise;
  function load(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  mdPromise = load(API.url("/vendor/markdown/marked.min.js"))
    .then(function(){ return load(API.url("/vendor/markdown/purify.min.js")); })
    .then(function(){ return true; })
    .catch(function(){ mdPromise = null; return false; });
  return mdPromise;
}

/* ==================== 草稿卡片 ==================== */

function normalizeDraft(d){
  return {
    title: d.title || "",
    description: d.description || "",
    itemType: TYPE_LABEL[d.itemType] ? d.itemType : "task",
    reqId: d.reqId || "",
    priority: d.priority || "",
    startDate: d.startDate || "",
    dueDate: d.dueDate || "",
    severity: d.severity || "",
    boardColumn: d.boardColumn || "backlog"
  };
}

function copyDraft(){
  return {
    title: draft.title || "",
    description: draft.description || "",
    itemType: draft.itemType || "task",
    reqId: draft.reqId || "",
    priority: draft.priority || "",
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    severity: draft.severity || "",
    boardColumn: draft.boardColumn || "backlog"
  };
}

function projectOptions(){
  var list = (boot && boot.projects) || [];
  if(!list.length){
    draft.reqId = "";
    return '<option value="">没有可写项目</option>';
  }
  var found = false;
  var html = ['<option value="">请选择项目</option>'];
  list.forEach(function(p){
    var on = p.id === draft.reqId;
    if(on) found = true;
    html.push('<option value="' + esc(p.id) + '"' + (on ? " selected" : "") + '>' + esc(p.name) + '</option>');
  });
  /* 服务端草稿里的项目不在可写集合中时，宁可清空也不展示 */
  if(!found) draft.reqId = "";
  return html.join("");
}

function severityOptions(){
  return '<option value="">请选择</option>' + SEVERITIES.map(function(s){
    return '<option value="' + s[0] + '"' + (draft.severity === s[0] ? " selected" : "") + '>' + s[1] + '</option>';
  }).join("");
}

function dateRangeText(){
  if(draft.startDate && draft.dueDate) return draft.startDate + " → " + draft.dueDate;
  if(draft.dueDate) return "截止 " + draft.dueDate;
  if(draft.startDate) return "开始 " + draft.startDate;
  return "";
}

function renderDraft(){
  if(!draft || !requestId){ clearDraft(); return; }
  var slot = els.draftSlot;
  var desc = String(draft.description || "").trim();
  var dates = dateRangeText();
  slot.hidden = false;
  slot.innerHTML =
    '<div class="ai-draft-card">' +
      '<div class="ai-draft-head">' + icon("checklist", 14) + '<span>待确认的工作项</span>' +
        '<button class="ai-icon-btn" type="button" data-ai-discard aria-label="放弃草稿">' + icon("close", 14) + '</button>' +
      '</div>' +
      '<label class="ai-field"><span>标题</span>' +
        '<input type="text" maxlength="60" data-ai-title value="' + esc(draft.title) + '" placeholder="给工作项起个名字" />' +
      '</label>' +
      '<div class="ai-field-row">' +
        '<label class="ai-field"><span>所属项目</span><select data-ai-req>' + projectOptions() + '</select></label>' +
        (draft.itemType === "bug"
          ? '<label class="ai-field"><span>严重度</span><select data-ai-sev>' + severityOptions() + '</select></label>'
          : "") +
      '</div>' +
      '<div class="ai-chips">' +
        '<span class="ai-chip">' + esc(TYPE_LABEL[draft.itemType] || "任务") + '</span>' +
        (draft.priority ? '<span class="ai-chip">' + esc(PRIO_LABEL[draft.priority] || draft.priority) + '</span>' : "") +
        (dates ? '<span class="ai-chip">' + esc(dates) + '</span>' : "") +
      '</div>' +
      (desc ? '<div class="ai-draft-desc">' + esc(desc) + '</div>' : "") +
      '<div class="ai-draft-note" data-ai-note></div>' +
      '<div class="ai-draft-foot">' +
        '<button class="btn sm" type="button" data-ai-discard>放弃</button>' +
        '<button class="btn sm primary" type="button" data-ai-confirm>确认创建</button>' +
      '</div>' +
    '</div>';
  syncDraftState();
}

function readDraftInputs(){
  if(!draft) return;
  var t = els.draftSlot.querySelector("[data-ai-title]");
  var r = els.draftSlot.querySelector("[data-ai-req]");
  var s = els.draftSlot.querySelector("[data-ai-sev]");
  if(t) draft.title = t.value;
  if(r) draft.reqId = r.value;
  if(s) draft.severity = s.value;
}

function syncDraftState(){
  if(!draft) return;
  readDraftInputs();
  var need = [];
  if(!(draft.title || "").trim()) need.push("标题");
  if(!draft.reqId) need.push("所属项目");
  if(draft.itemType === "bug" && !draft.severity) need.push("严重度");
  var extra = (missing || []).filter(function(m){
    return m && m.field !== "title" && m.field !== "reqId" && m.field !== "severity";
  }).map(function(m){ return m.label || m.field; });
  need = need.concat(extra);

  var btn = els.draftSlot.querySelector("[data-ai-confirm]");
  if(btn) btn.disabled = need.length > 0 || !requestId;
  var note = els.draftSlot.querySelector("[data-ai-note]");
  if(note){
    note.textContent = need.length
      ? ("还需要补充：" + need.join("、"))
      : "确认后创建到「待处理」列；负责人、版本等可在工作项里继续补充。";
  }
}

function clearDraft(){
  draft = null;
  requestId = "";
  missing = [];
  if(!els) return;
  els.draftSlot.hidden = true;
  els.draftSlot.innerHTML = "";
}

function confirmDraft(){
  if(!draft || !requestId) return;
  syncDraftState();
  var btn = els.draftSlot.querySelector("[data-ai-confirm]");
  if(btn && btn.disabled) return;

  var title = String(draft.title || "").trim();
  if(!title){ toast("请填写任务标题", "warn"); return; }
  if(!draft.reqId){ toast("请选择所属项目", "warn"); return; }
  if(draft.itemType === "bug" && !draft.severity){ toast("请选择缺陷严重度", "warn"); return; }

  if(btn){ btn.disabled = true; btn.textContent = "创建中…"; }

  var payload = { requestId: requestId, reqId: draft.reqId, title: title };
  if(draft.itemType === "bug") payload.severity = draft.severity;

  API.post("/api/ai/assistant/tasks/confirm", payload).then(function(res){
    var createdTitle = (res && res.title) || title;
    var href = (res && res.href) || "";
    clearDraft();
    appendBot("已创建工作项「" + createdTitle + "」。", href ? [{ label: "打开工作项", href: href }] : []);
    toast("已创建工作项", "fs");
    loadBoard({ silent: true });
    loadReqs();
  }).catch(function(ex){
    if(btn){ btn.disabled = false; btn.textContent = "确认创建"; }
    appendError((ex && ex.message) || "创建失败，请稍后重试");
    if(ex && (ex.code === 403 || ex.code === 404)) clearDraft();
    else syncDraftState();
  });
}

/* ==================== 站内跳转 ==================== */

function goHref(href){
  if(!isSafeHref(href)) return;
  if(href.indexOf("help.html#/") === 0){
    window.open(API.appBase + "/" + href, "_blank", "noopener");
    return;
  }
  var raw = href.replace(/^#\//, "");
  var qi = raw.indexOf("?");
  var view = qi >= 0 ? raw.substring(0, qi) : raw;
  var query = qi >= 0 ? raw.substring(qi + 1) : "";
  var params = {};
  query.split("&").forEach(function(p){
    if(!p) return;
    var kv = p.split("=");
    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
  });
  if(!VIEWS[view]) return;
  if(view === "board" && params.task){
    showView("board").then(function(){ openTaskById(params.task); closePanel(); });
    return;
  }
  if(view === "board" && params.new === "1"){
    showView("board").then(function(){ openTaskDrawer("backlog"); closePanel(); });
    return;
  }
  showView(view).then(function(){ closePanel(); });
}

export { initAssistant, isAssistantEnabled, setAssistantEnabled };
