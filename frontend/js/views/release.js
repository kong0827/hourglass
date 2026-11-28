/* views/release · 发布计划工作台子页（#/release?id=&reqId=&tab=）
   工作台按原型收为三步：计划范围 / 实际发布 / 历史与内容；旧的 tab=content 归到最后一步。
   步骤和版本都在 URL 里，刷新、分享、后退都回到同一步；关闭回到版本页。
   工作区本身仍由 phase.js 的同一份代码挂载，校验、留痕、幂等都没有第二套。 */

import { API } from "../core/api.js";
import { showView } from "../core/router.js";
import { projectOptionsHTML, projectRefsEnriched, reqSetId, rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { planStatusName, planStatusTagHTML, releaseEnvironmentName, releasePlanNoText } from "../lib/format.js";
import { mountReleaseWorkspace, takeReleaseIntent } from "./phase.js";

var TAB_KEYS = ["plan", "actual", "history", "content"];
var host = null, handle = null;

function parseRoute(){
  var raw = String(window.location.hash || "").replace(/^#\/?/, "");
  var qi = raw.indexOf("?");
  if((qi >= 0 ? raw.substring(0, qi) : raw) !== "release") return null;
  var p = new URLSearchParams(qi >= 0 ? raw.substring(qi + 1) : "");
  var tab = p.get("tab") || "plan";
  /* 旧链接的 tab=content 并入「历史与内容」步骤 */
  if(tab === "content") tab = "history";
  return {
    id: p.get("id") || "",
    reqId: p.get("reqId") || "",
    plan: p.get("plan") || "",
    prep: p.get("prep") || "",
    tab: TAB_KEYS.indexOf(tab) >= 0 ? tab : "plan",
    time: p.get("time") || ""
  };
}
function routeHash(r){
  var h = "#/release?id=" + encodeURIComponent(r.id);
  if(r.reqId) h += "&reqId=" + encodeURIComponent(r.reqId);
  if(r.plan) h += "&plan=" + encodeURIComponent(r.plan);
  if(r.prep) h += "&prep=" + encodeURIComponent(r.prep);
  if(r.tab && r.tab !== "plan") h += "&tab=" + r.tab;
  return h;
}
/* 换页签压一条历史：浏览器后退能回到上一个页签，分享出去的链接也带着页签 */
function syncTabHash(tab){
  var r = parseRoute();
  if(!r || !r.id) return;
  var h = routeHash({ id:r.id, reqId:r.reqId, plan:r.plan, tab:tab });
  if(window.location.hash === h) return;
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
}

export function openReleasePage(opts){
  var r = { id: opts.id, reqId: opts.reqId || "", plan: opts.planId || "", prep: opts.prep || "", tab: opts.tab || "plan" };
  try{ history.pushState(null, "", routeHash(r)); }
  catch(e){ window.location.hash = routeHash(r); }
  showView("release");
}

function destroy(){
  if(handle && handle.destroy) handle.destroy();
  handle = null;
}
function goPhase(mode){
  var h = "#/phase" + (mode ? "?pmode=" + mode : "");
  try{ history.pushState(null, "", h); }
  catch(e){ window.location.hash = h; }
  showView("phase");
}
function emptyState(msg){
  destroy();
  host.innerHTML = '<div class="release-page"><div class="panel"><div class="panel-head"><h3>没有可打开的发布计划</h3></div>'
    + '<div class="stack"><p class="hint">' + esc(msg) + '</p>'
    + '<div class="rel-empty-acts"><button class="btn sm primary" type="button" data-release-empty-back>去版本页创建计划</button>'
    + '<button class="btn sm" type="button" data-release-empty-all>查看全部版本</button></div>'
    + '<p class="foot-note">历史发布记录按版本归档：在版本页打开某个已发布版本的「发布记录」查看。</p></div></div></div>';
  var btn = host.querySelector("[data-release-empty-back]");
  if(btn) btn.addEventListener("click", function(){ showView("phase"); });
  var all = host.querySelector("[data-release-empty-all]");
  if(all) all.addEventListener("click", function(){ goPhase("allversions"); });
}

/* #/release 无参数：跨项目发布计划列表（独立菜单入口）。
   计划存意图——什么时候发哪些版本；实际结果以发布记录为准。 */
var planListCache = null, planListSeq = 0;
var planListState = { scope:"all", status:"all", env:"", time:"all", q:"" };

function enterNoParamView(){
  destroy();
  host.innerHTML = '<div class="release-page">' + UI.skeletonRows(4) + '</div>';
  var current = ++planListSeq;
  API.get("/api/release-plans", { status:"all" }).then(function(rows){
    if(current !== planListSeq || document.body.dataset.view !== "release") return;
    planListCache = rows || [];
    renderPlanList();
  }).catch(function(ex){
    if(current !== planListSeq || document.body.dataset.view !== "release") return;
    host.innerHTML = UI.emptyState({
      icon:"alert", title:"发布计划加载失败", text:ex.message || "网络异常，请稍后重试", actionLabel:"重试"
    });
    var retry = host.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", enterNoParamView);
  });
}
function p2(n){ return (n < 10 ? "0" : "") + n; }
/* 计划窗口按原型写全年份，避免跨年时只看月日误判 */
function fmtPlanWindow(iso){
  if(!iso) return "未定时间";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return "未定时间";
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}
function fmtUpdated(iso){
  if(!iso) return "";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return "";
  return (d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}
/* 计划没有独立名称：用主版本 + 环境拼出可读标题，编号放副行做唯一标识 */
function planTitle(r){
  var name = r.versionName || splitList(r.versionNames, " / ")[0] || "发布计划";
  var env = { production:"生产", staging:"预发", test:"测试" }[r.environment] || "发布";
  return name + " " + env + "发布";
}
function checkPill(r){
  if(r.status === "draft") return '<span class="rel-check" title="计划还是草稿；标为就绪前需要先通过就绪检查">未检查</span>';
  if(r.status === "canceled") return '<span class="rel-check" title="计划已取消，不再做就绪检查">—</span>';
  if(r.checkVerdict === "block") return '<span class="rel-check is-block" title="覆盖版本的就绪检查有阻断项；处理后再标为就绪">' + (r.checkBlockers || 0) + ' 项未通过</span>';
  if(r.checkVerdict === "warn") return '<span class="rel-check is-warn" title="覆盖版本的就绪检查有提醒项，不阻断发布">' + (r.checkReminders || 0) + ' 项提醒</span>';
  if(r.checkVerdict === "pass") return '<span class="rel-check is-pass" title="覆盖版本的就绪检查全部通过">' + (r.status === "completed" ? "已通过" : "通过") + '</span>';
  return '<span class="rel-check" title="暂未计算就绪检查">未检查</span>';
}
function envDot(environment){
  var key = environment || "";
  return '<span class="rel-env is-' + esc(key) + '">' + esc(releaseEnvironmentName(environment)) + '</span>';
}
function splitList(text, sep){
  return String(text || "").split(sep).map(function(s){ return s.trim(); }).filter(Boolean);
}
function planReqIds(r){
  var ids = splitList(r.versionReqIds, ",");
  if(!ids.length && r.reqId) ids = [r.reqId];
  return ids;
}
function planProjects(rows){
  var byId = {}, order = [];
  rows.forEach(function(r){
    /* versionProjectNames 与 versionReqIds 同序（逐版本），projectNames 是去重串，不能按位置配对 */
    var names = splitList(r.versionProjectNames || r.projectNames, " / ");
    planReqIds(r).forEach(function(id, i){
      if(byId[id] != null) return;
      byId[id] = names[i] || r.projectName || id;
      order.push({ id:id, name:byId[id] });
    });
  });
  return order;
}
function planScopeOptions(rows){
  var projects = planProjects(rows);
  var chosen = planListState.scope;
  var sets = (rt.projectSets || []).filter(function(s){
    return projects.some(function(p){ return reqSetId(p.id) === s.id; });
  });
  return '<option value="all"' + (chosen === "all" ? " selected" : "") + '>全部项目</option>'
    + sets.map(function(s){
      return '<option value="set:' + esc(s.id) + '"' + (chosen === "set:" + s.id ? " selected" : "") + '>项目集 · ' + esc(s.name) + '</option>';
    }).join("")
    + projectOptionsHTML(projectRefsEnriched(projects), chosen.indexOf("set:") === 0 ? "" : chosen);
}
function planScoped(rows){
  var scope = planListState.scope;
  if(!scope || scope === "all") return rows;
  if(scope.indexOf("set:") === 0){
    var sid = scope.slice(4);
    return rows.filter(function(r){
      return planReqIds(r).some(function(id){ return reqSetId(id) === sid; });
    });
  }
  return rows.filter(function(r){ return planReqIds(r).indexOf(scope) !== -1; });
}
function planTimeIn(iso, from, to){
  if(!iso) return false;
  var t = new Date(iso).getTime();
  return !isNaN(t) && t >= from && t <= to;
}
function planFiltered(scoped){
  var now = Date.now(), day = 86400000;
  var q = String(planListState.q || "").trim().toLowerCase();
  return scoped.filter(function(r){
    if(planListState.status !== "all" && r.status !== planListState.status) return false;
    if(planListState.env && r.environment !== planListState.env) return false;
    if(planListState.time === "next30" && !planTimeIn(r.plannedAt, now, now + 30 * day)) return false;
    if(planListState.time === "last30" && !planTimeIn(r.plannedAt, now - 30 * day, now)) return false;
    if(planListState.time === "quarter" && !planTimeIn(r.plannedAt, now - 90 * day, now + 90 * day)) return false;
    if(q){
      var text = [r.versionNames, r.versionName, r.projectNames, r.projectName, r.ownerName, planStatusName(r.status)]
        .join(" ").toLowerCase();
      if(text.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function planChips(r){
  var names = splitList(r.versionNames, " / ");
  if(!names.length && r.versionName) names = [r.versionName];
  var projects = splitList(r.versionProjectNames || r.projectNames, " / ");
  var cross = Number(r.versionCount) > 1 || planReqIds(r).length > 1;
  var shown = names.slice(0, 3), rest = names.length - shown.length;
  return '<span class="release-chips">' + shown.map(function(n, i){
    var label = cross && projects[i] ? projects[i] + " · " + n : n;
    return '<span class="release-chip" title="' + esc(label) + '">' + esc(label) + '</span>';
  }).join("")
    + (rest > 0 ? '<span class="release-chip is-more" title="' + esc(names.slice(shown.length).join("、")) + '">+' + rest + '</span>' : "")
    + '</span>';
}
function planScopeSub(r){
  var projectCount = planReqIds(r).length, versionCount = Number(r.versionCount) || 1;
  if(projectCount > 1) return "跨项目计划";
  if(versionCount > 1) return versionCount + " 个版本";
  return "";
}
function planRowHTML(r, now){
  var late = r.status !== "completed" && r.status !== "canceled"
    && r.plannedAt && new Date(r.plannedAt).getTime() < now;
  var open = !!(r.versionId && r.reqId);
  var canRecord = open && r.status !== "completed" && r.status !== "canceled";
  var no = releasePlanNoText(r.planNo);
  /* 原型：主行是计划标题，副行只留编号与更新时间；范围项数进 KPI 与筛选，不再占列 */
  var meta = [no || ("#" + r.id), r.updatedAt ? "更新于 " + fmtUpdated(r.updatedAt) : null]
    .filter(Boolean).join(" · ");
  var scopeSub = planScopeSub(r);
  var acts = open
    ? '<button class="btn sm" type="button" data-rel-open-plan="' + esc(r.id) + '" data-rel-ver="' + esc(r.versionId)
      + '" data-rel-req="' + esc(r.reqId) + '" title="打开该计划覆盖版本的发布工作台">打开</button>'
      + (canRecord ? '<button class="btn sm ghost" type="button" data-rel-record-plan="' + esc(r.id) + '" data-rel-ver="' + esc(r.versionId)
        + '" data-rel-req="' + esc(r.reqId) + '" title="登记一次实际发布">记录发布</button>' : "")
      + '<button class="btn sm ghost" type="button" data-rel-delivery-plan="' + esc(r.id) + '" title="按该计划生成逐版本分章的交付报告">交付报告</button>'
      + '<button class="btn sm ghost" type="button" data-rel-share-plan="' + esc(r.id) + '" title="生成只读链接：对方无需登录即可查看计划范围与时间">分享</button>'
    : '<span class="mute" title="该计划缺少版本关联">缺少版本</span>';
  return '<tr>'
    + '<td><b>' + esc(planTitle(r)) + '</b><div class="allv-vsub">' + esc(meta)
      + (late ? ' <span class="tag tag-warning">已过期</span>' : "") + '</div></td>'
    + '<td>' + planChips(r)
      + (scopeSub ? '<div class="allv-vsub" title="' + esc(scopeSub) + '">' + esc(scopeSub) + '</div>' : "") + '</td>'
    + '<td>' + envDot(r.environment) + '</td>'
    + '<td>' + esc(fmtPlanWindow(r.plannedAt)) + '</td>'
    + '<td>' + checkPill(r) + '</td>'
    + '<td>' + esc(r.ownerName || "未指定") + '</td>'
    + '<td>' + planStatusTagHTML(r.status) + '</td>'
    + '<td><div class="rel-empty-acts">' + acts + '</div></td>'
    + '</tr>';
}
function planKpis(scoped){
  var now = Date.now(), day = 86400000;
  var ready = 0, next30 = 0, draft = 0, done30 = 0;
  scoped.forEach(function(r){
    if(r.status === "ready") ready++;
    if(r.status === "draft") draft++;
    if(r.status === "completed" && r.updatedAt && planTimeIn(r.updatedAt, now - 30 * day, now)) done30++;
    if(r.status !== "completed" && r.status !== "canceled" && planTimeIn(r.plannedAt, now, now + 30 * day)) next30++;
  });
  /* 原型四张卡：指标名在上、数字居中、一句口径在下 */
  return [
    [ready, "就绪待执行", "到计划窗口后执行并记录"],
    [next30, "30 天内窗口", "按计划时间排序"],
    [draft, "草稿待完善", "通过就绪检查后才能执行"],
    [done30, "近 30 天已完成", "由发布记录自动收口"]
  ].map(function(k){
    return '<div class="pcell pl-kpi"><span class="pl-kpi-label">' + k[1] + '</span><b>' + k[0] + '</b>'
      + '<span class="pl-kpi-sub">' + k[2] + '</span></div>';
  }).join("");
}
function planListUpdatedAt(rows){
  var latest = null;
  rows.forEach(function(r){
    if(!r.updatedAt) return;
    var t = new Date(r.updatedAt).getTime();
    if(!isNaN(t) && (latest == null || t > latest)) latest = t;
  });
  return latest == null ? "" : fmtUpdated(new Date(latest).toISOString());
}
/* 页头按原型：H1=发布计划，内联口径「N 个计划 · 跨 M 个项目 · 更新于 …」，主操作在标题行右端 */
function syncPlanListPageHead(scoped){
  if(document.body.dataset.view !== "release") return;
  var title = document.getElementById("pageTitleText"), sub = document.getElementById("pageSub");
  var pill = document.getElementById("pagePill"), acts = document.getElementById("pageActions");
  var nw = document.getElementById("newWrap");
  var projectCount = planProjects(scoped).length;
  var meta = [scoped.length + " 个计划",
    projectCount > 1 ? "跨 " + projectCount + " 个项目" : null,
    planListUpdatedAt(scoped) ? "更新于 " + planListUpdatedAt(scoped) : null].filter(Boolean).join(" · ");
  if(title) title.textContent = "发布计划";
  if(sub) sub.textContent = "计划存「打算何时、发哪些版本」；实际结果以发布记录为准。一个计划可跨项目覆盖多个版本。";
  if(pill){ pill.textContent = meta; pill.hidden = false; }
  if(acts){
    acts.innerHTML = '<button class="btn primary" type="button" data-rel-list-new>'
      + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4.4v11.2M4.4 10h11.2"/></svg>新建发布计划</button>';
    acts.hidden = false;
  }
  if(nw) nw.hidden = true;
  document.title = "发布计划 · 沙漏";
}
function renderPlanList(){
  var rows = planListCache || [];
  var now = Date.now();
  var scoped = planScoped(rows);
  syncPlanListPageHead(scoped);
  if(!rows.length){
    host.innerHTML = '<div class="release-page"><div class="panel">' + UI.emptyState({
        icon:"layers", title:"还没有发布计划",
        text:"先定一个窗口，把要一起发的版本勾进来；计划可跨项目覆盖多个版本。",
        actionLabel:"去勾选版本"
      }) + '</div></div>';
    var emptyGo = host.querySelector("[data-empty-action]");
    if(emptyGo) emptyGo.addEventListener("click", function(){ goPhase("allversions"); });
    return;
  }
  var filtered = planFiltered(scoped).sort(function(a, b){
    var ao = a.status === "completed" || a.status === "canceled" ? 1 : 0;
    var bo = b.status === "completed" || b.status === "canceled" ? 1 : 0;
    if(ao !== bo) return ao - bo;
    return String(a.plannedAt || "9999").localeCompare(String(b.plannedAt || "9999"));
  });
  var statusBtn = function(v, label){
    return '<button type="button" data-rel-list-status="' + v + '" aria-pressed="' + (planListState.status === v ? "true" : "false") + '">' + label + '</button>';
  };
  var envOpt = function(v, label){
    return '<option value="' + v + '"' + (planListState.env === v ? " selected" : "") + '>' + label + '</option>';
  };
  var timeOpt = function(v, label){
    return '<option value="' + v + '"' + (planListState.time === v ? " selected" : "") + '>' + label + '</option>';
  };
  host.innerHTML = '<div class="release-page">'
    + '<div class="pl-kpis">' + planKpis(scoped) + '</div>'
    + '<div class="panel">'
    + '<div class="phase-tbl-tools">'
    + '<label class="phase-filter">范围<select class="mini-select" data-rel-list-scope aria-label="范围">' + planScopeOptions(rows) + '</select></label>'
    + '<span class="phase-filter">状态<div class="seg mini" role="group" aria-label="计划状态">'
    + statusBtn("all", "全部") + statusBtn("draft", "草稿") + statusBtn("ready", "就绪")
    + statusBtn("completed", "已完成") + statusBtn("canceled", "已取消") + '</div></span>'
    + '<label class="phase-filter">环境<select class="mini-select" data-rel-list-env aria-label="环境">'
    + envOpt("", "全部环境") + envOpt("production", "生产") + envOpt("staging", "预发布") + envOpt("test", "测试") + '</select></label>'
    + '<label class="phase-filter">时间<select class="mini-select" data-rel-list-time aria-label="计划窗口">'
    + timeOpt("all", "全部时间") + timeOpt("next30", "未来 30 天") + timeOpt("last30", "近 30 天") + timeOpt("quarter", "前后 3 个月") + '</select></label>'
    + '<input class="phase-filter-input" type="search" data-rel-list-q value="' + esc(planListState.q) + '" placeholder="搜索计划、项目或版本" aria-label="搜索发布计划">'
    + '<span class="phase-tbl-count">' + filtered.length + ' / ' + scoped.length + ' 份计划</span>'
    + '</div>'
    + (filtered.length
      ? '<div class="tbl-wrap phase-tbl-wrap"><table class="phase-tbl"><thead><tr>'
        + '<th>计划</th><th>覆盖版本</th><th>环境</th><th>计划窗口</th><th>就绪检查</th><th>执行人</th><th>状态</th><th>操作</th>'
        + '</tr></thead><tbody>' + filtered.map(function(r){ return planRowHTML(r, now); }).join("") + '</tbody></table></div>'
      : '<div class="allv-empty">没有匹配的发布计划，试试清空筛选。</div>'
        + '<div class="rel-empty-acts" style="padding:0 12px 12px"><button class="btn sm" type="button" data-rel-list-reset>清空筛选</button></div>')
    + '<div class="rel-plan-foot"><p class="hint">就绪后内容与环境锁定，变更需新建计划或紧急记录；生产成功且覆盖版本全部完成后，计划自动收口为「已完成」。'
    + '计划包含的版本都完成本计划的生产部署 / 重部署后，计划自动完成。</p></div>'
    + '</div></div>';
  wirePlanList();
}
function wirePlanList(){
  var scope = host.querySelector("[data-rel-list-scope]");
  if(scope) scope.addEventListener("change", function(){ planListState.scope = scope.value || "all"; renderPlanList(); });
  var env = host.querySelector("[data-rel-list-env]");
  if(env) env.addEventListener("change", function(){ planListState.env = env.value; renderPlanList(); });
  var time = host.querySelector("[data-rel-list-time]");
  if(time) time.addEventListener("change", function(){ planListState.time = time.value || "all"; renderPlanList(); });
  host.querySelectorAll("[data-rel-list-status]").forEach(function(b){
    b.addEventListener("click", function(){ planListState.status = b.dataset.relListStatus; renderPlanList(); });
  });
  var q = host.querySelector("[data-rel-list-q]");
  if(q) q.addEventListener("input", function(){
    planListState.q = q.value;
    var pos = q.selectionStart;
    renderPlanList();
    var next = host.querySelector("[data-rel-list-q]");
    if(next){ next.focus(); try{ next.setSelectionRange(pos, pos); }catch(e){ /* search 输入不支持选区 API */ } }
  });
  var reset = host.querySelector("[data-rel-list-reset]");
  if(reset) reset.addEventListener("click", function(){
    planListState = { scope:"all", status:"all", env:"", time:"all", q:"" };
    renderPlanList();
  });
  var fresh = document.querySelector("#pageActions [data-rel-list-new]");
  if(fresh) fresh.addEventListener("click", function(){ goPhase("allversions"); });
  host.querySelectorAll("[data-rel-open-plan]").forEach(function(b){
    b.addEventListener("click", function(){
      openReleasePage({ id:b.dataset.relVer, reqId:b.dataset.relReq, planId:b.dataset.relOpenPlan });
    });
  });
  host.querySelectorAll("[data-rel-record-plan]").forEach(function(b){
    b.addEventListener("click", function(){
      openReleasePage({ id:b.dataset.relVer, reqId:b.dataset.relReq, planId:b.dataset.relRecordPlan, tab:"actual" });
    });
  });
  host.querySelectorAll("[data-rel-delivery-plan]").forEach(function(b){
    b.addEventListener("click", function(){
      var id = b.dataset.relDeliveryPlan;
      import("./delivery.js").then(function(m){ m.openPlanDeliveryNote(id); })
        .catch(function(ex){ toast(ex && ex.message || "打不开交付报告", "bad"); });
    });
  });
  host.querySelectorAll("[data-rel-share-plan]").forEach(function(b){
    b.addEventListener("click", function(){
      import("../lib/plan-share.js").then(function(m){ m.openPlanShare(b.dataset.relSharePlan); })
        .catch(function(ex){ toast(ex && ex.message || "打不开分享", "bad"); });
    });
  });
}

function mount(route, version, intent){
  destroy();
  /* 工作区按 rt.phaseReqId 校验迟到的响应；直接打开链接时先把它对齐到当前版本 */
  if(version.reqId) rt.phaseReqId = version.reqId;
  handle = mountReleaseWorkspace(host, {
    id: route.id,
    tab: route.tab,
    planId: (intent && intent.planId) || route.plan || "",
    prep: (intent && intent.prep) || route.prep || "",
    entry: intent ? intent.entry : (route.tab === "actual" ? "actual" : "plan"),
    version: version,
    onClose: intent ? intent.onClose : null,
    presetVersionIds: intent ? intent.presetVersionIds : null,
    forceNewPlan: !!(intent && intent.forceNewPlan),
    returnHash: intent ? intent.returnHash : "",
    onTab: syncTabHash
  });
}

export function enterReleaseView(){
  host = document.getElementById("releaseBody");
  if(!host) return;
  var route = parseRoute();
  var intent = takeReleaseIntent();
  if(!route || !route.id){
    /* 版本页「查看全部发布计划」带 ?time= 进来：只切时间窗，状态与范围留给列表自己的筛选 */
    if(route && ["all", "next30", "last30", "quarter"].indexOf(route.time) >= 0) planListState.time = route.time;
    enterNoParamView();
    return;
  }
  if(intent && intent.id !== route.id) intent = null;
  if(intent && intent.version){ mount(route, intent.version, intent); return; }
  var reqId = (intent && intent.reqId) || route.reqId;
  host.innerHTML = '<div class="release-page">' + UI.skeletonRows(4) + '</div>';
  API.get("/api/versions", { reqId: reqId }).then(function(vs){
    if(document.body.dataset.view !== "release") return;
    var v = (vs || []).filter(function(item){ return item.id === route.id; })[0];
    if(!v){ emptyState("版本已变化或不可见"); return; }
    /* 直接从链接进入时没有入口参数，版本从接口取到的这份为准 */
    if(!reqId) route.reqId = v.reqId;
    mount(route, v, intent);
  }).catch(function(ex){
    if(document.body.dataset.view !== "release") return;
    emptyState(ex.message || "版本加载失败，请稍后重试");
  });
}

export function refreshFromHash(){
  var route = parseRoute();
  if(!route || !route.id){ enterReleaseView(); return; }
  if(handle && handle.id === route.id){ handle.setTab(route.tab); return; }
  enterReleaseView();
}

/* 离开路由（后退 / 点菜单 / 返回版本）时清掉 SSE 监听与入口回调 */
window.addEventListener("ds:before-route", function(e){
  if(e.detail && e.detail.from === "release" && e.detail.to !== "release") destroy();
});

/* 只有直接改地址栏 hash 才会走这里；pushState 走 popstate */
window.addEventListener("hashchange", function(){
  if(document.body.dataset.view !== "release" || !parseRoute()) return;
  refreshFromHash();
});
