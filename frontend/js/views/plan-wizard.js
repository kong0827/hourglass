/* views/plan-wizard · 新建发布计划 4 步向导（#/plan-wizard?from=&anchor=&reqId=&ids=）
   步骤：1 基本信息（名称/环境/窗口/跨项目覆盖版本）→ 2 发布内容（勾需求自动携带未完成工作项）
   → 3 窗口与通知（执行人/覆盖与目标键/备注/风险）→ 4 就绪检查（逐版本真实检查，例外说明）。
   保存仍走同一发布计划接口 POST /api/versions/{anchor}/release-plans，不另造一份计划模型。 */

import { API } from "../core/api.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { loadView } from "../core/view-loader.js";
import { versionStatusTagHTML, priTagHTML } from "../lib/format.js";

var host = null;
var W = null;

function blankWizard(){
  return {
    step: 1, maxStep: 1,
    from: "plans", anchor: "", reqId: "", ids: [],
    showOff: false, name: "", env: "production", plannedAt: "",
    owner: "", notes: "", risks: "", coverage: "full", targets: "",
    demandSel: {}, exception: "",
    versions: null, versionsError: "",
    demands: null, tasks: null, contentError: "", contentKey: "",
    members: null, membersError: "",
    checks: null, checksLoading: false, checksKey: "", checksError: "",
    saving: false
  };
}

function parseWizardRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "plan-wizard") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  return {
    from: p.get("from") || "plans",
    anchor: p.get("anchor") || "",
    reqId: p.get("reqId") || "",
    ids: String(p.get("ids") || "").split(",").filter(Boolean)
  };
}

export function openPlanWizard(opts){
  var o = opts || {};
  var p = new URLSearchParams();
  p.set("from", o.from || "plans");
  if(o.anchor) p.set("anchor", o.anchor);
  if(o.reqId) p.set("reqId", o.reqId);
  if(o.ids && o.ids.length) p.set("ids", o.ids.join(","));
  var h = "#/plan-wizard?" + p.toString();
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("plan-wizard");
}

/* ---------- 基础工具 ---------- */

function versionsById(){
  var map = {};
  (W.versions || []).forEach(function(r){ map[r.versionId] = r; });
  return map;
}
function projectCount(){
  var seen = {}, n = 0;
  W.ids.forEach(function(id){
    var r = versionsById()[id];
    if(r && !seen[r.reqId]){ seen[r.reqId] = 1; n++; }
  });
  return n;
}
function selectedRows(){
  var map = versionsById();
  return W.ids.map(function(id){ return map[id]; }).filter(Boolean);
}
function offStatus(st){ return st === "released" || st === "closed" || st === "canceled"; }
function selectable(r){
  return !!r && r.canManage === true && !offStatus(r.versionStatus);
}
function offReason(r){
  if(!r) return "";
  if(r.versionStatus === "released") return "已发布不可选";
  if(r.versionStatus === "closed") return "已关闭不可选";
  if(r.versionStatus === "canceled") return "已取消不可选";
  if(r.canManage !== true) return "只读项目不可选";
  return "";
}
function dayText(d){ return d ? String(d).slice(0, 10) : "目标日期未定"; }
function taskDone(t){ return t && t.boardColumn === "done"; }
function lines(text){
  return String(text || "").split("\n").map(function(s){ return s.trim(); }).filter(Boolean);
}
function versionName(id){
  var r = versionsById()[id];
  return r ? r.versionName : id;
}
function tasksOfDemand(id){
  return (W.tasks || []).filter(function(t){ return t.demandId === id; });
}
function plannedTaskIds(){
  var ids = {}, out = [];
  (W.demands || []).forEach(function(d){
    if(!W.demandSel[d.id]) return;
    tasksOfDemand(d.id).forEach(function(t){
      if(taskDone(t) || ids[t.id]) return;
      ids[t.id] = 1; out.push(t.id);
    });
  });
  return out;
}

/* ---------- 数据加载 ---------- */

function loadVersions(){
  var my = ++loadVersions.seq;
  W.versions = null; W.versionsError = "";
  render();
  API.get("/api/versions/cross-project").then(function(rows){
    if(my !== loadVersions.seq || !W) return;
    W.versions = rows || [];
    var allow = {};
    W.versions.forEach(function(r){ if(selectable(r)) allow[r.versionId] = 1; });
    W.ids = W.ids.filter(function(id){ return allow[id]; });
    if(!W.ids.length && W.anchor && allow[W.anchor]) W.ids = [W.anchor];
    render();
    if(W.ids.length) loadContent();
  }).catch(function(ex){
    if(my !== loadVersions.seq || !W) return;
    W.versions = [];
    W.versionsError = ex.message || "版本加载失败";
    render();
  });
}
loadVersions.seq = 0;

function defaultOwner(){
  if(!W || W.owner || !Array.isArray(W.members)) return;
  var me = (rt.currentUser || {}).id;
  if(me && W.members.some(function(m){ return (m.userId || m.id) === me; })){
    W.owner = me;
    render();
  }
}
window.addEventListener("ds:user-ready", function(){
  if(!W) return;
  if(!W.members || !W.members.length) loadMembers();
  else defaultOwner();
});

function loadMembers(){
  var wsId = (rt.currentWs || {}).id;
  /* 深链首屏可能早于空间确定：保持「加载中」并在短间隔内重试，别把空成员列表当成结果 */
  if(!wsId){
    W.members = null;
    if(loadMembers.tries < 20){
      loadMembers.tries++;
      setTimeout(function(){ if(W && W.members === null) loadMembers(); }, 250);
    }
    return;
  }
  loadMembers.tries = 0;
  API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/members").then(function(rows){
    if(!W) return;
    W.members = rows || [];
    defaultOwner();
    render();
  }).catch(function(ex){
    if(!W) return;
    W.members = [];
    W.membersError = ex.message || "成员加载失败";
    render();
  });
}
loadMembers.tries = 0;

function loadContent(){
  if(!W || !W.ids.length){ return; }
  var key = W.ids.slice().sort().join(",");
  var my = ++loadContent.seq;
  W.contentKey = key; W.contentError = "";
  W.demands = null; W.tasks = null;
  render();
  var rows = selectedRows();
  var reqIds = [];
  rows.forEach(function(r){ if(reqIds.indexOf(r.reqId) === -1) reqIds.push(r.reqId); });
  var demandCalls = reqIds.map(function(reqId){
    return API.getAllPages("/api/demands", { reqId: reqId }).catch(function(){ return { __error: true }; });
  });
  Promise.all([
    Promise.all(demandCalls),
    API.get("/api/release-plan-tasks", { versionIds: W.ids })
  ]).then(function(rs){
    if(my !== loadContent.seq || !W || W.contentKey !== key) return;
    var failed = rs[0].some(function(x){ return x && x.__error; });
    var byVersion = {};
    rows.forEach(function(r){ byVersion[r.versionId] = r; });
    var demands = [];
    rs[0].forEach(function(list){
      if(!Array.isArray(list)) return;
      list.forEach(function(d){
        if(!byVersion[d.versionId]) return;
        if(d.status === "closed" || d.status === "rej" || d.status === "canceled" || d.status === "cancelled") return;
        d._project = byVersion[d.versionId].projectName;
        d._version = byVersion[d.versionId].versionName;
        demands.push(d);
      });
    });
    demands.sort(function(a, b){
      return String(a._project).localeCompare(String(b._project), "zh")
        || String(a._version).localeCompare(String(b._version), "zh")
        || (Number(a.demandNo) || 0) - (Number(b.demandNo) || 0);
    });
    var alive = {};
    demands.forEach(function(d){ alive[d.id] = 1; });
    Object.keys(W.demandSel).forEach(function(id){ if(!alive[id]) delete W.demandSel[id]; });
    W.demands = demands;
    W.tasks = Array.isArray(rs[1]) ? rs[1] : [];
    if(failed) W.contentError = "部分项目的需求加载失败，未列出的需求可能属于加载失败的项目";
    render();
  }).catch(function(ex){
    if(my !== loadContent.seq || !W) return;
    W.demands = []; W.tasks = [];
    W.contentError = ex.message || "需求与工作项加载失败";
    render();
  });
}
loadContent.seq = 0;

function loadChecks(){
  if(!W || !W.ids.length) return Promise.resolve();
  var key = W.ids.slice().sort().join(",");
  if(W.checksKey === key && W.checks) return Promise.resolve();
  var my = ++loadChecks.seq;
  W.checksLoading = true; W.checksError = ""; W.checks = null; W.checksKey = key;
  render();
  return Promise.all(W.ids.map(function(id){
    return API.get("/api/versions/" + encodeURIComponent(id) + "/release-check")
      .then(function(r){ return { id: id, data: r || {} }; })
      .catch(function(ex){ return { id: id, error: ex.message || "检查失败" }; });
  })).then(function(rows){
    if(my !== loadChecks.seq || !W) return;
    W.checks = rows;
    W.checksLoading = false;
    render();
  });
}
loadChecks.seq = 0;

/* ---------- 渲染 ---------- */

var STEPS = [
  { n: 1, t: "1 基本信息", d: "名称、环境、窗口、覆盖版本" },
  { n: 2, t: "2 发布内容", d: "本计划打算交付的需求与工作项" },
  { n: 3, t: "3 窗口与通知", d: "执行人、覆盖范围、备注" },
  { n: 4, t: "4 就绪检查", d: "自动校验，标为就绪后锁定" }
];

function selectedDemandList(){
  return (W.demands || []).filter(function(d){ return W.demandSel[d.id]; });
}
function stepDesc(s){
  if(s.n === 1 && (W.name.trim() || W.ids.length)){
    return (W.name.trim() || "未命名计划") + (W.ids.length ? " · " + projectCount() + " 个项目 " + W.ids.length + " 个版本" : "");
  }
  if(s.n === 2){
    var picked = selectedDemandList();
    if(picked.length){
      var names = [];
      picked.forEach(function(d){ if(names.indexOf(d._project) === -1) names.push(d._project); });
      return names.join(" + ") + " · " + picked.length + " 个需求";
    }
  }
  if(s.n === 3 && (W.plannedAt || W.owner)){
    var when = W.plannedAt ? W.plannedAt.replace("T", " ").slice(5) : "";
    var who = "";
    if(W.owner && W.members){
      var me = W.members.filter(function(m){ return (m.userId || m.id) === W.owner; })[0];
      if(me) who = "执行人 " + (me.displayName || me.username || W.owner);
    }
    return [when, who].filter(Boolean).join(" · ");
  }
  if(s.n === 4 && W.checks && !W.checksLoading){
    var agg = checkStats(W.checks);
    var bad = agg.blocks + agg.errors;
    if(bad) return "按版本分别校验 · " + bad + " 项未通过";
    if(agg.warns) return "按版本分别校验 · " + agg.warns + " 项提醒";
    return "逐版本校验 · 全部通过";
  }
  return s.d;
}
function railHTML(){
  return '<aside class="pw-rail"><div class="pw-rail-t">发布计划</div>'
    + STEPS.map(function(s){
      var on = W.step === s.n, done = s.n < W.step;
      return '<button type="button" class="pw-step' + (on ? " is-on" : "") + (done ? " is-done" : "")
        + '" data-pw-step="' + s.n + '"' + (s.n <= W.maxStep ? "" : " disabled") + '>'
        + '<span class="pw-n">' + (done ? "✓" : s.n) + '</span>'
        + '<span class="pw-step-tx"><b>' + esc(s.t) + '</b><i>' + esc(stepDesc(s)) + '</i></span></button>';
    }).join("")
    + '</aside>';
}

/* 只有单个文本控件才用 label 关联；分段按钮、版本清单这类复合控件用 div + span，
   否则点标题或清单空白会被 label 激活行为转发到第一个按钮 / 复选框。 */
function field(label, control, req, opt, ctlId){
  var tag = ctlId ? "label" : "span";
  return '<div class="pw-field"><' + tag + ' class="pw-label"' + (ctlId ? ' for="' + ctlId + '"' : "") + '>'
    + esc(label)
    + (req ? ' <em class="pw-req">*</em>' : "")
    + (opt ? ' <em class="pw-opt">' + esc(opt) + '</em>' : "") + '</' + tag + '>' + control + '</div>';
}

function step1HTML(){
  var sel = selectedRows();
  var projs = projectCount();
  var chips = sel.length
    ? sel.map(function(r){
      return '<span class="pw-chip">' + esc(r.projectName) + " · " + esc(r.versionName)
        + '<button type="button" class="pw-chip-x" data-pw-remove="' + esc(r.versionId) + '" aria-label="移除">✕</button></span>';
    }).join("")
    : '<span class="pw-muted">还没有选版本，从下面勾选（可按项目跨选）</span>';
  var summary = '<div class="pw-sum"><div class="pw-sum-t"><b>已选 ' + sel.length + ' 个版本 · 覆盖 ' + projs + ' 个项目</b>'
    + (projs > 1 ? '<span class="tag tag-info">跨项目计划</span>' : "") + '</div><div class="pw-chips">' + chips + '</div></div>';
  var list = versionListHTML();
  return '<div class="pw-pane"><div class="pw-hd"><h2>这个计划叫什么、发到哪？</h2>'
    + '<p>一个计划可以覆盖<b>多个版本、多个项目</b>——同一次生产窗口要发多个项目时，在下面一起勾选即可。'
    + '列表默认只显示计划中/进行中的版本；已发布、已关闭的版本不可选，需要时可展开查看。</p></div>'
    + '<div class="pw-form">'
    + field("计划名称", '<input class="input" type="text" id="pwfName" maxlength="120" data-pw-field="name" value="' + esc(W.name) + '" placeholder="例：12-08 多项目生产发布">', true, "", "pwfName")
    + '<div class="pw-grid2">'
    + field("目标环境", envHTML(), true)
    + field("计划窗口", '<input class="input" type="datetime-local" id="pwfPlannedAt" data-pw-field="plannedAt" value="' + esc(W.plannedAt) + '">', true, "预计执行时间", "pwfPlannedAt")
    + '</div>'
    + field("覆盖版本", '<div class="pw-vbox">' + summary + list + '</div>', true, "可勾多个 · 可按项目跨选")
    + '<p class="pw-help">跨项目勾选后，发布内容与就绪检查会按项目、按版本分别核对；记录发布时环境或覆盖范围与计划不一致，会要求填写偏差理由。</p>'
    + '</div></div>';
}

function envHTML(){
  return '<div class="pw-seg" role="radiogroup" aria-label="目标环境">'
    + [["test", "测试"], ["staging", "预发"], ["production", "生产"]].map(function(p){
      return '<button type="button" class="pw-seg-b' + (W.env === p[0] ? " is-on" : "") + '" data-pw-env="' + p[0] + '">' + p[1] + '</button>';
    }).join("") + '</div>';
}

function versionListHTML(){
  if(W.versions === null) return UI.skeletonRows(3);
  if(W.versionsError) return '<div class="pw-error">' + esc(W.versionsError) + ' <button class="btn sm" type="button" data-pw-retry-versions>重试</button></div>';
  if(!W.versions.length) return '<div class="pw-empty-s">还没有可选的版本：先在项目里新建版本，再回来做发布计划。</div>';
  var groups = [], groupIndex = {};
  W.versions.forEach(function(r){
    if(!groupIndex[r.reqId]){ groupIndex[r.reqId] = { reqId:r.reqId, name:r.projectName, rows:[], hidden:0 }; groups.push(groupIndex[r.reqId]); }
    groupIndex[r.reqId].rows.push(r);
  });
  var hiddenN = 0;
  var body = groups.map(function(g){
    var visible = g.rows.filter(function(r){
      var off = offStatus(r.versionStatus);
      var on = W.ids.indexOf(r.versionId) !== -1;
      if(off && !W.showOff && !on){ hiddenN++; return false; }
      return true;
    });
    if(!visible.length) return "";
    var readonly = g.rows.length && g.rows.every(function(r){ return r.canManage !== true; });
    return '<div class="pw-vgroup"><div class="pw-vgroup-h">' + esc(g.name)
      + (readonly ? ' <span class="tag tag-warning">只读</span>' : "") + '</div>'
      + visible.map(versionRowHTML).join("") + '</div>';
  }).join("");
  var more = hiddenN
    ? '<div class="pw-vmore">已隐藏 <b>' + hiddenN + '</b> 个已发布/已关闭/已取消版本（不可选，默认不展示）'
      + '<button type="button" class="lnk" data-pw-showoff>' + (W.showOff ? "收起" : "显示") + '</button></div>'
    : (W.showOff ? '<div class="pw-vmore"><button type="button" class="lnk" data-pw-showoff>收起已发布/已关闭版本</button></div>' : "");
  return body + more;
}

function versionRowHTML(r){
  var off = offStatus(r.versionStatus);
  var on = W.ids.indexOf(r.versionId) !== -1;
  var dis = off || r.canManage !== true;
  var reason = offReason(r);
  var stat = "";
  if(r.canManage === true && !off) stat = versionStatusTagHTML(r.versionStatus);
  var right = reason ? '<span class="tag">' + esc(reason) + '</span>' : stat;
  return '<label class="pw-vrow' + (dis ? " is-dis" : "") + (on ? " is-on" : "") + '">'
    + '<input type="checkbox" data-pw-version="' + esc(r.versionId) + '"' + (on ? " checked" : "") + (dis ? " disabled" : "") + '>'
    + '<span class="pw-vtx"><b>' + esc(r.versionName)
    + (r.versionId === W.anchor ? ' <span class="tag tag-info">当前版本</span>' : "") + '</b>'
    + '<i>' + esc(dayText(r.targetDate)) + ' · 工作项 ' + (Number(r.doneTaskCount) || 0) + '/' + (Number(r.taskCount) || 0) + '</i></span>'
    + right + '</label>';
}

function coverageBarHTML(){
  var chips = selectedRows().map(function(r){
    return '<span class="pw-chip is-static">' + esc(r.projectName) + " · " + esc(r.versionName) + '</span>';
  }).join("");
  return '<div class="pw-covbar"><span class="pw-covbar-l">覆盖版本</span>' + chips
    + (projectCount() > 1 ? '<span class="pw-covbar-hint">跨项目计划：按项目分别核对就绪</span>' : "")
    + '<button class="btn sm ghost pw-covbar-btn" type="button" data-pw-step="1">添加/调整版本</button></div>';
}
function step2HTML(){
  if(W.demands === null) return '<div class="pw-pane"><div class="pw-hd"><h2>这个计划交付什么？</h2></div><div class="pw-form">' + UI.skeletonRows(4) + '</div></div>';
  var rows = W.demands || [];
  var selN = Object.keys(W.demandSel).filter(function(k){ return W.demandSel[k]; }).length;
  var projs = {};
  rows.forEach(function(d){ if(W.demandSel[d.id]) projs[d._project] = 1; });
  var body;
  if(W.contentError){
    body = '<div class="pw-error">' + esc(W.contentError) + ' <button class="btn sm" type="button" data-pw-retry-content>重试</button></div>';
  }else if(!rows.length){
    body = '<div class="pw-empty"><b>覆盖的版本里还没有需求</b><p>先去版本里添加需求，再回来勾选发布内容。</p></div>';
  }else{
    body = '<div class="pw-table-wrap"><table class="pw-table"><thead><tr>'
      + '<th class="pw-col-ck"><input type="checkbox" data-pw-selectall aria-label="全选需求" title="全选 / 取消全选"'
      + (rows.length && selN === rows.length ? " checked" : "") + '></th>'
      + '<th>需求</th><th>优先级</th><th>携带工作项</th><th>完成度</th><th>用例覆盖</th>'
      + '</tr></thead><tbody>' + rows.map(demandRowHTML).join("") + '</tbody></table></div>';
  }
  return '<div class="pw-pane"><div class="pw-hd"><h2>这个计划交付什么？</h2>'
    + '<p>从覆盖的版本（可跨项目）勾内容。勾选需求会自动带上其下未完成的工作项；已完成后工作项不再进计划。</p></div>'
    + coverageBarHTML()
    + '<div class="pw-form"><div class="pw-card"><div class="pw-card-h"><b>发布内容</b>'
    + '<span class="pw-hint">已选 ' + selN + ' 个需求 · ' + Object.keys(projs).length + ' 个项目</span></div>'
    + body + '</div>'
    + '<p class="pw-help">勾不满没关系：就绪检查只提示缺口，不阻止存草稿。</p></div></div>';
}

function demandRowHTML(d){
  var tasks = tasksOfDemand(d.id);
  var open = tasks.filter(function(t){ return !taskDone(t); }).length;
  var done = tasks.length - open;
  var on = !!W.demandSel[d.id];
  var cases = Number(d.caseCount) || 0;
  return '<tr class="' + (on ? "is-on" : "") + '" data-pw-demand-open="' + esc(d.id) + '" tabindex="0" title="打开需求详情">'
    + '<td class="pw-col-ck"><input type="checkbox" data-pw-demand="' + esc(d.id) + '" aria-label="纳入「' + esc(d.title) + '」"' + (on ? " checked" : "") + '></td>'
    + '<td><b class="pw-dt">' + esc(d.title) + '</b><i class="pw-dsub"><span class="tag">' + esc(d._project) + '</span> ' + esc(d._version) + '</i></td>'
    + '<td>' + (d.priority ? priTagHTML(d.priority) : "—") + '</td>'
    + '<td>' + (tasks.length
      ? (on ? (open ? open + ' 项已自动携带' : '<span class="pw-muted">工作项均已完成</span>') : tasks.length + ' 项（未纳入）')
      : '<span class="pw-muted">未挂工作项</span>') + '</td>'
    + '<td>' + (tasks.length
      ? '<div class="progress mini' + (done === tasks.length ? " full" : "") + '"><span class="bar"><i style="width:'
        + Math.round(done / tasks.length * 100) + '%"></i></span><span class="pv">' + done + '/' + tasks.length + '</span></div>'
      : "—") + '</td>'
    + '<td>' + (cases ? (Number(d.casePassed) || 0) + '/' + cases : '<span class="pw-muted">无用例</span>') + '</td>'
    + '</tr>';
}

function step3HTML(){
  var members = W.members;
  var ownerControl;
  if(members === null){
    ownerControl = '<span class="pw-muted">成员加载中…</span>';
  }else if(W.membersError){
    ownerControl = '<span class="pw-error-s">' + esc(W.membersError) + '</span>';
  }else{
    ownerControl = '<select class="select" id="pwfOwner" data-pw-field="owner"><option value="">请选择执行人</option>'
      + members.map(function(m){
        var id = m.userId || m.id || "";
        var name = m.displayName || m.username || id;
        return '<option value="' + esc(id) + '"' + (W.owner === id ? " selected" : "") + '>' + esc(name) + '</option>';
      }).join("") + '</select>';
  }
  return '<div class="pw-pane"><div class="pw-hd"><h2>谁来执行、交付范围怎么算？</h2>'
    + '<p>执行人负责到窗口执行并回来记录发布；覆盖范围与目标键会与发布记录逐项比对。</p></div>'
    + '<div class="pw-form pw-narrow">'
    + field("执行人", ownerControl, true, "", "pwfOwner")
    + field("覆盖范围", coverageHTML(), true, "全量 / 部分需填写目标键")
    + field("目标键", '<textarea class="textarea" rows="3" id="pwfTargets" data-pw-field="targets" placeholder="一行一个，例：api-gateway / web-app">' + esc(W.targets) + '</textarea>', false, "覆盖为全量/部分时必填", "pwfTargets")
    + field("备注", '<textarea class="textarea" rows="3" id="pwfNotes" data-pw-field="notes" placeholder="例：窗口内避开对账任务；回滚走预案 A">' + esc(W.notes) + '</textarea>', false, "", "pwfNotes")
    + field("风险提示", '<textarea class="textarea" rows="2" id="pwfRisks" data-pw-field="risks" placeholder="例：结算中心依赖第三方对账接口，失败时先降级">' + esc(W.risks) + '</textarea>', false, "", "pwfRisks")
    + '</div></div>';
}

function coverageHTML(){
  return '<div class="pw-seg" role="radiogroup" aria-label="覆盖范围">'
    + [["full", "全量"], ["partial", "部分"], ["unknown", "未知"]].map(function(p){
      return '<button type="button" class="pw-seg-b' + (W.coverage === p[0] ? " is-on" : "") + '" data-pw-coverage="' + p[0] + '">' + p[1] + '</button>';
    }).join("") + '</div>';
}

function checkStats(rows){
  var blocks = 0, warns = 0, errors = 0, worst = "pass";
  (rows || []).forEach(function(x){
    if(x.error){ errors++; worst = "block"; return; }
    var d = x.data || {};
    blocks += (d.blockers || []).length;
    warns += (d.reminders || []).length;
    if(d.verdict === "block") worst = "block";
    else if(d.verdict === "warn" && worst !== "block") worst = "warn";
  });
  return { blocks: blocks, warns: warns, errors: errors, worst: worst };
}

function step4HTML(){
  if(W.checksLoading || W.checks === null){
    return '<div class="pw-pane"><div class="pw-hd"><h2>计划可以执行了吗？</h2>'
      + '<p>「未通过」需要处理或写明理由才能标为就绪；「警告」不阻塞，执行时会再次提示。</p></div>'
      + '<div class="pw-form">' + UI.skeletonRows(4) + '</div></div>';
  }
  var agg = checkStats(W.checks);
  var tasks = plannedTaskIds();
  var demandsN = Object.keys(W.demandSel).filter(function(k){ return W.demandSel[k]; }).length;
  var bad = agg.blocks + agg.errors;
  var banner = '<div class="pw-banner is-' + (bad || agg.warns ? "warn" : "ok") + '"><div class="pw-banner-tx">'
    + (bad
      ? '<b>' + bad + ' 项未通过、' + agg.warns + ' 项提醒。</b>先处理未通过项，或在例外说明里写明理由；标为就绪后内容与环境锁定。'
      : agg.warns
        ? '<b>' + agg.warns + ' 项提醒，不阻塞。</b>标为就绪后执行时会再次提示；内容与环境将锁定。'
        : '<b>自动校验完成，全部通过。</b>标为就绪后内容与环境锁定，变更需新建计划或紧急记录。')
    + '</div>'
    + '<button class="btn sm" type="button" data-pw-criteria>查看检查口径</button></div>';
  var rows = '<div class="pw-check"><div class="pw-check-row is-ok"><span class="pw-ci">✓</span>'
    + '<span class="pw-ctx"><b>范围：' + projectCount() + ' 个项目 · ' + W.ids.length + ' 个版本</b>'
    + '<i>' + esc(selectedRows().map(function(r){ return r.projectName + " · " + r.versionName; }).join("、"))
    + '。跨项目计划按版本分别校验，互不合并。</i></span><span class="tag">已核对</span></div>'
    + '<div class="pw-check-row is-ok"><span class="pw-ci">✓</span>'
    + '<span class="pw-ctx"><b>计划内容：' + demandsN + ' 个需求 · ' + tasks.length + ' 个工作项</b>'
    + '<i>' + (tasks.length ? '只携带所选需求下未完成的工作项。' : '还没有勾选需求，或所选需求的工作项都已完成；就绪计划至少需要 1 个工作项。') + '</i></span>'
    + '<span class="tag">' + (tasks.length ? "已纳入" : "待补") + '</span></div>'
    + (W.checks || []).map(checkRowHTML).join("") + '</div>';
  return '<div class="pw-pane"><div class="pw-hd"><h2>计划可以执行了吗？</h2>'
    + '<p>「未通过」需要处理或写明理由才能标为就绪；「警告」不阻塞，执行时会再次提示。</p></div>'
    + '<div class="pw-form">' + banner + rows
    + field("例外说明", '<textarea class="textarea" rows="2" id="pwfException" data-pw-field="exception" placeholder="例：运营配置随下个计划发布，本次仅验证开关读取……">' + esc(W.exception) + '</textarea>', false, "有未通过项但仍要标就绪时必填，会写入计划备注", "pwfException")
    + '</div></div>';
}

function checkRowHTML(x){
  var r = versionsById()[x.id] || { projectName:"", versionName: versionName(x.id) };
  var title = r.projectName + " · " + r.versionName;
  if(x.error){
    return '<div class="pw-check-row is-block"><span class="pw-ci">✕</span>'
      + '<span class="pw-ctx"><b>' + esc(title) + '：检查失败</b><i>' + esc(x.error) + '</i></span>'
      + '<button class="btn sm" type="button" data-pw-goto="' + esc(x.id) + '">去处理</button></div>';
  }
  var d = x.data || {};
  var verdict = d.verdict || "pass";
  var cls = verdict === "block" ? "is-block" : verdict === "warn" ? "is-warn" : "is-ok";
  var icon = verdict === "block" ? "✕" : verdict === "warn" ? "!" : "✓";
  var detail = (d.blockers || []).concat((d.reminders || []).map(function(s){ return "提醒：" + s; }));
  var stats = [];
  if(Number(d.workItemsTotal)) stats.push("工作项 " + (Number(d.workItemsCovered) || 0) + "/" + d.workItemsTotal + " 有用例");
  if(Number(d.demandsTotal)) stats.push("需求 " + (Number(d.demandsCovered) || 0) + "/" + d.demandsTotal + " 有用例");
  if(Number(d.caseTotal)) stats.push("用例通过 " + (Number(d.casePassed) || 0) + "/" + d.caseTotal);
  var line = detail.length ? detail.join("；") : (stats.join(" · ") || "工作项完成、需求用例覆盖、窗口冲突与制品均无异常。");
  return '<div class="pw-check-row ' + cls + '"><span class="pw-ci">' + icon + '</span>'
    + '<span class="pw-ctx"><b>' + esc(title) + '：' + (verdict === "block" ? "有未通过项" : verdict === "warn" ? "有提醒" : "检查通过") + '</b>'
    + '<i>' + esc(line) + '</i></span>'
    + (verdict === "pass" ? '<span class="tag tag-success">通过</span>'
      : '<button class="btn sm" type="button" data-pw-goto="' + esc(x.id) + '">去处理</button>') + '</div>';
}

function readyBlockReason(){
  if(W.saving) return "保存中…";
  if(!W.name.trim()) return "请填写计划名称";
  if(!W.ids.length) return "请至少勾选 1 个版本";
  if(!W.plannedAt) return "请填写计划窗口";
  if(!W.owner) return "请选择执行人";
  if(!plannedTaskIds().length) return "至少勾选 1 个带未完成工作项的需求";
  if(W.coverage !== "unknown" && !lines(W.targets).length) return "覆盖为全量/部分时必须填写目标键，或把覆盖改为未知";
  if(W.checksLoading) return "就绪检查进行中";
  var agg = checkStats(W.checks);
  if(agg.errors) return "有版本就绪检查失败，请重试或去版本处理";
  if(agg.blocks && !W.exception.trim()) return "有 " + agg.blocks + " 项未通过：去处理或填写例外说明";
  return "";
}

var NEXT_TEXT = { 1:"下一步", 2:"下一步：窗口与通知", 3:"下一步：就绪检查", 4:"标为就绪" };
var FOOT_NOTE = {
  1:"· 标为就绪前都可回来修改",
  2:"· 已选内容可随时修改，标为就绪后锁定",
  3:"· 标为就绪后内容与环境锁定",
  4:"· 标为就绪后只能新建计划或紧急记录来变更"
};
function footHTML(){
  var atEnd = W.step === 4;
  var dis = atEnd ? readyBlockReason() : "";
  var nextLabel = W.saving ? "保存中…" : NEXT_TEXT[W.step];
  return '<div class="pw-foot"><span class="pw-note">第 ' + W.step + ' 步 / 共 4 步 ' + FOOT_NOTE[W.step] + '</span><span class="pw-spacer"></span>'
    + '<button class="btn" type="button" data-pw-prev' + (W.step === 1 || W.saving ? " disabled" : "") + '>上一步</button>'
    + '<button class="btn" type="button" data-pw-draft' + (W.saving ? " disabled" : "") + '>存为草稿</button>'
    + '<button class="btn primary" type="button" data-pw-next' + (dis ? " disabled" : "") + (dis ? ' title="' + esc(dis) + '"' : "") + '>' + nextLabel + '</button>'
    + '</div>';
}

function paneHTML(){
  if(W.step === 1) return step1HTML();
  if(W.step === 2) return step2HTML();
  if(W.step === 3) return step3HTML();
  return step4HTML();
}

function render(){
  if(!host || !W) return;
  syncHead();
  host.innerHTML = '<div class="pw">' + railHTML() + '<div class="pw-main">'
    + '<div class="pw-body">' + paneHTML() + '</div>' + footHTML() + '</div></div>';
  syncSelectAll();
}

function refocus(sel){
  var el = host && host.querySelector(sel);
  if(!el) return;
  try{ el.focus({ preventScroll:true }); }catch(e){ try{ el.focus(); }catch(e2){ /* noop */ } }
}

function syncSelectAll(){
  var box = host && host.querySelector("[data-pw-selectall]");
  if(!box) return;
  var rows = W.demands || [], selN = 0;
  rows.forEach(function(d){ if(W.demandSel[d.id]) selN++; });
  box.checked = rows.length > 0 && selN === rows.length;
  box.indeterminate = selN > 0 && selN < rows.length;
  box.disabled = !rows.length;
}

function syncHead(){
  if(document.body.dataset.view !== "plan-wizard") return;
  var title = document.getElementById("pageTitleText"), sub = document.getElementById("pageSub");
  var pill = document.getElementById("pagePill"), acts = document.getElementById("pageActions");
  var nw = document.getElementById("newWrap");
  if(title) title.textContent = "新建发布计划";
  if(sub) sub.textContent = "计划描述「打算什么时候、交付哪些内容」；一个计划可以跨项目覆盖多个版本。";
  if(pill){ pill.textContent = ""; pill.hidden = true; }
  if(acts){
    acts.innerHTML = '<button class="btn" type="button" data-pw-cancel>取消</button>';
    acts.hidden = false;
  }
  if(nw) nw.hidden = true;
  document.title = "新建发布计划 · 沙漏";
}

/* ---------- 交互 ---------- */

function gotoStep(n){
  if(!W || n < 1 || n > 4 || n > W.maxStep) return;
  W.step = n;
  render();
}

function validateStep1(){
  if(!W.name.trim()){ toast("请填写计划名称", "warn"); focusField("name"); return false; }
  if(!W.ids.length){ toast("请至少勾选 1 个版本", "warn"); return false; }
  if(!W.plannedAt){ toast("请填写计划窗口", "warn"); focusField("plannedAt"); return false; }
  return true;
}

function validateStep3(){
  if(!W.owner){ toast("请选择执行人", "warn"); return false; }
  if(W.coverage !== "unknown" && !lines(W.targets).length){
    toast("覆盖为全量/部分时必须填写至少 1 个目标键，或把覆盖改为未知", "warn");
    focusField("targets");
    return false;
  }
  return true;
}

function focusField(name){
  var el = host && host.querySelector('[data-pw-field="' + name + '"]');
  if(el) try{ el.focus(); }catch(e){ /* noop */ }
}

function next(){
  if(!W || W.saving) return;
  if(W.step === 1 && !validateStep1()) return;
  if(W.step === 3 && !validateStep3()) return;
  if(W.step < 4){
    W.step++;
    W.maxStep = Math.max(W.maxStep, W.step);
    render();
    if(W.step === 4) loadChecks();
    return;
  }
  var why = readyBlockReason();
  if(why){ toast(why, "warn"); return; }
  save("ready");
}

function draft(){
  if(!W || W.saving) return;
  if(!W.ids.length){ toast("草稿也至少要勾 1 个版本", "warn"); return; }
  if(W.coverage !== "unknown" && !lines(W.targets).length){
    toast("覆盖为全量/部分时必须填写至少 1 个目标键，或把覆盖改为未知", "warn");
    W.step = 3; render(); focusField("targets");
    return;
  }
  save("draft");
}

function save(status){
  if(!W || W.saving || !W.ids.length) return;
  W.saving = true; render();
  var anchor = W.ids.indexOf(W.anchor) >= 0 ? W.anchor : W.ids[0];
  var notes = W.notes.trim();
  if(W.exception.trim()) notes = (notes ? notes + "\n" : "") + "例外说明：" + W.exception.trim();
  var body = {
    versionIds: W.ids.slice(),
    plannedTaskIds: plannedTaskIds(),
    environment: W.env,
    targetKeys: lines(W.targets),
    coverage: W.coverage,
    plannedAt: W.plannedAt || null,
    ownerUserId: W.owner || null,
    notes: notes || null,
    risks: W.risks.trim() || null,
    status: status,
    name: W.name.trim() || null,
    reason: W.exception.trim() || null
  };
  API.post("/api/versions/" + encodeURIComponent(anchor) + "/release-plans", body).then(function(saved){
    if(!W) return;
    W.saving = false;
    toast(status === "ready" ? "计划「" + (W.name.trim() || versionName(anchor)) + "」已标为就绪" : "已存为草稿", "ok");
    afterSave(anchor, saved);
  }).catch(function(ex){
    if(!W) return;
    W.saving = false; render();
    toast(ex.message || "计划保存失败", "bad");
  });
}

function afterSave(anchor, saved){
  var planId = saved && saved.id ? saved.id : "";
  /* 原型：从哪进入退回哪——计划列表回列表、全部版本回跨项目选版、版本发布页回该版本发布页签 */
  if(W.from === "plans"){
    goHash("#/release");
    showView("release");
    return;
  }
  if(W.from === "phase"){
    goPhaseAll();
    return;
  }
  goVersion(anchor, W.reqId, "releases", planId);
}

function goPhaseAll(){
  goHash("#/phase?pmode=allversions");
  showView("phase");
}

function goHash(hash){
  try{ history.pushState(null, "", hash); }
  catch(e){ try{ window.location.hash = hash; }catch(e2){ /* noop */ } }
}

function goVersion(id, reqId, tab, planId){
  if(!id) return;
  var h = "#/version?id=" + encodeURIComponent(id);
  if(reqId) h += "&reqId=" + encodeURIComponent(reqId);
  if(tab) h += "&tab=" + encodeURIComponent(tab);
  if(planId) h += "&plan=" + encodeURIComponent(planId);
  goHash(h);
  showView("version");
}

function cancel(){
  if(!W) return;
  if(W.from === "plans" || (!W.anchor && W.from !== "phase")){
    goHash("#/release");
    showView("release");
    return;
  }
  if(W.from === "phase"){
    goPhaseAll();
    return;
  }
  goVersion(W.anchor, W.reqId, "releases");
}

function toggleId(id, on){
  if(on && W.ids.indexOf(id) === -1) W.ids.push(id);
  if(!on) W.ids = W.ids.filter(function(x){ return x !== id; });
  W.demandSel = {};
  W.checksKey = ""; W.checks = null;
  render();
  if(W.ids.length) loadContent();
  else W.demands = W.tasks = null;
}

function openDemand(id){
  loadView("demands").then(function(m){ m.openDemandDetailById(id); })
    .catch(function(ex){ toast(ex.message || "打开需求详情失败", "bad"); });
}

function bind(){
  if(!host || host.__pwWired) return;
  host.__pwWired = true;
  host.addEventListener("click", function(e){
    if(!W || !e.target.closest) return;
    var row = e.target.closest("[data-pw-demand-open]");
    if(row){
      if(e.target.closest("input,button,a,td.pw-col-ck")) return;
      openDemand(row.getAttribute("data-pw-demand-open"));
      return;
    }
    var t = e.target.closest("button,[data-pw-goto]");
    if(!t) return;
    if(t.hasAttribute("data-pw-step")){ gotoStep(Number(t.getAttribute("data-pw-step"))); return; }
    if(t.hasAttribute("data-pw-env")){ W.env = t.getAttribute("data-pw-env"); render(); return; }
    if(t.hasAttribute("data-pw-coverage")){ W.coverage = t.getAttribute("data-pw-coverage"); render(); return; }
    if(t.hasAttribute("data-pw-remove")){ toggleId(t.getAttribute("data-pw-remove"), false); return; }
    if(t.hasAttribute("data-pw-showoff")){ W.showOff = !W.showOff; render(); return; }
    if(t.hasAttribute("data-pw-prev")){ if(W.step > 1){ W.step--; render(); } return; }
    if(t.hasAttribute("data-pw-next")){ next(); return; }
    if(t.hasAttribute("data-pw-draft")){ draft(); return; }
    if(t.hasAttribute("data-pw-criteria")){
      toast("检查口径：工作项完成 / 需求用例覆盖 / 窗口冲突 / 制品存在；警告不阻塞，未通过需处理或写例外说明", "info");
      return;
    }
    if(t.hasAttribute("data-pw-goto")){
      var vid = t.getAttribute("data-pw-goto");
      var row = versionsById()[vid];
      goVersion(vid, row ? row.reqId : W.reqId, "home");
      return;
    }
    if(t.hasAttribute("data-pw-retry-versions")){ loadVersions(); return; }
    if(t.hasAttribute("data-pw-retry-content")){ loadContent(); return; }
  });
  host.addEventListener("change", function(e){
    if(!W || !e.target) return;
    if(e.target.hasAttribute && e.target.hasAttribute("data-pw-selectall")){
      var on = e.target.checked;
      (W.demands || []).forEach(function(d){ W.demandSel[d.id] = on; });
      render();
      refocus("[data-pw-selectall]");
      return;
    }
    var v = e.target.getAttribute && e.target.getAttribute("data-pw-version");
    if(v){ toggleId(v, e.target.checked); return; }
    var d = e.target.getAttribute && e.target.getAttribute("data-pw-demand");
    if(d){
      W.demandSel[d] = e.target.checked;
      render();
      refocus('[data-pw-demand="' + d + '"]');
      return;
    }
    var owner = e.target.getAttribute && e.target.getAttribute("data-pw-field");
    if(owner === "owner"){ W.owner = e.target.value || ""; render(); return; }
  });
  host.addEventListener("input", function(e){
    if(!W || !e.target) return;
    var f = e.target.getAttribute && e.target.getAttribute("data-pw-field");
    if(!f || f === "owner") return;
    W[f] = e.target.value;
  });
  host.addEventListener("keydown", function(e){
    if(!W || (e.key !== "Enter" && e.key !== " ")) return;
    var row = e.target.closest && e.target.closest("[data-pw-demand-open]");
    if(row && row === e.target){
      e.preventDefault();
      openDemand(row.getAttribute("data-pw-demand-open"));
    }
  });
}

document.addEventListener("click", function(e){
  if(document.body.dataset.view !== "plan-wizard") return;
  if(e.target.closest && e.target.closest("[data-pw-cancel]")) cancel();
});

/* ---------- 视图入口 ---------- */

export function enterPlanWizardView(){
  host = document.getElementById("planWizardBody");
  if(!host) return;
  var route = parseWizardRoute() || { from:"plans", anchor:"", reqId:"", ids:[] };
  /* 同一次进入保留已输入内容：只有入口参数变化时才重置 */
  var key = [route.from, route.anchor, route.reqId, route.ids.join(",")].join("|");
  if(!W || W.entryKey !== key){
    W = blankWizard();
    W.entryKey = key;
    W.from = route.from;
    W.anchor = route.anchor;
    W.reqId = route.reqId;
    W.ids = route.ids.slice();
  }
  bind();
  render();
  loadVersions();
  if(W.members === null) loadMembers();
}

export function refreshFromHash(){
  if(document.body.dataset.view !== "plan-wizard") return;
  W = null;
  enterPlanWizardView();
}
