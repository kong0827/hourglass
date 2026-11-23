/* views/review-team · 团队周回顾（按原型 weekly-review-2026-11-20 实施） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { showView } from "../core/router.js";
import { UI, esc } from "../core/ui.js";
import { fmtMinutesShort } from "../lib/format.js";

var teamData = null;
var detailKey = "";
var detailCache = {};
var detailLoading = false;
var detailError = "";
var memberFilter = "all";

var DETAIL_LABEL = {
  "dem-created": "需求 · 本周新增",
  "dem-passed": "需求 · 评审通过",
  "dem-planned": "需求 · 开始排期",
  "dem-completed": "需求 · 完成",
  "dem-released": "需求 · 发布覆盖",
  "dem-closed": "需求 · 关闭",
  "dem-cancelled": "需求 · 取消",
  "wi-created": "工作项 · 本周新增",
  "wi-doing": "工作项 · 进入处理中",
  "wi-test": "工作项 · 提测",
  "wi-testing": "工作项 · 进入测试中",
  "wi-done": "工作项 · 本周完成",
  "wi-cancelled": "工作项 · 取消",
  "test-cases": "测试 · 新增用例",
  "test-passed": "测试 · 用例通过",
  "test-failed": "测试 · 用例失败",
  "test-blocked": "测试 · 用例阻塞",
  "test-skipped": "测试 · 跳过用例",
  "test-fixed": "测试 · 修复关闭缺陷",
  "test-retest": "测试 · 待回归",
  "doc-created": "文档 · 本周新增",
  "doc-updated": "文档 · 更新",
  "doc-published": "文档 · 发布",
  "doc-draft": "文档 · 草稿积压",
  "due-ontime": "本周到期 · 按期完成",
  "due-late": "本周到期 · 延期完成",
  "due-open": "本周到期 · 仍未完成"
};

function hoursText(minutes) {
  var m = Number(minutes) || 0;
  if (!m) return "0h";
  return (Math.round(m / 6) / 10).toFixed(1) + "h";
}

function md(text) {
  var s = String(text || "");
  return s.length >= 10 ? s.slice(5, 10) : s;
}

function deltaEm(n) {
  var v = Number(n) || 0;
  if (!v) return "";
  return '<em class="' + (v > 0 ? "up" : "down") + '">' + (v > 0 ? "+" : "") + v + "</em>";
}

function statBig(key, value, unit, sub, extraEm) {
  return '<button class="rv-stat-big" type="button" data-rvd="' + key + '" aria-expanded="' + (detailKey === key) +
    '" aria-controls="rvDetailRow">' +
    '<span class="rv-big">' + value + (unit || "") + (extraEm || "") + "</span></button>" +
    (sub ? '<span class="rv-sub">' + sub + "</span>" : "");
}

function statPair(key, value, label, cls) {
  return '<button class="rv-stat-sub' + (cls ? " " + cls : "") + '" type="button" data-rvd="' + key +
    '" aria-expanded="' + (detailKey === key) + '" aria-controls="rvDetailRow"><b>' + value + "</b> " + label + "</button>";
}

/* 近 4 周迷你折线：不引图表库，按数值在同一画布里取相对高度。 */
function sparkline(values, tone) {
  var vals = (values || []).map(function (v) { return Number(v) || 0; });
  if (!vals.length) return "";
  var w = 92, h = 24, pad = 3, max = 1;
  vals.forEach(function (v) { if (v > max) max = v; });
  var step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
  var pts = vals.map(function (v, i) {
    var x = pad + step * i;
    var y = h - pad - (v / max) * (h - pad * 2);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  var last = pts[pts.length - 1].split(",");
  return '<svg class="rv-spark ' + (tone || "") + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
    '<polyline points="' + pts.join(" ") + '"/>' +
    '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.2"/></svg>';
}

function trendHTML(d) {
  var t = d.trend || {};
  var labels = t.labels || [];
  if (!labels.length) return "";
  var rows = [
    { key: "completed", label: "完成", tone: "ok" },
    { key: "created", label: "新增", tone: "blue" },
    { key: "transitions", label: "推进", tone: "violet" }
  ];
  var body = rows.map(function (r) {
    var vals = t[r.key] || [];
    if (!vals.length) return "";
    var last = Number(vals[vals.length - 1]) || 0;
    var prev = Number(vals[vals.length - 2]) || 0;
    var diff = last - prev;
    var delta = diff === 0 ? '<em class="rv-td eq">持平</em>'
      : '<em class="rv-td ' + (diff > 0 ? "up" : "down") + '">' + (diff > 0 ? "+" : "") + diff + "</em>";
    return '<div class="rv-trend-row"><span class="rk">' + r.label + "</span>" +
      sparkline(vals, r.tone) + '<b class="rv-tv">' + last + "</b>" + delta + "</div>";
  }).join("");
  return '<div class="rv-trend" aria-label="近四周工作项趋势">' +
    '<div class="rv-trend-head"><b>近 4 周</b><span>' + esc(labels[0]) + " 起 · 按周对齐</span></div>" +
    body + "</div>";
}

function tag(text, cls) {
  return '<span class="rv-tag' + (cls ? " " + cls : "") + '">' + esc(text) + "</span>";
}

function statTableHTML(d) {
  var s = d.stats || {};
  var dm = s.demands || {};
  var w = s.workItems || {};
  var t = s.tests || {};
  var doc = s.docs || {};
  var p = d.pace || {};

  var demRow = "<tr>" +
    '<td class="rv-obj"><b>需求</b><span>需求池</span></td>' +
    "<td>" + statBig("dem-created", dm.created, "", "较前一周 · 本周创建", deltaEm(dm.createdDelta)) + "</td>" +
    "<td>" + statPair("dem-passed", dm.passed, "评审通过") + statPair("dem-planned", dm.planned, "开始排期") +
      '<span class="rv-sub">从待评审到已排期；开始不含调期</span></td>' +
    "<td>" + statPair("dem-completed", dm.completed, "完成", "ok") + statPair("dem-released", dm.released, "发布覆盖", "ok") +
      '<span class="rv-sub">完成由证据判定 · 覆盖含历史需求 · 发布 ' + (dm.releaseCount || 0) + " 次</span></td>" +
    "<td>" + statPair("dem-closed", dm.closed, "关闭") + statPair("dem-cancelled", dm.cancelled, "取消") +
      '<span class="rv-sub">关闭含评审不通过与重复</span></td></tr>';

  var workRow = "<tr>" +
    '<td class="rv-obj"><b>工作项</b><span>故事 / 任务 / 缺陷</span></td>' +
    "<td>" + statBig("wi-created", w.created, "", "故事 " + w.story + " · 任务 " + w.task + " · 缺陷 " + w.bug, deltaEm(w.createdDelta)) + "</td>" +
    "<td>" + '<span class="rv-big">' + w.transitionEvents + "<em>次</em></span>" +
      statPair("wi-doing", w.enteredDoing, "进入处理中") +
      statPair("wi-test", w.testRequested, "提测") +
      statPair("wi-testing", w.enteredTesting, "进入测试中") +
      '<span class="rv-sub">涉及 ' + w.transitionItems + " 项 · 同一项可连续流转，成员表按项去重</span></td>" +
    "<td>" + statBig("wi-done", w.completed, "", "故事 " + w.doneStory + " · 任务 " + w.doneTask + " · 缺陷 " + w.doneBug, deltaEm(w.completedDelta)) + "</td>" +
    "<td>" + statPair("wi-cancelled", w.cancelled, "取消") + '<span class="rv-sub">本周进入已取消</span></td></tr>';

  var testRow = "<tr>" +
    '<td class="rv-obj"><b>测试</b><span>用例与缺陷</span></td>' +
    "<td>" + statBig("test-cases", t.newCases, "", "新增缺陷 " + (t.newDefects || 0), deltaEm(t.newCasesDelta)) + "</td>" +
    "<td>" + '<span class="rv-big">' + (t.runs || 0) + "<em>条</em></span>" +
      statPair("test-passed", t.passed, "通过") +
      statPair("test-failed", t.failed, "失败", "warn") +
      statPair("test-blocked", t.blocked, "阻塞", "warn") +
      '<span class="rv-sub">执行记录 · ' + ((d.quality && d.quality.participants) || 0) + " 人参与 · 团队数 = 成员列之和</span></td>" +
    "<td>" + '<span class="rv-big">' + (t.passRate || 0) + "<em>%</em></span>" +
      '<span class="rv-sub">通过率 = 通过 ÷（通过 + 失败 + 阻塞）</span>' +
      statPair("test-fixed", t.fixed, "修复关闭", "ok") + "</td>" +
    "<td>" + statPair("test-retest", t.pendingRetest, '<span class="muted">待回归</span>', "") +
      statPair("test-skipped", t.skipped, "跳过") +
      '<span class="rv-sub">待回归是当前快照；跳过不计入通过率</span></td></tr>';

  var docRow = "<tr>" +
    '<td class="rv-obj"><b>文档</b><span>需求文档</span></td>' +
    "<td>" + statBig("doc-created", doc.created, "", "覆盖 " + ((d.docs && d.docs.projectCount) || 0) + " 个项目", deltaEm(doc.createdDelta)) + "</td>" +
    "<td>" + statBig("doc-updated", doc.updated, "", "正文产生新版本") + "</td>" +
    "<td>" + statBig("doc-published", doc.published, "", "本周首次发布") + "</td>" +
    "<td>" + statPair("doc-draft", doc.draftBacklog, '<span class="muted">草稿积压</span>') +
      '<span class="rv-sub">超过 7 天未发布</span></td></tr>';

  var detailRow = "";
  if (detailKey) {
    detailRow = '<tr class="rv-detail" id="rvDetailRow"><td colspan="5">' + detailHTML() + "</td></tr>";
  }

  var daily = p.daily || [];
  var max = 1;
  for (var i = 0; i < daily.length; i++) if (daily[i] > max) max = daily[i];
  var dayNames = ["一", "二", "三", "四", "五", "六", "日"];
  var bars = "";
  for (var j = 0; j < 7; j++) {
    var n = daily[j] || 0;
    var h = n ? Math.max(4, Math.round(n / max * 47)) : 2;
    bars += '<div class="rv-day"><span class="rv-dc">' + n + '</span>' +
      '<span class="rv-dw"><i class="rv-db' + (n ? "" : " zero") + '" style="height:' + h + 'px"></i></span>' +
      '<span class="rv-dl">' + dayNames[j] + "</span></div>";
  }

  var pool = d.pool || {};
  return '<section class="rv-card" id="rvStatsCard" aria-labelledby="rvStatsTitle">' +
    '<div class="rv-card-head"><h2 id="rvStatsTitle">本周统计</h2>' +
      '<span class="rv-hint">' + esc(md(d.weekStart)) + " — " + esc(md(d.weekEnd)) + " · 新增 / 流转 / 完成，一行一类对象</span>" +
    "</div>" +
    '<div class="rv-scroll"><table class="rv-tbl rv-stat-tbl">' +
      '<colgroup><col style="width:118"><col style="width:200"><col style="width:310"><col style="width:250"><col></colgroup>' +
      "<thead><tr><th>对象</th><th>本周新增</th><th>本周流转</th><th>本周完成</th><th>本周退出 / 异常</th></tr></thead>" +
      "<tbody>" + demRow + workRow + testRow + docRow + detailRow + "</tbody></table></div>" +
    '<div class="rv-stat-foot">' +
      '<div class="rv-foot-days"><div class="rv-days-head"><b>完成节奏</b><span>按完成时间 · 周末 0</span></div>' +
        '<div class="rv-days" aria-label="本周每日完成工作项数">' + bars + "</div></div>" +
      trendHTML(d) +
    "</div>" +
    '<div class="rv-stat-mini">' +
      "<span>登记工时 <b>" + hoursText(p.minutes) + "</b></span>" +
      "<span>容量利用 <b>" + (p.utilization || 0) + "%</b></span>" +
      "<span>完成按期率 <b>" + (p.onTimeRate || 0) + "%</b></span>" +
      "<span>测试计划达成 <b>" + (p.testPlanDone || 0) + " / " + (p.testPlanTotal || 0) + "</b></span>" +
      '<span class="rv-due">到期兑现 <b>' +
        '<button type="button" class="rv-due-n" data-rvd="due-ontime" aria-expanded="' +
          (detailKey === "due-ontime") + '" aria-controls="rvDetailRow" title="截止日在本周且按时完成的工作项">' + (p.dueOnTime || 0) + "</button>" +
        " / " + (p.dueTotal || 0) + "</b>" +
        '<span class="rv-due-sub">延期 <button type="button" class="rv-due-n" data-rvd="due-late" aria-expanded="' +
          (detailKey === "due-late") + '" aria-controls="rvDetailRow" title="已完成但晚于截止日">' + (p.dueLate || 0) + "</button>" +
          " · 未完成 <button type=\"button\" class=\"rv-due-n\" data-rvd=\"due-open\" aria-expanded=\"" +
          (detailKey === "due-open") + '" aria-controls="rvDetailRow" title="截止日在本周，当前仍未完成">' + (p.dueOpen || 0) + "</button></span></span>" +
    "</div>" +
    '<div class="rv-pool"><span class="rv-pool-title">当前快照</span>' +
      "<span>需求池：待评审 <b>" + (pool.demandReview || 0) + "</b> · 已通过 <b>" + (pool.demandPass || 0) +
        "</b> · 已排期 <b>" + (pool.demandPlan || 0) + "</b> · 待发布 <b>" + (pool.demandDone || 0) + "</b></span>" +
      "<span>工作项在手 <b>" + (pool.taskOpen || 0) + "</b>：进行中 " + (pool.taskDoing || 0) +
        " / 待测试 " + (pool.taskTest || 0) + " / 测试中 " + (pool.taskTesting || 0) +
        " / 待处理 " + (pool.taskBacklog || 0) + "</span>" +
      '<span class="rv-pool-note">截至 ' + esc(String(d.asOf || "").slice(5, 16).replace("T", " ")) + " · 不随周切换</span>" +
    "</div>" +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>每行是一种对象，行与行不合计：需求、工作项、用例、文档的数量含义不同。带虚线下划线的数字可点击，就地展开明细，再点收起。新增按创建时间；流转按状态变更日志；完成按进入已完成列且未取消；发布只计成功 + 生产 + 非回滚的全量发布。工作项流转按事件计次，成员表按项去重，两者不相等。缺陷新增 / 修复与测试卡同源，不重复计算；待回归、草稿积压是当前快照，不随周切换。到期兑现按截止日落在本周的工作项回看：按期 = 完成日不晚于截止日；未完成是当前时点仍未完成。近 4 周趋势与矩阵同口径，最后一位是当前查看周期。</span></p>" +
    "</section>";
}

function detailHTML() {
  var title = DETAIL_LABEL[detailKey] || detailKey;
  var head = '<div class="rv-sd-head"><div class="rv-sd-title"><b>' + esc(title) + "</b><span>" +
    esc((teamData && teamData.label) || "") + " · " + esc((teamData && teamData.weekStart) || "") + " — " +
    esc((teamData && teamData.weekEnd) || "") + "</span></div>" +
    '<div class="rv-sd-actions"><button class="rv-sd-close" type="button" data-rvd-close>收起</button></div></div>';
  if (detailLoading) {
    return '<div class="rv-sd">' + head + '<div class="rv-sd-loading">' + UI.skeletonRows(3) + "</div></div>";
  }
  if (detailError) {
    return '<div class="rv-sd">' + head + '<p class="rv-sd-note">明细加载失败：' + esc(detailError) + "。" +
      '<button class="rv-sd-close" type="button" data-rvd-retry>重试</button></p></div>';
  }
  var page = detailCache[detailCacheKey()];
  if (!page) {
    return '<div class="rv-sd">' + head + '<p class="rv-sd-note">正在加载…</p></div>';
  }
  var items = page.items || [];
  if (!items.length) {
    return '<div class="rv-sd">' + head + '<p class="rv-sd-note">该口径下本周暂无记录。</p></div>';
  }
  var list = items.map(function (item) {
    var clickable = item.kind === "task" || item.kind === "demand";
    var cls = typeClass(item);
    return "<li" + (clickable ? ' class="clickable" data-rv-kind="' + esc(item.kind) + '" data-rv-id="' + esc(item.id) + '"' : "") + ">" +
      '<span class="rv-sd-ty ' + cls + '">' + esc(item.typeLabel || item.kind) + "</span>" +
      '<span class="rv-sd-main"><b>' + esc(item.title || "—") + "</b><span>" + esc(item.meta || "") + "</span></span>" +
      "<time>" + esc(item.at || "") + "</time></li>";
  }).join("");
  var more = page.total > items.length
    ? '<p class="rv-sd-note">仅显示前 ' + items.length + " 项，共 " + page.total + " 项。</p>"
    : "";
  return '<div class="rv-sd">' + head + '<ul class="rv-sd-list">' + list + "</ul>" + more + "</div>";
}

function typeClass(item) {
  if (item.kind === "demand") return "dem";
  if (item.kind === "case") return "case";
  if (item.kind === "doc") return "doc";
  if (item.type === "story") return "story";
  if (item.type === "bug") return "bug";
  return "task";
}

function detailCacheKey() {
  var d = teamData || {};
  return String(d.weekOffset) + "|" + (d.reqId || "") + "|" + detailKey;
}

function briefHTML(d) {
  var s = d.stats || {};
  var w = s.workItems || {};
  var dm = s.demands || {};
  var t = s.tests || {};
  var doc = s.docs || {};
  var p = d.pace || {};
  var rel = d.releases || {};
  var risks = d.risks || {};
  var label = esc(d.label || "上周");
  var meta = [];
  if (w.completedDelta) meta.push("完成 " + (w.completedDelta > 0 ? "+" : "") + w.completedDelta);
  var brief = '<div class="rv-brief" id="rvBrief"><span class="rv-bic">' + icon("review", 14) + "</span>" +
    '<span class="rv-txt"><strong>' + label + "团队新增 " + (w.created || 0) + " 个工作项（故事 " + (w.story || 0) +
    " / 任务 " + (w.task || 0) + " / 缺陷 " + (w.bug || 0) + "），流转 " + (w.transitionEvents || 0) +
    " 次涉及 " + (w.transitionItems || 0) + " 项，完成 " + (w.completed || 0) + " 个（故事 " + (w.doneStory || 0) +
    " / 任务 " + (w.doneTask || 0) + " / 缺陷 " + (w.doneBug || 0) + "）；需求新增 " + (dm.created || 0) +
    "、完成 " + (dm.completed || 0) + "、发布覆盖 " + (dm.released || 0) + "。</strong> 登记 " + hoursText(p.minutes) +
    "，执行用例 " + (t.runs || 0) + " 条、通过率 " + (t.passRate || 0) + "%，新增用例 " + (t.newCases || 0) +
    "、修复缺陷 " + (t.fixed || 0) + "；文档新增 " + (doc.created || 0) + "、更新 " + (doc.updated || 0) +
    "、发布 " + (doc.published || 0) + "。" + (risks.overloaded || 0) + " 人超载，" + (risks.overdue || 0) +
    " 项逾期，" + (risks.testPlanOverdue || 0) + " 个测试计划超期。</span>" +
    (meta.length ? '<span class="rv-brief-meta">较前一周 <span class="rv-sep">·</span> ' + meta.join(' <span class="rv-sep">·</span> ') + "</span>" : "") +
    "</div>";
  return brief;
}

function completionHTML(d) {
  var c = d.completions || {};
  var items = c.items || [];
  var rows = items.map(function (it) {
    return '<div class="rv-item clickable" data-rv-kind="task" data-rv-id="' + esc(it.taskId) + '" title="打开工作项详情">' +
      '<span class="rv-ic">' + icon("check", 11) + "</span>" +
      '<span class="rv-im"><b>' + esc(it.title) + "</b><span>" +
        '<i class="rv-ty">' + esc(it.typeLabel || "") + "</i>" + esc(it.projectName || "") +
        (it.demandTitle ? " · " + esc(it.demandTitle) : "") + "</span></span>" +
      '<span class="rv-h">' + esc(fmtMinutesShort(it.minutes)) + "</span>" +
      '<span class="rv-d">' + esc(md(it.at)) + "</span>" +
      (it.onTime ? tag("按期", "ok") : tag("延期", "warn")) +
      (it.released ? tag("已发布", "blue") : "") +
      "</div>";
  }).join("");
  var more = (c.total || 0) - items.length;
  var moreText = more > 0
    ? "另有 " + more + " 项：故事 " + (c.moreStory || 0) + " · 任务 " + (c.moreTask || 0) + " · 缺陷 " + (c.moreBug || 0)
    : "";
  return '<section class="rv-card" aria-labelledby="rvCompTitle">' +
    '<div class="rv-card-head"><h2 id="rvCompTitle">本周完成</h2>' +
      '<span class="rv-hint">' + (c.total || 0) + " 项 · 故事 " + (c.story || 0) + " / 任务 " + (c.task || 0) + " / 缺陷 " + (c.bug || 0) + "</span>" +
      '<div class="rv-card-act"><button class="rv-link" type="button" data-rv-go="completions">全部完成项 ' + icon("chevronRight", 12) + "</button></div></div>" +
    (rows ? '<div class="rv-item-list">' + rows + "</div>" : UI.colEmpty("本周没有已完成的工作项")) +
    (more > 0 ? '<div class="rv-list-foot"><span>' + moreText + '</span><button class="rv-link" type="button" data-rv-go="completions">查看全部 ' + c.total + " 项 →</button></div>" : "") +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>「已发布」表示该项所属需求被本周成功 + 生产发布覆盖，共 " +
      (d.releases && d.releases.releaseCount || 0) + " 次发布、" + (c.released || 0) +
      " 个需求；其余完成项尚未发布。完成 ≠ 发布，完成也不等于交付。工时是登记值，完成耗时另算。</span></p>" +
    "</section>";
}

function releaseHTML(d) {
  var r = d.releases || {};
  var items = r.items || [];
  var details = items.map(function (it) {
    return '<details class="rv-rel" open>' +
      "<summary>" +
        '<span class="rv-rel-ver">' + esc(it.projectName || "") + " <b>" + esc(it.versionName || "") + "</b></span>" +
        tag("生产 · 成功", "ok") +
        '<span class="rv-rel-time">' + esc(it.at || "") + "</span>" +
        '<span class="rv-rel-exec">' + esc(it.executor || "") + "</span>" +
        '<svg class="rv-rel-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 8l3-3.5"/></svg>' +
      "</summary>" +
      '<div class="rv-rel-body"><div class="rv-rel-stat"><b>' + (it.demands || 0) + "</b> 个需求" +
        '<span class="rv-sep">·</span><b>' + (it.tasks || 0) + "</b> 个工作项" +
        (it.note ? '<span class="rv-sep">·</span>' + esc(it.note) : "") + "</div></div>" +
      "</details>";
  }).join("");
  return '<section class="rv-card" aria-labelledby="rvReleaseTitle">' +
    '<div class="rv-card-head"><h2 id="rvReleaseTitle">本周发布</h2>' +
      '<span class="rv-hint">' + (r.releaseCount || 0) + " 次生产发布 · 覆盖 " + (r.demandCount || 0) + " 个需求</span>" +
      '<div class="rv-card-act"><button class="rv-link" type="button" data-rv-go="releases">全部记录 ' + icon("chevronRight", 12) + "</button></div></div>" +
    '<div class="rv-plan-kpis">' +
      "<div><b>" + (r.planTotal || 0) + "</b><span>本周发布计划</span></div>" +
      "<div><b>" + (r.planCompleted || 0) + "</b><span>已完成 · 成功发布</span></div>" +
      '<div><b class="' + (r.planReadyOverdue ? "rv-warn-n" : "") + '">' + (r.planReadyOverdue || 0) + "</b><span>就绪待发 · 超期</span></div>" +
      "<div><b>" + (r.rolledBack || 0) + "</b><span>回滚</span></div>" +
    "</div>" +
    (details ? '<div class="rv-rel-list">' + details + "</div>" : UI.colEmpty("本周没有成功生产发布记录")) +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>只统计成功 + 生产 + 非回滚的全量发布；预发验证、失败重试不计入。计划达成按「计划内已完成 ÷ 本周计划数」计；就绪待发超期指计划日期已过但仍未发布。</span></p>" +
    "</section>";
}

function qualityHTML(d) {
  var q = d.quality || {};
  var res = q.results || {};
  var total = (res.passed || 0) + (res.failed || 0) + (res.blocked || 0);
  function pct(n) { return total ? Math.round((n || 0) / total * 100) : 0; }
  var plans = (q.plans || []).map(function (p) {
    var sub = p.status === "done"
      ? "已完成 · " + (p.due ? esc(p.due) : "") + " · " + (p.passed || 0) + "/" + (p.total || 0)
      : (p.overdueDays > 0 ? "执行中 · 截止 " + esc(p.due || "") + " · 超期 " + p.overdueDays + " 天"
        : (p.status === "running" ? "执行中" : "未开始") + (p.due ? " · 截止 " + esc(p.due) : ""));
    return '<div class="rv-qplan-row"><div><div class="rv-qpn">' + esc(p.name) + "</div>" +
      '<span class="rv-qplan-sub' + (p.overdueDays > 0 && p.status !== "done" ? " warn" : "") + '">' + sub + "</span></div>" +
      '<span class="rv-qpb" aria-label="进度 ' + (p.progress || 0) + '%"><i style="width:' + (p.progress || 0) + '%"></i></span>' +
      '<span class="rv-qpp">' + (p.progress || 0) + "%</span></div>";
  }).join("");
  var mem = (q.members || []).map(function (m) {
    return '<div class="rv-qmem-row"><b>' + esc(m.name) + "</b><span>" + esc(m.roleTitle || "") +
      (m.projects ? " · " + esc(m.projects) : "") + '</span><span class="rv-tstat">' +
      (m.runs || 0) + " 执行 · " + (m.passRate || 0) + "% · 新 " + (m.newCases || 0) + " · 缺陷 " + (m.defects || 0) + "</span></div>";
  }).join("");
  var dp = q.defectsByPriority || {};
  var overdue = (q.plans || []).filter(function (p) { return p.overdueDays > 0 && p.status !== "done"; }).length;
  return '<section class="rv-card" aria-labelledby="rvQualityTitle">' +
    '<div class="rv-card-head"><h2 id="rvQualityTitle">测试与质量</h2>' +
      '<span class="rv-hint">测试工时 ' + hoursText(q.minutes) + " · " + (q.participants || 0) + " 人参与 · " + overdue + " 个计划超期</span>" +
      '<div class="rv-card-act"><button class="rv-link" type="button" data-rv-go="testreport">测试报告 ' + icon("chevronRight", 12) + "</button></div></div>" +
    '<div class="rv-qkpis six">' +
      "<div><b>" + (q.runs || 0) + "</b><span>执行用例</span></div>" +
      "<div><b>" + (q.passRate || 0) + "%</b><span>通过率</span></div>" +
      "<div><b>" + (q.newCases || 0) + "</b><span>新增用例</span></div>" +
      "<div><b>" + (q.defects || 0) + "</b><span>发现缺陷</span></div>" +
      "<div><b>" + (q.fixed || 0) + "</b><span>修复关闭</span></div>" +
      "<div><b>" + (q.pendingRetest || 0) + "</b><span>待回归</span></div>" +
    "</div>" +
    '<div class="rv-qbar" role="img" aria-label="执行结果：通过 ' + (res.passed || 0) + "、失败 " + (res.failed || 0) + "、阻塞 " + (res.blocked || 0) + '">' +
      '<i class="pass" style="width:' + pct(res.passed) + '%"></i>' +
      '<i class="fail" style="width:' + pct(res.failed) + '%"></i>' +
      '<i class="blocked" style="width:' + pct(res.blocked) + '%"></i></div>' +
    '<div class="rv-qlegend"><span>通过 <b>' + (res.passed || 0) + "</b></span><span>失败 <b>" + (res.failed || 0) +
      "</b></span><span>阻塞 <b>" + (res.blocked || 0) + "</b></span><span>跳过 <b>" + (res.skipped || 0) + "</b> · 不计入通过率</span></div>" +
    '<div class="rv-qgrid"><div class="rv-qcol">' +
      '<div class="rv-subhead">测试计划 <span>' + (q.plans || []).length + " 个 · 超期 " + overdue + "</span></div>" +
      (plans || '<p class="rv-qmem-empty">本周没有测试计划。</p>') +
      '<div class="rv-qlegend"><span>缺陷 P0 <b>' + (dp.p0 || 0) + "</b></span><span>P1 <b>" + (dp.p1 || 0) +
        "</b></span><span>P2 <b>" + (dp.p2 || 0) + "</b></span><span>跳过 <b>" + (res.skipped || 0) + "</b> 单列</span></div>" +
    '</div><div class="rv-qcol">' +
      '<div class="rv-subhead">按人 <span>执行 / 通过率 / 新增 / 缺陷</span></div>' +
      '<div class="rv-qmem">' + (mem || '<p class="rv-qmem-empty">该角色本周没有执行用例，团队用例数不变。</p>') + "</div>" +
      '<div class="rv-qlegend"><span>新增用例合计 <b>' + (q.newCases || 0) + "</b></span><span>执行 <b>" + (q.runs || 0) +
        "</b></span><span>" + (q.participants || 0) + " 人参与</span></div>" +
    "</div></div>" +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>需求主状态没有测试阶段：测试发生在工作项（待测试 / 测试中）与用例执行，因此单独成卡。执行、新增用例、发现 / 修复缺陷是本周事件；待回归是当前快照。通过率 = 通过 ÷（通过 + 失败 + 阻塞），跳过不计。缺陷按 item_type=bug 新建 / 关闭统计，修复关闭已包含在工作项完成内。计划「超期」= 已过计划结束日且未完成。</span></p>" +
    "</section>";
}

function docsHTML(d) {
  var doc = d.docs || {};
  var byType = doc.byType || [];
  var max = 1;
  byType.forEach(function (x) { if (x.count > max) max = x.count; });
  var dist = byType.map(function (x) {
    return '<div class="rv-dist-row"><span>' + esc(x.label || x.key) + '</span><span class="rv-dbar"><i style="width:' +
      Math.round((x.count || 0) / max * 100) + '%"></i></span><span class="rv-dv">' + (x.count || 0) + "</span></div>";
  }).join("");
  var mem = (doc.members || []).map(function (m) {
    return '<div class="rv-qmem-row"><b>' + esc(m.name) + "</b><span>" + esc(m.roleTitle || "") +
      (m.projects ? " · " + esc(m.projects) : "") + '</span><span class="rv-tstat">' + (m.total || 0) +
      " 次 · 新 " + (m.created || 0) + " / 更 " + (m.updated || 0) + "</span></div>";
  }).join("");
  var total = (doc.created || 0) + (doc.updated || 0);
  var silent = doc.silent || [];
  return '<section class="rv-card" aria-labelledby="rvDocTitle">' +
    '<div class="rv-card-head"><h2 id="rvDocTitle">文档与知识</h2>' +
      '<span class="rv-hint">' + (doc.projectCount || 0) + " 个项目 · " + (doc.demandCount || 0) + " 个需求有文档动作" +
      (silent.length ? " · " + silent.length + " 人未写" : "") + "</span>" +
      '<div class="rv-card-act"><button class="rv-link" type="button" data-rv-go="docs">文档中心 ' + icon("chevronRight", 12) + "</button></div></div>" +
    '<div class="rv-kpis">' +
      "<div><b>" + (doc.created || 0) + "</b><span>新增</span></div>" +
      "<div><b>" + (doc.updated || 0) + "</b><span>更新</span></div>" +
      "<div><b>" + (doc.published || 0) + "</b><span>发布</span></div>" +
      '<div><b>' + (doc.draftBacklog || 0) + "</b><span>草稿积压" +
        (doc.oldestDraft ? " <em>最早 " + esc(md(doc.oldestDraft)) + "</em>" : "") + "</span></div>" +
    "</div>" +
    '<div class="rv-qgrid"><div class="rv-qcol">' +
      '<div class="rv-subhead">按类型 <span>新增 + 更新 ' + total + " 次</span></div>" +
      '<div class="rv-dist">' + (dist || '<p class="rv-qmem-empty">本周没有文档动作。</p>') + "</div>" +
    '</div><div class="rv-qcol">' +
      '<div class="rv-subhead">贡献成员 <span>' + total + " 次 · " + (doc.members || []).length + " 人</span></div>" +
      '<div class="rv-qmem">' + (mem || '<p class="rv-qmem-empty">该角色本周没有文档动作，团队文档数不变。</p>') + "</div>" +
      (silent.length ? '<div class="rv-qlegend"><span>未写文档：' + esc(silent.join("、")) + "</span></div>" : "") +
    "</div></div>" +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>文档指文档中心的需求文档。新增按创建时间，更新按正文产生新版本，发布按首次发布时间；老文档的发布时间在升级时回填为创建时间，首周「发布」可能偏低。按人归属：新增记负责人，更新记保存人；未记录不等于 0。草稿积压 = 超过 7 天仍未发布。</span></p>" +
    "</section>";
}

function membersHTML(d) {
  var rows = d.members || [];
  var sums = { created: 0, started: 0, done: 0, open: 0, minutes: 0, overdue: 0, blocked: 0, testRuns: 0, testDefects: 0, docs: 0 };
  rows.forEach(function (r) {
    sums.created += r.created || 0;
    sums.started += r.started || 0;
    sums.done += r.done || 0;
    sums.open += r.open || 0;
    sums.minutes += r.minutes || 0;
    sums.overdue += r.overdue || 0;
    sums.blocked += r.blocked || 0;
    if ((r.testRuns || 0) > 0 || (r.testDefects || 0) > 0) {
      sums.testRuns += r.testRuns || 0;
      sums.testDefects += r.testDefects || 0;
    }
    sums.docs += r.docs || 0;
  });
  var over = rows.filter(function (r) { return (r.load || 0) > 100; }).length;
  var unlogged = rows.filter(function (r) { return r.unlogged; }).length;
  var capacity = (d.pace && d.pace.capacityMinutes) || 0;
  var body = rows.map(function (r, i) {
    var cls = r.unlogged ? "none" : ((r.load || 0) > 100 ? "over" : ((r.load || 0) >= 85 ? "near" : ""));
    var width = Math.min(100, Math.max(0, r.load || 0));
    return '<tr data-load="' + cls + '" data-unlogged="' + (r.unlogged ? "1" : "0") + '">' +
      '<td><span class="rv-who"><span class="rv-av rv-av' + (i % 8 + 1) + '">' + esc(String(r.name || "?").slice(0, 1)) +
        '</span><span><span class="rv-wn">' + esc(r.name) + (r.idle
          ? '<i class="rv-idle-tag" title="本周没有新增 / 流转 / 完成 / 工时 / 文档 / 测试 / 评论 / 需求动作 / 发布记录；不代表没上班">本周无记录</i>'
          : "") + '</span><span class="rv-wr">' + esc(r.roleTitle || "") +
        (r.projects ? " · " + esc(r.projects) : "") + "</span></span></span></td>" +
      '<td class="num">' + (r.created || 0) + "</td>" +
      '<td class="num">' + (r.started || 0) + "</td>" +
      '<td class="num">' + (r.done || 0) + "</td>" +
      '<td class="num">' + (r.open || 0) + "</td>" +
      '<td class="num">' + hoursText(r.minutes) + "</td>" +
      '<td><span class="rv-load ' + cls + '"><span class="rv-lb"><i style="width:' + width + '%"></i></span>' +
        '<span class="rv-pct">' + (r.unlogged ? "未登记" : (r.load || 0) + "%") + "</span></span></td>" +
      '<td class="num' + ((r.overdue || 0) > 0 ? " rv-danger-n" : "") + '">' + (r.overdue || 0) + "</td>" +
      '<td class="num' + ((r.blocked || 0) > 0 ? " rv-danger-n" : "") + '">' + (r.blocked || 0) + "</td>" +
      '<td class="num' + ((r.testRuns || 0) <= 0 ? " rv-muted" : "") + '">' +
        ((r.testRuns || 0) > 0 ? (r.testRuns + " / " + (r.testDefects || 0)) : "—") + "</td>" +
      '<td class="num">' + (r.docs || 0) + "</td></tr>";
  }).join("");
  var testTotal = sums.testRuns > 0 ? (sums.testRuns + " / " + sums.testDefects) : "—";
  return '<section class="rv-card" aria-labelledby="rvMemberTitle">' +
    '<div class="rv-card-head"><h2 id="rvMemberTitle">成员工作量</h2>' +
      '<span class="rv-hint" id="rvMemberHint">' + rows.length + " 人 · 新增 " + sums.created + " · 完成 " + sums.done +
        " · 登记 " + hoursText(sums.minutes) + " / 容量 " + hoursText(capacity) + "</span>" +
      '<div class="rv-card-act rv-chips" role="group" aria-label="成员筛选">' +
        '<button class="rv-chip" type="button" data-rv-mfilter="all" aria-pressed="' + (memberFilter === "all") + '">全部 <b>' + rows.length + "</b></button>" +
        '<button class="rv-chip" type="button" data-rv-mfilter="over" aria-pressed="' + (memberFilter === "over") + '">超载 <b>' + over + "</b></button>" +
        '<button class="rv-chip" type="button" data-rv-mfilter="none" aria-pressed="' + (memberFilter === "none") + '">未登记 <b>' + unlogged + "</b></button>" +
      "</div></div>" +
    '<div class="rv-scroll"><table class="rv-tbl rv-member-tbl">' +
      '<colgroup><col style="width:176"><col style="width:48"><col style="width:48"><col style="width:48"><col style="width:48"><col style="width:76"><col style="width:118"><col style="width:42"><col style="width:42"><col style="width:84"><col style="width:48"></colgroup>' +
      '<thead><tr><th>成员</th><th class="num" title="本周创建的工作项，按创建人归属">新增</th>' +
        '<th class="num" title="本周首次进入处理中 / 待测试 / 测试中，按项去重">推进</th>' +
        "<th class=\"num\">完成</th><th class=\"num\" title=\"当前快照，不随周切换\">在手</th>" +
        '<th class="num">登记工时</th><th>负载</th><th class="num">逾期</th><th class="num">阻塞</th>' +
        '<th class="num" title="执行用例 / 发现缺陷；— 表示本周没有测试参与">测试</th>' +
        '<th class="num" title="本周新增或更新文档的次数">文档</th></tr></thead>' +
      "<tbody>" + (body || '<tr><td colspan="11" class="rv-empty-note">' +
        (d.role && d.role !== "all" ? "该角色下没有成员明细；团队汇总不变" : "当前空间没有成员") +
        '</td></tr>') +
        '<tr id="rvMemberEmpty" hidden><td colspan="11" class="rv-empty-note">该筛选下没有成员</td></tr></tbody>' +
      '<tfoot><tr><td>合计</td><td class="num">' + sums.created + '</td><td class="num">' + sums.started +
        '</td><td class="num">' + sums.done + '</td><td class="num">' + sums.open + '</td><td class="num">' +
        hoursText(sums.minutes) + '</td><td>' + (d.role && d.role !== "all"
          ? '<span class="rv-muted" title="按角色筛选时不汇总负载：容量按全团队计算">按角色过滤</span>'
          : '<span class="rv-load"><span class="rv-lb"><i style="width:' +
            Math.min(100, capacity ? Math.round(sums.minutes / capacity * 100) : 0) + '%"></i></span><span class="rv-pct">' +
            (capacity ? Math.round(sums.minutes / capacity * 100) : 0) + '%</span></span>') +
        '</td><td class="num rv-danger-n">' +
        sums.overdue + '</td><td class="num rv-danger-n">' + sums.blocked + '</td><td class="num">' + testTotal +
        '</td><td class="num">' + sums.docs + "</td></tr></tfoot></table></div>" +
    '<p class="rv-tbl-note">' + icon("infoCircle", 12) + "<span>新增 = 本周创建的工作项，按创建人归属；推进 = 本周首次进入处理中 / 待测试 / 测试中，按项去重；完成 = 进入已完成列。在手、负载、逾期、阻塞是当前快照。文档 = 本周新增或更新的次数，与文档卡同源。负载 = 剩余预估工时 ÷ 到最晚截止日的容量；0h 且本周有完成标为「未登记」，不等于空闲。测试列「—」表示本周不参与测试。角色与筛选只改成员明细，团队汇总在卡片上方。</span></p>" +
    "</section>";
}

function projectsHTML(d) {
  var rows = d.projects || [];
  var sums = { dc: 0, ds: 0, dd: 0, dr: 0, tc: 0, td: 0, min: 0 };
  var body = rows.map(function (r) {
    sums.dc += r.demandCreated || 0;
    sums.ds += r.demandStarted || 0;
    sums.dd += r.demandCompleted || 0;
    sums.dr += r.demandReleased || 0;
    sums.tc += r.taskCreated || 0;
    sums.td += r.taskDone || 0;
    sums.min += r.minutes || 0;
    return "<tr><td><span class=\"rv-proj-name\">" + esc(r.name) +
      (r.code ? '<span class="rv-proj-code">' + esc(r.code) + "</span>" : "") + "</span></td>" +
      '<td><span class="rv-flow-mini"><b>' + (r.demandCreated || 0) + '</b><span class="l">新</span><span class="rv-sep">·</span><b>' +
        (r.demandStarted || 0) + '</b><span class="l">始</span><span class="rv-sep">·</span><b>' +
        (r.demandCompleted || 0) + '</b><span class="l">完</span><span class="rv-sep">·</span><b>' +
        (r.demandReleased || 0) + '</b><span class="l">发</span></span></td>' +
      '<td><span class="rv-flow-mini"><b>' + (r.taskCreated || 0) + '</b><span class="l">新</span><span class="rv-sep">·</span><b>' +
        (r.taskDone || 0) + '</b><span class="l">完</span></span></td>' +
      '<td class="num">' + hoursText(r.minutes) + "</td>" +
      "<td>" + (r.statusLabel && r.statusLabel !== "—"
        ? tag(r.statusLabel, r.statusTone || "") : '<span class="rv-muted">—</span>') + "</td></tr>";
  }).join("");
  return '<section class="rv-card" aria-labelledby="rvProjTitle">' +
    '<div class="rv-card-head"><h2 id="rvProjTitle">项目推进</h2><span class="rv-hint">按项目汇总本周事件</span>' +
      '<div class="rv-card-act"><button class="rv-link" type="button" data-rv-go="projects">全部项目 ' + icon("chevronRight", 12) + "</button></div></div>" +
    '<div class="rv-scroll"><table class="rv-tbl"><colgroup><col style="width:160"><col style="width:196"><col style="width:118"><col style="width:78"><col></colgroup>' +
      '<thead><tr><th>项目</th><th>需求 <span class="th-sub">新增 / 开始 / 完成 / 发布</span></th>' +
        '<th>工作项 <span class="th-sub">新增 / 完成</span></th><th class="num">登记工时</th><th>状态</th></tr></thead>' +
      "<tbody>" + (body || '<tr><td colspan="5" class="rv-empty-note">本周没有项目事件</td></tr>') + "</tbody>" +
      '<tfoot><tr><td>合计</td><td><span class="rv-flow-mini"><b>' + sums.dc + '</b><span class="l">新</span><span class="rv-sep">·</span><b>' +
        sums.ds + '</b><span class="l">始</span><span class="rv-sep">·</span><b>' + sums.dd +
        '</b><span class="l">完</span><span class="rv-sep">·</span><b>' + sums.dr +
        '</b><span class="l">发</span></span></td><td><span class="rv-flow-mini"><b>' + sums.tc +
        '</b><span class="l">新</span><span class="rv-sep">·</span><b>' + sums.td +
        '</b><span class="l">完</span></span></td><td class="num">' + hoursText(sums.min) + "</td><td></td></tr></tfoot></table></div>" +
    '<p class="rv-tbl-note">' + icon("infoCircle", 12) + "<span>需求按所属项目归属；工作项新增按创建时的所属项目，完成按完成时的所属项目；工时按工作项所属项目。一个需求跨项目拆分时分别计入。</span></p>" +
    "</section>";
}

function risksHTML(d) {
  var r = d.risks || {};
  function card(count, label, sample, tone) {
    return '<div class="rv-risk' + (tone ? " " + tone : "") + '"><b>' + (count || 0) + '</b><span class="rl">' + label + "</span>" +
      (sample ? "<small>" + esc(sample) + "</small>" : "") + "</div>";
  }
  var nextLabel = r.nextLabel || "下周";
  var nextItems = (r.nextItems || []).map(function (it) {
    return '<button class="rv-next-item" type="button" data-rv-kind="task" data-rv-id="' + esc(it.id) + '" title="打开工作项">' +
      '<span class="rv-ni-d">' + esc(md(it.at)) + "</span>" +
      '<span class="rv-ni-t">' + esc(it.title) + "</span>" +
      '<span class="rv-ni-m">' + esc(it.meta || "") + "</span></button>";
  }).join("");
  return '<section class="rv-card" aria-labelledby="rvRiskTitle">' +
    '<div class="rv-card-head"><h2 id="rvRiskTitle">需要关注</h2><span class="rv-hint">截至今天</span></div>' +
    '<div class="rv-risk-grid">' +
      card(r.overdue, "逾期未处理", r.overdueSample, r.overdue ? "danger" : "") +
      card(r.blocked, "阻塞", r.blockedSample, r.blocked ? "warn" : "") +
      card(r.overloaded, "负载超 100%", r.overloadSample, r.overloaded ? "warn" : "") +
      card(r.unlogged, "工时未登记", r.unloggedSample ? r.unloggedSample + "本周有完成" : "", r.unlogged ? "" : "") +
      card(r.idle, "本周无记录", r.idleSample || "", "") +
    "</div>" +
    '<div class="rv-next"><span class="nt">' + esc(nextLabel) + "关注</span>" +
      "<span>" + esc(nextLabel) + "到期 <b>" + (r.nextDue || 0) + "</b></span>" +
      "<span>里程碑 <b>" + (r.nextMilestones || 0) + "</b></span>" +
      "<span>P0 在手 <b>" + (r.p0 || 0) + "</b></span>" +
      "<span>发布超期 <b>" + (r.releaseOverdue || 0) + "</b></span>" +
      "<span>测试计划超期 <b>" + (r.testPlanOverdue || 0) + "</b></span>" +
      "<span>7 天无进展 <b>" + (r.stale || 0) + "</b></span></div>" +
    (nextItems
      ? '<div class="rv-next-list" aria-label="' + esc(nextLabel) + '到期工作项">' +
          '<div class="rv-next-list-head"><b>' + esc(nextLabel) + "到期</b><span>" +
            esc(r.nextRange ? r.nextRange + " · " : "") + "按截止日 · 点开工作项</span></div>" +
          nextItems + "</div>"
      : "") +
    '<p class="rv-footnote">' + icon("infoCircle", 12) + "<span>「7 天无进展」= 7 天内无状态变更、无评论、无登记工时；只提示去确认，不自动判定为风险。「本周无记录」只表示系统内没有留下新增、流转、完成、工时、文档、测试、评论、需求动作或发布记录，可能休假或从事系统外工作，请先确认再判断。</span></p>" +
    "</section>";
}

function teamHasEvents(d) {
  var s = d.stats || {};
  var dm = s.demands || {};
  var w = s.workItems || {};
  var t = s.tests || {};
  var doc = s.docs || {};
  return (dm.created + dm.passed + dm.planned + dm.completed + dm.released + dm.closed + dm.cancelled) > 0 ||
    (w.created + w.transitionEvents + w.completed + w.cancelled) > 0 ||
    (t.newCases + t.newDefects + t.runs + t.fixed) > 0 ||
    (doc.created + doc.updated + doc.published) > 0 ||
    ((d.releases && d.releases.releaseCount) || 0) > 0;
}

function emptyHTML(d) {
  return '<div class="rv-bigstate">' +
    '<span class="rv-bico">' + icon("review", 20) + "</span>" +
    "<h3>" + esc(d.label || "上周") + "团队没有可汇总的交付记录</h3>" +
    "<p>新增工作项、状态流转、进入已完成列、成功生产发布或文档新建 / 更新后，会自动出现在这里。当前周没有事件，不代表团队没有在工作。</p>" +
    '<div class="rv-bact"><button class="btn primary" type="button" data-rv-go="workitems">查看工作项列表</button>' +
    '<button class="btn" type="button" data-rv-refresh>刷新</button></div></div>';
}

function renderTeamReview(d) {
  teamData = d;
  detailKey = "";
  detailError = "";
  if (memberFilter !== "all") memberFilter = "all";
  var el = $("reviewTeamView");
  if (!el) return;
  if (!teamHasEvents(d)) {
    el.innerHTML = emptyHTML(d);
    return;
  }
  el.innerHTML = briefHTML(d) + statTableHTML(d) +
    '<div class="rv-grid2">' + completionHTML(d) + releaseHTML(d) + "</div>" +
    qualityHTML(d) +
    docsHTML(d) +
    membersHTML(d) +
    '<div class="rv-grid2">' + projectsHTML(d) + risksHTML(d) + "</div>";
}

function renderTeamLoading() {
  var el = $("reviewTeamView");
  if (!el) return;
  el.innerHTML = '<div class="rv-card"><div class="rv-loading">' + UI.skeletonRows(6) + "</div></div>" +
    '<div class="rv-card"><div class="rv-loading">' + UI.skeletonRows(4) + "</div></div>";
}

function renderTeamError(msg, retry) {
  var el = $("reviewTeamView");
  if (!el) return;
  el.innerHTML = '<div class="rv-bigstate err">' +
    '<span class="rv-bico">' + icon("alertCircle", 20) + "</span>" +
    "<h3>团队周回顾加载失败</h3>" +
    "<p>数据没有返回，页面不会把失败显示成 0 或空。其他页面不受影响，可重试或先看个人回顾。</p>" +
    '<div class="rv-err-meta">GET /api/review · ' + esc(msg || "网络异常") + "</div>" +
    '<div class="rv-bact"><button class="btn primary" type="button" data-rv-retry>重试</button>' +
    '<button class="btn" type="button" data-rv-scope="me">看我的回顾</button></div></div>';
}

function refreshStatsCard() {
  var card = $("rvStatsCard");
  if (!card || !teamData) return;
  var holder = document.createElement("div");
  holder.innerHTML = statTableHTML(teamData);
  var next = holder.firstChild;
  card.parentNode.replaceChild(next, card);
}

function toggleDetail(key) {
  if (detailKey === key) {
    detailKey = "";
    detailLoading = false;
    detailError = "";
    refreshStatsCard();
    return;
  }
  detailKey = key;
  detailError = "";
  detailLoading = !detailCache[detailCacheKey()];
  refreshStatsCard();
  if (!detailLoading) return;
  fetchDetail();
}

function fetchDetail() {
  var d = teamData;
  if (!d || !detailKey) return;
  var key = detailKey;
  detailLoading = true;
  detailError = "";
  refreshStatsCard();
  API.get("/api/review/team/detail", {
    weekOffset: d.weekOffset,
    reqId: d.reqId || null,
    key: key,
    limit: 20
  }).then(function (page) {
    if (detailKey !== key) return;
    detailCache[detailCacheKey()] = page;
    detailLoading = false;
    refreshStatsCard();
  }).catch(function (ex) {
    if (detailKey !== key) return;
    detailLoading = false;
    detailError = (ex && ex.message) || "网络异常";
    refreshStatsCard();
  });
}

function applyMemberFilter() {
  var tbody = $("rvMemberEmpty");
  if (!tbody) return;
  var rows = document.querySelectorAll("#reviewTeamView .rv-member-tbl tbody tr[data-load]");
  var visible = 0;
  rows.forEach(function (tr) {
    var show = memberFilter === "all" ||
      (memberFilter === "over" && tr.dataset.load === "over") ||
      (memberFilter === "none" && tr.dataset.unlogged === "1");
    tr.hidden = !show;
    if (show) visible++;
  });
  tbody.hidden = visible > 0;
}

function setMemberFilter(f) {
  memberFilter = f;
  document.querySelectorAll("#reviewTeamView [data-rv-mfilter]").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.rvMfilter === f));
  });
  applyMemberFilter();
}

function go(target) {
  if (target === "me") {
    window.dispatchEvent(new CustomEvent("ds:review-scope", { detail: { scope: "me" } }));
    return;
  }
  if (target === "completions") { showView("completions"); return; }
  if (target === "releases") { showView("release"); return; }
  if (target === "docs") { showView("requirements"); return; }
  if (target === "projects") { showView("projects"); return; }
  if (target === "workitems") { showView("list"); return; }
  if (target === "testreport") {
    showView("testcases").then(function () {
      return import("./testcases.js");
    }).then(function (m) {
      if (m && m.setTcMode) m.setTcMode("report");
    });
  }
}

function openItem(kind, id) {
  if (!id) return;
  if (kind === "task") { openTaskById(id); return; }
  if (kind === "demand") {
    import("./demands.js").then(function (m) {
      if (m && m.openDemandDetailById) m.openDemandDetailById(id);
    });
  }
}

var teamEl = $("reviewTeamView");
if (teamEl) teamEl.addEventListener("click", function (e) {
  var b = e.target.closest("[data-rvd]");
  if (b) { toggleDetail(b.dataset.rvd); return; }
  if (e.target.closest("[data-rvd-close]")) {
    detailKey = "";
    detailError = "";
    refreshStatsCard();
    return;
  }
  if (e.target.closest("[data-rvd-retry]")) { fetchDetail(); return; }
  var item = e.target.closest("[data-rv-id]");
  if (item) { openItem(item.dataset.rvKind, item.dataset.rvId); return; }
  var goBtn = e.target.closest("[data-rv-go]");
  if (goBtn) { go(goBtn.dataset.rvGo); return; }
  var scopeBtn = e.target.closest("[data-rv-scope]");
  if (scopeBtn) {
    window.dispatchEvent(new CustomEvent("ds:review-scope", { detail: { scope: scopeBtn.dataset.rvScope } }));
    return;
  }
  if (e.target.closest("[data-rv-retry],[data-rv-refresh]")) {
    window.dispatchEvent(new CustomEvent("ds:review-refresh"));
    return;
  }
  var chip = e.target.closest("[data-rv-mfilter]");
  if (chip) { setMemberFilter(chip.dataset.rvMfilter); return; }
});

/* 团队周报纯文本：与页面数字同源，供「复制」直接发给团队或上级。 */
function teamReportText(d) {
  if (!d) return "";
  var s = d.stats || {}, w = s.workItems || {}, dm = s.demands || {}, t = s.tests || {}, doc = s.docs || {};
  var p = d.pace || {}, rel = d.releases || {}, risk = d.risks || {}, tr = d.trend || {};
  var label = risk.nextLabel || "下周";
  var labelAt = label + (risk.nextRange ? "（" + risk.nextRange + "）" : "");
  var lines = [];
  lines.push("沙漏 · 团队周回顾（" + (d.weekStart || "") + " — " + (d.weekEnd || "") + "）" + (d.reqName ? " · " + d.reqName : ""));
  lines.push("");
  lines.push("【结论】新增 " + (w.created || 0) + " 个工作项（故事 " + (w.story || 0) + " / 任务 " + (w.task || 0) +
    " / 缺陷 " + (w.bug || 0) + "），流转 " + (w.transitionEvents || 0) + " 次、涉及 " + (w.transitionItems || 0) +
    " 项，完成 " + (w.completed || 0) + " 个（故事 " + (w.doneStory || 0) + " / 任务 " + (w.doneTask || 0) +
    " / 缺陷 " + (w.doneBug || 0) + "）；需求新增 " + (dm.created || 0) + "、完成 " + (dm.completed || 0) +
    "、发布覆盖 " + (dm.released || 0) + " 项。");
  lines.push("【计划兑现】截止日在本周 " + (p.dueTotal || 0) + " 项：按期 " + (p.dueOnTime || 0) + "、延期 " +
    (p.dueLate || 0) + "、仍未完成 " + (p.dueOpen || 0) + "，兑现率 " + (p.dueRate || 0) + "%（当前时点回看）。");
  if ((tr.completed || []).length) {
    lines.push("【近 4 周】完成 " + tr.completed.join(" → ") + "；新增 " + (tr.created || []).join(" → ") +
      "；推进 " + (tr.transitions || []).join(" → ") + "。");
  }
  lines.push("【测试】执行 " + (t.runs || 0) + " 条，通过率 " + (t.passRate || 0) + "%，新增用例 " + (t.newCases || 0) +
    "，新增缺陷 " + (t.newDefects || 0) + "，修复关闭 " + (t.fixed || 0) + "。");
  lines.push("【发布】成功生产发布 " + (rel.releaseCount || 0) + " 次，覆盖需求 " + (rel.demandCount || 0) +
    " 项；发布计划完成 " + (rel.planCompleted || 0) + " / " + (rel.planTotal || 0) + "。");
  lines.push("【文档】新增 " + (doc.created || 0) + "、更新 " + (doc.updated || 0) + "、发布 " + (doc.published || 0) + "。");
  lines.push("【需要关注】超载 " + (risk.overloaded || 0) + " 人，逾期 " + (risk.overdue || 0) + " 项，阻塞 " +
    (risk.blocked || 0) + " 项，本周无记录 " + (risk.idle || 0) + " 人；" + labelAt + "到期 " + (risk.nextDue || 0) +
    " 项，里程碑 " + (risk.nextMilestones || 0) + " 个。");
  if ((risk.nextItems || []).length) {
    lines.push("");
    lines.push("【" + labelAt + "到期】");
    risk.nextItems.forEach(function (it) {
      lines.push("· " + md(it.at) + " " + (it.title || "") + (it.meta ? "（" + it.meta + "）" : ""));
    });
  }
  lines.push("");
  lines.push("口径：事件按周统计；在手、负载、逾期、阻塞为截至 " +
    String(d.asOf || "").slice(0, 16).replace("T", " ") + " 的快照。");
  return lines.join("\n");
}

function currentTeamReportText() {
  return teamData ? teamReportText(teamData) : "";
}

export { renderTeamReview, renderTeamLoading, renderTeamError, applyMemberFilter, teamHasEvents, teamReportText, currentTeamReportText };
