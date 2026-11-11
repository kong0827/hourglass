/* core/assistant.js · 右下角 AI 助手：问答、入口建议，以及建任务/提需求/需求流转/工作项移列的草稿确认
 *
 * 权限边界（改之前先读）：
 *   1. 项目下拉只来自 /api/ai/assistant/bootstrap 下发的「可写项目」，前端不自行拼选项；
 *   2. 入口链接只允许站内 #/ 与 help.html#/，其余一律不渲染；
 *   3. 任何写操作一律带上服务端下发的 requestId，最终由后端重新解析目标、校验权限与状态；
 *   4. 回答正文里的链接同样按白名单过滤，不信任模型输出；
 *   5. 页面上下文（打开的工作项/需求 id）只是线索，服务端按可见范围重新解析。
 */

import { API } from "./api.js";
import { icon } from "./icons.js";
import { VIEWS, activeView, showView } from "./router.js";
import { UI, esc, toast } from "./ui.js";
import { rt } from "./state.js";
import { loadView, viewModule } from "./view-loader.js";
import { openTaskById } from "./task-actions.js";
import { openTaskDrawer } from "./task-drawer.js";
import { loadBoard, loadReqs } from "../views/board.js";

var MAX_HISTORY = 8;
var ACTION_INTENTS = { create_task: 1, create_demand: 1, demand_action: 1, move_task: 1, clarify: 1 };
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
        '<p class="ai-welcome-title">可以帮你找到入口，也能按自然语言建工作项、提需求、推进需求状态和移动工作项。</p>' +
        '<p class="ai-welcome-sub" id="aiWelcomeSub">只会使用你当前空间内有权限的项目；每次修改都要你确认，并写入操作记录。</p>' +
        '<div class="ai-suggest" id="aiSuggest"></div>' +
      '</div>' +
      '<div class="ai-msgs" id="aiMsgs"></div>' +
    '</div>' +
    '<div class="ai-draft-slot" id="aiDraftSlot" hidden></div>' +
    '<form class="ai-compose" id="aiForm">' +
      '<textarea id="aiInput" rows="1" maxlength="2000" placeholder="问点什么，或直接说：在 XX 项目提个需求 / 把某需求评审通过…"></textarea>' +
      '<button class="ai-send" id="aiSend" type="submit" aria-label="发送">' + icon("up", 16) + '</button>' +
    '</form>' +
    '<div class="ai-foot" id="aiFoot">只读取你有权访问的项目 · 修改前需确认</div>';

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
  els.draftSlot.addEventListener("change", onDraftChange);
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
  els.foot.textContent = "只读取你有权访问的项目 · 修改前需确认";
  els.foot.title = boot.privacyNotice || "";
  if(!boot.canCreate){
    els.welcomeSub.textContent = "当前空间里你没有可写的项目，助手只能回答问题，不能创建或修改工作项与需求。";
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
    context: currentContext()
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
  } else if(ACTION_INTENTS[res.intent] && !draft && !question){
    /* 模型想执行操作却没给可用草稿：只提示补充，不凭空造卡片 */
    appendNote("请把要操作的对象（工作项或需求标题）和所属项目再说具体一点。");
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

/* ==================== 草稿卡片 ====================
   四类动作共用一张卡：create_task 建工作项 / create_demand 提需求 / demand_action 需求流转 / move_task 工作项移列。
   卡片上的选项全部来自服务端草稿（可写项目、当前可执行流转、可排期版本、看板列、按可见范围检索出的候选）；
   前端只负责展示和改选，确认时服务端会按当前权限与目标最新状态重新校验。 */

var ITEM_KINDS = ["新功能", "体验优化", "缺陷", "其他"];
var NOTE_REQUIRED = { rej: 1, replan: 1, unplan: 1, cancel: 1, restore: 1 };
var ACTION_NAME = { pass: "通过", rej: "拒绝", plan: "排期", replan: "调期", unpass: "撤回评审",
  unplan: "撤销排期", cancel: "取消", restore: "恢复", reopen: "重新打开" };
var STATUS_NAME = { review: "待评审", pass: "已通过", plan: "已排期", rej: "已拒绝", canceled: "已取消" };
var TARGET_STATUS = { pass: "pass", rej: "rej", plan: "plan", replan: "plan", unpass: "review",
  reopen: "review", unplan: "pass", restore: "pass", cancel: "canceled" };
var CARD_TITLE = { create_task: "待确认的工作项", create_demand: "待确认的需求",
  demand_action: "待确认的需求流转", move_task: "待确认的工作项流转" };

function list(v){ return Array.isArray(v) ? v.slice() : []; }

function normalizeDraft(d){
  var action = CARD_TITLE[d.action] ? d.action : "create_task";
  return {
    action: action,
    title: d.title || "",
    description: d.description || "",
    itemType: TYPE_LABEL[d.itemType] ? d.itemType : "task",
    reqId: d.reqId || "",
    projectName: d.projectName || "",
    priority: d.priority || "",
    startDate: d.startDate || "",
    dueDate: d.dueDate || "",
    severity: d.severity || "",
    boardColumn: d.boardColumn || "backlog",
    itemKind: ITEM_KINDS.indexOf(d.itemKind) >= 0 ? d.itemKind : "新功能",
    source: d.source || "",
    expectDate: d.expectDate || "",
    demandId: d.demandId || "",
    demandTitle: d.demandTitle || "",
    demandStatus: d.demandStatus || "",
    demandStatusName: d.demandStatusName || STATUS_NAME[d.demandStatus] || "",
    demandAction: d.demandAction || "",
    note: d.note || "",
    versionId: d.versionId || "",
    versionName: d.versionName || "",
    taskId: d.taskId || "",
    taskTitle: d.taskTitle || "",
    currentColumn: d.currentColumn || "",
    currentColumnName: d.currentColumnName || "",
    targetColumn: d.targetColumn || "",
    reason: d.reason || "",
    allowedActions: list(d.allowedActions),
    versions: list(d.versions),
    columns: list(d.columns),
    demandCandidates: list(d.demandCandidates),
    taskCandidates: list(d.taskCandidates)
  };
}

/* 回传给下一轮对话的上一版草稿：只带服务端 DTO 认识的字段；需求/工作项标题不回传，避免进提示词 */
function copyDraft(){
  return {
    action: draft.action,
    title: draft.action === "create_task" || draft.action === "create_demand" ? (draft.title || "") : "",
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

function writableProjects(){ return (boot && boot.projects) || []; }

function projectOptions(){
  var projects = writableProjects();
  if(!projects.length){
    draft.reqId = "";
    return '<option value="">没有可写项目</option>';
  }
  var found = false;
  var html = ['<option value="">请选择项目</option>'];
  projects.forEach(function(p){
    var on = p.id === draft.reqId;
    if(on) found = true;
    html.push('<option value="' + esc(p.id) + '"' + (on ? " selected" : "") + '>' + esc(p.name) + '</option>');
  });
  /* 服务端草稿里的项目不在可写集合中时，宁可清空也不展示 */
  if(!found) draft.reqId = "";
  return html.join("");
}

function optionsHTML(options, selected, placeholder){
  var html = placeholder == null ? [] : ['<option value="">' + esc(placeholder) + '</option>'];
  var found = false;
  options.forEach(function(o){
    var on = o.value === selected;
    if(on) found = true;
    html.push('<option value="' + esc(o.value) + '"' + (on ? " selected" : "") + '>' + esc(o.label) + '</option>');
  });
  return { html: html.join(""), found: found };
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

function chip(text){ return text ? '<span class="ai-chip">' + esc(text) + '</span>' : ""; }

function descHTML(){
  var desc = String(draft.description || "").trim();
  return desc ? '<div class="ai-draft-desc">' + esc(desc) + '</div>' : "";
}

function createTaskBody(){
  return '<label class="ai-field"><span>标题</span>' +
      '<input type="text" maxlength="60" data-ai-title value="' + esc(draft.title) + '" placeholder="给工作项起个名字" />' +
    '</label>' +
    '<div class="ai-field-row">' +
      '<label class="ai-field"><span>所属项目</span><select data-ai-req>' + projectOptions() + '</select></label>' +
      (draft.itemType === "bug"
        ? '<label class="ai-field"><span>严重度</span><select data-ai-sev>' + severityOptions() + '</select></label>'
        : "") +
    '</div>' +
    '<div class="ai-chips">' +
      chip(TYPE_LABEL[draft.itemType] || "任务") +
      chip(draft.priority ? (PRIO_LABEL[draft.priority] || draft.priority) : "") +
      chip(dateRangeText()) +
    '</div>' + descHTML();
}

function createDemandBody(){
  var kinds = optionsHTML(ITEM_KINDS.map(function(k){ return { value: k, label: k }; }), draft.itemKind, null);
  return '<label class="ai-field"><span>需求标题</span>' +
      '<input type="text" maxlength="80" data-ai-title value="' + esc(draft.title) + '" placeholder="一句话说清要做什么" />' +
    '</label>' +
    '<div class="ai-field-row">' +
      '<label class="ai-field"><span>所属项目</span><select data-ai-req>' + projectOptions() + '</select></label>' +
      '<label class="ai-field"><span>需求类型</span><select data-ai-kind>' + kinds.html + '</select></label>' +
    '</div>' +
    '<div class="ai-chips">' +
      chip(draft.priority ? (PRIO_LABEL[draft.priority] || draft.priority) : "") +
      chip(draft.expectDate ? "期望 " + draft.expectDate : "") +
      chip(draft.source ? "来源 " + draft.source : "") +
    '</div>' + descHTML();
}

function demandActionBody(){
  var html = "";
  if(!draft.demandId){
    if(!draft.demandCandidates.length){
      return '<div class="ai-target"><div class="ai-target-meta">没有在你可见的项目里找到匹配的需求，换个标题关键词再说一次。</div></div>';
    }
    var cands = optionsHTML(draft.demandCandidates, "", "请选择需求");
    return '<label class="ai-field"><span>匹配到多条需求，选一条</span><select data-ai-demand>' + cands.html + '</select></label>';
  }
  html += '<div class="ai-target">' +
      '<div class="ai-target-title">' + esc(draft.demandTitle || "需求") + '</div>' +
      (draft.projectName ? '<div class="ai-target-meta">' + esc(draft.projectName) + '</div>' : "") +
      '<div class="ai-flow"><span class="ai-flow-from">' + esc(draft.demandStatusName || "") + '</span>' +
        (draft.demandAction ? icon("right", 12) + '<span class="ai-flow-to">' +
          esc(STATUS_NAME[TARGET_STATUS[draft.demandAction]] || "") + '</span>' : "") +
      '</div>' +
    '</div>';
  if(!draft.allowedActions.length){
    return html + '<div class="ai-draft-note">你在当前状态下没有可执行的流转。</div>';
  }
  var acts = optionsHTML(draft.allowedActions, draft.demandAction, "请选择动作");
  if(!acts.found) draft.demandAction = "";
  html += '<label class="ai-field"><span>流转动作</span><select data-ai-action>' + acts.html + '</select></label>';
  if(draft.demandAction === "plan" || draft.demandAction === "replan"){
    var keep = draft.versionName ? "保持当前：" + draft.versionName : "不指定版本";
    var vers = optionsHTML(draft.versions, draft.versionId, keep);
    if(!vers.found) draft.versionId = "";
    html += '<label class="ai-field"><span>目标版本</span><select data-ai-version>' + vers.html + '</select></label>';
  }
  if(draft.demandAction){
    var need = !!NOTE_REQUIRED[draft.demandAction];
    html += '<label class="ai-field"><span>' + esc(ACTION_NAME[draft.demandAction] || "") + '原因 ' +
        (need ? '<em class="req">必填</em>' : '<em>选填</em>') + '</span>' +
      '<textarea maxlength="500" data-ai-note placeholder="会写入需求的操作记录">' + esc(draft.note) + '</textarea></label>';
  }
  return html;
}

function moveTaskBody(){
  var html = "";
  if(!draft.taskId){
    if(!draft.taskCandidates.length){
      html += '<div class="ai-target"><div class="ai-target-meta">没有在你可见的项目里找到匹配的工作项，换个标题关键词再说一次。</div></div>';
    } else {
      var cands = optionsHTML(draft.taskCandidates, "", "请选择工作项");
      html += '<label class="ai-field"><span>匹配到多个工作项，选一个</span><select data-ai-task>' + cands.html + '</select></label>';
    }
  } else {
    html += '<div class="ai-target">' +
        '<div class="ai-target-title">' + esc(draft.taskTitle || "工作项") + '</div>' +
        (draft.projectName ? '<div class="ai-target-meta">' + esc(draft.projectName) + '</div>' : "") +
        '<div class="ai-flow"><span class="ai-flow-from">' + esc(draft.currentColumnName || "") + '</span>' +
          (draft.targetColumn ? icon("right", 12) + '<span class="ai-flow-to">' + esc(columnLabel(draft.targetColumn)) + '</span>' : "") +
        '</div>' +
      '</div>';
  }
  var cols = draft.columns.filter(function(c){ return !draft.currentColumn || c.value !== draft.currentColumn; });
  var colSel = optionsHTML(cols, draft.targetColumn, "请选择目标列");
  if(!colSel.found) draft.targetColumn = "";
  html += '<label class="ai-field"><span>移到</span><select data-ai-column>' + colSel.html + '</select></label>' +
    '<label class="ai-field"><span>说明 <em>选填，部分流转规则要求填写</em></span>' +
      '<textarea maxlength="500" data-ai-note placeholder="会写入工作项的操作记录">' + esc(draft.reason) + '</textarea></label>';
  return html;
}

function columnLabel(id){
  for(var i = 0; i < draft.columns.length; i++){
    if(draft.columns[i].value === id) return draft.columns[i].label;
  }
  return id;
}

function confirmLabel(){
  if(draft.action === "create_demand") return "确认提交";
  if(draft.action === "demand_action") return draft.demandAction ? "确认" + (ACTION_NAME[draft.demandAction] || "") : "确认执行";
  if(draft.action === "move_task") return "确认移动";
  return "确认创建";
}

function renderDraft(){
  if(!draft || !requestId){ clearDraft(); return; }
  var body = draft.action === "create_demand" ? createDemandBody()
    : draft.action === "demand_action" ? demandActionBody()
    : draft.action === "move_task" ? moveTaskBody()
    : createTaskBody();
  var slot = els.draftSlot;
  slot.hidden = false;
  slot.innerHTML =
    '<div class="ai-draft-card" data-ai-action-kind="' + esc(draft.action) + '">' +
      '<div class="ai-draft-head">' + icon("checklist", 14) + '<span>' + esc(CARD_TITLE[draft.action]) + '</span>' +
        '<button class="ai-icon-btn" type="button" data-ai-discard aria-label="放弃草稿">' + icon("close", 14) + '</button>' +
      '</div>' +
      body +
      '<div class="ai-draft-note" data-ai-hint></div>' +
      '<div class="ai-draft-foot">' +
        '<button class="btn sm" type="button" data-ai-discard>放弃</button>' +
        '<button class="btn sm primary" type="button" data-ai-confirm>' + esc(confirmLabel()) + '</button>' +
      '</div>' +
    '</div>';
  syncDraftState();
}

function field(sel){ return els.draftSlot.querySelector(sel); }

function readDraftInputs(){
  if(!draft) return;
  var t = field("[data-ai-title]"), r = field("[data-ai-req]"), s = field("[data-ai-sev]"),
      k = field("[data-ai-kind]"), n = field("[data-ai-note]"), v = field("[data-ai-version]");
  if(t) draft.title = t.value;
  if(r) draft.reqId = r.value;
  if(s) draft.severity = s.value;
  if(k) draft.itemKind = k.value;
  if(v) draft.versionId = v.value;
  if(n){
    if(draft.action === "move_task") draft.reason = n.value; else draft.note = n.value;
  }
}

/* 改选动作 / 目标列会改变卡片结构（原因必填、版本下拉、状态箭头），需要重绘 */
function onDraftChange(e){
  if(!draft) return;
  var a = e.target.closest("[data-ai-action]");
  if(a){ readDraftInputs(); draft.demandAction = a.value; renderDraft(); return; }
  var c = e.target.closest("[data-ai-column]");
  if(c){ readDraftInputs(); draft.targetColumn = c.value; renderDraft(); return; }
  var dm = e.target.closest("[data-ai-demand]");
  if(dm){ pickDemand(dm.value); return; }
  var tk = e.target.closest("[data-ai-task]");
  if(tk){ pickTask(tk.value); return; }
  syncDraftState();
}

/* 候选需求：读详情接口（服务端按可见范围校验，不可见直接 404），
   可执行动作用与服务端相同的口径预览；确认时仍由服务端按最新状态与权限复核 */
function pickDemand(id){
  if(!id) return;
  var cand = draft.demandCandidates.filter(function(c){ return c.value === id; })[0];
  API.get("/api/demands/" + encodeURIComponent(id)).then(function(d){
    if(!draft || draft.action !== "demand_action") return;
    var canWrite = writableProjects().some(function(p){ return p.id === d.reqId; });
    var canManage = !!d.canSchedule;
    var acts = previewDemandActions(d.status, canWrite, canManage);
    draft.demandId = d.id;
    draft.demandTitle = d.title || (cand && cand.label) || "";
    draft.demandStatus = d.status;
    draft.demandStatusName = STATUS_NAME[d.status] || d.status || "";
    draft.projectName = "";
    draft.allowedActions = acts.map(function(a){ return { value: a, label: ACTION_NAME[a] }; });
    if(acts.indexOf(draft.demandAction) < 0) draft.demandAction = "";
    /* 候选路径下没有服务端预取的版本列表：排期时沿用当前版本，确认时由服务端校验 */
    draft.versions = [];
    draft.versionId = "";
    draft.versionName = d.versionName || "";
    missing = (missing || []).filter(function(m){ return m.field !== "demandId"; });
    renderDraft();
  }).catch(function(ex){
    appendError((ex && ex.message) || "需求不存在或无权查看");
  });
}

function previewDemandActions(status, canWrite, canManage){
  var out = [];
  if(status === "review"){ if(canWrite){ out.push("pass"); out.push("rej"); } }
  else if(status === "pass"){ if(canWrite) out.push("unpass"); if(canManage) out.push("plan"); }
  else if(status === "plan"){ if(canManage){ out.push("replan"); out.push("unplan"); } }
  else if(status === "rej"){ if(canWrite) out.push("reopen"); }
  else if(status === "canceled"){ if(canManage) out.push("restore"); }
  if(canManage && (status === "review" || status === "pass" || status === "plan" || status === "rej")) out.push("cancel");
  return out;
}

function pickTask(id){
  if(!id) return;
  var cand = draft.taskCandidates.filter(function(c){ return c.value === id; })[0];
  readDraftInputs();
  draft.taskId = id;
  draft.taskTitle = cand ? cand.label : "";
  draft.currentColumn = "";
  draft.currentColumnName = "";
  missing = (missing || []).filter(function(m){ return m.field !== "taskId"; });
  renderDraft();
}

function draftNeeds(){
  var need = [];
  if(draft.action === "create_task" || draft.action === "create_demand"){
    if(!(draft.title || "").trim()) need.push(draft.action === "create_demand" ? "需求标题" : "标题");
    if(!draft.reqId) need.push("所属项目");
    if(draft.action === "create_task" && draft.itemType === "bug" && !draft.severity) need.push("严重度");
  } else if(draft.action === "demand_action"){
    if(!draft.demandId) need.push("目标需求");
    else if(!draft.demandAction) need.push("流转动作");
    else if(NOTE_REQUIRED[draft.demandAction] && !(draft.note || "").trim()) need.push((ACTION_NAME[draft.demandAction] || "") + "原因");
  } else if(draft.action === "move_task"){
    if(!draft.taskId) need.push("目标工作项");
    if(!draft.targetColumn) need.push("目标列");
  }
  return need;
}

function readyHint(){
  if(draft.action === "create_demand") return "确认后提交到需求池「待评审」；评审、排期仍按项目权限进行。";
  if(draft.action === "demand_action") return "确认后按你的权限与需求最新状态执行，并写入需求操作记录。";
  if(draft.action === "move_task") return "确认后按看板流转规则移动（不会强制越过规则），并写入工作项操作记录。";
  return "确认后创建到「待处理」列；负责人、版本等可在工作项里继续补充。";
}

function syncDraftState(){
  if(!draft) return;
  readDraftInputs();
  var need = draftNeeds();
  var btn = field("[data-ai-confirm]");
  if(btn) btn.disabled = need.length > 0 || !requestId;
  var hint = field("[data-ai-hint]");
  if(hint) hint.textContent = need.length ? ("还需要补充：" + need.join("、")) : readyHint();
}

function clearDraft(){
  draft = null;
  requestId = "";
  missing = [];
  if(!els) return;
  els.draftSlot.hidden = true;
  els.draftSlot.innerHTML = "";
}

function confirmPayload(){
  var p = { requestId: requestId };
  if(draft.action === "create_task" || draft.action === "create_demand"){
    p.reqId = draft.reqId;
    p.title = String(draft.title || "").trim();
    if(draft.action === "create_task" && draft.itemType === "bug") p.severity = draft.severity;
    if(draft.action === "create_demand") p.itemKind = draft.itemKind;
  } else if(draft.action === "demand_action"){
    p.demandId = draft.demandId;
    p.demandAction = draft.demandAction;
    p.note = String(draft.note || "").trim();
    if(draft.versionId) p.versionId = draft.versionId;
  } else if(draft.action === "move_task"){
    p.taskId = draft.taskId;
    p.targetColumn = draft.targetColumn;
    p.note = String(draft.reason || "").trim();
  }
  return p;
}

function confirmDraft(){
  if(!draft || !requestId) return;
  syncDraftState();
  var btn = field("[data-ai-confirm]");
  if(btn && btn.disabled) return;
  var need = draftNeeds();
  if(need.length){ toast("还需要补充：" + need.join("、"), "warn"); return; }

  var label = confirmLabel();
  var action = draft.action;
  if(btn){ btn.disabled = true; btn.textContent = "执行中…"; }

  API.post("/api/ai/assistant/tasks/confirm", confirmPayload()).then(function(res){
    res = res || {};
    clearDraft();
    afterConfirm(action, res);
  }).catch(function(ex){
    if(btn){ btn.disabled = false; btn.textContent = label; }
    appendError((ex && ex.message) || "执行失败，请稍后重试");
    /* 无权或目标不存在时草稿已不可能成功，直接作废；其余（缺原因、状态已变）保留让用户改 */
    if(ex && (ex.code === 403 || ex.code === 404)) clearDraft();
    else syncDraftState();
  });
}

function afterConfirm(action, res){
  var msg = res.message || "已完成。";
  if(res.kind === "demand"){
    var link = res.demandId ? [{ label: "查看需求", href: "#/demands?demand=" + encodeURIComponent(res.demandId) }] : [];
    appendBot((res.title ? "「" + res.title + "」" : "") + msg, link);
    toast(action === "create_demand" ? "需求已提交" : "需求已更新", "fs");
    refreshDemands(res.demandId);
    return;
  }
  var href = res.taskId ? "#/board?task=" + encodeURIComponent(res.taskId) : "";
  appendBot((res.title ? "「" + res.title + "」" : "") + msg, href ? [{ label: "打开工作项", href: href }] : []);
  toast(action === "move_task" ? "工作项已移动" : "已创建工作项", "fs");
  loadBoard({ silent: true });
  if(action === "create_task") loadReqs();
  if(action === "move_task" && res.taskId && rt.editingId === res.taskId){
    appendNote("工作项抽屉里显示的状态可能已过期，重新打开即可看到最新状态。");
  }
}

/* 需求池在别的 chunk 里：只在已加载且正处于需求池时刷新；打开着的同一需求详情已过期，直接收起 */
function refreshDemands(demandId){
  if(demandId){
    var stale = document.querySelector('.modal-layer[data-ai-demand="' + cssEscape(demandId) + '"]');
    if(stale) UI.closeModal(stale);
  }
  var m = viewModule("demands");
  if(m && activeView === "demands" && m.loadDemands) m.loadDemands();
}

function cssEscape(v){
  return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&");
}

/* 当前页面上下文：打开着的工作项抽屉 / 需求详情 / 需求池当前项目。
   只是线索：服务端会按可见范围重新解析，不可见的 id 一律当作没有上下文 */
function currentContext(){
  var ctx = { view: activeView };
  if(rt.editingId) ctx.taskId = rt.editingId;
  var dl = document.querySelector(".modal-layer[data-ai-demand]");
  if(dl) ctx.demandId = dl.getAttribute("data-ai-demand");
  if(activeView === "demands" && rt.demandReqId) ctx.projectId = rt.demandReqId;
  return ctx;
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
  if(view === "demands" && params.demand){
    closePanel();
    showView("demands").then(function(){ return loadView("demands"); }).then(function(m){
      if(m && m.openDemandDetailById) m.openDemandDetailById(params.demand);
    });
    return;
  }
  if(view === "board" && params.new === "1"){
    showView("board").then(function(){ openTaskDrawer("backlog"); closePanel(); });
    return;
  }
  showView(view).then(function(){ closePanel(); });
}

export { initAssistant, isAssistantEnabled, setAssistantEnabled };
