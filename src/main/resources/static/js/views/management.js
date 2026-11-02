/* views/management · 管理驾驶舱（共享空间 owner/exec） */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { rt } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarColor, fmtMinutesShort, initial } from "../lib/format.js";

var mgmt = {
  overview: null,
  projects: [],
  cardProjects: [],
  total: 0,
  offset: 0,
  limit: 20,
  members: [],
  workload: null,
  tab: "overview",
  onlyException: false,
  filters: { riskLevel: "", status: "", manager: "", statusIssue: "", keyword: "" },
  loading: false,
  seq: 0
};

function enterManagementView() {
  if (!canView()) {
    renderDenied();
    return;
  }
  if (!mgmt.shellReady || !$("mgmtKpis")) {
    renderShell();
    mgmt.shellReady = true;
  }
  loadMembers().then(refresh).catch(refresh);
}

function canView() {
  var ws = rt.currentWs;
  return !!(ws && ws.type === "shared" && (ws.myRole === "owner" || ws.myRole === "exec"));
}

function isOwner() {
  return !!(rt.currentWs && rt.currentWs.myRole === "owner");
}

function renderDenied() {
  var app = $("mgmtApp");
  if (!app) return;
  app.innerHTML = '<div class="mgmt-empty"><b>管理驾驶舱仅共享空间可用</b>' +
    '<span>个人空间或普通成员没有管理视图。请切换到共享空间，并确认你是空间主或管理层。</span></div>';
}

function renderShell() {
  var app = $("mgmtApp");
  if (!app) return;
  app.innerHTML =
    '<div class="mgmt-head">' +
      '<div><h2>跨项目总览</h2><p id="mgmtSub">项目组合、风险、负载与数据质量。管理层只读，不对任务产生写操作。</p></div>' +
      '<div class="mgmt-actions">' +
        '<button class="btn sm" type="button" id="mgmtExceptionToggle">只看异常</button>' +
        '<button class="btn sm" type="button" id="mgmtRefresh">刷新</button>' +
        '<button class="btn sm" type="button" id="mgmtWeekly">导出周报</button>' +
        '<button class="btn sm primary" type="button" id="mgmtExport">导出 CSV</button>' +
      '</div>' +
    '</div>' +
    '<div class="mgmt-tabs" id="mgmtTabs">' +
      '<button class="mgmt-tab on" type="button" data-mgmt-tab="overview">跨项目总览</button>' +
      '<button class="mgmt-tab" type="button" data-mgmt-tab="projects">项目总览</button>' +
    '</div>' +
    '<section id="mgmtOverviewPane">' +
      '<div class="mgmt-info">进度 = 已完成任务数 ÷ 任务总数（自动计算，不读手填进度）；状态灯：<b class="lg-red">红</b> = 逾期占比 &gt;10% 且连续 7 天无完成，<b class="lg-amber">橙</b> = 有逾期或成员超载，<b class="lg-green">绿</b> = 正常，<b class="lg-unknown">灰</b> = 已暂停/没有有效任务。状态灯只看执行节奏，人工覆盖优先，完整风险见「项目总览」。</div>' +
      '<div class="mgmt-kpis" id="mgmtKpis"></div>' +
      '<div class="mgmt-alert" id="mgmtAlert" hidden></div>' +
      '<div class="mgmt-legend"><span><i class="mgmt-dot green"></i>正常</span><span><i class="mgmt-dot amber"></i>有逾期或超载</span><span><i class="mgmt-dot red"></i>逾期 &gt;10% 且 7 天无完成</span><span><i class="mgmt-dot unknown"></i>已暂停/无任务</span></div>' +
      '<div id="mgmtCards" class="mgmt-cards"></div>' +
    '</section>' +
    '<section id="mgmtProjectsPane" hidden>' +
      '<div class="mgmt-grid">' +
        '<section class="panel mgmt-card"><div class="panel-head"><h3>风险分布</h3><span class="meta-right" id="mgmtRiskMeta"></span></div><div id="mgmtRiskDist"></div></section>' +
        '<section class="panel mgmt-card"><div class="panel-head"><h3>12 周趋势</h3><span class="meta-right" id="mgmtTrendMeta"></span></div><div id="mgmtTrend"></div></section>' +
        '<section class="panel mgmt-card"><div class="panel-head"><h3>Top 风险</h3></div><div id="mgmtTopRisks"></div></section>' +
      '</div>' +
      '<section class="panel mgmt-card">' +
        '<div class="panel-head"><h3>项目组合</h3><span class="meta-right" id="mgmtProjectMeta"></span></div>' +
        '<div class="mgmt-filters">' +
          '<select id="mgmtRiskFilter" aria-label="按风险筛选"><option value="">全部风险</option><option value="red">红 · 高风险</option><option value="amber">黄 · 需关注</option><option value="green">绿 · 正常</option><option value="unknown">未知</option></select>' +
          '<select id="mgmtStatusFilter" aria-label="按状态筛选"><option value="">全部状态</option><option value="active">进行中</option><option value="done">已完成</option><option value="hold">已暂停</option></select>' +
          '<select id="mgmtManagerFilter" aria-label="按负责人筛选"><option value="">全部负责人</option></select>' +
          '<select id="mgmtIssueFilter" aria-label="按状态异常筛选"><option value="">全部项目</option><option value="done_with_open_tasks">已完成但仍有未完成任务</option><option value="done_without_tasks">已完成但无任务</option></select>' +
          '<input id="mgmtKeyword" type="search" placeholder="搜索项目/负责人" aria-label="搜索项目或负责人" />' +
        '</div>' +
        '<div id="mgmtProjects" class="mgmt-table-wrap"></div>' +
        '<div class="mgmt-pager"><button class="btn sm" type="button" id="mgmtPrev">上一页</button><span id="mgmtPage"></span><button class="btn sm" type="button" id="mgmtNext">下一页</button></div>' +
      '</section>' +
      '<section class="panel mgmt-card">' +
        '<div class="panel-head"><h3>本周负载</h3><span class="meta-right">容量按账号每日计入上限推导</span></div>' +
        '<div id="mgmtWorkload" class="mgmt-table-wrap"></div>' +
      '</section>' +
    '</section>' +
    '<div class="mgmt-modal" id="mgmtModal" hidden><div class="mgmt-dialog" id="mgmtDialog"></div></div>';

  $("mgmtRefresh").addEventListener("click", refresh);
  $("mgmtExport").addEventListener("click", exportCsv);
  $("mgmtWeekly").addEventListener("click", exportWeekly);
  $("mgmtExceptionToggle").addEventListener("click", function(){
    mgmt.onlyException = !mgmt.onlyException;
    this.classList.toggle("on", mgmt.onlyException);
    this.textContent = mgmt.onlyException ? "显示全部" : "只看异常";
    renderOverviewCards();
  });
  $("mgmtTabs").addEventListener("click", function(e){
    var b = e.target.closest("[data-mgmt-tab]");
    if (b) setMgmtTab(b.dataset.mgmtTab);
  });
  $("mgmtRiskFilter").addEventListener("change", function(){ mgmt.filters.riskLevel = this.value; mgmt.offset = 0; refresh(); });
  $("mgmtStatusFilter").addEventListener("change", function(){ mgmt.filters.status = this.value; mgmt.offset = 0; refresh(); });
  $("mgmtIssueFilter").addEventListener("change", function(){ mgmt.filters.statusIssue = this.value; mgmt.offset = 0; refresh(); });
  $("mgmtManagerFilter").addEventListener("change", function(){ mgmt.filters.manager = this.value; mgmt.offset = 0; refresh(); });
  $("mgmtKeyword").addEventListener("keydown", function(e){
    if (e.key === "Enter") { mgmt.filters.keyword = this.value.trim(); mgmt.offset = 0; refresh(); }
  });
  $("mgmtPrev").addEventListener("click", function(){
    mgmt.offset = Math.max(0, mgmt.offset - mgmt.limit); refresh();
  });
  $("mgmtNext").addEventListener("click", function(){
    if (mgmt.offset + mgmt.limit < mgmt.total) { mgmt.offset += mgmt.limit; refresh(); }
  });
  $("mgmtModal").addEventListener("click", function(e){
    if (e.target.id === "mgmtModal" || e.target.closest("[data-mgmt-close]")) closeModal();
  });
  $("mgmtApp").onclick = function(e){
    var p = e.target.closest("[data-mgmt-project]");
    if (p) { openDetail(p.dataset.mgmtProject); return; }
    var t = e.target.closest("[data-mgmt-task]");
    if (t) { openTaskById(t.dataset.mgmtTask); return; }
  };
  $("mgmtApp").onkeydown = function(e){
    if (e.key !== "Enter" && e.key !== " ") return;
    var p = e.target.closest("[data-mgmt-project]");
    if (p) { e.preventDefault(); openDetail(p.dataset.mgmtProject); }
  };
  setMgmtTab(mgmt.tab);
}

function setMgmtTab(tab) {
  mgmt.tab = tab === "projects" ? "projects" : "overview";
  document.querySelectorAll("#mgmtTabs [data-mgmt-tab]").forEach(function(b){
    b.classList.toggle("on", b.dataset.mgmtTab === mgmt.tab);
  });
  if ($("mgmtOverviewPane")) $("mgmtOverviewPane").hidden = mgmt.tab !== "overview";
  if ($("mgmtProjectsPane")) $("mgmtProjectsPane").hidden = mgmt.tab !== "projects";
}

function loadMembers() {
  if (!rt.currentWs || rt.currentWs.type !== "shared") return Promise.resolve();
  return API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members").then(function(list){
    mgmt.members = (list || []).filter(function(m){ return m.role === "owner" || m.role === "member"; });
    var sel = $("mgmtManagerFilter");
    if (sel) {
      sel.innerHTML = '<option value="">全部负责人</option>' + mgmt.members.map(function(m){
        return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username) + '</option>';
      }).join("");
    }
  }).catch(function(){});
}

function refresh() {
  if (!canView()) { renderDenied(); return; }
  var seq = ++mgmt.seq;
  mgmt.loading = true;
  var q = {
    riskLevel: mgmt.filters.riskLevel,
    status: mgmt.filters.status,
    manager: mgmt.filters.manager,
    statusIssue: mgmt.filters.statusIssue,
    keyword: mgmt.filters.keyword,
    offset: mgmt.offset,
    limit: mgmt.limit,
    sort: "risk"
  };
  var monday = mondayIso(new Date());
  var sunday = addDays(monday, 6);
  $("mgmtKpis").innerHTML = skeleton(4);
  $("mgmtCards").innerHTML = '<div class="mgmt-empty small">加载中…</div>';
  $("mgmtProjects").innerHTML = skeletonRows(4);
  Promise.all([
    API.get("/api/management/overview"),
    API.get("/api/management/projects", q),
    API.get("/api/management/workload", { from: monday, to: sunday }),
    API.get("/api/management/portfolio")
  ]).then(function(res){
    if (seq !== mgmt.seq) return;
    mgmt.loading = false;
    mgmt.overview = res[0];
    mgmt.projects = (res[1] && res[1].items) || [];
    mgmt.total = res[1] ? (res[1].total || 0) : 0;
    mgmt.workload = res[2];
    mgmt.cardProjects = res[3] || [];
    renderAll();
  }).catch(function(ex){
    if (seq !== mgmt.seq) return;
    mgmt.loading = false;
    $("mgmtKpis").innerHTML = '<div class="mgmt-error">' + esc(ex.message || "加载失败") +
      ' <button class="btn sm" type="button" id="mgmtRetry">重试</button></div>';
    ["mgmtCards", "mgmtProjects", "mgmtWorkload"].forEach(function(id){
      if ($(id)) $(id).innerHTML = '<div class="mgmt-empty small">加载失败，请重试</div>';
    });
    ["mgmtRiskDist", "mgmtTrend", "mgmtTopRisks"].forEach(function(id){
      if ($(id)) $(id).innerHTML = "";
    });
    if ($("mgmtAlert")) $("mgmtAlert").hidden = true;
    var retry = $("mgmtRetry");
    if (retry) retry.addEventListener("click", refresh);
  });
}

function renderAll() {
  renderKpis();
  renderOverviewCards();
  renderRisk();
  renderTrend();
  renderTopRisks();
  renderProjects();
  renderWorkload();
  renderAlert();
  if (rt.currentWs && $("mgmtSub")) {
    $("mgmtSub").textContent = rt.currentWs.name + " · " + mgmt.cardProjects.length + " 个项目 · 本周口径";
  }
}

function renderKpis() {
  var s = mgmt.overview && mgmt.overview.summary;
  if (!s) return;
  var completedDelta = s.completedThisWeek - s.completedPrevWeek;
  var workDelta = Math.round((s.workMinutesThisWeek - s.workMinutesPrevWeek) / 6) / 10;
  var perCapita = s.members ? Math.round(s.workMinutesThisWeek / s.members) : 0;
  var items = [
    ["进行中项目", s.active + " / " + s.projects, (s.done || 0) + " 个已完成"],
    ["逾期任务", s.overdueTasks, s.topOverdueProject ? ("集中在 " + s.topOverdueProject) : "当前没有逾期任务"],
    ["本周完成", s.completedThisWeek, deltaText(completedDelta, "项")],
    ["本周团队工时", fmtHours(s.workMinutesThisWeek),
      s.members + " 人 · 人均 " + fmtHours(perCapita) + " · " + deltaText(workDelta, "h")]
  ];
  $("mgmtKpis").innerHTML = items.map(function(x){
    return '<div class="mgmt-kpi"><span class="k">' + esc(x[0]) + '</span><b>' + esc(String(x[1])) +
      '</b><span class="s">' + esc(x[2]) + '</span></div>';
  }).join("");
}

function deltaText(n, unit) {
  if (n > 0) return "较上周 +" + n + unit;
  if (n < 0) return "较上周 " + n + unit;
  return "与上周持平";
}

function fmtHours(minutes) {
  if (minutes == null) return "—";
  return (Math.round(minutes / 6) / 10) + "h";
}

function renderOverviewCards() {
  var rows = mgmt.cardProjects || [];
  if (mgmt.onlyException) {
    rows = rows.filter(function(r){
      return r.statusIssue || r.statusLight === "red" || r.statusLight === "amber"
        || (r.statusLight === "unknown" && r.status === "active");
    });
  }
  if (!rows.length) {
    $("mgmtCards").innerHTML = '<div class="mgmt-empty small">' +
      (mgmt.onlyException ? "当前没有异常项目" : "当前空间还没有项目") + '</div>';
    return;
  }
  $("mgmtCards").innerHTML = rows.map(projectCardHtml).join("");
}

function projectCardHtml(r) {
  var pct = r.taskCount ? Math.round(r.doneCount * 100 / r.taskCount) : 0;
  var light = r.statusLight || "green";
  var lightColor = light === "red" ? "#d95c5c" : (light === "amber" ? "#d9a441" : (light === "unknown" ? "#9aa1ab" : "#5f9e72"));
  var lightText = light === "red" ? "异常" : (light === "amber" ? "需关注" : (light === "unknown" ? "未评估" : "正常"));
  var participants = (r.participants || []).slice(0, 4);
  var avatarHtml = participants.length
    ? participants.map(function(n){
        return '<span class="avatar sm" style="--a:' + esc(avatarColor(n)) + '" title="' + esc(n) + '">' + esc(initial(n)) + '</span>';
      }).join("")
    : '<span class="mgmt-sub">未指定</span>';
  if ((r.participants || []).length > 4) {
    avatarHtml += '<span class="avatar sm mgmt-avatar-more">+' + (r.participants.length - 4) + '</span>';
  }
  var foot = "";
  var started = (r.startDate && (!rt.TODAY_ISO || String(r.startDate) <= rt.TODAY_ISO))
    ? daysAgo(r.startDate) : null;
  if (r.statusIssue) {
    foot = statusIssueText(r.statusIssue);
  } else if (r.status === "done") {
    foot = "已完成";
  } else if (r.status === "hold") {
    foot = "已暂停";
  } else if (r.taskCount > 0 && r.doneCount >= r.taskCount) {
    foot = "任务已全部完成";
  } else if (started != null && started <= 7) {
    foot = "刚启动 · 第" + (Math.floor(started / 7) + 1) + "周";
  } else if (r.lastCompletedDate && r.daysSinceCompletion != null
      && r.daysSinceCompletion >= 7 && r.doneCount > 0) {
    foot = "连续 " + r.daysSinceCompletion + " 天无完成";
  } else if (r.doneCount > 0 && !r.lastCompletedDate) {
    foot = "暂无完成记录";
  } else if (r.doneCount === 0) {
    foot = "暂无完成";
  } else {
    var idle = daysAgo(r.lastActivityAt);
    if (idle != null && idle >= 7) {
      foot = "近 " + idle + " 天无动态";
    } else if (r.dueDate) {
      foot = "截止 " + fmtDate(r.dueDate);
    } else {
      foot = "未维护截止日";
    }
  }
  var other = r.otherCount > 0 ? '<span class="mgmt-card-other">其他 ' + r.otherCount + '</span>' : "";
  var overload = r.overloadedMembers > 0
    ? '<span class="tag tag-warning" title="按成员本周未完成任务的预估负载计算">' + r.overloadedMembers + ' 人超载</span>' : "";
  var reason = (r.riskReasons && r.riskReasons.length) ? r.riskReasons[0] : "";
  return '<article class="mgmt-project-card" data-mgmt-project="' + esc(r.id) + '" tabindex="0">' +
    '<div class="mgmt-project-head">' +
      '<div><h3>' + esc(r.name) + '</h3><span class="mgmt-sub">' + esc(r.manager || "未指定负责人") + '</span></div>' +
      '<span class="mgmt-light ' + light + '"><i></i>' + lightText + '</span>' +
    '</div>' +
    '<div class="mgmt-project-mid">' +
      '<div class="mgmt-donut" style="--p:' + pct + ';--c:' + lightColor + '"><b>' + pct + '%</b><span>已完成</span></div>' +
      '<div class="mgmt-card-stats">' +
        '<span><i class="mgmt-dot backlog"></i>待处理 <b>' + r.backlogCount + '</b></span>' +
        '<span><i class="mgmt-dot doing"></i>进行中 <b>' + r.doingCount + '</b></span>' +
        '<span><i class="mgmt-dot green"></i>已完成 <b>' + r.doneCount + '</b></span>' +
        '<span><i class="mgmt-dot red"></i>逾期 <b>' + r.overdueCount + '</b>' + other + '</span>' +
      '</div>' +
    '</div>' +
    (reason ? '<div class="mgmt-card-reason">' + esc(reason) + '</div>' : '') +
    '<div class="mgmt-project-foot"><div class="mgmt-avatars">' + avatarHtml + '</div>' +
      '<span class="mgmt-card-foot-text">' + esc(foot) + '</span>' + overload + '</div>' +
  '</article>';
}

function daysAgo(value) {
  if (!value) return null;
  /* 日期串按本地日历解析；直接 new Date("yyyy-MM-dd") 在负时区会落到前一天 */
  var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (isNaN(d.getTime())) return null;
  var today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - d.getTime()) / 86400000);
}

function renderAlert() {
  var s = mgmt.overview && mgmt.overview.summary;
  var el = $("mgmtAlert");
  if (!el) return;
  if (!s || !s.statusIssues) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<b>状态异常 ' + s.statusIssues + ' 个</b><span>已完成但仍有未完成任务或没有任务；可在「项目总览」的“状态异常”筛选中查看。</span>';
}

function renderRisk() {
  var r = mgmt.overview && mgmt.overview.risk;
  if (!r) return;
  var total = r.red + r.amber + r.green + r.unknown;
  $("mgmtRiskMeta").textContent = total ? ("进行中 " + total + " 个") : "";
  $("mgmtRiskDist").innerHTML = [["红", r.red, "red"], ["黄", r.amber, "amber"], ["绿", r.green, "green"], ["未知", r.unknown, "unknown"]].map(function(x){
    var pct = total ? Math.round(x[1] * 100 / total) : 0;
    return '<div class="mgmt-risk-row"><span class="mgmt-dot ' + x[2] + '"></span><span>' + x[0] +
      '</span><b>' + x[1] + '</b><span class="mgmt-bar"><i class="' + x[2] + '" style="width:' + pct + '%"></i></span></div>';
  }).join("");
}

function renderTrend() {
  var weeks = (mgmt.overview && mgmt.overview.weeks) || [];
  $("mgmtTrendMeta").textContent = mgmt.overview && mgmt.overview.dataStartDate
    ? ("完成数据自 " + mgmt.overview.dataStartDate) : "完成数据暂不可用";
  if (!weeks.length) {
    $("mgmtTrend").innerHTML = '<div class="mgmt-empty small">暂无趋势数据</div>';
    return;
  }
  var max = 1;
  weeks.forEach(function(w){ max = Math.max(max, w.created || 0, w.completedAvailable ? (w.completed || 0) : 0); });
  $("mgmtTrend").innerHTML = '<div class="mgmt-trend">' + weeks.map(function(w){
    var c = w.completedAvailable ? (w.completed || 0) : 0;
    var label = w.weekStart ? w.weekStart.substring(5) : "";
    return '<div class="mgmt-trend-col" title="' + esc(w.weekStart || "") + '：新增 ' + (w.created || 0) +
      '，完成 ' + (w.completedAvailable ? c : "—") + '">' +
      '<div class="mgmt-trend-bars"><i class="created" style="height:' + Math.max(2, Math.round((w.created || 0) * 46 / max)) + 'px"></i>' +
      '<i class="' + (w.completedAvailable ? "completed" : "none") + '" style="height:' + Math.max(2, Math.round(c * 46 / max)) + 'px"></i></div>' +
      '<span>' + esc(label) + '</span></div>';
  }).join("") + '</div>' +
    '<div class="mgmt-legend"><span><i class="created"></i>新增任务</span><span><i class="completed"></i>完成任务</span></div>';
}

function renderTopRisks() {
  var list = (mgmt.overview && mgmt.overview.topRisks) || [];
  if (!list.length) {
    $("mgmtTopRisks").innerHTML = '<div class="mgmt-empty small">当前没有红色/黄色风险</div>';
    return;
  }
  $("mgmtTopRisks").innerHTML = list.map(function(r){
    return '<button class="mgmt-risk-item" type="button" data-mgmt-project="' + esc(r.projectId) + '">' +
      '<span class="tag ' + (r.severity === "red" ? "tag-danger" : "tag-warning") + '">' + (r.severity === "red" ? "红" : "黄") + '</span>' +
      '<span class="mgmt-risk-text"><b>' + esc(r.projectName) + '</b><span>' + esc(r.reason) +
      (r.days == null ? "" : ' · ' + r.days + ' 天') + '</span></span></button>';
  }).join("");
}

function renderProjects() {
  var rows = mgmt.projects || [];
  $("mgmtProjectMeta").textContent = mgmt.total ? ("共 " + mgmt.total + " 个") : "";
  $("mgmtPage").textContent = mgmt.total
    ? ((mgmt.offset + 1) + "–" + Math.min(mgmt.offset + mgmt.limit, mgmt.total) + " / " + mgmt.total)
    : "";
  $("mgmtPrev").disabled = mgmt.offset <= 0;
  $("mgmtNext").disabled = mgmt.offset + mgmt.limit >= mgmt.total;
  if (!rows.length) {
    $("mgmtProjects").innerHTML = '<div class="mgmt-empty small">当前筛选条件下没有项目</div>';
    return;
  }
  var head = '<table class="mgmt-table"><thead><tr>' +
    '<th>项目</th><th>负责人</th><th>风险</th><th>数据质量</th><th>周期</th>' +
    '<th>实际 / 计划</th><th>偏差</th><th>任务</th><th>工时</th><th>最近更新</th><th>下一节点</th>' +
    '</tr></thead><tbody>';
  var body = rows.map(function(r){
    var statusIssue = r.statusIssue ? '<span class="tag tag-warning">' + esc(statusIssueText(r.statusIssue)) + '</span>' : "";
    return '<tr class="mgmt-row" data-mgmt-project="' + esc(r.id) + '">' +
      '<td><div class="mgmt-name">' + esc(r.name) + '</div><div class="mgmt-sub">' + esc(statusText(r.status)) + statusIssue + '</div></td>' +
      '<td>' + esc(r.manager || "未指定") + '</td>' +
      '<td>' + riskTag(r.riskLevel) + (r.riskReasons && r.riskReasons.length ? '<div class="mgmt-sub">' + esc(r.riskReasons[0]) + '</div>' : '') + '</td>' +
      '<td>' + (r.dataQuality == null ? "—" : r.dataQuality + "%") + (r.missingFields && r.missingFields.length ? '<div class="mgmt-sub">' + esc(r.missingFields[0]) + '</div>' : '') + '</td>' +
      '<td class="nowrap">' + esc(fmtDate(r.startDate) + " → " + fmtDate(r.dueDate)) + '</td>' +
      '<td class="nowrap"><b>' + r.doneWeightedPct + '%</b> / ' + (r.plannedPct == null ? "—" : r.plannedPct + '%') + '</td>' +
      '<td class="nowrap ' + (r.variancePct != null && r.variancePct < 0 ? "mgmt-neg" : "") + '">' + (r.variancePct == null ? "—" : (r.variancePct > 0 ? "+" : "") + r.variancePct + "pp") + '</td>' +
      '<td class="nowrap">' + r.doneCount + '/' + r.taskCount + (r.overdueCount ? '<span class="mgmt-sub">逾期 ' + r.overdueCount + '</span>' : '') + (r.blockedCount ? '<span class="mgmt-sub">阻塞 ' + r.blockedCount + '</span>' : '') + '</td>' +
      '<td class="nowrap">' + fmtMinutesShort(r.estimateMinutes) + ' / ' + fmtMinutesShort(r.actualMinutes) + '</td>' +
      '<td class="nowrap">' + esc(fmtTime(r.lastActivityAt)) + '</td>' +
      '<td class="mgmt-next">' + esc(r.nextNode || "—") + '</td>' +
    '</tr>';
  }).join("");
  $("mgmtProjects").innerHTML = head + body + '</tbody></table>';
}

function renderWorkload() {
  var w = mgmt.workload;
  if (!w || !w.members || !w.members.length) {
    $("mgmtWorkload").innerHTML = '<div class="mgmt-empty small">本周没有可统计的负载</div>';
    return;
  }
  var week = w.weeks && w.weeks[0];
  var head = '<table class="mgmt-table"><thead><tr><th>成员</th><th>预估</th><th>容量</th><th>实际</th><th>负载</th></tr></thead><tbody>';
  var rows = w.members.map(function(m){
    var b = (m.weeks || []).filter(function(x){ return x.weekStart === week; })[0] || {};
    var pct = b.estimatedPct || 0;
    return '<tr><td>' + esc(m.name || "未绑定账号") + '</td>' +
      '<td>' + fmtMinutesShort(b.estimateMinutes || 0) + '</td>' +
      '<td>' + fmtMinutesShort(b.capacityMinutes || 0) + '</td>' +
      '<td>' + fmtMinutesShort(b.actualMinutes || 0) + '</td>' +
      '<td><span class="tag ' + (pct >= 100 ? "tag-danger" : (pct >= 85 ? "tag-warning" : "tag-ghost")) + '">' + pct + '%</span>' +
      (b.estimateCoverage < 80 ? '<span class="mgmt-sub">估时覆盖 ' + b.estimateCoverage + '%</span>' : '') + '</td></tr>';
  }).join("");
  $("mgmtWorkload").innerHTML = head + rows + '</tbody></table>';
}

/* ==================== 详情 / 编辑 / 覆盖 ==================== */

function openDetail(id) {
  API.get("/api/management/projects/" + encodeURIComponent(id)).then(function(d){
    mgmt.detail = d;
    var p = d.project;
    var tasks = d.tasks || [];
    var risks = d.risks || [];
    var hours = d.hours || [];
    var actions = isOwner()
      ? '<button class="btn sm" type="button" data-mgmt-meta="' + esc(id) + '">编辑资料</button>' +
        '<button class="btn sm" type="button" data-mgmt-health="' + esc(id) + '">健康覆盖</button>' +
        '<button class="btn sm" type="button" data-mgmt-bulk-tasks="' + esc(id) + '">批量补任务资料</button>'
      : '';
    var html = '<div class="mgmt-dialog-head"><div><h3>' + esc(p.name) + '</h3>' +
      '<div class="mgmt-sub">' + esc(statusText(p.status)) + ' · ' + esc(p.manager || "未指定负责人") +
      ' · ' + esc(fmtDate(p.startDate) + " → " + fmtDate(p.dueDate)) + '</div></div>' +
      '<button class="icon-btn sm" type="button" data-mgmt-close aria-label="关闭">×</button></div>' +
      '<div class="mgmt-detail-kpis">' +
        '<div><span>风险</span><b>' + riskTag(p.riskLevel) + '</b></div>' +
        '<div><span>实际 / 计划</span><b>' + p.doneWeightedPct + '% / ' + (p.plannedPct == null ? "—" : p.plannedPct + '%') + '</b></div>' +
        '<div><span>偏差</span><b>' + (p.variancePct == null ? "—" : p.variancePct + "pp") + '</b></div>' +
        '<div><span>数据质量</span><b>' + (p.dataQuality == null ? "—" : p.dataQuality + '%') + '</b></div>' +
        '<div><span>估时覆盖</span><b>' + p.estimateCoverage + '%</b></div>' +
      '</div>' +
      '<div class="mgmt-detail-actions">' + actions + '</div>' +
      '<div class="mgmt-detail-grid">' +
        '<section><h4>风险原因</h4>' + (p.riskReasons && p.riskReasons.length
          ? '<ul class="mgmt-list">' + p.riskReasons.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>'
          : '<p class="mgmt-sub">当前没有风险原因</p>') +
          (p.missingFields && p.missingFields.length ? '<h4>数据质量</h4><ul class="mgmt-list">' + p.missingFields.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '') +
        '</section>' +
        '<section><h4>按人工时</h4>' + (hours.length
          ? '<table class="mgmt-table small"><thead><tr><th>成员</th><th>预估</th><th>实际</th></tr></thead><tbody>' +
            hours.map(function(h){ return '<tr><td>' + esc(h.name) + '</td><td>' + fmtMinutesShort(h.estimateMinutes || 0) + '</td><td>' + fmtMinutesShort(h.actualMinutes || 0) + '</td></tr>'; }).join("") + '</tbody></table>'
          : '<p class="mgmt-sub">暂无工时</p>') +
        '</section>' +
      '</div>' +
      '<section><h4>风险证据</h4>' + (risks.length
        ? '<ul class="mgmt-list">' + risks.map(function(r){ return '<li><span class="tag ' + (r.severity === "red" ? "tag-danger" : "tag-warning") + '">' + (r.severity === "red" ? "红" : "黄") + '</span> ' + esc(r.reason) + '<span class="mgmt-sub"> · ' + esc(r.evidence || "") + '</span></li>'; }).join("") + '</ul>'
        : '<p class="mgmt-sub">当前没有风险证据</p>') + '</section>' +
      '<section><h4>任务（点击打开现有任务抽屉）</h4>' +
        '<div class="mgmt-table-wrap"><table class="mgmt-table small"><thead><tr><th>任务</th><th>状态</th><th>负责人</th><th>截止</th><th>进度</th><th>阻塞</th></tr></thead><tbody>' +
        tasks.map(function(t){
          return '<tr class="mgmt-row" data-mgmt-task="' + esc(t.id) + '"><td>' + esc(t.title) + '</td><td>' + esc(colText(t.boardColumn)) + '</td><td>' + esc(t.owner || "—") + '</td><td>' + esc(fmtDate(t.dueDate)) + '</td><td>' + (t.progress == null ? 0 : t.progress) + '%</td><td>' + (t.blocked ? "是" : "") + '</td></tr>';
        }).join("") + '</tbody></table></div>' +
      '</section>';
    openModal(html);
    var meta = $("mgmtDialog").querySelector("[data-mgmt-meta]");
    if (meta) meta.addEventListener("click", function(){ openMeta(id); });
    var health = $("mgmtDialog").querySelector("[data-mgmt-health]");
    if (health) health.addEventListener("click", function(){ openHealth(id); });
    var bulkTasks = $("mgmtDialog").querySelector("[data-mgmt-bulk-tasks]");
    if (bulkTasks) bulkTasks.addEventListener("click", function(){ openBulkTasks(d); });
  }).catch(function(ex){ toast(ex.message || "加载详情失败", "bad"); });
}

function openMeta(id, tried) {
  var p = mgmt.detail && mgmt.detail.project;
  if (!p) return;
  if (!mgmt.members.length && !tried && rt.currentWs) {
    /* 成员列表没拿到时不能让负责下拉只剩“未指定”，否则保存会误清空负责人 */
    API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members").then(function(list){
      mgmt.members = (list || []).filter(function(m){ return m.role === "owner" || m.role === "member"; });
      openMeta(id, true);
    }).catch(function(ex){ toast("成员列表加载失败：" + (ex.message || "网络异常"), "bad"); });
    return;
  }
  if (!mgmt.members.length) { toast("成员列表加载失败，暂不能编辑项目负责人", "bad"); return; }
  var options = '<option value="">未指定</option>' + mgmt.members.map(function(m){
    return '<option value="' + esc(m.userId) + '"' + (m.userId === p.managerUserId ? " selected" : "") + '>' + esc(m.displayName || m.username) + '</option>';
  }).join("");
  /* 负责人已不在成员列表时保留原值，避免保存时被“未指定”覆盖 */
  if (p.managerUserId && !mgmt.members.some(function(m){ return m.userId === p.managerUserId; })) {
    options += '<option value="' + esc(p.managerUserId) + '" selected>' + esc(p.manager || "非成员") + '</option>';
  }
  var priorities = ["P0","P1","P2","P3"].map(function(x){
    return '<option value="' + x + '"' + ((p.priority || "P2") === x ? " selected" : "") + '>' + x + '</option>';
  }).join("");
  openModal('<div class="mgmt-dialog-head"><div><h3>项目资料</h3><div class="mgmt-sub">' + esc(p.name) + '</div></div>' +
    '<button class="icon-btn sm" type="button" data-mgmt-close aria-label="关闭">×</button></div>' +
    '<div class="mgmt-form">' +
      '<label>项目负责人<select id="mgmtMetaManager">' + options + '</select></label>' +
      '<label>开始日期<input id="mgmtMetaStart" type="date" value="' + esc(p.startDate || "") + '"></label>' +
      '<label>截止日期<input id="mgmtMetaDue" type="date" value="' + esc(p.dueDate || "") + '"></label>' +
      '<label>优先级<select id="mgmtMetaPriority">' + priorities + '</select></label>' +
    '</div>' +
    '<div class="mgmt-dialog-foot"><button class="btn sm" type="button" data-mgmt-close>取消</button>' +
    '<button class="btn sm primary" type="button" id="mgmtMetaSave">保存</button></div>');
  $("mgmtMetaSave").addEventListener("click", function(){
    var body = {
      managerUserId: $("mgmtMetaManager").value,
      startDate: $("mgmtMetaStart").value || null,
      dueDate: $("mgmtMetaDue").value || null,
      priority: $("mgmtMetaPriority").value
    };
    API.put("/api/management/projects/" + encodeURIComponent(id) + "/meta", body).then(function(){
      toast("项目资料已保存", "fs"); closeModal(); refresh();
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}

function openHealth(id) {
  var p = mgmt.detail && mgmt.detail.project;
  if (!p) return;
  var level = p.healthOverride || "";
  function opt(v, label){
    return '<option value="' + v + '"' + (level === v ? " selected" : "") + '>' + label + '</option>';
  }
  openModal('<div class="mgmt-dialog-head"><div><h3>健康覆盖</h3><div class="mgmt-sub">' + esc(p.name) + ' · 默认 30 天有效</div></div>' +
    '<button class="icon-btn sm" type="button" data-mgmt-close aria-label="关闭">×</button></div>' +
    '<div class="mgmt-form">' +
      '<label>覆盖等级<select id="mgmtHealthLevel">' + opt("", "恢复自动") +
        opt("red", "红 · 高风险") + opt("amber", "黄 · 需关注") + opt("green", "绿 · 正常") + '</select></label>' +
      '<label>有效天数<input id="mgmtHealthDays" type="number" min="1" max="365" value="30"></label>' +
      '<label class="wide">原因（至少 5 个字）<textarea id="mgmtHealthNote" maxlength="200" rows="3">' +
        esc(p.healthNote || "") + '</textarea></label>' +
    '</div>' +
    '<div class="mgmt-dialog-foot"><button class="btn sm" type="button" data-mgmt-close>取消</button>' +
    '<button class="btn sm primary" type="button" id="mgmtHealthSave">保存</button></div>');
  $("mgmtHealthSave").addEventListener("click", function(){
    var level = $("mgmtHealthLevel").value;
    var body = {
      healthOverride: level,
      healthNote: $("mgmtHealthNote").value.trim(),
      days: Number($("mgmtHealthDays").value) || 30
    };
    API.put("/api/management/projects/" + encodeURIComponent(id) + "/health", body).then(function(){
      toast(level ? "已设置健康覆盖" : "已恢复自动", "fs"); closeModal(); refresh();
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}

function openBulkTasks(detail) {
  var tasks = (detail.tasks || []).filter(function(t){
    return t.boardColumn !== "done" && (!t.ownerUserId || !t.dueDate);
  });
  if (!tasks.length) { toast("这个项目没有缺负责人或截止日期的任务", "fs"); return; }
  var options = mgmt.members.map(function(m){
    return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username) + '</option>';
  }).join("");
  var rows = tasks.map(function(t){
    return '<label class="mgmt-task-pick"><input type="checkbox" name="mgmtTaskPick" value="' + esc(t.id) + '" checked>' +
      '<span>' + esc(t.title) + '</span><small>' +
      (!t.ownerUserId ? '缺负责人 ' : '') + (!t.dueDate ? '缺截止日期' : '') + '</small></label>';
  }).join("");
  openModal('<div class="mgmt-dialog-head"><div><h3>批量补任务资料</h3><div class="mgmt-sub">' +
    esc(detail.project.name) + ' · 只处理未完成任务的字段</div></div>' +
    '<button class="icon-btn sm" type="button" data-mgmt-close aria-label="关闭">×</button></div>' +
    '<div class="mgmt-bulk-head"><label>负责人<select id="mgmtBulkOwner"><option value="">不修改</option>' + options + '</select></label>' +
    '<label>截止日期<input id="mgmtBulkDue" type="date"></label></div>' +
    '<div class="mgmt-task-picks">' + rows + '</div>' +
    '<div class="mgmt-dialog-foot"><button class="btn sm" type="button" data-mgmt-close>取消</button>' +
    '<button class="btn sm primary" type="button" id="mgmtBulkSave">批量保存</button></div>');
  $("mgmtBulkSave").addEventListener("click", function(){
    var ids = Array.prototype.slice.call(document.querySelectorAll("input[name=mgmtTaskPick]:checked"))
      .map(function(x){ return x.value; });
    if (!ids.length) { toast("请选择任务", "warn"); return; }
    var owner = $("mgmtBulkOwner").value || null;
    var due = $("mgmtBulkDue").value || null;
    if (!owner && !due) { toast("请至少填写负责人或截止日期", "warn"); return; }
    API.post("/api/management/tasks/bulk-meta", { taskIds: ids, ownerUserId: owner, dueDate: due }).then(function(res){
      toast("已更新 " + res.updated + " 项" + (res.failed ? ("，" + res.failed + " 项失败") : ""), res.failed ? "warn" : "fs");
      closeModal();
      refresh();
      openDetail(detail.project.id);
    }).catch(function(ex){ toast(ex.message || "批量保存失败", "bad"); });
  });
}

function openModal(html) {
  $("mgmtDialog").innerHTML = html;
  $("mgmtModal").hidden = false;
}
function closeModal() {
  $("mgmtModal").hidden = true;
  $("mgmtDialog").innerHTML = "";
}

function exportWeekly() {
  var url = "/api/management/weekly-report" + (rt.currentWs ? ("?workspace=" + encodeURIComponent(rt.currentWs.id)) : "");
  fetch(url, { credentials: "same-origin" }).then(function(res){
    if (res.status === 401) { window.location.href = "/login.html"; throw new Error("未登录"); }
    if (!res.ok) throw new Error("请求失败（HTTP " + res.status + "）");
    return res.blob();
  }).then(function(blob){
    downloadBlob(blob, "管理周报-" + rt.TODAY_ISO + ".csv");
    toast("已导出管理周报", "fs");
  }).catch(function(ex){ toast("导出周报失败：" + (ex.message || "网络异常"), "bad"); });
}

function exportCsv() {
  var q = mgmt.filters;
  var params = [];
  ["riskLevel","status","manager","statusIssue","keyword"].forEach(function(k){
    if (q[k]) params.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));
  });
  if (rt.currentWs) params.push("workspace=" + encodeURIComponent(rt.currentWs.id));
  var url = "/api/management/export" + (params.length ? ("?" + params.join("&")) : "");
  fetch(url, { credentials: "same-origin" }).then(function(res){
    if (res.status === 401) { window.location.href = "/login.html"; throw new Error("未登录"); }
    if (!res.ok) throw new Error("请求失败（HTTP " + res.status + "）");
    return res.blob();
  }).then(function(blob){
    downloadBlob(blob, "管理报表-项目组合-" + rt.TODAY_ISO + ".csv");
    toast("已导出管理报表", "fs");
  }).catch(function(ex){ toast("导出失败：" + (ex.message || "网络异常"), "bad"); });
}

function downloadBlob(blob, filename) {
  var u = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(u); }, 1500);
}

/* ==================== 基础格式化 ==================== */

function riskTag(level) {
  if (level === "red") return '<span class="tag tag-danger">红 · 高风险</span>';
  if (level === "amber") return '<span class="tag tag-warning">黄 · 需关注</span>';
  if (level === "green") return '<span class="tag tag-success">绿 · 正常</span>';
  return '<span class="tag tag-ghost">未知</span>';
}
function statusText(s) {
  if (s === "done") return "已完成";
  if (s === "hold") return "已暂停";
  return "进行中";
}
function statusIssueText(s) {
  if (s === "done_without_tasks") return "已完成但无任务";
  return "已完成但仍有未完成任务";
}
function colText(c) {
  if (c === "done") return "已完成";
  if (c === "doing") return "进行中";
  if (c === "backlog") return "待处理";
  return c || "—";
}
function fmtDate(s) {
  return s ? String(s).substring(5) : "未维护";
}
function fmtTime(s) {
  return s ? String(s).replace("T", " ").substring(0, 16) : "—";
}
function skeleton(n) {
  var s = "";
  for (var i = 0; i < n; i++) s += '<div class="mgmt-kpi skel"></div>';
  return s;
}
function skeletonRows(n) {
  var s = '<div class="mgmt-empty small">加载中…</div>';
  return s;
}
function pad2(n){ return n < 10 ? "0" + n : String(n); }
function dateIso(d){ return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function mondayIso(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return dateIso(x);
}
function addDays(iso, n) {
  var p = iso.split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return dateIso(d);
}

export { enterManagementView };
