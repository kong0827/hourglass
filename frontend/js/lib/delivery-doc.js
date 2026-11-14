/* ==========================================================================
   delivery-doc.js · 一页式交付说明的纯渲染器
   工作台（views/delivery.js）与接收人只读页（share.js）共用同一份投影。
   后端只给事实与口径，这里按「语气 × 详略」把事实投影成文：改生成控制不需要重新请求，
   快照冻结同一份 payload 后，接收人看到的文字与编制人完全一致。
   约定：不读写 DOM、不发请求、不改入参；只依赖 icons.js（因此分享页可直接复用）。
   ========================================================================== */

import { icon } from "../core/icons.js";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nz(v) { return Number(v) || 0; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function txt(v) { return v == null ? "" : String(v).trim(); }
  /* 项目内编号：未取号回退原 ID，不编造编号。渲染器保持自包含，分享页不额外引模块 */
  function noText(prefix, no, fallback) {
    var n = Number(no) || 0;
    if (n <= 0) return txt(fallback);
    var s = String(n);
    while (s.length < 3) s = "0" + s;
    return prefix + "-" + s;
  }
  function itemNo(x) { return noText("WI", x.itemNo, x.id); }
  function relNo(x) { return noText("REL", x.releaseNo, x.id); }

  /* ---- 日期：后端 LocalDate 给 "YYYY-MM-DD"，LocalDateTime 给 "YYYY-MM-DDTHH:mm:ss" ---- */
  function p2(n) { return n < 10 ? "0" + n : String(n); }
  function dateText(s) { return s ? String(s).slice(0, 10) : "—"; }
  function timeText(s) {
    if (!s) return "—";
    var m = String(s).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? (m[1] + " " + m[2]) : dateText(s);
  }
  function mdText(s) { return s ? String(s).slice(5, 10) : "—"; }
  function periodText(d) {
    if (!d.periodStart && !d.periodEnd) return "未记录周期";
    return dateText(d.periodStart) + " → " + dateText(d.periodEnd);
  }
  /* ---- 数字：工时按小时给一位小数，比率沿用后端算好的口径，不在前端重算 ---- */
  function hours(minutes) {
    var h = Math.round(nz(minutes) / 6) / 10;
    return String(h);
  }
  function num(v) {
    if (v == null || v === "") return "—";
    var n = Math.round(Number(v) * 10) / 10;
    return String(n);
  }
  function signed(v) { var n = Number(v) || 0; return (n > 0 ? "+" : "") + num(n); }

  var TONES = { customer: "客户版", manager: "管理版", internal: "内部复盘版" };
  var GRANULARITY = { brief: "按模块汇总", module: "按模块分组", items: "逐条列出" };
  var EVIDENCE_NAMES = ["仅关键依据", "含完整依据", "含制品校验值"];
  var VERBOSITY_NAMES = ["精简", "标准", "详细"];
  var OPERATION_NAMES = { deploy: "部署", redeploy: "重部署", rollback: "回滚" };
  var COVERAGE_NAMES = { full: "全量", partial: "部分", unknown: "覆盖未知" };
  var STATE_NAMES = { fulfilled: "已兑现", partial: "部分兑现", deferred: "已延后", pending: "未兑现" };
  var EVIDENCE_ICONS = { test: "checklist", demands: "demand", swap: "refresh" };

  /* 与后端 DeliveryNoteService.defaultOptions() 一一对应；后端只接受这些键 */
  var DEFAULTS = {
    tone: "customer", releaseId: "", includeUnreleased: true, granularity: "module", showChanges: true,
    showEffort: false, effortDim: "module", evidence: 1, verbosity: 1, density: "cozy", brand: true, watermark: false,
    showDemands: true, showDefects: true, showRelease: true, showAcceptance: true, showSupport: true,
    showCaliber: false, showRevisions: false
  };
  var CONFIRM_FIELDS = ["summary", "change", "issue", "acceptance"];
  /* 叙述字段名与区块键不同名：拿字段名当区块键会让变更说明与缺陷两段永远算不进待确认，闸门形同虚设 */
  var CONFIRM_SECTION = { summary: "summary", change: "changes", issue: "defects", acceptance: "acceptance" };

  function options(d) {
    var o = {}, raw = (d && d.options) || {};
    Object.keys(DEFAULTS).forEach(function (k) {
      o[k] = raw[k] == null ? DEFAULTS[k] : raw[k];
    });
    o.verbosity = Math.max(0, Math.min(2, nz(o.verbosity)));
    o.evidence = Math.max(0, Math.min(2, nz(o.evidence)));
    if (!TONES[o.tone]) o.tone = "customer";
    if (!GRANULARITY[o.granularity]) o.granularity = "module";
    return o;
  }
  function toneName(t) { return TONES[t] || TONES.customer; }
  function locked(d) { return !!(d && d.locked); }
  function blocked(d) { return !d || d.evidenceKind !== "release_snapshot"; }
  function narrative(d, field) {
    var v = d && d.narratives ? d.narratives[field] : null;
    return v == null ? null : String(v);
  }
  function confirmed(d, field) { return arr(d && d.confirmed).indexOf(field) !== -1; }
  function audience(d) { return txt(d && d.audience) || "未指定交付对象"; }
  function showEffort(d) { return !!options(d).showEffort; }

  /* ==================== 区块与门禁 ==================== */

  function sectionList(d) {
    var o = options(d), list = [];
    list.push({ k: "summary", title: "交付摘要" });
    list.push({ k: "scope", title: "交付范围" });
    if (o.showDemands && arr(d.demands).length) list.push({ k: "demands", title: "需求兑现" });
    if (o.showChanges) list.push({ k: "changes", title: "变更说明" });
    list.push({ k: "quality", title: "质量与验证" });
    if (o.showDefects) list.push({ k: "defects", title: "缺陷与已知问题" });
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
  /* 待确认 = 会出现在文档里、且尚未人工确认的对外表述 */
  function pendingFields(d) {
    if (locked(d)) return [];
    return CONFIRM_FIELDS.filter(function (f) {
      return sectionVisible(d, CONFIRM_SECTION[f]) && !confirmed(d, f);
    });
  }
  /* 第一处待确认落在哪个区块：给「逐项查看」用 */
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
    var o = options(d), rel = d.release || {};
    var isBlocked = blocked(d);
    var customerBlocked = isBlocked && o.tone === "customer";
    var pending = pendingFields(d);
    var production = rel.environment === "production" && rel.result === "success" && rel.operation !== "rollback";
    var exportBlock = customerBlocked ? "未确认成功的生产发布，客户版不可导出；请切到管理版或内部版"
      : pending.length ? "还有 " + pending.length + " 处对外表述待确认，逐段核对后再导出" : "";
    var shareBlock = locked(d) ? ""
      : customerBlocked ? "未确认成功的生产发布，客户版不可分享"
      : o.tone === "internal" ? "内部复盘版含内部备注，不提供分享链接"
      : !production ? "只有成功的生产发布记录可作为对外交付依据"
      : pending.length ? "还有 " + pending.length + " 处对外表述待确认，确认后才能冻结快照" : "";
    return {
      blocked: isBlocked, customerBlocked: customerBlocked, pending: pending, production: production,
      canExport: !exportBlock, exportBlock: exportBlock,
      canShare: !shareBlock, shareBlock: shareBlock
    };
  }

  /* ==================== 文字投影（语气 × 详略） ==================== */

  function releasePhrase(d) {
    var rel = d.release || {};
    return timeText(rel.occurredAt) + " 完成" + (rel.environmentName || "生产")
      + (OPERATION_NAMES[rel.operation] || "部署");
  }
  function summaryText(d) {
    var o = options(d), c = d.counts || {}, ds = d.demandSummary || {}, q = d.quality || {}, def = d.defects || {};
    var v = o.verbosity, g = gates(d), L = [];
    if (g.blocked) {
      L.push("截至 " + timeText(d.generatedAt) + "，" + d.projectName + " " + d.versionName
        + " 尚未确认成功的生产发布，本说明为内部草稿；完成数量不代表已交付。");
    } else {
      L.push(d.projectName + " " + d.versionName + " 已于 " + releasePhrase(d)
        + "，发布记录 " + noText("REL", (d.release || {}).releaseNo, d.releaseRecordId)
        + " 为不可变快照，本说明的范围与数字均取自该快照。");
    }
    L.push("本次承诺 " + nz(c.planned) + " 项工作项，"
      + (g.blocked ? "其中 " + nz(c.done) + " 项已完成、" + nz(c.pending) + " 项未完成"
        : "实际发布 " + nz(c.released) + " 项、未纳入 " + nz(c.pending) + " 项")
      + "，改版本延后 " + nz(c.deferred) + " 项。");
    if (v >= 1) {
      if (arr(d.demands).length) {
        L.push("涉及需求 " + nz(ds.total) + " 条，已兑现 " + nz(ds.fulfilled) + " 条"
          + (nz(ds.partial) ? "、部分兑现 " + nz(ds.partial) + " 条" : "")
          + (nz(ds.deferred) ? "、延后 " + nz(ds.deferred) + " 条" : "")
          + "，兑现率 " + (ds.ratePct == null ? "—" : num(ds.ratePct) + "%") + "。");
      }
      L.push(q.missing ? "本次未创建测试计划，系统内没有回归执行结果，不推断质量水平。"
        : "回归执行 " + nz(q.executedCount) + " / " + nz(q.caseCount) + " 条，通过率 "
          + (q.passRatePct == null ? "—" : num(q.passRatePct) + "%") + "（通过 / 已执行去跳过）。");
      if (!def.missing) {
        L.push("缺陷共 " + nz(def.totalCount) + " 项，已修复 " + nz(def.fixedCount) + " 项，遗留 "
          + nz(def.openCount) + " 项" + (nz(def.blockerOpenCount) ? "，其中 " + nz(def.blockerOpenCount) + " 项可能阻塞验收" : "，均不阻塞验收") + "。");
      }
    }
    if (v >= 2) {
      var b = d.baseline || {}, rel = d.release || {};
      if (b.capturedAt) {
        L.push("承诺基线冻结于 " + timeText(b.capturedAt) + "（" + nz(b.taskCount) + " 项）；此后新增 "
          + nz(b.addedCount) + " 项、移出 " + nz(b.removedCount) + " 项，逐条见变更说明。");
      } else {
        L.push("尚未冻结承诺基线，无法给出「最初承诺 vs 现在」的对照。");
      }
      if (!g.blocked) {
        L.push("目标就绪日 " + dateText(d.targetDate) + "，实际发布日 " + dateText(rel.publishedOn)
          + (rel.delayDays == null ? "，未设置目标日，不给延迟" :
            (nz(rel.delayDays) > 0 ? "，晚于目标 " + nz(rel.delayDays) + " 天" : "，未晚于目标日"))
          + "；本版本共 " + nz(rel.attemptCount) + " 次发布记录，成功 " + nz(rel.successCount)
          + " 次、回滚 " + nz(rel.rollbackCount) + " 次。");
      }
      if (o.showEffort && o.tone !== "customer" && !d.effort.missing) {
        L.push("实际投入 " + hours(d.effort.workMinutes) + " 小时，预估 " + hours(d.effort.estimateMinutes)
          + " 小时，偏差 " + signed(hours(d.effort.deviationMinutes)) + " 小时。");
      }
      if (o.tone === "internal") {
        L.push("内部口径：本文档含责任人与内部备注，不对外分享；对外请切客户版并重新冻结快照。");
      }
    }
    return L.join(v === 0 ? "" : "\n");
  }
  function changeText(d) {
    var o = options(d), b = d.baseline || {}, rows = arr(d.changes), v = o.verbosity, L = [];
    if (!rows.length) {
      L.push(b.capturedAt
        ? "本版本自基线（" + timeText(b.capturedAt) + "）以来没有记录到范围或排期变更。"
        : "本版本尚未冻结承诺基线，此前的调期与改版本没有留痕，不反推变更原因。");
      if (v >= 1) L.push("后续对范围、负责人与目标日期的调整会自动进入变更台账，并带操作人与来源。");
      return L.join(v === 0 ? "" : "\n");
    }
    var added = rows.filter(function (r) { return r.kind === "add"; }).length;
    var moved = rows.filter(function (r) { return r.kind === "move" || r.kind === "scope"; }).length;
    var dated = rows.filter(function (r) { return r.kind === "date"; }).length;
    L.push("交付周期内共记录 " + rows.length + " 条变更"
      + (added ? "，新增范围 " + added + " 条" : "")
      + (moved ? "，改版本 / 范围调整 " + moved + " 条" : "")
      + (dated ? "，排期调整 " + dated + " 条" : "") + "，每条均有操作人与来源。");
    if (v >= 1) {
      if (b.capturedAt && !b.late) {
        L.push("与基线（" + nz(b.taskCount) + " 项 · " + hours(b.estimateMinutes) + " 小时预估）相比，新增 "
          + nz(b.addedCount) + " 项 / " + hours(b.addedEstimateMinutes) + " 小时，移出 "
          + nz(b.removedCount) + " 项 / " + hours(b.removedEstimateMinutes) + " 小时。");
      } else if (b.late) {
        L.push("承诺基线建立晚于发布日，此前的变更没有对照，不反推原因。");
      }
      var reasons = rows.filter(function (r) { return txt(r.reason); }).slice(0, v >= 2 ? 6 : 2);
      reasons.forEach(function (r) { L.push("· " + dateText(r.date) + " " + r.title + "：" + r.reason); });
      if (!reasons.length) L.push("变更台账未填写理由字段，此处只陈述事实，不补造原因。");
    }
    if (v >= 2 && o.tone !== "customer") {
      L.push("移出项仍保留在承诺台账中并标注去向，不计入本次已发布数量；口径见附录。");
    }
    return L.join(v === 0 ? "" : "\n");
  }
  function issueText(d) {
    var o = options(d), q = d.quality || {}, def = d.defects || {}, v = o.verbosity, L = [];
    if (q.missing) {
      L.push("本次未创建测试计划，系统内没有执行结果，因此不给出通过率，也不推断质量水平。");
      if (v >= 1) L.push("建议发布后补做一轮回归并关联本版本，执行结果会自动进入本说明。");
    } else {
      L.push("测试计划「" + (q.planName || "未命名") + "」圈选 " + nz(q.caseCount) + " 条用例，已执行 "
        + nz(q.executedCount) + " 条，通过 " + nz(q.passedCount) + " 条、失败 " + nz(q.failedCount)
        + " 条、阻塞 " + nz(q.blockedCount) + " 条、跳过 " + nz(q.skippedCount) + " 条，通过率 "
        + (q.passRatePct == null ? "—（无有效分母）" : num(q.passRatePct) + "%") + "。");
      if (v >= 1 && nz(q.unexecutedCount)) {
        L.push("尚有 " + nz(q.unexecutedCount) + " 条未执行，执行覆盖 "
          + (q.coveragePct == null ? "—" : num(q.coveragePct) + "%") + "，未执行部分不计入通过率分母。");
      }
    }
    if (!def.missing) {
      if (nz(def.openCount)) {
        L.push("遗留 " + nz(def.openCount) + " 项未关闭缺陷"
          + (nz(def.blockerOpenCount) ? "，其中 " + nz(def.blockerOpenCount) + " 项严重度为阻断 / 严重，可能阻塞验收" : "，均为一般或轻微，不阻塞验收")
          + "，逐项见「缺陷与已知问题」。");
      } else {
        L.push("本版本关联的 " + nz(def.totalCount) + " 项缺陷已全部关闭。");
      }
    } else if (v >= 1) {
      L.push("系统内没有与本版本关联的缺陷记录；已知问题清单为空不代表没有质量问题。");
    }
    if (v >= 2 && nz(q.blockedCount)) {
      L.push("阻塞用例按「未通过」处理，不计入通过数；阻塞原因需在缺陷或补充说明中记录，系统不推断。");
    }
    return L.join(v === 0 ? "" : "\n");
  }
  function acceptanceText(d) {
    var o = options(d), a = d.acceptance || {}, c = d.counts || {}, def = d.defects || {}, v = o.verbosity, L = [];
    if (a.conclusionKind === "verified") {
      L.push("按系统记录核对：承诺范围已全部纳入生产发布快照，回归无未通过项，无阻塞验收的遗留缺陷，具备提交验收的条件。");
    } else if (a.conclusionKind === "partial") {
      L.push("按系统记录核对：本次交付为部分达成——"
        + (nz(c.pending) ? "尚有 " + nz(c.pending) + " 项承诺未纳入本次发布；" : "")
        + (nz(def.blockerOpenCount) ? "有 " + nz(def.blockerOpenCount) + " 项严重缺陷未关闭；" : "")
        + (d.quality && (d.quality.missing || d.quality.passRatePct == null) ? "本次没有有效的回归执行结果；" : "")
        + "建议按下方条件逐项核对后再签认。");
    } else {
      L.push("尚未确认成功的生产发布，交付事实无法核对，本文档不构成验收依据。");
    }
    if (v >= 1) {
      L.push("验收依据全部取自可核对的系统记录（见下方清单），不含人工推断；签认仍需人工完成，系统不代替客户签字。");
    }
    if (v >= 2) {
      L.push("若验收条件与实际约定不一致，请在「验收补充」中写明差异与双方确认结论，该说明会随快照一起冻结。");
    }
    return L.join(v === 0 ? "" : "\n");
  }
  function autoText(d, field) {
    if (field === "summary") return summaryText(d);
    if (field === "change") return changeText(d);
    if (field === "issue") return issueText(d);
    if (field === "acceptance") return acceptanceText(d);
    return "";
  }

  /* ==================== 片段 ==================== */

  function chip(cls, text, ic) {
    return '<span class="dl-chip ' + (cls || "") + '">' + (ic ? icon(ic, 11) : "") + esc(text) + "</span>";
  }
  function badge(cls, text) {
    return '<span class="dl-badge ' + (cls || "") + '">' + esc(text) + "</span>";
  }
  function secHead(n, title, hint) {
    return '<div class="dl-sec-head"><span class="dl-sec-idx">' + esc(n) + "</span><h2>" + esc(title) + "</h2>"
      + (hint ? '<span class="dl-sec-hint">' + esc(hint) + "</span>" : "") + "</div>";
  }
  function sec(key, n, title, hint, body, extraClass) {
    return '<section class="dl-sec' + (extraClass ? " " + extraClass : "") + '" id="dl-sec-' + key + '">'
      + secHead(n, title, hint) + body + "</section>";
  }
  function metric(key, value, unit, label, sub, cls) {
    return '<button type="button" class="dl-metric ' + (cls || "") + '" data-dl-act="source" data-dl-src="' + esc(key)
      + '" title="查看数据来源与口径"><span class="src">' + icon("extlink", 11) + "</span>"
      + "<b>" + esc(value) + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</b>"
      + "<span>" + esc(label) + "</span>" + (sub ? "<em>" + esc(sub) + "</em>" : "") + "</button>";
  }
  function missing(text) {
    return '<div class="dl-missing">' + icon("infoCircle", 15) + "<div>" + text + "</div></div>";
  }
  function gap() { return '<div class="dl-gap"></div>'; }
  function bar(segs, total, height) {
    var sum = Math.max(1, nz(total));
    return '<div class="dl-bar"' + (height ? ' style="height:' + height + 'px"' : "") + ">"
      + segs.map(function (s) {
        return '<i style="width:' + (nz(s.v) / sum * 100) + "%;background:" + s.c + '" title="' + esc(s.n) + '"></i>';
      }).join("") + "</div>";
  }
  function legend(segs) {
    return '<div class="dl-legend">' + segs.map(function (s) {
      return "<span><i style=\"background:" + s.c + "\"></i>" + esc(s.n) + "</span>";
    }).join("") + "</div>";
  }
  function kv(label, value, cls) {
    return '<div class="dl-kvbox' + (cls ? " " + cls : "") + '"><span>' + esc(label) + "</span><strong>"
      + esc(value == null || value === "" ? "未记录" : value) + "</strong></div>";
  }
  function kvMono(label, value) {
    return '<div class="dl-kvbox wide"><span>' + esc(label) + '</span><strong class="mono">'
      + esc(value == null || value === "" ? "未记录" : value) + "</strong></div>";
  }

  /* ---- 叙述块：系统草拟 → 人工确认 / 改写 → 可恢复 ---- */
  function narr(d, field, view) {
    var isLocked = locked(d) || view.readonly;
    var pending = !isLocked && CONFIRM_FIELDS.indexOf(field) !== -1 && !confirmed(d, field);
    var edited = narrative(d, field);
    var val = edited != null ? edited : autoText(d, field);
    var editable = !isLocked && (view.editMode || view.editingField === field);
    return '<div class="dl-narr-wrap' + (pending ? " pending" : "") + '" data-dl-wrap="' + field + '">'
      + '<div class="dl-narr" data-dl-field="' + field + '"'
      + (editable ? ' contenteditable="true" spellcheck="false" role="textbox" aria-label="编辑这段说明"' : "") + ">"
      + esc(val) + "</div>"
      + (view.readonly ? "" : '<div class="dl-narr-bar">' + narrBar(d, field, pending, edited != null) + "</div>")
      + "</div>";
  }
  function narrBar(d, field, pending, edited) {
    if (locked(d)) return chip("plum", "快照已锁定", "lock");
    if (pending) {
      return chip("warn", "系统草拟 · 待确认") + '<span class="nb-t">核对这段对外表述</span>'
        + '<button class="btn sm soft" type="button" data-dl-act="accept" data-dl-key="' + field + '">确认这段</button>'
        + '<button class="btn sm ghost" type="button" data-dl-act="edit-one" data-dl-field="' + field + '">改写</button>';
    }
    return chip("ok", edited ? "已人工改写并确认" : "已确认", "check")
      + (edited ? '<button class="btn sm ghost" type="button" data-dl-act="restore" data-dl-field="' + field + '">恢复系统草稿</button>' : "")
      + '<button class="btn sm ghost" type="button" data-dl-act="edit-one" data-dl-field="' + field + '">改写</button>';
  }

  /* ==================== 各区块 ==================== */

  function secSummary(d, n, view) {
    var c = d.counts || {}, q = d.quality || {}, def = d.defects || {}, ds = d.demandSummary || {}, o = options(d);
    var g = gates(d), tiles = [];
    tiles.push(metric("released", nz(c.released) + "/" + nz(c.planned), "",
      g.blocked ? "范围已完成（未发布）" : "已生产发布",
      g.blocked ? "已完成 " + nz(c.done) + " 项 · 未完成 " + nz(c.pending) + " 项" : "未纳入本次 " + nz(c.pending) + " 项",
      g.blocked ? "warn" : "ok"));
    tiles.push(q.passRatePct == null
      ? metric("passRate", "—", "", "回归通过率", q.missing ? "未创建测试计划" : "无有效分母", "warn")
      : metric("passRate", num(q.passRatePct), "%", "回归通过率",
        "通过 " + nz(q.passedCount) + " / 有效执行 " + (nz(q.executedCount) - nz(q.skippedCount)),
        nz(q.passRatePct) >= 90 ? "ok" : "warn"));
    if (o.showDemands && arr(d.demands).length) {
      tiles.push(metric("demands", ds.ratePct == null ? "—" : num(ds.ratePct), ds.ratePct == null ? "" : "%",
        "需求兑现率", "已兑现 " + nz(ds.fulfilled) + " / " + nz(ds.total) + " 条",
        nz(ds.ratePct) >= 90 ? "ok" : "warn"));
    } else {
      tiles.push(metric("deferred", nz(c.deferred) + nz(c.pending), "项", "后续计划",
        "延后 " + nz(c.deferred) + " · 未纳入 " + nz(c.pending), "warn"));
    }
    if (o.showEffort && !d.effort.missing) {
      tiles.push(metric("effort", hours(d.effort.workMinutes), "h", "累计投入",
        "预估 " + hours(d.effort.estimateMinutes) + "h · 偏差 " + signed(hours(d.effort.deviationMinutes)) + "h", "pri"));
    } else {
      tiles.push(metric("defects", def.missing ? "—" : nz(def.openCount), def.missing ? "" : "项", "未关闭缺陷",
        def.missing ? "未采集缺陷" : nz(def.blockerOpenCount) ? nz(def.blockerOpenCount) + " 项可能阻塞验收" : "均不阻塞验收",
        nz(def.blockerOpenCount) ? "bad" : "warn"));
    }
    return sec("summary", n, "交付摘要", "自动生成 · 数字只读，文字可改",
      '<div class="dl-mgrid">' + tiles.join("") + "</div>" + narr(d, "summary", view));
  }

  function scopeRows(d) {
    var o = options(d);
    return arr(d.scope).filter(function (x) { return o.includeUnreleased || x.state === "released"; });
  }
  function stateBadge(state, isBlocked) {
    if (state === "released") return badge("ok", "已发布");
    if (state === "deferred") return badge("warn", "延后");
    if (state === "done") return badge(isBlocked ? "" : "ok", "已完成");
    return badge("", isBlocked ? "未完成" : "未纳入本次");
  }
  function scopeRowHTML(x, isBlocked) {
    var sub = [x.ref, x.owner, x.targetVersionName ? "去向 " + x.targetVersionName : ""].filter(Boolean).join(" · ");
    return '<div class="dl-row body"><span class="dl-mod">' + esc(x.module || "未分模块") + "</span>"
      + '<span class="tt"><b>' + esc(x.title) + "</b><span>" + esc(sub) + "</span></span>"
      + '<span class="ty">' + esc(x.itemTypeName || "任务") + "</span>"
      + "<span>" + stateBadge(x.state, isBlocked) + "</span></div>";
  }
  function secScope(d, n, view) {
    var o = options(d), c = d.counts || {}, b = d.baseline || {}, rows = scopeRows(d), g = gates(d);
    var segs = [
      { v: nz(c.released), c: "var(--success)", n: "已发布 " + nz(c.released) },
      { v: g.blocked ? nz(c.done) : 0, c: "var(--dl-teal)", n: "已完成待发布 " + nz(c.done) },
      { v: nz(c.pending), c: "var(--dl-slate)", n: "未完成 " + nz(c.pending) },
      { v: nz(c.deferred), c: "var(--warning)", n: "延后 " + nz(c.deferred) }
    ].filter(function (s) { return s.v > 0 || s.n.indexOf("已发布") === 0; });
    var scale = Math.max(nz(c.planned), nz(b.taskCount), 1);
    var head = "";
    if (b.capturedAt) {
      head = '<div class="dl-baseline"><span class="dl-bl-lab">基线承诺</span><div class="dl-bl-bar">'
        + bar([{ v: nz(b.taskCount), c: "var(--primary-border)", n: "基线 " + nz(b.taskCount) + " 项" }], scale)
        + "<b>" + nz(b.taskCount) + " 项 · " + esc(timeText(b.capturedAt)) + "</b></div></div>"
        + '<div class="dl-baseline"><span class="dl-bl-lab">当前台账</span><div class="dl-bl-bar">'
        + bar(segs, scale) + "<b>" + nz(c.planned) + " 项</b></div></div>"
        + legend(segs.concat([{ v: 0, c: "var(--primary-border)", n: "基线（" + timeText(b.capturedAt) + " 冻结）" }]))
        + (nz(b.addedCount) || nz(b.removedCount)
          ? '<div class="dl-effort-foot"><span>基线后新增 <b>' + nz(b.addedCount) + "</b> 项</span><span>移出 <b>"
            + nz(b.removedCount) + "</b> 项</span><span>当前绑定 <b>" + nz(c.currentBound) + "</b> 项</span></div>"
          : "")
        + (b.late ? gap() + missing("承诺基线建立<b>晚于发布日</b>，此前的变更没有对照，不反推原因。") : "");
    } else {
      head = missing("尚未冻结承诺基线，无法给出「最初承诺 vs 现在」的对照；下表为当前承诺台账。")
        + gap() + bar(segs, scale) + legend(segs);
    }
    var body;
    if (!rows.length) {
      body = missing(o.includeUnreleased ? "承诺台账为空：本版本没有绑定工作项。" : "本次发布快照内没有「已发布」项；打开「含未发布项」可看承诺台账全貌。");
    } else if (o.granularity === "brief") {
      var mods = {};
      rows.forEach(function (x) {
        var m = x.module || "未分模块";
        mods[m] = mods[m] || { t: 0, r: 0, o: 0, sample: [] };
        mods[m].t++;
        if (x.state === "released") mods[m].r++; else mods[m].o++;
        if (mods[m].sample.length < 2) mods[m].sample.push(x.title);
      });
      body = '<div class="dl-rows"><div class="dl-row head"><span>模块</span><span>交付内容</span><span>已发布</span><span>状态</span></div>'
        + Object.keys(mods).map(function (m) {
          var s = mods[m];
          return '<div class="dl-row body"><span class="dl-mod">' + esc(m) + "</span>"
            + '<span class="tt"><b>' + s.t + " 项工作项</b><span>" + esc(s.sample.join(" / ")) + "…</span></span>"
            + '<span class="ty">' + s.r + " / " + s.t + "</span><span>"
            + (s.o ? badge("warn", "含 " + s.o + " 项未发布") : badge("ok", "全部发布")) + "</span></div>";
        }).join("") + "</div>";
    } else if (o.granularity === "module") {
      var groups = {};
      rows.forEach(function (x) {
        var m = x.module || "未分模块";
        (groups[m] = groups[m] || []).push(x);
      });
      body = Object.keys(groups).map(function (m) {
        return '<div class="dl-modgroup"><div class="dl-modgroup-head"><span class="dl-mod">' + esc(m)
          + '</span><span class="cnt">' + groups[m].length + " 项</span></div>"
          + '<div class="dl-rows">' + groups[m].map(function (x) { return scopeRowHTML(x, g.blocked); }).join("") + "</div></div>";
      }).join("");
    } else {
      body = '<div class="dl-rows"><div class="dl-row head"><span>模块</span><span>工作项</span><span>类型</span><span>状态</span></div>'
        + rows.map(function (x) { return scopeRowHTML(x, g.blocked); }).join("") + "</div>";
    }
    var more = (o.granularity !== "items" && rows.length && !view.readonly)
      ? '<div class="dl-more-row"><button class="btn sm ghost" type="button" data-dl-act="gran" data-dl-gran="items">展开逐条 '
        + rows.length + " 项" + icon("chevronRight", 12) + "</button></div>" : "";
    return sec("scope", n, "交付范围",
      nz(c.planned) + " 项承诺 · " + (o.includeUnreleased ? "含未发布项" : "仅列已发布"),
      head + gap() + body + more);
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
      + metric("demands", ds.ratePct == null ? "—" : num(ds.ratePct), ds.ratePct == null ? "" : "%", "需求兑现率",
        "关联工作项全部发布的需求 / 涉及需求", nz(ds.ratePct) >= 90 ? "ok" : "warn")
      + metric("demands", nz(ds.fulfilled) + "/" + nz(ds.total), "", "已兑现需求", "部分兑现 " + nz(ds.partial) + " 条", "ok")
      + metric("demands", nz(ds.deferred) + nz(ds.pending), "条", "未兑现需求", "延后 " + nz(ds.deferred) + " · 未兑现 " + nz(ds.pending), "warn")
      + "</div>" + bar(segs, nz(ds.total)) + legend(segs) + gap()
      + '<div class="dl-rows"><div class="dl-row head"><span>模块</span><span>需求</span><span>工作项</span><span>兑现</span></div>'
      + rows.map(function (x) {
        var sub = [x.id, x.priority, x.targetVersionName ? "去向 " + x.targetVersionName : "", x.deliveredAt ? "交付 " + dateText(x.deliveredAt) : ""]
          .filter(Boolean).join(" · ");
        var cls = x.state === "fulfilled" ? "ok" : x.state === "deferred" ? "warn" : x.state === "partial" ? "pri" : "";
        return '<div class="dl-row body"><span class="dl-mod">' + esc(x.module || "未分模块") + "</span>"
          + '<span class="tt"><b>' + esc(x.title) + "</b><span>" + esc(sub) + "</span></span>"
          + '<span class="ty">' + nz(x.releasedCount) + " / " + nz(x.taskCount) + "</span>"
          + "<span>" + badge(cls, STATE_NAMES[x.state] || "未兑现") + "</span></div>";
      }).join("") + "</div>";
    return sec("demands", n, "需求兑现", nz(ds.total) + " 条需求 · 兑现率按工作项是否全部发布计算", body);
  }

  function secChanges(d, n, view) {
    var b = d.baseline || {}, rows = arr(d.changes);
    if (!rows.length) {
      return sec("changes", n, "变更说明", "无变更记录",
        missing(b.capturedAt
          ? "范围基线于 <b>" + esc(timeText(b.capturedAt)) + "</b> 建立，此后没有记录到范围或排期变更。"
          : "尚未冻结承诺基线，此前的调期与改版本<b>没有留痕</b>，不反推变更原因。后续变更会自动进入台账。")
        + gap() + narr(d, "change", view));
    }
    var ledger = '<div class="dl-ledger">' + rows.map(function (x) {
      var first = x.kind === "add" ? "ok" : x.kind === "date" ? "warn" : "pri";
      return '<div class="dl-led"><span class="dl-led-d">' + esc(mdText(x.date)) + "</span><div>"
        + '<div class="dl-led-t">' + esc(x.title) + "</div>"
        + '<div class="dl-led-m">' + arr(x.tags).map(function (t, i) { return chip(i === 0 ? first : "", t); }).join("") + "</div>"
        + '<div class="dl-led-w">' + esc([x.actorName, x.source ? "来源：" + x.source : "", x.reason].filter(Boolean).join(" · "))
        + "</div></div></div>";
    }).join("") + "</div>";
    return sec("changes", n, "变更说明",
      (b.capturedAt ? "基线 " + timeText(b.capturedAt) + " · " : "") + rows.length + " 条变更 · 均有操作人",
      ledger + gap() + narr(d, "change", view));
  }

  function secQuality(d, n, view) {
    var q = d.quality || {};
    if (q.missing) {
      return sec("quality", n, "质量与验证", "未执行回归",
        missing("该版本<b>未创建测试计划或未圈选用例</b>，系统内没有执行结果。此处不显示通过率，也不推断质量水平。")
        + gap() + narr(d, "issue", view)
        + (view.readonly ? "" : gap() + '<button class="btn sm" type="button" data-dl-act="goto" data-dl-view="testcases">'
          + icon("checklist", 13) + "去补一次回归</button>"));
    }
    var segs = [
      { v: nz(q.passedCount), c: "var(--success)", n: "通过 " + nz(q.passedCount) },
      { v: nz(q.failedCount), c: "var(--danger)", n: "失败 " + nz(q.failedCount) },
      { v: nz(q.blockedCount), c: "var(--warning)", n: "阻塞 " + nz(q.blockedCount) },
      { v: nz(q.skippedCount), c: "var(--info)", n: "跳过 " + nz(q.skippedCount) },
      { v: nz(q.unexecutedCount), c: "var(--dl-slate)", n: "未执行 " + nz(q.unexecutedCount) }
    ];
    var valid = nz(q.executedCount) - nz(q.skippedCount);
    var body = '<div class="dl-qgrid"><div class="dl-qbox"><h4>回归执行分布</h4>'
      + bar(segs, nz(q.caseCount), 14) + legend(segs)
      + '<div class="dl-qnums"><div><b>' + (q.passRatePct == null ? "—" : num(q.passRatePct) + "%")
      + "</b>通过率（通过 / 有效执行）</div><div><b>" + nz(q.executedCount) + "/" + nz(q.caseCount)
      + "</b>执行覆盖</div><div><b>" + valid + "</b>有效分母（去跳过）</div></div></div>"
      + '<div class="dl-qbox"><h4>验证口径</h4><div class="dl-defs">'
      + '<div class="dl-def"><span class="grow">通过</span><b>' + nz(q.passedCount) + "</b></div>"
      + '<div class="dl-def"><span class="grow">失败 / 阻塞（均不计入通过）</span><b>' + (nz(q.failedCount) + nz(q.blockedCount)) + "</b></div>"
      + '<div class="dl-def"><span class="grow">跳过（本次不适用，出分母）</span><b>' + nz(q.skippedCount) + "</b></div>"
      + '<div class="dl-def total"><span class="grow">圈选 / 已执行</span><b>' + nz(q.caseCount) + " / " + nz(q.executedCount) + "</b></div>"
      + "</div></div></div>" + gap() + narr(d, "issue", view);
    return sec("quality", n, "质量与验证",
      (q.planName || "测试计划") + " · " + nz(q.caseCount) + " 条用例" + (nz(q.planCount) > 1 ? " · " + nz(q.planCount) + " 个计划" : ""), body);
  }

  function secDefects(d, n) {
    var def = d.defects || {}, o = options(d);
    if (def.missing) {
      return sec("defects", n, "缺陷与已知问题", "无关联缺陷记录",
        missing("系统内没有与本版本关联的缺陷记录。<b>已知问题清单为空不代表没有质量问题</b>，未执行回归时尤其如此。"));
    }
    var tiles = '<div class="dl-mgrid">'
      + metric("defects", nz(def.totalCount), "项", "关联缺陷", "发现或计划版本指向本版本", "pri")
      + metric("fixedDefects", nz(def.fixedCount), "项", "已修复关闭", "当前处于已完成列", "ok")
      + metric("defects", nz(def.openCount), "项", "遗留未关闭", "逐项列在下方", nz(def.openCount) ? "warn" : "ok")
      + metric("blockerDefects", nz(def.blockerOpenCount), "项", "可能阻塞验收", "未关闭且阻断 / 严重", nz(def.blockerOpenCount) ? "bad" : "ok")
      + "</div>";
    var sev = '<div class="dl-qbox"><h4>严重度分布</h4><div class="dl-defs">'
      + arr(def.bySeverity).map(function (x) {
        return '<div class="dl-def"><span class="p ' + esc(x.severity) + '">' + esc(x.severityName) + "</span>"
          + '<span class="grow">' + (nz(x.open) ? "未关闭 " + nz(x.open) + " 项" : "全部已关闭") + "</span><b>" + nz(x.total) + " 项</b></div>";
      }).join("")
      + '<div class="dl-def total"><span class="grow">合计</span><b>' + nz(def.totalCount) + " 项 · 未关闭 " + nz(def.openCount) + "</b></div>"
      + "</div></div>";
    var openRows = arr(def.open);
    var openBox = '<div class="dl-qbox"><h4>遗留清单（' + openRows.length + " 项）</h4>"
      + (openRows.length
        ? '<div class="dl-defs">' + openRows.map(function (x) {
          return '<div class="dl-def"><span class="p ' + esc(x.severity) + '">' + esc(x.severityName) + "</span>"
            + '<span class="grow">' + esc(x.title) + '<i class="dl-def-id">' + esc(itemNo(x)) + "</i></span>"
            + (x.blocksAcceptance ? badge("bad", "阻塞验收") : badge("", x.regressionName || x.columnName || "未关闭")) + "</div>";
        }).join("") + "</div>"
        : '<div class="dl-def"><span class="grow">本版本关联缺陷已全部关闭</span>' + badge("ok", "无遗留") + "</div>")
      + "</div>";
    var fixed = arr(def.fixed), shown = fixed.slice(0, 6);
    var fixedBlock = fixed.length
      ? gap() + '<div class="dl-rows"><div class="dl-row head"><span>严重度</span><span>已修复缺陷</span><span>完成日</span><span>状态</span></div>'
        + shown.map(function (x) {
          var sub = [itemNo(x), o.tone === "customer" ? "" : x.owner, x.environment].filter(Boolean).join(" · ");
          return '<div class="dl-row body"><span class="dl-mod">' + esc(x.severityName) + "</span>"
            + '<span class="tt"><b>' + esc(x.title) + "</b><span>" + esc(sub) + "</span></span>"
            + '<span class="ty">' + esc(dateText(x.completedAt)) + "</span><span>" + badge("ok", "已修复") + "</span></div>";
        }).join("") + "</div>"
        + (fixed.length > shown.length
          ? '<div class="dl-more-row plain"><span class="dl-sec-hint" style="margin:0">另有 ' + (fixed.length - shown.length)
            + " 项已修复缺陷，完整清单见缺陷库（按本版本筛选）</span></div>" : "")
      : "";
    return sec("defects", n, "缺陷与已知问题",
      "已修复 " + nz(def.fixedCount) + " · 遗留 " + nz(def.openCount) + (nz(def.blockerOpenCount) ? " · " + nz(def.blockerOpenCount) + " 项阻塞验收" : ""),
      tiles + '<div class="dl-qgrid">' + sev + openBox + "</div>" + fixedBlock);
  }

  function secEffort(d, n) {
    var e = d.effort || {}, o = options(d), title = o.tone === "customer" ? "投入概况" : "投入与负载";
    if (e.missing) {
      return sec("effort", n, title, "未记录工时",
        missing("该版本范围内<b>没有计时与补记记录</b>，投入无法给出。不用完成数量或预估工时反推实际投入。"));
    }
    var list = arr(o.effortDim === "member" ? e.byMember : e.byModule);
    var max = list.reduce(function (m, x) { return Math.max(m, nz(x.minutes)); }, 1);
    var colors = ["var(--primary)", "var(--dl-teal)", "var(--plum)", "var(--warning)", "var(--dl-magenta)", "var(--info)"];
    var body = '<div class="dl-mgrid c3">'
      + metric("effort", hours(e.workMinutes), "h", "实际投入", "计时 + 补记", "pri")
      + metric("estimate", hours(e.estimateMinutes), "h", "预估工时", "版本范围内工作项", "")
      + metric("deviation", signed(hours(e.deviationMinutes)), "h", "偏差",
        e.deviationPct == null ? "预估为 0，不给偏差率" : "偏差率 " + signed(e.deviationPct) + "%",
        nz(e.deviationMinutes) > 0 ? "warn" : "ok")
      + "</div>"
      + (list.length
        ? '<div class="dl-hbars">' + list.map(function (x, i) {
          return '<div class="dl-hb"><span class="hn">' + esc(x.name) + "</span>"
            + '<span class="ht"><i style="width:' + (nz(x.minutes) / max * 100) + "%;background:" + colors[i % colors.length] + '"></i></span>'
            + '<span class="hv">' + hours(x.minutes) + "h · " + nz(x.pct) + "%</span></div>";
        }).join("") + "</div>"
        : missing("有工时合计但没有可分组的明细，按" + (o.effortDim === "member" ? "成员" : "模块") + "拆分不可用。"))
      + '<div class="dl-effort-foot"><span>口径：版本范围内工作项的<b>计时 + 补记</b>，不用于计费结算</span>'
      + "<span>参与 <b>" + nz(e.memberCount) + "</b> 人</span>"
      + (o.tone === "customer" ? "<span>不含成员明细</span>" : "<span>点击数字可看来源</span>") + "</div>";
    return sec("effort", n, title, "有效工时，不用于计费结算", body);
  }

  function secRelease(d, n, view) {
    var rel = d.release, o = options(d), g = gates(d);
    var plan = planBlock(d, o);
    if (!rel) {
      return sec("release", n, "发布与运行信息", "尚未确认发布",
        missing("尚无成功的生产发布记录，运行信息不可给出。测试环境发布、失败与回滚都不构成对外交付依据。")
        + (plan ? gap() + plan : ""));
    }
    var boxes = [
      kv("环境与操作", (rel.environmentName || rel.environment) + " · " + (rel.operationName || OPERATION_NAMES[rel.operation] || "部署")),
      kv("发布结果", (rel.result === "success" ? "成功" : rel.result === "failed" ? "失败" : "未记录") + " · " + (COVERAGE_NAMES[rel.coverage] || rel.coverage || "覆盖未知")),
      kv("实际发生时间", timeText(rel.occurredAt)),
      kv("记录时间", timeText(rel.recordedAt)),
      kv("目标就绪日", dateText(d.targetDate)),
      kv("发布延迟", rel.delayDays == null ? "未设置目标日，不给延迟" : nz(rel.delayDays) > 0 ? "晚 " + nz(rel.delayDays) + " 天" : "未晚于目标日"),
      kv("本次快照项数", "已发布 " + nz(rel.publishedCount) + " 项 · 未纳入 " + nz(rel.excludedCount) + " 项"),
      kv("发布尝试", "共 " + nz(rel.attemptCount) + " 次 · 成功 " + nz(rel.successCount) + " · 回滚 " + nz(rel.rollbackCount)),
      kv(o.tone === "customer" ? "发布方" : "实际执行人", o.tone === "customer" ? rel.releasedByName : rel.executorName)
    ];
    /* 制品坐标、部署目标与校验值都是内部运行信息：客户版整行不出现，而不是显示「未记录」 */
    if (o.tone !== "customer") {
      boxes.push(kv("部署目标", arr(rel.targets).join("、")));
      boxes.push(kvMono("制品标识", rel.artifactRef));
      if (o.evidence >= 2) boxes.push(kvMono("制品 SHA256", rel.artifactDigest));
    }
    if (txt(rel.relatedReleaseId)) boxes.push(kv("关联正式事件", noText("REL", rel.relatedReleaseNo, rel.relatedReleaseId)));
    if (txt(rel.deviationReason)) boxes.push(kv("偏差 / 紧急事实理由", rel.deviationReason, "wide"));
    if (txt(rel.failureReason)) boxes.push(kv("失败原因", rel.failureReason, "wide"));
    if (txt(rel.notes)) boxes.push(kv("发布说明", rel.notes, "wide"));
    return sec("release", n, "发布与运行信息",
      "记录 " + relNo(rel) + (g.production ? " · 可作为对外交付依据" : " · 不构成对外交付依据"),
      '<div class="dl-kvs">' + boxes.join("") + "</div>"
      + (g.production ? "" : gap() + missing("该记录不是成功的生产部署，<b>不构成对外交付依据</b>；对外说明请选择成功的生产发布记录。"))
      + (plan ? gap() + plan : ""));
  }

  /* 发布窗口与回滚约定：原文引用发布计划里团队写下的内容，系统不改写、不代拟 */
  function planBlock(d, o) {
    var p = d.plan;
    if (!p) return "";
    var boxes = [
      kv("计划窗口", p.plannedAt ? timeText(p.plannedAt) : "未定"),
      kv("计划状态", p.statusName || p.status || "未记录"),
      kv("环境与覆盖", (p.environmentName || p.environment || "未记录") + " · " + (COVERAGE_NAMES[p.coverage] || "覆盖未知")),
      kv("计划范围", nz(p.taskCount) + " 项工作项" + (nz(p.versionCount) > 1 ? " · 跨 " + nz(p.versionCount) + " 个版本" : ""))
    ];
    /* 部署目标是 prod-shanghai-a 这类机房主机键，和发布记录里的制品坐标同属内部运行信息：客户版两处都不给 */
    if (o.tone !== "customer" && arr(p.targets).length) boxes.push(kv("部署目标", arr(p.targets).join("、")));
    if (o.tone !== "customer" && txt(p.ownerName)) boxes.push(kv("计划负责人", p.ownerName));
    if (nz(p.versionCount) > 1) boxes.push(kv("同批版本", arr(p.versionNames).join("；"), "wide"));
    if (txt(p.notes)) boxes.push(kv("发布安排（计划原文）", p.notes, "wide"));
    if (txt(p.risks)) boxes.push(kv("风险与回滚约定（计划原文）", p.risks, "wide"));
    return '<div class="dl-plan"><div class="dl-plan-head">' + icon("calendar", 13)
      + "<b>发布计划与窗口</b><span>计划 " + esc(p.id) + " · 原文引用，不改写</span></div>"
      + '<div class="dl-kvs">' + boxes.join("") + "</div>"
      + (txt(p.risks) ? "" : '<div class="dl-plan-note">该计划未填写风险与回滚约定，此处不代拟；如需对外承诺回滚口径，请在发布计划中补齐。</div>')
      + "</div>";
  }

  function secRisks(d, n, view) {
    var o = options(d), rows = arr(d.risks), showOwner = o.tone !== "customer";
    var cols = showOwner ? "minmax(0,1.4fr) 1fr 78px 1fr 92px" : "minmax(0,1.4fr) 1fr 1fr 92px";
    if (!rows.length) {
      return sec("risks", n, "后续计划与风险", "无遗留事项",
        missing("承诺范围已全部交付，且没有未关闭缺陷与未验证项，系统内没有需要跟踪的后续事项。"));
    }
    /* 一页纸只铺前 6 项（后端已按严重度排序）；其余指回对应区块，不在这里重复整张范围表 */
    var expanded = !view.readonly && view.risksExpanded;
    var shown = expanded ? rows : rows.slice(0, 6);
    var rest = rows.length - shown.length;
    var body = '<div class="dl-rows"><div class="dl-row head" style="grid-template-columns:' + cols + '">'
      + "<span>事项</span><span>影响</span>" + (showOwner ? "<span>责任人</span>" : "") + "<span>下一步</span><span>状态</span></div>"
      + shown.map(function (x) {
        return '<div class="dl-row body" style="grid-template-columns:' + cols + '">'
          + '<span class="tt"><b>' + esc(x.title) + "</b>"
          + (txt(x.refId) ? "<span>" + esc(x.refId) + "</span>" : "") + "</span>"
          + '<span class="cell">' + esc(x.impact) + "</span>"
          + (showOwner ? '<span class="cell">' + esc(x.owner || "待指派") + "</span>" : "")
          + '<span class="cell">' + esc(x.next) + "</span>"
          + "<span>" + badge(x.tone, x.status) + "</span></div>";
      }).join("") + "</div>"
      + (rest > 0
        ? '<div class="dl-more-row' + (view.readonly ? " plain" : "") + '">'
          + (view.readonly
            ? '<span class="dl-sec-hint" style="margin:0">另有 ' + rest + " 项后续事项，逐项清单见「交付范围」与「缺陷与已知问题」</span>"
            : '<button class="btn sm ghost" type="button" data-dl-act="risks">展开其余 ' + rest + " 项" + icon("chevronRight", 12) + "</button>")
          + "</div>"
        : expanded && rows.length > 6
          ? '<div class="dl-more-row"><button class="btn sm ghost" type="button" data-dl-act="risks">收起，只看前 6 项</button></div>'
          : "");
    return sec("risks", n, "后续计划与风险",
      rows.length + " 项 · " + (showOwner ? "按严重度排序，含责任人与下一步" : "按严重度排序，供了解后续安排"), body);
  }

  function secAcceptance(d, n, view) {
    var a = d.acceptance || {}, kind = a.conclusionKind || "unverified";
    var cls = kind === "verified" ? "ok" : kind === "partial" ? "warn" : "bad";
    var name = kind === "verified" ? "具备验收条件" : kind === "partial" ? "部分达成，需逐项核对" : "尚不可验收";
    var ic = kind === "verified" ? "checkCircle" : kind === "partial" ? "alert" : "alertCircle";
    var basis = arr(a.basis), conds = arr(a.conditions);
    var body = '<div class="dl-conclusion ' + cls + '"><span class="cc">' + icon(ic, 16) + "</span><div>"
      + "<b>" + esc(name) + "</b><p>" + esc(kind === "verified"
        ? "结论由系统记录派生，签认仍需人工完成。"
        : "结论由系统记录派生：存在未纳入范围的承诺、未关闭的严重缺陷或缺少回归结果。") + "</p></div></div>"
      + narr(d, "acceptance", view) + gap()
      + '<div class="dl-qgrid"><div class="dl-qbox"><h4>验收依据（可核对的系统记录）</h4>'
      + (basis.length
        ? '<ul class="dl-condlist">' + basis.map(function (t) {
          return '<li class="ok"><span class="ci">' + icon("check", 11) + "</span><span>" + esc(t) + "</span></li>";
        }).join("") + "</ul>"
        : missing("没有可核对的系统记录作为验收依据。"))
      + "</div>"
      + '<div class="dl-qbox"><h4>验收条件（取自需求验收标准）</h4>'
      + (conds.length
        ? '<ul class="dl-condlist">' + conds.map(function (t, i) {
          var cut = String(t).indexOf("：");
          var lead = cut > 0 ? String(t).slice(0, cut) : "";
          var rest = cut > 0 ? String(t).slice(cut + 1) : String(t);
          return '<li><span class="ci">' + p2(i + 1) + '</span><span class="ct">'
            + (lead ? "<b>" + esc(lead) + "</b>" : "") + esc(rest) + "</span></li>";
        }).join("") + "</ul>"
        : missing("关联需求未填写验收标准，此处不代拟条件。"))
      + "</div></div>"
      + gap() + '<div class="dl-kvs">'
      + kv("阻塞验收的缺陷", nz(a.blockerCount) ? nz(a.blockerCount) + " 项（阻断 / 严重且未关闭）" : "无")
      + kv("人工签认", a.signOffPending ? "待双方签认，系统不代替签字" : "已签认")
      + (txt(a.note) ? kv("验收补充（人工填写）", a.note, "wide") : "")
      + "</div>"
      + signOff(d);
    return sec("acceptance", n, "验收与结论", "依据只读 · 结论由记录派生", body);
  }

  /* 签认栏：纸面上留白供双方手签，系统只印角色与已知的编制人，不生成签名、不预填日期 */
  function signOff(d) {
    var rows = [
      { role: "交付方", who: txt(d.ownerName) ? "编制：" + d.ownerName : "编制：未记录" },
      { role: "接收方", who: audience(d) }
    ];
    return '<div class="dl-signoff"><div class="dl-signoff-head">' + icon("edit", 13)
      + "<b>验收签认</b><span>下方留白供双方手签；系统不代替签字，签认前本页结论仅为记录派生结果</span></div>"
      + '<div class="dl-signoff-grid">' + rows.map(function (x) {
        return '<div class="dl-sign"><span class="sr">' + esc(x.role) + "</span>"
          + '<span class="sw">' + esc(x.who) + "</span>"
          + '<span class="sl"><i>签字</i></span><span class="sl"><i>日期</i></span></div>';
      }).join("") + "</div></div>";
  }

  function secSupport(d, n) {
    var contact = txt(d.supportContact);
    var body = '<div class="dl-kvs">'
      + kv("交付对象", audience(d))
      + kv("编制", d.ownerName || "未记录")
      + kv("支持联系人", contact, "wide")
      + "</div>"
      + (contact ? "" : gap() + missing("未填写支持联系人。接收人拿到本说明后需要一个可联系的人，建议在右侧控制区补齐。"));
    return sec("support", n, "支持与联系", "人工填写 · 随快照冻结", body);
  }

  function secInternal(d, n, view) {
    var val = narrative(d, "internal");
    var editable = !locked(d) && !view.readonly && (view.editMode || view.editingField === "internal");
    var body = '<div class="dl-narr-wrap"><div class="dl-narr" data-dl-field="internal"'
      + (editable ? ' contenteditable="true" spellcheck="false" role="textbox" aria-label="编辑内部备注"' : "") + ">"
      + esc(val == null ? "" : val) + "</div>"
      + (val == null && !editable && !view.readonly ? '<div class="dl-narr-bar"><span class="nb-t">尚未填写内部备注，点「编辑文字」后可写。</span></div>' : "")
      + "</div>"
      + (view.readonly ? "" : '<div class="dl-narr-bar">' + chip("bad", "切到客户版 / 管理版即隐藏，分享接口不下发", "lock") + "</div>");
    return sec("internal", n, "内部备注", "仅内部版可见 · 永不进入分享链接", body, "dl-internal-sec");
  }
  function secNote(d, n, view) {
    var editable = !locked(d) && !view.readonly && (view.editMode || view.editingField === "note");
    return sec("note", n, "补充说明", "由编制人填写",
      '<div class="dl-narr-wrap"><div class="dl-narr" data-dl-field="note"'
      + (editable ? ' contenteditable="true" spellcheck="false" role="textbox" aria-label="编辑补充说明"' : "") + ">"
      + esc(narrative(d, "note") || "") + "</div></div>");
  }

  function secEvidence(d, n, view) {
    var o = options(d), list = visibleEvidence(d), miss = arr(d.missing);
    var body = '<div class="dl-evlist">' + list.map(function (e) {
      var name = EVIDENCE_ICONS[e.icon] || e.icon || "note";
      return '<div class="dl-ev ' + esc(e.color || "") + '"><span class="ei">' + icon(name, 15) + "</span>"
        + '<div class="ec"><b>' + esc(e.name) + (e.internal ? " " + chip("", "内部") : "") + "</b>"
        + '<span class="em">' + esc(e.meta) + "</span></div>"
        + (e.missing ? badge("warn", "缺失")
          : view.readonly ? ""
          : '<button class="btn sm ghost" type="button" data-dl-act="evidence" data-dl-view="' + esc(e.view || "")
            + '" data-dl-ref="' + esc(e.refId || "") + '" aria-label="打开' + esc(e.name) + '原始记录">' + icon("extlink", 13) + "</button>")
        + "</div>";
    }).join("") + "</div>"
      + (o.evidence < 2 && !view.readonly
        ? '<div class="dl-more-row plain"><button class="btn sm ghost" type="button" data-dl-act="evidence-level" data-dl-lv="2">显示全部证据（含制品校验值）'
          + icon("chevronRight", 12) + "</button></div>" : "")
      + (miss.length
        ? gap() + missing("<b>系统内确实没有记录的部分</b>（不推断、不补造）：<br>" + miss.map(esc).join("<br>")) : "");
    return sec("evidence", n, "证据与附件",
      EVIDENCE_NAMES[o.evidence] + (view.readonly ? " · 均来自系统记录" : " · 可追溯到原始记录"), body);
  }

  function secCaliber(d, n) {
    var rows = arr(d.calibers);
    return sec("caliber", n, "附录 · 统计口径", "每个数字的定义与分母",
      '<table class="dl-caliber-tbl"><thead><tr><th>指标</th><th>定义与分母</th><th>数据来源</th></tr></thead><tbody>'
      + rows.map(function (x) {
        return "<tr><td>" + esc(x.name) + "</td><td>" + esc(x.definition) + "</td><td>" + esc(x.source) + "</td></tr>";
      }).join("") + "</tbody></table>");
  }
  function secRevisions(d, n) {
    var rows = arr(d.revisions);
    return sec("revisions", n, "附录 · 修订记录", rows.length + " 份已导出快照",
      rows.map(function (x) {
        return '<div class="dl-rev"><span class="dl-sec-idx">' + esc(p2(x.seq)) + "</span>"
          + '<div class="rc"><b>' + esc(x.docNo) + "</b><span>"
          + esc(timeText(x.createdAt) + " · " + (x.createdByName || "未记录") + " · " + toneName(x.tone)
            + " · 校验值 " + String(x.contentHash || "").slice(0, 12)) + "</span></div>"
          + (x.shared ? badge("pri", "已分享") : badge("", "未分享")) + "</div>";
      }).join(""));
  }

  /* ==================== 纸张 ==================== */

  var HOURGLASS = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 3.5h10M5 16.5h10M6 3.5c0 3.2 1.3 4.8 4 6.5-2.7 1.7-4 3.3-4 6.5M14 3.5c0 3.2-1.3 4.8-4 6.5 2.7 1.7 4 3.3 4 6.5"/></svg>';

  function sheetHTML(d, viewOpts) {
    var view = viewOpts || {}, o = options(d), g = gates(d), rel = d.release;
    var list = sectionList(d), idx = {};
    list.forEach(function (s, i) { idx[s.k] = p2(i + 1); });
    var sub = o.tone === "customer" ? "提交 " + audience(d) + " · 说明本次交付范围与实际发布内容"
      : o.tone === "manager" ? "内部管理版 · 含投入、负载与风险责任人"
      : "内部复盘版 · 含内部备注，不对外";
    /* 未确认生产发布时水印与警示不可关闭：导出的管理版也必须一眼看出是草稿 */
    var watermark = g.blocked || (!!o.watermark && !view.clean);
    var head = '<div class="dl-doc-head">'
      + (watermark ? '<div class="dl-watermark">草稿</div>' : "")
      + (o.brand ? '<div class="dl-letter"><span class="dl-mark">' + HOURGLASS + "</span>"
        + '<div><div class="lt">沙漏 · 交付说明</div><div class="ls">DELIVERY STATEMENT</div></div>'
        + '<span class="grow"></span><div class="dl-doc-no">' + esc(d.docNo || "未编号") + "<br>"
        + esc(timeText(d.generatedAt)) + "</div></div>" : "")
      + '<div class="dl-kicker">' + esc(toneName(o.tone)) + (view.readonly ? " · 只读快照" : "") + "</div>"
      + '<h1 class="dl-doc-title">' + esc(d.projectName || "未归属项目") + " · " + esc(d.versionName || "") + "</h1>"
      + '<p class="dl-doc-sub">' + esc(sub) + "</p>"
      + '<div class="dl-doc-meta">'
      + "<div><span>交付对象</span><strong>" + esc(audience(d)) + "</strong></div>"
      + "<div><span>交付周期</span><strong>"
      + (d.periodStart || d.periodEnd
        ? '<span class="dt">' + esc(dateText(d.periodStart)) + '</span> → <span class="dt">'
          + esc(dateText(d.periodEnd)) + "</span>"
        : "未记录周期") + "</strong></div>"
      + "<div><span>发布记录</span><strong>" + (rel
        ? '<span class="rid">' + esc(relNo(rel)) + "</span>"
          + esc((rel.environmentName || rel.environment) + " · " + timeText(rel.occurredAt))
        : "尚未确认") + "</strong></div>"
      + "<div><span>编制</span><strong>" + esc(d.ownerName || "未记录") + "</strong></div>"
      + "</div>"
      + '<div class="dl-doc-flags">'
      + '<span class="dl-chip pri"><i class="dl-dot pri"></i>由系统记录自动生成</span>'
      + (g.blocked ? chip("bad", "发布未确认") : chip("ok", (rel.environmentName || "生产") + "发布已确认", "check"))
      + (g.pending.length && !view.readonly ? chip("warn", g.pending.length + " 处待确认") : chip("ok", "文字已确认", "check"))
      + (locked(d) || view.readonly ? chip("plum", "不可变快照", "lock") : "")
      + (nz(d.snapshotSeq) ? chip("plum", "第 " + nz(d.snapshotSeq) + " 份") : "")
      + "</div>"
      + (view.readonly || view.clean ? "" : '<div class="dl-doc-tools">'
        + '<button class="btn sm" type="button" data-dl-act="edit-mode"' + (locked(d) ? " disabled" : "") + ">"
        + icon("edit", 13) + (view.editMode ? "完成编辑" : "编辑文字") + "</button>"
        + '<button class="btn sm ghost" type="button" data-dl-act="sources">' + icon("eye", 13) + "数据来源总览</button>"
        + chip("", "数字只读 · 点击任意数字看来源") + "</div>")
      + "</div>"
      + (g.blocked
        ? '<div class="dl-doc-warning">未确认生产发布：本说明为内部草稿'
          + (o.tone === "customer" ? "，客户版不可导出" : "")
          + "。实际交付以成功的生产发布记录为准，完成数量不代表已交付。</div>" : "");

    var body = secSummary(d, idx.summary, view) + secScope(d, idx.scope, view);
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

    var foot = '<div class="dl-doc-foot">本说明由沙漏根据系统记录自动生成，实际交付以发布记录为准；不替代部署执行、流水线验证或客户验收签认。'
      + "数字为只读统计，点击任意数字可查看口径与来源记录；标注「未记录 / 未验证」的内容表示系统内确实没有记录，未做推断。<br>"
      + "<b>" + esc(d.docNo || "未编号") + "</b> · 生成时间 " + esc(timeText(d.generatedAt)) + " · " + esc(toneName(o.tone))
      + (locked(d) || view.readonly ? " · 快照已锁定，内容不随系统变化" : " · 草稿，导出后锁定")
      + (txt(d.contentHash) ? " · 内容校验值 " + esc(String(d.contentHash).slice(0, 16)) : "")
      + "</div>";
    return head + body + foot;
  }
  function sheetClass(d) {
    return "dl-sheet" + (options(d).density === "compact" ? " compact" : "");
  }
  function sheetMarkup(d, view) {
    /* a4：按真实 A4 内容宽排版，预览与打印共用同一套收缩规则，否则预览是 4 列、印出来是 2 列 */
    var a4 = view && view.a4 ? " dl-a4" : "";
    return '<article class="' + sheetClass(d) + a4 + '">' + sheetHTML(d, view) + "</article>";
  }

  /* ==================== 数字来源 ==================== */

  function sourceInfo(d, key) {
    var c = d.counts || {}, q = d.quality || {}, def = d.defects || {}, e = d.effort || {}, ds = d.demandSummary || {};
    var rel = d.release, rows = [];
    function row(id, m, s) { return { id: id, m: m, s: s }; }
    function scopeRow(x) { return row(x.ref || x.id, x.title, [x.module, x.owner, x.targetVersionName].filter(Boolean).join(" · ")); }
    if (key === "released") {
      rows = (rel ? [row(relNo(rel), "发布快照 · 已发布 " + nz(rel.publishedCount) + " 项 · 未纳入 " + nz(rel.excludedCount) + " 项",
        (rel.environmentName || rel.environment) + " · " + timeText(rel.occurredAt) + " · 不可变快照，记录后不可修改")] : [])
        .concat(arr(d.scope).filter(function (x) { return x.state === "released"; }).slice(0, 8).map(scopeRow));
      return {
        title: "已生产发布 " + nz(c.released) + " / " + nz(c.planned), view: "phase", refId: d.versionId,
        caliber: "口径：选中发布记录快照中处理结果为「已发布」的工作项数 / 版本承诺台账项数（当前绑定 + 基线内已移出）。完成列不等于交付。",
        rows: rows
      };
    }
    if (key === "passRate") {
      return {
        title: "回归通过率 " + (q.passRatePct == null ? "—" : num(q.passRatePct) + "%"), view: "testcases", refId: q.planId,
        caliber: "口径：通过 / （已执行 − 跳过）。跳过表示本次不适用，不计入分母；未执行不计入。数据来自关联本版本的测试计划执行结果。",
        rows: q.missing ? [row("—", "未创建测试计划或未圈选用例", "没有执行结果，不显示通过率")]
          : [row(q.planName || "计划", "圈选 " + nz(q.caseCount) + " 条 · 已执行 " + nz(q.executedCount) + " 条", "通过 " + nz(q.passedCount) + " · 失败 " + nz(q.failedCount) + " · 阻塞 " + nz(q.blockedCount)),
            row("VALID", "有效分母 " + (nz(q.executedCount) - nz(q.skippedCount)) + " 条", "已执行去掉跳过 " + nz(q.skippedCount) + " 条"),
            row("COVER", "执行覆盖 " + (q.coveragePct == null ? "—" : num(q.coveragePct) + "%"), "已执行 / 圈选总数")]
      };
    }
    if (key === "demands") {
      return {
        title: "需求兑现率 " + (ds.ratePct == null ? "—" : num(ds.ratePct) + "%"), view: "demands", refId: null,
        caliber: "口径：关联工作项全部纳入发布快照的需求数 / 本次涉及需求总数。部分兑现与延后都不计入已兑现。",
        rows: arr(d.demands).map(function (x) {
          return row(x.id, x.title, (STATE_NAMES[x.state] || x.state) + " · 工作项 " + nz(x.releasedCount) + " / " + nz(x.taskCount)
            + (x.targetVersionName ? " · 去向 " + x.targetVersionName : ""));
        })
      };
    }
    if (key === "deferred") {
      return {
        title: "后续计划 " + (nz(c.deferred) + nz(c.pending)) + " 项", view: "phase", refId: d.versionId,
        caliber: "口径：承诺台账中未随本次发布交付的项，含改版本延后与未纳入快照；去向取工作项的目标版本。",
        rows: arr(d.scope).filter(function (x) { return x.state !== "released"; }).map(scopeRow)
      };
    }
    if (key === "defects" || key === "blockerDefects") {
      var list = key === "blockerDefects"
        ? arr(def.open).filter(function (x) { return x.blocksAcceptance; }) : arr(def.open);
      return {
        title: key === "blockerDefects" ? "阻塞验收 " + nz(def.blockerOpenCount) + " 项" : "未关闭缺陷 " + nz(def.openCount) + " 项",
        view: "defects", refId: null,
        caliber: key === "blockerDefects"
          ? "口径：未关闭且严重度为阻断 / 严重的缺陷；一般与轻微不阻塞验收。"
          : "口径：发现版本或计划版本指向本版本、且当前不在「已完成」列的缺陷。",
        rows: def.missing ? [row("—", "无关联缺陷记录", "不代表没有质量问题")]
          : list.length ? list.map(function (x) {
            return row(itemNo(x), x.title, [x.severityName, x.columnName, x.regressionName, x.owner, x.targetVersionName].filter(Boolean).join(" · "));
          }) : [row("—", "没有符合条件的缺陷", "全部已关闭")]
      };
    }
    if (key === "fixedDefects") {
      return {
        title: "已修复关闭 " + nz(def.fixedCount) + " 项", view: "defects", refId: null,
        caliber: "口径：关联本版本且当前处于「已完成」列的缺陷，完成日取工作项完成时间。",
        rows: arr(def.fixed).map(function (x) {
          return row(itemNo(x), x.title, [x.severityName, x.owner, dateText(x.completedAt)].filter(Boolean).join(" · "));
        })
      };
    }
    if (key === "effort") {
      return {
        title: "实际投入 " + hours(e.workMinutes) + " 小时", view: "report", refId: null,
        caliber: "口径：版本范围内工作项的计时 + 补记合计；有发布快照时取快照内工时。不是计费工时，不用于结算。",
        rows: e.missing ? [row("—", "无计时与补记记录", "不用完成数量或预估反推投入")]
          : arr(e.byMember).map(function (x) { return row(x.name, hours(x.minutes) + " 小时", "占比 " + nz(x.pct) + "% · 计时明细可在工时报表下钻"); })
      };
    }
    if (key === "estimate") {
      return {
        title: "预估工时 " + hours(e.estimateMinutes) + " 小时", view: "phase", refId: d.versionId,
        caliber: "口径：版本范围内工作项预估分钟之和；有发布快照时取快照时刻的值，快照后预估变化不影响本说明。",
        rows: arr(d.scope).filter(function (x) { return nz(x.estimateMinutes); }).slice(0, 10).map(function (x) {
          return row(x.ref || x.id, x.title, "预估 " + hours(x.estimateMinutes) + " 小时");
        })
      };
    }
    if (key === "deviation") {
      return {
        title: "投入偏差 " + signed(hours(e.deviationMinutes)) + " 小时", view: "report", refId: null,
        caliber: "口径：实际投入 − 预估工时；偏差率以预估为分母，预估为 0 时不给比率。超出原因需人工在变更台账或补充说明里解释，系统不编造。",
        rows: arr(d.changes).filter(function (x) { return x.kind === "add" || x.kind === "date"; }).map(function (x) {
          return row(dateText(x.date), x.title, arr(x.tags).join(" · ") + (x.reason ? " · " + x.reason : ""));
        })
      };
    }
    return { title: "数据来源", caliber: "该数字来自系统记录，口径见附录「统计口径」。", rows: rows, view: "phase", refId: d.versionId };
  }
  function sourcesOverview(d) {
    return [
      { name: "交付摘要 / 交付范围", from: "版本承诺台账 + 发布记录快照", table: "version_task / version_commitment_task / version_release_item" },
      { name: "需求兑现", from: "需求池条目与工作项关联 + 发布快照", table: "demand / version_release_item" },
      { name: "变更说明", from: "承诺基线对照 + 排期与改版本日志", table: "version_commitment_task / task_log / version_log" },
      { name: "质量与验证", from: "测试计划执行结果", table: "test_plan / test_plan_case" },
      { name: "缺陷与已知问题", from: "缺陷库（按发现版本 / 计划版本）", table: "task.item_type = bug" },
      { name: "投入与负载", from: "计时与补记", table: "time_log / version_release_item.work_minutes" },
      { name: "发布与运行信息", from: "正式发布记录（含失败与回滚）", table: "version_release" },
      { name: "发布计划与窗口", from: "发布计划原文（窗口、部署目标、风险与回滚约定）", table: "version_release_plan / version_release_plan_task" },
      { name: "验收与结论", from: "发布记录 + 基线 + 回归结果 + 需求验收标准", table: "只读派生，不新增录入" },
      { name: "证据与附件", from: "发布记录、版本快照、测试报告、需求来源", table: "version_release / test_plan / demand" }
    ].map(function (x) { return { name: x.name, from: x.from, table: x.table, version: d.versionName }; });
  }

  /* ==================== 导出 ==================== */

  function markdown(d) {
    var o = options(d), c = d.counts || {}, q = d.quality || {}, def = d.defects || {}, ds = d.demandSummary || {};
    var e = d.effort || {}, rel = d.release, a = d.acceptance || {}, idx = {}, L = [];
    sectionList(d).forEach(function (s, i) { idx[s.k] = i + 1; });
    function heading(key, title) { L.push(""); L.push("## " + idx[key] + ". " + title); }
    function text(field) { var v = narrative(d, field); L.push(v == null ? autoText(d, field) : v); }
    L.push("# 交付说明 · " + (d.projectName || "") + " · " + (d.versionName || ""));
    L.push("");
    L.push("- 语气：" + toneName(o.tone) + "　交付对象：" + audience(d));
    L.push("- 交付周期：" + periodText(d));
    L.push("- 发布记录：" + (rel ? relNo(rel) + " · " + (rel.environmentName || rel.environment) + " · " + timeText(rel.occurredAt) : "尚未确认"));
    L.push("- 编制：" + (d.ownerName || "未记录") + "　编号：" + (d.docNo || "未编号") + "　生成时间：" + timeText(d.generatedAt));
    if (locked(d)) L.push("- 状态：不可变快照" + (txt(d.contentHash) ? "　内容校验值：" + d.contentHash : ""));
    heading("summary", "交付摘要");
    text("summary");
    L.push("");
    L.push("| 指标 | 数值 | 口径 |");
    L.push("| --- | --- | --- |");
    L.push("| 已发布 | " + nz(c.released) + " / " + nz(c.planned) + " | 发布快照中处理结果为已发布 / 承诺台账 |");
    L.push("| 未纳入本次 | " + nz(c.pending) + " | 承诺台账内未随本次发布交付 |");
    L.push("| 改版本延后 | " + nz(c.deferred) + " | 已改到后续版本，保留在台账 |");
    L.push("| 回归通过率 | " + (q.passRatePct == null ? "未执行回归" : num(q.passRatePct) + "%") + " | 通过 / （已执行 − 跳过） |");
    if (idx.demands) L.push("| 需求兑现率 | " + (ds.ratePct == null ? "—" : num(ds.ratePct) + "%") + " | 全部工作项已发布的需求 / 涉及需求 |");
    if (!def.missing) L.push("| 未关闭缺陷 | " + nz(def.openCount) + " | 其中阻塞验收 " + nz(def.blockerOpenCount) + " 项 |");
    if (idx.effort) L.push("| 实际投入 | " + (e.missing ? "未记录工时" : hours(e.workMinutes) + "h") + " | 计时 + 补记 |");
    heading("scope", "交付范围");
    scopeRows(d).forEach(function (x) {
      L.push("- [" + (STATE_NAMES[x.state] || (x.state === "released" ? "已发布" : x.state === "done" ? "已完成" : x.state === "deferred" ? "延后" : "未完成")) + "] "
        + (x.module || "未分模块") + " · " + x.title + "（" + [x.ref, x.itemTypeName, x.targetVersionName].filter(Boolean).join(" · ") + "）");
    });
    if (idx.demands) {
      heading("demands", "需求兑现");
      arr(d.demands).forEach(function (x) {
        L.push("- [" + (STATE_NAMES[x.state] || x.state) + "] " + x.title + "　工作项 " + nz(x.releasedCount) + "/" + nz(x.taskCount)
          + (x.targetVersionName ? "　去向 " + x.targetVersionName : ""));
      });
    }
    if (idx.changes) {
      heading("changes", "变更说明");
      text("change");
      arr(d.changes).forEach(function (x) {
        L.push("- " + dateText(x.date) + "　" + x.title + "　" + arr(x.tags).join(" / ") + "　" + (x.actorName || "")
          + (x.reason ? "　理由：" + x.reason : ""));
      });
      if (!arr(d.changes).length) L.push("- 无变更记录" + (d.baseline && d.baseline.capturedAt ? "（基线 " + timeText(d.baseline.capturedAt) + " 建立）" : "（未冻结基线）"));
    }
    heading("quality", "质量与验证");
    text("issue");
    if (idx.defects) {
      heading("defects", "缺陷与已知问题");
      if (def.missing) L.push("无关联缺陷记录；清单为空不代表没有质量问题。");
      else {
        L.push("共 " + nz(def.totalCount) + " 项，已修复 " + nz(def.fixedCount) + " 项，遗留 " + nz(def.openCount)
          + " 项，其中阻塞验收 " + nz(def.blockerOpenCount) + " 项。");
        arr(def.open).forEach(function (x) {
          L.push("- [遗留] " + x.severityName + " · " + x.title + "（" + itemNo(x) + "）　" + [x.columnName, x.regressionName, o.tone === "customer" ? "" : x.owner, x.targetVersionName].filter(Boolean).join(" · "));
        });
        arr(def.fixed).forEach(function (x) {
          L.push("- [已修复] " + x.severityName + " · " + x.title + "　完成 " + dateText(x.completedAt));
        });
      }
    }
    if (idx.effort) {
      heading("effort", o.tone === "customer" ? "投入概况" : "投入与负载");
      if (e.missing) L.push("未记录工时，不用完成数量或预估反推投入。");
      else {
        L.push("实际 " + hours(e.workMinutes) + "h · 预估 " + hours(e.estimateMinutes) + "h · 偏差 "
          + signed(hours(e.deviationMinutes)) + "h" + (e.deviationPct == null ? "" : "（" + signed(e.deviationPct) + "%）"));
        arr(o.effortDim === "member" ? e.byMember : e.byModule).forEach(function (x) {
          L.push("- " + x.name + "　" + hours(x.minutes) + "h　" + nz(x.pct) + "%");
        });
      }
    }
    if (idx.release) {
      heading("release", "发布与运行信息");
      if (!rel) L.push("尚未确认成功的生产发布，运行信息不可给出。");
      else {
        L.push("- 环境与操作：" + (rel.environmentName || rel.environment) + " · " + (rel.operationName || rel.operation));
        L.push("- 结果与覆盖：" + rel.result + " · " + (COVERAGE_NAMES[rel.coverage] || rel.coverage || "未知"));
        L.push("- 实际发生：" + timeText(rel.occurredAt) + "　记录时间：" + timeText(rel.recordedAt));
        L.push("- 目标就绪日：" + dateText(d.targetDate) + "　延迟：" + (rel.delayDays == null ? "未设置目标日" : nz(rel.delayDays) + " 天"));
        if (o.tone !== "customer") {
          L.push("- 部署目标：" + (arr(rel.targets).join("、") || "未记录"));
          L.push("- 制品：" + (rel.artifactRef || "未记录"));
          if (o.evidence >= 2) L.push("- SHA256：" + (rel.artifactDigest || "未记录"));
        }
        L.push("- 发布尝试：共 " + nz(rel.attemptCount) + " 次 · 成功 " + nz(rel.successCount) + " · 回滚 " + nz(rel.rollbackCount));
        if (o.tone !== "customer") L.push("- 实际执行人：" + (rel.executorName || "未记录"));
        if (txt(rel.deviationReason)) L.push("- 偏差 / 紧急理由：" + rel.deviationReason);
        if (txt(rel.failureReason)) L.push("- 失败原因：" + rel.failureReason);
        if (txt(rel.notes)) L.push("- 说明：" + rel.notes);
      }
      if (d.plan) {
        var p = d.plan;
        L.push("");
        L.push("**发布计划与窗口**（计划 " + p.id + "，原文引用）");
        L.push("- 计划窗口：" + (p.plannedAt ? timeText(p.plannedAt) : "未定") + "　状态：" + (p.statusName || p.status || "未记录"));
        L.push("- 环境与覆盖：" + (p.environmentName || p.environment || "未记录") + " · " + (COVERAGE_NAMES[p.coverage] || "覆盖未知")
          + "　计划范围：" + nz(p.taskCount) + " 项");
        if (o.tone !== "customer" && arr(p.targets).length) L.push("- 部署目标：" + arr(p.targets).join("、"));
        if (o.tone !== "customer" && txt(p.ownerName)) L.push("- 计划负责人：" + p.ownerName);
        if (nz(p.versionCount) > 1) L.push("- 同批版本：" + arr(p.versionNames).join("；"));
        L.push("- 发布安排：" + (txt(p.notes) || "未填写"));
        L.push("- 风险与回滚约定：" + (txt(p.risks) || "未填写，不代拟"));
      }
    }
    heading("risks", "后续计划与风险");
    arr(d.risks).forEach(function (x) {
      L.push("- " + x.title + (txt(x.refId) ? "（" + x.refId + "）" : "") + "　" + x.impact
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
    if (idx.internal) {
      heading("internal", "内部备注（不对外）");
      L.push(narrative(d, "internal") || "（未填写）");
    }
    if (idx.note) {
      heading("note", "补充说明");
      L.push(narrative(d, "note") || "");
    }
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
    L.push("本说明由沙漏根据系统记录自动生成，实际交付以发布记录为准；不替代部署执行、流水线验证或客户验收签认。");
    return L.join("\n");
  }

  /* 独立 HTML：调用方把 tokens.css + delivery.css 的文本传进来，保持样式单一来源 */
  function htmlDocument(d, css) {
    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\" />\n"
      + '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
      + "<title>交付说明 · " + esc(d.projectName || "") + " · " + esc(d.versionName || "") + "</title>\n"
      + "<style>\n" + (css || "") + "\n"
      + "body{margin:0;padding:24px;background:var(--bg-app);color:var(--text);font-family:var(--font-sans);}\n"
      + ".dl-export-wrap{max-width:900px;margin:0 auto;}\n"
      + "@media print{body{padding:0;}body>*:not(.dl-export-wrap){display:none!important;}}\n"
      + "</style>\n</head>\n<body>\n<div class=\"dl-export-wrap\">\n"
      + sheetMarkup(d, { readonly: true, clean: true })
      + "\n</div>\n</body>\n</html>\n";
  }

  function exportBaseName(d) {
    var raw = (d.projectName || "交付说明") + "-" + (d.versionName || "") + "-" + (d.docNo || dateText(d.generatedAt));
    return raw.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* 压到一页：只调生成控制，不改任何事实 */
  function leanPatch() {
    return {
      verbosity: 0, density: "compact", granularity: "brief", evidence: 0,
      showEffort: false, showRelease: false, showSupport: false, showCaliber: false, showRevisions: false
    };
  }

  var DD = {
    DEFAULTS: DEFAULTS,
    TONES: TONES,
    GRANULARITY: GRANULARITY,
    EVIDENCE_NAMES: EVIDENCE_NAMES,
    VERBOSITY_NAMES: VERBOSITY_NAMES,
    options: options,
    toneName: toneName,
    locked: locked,
    blocked: blocked,
    gates: gates,
    audience: audience,
    showEffort: showEffort,
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
    leanPatch: leanPatch,
    dateText: dateText,
    timeText: timeText,
    hours: hours,
    mark: HOURGLASS,
    esc: esc
  };

export { DD };