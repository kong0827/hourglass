/* views/testcases · 测试用例：用例库、执行结果标记、失败一键转缺陷 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { canEditReq, rt } from "../core/state.js";
import { loadViews, savedViewsFor } from "../core/filters-ui.js";
import { UI, esc, toast } from "../core/ui.js";
import { PRIORITIES, fmtTs, priName, priTagHTML } from "../lib/format.js";
import { loadReqs } from "./board.js";
import { openDemandDetailById } from "./demands.js";
import { downloadCsv } from "./manager-shared.js";

var cases = [];
var stats = { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
var caseTotal = 0;        /* 当前筛选下的总数（服务端） */
var caseHasMore = false;
var caseModules = [];     /* 筛选下拉候选（服务端 facets） */
var caseOwners = [];
var CASE_PAGE = 100;
var caseSearchTimer = null;
var caseReqId = null;
var statusFilter = "all";
var tcMode = "cases";
var coverageRows = [];
var reportData = null;
var reportSeq = 0;
var runsCaseId = null;
var runsCaseTitle = "";
var runsSeq = 0;
var runsList = [];
var modFilter = "all";
var priFilter = "all";
var ownerFilter = "all";
var bugOnly = false;
var searchText = "";
var editingCase = null;
var runningCaseId = null;
var defectCaseId = null;
var runStatus = "passed";
var loadSeq = 0;
/* 项目需求池条目缓存：填充「关联需求」下拉，避免每次开弹窗都请求 */
var demandOptions = { reqId: null, list: [], loading: null, error: null };
var caseSaving = false;
var caseRunning = false;
var caseDefecting = false;
var caseMoreLoading = false;
var caseFormBaseline = null;
var runFormBaseline = null;
var defectFormBaseline = null;

var STATUS_LABEL = { passed: "通过", failed: "失败", blocked: "阻塞" };
function statusBadgeHTML(s){
  if(!s) return '<span class="mini-tag mute">未执行</span>';
  var cls = { passed: "ok", failed: "over", blocked: "warn" }[s];
  return '<span class="mini-tag ' + cls + '">' + STATUS_LABEL[s] + '</span>';
}
function caseById(id){
  for(var i = 0; i < cases.length; i++) if(cases[i].id === id) return cases[i];
  return null;
}
function isWritable(){ return !!caseReqId && canEditReq(caseReqId); }

/* ---------- 加载 ---------- */

function syncReqSel(){
  var sel = $("tcReq");
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === caseReqId; });
  sel.innerHTML = list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
  if(!caseReqId && list.length) caseReqId = list[0].id;
  if(caseReqId) sel.value = caseReqId;
}
function caseQueryParams(offset){
  return {
    reqId: caseReqId,
    status: statusFilter === "all" ? null : statusFilter,
    module: modFilter === "all" ? null : modFilter,
    pri: priFilter === "all" ? null : priFilter,
    owner: ownerFilter === "all" ? null : ownerFilter,
    bug: bugOnly ? true : null,
    q: searchText || null,
    offset: offset,
    limit: CASE_PAGE
  };
}
function loadCases(){
  var seq = ++loadSeq;
  if(!caseReqId || !rt.reqList.length){
    cases = [];
    caseTotal = 0;
    caseHasMore = false;
    syncFilterOptions();
    $("tcList").innerHTML = UI.emptyState({
      icon: "folder", title: "还没有项目",
      text: "先在「项目」里创建项目，测试用例按项目收纳。"
    });
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = "";
    return Promise.resolve(false);
  }
  var reqId = caseReqId;
  $("tcList").innerHTML = UI.skeletonRows(3);
  return Promise.all([
    API.get("/api/test-cases", caseQueryParams(0)),
    API.get("/api/test-cases/stats", { reqId: reqId })
  ]).then(function(rs){
    if(seq !== loadSeq || caseReqId !== reqId) return;
    var page = rs[0] || {};
    cases = (page.items || []).slice();
    caseTotal = page.total || 0;
    caseHasMore = !!page.hasMore;
    caseModules = page.modules || [];
    caseOwners = page.owners || [];
    stats = rs[1] || { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
    render();
    return true;
  }).catch(function(ex){
    if(seq !== loadSeq) return false;
    $("tcList").innerHTML = UI.emptyState({
      icon: "alert", title: "加载失败", text: ex.message || "网络异常，请稍后重试"
    });
    return false;
  });
}
/* 滚动加载下一页：沿用当前筛选条件，按已加载条数作为 offset */
function loadMoreCases(){
  if(!caseHasMore || caseMoreLoading) return Promise.resolve(false);
  caseMoreLoading = true;
  var seq = loadSeq;
  var reqId = caseReqId;
  var btn = $("tcList").querySelector("[data-tc-more]");
  function restoreBtn(){
    var cur = $("tcList") ? $("tcList").querySelector("[data-tc-more]") : null;
    var target = cur || (btn && btn.isConnected ? btn : null);
    if(!target) return;
    target.disabled = false;
    target.textContent = "加载更多（已加载 " + cases.length + " / 共 " + caseTotal + " 条）";
  }
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  return API.get("/api/test-cases", caseQueryParams(cases.length)).then(function(page){
    caseMoreLoading = false;
    if(seq !== loadSeq || caseReqId !== reqId) return false;
    var known = {};
    cases.forEach(function(c){ known[c.id] = 1; });
    (page.items || []).forEach(function(c){ if(!known[c.id]) cases.push(c); });
    caseTotal = page.total || caseTotal;
    caseHasMore = !!page.hasMore;
    render();
    return true;
  }).catch(function(ex){
    caseMoreLoading = false;
    if(seq === loadSeq) restoreBtn();
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function enterTestCasesView(){
  syncModeUI();
  var run = function(){
    syncReqSel();
    if(tcMode === "coverage") loadCoverage();
    else if(tcMode === "report") loadTestReport();
    else if(tcMode === "plans") loadPlans();
    else loadCases();
  };
  if(rt.reqsLoaded){ run(); return; }
  $("tcList").innerHTML = UI.skeletonRows(3);
  loadReqs().then(function(){
    if(rt.reqsLoaded){ run(); return; }
    /* 首屏并发：别的调用先占了 seq，本次回调被跳过，reqList 还没填充，再等一轮 */
    loadReqs().then(run);
  });
}

/* ---------- 覆盖矩阵 ---------- */
function loadCoverage(){
  render();
  if(!caseReqId) return;
  $("tcCoverage").innerHTML = UI.skeletonRows(4);
  API.get("/api/test-cases/coverage", { reqId: caseReqId }).then(function(rows){
    if(tcMode !== "coverage") return;
    coverageRows = rows || [];
    renderCoverage();
  }).catch(function(ex){
    $("tcCoverage").innerHTML = UI.errorState(ex.message || "网络异常");
  });
}
function renderCoverage(){
  var box = $("tcCoverage");
  if(!box) return;
  var covered = 0, total = 0;
  coverageRows.forEach(function(r){
    if(r.demandId){ total++; if((r.caseTotal || 0) > 0) covered++; }
  });
  var head = '<div class="cov-summary">已覆盖需求 <b>' + covered + '</b> / ' + total +
    (total ? '（' + Math.round(covered * 100 / total) + '%）' : '') +
    '<span class="cov-note">覆盖率按「该需求至少有一条用例」计算</span></div>';
  if(!coverageRows.length){
    box.innerHTML = head + UI.emptyState({ icon:"checklist", title:"还没有可对照的需求或用例", text:"先录入需求池需求与测试用例，覆盖矩阵会自动汇总。" });
    return;
  }
  var rows = coverageRows.map(function(r){
    var total = r.caseTotal || 0;
    var pct = total ? Math.round((r.passed || 0) * 100 / total) : 0;
    var covTxt = !r.demandId ? "—" : (total ? "已覆盖" : "未覆盖");
    var covCls = !r.demandId ? "mute" : (total ? "ok" : "over");
    var linked = !!r.demandId;
    return '<div class="cov-row' + (linked ? " cov-link" : " cov-unlinked") + '"' +
      (linked ? ' role="button" tabindex="0" data-cov-demand="' + esc(r.demandId) + '" title="'
        + (total ? "查看需求详情" : "该需求还没有用例，点击查看需求详情") + '"' : '') + '>' +
      '<span class="cov-name"><b>' + esc(r.demandTitle || "未命名需求") + '</b>' +
        (r.demandId ? '<small>' + esc(demandStatusLabel(r.demandStatus)) + '</small>' : '') + '</span>' +
      '<span>' + total + '</span>' +
      '<span class="cov-pass">' + (r.passed || 0) + '</span>' +
      '<span class="cov-fail">' + (r.failed || 0) + '</span>' +
      '<span class="cov-block">' + (r.blocked || 0) + '</span>' +
      '<span>' + (r.untested || 0) + '</span>' +
      '<span class="cov-bug">' + (r.bugCount || 0) + '</span>' +
      '<span><i class="cov-bar"><i style="width:' + pct + '%"></i></i>' + pct + '%</span>' +
      '<span class="mini-tag ' + covCls + '">' + covTxt + '</span>' +
    '</div>';
  }).join("");
  box.innerHTML = head + '<div class="cov-table">' +
    '<div class="cov-head"><span>需求</span><span>用例</span><span>通过</span><span>失败</span><span>阻塞</span><span>未执行</span><span>缺陷</span><span>通过率</span><span>覆盖</span></div>' +
    rows + '</div>';
}

/* ---------- 测试报告 ---------- */

function reqNameOf(id){
  var hit = (rt.reqList || []).filter(function(r){ return r.id === id; })[0];
  return hit ? hit.name : (id || "");
}
function loadTestReport(){
  render();
  var box = $("tcReport");
  if(!caseReqId){
    box.innerHTML = UI.emptyState({ icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目，再生成测试报告。" });
    return;
  }
  var seq = ++reportSeq;
  var reqId = caseReqId;
  box.innerHTML = UI.skeletonRows(4);
  Promise.all([
    API.get("/api/test-cases/stats", { reqId: reqId }),
    API.get("/api/test-cases", { reqId: reqId, status: "failed", limit: 500, offset: 0 }),
    API.get("/api/test-cases", { reqId: reqId, status: "blocked", limit: 200, offset: 0 }),
    API.get("/api/test-cases/coverage", { reqId: reqId })
  ]).then(function(rs){
    if(seq !== reportSeq || caseReqId !== reqId) return;
    reportData = {
      stats: rs[0] || {},
      failed: (rs[1] && rs[1].items) || [],
      failedTotal: (rs[1] && rs[1].total) || 0,
      blocked: (rs[2] && rs[2].items) || [],
      blockedTotal: (rs[2] && rs[2].total) || 0,
      coverage: rs[3] || [],
      generatedAt: new Date()
    };
    renderTestReport();
  }).catch(function(ex){
    if(seq !== reportSeq) return;
    box.innerHTML = UI.errorState(ex.message || "测试报告加载失败");
  });
}
function coverageSummary(rows){
  var total = 0, covered = 0;
  (rows || []).forEach(function(r){
    if(!r.demandId) return;
    total++;
    if((r.caseTotal || 0) > 0) covered++;
  });
  return { total: total, covered: covered, pct: total ? Math.round(covered * 100 / total) : 0 };
}
function caseMetaLine(c){
  var parts = [];
  if(c.module) parts.push(c.module);
  if(c.priority) parts.push(priName(c.priority));
  if(c.latestBy) parts.push(c.latestBy + (c.latestAt ? " · " + fmtTs(c.latestAt) : ""));
  if(c.demandTitle) parts.push("需求：" + c.demandTitle);
  return parts.map(esc).join(" · ");
}
function reportCaseRow(c, kind){
  var bug = c.latestBugTaskId
    ? '<button class="btn sm ghost" type="button" data-report-bug="' + esc(c.id) + '" title="打开关联缺陷">缺陷 · ' + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 16)) + '</button>'
    : "";
  var ev = c.latestEvidenceCount
    ? '<button class="btn sm ghost" type="button" data-report-runs="' + esc(c.id) + '" title="查看执行历史与证据">证据 ' + c.latestEvidenceCount + '</button>'
    : '<button class="btn sm ghost" type="button" data-report-runs="' + esc(c.id) + '" title="查看执行历史">记录</button>';
  return '<div class="rep-row ' + kind + '">'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="rep-main"><button class="rep-title" type="button" data-report-case="' + esc(c.id) + '" title="打开用例"><b>' + esc(c.title) + '</b></button><small>' + caseMetaLine(c) + '</small>'
    + (c.latestNote ? '<span class="rep-note">' + esc(c.latestNote) + '</span>' : '')
    + '</div>'
    + '<div class="rep-acts">' + bug + ev + '</div>'
    + '</div>';
}
function reportCaseById(id){
  var pools = [reportData && reportData.failed, reportData && reportData.blocked];
  for(var i = 0; i < pools.length; i++){
    var list = pools[i] || [];
    for(var j = 0; j < list.length; j++) if(list[j].id === id) return list[j];
  }
  return null;
}
/* 报告里的用例可能不在当前列表页，按标题回查一次，再兜底全量前 500 条 */
function openReportCase(id){
  if(caseById(id)){ openEditDialog(id); return; }
  if(!caseReqId){ toast("先选择项目再打开用例", "warn"); return; }
  var reqId = caseReqId, meta = reportCaseById(id);
  function openFound(c){
    if(!c) return false;
    if(!caseById(c.id)) cases.push(c);
    openEditDialog(c.id);
    return true;
  }
  API.get("/api/test-cases", { reqId: reqId, q: (meta && meta.title) || null, limit: 50, offset: 0 }).then(function(page){
    if(caseReqId !== reqId) return;
    var found = ((page && page.items) || []).filter(function(c){ return c.id === id; })[0];
    if(openFound(found)) return;
    return API.get("/api/test-cases", { reqId: reqId, limit: 500, offset: 0 }).then(function(all){
      if(caseReqId !== reqId) return;
      var hit = ((all && all.items) || []).filter(function(c){ return c.id === id; })[0];
      if(!openFound(hit)) toast("用例不存在或无权查看", "warn");
    });
  }).catch(function(ex){ toast(ex.message || "用例加载失败", "warn"); });
}
function renderTestReport(){
  var box = $("tcReport");
  if(!box || !reportData) return;
  var s = reportData.stats || {};
  var total = s.total || 0;
  var passRate = total ? Math.round((s.passed || 0) * 100 / total) : 0;
  var cov = coverageSummary(reportData.coverage);
  var failed = reportData.failed || [];
  var blocked = reportData.blocked || [];
  var name = reqNameOf(caseReqId);
  var stamp = reportData.generatedAt.toLocaleString("zh-CN", { hour12: false });
  var head = '<div class="rep-head">'
    + '<div><h3>测试报告 · ' + esc(name) + '</h3><p class="foot-note">生成时间 ' + esc(stamp) + ' · 口径：每个用例取最近一轮执行结果</p></div>'
    + '<div class="rep-actions">'
    +   '<button class="btn sm" type="button" data-tc-report-csv>导出 CSV</button>'
    +   '<button class="btn sm" type="button" data-tc-report-print>打印 / 存 PDF</button>'
    + '</div>'
    + '</div>';
  var tiles = '<div class="rep-tiles">'
    + '<span class="tc-stat"><b>' + total + '</b>用例总数</span>'
    + '<span class="tc-stat ok"><b>' + (s.passed || 0) + '</b>通过 · ' + passRate + '%</span>'
    + '<span class="tc-stat over"><b>' + (s.failed || 0) + '</b>失败</span>'
    + '<span class="tc-stat warn"><b>' + (s.blocked || 0) + '</b>阻塞</span>'
    + '<span class="tc-stat mute"><b>' + (s.untested || 0) + '</b>未执行</span>'
    + '<span class="tc-stat"><b>' + cov.pct + '%</b>需求覆盖（' + cov.covered + '/' + cov.total + '）</span>'
    + '</div>';
  var failBlock = '<section class="rep-section"><div class="rep-section-head"><b>失败用例</b><span>'
    + (reportData.failedTotal || 0) + ' 条</span></div>'
    + (failed.length
      ? failed.map(function(c){ return reportCaseRow(c, "fail"); }).join("")
      : '<p class="rep-empty">没有失败用例，最近一轮全部通过或未执行。</p>')
    + ((reportData.failedTotal || 0) > failed.length
      ? '<p class="foot-note">报告最多列出 500 条失败用例，当前展示 ' + failed.length + ' 条。</p>' : '')
    + '</section>';
  var blockBlock = blocked.length
    ? '<section class="rep-section"><div class="rep-section-head"><b>阻塞用例</b><span>'
      + (reportData.blockedTotal || 0) + ' 条</span></div>'
      + blocked.map(function(c){ return reportCaseRow(c, "block"); }).join("")
      + '</section>'
    : "";
  var covBlock = '';
  if(cov.total){
    covBlock = '<section class="rep-section"><div class="rep-section-head"><b>需求覆盖</b><span>'
      + cov.covered + ' / ' + cov.total + '（' + cov.pct + '%）</span></div>'
      + '<div class="rep-cov">' + reportData.coverage.filter(function(r){ return r.demandId; }).map(function(r){
        var ok = (r.caseTotal || 0) > 0;
        return '<div class="rep-cov-row rep-cov-link" role="button" tabindex="0" data-cov-demand="' + esc(r.demandId) + '" title="查看需求详情"><span>' + esc(r.demandTitle || "未命名需求") + '</span>'
          + '<span>' + (r.caseTotal || 0) + ' 用例 · ' + (r.passed || 0) + ' 通过 · ' + (r.failed || 0) + ' 失败</span>'
          + '<span class="mini-tag ' + (ok ? "ok" : "over") + '">' + (ok ? "已覆盖" : "未覆盖") + '</span></div>';
      }).join("") + '</div></section>';
  }
  box.innerHTML = head + tiles + failBlock + blockBlock + covBlock
    + '<p class="foot-note">证据附件在执行历史中随执行记录保存；报告导出与打印均基于当前项目与最近一轮结果。</p>';
}
function reportPlainRows(){
  if(!reportData) return [];
  var s = reportData.stats || {};
  var total = s.total || 0;
  var cov = coverageSummary(reportData.coverage);
  var rows = [
    ["测试报告", reqNameOf(caseReqId)],
    ["生成时间", reportData.generatedAt.toLocaleString("zh-CN", { hour12: false })],
    ["用例总数", total],
    ["通过", s.passed || 0],
    ["失败", s.failed || 0],
    ["阻塞", s.blocked || 0],
    ["未执行", s.untested || 0],
    ["通过率", (total ? Math.round((s.passed || 0) * 100 / total) : 0) + "%"],
    ["需求覆盖", cov.covered + "/" + cov.total + "（" + cov.pct + "%）"],
    [],
    ["失败用例", "模块", "优先级", "最近执行", "备注", "证据数", "缺陷"]
  ];
  (reportData.failed || []).forEach(function(c){
    rows.push([c.title, c.module || "", c.priority || "", (c.latestBy || "") + (c.latestAt ? " " + fmtTs(c.latestAt) : ""),
      c.latestNote || "", c.latestEvidenceCount || 0, c.latestBugTaskTitle || c.latestBugTaskId || ""]);
  });
  return rows;
}
function exportTestReport(){
  if(!reportData){ toast("报告还没有加载完成", "warn"); return; }
  downloadCsv("测试报告-" + reqNameOf(caseReqId) + ".csv", reportPlainRows());
  toast("已导出测试报告 CSV", "fs");
}
function printTestReport(){
  if(!reportData){ toast("报告还没有加载完成", "warn"); return; }
  var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试报告 · '
    + esc(reqNameOf(caseReqId)) + '</title><style>'
    + 'body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828;padding:28px;}'
    + 'h3{margin:0 0 4px;font-size:20px;}.rep-actions,.foot-note,.rep-acts{display:none!important;}'
    + '.rep-tiles{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;}.tc-stat{border:1px solid #E4E7EC;border-radius:6px;padding:6px 10px;font-size:12px;color:#475467;}'
    + '.tc-stat b{font-size:16px;margin-right:6px;color:#101828;}.tc-stat.ok b{color:#12B76A;}.tc-stat.over b{color:#D92D20;}.tc-stat.warn b{color:#F79009;}'
    + '.rep-section{margin-top:18px;border:1px solid #E4E7EC;border-radius:8px;padding:12px 14px;break-inside:avoid;}'
    + '.rep-section-head{display:flex;justify-content:space-between;border-bottom:1px solid #E4E7EC;padding-bottom:8px;margin-bottom:8px;}'
    + '.rep-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #F2F4F7;}.rep-row:last-child{border-bottom:0;}'
    + '.rep-main{flex:1;min-width:0;}.rep-main b{display:block;font-size:13px;}.rep-main small{display:block;color:#667085;font-size:11.5px;}'
    + '.rep-note{display:block;margin-top:3px;color:#475467;font-size:12px;}.rep-acts{font-size:11px;color:#667085;white-space:nowrap;}'
    + '.mini-tag{border:1px solid #E4E7EC;border-radius:999px;padding:1px 7px;font-size:11px;}.mini-tag.ok{color:#027A48;border-color:#A6F4C5;}.mini-tag.over{color:#B42318;border-color:#FECDCA;}.mini-tag.warn{color:#B54708;border-color:#FEDF89;}'
    + '.rep-empty{color:#667085;font-size:12.5px;}.rep-cov-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F2F4F7;font-size:12.5px;}'
    + '.rep-cov-row span:first-child{flex:1;min-width:0;}.rep-cov-row span:nth-child(2){color:#667085;white-space:nowrap;}'
    + '</style></head><body><h3>测试报告 · ' + esc(reqNameOf(caseReqId)) + '</h3>'
    + '<p style="color:#667085;font-size:12px;margin:0 0 4px">生成时间 ' + esc(reportData.generatedAt.toLocaleString("zh-CN", { hour12: false })) + ' · 口径：最近一轮执行结果</p>'
    + ($("tcReport").querySelector(".rep-tiles") ? $("tcReport").querySelector(".rep-tiles").outerHTML : "")
    + Array.prototype.map.call($("tcReport").querySelectorAll(".rep-section"), function(el){ return el.outerHTML; }).join("")
    + '</body></html>';
  var frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  var doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(function(){
    try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ /* 打印被拦截时保持静默 */ }
    setTimeout(function(){ frame.remove(); }, 1500);
  }, 120);
}

/* ---------- 执行历史与证据 ---------- */

function csrfCookie(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function attUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function attThumbUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function fmtSize(n){
  if(!n && n !== 0) return "";
  if(n < 1024) return n + " B";
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function evidenceHTML(a, writable){
  var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
  var del = writable
    ? '<button class="icon-btn sm danger" type="button" data-run-att-del="' + esc(a.id) + '" title="删除证据" aria-label="删除证据">' + icon("trash", 13) + '</button>'
    : "";
  return '<span class="run-ev' + (isImg ? " is-img" : "") + '">'
    + (isImg
      ? '<a href="' + attUrl(a.id) + '" target="_blank" rel="noopener" title="' + esc(a.filename) + '"><img src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" /></a>'
      : '<a class="run-ev-file" href="' + attUrl(a.id) + '" target="_blank" rel="noopener" title="' + esc(a.filename) + '">' + icon("download", 13) + '<span>' + esc(cut(a.filename, 12)) + '</span></a>')
    + del + '</span>';
}
function openRunsDialog(id, title){
  var c = caseById(id);
  runsCaseId = id;
  runsCaseTitle = title || (c ? c.title : "");
  runsList = [];
  $("runsTitle").textContent = "执行历史 · " + cut(runsCaseTitle, 18);
  $("runsSub").textContent = "最近在前；失败证据随执行记录保存。";
  $("runsList").innerHTML = UI.skeletonRows(3);
  $("runsReadonlyHint").hidden = isWritable();
  var seq = ++runsSeq;
  UI.openModal($("dlgCaseRuns"));
  API.get("/api/test-cases/" + encodeURIComponent(id) + "/runs", { limit: 50 }).then(function(list){
    if(seq !== runsSeq) return;
    runsList = list || [];
    renderRuns();
  }).catch(function(ex){
    if(seq === runsSeq) $("runsList").innerHTML = UI.errorState(ex.message || "执行历史加载失败");
  });
}
function renderRuns(){
  var box = $("runsList");
  if(!box) return;
  if(!runsList.length){
    box.innerHTML = '<p class="rep-empty">还没有执行记录；点用例上的「执行」记录第一次结果。</p>';
    return;
  }
  var writable = isWritable();
  box.innerHTML = runsList.map(function(r){
    var atts = r.attachments || [];
    var ev = atts.length
      ? '<div class="run-evs">' + atts.map(function(a){ return evidenceHTML(a, writable); }).join("") + '</div>'
      : "";
    var upload = writable
      ? '<label class="btn sm ghost run-ev-add" title="上传失败证据">' + icon("plus", 12) + ' 证据'
        + '<input type="file" hidden data-run-file="' + esc(r.id) + '" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" /></label>'
      : "";
    var bug = r.bugTaskId
      ? '<button class="btn sm ghost" type="button" data-run-bug="' + esc(r.bugTaskId) + '">缺陷工作项</button>'
      : "";
    return '<div class="run-item">'
      + '<div class="run-top">' + statusBadgeHTML(r.status)
      +   '<span class="run-by">' + esc(r.executedBy || "—") + '</span>'
      +   '<span class="run-at">' + esc(fmtTs(r.createdAt) || "—") + '</span>'
      +   '<span class="run-acts">' + bug + upload + '</span>'
      + '</div>'
      + (r.note ? '<p class="run-note">' + esc(r.note) + '</p>' : '')
      + ev
      + '</div>';
  }).join("");
}
function uploadRunEvidence(caseId, runId, file){
  if(file.size > 10 * 1024 * 1024){ toast("文件超过 10MB，未上传", "warn"); return; }
  var fd = new FormData();
  fd.append("file", file);
  var url = API.url("/api/test-cases/" + encodeURIComponent(caseId) + "/runs/"
    + encodeURIComponent(runId) + "/attachments"
    + (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    if(json && json.code === 0){
      toast("证据已上传", "fs");
      openRunsDialog(caseId, runsCaseTitle);
      loadCases();
    }else{
      toast((json && json.message) || "上传失败", "bad");
    }
  }).catch(function(ex){ toast(ex && ex.message ? ex.message : "上传失败", "bad"); });
}

/* ---------- 渲染 ---------- */

function render(){
  syncModeUI();
  renderStats();
  if(tcMode === "plans"){
    $("tcList").hidden = true;
    $("tcCoverage").hidden = true;
    $("tcReport").hidden = true;
    $("tcPlans").hidden = false;
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = caseReqId ? "圈选 → 批量执行 → 完成留痕" : "";
    return;
  }
  if(tcMode === "coverage"){
    $("tcList").hidden = true;
    $("tcCoverage").hidden = false;
    $("tcReport").hidden = true;
    $("tcPlans").hidden = true;
    $("tcMeta").textContent = caseReqId ? "需求 × 用例 × 缺陷" : "";
    return;
  }
  if(tcMode === "report"){
    $("tcList").hidden = true;
    $("tcCoverage").hidden = true;
    $("tcReport").hidden = false;
    $("tcPlans").hidden = true;
    $("tcMeta").textContent = caseReqId ? "最近一轮执行结果汇总" : "";
    return;
  }
  $("tcList").hidden = false;
  $("tcCoverage").hidden = true;
  $("tcReport").hidden = true;
  $("tcPlans").hidden = true;
  syncFilterOptions();
  var rows = cases;
  var anyFilter = statusFilter !== "all" || modFilter !== "all" || priFilter !== "all"
    || ownerFilter !== "all" || bugOnly || !!searchText;
  var metaText = "";
  if(stats && stats.total){
    metaText = anyFilter ? ("筛选出 " + caseTotal + " / " + stats.total + " 条用例") : ("共 " + stats.total + " 条用例");
    if(cases.length < caseTotal) metaText += " · 已加载 " + cases.length + " 条";
  }
  $("tcMeta").textContent = metaText;
  if(!rows.length){
    $("tcList").innerHTML = UI.emptyState({
      icon: anyFilter ? "filterOff" : "checklist",
      title: searchText ? "没有匹配的用例" : (anyFilter ? "没有符合条件的用例" : "还没有测试用例"),
      text: searchText ? "换个关键词或清空搜索试试" : (anyFilter ? "换个筛选条件试试" : "点右上角「新增用例」录入第一条，执行后按结果统计。")
    });
    return;
  }
  var html = rows.map(caseRowHTML).join("");
  if(caseHasMore){
    html += '<button class="btn ghost tc-load-more" type="button" data-tc-more>加载更多（已加载 '
      + cases.length + ' / 共 ' + caseTotal + ' 条）</button>';
  }
  $("tcList").innerHTML = html;
}
function fillFilterSelect(id, allLabel, values, noneLabel, state){
  var sel = $(id);
  var html = '<option value="all">' + allLabel + '</option>';
  values.forEach(function(v){
    html += '<option value="' + esc(v) + '">' + esc(v) + '</option>';
  });
  if(noneLabel){
    html += '<option value="__none">' + noneLabel + '</option>';
  }
  sel.innerHTML = html;
  var valid = state() === "all" || state() === "__none" || values.indexOf(state()) !== -1;
  if(!valid) state("all");
  sel.value = state();
}
function syncFilterOptions(){
  /* 候选值来自服务端 facets，不受当前筛选与已加载条数影响 */
  var modules = caseModules;
  var owners = caseOwners;
  fillFilterSelect("tcModule", "模块：全部", modules, "未填模块", function(v){
    if(v === undefined) return modFilter;
    modFilter = v;
  });
  fillFilterSelect("tcOwner", "执行人：全部", owners, null, function(v){
    if(v === undefined) return ownerFilter;
    ownerFilter = v;
  });
  fillFilterSelect("tcPri", "优先级：全部", PRIORITIES, "未设置", function(v){
    if(v === undefined) return priFilter;
    priFilter = v;
  });
  $("tcModuleList").innerHTML = modules.map(function(m){
    return '<option value="' + esc(m) + '"></option>';
  }).join("");
  $("tcBug").classList.toggle("primary", bugOnly);
  $("tcBug").setAttribute("aria-pressed", bugOnly ? "true" : "false");
}
function renderStats(){
  var s = stats || {};
  var items = [
    [s.total, "总计", ""],
    [s.untested, "未执行", "mute"],
    [s.passed, "通过", "ok"],
    [s.failed, "失败", "over"],
    [s.blocked, "阻塞", "warn"]
  ];
  $("tcStats").innerHTML = items.map(function(it){
    return '<span class="tc-stat ' + it[2] + '"><b>' + it[0] + '</b>' + it[1] + '</span>';
  }).join("");
}

/* ---------- 用例保存视图（scope=testcase：项目 / 执行结果 / 筛选 / 展示方式） ---------- */

var tcViewsMenuEl = $("tcViewsMenu");
function tcViewParams(){
  return {
    scope: "testcase", reqId: caseReqId || "", status: statusFilter,
    module: modFilter, pri: priFilter, owner: ownerFilter,
    bug: !!bugOnly, q: searchText || "", mode: tcMode
  };
}
function tcViewMeaningful(p){
  return !!(p.reqId || p.status !== "all" || p.module !== "all" || p.pri !== "all"
    || p.owner !== "all" || p.bug || p.q || p.mode === "coverage" || p.mode === "report" || p.mode === "plans");
}
function applyTcView(v){
  var p;
  try{ p = JSON.parse(v.params || "{}"); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "testcase" || (p.mode && p.mode !== "cases" && p.mode !== "coverage"
    && p.mode !== "report" && p.mode !== "plans")){
    toast("视图参数不合法，无法应用（可删除后重新保存）", "bad");
    return;
  }
  if(p.reqId && rt.reqList.some(function(r){ return r.id === p.reqId; })) caseReqId = p.reqId;
  statusFilter = typeof p.status === "string" && p.status ? p.status : "all";
  modFilter = typeof p.module === "string" && p.module ? p.module : "all";
  priFilter = typeof p.pri === "string" && p.pri ? p.pri : "all";
  ownerFilter = typeof p.owner === "string" && p.owner ? p.owner : "all";
  bugOnly = !!p.bug;
  searchText = typeof p.q === "string" ? p.q.toLowerCase() : "";
  tcMode = p.mode === "coverage" ? "coverage"
    : (p.mode === "report" ? "report" : (p.mode === "plans" ? "plans" : "cases"));
  if($("tcSearch")) $("tcSearch").value = searchText;
  syncReqSel();
  syncModeUI();
  if(tcMode === "coverage") loadCoverage();
  else if(tcMode === "report") loadTestReport();
  else if(tcMode === "plans") loadPlans();
  else loadCases();
  toast("已应用视图「" + v.name + "」", "fs");
}
function saveTcView(){
  var p = tcViewParams();
  if(!tcViewMeaningful(p)){ toast("先选择项目或设置筛选条件，再保存视图", "warn"); return; }
  UI.showPrompt({
    title: "保存用例视图",
    desc: "保存当前项目、执行结果与筛选条件；同名保存将覆盖原视图",
    label: "视图名称（≤20 字）", maxLength: 20, okText: "保存"
  }).then(function(name){
    if(!name) return;
    var overwrite = savedViewsFor("testcase").some(function(v){ return v.name === name; });
    API.post("/api/views", { name: name, params: JSON.stringify(p) }).then(function(){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(renderTcViewsMenu);
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteTcView(id){
  UI.showConfirm({ title: "删除视图", msg: "确定删除该用例视图？不影响用例数据。", okText: "删除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      loadViews().then(renderTcViewsMenu);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function renderTcViewsMenu(){
  if(!tcViewsMenuEl) return;
  var views = savedViewsFor("testcase");
  var html = '<div class="menu-title">用例视图</div>';
  if(!views.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的用例视图；选定项目或筛选条件后保存。</p></div>';
  }else{
    html += views.map(function(v){
      return '<div class="menu-row">' +
        '<button class="menu-item" type="button" data-tc-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
        '<button class="icon-btn sm" type="button" data-tc-view-del="' + esc(v.id) + '" aria-label="删除视图" title="删除视图">' + icon("close", 12) + '</button>' +
      '</div>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-tc-view-save>保存当前为视图</button></div>';
  tcViewsMenuEl.innerHTML = html;
}
/* 测试四模式已并到全局子导航：模式切换后同步高亮，避免还要维护页内分段 */
function syncTcSubnav(){
  if(document.body.dataset.view !== "testcases") return;
  var el = document.getElementById("subNav");
  if(!el) return;
  el.querySelectorAll("[data-sub-tab]").forEach(function(b){
    var on = b.dataset.subTab === tcMode;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
}
function setTcMode(mode){
  if(mode !== "cases" && mode !== "plans" && mode !== "coverage" && mode !== "report") return;
  if(mode === tcMode){ syncModeUI(); return; }
  tcMode = mode;
  syncModeUI();
  if(tcMode === "coverage") loadCoverage();
  else if(tcMode === "report") loadTestReport();
  else if(tcMode === "plans") loadPlans();
  else { render(); loadCases(); }
}
function currentTcMode(){ return tcMode; }
function syncModeUI(){
  var cov = tcMode === "coverage";
  var rep = tcMode === "report";
  var plan = tcMode === "plans";
  var view = $("view-testcases");
  if(view){
    view.classList.toggle("cov-mode", cov);
    view.classList.toggle("rep-mode", rep);
    view.classList.toggle("plans-mode", plan);
  }
  document.querySelectorAll("#tcModeSeg [data-tc-mode]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.tcMode === tcMode ? "true" : "false");
  });
  syncTcSubnav();
  var bn = $("btnCaseNew");
  if(bn) bn.style.display = isWritable() && !cov && !rep && !plan ? "" : "none";
  /* 手机把筛选收进可展开面板：非用例模式没有筛选内容，入口一并收起 */
  var filterBtn = $("tcFilterBtn"), filterBar = $("tcFilterBar");
  if(filterBtn) filterBtn.style.display = tcMode === "cases" ? "" : "none";
  if(tcMode !== "cases" && filterBar && filterBar.classList.contains("is-open")){
    filterBar.classList.remove("is-open");
    if(filterBtn) filterBtn.setAttribute("aria-expanded", "false");
  }
  var csvOut = $("btnCaseCsvOut"), csvIn = $("btnCaseCsvIn"), planNew = $("btnPlanNew");
  if(csvOut) csvOut.style.display = tcMode === "cases" && caseReqId ? "" : "none";
  if(csvIn) csvIn.style.display = tcMode === "cases" && isWritable() ? "" : "none";
  /* 该按钮初始带 hidden 属性，而全局 [hidden]{display:none!important} 优先级高于行内 display，
     必须切 hidden 本身，改 style.display 永远显示不出来。
     计划 tab 下始终可见：没选项目时点按给提示，而不是让入口整个消失。 */
  if(planNew) planNew.hidden = !plan;
  document.querySelectorAll("#tcStatusSeg [data-tc-status]").forEach(function(b){
    var on = b.dataset.tcStatus === statusFilter;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function caseRowHTML(c){
  var meta = [];
  var stepCount = (c.steps || []).length;
  if(c.module) meta.push(c.module);
  if(c.demandTitle) meta.push("需求：" + cut(c.demandTitle, 30));
  meta.push(stepCount ? (stepCount + " 步") : "无步骤");
  if(c.precondition) meta.push("前置：" + cut(c.precondition, 36));
  if(c.latestStatus){
    meta.push((c.latestBy || "—") + " " + (c.latestAt ? fmtTs(c.latestAt) : ""));
  }
  if(c.latestEvidenceCount) meta.push("证据 " + c.latestEvidenceCount);
  var w = isWritable();
  var acts = "";
  acts += '<button class="btn sm ghost" type="button" data-tc-runs="' + esc(c.id) + '" title="查看执行历史与失败证据">'
    + icon("clock", 13) + ' 记录</button>';
  if(w){
    acts += '<button class="btn sm" type="button" data-tc-run="' + esc(c.id) + '">' + icon("play", 13) + ' 执行</button>';
  }
  if(c.latestBugTaskId){
    acts += '<button class="btn sm ghost" type="button" data-tc-bug="' + esc(c.id) + '" title="打开关联缺陷">'
      + '缺陷 · ' + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 14)) + '</button>';
  }else if(w && c.latestStatus === "failed"){
    acts += '<button class="btn sm ghost danger" type="button" data-tc-defect="' + esc(c.id) + '">转缺陷</button>';
  }
  if(w){
    acts += '<span class="tc-secondary">'
      + '<button class="btn sm ghost" type="button" data-tc-edit="' + esc(c.id) + '">' + icon("edit", 13) + ' 编辑</button>'
      + '<button class="icon-btn sm" type="button" data-tc-del="' + esc(c.id) + '" aria-label="删除用例">' + icon("trash", 14) + '</button>'
      + '</span>';
  }
  return '<div class="tc-row" data-tc-open="' + esc(c.id) + '">'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="tc-main">'
    +   '<div class="tc-title">' + esc(c.title) + (c.priority ? ' <span class="tc-pri">' + priTagHTML(c.priority) + '</span>' : "") + '</div>'
    +   '<div class="tc-meta">' + meta.map(esc).join(" · ") + '</div>'
    +   (c.latestNote ? '<div class="tc-note">' + esc(c.latestNote) + '</div>' : "")
    + '</div>'
    + '<div class="tc-acts">' + acts + '</div>'
    + '</div>';
}
function cut(s, n){
  s = String(s || "");
  return s.length > n ? s.substring(0, n) + "…" : s;
}

/* ---------- 用例编辑 ---------- */

function demandStatusLabel(st){
  return { review:"待评审", pass:"已通过", plan:"已排期", rej:"已拒绝" }[st] || st || "";
}
function demandPickLabel(d){
  var tag = demandStatusLabel(d.status);
  return d.title + (tag ? "（" + tag + "）" : "");
}
function loadDemandOptions(reqId){
  if(!reqId) return Promise.resolve([]);
  if(demandOptions.reqId === reqId && demandOptions.loading) return demandOptions.loading;
  if(demandOptions.reqId === reqId && demandOptions.list.length && !demandOptions.error) return Promise.resolve(demandOptions.list);
  demandOptions.reqId = reqId;
  demandOptions.list = [];
  demandOptions.error = null;
  demandOptions.loading = API.get("/api/demands", { reqId: reqId }).then(function(list){
    if(demandOptions.reqId === reqId){
      demandOptions.list = list || [];
      demandOptions.error = null;
    }
    demandOptions.loading = null;
    return demandOptions.list;
  }).catch(function(ex){
    /* 失败不能返回 []：调用方会把"加载失败"当成"确实没有需求"并清空关联 */
    if(demandOptions.reqId === reqId){
      demandOptions.list = [];
      demandOptions.error = ex || new Error("需求候选加载失败");
    }
    demandOptions.loading = null;
    return null;
  });
  return demandOptions.loading;
}
function fillDemandSelect(selected, fallbackLabel){
  var sel = $("cDemand");
  if(demandOptions.error){
    var keep = selected || "";
    sel.innerHTML = keep
      ? '<option value="' + esc(keep) + '">' + esc(fallbackLabel || "原关联需求") + '（需求列表加载失败，已保留）</option>'
      : '<option value="">需求列表加载失败，暂无法选择（可重试）</option>';
    sel.value = keep;
    sel.dataset.loadError = "1";
    return;
  }
  delete sel.dataset.loadError;
  var list = (demandOptions.reqId === caseReqId && demandOptions.list) ? demandOptions.list : [];
  var valid = selected && list.some(function(d){ return d.id === selected; });
  sel.innerHTML = '<option value="">不关联</option>'
    + list.map(function(d){
      return '<option value="' + esc(d.id) + '">' + esc(demandPickLabel(d)) + '</option>';
    }).join("");
  sel.value = valid ? selected : "";
  if(selected && !valid && list.length) sel.value = "";
}
function demandOptionsFailedMessage(){
  return "关联需求加载失败，已保留原有需求；可关闭后重新打开用例再试";
}
function setDemandLoading(){
  $("cDemand").innerHTML = '<option value="">需求加载中…</option>';
  $("cDemand").value = "";
}
/* 优先级档位固定 P0-P3，显示名随空间优先级配置变化，开弹窗时刷新 */
function syncPriOptions(){
  $("cPri").innerHTML = '<option value="">不设置</option>'
    + PRIORITIES.map(function(p){
      return '<option value="' + p + '">' + p + ' · ' + esc(priName(p)) + '</option>';
    }).join("");
}

function openNewDialog(){
  editingCase = { id: null, steps: [{ action: "", expected: "" }] };
  $("caseFormTitle").textContent = "新增用例";
  $("cTitle").value = "";
  $("cModule").value = "";
  syncPriOptions();
  $("cPri").value = "";
  $("cPrecondition").value = "";
  setDemandLoading();
  loadDemandOptions(caseReqId).then(function(list){
    if(!editingCase || editingCase.id) return;
    fillDemandSelect("");
    syncCaseDemandBaseline();
    if(list === null) toast(demandOptionsFailedMessage(), "warn");
  });
  renderStepRows();
  applyReadOnly(!isWritable());
  caseFormBaseline = caseFormSnapshot();
  UI.openModal($("dlgCase"), "input");
}
function openEditDialog(id){
  var c = caseById(id);
  if(!c) return;
  editingCase = {
    id: id,
    demandId: c.demandId || "",
    demandTitle: c.demandTitle || "",
    steps: (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
  $("caseFormTitle").textContent = isWritable() ? "编辑用例" : "查看用例";
  $("cTitle").value = c.title || "";
  $("cModule").value = c.module || "";
  syncPriOptions();
  $("cPri").value = c.priority || "";
  $("cPrecondition").value = c.precondition || "";
  setDemandLoading();
  loadDemandOptions(caseReqId).then(function(list){
    if(!editingCase || editingCase.id !== id) return;
    fillDemandSelect(editingCase.demandId, editingCase.demandTitle);
    syncCaseDemandBaseline();
    if(list === null) toast(demandOptionsFailedMessage(), "warn");
  });
  renderStepRows();
  applyReadOnly(!isWritable());
  caseFormBaseline = caseFormSnapshot();
  UI.openModal($("dlgCase"), "input");
}
function renderStepRows(){
  var rows = editingCase.steps;
  $("tcSteps").innerHTML = rows.length
    ? rows.map(function(s, i){
      return '<div class="tc-step-row">'
        + '<span class="tc-step-no">' + (i + 1) + '</span>'
        + '<textarea rows="1" maxlength="200" placeholder="操作步骤（必填）" aria-label="步骤 ' + (i + 1) + ' 操作">' + esc(s.action) + '</textarea>'
        + '<textarea rows="1" maxlength="500" placeholder="预期结果（选填）" aria-label="步骤 ' + (i + 1) + ' 预期">' + esc(s.expected) + '</textarea>'
        + '<button class="icon-btn sm" type="button" data-step-del="' + i + '" aria-label="删除该步骤">' + icon("trash", 14) + '</button>'
        + '</div>';
    }).join("")
    : '<p class="foot-note">还没有步骤，点下方「添加步骤」录入操作与预期结果，或在步骤里按 Ctrl+Enter 快捷插入新行。</p>';
}
function focusStep(i){
  var row = $("tcSteps").querySelectorAll(".tc-step-row")[i];
  var ta = row && row.querySelector("textarea");
  if(ta) ta.focus();
}
function applyReadOnly(on){
  ["cTitle", "cPrecondition", "cDemand", "cModule", "cPri"].forEach(function(id){ $(id).disabled = on; });
  $("tcSteps").querySelectorAll("textarea").forEach(function(inp){ inp.disabled = on; });
  $("tcSteps").querySelectorAll("[data-step-del]").forEach(function(b){ b.style.display = on ? "none" : ""; });
  $("btnCaseAddStep").style.display = on ? "none" : "";
  $("caseSaveRow").style.display = on ? "none" : "";
  $("caseReadonlyHint").hidden = !on;
}
function collectSteps(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    var a = tas[0].value.trim();
    var e = tas[1].value.trim();
    if(!a && !e) return;
    rows.push({ action: a, expected: e });
  });
  return rows;
}
function syncStepsFromDom(){
  if(!editingCase) return;
  editingCase.steps = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    editingCase.steps.push({
      action: tas[0].value.trim(),
      expected: (tas[1].value || "").trim()
    });
  });
}
function stepsSnapshot(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    rows.push([tas[0] ? tas[0].value : "", tas[1] ? tas[1].value : ""]);
  });
  return rows;
}
function caseFormSnapshot(){
  return JSON.stringify([$("cTitle").value, $("cModule").value, $("cPri").value,
    $("cDemand").value, $("cPrecondition").value, stepsSnapshot()]);
}
function caseFormDirty(){
  return !!caseFormBaseline && caseFormSnapshot() !== caseFormBaseline;
}
/* 需求候选异步加载：加载期间 cDemand 只有占位项，不能拿它的空值当基线。
   加载完成只校正基线的需求项，避免把加载期间用户对其他字段的编辑一起吞掉。 */
function syncCaseDemandBaseline(){
  if(!caseFormBaseline) return;
  try{
    var arr = JSON.parse(caseFormBaseline);
    arr[3] = $("cDemand").value;
    caseFormBaseline = JSON.stringify(arr);
  }catch(e){ caseFormBaseline = caseFormSnapshot(); }
}
function runFormSnapshot(){
  var files = $("runFiles") && $("runFiles").files ? Array.prototype.map.call($("runFiles").files, function(f){ return f.name; }) : [];
  return JSON.stringify([runStatus, $("runNote").value, files]);
}
function runFormDirty(){ return !!runFormBaseline && runFormSnapshot() !== runFormBaseline; }
function defectFormSnapshot(){
  return JSON.stringify([$("defectSeverity").value, $("defectEnvironment").value]);
}
function defectFormDirty(){
  return !!defectFormBaseline && defectFormSnapshot() !== defectFormBaseline;
}
function closeCaseDialog(){
  caseFormBaseline = null;
  editingCase = null;
  UI.closeModal($("dlgCase"));
}
/* X、Esc、遮罩、路由与取消统一走这里；只有真正改过内容才确认 */
function tryCloseCaseDialog(afterClose){
  function finish(){
    closeCaseDialog();
    if(afterClose) afterClose();
  }
  if(!isWritable() || !caseFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: "用例还没有保存，关闭后填写的内容会丢失。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) finish(); });
}
function closeRunDialog(){
  runFormBaseline = null;
  runningCaseId = null;
  UI.closeModal($("dlgCaseRun"));
}
function tryCloseRunDialog(afterClose){
  function finish(){
    closeRunDialog();
    if(afterClose) afterClose();
  }
  if(!runFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃本次执行记录？",
    msg: "已填写的结果或备注不会保存。",
    okText: "放弃",
    cancelText: "继续填写"
  }).then(function(ok){ if(ok) finish(); });
}
function closeDefectDialog(){
  defectFormBaseline = null;
  defectCaseId = null;
  UI.closeModal($("dlgCaseDefect"));
}
function closeRunsDialog(){
  runsCaseId = null;
  runsCaseTitle = "";
  runsList = [];
  UI.closeModal($("dlgCaseRuns"));
}
function tryCloseDefectDialog(afterClose){
  function finish(){
    closeDefectDialog();
    if(afterClose) afterClose();
  }
  if(!defectFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃填写的内容？",
    msg: "缺陷还没有创建，填写的严重度与环境不会保存。",
    okText: "放弃",
    cancelText: "继续填写"
  }).then(function(ok){ if(ok) finish(); });
}
function setCaseBusy(btn, busy, label){
  if(!btn) return;
  btn.disabled = !!busy;
  if(busy){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = label || "处理中…";
  }else if(btn.dataset.label){
    btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
}
function saveCase(){
  if(caseSaving || !isWritable()) return;
  var title = $("cTitle").value.trim();
  if(!title){
    $("fCaseTitle").classList.add("invalid");
    toast("请填写用例标题", "warn");
    return;
  }
  var body = {
    reqId: caseReqId,
    title: title,
    precondition: $("cPrecondition").value.trim() || null,
    module: $("cModule").value.trim() || null,
    priority: $("cPri").value || null,
    demandId: $("cDemand").value || null,
    steps: collectSteps()
  };
  var isEdit = !!editingCase.id;
  caseSaving = true;
  setCaseBusy($("btnSaveCase"), true, "保存中…");
  var p = isEdit
    ? API.put("/api/test-cases/" + encodeURIComponent(editingCase.id), body)
    : API.post("/api/test-cases", body);
  p.then(function(){
    caseSaving = false;
    setCaseBusy($("btnSaveCase"), false);
    closeCaseDialog();
    toast(isEdit ? "用例已保存" : "用例已创建");
    loadCases();
  }).catch(function(ex){
    caseSaving = false;
    setCaseBusy($("btnSaveCase"), false);
    toast(ex.message || "保存失败", "bad");
  });
}
function removeCase(id){
  var c = caseById(id);
  if(!window.confirm("删除用例「" + (c ? c.title : id) + "」？其执行记录将一并删除。")) return;
  API.del("/api/test-cases/" + encodeURIComponent(id)).then(function(){
    toast("用例已删除");
    loadCases();
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
}

/* ---------- 执行结果 ---------- */

function openRunDialog(id){
  runningCaseId = id;
  runStatus = "passed";
  $("runNote").value = "";
  if($("runFiles")) $("runFiles").value = "";
  var c = caseById(id);
  $("runFormTitle").textContent = "执行 · " + (c ? cut(c.title, 18) : "");
  syncRunSeg();
  runFormBaseline = runFormSnapshot();
  UI.openModal($("dlgCaseRun"), "textarea");
}
function syncRunSeg(){
  document.querySelectorAll("#segCaseRun [data-run-status]").forEach(function(b){
    var on = b.dataset.runStatus === runStatus;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function uploadEvidenceQuiet(caseId, runId, file){
  var fd = new FormData();
  fd.append("file", file);
  var url = API.url("/api/test-cases/" + encodeURIComponent(caseId) + "/runs/"
    + encodeURIComponent(runId) + "/attachments"
    + (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    if(!json || json.code !== 0) throw new Error((json && json.message) || "上传失败");
    return true;
  });
}
function doRun(){
  if(caseRunning || !runningCaseId) return;
  var caseId = runningCaseId;
  var files = $("runFiles") && $("runFiles").files
    ? Array.prototype.slice.call($("runFiles").files) : [];
  var oversized = files.filter(function(f){ return f.size > 10 * 1024 * 1024; });
  if(oversized.length){
    toast("「" + oversized[0].name + "」超过 10MB，请先移除", "warn");
    return;
  }
  caseRunning = true;
  setCaseBusy($("btnDoRun"), true, files.length ? "记录并上传…" : "记录中…");
  API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/runs", {
    status: runStatus,
    note: $("runNote").value.trim() || null
  }).then(function(run){
    var runId = run && run.id;
    if(!runId || !files.length){
      return { uploaded: 0, failed: 0 };
    }
    return Promise.all(files.map(function(f){
      return uploadEvidenceQuiet(caseId, runId, f).then(function(){ return 1; }, function(){ return 0; });
    })).then(function(rs){
      var uploaded = rs.reduce(function(a, b){ return a + b; }, 0);
      return { uploaded: uploaded, failed: files.length - uploaded };
    });
  }).then(function(res){
    caseRunning = false;
    setCaseBusy($("btnDoRun"), false);
    closeRunDialog();
    var msg = runStatus === "failed" ? "已记录失败，可点击「转缺陷」生成缺陷工作项" : "执行结果已记录";
    if(res.uploaded) msg += "，已上传 " + res.uploaded + " 个证据";
    if(res.failed) msg += "，" + res.failed + " 个证据上传失败（可在「记录」里补传）";
    toast(msg, res.failed ? "warn" : "fs");
    loadCases();
  }).catch(function(ex){
    caseRunning = false;
    setCaseBusy($("btnDoRun"), false);
    toast(ex.message || "记录失败", "bad");
  });
}

/* ---------- 失败转缺陷 ---------- */

function openDefectDialog(id){
  defectCaseId = id;
  var c = caseById(id);
  $("caseDefectDesc").textContent = "「" + (c ? c.title : "") + "」将生成一条缺陷工作项，执行步骤与失败备注写入描述。";
  $("defectSeverity").value = "";
  $("defectEnvironment").value = "";
  $("fDefectSeverity").classList.remove("invalid");
  defectFormBaseline = defectFormSnapshot();
  UI.openModal($("dlgCaseDefect"), "select");
}
function doDefect(){
  if(caseDefecting || !defectCaseId) return;
  var severity = $("defectSeverity").value;
  if(!severity){
    $("fDefectSeverity").classList.add("invalid");
    toast("缺陷必须选择严重度", "warn");
    return;
  }
  caseDefecting = true;
  setCaseBusy($("btnDoDefect"), true, "创建中…");
  API.post("/api/test-cases/" + encodeURIComponent(defectCaseId) + "/defect", {
    severity: severity,
    environment: $("defectEnvironment").value.trim() || null
  }).then(function(task){
    caseDefecting = false;
    setCaseBusy($("btnDoDefect"), false);
    closeDefectDialog();
    toast("缺陷已创建");
    loadCases();
    openTaskById(task.id);
  }).catch(function(ex){
    caseDefecting = false;
    setCaseBusy($("btnDoDefect"), false);
    toast(ex.message || "创建失败", "bad");
  });
}

/* ---------- 测试计划（A2：圈选用例 → 批量执行 → 按版本留痕） ---------- */

var plans = [];
var planSeq = 0;
var planDetail = null;        /* { plan, cases, passRate }，非空 = 正在看计划详情 */
var planDetailSeq = 0;
var planSel = {};             /* 详情页批量执行勾选：caseId -> true */
var planBatchStatus = "passed";
var editingPlanId = null;
var planSaving = false;
var planPickCases = [];
var pickingPlan = false;

var PLAN_STATUS = { draft: ["草稿", "mute"], running: ["执行中", "warn"], done: ["已完成", "ok"] };
function planBadgeHTML(s){
  var it = PLAN_STATUS[s] || PLAN_STATUS.draft;
  return '<span class="mini-tag ' + it[1] + '">' + it[0] + '</span>';
}
function planNextStatus(s){
  return s === "draft" ? "running" : (s === "running" ? "done" : "draft");
}
function planNextLabel(s){
  return s === "draft" ? "开始执行" : (s === "running" ? "标记完成" : "重新打开");
}

function loadPlans(){
  render();
  var box = $("tcPlans");
  if(!box) return;
  if(!caseReqId){
    plans = []; planDetail = null;
    box.innerHTML = UI.emptyState({
      icon: "folder", title: "还没有项目",
      text: "先创建项目，测试计划按项目收纳；一个版本或一轮回归建一个计划。"
    });
    return;
  }
  var seq = ++planSeq;
  box.innerHTML = UI.skeletonRows(3);
  API.get("/api/test-plans", { reqId: caseReqId }).then(function(rows){
    if(seq !== planSeq) return;
    plans = rows || [];
    planDetail = null;
    planDetailSeq++;
    renderPlans();
  }).catch(function(ex){
    if(seq !== planSeq) return;
    box.innerHTML = UI.errorState(ex.message || "测试计划加载失败");
  });
}
/* 详情里的批量执行、加减用例只刷新了详情；回列表时再取一次，卡片上的通过率与执行数才不会停在旧值 */
var planListSeq = 0;
function refreshPlansQuiet(){
  if(!caseReqId) return Promise.resolve();
  var seq = ++planListSeq;
  return API.get("/api/test-plans", { reqId: caseReqId }).then(function(rows){
    if(seq !== planListSeq || planDetail) return;
    plans = rows || [];
    renderPlans();
  }).catch(function(){ /* 拉取失败保留当前列表 */ });
}
function renderPlans(){
  var box = $("tcPlans");
  if(!box) return;
  if(planDetail){ renderPlanDetail(); return; }
  if(!plans.length){
    box.innerHTML = UI.emptyState({
      icon: "checklist", title: "还没有测试计划",
      text: isWritable()
        ? "点右上角「新建计划」：圈选一批用例，批量记录结果，完成即留痕。"
        : "测试计划按项目收纳；你在该项目只有查看权限。"
    });
    return;
  }
  box.innerHTML = plans.map(function(p){
    var pct = p.caseCount ? Math.round((p.executedCount || 0) * 100 / p.caseCount) : 0;
    var meta = [];
    if(p.versionName) meta.push("版本：" + p.versionName);
    if(p.plannedStart || p.plannedEnd) meta.push((p.plannedStart || "—") + " → " + (p.plannedEnd || "—"));
    meta.push("用例 " + (p.caseCount || 0) + " · 已执行 " + (p.executedCount || 0));
    if(p.createdBy) meta.push(p.createdBy + " · " + (fmtTs(p.createdAt) || ""));
    var w = !!caseReqId && canEditReq(p.reqId);
    var acts = '<button class="btn sm" type="button" data-plan-open="' + esc(p.id) + '">打开</button>';
    if(w){
      /* 已完成计划是快照：update 服务端同样拒绝，这里不再提供编辑入口 */
      acts += '<span class="tc-secondary">'
        + (p.status !== "done"
            ? '<button class="btn sm ghost" type="button" data-plan-edit="' + esc(p.id) + '">' + icon("edit", 13) + ' 编辑</button>'
            : "")
        + '<button class="icon-btn sm" type="button" data-plan-del="' + esc(p.id) + '" aria-label="删除计划">' + icon("trash", 14) + '</button>'
        + '</span>';
    }
    return '<div class="tc-row" data-plan-open="' + esc(p.id) + '">'
      + planBadgeHTML(p.status)
      + '<div class="tc-main">'
      +   '<div class="tc-title">' + esc(p.name) + '</div>'
      +   '<div class="tc-meta">' + meta.map(esc).join(" · ") + '</div>'
      +   '<div class="plan-bar"><i style="width:' + pct + '%"></i></div>'
      + '</div>'
      + '<div class="plan-counts">'
      +   '<span class="mini-tag ok">通过 ' + (p.passedCount || 0) + '</span>'
      +   '<span class="mini-tag over">失败 ' + (p.failedCount || 0) + '</span>'
      +   (p.defectCount ? '<span class="mini-tag over">缺陷 ' + p.defectCount + '</span>' : "")
      + '</div>'
      + '<div class="tc-acts">' + acts + '</div>'
      + '</div>';
  }).join("");
}

function openPlanDetail(id){
  var seq = ++planDetailSeq;
  planSel = {};
  $("tcPlans").innerHTML = UI.skeletonRows(4);
  API.get("/api/test-plans/" + encodeURIComponent(id)).then(function(d){
    if(seq !== planDetailSeq) return;
    planDetail = d && d.plan ? d : null;
    if(!planDetail){ $("tcPlans").innerHTML = UI.errorState("计划不存在或无权查看"); return; }
    renderPlanDetail();
  }).catch(function(ex){
    if(seq !== planDetailSeq) return;
    $("tcPlans").innerHTML = UI.errorState(ex.message || "计划加载失败");
  });
}
function renderPlanDetail(){
  var box = $("tcPlans");
  var d = planDetail;
  if(!box || !d) return;
  var p = d.plan;
  var cs = d.cases || [];
  var done = p.status === "done";
  var w = canEditReq(p.reqId);
  var editable = w && !done;
  var untested = (p.caseCount || 0) - (p.executedCount || 0);
  var selCount = 0;
  for(var k in planSel) if(planSel[k]) selCount++;
  var meta = [];
  if(p.versionName) meta.push("版本：" + p.versionName);
  if(p.plannedStart || p.plannedEnd) meta.push("计划 " + (p.plannedStart || "—") + " → " + (p.plannedEnd || "—"));
  if(p.createdBy) meta.push(p.createdBy + " 创建");
  var head = '<div class="plan-head">'
    + '<button class="btn sm ghost" type="button" data-plan-back>' + icon("left", 13) + ' 返回</button>'
    + '<span class="toolbar-title">' + esc(p.name) + '</span>' + planBadgeHTML(p.status)
    + '<span class="toolbar-meta">' + meta.map(esc).join(" · ") + '</span>'
    + (w ? '<button class="btn sm ghost" type="button" data-plan-status="' + esc(planNextStatus(p.status)) + '">'
        + planNextLabel(p.status) + '</button>' : "")
    + '</div>';
  if(p.note) head += '<p class="foot-note">' + esc(p.note) + '</p>';
  if(done) head += '<p class="foot-note">已完成计划是结果快照：圈选与批量执行已锁定，可重新打开后继续编辑。</p>';
  var pct = p.caseCount ? Math.round((p.executedCount || 0) * 100 / p.caseCount) : 0;
  head += '<div class="tc-stats plan-stats">'
    + '<span class="tc-stat"><b>' + (p.caseCount || 0) + '</b>圈选</span>'
    + '<span class="tc-stat mute"><b>' + Math.max(0, untested) + '</b>未执行</span>'
    + '<span class="tc-stat ok"><b>' + (p.passedCount || 0) + '</b>通过</span>'
    + '<span class="tc-stat over"><b>' + (p.failedCount || 0) + '</b>失败</span>'
    + '<span class="tc-stat warn"><b>' + (p.blockedCount || 0) + '</b>阻塞</span>'
    + '<span class="tc-stat"><b>' + pct + '%</b>进度</span>'
    + '<span class="tc-stat"><b>' + (d.passRate == null ? "—" : d.passRate + "%") + '</b>通过率</span>'
    + '<span class="tc-stat over"><b>' + (p.defectCount || 0) + '</b>转缺陷</span>'
    + '</div>';
  var acts = '<div class="plan-acts">';
  if(editable){
    acts += '<button class="btn sm" type="button" data-plan-pick>' + icon("plus", 13) + ' 圈选用例</button>';
    acts += '<span class="seg mini" data-plan-batch role="group" aria-label="批量执行结果">'
      + '<button type="button" data-pbatch="passed" aria-pressed="' + (planBatchStatus === "passed") + '">通过</button>'
      + '<button type="button" data-pbatch="failed" aria-pressed="' + (planBatchStatus === "failed") + '">失败</button>'
      + '<button type="button" data-pbatch="blocked" aria-pressed="' + (planBatchStatus === "blocked") + '">阻塞</button>'
      + '</span>'
      + '<input id="planRunNote" type="text" maxlength="500" class="plan-note-inp" placeholder="批量备注（选填，写入本轮执行记录）" />'
      + '<button class="btn sm primary" type="button" data-plan-runs>记录选中 ' + selCount + ' 条</button>';
  }
  acts += '<button class="btn sm ghost" type="button" data-plan-csv>' + icon("download", 13) + ' 导出报告</button>';
  acts += '</div>';
  var rows = "";
  if(!cs.length){
    rows = UI.emptyState({
      icon: "checklist", title: "计划里还没有用例",
      text: editable ? "点「圈选用例」从项目用例库挑一批。" : "该计划暂未圈选用例。"
    });
  }else{
    rows = cs.map(function(c){
      var chk = editable
        ? '<input type="checkbox" data-pcase="' + esc(c.caseId) + '"' + (planSel[c.caseId] ? " checked" : "")
          + ' aria-label="选择用例「' + esc(c.title) + '」" />'
        : "";
      var tail = [];
      if(c.module) tail.push(c.module);
      tail.push((c.priority || "—"));
      if(c.executedBy) tail.push(c.executedBy + " " + (fmtTs(c.executedAt) || ""));
      var del = editable
        ? '<button class="icon-btn sm" type="button" data-plan-rm="' + esc(c.caseId) + '" aria-label="移出计划" title="移出计划（不删用例）">' + icon("minus", 14) + '</button>'
        : "";
      return '<div class="tc-row plan-case">' + chk
        + statusBadgeHTML(c.result)
        + '<div class="tc-main">'
        +   '<div class="tc-title">' + esc(c.title) + '</div>'
        +   '<div class="tc-meta">' + tail.map(esc).join(" · ") + '</div>'
        +   (c.note ? '<div class="tc-note">' + esc(c.note) + '</div>' : "")
        + '</div>'
        + '<div class="tc-acts">' + (c.latestStatus ? '<span class="toolbar-meta">用例库最近：'
            + (STATUS_LABEL[c.latestStatus] || c.latestStatus) + '</span>' : "") + del + '</div>'
        + '</div>';
    }).join("");
  }
  box.innerHTML = head + acts + '<div class="tc-list">' + rows + '</div>';
}
function planCaseIds(){
  return (planDetail && planDetail.cases || []).map(function(c){ return c.caseId; });
}
function doPlanBatchRun(){
  var ids = [];
  for(var k in planSel) if(planSel[k]) ids.push(k);
  if(!ids.length){ toast("先勾选要标记结果的用例", "warn"); return; }
  var note = $("planRunNote") ? $("planRunNote").value.trim() : "";
  API.post("/api/test-plans/" + encodeURIComponent(planDetail.plan.id) + "/runs",
    { caseIds: ids, status: planBatchStatus, note: note || null })
  .then(function(n){
    toast("已记录 " + (n || 0) + " 条执行结果", "fs");
    openPlanDetail(planDetail.plan.id);
  }).catch(function(ex){ toast(ex.message || "批量记录失败", "bad"); });
}
function planStatusTo(status){
  API.put("/api/test-plans/" + encodeURIComponent(planDetail.plan.id) + "/status?status=" + encodeURIComponent(status), {})
  .then(function(){
    toast(status === "done" ? "计划已完成并留痕" : (status === "running" ? "计划已开始执行" : "计划已回到草稿"), "fs");
    openPlanDetail(planDetail.plan.id);
  }).catch(function(ex){ toast(ex.message || "状态更新失败", "bad"); });
}
function exportPlanCsv(){
  var d = planDetail;
  if(!d) return;
  var rows = [["标题", "模块", "优先级", "计划结果", "执行人", "执行时间", "备注"]];
  (d.cases || []).forEach(function(c){
    rows.push([c.title, c.module || "", c.priority || "",
      c.result ? (STATUS_LABEL[c.result] || c.result) : "未执行",
      c.executedBy || "", c.executedAt ? fmtTs(c.executedAt) : "", c.note || ""]);
  });
  downloadCsv("测试计划-" + d.plan.name + ".csv", rows);
  toast("已导出计划报告 CSV", "fs");
}

/* 新建 / 编辑计划 */
function openPlanDialog(id){
  editingPlanId = id || null;
  var p = null;
  if(id) for(var i = 0; i < plans.length; i++) if(plans[i].id === id) p = plans[i];
  $("planFormTitle").textContent = p ? "编辑测试计划" : "新建测试计划";
  $("pName").value = p ? p.name : "";
  $("fPlanName").classList.remove("invalid");
  $("pStart").value = p && p.plannedStart ? p.plannedStart : "";
  $("pEnd").value = p && p.plannedEnd ? p.plannedEnd : "";
  $("pNote").value = p && p.note ? p.note : "";
  $("pVersion").innerHTML = '<option value="">不关联版本</option>';
  $("btnSavePlan").textContent = "保存";
  UI.openModal($("dlgPlan"), "input");
  API.get("/api/versions", { reqId: caseReqId }).then(function(vs){
    var html = '<option value="">不关联版本</option>';
    (vs || []).forEach(function(v){
      html += '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>';
    });
    $("pVersion").innerHTML = html;
    if(p && p.versionId) $("pVersion").value = p.versionId;
  }).catch(function(){ /* 版本下拉失败不阻塞：保持仅「不关联版本」 */ });
}
function savePlan(){
  if(planSaving) return;
  var name = $("pName").value.trim();
  if(!name){ $("fPlanName").classList.add("invalid"); toast("请填写计划名称", "warn"); return; }
  var body = {
    reqId: caseReqId,
    name: name,
    versionId: $("pVersion").value || null,
    plannedStart: $("pStart").value || null,
    plannedEnd: $("pEnd").value || null,
    note: $("pNote").value.trim() || null
  };
  planSaving = true;
  setCaseBusy($("btnSavePlan"), true, "保存中…");
  var call = editingPlanId
    ? API.put("/api/test-plans/" + encodeURIComponent(editingPlanId), body)
    : API.post("/api/test-plans", body);
  call.then(function(){
    planSaving = false;
    setCaseBusy($("btnSavePlan"), false);
    UI.closeModal($("dlgPlan"));
    toast(editingPlanId ? "计划已更新" : "计划已创建", "fs");
    loadPlans();
  }).catch(function(ex){
    planSaving = false;
    setCaseBusy($("btnSavePlan"), false);
    toast(ex.message || "保存失败", "bad");
  });
}
function deletePlan(id){
  var p = null;
  for(var i = 0; i < plans.length; i++) if(plans[i].id === id) p = plans[i];
  if(!p) return;
  UI.showConfirm({
    title: "删除测试计划",
    msg: "删除计划「" + esc(p.name) + "」？已登记的执行记录会保留在「用例」页的执行历史中，仅计划汇总随之删除。",
    okText: "删除计划"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/test-plans/" + encodeURIComponent(id)).then(function(){
      toast("计划已删除", "fs");
      loadPlans();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* 圈选用例弹窗 */
function openPlanPick(){
  var d = planDetail;
  if(!d) return;
  pickingPlan = false;
  $("planPickList").innerHTML = UI.skeletonRows(3);
  $("planPickCount").textContent = "";
  UI.openModal($("dlgPlanPick"), "input");
  API.get("/api/test-cases", { reqId: d.plan.reqId, offset: 0, limit: 500 }).then(function(page){
    var inPlan = {};
    (d.cases || []).forEach(function(c){ inPlan[c.caseId] = true; });
    planPickCases = (page && page.items || []).filter(function(c){ return !inPlan[c.id]; });
    if(!planPickCases.length){
      $("planPickList").innerHTML = '<p class="rep-empty">项目用例库里的用例都已在本计划中。要更多用例可先在「用例」页录入或 CSV 导入。</p>';
      $("btnDoPlanPick").disabled = true;
      return;
    }
    $("btnDoPlanPick").disabled = false;
    $("planPickList").innerHTML = planPickCases.map(function(c){
      return '<label class="pick-row"><input type="checkbox" data-pick-case="' + esc(c.id) + '" />'
        + statusBadgeHTML(c.latestStatus)
        + '<span class="pick-main"><b>' + esc(c.title) + '</b>'
        + '<small>' + esc([c.module, c.priority || "—"].join(" · ")) + '</small></span></label>';
    }).join("");
    syncPickCount();
  }).catch(function(ex){
    $("planPickList").innerHTML = UI.errorState(ex.message || "用例加载失败");
  });
}
function syncPickCount(){
  var n = $("planPickList").querySelectorAll("[data-pick-case]:checked").length;
  $("planPickCount").textContent = "已选 " + n + " / 可加入 " + planPickCases.length + " 条";
}
function doPlanPick(){
  if(pickingPlan) return;
  var ids = [];
  $("planPickList").querySelectorAll("[data-pick-case]:checked").forEach(function(inp){ ids.push(inp.dataset.pickCase); });
  if(!ids.length){ toast("先勾选要加入的用例", "warn"); return; }
  pickingPlan = true;
  setCaseBusy($("btnDoPlanPick"), true, "加入中…");
  API.post("/api/test-plans/" + encodeURIComponent(planDetail.plan.id) + "/cases", { caseIds: ids })
  .then(function(added){
    pickingPlan = false;
    setCaseBusy($("btnDoPlanPick"), false);
    UI.closeModal($("dlgPlanPick"));
    toast("已加入 " + (added || 0) + " 条用例" + (ids.length - (added || 0) ? "（重复的已跳过）" : ""), "fs");
    openPlanDetail(planDetail.plan.id);
  }).catch(function(ex){
    pickingPlan = false;
    setCaseBusy($("btnDoPlanPick"), false);
    toast(ex.message || "加入失败", "bad");
  });
}

/* ---------- 用例 CSV 导入导出（A3：存量测试资产迁移） ---------- */

function exportCasesCsv(){
  if(!caseReqId){ toast("先选择项目", "warn"); return; }
  var url = API.url("/api/test-cases/export.csv?reqId=" + encodeURIComponent(caseReqId)
    + (window.CURRENT_WORKSPACE ? ("&workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  fetch(url, { credentials: "same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok){
      return res.json().catch(function(){ return null; }).then(function(j){
        throw new Error((j && j.message) || "导出失败");
      });
    }
    return res.blob();
  }).then(function(blob){
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u;
    a.download = "测试用例-" + reqNameOf(caseReqId) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(u); }, 1500);
    toast("已导出用例 CSV", "fs");
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
function importCasesCsv(file){
  if(!caseReqId){ toast("先选择项目", "warn"); return; }
  if(file.size > 2 * 1024 * 1024){ toast("CSV 超过 2MB 上限，请拆分后导入", "warn"); return; }
  var reader = new FileReader();
  reader.onload = function(){
    var text = String(reader.result || "");
    if(!text.trim()){ toast("CSV 内容为空", "warn"); return; }
    API.post("/api/test-cases/import?reqId=" + encodeURIComponent(caseReqId), { csv: text })
    .then(function(r){
      r = r || {};
      var msg = "导入完成：新增 " + (r.created || 0) + " 条";
      if(r.failed) msg += "，失败 " + r.failed + " 条";
      if((r.total || 0) > 1000 || r.skipped) msg += "，超限跳过 " + (r.skipped || 0) + " 条";
      toast(msg, r.failed ? "warn" : "fs");
      if(r.errors && r.errors.length){
        UI.showConfirm({
          title: "导入明细",
          msg: "以下行未导入：<br>" + r.errors.map(esc).join("<br>"),
          danger: false, okText: "知道了", cancelText: "关闭"
        });
      }
      loadCases();
    }).catch(function(ex){ toast(ex.message || "导入失败", "bad"); });
  };
  reader.onerror = function(){ toast("读取文件失败", "bad"); };
  reader.readAsText(file);
}

/* ---------- 事件 ---------- */

$("tcReq").addEventListener("change", function(){
  caseReqId = $("tcReq").value;
  if(tcMode === "coverage") loadCoverage();
  else if(tcMode === "report") loadTestReport();
  else if(tcMode === "plans") loadPlans();
  else loadCases();
});
$("tcModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-tc-mode]");
  if(!b) return;
  setTcMode(b.dataset.tcMode);
});
["tcModule", "tcPri", "tcOwner"].forEach(function(id){
  $(id).addEventListener("change", function(){
    modFilter = $("tcModule").value;
    priFilter = $("tcPri").value;
    ownerFilter = $("tcOwner").value;
    loadCases();
  });
});
$("tcBug").addEventListener("click", function(){
  bugOnly = !bugOnly;
  loadCases();
});
var tcFilterBtn = $("tcFilterBtn"), tcFilterBar = $("tcFilterBar");
if(tcFilterBtn && tcFilterBar){
  tcFilterBtn.addEventListener("click", function(){
    var open = !tcFilterBar.classList.contains("is-open");
    tcFilterBar.classList.toggle("is-open", open);
    tcFilterBtn.setAttribute("aria-expanded", String(open));
  });
}
$("tcSearch").addEventListener("input", function(){
  var value = this.value.trim().toLowerCase();
  if(value === searchText) return;
  searchText = value;
  if(caseSearchTimer) clearTimeout(caseSearchTimer);
  caseSearchTimer = setTimeout(function(){
    caseSearchTimer = null;
    loadCases();
  }, 300);
});
$("tcStatusSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-tc-status]");
  if(!b) return;
  statusFilter = b.dataset.tcStatus;
  loadCases();
});
/* 用例 / 计划 / 矩阵 / 报告的关系与分页口径：放在问号弹层里，避免占用工具栏 */
var tcHelpBtn = $("tcHelp"), tcHelpPop = null;
function tcHelpHTML(){
  function row(tag, text){
    return '<div class="type-help-row"><span class="mini-tag">' + tag + '</span>' +
      '<span class="type-help-desc">' + text + '</span></div>';
  }
  return '<div class="menu-title">测试模块使用说明</div>' +
    '<div class="type-help-list">' +
      row("用例", "最小验证单元，挂在项目下；记录步骤与预期，最新一次执行结果（未执行/通过/失败/阻塞）决定统计口径。") +
      row("测试计划", "从用例库圈选一批组成一轮测试（单次最多 500 条），批量记录结果；结果同时写回用例最近结果并追加执行流水，按版本留痕，完成后锁定为快照。") +
      row("覆盖矩阵", "按需求统计用例覆盖：哪些需求已有用例、覆盖多少、通过率如何；按项目全量计算，不受用例列表分页影响。") +
      row("测试报告", "当前项目的通过率、失败/阻塞清单与覆盖汇总，可导出 CSV。") +
    '</div>' +
    '<p class="foot-note tc-help-note">分页口径：用例列表按 offset/limit 分页加载（每页 100 条，点「加载更多」继续）；覆盖矩阵与测试报告按项目全量统计；计划圈选一次最多 500 条，超出时请先缩小项目范围或在用例页筛选。</p>';
}
if(tcHelpBtn){
  tcHelpBtn.innerHTML = icon("alertCircle", 13);
  tcHelpBtn.addEventListener("click", function(){
    if(UI.popOpen(tcHelpPop)){ UI.closeAllPops(); return; }
    var el = document.createElement("div");
    el.className = "menu tc-help-pop";
    el.innerHTML = tcHelpHTML();
    tcHelpPop = el;
    UI.openPop(el, tcHelpBtn, { align:"left", width:420, onClose:function(){ el.remove(); tcHelpPop = null; } });
  });
}
var tcViewsBtn = $("tcViewsBtn");
if(tcViewsBtn && tcViewsMenuEl){
  tcViewsBtn.addEventListener("click", function(){
    if(UI.popOpen(tcViewsMenuEl)){ UI.closeAllPops(); return; }
    renderTcViewsMenu();
    UI.openPop(tcViewsMenuEl, tcViewsBtn, { align: "left", width: 260 });
    loadViews().then(renderTcViewsMenu);
  });
  tcViewsMenuEl.addEventListener("click", function(e){
    var ap = e.target.closest("[data-tc-view]");
    if(ap){
      for(var i = 0; i < rt.savedViews.length; i++){
        if(String(rt.savedViews[i].id) === String(ap.dataset.tcView)){
          applyTcView(rt.savedViews[i]);
          UI.closeAllPops();
          return;
        }
      }
      return;
    }
    var dl = e.target.closest("[data-tc-view-del]");
    if(dl){ deleteTcView(dl.dataset.tcViewDel); return; }
    if(e.target.closest("[data-tc-view-save]")){ UI.closeAllPops(); saveTcView(); }
  });
}
$("btnCaseNew").addEventListener("click", openNewDialog);

/* 用例 CSV：导出走服务端（含步骤展开），导入读文件后以 JSON 文本提交 */
$("btnCaseCsvOut").addEventListener("click", exportCasesCsv);
$("btnCaseCsvIn").addEventListener("click", function(){ $("tcCsvFile").click(); });
$("tcCsvFile").addEventListener("change", function(){
  var f = this.files && this.files[0];
  this.value = "";
  if(f) importCasesCsv(f);
});

/* 测试计划：列表 → 详情 → 批量执行 */
$("btnPlanNew").addEventListener("click", function(){
  if(!caseReqId){ toast("先在上方选择一个项目，再新建测试计划", "warn"); if($("tcReq")) $("tcReq").focus(); return; }
  if(!isWritable()){ toast("当前项目只读，无法新建测试计划", "warn"); return; }
  openPlanDialog(null);
});
$("tcPlans").addEventListener("click", function(e){
  var b;
  if((b = e.target.closest("[data-plan-back]"))){
    planDetailSeq++; planDetail = null; renderPlans(); refreshPlansQuiet(); return;
  }
  if((b = e.target.closest("[data-plan-edit]"))){ openPlanDialog(b.dataset.planEdit); return; }
  if((b = e.target.closest("[data-plan-del]"))){ deletePlan(b.dataset.planDel); return; }
  if((b = e.target.closest("[data-plan-status]"))){ planStatusTo(b.dataset.planStatus); return; }
  if((b = e.target.closest("[data-plan-pick]"))){ openPlanPick(); return; }
  if((b = e.target.closest("[data-plan-runs]"))){ doPlanBatchRun(); return; }
  if((b = e.target.closest("[data-plan-csv]"))){ exportPlanCsv(); return; }
  if((b = e.target.closest("[data-pbatch]"))){
    planBatchStatus = b.dataset.pbatch;
    document.querySelectorAll("[data-pbatch]").forEach(function(x){
      x.setAttribute("aria-pressed", x.dataset.pbatch === planBatchStatus ? "true" : "false");
    });
    return;
  }
  if((b = e.target.closest("[data-plan-rm]"))){
    var planId = planDetail && planDetail.plan.id;
    API.del("/api/test-plans/" + encodeURIComponent(planId) + "/cases/" + encodeURIComponent(b.dataset.planRm))
      .then(function(){ toast("已移出计划（用例本身保留）", "fs"); openPlanDetail(planId); })
      .catch(function(ex){ toast(ex.message || "移出失败", "bad"); });
    return;
  }
  if((b = e.target.closest("[data-plan-open]")) && !e.target.closest(".tc-acts")){
    openPlanDetail(b.dataset.planOpen);
  }
});
$("tcPlans").addEventListener("change", function(e){
  var c = e.target.closest("[data-pcase]");
  if(!c) return;
  planSel[c.dataset.pcase] = c.checked;
  var btn = $("tcPlans").querySelector("[data-plan-runs]");
  if(btn){
    var n = 0;
    for(var k in planSel) if(planSel[k]) n++;
    btn.textContent = "记录选中 " + n + " 条";
  }
});
$("btnSavePlan").addEventListener("click", savePlan);
$("pName").addEventListener("input", function(){ $("fPlanName").classList.remove("invalid"); });
$("dlgPlanX").addEventListener("click", function(){ UI.closeModal($("dlgPlan")); });
UI.setModalSubmit($("dlgPlan"), function(){ if(!planSaving) savePlan(); });
$("dlgPlanPickX").addEventListener("click", function(){ UI.closeModal($("dlgPlanPick")); });
$("btnDoPlanPick").addEventListener("click", doPlanPick);
$("planPickList").addEventListener("change", syncPickCount);
$("btnPlanPickAll").addEventListener("click", function(){
  var boxes = $("planPickList").querySelectorAll("[data-pick-case]");
  var allOn = true;
  boxes.forEach(function(x){ if(!x.checked) allOn = false; });
  boxes.forEach(function(x){ x.checked = !allOn; });
  syncPickCount();
});
UI.setModalSubmit($("dlgPlanPick"), function(){ if(!pickingPlan) doPlanPick(); });
$("tcList").addEventListener("click", function(e){
  var more = e.target.closest("[data-tc-more]");
  if(more){ loadMoreCases(); return; }
  var runs = e.target.closest("[data-tc-runs]");
  if(runs){ openRunsDialog(runs.dataset.tcRuns); return; }
  var run = e.target.closest("[data-tc-run]");
  if(run){ openRunDialog(run.dataset.tcRun); return; }
  var def = e.target.closest("[data-tc-defect]");
  if(def){ openDefectDialog(def.dataset.tcDefect); return; }
  var bug = e.target.closest("[data-tc-bug]");
  if(bug){
    var cb = caseById(bug.dataset.tcBug);
    if(cb && cb.latestBugTaskId) openTaskById(cb.latestBugTaskId);
    else toast("未找到关联缺陷，可能已被删除", "warn");
    return;
  }
  var edit = e.target.closest("[data-tc-edit]");
  if(edit){ openEditDialog(edit.dataset.tcEdit); return; }
  var del = e.target.closest("[data-tc-del]");
  if(del){ removeCase(del.dataset.tcDel); return; }
  var open = e.target.closest("[data-tc-open]");
  if(open && !e.target.closest(".tc-acts")) openEditDialog(open.dataset.tcOpen);
});
$("btnCaseAddStep").addEventListener("click", function(){
  if(!editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  syncStepsFromDom();
  editingCase.steps.push({ action: "", expected: "" });
  renderStepRows();
  focusStep(editingCase.steps.length - 1);
});
$("tcSteps").addEventListener("click", function(e){
  var d = e.target.closest("[data-step-del]");
  if(!d || !editingCase) return;
  syncStepsFromDom();
  editingCase.steps.splice(Number(d.dataset.stepDel), 1);
  renderStepRows();
});
/* Ctrl/Cmd+Enter 在当前步骤下方插入新行，长步骤输入不受干扰 */
$("tcSteps").addEventListener("keydown", function(e){
  if(e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  e.preventDefault();
  syncStepsFromDom();
  var row = e.target.closest(".tc-step-row");
  var idx = row
    ? Array.prototype.indexOf.call($("tcSteps").querySelectorAll(".tc-step-row"), row)
    : editingCase.steps.length - 1;
  editingCase.steps.splice(idx + 1, 0, { action: "", expected: "" });
  renderStepRows();
  focusStep(idx + 1);
});
$("btnSaveCase").addEventListener("click", saveCase);
$("cTitle").addEventListener("input", function(){ $("fCaseTitle").classList.remove("invalid"); });
$("dlgCaseX").addEventListener("click", function(){ tryCloseCaseDialog(); });
/* 单行输入 Enter 提交；步骤 textarea 保持换行，CJK 组合输入不触发 */
$("dlgCase").addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  if(!e.target || e.target.tagName !== "INPUT") return;
  if(e.target.type === "checkbox" || e.target.type === "file") return;
  if(!isWritable()) return;
  e.preventDefault();
  if(!caseSaving && !$("btnSaveCase").disabled) saveCase();
});
UI.setModalCloseGuard($("dlgCase"), function(){ tryCloseCaseDialog(); });
UI.setModalSubmit($("dlgCase"), function(){
  if(!caseSaving && !$("btnSaveCase").disabled) saveCase();
});

$("segCaseRun").addEventListener("click", function(e){
  var b = e.target.closest("[data-run-status]");
  if(!b) return;
  runStatus = b.dataset.runStatus;
  syncRunSeg();
});
$("btnDoRun").addEventListener("click", doRun);
$("dlgCaseRunX").addEventListener("click", function(){ tryCloseRunDialog(); });
UI.setModalCloseGuard($("dlgCaseRun"), function(){ tryCloseRunDialog(); });
UI.setModalSubmit($("dlgCaseRun"), function(){ if(!caseRunning) doRun(); });

$("btnDoDefect").addEventListener("click", doDefect);
$("defectSeverity").addEventListener("change", function(){ $("fDefectSeverity").classList.remove("invalid"); });
$("dlgCaseDefectX").addEventListener("click", function(){ tryCloseDefectDialog(); });
UI.setModalCloseGuard($("dlgCaseDefect"), function(){ tryCloseDefectDialog(); });
UI.setModalSubmit($("dlgCaseDefect"), function(){ if(!caseDefecting) doDefect(); });

/* 执行历史与失败证据 */
$("dlgCaseRunsX").addEventListener("click", function(){ closeRunsDialog(); });
UI.setModalCloseGuard($("dlgCaseRuns"), function(){ closeRunsDialog(); });
$("runsList").addEventListener("click", function(e){
  var del = e.target.closest("[data-run-att-del]");
  if(del){
    var caseId = runsCaseId;
    var caseTitle = runsCaseTitle;
    UI.showConfirm({ title: "删除证据", msg: "证据附件删除后不可恢复，确定删除？", okText: "删除" }).then(function(ok){
      if(!ok) return;
      del.disabled = true;
      API.del("/api/attachments/" + encodeURIComponent(del.dataset.runAttDel)).then(function(){
        toast("证据已删除", "fs");
        if(caseId) openRunsDialog(caseId, caseTitle);
        loadCases();
      }).catch(function(ex){ del.disabled = false; toast(ex.message || "删除失败", "bad"); });
    });
    return;
  }
  var bug = e.target.closest("[data-run-bug]");
  if(bug){ closeRunsDialog(); openTaskById(bug.dataset.runBug); }
});
$("runsList").addEventListener("change", function(e){
  var inp = e.target.closest("[data-run-file]");
  if(!inp || !inp.files || !inp.files[0]) return;
  var file = inp.files[0];
  inp.value = "";
  if(runsCaseId) uploadRunEvidence(runsCaseId, inp.dataset.runFile, file);
});

/* 覆盖矩阵 / 报告：需求行、失败行跳转 */
function covRowKeyActivate(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var row = e.target.closest("[data-cov-demand]");
  if(!row) return;
  e.preventDefault();
  row.click();
}
if($("tcCoverage")){
  $("tcCoverage").addEventListener("click", function(e){
    var row = e.target.closest("[data-cov-demand]");
    if(row) openDemandDetailById(row.dataset.covDemand);
  });
  $("tcCoverage").addEventListener("keydown", covRowKeyActivate);
}
/* 测试报告：导出 / 打印 / 跳转 */
if($("tcReport")){
  $("tcReport").addEventListener("click", function(e){
    if(e.target.closest("[data-tc-report-csv]")){ exportTestReport(); return; }
    if(e.target.closest("[data-tc-report-print]")){ printTestReport(); return; }
    var covRow = e.target.closest("[data-cov-demand]");
    if(covRow){ openDemandDetailById(covRow.dataset.covDemand); return; }
    var caseBtn = e.target.closest("[data-report-case]");
    if(caseBtn){ openReportCase(caseBtn.dataset.reportCase); return; }
    var hit = null;
    var runs = e.target.closest("[data-report-runs]");
    var bug = e.target.closest("[data-report-bug]");
    var id = runs ? runs.dataset.reportRuns : (bug ? bug.dataset.reportBug : "");
    if(id){
      hit = reportCaseById(id);
    }
    if(runs){ openRunsDialog(id, hit ? hit.title : ""); return; }
    if(bug){
      if(hit && hit.latestBugTaskId) openTaskById(hit.latestBugTaskId);
      else toast("未找到关联缺陷，可能已被删除", "warn");
    }
  });
  $("tcReport").addEventListener("keydown", covRowKeyActivate);
}

/* 弹窗开着时切视图：先处理未保存内容，确认后再继续跳转 */
window.addEventListener("ds:before-route", function(e){
  var openId = null;
  ["dlgCase", "dlgCaseRun", "dlgCaseDefect", "dlgCaseRuns"].forEach(function(id){
    var d = $(id);
    if(d && d.classList.contains("open")) openId = id;
  });
  if(!openId) return;
  e.preventDefault();
  var to = e.detail && e.detail.to;
  function after(){
    if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
  }
  if(openId === "dlgCase") tryCloseCaseDialog(after);
  else if(openId === "dlgCaseRun") tryCloseRunDialog(after);
  else if(openId === "dlgCaseRuns"){ closeRunsDialog(); after(); }
  else tryCloseDefectDialog(after);
});

function openCaseInProject(reqId, id){
  if(reqId) caseReqId = reqId;
  syncReqSel();
  var hit = caseById(id);
  if(hit){ openEditDialog(id); return Promise.resolve(true); }
  return loadCases().then(function(){
    if(caseById(id)){ openEditDialog(id); return true; }
    toast("用例不存在或无权查看", "warn");
    return false;
  });
}

export { currentTcMode, enterTestCasesView, openCaseInProject, setTcMode };
