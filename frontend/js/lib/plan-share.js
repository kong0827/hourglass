/* 发布计划分享：管理端生成 / 复制 / 预览 / 停止只读链接。
   公开页只展示计划范围与时间，不含备注、风险与内部检查；接收人无需登录。 */

import { API } from "../core/api.js";
import { icon } from "../core/icons.js";
import { UI, esc, toast } from "../core/ui.js";

function shareURL(token) {
  var q = "token=" + encodeURIComponent(token) + "&kind=plan";
  if (location.protocol === "file:") return "share.html?" + q;
  return location.origin + API.appBase + "/share.html?" + q;
}

function copyText(text, okMsg, failMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast(okMsg, "fs"); })
      .catch(function () { toast(failMsg, "warn"); });
    return;
  }
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  toast(ok ? okMsg : failMsg, ok ? "fs" : "warn");
}

function modal(html) {
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet sm">' + html + "</div>";
  layer.__uiOnClose = function () { setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 0); };
  document.body.appendChild(layer);
  UI.openModal(layer);
  return layer;
}

export function openPlanShare(planId) {
  if (!planId) { toast("先选择或保存一份发布计划，再生成分享链接", "warn"); return; }
  var layer = modal(
    '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0"><h2>分享发布计划</h2>'
    + '<div class="desc">拿到链接的人无需登录即可查看计划时间、覆盖版本与范围工作项；不含备注、风险与内部检查。</div></div>'
    + '<button class="icon-btn sm" type="button" data-ps-close aria-label="关闭">' + icon("close", 15) + "</button></div>"
    + '<div class="sheet-body" id="psShareBody">' + UI.skeletonRows(2) + "</div>"
    + '<div class="sheet-foot"><span class="hint">只读链接，计划内容随负责人修改实时更新</span>'
    + '<button class="btn" type="button" data-ps-close>关闭</button></div>'
  );
  var body = layer.querySelector("#psShareBody");
  var state = { info: null, busy: false };

  function paint() {
    if (!body) return;
    var info = state.info;
    if (info && info.token) {
      body.innerHTML = '<div class="dl-rfield"><span class="rl">只读链接</span><div class="dl-share-url">'
        + '<input class="input" type="text" readonly value="' + esc(shareURL(info.token)) + '" aria-label="只读链接">'
        + '<button class="btn sm" type="button" data-ps-copy>' + icon("copy", 13) + "复制</button></div></div>"
        + '<div class="dl-kvs"><div class="dl-kvbox"><span>生成时间</span><strong>' + esc(fmtTime(info.createdAt))
        + '</strong></div><div class="dl-kvbox"><span>访问方式</span><strong>无需登录</strong></div>'
        + '<div class="dl-kvbox"><span>可见内容</span><strong>计划与范围</strong></div></div>'
        + '<div class="dl-caliber">链接长期有效，可随时停止分享；停止后旧链接立即失效，已打开的页面刷新也无法再看到。</div>'
        + '<div class="dl-narr-bar">'
        + '<button class="btn sm" type="button" data-ps-open>' + icon("extlink", 13) + "预览接收人页</button>"
        + '<button class="btn sm danger" type="button" data-ps-revoke>' + icon("close", 13) + "停止分享</button></div>";
      return;
    }
    body.innerHTML = '<div class="dl-caliber">'
      + "任何拿到链接的人都可以查看：计划时间、环境与覆盖、覆盖的版本、范围工作项与负责人。"
      + "<br>备注、风险与内部检查不会出现在分享页；计划只是意图，实际发布以发布记录为准。</div>"
      + '<button class="btn primary block" type="button" data-ps-gen>' + icon("share", 13) + "生成只读链接</button>";
  }

  function load() {
    API.get("/api/release-plans/" + encodeURIComponent(planId) + "/share").then(function (info) {
      state.info = info && info.token ? info : null;
      paint();
    }).catch(function (ex) {
      if (body) body.innerHTML = '<div class="dl-caliber">' + esc(ex.message || "读取分享状态失败") + "</div>";
    });
  }

  function generate() {
    if (state.busy) return;
    state.busy = true;
    var btn = layer.querySelector("[data-ps-gen]");
    if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
    API.post("/api/release-plans/" + encodeURIComponent(planId) + "/share", {}).then(function (info) {
      state.info = info && info.token ? info : null;
      paint();
      toast("只读链接已生成", "fs");
    }).catch(function (ex) {
      toast(ex.message || "生成链接失败", "bad");
      paint();
    }).then(function () { state.busy = false; });
  }

  layer.addEventListener("click", function (e) {
    if (e.target.closest("[data-ps-close]")) { UI.closeModal(layer); return; }
    if (e.target.closest("[data-ps-copy]")) {
      if (state.info && state.info.token) copyText(shareURL(state.info.token), "链接已复制", "复制失败，请手动选择链接");
      return;
    }
    if (e.target.closest("[data-ps-open]")) {
      if (state.info && state.info.token) window.open(shareURL(state.info.token), "_blank", "noopener");
      return;
    }
    if (e.target.closest("[data-ps-gen]")) { generate(); return; }
    if (e.target.closest("[data-ps-revoke]")) {
      UI.showConfirm({
        title: "停止分享", okText: "停止分享",
        msg: "已发出的链接会立即失效，接收人再打开会看到失效提示；计划本身不受影响。"
      }).then(function (ok) {
        if (!ok) return;
        API.del("/api/release-plans/" + encodeURIComponent(planId) + "/share").then(function () {
          state.info = null;
          paint();
          toast("已停止分享", "fs");
        }).catch(function (ex) { toast(ex.message || "停止分享失败", "bad"); });
      });
    }
  });

  load();
}

function fmtTime(v) {
  return v ? String(v).replace("T", " ").slice(0, 16) : "—";
}
