/* views/catchup · 周五补记：本周痕迹逐条确认、工时归属、风险确认与提交撤销
   数据与写入口径见 backend CatchupService；本页只写「确认记录 / 工时归属」，
   唯一会改工作项的是风险卡片的「解除阻塞」，提交后 5 分钟内可撤销。 */

import { API } from "../core/api.js";
import { icon } from "../core/icons.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";

var STEPS = [
  { n: 1, label: "本周概览", hint: "30 秒" },
  { n: 2, label: "工作项", hint: "4 分钟" },
  { n: 3, label: "工时", hint: "2 分钟" },
  { n: 4, label: "风险与变化", hint: "1.5 分钟" },
  { n: 5, label: "确认", hint: "1 分钟" }
];
var ANSWER_OPTIONS = ["完成", "进行中", "阻塞", "不是工作项"];
var CONF = {
  high: { label: "高置信", tone: "green" },
  mid: { label: "中置信", tone: "blue" },
  low: { label: "低置信", tone: "amber" }
};
var DECISION = {
  pending: { label: "待处理", tone: "gray" },
  accepted: { label: "已确认", tone: "green" },
  edited: { label: "已修改", tone: "green" },
  answered: { label: "已补充", tone: "green" },
  merged: { label: "已合并", tone: "blue" },
  skipped: { label: "已跳过", tone: "gray" }
};
var RISK_DONE = {
  confirm: "已确认 · 将写入时间线",
  record: "已记录 · 将写入时间线",
  unblock: "已解除阻塞 · 可撤销",
  ignore: "已忽略"
};
var EVIDENCE_ICON = {
  update: "edit", created: "plus", status: "check", time: "clock", blocked: "ban", late: "alert", carry: "layers"
};

var cu = {
  data: null, week: "", step: 1, sel: "", edit: null,
  grid: null, dirty: false, busy: false, loading: false, seq: 0,
  err: "", timer: null, undoAt: 0
};

/* ---------------- 小工具 ---------------- */

function $id(id) { return document.getElementById(id); }
function bodyEl() { return $id("catchupBody"); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function mondayISO() {
  var d = new Date();
  var off = (d.getDay() + 6) % 7;
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - off));
}
function md(iso) { return String(iso || "").slice(5).replace("-", "-"); }
function weekday(iso) {
  var p = String(iso || "").split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return "周" + "一二三四五六日".charAt((d.getDay() + 6) % 7);
}
function hoursLabel(minutes) {
  var h = Math.round((Number(minutes) || 0) / 6) / 10;
  return (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)) + "h";
}
function minutesOf(hours) {
  var h = Number(hours);
  if (!h || h < 0) return 0;
  if (h > 24) h = 24;
  return Math.round(h * 2) * 30;
}
function clockText(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(sec / 60) + ":" + pad2(sec % 60);
}
function myId() { return (rt.currentUser && rt.currentUser.id) || "me"; }
function clockKey() { return "ds.catchupClock." + myId() + "." + cu.week; }
function undoKey() { return "ds.catchupUndo." + myId() + "." + cu.week; }
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 受限环境忽略 */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }
function goView(name) {
  window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: name } }));
}
function chip(label, tone) {
  return '<span class="cu-chip ' + (tone || "gray") + '">' + esc(label) + '</span>';
}
function btn(label, act, key, cls, extra) {
  return '<button class="btn ' + (cls || "sm") + '" type="button" data-cu-action="' + act + '"' +
    (key ? ' data-key="' + esc(key) + '"' : "") + (extra ? " " + extra : "") + ">" + label + "</button>";
}

/* ---------------- 进入与加载 ---------------- */

function enterCatchupView() {
  if (!bodyEl()) return;
  var week = mondayISO();
  if (cu.data && cu.week === week) {
    render();
    startTimer();
    return;
  }
  cu.week = week;
  cu.step = 1;
  cu.sel = "";
  cu.edit = null;
  cu.grid = null;
  cu.dirty = false;
  load();
}

function load() {
  var body = bodyEl();
  if (!body) return;
  var seq = ++cu.seq;
  cu.loading = true;
  cu.err = "";
  body.innerHTML = UI.skeletonCards(3);
  stopTimer();
  API.get("/api/catchup", { week: cu.week }).then(function (d) {
    if (seq !== cu.seq) return null;
    applyView(d);
    if (d.session && d.session.status === "submitted") {
      cu.loading = false;
      render();
      startTimer();
      return null;
    }
    return API.post("/api/catchup/start?week=" + encodeURIComponent(d.weekStart || cu.week), null).then(function (v) {
      if (seq !== cu.seq) return;
      applyView(v);
      cu.loading = false;
      startClockIfNeeded(v);
      render();
      startTimer();
    });
  }).catch(function (ex) {
    if (seq !== cu.seq) return;
    cu.loading = false;
    cu.err = (ex && ex.message) || "补记数据加载失败";
    render();
  });
}

function applyView(d) {
  if (!d) return;
  cu.data = d;
  cu.week = d.weekStart || cu.week;
  var s = d.session || {};
  if (s.status === "submitted") {
    cu.step = 6;
    cu.undoAt = undoDeadline(s);
  } else if (cu.step === 6) {
    cu.step = 1;
  }
  if (!cu.sel || !findDraft(cu.sel)) {
    cu.sel = firstPendingKey(d.drafts);
  }
}

function startClockIfNeeded(d) {
  var s = (d && d.session) || {};
  if (s.status === "submitted" || !s.startedAt) return;
  if (!safeGet(clockKey())) safeSet(clockKey(), String(Date.now()));
}

function undoDeadline(s) {
  var stored = Number(safeGet(undoKey()) || 0);
  if (stored) return stored;
  var at = s && s.undoUntil ? Date.parse(String(s.undoUntil)) : 0;
  if (!at || !isFinite(at)) return 0;
  /* 服务端时间无时区：与本地时钟相差超过 30 分钟时按「刚提交」处理，避免倒计时显示成负数 */
  if (Math.abs(at - Date.now()) > 30 * 60 * 1000) at = Date.now() + 5 * 60 * 1000;
  return at;
}

function findDraft(key) {
  var list = (cu.data && cu.data.drafts) || [];
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}
function findRisk(key) {
  var list = (cu.data && cu.data.risks) || [];
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}
function firstPendingKey(drafts) {
  for (var i = 0; i < (drafts || []).length; i++) if (drafts[i].decision === "pending") return drafts[i].key;
  return drafts && drafts.length ? drafts[0].key : "";
}

/* ---------------- 计时 ---------------- */

function startTimer() {
  stopTimer();
  tick();
  cu.timer = setInterval(tick, 1000);
}
function stopTimer() {
  if (cu.timer) { clearInterval(cu.timer); cu.timer = null; }
}
function tick() {
  var el = $id("cuTimer");
  if (!el) return;
  var s = (cu.data && cu.data.session) || {};
  if (s.status === "submitted") {
    var left = cu.undoAt ? Math.max(0, Math.round((cu.undoAt - Date.now()) / 1000)) : 0;
    el.textContent = left ? "可撤销 " + clockText(left) : "撤销窗口已结束";
    el.className = "cu-timer" + (left ? "" : " mute");
    var ub = $id("cuUndo");
    if (ub) ub.hidden = !left;
    return;
  }
  var started = Number(safeGet(clockKey()) || 0);
  if (!started) {
    el.textContent = "目标 10 分钟";
    el.className = "cu-timer mute";
    return;
  }
  var used = Math.max(0, Math.round((Date.now() - started) / 1000));
  el.textContent = "已用 " + clockText(used) + " · 目标 10:00";
  el.className = "cu-timer" + (used > 600 ? " over" : (used > 480 ? " warn" : ""));
}

/* ---------------- 交互 ---------------- */

function goStep(n) {
  if (cu.busy || n === cu.step) return;
  if (n < 1 || n > 6) return;
  cu.edit = null;
  var run = function () {
    cu.step = n;
    if (n === 3) resetGrid();
    render();
    var on = bodyEl() && bodyEl().querySelector(".cu-step.on");
    if (on && on.scrollIntoView) {
      try { on.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) { on.scrollIntoView(); }
    }
  };
  if (cu.step === 3 && cu.dirty) {
    saveTime().then(run, function () { /* 保存失败留在本步 */ });
    return;
  }
  run();
}

function resetGrid() {
  var t = (cu.data && cu.data.time) || { rows: [], days: [] };
  cu.grid = (t.rows || []).map(function (r) {
    return { key: r.key, reqId: r.reqId, name: r.name, kind: r.kind, minutes: (r.minutes || []).slice() };
  });
  cu.dirty = false;
}

function decide(key, action, extra) {
  if (cu.busy) return Promise.resolve();
  cu.busy = true;
  setBusy(true);
  var payload = { week: cu.week, draftKey: key, kind: key.indexOf("risk:") === 0 ? "risk" : "work", action: action };
  if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
  return API.post("/api/catchup/decisions", payload).then(function (d) {
    cu.busy = false;
    setBusy(false);
    cu.edit = null;
    applyView(d);
    render();
  }).catch(function (ex) {
    cu.busy = false;
    setBusy(false);
    toast((ex && ex.message) || "操作失败", "bad");
  });
}

function setBusy(on) {
  var body = bodyEl();
  if (body) body.classList.toggle("cu-busy", !!on);
}

function acceptHigh() {
  var list = ((cu.data && cu.data.drafts) || []).filter(function (d) {
    return d.confidence === "high" && d.decision === "pending";
  });
  if (!list.length) return;
  cu.busy = true;
  setBusy(true);
  var chain = Promise.resolve();
  list.forEach(function (d) {
    chain = chain.then(function () {
      return API.post("/api/catchup/decisions", {
        week: cu.week, draftKey: d.key, kind: "work", action: "accept"
      }).then(function (v) { cu.data = v; });
    });
  });
  chain.then(function () {
    cu.busy = false;
    setBusy(false);
    applyView(cu.data);
    render();
    toast("已接受 " + list.length + " 条高置信工作项", "ok");
  }).catch(function (ex) {
    cu.busy = false;
    setBusy(false);
    render();
    toast((ex && ex.message) || "批量确认失败", "bad");
  });
}

function saveTime() {
  if (!cu.grid) return Promise.resolve();
  var cells = [];
  cu.grid.forEach(function (row) {
    (row.minutes || []).forEach(function (m, i) {
      cells.push({
        rowKey: row.key,
        day: (cu.data.time.days || [])[i],
        reqId: row.reqId,
        minutes: Number(m) || 0
      });
    });
  });
  cu.busy = true;
  setBusy(true);
  return API.post("/api/catchup/time", { week: cu.week, cells: cells }).then(function (d) {
    cu.busy = false;
    setBusy(false);
    applyView(d);
    resetGrid();
    render();
    toast("工时归属已保存", "ok");
  }).catch(function (ex) {
    cu.busy = false;
    setBusy(false);
    toast((ex && ex.message) || "工时保存失败", "bad");
    throw ex;
  });
}

function toggleNoOtherRisk() {
  var v = !(cu.data && cu.data.noOtherRisk);
  if (cu.busy) return;
  cu.busy = true;
  setBusy(true);
  API.post("/api/catchup/no-other-risk?week=" + encodeURIComponent(cu.week) + "&value=" + (v ? "true" : "false"), null)
    .then(function (d) {
      cu.busy = false;
      setBusy(false);
      applyView(d);
      render();
      toast(v ? "已记录：本周无其他已知风险" : "已取消「无其他风险」", "ok");
    }).catch(function (ex) {
      cu.busy = false;
      setBusy(false);
      toast((ex && ex.message) || "操作失败", "bad");
    });
}

function submitAll() {
  if (cu.busy) return;
  var counts = (cu.data && cu.data.counts) || {};
  var pending = Number(counts.pending) || 0;
  var msg = "提交后会把已确认的工作项写入时间线，并把本周工时归属固定下来。" +
    (pending ? "<br><br>还有 <b>" + pending + " 条</b>未处理，提交后会留在下周补记，不会丢。" : "") +
    "<br><br>提交后 5 分钟内可撤销。";
  UI.showConfirm({ title: "提交本周补记？", msg: msg, okText: "提交", cancelText: "再检查一遍", danger: false }).then(function (ok) {
    if (!ok) return;
    var ready = cu.dirty ? saveTime() : Promise.resolve();
    ready.then(function () {
      cu.busy = true;
      setBusy(true);
      return API.post("/api/catchup/submit?week=" + encodeURIComponent(cu.week), null);
    }).then(function (d) {
      cu.busy = false;
      setBusy(false);
      safeDel(clockKey());
      safeSet(undoKey(), String(Date.now() + 5 * 60 * 1000));
      applyView(d);
      cu.undoAt = undoDeadline((d && d.session) || {});
      render();
      startTimer();
      toast("补记已提交", "ok");
    }).catch(function (ex) {
      cu.busy = false;
      setBusy(false);
      toast((ex && ex.message) || "提交失败", "bad");
    });
  });
}

function undoSubmit() {
  if (cu.busy) return;
  UI.showConfirm({
    title: "撤销本次提交？",
    msg: "会删除本次写入的工作项时间线记录，并把解除阻塞的工作项恢复原状；工时归属与逐条确认会保留，可以重新提交。",
    okText: "撤销提交", cancelText: "保留", danger: true
  }).then(function (ok) {
    if (!ok) return;
    cu.busy = true;
    setBusy(true);
    API.post("/api/catchup/undo?week=" + encodeURIComponent(cu.week), null).then(function (d) {
      cu.busy = false;
      setBusy(false);
      safeDel(undoKey());
      var elapsed = ((d && d.session && d.session.elapsedSeconds) || 0) * 1000;
      safeSet(clockKey(), String(Date.now() - elapsed));
      cu.step = 1;
      applyView(d);
      render();
      startTimer();
      toast("已撤销提交，回到草稿", "ok");
    }).catch(function (ex) {
      cu.busy = false;
      setBusy(false);
      toast((ex && ex.message) || "撤销失败", "bad");
    });
  });
}

function saveAndExit() {
  var leave = function () {
    goView("mine");
    toast("已暂存；未处理的会留在下周补记", "fs");
  };
  if (cu.step === 3 && cu.dirty) {
    saveTime().then(leave, function () { /* 保存失败不离开 */ });
    return;
  }
  if (cu.data && cu.data.session && cu.data.session.status === "submitted") { goView("mine"); return; }
  leave();
}

/* ---------------- 渲染 ---------------- */

function render() {
  var body = bodyEl();
  if (!body) return;
  if (cu.err) {
    body.innerHTML = '<div class="cu-card">' + UI.errorState(cu.err) + '</div>';
    return;
  }
  if (!cu.data) {
    body.innerHTML = UI.skeletonCards(3);
    return;
  }
  var s = cu.data.session || {};
  var submitted = s.status === "submitted";
  var h = headHTML(submitted);
  if (submitted) {
    h += doneHTML();
  } else {
    h += stepsHTML();
    h += '<div class="cu-layout"><div class="cu-main">' +
      stepHTML() + footHTML() + '</div>' + sideHTML() + '</div>';
  }
  body.classList.toggle("cu-busy", cu.busy);
  body.innerHTML = h;
  tick();
}

function headHTML(submitted) {
  var d = cu.data;
  var s = d.session || {};
  var step = submitted ? 5 : cu.step;
  var sub = submitted
    ? "已写入系统，5 分钟内可撤销。"
    : "本周 " + d.activity.tasks + " 个工作项有动静 · " +
      hoursLabel(d.time.totalMinutes) + " 工时 · " + (d.counts.riskTotal || 0) + " 条风险 · " +
      "系统已整理成草稿。";
  return '<div class="cu-head">' +
    '<div class="cu-head-main">' +
      '<div class="cu-crumb"><button type="button" data-cu-action="go-mine">我的工作</button>' +
        icon("chevronRight", 12) + "<b>周五补记</b></div>" +
      '<h1>周五补记 ' + (submitted ? '<span class="cu-chip green">已提交</span>' :
        '<span class="cu-chip blue">' + step + " / 5</span>") + '</h1>' +
      '<p>' + esc(md(d.weekStart) + " " + weekday(d.weekStart) + " → " + md(d.weekEnd) + " " + weekday(d.weekEnd)) +
        ' · ' + esc(sub) + '</p>' +
    '</div>' +
    '<div class="cu-head-acts">' +
      (submitted ? "" : '<span class="cu-timer mute" id="cuTimer">目标 10 分钟</span>') +
      (submitted
        ? '<button class="btn" type="button" data-cu-action="go-mine">回到我的工作</button>'
        : '<button class="btn" type="button" data-cu-action="save-exit">暂存退出</button>') +
    '</div>' +
  '</div>';
}

function stepsHTML() {
  var h = '<nav class="cu-steps" aria-label="补记步骤">';
  STEPS.forEach(function (s, i) {
    var cls = cu.step > s.n ? " done" : (cu.step === s.n ? " on" : "");
    h += '<button class="cu-step' + cls + '" type="button" data-cu-action="step" data-step="' + s.n + '">' +
      '<span class="n">' + (cu.step > s.n ? icon("check", 12) : s.n) + '</span>' +
      '<span class="t">' + s.label + '</span><span class="hint">' + s.hint + '</span></button>';
    if (i < STEPS.length - 1) h += '<span class="cu-step-line"></span>';
  });
  return h + '</nav>';
}

function stepHTML() {
  if (cu.step === 1) return overviewHTML();
  if (cu.step === 2) return draftsHTML();
  if (cu.step === 3) return timeHTML();
  if (cu.step === 4) return risksHTML();
  return confirmHTML();
}

/* ---- 1 概览 ---- */

function overviewHTML() {
  var d = cu.data, c = d.counts, a = d.activity;
  var highLeft = (d.drafts || []).filter(function (x) { return x.confidence === "high" && x.decision === "pending"; }).length;
  return '<div class="cu-stack">' +
    '<div class="cu-kpis">' +
      kpi("工作项", c.total, "条", "高置信 " + c.high + " · 需补充 " + c.need, "") +
      kpi("工时", hoursLabel(c.timeTotalMinutes || 0), "", "已归属 " + hoursLabel(c.timeAssignedMinutes || 0) +
        " · 待归属 " + hoursLabel(c.timeUnassignedMinutes || 0), (c.timeUnassignedMinutes ? "warn" : "")) +
      kpi("风险与变化", c.riskTotal, "条", "已处理 " + c.riskHandled + " · 没有也要确认一次", (c.riskHandled < c.riskTotal ? "warn" : "good")) +
      kpi("本周痕迹", a.total, "条", a.tasks + " 个工作项 · " + a.timeRecords + " 条计时 · " + a.plans + " 个测试计划", "") +
    '</div>' +
    '<div class="cu-groups">' +
      gline("list", "工作项", c.total + " 条草稿" + (c.carried ? " · 承接上周 " + c.carried : "") +
        " · 已确认 " + c.accepted + " / 跳过 " + c.skipped + " / 待处理 " + c.pending +
        (c.hidden ? " · 另有 " + c.hidden + " 条较弱痕迹未列出" : ""), "2") +
      gline("clock", "工时", hoursLabel(c.timeTotalMinutes || 0) + " · 待归属 " + hoursLabel(c.timeUnassignedMinutes || 0), "3") +
      gline("alert", "风险与变化", c.riskTotal + " 条 · 已处理 " + c.riskHandled, "4") +
    '</div>' +
    '<div class="cu-banner">' + icon("ai", 15) + '<span>' +
      (highLeft
        ? '<b>可以只做 3 分钟：</b>接受 ' + highLeft + ' 条高置信工作项，其余留在草稿里，下周一继续。'
        : '<b>高置信工作项已接受。</b>可以继续核对工时，或逐条补充低置信条目。') +
      '</span><span class="spacer"></span>' +
      (highLeft
        ? '<button class="btn sm soft" type="button" data-cu-action="accept-high">接受高置信 (' + highLeft + ')</button>'
        : '<span class="cu-chip green">已接受</span>') +
    '</div>' +
  '</div>';
}
function kpi(k, v, unit, f, cls) {
  return '<div class="cu-kpi"><div class="k">' + esc(k) + '</div>' +
    '<div class="v ' + (cls || "") + '">' + esc(String(v)) + (unit ? '<small>' + esc(unit) + '</small>' : "") + '</div>' +
    '<div class="f">' + esc(f) + '</div></div>';
}
function gline(ic, title, desc, step) {
  return '<button class="cu-gline" type="button" data-cu-action="step" data-step="' + step + '">' +
    '<span class="gi">' + icon(ic, 15) + '</span>' +
    '<span class="gt"><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></span>' +
    '<span class="ga">去处理' + icon("chevronRight", 13) + '</span></button>';
}

/* ---- 2 工作项 ---- */

function draftCounts() {
  var c = { all: 0, pending: 0, high: 0, need: 0, done: 0 };
  ((cu.data && cu.data.drafts) || []).forEach(function (d) {
    c.all++;
    if (d.decision === "pending") c.pending++;
    if (d.confidence === "high") c.high++;
    else c.need++;
    if (d.decision !== "pending") c.done++;
  });
  return c;
}

function draftsHTML() {
  var list = cu.data.drafts || [];
  var c = draftCounts();
  var h = '<div class="cu-stack">';
  if (!list.length) {
    h += '<div class="cu-card">' + UI.emptyState({
      icon: "check", title: "本周没有需要补记的工作项",
      text: "没有新增、更新或计时的工作项。可以直接核对工时，或继续确认风险。",
      actionLabel: "去看工时", actionCmd: "to-time", compact: true
    }) + '</div>';
    return h + '</div>';
  }
  h += '<div class="cu-filter" role="group" aria-label="草稿筛选">' +
    '<span class="cu-chip blue">' + c.all + ' 条草稿</span>' +
    '<span class="cu-chip green">已处理 ' + c.done + '</span>' +
    '<span class="cu-chip gray">待处理 ' + c.pending + '</span>' +
    (cu.data.counts.hidden ? '<span class="cu-chip amber">另 ' + cu.data.counts.hidden + ' 条未列出</span>' : "") +
    '<span class="spacer"></span><span class="cu-note">确认后才写入；点击卡片看证据' +
      (cu.data.counts.hidden ? '；较弱痕迹会在提交时承接下周' : "") + '</span></div>';
  h += '<div class="cu-drafts">' + list.map(draftCard).join("") + '</div>';
  return h + '</div>';
}

function draftCard(d) {
  var st = DECISION[d.decision] ? d.decision : "pending";
  if (st === "answered" && d.answer === "不是工作项") st = "skipped";
  var conf = CONF[d.confidence] || CONF.mid;
  var open = cu.sel === d.key;
  var cls = "cu-draft" + (st === "pending" ? "" : " " + st) + (open ? " sel" : "") +
    (d.confidence === "low" && st === "pending" ? " low" : "");
  var meta = '<span class="cu-chip ' + conf.tone + '">' + conf.label + '</span>' +
    (d.carried ? '<span class="cu-chip amber">承上周</span>' : "") +
    '<span class="cu-dmeta">' + esc(d.project || "未归属项目") + '</span>' +
    '<span class="dot">·</span><span class="cu-dmeta">' + esc(d.typeLabel || d.type || "") + '</span>' +
    '<span class="dot">·</span><span class="cu-dmeta">' + esc(d.statusLabel || d.status || "") + '</span>' +
    (d.hours ? '<span class="dot">·</span><span class="cu-dmeta">' + esc(hoursLabel(d.hours * 60)) + '</span>' : "");

  var h = '<article class="' + cls + '" data-key="' + esc(d.key) + '">';
  h += '<div class="cu-draft-main" data-cu-action="select" data-key="' + esc(d.key) + '">';
  h += '<div class="cu-draft-top">' +
    '<button class="cu-check" type="button" data-cu-action="' + (st === "pending" ? "accept" : "clear") + '" data-key="' + esc(d.key) + '" ' +
      'aria-label="' + (st === "pending" ? "确认这条工作项" : "撤销这条处理") + '">' +
      (st === "pending" ? "" : icon("check", 13)) + '</button>' +
    '<div class="cu-draft-body"><div class="cu-dtitle">' + esc(d.editedTitle || d.title) + '</div>' +
      '<div class="cu-dmeta-row">' + meta + '</div>' +
      '<div class="cu-why">' + icon("infoCircle", 13) + '<span>' + esc(d.why || "") + '</span></div>';
  if (d.duplicate && st === "pending") {
    h += '<div class="cu-dup">' + icon("layers", 13) + '<span>可能重复：' + esc(d.duplicate) + '</span>' +
      '<span class="spacer"></span>' + btn("合并", "merge", d.key, "btn sm") + '</div>';
  }
  if (d.question && d.confidence === "low" && st === "pending") {
    h += '<div class="cu-q"><span>' + esc(d.question) + '</span><span class="cu-qa">' +
      ANSWER_OPTIONS.map(function (a) {
        return '<button class="btn sm' + (a === "不是工作项" ? " ghost" : "") + '" type="button" ' +
          'data-cu-action="answer" data-key="' + esc(d.key) + '" data-answer="' + esc(a) + '">' + esc(a) + '</button>';
      }).join("") + '</span></div>';
  }
  if (d.answer) {
    h += '<div class="cu-answered">已补充：<b>' + esc(d.answer) + '</b>' +
      (st === "pending" ? " · 将写入本周记录" : "") + '</div>';
  }
  if (st !== "pending") {
    h += '<div class="cu-decided">' + icon("checkCircle", 13) + '<span>' + esc(DECISION[st].label) +
      (st === "skipped" ? " · 提交后承接下周" : " · 提交后写入时间线") + '</span></div>';
  }
  if (open) h += evidenceHTML(d);
  h += '</div></div></div>';

  h += '<div class="cu-draft-acts">';
  if (st === "pending") {
    h += '<span class="cu-hours">' + (d.hours ? esc(hoursLabel(d.hours * 60)) : "—") + '</span>' +
      btn(icon("edit", 14), "edit", d.key, "sm ghost", 'title="编辑" aria-label="编辑"') +
      btn(icon("close", 14), "skip", d.key, "sm ghost", 'title="跳过" aria-label="跳过"') +
      '<button class="btn sm primary" type="button" data-cu-action="accept" data-key="' + esc(d.key) + '">确认</button>';
  } else {
    h += '<button class="btn sm ghost" type="button" data-cu-action="clear" data-key="' + esc(d.key) + '">撤销</button>';
  }
  h += '</div>';
  if (cu.edit && cu.edit.key === d.key) {
    h += editorHTML(d);
  }
  return h + '</article>';
}

function evidenceHTML(d) {
  var ev = d.evidence || [];
  var h = '<div class="cu-evidence"><div class="cu-ev-h">证据' + (ev.length ? '<span class="cu-chip gray">' + ev.length + ' 条</span>' : "") + '</div>';
  if (!ev.length) h += '<div class="cu-note">本周没有可展示的证据。</div>';
  ev.forEach(function (e) {
    h += '<div class="cu-ev"><span class="ic">' + icon(EVIDENCE_ICON[e.kind] || "infoCircle", 13) + '</span>' +
      '<div><div class="cu-ev-t"><b>' + esc(e.label || "") + '</b><span>' + esc(e.at || "") + '</span></div>' +
      '<div class="cu-ev-d">' + esc(e.detail || "") + '</div></div></div>';
  });
  return h + '</div>';
}

function editorHTML(d) {
  var e = cu.edit;
  var state = e.answer !== undefined ? e.answer : (d.answer || "");
  return '<div class="cu-editor">' +
    '<label class="cu-field"><span>标题</span><input id="cuEdTitle" type="text" value="' + esc(e.title !== undefined ? e.title : (d.editedTitle || d.title)) + '" maxlength="120"></label>' +
    '<div class="cu-grid2">' +
      '<label class="cu-field"><span>当前状态</span><select id="cuEdAnswer"><option value="">不改变</option>' +
        ANSWER_OPTIONS.map(function (a) {
          return '<option value="' + esc(a) + '"' + (a === state ? " selected" : "") + '>' + esc(a) + '</option>';
        }).join("") + '</select></label>' +
      '<div class="cu-field"><span>本周工时</span><div class="cu-readonly">' + (d.hours ? esc(hoursLabel(d.hours * 60)) : "无计时") + '</div></div>' +
    '</div>' +
    '<label class="cu-field"><span>备注</span><textarea id="cuEdNote" rows="2" maxlength="500" placeholder="补一句你记得但系统没看到的事">' +
      esc(e.note !== undefined ? e.note : (d.note || "")) + '</textarea></label>' +
    '<div class="cu-note">修改只影响本周确认记录，不改工作项标题或项目归属。</div>' +
    '<div class="cu-editor-acts"><button class="btn sm" type="button" data-cu-action="cancel-edit">取消</button>' +
      '<button class="btn sm primary" type="button" data-cu-action="save-edit" data-key="' + esc(d.key) + '">保存</button></div>' +
  '</div>';
}

/* ---- 3 工时 ---- */

function timeHours() {
  var t = (cu.grid ? { rows: cu.grid } : ((cu.data && cu.data.time) || { rows: [] }));
  var total = 0, un = 0;
  (t.rows || []).forEach(function (r) {
    var sum = (r.minutes || []).reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
    total += sum;
    if (r.key === "unassigned") un += sum;
  });
  return { total: total, assigned: Math.max(0, total - un), unassigned: un };
}

function timeHTML() {
  if (!cu.grid) resetGrid();
  /* 7 天全显示：合计本来就是整周口径，只显示 5 天会让周末工时看不见却算进合计 */
  var days = (cu.data && cu.data.time && cu.data.time.days) || [];
  var rows = cu.grid || [];
  var sum = timeHours();
  var h = '<div class="cu-stack">';
  if (!rows.length) {
    h += '<div class="cu-card">' + UI.emptyState({
      icon: "clock", title: "本周没有计时记录",
      text: "工作项详情里的计时与手工补记会汇总到这里；没有记录也可以直接确认风险。",
      actionLabel: "继续确认风险", actionCmd: "to-risk", compact: true
    }) + '</div></div>';
    return h;
  }
  h += '<div class="cu-filter">' +
    '<span class="cu-chip ' + (sum.unassigned ? "warn" : "green") + '">' +
      (sum.unassigned ? "待归属 " + hoursLabel(sum.unassigned) : "已全部归属") + '</span>' +
    '<span class="cu-note">本周 ' + hoursLabel(sum.total) + ' · 已归属 ' + hoursLabel(sum.assigned) + '</span>' +
    '<span class="spacer"></span><span class="cu-note">0.5h 为单位，点击格子直接改</span></div>';
  h += '<div class="cu-timewrap"><table class="cu-timegrid"><thead><tr><th>项目</th>' +
    days.map(function (day) { return '<th><b>' + weekday(day) + '</b><span>' + md(day) + '</span></th>'; }).join("") +
    '<th>合计</th></tr></thead><tbody>';
  rows.forEach(function (r, ri) {
    var rowTotal = 0;
    h += '<tr' + (r.key === "unassigned" ? ' class="unassigned"' : "") + '><td><div class="cu-pname">' +
      (r.key === "unassigned" ? '<span class="cu-chip amber">未归属</span>' : '<span class="cu-tag">项</span>') +
      '<span>' + esc(r.name || "项目") + '</span></div></td>';
    days.forEach(function (day, di) {
      var m = Number((r.minutes || [])[di]) || 0;
      rowTotal += m;
      h += '<td><input class="cu-cell' + (m ? "" : " zero") + '" type="number" min="0" max="24" step="0.5" ' +
        'inputmode="decimal" data-row="' + ri + '" data-day="' + di + '" value="' + (m ? (m / 60).toFixed(1).replace(/\.0$/, "") : "") + '" ' +
        'aria-label="' + esc((r.name || "项目") + " " + weekday(day)) + '"></td>';
    });
    h += '<td class="cu-sum">' + hoursLabel(rowTotal) + '</td></tr>';
  });
  h += '<tr class="total"><td>合计</td>' +
    days.map(function (day, di) {
      var dsum = rows.reduce(function (a, r) { return a + (Number((r.minutes || [])[di]) || 0); }, 0);
      return '<td>' + (dsum ? hoursLabel(dsum) : "—") + '</td>';
    }).join("") + '<td>' + hoursLabel(sum.total) + '</td></tr>';
  h += '</tbody></table></div>';
  h += '<div class="cu-timehint">左右滑动查看一整周</div>';
  h += '<div class="cu-timefoot"><span class="cu-note">补记只调整归属，不覆盖原始计时记录。</span>' +
    '<span class="spacer"></span>' +
    (cu.dirty ? '<span class="cu-chip amber">有未保存修改</span>' : '<span class="cu-chip green">已保存</span>') +
    '<button class="btn sm" type="button" data-cu-action="save-time"' + (cu.dirty ? "" : " disabled") + '>保存工时</button></div>';
  return h + '</div>';
}

function onCellChange(input) {
  var ri = Number(input.getAttribute("data-row"));
  var di = Number(input.getAttribute("data-day"));
  if (!cu.grid || !cu.grid[ri]) return;
  var mins = minutesOf(input.value);
  cu.grid[ri].minutes[di] = mins;
  cu.dirty = true;
  render();
  var next = bodyEl() && bodyEl().querySelector('input[data-row="' + ri + '"][data-day="' + di + '"]');
  if (next) { next.focus(); try { next.select(); } catch (e) { /* noop */ } }
}

/* ---- 4 风险 ---- */

function risksHTML() {
  var list = cu.data.risks || [];
  var h = '<div class="cu-stack">';
  if (!list.length) {
    h += '<div class="cu-card cu-risk-empty">' + icon("checkCircle", 20) +
      '<div><b>本周没有识别到阻塞或延期</b><span>没有风险也是一个结论：确认后本周记录会写「无其他已知风险」。</span></div></div>';
  }
  h += list.map(riskCard).join("");
  h += '<div class="cu-risk cu-noother"><div class="cu-risk-h"><h4>本周没有其他风险</h4>' +
    '<span class="cu-chip ' + (cu.data.noOtherRisk ? "green" : "gray") + '">' + (cu.data.noOtherRisk ? "已确认" : "确认即记录") + '</span></div>' +
    '<div class="cu-risk-meta">没有风险也是一个结论：确认后本周的回顾会写「无其他已知风险」。</div>' +
    '<div class="cu-risk-acts">' +
      (cu.data.noOtherRisk
        ? '<button class="btn sm ghost" type="button" data-cu-action="no-risk">撤销确认</button>'
        : '<button class="btn sm" type="button" data-cu-action="no-risk">确认无其他风险</button>') +
    '</div></div>';
  return h + '</div>';
}

function riskCard(r) {
  var kind = r.kind || "info";
  var done = r.decision;
  var acts = [];
  if (kind === "danger") {
    acts.push(["confirm", "确认仍在阻塞", "primary"]);
    acts.push(["unblock", "已解除阻塞", ""]);
    acts.push(["ignore", "忽略", "ghost"]);
  } else if (kind === "warn") {
    acts.push(["record", "记录下来", "primary"]);
    acts.push(["ignore", "忽略", "ghost"]);
  } else {
    acts.push(["ignore", "知道了", "primary"]);
  }
  return '<article class="cu-risk ' + esc(kind) + (done ? " done" : "") + '">' +
    '<div class="cu-risk-h"><h4>' + esc(r.title) + '</h4><span class="cu-chip ' +
      (kind === "danger" ? "red" : kind === "warn" ? "amber" : "blue") + '">' + esc(r.label || "") + '</span></div>' +
    '<div class="cu-risk-meta">' + esc(r.meta || "") + '</div>' +
    '<div class="cu-risk-quote">' + esc(r.quote || "") + '</div>' +
    '<div class="cu-risk-acts">' +
      (done
        ? '<span class="cu-decided">' + icon("checkCircle", 13) +
          esc(kind === "info" ? "已确认" : (RISK_DONE[done] || done)) + '</span>' +
          '<button class="btn sm ghost" type="button" data-cu-action="clear" data-key="' + esc(r.key) + '">撤销</button>'
        : acts.map(function (a) {
            return '<button class="btn sm ' + a[2] + '" type="button" data-cu-action="risk" data-key="' + esc(r.key) +
              '" data-risk="' + a[0] + '">' + a[1] + '</button>';
          }).join("")) +
    '</div></article>';
}

/* ---- 5 确认 ---- */

function confirmHTML() {
  var d = cu.data, c = d.counts, t = d.time, rv = d.review || {};
  var pending = Number(c.pending) || 0;
  var willWrite = (Number(c.accepted) || 0) + (Number(c.edited) || 0) +
    (Number(c.answered) || 0) + (Number(c.merged) || 0);
  return '<div class="cu-stack">' +
    ((pending || c.hidden) ? '<div class="cu-banner warn">' + icon("alert", 15) + '<span>' +
      (pending ? '还有 <b>' + pending + ' 条</b>未处理；提交后会留在下周补记，不会丢。' : "") +
      (c.hidden ? (pending ? " " : "") + '另有 <b>' + c.hidden + ' 条</b>较弱痕迹本次未列出，也会承接下周。' : "") +
      '</span><span class="spacer"></span>' +
      '<button class="link-btn" type="button" data-cu-action="step" data-step="2">回去处理</button></div>' : "") +
    '<div class="cu-sums">' +
      sumItem("list", "工作项", willWrite + " 条", "已确认 " + c.accepted + " · 修改 " + c.edited +
        " · 补充 " + c.answered + " · 合并 " + c.merged + " · 跳过 " + c.skipped, "good") +
      sumItem("clock", "工时", hoursLabel(t.totalMinutes), "已归属 " + hoursLabel(t.assignedMinutes) +
        " · 待归属 " + hoursLabel(t.unassignedMinutes), "") +
      sumItem("alert", "风险与变化", c.riskHandled + " 条", "共 " + c.riskTotal + " 条 · 未处理不影响提交", (c.riskHandled < c.riskTotal ? "warn" : "good")) +
      sumItem("review", "周回顾", "自动生成", "提交后可在「周回顾」查看与编辑", "good") +
    '</div>' +
    '<div class="cu-card"><div class="cu-card-h"><b>提交后将写入</b><span>全部可撤销，写入记录进审计日志</span></div>' +
      '<div class="cu-writes">' +
        writeLine("list", "工作项时间线", willWrite + " 条 · 含高置信与手动补充") +
        writeLine("clock", "工时归属", hoursLabel(t.totalMinutes) + " · 不改原始计时") +
        writeLine("alert", "风险与变化", c.riskHandled + " 条 · 仅记录，不自动通知") +
        writeLine("review", "周回顾", "1 份 · 可在「我的工作 / 周回顾」查看") +
      '</div></div>' +
    '<div class="cu-card cu-review"><div class="cu-card-h"><b>' + icon("ai", 14) + ' 周回顾预览</b>' +
      '<span class="cu-chip blue">自动生成</span></div><div class="cu-review-body">' +
      '<div class="sec"><b>本周完成</b><p>' + esc(rv.done || "—") + '</p></div>' +
      '<div class="sec"><b>下周计划</b><p>' + esc(rv.next || "—") + '</p></div>' +
      '<div class="sec"><b>需要支持</b><p>' + esc(rv.help || "—") + '</p></div>' +
    '</div></div>' +
    '<div class="cu-banner info">' + icon("infoCircle", 15) +
      '<span>提交后 5 分钟内可撤销；撤销只回滚本页写入，不会删掉你逐条确认与工时归属。</span></div>' +
  '</div>';
}
function sumItem(ic, label, n, f, tone) {
  return '<div class="cu-sumitem"><span class="si">' + icon(ic, 16) + '</span>' +
    '<div><div class="n ' + (tone || "") + '">' + esc(n) + '</div><div class="l">' + esc(label) +
    '<span>' + esc(f) + '</span></div></div></div>';
}
function writeLine(ic, t, n) {
  return '<div class="cu-wline">' + icon(ic, 14) + '<span>' + esc(t) + '</span><b>' + esc(n) + '</b></div>';
}

/* ---- 6 完成 ---- */

function doneHTML() {
  var d = cu.data, s = d.session || {}, c = d.counts || {};
  var wrote = (Number(c.accepted) || 0) + (Number(c.edited) || 0) +
    (Number(c.answered) || 0) + (Number(c.merged) || 0);
  return '<div class="cu-done">' +
    '<span class="ico">' + icon("check", 26) + '</span>' +
    '<h2>补记完成</h2>' +
    '<p class="sub">用时 ' + clockText(s.elapsedSeconds || 0) + '。已写入 ' + wrote + ' 条工作项、' +
      hoursLabel(c.timeTotalMinutes || 0) + ' 工时、' + (c.riskHandled || 0) + ' 条风险与变化；周回顾已生成。</p>' +
    '<div class="cu-done-stats">' +
      '<div><b>' + wrote + '</b><span>工作项</span></div>' +
      '<div><b>' + hoursLabel(c.timeTotalMinutes || 0) + '</b><span>工时</span></div>' +
      '<div><b>' + (c.riskHandled || 0) + '</b><span>风险 / 变化</span></div>' +
      '<div><b>1</b><span>周回顾</span></div>' +
    '</div>' +
    '<div class="cu-done-acts">' +
      '<button class="btn" type="button" data-cu-action="to-review">查看周回顾</button>' +
      '<button class="btn primary" type="button" data-cu-action="go-mine">回到我的工作</button>' +
    '</div>' +
    '<div class="cu-done-foot">' +
      '<span id="cuTimer" class="cu-timer"></span>' +
      '<button class="link-btn" type="button" id="cuUndo" data-cu-action="undo" hidden>撤销提交</button>' +
    '</div>' +
  '</div>';
}

/* ---------------- 侧栏 ---------------- */

function sideHTML() {
  var d = cu.data, c = d.counts || {};
  var sel = cu.sel ? findDraft(cu.sel) : null;
  var h = '<aside class="cu-side">';
  h += '<div class="cu-card"><div class="cu-card-h"><b>这条的证据</b>' +
    (sel ? '<span class="cu-chip ' + ((CONF[sel.confidence] || CONF.mid).tone) + '">' +
      (CONF[sel.confidence] || CONF.mid).label + '</span>' : "") + '</div>' +
    (sel ? '<div class="cu-side-body">' + evidenceInner(sel) + '</div>'
      : '<div class="cu-side-body"><div class="cu-note">点左侧任一草稿查看证据。</div></div>') + '</div>';
  h += '<div class="cu-card"><div class="cu-card-h"><b>10 分钟怎么花</b></div><div class="cu-side-body">' +
    STEPS.map(function (s) {
      return '<div class="cu-tl"><span class="n">' + s.n + '</span><div><b>' + s.label + '</b><span>' +
        stepDesc(s.n) + '</span></div><span class="t">' + s.hint + '</span></div>';
    }).join("") +
    '<div class="cu-note">随时可以停：已处理的会保留，未处理的会进下周补记。</div></div></div>';
  h += '<div class="cu-card"><div class="cu-card-h"><b>系统不会做什么</b></div><div class="cu-side-body">' +
    '<div class="cu-bound"><b>不自动改状态</b>：这里只写确认记录，不改工作项状态。</div>' +
    '<div class="cu-bound"><b>不覆盖原始计时</b>：工时只调整归属，不改计时明细。</div>' +
    '<div class="cu-bound"><b>不自动通知</b>：风险只做记录，需要你另行同步。</div>' +
    '<div class="cu-activity">本周痕迹：' + (c.total || 0) + ' 条 · 已处理 ' + (c.done || 0) + '</div>' +
  '</div></div>';
  return h + '</aside>';
}
function stepDesc(n) {
  return n === 1 ? "看一眼有没有漏掉的大事" :
    n === 2 ? "高置信一键接受，低置信答一句" :
    n === 3 ? "只处理未归属的工时" :
    n === 4 ? "确认阻塞与延期，没有就点「无其他风险」" : "提交并生成周回顾";
}
function evidenceInner(d) {
  var ev = d.evidence || [];
  var h = '<div class="cu-why side">' + icon("infoCircle", 13) + '<span>' + esc(d.why || "") + '</span></div>';
  if (!ev.length) return h + '<div class="cu-note">本周没有可展示的证据。</div>';
  ev.forEach(function (e) {
    h += '<div class="cu-ev"><span class="ic">' + icon(EVIDENCE_ICON[e.kind] || "infoCircle", 13) + '</span>' +
      '<div><div class="cu-ev-t"><b>' + esc(e.label || "") + '</b><span>' + esc(e.at || "") + '</span></div>' +
      '<div class="cu-ev-d">' + esc(e.detail || "") + '</div></div></div>';
  });
  return h;
}

/* ---------------- 页脚 ---------------- */

function footHTML() {
  var c = cu.data.counts || {};
  if (cu.step === 2) {
    var dc = draftCounts();
    return '<div class="cu-foot"><div class="cu-prog"><b>' + dc.done + ' / ' + dc.all +
      '</b><span>已处理</span><div class="bar"><i style="width:' + (dc.all ? Math.round(dc.done * 100 / dc.all) : 0) + '%"></i></div></div>' +
      '<span class="cu-note">跳过 ' + c.skipped + ' · 合并 ' + c.merged + '</span><span class="spacer"></span>' +
      '<button class="btn" type="button" data-cu-action="step" data-step="1">上一步</button>' +
      '<button class="btn primary" type="button" data-cu-action="step" data-step="3">下一步</button></div>';
  }
  if (cu.step === 3) {
    var t = timeHours();
    return '<div class="cu-foot"><div class="cu-prog"><b>' + hoursLabel(t.assigned) + ' / ' + hoursLabel(t.total) +
      '</b><span>已归属</span><div class="bar"><i style="width:' + (t.total ? Math.round(t.assigned * 100 / t.total) : 0) + '%"></i></div></div>' +
      '<span class="cu-note">' + (t.unassigned ? "还有 " + hoursLabel(t.unassigned) + " 未归属，可先提交" : "与计时一致") + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn" type="button" data-cu-action="step" data-step="2">上一步</button>' +
      '<button class="btn primary" type="button" data-cu-action="step" data-step="4">下一步</button></div>';
  }
  if (cu.step === 4) {
    return '<div class="cu-foot"><div class="cu-prog"><b>' + c.riskHandled + ' / ' + c.riskTotal +
      '</b><span>已处理</span><div class="bar"><i style="width:' + (c.riskTotal ? Math.round(c.riskHandled * 100 / c.riskTotal) : 0) + '%"></i></div></div>' +
      '<span class="cu-note">风险只生成草稿，不会自动通知</span><span class="spacer"></span>' +
      '<button class="btn" type="button" data-cu-action="step" data-step="3">上一步</button>' +
      '<button class="btn primary" type="button" data-cu-action="step" data-step="5">下一步</button></div>';
  }
  if (cu.step === 5) {
    return '<div class="cu-foot"><div class="cu-prog"><b>' + ((c.accepted || 0) + (c.edited || 0) + (c.answered || 0) + (c.merged || 0)) +
      ' 条 · ' + hoursLabel(c.timeTotalMinutes || 0) + '</b><span>将写入</span></div>' +
      '<span class="cu-note">提交后 5 分钟内可撤销</span><span class="spacer"></span>' +
      '<button class="btn" type="button" data-cu-action="step" data-step="4">返回修改</button>' +
      '<button class="btn primary" type="button" data-cu-action="submit">提交补记</button></div>';
  }
  return '<div class="cu-foot"><span class="cu-note">先接受高置信工作项，工时与风险可以下一步再处理。</span><span class="spacer"></span>' +
    '<button class="btn primary" type="button" data-cu-action="step" data-step="2">开始逐条确认</button></div>';
}

/* ---------------- 事件 ---------------- */

function onClick(e) {
  var t = e.target.closest("[data-cu-action]");
  if (!t) return;
  var act = t.getAttribute("data-cu-action");
  var key = t.getAttribute("data-key") || "";
  if (act === "step") { goStep(Number(t.getAttribute("data-step"))); return; }
  if (act === "go-mine") { goView("mine"); return; }
  if (act === "to-review") { goView("review"); return; }
  if (act === "save-exit") { saveAndExit(); return; }
  if (act === "select") {
    cu.sel = key;
    cu.edit = null;
    render();
    return;
  }
  if (act === "accept") { decide(key, "accept"); return; }
  if (act === "skip") { decide(key, "skip"); return; }
  if (act === "clear") { decide(key, "clear"); return; }
  if (act === "merge") { decide(key, "merge"); return; }
  if (act === "answer") { decide(key, "answer", { answer: t.getAttribute("data-answer") || "" }); return; }
  if (act === "edit") {
    var d = findDraft(key);
    cu.sel = key;
    cu.edit = { key: key, title: d ? (d.editedTitle || d.title) : "", answer: d ? (d.answer || "") : "", note: d ? (d.note || "") : "" };
    render();
    var input = $id("cuEdTitle");
    if (input) { input.focus(); try { input.select(); } catch (err) { /* noop */ } }
    return;
  }
  if (act === "cancel-edit") { cu.edit = null; render(); return; }
  if (act === "save-edit") {
    var title = ($id("cuEdTitle") || {}).value || "";
    var answer = ($id("cuEdAnswer") || {}).value || "";
    var note = ($id("cuEdNote") || {}).value || "";
    if (!title.trim()) { toast("标题不能为空", "warn"); return; }
    decide(key, "edit", { title: title.trim(), answer: answer, note: note.trim() });
    return;
  }
  if (act === "save-time") { if (cu.dirty) saveTime(); return; }
  if (act === "no-risk") { toggleNoOtherRisk(); return; }
  if (act === "accept-high") { acceptHigh(); return; }
  if (act === "risk") { onRisk(key, t.getAttribute("data-risk")); return; }
  if (act === "submit") { submitAll(); return; }
  if (act === "undo") { undoSubmit(); return; }
}

function onRisk(key, action) {
  var risk = findRisk(key);
  if (!risk) return;
  if (action === "unblock") {
    UI.showConfirm({
      title: "确认已解除阻塞？",
      msg: "提交后会把工作项 <b>" + esc(risk.title) + "</b> 标记为不再阻塞；5 分钟内可在完成页撤销。",
      okText: "已解除", cancelText: "取消", danger: false
    }).then(function (ok) { if (ok) decide(key, "unblock"); });
    return;
  }
  decide(key, action);
}

function onChange(e) {
  var cell = e.target.closest(".cu-cell");
  if (cell) onCellChange(cell);
}

function onKeydown(e) {
  if (e.key === "Escape" && cu.edit) { cu.edit = null; render(); }
}

function bindEvents() {
  var body = bodyEl();
  if (!body || body.dataset.bound === "1") return;
  body.dataset.bound = "1";
  body.addEventListener("click", onClick);
  body.addEventListener("change", onChange);
  body.addEventListener("keydown", onKeydown);
  document.addEventListener("click", function (e) {
    var empty = e.target.closest("[data-empty-cmd]");
    if (!empty || document.body.dataset.view !== "catchup") return;
    var cmd = empty.getAttribute("data-empty-cmd");
    if (cmd === "to-time") goStep(3);
    if (cmd === "to-risk") goStep(4);
  });
  window.addEventListener("ds:view-change", function (e) {
    if (e.detail && e.detail.view !== "catchup") stopTimer();
  });
}

bindEvents();

export { enterCatchupView };
