/* 核心 · AI 长请求：统一等待、计时、取消与重试
 *
 * 模型响应通常是 10–60 秒，按钮上的“处理中…”不足以说明还在等什么。
 * 这里只负责过程反馈，不关心业务结果：调用方传入 request(signal)，
 * 成功后在 onSuccess 里渲染自己的结果弹窗。
 */

import { $ } from "./dom.js";
import { UI, toast } from "./ui.js";

var dlg = null;
var active = null;
var running = false;
var ctrl = null;
var timer = null;
var startedAt = 0;
var seq = 0;

function ensure() {
  if (dlg) return;
  dlg = $("dlgAiProgress");
  if (!dlg) return;
  $("aiProgressCancel").addEventListener("click", function () {
    if (running) cancel();
    else close();
  });
  $("aiProgressRetry").addEventListener("click", retry);
}

function elapsedText(sec) {
  return sec < 1 ? "刚刚开始" : ("已等待 " + sec + " 秒");
}

function hintFor(sec, note) {
  if (sec >= 75) return "已等待较久，模型可能正在排队；超时后可以重试";
  if (sec >= 25) return "模型仍在生成，这项通常需要 20–60 秒";
  return note || "";
}

function tick(my) {
  if (timer) clearInterval(timer);
  timer = setInterval(function () {
    if (my !== seq || !dlg) return;
    var sec = Math.floor((Date.now() - startedAt) / 1000);
    $("aiProgressElapsed").textContent = elapsedText(sec);
    var hint = hintFor(sec, active && active.opts.hint);
    if ($("aiProgressHint").textContent !== hint) $("aiProgressHint").textContent = hint;
  }, 500);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

function open() {
  var opts = active.opts;
  $("aiProgressTitle").textContent = opts.title || "AI 处理中";
  $("aiProgressDesc").textContent = opts.desc || "正在连接模型…";
  $("aiProgressHint").textContent = opts.hint || "";
  $("aiProgressElapsed").textContent = "刚刚开始";
  $("aiProgressError").hidden = true;
  $("aiProgressError").textContent = "";
  $("aiProgressRetry").hidden = true;
  var cancelBtn = $("aiProgressCancel");
  cancelBtn.hidden = false;
  cancelBtn.textContent = "取消";
  dlg.classList.add("busy");
  UI.setModalCloseGuard(dlg, function () {
    if (running) cancel();
    else close();
  });
  UI.openModal(dlg, "#aiProgressCancel");
}

function close() {
  if (!dlg) return;
  UI.setModalCloseGuard(dlg, null);
  UI.closeModal(dlg);
  dlg.classList.remove("busy");
  active = null;
  running = false;
  if (ctrl) {
    try { ctrl.abort(); } catch (e) { /* noop */ }
    ctrl = null;
  }
}

function showError(err) {
  running = false;
  stopTimer();
  dlg.classList.remove("busy");
  var opts = active.opts;
  var raw = (err && err.message) || "AI 调用失败";
  var msg = opts.errorText ? opts.errorText(raw) : raw;
  $("aiProgressDesc").textContent = "这次没有完成";
  $("aiProgressElapsed").textContent = "已停止";
  $("aiProgressHint").textContent = "可以直接重试，或先检查 AI 设置";
  var box = $("aiProgressError");
  box.textContent = msg;
  box.hidden = false;
  $("aiProgressRetry").hidden = false;
  $("aiProgressCancel").textContent = "关闭";
}

function start() {
  var my = ++seq;
  var opts = active.opts;
  running = true;
  startedAt = Date.now();
  $("aiProgressDesc").textContent = opts.desc || "正在连接模型…";
  $("aiProgressHint").textContent = opts.hint || "";
  $("aiProgressElapsed").textContent = "刚刚开始";
  $("aiProgressError").hidden = true;
  $("aiProgressRetry").hidden = true;
  $("aiProgressCancel").hidden = false;
  $("aiProgressCancel").textContent = "取消";
  dlg.classList.add("busy");
  ctrl = window.AbortController ? new AbortController() : null;
  tick(my);

  return Promise.resolve()
    .then(function () {
      return opts.request(ctrl ? ctrl.signal : null);
    })
    .then(function (res) {
      if (my !== seq) return null;
      stopTimer();
      close();
      if (opts.onSuccess) opts.onSuccess(res);
      return res;
    })
    .catch(function (err) {
      if (my !== seq) return null;
      if (err && err.aborted) return null;
      showError(err || new Error("AI 调用失败"));
      if (opts.onError) opts.onError(err);
      return null;
    });
}

function cancel() {
  if (!active) return;
  var opts = active.opts;
  seq++;
  stopTimer();
  running = false;
  close();
  if (opts.onCancel) opts.onCancel();
  else toast("已取消本次 AI 生成", "fs");
}

function retry() {
  if (!active) return;
  start();
}

/* 同一时刻只允许一个 AI 长请求：避免两个弹窗抢同一个进度层 */
function run(opts) {
  ensure();
  if (!dlg) return Promise.reject(new Error("缺少 AI 进度弹窗"));
  if (active) return Promise.resolve(null);
  active = { opts: opts || {} };
  open();
  return start();
}

export var AIProgress = { run: run, cancel: cancel };

/* 配置类错误统一补一句去哪配：模型/Key 缺失是最常见的失败原因 */
export function aiErrorText(msg) {
  var m = String(msg || "AI 调用失败");
  if (m.indexOf("个人设置") < 0 &&
      (m.indexOf("AI 设置") >= 0 || m.indexOf("API Key") >= 0 || m.indexOf("AI 开关") >= 0
       || m.indexOf("AI 配置") >= 0)) {
    m += "（到「个人设置 → AI 设置」里配一下）";
  }
  return m;
}

export function aiUsageText(u) {
  if (!u) return "";
  return "本次 " + (u.totalTokens || 0) + " tokens（输入 " + (u.promptTokens || 0)
    + " / 输出 " + (u.completionTokens || 0) + "）· 模型 " + (u.model || "—")
    + (u.jsonMode ? "" : " · 该模型不支持 JSON 模式，已降级解析");
}
