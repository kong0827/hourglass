/* core/release-ai.js · 交付说明页「AI 摘要」：把系统事实写成发布说明草稿
 *
 * 边界（改之前先读）：
 *   1. 只读：不保存交付说明、不写快照，草稿只存在页面里，复制与否由用户决定；
 *   2. 事实由后端按当前交付说明聚合（可见范围与页面一致），前端不自己拼数字；
 *   3. 按钮运行时注入 .dl-acts，不改交付说明模板，避免和正在改该页的批次互相踩；
 *   4. 重新生成会覆盖已改文字，改过时先确认。
 */
import { API } from "./api.js";
import { icon } from "./icons.js";
import { activeView } from "./router.js";
import { copyToClipboard, esc, toast } from "./ui.js";

var observer = null;
var scanTimer = null;
var panel = null;
var els = null;
var state = {
  open: false,
  busy: false,
  generatedText: "",
  scope: null,
  basis: []
};

function initReleaseAi(){
  if(observer) return;
  observer = new MutationObserver(function(){
    if(scanTimer) return;
    scanTimer = setTimeout(function(){
      scanTimer = null;
      scan();
    }, 80);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && state.open){ e.stopPropagation(); close(); }
  }, true);
  document.addEventListener("ds:view-change", function(){
    if(state.open) close();
    scan();
  });
  window.addEventListener("hashchange", scan);
  scan();
}

/* ==================== 按钮注入 ==================== */

function scan(){
  if(activeView !== "delivery") return;
  var acts = document.querySelector(".dl-acts");
  if(!acts || acts.querySelector("[data-ai-release-summary]")) return;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn sm ghost";
  btn.setAttribute("data-ai-release-summary", "1");
  btn.title = "按当前交付说明的系统记录生成发布摘要草稿，不会保存";
  btn.innerHTML = icon("ai", 13) + "AI 摘要";
  var exportBtn = acts.querySelector('[data-dl-act="export"]');
  acts.insertBefore(btn, exportBtn || null);
}

/* ==================== 面板 ==================== */

function buildPanel(){
  if(panel) return;
  panel = document.createElement("div");
  panel.className = "ai-release-layer";
  panel.hidden = true;
  panel.innerHTML =
    '<div class="ai-release-mask" data-ai-release-close></div>' +
    '<section class="ai-release-panel" role="dialog" aria-modal="true" aria-label="AI 发布摘要">' +
      '<header class="ai-release-head">' +
        '<div><b>AI 发布摘要（草稿）</b><span id="aiReleaseScope">正在读取当前交付说明…</span></div>' +
        '<button class="ai-icon-btn" type="button" data-ai-release-close aria-label="关闭">' + icon("close", 16) + '</button>' +
      '</header>' +
      '<details class="ai-release-basis" id="aiReleaseBasis" hidden>' +
        '<summary id="aiReleaseBasisSummary">依据</summary>' +
        '<ul id="aiReleaseBasisList"></ul>' +
      '</details>' +
      '<textarea id="aiReleaseText" spellcheck="false" aria-label="发布摘要草稿"></textarea>' +
      '<p class="ai-release-tip">草稿不会保存，也不会进入快照；可以直接修改后再复制。' +
        '数字与日期来自交付说明的系统记录，发布前请再核对一遍。</p>' +
      '<footer class="ai-release-foot">' +
        '<span id="aiReleaseUsage" class="ai-release-usage"></span>' +
        '<span class="ai-release-spacer"></span>' +
        '<button class="btn sm" type="button" data-ai-release-copy>复制全文</button>' +
        '<button class="btn sm" type="button" data-ai-release-again>重新生成</button>' +
        '<button class="btn sm ghost" type="button" data-ai-release-close>关闭</button>' +
      '</footer>' +
    '</section>';
  document.body.appendChild(panel);
  els = {
    scope: panel.querySelector("#aiReleaseScope"),
    basis: panel.querySelector("#aiReleaseBasis"),
    basisSummary: panel.querySelector("#aiReleaseBasisSummary"),
    basisList: panel.querySelector("#aiReleaseBasisList"),
    text: panel.querySelector("#aiReleaseText"),
    usage: panel.querySelector("#aiReleaseUsage"),
    copy: panel.querySelector("[data-ai-release-copy]"),
    again: panel.querySelector("[data-ai-release-again]")
  };
}

function onClick(e){
  var trigger = e.target.closest && e.target.closest("[data-ai-release-summary]");
  if(trigger){
    e.preventDefault();
    open();
    return;
  }
  if(!state.open) return;
  if(e.target.closest("[data-ai-release-close]")){
    e.preventDefault();
    close();
    return;
  }
  if(e.target.closest("[data-ai-release-copy]")){
    e.preventDefault();
    copyDraft();
    return;
  }
  if(e.target.closest("[data-ai-release-again]")){
    e.preventDefault();
    regenerate();
  }
}

function open(){
  buildPanel();
  var scope = scopeFromHash();
  if(!scope){
    toast("先打开一份版本或发布计划的交付说明", "warn");
    return;
  }
  state.open = true;
  state.scope = scope;
  panel.hidden = false;
  document.body.classList.add("ai-release-open");
  generate();
}

function close(){
  if(!panel) return;
  state.open = false;
  panel.hidden = true;
  document.body.classList.remove("ai-release-open");
}

function regenerate(){
  if(state.busy) return;
  var current = els.text.value.trim();
  if(current && current !== state.generatedText
    && !window.confirm("重新生成会覆盖你改过的内容，继续？")){
    return;
  }
  generate();
}

function copyDraft(){
  var text = els.text.value.trim();
  if(!text){
    toast("还没有可复制的摘要", "warn");
    return;
  }
  copyToClipboard(text, "已复制发布摘要，可粘贴到发布记录或公告");
}

/* ==================== 生成 ==================== */

function scopeFromHash(){
  var raw = String(window.location.hash || "");
  var q = raw.indexOf("?") >= 0 ? raw.slice(raw.indexOf("?") + 1) : "";
  var params = {};
  q.split("&").forEach(function(part){
    if(!part) return;
    var i = part.indexOf("=");
    var k = i >= 0 ? part.slice(0, i) : part;
    var v = i >= 0 ? part.slice(i + 1) : "";
    try{ params[decodeURIComponent(k)] = decodeURIComponent(v); }catch(e){ params[k] = v; }
  });
  if(params.planId) return { scopeType: "plan", scopeId: params.planId };
  if(params.versionId) return {
    scopeType: "version", scopeId: params.versionId, releaseId: params.releaseId || ""
  };
  return null;
}

function generate(){
  if(state.busy || !state.scope) return;
  state.busy = true;
  state.generatedText = "";
  state.basis = [];
  els.text.value = "";
  els.text.disabled = true;
  els.text.placeholder = "正在根据系统记录生成，通常 5–15 秒…";
  els.usage.textContent = "";
  els.copy.disabled = true;
  els.again.disabled = true;
  els.basis.hidden = true;
  els.scope.textContent = "";

  var payload = {
    scopeType: state.scope.scopeType,
    scopeId: state.scope.scopeId
  };
  if(state.scope.releaseId) payload.releaseId = state.scope.releaseId;

  API.post("/api/ai/release-summary", payload).then(function(res){
    if(!state.open) return;
    state.generatedText = String((res && res.markdown) || "");
    els.scope.textContent = (res && res.title ? res.title : "发布摘要") + " · 内容只来自系统记录";
    els.text.value = state.generatedText;
    els.usage.textContent = usageText(res && res.usage);
    renderBasis(res && res.basis, res && res.missing);
    if(!state.generatedText){
      els.text.placeholder = "AI 没有返回内容，点「重新生成」再试";
    }
  }).catch(function(ex){
    if(!state.open) return;
    renderError(ex);
  }).then(function(){
    state.busy = false;
    if(!state.open) return;
    els.text.disabled = false;
    els.text.placeholder = "在这里修改摘要，再复制出去";
    els.copy.disabled = !els.text.value.trim();
    els.again.disabled = false;
    if(els.text.value.trim()){
      try{ els.text.focus(); }catch(e){ /* noop */ }
    }
  });
}

function renderBasis(basis, missing){
  state.basis = Array.isArray(basis) ? basis.slice(0, 40) : [];
  var miss = Array.isArray(missing) ? missing : [];
  if(!state.basis.length && !miss.length){
    els.basis.hidden = true;
    return;
  }
  els.basis.hidden = false;
  els.basisSummary.textContent = "依据：" + state.basis.length + " 条系统事实"
    + (miss.length ? " · " + miss.length + " 项无记录" : "");
  els.basisList.innerHTML = state.basis.map(function(s){
    return "<li>" + esc(s) + "</li>";
  }).join("") + miss.map(function(s){
    return '<li class="miss">未记录：' + esc(s) + "</li>";
  }).join("");
}

function renderError(ex){
  var msg = (ex && ex.message) || "生成失败，请稍后重试";
  els.scope.textContent = "生成失败";
  els.text.value = "";
  els.text.disabled = false;
  els.text.placeholder = msg;
  els.copy.disabled = true;
  els.again.disabled = false;
  els.usage.textContent = "";
  els.basis.hidden = true;
  if(/配置|AI|Key|密钥|模型|额度|管理员/.test(msg)){
    els.scope.innerHTML = esc(msg) + ' <a href="#/profile" target="_blank" rel="noopener">去 AI 设置</a>';
  }
}

function usageText(u){
  if(!u) return "";
  return (u.totalTokens || 0) + " tokens · " + (u.sourceLabel || "我的额度");
}

export { initReleaseAi };
