/* lib/milestone-ui · 项目级里程碑的共享展示与详情操作（项目驾驶舱 / 甘特） */
import { API } from "../core/api.js";
import { icon } from "../core/icons.js";
import { UI, esc, toast } from "../core/ui.js";
import { fmtMD, fmtTs, addDays, iso } from "./format.js";

var KIND_NAMES = { version: "版本发布后", tasks: "工作项完成后", manual: "人工确认" };
var STATUS_META = {
  achieved: { label: "已达成", cls: "tag-success" },
  achieved_rolled_back: { label: "已达成 · 已回滚", cls: "tag-warning" },
  overdue: { label: "已延期", cls: "tag-danger" },
  canceled: { label: "已取消", cls: "tag-neutral" },
  pending: { label: "未达成", cls: "ghost" }
};

export function milestoneKindName(kind){ return KIND_NAMES[kind] || kind || "—"; }
export function milestoneStatusMeta(status){ return STATUS_META[status] || STATUS_META.pending; }
export function milestoneStatusTag(m){
  var s = milestoneStatusMeta(m && m.status);
  return '<span class="tag ' + s.cls + '">' + s.label + '</span>';
}
export function milestoneEvidence(m){
  if(!m) return "";
  if(m.kind === "version"){
    var text = "生产发布成功 " + (m.releaseCount || 0) + " 次";
    if(m.releaseAt) text += " · 最近 " + fmtTs(m.releaseAt);
    if(m.rolledBack) text += " · 达成后回滚";
    return text;
  }
  if(m.kind === "tasks"){
    return "关联工作项 " + (m.doneTaskCount || 0) + " / " + (m.taskCount || 0) + " 完成";
  }
  if(m.achievedAt){
    return "人工确认于 " + fmtTs(m.achievedAt) + (m.confirmedByName ? " · " + m.confirmedByName : "");
  }
  return "待人工确认";
}
export function milestoneWhen(m){
  if(!m) return "";
  if(m.achievedAt) return "达成 " + fmtTs(m.achievedAt);
  if(m.canceledAt) return "取消 " + fmtTs(m.canceledAt);
  return m.targetDate ? "目标 " + fmtMD(new Date(m.targetDate + "T00:00:00")) : "";
}

function layerEl(title, desc, html){
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", title);
  layer.innerHTML = '<div class="sheet sm"><div class="sheet-head"><div style="flex:1;min-width:0"><h2>' + esc(title) + '</h2>'
    + (desc ? '<p class="desc">' + esc(desc) + '</p>' : '') + '</div>'
    + '<button class="icon-btn sm" type="button" data-ms-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body">' + html + '</div></div>';
  document.body.appendChild(layer);
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  UI.openModal(layer, "button");
  return layer;
}

function detailHTML(m, canWrite){
  var tag = milestoneStatusTag(m);
  var rows = [
    ["达成方式", esc(milestoneKindName(m.kind)) + (m.versionName ? " · " + esc(m.versionName) : "")],
    ["目标日期", m.targetDate ? esc(m.targetDate) : "未设置"],
    ["负责人", esc(m.ownerName || "未指派")],
    ["证据", esc(milestoneEvidence(m))]
  ];
  if(m.note) rows.push(["说明", esc(m.note)]);
  if(m.achievedNote) rows.push(["达成说明", esc(m.achievedNote)]);
  if(m.cancelReason) rows.push(["取消原因", esc(m.cancelReason)]);
  var acts = "";
  if(canWrite && m.status !== "canceled"){
    acts = '<div class="phase-acts ms-detail-acts">';
    if(m.kind === "manual" && (m.status === "achieved" || m.status === "achieved_rolled_back")){
      acts += '<button class="btn sm ghost" type="button" data-ms-act="revoke">撤销达成</button>';
    }
    if(m.kind === "manual" && m.status !== "achieved" && m.status !== "achieved_rolled_back"){
      acts += '<button class="btn sm primary" type="button" data-ms-act="achieve">标记达成</button>';
    }
    if(m.status === "pending" || m.status === "overdue"){
      acts += '<button class="btn sm ghost" type="button" data-ms-act="reschedule">改期</button>';
      acts += '<button class="btn sm ghost danger" type="button" data-ms-act="cancel">取消</button>';
    }
    acts += '</div>';
  }
  var logs = (m.logs || []).map(function(log){
    return '<li><span class="ms-log-time">' + esc(fmtTs(log.createdAt)) + '</span><span class="ms-log-text">'
      + esc(log.detail || log.action) + (log.operatorName ? ' · ' + esc(log.operatorName) : '') + '</span></li>';
  }).join("");
  return '<div class="ms-detail-head"><b>' + esc(m.name) + '</b>' + tag
    + (m.keyMilestone ? '<span class="tag tag-primary">关键</span>' : '') + '</div>'
    + '<dl class="ms-detail-meta">' + rows.map(function(r){
      return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>';
    }).join("") + '</dl>'
    + acts + '<div id="msActionBox"></div>'
    + '<div class="ms-log-box"><b>动态</b>' + (logs ? '<ul class="ms-logs">' + logs + '</ul>' : '<p class="foot-note">暂无动态</p>') + '</div>';
}

function formHTML(act, m){
  var rev = '<input type="hidden" name="msAct" value="' + esc(act) + '">';
  if(act === "achieve"){
    return '<div class="ms-action-form">' + rev + '<p class="foot-note">负责人：' + esc(m.ownerName || "—") + ' · 日期：' + esc(fmtTs(new Date().toISOString())) + '</p>'
      + '<label>说明（可选）<input class="inp" data-ms-field="note" maxlength="500" placeholder="例如：客户验收通过"></label>'
      + '<div class="phase-acts"><button class="btn sm primary" type="button" data-ms-submit="achieve">确认达成</button>'
      + '<button class="btn sm ghost" type="button" data-ms-act="">取消</button></div></div>';
  }
  if(act === "revoke"){
    return '<div class="ms-action-form">' + rev + '<label>撤销原因（可选）<input class="inp" data-ms-field="reason" maxlength="500"></label>'
      + '<div class="phase-acts"><button class="btn sm ghost danger" type="button" data-ms-submit="revoke">确认撤销</button>'
      + '<button class="btn sm ghost" type="button" data-ms-act="">取消</button></div></div>';
  }
  if(act === "reschedule"){
    var base = m.targetDate ? new Date(m.targetDate + "T00:00:00") : new Date();
    var next = iso(addDays(base, 7));
    return '<div class="ms-action-form">' + rev
      + '<p class="foot-note">' + esc(m.targetDate || "未设置") + ' → 新日期（默认顺延 7 天）</p>'
      + '<label>新目标日期<input class="inp" type="date" data-ms-field="targetDate" value="' + esc(next) + '"></label>'
      + '<label>改期原因<input class="inp" data-ms-field="reason" maxlength="500" placeholder="必填"></label>'
      + '<div class="phase-acts"><button class="btn sm primary" type="button" data-ms-submit="reschedule">确认改期</button>'
      + '<button class="btn sm ghost" type="button" data-ms-act="">取消</button></div></div>';
  }
  return '<div class="ms-action-form">' + rev + '<label>取消原因<input class="inp" data-ms-field="reason" maxlength="500" placeholder="必填"></label>'
    + '<p class="foot-note">取消后保留历史与原因，不计入达成统计。</p>'
    + '<div class="phase-acts"><button class="btn sm ghost danger" type="button" data-ms-submit="cancel">确认取消</button>'
    + '<button class="btn sm ghost" type="button" data-ms-act="">取消</button></div></div>';
}

export function openMilestoneDetail(milestone, opts){
  opts = opts || {};
  var canWrite = opts.canWrite !== false;
  var current = milestone;
  var layer = layerEl("里程碑详情", "状态由条件或证据推导，不提供手改。", detailHTML(current, canWrite));
  function body(){ return layer.querySelector(".sheet-body"); }
  function repaint(){ body().innerHTML = detailHTML(current, canWrite); }
  function refresh(){
    return API.get("/api/milestones/" + encodeURIComponent(current.id)).then(function(fresh){
      current = fresh;
      repaint();
      if(opts.onChanged) opts.onChanged(current.reqId);
    }).catch(function(ex){
      toast(ex.message || "刷新里程碑失败", "bad");
    });
  }
  function actionBox(){ return layer.querySelector("#msActionBox"); }
  layer.addEventListener("click", function(e){
    if(e.target === layer || e.target.closest("[data-ms-close]")){ UI.closeModal(layer); return; }
    var act = e.target.closest("[data-ms-act]");
    if(act){
      var name = act.getAttribute("data-ms-act");
      var box = actionBox();
      box.innerHTML = name ? formHTML(name, current) : "";
      var field = box.querySelector("[data-ms-field]");
      if(field) field.focus();
      return;
    }
    var submit = e.target.closest("[data-ms-submit]");
    if(!submit) return;
    var kind = submit.getAttribute("data-ms-submit");
    var box2 = actionBox();
    function value(field){ var el = box2.querySelector('[data-ms-field="' + field + '"]'); return el ? String(el.value || "").trim() : ""; }
    var payload = { revision: current.revision };
    var path = "/api/milestones/" + encodeURIComponent(current.id);
    if(kind === "achieve"){
      payload.note = value("note") || null;
      path += "/achieve";
    }else if(kind === "revoke"){
      payload.reason = value("reason") || null;
      path += "/revoke";
    }else if(kind === "reschedule"){
      payload.targetDate = value("targetDate") || null;
      payload.reason = value("reason") || null;
      if(!payload.targetDate){ toast("请选择新目标日期", "warn"); return; }
      if(!payload.reason){ toast("请填写改期原因", "warn"); return; }
      path += "/reschedule";
    }else{
      payload.reason = value("reason") || null;
      if(!payload.reason){ toast("请填写取消原因", "warn"); return; }
      path += "/cancel";
    }
    submit.disabled = true;
    API.post(path, payload).then(function(){
      toast(kind === "achieve" ? "已标记达成" : (kind === "revoke" ? "已撤销达成" : (kind === "reschedule" ? "已改期" : "已取消里程碑")), "fs");
      return refresh();
    }).catch(function(ex){
      submit.disabled = false;
      toast(ex.message || "操作失败", "bad");
    });
  });
  return layer;
}
