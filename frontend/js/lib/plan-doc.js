/* ==========================================================================
   plan-doc.js · 发布计划维度交付说明的纯渲染器
   一份计划覆盖多个版本：每个版本成一章事实切片，顶层的承诺与需求按 ID 去重后再合计，
   质量 / 缺陷 / 需求明细按版本列出并标注版本，不做跨版本相加。
   与 delivery-doc.js 同契约：不读写 DOM、不发请求、不改入参；样式沿用 delivery.css。
   ========================================================================== */

import { icon } from "../core/icons.js";
import { DD } from "./delivery-doc.js";
import { assocLinkHTML } from "./format.js";

var esc = DD.esc;
function nz(v) { return Number(v) || 0; }
function arr(v) { return Array.isArray(v) ? v : []; }
function txt(v) { return v == null ? "" : String(v).trim(); }
var dateText = DD.dateText, timeText = DD.timeText, hours = DD.hours;
var options = DD.options, toneName = DD.toneName, locked = DD.locked;

var TONES = DD.TONES, GROUPS = DD.GROUPS;
var CONFIRM_FIELDS = ["summary", "change", "issue", "acceptance"];
var CONFIRM_SECTION = { summary: "summary", change: "changes", issue: "defects", acceptance: "acceptance" };
var STATE_NAMES = { fulfilled: "已兑现", partial: "部分兑现", deferred: "已延后", pending: "未兑现" };
var KIND_NAMES = { new: "新增", improve: "优化", fix: "修复", other: "其他" };
var KIND_TONES = { new: "ok", improve: "pri", fix: "warn", other: "" };
var TYPE_LABELS = { story: "需求", task: "任务", bug: "缺陷", epic: "主题" };
var SCOPE_STATE_NAMES = { released: "已上线", done: "已完成", pending: "未纳入", deferred: "延后" };
var OPERATION_NAMES = { deploy: "部署", redeploy: "重部署", rollback: "回滚" };
var COVERAGE_NAMES = { full: "全量", partial: "部分", unknown: "覆盖未知" };
var VERSION_STATE = { planned: "计划中", active: "进行中", released: "已发布", closed: "已关闭", canceled: "已取消" };

function num(v) {
  if (v == null || v === "") return "—";
  return String(Math.round(Number(v) * 10) / 10);
}
function signed(v) { var n = Number(v) || 0; return (n > 0 ? "+" : "") + num(n); }
function p2(n) { return n < 10 ? "0" + n : String(n); }
function mdt(s) { return s ? String(s).slice(5, 10) : "—"; }
function planLabel(d) {
  var p = d.plan || {};
  var n = Number(p.planNo) || 0;
  if (n > 0) { var s = String(n); while (s.length < 3) s = "0" + s; return "PL-" + s; }
  return txt(d.scopeName) || txt(p.id);
}
function relLabel(rel) {
  var n = Number(rel && rel.releaseNo) || 0;
  if (n > 0) { var s = String(n); while (s.length < 3) s = "0" + s; return "REL-" + s; }
  return rel ? txt(rel.id) || "发布记录" : "—";
}
function audience(d) { return txt(d.audience) || "未指定交付对象"; }
function narrative(d, field) {
  var v = d && d.narratives ? d.narratives[field] : null;
  return v == null ? null : String(v);
}
function confirmed(d, field) { return arr(d && d.confirmed).indexOf(field) !== -1; }
function chapters(d) { return arr(d.versionChapters); }
function releasedCount(d) {
  return chapters(d).filter(function (c) { return c.released; }).length;
}
function openDefects(d) {
  var def = d.defects || {};
  var rows = arr(def.open).concat(arr(def.fixed));
  return { open: arr(def.open), fixed: arr(def.fixed), total: rows.length };
}
function kindOf(x) { return KIND_NAMES[x.kind] ? x.kind : ""; }
function kindBadge(kind) {
  return KIND_NAMES[kind] ? badge(KIND_TONES[kind] || "", KIND_NAMES[kind]) : badge("", "未关联");
}
function typeName(x) { return x.itemTypeName || TYPE_LABELS[x.itemType] || "工作项"; }
function versionChip(versionName, cls) {
  return versionName ? chip(cls || "", versionName) : "";
}
function demandNo(x) {
  var n = Number(x.demandNo) || 0;
  if (n <= 0) return txt(x.id);
  var s = String(n); while (s.length < 3) s = "0" + s;
  return "DM-" + s;
}
function itemNo(x) {
  var n = Number(x.itemNo) || 0;
  if (n <= 0) return txt(x.id);
  var s = String(n); while (s.length < 3) s = "0" + s;
  return "WI-" + s;
}

/* ---- 小片段 ---- */
function chip(cls, text, ic) {
  return '<span class="dl-chip ' + (cls || "") + '">' + (ic ? icon(ic, 11) : "") + esc(text) + "</span>";
}
function badge(cls, text) { return '<span class="dl-badge ' + (cls || "") + '">' + esc(text) + "</span>"; }
function secHead(n, title, hint) {
  return '<div class="dl-sec-head"><span class="dl-sec-idx">' + esc(n) + "</span><h2>" + esc(title) + "</h2>"
    + (hint ? '<span class="dl-sec-hint">' + esc(hint) + "</span>" : "") + "</div>";
}
function sec(key, n, title, hint, body, extra) {
  return '<section class="dl-sec' + (extra ? " " + extra : "") + '" id="dl-sec-' + key + '">'
    + secHead(n, title, hint) + body + "</section>";
}
function metric(value, unit, label, sub, cls) {
  return '<div class="dl-metric ' + (cls || "") + '"><b>' + esc(value) + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</b>"
    + "<span>" + esc(label) + "</span>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</div>";
}
function missing(text) { return '<div class="dl-missing">' + icon("infoCircle", 15) + "<div>" + text + "</div></div>"; }
function gap() { return '<div class="dl-gap"></div>'; }
function bar(segs, total, height) {
  var sum = Math.max(1, nz(total));
  return '<div class="dl-bar"' + (height ? ' style="height:' + height + 'px"' : "") + ">"
    + segs.map(function (s) { return '<i style="width:' + (nz(s.v) / sum * 100) + "%;background:" + s.c + '" title="' + esc(s.n) + '"></i>'; }).join("")
    + "</div>";
}
function legend(segs) {
  return '<div class="dl-legend">' + segs.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + esc(s.n) + "</span>"; }).join("") + "</div>";
}
function kv(label, value, cls) {
  return '<div class="dl-kvbox' + (cls ? " " + cls : "") + '"><span>' + esc(label) + "</span><strong>"
    + esc(value == null || value === "" ? "未记录" : value) + "</strong></div>";
}

/* ---- 叙述块：与版本维度同一套交互（编辑 / 确认 / 撤回 / 恢复） ---- */
function narr(d, field, view) {
  var isLocked = locked(d) || view.readonly;
  var pending = !isLocked && CONFIRM_FIELDS.indexOf(field) !== -1 && !confirmed(d, field);
  var edited = narrative(d, field);
  var val = edited != null ? edited : autoText(d, field);
  var editable = !isLocked && d.canEdit !== false && (view.editMode || view.editingField === field);
  return '<div class="dl-narr-wrap' + (pending ? " pending" : "") + '" data-dl-wrap="' + field + '">'
    + '<div class="dl-narr" data-dl-field="' + field + '"'
    + (editable ? ' contenteditable="true" spellcheck="false" role="textbox" aria-label="编辑这段说明"' : "") + ">"
    + esc(val) + "</div>"
    + (view.readonly ? "" : '<div class="dl-narr-bar">' + narrBar(d, field, pending, edited != null) + "</div>")
    + "</div>";
}
function narrBar(d, field, pending, edited) {
  if (locked(d)) return chip("plum", "快照已锁定", "lock");
  if (d.canEdit === false) return chip("plain", "只读 · 无改写权限", "lock");
  if (pending) {
    return chip("warn", "系统草拟 · 待确认") + '<span class="nb-t">核对这段对外表述</span>'
      + '<button class="btn sm soft" type="button" data-dl-act="accept" data-dl-key="' + field + '">确认这段</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="edit-one" data-dl-field="' + field + '">改写</button>';
  }
  return chip("ok", edited ? "已人工改写并确认" : "已确认", "check")
    + (edited ? '<button class="btn sm ghost" type="button" data-dl-act="restore" data-dl-field="' + field + '">恢复系统草稿</button>' : "")
    + '<button class="btn sm ghost" type="button" data-dl-act="edit-one" data-dl-field="' + field + '">改写</button>'
    + '<button class="btn sm ghost" type="button" data-dl-act="unconfirm" data-dl-key="' + field + '">撤回确认</button>';
}

/* ==================== 门禁与目录 ==================== */

function planEvidence(d) { return d && d.evidenceKind === "release_snapshot"; }
function sectionList(d) {
  var o = options(d), list = [];
  list.push({ k: "summary", title: "交付摘要" });
  list.push({ k: "plan", title: "计划与版本" });
  list.push({ k: "scope", title: "交付内容" });
  if (o.showChanges) list.push({ k: "changes", title: "变更记录" });
  list.push({ k: "quality", title: "验证与遗留" });
  if (o.showDefects) list.push({ k: "defects", title: "缺陷与已知问题" });
  if (o.showDemands && o.tone !== "customer" && arr(d.demands).length) list.push({ k: "demands", title: "需求兑现" });
  if (o.showEffort) list.push({ k: "effort", title: o.tone === "customer" ? "投入概况" : "投入与负载" });
  if (o.showRelease) list.push({ k: "release", title: "发布与运行信息" });
  list.push({ k: "risks", title: "后续计划与风险" });
  if (o.showAcceptance) list.push({ k: "acceptance", title: "验收与结论" });
  if (o.showSupport) list.push({ k: "support", title: "支持与联系" });
  if (o.tone === "internal") list.push({ k: "internal", title: "内部备注" });
  if (txt(narrative(d, "note"))) list.push({ k: "note", title: "补充说明" });
  list.push({ k: "evidence", title: "证据与附件" });
  if (o.showCaliber) list.push({ k: "caliber", title: "附录 · 统计口径" });
  if (o.showRevisions && arr(d.revisions).length) list.push({ k: "revisions", title: "附录 · 修订记录" });
  return list;
}
function sectionVisible(d, key) {
  return sectionList(d).some(function (s) { return s.k === key; });
}
function pendingFields(d) {
  if (locked(d)) return [];
  return CONFIRM_FIELDS.filter(function (f) {
    return sectionVisible(d, CONFIRM_SECTION[f]) && !confirmed(d, f);
  });
}
function pendingSection(d) {
  var list = pendingFields(d);
  return list.length ? CONFIRM_SECTION[list[0]] : "";
}
function visibleEvidence(d) {
  var o = options(d);
  return arr(d.evidence).filter(function (e) {
    return nz(e.level) <= o.evidence && (!e.internal || o.tone !== "customer");
  });
}
function gates(d) {
  var o = options(d), evidence = planEvidence(d);
  var customerBlocked = !evidence && o.tone === "customer";
  var pending = pendingFields(d);
  var exportBlock = customerBlocked ? "计划内仍有版本未完成本计划的成功生产发布，客户版不可导出；请切到管理版或内部版"
    : pending.length ? "还有 " + pending.length + " 处对外表述待确认，逐段核对后再导出" : "";
  var shareBlock = locked(d) ? ""
    : customerBlocked ? "计划内仍有版本未完成本计划的成功生产发布，客户版不可分享"
    : o.tone === "internal" ? "内部复盘版含内部备注，不提供分享链接"
    : !evidence ? "只有计划内各版本都有成功的生产发布记录，才可作为对外交付依据"
    : pending.length ? "还有 " + pending.length + " 处对外表述待确认，确认后才能冻结快照" : "";
  return {
    blocked: !evidence, customerBlocked: customerBlocked, pending: pending, production: evidence,
    canExport: !exportBlock, exportBlock: exportBlock, canShare: !shareBlock, shareBlock: shareBlock
  };
}

/* ==================== 文字投影 ==================== */

function summaryText(d) {
  var o = options(d), c = d.counts || {}, ds = d.demandSummary || {}, q = d.quality || {}, g = gates(d);
  var chs = chapters(d), rel = releasedCount(d), v = o.verbosity, L = [];
  if (g.blocked) {
    L.push("截至 " + timeText(d.generatedAt) + "，发布计划 " + planLabel(d) + " 覆盖的 " + chs.length
      + " 个版本中有 " + (chs.length - rel) + " 个尚无本计划的成功生产发布，本说明为内部草稿；完成数量不代表已交付。");
  } else {
    L.push("发布计划 " + planLabel(d) + " 覆盖的 " + chs.length + " 个版本均已完成本计划的生产发布，本说明的范围与数字取自各版本的发布快照。");
  }
  L.push("计划共承诺 " + nz(c.planned) + " 项工作项"
    + (g.blocked ? "，已完成 " + nz(c.done) + " 项，但本计划实际发布 " + nz(c.released) + " 项"
      : "，实际发布 " + nz(c.released) + " 项、未纳入 " + nz(c.pending) + " 项")
    + "，延后 " + nz(c.deferred) + " 项。");
  if (v >= 1) {
    if (arr(d.demands).length) {
      L.push("涉及需求 " + nz(ds.total) + " 条，已兑现 " + nz(ds.fulfilled) + " 条"
        + (nz(ds.partial) ? "、部分兑现 " + nz(ds.partial) + " 条" : "")
        + (nz(ds.deferred) ? "、延后 " + nz(ds.deferred) + " 条" : "")
        + "，兑现率 " + (ds.ratePct == null ? "—" : num(ds.ratePct) + "%") + "。");
    }
    var missing = chs.filter(function (x) { return x.quality && x.quality.missing; }).length;
    L.push(q.missing ? "各版本均未建立可用的回归执行结果，不推断质量水平。"
      : missing ? missing + " 个版本没有测试计划或未圈选用例，质量证据按版本分章列出。"
        : "回归执行按版本分章列出，不做跨版本合计；累计执行 " + nz(q.executedCount) + " / " + nz(q.caseCount) + " 条。");
    var def = d.defects || {};
    if (!def.missing) {
      L.push("计划内缺陷共 " + nz(def.totalCount) + " 项，已修复 " + nz(def.fixedCount) + " 项，遗留 "
        + nz(def.openCount) + " 项" + (nz(def.blockerOpenCount) ? "，其中 " + nz(def.blockerOpenCount) + " 项可能阻塞验收" : "，均不阻塞验收") + "。");
    }
  }
  if (v >= 2) {
    var p = d.plan || {};
    L.push("计划窗口 " + (p.plannedAt ? timeText(p.plannedAt) : "未定") + "，环境 "
      + (p.environmentName || "未记录") + "，状态 " + (p.statusName || "未记录") + "；"
      + "覆盖 " + arr(p.projectNames).length + " 个项目。");
    if (o.showEffort && o.tone !== "customer" && !(d.effort && d.effort.missing)) {
      L.push("计划累计投入 " + hours(d.effort.workMinutes) + " 小时，预估 " + hours(d.effort.estimateMinutes)
        + " 小时，偏差 " + signed(hours(d.effort.deviationMinutes)) + " 小时。");
    }
    if (o.tone === "internal") L.push("内部口径：本文档含责任人与内部备注，不对外分享；对外请切客户版并重新冻结快照。");
    L.push("质量、缺陷与投入按版本分章列出，顶层累计值只作参考，不能替代逐版本核对。");
  }
  return L.join(v === 0 ? "" : "\n");
}
function changeText(d) {
  var o = options(d), rows = arr(d.changes), v = o.verbosity, L = [];
  if (!rows.length) {
    L.push("本计划覆盖的版本自各自承诺基线以来没有记录到范围或排期变更。");
    if (v >= 1) L.push("后续对范围、负责人与目标日期的调整会自动进入变更台账，并带操作人与来源。");
    return L.join(v === 0 ? "" : "\n");
  }
  var byVersion = {};
  rows.forEach(function (r) { var k = r.versionName || "未标注版本"; byVersion[k] = (byVersion[k] || 0) + 1; });
  L.push("计划内共记录 " + rows.length + " 条变更，按版本："
    + Object.keys(byVersion).map(function (k) { return k + " " + byVersion[k] + " 条"; }).join("、") + "。");
  if (v >= 1) {
    rows.slice(0, v >= 2 ? 8 : 3).forEach(function (r) {
      L.push("· " + dateText(r.date) + " " + (r.versionName ? "[" + r.versionName + "] " : "") + r.title
        + (txt(r.reason) ? "：" + r.reason : ""));
    });
    if (rows.length > (v >= 2 ? 8 : 3)) L.push("其余变更见「变更记录」逐条清单。");
  }
  if (v >= 2) L.push("移出项仍保留在各自版本承诺台账中，不计入本次已发布数量。");
  return L.join(v === 0 ? "" : "\n");
}
function issueText(d) {
  var o = options(d), def = d.defects || {}, v = o.verbosity, L = [];
  var chs = chapters(d), missing = chs.filter(function (x) { return x.quality && x.quality.missing; });
  if (missing.length === chs.length) {
    L.push("计划内各版本均未创建可用的测试计划，系统内没有执行结果，不给出通过率，也不推断质量水平。");
  } else {
    L.push("质量证据按版本分章列出（用例可跨版本复用，不能相加当总数）：");
    chs.forEach(function (x) {
      var q = x.quality || {};
      L.push("· " + x.versionName + "：" + (q.missing ? "未验证（无测试计划或未圈选用例）"
        : "圈选 " + nz(q.caseCount) + " 条，已执行 " + nz(q.executedCount) + " 条，通过率 "
          + (q.passRatePct == null ? "—（无有效分母）" : num(q.passRatePct) + "%")
          + (nz(q.skippedCount) ? "，跳过 " + nz(q.skippedCount) + " 条" : "")));
    });
  }
  if (!def.missing) {
    L.push(nz(def.openCount)
      ? "计划内遗留 " + nz(def.openCount) + " 项未关闭缺陷"
        + (nz(def.blockerOpenCount) ? "，其中 " + nz(def.blockerOpenCount) + " 项可能阻塞验收" : "，均不阻塞验收")
        + "，逐项见「缺陷与已知问题」。"
      : "计划内关联的 " + nz(def.totalCount) + " 项缺陷已全部关闭。");
  } else if (v >= 1) {
    L.push("系统内没有与计划内版本关联的缺陷记录；已知问题清单为空不代表没有质量问题。");
  }
  return L.join(v === 0 ? "" : "\n");
}
function acceptanceText(d) {
  var o = options(d), a = d.acceptance || {}, v = o.verbosity, c = d.counts || {}, def = d.defects || {}, L = [];
  if (a.conclusionKind === "verified") {
    L.push("按系统记录核对：计划内各版本均已纳入本计划的生产发布，回归无未通过项，无阻塞验收的遗留缺陷，具备提交验收的条件。");
  } else if (a.conclusionKind === "partial") {
    L.push("按系统记录核对：本计划交付为部分达成——"
      + (releasedCount(d) < chapters(d).length ? "尚有 " + (chapters(d).length - releasedCount(d)) + " 个版本未完成本计划的生产发布；" : "")
      + (nz(c.pending) ? "尚有 " + nz(c.pending) + " 项承诺未纳入发布；" : "")
      + (nz(def.blockerOpenCount) ? "有 " + nz(def.blockerOpenCount) + " 项严重缺陷未关闭；" : "")
      + "建议按下方条件逐项核对后再签认。");
  } else {
    L.push("计划内仍有版本未完成本计划的生产发布，交付事实无法整体核对，本文档不构成验收依据。");
  }
  if (v >= 1) L.push("验收依据全部取自各版本可核对的系统记录（见下方清单），不含人工推断；签认仍需人工完成。");
  if (v >= 2) L.push("若验收条件与实际约定不一致，请在「验收补充」中写明差异与双方确认结论，该说明会随快照一起冻结。");
  return L.join(v === 0 ? "" : "\n");
}
function autoText(d, field) {
  if (field === "summary") return summaryText(d);
  if (field === "change") return changeText(d);
  if (field === "issue") return issueText(d);
  if (field === "acceptance") return acceptanceText(d);
  return "";
}

/* ==================== 分章与清单 ==================== */

function versionLink(x, view) {
  if (view.plainLinks) return esc(x.versionName || "");
  return assocLinkHTML("version", x.versionId, x.versionName || "未命名版本", { req: x.reqId });
}
function releaseCell(ch) {
  var rel = ch.release;
  if (!rel) return ch.released ? badge("warn", "未取到发布记录") : badge("", "未发布");
  return badge("ok", relLabel(rel)) + '<span class="dl-cell-sub">' + esc((rel.environmentName || rel.environment || "")
    + " · " + timeText(rel.occurredAt)) + "</span>";
}
function qualityCell(ch) {
  var q = ch.quality || {};
  if (q.missing) return '<span class="dl-cell-sub">未验证</span>';
  return esc(num(q.passRatePct) + "%") + '<span class="dl-cell-sub">'
    + nz(q.executedCount) + " / " + nz(q.caseCount) + " 条</span>";
}
function defectCell(ch) {
  var def = ch.defects || {};
  if (def.missing) return '<span class="dl-cell-sub">未记录</span>';
  return esc(nz(def.openCount)) + '<span class="dl-cell-sub">遗留 · 共 ' + nz(def.totalCount) + " 项</span>";
}

function secSummary(d, n, view) {
  var c = d.counts || {}, g = gates(d), chs = chapters(d), rel = releasedCount(d);
  var def = d.defects || {}, ds = d.demandSummary || {};
  var tiles = [
    metric(rel + " / " + chs.length, "", "已发布版本 / 计划版本",
      g.blocked ? "尚有 " + (chs.length - rel) + " 个版本未完成本计划发布" : "全部版本已完成生产发布",
      g.blocked ? "warn" : "ok"),
    metric(nz(c.released) + " / " + nz(c.planned), "", "已上线 / 承诺",
      g.blocked ? "已完成 " + nz(c.done) + " 项" : "本次未上线 " + (nz(c.pending) + nz(c.deferred)) + " 项",
      g.blocked ? "warn" : "ok"),
    metric(arr(d.projects).length + " / " + nz(ds.total), "", "涉及项目 / 涉及需求",
      arr((d.plan || {}).projectNames).slice(0, 2).join(" · ") || "未归属项目", "pri"),
    metric(nz(def.openCount), "项", "遗留缺陷",
      nz(def.blockerOpenCount) ? "阻塞验收 " + nz(def.blockerOpenCount) + " 项" : "不阻塞验收",
      nz(def.blockerOpenCount) ? "bad" : nz(def.openCount) ? "warn" : "ok")
  ];
  return sec("summary", n, "交付摘要", "自动生成 · 数字只读，文字可改",
    '<div class="dl-mgrid">' + tiles.join("") + "</div>" + narr(d, "summary", view));
}

function secPlanSection(d, n, view) {
  var p = d.plan || {}, chs = chapters(d);
  var info = '<div class="dl-kvs">'
    + kv("计划编号", planLabel(d))
    + kv("计划时间", p.plannedAt ? timeText(p.plannedAt) : "未定")
    + kv("状态", p.statusName || "未记录")
    + kv("环境 · 覆盖", (p.environmentName || "未记录") + " · " + (COVERAGE_NAMES[p.coverage] || "覆盖未知"))
    + kv("计划范围", nz(p.taskCount) + " 项")
    + (options(d).tone === "customer" ? "" : kv("计划负责人", p.ownerName || "未指定"))
    + "</div>";
  var rows = chs.map(function (x) {
    return '<div class="dl-row body dl-chp-row">'
      + '<span class="tt"><b>' + versionLink(x, view) + "</b><span>"
      + esc([x.projectName, VERSION_STATE[x.versionStatus] || x.versionStatus || "",
        x.targetDate ? "目标 " + dateText(x.targetDate) : "未设目标日"].filter(Boolean).join(" · ")) + "</span></span>"
      + '<span class="dl-chp-cell">' + releaseCell(x) + "</span>"
      + '<span class="dl-chp-cell">' + qualityCell(x) + "</span>"
      + '<span class="dl-chp-cell">' + defectCell(x) + "</span>"
      + "</div>";
  }).join("");
  var body = info + gap()
    + '<div class="dl-rows dl-chp"><div class="dl-row head"><span>版本</span><span>发布记录</span><span>回归通过率</span><span>缺陷</span></div>'
    + (rows || '<div class="dl-missing">' + icon("infoCircle", 15) + "<div>计划没有覆盖版本。</div></div>") + "</div>"
    + (txt(p.notes) ? gap() + '<div class="dl-defs"><div class="dl-def"><span class="grow">发布安排</span></div>'
      + '<div class="dl-caliber">' + esc(p.notes) + "</div></div>" : "");
  return sec("plan", n, "计划与版本", chs.length + " 个版本 · " + arr(p.projectNames).length + " 个项目", body);
}

function secScope(d, n, view) {
  var o = options(d), c = d.counts || {}, g = gates(d), chs = chapters(d);
  var all = arr(d.scope), rest = [];
  all.forEach(function (x) { if (x.state !== "released") rest.push(x); });
  var listed = g.blocked ? all : all.filter(function (x) { return x.state === "released"; });
  var body = "";
  if (!listed.length) {
    body = missing(g.blocked ? "计划内没有绑定工作项。" : "各版本发布快照内没有「已上线」的工作项；本说明不虚构交付内容。");
  } else {
    body = chs.map(function (ch) {
      var rows = listed.filter(function (x) { return x.versionId === ch.versionId; });
      if (!rows.length) return "";
      return scopeGroupForVersion(ch, rows, o, view);
    }).join("");
  }
  var off = "";
  if (!g.blocked && o.includeUnreleased && rest.length) {
    off = gap() + '<div class="dl-off"><div class="dl-off-head"><b>本次未上线</b><span>'
      + rest.length + " 项 · 不计入本次交付，不计入上线统计</span></div>"
      + rest.slice(0, 40).map(function (x) {
        return '<div class="dl-off-row"><span class="dl-ot">' + esc(x.versionName || typeName(x)) + "</span>"
          + '<div class="dl-om"><b>' + esc(x.title) + "</b><span>"
          + esc([itemNo(x), x.demandTitle || "未关联需求", x.reason || "未纳入本次发布"].filter(Boolean).join(" · ")) + "</span></div>"
          + kindBadge(x.kind) + "</div>";
      }).join("") + (rest.length > 40 ? '<p class="hint">仅列前 40 项，完整清单见各版本交付说明。</p>' : "") + "</div>";
  }
  return sec("scope", n, "交付内容",
    g.blocked ? "承诺台账 " + nz(c.planned) + " 项 · 草稿，未确认发布" : "已上线 " + nz(c.released) + " 项 · 按版本分章",
    body + off);
}

/* 内容清单在计划维度以版本为一级分组，再按生成控制选的分组方式细分 */
function scopeGroupForVersion(ch, rows, o, view) {
  var groups = [], index = {};
  function slot(key, title) {
    if (!index[key]) { index[key] = { key: key, title: title, rows: [] }; groups.push(index[key]); }
    return index[key];
  }
  rows.forEach(function (x) {
    if (o.groupBy === "type") {
      slot("t:" + (x.itemType || ""), TYPE_LABELS[x.itemType] || typeName(x)).rows.push(x);
    } else if (o.groupBy === "project") {
      slot("p:" + (x.projectName || "__none__"), x.projectName || "未归属项目").rows.push(x);
    } else {
      slot("d:" + (x.demandId || "__unlinked__"), x.demandId ? (x.demandTitle || demandNo(x)) : "未关联需求").rows.push(x);
    }
  });
  var body = groups.map(function (grp) {
    return '<div class="dl-cgrp"><div class="dl-cgrp-head"><span class="gt">' + esc(grp.title) + "</span>"
      + '<span class="gm">' + grp.rows.length + " 项</span></div><div class=\"dl-rows\">"
      + grp.rows.map(function (x) { return scopeItemRow(x, o); }).join("") + "</div></div>";
  }).join("");
  return '<div class="dl-chapter"><div class="dl-chapter-head"><span class="dl-sec-idx">' + esc(VERSION_STATE[ch.versionStatus] || "版本")
    + '</span><b>' + versionLink(ch, view) + "</b><span class=\"cnt\">" + esc(ch.projectName || "") + " · " + rows.length + " 项</span></div>"
    + body + "</div>";
}
function scopeItemRow(x, o) {
  var meta = [x.ref || itemNo(x), typeName(x), x.demandTitle || (x.demandId ? demandNo(x) : "未关联需求"),
    o.tone === "customer" ? "" : x.owner].filter(Boolean).join(" · ");
  var badgeState = x.state === "released" ? badge("ok", "已上线") : x.state === "deferred" ? badge("warn", "延后")
    : x.state === "done" ? badge("ok", "已完成") : badge("", "未纳入");
  return '<div class="dl-crow"><span class="tt"><b>' + esc(x.title) + "</b><span>" + esc(meta) + "</span></span>"
    + "<span>" + kindBadge(x.kind) + "</span><span>" + badgeState + "</span></div>";
}

function secDemands(d, n) {
  var ds = d.demandSummary || {}, rows = arr(d.demands);
  var segs = [
    { v: nz(ds.fulfilled), c: "var(--success)", n: "已兑现 " + nz(ds.fulfilled) },
    { v: nz(ds.partial), c: "var(--primary)", n: "部分兑现 " + nz(ds.partial) },
    { v: nz(ds.pending), c: "var(--dl-slate)", n: "未兑现 " + nz(ds.pending) },
    { v: nz(ds.deferred), c: "var(--warning)", n: "已延后 " + nz(ds.deferred) }
  ];
  var body = '<div class="dl-mgrid c3">'
    + metric(ds.ratePct == null ? "—" : num(ds.ratePct), ds.ratePct == null ? "" : "%", "需求兑现率",
      "关联工作项全部发布的需求 / 涉及需求", nz(ds.ratePct) >= 90 ? "ok" : "warn")
    + metric(nz(ds.fulfilled) + "/" + nz(ds.total), "", "已兑现需求", "部分兑现 " + nz(ds.partial) + " 条", "ok")
    + metric(nz(ds.deferred) + nz(ds.pending), "条", "未兑现需求", "延后 " + nz(ds.deferred) + " · 未兑现 " + nz(ds.pending), "warn")
    + "</div>" + bar(segs, nz(ds.total)) + legend(segs) + gap()
    + '<div class="dl-rows"><div class="dl-row head"><span>版本</span><span>需求</span><span>工作项</span><span>兑现</span></div>'
    + rows.map(function (x) {
      var cls = x.state === "fulfilled" ? "ok" : x.state === "deferred" ? "warn" : x.state === "partial" ? "pri" : "";
      return '<div class="dl-row body"><span class="dl-mod">' + esc(x.versionName || "—") + "</span>"
        + '<span class="tt"><b>' + esc(x.title) + "</b><span>"
        + esc([demandNo(x), x.priority, x.targetVersionName ? "去向 " + x.targetVersionName : ""].filter(Boolean).join(" · "))
        + "</span></span><span class=\"ty\">" + nz(x.releasedCount) + " / " + nz(x.taskCount) + "</span>"
        + "<span>" + badge(cls, STATE_NAMES[x.state] || "未兑现") + "</span></div>";
    }).join("") + "</div>";
  return sec("demands", n, "需求兑现", nz(ds.total) + " 条需求 · 指标按需求去重，明细按版本标注", body);
}

function secChanges(d, n, view) {
  var rows = arr(d.changes);
  if (!rows.length) {
    return sec("changes", n, "变更说明", "无变更记录",
      missing("计划内各版本自承诺基线以来没有记录到范围或排期变更。") + gap() + narr(d, "change", view));
  }
  var ledger = '<div class="dl-ledger">' + rows.map(function (x) {
    var first = x.kind === "add" ? "ok" : x.kind === "date" ? "warn" : "pri";
    return '<div class="dl-led"><span class="dl-led-d">' + esc(mdt(x.date)) + "</span><div>"
      + '<div class="dl-led-t">' + esc(x.title) + "</div>"
      + '<div class="dl-led-m">' + versionChip(x.versionName) + arr(x.tags).map(function (t, i) { return chip(i === 0 ? first : "", t); }).join("") + "</div>"
      + '<div class="dl-led-w">' + esc([x.actorName, x.source ? "来源：" + x.source : "", x.reason].filter(Boolean).join(" · ")) + "</div></div></div>";
  }).join("") + "</div>";
  return sec("changes", n, "变更说明", rows.length + " 条变更 · 按版本标注", ledger + gap() + narr(d, "change", view));
}

function secQuality(d, n, view) {
  var chs = chapters(d), q = d.quality || {};
  var rows = chs.map(function (ch) {
    var x = ch.quality || {};
    return "<tr><td>" + versionLink(ch, view) + "</td><td>" + esc(x.missing ? "未验证" : (x.planName || "测试计划")) + "</td>"
      + "<td class=\"num\">" + nz(x.caseCount) + "</td><td class=\"num\">" + nz(x.executedCount) + "</td>"
      + "<td class=\"num\">" + (x.passRatePct == null ? "—" : num(x.passRatePct) + "%") + "</td>"
      + "<td class=\"num\">" + (x.coveragePct == null ? "—" : num(x.coveragePct) + "%") + "</td></tr>";
  }).join("");
  var body = '<div class="dl-qbox"><h4>按版本列出的执行结果</h4>'
    + '<table class="dl-set-tbl"><thead><tr><th>版本</th><th>测试计划</th><th>圈选</th><th>已执行</th><th>通过率</th><th>执行覆盖</th></tr></thead>'
    + "<tbody>" + rows + "</tbody></table>"
    + '<p class="dl-set-note">用例可被多个版本引用，通过率与条数不能跨版本相加；顶层累计值只作参考。</p></div>'
    + (nz(q.executedCount) ? '<div class="dl-qbox"><h4>计划累计（按版本相加）</h4>'
      + '<div class="dl-qnums"><div><b>' + nz(q.executedCount) + "/" + nz(q.caseCount) + "</b>已执行 / 圈选</div>"
      + "<div><b>" + (q.passRatePct == null ? "—" : num(q.passRatePct) + "%") + "</b>通过率（去重前参考值）</div>"
      + "<div><b>" + nz(q.passedCount) + "</b>通过次数</div></div></div>" : "")
    + gap() + narr(d, "issue", view);
  return sec("quality", n, "质量与验证", chs.length + " 个版本 · 质量证据按版本分章", body);
}

function secDefects(d, n) {
  var def = d.defects || {}, o = options(d);
  if (def.missing) {
    return sec("defects", n, "缺陷与已知问题", "无关联缺陷记录",
      missing("系统内没有与计划内版本关联的缺陷记录。<b>已知问题清单为空不代表没有质量问题</b>。"));
  }
  var tiles = '<div class="dl-mgrid">'
    + metric(nz(def.totalCount), "项", "关联缺陷", "计划内各版本合并去重", "pri")
    + metric(nz(def.fixedCount), "项", "已修复", "完成时间见逐条清单", "ok")
    + metric(nz(def.openCount), "项", "遗留未关闭", "其中阻塞验收 " + nz(def.blockerOpenCount) + " 项",
      nz(def.openCount) ? "warn" : "ok")
    + "</div>";
  function rows(list, fixed) {
    return list.map(function (x) {
      var meta = [itemNo(x), x.projectName, x.columnName, x.regressionName, o.tone === "customer" ? "" : x.owner,
        fixed ? (x.completedAt ? "完成 " + dateText(x.completedAt) : "") : (x.targetVersionName ? "去向 " + x.targetVersionName : "")]
        .filter(Boolean).join(" · ");
      return '<div class="dl-crow"><span class="tt"><b>' + esc(x.title) + "</b><span>" + esc(meta) + "</span></span>"
        + "<span>" + badge(x.severity === "blocker" || x.severity === "critical" ? "bad" : "warn", x.severityName || x.severity || "—")
        + "</span><span>" + (fixed ? badge("ok", "已修复") : badge("warn", x.blocksAcceptance ? "阻塞验收" : "遗留")) + "</span></div>";
    }).join("");
  }
  var body = tiles + gap()
    + '<div class="dl-cgrp"><div class="dl-cgrp-head"><span class="gt">遗留未关闭</span><span class="gm">'
    + nz(def.openCount) + " 项</span></div><div class=\"dl-rows\">" + (rows(arr(def.open), false) || '<div class="dl-missing">' + icon("checkCircle", 15) + "<div>没有遗留缺陷。</div></div>") + "</div></div>"
    + (arr(def.fixed).length ? gap() + '<div class="dl-cgrp"><div class="dl-cgrp-head"><span class="gt">已修复</span><span class="gm">'
      + arr(def.fixed).length + ' 项</span></div><div class="dl-rows">' + rows(arr(def.fixed), true) + "</div></div>" : "");
  return sec("defects", n, "缺陷与已知问题", "计划内 " + nz(def.totalCount) + " 项 · 已去重", body);
}

function secEffort(d, n) {
  var o = options(d), e = d.effort || {}, chs = chapters(d);
  if (e.missing) {
    return sec("effort", n, "投入概况", "未记录工时",
      missing("计划内版本没有计时与补记，投入无法给出，不用完成数量或预估反推。"));
  }
  var rows = chs.map(function (ch) {
    var x = ch.effort || {};
    return "<tr><td>" + esc(ch.versionName) + "</td><td class=\"num\">" + (x.missing ? "—" : hours(x.workMinutes))
      + "</td><td class=\"num\">" + (x.missing ? "—" : hours(x.estimateMinutes)) + "</td><td class=\"num\">"
      + (x.missing ? "未记录" : signed(hours(x.deviationMinutes))) + "</td></tr>";
  }).join("");
  var bars = arr(o.effortDim === "member" ? e.byMember : e.byModule);
  var body = '<div class="dl-mgrid c3">'
    + metric(hours(e.workMinutes), "h", "实际投入", "计时 + 补记，不用于计费", "pri")
    + metric(hours(e.estimateMinutes), "h", "预估投入", "计划内版本合计", "")
    + metric(signed(hours(e.deviationMinutes)), "h", "偏差", e.deviationPct == null ? "无预估基准" : signed(e.deviationPct) + "%",
      nz(e.deviationMinutes) > 0 ? "warn" : "ok")
    + "</div>"
    + (bars.length ? bar(bars.map(function (x) { return { v: x.minutes, c: "var(--primary)", n: x.name }; }), nz(e.workMinutes))
      + legend(bars.map(function (x) { return { c: "var(--primary)", n: x.name + " " + hours(x.minutes) + "h" }; })) : "")
    + gap() + '<table class="dl-set-tbl"><thead><tr><th>版本</th><th>实际</th><th>预估</th><th>偏差</th></tr></thead><tbody>'
    + rows + "</tbody></table>";
  return sec("effort", n, o.tone === "customer" ? "投入概况" : "投入与负载",
    "按版本 " + chs.length + " 行 · 累计 " + hours(e.workMinutes) + "h", body);
}

function secRelease(d, n, view) {
  var o = options(d), p = d.plan || {}, chs = chapters(d);
  var planBlock = '<div class="dl-defs">'
    + '<div class="dl-def"><span class="grow">计划窗口</span><b>' + esc(p.plannedAt ? timeText(p.plannedAt) : "未定") + "</b></div>"
    + '<div class="dl-def"><span class="grow">环境 · 覆盖</span><b>' + esc((p.environmentName || "未记录") + " · " + (COVERAGE_NAMES[p.coverage] || "覆盖未知")) + "</b></div>"
    + '<div class="dl-def"><span class="grow">同批版本</span><b>' + esc(arr(p.versionNames).join("；") || "—") + "</b></div>"
    + (txt(p.risks) ? '<div class="dl-def"><span class="grow">风险与回滚约定</span><b>' + esc(p.risks) + "</b></div>" : "")
    + "</div>";
  var rows = chs.map(function (ch) {
    var rel = ch.release;
    if (!rel) {
      return '<div class="dl-cgrp"><div class="dl-cgrp-head"><span class="gt">' + esc(ch.versionName) + '</span><span class="gm">未发布</span></div>'
        + '<div class="dl-rows"><div class="dl-crow"><span class="tt"><b>尚无本计划的成功生产发布</b><span>'
        + esc(ch.projectName || "") + "</span></span><span>" + badge("warn", "未确认") + "</span><span></span></div></div></div>";
    }
    var meta = [rel.environmentName || rel.environment, OPERATION_NAMES[rel.operation] || rel.operation,
      (rel.coverage ? COVERAGE_NAMES[rel.coverage] : ""), timeText(rel.occurredAt)].filter(Boolean).join(" · ");
    var extra = "";
    if (o.tone !== "customer") {
      if (arr(rel.targets).length) extra += '<div class="dl-led-w">部署目标：' + esc(arr(rel.targets).join("、")) + "</div>";
      if (txt(rel.artifactRef)) extra += '<div class="dl-led-w">制品：' + esc(rel.artifactRef) + "</div>";
      if (o.evidence >= 2 && txt(rel.artifactDigest)) extra += '<div class="dl-led-w mono">SHA256：' + esc(rel.artifactDigest) + "</div>";
      if (txt(rel.executorName)) extra += '<div class="dl-led-w">执行人：' + esc(rel.executorName) + "</div>";
    }
    if (txt(rel.deviationReason)) extra += '<div class="dl-led-w">未按计划发布：' + esc(rel.deviationReason) + "</div>";
    if (txt(rel.notes)) extra += '<div class="dl-led-w">说明：' + esc(rel.notes) + "</div>";
    return '<div class="dl-cgrp"><div class="dl-cgrp-head"><span class="gt">' + versionLink(ch, view) + "</span>"
      + '<span class="gm">' + esc(relLabel(rel)) + "</span></div><div class=\"dl-rows\"><div class=\"dl-led\" style=\"padding:8px 10px\">"
      + '<div><div class="dl-led-t">' + esc(meta) + "</div>" + extra + "</div></div></div></div>";
  }).join("");
  return sec("release", n, "发布与运行信息", "计划原文 + 逐版本发布记录", planBlock + gap() + rows);
}

function secRisks(d, n, view) {
  var rows = arr(d.risks);
  if (!rows.length) {
    return sec("risks", n, "后续计划与风险", "无遗留事项",
      missing("系统内没有需要单独跟踪的遗留事项。"));
  }
  var o = options(d);
  var body = '<div class="dl-rows"><div class="dl-row head"><span>事项</span><span>影响</span><span>下一步</span><span>状态</span></div>'
    + rows.map(function (x) {
      return '<div class="dl-row body"><span class="tt"><b>' + esc(x.title) + "</b><span>"
        + esc([x.versionName, o.tone === "customer" ? "" : "责任人 " + (x.owner || "待指派")].filter(Boolean).join(" · "))
        + "</span></span><span>" + esc(x.impact || "—") + "</span><span>" + esc(x.next || "—") + "</span>"
        + "<span>" + badge(x.tone || "", x.status || "待处理") + "</span></div>";
    }).join("") + "</div>";
  return sec("risks", n, "后续计划与风险", rows.length + " 项需单独跟踪", body);
}

function secAcceptance(d, n, view) {
  var a = d.acceptance || {};
  var body = narr(d, "acceptance", view)
    + gap() + '<div class="dl-qgrid"><div class="dl-qbox"><h4>验收依据</h4><div class="dl-defs">'
    + (arr(a.basis).length ? arr(a.basis).map(function (t) {
      return '<div class="dl-def"><span class="grow">' + esc(t) + "</span></div>";
    }).join("") : '<div class="dl-def"><span class="grow">无可核对的系统记录</span></div>')
    + "</div></div>"
    + '<div class="dl-qbox"><h4>验收条件</h4><div class="dl-defs">'
    + (arr(a.conditions).length ? arr(a.conditions).map(function (t) {
      return '<div class="dl-def"><span class="grow">' + esc(t) + "</span></div>";
    }).join("") : '<div class="dl-def"><span class="grow">关联需求未填写验收标准</span></div>')
    + '<div class="dl-def total"><span class="grow">阻塞验收缺陷</span><b>' + nz(a.blockerCount) + "</b></div>"
    + '<div class="dl-def"><span class="grow">人工签认</span><b>' + (a.signOffPending ? "待签认" : "已签认") + "</b></div>"
    + "</div></div></div>"
    + (txt(a.note) ? gap() + '<div class="dl-caliber">验收补充：' + esc(a.note) + "</div>" : "")
    + gap() + '<div class="dl-defs"><div class="dl-def"><span class="grow">交付方（编制：' + esc(d.ownerName || "未记录")
    + '）签字</span><b>____________　日期 __________</b></div>'
    + '<div class="dl-def"><span class="grow">接收方（' + esc(audience(d)) + '）签字</span><b>____________　日期 __________</b></div></div>';
  return sec("acceptance", n, "验收与结论", "依据与条件 · 人工签认", body);
}

function secSupport(d, n) {
  return sec("support", n, "支持与联系", "",
    '<div class="dl-defs"><div class="dl-def"><span class="grow">交付对象</span><b>' + esc(audience(d)) + "</b></div>"
    + '<div class="dl-def"><span class="grow">支持联系人</span><b>' + esc(txt(d.supportContact) || "未填写") + "</b></div>"
    + '<div class="dl-def"><span class="grow">编制</span><b>' + esc(d.ownerName || "未记录") + "</b></div></div>");
}
function secInternal(d, n, view) {
  return sec("internal", n, "内部备注（不对外）", "仅内部复盘版",
    narr(d, "internal", view));
}
function secNote(d, n, view) {
  return sec("note", n, "补充说明", "", narr(d, "note", view));
}
function secEvidence(d, n, view) {
  var rows = visibleEvidence(d);
  var body = rows.length ? '<div class="dl-rows">' + rows.map(function (x) {
    return '<div class="dl-evrow"><span class="tt"><b>' + esc(x.name) + "</b><span>" + esc(x.meta) + "</span></span>"
      + (x.missing ? badge("warn", "缺失") : badge("", "已记录"))
      + (!view.plainLinks ? '<button class="btn sm ghost" type="button" data-dl-act="goto" data-dl-view="release-plan">查看计划</button>' : "")
      + "</div>";
  }).join("") + "</div>" : missing("没有可列出的证据记录。");
  var gaps = arr(d.missing);
  return sec("evidence", n, "证据与附件", rows.length + " 项",
    body + (gaps.length ? gap() + '<div class="dl-off"><div class="dl-off-head"><b>系统内确实没有记录的部分</b><span>'
      + gaps.length + " 条 · 不推断、不补造</span></div>"
      + gaps.map(function (t) { return '<div class="dl-off-row"><div class="dl-om"><b>' + esc(t) + "</b></div></div>"; }).join("") + "</div>" : ""));
}
function secCaliber(d, n) {
  var rows = arr(d.calibers);
  return sec("caliber", n, "附录 · 统计口径", rows.length + " 项",
    '<table class="dl-set-tbl"><thead><tr><th>指标</th><th>定义与分母</th><th>数据来源</th></tr></thead><tbody>'
    + rows.map(function (x) {
      return "<tr><td>" + esc(x.name) + "</td><td>" + esc(x.definition) + "</td><td>" + esc(x.source) + "</td></tr>";
    }).join("") + "</tbody></table>");
}
function secRevisions(d, n) {
  var rows = arr(d.revisions);
  return sec("revisions", n, "附录 · 修订记录", rows.length + " 份",
    '<div class="dl-revs">' + rows.map(function (x) {
      return '<div class="dl-rev"><span class="dl-sec-idx">' + esc(x.seq) + "</span>"
        + '<div class="rc"><b>' + esc(x.docNo) + "</b><span>"
        + esc(timeText(x.createdAt) + " · " + (x.createdByName || "未记录") + " · " + toneName(x.tone)
          + " · 校验值 " + String(x.contentHash || "").slice(0, 12)) + "</span></div>"
        + (x.shared ? badge("pri", "已分享") : badge("", "未分享")) + "</div>";
    }).join("") + "</div>");
}

/* ==================== 纸张 ==================== */

function head(d, view) {
  var o = options(d), g = gates(d), chs = chapters(d), rel = releasedCount(d);
  var sub = o.tone === "customer" ? "提交 " + audience(d) + " · 说明计划覆盖范围的交付与发布结果"
    : o.tone === "manager" ? "内部管理版 · 含逐版本投入、负载与风险责任人"
    : "内部复盘版 · 含内部备注，不对外";
  var watermark = g.blocked || (!!o.watermark && !view.clean);
  return '<div class="dl-doc-head">'
    + (watermark ? '<div class="dl-watermark">草稿</div>' : "")
    + (o.brand ? '<div class="dl-letter"><span class="dl-mark">' + DD.mark + "</span>"
      + '<div><div class="lt">沙漏 · 交付报告</div><div class="ls">DELIVERY REPORT · PLAN</div></div>'
      + '<span class="grow"></span><div class="dl-doc-no">' + esc(d.docNo || "未编号") + "<br>"
      + esc(timeText(d.generatedAt)) + "</div></div>" : "")
    + '<div class="dl-kicker">' + esc(toneName(o.tone)) + (view.readonly ? " · 只读快照" : "") + "</div>"
    + '<h1 class="dl-doc-title">' + esc(d.scopeName || planLabel(d)) + "</h1>"
    + '<p class="dl-doc-sub">' + esc(sub) + "</p>"
    + '<div class="dl-doc-meta">'
    + "<div><span>交付对象</span><strong>" + esc(audience(d)) + "</strong></div>"
    + "<div><span>交付周期</span><strong>" + (d.periodStart || d.periodEnd
      ? '<span class="dt">' + esc(dateText(d.periodStart)) + '</span> → <span class="dt">' + esc(dateText(d.periodEnd)) + "</span>"
      : "未记录周期") + "</strong></div>"
    + "<div><span>计划版本</span><strong>" + esc(rel + " / " + chs.length + " 已发布") + "</strong></div>"
    + "<div><span>编制</span><strong>" + esc(d.ownerName || "未记录") + "</strong></div>"
    + "</div>"
    + '<div class="dl-doc-flags">'
    + '<span class="dl-chip pri"><i class="dl-dot pri"></i>由系统记录按版本自动汇总</span>'
    + (g.blocked ? chip("bad", "计划内仍有版本未发布") : chip("ok", "全部版本已完成生产发布", "check"))
    + (g.pending.length && !view.readonly ? chip("warn", g.pending.length + " 处待确认") : chip("ok", "文字已确认", "check"))
    + (locked(d) || view.readonly ? chip("plum", "不可变快照", "lock") : "")
    + (nz(d.snapshotSeq) ? chip("plum", "第 " + nz(d.snapshotSeq) + " 份") : "")
    + "</div>"
    + (view.readonly || view.clean ? "" : '<div class="dl-doc-tools">'
      + '<button class="btn sm" type="button" data-dl-act="edit-mode"' + (locked(d) || d.canEdit === false ? " disabled" : "")
      + (locked(d) ? ' title="快照已锁定，不能编辑"' : d.canEdit === false ? ' title="你对该计划覆盖的项目只有查看权限，不能编辑文字"' : "") + ">"
      + icon("edit", 13) + (view.editMode ? "完成编辑" : "编辑文字") + "</button>"
      + '<button class="btn sm ghost" type="button" data-dl-act="sources">' + icon("eye", 13) + "数据来源总览</button>"
      + chip("", "数字只读 · 按版本分章") + "</div>")
    + "</div>"
    + (g.blocked
      ? '<div class="dl-doc-warning">计划内仍有版本未确认本计划的生产发布：本说明为内部草稿'
        + (o.tone === "customer" ? "，客户版不可导出" : "")
        + "。实际交付以各版本成功的生产发布记录为准，完成数量不代表已交付。</div>" : "");
}

function sheetHTML(d, viewOpts) {
  var view = viewOpts || {}, o = options(d), g = gates(d);
  var list = sectionList(d), idx = {};
  list.forEach(function (s, i) { idx[s.k] = p2(i + 1); });
  var body = secSummary(d, idx.summary, view) + secPlanSection(d, idx.plan, view) + secScope(d, idx.scope, view);
  if (idx.demands) body += secDemands(d, idx.demands);
  if (idx.changes) body += secChanges(d, idx.changes, view);
  body += secQuality(d, idx.quality, view);
  if (idx.defects) body += secDefects(d, idx.defects);
  if (idx.effort) body += secEffort(d, idx.effort);
  if (idx.release) body += secRelease(d, idx.release, view);
  body += secRisks(d, idx.risks, view);
  if (idx.acceptance) body += secAcceptance(d, idx.acceptance, view);
  if (idx.support) body += secSupport(d, idx.support);
  if (idx.internal) body += secInternal(d, idx.internal, view);
  if (idx.note) body += secNote(d, idx.note, view);
  body += secEvidence(d, idx.evidence, view);
  if (idx.caliber) body += secCaliber(d, idx.caliber);
  if (idx.revisions) body += secRevisions(d, idx.revisions);
  var foot = '<div class="dl-doc-foot">本说明由沙漏根据计划内各版本的系统记录自动汇总，实际交付以发布记录为准；不替代部署执行、流水线验证或客户验收签认。'
    + "质量、缺陷与需求按版本分章列出，跨版本累计值只作参考，不能重复计数。<br>"
    + "<b>" + esc(d.docNo || "未编号") + "</b> · 生成时间 " + esc(timeText(d.generatedAt)) + " · " + esc(toneName(o.tone))
    + (locked(d) || view.readonly ? " · 快照已锁定，内容不随系统变化" : " · 草稿，导出后锁定")
    + (txt(d.contentHash) ? " · 内容校验值 " + esc(String(d.contentHash).slice(0, 16)) : "")
    + "</div>";
  return head(d, view) + body + foot;
}
function sheetClass(d) { return "dl-sheet" + (options(d).density === "compact" ? " compact" : ""); }
function sheetMarkup(d, view) {
  var a4 = view && view.a4 ? " dl-a4" : "";
  return '<article class="' + sheetClass(d) + a4 + '">' + sheetHTML(d, view) + "</article>";
}

/* ==================== 数字来源 ==================== */

function sourcesOverview(d) {
  var chs = chapters(d);
  return [
    { name: "发布计划", from: planLabel(d) + " · " + (d.plan && d.plan.statusName || ""), table: "version_release_plan / version_release_plan_version" },
    { name: "覆盖版本", from: chs.map(function (c) { return c.projectName + " · " + c.versionName; }).join("；"), table: "project_version" },
    { name: "发布记录", from: "只取 record.planId = 本计划 且 生产环境、结果成功、非回滚", table: "version_release" },
    { name: "内容清单与承诺", from: "每个版本按自己的发布快照取已上线项，未发布版本退回承诺台账", table: "version_release_item / version_commitment" },
    { name: "需求兑现", from: "各版本关联需求的发布状态，按版本标注，不合并", table: "demand" },
    { name: "质量与缺陷", from: "每个版本自己的测试计划与缺陷记录，按版本分章", table: "test_plan / defect" },
    { name: "投入", from: "各版本工作项计时 + 补记，合计只作参考", table: "time_log" }
  ];
}
function sourceInfo(d, key) {
  var c = d.counts || {}, chs = chapters(d), rows = [];
  function row(id, m, s) { return { id: id, m: m, s: s }; }
  if (key === "released" || key === "chapters") {
    rows = chs.map(function (x) {
      return row(x.versionId, x.projectName + " · " + x.versionName,
        (x.released ? "已发布 " + relLabel(x.release) : "未完成本计划生产发布") + " · 承诺 " + nz(x.counts && x.counts.planned));
    });
    return {
      title: "已发布版本 " + releasedCount(d) + " / " + chs.length, view: "release-plan", refId: (d.plan || {}).id,
      caliber: "口径：只有发布记录的 planId 指向本计划、环境为生产、结果为成功且操作非回滚，才算该版本的交付依据；其他版本的发布记录不计入本计划。",
      rows: rows
    };
  }
  if (key === "defects") {
    var def = d.defects || {};
    rows = arr(def.open).concat(arr(def.fixed)).map(function (x) {
      return row(itemNo(x), x.title, [x.projectName, x.severityName, x.owner].filter(Boolean).join(" · "));
    });
    return { title: "关联缺陷 " + nz(def.totalCount), view: "", refId: "", caliber: "口径：计划内各版本缺陷合并后按 ID 去重；同一缺陷关联多个版本只计一次。明细见各版本交付报告。", rows: rows };
  }
  if (key === "demands") {
    rows = arr(d.demands).map(function (x) { return row(demandNo(x), x.title, [x.versionName, STATE_NAMES[x.state]].filter(Boolean).join(" · ")); });
    return { title: "涉及需求 " + nz((d.demandSummary || {}).total), view: "", refId: "",
      caliber: "口径：需求兑现按「关联工作项是否全部发布」计算；顶层按需求 ID 去重（跨版本只计一次，状态取最好结果），明细按版本标注。", rows: rows };
  }
  if (key === "kinds") {
    rows = arr(d.scope).map(function (x) { return row(itemNo(x), x.title, [KIND_NAMES[x.kind] || "未关联需求", x.versionName].filter(Boolean).join(" · ")); });
    return { title: "新增 / 优化 / 修复", view: "phase", refId: "", caliber: "口径：工作项按其关联需求在需求池登记的性质归类，未关联需求不推断。", rows: rows };
  }
  return { title: "按版本汇总", view: "", caliber: "计划维度的数字都来自逐版本事实切片；顶层承诺与需求按 ID 去重后合计。", rows: rows };
}

/* ==================== Markdown / HTML ==================== */

function markdown(d) {
  var o = options(d), c = d.counts || {}, q = d.quality || {}, def = d.defects || {}, ds = d.demandSummary || {};
  var e = d.effort || {}, a = d.acceptance || {}, chs = chapters(d), idx = {}, L = [];
  sectionList(d).forEach(function (s, i) { idx[s.k] = i + 1; });
  function heading(key, title) { L.push(""); L.push("## " + idx[key] + ". " + title); }
  function text(field) { var v = narrative(d, field); L.push(v == null ? autoText(d, field) : v); }
  L.push("# 交付报告 · " + (d.scopeName || planLabel(d)));
  L.push("");
  L.push("- 语气：" + toneName(o.tone) + "　交付对象：" + audience(d));
  L.push("- 交付周期：" + (d.periodStart || d.periodEnd ? dateText(d.periodStart) + " → " + dateText(d.periodEnd) : "未记录周期"));
  L.push("- 计划：" + planLabel(d) + "　版本：" + releasedCount(d) + " / " + chs.length + " 已发布");
  L.push("- 编制：" + (d.ownerName || "未记录") + "　编号：" + (d.docNo || "未编号") + "　生成时间：" + timeText(d.generatedAt));
  if (locked(d)) L.push("- 状态：不可变快照" + (txt(d.contentHash) ? "　内容校验值：" + d.contentHash : ""));
  heading("summary", "交付摘要");
  text("summary");
  L.push("");
  L.push("| 指标 | 数值 | 口径 |");
  L.push("| --- | --- | --- |");
  L.push("| 已发布版本 | " + releasedCount(d) + " / " + chs.length + " | 本计划覆盖版本中已完成本计划成功生产发布的个数 |");
  L.push("| 已上线 / 承诺 | " + nz(c.released) + " / " + nz(c.planned) + " | 各版本发布快照与承诺台账按工作项 ID 去重后合计 |");
  L.push("| 涉及项目 / 涉及需求 | " + arr(d.projects).length + " / " + nz(ds.total) + " | 计划内工作项所属项目与实际涉及的需求；需求按 ID 去重 |");
  L.push("| 未关闭缺陷 | " + nz(def.openCount) + " | 按 ID 去重，其中阻塞验收 " + nz(def.blockerOpenCount) + " 项 |");
  if (idx.effort) L.push("| 实际投入 | " + (e.missing ? "未记录工时" : hours(e.workMinutes) + "h") + " | 各版本计时 + 补记累计，不用于计费 |");
  heading("plan", "计划与版本");
  var p = d.plan || {};
  L.push("- 计划时间：" + (p.plannedAt ? timeText(p.plannedAt) : "未定") + "　状态：" + (p.statusName || "未记录"));
  L.push("- 环境与覆盖：" + (p.environmentName || "未记录") + " · " + (COVERAGE_NAMES[p.coverage] || "覆盖未知") + "　计划范围：" + nz(p.taskCount) + " 项");
  if (o.tone !== "customer") L.push("- 计划负责人：" + (p.ownerName || "未指定"));
  L.push("");
  L.push("| 版本 | 项目 | 状态 | 发布记录 | 回归 | 缺陷 |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  chs.forEach(function (x) {
    L.push("| " + x.versionName + " | " + (x.projectName || "") + " | " + (VERSION_STATE[x.versionStatus] || x.versionStatus || "")
      + " | " + (x.release ? relLabel(x.release) + " · " + (x.release.environmentName || x.release.environment) + " · " + timeText(x.release.occurredAt) : "未发布")
      + " | " + ((x.quality || {}).missing ? "未验证" : nz((x.quality || {}).executedCount) + " / " + nz((x.quality || {}).caseCount))
      + " | " + (x.defects ? nz(x.defects.openCount) + " 遗留" : "未记录") + " |");
  });
  heading("scope", "交付内容");
  var gk = gates(d), scopeList = gk.blocked ? arr(d.scope) : arr(d.scope).filter(function (x) { return x.state === "released"; });
  if (!scopeList.length) L.push("- 无已上线工作项（不虚构交付内容）");
  var byVer = {};
  scopeList.forEach(function (x) {
    var k = x.versionName || "未标注版本";
    if (!byVer[k]) byVer[k] = [];
    byVer[k].push(x);
  });
  Object.keys(byVer).forEach(function (k) {
    L.push("");
    L.push("**" + k + "**（" + byVer[k].length + " 项，按" + GROUPS[o.groupBy] + "分组）");
    byVer[k].forEach(function (x) {
      var meta = [x.ref || itemNo(x), typeName(x), x.demandTitle || (x.demandId ? demandNo(x) : "未关联需求"),
        o.tone === "customer" ? "" : x.owner].filter(Boolean).join(" · ");
      L.push("- [" + (SCOPE_STATE_NAMES[x.state] || x.state) + "]" + (KIND_NAMES[x.kind] ? " " + KIND_NAMES[x.kind] : "") + " " + x.title + "（" + meta + "）");
    });
  });
  if (idx.demands) {
    heading("demands", "需求兑现");
    arr(d.demands).forEach(function (x) {
      L.push("- [" + (STATE_NAMES[x.state] || x.state) + "] " + x.title + "（" + demandNo(x) + "）　版本 " + (x.versionName || "—")
        + "　工作项 " + nz(x.releasedCount) + "/" + nz(x.taskCount));
    });
  }
  if (idx.changes) {
    heading("changes", "变更说明");
    text("change");
    arr(d.changes).forEach(function (x) {
      L.push("- " + dateText(x.date) + "　" + (x.versionName ? "[" + x.versionName + "] " : "") + x.title
        + "　" + arr(x.tags).join(" / ") + "　" + (x.actorName || "") + (x.reason ? "　理由：" + x.reason : ""));
    });
    if (!arr(d.changes).length) L.push("- 无变更记录");
  }
  heading("quality", "质量与验证");
  text("issue");
  L.push("");
  L.push("| 版本 | 测试计划 | 圈选 | 已执行 | 通过率 |");
  L.push("| --- | --- | --- | --- | --- |");
  chs.forEach(function (x) {
    var xx = x.quality || {};
    L.push("| " + x.versionName + " | " + (xx.missing ? "未验证" : (xx.planName || "测试计划")) + " | " + nz(xx.caseCount)
      + " | " + nz(xx.executedCount) + " | " + (xx.passRatePct == null ? "—" : num(xx.passRatePct) + "%") + " |");
  });
  L.push("");
  L.push("用例可跨版本复用，上表按版本列出，不能相加当总数。");
  if (idx.defects) {
    heading("defects", "缺陷与已知问题");
    if (def.missing) L.push("无关联缺陷记录；清单为空不代表没有质量问题。");
    else {
      L.push("共 " + nz(def.totalCount) + " 项（按 ID 去重），已修复 " + nz(def.fixedCount) + " 项，遗留 " + nz(def.openCount)
        + " 项，其中阻塞验收 " + nz(def.blockerOpenCount) + " 项。");
      arr(def.open).forEach(function (x) {
        L.push("- [遗留] " + (x.projectName ? x.projectName + " · " : "") + (x.severityName || x.severity) + " · " + x.title
          + "（" + itemNo(x) + "）　" + [x.columnName, x.regressionName, o.tone === "customer" ? "" : x.owner].filter(Boolean).join(" · "));
      });
      arr(def.fixed).forEach(function (x) {
        L.push("- [已修复] " + (x.severityName || x.severity) + " · " + x.title + "　完成 " + dateText(x.completedAt));
      });
    }
  }
  if (idx.effort) {
    heading("effort", o.tone === "customer" ? "投入概况" : "投入与负载");
    if (e.missing) L.push("未记录工时，不用完成数量或预估反推投入。");
    else {
      L.push("实际 " + hours(e.workMinutes) + "h · 预估 " + hours(e.estimateMinutes) + "h · 偏差 " + signed(hours(e.deviationMinutes)) + "h");
      chs.forEach(function (x) {
        var xx = x.effort || {};
        L.push("- " + x.versionName + "　" + (xx.missing ? "未记录" : hours(xx.workMinutes) + "h") );
      });
    }
  }
  if (idx.release) {
    heading("release", "发布与运行信息");
    L.push("- 计划窗口：" + (p.plannedAt ? timeText(p.plannedAt) : "未定") + "　环境：" + (p.environmentName || "未记录"));
    if (txt(p.risks)) L.push("- 风险与回滚约定：" + p.risks);
    chs.forEach(function (x) {
      var rel = x.release;
      L.push("- " + x.versionName + "：" + (rel ? relLabel(rel) + " · " + (rel.environmentName || rel.environment) + " · "
        + (OPERATION_NAMES[rel.operation] || rel.operation) + " · " + timeText(rel.occurredAt) : "未完成本计划生产发布"));
      if (rel && o.tone !== "customer" && arr(rel.targets).length) L.push("  - 部署目标：" + arr(rel.targets).join("、"));
      if (rel && o.tone !== "customer" && txt(rel.artifactRef)) L.push("  - 制品：" + rel.artifactRef);
    });
  }
  heading("risks", "后续计划与风险");
  arr(d.risks).forEach(function (x) {
    L.push("- " + (x.versionName ? "[" + x.versionName + "] " : "") + x.title + "　" + x.impact
      + (o.tone === "customer" ? "" : "　责任人 " + (x.owner || "待指派")) + "　" + x.next + "　" + x.status);
  });
  if (!arr(d.risks).length) L.push("- 无遗留事项");
  if (idx.acceptance) {
    heading("acceptance", "验收与结论");
    text("acceptance");
    L.push("");
    L.push("**验收依据**");
    arr(a.basis).forEach(function (t) { L.push("- " + t); });
    if (!arr(a.basis).length) L.push("- 无可核对的系统记录");
    L.push("");
    L.push("**验收条件**");
    arr(a.conditions).forEach(function (t, i) { L.push((i + 1) + ". " + t); });
    if (!arr(a.conditions).length) L.push("- 关联需求未填写验收标准");
    L.push("");
    L.push("- 阻塞验收缺陷：" + nz(a.blockerCount) + " 项　人工签认：" + (a.signOffPending ? "待签认" : "已签认"));
    if (txt(a.note)) L.push("- 验收补充：" + a.note);
    L.push("");
    L.push("**验收签认**（留白手签，系统不代替签字）");
    L.push("- 交付方（编制：" + (d.ownerName || "未记录") + "）　签字：____________　日期：____________");
    L.push("- 接收方（" + audience(d) + "）　签字：____________　日期：____________");
  }
  if (idx.support) {
    heading("support", "支持与联系");
    L.push("- 交付对象：" + audience(d));
    L.push("- 支持联系人：" + (txt(d.supportContact) || "未填写"));
    L.push("- 编制：" + (d.ownerName || "未记录"));
  }
  if (idx.internal) { heading("internal", "内部备注（不对外）"); L.push(narrative(d, "internal") || "（未填写）"); }
  if (idx.note) { heading("note", "补充说明"); L.push(narrative(d, "note") || ""); }
  heading("evidence", "证据与附件");
  visibleEvidence(d).forEach(function (x) { L.push("- " + x.name + "：" + x.meta + (x.missing ? "（缺失）" : "")); });
  if (arr(d.missing).length) {
    L.push("");
    L.push("**系统内确实没有记录的部分**");
    arr(d.missing).forEach(function (t) { L.push("- " + t); });
  }
  if (idx.caliber) {
    heading("caliber", "附录 · 统计口径");
    L.push("");
    L.push("| 指标 | 定义与分母 | 数据来源 |");
    L.push("| --- | --- | --- |");
    arr(d.calibers).forEach(function (x) { L.push("| " + x.name + " | " + x.definition + " | " + x.source + " |"); });
  }
  if (idx.revisions) {
    heading("revisions", "附录 · 修订记录");
    arr(d.revisions).forEach(function (x) {
      L.push("- " + x.docNo + "　" + timeText(x.createdAt) + "　" + (x.createdByName || "") + "　" + toneName(x.tone)
        + (x.shared ? "　已分享" : "") + "　校验值 " + String(x.contentHash || "").slice(0, 12));
    });
  }
  L.push("");
  L.push("---");
  L.push("本说明由沙漏根据计划内各版本的系统记录自动汇总，实际交付以发布记录为准；不替代部署执行、流水线验证或客户验收签认。");
  return L.join("\n");
}

function htmlDocument(d, css) {
  return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\" />\n"
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
    + "<title>交付报告 · " + esc(d.scopeName || planLabel(d)) + "</title>\n"
    + "<style>\n" + (css || "") + "\n"
    + "body{margin:0;padding:24px;background:var(--bg-app);color:var(--text);font-family:var(--font-sans);}\n"
    + ".dl-export-wrap{max-width:900px;margin:0 auto;}\n"
    + "@media print{body{padding:0;}body>*:not(.dl-export-wrap){display:none!important;}}\n"
    + "</style>\n</head>\n<body>\n<div class=\"dl-export-wrap\">\n"
    + sheetMarkup(d, { readonly: true, clean: true, plainLinks: true })
    + "\n</div>\n</body>\n</html>\n";
}

function exportBaseName(d) {
  var raw = (d.scopeName || planLabel(d)) + "-" + (d.docNo || dateText(d.generatedAt));
  return raw.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

var PD = {
  DEFAULTS: DD.DEFAULTS,
  TONES: TONES,
  GROUPS: GROUPS,
  EVIDENCE_NAMES: DD.EVIDENCE_NAMES,
  VERBOSITY_NAMES: DD.VERBOSITY_NAMES,
  options: options,
  toneName: toneName,
  locked: locked,
  blocked: function (d) { return !planEvidence(d); },
  gates: gates,
  audience: audience,
  showEffort: function (d) { return !!options(d).showEffort; },
  sectionList: sectionList,
  pendingFields: pendingFields,
  pendingSection: pendingSection,
  visibleEvidence: visibleEvidence,
  autoText: autoText,
  narrative: narrative,
  confirmed: confirmed,
  sheetHTML: sheetHTML,
  sheetClass: sheetClass,
  sheetMarkup: sheetMarkup,
  sourceInfo: sourceInfo,
  sourcesOverview: sourcesOverview,
  markdown: markdown,
  htmlDocument: htmlDocument,
  exportBaseName: exportBaseName,
  leanPatch: DD.leanPatch,
  dateText: dateText,
  timeText: timeText,
  hours: hours,
  mark: DD.mark,
  esc: esc,
  planLabel: planLabel
};

export { PD };
