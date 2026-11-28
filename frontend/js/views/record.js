/* views/record · 记录发布页（#/record?versionId=&reqId=&planId=&from=）
   原型第 8 屏：①关联哪个计划 ②结果是什么 ③和计划一致吗。
   保存仍走 phase.js 同一条正式链路：先 /release-preview 拿 scopeToken，再 /release 带幂等键确认；
   这里只把表单收成三段引导，计划范围、覆盖与环境从所选计划带入，避免两套校验。 */

import { API } from "../core/api.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import {
  fmtReleaseTime, planStatusName, releaseEnvironmentName,
  releasePlanNoText, releaseNoText, taskVersionIds
} from "../lib/format.js";

var host = null, seq = 0;
var ver = null, reqId = "", versionId = "";
var plans = [], records = [], tasks = [], members = [];
var from = "";
var busy = false, errorMsg = "";
var form = blankForm();

function blankForm(){
  return {
    planId:"", environment:"production", result:"success", occurredAt:"", executorUserId:"",
    artifactRef:"manual", failureReason:"", deviationReason:"", relatedReleaseId:""
  };
}
function pad(n){ return (n < 10 ? "0" : "") + n; }
function localMinute(d){
  d = d || new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmtInput(iso){
  if(!iso) return "";
  var d = new Date(iso);
  return isNaN(d.getTime()) ? "" : localMinute(d);
}
function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "record") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  return {
    versionId: p.get("versionId") || p.get("id") || "",
    reqId: p.get("reqId") || "",
    planId: p.get("planId") || "",
    from: p.get("from") || ""
  };
}
export function openRecordPage(opts){
  opts = opts || {};
  if(!opts.versionId){ toast("缺少版本，无法记录发布", "warn"); return; }
  var h = "#/record?versionId=" + encodeURIComponent(opts.versionId);
  if(opts.reqId) h += "&reqId=" + encodeURIComponent(opts.reqId);
  if(opts.planId) h += "&planId=" + encodeURIComponent(opts.planId);
  if(opts.from) h += "&from=" + encodeURIComponent(opts.from);
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("record");
}
function versionHash(){
  return "#/version?id=" + encodeURIComponent(versionId) + (reqId ? "&reqId=" + encodeURIComponent(reqId) : "") + "&tab=releases";
}
function leave(){
  if(from === "plans"){
    try{ history.pushState(null, "", "#/release"); }
    catch(e){ window.location.hash = "#/release"; }
    showView("release");
    return;
  }
  try{ history.pushState(null, "", versionHash()); }
  catch(e){ window.location.hash = versionHash(); }
  showView("version");
}
function planDisplayName(p){
  var custom = String(p.name || "").trim();
  if(custom) return custom;
  return (ver && ver.name ? ver.name : "版本") + " " + releaseEnvironmentName(p.environment || "production") + "发布";
}
function planLabel(p){
  var no = releasePlanNoText(p.planNo);
  return (no ? no + " · " : "") + planDisplayName(p) + "（" + planStatusName(p.status) + " · " + releaseEnvironmentName(p.environment) + "）";
}
function memberName(uid){
  var hit = members.filter(function(m){ return m.id === uid; })[0];
  return (hit && hit.name) || "";
}
function selectedPlan(){
  return plans.filter(function(p){ return p.id === form.planId; })[0] || null;
}
function scopeTaskIds(){
  if(!ver) return [];
  return tasks.filter(function(t){ return taskVersionIds(t).indexOf(ver.id) !== -1; }).map(function(t){ return t.id; });
}
/* 实际登记范围：计划内属于当前版本的工作项；计划没圈定或没有交集时退回版本全部工作项 */
function actualIds(){
  var plan = selectedPlan(), scope = scopeTaskIds();
  if(!plan) return scope;
  var ids = (plan.plannedTaskIds || []).filter(function(id){ return scope.indexOf(id) !== -1; });
  return ids.length ? ids : scope;
}
function rollbackCandidates(){
  var ids = actualIds();
  return records.filter(function(r){
    if(r.result !== "success" || r.operation === "rollback") return false;
    if(r.environment !== form.environment) return false;
    var tids = (r.items || []).map(function(i){ return i.taskId; });
    return ids.every(function(id){ return tids.indexOf(id) !== -1; });
  });
}
function preferredPlanId(routePlanId){
  var usable = plans.filter(function(p){ return p.status !== "completed" && p.status !== "canceled"; });
  if(routePlanId && usable.some(function(p){ return p.id === routePlanId; })) return routePlanId;
  var ready = usable.filter(function(p){ return p.status === "ready" && (p.environment || "production") === form.environment; });
  return ready.length ? ready[0].id : "";
}
function syncRelated(auto){
  var list = rollbackCandidates();
  if(auto || !list.some(function(r){ return r.id === form.relatedReleaseId; })){
    form.relatedReleaseId = list.length ? list[0].id : "";
  }
}

/* ==================== 数据 ==================== */

function load(route){
  versionId = route.versionId;
  reqId = route.reqId;
  from = route.from;
  var current = ++seq;
  host.innerHTML = '<div class="record-page">' + UI.skeletonRows(4) + '</div>';
  resolveReq().then(function(rid){
    if(current !== seq) return null;
    if(!rid){ renderFatal("找不到这个版本，它可能已被删除，或你已没有该项目的访问权限。"); return null; }
    reqId = rid;
    var base = "/api/versions/" + encodeURIComponent(versionId);
    return Promise.all([
      API.get("/api/versions", { reqId: rid }),
      API.get(base + "/release-plans").catch(function(){ return []; }),
      API.get(base + "/release-records").catch(function(){ return []; }),
      API.get("/api/versions/task-options", { reqId: rid }).catch(function(){ return []; }),
      loadMembers()
    ]);
  }).then(function(rs){
    if(!rs || current !== seq) return;
    ver = (rs[0] || []).filter(function(v){ return v.id === versionId; })[0] || null;
    if(!ver){ renderFatal("这个项目下已没有该版本，它可能已被删除。"); return; }
    plans = rs[1] || [];
    records = rs[2] || [];
    tasks = rs[3] || [];
    members = rs[4] || [];
    form = blankForm();
    form.planId = preferredPlanId(route.planId);
    var plan = selectedPlan();
    form.environment = (plan && plan.environment) || "production";
    form.occurredAt = localMinute();
    form.executorUserId = (plan && plan.ownerUserId) || (rt.currentUser && rt.currentUser.id) || (members[0] && members[0].id) || "";
    syncRelated(true);
    render();
  }).catch(function(ex){
    if(current !== seq) return;
    renderFatal(ex.message || "加载失败，请稍后重试");
  });
}
function resolveReq(){
  if(reqId) return Promise.resolve(reqId);
  return API.get("/api/versions/cross-project").then(function(rows){
    var hit = (rows || []).filter(function(r){ return r.versionId === versionId; })[0];
    return hit ? hit.reqId : "";
  }).catch(function(){ return ""; });
}
function loadMembers(){
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!wsId) return Promise.resolve([]);
  return API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/members").then(function(rows){
    return (rows || []).map(function(m){ return { id:m.userId || m.id, name:m.name || m.userId }; });
  }).catch(function(){ return []; });
}

/* ==================== 渲染 ==================== */

function renderFatal(msg){
  host.innerHTML = '<div class="record-page"><div class="panel"><div class="panel-head"><h3>记录发布</h3></div>'
    + '<div class="stack"><p class="hint">' + esc(msg) + '</p>'
    + '<div class="rel-empty-acts"><button class="btn sm" type="button" data-rec-back>返回版本</button>'
    + '<button class="btn sm" type="button" data-rec-retry>重试</button></div></div></div></div>';
}
function canPublish(){ return !!ver && ver.canPublish === true; }
function planOptionsHTML(){
  var usable = plans.filter(function(p){ return p.status !== "completed" && p.status !== "canceled"; });
  return '<option value="">无计划 —— 计划外 / 紧急发布</option>'
    + usable.map(function(p){
      return '<option value="' + esc(p.id) + '"' + (form.planId === p.id ? " selected" : "") + '>' + esc(planLabel(p)) + '</option>';
    }).join("");
}
function envCardsHTML(){
  return [["test", "测试"], ["staging", "预发布"], ["production", "生产"]].map(function(e){
    return '<button type="button" class="rc' + (form.environment === e[0] ? " on" : "") + '" data-rec-env-val="' + e[0] + '" aria-pressed="' + (form.environment === e[0] ? "true" : "false") + '">' + e[1] + '</button>';
  }).join("");
}
function resultCardsHTML(){
  return [["success", "成功"], ["failed", "失败"], ["rollback", "回滚"]].map(function(r){
    return '<button type="button" class="rc' + (form.result === r[0] ? " on" : "") + '" data-rec-result-val="' + r[0] + '" aria-pressed="' + (form.result === r[0] ? "true" : "false") + '">' + r[1] + '</button>';
  }).join("");
}
function ownerOptionsHTML(){
  var list = members.slice();
  var mine = rt.currentUser && rt.currentUser.id;
  if(mine && !list.some(function(m){ return m.id === mine; })) list.unshift({ id:mine, name:(rt.currentUser.name || mine) });
  if(!list.length && form.executorUserId) list.push({ id:form.executorUserId, name:form.executorUserId });
  return list.map(function(m){
    return '<option value="' + esc(m.id) + '"' + (form.executorUserId === m.id ? " selected" : "") + '>' + esc(m.name) + '</option>';
  }).join("");
}
function relatedOptionsHTML(){
  var list = rollbackCandidates();
  if(!list.length) return '<option value="">当前环境没有可引用的成功发布</option>';
  return '<option value="">请选择（回滚必填）</option>' + list.map(function(r){
    return '<option value="' + esc(r.id) + '"' + (form.relatedReleaseId === r.id ? " selected" : "") + '>'
      + esc((releaseNoText(r.releaseNo) || "#" + r.id) + " · " + releaseEnvironmentName(r.environment) + "成功 · " + fmtReleaseTime(r.occurredAt).slice(5, 16)) + '</option>';
  }).join("");
}
function compareState(){
  var plan = selectedPlan(), out = { rows:[], deviations:[] };
  if(!plan){
    out.rows.push({ tone:"warn", t:"未关联计划", d:"将记为「计划外发布」，不触发计划收口；保存前必须写明偏差理由。" });
    out.deviations.push("未关联发布计划");
    return out;
  }
  var envSame = (plan.environment || "production") === form.environment;
  out.rows.push({ tone:envSame ? "ok" : "warn", t:"环境比对", d:"计划 " + releaseEnvironmentName(plan.environment) + " → 实际 " + releaseEnvironmentName(form.environment) });
  if(!envSame) out.deviations.push("环境与计划不一致");
  var ready = plan.status === "ready";
  out.rows.push({ tone:ready ? "ok" : "warn", t:"计划状态", d:ready ? "计划已就绪，内容与环境已锁定" : "计划状态是「" + planStatusName(plan.status) + "」，不是「就绪」" });
  if(!ready) out.deviations.push("计划未就绪");
  var at = form.occurredAt ? new Date(form.occurredAt) : null, planned = plan.plannedAt ? new Date(plan.plannedAt) : null;
  if(at && planned && !isNaN(at.getTime()) && !isNaN(planned.getTime())){
    var m = Math.round((at.getTime() - planned.getTime()) / 60000);
    out.rows.push({ tone:"ok", t:"窗口比对", d:"计划 " + fmtReleaseTime(plan.plannedAt).slice(5, 16) + " → 实际 " + fmtReleaseTime(form.occurredAt).slice(5, 16)
      + (m === 0 ? "（一致）" : "（" + (m > 0 ? "晚" : "早") + " " + fmtGap(m) + "）") });
  }else{
    out.rows.push({ tone:"ok", t:"窗口比对", d:"计划未定窗口，按实际时间记录" });
  }
  var ids = actualIds().length, plannedScope = scopeTaskIds().length;
  out.rows.push({ tone:"ok", t:"范围比对", d:"本版本计划内 " + ids + " 项，本次按计划登记 " + ids + " 项" + (plannedScope > ids ? "（另有 " + (plannedScope - ids) + " 项不在计划）" : "") });
  return out;
}
function fmtGap(m){
  var abs = Math.abs(m);
  if(abs < 60) return abs + " 分钟";
  if(abs < 1440){
    var h = Math.floor(abs / 60), mi = abs % 60;
    return h + " 小时" + (mi ? " " + mi + " 分钟" : "");
  }
  var d = Math.floor(abs / 1440), hr = Math.round((abs % 1440) / 60);
  return d + " 天" + (hr ? " " + hr + " 小时" : "");
}
function compareHTML(){
  return compareState().rows.map(function(r){
    return '<div class="record-chk is-' + r.tone + '"><span class="record-chk-i">' + (r.tone === "ok" ? "✓" : "!") + '</span>'
      + '<span class="record-chk-tx"><b>' + esc(r.t) + '</b><span>' + esc(r.d) + '</span></span>'
      + '<span class="tag ' + (r.tone === "ok" ? "tag-success" : "tag-warning") + '">' + (r.tone === "ok" ? "通过" : "有偏差") + '</span></div>';
  }).join("");
}
function affectsRows(){
  var plan = selectedPlan();
  var versions = plan ? (plan.versions || []).map(function(v){ return v.versionName; }).filter(Boolean) : [];
  var count = plan ? (Number(plan.versionCount) || versions.length || 1) : 1;
  var released = plan ? Number(plan.releasedVersionCount) || 0 : 0;
  var isProd = form.environment === "production";
  var counts = isProd && form.result === "success" && plan;
  var list = [];
  list.push(["计划", plan ? planDisplayName(plan) : "计划外发布"]);
  list.push(["覆盖版本", plan && count > 1 ? count + " 个版本（" + (versions.slice(0, 2).join(" / ") || "跨项目") + (versions.length > 2 ? " 等" : "") + "）" : "单版本 · " + (ver ? ver.name : "")]);
  list.push(["登记范围", actualIds().length + " 项工作项"]);
  list.push(["结果口径", !isProd
    ? "只留" + releaseEnvironmentName(form.environment) + "环境事实，不计入生产发布"
    : form.result === "failed" ? "只留失败事实，不计入已上线"
      : form.result === "rollback" ? "只留回滚事实，不计入已发布"
        : "计入「已发布」：本版本新增一次生产成功记录"]);
  list.push(["计划收口", !plan ? "计划外记录不触发计划收口"
    : count > 1 ? "覆盖 " + count + " 个版本，全部生产成功后自动完成（已发 " + released + "/" + count + "）"
      : counts ? "本版本生产成功后，计划由发布记录自动收口为「已完成」"
        : "本版本生产成功后，计划由发布记录自动收口为「已完成」"]);
  return list;
}
function affectsHTML(){
  return affectsRows().map(function(row){
    return '<div class="record-affect"><span>' + esc(row[0]) + '</span><b>' + esc(row[1]) + '</b></div>';
  }).join("");
}
function render(){
  var lock = canPublish() ? ""
    : '<div class="record-lock">' + iconText("alert") + '当前身份只能查看发布事实；记录发布需空间主 / 管理员或项目负责人。</div>';
  host.innerHTML = '<div class="record-page">'
    + '<div class="record-crumbs"><button class="record-back" type="button" data-rec-back>← ' + esc(ver.name) + ' / 发布</button><span>/</span><span>记录发布</span></div>'
    + '<div class="record-grid">'
    + '<section class="panel record-card">'
    + '<div class="panel-head"><h3>记录发布</h3><span class="meta-right">' + esc(ver.name) + ' · ' + esc(releaseEnvironmentName(form.environment)) + '</span></div>'
    + lock
    + '<div id="recError" class="record-error"' + (errorMsg ? "" : " hidden") + ' role="alert">' + esc(errorMsg) + '</div>'
    + '<div class="record-body">'
    /* ① 计划 */
    + '<section class="record-sec"><div class="record-sec-h"><span class="record-no">1</span><div><b>这次发布关联哪个计划？</b>'
    + '<p>关联计划可自动核对偏差。已完成计划不可复用；不关联记为「计划外发布」。</p></div></div>'
    + '<label class="record-fld"><span>关联计划<i class="req">*</i></span>'
    + '<select data-rec-plan aria-label="关联发布计划">' + planOptionsHTML() + '</select></label></section>'
    /* ② 结果 */
    + '<section class="record-sec"><div class="record-sec-h"><span class="record-no">2</span><div><b>发布结果是什么？</b>'
    + '<p>成功、失败、回滚都算一次发布事实，都会保留。</p></div></div>'
    + '<div class="record-two">'
    + '<div class="record-fld"><span>环境<i class="req">*</i></span><div class="radio-cards" role="group" aria-label="发布环境">' + envCardsHTML() + '</div></div>'
    + '<div class="record-fld"><span>结果<i class="req">*</i></span><div class="radio-cards" role="group" aria-label="发布结果">' + resultCardsHTML() + '</div></div>'
    + '</div>'
    + '<div class="record-three">'
    + '<label class="record-fld"><span>发布时间<i class="req">*</i></span>'
    + '<input type="datetime-local" data-rec-time value="' + esc(form.occurredAt) + '" aria-label="发布发生时间"></label>'
    + '<label class="record-fld"><span>执行人<i class="req">*</i></span>'
    + '<select data-rec-owner aria-label="实际执行人">' + ownerOptionsHTML() + '</select></label>'
    + '<label class="record-fld"><span>制品 / SHA</span>'
    + '<input type="text" data-rec-artifact value="' + esc(form.artifactRef) + '" placeholder="例：build-486 或 9f3e2c1；手动记录可填 manual" maxlength="500" aria-label="制品标识"></label>'
    + '</div>'
    + '<label class="record-fld" id="recFailWrap"' + (form.result === "failed" ? "" : " hidden") + '><span>失败原因<i class="req">*</i></span>'
    + '<textarea rows="2" data-rec-failure placeholder="例：数据库迁移脚本超时">' + esc(form.failureReason) + '</textarea></label>'
    + '<label class="record-fld" id="recRelatedWrap"' + (form.result === "rollback" ? "" : " hidden") + '><span>回滚到哪次成功发布<i class="req">*</i></span>'
    + '<select data-rec-related aria-label="被引用的成功发布记录">' + relatedOptionsHTML() + '</select></label>'
    + '</section>'
    /* ③ 与计划比对 */
    + '<section class="record-sec"><div class="record-sec-h"><span class="record-no">3</span><div><b>和计划一致吗？</b>'
    + '<p>系统自动与所选计划比对；不一致的项必须填理由，理由进入发布记录。</p></div></div>'
    + '<div class="record-compare" id="recCompare">' + compareHTML() + '</div>'
    + '<label class="record-fld" id="recReasonWrap"><span>偏差理由<i class="opt" id="recReasonOpt">有偏差时必填</i></span>'
    + '<textarea rows="2" data-rec-deviation placeholder="例：按 12-06 评审结论使用 #482 制品，运营配置随下个计划发布……">' + esc(form.deviationReason) + '</textarea>'
    + '<em class="record-err" id="recReasonErr" hidden>有偏差时必须填写理由，否则无法保存</em></label>'
    + '</section>'
    + '</div>'
    + '<div class="record-foot"><button class="btn" type="button" data-rec-back>取消</button><span class="sp"></span>'
    + '<span class="hint">保存后出现在发布记录，并通知关注成员</span>'
    + '<button class="btn primary" type="button" data-rec-save' + (canPublish() ? "" : " disabled") + '>' + (canPublish() ? "保存发布记录" : "无记录发布权限") + '</button></div>'
    + '</section>'
    + '<aside class="record-side">'
    + '<section class="panel"><div class="panel-head"><h3>填写说明</h3></div><div class="record-help">'
    + '<p>· 记录的是<b>已经发生的事</b>，不是计划；填之前确认发布动作已执行。</p>'
    + '<p>· 发布成功 ≠ 工作项自动完成，完成状态仍由负责人流转。</p>'
    + '<p>· 记错了不能改这条记录，追加一条「回滚」或「失败」记录说明。</p>'
    + '<p>· 生产成功且非回滚时，覆盖版本的计划自动收口「已完成」。</p>'
    + '</div></section>'
    + '<section class="panel"><div class="panel-head"><h3>本次发布将计入</h3></div><div class="record-affects" id="recAffects">' + affectsHTML() + '</div></section>'
    + '</aside>'
    + '</div></div>';
  wire();
}
function iconText(name){
  /* 轻量内嵌图标：只用于权限提示，不引入额外依赖 */
  if(name !== "alert") return "";
  return '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8v3.8M8 11.1v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

/* ==================== 交互 ==================== */

function readInputs(){
  if(!host) return;
  var el;
  if((el = host.querySelector("[data-rec-plan]"))) form.planId = el.value || "";
  if((el = host.querySelector("[data-rec-time]"))) form.occurredAt = el.value || "";
  if((el = host.querySelector("[data-rec-owner]"))) form.executorUserId = el.value || "";
  if((el = host.querySelector("[data-rec-artifact]"))) form.artifactRef = el.value || "";
  if((el = host.querySelector("[data-rec-failure]"))) form.failureReason = el.value || "";
  if((el = host.querySelector("[data-rec-deviation]"))) form.deviationReason = el.value || "";
  if((el = host.querySelector("[data-rec-related]"))) form.relatedReleaseId = el.value || "";
}
function paintEnv(){
  host.querySelectorAll("[data-rec-env-val]").forEach(function(b){
    var on = b.getAttribute("data-rec-env-val") === form.environment;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  var meta = host.querySelector(".record-card .panel-head .meta-right");
  if(meta) meta.textContent = ver.name + " · " + releaseEnvironmentName(form.environment);
}
function paintResult(){
  host.querySelectorAll("[data-rec-result-val]").forEach(function(b){
    var on = b.getAttribute("data-rec-result-val") === form.result;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  var fail = host.querySelector("#recFailWrap");
  if(fail) fail.hidden = form.result !== "failed";
  var rel = host.querySelector("#recRelatedWrap");
  if(rel) rel.hidden = form.result !== "rollback";
  if(form.result === "rollback"){
    var sel = host.querySelector("[data-rec-related]");
    if(sel) sel.innerHTML = relatedOptionsHTML();
  }
}
function paintCompare(){
  var box = host.querySelector("#recCompare");
  if(box) box.innerHTML = compareHTML();
  var opt = host.querySelector("#recReasonOpt");
  var devs = compareState().deviations;
  if(opt) opt.textContent = devs.length ? "本次有偏差，必填" : "有偏差时必填";
}
function paintAffects(){
  var box = host.querySelector("#recAffects");
  if(box) box.innerHTML = affectsHTML();
}
function clearError(){
  errorMsg = "";
  var box = host.querySelector("#recError");
  if(box){ box.hidden = true; box.textContent = ""; }
}
function showError(msg, focusSel){
  readInputs();
  errorMsg = msg;
  var box = host.querySelector("#recError");
  if(box){ box.hidden = false; box.textContent = msg; }
  if(focusSel){
    var el = host.querySelector(focusSel);
    if(el){
      try{ el.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(e){ /* noop */ }
      try{ el.focus({ preventScroll:true }); }catch(e2){ /* noop */ }
    }
  }
}
function wire(){
  host.querySelector("[data-rec-plan]").addEventListener("change", function(e){
    readInputs();
    var plan = selectedPlan();
    if(plan) form.environment = plan.environment || "production";
    syncRelated(true);
    paintEnv(); paintCompare(); paintAffects();
    clearError();
  });
  host.addEventListener("click", function(e){
    var envBtn = e.target.closest("[data-rec-env-val]");
    if(envBtn){
      readInputs();
      form.environment = envBtn.getAttribute("data-rec-env-val");
      syncRelated(true);
      paintEnv(); paintResult(); paintCompare(); paintAffects();
      clearError();
      return;
    }
    var resBtn = e.target.closest("[data-rec-result-val]");
    if(resBtn){
      readInputs();
      form.result = resBtn.getAttribute("data-rec-result-val");
      if(form.result !== "failed"){ form.failureReason = ""; var f = host.querySelector("[data-rec-failure]"); if(f) f.value = ""; }
      if(form.result === "rollback") syncRelated(true);
      paintResult(); paintAffects();
      clearError();
      return;
    }
    if(e.target.closest("[data-rec-back]")){ leave(); return; }
    if(e.target.closest("[data-rec-retry]")){ load(parseRoute() || {}); return; }
    if(e.target.closest("[data-rec-save]")){ save(); return; }
  });
  host.addEventListener("input", function(e){
    if(!e.target.matches("[data-rec-deviation]")) return;
    var err = host.querySelector("#recReasonErr");
    if(err) err.hidden = true;
    clearError();
  });
  host.addEventListener("change", function(e){
    if(!e.target.matches("[data-rec-related]")) return;
    readInputs();
    paintCompare();
  });
}

/* ==================== 保存 ==================== */

function validate(){
  readInputs();
  if(!form.occurredAt) return { msg:"请填写发布发生时间", sel:"[data-rec-time]" };
  var at = new Date(form.occurredAt);
  if(isNaN(at.getTime())) return { msg:"发布时间格式不正确", sel:"[data-rec-time]" };
  if(at.getTime() > Date.now() + 60000) return { msg:"发布时间不能晚于当前时间；记录的是已经发生的事", sel:"[data-rec-time]" };
  if(!form.executorUserId) return { msg:"请选择实际执行人", sel:"[data-rec-owner]" };
  if(!form.artifactRef.trim()) return { msg:"请填写制品标识；手动记录可填 manual", sel:"[data-rec-artifact]" };
  if(!actualIds().length) return { msg:"该版本还没有可登记的工作项，先在工作项页补齐再记录发布", sel:"" };
  if(form.result === "failed" && !form.failureReason.trim()) return { msg:"记录失败必须填写失败原因", sel:"[data-rec-failure]" };
  if(form.result === "rollback"){
    if(!rollbackCandidates().length) return { msg:"当前环境没有可引用的成功发布记录，无法记录回滚", sel:"" };
    if(!form.relatedReleaseId) return { msg:"请选择回滚要引用的成功发布记录", sel:"[data-rec-related]" };
  }
  if(compareState().deviations.length && !form.deviationReason.trim()){
    var err = host.querySelector("#recReasonErr");
    if(err) err.hidden = false;
    return { msg:"有偏差时必须填写理由，否则无法保存", sel:"[data-rec-deviation]", reason:true };
  }
  return null;
}
function releaseBody(){
  var plan = selectedPlan();
  return {
    planId: plan ? plan.id : null,
    occurredAt: new Date(form.occurredAt).toISOString(),
    environment: form.environment,
    targetKeys: plan && (plan.targetKeys || []).length ? plan.targetKeys.slice() : ["手动记录"],
    coverage: (plan && plan.coverage) || "unknown",
    artifactRef: form.artifactRef.trim(),
    operation: form.result === "rollback" ? "rollback" : "deploy",
    relatedReleaseId: form.result === "rollback" ? form.relatedReleaseId : null,
    executorUserId: form.executorUserId,
    actualTaskIds: actualIds(),
    deviationReason: form.deviationReason.trim() || null
  };
}
function idemKey(){
  return window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : "release-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}
function setBusy(on){
  busy = on;
  var b = host.querySelector("[data-rec-save]");
  if(b){ b.disabled = on || !canPublish(); b.textContent = on ? "保存中…" : (canPublish() ? "保存发布记录" : "无记录发布权限"); }
}
function save(){
  if(busy || !canPublish()) return;
  clearError();
  var bad = validate();
  if(bad){ showError(bad.msg, bad.sel); return; }
  var base = "/api/versions/" + encodeURIComponent(versionId);
  var body = releaseBody();
  setBusy(true);
  API.post(base + "/release-preview", body).then(function(rs){
    if(!rs || !rs.scopeToken) throw new Error("预览未返回范围令牌，不能确认");
    if((rs.requiresDeviationReason || rs.canPublish === false) && !body.deviationReason){
      var err = host.querySelector("#recReasonErr");
      if(err) err.hidden = false;
      var why = (rs.warnings || []).slice(0, 3).join("；");
      var check = rs.testCheck || {};
      if(!why && check.verdict && check.verdict !== "pass"){
        why = (check.blockers || []).concat(check.reminders || []).slice(0, 3).join("；");
      }
      throw { userMessage: why
        ? "预览提示：" + why + "。填写偏差理由后再保存"
        : "预览未通过：本次事实存在异常，需填写偏差理由后重新预览", sel:"[data-rec-deviation]" };
    }
    var plan = selectedPlan();
    var confirm = Object.assign({}, body, {
      result: form.result === "failed" ? "failed" : "success",
      failureReason: form.result === "failed" ? form.failureReason.trim() : null,
      notes: "",
      planRevision: rs.planRevision == null ? (plan ? plan.revision : null) : rs.planRevision,
      scopeToken: rs.scopeToken,
      idempotencyKey: idemKey()
    });
    return API.post(base + "/release", confirm).then(function(record){
      toast("发布已记录：" + releaseEnvironmentName(record.environment) + " · "
        + (record.result === "success" ? "成功" : "失败")
        + (record.operation === "rollback" ? " · 回滚" : "") + "（事实已保存，不可修改）", "fs");
      window.dispatchEvent(new CustomEvent("ds:delivery-changed", { detail:{ reqId:reqId } }));
      leave();
    });
  }).catch(function(ex){
    if(!ex) return;
    if(ex.userMessage){
      showError(ex.userMessage, ex.sel);
    }else{
      showError(ex.message || "保存失败，请稍后重试；若响应不确定请先在发布记录里核对");
    }
  }).then(function(){ setBusy(false); });
}

/* ==================== 入口 ==================== */

export function enterRecordView(){
  host = document.getElementById("recordBody");
  if(!host) return;
  var route = parseRoute();
  if(!route || !route.versionId){
    host.innerHTML = '<div class="record-page"><div class="panel"><div class="panel-head"><h3>记录发布</h3></div>'
      + '<div class="stack"><p class="hint">缺少版本参数，请从版本详情的「发布」页签进入。</p>'
      + '<div class="rel-empty-acts"><button class="btn sm" type="button" data-rec-back>去版本列表</button></div></div></div></div>';
    var back = host.querySelector("[data-rec-back]");
    if(back) back.addEventListener("click", function(){ showView("phase"); });
    return;
  }
  load(route);
}
export function refreshFromHash(){
  var route = parseRoute();
  if(!route || !route.versionId){ enterRecordView(); return; }
  if(route.versionId === versionId && (route.planId || "") === (form.planId || "")
    && (route.reqId || "") === (reqId || "")) return;
  load(route);
}
export { leave as backFromRecord };
